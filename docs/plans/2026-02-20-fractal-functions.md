# Fractal Functions Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add `Mandelbrot(c, maxIter)` and `Julia(z, c, maxIter)` as built-in MathJSON operators that evaluate in JS and compile to GLSL/WGSL shaders.

**Architecture:** New `fractals` library registers the two operators with JS `evaluate` handlers; GPU compilation is handled by adding entries to `GPU_FUNCTIONS` in `gpu-target.ts` and injecting preamble GLSL/WGSL helper functions via the same pattern as `_gpu_gamma`, `_gpu_erf`, etc. Both functions return a smooth-colored normalized escape value in `[0, 1]` (1.0 = inside the set).

**Tech Stack:** TypeScript, existing library/compilation infrastructure; no new dependencies.

---

### Task 1: Write failing evaluate tests

**Files:**
- Create: `test/compute-engine/fractals.test.ts`

**Step 1: Write the test file**

```typescript
import { engine as ce } from '../utils';

describe('FRACTAL FUNCTIONS', () => {
  describe('Mandelbrot JS evaluate', () => {
    it('returns 1 for origin (inside set)', () => {
      const result = ce
        .box(['Mandelbrot', ['Complex', 0, 0], 100])
        .evaluate();
      expect(result.re).toBeCloseTo(1.0, 5);
    });

    it('returns 1 for c=-0.5 (inside set)', () => {
      const result = ce
        .box(['Mandelbrot', ['Complex', -0.5, 0], 100])
        .evaluate();
      expect(result.re).toBeCloseTo(1.0, 5);
    });

    it('returns <1 for c=2 (escapes fast)', () => {
      const result = ce
        .box(['Mandelbrot', ['Complex', 2, 0], 100])
        .evaluate();
      expect(result.re).toBeGreaterThanOrEqual(0);
      expect(result.re).toBeLessThan(1);
    });

    it('returns value in [0,1] for c=0.3+0.5i', () => {
      const result = ce
        .box(['Mandelbrot', ['Complex', 0.3, 0.5], 100])
        .evaluate();
      expect(result.re).toBeGreaterThanOrEqual(0);
      expect(result.re).toBeLessThanOrEqual(1);
    });
  });

  describe('Julia JS evaluate', () => {
    it('returns 1 for z=0, c=-0.5 (inside set)', () => {
      const result = ce
        .box(['Julia', ['Complex', 0, 0], ['Complex', -0.5, 0], 100])
        .evaluate();
      expect(result.re).toBeCloseTo(1.0, 5);
    });

    it('returns <1 for z=0, c=2 (escapes fast)', () => {
      const result = ce
        .box(['Julia', ['Complex', 0, 0], ['Complex', 2, 0], 100])
        .evaluate();
      expect(result.re).toBeGreaterThanOrEqual(0);
      expect(result.re).toBeLessThan(1);
    });

    it('returns value in [0,1] for z=0.3+0.5i, c=-0.4+0.6i', () => {
      const result = ce
        .box(['Julia', ['Complex', 0.3, 0.5], ['Complex', -0.4, 0.6], 100])
        .evaluate();
      expect(result.re).toBeGreaterThanOrEqual(0);
      expect(result.re).toBeLessThanOrEqual(1);
    });
  });
});
```

**Step 2: Run to confirm FAIL**

```bash
npm run test compute-engine/fractals
```

Expected: FAIL — `Unknown function 'Mandelbrot'` or similar.

---

### Task 2: Create the fractals library

**Files:**
- Create: `src/compute-engine/library/fractals.ts`

**Step 1: Write the library file**

