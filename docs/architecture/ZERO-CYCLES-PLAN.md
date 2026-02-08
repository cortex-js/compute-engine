# Plan: Zero Circular Dependencies

Date: 2026-02-07
Current state: 29 cycles, 9 dynamic `require()` calls
Target: 0 cycles, 0 dynamic `require()`

---

## Cycle Inventory

The 29 cycles fall into 4 clusters. Each is addressed by a dedicated phase
below.

### Cluster A — `common/type/` internals (5 cycles, madge #1-5)

```
parse → serialize → subtype → utils → parse   (full loop)
```

All 5 are permutations of this diamond: `parse`, `serialize`, `subtype`, and
`utils` each import from 2-3 of the others.

### Cluster B — Type-file cross-references (10 cycles, madge #6-15)

```
types-definitions ↔ types-engine ↔ types-evaluation ↔ types-expression ↔ types-serialization
latex-syntax/types → types.ts → global-types → types-definitions → latex-syntax/types
latex-syntax/types ↔ definitions.ts
```

All are `import type` only — zero runtime impact. They exist because the split
type files naturally reference each other (e.g. `ComputeEngine` uses
`BoxedExpression` uses `Rule` uses `ComputeEngine`), and because `types.ts` is
a barrel that re-exports both `latex-syntax/types` and `global-types`.

### Cluster C — `boxed-expression/` arithmetic core (11 cycles, madge #16-25, 29)

The dependency web, showing the edges that close each loop:

```
abstract-boxed-expression ──→ compare ──→ tensor/tensors ──→ tensor/tensor-fields
        ↑                                                            │
        │                                                    ┌──────┘
        │                                                    ↓
   boxed-tensor ←── arithmetic-add ←── tensor-fields imports add(), mul()
        │                │                                    │
        │                ↓                                    ↓
        │             terms ──→ arithmetic-add          arithmetic-mul-div
        │                                                    │
        │                                                    ↓
        │                                               product ──→ arithmetic-mul-div
        │                                                    │
        ↑                                                    ↓
   utils ←── apply ←── arithmetic-power ←── order ←── negate ──→ arithmetic-add
     │                                         │
     ↓                                         ↓
  boxed-operator-definition              polynomials ──→ arithmetic-add
     │
     ↓
  function-utils ──→ compare
```

Critical cycle-closing edges (break ANY one per loop to eliminate it):

| Edge | Breaks cycles |
|------|---------------|
| `tensor-fields → arithmetic-{add,mul-div}` | 16-19, 22-24 (7 cycles) |
| `utils → abstract-boxed-expression` | 19, 22 |
| `boxed-operator-definition → order` (DEFAULT_COMPLEXITY) | 20 |
| `function-utils → compare` (cmp) | 21 |
| `boxed-value-definition → abstract-boxed-expression` | 22 |
| `product → arithmetic-mul-div` (mul, canonicalDivide) | 25 |
| `terms → arithmetic-add` (canonicalAdd) | 29 |
| `polynomials → arithmetic-add` (add) | 23, 24 |

### Cluster D — Pattern matching & assumptions (3 cycles, madge #26-28)

```
assume → solve → expand → arithmetic-add → boxed-tensor → boxed-patterns → boxed-symbol
                                                                                  ↕
                                                                                match
```

Cycle-closing edges:

| Edge | Breaks cycles |
|------|---------------|
| `assume → solve` (findUnivariateRoots) | 26 |
| `boxed-tensor → boxed-patterns` (isWildcard, wildcardName) | 26, 27 |
| `boxed-symbol → match` | 28 |
| `boxed-patterns → boxed-symbol` (type import) | 28 |

---

## Phase 1: Type-only cycles (Clusters A + B) — 15 cycles → 0

These are the easiest: no runtime behavior changes, no API changes.

### 1a. Restructure `common/type/` (eliminates 5 cycles)

The 4 files form a diamond because they share low-level helpers. Strategy:
extract shared primitives into a leaf module.

**Create `common/type/type-utils-base.ts`** containing:
- `isValidType()` (currently in `utils.ts`)
- `widen()` (currently in `utils.ts`)
- Any small predicates that `serialize`, `subtype`, and `parse` all need

Then restructure the dependency direction:
```
type-utils-base.ts   (leaf — no imports from siblings)
      ↑
  ┌───┴────┐
  ↓        ↓
parse   serialize   (import from base only, not from each other)
  ↓        ↓
  └───┬────┘
      ↓
   subtype          (imports from serialize — one direction only)
      ↓
    utils            (imports from subtype and parse — no back-edges)
```

