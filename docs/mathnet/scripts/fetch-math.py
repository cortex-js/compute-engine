"""Fetch a genre-balanced sample of Hendrycks MATH (EleutherAI/hendrycks_math)
as JSONL. One-off for the ROADMAP genre-coverage sweep (2026-07-09).

3 evenly spaced pages of 100 rows per subject config, train split.
"""

import json
import time
import urllib.request

BASE = 'https://datasets-server.huggingface.co/rows'
DATASET = 'EleutherAI%2Fhendrycks_math'
CONFIGS = [
    'algebra',
    'counting_and_probability',
    'geometry',
    'intermediate_algebra',
    'number_theory',
    'prealgebra',
    'precalculus',
]
PAGE = 100
PAGES_PER_CONFIG = 3


def fetch(config: str, offset: int, attempt: int = 1):
    url = (f'{BASE}?dataset={DATASET}&config={config}&split=train'
           f'&offset={offset}&length={PAGE}')
    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'curl/8.0'})
        with urllib.request.urlopen(req, timeout=60) as resp:
            return json.loads(resp.read().decode('utf-8'))
    except Exception as e:
        if attempt < 3:
            print(f'  {config}@{offset} attempt {attempt} failed: {e}')
            time.sleep(5 * attempt)
            return fetch(config, offset, attempt + 1)
        print(f'  {config}@{offset} FAILED: {e}, skipping')
        return None


def main() -> None:
    count = 0
    with open('math-sample.jsonl', 'w') as f:
        for config in CONFIGS:
            first = fetch(config, 0)
            if first is None:
                continue
            total = first['num_rows_total']
            stride = max(total // PAGES_PER_CONFIG, PAGE)
            offsets = sorted({
                min(i * stride, max(total - PAGE, 0))
                for i in range(PAGES_PER_CONFIG)
            })
            for offset in offsets:
                data = first if offset == 0 else fetch(config, offset)
                if data is None:
                    continue
                for r in data.get('rows', []):
                    row = r.get('row', {})
                    row['config'] = config
                    f.write(json.dumps(row, ensure_ascii=False) + '\n')
                    count += 1
                print(f'{config}@{offset}: total {count}')
                time.sleep(0.5)
    print(f'Done: {count} rows -> math-sample.jsonl')


if __name__ == '__main__':
    main()
