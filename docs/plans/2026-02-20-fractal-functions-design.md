# Fractal Functions Design

**Date**: 2026-02-20
**Status**: Approved

## Overview

Add `Mandelbrot` and `Julia` as built-in MathJSON operators with a primary
target of GLSL shader compilation. Each function returns a smooth-colored
normalized escape value in `[0, 1]` that the caller maps to a color.

## Functions

| Operator | Signature | Description |
|---|---|---|
| `Mandelbrot(c, maxIter)` | `complex × integer → real` | z₀ = 0, iterates z → z² + c |
| `Julia(z, c, maxIter)` | `complex × complex × integer → real` | User-specified z₀, same iteration |

### Return Value

Both return a value in `[0, 1]`:
- `1.0` — point is inside the set (did not escape within `maxIter` iterations)
- `[0, 1)` — point escaped; value encodes how quickly, with **smooth coloring**
  applied (`i - log₂(log₂(|z|²)) + 4`) so the gradient is continuous rather
  than banded

The caller is responsible for mapping the scalar to a color (e.g. via `Palette`
or a custom expression).

## Architecture

### New Files

- `src/compute-engine/library/fractals.ts` — operator definitions with JS
  `evaluate` handlers
- `test/compute-engine/fractals.test.ts` — JS evaluate tests + GLSL output
  snapshot tests

### Modified Files

- `src/compute-engine/compilation/gpu-target.ts` — add `_fractal_mandelbrot`
  and `_fractal_julia` preamble functions (injected when operators appear in
  compiled code, same pattern as existing `_gpu_cmul` etc.)
- `src/compute-engine/library/library.ts` — register the new `fractals` library
  in `STANDARD_LIBRARIES`

## GLSL Preamble Functions

Injected into shader preamble when the operators are used:

```glsl
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
```

`maxIter` can be a GLSL variable (target uses `#version 300 es` which allows
non-constant loop bounds), enabling it to be passed as a `uniform int`.

## Typical Usage in a Fragment Shader

```glsl
// uniforms: vec2 pan, float zoom, int maxIter
vec2 c = (fragCoord / resolution - 0.5) * zoom + pan;
float t = _fractal_mandelbrot(c, maxIter);
// caller maps t to color
```

## JS Evaluate Fallback

Same algorithm runs in JavaScript when `.evaluate()` is called rather than
compiling to GLSL. Useful for debugging and small canvas renders.

```ts
Mandelbrot(Complex(0.3, 0.5), 100).evaluate() // → ~0.42
```

## Decisions

- **Smooth coloring always on**: removes banding without exposing a separate
  option; the formula is always better than raw integer count for visualization
- **No `MandelbrotSmooth` variant**: YAGNI — one function, always smooth
- **Caller controls color mapping**: `Mandelbrot` returns a scalar; composing
  with `Palette` or custom expressions is the user's responsibility
- **WGSL parity**: add matching `_fractal_*` helpers to the WGSL preamble as
  well for consistency
