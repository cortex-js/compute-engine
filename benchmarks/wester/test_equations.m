(* Extracted from https://math.unm.edu/~wester/demos/Equations/Math.problems
   Source index: https://math.unm.edu/~wester/cas_review.html *)

(* ----------[ M a t h e m a t i c a ]---------- *)

(* ---------- Initialization ---------- *)

(* ---------- Equations ---------- *)

(* Manipulate an equation using a natural syntax:
   (x = 2)/2 + (1 = 1) => x/2 + 1 = 2 *)

(x == 2)/2 + (1 == 1)

Map[#/2 + 1 &, x == 2]

(* Solve various nonlinear equations---this cubic polynomial has all 
real roots
   *)

Solve[3*x^3 - 18*x^2 + 33*x - 19 == 0, x]

Map[#[[1]] -> ComplexExpand[#[[2]]] &, Flatten[%]]

(* Some simple seeming problems can have messy answers:
   x = {  [sqrt(5) - 1]/4 +/- 5^(1/4) sqrt(sqrt(5) + 1)/[2 sqrt(2)] i,
        - [sqrt(5) + 1]/4 +/- 5^(1/4) sqrt(sqrt(5) - 1)/[2 sqrt(2)] i} *)

eqn = x^4 + x^3 + x^2 + x + 1 == 0

Solve[eqn, x]

Map[#[[1]] -> ComplexExpand[#[[2]]] &, Flatten[%]]

( (* Check one of the answers *)
eqn /. %[[1]] )

Simplify[%]

Clear[eqn]

(* x = {2^(1/3) +- sqrt(3), +- sqrt(3) - 1/2^(2/3) +- i 
sqrt(3)/2^(2/3)} 
       [Mohamed Omar Rayes] *)

Solve[x^6 - 9*x^4 - 4*x^3 + 27*x^2 - 36*x - 23 == 0, x]

ToRadicals[%]

(* x = {1, e^(+- 2 pi i/7), e^(+- 4 pi i/7), e^(+- 6 pi i/7)} *)

Solve[x^7 - 1 == 0, x]

(* x = 1 +- sqrt(+-sqrt(+-4 sqrt(3) - 3) - 3)/sqrt(2)   [Richard 
Liska] *)

Solve[x^8 - 8*x^7 + 34*x^6 - 92*x^5 + 175*x^4 - 236*x^3 + 226*x^2 - 
140*x + 46
      == 0, x]

(* The following equations have an infinite number of solutions (let 
n be an
   arbitrary integer):
   x = {log(sqrt(z) - 1), log(sqrt(z) + 1) + i pi} [+ n 2 pi i, + n 2 pi i] 
*)

E^(2*x) + 2*E^x + 1 == z

Simplify[Solve[%, x]]

(* x = (1 +- sqrt(9 - 8 n pi i))/2.  Real solutions correspond to n 
= 0 =>
   x = {-1, 2} *)

Solve[Exp[2 - x^2] == Exp[-x], x]

(* x = -W[n](-1) [e.g., -W[0](-1) = 0.31813 - 1.33724 i] where 
W[n](x) is the
   nth branch of Lambert's W function *)

Solve[Exp[x] == x, x]

(* x = {-1, 1} *)

Solve[x^x == x, x]

(* This equation is already factored and so *should* be easy to 
solve:
   x = {-1, 2*{+-arcsinh(1) i + n pi}, 3*{pi/6 + n pi/3}} *)

(x + 1) * (Sin[x]^2 + 1)^2 * Cos[3*x]^3 == 0

Solve[%, x]

(* x = pi/4 [+ n pi] *)

Solve[Sin[x] == Cos[x], x]

Solve[Tan[x] == 1, x]

(* x = {pi/6, 5 pi/6} [ + n 2 pi, + n 2 pi ] *)

Solve[Sin[x] == 1/2, x]

(* x = {0, 0} [+ n pi, + n 2 pi] *)

Solve[Sin[x] == Tan[x], x]

(* x = {0, 0, 0} *)

Solve[ArcSin[x] == ArcTan[x], x]

(* x = sqrt[(sqrt(5) - 1)/2] *)

Solve[ArcCos[x] == ArcTan[x], x]

FullSimplify[%]

(* x = 2 *)

Solve[(x - 2)/x^(1/3) == 0, x]

(* This equation has no solutions *)

Solve[Sqrt[x^2 + 1] == x - 2, x]

(* x = 1 *)

Solve[x + Sqrt[x] == 2, x]

(* x = 1/16 *)

Solve[2*Sqrt[x] + 3*x^(1/4) - 2 == 0, x]

(* x = {sqrt[(sqrt(5) - 1)/2], -i sqrt[(sqrt(5) + 1)/2]} *)

Solve[x == 1/Sqrt[1 + x^2], x]

(* This problem is from a computational biology talk => 1 - log_2[m 
(m - 1)] *)

Solve[Binomial[m, 2]*2^k == 1, k]

(* x = log(c/a) / log(b/d) for a, b, c, d != 0 and b, d != 1   [Bill 
Pletsch] *)

Solve[a*b^x == c*d^x, x]

(* x = {1, e^4} *)

Solve[Sqrt[Log[x]] == Log[Sqrt[x]], x]

(* Recursive use of inverses, including multiple branches of rational
   fractional powers   [Richard Liska]
   => x = +-(b + sin(1 + cos(1/e^2)))^(3/2) *)

Solve[Log[ArcCos[ArcSin[x^(2/3) - b] - 1]] + 2 == 0, x]

Simplify[%]

(* x = {-0.784966, -0.016291, 0.802557}  From Metha Kamminga-van 
Hulsen,
   ``Hoisting the Sails and Casting Off with Maple'', _Computer Algebra
   Nederland Nieuwsbrief_, Number 13, December 1994, ISSN 1380-1260, 27--40. 
*)

eqn = 5*x + Exp[(x - 5)/2] == 8*x^3

Solve[eqn, x]

FindRoot[eqn, {x, -0.75}]

FindRoot[eqn, {x,  0}]

FindRoot[eqn, {x,  0.75}]

Clear[eqn]

(* x = {-1, 3} *)

Solve[Abs[x - 1] == 2, x]

(* x = {-1, -7} *)

Solve[Abs[2*x + 5] == Abs[x - 2], x]

(* x = +-3/2 *)

Solve[1 - Abs[x] == Max[-x - 2, x - 2], x]

(* x = {-1, 3} *)

Solve[Max[2 - x^2, x] == Max[-x, x^3/9], x]

(* x = {+-3, -3 [1 + sqrt(3) sin t + cos t]} = {+-3, -1.554894}
   where t = (arctan[sqrt(5)/2] - pi)/3.  The third answer is the root of
   x^3 + 9 x^2 - 18 = 0 in the interval (-2, -1). *)

solns = Solve[Max[2 - x^2, x] == x^3/9, x]

FullSimplify[%]

N[%]

Map[#[[1]] -> ComplexExpand[#[[2]]] &, Flatten[solns]]

Clear[solns]

(* z = 2 + 3 i *)

eqn = (1 + I)*z + (2 - I)*Conjugate[z] == -3*I

Solve[eqn, z]

eqn /. z -> x + I*y

Solve[%, {x, y}]

ComplexExpand[eqn /. z -> x + I*y]

Solve[%, {x, y}]

Clear[eqn]

(* => {f^(-1)(1), f^(-1)(-2)} assuming f is invertible *)

Solve[f[x]^2 + f[x] - 2 == 0, x]

Clear[eqns, vars]

(* Solve a 3 x 3 system of linear equations *)

eqn1 =   x +   y +   z ==  6

eqn2 = 2*x +   y + 2*z == 10

eqn3 =   x + 3*y +   z == 10

(* Note that the solution is parametric: x = 4 - z, y = 2 *)

Solve[{eqn1, eqn2, eqn3}, {x, y, z}]

(* A linear system arising from the computation of a truncated 
power series
   solution to a differential equation.  There are 189 equations to be solved
   for 49 unknowns.  42 of the equations are repeats of other equations; many
   others are trivial.  Solving this system directly by Gaussian elimination
   is *not* a good idea.  Solving the easy equations first is probably a 
better
   method.  The solution is actually rather simple.   [Stanly Steinberg]
   => k1 = ... = k22 = k24 = k25 = k27 = ... = k30 = k32 = k33 = k35 = ...
      = k38 = k40 = k41 = k44 = ... = k49 = 0, k23 = k31 = k39,
      k34 = b/a k26, k42 = c/a k26, {k23, k26, k43} are arbitrary *)

eqns = {
 -b*k8/a+c*k8/a == 0, -b*k11/a+c*k11/a == 0, -b*k10/a+c*k10/a+k2 == 0,
 -k3-b*k9/a+c*k9/a == 0, -b*k14/a+c*k14/a == 0, -b*k15/a+c*k15/a == 0,
 -b*k18/a+c*k18/a-k2 == 0, -b*k17/a+c*k17/a == 0, -b*k16/a+c*k16/a+k4 == 0,
 -b*k13/a+c*k13/a-b*k21/a+c*k21/a+b*k5/a-c*k5/a == 0, b*k44/a-c*k44/a == 0,
 -b*k45/a+c*k45/a == 0, -b*k20/a+c*k20/a == 0, -b*k44/a+c*k44/a == 0,
  b*k46/a-c*k46/a == 0, b^2*k47/a^2-2*b*c*k47/a^2+c^2*k47/a^2 == 0, k3 == 0,
 -k4 == 0, -b*k12/a+c*k12/a-a*k6/b+c*k6/b == 0,
 -b*k19/a+c*k19/a+a*k7/c-b*k7/c == 0, b*k45/a-c*k45/a == 0,
 -b*k46/a+c*k46/a == 0, -k48+c*k48/a+c*k48/b-c^2*k48/(a*b) == 0,
 -k49+b*k49/a+b*k49/c-b^2*k49/(a*c) == 0, a*k1/b-c*k1/b == 0,
  a*k4/b-c*k4/b == 0, a*k3/b-c*k3/b+k9 == 0, -k10+a*k2/b-c*k2/b == 0,
  a*k7/b-c*k7/b == 0, -k9 == 0, k11 == 0, b*k12/a-c*k12/a+a*k6/b-c*k6/b == 0,
  a*k15/b-c*k15/b == 0, k10+a*k18/b-c*k18/b == 0, -k11+a*k17/b-c*k17/b == 0,
  a*k16/b-c*k16/b == 0, -a*k13/b+c*k13/b+a*k21/b-c*k21/b+a*k5/b-c*k5/b == 0,
 -a*k44/b+c*k44/b == 0, a*k45/b-c*k45/b == 0,
  a*k14/c-b*k14/c+a*k20/b-c*k20/b == 0, a*k44/b-c*k44/b == 0,
 -a*k46/b+c*k46/b == 0, -k47+c*k47/a+c*k47/b-c^2*k47/(a*b) == 0,
  a*k19/b-c*k19/b == 0, -a*k45/b+c*k45/b == 0, a*k46/b-c*k46/b == 0,
  a^2*k48/b^2-2*a*c*k48/b^2+c^2*k48/b^2 == 0,
 -k49+a*k49/b+a*k49/c-a^2*k49/(b*c) == 0, k16 == 0, -k17 == 0,
 -a*k1/c+b*k1/c == 0, -k16-a*k4/c+b*k4/c == 0, -a*k3/c+b*k3/c == 0,
  k18-a*k2/c+b*k2/c == 0, b*k19/a-c*k19/a-a*k7/c+b*k7/c == 0,
 -a*k6/c+b*k6/c == 0, -a*k8/c+b*k8/c == 0, -a*k11/c+b*k11/c+k17 == 0,
 -a*k10/c+b*k10/c-k18 == 0, -a*k9/c+b*k9/c == 0,
 -a*k14/c+b*k14/c-a*k20/b+c*k20/b == 0,
 -a*k13/c+b*k13/c+a*k21/c-b*k21/c-a*k5/c+b*k5/c == 0, a*k44/c-b*k44/c == 0,
 -a*k45/c+b*k45/c == 0, -a*k44/c+b*k44/c == 0, a*k46/c-b*k46/c == 0,
 -k47+b*k47/a+b*k47/c-b^2*k47/(a*c) == 0, -a*k12/c+b*k12/c == 0,
  a*k45/c-b*k45/c == 0, -a*k46/c+b*k46/c == 0,
 -k48+a*k48/b+a*k48/c-a^2*k48/(b*c) == 0,
  a^2*k49/c^2-2*a*b*k49/c^2+b^2*k49/c^2 == 0, k8 == 0, k11 == 0, -k15 == 0,
  k10-k18 == 0, -k17 == 0, k9 == 0, -k16 == 0, -k29 == 0, k14-k32 == 0,
 -k21+k23-k31 == 0, -k24-k30 == 0, -k35 == 0, k44 == 0, -k45 == 0, k36 == 0,
  k13-k23+k39 == 0, -k20+k38 == 0, k25+k37 == 0, b*k26/a-c*k26/a-k34+k42 == 
0,
 -2*k44 == 0, k45 == 0, k46 == 0, b*k47/a-c*k47/a == 0, k41 == 0, k44 == 0,
 -k46 == 0, -b*k47/a+c*k47/a == 0, k12+k24 == 0, -k19-k25 == 0,
 -a*k27/b+c*k27/b-k33 == 0, k45 == 0, -k46 == 0, -a*k48/b+c*k48/b == 0,
  a*k28/c-b*k28/c+k40 == 0, -k45 == 0, k46 == 0, a*k48/b-c*k48/b == 0,
  a*k49/c-b*k49/c == 0, -a*k49/c+b*k49/c == 0, -k1 == 0, -k4 == 0, -k3 == 0,
  k15 == 0, k18-k2 == 0, k17 == 0, k16 == 0, k22 == 0, k25-k7 == 0,
  k24+k30 == 0, k21+k23-k31 == 0, k28 == 0, -k44 == 0, k45 == 0, -k30-k6 == 
0,
  k20+k32 == 0, k27+b*k33/a-c*k33/a == 0, k44 == 0, -k46 == 0,
 -b*k47/a+c*k47/a == 0, -k36 == 0, k31-k39-k5 == 0, -k32-k38 == 0,
  k19-k37 == 0, k26-a*k34/b+c*k34/b-k42 == 0, k44 == 0, -2*k45 == 0, k46 == 
0,
  a*k48/b-c*k48/b == 0, a*k35/c-b*k35/c-k41 == 0, -k44 == 0, k46 == 0,
  b*k47/a-c*k47/a == 0, -a*k49/c+b*k49/c == 0, -k40 == 0, k45 == 0, -k46 == 
0,
 -a*k48/b+c*k48/b == 0, a*k49/c-b*k49/c == 0, k1 == 0, k4 == 0, k3 == 0,
 -k8 == 0, -k11 == 0, -k10+k2 == 0, -k9 == 0, k37+k7 == 0, -k14-k38 == 0,
 -k22 == 0, -k25-k37 == 0, -k24+k6 == 0, -k13-k23+k39 == 0,
 -k28+b*k40/a-c*k40/a == 0, k44 == 0, -k45 == 0, -k27 == 0, -k44 == 0,
  k46 == 0, b*k47/a-c*k47/a == 0, k29 == 0, k32+k38 == 0, k31-k39+k5 == 0,
 -k12+k30 == 0, k35-a*k41/b+c*k41/b == 0, -k44 == 0, k45 == 0,
 -k26+k34+a*k42/c-b*k42/c == 0, k44 == 0, k45 == 0, -2*k46 == 0,
 -b*k47/a+c*k47/a == 0, -a*k48/b+c*k48/b == 0, a*k49/c-b*k49/c == 0, k33 == 
0,
 -k45 == 0, k46 == 0, a*k48/b-c*k48/b == 0, -a*k49/c+b*k49/c == 0
 };

vars = {k1, k2, k3, k4, k5, k6, k7, k8, k9, k10, k11, k12, k13, 
k14, k15, k16,
        k17, k18, k19, k20, k21, k22, k23, k24, k25, k26, k27, k28, k29, k30,
        k31, k32, k33, k34, k35, k36, k37, k38, k39, k40, k41, k42, k43, k44,
        k45, k46, k47, k48, k49};

Solve[eqns, vars]

(* Solve a 3 x 3 system of nonlinear equations *)

eqn1 = x^2*y + 3*y*z - 4 == 0

eqn2 = -3*x^2*z + 2*y^2 + 1 == 0

eqn3 = 2*y*z^2 - z^2 - 1 == 0

(* Solving this by hand would be a nightmare *)

Solve[{eqn1, eqn2, eqn3}, {x, y, z}]

N[%]

Clear[eqn1, eqn2, eqn3]

(* ---------- Quit ---------- *)
