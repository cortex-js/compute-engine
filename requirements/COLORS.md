# Colors

Add color handling functions to MathJSON.

## Canonical Representation

The canonical representation of a color in the Compute Engine is a `Tuple` of
real numbers in the sRGB colorspace, normalized to the **0–1** range:

```json
["Tuple", 0.92, 0.42, 0.07]
["Tuple", 0.92, 0.42, 0.07, 0.5]
```

- 3 components → `(r, g, b)` with implicit `a = 1`
- 4 components → `(r, g, b, a)`
- Components **may exceed 1.0** to represent out-of-gamut colors (e.g. colors
  valid in Display-P3 but outside sRGB).

A color tuple is always returned from `Color`, `Colormap`, and
`ColorFromColorspace`. Other functions that accept a color input accept either a
canonical tuple **or** any string/value parseable by `Color`.

**Implementation note**: the directory `src/color/` contains color utilities,
reference color values, and palettes.

---

## Color Spaces

Four color spaces are used. **sRGB** is the canonical storage format; all others
are conversion targets/sources.

| Color space | Components                                          | Ranges                                 | Role                                                                                                                                                  |
| ----------- | --------------------------------------------------- | -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| **sRGB**    | `r`, `g`, `b`                                       | 0–1 each (may exceed 1 for wide-gamut) | Canonical. Every color-returning function produces sRGB tuples.                                                                                       |
| **OKLCh**   | `L` (lightness), `C` (chroma), `h` (hue)            | L: 0–1, C: 0–0.4, h: 0–360°            | Perceptually uniform cylindrical space. Used for all interpolation, gamut mapping, and lightness/chroma manipulation.                                 |
| **OKLab**   | `L` (lightness), `a` (green–red), `b` (blue–yellow) | L: 0–1, a: −0.4–0.4, b: −0.4–0.4       | Perceptually uniform rectangular space. OKLCh is its cylindrical form. Useful for computing color differences (ΔE). Accepted as `"oklab"` or `"lab"`. |
| **HSL**     | `h` (hue), `s` (saturation), `l` (lightness)        | h: 0–360°, s: 0–1, l: 0–1              | Legacy CSS color space. Familiar to web developers. Not perceptually uniform.                                                                         |

### Why OKLCh for interpolation?

sRGB interpolation produces muddy, desaturated midpoints (e.g. red→green passes
through brown). OKLCh is perceptually uniform: equal numeric steps correspond to
equal perceived differences, and hue/chroma/lightness can be controlled
independently. The `src/color/` implementation uses OKLCh for all palette
interpolation, gamut mapping (binary-search chroma reduction preserving hue),
and lightness adjustments.

### Gamut mapping

When converting from OKLCh or OKLab back to sRGB, colors may fall outside the
sRGB gamut. The implementation reduces chroma while preserving hue and lightness
using a binary-search algorithm (~12 iterations, precision ~10⁻⁹) until the
color fits within [0, 1] per component.

### Conversion graph

```
HSL ⟷ sRGB ⟷ OKLab ⟷ OKLCh
```

Full bidirectional conversion exists between all four spaces, with sRGB as the
hub. Conversions between non-adjacent spaces go through sRGB (e.g. HSL → sRGB →
OKLab).

**Implementation note**: `hslToRgb` exists in `src/color/manipulation.ts`.
`rgbToHsl` needs to be added for the reverse direction.

---

## Functions

### `Color`

Convert a string or numeric input into a canonical sRGB tuple.

```
Color(input: string) -> Tuple<real, real, real> | Tuple<real, real, real, real>
```

#### Accepted input formats

