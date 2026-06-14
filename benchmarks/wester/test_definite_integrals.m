(* Extracted from https://math.unm.edu/~wester/demos/DefiniteIntegrals/Math.problems
   Source index: https://math.unm.edu/~wester/cas_review.html *)

(* ----------[ M a t h e m a t i c a ]---------- *)

(* ---------- Initialization ---------- *)

(* ---------- Definite Integrals ---------- *)

(* The following two functions have a pole at a.  The first integral 
has a
   principal value of zero; the second is divergent *)

Integrate[1/(x - a), {x, a - 1, a + 1}]

                               1

Integrate[1/(x - a), {x, a - 1, a + 1}, PrincipalValue -> True]

Integrate[1/(x - a)^2, {x, a - 1, a + 1}]

(* Different branches of the square root need to be chosen in the 
intervals
   [0, 1] and [1, 2].  The correct results are 4/3, [4 - sqrt(8)]/3,
   [8 - sqrt(8)]/3, respectively *)

Integrate[Sqrt[x + 1/x - 2], {x, 0, 1}]

Integrate[Sqrt[x + 1/x - 2], {x, 1, 2}]

Integrate[Sqrt[x + 1/x - 2], {x, 0, 2}]

(* => sqrt(2)   [a modification of a problem due to W. Kahan] *)

Integrate[Sqrt[2 - 2*Cos[2*x]]/2, {x, -3*Pi/4, -Pi/4}]

(* Contour integrals => pi/a e^(-a) for a > 0.  See Norman Levinson 
and
   Raymond M. Redheffer, _Complex Variables_, Holden-Day, Inc., 1970, p. 198.
   *)

Integrate[Cos[x]/(x^2 + a^2), {x, -Infinity, Infinity},
          Assumptions -> a > 0]

(* Integrand with a branch point => pi/sin(pi a) for 0 < a < 1
   [Levinson and Redheffer, p. 212] *)

Integrate[t^(a - 1)/(1 + t), {t, 0, Infinity}, Assumptions -> 0 < a 
< 1]

(* Integrand with a residue at infinity => -2 pi [sin(pi/5) + sin(2 
pi/5)]
   (principal value)   [Levinson and Redheffer, p. 234] *)

Integrate[5*x^3/(1 + x + x^2 + x^3 + x^4), {x, -Infinity, Infinity},
          PrincipalValue -> True]

(* integrate(1/[1 + x + x^2 + ... + x^(2 n)], x = 
-infinity..infinity)
   = 2 pi/(2 n + 1) [1 + cos(pi/[2 n + 1])] csc(2 pi/[2 n + 1])
   [Levinson and Redheffer, p. 255] => 2 pi/5 [1 + cos(pi/5)] csc(2 pi/5) *)

Integrate[1/(1 + x + x^2 + x^4), {x, -Infinity, Infinity}]

(* Integrand with a residue at infinity and a branch cut => pi 
[sqrt(2) - 1]
   [Levinson and Redheffer, p. 234] *)

Integrate[Sqrt[1 - x^2]/(1 + x^2), {x, -1, 1}]

                                 1

Simplify[%]

(* This is a common integral in many physics calculations
   => q/p sqrt(pi/p) e^(q^2/p)   (Re p > 0)   [Gradshteyn and Ryzhik 
3.462(6)]
   *)

Integrate[x*Exp[-p*x^2 + 2*q*x], {x, -Infinity, Infinity}]

(* => 2 Euler's_constant   [Gradshteyn and Ryzhik 8.367(5-6)] *)

Integrate[1/Log[t] + 1/(1 - t) - Log[Log[1/t]], {t, 0, 1}]

(* This integral comes from atomic collision theory => 0   [John 
Prentice] *)

Integrate[Sin[t]/t*Exp[2*I*t], {t, -Infinity, Infinity}]

(* => 1/12   [Gradshteyn and Ryzhik 6.443(3)] *)

Integrate[Log[Gamma[x]]*Cos[6*Pi*x], {x, 0, 1}]

(* => 36/35   [Gradshteyn and Ryzhik 7.222(2)] *)

Integrate[(1 + x)^3*LegendreP[1, x]*LegendreP[2, x], {x, -1, 1}]

(* => 1/sqrt(a^2 + b^2)   (a > 0 and b real)
      [Gradshteyn and Ryzhik 6.611(1)] *)

Integrate[Exp[-a*x]*BesselJ[0, b*x], {x, 0, Infinity}]

(* Integrand contains a special function => 4/(3 pi)   [Tom 
Hagstrom] *)

Integrate[(BesselJ[1, x]/x)^2, {x, 0, Infinity}]

(* => (cos 7 - 1)/7   [Gradshteyn and Ryzhik 6.782(3)] *)

Integrate[CosIntegral[x]*BesselJ[0, 2*Sqrt[7*x]], {x, 0, Infinity}]

(* This integral comes from doing a two loop Feynman diagram for a 
QCD problem
   => - [17/3 + pi^2]/36 + log 2/9 [35/3 - pi^2/2 - 4 log 2 + log(2)^2]
      + zeta(3)/4 = 0.210883...   [Rolf Mertig] *)

Integrate[x^2*PolyLog[3, 1/(x + 1)], {x, 0, 1}]

NIntegrate[x^2*PolyLog[3, 1/(x + 1)], {x, 0, 1}]

N[- (17/3 + Pi^2)/36 + Log[2]/9*(35/3 - Pi^2/2 - 4*Log[2] + Log[2]^2)
  + Zeta[3]/4]

(* Integrate a piecewise defined step function s(t) multiplied by 
cos t, where
   s(t) = 0   (t < 1);   1   (1 <= t <= 2);   0   (t > 2)
   => 0   (u < 1);   sin u - sin 1   (1 <= u <= 2);   sin 2 - sin 1   (u > 2)
   *)

s[t_]:= If[1 <= t <= 2, 1, 0];

Integrate[s[t]*Cos[t], {t, 0, u}]

<< Calculus`DiracDelta`

s[t_]:= UnitStep[t - 1] - UnitStep[t - 2];

Integrate[s[t]*Cos[t], {t, 0, u}]

Clear[s]

(* Integrating first with respect to y and then x is much easier than
   integrating first with respect to x and then y
   => (|b| - |a|) pi   [W. Kahan] *)

integrate[e_, limits_, assumptions___]:=
   If[Head[e] =!= If, Integrate[e, limits, assumptions],
      Module[{I1 = Integrate[e[[2]], limits, assumptions],
              I2 = Integrate[e[[3]], limits, assumptions]},
             IF[e[[1]], I1, I2]]]

(* Note: e[[3]] evaluates to e in the above which is a bug! *)

Integrate[Integrate[x/(x^2 + y^2), {y, -Infinity, Infinity}], {x, a, 
b},
          Assumptions -> {a > 0, b > 0}]

Integrate[Integrate[x/(x^2 + y^2), {x, a, b}], {y, -Infinity, 
Infinity},
          Assumptions -> {a > 0, b > 0}]

Integrate[Integrate[x/(x^2 + y^2), {y, -Infinity, Infinity}], {x, a, 
b},
          Assumptions -> {a < 0, b > 0}]

Integrate[Integrate[x/(x^2 + y^2), {x, a, b}], {y, -Infinity, 
Infinity},
          Assumptions -> {a < 0, b > 0}]

Integrate[Integrate[x/(x^2 + y^2), {y, -Infinity, Infinity}], {x, a, 
b},
          Assumptions -> {a < 0, b < 0}]

Integrate[Integrate[x/(x^2 + y^2), {x, a, b}], {y, -Infinity, 
Infinity},
          Assumptions -> {a < 0, b < 0}]

integrate[Integrate[x/(x^2 + y^2), {y, -Infinity, Infinity}], {x, a, 
b},
          Assumptions -> {a > 0, b > 0}]

integrate[Integrate[x/(x^2 + y^2), {y, -Infinity, Infinity}], {x, a, 
b},
          Assumptions -> {a < 0, b > 0}]

integrate[Integrate[x/(x^2 + y^2), {y, -Infinity, Infinity}], {x, a, 
b},
          Assumptions -> {a < 0, b < 0}]

(* => [log(sqrt(2) + 1) + sqrt(2)]/3   [Caviness et all, section 
2.10.1] *)

Integrate[Integrate[Sqrt[x^2 + y^2], {x, 0, 1}], {y, 0, 1}]

FullSimplify[%]

(* => (pi a)/2   [Gradshteyn and Ryzhik 4.621(1)] *)

Integrate[Integrate[Sin[a]*Sin[y]/Sqrt[1 - 
Sin[a]^2*Sin[x]^2*Sin[y]^2],
                    {x, 0, Pi/2}],
          {y, 0, Pi/2}]

                                 1

Integrate[Sin[a]*Sin[y]/Sqrt[1 - Sin[a]^2*Sin[x]^2*Sin[y]^2], {x, 0, 
Pi/2}]

Simplify[%]

Integrate[%, {y, 0, Pi/2}]

(* => 46/15   [Paul Zimmermann] *)

Integrate[Integrate[Abs[y - x^2], {y, 0, 2}], {x, -1, 1}]

Integrate[Integrate[Abs[y - x^2], {y, 0, 2}, Assumptions -> -1 <= x 
<= 1],
          {x, -1, 1}]

                 2

Integrate[Abs[y - x^2], {y, 0, 2}]

Integrate[% /. {Re[x] -> x, Im[x] -> 0}, {x, -1, 1}]

(* Multiple integrals: volume of a tetrahedron => a b c / 6 *)

Integrate[Integrate[Integrate[1, {z, 0, c*(1 - x/a - y/b)}],
                    {y, 0, b*(1 - x/a)}],
          {x, 0, a}]

(* ---------- Quit ---------- *)
