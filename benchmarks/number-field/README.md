# Number field factoring benchmarks

These manually invoked benchmarks compare the first-party TypeScript factorizer
with separately installed SymPy and PARI. They do not add runtime dependencies
or timing assertions to CE. Use Node 26; workers inherit its exact executable.

## Public API verification

The
[public API verification report](../../docs/plans/2026-10-25-public-factoring-api.md)
records the complete before/after runs, tests, and remaining failure families.
The subsequent
[prime-ideal report](../../docs/plans/2026-10-25-prime-ideal-factorization.md)
documents direct-method diagnostics, general split-prime lifting, recovery
bounds, norm selection, and the follow-up full public verification.

The public routes import only CE's public entry point for computation:
`public-factor` evaluates MathJSON `Factor`, `public-helper` calls `factor()`,
and `public-detailed` calls `factorDetailed()`. All construct expanded exact
inputs with an explicit `AlgebraicGenerator`; no expected factors reach workers.

```sh
node --import tsx --test benchmarks/number-field/public.test.ts
node --import tsx benchmarks/number-field/run.ts --output build/number-field-public-api --corpus extended --backends public-factor,public-helper,public-detailed --repeats 1 --timeout 5
node --import tsx benchmarks/number-field/audit.ts build/number-field-public-api
```

This is 199 inputs through each of three public routes (597 calls), not a
sample. The runner freezes all engine source dependencies and bundles the public
worker; the audit checks source and bundle hashes, unique IDs/counts, exact
factors, and independent reconstruction of the actual returned MathJSON.
Structured factors and scalar content are verified independently of the returned
product expression.

Public routes use the public default of twenty million kernel operations, not
the five-million-operation kernel comparison setting. Field certification and
expression conversion are included in the public call. Reported `solveMs` is the
public call, not the raw kernel. The wall deadline also includes input
construction and response encoding/decoding in the worker. Parsing LaTeX is
covered by unit tests, not this MathJSON corpus pass. Timeouts count as
unfinished; an unchanged `Factor` request is not an irreducibility certificate.
This one-pass verification is not a three-trial speed comparison with the
internal baseline.

## Arithmetic-kernel comparisons

```sh
node --import tsx benchmarks/number-field/run.ts --output build/number-field-run --python /path/to/python-with-sympy --backends typescript-euclidean,typescript-modular-gcd,typescript,pari,sympy --repeats 3
node --import tsx benchmarks/number-field/audit.ts build/number-field-run
node --import tsx benchmarks/number-field/run.ts --output build/number-field-challenge --corpus challenge --backends typescript-trager,typescript,pari,sympy --python /path/to/python-with-sympy --repeats 3
node --import tsx benchmarks/number-field/audit.ts build/number-field-challenge
```

