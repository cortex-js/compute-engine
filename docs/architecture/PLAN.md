# Architecture Review and Proposal

Date: 2026-02-07

## Scope

Independent review of the full `@cortex-js/compute-engine` codebase (v0.35.5),
assessing alignment with stated goals:

- Modularity and extensibility
- Approachable API design for educators, students, researchers, professionals
- Circular dependency health
- Concrete improvement paths (major refactors acceptable, backward compatibility
  not a constraint)

This document is informed by but independent from the existing `REFACTOR.md`.
Where conclusions overlap, they are confirmed rather than duplicated. Where they
diverge, the reasoning is stated.

---

## 1. Executive Assessment

The codebase is a serious, working symbolic math engine for the web. It has
genuine strengths that most projects at this scale lack: a coherent expression
model, real symbolic simplification, multiple compilation targets, and a
well-exercised test suite.

The problems are not about missing capability. They are structural:

1. **The `BoxedExpression` interface is a God Object** (150+ members). It makes
   the system feel monolithic even where the directory layout suggests
   modularity.
2. **Circular dependencies are managed by runtime workarounds**, not by
   architecture. The dynamic `require()` calls in core paths are symptoms of
   unclear dependency direction.
3. **The public API has three levels of expression creation** (`box`,
   `function`, `_fn`) with subtly different canonicalization semantics. This is
   the single biggest source of confusion for new users.
4. **Extension is possible but not guided**. Adding a new function, compilation
   target, or simplification rule requires knowledge scattered across 4-6 files
   with implicit ordering constraints.

The good news: these are all fixable without rewriting the mathematical core.
The symbolic rules, numeric evaluation, and LaTeX parsing infrastructure are
solid and should be preserved.

---

## 2. What Works Well

### 2.1 Expression Model

The boxing system is the right abstraction for this domain. Wrapping every
mathematical entity in a `BoxedExpression` enables uniform traversal,
serialization, evaluation, and compilation. The MathJSON interchange format is
clean and well-specified.

### 2.2 Symbolic Core

The simplification engine (`simplify-rules.ts`, `fu.ts` for trig) is
production-quality. The recursion guards (deduplication, step limit, cost
function with 1.3x threshold) show engineering maturity. The derivative and
antiderivative implementations cover the standard undergraduate calculus
curriculum.

### 2.3 Compilation Targets

Five compilation targets (JavaScript, GLSL, Python, Interval-JavaScript,
Interval-GLSL) with a shared `CompileTarget` interface. The
`registerCompilationTarget()` API is the most plugin-friendly extension point in
the codebase today. This pattern should be generalized.

### 2.4 LaTeX Parser

Dictionary-based recursive-descent parser with precedence climbing. 14,769 lines
of well-structured code. The dictionary approach (8,349 lines of definitions) is
correct for mathematical notation, which is highly irregular and
convention-dependent. Customizable enough for most use cases.

### 2.5 Test Suite

Broad coverage across symbolic algebra, parsing, serialization, and compilation.
Snapshot testing for LaTeX round-trips. The test infrastructure is a genuine
asset.

### 2.6 Numeric Value System

The three-tier numeric precision model (machine float, exact rational, arbitrary
precision via Decimal.js) is well-designed. `NumericValue` encapsulates this
cleanly, and the promotion/demotion logic handles edge cases correctly.

---

## 3. Structural Problems

### 3.1 The BoxedExpression God Object

**`src/compute-engine/global-types.ts`** (3,922 lines) defines `BoxedExpression`
with 150+ properties and methods. Every expression type — numbers, symbols,
strings, functions, dictionaries, tensors — shares this single interface.

Consequences:

- Calling `.add()` on a `BoxedString` silently returns `NaN` instead of failing
  at compile time.
- The abstract base class (`abstract-boxed-expression.ts`, 911 lines) must
  provide default implementations for methods that are meaningless on most
  subclasses.
- New contributors cannot tell which methods apply to which expression types
  without reading the implementations.

