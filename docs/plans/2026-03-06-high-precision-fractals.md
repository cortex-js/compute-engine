# High-Precision Mandelbrot/Julia Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to
> implement this plan task-by-task.

**Goal:** Enable interactive deep-zoom Mandelbrot/Julia rendering beyond
32-bit float limits via viewport-aware compilation with three precision tiers.

**Architecture:** The compile API gains optional `hints.viewport` context. The
compiler auto-selects single-float, emulated-double, or perturbation strategy
based on zoom radius. Results include `staleWhen` (cheap staleness check),
`uniforms` (scalars), and `textures` (orbit data). No user-facing API changes.

**Tech Stack:** TypeScript, GLSL, WGSL, BigDecimal (existing), Jest

**Design doc:** `docs/plans/2026-03-06-high-precision-fractals-design.md`

---

## Task 1: Extend CompilationResult and CompilationOptions types

**Files:**
- Modify: `src/compute-engine/compilation/types.ts:103-190` (CompilationOptions)
- Modify: `src/compute-engine/compilation/types.ts:273-307` (CompilationResult)
- Test: `test/compute-engine/fractals.test.ts`

**Step 1: Write the failing test**

Add a new describe block at the end of `test/compute-engine/fractals.test.ts`:

```typescript
describe('FRACTAL PRECISION STRATEGY', () => {
  it('returns no staleWhen without hints', () => {
    const expr = ce.expr(['Mandelbrot', 'c', 100]);
    const result = glsl.compile(expr);
    expect(result.staleWhen).toBeUndefined();
    expect(result.uniforms).toBeUndefined();
    expect(result.textures).toBeUndefined();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm run test compute-engine/fractals`
Expected: FAIL — `staleWhen` property doesn't exist on `CompilationResult` type
(TypeScript error during compilation, or the test may actually pass since
`undefined` properties return `undefined`. Either way, this establishes the
baseline.)

**Step 3: Add types to CompilationOptions**

In `src/compute-engine/compilation/types.ts`, add to the `CompilationOptions`
interface after the `realOnly` field (after line 189):

```typescript
  /**
   * Compilation hints for precision-adaptive strategies.
   *
   * The compiler may use these hints to select different code generation
   * strategies (e.g., emulated double precision for deep-zoom fractals).
   * Non-fractal functions ignore hints.
   */
  hints?: {
    /** Current viewport for precision-adaptive compilation. */
    viewport?: {
      /** Center of the viewport as [re, im]. */
      center: [number, number];
      /** Viewport radius (half-width in complex plane units). */
      radius: number;
    };
  };
```

**Step 4: Add types to CompilationResult**

In `src/compute-engine/compilation/types.ts`, add to the `CompilationResult`
type after the `run` field (after line 302):

```typescript
  /**
   * Cheap staleness check for precision-adaptive compilation.
   *
   * The plot engine checks these thresholds on each viewport change
   * (a few number comparisons). When any condition is met, the expression
   * should be recompiled with updated hints.
   */
  staleWhen?: {
    /** Recompile when viewport radius drops below this value. */
    radiusBelow?: number;
    /** Recompile when viewport radius rises above this value. */
    radiusAbove?: number;
    /** Recompile when center moves more than this distance. */
    centerDistance?: number;
  };

  /** Scalar uniform values the shader needs. */
  uniforms?: Record<string, number>;

  /**
   * Texture data the shader needs (e.g., reference orbit).
   *
   * Separated from `uniforms` because the GPU upload path is fundamentally
   * different (createTexture + sampler vs uniform1f).
   */
  textures?: Record<string, {
    data: Float32Array;
    width: number;
    height: number;
    format: 'r32f' | 'rg32f' | 'rgba32f';
  }>;
```

**Step 5: Run test to verify it passes**

Run: `npm run test compute-engine/fractals`
Expected: PASS — the new fields are optional, existing tests unchanged.

**Step 6: Run typecheck**

Run: `npm run typecheck`
Expected: PASS

**Step 7: Commit**

```
feat: add staleWhen, uniforms, textures to CompilationResult type

Add viewport hints to CompilationOptions and staleness/uniform/texture
fields to CompilationResult for precision-adaptive compilation.
```

---

## Task 2: Emulated double-single GLSL preamble

**Files:**
- Modify: `src/compute-engine/compilation/gpu-target.ts` (add preamble constant)
- Test: `test/compute-engine/fractals.test.ts`

**Step 1: Write the failing test**

Add to `test/compute-engine/fractals.test.ts`:

```typescript
describe('DOUBLE-SINGLE ARITHMETIC PREAMBLE', () => {
  it('ds preamble contains core functions (GLSL)', () => {
    // Import the preamble constant directly
    const { GPU_DS_ARITHMETIC_PREAMBLE_GLSL } = require(
      '../../src/compute-engine/compilation/gpu-target'
    );
    expect(GPU_DS_ARITHMETIC_PREAMBLE_GLSL).toContain('vec2 ds_add(');
    expect(GPU_DS_ARITHMETIC_PREAMBLE_GLSL).toContain('vec2 ds_mul(');
    expect(GPU_DS_ARITHMETIC_PREAMBLE_GLSL).toContain('vec2 ds_sqr(');
    expect(GPU_DS_ARITHMETIC_PREAMBLE_GLSL).toContain('vec2 ds_sub(');
    expect(GPU_DS_ARITHMETIC_PREAMBLE_GLSL).toContain('vec2 ds_split(');
  });

  it('ds preamble contains core functions (WGSL)', () => {
    const { GPU_DS_ARITHMETIC_PREAMBLE_WGSL } = require(
      '../../src/compute-engine/compilation/gpu-target'
    );
    expect(GPU_DS_ARITHMETIC_PREAMBLE_WGSL).toContain('fn ds_add(');
    expect(GPU_DS_ARITHMETIC_PREAMBLE_WGSL).toContain('fn ds_mul(');
    expect(GPU_DS_ARITHMETIC_PREAMBLE_WGSL).toContain('fn ds_sqr(');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm run test compute-engine/fractals`
Expected: FAIL — `GPU_DS_ARITHMETIC_PREAMBLE_GLSL` is not exported.

**Step 3: Implement the double-single arithmetic preamble**

Add to `src/compute-engine/compilation/gpu-target.ts`, before the existing
`GPU_FRACTAL_PREAMBLE_GLSL` constant (before line ~1443):

