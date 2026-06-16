#!/usr/bin/env python3
"""
Generate benchmarks/audit/audit_cases.json — a multi-operation CE-vs-SymPy
audit suite (the "issue-finder").

Unlike the cross-tool benchmark (which is broad across libraries but shallow),
this is deep on Compute Engine vs the strongest symbolic competitor (SymPy),
across *several* operations — factoring, polynomial GCD, expansion,
simplification, integration, limits — to surface where CE trails.

Each case carries per-tool inputs and an mpmath-computed reference so both
tools are graded identically:
  - equiv      : the result must be value-equal to a reference function
                 (factor/expand/simplify preserve value; gcd → the true gcd).
                 A `form` tag adds a quality check on the result's shape.
  - derivcheck : integration — d/dx(result) must equal the integrand.
  - value      : limits — the result must equal a known scalar.

Run:  python benchmarks/audit/gen.py
"""

import json
import os
from mpmath import mp, mpf, sqrt, sin, cos, exp

mp.dps = 40
P = [mpf("1.5"), mpf("2.3"), mpf("3.7")]  # sample points: > 0, off roots of unity


def s(x):
    return mp.nstr(x, 30, strip_zeros=False)


def samples(f):
    return [s(f(p)) for p in P]


CASES = []


def add(**k):
    CASES.append(k)


# Each case carries a hand-authored `latex` (the formula exactly as it should
# typeset in the report) alongside the Unicode `title`. The report renders
# `latex`; `title` stays as a terse plain-text label.

# ---- Factoring (form must stay polynomial: no √/|·|/fractional powers) ----
for cid, title, latex, ce, sy, f in [
    ("F1", "x² − 1", "x^2 - 1", ["Subtract", ["Power", "x", 2], 1], "x**2 - 1", lambda x: x**2 - 1),
    ("F2", "x³ − 1", "x^3 - 1", ["Subtract", ["Power", "x", 3], 1], "x**3 - 1", lambda x: x**3 - 1),
    ("F3", "x⁴ − 1", "x^4 - 1", ["Subtract", ["Power", "x", 4], 1], "x**4 - 1", lambda x: x**4 - 1),
    ("F4", "x⁶ − 1", "x^6 - 1", ["Subtract", ["Power", "x", 6], 1], "x**6 - 1", lambda x: x**6 - 1),
    ("F5", "x⁷ − 1", "x^7 - 1", ["Subtract", ["Power", "x", 7], 1], "x**7 - 1", lambda x: x**7 - 1),
]:
    add(id=cid, cat="factor", title=title, latex=latex,
        ce={"op": "factor", "mathjson": ce}, sympy={"op": "factor", "expr": sy},
        verify={"kind": "equiv", "form": "polynomial", "points": [s(p) for p in P], "values": samples(f)})

# ---- Polynomial GCD (result must equal the true gcd) ----
for cid, title, latex, ce, sy, g in [
    ("G1", "gcd((x+1)(x+2), (x+1)(x+3))", r"\gcd\bigl((x+1)(x+2),\ (x+1)(x+3)\bigr)",
     ["GCD", ["Multiply", ["Add", "x", 1], ["Add", "x", 2]], ["Multiply", ["Add", "x", 1], ["Add", "x", 3]]],
     "gcd((x+1)*(x+2), (x+1)*(x+3))", lambda x: x + 1),
    ("G2", "gcd(x²−1, x²+2x+1)", r"\gcd(x^2-1,\ x^2+2x+1)",
     ["GCD", ["Subtract", ["Power", "x", 2], 1], ["Add", ["Power", "x", 2], ["Multiply", 2, "x"], 1]],
     "gcd(x**2 - 1, x**2 + 2*x + 1)", lambda x: x + 1),
    ("G3", "gcd(x³−1, x²−1)", r"\gcd(x^3-1,\ x^2-1)",
     ["GCD", ["Subtract", ["Power", "x", 3], 1], ["Subtract", ["Power", "x", 2], 1]],
     "gcd(x**3 - 1, x**2 - 1)", lambda x: x - 1),
]:
    add(id=cid, cat="gcd", title=title, latex=latex,
        ce={"op": "gcd", "mathjson": ce}, sympy={"op": "gcd", "expr": sy},
        verify={"kind": "equiv", "form": None, "points": [s(p) for p in P], "values": samples(g)})

# ---- Expansion (form must be expanded: no remaining grouped power) ----
for cid, title, latex, ce, sy, f in [
    ("E1", "(x+1)⁵", "(x+1)^5", ["Power", ["Add", "x", 1], 5], "(x + 1)**5", lambda x: (x + 1) ** 5),
    ("E2", "(x+2)⁴", "(x+2)^4", ["Power", ["Add", "x", 2], 4], "(x + 2)**4", lambda x: (x + 2) ** 4),
    ("E3", "(x−1)⁶", "(x-1)^6", ["Power", ["Subtract", "x", 1], 6], "(x - 1)**6", lambda x: (x - 1) ** 6),
]:
    add(id=cid, cat="expand", title=title, latex=latex,
        ce={"op": "expand", "mathjson": ce}, sympy={"op": "expand", "expr": sy},
        verify={"kind": "equiv", "form": "expanded", "points": [s(p) for p in P], "values": samples(f)})

