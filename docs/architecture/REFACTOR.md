# Refactor Conclusions

Date: 2026-02-07

This review covered the full repository, with focus on:

- Architecture and extension model in `src/compute-engine/*`
- Public API and developer UX in `src/compute-engine.ts`, `README.md`, `doc/*`, `examples/*`
- Capability coverage and testing in symbolic, solving, and numerics modules

## Executive Summary

The project already has a strong technical foundation for a web symbolic math library:

- Rich symbolic core (canonicalization, simplify, derivative/integral, solve)
- Good parser/serializer infrastructure
- Strong test volume, especially around symbolic algebra and parsing
- Existing extension points for symbol definitions, LaTeX dictionary, and compilation targets

The main misalignment with your goals is not lack of capability. It is architecture shape and API ergonomics:

- Core orchestration is centralized in large files, which makes extension harder than intended.
- Extension points are real, but not unified and not plugin-first.
- Public API has sharp edges for newcomers (entry-point confusion, compile behavior, canonical options).
- Docs/examples are high quality but inconsistent in key places.

Given your tolerance for major refactors, the best path is:

1. Stabilize user-facing behavior and docs quickly.
2. Refactor to a plugin-oriented internal architecture.
3. Improve numerical and solver fallback layers.

## What Already Aligns With Goals

1. Strong symbolic foundation
- `src/compute-engine/symbolic/simplify-rules.ts`
- `src/compute-engine/symbolic/derivative.ts`
- `src/compute-engine/symbolic/antiderivative.ts`
- `src/compute-engine/boxed-expression/solve.ts`

2. Modular-by-directory design (partial)
- Clear subsystems: parsing (`latex-syntax`), symbolic (`symbolic`), numerics (`numerics`), compilation (`compilation`), library definitions (`library`), boxed expression core (`boxed-expression`)

3. Multiple extensibility hooks already exist
- Standard library composition: `src/compute-engine/library/library.ts`
- Custom LaTeX dictionary input: `src/compute-engine/index.ts`
- Custom compile targets: `registerCompilationTarget()` in `src/compute-engine/index.ts`

4. High test investment
- Large test suite under `test/compute-engine/*`
- Broad coverage in simplify, solve, compile, parser, linear algebra

## Key Misalignments and Risks

### 1) Core orchestration is too centralized

Evidence:

- `src/compute-engine/index.ts` is ~2745 lines
- `src/compute-engine/global-types.ts` is ~3922 lines
- `src/compute-engine/boxed-expression/abstract-boxed-expression.ts` is ~911 lines

Impact:

- Harder to reason about changes
- Higher coupling between parser, evaluator, symbolic ops, numerics, compile targets
- Increased risk when adding new algorithms

Conclusion:

The codebase is modular in folders, but not yet modular in runtime composition.

### 2) Extension model is fragmented, not plugin-first

Evidence:

- Library categories are hardcoded and order-sensitive in `src/compute-engine/library/library.ts`
- LaTeX dictionary categories are hardcoded in `src/compute-engine/latex-syntax/dictionary/definitions.ts`
- Compile targets use one registry, but other extension surfaces use separate patterns
- Some code uses dynamic imports specifically to avoid circular dependencies (for example in `src/compute-engine/boxed-expression/abstract-boxed-expression.ts`)

Impact:

- Adding new functionality requires internal knowledge across multiple files
- Feature composition order can create subtle behavior differences
- Circular dependency pressure indicates weak dependency boundaries

### 3) API ergonomics are good for experts, uneven for general users

Evidence:

- `canonical`/`structural` behavior is powerful but complex in `doc/03-guide-expressions.md` and related docs
- `toString()` defaults to AsciiMath in `src/compute-engine/boxed-expression/abstract-boxed-expression.ts`
- `compile()` has fallback behavior by default, while docs often describe throw semantics (`doc/13-guide-compile.md` vs implementation in `src/compute-engine/boxed-expression/abstract-boxed-expression.ts`)

Impact:

- Educators and students can hit avoidable confusion
- Professionals may see behavior that is hard to predict from API names

### 4) Entry-point and packaging story is inconsistent

Evidence:

- Package exports only `.` in `package.json`
- Separate roots exist (`src/math-json.ts`, `src/cortex.ts`) but are not exposed via subpath exports
- Example imports are inconsistent: some from `../dist/*`, some from `../src/*`, while README uses package import

