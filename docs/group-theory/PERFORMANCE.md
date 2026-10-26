# Group algorithm performance and Node 26 validation

This worktree uses Node 26 for group-theory validation. The runtime pin is in
[.node-version](../../.node-version); the [runner](../../scripts/group-theory/run.mjs)
rejects other major versions and propagates its executable directory to child tools.
The package's consumer minimum version is unchanged.

## Research and algorithm choices

- [GAP's permutation-group manual](https://gap-system.github.io/gap/doc/ref/chap43.html)
  describes stabilizer-chain methods and randomized-construction trade-offs.
  Generic permutation order, membership, subgroup, equality, index and normality
  queries now select the existing deterministic chain algorithms. Abelianness
  checks generator commutation. No probabilistic answer is introduced.
- [SymPy's polycyclic documentation](https://docs.sympy.org/latest/modules/combinatorics/pc_groups.html)
  describes constructing a polycyclic sequence through the derived series.
  Our implementation refines each abelian derived factor from below into
  prime-order cyclic steps, then checks the resulting sequence and unique
  normal forms. It no longer searches subgroup lattices for maximal normal subgroups.
- [GAP's subgroup-lattice documentation](https://gap-system.github.io/gap/doc/ref/chap39.html)
  distinguishes cyclic-extension, elementary-abelian and solvable-group methods.
  Our bounded exhaustive implementation retains its own generator-extension
  algorithm with compact generator witnesses and right-coset pruning.
  It does not implement GAP's full cyclic-extension/perfect-subgroup framework.

Coset pruning is valid without normality: if y = h*x with h in H, then
<H,y> = <H,x>. One representative per right coset preserves every subgroup
reachable by adjoining a generator. A retained generator strictly enlarges the
current subgroup, so at most log2(|H|) generators survive. Private membership
bitsets coexist with ordered immutable member arrays for deterministic output.

## Implemented changes and invariants

- Generic permutation queries use chains or generator tests instead of tables.
- Generic prime-field matrix order uses a faithful vector action when its size
  fits existing action bounds; otherwise the bounded table path remains.
  Matrix abelianness checks generators, including for infinite rational groups.
- Sifting uses indexed orbit lookups and inverse representatives retained from
  construction. Independent certificate verification remains unchanged.
- Each installed library owns a bounded chain session: eight chains maximum,
  at most 1,000,000 charged image entries across them, and keys of at most
  100,000 characters each. Keys include generators, action and resource settings.
  Inputs and cancellation are checked on reuse.
- Membership reserves construction cost and retained-image charges even on hits:
  a warm cache cannot make a lower declared limit succeed. Failed computations
  and imported certificates never become cached results.
- Finite sessions cache only complete lattices, with at most 8,192 total subgroup
  entries across cached lattices. Result caps and cancellation apply on hits.
  A session belongs to one exact table.
- Internally generated permutation tables inherit associativity from checked
  permutation composition. Every product must map into the complete closure;
  entries, identity and inverses are still checked. The validation selector is
  a private method. Imported, matrix and quotient tables retain full cubic
  associativity checks.
- Polycyclic construction refines the derived series and verifies prime cyclic
  factors and all normal forms.

The maxElements argument remains a validated enumeration bound (1 through 256),
not a group-order ceiling for specialized paths. GroupOrder on S20 with an
enumeration bound of 1 can succeed without enumerating S20. Finite-table-only
operations retain existing bounds. Automatic pcgs generator choices are
deterministic but are not canonical identifiers and can differ from earlier choices.

## Reproducing validation

From this worktree with Node 26 selected:

~~~sh
node scripts/group-theory/run.mjs test
node scripts/group-theory/run.mjs typecheck
node scripts/group-theory/run.mjs smoke
node scripts/group-theory/run.mjs bench
~~~

The test command runs all group suites. Type checking includes the repository's
CLI, type pins, cycle and public-type checks. The smoke test builds minified
production ESM targeting ES2022, matching the repository target, then runs Epsil
and transports MathJSON through a fresh Node worker and engine. Benchmarks use
the same build settings without a TypeScript runtime loader.

This tests a bundled opt-in application: the group library is not a published
package export. No real browser, browser worker, clean dependency installation
or GAP differential run was performed. Dependencies are the existing shared tree.

## Local measurements

[Raw measurements](performance-node26.json) retain runtime/CPU metadata, all
cases, variability and the preserved baseline bundle's SHA-256. The performance baseline was bundled before source edits. Both recorded versions use the original 0.161.0 research checkout; these historical timings predate the draft PR rebase onto 0.169.1. The benchmark runner measures the current checked-out version. Both versions ran on Node 26.12.1 / V8 14.6,
Windows x64, Intel Core Ultra 7 165U. Node 22 measurements are historical only.

Kernel medians use five warm-ups and fifteen measured runs; the C2^7 pcgs case
uses three measured runs. Descriptors and explicitly noted tables are prepared
before timing. Kernel callbacks omit engine deadline checks. Epsil medians use
five warm-ups and seven fresh-engine trials: parsing/evaluation are included;
engine creation/library installation are excluded. Stress lattice cases are
single attempts, not medians.

Final comparison (optimized process followed by preserved baseline):

| Operation | Baseline | Optimized |
| --- | ---: | ---: |
| Epsil generic order of S5 | 31.46 ms | 6.16 ms |
| S5 finite model construction | 22.42 ms | 6.87 ms |
| S4 subgroup lattice, table already built | 3.86 ms | 0.51 ms |
| S4 automatic pcgs, table already built | 4.99 ms | 0.11 ms |
| C2^6 subgroup lattice, single attempt | 1,862 ms | 97 ms |
| C2^7 automatic pcgs, table already built | subgroup-count limit | 0.62 ms |

The earlier baseline-first comparison also showed gains, but times varied with
JIT, garbage collection and machine load. These are local observations, not
cross-machine guarantees. Stable logical-work counts separately demonstrate
the algorithmic reduction:

| Operation | Baseline work units | Optimized work units |
| --- | ---: | ---: |
| S5 finite model | 1,887,108 | 159,108 |
| S4 subgroup lattice | 56,037 | 9,381 |
| S4 automatic pcgs | 70,287 | 4,467 |
| C2^6 subgroup lattice | 35,808,437 | 2,353,874 |

Cold S20 chain construction and GL(4,2) order have unchanged logical work after
retaining already-computed inverses. Their timings were mixed between trials;
no general cold-chain speedup is established. Imported-table validation remains
cubic with no claimed algorithmic speedup. The complete C2^7 lattice still
correctly exceeds the 4,096-result cap; pcgs no longer needs that lattice.

## Validation and remaining work

277 tests across eleven group suites pass on Node 26.12.1. Tests cover independent
exhaustive S4 closures/lattices and normalizers, membership word boundaries,
prime refinements, all C2^7 coordinate round trips, nonmember sifting, cache
eviction, domain isolation, limits, cancellation, CE expression forms and generic
queries beyond enumeration bounds. Repository type/architecture checks and
the production ESM/worker smoke test pass.

Further work includes reduced strong generating sets / optimized Schreier-Sims,
matrix methods for larger fields/dimensions, an independent pc collection engine,
elementary-abelian subspace methods, and broader performance/memory profiling.
No limits were raised.
