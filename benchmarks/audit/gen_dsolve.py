#!/usr/bin/env python3
"""
Generate benchmarks/audit/dsolve_cases.json — an ODE-solving benchmark that
compares Compute Engine's `DSolve` against SymPy's `dsolve`, graded by a
**substitute-back residual oracle** (the same philosophy as `solve.ts`, applied
to differential equations).

Design
------
- The corpus is defined **once**, in this file, as MathJSON ODEs (the exact form
  fed to CE's `DSolve`).  A small MathJSON→SymPy translator derives the SymPy
  ODE from the very same MathJSON, so both engines see the identical equation.
- Each case carries a `class` tag (linear / separable / Bernoulli / exact /
  homogeneous / constant-coefficient order n / Cauchy–Euler / IVP / BVP / …) and
  an `expectInert` flag.  CE's contract is **inert-rather-than-wrong**: for a
  class it does not support, staying inert (returning the unevaluated `DSolve`)
  is *correct* behavior, graded `unsupported` — distinct from `inert-gap`
  (`expectInert=false` but CE failed to solve something it should).
- SymPy is run here (with a per-case wall-clock timeout — some `dsolve` calls
  hang, e.g. a variable-coefficient 2nd-order equation) and graded by a numeric
  residual oracle that mirrors the TypeScript one in `dsolve.ts`: substitute the
  solution and its derivatives into the ODE residual, evaluate at a shared set of
  sample points with the shared integration-constant values, and require
  |residual| ≤ tol·(1+scale) at ≥ minPoints valid points.  `checkodesol`
  (SymPy's own symbolic substitute-back) is a backstop when the numeric route
  cannot find enough evaluable points.

The oracle *parameters* (sample points, constant values, tolerance, minPoints)
live in the emitted JSON `config` block, so `dsolve.ts` grades CE with the exact
same numbers — one source of truth.

Run:  ./venv/bin/python3 benchmarks/audit/gen_dsolve.py
"""

import json
import os
import signal

import sympy as sp
from sympy import Function, Symbol, Rational, Derivative

# --------------------------------------------------------------------------- #
# Oracle configuration (shared with dsolve.ts via the JSON `config` block).
# --------------------------------------------------------------------------- #
# Integration constants c_1..c_4 → deterministic values (CE names them c_1…,
# SymPy names them C1…; we map by index).
CONST_VALUES = {1: 1.0, 2: 2.0, 3: 3.0, 4: 5.0}
# Explicit solutions y(x)=f(x): sample x here (all positive & bounded so
# exponential/log/√ stay in-domain and float magnitudes stay modest).
EXPLICIT_POINTS = [0.35, 0.7, 1.1, 1.6, 2.0]
# Implicit solutions F(x,y)=C: sample (x, Y) with Y an independent stand-in for
# y(x); positive to stay clear of log/√/1/y singularities.
IMPLICIT_POINTS = [[0.5, 1.3], [1.0, 0.7], [1.4, 1.9], [1.9, 1.1], [0.8, 2.2]]
TOL = 1e-7          # relative: pass iff |residual| <= TOL * (1 + scale)
MIN_POINTS = 4      # need at least this many evaluable sample points to grade
SYMPY_TIMEOUT = 20  # seconds per dsolve() call

x = Symbol("x", real=True)
Y = Symbol("Y", real=True)


# --------------------------------------------------------------------------- #
# MathJSON → SymPy translator (only the heads used by the corpus).
# --------------------------------------------------------------------------- #
FUNCS = {"y", "z"}  # dependent function names


