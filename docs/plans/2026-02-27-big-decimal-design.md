# Replace Decimal.js with BigInt-Based BigDecimal

**Date**: 2026-02-27
**Status**: Design approved

## Motivation

Replace the `decimal.js` dependency with a custom `BigDecimal` class backed by
native `bigint`. Goals:

- **Performance**: BigInt arithmetic is natively optimized by the JS engine,
  avoiding Decimal.js's JS-level digit-array loops.
- **Remove external dependency**: Own the code, control the API, eliminate a
  32KB dependency.

## Representation

```
value = significand × 10^exponent
```

- `significand: bigint` — normalized (no trailing zeros), except zero = `0n`
- `exponent: number` — base-10 exponent (number is sufficient for any practical
  range)
- Special values: NaN (`exponent = NaN`), ±Infinity (`exponent = Infinity`,
  `significand = ±1n`)

Immutable — all operations return new instances.

## Precision Model

Thread-local (module-level) precision:

```typescript
BigDecimal.precision = 50; // set by engine's setPrecision()
```

- **Exact operations** (add, sub, mul): no precision loss, no truncation.
- **Precision-bounded operations** (div, pow with non-integer exponent, all
  transcendentals): use `BigDecimal.precision`.
- **Guard digits**: transcendental implementations use `precision + 10`
  internally, round result to `precision`.

See `docs/NUMERIC-SERIALIZATION.md` for how precision affects the three output
paths (`.json`, `.latex`, `.toString()`).

## API Surface

### Construction

```typescript
new BigDecimal(value: string | number | bigint | BigDecimal)
```

### Static Constants

Recomputed when `BigDecimal.precision` changes:

```typescript
BigDecimal.ZERO            BigDecimal.ONE
BigDecimal.TWO             BigDecimal.HALF
BigDecimal.NEGATIVE_ONE    BigDecimal.PI
BigDecimal.NAN             BigDecimal.POSITIVE_INFINITY
BigDecimal.NEGATIVE_INFINITY
```

These replace the engine's `_BIGNUM_*` properties and the `IBigNum` interface.

### Arithmetic

```
add(other)  sub(other)  mul(other)  div(other)
pow(n)      neg()       abs()       mod(other)
```

### Comparison

```
eq(other)  lt(other)  lte(other)  gt(other)  gte(other)  cmp(other)
```

Parameters accept `BigDecimal | number`.

### State Checks

```
isNaN()  isZero()  isFinite()  isInteger()  isPositive()  isNegative()
```

### Rounding

```
floor()  ceil()  round()  trunc()
```

### Transcendental

```
sqrt()  cbrt()  ln()  log(base)  exp()
sin()   cos()   tan()
asin()  acos()  atan()
sinh()  cosh()  tanh()
```

Static: `BigDecimal.atan2(y, x)`, `BigDecimal.log10(x)`, `BigDecimal.sqrt(x)`.

### Conversion

```
toNumber()  toString()  toFixed(digits?)  toBigInt()
```

## Transcendental Function Algorithms

All transcendentals work internally in fixed-point BigInt arithmetic: scale to a
BigInt with `p` decimal digits of fractional precision, compute, convert back.
This avoids repeated `BigDecimal` object allocation in inner loops.

| Function | Algorithm | Notes |
|----------|-----------|-------|
| `sqrt` | Newton (Heron) | ~log2(p) iterations. Seed from `Math.sqrt(toNumber())`. |
| `cbrt` | Newton | Same approach, different iteration. |
| `exp` | Taylor + argument reduction | `exp(x) = exp(x/2^k)^(2^k)` until small. Rectangular splitting. |
| `ln` | AGM | `ln(x) = π/(2·AGM(1, 4/s))`. Quadratic convergence. |
| `log(base)` | `ln(x) / ln(base)` | Derived. |
| `sin`, `cos` | Taylor + argument reduction | Reduce mod 2π, double-angle to small arg. |
| `tan` | `sin(x) / cos(x)` | Simultaneous computation. |
| `asin` | `atan(x / sqrt(1-x²))` | Derived. |
| `acos` | `π/2 - asin(x)` | Derived. |
| `atan` | Taylor + argument reduction | `atan(x) = 2·atan(x/(1+√(1+x²)))` for large args. |
| `atan2` | `atan` + quadrant logic | Standard. |
| `sinh`, `cosh`, `tanh` | From `exp` | `sinh(x) = (exp(x) - exp(-x))/2`, etc. |
| `pow(non-int)` | `exp(n · ln(x))` | Integer powers use repeated squaring (exact). |
| `π` | From `atan` (Machin-like) or `acos(-1)` | Cached per precision level. |