Impact:

- Discoverability and onboarding friction
- Less clear boundary between public API and internal source layout

### 5) Documentation and repository hygiene issues

Evidence:

- `docs/` directory is empty while full docs are in `doc/`
- Tracked system/stale files exist (`.DS_Store`, `src/compute-engine/latex-syntax/parse.ts.bak`)

Impact:

- Lower trust and maintainability
- Preventable contributor confusion

### 6) Numerical method risk: improper integral Monte Carlo scaling

Evidence:

- `src/compute-engine/numerics/monte-carlo.ts` uses transformed sampling for infinite bounds, then multiplies by `scale = b - a`
- For infinite limits this yields `Infinity` or `NaN` scaling

Impact:

- Incorrect `NIntegrate`/numeric integration results for improper integrals
- High-priority correctness issue

### 7) Capability gaps are acceptable for scope, but fallback strategy is incomplete

Evidence:

- Solving is mostly rule-based in `src/compute-engine/boxed-expression/solve.ts`
- No robust numeric root solver fallback layer (for generic transcendental/univariate cases)
- Symbolic antiderivative engine is heuristic (`src/compute-engine/symbolic/antiderivative.ts`)

Impact:

- Users will encounter unsolved but numerically tractable equations/integrals
- Perceived reliability drops without graceful fallback policy

### 8) Circular dependency risk is structural, not incidental

Evidence:

- Explicit dynamic-import workarounds are present in core paths to avoid cycles
- Large cross-cutting files (`index.ts`, `global-types.ts`) increase mutual coupling pressure

Impact:

- Runtime surprises from load-order sensitivity
- Harder static reasoning and bundling reliability
- Refactoring friction because cycle breakage is easy to reintroduce

## Recommended Target Architecture

Design principle: keep one product package, but refactor internals to be plugin-oriented with explicit service boundaries.

### A) Introduce a unified plugin contract

Add a single plugin interface with optional hooks:

- `registerSymbols(registry)`
- `registerLatex(dictionaryRegistry)`
- `registerCanonicalizers(registry)`
- `registerEvaluators(registry)`
- `registerSimplifiers(registry)`
- `registerSolvers(registry)`
- `registerCompilers(registry)`

This consolidates today's scattered extension surfaces into one consistent mechanism.

Plugin dependency model should be explicit:

- Each plugin declares a manifest:

```ts
interface PluginManifest {
  name: string;
  version: string;
  requires?: Record<string, string>; // semver range
  optionalRequires?: Record<string, string>;
  provides?: string[]; // capability ids
  before?: string[];
  after?: string[];
  conflicts?: string[];
}
```

- Resolution semantics:
- `requires` is a hard constraint: plugin must exist and satisfy semver range.
- `optionalRequires` is soft: if present and compatible, enable enhanced behavior; otherwise continue with fallback.
- `requires` contributes ordering edges (`required -> dependent`) automatically.
- `before`/`after` are additional ordering constraints among loaded compatible plugins.
- `conflicts` is hard fail with deterministic conflict diagnostics.
- If a plugin requires a capability (not just a plugin), resolution fails unless some loaded plugin `provides` it.
- Plugin load order is resolved by topological sorting of all hard and soft edges after filtering incompatible plugins.
- Missing deps, unsatisfied capability requirements, and cycles fail fast at startup with actionable diagnostics.

### B) Split `ComputeEngine` orchestration into internal services

Extract service modules from `src/compute-engine/index.ts`:

- `EngineContextService` (scopes, assumptions, declarations)
- `ExpressionFactoryService` (`box`, `parse`, `function`, `number`, symbol creation)
- `RegistryService` (symbols/operators/compilers/dictionaries/plugins)
- `ExecutionService` (evaluate/simplify/verify time limits)

`ComputeEngine` then becomes a facade over these services.

Type definitions should be modularized in parallel:

- Break `src/compute-engine/global-types.ts` into domain files, for example:
- `src/compute-engine/types/expression.ts`
- `src/compute-engine/types/engine.ts`
- `src/compute-engine/types/symbols.ts`
- `src/compute-engine/types/evaluation.ts`
- `src/compute-engine/types/compile.ts`
- Keep `src/compute-engine/global-types.ts` temporarily as a compatibility re-export barrel, then remove it in a major cleanup.
- Prevent new type-level cycles with explicit import rules:
- `types/expression*` cannot import from engine/runtime services.
- `types/engine*` can import expression types, not vice versa.
- `types/compile*` may depend on expression + engine public interfaces only.
- Enforce with lint boundaries and cycle checks in CI.

