# API Transition Guide

This guide covers the breaking changes introduced in the latest architecture
revision of `@cortex-js/compute-engine`. Each section shows the old API, the
new API, and a brief rationale.

---

## 1. Expression Creation: `form` Replaces `canonical`/`structural`

The old API used a confusing mix of `canonical` (boolean or array) and
`structural` (boolean) options. These have been unified into a single `form`
option.

### Before

```ts
// Full canonicalization (default)
ce.box(['Add', 1, 'x']);
ce.box(['Add', 1, 'x'], { canonical: true });

// No canonicalization, no binding
ce.box(['Add', 1, 'x'], { canonical: false });

// Structural: bound but not fully canonical
ce.function('Add', [1, 'x'], { structural: true });

// Selective canonicalization
ce.box(['Add', 1, 'x'], { canonical: ['Number', 'Order'] });
```

### After

```ts
import { ComputeEngine } from '@cortex-js/compute-engine';
const ce = new ComputeEngine();

// Full canonicalization (default)
ce.box(['Add', 1, 'x']);
ce.box(['Add', 1, 'x'], { form: 'canonical' });

// No canonicalization, no binding
ce.box(['Add', 1, 'x'], { form: 'raw' });

// Structural: bound but not fully canonical
ce.function('Add', [1, 'x'], { form: 'structural' });

// Selective canonicalization
ce.box(['Add', 1, 'x'], { form: ['Number', 'Order'] });
```

The `form` option is accepted by `ce.box()`, `ce.function()`, and `ce.parse()`.

The `FormOption` type is:

```ts
type FormOption =
  | 'canonical'   // Full canonicalization with binding (default)
  | 'structural'  // Binding + structural normalization, no full canonicalization
  | 'raw'         // No canonicalization, no binding
  | CanonicalForm // A single canonicalization pass (e.g. 'Number')
  | CanonicalForm[];  // Selected passes in order
```

---

## 2. Role-Specific Properties Moved to Role Interfaces

Properties that were previously available on all `Expression` instances
(returning `null` or `undefined` when not applicable) have been removed from
the base interface. They are now only accessible after narrowing with a type
guard.

### Removed from `Expression`

| Property           | Access via                                       |
|:-------------------|:-------------------------------------------------|
| `.symbol`          | `isSymbol(expr)` then `expr.symbol`         |
| `.string`          | `isString(expr)` then `expr.string`         |
| `.ops`             | `isFunction(expr)` then `expr.ops`          |
| `.nops`            | `isFunction(expr)` then `expr.nops`         |
| `.op1`/`.op2`/`.op3` | `isFunction(expr)` then `expr.op1` etc.  |
| `.isFunctionExpression` | `isFunction(expr)` then `expr.isFunctionExpression` |
| `.numericValue`    | `isNumber(expr)` then `expr.numericValue`   |
| `.isNumberLiteral` | `isNumber(expr)` then `expr.isNumberLiteral` |
| `.tensor`          | `isTensor(expr)` then `expr.tensor`         |

### Before

```ts
if (expr.symbol !== null) {
  console.log(expr.symbol);
}

if (expr.numericValue !== null) {
  console.log(expr.numericValue);
}
```

### After

```ts
import { isSymbol, isNumber, sym } from '@cortex-js/compute-engine';

if (isSymbol(expr)) {
  // expr.symbol is `string` — guaranteed non-undefined
  console.log(expr.symbol);
}

if (isNumber(expr)) {
  // expr.numericValue is `number | NumericValue` — guaranteed non-undefined
  console.log(expr.numericValue);
}

// Convenience helper for symbol checks
if (sym(expr) === 'Pi') {
  console.log('This is Pi');
}
```

See Section 6 for the full list of type guards and role interfaces.

**Note:** The `sym()` helper combines `isSymbol()` check with symbol name access,
making simple symbol comparisons more concise.

### Still on `Expression`

- `.re` / `.im` — typed `number`, return `NaN` when not applicable
- `.shape` — typed `number[]`, returns `[]` for scalars
- `.operator` — returns the operator name for all expression types
- All arithmetic methods (`.add()`, `.mul()`, etc.) — work symbolically on all expressions
- All numeric predicates (`.isPositive`, `.isInteger`, etc.) — meaningful with assumptions

