# General prime-ideal factoring: implementation and verification

This extends the [public API milestone](2026-10-25-public-factoring-api.md),
based on main `8092e4cb0` (0.169.0). The implementation remains TypeScript-only.
It introduces no MathJSON operator or runtime dependency.

## 1. Observe the real fallback cause

`factorDetailed().statistics` now retains per-component direct-method
diagnostics: prime attempts, chosen prime/residue degree, lifting precision,
recovery/division counts, the certificate used, and the fallback reason. The
number of computed norms is also exposed. This distinguishes the initiating
failure from a later `norm-degree-limit` result.

Profiling the 14 distinct unfinished IDs in the previous full public run found:

- Ten cases exhausted the inert-prime search. Eight are biquadratic or eighth
  cyclotomic cases; two are high-degree inputs over the nonradical quartic.
- Four nonintegral-generator cases exceeded the direct method's intermediate
  coefficient bound. Two then hit the norm-degree ceiling; the degree-24 cases
  attempted costly rational norm factorization.

Diagnostic snapshots are retained locally under
`build/number-field-direct-before-02`, `build/number-field-direct-ideal`, and
`build/number-field-direct-recovery`. Their separately bundled runners preserve
the successive implementations. These are focused profiling runs, not full
coverage scores or controlled wall-time comparisons. Cooperative deadlines can
overshoot during a single expensive BigInt operation; the full corpus uses
process-enforced deadlines instead. The earlier interrupted diagnostic directory
is not a completed result and is not used here.

## 2. Lift at general unramified prime ideals

The search still prefers an inert prime, preserving the existing full-residue-
degree path. It also retains a usable irreducible factor of the defining
polynomial at a split, unramified prime. A square-free reduction of the input is
required at that residue field. Candidate selection is bounded and does not
depend on known fixture factors.

Two existing Hensel mechanisms are reused: the integer tree lifts the selected
factor of the defining polynomial, while the number-field tree lifts the input
factors over that evolving coefficient relation. A relation update must agree
with the old relation at the old precision. Updates commit only after the entire
polynomial tree passes its congruence checks.

### Exact recovery and certificate argument

For residue factor `h` and precision `M`, the kernel of reduction from the
integral power basis is the lattice `(M, h(beta))`. In degree `d`, with residue
degree `e`, a triangular basis consists of `M` times the first `e` coordinate
vectors and `beta^j - rem(beta^j, h)` for `e <= j < d`. The existing exact LLL
routine reduces this basis; its exact Gram-Schmidt data constructs the dual.

Let `B` contain reduced basis rows. The columns of `M B^-1` are integral because
`M Z^d` lies in the lattice. They serve two purposes:

- Recover a representative by subtracting the rounded lattice coordinates. Early
  representatives are only candidates; exact division is mandatory.
- Transport the existing logarithmic-derivative coefficient bounds into linear
  congruences for the existing certified indicator-lattice recombination. For a
  dual column `v` and coordinate bounds `b_j`, the transformed bound is
  `sum(abs(v_j) * b_j)`. Omitted residue coordinates are not assumed zero in the
  original field.

The trace-dual denominator clears the coordinates of algebraic integers even
when the power order is not maximal. For bounded subset recombination, the
strict inequalities `2 * bound * sum(abs(v_j)) < M` ensure every true scaled
coefficient is in the reduced basis's fundamental domain. Only then may failed
exhaustive recovery rule out a divisor. A recovered modular atom is already
irreducible by its residue-field reduction. Lattice groups reuse the existing
indicator-preservation certificate, followed by exact reconstruction.