The existing `boxed-expression-refactor.md` proposes role interfaces
(`INumeric`, `ICollection`) with type guards. That direction is correct.
However, the proposal underestimates the migration cost: every internal call
site that currently assumes `.re`, `.add()`, `.size`, etc. exist on all
expressions must be audited and guarded.

**Recommendation**: Start with the type guards (`isNumeric()`, `isCollection()`)
as a narrowing mechanism on the existing interface, rather than removing members
from `BoxedExpression` immediately. This lets you add compile- time safety
incrementally without a big-bang migration.

Phase 1: Add role interfaces and type guards alongside the existing interface.
Phase 2: Add deprecation warnings to base-class stubs. Phase 3: Remove stubs and
make guards mandatory.

### 3.2 Circular Dependencies

There are 6 known dynamic `require()` calls used to break circular imports at
runtime:

| File                           | Import             | Cycle                                          |
| ------------------------------ | ------------------ | ---------------------------------------------- |
| `abstract-boxed-expression.ts` | `./serialize`      | expression → serialize → product → expression  |
| `abstract-boxed-expression.ts` | `./expand`         | expression → expand → arithmetic → expression  |
| `abstract-boxed-expression.ts` | `./function-utils` | expression → function-utils → box → expression |
| `compare.ts`                   | `./assume`         | compare → assume → compare                     |
| `compare.ts`                   | `./assume`         | (second call site)                             |
| `compare.ts`                   | `./assume`         | (third call site)                              |

No automated tooling (madge, eslint-plugin-import/no-cycle) is configured. This
means new cycles are introduced silently.

**Root cause**: The dependency direction is not enforced. `BoxedExpression` is
both the data type (should be low-level) and the orchestration point (calls
serialize, expand, simplify, compile — all high-level). This violates dependency
inversion.

**Recommendation**:

1. **Immediate**: Add `madge --circular src/compute-engine` to CI. Establish a
   baseline count and enforce it only decreases.

2. **Short-term**: Extract method implementations that cause cycles into
   standalone functions that take `BoxedExpression` as a parameter rather than
   being methods on the class.

   Before (causes cycle):

   ```ts
   // In abstract-boxed-expression.ts
   expand() {
     const { expand } = require('./expand'); // dynamic import
     return expand(this);
   }
   ```

   After (breaks cycle):

   ```ts
   // In expand.ts (no cycle - takes expression as input)
   export function expand(expr: BoxedExpression): BoxedExpression { ... }

   // In abstract-boxed-expression.ts - no expand() method at all
   // Callers use: expand(expr) instead of expr.expand()
   ```

   This is a breaking API change, but backward compatibility is not a
   constraint. The free-function pattern is also more tree-shakeable.

3. **Medium-term**: Establish a layered dependency policy:
   ```
   types/ → boxed-expression/ → library/ → latex-syntax/ → ComputeEngine facade
   ```
   Each layer may only import from layers to its left. Enforce with
   eslint-plugin-boundaries or equivalent.

### 3.3 Expression Creation API

There are three ways to create function expressions:

| Method                    | Canonical     | Bound        | Structural | Notes                          |
| ------------------------- | ------------- | ------------ | ---------- | ------------------------------ |
| `ce.box(json)`            | yes (default) | yes          | via option | General-purpose                |
| `ce.function(name, args)` | yes (default) | yes          | via option | Sugar for function expressions |
| `ce._fn(name, args)`      | configurable  | configurable | **no**     | Internal fast path             |

The `_fn` method cannot produce structural expressions. The `canonical` option
accepts `boolean | CanonicalForm[]`. The `structural` option is separate from
`canonical`. The interaction between these options is documented in CLAUDE.md
but will not be obvious to any external user.

**Recommendation**: Replace all three with a single creation method that takes
an explicit form parameter:

```ts
ce.expr(name, args, { form: 'canonical' })       // default
ce.expr(name, args, { form: 'structural' })
ce.expr(name, args, { form: 'raw' })
ce.expr(name, args, { form: ['Number', 'Order'] }) // granular control
```

Keep `ce.parse()` for LaTeX input and `ce.box()` for MathJSON input. Drop
`ce.function()` and `ce._fn()` entirely. The `_fn` fast path can be an internal
implementation detail that is not exposed in the public API.

