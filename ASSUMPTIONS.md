# Implementation Plan: Assumptions Applied During Simplification

## Problem Statement

When users declare assumptions like `x > 0`, simplification rules should use
this information. Currently, they don't.

**Current behavior:**

```typescript
ce.assume(ce.parse('x > 0'));
ce.parse('\\sqrt{x^2}').simplify().toLatex();
// Returns: "|x|"
// Expected: "x" (since x > 0)
```

## Root Cause Analysis

### How Assumptions Are Stored

When `ce.assume(ce.parse('x > 0'))` is called:

1. `assume.ts:assumeInequality()` processes the inequality
2. The proposition `['Greater', 'x', 0]` is stored in `ce.context.assumptions`
   (a Map)
3. The symbol `x` is declared with type `'real'` if not already defined

**Location:** `src/compute-engine/assume.ts:272-367`

### How Sign Properties Are Queried

When simplification checks `base.isNonNegative`:

1. `BoxedSymbol.isNonNegative` calls `nonNegativeSign(this.sgn)` (line 591-592)
2. `BoxedSymbol.sgn` returns `this.value?.sgn` (line 554-556)
3. **Problem:** This only checks if the symbol has an assigned VALUE, not its
   ASSUMPTIONS

**Location:** `src/compute-engine/boxed-expression/boxed-symbol.ts:554-593`

### The Simplification Rule That Should Work

The rule exists and correctly checks for non-negativity:

```typescript
// simplify-power.ts:114-116
if (exp.is(2) && base.isNonNegative === true) {
  return { value: base, because: 'sqrt(x^2) -> x when x >= 0' };
}
```

**The rule is correct.** The problem is that `base.isNonNegative` returns
`undefined` instead of `true` when there's an assumption but no assigned value.

## Solution Design

### Option A: Enhance BoxedSymbol.sgn (Recommended)

Modify `BoxedSymbol.sgn` to query assumptions when there's no assigned value.

**Pros:**

- Single point of change
- All sign-dependent properties automatically work
- Consistent with how other properties work

**Cons:**

- May have performance implications (need to query assumptions)
- Need to handle compound assumptions carefully

### Option B: Add assumption-aware property getters

Add separate getters like `isNonNegativeWithAssumptions`.

**Pros:**

- Explicit about when assumptions are used
- No risk of breaking existing behavior

**Cons:**

- Requires updating all simplification rules
- Code duplication

### Option C: Cache assumption-derived signs in symbol definition

When an assumption is made, update the symbol's definition with sign
information.

**Pros:**

- Fast lookups (no runtime assumption queries)
- Clean separation of concerns

**Cons:**

- Need to maintain consistency when assumptions change
- Complex with compound assumptions

## Recommended Implementation: Option A

### Phase 1: Core Sign Resolution

#### 1.1 Create assumption query helper

**File:** `src/compute-engine/assume.ts`

```typescript
/**
 * Query assumptions to determine the sign of a symbol.
 * Returns undefined if no relevant assumptions found.
 */
export function getSignFromAssumptions(
  ce: IComputeEngine,
  symbol: string
): Sign | undefined {
  const assumptions = ce.context.assumptions;
  if (!assumptions || assumptions.size === 0) return undefined;

  for (const [assumption, _] of assumptions) {
    // Check for direct inequalities involving the symbol
    // x > 0 → 'positive'
    // x >= 0 → 'non-negative'
    // x < 0 → 'negative'
    // x <= 0 → 'non-positive'

    const op = assumption.operator;
    if (!op) continue;

    // Handle: Greater(x, 0), Less(x, 0), etc.
    if (['Greater', 'GreaterEqual', 'Less', 'LessEqual'].includes(op)) {
      const [lhs, rhs] = assumption.ops ?? [];
      if (!lhs || !rhs) continue;

      // Check if this assumption is about our symbol compared to 0
      if (lhs.symbol === symbol && rhs.is(0)) {
        if (op === 'Greater') return 'positive';
        if (op === 'GreaterEqual') return 'non-negative';
        if (op === 'Less') return 'negative';
        if (op === 'LessEqual') return 'non-positive';
      }

      // Handle reversed form: 0 < x, 0 > x, etc.
      if (rhs.symbol === symbol && lhs.is(0)) {
        if (op === 'Less') return 'positive';      // 0 < x means x > 0
        if (op === 'LessEqual') return 'non-negative';
        if (op === 'Greater') return 'negative';   // 0 > x means x < 0
        if (op === 'GreaterEqual') return 'non-positive';
      }
    }
  }

  return undefined;
}
```

#### 1.2 Update BoxedSymbol.sgn

**File:** `src/compute-engine/boxed-expression/boxed-symbol.ts`

```typescript
get sgn(): Sign | undefined {
  // First check if there's an assigned value
  if (this.value) return this.value.sgn;

  // Then check assumptions
  return getSignFromAssumptions(this.engine, this.name);
}
```

### Phase 2: Handle Compound Expressions

#### 2.1 Ensure BoxedFunction.sgn propagates correctly

The `BoxedFunction.sgn` getter already calls operator-defined `sgn` functions.
These should work automatically once the symbol signs are correct.

**Verify:** `src/compute-engine/boxed-expression/boxed-function.ts:491-500`

#### 2.2 Handle expressions like `x^2` where x > 0

