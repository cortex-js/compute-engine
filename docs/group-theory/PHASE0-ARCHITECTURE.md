# Phase 0: GAP architecture and the Epsil foundation

Status: initial source study and executable substrate probes, 2026-10-25. Phase 0 remains in progress. This report proposes a foundation; it does not deliver a production group library or establish GAP capability parity. See the [foundation decisions](FOUNDATIONS.md), [PRD](PRD.md), and [delivery plan](../plans/2026-10-25-gap-group-theory-plan.md).

Follow-up, 2026-10-26: the [validated-value spike](VALIDATED-PERMUTATIONS.md) implements checked permutation values and finite-action compatibility using the existing nominal declaration and operator hooks. The observations below describe the original source/probe baseline; the follow-up records the new evidence and remaining limitations.

## 1. Research boundary and reproducibility

The implementation target is our own Epsil group-theory system, using Compute Engine's runtime and new algebraic infrastructure. GAP supplies architectural evidence, algorithm references, and eventually an independent development oracle. This work introduces no GAP language parser, compatibility API, production dependency, or copied GAP source.

The CE audit uses commit `41240b5e90aee75fcf0a81360b66f464e2c16845` (package 0.161.0) in the isolated `codex/gap-group-theory-plan` worktree. GAP source is pinned to release **4.16.1**, peeled commit `3358a41bfca7059a8478c5b77d6fb88c9a3f610d`. The [source manifest](phase0-sources.json) records the tag object, immutable URLs, byte lengths, and SHA-256 hashes of thirteen inspected upstream files. Hashes were computed from the raw files at that commit. This is a selected-source record, not a complete distribution or package lock.

