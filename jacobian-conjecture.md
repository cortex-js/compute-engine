# The Jacobian Conjecture Is False

_A summary of the July 2026 counterexample, with every computation carried out
in Epsil. All code blocks on this page are executable as written; each was
verified against the Epsil runtime in this repository._

## The conjecture

In 1939, Ott-Heinrich Keller asked a deceptively simple question. Take a
polynomial map $F : \mathbb{C}^n \to \mathbb{C}^n$ — each output coordinate a
polynomial in the input coordinates. The multivariable chain rule says that if
$F$ has a polynomial inverse, the determinant of its Jacobian matrix must be a
nonzero constant (two polynomials multiplying to 1 are both constants). The
**Jacobian Conjecture** is the converse:

> If $\det DF$ is a nonzero constant, then $F$ is invertible, with a polynomial
> inverse.

A constant nonzero Jacobian makes $F$ a local isomorphism _everywhere_ — no
critical points, no folding, anywhere. The conjecture asserts that this
everywhere-local rigidity forces global invertibility.

For 87 years the problem resisted proof and disproof alike, accumulating an
infamous trail of flawed published proofs along the way, plus real partial
results:

- **Dimension 1** is easy: constant $F'$ means $F$ is affine.
- **Wang (1980)**: true for maps of degree ≤ 2, in every dimension.
- **Bass–Connell–Wright / Yagzhev (1982)**: it suffices to prove the case
  $F = \mathrm{id} + H$ with $H$ cubic homogeneous — at the price of raising the
  dimension. Degree three, in all dimensions at once, would give all degrees.
- Over $\mathbb{R}$, **Pinchuk (1994)** built a polynomial map with
  everywhere-nonvanishing (but non-constant) Jacobian that is not injective —
  showing the _real_ analogue with the weaker hypothesis fails, while leaving
  Keller's constant-Jacobian question untouched.

## The counterexample

On July 20, 2026,
[Levent Alpöge announced](https://x.com/__alpoge__/status/2079028340955197566)
an explicit counterexample in dimension 3 — found not by a human, but by
Anthropic's Claude Fable 5 model (the announcement is 216 characters of
mathematics). It is a degree-7 map
$F = (a, b, c) : \mathbb{C}^3 \to
\mathbb{C}^3$. In Epsil, we can define it by
quoting the announcement's LaTeX verbatim — a `$…$` LaTeX island is parsed and
spliced in as an expression:

```epsil
a(x, y, z) = $(1+xy)^3 z + y^2(1+xy)(4+3xy)$
b(x, y, z) = $y + 3x(1+xy)^2 z + 3xy^2(4+3xy)$
c(x, y, z) = $2x - 3x^2 y - x^3 z$
```

