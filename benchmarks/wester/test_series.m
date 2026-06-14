(* Extracted from https://math.unm.edu/~wester/demos/Series/Math.problems
   Source index: https://math.unm.edu/~wester/cas_review.html *)

(* ----------[ M a t h e m a t i c a ]---------- *)

(* ---------- Initialization ---------- *)

(* ---------- Series ---------- *)

(* Taylor series---this first example comes from special relativity
   => 1 + 1/2 (v/c)^2 + 3/8 (v/c)^4 + 5/16 (v/c)^6 + O((v/c)^8) *)

1/Sqrt[1 - (v/c)^2]

Series[%, {v, 0, 7}]

1/%^2

(* Note: sin(x) = x - x^3/6 + x^5/120 - x^7/5040 + O(x^9)
         cos(x) = 1 - x^2/2 + x^4/24 - x^6/720 + O(x^8)
         tan(x) = x + x^3/3 + 2/15 x^5 + 17/315 x^7 + O(x^9) *)

tsin = Series[Sin[x], {x, 0, 7}]

tcos = Series[Cos[x], {x, 0, 7}]

(* Note that additional terms will be computed as needed *)

tsin/tcos

Series[Tan[x], {x, 0, 7}]

Clear[tsin, tcos]

(* => -x^2/6 - x^4/180 - x^6/2835 - O(x^8) *)

Series[Log[Sin[x]/x], {x, 0, 7}]

Series[Sin[x]/x, {x, 0, 7}]

Series[Log[%], {x, 0, 7}]

(* => [a f'(a d) + g(b d) + integrate(h(c y), y = 0..d)]
      + [a^2 f''(a d) + b g'(b d) + h(c d)] (x - d) *)

D[f[a*x], x] + g[b*x] + Integrate[h[c*y], {y, 0, x}]

Series[%, {x, d, 1}]

(* Taylor series of nonscalar objects (noncommutative multiplication)
   => (B A - A B) t^2/2 + O(t^3)   [Stanly Steinberg] *)

(*declare([A, B], nonscalar)*)

E^((A + B)*t) - E^(A*t) * E^(B*t)

Simplify[%]

Series[E^((A + B)*t) - E^(A*t) * E^(B*t), {t, 0, 3}]

(* Laurent series:
   => sum( Bernoulli[k]/k! x^(k - 2), k = 1..infinity )
      = 1/x^2 - 1/(2 x) + 1/12 - x^2/720 + x^4/30240 + O(x^6)
      [Levinson and Redheffer, p. 173] *)

Series[1/(x*(Exp[x] - 1)), {x, 0, 6}]

(* Puiseux series (terms with fractional degree):
   => 1/sqrt(x - 3/2 pi) + (x - 3/2 pi)^(3/2) / 12 + O([x - 3/2 pi]^(7/2)) *)

Series[Sqrt[Sec[x]], {x, 3/2*Pi, 3}]

(* Generalized Taylor series => sum( [x log x]^k/k!, k = 0..infinity 
) *)

Series[x^x, {x, 0, 3}]

(* Compare the generalized Taylor series of two different 
formulations of a
   function => log(z) + log(cosh(w)) + tanh(w) z + O(z^2) *)

s1 = Series[Log[Sinh[z]] + Log[Cosh[z + w]], {z, 0, 1}]

s2 = Series[Log[Sinh[z] * Cosh[z + w]], {z, 0, 1}]

Simplify[s1 - s2]

Clear[s1, s2]

(* Look at the generalized Taylor series around x = 1
   => (x - 1)^a/e^b [1 - (a + 2 b) (x - 1) / 2 + O((x - 1)^2)] *)

Log[x]^a*Exp[-b*x]

Series[%, {x, 1, 1}]

(* Asymptotic expansions => sqrt(2) x + O(1/x) *)

Series[Sqrt[2*x^2 + 1], {x, Infinity, 0}]

(* Wallis' product => 1/sqrt(pi n) + ...   [Knopp, p. 385] *)

Series[1/2^(2*n) * Binomial[2*n, n], {n, Infinity, 0}]

(* => 0!/x - 1!/x^2 + 2!/x^3 - 3!/x^4 + O(1/x^5)   [Knopp, p. 544] *)

Exp[x] * Integrate[Exp[-t]/t, {t, x, Infinity}]

Series[%, {x, Infinity, 5}]

(* Multivariate Taylor series expansion => 1 - (x^2 + 2 x y + y^2)/2 
+ O(x^4)
   *)

Series[Cos[x + y], {x, 0, 2}, {y, 0, 2}]

(* Power series (compute the general formula) *)

<< DiscreteMath`RSolve`

SeriesTerm[Log[Sin[x]/x], {x, 0, n}]

Apply[Plus, Table[%*x^n, {n, 0, 7}]]

SeriesTerm[Sin[x]*Exp[-x], {x, 0, n}]

Apply[Plus, Table[%*x^n, {n, 0, 7}]]

(* Derive an explicit Taylor series solution of y as a function of x 
from the
   following implicit relation:
   y = x - 1 + (x - 1)^2/2 + 2/3 (x - 1)^3 + (x - 1)^4 + 17/10 (x - 1)^5 + 
...
   *)

x == Sin[y] + Cos[y]

Series[%[[2]], {y, 0, 5}]

InverseSeries[%, x]

(* Pade (rational function) approximation => (2 - x)/(2 + x) *)

<< Calculus`Pade`

Pade[Exp[-x], {x, 0, 1, 1}]

(* Fourier series of f(x) of period 2 p over the interval [-p, p]
   => - (2 p / pi) sum( (-1)^n sin(n pi x / p) / n, n = 1..infinity ) *)

<< Calculus`FourierTransform`

FourierTrigSeries[x, {x, -p, p}, 5]

(* => p / 2
   - (2 p / pi^2) sum( [1 - (-1)^n] cos(n pi x / p) / n^2, n = 1..infinity ) 
*)

s = FourierTrigSeries[Abs[x], {x, -p, p}, 5]

ComplexExpand[%]

p/: Re[p] = p

p/: Im[p] = 0

s

PowerExpand[%]

Clear[p, s]

(* ---------- Quit ---------- *)
