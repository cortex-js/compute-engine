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

- argument 1 — The color: a color head, a CSS color string or a tuple of sRGB channels in [0, 1]; a list of colors gives a list. Sample: `rgb(1, 0.5, 0)`.

Convert any color to HSL (hue degrees, s/l 0-1)

```epsil
asHsl(rgb(1, 0.5, 0))
// ➔ Hsl(30, 1, 0.5)
```

### asHsv

MathJSON `AsHsv` · `(color | string | tuple) -> color`

- argument 1 — The color: a color head, a CSS color string or a tuple of sRGB channels in [0, 1]; a list of colors gives a list. Sample: `rgb(1, 0.5, 0)`.

Convert any color to HSV (hue degrees, s/v 0-1)

```epsil
asHsv(rgb(1, 0.5, 0))
// ➔ Hsv(30, 1, 1)
```

### asOklab

MathJSON `AsOklab` · `(color | string | tuple) -> color`

- argument 1 — The color: a color head, a CSS color string or a tuple of sRGB channels in [0, 1]; a list of colors gives a list. Sample: `oklch(0.7, 0.15, 30)`.

Convert any color to OKLab

```epsil
asOklab(oklch(0.7, 0.15, 30))
// ➔ Oklab(0.7, 0.1299038105676658, 0.07499999999999998)
```

### asOklch

MathJSON `AsOklch` · `(color | string | tuple) -> color`

- argument 1 — The color: a color head, a CSS color string or a tuple of sRGB channels in [0, 1]; a list of colors gives a list. Sample: `oklab(0.7, 0.1, 0.1)`.

Convert any color to OKLCh

```epsil
asOklch(oklab(0.7, 0.1, 0.1))
// ➔ Oklch(0.7, 0.14142135623730953, 45)
```

```epsil
asOklch(rgb(1, 0, 0))
// ➔ Oklch(0.6279553606145515, 0.25768330773615683, 29.2338851923426)
```

### asRgb

MathJSON `AsRgb` · `(color | string | tuple) -> color`

- argument 1 — The color: a color head, a CSS color string or a tuple of sRGB channels in [0, 1]; a list of colors gives a list. Sample: `hsl(120, 1, 0.5)`.

Convert any color to sRGB (channels 0-1)

```epsil
asRgb(hsl(120, 1, 0.5))
// ➔ Rgb(0, 1, 0)
```

```epsil
asRgb("#ff8000")
// ➔ Rgb(1, 0.5019607843137255, 0)
```

### color

MathJSON `Color` · `(string) -> color`

- argument 1 — A CSS color: a hex code, an `rgb()`, `hsl()`, `oklch()` or `oklab()` spelling, or a color name; a string that is not a color is an `incompatible-type` error. Sample: `"#ff8000"`.

Parse a CSS-style color string to an Oklch color

```epsil
color("#ff8000")
// ➔ Oklch(0.7318948427227372, 0.18580321563064012, 52.984679593971265)
```

```epsil
color("hsl(120 100% 50%)")
// ➔ Oklch(0.8664396115356694, 0.2948272403370167, 142.49533888780996)
```

### colorContrast

MathJSON `ColorContrast` · `(background: color | string | tuple, foreground: color | string | tuple) -> number`

- `background` — The background color: a color head, a CSS color string or a tuple of sRGB channels in [0, 1]; APCA is not symmetric, so dark text on a light background gives a positive contrast and light text on a dark one a negative contrast. Sample: `"#ffffff"`.
- `foreground` — The text color, in the same spellings. Sample: `"#000000"`.

APCA contrast ratio between two colors

```epsil
colorContrast("#ffffff", "#000000")
// ➔ 1.0604067321268862
```

```epsil
colorContrast("#000000", "#ffffff")
// ➔ -1.0788473318309848
```

### colorDelta

MathJSON `ColorDelta` · `(color | string | tuple, color | string | tuple) -> number`

