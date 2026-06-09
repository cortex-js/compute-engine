# Interval Arithmetic Compilation for Compute Engine

This document explores what would be involved in compiling mathematical
expressions to JavaScript or GLSL using interval arithmetic, with the goal of
enabling plotting packages to render functions more accurately through adaptive
sampling and singularity detection.

## Background

### Current Compilation Architecture

The compute-engine currently compiles expressions to three targets:

- **JavaScript** - Executable functions using `Math.*` and custom system
  functions
- **GLSL** - Shader code using GLSL built-ins
- **Python** - NumPy-based code

Each target maps MathJSON operators to language-specific implementations. The
compilation is straightforward point arithmetic: `sin(x)` becomes `Math.sin(x)`,
division compiles directly without checks, and edge cases rely on IEEE 754
behavior (producing `Infinity`, `-Infinity`, or `NaN`).

### What is Interval Arithmetic?

Interval arithmetic operates on intervals `[a, b]` rather than point values.
Each operation produces an interval guaranteed to contain the true result:

```
[1, 2] + [3, 4] = [4, 6]
[1, 2] × [3, 4] = [3, 8]
[1, 2] / [3, 4] = [0.25, 0.667]
1 / [-1, 1] = (-∞, -1] ∪ [1, +∞)  // Division by interval containing zero
```

### Why Interval Arithmetic for Plotting?

Standard plotting approaches sample functions at regular intervals, which leads
to several problems:

1. **Missing Features** - A spike between sample points goes undetected
2. **Aliasing** - High-frequency oscillations appear as lower frequencies
3. **Singularities** - Points like `tan(π/2)` produce wild line segments
4. **Discontinuities** - Jump discontinuities render as vertical lines

Interval arithmetic addresses all of these:

| Problem          | How Intervals Help                                       |
| ---------------- | -------------------------------------------------------- |
| Missing features | Wide intervals indicate uncertainty → refine sampling    |
| Aliasing         | Interval width reveals true variation in region          |
| Singularities    | Division by interval containing 0 is detected explicitly |
| Discontinuities  | Sudden interval width changes reveal jumps               |

## Proposed Architecture

### New Compilation Target: `interval-js` and `interval-glsl`

Add two new compilation targets that generate interval arithmetic code:

```typescript
// Usage
const compiled = expr.compile({ to: 'interval-js' });

// Input: interval bounds
const result = compiled({ x: { lo: 0, hi: 0.1 } });
// Output: { lo: -0.0998..., hi: 0.1001... } for sin(x)
```

### Interval Representation

**JavaScript:**

```typescript
// Result of an interval operation
type IntervalResult =
  | { kind: 'interval'; value: Interval }           // Normal result (may contain ±∞)
  | { kind: 'empty' }                               // No valid values (e.g., ln([-2, -1]))
  | { kind: 'entire' }                              // (-∞, +∞) - completely unbounded
  | { kind: 'singular'; at?: number }               // Contains pole/asymptote
  | { kind: 'partial'; value: Interval; domainClipped: 'lo' | 'hi' | 'both' }

interface Interval {
  lo: number;  // Lower bound (toward -∞), may be -Infinity
  hi: number;  // Upper bound (toward +∞), may be +Infinity
}
```

### Consistency Convention

All interval operations return `IntervalResult` for uniform composition. A helper
lifts plain intervals:

```typescript
function ok(value: Interval): IntervalResult {
  return { kind: 'interval', value };
}
```

Internal helpers (like `mul` for basic arithmetic) may return plain `Interval`
for efficiency, but all public API functions wrap results in `IntervalResult`.

### Result Semantics

Operations return structured results that preserve information for plotting:

| Input Domain         | Example              | Result Kind | Meaning                          |
| -------------------- | -------------------- | ----------- | -------------------------------- |
| Fully valid          | `sin([0, 1])`        | `interval`  | Normal computation               |
| Fully invalid        | `ln([-2, -1])`       | `empty`     | No plottable values              |
| Contains singularity | `1/[-1, 1]`          | `singular`  | Asymptote present, refine        |
| Partially valid      | `ln([-1, 2])`        | `partial`   | Valid interval + domain clip info |
| Unbounded result     | `tan` near π/2       | `entire`    | Result spans all reals           |

**Propagation rules:**
- `empty` ∘ anything = `empty`
- `entire` + `entire` = `entire`
- `partial` propagates domain clip info through composition
- `singular` triggers subdivision in plotting algorithms

### Unbounded Ranges vs Domain Clipping

Both `interval` and `partial` may contain ±Infinity in their bounds - this is
standard in interval arithmetic for representing unbounded ranges. The
distinction is:

| Kind | Meaning | Example |
|------|---------|---------|
| `interval` with ±∞ | Result is unbounded, input fully valid | `exp([100, 200])` → `[e^100, +∞]` in practice |
| `partial` with ±∞ | Result is unbounded *because* input domain was restricted | `ln([-1, 2])` → `[-∞, ln(2)]` with `domainClipped: 'lo'` |

The `partial` kind answers: "Did we have to exclude part of the input domain?"
The presence of ±∞ in the value answers: "Is the result unbounded?"