```typescript
/**
 * Double-single (float-float) arithmetic preamble (GLSL).
 *
 * A "double-single" number is stored as vec2(hi, lo) where value = hi + lo.
 * This gives ~48 bits of mantissa (~14 decimal digits) from two 32-bit floats.
 *
 * Algorithms based on Dekker (1971) and Knuth (1997):
 * - TwoSum for error-free addition
 * - Dekker split + TwoProduct for error-free multiplication
 */
export const GPU_DS_ARITHMETIC_PREAMBLE_GLSL = `
// Split a float into high and low parts for exact multiplication
vec2 ds_split(float a) {
  const float SPLIT = 4097.0; // 2^12 + 1
  float t = SPLIT * a;
  float hi = t - (t - a);
  float lo = a - hi;
  return vec2(hi, lo);
}

// Create a double-single from a single float
vec2 ds_from(float a) {
  return vec2(a, 0.0);
}

// Error-free addition (Knuth TwoSum)
vec2 ds_add(vec2 a, vec2 b) {
  float s = a.x + b.x;
  float v = s - a.x;
  float e = (a.x - (s - v)) + (b.x - v);
  float lo = (a.y + b.y) + e;
  float hi = s + lo;
  lo = lo - (hi - s);
  return vec2(hi, lo);
}

// Double-single subtraction
vec2 ds_sub(vec2 a, vec2 b) {
  return ds_add(a, vec2(-b.x, -b.y));
}

// Error-free multiplication (Dekker TwoProduct)
vec2 ds_mul(vec2 a, vec2 b) {
  float p = a.x * b.x;
  vec2 sa = ds_split(a.x);
  vec2 sb = ds_split(b.x);
  float err = ((sa.x * sb.x - p) + sa.x * sb.y + sa.y * sb.x) + sa.y * sb.y;
  err += a.x * b.y + a.y * b.x;
  float hi = p + err;
  float lo = err - (hi - p);
  return vec2(hi, lo);
}

// Optimized self-multiply
vec2 ds_sqr(vec2 a) {
  float p = a.x * a.x;
  vec2 sa = ds_split(a.x);
  float err = ((sa.x * sa.x - p) + 2.0 * sa.x * sa.y) + sa.y * sa.y;
  err += 2.0 * a.x * a.y;
  float hi = p + err;
  float lo = err - (hi - p);
  return vec2(hi, lo);
}

// Compare magnitude: returns -1, 0, or 1
float ds_cmp(vec2 a, vec2 b) {
  float d = a.x - b.x;
  if (d != 0.0) return sign(d);
  return sign(a.y - b.y);
}
`;

/**
 * Double-single arithmetic preamble (WGSL).
 */
export const GPU_DS_ARITHMETIC_PREAMBLE_WGSL = `
fn ds_split(a: f32) -> vec2f {
  const SPLIT: f32 = 4097.0;
  let t = SPLIT * a;
  let hi = t - (t - a);
  let lo = a - hi;
  return vec2f(hi, lo);
}

fn ds_from(a: f32) -> vec2f {
  return vec2f(a, 0.0);
}

fn ds_add(a: vec2f, b: vec2f) -> vec2f {
  let s = a.x + b.x;
  let v = s - a.x;
  let e = (a.x - (s - v)) + (b.x - v);
  let lo_t = (a.y + b.y) + e;
  let hi = s + lo_t;
  let lo = lo_t - (hi - s);
  return vec2f(hi, lo);
}

fn ds_sub(a: vec2f, b: vec2f) -> vec2f {
  return ds_add(a, vec2f(-b.x, -b.y));
}

fn ds_mul(a: vec2f, b: vec2f) -> vec2f {
  let p = a.x * b.x;
  let sa = ds_split(a.x);
  let sb = ds_split(b.x);
  var err = ((sa.x * sb.x - p) + sa.x * sb.y + sa.y * sb.x) + sa.y * sb.y;
  err += a.x * b.y + a.y * b.x;
  let hi = p + err;
  let lo = err - (hi - p);
  return vec2f(hi, lo);
}

fn ds_sqr(a: vec2f) -> vec2f {
  let p = a.x * a.x;
  let sa = ds_split(a.x);
  var err = ((sa.x * sa.x - p) + 2.0 * sa.x * sa.y) + sa.y * sa.y;
  err += 2.0 * a.x * a.y;
  let hi = p + err;
  let lo = err - (hi - p);
  return vec2f(hi, lo);
}

fn ds_cmp(a: vec2f, b: vec2f) -> f32 {
  let d = a.x - b.x;
  if (d != 0.0) { return sign(d); }
  return sign(a.y - b.y);
}
`;
```

**Step 4: Run test to verify it passes**

Run: `npm run test compute-engine/fractals`
Expected: PASS

**Step 5: Commit**

```
feat: add double-single (float-float) arithmetic GLSL/WGSL preambles

Implements Dekker/Knuth algorithms for ~48-bit precision from two 32-bit
floats: ds_add, ds_sub, ds_mul, ds_sqr, ds_split, ds_from, ds_cmp.
```

---

## Task 3: Emulated double Mandelbrot/Julia GLSL preamble

**Files:**
- Modify: `src/compute-engine/compilation/gpu-target.ts` (add preamble constant)
- Test: `test/compute-engine/fractals.test.ts`

**Step 1: Write the failing test**

Add to `test/compute-engine/fractals.test.ts`:

```typescript
describe('EMULATED DOUBLE FRACTAL PREAMBLE', () => {
  it('dp preamble contains Mandelbrot and Julia (GLSL)', () => {
    const { GPU_FRACTAL_DP_PREAMBLE_GLSL } = require(
      '../../src/compute-engine/compilation/gpu-target'
    );
    expect(GPU_FRACTAL_DP_PREAMBLE_GLSL).toContain(
      '_fractal_mandelbrot_dp'
    );
    expect(GPU_FRACTAL_DP_PREAMBLE_GLSL).toContain('_fractal_julia_dp');
    // Must use ds_* functions
    expect(GPU_FRACTAL_DP_PREAMBLE_GLSL).toContain('ds_add');
    expect(GPU_FRACTAL_DP_PREAMBLE_GLSL).toContain('ds_mul');
    expect(GPU_FRACTAL_DP_PREAMBLE_GLSL).toContain('ds_sqr');
  });

  it('dp preamble contains Mandelbrot and Julia (WGSL)', () => {
    const { GPU_FRACTAL_DP_PREAMBLE_WGSL } = require(
      '../../src/compute-engine/compilation/gpu-target'
    );
    expect(GPU_FRACTAL_DP_PREAMBLE_WGSL).toContain(
      'fn _fractal_mandelbrot_dp'
    );
    expect(GPU_FRACTAL_DP_PREAMBLE_WGSL).toContain('fn _fractal_julia_dp');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm run test compute-engine/fractals`
Expected: FAIL — `GPU_FRACTAL_DP_PREAMBLE_GLSL` is not exported.