```typescript
import type { SymbolDefinitions } from '../global-types';

/** Smooth escape-time value for the Mandelbrot set in [0, 1]. */
function mandelbrotEscape(cx: number, cy: number, maxN: number): number {
  let zx = 0,
    zy = 0;
  for (let i = 0; i < maxN; i++) {
    const newZx = zx * zx - zy * zy + cx;
    zy = 2 * zx * zy + cy;
    zx = newZx;
    const mag2 = zx * zx + zy * zy;
    if (mag2 > 4) {
      const smooth = (i - Math.log2(Math.log2(mag2)) + 4.0) / maxN;
      return Math.max(0, Math.min(1, smooth));
    }
  }
  return 1.0;
}

export const FRACTALS_LIBRARY: SymbolDefinitions[] = [
  {
    Mandelbrot: {
      description:
        'Smooth escape-time value for the Mandelbrot set. Returns 1 for points inside the set, values in [0,1) for escaping points.',
      complexity: 1200,
      signature: '(number, integer) -> real',
      evaluate: ([c, maxIter], { engine: ce }) => {
        const cn = c.numericValue;
        if (cn === null || cn === undefined) return undefined;
        const cx = typeof cn === 'number' ? cn : cn.re;
        const cy = typeof cn === 'number' ? 0 : cn.im;
        const n = maxIter.re;
        if (!isFinite(cx) || !isFinite(cy) || !isFinite(n) || n <= 0)
          return undefined;
        return ce.number(mandelbrotEscape(cx, cy, Math.round(n)));
      },
    },

    Julia: {
      description:
        'Smooth escape-time value for a Julia set with parameter c. Returns 1 for points inside the set, values in [0,1) for escaping points.',
      complexity: 1200,
      signature: '(number, number, integer) -> real',
      evaluate: ([z, c, maxIter], { engine: ce }) => {
        const zn = z.numericValue;
        const cn = c.numericValue;
        if (zn === null || zn === undefined) return undefined;
        if (cn === null || cn === undefined) return undefined;
        let zx = typeof zn === 'number' ? zn : zn.re;
        let zy = typeof zn === 'number' ? 0 : zn.im;
        const cx = typeof cn === 'number' ? cn : cn.re;
        const cy = typeof cn === 'number' ? 0 : cn.im;
        const n = maxIter.re;
        if (
          !isFinite(zx) ||
          !isFinite(zy) ||
          !isFinite(cx) ||
          !isFinite(cy) ||
          !isFinite(n) ||
          n <= 0
        )
          return undefined;
        const maxN = Math.round(n);
        for (let i = 0; i < maxN; i++) {
          const newZx = zx * zx - zy * zy + cx;
          zy = 2 * zx * zy + cy;
          zx = newZx;
          const mag2 = zx * zx + zy * zy;
          if (mag2 > 4) {
            const smooth = (i - Math.log2(Math.log2(mag2)) + 4.0) / maxN;
            return ce.number(Math.max(0, Math.min(1, smooth)));
          }
        }
        return ce.One;
      },
    },
  },
];
```

**Step 2: Run tests (still fails — not registered yet)**

```bash
npm run test compute-engine/fractals
```

Expected: still FAIL.

---

### Task 3: Register the fractals library

**Files:**
- Modify: `src/compute-engine/library/library.ts`

**Step 1: Add import at top of file (after existing imports)**

After the last library import (near line 17), add:

```typescript
import { FRACTALS_LIBRARY } from './fractals';
```

**Step 2: Add library entry to STANDARD_LIBRARIES**

Add after the `colors` entry (around line 85):

```typescript
  {
    name: 'fractals',
    requires: ['arithmetic'],
    definitions: FRACTALS_LIBRARY,
  },
```

**Step 3: Run tests — evaluate tests should now pass**

```bash
npm run test compute-engine/fractals
```

Expected: all 6 tests PASS.

**Step 4: Commit**

```bash
git add src/compute-engine/library/fractals.ts src/compute-engine/library/library.ts test/compute-engine/fractals.test.ts
git commit -m "feat: add Mandelbrot and Julia library operators with JS evaluate"
```

---

### Task 4: Write failing GLSL compilation tests

**Files:**
- Modify: `test/compute-engine/fractals.test.ts`

**Step 1: Add GLSL tests to the file**

Append to the existing `fractals.test.ts`:

```typescript
import { GLSLTarget } from '../../src/compute-engine/compilation/glsl-target';

const glsl = new GLSLTarget();

describe('FRACTAL GLSL COMPILATION', () => {
  it('compiles Mandelbrot call site', () => {
    const expr = ce.box(['Mandelbrot', 'c', 100]);
    const result = glsl.compile(expr);
    expect(result.code).toMatchInlineSnapshot(
      `_fractal_mandelbrot(c, int(100.0))`
    );
  });

  it('injects Mandelbrot preamble', () => {
    const expr = ce.box(['Mandelbrot', 'c', 100]);
    const result = glsl.compile(expr);
    expect(result.preamble).toContain('_fractal_mandelbrot');
    expect(result.preamble).toContain('log2(log2(dot(z, z)))');
  });

  it('compiles Julia call site', () => {
    const expr = ce.box(['Julia', 'z', 'c', 100]);
    const result = glsl.compile(expr);
    expect(result.code).toMatchInlineSnapshot(
      `_fractal_julia(z, c, int(100.0))`
    );
  });

  it('injects Julia preamble', () => {
    const expr = ce.box(['Julia', 'z', 'c', 100]);
    const result = glsl.compile(expr);
    expect(result.preamble).toContain('_fractal_julia');
  });

  it('preamble contains both functions when both are used', () => {
    // Compile an expression using both (e.g. average of both)
    const expr = ce.box([
      'Add',
      ['Mandelbrot', 'c', 50],
      ['Julia', 'z', 'c', 50],
    ]);
    const result = glsl.compile(expr);
    expect(result.preamble).toContain('_fractal_mandelbrot');
    expect(result.preamble).toContain('_fractal_julia');
  });
});
```

**Step 2: Run tests — GLSL tests should fail**

```bash
npm run test compute-engine/fractals
```

Expected: 6 JS tests PASS, 5 GLSL tests FAIL.

---

### Task 5: Add GPU compilation support

**Files:**
- Modify: `src/compute-engine/compilation/gpu-target.ts`

**Step 1: Add fractal preamble constants**

After `GPU_ERF_PREAMBLE` (around line 627), add:

```typescript
/**
 * Fractal preamble (GLSL syntax).
 *
 * Smooth escape-time iteration for Mandelbrot and Julia sets.
 * Both functions return a normalized float in [0, 1] with smooth coloring
 * (log2(log2(|z|²)) formula) to avoid banding.
 */
export const GPU_FRACTAL_PREAMBLE_GLSL = `
float _fractal_mandelbrot(vec2 c, int maxIter) {
  vec2 z = vec2(0.0, 0.0);
  for (int i = 0; i < maxIter; i++) {
    z = vec2(z.x*z.x - z.y*z.y + c.x, 2.0*z.x*z.y + c.y);
    if (dot(z, z) > 4.0)
      return (float(i) - log2(log2(dot(z, z))) + 4.0) / float(maxIter);
  }
  return 1.0;
}

float _fractal_julia(vec2 z, vec2 c, int maxIter) {
  for (int i = 0; i < maxIter; i++) {
    z = vec2(z.x*z.x - z.y*z.y + c.x, 2.0*z.x*z.y + c.y);
    if (dot(z, z) > 4.0)
      return (float(i) - log2(log2(dot(z, z))) + 4.0) / float(maxIter);
  }
  return 1.0;
}
`;

/**
 * Fractal preamble (WGSL syntax).
 */
export const GPU_FRACTAL_PREAMBLE_WGSL = `
fn _fractal_mandelbrot(c: vec2f, maxIter: i32) -> f32 {
  var z = vec2f(0.0, 0.0);
  for (var i: i32 = 0; i < maxIter; i++) {
    z = vec2f(z.x*z.x - z.y*z.y + c.x, 2.0*z.x*z.y + c.y);
    if (dot(z, z) > 4.0) {
      return (f32(i) - log2(log2(dot(z, z))) + 4.0) / f32(maxIter);
    }
  }
  return 1.0;
}

fn _fractal_julia(z_in: vec2f, c: vec2f, maxIter: i32) -> f32 {
  var z = z_in;
  for (var i: i32 = 0; i < maxIter; i++) {
    z = vec2f(z.x*z.x - z.y*z.y + c.x, 2.0*z.x*z.y + c.y);
    if (dot(z, z) > 4.0) {
      return (f32(i) - log2(log2(dot(z, z))) + 4.0) / f32(maxIter);
    }
  }
  return 1.0;
}
`;
```

