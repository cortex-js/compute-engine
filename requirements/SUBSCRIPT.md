# Subscript Handling Proposal

## Current State

### Parsing Behavior

The compute engine currently handles subscripts in two ways:

1. **Simple subscripts become compound symbol names**:
   - `x_0` → symbol `x_0`
   - `x_n` → symbol `x_n`
   - `A_{max}` → symbol `A_max`
   - `\pi_1` → symbol `Pi_1`

2. **Complex subscripts become `Subscript` expressions**:
   - `x_{n+1}` → `["Subscript", "x", ["Add", "n", 1]]`
   - `k_{n,m}` → `["Subscript", "k", ["Sequence", "n", "m"]]`
   - `A_{(n+1)}` → `["Subscript", "A", ["Add", "n", 1]]`

### Canonicalization Behavior

The `Subscript` function's canonical handler has special cases:

1. **String-in-base form**: `"deadbeef"_{16}` → numeric value
2. **Indexed collections**: If `op1.isIndexedCollection`, convert to
   `At(op1, index)`
3. **Simple symbol subscripts**: If subscript is a symbol/string/number, create
   compound symbol
4. **Everything else**: Keep as `Subscript(op1, op2)`

### Current Problems

#### Problem 1: Type Mismatch in Arithmetic (Issue #273)

```latex
a_{n+1} + 1  →  Error: incompatible-type (number vs symbol)
```

The `Subscript` function returns type `'symbol'` when the base is a symbol:

```typescript
type: ([op1, op2], { engine: ce }) => {
  // ...
  if (op1.symbol) return 'symbol';  // ← This is the problem
  return 'expression';
}
```

But `symbol` is not a numeric type, so arithmetic validation fails. Simple
subscripted symbols (`x_n`) work because they become actual symbols that can be
inferred as numeric.

#### Problem 2: Inconsistent Semantics

The same mathematical notation has different meanings:

- `a_n` → A symbol (can be used in arithmetic)
- `a_{n+1}` → A `Subscript` expression (fails in arithmetic)

Both should represent "the value at index n" or "the n-th element" semantically.

#### Problem 3: Ambiguous Intent

The subscript notation is overloaded in mathematics:

1. **Indexing**: `v_i` means `v[i]` (element access)
2. **Naming**: `x_{max}` means "the x associated with max" (compound name)
3. **Parameter**: `a_n` in sequences means "a as a function of n"
4. **Multi-indexing**: `T_{i,j}` means `T[i][j]` (tensor access)

## Proposed Solution

### Design Principles

1. **Type-aware interpretation**: Use the declared type of the base to determine
   meaning
2. **Backward compatibility**: Simple subscripts continue to work as symbols
3. **Explicit disambiguation**: Provide clear rules for when subscripts mean
   indexing vs naming
4. **Predictable behavior**: Users should be able to understand what their
   notation means

### Proposed Subscript Semantics

#### Rule 1: Indexed Collections → `At`

If the base is an indexed collection (list, tuple, matrix, vector, string),
interpret as indexing:

```
v: list<number>
v_1 → At(v, 1)
v_{n+1} → At(v, n+1)
A_{i,j} → At(A, i, j)  // for matrices
```

This already works but requires the symbol to be pre-declared with a collection
type.

#### Rule 2: Simple Subscripts → Compound Symbols

If the subscript is "simple" (identifier, number, or concatenation of
identifiers/numbers), create a compound symbol:

```
x_0 → symbol "x_0"
x_n → symbol "x_n"
A_{max} → symbol "A_max"
T_{ij} → symbol "T_ij"
```

This preserves the current behavior for naming conventions.

#### Rule 3: Complex Subscripts → Parameterized Symbols

If the subscript contains operators/expressions, the result should be a
**numeric expression** (not type `symbol`):

```
a_{n+1} → Subscript(a, n+1)  // type: number (same as 'a')
x_{2k} → Subscript(x, 2k)    // type: number
```

The type of `Subscript(base, index)` should inherit from the base symbol's type
(or default to `number` for unknowns).

#### Rule 4: Multi-index Subscripts → Sequence Access

If the subscript contains commas, interpret as multi-dimensional indexing or a
parameterized symbol with multiple indices:

```
a_{n,m} → Subscript(a, Sequence(n, m))  // type: number
T_{i,j,k} → Subscript(T, Sequence(i, j, k))  // or At for tensors
```

### Implementation Changes

#### 1. Update `Subscript` Type Function

