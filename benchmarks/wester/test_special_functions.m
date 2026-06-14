(* Extracted from https://math.unm.edu/~wester/demos/SpecialFunctions/Math.problems
   Source index: https://math.unm.edu/~wester/cas_review.html *)

(* ----------[ M a t h e m a t i c a ]---------- *)

(* ---------- Initialization ---------- *)

(* ---------- Special Functions ---------- *)

(* Bernoulli numbers: B_16 => -3617/510   [Gradshteyn and Ryzhik 
9.71] *)

BernoulliB[16]

(* d/dk E(phi, k) => [E(phi, k) - F(phi, k)]/k  where  F(phi, k) and 
E(phi, k)
   are elliptic integrals of the 1st and 2nd kind, respectively
   [Gradshteyn and Ryzhik 8.123(3)] *)

D[EllipticE[phi, k^2], k]

(* Jacobian elliptic functions: d/du dn u => -k^2 sn u cn u
   [Gradshteyn and Ryzhik 8.158(3)] *)

D[JacobiDN[u], u]

(* => -2 sqrt(pi)   [Gradshteyn and Ryzhik 8.338(3)] *)

Gamma[-1/2]

(* psi(1/3) => - Euler's_constant - pi/2 sqrt(1/3) - 3/2 log 3  
where  psi(x)
   is the psi function [= d/dx log Gamma(x)]   [Gradshteyn and Ryzhik 
8.366(6)]
   *)

PolyGamma[1/3]

(* Bessel function of the first kind of order 2 => 0.04158 + 0.24740 
i *)

N[BesselJ[2, 1 + I]]

(* => 12/pi^2   [Gradshteyn and Ryzhik 8.464(6)] *)

BesselJ[-5/2, Pi/2]

FullSimplify[%]

(* => sqrt(2/(pi z)) (sin z/z - cos z)   [Gradshteyn and Ryzhik 
8.464(3)] *)

BesselJ[3/2, z]

(* d/dz J_0(z) => - J_1(z)   [Gradshteyn and Ryzhik 8.473(4)] *)

D[BesselJ[0, z], z]

FullSimplify[%]

(* Associated Legendre (spherical) function of the 1st kind: 
P^mu_nu(0)
   => 2^mu sqrt(pi) / [Gamma([nu - mu]/2 + 1) Gamma([- nu - mu + 1]/2)]
      [Gradshteyn and Ryzhik 8.756(1)] *)

LegendreP[nu, mu, 0]

(* P^1_3(x) => -3/2 sqrt(1 - x^2) (5 x^2 - 1)
               [Gradshteyn and Ryzhik 8.813(4)] *)

LegendreP[3, 1, x]

(* nth Chebyshev polynomial of the 1st kind: T_n(x) => 0
   [Gradshteyn and Ryzhik 8.941(1)] *)

Simplify[ChebyshevT[1008, x] - 2*x*ChebyshevT[1007, x] + 
ChebyshevT[1006, x]]

(* T_n(-1) => (-1)^n   [Gradshteyn and Ryzhik 8.944(2)] *)

ChebyshevT[n, -1]

FullSimplify[%]

(* => arcsin z/z   [Gradshteyn and Ryzhik 9.121(26)] *)

HypergeometricPFQ[{1/2, 1/2}, {3/2}, z^2]

PowerExpand[%]

Hypergeometric2F1[1/2, 1/2, 3/2, z^2]

(* => sin(n z)/(n sin z cos z)   [Gradshteyn and Ryzhik 9.121(17)] *)

HypergeometricPFQ[{(n + 2)/2, -(n - 2)/2}, {3/2}, Sin[z]^2]

Simplify[%]

PowerExpand[%]

Hypergeometric2F1[(n + 2)/2, -(n - 2)/2, 3/2, Sin[z]^2]

(* zeta'(0) => - 1/2 log(2 pi)   [Gradshteyn and Ryzhik 9.542(4)] *)

D[Zeta[x], x] /. x -> 0

(* Dirac delta distribution => 3 f(4/5) + g'(1) *)

<< Calculus`DiracDelta`

Integrate[f[(x + 2)/5]*DiracDelta[(x - 2)/3] - g[x]*DiracDelta'[x - 
1],
          {x, 0, 3}]

(* Define an antisymmetric function f *)

f[l__]:= Signature[{l}]*Apply[HoldForm[f], Sort[{l}]]

(* Test it out => [-f(a, b, c), 0] *)

{f[c, b, a], f[c, b, c]}

Clear[f]

(* ---------- Quit ---------- *)
