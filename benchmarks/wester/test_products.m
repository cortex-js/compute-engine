(* Extracted from https://math.unm.edu/~wester/demos/Products/Math.problems
   Source index: https://math.unm.edu/~wester/cas_review.html *)

(* ----------[ M a t h e m a t i c a ]---------- *)

(* ---------- Initialization ---------- *)

(* ---------- Products ---------- *)

(* => [640 pi^3]/[2187 sqrt(3)]   [Gradshteyn and Ryzhik 8.338(5)] *)

Product[Gamma[k/3], {k, 1, 8}]

FullSimplify[%]

(* => n! = gamma(n + 1) *)

Product[k, {k, 1, n}]

(* => x^[n (n + 1)/2] *)

Product[x^k, {k, 1, n}]

(* => n *)

Product[(1 + 1/k), {k, 1, n - 1}]

(* => 1/2^(2 n) binomial(2 n, n)   [Knopp, p. 385] *)

Product[(2*k - 1)/(2*k), {k, 1, n}]

(* => [x^(2 n) - 1]/(x^2 - 1)   [Gradshteyn and Ryzhik 1.396(1)] *)

Product[x^2 - 2*x*Cos[k*Pi/n] + 1, {k, 1, n - 1}]

(* => 2/3   [Knopp, p. 228] *)

Product[(k^3 - 1)/(k^3 + 1), {k, 2, Infinity}]

(* => 2/pi   [Gradshteyn and Ryzhik 0.262(2)] *)

Product[1 - 1/(2*k)^2, {k, 1, Infinity}]

(* => sqrt(2)   [Gradshteyn and Ryzhik 0.261] *)

Product[1 + (-1)^(k + 1)/(2*k - 1), {k, 1, Infinity}]

(* => -1   [Knopp, p. 436] *)

Product[(k*(k +  1) + 1 + I)/(k*(k + 1) + 1 - I), {k, 0, Infinity}]

(* ---------- Quit ---------- *)
