# High-Precision Mandelbrot/Julia via Viewport-Aware Compilation

**Date:** 2026-03-06
**Status:** Approved

## Problem

The current Mandelbrot/Julia GPU implementation uses single-precision floats
(GLSL `float`, 23-bit mantissa, ~7 decimal digits). Interactive deep-zoom
becomes unusable past ~10^6x magnification as coordinates become
indistinguishable and the image pixelates.

## Goal

Enable interactive deep-zoom rendering of Mandelbrot/Julia sets beyond 32-bit
float limitations, with no changes to the user-facing expression API.

## Design

### User-Facing API (unchanged)

```
Mandelbrot(x + yi, 256)
Julia(x + yi, -0.7 + 0.27i, 256)
```

No new functions. The user writes the same expressions as today.

### Compile API Extension

The `compile()` method accepts an optional `hints` object with a nested
`viewport` field:

```typescript
compile(expr, {
  realOnly: true,
  hints: {
    viewport: { center: [0.3, 0.1], radius: 0.001 }
  }
})
```

When `hints` is absent (or `hints.viewport` is absent), the compiler uses the
current single-precision strategy (backward compatible). The `hints` object is
open-ended — `viewport` is the initial field, leaving room for non-viewport
hints later without ambiguity about what `center` and `radius` refer to.

### CompilationResult Extension

```typescript
interface CompilationResult {
  success: boolean;
  run: Function;
  code?: string;

  // Cheap staleness check -- plain numbers, no closures
  staleWhen?: {
    radiusBelow?: number;    // recompile when zoomed deeper than this
    radiusAbove?: number;    // recompile when zoomed out past this
    centerDistance?: number;  // recompile when center moves more than this
  };

  // Scalar uniforms the shader needs
  uniforms?: Record<string, number>;

  // Texture data the shader needs (e.g., reference orbit)
  // Separated from uniforms because the upload path is fundamentally
  // different (createTexture + sampler vs uniform1f)
  textures?: Record<string, {
    data: Float32Array;
    width: number;
    height: number;
    format: 'r32f' | 'rg32f' | 'rgba32f';
  }>;
}
```

`staleWhen` is plain serializable data. The plot engine checks it with a few
number comparisons per viewport change -- trivially cheap.

`uniforms` and `textures` are separated because their GPU upload paths are
fundamentally different: scalar uniforms use `uniform1f`/`uniform1i`, while
textures need `createTexture` + sampler setup + dimension metadata. The
`format` field tells the plot engine the internal format to use when creating
the texture (e.g., `gl.RG32F` for WebGL2). The reference orbit uses `rg32f`:
each texel holds one orbit point as (re, im), which is the natural mapping.
The plot engine uploads both without knowing what the data represents.

### Precision Strategy Selection

The compiler picks the strategy based on `hints.viewport.radius`:

| Radius       | Strategy         | GPU cost | staleWhen                                             |
| ------------ | ---------------- | -------- | ----------------------------------------------------- |
| > 10^-6      | Single float     | 1x       | `{ radiusBelow: 1e-6 }`                               |
| 10^-6..10^-14| Emulated double  | ~5x      | `{ radiusBelow: 1e-14, radiusAbove: 1e-5 }`           |
| < 10^-14     | Perturbation     | ~1.2x    | `{ radiusAbove: 1e-5, radiusBelow: radius * 0.01, centerDistance: radius * 2.0 }` |

When zooming out from perturbation, `radiusAbove: 1e-5` jumps directly to
single-float, skipping the emulated-double tier. The brief passage through the
10^-6 to 10^-5 range with single-float precision is acceptable for a transient
zoom level and avoids a pointless intermediate recompilation.

When zooming deeper within the perturbation tier, `radiusBelow: radius * 0.01`
triggers recompilation after 100x further magnification. This is needed because
the reference orbit's BigDecimal precision is calibrated to the zoom level at
which it was computed — zooming significantly deeper requires recomputing the
orbit at higher precision (more BigDecimal digits) and potentially more
iterations.

The perturbation `centerDistance` is set to `radius * 2.0` (two viewport
widths). Perturbation theory tolerates reasonable center drift since deltas
simply grow and glitch detection handles the worst cases. A conservative
threshold avoids excessive recompilation during interactive panning. This can
be tightened later if glitch frequency becomes a problem.

When no hints are provided, single-float is used with no `staleWhen`.

### Three GLSL Preambles

**1. Single float** -- already exists (`GPU_FRACTAL_PREAMBLE_GLSL`).

**2. Emulated double** -- new (~200 lines). Uses "double-single" (float-float)
arithmetic where a number is stored as `vec2(hi, lo)` with `value = hi + lo`:

