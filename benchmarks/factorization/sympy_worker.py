"""External SymPy comparator; startup and per-case algebra are timed separately."""
import json
import sys
import time

start = time.perf_counter()
import sympy as sp

x = sp.Symbol("x")
print(json.dumps({"ready": True, "initializationMs": (time.perf_counter() - start) * 1000,
                  "runtime": sys.version, "sympy": sp.__version__}), flush=True)
for line in sys.stdin:
    try:
        msg = json.loads(line)
        start = time.perf_counter()
        f = sp.Poly.from_list([sp.Rational(n, d) for n, d in reversed(msg["coefficients"])], x, domain=sp.QQ)
        conversion_ms = (time.perf_counter() - start) * 1000
        start = time.perf_counter()
        scalar, factors = f.factor_list()
        solve_ms = (time.perf_counter() - start) * 1000
        normalized = []
        for factor, multiplicity in factors:
            _, cleared = factor.clear_denoms(convert=True)
            _, primitive = cleared.primitive()
            if primitive.LC() < 0:
                primitive = -primitive
            scalar *= (factor.LC() / primitive.LC()) ** multiplicity
            normalized.append({"coefficients": [str(c) for c in reversed(primitive.all_coeffs())],
                               "multiplicity": multiplicity})
        result = {"status": "complete", "coefficient": {"numerator": str(sp.numer(scalar)),
                  "denominator": str(sp.denom(scalar))}, "factors": normalized}
        print(json.dumps({"id": msg["id"], "backend": "sympy", "result": result,
                          "solveMs": solve_ms, "conversionMs": conversion_ms}), flush=True)
    except Exception as e:
        print(json.dumps({"error": str(e)}), flush=True)
