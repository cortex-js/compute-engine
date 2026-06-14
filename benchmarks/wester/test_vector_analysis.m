(* Extracted from https://math.unm.edu/~wester/demos/VectorAnalysis/Math.problems
   Source index: https://math.unm.edu/~wester/cas_review.html *)

(* ----------[ M a t h e m a t i c a ]---------- *)

(* ---------- Initialization ---------- *)

(* ---------- Vector Analysis ---------- *)

<< Calculus`VectorAnalysis`

(* Vector norm => sqrt(15) *)

norm[v_]:= First[Sqrt[v . Conjugate[Transpose[{v}]]]]

norm[{1 + I, -2, 3*I}]

Clear[norm]

(* Cross product: (2, 2, -3) x (1, 3, 1) => (11, -5, 4) *)

Cross[{2, 2, -3}, {1, 3, 1}]

(* (a x b) . (c x d) => (a . c) (b . d) - (a . d) (b . c) *)

Cross[a, b] . Cross[c, d]

(* => (2 y z^3 - 2 x^2 y^2 z,   x y,   2 x y^2 z^2 - x z) *)

SetCoordinates[Cartesian[x, y, z]];

Curl[{x*y*z, x^2*y^2*z^2, y^2*z^3}]

(* DEL . (f x g) => g . (DEL x f) - f . (DEL x g) *)

Div[Cross[f, g]]

(* Express DEL . a in spherical coordinates (r, theta, phi) for
   a = (a_r(r, theta, phi), a_theta(r, theta, phi), a_phi(r, theta, phi)).
   Here, phi is in the x-y plane and theta is the angle with the z-axis.
   => 1/r^2 d/dr[r^2 a_r] + 1/[r sin(theta)] d/dtheta[sin(theta) a_theta]
      + 1/[r sin(theta)] da_phi/dphi
   => da_r/dr + (2 a_r)/r + 1/r da_theta/dtheta + a_theta/[r tan(theta)]
      + 1/[r sin(theta)] da_phi/dphi
   See Keith R. Symon, _Mechanics_, Third Edition, Addison-Wesley Publishing
   Company, 1971, p. 103. *)

Div[{ar[r, theta, phi], atheta[r, theta, phi], aphi[r, theta, phi]},
    Spherical[r, theta, phi]]

Expand[%]

(* Express dR/dt in spherical coordinates (r, theta, phi) where R is 
the
   position vector r*Rhat(theta, phi) with Rhat being the unit vector in the
   direction of R => (dr/dt, r dtheta/dt, r sin(theta) dphi/dt)
   [Symon, p. 98] *)

SetCoordinates[Spherical[r, theta, phi]];

D[{r[t]*rhat[theta[t], phi[t]], 0, 0}, t]

(* Scalar potential => x^2 y + y + 2 z^3 *)

(*ScalarPotential[{2*x*y, x^2 + 1, 6*z^2}]*)

(* Vector potential => (x y z, x^2 y^2 z^2, y^2 z^3) is one possible 
solution.
   See Harry F. Davis and Arthur David Snider, _Introduction to Vector
   Analysis_, Third Edition, Allyn and Bacon, Inc., 1975, p. 97. *)

(*VectorPotential[{2*y*z^3 - 2*x^2*y^2*z, x*y, 2*x*y^2*z^2 - x*z}]
  Curl[%]*)

(* Orthogonalize the following vectors (Gram-Schmidt).  See Lee W. 
Johnson and
   R. Dean Riess, _Introduction to Linear Algebra_, Addison-Wesley Publishing
   Company, 1981, p. 104 => [[0 1 2 1], [0 -1 1 -1], [2 1 0 -1]]^T *)

<< LinearAlgebra`Orthogonalization`

{{0, 1, 2, 1}, {0, 1, 3, 1}, {1, 1, 1, 0}, {1, 3, 6, 2}}

GramSchmidt[%, Normalized -> False]

(* ---------- Quit ---------- *)