- argument 1 — The first color: a color head, a CSS color string or a tuple of sRGB channels in [0, 1]. Sample: `rgb(1, 0, 0)`.
- argument 2 — The second color; the result is 0 for the same color and about 1 between white and black. Sample: `rgb(0.9, 0, 0)`.

Perceptual color difference (ΔE_OK) between two colors

```epsil
colorDelta(rgb(1, 0, 0), rgb(0.9, 0, 0))
// ➔ 0.05197810440998347
```

```epsil
colorDelta("#ffffff", "#000000")
// ➔ 0.9999999934735466
```

### colorFromColorspace

MathJSON `ColorFromColorspace` · `(channels: color | tuple, space: string) -> color`

- `channels` — Three channel values in the order of the space, and an optional alpha in [0, 1]; the channels of a color head are read as they are, ignoring its own space. Sample: `(120, 1, 0.5)`.
- `space` — The color space of the channels: "rgb", "hsl", "hsv", "oklab" (or "lab") or "oklch", in any case; another name is an `expected-value` error. Sample: `"hsl"`.

Build a color from channel values in a named color space. The result is a color on every route — the color head of the named space when evaluated, the target's color value when compiled. To read the channels back out, call ColorToColorspace(color, space)

```epsil
colorFromColorspace((120, 1, 0.5), "hsl")
// ➔ Hsl(120, 1, 0.5)
```

```epsil
colorFromColorspace((0.7, 0.15, 30, 0.5), "oklch")
// ➔ Oklch(0.7, 0.15, 30, 0.5)
```

### colorMix

MathJSON `ColorMix` · `(a: color | string | tuple, b: color | string | tuple, ratio: number?) -> color`

- `a` — The first color: a color head, a CSS color string or a tuple of sRGB channels in [0, 1]. Sample: `"#ff0000"`.
- `b` — The second color, in the same spellings. Sample: `"#0000ff"`.
- `ratio` — The weight of the second color, from 0 (the first color) to 1 (the second color), clamped into that range; 0.5 when omitted. Sample: `0.25`.

Mix two colors in OKLCh space

```epsil
colorMix("#ff0000", "#0000ff")
// ➔ Oklch(0.5399845394999472, 0.28544883970037904, 326.6429529151988)
```

```epsil
colorMix("#ff0000", "#0000ff", 0.25)
// ➔ Oklch(0.5839699500572493, 0.2715660737182679, 357.9384190537707)
```

### colorToColorspace

MathJSON `ColorToColorspace` · `(color: color | string | tuple, space: string) -> tuple`

- `color` — The color: a color head, a CSS color string or a tuple of sRGB channels in [0, 1]. Sample: `rgb(1, 0.5, 0)`.
- `space` — The target color space: "rgb", "hsl", "hsv", "oklab" (or "lab") or "oklch", in any case; another name is an `expected-value` error. Sample: `"hsl"`.

Convert a color to components in a target color space

```epsil
colorToColorspace(rgb(1, 0.5, 0), "hsl")
// ➔ (30, 1, 0.5)
```

```epsil
colorToColorspace(oklab(0.7, 0.1, 0.1), "oklch")
// ➔ (0.7, 0.14142135623730953, 45)
```

### colorToString

MathJSON `ColorToString` · `(color: color | string | tuple, format: string?) -> string`

- `color` — The color: a color head, a CSS color string or a tuple of sRGB channels in [0, 1]. Sample: `rgb(1, 0.5, 0)`.
- `format` — The output format, "hex" when omitted: "hex", "rgb", "hsl", "oklch", "srgb" or "display-p3", in any case; another name is an `expected-value` error. Sample: `"hsl"`.

Convert a color to a string in the specified format: "hex" (the default), "rgb", "hsl", "oklch", "srgb" (the same as "hex") or "display-p3" (the CSS spelling `color(display-p3 r g b)`). The hex, rgb, hsl and srgb formats map the color into the sRGB gamut, and display-p3 maps it into the Display-P3 gamut, with the CSS Color 4 gamut mapping: the OKLCh chroma is reduced at constant lightness and hue. The channels are not clipped one by one. The oklch format has no gamut and is not mapped

