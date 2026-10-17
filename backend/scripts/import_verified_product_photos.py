"""Download only the reviewed photo plan, retaining provenance and missing SKUs.

Run match_verified_product_photos.py first. Failed downloads remain missing;
this importer never substitutes another product's photograph.
"""
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date
import argparse
import json
from pathlib import Path

from fetch_product_photos import ASSETS, MANIFEST, ROOT, download


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--plan', type=Path, default=ROOT / 'data/seed/product-photo-plan-20261016.json')
    args = parser.parse_args()
    plan = json.loads(args.plan.read_text())
    manifest = json.loads(MANIFEST.read_text())
    # Rebuild mappings from the reviewed plan. Historical nearest-looking
    # assignments must never survive as a fallback for missing photos.
    manifest['products'] = {}
    unique = {row['source']['imageUrl']: row['source'] for row in plan['matched']}
    ASSETS.mkdir(parents=True, exist_ok=True)
    available, failures = {}, []
    with ThreadPoolExecutor(max_workers=4) as pool:
        jobs = {pool.submit(download, source): url for url, source in unique.items()}
        for number, job in enumerate(as_completed(jobs), 1):
            url = jobs[job]
            try:
                available[url] = job.result()
            except Exception as exc:
                failures.append({'imageUrl': url, 'error': str(exc)})
                print(f'Failed {url}: {exc}', flush=True)
            if number % 25 == 0:
                print(f'Downloaded {number}/{len(unique)} photos', flush=True)
    applied, missing = [], list(plan['missing'])
    for row in plan['matched']:
        asset = available.get(row['source']['imageUrl'])
        if not asset:
            missing.append({key: row[key] for key in ('sku', 'name', 'category')})
            continue
        manifest['sources'][asset['id']] = {key: value for key, value in asset.items() if key != 'id'}
        manifest['products'][row['sku']] = {
            'source': asset['id'], 'kind': row['kind'], 'note': row['reason'],
        }
        applied.append(row['sku'])
    manifest['retrievedOn'] = date.today().isoformat()
    manifest['products'] = dict(sorted(manifest['products'].items()))
    used = {entry['source'] for entry in manifest['products'].values()}
    manifest['sources'] = {key: value for key, value in manifest['sources'].items() if key in used}
    MANIFEST.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')
    report = {
        'retrievedOn': date.today().isoformat(), 'appliedCount': len(applied),
        'missingCount': len(missing), 'photoCount': len(available),
        'appliedSkus': sorted(applied), 'missing': missing, 'downloadFailures': failures,
    }
    (ROOT / 'data/seed/product-photo-coverage.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({key: report[key] for key in ('appliedCount', 'missingCount', 'photoCount', 'downloadFailures')}, ensure_ascii=False), flush=True)


if __name__ == '__main__':
    main()