Two claims to check: the Jacobian determinant is the constant $-2$ (so the map
satisfies Keller's hypothesis exactly), and the map is nevertheless not
injective.

### The Jacobian is constant

The `JacobianMatrix` operator builds the matrix of symbolic partial derivatives
∂fᵢ/∂xⱼ directly; pipe it through `Determinant` and `Simplify`:

```epsil
let J = [a, b, c] |> JacobianMatrix

J |> Determinant |> Simplify
// ➔ -2
```

This is the miracle of the construction. Each entry of $J$ is a polynomial of
degree up to 6, so the determinant "should" be a polynomial of degree ~18 — yet
every non-constant term cancels. Terence Tao points out how implausible this is
by parameter counting: a general degree-7 map on $\mathbb{C}^3$ has about 360
coefficients, while forcing the determinant to be constant imposes on the order
of 1329 polynomial conditions. Solutions shouldn't exist by naive counting — and
yet.

### The map is 3-to-1

Three distinct points — real, and even rational — hit the same image:

```epsil
F(p) = (a(...p), b(...p), c(...p))

let fiber = [(0, 0, -1/4), (1, -3/2, 13/2), (-1, 3/2, 13/2)]
Map(fiber, F)
// ➔ [(-1/4, 0, 0), (-1/4, 0, 0), (-1/4, 0, 0)]
```

(`...p` spreads the point's coordinates into each component's argument list.)

The arithmetic here is exact rational arithmetic, not floating point, so this is
a proof, not numerical evidence. A two-line certificate of non-injectivity:

```epsil
(F((0, 0, -1/4)) == F((1, -3/2, 13/2)), (0, 0, -1/4) != (1, -3/2, 13/2))
// ➔ (True, True)
```

That's the whole disproof: constant nonzero Jacobian, not injective, so no
inverse of any kind — polynomial or otherwise. The conjecture is false for
$n = 3$, and by padding with identity coordinates
$(x_1, x_2, x_3, x_4, \ldots) \mapsto (F(x_1,x_2,x_3), x_4, \ldots)$, false for
every $n \ge 3$. Since the collision points are real, the constant-Jacobian
statement fails over $\mathbb{R}$ as well. **Dimension 2 remains open.**

## Why this evades every known positive result

- **Wang's theorem** covers degree ≤ 2; this map is degree 7.
- **The cubic-homogeneous reduction** (Bass–Connell–Wright) says degree 3 in all
  dimensions implies all degrees — a one-way implication that is simply vacuous
  now: the reduction transported the conjecture's difficulty, not its truth.
- **Pinchuk's real counterexample** had non-constant Jacobian, so it never
  touched Keller's hypothesis. This map satisfies the hypothesis on the nose.
- **Local analysis can't see it.** With $\det DF = -2$ everywhere, $F$ is a
  local biholomorphism at every point — étale, in algebraic language. The
  failure is purely global: as John D. Cook put it, _locally everywhere does not
  imply everywhere_.

A structural hint that this is no accident: the components are homogeneous for
the grading $\deg x = -1$, $\deg y = 1$, $\deg z = 2$ (with $\deg a = 3$,
$\deg b = 1$, $\deg c = -1$). The map has hidden symmetry.

## The geometry: multiplying polynomials

Within a day, Tao and the Secret Blogging Seminar had reverse-engineered _why_
the map exists, and the mechanism is beautiful. Consider the multiplication map

$$ (L, Q) \mapsto L \cdot Q $$

sending a (linear, quadratic) pair of polynomials in one variable $t$ to their
cubic product — from
$\mathrm{Sym}^1(\mathbb{C}^2) \times
\mathrm{Sym}^2(\mathbb{C}^2)$ to
$\mathrm{Sym}^3(\mathbb{C}^2)$. Both sides have dimension 4… wait,
$2 + 3 = 5 \ne 4$. The fix is exactly the slice Alpöge's map lives on: impose
the normalization $\operatorname{Res}(L, Q) = 1$ on the resultant to cut the
source down by one, killing the scaling symmetry
$(L, Q) \sim (\lambda L, \lambda^{-1} Q)$.

The multiplication map is étale precisely where $L$ and $Q$ share no root —
which is exactly where the resultant is nonzero. But it is not injective: a
cubic with three distinct roots factors as linear × quadratic in **three** ways,
one for each choice of which root the linear factor takes. Watch the mechanism
in Epsil:

```epsil
P(t) = $t^3 - 6t^2 + 11t - 6$
Solve(P(t) == 0, t) |> r => (t - r, Simplify(P(t) / (t - r)))
// ➔ [(t - 1, t^2 - 5t + 6), (t - 2, t^2 - 4t + 3), (t - 3, t^2 - 3t + 2)]
```

Three factorizations, three preimages — the generic 3-to-1 behavior of Alpöge's
map, and the origin of the three-point fiber we verified above. The polynomial
identities that make $\det DF$ collapse to $-2$ are the shadow, in coordinates,
of "multiplication of coprime polynomials is étale". The counterexample isn't a
random needle in coefficient space; it is a natural map between moduli of
polynomials, written out in an explicit chart.

## Could Epsil have found the counterexample?

Three different questions hide in there.

**Verification — yes, trivially.** Everything above runs in milliseconds:
symbolic differentiation, exact determinant, exact rational evaluation. The
216-character claim is checkable by anyone with the formula, which is part of
what makes the episode remarkable — the hard-to-find, easy-to-check asymmetry
usually associated with NP problems, playing out in algebraic geometry.

**Blind search — no.** Tao's degrees-of-freedom count (~360 unknowns against
~1329 equations) means random search over degree-7 coefficient vectors would
essentially never land on the solution variety; you'd be looking for a
positive-codimension miracle. No amount of raw compute in any CAS finds this by
enumeration. And a direct assault on a found candidate's fibers is also out of
reach of today's solvers — asking Epsil to solve `F(x,y,z) == (-1/4, 0, 0)` as a
raw degree-7 system returns the equation unsolved, symbolically intact. The
fibers only become computable _through the structure_ (factor the cubic, as
above).