```glsl
vec2 ds_add(vec2 a, vec2 b);    // Knuth TwoSum
vec2 ds_mul(vec2 a, vec2 b);    // Dekker split + TwoProduct
vec2 ds_sqr(vec2 a);            // optimized self-multiply

float _fractal_mandelbrot_dp(vec4 c, int maxIter) {
  // c.xy = hi parts of (re, im), c.zw = lo parts
  // Uses ds_add/ds_mul for z -> z^2 + c iteration
}
```

This gives ~48 bits of mantissa (~14 decimal digits) from two 32-bit floats.
The Dekker/Knuth algorithms are well-established and widely used in GPU
double-emulation.

**3. Perturbation** -- new. Standard single-float arithmetic on small deltas:

```glsl
uniform sampler2D _refOrbit;    // reference orbit Z_n as texture
uniform int _refOrbitLen;

float _fractal_mandelbrot_pt(vec2 delta_c, int maxIter) {
  // delta_{n+1} = 2 * Z_n * delta_n + delta_n^2 + delta_c
  // Z_n fetched from _refOrbit texture row by row
  // Glitch detection: if |delta| > |Z|, rebase using emulated double
}
```

Perturbation theory: instead of iterating z -> z^2 + c per pixel, pick a
reference point C0 at viewport center, compute its full orbit Z_0..Z_N once
on the CPU at arbitrary precision, then for each pixel compute only the delta
from that orbit. Since delta is the difference between nearby points, it stays
small and single-float is sufficient.

### Reference Orbit Computation

