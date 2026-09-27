---
title: Colors Reference
sidebar_label: Colors
slug: /epsil/reference/colors/
description: "The colors library of Epsil: every definition with its Epsil spelling, MathJSON name, signature, and full description."
hide_title: true
date: Last Modified
# GENERATED FILE — do not edit. The entries come from the library
# definitions (src/compute-engine/library/) as `epsil doc` describes them;
# the introduction comes from colors.intro.md when that file exists.
# Regenerate with `npm run doc` (scripts/build-library-reference.ts).
---
# Colors

The 20 definitions of the colors library, each with its Epsil spelling, its MathJSON name, its signature and its full description.

Each definition is listed under its Epsil spelling (the MathJSON name when
it has none), with its signature in the engine's type syntax. The
[Standard Library](/epsil/library/) page is the one-page index of every
category.

## Definitions

### asHsl

MathJSON `AsHsl` · `(color | string | tuple) -> color`

Convert any color to HSL (hue degrees, s/l 0-1)

### asHsv

MathJSON `AsHsv` · `(color | string | tuple) -> color`

Convert any color to HSV (hue degrees, s/v 0-1)

### asOklab

MathJSON `AsOklab` · `(color | string | tuple) -> color`

Convert any color to OKLab

### asOklch

MathJSON `AsOklch` · `(color | string | tuple) -> color`

Convert any color to OKLCh

### asRgb

MathJSON `AsRgb` · `(color | string | tuple) -> color`

Convert any color to sRGB (channels 0-1)

### color

MathJSON `Color` · `(string) -> color`

Parse a CSS-style color string to an Oklch color

### colorContrast

MathJSON `ColorContrast` · `(color | string | tuple, color | string | tuple) -> number`

APCA contrast ratio between two colors

### colorDelta

MathJSON `ColorDelta` · `(color | string | tuple, color | string | tuple) -> number`

Perceptual color difference (ΔE_OK) between two colors

### colorFromColorspace

MathJSON `ColorFromColorspace` · `(color | tuple, string) -> color`

Build a color from channel values in a named color space. The result is a color on every route — the color head of the named space when evaluated, the target's color value when compiled. To read the channels back out, call ColorToColorspace(color, space)

### colorMix

MathJSON `ColorMix` · `(color | string | tuple, color | string | tuple, number?) -> color`

Mix two colors in OKLCh space

### colorToColorspace

MathJSON `ColorToColorspace` · `(color | string | tuple, string) -> tuple`

Convert a color to components in a target color space

### colorToString

MathJSON `ColorToString` · `(color | string | tuple, string?) -> string`

Convert a color to a string in the specified format: "hex" (the default), "rgb", "hsl", "oklch", "srgb" (the same as "hex") or "display-p3" (the CSS spelling `color(display-p3 r g b)`). The hex, rgb, hsl and srgb formats map the color into the sRGB gamut, and display-p3 maps it into the Display-P3 gamut, with the CSS Color 4 gamut mapping: the OKLCh chroma is reduced at constant lightness and hue. The channels are not clipped one by one. The oklch format has no gamut and is not mapped

### colormap

MathJSON `Colormap` · `(string, number?) -> color | list<color>`

Sample colors from a named palette

### contrastingColor

MathJSON `ContrastingColor` · `(color | string | tuple, (color | string | tuple)?, (color | string | tuple)?) -> color`

Choose the foreground color with better APCA contrast against a background, answered as given: the interpreter keeps the color head the candidate was written with, and a compiled target answers the same color in its canonical form

### gamutMap

MathJSON `GamutMap` · `(color | string | tuple, string?) -> color`

Map a color into a target gamut, "srgb" (the default) or "display-p3", with the CSS Color 4 gamut-mapping algorithm: the OKLCh chroma is reduced, at constant lightness and hue, until the color is inside the gamut or until clipping each channel changes the color by less than a just noticeable difference (ΔE_OK 0.02). A lightness of 1 or more gives white, and 0 or less gives black. A color already inside the gamut is returned unchanged. The result is an Rgb color, in sRGB coordinates also for "display-p3": its channels are in [0, 1] for "srgb", and for "display-p3" they can be outside [0, 1] (extended sRGB) for a color that is inside the Display-P3 gamut but outside the sRGB gamut. Color values themselves have no gamut: only this operator and the string output map a color

### hsl

MathJSON `Hsl` · `(number, number, number, number?) -> color`

HSL color (hue degrees, saturation/lightness 0-1, optional alpha)

### hsv

MathJSON `Hsv` · `(number, number, number, number?) -> color`

HSV color (hue degrees, saturation/value 0-1, optional alpha)

### oklab

MathJSON `Oklab` · `(number, number, number, number?) -> color`

OKLab color (L 0-1, a/b ~ -0.4..0.4, optional alpha)

### oklch

MathJSON `Oklch` · `(number, number, number, number?) -> color`

OKLCh color (L 0-1, C 0-~0.4, hue degrees, optional alpha)

### rgb

MathJSON `Rgb` · `(number, number, number, number?) -> color`

sRGB color (channels 0-1, optional alpha 0-1)
