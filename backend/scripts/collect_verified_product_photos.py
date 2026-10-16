"""Collect product metadata from official catalogs without guessing SKU matches.

Writes a separate source inventory. Matching and review happen before photos are
added to the UI manifest. Does not touch the database or the existing manifest.
"""
from concurrent.futures import ThreadPoolExecutor
import hashlib
from html.parser import HTMLParser
import json
from pathlib import Path
import re
from urllib.parse import urljoin, urlsplit

import httpx

ROOT = Path(__file__).resolve().parents[2]
CACHE = Path('/private/tmp/meddemo-official-photo-cache-20261016')
CACHE.mkdir(exist_ok=True)
CLIENT = httpx.Client(follow_redirects=True, timeout=25, limits=httpx.Limits(max_connections=4))


def fetch(url):
    target = CACHE / hashlib.sha256(url.encode()).hexdigest()
    if target.exists():
        return target.read_text()
    response = CLIENT.get(url)
    response.raise_for_status()
    target.write_text(response.text)
    return response.text


class Page(HTMLParser):
    def __init__(self, content, url):
        super().__init__(convert_charrefs=True)
        self.content = content
        self.url = url
        self.meta, self.links, self.images, self.cards, self.texts = {}, [], [], [], []
        self.card, self.ignore = None, 0
        self.feed(content)

    def handle_starttag(self, tag, attrs):
        props = dict(attrs)
        if tag in ('script', 'style'):
            self.ignore += 1
        if tag == 'base' and props.get('href'):
            self.url = props['href']
        if tag == 'meta' and props.get('property'):
            self.meta[props['property']] = props.get('content', '')
        if tag == 'a' and props.get('href'):
            link = urljoin(self.url, props['href'])
            self.links.append(link)
            self.card = {'pageUrl': link, 'title': '', 'imageUrl': ''}
        if tag == 'img':
            src = props.get('data-src') or props.get('src')
            if src:
                self.images.append({'imageUrl': urljoin(self.url, src), 'title': props.get('alt') or ''})
                if self.card and not self.card['imageUrl']:
                    self.card['imageUrl'] = urljoin(self.url, src)
                    self.card['title'] += props.get('alt') or ''
        if self.card and props.get('style'):
            match = re.search(r'background-image:\s*url\([\'"]?([^)\'"]+)', props['style'])
            if match:
                self.card['imageUrl'] = urljoin(self.url, match[1])

    def handle_data(self, text):
        if not self.ignore and text.strip():
            self.texts.append(text.strip())
            if self.card:
                self.card['title'] += ' ' + text.strip()

    def handle_endtag(self, tag):
        if tag in ('script', 'style'):
            self.ignore = max(0, self.ignore - 1)
        if tag == 'a' and self.card:
            self.card['title'] = re.sub(r'\s+', ' ', self.card['title']).strip()
            self.cards.append(self.card)
            self.card = None


def read(url):
    try:
        return url, Page(fetch(url), url)
    except Exception as error:
        print(f'Skipped {url}: {type(error).__name__}', flush=True)
        return url, None


def batch(urls):
    urls = sorted(set(urls))
    with ThreadPoolExecutor(4) as pool:
        results = []
        for index, result in enumerate(pool.map(read, urls), 1):
            results.append(result)
            if len(urls) > 30 and index % 40 == 0:
                print(f'Read {index}/{len(urls)} product pages', flush=True)
        return results


def source(url, page):
    title, image = page.meta.get('og:title', ''), page.meta.get('og:image', '')
    if not title or not image or '/overview/' in image:
        return None
    title = re.sub(r'\s*\|\s*日本獅王台灣官方旗艦館.*$', '', title)
    clean = lambda value: re.sub(r'\s+', ' ', re.sub(r'<[^>]+>', ' ', value)).strip()
    english = re.search(r'<p class="font-open mb-30[^\"]*">(.*?)</p>', page.content, re.S)
    specifications = [clean(block) for block in re.findall(r'<div class="Specification-list">(.*?)</div>', page.content, re.S)]
    english_name = clean(english[1]) if english else ''
    return {'title': title, 'pageUrl': url, 'imageUrl': urljoin(url, image),
            'englishName': english_name, 'specifications': specifications,
            'keywords': ' '.join([english_name, *specifications])[:1500], 'retrievedOn': '2026-10-16'}