# ---- Simplification ----
for cid, title, latex, ce, sy, f in [
    ("S1", "(x²−1)/(x−1)", r"\frac{x^2-1}{x-1}", ["Divide", ["Subtract", ["Power", "x", 2], 1], ["Subtract", "x", 1]],
     "(x**2 - 1)/(x - 1)", lambda x: (x**2 - 1) / (x - 1)),
    ("S2", "(x³−1)/(x−1)", r"\frac{x^3-1}{x-1}", ["Divide", ["Subtract", ["Power", "x", 3], 1], ["Subtract", "x", 1]],
     "(x**3 - 1)/(x - 1)", lambda x: (x**3 - 1) / (x - 1)),
    ("S3", "x^(−1/2) − 1/√x", r"x^{-1/2} - \frac{1}{\sqrt{x}}",
     ["Subtract", ["Power", "x", ["Divide", -1, 2]], ["Divide", 1, ["Sqrt", "x"]]],
     "x**Rational(-1,2) - 1/sqrt(x)", lambda x: x ** (mpf(-1) / 2) - 1 / sqrt(x)),
]:
    add(id=cid, cat="simplify", title=title, latex=latex,
        ce={"op": "simplify", "mathjson": ce}, sympy={"op": "simplify", "expr": sy},
        verify={"kind": "equiv", "form": "simplified", "points": [s(p) for p in P], "values": samples(f)})

# ---- Integration (d/dx result must equal the integrand) ----
for cid, title, latex, ce, sy, f in [
    ("I1", "∫ x² dx", r"\int x^2\,dx", ["Power", "x", 2], "x**2", lambda x: x**2),
    ("I2", "∫ 1/(1+x²) dx", r"\int \frac{1}{1+x^2}\,dx", ["Divide", 1, ["Add", 1, ["Power", "x", 2]]], "1/(1 + x**2)", lambda x: 1 / (1 + x**2)),
    ("I3", "∫ 1/√x dx", r"\int \frac{1}{\sqrt{x}}\,dx", ["Divide", 1, ["Sqrt", "x"]], "1/sqrt(x)", lambda x: 1 / sqrt(x)),
    ("I4", "∫ e^(−x²) dx", r"\int e^{-x^2}\,dx", ["Power", "ExponentialE", ["Negate", ["Power", "x", 2]]], "exp(-x**2)", lambda x: exp(-x**2)),
    ("I5", "∫ 1/(x³+1) dx", r"\int \frac{1}{x^3+1}\,dx", ["Divide", 1, ["Add", ["Power", "x", 3], 1]], "1/(x**3 + 1)", lambda x: 1 / (x**3 + 1)),
]:
    add(id=cid, cat="integrate", title=title, latex=latex,
        ce={"op": "integrate", "mathjson": ce, "var": "x"}, sympy={"op": "integrate", "expr": sy, "var": "x"},
        verify={"kind": "derivcheck", "points": [s(p) for p in P], "values": samples(f)})

# ---- Limits ----
for cid, title, latex, body, point, sy, val in [
    ("L1", "lim_{x→0} sin x / x", r"\lim_{x \to 0} \frac{\sin x}{x}", ["Divide", ["Sin", "x"], "x"], 0, "sin(x)/x", mpf(1)),
    ("L2", "lim_{x→0} (1−cos x)/x²", r"\lim_{x \to 0} \frac{1-\cos x}{x^2}", ["Divide", ["Subtract", 1, ["Cos", "x"]], ["Power", "x", 2]], 0, "(1 - cos(x))/x**2", mpf(1) / 2),
    ("L3", "lim_{x→1} (x²−1)/(x−1)", r"\lim_{x \to 1} \frac{x^2-1}{x-1}", ["Divide", ["Subtract", ["Power", "x", 2], 1], ["Subtract", "x", 1]], 1, "(x**2 - 1)/(x - 1)", mpf(2)),
]:
    add(id=cid, cat="limit", title=title, latex=latex,
        ce={"op": "limit", "mathjson": body, "var": "x", "point": point},
        sympy={"op": "limit", "expr": sy, "var": "x", "point": point},
        verify={"kind": "value", "value": s(val)})


if __name__ == "__main__":
    out = os.path.join(os.path.dirname(__file__), "audit_cases.json")
    data = {"points": [s(p) for p in P],
            "categories": ["factor", "gcd", "expand", "simplify", "integrate", "limit"],
            "cases": CASES}
    with open(out, "w") as fh:
        json.dump(data, fh, indent=2)
    by = {}
    for c in CASES:
        by[c["cat"]] = by.get(c["cat"], 0) + 1
    print(f"Wrote {len(CASES)} cases to {out}")
    print("  " + ", ".join(f"{k}:{v}" for k, v in by.items()))
