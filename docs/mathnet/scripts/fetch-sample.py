"""Fetch a sample of the MathNet dataset (huggingface.co/datasets/ShadenA/MathNet)
as JSONL, with the image payloads stripped.

Usage:
    python3 fetch-sample.py [--pages N] [--out FILE]

Defaults reproduce the 800-row sample used by the 2026-07-04 experiment
(8 pages of 100 rows at evenly spaced offsets). The characterization report
used --pages 31 (~3,100 rows). The API serves at most 100 rows per request.
"""

import argparse
import json
import time
import urllib.request

BASE = 'https://datasets-server.huggingface.co/rows'
DATASET = 'ShadenA/MathNet'
TOTAL = 27817
PAGE = 100


def fetch(offset: int, attempt: int = 1):
    url = (f'{BASE}?dataset={DATASET}&config=all&split=train'
           f'&offset={offset}&length={PAGE}')
    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'curl/8.0'})
        with urllib.request.urlopen(req, timeout=60) as resp:
            return json.loads(resp.read().decode('utf-8'))
    except Exception as e:
        if attempt < 3:
            print(f'  offset={offset} attempt {attempt} failed: {e}, retrying...')
            time.sleep(5 * attempt)
            return fetch(offset, attempt + 1)
        print(f'  offset={offset} FAILED: {e}, skipping')
        return None


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument('--pages', type=int, default=8)
    ap.add_argument('--out', default='mathnet-sample.jsonl')
    args = ap.parse_args()

    offsets = [i * (TOTAL // args.pages) for i in range(args.pages)]
    count = 0
    with open(args.out, 'w') as f:
        for offset in offsets:
            data = fetch(offset)
            if data is None:
                continue
            for r in data.get('rows', []):
                row = r.get('row', {})
                row['images_count'] = len(row.get('images') or [])
                row.pop('images', None)
                f.write(json.dumps(row, ensure_ascii=False) + '\n')
                count += 1
            print(f'offset={offset}: total {count}')
            time.sleep(0.5)
    print(f'Done: {count} rows -> {args.out}')


if __name__ == '__main__':
    main()
