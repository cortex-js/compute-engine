# BigDecimal

Arbitrary-precision decimal arithmetic for TypeScript, backed by native `bigint`.

Built as a replacement for [decimal.js](https://github.com/MikeMcl/decimal.js/)
in the Compute Engine, with the goal of being faster while matching or exceeding
its accuracy.

## Representation

A value is stored as:

```
value = significand * 10^exponent
```

where `significand` is a `bigint` and `exponent` is a `number`.

Values are always **normalized**: trailing zeros in the significand are stripped
and the exponent adjusted. This means equal values have identical
`(significand, exponent)` pairs, which enables O(1) equality checks.

Special values use sentinel exponents:

| Value        | significand | exponent   |
| ------------ | ----------- | ---------- |
| NaN          | `0n`        | `NaN`      |
| +Infinity    | `1n`        | `Infinity` |
| -Infinity    | `-1n`       | `Infinity` |

## Module Structure

| File                 | Purpose                                                 |
| -------------------- | ------------------------------------------------------- |
| `big-decimal.ts`     | Core class: construction, arithmetic, comparison, conversion, formatting |
| `transcendentals.ts` | `sqrt`, `cbrt`, `exp`, `ln`, `sin`, `cos`, `tan`, `atan`, `asin`, `acos`, `sinh`, `cosh`, `tanh`, `atan2` -- attached to `BigDecimal.prototype` via declaration merging |
| `utils.ts`           | Fixed-point bigint primitives (`fpsqrt`, `fpexp`, `fpln`, `fpsincos`, `fpatan`), `pow10` cache, `bigintDigits`, PI constant (2370 digits) |
| `index.ts`           | Barrel export; imports `transcendentals.ts` for side effects |

## Precision Model

`BigDecimal.precision` (default 50) controls the number of significant digits
for **inexact** operations: `div`, `mod`, `pow` (integer exponent, which
truncates intermediates to prevent exponential significand growth), and all
transcendental functions.

**Exact** operations (`add`, `sub`, `mul`, `neg`, `abs`) preserve all digits.

Transcendental functions internally add 10-20 guard digits to the working
precision and round the final result to the target precision.

## Algorithms

### Fixed-point kernel

All transcendental functions work in a **fixed-point bigint** representation:
`fp / scale` where `scale = 10^p`. This avoids repeated normalization and
`BigDecimal` object allocation in inner loops. The `toFixedPoint` /
`fromFixedPoint` helpers in `transcendentals.ts` convert between the two
representations.

### Square root

Newton/Heron iteration in fixed-point (`fpsqrt`). Seeded from `Math.sqrt` when
values fit in float64, otherwise from a digit-count-based estimate. Converges
quadratically.

### Cube root

Newton iteration on `f(y) = y^3 - fp*scale^2`. Same seeding strategy as sqrt.

### Exponential

Taylor series with argument reduction (halving until `|r/scale| < 0.5`) followed
by repeated squaring to reconstruct.

### Natural logarithm

Newton's method on `f(y) = exp(y) - x`. For very high precisions where the input
overflows float64, argument reduction via repeated `sqrt` brings the value into
`[0.5, 2]` before seeding. A stall-detection heuristic terminates iteration when
truncation noise prevents further convergence.

### Sine / Cosine

Computed simultaneously via `fpsincos`:

1. **Range reduction**: mod 2pi (extended precision for large arguments)
2. **Quadrant reduction**: fold to `[0, pi/2]` with sign tracking
3. **Argument halving**: `k ~ 0.87 * sqrt(p)` halvings (capped at 18) to balance
   Taylor terms vs reconstruction cost
4. **Taylor series**: interleaved sin/cos terms
5. **Double-angle reconstruction**: `sin(2t) = 2*sin(t)*cos(t)`,
   `cos(2t) = 2*cos^2(t) - 1`

The adaptive halving gives O(sqrt(p)) total multiplications instead of O(p).

### Arctangent

1. Sign reduction and reciprocal identity (`atan(x) = pi/2 - atan(1/x)` for
   `|x| > 1`)
2. Repeated halving via `atan(x) = 2*atan(x / (1 + sqrt(1 + x^2)))` until
   `|x| < 0.4`
3. Taylor series: `atan(t) = t - t^3/3 + t^5/5 - ...`

### Arcsine / Arccosine

Reduced to `atan` via `asin(x) = atan(x / sqrt(1 - x^2))` and
`acos(x) = pi/2 - asin(x)`, computed entirely in fixed-point to avoid
intermediate precision loss.

### Hyperbolic functions

Built on `exp`:
- `sinh(x) = (exp(x) - 1/exp(x)) / 2`
- `cosh(x) = (exp(x) + 1/exp(x)) / 2`
- `tanh(x) = (exp(2x) - 1) / (exp(2x) + 1)`

## Performance vs Decimal.js

Benchmarked at precisions 50, 100, and 500. Representative speedups:

| Operation  | p=50   | p=100   | p=500    |
| ---------- | ------ | ------- | -------- |
| mul        | 7.6x   | 3.2x    | 6.5x     |
| div        | 1.9x   | 1.6x    | 3.2x     |
| eq         | 5.0x   | 3.5x    | 7.3x     |
| sqrt       | 6.3x   | 8.6x    | 43x      |
| cbrt       | 12x    | 24x     | 166x     |
| exp        | 7.7x   | 13x     | 42x      |
| ln         | 2.7x   | 6.6x    | 15x      |
| sin        | 3.6x   | 4.0x    | 3.8x     |
| cos        | 3.3x   | 3.7x    | 4.2x     |
| atan       | 48x    | 112x    | 410x     |
| asin       | 55x    | 90x     | 381x     |

Accuracy is identical: both libraries produce the same significant digits at
every tested precision (verified via cross-validation tests).

### Why it's faster

- **Native `bigint`** for the significand vs Decimal.js's base-10^7 digit arrays
  with manual carry propagation. V8's bigint implementation uses optimized
  algorithms (Karatsuba, Toom-Cook, Burnikel-Ziegler) under the hood.
- **Fixed-point kernel** for transcendentals avoids per-operation normalization
  and object allocation.
- **Normalized representation** enables O(1) equality via field comparison
  instead of digit-by-digit.
- **Adaptive argument reduction** (sin/cos halving scales as sqrt(p) instead of
  constant).

## Potential Future Improvements

- **AGM-based logarithm**: The current Newton iteration calls `fpexp` at each
  step, making `ln` the slowest transcendental. An arithmetic-geometric mean
  (AGM) algorithm would compute `ln` in `O(log(p) * M(p))` time without needing
  `exp` at all.

- **Binary splitting for exp/sin/cos**: The Taylor series evaluate one term at a
  time, each requiring a full-precision division. Binary splitting computes the
  series as a rational `P/Q` via a divide-and-conquer tree, deferring the single
  final division. This is asymptotically faster for high precision.

- **Increase guard digits for small precisions**: At precision 50, `exp(1)`
  delivers 46/50 correct digits (3 guard digits lost). Bumping guard digits from
  15 to 20 for p < 100 would close the gap with minimal performance cost.

- **Lazy normalization**: `add` and `sub` normalize on every call (strip trailing
  zeros). Deferring normalization to "observation points" (toString, comparisons)
  could speed up chains of additions, at the cost of more complex invariant
  management.

- **Subquadratic multiplication threshold**: For very high precisions
  (p > 10000), the native bigint multiply becomes the bottleneck. A
  Number-Theoretic Transform (NTT) based multiplication could help, though V8
  already uses Karatsuba/Toom-Cook internally.

- **PI computation**: The hardcoded 2370-digit constant limits working precision
  to ~2350 digits. For higher precisions, a Chudnovsky or Machin-like formula
  could compute PI on demand.
