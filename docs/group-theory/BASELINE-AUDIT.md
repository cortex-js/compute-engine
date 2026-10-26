# Chapter 39 baseline and prerequisite audit

Current implementation update: [finite, matrix and polycyclic systems](FINITE-MATRIX-POLYCYCLIC.md) supersede the earlier missing-baseline notes below. The [chapter ledger](CHAPTER-COVERAGE.json) tracks every numbered operation in chapters 39, 44 and 45 and remains explicitly incomplete.

Audit date: 2026-10-26. Sources: the [GAP contents](https://gap-system.github.io/gap/doc/ref/chap0.html), [chapter 39](https://docs.gap-system.org/doc/ref/chap39.html), and [chapter 44](https://gap-system.github.io/gap/doc/ref/chap44.html), with the official [chapter 39 mirror](https://gap-system.github.io/gap/doc/ref/chap39.html) used when the docs host timed out. Online documentation identifies itself as 4.17dev; this is a targeted dependency audit, not an exhaustive operation census or executed GAP compatibility test.

## Answer and scope

Before this increment, the chapter 39 baseline was partial: checked permutation elements, generators, finite actions, closure, orbits, and point-stabilizer transversals existed. Group order, general membership, and checked subgroup relationships did not. They now exist for the finite-permutation representation through [bounded verified Schreier chains](VERIFIED-GROUP-BASELINE.md).

Much of the implementation substrate already exists. That does not measure mathematical capability coverage: a function type can express a proposed homomorphism but cannot establish its relations; a matrix can hold generators but cannot establish their group structure. No defensible 99% coverage figure follows from having these data structures.

This increment adds no parser syntax or core runtime behavior. It reuses the existing expression, type, exact-number, evaluation, cancellation, registration, and checkpoint mechanisms. The missing work is predominantly library contracts, algorithms, and validation. All source remains in the isolated initiative worktree on baseline `41240b5e90aee75fcf0a81360b66f464e2c16845`; the separate integration checkout was inspected read-only and not merged or edited.

## Earlier chapters: reusable facilities and actual gaps

| Relevant area | Existing CE/Epsil evidence | Missing for this group project |
| --- | --- | --- |
| 3-11: language, functions, execution, diagnostics and I/O | [Epsil execution](../../src/epsil/execute-epsil.ts), [interruptible execution](../../src/common/interruptible.ts), [checkpoint implementation](../../src/compute-engine/checkpoint.ts) | No replacement interpreter needed. Long group jobs still need worker execution and public capability diagnostics; GAP shell/process compatibility is not a target |
| 12-13: objects and types | [Nominal/type machinery](../../src/common/type/), [protocol implementation](../../src/compute-engine/engine-protocols.ts) | Runtime algebraic domains and certified property knowledge; a nominal tag does not prove bijectivity, invertibility, or subgroup membership |
| 14-20: integers, number theory, rationals, cyclotomics, floats, booleans | [Number theory library](../../src/compute-engine/library/number-theory.ts), [exact fields](../../src/compute-engine/polynomial/exact-field.ts), [number fields](../../src/compute-engine/polynomial/number-field.ts) | Reuse bigint/exact rationals. A general canonical cyclotomic domain and public compatible finite extension fields were not established by this audit; approximate equality cannot decide group equality |
| 21-22, 27-30: lists, strings, dictionaries, records and collections | [Collections](../../src/compute-engine/library/collections.ts), native immutable arrays/sets/maps in pure kernels, existing MathJSON | Keep finite explicit payload validation, exact element keys, completed enumeration status, and resource bounds. Collection membership is not generated-subgroup membership |
| 23-26: vectors, matrices and integer lattices | [Matrix operations](../../src/compute-engine/library/linear-algebra.ts), [tensor fields](../../src/compute-engine/tensor/tensor-fields.ts), [integer lattice routines](../../src/compute-engine/polynomial/integer-lattice.ts) | Field-aware matrix-group values, proof of invertibility, faithful action maps, and group recognition. Lattice reduction helpers are not a full crystallographic group library |
| 31: domains and element operations | [Validated permutation values](../../src/compute-engine/group-theory/permutation/values.ts), [element operations](../../src/compute-engine/group-theory/permutation/element-operations.ts) | The permutation domain is implemented; a shared multi-representation domain/embedding layer is not. Identity, inverse, powers, order and conjugation now have explicit checked permutation operations |
| 32-34: maps, relations and orderings | Epsil functions and CE comparison/type infrastructure | Source/target compatibility, verification of homomorphisms, kernels/images, and mathematical versus structural equality. Function composition alone does not prove a group map |
| 35: algebraic multiplication structures | Ordered permutation composition and checked generators, now subgroup/order/property queries | General multiplication-table groups, abstract magma/monoid contracts and proof-aware method selection are not implemented by the scalar arithmetic operators |
| 36-38: words and rewriting | ASTs, rules, substitution, and compact generator paths in Schreier trees | Free-group generator identities, freely reduced words, presentation contexts, verified confluent rewriting, and original-generator word certificates. CE simplification is not a word-problem solver |

The audit uses the preceding chapters to find prerequisites, not to require every unrelated facility before finite permutation groups. Generic maps and word infrastructure become necessary as we move into representation changes and finitely presented groups.

## Chapter 39 support after this increment

| Mathematical task | State |
| --- | --- |
| Permutation elements: identity, product, inverse, integer powers, cycles, exact element order, conjugation, commutator | Implemented with validated values and bounded degree/exponent input |
| Generated group, supplied generators, trivial group with explicit action | Implemented; optional installer, not default/public stabilized API |
| Exact finite group order and positive/negative membership | Implemented through verified full Schreier chains under explicit limits; no group enumeration |
| Point stabilizer | Implemented via complete orbit/transversal and Schreier generators |
| Subgroup inclusion, index, equality, normality | Implemented for descriptors sharing the same explicit finite action; different action degrees require an explicit re-embedding |
| Abelian test | Implemented from pairwise commutation of supplied generators |
| Factorization | Host sifting supplies a checked residual and transversal factors. A free-group map and word in the original user generators remain missing |
| General cosets, arbitrary subgroup transversals, double cosets | Not implemented. Existing transversals are specifically for point stabilizers |
| General conjugacy classes/conjugators, centralizers/normalizers, characteristic subgroups, Sylow/Hall algorithms, structural series, subgroup lattices, decomposition and group recognition | Not implemented as general APIs |
| Other group representations and verified homomorphisms | Not implemented by this project |

This is a useful finite-permutation baseline, not completion of chapter 39. Subgroup equality is an explicit potentially expensive query; ordinary structural equality and hashing remain inexpensive and unchanged.

## Chapter 44: reuse the matrices, add the group contracts

The matrix source already has exact rational paths for determinant, inverse, rank, row reduction and null spaces, alongside numeric/symbolic paths. Matrix multiplication and integer powers exist. The polynomial backend exposes `ExactField<T>`, rational arithmetic, and `primeField(p)` for checked primes up to 65,521. Those are concrete assets to reuse.

The tensor backend currently selects numeric, complex, or expression cell operations; it has no runtime finite-field identity attached to a matrix-group element. `RationalNumberField` is characteristic-zero algebra, not an implementation of GF(p^k). The prime-field polynomial factorizer does not by itself provide finite-field matrices or group actions.

| Increment | Reuse | Required new contract / acceptance |
| --- | --- | --- |
| Rational matrix-group elements | Exact rational coefficients and matrix algorithms | Immutable square invertible values, exact canonical keys, dimension/field compatibility, singular input rejection, checked serialization; do not infer finiteness |
| Prime-field matrix elements | Existing `primeField` arithmetic | Field descriptor and field-parametric matrix elimination/product; identity/inverse laws in characteristic p, exact residue normalization |
| Finite extension fields | Polynomial infrastructure and irreducibility machinery where applicable | Validated defining polynomial, canonical element representation, compatible embeddings and extension-field linear algebra |
| Generated matrix groups and finite actions | Generator descriptors, bounds, permutation chains | Faithful vector actions with verified maps; a projective action can have a scalar kernel and cannot silently be called an isomorphism |
| Recognition, invariant forms, characteristic-zero lattice groups | Existing exact linear algebra/lattice helpers | Dedicated algorithms, certificates, and family-specific support; matrix operations alone do not establish these results |

For example, the rational matrix `[[1,1],[0,1]]` has powers `[[1,n],[0,1]]` and generates an infinite group. The finite-permutation closure argument therefore cannot be reused for rational matrix generators. Finite fields make the ambient matrix set finite, but practical order/membership still require suitable action or structural algorithms.

The next matrix slice should implement validated rational and prime-field elements with explicit fields and dimensions, then checked finite-group actions. Chapter 44 remains in scope, with its advanced families tracked separately; no matrix-group implementation is claimed in this increment.

## Immediate continuation

The [chapter 43 plan](GAP-43-ROADMAP.md) now has its first verified deterministic chain and exact queries. Next reduce Schreier generator growth, retain original-generator words, add named families/support/parity and block actions, then work toward backtracking and recognition. General supplied/reduced BSGS certificates require a stronger verifier than the full-Schreier certificate currently accepted. These remain release acceptance criteria. The initial draft PR is for architectural feedback and does not claim those release gates are complete.
