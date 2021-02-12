---
title: MathJSON Dictionary
permalink: /guides/math-json-dictionary/
layout: single
date: Last Modified
sidebar:
  - nav: 'mathjson'
---

# MathJSON Dictionary

## Dictionaries

The MathJSON format is independent of any source or target language (Latex,
MathASCII, etc...) or of any specific interpretation of the symbols used in a
MathJSON expression (`"Pi"`, `"Sin"`, etc...).

In order to parse, serialize or manipulate a MathJSON expression, a dictionary
must be provided to correctly interpret that expression. The dictionary can be
used to defined specialized vocabularies for different scientific fields, for
example a dictionary that would include advanced statistical functions, or
physical constants.

In fact, three different kind of dictionaries can be provided:

**Translation Dictionary.** This dictionary defines how a MathJSON expression
can be expressed into a specific target language (**serialization**) or
constructed from a source language (**parsing**).

It includes definitions such as: "_the `Power` function is represented as
`x^{n}`_" or "_the `Divide` function is represented as `\frac{x}{y}`_".

**Global Dictionary.** The **vocabulary** used by a MathJSON expression is
defined in a global dictionary. Unlike the translation dictionary, this
dictionary is independent of the syntax used to parse/serialize from another
language.

A global dictionary entry specifies the name of the symbol along with additional
information in order to correctly interpret it. For example, "_`Pi` is a
constant whose value is approximately 3.14159265..._", "_the `Add` function is
associative, commutative, pure, idempotent and can take an arbitrary number of
arguments as Real or Complex numbers_".

**Scope.** This dictionary has the same info as the global dictionary, but it's
intended to represent more transient symbols, for example local variables, or
result of computations. For example, "_`x` is a variable which is a Real
number_".

## Domains

A domain is roughly a combination of a type in traditional programming language
and an "assumption" in some CAS software. It can be associated with a symbol to
provide some contextual information about this symbol.

## Customizing the Dictionaries

It is possible to provide custom syntax and global dictionaries, or to modify
the default ones.

When no dictionaries are provided, default ones are used automatically.

## Default Dictionaries

This section describe the symbols defined in the default dictionaries. For
convenience, the information below combine the information included in the
default Latex syntax dictionary and the default global dictionary.

- [Arithmetic](/guides/math-json-calculus/): `Add`, `Multiply`, etc...
- [Calculus](/guides/math-json-calculus/)
- [Collections](/guides/math-json-collections/): `Sequence`, `List`, `Group`,
  `Set`
- [Core](/guides/math-json-core/) `Missing`, `Nothing`, `Identity`,
  `InverseFunction`, `Latex`, etc...
- [Forms](/guides/math-json-forms/) `BaseForm`
- [Trigonometry](/guides/math-json-trigonometry/)
