---
title: Sets
permalink: /guides/compute-engine/sets/
layout: single
date: Last Modified
sidebar:
  - nav: 'compute-engine'
---
<script defer type='module'>
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

## Set Constants


<div class=symbols-table>

| Symbol | Value | |
| :--- | :--- | :--- |
| `AlgebraicNumber`| \\[ \mathbb{A} \\] | Is the root of a polynomial |
| `ComplexNumber`| \\[ \C \\] | |
| `EmptySet`| \\( \varnothing \\) or \\( \emptyset \\)  | |
| `Integer`| \\[ \Z \\] | \\[ ... -2, -1, 0, 1, 2...\\] |
| `ImaginaryNumber`| \\[ \I \\] | The set of complex numbers whose real component = 0|
| `NaturalNumber`| \\[ \N \\] | \\[ 0, 1, 2, 3...\\] |
| `RationalNumber`| \\[ \Q \\] | Can be written as \\( \frac{p}{q} \\) where \\( p, q \in \Z \\)|
| `RealNumber`| \\[ \R \\] | |
| `TranscendentalNumber`| \\[ \mathbb{T} \\] | The complex numbers that are not algebraic |

</div>

## Set Operations

<div class=symbols-table>

| Function | Operation | |
| :--- | :--- | :--- |
| `CartesianProduct` | \\( A \\times B \\)<br>\\(A^n\\) | Aka the product set, the set direct product or cross product. [Q173740](https://www.wikidata.org/wiki/Q173740) |
| `Complement` | \\[ A^\complement\\]  |  Return the elements of the first argument that are not in any of  the other arguments. If a single argument, equivalent to `["Complement", A, "Number"]`.  [Q242767](https://www.wikidata.org/wiki/Q242767) |
| `Intersection` | \\[ A \cap B \\]  |  [Q185837](https://www.wikidata.org/wiki/Q185837) |
| `Set` | \\[ \left\lbrace a, b, c... \right\rbrace \\] | `["Set", <sequence>]`<br> The set of elements in _<sequence>_.|
| `Set` | \\[ \left\lbrace x \in A \mid \forall x \in A, \operatorname{cond}(x) \right\rbrace \\] | `["Set", <set>, <condition>]`<br> The set of elements in _<set>_ that satisfy _<condition>_|
| `SetMinus` | \\[ A \setminus B \\]  |  The set of elements of \\(A\\) that are not in \\(B\\). [Q18192442](https://www.wikidata.org/wiki/Q18192442) |
| `SymmetricDifference` | \\[  A \triangle B \\]  | Disjunctive union = \\( (A \setminus B) \cup (B \setminus A)\\) [Q1147242](https://www.wikidata.org/wiki/Q1147242) |
| `Union` | \\[ A \cup B \\]  |  [Q173740](https://www.wikidata.org/wiki/Q173740) |

</div>


The `Set` function can be used to describe a variety of sets:

```json
// Set extension: Set of element 2, 5, 7 or 9
["Set", 2, 5, 7, 9]

// Set comprehension: all real perfect squares
["Set", 
  "RealNumber", 
  ["Condition", 
    ["Element", ["SquareRoot", "_"], ["Integer"] ]
  ]
]


```

## Set Relations

<div class=symbols-table>

| Function | Relations | |
| :--- | :--- | :--- |

| `Contains` | \\[ A \ni x \\] | True if \\( x \\in A \\) |
| `Element` | \\[ x \in A \\] | True if \\(x\\) is an element of \\(A\\) |
| `Subset` | \\[ A \subset B \\]  |  Proper subset: true if all elements of \\(A\\) are in \\(B\\) and some elements of \\(B) are not in \\(A\\)|
| `SubsetEqual` | \\[ A \subseteq B \\]  | True if all elements of \\(A\\) are in \\(B\\) |
| `Superset` | \\[ A \supset B \\]  |  Proper subset: true if all elements of \\(B\\) are in \\(A\\) and some elements of \\(A) are not in \\(B\\)|
| `SupersetEqual` | \\[ A \supseteq B \\]  | True if all elements of \\(B\\) are in \\(A\\) |

</div>
