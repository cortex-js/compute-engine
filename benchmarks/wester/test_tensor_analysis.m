(* Extracted from https://math.unm.edu/~wester/demos/TensorAnalysis/Math.problems
   Source index: https://math.unm.edu/~wester/cas_review.html *)

(* ----------[ M a t h e m a t i c a ]---------- *)

(* ---------- Initialization ---------- *)

(* ---------- Tensor Analysis ---------- *)

(* Generalized Kronecker delta: delta([j, h], [i, k]) =
   delta(j, i) delta(h, k) - delta(j, k) delta(h, i).  See David Lovelock and
   Hanno Rund, _Tensors, Differential Forms, & Variational Principles_,  John
   Wiley & Sons, Inc., 1975, p. 109. *)

(j == i) == (h == k) - (j == k) == (h == i)

(* Levi-Civita symbol: [epsilon(2,1,3), epsilon(1,3,1)] => [-1, 0] *)

{Signature[{2, 1, 3}], Signature[{1, 3, 1}]}

(* Tensor outer product:                   [[  5  6] [-10 -12]]
                         [1 -2]   [ 5 6]   [[ -7  8] [ 14 -16]]
    ij      ij           [3  4] X [-7 8] = [                  ]
   c     = a   b                           [[ 15 18] [ 20  24]]
      kl        kl                         [[-21 24] [-28  32]] *)

a = {{1, -2}, {3, 4}};

b = {{5, 6}, {-7, 8}};

Outer[Times, a, b] // MatrixForm

Clear[a, b]

(* Definition of the Christoffel symbol of the first kind (a is the 
metric
   tensor) [Lovelock and Rund, p. 81]
                d a     d a     d a
             1     kh      hl      lk
   Chr1    = - (----- + ----- - -----)
       lhk   2      l       k       h
                 d x     d x     d x  *)

(* Partial covariant derivative of a type (1, 1) tensor field (Chr2 
is the
   Christoffel symbol of the second kind) [Lovelock and Rund, p. 77]
    i      d    i        i   m        m   i
   T    = ---- T  + Chr2    T  - Chr2    T
    j|k      k  j       m k  j       j k  m
          d x     *)

<< ProgrammingInMathematica`Tensors`

Tensor[T][ui[i], li[j]]

(* Verify the Bianchi identity for a symmetric connection (K is the 
Riemann
   curvature tensor) [Lovelock and Rund, p. 94]
     h         h          h
   K       + K        + K       = 0
    i jk|l    i kl|j     i lj|k     *)

(* ---------- Quit ---------- *)
