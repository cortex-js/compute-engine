---
title: Trigonometry
permalink: /guides/compute-engine/trigonometry/
layout: single
date: Last Modified
sidebar:
  - nav: 'compute-engine'
---

<script type='module'>
    import {  renderMathInDocument } 
      from '//unpkg.com/mathlive/dist/mathlive.min.mjs';
    renderMathInDocument({
      TeX: {
        delimiters: {
          inline: [ ['$', '$'], ['\\(', '\\)']],
          display: [['$$', '$$'],['\\[', '\\]']],
        },
      },
      asciiMath: null,
      processEnvironments : false,
      renderAccessibleContent: false,
    });
</script>

# Trigonometry

## Constants

<div class=symbols-table>

| Symbol | Value |
| :--- | :--- |
|`Degrees`| \\[ \frac{\pi}{180} = 0.017453292519943295769236907\ldots \\] |
| `MinusDoublePi` | \\[ -2\pi \\] | | 
| `MinusPi` | \\[ -\pi \\] | | 
| `MinusHalfPi` | \\[ -\frac{\pi}{2} \\] | | 
| `QuarterPi` | \\[ \frac{\pi}{4} \\] | | 
| `ThirdPi` | \\[ \frac{\pi}{3} \\] | | 
| `HalfPi` | \\[ \frac{\pi}{2} \\] | | 
| `TwoThirdPi` | \\[ 2\times \frac{\pi}{3} \\] | | 
| `ThreeQuarterPi` | \\[ 3\times \frac{\pi}{4} \\] | | 
| `Pi` | \\[ \pi \approx 3.14159265358979323\ldots \\] | |
| `DoublePi` | \\[ 2\pi \\] | | 

</div>

## Functions

| Function | Inverse                                                                                                | Hyperbolic | Inverse Hyperbolic |
| :------- | :----------------------------------------------------------------------------------------------------- | :--------- | :----------------- |
| `Cos`    | `Arccos`                                                                                               | `Cosh`     | `Arcosh`           |
| `Sin`    | `Arcsin`                                                                                               | `Sinh`     | `Arsinh`           |
| `Tan`    | [`Arctan`](https://www.wikidata.org/wiki/Q2257242) [`Arctan2`](https://www.wikidata.org/wiki/Q776598) | `Tanh`     | `Artanh`           |



<div class=symbols-table>

| Symbol | |
| :--- | :--- | 
| `FromPolarCoordinates` | Converts \\( (\operatorname{radius}, \operatorname{angle}) \longrightarrow (x, y)\\)|
| `ToPolarCoordinates` | Converts \\((x, y) \longrightarrow (\operatorname{radius}, \operatorname{angle})\\)|
| `Hypot` | \\(\operatorname{Hypot}(x,y) = \sqrt{x^2+y^2}\\) |
| `Haversine` | \\( \operatorname{Haversine}(z) = \sin(\frac{z}{2})^2 \\).<br>The  [Haversine function](https://www.wikidata.org/wiki/Q2528380) was important in  navigation because it appears in the haversine formula, which is used to  reasonably accurately compute distances on an astronomic spheroid given angular positions (e.g., longitude and latitude).|
| `InverseHaversine` |\\(\operatorname{InverseHaversine}(z) = 2 \operatorname{Arcsin}(\sqrt{z})\\) |

</div>
