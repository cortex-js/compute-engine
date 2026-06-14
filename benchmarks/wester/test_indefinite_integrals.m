(* Extracted from https://math.unm.edu/~wester/demos/IndefiniteIntegrals/Math.problems
   Source index: https://math.unm.edu/~wester/cas_review.html *)

(* ----------[ M a t h e m a t i c a ]---------- *)

(* ---------- Initialization ---------- *)

(* ---------- Indefinite Integrals ---------- *)

(* This integral only makes sense for x real => x |x|/2 *)

Integrate[Abs[x], x]

Integrate[ComplexExpand[Abs[x]], x]

(* Calculus on a piecewise defined function *)

a[x_]:= If[x < 0, -x, x]

(* => if x < 0 then -x^2/2 else x^2/2 *)

Integrate[a[x], x]

<< Calculus`DiracDelta`

a[x_]:= -x*UnitStep[-x] + x*UnitStep[x]

Integrate[a[x], x]

Clear[a]

( (* This would be very difficult to do by hand
   => 2^(1/3)/6 [1/2 log([x + 2^(1/3)]^2/[x^2 - 2^(1/3) x + 2^(2/3)])
                 + sqrt(3) arctan({[sqrt(3) x]/[2^(4/3) - x]   or
                                   [2 x - 2^(1/3)]/[2^(1/3) sqrt(3)]})
      [Gradshteyn and Ryzhik 2.126(1)] *)
1/(x^3 + 2) )

Integrate[%, x]

D[%, x]

( (* What a mess!  Simplify it. *)
Simplify[%] )

(* This integral is easy if one realizes that 4^x = (2^x)^2
   => arcsinh(2^x)/log(2)   [Robert Israel in sci.math.symbolic] *)

Integrate[2^x/Sqrt[1 + 4^x], x]

(* => (-9 x^2 + 16 x - 41/5)/(2 x - 1)^(5/2)
      [Gradshteyn and Ryzhik 2.244(8)] *)

Integrate[(3*x - 5)^2/(2*x - 1)^(7/2), x]

Simplify[%]

(* => 1/[2 m sqrt(10)] log([-5 + e^(m x) sqrt(10)]/[-5 - e^(m x) 
sqrt(10)])
      [Gradshteyn and Ryzhik 2.314] *)

Integrate[1/(2*Exp[m*x] - 5*Exp[-m*x]), x]

Simplify[%]

(* => -3/2 x + 1/4 sinh(2 x) + tanh x   [Gradshteyn and Ryzhik 
2.423(24)] *)

Integrate[Sinh[x]^4/Cosh[x]^2, x]

FullSimplify[%]

(* This example involves several symbolic parameters
   => 1/sqrt(b^2 - a^2) log([sqrt(b^2 - a^2) tan(x/2) + a + b]/
                            [sqrt(b^2 - a^2) tan(x/2) - a - b])   (a^2 < b^2)
      [Gradshteyn and Ryzhik 2.553(3)] *)

Integrate[1/(a + b*Cos[x]), x, Assumptions -> a^2 < b^2]

Simplify[D[%, x]]

(* The integral of 1/(a + 3 cos x + 4 sin x) can have 4 different 
forms
   depending on the value of a !   [Gradshteyn and Ryzhik 2.558(4)]
   => (a = 3) 1/4 log[3 + 4 tan(x/2)] *)

Integrate[1/(3 + 3*Cos[x] + 4*Sin[x]), x]

Simplify[%]

(* => (a = 4) 1/3 log([tan(x/2) + 1]/[tan(x/2) + 7]) *)

Integrate[1/(4 + 3*Cos[x] + 4*Sin[x]), x]

Simplify[%]

(* => (a = 5) -1/[2 + tan(x/2)] *)

Integrate[1/(5 + 3*Cos[x] + 4*Sin[x]), x]

FullSimplify[%]

(* => (a = 6) 2/sqrt(11) arctan([3 tan(x/2) + 4]/sqrt(11)) *)

Integrate[1/(6 + 3*Cos[x] + 4*Sin[x]), x]

Simplify[%]

(* => x log|x^2 - a^2| - 2 x + a log|(x + a)/(x - a)|
      [Gradshteyn and Ryzhik 2.736(1)] *)

Integrate[Log[Abs[x^2 - a^2]], x]

                 2    2

Integrate[ComplexExpand[Log[Abs[x^2 - a^2]]], x]

(* => (a x)/2 + (pi x^2)/4 - 1/2 (x^2 + a^2) arctan(x/a)
         [Gradshteyn and Ryzhik 2.822(4)]   or
      (a x)/2 + 1/2 (x^2 + a^2) arccot(x/a)   [Gradshteyn and Ryzhik 
2.853(2)]
*)

Integrate[x*ArcCot[x/a], x]

(* => [sin(5 x) Ci(2 x)]/5 - [Si(7 x) + Si(3 x)]/10
      [Gradshteyn and Ryzhik 5.31(1)] *)

Integrate[Cos[5*x]*CosIntegral[2*x], x]

(* => 1/2 [f(x) - g(x)]/[f(x) + g(x)]   [Gradshteyn and Ryzhik 
2.02(25)] *)

Integrate[(D[f[x], x]*g[x] - f[x]*D[g[x], x])/(f[x]^2 - g[x]^2), x]

                                 1

(* ---------- Quit ---------- *)
