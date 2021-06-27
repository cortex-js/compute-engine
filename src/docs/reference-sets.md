---
title: Sets
permalink: /compute-engine/reference/sets/
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

A **set** is a collection of distinct elements.

A **domain**, such as `Integer` `Boolean`, is a **set** used to represent the possible values of an expression.

<div class='read-more'><a href="/compute-engine/reference/domains/">Read more about <strong>Domains</strong> <svg class="svg-chevron" ><use xlink:href="#svg-chevron"></use></svg></a></div>


## Constants


<div class=symbols-table>

| Symbol | Notation | Definition |
| :--- | :--- | :--- |
| `EmptySet`| \\( \varnothing \\) or \\( \emptyset \\)  | |

</div>

The [domains](/compute-engine/reference/domains/) also define a number of sets.
## Functions

New sets can be defined using a **set expression**. A set expression is an expression with one of the following head functions.

<div class=symbols-table>

| Function | Operation | |
| :--- | :--- | :--- |
| `CartesianProduct` | \\[ \mathrm{A} \times \mathrm{B} \\] | A.k.a the product set, the set direct product or cross product. [Q173740](https://www.wikidata.org/wiki/Q173740) |
| `Complement` | \\[ \mathrm{A}^\complement \\]  |  The set of elements that are not in \\( \mathrm{A} \\). If \\(\mathrm{A}\\) is a numeric domain, the universe is assumed to be the set of all numbers. [Q242767](https://www.wikidata.org/wiki/Q242767) |
| `Intersection` | \\[ \mathrm{A} \cap \mathrm{B} \\]  | The set of elements that are in  \\(\mathrm{A}\\) and in \\(\mathrm{B}\\) [Q185837](https://www.wikidata.org/wiki/Q185837) |
| `Union` | \\[ \mathrm{A} \cup \mathrm{B} \\]  | The set of elements that are in \\(\mathrm{A}\\) or in \\(\mathrm{B}\\) [Q173740](https://www.wikidata.org/wiki/Q173740) |
| `Set` | \\(\lbrace 1, 2, 3 \rbrace \\) |  Set builder notation |
| `SetMinus` | \\[ \mathrm{A} \setminus \mathrm{B} \\]  |  [Q18192442](https://www.wikidata.org/wiki/Q18192442) |
| `SymmetricDifference` | \\[  \mathrm{A} \triangle \mathrm{B} \\]  | Disjunctive union = \\( (\mathrm{A} \setminus \mathrm{B}) \cup (\mathrm{B} \setminus \mathrm{A})\\) [Q1147242](https://www.wikidata.org/wiki/Q1147242) |

</div>


## Relations

<div class=symbols-table>

| Function |  | |
| :--- | :--- | :--- |
| `Element` | \\[ x \in \mathrm{A} \\]  |  |
| `NotElement` | \\[ x \not\in \mathrm{A} \\]  |  |
| `NotSubset` | \\[ A \nsubset \mathrm{B} \\]  |  |
| `NotSuperset` | \\[ A \nsupset \mathrm{B} \\]  |  |
| `Subset` | \\[ \mathrm{A} \subset \mathrm{B} \\] <br> \\[ \mathrm{A} \subsetneq \mathrm{B} \\] <br> \\[ \mathrm{A} \varsubsetneqq \mathrm{B} \\]|  |
| `SubsetEqual` | \\[ \mathrm{A} \subseteq \mathrm{B} \\]  |  |
| `Superset` | \\[ \mathrm{A} \supset \mathrm{B} \\]<br>  \\[ \mathrm{A} \supsetneq \mathrm{B} \\]<br>\\[ \mathrm{A} \varsupsetneq \mathrm{B} \\] |  |
| `SupersetEqual` | \\[ \mathrm{A} \supseteq \mathrm{B} \\]  |  |

</div>