def to_sympy(expr, funcs):
    if isinstance(expr, str):
        if expr == "x":
            return x
        if expr == "ExponentialE":
            return sp.E
        if expr == "Pi":
            return sp.pi
        if expr.startswith("c_"):
            return Symbol(expr)
        return Symbol(expr)
    if isinstance(expr, (int, float)):
        return sp.Integer(expr) if isinstance(expr, int) else sp.Float(expr)
    head = expr[0]
    args = expr[1:]
    if head in funcs:
        return funcs[head](*[to_sympy(a, funcs) for a in args])
    if head == "Rational":
        return Rational(int(args[0]), int(args[1]))
    if head == "D":
        base = to_sympy(args[0], funcs)
        vars_ = args[1:]
        return sp.Derivative(base, *[to_sympy(v, funcs) for v in vars_])
    if head == "Add":
        return sum(to_sympy(a, funcs) for a in args)
    if head == "Subtract":
        return to_sympy(args[0], funcs) - to_sympy(args[1], funcs)
    if head == "Multiply":
        out = sp.Integer(1)
        for a in args:
            out = out * to_sympy(a, funcs)
        return out
    if head == "Divide":
        return to_sympy(args[0], funcs) / to_sympy(args[1], funcs)
    if head == "Negate":
        return -to_sympy(args[0], funcs)
    if head == "Power":
        return to_sympy(args[0], funcs) ** to_sympy(args[1], funcs)
    if head == "Sqrt":
        return sp.sqrt(to_sympy(args[0], funcs))
    if head == "Root":
        return to_sympy(args[0], funcs) ** (sp.Integer(1) / to_sympy(args[1], funcs))
    if head == "Exp":
        return sp.exp(to_sympy(args[0], funcs))
    if head == "Ln":
        return sp.log(to_sympy(args[0], funcs))
    if head == "Log":
        if len(args) == 2:
            return sp.log(to_sympy(args[0], funcs), to_sympy(args[1], funcs))
        return sp.log(to_sympy(args[0], funcs))
    if head == "Sin":
        return sp.sin(to_sympy(args[0], funcs))
    if head == "Cos":
        return sp.cos(to_sympy(args[0], funcs))
    if head == "Tan":
        return sp.tan(to_sympy(args[0], funcs))
    if head == "Sinh":
        return sp.sinh(to_sympy(args[0], funcs))
    if head == "Cosh":
        return sp.cosh(to_sympy(args[0], funcs))
    if head == "Abs":
        return sp.Abs(to_sympy(args[0], funcs))
    if head == "Apply":  # Apply(Derivative(y, k), x0)
        inner = args[0]
        pt = to_sympy(args[1], funcs)
        assert inner[0] == "Derivative"
        fname = inner[1]
        order = int(inner[2]) if len(inner) > 2 else 1
        f = funcs[fname]
        return sp.Derivative(f(x), x, order).subs(x, pt)
    raise ValueError(f"Unhandled MathJSON head: {head}")


# --------------------------------------------------------------------------- #
# Timeout plumbing for SymPy's dsolve (some calls hang).
# --------------------------------------------------------------------------- #
class _Timeout(Exception):
    pass


def _alarm(signum, frame):
    raise _Timeout()


signal.signal(signal.SIGALRM, _alarm)


def with_timeout(fn, secs):
    signal.setitimer(signal.ITIMER_REAL, secs)
    try:
        return fn(), None
    except _Timeout:
        return None, "timeout"
    except Exception as e:  # noqa: BLE001 — sympy raises many exception types
        return None, f"{type(e).__name__}: {str(e)[:60]}"
    finally:
        signal.setitimer(signal.ITIMER_REAL, 0)


# --------------------------------------------------------------------------- #
# Numeric residual oracle (SymPy side) — mirrors dsolve.ts.
# --------------------------------------------------------------------------- #
def _const_subs(expr):
    subs = {}
    for name in expr.free_symbols:
        s = str(name)
        for i, v in CONST_VALUES.items():
            if s in (f"C{i}", f"c_{i}"):
                subs[name] = v
    return expr.subs(subs)


def _num(expr):
    try:
        v = complex(sp.N(expr))
        if abs(v.imag) > 1e-7:
            return None
        return v.real
    except Exception:
        return None


def grade_sympy_explicit(residuals, deps, sols, order, conditions):
    """residuals: list of sympy exprs (=0). deps: list of Function. sols: dict
    dep->f(x). Substitute derivatives+dep for every dep, sample explicit points."""
    subbed = []
    for res in residuals:
        r = res
        for d in deps:
            f = sols[d]
            for k in range(order, 0, -1):
                r = r.subs(Derivative(d(x), x, k), sp.diff(f, x, k))
            r = r.subs(d(x), f)
        subbed.append(_const_subs(r))
    ok = 0
    for xv in EXPLICIT_POINTS:
        good_here = True
        evaluable = True
        scale = 1.0
        for d in deps:
            fv = _num(_const_subs(sols[d]).subs(x, xv))
            if fv is None:
                evaluable = False
                break
            scale += abs(fv)
        if not evaluable:
            continue
        for r in subbed:
            val = _num(r.subs(x, xv))
            if val is None:
                good_here = None
                break
            if abs(val) > TOL * scale:
                good_here = False
                break
        if good_here is None:
            continue
        if not good_here:
            return "wrong"
        ok += 1
    if ok < MIN_POINTS:
        return "not-evaluable"
    if conditions and not check_conditions(deps, sols, conditions):
        return "wrong"
    return "correct"