```typescript
type: ([op1, op2], { engine: ce }) => {
  // String-in-base form
  if (op1.string && asSmallInteger(op2) !== null) return 'integer';

  // Indexed collection → element type
  if (op1.isIndexedCollection)
    return collectionElementType(op1.type.type) ?? 'any';

  // Symbol with compound name (simple subscript) → symbol
  // This case is handled in canonical, not here

  // Complex subscript on symbol → inherit base type or assume numeric
  if (op1.symbol) {
    const baseDef = ce.lookupDefinition(op1.symbol);
    if (baseDef && isValueDef(baseDef)) {
      // Inherit type from base symbol
      return baseDef.type?.type ?? 'number';
    }
    // Unknown symbol, assume numeric (can be inferred)
    return 'unknown';  // Changed from 'symbol' to 'unknown'
  }

  return 'expression';
}
```

Key change: Return `'unknown'` instead of `'symbol'` for complex subscripts,
allowing type inference in arithmetic contexts.

#### 2. Add Subscript-Aware Type Inference

When a `Subscript` expression is used in a numeric context, infer the base
symbol's type:

```typescript
// In checkNumericArgs or similar
} else if (op.operator === 'Subscript' && op.op1?.symbol) {
  // Subscripted symbol in numeric context - allow it
  op.op1.infer('number');  // Infer the base is numeric
  xs.push(op);
}
```

#### 3. Introduce Optional Explicit Notation

Consider supporting explicit disambiguation:

- `v[i]` or `v_{[i]}` → Always `At(v, i)` (indexing)
- `x_{\text{max}}` → Always compound symbol (naming)
- `a_{(n+1)}` → Currently unwraps to `Subscript(a, n+1)`

The bracket notation `v[i]` already parses to `At(v, i)`.

### New Interpretation Table

| LaTeX     | Base Type      | Subscript Type    | Result                                     |
| --------- | -------------- | ----------------- | ------------------------------------------ |
| `x_0`     | any            | simple literal    | symbol `x_0`                               |
| `x_n`     | any            | simple identifier | symbol `x_n`                               |
| `x_{max}` | any            | simple text       | symbol `x_max`                             |
| `x_{ij}`  | any            | simple concat     | symbol `x_ij`                              |
| `v_1`     | list           | simple literal    | `At(v, 1)`                                 |
| `v_n`     | list           | simple identifier | `At(v, n)`                                 |
| `x_{n+1}` | unknown/number | expression        | `Subscript(x, n+1)` type: number           |
| `x_{n+1}` | list           | expression        | `At(x, n+1)`                               |
| `A_{i,j}` | matrix         | multi-index       | `At(A, i, j)`                              |
| `a_{n,m}` | unknown        | multi-index       | `Subscript(a, Sequence(n,m))` type: number |

### Evaluation Semantics

The `Subscript` function should have an evaluation path:

```typescript
evaluate: (ops, { engine: ce }) => {
  const [base, index] = ops;

  // If base has a definition with subscript evaluation
  const baseDef = base.symbol && ce.lookupDefinition(base.symbol);
  if (baseDef?.subscript) {
    return baseDef.subscript(index);
  }

  // If base evaluates to a collection, use At
  const baseVal = base.evaluate();
  if (baseVal.isIndexedCollection) {
    return ce._fn('At', [baseVal, index]).evaluate();
  }

  // Otherwise, cannot evaluate further
  return undefined;
}
```

This allows sequences like Fibonacci to be defined:

```typescript
ce.declare('fib', {
  type: 'integer',
  subscript: (n) => /* Fibonacci implementation */
});
// Then fib_10 would evaluate to 55
```

### Migration Path

1. **Phase 1**: Fix the type inference issue (return `'unknown'` instead of
   `'symbol'`) ✅ IMPLEMENTED
   - This immediately fixes issue #273
   - Backward compatible
   - Change in `src/compute-engine/library/core.ts` - Subscript type function

2. **Phase 2**: Add type-aware subscript handling ✅ IMPLEMENTED
   - When base has collection type, convert to `At`
   - When base has numeric type, preserve as numeric `Subscript`
   - Both simple (`v_n`) and complex (`v_{n+1}`) subscripts on collection types
     now correctly become `At(v, n)` and `At(v, n+1)`
   - Changes in:
     - `src/compute-engine/latex-syntax/parse-symbol.ts` - check symbol type at parse time
     - `src/compute-engine/library/core.ts` - canonical handler for complex subscripts