### 3.4 Monolithic Core Files

| File                           | Lines       | Responsibility                                                                                                      |
| ------------------------------ | ----------- | ------------------------------------------------------------------------------------------------------------------- |
| `global-types.ts`              | ~~3,922~~ 15 (barrel) | All type definitions → now split into 5 `types-*.ts` files                                              |
| `index.ts` (ComputeEngine)     | ~~2,745~~ 1,955 | Engine facade → scope/assumptions/declarations/sequences extracted                                          |
| `abstract-boxed-expression.ts` | 911         | Base class with default stubs                                                                                       |
| `parse.ts` (LaTeX)             | ~~2,684~~ 2,309 | LaTeX parser → number parsing extracted to `parse-number.ts`                                                 |

These files are the primary source of coupling. When everything is in one file,
everything can depend on everything.

**Recommendation**: Split along clear responsibility boundaries:

`index.ts` → extract into:

- `engine-scope.ts` (scope stack, assumptions, declarations)
- `engine-factory.ts` (box, parse, function creation, caching)
- `engine-registry.ts` (symbol registry, compilation targets, library loading)
- `engine-evaluate.ts` (evaluation context, time limits, numeric mode)
- `index.ts` becomes a thin facade that composes these

`global-types.ts` → split into:

- `types/expression.ts` (BoxedExpression interface and core types)
- `types/numeric.ts` (NumericValue, Sign, numeric properties)
- `types/function-definition.ts` (FunctionDefinition, SymbolDefinition)
- `types/compilation.ts` (CompileTarget, LanguageTarget)
- `types/serialization.ts` (serialization options, LaTeX types)

### 3.5 Library System: Order-Dependent Composition

```ts
// src/compute-engine/library/library.ts
const LIBRARIES = {
  'core': ...,
  'control-structures': ...,
  'logic': ...,
  'collections': ...,
  'relop': ...,
  'arithmetic': ...,
  'trigonometry': ...,
  'calculus': ...,
  // ... etc
};
```

Libraries are loaded in hardcoded order. Earlier libraries cannot reference
later ones. This is documented as intentional, but it means:

- Adding a new library requires understanding the full ordering.
- Cross-cutting features (like a new operator that touches arithmetic and
  trigonometry) must be placed carefully.
- Users cannot easily compose a subset of libraries.

Several library categories are empty placeholders: `algebra`, `numeric`,
`dimensions`, `units`.

**Recommendation**:

1. Make library dependencies explicit in each library definition:

   ```ts
   export const trigLibrary: LibraryDefinition = {
     name: 'trigonometry',
     requires: ['arithmetic', 'core'],
     symbols: { ... },
   };
   ```

2. Load libraries via topological sort of declared dependencies, not hardcoded
   order.

3. Allow user-authored libraries with the same mechanism:

   ```ts
   const ce = new ComputeEngine({
     libraries: [standardLibraries, myCustomLibrary],
   });
   ```

4. Remove empty placeholder categories or explicitly mark them as reserved.

### 3.6 Simplification Extensibility

The simplification system is effective but closed. Rules are defined in
`simplify-rules.ts` as internal arrays. Users cannot:

- Add custom simplification rules
- Remove or override built-in rules
- Control rule application order for their domain

**Recommendation**: Expose a rule registration API:

```ts
ce.rules.add('trigonometry', {
  match: ['Power', ['Sin', '_x'], 2],
  replace: ['Subtract', 1, ['Power', ['Cos', '_x'], 2]],
  cost: (before, after) => ...,
});
```

This does not require changing the rule engine internals. It requires making the
rule arrays mutable and allowing external contributions before the first
`simplify()` call.

### 3.7 LaTeX Parser Monolith

`src/compute-engine/latex-syntax/parse.ts` at 2,684 lines handles all parsing
phases in one file. The dictionary approach is correct, but the parser itself
mixes tokenization concerns with semantic parsing.

**Recommendation**: Extract a tokenizer module to separate lexical concerns from
semantic parsing. Beyond that, be cautious — LaTeX is inherently hostile to
traditional parsing decomposition (context-dependent commands, implicit
grouping, irregular syntax). A `tokenizer.ts` extraction is safe and useful; a
full parser split into expression/special/facade risks over-engineering given
the nature of TeX.