The `Power` operator's `sgn` function should already handle this:

- If base > 0, then base^n > 0 for any real n

**Verify:** `src/compute-engine/library/arithmetic.ts` - Power sgn function

### Phase 3: Extended Patterns

#### 3.1 Absolute value simplification

With assumptions working, `|x|` should simplify to `x` when `x >= 0`.

**Verify:** `src/compute-engine/symbolic/simplify-abs.ts:51-54`

```typescript
// Already exists:
if (x.isNonNegative === true) {
  return { value: x, because: '|x| -> x when x >= 0' };
}
```

#### 3.2 Even roots

`√[4]{x^4}` should simplify to `x` when `x >= 0`.

**Verify:** `src/compute-engine/symbolic/simplify-power.ts:36-45`

#### 3.3 Sign-dependent power rules

`(-x)^n` rules should work with assumptions about x.

### Phase 4: Testing

#### 4.1 Enable existing skipped tests

**File:** `test/compute-engine/assumptions.test.ts`

Remove `.skip` from test blocks and verify they pass.

#### 4.2 Add new assumption-based simplification tests

```typescript
describe('ASSUMPTION-BASED SIMPLIFICATION', () => {
  let ce: ComputeEngine;

  beforeEach(() => {
    ce = new ComputeEngine();
  });

  test('sqrt(x^2) with x > 0', () => {
    ce.assume(ce.parse('x > 0'));
    expect(ce.parse('\\sqrt{x^2}').simplify().latex).toBe('x');
  });

  test('sqrt(x^2) with x >= 0', () => {
    ce.assume(ce.parse('x \\ge 0'));
    expect(ce.parse('\\sqrt{x^2}').simplify().latex).toBe('x');
  });

  test('sqrt(x^2) with x < 0', () => {
    ce.assume(ce.parse('x < 0'));
    expect(ce.parse('\\sqrt{x^2}').simplify().latex).toBe('-x');
  });

  test('|x| with x > 0', () => {
    ce.assume(ce.parse('x > 0'));
    expect(ce.parse('|x|').simplify().latex).toBe('x');
  });

  test('|x| with x < 0', () => {
    ce.assume(ce.parse('x < 0'));
    expect(ce.parse('|x|').simplify().latex).toBe('-x');
  });

  test('fourth root of x^4 with x > 0', () => {
    ce.assume(ce.parse('x > 0'));
    expect(ce.parse('\\sqrt[4]{x^4}').simplify().latex).toBe('x');
  });

  test('assumptions do not leak between sessions', () => {
    ce.assume(ce.parse('x > 0'));
    const ce2 = new ComputeEngine();
    // x should have unknown sign in ce2
    expect(ce2.parse('\\sqrt{x^2}').simplify().latex).toBe('|x|');
  });

  test('compound expression sign propagation', () => {
    ce.assume(ce.parse('x > 0'));
    ce.assume(ce.parse('y > 0'));
    // x * y > 0, so sqrt((xy)^2) = xy
    expect(ce.parse('\\sqrt{(xy)^2}').simplify().latex).toBe('xy');
  });
});
```

## Implementation Order

1. **Phase 1.1:** Create `getSignFromAssumptions()` helper
2. **Phase 1.2:** Update `BoxedSymbol.sgn` to use the helper
3. **Phase 4.2:** Add basic tests to verify core functionality works
4. **Phase 2:** Verify compound expressions work (may need no changes)
5. **Phase 3:** Verify extended patterns work (may need no changes)
6. **Phase 4.1:** Enable skipped tests, fix any that fail

## Performance Considerations

- Assumption queries happen during simplification, which can be called
  frequently
- The `context.assumptions` Map is typically small (< 100 entries)
- Consider caching sign information if performance becomes an issue
- May want to add a fast path: if no assumptions exist, skip the query

## Edge Cases to Handle

1. **Multiple assumptions about same symbol:**
   - `x > 0` and `x < 10` → sign is 'positive'
   - Contradictory assumptions should be caught by `assume()`

2. **Assumptions about expressions:**
   - `x + y > 0` doesn't directly tell us sign of x or y
   - For now, only handle direct symbol-to-constant comparisons

3. **Symbolic bounds:**
   - `x > a` where a is another symbol
   - Cannot determine sign without knowing sign of a
   - Return undefined in these cases

4. **Scope considerations:**
   - Assumptions are stored in `ce.context`
   - They should be properly scoped and not leak

## Files to Modify

| File                                                  | Changes                        |
| ----------------------------------------------------- | ------------------------------ |
| `src/compute-engine/assume.ts`                        | Add `getSignFromAssumptions()` |
| `src/compute-engine/boxed-expression/boxed-symbol.ts` | Update `sgn` getter            |
| `test/compute-engine/assumptions.test.ts`             | Enable tests, add new tests    |

## Success Criteria

1. `ce.assume(ce.parse('x > 0')); ce.parse('\\sqrt{x^2}').simplify()` returns
   `x`
2. `ce.assume(ce.parse('x >= 0')); ce.parse('|x|').simplify()` returns `x`
3. `ce.assume(ce.parse('x < 0')); ce.parse('\\sqrt{x^2}').simplify()` returns
   `-x`
4. All existing tests continue to pass
5. Previously skipped assumption tests pass (or are documented as known
   limitations)
