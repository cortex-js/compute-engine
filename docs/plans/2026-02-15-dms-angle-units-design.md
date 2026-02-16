# DMS Angle Units Design

**Date:** 2026-02-15
**Status:** Implemented
**Issue:** https://github.com/cortex-js/compute-engine/issues/172

## Overview

Enable parsing and serialization of degrees-minutes-seconds (DMS) angle notation using the existing unit system.

### Goal

Support geographic coordinate notation like `9°30'15"` by treating arc-minutes (`'`) and arc-seconds (`"`) as angle units when they appear after degree symbols.

### Key Design Decisions

- `9°30'15"` parses as `Degrees(9.504166...)` — DMS components are computed to decimal degrees at parse time
- Prime symbols (`'`, `"`) are only interpreted as arcmin/arcsec when immediately following a degree symbol (`°`)
- `DMS(9, 30, 15)` provides programmatic angle construction, canonicalizing to `Degrees(9.504166...)`
- Canonicalization converts `Degrees(n)` to radians (or preserves decimal degrees when `angularUnit === 'deg'`)
- Serialization is configurable: output as decimal degrees or DMS format
- `Negate` accepts `value` type (not just `number`), so `Negate(Degrees(9.5))` works correctly
- Support both shorthand (`9°30'`) and explicit (`\mathrm{arcmin}`) notation

### Files to Modify

1. `src/compute-engine/latex-syntax/dictionary/definitions-arithmetic.ts` - Extend degree parser
2. `src/compute-engine/latex-syntax/serializer.ts` - Add DMS serialization logic
3. `src/compute-engine/types-serialization.ts` - Add configuration options
4. Tests in `test/compute-engine/latex-syntax/parse-dms.test.ts` - New test file

## Implementation Approach

**Extend the Degree Postfix Parser** - Modify the existing `^\circ` postfix parser to look ahead for `'` and `"` symbols.

### Rationale

- All DMS logic in one place (the degree parser)
- Natural parsing flow
- Decimal-degree computation at parse time ensures `Negate` wraps a single `Degrees(n)` expression, avoiding issues with `Negate(Add(Quantity(...)))` canonicalization
- Avoids precedence conflicts with existing Prime operators

### Alternatives Considered

- **Chain of postfix operators:** Complex state tracking, precedence conflicts
- **Two-phase parsing:** Fragile pattern matching, harder to understand

## LaTeX Parsing Changes

**Location:** `src/compute-engine/latex-syntax/dictionary/definitions-arithmetic.ts`

### Current Behavior

The degree parser (lines 640-658) handles `^\circ` and `°` postfix operators and returns `['Degrees', lhs]`.

### New Behavior

Extend the degree parser to look ahead, consume arc-minutes and arc-seconds, and compute decimal degrees at parse time:

```typescript
function parseDMS(parser, lhs) {
  // Look ahead for arc-minutes: 30'
  const minExpr = parser.parseNumber();
  if (minExpr && (parser.match("'") || parser.match('\\prime'))) {
    // Look ahead for arc-seconds: 15"
    const secExpr = parser.parseNumber();
    if (secExpr && (parser.match('"') || parser.match('\\doubleprime'))) {
      secNum = machineValue(secExpr);
    }

    // Compute total decimal degrees
    const total = degNum + minNum / 60 + secNum / 3600;
    return ['Degrees', total];
  }

  return ['Degrees', lhs];
}
```

### Key Details

- Only consume `'`/`"` if they immediately follow a number after the degree symbol
- Stop consuming if we don't see the expected pattern
- Fall back to single `Degrees` if no arc-minutes/seconds found
- Compute decimal degrees at parse time (not `Add(Quantity(...))`) so negation produces `Negate(Degrees(n))`
- Symbolic fallback: if components aren't all numeric, falls back to `Add(Quantity(...))` form

### Edge Cases

