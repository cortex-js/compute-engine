# Permutation Matching Optimization: Synthesis and Recommendations

## Implementation Status

| Phase | Description                | Status      |
| ----- | -------------------------- | ----------- |
| 1.1   | Arity Guard                | ✅ Complete |
| 1.2   | Anchor Fingerprint         | ✅ Complete |
| 2     | Universal Anchoring        | ✅ Complete |
| 3     | Hash Bucketing             | ✅ Complete |

All phases implemented in `src/compute-engine/boxed-expression/match.ts`.
Tests added in `test/compute-engine/patterns.test.ts`.

---

## Overview

This document synthesizes the findings from PERMS-5 (Targeted Pruning Plan) and
PERMS-17 (Optimization Research) into a unified implementation strategy for
optimizing commutative pattern matching in the compute-engine.

## Problem Statement

Both documents identify the same core issue in
`src/compute-engine/boxed-expression/match.ts`:

**The anchor-based optimization (`matchCommutativeWithAnchors`) only activates
for patterns containing sequence wildcards (`__`/`___`). Patterns with only
universal wildcards (`_`) plus literal anchors fall back to full permutation
enumeration, even when quick structural checks could reject them immediately.**

### Illustrative Example

```
Pattern:    ['Add', '_a', '_b', '_c', 0]   (3 wildcards + literal 0)
Expression: ['Add', 'x', 'y', 'z']         (3 symbols, no zeros)
```

**Current behavior**: Generates up to 4! = 24 permutations before failing.
**Optimal behavior**: Immediate rejection—arity mismatch (4 vs 3) and missing
literal anchor (0).

## Synthesis of Proposed Optimizations

Both documents propose similar optimizations with different emphases. Here's the
unified view:

| Concept                     | PERMS-5                       | PERMS-17                   | Unified Name            |
| --------------------------- | ----------------------------- | -------------------------- | ----------------------- |
| Length/arity check          | Arity feasibility check       | Type cardinality pruning   | **Arity Guard**         |
| Literal/anchor verification | Ground operand containment    | Literal fingerprinting     | **Anchor Fingerprint**  |
| Extend anchor algorithm     | Generalize to all patterns    | Extend anchor-based        | **Universal Anchoring** |
| Performance optimization    | Hash-bucketed containment     | —                          | **Hash Bucketing**      |
| Advanced matching           | —                             | Constraint propagation     | **CSP Matching**        |
| Broader anchor definition   | Ground operands (any non-WC)  | Symbolic anchor detection  | **Full Anchor Scope**   |

## Recommended Implementation Plan

### Phase 1: Quick Wins (High Impact, Low Risk)

#### 1.1 Arity Guard

Insert at the start of `matchPermutation()`:

```typescript
// Quick rejection: arity mismatch
const wildcardInfo = analyzeWildcards(patternOps);
if (wildcardInfo.sequenceCount === 0) {
  // Without sequence wildcards, lengths must match exactly
  if (exprOps.length !== patternOps.length) return null;
} else {
  // With sequence wildcards, ensure minimum operands available
  const minRequired = wildcardInfo.anchorCount + wildcardInfo.universalCount;
  if (exprOps.length < minRequired) return null;
}
```

**Rationale**: Both documents agree this is trivial to implement and catches
many mismatches. PERMS-5's arity check and PERMS-17's cardinality pruning are
essentially the same concept.

#### 1.2 Anchor Fingerprint

Before permutation attempts, verify all ground/literal operands exist in the
expression:

```typescript
function verifyAnchorsPresent(
  patternOps: BoxedExpression[],
  exprOps: BoxedExpression[]
): boolean {
  // Collect pattern operands with no wildcards (ground operands)
  const anchors = patternOps.filter(op => !hasWildcards(op));
  const available = [...exprOps]; // Copy to allow splicing

  for (const anchor of anchors) {
    const idx = available.findIndex(e => e.isSame(anchor));
    if (idx === -1) return false;
    available.splice(idx, 1); // Handle multiplicity
  }
  return true;
}
```

**Note**: PERMS-5 uses `hasWildcards()` for ground operand detection (broader),
while PERMS-17 focuses on `isNumberLiteral` (narrower). **Recommendation**: Use
the broader definition—any pattern operand without wildcards is an anchor.

### Phase 2: Algorithm Extension (High Impact, Medium Complexity)

#### 2.1 Universal Anchoring

Extend `matchCommutativeWithAnchors()` to handle **all** patterns with anchors,
not just those with sequence wildcards.

**Current code** (approximately line 439):

```typescript
if (hasSequenceWildcard && hasAnchor) {
  const result = matchCommutativeWithAnchors(...);
}
```

**Proposed change**:

