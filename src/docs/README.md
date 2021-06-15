---
title: MathJSON Dictionary
permalink: /guides/compute-engine/dictionaries/
layout: single
date: Last Modified
sidebar:
  - nav: 'compute-engine'
---

<script type='module'>
    import {renderMathInDocument} from '//unpkg.com/mathlive/dist/mathlive.min.mjs';
    renderMathInDocument({ 
      renderAccessibleContent: false,
      TeX: { 
        delimiters: {
          inline: [['\\(', '\\)']],
          display: [ ['$$', '$$'], ['\\[', '\\]']],
        },
        processEnvironments : false 
      },
      asciiMath: null,
    });
</script>

# Dictionaries

## Syntax and Symbol Dictionaries

The <a href ="/guides/math-json/format/">MathJSON format</a> is independent of any source or target language (Latex,
MathASCII, etc...) or of any specific interpretation of the symbols used in a
MathJSON expression (`"Pi"`, `"Sin"`, etc...).

A **syntax dictionary** defines how a MathJSON expression can be expressed into
a specific target language (**serialization**) or constructed from a source
language (**parsing**).

It includes definitions such as:

- "_The `Power` function is represented as "`x^{n}`"_"
- "_The `Divide` function is represented as "`\frac{x}{y}`"_".

A **symbol dictionary** defines the **vocabulary** used by a MathJSON
expression. This dictionary is independent of the syntax used to parse/serialize
from another language but it defines the meaning of the symbols used in a
MathJSON expression.

An entry in a symbol dictionary includes information necessary to correctly
interpret it.

For example:

- "_`Pi` is a transcendental number whose value is approximately 3.14159265..._"
- "_The `Add` function is associative, commutative, pure, idempotent and can be
  applied to arbitrary number of Real or Complex numbers_".

## Domains

A domain is similar to a type in a traditional programming
language. 

The domain of a symbol provides some contextual information about this symbol, for example: _"x is a positive integer"_. 

The codomain of a function indicates the set of values that a function maps to, 
or the domain of the "result" of the function.

Each entry in the symbol dictionary indicate the domain of the symbol, and for
functions its codomain.

## Customizing the Dictionaries

It is possible to provide custom syntax and symbol dictionaries, or to modify
the default ones.

When no dictionaries are provided, default ones are used automatically.

## Default Dictionaries

The default dictionaries are organized by topic as follow:

<div class=symbols-table>

| Dictionary |  |
|:---|:---|
| [Arithmetic](/guides/compute-engine/arithmetic/) | `Add` `Multiply`...|
| [Calculus](/guides/compute-engine/calculus/) | `Derive` `Integrate`, etc...|
| [Collections](/guides/compute-engine/collections/)| `Sequence` `List` `Dictionary` `Set`... |
| [Core](/guides/compute-engine/core/) | `Missing` `Nothing` `None` `All`  `Identity` `InverseFunction` `LatexTokens`... |
| [Logic](/guides/compute-engine/logic/) |`And` `Or` `Not`...|
| [Sets](/guides/compute-engine/sets/) | |
| [Trigonometry](/guides/compute-engine/trigonometry/)  | `Cos` `Sin` `Tan`...| 

</div>