(* Extracted from https://math.unm.edu/~wester/demos/BooleanLogic/Math.problems
   Source index: https://math.unm.edu/~wester/cas_review.html *)

(* ----------[ M a t h e m a t i c a ]---------- *)

(* ---------- Initialization ---------- *)

(* ---------- Boolean Logic and Quantifier Elimination ---------- *)

(* Simplify logical expressions => false *)

True && False

(* => true *)

x || (! x)

LogicalExpand[%]

(* => x or y *)

x || y || (x && y)

LogicalExpand[%]

(* => x *)

Xor[Xor[x, y], y]

LogicalExpand[%]

(* => [not (w and x)] or (y and z) *)

Implies[w && x, y && z]

LogicalExpand[%]

(* => (x and y) or [not (x or y)] *)

(*Iff[x, y]
  LogicalExpand[%]*)

(* => false *)

x && 1 > 2

(* Quantifier elimination: See Richard Liska and Stanly Steinberg, 
``Using
   Computer Algebra to Test Stability'', draft of September 25, 1995, and
   Hoon Hong, Richard Liska and Stanly Steinberg, ``Testing Stability by
   Quantifier Elimination'', _Journal of Symbolic Computation_, Volume 24,
   1997, 161--187. *)

(* => (a > 0 and b > 0 and c > 0) or (a < 0 and b < 0 and c < 0)
      [Hong, Liska and Steinberg, p. 169] *)

(*forAll y in C {Implies[a*y^2 + b*y + c == 0, Re[y] < 0]}*)

(* => v > 1   [Liska and Steinberg, p. 24] *)

(*thereExists w in R suchThat
  {v > 0 and w > 0 and -5*v^2 - 13*v + v*w - w > 0}*)

(* => a^2 <= 1/2   [Hoon, Liska and Steinberg, p. 174] *)

(*forAll c in R
  {Implies[-1 <= c <= 1, a^2*(-c^4 - 2*c^3 + 2*c + 1) + c^2 + 2*c + 1 <= 
4]}*)

(* => v > 0 and w > |W|   [Liska and Steinberg, p. 22] *)

(*forAll y in C
  {Implies[v > 0 && y^4 + 4*v*w*y^3 + 2*(2*v^2*w^2 + w^2 + W^2)*y^2
           + 4*v*w*(w^2 - W^2) + (w^2 - W^2)^2 == 0, Re[y] < 0]}*)

(* This quantifier free problem was derived from the above example 
by QEPCAD
   => v > 0 and w > |W|   [Liska and Steinberg, p. 22] *)

(v > 0 && 4*w*v > 0 && 4*w*(4*w^2*v^2 + 3*W^2 + w^2) > 0
    && 64*w^2*v^2*(w^2 - W^2)*(w^2*v^2 + W^2) > 0
    && 64*w^2*v^2*(w^2 - W^2)^3*(w^2*v^2 + W^2) > 0)

LogicalExpand[%]

(* => B < 0 and a b > 0   [Liska and Steinberg, p. 49 (equation 86)] 
*)

(*thereExists y in C, thereExists n in C, thereExists e in R suchThat
  {Re[y] > 0 && Re[n] < 0 && y + A*I*e - B*n == 0 && a*n + b == 0}*)

(* ---------- Quit ---------- *)
