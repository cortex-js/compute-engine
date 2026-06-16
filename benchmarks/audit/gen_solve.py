#!/usr/bin/env python3
"""
Generate benchmarks/audit/solve_cases.json — a univariate equation-solving
benchmark adapted from SymPy's own `test_solveset.py` suite.

Motivation: the 48-case Wester harness has only a handful of solve cases, and
it grades *completeness* against SymPy's arbitrary root-slices — a harness
artifact for transcendental equations. This benchmark instead:

  - sources its equations from SymPy's solveset test suite (univariate only),
  - grades **soundness** by substituting each returned root into the residual
    (|residual| < tol), a reliable oracle, and
  - grades **completeness** against a *curated* reference, classified by
    cardinality so infinite/empty solution sets are handled honestly:
        finite   → roots must be sound AND cover the reference set
        infinite → roots must be sound; at least one returned (completeness N/A)
        empty    → correct iff no roots returned

Each case carries a CE-mathjson residual (`expr` where `expr = 0`), the SymPy
source expression, SymPy's live solveset(Reals) outcome, and a numeric
reference root set (SymPy exact → evalf, or mpmath findroot for the
transcendental-finite frontier).

Run:  ./venv/bin/python3 benchmarks/audit/gen_solve.py
"""

import json
import os

import sympy as sp
from sympy import S, symbols, solveset, FiniteSet, nsimplify
from sympy import sqrt, exp, log, Abs, sin, cos, tan, sinh, cosh, tanh
import mpmath

x = symbols("x", real=True)
mpmath.mp.dps = 30

