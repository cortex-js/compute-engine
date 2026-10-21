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
