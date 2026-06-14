# one (impl, op, prec) cell. usage: python _cell.py <sympy|mpmath> <op> <prec> [budgetMs]
import sys, time, sympy as sp, mpmath
impl, op, p = sys.argv[1], sys.argv[2], int(sys.argv[3])
ms = int(sys.argv[4]) if len(sys.argv)>4 else 400
SY={'ln':lambda c:sp.log(c+2).evalf(p),'exp':lambda c:sp.exp(sp.Rational(c+1,c+3)).evalf(p),
    'sin':lambda c:sp.sin(sp.Rational(c+1,c+3)).evalf(p),'cos':lambda c:sp.cos(sp.Rational(c+1,c+3)).evalf(p),
    'tan':lambda c:sp.tan(sp.Rational(c+1,c+3)).evalf(p),'atan':lambda c:sp.atan(c+2).evalf(p),
    'asin':lambda c:sp.asin(sp.Rational(c+1,c+3)).evalf(p),'sqrt':lambda c:sp.sqrt(c+2).evalf(p)}
def mp(c,fn):
    mpmath.mp.dps=p; return fn(c)
MP={'ln':lambda c:mp(c,lambda c:mpmath.log(c+2)),'exp':lambda c:mp(c,lambda c:mpmath.exp(mpmath.mpf(c+1)/(c+3))),
    'sin':lambda c:mp(c,lambda c:mpmath.sin(mpmath.mpf(c+1)/(c+3))),'cos':lambda c:mp(c,lambda c:mpmath.cos(mpmath.mpf(c+1)/(c+3))),
    'tan':lambda c:mp(c,lambda c:mpmath.tan(mpmath.mpf(c+1)/(c+3))),'atan':lambda c:mp(c,lambda c:mpmath.atan(c+2)),
    'asin':lambda c:mp(c,lambda c:mpmath.asin(mpmath.mpf(c+1)/(c+3))),'sqrt':lambda c:mp(c,lambda c:mpmath.sqrt(c+2))}
f=(SY if impl=='sympy' else MP)[op]
c=0
for _ in range(5): f(c); c+=1
n=0; t0=time.perf_counter()
while True:
    f(c); c+=1; n+=1
    if (n&3)==0 and time.perf_counter()-t0>=ms/1000: break
print(f"{(time.perf_counter()-t0)/n*1000:.3f}")