| Format             | Example                      | Notes                                           |
| ------------------ | ---------------------------- | ----------------------------------------------- |
| Hex (3 digits)     | `"#f2c"`                     | Expanded to `#ff22cc`                           |
| Hex (6 digits)     | `"#fedaca"`                  |                                                 |
| Hex (8 digits)     | `"#fedacaff"`                | Last two digits are alpha                       |
| `rgb()` / `rgba()` | `"rgb(255, 100, 20)"`        | Values 0–255; values ≤ 1.0 treated as fractions |
| `rgb()` modern     | `"rgb(255 100 20 / 0.5)"`    | Space-separated, slash-alpha                    |
| `rgb()` percent    | `"rgb(50%, 25%, 10%)"`       | Percentages                                     |
| `hsl()` / `hsla()` | `"hsl(210, 80%, 50%)"`       | H: 0–360°, S/L: 0–100%                          |
| `oklch()`          | `"oklch(0.7 0.15 210)"`      | L: 0–1, C: 0–0.4, H: 0–360°                     |
| Named color        | `"red"`, `"teal"`, `"white"` | See named colors table                          |
| `"transparent"`    | `"transparent"`              | Returns `(0, 0, 0, 0)`                          |

#### Named colors

16 named colors from the Chromatic design scale:

`red`, `orange`, `yellow`, `lime`, `green`, `teal`, `cyan`, `blue`, `indigo`,
`purple`, `magenta`, `black`, `dark-grey`, `grey`, `light-grey`, `white`

#### Examples

```
Color("#fedaca")            → ["Tuple", 0.996, 0.855, 0.792]
Color("rgb(255, 0, 0)")     → ["Tuple", 1, 0, 0]
Color("hsl(210, 80%, 50%)") → ["Tuple", 0.1, 0.5, 0.9]
Color("red")                → ["Tuple", 0.843, 0.09, 0.043]
Color("transparent")        → ["Tuple", 0, 0, 0, 0]
```

#### Edge cases

- Invalid or unrecognized input: return `["Error", "'incompatible-type'"]`
- Alpha of exactly 1: omit from output (3-component tuple)

---

### `Colormap`

Sample colors from a named palette. Three calling conventions depending on the
second argument:

#### Variant 1: Full palette

```
Colormap(name: string) -> List<Tuple>
```

Return every color stop in the named palette as a list of canonical tuples.

```
Colormap("viridis")  → [["Tuple", 0.267, 0.004, 0.329], …, ["Tuple", 0.993, 0.906, 0.144]]
```

#### Variant 2: Resample to _n_ colors

```
Colormap(name: string, n: integer) -> List<Tuple>
```

Return _n_ evenly-spaced colors interpolated from the palette. `n` must be ≥ 2.

```
Colormap("viridis", 5)  → list of 5 interpolated colors
```

#### Variant 3: Sample at position _t_

```
Colormap(name: string, t: real) -> Tuple
```

Return a **single** color at position _t_ ∈ [0, 1] along the palette.
Interpolation is between the two adjacent color stops bracketing _t_, not simply
between the first and last entry.

```
Colormap("viridis", 0.0)  → first color in palette
Colormap("viridis", 1.0)  → last color in palette
Colormap("viridis", 0.25) → interpolated color at 25%
```

#### Interpolation

All color interpolation is performed in the **OKLCh** color space (not sRGB) to
ensure perceptual uniformity. Hue interpolation uses the shorter arc.

#### Available palettes

**Sequential** (256-stop, perceptually uniform): `turbo`, `inferno`, `magma`,
`plasma`, `viridis`, `cividis`, `rocket`, `mako`

Each sequential palette also has a `-reversed` variant (e.g.
`viridis-reversed`).

**Sequential (short)**: `grey` (18 stops)

**Categorical** (discrete, not meaningful to interpolate between): `tycho11`
(11), `tableau10` (10), `kelly22` (22), `graph6` (6), `spectrum12` (12)

**Diverging** (symmetric around a neutral midpoint): `roma` (261), `vik` (9),
`broc` (9), `rdbu` (21), `coolwarm` (21), `ocean-balance` (22)

Each diverging palette also has a `-reversed` variant.

#### Edge cases

