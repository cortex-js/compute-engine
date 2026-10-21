# Certified polynomial factorization

The objective is general exact factorization over the rationals, followed by
multivariate factorization, number fields and splitting fields. Each stage is
independently committed after its tests. An unchanged expression is not an
irreducibility certificate. Resource exhaustion must remain distinguishable
from a complete factorization.

## Stages

1. Exact coefficient domains and engine-independent polynomial arithmetic.
   Ascending dense univariate coefficients, rational normalization, division,
   GCD, square-free decomposition and per-computation cancellation/work budgets.
2. Certified rational factorization. Modular factorization, Hensel lifting,
   exhaustive bounded recombination, multiplicities and exact reconstruction.
   Integrate through the existing Factor operator without expanding symbolic
   coefficients or silently approximating.
3. Multivariate factoring. Reuse the sparse integer kernel; evaluation/lifting
   must preserve content and leading coefficients and verify reconstruction.
4. Algebraic number fields. Irreducible defining polynomials, exact quotient
   arithmetic, extension-field factorization and explicit embeddings.
5. Splitting fields. Repeated certified extensions, root representations and
   base-field maps with explicit degree/work limits.

The original integration work remains paused. This branch starts at main
63b8ffe3b and must not replay the squashed integration PR.

## Algorithms and certification

Arithmetic has an explicit coefficient-field interface rather than assuming
all coefficients are expressions or JavaScript numbers. The zero polynomial is
an empty coefficient array. Rational coefficients use normalized bigint pairs.
Field elements are immutable. Square-free decomposition initially requires
characteristic zero; finite-field factorization must handle its characteristic
separately.

The rational factorizer must distinguish input rejection, exhausted budgets,
zero, and complete output. Reconstruction is necessary but not sufficient:
completion also needs an irreducibility argument for every factor. Modular
irreducibility or exhaustive recombination after a valid coefficient bound can
supply that argument. Numerical root screening cannot certify these decisions.

## Backend comparison

Compare native TypeScript with an independently written finite-field WASM
kernel using the same exact orchestration. The user requested first-party
implementation to avoid bundling copyleft CAS libraries. Report this as a
hybrid TS/WASM implementation, not a full bigint WASM factorizer. Keep the
kernel interface replaceable so profiling can justify moving other arithmetic
later. SymPy and a separately installed PARI WebAssembly package are external
comparators only. The optional @sagemath/pari
1.0.5 package reports GPL-3.0-or-later and 29,058,600 unpacked bytes. It is an
isolated experiment, not a CE runtime dependency or a redistribution decision.
Keep its source/license attribution and pinned package metadata with the
benchmark. A mature WASM CAS versus a new TypeScript algorithm is a comparison
of implementations, not proof that the language alone causes a speed difference.

Report cold initialization, conversion, warm factorization, verification,
bundle size and memory separately. Include dense and sparse inputs, rational
and large coefficients, repeated factors, irreducibles, nonmonic inputs,
cyclotomic-like inputs and adversarial recombination. Generated ground truth
must have proved irreducible constituent factors; random products alone do not
certify complete factorization. Keep timeouts and incomplete outputs in the
denominator. No benchmark run may silently substitute numerical factoring.

## Progress

All five stages have bounded implementations and separate commits. Stage 1 has
six passing arithmetic/contract tests on Node 22.14.0, including
large exact coefficients, zero/division errors, multiplicities, modular inverse
and cancellation. This does not claim unrestricted or best-in-class performance.
Corpus performance measurements belong to the factorizer stages,
not to isolated coefficient arithmetic.

The stage 2 implementation now includes a native modular factorizer and a
first-party AssemblyScript WASM Berlekamp kernel. The latter only accelerates
finite-field factorization; rational preprocessing, lifting, recombination and
independent modular-output verification remain in TypeScript. It introduces no
CAS runtime dependency. The compiler is installed into ignored build storage.

