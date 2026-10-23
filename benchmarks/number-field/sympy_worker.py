"""External comparator using the supplied abstract root and its power basis."""
import json
import sys
import time
import sympy as sp
from sympy.polys.domains import QQ

x, t = sp.symbols('x t')
fields = {}
print(json.dumps({'ready': True, 'runtime': sys.version, 'sympy': sp.__version__}), flush=True)
for line in sys.stdin:
    try:
        msg = json.loads(line)
        start = time.perf_counter()
        key = json.dumps(msg['modulus'])
        if key not in fields:
            m = sp.Poly.from_list([sp.Rational(n, d) for n, d in reversed(msg['modulus'])], t)
            fields[key] = QQ.alg_field_from_poly(m, alias='a')
        K = fields[key]
        setup_ms = (time.perf_counter() - start) * 1000
        start = time.perf_counter()
        f = sp.Poly.from_dict({(i,): K([QQ(int(n), int(d)) for n, d in reversed(c)]) for i, c in enumerate(msg['coefficients'])}, x, domain=K)
        conversion_ms = (time.perf_counter() - start) * 1000
        start = time.perf_counter()
        # Keep ANP coefficients throughout. Converting factors to symbolic
        # RootOf expressions and back can dominate the actual factorization.
        scalar, factors = f.rep.factor_list()
        solve_ms = (time.perf_counter() - start) * 1000
        def element(c):
            return [[str(v.numerator), str(v.denominator)] for v in reversed(K.convert(c).to_list())]
        result = {'status': 'complete', 'coefficient': element(scalar), 'factors': [
            {'coefficients': [element(c) for c in reversed(g.to_list())], 'multiplicity': int(m)} for g, m in factors]}
        print(json.dumps({'id': msg['id'], 'setupMs': setup_ms, 'conversionMs': conversion_ms, 'solveMs': solve_ms, 'result': result}), flush=True)
    except Exception as e:
        print(json.dumps({'error': str(e)}), flush=True)
