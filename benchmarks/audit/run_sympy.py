#!/usr/bin/env python3
"""
SymPy side of the multi-operation audit.

    python run_sympy.py        # processes all cases in audit_cases.json

Runs each case's SymPy operation and emits one JSON line per case with the
result string plus the numeric samples the orchestrator grades against (so CE
and SymPy are scored by identical logic).
"""

import json
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
with open(os.path.join(HERE, "audit_cases.json")) as fh:
    SUITE = json.load(fh)

import sympy
from sympy import (
    symbols, sympify, factor, gcd, expand, simplify, integrate, diff, limit,
    Integral, N, sqrt, sin, cos, exp, Rational, Symbol, oo,
)
from sympy.core.cache import clear_cache

x = symbols("x")
NS = {"x": x, "sqrt": sqrt, "sin": sin, "cos": cos, "exp": exp, "gcd": gcd,
      "Rational": Rational, "oo": oo}


def emit(**kw):
    print(json.dumps({"tool": "sympy", **kw}))


def median(xs):
    s = sorted(xs)
    n = len(s)
    return s[n // 2] if n % 2 else (s[n // 2 - 1] + s[n // 2]) / 2


def timeit(fn):
    clear_cache()
    t = time.perf_counter()
    fn()
    first = (time.perf_counter() - t) * 1000
    iters = min(20, max(1, round(120 / max(first, 0.01))))
    times = []
    for _ in range(iters):
        clear_cache()
        t = time.perf_counter()
        fn()
        times.append((time.perf_counter() - t) * 1000)
    return {"timeMs": median(times), "minMs": min(times)}


def sample(expr_, pts):
    out = []
    for p in pts:
        try:
            out.append(float(N(expr_.subs(x, sympify(p)), 30)))
        except Exception:
            out.append(None)
    return out


for c in SUITE["cases"]:
    cid = c["id"]
    inp = c["sympy"]
    vr = c["verify"]
    op = inp["op"]
    try:
        if op in ("factor", "gcd", "expand", "simplify"):
            src = inp["expr"]
            fns = {"factor": factor, "gcd": (lambda e: e), "expand": expand, "simplify": simplify}
            # gcd is already evaluated by sympify (gcd(...) call); others apply the fn.
            timing = timeit(lambda: (factor if op == "factor" else expand if op == "expand"
                                     else simplify if op == "simplify" else (lambda z: z))(sympify(src, locals=NS)))
            res = sympify(src, locals=NS)
            if op == "factor":
                res = factor(res)
            elif op == "expand":
                res = expand(res)
            elif op == "simplify":
                res = simplify(res)
            vals = sample(res, vr["points"])
            emit(id=cid, status="ok", text=str(res), values=vals, **timing)

        elif op == "integrate":
            timing = timeit(lambda: integrate(sympify(inp["expr"], locals=NS), x))
            F = integrate(sympify(inp["expr"], locals=NS), x)
            if F.has(Integral):
                emit(id=cid, status="unsolved", text=str(F), values=[], **timing)
            else:
                dF = diff(F, x)
                emit(id=cid, status="ok", text=str(F), values=sample(dF, vr["points"]), **timing)

        elif op == "limit":
            pt = sympify(str(inp["point"]), locals=NS)
            timing = timeit(lambda: limit(sympify(inp["expr"], locals=NS), x, pt))
            L = limit(sympify(inp["expr"], locals=NS), x, pt)
            try:
                val = float(N(L, 30))
            except Exception:
                val = None
            emit(id=cid, status="ok", text=str(L), values=[val], **timing)
        else:
            emit(id=cid, status="error", error="unknown op " + op)
    except Exception as e:  # noqa: BLE001
        emit(id=cid, status="error", error=str(e)[:160])
