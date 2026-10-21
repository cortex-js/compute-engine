# TypeScript factoring performance stages

The subsequent [gradual recombination implementation](2026-10-21-gradual-recombination.md)
supersedes this report's lattice policy and degree-64 limitation. The measurements
below are retained for the five-stage revision, not presented as current results.

Improve the existing certified rational factorizer without external runtime
dependencies or WebAssembly. Preserve exact certification, early recovery,
cancellation and explicit incomplete results. Benchmark timings stay outside
unit tests. This follow-up starts at `0ce1a9695`; existing PR #461 is unchanged
until these changes are explicitly published.

## Stage 1 Phase profiling and baseline

Opt-in profiling reports exclusive preprocessing, modular factoring, lifting,
recombination and verification time/work, including recursive calls and resource
exhaustion. Normal calls do not enable clocks. Tests check observational
equivalence and conservation of counted work, not timing thresholds.

`factoring-stage1-baseline`: 1,200 inputs, three interleaved trials, all 10,800
records independently verified. Aggregate solve times: TS 7.177 s, SymPy
16.748 s, PARI 3.629 s. The corpus and environment follow the benchmark README;
this is a fresh run, not directly interchangeable with older timing snapshots.

A separate 1,200-case profiled pass (`factoring-stage1-profile`) attributes
445.9 ms to preprocessing, 681.1 ms to modular factoring, 252.8 ms to lifting,
353.7 ms to recombination and 229.7 ms to verification. Modular factoring is
the largest measured phase; faster lifting alone cannot remove the entire gap.
Source fingerprint: `5d6e7130adf85bef3f14bfc614ef2a3cf31c3b3069897747410941228a8a869e`.

## Implementation sequence

2. Degree-balanced, restartable quadratic Hensel lifting with exact prime-power
   arithmetic and lifted inverse identities. Retain the linear strategy for
   matched comparisons and small-input crossover measurement.
3. Exact integer LLL with unimodular transformations and independently checked
   size-reduction/Lovasz conditions. Shared work/cancellation budgets apply.
4. Logarithmic-derivative lattice constraints and adaptive recombination.
   Certified short-vector containment must justify any irreducibility claim;
   inconclusive reduction falls back to exhaustive bounded recombination.
5. Matched baseline/quadratic/adaptive benchmarks, targeted difficult families,
   profile comparison and measured crossover decisions. Report regressions as
   well as improvements and retain explicit resource refusals.

