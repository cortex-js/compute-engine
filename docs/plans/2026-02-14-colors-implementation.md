# Colors Library Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add 4 MathJSON color operators (`Color`, `Colormap`, `ColorToColorspace`, `ColorFromColorspace`) as a standard library.

**Architecture:** Thin operator definitions in `library/colors.ts` delegating to existing `src/color/` utilities. One missing utility (`rgbToHsl`) needs to be added first. Library registered in `STANDARD_LIBRARIES` with `requires: ['core']`.

**Tech Stack:** TypeScript, existing `src/color/` module, compute-engine library system.

---

### Task 1: Add `rgbToHsl` and export it

**Files:**
- Modify: `src/color/manipulation.ts` (add function after existing `hslToRgb` at line ~143)
- Modify: `src/color/index.ts` (add export)

**Step 1: Write `rgbToHsl` in `src/color/manipulation.ts`**

Add this function right after the existing `hslToRgb` function (after line 143):

```typescript
/** Convert an RGB color (0-255 per channel) to HSL.
 * Returns h: 0-360, s: 0-1, l: 0-1. */
export function rgbToHsl(
  r: number,
  g: number,
  b: number,
): { h: number; s: number; l: number } {
  r /= 255;
  g /= 255;
  b /= 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;

  if (max === min) return { h: 0, s: 0, l };

  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);

  let h: number;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;

  return { h: h * 360, s, l };
}
```

**Step 2: Export from `src/color/index.ts`**

Add `rgbToHsl` to the manipulation exports:

```typescript
export {
  oklch,
  oklchFromRGB,
  parseColor,
  rgbToHsl,     // ← add this
  cMaxFor,
  // ... rest unchanged
} from "./manipulation";
```

**Step 3: Verify it compiles**

Run: `npx tsc --noEmit --pretty 2>&1 | head -20`

**Step 4: Commit**

```
feat(color): add rgbToHsl conversion function
```

---

### Task 2: Add `'colors'` to `LibraryCategory` and `STANDARD_LIBRARIES`

**Files:**
- Modify: `src/compute-engine/latex-syntax/types.ts:60-76` (add to union)
- Modify: `src/compute-engine/library/library.ts` (add import + entry)

**Step 1: Add `'colors'` to `LibraryCategory` in `src/compute-engine/latex-syntax/types.ts`**

Add `| 'colors'` to the `LibraryCategory` type union (alphabetically, after `'combinatorics'`):

```typescript
export type LibraryCategory =
  | 'arithmetic'
  | 'calculus'
  | 'collections'
  | 'colors'          // ← add this line
  | 'combinatorics'
  | 'control-structures'
  | 'core'
  // ... rest unchanged
```

**Step 2: Add stub import and entry in `src/compute-engine/library/library.ts`**

At top of file, add import:

```typescript
import { COLORS_LIBRARY } from './colors';
```

In `STANDARD_LIBRARIES` array, add after the `collections` entry:

```typescript
  {
    name: 'colors',
    requires: ['core'],
    definitions: COLORS_LIBRARY,
  },
```

**Step 3: Create minimal stub `src/compute-engine/library/colors.ts`**

```typescript
import type { SymbolDefinitions } from '../global-types';

export const COLORS_LIBRARY: SymbolDefinitions = {};
```

**Step 4: Verify it compiles**

Run: `npx tsc --noEmit --pretty 2>&1 | head -20`

**Step 5: Commit**

```
feat(color): register colors library in STANDARD_LIBRARIES
```

---

### Task 3: Implement `Color` operator

**Files:**
- Modify: `src/compute-engine/library/colors.ts`
- Create: `test/compute-engine/colors.test.ts`

**Step 1: Write failing tests in `test/compute-engine/colors.test.ts`**