```epsil
colorToString(rgb(1, 0.5, 0))
// ➔ "#ff8000"
```

```epsil
colorToString(oklch(0.7, 0.15, 30), "oklch")
// ➔ "oklch(0.7 0.15 30)"
```

### colormap

MathJSON `Colormap` · `(string, number?) -> color | list<color>`

- argument 1 — The name of the palette, such as "viridis", "tableau10" or "tycho11"; an unknown name is an `expected-value` error. Sample: `"viridis"`.
- argument 2 — An integer n from 2 to 10000 gives a list of n colors (a larger n stays unevaluated); any other number is a position in [0, 1], clamped, and gives one color (1 is the last color, not a count). Sample: `0.5`.

Sample colors from a named palette. With no second argument, the colors of the palette. With an integer n &gt;= 2, a list of n colors. With a number t in [0, 1] (clamped), the color at position t. A sequential or diverging palette is a gradient: n gives n evenly spaced samples, and t an interpolated color. A categorical palette (such as "tycho11" or "tableau10") is a list of distinct colors and is never interpolated: n gives its first n colors, repeated from the start past the length of the palette, and t the nearest color, the color at index round(t × (length − 1))

```epsil
colormap("viridis", 0.5)
// ➔ Oklch(0.5953489984141304, 0.09460305103214128, 191.23555350205825)
```

```epsil
colormap("tableau10", 3)
// ➔ [Oklch(0.5492406836799802, 0.12380974317992, 244.60325596315428),Oklch(0.7306522245131786, 0.18510803457288688, 51.88404768505323),Oklch(0.6192883551551218, 0.18397372537450857, 142.94995785173705)]
```

### contrastingColor

MathJSON `ContrastingColor` · `(background: color | string | tuple, a: (color | string | tuple)?, b: (color | string | tuple)?) -> color`

- `background` — The background color: a color head, a CSS color string or a tuple of sRGB channels in [0, 1]. Sample: `"#000080"`.
- `a` — The first candidate foreground color; it is used only with `b`, and without both candidates the result is white or black. Sample: `"#ffd700"`.
- `b` — The second candidate foreground color; on equal contrast the first candidate wins. Sample: `"#800080"`.

Choose the foreground color with better APCA contrast against a background, answered as given: the interpreter keeps the color head the candidate was written with, and a compiled target answers the same color in its canonical form

```epsil
contrastingColor("#000080")
// ➔ Rgb(1, 1, 1)
```

```epsil
contrastingColor("#000080", "#ffd700", "#800080")
// ➔ Rgb(1, 0.8431372549019608, 0)
```

### gamutMap

MathJSON `GamutMap` · `(color: color | string | tuple, gamut: string?) -> color`

- `color` — The color to map: a color head, a CSS color string or a tuple of sRGB channels in [0, 1]. Sample: `oklch(0.7, 0.4, 30)`.
- `gamut` — The target gamut, "srgb" when omitted, or "display-p3", in any case; another name is an `expected-value` error. Sample: `"display-p3"`.

Map a color into a target gamut, "srgb" (the default) or "display-p3", with the CSS Color 4 gamut-mapping algorithm: the OKLCh chroma is reduced, at constant lightness and hue, until the color is inside the gamut or until clipping each channel changes the color by less than a just noticeable difference (ΔE_OK 0.02). A lightness of 1 or more gives white, and 0 or less gives black. A color already inside the gamut is returned unchanged. The result is an Rgb color, in sRGB coordinates also for "display-p3": its channels are in [0, 1] for "srgb", and for "display-p3" they can be outside [0, 1] (extended sRGB) for a color that is inside the Display-P3 gamut but outside the sRGB gamut. Color values themselves have no gamut: only this operator and the string output map a color