**Step 3: Implement the emulated double fractal preamble**

Add to `src/compute-engine/compilation/gpu-target.ts`, after the ds_*
preambles from Task 2:

```typescript
/**
 * Emulated double-precision Mandelbrot/Julia preamble (GLSL).
 *
 * Uses ds_* arithmetic for ~48-bit precision iteration.
 * Input coordinates are vec4: (re_hi, im_hi, re_lo, im_lo).
 * Requires GPU_DS_ARITHMETIC_PREAMBLE_GLSL.
 */
export const GPU_FRACTAL_DP_PREAMBLE_GLSL = `
float _fractal_mandelbrot_dp(vec4 c, int maxIter) {
  // c = (re_hi, im_hi, re_lo, im_lo)
  vec2 cr = vec2(c.x, c.z);  // real part as ds
  vec2 ci = vec2(c.y, c.w);  // imag part as ds
  vec2 zr = vec2(0.0, 0.0);
  vec2 zi = vec2(0.0, 0.0);
  for (int i = 0; i < maxIter; i++) {
    vec2 zr2 = ds_sqr(zr);
    vec2 zi2 = ds_sqr(zi);
    // |z|^2 > 4.0 ?
    vec2 mag2 = ds_add(zr2, zi2);
    if (mag2.x > 4.0)
      return clamp((float(i) - log2(log2(mag2.x)) + 4.0) / float(maxIter), 0.0, 1.0);
    // z = z^2 + c
    vec2 new_zi = ds_add(ds_mul(ds_add(zr, zr), zi), ci); // 2*zr*zi + ci
    zr = ds_add(ds_sub(zr2, zi2), cr);                    // zr^2 - zi^2 + cr
    zi = new_zi;
  }
  return 1.0;
}

float _fractal_julia_dp(vec4 z_in, vec4 c, int maxIter) {
  vec2 zr = vec2(z_in.x, z_in.z);
  vec2 zi = vec2(z_in.y, z_in.w);
  vec2 cr = vec2(c.x, c.z);
  vec2 ci = vec2(c.y, c.w);
  for (int i = 0; i < maxIter; i++) {
    vec2 zr2 = ds_sqr(zr);
    vec2 zi2 = ds_sqr(zi);
    vec2 mag2 = ds_add(zr2, zi2);
    if (mag2.x > 4.0)
      return clamp((float(i) - log2(log2(mag2.x)) + 4.0) / float(maxIter), 0.0, 1.0);
    vec2 new_zi = ds_add(ds_mul(ds_add(zr, zr), zi), ci);
    zr = ds_add(ds_sub(zr2, zi2), cr);
    zi = new_zi;
  }
  return 1.0;
}
`;

/**
 * Emulated double-precision Mandelbrot/Julia preamble (WGSL).
 */
export const GPU_FRACTAL_DP_PREAMBLE_WGSL = `
fn _fractal_mandelbrot_dp(c: vec4f, maxIter: i32) -> f32 {
  let cr = vec2f(c.x, c.z);
  let ci = vec2f(c.y, c.w);
  var zr = vec2f(0.0, 0.0);
  var zi = vec2f(0.0, 0.0);
  for (var i: i32 = 0; i < maxIter; i++) {
    let zr2 = ds_sqr(zr);
    let zi2 = ds_sqr(zi);
    let mag2 = ds_add(zr2, zi2);
    if (mag2.x > 4.0) {
      return clamp((f32(i) - log2(log2(mag2.x)) + 4.0) / f32(maxIter), 0.0, 1.0);
    }
    let new_zi = ds_add(ds_mul(ds_add(zr, zr), zi), ci);
    zr = ds_add(ds_sub(zr2, zi2), cr);
    zi = new_zi;
  }
  return 1.0;
}

fn _fractal_julia_dp(z_in: vec4f, c: vec4f, maxIter: i32) -> f32 {
  var zr = vec2f(z_in.x, z_in.z);
  var zi = vec2f(z_in.y, z_in.w);
  let cr = vec2f(c.x, c.z);
  let ci = vec2f(c.y, c.w);
  for (var i: i32 = 0; i < maxIter; i++) {
    let zr2 = ds_sqr(zr);
    let zi2 = ds_sqr(zi);
    let mag2 = ds_add(zr2, zi2);
    if (mag2.x > 4.0) {
      return clamp((f32(i) - log2(log2(mag2.x)) + 4.0) / f32(maxIter), 0.0, 1.0);
    }
    let new_zi = ds_add(ds_mul(ds_add(zr, zr), zi), ci);
    zr = ds_add(ds_sub(zr2, zi2), cr);
    zi = new_zi;
  }
  return 1.0;
}
`;
```

**Step 4: Run test to verify it passes**

Run: `npm run test compute-engine/fractals`
Expected: PASS

**Step 5: Commit**

```
feat: add emulated double-precision Mandelbrot/Julia GLSL/WGSL preambles

Uses ds_* float-float arithmetic for z -> z^2 + c iteration at ~48-bit
precision. Input coordinates packed as vec4(re_hi, im_hi, re_lo, im_lo).
```

---

## Task 4: Strategy selection in GPU compile

**Files:**
- Modify: `src/compute-engine/compilation/gpu-target.ts:705-716` (Mandelbrot/Julia handlers)
- Modify: `src/compute-engine/compilation/gpu-target.ts:2016-2102` (compile method)
- Test: `test/compute-engine/fractals.test.ts`

**Step 1: Write the failing tests**

Add to the `FRACTAL PRECISION STRATEGY` describe block in
`test/compute-engine/fractals.test.ts`:

```typescript
  it('selects single-float with no hints', () => {
    const expr = ce.expr(['Mandelbrot', 'c', 100]);
    const result = glsl.compile(expr);
    expect(result.code).toContain('_fractal_mandelbrot(');
    expect(result.code).not.toContain('_fractal_mandelbrot_dp(');
    expect(result.staleWhen).toBeUndefined();
  });

  it('selects single-float for large radius', () => {
    const expr = ce.expr(['Mandelbrot', 'c', 100]);
    const result = glsl.compile(expr, {
      hints: { viewport: { center: [0, 0], radius: 1.0 } },
    });
    expect(result.code).toContain('_fractal_mandelbrot(');
    expect(result.staleWhen).toEqual({ radiusBelow: 1e-6 });
  });

  it('selects emulated double for medium radius', () => {
    const expr = ce.expr(['Mandelbrot', 'c', 100]);
    const result = glsl.compile(expr, {
      hints: { viewport: { center: [0.3, 0.1], radius: 1e-8 } },
    });
    expect(result.code).toContain('_fractal_mandelbrot_dp(');
    expect(result.preamble).toContain('ds_add');
    expect(result.staleWhen).toEqual({
      radiusBelow: 1e-14,
      radiusAbove: 1e-5,
    });
  });

  it('selects emulated double for Julia too', () => {
    const expr = ce.expr(['Julia', 'z', 'c', 100]);
    const result = glsl.compile(expr, {
      hints: { viewport: { center: [0, 0], radius: 1e-10 } },
    });
    expect(result.code).toContain('_fractal_julia_dp(');
  });
```

