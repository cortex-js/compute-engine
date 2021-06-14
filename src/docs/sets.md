---
title: Sets
permalink: /guides/compute-engine/sets/
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
# Sets

## Constants


<div class=symbols-table>

| Symbol | Value | |
| :--- | :--- | :--- |
| `NaturalNumber`| \\[ \N \\] | \\[ 0, 1, 2, 3...\\] |
| `Integer`| \\[ \Z \\] | \\[ ... -2, -1, 0, 1, 2...\\] |
| `RationalNumber`| \\[ \Q \\] | Can be written as \\( \frac{p}{q} \\) where \\( p, q \in \Z \\)|
| `AlgebraicNumber`| \\[ \mathbb{A} \\] | Is the root of a polynomial |
| `RealNumber`| \\[ \R \\] | |
| `ComplexNumber`| \\[ \C \\] | |
| `EmptySet`| \\( \varnothing \\) or \\( \emptyset \\)  | |

</div>

## Functions

<div class=symbols-table>

| Symbol | Operation | |
| :--- | :--- | :--- |
| `CartesianProduct` |  | Aka the product set, the set direct product or cross product. [Q173740](https://www.wikidata.org/wiki/Q173740) |
| `Intersection` | \\[ A \cap B \\]  |  [Q185837](https://www.wikidata.org/wiki/Q185837) |
| `Complement` | \\[ A \complement B\\]  |  Return the elements of the first argument that are not in any of  the subsequent sets.  [Q242767](https://www.wikidata.org/wiki/Q242767) |
| `Union` | \\[ A \cup B \\]  |  [Q173740](https://www.wikidata.org/wiki/Q173740) |
| `SymmetricDifference` | \\[  A \triangle B \\]  | Disjunctive union = \\( (A \setminus B) \cup (B \setminus A)\\) [Q1147242](https://www.wikidata.org/wiki/Q1147242) |
| `Subset` | \\[ A \subset B \\]  |  |
| `SubsetEqual` | \\[ A \subseteq B \\]  |  |
| `SetMinus` | \\[ A \setminus B \\]  |  [Q18192442](https://www.wikidata.org/wiki/Q18192442) |

</div>

