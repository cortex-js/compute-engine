---
title: Regular expressions Reference
sidebar_label: Regular expressions
slug: /epsil/reference/regexp/
description: "The regular expressions library of Epsil: every definition with its Epsil spelling, MathJSON name, signature, and full description."
hide_title: true
date: Last Modified
# GENERATED FILE — do not edit. The entries come from the library
# definitions (src/compute-engine/library/) as `epsil doc` describes them;
# the introduction comes from regexp.intro.md when that file exists.
# Regenerate with `npm run doc` (scripts/build-library-reference.ts).
---
# Regular expressions

The 4 definitions of the regular expressions library, each with its Epsil spelling, its MathJSON name, its signature and its full description.

Each definition is listed under its Epsil spelling (the MathJSON name when
it has none), with its signature in the engine's type syntax. The
[Standard Library](/epsil/library/) page is the one-page index of every
category.

## Definitions

### isMatch

MathJSON `IsMatch` · `(subject: character | string, pattern: regexp) -> boolean`

Whether a string contains a match for a regular expression.

### regExp

MathJSON `RegExp` · `(pattern: string, flags: string?) -> regexp`

A compiled regular expression, using the host JavaScript dialect.

The pattern is written most readably as a raw string literal: `regExp(#"[0-9]+"#)`.

Two regular expressions are equal when their patterns are the same and their sets of flags are the same; the order of the flags does not count, and no `u` or `v` flag reads as `u`.

### stringMatch

MathJSON `StringMatch` · `(subject: character | string, pattern: regexp) -> nothing | record`

The first match of a regular expression in a string, as a record.

The record holds `match`, `range`, `groups` and `names`; the result is `nothing` when there is no match.

### stringMatchAll

MathJSON `StringMatchAll` · `(subject: character | string, pattern: regexp) -> list<record>`

Every non-overlapping match of a regular expression in a string, as a list of records.

Each record has the same shape as `stringMatch`.
