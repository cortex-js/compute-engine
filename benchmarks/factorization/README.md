# First-party exact factoring benchmarks

The native algorithms and optional WASM finite-field kernel are first-party MIT
source. No external CAS is a runtime dependency. The AssemblyScript runtime has
its own notices, copied beside the optional binary by the build. A standalone
npm package is not published here.

## Reproduce

From the repository root with CE's development dependencies:

```sh
npm install --prefix build/factoring-toolchain --ignore-scripts --no-audit --no-fund assemblyscript@0.28.9
node scripts/build-polynomial-wasm.mjs
node --import tsx benchmarks/factorization/run.ts --output build/factoring-run --backends typescript,wasm --count 1200 --repeats 3
node --import tsx benchmarks/factorization/audit.ts build/factoring-run
node --import tsx benchmarks/factorization/run.ts --output build/factoring-stress --corpus stress --backends typescript,wasm --repeats 1
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

All workers receive identical expanded coefficients and six warm-up cases.
Backends and cases run serially in fixed order, not randomized/interleaved.
`solveMs` is implementation-specific: TS/hybrid includes certification and
reconstruction; SymPy times `factor_list`; PARI includes expression
serialization and its GP call, but not output normalization. IPC, startup and
journal audit are excluded. These are diagnostic timings, not a controlled
language or matched proof-checking comparison. Conversion is recorded
separately.

Timeout defaults to 30 seconds per case (15 in the stress run), with a fresh
worker after timeout. First-party work limits can return incomplete earlier.
Memory readings are whole-process RSS after calls, not kernel allocation peaks;
SymPy memory is not measured. Percentiles with differing completion subsets must
not be treated as measuring identical work.

## Recorded results

Machine: Windows, Intel Core Ultra 7 165U, 14 logical CPUs, about 31.45 GiB RAM.
Node 22.14.0; Python 3.12.14; SymPy 1.14.0; PARI WASM package 1.0.5;
AssemblyScript 0.28.9. Machine load was not controlled. Run date: October 20,
2026 local time (October 21 UTC). Raw artifacts are ignored build output.

### Regular corpus: `build/factoring-full-01`

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

### Stress corpus: `build/factoring-stress-01`

All 168 unique records audited. TS and hybrid each verified 36/42, with six
explicitly incomplete. SymPy and PARI verified 42/42. No mismatches, errors or
timeouts. First-party limits were identical:

- Operation limit: x^96-1, x^128-1 and x^128+2.
- Degree limit: (3x+1)^48 (5x^2+x+1)^48, degree 144.
- Coefficient limit: products containing 2^4096 or 2^8192 (4097 or 8193 bits).

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

Keep native TS as default. The small optional WASM kernel can help but does not
replace bigint TS lifting/recombination and is not uniformly faster. Faster
lifting, lattice-based recombination and modular irreducibility checks are
justified next steps; merely increasing limits is not an optimization.

Multivariate Kronecker, Trager number-field factoring and splitting fields have
exact family tests but are not in these cross-CAS timing tables. They need
separate performance corpora before competitive scaling claims. See the
[staged implementation](../../docs/plans/2026-10-20-certified-polynomial-factorization.md).

## Verification

Local Node 22.14.0 verification passes 181 tests across 11 focused suites,
including existing factoring, assigned symbols and partial fractions. Generated
family assertions include 50 irreducible-quadratic products, 25 expanded
bivariate products and 20 algebraic-coefficient products across four quadratic
fields. The field suites were rerun after the final constructor/immutability
guards (23 tests), and the WASM suite after its largest-prime boundary check (2
tests). Neither guard changes the timed rational kernel.

Source and added-code typechecks, public declaration checks, changed-code
Oxlint/Prettier checks, the production build, ESM/CommonJS package-export smoke
checks and the polynomial dependency-cycle check pass. A broader ad hoc
typecheck of old polynomial tests finds existing typing errors in
`polynomial-coefficients`, `polynomial-gcd-inexact` and
`polynomial-operators-assigned-symbols`; those files are unchanged.

The Node 22/26 CI matrix now compiles the optional WASM kernel before running
tests. Node 26 has not been executed locally. Benchmarks and tests use portable
Node/Python scripts; no PowerShell-dependent code is added to the package.
