# mpmath reference column for the BigDecimal primitive-op microbench.
# Like-for-like philosophy (per BIGNUM-COMPARISON.md): mpmath is the raw bignum
# engine SymPy sits on, so mpmath.mpf ops at mp.dps = prec are the truest
# reference for CE's BigDecimal ops. mpmath is BINARY and always-normalized, so
# the decimal-only bookkeeping ops (round-to-decimal-precision / normalize /
# decimal cmp) have NO faithful analog and are reported N/A.
#
#   ./venv/bin/python3 benchmarks/big-decimal/ops-bench.py <prec> [budgetMs]
#
# Prints one JSON line: {label, prec, rows:[{op, unit, perOp}]}. Same warm /
# distinct-cost-bounded-arg / time-budget / median-of-N discipline as the .mjs.
import sys, json, time, random
import mpmath

prec = int(sys.argv[1])
budget_s = (float(sys.argv[2]) if len(sys.argv) > 2 else 200.0) / 1000.0
REPEATS = 5
POOL = 64
mpmath.mp.dps = prec  # process-global working precision, set once

rng = random.Random(0xC0FFEE ^ prec)

def mkP():  # p-digit mpf in [1,10)
    s = str(1 + rng.randrange(9)) + '.' + ''.join(str(rng.randrange(10)) for _ in range(prec - 1))
    return mpmath.mpf(s)

def mkSmall():  # p-digit mpf in [0,2)
    s = str(rng.randrange(2)) + '.' + ''.join(str(rng.randrange(10)) for _ in range(prec - 1))
    return mpmath.mpf(s)

poolA = [mkP() for _ in range(POOL)]
poolB = [mkP() for _ in range(POOL)]
poolC = [mkSmall() for _ in range(POOL)]

MASK = POOL - 1
OPS = {
    'add':   lambda i: poolA[i] + poolB[i],
    'sub':   lambda i: poolA[i] - poolB[i],
    'mul':   lambda i: poolA[i] * poolB[i],
    'div':   lambda i: poolA[i] / poolB[i],
    'sqrt':  lambda i: mpmath.sqrt(poolA[i]),
    'ln':    lambda i: mpmath.log(poolA[i]),
    'exp':   lambda i: mpmath.exp(poolC[i]),
    'cos':   lambda i: mpmath.cos(poolC[i]),
    'zeta3': lambda i: mpmath.zeta(3),  # native (not Apéry) — reference point
}
NA = ['round', 'normalize', 'cmp']  # no faithful mpmath analog

def once(fn):
    for i in range(50):
        fn(i & MASK)  # warm
    n = 0
    t0 = time.perf_counter()
    while True:
        fn(n & MASK)
        n += 1
        if (n & 31) == 0 and time.perf_counter() - t0 >= budget_s:
            break
    return (time.perf_counter() - t0) / n * 1e9  # ns/op

rows = []
for op, fn in OPS.items():
    try:
        samples = sorted(once(fn) for _ in range(REPEATS))
        ns = samples[len(samples) // 2]
        rows.append({'op': op, 'unit': 'ns/op', 'perOp': round(ns, 1)})
    except Exception:
        rows.append({'op': op, 'unit': 'ns/op', 'perOp': None})
for op in NA:
    rows.append({'op': op, 'unit': 'ns/op', 'perOp': None})

print(json.dumps({'label': 'mpmath', 'prec': prec, 'rows': rows}))