---

## 3. `compile()` Is Now a Free Function

The `expr.compile()` method has been replaced by a standalone `compile()`
function. The return type is now a `CompilationResult` object instead of a
callable-with-toString hybrid.

### Before

```ts
const expr = ce.parse('x^2 + 1');
const fn = expr.compile();
console.log(fn({ x: 3 }));  // 10

// Get generated code
console.log(fn.toString());

// Target a different language
const code = expr.compile({ to: 'python' });
```

### After

```ts
import { compile } from '@cortex-js/compute-engine';

const expr = ce.parse('x^2 + 1');
const result = compile(expr);

// Execute (JavaScript target)
console.log(result.run({ x: 3 }));  // 10

// Access generated source code
console.log(result.code);

// Check compilation status
console.log(result.success);  // true
console.log(result.target);   // 'javascript'

// Target a different language
const pyResult = compile(expr, { to: 'python' });
console.log(pyResult.code);  // "x ** 2 + 1"
```

### `CompilationResult` Interface

```ts
interface CompilationResult {
  target: string;     // Target language name
  success: boolean;   // Whether compilation succeeded
  code: string;       // Generated source code
  run?: (...args: any[]) => any;  // Executable (JS targets only)
}
```

---

## 4. `expand()` Is Now a Free Function

The `expr.expand()` method has been replaced by a standalone `expand()`
function.

### Before

```ts
const expr = ce.parse('(x+1)(x+2)');
const expanded = expr.expand();
console.log(expanded.latex);  // "x^2+3x+2"
```

### After

```ts
import { expand } from '@cortex-js/compute-engine';

const expr = ce.parse('(x+1)(x+2)');
const expanded = expand(expr);
console.log(expanded.latex);  // "x^2+3x+2"
```

> **Note**: `expand()` returns `null` if the expression cannot be expanded.
> Handle this with `expand(expr) ?? expr` if you want the original expression
> as a fallback.

---

## 5. Library System

The constructor now accepts a `libraries` option for controlling which
libraries are loaded. Libraries declare their dependencies explicitly and are
loaded in topological order.

### Before

```ts
// No control over which libraries are loaded
const ce = new ComputeEngine();
```

### After

```ts
// Load only specific standard libraries
const ce = new ComputeEngine({
  libraries: ['core', 'arithmetic', 'trigonometry'],
});

// Add a custom library alongside standard ones
const ce = new ComputeEngine({
  libraries: [
    ...ComputeEngine.getStandardLibrary(),
    {
      name: 'physics',
      requires: ['arithmetic'],
      definitions: {
        G: { value: 6.674e-11, type: 'real', isConstant: true },
        c: { value: 299792458, type: 'real', isConstant: true },
      },
    },
  ],
});
```

### `LibraryDefinition` Interface

```ts
interface LibraryDefinition {
  name: string;
  requires?: string[];
  definitions?: SymbolDefinitions | SymbolDefinitions[];
  latexDictionary?: Readonly<Partial<LatexDictionaryEntry>[]>;
}
```

---

## 6. Type Guards and Role Interfaces

Nine type guard functions are available for runtime type checking. They narrow
to role interfaces that provide typed access to properties specific to that
expression kind. These guards are now **required** to access role-specific
properties (`.symbol`, `.ops`, `.numericValue`, etc.) that have been removed
from the base `Expression` interface.

### Before

```ts
// Properties were on Expression, returned null when not applicable
if (expr.symbol !== null) {
  console.log(expr.symbol);
}
if (expr.numericValue !== null) {
  console.log(expr.numericValue);
}
```

### After

