# First-party exact factoring benchmarks

The shipped algorithms are first-party MIT TypeScript source. No external CAS or
WebAssembly kernel is a runtime dependency. The experimental first-party WASM
implementation, export, build script and tests have been removed at the user's
request. A standalone npm package is not published here.

The four-backend measurements below predate that removal and retain the hybrid
rows for provenance, not as a supported implementation. Removing the optional
backend does not change the TypeScript arithmetic. PARI remains an optional
external benchmark comparator, not shipped CE code.

Latest results: all 1,200 regular inputs verified on three trials; TypeScript
takes 9.652 s versus SymPy's 22.348 s and PARI WASM's 5.235 s. Default stress
coverage is 39/42, or 42/42 with explicitly enlarged size limits and the same
work budget. See [optimized results](#optimized-regular-corpus); the original
runs are retained below as baselines.

## Reproduce

From the repository root with CE's development dependencies:

```sh
node --import tsx benchmarks/factorization/run.ts --output build/factoring-run --backends typescript --count 1200 --repeats 3
node --import tsx benchmarks/factorization/audit.ts build/factoring-run
node --import tsx benchmarks/factorization/run.ts --output build/factoring-stress --corpus stress --backends typescript --repeats 1
node --import tsx benchmarks/factorization/audit.ts build/factoring-stress
```

Use a new output directory each time. Journals are append-only; interrupted runs
are not full scores. The read-only audit rejects missing/duplicate cases,
fingerprint changes, wrong factors and failed exact reconstruction. Incomplete
and timeout results remain in the denominator. There is no resume support. For
profiling: `node --cpu-prof --import tsx benchmarks/factorization/profile.ts`.

For external comparison, add `sympy` to `--backends` and provide
`--python <interpreter-with-sympy>`. The measured version is SymPy 1.14.0 on
Python 3.12.14 without python-flint. The optional `pari` comparator expects
`@sagemath/pari@1.0.5` installed separately under `build/factoring-backends`:

```sh
npm install --prefix build/factoring-backends --ignore-scripts --no-audit --no-fund @sagemath/pari@1.0.5
```

That package declares GPL-3.0-or-later. It is an external benchmark tool, not
vendored or redistributed with CE. Source/license information:
[PARI WASM](https://github.com/sagemathinc/wasm-pari),
[SymPy](https://github.com/sympy/sympy). No imported problem corpus is
committed.

## Corpus and measurement contract

The regular corpus has 1,200 deterministic expanded polynomials (seed 1729), 200
per family: irreducible quadratic products, Eisenstein products, repeated
factors, nonmonic rational inputs, large coefficients and irreducibles. Ground
truth is proved by degree, discriminant or Eisenstein's criterion. These are
generated family tests, not 1,200 independent real-world benchmark sources.
Three trials give 3,600 results per backend, not 3,600 distinct polynomials.

The separate 42-case stress corpus includes roots of unity, cyclotomic
irreducibles, high-degree Eisenstein inputs, clustered integer roots, repeated
nonmonic factors and coefficient growth. Cyclotomic irreducibility supplies an
additional ground-truth theorem. Some inputs intentionally exceed defaults.

All workers receive identical expanded coefficients and up to 60 warm-up cases.
Measured case order is deterministically shuffled each trial (seed 1729), with
backend order rotating per case. Persistent workers stay alive, but only one
solve is in flight. This reduces ordering bias without claiming exclusive
control of the host. The older runs below used six warm-up cases and fixed,
non-interleaved order; their timings are not directly interchangeable. `solveMs`
is implementation-specific: TS/hybrid includes certification and reconstruction;
SymPy times `factor_list`; PARI includes expression serialization and its GP
call, but not output normalization. IPC, startup and journal audit are excluded.
These are diagnostic timings, not a controlled language or matched
proof-checking comparison. Conversion is recorded separately.

Timeout defaults to 30 seconds per case (15 in the original stress run), with a
fresh worker after timeout. First-party work limits can return incomplete
earlier. Memory readings are whole-process RSS after calls, not kernel
allocation peaks; SymPy memory is not measured. Percentiles with differing
completion subsets must not be treated as measuring identical work.

## Recorded results

Machine: Windows, Intel Core Ultra 7 165U, 14 logical CPUs, about 31.45 GiB RAM.
Node 22.14.0; Python 3.12.14; SymPy 1.14.0; PARI WASM package 1.0.5;
AssemblyScript 0.28.9. Machine load was not controlled. Run date: October 20,
2026 local time (October 21 UTC). Raw artifacts are ignored build output.

### Original regular corpus: `build/factoring-full-01`

Independent audit: all 14,400 unique backend/case/trial records present, with
exact reconstruction checked without CE's polynomial arithmetic. All four
backends verified 3,600/3,600 trials; no incomplete, mismatched, error or
timeout results.

| Backend                    | Median solve (ms) | p95 solve (ms) | Total solve (s) |
| -------------------------- | ----------------: | -------------: | --------------: |
| First-party TypeScript     |              2.54 |          19.03 |           19.28 |
| First-party hybrid TS/WASM |              1.68 |          10.03 |           11.09 |
| SymPy                      |              1.35 |          10.87 |           10.95 |
| External PARI WASM         |              0.94 |           2.58 |            4.15 |

Recorded initialization: TS 0.014 ms, hybrid 4.54 ms, SymPy 1,346 ms, PARI 133
ms. Node static imports precede the timer, so these are not equivalent full
process-start costs. Highest sampled RSS: TS 104 MiB, hybrid 89 MiB, PARI 235
MiB (rounded). First-party WASM binary: 11,203 bytes.

- Corpus SHA-256:
  `cc61ac2f1561ad90d7e4614a1b2cfe3c649ea0f5298412551c881f489c46a903`
- Source hash:
  `27c187403cd26a965263ab5d8e234ffd2c878ec40aecd50f1ab89b1ba4277aaa`
- WASM SHA-256:
  `36ac073772da0a2d0e231e3dbd19e4f5b81d9e2d9bdd0787ae7c406db767fd4b`

This source hash covers the eight files listed by the harness at the measured
revision. Later harness edits extend it to assembly/build/stress sources.
Extension-field additions do not change the measured rational kernel.

### Original stress corpus: `build/factoring-stress-01`

All 168 unique records audited. TS and hybrid each verified 36/42, with six
explicitly incomplete. SymPy and PARI verified 42/42. No mismatches, errors or
timeouts. First-party limits were identical:

- Operation limit: x^96-1, x^128-1 and x^128+2.
- Degree limit: (3x+1)^48 (5x^2+x+1)^48, degree 144.
- Coefficient limit: products containing 2^4096 or 2^8192 (4097 or 8193 bits).

The operation-limit records give more specific optimization evidence: x^96-1
records 28 lifting steps and 653 subset candidates; x^128-1 records 36 lifting
steps and no subset candidates; x^128+2 records two good primes and no lifting
steps. The first has reached recombination, the second has not reached it, and
the third has not finished modular factor selection. All three exhaust
approximately two million counted operations.

Verified-only median/p95 solve times (ms): TS 5.18/158.35, hybrid 4.39/167.96,
SymPy 2.86/95.66, PARI 2.37/9.23. Different completion subsets prevent a direct
speedup comparison.

- Corpus SHA-256:
  `6b899024c3ca29abe806173c7a8f3cfef8d8ca19c86abb3af4042932a16b88f7`
- Source hash:
  `ba59b8fcd2ab83eb0bf7f47f7e951df8391da5f431d7497cc9ea6478a30e4b2d`

### Profile-driven change

The first pilot exposed rational Euclidean GCD coefficient growth during
square-free preprocessing: integer GCD occupied 12,949/14,139 CPU samples
(91.6%). A modular square-free certificate now avoids it, with primitive integer
pseudo-remainders for repeated factors. The same 60-factorization profile fell
from 23.4 seconds to 0.64 seconds including startup, and GCD to 3/363 samples.
This is local diagnostic evidence, not a portable speedup claim.

## Conclusions

Ship TypeScript only. The removed WASM experiment did not replace bigint TS
lifting/recombination and was not uniformly faster. Faster lifting and
lattice-based recombination remain justified next steps; merely increasing
limits is not an optimization. Small-prime arithmetic and modular irreducibility
checks now have the improvements described below.

Multivariate Kronecker, Trager number-field factoring and splitting fields have
exact family tests but are not in these cross-CAS timing tables. They need
separate performance corpora before competitive scaling claims. See the
[staged implementation](../../docs/plans/2026-10-20-certified-polynomial-factorization.md).

## Verification

After WASM removal, Node 22.14.0 and Node 26.12.0 each pass 237 tests across 13
polynomial regression suites, including existing factoring, assigned symbols and
partial fractions. The previous 239-test result included two removed WASM tests.
Generated family assertions include 50 irreducible-quadratic products, 25
expanded bivariate products and 20 algebraic-coefficient products across four
quadratic fields. The field suites were rerun after the final
constructor/immutability guards (23 tests), and the WASM suite after its
largest-prime boundary check (2 tests). Neither guard changes the timed rational
kernel.

Source and added-code typechecks, public declaration checks, changed-code
Oxlint/Prettier checks, the production build, ESM/CommonJS package-export smoke
checks and the polynomial dependency-cycle check pass. A broader ad hoc
typecheck of old polynomial tests finds existing typing errors in
`polynomial-coefficients`, `polynomial-gcd-inexact` and
`polynomial-operators-assigned-symbols`; those files are unchanged.

The Node 22/26 CI matrix needs no additional compiler or WASM build step.
Benchmarks and tests use portable Node/Python scripts; no PowerShell-dependent
code is added to the package.

The existing async-scope isolation test in `functions.test.ts` hit its 30-second
limit during the loaded full-suite run, then passed in isolation (15.864 s test
duration). No timeout threshold was changed. Existing Epsil `#env("HOME")` tests
in `execute.test.ts` and `epsil-parse.test.ts` expect an undefined host value on
this Windows environment but receive an empty string; the execution case
reproduces in isolation. Their source and implementation are unchanged. Two
unchanged `effects-registry.test.ts` coupling-audit assertions also differ only
in Windows separators (`library\\core.ts` versus `library/core.ts`).

The broad Jest run was stopped before profiling, without final totals. Besides
the failures above, an existing runtime-bundle test could not read the
`node_modules` junction from sandboxed esbuild. This is not a passing full-suite
or CI claim. Python-dependent cases were skipped because that run had no
configured Python interpreter. No unrelated test expectations or timeouts were
changed to hide these failures.

## TypeScript optimization rationale

The next 60-factorization CPU profile found 400 samples in finite-field code and
347 in generic polynomial division, versus 24 in integer GCD. The changes target
this arithmetic and avoid unnecessary lifting, without changing the default
degree, coefficient-size or two-million-operation limits:

- Canonical residues modulo primes at most 65521 use exact JavaScript numbers.
  Each multiply-add is below 2^32, safely below the 53-bit exact-integer limit;
  no signed bitwise truncation is used. Bigint remains the rational/integer
  coefficient representation. Division updates one remainder buffer, and
  Berlekamp elimination avoids repeated row allocation and constant splitters.
- Rabin verification checks the necessary Frobenius GCDs at n/q for each prime
  divisor q of the degree, plus the final Frobenius identity. External backend
  results still undergo reconstruction and irreducibility verification.
- Eisenstein's criterion supplies a direct sufficient certificate when its
  conditions hold. Exact integer translation can reduce coefficient height for
  clustered roots; it is used only when it reduces the L1 norm substantially.
- A prime producing at most four modular factors ends the prime search. The
  remaining recombination problem is small enough that another complete modular
  factorization usually costs more than it saves.
- Early exact divisors are tried at geometrically spaced lifting precisions. A
  single verified modular factor certifies an exact divisor immediately. Larger
  recovered groups are recursively factored, reusing their verified modular
  factors. Exact division alone never becomes an irreducibility claim.
- Mahler-measure bounds on the constant coefficient and trace reject impossible
  subsets before polynomial multiplication. Integer convolution and exact cross
  multiplication replace repeated rational normalization in reconstruction.

The early search is bounded; exhaustive Zassenhaus recombination at the proven
coefficient bound remains the fallback. It is still exponential in the number of
modular factors, not an implementation of lattice recombination. A trial with
delayed modular reductions did not establish a benefit and was discarded.

On the same profiling script, finite-field samples fell from 400 to 11 and
division samples from 347 to 75. Profile duration including startup fell from
3.954 s to 1.124 s. These are local profile snapshots, not portable speed
ratios; the cross-CAS comparison below uses repeated, interleaved trials.

References:
[Rabin's criterion](https://mhostetter.github.io/galois/dev/api/galois.Poly.is_irreducible/),
[early termination in rational factoring](https://www.math.fsu.edu/~hoeij/algorithms/Qx.html).
These are algorithm references, not imported implementations.

### Optimized regular corpus

`build/factoring-optimized-interleaved` contains 14,400 verified records: 1,200
distinct inputs, three trials, four backends. No errors, timeouts, incomplete
results or incorrect factors occurred.

| Backend                    | Median solve (ms) | p95 solve (ms) | Total solve (s) |
| -------------------------- | ----------------: | -------------: | --------------: |
| First-party TypeScript     |             0.835 |         12.167 |           9.652 |
| First-party hybrid TS/WASM |             0.811 |         10.604 |           8.890 |
| SymPy                      |             3.008 |         22.166 |          22.348 |
| External PARI WASM         |             1.121 |          3.496 |           5.235 |

TypeScript is 2.32 times faster than SymPy by aggregate solve time on this
generated corpus. Its median is lower than PARI's, but its total is 1.84 times
PARI's: the harder tail remains the important gap. This is not a claim of
universal CAS superiority. Mathematica was not available and was explicitly
excluded from comparison.

The corpus hash is unchanged. Source hash:
`4eec06c70d1037313a2acc2926b33082ee980dd300de112ca6c2271961abd19f`. The retained
sources were rehashed after discarding the delayed-reduction experiment and
matched this measured fingerprint. Subsequent source changes are lint-only
(`modular` from `let` to `const`) and AssemblyScript formatting; no algorithm,
limit or arithmetic changed. Rebuilding the formatted AssemblyScript source
reproduces the identical WASM SHA-256 listed above; its behavior tests pass
again after rebuilding.

### Optimized stress corpus

`build/factoring-optimized-stress` independently audits all 504 records (42
inputs, three trials, four backends). Both first-party backends verify 39/42
distinct inputs on every trial. The only refusals are the unchanged degree-128
and coefficient-4096-bit limits. SymPy and PARI verify 42/42. No backend returns
an incorrect factor, error or timeout.

| Previously incomplete case           | Default result now                     | Counted TS operations |
| ------------------------------------ | -------------------------------------- | --------------------: |
| x^96-1                               | Complete                               |             1,973,784 |
| x^128-1                              | Complete                               |               861,129 |
| x^128+2                              | Complete                               |                   777 |
| Degree-144 repeated nonmonic product | Explicit degree limit                  |                     0 |
| Product containing 2^4096            | Explicit coefficient limit (4097 bits) |                     0 |
| Product containing 2^8192            | Explicit coefficient limit (8193 bits) |                     0 |

x^96-1 is still near the work limit, with 2,156 subset attempts. This is
evidence for better recombination, not evidence of unrestricted high-degree
coverage.

On the **same 39 completed inputs**, total time across three trials is TS 1.719
s, hybrid 1.546 s, SymPy 4.640 s and PARI 0.538 s. The audit reports this
matched intersection separately so refusals cannot improve comparative
percentiles.

A separate opt-in run, `build/factoring-optimized-expanded`, sets
`--max-degree 256 --max-coefficient-bits 16384` while retaining the same
two-million-operation budget. All four backends verify **42/42 on all three
trials**, with 504 records independently audited. TS takes 2.003 s, hybrid 1.876
s, SymPy 4.879 s and PARI 0.884 s in aggregate. This demonstrates that the last
three cases are size-policy refusals; it does not change the default contract.
Both stress runs use the unchanged stress corpus hash and the optimized source
hash above. The three final runs total 15,408 audited records.

### TypeScript-only delivery verification

After removing the optional backend, all three corpora were rerun using the
current runner's TypeScript-only default, with three trials and independent
audits. `build/factoring-typescript-only-regular` verifies 3,600/3,600 records;
`build/factoring-typescript-only-stress` verifies 117/126 with the same nine
size-limit refusals (three distinct inputs); and
`build/factoring-typescript-only-expanded` verifies 126/126 using degree 256 and
16,384-bit limits with the unchanged operation budget. All 3,852 records are
accounted for; there are no incorrect answers, errors or timeouts.

The corpus hashes above are unchanged. Current measured source hash:
`db442d92654584ed6fe1b14c8d76b55e6cac76f6e1b864b70aee8c5ad2fb7c1f`. These are
delivery-verification runs, not a new cross-CAS comparison: the runner and
schedule no longer include the removed experimental backend. Do not combine
their timings with the older SymPy/PARI timings.

### Remaining performance priorities

Eisenstein **products** account for 6.218 of TS's 9.652 seconds in the regular
run, versus PARI's 1.583 seconds on those same cases. Certifying an individual
Eisenstein polynomial is cheap; splitting a product of them still requires
general modular factoring, lifting and recombination. Repeated factors account
for another 1.842 seconds (PARI: 0.985). These are the next profiling targets.

Prioritize quadratic/tree Hensel lifting and faster modular polynomial
remainders for that tail; use LLL/van Hoeij recombination for inputs with many
modular factors. Primitive integer GCD preprocessing remains relevant for
repeated factors. None of these follow-ups requires changing the public
coefficient-domain or backend interfaces. Multivariate and number-field
performance need separate corpora before making comparable scaling claims.

### Unit tests versus challenge benchmarks

Unit tests assert exact factors, content, multiplicity, reconstruction,
irreducibility rejection, arithmetic identities, cancellation and resource-limit
behavior. They contain no solve-time thresholds, corpus scores or source-text
assertions. The new arithmetic tests compare against bigint arithmetic,
including the largest supported prime and dense products. A forged reducible
degree-six factor that satisfies the final Frobenius identity is still rejected.

The 1,200-case corpus and the stress corpus are manually invoked performance and
challenge tools, not unit-test or CI timing gates. Keep profiling and large
adversarial experiments here; add a small behavior test when they reveal a
specific correctness contract.