def botanist_sources():
    records = []
    care_names = {'MOIST': '滋潤型', 'SMOOTH': '清爽型', 'DAMAGE CARE': '受損護理型', 'SCALP CLEANSE': '髮肌淨化型', 'BOUNCY VOLUME': '彈潤蓬鬆型'}
    for section in ('haircare', 'bodycare'):
        url = f'https://zh-tw.botanistofficial.com/product/{section}/'
        _, page = read(url)
        if not page:
            continue
        content = re.sub(r'<!--.*?-->', '', page.content, flags=re.S)
        for block in re.findall(r'<article\b.*?</article>', content, re.S):
            title = re.search(r'<h3[^>]*>(.*?)</h3>', block, re.S)
            image = re.search(r'<img[^>]+src="([^"]+)"', block)
            if not title or not image:
                continue
            english = re.sub(r'<[^>]*>', '', title[1]).strip()
            care = next((label for key, label in care_names.items() if key in english), None)
            if care and 'SHAMPOO / TREATMENT' in english:
                records.append({'title': f'BOTANIST 植物性洗髮精／潤髮乳（{care}）',
                                'pageUrl': url, 'imageUrl': urljoin(url, image[1]),
                                'englishName': english, 'retrievedOn': '2026-10-16'})
    return records


def main():
    categories = ['處方用藥', '指示用藥', '保健食品', '醫療暨保健器材', '個人清潔及用品', '醫美保養品', '動物用產品']
    entries = [f'https://www.cenra-pharma.com/tw/category?mainCategory={name}' for name in categories]
    seen, details, records = set(), set(), []
    while entries:
        current, entries = entries, []
        for url, page in batch(current):
            seen.add(url)
            if not page:
                continue
            details.update(link for link in page.links if '/tw/product/' in link)
            entries.extend(link for link in page.links if '/tw/category?' in link and link not in seen)
        entries = sorted(set(entries) - seen)
        if len(seen) > 100:
            raise RuntimeError('Unexpected category pagination')
    print(f'Cenra: {len(seen)} category pages, {len(details)} product pages', flush=True)
    for url, page in batch(details):
        if page and (record := source(url, page)):
            records.append(record)
    sitemap = fetch('https://shop.lion-corp.com.tw/sitemap.xml')
    lion_urls = {url for url in re.findall(r'<loc>([^<]+)', sitemap) if '/products/' in url}
    print(f'Lion: {len(lion_urls)} official product pages', flush=True)
    for url, page in batch(lion_urls):
        if page and (record := source(url, page)):
            records.append(record)
    _, daio = read('https://www.elleair.tw/product/care.php')
    if daio:
        pages = {link for link in daio.links if '/product/' in link and 'detail.php' not in link}
        for url, page in batch(pages | {'https://www.elleair.tw/'}):
            if page:
                records.extend(card for card in page.cards if '/product/detail.php?' in card['pageUrl'] and card['imageUrl'] and card['title'])
                records.extend({**image, 'pageUrl': url, 'retrievedOn': '2026-10-16'} for image in page.images
                               if re.search(r'愛適多|elleair|Goo|elis|大王', image['title'], re.I) and len(image['title']) > 8)
        records.extend(card for card in daio.cards if '/product/detail.php?' in card['pageUrl'] and card['imageUrl'] and card['title'])
        records.extend({**image, 'pageUrl': 'https://www.elleair.tw/product/care.php', 'retrievedOn': '2026-10-16'} for image in daio.images
                       if '愛適多' in image['title'] and len(image['title']) > 8)
    records.extend(botanist_sources())
    unique = {(row['pageUrl'], row['imageUrl']): row for row in records}
    target = ROOT / 'data/seed/product-photo-sources-verified-20261016.json'
    target.write_text(json.dumps(list(unique.values()), ensure_ascii=False, indent=2) + '\n')
    print(f'Collected {len(unique)} official photo sources → {target}', flush=True)


if __name__ == '__main__':
    main()
