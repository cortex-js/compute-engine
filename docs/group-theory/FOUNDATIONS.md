# Proposed foundation decisions for Epsil group theory

Status: proposed from the [Phase 0 study](PHASE0-ARCHITECTURE.md), 2026-10-25. These are implementation contracts to review and test, not public APIs already shipped. `Phase*` names in the research model are temporary and do not reserve production names.

Implementation evidence, 2026-10-26: [Validated permutations](VALIDATED-PERMUTATIONS.md) demonstrates D1/D2 and the initial arithmetic, lifecycle, and serialization contracts. CE already supports suppressing raw constructor generation; checked definitions can be installed without a core runtime change. These experiments do not freeze a public API or complete the later algorithm infrastructure.

Further implementation evidence: [Generator-based groups and bounded closure](GROUPS-AND-CLOSURE.md) adds explicit-action descriptors, complete-or-error enumeration, logical work/storage limits, and serialization/lifecycle checks. Structural generator descriptors are kept distinct from mathematical subgroup identity.

## D1. Separate representation, domain, and subgroup

Use nominal types for representation families and Epsil protocols for behavior. Represent the ambient algebraic domain explicitly at runtime; do not create one static nominal type per subgroup. An element's compatibility with multiplication is independent of its membership in a generated subgroup.

For the first representation, use finite-support permutations of positive integer points. Normalize trailing fixed points out of the element. Identity has empty support; the group/action descriptor retains its explicit finite action degree. Thus `[2,1]` and `[2,1,3]` represent the same permutation, while actions on two and three points retain different metadata. Mixed storage lengths compose by treating missing trailing points as fixed. Reject image lists that are not bijections of their declared input range, and reject generators moving points outside a group's declared action degree.

For later matrix elements, compatibility includes field identity and matrix dimension. For words and pc elements, it includes the defining presentation context. Abstractly isomorphic coefficient fields or groups are not automatically identical domains; use an explicit map when required.

Conceptual internal records:

| Record | Required information | Must not imply |
| --- | --- | --- |
| Domain | Kind, schema version, canonical defining descriptor, compatibility key | Enumeration, subgroup membership, or abstract isomorphism |
| Element | Domain, representation tag, validated immutable canonical payload | Membership in every group in that domain |
| Generated group | Domain, immutable validated generators, action/presentation context | Canonical abstract-group identity or known order |
| Map | Source and target, generator images or executable rule, validation/evidence status | Homomorphism, injectivity, or surjectivity without evidence |

A key or hash accelerates lookup; compare defining descriptors to resolve collisions. Never serialize memory addresses or random engine-local IDs as mathematical identity. Use explicit schema versions for persistent descriptors. Infinite/presented-group domains may require stable presentation identity even when abstract equality is undecidable.

**Acceptance examples:** one permutation participates in multiple subgroups without copying its mathematical identity; incompatible residue moduli are rejected; empty generators plus an explicit permutation action degree construct a trivial group; a degree-three action retains its fixed third point after element normalization.

## D2. Validate values at every public entry route

Build checked CE constructors backed by pure validation/normalization functions. Epsil calls, host calls, raw MathJSON boxing/evaluation, and deserialization must converge on the same invariant checks before a value is accepted for algebraic operations. A convenience Epsil factory wrapping an unrestricted nominal constructor is insufficient: the research model demonstrates that invalid payloads still receive the nominal type.

Validation is local and bounded by payload size and configured limits. It checks types, safe allocation indices, bijectivity, canonical payload shape, and compatible domains. It does not enumerate a group. Inert symbolic construction may remain an expression, but must not be mistaken for a validated element or enter a trusted cache.

Keep raw fast constructors internal. Any internal brand is an optimization behind validated entry points, not proof that arbitrary JSON is trusted. Copy or privately own buffers; callers must not mutate payloads after hashing. Materialize lazy collections before constructing concrete elements and reject unknown/infinite collections where finite explicit input is required.

Use tagged immutable values as the initial integration candidate. Before production work, prove that checked library definitions and CE type integration cannot bypass validation. If existing nominal constructor injection makes that impossible, add the smallest checked-value facility in CE. Do not build a general custom object hierarchy before this spike establishes the need.

**Gate:** malformed images, duplicate points, out-of-range values, nonintegers, huge degrees, lazy/infinite inputs, and forged serialized descriptors fail consistently across entry routes. No constructor, printer, or hash triggers BSGS construction.

## D3. Preserve ordered arithmetic and distinguish kinds of equality

Adopt right actions: `i^(p*q) = (i^p)^q`. Define conjugation `g^h = h^-1*g*h` and commutator `g^-1*h^-1*g*h`. The proposed dihedral constructor states order explicitly; the public spelling still needs the naming audit.

Begin with named composition, inverse, identity, and integer-power operations. Protocol methods express common behavior, while each operation checks runtime domain compatibility. Adding `*` notation later requires a CE path that preserves operand order and avoids scalar commutative simplification; it is not a parser-only change.

Keep CE's structural identity (`===`) intact. For normalized permutations in compatible domains, element equality can be exact and cheap. Group descriptors with different generators can denote the same subgroup; use an explicit subgroup-equality query backed by membership in both directions. Abstract isomorphism remains a separate operation. Word equality without a complete deciding method must remain unresolved.

Do not install general group equality into ordinary hashing, sorting, or simplification. Shared caches may use conservative structural keys, losing a reuse opportunity rather than asserting false mathematical identity.

**Gate:** the two-transposition fixture gives different products in opposite orders; normalization preserves action; equal generated subgroups with different generating lists are not confused with structural identity; unsupported presented-group equality never returns a false Boolean merely because the procedure stopped.

