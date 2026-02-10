# Current Compute Engine Architecture (2026-02-10)

This document captures the implemented architecture after the recent modularization and extension-contract hardening work.

## Goals

- Preserve a single user-facing `ComputeEngine` API.
- Keep internal modules narrow and composable.
- Keep extension points explicit and safe.
- Enforce acyclic dependencies in runtime modules.

## Layering Model

1. Kernel type layer
- Files: `types-kernel-*.ts`
- Responsibility: generic type contracts for evaluation/serialization behavior without engine-specific concrete types.
- Rule: no dependency on `ComputeEngine` implementation modules.

2. Specialized type wrappers
- Files: `types-*.ts`, `global-types.ts`
- Responsibility: bind kernel generics to concrete compute-engine types (`BoxedExpression`, `IComputeEngine`, etc.).
- Rule: avoid importing runtime implementation modules.

3. Runtime services
- Files: `engine-*.ts`
- Responsibility: focused implementation concerns (parse entrypoints, startup/bootstrap, configuration lifecycle, numeric config, scope/assumptions/sequences, workflow helpers, validation helpers, extension contracts).
- Rule: services should not become secondary monoliths; each service owns one bounded concern.

4. Composition root
- File: `index.ts` (`ComputeEngine`)
- Responsibility: compose services, expose public API methods, and own lifecycle orchestration.
- Rule: business logic should prefer service modules; `ComputeEngine` should remain an API shell and integration point.

## Service Boundaries (Implemented)

- Startup/bootstrap: `engine-startup-coordinator.ts`, `engine-library-bootstrap.ts`
- Parse defaults/policy: `engine-parse-entrypoint.ts`
- Workflow API helpers: `engine-workflow-entrypoints.ts`
- Validation/error expression entrypoints: `engine-validation-entrypoints.ts`
- Numeric policy/state: `engine-numeric-configuration.ts`
- Runtime limits/verification state: `engine-runtime-state.ts`
- Configuration lifecycle/reset fan-out: `engine-configuration-lifecycle.ts`
- Compilation target registry: `engine-compilation-targets.ts`
- Extension contracts: `engine-extension-contracts.ts`

## Public Workflow API Policy

- `parseSimplify()`
  - Parse presets: `parseMode = strict | permissive`
  - Simplify presets: `simplifyMode = default | trigonometric`
- `parseEvaluate()`
  - Parse presets: `parseMode = strict | permissive`
  - Evaluate presets: `evaluateMode = exact | numeric`
- `parseNumeric()`
  - Parse presets: `parseMode = strict | permissive`

Precedence rule across workflow helpers:
- Explicit low-level options win over presets.
  - `parse.strict` overrides `parseMode`
  - `evaluate.numericApproximation` overrides `evaluateMode`
  - `simplify.strategy` overrides `simplifyMode`

## Extension Contracts (Runtime Guards)

Compilation target registration (`ce.registerCompilationTarget()`):
- name must be non-empty and whitespace-free
- target must implement required `LanguageTarget` methods:
  - `getOperators()`
  - `getFunctions()`
  - `createTarget()`
  - `compile()`

Custom libraries (`new ComputeEngine({ libraries: [...] })`):
- library object shape is validated
- `name` validated
- `requires` must be an array of library names
- duplicate dependencies in `requires` are rejected
- `definitions` must be object or array of objects
- `latexDictionary` must be an array

Compile option payloads (`compile(expr, options)`):
- validates `to`, `target`, `operators`, `functions`, `vars`, `imports`, `preamble`, `fallback`
- `operators` entries must be `[string, number]`
- `functions` entries must be `string | function`
- `vars` entries must be strings
- `imports` must be an array

Rules:
- rule replacement callback results are enforced to be either:
  - a boxed expression, or
  - a valid rule step shape with boxed expression value

## Guardrails

- Circular dependency budget: `0` (checked in `typecheck` + `check:deps` workflows).
- Public type surfaces must not include explicit `any`.
- Contract tests exist for extension seams (`test/compute-engine/extension-contracts.test.ts`).

## Immediate Next Work

1. Keep shrinking `ComputeEngine` orchestration by extracting remaining utility glue.
2. Expand extension contract tests to additional compile-target families and compile-edge payloads.
3. Keep documentation synchronized between kernel contracts and specialized wrappers.
