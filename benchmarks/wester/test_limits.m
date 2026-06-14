(* Extracted from https://math.unm.edu/~wester/demos/Limits/Math.problems
   Source index: https://math.unm.edu/~wester/cas_review.html *)

(* ----------[ M a t h e m a t i c a ]---------- *)

(* ---------- Initialization ---------- *)

(* ---------- Limits ---------- *)

(* Start with a famous example => e *)

Limit[(1 + 1/n)^n, n -> Infinity]

(* => 1/2 *)

Limit[(1 - Cos[x])/x^2, x->0]

(* See Dominik Gruntz, _On Computing Limits in a Symbolic 
Manipulation System_,
   Ph.D. dissertation, Swiss Federal Institute of Technology, Zurich,
   Switzerland, 1996. => 5 *)

Limit[(3^x + 5^x)^(1/x), x->Infinity]

(* => 1 *)

Limit[Log[x]/(Log[x] + Sin[x]), x->Infinity]

(* => - e^2   [Gruntz] *)

Limit[(Exp[x*Exp[-x]/(Exp[-x] + Exp[-2*x^2/(x + 1)])] - Exp[x])/x, 
x->Infinity]

(* => 1/3   [Gruntz] *)

Limit[x*Log[x]*Log[x*Exp[x] - x^2]^2/Log[Log[x^2 + 
2*Exp[Exp[3*x^3*Log[x]]]]],
      x->Infinity]

(* => 1/e   [Knopp, p. 73] *)

Limit[1/n * n!^(1/n), n->Infinity]

                                                         1           3

(* Rewrite the above problem slightly => 1/e *)

Limit[1/n * Gamma[n + 1]^(1/n), n->Infinity]

(* => 1   [Gradshteyn and Ryzhik 8.328(2)] *)

Limit[Gamma[z + a]/Gamma[z]*Exp[-a*Log[z]], z->Infinity]

(* => e^z   [Gradshteyn and Ryzhik 9.121(8)] *)

Limit[HypergeometricPFQ[{1, k}, {1}, z/k], k->Infinity]

(* => Euler's_constant   [Gradshteyn and Ryzhik 9.536] *)

Limit[Zeta[x] - 1/(x - 1), x->1]

(* => gamma(x)   [Knopp, p. 385] *)

Limit[n^x/(x * Product[(1 + x/k), {k, 1, n}]), n->Infinity]

(* See Angus E. Taylor and W. Robert Mann, _Advanced Calculus_, 
Second Edition,
   Xerox College Publishing, 1972, p. 125 => 1 *)

Limit[x * Integrate[Exp[-t^2], {t, 0, x}]/(1 - Exp[-x^2]), x->0]

(* => [-1, 1] *)

{Limit[x/Abs[x], x->0, Direction -> 1], Limit[x/Abs[x], x->0, 
Direction -> -1]}

(* => pi/2   [Richard Q. Chen] *)

Limit[ArcTan[-Log[x]], x->0, Direction -> -1]

(* Try again after loading Calculus`Limit` *)

<< Calculus`Limit`

(* Start with a famous example => e *)

Limit[(1 + 1/n)^n, n -> Infinity]

(* => 1/2 *)

Limit[(1 - Cos[x])/x^2, x->0]

(* See Dominik Gruntz, _On Computing Limits in a Symbolic 
Manipulation System_,
   Ph.D. dissertation, Swiss Federal Institute of Technology, Zurich,
   Switzerland, 1995. => 5 *)

Limit[(3^x + 5^x)^(1/x), x->Infinity]

(* => 1 *)

Limit[Log[x]/(Log[x] + Sin[x]), x->Infinity]

(* => - e^2   [Gruntz] *)

Limit[(Exp[x*Exp[-x]/(Exp[-x] + Exp[-2*x^2/(x + 1)])] - Exp[x])/x, 
x->Infinity]

(* => 1/3   [Gruntz] *)

Limit[x*Log[x]*Log[x*Exp[x] - x^2]^2/Log[Log[x^2 + 
2*Exp[Exp[3*x^3*Log[x]]]]],
      x->Infinity]

                                 1

(* => 1/e   [Knopp, p. 73] *)

Limit[1/n * n!^(1/n), n->Infinity]

(* Rewrite the above problem slightly => 1/e *)

Limit[1/n * Gamma[n + 1]^(1/n), n->Infinity]

(* => 1   [Gradshteyn and Ryzhik 8.328(2)] *)

Limit[Gamma[z + a]/Gamma[z]*Exp[-a*Log[z]], z->Infinity]

(* => e^z   [Gradshteyn and Ryzhik 9.121(8)] *)

Limit[HypergeometricPFQ[{1, k}, {1}, z/k], k->Infinity]

(* => Euler's_constant   [Gradshteyn and Ryzhik 9.536] *)

Limit[Zeta[x] - 1/(x - 1), x->1]

Simplify[%]

(* => gamma(x)   [Knopp, p. 385] *)

Limit[n^x/(x * Product[(1 + x/k), {k, 1, n}]), n->Infinity]

FullSimplify[%]

(* See Angus E. Taylor and W. Robert Mann, _Advanced Calculus_, 
Second Edition,
   Xerox College Publishing, 1972, p. 125 => 1 *)

Limit[x * Integrate[Exp[-t^2], {t, 0, x}]/(1 - Exp[-x^2]), x->0]

(* => [-1, 1] *)

{Limit[x/Abs[x], x->0, Direction -> 1], Limit[x/Abs[x], x->0, 
Direction -> -1]}

(* => pi/2   [Richard Q. Chen] *)

Limit[ArcTan[-Log[x]], x->0, Direction -> -1]

(* ---------- Quit ---------- *)