The specific problematic imports to eliminate:
- `serialize.ts` currently imports `isSubtype` from `subtype.ts`. Move the
  string representation of subtype relationships to `type-utils-base.ts` or
  inline the check.
- `subtype.ts` imports `typeToString` from `serialize.ts` (only for error
  messages). Pass it as a parameter or use a deferred/lazy import.
- `subtype.ts` imports `parseType` from `parse.ts`. This is for parsing type
  strings in subtype checks. Pass the parsed type as a parameter instead.
- `utils.ts` imports from both `parse` and `subtype`. This is fine as long as
  `parse` and `subtype` don't import from `utils`. Extract what they need to
  the base module.

### 1b. Eliminate `types.ts` barrel cycle (eliminates cycles #7-8)

`src/compute-engine/types.ts` is a public-facing barrel that re-exports from
`latex-syntax/types` (line 9) AND from `global-types` (line 20). Since
`global-types → types-definitions → latex-syntax/types`, and `latex-syntax/types`
imports from `types.ts`, this creates a cycle.

**Fix**: Make `latex-syntax/types.ts` import directly from the source modules
(`common/type/types`, `common/type/boxed-type`) instead of from the barrel
`../types`. This is a one-line change:

```diff
-import { BoxedType, Type, TypeString } from '../types';
+import type { Type, TypeString } from '../../common/type/types';
+import type { BoxedType } from '../../common/type/boxed-type';
```

Then audit the other 26 files that import from `./types` — if any are within
`compute-engine/` internals and create cycles, switch them to direct imports
too. The `types.ts` barrel remains for external consumers.

### 1c. Break type-file cross-references (eliminates cycles #9-15)

These 7 cycles are all between the split `types-*.ts` files. Every one is
`import type` only. Two strategies (choose one):

**Option A: Shared base types file.** Create `types-base.ts` containing the
handful of types that everyone needs (forward-declared interfaces for
`BoxedExpression`, `ComputeEngine`, `Scope`, etc. as opaque type references).
The other type files import from `types-base` instead of from each other. This
is architecturally cleanest but requires careful extraction.

**Option B: Re-merge into fewer files.** The 5-way split was done for
readability but created cross-reference cycles. Merge back to 2-3 files:
- `types-core.ts` — expression + serialization + definitions (these are
  tightly coupled: expressions reference definitions and vice versa)
- `types-engine.ts` — engine + evaluation + scope (these form a natural group)

This reduces the number of cross-reference edges below the cycle threshold.

**Option C: Tell madge to skip `import type`.** Add `--ts-config` with a
custom config that treats type imports as non-cyclic. This is the least work
but doesn't actually improve architecture — it just hides the cycles from
tooling. **Not recommended as a standalone fix**, but could be combined with
other improvements.

**Recommended: Option A or B.** Option B is simpler. The 5-way split was
valuable for navigability, but the resulting cross-references show these types
are too coupled to live in 5 separate files.

### 1d. Break `latex-syntax/types ↔ definitions` (eliminates cycle #6)

`latex-syntax/types.ts` imports `IndexedLatexDictionary` and
`IndexedLatexDictionaryEntry` from `definitions.ts`. `definitions.ts` imports
many types from `types.ts`. The fix: move the `IndexedLatexDictionary` type
and `IndexedLatexDictionaryEntry` type (which are type definitions, not
runtime) into `types.ts`. Then `definitions.ts` imports from `types.ts` only
(one direction).

---

## Phase 2: Tensor field decoupling (Cluster C core) — 7 cycles → 0

This is the highest-leverage single change. `tensor-fields.ts` imports `add`
and `mul` from the arithmetic modules, but `arithmetic-add` imports from
`boxed-tensor`, which imports from `tensor/tensors`, which imports from
`tensor-fields`. Breaking the `tensor-fields → arithmetic` edge eliminates
7 of the 11 Cluster C cycles.

### 2a. Make tensor field operations injectable

Currently, `tensor-fields.ts` defines field operations (addition,
multiplication, negation) for tensors by importing concrete `add()` and `mul()`
functions:

```ts
// tensor-fields.ts — CURRENT
import { mul } from '../boxed-expression/arithmetic-mul-div';
import { add } from '../boxed-expression/arithmetic-add';
```

**Refactor**: Define a `TensorFieldOps` interface and have the tensor system
receive operations through it rather than importing them directly.

```ts
// tensor/tensor-field-ops.ts (NEW — leaf module, no imports from boxed-expression/)
export interface TensorFieldOps {
  add(a: BoxedExpression, b: BoxedExpression): BoxedExpression;
  mul(a: BoxedExpression, b: BoxedExpression): BoxedExpression;
  neg(a: BoxedExpression): BoxedExpression;
  zero(engine: ComputeEngine): BoxedExpression;
  one(engine: ComputeEngine): BoxedExpression;
}
```