This is lower priority than the core architecture issues.

---

## 4. API Design Assessment

### 4.1 Strengths

- `ce.parse('\\frac{x}{2}')` is immediately intuitive.
- LaTeX output via `.toLatex()` round-trips cleanly.
- `.evaluate()`, `.simplify()`, `.solve()` are discoverable verbs.
- The `ce.assign()` / `ce.declare()` pattern for variable management is clean.

### 4.2 Pain Points

**Entry confusion**: Three creation methods (§3.3 above).

**Canonical/structural distinction**: The
`{ canonical: true | false | CanonicalForm[] }` option is powerful but the
boolean overload is confusing. `true` means "full canonical", `false` means "not
bound, not canonical". These are not opposites — there is a middle ground
(`structural`) that requires a separate option.

**compile() return type**: Returns a callable function with a `toString()` that
produces code. This is clever but non-standard. Developers expect either a
function or a code string, not a hybrid. The existing `REFACTOR.md` proposes a
`compileArtifact()` API returning
`{ target, success, code, run?, diagnostics? }` — that is the right direction.

**Inconsistent null/undefined**: Some properties return `null` for "not
applicable", others return `undefined`. The `BoxedExpression` interface
documents this inconsistency but does not resolve it.

### 4.3 Recommendations

1. **Unify form control** (§3.3): Single `form` option replacing `canonical` +
   `structural` booleans.

2. **Standardize on `undefined`** for "not applicable / not available". Reserve
   `null` for "explicitly empty" only where semantically meaningful (e.g., an
   optional argument that was explicitly set to null).

3. **Split compile API** as proposed in `REFACTOR.md`. The callable-with-toString
   pattern should go.

---

## 5. Package and Distribution

### 5.1 Current State

- Single export path: `"."` in package.json
- MathJSON types and Cortex utilities are bundled but not independently
  importable
- Examples use inconsistent import paths (`../src`, `../dist`, package name)

### 5.2 Recommendations

Add subpath exports:

```json
{
  "exports": {
    ".": { ... },
    "./math-json": { ... },
    "./types": { ... }
  }
}
```

`./math-json` exports the MathJSON type definitions and utilities without
pulling in the full compute engine. `./types` exports TypeScript types only
(zero runtime cost). This enables downstream packages to depend on the type
system without the full engine.

Standardize all examples to use the package name import. Remove any `../src` or
`../dist` imports from example code.

---

## 6. Comparison with `REFACTOR.md`

The existing `REFACTOR.md` is a thorough document that identifies many of the
same issues. Here is where this proposal agrees, diverges, or adds:

### Agreements

- Core orchestration is too centralized (§3.4 here, §1 there)
- Extension model is fragmented (§3.5 here, §2 there)
- API ergonomics need work (§4 here, §3 there)
- Entry-point packaging is inconsistent (§5 here, §4 there)
- Monte Carlo improper integral bug is real and high-priority
- BoxedExpression refactor direction (role interfaces) is correct

### Divergences

| Topic                          | `REFACTOR.md`                                                             | This Proposal                                                                                                                                     |
| ------------------------------ | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ----- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| Plugin system                  | Full plugin manifest with semver, requires, conflicts, topological sort | Lighter library dependency declarations first; full plugin system is premature before the dependency graph is clean                               |
| Service extraction             | 4 named services (Context, Factory, Registry, Execution)                | Same split targets, but start with file extraction before introducing service interfaces. Interfaces before implementation risks over-engineering |
| Circular deps                  | Policy + tooling + incremental fix                                      | **Method extraction first** — move cyclic methods to free functions, which immediately breaks cycles without new abstractions                     |
| BoxedExpression                | Role interfaces, remove methods from base                               | Keep methods on base initially, add type guards as narrowing. Remove later. Avoids big-bang migration                                             |
| Event stream for observability | Proposed                                                                | Not recommended yet. Debug/trace is useful but an event bus adds coupling. Start with structured logging                                          |
| API form option                | `form: 'canonical' \| 'structural' \| 'raw' \| CanonicalForm[]`         | Agree. Keep `CanonicalForm[]` as an advanced option for power users who need granular control over canonicalization passes                         |

