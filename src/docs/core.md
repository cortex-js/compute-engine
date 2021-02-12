## `Missing`

This symbol is used then a required expression is not present.

| MathJSON                   | Latex                      |
| :------------------------- | :------------------------- |
| `["Divide", 2, "Missing"]` | `\frac{2}{\placeholder{}}` |

## `Nothing`

This symbol is used then an optional expression is not present.

| MathJSON                    | Latex                  |
| :-------------------------- | :--------------------- |
| `["List", 2, "Nothing", 3]` | `\lrback 2,,3 \rbrack` |

## `Identity`

The identity function, i.e. its value is its argument.

| MathJSON            | Latex                  |
| :------------------ | :--------------------- |
| `["Identity", "x"]` | `\operatorname{id}(x)` |
| `"Identity"`        | `\operatorname{id}`    |

## `InverseFunction`

The inverse function.

| MathJSON                     | Latex       |
| :--------------------------- | :---------- |
| `["InverseFunction", "Sin"]` | `\sin^{-1}` |

## `Latex`

`["Latex", `_`token-1`_`, `_`token-2`_`, ...`_`token-n`_`]`

- _token-n_: one or more expressions that are serialized and concatenated as  
  Latex tokens. A Latex token is one of:
  - `<{>`: begin group
  - `<}>`: end group
  - `<space>`: blank space
  - `<$$>`: display mode shift
  - `<$>`: inline mode shift
  - `#0`-`#9`: argument
  - `#?`: placeholder
  - `\` + string: a command
  - other: literal

See: [TeX:289](http://tug.org/texlive/devsrc/Build/source/texk/web2c/tex.web)

| MathJSON                                                    | Latex           |
| :---------------------------------------------------------- | :-------------- |
| `["Latex", "\frac", "<{>", "\pi","<}>", "<{>", "2", "<}>"]` | `\frac{\pi}{2}` |

## `Piecewise`

## `Prime`

| MathJSON            | Latex            |
| :------------------ | :--------------- |
| `["Prime", "f"]`    | `f^\prime`       |
| `["Prime", "f", 2]` | `f^\doubleprime` |

## `Subminus`

| MathJSON            | Latex |
| :------------------ | :---- |
| `["Subminus", "x"]` | `x_-` |

## `Subplus`

| MathJSON           | Latex |
| :----------------- | :---- |
| `["Subplus", "x"]` | `x_+` |

## `Subscript`

## `Substar`

| MathJSON           | Latex |
| :----------------- | :---- |
| `["Substar", "x"]` | `x_*` |

## `Superdagger`

| MathJSON               | Latex       |
| :--------------------- | :---------- |
| `["Superdagger", "x"]` | `x^\dagger` |

## `Superminus`

| MathJSON              | Latex |
| :-------------------- | :---- |
| `["Superminus", "x"]` | `x^-` |

## `Superplus`

| MathJSON             | Latex |
| :------------------- | :---- |
| `["Superplus", "x"]` | `x^+` |

## `Superstar`

When the argument is a complex number, indicate the conjugate.

| MathJSON             | Latex |
| :------------------- | :---- |
| `["Superplus", "x"]` | `x^*` |
