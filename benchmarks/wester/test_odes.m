(* Extracted from https://math.unm.edu/~wester/demos/ODEs/Math.problems
   Source index: https://math.unm.edu/~wester/cas_review.html *)

(* ----------[ M a t h e m a t i c a ]---------- *)

(* ---------- Initialization ---------- *)

(* ---------- Ordinary Difference and Differential Equations 
---------- *)

(* Second order linear recurrence equationn: r(n) = (n - 1)^2 + m n *)

<< DiscreteMath`RSolve`

r[n + 2] - 2 * r[n + 1] + r[n] == 2

Simplify[RSolve[{%, r[0] == 1, r[1] == m}, r[n], n]]

(* => r(n) = 3^n - 2^n   [Cohen, p. 67] *)

RSolve[{r[n] == 5*r[n - 1] - 6*r[n - 2], r[0] == 0, r[1] == 1}, 
r[n], n]

(* => r(n) = Fibonacci[n + 1]   [Cohen, p. 83] *)

RSolve[{r[n] == r[n - 1] + r[n - 2], r[1] == 1, r[2] == 2}, r[n], n]

FullSimplify[%]

(* => [c^(n+1) [c^(n+1) - 2 c - 2] + (n+1) c^2 + 2 c - n] / [(c-1)^3 
(c+1)]
      [Joan Z. Yu and Robert Israel in sci.math.symbolic] *)

RSolve[{r[n] == (1 + c - c^(n-1) - c^(n+1))/(1 - c^n)*r[n - 1]
                - c*(1 - c^(n-2))/(1 - c^(n-1))*r[n - 2] + 1,
        r[1] == 1, r[2] == (2 + 2*c + c^2)/(1 + c)}, r[n], n]

(* Second order ODE with initial conditions---solve first using 
Laplace
   transforms: f(t) = sin(2 t)/8 - t cos(2 t)/4 *)

<< Calculus`LaplaceTransform`

ode = f''[t] + 4*f[t] == Sin[2*t]

LaplaceTransform[ode, t, s]

% /. {f[0] -> 0, f'[0] -> 0}

Solve[%, LaplaceTransform[f[t], t, s]]

Map[InverseLaplaceTransform[#, s, t] &, %[[1, 1]]]

Simplify[%]

(* Now, solve the ODE directly *)

DSolve[{ode, f[0] == 0, f'[0] == 0}, f[t], t]

Simplify[%]

(* Separable equation => y(x)^2 = 2 log(x + 1) + (4 x + 3)/(x + 1)^2 
+ 2 A *)

D[y[x], x] == x^2/(y[x]*(1 + x)^3)

DSolve[%, y[x], x]

FullSimplify[%]

(* Homogeneous equation.  See Emilio O. Roxin, _Ordinary Differential
   Equations_, Wadsworth Publishing Company, 1972, p. 11
   => y(x)^2 = 2 x^2 log|A x| *)

D[y[x], x] == y[x]/x + x/y[x]

DSolve[%, y[x], x]

Simplify[%]

(* First order linear ODE: y(x) = [A - cos(x)]/x^3 *)

x^2*y'[x] + 3*x*y[x] == Sin[x]/x

DSolve[%, y[x], x]

(* Exact equation => x + x^2 sin y(x) + y(x) = A   [Roxin, p. 15] *)

D[y[x], x] == -(1 + 2*x*Sin[y[x]])/(1 + x^2*Cos[y[x]])

DSolve[%, y[x], x]

(* ----------[ M a t h e m a t i c a ]---------- *)

(* ---------- Initialization ---------- *)

(* ---------- Ordinary Difference and Differential Equations 
---------- *)

(* Second order linear recurrence equationn: r(n) = (n - 1)^2 + m n *)

<< Calculus`LaplaceTransform`

(* Nonlinear ODE => y(x)^3/6 + A y(x) = x + B *)

eqn = y''[x] + y[x]*y'[x]^3 == 0

Simplify[DSolve[%, y[x], x]]

(* => y(x) = [3 x + sqrt(1 + 9 x^2)]^(1/3) - 1/[3 x + sqrt(1 + 9 
x^2)]^(1/3)
      [Pos96] *)

Simplify[DSolve[{eqn, y[0] == 0, y'[0] == 2}, y[x], x]]

Clear[eqn]

(* A simple parametric ODE: y(x, a) = A e^(a x) *)

ode = D[y[x, a], x] == a*y[x, a]

DSolve[ode, y[x, a], x]

DSolve[ode, y[x, a], {x, a}]

Clear[ode]

(* ODE with boundary conditions.  This problem has nontrivial 
solutions
   y(x) = A sin([pi/2 + n pi] x) for n an arbitrary integer *)

DSolve[{y''[x] + k^2*y[x] == 0, y[0] == 0, y'[1] == 0}, y[x], x]

(* => y(x) = Z_v[sqrt(x)] where Z_v is an arbitrary Bessel function 
of order v
      [Gradshteyn and Ryzhik 8.491(9)] *)

D[y[x], {x, 2}] + 1/x*D[y[x], x] + 1/(4*x)*(1 - v^2/x)*y[x] == 0

DSolve[%, y[x], x]

(* Delay (or mixed differential-difference) equation.  See Daniel 
Zwillinger,
   _Handbook of Differential Equations_, Second Edition, Academic Press, 
Inc.,
   1992, p. 210 => y(t) = y0 sum((-a)^n (t - n + 1)^n/n!, n = 0..floor(t) + 
1)
   *)

D[y[t], t] + a*y[t - 1] == 0

DSolve[%, y[t], t]

(* Discontinuous ODE   [Zwillinger, p. 221]
   => y(t) = cosh t   (0 <= t < T)
             (sin T cosh T + cos T sinh T) sin t
             + (cos T cosh T - sin T sinh T) cos t   (T <= t) *)

sgn[t_]:= If[t < 0, -1, 1];

DSolve[{D[y(t), {t, 2}] + sgn[t - TT]*y[t] == 0, y[0] == 1, y'[0] == 
0},
       y[t], t]

Clear[sgn]

DSolve[{D[y(t), {t, 2}] + Sign[t - TT]*y[t] == 0, y[0] == 1, y'[0] 
== 0},
       y[t], t]

(* Integro-differential equation.  See A. E. Fitzgerald, David E. 
Higginbotham
   and Arvin Grabel, _Basic Electrical Engineering_, Fourth Edition,
   McGraw-Hill Book Company, 1975, p. 117.
   => i(t) = 5/13 [-8 e^(-4 t) + e^(-t) (8 cos 2 t + sin 2 t)] *)

eqn = D[i[t], t] + 2*i[t] + 5*Integrate[i[tau], {tau, 0, t}] == 
10*E^(-4*t)

DSolve[{eqn, i'[0] == 10}, i[t], t]

LaplaceTransform[eqn, t, s]

% /. {i[0] -> 0, i'[0] -> 10}

Solve[%, LaplaceTransform[i[t], t, s]]

Map[InverseLaplaceTransform[#, s, t] &, %[[1, 1]]]

Clear[eqn]

(* System of two linear, constant coefficient ODEs:
   x(t) = e^t [A cos(t) - B sin(t)], y(t) = e^t [A sin(t) + B cos(t)] *)

system = {x'[t] == x[t] - y[t], y'[t] == x[t] + y[t]}

DSolve[system, {x[t], y[t]}, t]

FullSimplify[%]

( (* Check the answer *)
ExpandAll[system /. {x -> Apply[Function, {t, %[[1, 1, 2]]}],
                     y -> Apply[Function, {t, %[[1, 2, 2]]}]}] )

FullSimplify[DSolve[system, {x, y}, t]]

( (* Check the answer *)
ExpandAll[system /. First[%]] )

(* Triangular system of two ODEs: x(t) = A e^t [sin(t) + 2],
      y(t) = A e^t [5 - cos(t) + 2 sin(t)]/5 + B e^(-t)
   See Nicolas Robidoux, ``Does Axiom Solve Systems of O.D.E.'s Like
   Mathematica?'', LA-UR-93-2235, Los Alamos National Laboratory, Los Alamos,
   New Mexico. *)

system = {x'[t] == x[t] * (1 + Cos[t]/(2 + Sin[t])),
          y'[t] == x[t] - y[t]}

DSolve[system, {x[t], y[t]}, t]

Simplify[%]

(* Try solving this system one equation at a time *)

DSolve[system[[1]], x[t], t]

Simplify[%]

DSolve[system[[2]] /. %, y[t], t, DSolveConstants -> (Module[{C}, C] 
&)]

(* 3 x 3 linear system with constant coefficients:
   (1) real distinct characteristic roots (= 2, 1, 3)   [Roxin, p. 109]
       => x(t) = A e^(2 t),   y(t) = B e^t + C e^(3 t),
          z(t) = -A e^(2 t) - C e^(3 t) *)

system = {D[x[t], t] ==  2*x[t],
          D[y[t], t] == -2*x[t] + y[t] - 2*z[t],
          D[z[t], t] ==    x[t]        + 3*z[t]}

DSolve[system, {x[t], y[t], z[t]}, t]

(* (2) complex characteristic roots (= 0, -1 +- sqrt(2) i)   [Roxin, 
p. 111]
       => x(t) = A + e^(-t)/3 [-(B + sqrt(2) C) cos(sqrt(2) t) +
                                (sqrt(2) B - C) sin(sqrt(2) t)],
          y(t) = e^(-t) [B cos(sqrt(2) t) + C sin(sqrt(2) t)],
          z(t) = e^(-t) [(-B + sqrt(2) C) cos(sqrt(2) t)
                         -(sqrt(2) B + C) sin(sqrt(2) t)] *)

system = {D[x[t], t] == y[t], D[y[t], t] == z[t],
          D[z[t], t] == -3*y[t] - 2*z[t]}

DSolve[system, {x[t], y[t], z[t]}, t]

Simplify[%]

(* (3) multiple characteristic roots (= 2, 2, 2)   [Roxin, p. 113]
       => x(t) = e^(2 t) [A + C (1 + t)],   y(t) = B e^(2 t),
          z(t) = e^(2 t) [A + C t] *)

system = {D[x[t], t] == 3*x[t] - z[t], D[y[t], t] == 2*y[t],
          D[z[t], t] == x[t] + z[t]}

DSolve[system, {x[t], y[t], z[t]}, t]

(* x(t) = x0 + [4 sin(w t)/w - 3 t] x0'   [Rick Niles]
          + 6 [w t - sin(w t)] y0 + 2/w [1 - cos(w t)] y0',
   y(t) = -2/w [1 - cos(w t)] x0' + [4 - 3 cos(w t)] y0 + sin(w t)/w y0' *)

system = {D[x[t], {t, 2}] == 2*w*D[y[t], t],
          D[y[t], {t, 2}] == -2*w*D[x[t], t] + 3*w^2*y[t]}

DSolve[system, {x[t], y[t]}, t]

Clear[system]

(* ---------- Quit ---------- *)
