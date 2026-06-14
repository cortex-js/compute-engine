#!/usr/bin/env python3
"""
SymPy side of the Wester audit. Reads a JSON task file (written by wester.ts):

    python run_sympy_wester.py <tasks.json>

Each task: {id, op, expr, var, points, point?, a?, b?}. Runs the SymPy
operation and emits the numeric samples wester.ts grades against (so CE and
SymPy are scored identically):
  - integrate : emit d/dx(result) sampled at `points` (vs the integrand)
  - diff      : emit result sampled at `points` (vs central-difference ref)
  - defint    : emit [result value]            (vs Simpson quadrature ref)
  - limit     : emit [result value]            (vs near-point ref)
  - factor/expand/simplify/...: emit result sampled at `points` (vs input)
"""

import json
import sys
import time

from sympy import (
    sympify, factor, expand, simplify, together, apart, integrate, diff, limit,
    N, symbols, sqrt, Abs, sin, cos, tan, cot, sec, csc, exp, log, asin, acos,
    atan, sinh, cosh, tanh, pi, E, Rational, Integral, oo,
)

NS = {
    "sqrt": sqrt, "Abs": Abs, "sin": sin, "cos": cos, "tan": tan, "cot": cot,
    "sec": sec, "csc": csc, "exp": exp, "log": log, "asin": asin, "acos": acos,
    "atan": atan, "sinh": sinh, "cosh": cosh, "tanh": tanh, "pi": pi, "E": E,
    "Rational": Rational,
}
TRANSFORMS = {"factor": factor, "expand": expand, "simplify": simplify,
              "together": together, "apart": apart}


def pt(x):
    if x == "PositiveInfinity":
        return oo
    if x == "NegativeInfinity":
        return -oo
    return float(x)


def sample(e, var, pts):
    v = symbols(var, real=True)  # must match the (real) symbol used to build `e`
    out = []
    for p in pts:
        try:
            out.append(float(N(e.subs(v, float(p)), 25)))
        except Exception:
            out.append(None)
    return out


def main():
    tasks = json.load(open(sys.argv[1]))
    for t in tasks:
        cid, op, src, var, pts = t["id"], t["op"], t["expr"], t.get("var", "x"), t["points"]
        try:
            v = symbols(var, real=True)  # Wester tests are real-variable (fixes diff(Abs(x)) etc.)
            ns = dict(NS); ns[var] = v
            e = sympify(src, locals=ns)
            t0 = time.perf_counter()
            if op == "integrate":
                F = integrate(e, v); ms = (time.perf_counter() - t0) * 1000
                if F.has(Integral):
                    print(json.dumps({"id": cid, "status": "unsolved", "text": str(F), "values": [], "timeMs": ms}))
                else:
                    print(json.dumps({"id": cid, "status": "ok", "text": str(F), "values": sample(diff(F, v), var, pts), "timeMs": ms}))
            elif op == "diff":
                r = diff(e, v); ms = (time.perf_counter() - t0) * 1000
                print(json.dumps({"id": cid, "status": "ok", "text": str(r), "values": sample(r, var, pts), "timeMs": ms}))
            elif op == "defint":
                F = integrate(e, (v, pt(t["a"]), pt(t["b"]))); ms = (time.perf_counter() - t0) * 1000
                if F.has(Integral):
                    print(json.dumps({"id": cid, "status": "unsolved", "text": str(F), "values": [], "timeMs": ms}))
                else:
                    try:
                        val = float(N(F, 25))
                        print(json.dumps({"id": cid, "status": "ok", "text": str(F), "values": [val], "timeMs": ms}))
                    except Exception:
                        print(json.dumps({"id": cid, "status": "unsolved", "text": str(F), "values": [], "timeMs": ms}))
            elif op == "limit":
                L = limit(e, v, pt(t["point"])); ms = (time.perf_counter() - t0) * 1000
                try:
                    val = float(N(L, 25))
                    print(json.dumps({"id": cid, "status": "ok", "text": str(L), "values": [val], "timeMs": ms}))
                except Exception:
                    print(json.dumps({"id": cid, "status": "unsolved", "text": str(L), "values": [], "timeMs": ms}))
            elif op in TRANSFORMS:
                r = TRANSFORMS[op](e); ms = (time.perf_counter() - t0) * 1000
                print(json.dumps({"id": cid, "status": "ok", "text": str(r), "values": sample(r, var, pts), "timeMs": ms}))
            else:
                print(json.dumps({"id": cid, "status": "error", "error": "unknown op " + op}))
        except Exception as ex:  # noqa: BLE001
            print(json.dumps({"id": cid, "status": "error", "error": str(ex)[:160]}))


if __name__ == "__main__":
    main()
