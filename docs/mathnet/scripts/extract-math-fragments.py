"""Extract unique LaTeX math fragments from a Hendrycks MATH sample JSONL.

Same span-precedence logic as docs/mathnet/scripts/extract-fragments.py,
but: reads `problem` + `solution` fields, and strips [asy]...[/asy]
Asymptote blocks first (they contain $...$ label strings that are not
document math). Records which config each fragment came from (first seen).
"""

import json
import re

ASY = re.compile(r'\[asy\].*?\[/asy\]', re.S)
# (?<!\\)\$ : don't treat escaped \$ (currency, ubiquitous in MATH
# prealgebra) as a math delimiter — it splits fragments mid-expression.
PATTERNS = [
    re.compile(r'(?<!\\)\$\$(.+?)(?<!\\)\$\$', re.S),
    re.compile(r'\\\[(.+?)\\\]', re.S),
    re.compile(r'\\\((.+?)\\\)', re.S),
    re.compile(r'(?<!\\)\$(.+?)(?<!\\)\$', re.S),
]


def extract(text: str) -> list[str]:
    text = ASY.sub(' ', text)
    frags = []
    for pat in PATTERNS:
        for m in pat.finditer(text):
            frags.append(m.group(1).strip())
        text = pat.sub(' ', text)
    return [f for f in frags if f]


def main() -> None:
    seen: dict[str, str] = {}
    total = 0
    for line in open('math-sample.jsonl'):
        row = json.loads(line)
        text = row.get('problem', '') + '\n' + row.get('solution', '')
        for frag in extract(text):
            total += 1
            seen.setdefault(frag, row['config'])

    frags = sorted(seen)
    with open('math-fragments.json', 'w') as f:
        json.dump(frags, f, ensure_ascii=False, indent=0)
    with open('math-fragment-configs.json', 'w') as f:
        json.dump({k: seen[k] for k in frags}, f, ensure_ascii=False, indent=0)
    print(f'{total} fragments, {len(seen)} unique -> math-fragments.json')


if __name__ == '__main__':
    main()
