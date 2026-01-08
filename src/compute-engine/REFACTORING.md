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
    a convenient façade for external users to seamlessly integrate boxed
    expressions with standard JavaScript operations.

## 2. Step-by-Step Refactoring Guide

This refactoring can be done incrementally, starting with one capability (e.g.,
`INumeric`) at a time.

### Step 1: Define the Role Interfaces

Create new interface files that define the contracts for different expression
capabilities. These methods and properties will be _removed_ from the
`_BoxedExpression` base class.

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

### Step 2: Create Standalone Type Guards

Create a utility file for type guards. These functions will check if an
expression conforms to a specific role interface.

**`src/compute-engine/boxed-expression/guards.ts`**

```ts
import type { INumeric } from './numeric-interface';
import type { ICollection } from './collection-interface';
import type { BoxedExpression, BoxedNumber, BoxedList, BoxedString } from '../global-types';

/**
 * Checks if the expression behaves like a number.
 * This is true for number literals and symbols with a numeric value/domain.
 */
export function isNumeric(expr: BoxedExpression): expr is INumeric {
  // This uses the engine's powerful symbolic type system.
  return expr.type.matches('number');
}

/**
 * Checks if the expression behaves like a collection.
 */
export function isCollection(expr: BoxedExpression): expr is ICollection {
  return expr.isCollection; // Use the existing property for the check
}

// Add other guards as needed (isSymbol, isString, etc.)
```

### Step 3: Refactor the `_BoxedExpression` Base Class

Modify the base class to remove the role-specific methods and add the JavaScript
coercion methods.

**`src/compute-engine/boxed-expression/abstract-boxed-expression.ts`**

```ts
import { isNumeric } from './guards'; // Import the new guard
import { toAsciiMath } from './ascii-math';

export abstract class _BoxedExpression {
  // --- KEEP universal properties ---
  readonly engine: ComputeEngine;
  readonly hash: number;
  readonly json: Expression;
  isSame(other: BoxedExpression): boolean;
  // ... and others like toLatex, toJSON, simplify, evaluate etc.

  // --- REMOVE all numeric-specific properties and methods ---
  // REMOVE: readonly re: number;
  // REMOVE: readonly im: number;
  // REMOVE: readonly isZero: boolean;
  // REMOVE: add(rhs: ...): BoxedExpression;
  // REMOVE: mul(rhs: ...): BoxedExpression;
  // ... etc.

  // --- REMOVE all collection-specific properties and methods ---
  // REMOVE: readonly size: number;
  // REMOVE: each(): Generator<BoxedExpression>;
  // ... etc.

  // --- ADD JavaScript Coercion Methods for Interoperability ---
  valueOf(): number {
    if (isNumeric(this)) {
      // Return NaN for complex numbers in a numeric context
      return this.im !== 0 ? NaN : this.re;
    }
    // Return NaN for non-numeric types
    return NaN;
  }

  toString(): string {
    return toAsciiMath(this);
  }

  [Symbol.toPrimitive](hint: 'number' | 'string' | 'default'): number | string | null {
    if (hint === 'number') {
      return this.valueOf();
    }
    if (hint === 'string') {
      return this.toString();
    }
    // For 'default', prioritize numeric conversion if possible.
    if (isNumeric(this)) {
      return this.valueOf();
    }
    return this.toString();
  }
}
```

### Step 4: Update Concrete Classes

Modify `BoxedNumber`, `BoxedSymbol`, and others to implement the new interfaces.

**`BoxedNumber.ts`**

```ts
import { INumeric } from './numeric-interface';

// Add `implements INumeric`
export class BoxedNumber extends _BoxedExpression implements INumeric {
  // ... existing implementation

  // Move all the numeric methods and properties here from the old base class.
  // The implementations are already correct.
  get re(): number { /* ... */ }
  get im(): number { /* ... */ }
  add(rhs: INumeric | number): INumeric { /* ... */ }
  // ... etc.
}
```

**`BoxedString.ts`**

```ts
import { ICollection } from './collection-interface';

// Add `implements ICollection`
export class BoxedString extends _BoxedExpression implements ICollection {
    // ... existing implementation

    // Move all collection methods and properties here.
    get size(): number { /* ... */ }
    each(): Generator<BoxedExpression> { /* ... */ }
    // ... etc.
}
```

**`BoxedSymbol.ts` (Crucial Delegation Pattern)**

```ts
import { INumeric } from './numeric-interface';
import { isNumeric } from './guards';

// A symbol can implement multiple roles based on its value.
export class BoxedSymbol extends _BoxedExpression implements INumeric, ICollection {
  // ... existing implementation

  // --- INumeric Implementation (by Delegation) ---
  get re(): number {
    const val = this.evaluate();
    // Use the type guard to safely access numeric properties
    if (isNumeric(val)) return val.re;
    return NaN;
  }

  get im(): number { /* Similar delegation */ }

  add(rhs: INumeric | number): INumeric {
    const val = this.evaluate();
    if (isNumeric(val)) {
      // Delegate the call to the underlying numeric value
      return val.add(rhs);
    }
    throw new TypeError(`Symbol "${this.symbol}" does not represent a numeric value.`);
  }
  // ... implement all other INumeric methods by delegating to this.evaluate()

  // --- ICollection Implementation (by Delegation) ---
  get size(): number {
      const val = this.evaluate();
      if (isCollection(val)) return val.size;
      return 0; // Or throw error
  }
  // ... delegate all other ICollection methods
}
```

### Step 5: Refactor Internal Engine Code

Finally, search the codebase for direct calls to the methods that were moved and
guard them. This is the step that makes the entire system safer.

**Before:**

```typescript
// In some simplification rule or evaluate handler...
function someRule(expr: BoxedExpression): BoxedExpression {
  // This is unsafe. `expr` might be a string.
  return expr.add(5);
}
```

**After:**

```typescript
import { isNumeric } from './guards';

function someRule(expr: BoxedExpression): BoxedExpression | undefined {
  // Now we must check first.
  if (isNumeric(expr)) {
    // This call is now 100% type-safe.
    // The compiler knows `expr` is `INumeric` here.
    return expr.add(5);
  }
  // Handle the case where the expression is not numeric.
  return undefined;
}
```

This systematic replacement will root out countless potential runtime bugs and
replace them with compile-time errors, forcing the developer to handle all cases
explicitly and correctly.

## 3. Summary of Benefits

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
