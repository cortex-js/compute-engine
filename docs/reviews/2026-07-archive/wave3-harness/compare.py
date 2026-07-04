#!/usr/bin/env python3
"""Compare CE results against mpmath refs. ulp error for machine/compiled,
decimal-digit agreement for ce (bignum)."""
import json, sys, math
from mpmath import mp, mpf

HERE = "/private/tmp/claude-501/-Users-arno-dev-compute-engine/fcb60263-044a-423d-8c83-fdf73e169ca2/scratchpad/wave3"
mp.dps = 80

with open(f"{HERE}/cases.json") as f:
    cases = json.load(f)
with open(f"{HERE}/refs.json") as f:
    refs = json.load(f)
with open(f"{HERE}/results.json") as f:
    results = json.load(f)

label = sys.argv[1] if len(sys.argv) > 1 else ""

def ulp_double(x):
    """spacing of doubles at x."""
    x = abs(float(x))
    if x == 0:
        return 5e-324
    return math.ulp(x)

rows = []
for c in cases:
    cid = c["id"]
    ref = mpf(refs[cid])
    got = results.get(cid, "MISSING")
    if isinstance(got, str) and got.startswith("ERROR"):
        rows.append((cid, c["kind"], "ERR", got[:40]))
        continue
    if got == "MISSING":
        rows.append((cid, c["kind"], "MISS", ""))
        continue
    try:
        gv = mpf(got)
    except Exception as e:
        rows.append((cid, c["kind"], "PARSE", str(got)[:40]))
        continue
    if c["kind"] in ("machine", "compiled"):
        # ulp error relative to the double grid at ref
        u = ulp_double(ref)
        err = abs(gv - ref)
        ulps = float(err / mpf(u))
        # correct decimal digits
        rel = float(err / abs(ref)) if ref != 0 else float(err)
        digits = (-math.log10(rel)) if rel > 0 else 99.0
        rows.append((cid, c["kind"], f"{ulps:.2f}ulp", f"{digits:.1f}dig"))
    else:  # ce / bignum
        prec = c.get("precision", 34)
        rel = float(abs(gv - ref) / abs(ref)) if ref != 0 else float(abs(gv - ref))
        digits = (-math.log10(rel)) if rel > 0 else 99.0
        # ulp at target precision: relative spacing 10^-(prec-1)
        ulps = rel / (10 ** (-(prec - 1)))
        rows.append((cid, c["kind"], f"{ulps:.2f}ulp@{prec}", f"{digits:.1f}dig"))

print(f"\n===== {label} =====")
print(f"{'id':<26}{'kind':<10}{'error':<18}{'digits':<10}")
worst = 0.0
for cid, kind, err, dig in rows:
    flag = ""
    if err.endswith("ulp") or "ulp@" in err:
        v = float(err.split("ulp")[0])
        thresh = 4.0 if kind in ("machine", "compiled") else 2.0
        if v > thresh:
            flag = "  <-- FAIL"
    elif err in ("ERR", "MISS", "PARSE"):
        flag = "  <-- FAIL"
    print(f"{cid:<26}{kind:<10}{err:<18}{dig:<10}{flag}")
