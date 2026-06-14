(* Extracted from https://math.unm.edu/~wester/demos/Inequalities/Math.problems
   Source index: https://math.unm.edu/~wester/cas_review.html *)

(* ----------[ M a t h e m a t i c a ]---------- *)

(* ---------- Initialization ---------- *)

(* ---------- Inequalities ---------- *)

(* => True *)

E^Pi > Pi^E

(* => [True, False] *)

x/: Im[x] = 0

{x^4 - x + 1 > 0, x^4 - x + 1 > 1}

Remove[x]

(* => True *)

(*assume[Abs[x] < 1]*)

-1 < x && x < 1

(* x > y > 0 and k, n > 0   =>   k x^n > k y^n *)

(*assume[x > y, y > 0]*)

2*x^2 > 2*y^2

(*assume[k > 0]*)

k*x^2 > k*y^2

(*assume[n > 0]*)

k*x^n > k*y^n

(* x > 1 and y >= x - 1   =>   y > 0 *)

(*assume[x > 1, y >= x - 1]*)

y > 0

(* x >= y, y >= z, z >= x   =>   x = y = z *)

(*assume[x >= y, y >= z, z >= x]*)

{x == y, x == z, y == z}

(* x < -1 or x > 3 *)

<< Algebra`InequalitySolve`

InequalitySolve[Abs[x - 1] > 2, x]

(* x < 1 or 2 < x < 3 or 4 < x < 5 *)

InequalitySolve[Expand[(x - 1)*(x - 2)*(x - 3)*(x - 4)*(x - 5)] < 0, 
x]

(* x < 3 or x >= 5 *)

InequalitySolve[6/(x - 3) <= 3, x]

(* => 0 <= x < 4 *)

InequalitySolve[Sqrt[x] < 2, x]

(* => x is real *)

InequalitySolve[Sin[x] < 2, x]

(* => x != pi/2 + n 2 pi *)

InequalitySolve[Sin[x] < 1, x]

(* The next two examples come from Abdubrahim Muhammad Farhat, 
_Stability
   Analysis of Finite Difference Schemes_, Ph.D. dissertation, University of
   New Mexico, Albuquerque, New Mexico, December 1993 => 0 <= A <= 1/2 *)

InequalitySolve[Abs[2*A*(Cos[t] - 1) + 1] <= 1, A]

(* => 125 A^4 + 24 A^2 - 48 < 0   or   |A| < 2/5 sqrt([8 sqrt(6) - 
3]/5) *)

InequalitySolve[A^2*(Cos[t] - 4)^2*Sin[t]^2 < 9, A]

(* => |x| < y *)

InequalitySolve[{x + y > 0, x - y < 0}, {x, y}]

(* ---------- Quit ---------- *)