# --- curated univariate equations, by category, sourced from test_solveset.py
# Each row: (id, cat, title, ce_mathjson_residual, sympy_expr, [findroot seeds])
# `seeds` (optional) lets us recover numeric real roots for transcendental
# equations solveset can't finitely solve (the frontier).
CASES = [
    # ---- polynomial -------------------------------------------------------
    ("P1", "poly", "3x − 2 = 0",
     ["Subtract", ["Multiply", 3, "x"], 2], 3 * x - 2, None),
    ("P2", "poly", "x² − 1 = 0",
     ["Subtract", ["Power", "x", 2], 1], x**2 - 1, None),
    ("P3", "poly", "x² − 5x + 6 = 0",
     ["Add", ["Subtract", ["Power", "x", 2], ["Multiply", 5, "x"]], 6],
     x**2 - 5 * x + 6, None),
    ("P4", "poly", "x³ − 6x² + 11x − 6 = 0",
     ["Add", ["Subtract", ["Add", ["Power", "x", 3],
                           ["Multiply", 11, "x"]],
              ["Multiply", 6, ["Power", "x", 2]]], -6],
     x**3 - 6 * x**2 + 11 * x - 6, None),
    ("P5", "poly", "x³ − 15x − 4 = 0",
     ["Subtract", ["Subtract", ["Power", "x", 3], ["Multiply", 15, "x"]], 4],
     x**3 - 15 * x - 4, None),
    ("P6", "poly", "x⁴ − 5x² + 4 = 0",
     ["Add", ["Subtract", ["Power", "x", 4], ["Multiply", 5, ["Power", "x", 2]]], 4],
     x**4 - 5 * x**2 + 4, None),
    ("P7", "poly", "x⁵ + x³ + 1 = 0",
     ["Add", ["Add", ["Power", "x", 5], ["Power", "x", 3]], 1],
     x**5 + x**3 + 1, None),

    # ---- rational ---------------------------------------------------------
    ("R1", "rational", "1/x + 1 = 0",
     ["Add", ["Divide", 1, "x"], 1], 1 / x + 1, None),
    ("R2", "rational", "2x/(x+2) − 1 = 0",
     ["Subtract", ["Divide", ["Multiply", 2, "x"], ["Add", "x", 2]], 1],
     2 * x / (x + 2) - 1, None),
    ("R3", "rational", "3/(x−2) − 1 = 0",
     ["Subtract", ["Divide", 3, ["Subtract", "x", 2]], 1],
     3 / (x - 2) - 1, None),

    # ---- radical ----------------------------------------------------------
    ("S1", "radical", "√x − 2 = 0",
     ["Subtract", ["Sqrt", "x"], 2], sqrt(x) - 2, None),
    ("S2", "radical", "√(5x+6) − 2 − x = 0",
     ["Subtract", ["Subtract", ["Sqrt", ["Add", ["Multiply", 5, "x"], 6]], 2], "x"],
     sqrt(5 * x + 6) - 2 - x, None),
    ("S3", "radical", "√(x−1) − x + 7 = 0",
     ["Add", ["Subtract", ["Sqrt", ["Subtract", "x", 1]], "x"], 7],
     sqrt(x - 1) - x + 7, None),
    ("S4", "radical", "√(x−2) − 5 = 0",
     ["Subtract", ["Sqrt", ["Subtract", "x", 2]], 5], sqrt(x - 2) - 5, None),
    ("S5", "radical", "∛x − 3 = 0",
     ["Subtract", ["Root", "x", 3], 3], x**sp.Rational(1, 3) - 3, None),

    # ---- abs --------------------------------------------------------------
    ("A1", "abs", "|x| − 2 = 0",
     ["Subtract", ["Abs", "x"], 2], Abs(x) - 2, None),
    ("A2", "abs", "|x+3| − 2|x−3| = 0",
     ["Subtract", ["Abs", ["Add", "x", 3]], ["Multiply", 2, ["Abs", ["Subtract", "x", 3]]]],
     Abs(x + 3) - 2 * Abs(x - 3), None),
    ("A3", "abs", "2|x| − |x−1| = 0",
     ["Subtract", ["Multiply", 2, ["Abs", "x"]], ["Abs", ["Subtract", "x", 1]]],
     2 * Abs(x) - Abs(x - 1), None),
    ("A4", "abs", "|2x+1| − 3 = 0",
     ["Subtract", ["Abs", ["Add", ["Multiply", 2, "x"], 1]], 3],
     Abs(2 * x + 1) - 3, None),

    # ---- exponential ------------------------------------------------------
    ("E1", "exp", "2ˣ − 8 = 0",
     ["Subtract", ["Power", 2, "x"], 8], 2**x - 8, None),
    ("E2", "exp", "eˣ − 5 = 0",
     ["Subtract", ["Exp", "x"], 5], exp(x) - 5, None),
    ("E3", "exp", "eˣ + e⁻ˣ − 4 = 0",
     ["Subtract", ["Add", ["Exp", "x"], ["Exp", ["Negate", "x"]]], 4],
     exp(x) + exp(-x) - 4, None),
    ("E4", "exp", "3·2ˣ − 24 = 0",
     ["Subtract", ["Multiply", 3, ["Power", 2, "x"]], 24], 3 * 2**x - 24, None),

    # ---- logarithmic ------------------------------------------------------
    ("L1", "log", "ln x − 2 = 0",
     ["Subtract", ["Ln", "x"], 2], log(x) - 2, None),
    ("L2", "log", "ln((x−1)(x+1)) = 0",
     ["Ln", ["Multiply", ["Subtract", "x", 1], ["Add", "x", 1]]],
     log((x - 1) * (x + 1)), None),
    ("L3", "log", "log₂ x − 3 = 0",
     ["Subtract", ["Log", "x", 2], 3], log(x) / log(2) - 3, None),

    # ---- LambertW (Fungrim solve templates) -------------------------------
    ("W1", "lambert", "x·eˣ − 1 = 0",
     ["Subtract", ["Multiply", "x", ["Exp", "x"]], 1], x * exp(x) - 1, None),
    ("W2", "lambert", "eˣ + x = 0",
     ["Add", ["Exp", "x"], "x"], exp(x) + x, None),
    ("W3", "lambert", "x + 2ˣ = 0",
     ["Add", "x", ["Power", 2, "x"]], x + 2**x, None),
    ("W4", "lambert", "x·eˣ − 3 = 0",
     ["Subtract", ["Multiply", "x", ["Exp", "x"]], 3], x * exp(x) - 3, None),

    # ---- inverse-trig / trig (Fungrim) ------------------------------------
    ("T1", "trig", "arctan x − 1/2 = 0",
     ["Subtract", ["Arctan", "x"], ["Divide", 1, 2]],
     sp.atan(x) - sp.Rational(1, 2), None),
    ("T2", "trig", "arcsin x − 1/3 = 0",
     ["Subtract", ["Arcsin", "x"], ["Divide", 1, 3]],
     sp.asin(x) - sp.Rational(1, 3), None),
    ("T3", "trig", "sin x − 1/2 = 0 (infinite)",
     ["Subtract", ["Sin", "x"], ["Divide", 1, 2]], sin(x) - sp.Rational(1, 2), None),
    ("T4", "trig", "2cos x − 1 = 0 (infinite)",
     ["Subtract", ["Multiply", 2, ["Cos", "x"]], 1], 2 * cos(x) - 1, None),

    # ---- hyperbolic (Fungrim) ---------------------------------------------
    ("H1", "hyperbolic", "sinh x − 1 = 0",
     ["Subtract", ["Sinh", "x"], 1], sinh(x) - 1, None),
    ("H2", "hyperbolic", "cosh x − 2 = 0",
     ["Subtract", ["Cosh", "x"], 2], cosh(x) - 2, None),
    ("H3", "hyperbolic", "tanh x − 1/2 = 0",
     ["Subtract", ["Tanh", "x"], ["Divide", 1, 2]], tanh(x) - sp.Rational(1, 2), None),

    # ---- transcendental frontier (no closed form; numeric ref via mpmath) -
    ("FR1", "frontier", "x − cos x = 0 (Dottie)",
     ["Subtract", "x", ["Cos", "x"]], x - cos(x), [0.7]),
    ("FR2", "frontier", "eˣ − x − 2 = 0",
     ["Subtract", ["Subtract", ["Exp", "x"], "x"], 2], exp(x) - x - 2, [-2.0, 1.2]),
    ("FR3", "frontier", "x² − cos x = 0",
     ["Subtract", ["Power", "x", 2], ["Cos", "x"]], x**2 - cos(x), [-0.9, 0.9]),
]


