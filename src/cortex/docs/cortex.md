---
title: Cortex
sidebar_label: Introduction
slug: /cortex/
description: Cortex is a programming language for scientific computing built on the Compute Engine.
hide_title: true
date: Last Modified
---

# Cortex

<Intro>
Cortex is a programming language for scientific computing, built on the
Compute Engine.
</Intro>

:::warning[Experimental]
Cortex is available as an **experimental** entry point. Its syntax and
semantics may change between releases while the language is being exercised in
notebooks and other applications.
:::

Cortex is embedded from JavaScript through the
`@cortex-js/compute-engine/cortex` entry point:

```js
import { ComputeEngine, executeCortex } from "@cortex-js/compute-engine/cortex";

const ce = new ComputeEngine();
const { value, diagnostics } = executeCortex(ce, "1 + 2");
```

Here is "Hello World" in Cortex. Edit the code and press **Run** (or
<kbd>⌘/Ctrl</kbd>+<kbd>Enter</kbd>) — the result is the value of the last
statement, shown as a Cortex value and as its underlying MathJSON.

```cortex-live
"Hello World"
```

Cortex is **symbolic by default**: expressions stay exact unless you ask for a
numeric approximation with `N()`.

```cortex-live
Simplify(2 + 3x^3 + 2x^2 + x^3 + 1)
```

Values have a type, and strings support `\(…)` interpolation:

```cortex-live
let x = 2^11 - 1
"\(x) has type \(Type(x))"
```

Errors are ordinary values, so a program never throws to its host — a problem
surfaces as an `["Error", …]` value or a diagnostic:

```cortex-live
1 / 0
```

## Language Tour

<ReadMore path="/cortex/syntax/">
Read more about the **formal syntax of Cortex** — statements, primaries,
calls and indexing.
</ReadMore>

<ReadMore path="/cortex/literals/">
**Literals** — numbers, strings, symbols, and `$…$` LaTeX islands.
</ReadMore>

<ReadMore path="/cortex/operators/">
**Operators** — arithmetic, logic, relational, and the pipeline operator.
</ReadMore>

<ReadMore path="/cortex/control-flow/">
**Control flow** — `if`/`else`, `match`, loops, blocks, and functions.
</ReadMore>

<ReadMore path="/cortex/declarations/">
**Declarations** — binding names with `let` and `const`.
</ReadMore>

<ReadMore path="/cortex/comments/">
**Comments** — line and block comments.
</ReadMore>

<ReadMore path="/cortex/pragmas/">
**Pragmas** — parser directives embedded in the code.
</ReadMore>

## Collections

Cortex has literal syntax for the Compute Engine's collections.

**Lists** are ordered and 1-indexed with `xs[i]`:

```cortex-live
[3, 5, 7, 11]
```

**Sets** are unordered collections of unique elements:

```cortex-live
{3, 5, 7, 11}
```

**Dictionaries** are sets of key/value pairs. The empty dictionary is `{->}`:

```cortex-live
{one -> 1, two -> 2}
```

<ReadMore path="/cortex/syntax/#collections-tuples-and-dictionaries">
Read more about **lists, sets, tuples and dictionaries**.
</ReadMore>

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