```typescript
import { ComputeEngine } from '../../src/compute-engine';

const ce = new ComputeEngine();

function evaluateColor(input: string) {
  const expr = ce.box(['Color', `'${input}'`]);
  const result = expr.evaluate();
  if (result.operator === 'Tuple') {
    return result.ops!.map((op) => {
      const v = op.re;
      return Math.round(v * 1000) / 1000;
    });
  }
  return result.json;
}

describe('Color', () => {
  test('hex 6-digit', () => {
    const result = evaluateColor('#ff0000');
    expect(result).toEqual([1, 0, 0]);
  });

  test('hex 3-digit', () => {
    const result = evaluateColor('#f00');
    expect(result).toEqual([1, 0, 0]);
  });

  test('hex 8-digit with alpha', () => {
    const result = evaluateColor('#ff000080');
    expect(result).toHaveLength(4);
    expect(result[0]).toEqual(1);
    expect(result[3]).toBeCloseTo(0.502, 1);
  });

  test('rgb()', () => {
    const result = evaluateColor('rgb(255, 0, 0)');
    expect(result).toEqual([1, 0, 0]);
  });

  test('hsl()', () => {
    const result = evaluateColor('hsl(0, 100%, 50%)');
    expect(result).toEqual([1, 0, 0]);
  });

  test('named color', () => {
    const result = evaluateColor('red');
    expect(result).toHaveLength(3);
    expect(result[0]).toBeGreaterThan(0.5);
  });

  test('transparent', () => {
    const result = evaluateColor('transparent');
    expect(result).toEqual([0, 0, 0, 0]);
  });

  test('invalid input returns error', () => {
    const expr = ce.box(['Color', "'not-a-color'"]);
    const result = expr.evaluate();
    expect(result.operator).toBe('Error');
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npm run test compute-engine/colors`
Expected: FAIL — `Color` not defined as an operator.

**Step 3: Implement `Color` operator in `src/compute-engine/library/colors.ts`**

```typescript
import type { SymbolDefinitions } from '../global-types';
import { parseColor } from '../../color';
import { isString } from '../boxed-expression/type-guards';

/** Convert a 0xRRGGBBAA packed integer to a Tuple of 0-1 sRGB components. */
function colorNumberToTuple(
  ce: any,
  color: number
): any {
  const r = ((color >>> 24) & 0xff) / 255;
  const g = ((color >>> 16) & 0xff) / 255;
  const b = ((color >>> 8) & 0xff) / 255;
  const a = (color & 0xff) / 255;

  if (Math.abs(a - 1) < 1e-4)
    return ce.tuple(ce.number(r), ce.number(g), ce.number(b));

  return ce.tuple(ce.number(r), ce.number(g), ce.number(b), ce.number(a));
}

export const COLORS_LIBRARY: SymbolDefinitions = {
  Color: {
    description: 'Convert a color string to a canonical sRGB tuple',
    complexity: 8000,
    signature: '(string) -> tuple',
    evaluate: (ops, { engine: ce }) => {
      const input = isString(ops[0]) ? ops[0].string : undefined;
      if (!input) return ce.error('incompatible-type');

      const color = parseColor(input);
      // parseColor returns 0 for invalid input and for "transparent"
      // Distinguish: "transparent" is valid (returns [0,0,0,0])
      if (color === 0 && input.trim().toLowerCase() !== 'transparent')
        return ce.error('incompatible-type');

      return colorNumberToTuple(ce, color);
    },
  },
};
```

**Step 4: Run tests to verify they pass**

Run: `npm run test compute-engine/colors`
Expected: PASS

**Step 5: Commit**

```
feat(color): implement Color operator
```

---

### Task 4: Implement `Colormap` operator

**Files:**
- Modify: `src/compute-engine/library/colors.ts`
- Modify: `test/compute-engine/colors.test.ts`

**Step 1: Write failing tests**

Append to `test/compute-engine/colors.test.ts`:

```typescript
describe('Colormap', () => {
  test('full palette returns list of tuples', () => {
    const expr = ce.box(['Colormap', "'graph6'"]);
    const result = expr.evaluate();
    expect(result.operator).toBe('List');
    expect(result.ops!.length).toBe(6);
    // Each entry should be a Tuple with 3 components
    expect(result.ops![0].operator).toBe('Tuple');
    expect(result.ops![0].ops!.length).toBe(3);
  });

  test('resample to n colors', () => {
    const expr = ce.box(['Colormap', "'viridis'", 5]);
    const result = expr.evaluate();
    expect(result.operator).toBe('List');
    expect(result.ops!.length).toBe(5);
  });

  test('sample at t=0 returns first color', () => {
    const expr = ce.box(['Colormap', "'viridis'", 0]);
    const result = expr.evaluate();
    expect(result.operator).toBe('Tuple');
  });

  test('sample at t=1 returns last color', () => {
    const expr = ce.box(['Colormap', "'viridis'", 1]);
    const result = expr.evaluate();
    expect(result.operator).toBe('Tuple');
  });

  test('sample at t=0.5 returns interpolated color', () => {
    const expr = ce.box(['Colormap', "'viridis'", 0.5]);
    const result = expr.evaluate();
    expect(result.operator).toBe('Tuple');
    expect(result.ops!.length).toBe(3);
  });

  test('unknown palette returns error', () => {
    const expr = ce.box(['Colormap', "'nonexistent'"]);
    const result = expr.evaluate();
    expect(result.operator).toBe('Error');
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npm run test compute-engine/colors`
Expected: FAIL — `Colormap` not defined.

