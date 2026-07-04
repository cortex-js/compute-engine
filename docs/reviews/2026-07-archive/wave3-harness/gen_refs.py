#!/usr/bin/env python3
"""Generate high-precision mpmath references for each case."""
import json, sys
from mpmath import mp, mpf, polygamma, zeta, besselk, besseli, airyai, airybi

HERE = "/private/tmp/claude-501/-Users-arno-dev-compute-engine/fcb60263-044a-423d-8c83-fdf73e169ca2/scratchpad/wave3"

mp.dps = 80  # 80 guard digits

def compute(fn, args, kind):
    # Machine/compiled kernels receive the IEEE double closest to the literal,
    # so their reference is evaluated at that exact double (mpf(float)).
    # CE bignum cases treat decimal literals as exact decimals (mpf(str)).
    if kind in ("machine", "compiled"):
        conv = lambda v: mpf(v)
    else:
        conv = lambda v: mpf(str(v))
    if fn == "polygamma":
        n, x = args
        return polygamma(int(n), conv(x))
    if fn == "zeta":
        return zeta(conv(args[0]))
    if fn == "besselK":
        n, x = args
        return besselk(int(n), conv(x))
    if fn == "besselI":
        n, x = args
        return besseli(int(n), conv(x))
    if fn == "airyAi":
        return airyai(conv(args[0]))
    if fn == "airyBi":
        return airybi(conv(args[0]))
    raise ValueError(fn)

# For compiled / ce cases, the fn is derived from the head.
HEAD_FN = {"PolyGamma": "polygamma", "Zeta": "zeta", "BesselK": "besselK",
           "BesselI": "besselI", "AiryAi": "airyAi", "AiryBi": "airyBi"}

with open(f"{HERE}/cases.json") as f:
    cases = json.load(f)

refs = {}
for c in cases:
    fn = c.get("fn") or HEAD_FN[c["head"]]
    v = compute(fn, c["args"], c["kind"])
    # store 70 significant digits
    refs[c["id"]] = mp.nstr(v, 70, strip_zeros=False)

with open(f"{HERE}/refs.json", "w") as f:
    json.dump(refs, f, indent=1)
print(f"wrote {len(refs)} refs")