```typescript
if (hasAnchor) {
  const result = matchCommutativeWithAnchors(...);
  if (result !== null) return result;
  // Fall through to permutation only for edge cases
}
```

Both documents strongly recommend this. The anchor-based algorithm uses
specificity ordering and backtracking, which is more efficient than blind
permutation for patterns with concrete anchors.

### Phase 3: Performance Enhancements (Medium Impact, Optional)

#### 3.1 Hash Bucketing (from PERMS-5)

For expressions with many operands, bucket by `BoxedExpression.hash` before
`isSame()` comparisons:

```typescript
function buildHashIndex(ops: BoxedExpression[]): Map<number, BoxedExpression[]> {
  const index = new Map<number, BoxedExpression[]>();
  for (const op of ops) {
    const h = op.hash;
    if (!index.has(h)) index.set(h, []);
    index.get(h)!.push(op);
  }
  return index;
}
```

**When to use**: Only beneficial for patterns with many anchors (4+) against
large expressions. Not needed for the common case.

#### 3.2 Constraint Propagation (from PERMS-17)

A constraint satisfaction approach where matching one anchor propagates type
constraints to remaining wildcards. This is a larger undertaking and should be
considered a future enhancement after the core optimizations are validated.

## Critical Implementation Notes

### Preserve Repeat-Wildcard Semantics

Both documents warn about patterns like `_a + _a` (same wildcard twice). The
optimization must not short-circuit based on count alone when repeated wildcard
names exist—the same operand must genuinely appear twice.

**The existing `captureWildcard()` mechanism handles this correctly**; we just
need to ensure the new guards don't bypass it.

### Maintain Fallback Path

Keep the permutation-based matching as a safety net for edge cases. The new
optimizations should reject impossible matches early but defer to the existing
algorithm for anything that passes the guards.

### Testing Strategy

Create benchmarks for:

1. **Pathological cases**: Pattern with anchors, expression without them
2. **Near-misses**: Expression has similar but not matching anchors
3. **Large operand counts**: Test near the 6-element permutation limit
4. **Nested structures**: Patterns with function-expression anchors

## Summary: Implementation Order

| Step | Change                              | Location                           | Complexity |
| ---- | ----------------------------------- | ---------------------------------- | ---------- |
| 1    | Arity guard                         | `matchPermutation()` entry         | Low        |
| 2    | Anchor fingerprint check            | `matchPermutation()` after arity   | Low        |
| 3    | Extend anchor-based to all patterns | `matchPermutation()` condition     | Medium     |
| 4    | Hash bucketing (optional)           | New helper function                | Low        |
| 5    | Constraint propagation (future)     | Major refactor                     | High       |

## Files to Modify

- `src/compute-engine/boxed-expression/match.ts` — Primary changes
- `test/compute-engine/match.test.ts` — New test cases for early rejection

---

## Detailed Implementation Plan

### Target File

`src/compute-engine/boxed-expression/match.ts` — Function `matchPermutation()`
(lines 422-478)

### Current Code Structure (lines 422-447)

```typescript
function matchPermutation(
  expr: BoxedExpression,
  pattern: BoxedExpression,
  substitution: BoxedSubstitution,
  options: PatternMatchOptions
): BoxedSubstitution | null {
  console.assert(expr.operator === pattern.operator);

  const patternOps = pattern.ops!;

  // Check if we have sequence wildcards with anchors - use anchor-based matching
  const hasSequenceWildcard = patternOps.some((op) => {
    const wType = wildcardType(op);
    return wType === 'Sequence' || wType === 'OptionalSequence';
  });
  const hasAnchor = patternOps.some((op) => !isWildcard(op));

  if (hasSequenceWildcard && hasAnchor) {
    const result = matchCommutativeWithAnchors(expr, pattern, substitution, options);
    if (result !== null) return result;
  }
  // ... permutation fallback follows
}
```

---

### Phase 1 Implementation: Quick Guards

#### Step 1.1: Arity Guard

**Insert after line 430** (`const patternOps = pattern.ops!;`):

```typescript
const exprOps = expr.ops!;

// === PHASE 1.1: Arity Guard ===
// Count wildcard types in pattern
let universalCount = 0;
let sequenceCount = 0;
let optionalSequenceCount = 0;
let anchorCount = 0;

for (const op of patternOps) {
  const wType = wildcardType(op);
  if (wType === null) {
    anchorCount++;
  } else if (wType === 'Wildcard') {
    universalCount++;
  } else if (wType === 'Sequence') {
    sequenceCount++;
  } else {
    optionalSequenceCount++;
  }
}

// Arity feasibility check
if (sequenceCount === 0 && optionalSequenceCount === 0) {
  // Without sequence wildcards, lengths must match exactly
  if (exprOps.length !== patternOps.length) return null;
} else {
  // With sequence wildcards, ensure minimum operands available
  // Each universal wildcard needs 1, each sequence wildcard needs at least 1
  const minRequired = anchorCount + universalCount + sequenceCount;
  if (exprOps.length < minRequired) return null;
}
```

