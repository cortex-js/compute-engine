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

## Node 26 benchmark results

These runs use **Node 26.12.0**, Python 3.12.14 / SymPy 1.14.0 without
python-flint, and the separately installed PARI WASM package 1.0.5, on Windows
with an Intel Core Ultra 7 165U. They compare the current strategies with each
other; differences from older Node 22 measurements are **not** isolated
algorithm speedups. The host was not exclusive, so small timing differences
should not be overinterpreted.

Each main run uses three seeded, interleaved trials, identical expanded inputs,
persistent workers (restarted after a timeout), and one solve in flight. The
regular, stress and challenge corpora retain 30-second per-case timeouts. The
new recombination corpus uses a **five-second timeout for every backend**.
Timeouts are censored observations, not evidence that a CAS cannot solve a case
with a longer allowance. All CE strategies retain the two-million-operation
budget and default size limits. Profiling is disabled in these comparisons.

### Coverage

Entries count distinct cases verified on **all three trials**. Both subset
columns have identical coverage but different lifting implementations.

| Corpus | Automatic TS | Forced lattice | Linear/quadratic subsets | SymPy | PARI |
| --- | ---: | ---: | ---: | ---: | ---: |
| Regular | 1200/1200 | 1200/1200 | 1200/1200 | 1200/1200 | 1200/1200 |
| Stress | 39/42 | 39/42 | 39/42 | 42/42 | 42/42 |
| Challenge | 42/42 | 42/42 | 41/42 | 41/42 | 42/42 |
| Recombination families | 24/24 | 24/24 | 5/24 | 7/24 | 24/24 |

SymPy verified 23 of 72 family attempts: seven cases on all trials and
`recombination-005` on two trials. The other 49 attempts timed out. On the
challenge corpus, its three timeouts are the degree-64 case. Subset strategies
hit the operation limit on that case and on 19 of the 24 family inputs.

The three default stress refusals remain size policies: one degree-144 input
and two inputs with 4097/8193-bit coefficients. A separate automatic-TS run
allows degree 256 and 16384-bit coefficients while retaining two million
operations; it verifies all 42 inputs on all three trials. This is an opt-in
policy change, not a default-coverage improvement.

### Matched solve time

Aggregate solve seconds across three trials, restricted to cases that **every
backend verifies on every trial**. This avoids treating cheap refusals or missing
timeout solve times as speed wins. TS includes certification/reconstruction;
SymPy measures `factor_list`; PARI includes GP-input serialization but excludes
output normalization. This is not a matched proof-checking benchmark.

| Common completed inputs | Linear/subsets | Quadratic/subsets | Forced lattice | Automatic TS | SymPy | PARI |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Regular: 1200 | 8.895 | 10.010 | 10.835 | 8.700 | 26.450 | 5.515 |
| Stress: 39 | 1.678 | 1.634 | 0.975 | 0.834 | 4.554 | 0.659 |
| Challenge: 41 | 2.480 | 2.407 | 2.050 | 2.017 | 3.726 | 0.403 |
| Recombination families: 5 | 2.739 | 2.791 | 0.371 | 0.381 | 2.401 | 0.109 |

Automatic TS takes about half the linear/subset time on the matched stress set,
and 7.2 times less on the five common family inputs. Forced lattice is also
faster there, but forcing it on every small regular input adds overhead. The
automatic policy therefore retains inexpensive subset recombination for small
modular-factor sets. These are whole-strategy comparisons, including prime
selection and lifting precision, not isolated LLL timings.

For the **full 24-input family corpus**, both automatic TS and PARI complete all
72 attempts: their totals are 14.765 and 2.958 seconds, respectively. PARI is
still about five times faster on that set. Automatic TS is about three times
faster than SymPy on the complete regular corpus, but takes 1.58 times PARI's
time. No claim of universal superiority or a Mathematica comparison is made.

### Degree-64 result

`challenge-041` now completes in **1,321,008 counted operations**, using one good
prime and six quadratic lifts, on every trial. Automatic TS times are
107.68, 91.76 and 108.34 ms; PARI times are 50.38, 48.53 and 47.50 ms. Forced
lattice also completes every trial (77.16–111.01 ms). Both subset strategies
exhaust two million operations, and SymPy times out at 30 seconds each time.
The important change is certified completion within unchanged limits, not a
claim to beat PARI.

The isolated lattice diagnostic uses prime 19, 32 modular factors and 272-bit
lifted precision. Six coefficient constraints reduce the retained rank
`32 → 29 → 23 → 13 → 10 → 5 → 1`, using 870,548 probe operations including exact
block recovery. That diagnostic has a larger explicit work allowance; it is
not substituted for the default-budget result above.

### Profiling and remaining work

Separate one-trial profiled runs cover all 1200 regular, 42 challenge and 24
family inputs; phase work totals are independently checked against total work.
On the family corpus, preprocessing accounts for 1.891 of 3.737 seconds (about
51%), recombination 1.181 seconds (32%), and lifting 0.428 seconds (11%). These
single-backend profile times are diagnostic and must not be mixed with the
interleaved comparison table.

