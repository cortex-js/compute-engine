# Numeric Serialization and Precision

This document describes how numeric values produced by the Compute Engine are
serialized through its three output paths, and the precision semantics of each.

## Background: Exact vs Precision-Bounded Arithmetic

The `BigDecimal` class uses a dual arithmetic model:

- **Exact operations** (`add`, `sub`, `mul`): produce results with no precision
  loss. The result has as many significant digits as needed to represent the
  exact answer.
- **Precision-bounded operations** (`div`, `pow` with non-integer exponent, all
  transcendentals): round to `BigDecimal.precision` significant digits.
  Transcendental implementations use guard digits internally and round the final
  result.

Because exact operations preserve all digits and precision-bounded operations
introduce rounding at the working precision boundary, intermediate results can
accumulate more digits than the working precision. For example, multiplying two
100-digit numbers produces up to 200 digits, all of which are exact. But
dividing that result rounds back to 100 digits, and subsequent exact
multiplications may again grow the digit count.

This means raw internal values can have **more significant digits than the
working precision**, and the trailing digits beyond the precision boundary are
**noise** (artifacts of accumulated rounding from earlier bounded operations).

## The Three Output Paths

### `.json` — Full-Fidelity Data Interchange

```typescript
expr.json; // MathJsonExpression
expr.toJSON(); // same (called by JSON.stringify)
```

**Precision**: No rounding. Emits the full raw `BigDecimal` value, including all
digits beyond the working precision.

**Rationale**: `.json` is the data interchange format. It must be lossless so
that:

- Round-tripping (`ce.box(expr.json)`) preserves the exact internal state
- Downstream consumers can apply their own precision policy
- No information is silently discarded

**Tradeoff**: The output may contain trailing digits that are not meaningful at
the current working precision. Consumers should be aware that digits beyond
`ce.precision` are not guaranteed to be accurate.

**When to use**: Serialization, data storage, expression transfer between
engines, debugging internal state.

### `.latex` — Human-Readable Mathematical Notation

```typescript
expr.latex; // string (LaTeX)
expr.toLatex(options?); // string (LaTeX) with custom options
```

**Precision**: Rounds to `ce.precision` significant digits via
`toMathJson({ fractionalDigits: 'auto' })`.

**Rationale**: LaTeX output is for human consumption (documents, notebooks, UI).
Displaying noise digits would be misleading — it implies accuracy that doesn't
exist. Rounding to the working precision shows exactly the digits the engine can
vouch for.

**When to use**: Display, rendering, export to documents.

### `.toString()` — Console/Debug Display

```typescript
expr.toString(); // ASCIIMath string
String(expr); // same (via Symbol.toPrimitive)
```

**Precision**: For `BigNumericValue`, rounds the real part to
`BigDecimal.precision` significant digits via `toPrecision()`. Machine-precision
numbers use their native `toString()` (~15-17 significant digits).

**Rationale**: Same as `.latex` — debug output should show meaningful digits
only. Seeing `0.625000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000078125`
when the working precision is 100 is confusing. The rounded form `0.625` clearly
communicates the value.

**When to use**: Console output, debugging, test assertions (via snapshot
serializer).

## `toMathJson()` — Configurable Serialization

```typescript
expr.toMathJson({ fractionalDigits: 'auto' }); // rounded to ce.precision
expr.toMathJson({ fractionalDigits: 'max' }); // all digits (like .json)
expr.toMathJson({ fractionalDigits: 5 }); // 5 fractional digits
```

The `fractionalDigits` option on `toMathJson()` controls digit output:

| Value    | Behavior                                      |
| -------- | --------------------------------------------- |
| `'max'`  | All available digits (default)                |
| `'auto'` | Round to `ce.precision` significant digits    |
| `n >= 0` | Exactly `n` digits after the decimal point    |

Internally, `'auto'` is converted to `-ce.precision` (a negative number) to
signal "total significant digits" rather than "fractional digits" to the
serializer.

## Design Decision: Why `.json` Is Not Rounded

We considered rounding `.json` to the working precision but decided against it:

**Arguments for rounding .json:**

- Consistent with `.latex` and `.toString()`
- Consumers don't need to know about the precision model
- Smaller JSON output

**Arguments against (chosen):**

- **Data fidelity**: `.json` is the interchange format. Silent truncation
  violates the principle of least surprise for data serialization.
- **Round-trip safety**: `ce.box(expr.json)` must reconstruct the original
  internal state. Rounding `.json` would make this impossible.
- **Consumer choice**: Different consumers may want different precision. The raw
  data lets them decide.
- **Explicit opt-in**: `toMathJson({ fractionalDigits: 'auto' })` provides
  rounded MathJSON output for consumers who want it.

## Summary Table

| Path          | Rounding          | Use Case                |
| ------------- | ----------------- | ----------------------- |
| `.json`       | None (raw)        | Data interchange        |
| `.latex`      | `ce.precision`    | Human-readable display  |
| `.toString()` | `ce.precision`    | Console/debug display   |
| `toMathJson`  | Configurable      | Explicit serialization  |
