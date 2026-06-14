(* Extracted from https://math.unm.edu/~wester/demos/Combinatorics/Math.problems
   Source index: https://math.unm.edu/~wester/cas_review.html *)

(* ----------[ M a t h e m a t i c a ]---------- *)

(* ---------- Initialization ---------- *)

(* ---------- Combinatorial Theory ---------- *)

(* Pochhammer symbol (a)_n = a (a + 1) ... (a + n - 1) => a (a + 1) 
(a + 2) *)

Pochhammer[a, 3]

(* Binomial coefficient => n (n - 1) (n - 2)/6 *)

Binomial[n, 3]

(* 2^n n! (2 n - 1)!! => (2 n)! *)

2^n * n! * (2*n - 1)!!

(* 2^n n! product(2 k - 1, k = 1..n) => (2 n)! *)

2^n * n! * Product[2*k - 1, {k, 1, n}]

FullSimplify[%]

(* => (2 n)!/[2^(2 n) (n!)^2]   or   (2 n - 1)!!/[2^n n!] *)

Gamma[n + 1/2]/(Sqrt[Pi] * n!)

(* Partitions of an integer => {1+1+1+1, 1+1+2, 1+3, 2+2, 4} (5 in 
all) *)

PartitionsP[4]

(* Stirling numbers of the first kind: S_1(5, 2) => -50 *)

StirlingS1[5, 2]

(* Euler's totient function => 576 *)

EulerPhi[1776]

(* ---------- Quit ---------- *)
