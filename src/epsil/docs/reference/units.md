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

The 7 definitions of the units library, each with its Epsil spelling, its MathJSON name, its signature and its full description.

Each definition is listed under its Epsil spelling (the MathJSON name when
it has none), with its signature in the engine's type syntax. The
[Standard Library](/epsil/library/) page is the one-page index of every
category.

## Definitions

### isCompatibleUnit

MathJSON `IsCompatibleUnit` · `(value, value) -> value`

Check if two units have the same dimension

### quantity

MathJSON `Quantity` · `(value, value) -> value`

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