```ts
import {
  isNumber,
  isSymbol,
  isFunction,
  isString,
  isTensor,
  isDictionary,
  isCollection,
  isIndexedCollection,
  isExpression,
} from '@cortex-js/compute-engine';

// Type guards narrow the type — no undefined checks needed
if (isNumber(expr)) {
  // expr.numericValue is `number | NumericValue` (not undefined)
  // expr.isNumberLiteral is `true` (not boolean)
  console.log(expr.numericValue);
}

if (isSymbol(expr)) {
  // expr.symbol is `string` (not undefined)
  console.log(expr.symbol);
}

if (isFunction(expr)) {
  // expr.ops is `ReadonlyArray<Expression>` (not undefined)
  // expr.isFunctionExpression is `true`
  console.log(expr.ops, expr.nops, expr.op1);
}

if (isString(expr)) {
  // expr.string is `string` (not undefined)
  console.log(expr.string);
}

if (isTensor(expr)) {
  // expr.tensor is `Tensor<any>` (not undefined)
  // expr.shape is `number[]`, expr.rank is `number`
  console.log(expr.shape, expr.rank);
}

if (isCollection(expr)) {
  // expr.isCollection is `true`
  for (const item of expr.each()) console.log(item);
}

if (isIndexedCollection(expr)) {
  // expr.isIndexedCollection is `true`
  console.log(expr.at(0));
}
```

### Convenience Helper: `sym()`

For quick symbol name checks, use the `sym()` helper:

```ts
import { sym } from '@cortex-js/compute-engine';

// Instead of:
if (isSymbol(expr) && expr.symbol === 'Pi') { /* ... */ }

// You can write:
if (sym(expr) === 'Pi') { /* ... */ }

// Returns symbol name or undefined
const name = sym(expr);  // string | undefined
```

### Role Interfaces

| Guard              | Narrows to                                 |
|:-------------------|:-------------------------------------------|
| `isNumber`    | `Expression & NumberLiteralInterface`  |
| `isSymbol`    | `Expression & SymbolInterface`         |
| `isFunction`  | `Expression & FunctionInterface`       |
| `isString`    | `Expression & StringInterface`         |
| `isTensor`    | `Expression & TensorInterface`         |
| `isDictionary`     | `Expression & DictionaryInterface`     |
| `isCollection`     | `Expression & CollectionInterface`     |
| `isIndexedCollection` | `Expression & IndexedCollectionInterface` |
| `isExpression`        | `Expression` (from `unknown`)      |

---

## 7. Compilation Targets

Custom compilation targets can now be registered and unregistered dynamically.
Built-in targets (`'javascript'`, `'glsl'`, `'python'`, `'interval-javascript'`,
`'interval-glsl'`) are pre-registered.

### Before

```ts
// Only built-in targets, no extension mechanism
const fn = expr.compile({ to: 'javascript' });
```

### After

```ts
import {
  ComputeEngine,
  compile,
  PythonTarget,
  LanguageTarget,
} from '@cortex-js/compute-engine';

const ce = new ComputeEngine();

// Register a custom target
ce.registerCompilationTarget('python', new PythonTarget());

// Use it
const result = compile(ce.parse('x^2 + 1'), { to: 'python' });
console.log(result.code);  // "x ** 2 + 1"

// List available targets
console.log(ce.listCompilationTargets());

// Remove a target
ce.unregisterCompilationTarget('python');
```

### Implementing a Custom Target

```ts
class MyTarget implements LanguageTarget {
  getOperators(): CompiledOperators { /* ... */ }
  getFunctions(): CompiledFunctions { /* ... */ }
  createTarget(options?: Partial<CompileTarget>): CompileTarget { /* ... */ }
  compile(expr: Expression, options?: CompilationOptions): CompilationResult {
    /* ... */
  }
}

ce.registerCompilationTarget('my-lang', new MyTarget());
```

---

## 8. User-Extensible Simplification Rules

The simplification rules used by `.simplify()` are now accessible and
modifiable.

### Before

```ts
// No way to add custom simplification rules to the standard pipeline
expr.simplify();

// Only per-call rules were supported
expr.simplify({ rules: myRules });
```

### After

```ts
// Add a custom rule to the standard pipeline
ce.simplificationRules.push({
  match: ['Power', ['Sin', '_x'], 2],
  replace: ['Subtract', 1, ['Power', ['Cos', '_x'], 2]],
});

// All subsequent .simplify() calls will use the custom rule
expr.simplify();

// Replace the entire rule set
ce.simplificationRules = myCustomRules;

// Per-call override still works
expr.simplify({ rules: otherRules });
```

---

## 9. Subpath Exports

`Expression` now refers to the compute-engine runtime expression type.
The MathJSON type has been renamed to `MathJsonExpression`.

### Before

