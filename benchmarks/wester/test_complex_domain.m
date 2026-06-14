(* Extracted from https://math.unm.edu/~wester/demos/ComplexDomain/Math.problems
   Source index: https://math.unm.edu/~wester/cas_review.html *)

(* ----------[ M a t h e m a t i c a ]---------- *)

(* ---------- Initialization ---------- *)

(* ---------- The Complex Domain ---------- *)

(* Complex functions---separate into their real and imaginary parts.
   Here, variables default to COMPLEX.
   [Re(x + i y), Im(x + i y)] => [Re(x) - Im(y), Im(x) + Re(y)]
   for x and y complex *)

{Re[x + I*y], Im[x + I*y]}

ComplexExpand[%]

(* => 1   [W. Kahan] *)

Abs[3 - Sqrt[7] + I*Sqrt[6*Sqrt[7] - 15]]

Simplify[%]

(* => 1/sqrt(a^2 + (1/a + b)^2) for real a, b *)

Abs[1/(a + I/a + I*b)]

ComplexExpand[%]

(* This is a challenge problem proposed by W. Kahan: simplify the 
following
   expression for complex z.  Expanding out the expression produces
   (z^2 + 1)/(2 z) +- (z + 1)*(z - 1)/(2 z) => z or 1/z in each of its 
branches
   *)

(* => log 5 + i arctan(4/3) *)

ComplexExpand[Log[3 + 4*I]]

(* => [sin(x) cos(x) + i sinh(y) cosh(y)] / [cos(x)^2 + sinh(y)^2] *)

ComplexExpand[Tan[x + I*y]]

(* Check for branch abuse.  See David R. Stoutemyer, ``Crimes and 
Misdemeanors
   in the Computer Algebra Trade'', _Notices of the American Mathematical
   Society_, Volume 38, Number 7, September 1991, 778--785.  This first
   expression can simplify to sqrt(x y)/sqrt(x), but no further in general
   (consider what happens when x, y = -1).  sqrt(x y) = sqrt(x) sqrt(y) if
   either x >= 0 or y >= 0 or both x and y lie in the right-half plane
   (Re x, Re y > 0) [considering principal values]. *)

expr = Sqrt[x*y*Abs[z]^2] / (Sqrt[x]*Abs[z])

Simplify[%]

ComplexExpand[%]

FullSimplify[%]

(* Special case: sqrt(x y |z|^2)/(sqrt(x) |z|) => sqrt(y) [PV] for y 
>= 0 *)

PowerExpand[expr]

(* sqrt(1/z) = 1/sqrt(z) except when z is real and negative, in 
which case
   sqrt(1/z) = - 1/sqrt(z) [considering principal values] *)

Sqrt[1/z] - 1/Sqrt[z]

Simplify[%]

( (* Special case: sqrt(1/z) - 1/sqrt(z) => 0 [PV] for z > 0 *)
PowerExpand[%] )

(* Special case: sqrt(1/z) + 1/sqrt(z) => 0 [PV] for z < 0 *)

(* sqrt(e^z) = e^(z/2) if and only if Im z is contained in the 
interval
   ((4 n - 1) pi, (4 n + 1) pi] for n an integer: ..., (-5 pi, -3 pi],
   (-pi, pi], (3 pi, 5 pi], ...; otherwise, sqrt(e^z) = - e^(z/2) 
[considering
   principal values] *)

Sqrt[E^z] - E^(z/2)

Simplify[%]

( (* Special case: sqrt(e^z) - e^(z/2) => 0 [PV] for z real *)
ComplexExpand[%] )

(* The principal value of this expression is - e^(3 i) = - cos 3 - i 
sin 3 *)

Sqrt[E^(6*I)]

ComplexExpand[%]

TrigReduce[%]

(* log(e^z) = z if and only if Im z is contained in the interval 
(-pi, pi]
   [considering principal values] *)

Log[E^z]

Simplify[%]

( (* Special case: log(e^z) => z [PV] for z real *)
ComplexExpand[%] )

(* The principal value of this expression is (10 - 4 pi) i *)

Log[E^(10*I)]

(* (x y)^n = x^n y^n if either x > 0 or y > 0 or both x and y lie in 
the
   right-half plane (Re x, Re y > 0) or n is an integer [considering 
principal
   values] *)

expr = (x*y)^(1/n) - x^(1/n)*y^(1/n)

Simplify[%]

ComplexExpand[%]

FullSimplify[%]

(* Special case: (x y)^(1/n) - x^(1/n) y^(1/n) => 0 [PV] for y > 0 *)

PowerExpand[expr, {y}]

(* Special case: (x y)^n - x^n y^n => 0 [PV] for integer n *)

(x*y)^n - x^n*y^n

(* arctan(tan(z)) = z for z real if and only if z is contained in 
the interval
   (-pi/2, pi/2] [considering principal values] *)

ArcTan[Tan[z]]

Simplify[%]

ComplexExpand[%]

Simplify[%]

Clear[expr]

(* Special case: arctan(tan(z)) => z [PV] for -pi/2 < z < pi/2 *)

(* The principal value of this expression is 10 - 3 pi *)

ArcTan[Tan[10]]

(* The principal value of this expression is 11 - 4 pi + 30 i = 
-1.56637 + 30 i
   *)

ArcTan[Tan[11 + 30*I]]

ArcTan[Tan[11.0 + 30.0*I]]

(* This is a challenge problem proposed by W. Kahan: simplify the 
following
   expression for complex z.  Expanding out the expression produces
   (z^2 + 1)/(2 z) +- (z + 1)*(z - 1)/(2 z) => z or 1/z in each of its 
branches
   *)

w = (z + 1/z)/2

expr = w + Sqrt[w + 1]*Sqrt[w - 1]

Simplify[expr]

Clear[w, expr]

(* ---------- Quit ---------- *)