**Step 3: Implement `Colormap` operator**

Add imports at top of `colors.ts`:

```typescript
import { asOklch, oklchToRgb } from '../../color';
import { SEQUENTIAL_PALETTES } from '../../color/sequential';
import { CATEGORICAL_PALETTES } from '../../color/categorical';
import { DIVERGING_PALETTES } from '../../color/diverging-palettes';
```

Add helper function:

```typescript
const ALL_PALETTES: Record<string, readonly string[]> = {
  ...SEQUENTIAL_PALETTES,
  ...CATEGORICAL_PALETTES,
  ...DIVERGING_PALETTES,
};

/** Interpolate between two hex colors in OKLCh space at fraction f ∈ [0,1]. */
function interpolateOklch(
  hex1: string,
  hex2: string,
  f: number
): { r: number; g: number; b: number; alpha?: number } {
  const c1 = asOklch(hex1);
  const c2 = asOklch(hex2);

  const L = c1.L + (c2.L - c1.L) * f;
  const C = c1.C + (c2.C - c1.C) * f;

  // Shorter arc hue interpolation
  let dh = c2.H - c1.H;
  if (dh > 180) dh -= 360;
  if (dh < -180) dh += 360;
  let H = c1.H + dh * f;
  if (H < 0) H += 360;
  if (H >= 360) H -= 360;

  return oklchToRgb({ L, C, H });
}

/** Sample a palette at position t ∈ [0,1], returning a 0-1 sRGB Tuple. */
function samplePalette(ce: any, palette: readonly string[], t: number): any {
  t = Math.max(0, Math.min(1, t));

  const n = palette.length;
  if (n === 0) return ce.error('expected-value');
  if (n === 1) return colorNumberToTuple(ce, parseColor(palette[0]));

  const pos = t * (n - 1);
  const i = Math.floor(pos);
  const frac = pos - i;

  if (i >= n - 1)
    return colorNumberToTuple(ce, parseColor(palette[n - 1]));

  if (frac < 1e-9)
    return colorNumberToTuple(ce, parseColor(palette[i]));

  const rgb = interpolateOklch(palette[i], palette[i + 1], frac);
  // oklchToRgb returns 0-255
  const r = rgb.r / 255;
  const g = rgb.g / 255;
  const b = rgb.b / 255;
  return ce.tuple(ce.number(r), ce.number(g), ce.number(b));
}
```

Add operator definition to `COLORS_LIBRARY`:

```typescript
  Colormap: {
    description: 'Sample colors from a named palette',
    complexity: 8000,
    signature: '(string, number?) -> any',
    evaluate: (ops, { engine: ce }) => {
      const name = isString(ops[0]) ? ops[0].string : undefined;
      if (!name) return ce.error('incompatible-type');

      const palette = ALL_PALETTES[name];
      if (!palette) return ce.error('expected-value', ops[0]);

      // Variant 1: no second arg → return full palette
      if (ops.length < 2 || ops[1] === undefined) {
        const tuples = palette.map((hex) =>
          colorNumberToTuple(ce, parseColor(hex))
        );
        return ce.function('List', tuples);
      }

      const val = ops[1].re;
      if (!Number.isFinite(val)) return ce.error('expected-value', ops[1]);

      // Variant 2: integer ≥ 2 → resample to n colors
      if (Number.isInteger(val) && val >= 2) {
        const n = val;
        const tuples: any[] = [];
        for (let i = 0; i < n; i++) {
          tuples.push(samplePalette(ce, palette, i / (n - 1)));
        }
        return ce.function('List', tuples);
      }

      // Variant 3: real in [0,1] → sample at position
      return samplePalette(ce, palette, val);
    },
  },
```

