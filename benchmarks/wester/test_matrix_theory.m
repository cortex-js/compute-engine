(* Extracted from https://math.unm.edu/~wester/demos/MatrixTheory/Math.problems
   Source index: https://math.unm.edu/~wester/cas_review.html *)

(* ----------[ M a t h e m a t i c a ]---------- *)

(* ---------- Initialization ---------- *)

(* ---------- Matrix Theory ---------- *)

<< LinearAlgebra`MatrixManipulation`

(* Extract the superdiagonal => [2, 6] *)

{{1, 2, 3}, {4, 5, 6}, {7, 8, 9}}

Table[%[[j - 1, j]], {j, 2, Dimensions[%][[2]]}]

(* (2, 3)-minor => [[1, 2], [7, 8]] *)

(*Minor[{{1, 2, 3}, {4, 5, 6}, {7, 8, 9}}, 2, 3]*)

(* Create the 7 x 6 matrix B from rearrangements of the elements of 
the 4 x 4
   matrix A (this is easiest to do with a MATLAB style notation):
   B = [A(1:3,2:4), A([1,2,4],[3,1,4]); A, [A(1:2,3:4); A([4,1],[3,2])]]
   => [[12 13 14|13 11 14],
       [22 23 24|23 21 24],
       [32 33 34|43 41 44],
       [--------+--+-----]
       [11 12 13 14|13 14],
       [21 22 23 24|23 24],
       [           +-----]
       [31 32 33 34|43 42],
       [41 42 43 44|13 12]].  See Michael James Wester, _Symbolic Calculation
   and Expression Swell Analysis of Matrix Determinants and Eigenstuff_, 
Ph.D.
   dissertation, University of New Mexico, Albuquerque, New Mexico, December
   1992, p. 89. *)

A = {{11, 12, 13, 14},
     {21, 22, 23, 24},
     {31, 32, 33, 34},
     {41, 42, 43, 44}};

(AppendColumns[AppendRows[A[[Range[1,3],Range[2,4]]], 
A[[{1,2,4},{3,1,4}]]],
               AppendRows[A, AppendColumns[A[[{1,2},{3,4}]], 
A[[{4,1},{3,2}]]]]]
   // MatrixForm)

Clear[A]

(* Create a block diagonal matrix *)

DiagonalMatrix[{{{a, 1},{0, a}}, b, {{c, 1, 0},{0, c, 1},{0, 0, c}}}]

(* => [[1 1], [1 0]] *)

Mod[{{7, 11}, {3, 8}}, 2]

(* => [[-cos t, -sin t], [sin t, -cos t]] *)

{{Cos[t], Sin[t]}, {-Sin[t], Cos[t]}}

D[%, {t, 2}]

(* => [[(a + 7) x + (2 a - 8) y,   (3 a - 9) x + (4 a + 10) y,
        (5 a + 11) x + (6 a - 12) y]] *)

{{x, y}} . (a*{{1, 3, 5}, {2, 4, 6}}
            + {{7, -9, 11}, {-8, 10, -12}})

(* Matrix norms: infinity norm => 7 *)

(*Norm[{{1, -2*I}, {-3*I, 4}}, Infinity]*)

(* Frobenius norm => (a^2 + b^2 + c^2)/(|a| |b| |c|)   (a, b, c 
real) *)

(*Norm[{{a/(b*c), 1/c, 1/b}, {1/c, b/(a*c), 1/a}, {1/b, 1/a, 
c/(a*b)}}, f]*)

(* Hermitian (complex conjugate transpose) => [[1, f(4 + 5 i)], [2 - 
3 i, 6]]
   (This assumes f is a real valued function.  In general, the (1, 2) entry
   will be conjugate[f(4 - 5 i)] = conjugate(f)(4 + 5 i).) *)

Conjugate[Transpose[{{1, 2 + 3*I}, {f[4 - 5*I], 6}}]]

m = {{a, b}, {1, a*b}}

(* Invert the matrix => 1/(a^2 - 1) [[a, -1], [-1/b, a/b]] *)

minv = Simplify[Inverse[m]]

m . minv

( (* The above is a complicated way of writing the identity matrix *)
Simplify[%] )

Clear[m, minv]

(* Inverse of a triangular partitioned (or block) matrix
   => [[A_11^(-1), -A_11^(-1) A_12 A_22^(-1)], [0, A_22^(-1)]].
   See Charles G. Cullen, _Matrices and Linear Transformations_, Second
   Edition, Dover Publications Inc., 1990, p. 35. *)

Inverse[{{A11, A12}, {0, A22}}]

(* LU decomposition of a symbolic matrix   [David Wood]
   [ 1    0   0] [1  x-2  x-3]   [ 1      x-2        x-3    ]
   [x-1   1   0] [0   4   x-5] = [x-1  x^2-3x+6   x^2-3x-2  ]
   [x-2  x-3  1] [0   0   x-7]   [x-2    x^2-8   2x^2-12x+14] *)

{{ 1,     x-2,         x-3     },
 {x-1, x^2-3*x+6,   x^2-3*x-2  },
 {x-2,   x^2-8,   2*x^2-12*x+14}}

Simplify[LUDecomposition[%]]

(* Reduced row echelon form   [Cullen, p. 43]
   => [[1 0 -1 0 2], [0 1 2 0 -1], [0 0 0 1 3], [0 0 0 0 0]] *)

{{1, 2, 3, 1, 3},
 {3, 2, 1, 1, 7},
 {0, 2, 4, 1, 1},
 {1, 1, 1, 1, 4}}

RowReduce[%]

(* => 2.  See Gerald L. Bradley, _A Primer of Linear Algebra_, 
Prentice-Hall,
      Inc., 1975, p. 135. *)

Rank[m_]:= Dimensions[m][[2]] - Length[NullSpace[m]]

Rank[{{-1, 3, 7, -5}, {4, -2, 1, 3}, {2, 4, 15, -7}}]

(* => 1 *)

Rank[{{2*Sqrt[2], 8}, {6*Sqrt[6], 24*Sqrt[3]}}]

(* => 1 *)

Rank[{{Sin[2*t], Cos[2*t]},
      {2*(1 - Cos[t]^2)*Cos[t], (1 - 2*Sin[t]^2)*Sin[t]}}]

(* Null space => [[2 4 1 0], [0 -3 0 1]]^T or variant   [Bradley, p. 
207] *)

NullSpace[{{1, 0, -2, 0}, {-2, 1, 0, 3}, {-1, 2, -6, 6}}]

(* Define a Vandermonde matrix (useful for doing polynomial 
interpolations) *)

{{1,   1,   1,   1  },
 {w,   x,   y,   z  },
 {w^2, x^2, y^2, z^2},
 {w^3, x^3, y^3, z^3}}

Det[%]

( (* The following formula implies a general result:
     => (w - x) (w - y) (w - z) (x - y) (x - z) (y - z) *)
Factor[%] )

(* Minimum polynomial => (lambda - 1)^2 (lambda + 1)   [Cullen, p. 
181] *)

{{17,  -8, -12, 14},
 {46, -22, -35, 41},
 {-2,   1,   4, -4},
 { 4,  -2,  -2,  3}};

(* Compute the eigenvalues of a matrix from its characteristic 
polynomial
   => lambda = {1, -2, 3} *)

m = {{ 5, -3, -7},
     {-2,  1,  2},
     { 2, -3, -4}}

CharacteristicPolynomial[m, lambda]

Solve[% == 0, lambda]

Clear[m]

(* In theory, an easy eigenvalue problem! => lambda = {2 - a} for k 
= 1..100
   [Wester, p. 154] *)

<< Statistics`DataManipulation`

Eigenvalues[(2 - a)*IdentityMatrix[100]]

Frequencies[%]

(* => lambda = {4 sin^2(pi k/[2 (n + 1)])} for k = 1..n for an n x n 
matrix.
      For n = 5, lambda = {2 - sqrt(3), 1, 2, 3, 2 + sqrt(3)}
   See J. H. Wilkinson, _The Algebraic Eigenvalue Problem_, Oxford University
   Press, 1965, p. 307. *)

{{2, 1, 0, 0, 0},
 {1, 2, 1, 0, 0},
 {0, 1, 2, 1, 0},
 {0, 0, 1, 2, 1},
 {0, 0, 0, 1, 2}}

Eigenvalues[%]

(* Eigenvalues of the Rosser matrix.  This matrix is notorious for 
causing
   numerical eigenvalue routines to fail.   [Wester, p. 146 (Cleve Moler)]
   => {-10 sqrt(10405), 0, 510 - 100 sqrt(26), 1000, 1000,
       510 + 100 sqrt(26), 1020, 10 sqrt(10405)} =
      {-1020.049, 0, 0.098, 1000, 1000, 1019.902, 1020, 1020.049} *)

rosser = {{ 611,  196, -192,  407,   -8,  -52,  -49,   29},
          { 196,  899,  113, -192,  -71,  -43,   -8,  -44},
          {-192,  113,  899,  196,   61,   49,    8,   52},
          { 407, -192,  196,  611,    8,   44,   59,  -23},
          {  -8,  -71,   61,    8,  411, -599,  208,  208},
          { -52,  -43,   49,   44, -599,  411,  208,  208},
          { -49,   -8,    8,   59,  208,  208,   99, -911},
          {  29,  -44,   52,  -23,  208,  208, -911,   99}};

Eigenvalues[rosser]

Eigenvalues[N[rosser]]

Clear[rosser]

(* Eigenvalues of the generalized hypercompanion matrix of
   (x^5 + a4*x^4 + a3*x^3 + a2*x^2 + a1*x + a0)*(x^2 + x + 1)^2
   => {[-1 +- sqrt(3) i]/2, [-1 +- sqrt(3) i]/2,
       RootsOf(x^5 + a4*x^4 + a3*x^3 + a2*x^2 + a1*x + a0)} *)

{{-a4, -a3, -a2, -a1, -a0,  0,  0,  0,  0},
 {  1,   0,   0,   0,   0,  0,  0,  0,  0},
 {  0,   1,   0,   0,   0,  0,  0,  0,  0},
 {  0,   0,   1,   0,   0,  0,  0,  0,  0},
 {  0,   0,   0,   1,   0,  0,  0,  0,  0},
 {  0,   0,   0,   0,   0, -1, -1,  0,  0},
 {  0,   0,   0,   0,   0,  1,  0,  0,  0},
 {  0,   0,   0,   0,   0,  0,  1, -1, -1},
 {  0,   0,   0,   0,   0,  0,  0,  1,  0}}

Eigenvalues[%]

ComplexExpand[%]

(* Eigenvalues and eigenvectors => lambda = {a, a, a, 1 - i, 1 + i},
   eigenvectors = [[1 0 0 0 0], [0 0 1 0 0], [0 0 0 1 0],
                   [0, (1 + i)/2, 0, 0, 1], [0, (1 - i)/2, 0, 0, 1]]^T *)

{{a,  0, 0, 0, 0},
 {0,  0, 0, 0, 1},
 {0,  0, a, 0, 0},
 {0,  0, 0, a, 0},
 {0, -2, 0, 0, 2}}

Eigensystem[%]

(* Eigenvalues and generalized eigenvectors   [Johnson and Riess, p. 
193]
   => lambda = {1, 1, 1}, eigenvectors = [[4 -1 4], [1 -1 2], [3 -1 3]]^T *)

{{-1,  -8, 1},
 {-1,  -3, 2},
 {-4, -16, 7}}

Eigensystem[%]

(* Eigenvalues and generalized eigenvectors   [Johnson and Riess, p. 
199]
   => lambda = {1, 1, 1, 1, 2, 2}, eigenvectors =
      [[1 -1  0  0  0 0], [-1 0 0 1 0 0], [0 0 1 -1 0 -1],
       [0  0 -1 -2 -1 3], [ 0 2 0 0 0 0], [2 0 1  1 0  0]]^T *)

{{1, 0, 1, 1, 0, 1},
 {1, 2, 0, 0, 0, 0},
 {0, 0, 2, 0, 1, 1},
 {0, 0, 1, 1, 0, 0},
 {0, 0, 0, 0, 1, 0},
 {0, 0, 0, 0, 1, 1}}

Eigensystem[%]

(* Jordan form => diag([[1 1],[0 1]], [[1 1],[0 1]], -1)   
[Gantmacher, p. 172]
   *)

{{1,  0,  0,  1, -1},
 {0,  1, -2,  3, -3},
 {0,  0, -1,  2, -2},
 {1, -1,  1,  0,  1},
 {1, -1,  1, -1,  2}}

JordanDecomposition[%] // MatrixForm

(* Smith normal form => [[1, 0], [0, x^4 - x^2 + 1]]   [Cullen, p. 
230] *)

{{x^2, x - 1}, {x + 1, x^2}}

(* Matrix exponential => e [[cos 2, -sin 2], [sin 2, cos 2]] *)

MatrixExp[{{1, -2}, {2, 1}}]

Simplify[ComplexExpand[%]]

(* Matrix exponential   [Rick Niles] =>
   [[1, 4 sin(w t)/w - 3 t , 6 [w t - sin(w t)], 2/w [1 - cos(w t)] ],
    [0, 4 cos(w t) - 3     , 6 w [1 - cos(w t)], 2 sin(w t)         ],
    [0, -2/w [1 - cos(w t)], 4 - 3 cos(w t)    , sin(w t)/w         ],
    [0, -2 sin(w t)        , 3 w sin(w t)      , cos(w t)           ]] *)

{{0, 1,    0,     0  },
 {0, 0,    0,     2*w},
 {0, 0,    0,     1  },
 {0, -2*w, 3*w^2, 0  }}

Simplify[ComplexExpand[MatrixExp[%*t]]]

(* Sine of a Jordan matrix => diag([[sin a, cos a],[0, sin a]], sin 
b,
   [[sin c, cos c, -sin(c)/2],[0, sin c, cos c],[0, 0, sin c]])
   See F. R. Gantmacher, _The Theory of Matrices_, Volume One, Chelsea
   Publishing Company, 1977, p. 100 to see how to do a general function. *)

{{a, 1, 0, 0, 0, 0},
 {0, a, 0, 0, 0, 0},
 {0, 0, b, 0, 0, 0},
 {0, 0, 0, c, 1, 0},
 {0, 0, 0, 0, c, 1},
 {0, 0, 0, 0, 0, c}}

ComplexExpand[Im[MatrixExp[%*I]]] // MatrixForm

(* Sine of a matrix => [[1 0 0], [0 1 0], [0 0 1]]   [Cullen, p. 
261] *)

Pi/2*{{2, 1, 1}, {2, 3, 2}, {1, 1, 2}}

Im[MatrixExp[%*I]]

(* Matrix square root => {+-[[3 1], [1 4]], +-1/sqrt(5) [[-1 7], [7 
6]]} *)

{{10, 7}, {7, 17}}

FullSimplify[MatrixPower[%, 1/2]]

(* Square root of a non-singular matrix   [Gantmacher, p. 233]
   => [[e, (e - n) v w + e/2, (n - e) v], [0, e, 0], [0, (e - n) w, n]
   for arbitrary v and w with arbitrary signs e and n = +-1 *)

{{1, 1, 0}, {0, 1, 0}, {0, 0, 1}}

MatrixPower[%, 1/2]

(* Square root of a singular matrix   [Gantmacher, p. 239]
   => [[0 a b], [0 0 0], [0 1/b 0]] for arbitrary a and b *)

{{0, 1, 0}, {0, 0, 0}, {0, 0, 0}}

MatrixPower[%, 1/2]

(* Singular value decomposition
   => [1/sqrt(14)  3/sqrt(10) 1/sqrt(35) ] [2 sqrt(7) 0] [1/sqrt(2)  
1/sqrt(2)]
      [2/sqrt(14)  0           -sqrt(5/7)] [0         0] [1/sqrt(2) 
-1/sqrt(2)]
      [3/sqrt(14) -1/sqrt(10) 3/sqrt(35) ] [0         0]
      = U Sigma V^T --- singular values are [2 sqrt(7), 0] *)

m = {{1, 1}, {2, 2}, {3, 3}}

SingularValues[m]

SingularValues[N[m]]

Clear[m]

(* Jacobian of (r cos t, r sin t) => [[cos t, -r sin t], [sin t, r 
cos t]] *)

Outer[D, {r*Cos[t], r*Sin[t]}, {r, t}]

(* Hessian of r^2 sin t => [[2 sin t, 2 r cos t], [2 r cos t, -r^2 
sin t]] *)

r^2*Sin[t]

(* Wronskian of (cos t, sin t) => [[cos t, sin t], [-sin t, cos t]] 
*)

{Cos[t], Sin[t]}

(* How easy is it to define functions to do the last three 
operations?
   Jacobian of (r cos t, r sin t) => [[cos t, -r sin t], [sin t, r cos t]] *)

MYjacobian[f_, x_]:= Module[{n = Length[x]},
   Table[Table[D[f[[i]], x[[j]]], {j, 1, n}], {i, 1, n}] ]

MYjacobian[{r*Cos[t], r*Sin[t]}, {r, t}]

(* Hessian of r^2 sin t => [[2 sin t, 2 r cos t], [2 r cos t, -r^2 
sin t]] *)

MYhessian[f_, x_]:= Module[{n = Length[x]},
   Table[Table[D[f, x[[i]], x[[j]]], {j, 1, n}], {i, 1, n}] ]

MYhessian[r^2*Sin[t], {r, t}]

(* Wronskian of (cos t, sin t) => [[cos t, sin t], [-sin t, cos t]] 
*)

MYwronskian[f_, x_]:= Module[{n = Length[f]},
   Table[Table[D[f[[j]], {x, i-1}], {j, 1, n}], {i, 1, n}] ]

MYwronskian[{Cos[t], Sin[t]}, t]

(* ---------- Quit ---------- *)
