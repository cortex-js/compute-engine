# GAP chapter 43: Epsil dependency plan

Reviewed 2026-10-26 in response to the requested [groups capability overview](https://www.gap-system.org/capabilities/groups) and [permutation-group chapter](https://docs.gap-system.org/doc/ref/chap43.html#X85ED46007CED6191). The chapter was also read through the [official GitHub Pages manual](https://gap-system.github.io/gap/doc/ref/chap43.html). This is a native capability target, not a plan to parse GAP or reproduce its mutable record/API layout. Online manuals are moving research references; the existing [pinned release/source baseline](README.md#baselines-and-evidence) still governs future differential testing.

The chapter is a reasonable long-term finite-permutation target. It is not all available from generator multiplication and bounded closure today. The practical dependency is a verified base and strong generating set (BSGS), followed by search and structural algorithms. Implementing names without those guarantees would hide exponential enumeration, incomplete searches, or unsupported conclusions.

## Chapter coverage and dependencies

The references below identify every numbered operation in chapter 43, grouped by shared implementation needs. They are research identifiers, not committed Epsil API names. Dependency and acceptance columns are our implementation proposal.

| Section / reference surface | Current state | Epsil dependency and acceptance |
| --- | --- | --- |
| 43.1 `IsPermGroup` | Checked generator descriptor exists | Keep nominal typing separate from mathematical validation; define a public support-query vocabulary later |
| 43.2 `OrbitPerms`, `OrbitsPerms` | Natural point orbits and explicit-action partitions implemented | Our finite action is mandatory; test fixed points and complete frontier exhaustion. Arbitrary action domains remain a separate extension |
| 43.3 `IsomorphismPermGroup`, `SmallerDegreePermutationRepresentation` | Pending | Validated maps, kernels, faithful actions, and source representations; start with explicit point/block actions, preserve proof of faithfulness |
| 43.4 `IsNaturalSymmetricGroup`, `IsNaturalAlternatingGroup`, `IsSymmetricGroup`, `IsAlternatingGroup`, `SymmetricParentGroup` | Pending | Add support/parity and named constructors early; verified order/membership for natural-action tests; abstract recognition needs its own certificates |
| 43.5 `ONanScottType`, `SocleTypePrimitiveGroup` | Pending | Block/primitivity algorithms, normal structure, socles, and simple-factor recognition; do not infer classification from orbit data |
| 43.6 chain concepts | Verified full Schreier chains implemented | Exact order, sifting, and point stabilizers are available under bounds; reduce generator growth and retain original-generator words next |
| 43.7 randomized construction concepts | Deferred optimization | Preserve deterministic verification; random seeds and confidence never substitute for a completed certificate |
| 43.8 `StabChain`, `StabChainOptions`, `DefaultStabChainOptions`, `StabChainBaseStrongGenerators`, `MinimalStabChain` | Initial deterministic builder/verifier implemented; reduced/supplied BSGS remains pending | Typed immutable chain candidates, explicit budgets, deterministic builder and verifier; reject unverified supplied generators/bases |
| 43.9 chain records | No imported record API | Design an owned immutable chain value and versioned certificate. Recompute or verify on load rather than trust order fields |
| 43.10 `BaseStabChain`, `BaseOfGroup`, `SizeStabChain`, `StrongGeneratorsStabChain`, `GroupStabChain`, `OrbitStabChain`, `IndicesStabChain`, `ListStabChain` | Exact order and host level/group data implemented | Broader public chain queries and optimized strong generating sets remain open |
| 43.10 `ElementsStabChain`, `IteratorStabChain`, `InverseRepresentative`, `SiftedPermutation` | Inverse representatives and verified host sifting with residual/factors implemented | Chain iteration and original-generator words remain open |
| 43.10 `MinimalElementCosetStabChain`, `LargestElementStabChain`, `ApproximateSuborbitsStabilizerPermGroup` | Pending | Verified chain and ordering/search contracts; approximations require a distinct incomplete-result type |
| 43.11 `CopyStabChain`, `CopyOptionsDefaults`, `ChangeStabChain`, `ExtendStabChain`, `ReduceStabChain`, `RemoveStabChain`, `EmptyStabChain`, `InsertTrivialStabilizer`, `IsFixedStabilizer`, `AddGeneratorsExtendSchreierTree` | Pending | Immutable rebuild/extension and proof invalidation rules; base changes must re-establish every level invariant before publishing |
| 43.12 `SubgroupProperty`, `ElementProperty`, `TwoClosure`, `InfoBckt` | Pending | Partition backtracking, subgroup-property preconditions, orbitals, deterministic bounds, and diagnostic events; budget failure is not nonexistence |
| 43.13 large-degree guidance | Bounds only; no measured performance claim | Benchmark sparse support, intransitive actions and long trees; representation changes and heuristics must preserve certificates |

The generic group/action operations referenced by the chapter, rather than defined there, remain tracked in [coverage families F03-F19](COVERAGE.md). For example, point stabilizers are the immediate chain-building target; blocks, primitivity, arbitrary actions, and general subgroup transversals need further algorithms. The current transversal specifically represents right cosets of a point stabilizer.

## Next implementation increments

1. **Bounded Schreier generators:** from each complete orbit/tree construct `t_x*s*t_(x^s)^-1`, remove identity/duplicates, and retain word evidence. Share budgets across nested calls. Cross-check the generated stabilizer against exhaustive stabilizers in small groups.
2. **Deterministic chain completion:** select moved base points, construct successive stabilizers, sift candidates, and reduce redundant generators. Include a generator-growth limit; naive recursive Schreier expansion must not silently become the production strategy.
3. **Independent verifier:** check each level fixes earlier bases, verify transversal action/word evidence, establish Schreier closure through the next level, and require a trivial terminal stabilizer. A candidate chain carries no exact order or negative-membership authority before verification.
4. **Exact queries:** multiply certified orbit lengths for order; sift elements with constructive decomposition, distinguish a proven nonmember from an aborted query, and verify returned products independently. Include S20 without element enumeration as a scalability target, not a claim of present support.
5. **Action and subgroup tools:** point stabilizers, transitivity, subgroup inclusion/equality/index, bounded chain iteration, then blocks/induced actions and verified maps. Add named families and element support/cycle/sign/order operations alongside these foundations.
6. **Advanced chapter work:** base changes, backtracking, faithful degree reduction, natural/abstract recognition, and primitive-group structure. Add randomized acceleration only behind deterministic verification.

Each increment must include typed Epsil examples, malformed/raw input tests, exact serialization, receiving limits, cancellation, and checkpoint behavior. Keep all implementation in this worktree until the agreed base capability gate is ready; this roadmap does not authorize a premature PR.

## Relation to the broader groups page

The capability overview includes multiple representations and substantial structural work: finite presentations and pc groups, matrix groups, maps/products, subgroup and series algorithms, automorphisms, characters, and cohomology. The [existing coverage map](COVERAGE.md) and [delivery plan](../plans/2026-10-25-gap-group-theory-plan.md) retain those targets. Our assessment is that the finite-permutation foundations unlock a substantial portion, while the representation, exact-field, homological, and data-library work needs dedicated subsystems. A small-case exhaustive implementation may be useful as an oracle but does not establish broad practical coverage.

Current delivered evidence is the [verified finite-permutation baseline](VERIFIED-GROUP-BASELINE.md), following [bounded orbits and transversals](ORBITS-AND-TRANSVERSALS.md). Steps 1-4 above now have a bounded full-Schreier implementation, verifier, exact order and membership, with basic subgroup queries from step 5. Original-generator words, reduced/optimized chains, remaining chapter operations, GAP differential execution, and release validation are still open. The [prerequisite audit](BASELINE-AUDIT.md) records chapter 39 and matrix-group gaps.