Algorithm references: [van Hoeij's overview](https://www.math.fsu.edu/~hoeij/algorithms/Qx.html)
and [FLINT factoring documentation](https://flintlib.org/doc/fmpz_poly_factor.html).
These guide independent implementations; no third-party source is copied.

## Stage 2 Quadratic lifting implementation

The degree-balanced Hensel tree maintains each product and the inverse of its
right child modulo its left child. At modulus m, it solves the product error
modulo m, updates both factors modulo m squared, and Newton-lifts the inverse
at the changed polynomial modulus. Monic division in Z/mZ never assumes a
composite-modulus ring is a field. A whole precision round commits atomically,
so rejection or cancellation cannot leave a half-lifted tree.

Early exact recovery remains enabled. If recovery removes leaves, the remaining
polynomial restarts from its already verified modular factorization. The
linear strategy remains available for matched diagnostics. Unit tests cover
multiple primes/doublings, unequal factor degrees, monic division over a
non-field, invalid congruences, noncoprime factors, cancellation and strategy
agreement for rational/nonmonic/repeated/large inputs. The four initial focused
suites pass 38 tests. Cross-CAS measurements follow separately; fewer lifting
rounds alone do not imply less elapsed time.

The forced-quadratic 1,200-case/three-trial comparison verifies all 10,800
records: TS 7.890 s, SymPy 16.648 s, PARI 3.688 s. This first implementation
regresses aggregate TS time relative to the 7.177 s linear baseline; it is not
justification for enabling quadratic lifting universally. The 42-case stress
comparison audits all 378 records, retaining 39/42 TS completions and only the
three size-policy refusals. Crossover selection remains stage 5 work.

## Stage 3 Exact integer lattice reduction

An independent first-party LLL kernel uses normalized bigint rationals for
Gram-Schmidt data and exact delta=3/4 Lovasz comparisons. It returns both the
reduced basis and its unimodular row transformation. Size reductions update
Gram-Schmidt coefficients without rebuilding rational orthogonal vectors;
swaps recompute exact Gram-Schmidt data. No floating-point decisions are used.

Six tests cover rectangular bases, negative entries, 100-bit inputs, generated
unimodular shears, exact reduction inequalities, determinant +/-1, transformation
reconstruction, input immutability, invalid/dependent bases and work/cancellation
limits. This stage does not yet change polynomial factoring performance; the
kernel is connected to recombination in stage 4.

## Stage 4 Certified lattice recombination

For each lifted modular factor f_i, form selected coefficients of
f*f_i'/f_i modulo the lifting modulus. A true rational factor g selects a 0/1
subset, and the corresponding combination is the integer polynomial f*g'/g.
Its coefficient at k is bounded by n*binomial(n-1,k)*||f||_1: expanding over
roots gives at most deg(g)*binomial(n-1,k) products, each bounded by M(f),
and M(f) <= ||f||_1. The lattice embeds scaled indicator coordinates and these
coefficient congruences. An exact bound covers every true indicator vector.

Trailing Gram-Schmidt directions longer than that bound cannot occur in any
true indicator. Removing them leaves a span containing every rational factor's
indicator. Equal projected columns in that span are inseparable. Only when
every resulting block reconstructs and exactly divides the input are those
blocks returned as certified irreducible factors. LLL short rows themselves
are not assumed to be factor indicators. Inconclusive reductions retain the
existing exhaustive fallback. Probe work is charged to the parent budget;
local probe exhaustion returns inconclusive, while cancellation propagates.

Six recombination tests check irreducible cyclotomic grouping, exact recovery,
known-factor containment, insufficient precision, resource limits, cancellation
and agreement with exhaustive recombination under both lifting strategies.
Independent orthogonal-vector tests also verify the LLL squared norms used by
the proof. A 120-case pilot verifies every result. The initial automatic stress
pilot regresses x^96-1 to the operation limit because repeated lattice probes
consume too much work. Stage 5's bounded policy restores the original 39/42
default stress coverage, without increasing the operation budget.

## Stage 5 Measured crossover and bounded probes

The linear, quadratic and lattice strategies remain selectable through
`RationalFactorOptions.lifting` and `.recombination`; both default to `auto`.
The benchmark labels `typescript-linear`, `typescript-quadratic` and
`typescript-lattice` select linear/subsets, quadratic/subsets and
quadratic/lattice respectively. `typescript` uses the automatic policy. All
variants share the same budget and input coefficients, and rotate alongside
SymPy and PARI in a single matched run. They are not new runtime backends.

Quadratic trees now rebuild from the current lifted precision after exact
singleton recovery instead of discarding precision. Early recovery of a group
still recursively restarts from verified factors modulo the original prime;
reusing precision across that split remains future work. Tests compare continued and
rebuilt trees. Exact LLL swaps update Gram-Schmidt data in place. For larger
bases a bounded floating-point preconditioner proposes only integer row
operations, applied to bigint rows and their unimodular transformation. Exact
LLL then finishes and checks all inequalities and computes the exact norms
used by certification. Approximate data never discards directions or certifies
factors. Ill-conditioned/overflowing proposals stop the heuristic, not the
exact algorithm. Tests cover 7-row bases with 12-, 120- and 1,100-bit entries,
exact transformation reconstruction and an independent Bareiss determinant.

The automatic policy retains linear lifting for degree <=31 with coefficients
below 128 bits, and uses quadratic lifting otherwise. It attempts lattices
only for degree >=32 with two to four local factors, after cheap early subset
recovery. A probe receives at most 12,000 counted operations automatically or
100,000 under the diagnostic lattice strategy, and at most a quarter of the
remaining parent budget. The default probe dimension cap is 12. The internal
probe helper permits explicit larger limits; they are not enabled by default.
Inconclusive probes leave the exhaustive fallback intact. These conservative
crossovers reflect measured overhead, not mathematical applicability limits.

The standalone challenge corpus varies Eisenstein-product coefficient height,
cyclotomic splitting, the number of quadratic factors, and Swinnerton-Dyer
polynomials of degrees 8, 16, 32 and 64. The latter are constructed from all
signed sums of independent square roots; the multiquadratic Galois orbit proves
their irreducibility. They deliberately expose difficult recombination, rather
than relying only on small products. See the
[Magma algorithm example](https://docs.magma-maths.org/BasicRings/UnivariatePolynomialRings/factorization.html)
for why this family is difficult for subset recombination.

The final comparison and profile records are in ignored build storage with
the `factoring-stage5-final-` prefix. Unit tests do not depend on those files or
assert timings. The source/public-entry/new-test/benchmark typechecks, source
Oxlint, changed-file Prettier, production bundles and ESM/CommonJS strategy
smokes pass. Node 22.14.0 and Node 26.12.0 each pass 261 regression tests in 17
suites; the earlier full-repository Windows/sandbox caveats remain unchanged.

### Final matched measurements

Four CE strategies and two external CASes run against identical coefficients,
with three seeded/interleaved trials, up to 60 warm-up inputs per worker, a
30-second timeout and CE's unchanged two-million-operation budget. Profiling
clocks are disabled for comparisons. PARI is the external WASM comparator,
not native PARI; SymPy runs without python-flint. See the benchmark README for
machine details and differences in what each timer includes. Host load is not
controlled, and these are descriptive measurements, not confidence intervals.

All final runs share source SHA-256
`b06d786105b35e2233f736f573ec692ec372840e4f504fcf57c156de098d424a`.

Aggregate solve seconds on the intersection of inputs verified by every
backend on every trial:

| Strategy | Regular: 1,200 inputs | Stress: 39 matched inputs | Challenge: 41 matched inputs |
| --- | ---: | ---: | ---: |
| CE linear / subsets | 7.339 | 1.069 | 3.876 |
| CE quadratic / subsets | 8.114 | 1.113 | 3.573 |
| CE quadratic / lattice | 9.912 | 1.198 | 6.067 |
| CE automatic | 7.035 | 1.125 | 3.724 |
| SymPy | 17.150 | 2.431 | 3.830 |
| PARI | 4.083 | 0.376 | 0.417 |

The regular run audits 21,600 records, all verified. **Automatic and linear
have identical counted work for all 3,600 paired trials.** The approximately
4% elapsed-time difference is not evidence of an algorithmic improvement.
Forced quadratic and lattice strategies regress ordinary aggregate timings,
justifying conservative selection rather than universal activation.

The stress run audits 756 records. Each CE strategy verifies 39/42 inputs on
all three trials; only the three original degree/coefficient-policy refusals
remain. Both external CASes verify 42/42. The table excludes those three inputs
from every backend's timing total, not just CE's. There are no incorrect
answers or operation-budget regressions in this stress corpus.

A separate automatic-only stress run enlarges the degree/coefficient limits to
256/16,384 bits, keeping the same two-million-operation budget. All 42 inputs
verify on all three trials (126 records). Its timing is not part of the matched
cross-CAS comparison.

The challenge run audits 756 records. All four CE strategies and SymPy verify
41/42 inputs on each trial; PARI verifies all 42. The degree-64 Swinnerton-Dyer
input reaches CE's operation limit and SymPy's 30-second timeout on every
trial; PARI completes it in 36.6-42.6 ms. Those failures remain in coverage
denominators, even though this input is excluded from the matched timing table.
Timeout rows lack solveMs: summing recorded solveMs is **not** a whole-run time
or a valid comparison across differing completion sets.

The 24 high-height Eisenstein-product inputs isolate the intended lifting
benefit: aggregate seconds are linear 2.443, quadratic 2.032, automatic 2.086,
lattice 4.289, SymPy 2.426 and PARI 0.315. Quadratic uses about 16.8% less time
than linear here; automatic uses 14.6% less. Across the 41 matched challenge
inputs, automatic is only 3.9% lower, while its degree-32 Swinnerton-Dyer times
are worse than linear. These are measured crossovers, not universal gains.
Including unsuccessful attempts, automatic spends 8.215 recorded solve seconds
versus linear's 6.437; faster successful subsets do not erase failure cost.

Forced lattice mode records 72 certified completions across recursive calls
in the challenge run, proving that the path is exercised, but takes 6.067 s
on the matched set versus quadratic/subsets' 3.573 s. Automatic records no
lattice completions on this corpus. Neither result supports attributing a
speedup to LLL. The feature is a certified, bounded foundation, not yet a
competitive large-dimensional recombination implementation.

Regular corpus SHA-256:
`cc61ac2f1561ad90d7e4614a1b2cfe3c649ea0f5298412551c881f489c46a903`.
Stress corpus SHA-256:
`6b899024c3ca29abe806173c7a8f3cfef8d8ca19c86abb3af4042932a16b88f7`.
Challenge corpus SHA-256:
`086db6cd190c18f387ac607117add990ca73d5477f239d6b0493f2175097fc7b`.

The separate final profile verifies 1,200 inputs and attributes 379.1 ms to
preprocessing, 562.4 ms to modular factoring, 227.4 ms to lifting, 242.7 ms to
recombination and 179.0 ms to verification. Modular factoring remains the
largest phase (about 35% of exclusive phase time). Its work count is unchanged
from stage 1; differences between these separately timed passes should not be
presented as isolated stage speedups. Total counted work is also unchanged;
the corrected lifting scope reattributes 27,336 operations from recombination.

All final journals comprise 24,438 independently audited records: 23,112
matched-comparison records, 1,200 profiling records and 126 expanded-limit
records. There are no mismatched answers. The records include 36 CE size
refusals, 12 CE operation-limit refusals and three SymPy timeouts.

### Remaining limitations and next targets

- Exact-rational LLL still becomes expensive as dimension and coefficient size
  grow. The probe cap intentionally leaves large local-factor sets to bounded
  subset enumeration; the degree-64 example remains unresolved by CE.
- A genuinely faster next lattice stage needs incremental logarithmic-derivative
  constraints, controlled scaling and LLL-with-removals/gradual reduction, with
  the same exact containment certificate. Simply increasing the dimension/work
  caps is not a demonstrated improvement.
- Quadratic lifting can overshoot useful precision. Reuse precision after group
  splits and measure target-aware final rounds before widening automatic use.
- Modular finite-field factoring is the largest regular-corpus phase. Its
  arithmetic and polynomial multiplication remain separate optimization targets.
- PARI remains ahead on all three matched aggregate totals, particularly the
  challenge set. This comparator is PARI WASM, not a native-PARI ceiling, and
  there is no Mathematica measurement. No general CAS superiority is claimed.

The five stages are locally committed separately. Benchmark journals stay in
ignored build storage; unit tests assert algebraic behavior and certification,
not wall-clock performance. Publishing these follow-up commits is separate
from this implementation and verification step.
