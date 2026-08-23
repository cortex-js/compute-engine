import json, collections, sys, os, re

# The directory holding rerun-baseline.json / rerun-withhold-<family>.json:
# the first non-flag argument, else the current directory.
dirs = [a for a in sys.argv[1:] if not a.startswith('-')]
S = os.path.abspath(dirs[0]) if dirs else os.getcwd()
TYPE_WORDS = r"(number|integer|rational|real|complex|imaginary|boolean|string|list|set|tuple|vector|matrix|collection|unknown|any|nothing|never|value|function|broadcastable|range|missing|error)"
PIN_RE = re.compile(r'Expected: "[^"]*' + TYPE_WORDS + r'[^"]*"\s*\n\s*Received: "[^"]*' + TYPE_WORDS)


def failing(path):
    d = json.load(open(path))
    out = {}
    for tr in d['testResults']:
        f = tr['name'].split('/test/')[-1]
        if tr.get('status') == 'failed' and not tr.get('assertionResults'):
            out[(f, '<suite failed to run>')] = tr.get('message', '')[:500]
        for a in tr.get('assertionResults', []):
            if a['status'] == 'failed':
                out[(f, a['fullName'])] = '\n'.join(a.get('failureMessages', []))
    return out


base = failing(f'{S}/rerun-baseline.json')
print(f'baseline failures: {len(base)}')
verbose = '-v' in sys.argv
for v in ['sgn', 'literal']:
    p = f'{S}/rerun-withhold-{v}.json'
    if not os.path.exists(p):
        print(f'\n## withhold {v}: not available')
        continue
    fs = failing(p)
    new = {k: m for k, m in fs.items() if k not in base}
    pins = {k: m for k, m in new.items() if PIN_RE.search(m)}
    beh = {k: m for k, m in new.items() if k not in pins}
    print(
        f'\n## withhold {v}: {len(fs)} failures, {len(new)} new — '
        f'{len(pins)} type pins, {len(beh)} behavior changes'
    )
    by = collections.Counter(f for f, _ in beh)
    for f, n in by.most_common():
        print(f'  {n:3d}  {f}')
    if verbose:
        for key in sorted(beh):
            print('\n---', key[0], '::', key[1])
            print(
                '\n'.join(
                    l for l in beh[key].split('\n') if not l.strip().startswith('at ')
                )[:900]
            )