def grade_sympy_implicit(residual, dep, sol, conditions):
    """First-order implicit F(x,y)=G.  Build relation G0(x,Y)=F-G with y(x)→Y,
    y' = -G0_x/G0_Y; substitute into the ODE residual and sample (x,Y)."""
    F = _const_subs(sol.lhs - sol.rhs).subs(dep(x), Y)
    G0x = sp.diff(F, x)
    G0Y = sp.diff(F, Y)
    yprime = -G0x / G0Y
    r = residual.subs(Derivative(dep(x), x), yprime).subs(dep(x), Y)
    r = _const_subs(r)
    ok = 0
    for (xv, yv) in IMPLICIT_POINTS:
        denom = _num(G0Y.subs({x: xv, Y: yv}))
        if denom is None or abs(denom) < 1e-9:
            continue
        val = _num(r.subs({x: xv, Y: yv}))
        if val is None:
            continue
        scale = 1.0 + abs(xv) + abs(yv)
        if abs(val) > TOL * scale:
            return "wrong"
        ok += 1
    if ok < MIN_POINTS:
        return "not-evaluable"
    if conditions and not check_conditions_implicit(F, conditions):
        return "wrong"
    return "correct"


def check_conditions(deps, sols, conditions):
    for cond in conditions:
        d = deps[0] if len(deps) == 1 else None
        f = sols[d]
        if cond["type"] == "value":
            v = _num(f.subs(x, cond["at"]))
        else:  # first derivative
            v = _num(sp.diff(f, x, cond["order"]).subs(x, cond["at"]))
        if v is None or abs(v - cond["target"]) > 1e-6:
            return False
    return True


def check_conditions_implicit(F, conditions):
    for cond in conditions:
        if cond["type"] != "value":
            return False  # derivative IC on implicit form not modelled
        v = _num(F.subs({x: cond["at"], Y: cond["target"]}))
        if v is None or abs(v) > 1e-6:
            return False
    return True


def build_ics(deps, conditions):
    """Translate our condition list into a SymPy `ics` dict for dsolve."""
    ics = {}
    d = deps[0]
    for cond in conditions:
        if cond["type"] == "value":
            ics[d(cond["at"])] = cond["target"]
        else:
            ics[sp.Derivative(d(x), x, cond["order"]).subs(x, cond["at"])] = cond[
                "target"
            ]
    return ics


def run_sympy(residuals, deps_syms, order, conditions):
    """Run SymPy dsolve (with ics if present) and grade it. Returns dict."""
    deps = [Function(n) for n in deps_syms]
    funcs = [d(x) for d in deps]
    if len(residuals) == 1:
        ode = sp.Eq(residuals[0], 0)
        target = funcs[0]
    else:
        ode = [sp.Eq(r, 0) for r in residuals]
        target = funcs

    def _call():
        if conditions:
            return sp.dsolve(ode, target, ics=build_ics(deps, conditions))
        return sp.dsolve(ode, target)

    sol, err = with_timeout(_call, SYMPY_TIMEOUT)
    if err is not None:
        return {"status": "error", "note": err, "verdict": "unsolved"}
    if sol is None:
        return {"status": "unsolved", "verdict": "unsolved"}

    # Normalize to a list of Eq.
    sols_list = sol if isinstance(sol, list) else [sol]
    # System: expect one Eq per dependent, all explicit.
    try:
        if len(deps) > 1:
            smap = {}
            for eq in sols_list:
                for d in deps:
                    if eq.lhs == d(x):
                        smap[d] = eq.rhs
            if len(smap) == len(deps):
                verdict = grade_sympy_explicit(
                    residuals, deps, smap, order, conditions
                )
                return {"status": "ok", "verdict": verdict, "sol": str(sol)}
            return {"status": "ok", "verdict": "not-evaluable", "sol": str(sol)}

        # Scalar: try each returned branch; pass if any grades correct.
        best = "unsolved"
        for eq in sols_list:
            d = deps[0]
            if eq.lhs == d(x):  # explicit
                v = grade_sympy_explicit(residuals, deps, {d: eq.rhs}, order, conditions)
            else:  # implicit
                v = grade_sympy_implicit(residuals[0], d, eq, conditions)
            if v == "correct":
                best = "correct"
                break
            if v == "wrong":
                best = "wrong"
            elif best not in ("wrong",):
                best = v
        # checkodesol backstop when numeric route was inconclusive.
        if best in ("not-evaluable", "unsolved"):
            try:
                chk = sp.checkodesol(ode, sol)
                chks = chk if isinstance(chk, list) else [chk]
                if any(c[0] is True for c in chks):
                    best = "correct"
            except Exception:
                pass
        return {"status": "ok", "verdict": best, "sol": str(sol)}
    except Exception as e:  # noqa: BLE001
        return {"status": "error", "note": f"grade {type(e).__name__}", "verdict": "unsolved"}


