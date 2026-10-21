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

## References

- [SymPy polynomial algorithms](https://docs.sympy.org/latest/modules/polys/internals.html)
- [FLINT integer polynomial factoring](https://flintlib.org/doc/fmpz_poly_factor.html)
- [PARI WASM package](https://github.com/sagemathinc/wasm-pari)
- [Sage splitting fields](https://doc.sagemath.org/html/en/reference/number_fields/sage/rings/number_field/splitting_field.html)
