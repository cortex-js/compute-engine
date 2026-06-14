(* Extracted from https://math.unm.edu/~wester/demos/Trigonometry/Math.problems
   Source index: https://math.unm.edu/~wester/cas_review.html *)

(* ----------[ M a t h e m a t i c a ]---------- *)

(* ---------- Initialization ---------- *)

(* ---------- Trigonometry ---------- *)

(* => - [(sqrt(5) + 1) sqrt(2)]/[(sqrt(5) - 1) sqrt(sqrt(5) + 5)]
      = - sqrt[1 + 2/sqrt(5)]
   From B. F. Caviness, Robert P. Gilbert, Wolfram Koepf, Roman Shtokhamer 
and
   David W. Wood, _An Introduction to Applied Symbolic Computation using
   MACSYMA_, University of Delaware, draft of December 14, 1993, section 
2.3.3.
   *)

Tan[7*Pi/10]

(* => - cos 3 *)

Sqrt[(1 + Cos[6])/2]

Simplify[%]

(* cos(n pi) + sin((4 n - 1)/2 pi) => (-1)^n - 1 for integer n *)

Cos[n*Pi] + Sin[(4*n - 1)/2 * Pi]

Simplify[%]

(* cos(cos(n pi) pi) + sin(cos(n pi) pi/2) => -1 + (-1)^n for 
integer n *)

Cos[Cos[n*Pi]*Pi] + Sin[Cos[n*Pi]*Pi/2]

(* sin([n^5/5 + n^4/2 + n^3/3 - n/30] pi) => 0 for integer n
   [Paul Zimmermann] *)

Sin[(n^5/5 + n^4/2 + n^3/3 - n/30) * Pi]

(* | cos x |, | sin x | => - cos x, - sin x  for  - 3 pi < x < - 5/2 
pi *)

(*assume[-3*Pi < x < -5/2*Pi]*)

{Abs[Cos[x]], Abs[Sin[x]]}

(* Trigonometric manipulations---these are typically difficult for 
students *)

r = Cos[3*x]/Cos[x]

( (* => cos(x)^2 - 3 sin(x)^2 or similar *)
TrigExpand[r] )

( (* => 2 cos(2 x) - 1 *)
TrigReduce[TrigExpand[r]] )

(* Use rewrite rules => cos(x)^2 - 3 sin(x)^2 *)

sincosAngles = {
   Cos[n_Integer * x_] -> Cos[(n - 1)*x] * Cos[x] - Sin[(n - 1)*x] * Sin[x],
   Sin[n_Integer * x_] -> Sin[(n - 1)*x] * Cos[x] + Cos[(n - 1)*x] * Sin[x] }

r //. sincosAngles

Expand[%]

Clear[r]

(* Here is a tricky way of writing 0/0 *)

expr = (Tan[x]^2 + 1 - Sec[x]^2)/(Sin[x]^2 + Cos[x]^2 - 1)

(* Let's try simplifying this expression! *)

Simplify[expr]

                                 1

(* What is its limit at zero? *)

Limit[expr, x -> 0]

(* What is the derivative? *)

D[expr, x]

Clear[expr]

(* ---------- Quit ---------- *)