3. **Phase 3**: Add evaluation support for subscripted symbols ✅ IMPLEMENTED
   - Added `subscriptEvaluate` handler to `ValueDefinition`
   - Supports both simple (`F_5`) and complex (`F_{5}`) subscript syntax
   - Handler receives evaluated subscript and returns result (or `undefined` for symbolic)
   - Subscripted expressions with `subscriptEvaluate` have type `number` for arithmetic
   - Changes in:
     - `src/compute-engine/global-types.ts` - added `subscriptEvaluate` to ValueDefinition
     - `src/compute-engine/boxed-expression/boxed-value-definition.ts` - store handler
     - `src/compute-engine/library/core.ts` - evaluate and type handlers for Subscript
     - `src/compute-engine/latex-syntax/parse-symbol.ts` - prevent compound symbol creation
     - `src/compute-engine/latex-syntax/types.ts` and `parse.ts` - parser callback
     - `src/compute-engine/index.ts` - hasSubscriptEvaluate option

4. **Phase 4**: Declarative sequence definitions (SUB-4) 🔲 PLANNED
   - Allow defining sequences using LaTeX recurrence relations
   - Support base cases and recurrence rules
   - See [Declarative Sequence Definitions](#declarative-sequence-definitions-sub-4) below

### Open Questions

1. **Should `a_{n,m}` with unknown `a` become:**
   - `Subscript(a, Sequence(n, m))` (current)
   - `Subscript(a, List(n, m))`
   - `At(a, n, m)` (aggressive conversion)

[*] `Subscript(a, Sequence(n, m))`

2. **How to handle `f_{n+1}(x)` (subscripted function application)?**
   - Currently parsed as `Subscript(f, n+1)` applied to `x`
   - Should it be `Subscript(f(x), n+1)` or `(f_{n+1})(x)`?

[*] Keep current parsing, but clarify in documentation

3. **Should text subscripts like `x_{\text{max}}` be treated differently?**
   - These are clearly naming, not indexing
   - Could use `\text{}` or `\mathrm{}` as a signal

[*] Yes, good idea.

4. **What about primed symbols with subscripts: `f'_n`?**
   - Is this `(f')_n` or `(f_n)'`?
   - Currently becomes `Derivative(f_n)`

[*] Keep current behavior, document clearly

## Test Cases for Implementation

```typescript
// Should work after fix
expect(ce.parse('a_{n+1}+1').evaluate()).toBe(/* no error */);
expect(ce.parse('2*a_{n+1}').evaluate()).toBe(/* no error */);
expect(ce.parse('a_{n+1}^2').evaluate()).toBe(/* no error */);

// Type-aware conversion
ce.declare('v', { type: 'list<number>' });
expect(ce.parse('v_1').json).toEqual(['At', 'v', 1]);
expect(ce.parse('v_{n+1}').json).toEqual(['At', 'v', ['Add', 'n', 1]]);

// Multi-index
ce.declare('A', { type: 'matrix<number>' });
expect(ce.parse('A_{i,j}').json).toEqual(['At', 'A', 'i', 'j']);

// Compound symbols still work
expect(ce.parse('x_0').symbol).toBe('x_0');
expect(ce.parse('T_{max}').symbol).toBe('T_max');
```

## Summary

The key insight is that subscripts have **multiple semantic meanings** in
mathematics, and the compute engine should use **type information** to
disambiguate:

1. **Collections** use subscripts for **indexing** → `At`
2. **Unknown/numeric symbols** use simple subscripts for **naming** → compound
   symbol
3. **Unknown/numeric symbols** use complex subscripts for **parameterization** →
   `Subscript` with numeric type

The immediate fix is to change the return type of `Subscript` from `'symbol'` to
`'unknown'` for complex subscripts, allowing them to be used in arithmetic
contexts. The longer-term solution is full type-aware subscript interpretation.

---

## Declarative Sequence Definitions (SUB-4)

### Motivation

While `subscriptEvaluate` allows defining sequences programmatically with
JavaScript, mathematicians often define sequences using recurrence relations:

```latex
a_n = a_{n-1} + 1, \quad a_0 = 1
F_n = F_{n-1} + F_{n-2}, \quad F_0 = 0, F_1 = 1
```

A declarative API would make it easier to define sequences using familiar
mathematical notation.

### Proposed API

#### Option 1: Object-Based Declaration

```typescript
ce.declareSequence('a', {
  base: { 0: 1 },                    // a_0 = 1
  recurrence: 'a_{n-1} + 1',         // a_n = a_{n-1} + 1
});

ce.declareSequence('F', {
  base: { 0: 0, 1: 1 },              // F_0 = 0, F_1 = 1
  recurrence: 'F_{n-1} + F_{n-2}',   // F_n = F_{n-1} + F_{n-2}
});

// Usage
ce.parse('a_{10}').evaluate();       // → 11
ce.parse('F_{10}').evaluate();       // → 55
```

#### Option 2: LaTeX-Based Declaration

```typescript
// Using assignment notation
ce.parse('a_0 := 1').evaluate();
ce.parse('a_n := a_{n-1} + 1').evaluate();

// Or using a sequence definition function
ce.parse('\\operatorname{DefineSequence}(F, n, F_{n-1} + F_{n-2}, \\{0: 0, 1: 1\\})').evaluate();
```

#### Option 3: Combined Approach (Recommended)

```typescript
ce.declareSequence('a', {
  variable: 'n',                     // Index variable (default: 'n')
  base: { 0: 1 },                    // Base cases as object
  recurrence: ce.parse('a_{n-1} + 1'), // Recurrence as expression
  // OR
  recurrence: 'a_{n-1} + 1',         // Recurrence as LaTeX string
});
```

### Implementation Plan

#### 1. Add `declareSequence` Method to ComputeEngine

**File:** `src/compute-engine/index.ts`

```typescript
declareSequence(
  name: string,
  options: {
    variable?: string;           // Index variable name, default 'n'
    base: Record<number, number | BoxedExpression>;
    recurrence: string | BoxedExpression;
    memoize?: boolean;           // Default true
    domain?: { min?: number; max?: number };  // Valid index range
  }
): void
```

#### 2. Parse Recurrence Expression

The recurrence expression needs to:
- Identify self-references (e.g., `a_{n-1}`, `a_{n-2}`)
- Extract the offset from each self-reference
- Handle multiple self-references (Fibonacci-style)

```typescript
function parseRecurrence(
  ce: ComputeEngine,
  name: string,
  variable: string,
  expr: BoxedExpression
): {
  offsets: number[];           // e.g., [-1, -2] for Fibonacci
  evaluate: (n: number, memo: Map<number, number>) => number;
}
```

#### 3. Generate subscriptEvaluate Handler

Convert the parsed recurrence into a `subscriptEvaluate` handler:

```typescript
function createSequenceHandler(
  ce: ComputeEngine,
  base: Record<number, number>,
  recurrence: BoxedExpression,
  variable: string,
  memoize: boolean
): SubscriptEvaluateHandler {
  const memo = memoize ? new Map<number, BoxedExpression>() : null;

  return (subscript, { engine }) => {
    const n = subscript.re;
    if (!Number.isInteger(n)) return undefined;

    // Check base cases
    if (n in base) return engine.number(base[n]);

    // Check memo
    if (memo?.has(n)) return memo.get(n);

    // Evaluate recurrence by substituting n
    const result = evaluateRecurrence(engine, recurrence, variable, n, memo);

    if (memo && result) memo.set(n, result);
    return result;
  };
}
```

#### 4. Handle Self-References in Evaluation

When evaluating the recurrence, self-references like `a_{n-1}` need to
recursively call the sequence:

```typescript
function evaluateRecurrence(
  ce: ComputeEngine,
  expr: BoxedExpression,
  variable: string,
  n: number,
  memo: Map<number, BoxedExpression> | null
): BoxedExpression | undefined {
  // Substitute the variable with the current index
  const substituted = expr.subs({ [variable]: ce.number(n) });

  // The substituted expression may contain Subscript(name, n-1) etc.
  // These will evaluate via the subscriptEvaluate handler (recursive)
  return substituted.evaluate();
}
```

### Edge Cases and Validation

#### 1. Detect Invalid Recurrences

- **Missing base cases**: If recurrence references `a_{n-1}` but no base case
  for `a_0` is provided
- **Circular references**: `a_n = a_n + 1` (infinite loop)
- **Non-convergent**: Ensure recurrence terminates

```typescript
function validateRecurrence(
  offsets: number[],
  base: Record<number, number>
): { valid: boolean; error?: string } {
  // Check that base cases cover all needed starting points
  const minOffset = Math.min(...offsets);
  for (let i = 0; i > minOffset; i--) {
    if (!(i in base)) {
      return { valid: false, error: `Missing base case for index ${i}` };
    }
  }
  return { valid: true };
}
```

#### 2. Handle Non-Integer Subscripts

Return `undefined` for non-integer subscripts to keep expression symbolic.

#### 3. Handle Negative Indices

Option to support negative indices for bi-directional sequences:

```typescript
ce.declareSequence('a', {
  base: { 0: 1 },
  recurrence: 'a_{n-1} + 1',
  domain: { min: 0 },  // Only valid for n >= 0
});
```

### Multi-Index Sequences (Matrices, Tensors)

For sequences with multiple indices:

```typescript
ce.declareSequence('P', {
  variables: ['n', 'k'],           // Pascal's triangle
  base: {
    '0,0': 1,
    'n,0': 1,                      // P_{n,0} = 1 for all n
    'n,n': 1,                      // P_{n,n} = 1 for all n
  },
  recurrence: 'P_{n-1,k-1} + P_{n-1,k}',
});

ce.parse('P_{5,2}').evaluate();    // → 10
```

This is more complex and may be Phase 5.

### Closed-Form Detection (Future Enhancement)

For simple recurrences, detect and use closed-form solutions:

| Recurrence | Closed Form |
|------------|-------------|
| `a_n = a_{n-1} + d` | `a_n = a_0 + n*d` (arithmetic) |
| `a_n = r * a_{n-1}` | `a_n = a_0 * r^n` (geometric) |
| `a_n = a_{n-1} + a_{n-2}` | Binet's formula (Fibonacci) |

This optimization would avoid recursion for large indices.

### Test Cases

```typescript
describe('Declarative Sequence Definitions', () => {
  test('Arithmetic sequence', () => {
    const ce = new ComputeEngine();
    ce.declareSequence('a', {
      base: { 0: 1 },
      recurrence: 'a_{n-1} + 2',
    });
    expect(ce.parse('a_{5}').evaluate().re).toBe(11);  // 1, 3, 5, 7, 9, 11
  });

  test('Fibonacci sequence', () => {
    const ce = new ComputeEngine();
    ce.declareSequence('F', {
      base: { 0: 0, 1: 1 },
      recurrence: 'F_{n-1} + F_{n-2}',
    });
    expect(ce.parse('F_{10}').evaluate().re).toBe(55);
  });

  test('Factorial via recurrence', () => {
    const ce = new ComputeEngine();
    ce.declareSequence('fact', {
      base: { 0: 1 },
      recurrence: 'n * fact_{n-1}',  // Note: uses n directly
    });
    expect(ce.parse('fact_{5}').evaluate().re).toBe(120);
  });

  test('Symbolic subscript stays symbolic', () => {
    const ce = new ComputeEngine();
    ce.declareSequence('a', {
      base: { 0: 1 },
      recurrence: 'a_{n-1} + 1',
    });
    const result = ce.parse('a_k').evaluate();
    expect(result.operator).toBe('Subscript');
  });

  test('Missing base case returns undefined', () => {
    const ce = new ComputeEngine();
    ce.declareSequence('a', {
      base: { 1: 1 },  // Missing a_0
      recurrence: 'a_{n-1} + 1',
    });
    expect(ce.parse('a_{0}').evaluate().re).toBe(NaN);
  });

  test('Arithmetic with sequence values', () => {
    const ce = new ComputeEngine();
    ce.declareSequence('S', {
      base: { 0: 0 },
      recurrence: 'S_{n-1} + n',  // Triangular numbers
    });
    expect(ce.parse('S_{5} + S_{3}').evaluate().re).toBe(21);  // 15 + 6
  });
});
```

### Files to Modify

| File | Change |
|------|--------|
| `src/compute-engine/global-types.ts` | Add `SequenceDefinition` type |
| `src/compute-engine/index.ts` | Add `declareSequence()` method |
| `src/compute-engine/sequence.ts` | New file for sequence parsing/evaluation |
| `test/compute-engine/sequences.test.ts` | New test file |
| `doc/06-guide-augmenting.md` | Document `declareSequence()` |

### Summary

Phase 4 adds a declarative way to define sequences using recurrence relations.
The implementation:

1. Parses the recurrence expression to identify self-references
2. Validates that base cases cover all required starting points
3. Generates a `subscriptEvaluate` handler with memoization
4. Supports symbolic subscripts (returns undefined → stays symbolic)
5. Integrates with arithmetic (type is `number`)
