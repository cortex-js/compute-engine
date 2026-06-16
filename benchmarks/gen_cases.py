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
    diff, quad, cbrt, zeta, gamma, lambertw, digamma, polyroots,
)

mp.dps = 230  # enough for the 200-digit numeric case + guard digits


def real_roots(coeffs):
    """Real roots of a polynomial (highest degree first), as decimal strings.

    Used to bake an independent reference root set for `solve` cases — the
    `solve` oracle checks a tool's returned (real) roots against this set."""
    roots = polyroots([mpf(c) for c in coeffs], maxsteps=500, extraprec=200)
    reals = sorted(r.real for r in roots if abs(r.imag) < mpf(10) ** (-40))
    return [dec(r, 40) for r in reals]

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
    # π² rather than bare π: forces an arbitrary-precision multiply, so the cell
    # times a real computation instead of a stored-constant fetch.
    dict(id="N01", cat="numeric", tier="core", title="π²", latex=r"\pi^2", prec=50,
         f=lambda: pi**2, ce=["Power", "Pi", 2], sympy="pi**2", mathjs="pi^2", numpy="np.pi**2"),
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
         sympy="sqrt(6)*x + sqrt(2)*x", mathjs="sqrt(6)*x + sqrt(2)*x",
         changelog=dict(table="symbolic", group="simplify", order=2)),
    dict(id="S07", cat="simplify", tier="hard", title="ln x + ln(x+1)", latex=r"\ln x+\ln(x+1)",
         f=lambda x: log(x) + log(x + 1),
         ce=["Add", ["Ln", "x"], ["Ln", ["Add", "x", 1]]],
         sympy="log(x) + log(x + 1)", mathjs="log(x) + log(x + 1)"),
    dict(id="S08", cat="simplify", tier="hard", title="√(3+2√2) denest", latex=r"\sqrt{3+2\sqrt2}",
         f=lambda x: sqrt(3 + 2 * sqrt(2)),  # constant; x ignored
         ce=["Sqrt", ["Add", 3, ["Multiply", 2, ["Sqrt", 2]]]],
         sympy="sqrt(3 + 2*sqrt(2))", mathjs="sqrt(3 + 2*sqrt(2))",
         changelog=dict(table="symbolic", group="simplify", order=1)),
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
         sympy="sqrt(1 - x**2)", mathjs="sqrt(1 - x^2)",
         changelog=dict(table="symbolic", group="derivative", order=1)),

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
         f=lambda x: 1 / (x**3 + 1), ce=["Divide", 1, ["Add", ["Power", "x", 3], 1]], sympy="1/(x**3 + 1)",
         changelog=dict(table="symbolic", group="antiderivative", order=3)),
    # algebraic radical — base CE leaves it; Rubi solves it (2√x)
    dict(id="A07", cat="antiderivative", tier="hard", title="∫ 1/√x dx", latex=r"\int\frac{1}{\sqrt x}\,dx",
         f=lambda x: 1 / sqrt(x), ce=["Divide", 1, ["Sqrt", "x"]], sympy="1/sqrt(x)",
         changelog=dict(table="symbolic", group="antiderivative", order=1)),
    # non-elementary (erf) — SymPy solves; CE/Rubi do not
    dict(id="A08", cat="antiderivative", tier="hard", title="∫ e^(−x²) dx", latex=r"\int e^{-x^2}\,dx",
         f=lambda x: exp(-x**2),
         ce=["Power", "ExponentialE", ["Negate", ["Power", "x", 2]]], sympy="exp(-x**2)"),
    # algebraic radical needing a substitution — base CE leaves it; Rubi solves it
    dict(id="A09", cat="antiderivative", tier="hard", title="∫ x/√(1−x²) dx", latex=r"\int\frac{x}{\sqrt{1-x^2}}\,dx",
         interval=UNIT_INTERVAL,
         f=lambda x: x / sqrt(1 - x**2),
         ce=["Divide", "x", ["Sqrt", ["Subtract", 1, ["Power", "x", 2]]]], sympy="x/sqrt(1 - x**2)",
         changelog=dict(table="symbolic", group="antiderivative", order=2)),

    # ============================================================= #
    # CHANGELOG highlight cases (curated; tagged `changelog`).        #
    # These feed report_changelog.mjs's two release tables. Some sit  #
    # in dedicated categories (cl-numeric / evaluate / solve) that    #
    # the engineering REPORT.md ignores; others reuse the tagged      #
    # cases above. See report_changelog.mjs.                          #
    # ============================================================= #

    # ---- antiderivative highlights needing the Rubi rules ----------
    # Base CE (current AND 0.59.0) returns these unevaluated; the Rubi
    # algebraic-integration corpus (CE + R/F) solves them. They exercise the
    # fractional-power binomial-product machinery Rubi specializes in, and have
    # antiderivatives that stay real on the positive verification interval.
    dict(id="CR1", cat="antiderivative", tier="hard", title="∫ √x/(1+x) dx", latex=r"\int\frac{\sqrt x}{1+x}\,dx",
         f=lambda x: sqrt(x) / (1 + x),
         ce=["Divide", ["Sqrt", "x"], ["Add", 1, "x"]], sympy="sqrt(x)/(1 + x)",
         changelog=dict(table="symbolic", group="antiderivative", order=4)),
    dict(id="CR2", cat="antiderivative", tier="hard", title="∫ x/(1+x)^(1/3) dx", latex=r"\int\frac{x}{(1+x)^{1/3}}\,dx",
         f=lambda x: x / (1 + x) ** (mpf(1) / 3),
         ce=["Divide", "x", ["Power", ["Add", 1, "x"], ["Divide", 1, 3]]],
         sympy="x/(1 + x)**Rational(1,3)",
         changelog=dict(table="symbolic", group="antiderivative", order=5)),
    dict(id="CR3", cat="antiderivative", tier="hard", title="∫ x²/(1+x)^(1/3) dx", latex=r"\int\frac{x^2}{(1+x)^{1/3}}\,dx",
         f=lambda x: x**2 / (1 + x) ** (mpf(1) / 3),
         ce=["Divide", ["Power", "x", 2], ["Power", ["Add", 1, "x"], ["Divide", 1, 3]]],
         sympy="x**2/(1 + x)**Rational(1,3)",
         changelog=dict(table="symbolic", group="antiderivative", order=6)),

    # ---- NUMERIC highlight basket @ 200 digits --------------------
    # Arbitrary-precision evaluation; ms/op (lower is better). The
    # Gamma/Digamma rows showcase the high-precision bignum kernel work.
    dict(id="CN1", cat="cl-numeric", tier="hard", title="π²", latex=r"\pi^2", prec=200,
         f=lambda: pi**2, ce=["Power", "Pi", 2], sympy="pi**2", mathjs="pi^2",
         changelog=dict(table="numeric", order=1)),
    # elementary transcendentals — faster at high precision (more so at 1000+ digits)
    dict(id="CN9", cat="cl-numeric", tier="hard", title="sin 1", latex=r"\sin 1", prec=200,
         f=lambda: sin(1), ce=["Sin", 1], sympy="sin(1)", mathjs="sin(1)",
         changelog=dict(table="numeric", order=2)),
    dict(id="CN10", cat="cl-numeric", tier="hard", title="cos 1", latex=r"\cos 1", prec=200,
         f=lambda: cos(1), ce=["Cos", 1], sympy="cos(1)", mathjs="cos(1)",
         changelog=dict(table="numeric", order=3)),
    dict(id="CN11", cat="cl-numeric", tier="hard", title="ln 2", latex=r"\ln 2", prec=200,
         f=lambda: log(2), ce=["Ln", 2], sympy="log(2)", mathjs="log(2)",
         changelog=dict(table="numeric", order=4)),
    dict(id="CN3", cat="cl-numeric", tier="hard", title="eᵖⁱ", latex=r"e^{\pi}", prec=200,
         f=lambda: exp(pi), ce=["Power", "ExponentialE", "Pi"], sympy="exp(pi)", mathjs="exp(pi)",
         changelog=dict(table="numeric", order=5)),
    dict(id="CN5", cat="cl-numeric", tier="hard", title="ζ(3)", latex=r"\zeta(3)", prec=200,
         f=lambda: zeta(3), ce=["Zeta", 3], sympy="zeta(3)", mathjs=None,
         changelog=dict(table="numeric", order=6)),
    # (√2 and e^√2 omitted — √2 duplicates π²'s story, e^√2 duplicates eᵖⁱ's.
    #  Γ(3) = 2 omitted too: an exact small value with no high-precision timing.)
    dict(id="CN7", cat="cl-numeric", tier="hard", title="Γ(1/3)", latex=r"\Gamma(\tfrac13)", prec=200,
         f=lambda: gamma(mpf(1) / 3), ce=["Gamma", ["Divide", 1, 3]],
         sympy="gamma(Rational(1,3))", mathjs="gamma(1/3)",
         changelog=dict(table="numeric", order=7)),
    dict(id="CN8", cat="cl-numeric", tier="hard", title="ψ(1/3)", latex=r"\psi(\tfrac13)", prec=200,
         f=lambda: digamma(mpf(1) / 3), ce=["Digamma", ["Divide", 1, 3]],
         sympy="digamma(Rational(1,3))", mathjs=None,
         changelog=dict(table="numeric", order=8)),

    # ---- SIMPLIFY highlights (already-tagged S06/S08 are referenced
    #      from their definitions above; nothing new added here) -----

    # ---- EVALUATE highlights (limits & exact definite/improper ∫) --
    # 0.59.0 leaves the limits unevaluated and returns floats (not exact
    # closed forms) for the integrals; current returns exact symbols.
    dict(id="CE1", cat="evaluate", title="lim_{x→0} sin x / x", latex=r"\lim_{x\to0}\tfrac{\sin x}{x}",
         f=lambda: mpf(1),
         ce=["Limit", ["Divide", ["Sin", "x"], "x"], 0],
         sympy="limit(sin(x)/x, x, 0)",
         changelog=dict(table="symbolic", group="evaluate", order=1)),
    dict(id="CE2", cat="evaluate", title="lim_{x→∞} (1+1/x)^x", latex=r"\lim_{x\to\infty}(1+\tfrac1x)^x",
         f=lambda: e,
         ce=["Limit", ["Power", ["Add", 1, ["Divide", 1, "x"]], "x"], "PositiveInfinity"],
         sympy="limit((1 + 1/x)**x, x, oo)",
         changelog=dict(table="symbolic", group="evaluate", order=2)),
    dict(id="CE3", cat="evaluate", title="∫₁² 1/x dx", latex=r"\int_1^2\tfrac1x\,dx",
         f=lambda: log(2),
         ce=["Integrate", ["Divide", 1, "x"], ["Tuple", "x", 1, 2]],
         sympy="integrate(1/x, (x, 1, 2))",
         changelog=dict(table="symbolic", group="evaluate", order=3)),
    dict(id="CE4", cat="evaluate", title="∫_{−∞}^{∞} e^(−x²) dx", latex=r"\int_{-\infty}^{\infty} e^{-x^2}\,dx",
         f=lambda: sqrt(pi),
         ce=["Integrate", ["Power", "ExponentialE", ["Negate", ["Power", "x", 2]]],
             ["Tuple", "x", "NegativeInfinity", "PositiveInfinity"]],
         sympy="integrate(exp(-x**2), (x, -oo, oo))",
         changelog=dict(table="symbolic", group="evaluate", order=4)),

    # ---- SOLVE highlights (0.59.0 returns no roots) ---------------
    dict(id="CS1", cat="solve", title="solve x⁴+x²−1=0", latex=r"x^4+x^2-1=0",
         roots=real_roots([1, 0, 1, 0, -1]),
         ce=["Add", ["Power", "x", 4], ["Power", "x", 2], -1], sympy="x**4 + x**2 - 1",
         changelog=dict(table="symbolic", group="solve", order=1)),
    dict(id="CS2", cat="solve", title="solve x³−x−1=0", latex=r"x^3-x-1=0",
         roots=real_roots([1, 0, -1, -1]),
         ce=["Subtract", ["Subtract", ["Power", "x", 3], "x"], 1], sympy="x**3 - x - 1",
         changelog=dict(table="symbolic", group="solve", order=2)),
]