The mathematical design follows prime-ideal lifting and lattice recovery as
described by
[Roblot, Polynomial Factorization Algorithms over Number Fields](https://math.univ-lyon1.fr/~roblot/resources/factor.pdf).
This implementation uses exact power-basis coordinate bounds and the project's
existing integer-lattice code; it does not copy another CAS implementation or
require numerical embeddings or a maximal-order computation.

## 3. Reduce scaling and recovery growth

Integral conversion now respects coefficient weights: the denominator at degree
`i` need only divide `T^(n-i)`. Processing high-degree coefficients first often
makes the existing scale sufficient for later coefficients. Bounded
perfect-power recognition reuses CE's BigInt helper; a full denominator remains
a safe fallback when a smaller scale is not found. The same approach selects the
generator scale. Integrality is checked during conversion.

The universal monic-divisor bound now uses Mahler measure rather than raising a
Cauchy root bound to the polynomial degree. For every embedding,
`M(g) <= M(F) <= ||F||_1` and each coefficient of a monic divisor is bounded by
`2^n * ||F||_1`. Applying the existing trace-dual bounds gives certified
power-basis coordinate bounds. No public work, degree, or bit limit is raised.

For the biquadratic degree-48 linear-factor case, the recorded recovery bound
fell from 10,790 bits to 293 bits. The degree-64 counterpart stopped exceeding
the intermediate-size limit. The nonintegral cubic degree-24 case went from a
norm fallback using 2,189,785 counted operations to direct completion using
294,233 in the staged diagnostic runs. The quintic degree-24 case also completed
directly instead of entering the unsuccessful norm route. All 14 diagnostic
inputs reconstructed exactly after this stage.

## 4. Avoid a provably unproductive norm attempt

For rational-coefficient `F` in a field of degree `d > 1`, the unshifted norm is
`F^d`, so it is not square-free. Trager now spends its bounded shift attempts on
nonzero shifts in this situation. General algebraic coefficients retain the
zero-shift attempt. Norm degree and work limits are unchanged.

The forced-Trager ablation factors `(x^2+1)(x^2+3)` over three different fields,
three trials each. Exact reconstruction is checked on every trial. The frozen
before/after runners gave:

| Defining polynomial | Norms before / after | Operations before / after |
| ------------------- | -------------------- | ------------------------- |
| `t^2-2`             | 2 / 1                | 7,944 / 6,890             |
| `t^3-2`             | 2 / 1                | 13,918 / 12,457           |
| `t^4+1`             | 2 / 1                | 35,893 / 31,171           |

These are strategy diagnostics, not a replacement for the full corpus or a claim
about PARI/SymPy speed. No cross-CAS timings were rerun in this milestone.

## 5. Verification and remaining limits

The full public verification used the same 199 inputs, three APIs, public
defaults, Node 26.12.0, and five-second worker limit as the preceding milestone.
The run is recorded separately in `build/number-field-public-api-03`. The
independent audit passed: **597 unique verified records, all 199 cases on every
route, with no incomplete results, timeouts, errors, or mismatches**. It checked
exact factors, reconstruction of actual returned expressions and structured
results, completion markers, and frozen source/bundle/corpus hashes.

| Public route       | Previous verified / limited / timeout | New verified / limited / timeout | Total public-call time, all 199 |
| ------------------ | ------------------------------------- | -------------------------------- | ------------------------------- |
| `Factor`           | 186 / 12 / 1                          | 199 / 0 / 0                      | 30.62 s                         |
| `factor()`         | 185 / 12 / 2                          | 199 / 0 / 0                      | 29.56 s                         |
| `factorDetailed()` | 186 / 12 / 1                          | 199 / 0 / 0                      | 29.14 s                         |

These are one-pass coverage and timing observations, not stable speed rankings.
No tests/profilers ran concurrently with this corpus pass. No sample or prefix
was substituted for the full corpus. All 14 previously unfinished IDs now verify
through every public route, under unchanged limits.

Focused tests cover proper residue extensions of degree one and two, exact
coefficient recovery, incompatible relation rejection, coupled Hensel
congruences, linear and nonlinear factors, lattice and subset certification,
nonintegral generators, the norm-shift improvement, and public fallback
diagnostics. Unit tests assert desired mathematical behavior, not timings or
benchmark scores.

The 16 focused CE suites passed (348 tests), followed by two additional
power-order/ramification safety tests: **350 distinct passing CE tests** in
total. All nine independent benchmark/verifier tests passed, including the
external PARI adapter basis check. The dependency scan found no cycles.

Source type checking and lint passed. Test/harness types are checked separately
because Jest does not type-check these files. The full repository CI pipeline
was not run; the targeted CE suites and manual verifier checks are recorded in
the PR. The existing raw journals and bundles stay in ignored local build output
rather than being published with machine-specific paths.

Remaining boundaries are deliberate: ramified primes are excluded; prime,
precision, dimension, degree and coefficient-size searches remain bounded;
integral scales are sufficient but not necessarily minimal. The selection
heuristic prefers inert primes and retains only one split-prime candidate.
Lattice recombination still has its existing dimension/work limits, with bounded
subset/norm fallbacks. This is not a maximal-order, ideal-arithmetic,
splitting-field, compositum, automatic algebraic-coercion, or multivariate API.
Structured success reports internal certification, not a portable proof object.

Reproduction commands and the frozen-source/audit contract are in the
[benchmark guide](../../benchmarks/number-field/README.md). Focused diagnostics:

```sh
node --import tsx benchmarks/number-field/diagnostics.ts --baseline build/number-field-public-api-02 --output build/fresh-failure-profiles
node --import tsx benchmarks/number-field/norm-profile.ts
```