### C) Make operation pipelines explicit

For simplify/solve/integrate:

- Define ordered passes with clear contracts
- Use registries instead of hardcoded pass composition
- Add explicit guardrails for recursion/expansion cost where needed
- Add a debug/trace mode that records which pass/rule/strategy transformed an expression and why
- Standardize trace events across simplify/solve/integrate so developers can inspect full decision flow

### D) Define service interfaces and communication rules up front

- Define explicit service interfaces first (for example `IRegistryService`, `IExecutionService`, `IExpressionFactoryService`).
- Use constructor-based dependency injection and direct interface calls for core execution paths.
- Use an event stream only for observability (`trace`, `warnings`, `metrics`), not business logic orchestration.
- Prevent mini-monolith services by keeping responsibilities narrow and one-way dependency direction.
- Add architecture guardrails:
- Maximum service public API surface per service (small interface policy).
- No service may import another service's concrete class, only its interface.
- Dependency graph checks in CI (`import/no-cycle` and dependency graph validation).

### E) Circular Dependency Remediation Plan

1. Define a layered dependency policy:
- `common`/`math-json` -> `types` -> `boxed-expression`/`library`/`latex`/`numerics` -> `compute-engine facade`
2. Enforce with tooling:
- Add `import/no-cycle` and boundary rules.
- Add dependency graph checks in CI and fail on new cycles.
3. Eliminate current dynamic-import cycle breakpoints incrementally:
- Track each dynamic-import location and replace with interface-based dependency injection.
4. Add a cycle budget metric in CI:
- Initial baseline accepted, but budget only decreases over time.

### F) Keep existing boxed-expression type-system direction

Detailed sub-proposal: `docs/architecture/boxed-expression-refactor.md`.

That document proposes role interfaces and stronger type contracts for boxed expressions. It is compatible with this refactor and should be treated as part of phase 2 internals hardening.

## Recommended API Redesign (Breaking Changes Accepted)

1. Replace boolean canonical controls with explicit form option
- Current: `{ canonical: true|false|... , structural?: boolean }`
- Proposed: `{ form: 'canonical' | 'structural' | 'raw' | CanonicalForm[] }`

2. Split parsing names for clarity
- Add `parseLatex()` alias for `parse()`
- Add `boxMathJson()` alias for `box()`
- Keep old names temporarily, then remove in next major

3. Normalize compile return type
- Current return type behaves as executable function with `toString()` code string
- Proposed return object:
  - `{ target, success, code, run?, diagnostics?, metadata? }`
- JS targets provide `run`
- Non-JS targets provide only `code`
- Compatibility plan:
- Keep current callable-with-`toString()` return in v1 behind compatibility wrapper.
- Add new `compileArtifact()` API immediately.
- Migrate `compile()` to return artifact in next major.
- `success` semantics:
- `true` when artifact generation completed and no fatal diagnostics.
- `false` when fallback artifact is produced or target-specific blockers prevent executable output.
- Target metadata examples:
- GLSL: `metadata.uniforms`, `metadata.attributes`, `metadata.varyings`.
- WASM/native: `metadata.imports`, `metadata.exports`, `metadata.memory`.

4. Make global registration opt-in
- Current side effect in `src/compute-engine.ts` writes to `globalThis[Symbol.for('io.cortexjs.compute-engine')]`
- Replace with explicit `registerGlobalComputeEngine()` utility

5. Publish explicit subpath exports
- `@cortex-js/compute-engine`
- `@cortex-js/compute-engine/math-json`
- `@cortex-js/compute-engine/cortex`

## Prioritized Refactor Plan

## Phase 0: Immediate Corrections (1-2 weeks)

1. Fix improper integral scaling in `src/compute-engine/numerics/monte-carlo.ts`
2. Add tests for finite and infinite-bound Monte Carlo in `test/compute-engine/numeric.test.ts`
3. Standardize all examples to package imports (no `../src` or `../dist`)
4. Add `examples/README.md` with run instructions
5. Remove stale/system files (`*.bak`, `.DS_Store`) and prevent reintroduction
6. Clarify docs path and keep one canonical docs directory
7. Add a short design note with the Monte Carlo fix algorithm and validation criteria