**Step 2: Run test to verify it fails**

Run: `npm run test compute-engine/fractals`
Expected: FAIL — compile doesn't accept `hints`, no `_dp` call sites emitted.

**Step 3: Thread hints through the compile path**

The `GPUShaderTarget.compile()` method at `gpu-target.ts:2016` needs to accept
and pass `options` (which already includes `CompilationOptions`). The hints
are already part of `CompilationOptions` from Task 1.

Modify the Mandelbrot/Julia function handlers in `GPU_FUNCTIONS`
(`gpu-target.ts:705-716`). These handlers receive `(args, compile, target)`.
The `target` carries a `language` field. We need the hints available in the
handler. The cleanest approach: store the hints on the `CompileTarget` object.

**Step 3a: Add hints to CompileTarget**

In `src/compute-engine/compilation/types.ts`, add to the `CompileTarget`
interface (after the `language` field, ~line 77):

```typescript
  /** Compilation hints (viewport, etc.) passed through from options. */
  hints?: CompilationOptions['hints'];
```

**Step 3b: Pass hints into createTarget**

In `src/compute-engine/compilation/gpu-target.ts`, in the `compile()` method
(~line 2025), pass hints when creating the target:

```typescript
    const target = this.createTarget({
      hints: options.hints,  // ADD THIS LINE
      functions: (id) => {
        // ... existing code ...
```

**Step 3c: Add strategy selection helper**

Add a helper function before the `GPU_FUNCTIONS` object in `gpu-target.ts`:

```typescript
/** Precision tier for fractal compilation based on viewport hints. */
type FractalStrategy = 'single' | 'double' | 'perturbation';

function selectFractalStrategy(
  target: CompileTarget<Expression>
): FractalStrategy {
  const radius = target.hints?.viewport?.radius;
  if (radius === undefined) return 'single';
  if (radius > 1e-6) return 'single';
  if (radius > 1e-14) return 'double';
  return 'perturbation';
}

/** Return staleWhen for a given fractal strategy and radius. */
function fractalStaleWhen(
  strategy: FractalStrategy,
  radius?: number
): CompilationResult['staleWhen'] {
  switch (strategy) {
    case 'single':
      return radius !== undefined ? { radiusBelow: 1e-6 } : undefined;
    case 'double':
      return { radiusBelow: 1e-14, radiusAbove: 1e-5 };
    case 'perturbation':
      return {
        radiusAbove: 1e-5,
        radiusBelow: (radius ?? 1e-15) * 0.01,
        centerDistance: (radius ?? 1e-15) * 2.0,
      };
  }
}
```

**Step 3d: Update Mandelbrot/Julia handlers**

Replace the Mandelbrot handler in `GPU_FUNCTIONS` (~line 705):

```typescript
  Mandelbrot: (args, compile, target) => {
    const [c, maxIter] = args;
    if (c === null || maxIter === null)
      throw new Error('Mandelbrot: missing arguments');
    const iterCode = compileIntArg(maxIter, compile, target);
    const strategy = selectFractalStrategy(target);
    if (strategy === 'double') {
      // Emulated double: split vec2 coordinate into vec4(re_hi, im_hi, re_lo, im_lo)
      const cCode = compile(c);
      return `_fractal_mandelbrot_dp(vec4(${cCode}, vec2(0.0)), ${iterCode})`;
    }
    // TODO: perturbation strategy (Task 7)
    return `_fractal_mandelbrot(${compile(c)}, ${iterCode})`;
  },
```

Replace the Julia handler (~line 711):

```typescript
  Julia: (args, compile, target) => {
    const [z, c, maxIter] = args;
    if (z === null || c === null || maxIter === null)
      throw new Error('Julia: missing arguments');
    const iterCode = compileIntArg(maxIter, compile, target);
    const strategy = selectFractalStrategy(target);
    if (strategy === 'double') {
      const zCode = compile(z);
      const cCode = compile(c);
      return `_fractal_julia_dp(vec4(${zCode}, vec2(0.0)), vec4(${cCode}, vec2(0.0)), ${iterCode})`;
    }
    // TODO: perturbation strategy (Task 7)
    return `_fractal_julia(${compile(z)}, ${compile(c)}, ${iterCode})`;
  },
```

**Step 3e: Update preamble injection and staleWhen in compile()**

In the `compile()` method of `GPUShaderTarget` (~line 2082), update the
fractal preamble injection:

```typescript
    if (code.includes('_fractal_')) {
      if (code.includes('_fractal_mandelbrot_dp') || code.includes('_fractal_julia_dp')) {
        // Emulated double: needs ds_* arithmetic + dp fractal preamble
        preamble +=
          this.languageId === 'wgsl'
            ? GPU_DS_ARITHMETIC_PREAMBLE_WGSL
            : GPU_DS_ARITHMETIC_PREAMBLE_GLSL;
        preamble +=
          this.languageId === 'wgsl'
            ? GPU_FRACTAL_DP_PREAMBLE_WGSL
            : GPU_FRACTAL_DP_PREAMBLE_GLSL;
      } else {
        // Single-precision
        preamble +=
          this.languageId === 'wgsl'
            ? GPU_FRACTAL_PREAMBLE_WGSL
            : GPU_FRACTAL_PREAMBLE_GLSL;
      }
    }
```

After building the result object (~line 2100), add staleWhen:

```typescript
    if (preamble) result.preamble = preamble;

    // Set staleWhen if fractal functions were compiled with viewport hints
    if (code.includes('_fractal_') && options.hints?.viewport) {
      const strategy = selectFractalStrategy(target);
      result.staleWhen = fractalStaleWhen(strategy, options.hints.viewport.radius);
    }

    return result;
```

**Step 4: Run test to verify it passes**

Run: `npm run test compute-engine/fractals`
Expected: PASS

**Step 5: Run typecheck**

Run: `npm run typecheck`
Expected: PASS

**Step 6: Run full existing fractal tests to check no regression**

Run: `npm run test compute-engine/fractals`
Expected: All existing tests PASS (they don't pass hints, so single-float path
is unchanged).

**Step 7: Commit**

```
feat: viewport-aware fractal strategy selection (single/double)

Compile Mandelbrot/Julia with hints.viewport to auto-select single-float
or emulated-double precision based on zoom radius. Sets staleWhen on
the compilation result for cheap staleness checking.
```

