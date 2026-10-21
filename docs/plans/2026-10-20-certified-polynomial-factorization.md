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

Stage 1 has six passing arithmetic/contract tests on Node 22.14.0, including
large exact coefficients, zero/division errors, multiplicities, modular inverse
and cancellation. Later stages are pending; this document does not claim their
completion. Corpus performance measurements belong to the factorizer stages,
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
a backend selection or a large-corpus performance claim. Profiling and the
full generated corpus are still required.

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

Build the optional kernel with `node scripts/build-polynomial-wasm.mjs` after
installing the compiler as described in that script. Run the comparison with
`node --import tsx benchmarks/factorization/run.ts --output <new-directory>
--python <python-with-sympy> --backends typescript,wasm,sympy,pari`.
The optional PARI comparator requires its separately installed package under
`build/factoring-backends`; it is not required by CE or its native tests.

## References

- [SymPy polynomial algorithms](https://docs.sympy.org/latest/modules/polys/internals.html)
- [FLINT integer polynomial factoring](https://flintlib.org/doc/fmpz_poly_factor.html)
- [PARI WASM package](https://github.com/sagemathinc/wasm-pari)
- [Sage splitting fields](https://doc.sagemath.org/html/en/reference/number_fields/sage/rings/number_field/splitting_field.html)
