---
title: Sets
permalink: /compute-engine/reference/sets/
layout: single
date: Last Modified
sidebar:
  - nav: 'universal'
toc: true
render_math_in_document: true
---

A **set** is a collection of distinct elements.{.xl}

## Constants

<div class=symbols-table>

| Symbol     | Notation                                 | Definition |
| :--------- | :--------------------------------------- | :--------- |
| `EmptySet` | \\( \varnothing \\) or \\( \emptyset \\) |            |

</div>

## Functions

New sets can be defined using a **set expression**. A set expression is an
expression with one of the following head functions.

<div class=symbols-table>

| Function              | Operation                                           |                                                                                                                                                                                                                     |
| :-------------------- | :-------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `CartesianProduct`    | \\[ \operatorname{A} \times \operatorname{B} \\]    | A.k.a the product set, the set direct product or cross product. [Q173740](https://www.wikidata.org/wiki/Q173740)                                                                                                    |
| `Complement`          | \\[ \operatorname{A}^\complement \\]                | The set of elements that are not in \\( \operatorname{A} \\). If \\(\operatorname{A}\\) is a numeric domain, the universe is assumed to be the set of all numbers. [Q242767](https://www.wikidata.org/wiki/Q242767) |
| `Intersection`        | \\[ \operatorname{A} \cap \operatorname{B} \\]      | The set of elements that are in \\(\operatorname{A}\\) and in \\(\operatorname{B}\\) [Q185837](https://www.wikidata.org/wiki/Q185837)                                                                               |
| `Union`               | \\[ \operatorname{A} \cup \operatorname{B} \\]      | The set of elements that are in \\(\operatorname{A}\\) or in \\(\operatorname{B}\\) [Q173740](https://www.wikidata.org/wiki/Q173740)                                                                                |
| `Set`                 | \\(\lbrace 1, 2, 3 \rbrace \\)                      | Set builder notation                                                                                                                                                                                                |
| `SetMinus`            | \\[ \operatorname{A} \setminus \operatorname{B} \\] | [Q18192442](https://www.wikidata.org/wiki/Q18192442)                                                                                                                                                                |
| `SymmetricDifference` | \\[ \operatorname{A} \triangle \operatorname{B} \\] | Disjunctive union = \\( (\operatorname{A} \setminus \operatorname{B}) \cup (\operatorname{B} \setminus \operatorname{A})\\) [Q1147242](https://www.wikidata.org/wiki/Q1147242)                                      |

</div>

## Relations

<div class=symbols-table>

| Function        |                                                                                                                                                                           |     |
| :-------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | :-- |
| `Element`       | \\[ x \in \operatorname{A} \\]                                                                                                                                            |     |
| `NotElement`    | \\[ x \not\in \operatorname{A} \\]                                                                                                                                        |     |
| `NotSubset`     | \\[ A \nsubset \operatorname{B} \\]                                                                                                                                       |     |
| `NotSuperset`   | \\[ A \nsupset \operatorname{B} \\]                                                                                                                                       |     |
| `Subset`        | \\[ \operatorname{A} \subset \operatorname{B} \\] <br> \\[ \operatorname{A} \subsetneq \operatorname{B} \\] <br> \\[ \operatorname{A} \varsubsetneqq \operatorname{B} \\] |     |
| `SubsetEqual`   | \\[ \operatorname{A} \subseteq \operatorname{B} \\]                                                                                                                       |     |
| `Superset`      | \\[ \operatorname{A} \supset \operatorname{B} \\]<br> \\[ \operatorname{A} \supsetneq \operatorname{B} \\]<br>\\[ \operatorname{A} \varsupsetneq \operatorname{B} \\]     |     |
| `SupersetEqual` | \\[ \operatorname{A} \supseteq \operatorname{B} \\]                                                                                                                       |     |

</div>
