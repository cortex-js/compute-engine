#!/usr/bin/env python3
"""
Generate benchmarks/cases.json — the language-neutral benchmark suite.

Two tiers across four capabilities (numeric / simplify / derivative /
antiderivative):

  - **core**  — textbook cases every mature tool should handle. A baseline that
                shows parity (and catches regressions).
  - **hard**  — boundary-pushers chosen to separate the libraries and to
                exercise the recently-fixed Compute Engine paths (radical-
                coefficient factoring, ∫ of algebraic/radical forms,
                special-function numerics).

Each case carries per-tool input expressions and a `verify` block whose
reference values are computed *here* with `mpmath` at high precision — never
taken from a tool under test. Reference values derive from one `f` per case:
  - numeric        -> the constant itself
  - simplify       -> f(p)                 (simplification preserves value)
  - derivative     -> f'(p)  via mp.diff
  - antiderivative -> ∫_a^b f  via mp.quad (constant of integration cancels)

Run:  python benchmarks/gen_cases.py
"""

import json
import math
import os
from mpmath import (
    mp, mpf, pi, e, sqrt, log, sin, cos, tan, exp, atan, asin, factorial,
    diff, quad, cbrt, zeta, gamma, lambertw,
)

mp.dps = 230  # enough for the 200-digit numeric case + guard digits

DEF_POINTS = [mpf("0.37"), mpf("1.93"), mpf("2.71")]          # > 0, off singularities
UNIT_POINTS = [mpf("0.13"), mpf("0.41"), mpf("0.67")]         # inside (-1, 1)
DEF_INTERVAL = (mpf("0.5"), mpf("2.3"))
UNIT_INTERVAL = (mpf("0.1"), mpf("0.8"))                      # inside (-1, 1)


def dec(x, n):
    return mp.nstr(x, n, strip_zeros=False)