```ts
// tensor-fields.ts — AFTER (no more arithmetic imports)
import type { TensorFieldOps } from './tensor-field-ops';

export function makeTensorField(engine: ComputeEngine, ops: TensorFieldOps): TensorField { ... }
```

```ts
// boxed-tensor.ts — AFTER (provides the ops when constructing tensors)
import { add } from './arithmetic-add';
import { mul } from './arithmetic-mul-div';
import { makeTensorField } from '../tensor/tensor-fields';

const ops: TensorFieldOps = { add, mul, neg: negate, zero: (e) => e.Zero, one: (e) => e.One };
const field = makeTensorField(engine, ops);
```

This makes `tensor/` a self-contained module that knows nothing about the
boxed-expression arithmetic system. The wiring happens at the call site
(`boxed-tensor.ts`), which already depends on both modules anyway.

---

## Phase 3: Base class decoupling + role interfaces — remaining Cluster C cycles

This phase combines the boxed-expression-refactor.md approach with further
free-function extraction. The goal: `abstract-boxed-expression.ts` should
be a leaf module that nothing in `boxed-expression/` needs to import from
(except to extend the class), and that imports from nothing in
`boxed-expression/` (except leaf utilities).

### 3a. Move `DEFAULT_COMPLEXITY` to a constants file (eliminates cycle #20)

`boxed-operator-definition.ts` imports `DEFAULT_COMPLEXITY` from `order.ts`.
`order.ts` imports from `arithmetic-power`, which imports from `apply`, which
imports from `utils`, which imports from `boxed-operator-definition`.

**Fix**: Create `boxed-expression/constants.ts` (leaf module) and move
`DEFAULT_COMPLEXITY` there. Both `order.ts` and `boxed-operator-definition.ts`
import from the leaf.

### 3b. Break `utils → abstract-boxed-expression` (eliminates cycle #19)

`utils.ts` imports `_BoxedExpression` for `instanceof` checks
(`isBoxedExpression()`). This creates a cycle because the chain
`abstract-boxed-expression → compare → ... → utils` closes back.

**Fix**: Replace the `instanceof _BoxedExpression` check with a tag-based
check. Add a `Symbol` tag to the base class:

```ts
// abstract-boxed-expression.ts
export const BOXED_EXPRESSION_TAG = Symbol('BoxedExpression');

export abstract class _BoxedExpression {
  readonly [BOXED_EXPRESSION_TAG] = true;
  // ...
}
```

```ts
// utils.ts — AFTER (no import from abstract-boxed-expression)
import { BOXED_EXPRESSION_TAG } from './constants'; // or inline the symbol

export function isBoxedExpression(x: unknown): x is BoxedExpression {
  return x !== null && typeof x === 'object' && BOXED_EXPRESSION_TAG in x;
}
```

### 3c. Break `boxed-value-definition → abstract-boxed-expression` (eliminates cycle #22)

Same pattern — `boxed-value-definition.ts` likely uses `_BoxedExpression` for
an `instanceof` check or as a base class reference. If it's an `instanceof`
check, use the tag approach from 3b. If it extends the class, this is a
natural dependency and the cycle must be broken elsewhere in the chain.

### 3d. Break `function-utils → compare` (eliminates cycle #21)

`function-utils.ts` imports `cmp` from `compare.ts`. `compare.ts` is deep in
the cycle chain. The `cmp` function is likely used for argument sorting.

**Fix**: Extract a minimal comparison function (or the specific comparator
`function-utils` needs) to a leaf module `boxed-expression/compare-utils.ts`
that both `function-utils` and `compare` can import from. Alternatively, pass
the comparator as a parameter.

### 3e. Extract `compare` from base class to free functions (reduces chain depth)

`abstract-boxed-expression.ts` currently imports `{ cmp, eq, same }` from
`compare.ts`. This is the root of most Cluster C chains.

Phase A of boxed-expression-refactor.md proposes keeping methods on the base
class while adding role interfaces alongside. But for cycle-breaking, we need
to go further: **remove `cmp`/`eq` from the base class entirely** and make
them free functions (or methods on a `Comparable` role interface).

```ts
// compare.ts — stays as-is, but is no longer imported by abstract-boxed-expression
export function eq(a: BoxedExpression, b: BoxedExpression): boolean { ... }
export function cmp(a: BoxedExpression, b: BoxedExpression): number { ... }
```

Internal callers change from `expr.isEqual(other)` to `eq(expr, other)`.
This is a breaking change for the public API if `.isEqual()` is public, but
the plan says backward compatibility is not a constraint.