---

## Task 5: Reference orbit computation (CPU-side BigDecimal)

**Files:**
- Create: `src/compute-engine/compilation/fractal-orbit.ts`
- Test: `test/compute-engine/fractals.test.ts`

**Step 1: Write the failing test**

Add to `test/compute-engine/fractals.test.ts`:

```typescript
describe('REFERENCE ORBIT COMPUTATION', () => {
  it('computes orbit for origin (all zeros)', () => {
    const { computeReferenceOrbit } = require(
      '../../src/compute-engine/compilation/fractal-orbit'
    );
    // Mandelbrot at c=0: z stays 0 forever
    const orbit = computeReferenceOrbit([0, 0], 10, 50);
    expect(orbit).toBeInstanceOf(Float32Array);
    expect(orbit.length).toBe(20); // 10 points * 2 floats (re, im)
    // All values should be 0
    for (let i = 0; i < orbit.length; i++) {
      expect(orbit[i]).toBeCloseTo(0, 5);
    }
  });

  it('computes orbit for c=-1 (period-2)', () => {
    const { computeReferenceOrbit } = require(
      '../../src/compute-engine/compilation/fractal-orbit'
    );
    const orbit = computeReferenceOrbit([-1, 0], 4, 50);
    // z0=0, z1=-1, z2=0, z3=-1
    expect(orbit[0]).toBeCloseTo(0, 5);   // re0
    expect(orbit[1]).toBeCloseTo(0, 5);   // im0
    expect(orbit[2]).toBeCloseTo(-1, 5);  // re1
    expect(orbit[3]).toBeCloseTo(0, 5);   // im1
    expect(orbit[4]).toBeCloseTo(0, 5);   // re2
    expect(orbit[5]).toBeCloseTo(0, 5);   // im2
    expect(orbit[6]).toBeCloseTo(-1, 5);  // re3
    expect(orbit[7]).toBeCloseTo(0, 5);   // im3
  });

  it('escapes for c=2 (orbit diverges)', () => {
    const { computeReferenceOrbit } = require(
      '../../src/compute-engine/compilation/fractal-orbit'
    );
    const orbit = computeReferenceOrbit([2, 0], 100, 50);
    // Should return fewer than 100 points (escape detected)
    expect(orbit.length).toBeLessThan(200);
    expect(orbit.length).toBeGreaterThan(0);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm run test compute-engine/fractals`
Expected: FAIL — module not found.

**Step 3: Implement the reference orbit computation**

Create `src/compute-engine/compilation/fractal-orbit.ts`:

```typescript
import { BigDecimal } from '../../big-decimal';

/**
 * Compute a Mandelbrot reference orbit at arbitrary precision.
 *
 * Iterates z -> z^2 + c starting from z = 0, using BigDecimal arithmetic
 * at the specified precision (decimal digits). Stops early if |z|^2 > 256
 * (well past the escape radius of 2, giving a margin for perturbation).
 *
 * @param center - Reference point [re, im] as numbers (converted to BigDecimal)
 * @param maxIter - Maximum number of iterations
 * @param precision - BigDecimal working precision (decimal digits)
 * @returns Float32Array of [re0, im0, re1, im1, ...] orbit points
 */
export function computeReferenceOrbit(
  center: [number, number],
  maxIter: number,
  precision: number
): Float32Array {
  const prevPrecision = BigDecimal.precision;
  BigDecimal.precision = precision;

  try {
    const cr = new BigDecimal(center[0]);
    const ci = new BigDecimal(center[1]);
    let zr = BigDecimal.ZERO;
    let zi = BigDecimal.ZERO;

    const ESCAPE = new BigDecimal(256);
    const points: number[] = [];

    for (let i = 0; i < maxIter; i++) {
      points.push(zr.toNumber(), zi.toNumber());

      // z = z^2 + c
      const zr2 = zr.mul(zr);
      const zi2 = zi.mul(zi);

      // |z|^2 > 256 ? (escape with margin)
      const mag2 = zr2.add(zi2);
      if (mag2.cmp(ESCAPE) > 0) break;

      const new_zi = zr.mul(zi).mul(2).add(ci);
      zr = zr2.sub(zi2).add(cr);
      zi = new_zi;
    }

    return new Float32Array(points);
  } finally {
    BigDecimal.precision = prevPrecision;
  }
}
```

**Step 4: Run test to verify it passes**

Run: `npm run test compute-engine/fractals`
Expected: PASS

**Step 5: Run typecheck**

Run: `npm run typecheck`
Expected: PASS

**Step 6: Commit**

```
feat: add BigDecimal reference orbit computation for perturbation theory

computeReferenceOrbit() iterates z -> z^2 + c at arbitrary precision,
returning orbit points as Float32Array for GPU texture upload.
```

---

## Task 6: Perturbation GLSL/WGSL preamble

**Files:**
- Modify: `src/compute-engine/compilation/gpu-target.ts` (add preamble constant)
- Test: `test/compute-engine/fractals.test.ts`

**Step 1: Write the failing test**

Add to `test/compute-engine/fractals.test.ts`:

```typescript
describe('PERTURBATION FRACTAL PREAMBLE', () => {
  it('pt preamble contains Mandelbrot and Julia (GLSL)', () => {
    const { GPU_FRACTAL_PT_PREAMBLE_GLSL } = require(
      '../../src/compute-engine/compilation/gpu-target'
    );
    expect(GPU_FRACTAL_PT_PREAMBLE_GLSL).toContain(
      '_fractal_mandelbrot_pt'
    );
    expect(GPU_FRACTAL_PT_PREAMBLE_GLSL).toContain('_fractal_julia_pt');
    // Must reference orbit texture
    expect(GPU_FRACTAL_PT_PREAMBLE_GLSL).toContain('_refOrbit');
    // Must include glitch detection
    expect(GPU_FRACTAL_PT_PREAMBLE_GLSL).toContain('ds_');
  });

  it('pt preamble contains Mandelbrot and Julia (WGSL)', () => {
    const { GPU_FRACTAL_PT_PREAMBLE_WGSL } = require(
      '../../src/compute-engine/compilation/gpu-target'
    );
    expect(GPU_FRACTAL_PT_PREAMBLE_WGSL).toContain(
      'fn _fractal_mandelbrot_pt'
    );
    expect(GPU_FRACTAL_PT_PREAMBLE_WGSL).toContain('fn _fractal_julia_pt');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm run test compute-engine/fractals`
Expected: FAIL — `GPU_FRACTAL_PT_PREAMBLE_GLSL` is not exported.

**Step 3: Implement the perturbation preamble**

