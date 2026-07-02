#!/usr/bin/env python3
"""Generate the STATIC mpmath reference fixture for the nightly kernel suite.

Run ONCE (the nightly jest suite never invokes python at runtime — it reads the
committed `kernel-refs.json`). Regenerate with:

    ./venv/bin/python3 test/compute-engine/nightly/fixtures/gen_kernel_refs.py

The fixture is a JSON array of cases; each case is
  { "id", "head", "args", "kind", "precision"?, "ref" }
where
  * kind "machine"  — CE is evaluated at machine precision; `args` are IEEE
    doubles, and the reference is mpmath evaluated at `mpf(double)` (so the
    reference lands on the same double the interpreter sees). Compared to a few
    ulp of the double grid.
  * kind "bignum"   — CE is evaluated at `precision` significant digits; every
    non-integer argument is encoded `{ "num": "<decimal>" }` so CE treats it as
    an EXACT decimal, and the reference is mpmath at `mpf("<decimal>")`.
    Compared to ~2 ulp at the target precision.

Covers the Wave-3 acceptance kernels (polygamma / zeta / besselK / besselI /
airyAi / airyBi) plus the round-6 additions (nthRoot, LambertW, acos/cos/tan
near cancellation regions, erfInv, 2F1, 1F1, pow ladder, gamma/erf/digamma).
"""
import json, os
from mpmath import (
    mp, mpf, polygamma, zeta, besselk, besseli, airyai, airybi, gamma, digamma,
    lambertw, erf, erfc, erfinv, hyp2f1, hyp1f1, acos, cos, tan, power,
)

mp.dps = 60  # guard digits; store 55 significant

HERE = os.path.dirname(os.path.abspath(__file__))
SIGDIGITS = 55


def num_str(s):
    return {"num": s}


cases = []


def machine(idp, head, args, fn, mp_args=None):
    """A machine-precision case. `fn` computes the mpmath reference. `mp_args`
    overrides the values passed to fn (defaults to mpf(float) of each arg)."""
    ma = mp_args if mp_args is not None else [mpf(a) for a in args]
    ref = fn(*ma)
    cases.append({
        "id": idp, "head": head, "args": args, "kind": "machine",
        "ref": mp.nstr(ref, SIGDIGITS, strip_zeros=False),
    })


def bignum(idp, head, args, fn, precision, mp_args):
    """A bignum case. `args` is the CE-encoded arg list (ints / {num:str});
    `mp_args` is the list of mpf values for the reference."""
    ref = fn(*mp_args)
    cases.append({
        "id": idp, "head": head, "args": args, "kind": "bignum",
        "precision": precision,
        "ref": mp.nstr(ref, SIGDIGITS, strip_zeros=False),
    })


# ─────────────────────────── MACHINE GRID ───────────────────────────

# PolyGamma(n, x)
for n in (2, 3, 4, 5, 6):
    for x in (0.5, 2.5, 10.0, 10.5):
        machine(f"polygamma_m_{n}_{x}", "PolyGamma", [n, x],
                lambda a, b, n=n: polygamma(n, b), mp_args=[n, mpf(x)])
for n in (3, 5):
    machine(f"polygamma_m_{n}_neg2.3", "PolyGamma", [n, -2.3],
            lambda a, b, n=n: polygamma(n, b), mp_args=[n, mpf(-2.3)])

# Zeta(s)
for s in (-11, -1, -0.5, 0.5, 0.9, 1.1, 1.5, 2, 2.3, 3, 4, 5, 10, 15, 30, 50):
    machine(f"zeta_m_{s}", "Zeta", [s], lambda a: zeta(a))

# BesselK(n, x)
for n in (0, 1, 2, 3):
    for x in (0.5, 2.0, 5.0, 10.0, 20.0, 40.0, 100.0):
        machine(f"besselK_m_{n}_{x}", "BesselK", [n, x],
                lambda a, b, n=n: besselk(n, b), mp_args=[n, mpf(x)])

# BesselI(n, x)
for n in (0, 1, 2):
    for x in (5.0, 40.0, 50.0, 100.0, 700.0):
        machine(f"besselI_m_{n}_{x}", "BesselI", [n, x],
                lambda a, b, n=n: besseli(n, b), mp_args=[n, mpf(x)])

# AiryAi / AiryBi
for x in (-10.0, -5.0, -1.0, 1.0, 5.0, 5.1, 10.0):
    machine(f"airyAi_m_{x}", "AiryAi", [x], lambda a: airyai(a))
for x in (-10.0, -5.0, -1.0, 1.0, 5.0, 10.0):
    machine(f"airyBi_m_{x}", "AiryBi", [x], lambda a: airybi(a))

# Gamma
for x in (0.5, 1.5, 2.5, 5.1, 5.5, 10.5, -0.5, -1.5, -2.5):
    machine(f"gamma_m_{x}", "Gamma", [x], lambda a: gamma(a))

# Digamma / erf / erfc
for x in (0.5, 1.0, 2.0, 5.0, 10.5):
    machine(f"digamma_m_{x}", "Digamma", [x], lambda a: digamma(a))
for x in (-1.0, 0.5, 1.0, 1.5, 2.0):
    machine(f"erf_m_{x}", "Erf", [x], lambda a: erf(a))
    machine(f"erfc_m_{x}", "Erfc", [x], lambda a: erfc(a))