A 20-repeat CPU profile of `challenge-041` contains 1993 samples, including
390 self samples in integer-lattice code and 309 in Hensel code. Recombination
uses 934,460 of its 1,321,008 counted operations. Further improvements could
reuse exact Gram-Schmidt state across incremental constraints and reduce
bigint modular arithmetic in lifting, without weakening exact certification.

The slow equal-degree product `recombination-023` exposes another bottleneck:
a five-repeat CPU profile attributes 910 of 1380 samples to integer GCD.
Preprocessing takes 327–353 ms per diagnostic repetition, versus 33–50 ms for
recombination. The bounded initial square-free screening tries only primes
2, 3, 5, 7 and 11; when none supplies a certificate it falls back to primitive
integer GCD. Adaptive additional-prime screening and modular/subresultant GCD
are general next targets, with repeated-factor regressions and matched timing
tests needed before changing that policy. This follow-up does not change it.

### Audit and retained artifacts

The four main runs contain **23,544 independently audited records**. There are
no missing/duplicate IDs, mismatches or backend errors. Budget refusals and
timeouts are retained, not counted as successes. The expanded-size run adds
126 records and the three profile runs add 1266, for **24,936 audited records**
in total. CPU-profile repetitions and warmups are not included in that count.

Measured source SHA-256 (all eight manifests match a final checkout rehash):

`ae3f63ca17b4d0e3bc7aa97b3f89505f4da09809411934ff640d1b44cb64bf06`

| Corpus | SHA-256 |
| --- | --- |
| Regular | `cc61ac2f1561ad90d7e4614a1b2cfe3c649ea0f5298412551c881f489c46a903` |
| Stress | `6b899024c3ca29abe806173c7a8f3cfef8d8ca19c86abb3af4042932a16b88f7` |
| Challenge | `086db6cd190c18f387ac607117add990ca73d5477f239d6b0493f2175097fc7b` |
| Recombination | `43a56b21c74e36973237a67b4f2c859288779b7a6682ca85e6bf2cfb70abc168` |

Retained ignored directories are `build/factoring-gradual-node26-final-`
followed by `regular`, `stress`, `challenge` or `recombination`;
`build/factoring-gradual-node26-expanded`; and
`build/factoring-gradual-node26-profile-` followed by `regular`, `challenge` or
`recombination`. Each contains its corpus, manifest and append-only result
journal. CPU profiles are `build/factoring-gradual-node26-hard.cpuprofile` and
`build/factoring-gradual-node26-product.cpuprofile`. PARI emits unsupported-syscall
warnings from its external WASM environment, but returns verified results on
every case. No comparator binaries or generated journals are committed.

## Reproduction

Use the benchmark README's comparator setup and a fresh output directory.
Run with Node 26; for example, the two main commands below use all six
configurations and the recorded per-case timeouts:

```sh
node --import tsx benchmarks/factorization/run.ts --output build/new-regular-run --corpus regular --backends typescript-linear,typescript-quadratic,typescript-lattice,typescript,sympy,pari --python <python-with-sympy> --repeats 3 --timeout 30
node --import tsx benchmarks/factorization/run.ts --output build/new-family-run --corpus recombination --backends typescript-linear,typescript-quadratic,typescript-lattice,typescript,sympy,pari --python <python-with-sympy> --repeats 3 --timeout 5
node --import tsx benchmarks/factorization/audit.ts build/new-family-run
```

Use `--corpus stress` or `--corpus challenge` with a new directory and the
30-second timeout for the other main runs.
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

## PR review follow-up

The [maintainer review](https://github.com/cortex-js/compute-engine/pull/461#pullrequestreview-5595328316)
also identified integration and API issues. The follow-up reads large rational
coefficients through CE's exact numeric representation and `bigint()` helper,
restores the rational-root fallback after an incomplete certified attempt,
constructs variable powers directly, and strides CE deadline checks. Typed
internal certificate failures become `incomplete: verification-failed`;
cancellation, invalid input and unrelated callback exceptions still propagate.

The numerics entry point now exports only the univariate factorizer and its
types from this feature. Multivariate/number-field/splitting-field code remains
internal pending a separate API review; its unresolved budgeting and contract
issues are listed in the [delivered design](2026-10-20-certified-polynomial-factorization.md).
That document replaces the earlier working notes. The benchmark index and
unreleased changelog now include this feature.
The review's optional tighter lifting coefficient bound is deferred; the
existing conservative bound remains valid, and the new quadratic lifting and
gradual recombination changes do not rely on tightening it.

Node 22.14.0 and Node 26.12.0 each pass **279 tests across 18 targeted suites**
after these changes, including existing Factor and partial-fraction tests.
Changed-code type checks, source Oxlint, code formatting, production build,
declaration emission and ESM/CommonJS public-export smoke checks pass. This
does not claim a completed full-suite or green CI run. The maintainer identified
the existing Node 26 timing-test failures as also failing on main; they are
unchanged here. Follow-up commits are local, not pushed.