def real_numeric_roots(roots_iter):
    """Evalf an iterable of SymPy roots → sorted unique real numeric strings."""
    out = []
    for r in roots_iter:
        try:
            v = complex(r.evalf())
            if abs(v.imag) < 1e-12:
                out.append(mpmath.nstr(mpmath.mpf(v.real), 24))
        except Exception:
            pass
    return sorted(set(out), key=float)


def solve_real_roots(expr):
    """SymPy's most capable solver (`solve`, which handles LambertW etc.),
    reduced to real numeric roots. Returns None if it cannot solve."""
    try:
        sols = sp.solve(expr, x)
    except Exception:
        return None
    if sols is None:
        return None
    real = []
    for r in sols:
        if r.free_symbols:  # symbolic-parameter root — not numerically gradeable
            continue
        real.append(r)
    return real_numeric_roots(real)


def classify(expr, seeds):
    """Return (cardinality, roots[]) for the real solution set of expr = 0.

    Cardinality comes from `solveset` (the only API that distinguishes a finite
    set from a periodic ImageSet); reference roots come from `solve` (more
    capable for transcendental closed forms) or mpmath for the frontier.
    """
    # Frontier: mpmath-recovered numeric roots (solve has no closed form).
    if seeds is not None:
        roots = []
        for s0 in seeds:
            try:
                r = mpmath.findroot(lambda v: complex(expr.subs(x, v)), s0)
                if abs(r.imag) < 1e-18:
                    roots.append(mpmath.nstr(r.real, 24))
            except Exception:
                pass
        return ("finite", sorted(set(roots), key=float))

    try:
        sol = solveset(expr, x, domain=S.Reals)
    except Exception:
        sol = None

    if sol is S.EmptySet:
        return ("empty", [])
    # Periodic infinite real solution set (trig): completeness is N/A.
    if sol is not None and (sol.has(sp.ImageSet) or "ImageSet" in type(sol).__name__):
        return ("infinite", [])

    # Finite set, or a ConditionSet solveset couldn't close — reference roots
    # from the capable solver.
    roots = solve_real_roots(expr)
    if isinstance(sol, FiniteSet):
        if not roots:
            roots = real_numeric_roots(list(sol))
        return ("finite", roots)
    if roots:  # ConditionSet but solve() found a finite real closed form
        return ("finite", roots)
    return ("unknown", [])


def sympy_solve(expr):
    """SymPy comparator outcome, using its most capable solver (`solve`).

    Returns {status, roots[]}: status ∈ {ok, unsolved}.
    """
    roots = solve_real_roots(expr)
    if roots:
        return {"status": "ok", "roots": roots}
    return {"status": "unsolved", "roots": []}


out = []
dropped = []
for cid, cat, title, ce, sy, seeds in CASES:
    card, roots = classify(sy, seeds)
    if card == "unknown":
        dropped.append((cid, title))
        continue
    out.append({
        "id": cid,
        "cat": cat,
        "title": title,
        "ce": {"op": "solve", "var": "x", "mathjson": ce},
        "sympy": {"expr": str(sy), "result": sympy_solve(sy)},
        "verify": {"kind": "roots", "cardinality": card, "roots": roots},
    })

here = os.path.dirname(os.path.abspath(__file__))
with open(os.path.join(here, "solve_cases.json"), "w") as f:
    json.dump(out, f, indent=1)

by_cat = {}
for c in out:
    by_cat[c["cat"]] = by_cat.get(c["cat"], 0) + 1
print(f"Wrote {len(out)} cases to solve_cases.json")
print("  by category:", by_cat)
print("  cardinality:", {k: sum(1 for c in out if c['verify']['cardinality'] == k)
                         for k in ('finite', 'infinite', 'empty')})
if dropped:
    print(f"  dropped {len(dropped)} (unclassifiable):", [d[0] for d in dropped])
