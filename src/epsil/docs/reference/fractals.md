---
title: Fractals Reference
sidebar_label: Fractals
slug: /epsil/reference/fractals/
description: "The fractals library of Epsil: every definition with its Epsil spelling, MathJSON name, signature, and full description."
hide_title: true
date: Last Modified
# GENERATED FILE — do not edit. The entries come from the library
# definitions (src/compute-engine/library/) as `epsil doc` describes them;
# the introduction comes from fractals.intro.md when that file exists.
# Regenerate with `npm run doc` (scripts/build-library-reference.ts).
---
# Fractals

The 2 definitions of the fractals library, each with its Epsil spelling, its MathJSON name, its signature and its full description.

Each definition is listed under its Epsil spelling (the MathJSON name when
it has none), with its signature in the engine's type syntax. The
[Standard Library](/epsil/library/) page is the one-page index of every
category.

## Definitions

### julia

MathJSON `Julia` · `(z: complex, c: complex, maxIterations: integer) -> real`

- `z` — The starting point of the iteration of `z^2 + c`. Sample: `0.5i`.
- `c` — The constant of the iteration, which selects the Julia set. Sample: `-0.4 + 0.6i`.
- `maxIterations` — The maximum number of iterations, a positive integer; a point that has not escaped by then counts as inside the set. Sample: `100`.

Smooth escape-time value for a Julia set with parameter c. Returns 1 for points inside the set, values in [0,1) for escaping points.

```epsil
julia(0, -0.4 + 0.6i, 100)
// ➔ 0.2694766337707254
```

```epsil
julia(1, -0.4 + 0.6i, 100)
// ➔ 0.04959683987941814
```

### mandelbrot

MathJSON `Mandelbrot` · `(c: complex, maxIterations: integer) -> real`

- `c` — The point of the complex plane, the constant of `z^2 + c`. Sample: `-0.5 + 0.5i`.
- `maxIterations` — The maximum number of iterations, a positive integer; a point that has not escaped by then counts as inside the set. Sample: `100`.

Smooth escape-time value for the Mandelbrot set. Returns 1 for points inside the set, values in [0,1) for escaping points.

```epsil
mandelbrot(0, 100)
// ➔ 1
```

```epsil
mandelbrot(1 + i, 100)
// ➔ 0.03277553368580627
```