# --------------------------------------------------------------------------- #
# Corpus.  Each row:
#   (id, cls, title, equation-mathjson, dependent(s), expectInert)
# `equation` is either ['Equal', lhs, rhs] or ['List', ode, ic, …] for IVP/BVP,
# or ['List', ode1, ode2] with dependents ['y','z'] for a system.
# --------------------------------------------------------------------------- #
def D(f, *v):
    return ["D", f, *v]


yx = ["y", "x"]
zx = ["z", "x"]
d1 = lambda f: D(f, "x")            # noqa: E731
d2 = lambda f: D(D(f, "x"), "x")    # noqa: E731
d3 = lambda f: D(D(D(f, "x"), "x"), "x")          # noqa: E731
d4 = lambda f: D(D(D(D(f, "x"), "x"), "x"), "x")  # noqa: E731

EQ = lambda a, b: ["Equal", a, b]   # noqa: E731

CASES = [
    # ---- first-order linear (integrating factor), incl. variable coeff ------
    ("FL1", "1st-linear", "y' = 3y", EQ(d1(yx), ["Multiply", 3, yx]), "y", False),
    ("FL2", "1st-linear", "y' + y = x",
     EQ(["Add", d1(yx), yx], "x"), "y", False),
    ("FL3", "1st-linear", "y' + 2xy = x (var-coeff)",
     EQ(["Add", d1(yx), ["Multiply", 2, "x", yx]], "x"), "y", False),
    ("FL4", "1st-linear", "y' + (2/x)y = x (var-coeff)",
     EQ(["Add", d1(yx), ["Multiply", ["Divide", 2, "x"], yx]], "x"), "y", False),
    ("FL5", "1st-linear", "y' − y/x = x (var-coeff, Divide)",
     EQ(["Subtract", d1(yx), ["Divide", yx, "x"]], "x"), "y", False),
    ("FL6", "1st-linear", "y' + y = sin x",
     EQ(["Add", d1(yx), yx], ["Sin", "x"]), "y", False),
    ("FL7", "1st-linear", "y' = e^(−x) − y",
     EQ(d1(yx), ["Subtract", ["Exp", ["Negate", "x"]], yx]), "y", False),

    # ---- separable ----------------------------------------------------------
    ("SP1", "separable", "y' = y", EQ(d1(yx), yx), "y", False),
    ("SP2", "separable", "y' = xy",
     EQ(d1(yx), ["Multiply", "x", yx]), "y", False),
    ("SP3", "separable", "y' = x/y",
     EQ(d1(yx), ["Divide", "x", yx]), "y", False),
    ("SP4", "separable", "y' = y²",
     EQ(d1(yx), ["Power", yx, 2]), "y", False),
    ("SP5", "separable", "y' = 1 + y²",
     EQ(d1(yx), ["Add", 1, ["Power", yx, 2]]), "y", False),

    # ---- first-order homogeneous y'=F(y/x) ---------------------------------
    ("HM1", "homogeneous", "y' = 1 + y/x",
     EQ(d1(yx), ["Add", 1, ["Divide", yx, "x"]]), "y", False),
    ("HM2", "homogeneous", "y' = (x²+y²)/(xy)",
     EQ(d1(yx), ["Divide", ["Add", ["Power", "x", 2], ["Power", yx, 2]],
                 ["Multiply", "x", yx]]), "y", False),

    # ---- Bernoulli ----------------------------------------------------------
    ("BN1", "bernoulli", "y' = y + xy²",
     EQ(d1(yx), ["Add", yx, ["Multiply", "x", ["Power", yx, 2]]]), "y", False),
    ("BN2", "bernoulli", "y' + y = xy³",
     EQ(["Add", d1(yx), yx], ["Multiply", "x", ["Power", yx, 3]]), "y", False),
    ("BN3", "bernoulli", "y' − y/x = y²",
     EQ(["Subtract", d1(yx), ["Divide", yx, "x"]], ["Power", yx, 2]), "y", False),

    # ---- exact M dx + N dy = 0 ---------------------------------------------
    ("EX1", "exact", "2xy + y² + (x²+2xy)y' = 0",
     EQ(["Add", ["Multiply", 2, "x", yx], ["Power", yx, 2],
         ["Multiply", ["Add", ["Power", "x", 2], ["Multiply", 2, "x", yx]],
          d1(yx)]], 0), "y", False),
    ("EX2", "exact", "xy' + y = x²",
     EQ(["Add", ["Multiply", "x", d1(yx)], yx], ["Power", "x", 2]), "y", False),

    # ---- constant-coefficient homogeneous, order 2 -------------------------
    ("L2a", "linhom-2", "y'' − y = 0 (real distinct)",
     EQ(["Subtract", d2(yx), yx], 0), "y", False),
    ("L2b", "linhom-2", "y'' + y = 0 (complex)",
     EQ(["Add", d2(yx), yx], 0), "y", False),
    ("L2c", "linhom-2", "y'' − 2y' + y = 0 (repeated)",
     EQ(["Add", d2(yx), ["Multiply", -2, d1(yx)], yx], 0), "y", False),
    ("L2d", "linhom-2", "y'' − y' − y = 0 (irrational)",
     EQ(["Add", d2(yx), ["Negate", d1(yx)], ["Negate", yx]], 0), "y", False),
    ("L2e", "linhom-2", "y'' − 3y' + 2y = 0 (real distinct)",
     EQ(["Add", d2(yx), ["Multiply", -3, d1(yx)], ["Multiply", 2, yx]], 0),
     "y", False),

    # ---- constant-coefficient homogeneous, order 3 -------------------------
    ("L3a", "linhom-3", "y''' − 6y'' + 11y' − 6y = 0 (real)",
     EQ(["Add", d3(yx), ["Multiply", -6, d2(yx)], ["Multiply", 11, d1(yx)],
         ["Multiply", -6, yx]], 0), "y", False),
    ("L3b", "linhom-3", "y''' − 3y'' + 3y' − y = 0 (repeated)",
     EQ(["Add", d3(yx), ["Multiply", -3, d2(yx)], ["Multiply", 3, d1(yx)],
         ["Negate", yx]], 0), "y", False),
    ("L3c", "linhom-3", "y''' − y = 0 (complex pair)",
     EQ(["Subtract", d3(yx), yx], 0), "y", False),

    # ---- constant-coefficient homogeneous, order 4 -------------------------
    ("L4a", "linhom-4", "y'''' + 2y'' + y = 0 (repeated ±i)",
     EQ(["Add", d4(yx), ["Multiply", 2, d2(yx)], yx], 0), "y", False),
    ("L4b", "linhom-4", "y'''' − 2y''' + 2y'' − 2y' + y = 0",
     EQ(["Add", d4(yx), ["Multiply", -2, d3(yx)], ["Multiply", 2, d2(yx)],
         ["Multiply", -2, d1(yx)], yx], 0), "y", False),

    # ---- nonhomogeneous constant-coefficient -------------------------------
    ("NH1", "nonhom", "y'' = 1 (poly)",
     EQ(d2(yx), 1), "y", False),
    ("NH2", "nonhom", "y'' − y = x (poly forcing)",
     EQ(["Subtract", d2(yx), yx], "x"), "y", False),
    ("NH3", "nonhom", "y'' − y = eˣ (resonant exp)",
     EQ(["Subtract", d2(yx), yx], ["Exp", "x"]), "y", False),
    ("NH4", "nonhom", "y'' + y = eˣ (non-resonant exp)",
     EQ(["Add", d2(yx), yx], ["Exp", "x"]), "y", False),
    ("NH5", "nonhom", "y'' − y = e^(2x)",
     EQ(["Subtract", d2(yx), yx], ["Exp", ["Multiply", 2, "x"]]), "y", False),
    ("NH6", "nonhom", "y'' + y = sin x (resonant)",
     EQ(["Add", d2(yx), yx], ["Sin", "x"]), "y", False),
    ("NH7", "nonhom", "y'' + 4y = sin x (non-resonant)",
     EQ(["Add", d2(yx), ["Multiply", 4, yx]], ["Sin", "x"]), "y", False),
    ("NH8", "nonhom", "y'' + y = tan x (variation of params)",
     EQ(["Add", d2(yx), yx], ["Tan", "x"]), "y", False),

    # ---- Cauchy–Euler -------------------------------------------------------
    ("CE1", "cauchy-euler", "x²y'' − 2y = 0 (distinct)",
     EQ(["Subtract", ["Multiply", ["Power", "x", 2], d2(yx)],
         ["Multiply", 2, yx]], 0), "y", False),
    ("CE2", "cauchy-euler", "x²y'' + xy' = 0 (repeated)",
     EQ(["Add", ["Multiply", ["Power", "x", 2], d2(yx)],
         ["Multiply", "x", d1(yx)]], 0), "y", False),
    ("CE3", "cauchy-euler", "x²y'' + xy' + y = 0 (complex)",
     EQ(["Add", ["Multiply", ["Power", "x", 2], d2(yx)],
         ["Multiply", "x", d1(yx)], yx], 0), "y", False),

    # ---- initial-value / boundary-value problems ---------------------------
    ("IV1", "ivp", "y' = y, y(0)=2",
     ["List", EQ(d1(yx), yx), EQ(["y", 0], 2)], "y", False),
    ("IV2", "ivp", "y'' = −y, y(0)=0, y'(0)=1",
     ["List", EQ(d2(yx), ["Negate", yx]), EQ(["y", 0], 0),
      EQ(["Apply", ["Derivative", "y", 1], 0], 1)], "y", False),
    ("IV3", "ivp", "y' = x/y, y(0)=1 (separable IVP)",
     ["List", EQ(d1(yx), ["Divide", "x", yx]), EQ(["y", 0], 1)], "y", False),
    ("IV4", "ivp", "exact IVP, y(1)=1",
     ["List",
      EQ(["Add", ["Multiply", 2, "x", yx], ["Power", yx, 2],
          ["Multiply", ["Add", ["Power", "x", 2], ["Multiply", 2, "x", yx]],
           d1(yx)]], 0),
      EQ(["y", 1], 1)], "y", False),
    ("BV1", "bvp", "y'' + y = 0, y(0)=0, y(π/2)=1",
     ["List", EQ(["Add", d2(yx), yx], 0), EQ(["y", 0], 0),
      EQ(["y", ["Divide", "Pi", 2]], 1)], "y", False),

    # ---- linear system ------------------------------------------------------
    ("SY1", "system", "y'=z, z'=y (coupled linear)",
     ["List", EQ(d1(yx), zx), EQ(d1(zx), yx)], ["y", "z"], False),

    # ---- beyond current coverage (expected inert; map the gap) -------------
    ("BY1", "beyond", "y' = x + y² (Riccati)",
     EQ(d1(yx), ["Add", "x", ["Power", yx, 2]]), "y", True),
    ("BY2", "beyond", "sin(x)y'' + y' = cos x (var-coeff 2nd order)",
     EQ(["Add", ["Multiply", ["Sin", "x"], d2(yx)], d1(yx)], ["Cos", "x"]),
     "y", True),
    ("BY3", "beyond", "x²y'' + xy' = x (nonhomog Cauchy–Euler)",
     EQ(["Add", ["Multiply", ["Power", "x", 2], d2(yx)],
         ["Multiply", "x", d1(yx)]], "x"), "y", True),
    ("BY4", "beyond", "y''=xy (Airy, variable coeff)",
     EQ(d2(yx), ["Multiply", "x", yx]), "y", True),
    ("BY5", "beyond", "y'=y, z'=z (repeated eigenvalue system)",
     ["List", EQ(d1(yx), yx), EQ(d1(zx), zx)], ["y", "z"], True),
]