- `9°` → `Degrees(9)` (no change)
- `9°30'` → `Degrees(9.5)`
- `9° f'(x)` → `Degrees(9)` followed by `f'(x)` (prime is derivative, not arcmin)
- `9°30'15"` → `Degrees(9.504166...)`
- `-9°30'` → `Negate(Degrees(9.5))`

## Unit Registry & Canonicalization

### Unit Registry

**Location:** `src/compute-engine/numerics/unit-data.ts`

Units already exist with correct conversions:
```typescript
'arcmin': { dimension: [0, 0, 0, 0, 0, 0, 0], scale: Math.PI / 10800 },  // 1/60 deg
'arcsec': { dimension: [0, 0, 0, 0, 0, 0, 0], scale: Math.PI / 648000 }, // 1/3600 deg
```

No changes needed. ✓

### Canonicalization

DMS components are computed to decimal degrees at parse time. The `Degrees` canonical handler then:
1. Converts the decimal degrees to radians (e.g., `Degrees(9.5)` → `9.5π/180`)
2. Applies rational reduction for integer degree values (e.g., `Degrees(90)` → `π/2`)
3. If `engine.angularUnit === 'deg'`, returns just the numeric value without conversion

## Serialization & Configuration

### Configuration Options

**Location:** `src/compute-engine/types-serialization.ts`

Add to `SerializeLatexOptions`:
```typescript
export interface SerializeLatexOptions {
  // ... existing options ...

  /**
   * When true, serialize angle quantities in degrees-minutes-seconds format.
   * When false (default), use decimal degrees.
   *
   * Examples:
   * - true: Quantity(9.5, deg) → "9°30'"
   * - false: Quantity(9.5, deg) → "9.5°"
   */
  dmsFormat?: boolean;

  /**
   * Normalize angles to a specific range during serialization.
   * - 'none': No normalization (default) - show exact value
   * - '0...360': Normalize to [0, 360)
   * - '-180...180': Normalize to [-180, 180]
   */
  angleNormalization?: 'none' | '0...360' | '-180...180';
}
```

### Serialization Logic

**Location:** `src/compute-engine/latex-syntax/serializer.ts`

When serializing a `Quantity` expression with angle units and `dmsFormat: true`:

1. Check if the quantity has angle dimension (deg, arcmin, arcsec, rad)
2. Convert the value to degrees
3. Apply normalization based on `angleNormalization` option:
   ```typescript
   function normalizeAngle(degrees: number, mode: string): number {
     switch (mode) {
       case '0...360':
         return ((degrees % 360) + 360) % 360;
       case '-180...180':
         return ((degrees + 180) % 360) - 180;
       default: // 'none'
         return degrees;
     }
   }
   ```
4. Extract integer degrees, minutes, seconds:
   ```typescript
   const totalDegrees = normalizeAngle(convertToDegrees(value, unit), mode);
   const deg = Math.floor(totalDegrees);
   const minDecimal = (totalDegrees - deg) * 60;
   const min = Math.floor(minDecimal);
   const sec = (minDecimal - min) * 60;
   ```
5. Format as LaTeX:
   - If `sec > 0.001`: `"9°30'15""` (or `9°30'15.5"` if fractional)
   - If `min > 0`: `"9°30'"`
   - Otherwise: `"9°"`

### Threshold Behavior

To avoid ugly output like `9°7'24.444444"`, apply rounding:
- Round seconds to 2-3 decimal places
- If seconds round to 60, carry to minutes
- If minutes round to 60, carry to degrees

### Examples