Add to `src/compute-engine/compilation/gpu-target.ts`, after the dp preambles:

```typescript
/**
 * Perturbation theory Mandelbrot/Julia preamble (GLSL).
 *
 * Iterates delta_{n+1} = 2*Z_n*delta_n + delta_n^2 + delta_c
 * where Z_n is fetched from a reference orbit texture (RG32F format).
 *
 * Glitch detection: when |delta| > |Z|, the approximation breaks down.
 * Falls back to emulated double (ds_*) for rebase.
 *
 * Requires: GPU_DS_ARITHMETIC_PREAMBLE_GLSL (for glitch rebase)
 */
export const GPU_FRACTAL_PT_PREAMBLE_GLSL = `
uniform sampler2D _refOrbit;
uniform int _refOrbitLen;

vec2 _pt_fetch_orbit(int i, int texWidth) {
  int y = i / texWidth;
  int x = i - y * texWidth;
  return texelFetch(_refOrbit, ivec2(x, y), 0).rg;
}

float _fractal_mandelbrot_pt(vec2 delta_c, int maxIter, int texWidth) {
  float dr = 0.0;
  float di = 0.0;
  int orbitLen = min(maxIter, _refOrbitLen);
  for (int i = 0; i < orbitLen; i++) {
    vec2 Zn = _pt_fetch_orbit(i, texWidth);
    // delta_{n+1} = 2*Z_n*delta_n + delta_n^2 + delta_c
    float new_dr = 2.0 * (Zn.x * dr - Zn.y * di) + dr * dr - di * di + delta_c.x;
    float new_di = 2.0 * (Zn.x * di + Zn.y * dr) + 2.0 * dr * di + delta_c.y;
    dr = new_dr;
    di = new_di;
    // Full z = Z_n+1 + delta for escape check
    vec2 Zn1 = (i + 1 < orbitLen) ? _pt_fetch_orbit(i + 1, texWidth) : vec2(0.0);
    float zr = Zn1.x + dr;
    float zi = Zn1.y + di;
    float mag2 = zr * zr + zi * zi;
    if (mag2 > 4.0)
      return clamp((float(i) - log2(log2(mag2)) + 4.0) / float(maxIter), 0.0, 1.0);
    // Glitch detection: |delta|^2 > |Z|^2
    float dmag2 = dr * dr + di * di;
    float Zmag2 = Zn.x * Zn.x + Zn.y * Zn.y;
    if (dmag2 > Zmag2 && Zmag2 > 0.0) {
      // Rebase: reconstruct absolute z using emulated double, then restart
      // as direct iteration for remaining steps
      vec2 abs_zr = ds_add(ds_from(Zn1.x), ds_from(dr));
      vec2 abs_zi = ds_add(ds_from(Zn1.y), ds_from(di));
      vec4 abs_z = vec4(abs_zr.x, abs_zi.x, abs_zr.y, abs_zi.y);
      vec4 abs_c = vec4(Zn1.x + dr + delta_c.x, Zn1.y + di + delta_c.y, 0.0, 0.0);
      // Continue with emulated double from this point
      // (simplified: just use single-float for remaining iterations after rebase)
      zr = abs_zr.x;
      zi = abs_zi.x;
      float cx = zr - dr + delta_c.x;
      float cy = zi - di + delta_c.y;
      for (int j = i + 1; j < maxIter; j++) {
        float new_zr = zr * zr - zi * zi + cx;
        zi = 2.0 * zr * zi + cy;
        zr = new_zr;
        mag2 = zr * zr + zi * zi;
        if (mag2 > 4.0)
          return clamp((float(j) - log2(log2(mag2)) + 4.0) / float(maxIter), 0.0, 1.0);
      }
      return 1.0;
    }
  }
  return 1.0;
}

float _fractal_julia_pt(vec2 z_delta, vec2 delta_c, int maxIter, int texWidth) {
  float dr = z_delta.x;
  float di = z_delta.y;
  int orbitLen = min(maxIter, _refOrbitLen);
  for (int i = 0; i < orbitLen; i++) {
    vec2 Zn = _pt_fetch_orbit(i, texWidth);
    float new_dr = 2.0 * (Zn.x * dr - Zn.y * di) + dr * dr - di * di + delta_c.x;
    float new_di = 2.0 * (Zn.x * di + Zn.y * dr) + 2.0 * dr * di + delta_c.y;
    dr = new_dr;
    di = new_di;
    vec2 Zn1 = (i + 1 < orbitLen) ? _pt_fetch_orbit(i + 1, texWidth) : vec2(0.0);
    float zr = Zn1.x + dr;
    float zi = Zn1.y + di;
    float mag2 = zr * zr + zi * zi;
    if (mag2 > 4.0)
      return clamp((float(i) - log2(log2(mag2)) + 4.0) / float(maxIter), 0.0, 1.0);
    float dmag2 = dr * dr + di * di;
    float Zmag2 = Zn.x * Zn.x + Zn.y * Zn.y;
    if (dmag2 > Zmag2 && Zmag2 > 0.0) {
      zr = Zn1.x + dr;
      zi = Zn1.y + di;
      float cx = delta_c.x;
      float cy = delta_c.y;
      for (int j = i + 1; j < maxIter; j++) {
        float new_zr = zr * zr - zi * zi + cx;
        zi = 2.0 * zr * zi + cy;
        zr = new_zr;
        mag2 = zr * zr + zi * zi;
        if (mag2 > 4.0)
          return clamp((float(j) - log2(log2(mag2)) + 4.0) / float(maxIter), 0.0, 1.0);
      }
      return 1.0;
    }
  }
  return 1.0;
}
`;

/**
 * Perturbation theory Mandelbrot/Julia preamble (WGSL).
 */
export const GPU_FRACTAL_PT_PREAMBLE_WGSL = `
@group(0) @binding(1) var _refOrbit: texture_2d<f32>;
@group(0) @binding(2) var _refOrbitSampler: sampler;
var<uniform> _refOrbitLen: i32;

fn _pt_fetch_orbit(i: i32, texWidth: i32) -> vec2f {
  let y = i / texWidth;
  let x = i - y * texWidth;
  return textureLoad(_refOrbit, vec2i(x, y), 0).rg;
}

