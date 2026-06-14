(* Extracted from https://math.unm.edu/~wester/demos/MathvsCS/Math.local
   Source index: https://math.unm.edu/~wester/cas_review.html *)

(* ----------[ M a t h e m a t i c a ]---------- *)

(* ---------- Initialization ---------- *)

(* ---------- Mathematics vs Computer Science ---------- *)

(* Is k really treated as a local variable in the following 
situations where it
   is clearly a mathematically local variable? *)

Sum[k, {k, 1, 4}]

Product[k, {k, 1, 3}]

Limit[k, k -> 0]

Integrate[k, {k, 0, 1}]

k = 1;

Sum[k, {k, 1, 4}]

Product[k, {k, 1, 3}]

Limit[k, k -> 0]

Integrate[k, {k, 0, 1}]

(* ---------- Quit ---------- *)