**Structured search — yes, plausibly.** Once the idea is "multiplication maps
between spaces of polynomials, normalized by a resultant", the search space
collapses from 360 coefficients to a handful of discrete choices (degrees to
multiply, which slice to take), and Epsil has every primitive needed to audit a
candidate family:

```epsil
// The resultant that defines the normalization slice is a built-in:
Resultant(t - 1, t^2 - 5*t + 6, t)
// ➔ 2

// A machine-checkable certificate that (F, p, q) refutes the conjecture:
// the simplified determinant is a nonzero literal, and p, q collide.
let detJ = J |> Determinant |> Simplify
let p = (0, 0, -1/4)
let q = (1, -3/2, 13/2)
(Type(detJ) == "integer", detJ != 0, p != q, F(p) == F(q))
// ➔ (True, True, True, True)
```

A driver that enumerates (deg L, deg Q) splittings, writes down the chart,
symbolically checks `Determinant |> Simplify` for constancy, and hunts small
rational collisions via cubic factorization would have found this map in
minutes. The creative act — the one the model supplied — was choosing to look at
moduli of factorizations at all, when 87 years of intuition said the answer was
"true". The lesson for computer algebra is the same one this episode teaches
about AI: the machine's role was not brute force but a guided leap, with a
symbolic engine as the lab bench where each conjecture-sized idea gets falsified
— or, once in 87 years, doesn't.

## Status

| Dimension | Status                                             |
| --------- | -------------------------------------------------- |
| $n = 1$   | True (trivial)                                     |
| $n = 2$   | **Open**                                           |
| $n \ge 3$ | **False** (Alpöge–Fable map, padded with identity) |

The core calculations have been verified independently many times over —
including by every code block on this page — while the writeup awaits formal
peer review.

## Sources

- [Levent Alpöge's announcement](https://x.com/__alpoge__/status/2079028340955197566)
  (X, July 20, 2026)
- [Terence Tao, "A digestion of the Jacobian conjecture counterexample"](https://terrytao.wordpress.com/2026/07/21/a-digestion-of-the-jacobian-conjecture-counterexample/)
- [Secret Blogging Seminar, "The new counterexample to the Jacobian conjecture"](https://sbseminar.wordpress.com/2026/07/20/the-new-counterexample-to-the-jacobian-conjecture/)
- [John D. Cook, "Locally everywhere does not imply everywhere"](https://www.johndcook.com/blog/2026/07/21/jacobian-conjecture/)
- [Anton Antonov, Wolfram Community notebook verifying the counterexample](https://community.wolfram.com/groups/-/m/t/3766129)
- [Jacobian Conjecture — Wolfram MathWorld](https://mathworld.wolfram.com/JacobianConjecture.html)
- [Stanford Tech Review coverage](https://www.stanfordtechreview.com/articles/jacobian-conjecture-disproved-ai-counterexample)