**Step 4: Run tests to verify they pass**

Run: `npm run test compute-engine/colors`
Expected: PASS

**Step 5: Commit**

```
feat(color): implement Colormap operator
```

---

### Task 5: Implement `ColorToColorspace` and `ColorFromColorspace` operators

**Files:**
- Modify: `src/compute-engine/library/colors.ts`
- Modify: `test/compute-engine/colors.test.ts`

**Step 1: Write failing tests**

Append to `test/compute-engine/colors.test.ts`:

```typescript
describe('ColorToColorspace', () => {
  test('to oklch', () => {
    const expr = ce.box(['ColorToColorspace', "'#ff0000'", "'oklch'"]);
    const result = expr.evaluate();
    expect(result.operator).toBe('Tuple');
    expect(result.ops!.length).toBe(3);
    // L should be around 0.6
    expect(result.ops![0].re).toBeGreaterThan(0.5);
    expect(result.ops![0].re).toBeLessThan(0.7);
  });

  test('to oklab (via "lab" alias)', () => {
    const expr = ce.box(['ColorToColorspace', "'#ff0000'", "'lab'"]);
    const result = expr.evaluate();
    expect(result.operator).toBe('Tuple');
    expect(result.ops!.length).toBe(3);
  });

  test('to hsl', () => {
    const expr = ce.box(['ColorToColorspace', "'#ff0000'", "'hsl'"]);
    const result = expr.evaluate();
    expect(result.operator).toBe('Tuple');
    // Pure red: h≈0, s≈1, l≈0.5
    expect(result.ops![0].re).toBeLessThan(1); // hue near 0
    expect(result.ops![1].re).toBeCloseTo(1, 1); // full saturation
    expect(result.ops![2].re).toBeCloseTo(0.5, 1); // mid lightness
  });

  test('to rgb is identity (normalized)', () => {
    const expr = ce.box(['ColorToColorspace', "'#ff0000'", "'rgb'"]);
    const result = expr.evaluate();
    expect(result.operator).toBe('Tuple');
    expect(result.ops![0].re).toBeCloseTo(1, 2);
    expect(result.ops![1].re).toBeCloseTo(0, 2);
    expect(result.ops![2].re).toBeCloseTo(0, 2);
  });

  test('accepts tuple input', () => {
    const expr = ce.box([
      'ColorToColorspace',
      ['Tuple', 1, 0, 0],
      "'oklch'",
    ]);
    const result = expr.evaluate();
    expect(result.operator).toBe('Tuple');
    expect(result.ops!.length).toBe(3);
  });
});

describe('ColorFromColorspace', () => {
  test('from oklch', () => {
    const expr = ce.box([
      'ColorFromColorspace',
      ['Tuple', 0.6, 0.26, 29],
      "'oklch'",
    ]);
    const result = expr.evaluate();
    expect(result.operator).toBe('Tuple');
    expect(result.ops!.length).toBe(3);
    // Should be reddish
    expect(result.ops![0].re).toBeGreaterThan(0.5);
  });

  test('from hsl', () => {
    const expr = ce.box([
      'ColorFromColorspace',
      ['Tuple', 0, 1, 0.5],
      "'hsl'",
    ]);
    const result = expr.evaluate();
    expect(result.operator).toBe('Tuple');
    // Pure red
    expect(result.ops![0].re).toBeCloseTo(1, 1);
    expect(result.ops![1].re).toBeCloseTo(0, 1);
    expect(result.ops![2].re).toBeCloseTo(0, 1);
  });

  test('roundtrip oklch', () => {
    // Color → oklch → back to rgb should roundtrip
    const toOklch = ce
      .box(['ColorToColorspace', "'#3366cc'", "'oklch'"])
      .evaluate();
    const back = ce
      .box(['ColorFromColorspace', toOklch.json, "'oklch'"])
      .evaluate();
    expect(back.operator).toBe('Tuple');

    // Compare with original
    const original = ce.box(['Color', "'#3366cc'"]).evaluate();
    expect(back.ops![0].re).toBeCloseTo(original.ops![0].re, 2);
    expect(back.ops![1].re).toBeCloseTo(original.ops![1].re, 2);
    expect(back.ops![2].re).toBeCloseTo(original.ops![2].re, 2);
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npm run test compute-engine/colors`
Expected: FAIL — operators not defined.

