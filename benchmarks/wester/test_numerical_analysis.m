(* Extracted from https://math.unm.edu/~wester/demos/NumericalAnalysis/Math.problems
   Source index: https://math.unm.edu/~wester/cas_review.html *)

(* ----------[ M a t h e m a t i c a ]---------- *)

(* ---------- Initialization ---------- *)

(* ---------- Numerical Analysis ---------- *)

(* This number should immediately simplify to 0.0 *)

0.0/Sqrt[2]

(* This number normally produces an underflow => 3.29683e-434295 *)

Exp[-1000000.0]

(* Arbitrary precision floating point numbers
   This number is nearly an integer:
   26253741 2640768743.9999999999 9925007259 7198185688 ... *)

N[Exp[Sqrt[163]*Pi], 50]

(* => [-2, -1] *)

{Floor[-5/3], Ceiling[-5/3]}

(* Generate a cubic natural spline s from x = [1, 2, 4, 5] and y = 
[1, 4, 2, 3]
   and then compute s(3) => 27/8 *)

<< NumericalMath`SplineFit`

s = SplineFit[Transpose[{{1, 2, 4, 5}, {1, 4, 2, 3}}], Cubic]

s[1.5]

Clear[s]

(* Translation *)

p = Sum[a[i]*x^i, {i, 1, n}]

(* Convert into FORTRAN syntax *)

FortranForm[p]

(* Convert into C syntax *)

CForm[p]

(* Horner's rule---this is important for numerical algorithms
   => (a[1] + (a[2] + (a[3] + (a[4] + a[5] x) x) x) x) x *)

<< NumericalMath`Horner`

p = Sum[a[i]*x^i, {i, 1, 5}]

p = Horner[p, x]

(* Convert the result into FORTRAN syntax
   => p = (a(1) + (a(2) + (a(3) + (a(4) + a(5)*x)*x)*x)*x)*x *)

FortranForm[p]

(* Convert the result into C syntax
   => p = (a[1] + (a[2] + (a[3] + (a[4] + a[5]*x)*x)*x)*x)*x ; *)

CForm[p]

Clear[p]

(* Count the number of (floating point) operations needed to compute 
an
   expression => {[+, n - 1], [*, (n^2 - n)/2], [f, (n^2 + n)/2]} *)

Sum[Product[f[i, k], {i, 1, k}], {k, 1, n}]

(* Interval analysis (interval polynomial example):
   ([-4, 2] x + [1, 3])^2 => [-8, 16] x^2 + [-24, 12] x + [1, 9] *)

Expand[(Interval[{-4, 2}]*x + Interval[{1, 3}])^2]

Expand[(Interval[{-4, 2}]*x + Interval[{1, 3}]) *
       (Interval[{-4, 2}]*x + Interval[{1, 3}])]

Expand[{Interval[{-4, 2}]^2, Interval[{-4, 2}]*Interval[{-4, 2}]}]

(* Discretize a PDE: for example, forward differencing time 
(explicit Euler)
   and central differencing x on the heat equation =>
   (f[i, j+1] - f[i, j])/dt = (f[i+1, j] - 2 f[i, j] + f[i-1, j])/dx^2 *)

D[f[x, t], t] == D[f[x, t], {x, 2}]

(* ---------- Quit ---------- *)
