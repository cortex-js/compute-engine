# Current Compute Engine Architecture (2026-02-10)

This document captures the implemented architecture after the recent modularization and extension-contract hardening work.

## Goals

- Preserve a single user-facing `ComputeEngine` API.
- Keep internal modules narrow and composable.
- Keep extension points explicit and safe.
- Enforce acyclic dependencies in runtime modules.

## Layering Model

```
┌─────────────────────────────────────────────────┐
│  4. Composition root                            │
│     index.ts (ComputeEngine)                    │
│     Composes services, exposes public API        │
├─────────────────────────────────────────────────┤
│  3. Runtime services                            │
│     engine-*.ts                                 │
│     One bounded concern per file                │
├─────────────────────────────────────────────────┤
│  2. Specialized type wrappers                   │
│     types-*.ts, global-types.ts                 │
│     Bind kernel generics to concrete types      │
├─────────────────────────────────────────────────┤
│  1. Kernel type layer                           │
│     types-kernel-*.ts                           │
│     Generic type contracts (no engine imports)  │
└─────────────────────────────────────────────────┘
```

### 1. Kernel type layer
- Files: `types-kernel-*.ts`
- Responsibility: generic type contracts for evaluation/serialization behavior without engine-specific concrete types.
- Rule: no dependency on `ComputeEngine` implementation modules.

### 2. Specialized type wrappers
- Files: `types-*.ts`, `global-types.ts`
- Responsibility: bind kernel generics to concrete compute-engine types (`BoxedExpression`, `IComputeEngine`, etc.).
- Rule: avoid importing runtime implementation modules.

### 3. Runtime services
- Files: `engine-*.ts`
- Responsibility: focused implementation concerns (parse entrypoints, startup/bootstrap, configuration lifecycle, numeric config, scope/assumptions/sequences, workflow helpers, validation helpers, extension contracts).
- Rule: services should not become secondary monoliths; each service owns one bounded concern.

### 4. Composition root
- File: `index.ts` (`ComputeEngine`)
- Responsibility: compose services, expose public API methods, and own lifecycle orchestration.
- Rule: business logic should prefer service modules; `ComputeEngine` should remain an API shell and integration point.

## Service Inventory

### Startup & Initialization
| File | Responsibility |
|------|---------------|
| `engine-startup-coordinator.ts` | Orchestrates initialization sequence: common numbers, library bootstrap, common symbols |
| `engine-library-bootstrap.ts` | Resolves library entries, topological sort, loads definitions, collects LaTeX dictionaries |
| `engine-common-symbols.ts` | Initializes well-known symbol bindings (True, False, Pi, E, Nothing) |

### Parsing & Workflows
| File | Responsibility |
|------|---------------|
| `engine-parse-entrypoint.ts` | Engine-specific parse defaults, symbol type resolution, boxing of parse results |
| `engine-workflow-entrypoints.ts` | High-level `parseSimplify/parseEvaluate/parseNumeric` combining parse + operation |

### Validation & Errors
| File | Responsibility |
|------|---------------|
| `engine-validation-entrypoints.ts` | Factory functions for error and type-mismatch expressions |
| `engine-extension-contracts.ts` | Runtime contract validation for compilation targets, libraries, and compile options |

### Engine State
| File | Responsibility |
|------|---------------|
| `engine-numeric-configuration.ts` | Precision, tolerance, angular unit, and Decimal.js configuration |
| `engine-runtime-state.ts` | Execution limits (time, iteration, recursion) and verification state |
| `engine-configuration-lifecycle.ts` | Configuration change propagation and reset fan-out |
| `engine-cache.ts` | Expression and rule-set caching with generation-based invalidation |
| `engine-latex-dictionary-state.ts` | LaTeX dictionary indexing and rebuild |

### Scoping & Declarations
| File | Responsibility |
|------|---------------|
| `engine-scope.ts` | Lexical scope push/pop, eval context management, symbol lookup |
| `engine-declarations.ts` | Symbol and operator declaration, type declaration, assignment |
| `engine-assumptions.ts` | Assumption management, `ask()`, `verify()`, `forget()` |
| `engine-sequences.ts` | Sequence declaration, OEIS lookup, recurrence evaluation |

### Expression Construction
| File | Responsibility |
|------|---------------|
| `engine-expression-entrypoints.ts` | Symbol and number expression creation with definition binding |
| `engine-simplification-rules.ts` | Built-in simplification rule initialization |

### Compilation
| File | Responsibility |
|------|---------------|
| `engine-compilation-targets.ts` | Registry for named compilation targets (JavaScript, GLSL, etc.) |
| `engine-type-resolver.ts` | Type resolution callback for parser integration |

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
- Explicit low-level options always win over presets.
  - `parse.strict` overrides `parseMode`
  - `evaluate.numericApproximation` overrides `evaluateMode`
  - `simplify.strategy` overrides `simplifyMode`
- This is implemented via object spread: the preset sets a default, then `...options.parse` overwrites it.

Note: `simplifyMode: 'trigonometric'` maps to the internal `strategy: 'fu'` (the Fu algorithm for trigonometric simplification, named after Fu, Zhong, and Zeng).

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

- **Circular dependency budget: `0`** — no cycles of any kind (runtime or type-only). Checked via `npx madge --circular --extensions ts src/compute-engine`.
- ESLint `import/no-restricted-paths` enforces layered dependencies (35 zone rules in `.eslintrc.cjs`). Run with `npm run check:deps`.
- Public type surfaces must not include explicit `any`.
- Contract tests exist for extension seams (`test/compute-engine/extension-contracts.test.ts`).

## Immediate Next Work

1. Add tests for library circular dependency detection and compilation target unregistration/re-registration.
2. Expand extension contract tests to additional compile-target families and compile-edge payloads.
3. Consider skipping contract validation for built-in compilation targets to reduce startup cost.
4. Keep documentation synchronized between kernel contracts and specialized wrappers.