Target precision range: up to ~1000 digits. Basic Taylor + rectangular splitting
is sufficient at this range — no need for binary splitting or bit-burst
algorithms.

## Module Location

```
src/big-decimal/
  big-decimal.ts              # Core class: repr, arithmetic, comparison, rounding
  transcendentals.ts          # exp, ln, sin, cos, atan, sqrt, etc.
  utils.ts                    # Fixed-point BigInt helpers, argument reduction
  index.ts                    # Public barrel export
```

**Standalone module** — no imports from `src/compute-engine/`. The dependency is
strictly one-way: compute-engine imports from `big-decimal`, never the reverse.
Designed for potential future extraction as a separate npm package.

## Integration with Compute Engine

### Files Modified (19 files currently importing `decimal.js`)

All changes are mechanical: `Decimal` → `BigDecimal`, `ce._BIGNUM_*` →
`BigDecimal.*`.

### Key Changes

**`BigNumericValue`** (`numeric-value/big-numeric-value.ts`):
- `decimal: Decimal` → `decimal: BigDecimal`
- Remove `bignum: BigNumFactory` field — construction is `new BigDecimal(value)`
- Remove `bignum` parameter from constructor

**`EngineNumericConfiguration`** (`engine-numeric-configuration.ts`):
- `Decimal.clone({ precision })` → `BigDecimal.precision = precision`
- Remove `_bignum: Decimal.Constructor` field
- `bignum(value)` factory simplifies to `new BigDecimal(value)`
- Remove `_BIGNUM_*` constants (now `BigDecimal.*`)
- Remove `IBigNum` interface, `BigNumFactory` type

**`NumericValue` base class** (`numeric-value/types.ts`):
- `bignumRe: Decimal | undefined` → `BigDecimal | undefined`
- `mul(other: number | Decimal | NumericValue)` → `number | BigDecimal | NumericValue`
- `isZeroWithTolerance(tolerance: number | Decimal)` → `number | BigDecimal`
- `NumericValueData.re: Decimal | number` → `BigDecimal | number`

**`numerics/types.ts`**:
- `type BigNum = Decimal` → `type BigNum = BigDecimal`
- Remove `BigNumFactory`, `IBigNum`

**Special functions** (`numerics/special-functions.ts`):
- Mechanical port: same algorithms, `BigNum` type now resolves to `BigDecimal`
- `ce.bignum(x)` → `new BigDecimal(x)`
- `ce._BIGNUM_*` → `BigDecimal.*`

### Unaffected

- `MachineNumericValue` — uses native `Math.*` and `number`
- `ExactNumericValue` — stores rationals as `[bigint, bigint]`, delegates to
  `BigNumericValue` via factory when needed

### Removed

- `decimal.js` from `package.json`
- `BigNumFactory` type
- `IBigNum` interface
- `_BIGNUM_*` constants from engine
- All `Decimal.Value`, `Decimal.Constructor` type references

## Testing Strategy

1. **BigDecimal unit tests**: arithmetic edge cases, NaN/Infinity propagation,
   precision boundaries, normalization invariants
2. **Transcendental accuracy**: cross-validate against Decimal.js at 50, 100,
   500, 1000 digit precisions
3. **Existing test suite**: all current tests must pass identically — this is
   the primary regression gate
4. **Performance benchmarks**: compare BigDecimal vs Decimal.js for
   representative operations (add, mul, div, exp, sin, ln) at various precisions
   (50, 100, 500, 1000 digits). Benchmarks should be repeatable and tracked.

## Risks

- **Transcendental correctness**: These are complex algorithms. Cross-validation
  against Decimal.js at multiple precisions mitigates this.
- **BigInt allocation pressure**: Every BigInt operation allocates. For tight
  inner loops (Taylor series terms), this could matter. Fixed-point internal
  arithmetic (plain bigint, not BigDecimal objects) mitigates this.
- **Division performance**: BigInt division is relatively expensive. AGM for ln
  (which avoids many divisions) and careful algorithm choice mitigate this.
