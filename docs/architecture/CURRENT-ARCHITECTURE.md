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

### Parsing & Free Functions
| File | Responsibility |
|------|---------------|
| `engine-parse-entrypoint.ts` | Engine-specific parse defaults, symbol type resolution, boxing of parse results |
| `free-functions.ts` | Top-level free functions (`parse`, `simplify`, `evaluate`, `N`, `assign`) backed by a lazy global engine |

### Validation & Errors
| File | Responsibility |
|------|---------------|
| `engine-validation-entrypoints.ts` | Factory functions for error and type-mismatch expressions |
| `engine-extension-contracts.ts` | Runtime contract validation for compilation targets, libraries, and compile options |

### Engine State
| File | Responsibility |
|------|---------------|
| `engine-numeric-configuration.ts` | Precision, tolerance, angular unit, and BigDecimal configuration |
| `engine-runtime-state.ts` | Execution limits (time, iteration, recursion) and verification state |
| `engine-configuration-lifecycle.ts` | Configuration change propagation and reset fan-out |
| `engine-cache.ts` | Expression and rule-set caching with generation-based invalidation |

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

## LatexSyntax as Injectable Dependency

`LatexSyntax` is an optional dependency of `ComputeEngine`. The engine does not
statically import the `LatexSyntax` class — it only uses the structural
`ILatexSyntax` interface from `types-engine.ts`.

**Injection mechanism:**

1. **Explicit constructor option**: `new ComputeEngine({ latexSyntax: new LatexSyntax() })`.
2. **Static factory** (`ComputeEngine._latexSyntaxFactory`): Registered by the
   full entry point (`compute-engine.ts`). Enables lazy creation so `new ComputeEngine()` still works with LaTeX when imported from the full package.
3. **No LatexSyntax**: When imported from the core sub-path without injection,
   `ce.parse()`, `.latex`, and `.toLatex()` throw a clear error. MathJSON
   serialization gracefully omits the optional `latex` metadata field.

**Key types:**

- `ILatexSyntax` (in `types-engine.ts`) — structural interface with `parse()` and `serialize()` methods.
- `IComputeEngine.latexSyntax` — getter returning the instance (lazily created via factory if available) or `undefined`.
- `IComputeEngine._requireLatexSyntax()` — returns the instance or throws.

**Files involved:**

| File | Role |
|------|------|
| `types-engine.ts` | Defines `ILatexSyntax` interface, declares `latexSyntax` / `_requireLatexSyntax()` on `IComputeEngine` |
| `index.ts` | Stores instance, exposes getter/helper, accepts constructor option, holds static factory |
| `compute-engine.ts` | Registers the factory: `ComputeEngine._latexSyntaxFactory = () => new LatexSyntax()` |
| `abstract-boxed-expression.ts` | `.latex` / `.toLatex()` route through `engine._requireLatexSyntax()` |
| `serialize.ts` | Latex metadata conditional on `ce.latexSyntax` availability |
| `rules.ts` | Rule parsing constructs LatexSyntax via `ce._requireLatexSyntax().constructor` |

## Free Functions & Lazy Global Engine

Top-level free functions (`parse`, `simplify`, `evaluate`, `N`, `assign`) are exported from `index.ts` via `free-functions.ts`. They are backed by a lazily-instantiated global `ComputeEngine` accessible via `getDefaultEngine()`.

- `parse(latex)` — parse a LaTeX string
- `simplify(latex | expr)` — simplify a LaTeX string or BoxedExpression
- `evaluate(latex | expr)` — evaluate a LaTeX string or BoxedExpression
- `N(latex | expr)` — numeric approximation
- `assign(id, value)` / `assign({...})` — assign values in the global engine
- `getDefaultEngine()` — access the shared engine instance for configuration

The global engine is created on first call to any free function via a factory
registered by the entry point. The full entry point (`compute-engine.ts`)
registers a factory that includes `LatexSyntax`; the core entry point
(`index.ts`) registers a factory without it.

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
- `latexDictionary` must be an array (if present; removed from standard libraries)

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
