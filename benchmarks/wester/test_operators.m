(* Extracted from https://math.unm.edu/~wester/demos/Operators/Math.problems
   Source index: https://math.unm.edu/~wester/cas_review.html *)

(* ----------[ M a t h e m a t i c a ]---------- *)

(* ---------- Initialization ---------- *)

(* ---------- Operators ---------- *)

f[x_]:= Exp[x]

g[x_]:= x^2

ff = Exp[#] &

gg = #^2 &

(* (f + 2 g)(y) => e^y + 2 y^2 *)

(f + 2*g)[y]

Through[%]

(ff + 2*gg)[y]

Through[%]

(* (f o g)(y) => e^(y^2) *)

(f @ g)[y]

Through[%]

(ff @ gg)[y]

Through[%]

Clear[f, g, ff, gg]

(* Linear differential operator *)

OperatorRule = (n_Integer*Identity)[e_] -> n*e

L = Composition[D[#, x]& - Identity, D[#, x]& + 2*Identity]

(* => f'' + f' - 2 f *)

L[f[x]]

Through[Map[Through, %] /. OperatorRule] /. OperatorRule

(* => g''(y) + g'(y) - 2 g(y) *)

(L /. x -> y)[g[y]]

Through[Map[Through, %] /. OperatorRule] /. OperatorRule

(* => 2 A [(1 + z) cos(z^2) - (1 + 2 z^2) sin(z^2)] *)

(L /. x -> z)[A * Sin[z^2]]

Through[Map[Through, %] /. OperatorRule] /. OperatorRule

(* Truncated Taylor series operator *)

T = Sum[(D[#1, {#2, k}] /. #2 -> #3)/k! * (#2 - #3)^k, {k, 0, 2}] &

(* => f(a) + f'(a) (x - a) + f''(a) (x - a)^2/2 *)

T[f[x], x, a]

(* => g(b) + g'(b) (y - b) + g''(b) (y - b)^2/2 *)

T[g[y], y, b]

(* => sin(c) + cos(c) (z - c) - sin(c) (z - c)^2/2 *)

T[Sin[z], z, c]

Clear[L, T]

(* Define the binary infix operator ~ so that x ~ y => sqrt(x^2 + 
y^2) *)

x_ \[Tilde] y_:= Sqrt[x^2 + y^2];

3 \[Tilde] 4

(* Make it associative: 3 ~ 4 ~ 12 => 13 *)

3 \[Tilde] 4 \[Tilde] 12

x_ \[Tilde] y_ \[Tilde] z_:= (x \[Tilde] y) \[Tilde] z;

3 \[Tilde] 4 \[Tilde] 12

(* Define the matchfix pair of operators | and | so that | x | => 
abs(x) *)

(* ---------- Quit ---------- *)
