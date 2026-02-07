# BoxedExpression Type-System Refactor (Detailed Proposal)

> Status (2026-02-07)
> - This is a focused sub-proposal for boxed-expression internals.
> - It is still useful, but partially superseded by the broader roadmap in
>   `REFACTOR.md` and `PLAN.md`.
> - Use this document during Phase 2/4 implementation work on internal
>   type-system hardening.
> - See `PLAN.md` §3.1 for sequencing and phased migration strategy.

---

# Refactoring `BoxedExpression`: A Guide to a More Robust Type System

## 1. Motivation: The "God Object" Problem

The current `_BoxedExpression` abstract class serves as a unified interface for
all mathematical expressions. While this provides a convenient, polymorphic API,
it has become a "God Object," leading to several significant issues:

- **Logical Errors are Hidden:** Calling a non-applicable method (e.g., `add()`
  on a `BoxedString`) fails silently by returning `NaN` or `null`. This is a
  runtime issue that can poison subsequent calculations and is difficult to
  debug.
- **Poor Encapsulation:** The base class is bloated with dozens of methods, most
  of which are meaningless for many of its subclasses. This violates the
  Interface Segregation Principle.
- **Reduced Maintainability:** Adding a new type of expression or a new
  capability requires modifying the large base class, increasing the risk of
  introducing bugs.
- **Lack of Compile-Time Safety:** TypeScript cannot prevent developers from
  making logical errors (like adding a string to a number) because the base
  interface claims all expressions support all operations.

### The Solution: A Hybrid Approach

This guide outlines a refactoring strategy to address these issues by adopting a
more robust, type-safe internal architecture while preserving a convenient,
JavaScript-friendly public API.

The new architecture is based on three core concepts:

1.  **Role Interfaces (`INumeric`, `ICollection`):** Define what an expression
    _can do_ rather than what it _is_.
2.  **Standalone Type Guards (`isNumeric()`):** Act as the bridge between the
    object-oriented model and TypeScript's static type system, enabling
    compile-time safety.
3.  **JavaScript Coercion Methods (`valueOf`, `[Symbol.toPrimitive]`):** Provide
    a convenient facade for external users to seamlessly integrate boxed
    expressions with standard JavaScript operations.

## 2. Migration Strategy: Three Phases

This refactor must be executed incrementally. A big-bang removal of members from
the base class would require simultaneous changes to 150+ internal call sites
and is not practical.

### Phase A: Add interfaces and guards alongside existing base class

- Define role interfaces (`INumeric`, `ICollection`, etc.)
- Create type guards (`isNumeric()`, `isCollection()`)
- Add `implements` clauses to concrete classes (`BoxedNumber`, `BoxedList`)
- **Do not remove anything from `_BoxedExpression` or `BoxedExpression`**
- Internal code can start using guards opportunistically

At this point both patterns work:
```ts
// Old pattern (still compiles)
const re = expr.re;

// New pattern (type-safe)
if (isNumeric(expr)) {
  const re = expr.re; // narrowed to INumeric
}
```

### Phase B: Migrate internal callers, enforce with lint

- Add a lint rule or TypeScript diagnostic that flags unguarded access to
  role-specific members on `BoxedExpression`
- Migrate internal code file-by-file to use guards
- Add deprecation warnings to base-class stubs (runtime `console.warn` in
  development builds, stripped in production)
- Track progress: count of unguarded call sites should monotonically decrease

### Phase C: Remove stubs from base class

- Remove role-specific members from `BoxedExpression` interface and
  `_BoxedExpression` base class
- All access now requires guards — TypeScript enforces this at compile time
- This is the target state described in §3 below

## 3. Target Architecture

### 3.1 Role Interfaces

Create new interface files that define the contracts for different expression
capabilities.

**`src/compute-engine/boxed-expression/numeric-interface.ts`**

```ts
import type { BoxedExpression } from '../global-types';

export interface INumeric extends BoxedExpression {
  // --- Properties ---
  readonly re: number;
  readonly im: number;
  readonly sgn: Sign | undefined;
  readonly isZero: boolean;
  readonly isNegative: boolean | undefined;
  // ... add all other numeric properties (isInteger, isPositive, etc.)

  // --- Methods ---
  add(rhs: INumeric | number): INumeric;
  mul(rhs: INumeric | number): INumeric;
  div(rhs: INumeric | number): INumeric;
  pow(exp: INumeric | number): INumeric;
  neg(): INumeric;
  // ... add all other numeric methods (inv, sqrt, etc.)
}
```

**`src/compute-engine/boxed-expression/collection-interface.ts`**

```ts
import type { BoxedExpression } from '../global-types';

export interface ICollection extends BoxedExpression {
  // --- Properties ---
  readonly size: number;
  readonly isEmptyCollection: boolean;

  // --- Methods ---
  each(): Generator<BoxedExpression>;
  contains(rhs: BoxedExpression): boolean | undefined;
  // ... add other collection methods
}

export interface IOrderedCollection extends ICollection {
    at(index: number): BoxedExpression | undefined;
}
```

### 3.2 Type Guards

Create a utility file for type guards. These functions check if an expression
conforms to a specific role interface.

**`src/compute-engine/boxed-expression/guards.ts`**