### Additions (not in `REFACTOR.md`)

- **Simplification rules should be user-extensible** (§3.6)
- **LaTeX parser should be split** (§3.7) — with the caveat that LaTeX parsing
  is inherently tricky and ill-suited to traditional parsing techniques. A
  tokenizer extraction is reasonable, but the parser itself should not be
  over-decomposed.
- **Null vs undefined inconsistency** needs standardization (§4.3)
- **Free-function pattern** for tree-shakeability and cycle breaking (§3.2)

---

## 7. Prioritized Action Plan

### Phase 0: Foundations (1-2 weeks)

These are non-controversial, low-risk changes that improve the codebase
immediately.

1. **Add circular dependency detection to CI**
   - Install `madge`, run `madge --circular --extensions ts src/compute-engine`
   - Record baseline, fail CI if count increases
   - Note: beyond the 6 dynamic-import workarounds documented in §3.2, there
     are additional static circular dependencies in the codebase. The baseline
     will likely be significant, and the initial goal is visibility and
     preventing regression, not immediate elimination.

2. **Fix Monte Carlo improper integral scaling**
   - As described in `REFACTOR.md` §Critical Fix Detail
   - Add tests for `∫_0^∞ e^{-x} dx`, `∫_{-∞}^{∞} e^{-x²} dx`, `∫_0^1 x² dx`

3. **Clean up repository hygiene**
   - Remove `.DS_Store`, `*.bak` files
   - Add to `.gitignore`
   - (`docs/` is a local alias for a separate website/prose project and is
     correctly gitignored — no action needed there)

4. **Standardize example imports**
   - All examples use package-name imports
   - Add `examples/README.md` with setup instructions

### Phase 1: API Clarity (2-4 weeks)

5. **Unify expression creation** ✅ DONE
   - New `FormOption` type: `'canonical' | 'structural' | 'raw' | CanonicalForm | CanonicalForm[]`
   - `ce.box()`, `ce.function()`, `ce.parse()` accept `{ form?: FormOption }`
     replacing `{ canonical?, structural? }`
   - Internal `formToInternal()` helper translates to legacy `{ canonical, structural }`
     for `BoxedFunction` constructor and `ce._fn()` (unchanged internal API)
   - `CanonicalOptions` type kept for internal use; `FormOption` is the public type
   - Updated ~48 source call sites + ~43 test call sites

6. **Standardize null/undefined** ✅ DONE
   - 5 properties changed from `null` to `undefined`: `.symbol`, `.string`,
     `.ops`, `.tensor`, `.numericValue`
   - `.re`/`.im` kept as `NaN` (typed `number`, correct sentinel)
   - `.shape` kept as `[]` (correct for scalar = zero-dimensional tensor)
   - Updated ~49 explicit null checks across ~20 files + tests

7. **Add subpath exports** ✅ DONE
   - Added `./math-json` subpath export to `package.json`
   - `./types` not needed: TypeScript resolves types from the `"types"` condition
     in each export entry; users can use `import type { ... }` from main path

8. **Split compile return type** ✅ DONE
   - New `CompilationResult` interface: `{ target, success, code, run? }`
   - Removed `CompiledExecutable` interface
   - Renamed `compileToExecutable` → `compile` on `LanguageTarget` interface
     and all 5 targets (JS, GLSL, Python, Interval-JS, Interval-GLSL)
   - Updated free `compile()` function, `ce._compile()`, and 6 internal callers
   - Updated 219 compile tests across 7 test files

### Phase 2: Dependency Health (3-5 weeks)