# Each case is a dict. `f` is the original function (mpmath). `inputs` gives the
# per-tool expression; `None` means the tool can't express/do it.
CASES = [
    # ---------------- NUMERIC · core ----------------
    dict(id="N01", cat="numeric", tier="core", title="π", latex=r"\pi", prec=50,
         f=lambda: pi, ce="Pi", sympy="pi", mathjs="pi", numpy="np.pi"),
    dict(id="N02", cat="numeric", tier="core", title="e", latex="e", prec=50,
         f=lambda: e, ce="ExponentialE", sympy="E", mathjs="e", numpy="np.e"),
    dict(id="N03", cat="numeric", tier="core", title="√2", latex=r"\sqrt2", prec=50,
         f=lambda: sqrt(2), ce=["Sqrt", 2], sympy="sqrt(2)", mathjs="sqrt(2)", numpy="np.sqrt(2)"),
    dict(id="N04", cat="numeric", tier="core", title="100!", latex="100!", prec=0, integer=True,
         f=lambda: math.factorial(100), ce=["Factorial", 100], sympy="factorial(100)",
         mathjs="factorial(100)", numpy="np.prod(np.arange(1,101,dtype=float))"),
    dict(id="N05", cat="numeric", tier="core", title="eᵖⁱ", latex=r"e^{\pi}", prec=40,
         f=lambda: exp(pi), ce=["Power", "ExponentialE", "Pi"], sympy="exp(pi)",
         mathjs="exp(pi)", numpy="np.exp(np.pi)"),
    # ---------------- NUMERIC · hard ----------------
    dict(id="N06", cat="numeric", tier="hard", title="π (200 digits)", latex=r"\pi", prec=200,
         f=lambda: pi, ce="Pi", sympy="pi", mathjs="pi", numpy="np.pi"),
    dict(id="N07", cat="numeric", tier="hard", title="ζ(3)", latex=r"\zeta(3)", prec=40,
         f=lambda: zeta(3), ce=["Zeta", 3], sympy="zeta(3)", mathjs="zeta(3)", numpy=None),
    dict(id="N08", cat="numeric", tier="hard", title="Γ(1/3)", latex=r"\Gamma(\tfrac13)", prec=40,
         f=lambda: gamma(mpf(1) / 3), ce=["Gamma", ["Divide", 1, 3]],
         sympy="gamma(Rational(1,3))", mathjs="gamma(1/3)", numpy=None),
    dict(id="N09", cat="numeric", tier="hard", title="W(1) (Omega)", latex=r"W(1)", prec=40,
         f=lambda: lambertw(1), ce=["LambertW", 1], sympy="LambertW(1)", mathjs=None, numpy=None),

    # ---------------- SIMPLIFY · core ----------------
    dict(id="S01", cat="simplify", tier="core", title="(x²−1)/(x−1)", latex=r"\frac{x^2-1}{x-1}",
         f=lambda x: (x**2 - 1) / (x - 1),
         ce=["Divide", ["Subtract", ["Power", "x", 2], 1], ["Subtract", "x", 1]],
         sympy="(x**2 - 1)/(x - 1)", mathjs="(x^2 - 1)/(x - 1)"),
    dict(id="S02", cat="simplify", tier="core", title="sin²x + cos²x", latex=r"\sin^2 x+\cos^2 x",
         f=lambda x: sin(x)**2 + cos(x)**2,
         ce=["Add", ["Power", ["Sin", "x"], 2], ["Power", ["Cos", "x"], 2]],
         sympy="sin(x)**2 + cos(x)**2", mathjs="sin(x)^2 + cos(x)^2"),
    dict(id="S03", cat="simplify", tier="core", title="(x+1)²−(x−1)²", latex=r"(x+1)^2-(x-1)^2",
         f=lambda x: (x + 1)**2 - (x - 1)**2,
         ce=["Subtract", ["Power", ["Add", "x", 1], 2], ["Power", ["Subtract", "x", 1], 2]],
         sympy="(x + 1)**2 - (x - 1)**2", mathjs="(x + 1)^2 - (x - 1)^2"),
    dict(id="S04", cat="simplify", tier="core", title="(x³−x)/x", latex=r"\frac{x^3-x}{x}",
         f=lambda x: (x**3 - x) / x,
         ce=["Divide", ["Subtract", ["Power", "x", 3], "x"], "x"],
         sympy="(x**3 - x)/x", mathjs="(x^3 - x)/x"),
    # current-build canonicalization fix: x^(-1/2) unifies with 1/√x -> cancels to 0
    dict(id="S05", cat="simplify", tier="core", title="x^(−1/2) − 1/√x", latex=r"x^{-1/2}-\frac{1}{\sqrt x}",
         f=lambda x: x**(mpf(-1) / 2) - 1 / sqrt(x),
         ce=["Subtract", ["Power", "x", ["Divide", -1, 2]], ["Divide", 1, ["Sqrt", "x"]]],
         sympy="x**(Rational(-1,2)) - 1/sqrt(x)", mathjs="x^(-1/2) - 1/sqrt(x)"),
    # ---------------- SIMPLIFY · hard ----------------
    # radical-coefficient factoring — exercises the coefficient-extraction fix
    dict(id="S06", cat="simplify", tier="hard", title="√6·x + √2·x", latex=r"\sqrt6\,x+\sqrt2\,x",
         f=lambda x: sqrt(6) * x + sqrt(2) * x,
         ce=["Add", ["Multiply", ["Sqrt", 6], "x"], ["Multiply", ["Sqrt", 2], "x"]],
         sympy="sqrt(6)*x + sqrt(2)*x", mathjs="sqrt(6)*x + sqrt(2)*x"),
    dict(id="S07", cat="simplify", tier="hard", title="ln x + ln(x+1)", latex=r"\ln x+\ln(x+1)",
         f=lambda x: log(x) + log(x + 1),
         ce=["Add", ["Ln", "x"], ["Ln", ["Add", "x", 1]]],
         sympy="log(x) + log(x + 1)", mathjs="log(x) + log(x + 1)"),
    dict(id="S08", cat="simplify", tier="hard", title="√(3+2√2) denest", latex=r"\sqrt{3+2\sqrt2}",
         f=lambda x: sqrt(3 + 2 * sqrt(2)),  # constant; x ignored
         ce=["Sqrt", ["Add", 3, ["Multiply", 2, ["Sqrt", 2]]]],
         sympy="sqrt(3 + 2*sqrt(2))", mathjs="sqrt(3 + 2*sqrt(2))"),
    dict(id="S09", cat="simplify", tier="hard", title="(x³−1)/(x−1)", latex=r"\frac{x^3-1}{x-1}",
         f=lambda x: (x**3 - 1) / (x - 1),
         ce=["Divide", ["Subtract", ["Power", "x", 3], 1], ["Subtract", "x", 1]],
         sympy="(x**3 - 1)/(x - 1)", mathjs="(x^3 - 1)/(x - 1)"),

    # ---------------- DERIVATIVE · core ----------------
    dict(id="D01", cat="derivative", tier="core", title="d/dx sin x", latex=r"\tfrac{d}{dx}\sin x",
         f=lambda x: sin(x), ce=["Sin", "x"], sympy="sin(x)", mathjs="sin(x)"),
    dict(id="D02", cat="derivative", tier="core", title="d/dx x⁵", latex=r"\tfrac{d}{dx}x^5",
         f=lambda x: x**5, ce=["Power", "x", 5], sympy="x**5", mathjs="x^5"),
    dict(id="D03", cat="derivative", tier="core", title="d/dx tan x", latex=r"\tfrac{d}{dx}\tan x",
         f=lambda x: tan(x), ce=["Tan", "x"], sympy="tan(x)", mathjs="tan(x)"),
    dict(id="D04", cat="derivative", tier="core", title="d/dx x²·sin x", latex=r"\tfrac{d}{dx}x^2\sin x",
         f=lambda x: x**2 * sin(x), ce=["Multiply", ["Power", "x", 2], ["Sin", "x"]],
         sympy="x**2*sin(x)", mathjs="x^2 * sin(x)"),
    dict(id="D05", cat="derivative", tier="core", title="d/dx sin(x²)", latex=r"\tfrac{d}{dx}\sin(x^2)",
         f=lambda x: sin(x**2), ce=["Sin", ["Power", "x", 2]], sympy="sin(x**2)", mathjs="sin(x^2)"),
    # ---------------- DERIVATIVE · hard ----------------
    dict(id="D06", cat="derivative", tier="hard", title="d/dx xˣ", latex=r"\tfrac{d}{dx}x^x",
         f=lambda x: x**x, ce=["Power", "x", "x"], sympy="x**x", mathjs="x^x"),
    dict(id="D07", cat="derivative", tier="hard", title="d/dx arcsin x", latex=r"\tfrac{d}{dx}\arcsin x",
         points=UNIT_POINTS,
         f=lambda x: asin(x), ce=["Arcsin", "x"], sympy="asin(x)", mathjs="asin(x)"),
    dict(id="D08", cat="derivative", tier="hard", title="d/dx ln(sin x)", latex=r"\tfrac{d}{dx}\ln(\sin x)",
         f=lambda x: log(sin(x)), ce=["Ln", ["Sin", "x"]], sympy="log(sin(x))", mathjs="log(sin(x))"),
    dict(id="D09", cat="derivative", tier="hard", title="d/dx √(1−x²)", latex=r"\tfrac{d}{dx}\sqrt{1-x^2}",
         points=UNIT_POINTS,
         f=lambda x: sqrt(1 - x**2), ce=["Sqrt", ["Subtract", 1, ["Power", "x", 2]]],
         sympy="sqrt(1 - x**2)", mathjs="sqrt(1 - x^2)"),

    # ---------------- ANTIDERIVATIVE · core ----------------
    dict(id="A01", cat="antiderivative", tier="core", title="∫ x² dx", latex=r"\int x^2\,dx",
         f=lambda x: x**2, ce=["Power", "x", 2], sympy="x**2"),
    dict(id="A02", cat="antiderivative", tier="core", title="∫ sin x dx", latex=r"\int\sin x\,dx",
         f=lambda x: sin(x), ce=["Sin", "x"], sympy="sin(x)"),
    dict(id="A03", cat="antiderivative", tier="core", title="∫ x·eˣ dx", latex=r"\int x e^x\,dx",
         f=lambda x: x * exp(x), ce=["Multiply", "x", ["Power", "ExponentialE", "x"]], sympy="x*exp(x)"),
    dict(id="A04", cat="antiderivative", tier="core", title="∫ 1/(1+x²) dx", latex=r"\int\frac{1}{1+x^2}\,dx",
         f=lambda x: 1 / (1 + x**2), ce=["Divide", 1, ["Add", 1, ["Power", "x", 2]]], sympy="1/(1 + x**2)"),
    dict(id="A05", cat="antiderivative", tier="core", title="∫ x/(x²+1) dx", latex=r"\int\frac{x}{x^2+1}\,dx",
         f=lambda x: x / (x**2 + 1), ce=["Divide", "x", ["Add", ["Power", "x", 2], 1]], sympy="x/(x**2 + 1)"),
    # ---------------- ANTIDERIVATIVE · hard ----------------
    # current build solves this (partial fractions); published 0.59.0 leaves it unevaluated
    dict(id="A06", cat="antiderivative", tier="hard", title="∫ 1/(x³+1) dx", latex=r"\int\frac{1}{x^3+1}\,dx",
         f=lambda x: 1 / (x**3 + 1), ce=["Divide", 1, ["Add", ["Power", "x", 3], 1]], sympy="1/(x**3 + 1)"),
    # algebraic radical — base CE leaves it; Rubi solves it (2√x)
    dict(id="A07", cat="antiderivative", tier="hard", title="∫ 1/√x dx", latex=r"\int\frac{1}{\sqrt x}\,dx",
         f=lambda x: 1 / sqrt(x), ce=["Divide", 1, ["Sqrt", "x"]], sympy="1/sqrt(x)"),
    # non-elementary (erf) — SymPy solves; CE/Rubi do not
    dict(id="A08", cat="antiderivative", tier="hard", title="∫ e^(−x²) dx", latex=r"\int e^{-x^2}\,dx",
         f=lambda x: exp(-x**2),
         ce=["Power", "ExponentialE", ["Negate", ["Power", "x", 2]]], sympy="exp(-x**2)"),
    # algebraic radical needing a substitution — base CE leaves it; Rubi solves it
    dict(id="A09", cat="antiderivative", tier="hard", title="∫ x/√(1−x²) dx", latex=r"\int\frac{x}{\sqrt{1-x^2}}\,dx",
         interval=UNIT_INTERVAL,
         f=lambda x: x / sqrt(1 - x**2),
         ce=["Divide", "x", ["Sqrt", ["Subtract", 1, ["Power", "x", 2]]]], sympy="x/sqrt(1 - x**2)"),
]