```typescript
// No normalization
serialize(Degrees(370), { angleNormalization: 'none' }) → "370°"

// Normalize to [0, 360)
serialize(Degrees(370), { angleNormalization: '0...360' }) → "10°"
serialize(Degrees(-45), { angleNormalization: '0...360' }) → "315°"

// Normalize to [-180, 180]
serialize(Degrees(190), { angleNormalization: '-180...180' }) → "-170°"
serialize(Degrees(-45), { angleNormalization: '-180...180' }) → "-45°"

// DMS format
serialize(Quantity(9.5, 'deg'), { dmsFormat: true }) → "9°30'"
serialize(Quantity(9.504166, 'deg'), { dmsFormat: true }) → "9°30'15""

// Combined: DMS + normalization
serialize(Degrees(370), {
  dmsFormat: true,
  angleNormalization: '0...360'
}) → "10°0'0""
```

## Error Handling & Angle Normalization

### Negative Angles

Negative DMS notation preserves the sign correctly (critical for latitude/longitude):

**Parsing:**
- `-9°30'15"` → `Negate(Degrees(9.504166...))`
- The minus sign produces `Negate`, and the DMS parser computes decimal degrees for the positive part

**Convention:** In geographic notation, `-9°30'` means "9 degrees 30 minutes South/West", not "minus 9 degrees plus 30 minutes"

**`Negate` type:** Uses `'(value) -> value'` signature (not just `number`), so it correctly handles `Degrees` and `Quantity` expressions

### No Canonical Normalization

The canonical form preserves the exact mathematical value:
- `370°` remains as `Degrees(370)` → canonical value ≈ 6.458... radians
- No automatic wrapping to `[0, 360)` during canonicalization
- Normalization happens only during serialization (controlled by `angleNormalization` option)

### Other Edge Cases

All handled by existing quantity system:
- **Out-of-range values:** `9°90'` → mathematically valid, canonicalizes to `10°30'`
- **Mixed operations:** `9°30' + 1°` → parses and simplifies correctly
- **Type validation:** Quantities with angle units work in trigonometric functions and unit conversions

## Testing

**Test File:** `test/compute-engine/latex-syntax/parse-dms.test.ts` (new)

### Test Categories

**1. Basic DMS Parsing:**
```typescript
check('9°', ['Degrees', 9])
check('9°30\'', ['Degrees', 9.5])
check('9°30\'15"', ['Degrees', { num: '9.504166666666666' }])
check('30\\,\\mathrm{arcmin}', ['Quantity', 30, 'arcmin'])
```

**2. Negative Angles:**
```typescript
check('-9°30\'', ['Negate', ['Degrees', 9.5]])
// Evaluates to -9.5° ≈ -0.1658 radians
```

**3. Arithmetic Operations:**
```typescript
check('9°0\'0" + 1°0\'0"') → evaluates to 10°
check('45°30\' + 44°30\'') → evaluates to 90°
```

**4. Prime/Derivative Disambiguation:**
```typescript
check('9°30\'') → DMS (arcminute)
check('f\'(x)') → derivative
check('9° f\'(x)') → Degrees(9) followed by derivative
```

**5. Serialization:**
```typescript
serialize(ce.box(['Quantity', 9.5, 'deg']), { dmsFormat: true }) → "9°30'"
serialize(ce.box(['Degrees', 370]), { angleNormalization: '0...360' }) → "10°"
serialize(ce.box(['Degrees', 190]), { angleNormalization: '-180...180' }) → "-170°"
```

**6. Edge Cases:**
```typescript
check('9°30.5\'') → valid, 30.5 arcminutes
check('9°90\'') → evaluates to 10°30'
check('0°0\'0"') → evaluates to 0°
```

## Implementation Notes

### Precedence

The degree parser has precedence 880 (postfix). This is higher than Prime (810), ensuring `9°` is parsed before looking for `'`.

### Backwards Compatibility

- Existing `Degrees` function behavior unchanged when no DMS components present
- Existing Prime/derivative parsing unaffected (only triggers after non-degree expressions)
- No breaking changes to API or canonical forms

### Future Enhancements

Possible future additions:
- Cardinal directions: `45°30'N` or `9°15'W`
- Latitude/longitude validation functions
- Smarter DMS serialization (only use when "nice" decimal values)
