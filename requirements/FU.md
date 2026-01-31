# Fu Algorithm Implementation Plan

This document outlines the plan to implement the Fu trigonometric simplification algorithm
based on the paper by Fu, Zhong, and Zeng: "Automated and readable simplification of
trigonometric expressions" (Mathematical and Computer Modelling, 2006).

## Background

The Fu algorithm is a systematic approach to trigonometric simplification that uses:
1. **Transformation Rules (TR)** - Individual rewrite operations
2. **Combination Transforms (CTR)** - Sequences that select optimal intermediate results
3. **Rule Lists (RL)** - Organized application sequences with greedy selection
4. **Cost Function** - Measures expression complexity to guide simplification

Reference: [SymPy Fu Documentation](https://docs.sympy.org/latest/modules/simplify/fu.html)

## Current State

### Existing Code
- `src/compute-engine/boxed-expression/trigonometry.ts` - Contains unused `Fu()` function
- `src/compute-engine/symbolic/simplify-trig.ts` - Active procedural trig simplification

### Issues with Current `Fu()` Implementation
1. Uses LaTeX string rules requiring parsing overhead
2. Bug in `applyTR` - returns early, only applies first rule set
3. Debug `console.info` statement in RL2
4. Simple cost function only counts trig functions
5. Not integrated into simplification pipeline

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    fu() - Main Entry                         │
│  • Detect trig content                                       │
│  • Select strategy based on operators present                │
│  • Apply RL1 or RL2 or custom sequence                       │
│  • Greedy select best result                                 │
└─────────────────────────────────────────────────────────────┘
                              │
          ┌───────────────────┼───────────────────┐
          ▼                   ▼                   ▼
    ┌─────────┐         ┌─────────┐         ┌─────────┐
    │   RL1   │         │   RL2   │         │  CTRs   │
    │tan/cot  │         │sin/cos  │         │combined │
    └─────────┘         └─────────┘         └─────────┘
          │                   │                   │
          ▼                   ▼                   ▼
┌─────────────────────────────────────────────────────────────┐
│              Programmatic TR Rules (fast)                    │
│  TR1, TR2, TR2i, TR5-TR16, TR22, etc.                       │
└─────────────────────────────────────────────────────────────┘
```

## Transformation Rules (TR)

### Basic Conversions
| Rule | Transform | Description |
|------|-----------|-------------|
| TR1 | `sec(x) → 1/cos(x)`, `csc(x) → 1/sin(x)` | Reciprocal forms |
| TR2 | `tan(x) → sin(x)/cos(x)`, `cot(x) → cos(x)/sin(x)` | Ratio forms |
| TR2i | `sin(x)/cos(x) → tan(x)`, `cos(x)/sin(x) → cot(x)` | Inverse of TR2 |
| TR3 | Angle canonicalization | Handle negative angles, etc. |
| TR4 | Special angles | Evaluate at 0, π/6, π/4, π/3, π/2 |

### Power Manipulations
| Rule | Transform | Description |
|------|-----------|-------------|
| TR5 | `sin²(x) → 1 - cos²(x)` | Pythagorean substitution |
| TR6 | `cos²(x) → 1 - sin²(x)` | Pythagorean substitution |
| TR7 | `cos²(x) → (1 + cos(2x))/2` | Power reduction |
| TR8 | Product-to-sum | `sin(x)cos(y) → ½[sin(x+y) + sin(x-y)]` |
| TR9 | Sum-to-product | `sin(x) + sin(y) → 2sin((x+y)/2)cos((x-y)/2)` |
| TR10 | Angle expansion | `sin(x+y) → sin(x)cos(y) + cos(x)sin(y)` |
| TR10i | Angle contraction | Inverse of TR10 |
| TR11 | Double angle expansion | `sin(2x) → 2sin(x)cos(x)` |
| TR12 | Tangent addition | `tan(x+y) → (tan(x)+tan(y))/(1-tan(x)tan(y))` |
| TR12i | Tangent contraction | Inverse of TR12 |
| TR13 | Tangent products | `tan(x)tan(y) → 1 - (tan(x)+tan(y))cot(x+y)` |

### Extended Rules (from SymPy)
| Rule | Transform | Description |
|------|-----------|-------------|
| TR14 | Factored sin/cos powers | Simplify products with powers |
| TR15 | `sin⁻²(x) → 1 + cot²(x)` | Negative power identities |
| TR16 | `cos⁻²(x) → 1 + tan²(x)` | Negative power identities |
| TR22 | `tan²(x) → sec²(x) - 1` | Pythagorean for tan/sec |
| TR111 | Negative power pairs | Handle f(x)⁻¹g(x)⁻¹ |
| TRmorrie | Morrie's law | `cos(x)cos(2x)...cos(2^(k-1)x)` products |

## Combination Transforms (CTR)

```
CTR1(expr) = best(expr, TR5(expr), TR6(expr))
CTR2(expr) = best(expr, TR5(expr), TR6(expr))  // After TR11
CTR3(expr) = best(expr, TR8(expr), TR8(TR10i(expr)))
CTR4(expr) = best(expr, TR10i(expr))
```

## Rule Lists (RL)

```
RL1(expr):  // For expressions with tan/cot
  return TR13(TR12(expr))

RL2(expr):  // For expressions with sin/cos
  expr = TR11(TR7(TR5(TR11(TR10(expr)))))
  expr = CTR3(expr)
  expr = CTR1(expr)
  expr = TR9(expr)
  expr = CTR2(expr)
  expr = TR9(expr)
  return CTR4(expr)
```

## Cost Function

The trig-specific cost function should minimize:
1. **Primary**: Number of trigonometric function occurrences
2. **Secondary**: Total leaf count / operation count

```typescript
function trigCost(expr: BoxedExpression): number {
  const trigCount = countTrigFunctions(expr);
  const leafCount = countLeaves(expr);
  return trigCount * 1000 + leafCount;  // Prioritize fewer trig functions
}
```

## Implementation Phases

### Phase 1: TR Rules Module ✅ COMPLETED
**File**: `src/compute-engine/symbolic/fu-transforms.ts`

Created programmatic implementations of TR1-TR22:
- Each TR function takes a BoxedExpression and returns transformed expression or undefined
- Bottom-up traversal via `mapSubexpressions()` for applicable rules
- No LaTeX parsing - direct AST manipulation
- Includes: TR1, TR2, TR2i, TR5, TR6, TR7, TR8, TR9, TR10, TR10i, TR11, TR11i, TR12, TR13, TR22, TRmorrie

### Phase 2: Cost Function ✅ COMPLETED
**File**: `src/compute-engine/symbolic/fu-cost.ts`

- `trigCost()` - Primary cost function for Fu algorithm
- `countTrigFunctions()` - Count trig function occurrences
- `countLeaves()` - Count expression leaves
- `countOperations()` - Count total operations
- Multiple cost function variants for different use cases

### Phase 3: Fu Algorithm Core ✅ COMPLETED
**File**: `src/compute-engine/symbolic/fu.ts`

- `fu()` - Main entry point returning RuleStep
- `fuSimplify()` - Convenience function returning BoxedExpression
- `RL1()`, `RL2()` - Rule lists for tan/cot and sin/cos
- `CTR1-4()` - Combination transforms with greedy selection
- `bestOf()` - Greedy selection helper
- Configurable options: `measure`, `maxIterations`

### Phase 4: Integration ✅ COMPLETED
**Files modified**:
- `src/compute-engine/boxed-expression/trigonometry.ts` - Removed old unused Fu()
- `test/compute-engine/simplify.test.ts` - Updated imports

**Usage**:
```typescript
import { fu, fuSimplify } from './symbolic/fu';

// Option 1: Get RuleStep with transformation info
const result = fu(expr);
if (result) {
  console.log(result.value);  // Simplified expression
  console.log(result.because); // 'fu'
}

// Option 2: Get simplified expression directly
const simplified = fuSimplify(expr);
```

**Integration Options** (implemented):
1. ✅ `simplify({ strategy: 'fu' })` - Use Fu algorithm during simplification
2. ✅ `.trigSimplify()` method on BoxedExpression - Convenience method for trig simplification
3. Auto-detect heavy trig expressions and apply Fu (future enhancement)

### Phase 5: Testing ✅ COMPLETED
**File**: `test/compute-engine/fu.test.ts`

37 tests covering:
- Cost function tests
- Helper function tests
- Individual TR rule tests (TR1, TR2, TR2i, TR5-TR22, TRmorrie)
- CTR combination tests
- Fu algorithm basic cases
- Classic examples (tan·cot=1, sin²+cos²=1, 2sin·cos=sin(2x))
- Complex expressions
- Edge cases

## Test Cases

### Basic TR Rules
```
TR1: sec(x) → 1/cos(x)
TR2: tan(x) → sin(x)/cos(x)
TR5: sin²(x) + cos²(x) → 1
TR8: sin(x)cos(x) → sin(2x)/2
TR10i: sin(a)cos(b) + cos(a)sin(b) → sin(a+b)
```

### Complex Expressions
```
sin(x)⁴ - cos(x)⁴ → -cos(2x)
sin(x)⁶ + cos(x)⁶ → 1 - 3sin²(x)cos²(x)
cos(x)cos(2x)cos(4x) → sin(8x)/(8sin(x))  [Morrie's law]
```

### Edge Cases
```
sin(0) → 0
cos(π/2) → 0
tan(π/4) → 1
```

## Migration Strategy

1. Keep existing `simplifyTrig` as fallback
2. Add Fu as optional/experimental initially
3. Compare results and performance
4. Gradually make Fu the default for trig-heavy expressions

## Files Created/Modified

| File | Status | Description |
|------|--------|-------------|
| `src/compute-engine/symbolic/fu-transforms.ts` | ✅ Created | TR1-TR22 implementations |
| `src/compute-engine/symbolic/fu-cost.ts` | ✅ Created | Trig cost function |
| `src/compute-engine/symbolic/fu.ts` | ✅ Created | Main Fu algorithm |
| `src/compute-engine/global-types.ts` | ✅ Modified | Added `strategy` to SimplifyOptions, added `trigSimplify()` method |
| `src/compute-engine/boxed-expression/simplify.ts` | ✅ Modified | Handle `strategy: 'fu'` option |
| `src/compute-engine/boxed-expression/abstract-boxed-expression.ts` | ✅ Modified | Implement `trigSimplify()` |
| `src/compute-engine/boxed-expression/trigonometry.ts` | ✅ Modified | Removed old Fu() |
| `test/compute-engine/fu.test.ts` | ✅ Created | 45 comprehensive tests |
| `test/compute-engine/simplify.test.ts` | ✅ Modified | Updated imports |

## Current Status

The Fu algorithm is fully implemented and integrated. Use it via:

### Option 1: simplify with strategy
```typescript
const result = expr.simplify({ strategy: 'fu' });
```

### Option 2: trigSimplify() method
```typescript
const result = expr.trigSimplify();
```

### Option 3: Direct fu() function
```typescript
import { fu, fuSimplify } from './symbolic/fu';
import { trigCost, countTrigFunctions } from './symbolic/fu-cost';
import { TR1, TR2, applyTR5, hasTrigFunction } from './symbolic/fu-transforms';

const result = fuSimplify(expr);
```

### What Works
- All TR transformation rules (TR1-TR22, TRmorrie)
- Cost functions for optimization
- Main fu() algorithm with RL1/RL2 rule lists
- CTR1-4 combination transforms
- Integration with `.simplify({ strategy: 'fu' })`
- Dedicated `.trigSimplify()` method
- 45 passing tests

### Completed Enhancements

#### Phase 6: TR3 - Angle Canonicalization ✅
**Status**: Implemented
**File**: `fu-transforms.ts`

Normalizes negative angles using even/odd function properties:
- `cos(-x)` → `cos(x)` (cosine is even)
- `sin(-x)` → `-sin(x)` (sine is odd)
- `tan(-x)` → `-tan(x)` (tangent is odd)
- `sec(-x)` → `sec(x)` (secant is even)
- `csc(-x)` → `-csc(x)` (cosecant is odd)
- `cot(-x)` → `-cot(x)` (cotangent is odd)

#### Phase 8: Period Reduction ✅
**Status**: Implemented (via standard simplification integration)
**File**: `simplify.ts`

Period reduction is handled by standard simplification which runs before Fu:
- `sin(x+π)` → `-sin(x)`
- `cos(x+2π)` → `cos(x)`
- `sin(π-h)` → `sin(h)`

The Fu strategy now applies standard simplification first, then Fu, then
standard simplification again for post-processing.

#### Phase 9: TR7i - Inverse Power Reduction ✅
**Status**: Implemented
**File**: `fu-transforms.ts`

Converts half-angle forms back to power forms:
- `(1-cos(2x))/2` → `sin²(x)`
- `(1+cos(2x))/2` → `cos²(x)`

Also handles the expanded form after simplification:
- `1/2 - cos(2x)/2` → `sin²(x)`
- `1/2 + cos(2x)/2` → `cos²(x)`

#### Phase 10: TR22i - Inverse Pythagorean for Tan/Sec ✅
**Status**: Implemented
**File**: `fu-transforms.ts`

Applies inverse Pythagorean identities:
- `sec²(x)-1` → `tan²(x)`
- `csc²(x)-1` → `cot²(x)`
- `1+tan²(x)` → `sec²(x)`
- `1+cot²(x)` → `csc²(x)`
- `cot²(x)-csc²(x)` → `-1` (direct pattern)
- `tan²(x)-sec²(x)` → `-1` (direct pattern)

#### Phase 12: Post-Fu Arithmetic Simplification ✅
**Status**: Implemented
**File**: `simplify.ts`

After Fu transformations, standard simplification runs to handle arithmetic:
- `sin(2x) - sin(2x)` → `0`
- `cos(x)/cos(x)` → `1`

### Future Enhancements

The following enhancements are still needed for advanced Fu paper examples:

#### Phase 7: TRmorrie Enhancement for Rational Coefficients ✅
**Status**: Implemented
**File**: `fu-transforms.ts`, `simplify.ts`

Enhanced TRmorrie to handle rational coefficient patterns:
- Extract numeric value from Rational coefficients (e.g., 1/9, 2/9, 4/9)
- Find maximal Morrie subsequence and factor out non-matching terms
- Special case: when `(2^n + 1) * minCoeff = 1` with base arg Pi, sines cancel to give `1/2^n`
- Fu strategy now tries both "Fu first" and "simplify first" approaches to handle both
  Morrie patterns and period reduction cases

Example: `cos(π/9)·cos(2π/9)·cos(3π/9)·cos(4π/9)` → `1/16`
- Morrie subset: cos(π/9)cos(2π/9)cos(4π/9) = 1/8
- Factored out: cos(3π/9) = cos(π/3) = 1/2
- Result: (1/8)(1/2) = 1/16

#### Phase 7b: TR12i - Tangent Sum Identity ✅
**Status**: Implemented
**File**: `fu-transforms.ts`

Recognizes the tangent sum identity: when A + B + C = π:
`tan(A) + tan(B) - tan(C)·tan(A)·tan(B) = -tan(C)`

Implementation details:
- Detects Add expressions with pattern: tan(A) + tan(B) + (-k)·tan(A)·tan(B)
- Recognizes known tan values: tan(π/3)=√3, tan(π/4)=1, tan(π/6)=1/√3, etc.
- Verifies that A + B + arctan(k) = π
- Returns -tan(arctan(k)) = -k in symbolic form

Example: `tan(7π/18)+tan(5π/18)-√3·tan(5π/18)·tan(7π/18)` → `-√3`
- A=5π/18, B=7π/18, k=√3=tan(π/3), so C=π/3
- 5π/18 + 7π/18 + 6π/18 = 18π/18 = π ✓
- Result: -tan(π/3) = -√3

#### Phase 11: TRpythagorean - Pythagorean Identity in Compound Expressions ✅
**Status**: Implemented
**File**: `fu-transforms.ts`

Detects sin²+cos² pairs within larger Add expressions:
- `sin²(x)+cos²(x)+2x` → `1+2x`
- `2-2sin²(x)` → `2cos²(x)` (c - c·sin²(x) = c·cos²(x))

#### Phase 13: TR9 Enhancement - Sum-to-Product ✅
**Status**: Implemented
**File**: `fu.ts`

Applied TR9 early in the Fu algorithm (before RL2) to catch sum-to-product
patterns before TR10 expands the angles:
- `sin(x+h)+sin(x-h)` → `2sin(x)cos(h)`
- `cos(x+h)+cos(x-h)` → `2cos(x)cos(h)`

#### Phase 14: Complex Multi-Step Simplifications
**Status**: Not implemented
**Priority**: Low
**Tests affected**: 1 test (Fu paper example)

Handle complex expressions requiring multiple transformation steps:
- `1-(1/4)sin²(2x)-sin²(y)-cos⁴(x)` → `sin(x+y)sin(x-y)`

##### Mathematical Derivation

The simplification requires these steps:

```
1 - (1/4)sin²(2x) - sin²(y) - cos⁴(x)

Step 1: Power reduction for sin²(2x)
  sin²(2x) = (1 - cos(4x))/2
  (1/4)sin²(2x) = (1 - cos(4x))/8

Step 2: Power reduction for sin²(y)
  sin²(y) = (1 - cos(2y))/2

Step 3: Power reduction for cos⁴(x)
  cos²(x) = (1 + cos(2x))/2
  cos⁴(x) = ((1 + cos(2x))/2)²
         = (1 + 2cos(2x) + cos²(2x))/4
         = (1 + 2cos(2x) + (1 + cos(4x))/2)/4
         = (3 + 4cos(2x) + cos(4x))/8

Step 4: Substitute and combine
  1 - (1-cos(4x))/8 - (1-cos(2y))/2 - (3+4cos(2x)+cos(4x))/8
  = 1 - 1/8 + cos(4x)/8 - 1/2 + cos(2y)/2 - 3/8 - cos(2x)/2 - cos(4x)/8
  = (8 - 1 - 4 - 3)/8 + (cos(4x) - cos(4x))/8 + cos(2y)/2 - cos(2x)/2
  = 0 + cos(2y)/2 - cos(2x)/2
  = (1/2)(cos(2y) - cos(2x))

Step 5: Sum-to-product inverse (TR8i)
  (1/2)(cos(B) - cos(A)) = sin((A+B)/2)sin((A-B)/2)
  With A=2x, B=2y:
  (1/2)(cos(2y) - cos(2x)) = sin((2x+2y)/2)sin((2x-2y)/2)
                          = sin(x+y)sin(x-y)
```

##### Required Enhancements

**1. TR7 Extension for sin²(x)**
Current TR7 only handles cos²(x). Need to add:
- `sin²(x)` → `(1 - cos(2x))/2`

**2. TR7 Extension for Higher Powers**
Handle sin⁴(x), cos⁴(x), sin⁶(x), cos⁶(x), etc.:
- Could be recursive application of TR7
- Or explicit formulas for common cases
- `cos⁴(x)` → `(3 + 4cos(2x) + cos(4x))/8`
- `sin⁴(x)` → `(3 - 4cos(2x) + cos(4x))/8`

**3. TR7 for Compound Angles**
Handle sin²(kx) and cos²(kx) where k ≠ 1:
- `sin²(2x)` → `(1 - cos(4x))/2`
- `cos²(2x)` → `(1 + cos(4x))/2`

**4. TR8i (Product-to-Sum Inverse)**
Convert sums/differences of cosines back to products:
- `cos(A) + cos(B)` → `2cos((A+B)/2)cos((A-B)/2)`
- `cos(A) - cos(B)` → `-2sin((A+B)/2)sin((A-B)/2)`
- `(1/2)(cos(B) - cos(A))` → `sin((A+B)/2)sin((A-B)/2)`

**5. Intelligent Coefficient Handling**
After power reduction, need smart arithmetic to:
- Combine like terms (cos(4x) terms cancel)
- Reduce constant terms to zero
- Recognize common factors

##### Implementation Approach

Option A: **Full TR Implementation**
- Implement TR7 extensions for all cases
- Implement TR8i with pattern matching
- May need multiple Fu algorithm passes
- High complexity, but general solution

Option B: **Special Case Handling**
- Detect this specific expression pattern
- Apply known simplification directly
- Lower complexity, but limited applicability

Option C: **Hybrid Approach**
- Implement TR7 extensions (useful for other cases too)
- For TR8i, use numerical verification + pattern matching
- Check if expanded form numerically equals sin(x+y)sin(x-y)

##### Estimated Effort
- TR7 extensions: Medium (extend existing code)
- TR8i: High (new pattern matching logic)
- Arithmetic simplification: Already exists
- Testing and edge cases: Medium

##### Recommendation
Start with TR7 extensions as they have broader applicability.
TR8i is complex and may only benefit a few specialized cases.
Consider if Phase 14 is worth the implementation effort vs. benefit.

### Implementation Status Summary

| Phase | Feature | Status | Tests |
|-------|---------|--------|-------|
| 6 | TR3 Angle Canonicalization | ✅ Done | 3 pass |
| 7a | TRmorrie Rational Coefficients | ✅ Done | 1 pass |
| 7b | TR12i Tangent Sum Identity | ✅ Done | 1 pass |
| 8 | Period Reduction | ✅ Done | 2 pass |
| 9 | TR7i Inverse Power Reduction | ✅ Done | 2 pass |
| 10 | TR22i Inverse Pythagorean | ✅ Done | 2 pass |
| 11 | TRpythagorean Compounds | ✅ Done | 2 pass |
| 12 | Post-Fu Arithmetic | ✅ Done | 1 pass |
| 13 | TR9 Early Application | ✅ Done | 1 pass |
| 14 | Complex Multi-Step | ❌ Not done | 1 skip |

**Total**: 76 tests passing, 1 test skipped (Phase 14 complex multi-step)

**Remaining skipped test**:
- `1-(1/4)sin²(2x)-sin²(y)-cos⁴(x)` → `sin(x+y)sin(x-y)` (complex multi-step factorization)

### Other Enhancements
- Auto-detect trig-heavy expressions and apply Fu automatically
- Performance optimization for large expressions
- Additional TR rules from SymPy extensions (TR14, TR15, TR16, TR111)

### Known Limitations

#### TRmorrie First-Factor Assumption
The TRmorrie implementation groups cosine factors by the base argument of the
first cosine factor encountered. If the first cosine has a different base than
the longest valid Morrie sequence in the expression, the rule may not find the
optimal transformation.

**Example:** In `cos(2x)·cos(x)·cos(4x)`, if the factors are ordered such that
`cos(2x)` is first, it will try to build a Morrie sequence starting from `2x`
rather than `x`, potentially missing the `cos(x)·cos(2x)·cos(4x)` sequence.

**Future fix:** Try grouping by each unique base argument and select the
transformation that yields the longest Morrie sequence or lowest cost result.

#### TR12i Pi Fraction Detection
The TR12i implementation (tangent sum identity) only matches angles expressed
as `Multiply(number, Pi)` form. If the canonical form is `Divide(Pi, n)` or
other equivalent representations, the pattern won't match.

**Example:** `tan(π/6)` represented as `Divide(Pi, 6)` instead of
`Multiply(Rational(1,6), Pi)` would not be recognized.

**Future fix:** Normalize angle representations or check multiple equivalent
forms when extracting Pi fractions.

## Timeline

- Phase 1: TR Rules - Foundation for everything else
- Phase 2: Cost Function - Quick to implement
- Phase 3: Fu Algorithm - Core logic
- Phase 4: Integration - Connect to existing system
- Phase 5: Testing - Validate correctness

## References

1. Fu, Hongguang, Xiuqin Zhong, and Zhenbing Zeng. "Automated and readable
   simplification of trigonometric expressions." Mathematical and Computer
   Modelling 44.11 (2006): 1169-1177.

2. [SymPy Fu Documentation](https://docs.sympy.org/latest/modules/simplify/fu.html)

3. [SymPy Fu Source Code](https://github.com/sympy/sympy/blob/master/sympy/simplify/fu.py)
