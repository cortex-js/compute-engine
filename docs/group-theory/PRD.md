# Product requirements: Epsil-native group theory

Status: proposed. Date: 2026-10-25. Product owner and implementation owners: unassigned.

## 1. Product intent

Build Epsil's own computational group-theory system from the ground up on Compute Engine. Develop new algebraic infrastructure within the existing expression, type, evaluation, exact-arithmetic, and library framework. Epsil is the primary mathematical programming surface; MathJSON and the TypeScript host API expose the same underlying system. The long-term ambition is the breadth of group-theory capabilities available in GAP, implemented through our own abstractions and algorithms.

The project should support both small, understandable classroom calculations and serious computations on groups too large to enumerate. Users should be able to move from permutations to subgroups, actions, quotients, homomorphisms, other group representations, and research packages without changing the meaning of basic operations.

GAP describes a system with a language, an extensive algorithm library, and mathematical data. Its packages are independently developed extensions with their own manuals. That makes this an ecosystem-scale undertaking, rather than a list of new expression operators. [GAP overview](https://www.gap-system.org/); [manual preface](https://gap-system.github.io/gap/doc/ref/chap1.html).

### Product principles

- Exact mathematics is the default. A fast wrong answer is a release blocker.
- Represent groups by generators and structure; enumerate only on explicit, bounded request.
- Support is specific to an operation, representation, assumptions, and resource envelope.
- Preserve uncertainty. Unknown, unsupported, disproved, and interrupted are different outcomes.
- Integrate with existing engine contracts and keep specialized algorithms independently testable.
- Epsil owns the mathematical model, public vocabulary, and extensibility. Study GAP for architecture and algorithms; implement capabilities within Compute Engine.
- Deliver complete user workflows in small releases while keeping advanced areas visible in the backlog.

## 2. Users and workflows

| User | Job | First useful outcome |
| --- | --- | --- |
| Student or instructor | Construct a symmetry group, compute order, orbit, stabilizer, and subgroup relationships | A reproducible S4 worksheet with exact answers and clear cycle notation |
| Application developer | Embed symmetry and membership calculations in a browser or Node application | Typed APIs, deterministic serialization, bounded execution, no mandatory server |
| Computational algebra researcher | Explore groups, representations, and structural invariants | Explicit algorithm coverage, reproducible runs, certificates and conversions |
| Library contributor | Add a specialized representation or algorithm | Stable domain contracts, conformance fixtures, method dispatch, documented extension boundaries |

Primary initial audience: developers and teaching users needing finite permutation groups. Research-level functionality becomes available incrementally; it is not claimed by the first release.

### Representative journeys

1. Define S4 from a 4-cycle and a transposition, obtain order 24, test membership, compute the orbit of 1 and its stabilizer, and save/reload the result.
2. Construct S20, obtain its exact order `2432902008176640000`, and test a permutation without generating 20! elements.
3. In a later release, form A4 as a normal subgroup of S4, construct the quotient and projection, and verify the quotient has order 2 and the projection kernel is A4.
4. In a later release, construct an exact matrix group over GF(4), obtain a faithful action where supported, and verify the conversion map.
5. Explore a finitely presented group under a resource budget; receive a proved result or an explicit unresolved result with the reason, never a guessed Boolean.

## 3. Capability ambition and scope

The target is **an original Epsil group-theory system with GAP-scale mathematical breadth**. GAP supplies a research map: which problems a mature system solves, which representations and algorithms make them tractable, and how reusable algebraic infrastructure supports that breadth. Epsil's requirements and Compute Engine's framework determine the resulting design.

Maintain four development tracks:

1. Algebraic infrastructure: domains, elements, maps, representation-aware operations, property knowledge, equality, exact arithmetic, and resource-aware execution.
2. Group algorithms: the mathematical operations across permutation, matrix, abelian, pc, free, and presented representations.
3. Advanced mathematics and data: the functionality demonstrated by GAP packages and catalogs, implemented as native Epsil libraries and reviewed optional datasets.
4. Epsil experience: coherent naming, composable programs, type inference, diagnostics, documentation, serialization, and contributor extensibility.

Measure a capability by `(mathematical task, representation, assumptions, result guarantees, resource envelope, environment)`. GAP operations and package versions are research references attached to a capability, not the public interface contract. Multiple GAP functions may become one Epsil operation, and one GAP operation may motivate several clearer Epsil abstractions. GAP aliases, unchecked entry points, diagnostic globals, incidental output ordering, and legacy options do not create implementation obligations of their own.

The [coverage map](COVERAGE.md) is a starting landscape. Phase 0 must classify GAP's core and package functionality into mathematical capabilities and infrastructure dependencies, record what remains unexamined, and identify algorithms worth studying. Pin references for reproducible research and differential tests. Do not let a function-count target drive API design.

Deferred mathematical capabilities remain visible. A finite-permutation release does not fulfill the broader objective. Review changes to the reference landscape at planning checkpoints, while evolving Epsil's own API independently.

### Product boundaries

GAP-language parsing, GAP program execution, API emulation, and a runtime GAP/libgap bridge are outside this project's direction. GAP may run separately in development to check mathematical results. Its source and documentation may inform design research with appropriate provenance; production computations execute our own implementation.

Other boundaries:

- Independent coverage of unrelated semigroup, ring, Lie-algebra, graph, or coding-theory applications. Required group-theory dependencies remain in scope.
- Universal termination or practical runtimes for arbitrary presented groups.
- A graphical group explorer, hosted service, or new notebook product.
- GPU compilation of arbitrary group algorithms or cryptographic guarantees for random sampling.

These boundaries retain group algebras, automorphism groups of combinatorial objects, and representation-theoretic dependencies where needed for group workflows.

## 4. Repository assessment

The assessment below is against the isolated baseline recorded in [README](README.md), not the user's existing integration branch. It is a targeted source inspection, not a complete architectural audit.

| Existing asset | Evidence | Reuse and remaining work |
| --- | --- | --- |
| Expression lifecycle and package boundaries | [Architecture](../../ARCHITECTURE.md), `src/compute-engine/index.ts`, `src/math-json/types.ts` | Use existing boxing and library registration; decide how algebraic runtime values cross the expression boundary |
| Types and protocols | `src/common/type/`, `src/compute-engine/types-kernel-*.ts` | Audit nominal domain identities and representation constraints; avoid treating every group as a generic list |
| Exact arithmetic and polynomial fields | `src/compute-engine/polynomial/exact-field.ts`, `finite-field.ts`, `number-field.ts`, `splitting-field.ts` | `ExactField<T>` and prime-field arithmetic exist. Audit bounds, extraction cost, and equality interfaces before reuse; this is not yet a general public GF(p^n) system |
| Collections and combinatorics | `src/compute-engine/library/combinatorics.ts`, [collections model](../COLLECTIONS-MODEL.md) | Existing `Permutations` generates arrangements of collections; it is not a permutation-group element type |
| Cancellation and deadlines | [Timeout model](../TIMEOUT-MODEL.md), `src/common/interruptible.ts` | Poll in algorithm loops and propagate caller cancellation; add explicit work/allocation limits where needed |
| Scoped randomness | [Randomness model](../RANDOMNESS-MODEL.md) | Use the existing random frame; do not introduce an ambient seed |
| Notebook state | [Checkpoint model](../CHECKPOINT-MODEL.md) | Immutable values plus disposable derived caches; test restore behavior and registry rollback |
| Errors and compilation | [Error model](../ERROR-MODEL.md), [compilation model](../COMPILATION-MODEL.md) | Separate settled rules from proposals; define unsupported-target behavior and result adapters |

The targeted search did not identify an existing group-theory kernel, Schreier-Sims implementation, or group-domain API. Matches for permutation matching, combinatorial arrangements, and numeric matrix operations must not be counted as group support.

## 5. First release: finite permutation groups

Release R1 is the completion of phases P0-P2 in the delivery plan. P1 alone is a developer preview.

### Required R1 capabilities

| ID | Requirement | Acceptance evidence |
| --- | --- | --- |
| GT-001 | Immutable permutations from cycles and image lists; identity, product, inverse, integer power, cycle decomposition, sign, support, element order | Valid and invalid inputs; composition convention fixtures; exhaustive small permutation checks |
| GT-002 | Groups generated by permutations; trivial, cyclic, symmetric, alternating, and finite dihedral constructors | Generator validation; explicit degree/ambient-action handling; independent known-order checks |
| GT-003 | Verified base and strong generating set (BSGS), order, membership, and membership decomposition | Small-group brute-force agreement plus GAP comparison; S20 order without closure enumeration |
| GT-004 | Point actions, orbits, point stabilizers, transitivity, subgroup creation, inclusion, equality in a shared ambient domain, and subgroup index | Orbit-stabilizer identities; positive and negative membership; valid and invalid subgroup inputs |
| GT-005 | Bounded lazy element iteration and explicit materialization | No automatic full enumeration; deterministic ordering contract; interruption and allocation-limit tests |
| GT-006 | First-class Epsil group programming, backed by CE types/evaluation and shared MathJSON/host APIs | Complete Epsil S4 and S20 workflows; inferred types and diagnostics; composition with existing functions; serialization and exact-integer round trips |
| GT-007 | Discoverable support and limits; diagnostic method selection | Unsupported input distinguished from false; no hidden GAP invocation or network request |
| GT-008 | Runtime integration | Budget propagation, abort, seeded sampling if exposed, cache disposal, checkpoint restore, and clean package imports |

R1 omits complete subgroup lattices, general isomorphism search, automorphism groups, conjugacy-class computation, quotients, matrix groups, pc groups, presented groups, character tables, and catalog access. They are later milestones, not optional omissions from the long-term objective.

Uniform random elements may be included only if the implementation samples from a verified decomposition without bias. Otherwise defer sampling; do not label product-replacement heuristics uniform.

## 6. Mathematical and data contracts

### 6.1 Domains, elements, and maps

Separate the ambient algebraic domain from a particular subgroup. Permutations can exist without belonging to a constructed group, as in GAP. Matrix elements carry their field and dimension; presented and pc elements carry the defining presentation context. Subgroups retain a checked embedding in a parent domain. [GAP permutations](https://gap-system.github.io/gap/doc/ref/chap42.html).

Use immutable semantic values. Copy or protect caller-owned buffers so mutation cannot silently change a group, invalidate a cache, or change a hash. Runtime handles may accelerate evaluation, but they must not be the only persisted representation.

Every representation change returns an explicit map, including the information needed to apply it and, for an isomorphism, invert it. A permutation action is not automatically faithful: record its kernel and do not call a quotient image an isomorphic replacement. Homomorphism construction validates generator images and relations within its declared scope. [GAP homomorphisms](https://gap-system.github.io/gap/doc/ref/chap40.html).

### 6.2 Noncommutativity and conventions

Proposed mathematical convention: right actions, `i^(p*q) = (i^p)^q`; points are positive integers. Choose this explicitly for Epsil and test the action laws before implementation; comparison fixtures must translate conventions if they differ from a reference system. Define conjugation as `g^h = h^-1*g*h` and commutator as `g^-1*h^-1*g*h`. [GAP domain arithmetic](https://gap-system.github.io/gap/doc/ref/chap31.html).

Introduce explicit proposed operators such as `GroupMultiply`, `GroupInverse`, and `GroupPower` before considering overloaded arithmetic. The numeric `Multiply` canonicalizer must never reorder group factors. Do not reuse `Permutations` for permutation elements. LaTeX juxtaposition and cycle notation must not silently change existing tuple or multiplication parsing.

Choose a single documented dihedral parameter convention. Proposed CE form: `DihedralGroupByOrder(8)` means order 8; any future polygon-based constructor must say so in its name.

Normalize cycles deterministically, preserving composition order for overlapping input cycles. Validate bijectivity for image lists. Trailing fixed points may be normalized out of the element while the action's ambient degree remains explicit. Empty generators require an explicit domain or a dedicated trivial-group constructor.

### 6.3 Equality, hashing, and canonicalization

Distinguish:

- Structural identity of an expression or serialized descriptor.
- Equality of elements in compatible domains.
- Equality of subgroups in a common ambient group.
- Abstract group isomorphism, which is a separate computation.

Canonicalization must remain local and bounded. It must not invoke group enumeration, group isomorphism, or a word-problem solver. Equal generator lists are a sufficient structural match, not a canonical representation of an abstract group. Do not use presentation strings as hashes for mathematical equality unless a valid normal-form procedure exists.

For representations without effective equality, expose that limitation. Generic sets, sorting, and hash tables must not assume a total decidable mathematical equality operation. Use structural storage or explicit capability checks; never turn failure to prove equality into inequality.

### 6.4 Exactness and mathematical outcomes

Orders, indices, exponents, and counts use exact integers. Allocation indices use validated bounded integers. Define portable MathJSON encodings using the engine's existing exact-integer conventions; never put raw JavaScript `bigint` into JSON.

Keep these conceptual outcomes distinct:

| Outcome | Meaning |
| --- | --- |
| Exact value / proven Boolean | Algorithm completed under its verified preconditions |
| Proven infinity | Evidence establishes infinitude; a timeout is not evidence |
| Unknown | Available reasoning did not decide the question |
| Unsupported | No method covers the representation or preconditions |
| Invalid input | The supplied object violates the declared contract |
| Cancellation / resource limit | Execution stopped; no final mathematical answer |
| Internal invariant failure | A bug or invalid certificate; never a normal unknown result |

The low-level algorithm result model may carry evidence and an unknown reason. CE adapters must use the existing error/cancellation channels; they must not replace caller cancellation with an ordinary result record. Proposed diagnostic tags need an ADR before becoming public API. A valid unresolved symbolic expression can remain unevaluated with a discoverable reason.

GAP itself documents that some element-order computations may not terminate. General finitely presented group problems cannot be offered as universally deciding APIs. Budgeted algorithms, partial procedures, and certified subclasses are part of correct support. [GAP element order](https://gap-system.github.io/gap/doc/ref/chap31.html).

## 7. Architecture proposal

Recommended direction: extend Compute Engine with its own algebraic substrate and build the Epsil group-theory library on it. Use TypeScript for runtime/value machinery and appropriate low-level kernels; evaluate Epsil-authored higher-level algorithms and library composition in P0. The implementation-language boundary should follow actual language capabilities and measured needs, rather than assume either a thin Epsil wrapper or a complete runtime rewrite. GAP is a separate development reference and test oracle, with no production execution path.

```text
Epsil group programs and reusable libraries
                |
 CE definitions, types, evaluation, MathJSON / host API
                |
       representation-aware dispatch
                |
     exact group kernels and maps
                |
 exact arithmetic + work-budget interfaces

Optional data providers and optional accelerators attach through explicit interfaces.
GAP oracle attaches to the test harness, outside production evaluation.
```

Proposed implementation boundaries, subject to the P0 architecture spike:

- `src/compute-engine/group-theory/`: domain descriptors, elements, maps, permutation algorithms, result contracts, and bounded work interfaces. Pure algorithm modules must not import the composition root.
- `src/compute-engine/library/group-theory.ts`: signatures, validation, expression adapters, and runtime integration.
- A potential `src/group-theory.ts` package entry: explicit opt-in loading. Package export and bundle design remain a decision gate, not an existing export.
- `test/compute-engine/group-theory/`: integration and domain conformance; independent algorithm tests alongside the chosen kernel test conventions.
- `scripts/group-theory/`: inventory tooling, GAP fixture generation, normalization, and benchmarks.
- `data/group-theory/`: small reviewed fixtures and manifests; large catalogs live in separately versioned optional artifacts.

### Epsil-first infrastructure and library design

The new algebraic substrate is a first-class part of the engine. Candidate contracts include algebraic domains, elements, group operations, homomorphisms, actions, coefficient fields, and derived properties. These are proposed concepts, not existing CE protocol names. Reuse current mechanisms where they express the required invariants; extend them where they do not.

P0 must produce a design study with three columns: the problem solved by a GAP mechanism, the relevant CE/Epsil mechanism today, and the smallest justified extension. Study representation families, property-driven method selection, attribute caching, generator-based objects, and representation changes. Record what we adopt, redesign, or do not need, with a reason tied to an Epsil workflow. Do not translate GAP's internal object layouts or dispatch machinery mechanically.

The Epsil library must support constructing groups, operating on elements, composing actions/maps, inspecting properties, and writing reusable functions over supported group abstractions. Names and notation should fit existing Epsil conventions. Candidate MathJSON heads elsewhere in this document are implementation sketches, not a frozen user vocabulary.

Evaluate high-level algorithms written in Epsil over engine primitives. A prototype should implement a small reusable operation in Epsil and invoke it for two suitable concrete instances, while the runtime enforces domain and exactness rules. Document any missing language/protocol facilities as scoped infrastructure work. The [Phase 0 study](PHASE0-ARCHITECTURE.md) confirms that nominal types, user-defined protocols, and constrained generic functions support a bounded native workflow. Production validated values and optional library packaging remain open; the import-system draft must not be treated as a shipped loader.

R1 acceptance includes complete Epsil programs for the core user journeys, errors expressed in Epsil terms, generated library documentation, and consistent results through host and MathJSON entry points. Epsil workflow completeness is a release requirement from the first prototype onward.

### Dispatch and property knowledge

Select algorithms by operation, representation, established properties, coefficient domain, and cost limits. Study GAP's categories, families, filters, attributes, and method selection to understand the problems they solve. Map those requirements onto CE's existing types, protocols, definitions, and dispatch; introduce shared infrastructure where a concrete gap is demonstrated. Start with a small working system and extend it alongside multiple representations.

Separate known true, known false, and uncomputed facts. Store provenance: constructor proof, verified certificate, or trusted imported assertion. Imported assertions must not silently activate algorithms requiring proof. Inspection of cached facts must not trigger computation. Conversion fallback must preserve maps and avoid cycles between representations.

### Caches, workers, and resource accounting

Cache only derived information keyed by immutable semantic identity plus relevant algorithm/configuration versions. Bound retained memory, support disposal, and publish a computed chain only after it passes verification. Checkpoint restore must purge or correctly restore derived state; process handles and worker state are not automatically notebook checkpoints.

Long loops need cancellation and work-budget checks. Browser computations should use worker execution for costly operations, because a synchronous loop cannot process a newly delivered main-thread abort event. Cooperative cancellation applies between safe points; worker termination provides a hard stop for the async boundary. Do not promise resumable algorithms merely because the engine has checkpoints.

Data loading is explicit, versioned, integrity checked, and bounded. Offline use works for installed capabilities. Missing data produces an unavailable-data result, not an empty catalog or a negative mathematical answer.

## 8. Beyond R1

The coverage map defines work families; the roadmap assigns gates. Major later requirements are:

- R2: finite subgroup structure, conjugacy, normality, quotients, maps, and direct/semidirect/wreath products within declared supported representations.
- R3 family: finite abelian and pc representations, exact finite-field matrix groups, and free/finitely presented group algorithms as separate workstreams.
- R4 family: constructive recognition, isomorphism and automorphism algorithms, character theory, representations/modules, and catalog integration.
- Continuing releases: group cohomology, extensions, specialized infinite groups, crystallographic and other package domains, and completion of the mathematical capability roadmap.

Advanced requirements include exact field embeddings, certified presentation consistency, bounded coset enumeration, explicit presentation transformations, exact character values, and versioned data identifiers. No single preferred representation will replace all others. Matrix-group arithmetic and invariant forms, pc collection and extensions, and character-table workflows each have distinct prerequisites. [Matrix groups](https://gap-system.github.io/gap/doc/ref/chap44.html), [pc groups](https://gap-system.github.io/gap/doc/ref/chap46.html), [character tables](https://gap-system.github.io/gap/doc/ref/chap71.html).

## 9. Quality requirements and release metrics

These are proposed targets to ratify in P0; none are current measurements.

| Area | Proposed release gate |
| --- | --- |
| Correctness | All required supported cells pass fixed fixtures, randomized differential tests, and independent invariant checks; no unresolved wrong-answer defect |
| R1 corpus | At least 200 generated group cases and 2,000 operation assertions across trivial, cyclic, dihedral, symmetric, alternating, intransitive, and imprimitive examples; deterministic seeds |
| Independent checks | Exhaustive permutation arithmetic through S6; small-group closure oracle limited to order 256; verify maps and BSGS certificates independently of construction |
| Exactness | S20 order survives evaluate/serialize/reload unchanged; overflow and invalid-degree tests pass |
| Performance | S20 construction plus order under 2 seconds and warm membership p95 under 50 ms on the recorded reference machine; publish cold/warm results and memory, with no general performance claim from these easy cases |
| Browser responsiveness | Async cancellation observed within 100 ms on benchmark workloads; report safe-point delays and hard-stop behavior; synchronous APIs document blocking behavior |
| Memory | Explicit maximum degree, materialized elements, work units, and algorithm-owned allocation limits; target R1 reference runs below 256 MiB incremental process memory, measured separately from enforceable logical budgets |
| Packaging | No catalog downloads during import; no group/data module included when the opt-in entry is unused, verified by bundle inspection; target optional R1 bundle <=200 KiB gzip excluding shared CE dependencies |
| Portability | Required R1 workflows pass supported Node LTS and current Chromium/Firefox/WebKit test environments selected at release time |
| Integration | Existing numeric multiplication, parsing, collections, checkpoint, and cancellation regressions pass; required typecheck and repository checks pass |
| Documentation | Every public operator has preconditions, representation support, conventions, examples, resource behavior, and Epsil usage |

Benchmark hardware, runtime, input generators, seeds, versions, and exact commands are part of the report. Limits are validated against independent workloads before they become support promises. Publish hard cases and regressions, not just symmetric-group examples.

A release reports mathematical capability coverage, Epsil workflow completeness, representation/environment coverage, and data availability separately. Do not replace family-level reporting with one flattering aggregate percentage.

## 10. Licensing, provenance, and packaging

The repository is MIT licensed. GAP's core is GPL-2.0-or-later; package licenses differ. For example, SmallGrp's page lists Artistic-2.0 while Polycyclic lists GPL-2.0-or-later. These are source metadata observations, not a legal compatibility conclusion. [GAP license information](https://gap-system.github.io/gap/doc/ref/chap1.html), [SmallGrp](https://gap-packages.github.io/smallgrp/), [Polycyclic](https://gap-packages.github.io/polycyclic/).

Default implementation policy: original implementations from mathematical specifications and cited algorithm literature, with GAP used for behavioral comparison. Record algorithm references and derivation notes. Study GAP implementations to understand representation choices, algorithm selection, and invariants, then document our own design and implementation rationale. Any proposed reuse or translation of source text, examples, tests, or datasets requires artifact-specific provenance and license review. The plan does not include distributing or linking GAP/libgap.

For each external artifact, record upstream version and URL, checksum, license/notice requirements, modification history, distribution plan, and reviewer. Separate code, data, examples, and generated fixtures in that review. Preserve catalog attribution and namespaces; do not invent stable GAP identifiers for unverified data.

## 11. Decisions and ownership

| Decision | Proposed default | Resolve by |
| --- | --- | --- |
| Product direction | Original Epsil-native group theory; GAP as capability and architecture reference | Established by user |
| Implementation strategy | CE algebraic infrastructure plus Epsil library; determine the Epsil/TypeScript boundary through a prototype | P0 architecture review |
| First supported representation | Finite permutations with verified BSGS | P0 |
| Arithmetic surface | Explicit group operators, right-action convention | Before P1 code |
| Algebraic values and type integration | Immutable domain-aware values with portable descriptors | P0 prototype |
| Packaging | Opt-in group entry and separate data packs | Before P1 integration |
| Error/unknown mapping | Follow CE model; distinguish mathematical uncertainty and cancellation | P0 ADR |
| Licensing | Artifact-specific review; no assumption that open source means MIT-compatible copying | Before any external code/data inclusion |
| Performance envelope | Publish measured scope; targets above are provisional | P2 calibration |
| Team and funding | Assign named product, kernel, runtime, and mathematical reviewers | Before delivery commitments |

The recommended immediate action is Phase 0: study GAP's architectural foundations, audit CE/Epsil extension points, design our algebraic substrate, and prove it through an end-to-end Epsil permutation-group prototype. Build the research inventory and comparison harness alongside that work. Proceed to public implementation once those contracts are reviewed.