**Step 3: Implement both operators**

Add imports at top of `colors.ts`:

```typescript
import { rgbToOklab, rgbToOklch, oklabToRgb, rgbToHsl } from '../../color';
import type { RgbColor } from '../../color';
```

Add helper to extract an sRGB tuple from the first arg (string or Tuple):

```typescript
/** Extract an RgbColor (0-255) from a Color string or an sRGB Tuple (0-1). */
function extractRgb(ce: any, arg: any): RgbColor | undefined {
  // If it's a string, parse it
  if (isString(arg)) {
    const s = arg.string;
    if (!s) return undefined;
    const color = parseColor(s);
    return {
      r: (color >>> 24) & 0xff,
      g: (color >>> 16) & 0xff,
      b: (color >>> 8) & 0xff,
      alpha: ((color & 0xff) / 255),
    };
  }
  // If it's a Tuple, read 0-1 components and scale to 0-255
  if (arg.operator === 'Tuple' && arg.ops && arg.ops.length >= 3) {
    const rgb: RgbColor = {
      r: arg.ops[0].re * 255,
      g: arg.ops[1].re * 255,
      b: arg.ops[2].re * 255,
    };
    if (arg.ops.length >= 4) rgb.alpha = arg.ops[3].re;
    return rgb;
  }
  return undefined;
}

/** Build a Tuple expression from components, appending alpha if ≠ 1. */
function componentsTuple(
  ce: any,
  components: number[],
  alpha?: number
): any {
  const args = components.map((v) => ce.number(v));
  if (alpha !== undefined && Math.abs(alpha - 1) > 1e-4)
    args.push(ce.number(alpha));
  return ce.tuple(...args);
}
```

Add operator definitions to `COLORS_LIBRARY`:

```typescript
  ColorToColorspace: {
    description: 'Convert a color to components in a target color space',
    complexity: 8000,
    signature: '(any, string) -> tuple',
    evaluate: (ops, { engine: ce }) => {
      const rgb = extractRgb(ce, ops[0]);
      if (!rgb) return ce.error('incompatible-type');

      const space = isString(ops[1]) ? ops[1].string?.toLowerCase() : undefined;
      if (!space) return ce.error('incompatible-type');

      const alpha = rgb.alpha;

      switch (space) {
        case 'rgb':
          return componentsTuple(ce, [rgb.r / 255, rgb.g / 255, rgb.b / 255], alpha);

        case 'hsl': {
          const hsl = rgbToHsl(rgb.r, rgb.g, rgb.b);
          return componentsTuple(ce, [hsl.h, hsl.s, hsl.l], alpha);
        }

        case 'oklch': {
          const oklch = rgbToOklch(rgb);
          return componentsTuple(ce, [oklch.L, oklch.C, oklch.H], alpha);
        }

        case 'oklab':
        case 'lab': {
          const oklab = rgbToOklab(rgb);
          return componentsTuple(ce, [oklab.L, oklab.a, oklab.b], alpha);
        }

        default:
          return ce.error('expected-value', ops[1]);
      }
    },
  },

  ColorFromColorspace: {
    description: 'Convert color space components to a canonical sRGB tuple',
    complexity: 8000,
    signature: '(tuple, string) -> tuple',
    evaluate: (ops, { engine: ce }) => {
      const tuple = ops[0];
      if (tuple.operator !== 'Tuple' || !tuple.ops || tuple.ops.length < 3)
        return ce.error('incompatible-type');

      const c0 = tuple.ops[0].re;
      const c1 = tuple.ops[1].re;
      const c2 = tuple.ops[2].re;
      const alpha = tuple.ops.length >= 4 ? tuple.ops[3].re : undefined;

      const space = isString(ops[1]) ? ops[1].string?.toLowerCase() : undefined;
      if (!space) return ce.error('incompatible-type');

      let rgb: RgbColor;

      switch (space) {
        case 'rgb':
          // Input is already 0-1 sRGB
          return componentsTuple(ce, [c0, c1, c2], alpha);

        case 'hsl': {
          // hslToRgb expects h: 0-360, s: 0-1, l: 0-1, returns 0-255
          const result = hslToRgbFn(c0, c1, c2);
          return componentsTuple(
            ce,
            [result.r / 255, result.g / 255, result.b / 255],
            alpha
          );
        }

        case 'oklch':
          rgb = oklchToRgb({ L: c0, C: c1, H: c2 });
          return componentsTuple(ce, [rgb.r / 255, rgb.g / 255, rgb.b / 255], alpha);

        case 'oklab':
        case 'lab':
          rgb = oklabToRgb({ L: c0, a: c1, b: c2 });
          return componentsTuple(ce, [rgb.r / 255, rgb.g / 255, rgb.b / 255], alpha);

        default:
          return ce.error('expected-value', ops[1]);
      }
    },
  },
```

