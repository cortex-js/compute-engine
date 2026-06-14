(* Extracted from https://math.unm.edu/~wester/demos/SetTheory/Math.problems
   Source index: https://math.unm.edu/~wester/cas_review.html *)

(* ----------[ M a t h e m a t i c a ]---------- *)

(* ---------- Initialization ---------- *)

(* ---------- Set Theory ---------- *)

x = {a, b, b, c, c, c};

y = {d, c, b};

z = {b, e, b};

(* [x \/ y \/ z, x /\ y /\ z] => [{a, b, c, d, e}, {b}] *)

{Union[x, y, z], Intersection[x, y, z]}

( (* x \/ y \/ z - x /\ y /\ z => {a, c, d, e} *)
Complement[%[[1]], %[[2]]] )

Clear[x, y, z]

(* Cartesian product of sets => {(a, c), (a, d), (b, c), (b, d)} *)

Flatten[Outer[List, {a, b}, {c, d}], 1]

(* ---------- Quit ---------- *)