## Phase 1: Public API and Packaging (2-4 weeks)

1. Introduce new explicit form API and aliases (`parseLatex`, `boxMathJson`)
2. Add subpath exports for `math-json` and `cortex`
3. Replace implicit global registration with opt-in call
4. Update docs and examples to one coherent API narrative by persona

## Phase 2: Core Architecture Refactor (4-8 weeks)

1. Add plugin contract and registry system
2. Extract services from monolithic `ComputeEngine`
3. Remove order-sensitive hardcoded composition for library/dictionary loading
4. Reduce dynamic-import cycle breaks by formalizing dependency direction
5. Modularize `src/compute-engine/global-types.ts` into domain-oriented type modules
6. Implement plugin dependency resolution and validation (missing/cycle diagnostics)
7. Add cross-cutting debug/trace plumbing to execution pipelines
8. Enforce service interface boundaries with lint/CI rules
9. Add dependency graph checks and a cycle budget gate in CI

## Phase 3: Capability Hardening (ongoing)

1. Add numeric root-finding fallback for solve (`bisection` first, then `Brent`)
2. Add solve strategy layering: symbolic first, numeric fallback second
3. Strengthen integrate fallback policy and diagnostics for unsupported symbolic forms
4. Add targeted tests for numerical methods, domain constraints, and extraneous roots
5. Add human-readable trace outputs for simplify/solve/integrate to support algorithm-level debugging

## Critical Fix Detail: Monte Carlo Improper Integrals

### Problem

Current implementation applies transformed sampling for infinite bounds, then incorrectly multiplies by `b-a`, which is infinite in improper cases.

### Proposed Fix

Use estimator-specific Jacobian weighting only, with no `b-a` scaling for transformed domains:

- `(-inf, +inf)`: use `x = tan(pi(u-1/2))`, estimator `f(x)/jacobian`, `jacobian = pi(1+x^2)`.
- `(a, +inf)`: use `x = a - ln(u)` for `u in (0,1)`, estimator `f(x) * (1/u)`.
- `(-inf, b)`: use `x = b + ln(u)` for `u in (0,1)`, estimator `f(x) * (1/u)`.
- `(a, b)`: standard uniform estimator with `b-a` scale.

Optional follow-up:

- Add deterministic-seed support for tests.
- Add alternative numeric integrators (adaptive quadrature) for 1D finite intervals; keep Monte Carlo as fallback for difficult/high-dimensional cases.

## Test Strategy Improvements

Add explicit suites for:

- Monte Carlo improper integrals and error estimation
- Richardson limit behavior and numerical derivative accuracy
- Solver domain validation (sqrt/log/trig constraints and extraneous roots)
- Behavior contracts of new API forms (`form`, compile result object, plugin load order)
- Traceability contracts (expected trace steps for representative simplify/solve/integrate scenarios)

Concrete tests to add:

- Monte Carlo:
- `∫_0^∞ e^{-x} dx = 1`
- `∫_{-∞}^{∞} e^{-x^2} dx = sqrt(pi)` (within tolerance)
- `∫_0^1 x^2 dx = 1/3`
- Numeric fallback solver baseline (univariate):
- `x = cos(x)`
- `e^x = 3`
- `x e^x = 1`
- `sin(x) = x/2`
- `ln(x) + x = 2` (domain-aware root)
- Trace mode:
- assert emitted pass/rule sequence for representative simplify, solve, integrate flows

Coverage targets:

- Record current baseline coverage for `src/compute-engine/numerics/*` in CI reports.
- Target minimum line coverage for numerics modules: 80% in first pass, 90% medium-term.
- Require explicit tests for every new numerical method branch (including improper integral paths).

## Suggested Success Metrics

1. New algorithm integration requires touching <= 3 focused files.
2. No new dynamic-import cycle workarounds in core expression/evaluation paths.
3. 100% examples use public package imports only.
4. Numeric fallback solves a defined baseline set of transcendental equations.
5. API docs show one primary path for novice users and one advanced path for plugin authors.

## Final Conclusion

This codebase is already a credible symbolic math platform for web environments. The next major leap should be architectural: move from a strong monolith to an explicit plugin-and-service core. That shift best matches your goals of modularity, extensibility, and approachable API design without trying to compete on raw breadth with Mathematica/SymPy.