Initial validation: 141 tests pass across the exact arithmetic, factorization,
public Factor and existing factoring/assigned-variable suites; two optional
WASM tests pass, including repeated calls and recovery after budget exhaustion.
The first 120-case pilot has 120 verified factorizations for each of native TS,
hybrid WASM and SymPy 1.14.0, with no mismatches. Single-run medians were 1.15 ms,
2.06 ms and 1.12 ms respectively; p95 values were 335 ms, 594 ms and 9.48 ms.
These are exploratory sequential timings under uncontrolled machine load, not
a backend selection or a large-corpus performance claim. Subsequent profiling
and the full generated corpus are reported below.

The first CPU profile attributed 12,949 of 14,139 samples (91.6%) to integer
GCD during rational square-free preprocessing. A degree-preserving modular
square-free certificate now skips that calculation when possible, with a
primitive integer pseudo-remainder sequence for repeated factors. On the same
60-case profiling script GCD fell to 3 of 363 samples; wall time including
startup fell from 23.4 s to 0.64 s. This is a local before/after diagnostic,
not a portable speedup claim.

The unchanged 120-case corpus then verified all cases against all four
implementations: TS, hybrid WASM, SymPy 1.14.0 and external PARI WASM. Their
single-run p95 solve times were 8.69, 6.84, 10.28 and 2.51 ms. Native and
hybrid median times were essentially equal (1.43 and 1.44 ms). The first-party
WASM file is 11,203 bytes; initialization took about 2 ms in the earlier pilot.
No backend has been selected automatically; the default remains TypeScript.

The full run and independent audit now cover 1,200 polynomials, three trials
and four backends: 14,400 verified results. A separate 42-case stress run
completed 36 cases in each first-party backend and all 42 in each external CAS;
six explicit resource-limit results are not counted as successes. See the
[benchmark report](../../benchmarks/factorization/README.md) for fingerprints,
methodology, detailed outcomes and caveats.

Build the optional kernel with `node scripts/build-polynomial-wasm.mjs` after
installing the compiler as described in that script. Run the comparison with
`node --import tsx benchmarks/factorization/run.ts --output <new-directory>
--python <python-with-sympy> --backends typescript,wasm,sympy,pari`.
The optional PARI comparator requires its separately installed package under
`build/factoring-backends`; it is not required by CE or its native tests.

## Multivariate baseline

Stage 3 uses a bounded general Kronecker substitution algorithm as the initial
certified implementation, rather than claiming a production sparse Hensel
implementation. Mixed-radix encoding is injective on the input's degree box.
Every true factor maps to a product of irreducible factors of that encoding;
enumerating their multisets and verifying exact sparse division rejects
spurious factors introduced by the substitution. Exhaustion proves
irreducibility; hitting a budget reports incomplete. The encoded degree is
checked before allocating a dense array. This method is exponential in the
worst case and is not the Fateman-scale performance solution.

`factorSparseRationalPolynomial` accepts explicit variable names and exact
sparse rational terms. It is a structured API rather than a change to Factor's
single-variable signature. Tests cover spurious univariate factors, genuine
multivariate factors, rational content, repeated factors, monomials, constants,
zero and degree/work limits. Sparse evaluation/lifting remains a performance
upgrade, not a prerequisite for the bounded algorithm's correctness.

## Exact number fields

Stage 4 constructs abstract fields Q[a]/(m) only after certifying that m is
irreducible. Elements retain their owning field; combining elements from
different fields requires an explicit embedding, even if the defining
polynomials happen to match. Arithmetic reduces in the power basis, and
extended polynomial Euclid supplies inverses.

Factoring over the field uses Trager's method: shift a square-free polynomial,
compute its norm by a fraction-free determinant of the multiplication matrix,
factor the square-free norm over Q, recover factors by field-polynomial GCD,
and undo the shift. Exact reconstruction checks both factors and multiplicities.
Norm degree, shift search and operation limits are explicit. Seven tests cover
relations/inverses, field identity, reducible modulus rejection, real and
imaginary quadratic fields, algebraic coefficients, multiplicities and limits.