def build():
    out = []
    for c in CASES:
        cat = c["cat"]
        common = dict(id=c["id"], category=cat, tier=c["tier"], title=c["title"], latex=c["latex"])
        if cat == "numeric":
            if c.get("integer"):
                verify = {"kind": "integer", "value": str(c["f"]())}
            else:
                verify = {"kind": "decimal", "sigdigits": c["prec"], "value": dec(c["f"](), c["prec"] + 12)}
            inputs = {
                "ce": {"mathjson": c["ce"], "op": "N", "precision": c.get("prec", 0)},
                "sympy": {"expr": c["sympy"], "op": "N", "precision": c.get("prec", 0)} if c["sympy"] else None,
                "mathjs": {"expr": c["mathjs"], "op": "N", "precision": c.get("prec", 0)} if c["mathjs"] else None,
                "numpy": {"expr": c["numpy"], "op": "N"} if c["numpy"] else None,
            }
        elif cat in ("simplify", "derivative"):
            pts = c.get("points", DEF_POINTS)
            if cat == "simplify":
                values = [dec(c["f"](p), 50) for p in pts]
                op = "simplify"
                vr = {"kind": "sample", "var": "x", "points": [dec(p, 50) for p in pts], "values": values}
                ce_in = {"mathjson": c["ce"], "op": "simplify"}
                py_op = {"op": "simplify"}
            else:
                values = [dec(diff(c["f"], p), 50) for p in pts]
                vr = {"kind": "sample", "var": "x", "points": [dec(p, 50) for p in pts], "values": values}
                ce_in = {"mathjson": c["ce"], "op": "diff", "var": "x"}
                py_op = {"op": "diff", "var": "x"}
            inputs = {
                "ce": ce_in,
                "sympy": {"expr": c["sympy"], **py_op} if c["sympy"] else None,
                "mathjs": {"expr": c["mathjs"], **py_op} if c["mathjs"] else None,
                "numpy": None,
            }
            verify = vr
        else:  # antiderivative
            a, b = c.get("interval", DEF_INTERVAL)
            verify = {"kind": "diff", "var": "x", "a": dec(a, 50), "b": dec(b, 50),
                      "value": dec(quad(c["f"], [a, b]), 50)}
            inputs = {
                "ce": {"mathjson": c["ce"], "op": "integrate", "var": "x"},
                "sympy": {"expr": c["sympy"], "op": "integrate", "var": "x"} if c["sympy"] else None,
                "mathjs": None, "numpy": None,
            }
        out.append({**common, "verify": verify, "inputs": inputs})
    return {
        "schemaVersion": 2,
        "workingPrecision": mp.dps,
        "categories": ["numeric", "simplify", "derivative", "antiderivative"],
        "tiers": ["core", "hard"],
        "cases": out,
    }


if __name__ == "__main__":
    data = build()
    out = os.path.join(os.path.dirname(__file__), "cases.json")
    with open(out, "w") as fh:
        json.dump(data, fh, indent=2)
    by = {}
    for c in data["cases"]:
        by.setdefault(c["category"], {"core": 0, "hard": 0})[c["tier"]] += 1
    print(f"Wrote {len(data['cases'])} cases to {out}")
    for k, v in by.items():
        print(f"  {k}: core {v['core']}, hard {v['hard']}")
