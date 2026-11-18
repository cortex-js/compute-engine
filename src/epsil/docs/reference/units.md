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

Check if two units have the same dimension and convert into each other (`dB` and `Np` do, `dB` and `percent` do not)

### quantity

MathJSON `Quantity` · `(value, value) -> quantity`

A value paired with a physical unit

### quantityMagnitude

MathJSON `QuantityMagnitude` · `(value) -> value`

Extract the numeric value from a quantity

### quantityUnit

MathJSON `QuantityUnit` · `(value) -> value`

Extract the unit from a quantity

### unitConvert

MathJSON `UnitConvert` · `(value, value) -> value`

Convert a quantity to a different compatible unit

### unitDimension

MathJSON `UnitDimension` · `(value) -> value`

Return the dimension vector of a unit

### unitSimplify

MathJSON `UnitSimplify` · `(value) -> value`

Simplify a quantity unit to a named derived unit if possible
