---
title: Trigonometry
permalink: /guides/compute-engine-trigonometry/
layout: single
date: Last Modified
sidebar:
  - nav: 'mathjson'
---

<script type='module'>
    import {renderMathInDocument} from '//unpkg.com/mathlive/dist/mathlive.min.mjs';
    renderMathInDocument();
</script>

# Trigonometry

| Function | Inverse                                                                                                | Hyperbolic | Inverse Hyperbolic |
| :------- | :----------------------------------------------------------------------------------------------------- | :--------- | :----------------- |
| `Cos`    | `Arccos`                                                                                               | `Cosh`     | `Arcosh`           |
| `Sin`    | `Arcsin`                                                                                               | `Sinh`     | `Arsinh`           |
| `Tan`    | [`Arctan`](https://www.wikidata.org/wiki/Q2257242), [`Arctan2`](https://www.wikidata.org/wiki/Q776598) | `Tanh`     | `Artanh`           |

- `Degrees` - A constant,
  $$\frac{\pi}{180} = 0.017453292519943295769236907\ldots$$.

- `FromPolarCoordinates` - Converts (radius, angle) -> (x, y)
- `ToPolarCoordinates` - Converts $$(x, y) \longrightarrow (radius, angle)$$

---

- `Hypot` - $$\operatorname{Hypot}(x,y) = \sqrt{x^2+y^2}$$

- `Haversine` = $$\operatorname{Haversine}(z) = \sin(\frac{z}{2})^2$$. The
  [Haversine function](https://www.wikidata.org/wiki/Q2528380) was important in
  navigation because it appears in the haversine formula, which is used to
  reasonably accurately compute distances on an astronomic spheroid given
  angular positions (e.g., longitude and latitude).
- `InverseHaversine` =
  $$\operatorname{InverseHaversine}(z) = 2 \operatorname{Arcsin}(\sqrt{z})$$