# --------------------------------------------------------------------------- #
# Helpers to split the MathJSON case into ODE(s) + conditions.
# --------------------------------------------------------------------------- #
def split_case(equation, deps):
    """Return (ode_residuals[], conditions[]) from a case equation.

    equation is ['Equal',…] or ['List', ode(s)…, ic…].  For a system the List
    holds one ['Equal', D(dep), …] per dependent and no ICs.
    """
    funcs = {n: Function(n) for n in deps}
    conditions = []
    if equation[0] == "Equal":
        odes = [equation]
    else:  # List
        items = equation[1:]
        odes = []
        for it in items:
            assert it[0] == "Equal"
            if is_condition(it):
                conditions.append(parse_condition(it))
            else:
                odes.append(it)
    residuals = [to_sympy(o[1], funcs) - to_sympy(o[2], funcs) for o in odes]
    return residuals, conditions


def is_condition(eq):
    """A condition equates y(<number>) or a derivative-at-a-point to a value."""
    lhs = eq[1]
    if isinstance(lhs, list) and lhs[0] in FUNCS and not _is_symbol(lhs[1], "x"):
        return True
    if isinstance(lhs, list) and lhs[0] == "Apply":
        return True
    if isinstance(lhs, list) and lhs[0] == "D" and isinstance(lhs[1], list) \
            and lhs[1][0] in FUNCS and not _is_symbol(lhs[1][1], "x"):
        return True
    return False