10. **Extract cyclic methods to free functions** ✅ DONE
    - `expand(expr)` instead of `expr.expand()` — done, exported from package
    - `compile(expr, options)` instead of `expr.compile()` — done, exported from package
    - `getInequalityBoundsFromAssumptions` extracted to `inequality-bounds.ts`
    - Eliminated 4 of 7 dynamic `require()` calls (serializeJson deferred,
      2 new dynamic requires needed for expand-in-compare and compile-in-collections
      due to unavoidable cycle chains)
    - Cycle count after extraction: 24 (one pre-existing `arithmetic-add ↔ terms`
      cycle surfaced). After item 11 (file splits): 43 — the increase is from
      type-only `import type` cycles between split type files + pre-existing
      latex-syntax internal cycles now separately enumerated by madge.

11. **Split monolithic files** ✅ DONE
    - `index.ts` (2745→1955 lines) → extracted `engine-sequences.ts` (129),
      `engine-assumptions.ts` (328), `engine-scope.ts` (270),
      `engine-declarations.ts` (404)
    - `global-types.ts` (3894→15 lines) → barrel re-exporting from 5 type files:
      `types-expression.ts` (1857, includes tensor/compilation types),
      `types-definitions.ts` (1008), `types-engine.ts` (539),
      `types-evaluation.ts` (308), `types-serialization.ts` (255).
      `types-tensor.ts` is a re-export shim (merged into types-expression).
      All 105+ existing imports from `global-types` continue to work unchanged.
    - `parse.ts` (2684→2309 lines) → extracted `parse-number.ts` (437) with
      `parseNumber()`, `parseRepeatingDecimal()` + helpers as standalone functions
      taking `Parser` interface + `NumberFormatTokens` config
    - Cycle budget: 24→43 (type-only cycles from the split + pre-existing
      latex-syntax internal cycles now separately enumerated by madge)

12. **Enforce layered dependencies** ✅ DONE
    - Added 24 new zones to `import/no-restricted-paths` in `.eslintrc.cjs`
      covering `numerics/`, `numeric-value/`, `tensor/`, `interval/`, and
      `types-*.ts` files (total 35 zones, up from 11)
    - Full layer hierarchy documented in ESLint config comment block
    - Added `check:deps` npm script (`madge --circular`)
    - Fixed one violation: moved `BigNumFactory` type from `numeric-value/types`
      to `numerics/types` (correct layer) with re-export for backward compat
    - Verified: 0 ESLint errors, 8 type-only madge cycles (unchanged), 11
      pre-existing TS errors (unchanged)

13. **Add type guards for BoxedExpression roles** ✅ DONE
    - `type-guards.ts` with 7 guards: `isNumericExpression`, `isSymbolExpression`,
      `isFunctionExpression`, `isStringExpression`, `isCollectionExpression`,
      `isTensorExpression`, `isDictionaryExpression`
    - Exported from `compute-engine.ts`, 19 tests in `type-guards.test.ts`

### Phase 3: Extensibility + Zero Cycles

14. **Make library dependencies explicit** ✅ DONE
    - `LibraryDefinition` type in `types-definitions.ts`; `STANDARD_LIBRARIES`
      array in `library/library.ts` with topological sort
    - LaTeX dictionaries bundled into library defs; `DEFAULT_LATEX_DICTIONARY`
      removed from `definitions.ts`
    - Constructor supports `libraries` option (string names or custom
      `LibraryDefinition` objects)
    - `LibraryCategory` pruned from 24→15 members (removed empty categories:
      algebra, dimensions, domains, numeric, units, data-structures, complex,
      styling, symbols, sets)
    - Cycle budget 43→29 (removed latex-syntax ↔ library cycles by eliminating
      `DEFAULT_LATEX_DICTIONARY` re-exports)

15. **Eliminate runtime circular dependencies** ✅ DONE (29→8, all remaining type-only)
    - Extracted `pattern-utils.ts` (wildcard functions from boxed-patterns)
    - Merged `Terms` into `arithmetic-add.ts`, `Product` into `arithmetic-mul-div.ts`
    - Moved `expandProduct`/`expandProducts` into `arithmetic-mul-div.ts`
    - Extracted `polynomial-degree.ts` (totalDegree, maxDegree, lex, revlex)
    - Decoupled `tensor-fields.ts` from arithmetic imports (use instance methods)
    - Broke `negate→arithmetic-add` cycle (use `ce._fn('Add', ...)` directly)
    - Broke all 5 `common/type/` cycles: moved `isValidType` to primitive.ts,
      lazy `parseType` in subtype.ts, replaced `isSubtype` in serialize.ts
    - 8 remaining cycles are all `import type` (type-only, benign, no runtime impact)
    - See `ZERO-CYCLES-PLAN.md` for full details

