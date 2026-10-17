"""Build an auditable photo plan; no nearest-looking or same-category fallback.

SKU/name matches are preferred. Shared family/model photos are marked series.
Medicine matches require a matching brand and strength, or an explicit SKU.
"""
import argparse
import csv
from collections import Counter
from decimal import Decimal
from difflib import SequenceMatcher
from functools import cache
import json
from pathlib import Path
import re
import sys
import unicodedata

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'data/seed'))
import catalog


@cache
def normalized(text):
    return unicodedata.normalize('NFKC', text).lower().replace('中化健康360', '中化360')


@cache
def name_key(text):
    text = normalized(text)
    text = re.sub(r'\([a-z]\d{5,}(?:-\d+)?\)', '', text)
    return re.sub(r'[^a-z0-9\u4e00-\u9fff]', '', text)


@cache
def family_key(text):
    text = normalized(text)
    text = re.sub(r'\([a-z]\d{5,}(?:-\d+)?\)', '', text)
    text = text.replace('日本獅王', '獅王').replace('日本大王', '大王')
    text = text.replace('csd中衛', '中衛').replace('lion獅王', '獅王').replace('attento', '愛適多')
    text = re.sub(r'[/／](?:盒|瓶|組|包|支|件)', '', text)
    text = re.sub(r'\d+(?:\.\d+)?\s*(?:mlx?|毫升|ml|gm|g|公克|克|錠|粒|顆|包|片|抽|入|pcs?|組|盒|瓶|支|串|袋)', '', text)
    text = re.sub(r'\b(?:s|m|l|xl|ll|xxl)(?:[~/ -](?:s|m|l|xl|ll|xxl))*\b', '', text)
    text = re.sub(r'(?:x|×|\*)\s*\d+', '', text)
    text = re.sub(r'\((?:屈|h|ka|px|otc專案|組合|盒裝|瓶裝)\)', '', text)
    text = re.sub(r'\|.*$', '', text)
    return re.sub(r'[^a-z0-9\u4e00-\u9fff]', '', text)


MODEL = re.compile(r'(?:HEM|HCR|HBP|HBF|JPN|MC|HV|NE)[- ]?[A-Z]*\d[A-Z0-9-]*|(?<![A-Z0-9])(?:BP|BB|BS|KS|KP|KB|KE|FS|FP|WS|WB|TP|TB|EP|SE)\d{2}(?![A-Z0-9])', re.I)


@cache
def models(text):
    return {re.sub(r'[- ]', '', value.upper()) for value in MODEL.findall(text)}


@cache
def strengths(text):
    text = normalized(text)
    found = set()
    for amount, unit in re.findall(r'(\d+(?:\.\d+)?)\s*(mcg|mg|gm|g|微克|毫克|公克|克)(?![a-z])', text):
        multiplier = Decimal('.001') if unit in ('mcg', '微克') else Decimal('1000') if unit in ('gm', 'g', '公克', '克') else Decimal(1)
        found.add(str((Decimal(amount) * multiplier).normalize()))
    for amount in re.findall(r'(\d+(?:\.\d+)?)\s*(?:i\.?u\.?|u\.?|單位)(?![a-z])', text):
        found.add('u:' + str(Decimal(amount).normalize()))
    return found


@cache
def volumes(text):
    return {str(Decimal(value).normalize()) for value in re.findall(r'(\d+(?:\.\d+)?)\s*(?:ml|毫升)(?![a-z])', normalized(text))}


@cache
def dosage_form(text):
    text = normalized(text)
    if re.search(r'inj|infusion|\binf\b|\bamp\b|vial|注射', text):
        return 'injection'
    if re.search(r'capsule|\bcap\b|\d+c(?:/|\b)|膠囊', text):
        return 'capsule'
    if re.search(r'tablet|\btab\b|\bf\.?c\.?t|\be\.?s\.?c\.?t|\d+t(?:/|\b)|錠', text):
        return 'tablet'
    return None