These are abstract number fields, not a general algebraic-number package with
certified real/complex root isolation. No embedding into C is guessed. The
abstract representation suffices for exact factoring and constructing splitting
fields; numerical embeddings, primitive-element presentation optimization and
fast modular number-field arithmetic remain separate follow-ups.

## Splitting fields

Stage 5 repeatedly adjoins a root of a certified irreducible factor, using a
primitive element whose norm is certified irreducible over Q. A linear GCD
recovers the old generator in the new field. Each map is checked against the
source defining polynomial, and each adjoined root against its polynomial.
Completion requires exact evaluation of every root and reconstruction of the
original polynomial with its scalar and multiplicities.

The default field-degree cap is 24; operation and primitive-element shift
budgets also apply. Incomplete output retains the last certified field but
does not claim it splits the input. The returned maps form a chain; use
`embedNumberFieldElement` to transport elements along it. No numerical root
ordering or preferred embedding into C is implied. Tests include quadratic
fields, x^3-2 (degree-six splitting field), x^3-1, a biquadratic compositum,
repeated roots, constants, zero rejection, invalid maps, forged elements and
resource exhaustion. The combined number/splitting-field suites pass 15 tests.

## Public API and first-party ownership

The algorithms live in `src/compute-engine/polynomial` and are available from
CE's existing `@cortex-js/compute-engine/numerics` package entry point. They are
first-party source under the repository's MIT license, not wrappers around a
third-party CAS. A separate npm package has not been published. Univariate
`Factor` uses the exact rational engine; multivariate and extension operations
use explicit structured APIs rather than ambiguous new MathJSON syntax.

```ts
import {
  rationalCoefficient as q,
  factorRationalPolynomial,
  RationalNumberField,
  factorNumberFieldPolynomial,
  splittingField,
} from '@cortex-js/compute-engine/numerics';

// Coefficients are ascending: x^4 + 5*x^2 + 6.
const factors = factorRationalPolynomial([q(6n), q(0n), q(5n), q(0n), q(1n)]);
const K = RationalNumberField.create([q(-2n), q(0n), q(1n)]);
const overK = factorNumberFieldPolynomial(K, [K.fromInteger(-2n), K.zero, K.one]);
const splitting = splittingField([q(-2n), q(0n), q(0n), q(1n)]);
```

Always inspect `status`; `complete` certifies irreducibility by the algorithms,
whereas `reconstructsRationalFactorization` checks reconstruction only. These
are algorithmically certified results, not portable serialized proof objects.
Budgets count arithmetic work, not elapsed time or bigint bit operations;
callers needing a hard time/memory boundary should run in a worker process.

The optional `createPolynomialWasmBackend(bytes)` accepts caller-provided bytes;
it performs no network requests or automatic initialization. The build script
compiles the first-party algorithm with AssemblyScript runtime support and
copies the runtime's license and attribution alongside the binary. The kernel
remains optional because
its speed benefit depends on the workload; TS handles all bigint operations.
External CAS code and generated benchmark files are excluded from commits.
The existing Node 22/26 CI matrix builds the optional kernel before testing so
its comparison tests do not silently skip in CI.

Remaining performance work includes faster Hensel lifting, LLL/van Hoeij
recombination, sparse multivariate lifting and modular number-field arithmetic.
Certified real/complex embeddings and compact defining-polynomial selection
are additional capabilities, not claims made by this implementation.

## References

- [SymPy polynomial algorithms](https://docs.sympy.org/latest/modules/polys/internals.html)
- [FLINT integer polynomial factoring](https://flintlib.org/doc/fmpz_poly_factor.html)
- [PARI WASM package](https://github.com/sagemathinc/wasm-pari)
- [Sage splitting fields](https://doc.sagemath.org/html/en/reference/number_fields/sage/rings/number_field/splitting_field.html)