16. **Add user-extensible simplification rules** ✅ DONE
    - `ce.simplificationRules` mutable array (getter/setter) on ComputeEngine
    - Initialized to copy of `SIMPLIFY_RULES`; users can `push()` or replace
    - Cache invalidation via length check (catches push) + setter (catches assignment)
    - Rules participate in standard simplification pipeline via `getRuleSet()`
    - Per-call `expr.simplify({ rules })` override still works
    - 10 tests in `simplify-rules.test.ts`

17. **Generalize compilation target registration** ✅ DONE
    - `registerCompilationTarget()` / `unregisterCompilationTarget()` API
    - Custom targets implement `LanguageTarget` interface
    - Target discovery via `getCompilationTargets()`

### Phase 4: Type System Hardening (ongoing)

18. **Role interfaces alongside BoxedExpression**
    - `INumeric`, `ICollection`, `ICallable`
    - Concrete classes implement applicable interfaces
    - Type guards narrow `BoxedExpression` to role interfaces
    - Enabled by Phase 3 cycle-breaking: base class no longer imports
      arithmetic/compare modules

19. **Deprecate then remove base-class stubs**
    - Properties like `.re`, `.im`, `.size` on non-applicable types get
      deprecation warnings
    - After migration period, remove from base interface

20. **Strengthen type inference**
    - Automatic widening (integer → rational → real → complex)
    - Constraint propagation through function signatures
    - Domain-aware solve validation

---

## 8. What Not To Do

Certain directions from `REFACTOR.md` are premature or over-engineered for the
current state of the project:

1. **Do not introduce a full plugin manifest system yet.** Semver dependency
   resolution, capability-provides declarations, and conflict detection are
   enterprise patterns that add significant complexity. The library system needs
   explicit dependencies and topological loading first. A full plugin system can
   follow once the internal architecture is clean enough to support it without
   the plugin framework becoming a workaround for structural issues.

2. **Do not introduce an event bus for observability.** Structured logging and a
   simple trace callback are sufficient. Event systems create implicit coupling
   that is hard to reason about and debug.

3. **Do not attempt to compete with Mathematica/SymPy on solver breadth.** The
   numeric fallback solver (bisection, Brent) from `REFACTOR.md` Phase 3 is a good
   idea, but keep the scope to common undergraduate-level equations. The
   library's strength is web integration, not solver completeness.

4. **Do not split into multiple npm packages.** Subpath exports give downstream
   consumers what they need without the maintenance overhead of a monorepo. A
   single package with clear entry points is the right model.

---

## 9. Success Criteria

After implementing through Phase 3:

1. `madge --circular` reports zero cycles in `src/compute-engine`.
2. A new mathematical function can be added by creating one file (library
   definition) with no changes to core engine files.
3. A new compilation target can be added by implementing `CompileTarget` and
   calling `registerCompilationTarget()` with no other changes.
4. `BoxedExpression` interface members that do not apply to a given expression
   type are flagged by TypeScript when accessed without a type guard.
5. All examples and documentation use consistent package-name imports.
6. No dynamic `require()` calls remain in `src/compute-engine`.
7. Custom simplification rules can be registered and participate in the standard
   pipeline.

---

## 10. Conclusion

This codebase has the hardest part already done: a working symbolic math engine
with real algebraic capabilities, multiple output targets, and a solid test
suite. The work ahead is architectural, not algorithmic.

The highest-leverage changes are:

1. **Break the cycles** by extracting methods to free functions.
2. **Simplify the creation API** to one method with one form parameter.
3. **Split the monolithic files** so dependencies become visible and
   enforceable.
4. **Make libraries and rules extensible** with explicit dependency
   declarations.

These changes align the code structure with the project's stated goals of
modularity and extensibility, while preserving the mathematical core that
already works well.