@cache
def series_key(text):
    text = normalized(text)
    if ('中衛' in text or 'csd' in text) and '口罩' in text:
        age = '幼幼' if re.search('幼幼|幼兒|小童', text) else '兒童' if re.search('兒童|兒用', text) else '成人'
        shape = '4d' if '4d' in text else '3d' if '3d' in text else '立體' if '立體' in text else '平面'
        carbon = '活性碳' if '活性碳' in text else '一般'
        return f'CSD:{age}:{shape}:{carbon}'
    if re.search(r'botanist|^bo(?:洗|潤|護)', text):
        item = '洗髮' if re.search('洗髮|bo洗', text) else '潤髮' if re.search('潤髮|bo潤', text) else '沐浴' if re.search('沐浴|身體皂', text) else '護髮' if re.search('護髮|bo護', text) else None
        care = next((tag for tag in ['滋潤', '清爽', '受損', '蓬鬆', '髮肌'] if tag in text), None)
        if item and care:
            return f'BOTANIST:{item}:{care}'
    if '綠的' in text:
        item = next((tag for tag in ['男士超淨效三合一潔淨露', '男性抗菌沐浴乳', '弱酸溫和抗菌潔手露', '植物抗菌潔手露', '植物抗菌潔手慕斯', '抗菌潔手慕斯ex', '抗菌潔手乳', '潔膚劑', '抗菌皂', '藥皂'] if tag in text), None)
        if item:
            return f'GREEN:{item}'
    if re.search('大王|elleair|attento|愛適多|natura|elis|愛麗思', text):
        lines = ['舒適復健褲', '長時間元氣褲', '元氣褲', '膚適安心褲', '防漏加長平口褲', '防漏平口褲', '超安心褲', '側背雙防漏', '防漏超吸收紙尿片', '強力超吸收紙尿片', '日用超透氣', '夜用超透氣', '褲型專用尿片', '男性用尿片', '超安心尿片', '超熟睡', '零觸感', '新素肌', '娜舒雅', 'natura清爽', 'natura輕', '奢侈保濕', '強韌清潔', '超吸收', '柔韌', '家庭清潔除菌', 'puana純淨然']
        line = next((line for line in lines if line in text), None)
        if line:
            # Tissue types and diaper construction remain distinct.
            item = next((tag for tag in ['廚房', '面紙', '衛生紙', '濕紙巾', '濕巾', '尿片', '褲'] if tag in text), '')
            return f'DAIO:{line}:{item}'
    return None


@cache
def series_keys(text):
    """A source photo may explicitly contain several variants of one product."""
    text = normalized(text)
    keys = set()
    if key := series_key(text):
        keys.add(key)
    if re.search(r'botanist|^bo(?:洗|潤|護|沐浴)', text):
        items = [tag for tag in ['洗髮', '潤髮', '沐浴乳', '沐浴慕斯', '護髮膜', '護髮膏'] if tag in text]
        if '沐浴' in text and not any(tag.startswith('沐浴') for tag in items):
            items.append('沐浴乳')
        cares = [tag for tag in ['滋潤', '清爽', '受損', '蓬鬆', '髮肌', '深層保濕', '透明肌淨', '黑炭'] if tag in text]
        if 'rooth' in text:
            cares = ['rooth']
        keys = {f'BOTANIST:{item}:{care}' for item in items for care in cares}
    elif '中化360' in text or '中化' in text:
        lines = ['固營肌力關鍵', '固循特級高濃度魚油', '中化纖黃金奇異果益生菌', '倍多鈣三鈣膠原粉', '倍多喜橙皙膠原錠', '倍多喜錠', '元氣b群', '美顏b群', '藍光對策金盞花葉黃素', '明亮對策金盞花葉黃素', '固營水解蛋黃粉']
        for line in lines:
            if name_key(line) in name_key(text):
                keys.add('CENRA:' + line)
        if '固營' in text and 'uc-ii' in text:
            keys.add('CENRA:UCII-EX' if 'ex' in text else 'CENRA:UCII')
        if '固營靈活關鍵' in text and 'ex' in text:
            keys.add('CENRA:UCII-EX')
    elif 'kimiomoi' in text:
        item = next((tag for tag in ['褲型', '黏貼型', '凝結型紙砂'] if tag in text), None)
        if item:
            keys.add('KIMIOMOI:' + item)
    elif '毛毛好室' in text:
        line = next((tag for tag in ['抗菌臭味分解噴霧', '沙龍級香氛洗毛精', '高效潔耳液', '免疫好平衡', '行動好表現', '泌尿好守護', '安穩好心情', '機能型凍乾'] if tag in text), None)
        if line:
            species = '狗狗' if '狗狗專用' in text else '貓貓' if '貓貓專用' in text else '貓狗'
            age = next((tag for tag in ['高齡', '幼齡', '挑食'] if tag in text), '')
            keys.add(f'PAWS:{line}:{species}:{age}')
    return keys