def build():
    out = []
    for c in CASES:
        cat = c["cat"]
        common = dict(id=c["id"], category=cat, tier=c.get("tier", "core"), title=c["title"], latex=c["latex"])
        if cat in ("numeric", "cl-numeric"):
            if c.get("integer"):
                verify = {"kind": "integer", "value": str(c["f"]())}
            else:
                verify = {"kind": "decimal", "sigdigits": c["prec"], "value": dec(c["f"](), c["prec"] + 12)}
            inputs = {
                "ce": {"mathjson": c["ce"], "op": "N", "precision": c.get("prec", 0)},
                "sympy": {"expr": c["sympy"], "op": "N", "precision": c.get("prec", 0)} if c.get("sympy") else None,
                "mathjs": {"expr": c["mathjs"], "op": "N", "precision": c.get("prec", 0)} if c.get("mathjs") else None,
                "numpy": {"expr": c["numpy"], "op": "N"} if c.get("numpy") else None,
            }
        elif cat == "evaluate":
            # `.evaluate()` to an exact closed form (limit / definite or
            # improper integral). Verified numerically; the oracle additionally
            # requires the result be symbolic (not a bare float) to count as a
            # genuine exact-evaluation improvement.
            verify = {"kind": "value", "value": dec(c["f"](), 50)}
            inputs = {
                "ce": {"mathjson": c["ce"], "op": "evaluate"},
                "sympy": {"expr": c["sympy"], "op": "evaluate"} if c.get("sympy") else None,
                "mathjs": None, "numpy": None,
            }
        elif cat == "solve":
            # Real roots are baked here (mpmath) so the oracle can check a tool's
            # returned roots against an independent reference set.
            verify = {"kind": "roots", "var": "x", "values": c["roots"]}
            inputs = {
                "ce": {"mathjson": c["ce"], "op": "solve", "var": "x"},
                "sympy": {"expr": c["sympy"], "op": "solve", "var": "x"} if c.get("sympy") else None,
                "mathjs": None, "numpy": None,
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
        entry = {**common, "verify": verify, "inputs": inputs}
        if c.get("changelog"):
            entry["changelog"] = c["changelog"]
        out.append(entry)
    return {
        "schemaVersion": 2,
        "workingPrecision": mp.dps,
        "categories": ["numeric", "simplify", "derivative", "antiderivative",
                       "cl-numeric", "evaluate", "solve"],
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
