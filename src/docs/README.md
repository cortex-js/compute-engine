---
title: MathJSON Dictionary
permalink: /guides/math-json-dictionary/
layout: single
date: Last Modified
sidebar:
  - nav: 'mathjson'
---

<script type='module'>
    import {renderMathInDocument} from '//unpkg.com/mathlive/dist/mathlive.min.mjs';
    renderMathInDocument();
</script>

# MathJSON Dictionary

## Syntax and Symbol Dictionaries

The MathJSON format is independent of any source or target language (Latex,
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

A domain is roughly a combination of a type in a traditional programming
language and an "assumption" in some CAS software. It can be associated with a
symbol to provide some contextual information about this symbol, for example:
_"x is an integer"_.

Each entry in the symbol dictionary indicate the domain of the symbol, and for
functions the expected domain of its argument and the domain of its result (its
codomain).

## Customizing the Dictionaries

It is possible to provide custom syntax and symbol dictionaries, or to modify
the default ones.

When no dictionaries are provided, default ones are used automatically.

## Default Dictionaries

This section describe the symbols defined in the default dictionaries. For
convenience, the information below combine the information included in the
default Latex syntax dictionary and the default global dictionary.

- [Arithmetic](/guides/compute-engine-arithmetic/): `Add`, `Multiply`, etc...
- [Calculus](/guides/compute-engine-calculus/): `Derive`, `Integrate`, etc...
- [Collections](/guides/compute-engine-collections/): `Sequence`, `List`,
  `Dictionary`, `Set`
- [Core](/guides/compute-engine-core/) `Missing`, `Nothing`, `None`, `All`,
  `Identity`, `InverseFunction`, `Latex`, etc...
- [Forms](/guides/compute-engine-forms/) `BaseForm`
- [Logic](/guides/compute-engine-logic/) `And`, `Or`, `Not`, etc...
- [Sets](/guides/compute-engine-sets/)
- [Trigonometry](/guides/compute-engine-trigonometry/)