The PARI comparator uses the existing separate installation documented in
[rational factoring benchmarks](../factorization/README.md#reproduce). It is an
external WASM distribution, not CE code and not a native-PARI timing result. The
handshake records its actual GP version as well as Node and Python/SymPy
versions. The regular corpus has 48 distinct generated inputs in eight fields;
the challenge corpus includes those 48 and extends to 110 inputs in eleven
fields, including degrees 10, 12, and 16. Do not add the counts as if disjoint.

`--corpus extended` retains those 110 inputs and adds 89: 75 higher-degree
generated cases and 14 sourced or explicitly adapted examples. There are 199
distinct inputs in 21 field presentations. Square-free polynomial degrees reach
64; repeated-factor inputs reach 128. Field degree and polynomial degree are
separate dimensions. This is a broader development corpus, not comprehensive
educational/olympiad coverage or a held-out evaluation.

```sh
node --import tsx --test benchmarks/number-field/corpus.test.ts
node --import tsx --test benchmarks/number-field/adapters.test.ts
node --import tsx benchmarks/number-field/run.ts --output build/number-field-extended --corpus extended --backends typescript,pari,sympy --python /path/to/python-with-sympy --repeats 3 --timeout 5
node --import tsx benchmarks/number-field/audit.ts build/number-field-extended
```

The adapter test requires the optional external PARI installation and skips when
it is absent. Neither manual test asserts timings or CAS coverage scores. The
fixture tests independently reconstruct every input, pin sourced expressions,
check duplicate inputs, and preserve the legacy challenge fingerprint.

Each added input records provenance and an irreducibility argument. Sources
include Sage/Wester, Judson's abstract algebra text, and specializations of an
expression in IMO 1969 problem 1. Adapted factoring requests are not counted as
solutions to the original proof or splitting-field-construction problems.

For nonmonic or nonintegral defining polynomials, the PARI adapter explicitly
changes to an integral generator and translates coefficients both ways. Passing
the original power basis directly to a transformed `nfinit` result is not a
valid comparison. An adapter mismatch must be investigated before attributing it
to a CAS. The standalone Factor Benchmark project can import these frozen
fixtures and journals, reverify them without CE, and add other CAS adapters.

## Strategies and verification

- `typescript-euclidean`: forced Trager, exact Euclidean extension GCDs and
  Bareiss norms.
- `typescript-modular-gcd`: forced Trager, modular GCD reconstruction and
  Bareiss norms.
- `typescript-trager`: the norm-based baseline with modular GCDs and adaptive
  norm computation.
- `typescript-hensel`: direct unramified prime-ideal lifting and adaptive
  certified recombination; prefers inert primes but also supports proper residue
  extensions. Returns incomplete when its bounded search cannot finish.
- `typescript-subsets`: direct subset recombination ablation, with Trager
  fallback.
- `typescript-lattice`: direct lattice recombination, with Trager fallback when
  no usable unramified prime is found. An inconclusive lattice keeps lifting
  within limits.
- `typescript`: direct lifting with adaptive lattice/subset recombination and
  Trager fallback when the bounded prime search or a direct-only limit stops it.
- `typescript-unfiltered`: current arithmetic and reconstruction, without the
  one-sided modular rejection filter before exact candidate division.
- `typescript-baseline`: the frozen worker and polynomial sources from a prior
  completed run specified with `--baseline`. The harness checks its source and
  corpus fingerprints and Node version, then copies those sources into the new
  report. It never edits the original snapshot.

For the lattice comparison, use the full challenge corpus with
`--backends typescript-subsets,typescript,typescript-lattice,pari,sympy --repeats 3`.
The subset ablation shares current arithmetic and bounds; it is not a frozen
copy of the preceding milestone. Keep profiling in a separate run from timing.

Except for the explicitly frozen baseline, strategies share current arithmetic
and resource checks. No strategy receives the expected factors. Generated linear
factors are irreducible by degree; nonlinear factors have unramified Eisenstein
proofs. The harness checks normalized factor signatures, and the audit
independently multiplies the factors in the specified quotient ring. It rejects
missing or duplicate records and verifies saved source and corpus fingerprints.

For a recovery/division comparison against a frozen preceding implementation:

```sh
node --import tsx benchmarks/number-field/run.ts --output build/number-field-recovery --corpus challenge --baseline build/number-field-lattice-comparison-01 --backends typescript-baseline,typescript-unfiltered,typescript,pari,sympy --python /path/to/python-with-sympy --repeats 3
node --import tsx benchmarks/number-field/audit.ts build/number-field-recovery
```

Both baseline and current sources are archived and fingerprinted in the new
report. The baseline is rerun alongside the other backends, not compared using
historical timings. Use a separate `--profile --repeats 1` run to compare
exclusive phases; new profiles separate reconstruction, modular recovery
filtering, and exact trial division from the surrounding recombination work.

The five-second default deadline includes field setup, conversion, and solving
within the worker. Solve timings separate those costs for completed calls.
Workers cache fields and restart after a timeout. Three warm-up inputs precede
seeded shuffled trials with rotating backend order and only one solve in flight.
Field setup is not equally expensive or mathematically identical across CASes:
PARI constructs an nf structure, SymPy an algebraic domain, and CE certifies the
defining polynomial. Timings are diagnostic, not matched-proof-cost comparisons.

Runs use new directories, append-only journals, and retained source snapshots.
Workers execute the frozen snapshots, so later source edits cannot change a run.
Windows timeout cleanup stops the owned worker process tree, including venv
interpreter children. The runner needs permission to terminate its own workers;
cleanup failure aborts the run rather than allowing contaminated timings. New
runs write a completion marker only after cleanup, which the audit requires.
Expected factors stay in the orchestrator, not the worker request. SymPy outputs
stay in ANP power-basis representation; symbolic-expression round trips are
excluded from this kernel comparison. Runs do not resume. Incomplete results and
timeouts remain in the denominator; the audit reports solve totals on the
intersection completed in every trial by every selected backend. Whole-machine
load is not controlled. No Mathematica comparison is available.

Use `--profile --backends typescript --repeats 1` in a separate run for
exclusive phase diagnostics. CPU profiles include module loading and corpus
generation:

```sh
node --cpu-prof --cpu-prof-dir=build --import tsx benchmarks/number-field/profile.ts --id field-4-case-3 --repeats 3
node --import tsx benchmarks/number-field/profile.ts --corpus challenge --id field-10-case-9 --repeats 3
```

The implementation scope, certificate arguments, measurements, and remaining
stages are tracked in the
[number field plan](../../docs/plans/2026-10-21-number-field-factorization.md).
