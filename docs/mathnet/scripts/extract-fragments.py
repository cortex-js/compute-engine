"""Extract unique LaTeX math fragments from a MathNet sample JSONL.

Usage:
    python3 extract-fragments.py mathnet-sample.jsonl [--out fragments.json]

Keeps rows whose `language` contains 'English' or is null, then pulls
$$...$$, \\[...\\], \\(...\\), and $...$ spans (in that precedence order)
from `problem_markdown`. Output: a JSON array of unique fragment strings,
ready for parse-sweep.ts.
"""

import argparse
import json
import re

PATTERNS = [
    re.compile(r'\$\$(.+?)\$\$', re.S),
    re.compile(r'\\\[(.+?)\\\]', re.S),
    re.compile(r'\\\((.+?)\\\)', re.S),
    re.compile(r'\$(.+?)\$', re.S),
]


def extract(text: str) -> list[str]:
    frags = []
    for pat in PATTERNS:
        for m in pat.finditer(text):
            frags.append(m.group(1).strip())
        text = pat.sub(' ', text)
    return [f for f in frags if f]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument('sample')
    ap.add_argument('--out', default='fragments.json')
    args = ap.parse_args()

    seen: dict[str, None] = {}
    total = 0
    for line in open(args.sample):
        row = json.loads(line)
        lang = row.get('language')
        if lang is not None and 'English' not in lang:
            continue
        for frag in extract(row.get('problem_markdown', '')):
            total += 1
            seen.setdefault(frag)

    with open(args.out, 'w') as f:
        json.dump(sorted(seen), f, ensure_ascii=False, indent=0)
    print(f'{total} fragments, {len(seen)} unique -> {args.out}')


if __name__ == '__main__':
    main()