```ts
// MathJSON type (old name)
import { Expression } from '@cortex-js/compute-engine';
```

### After

```ts
// Full engine
import { ComputeEngine } from '@cortex-js/compute-engine';
import type { Expression } from '@cortex-js/compute-engine';

// MathJSON types only (lightweight, no engine code)
import { MathJsonExpression } from '@cortex-js/compute-engine/math-json';
```

---

## 10. Removed Properties

The following properties have been removed from the `Expression` base
interface. They are now only available on the corresponding role interfaces,
accessed via type guards.

| Removed Property            | Type Guard → Interface                            |
|:----------------------------|:--------------------------------------------------|
| `expr.numericValue`         | `isNumber()` → `NumberLiteralInterface`      |
| `expr.isNumberLiteral`      | `isNumber()` → `NumberLiteralInterface`      |
| `expr.symbol`               | `isSymbol()` → `SymbolInterface`             |
| `expr.string`               | `isString()` → `StringInterface`             |
| `expr.isFunctionExpression` | `isFunction()` → `FunctionInterface`         |
| `expr.ops`                  | `isFunction()` → `FunctionInterface`         |
| `expr.nops`                 | `isFunction()` → `FunctionInterface`         |
| `expr.op1` / `op2` / `op3` | `isFunction()` → `FunctionInterface`         |
| `expr.tensor`               | `isTensor()` → `TensorInterface`             |

Accessing these properties without first narrowing with a type guard is now a
TypeScript compile error.

```ts
// Compile error — .symbol does not exist on Expression
console.log(expr.symbol);

// Correct — narrow first, then access
if (isSymbol(expr)) {
  console.log(expr.symbol);  // string, guaranteed
}
```

---

## 11. Common Migration Patterns

### Pattern: Checking Multiple Expression Types

**Before:**
```ts
if (expr.symbol !== null) {
  return expr.symbol;
} else if (expr.numericValue !== null) {
  return expr.numericValue.toString();
} else if (expr.ops !== null) {
  return expr.operator;
}
```

**After:**
```ts
import { isSymbol, isNumber, isFunction } from '@cortex-js/compute-engine';

if (isSymbol(expr)) {
  return expr.symbol;
} else if (isNumber(expr)) {
  return expr.numericValue.toString();
} else if (isFunction(expr)) {
  return expr.operator;
}
```

### Pattern: Processing Function Arguments

**Before:**
```ts
if (expr.ops) {
  for (const arg of expr.ops) {
    process(arg);
  }
}
```

**After:**
```ts
import { isFunction } from '@cortex-js/compute-engine';

if (isFunction(expr)) {
  for (const arg of expr.ops) {
    process(arg);
  }
}
```

### Pattern: Safe Numeric Value Access

**Before:**
```ts
const value = expr.numericValue ?? 0;  // Default to 0 if not a number
```

**After:**
```ts
import { isNumber } from '@cortex-js/compute-engine';

const value = isNumber(expr) ? expr.numericValue : 0;
```

### Pattern: Symbol Name Extraction

**Before:**
```ts
const name = expr.symbol || 'unknown';
```

**After:**
```ts
import { sym } from '@cortex-js/compute-engine';

const name = sym(expr) ?? 'unknown';
```

### Pattern: Working with Decomposition Results

**Before:**
```ts
const [P, L, U] = luDecomposition.ops;  // Unsafe - ops might be null
```

**After:**
```ts
import { isFunction } from '@cortex-js/compute-engine';

const lu = luDecomposition.evaluate();
if (isFunction(lu)) {
  const [P, L, U] = lu.ops;
  // Safe to use P, L, U here
}
```

---

## Quick Reference: Import Changes

```ts
// Old
import { ComputeEngine } from '@cortex-js/compute-engine';
const ce = new ComputeEngine();
const expr = ce.parse('x^2 + 1');

// Old method calls
expr.expand();
expr.compile();
ce.box(json, { canonical: false });

// New
import {
  ComputeEngine,
  compile,
  expand,
  isFunction,
} from '@cortex-js/compute-engine';

const ce = new ComputeEngine();
const expr = ce.parse('x^2 + 1');

// New free function calls
expand(expr);
compile(expr);
ce.box(json, { form: 'raw' });
```