def products():
    with (ROOT / 'data/seed/products.tsv').open() as file:
        rows = [{'sku': row['料號'], 'name': row['品名'], 'category': row['類別']} for row in csv.DictReader(file, delimiter='\t')]
    return rows + [{'sku': row[0], 'name': row[1], 'category': row[2]} for row in catalog.PROMO_PRODUCTS]


# Short catalog labels whose official names/brand spellings are unambiguous.
ALIASES = {
    'C130068': '金舒胃得腸溶膜衣錠20毫克',
    'C130082': '金舒胃平二層錠',
    'C130082-S1': '金舒胃平二層錠',
    'C450070': '骨營膠囊250毫克(600粒)',
    'C450111': '骨營加強型口服溶液用粉劑',
    'D120013': '威鎮酸痛凝膠',
    'D390115': '黴癒乳膏10毫克/公克',
    'D390122': '黴癒噴劑 10 毫克/公克',
    'D390139': '黴癒一次療程護膜液',
    'D390146': '”黴癒”灰指甲油劑5%',
    'D390153': '”黴癒”灰指甲油劑5%',
    'F747814': '樺達喉糖薄荷50克',
    'F761621': '樺達硬喉糖檸檬',
    'F761638': '樺達硬喉糖薄荷',
    'F761645': '樺達硬喉糖甘草金桔',
    'F761676': '樺達喉糖檸檬50克',
    'F761683': '樺達喉糖薄荷50克',
    'F761690': '樺達喉糖檸檬口味１６０克',
    'F761700': '樺達喉糖薄菏口味１６０克',
    'F763946': '樺達喉糖檸檬口味１６０克',
    'F761872': '施美愛樂膚霜',
    'F763630': '獅美露保視捷眼藥水',
    'F702695': '低週波治療器長效電極貼片 HV-LLPAD',
    'F764710': 'AliveCor 卡地亞行動心電圖系統 KardiaMobile 6L System',
    'C400013': '秘利腸溶糖衣錠',
    'C400824': '秘利腸溶糖衣錠',
    'F748602': '獅美露睛漾眼藥水',
    'F748767': '獅美露康德目耀眼藥水',
    'F749562': '獅美露活視捷眼藥水',
    'F749562-30': '獅美露活視捷眼藥水',
    'F749579': '獅美露活視捷眼藥水',
    'F749634': '獅美露雪漾眼藥水',
    'F762488': '獅美露康德目耀眼藥水',
    'F763702': '獅美露保視捷眼藥水',
    'F763719': '獅美露康德目耀眼藥水',
    'F763726': '獅美露活視捷眼藥水',
}


