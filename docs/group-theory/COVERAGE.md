# Epsil group-theory capability landscape

Current implementation update: [finite, matrix and polycyclic systems](FINITE-MATRIX-POLYCYCLIC.md) supersede the earlier missing-baseline notes below. The [chapter ledger](CHAPTER-COVERAGE.json) tracks every numbered operation in chapters 39, 44 and 45 and remains explicitly incomplete.

Status: planning inventory, updated 2026-10-26. Families below describe the full target, not completed support. Narrow opt-in slices now implement validated permutations, generator descriptors, bounded closure, point actions/transversals, verified full Schreier chains, exact order/membership, and basic subgroup queries; see the [current implementation evidence](README.md#current-validation-and-handoff). The [chapter 43 dependency plan](GAP-43-ROADMAP.md) expands the requested permutation-group target. The remaining capabilities need their own implementation and validation.

## 1. Reading the map

This is a mathematical capability landscape informed by GAP, not a function-by-function porting checklist. GAP names below identify research references; they do not prescribe Epsil names, signatures, object layouts, or required aliases. Study the underlying problems, representations, and algorithms, then design native Epsil capabilities. Verify reference behavior against pinned GAP 4.16.1 when generating comparison tests; the online manuals currently describe 4.17dev.

Phases refer to the [delivery plan](../plans/2026-10-25-gap-group-theory-plan.md). Every family remains in the long-term scope even when its first delivery is narrow. Core and package overlap must be reconciled in the eventual ledger.

## 2. Capability families

| ID | Family and representative surface | First phase | Prerequisites / completion boundary |
| --- | --- | --- | --- |
| F01 | Algebraic domains, element families, property knowledge, exact counts, equality, maps | P0-P1 | Shared contracts; compatible domains and unknown properties |
| F02 | Permutation elements: `PermList`, `ListPerm`, `Cycle`, `Cycles`, `SignPerm`, `Order` | P1 | Validated bijections; composition, inverse, powers, support; explicit degree limits |
| F03 | Generator-based groups: `Group`, `GeneratorsOfGroup`, `Size`, membership | P1-P2 | Domain-aware construction; P1 enumeration is only a bounded reference path |
| F04 | Named families: trivial, cyclic, abelian, symmetric, alternating, dihedral, quaternion, classical and simple groups | P1, P4-P5, P8 | Constructor parameters and representations; no claim that all families ship together |
| F05 | Stabilizer chains: `StabChain`, `BaseOfGroup`, `StrongGeneratorsStabChain`, sifting | P2 | Verified BSGS; certificate and decomposition; base changes later |
| F06 | Actions: `Orbit`, `Orbits`, `Stabilizer`, `ActionHomomorphism`, representative actions | P2-P3 | Points first; sets, tuples, cosets, and arbitrary declared actions later |
| F07 | Transitivity, primitivity, blocks, block systems, induced actions | P2-P3 | Point-action correctness; action-domain and kernel tracking |
| F08 | Subgroups: `Subgroup`, `IsSubgroup`, closure, intersection, index | P2-P3 | Checked embeddings and membership; no generic enumeration fallback at large scale |
| F09 | Cosets, transversals, double cosets, coset actions | P3 | Left/right conventions; lazy and bounded traversal |
| F10 | Conjugacy classes, conjugators, centralizers, normalizers | P3 | Efficient stabilizers/search; representation-specific limits |
| F11 | Normal structure: normal closure, core, center, derived subgroup, radical, socle, Fitting and Frattini subgroups | P3-P4, P8 | Structural algorithms and property proofs |
| F12 | Sylow/Hall subgroups, complements, systems, p-local operations | P3-P4 | Applicable class restrictions; nonexistence is distinct from failed search |
| F13 | Properties: abelian, cyclic, solvable, nilpotent, perfect, simple; exponent and abelian invariants | P3-P4, P8 | Algorithms by representation; constructive evidence where feasible |
| F14 | Derived, central, composition, chief, and related series | P3-P4 | Verified subgroup inclusions and factors |
| F15 | Quotients and natural projections | P3 | Normality, coset equality, kernel and image; explicit quotient domain |
| F16 | Homomorphisms: generator images, validation, composition, kernels, images, preimages | P3 | Relation consistency and ambient domains |
| F17 | Direct, semidirect, wreath, subdirect, and other products | P3-P4 | Embeddings/projections and validated action maps |
| F18 | Isomorphism search, automorphism groups, inner/outer automorphisms | P4, P8 | Class-specific algorithms first; distinguish equal, isomorphic, and undecided |
| F19 | Subgroup lattices, maximal/normal subgroups, subgroup conjugacy classes, low-index enumeration | P3, P6, P8 | Output-size limits and streaming completeness metadata |
| F20 | Finite and finitely generated abelian groups, invariant factors, Smith normal form | P4 | Exact integer matrix algorithms; canonical coordinate maps |
| F21 | Pc generating sequences, induced sequences, relative orders, collection | P4 | Presentation consistency; unique normal forms within validated domain |
| F22 | Solvable and polycyclic groups, extensions, polycyclic isomorphism | P4, P8 | Finite pc first; infinite polycyclic algorithms and package scope later |
| F23 | Exact coefficient fields: prime and extension fields, embeddings, finite-field linear algebra | P5 | Audit existing polynomial primitives; validated irreducibility and explicit embeddings |
| F24 | Matrix groups: field/dimension, actions, GL/SL and classical families, invariant forms | P5 | Exact invertible matrices; faithful conversions; class-specific order/membership |
| F25 | Constructive recognition, composition trees, straight-line programs, black-box methods | P8 | Verified randomized methods, field and group structure, certificate checking |
| F26 | Free groups, words, free reduction, substitutions, presentations | P6 | Generator identity, compressed words, exact exponents |
| F27 | Finitely presented groups: coset tables, low-index subgroups, subgroup presentations, transformations | P6 | Bounded Todd-Coxeter and explicit transformation maps |
| F28 | Rewriting, completion, automatic structures, word/conjugacy procedures | P6, P8 | Conditional termination and completeness; never assume a partial rewrite system is confluent |
| F29 | Nilpotent, p-, and solvable quotient algorithms; p-group generation | P6, P8 | Pc machinery, presentations, class and exponent bounds |
| F30 | Ordinary/Brauer character tables, class functions, irreducibles, power/fusion maps | P7 | Exact cyclotomics, class correspondence, tables and provenance |
| F31 | Character operations: inner products, induction/restriction, tensor products, decomposition | P7 | Exact values and validated subgroup/class maps |
| F32 | Representations/modules: invariant subspaces, irreducibility, decomposition, MeatAxe-style algorithms | P7-P8 | Exact linear algebra; coefficient-field and characteristic restrictions |
| F33 | Group algebras and representation-related algebra operations | P7-P8 | Sparse exact algebra and explicit basis; group-related scope retained |
| F34 | Group cohomology, homology, resolutions, extensions, Schur multipliers/covers | P8 | Chain complexes, module operations, dimension and degree limits |
| F35 | Group catalogs, identification and query: small, transitive, primitive, perfect/simple, character/representation data | P7-P8 | Dataset versions, coverage bounds, licenses, stable identifiers |
| F36 | Crystallographic, arithmetic, nilpotent infinite, self-similar/automaton, braid/Coxeter/reflection and other specialized groups | P8 | Package-by-package audit and class-specific algorithms |
| F37 | Group actions on graphs/designs/geometries; automorphism group interfaces | P8 | Include group functionality; treat unrelated combinatorics as dependency or separate scope |
| F38 | Random elements, random searches, reproducibility and certification | P2 onward | Existing scoped RNG; declare uniform, heuristic, Las Vegas, or Monte Carlo guarantees |
| F39 | Native representation conversions and interchange | P1 onward | Checked maps among our representations; portable MathJSON descriptors and Epsil reload |
| F40 | Algebraic extensibility, property knowledge, method selection and diagnostics | P0-P1 onward | Study GAP architecture; extend CE protocols/types/definitions; test reusable Epsil algorithms |

The proposed phases and boundaries are project decisions. The capability taxonomy is informed by these official reference entry points:

- [Groups](https://gap-system.github.io/gap/doc/ref/chap39.html): F03-F04, F08-F15, F17, F19.
- [Group homomorphisms](https://gap-system.github.io/gap/doc/ref/chap40.html): F16, F18, F39.
- [Group actions](https://gap-system.github.io/gap/doc/ref/chap41.html): F06-F07, F09, F37.
- [Permutations](https://gap-system.github.io/gap/doc/ref/chap42.html) and [permutation groups](https://gap-system.github.io/gap/doc/ref/chap43_mj.html): F02, F05, F38.
- [Matrix groups](https://gap-system.github.io/gap/doc/ref/chap44.html): F23-F25.
- [Pc groups](https://gap-system.github.io/gap/doc/ref/chap46.html): F20-F22, F29, F34.
- [Finitely presented groups](https://gap-system.github.io/gap/doc/ref/chap47.html): F26-F29.
- [Character tables](https://gap-system.github.io/gap/doc/ref/chap71.html): F30-F31; the [manual contents](https://gap-system.github.io/gap/doc/ref/chap0.html) supplies further starting points for characters, modules, algebras, and group libraries.

## 3. Package and data discovery seeds

These are research references for mathematical breadth and algorithm design. Their functionality will be rebuilt using our infrastructure; the table is not a plan to execute these packages in production. They are not all GAP packages and do not freeze their dependencies. Version numbers below are observed on their own pages during research, not a verified co-installable environment.

| Package / source | Observed version | Role in this program | Gate |
| --- | --- | --- | --- |
| [SmallGrp](https://gap-packages.github.io/smallgrp/) | 1.7.0 | Catalog and identification of groups within documented order ranges | Data coverage and provenance; artifact-specific license review |
| [Polycyclic](https://gap-packages.github.io/polycyclic/) | 2.18 | Algorithms for polycyclic presentations | Separate finite pc core and package operations; dependency audit |
| [kbmag](https://gap-packages.github.io/kbmag/) | 1.6.1 | Completion and automatic structures via native programs | Native-tool dependencies and partial-procedure semantics |
| [nq](https://gap-packages.github.io/nq/) | 2.6.1 | Nilpotent quotients of finitely presented groups | External algorithm requirements, pc dependencies, bounds |
| [recog](https://gap-packages.github.io/recog/) | 1.5.1 | Constructive recognition of permutation, matrix, and projective groups | Dependency graph, probability/certification policy, representation conversions |
| [HAP](https://gap-packages.github.io/hap/) | 1.79 | Group cohomology and related homological algorithms | Separate group functionality from broader topology; transitive dependencies |

Additional census candidates include character-table and Atlas representation libraries, transitive/primitive catalogs, Orb/genss, GAPDoc metadata, Forms, ACE, ANUPQ, AutPGrp, CRISP, Cryst/CrystCat, FGA, and group-relevant portions of other packages. This list is a discovery queue: versions, exact names, relevance, licenses, dependencies, and public APIs still require validation. Do not infer support from listing a candidate.

The [extra-package listing](https://gap-packages.github.io/) explicitly covers packages outside the distribution and does not claim completeness. Inventory the official distribution snapshot first, then maintain a separately labeled external-package track. Do not use this extra-package list as the denominator for GAP's distributed ecosystem.

## 4. Native capability ledger specification

Phase 0 creates a machine-readable capability ledger and a generated report. Entries describe Epsil's mathematical obligations and reference GAP where useful. Proposed row schema:

```json
{
  "id": "permutation-group.order",
  "family": "F03",
  "task": "Compute the exact order of a finite group given by permutation generators",
  "researchReferences": [
    { "system": "GAP", "version": "4.16.1", "operation": "Size", "algorithmArea": "stabilizer chains" }
  ],
  "epsilSurface": "to-be-designed-with-existing-library-conventions",
  "representations": ["finite-permutation-group"],
  "preconditions": ["validated-generators"],
  "guarantee": "exact integer, without group enumeration",
  "infrastructure": ["group-domain", "exact-integers", "verified-bsgs", "work-budget"],
  "deliveryPhase": "P2",
  "state": "planned",
  "environments": ["node", "browser-worker"],
  "limits": null,
  "epsilWorkflowTests": [],
  "algorithmTests": [],
  "algorithmReferences": [],
  "owner": null,
  "evidence": null
}
```

This is a proposed record, not a support claim. A supported row needs resolved documentation, limits, ownership, and evidence. The implementation-language choice belongs in its design notes; the product capability remains native to Epsil/CE whether a particular routine is implemented in Epsil or TypeScript.

Required state vocabulary: `unexamined`, `planned`, `in-progress`, `partial`, `supported`, `blocked`, and `outside-mathematical-scope-with-rationale`. Do not count reference aliases, unchecked APIs, or diagnostic switches as independent mathematical capabilities. Preserve genuinely distinct algorithms or result guarantees when they solve different user needs.

### Research and coverage process

1. Pin GAP release/package references for reproducible research and tests. Keep observed package versions separate from any locally installed reference environment.
2. Study documented mathematical operations, representations, and the architecture that supports them. Consult implementation entry points and algorithm literature; record invariant and dispatch findings.
3. Classify material as a mathematical capability, infrastructure requirement, supporting dependency, unrelated feature, or unexamined area. Make remaining research gaps visible.
4. Consolidate overlapping GAP operations into native capability records. Identify representation-specific methods and package dependencies, including group methods declared outside group chapters.
5. Design Epsil names and composition patterns from our type, expression, and library model. Preserve source references for traceability without adding a compatibility layer.
6. Attach infrastructure dependencies, phase, owner, limits, algorithm rationale, independent checks, and full Epsil workflow tests.
7. Validate unique IDs, dependency completeness, unsupported claims, orphaned tests, and reference versions in CI.
8. Report capability coverage by mathematical family, representation, and environment, alongside the completeness of Epsil user workflows.

A row is supported only when its declared guarantees hold and its Epsil workflow, boundary conditions, independent mathematical checks, and reference comparisons pass. Display bounded support and remaining generalization work explicitly. Reference programs need not use our conventions or produce our object representation: comparison tooling must normalize the mathematical meaning.

Datasets need a separate record of source/version, covered orders/degrees, available queries, absent partitions, checksums, installation sizes, attribution, and provenance review. Reusing a reviewed dataset is a separate choice from implementing an algorithm. Native Epsil catalog design need not mirror GAP's lookup API or numeric identifiers; imported identifiers retain their source namespace.

## 5. Maintaining the mathematical ambition

Review GAP and relevant package developments at planning checkpoints to identify capabilities or algorithms worth adding. Update the research landscape and record newly discovered gaps. This does not impose source compatibility or automatically change Epsil's API. No scheduled automation is created by this plan.

The long-term objective remains all of the group-theoretic mathematical functionality represented by the reference landscape. Completion requires implementing those capabilities and required data access within Epsil/CE, with honest limits for partial procedures. Internal GAP interfaces, legacy aliases, output formatting, and execution of GAP programs are outside that claim.
