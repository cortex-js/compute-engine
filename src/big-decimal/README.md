# BigDecimal

Arbitrary-precision decimal arithmetic for TypeScript, backed by native
`bigint`.

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

| Value     | significand | exponent   |
| --------- | ----------- | ---------- |
| NaN       | `0n`        | `NaN`      |
| +Infinity | `1n`        | `Infinity` |
| -Infinity | `-1n`       | `Infinity` |

## Module Structure

| File                 | Purpose                                                                                                                                                                 |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `big-decimal.ts`     | Core class: construction, arithmetic, comparison, conversion, formatting, directed-rounding `divToward`/`sqrtToward`                                                     |
| `transcendentals.ts` | `sqrt`, `cbrt`, `nthRoot`, `exp`, `expm1`, `ln`, `log`, `log2`, `log1p`, `sin`, `cos`, `tan`, `atan`, `asin`, `acos`, `atan2`, `sinh`, `cosh`, `tanh`, `asinh`, `acosh`, `atanh` -- attached to `BigDecimal.prototype` via declaration merging |
| `utils.ts`           | Fixed-point bigint primitives (`fpsqrt`, `fpexp`, `fpln` [giant_steps Newton + AGM], `fpsincos`, `fpatan`), `pow10` cache, `bigintDigits`/`bitLength`, `bigintSqrt`, Chudnovsky π / binary-split ln 2, PI table (2370 digits)                  |
| `index.ts`           | Barrel export; imports `transcendentals.ts` for side effects                                                                                                            |

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

All transcendental functions work in a **base-2 fixed-point bigint**
representation: `fp / 2^bits`. Scaling by the radix is then a bit-shift
(`>> bits` / `<< bits`) rather than a division by `10^p`, which is the dominant
cost in the Taylor/Newton inner loops — 2–4× faster at identical accuracy (see
the kernel header in `utils.ts` and ROADMAP item 17.1). The fixed-point grid
also avoids repeated normalization and `BigDecimal` object allocation in inner
loops. The `toFixedPoint` / `fromFixedPoint` helpers in `transcendentals.ts`
convert decimal↔binary once at the boundary; the user-facing
`significand · 10^exponent` representation is unchanged.

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

Benchmarked at precisions 50, 100, and 500. Representative speedups.

> Note: these numbers predate the base-2 kernel (ROADMAP 17.1, June 2026). The
> transcendental rows (`sqrt`, `cbrt`, `exp`, `ln`, `sin`, `cos`, `atan`,
> `asin`) are now an additional ~2–4× faster than shown; the arithmetic rows
> (`add`/`sub`/`mul`/`div`/`eq`) are unchanged.

| Operation | p=50 | p=100 | p=500 |
| --------- | ---- | ----- | ----- |
| add       | 1.9x | ~1x   | ~1x   |
| sub       | 2.8x | 4.0x  | 1.6x  |
| mul       | 8.3x | 4.2x  | 6.6x  |
| div       | 2.4x | 1.4x  | 3.4x  |
| eq        | 5.3x | 8.5x  | 8.8x  |
| sqrt      | 7.0x | 7.8x  | 40x   |
| cbrt      | 13x  | 20x   | 153x  |
| exp       | 9.0x | 13x   | 44x   |
| ln        | 2.7x | 7.3x  | 11x   |
| sin       | 3.5x | 3.7x  | 3.8x  |
| cos       | 3.5x | 3.5x  | 4.4x  |
| atan      | 72x  | 120x  | 599x  |
| asin      | 35x  | 87x   | 208x  |

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

> Tracked as ROADMAP item 17 (`../../ROADMAP.md`), with mpmath-derived lessons
> ranked by ROI. **Landed 2026-06-13** (items 1–7 there):
>
> - **Base-2 internal kernel** — the per-term `/scale` is now a bit-shift;
>   **2–4× faster** transcendentals at identical accuracy. A/B record:
>   `benchmarks/big-decimal/kernel-base2-experiment.ts`.
> - **AGM logarithm** above ~1250 digits + **`giant_steps`** Newton below it —
>   faster `ln` (no longer the slow outlier).
> - **On-demand Chudnovsky π** + **binary-split `ln 2`** — no precision ceiling
>   for π / trig / inverse-trig / `BigDecimal.PI` (was ~2350 digits).
> - **Elementary functions** `expm1`, `log1p`, `log2`, `asinh`, `acosh`,
>   `atanh`, `nthRoot`; **directed rounding** `divToward`/`sqrtToward`.

Still open:

- **Rectangular splitting (Smith's method) for `exp`/trig**: binary splitting
  does *not* help these for irrational arguments (the BS products grow to
  `N·bits` bits). Rectangular splitting evaluates the Taylor series with
  `O(√N)` full-size multiplications instead of `O(N)`, the right high-precision
  technique for an irrational argument.

- **Interval-arithmetic (`iv`) mode**: the directed-rounding primitives
  (`divToward`/`sqrtToward`) are in place; a full `[lo, hi]` interval type on
  top (mpmath's `iv` context) would give rigorous sign/zero determination. Build
  when a consumer needs it.

- **Lazy normalization**: `add` and `sub` normalize on every call (strip
  trailing zeros). Deferring normalization to "observation points" (toString,
  comparisons) could speed up chains of additions, at the cost of more complex
  invariant management.

- **Subquadratic multiplication threshold**: For very high precisions (p >
  10000), the native bigint multiply becomes the bottleneck. A Number-Theoretic
  Transform (NTT) based multiplication could help, though V8 already uses
  Karatsuba/Toom-Cook internally (it has no FFT, which caps the binary-splitting
  and AGM asymptotic wins in the low-thousands of digits).
