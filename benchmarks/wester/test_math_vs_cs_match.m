(* Extracted from https://math.unm.edu/~wester/demos/MathvsCS/Math.match
   Source index: https://math.unm.edu/~wester/cas_review.html *)

(* ----------[ M a t h e m a t i c a ]---------- *)

(* ---------- Initialization ---------- *)

(* ---------- Mathematics vs Computer Science ---------- *)

(* Just how well are pattern matches between mathematically 
equivalent forms
   performed? *)

MatchQ[Exp[y], Exp[x_]]

MatchQ[E^y,    Exp[x_]]

MatchQ[Exp[y], E^x_]

MatchQ[E^y,    E^x_]

MatchQ[Sqrt[y], Sqrt[x_]]

MatchQ[y^(1/2), Sqrt[x_]]

MatchQ[Sqrt[y], x_^(1/2)]

MatchQ[y^(1/2), x_^(1/2)]

MatchQ[I*y,          I*x_]

MatchQ[Sqrt[-1]*y,   I*x_]

MatchQ[(-1)^(1/2)*y, I*x_]

MatchQ[I*y,          Sqrt[-1]*x_]

MatchQ[Sqrt[-1]*y,   Sqrt[-1]*x_]

MatchQ[(-1)^(1/2)*y, Sqrt[-1]*x_]

MatchQ[I*y,          (-1)^(1/2)*x_]

MatchQ[Sqrt[-1]*y,   (-1)^(1/2)*x_]

MatchQ[(-1)^(1/2)*y, (-1)^(1/2)*x_]

(* ---------- Quit ---------- *)