These often co-occur (domain boundary → asymptote) but are logically distinct.
For example:
- `ln([-1, 2])`: domain clipped at 0 (can't take ln of ≤0), result approaches -∞
- `1/[0.001, 1]`: domain fully valid, result `[1, 1000]` is finite
- `1/[0, 1]`: domain clipped at 0 (can't divide by 0), result `[1, +∞]`

To clarify intent, rename `clipped` → `domainClipped`:

```typescript
type IntervalResult =
  | { kind: 'interval'; value: Interval }
  | { kind: 'empty' }
  | { kind: 'entire' }
  | { kind: 'singular'; at?: number }
  | { kind: 'partial'; value: Interval; domainClipped: 'lo' | 'hi' | 'both' }
```

**GLSL:**

```glsl
// Represent as vec2 where x = lo, y = hi
vec2 interval;  // interval.x = lo, interval.y = hi

// Or as struct for clarity (GLSL 4.0+)
struct Interval {
  float lo;
  float hi;
};
```

### Compilation Strategy

Each standard function needs an interval counterpart:

```typescript
// Current JavaScript target
functions: {
  Sin: 'Math.sin',
  Add: (args, compile) => `(${compile(args[0])} + ${compile(args[1])})`
}

// Interval JavaScript target
functions: {
  Sin: '_IA.sin',
  Add: (args, compile) => `_IA.add(${compile(args[0])}, ${compile(args[1])})`
}
```

## Interval Implementations

### Basic Arithmetic

These operations are always total (defined for all inputs) and return `IntervalResult`.

**Addition** (straightforward - monotonic):

```typescript
function add(a: Interval, b: Interval): IntervalResult {
  return ok({ lo: a.lo + b.lo, hi: a.hi + b.hi });
}
```

**Subtraction** (straightforward - flip bounds):

```typescript
function sub(a: Interval, b: Interval): IntervalResult {
  return ok({ lo: a.lo - b.hi, hi: a.hi - b.lo });
}
```

**Multiplication** (need all four combinations):

```typescript
function mul(a: Interval, b: Interval): IntervalResult {
  const products = [
    a.lo * b.lo,
    a.lo * b.hi,
    a.hi * b.lo,
    a.hi * b.hi
  ];
  return ok({
    lo: Math.min(...products),
    hi: Math.max(...products)
  });
}

// Internal helper for use in div() - returns plain Interval
function _mul(a: Interval, b: Interval): Interval {
  const products = [a.lo * b.lo, a.lo * b.hi, a.hi * b.lo, a.hi * b.hi];
  return { lo: Math.min(...products), hi: Math.max(...products) };
}
```

**Division** (key for singularity detection):

```typescript
function div(a: Interval, b: Interval): IntervalResult {
  // Case 1: Divisor entirely positive or negative - safe
  if (b.lo > 0 || b.hi < 0) {
    return ok(_mul(a, { lo: 1/b.hi, hi: 1/b.lo }));
  }

  // Case 2: Divisor contains zero - singularity
  // For plotting, we signal this and let the algorithm subdivide
  // to isolate the singularity location
  if (b.lo < 0 && b.hi > 0) {
    return { kind: 'singular' };
  }

  // Case 3: Divisor is exactly [0, c] or [c, 0] - one-sided zero
  // Result depends on sign of numerator
  if (b.lo === 0 && b.hi > 0) {
    // Dividing by [0+, c]: approaches +∞ or -∞ from one side
    if (a.lo >= 0) {
      // Positive / [0+, c] = [a.lo/c, +∞)
      return {
        kind: 'partial',
        value: { lo: a.lo / b.hi, hi: Infinity },
        domainClipped: 'hi'
      };
    } else if (a.hi <= 0) {
      // Negative / [0+, c] = (-∞, a.hi/c]
      return {
        kind: 'partial',
        value: { lo: -Infinity, hi: a.hi / b.hi },
        domainClipped: 'lo'
      };
    } else {
      // Mixed sign numerator - result is all reals
      return { kind: 'entire' };
    }
  }
  if (b.hi === 0 && b.lo < 0) {
    // Dividing by [c, 0-]: similar logic, opposite signs
    if (a.lo >= 0) {
      return {
        kind: 'partial',
        value: { lo: -Infinity, hi: a.lo / b.lo },
        domainClipped: 'lo'
      };
    } else if (a.hi <= 0) {
      return {
        kind: 'partial',
        value: { lo: a.hi / b.lo, hi: Infinity },
        domainClipped: 'hi'
      };
    } else {
      return { kind: 'entire' };
    }
  }

  // Case 4: Divisor is exactly [0, 0]
  return { kind: 'empty' };
}
```

**Design decision:** We return `singular` rather than union intervals because:
1. Plotting algorithms will subdivide anyway to find the asymptote location
2. Union intervals complicate all downstream operations
3. The subdivision process naturally separates the two branches

For applications needing union intervals (e.g., constraint solving), a separate
`divUnion()` could return `Interval[]`.

### Trigonometric Functions

These are more complex because they're not monotonic. The interval extension
must consider extrema within the interval.

**Sine** (bounded, periodic with extrema at π/2 + nπ):

```typescript
function sin(x: Interval): IntervalResult {
  const period = 2 * Math.PI;

  // Wide interval spans full range
  if (x.hi - x.lo >= period) {
    return { kind: 'interval', value: { lo: -1, hi: 1 } };
  }

  // Endpoint values
  const sinLo = Math.sin(x.lo);
  const sinHi = Math.sin(x.hi);
  let lo = Math.min(sinLo, sinHi);
  let hi = Math.max(sinLo, sinHi);

  // Check for maximum at π/2 + 2nπ
  if (containsExtremum(x, Math.PI / 2, period)) {
    hi = 1;
  }
  // Check for minimum at 3π/2 + 2nπ
  if (containsExtremum(x, 3 * Math.PI / 2, period)) {
    lo = -1;
  }

  return { kind: 'interval', value: { lo, hi } };
}

// Check if interval [x.lo, x.hi] contains point + n*period for some integer n
// Uses inclusive bounds to handle exact extrema correctly
function containsExtremum(x: Interval, point: number, period: number): boolean {
  // Find the smallest candidate >= x.lo
  const n = Math.ceil((x.lo - point) / period);
  const candidate = point + n * period;
  // Inclusive check: candidate in [x.lo, x.hi]
  return candidate >= x.lo - 1e-15 && candidate <= x.hi + 1e-15;
}
```

Note: The epsilon tolerance (1e-15) handles floating-point edge cases where
`x.lo` is very close to an extremum. For rigorous intervals, this should be
tied to the rounding strategy.

**Tangent** (unbounded, singularities at π/2 + nπ):

```typescript
function tan(x: Interval): IntervalResult {
  const period = Math.PI;

  // Case 1: Interval spans a full period - certainly crosses a singularity
  if (x.hi - x.lo >= period) {
    return { kind: 'singular' };
  }

  // Case 2: Check if interval contains a pole at π/2 + nπ
  if (containsExtremum(x, Math.PI / 2, period)) {
    // Find the pole location for refinement hints
    const n = Math.ceil((x.lo - Math.PI / 2) / period);
    const poleAt = Math.PI / 2 + n * period;
    return { kind: 'singular', at: poleAt };
  }

  // Case 3: Safe interval - tan is monotonic on this branch
  const tanLo = Math.tan(x.lo);
  const tanHi = Math.tan(x.hi);

  // Sanity check: if results have opposite signs with large magnitude,
  // we may have crossed a branch due to floating-point error
  if (tanLo > 1e10 && tanHi < -1e10 || tanLo < -1e10 && tanHi > 1e10) {
    return { kind: 'singular' };
  }

  return { kind: 'interval', value: { lo: tanLo, hi: tanHi } };
}
```

The `at` field in `singular` results provides the approximate pole location,
allowing plotting algorithms to subdivide more intelligently (bisect toward
the pole rather than blind midpoint splitting).

### Power and Roots

**Square** (need to handle sign change at 0):

```typescript
function square(x: Interval): IntervalResult {
  if (x.lo >= 0) {
    return ok({ lo: x.lo * x.lo, hi: x.hi * x.hi });
  } else if (x.hi <= 0) {
    return ok({ lo: x.hi * x.hi, hi: x.lo * x.lo });
  } else {
    // Interval contains 0 - minimum is 0
    return ok({ lo: 0, hi: Math.max(x.lo * x.lo, x.hi * x.hi) });
  }
}
```

**Square Root** (domain restriction):

```typescript
function sqrt(x: Interval): IntervalResult {
  // Case 1: Entirely negative - no valid values
  if (x.hi < 0) {
    return { kind: 'empty' };
  }

  // Case 2: Entirely non-negative - straightforward
  if (x.lo >= 0) {
    return {
      kind: 'interval',
      value: { lo: Math.sqrt(x.lo), hi: Math.sqrt(x.hi) }
    };
  }

  // Case 3: Straddles zero - valid for [0, x.hi], invalid for [x.lo, 0)
  // Return the valid portion with a domain clip indicator
  return {
    kind: 'partial',
    value: { lo: 0, hi: Math.sqrt(x.hi) },
    domainClipped: 'lo'  // Lower bound was clipped to domain boundary
  };
}
```

**Design decision:** `partial` results allow plotting to:
1. Render the valid portion of the curve
2. Mark the domain boundary (here, x=0) visually
3. Avoid spurious refinement in the invalid region

This is more informative than `singular` (which implies an asymptote) or
`empty` (which would hide the valid portion).

**General Power** (complex - depends on exponent):

```typescript
function pow(base: Interval, exp: number): IntervalResult {
  if (Number.isInteger(exp)) {
    if (exp >= 0) {
      return ok(intPow(base, exp));
    } else {
      // Negative integer: x^(-n) = 1/x^n - singularity if base contains 0
      if (base.lo <= 0 && base.hi >= 0) {
        return { kind: 'singular' };
      }
      return div({ lo: 1, hi: 1 }, intPow(base, -exp));
    }
  } else {
    // Fractional exponent - requires non-negative base for real result
    if (base.hi < 0) {
      // Entirely negative - no real values
      return { kind: 'empty' };
    }
    if (base.lo < 0) {
      // Straddles zero - valid for [0, base.hi]
      const value = exp > 0
        ? { lo: 0, hi: Math.pow(base.hi, exp) }
        : { lo: Math.pow(base.hi, exp), hi: Infinity };  // x^(-0.5) etc
      return { kind: 'partial', value, domainClipped: 'lo' };
    }
    // Entirely non-negative - straightforward
    // Handle exp > 0 vs exp < 0 for monotonicity
    if (exp > 0) {
      return ok({ lo: Math.pow(base.lo, exp), hi: Math.pow(base.hi, exp) });
    } else {
      // Decreasing function
      if (base.lo === 0) {
        return {
          kind: 'partial',
          value: { lo: Math.pow(base.hi, exp), hi: Infinity },
          domainClipped: 'hi'
        };
      }
      return ok({ lo: Math.pow(base.hi, exp), hi: Math.pow(base.lo, exp) });
    }
  }
}
```

### Logarithm and Exponential

**Natural Log** (domain: positive reals):

```typescript
function ln(x: Interval): IntervalResult {
  // Case 1: Entirely non-positive - no valid values
  if (x.hi <= 0) {
    return { kind: 'empty' };
  }

  // Case 2: Entirely positive - straightforward
  if (x.lo > 0) {
    return {
      kind: 'interval',
      value: { lo: Math.log(x.lo), hi: Math.log(x.hi) }
    };
  }

  // Case 3: Straddles zero or includes zero
  // ln(x) → -∞ as x → 0+, so the lower bound is unbounded
  // But we can still provide useful information for plotting
  if (x.lo <= 0 && x.hi > 0) {
    // The interval crosses the domain boundary at x=0
    // Valid portion: (0, x.hi] → (-∞, ln(x.hi)]
    return {
      kind: 'partial',
      value: { lo: -Infinity, hi: Math.log(x.hi) },
      domainClipped: 'lo'
    };
  }

  return { kind: 'empty' };
}
```

Using `partial` with `lo: -Infinity` correctly represents that ln approaches
negative infinity at the domain boundary. Plotting algorithms can:
1. Render the curve from some practical lower bound up to ln(x.hi)
2. Indicate the vertical asymptote at x=0

**Exponential** (always valid, monotonic):

```typescript
function exp(x: Interval): IntervalResult {
  return ok({ lo: Math.exp(x.lo), hi: Math.exp(x.hi) });
}
```

## GLSL-Specific Considerations

### Rounding Mode Issues

GLSL does not provide control over floating-point rounding modes. True interval
arithmetic requires **outward rounding** (round down for lower bounds, round up
for upper bounds). Without this, intervals may not be mathematically rigorous.

**Practical approaches:**

1. **Epsilon inflation** - Add/subtract a small epsilon to bounds:

   ```glsl
   const float EPS = 1e-6;
   vec2 ia_add(vec2 a, vec2 b) {
     return vec2(a.x + b.x - EPS, a.y + b.y + EPS);
   }
   ```

2. **Conservative bounds** - Accept slightly wider intervals for safety

3. **Native extensions** - Some GPUs support `GL_NV_conservative_raster` or
   similar extensions that might help

### JavaScript Rounding Strategy

JavaScript also lacks rounding mode control. Options for the JS target:

1. **Accept non-rigorous intervals** (recommended for plotting)
   - For plotting, slight under-coverage is acceptable
   - The adaptive subdivision will catch any missed features
   - Simpler implementation, better performance

2. **Epsilon inflation** (for rigorous bounds)
   ```typescript
   const EPSILON = Number.EPSILON * 4; // ~9e-16

   function add(a: Interval, b: Interval): Interval {
     return {
       lo: (a.lo + b.lo) - EPSILON * Math.abs(a.lo + b.lo),
       hi: (a.hi + b.hi) + EPSILON * Math.abs(a.hi + b.hi)
     };
   }
   ```

3. **Operation-specific error bounds**
   - Track accumulated error through computation
   - More complex but tighter bounds

**Recommendation:** Start with option 1 (non-rigorous) for the plotting use
case. Add a `{ rigorous: true }` compilation option that enables inflation
for applications requiring guaranteed enclosure.

### Rigor Guarantees

The mathematical definition of interval arithmetic guarantees enclosure, but
implementation realities differ:

| Mode | Guarantee | Use Case |
|------|-----------|----------|
| **Rigorous** (`rigorous: true`) | True enclosure - result always contains exact value | Verification, constraint solving |
| **Practical** (default) | Near-enclosure - may under-cover by ~1 ULP | Plotting, adaptive sampling |

For plotting, practical mode is sufficient because:
1. Visual pixel resolution far exceeds floating-point precision
2. Adaptive subdivision compensates for rare under-coverage
3. Performance benefit (~2x faster without inflation)

The doc's "guaranteed enclosure" claim applies to the mathematical model;
implementations should document their actual rigor level.

### Vectorization

GLSL's strength is parallel computation. Interval arithmetic doubles the
computation (two bounds per value), but this maps well to GLSL's vec2:

```glsl
// Standard GLSL
float f = sin(x) * cos(y);

// Interval GLSL
vec2 x_i = vec2(x_lo, x_hi);
vec2 y_i = vec2(y_lo, y_hi);
vec2 f_i = ia_mul(ia_sin(x_i), ia_cos(y_i));
```

### Singularity Handling in Shaders

Shaders can't easily return multiple values or error states. Options:

1. **Special interval** - Use `vec2(NaN, NaN)` or `vec2(-HUGE, HUGE)` for
   singularities

2. **Separate texture** - Write singularity flags to a separate output

3. **Clamp to screen** - Let singularities extend to ±screen bounds

```glsl
vec2 ia_div(vec2 a, vec2 b) {
  // Check if b contains zero
  if (b.x <= 0.0 && b.y >= 0.0) {
    return vec2(-1e38, 1e38);  // "Infinite" interval
  }
  // ... normal division
}
```

**Singularity mask approach:** Yes, for accurate plotting we should emit both:

```glsl
// Fragment shader outputs
layout(location = 0) out vec4 intervalResult;  // (lo, hi, unused, unused)
layout(location = 1) out vec4 statusFlags;     // (isSingular, isPartial, isClipped, unused)

vec2 ia_div(vec2 a, vec2 b, out float singular) {
  if (b.x <= 0.0 && b.y >= 0.0) {
    singular = 1.0;
    return vec2(-1e38, 1e38);
  }
  singular = 0.0;
  return ia_mul(a, vec2(1.0/b.y, 1.0/b.x));
}
```

The CPU-side plotting algorithm reads both textures to make subdivision decisions.
This separates the "what interval" from "what happened" concerns cleanly.

## Integration with Plotting

### Adaptive Subdivision Algorithm

```typescript
interface PlotRegion {
  xInterval: Interval;
  yResult: IntervalResult;
  depth: number;
}

interface QueueItem {
  x: Interval;
  depth: number;
}

function plotFunction(
  fn: (x: Interval) => IntervalResult,
  domain: Interval,
  viewHeight: number,          // Viewport height in function units
  maxDepth: number = 10,
  toleranceFraction: number = 0.01  // Max y-interval as fraction of view
): PlotRegion[] {

  const tolerance = toleranceFraction * viewHeight;
  const regions: PlotRegion[] = [];
  const queue: QueueItem[] = [{ x: domain, depth: 0 }];

  while (queue.length > 0) {
    const { x, depth } = queue.pop()!;
    const yResult = fn(x);

    const shouldSubdivide = (): boolean => {
      if (depth >= maxDepth) return false;

      switch (yResult.kind) {
        case 'singular':
          return true;  // Always refine to locate singularity
        case 'partial':
        case 'interval':
          const y = yResult.value;
          const yWidth = y.hi - y.lo;
          return yWidth > tolerance;  // Refine if too uncertain
        case 'entire':
          return true;  // Unbounded result needs refinement
        case 'empty':
          return false; // Nothing to plot here
      }
    };

    if (shouldSubdivide()) {
      const mid = (x.lo + x.hi) / 2;
      queue.push({ x: { lo: x.lo, hi: mid }, depth: depth + 1 });
      queue.push({ x: { lo: mid, hi: x.hi }, depth: depth + 1 });
    } else {
      regions.push({ xInterval: x, yResult, depth });
    }
  }

  return regions;
}
```

The algorithm produces regions tagged with their `IntervalResult`, allowing the
renderer to handle each case appropriately (draw bounds, mark singularities,
indicate partial domains, etc.).

### Rendering Strategy

1. **Regular regions** - Draw as filled rectangles or line segments
2. **Uncertain regions** - Use transparency or hatching to show bounds
3. **Singular regions** - Draw vertical asymptote markers
4. **Discontinuities** - Detected by non-overlapping adjacent intervals

## Implementation Plan

### Phase 1: Core Interval Library

Create `src/compute-engine/interval/`:

```
interval/
  types.ts           # Interval type definitions
  arithmetic.ts      # Basic operations (+, -, *, /)
  elementary.ts      # sqrt, pow, exp, ln
  trigonometric.ts   # sin, cos, tan, etc.
  util.ts            # Helper functions
  index.ts           # Re-exports
```

### Phase 2: JavaScript Target

Create `src/compute-engine/compilation/interval-javascript-target.ts`:

- Map all current JavaScript functions to interval versions
- Handle special return values (singular, domain_error)
- Create `IntervalFunction` class similar to `ComputeEngineFunction`

### Phase 3: GLSL Target

Create `src/compute-engine/compilation/interval-glsl-target.ts`:

- Define GLSL interval functions using vec2
- Handle singularity representation in shaders
- Consider generating both the function and required GLSL helper library

### Phase 4: Plotting Integration API

Add high-level API for plotting use cases:

```typescript
interface PlotOptions {
  domain: [number, number];
  tolerance?: number;
  maxSubdivisions?: number;
  detectSingularities?: boolean;
}

interface PlotResult {
  regions: PlotRegion[];
  singularities: number[];
  suggestedSamplePoints: number[];
}

// On BoxedExpression
expr.plotAnalysis(options: PlotOptions): PlotResult;
```

## Additional Operators

### Absolute Value

```typescript
function abs(x: Interval): IntervalResult {
  if (x.lo >= 0) {
    return { kind: 'interval', value: x };
  }
  if (x.hi <= 0) {
    return { kind: 'interval', value: { lo: -x.hi, hi: -x.lo } };
  }
  // Interval straddles zero - minimum is 0
  return {
    kind: 'interval',
    value: { lo: 0, hi: Math.max(-x.lo, x.hi) }
  };
}
```

### Min/Max

```typescript
function min(a: Interval, b: Interval): IntervalResult {
  return {
    kind: 'interval',
    value: { lo: Math.min(a.lo, b.lo), hi: Math.min(a.hi, b.hi) }
  };
}

function max(a: Interval, b: Interval): IntervalResult {
  return {
    kind: 'interval',
    value: { lo: Math.max(a.lo, b.lo), hi: Math.max(a.hi, b.hi) }
  };
}
```

### Floor/Ceiling

```typescript
function floor(x: Interval): IntervalResult {
  return {
    kind: 'interval',
    value: { lo: Math.floor(x.lo), hi: Math.floor(x.hi) }
  };
}

function ceil(x: Interval): IntervalResult {
  return {
    kind: 'interval',
    value: { lo: Math.ceil(x.lo), hi: Math.ceil(x.hi) }
  };
}
```

Note: These produce step-function discontinuities. The interval bounds are
correct, but plotting may want to detect when floor(x.lo) ≠ floor(x.hi) to
mark the jump.

### Modulo

```typescript
function mod(a: Interval, b: Interval): IntervalResult {
  // Modulo has discontinuities and is complex with interval divisor
  // Conservative approach: if interval spans a period, return [0, |b|)
  if (b.lo <= 0 && b.hi >= 0) {
    return { kind: 'singular' };  // Division by zero in mod
  }

  const bAbs = Math.max(Math.abs(b.lo), Math.abs(b.hi));
  const aWidth = a.hi - a.lo;

  if (aWidth >= bAbs) {
    // Interval is wide enough to span all possible mod values
    return { kind: 'interval', value: { lo: 0, hi: bAbs } };
  }

  // For narrow intervals, compute endpoint values
  // This may over-estimate due to wrap-around
  const modLo = ((a.lo % bAbs) + bAbs) % bAbs;
  const modHi = ((a.hi % bAbs) + bAbs) % bAbs;

  if (modLo <= modHi) {
    return { kind: 'interval', value: { lo: modLo, hi: modHi } };
  } else {
    // Wrap-around occurred - result spans [0, bAbs)
    return { kind: 'interval', value: { lo: 0, hi: bAbs } };
  }
}
```

### Comparisons (for Boolean intervals)

Comparisons produce three-valued logic: definitely true, definitely false, or
indeterminate.

```typescript
type BoolInterval = 'true' | 'false' | 'maybe';

function less(a: Interval, b: Interval): BoolInterval {
  if (a.hi < b.lo) return 'true';   // a entirely below b
  if (a.lo >= b.hi) return 'false'; // a entirely above or equal to b
  return 'maybe';                   // Intervals overlap
}

function equal(a: Interval, b: Interval): BoolInterval {
  // Equal only if both are point intervals with same value
  if (a.lo === a.hi && b.lo === b.hi && a.lo === b.lo) return 'true';
  // Definitely not equal if intervals don't overlap
  if (a.hi < b.lo || b.hi < a.lo) return 'false';
  return 'maybe';
}
```

### Conditionals and Piecewise

Conditionals require special handling because the predicate may be indeterminate
over an interval.

```typescript
function piecewise(
  x: Interval,
  condition: (x: Interval) => BoolInterval,
  trueBranch: (x: Interval) => IntervalResult,
  falseBranch: (x: Interval) => IntervalResult
): IntervalResult {
  const cond = condition(x);

  switch (cond) {
    case 'true':
      return trueBranch(x);
    case 'false':
      return falseBranch(x);
    case 'maybe':
      // Condition is indeterminate - must evaluate both branches
      // and return their union
      const t = trueBranch(x);
      const f = falseBranch(x);
      return unionResults(t, f);
  }
}

function unionResults(a: IntervalResult, b: IntervalResult): IntervalResult {
  // Handle special cases
  if (a.kind === 'empty') return b;
  if (b.kind === 'empty') return a;
  if (a.kind === 'singular' || b.kind === 'singular') {
    return { kind: 'singular' };
  }
  if (a.kind === 'entire' || b.kind === 'entire') {
    return { kind: 'entire' };
  }

  // Extract values and domain clip info
  const aVal = a.value;
  const bVal = b.value;
  const aDomainClip = a.kind === 'partial' ? a.domainClipped : null;
  const bDomainClip = b.kind === 'partial' ? b.domainClipped : null;

  const value = {
    lo: Math.min(aVal.lo, bVal.lo),
    hi: Math.max(aVal.hi, bVal.hi)
  };

  // Merge domain clipping info
  if (aDomainClip || bDomainClip) {
    const domainClipped = mergeDomainClip(aDomainClip, bDomainClip);
    return { kind: 'partial', value, domainClipped };
  }

  return { kind: 'interval', value };
}

function mergeDomainClip(
  a: 'lo' | 'hi' | 'both' | null,
  b: 'lo' | 'hi' | 'both' | null
): 'lo' | 'hi' | 'both' {
  if (a === 'both' || b === 'both') return 'both';
  if (a === null) return b!;
  if (b === null) return a;
  if (a === b) return a;
  return 'both';  // 'lo' + 'hi' = 'both'
}
```

**Design decision:** For `maybe` conditions, we return the union (hull) of both
branches. This is conservative but correct. For tighter bounds, the plotting
algorithm can subdivide until the condition becomes determinate.

## Challenges and Open Questions

### 1. Dependency Problem

Interval width tends to grow with complex expressions due to the "dependency
problem." For example, `x - x` with `x ∈ [0, 1]` evaluates to `[-1, 1]` in naive
interval arithmetic, not `[0, 0]`.

**Mitigation strategies:**

- Affine arithmetic (tracks linear dependencies)
- Symbolic simplification before compilation
- Taylor models for tighter bounds

### 2. Transcendental Function Accuracy

How accurately can we compute `sin([a, b])`? The interval must contain all
values of sine over `[a, b]`, which requires:

- Accurate endpoint evaluation
- Correct extremum detection
- Proper handling of multiple periods

### 3. User-Defined Functions

How do we handle functions defined by the user that we can't analyze? Options:

- Require interval versions of UDFs
- Sample-based interval estimation
- Conservative infinite intervals

### 4. Complex Numbers

The current targets don't support complex numbers. For interval arithmetic, we'd
need complex interval arithmetic (rectangles or disks in the complex plane),
which significantly increases complexity.

### 5. Performance

Interval arithmetic roughly doubles the computation per operation (two bounds
instead of one). For GLSL, this may be acceptable. For JavaScript, it could be a
concern for real-time plotting.

## Comparison with Alternatives

| Approach                      | Pros                                    | Cons                                  |
| ----------------------------- | --------------------------------------- | ------------------------------------- |
| **Interval Arithmetic**       | Rigorous bounds, detects singularities  | Overestimation, double computation    |
| **Automatic Differentiation** | Exact derivatives for adaptive sampling | Doesn't detect singularities directly |
| **Dense Sampling**            | Simple                                  | Slow, may miss features               |
| **Symbolic Analysis**         | Perfect for simple functions            | Doesn't work for all expressions      |

Interval arithmetic is particularly valuable because it provides **guaranteed
enclosures** - if the interval doesn't contain a singularity, there definitely
isn't one. This is harder to achieve with other approaches.

## References

- Moore, R.E., Kearfott, R.B., Cloud, M.J. (2009). _Introduction to Interval
  Analysis_. SIAM.
- Tupper, J. (2001). "Reliable Two-Dimensional Graphing Methods for Mathematical
  Formulae with Two Free Variables." SIGGRAPH.
- Gavriliu, M. (2005). "Towards More Efficient Interval Analysis: Corner Forms
  and a Remainder Newton Method."

## Summary

Adding interval arithmetic compilation would involve:

1. **New interval library** (~500-1000 lines) with ~30 interval operations
2. **New JavaScript target** (~400 lines) mapping MathJSON to interval functions
3. **New GLSL target** (~600 lines) with vec2-based interval operations
4. **Plotting integration API** for adaptive sampling and singularity reporting

The main challenges are:

- Correctly handling non-monotonic functions (trig, power)
- GLSL's lack of rounding mode control
- The dependency problem causing interval overestimation
- Performance considerations for real-time use

This would enable plotting packages to produce more accurate visualizations with
proper handling of singularities, discontinuities, and rapidly varying regions.

---

## Usage Guide

The interval arithmetic compilation targets have been implemented. This section
describes how to use them.

### JavaScript Target (`interval-js`)

#### Compiling an Expression

```typescript
import { ComputeEngine } from '@cortex-js/compute-engine';

const ce = new ComputeEngine();

// Parse a mathematical expression
const expr = ce.parse('sin(x) / x');

// Compile to interval JavaScript
const fn = expr.compile({ to: 'interval-js' });

// Check if compilation succeeded
if (fn.isCompiled) {
  // Call the function with interval inputs
  const result = fn({ x: { lo: -0.1, hi: 0.1 } });
  console.log(result);
  // { kind: 'singular' } - division by interval containing zero
}
```

#### Type Definitions

```typescript
/**
 * A closed interval [lo, hi] representing all real numbers between lo and hi.
 * Bounds may be -Infinity or +Infinity for unbounded intervals.
 */
interface Interval {
  lo: number;  // Lower bound (toward -∞)
  hi: number;  // Upper bound (toward +∞)
}

/**
 * The result of an interval arithmetic operation.
 * Discriminated union that captures both the computed interval
 * and information about domain validity.
 */
type IntervalResult =
  | { kind: 'interval'; value: Interval }
  // Normal result - the interval contains all possible output values

  | { kind: 'empty' }
  // No valid values exist (e.g., sqrt of negative interval)

  | { kind: 'entire' }
  // Result spans all real numbers (-∞, +∞)

  | { kind: 'singular'; at?: number }
  // Contains a singularity/pole (e.g., division by zero)
  // The optional `at` field gives approximate pole location

  | { kind: 'partial'; value: Interval; domainClipped: 'lo' | 'hi' | 'both' }
  // Partially valid - some input values were outside the domain
  // `domainClipped` indicates which bound(s) were restricted

/**
 * Three-valued boolean for interval comparisons.
 */
type BoolInterval = 'true' | 'false' | 'maybe';
```

#### Calling the Compiled Function

The compiled function accepts an object where keys are variable names and values
are `Interval` objects:

```typescript
const fn = ce.parse('x^2 + y').compile({ to: 'interval-js' });

// Evaluate with interval inputs
const result = fn({
  x: { lo: 1, hi: 2 },   // x ∈ [1, 2]
  y: { lo: 0, hi: 0.5 }  // y ∈ [0, 0.5]
});

// result = { kind: 'interval', value: { lo: 1, hi: 4.5 } }
// Because x² ∈ [1, 4] and y ∈ [0, 0.5], so x² + y ∈ [1, 4.5]
```

#### Interpreting Results

| Result Kind | Meaning | Plotting Action |
|-------------|---------|-----------------|
| `interval` | Normal computation succeeded | Draw the interval bounds |
| `empty` | No valid output values | Skip this region |
| `entire` | Result is all real numbers | Subdivide to refine |
| `singular` | Contains asymptote/pole | Mark singularity, subdivide |
| `partial` | Valid only for part of input | Draw valid part, mark boundary |

#### Examples

```typescript
const ce = new ComputeEngine();

// Example 1: Simple function
const sin = ce.parse('\\sin(x)').compile({ to: 'interval-js' });
sin({ x: { lo: 0, hi: Math.PI } });
// { kind: 'interval', value: { lo: 0, hi: 1 } }

// Example 2: Division - detecting singularity
const recip = ce.parse('1/x').compile({ to: 'interval-js' });
recip({ x: { lo: -1, hi: 1 } });
// { kind: 'singular' } - interval contains zero

recip({ x: { lo: 1, hi: 2 } });
// { kind: 'interval', value: { lo: 0.5, hi: 1 } }

// Example 3: Square root - partial domain
const sqrt = ce.parse('\\sqrt{x}').compile({ to: 'interval-js' });
sqrt({ x: { lo: -1, hi: 4 } });
// { kind: 'partial', value: { lo: 0, hi: 2 }, domainClipped: 'lo' }
// Valid only for [0, 4], the negative part was clipped

sqrt({ x: { lo: -4, hi: -1 } });
// { kind: 'empty' } - entirely outside domain

// Example 4: Logarithm - asymptotic behavior
const ln = ce.parse('\\ln(x)').compile({ to: 'interval-js' });
ln({ x: { lo: 0.5, hi: 2 } });
// { kind: 'interval', value: { lo: -0.693..., hi: 0.693... } }

ln({ x: { lo: -1, hi: 2 } });
// { kind: 'partial', value: { lo: -Infinity, hi: 0.693... }, domainClipped: 'lo' }
// ln approaches -∞ as x approaches 0 from the right

// Example 5: Tangent - detecting poles
const tan = ce.parse('\\tan(x)').compile({ to: 'interval-js' });
tan({ x: { lo: 1.5, hi: 1.6 } });  // Contains π/2 ≈ 1.57
// { kind: 'singular', at: 1.5707963267948966 }
```

### GLSL Target (`interval-glsl`)

The GLSL target generates shader code for GPU-based interval evaluation.

#### Generating Shader Code

```typescript
import { ComputeEngine } from '@cortex-js/compute-engine';
import { IntervalGLSLTarget } from '@cortex-js/compute-engine/compilation/interval-glsl-target';

const ce = new ComputeEngine();
const target = new IntervalGLSLTarget();

// Compile expression to GLSL
const expr = ce.parse('\\sin(x) + y^2');
const shader = target.compileShaderFunction(expr, {
  functionName: 'evaluateInterval',
  parameters: ['x', 'y'],
  version: '300 es'
});

console.log(shader);
```

#### Generated Shader Structure

The generated shader includes:

1. **Version and precision declarations**
2. **Status constants** for result classification
3. **IntervalResult struct** to hold result and status
4. **Interval arithmetic library** (ia_add, ia_mul, ia_sin, etc.)
5. **Your compiled function**

```glsl
#version 300 es
precision highp float;

// Status flags
const float IA_NORMAL = 0.0;
const float IA_EMPTY = 1.0;
const float IA_ENTIRE = 2.0;
const float IA_SINGULAR = 3.0;
const float IA_PARTIAL_LO = 4.0;
const float IA_PARTIAL_HI = 5.0;

// Result structure
struct IntervalResult {
  vec2 value;    // (lo, hi)
  float status;  // One of the IA_* constants
};

// ... interval arithmetic functions ...

// Your compiled function
IntervalResult evaluateInterval(vec2 x, vec2 y) {
  return ia_add(ia_sin(x), ia_square(y));
}
```

#### Using the Library Separately

You can also get just the GLSL library code:

```typescript
const target = new IntervalGLSLTarget();
const library = target.getLibrary();
// Returns the interval arithmetic function definitions
```

Or compile just the function body:

```typescript
const expr = ce.parse('x^2 + y');
const fnCode = target.compileFunction(expr, 'myFunc', ['x', 'y']);
// Returns: "IntervalResult myFunc(vec2 x, vec2 y) { ... }"
```

#### GLSL Interval Representation

In GLSL, intervals are represented as `vec2`:
- `interval.x` = lower bound (lo)
- `interval.y` = upper bound (hi)

The `IntervalResult` struct adds a status field for singularity detection.

### Accessing the Interval Library Directly

The interval arithmetic functions can also be used directly in TypeScript:

```typescript
import {
  // Types
  Interval,
  IntervalResult,
  BoolInterval,

  // Utilities
  ok,
  point,
  getValue,
  containsZero,

  // Arithmetic
  add,
  sub,
  mul,
  div,
  negate,

  // Elementary functions
  sqrt,
  square,
  pow,
  exp,
  ln,
  abs,

  // Trigonometric
  sin,
  cos,
  tan,

  // Comparisons
  less,
  equal,
  piecewise,
} from '@cortex-js/compute-engine/interval';

// Create intervals
const x: Interval = { lo: 1, hi: 2 };
const y: Interval = point(3);  // Point interval [3, 3]

// Perform operations
const sum = add(x, y);        // { kind: 'interval', value: { lo: 4, hi: 5 } }
const product = mul(x, y);    // { kind: 'interval', value: { lo: 3, hi: 6 } }

// Extract the interval value
const sumValue = getValue(sum);  // { lo: 4, hi: 5 } or undefined if not an interval

// Comparisons return three-valued logic
const cmp = less(x, y);  // 'true' because [1,2] < [3,3]
```

### Error Propagation

Interval operations automatically propagate errors through computations:

```typescript
const fn = ce.parse('\\sqrt{x} + y').compile({ to: 'interval-js' });

// If sqrt produces 'empty', the whole expression is 'empty'
fn({ x: { lo: -2, hi: -1 }, y: { lo: 0, hi: 1 } });
// { kind: 'empty' }

// If sqrt produces 'partial', the result is 'partial'
fn({ x: { lo: -1, hi: 4 }, y: { lo: 0, hi: 1 } });
// { kind: 'partial', value: { lo: 0, hi: 3 }, domainClipped: 'lo' }

// Singularities propagate
const fn2 = ce.parse('1/x + y').compile({ to: 'interval-js' });
fn2({ x: { lo: -1, hi: 1 }, y: { lo: 0, hi: 1 } });
// { kind: 'singular' }
```

### Limitations

1. **Dependency Problem**: The expression `x - x` with `x ∈ [0, 1]` evaluates to
   `[-1, 1]` rather than `[0, 0]` because interval arithmetic doesn't track
   variable dependencies.

2. **No Rigorous Rounding**: JavaScript doesn't provide rounding mode control,
   so intervals may not be mathematically rigorous enclosures. For plotting
   purposes, this is usually acceptable.

3. **Complex Numbers**: Not supported. All operations assume real-valued inputs
   and outputs.

4. **User-Defined Functions**: Only built-in mathematical functions are
   supported in interval mode.