# LambertW (principal branch)
for x in (-0.2, 0.5, 1.0, 2.0, 3.0, 10.0):
    machine(f"lambertW_m_{x}", "LambertW", [x], lambda a: lambertw(a))

# ErfInv — incl. the near-1 cancellation region (round-6)
for x in (0.1, 0.5, 0.9, 0.99, 0.999999999999):
    machine(f"erfInv_m_{x}", "ErfInv", [x], lambda a: erfinv(a))

# Hypergeometric 2F1(1,1,2,z) and 1F1(1,2,z)
for z in (-0.5, 0.25, 0.5, 0.99):
    machine(f"hyp2f1_m_{z}", "Hypergeometric2F1", [1, 1, 2, z],
            lambda a, b, c, d: hyp2f1(a, b, c, d),
            mp_args=[mpf(1), mpf(1), mpf(2), mpf(z)])
for z in (-1.0, 0.5, 1.0, 3.0):
    machine(f"hyp1f1_m_{z}", "Hypergeometric1F1", [1, 2, z],
            lambda a, b, c: hyp1f1(a, b, c),
            mp_args=[mpf(1), mpf(2), mpf(z)])

# nthRoot — real branches (round-6)
for (x, n) in ((5.1, 3), (2.0, 3), (10.0, 5), (100.0, 3), (-8.0, 3), (-32.0, 5)):
    # CE's Root uses the REAL branch for odd degree of a negative radicand
    # (Root(-8,3) = -2), so mirror that rather than mpmath's principal cbrt.
    machine(f"root_m_{x}_{n}", "Root", [x, n],
            lambda a, n=n: (power(a, mpf(1) / n) if a >= 0
                            else -power(-a, mpf(1) / n)),
            mp_args=[mpf(x)])

# acos/cos/tan cancellation regions (round-6)
machine("acos_near1_m", "Arccos", [0.9999999999], lambda a: acos(a))
machine("acos_near1b_m", "Arccos", [0.99999999999999], lambda a: acos(a))
machine("cos_near_halfpi_m", "Cos", [1.5707963267948966], lambda a: cos(a))
machine("tan_near_pi_m", "Tan", [3.141592653589793], lambda a: tan(a))
machine("tan_small_m", "Tan", [1e-8], lambda a: tan(a))

# ─────────────────────────── BIGNUM GRID ───────────────────────────

# PolyGamma
for (n, x, p) in ((3, "2.5", 34), (3, "2.5", 50), (5, "10.5", 34),
                  (5, "10.5", 50), (4, "2.5", 50), (6, "0.5", 50)):
    bignum(f"polygamma_b_{n}_{x}_p{p}", "PolyGamma", [n, num_str(x)],
           lambda a, b, n=n: polygamma(n, b), p, [n, mpf(x)])

# Zeta (integer args stay exact)
for (s, p) in ((3, 50), (0.5, 50), (30, 50), (2, 34), (5, 50)):
    if isinstance(s, int):
        bignum(f"zeta_b_{s}_p{p}", "Zeta", [s], lambda a: zeta(a), p, [mpf(s)])
    else:
        bignum(f"zeta_b_{s}_p{p}", "Zeta", [num_str(str(s))],
               lambda a: zeta(a), p, [mpf(str(s))])

# Gamma of a float arg
for (x, p) in (("5.1", 50), ("2.5", 34), ("10.5", 50)):
    bignum(f"gamma_b_{x}_p{p}", "Gamma", [num_str(x)], lambda a: gamma(a), p, [mpf(x)])

# NOTE: BesselK / BesselI / Airy have NO arbitrary-precision implementation in
# CE — .N() returns a machine double even at high precision — so they are tested
# only in the machine grid above, never as bignum cases.

# LambertW
for (x, p) in (("3", 50), ("0.5", 50)):
    bignum(f"lambertW_b_{x}_p{p}", "LambertW", [num_str(x)],
           lambda a: lambertw(a), p, [mpf(x)])

# ErfInv
bignum("erfInv_b_0.5_p50", "ErfInv", [num_str("0.5")], lambda a: erfinv(a), 50, [mpf("0.5")])

# Hypergeometric near z=1
bignum("hyp2f1_b_0.99_p30", "Hypergeometric2F1", [1, 1, 2, num_str("0.99")],
       lambda a, b, c, d: hyp2f1(a, b, c, d), 30,
       [mpf(1), mpf(1), mpf(2), mpf("0.99")])

# Power ladder (cancellation-sensitive)
bignum("pow_ladder_p34", "Power", [num_str("0.999999999999"), 1000000],
       lambda a, b: power(a, b), 34, [mpf("0.999999999999"), mpf(1000000)])
bignum("pow_ladder_p50", "Power", [num_str("0.999999999999"), 1000000],
       lambda a, b: power(a, b), 50, [mpf("0.999999999999"), mpf(1000000)])

# acos near 1 (bignum cancellation)
bignum("acos_near1_b_p50", "Arccos", [num_str("0.99999999999999999999")],
       lambda a: acos(a), 50, [mpf("0.99999999999999999999")])

with open(os.path.join(HERE, "kernel-refs.json"), "w") as f:
    json.dump(cases, f, indent=1)
print(f"wrote {len(cases)} kernel reference cases")
