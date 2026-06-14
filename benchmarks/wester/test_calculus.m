(* Extracted from https://math.unm.edu/~wester/demos/Calculus/Math.problems
   Source index: https://math.unm.edu/~wester/cas_review.html *)

(* ----------[ M a t h e m a t i c a ]---------- *)

(* ---------- Initialization ---------- *)

(* ---------- Calculus ---------- *)

(* Calculus on a non-smooth (but well defined) function => x/|x| or 
sign(x)
   *)

D[Abs[x], x]

D[ComplexExpand[Abs[x]], x]

(* Calculus on a piecewise defined function *)

a[x_]:= If[x < 0, -x, x]

(* => if x < 0 then -1 else 1 *)

D[a[x], x]

<< Calculus`DiracDelta`

a[x_]:= -x*UnitStep[-x] + x*UnitStep[x]

D[a[x], x]

Clear[a]

(* Derivative of a piecewise defined function at a point [Herbert 
Fischer]. 
   f(x) = x^2 - 1 for x = 1 otherwise x^3.  f(1) = 0 and f'(1) = 3 *)

f[x_]:= If[x == 1, x^2 - 1, x^3]

f[1]

D[f[x], x]

f'[1]

Clear[f]

(* d^n/dx^n(x^n) => n! *)

D[x^n, {x, n}]

(* Apply the chain rule---this is important for PDEs and many other
   applications => y_xx (x_t)^2 + y_x x_tt *)

D[y[x[t]], {t, 2}]

(* => f(h(x)) dh/dx - f(g(x)) dg/dx *)

Integrate[f[y], {y, g[x], h[x]}]

D[%, x]

(* Exact differential => d(V(P, T)) => dV/dP DP + dV/dT DT *)

Dt[V[P, T]]

(* Implicit differentiation => dy/dx = [1 - y sin(x y)] / [1 + x 
sin(x y)] *)

y == Cos[x*y] + x

Simplify[Map[# / Dt[x] &, Solve[Dt[%], Dt[y]][[1, 1]] ]]

(* => 2 (x + y) g'(x^2 + y^2) *)

D[f[x, y], x] + D[f[x, y], y]

Factor[% /. f -> Apply[Function, {{x, y}, g[x^2 + y^2]}]]

(* Residue => - 9/4 *)

Residue[(z^3 + 5)/((z^4 - 1)*(z + 1)), {z, -1}]

(* Differential forms *)

(* (2 dx + dz) /\ (3 dx + dy + dz) /\ (dx + dy + 4 dz) => 8 dx /\ dy 
/\ dz *)

(* d(3 x^5 dy /\ dz + 5 x y^2 dz /\ dx + 8 z dx /\ dy)
   => (15 x^4 + 10 x y + 8) dx /\ dy /\ dz *)

(* => 1 - 3/8 2^(1/3) = 0.5275296 *)

FindMinimum[x^4 - x + 1, {x, 0}]

(* => [0, 1] *)

{FindMinimum[1/(x^2 + y^2 + 1), {x, 1}, {y, 1}],
 FindMaximum[1/(x^2 + y^2 + 1), {x, 0}, {y, 0}]}

(* Minimize on [-1, 1] x [-1, 1]:
   => min(a - b - c + d, a - b + c - d, a + b - c - d, a + b + c + d) *)

(*FindMinimum[a + b*x + c*y + d*x*y, {x, -1, 1}, {y, -1, 1}]*)

(* => [-1, 1] *)

(*{FindMinimum[x^2*y^3, {x, -1, 1}, {y, -1, 1}],
   FindMaximum[x^2*y^3, {x, -1, 1}, {y, -1, 1}]}*)

(* Linear programming: minimize the objective function z subject to 
the
   variables xi being non-negative along with an additional set of 
constraints.
   See William R. Smythe, Jr. and Lynwood A. Johnson, _Introduction to Linear
   Programming, with Applications_, Prentice Hall, Inc., 1966, p. 117:
   minimize z = 4 x1 - x2 + 2 x3 - 2 x4 => {x1, x2, x3, x4}  = {2, 0, 2, 4}
   with zmin = 4 *)

ConstrainedMin[4*x1 - x2 + 2*x3 - 2*x4, {2*x1 + x2 + x3 + x4 <= 10,
              x1 - 2*x2 - x3 + x4 >= 4, x1 + x2 + 3*x3 - x4 >= 4,
              x1 >= 0, x2 >= 0, x3 >= 0, x4 >= 0}, {x1, x2, x3, x4}]

(* ---------- Quit ---------- *)