**Complexity**: O(n) where n = pattern operand count
**Impact**: Eliminates `['Add', '_a', '_b', '_c', 0]` vs `['Add', 'x', 'y', 'z']`
immediately (4 ≠ 3)

#### Step 1.2: Anchor Fingerprint

**Insert after arity guard**, before the `hasSequenceWildcard` check:

```typescript
// === PHASE 1.2: Anchor Fingerprint ===
// Verify all anchors exist in expression (handles multiplicity)
if (anchorCount > 0) {
  const availableOps = [...exprOps];
  for (const op of patternOps) {
    if (!hasWildcards(op)) {
      const idx = availableOps.findIndex((e) => e.isSame(op));
      if (idx === -1) return null; // Anchor not found
      availableOps.splice(idx, 1); // Remove to handle multiplicity
    }
  }
}
```

**Complexity**: O(a × e) where a = anchor count, e = expression operand count
**Impact**: Eliminates patterns where required anchors are missing (e.g., pattern
has `0`, expression lacks `0`)

**Safety for repeat-wildcards**: This check only validates anchor presence.
Patterns like `_a + _a` have no anchors (anchorCount = 0), so they skip this
check and proceed to the existing matching logic that handles repeat wildcards
via `captureWildcard()`.

---

### Phase 2 Implementation: Universal Anchoring

#### Step 2.1: Extend Anchor-Based Matching

**Change line 439** from:

```typescript
if (hasSequenceWildcard && hasAnchor) {
```

**To**:

```typescript
if (hasAnchor) {
```

**Rationale**: The `matchCommutativeWithAnchors()` function already handles
patterns with only universal wildcards correctly. Its backtracking algorithm:

1. Sorts anchors by specificity (literals first)
2. Tries each anchor against all expression positions
3. On match, removes that position and recurses
4. On failure, backtracks to try next position

This is more efficient than blind permutation because it prunes impossible
branches early through specificity ordering.

---

### Complete Modified Function

```typescript
function matchPermutation(
  expr: BoxedExpression,
  pattern: BoxedExpression,
  substitution: BoxedSubstitution,
  options: PatternMatchOptions
): BoxedSubstitution | null {
  console.assert(expr.operator === pattern.operator);

  const patternOps = pattern.ops!;
  const exprOps = expr.ops!;

  // === PHASE 1.1: Arity Guard ===
  let universalCount = 0;
  let sequenceCount = 0;
  let optionalSequenceCount = 0;
  let anchorCount = 0;

  for (const op of patternOps) {
    const wType = wildcardType(op);
    if (wType === null) {
      anchorCount++;
    } else if (wType === 'Wildcard') {
      universalCount++;
    } else if (wType === 'Sequence') {
      sequenceCount++;
    } else {
      optionalSequenceCount++;
    }
  }

  if (sequenceCount === 0 && optionalSequenceCount === 0) {
    if (exprOps.length !== patternOps.length) return null;
  } else {
    const minRequired = anchorCount + universalCount + sequenceCount;
    if (exprOps.length < minRequired) return null;
  }

  // === PHASE 1.2: Anchor Fingerprint ===
  if (anchorCount > 0) {
    const availableOps = [...exprOps];
    for (const op of patternOps) {
      if (!hasWildcards(op)) {
        const idx = availableOps.findIndex((e) => e.isSame(op));
        if (idx === -1) return null;
        availableOps.splice(idx, 1);
      }
    }
  }

  // === PHASE 2: Universal Anchoring ===
  const hasSequenceWildcard = sequenceCount > 0 || optionalSequenceCount > 0;
  const hasAnchor = anchorCount > 0;

  if (hasAnchor) {
    // Changed from: if (hasSequenceWildcard && hasAnchor)
    const result = matchCommutativeWithAnchors(
      expr,
      pattern,
      substitution,
      options
    );
    if (result !== null) return result;
  }

  // Fall back to permutation-based matching
  const cond = (xs: ReadonlyArray<BoxedExpression>) =>
    !xs.some((x, index) => {
      if (!isWildcard(x)) return false;
      const xType = wildcardType(x);
      if (xType !== 'Sequence' && xType !== 'OptionalSequence') return false;

      const next = xs[index + 1];
      if (!next || !isWildcard(next)) return false;

      const nextType = wildcardType(next);
      return nextType === 'Sequence' || nextType === 'OptionalSequence';
    });

  const patterns = permutations(patternOps, cond);

  for (const pat of patterns) {
    const result = matchArguments(expr, pat, substitution, options);
    if (result !== null) return result;
  }
  return null;
}
```