def _is_symbol(node, name):
    return isinstance(node, str) and node == name


def parse_condition(eq):
    lhs, rhs = eq[1], eq[2]
    target = float(rhs) if isinstance(rhs, (int, float)) else float(sp.N(to_sympy(rhs, {})))
    if lhs[0] == "Apply":  # Apply(Derivative(y,k), x0)
        inner = lhs[1]
        order = int(inner[2]) if len(inner) > 2 else 1
        at = _point(lhs[2])
        return {"type": "deriv", "order": order, "at": at, "target": target}
    if lhs[0] == "D":  # D(y(x0), x)
        at = _point(lhs[1][1])
        return {"type": "deriv", "order": len(lhs) - 2, "at": at, "target": target}
    # y(x0)
    return {"type": "value", "at": _point(lhs[1]), "target": target}


def _point(node):
    if isinstance(node, (int, float)):
        return float(node)
    return float(sp.N(to_sympy(node, {})))


# --------------------------------------------------------------------------- #
# Emit.
# --------------------------------------------------------------------------- #
out_cases = []
for cid, cls, title, equation, deps, expect_inert in CASES:
    dep_names = deps if isinstance(deps, list) else [deps]
    residuals, conditions = split_case(equation, dep_names)
    order = max(int(sp.ode_order(r, Function(dep_names[0])(x))) for r in residuals) \
        if len(dep_names) == 1 else 1
    sym = run_sympy(residuals, dep_names, order, conditions)
    out_cases.append({
        "id": cid,
        "class": cls,
        "title": title,
        "expectInert": expect_inert,
        "ce": {
            "equation": equation,
            "dependent": deps,
            "independent": "x",
        },
        "sympy": sym,
    })
    print(f"  {cid:5s} {cls:14s} sympy={sym['verdict']:12s} ({sym['status']})")

payload = {
    "config": {
        "constants": {f"c_{i}": v for i, v in CONST_VALUES.items()},
        "explicitPoints": EXPLICIT_POINTS,
        "implicitPoints": IMPLICIT_POINTS,
        "tol": TOL,
        "minPoints": MIN_POINTS,
    },
    "cases": out_cases,
}

here = os.path.dirname(os.path.abspath(__file__))
with open(os.path.join(here, "dsolve_cases.json"), "w") as f:
    json.dump(payload, f, indent=1)

by_class = {}
for c in out_cases:
    by_class[c["class"]] = by_class.get(c["class"], 0) + 1
print(f"\nWrote {len(out_cases)} cases to dsolve_cases.json")
print("  classes:", by_class)
sy_correct = sum(1 for c in out_cases if c["sympy"]["verdict"] == "correct")
print(f"  SymPy correct: {sy_correct}/{len(out_cases)}")