def choose(product, sources):
    sku, name = product['sku'], product['name']
    key, family, wanted_models = name_key(name), family_key(name), models(name)
    collateral = bool(re.search('條碼貼|展示|紙架|陳列|提袋|介紹小冊|海報|價目', name))
    medicine = product['category'] in ('慢性處方', '一般用藥')
    ranked = []
    for source in sources:
        # Manually checked supplements are scoped to the exact catalog row.
        # In particular, a reviewed medicine cannot leak to another strength.
        if 'reviewedProducts' in source:
            review = next((row for row in source['reviewedProducts']
                           if row['sku'] == sku and row['name'] == name
                           and row['category'] == product['category']), None)
            if review:
                ranked.append((1100, review['kind'], review['note'], source))
            continue
        title = source['title']
        if re.search(r'(?<![a-z0-9])' + re.escape(sku) + r'(?![a-z0-9])', title + ' ' + source.get('keywords', ''), re.I):
            ranked.append((1000, 'series', '原廠頁面明列料號', source))
        elif sku in ALIASES and name_key(ALIASES[sku]) == name_key(title):
            ranked.append((950, 'series', '已核對中英文商品名稱；通路、容量或包裝共用照片', source))
        elif key == name_key(title):
            ranked.append((900, 'exact', '原廠商品全名一致', source))
        elif not collateral and wanted_models and wanted_models == models(title) and bool(re.search('濾網|壓脈帶|袖帶|配件|耗材|刷頭|貼片', name)) == bool(re.search('濾網|壓脈帶|袖帶|配件|耗材|刷頭|貼片', title)):
            ranked.append((800, 'series', '原廠型號一致；尺寸或包裝共用照片', source))
        elif not collateral and not medicine and len(family) >= 6 and family == family_key(title):
            ranked.append((700, 'series', '品牌與系列名稱一致；容量、尺寸或包裝不同', source))
        elif not collateral and not medicine and series_keys(name) & series_keys(title):
            ranked.append((650, 'series', '原廠同品牌同系列共用照片；花色、容量、尺寸與包裝以商品名稱為準', source))
        elif medicine and source.get('englishName'):
            brand = re.search(r'[A-Za-z][A-Za-z0-9-]{2,}', name)
            english = normalized(source['englishName'])
            wanted_strength = strengths(name)
            primary_strength = strengths(title + ' ' + source['englishName'] + ' ' + ' '.join(value for value in source.get('specifications', []) if value.startswith('劑量')))
            if brand and re.match(re.escape(brand[0].lower()) + r'\b', english) and wanted_strength and wanted_strength == primary_strength:
                wanted_form = dosage_form(name)
                source_form = dosage_form(title + ' ' + source['englishName'] + ' ' + ' '.join(value for value in source.get('specifications', []) if value.startswith('劑型')))
                wanted_volume = volumes(name)
                if wanted_form and wanted_form == source_form and (not wanted_volume or wanted_volume == volumes(title + ' ' + source['englishName'])):
                    ranked.append((850, 'series', '原廠英文藥名、劑型與劑量一致；包裝共用照片', source))
    if not ranked:
        return None
    # Similarity only breaks ties among already verified identities/series;
    # it cannot make an unrelated source eligible for selection.
    score, kind, reason, source = max(ranked, key=lambda item: (item[0], SequenceMatcher(None, key, name_key(item[3]['title'])).ratio()))
    return {'sku': sku, 'name': name, 'category': product['category'], 'kind': kind, 'reason': reason, 'score': score, 'source': source}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=ROOT / 'data/seed/product-photo-plan-20261016.json')
    args = parser.parse_args()
    sources = json.loads((ROOT / 'data/seed/product-photo-sources.json').read_text())
    for inventory in sorted((ROOT / 'data/seed').glob('product-photo-sources-verified-*.json')):
        sources += json.loads(inventory.read_text())
    # Prefer new structured source metadata for the same URL.
    sources = list({(source['pageUrl'], source['imageUrl'], 'reviewedProducts' in source): source
                    for source in sources}.values())
    planned, missing = [], []
    for product in products():
        match = choose(product, sources)
        (planned if match else missing).append(match or product)
    output = {'matched': planned, 'missing': missing}
    path = args.output
    path.write_text(json.dumps(output, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({'matched': len(planned), 'missing': len(missing), 'categories': dict(Counter(item['category'] for item in planned)), 'uniqueImages': len({item['source']['imageUrl'] for item in planned})}, ensure_ascii=False))


if __name__ == '__main__':
    main()