## D4. Keep facts and algorithm selection explicit

Use Epsil protocols for behavioral dispatch. Add a small internal selector for mathematical algorithms, initially permutation order/membership. Each method declares supported representations, required certified facts, resource requirements, and result guarantees. Selection examines already-known information; it must not silently run expensive predicates while sorting candidates.

Start with deterministic explicit priorities and a visible selected-method identifier. No automatic conversion to another representation unless the conversion and its map are retained and its cost is budgeted. A method may decline without changing the mathematical answer. Publish no plug-in registration API until two real implementations demonstrate the required extension points.

Store facts as known true, known false, or unknown, together with provenance/evidence where relevant. These are mathematical facts attached to immutable descriptors, not static-type mutations and not user assertions promoted to theorems. Only sound implication rules belong in the initial system. Evidence may be a checked invariant or trusted proven algorithm result; do not promise a formal proof object for every fact.

Algorithm state has separate statuses: building, complete but unverified, and verified. Only the last can support an exact result whose correctness depends on completeness. Failed or interrupted verification must never publish negative membership or group order.

**Gate:** forcing a chain-building stop leaves no verified order/membership cache; changing a method registry or restoring engine state cannot select a stale entry; a method decline remains distinguishable from mathematical false.

## D5. Reuse CE execution channels and own all derived state

Use exact integers for order, index, exponent, and counts; use checked bounded machine integers for array indices. MathJSON uses CE's existing exact-number encoding. `20!` transport is demonstrated by the probe; computing the order of S20 is still future work.

The low-level boundary should expose exact values and unresolved outcomes explicitly. Proposed outcome categories are `value`, `unknown`, and `unsupported`; successful values may include a certified Boolean or certified infinity. Invalid input, caller cancellation, resource exhaustion, and internal invariant failure use distinct execution channels and must not collapse into those mathematical categories.

| Situation | CE adapter requirement |
| --- | --- |
| Exact result | Return the exact boxed value; retain method/evidence metadata outside mathematical equality |
| Undecided mathematical query | Preserve a valid unresolved expression with a discoverable reason; never coerce it to False |
| No applicable method | Report unsupported capability through the operation's documented diagnostics; do not claim nonexistence |
| Invalid concrete input | Existing CE diagnostic/error value conventions |
| Caller cancellation | Propagate existing cancellation, never convert it into an ordinary result |
| Explicit resource limit | A distinct resource-limit diagnostic with no mathematical conclusion |
| Failed invariant/certificate | Internal failure; discard partial state and expose failure for debugging |

Final diagnostic identifiers and the public support-query vocabulary remain an adapter-design gate; do not invent incompatible global CE error semantics in the kernel.

An algebra work context shares cancellation/deadline checks and cumulative work/allocation budgets across nested algorithms. Budget checking must occur inside long loops, not only between calls. Charge logical allocation before allocating; report measured process memory separately. A synchronous deadline alone does not keep a browser responsive, so expensive computations eventually need worker execution or cooperative scheduling.

Facts and caches belong to the engine/algebra context, not process globals. Immutable mathematical payloads exclude caches from serialization and equality. Use bounded eviction and algorithm/configuration/schema versions in cache keys. The initial restore strategy should discard derived algebra caches, then rebuild on demand. Cross-process cache transfer remains out of scope until a verified certificate format exists.

## D6. Make representation maps and portable loading part of the foundation

A mapping by generator images is initially a candidate. It becomes a homomorphism only after the supported validation procedure establishes the required relations; injectivity and surjectivity are separate facts. For undecidable or unsupported validation, preserve the candidate's unresolved status. Map composition checks source/target compatibility and carries only guarantees justified by both maps.

Deserialization loads descriptors and validated payloads after installing the appropriate library/schema. It does not restore closures, arbitrary executable code, worker handles, or trusted caches. The research probe reinstalls Epsil definitions explicitly before decoding; a production optional-library loader and version negotiation still need design.

Begin with interpreted Epsil plus CE host entry points. Compiled execution and workers must have their own exact transport and domain contracts; CE's numeric kernel protocol and nominal tag erasure cannot be assumed to preserve these semantics automatically. Unsupported compilation targets must decline clearly.

## First implementation sequence

1. **Validated-value spike:** one permutation through Epsil, host, MathJSON, malformed input, serialization, and checkpoint restore. Resolve D2 before freezing a public representation.
2. **Element kernel:** canonical images, identity, ordered product, inverse, power, cycle/support queries and exact element order; independent exhaustive small-degree checks.
3. **Group descriptors and bounded reference workflow:** explicit action degree, empty generators, subgroup embedding, runtime domain checks, work context and exact serialization. Replace research-only assumptions with validated contracts.
4. **Orbit and stabilizer-chain infrastructure:** [complete point orbits, compact Schreier trees, and bounded transversals](ORBITS-AND-TRANSVERSALS.md) now exist, with generator paths and right-coset identity tests. [Bounded full Schreier chains](VERIFIED-GROUP-BASELINE.md) now generate successive stabilizers, independently verify their certificates, and support exact order and constructive sifting. Next reduce generator growth and retain words in the original supplied generators. Keep closure as a bounded reference tool.
5. **Runtime integration:** cache lifecycle, method diagnostics, cancellation, optional loading, browser execution, benchmarks and documentation against the PRD's release gates.

The current research fulfills neither this implementation sequence nor the R1 release gate. Keep changes isolated and postpone the PR until the user's base-capability milestone is ready for review.