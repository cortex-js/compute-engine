"""Time high-precision transcendentals for SymPy (.evalf) and raw mpmath, to
compare against the Compute Engine numbers (bignum-compare.mjs). Used to build
BIGNUM-COMPARISON.md.

    python benchmarks/big-decimal/bignum-compare.py

Time-budget method with distinct, cost-bounded arguments (no caching, robust to
load). Prints two JSON lines (sympy, mpmath), matching bignum-compare.mjs."""

import json
import time
import sympy as sp
import mpmath

PRECS = [100, 500, 1000]
BUDGET_S = 0.6


def time_budget(call):
    for c in range(3):
        call(c)  # warmup
    n, c = 0, 3
    t0 = time.perf_counter()
    while True:
        call(c)
        c += 1
        n += 1
        if (n & 7) == 0 and time.perf_counter() - t0 >= BUDGET_S:
            break
    return (time.perf_counter() - t0) / n * 1000.0  # ms/call


SYMPY_OPS = {
    "ln":   lambda c, p: sp.log(c + 2).evalf(p),
    "exp":  lambda c, p: sp.exp(sp.Rational(c + 1, c + 3)).evalf(p),
    "sin":  lambda c, p: sp.sin(sp.Rational(c + 1, c + 3)).evalf(p),
    "cos":  lambda c, p: sp.cos(sp.Rational(c + 1, c + 3)).evalf(p),
    "tan":  lambda c, p: sp.tan(sp.Rational(c + 1, c + 3)).evalf(p),
    "atan": lambda c, p: sp.atan(c + 2).evalf(p),
    "asin": lambda c, p: sp.asin(sp.Rational(c + 1, c + 3)).evalf(p),
    "sqrt": lambda c, p: sp.sqrt(c + 2).evalf(p),
}


def mp_call(fn):
    def run(c, p):
        mpmath.mp.dps = p
        return fn(c)
    return run


MPMATH_OPS = {
    "ln":   mp_call(lambda c: mpmath.log(c + 2)),
    "exp":  mp_call(lambda c: mpmath.exp(mpmath.mpf(c + 1) / (c + 3))),
    "sin":  mp_call(lambda c: mpmath.sin(mpmath.mpf(c + 1) / (c + 3))),
    "cos":  mp_call(lambda c: mpmath.cos(mpmath.mpf(c + 1) / (c + 3))),
    "tan":  mp_call(lambda c: mpmath.tan(mpmath.mpf(c + 1) / (c + 3))),
    "atan": mp_call(lambda c: mpmath.atan(c + 2)),
    "asin": mp_call(lambda c: mpmath.asin(mpmath.mpf(c + 1) / (c + 3))),
    "sqrt": mp_call(lambda c: mpmath.sqrt(c + 2)),
}


def run(label, ops):
    rows = []
    for op, fn in ops.items():
        for p in PRECS:
            try:
                ms = time_budget(lambda c: fn(c, p))
            except Exception:
                ms = float("nan")
            rows.append({"op": op, "prec": p, "perCallMs": ms})
    print(json.dumps({"label": label, "rows": rows}))


run("sympy", SYMPY_OPS)
run("mpmath", MPMATH_OPS)