**Alternatively**, if keeping `.isEqual()` on the public API is desired,
implement it via late binding:

```ts
// abstract-boxed-expression.ts — NO import from compare.ts
abstract class _BoxedExpression {
  isEqual(other: BoxedExpression): boolean {
    // Late-bound via engine registry
    return this.engine._eq(this, other);
  }
}
```

Where `engine._eq` is set during initialization to point to the `eq` function
from `compare.ts`. This breaks the static import cycle.

### 3f. Merge `terms` into `arithmetic-add` (eliminates cycle #29)

`terms.ts` imports `canonicalAdd` from `arithmetic-add.ts`.
`arithmetic-add.ts` imports `Terms` from `terms.ts`.

These are tightly coupled — `Terms` is the internal data structure that
`arithmetic-add` uses to accumulate addends. They should be in the same file.
Merge `terms.ts` into `arithmetic-add.ts`.

### 3g. Merge `product` into `arithmetic-mul-div` (eliminates cycle #25)

Same pattern: `product.ts` imports `mul`, `canonicalDivide` from
`arithmetic-mul-div.ts`. `arithmetic-mul-div.ts` imports `Product` from
`product.ts`. Merge `product.ts` into `arithmetic-mul-div.ts`.

### 3h. Break `polynomials → arithmetic-add` (eliminates cycles #23-24)

`polynomials.ts` imports `add` from `arithmetic-add.ts`, and `expand` from
`expand.ts`. Since `arithmetic-add → boxed-tensor → abstract-boxed-expression →
compare → ... → order → polynomials`, this creates a cycle.

**Fix**: The polynomial functions should receive arithmetic operations as
parameters rather than importing them. This follows the same dependency
injection pattern as Phase 2a:

```ts
// BEFORE
import { add } from './arithmetic-add';
export function polynomialAdd(...) { ... add(a, b) ... }

// AFTER — caller provides the add function
export function polynomialAdd(..., addFn: (a, b) => BoxedExpression) { ... addFn(a, b) ... }
```

Alternatively, if the polynomial functions are only called from contexts that
already have access to `add`, consider colocating them with their callers.

### 3i. Eliminate remaining dynamic `require()` calls

After the static cycle breaks above, convert the remaining dynamic requires
to static imports:

| File | Dynamic require | Fix |
|------|----------------|-----|
| `abstract-boxed-expression.ts` | `require('./serialize')` | After 3e removes compare import, the chain `abstract → serialize → product → arithmetic` may still cycle. Apply same late-binding pattern via engine. |
| `compare.ts` | `require('./expand')` | After Phase 2 breaks tensor chain, check if the static import is now safe. If not, pass `expand` as a parameter to the comparison function that needs it. |
| `serialize.ts` | `require('./product')` | After 3g merges product into arithmetic-mul-div, update the import path. Check if cycle is broken. |
| `compilation/*.ts` (6 calls) | `require('./base-compiler')` | These are in compilation targets that import BaseCompiler lazily. Should be fixable by restructuring compilation module imports. |

---

## Phase 4: Pattern matching & assumptions (Cluster D) — 3 cycles → 0

### 4a. Break `boxed-tensor → boxed-patterns` (eliminates cycles #26-27)

`boxed-tensor.ts` imports `isWildcard` and `wildcardName` from
`boxed-patterns.ts`. These are simple predicate functions that check if an
expression is a pattern wildcard.

**Fix**: Move `isWildcard()` and `wildcardName()` to a leaf utility
(e.g. `pattern-utils.ts` or `constants.ts`). These functions likely just check
if a symbol name starts with `_` — they don't need the rest of the pattern
matching machinery.

### 4b. Break `boxed-patterns ↔ boxed-symbol` (eliminates cycle #28)

`boxed-patterns.ts` has an `import type { BoxedSymbol }` from
`boxed-symbol.ts`. `boxed-symbol.ts` imports `match` from `match.ts`, and
`match.ts` imports from `boxed-patterns.ts`.

**Fix**: The `import type` in `boxed-patterns.ts` may be avoidable if the
type is only used for a type annotation that can use `BoxedExpression` instead.
Alternatively, move the `match` import in `boxed-symbol.ts` to use late
binding (same pattern as 3e) or extract the match function to not import from
boxed-patterns (using the utilities moved to `pattern-utils.ts` in 4a).

### 4c. Break `assume → solve` (eliminates cycle #26 fully)

`assume.ts` imports `findUnivariateRoots` from `solve.ts`, which creates a
long chain back through `expand → arithmetic-add → boxed-tensor →
boxed-patterns → boxed-symbol → assume` (via `getSignFromAssumptions`).

