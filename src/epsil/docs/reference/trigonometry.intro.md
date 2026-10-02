The **trigonometry** library holds the constant `pi`, the conversions of
angles, the circular and hyperbolic functions with their inverses, the
cardinal sine and the trigonometric integrals, and three functions that
rewrite trigonometric expressions. This introduction gives the concepts you
need before you read the entries.

## The functions

Each circular function has an inverse, a hyperbolic form, and an inverse
hyperbolic form. The inverse hyperbolic functions use the ISO 80000-2 names:
`arsinh`, not `arcsinh`. The prefix "ar" stands for "area".

| Function | Inverse                | Hyperbolic | Inverse hyperbolic |
| :------- | :--------------------- | :--------- | :----------------- |
| `sin`    | `arcsin`               | `sinh`     | `arsinh`           |
| `cos`    | `arccos`               | `cosh`     | `arcosh`           |
| `tan`    | `arctan`, `arctan2`    | `tanh`     | `artanh`           |
| `cot`    | `arccot`               | `coth`     | `arcoth`           |
| `sec`    | `arcsec`               | `sech`     | `arsech`           |
| `csc`    | `arccsc`               | `csch`     | `arcsch`           |

The functions apply to each element of a list:

```epsil
sin([0, pi / 6, pi / 2])
// ➔ [0, 1/2, 1]
```

## Angles

The argument of a circular function is an angle in radians. `degrees(d)`
converts an angle in degrees to radians, and `dms(d, m, s)` converts an angle
in degrees, minutes and seconds. Both conversions are exact when their
arguments are exact.

```epsil
[degrees(180), degrees(45), dms(12, 30)]
// ➔ [pi, 1/4 * pi, 5/72 * pi]
```

```epsil
sin(degrees(30))
// ➔ 1/2
```

## Exact values and numeric values

When the argument is exact, the result is exact. If the value at the argument
is known in closed form, the function returns that value. The closed form can
contain square roots:

```epsil
[sin(pi / 6), cos(5pi / 4), tan(pi / 12)]
// ➔ [1/2, -sqrt(2)/2, 2 - sqrt(3)]
```

If no closed form is known, the result stays symbolic. `N` gives a numeric
value:

```epsil
[sin(1), N(sin(1))]
// ➔ [sin(1), 0.841470984807896506653]
```

When the argument is a floating-point number, the result is a floating-point
number:

```epsil
sin(1.2)
// ➔ 0.93203908596722634967
```

At a pole, the value is the complex infinity `~oo`:

```epsil
[tan(pi / 2), sec(pi / 2), cot(0)]
// ➔ [~oo, ~oo, ~oo]
```

## The inverse functions and their ranges

An inverse function returns the principal value. The principal value is in
the range that this table shows.

| Function         | Range of the principal value     |
| :--------------- | :------------------------------- |
| `arcsin`         | from `-pi/2` to `pi/2`           |
| `arccos`         | from `0` to `pi`                 |
| `arctan`         | between `-pi/2` and `pi/2`       |
| `arccot`         | between `0` and `pi`             |
| `arcsec`         | from `0` to `pi`, not `pi/2`     |
| `arccsc`         | from `-pi/2` to `pi/2`, not `0`  |
| `arctan2(y, x)`  | between `-pi` and `pi`, `pi` included |

```epsil
[arcsin(1), arccos(-1), arctan(-1), arcsec(-2), arccsc(-2)]
// ➔ [1/2 * pi, pi, -1/4 * pi, 2/3 * pi, -1/6 * pi]
```

The range of `arccot` is between `0` and `pi`. Thus a negative argument gives
an angle between `pi/2` and `pi`:

```epsil
N([arccot(1), arccot(-1)])
// ➔ [0.785398163397448309616, 2.35619449019234492885]
```

`arctan2(y, x)` is the angle of the point `(x, y)`. The first argument is the
`y` coordinate. The function uses the signs of both coordinates to find the
quadrant:

```epsil
[arctan2(1, 1), arctan2(1, -1), arctan2(-1, -1), arctan2(0, -1)]
// ➔ [1/4 * pi, 3/4 * pi, -3/4 * pi, pi]
```

When the argument is exact and no real value exists, the result stays
symbolic. `N` then gives the complex principal value:

```epsil
[arcsin(2), N(arcsin(2))]
// ➔ [arcsin(2), (1.57079632679489661923 - 1.31695789692481670863i)]
```

`inverseFunction` returns the inverse of a function:

```epsil
[inverseFunction(sin), inverseFunction(cosh)]
// ➔ [arcsin, arcosh]
```

## Trigonometric transformations

Three functions rewrite a trigonometric or hyperbolic expression. They keep
exact values exact.

`trigExpand` expands a function of a sum, or of an integer multiple of an
angle:

```epsil
trigExpand(sin(a + b))
// ➔ sin(b) * cos(a) + sin(a) * cos(b)
```

```epsil
trigExpand(cos(2x))
// ➔ -sin(x)^2 + cos(x)^2
```

`trigReduce` does the opposite operation. It changes products and integer
powers into a sum of functions of multiple angles:

```epsil
trigReduce(cos(x)^3)
// ➔ 1/4 * cos(3x) + 3/4 * cos(x)
```

`trigToExp` writes the functions with the complex exponential:

```epsil
trigToExp(cosh(x))
// ➔ 1/2 * (e^x + e^(-x))
```

`simplify` uses the trigonometric identities, for example the Pythagorean
identities and the double-angle formulas:

```epsil
simplify(sin(x)^2 + cos(x)^2)
// ➔ 1
```

```epsil
simplify(1 + tan(x)^2)
// ➔ sec(x)^2
```
