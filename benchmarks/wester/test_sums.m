(* Extracted from https://math.unm.edu/~wester/demos/Sums/Math.problems
   Source index: https://math.unm.edu/~wester/cas_review.html *)

(* ----------[ M a t h e m a t i c a ]---------- *)

(* ---------- Initialization ---------- *)

(* ---------- Sums ---------- *)

(* Simplify the sum below to sum(x[i]^2, i = 1..n) - sum(x[i], i = 
1..n)^2/n *)

xbar = Sum[x[j], {j, 1, n}] / n

Sum[(x[i] - xbar)^2, {i, 1, n}]

Clear[xbar]

Sum[(x[i] - xbar)^2, {i, 1, n}] /. xbar -> Sum[x[j], {j, 1, n}] / n

(* Derivation of the least squares fitting of data points (x[i], 
y[i]) to a
   line y = m x + b.  See G. Keady, ``Using Maple's linalg package with Zill
   and Cullen _Advanced Engineering Mathematics_, Part II: Vectors, Matrices
   and Vector Calculus'', University of Western Australia,
   ftp://maths.uwa.edu.au/pub/keady/ *)

f = Sum[(y[i] - m*x[i] - b)^2, {i, 1, n}];

Solve[{D[f, m] == 0, D[f, b] == 0}, {m, b}]

Clear[f]

(* Indefinite sum => (-1)^n binomial(2 n, n).  See Herbert S, Wilf,
   ``IDENTITIES and their computer proofs'', University of Pennsylvania. *)

Sum[(-1)^k * Binomial[2*n, k]^2, k]

(* Check whether the full Gosper algorithm is implemented
   => 1/2^(n + 1) binomial(n, k - 1) *)

Sum[Binomial[n, k]/2^n - Binomial[n + 1, k]/2^(n + 1), k]

(* Dixon's identity (check whether Zeilberger's algorithm is 
implemented).
   Note that the indefinite sum is equivalent to the definite
   sum(..., k = -min(a, b, c)..min(a, b, c)) => (a + b + c)!/(a! b! c!)
   [Wilf] *)

Sum[(-1)^k * Binomial[a+b, a+k] * Binomial[b+c, b+k]
           * Binomial[c+a, c+k], k]

(* Telescoping sum => g(n + 1) - g(0) *)

Sum[g[k + 1] - g[k], {k, 0, n}]

(* => n^2 (n + 1)^2 / 4 *)

Sum[k^3, {k, 1, n}]

(* See Daniel I. A. Cohen, _Basic Techniques of Combinatorial 
Theory_, John
   Wiley and Sons, 1978, p. 60.  The following two sums can be derived 
directly
   from the binomial theorem:
   sum(k^2 * binomial(n, k) * x^k, k = 1..n) = n x (1 + n x) (1 + x)^(n - 2)
   => n (n + 1) 2^(n - 2)   [Cohen, p. 60] *)

Sum[k^2 * Binomial[n, k], {k, 1, n}]

(* => [2^(n + 1) - 1]/(n + 1)   [Cohen, p. 83] *)

Sum[Binomial[n, k]/(k + 1), {k, 0, n}]

(* Vandermonde's identity => binomial(n + m, r)   [Cohen, p. 31] *)

Sum[Binomial[n, k] * Binomial[m, r - k], {k, 0, r}]

(* => Fibonacci[2 n]   [Cohen, p. 88] *)

<< DiscreteMath`CombinatorialFunctions`

Sum[Binomial[n, k] * Fibonacci[k], {k, 0, n}]

(* => Fibonacci[n] Fibonacci[n + 1]   [Cohen, p. 65] *)

Sum[Fibonacci[k]^2, {k, 1, n}]

(* => 1/2 cot(x/2) - cos([2 n + 1] x/2)/[2 sin(x/2)]
   See Konrad Knopp, _Theory and Application of Infinite Series_, Dover
   Publications, Inc., 1990, p. 480. *)

Sum[Sin[k*x], {k, 1, n}]

(* => sin(n x)^2/sin x   [Gradshteyn and Ryzhik 1.342(3)] *)

Sum[Sin[(2*k - 1)*x], {k, 1, n}]

Simplify[%]

(* => Fibonacci[n + 1]   [Cohen, p. 87] *)

Sum[Binomial[n - k, k], {k, 0, Floor[n/2]}]

f[n_] = FullSimplify[%]

Table[f[n], {n, 0, 10}]

Clear[f]

(* => pi^2 / 6 + zeta(3) =~ 2.84699 *)

Sum[1/k^2 + 1/k^3, {k, 1, Infinity}]

N[%]

(* => pi^2/12 - 1/2 (log 2)^2   [Gradshteyn and Ryzhik 0.241(2)] *)

Sum[1/(2^k*k^2), {k, 1, Infinity}]

(* => pi/12 sqrt(3) - 1/4 log 3   [Knopp, p. 268] *)

Sum[1/((3*k + 1)*(3*k + 2)*(3*k + 3)), {k, 0, Infinity}]

(* => 1/2 (2^(n - 1) + 2^(n/2) cos(n pi/4))   [Gradshteyn and Ryzhik 
0.153(1)]
   *)

Sum[Binomial[n, 4*k], {k, 0, Infinity}]

FullSimplify[%]

(* => 1   [Knopp, p. 233] *)

Sum[1/(Sqrt[k*(k + 1)] * (Sqrt[k] + Sqrt[k + 1])), {k, 1, Infinity}]

(* => 1/sqrt([1 - x y]^2 - 4 x^2)   (| x y | < 1 and -1 <= x < 1).
      From Evangelos A. Coutsias, Michael J. Wester and Alan S. Perelson, ``A
      Nucleation Theory of Cell Surface Capping'', draft. *)

Sum[Sum[Binomial[n, k]*Binomial[n - k, n - 2*k]*x^n*y^(n - 2*k),
        {k, 0, Floor[n/2]}],
   {n, 0, Infinity}]

(* An equivalent summation to the above is: *)

Sum[Sum[n!/(k!^2*(n - 2*k)!)*(x/y)^k*(x*y)^(n - k), {n, 2*k, 
Infinity}],
    {k, 0, Infinity}]

PowerExpand[%]

(* => pi/2   [Knopp, p. 269] *)

Sum[Product[k/(2*k - 1), {k, 1, m}], {m, 2, Infinity}]

(* ---------- Quit ---------- *)