```epsil
gamutMap(oklch(0.7, 0.4, 30))
// ➔ Rgb(1, 0.3451350864103807, 0.26457522622474827)
```

```epsil
gamutMap(oklch(0.7, 0.4, 30), "display-p3")
// ➔ Rgb(1.0872362010596204, 0.17872507792896167, 0.09415278671783497)
```

### hsl

MathJSON `Hsl` · `(h: number, s: number, l: number, alpha: number?) -> color`

- `h` — The hue, in degrees, read modulo 360. Sample: `120`.
- `s` — The saturation, from 0 to 1; a value outside is clamped. Sample: `1`.
- `l` — The lightness, from 0 (black) to 1 (white); a value outside is clamped. Sample: `0.5`.
- `alpha` — The opacity, from 0 (transparent) to 1 (opaque, the default). Sample: `0.5`.

HSL color (hue degrees, saturation/lightness 0-1, optional alpha)

```epsil
asRgb(hsl(120, 1, 0.5))
// ➔ Rgb(0, 1, 0)
```

### hsv

MathJSON `Hsv` · `(h: number, s: number, v: number, alpha: number?) -> color`

- `h` — The hue, in degrees, read modulo 360. Sample: `30`.
- `s` — The saturation, from 0 to 1; a value outside is clamped. Sample: `1`.
- `v` — The value (brightness), from 0 to 1; a value outside is clamped. Sample: `1`.
- `alpha` — The opacity, from 0 (transparent) to 1 (opaque, the default). Sample: `0.5`.

HSV color (hue degrees, saturation/value 0-1, optional alpha)

```epsil
asRgb(hsv(30, 1, 1))
// ➔ Rgb(1, 0.5, 0)
```

### oklab

MathJSON `Oklab` · `(l: number, a: number, b: number, alpha: number?) -> color`

- `l` — The perceptual lightness, from 0 (black) to 1 (white). Sample: `0.7`.
- `a` — The green-red axis, about -0.4 (green) to 0.4 (red). Sample: `0.1`.
- `b` — The blue-yellow axis, about -0.4 (blue) to 0.4 (yellow). Sample: `0.1`.
- `alpha` — The opacity, from 0 (transparent) to 1 (opaque, the default). Sample: `0.5`.

OKLab color (L 0-1, a/b ~ -0.4..0.4, optional alpha)

```epsil
asOklch(oklab(0.7, 0.1, 0.1))
// ➔ Oklch(0.7, 0.14142135623730953, 45)
```

### oklch

MathJSON `Oklch` · `(l: number, c: number, h: number, alpha: number?) -> color`

- `l` — The perceptual lightness, from 0 (black) to 1 (white). Sample: `0.7`.
- `c` — The chroma, from 0 (gray) to about 0.4. Sample: `0.15`.
- `h` — The hue angle, in degrees. Sample: `30`.
- `alpha` — The opacity, from 0 (transparent) to 1 (opaque, the default). Sample: `0.5`.

OKLCh color (L 0-1, C 0-~0.4, hue degrees, optional alpha)

```epsil
colorToString(oklch(0.7, 0.15, 30))
// ➔ "#ed7665"
```

### rgb

MathJSON `Rgb` · `(r: number, g: number, b: number, alpha: number?) -> color`

- `r` — The red channel, from 0 to 1; a value outside [0, 1] is extended sRGB and is kept. Sample: `1`.
- `g` — The green channel, from 0 to 1. Sample: `0.5`.
- `b` — The blue channel, from 0 to 1. Sample: `0`.
- `alpha` — The opacity, from 0 (transparent) to 1 (opaque, the default). Sample: `0.5`.

sRGB color (channels 0-1, optional alpha 0-1)

```epsil
rgb(1, 0.5, 0)
// ➔ Rgb(1, 0.5, 0)
```

```epsil
colorToString(rgb(1, 0.5, 0, 0.5))
// ➔ "#ff800080"
```
