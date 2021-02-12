---
title: MathJSON Arithmetic
permalink: /guides/math-json-arithmetic/
layout: single
date: Last Modified
sidebar:
  - nav: 'mathjson'
---

| Function | Inverse                                                                                                | Hyperbolic | Inverse Hyperbolic |
| :------- | :----------------------------------------------------------------------------------------------------- | :--------- | :----------------- |
| `Cos`    | `Arccos`                                                                                               | `Cosh`     | `Arcosh`           |
| `Sin`    | `Arcsin`                                                                                               | `Sinh`     | `Arsinh`           |
| `Tan`    | [`Arctan`](https://www.wikidata.org/wiki/Q2257242), [`Arctan2`](https://www.wikidata.org/wiki/Q776598) | `Tanh`     | `Artanh`           |

## `Degrees`

A constant, Pi divided by 180 = 0.017453292519943295769236907

## `FromPolarCoordinates`

Converts (radius, angle) -> (x, y

## `Haversine`

[Haversine function](https://www.wikidata.org/wiki/Q2528380)

= sin(z/2)^2

The haversine function was important in navigation because it appears in the
haversine formula, which is used to reasonably accurately compute distances on
an astronomic spheroid given angular positions (e.g., longitude and latitude).

## `Hypot`

sqrt(x*x + y*y)

## `InverseHaversine`

= 2 \* Arcsin(Sqrt(z))

## `ToPolarCoordinates`

Converts (x, y) -> (radius, angle)
