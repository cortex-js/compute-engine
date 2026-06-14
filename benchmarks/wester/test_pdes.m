(* Extracted from https://math.unm.edu/~wester/demos/PDEs/Math.problems
   Source index: https://math.unm.edu/~wester/cas_review.html *)

(* ----------[ M a t h e m a t i c a ]---------- *)

(* ---------- Initialization ---------- *)

(* ---------- Partial Differential Equations ---------- *)

(* A very simple PDE => g(x) + h(y) for arbitrary functions g and h *)

de = D[f[x, y], x, y] == 0

DSolve[de, f[x, y], {x, y}]

(* Heat equation: the fundamental solution is 1/sqrt(4 pi t) 
exp(-x^2/[4 t]).
   If f(x, t) and a(x, t) are solutions, the most general solution obtainable
   from f(x, t) by group transformations is of the form u(x, t) = a(x, t)
   + 1/sqrt(1 + 4 e6 t) exp(e3 - [e5 x + e6 x^2 -  e5^2 t]/[1 + 4 e6 t])
   f([e^(-e4) (x - 2 e5 t)]/[1 + 4 e6 t] - e1, [e^(-2 e4) t]/[1 + 4 e6 t] - 
e2)
   See Peter J. Olver, _Applications of Lie Groups to Differential 
Equations_,
   Second Edition, Springer Verlag, 1993, p. 120 (an excellent book).  See 
also
   Heat.math *)

de = D[u[x, t], t] == D[u[x, t], {x, 2}]

DSolve[de, u[x, t], {x, t}]

<< Calculus`DSolveIntegrals`

CompleteIntegral[de, u[x, t], {x, t}]

(* Potential equation on a circular disk---a separable PDE
   => v(r, theta) = a[0] + sum(a[n] r^n cos(n theta), n = 1..infinity)
                         + sum(b[n] r^n sin(n theta), n = 1..infinity) *)

de = (1/r * D[r * D[v[r, theta], r], r]
              + 1/r^2 * D[v[r, theta], {theta, 2}] == 0)

DSolve[de, v[r, theta], {r, theta}]

CompleteIntegral[de, v[r, theta], {r, theta}]

Clear[de]

(* ---------- Quit ---------- *)
