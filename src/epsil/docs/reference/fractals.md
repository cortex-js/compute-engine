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

MathJSON `Julia` · `(complex, complex, integer) -> real`

Smooth escape-time value for a Julia set with parameter c. Returns 1 for points inside the set, values in [0,1) for escaping points.

### mandelbrot

MathJSON `Mandelbrot` · `(complex, integer) -> real`

Smooth escape-time value for the Mandelbrot set. Returns 1 for points inside the set, values in [0,1) for escaping points.
