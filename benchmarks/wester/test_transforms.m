(* Extracted from https://math.unm.edu/~wester/demos/Transforms/Math.problems
   Source index: https://math.unm.edu/~wester/cas_review.html *)

(* ----------[ M a t h e m a t i c a ]---------- *)

(* ---------- Initialization ---------- *)

(* ---------- Transforms ---------- *)

(* Laplace and inverse Laplace transforms *)

<< Calculus`LaplaceTransform`

(* => s/[s^2 + (w - 1)^2]   (Re s > |Im(w - 1)|)
      [Gradshteyn and Ryzhik 17.13(33)] *)

LaplaceTransform[Cos[(w - 1)*t], t, s]

InverseLaplaceTransform[%, s, t]

(* => w/(s^2 - 4 w^2)   (Re s > |Re w|)   [Gradshteyn and Ryzhik 
17.13(84)] *)

LaplaceTransform[Sinh[w*t]*Cosh[w*t], t, s]

Simplify[%]

(* e^(-6 sqrt(s))/s   (Re s > 0)   [Gradshteyn and Ryzhik 
17.13(102)] *)

LaplaceTransform[Erf[3/Sqrt[t]], t, s]

(* Solve y'' + y = 4 [H(t - 1) - H(t - 2)], y(0) = 1, y'(0) = 0 
where H is the
   Heaviside (unit step) function (the RHS describes a pulse of magnitude 4 
and
   duration 1).  See David A. Sanchez, Richard C. Allen, Jr. and Walter T.
   Kyner, _Differential Equations: An Introduction_, Addison-Wesley 
Publishing
   Company, 1983, p. 211.  First, take the Laplace transform of the ODE
   => s^2 Y(s) - s + Y(s) = 4/s [e^(-s) - e^(-2 s)]
   where Y(s) is the Laplace transform of y(t) *)

<< Calculus`DiracDelta`

LaplaceTransform[y''[t] + y[t] == 4*(UnitStep[t - 1] - UnitStep[t - 
2]), t, s]

% /. {y[0] -> 1, y'[0] -> 0}

( (* Now, solve for Y(s) and then take the inverse Laplace transform
   => Y(s) = s/(s^2 + 1) + 4 [1/s - s/(s^2 + 1)] [e^(-s) - e^(-2 s)]
   => y(t) = cos t + 4 {[1 - cos(t - 1)] H(t - 1) - [1 - cos(t - 2)] H(t - 
2)}
   *)
Solve[%, LaplaceTransform[y[t], t, s]] )

Map[InverseLaplaceTransform[#, s, t] &, %[[1, 1]]]

(* What is the Laplace transform of an infinite square wave?
   => 1/s + 2 sum( (-1)^n e^(- s n a)/s, n = 1..infinity )
      [Sanchez, Allen and Kyner, p. 213] *)

LaplaceTransform[1 + 2*Sum[(-1)^n*UnitStep[t - n*a], {n, 1, 
Infinity}], t, s]

(* Fourier transforms => sqrt(2 pi) delta(z)   [Gradshteyn and 
Ryzhik 17.23(1)]
   *)

<< Calculus`FourierTransform`

FourierTransform[1, x, z]

(* => e^(-z^2/36) / [3 sqrt(2)]   [Gradshteyn and Ryzhik 17.23(13)] 
*)

FourierTransform[Exp[-9*x^2], x, z]

(* => sqrt(2 / pi) (9 - z^2)/(9 + z^2)^2   [Gradshteyn and Ryzhik 
17.23(11)] *)

FourierTransform[Abs[x]*Exp[-3*Abs[x]], x, z]

(* Mellin transforms
   => pi cot(pi s)   (0 < Re s < 1)   [Gradshteyn and Ryzhik 17.43(5)] *)

MellinTransform[f_, x_, s_]:=
   Integrate[f * x^(s - 1), {x, 0, Infinity}, Assumptions -> 0 < s < 1,
                                              PrincipalValue -> True]

MellinTransform[1/(1 - x), x, s]

(* => 2^(s - 4) gamma(s/2)/gamma(4 - s/2)   (0 < Re s < 1)
      [Gradshteyn and Ryzhik 17.43(16)] *)

MellinTransform[BesselJ[3, x]/x^3, x, s]

(* Z transforms.  See _CRC Standard Mathematical Tables_, 
Twenty-first Edition,
   The Chemical Rubber Company, 1973, p. 518.
   Z[H(t - m T)] => z/[z^m (z - 1)]   (H is the Heaviside (unit step) 
function)
   *)

<< Calculus`DiracDelta`

UnitStep[t - 3]

UnitStep[t - m]

(* ---------- Quit ---------- *)
