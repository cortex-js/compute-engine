# Epsil-native group theory

Phase 0 research and bounded group foundation in progress, 2026-10-26. The foundation is intended for an initial draft PR and maintainer feedback; see [the review guide](REVIEW-GUIDE.md). All current group-theory validation uses Node 26; see [algorithm improvements and measurements](PERFORMANCE.md). This worktree contains planning, source research, foundation decisions, executable Epsil examples, and opt-in checked permutation, finite-group, exact-matrix and polycyclic foundations. It does not yet deliver a production group-theory library.

Build our own Epsil group-theory system from the ground up, using Compute Engine's framework and new algebraic infrastructure. Study GAP's architecture, representations, and algorithms to inform the design and its eventual mathematical breadth. Epsil owns the API and programming model; GAP parsing, API emulation, and runtime bridging are outside this project. GAP can serve as a separate development test oracle.

The latest implementation adds [finite-group structure, exact matrix groups, and polycyclic coordinates](FINITE-MATRIX-POLYCYCLIC.md). The [323-operation ledger for chapters 39, 44 and 45](CHAPTER-COVERAGE.json) explicitly records partial coverage and missing work; none of those chapters is complete. It builds on the [verified finite-permutation group baseline](VERIFIED-GROUP-BASELINE.md): exact order/membership, point stabilizers, subgroup queries and element operations. The [chapter 39 and prerequisite audit](BASELINE-AUDIT.md) identifies existing CE facilities and the remaining group/matrix-group contracts. Earlier slices cover [point orbits and transversals](ORBITS-AND-TRANSVERSALS.md), [bounded closure](GROUPS-AND-CLOSURE.md), and [validated permutations](VALIDATED-PERMUTATIONS.md). The [chapter 43 plan](GAP-43-ROADMAP.md) tracks the wider target.

Start with the architecture research, then the broader product and delivery scope:

1. [Phase 0 architecture study](PHASE0-ARCHITECTURE.md): pinned GAP sources, mapping to CE infrastructure, executable findings, and open work.
2. [Foundation decisions](FOUNDATIONS.md): domains, validated elements, arithmetic, equality, facts, execution, and maps.
3. [Product requirements](PRD.md): users, scope, semantics, architecture, first release, and acceptance criteria.
4. [Coverage map](COVERAGE.md): capability families, representative GAP operations, package candidates, and the rules for tracking mathematical capability coverage.
5. [Delivery plan](../plans/2026-10-25-gap-group-theory-plan.md): dependencies, phase gates, initial work items, staffing assumptions, and risks.

The recommended first release supports exact finite permutation groups through a verified stabilizer-chain implementation. It must compute order and membership without enumerating the group, support complete Epsil programs through the engine's types, evaluation, MathJSON, and runtime contracts, and expose honest limits.

## Baselines and evidence

- Draft integration base: current upstream main at commit c1fee0aaa (package 0.169.1), rebased before publication. Node 26 validation is rerun against this base.
- Original research baseline: `origin/main`, commit `41240b5e90aee75fcf0a81360b66f464e2c16845`, package version `0.161.0`.
- Isolated worktree: `gap-group-theory-plan/compute-engine`; branch `codex/gap-group-theory-plan`. The existing integration work is a different checkout and was not used as this plan's baseline.
- Pinned GAP reference baseline: [GAP 4.16.1](https://github.com/gap-system/gap/releases/tag/v4.16.1), identified by the [GAP website](https://www.gap-system.org/) as the current release during this research.
- Research date: October 25, 2026, America/Chicago. The online [reference manual](https://gap-system.github.io/gap/doc/ref/chap0.html) identifies itself as **4.17dev**. It is used here to map the landscape, not as proof of 4.16.1 behavior. Phase 0 must reconcile the inventory against the pinned release's own manuals and executable.
- The [source manifest](phase0-sources.json) pins thirteen inspected core files to peeled commit `3358a41bfca7059a8478c5b77d6fb88c9a3f610d`, with raw-byte hashes and lengths. It does not freeze the whole distribution or packages.
- Package pages have independent release versions. Listed candidates are neither a complete package census nor a locked dependency set.

This plan makes no claim of a completed mathematical capability census, executed GAP differential tests, production-wide group-algorithm performance, or confirmed redistribution permissions. Those have explicit deliverables and gates below. Proposed names and interfaces are not existing APIs.

## Current validation and handoff

- The permutation and group foundation passes 277 tests across eleven kernel and CE integration suites. This includes exhaustive inverse/identity checks through six points, malformed and forged data, finite actions, cancellation, serialization, and checkpoint lifecycle. The [finite/matrix/polycyclic example](../../scripts/group-theory/exact-groups.epsil) also runs through the same opt-in library. The [checked-value example](../../scripts/group-theory/validated-permutations.epsil), [complete bounded group workflow](../../scripts/group-theory/group-closure.epsil), [orbit/transversal workflow](../../scripts/group-theory/orbits.epsil), and [verified group workflow](../../scripts/group-theory/baseline.epsil) run through the opt-in installer.

- The [research harness](../../scripts/group-theory/phase0-probe.ts) passes all ten checks: generic Epsil operations, noncommutativity, domain mismatch, nominal validation gap, bounded S3 closure, explicit limits, fresh-engine reload, checkpoint restore, exact integer transport, and the observed nominal `Append` restriction.
- Run it with `node node_modules/tsx/dist/cli.mjs scripts/group-theory/phase0-probe.ts` from this worktree. The [Epsil model](../../scripts/group-theory/phase0-model.epsil) contains the actual prototype operations and closure routine.
- `npm run typecheck` passes using Git Bash and the existing dependency tree exposed through a local ignored `node_modules` junction to the original checkout. No packages were installed or changed. This supersedes the earlier missing-node-types limitation; it is not a clean lockfile install validation.
- The standalone research harness and the new kernel/integration tests pass their targeted TypeScript checks. Repository type checking passes after the foundation changes. Local documentation links, code fences, manifest structure, and tracked-diff checks are checked at handoff. Oxlint is unavailable in the shared local dependency tree, so no lint pass is claimed.
- The original checkout remains separate. New kernel and adapter source files are present, but the default library and core runtime are unchanged. This branch is being published as a draft for architectural feedback. Continue development in the same isolated worktree; chapter coverage remains incomplete.
- No GAP executable or real-browser test was run. Node 26 production-style ESM benchmarks and fresh Node-worker MathJSON transport now pass; see [performance evidence](PERFORMANCE.md). The bounded deterministic full-Schreier implementation is verified by its own certificate checker and independent small-case tests; optimized/reduced BSGS and production release validation remain open. The architecture report records the remaining Phase 0 gates.