The online GAP reference manual identifies itself as 4.17dev. Its [object model](https://gap-system.github.io/gap/doc/ref/chap13.html) and [method selection](https://gap-system.github.io/gap/doc/ref/chap78.html) chapters provide orientation; the implementation findings below cite the pinned release source. No GAP executable was run. The S3 fixture checks our experiment against the six mathematical permutations directly.

## 2. How GAP separates the system

GAP combines an interpreter/runtime kernel, an object and method system, mathematical libraries, and separately distributed packages/data. The useful lesson is the separation of semantic operations from their representations and algorithms.

### Kernel operations and mathematical algorithms

The permutation kernel implements products over compact image arrays with different storage widths in [`src/permutat.cc`](https://github.com/gap-system/gap/blob/3358a41bfca7059a8478c5b77d6fb88c9a3f610d/src/permutat.cc#L335). Higher-level group algorithms live in the GAP library. For Epsil, this supports a small host-language kernel plus language-authored mathematical routines. It does not establish that interpreter-level loops will meet our performance targets; that needs measurements.

The inspected loader [`lib/read.g`](https://github.com/gap-system/gap/blob/3358a41bfca7059a8478c5b77d6fb88c9a3f610d/lib/read.g) separates later library loading, including character theory. Packages and databases extend that landscape. The current study covers core mechanisms and a permutation-group path; it has not audited every loader, package, native dependency, or dataset.

### Families, categories, representations, and filters

In [`lib/type.g`](https://github.com/gap-system/gap/blob/3358a41bfca7059a8478c5b77d6fb88c9a3f610d/lib/type.g), categories and representations are filters with implications. [`lib/type1.g`](https://github.com/gap-system/gap/blob/3358a41bfca7059a8478c5b77d6fb88c9a3f610d/lib/type1.g#L91) constructs families and caches types formed from a family, flags, and additional data. These mechanisms encode more than a conventional class hierarchy: compatible elements, storage representations, and known mathematical properties contribute different information.

`IsGroup` is declared as the conjunction of a magma with inverses and associativity in [`lib/grp.gd`](https://github.com/gap-system/gap/blob/3358a41bfca7059a8478c5b77d6fb88c9a3f610d/lib/grp.gd#L78). A capability declaration must still be justified by the implementation; an interface with multiplication methods does not prove the group axioms.

**Mapping:** use CE nominal types for static distinctions and protocols for callable behavior. Introduce an explicit algebraic domain descriptor for runtime compatibility. Keep subgroup membership as a separate mathematical question. Two residue elements may share the static type yet use different moduli; a permutation may belong to multiple subgroups without changing its value.

### Attributes, properties, and method selection

GAP's attribute/property machinery in [`lib/oper.g`](https://github.com/gap-system/gap/blob/3358a41bfca7059a8478c5b77d6fb88c9a3f610d/lib/oper.g#L1289) and attribute-storing representation in `lib/type.g` allow computed knowledge to be retained. Unknown properties are distinguishable from known answers. Mutability affects whether automatic storage is valid.

Method installation combines per-argument filters, family relations, and a priority rank in [`lib/oper1.g`](https://github.com/gap-system/gap/blob/3358a41bfca7059a8478c5b77d6fb88c9a3f610d/lib/oper1.g#L146). Kernel dispatch also supports trying another method in [`src/opers.cc`](https://github.com/gap-system/gap/blob/3358a41bfca7059a8478c5b77d6fb88c9a3f610d/src/opers.cc#L1848). This lets one mathematical operation have several algorithms appropriate to different representations and established facts.

**Mapping:** CE already has protocol dispatch and signature overload resolution, but those do not constitute a mathematical knowledge engine. Start with a small internal algorithm selector and explicit preconditions. Store certified facts separately from static types and CE's symbolic assumptions. Do not reproduce GAP's global filter lattice or rank machinery before a concrete algorithm needs it.

### A concrete trace: permutation-group order

1. A group descriptor records generators and their compatible representation. GAP's generator construction machinery is visible in [`lib/magma.gi`](https://github.com/gap-system/gap/blob/3358a41bfca7059a8478c5b77d6fb88c9a3f610d/lib/magma.gi#L710).
2. `Size(G)` selects the `IsPermGroup` method in [`lib/grpperm.gi`](https://github.com/gap-system/gap/blob/3358a41bfca7059a8478c5b77d6fb88c9a3f610d/lib/grpperm.gi#L536).
3. That method obtains `StabChainMutable(G)` and passes the chain to `SizeStabChain`.
4. The stabilizer-chain implementation supplies the reusable orbit/stabilizer structure. [`SizeStabChain`](https://github.com/gap-system/gap/blob/3358a41bfca7059a8478c5b77d6fb88c9a3f610d/lib/stbc.gi#L1477) multiplies the orbit lengths down the chain.

The order path is distinct from the enumerator. Our corresponding path should be: Epsil query, CE adapter, algorithm selection, verified stabilizer chain, exact integer result. A verified chain can also support membership and stabilizers. Construction, verification, and cache publication must be separate steps so an interrupted computation cannot publish an exact answer from incomplete data. This publication rule is our proposed contract, not a claim that every inspected GAP routine has been verified against it.

### Maps preserve mathematical meaning across representations

[`lib/ghom.gi`](https://github.com/gap-system/gap/blob/3358a41bfca7059a8478c5b77d6fb88c9a3f610d/lib/ghom.gi#L405) makes source/range membership and checked versus unchecked map construction explicit. It also uses faithful representations through other groups in suitable methods. Merely producing generator images is not enough to establish a homomorphism.

**Mapping:** representation changes return a target and a map with stated guarantees. Converting a matrix group into an action must retain the map and whether injectivity has been established. Isomorphism, mathematical equality, and structural equality stay distinct.

## 3. What Compute Engine already supplies

These are source-level findings at the pinned CE baseline; entries marked proposed are new work.

| Concern | Existing infrastructure and evidence | Foundation consequence |
| --- | --- | --- |
| Language and execution | [Epsil entry point](../../src/epsil.ts), [execution](../../src/epsil/execute-epsil.ts), [language model](../EPSIL-LANGUAGE-MODEL.md) lower Epsil to MathJSON and CE evaluation | Reuse the evaluator, scope rules, diagnostics, and Epsil naming. No second interpreter. |
| Nominal values | [Type constructors](../../src/compute-engine/type-constructors.ts) keep non-object nominal values as tagged expressions and supply injective constructor equality | Suitable experimental value carrier; not a proof of bijectivity, invertibility, or presentation consistency. Checked production construction is still needed. |
| Behavioral abstraction | [Protocols](../../src/compute-engine/engine-protocols.ts) support conformance, conditional conformance, `Self`, and receiver-based selection | Reuse protocols for element operations and generic Epsil routines. Runtime domain compatibility requires explicit checks. |
| Overloading | [Signature overload resolution](../../src/compute-engine/boxed-expression/overload.ts) handles argument types separately from protocol selection | Neither mechanism alone chooses algorithms from mathematical facts, certificates, or available work budgets. |
| Object identity | [BoxedObject](../../src/compute-engine/boxed-expression/boxed-object.ts) has mutable state and identity-based equality | Do not choose mutable objects as the default element representation. Their JSON snapshots are not automatically persistent algebraic identities. |
| Exact coefficients | [ExactField and rational coefficients](../../src/compute-engine/polynomial/exact-field.ts), [prime-field arithmetic](../../src/compute-engine/polynomial/finite-field.ts) | Reuse arithmetic contracts and BigInt. Add domain identity, embeddings, codecs, and exact matrix algorithms as separately scoped work. |
| Resource control | [Interruptible execution](../../src/common/interruptible.ts), per-computation `PolynomialWork` | Reuse cancellation/deadline infrastructure and the shared-work-context pattern. Define algebra budgets rather than importing polynomial-specific exceptions. |
| State lifecycle | [Checkpoints](../../src/compute-engine/checkpoint.ts) include type/protocol state and engine restoration machinery | Give new facts/caches explicit ownership and restore rules. Module-global mutable registries would bypass the lifecycle. |
| Worker execution | [Kernel protocol](../../src/compute-engine/kernel-protocol.ts) transports numeric compiled kernels, including Float64Array data | Existing worker facilities inform scheduling/cancellation, but do not provide an exact algebra object transport contract. |
| Compilation | [Type constructors](../../src/compute-engine/type-constructors.ts) erase nominal tags where statically discharged, retaining tags in specified sum cases | An interpreted nominal value does not imply a compiled representation with runtime algebraic identity. Define and test compilation separately. |

The existing combinatorics operation `Permutations` enumerates arrangements; it is not a permutation element or generated-group implementation. New group operations must not silently inherit scalar multiplication's commutative rules, or repurpose collection enumeration as the general group-order strategy.

The exact-field audit establishes useful building blocks, not a complete field system. `ExactField<T>` lacks a public domain identifier, embedding maps, and serialization. `primeField()` validates a prime no larger than 65521 through `checkSmallPrime`; it is not an arbitrary GF(p^n) constructor. Existing polynomial factorization code is not evidence of a general finite-field matrix-group engine.

## 4. Executable Epsil experiment

The [model](../../scripts/group-theory/phase0-model.epsil) defines two nominal element types, a shared protocol, a generic square function, and a generator-based group descriptor. A small closure routine is written in Epsil. TypeScript supplies the harness and independent expected results; it does not implement the prototype's composition or closure algorithm.

Run from this worktree:

```sh
node node_modules/tsx/dist/cli.mjs scripts/group-theory/phase0-probe.ts
```

The [assertion harness](../../scripts/group-theory/phase0-probe.ts) checks:

- The same generic Epsil function squares a permutation and an additive residue element.
- Right actions give distinct products for `(1 2)` and `(2 3)`: image lists `[3,1,2]` and `[2,3,1]`.
- Elements with the same nominal residue type but different moduli require a runtime rejection.
- The raw nominal permutation constructor accepts `[1,1,1]`. This is a reproduced validation gap, not an acceptable production value.
- Bounded closure of the two transpositions produces exactly the six permutations of three points; an insufficient element limit returns an explicit error. An empty generating list is refused by this research routine because it has no explicit domain from which to obtain the identity.
- A serialized descriptor reloads into a fresh engine after installing the model definitions, and its closure still has six elements. Without those definitions, the JSON alone does not recover the nominal type.
- Checkpoint restore recovers a saved element and permits protocol dispatch afterwards. This is a basic lifecycle probe, not a test of future BSGS caches or rollback of changed protocol implementations.
- `20!` survives MathJSON/JSON transport exactly as `2432902008176640000`, beyond JavaScript's safe integer range.
- At this baseline, `Append` rejects a nominal permutation argument against its `missing | value` signature. `listFrom(join(elements, [candidate]))` supports the bounded workflow. The harness records the restriction so a future runtime change triggers a deliberate reassessment.

Two details materially affect the design. First, `map` and comprehensions can produce lazy views. The prototype calls `listFrom` before installing images in a value; storing the lazy expression would retain unevaluated work and bindings. Second, this experiment uses fixed-degree, known-valid generators and explicit local types. It does not implement production constructor validation, degree normalization, general domain identity, inverse, scalable membership, algorithm certificates, or a worker boundary. Its element-count cap is not a complete work/memory budget.

The experiment demonstrates that high-level algebra can be authored in Epsil today. It does not establish an acceptable performance envelope. Begin with Epsil examples and orchestration; use pure host kernels for validated representations and bounded primitive operations, then measure before choosing the language for stabilizer-chain loops.

## 5. Implementation structure to take forward

The following paths are proposed, not directories or APIs delivered by this study:

```text
src/compute-engine/group-theory/
  domains.ts, outcomes.ts, work.ts, facts.ts, maps.ts
  permutation/values.ts, operations.ts, validation.ts
  permutation/orbits.ts, bsgs.ts, verify-bsgs.ts
src/compute-engine/library/group-theory.ts
  CE definitions, validation/error adaptation, serialization hooks
Epsil library/examples (packaging location to be established)
  native vocabulary, generic routines, teaching and research workflows
```

Pure algebra kernels should depend on small contracts and exact arithmetic utilities, never import the root ComputeEngine. CE library adapters connect those kernels to evaluation. Epsil routines use the same definitions as host calls. An engine-owned context supplies facts, work limits, and optional caches. Introducing a second protocol system or an entire custom boxed-object hierarchy is not justified by the evidence so far.

The first implementation slice should validate and normalize permutation elements, define explicit domain compatibility, implement ordered composition/inverse, and prove MathJSON reload. Only then should generator descriptors, bounded reference closure, orbits, and verified BSGS follow. See the [decision record](FOUNDATIONS.md) for invariants and acceptance examples.

## 6. Remaining Phase 0 work

| Work | Current state | Evidence required next |
| --- | --- | --- |
| Source and architecture audit | Core mechanisms and a permutation order path inspected | Broaden to pc, matrix, presented groups and package-specific mechanisms; record alternatives that change the foundation |
| Reference pinning | Thirteen core source files hashed at GAP 4.16.1 | Full distribution/manual/package snapshot with reproducible runner configuration |
| Epsil feasibility | Bounded S3 and substrate probes written | Checked-value entry-route spike now implemented; compilation/worker decisions, broader symbolic workflows, and profiling remain open |
| Capability census | Forty families mapped in the planning draft | Versioned operation/task ledger; classified package coverage; explicit unknown cells reconciled against the release |
| Oracle and benchmarks | Independent six-element fixture only | GAP process runner, fixtures/normalizers, cancellation tests, benchmark hardware/configuration and measured baselines |
| Design review | Foundation decisions proposed here | Algebra and CE runtime review, resolved public naming/loading and validated-value construction strategy |
| Provenance | Source links and hashes; no GAP source vendored | Review before adopting external code/data or importing package artifacts |

Keep the research and subsequent capability work in this worktree. These research probes alone do not establish release readiness. The later implemented foundation is now being submitted as a draft for architectural feedback.