---

## Test Cases

Add to `test/compute-engine/patterns.test.ts`:

### Phase 1.1: Arity Guard Tests

```typescript
describe('Arity Guard Optimization', () => {
  test('rejects when no sequence wildcards and length mismatch', () => {
    // Pattern: 4 operands, Expression: 3 operands
    const result = match(['Add', '_a', '_b', '_c', 0], ['Add', 'x', 'y', 'z']);
    expect(result).toBeNull();
  });

  test('accepts when lengths match exactly without sequence wildcards', () => {
    const result = match(['Add', '_a', '_b', 0], ['Add', 'x', 'y', 0]);
    expect(result).not.toBeNull();
  });

  test('accepts when sequence wildcards can absorb extra operands', () => {
    const result = match(['Add', '__a', 0], ['Add', 'x', 'y', 'z', 0]);
    expect(result).not.toBeNull();
  });
});
```

### Phase 1.2: Anchor Fingerprint Tests

```typescript
describe('Anchor Fingerprint Optimization', () => {
  test('rejects when required anchor is missing', () => {
    const result = match(['Add', '_a', '_b', 0], ['Add', 'x', 'y', 'z']);
    expect(result).toBeNull();
  });

  test('handles anchor multiplicity correctly', () => {
    // Pattern has two 1s, expression has only one
    const result = match(['Add', 1, 1, '_a'], ['Add', 1, 'x', 'y']);
    expect(result).toBeNull();
  });

  test('matches when all anchors present with correct multiplicity', () => {
    const result = match(['Add', 1, 1, '_a'], ['Add', 1, 1, 'x']);
    expect(result).not.toBeNull();
  });

  test('handles complex anchors (function expressions)', () => {
    const result = match(
      ['Add', ['Sqrt', 'x'], '_a'],
      ['Add', 'y', ['Sqrt', 'x']]
    );
    expect(result).not.toBeNull();
  });
});
```

### Phase 2: Universal Anchoring Tests

```typescript
describe('Universal Anchoring Optimization', () => {
  test('uses anchor-based matching for universal wildcards + anchors', () => {
    const result = match(['Add', 1, '_a', '_b'], ['Add', 'x', 1, 'y']);
    expect(result).not.toBeNull();
  });

  test('preserves repeat-wildcard semantics', () => {
    // _a appears twice, must match same value
    const resultMatch = match(['Add', '_a', '_a', 1], ['Add', 'x', 'x', 1]);
    expect(resultMatch).not.toBeNull();

    const resultNoMatch = match(['Add', '_a', '_a', 1], ['Add', 'x', 'y', 1]);
    expect(resultNoMatch).toBeNull();
  });
});
```

---

## Verification Steps

1. **Type check**: `npm run typecheck`
2. **Run existing tests**: `npm run test patterns` — all existing tests must pass
3. **Add new tests**: Add the test cases above
4. **Run new tests**: `npm run test patterns` — verify new tests pass
5. **Manual verification**: Test the illustrative example in a REPL:
   ```typescript
   const ce = new ComputeEngine();
   const pattern = ce.box(['Add', '_a', '_b', '_c', 0]);
   const expr = ce.box(['Add', 'x', 'y', 'z']);
   console.log(expr.match(pattern)); // Should be null (immediate rejection)
   ```

---

## Risk Assessment

| Phase               | Risk   | Mitigation                                            |
| ------------------- | ------ | ----------------------------------------------------- |
| 1.1 Arity Guard     | Low    | Pure early-exit, cannot affect valid matches          |
| 1.2 Anchor Check    | Low    | Uses existing `isSame()`, splice handles multiplicity |
| 2.1 Universal Anchor| Medium | Existing algorithm handles case; tests verify         |

---

## Conclusion

PERMS-5 and PERMS-17 converge on the same core insight: **early structural
rejection eliminates factorial permutation attempts**. The documents differ
mainly in scope (PERMS-5 is more conservative, PERMS-17 more comprehensive) and
terminology (ground operands vs. literals).

**Recommendation**: Implement Phase 1 (arity guard + anchor fingerprint) first
as a low-risk, high-impact change. This alone would eliminate the example case
(`a + b + c + 0` vs `x + y + z`) with zero permutations attempted. Phase 2
(universal anchoring) follows naturally and provides the biggest algorithmic
improvement.

The constraint propagation approach from PERMS-17 is intellectually appealing
but represents a significant complexity increase. It should be deferred until
the simpler optimizations are proven insufficient for real-world patterns.
