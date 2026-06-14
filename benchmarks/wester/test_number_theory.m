(* Extracted from https://math.unm.edu/~wester/demos/NumberTheory/Math.problems
   Source index: https://math.unm.edu/~wester/cas_review.html *)

(* ----------[ M a t h e m a t i c a ]---------- *)

(* ---------- Initialization ---------- *)

(* ---------- Number Theory ---------- *)

<< NumberTheory`NumberTheoryFunctions`

(* Display the largest 6-digit prime and the smallest 7-digit prime
   => [999983, 1000003] *)

{Prime[78498], Prime[78499]}

{NextPrime[999980], NextPrime[NextPrime[999980] + 1]}

(* Primitive root => 19 *)

PrimitiveRoot[191]

(* (a + b)^p mod p => a^p + b^p for p prime and a, b in Z_p   [Chris 
Hurlburt]
   See Thomas W. Hungerford, _Algebra_, Springer-Verlag, 1974, p. 121 for a
   more general simplification: (a +- b)^(p^n) => a^(p^n) +- b^(p^n) *)

p/: PrimeQ[p] = True;

Mod[(a + b)^p, p]

Clear[p]

(* Congruence equations.  See Harold M. Stark, _An Introduction to 
Number
   Theory_, The MIT press, 1984.
   9 x = 15 mod 21 => x = 4 mod 7   or   {4, 11, 18} mod 21   [Stark, p. 68] 
*)

Solve[{9*x == 15, Modulus == 21}, x]

(* 7 x = 22 mod 39 => x = 5 mod 13   or   31 mod 39   [Stark, p. 69] 
*)

Solve[{7*x == 22, Modulus == 39}, x]

(* x^2 + x + 4 = 0 mod 8 => x = {3, 4} mod 8   [Stark, p. 97] *)

Solve[{x^2 + x + 4 == 0, Modulus == 8}, x]

(* x^3 + 2 x^2 + 5 x + 6 = 0 mod 11 => x = 3 mod 11   [Stark, p. 97] 
*)

Solve[{x^3 + 2*x^2 + 5*x + 6 == 0, Modulus == 11}, x]

(* {x = 7 mod 9, x = 13 mod 23, x = 1 mod 2} => x = 151 mod 414   
[Stark,
   p. 76] *)

(* {5 x + 4 y = 6 mod 7, 3 x - 2 y = 6 mod 7} => x = 1 mod 7, y = 2 
mod 7
   [Stark, p. 76] *)

Solve[{5*x + 4*y == 6, 3*x - 2*y == 6, Modulus == 7}, {x, y}]

(* 2 x + 3 y = 1 mod 5 =>
   (x, y) = {(0, 2), (1, 3), (2, 4), (3, 0), (4, 1)} mod 5 *)

Solve[{2*x + 3*y == 1, Modulus == 5}, {x, y}]

(* 2 x + 3 y = 1 mod 6 =>   [Stark, p. 76]
   (x, y) = {(2, 1), (2, 3), (2, 5), (5, 1), (5, 3), (5, 5)} mod 6 *)

Solve[{2*x + 3*y == 1, Modulus == 6}, {x, y}]

(* Diophantine equations => x = 2, y = 5 (Wallis)   [Stark, p. 147] 
*)

Solve[x^4 + 9 == y^2, {x, y}]

(* => x = 11, y = 5 (Fermat)   [Stark, p. 147] *)

Solve[x^2 + 4 == y^3, {x, y}]

(* => (x, y, t, z, w) = (3, 4, 5, 12, 13), (7, 24, 25, 312, 313), ...
      [Stark, p. 154] *)

system = {x^2 + y^2 == t^2, t^2 + z^2 == w^2}

Solve[system, {x, y, t, z, w}]

Clear[system]

(* Rational approximation of sqrt(3) with an error tolerance of 
1/500 => 26/15
   *)

Rationalize[Sqrt[3.], 1/500]

(* Continued fractions => 3 + 1/(7 + 1/(15 + 1/(1 + 1/(292 + ... *)

<< NumberTheory`ContinuedFractions`

ContinuedFraction[3.1415926535, 5]

(* => 4 + 1/(1 + 1/(3 + 1/(1 + 1/(8 + 1/(1 + 1/(3 + 1/(1 + 1/(8 + ...
      [Stark, p. 340] *)

ContinuedFraction[Sqrt[23]]

ContinuedFraction[Sqrt[23.], 10]

(* => 1 + 1/(1 + 1/(1 + 1/(1 + ...   See Oskar Perron, _Die Lehre 
von den
      Kettenbr\"uchen_, Chelsea Publishing Company, 1950, p. 52. *)

ContinuedFraction[(1 + Sqrt[5.])/2, 10]

(* => 1/(2 x + 1/(6 x + 1/(10 x + 1/(14 x + ...   [Perron, p. 353] *)

ContinuedFraction[(Exp[1/x] - 1)/(Exp[1/x] + 1)]

(* => 1/(2 x + 1/(2 x + 1/(2 x + ...   (Re x > 0)   From Liyang Xu, 
``Method
      Derived from Continued Fraction Approximations'', draft. *)

ContinuedFraction[Sqrt[x^2 + 1] - x]

(* ---------- Quit ---------- *)
