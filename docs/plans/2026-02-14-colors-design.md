# Colors Library Design

**Date**: 2026-02-14
**Spec**: `requirements/COLORS.md`

## Summary

Add 4 MathJSON operators (`Color`, `Colormap`, `ColorToColorspace`,
`ColorFromColorspace`) as a new `"colors"` standard library. The operators are
thin wrappers around the existing `src/color/` module.

## Canonical Representation

Colors are `Tuple` expressions with 3 or 4 real components in sRGB, normalized
to 0-1. Alpha is omitted when exactly 1.

## New Code

### 1. `rgbToHsl()` in `src/color/manipulation.ts`

Standard algorithm: max/min of RGB channels, derive H/S/L. Returns
`{h: 0-360, s: 0-1, l: 0-1}`. Export from `src/color/index.ts`.

### 2. `src/compute-engine/library/colors.ts`

Four operator definitions following existing library patterns:

- **`Color`**: calls `parseColor()` with support for named colors from the `NAMED_COLORS` palette (e.g. "red", "blue", "cyan", "dark-grey", "brown", "olive", etc.) or "transparent", normalizes 0-255 result to 0-1, returns `Tuple`.
- **`Colormap`**: looks up palette by name from `SEQUENTIAL_PALETTES`,
  `CATEGORICAL_PALETTES`, `DIVERGING_PALETTES`. Three variants dispatched by
  second arg type (missing → full palette, integer → resample, real → sample).
  Interpolation in OKLCh via `asOklch()`/`oklchToRgb()`, shorter hue arc.
- **`ColorToColorspace`**: dispatches on colorspace string (`"rgb"`, `"hsl"`,
  `"oklch"`, `"oklab"`/`"lab"`). Uses `rgbToOklab()`, `rgbToOklch()`,
  `rgbToHsl()`.
- **`ColorFromColorspace`**: inverse of above. Uses `oklabToRgb()`,
  `oklchToRgb()`, `hslToRgb()`.

### 3. Library registration

- Add `'colors'` to `LibraryCategory` in `latex-syntax/types.ts`
- Add entry to `STANDARD_LIBRARIES` in `library/library.ts`:
  `{ name: 'colors', requires: ['core'], definitions: COLORS_LIBRARY }`
- No LaTeX dictionary needed.

### 4. Tests

`test/compute-engine/colors.test.ts` covering:
- `Color` parsing (hex, rgb, hsl, oklch, named, transparent, invalid)
- `Colormap` all 3 variants (full, resample, sample-at-t)
- `ColorToColorspace` / `ColorFromColorspace` roundtrips
- Edge cases (unknown palette, t out of range, alpha handling)

## Dependencies

Only depends on `"core"` library. No new npm packages. All color math is in
`src/color/`.
