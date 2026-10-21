# Faster certified lattice recombination

This TypeScript-only follow-up replaces the bounded full-height lattice probes
in the [five-stage implementation](2026-10-20-factoring-lifting-lattices.md).
The degree-64 Swinnerton-Dyer input now completes with CE's unchanged default
two-million-operation limit. The implementation targets general modular-factor
recombination; it does not recognize Swinnerton-Dyer formulas, square-root sums,
or named benchmark polynomials. No runtime dependency or WebAssembly code is
added, and these follow-up commits remain local pending review.

## Algorithms and justification

The previous probe built a high-precision lattice and stopped at dimension 12.
The degree-64 example has 32 modular factors, so it fell back to exponential
subset enumeration. Merely removing the cap made exact-rational reduction
expensive. The replacement separates the required output bound from the input
coefficient height, following the general direction of
[van Hoeij and Novocin's gradual reduction work](https://arxiv.org/abs/1002.0739).
This is an independent implementation, not a claim to reproduce that paper's
complete algorithm or complexity bound.

1. **Fraction-free exact reduction.** Bareiss-style Gram elimination computes
   integer prefix determinants and scaled projections. Size reduction and
   adjacent swaps update these integers with exact divisions. Rational gcd
   normalization is no longer inside every projection update. Floating-point
   preconditioning proposes unimodular integer row operations; exact LLL then
   finishes and computes the norms used by certification.
2. **Truncated incremental constraints.** Add one logarithmic-derivative
   coefficient at a time, beginning with at most 32 bits and adding at most
   16 bits per reduction. Reuse the reduced basis between precision increments.
   The true indicator vectors remain short independently of coefficient height.
3. **Exact removals and projection.** Discard only trailing directions whose
   exact Gram-Schmidt lengths exceed a proven bound. Project the retained
   integer lattice back to its indicator coordinates and remove dependent
   generators using integer row operations, without saturating the lattice.
4. **Recovery before early exit.** A provisional partition can have the right
   rank but still fail to reconstruct rational factors. Continue adding
   constraints until every proposed block exactly divides the polynomial.
   The factorizer repeats exact recovery before accepting irreducible factors.
5. **Precision and prime selection.** A modulus sufficient to reconstruct
   factors need not provide useful lattice constraints. Reserve additional
   precision before expensive reduction. For automatic/lattice strategies,
   stop prime selection once at least eight pieces fit within half the degree;
   this avoids paying for two more complete modular decompositions before
   recombination. Small sets retain cheap exhaustive recombination. Centering
   also considers shifts of one when the coefficient norm falls by a factor
   greater than four.

## Containment certificate

Let the monic, square-free integer polynomial f have degree n and verified
irreducible factors f_i modulo a good prime, lifted modulo M. For a true monic
divisor g, the coefficient at k of f*g'/g is bounded by

    B_k = n * binomial(n-1,k) * ||f||_1.

Expand over roots: each omitted-root product is bounded by the Mahler measure,
which is at most the coefficient L1 norm. This is conservative but exact.

Let c_i in [0,M) be a chosen coefficient of f*f_i'/f_i modulo M. The indicator
e of g has entries zero or one, and sum(e_i*c_i) = t + h*M for some integer h,
where |t| <= B_k. Choose T a power of two with T*B_k <= M and set
a_i = floor(T*c_i/M). Then

    |sum(e_i*a_i) - h*T| <= r + 1,
    ||(e, sum(e_i*a_i) - h*T)||^2 <= r + (r+1)^2,

where r is the number of modular factors. The r term bounds every rounding
error; no floating-point assumption enters the certificate.

At a precision increase T' = s*T, put delta_i = a'_i - s*a_i. Map each lattice
row (v,z) to (v,s*z + sum(v_i*delta_i)). The same integer h yields the new true
short vector. Thus every earlier removal remains valid. After exact LLL, a
trailing Gram-Schmidt direction longer than the bound cannot occur in a true
short vector: its last nonzero integer basis coordinate would alone exceed
the bound. Projection and integer row elimination preserve every true
indicator in the retained lattice.

Equal indicator columns across all retained rows are inseparable over Q.
Only partitions whose blocks all reconstruct and exactly divide f are accepted
as irreducible factors. A failed, cancelled, or budget-exhausted probe never
proves irreducibility; bounded exhaustive recombination remains the fallback.

## Limits and validation

The global work limit is unchanged. A probe receives at most 1,200,000 counted
operations and 15/16 of the remaining parent budget. The dimension cap is 65
(up to 64 modular pieces plus one constraint), and each coefficient uses at
most 96 truncated bits. These remain diagnostic/resource policies, not
mathematical completeness guarantees. New limits can expose cases not covered
by the generated corpora; successful degree-64 tests are not a universal
degree-64 guarantee.

Unit tests cover exact Gram-Schmidt norms against independent orthogonal
vectors, LLL inequalities, unimodular transformations, nonsaturated integer
projection, generated shears, large/ill-conditioned entries, cancellation,
insufficient precision, irreducible degree-64 examples, distinct rational
factors, and extra precision for a reducible multiquadratic family. Tests
assert algebraic behavior, not wall-clock thresholds. A separate diagnostic
checks 75 generated lattice bases of dimensions 2 through 16.

The manual recombination corpus has 24 distinct expanded inputs: independent
prime squareclasses, degrees 16/32/64, translations, and unequal/equal-degree
products. Signed-sum Galois orbits prove the expected factors irreducible;
the generator removes duplicate expanded inputs. No corpus formulas enter
the factorizer. Existing regular, stress and challenge corpora are unchanged.

## Reproduction

Use the benchmark README's comparator setup and a fresh output directory.
Pass `--corpus recombination` for the new family corpus. The strategy labels
`typescript-linear` and `typescript-quadratic` retain exhaustive recombination;
`typescript-lattice` forces the new lattice policy; `typescript` selects it
automatically. Comparisons measure these complete strategies, including prime
selection and precision policy, not LLL in isolation.

For exclusive phase accounting, run `benchmarks/factorization/profile.ts` with
`--corpus challenge --id challenge-041 --repeats 3`. For per-constraint rank and
work, run `benchmarks/factorization/lattice-profile.ts challenge-041`. The latter
is an isolated diagnostic with an explicitly larger 20-million-operation
budget; its timings are not CE's default-budget benchmark results. Node's
`--cpu-prof` can profile either command without changing shipped code.
