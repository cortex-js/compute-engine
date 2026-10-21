# TypeScript factoring performance stages

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

## Planned stages

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
consume too much work. Stage 5 must fix this before enabling the policy.