- Unknown palette name: return `["Error", "'expected-value'", <name>]`
- `n < 2` for integer variant: return `["Error", "'expected-value'", <n>]`
- `t` outside [0, 1]: clamp to [0, 1]
- Categorical palettes: variants 2 and 3 still work (interpolation between
  discrete stops) but the results may not be perceptually meaningful. No warning
  is emitted.

---

### `ColorToColorspace`

Convert a color to component values in a target color space.

```
ColorToColorspace(color, colorspace: string) -> Tuple
```

The first argument may be a canonical RGB tuple or any value accepted by
`Color`.

#### Supported color spaces

| Name                 | Components  | Ranges                           |
| -------------------- | ----------- | -------------------------------- |
| `"rgb"`              | `(r, g, b)` | 0–1 each (sRGB)                  |
| `"hsl"`              | `(h, s, l)` | h: 0–360, s: 0–1, l: 0–1         |
| `"oklch"`            | `(L, C, h)` | L: 0–1, C: 0–0.4, h: 0–360       |
| `"oklab"` or `"lab"` | `(L, a, b)` | L: 0–1, a: −0.4–0.4, b: −0.4–0.4 |

Alpha, if present and ≠ 1, is appended as a fourth component in every case.

#### Examples

```
ColorToColorspace("red", "hsl")    → ["Tuple", 4.65, 0.92, 0.44]
ColorToColorspace("red", "oklch")  → ["Tuple", 0.628, 0.258, 29.23]
ColorToColorspace(["Tuple", 1, 0, 0], "lab") → ["Tuple", 0.628, 0.225, 0.126]
ColorToColorspace("red", "rgb")    → ["Tuple", 0.843, 0.09, 0.043]
```

---

### `ColorFromColorspace`

Convert component values in a given color space back to a canonical sRGB tuple.

```
ColorFromColorspace(components: Tuple, colorspace: string) -> Tuple
```

The same color space names as `ColorToColorspace` are accepted (`"rgb"`,
`"hsl"`, `"oklch"`, `"oklab"` / `"lab"`). If the input color is outside the sRGB
gamut, chroma is reduced (in OKLCh) while preserving hue until the color fits,
using a binary-search gamut-mapping algorithm (see Color Spaces section).

#### Examples

```
ColorFromColorspace(["Tuple", 210, 0.8, 0.5], "hsl")
    → ["Tuple", 0.1, 0.5, 0.9]

ColorFromColorspace(["Tuple", 0.7, 0.15, 210], "oklch")
    → ["Tuple", 0.078, 0.522, 0.847]

ColorFromColorspace(["Tuple", 0.628, 0.225, 0.126], "lab")
    → ["Tuple", 0.843, 0.09, 0.043]
```

---

## Future Considerations

The following are **not** part of the initial implementation but may be added
later:

- **`Lighten(color, amount)`** / **`Darken(color, amount)`**: Adjust lightness
  in OKLCh. Utilities already exist in `src/color/manipulation.ts`.

- **`ContrastRatio(bg, fg)`**: Return the APCA contrast value between two
  colors. Already implemented as `apca()` in `src/color/contrast.ts`.

- **`ColorScale(color)`**: Generate an 11-stop tonal scale (50–900) from a
  single input color. Already implemented as `scale()` in `src/color/scale.ts`.

- **`ColorDistance(a, b)`**: Perceptual distance (ΔE in OKLab) between two
  colors.

- **`ContrastingColor(bg)`**: Return black or white, whichever has better
  contrast against `bg`. Already implemented in `src/color/contrast.ts`.

---

## Library Integration

Colors are registered as a standard library named `"colors"` in the library
system:

- **Requires**: `"core"`
- **File**: `src/compute-engine/library/colors.ts`
- **Library category**: add `"colors"` to `LibraryCategory`
- **No LaTeX dictionary**: color functions are not typically written in LaTeX
  math notation

The library is included in the default set of standard libraries loaded by
`ComputeEngine`.