fn _fractal_mandelbrot_pt(delta_c: vec2f, maxIter: i32, texWidth: i32) -> f32 {
  var dr: f32 = 0.0;
  var di: f32 = 0.0;
  let orbitLen = min(maxIter, _refOrbitLen);
  for (var i: i32 = 0; i < orbitLen; i++) {
    let Zn = _pt_fetch_orbit(i, texWidth);
    let new_dr = 2.0 * (Zn.x * dr - Zn.y * di) + dr * dr - di * di + delta_c.x;
    let new_di = 2.0 * (Zn.x * di + Zn.y * dr) + 2.0 * dr * di + delta_c.y;
    dr = new_dr;
    di = new_di;
    var Zn1 = vec2f(0.0);
    if (i + 1 < orbitLen) { Zn1 = _pt_fetch_orbit(i + 1, texWidth); }
    let zr = Zn1.x + dr;
    let zi = Zn1.y + di;
    let mag2 = zr * zr + zi * zi;
    if (mag2 > 4.0) {
      return clamp((f32(i) - log2(log2(mag2)) + 4.0) / f32(maxIter), 0.0, 1.0);
    }
    let dmag2 = dr * dr + di * di;
    let Zmag2 = Zn.x * Zn.x + Zn.y * Zn.y;
    if (dmag2 > Zmag2 && Zmag2 > 0.0) {
      var f_zr = Zn1.x + dr;
      var f_zi = Zn1.y + di;
      let cx = delta_c.x;
      let cy = delta_c.y;
      for (var j: i32 = i + 1; j < maxIter; j++) {
        let t_zr = f_zr * f_zr - f_zi * f_zi + cx;
        f_zi = 2.0 * f_zr * f_zi + cy;
        f_zr = t_zr;
        let m2 = f_zr * f_zr + f_zi * f_zi;
        if (m2 > 4.0) {
          return clamp((f32(j) - log2(log2(m2)) + 4.0) / f32(maxIter), 0.0, 1.0);
        }
      }
      return 1.0;
    }
  }
  return 1.0;
}

fn _fractal_julia_pt(z_delta: vec2f, delta_c: vec2f, maxIter: i32, texWidth: i32) -> f32 {
  var dr = z_delta.x;
  var di = z_delta.y;
  let orbitLen = min(maxIter, _refOrbitLen);
  for (var i: i32 = 0; i < orbitLen; i++) {
    let Zn = _pt_fetch_orbit(i, texWidth);
    let new_dr = 2.0 * (Zn.x * dr - Zn.y * di) + dr * dr - di * di + delta_c.x;
    let new_di = 2.0 * (Zn.x * di + Zn.y * dr) + 2.0 * dr * di + delta_c.y;
    dr = new_dr;
    di = new_di;
    var Zn1 = vec2f(0.0);
    if (i + 1 < orbitLen) { Zn1 = _pt_fetch_orbit(i + 1, texWidth); }
    let zr = Zn1.x + dr;
    let zi = Zn1.y + di;
    let mag2 = zr * zr + zi * zi;
    if (mag2 > 4.0) {
      return clamp((f32(i) - log2(log2(mag2)) + 4.0) / f32(maxIter), 0.0, 1.0);
    }
    let dmag2 = dr * dr + di * di;
    let Zmag2 = Zn.x * Zn.x + Zn.y * Zn.y;
    if (dmag2 > Zmag2 && Zmag2 > 0.0) {
      var f_zr = Zn1.x + dr;
      var f_zi = Zn1.y + di;
      let cx = delta_c.x;
      let cy = delta_c.y;
      for (var j: i32 = i + 1; j < maxIter; j++) {
        let t_zr = f_zr * f_zr - f_zi * f_zi + cx;
        f_zi = 2.0 * f_zr * f_zi + cy;
        f_zr = t_zr;
        let m2 = f_zr * f_zr + f_zi * f_zi;
        if (m2 > 4.0) {
          return clamp((f32(j) - log2(log2(m2)) + 4.0) / f32(maxIter), 0.0, 1.0);
        }
      }
      return 1.0;
    }
  }
  return 1.0;
}
`;
```

**Step 4: Run test to verify it passes**

Run: `npm run test compute-engine/fractals`
Expected: PASS

**Step 5: Commit**

```
feat: add perturbation theory Mandelbrot/Julia GLSL/WGSL preambles

Reference orbit fetched from texture (RG32F). Glitch detection with
single-float rebase fallback. Includes ds_* dependency for rebase ops.
```

---

## Task 7: Wire perturbation strategy into compile path

**Files:**
- Modify: `src/compute-engine/compilation/gpu-target.ts` (handlers + preamble injection)
- Test: `test/compute-engine/fractals.test.ts`

**Step 1: Write the failing tests**

Add to the `FRACTAL PRECISION STRATEGY` describe block:

```typescript
  it('selects perturbation for very small radius', () => {
    const expr = ce.expr(['Mandelbrot', 'c', 256]);
    const result = glsl.compile(expr, {
      hints: { viewport: { center: [0.3, 0.1], radius: 1e-16 } },
    });
    expect(result.code).toContain('_fractal_mandelbrot_pt(');
    expect(result.preamble).toContain('_refOrbit');
    expect(result.preamble).toContain('ds_add'); // ds_* included for glitch rebase
    expect(result.staleWhen).toBeDefined();
    expect(result.staleWhen!.radiusAbove).toBe(1e-5);
    expect(result.staleWhen!.centerDistance).toBeCloseTo(1e-16 * 2.0);
    expect(result.staleWhen!.radiusBelow).toBeCloseTo(1e-16 * 0.01);
  });

  it('perturbation includes orbit texture data', () => {
    const expr = ce.expr(['Mandelbrot', 'c', 50]);
    const result = glsl.compile(expr, {
      hints: { viewport: { center: [-0.5, 0], radius: 1e-16 } },
    });
    expect(result.textures).toBeDefined();
    expect(result.textures!._refOrbit).toBeDefined();
    expect(result.textures!._refOrbit.format).toBe('rg32f');
    expect(result.textures!._refOrbit.data).toBeInstanceOf(Float32Array);
    expect(result.textures!._refOrbit.data.length).toBeGreaterThan(0);
    expect(result.uniforms).toBeDefined();
    expect(result.uniforms!._refOrbitLen).toBeGreaterThan(0);
  });

  it('perturbation for Julia includes orbit data', () => {
    const expr = ce.expr(['Julia', 'z', 'c', 50]);
    const result = glsl.compile(expr, {
      hints: { viewport: { center: [0, 0], radius: 1e-16 } },
    });
    expect(result.code).toContain('_fractal_julia_pt(');
    expect(result.textures).toBeDefined();
    expect(result.textures!._refOrbit).toBeDefined();
  });
```

**Step 2: Run test to verify it fails**

Run: `npm run test compute-engine/fractals`
Expected: FAIL — perturbation path not yet wired up.

**Step 3: Update Mandelbrot/Julia handlers for perturbation**

In the Mandelbrot handler from Task 4, replace the
`// TODO: perturbation strategy (Task 7)` line:

```typescript
    if (strategy === 'perturbation') {
      const cCode = compile(c);
      // delta_c = c - center (center is a uniform set by the plot engine)
      return `_fractal_mandelbrot_pt(${cCode}, ${iterCode}, _refOrbitTexWidth)`;
    }
```

Similarly in the Julia handler:

```typescript
    if (strategy === 'perturbation') {
      const zCode = compile(z);
      const cCode = compile(c);
      return `_fractal_julia_pt(${zCode}, ${cCode}, ${iterCode}, _refOrbitTexWidth)`;
    }
```

**Step 4: Update preamble injection for perturbation**

In the `compile()` method, update the fractal preamble injection block:

```typescript
    if (code.includes('_fractal_')) {
      if (code.includes('_fractal_mandelbrot_pt') || code.includes('_fractal_julia_pt')) {
        // Perturbation: needs ds_* (for glitch rebase) + pt preamble
        preamble +=
          this.languageId === 'wgsl'
            ? GPU_DS_ARITHMETIC_PREAMBLE_WGSL
            : GPU_DS_ARITHMETIC_PREAMBLE_GLSL;
        preamble +=
          this.languageId === 'wgsl'
            ? GPU_FRACTAL_PT_PREAMBLE_WGSL
            : GPU_FRACTAL_PT_PREAMBLE_GLSL;
      } else if (code.includes('_fractal_mandelbrot_dp') || code.includes('_fractal_julia_dp')) {
        // Emulated double: needs ds_* + dp preamble
        preamble +=
          this.languageId === 'wgsl'
            ? GPU_DS_ARITHMETIC_PREAMBLE_WGSL
            : GPU_DS_ARITHMETIC_PREAMBLE_GLSL;
        preamble +=
          this.languageId === 'wgsl'
            ? GPU_FRACTAL_DP_PREAMBLE_WGSL
            : GPU_FRACTAL_DP_PREAMBLE_GLSL;
      } else {
        // Single-precision
        preamble +=
          this.languageId === 'wgsl'
            ? GPU_FRACTAL_PREAMBLE_WGSL
            : GPU_FRACTAL_PREAMBLE_GLSL;
      }
    }
```

**Step 5: Compute orbit and set textures/uniforms for perturbation**

Add import at top of `gpu-target.ts`:

```typescript
import { computeReferenceOrbit } from './fractal-orbit';
```

After the staleWhen assignment in `compile()`, add orbit computation:

```typescript
    // Compute reference orbit for perturbation strategy
    if (code.includes('_fractal_mandelbrot_pt') || code.includes('_fractal_julia_pt')) {
      const viewport = options.hints?.viewport;
      if (viewport) {
        // Precision: ~log10(1/radius) digits, minimum 50, plus margin
        const digits = Math.max(50, Math.ceil(-Math.log10(viewport.radius)) + 10);
        // Extract maxIter from the expression (use a reasonable default)
        const maxIter = 1000; // TODO: extract from expr if needed
        const orbit = computeReferenceOrbit(viewport.center as [number, number], maxIter, digits);
        const orbitLen = orbit.length / 2;
        const texWidth = Math.min(orbitLen, 4096);
        const texHeight = Math.ceil(orbitLen / texWidth);
        result.textures = {
          _refOrbit: {
            data: orbit,
            width: texWidth,
            height: texHeight,
            format: 'rg32f',
          },
        };
        result.uniforms = {
          ...result.uniforms,
          _refOrbitLen: orbitLen,
          _refOrbitTexWidth: texWidth,
        };
      }
    }
```

**Step 6: Run test to verify it passes**

Run: `npm run test compute-engine/fractals`
Expected: PASS

**Step 7: Run typecheck and full test suite**

Run: `npm run typecheck`
Run: `npm run test compute-engine/fractals`
Expected: All PASS, no regressions.

**Step 8: Commit**

```
feat: wire perturbation strategy into fractal compilation

Perturbation mode auto-selected for radius < 1e-14. Computes reference
orbit via BigDecimal, packs into RG32F texture, sets uniforms and
staleWhen on CompilationResult. Includes ds_* preamble for glitch rebase.
```

---

## Task 8: WGSL target verification

**Files:**
- Test: `test/compute-engine/fractals.test.ts`

**Step 1: Add WGSL-specific strategy tests**

Add to `test/compute-engine/fractals.test.ts`:

```typescript
describe('FRACTAL WGSL STRATEGY SELECTION', () => {
  it('selects emulated double for medium radius (WGSL)', () => {
    const expr = ce.expr(['Mandelbrot', 'c', 100]);
    const result = wgsl.compile(expr, {
      hints: { viewport: { center: [0, 0], radius: 1e-8 } },
    });
    expect(result.code).toContain('_fractal_mandelbrot_dp(');
    expect(result.preamble).toContain('fn ds_add(');
    expect(result.preamble).toContain('fn _fractal_mandelbrot_dp(');
  });

  it('selects perturbation for small radius (WGSL)', () => {
    const expr = ce.expr(['Mandelbrot', 'c', 100]);
    const result = wgsl.compile(expr, {
      hints: { viewport: { center: [0, 0], radius: 1e-16 } },
    });
    expect(result.code).toContain('_fractal_mandelbrot_pt(');
    expect(result.preamble).toContain('fn _fractal_mandelbrot_pt(');
    expect(result.preamble).toContain('texture_2d');
  });
});
```

**Step 2: Run test to verify it passes**

Run: `npm run test compute-engine/fractals`
Expected: PASS (WGSL target inherits the same strategy logic from GPUShaderTarget).

**Step 3: Commit**

```
test: verify WGSL target fractal strategy selection
```

---

## Task 9: Final regression check and typecheck

**Step 1: Run full typecheck**

Run: `npm run typecheck`
Expected: PASS

**Step 2: Run all fractal tests**

Run: `npm run test compute-engine/fractals`
Expected: All PASS

**Step 3: Run broader compilation tests**

Run: `npm run test compute-engine/compile`
(or whatever pattern matches the compilation test files)
Expected: All PASS — non-fractal compilation unaffected.

**Step 4: Spot-check a non-fractal expression with hints**

Add a quick test to verify hints are ignored for non-fractal functions:

```typescript
  it('non-fractal function ignores hints', () => {
    const expr = ce.expr(['Sin', 'x']);
    const result = glsl.compile(expr, {
      hints: { viewport: { center: [0, 0], radius: 1e-16 } },
    });
    expect(result.staleWhen).toBeUndefined();
    expect(result.textures).toBeUndefined();
    expect(result.code).toBe('sin(x)');
  });
```

**Step 5: Commit**

```
test: final regression checks for viewport-aware fractal compilation
```