After 4a and 4b break the `boxed-tensor → boxed-patterns` and `boxed-symbol`
links, this cycle may already be eliminated. If not:

**Fix**: The assumption system should not directly call the solver. Instead,
make the "check if assumption is satisfiable" logic injectable — the engine
provides the solver function to the assumption system during initialization.

---

## Phase 5: Compilation module cleanup — dynamic requires only

The 6 dynamic `require('./base-compiler')` calls in `compilation/*.ts` are
not detected by madge as circular (they're dynamic), but they should be
converted to static imports for code quality.

**Fix**: The compilation targets likely have a cycle through
`base-compiler → library/utils → collections → compilation`. Since `compile()`
was already extracted to a free function (PLAN.md item 10), verify that the
cycle is actually broken and convert to static imports. If a residual cycle
exists, apply the same dependency injection pattern.

---

## Sequencing and Dependencies

```
Phase 1 (types)       ← independent, can start immediately
Phase 2 (tensors)     ← independent, can start immediately
Phase 3a-d (leaves)   ← independent, can start immediately
Phase 3e (compare)    ← after Phase 2 (to verify chain is broken)
Phase 3f-g (merges)   ← independent
Phase 3h (polynomials)← after Phase 2
Phase 3i (requires)   ← after Phases 2, 3e-h
Phase 4               ← after Phase 3f (arithmetic-add merge)
Phase 5               ← after Phase 3i
```

Phases 1, 2, and 3a-d can run in parallel. The critical path is:
**Phase 2 → Phase 3e → Phase 3i → Phase 5**

---

## Expected Cycle Elimination Per Phase

| Phase | Cycles eliminated | Running total |
|-------|-------------------|---------------|
| Current | — | 29 |
| 1a (common/type) | 5 | 24 |
| 1b (types.ts barrel) | 2 | 22 |
| 1c (type file merge) | 7 | 15 |
| 1d (latex types) | 1 | 14 |
| 2a (tensor fields) | 7 | 7 |
| 3a (DEFAULT_COMPLEXITY) | 1 | 6 |
| 3b-c (utils/value-def tags) | 2 | 4 |
| 3d (function-utils) | 1 | 3 |
| 3f-g (merge terms/product) | 2 | 1 |
| 3h (polynomials) | 1-2 | 0 |
| 3e + 4 (compare + patterns) | remaining | 0 |

Note: cycle counts are approximate since breaking one edge can eliminate
multiple overlapping cycles.

---

## Relationship to boxed-expression-refactor.md

This plan incorporates Phase A of the refactor (role interfaces and type
guards) as part of Phase 3e. The key insight is that **extracting compare/eq
from the base class is both a cycle-breaking move and the first step of the
role-interface migration**. Once comparison is no longer on the base class,
adding `IComparable` as a role interface is natural.

The full Phase B/C of the refactor (migrating all callers, removing stubs)
can proceed after zero cycles is achieved. The cycle-breaking work creates
the architectural preconditions for the refactor to succeed without
reintroducing cycles.

Specific overlaps:

| Refactor proposal | This plan | Phase |
|-------------------|-----------|-------|
| Add INumeric interface | Enabled by 3e (base class no longer imports arithmetic) | After Phase 3 |
| Add ICollection interface | Enabled by 3b (utils decoupled from base) | After Phase 3 |
| Type guards (isNumeric, etc.) | Already done (PLAN.md item 13) | Done |
| Move arithmetic off base class | 3e extracts compare; arithmetic methods follow same pattern | Phase 3 |
| valueOf/toPrimitive on base only | Natural consequence of removing role methods | After Phase 3 |

---

## Dynamic `require()` Elimination Summary

| Current location | Strategy | Phase |
|-----------------|----------|-------|
| `abstract-boxed-expression → serialize` | Late-bind via engine | 3i |
| `compare → expand` | Static import after tensor decoupling | 3i |
| `serialize → product` | Static import after product merge | 3i |
| `compilation/glsl-target → base-compiler` (3x) | Static import after compilation restructure | 5 |
| `compilation/python-target → base-compiler` (3x) | Static import after compilation restructure | 5 |

---

## Verification After Each Phase

After every phase:
1. `npm run typecheck` — must pass
2. `npx madge --circular --extensions ts src/compute-engine` — count must
   decrease or stay same
3. `npx jest --config ./config/jest.config.cjs -- test/compute-engine/` — all
   tests pass
4. Update `MAX_CYCLES` in `scripts/typecheck.sh` to lock in progress

Final target: `MAX_CYCLES=0`