**Step 2: Add Mandelbrot and Julia to GPU_FUNCTIONS**

In `GPU_FUNCTIONS` (after the `// Color functions` section, around line 462), add:

```typescript
  // Fractal functions
  Mandelbrot: ([c, maxIter], compile, target) => {
    if (c === null || maxIter === null)
      throw new Error('Mandelbrot: missing arguments');
    const intCast = target?.language === 'wgsl' ? 'i32' : 'int';
    return `_fractal_mandelbrot(${compile(c)}, ${intCast}(${compile(maxIter)}))`;
  },
  Julia: ([z, c, maxIter], compile, target) => {
    if (z === null || c === null || maxIter === null)
      throw new Error('Julia: missing arguments');
    const intCast = target?.language === 'wgsl' ? 'i32' : 'int';
    return `_fractal_julia(${compile(z)}, ${compile(c)}, ${intCast}(${compile(maxIter)}))`;
  },
```

**Step 3: Inject fractal preamble in `compile()`**

In the `compile()` method of `GPUShaderTarget` (around line 1176, after the `_gpu_erf` check), add:

```typescript
    if (code.includes('_fractal_')) {
      preamble +=
        this.languageId === 'wgsl'
          ? GPU_FRACTAL_PREAMBLE_WGSL
          : GPU_FRACTAL_PREAMBLE_GLSL;
    }
```

**Step 4: Run tests — all should pass**

```bash
npm run test compute-engine/fractals
```

Expected: all 11 tests PASS.

**Step 5: Commit**

```bash
git add src/compute-engine/compilation/gpu-target.ts test/compute-engine/fractals.test.ts
git commit -m "feat: add Mandelbrot and Julia GLSL/WGSL compilation with preamble injection"
```

---

### Task 6: Add WGSL tests

**Files:**
- Modify: `test/compute-engine/fractals.test.ts`

**Step 1: Import WGSLTarget and add tests**

Append to `fractals.test.ts`:

```typescript
import { WGSLTarget } from '../../src/compute-engine/compilation/wgsl-target';

const wgsl = new WGSLTarget();

describe('FRACTAL WGSL COMPILATION', () => {
  it('compiles Mandelbrot call site', () => {
    const expr = ce.box(['Mandelbrot', 'c', 100]);
    const result = wgsl.compile(expr);
    expect(result.code).toMatchInlineSnapshot(
      `_fractal_mandelbrot(c, i32(100.0))`
    );
  });

  it('injects Mandelbrot preamble with WGSL syntax', () => {
    const expr = ce.box(['Mandelbrot', 'c', 100]);
    const result = wgsl.compile(expr);
    expect(result.preamble).toContain('fn _fractal_mandelbrot');
    expect(result.preamble).toContain('vec2f');
  });

  it('compiles Julia call site', () => {
    const expr = ce.box(['Julia', 'z', 'c', 100]);
    const result = wgsl.compile(expr);
    expect(result.code).toMatchInlineSnapshot(
      `_fractal_julia(z, c, i32(100.0))`
    );
  });
});
```

**Step 2: Run all fractal tests**

```bash
npm run test compute-engine/fractals
```

Expected: all 14 tests PASS.

**Step 3: Commit**

```bash
git add test/compute-engine/fractals.test.ts
git commit -m "test: add WGSL compilation tests for fractal functions"
```

---

### Task 7: Typecheck and verify

**Step 1: Run typecheck**

```bash
npm run typecheck
```

Expected: no new errors (there are 11 pre-existing errors — ignore those).

**Step 2: Run all compile tests to catch regressions**

```bash
npm run test compute-engine/compile-glsl
npm run test compute-engine/compile-wgsl
```

Expected: all tests PASS.

**Step 3: Final commit if any fixes needed**

```bash
git add -p
git commit -m "fix: address typecheck issues in fractal compilation"
```