When the compiler selects perturbation, it computes the reference orbit on the
CPU using `BigDecimal` (the engine's existing arbitrary-precision library):

```typescript
// Inside the compiler, when perturbation is selected:
const orbit = computeReferenceOrbit(center, maxIter);
// Pack orbit into a texture (2 floats per texel: re, im)
const orbitLen = orbit.length / 2;
const texWidth = Math.min(orbitLen, 4096);
const texHeight = Math.ceil(orbitLen / texWidth);
result.textures = {
  _refOrbit: {
    data: new Float32Array(orbit),  // [re0, im0, re1, im1, ...]
    width: texWidth,
    height: texHeight,
    format: 'rg32f',  // 2 floats per texel: (re, im) per orbit point
  },
};
result.uniforms = { _refOrbitLen: orbitLen };
```

The plot engine uploads `textures` and `uniforms` to the GPU without knowing
what they represent.

### Async Boundary for Orbit Computation

At deep zoom levels, iterating a BigDecimal Mandelbrot orbit for tens of
thousands of iterations can take 100ms+. The `compile()` method itself remains
**synchronous** — it returns `CompilationResult` directly. The async boundary
lives in the **plot engine**, which is responsible for calling `compile()` off
the main thread:

- **Recommended**: the plot engine calls `compile()` inside a
  `requestIdleCallback` or `setTimeout`, then swaps the shader when ready
- **Alternative**: the plot engine uses a Web Worker for the compile call
  (BigDecimal is pure JS, no DOM dependencies, worker-friendly)

The compute engine does not impose an async API because:
1. Most compilations (single-float, emulated double) are instant
2. The plot engine already manages the stale-while-revalidate pattern and
   knows when to schedule heavy work
3. Forcing a Promise return for the common fast path adds unnecessary
   complexity

### Plot Engine Protocol

```typescript
let compiled = ce.compile(expr, { hints: { viewport } });

function onViewportChange(newViewport) {
  // Cheap staleness check (a few number comparisons)
  if (compiled.staleWhen) {
    const s = compiled.staleWhen;
    const stale =
      (s.radiusBelow && newViewport.radius < s.radiusBelow) ||
      (s.radiusAbove && newViewport.radius > s.radiusAbove) ||
      (s.centerDistance &&
        dist(newViewport.center, oldCenter) > s.centerDistance);

    if (stale) {
      // Async recompile -- keep rendering old shader meanwhile
      recompileAsync(expr, { hints: { viewport: newViewport } }).then(c => {
        compiled = c;
        uploadUniforms(c.uniforms);
        uploadTextures(c.textures);
      });
    }
  }
  render(compiled);
}
```

The protocol is generic: any compiled function can declare staleness and
request uniforms/textures. Non-fractal functions ignore hints and return no
`staleWhen`.

**Debouncing note:** during active gestures (pinch-zoom, scroll), the viewport
may cross staleness thresholds transiently. The plot engine should debounce
recompilation — e.g., only fire after the viewport has been stable for ~100ms
or after the gesture ends. This avoids wasted recompilations when the user
zooms through a threshold and immediately reverses. This is a plot engine
implementation detail, not a compute engine concern.

### Glitch Detection (Perturbation)

When the perturbation delta grows too large relative to the reference orbit
value (|delta| > |Z|), the approximation breaks down ("glitch"). The shader
detects this and rebases to absolute coordinates using emulated double
arithmetic from the double-single preamble.

This means the **perturbation preamble literally includes the ds_\* functions**
from the emulated-double preamble. Phase 6 (perturbation shader) depends on
Phase 2-3 (emulated double) not just conceptually but because the perturbation
GLSL code calls `ds_add`, `ds_mul`, etc. directly for rebase operations.

### What Stays the Same

- `Mandelbrot(c, maxIter)` and `Julia(z, c, maxIter)` signatures unchanged
- CPU evaluation unchanged (already uses JS `number` doubles; BigDecimal only
  used for reference orbit computation in perturbation mode)
- Single-float GPU path unchanged
- All existing tests pass without modification
- Non-fractal expression compilation unaffected

## Implementation Phases

### Dependency graph

```
Phase 1 (types) ──> Phase 2-3 (emulated double) ──> Phase 4 (strategy selection)
                                                  ╲
Phase 1 (types) ──> Phase 5 (reference orbit)  ───> Phase 6 (perturbation)
```

Phases 2-3 and Phase 5 are **independent** and can be developed in parallel.
Phase 6 depends on both (perturbation shader uses ds_* functions for glitch
rebase and reference orbit data for the iteration).

### Phase 1: Extend compile API

Add `hints` (with nested `viewport`) to compile options. Add `staleWhen`,
`uniforms`, and `textures` to the compilation result type. No behavioral
change yet; all functions ignore hints.

**Files:** `src/compute-engine/compilation/types.ts`

### Phase 2: Emulated double arithmetic

GLSL double-single helper functions: `ds_add`, `ds_sub`, `ds_mul`, `ds_sqr`,
`ds_div`, `ds_sqrt`, `ds_cmp`. Implement as a new preamble constant
`GPU_DS_ARITHMETIC_PREAMBLE_GLSL` (and WGSL variant).

**Files:** `src/compute-engine/compilation/gpu-target.ts`

### Phase 3: Emulated double Mandelbrot/Julia

`_fractal_mandelbrot_dp` and `_fractal_julia_dp` preamble functions using the
ds_* helpers. New preamble constant `GPU_FRACTAL_DP_PREAMBLE_GLSL`.

**Files:** `src/compute-engine/compilation/gpu-target.ts`

### Phase 4: Strategy selection

When compiling `Mandelbrot`/`Julia` with viewport hints, select strategy based
on `hints.viewport.radius`. Set `staleWhen` on the result. Emit the correct
preamble and compile to the corresponding helper function call.

**Coordinate passing:** the emulated-double path changes how coordinates reach
the fractal function. The current single-float path passes `vec2(x, y)`. The
emulated-double path must split each coordinate into hi/lo pairs and pass
`vec4(re_hi, im_hi, re_lo, im_lo)` to `_fractal_mandelbrot_dp`. This means
Phase 4 must also emit a coordinate-conversion wrapper or modify the shader
entry point to perform the split (using `ds_split` from the ds_* preamble).

**Files:** `src/compute-engine/compilation/gpu-target.ts`,
`src/compute-engine/compilation/compile-expression.ts`

### Phase 5: Reference orbit computation (parallelizable with Phases 2-3)

CPU-side `BigDecimal` Mandelbrot iteration. Pack orbit into `Float32Array` and
return via `textures`. Used when perturbation strategy is selected in Phase 6.

**Files:** `src/compute-engine/library/fractals.ts` (or new
`src/compute-engine/compilation/fractal-orbit.ts`)

### Phase 6: Perturbation shader (depends on Phases 2-3 and 5)

`_fractal_mandelbrot_pt` and `_fractal_julia_pt` preambles. Reference orbit
read from texture. Glitch detection with rebase to emulated double (calls
ds_* functions from Phase 2 directly).

**Files:** `src/compute-engine/compilation/gpu-target.ts`

### Phase 7 (future): Series approximation

Skip early iterations via Taylor expansion of the perturbation formula. Major
speedup for ultra-deep zooms but adds significant mathematical complexity.
Deferred -- the system works without it, just slower at extreme depths.

## Testing Strategy

- Unit tests for ds_* arithmetic accuracy (compare against BigDecimal)
- Snapshot tests for generated GLSL at each precision level
- Integration test: compile Mandelbrot with various hint radii, verify correct
  strategy selection and staleWhen values
- Regression: all existing fractal compilation tests unchanged