```ts
import type { INumeric } from './numeric-interface';
import type { ICollection } from './collection-interface';
import type { BoxedExpression } from '../global-types';

/**
 * Checks if the expression behaves like a number.
 *
 * This covers:
 * - Number literals (BoxedNumber)
 * - Symbols with a numeric type or value
 * - Function expressions whose operator has a numeric return type
 *   (e.g., Add, Mul, Sin — structurally numeric even before evaluation)
 */
export function isNumeric(expr: BoxedExpression): expr is INumeric {
  // Check the type system first
  if (expr.type.matches('number')) return true;

  // For unevaluated function expressions, check if the operator's
  // return type is numeric. This handles cases like `Add(x, 1)` where
  // x has no declaration yet.
  if (expr.operator) {
    const def = expr.operatorDefinition;
    if (def?.signature) {
      // Check if the return type of the signature is numeric
      const returnType = expr.engine.type(def.signature).resultType;
      if (returnType?.matches('number')) return true;
    }
  }

  return false;
}

/**
 * Checks if the expression behaves like a collection.
 */
export function isCollection(expr: BoxedExpression): expr is ICollection {
  return expr.isCollection;
}

// Add other guards as needed (isSymbol, isString, etc.)
```

### 3.3 Concrete Class Updates

Modify concrete classes to implement the new interfaces.

**`BoxedNumber.ts`**

```ts
import { INumeric } from './numeric-interface';

// Add `implements INumeric`
export class BoxedNumber extends _BoxedExpression implements INumeric {
  // The implementations are already correct and stay here.
  get re(): number { /* ... */ }
  get im(): number { /* ... */ }
  add(rhs: INumeric | number): INumeric { /* ... */ }
  // ... etc.
}
```

**`BoxedSymbol.ts` — the hard case**

A symbol's role depends on its runtime value. `BoxedSymbol` should **not**
declare `implements INumeric` or `implements ICollection`, because that would
give TypeScript false confidence that every symbol is always numeric and always
a collection.

Instead, `BoxedSymbol` keeps the role-specific methods as concrete
implementations (they delegate to the symbol's value), but the **only way to
access them type-safely** is through the guards:

```ts
// BoxedSymbol does NOT declare `implements INumeric`
export class BoxedSymbol extends _BoxedExpression {

  // These methods exist on the class but are NOT on the BoxedExpression
  // interface. They are only accessible after a guard narrows the type.

  get re(): number {
    const val = this.value;
    if (val && isNumeric(val)) return val.re;
    return NaN;
  }

  add(rhs: INumeric | number): INumeric {
    const val = this.value;
    if (val && isNumeric(val)) return val.add(rhs);
    throw new TypeError(
      `Symbol "${this.symbol}" does not represent a numeric value.`
    );
  }
  // ... etc.
}
```

The guard `isNumeric(sym)` returns `true` when the symbol has a numeric type
(declared or inferred), which then narrows the type to `INumeric` and grants
access to `.re`, `.add()`, etc. This preserves the delegation pattern while
being honest about the runtime conditionality.

### 3.4 Base Class (Target State)

After Phase C, the base class retains only universal members:

```ts
export abstract class _BoxedExpression {
  // --- Universal properties ---
  readonly engine: ComputeEngine;
  readonly hash: number;
  readonly json: Expression;
  isSame(other: BoxedExpression): boolean;
  // ... toLatex, toJSON, simplify, evaluate, etc.

  // --- JavaScript Coercion (stays on base) ---
  valueOf(): number {
    if (isNumeric(this)) {
      return this.im !== 0 ? NaN : this.re;
    }
    return NaN;
  }

  toString(): string {
    return toAsciiMath(this);
  }

  [Symbol.toPrimitive](hint: 'number' | 'string' | 'default'): number | string | null {
    if (hint === 'number') return this.valueOf();
    if (hint === 'string') return this.toString();
    if (isNumeric(this)) return this.valueOf();
    return this.toString();
  }
}
```

### 3.5 Internal Code Migration

Search the codebase for direct calls to role-specific methods and guard them.

**Before:**

```typescript
function someRule(expr: BoxedExpression): BoxedExpression {
  // Unsafe: expr might be a string.
  return expr.add(5);
}
```

**After:**

```typescript
import { isNumeric } from './guards';

function someRule(expr: BoxedExpression): BoxedExpression | undefined {
  if (isNumeric(expr)) {
    // Type-safe: compiler knows expr is INumeric here.
    return expr.add(5);
  }
  return undefined;
}
```

### 3.6 What Stays on BoxedExpression

Not everything moves to a role interface. These remain universal:

- **Structural properties**: `operator`, `ops`, `nops`, `op1`/`op2`/`op3`,
  `symbol`, `string`, `isValid`, `errors`
- **Traversal**: `subexpressions`, `symbols`, `unknowns`, `has()`, `map()`,
  `subs()`
- **Pattern matching**: `match()`, `replace()`, `isSame()`, `is()`
- **Evaluation pipeline**: `evaluate()`, `simplify()`, `N()`, `compile()`
- **Serialization**: `toLatex()`, `toJSON()`, `toString()`, `json`, `latex`
- **Type info**: `type`, `baseDefinition`, `operatorDefinition`
- **Canonical form**: `isCanonical`, `isStructural`, `canonical`, `structural`
- **Engine reference**: `engine`

## 4. Summary of Benefits

Once this refactoring is complete, the codebase will be significantly more
robust and maintainable:

- **Compile-Time Safety:** Logical errors like adding a number to a string will
  be caught by the TypeScript compiler.
- **Clarity and Explicitness:** The capabilities of each expression type are
  clearly defined by interfaces. Code that uses these capabilities becomes
  self-documenting.
- **Improved Maintainability:** The core `_BoxedExpression` class becomes
  smaller and more stable. Adding new functionality is localized to the relevant
  interfaces and classes.
- **Preserved Convenience:** External users can still use expressions in natural
  JavaScript operations (`result + 5`) thanks to the `valueOf` and
  `[Symbol.toPrimitive]` methods, hiding the internal complexity.
- **Incremental Migration:** The phased approach means the codebase stays
  compilable and testable at every step. No big-bang cutover required.
