(* Extracted from https://math.unm.edu/~wester/demos/ZeroEquivalence/Math.problems
   Source index: https://math.unm.edu/~wester/cas_review.html *)

(* ----------[ M a t h e m a t i c a ]---------- *)

(* ---------- Initialization ---------- *)

(* ---------- Determining Zero Equivalence ---------- *)

(* The following expressions are all equal to zero *)

Sqrt[997] - (997^3)^(1/6)

Sqrt[999983] - (999983^3)^(1/6)

(2^(1/3) + 4^(1/3))^3 - 6*(2^(1/3) + 4^(1/3)) - 6

Simplify[%]

Cos[x]^3 + Cos[x]*Sin[x]^2 - Cos[x]

Simplify[%]

(* See Joel Moses, ``Algebraic Simplification: A Guide for the 
Perplexed'',
   _Communications of the Association of Computing Machinery_, Volume 14,
   Number 8, August 1971, 527--537.  This expression is zero if Re(x) is
   contained in the interval ((4 n - 1)/2 pi, (4 n + 1)/2 pi) for n an 
integer:
   ..., (-5/2 pi, -3/2 pi), (-pi/2, pi/2), (3/2 pi, 5/2 pi), ... *)

expr = Log[Tan[1/2*x + Pi/4]] - ArcSinh[Tan[x]]

Simplify[FullSimplify[TrigToExp[expr]]]

(* Use a roundabout method---show that expr is a constant equal to 
zero *)

D[expr, x]

Simplify[%]

PowerExpand[%]

expr /. x -> 0

Clear[expr]

Log[(2*Sqrt[r] + 1)/Sqrt[4*r + 4*Sqrt[r] + 1]]

PowerExpand[Simplify[%]]

(4*r + 4*Sqrt[r] + 1)^(Sqrt[r]/(2*Sqrt[r] + 1)) *
   (2*Sqrt[r] + 1)^(1/(2*Sqrt[r] + 1)) - 2*Sqrt[r] - 1

Simplify[PowerExpand[Simplify[%]]]

(* [Gradshteyn and Ryzhik 9.535(3)] *)

2^(1 - z)*Gamma[z]*Zeta[z]*Cos[z*Pi/2] - Pi^z*Zeta[1 - z]

FullSimplify[%]

(* ---------- Quit ---------- *)