For `ColorFromColorspace` with `"hsl"`, we need access to `hslToRgb`. It's currently private in `manipulation.ts`. Either:
- Export it from `manipulation.ts` and `index.ts`, or
- Use `parseColor('hsl(h, s%, l%)')` as a workaround.

The cleanest approach: export the existing `hslToRgb` from `manipulation.ts` and `index.ts`. Add to the imports:

```typescript
import { hslToRgb } from '../../color';
```

Rename the local reference in the code above from `hslToRgbFn` to just `hslToRgb` (the import).

**Files to also modify:**
- `src/color/manipulation.ts`: change `function hslToRgb` to `export function hslToRgb`
- `src/color/index.ts`: add `hslToRgb` to the manipulation exports

**Step 4: Run tests to verify they pass**

Run: `npm run test compute-engine/colors`
Expected: PASS

**Step 5: Check for type errors**

Run: `npx tsc --noEmit --pretty 2>&1 | head -20`

**Step 6: Commit**

```
feat(color): implement ColorToColorspace and ColorFromColorspace operators
```

---

### Task 6: Edge case tests and final verification

**Files:**
- Modify: `test/compute-engine/colors.test.ts`

**Step 1: Add edge case tests**

Append to test file:

```typescript
describe('Edge cases', () => {
  test('Color with alpha=1 returns 3-component tuple', () => {
    const expr = ce.box(['Color', "'#ff0000ff'"]);
    const result = expr.evaluate();
    expect(result.ops!.length).toBe(3);
  });

  test('Colormap t outside [0,1] is clamped', () => {
    const lo = ce.box(['Colormap', "'viridis'", -0.5]).evaluate();
    const first = ce.box(['Colormap', "'viridis'", 0]).evaluate();
    expect(lo.ops![0].re).toBeCloseTo(first.ops![0].re, 5);

    const hi = ce.box(['Colormap', "'viridis'", 1.5]).evaluate();
    const last = ce.box(['Colormap', "'viridis'", 1]).evaluate();
    expect(hi.ops![0].re).toBeCloseTo(last.ops![0].re, 5);
  });

  test('ColorToColorspace with alpha preserves it', () => {
    const expr = ce.box([
      'ColorToColorspace',
      ['Tuple', 1, 0, 0, 0.5],
      "'oklch'",
    ]);
    const result = expr.evaluate();
    expect(result.ops!.length).toBe(4);
    expect(result.ops![3].re).toBeCloseTo(0.5, 2);
  });

  test('ColorFromColorspace roundtrip hsl', () => {
    const toHsl = ce
      .box(['ColorToColorspace', "'#3366cc'", "'hsl'"])
      .evaluate();
    const back = ce
      .box(['ColorFromColorspace', toHsl.json, "'hsl'"])
      .evaluate();
    const original = ce.box(['Color', "'#3366cc'"]).evaluate();
    expect(back.ops![0].re).toBeCloseTo(original.ops![0].re, 2);
    expect(back.ops![1].re).toBeCloseTo(original.ops![1].re, 2);
    expect(back.ops![2].re).toBeCloseTo(original.ops![2].re, 2);
  });
});
```

**Step 2: Run full test suite**

Run: `npm run test compute-engine/colors`
Expected: ALL PASS

**Step 3: Run typecheck**

Run: `npx tsc --noEmit --pretty 2>&1 | head -30`

**Step 4: Run circular dependency check**

Run: `npx madge --circular --extensions ts src/compute-engine 2>&1 | tail -5`

**Step 5: Commit**

```
test(color): add edge case tests for color operators
```
