#!/usr/bin/env python3
"""
SymPy / NumPy benchmark runner.

    python run_py.py <tool> <case-id>      tool = sympy | numpy

Runs one case from ../cases.json and prints ONE line of JSON, matching the
shape produced by run_ce.mjs / run_mathjs.mjs so the orchestrator can treat
every tool uniformly.

  - sympy : arbitrary-precision N(), simplify(), diff(), integrate()
  - numpy : numeric evaluation only (double precision); no symbolic ops, so
            simplify/derivative/antiderivative cases are `unsupported`.

One case per process keeps a hang or crash isolated; the orchestrator spawns
us with a hard timeout.
"""

import json
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
with open(os.path.join(HERE, "..", "cases.json")) as fh:
    SUITE = json.load(fh)

TOOL = sys.argv[1]
CASE_ID = sys.argv[2]
KASE = next((c for c in SUITE["cases"] if c["id"] == CASE_ID), None)


def emit(**kw):
    print(json.dumps({"id": CASE_ID, "tool": TOOL, **kw}))


if KASE is None:
    emit(status="error", error="unknown case")
    sys.exit(0)


def median(xs):
    s = sorted(xs)
    n = len(s)
    return s[n // 2] if n % 2 else (s[n // 2 - 1] + s[n // 2]) / 2


def timeit(fn, reset=None):
    # `reset` (if given) runs UNTIMED before each iteration — used to clear
    # SymPy's global cache so every timed iteration does real work from source,
    # consistent with how the other tools rebuild from source each call.
    if reset:
        reset()
    t = time.perf_counter()
    fn()
    first = (time.perf_counter() - t) * 1000
    iterations = min(50, max(1, round(150 / max(first, 0.01))))
    for _ in range(min(3, iterations)):
        if reset:
            reset()
        fn()
    times = []
    for _ in range(iterations):
        if reset:
            reset()
        t = time.perf_counter()
        fn()
        times.append((time.perf_counter() - t) * 1000)
    return {"timeMs": median(times), "minMs": min(times), "iterations": iterations}


# --------------------------------------------------------------------------- #
def run_sympy():
    import sympy
    from sympy import (
        symbols, sympify, simplify, diff, integrate, Integral, N,
        sqrt, log, exp, sin, cos, tan, atan, asin, pi, E, factorial, root,
        Rational, zeta, gamma, LambertW,
    )
    from sympy.core.cache import clear_cache

    # Sample points are all positive, so declaring x positive lets SymPy apply
    # simplifications valid on that domain (e.g. log(exp(x)) -> x) — consistent
    # with how every tool is verified.
    x = symbols("x", positive=True)
    ns = {
        "x": x, "sqrt": sqrt, "log": log, "exp": exp, "sin": sin, "cos": cos,
        "tan": tan, "atan": atan, "asin": asin, "pi": pi, "E": E,
        "factorial": factorial, "root": root, "Rational": Rational,
        "zeta": zeta, "gamma": gamma, "LambertW": LambertW,
    }
    inp = KASE["inputs"]["sympy"]
    if inp is None:
        emit(status="unsupported")
        return

    src = inp["expr"]
    expr = sympify(src, locals=ns)
    op = inp["op"]
    # Timed bodies re-parse from source each call (with the cache cleared by
    # `reset`) so the cost includes the work SymPy does at sympify time — some
    # inputs (factorial, exp(log(x)), 2/x+3/x) are evaluated during parsing.
    parse = lambda: sympify(src, locals=ns)

    if op == "N":
        if KASE["verify"]["kind"] == "integer":
            timing = timeit(lambda: int(parse()), reset=clear_cache)
            emit(status="ok", text=str(int(expr)), valueText=str(int(expr)), values=[], **timing)
        else:
            p = inp["precision"]
            timing = timeit(lambda: N(parse(), p), reset=clear_cache)
            r = N(expr, p)
            emit(status="ok", text=str(r), valueText=str(r), values=[], **timing)

    elif op == "simplify":
        timing = timeit(lambda: simplify(parse()), reset=clear_cache)
        result = simplify(expr)
        pts = [float(v) for v in KASE["verify"]["points"]]
        values = [float(result.subs(x, p).evalf(30)) for p in pts]
        # Baseline for "did simplify change anything?" must be the UN-evaluated
        # form — SymPy auto-simplifies some inputs at parse time (e.g.
        # 2/x + 3/x -> 5/x, exp(log(x)) -> x), which would otherwise make a
        # successful simplification look like a no-op.
        raw = sympify(inp["expr"], locals=ns, evaluate=False)
        emit(status="ok", text=str(result), inputText=str(raw), values=values, **timing)

    elif op == "diff":
        timing = timeit(lambda: diff(parse(), x), reset=clear_cache)
        result = diff(expr, x)
        pts = [float(v) for v in KASE["verify"]["points"]]
        values = [float(result.subs(x, p).evalf(30)) for p in pts]
        emit(status="ok", text=str(result), values=values, **timing)

    elif op == "integrate":
        timing = timeit(lambda: integrate(parse(), x), reset=clear_cache)
        result = integrate(expr, x)
        if result.has(Integral):
            emit(status="unevaluated", text=str(result), values=[], **timing)
        else:
            a = float(KASE["verify"]["a"])
            b = float(KASE["verify"]["b"])
            fb = float(result.subs(x, b).evalf(30))
            fa = float(result.subs(x, a).evalf(30))
            emit(status="ok", text=str(result), values=[fb - fa], **timing)
    else:
        emit(status="error", error="unknown op " + op)


# --------------------------------------------------------------------------- #
def run_numpy():
    import numpy as np

    inp = KASE["inputs"]["numpy"]
    if inp is None:
        emit(status="unsupported", reason="NumPy has no symbolic algebra")
        return

    timing = timeit(lambda: eval(inp["expr"], {"np": np}))
    val = eval(inp["expr"], {"np": np})
    val = float(val)
    if not np.isfinite(val):
        emit(status="overflow", text=repr(val), valueText=repr(val), values=[], **timing)
    else:
        # repr() of a float64 round-trips to full ~17 significant digits.
        emit(status="ok", text=repr(val), valueText=repr(val), values=[], **timing)


if TOOL == "sympy":
    try:
        run_sympy()
    except Exception as e:  # noqa: BLE001
        emit(status="error", error=str(e))
elif TOOL == "numpy":
    try:
        run_numpy()
    except Exception as e:  # noqa: BLE001
        emit(status="error", error=str(e))
else:
    emit(status="error", error="unknown tool " + TOOL)
