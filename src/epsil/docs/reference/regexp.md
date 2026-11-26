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

- `subject` — The string to search. Sample: `"abc123"`.
- `pattern` — The regular expression, made with `RegExp`. Sample: `regExp("[0-9]+")`.

Whether a string contains a match for a regular expression.

```epsil
isMatch("abc123", regExp("[0-9]+"))
// ➔ true
```

```epsil
isMatch("abc", regExp("^A", "i"))
// ➔ true
```

### regExp

MathJSON `RegExp` · `(pattern: string, flags: string?) -> regexp`

- `pattern` — The pattern, in the JavaScript dialect; a literal pattern that is not valid is an error where it is written. Sample: `"[0-9]+"`.
- `flags` — The flags, any of `d`, `i`, `m`, `s`, `u` and `v`, each at most once and not both `u` and `v`; `g` and `y` are refused, and `u` is implied when neither `u` nor `v` is given. Sample: `"i"`.

A compiled regular expression, using the host JavaScript dialect.

The pattern is written most readably as a raw string literal: `regExp(#"[0-9]+"#)`.

Two regular expressions are equal when their patterns are the same and their sets of flags are the same; the order of the flags does not count, and no `u` or `v` flag reads as `u`.

```epsil
regExp("[a-z]+", "i")
// ➔ RegExp("[a-z]+", "i")
```

```epsil
regExp("a", "im") == regExp("a", "mi")
// ➔ true
```

### stringMatch

MathJSON `StringMatch` · `(subject: character | string, pattern: regexp) -> nothing | record`

- `subject` — The string to search. Sample: `"abc123"`.
- `pattern` — The regular expression, made with `RegExp`. Sample: `regExp("[0-9]+")`.

The first match of a regular expression in a string, as a record.

The record holds `match`, `range`, `groups` and `names`; the result is `nothing` when there is no match.

```epsil
stringMatch("abc123def", regExp("[0-9]+"))
// ➔ {"match" -> "123", "range" -> Range(4, 6), "groups" -> [], "names" -> {->}}
```

### stringMatchAll

MathJSON `StringMatchAll` · `(subject: character | string, pattern: regexp) -> list<record>`

- `subject` — The string to search; the result is an empty list when nothing matches. Sample: `"a1b22c333"`.
- `pattern` — The regular expression, made with `RegExp`; an empty match advances by one character. Sample: `regExp("[0-9]+")`.

Every non-overlapping match of a regular expression in a string, as a list of records.

Each record has the same shape as `stringMatch`.

```epsil
stringMatchAll("a1b22c333", regExp("[0-9]+"))
// ➔ [{"match" -> "1", "range" -> Range(2, 2), "groups" -> [], "names" -> {->}},{"match" -> "22", "range" -> Range(4, 5), "groups" -> [], "names" -> {->}},{"match" -> "333", "range" -> Range(7, 9), "groups" -> [], "names" -> {->}}]
```
