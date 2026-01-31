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
     - `src/compute-engine/latex-syntax/parse-symbol.ts` - check symbol type at
       parse time
     - `src/compute-engine/library/core.ts` - canonical handler for complex
       subscripts

3. **Phase 3**: Add evaluation support for subscripted symbols ✅ IMPLEMENTED
   - Added `subscriptEvaluate` handler to `ValueDefinition`
   - Supports both simple (`F_5`) and complex (`F_{5}`) subscript syntax
   - Handler receives evaluated subscript and returns result (or `undefined` for
     symbolic)
   - Subscripted expressions with `subscriptEvaluate` have type `number` for
     arithmetic
   - Changes in:
     - `src/compute-engine/global-types.ts` - added `subscriptEvaluate` to
       ValueDefinition
     - `src/compute-engine/boxed-expression/boxed-value-definition.ts` - store
       handler
     - `src/compute-engine/library/core.ts` - evaluate and type handlers for
       Subscript
     - `src/compute-engine/latex-syntax/parse-symbol.ts` - prevent compound
       symbol creation
     - `src/compute-engine/latex-syntax/types.ts` and `parse.ts` - parser
       callback
     - `src/compute-engine/index.ts` - hasSubscriptEvaluate option

4. **Phase 4**: Declarative sequence definitions (SUB-4) ✅ IMPLEMENTED
   - Added `declareSequence()` method to ComputeEngine
   - Supports base cases, recurrence relations, memoization, domain constraints
   - See
     [Declarative Sequence Definitions](#declarative-sequence-definitions-sub-4)
     below

5. **Phase 5**: LaTeX-based sequence definitions (SUB-5) ✅ IMPLEMENTED
   - Allow defining sequences using natural LaTeX notation: `a_0 := 1`,
     `a_n := a_{n-1} + 1`
   - Parser changes in `definitions-core.ts` to convert compound symbols back to
     Subscript
   - Assign evaluate handler detects sequence vs function definitions
   - See
     [LaTeX-Based Sequence Definitions](#latex-based-sequence-definitions-sub-5)
     below

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

| Recurrence                | Closed Form                    |
| ------------------------- | ------------------------------ |
| `a_n = a_{n-1} + d`       | `a_n = a_0 + n*d` (arithmetic) |
| `a_n = r * a_{n-1}`       | `a_n = a_0 * r^n` (geometric)  |
| `a_n = a_{n-1} + a_{n-2}` | Binet's formula (Fibonacci)    |

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

| File                                    | Change                                   |
| --------------------------------------- | ---------------------------------------- |
| `src/compute-engine/global-types.ts`    | Add `SequenceDefinition` type            |
| `src/compute-engine/index.ts`           | Add `declareSequence()` method           |
| `src/compute-engine/sequence.ts`        | New file for sequence parsing/evaluation |
| `test/compute-engine/sequences.test.ts` | New test file                            |
| `doc/06-guide-augmenting.md`            | Document `declareSequence()`             |

### Summary

Phase 4 adds a declarative way to define sequences using recurrence relations.
The implementation:

1. Parses the recurrence expression to identify self-references
2. Validates that base cases cover all required starting points
3. Generates a `subscriptEvaluate` handler with memoization
4. Supports symbolic subscripts (returns undefined → stays symbolic)
5. Integrates with arithmetic (type is `number`)

---

## LaTeX-Based Sequence Definitions (SUB-5)

### Motivation

While the programmatic `declareSequence()` API (SUB-4) works well,
mathematicians would prefer to define sequences using natural LaTeX notation:

```latex
a_0 := 1
a_n := a_{n-1} + 2

F_0 := 0
F_1 := 1
F_n := F_{n-1} + F_{n-2}
```

This requires changes to how the parser handles subscripted symbols on the
left-hand side of assignments.

### Current Parser Behavior

#### Problem 1: Compound Symbol Absorption

When parsing `L_0`, the symbol parser (`parse-symbol.ts:307-359`) absorbs the
subscript into a compound symbol name:

```
L_0  →  symbol "L_0"  (not Subscript(L, 0))
```

This happens **before** the `:=` is seen. The `hasSubscriptEvaluate` check
(line 296) could prevent this, but at parse time `L` isn't declared yet.

#### Problem 2: parseAssign Unwraps Subscripts

Even if we get `Subscript(L, n)` as the LHS, the `parseAssign` function
(`definitions-core.ts:1614-1618`) converts it to a function definition:

```typescript
// Current behavior for symbol subscripts:
if (symbol(sub)) {
  // f_n := ... becomes function definition
  return ['Assign', fn, ['Function', rhs, sub!]];
}
```

Only complex subscripts (like `n+1`) and string subscripts preserve the
Subscript form (line 1621).

### Proposed Solution: Option 3 - Preserve Subscript, Detect at Runtime

The key insight is that we can distinguish sequence definitions from function
definitions by analyzing the RHS:

| Pattern              | RHS Contains             | Interpretation      |
| -------------------- | ------------------------ | ------------------- |
| `f_0 := 1`           | numeric literal          | Sequence base case  |
| `f_n := f_{n-1} + 1` | self-reference `f_{...}` | Sequence recurrence |
| `f_n := 2*n + 1`     | no self-reference        | Function definition |

#### Implementation Plan

##### Step 1: Modify `parseAssign` to Always Preserve Subscript

**File:** `src/compute-engine/latex-syntax/dictionary/definitions-core.ts`

Change lines 1614-1618 to preserve Subscript for all subscript types:

```typescript
// Before (current):
if (symbol(sub)) {
  // f_n := ... → ['Assign', 'f', ['Function', rhs, sub]]
  return ['Assign', fn, ['Function', rhs, sub!]];
}

// After (proposed):
if (symbol(sub)) {
  // f_n := ... → ['Assign', ['Subscript', 'f', sub], rhs]
  // Let evaluate handler decide if it's sequence or function
  return ['Assign', lhs, rhs];
}
```

This makes **all** subscript cases consistent with the complex subscript case
(line 1621).

##### Step 2: Modify Symbol Parser to Preserve Subscript in Assignment Context

**File:** `src/compute-engine/latex-syntax/parse-symbol.ts`

Add lookahead to detect assignment context and preserve subscripts:

```typescript
// Around line 307, before the while loop:
// Check if this might be an assignment LHS (lookahead for :=)
const isAssignmentContext = parser.lookAheadForAssignment?.() ?? false;

while (!parser.atEnd && !isCollection && !hasSubscriptEval && !isAssignmentContext) {
  // ... existing subscript absorption logic
}
```

**Alternative:** Add parser option to control subscript absorption:

```typescript
// In ParseLatexOptions (types.ts):
preserveSubscriptInAssignmentLHS?: boolean;  // default: true
```

##### Step 3: Add `lookAheadForAssignment` to Parser

**File:** `src/compute-engine/latex-syntax/parse.ts`

```typescript
lookAheadForAssignment(): boolean {
  // Save position
  const savedIndex = this.index;

  // Skip current token and any following subscripts/superscripts
  // Look for := or \coloneq variants
  while (!this.atEnd) {
    const token = this.peek;
    if (token === ':' || token === '\\coloneq' || token === '\\coloneqq') {
      this.index = savedIndex;
      return true;
    }
    // Stop at operators that indicate we're past the LHS
    if (token === '+' || token === '-' || token === '*' || token === '/') {
      break;
    }
    this.nextToken();
  }

  this.index = savedIndex;
  return false;
}
```

##### Step 4: Modify `Assign` Evaluate Handler to Detect Sequence Definitions

**File:** `src/compute-engine/library/core.ts`

Update the `Assign` evaluate handler to detect and handle sequence patterns:

```typescript
evaluate: (ops, { engine: ce }) => {
  const [lhs, rhs] = ops;

  // Check for subscript assignment: Subscript(symbol, index) := expr
  if (lhs.operator === 'Subscript' && lhs.op1?.symbol) {
    const seqName = lhs.op1.symbol;
    const subscript = lhs.op2;

    // Case 1: Numeric subscript → base case
    // e.g., a_0 := 1, F_1 := 1
    if (subscript?.isNumberLiteral && Number.isInteger(subscript.re)) {
      const index = subscript.re;
      const value = rhs.evaluate();
      addSequenceBaseCase(ce, seqName, index, value);
      return ce.Nothing;
    }

    // Case 2: Symbol subscript → check for self-reference
    // e.g., a_n := a_{n-1} + 1  vs  f_n := 2*n + 1
    if (subscript?.symbol) {
      const indexVar = subscript.symbol;

      if (containsSelfReference(rhs, seqName)) {
        // Sequence recurrence definition
        addSequenceRecurrence(ce, seqName, indexVar, rhs);
        return ce.Nothing;
      } else {
        // Function definition (no self-reference)
        // Convert to: ['Assign', seqName, ['Function', rhs, indexVar]]
        const fnDef = ce.function('Function', [rhs, ce.symbol(indexVar)]);
        ce.assign(seqName, fnDef);
        return ce.Nothing;
      }
    }

    // Case 3: Complex subscript with self-reference → recurrence
    // e.g., a_{n+1} := a_n + 1
    if (containsSelfReference(rhs, seqName)) {
      // Extract variable from subscript expression
      const indexVar = extractIndexVariable(subscript);
      if (indexVar) {
        addSequenceRecurrence(ce, seqName, indexVar, rhs);
        return ce.Nothing;
      }
    }
  }

  // ... existing Assign logic for non-subscript cases
}
```

##### Step 5: Add Sequence Accumulation Helpers

**File:** `src/compute-engine/sequence.ts` (extend existing file)

```typescript
// Track pending sequence definitions (base cases + recurrence)
const pendingSequences = new WeakMap<ComputeEngine, Map<string, {
  base: Map<number, BoxedExpression>;
  recurrence?: { variable: string; expr: BoxedExpression };
}>>();

function getOrCreatePending(ce: ComputeEngine, name: string) {
  if (!pendingSequences.has(ce)) {
    pendingSequences.set(ce, new Map());
  }
  const map = pendingSequences.get(ce)!;
  if (!map.has(name)) {
    map.set(name, { base: new Map() });
  }
  return map.get(name)!;
}

export function addSequenceBaseCase(
  ce: ComputeEngine,
  name: string,
  index: number,
  value: BoxedExpression
): void {
  const pending = getOrCreatePending(ce, name);
  pending.base.set(index, value);
  tryFinalizeSequence(ce, name);
}

export function addSequenceRecurrence(
  ce: ComputeEngine,
  name: string,
  variable: string,
  expr: BoxedExpression
): void {
  const pending = getOrCreatePending(ce, name);
  pending.recurrence = { variable, expr };
  tryFinalizeSequence(ce, name);
}

function tryFinalizeSequence(ce: ComputeEngine, name: string): void {
  const pending = getOrCreatePending(ce, name);

  // Need both base case(s) and recurrence to finalize
  if (pending.base.size === 0 || !pending.recurrence) return;

  // Convert to SequenceDefinition and declare
  const base: Record<number, BoxedExpression> = {};
  for (const [k, v] of pending.base) {
    base[k] = v;
  }

  ce.declareSequence(name, {
    variable: pending.recurrence.variable,
    base,
    recurrence: pending.recurrence.expr,
  });

  // Clear pending
  pendingSequences.get(ce)!.delete(name);
}

/**
 * Check if expression contains self-reference to sequence name.
 * e.g., a_{n-1} in the RHS when defining sequence 'a'
 */
export function containsSelfReference(
  expr: BoxedExpression,
  seqName: string
): boolean {
  if (expr.operator === 'Subscript' && expr.op1?.symbol === seqName) {
    return true;
  }
  if (expr.ops) {
    return expr.ops.some(op => containsSelfReference(op, seqName));
  }
  return false;
}

/**
 * Extract the index variable from a subscript expression.
 * e.g., from n-1 extract 'n', from 2*k extract 'k'
 */
export function extractIndexVariable(
  subscript: BoxedExpression
): string | undefined {
  // Simple symbol
  if (subscript.symbol) return subscript.symbol;

  // Look for symbol in expression (first symbol found)
  const symbols = subscript.symbols;
  if (symbols.length === 1) return symbols[0];

  // Multiple symbols or no symbols - ambiguous
  return undefined;
}
```

### Order Independence

The design allows base cases and recurrence to be defined in any order:

```typescript
// Order 1: Base first, then recurrence
ce.parse('F_0 := 0').evaluate();
ce.parse('F_1 := 1').evaluate();
ce.parse('F_n := F_{n-1} + F_{n-2}').evaluate();  // Finalized here

// Order 2: Recurrence first, then bases
ce.parse('a_n := a_{n-1} + 1').evaluate();  // Stored as pending
ce.parse('a_0 := 1').evaluate();             // Finalized here
```

### Disambiguation: Function vs Sequence

The key distinction is **self-reference**:

| Definition                 | Self-Reference        | Result                     |
| -------------------------- | --------------------- | -------------------------- |
| `f_n := 2*n + 1`           | No                    | Function: `f(n) = 2n + 1`  |
| `a_n := a_{n-1} + 1`       | Yes (`a_{n-1}`)       | Sequence recurrence        |
| `g_n := g_{n-1} * g_{n-2}` | Yes                   | Sequence recurrence        |
| `h_n := f_{n-1}`           | No (different symbol) | Function: `h(n) = f_{n-1}` |

### Edge Cases

#### 1. Redefinition

If a sequence is already fully defined, subsequent assignments should:

- **Option A**: Error ("Sequence already defined")
- **Option B**: Override/reset the sequence
- **Option C**: Add additional base cases only

Recommended: **Option A** for recurrence, **Option C** for base cases.

#### 2. Incomplete Sequences

If only recurrence or only base cases are provided, the sequence remains
"pending" and subscript evaluation returns `undefined` (symbolic).

#### 3. Single-Letter vs Multi-Letter Symbols

LaTeX parses multi-letter sequences as products:

- `fib_n` → `f * i * b * Subscript(?)` (not what we want)
- `F_n` → `Subscript(F, n)` (correct)

Solution: Use single-letter names or `\operatorname{}`:

```latex
\operatorname{fib}_n := \operatorname{fib}_{n-1} + \operatorname{fib}_{n-2}
```

#### 4. Reserved Symbols

Some single letters are reserved (e.g., `G` → CatalanConstant):

```latex
G_n := ...  // Parses as Subscript(CatalanConstant, n)
```

Users must avoid these or use `\operatorname{}`.

### Test Cases

```typescript
describe('LaTeX-Based Sequence Definitions (SUB-5)', () => {
  test('Arithmetic sequence via LaTeX', () => {
    const ce = new ComputeEngine();
    ce.parse('L_0 := 1').evaluate();
    ce.parse('L_n := L_{n-1} + 2').evaluate();
    expect(ce.parse('L_{5}').evaluate().re).toBe(11);
  });

  test('Fibonacci via LaTeX', () => {
    const ce = new ComputeEngine();
    ce.parse('F_0 := 0').evaluate();
    ce.parse('F_1 := 1').evaluate();
    ce.parse('F_n := F_{n-1} + F_{n-2}').evaluate();
    expect(ce.parse('F_{10}').evaluate().re).toBe(55);
  });

  test('Recurrence first, then base case', () => {
    const ce = new ComputeEngine();
    ce.parse('A_n := A_{n-1} + 1').evaluate();
    ce.parse('A_0 := 0').evaluate();
    expect(ce.parse('A_{5}').evaluate().re).toBe(5);
  });

  test('Function definition (no self-reference)', () => {
    const ce = new ComputeEngine();
    ce.parse('f_n := 2*n + 1').evaluate();
    expect(ce.parse('f(3)').evaluate().re).toBe(7);  // Function, not sequence
  });

  test('Factorial via LaTeX', () => {
    const ce = new ComputeEngine();
    ce.parse('H_0 := 1').evaluate();
    ce.parse('H_n := n * H_{n-1}').evaluate();
    expect(ce.parse('H_{5}').evaluate().re).toBe(120);
  });

  test('Braced subscript base case', () => {
    const ce = new ComputeEngine();
    ce.parse('C_{0} := 10').evaluate();
    ce.parse('C_{n} := C_{n-1} + 5').evaluate();
    expect(ce.parse('C_{3}').evaluate().re).toBe(25);
  });

  test('Complex subscript recurrence', () => {
    const ce = new ComputeEngine();
    ce.parse('B_0 := 1').evaluate();
    ce.parse('B_{n+1} := B_n + 1').evaluate();  // a_{n+1} style
    expect(ce.parse('B_{5}').evaluate().re).toBe(6);
  });
});
```

### Files to Modify

| File                                                             | Change                                                               |
| ---------------------------------------------------------------- | -------------------------------------------------------------------- |
| `src/compute-engine/latex-syntax/dictionary/definitions-core.ts` | Modify `parseAssign` to preserve Subscript for symbol subscripts     |
| `src/compute-engine/latex-syntax/parse-symbol.ts`                | Add assignment context detection to prevent compound symbol creation |
| `src/compute-engine/latex-syntax/parse.ts`                       | Add `lookAheadForAssignment()` method                                |
| `src/compute-engine/latex-syntax/types.ts`                       | Add parser option if needed                                          |
| `src/compute-engine/library/core.ts`                             | Update `Assign` evaluate handler for sequence detection              |
| `src/compute-engine/sequence.ts`                                 | Add accumulation helpers and self-reference detection                |
| `test/compute-engine/sequences.test.ts`                          | Add LaTeX-based sequence tests                                       |

### Implementation Phases

#### Phase 5a: Parser Changes

1. Add `lookAheadForAssignment()` to Parser
2. Modify `parseSymbol` to check assignment context
3. Modify `parseAssign` to preserve Subscript

#### Phase 5b: Evaluate Handler Changes

1. Add `containsSelfReference()` helper
2. Add `addSequenceBaseCase()` and `addSequenceRecurrence()` helpers
3. Modify `Assign` evaluate handler
4. Add `tryFinalizeSequence()` to connect to existing `declareSequence()`

#### Phase 5c: Testing and Documentation

1. Add comprehensive tests
2. Update documentation
3. Handle edge cases

### Backward Compatibility

**Breaking change:** `f_n := expr` where `expr` does NOT contain self-references
will now create a function `f(n) = expr` instead of
`['Assign', 'f', ['Function', expr, 'n']]`.

The semantic result is the same, but the MathJSON representation changes from:

```json
["Assign", "f", ["Function", "expr", "n"]]
```

to:

```json
["Assign", ["Subscript", "f", "n"], "expr"]
```

Mitigation: The evaluate handler converts non-self-referencing cases to function
definitions, so runtime behavior is preserved.

---

## Future Extensions

The following enhancements could be added to the sequence feature in future
phases. They are ordered roughly by complexity and dependency.

### SUB-6: Improved Error Messages and Status Reporting ✅ IMPLEMENTED

**Priority:** High
**Complexity:** Low

#### Problem

When a sequence is partially defined (only base case or only recurrence), it
silently remains in a "pending" state. Users have no way to know why their
sequence isn't evaluating.

#### Proposed Solution

1. **Warning on incomplete evaluation**: When evaluating `F_{10}` and `F` has
   only base cases or only recurrence defined, return an informative error
   expression instead of `undefined`:

   ```typescript
   ce.parse('F_0 := 0').evaluate();
   ce.parse('F_{10}').evaluate();
   // → Error("incomplete-sequence", "Sequence 'F' has base case(s) but no recurrence")
   ```

2. **Query pending sequences**: Add API to check sequence status:

   ```typescript
   ce.getSequenceStatus('F');
   // → { defined: false, hasBase: true, hasRecurrence: false, baseIndices: [0] }
   ```

3. **Console warning**: Optionally emit a console warning when a sequence
   remains pending for too long (e.g., at end of parse session).

#### Files to Modify

| File                             | Change                              |
| -------------------------------- | ----------------------------------- |
| `src/compute-engine/sequence.ts` | Add status tracking and query API   |
| `src/compute-engine/index.ts`    | Add `getSequenceStatus()` method    |
| `src/compute-engine/library/core.ts` | Return informative errors for pending sequences |

---

### SUB-7: Sequence Introspection API

**Priority:** Medium
**Complexity:** Low

#### Problem

Users cannot programmatically query what sequences are defined, their
definitions, or modify them after creation.

#### Proposed API

```typescript
// Get sequence definition
const fibDef = ce.getSequence('F');
// → { variable: 'n', base: { 0: 0, 1: 1 }, recurrence: BoxedExpression, memoized: true }

// List all defined sequences
ce.listSequences();
// → ['F', 'A', 'T']

// Check if a symbol is a sequence
ce.isSequence('F');  // → true
ce.isSequence('x');  // → false

// Clear memoization cache (useful for memory management)
ce.clearSequenceCache('F');
ce.clearSequenceCache();  // Clear all

// Get cached values
ce.getSequenceCache('F');
// → Map { 0 => 0, 1 => 1, 2 => 1, 3 => 2, ... }
```

#### Use Cases

- **Debugging**: Inspect sequence definitions to verify correctness
- **Memory management**: Clear caches for large sequences
- **Serialization**: Export/import sequence definitions
- **Testing**: Verify sequence state in unit tests

---

### SUB-8: Generate Sequence Terms

**Priority:** Medium
**Complexity:** Low-Medium

#### Problem

Users often want to generate a list of sequence terms, but currently must
evaluate each term individually.

#### Proposed API

```typescript
// Generate terms as a list
ce.parse('F').terms(0, 10);
// → [0, 1, 1, 2, 3, 5, 8, 13, 21, 34, 55]

// Or via a function
ce.box(['SequenceTerms', 'F', 0, 10]).evaluate();
// → ["List", 0, 1, 1, 2, 3, 5, 8, 13, 21, 34, 55]

// With step
ce.parse('F').terms(0, 20, 2);  // Every other term
// → [0, 1, 3, 8, 21, 55, 144, 377, 987, 2584, 6765]

// LaTeX syntax
ce.parse('\\{F_n\\}_{n=0}^{10}').evaluate();
// → ["List", 0, 1, 1, 2, 3, 5, 8, 13, 21, 34, 55]
```

#### Implementation Notes

- Leverage existing memoization for efficiency
- Return a `List` expression for further manipulation
- Consider lazy evaluation for large ranges

---

### SUB-9: Multi-Index Sequences

**Priority:** Medium
**Complexity:** Medium-High

#### Problem

Many mathematical sequences have multiple indices: Pascal's triangle
(`P_{n,k}`), binomial coefficients, Stirling numbers, etc.

#### Proposed API

```typescript
// Pascal's triangle: P_{n,k} = P_{n-1,k-1} + P_{n-1,k}
ce.declareSequence('P', {
  variables: ['n', 'k'],
  base: {
    '0,0': 1,
    'n,0': 1,      // Boundary: P_{n,0} = 1 for all n ≥ 0
    'n,n': 1,      // Boundary: P_{n,n} = 1 for all n ≥ 0
  },
  recurrence: 'P_{n-1,k-1} + P_{n-1,k}',
  domain: { n: { min: 0 }, k: { min: 0 } },
  constraints: 'k <= n',  // Valid only when k ≤ n
});

ce.parse('P_{5,2}').evaluate();  // → 10

// LaTeX syntax
ce.parse('P_{0,0} := 1').evaluate();
ce.parse('P_{n,0} := 1').evaluate();
ce.parse('P_{n,n} := 1').evaluate();
ce.parse('P_{n,k} := P_{n-1,k-1} + P_{n-1,k}').evaluate();
```

#### Challenges

1. **Boundary conditions**: Need pattern matching for conditions like `n,0` and
   `n,n`
2. **Constraints**: Must handle validity constraints like `k ≤ n`
3. **Evaluation order**: Multi-index recurrences may have complex dependency
   graphs
4. **Memoization**: Need multi-key memoization (e.g., `Map<string, value>` with
   `"n,k"` keys)

#### Implementation Phases

1. **Phase 9a**: Support explicit numeric multi-index base cases (`'5,2': 10`)
2. **Phase 9b**: Support pattern base cases (`'n,0': 1`)
3. **Phase 9c**: Support constraints and domain validation
4. **Phase 9d**: LaTeX syntax for multi-index definitions

---

### SUB-10: Closed-Form Detection

**Priority:** Low
**Complexity:** High

#### Problem

Simple sequences have well-known closed-form solutions. Evaluating large indices
via recurrence is inefficient when a direct formula exists.

#### Detectable Patterns

| Recurrence Type           | Closed Form                      | Example             |
| ------------------------- | -------------------------------- | ------------------- |
| `a_n = a_{n-1} + d`       | `a_n = a_0 + n·d`                | Arithmetic          |
| `a_n = r · a_{n-1}`       | `a_n = a_0 · r^n`                | Geometric           |
| `a_n = a_{n-1} + n`       | `a_n = a_0 + n(n+1)/2`           | Triangular          |
| `a_n = c · a_{n-1} + d`   | `a_n = c^n·a_0 + d·(c^n-1)/(c-1)`| Linear non-homogeneous |
| `a_n = a_{n-1} + a_{n-2}` | Binet's formula                  | Fibonacci           |

#### Proposed Behavior

```typescript
ce.declareSequence('A', {
  base: { 0: 1 },
  recurrence: 'A_{n-1} + 2',
  detectClosedForm: true,  // Optional, default false
});

// Internally detects: a_n = 1 + 2n
// Large indices computed directly without recursion
ce.parse('A_{1000000}').evaluate();  // → 2000001 (instant)

// Query the detected form
ce.getSequence('A').closedForm;
// → ce.parse('1 + 2*n')
```

#### Implementation Approach

1. **Pattern matching**: Analyze recurrence structure to identify known patterns
2. **Solving**: For linear recurrences, solve characteristic equation
3. **Verification**: Verify closed form matches base cases
4. **Hybrid evaluation**: Use closed form for large `n`, recurrence for small `n`

#### Complexity Warning

This is algorithmically complex and may not be worth implementing unless there's
strong user demand. The memoization approach handles most practical cases
efficiently.

---

### SUB-11: Summation and Product Integration

**Priority:** Medium
**Complexity:** Medium

#### Problem

Users want to compute sums and products over sequence terms:

```latex
\sum_{k=0}^{n} F_k \quad \text{(sum of first n+1 Fibonacci numbers)}
\prod_{k=1}^{n} a_k \quad \text{(product of sequence terms)}
```

Currently, `Sum` and `Product` don't know how to iterate over user-defined
sequences.

#### Proposed Behavior

```typescript
// Define Fibonacci
ce.parse('F_0 := 0').evaluate();
ce.parse('F_1 := 1').evaluate();
ce.parse('F_n := F_{n-1} + F_{n-2}').evaluate();

// Sum over sequence
ce.parse('\\sum_{k=0}^{10} F_k').evaluate();
// → 143 (sum of F_0 through F_10)

// Product
ce.parse('\\prod_{k=1}^{5} A_k').evaluate();
// (where A is some defined sequence)

// Symbolic bounds stay symbolic
ce.parse('\\sum_{k=0}^{n} F_k').simplify();
// → F_{n+2} - 1 (known identity, if closed-form detection is implemented)
```

#### Implementation

**Status: Already Works!** ✅

The existing `Sum` and `Product` implementations use `reduceBigOp`, which
evaluates the body for each iteration value. When the body contains a subscripted
sequence expression (e.g., `F_k`), the evaluation naturally invokes the
sequence's `subscriptEvaluate` handler.

```typescript
// This already works:
ce.parse('\\sum_{k=0}^{10} F_k').evaluate();  // → 143

ce.parse('\\prod_{k=1}^{5} B_k').evaluate();  // Works if B is a defined sequence
```

No special handling is needed because:
1. `reduceBigOp` substitutes the iteration variable and evaluates
2. Evaluation of `F_k` triggers `Subscript` canonicalization
3. `Subscript` calls `subscriptEvaluate` which invokes the sequence handler

**Future enhancements** (not currently implemented):
- Known identities: Recognize summation formulas (requires SUB-10)
- Symbolic bounds: Keep sum symbolic when bounds contain variables

---

### SUB-12: OEIS Integration (Research)

**Priority:** Low
**Complexity:** Medium

#### Concept

The [Online Encyclopedia of Integer Sequences (OEIS)](https://oeis.org) contains
over 350,000 integer sequences. Integration could enable:

```typescript
// Look up a sequence by terms
ce.lookupSequence([0, 1, 1, 2, 3, 5, 8, 13]);
// → { id: 'A000045', name: 'Fibonacci numbers', formula: '...' }

// Import a sequence from OEIS
ce.importSequence('A000045');  // Fibonacci
ce.parse('A000045_{10}').evaluate();  // → 55

// Generate sequence and check against OEIS
ce.checkSequence('F', 20);  // Verify first 20 terms match OEIS A000045
```

#### Implementation Considerations

- Requires network access (optional feature)
- OEIS has a JSON API for lookups
- Could cache commonly-used sequences locally
- Privacy considerations for sending sequence data

---

### Documentation Improvements

#### Getting Started Guide

The sequence feature is user-friendly and could be highlighted in introductory
documentation:

- Add to "Quick Start" section showing simple Fibonacci definition
- Include in tutorial flow after basic arithmetic and symbolic computation
- Create interactive examples in the demo page (see `doc/02-compute-engine-demo.md`)

#### API Reference

- Document all sequence-related methods in API.md
- Add type definitions for `SequenceDefinition`
- Include examples for each option (memoize, domain, variable)

#### Cookbook/Recipes

Create a "Sequences Cookbook" with examples:

- Common sequences (Fibonacci, triangular, factorial, Catalan)
- Custom sequences (user-defined recurrences)
- Combining sequences with other operations
- Performance tips (memoization, domain constraints)

---

### Implementation Priority Matrix

| Extension | Priority | Complexity | Dependencies | Status |
| --------- | -------- | ---------- | ------------ | ------ |
| SUB-6: Error messages | High | Low | None | ✅ Done |
| SUB-7: Introspection | Medium | Low | None | ✅ Done |
| SUB-8: Generate terms | Medium | Low-Medium | None | ✅ Done |
| SUB-9: Multi-index | Medium | Medium-High | None | |
| SUB-10: Closed-form | Low | High | None | |
| SUB-11: Summation | Medium | Medium | SUB-8 (partial) | ✅ Done* |
| SUB-12: OEIS | Low | Medium | Network access | ✅ Done |

Recommended order: SUB-6 → SUB-7 → SUB-8 → SUB-11 → SUB-9 → SUB-10 → SUB-12
