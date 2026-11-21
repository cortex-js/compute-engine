# Rebuild-only Document landing handoff

## Prompt for the implementation session

Prepare the sealed, rebuild-only `Document` implementation for landing on current Compute Engine `main`. Work in an isolated worktree. Use the verified private prototype below, reconcile it with current main, review the public API and lifecycle, and produce the exact npm package tarball for Tycho to qualify. Read `AGENTS.md`, `BUILD.md`, the review checklist, and the shared-box rules before editing or running checks. Return a reviewable patch and evidence to the user and the coordinating Codex session. Leave the shared index and both repositories' release state for the integration decision.

## Starting point

At handoff, local CE main was clean at `c39062f86`, after the `0.196.1` version commit. Read the current HEAD before creating your worktree. `Document` is private. The latest sealed source is `/private/tmp/ce-document-publication.7jVz69VF/ce`. The earlier browser build has the registry guards and predates the publication seal.

Replay these patches in order. The full sequence applied cleanly to archives of `672b22cfa` and `c39062f86`. The original-base replay matched the sealed candidate's source manifest and lifecycle fixture. The fixture also matched on `c39062f86`. Tests and package validation on the updated base are still pending. The first patch already contains the lifecycle work.

1. `/private/tmp/ce-document-196-adoption.QXnlGmvG/document-adoption-672b22cfa.patch`
2. `/private/tmp/ce-document-registry.x7E7aoLS/document-registry-readonly.patch`
3. `/private/tmp/ce-document-kinds.UklzsLQX/document-kind-readonly.patch`
4. `/private/tmp/ce-document-publication.7jVz69VF/seal-published-document.patch`

The matching prepared Tycho source and runners are under `/private/tmp/ce-binding-delegated-2026-11-20/tycho-196-kinds-smoke.jhzogf4H/`. Start with `host/` and the integration report. Tycho and CE have an existing shared handoff at `/private/tmp/ce-tycho-document.dYzc0x/{from-ce,from-tycho}.md`. Use that channel for the artifact and any concrete host questions. [Integration report](</private/tmp/ce-binding-delegated-2026-11-20/tycho-196-kind-registry-integration.md>) · [Sealed scope report](</private/tmp/ce-document-publication.7jVz69VF/REPORT.md>)

## Contract to carry into review

- **Rebuild on source edits.** The host sends the complete set of stable row IDs and LaTeX sources with its syntax policy. CE discovers heads and prepares bodies with document context. Tycho owns row and dialect rules, axes, settings, action eligibility, and how to carry user state. Exercise both list indexing and function application when another row determines the parse. Each preparation yields an independent revision. An older live revision keeps its bindings.
- **Pin static contracts at preparation.** Preparation may derive types and shapes. Evaluation and actions can update admitted values without changing those contracts. A variable-length list contract can admit a length change; a `vector<integer^4>` contract rejects twelve elements. Preserve the compiler's static-shape declines where a shape is unavailable. Use corpus evidence to assess any newly declined shader or changed action behavior.
- **Seal scope and imports.** Published row definitions and prelude imports are readonly. Only declared data inputs and explicitly writable value rows accept compatible value writes. The real Tycho witness grows `H = H_0` from `[2,4]` to `[8,9,10,11]`, keeps `H_0` unchanged, and rebuilds with the stored `H` in a fresh binding. Preserve temporary axis and slider values and scratch child scopes.
- **Review the host API and registry lifetime.** The prototype exports `createDocumentEnvironment` and types for `createImports`, `prepare`, and the prepared revision. This is the API to qualify for Tycho. Synchronous initialization, disposal ordering, and readonly inspection maps are part of the contract. The prototype holds engine-wide types, protocols, conformances, and arithmetic kinds readonly until the final environment owner closes. Surface that restriction in API and migration notes and call out any host workflow it blocks. [Registry report](</private/tmp/ce-document-registry.x7E7aoLS/REPORT.md>) · [Arithmetic kind report](</private/tmp/ce-document-kinds.UklzsLQX/REPORT.md>)

This slice covers the Document API and its supporting seams. Standalone inference deletion, standalone callable replacement policy, and Program publication changes have separate adoption decisions.

## Evidence required for integration

- **CE candidate.** Run the Document lifecycle tests, affected parsing, binding and compiler tests, typecheck, dependency checks, and the core set. Follow the repository's review, full-suite and lock rules for the final integration diff. Build and pack using `BUILD.md`. Include a built-package consumer smoke test for the exported API. Record the base SHA, patch or source fingerprint, tarball SHA-256, exact commands, exit codes, and any unchecked areas.
- **Matching Tycho candidate.** Send the pinned tarball and matching host source identity to Tycho. Ask for correctness and paired first-correct-frame timings on terrain open and edits and on `2ki2hjsouf`, physical slider updates, Othello's interpreted legal-move performance and real action, and the Gomoku list write and undo/redo. Exercise add, delete, rename, and variable-to-function edits, including the first redraw after rebuild. Use 0.186.0 where comparable and preserve current faster workloads against the current control. Report the unavailable historical large-document comparison explicitly if it remains unavailable.
- **Live uniforms.** Keep the production first-frame check separate from the instrumented check that live slider writes avoid registration and series replacement. The previous stock instrumented archive lacked generated `src/version.generated.ts`. The old run root has a pinned copy for its exact stock revision. Generate or pin the corresponding file for the control actually used. The early stock build failure left this gate open.
- **Adoption report.** List CE additions and removals and the Tycho paths the matching port removes. The prototype's Tycho deletion estimate is roughly 9,600 production lines. Four earlier terrain pairs were 7.6% faster on open and 13.9% faster on edit than the 0.186.0 deployment. Earlier Othello showed no measurable slowdown versus 0.196.0. These measurements predate the seal. The sealed delta passed 11 lifecycle tests and the real manager's write/rebuild witness. No benchmark is running for this handoff. [Performance review](2026-11-20-binding-performance-review.md)

If the exact candidate clears those checks, return it for CE integration review and Tycho sign-off. Include the public API and migration notes and identify who ran each remaining gate. If a check fails, retain its repro and report the blocker before recommending release. Commit and publish only with the user's explicit authorization.
