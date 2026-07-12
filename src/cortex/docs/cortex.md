---
title: Cortex
permalink: /cortex/
layout: single
date: Last Modified
sidebar:
  - nav: "universal"
---

# Cortex

Cortex is a programming language for scientific computing built on the Cortex
Compute Engine.

The Cortex language is a work in progress. The information below reflects the
current thinking and may change.{notice--warning}

Here is "Hello World" in Cortex:

```cortex
"Hello World"
```

Here are a few more examples:

```cortex
Simplify(2 + 3x^3 + 2x^2 + x^3 + 1)
// ➔ 4x^3 + 2x^2 + 3

x = 2^11 - 1
"\(x) has type \(Type(x))"
// ➔ "2047 has type integer"
```

{% readmore "/cortex/syntax/" %} Read more about the <strong>formal syntax of
Cortex</strong> {% endreadmore %}

{% readmore "/cortex/implementation/" %} Read more about the
<strong>implementation of Cortex</strong> {% endreadmore %}


{% readmore "/cortex/pragmas/" %}
**Pragmas**: compiler directives embedded in the code 
{% endreadmore %}


{% readmore "/cortex/comments/" %}
**Comments**: line and block comments
{% endreadmore %}

{% readmore "/cortex/literals/" %}
**Literals**: strings, numbers, symbols
{% endreadmore %}


{% readmore "/cortex/operators/" %}
**Operators**: arithmetic, logic, relational
{% endreadmore %}



## Functions

## Collections

### Tuples

### Dictionaries

A dictionary is a collection of set of key/value pairs separated with a comma
(`,`) and surrounded by curly brackets.

Elements in a dictionary are not ordered and the keys are unique. They are
iterable and indexable by the key value.

A key/value pair is a string, followed by `->` and by an expression. If the
string does not contain a character with a _White_Space_ or _Pattern_Syntax_
Unicode property the quotation mark around the string can be omitted. Note that
if the quotation mark is omitted the character escape sequences are not applied.

```cortex
{one -> 1, two -> 2}
{"one" -> 1, "two" -> 2}
```

The empty dictionary is `{->}`.

### Lists

A list is a collection of expressions separated with a comma `,` and surrounded
by square brackets: `[` and `]`

Elements in a list are ordered and don't have to be unique. They are iterable
and indexable with a numeric value (their position in the list, starting at 1).
Indexing uses the `xs[i]` syntax and is 1-based, matching the Compute Engine
convention (`xs[1]` is the first element).

```cortex
[3, 5, 7, 11]
[3, 3 + 5, 3 + + 7, 3 + 5 + 7 + 11]
```

The empty list is `[]`.

### Sets

A set is a collection of expressions surrounded by curly brackets: `{` and `}`.

Elements in a set are not ordered and must be unique. They are iterable but they
are not indexable.

The empty set is `{}`.

## Flow Control

Cortex is expression-oriented: `if`/`else` and `match` both yield a value,
loops map onto the engine's iteration operators, and a `do { … }` block is an
expression whose value is its last statement. Function definitions, anonymous
functions (`x |-> x^2`), and the full control-flow grammar are covered in
[Control Flow](/cortex/control-flow/).

## Future Directions

Several keywords are **reserved but not designed** — they are held so that a
future version of Cortex can introduce them without breaking existing programs,
and using one as an ordinary name today is an error. None of the following are
part of the language yet:

- **Modules and imports** — `import`, `export`, `module`.
- **Error-handling keywords** — `try`, `catch`, `throw`. In Cortex, errors are
  ordinary values, so these are not needed for the current design.
- **Concurrency** — `async`, `await`, `parallel`.
- **Macros** and compile-time metaprogramming.

If you need a symbol whose name collides with one of these reserved words, use
the verbatim form (`` `match` ``).
