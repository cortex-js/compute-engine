---
title: Units Reference
sidebar_label: Units
slug: /epsil/reference/units/
description: "The units library of Epsil: every definition with its Epsil spelling, MathJSON name, signature, and full description."
hide_title: true
date: Last Modified
# GENERATED FILE — do not edit. The entries come from the library
# definitions (src/compute-engine/library/) as `epsil doc` describes them;
# the introduction comes from units.intro.md when that file exists.
# Regenerate with `npm run doc` (scripts/build-library-reference.ts).
---
# Units

The **units** library holds quantities (a value with a physical unit) and
the functions that convert, compare and inspect units. This introduction
gives the concepts you need before you read the entries.

## Writing a unit

A unit is a name such as `m`, `km` or `h`, or a product, quotient or power
of names. Each unit operand of `quantity`, `unitConvert`, `isCompatibleUnit`
and `unitDimension` also accepts a string, which is read as a unit:
`"km/h"`, `"m/s^2"`, `"kg*m"`.

```epsil
unitConvert(quantity(36, "km/h"), "m/s")
// ➔ 10 m/s
```

Write a unit as a string when its name is also the name of a function, such
as `min` (minute) or `lb` (pound): a bare `min` is the function `min`, not
the unit.

```epsil
unitConvert(quantity(2, h), "min")
// ➔ 120 min
```

Each definition is listed under its Epsil spelling (the MathJSON name when
it has none), with its signature in the engine's type syntax. The
[Standard Library](/epsil/library/) page is the one-page index of every
category.

## Definitions

### isCompatibleUnit

MathJSON `IsCompatibleUnit` · `(value, value) -> value`

- argument 1 — A unit, a unit name or a string such as `"km/h"`. Sample: `"km"`.
- argument 2 — A unit, a unit name or a string such as `"km/h"`. Sample: `"mi"`.

Check if two units have the same dimension and convert into each other (`dB` and `Np` do, `dB` and `percent` do not)

```epsil
isCompatibleUnit(km, mi)
// ➔ true
```

```epsil
isCompatibleUnit("km", "s")
// ➔ false
```

### quantity

MathJSON `Quantity` · `(magnitude: value, unit: value) -> quantity`

- `magnitude` — The numeric value, in the unit that follows. Sample: `3`.
- `unit` — The unit, a unit name or a string such as `"km/h"`; a compound unit whose factors cancel gives a plain number. Sample: `"m"`.

A value paired with a physical unit

```epsil
quantity(3, m) + quantity(50, cm)
// ➔ 3.5 m
```

```epsil
quantity(30, "km/h")
// ➔ 30 km/h
```

### quantityMagnitude

MathJSON `QuantityMagnitude` · `(value) -> value`

- argument 1 — The quantity; a value that is not a quantity leaves the call unevaluated. Sample: `quantity(3, m)`.

Extract the numeric value from a quantity

```epsil
quantityMagnitude(quantity(3, m))
// ➔ 3
```

### quantityUnit

MathJSON `QuantityUnit` · `(value) -> value`

- argument 1 — The quantity; a value that is not a quantity leaves the call unevaluated. Sample: `quantity(3, m)`.

Extract the unit from a quantity

```epsil
quantityUnit(quantity(3, m))
// ➔ m
```

### unitConvert

MathJSON `UnitConvert` · `(quantity: value, unit: value) -> value`

- `quantity` — The quantity to convert. Sample: `quantity(5, km)`.
- `unit` — The target unit, a unit name or a string such as `"km/h"`; a unit of another dimension is an error. Sample: `"m"`.

Convert a quantity to a different compatible unit

```epsil
unitConvert(quantity(5, km), m)
// ➔ 5000 m
```

```epsil
unitConvert(quantity(1, h), "min")
// ➔ 60 min
```

### unitDimension

MathJSON `UnitDimension` · `(value) -> value`

- argument 1 — The unit, a unit name or a string such as `"km/h"`; the result lists its exponents of length, mass, time, current, temperature, amount, luminous intensity and currency. Sample: `"N"`.

Return the dimension vector of a unit

```epsil
unitDimension(N)
// ➔ [1,1,-2,0,0,0,0,0]
```

```epsil
unitDimension("km/h")
// ➔ [1,0,-1,0,0,0,0,0]
```

### unitSimplify

MathJSON `UnitSimplify` · `(value) -> value`

- argument 1 — The quantity; it is returned unchanged when no named unit has its dimension, or when it is not a quantity. Sample: `quantity(1, kg * m / s^2)`.

Simplify a quantity unit to a named derived unit if possible

```epsil
unitSimplify(quantity(1, kg * m / s^2))
// ➔ 1 N
```
