---
title: Epsil
sidebar_label: Introduction
slug: /epsil/
description: Epsil is a programming language for scientific computing built on the Compute Engine.
hide_title: true
date: Last Modified
---

# Epsil

<Intro>
Epsil is a programming language for scientific computing, built on the
Compute Engine.
</Intro>

:::warning[Experimental]
Epsil is available as an **experimental** entry point. Its syntax and
semantics may change between releases while the language is being exercised in
notebooks and other applications.
:::

Epsil is embedded from JavaScript through the
`@cortex-js/compute-engine/epsil` entry point:

```js
import { ComputeEngine, executeEpsil } from "@cortex-js/compute-engine/epsil";

const ce = new ComputeEngine();
const { value, diagnostics } = executeEpsil(ce, "1 + 2");
```

Here is "Hello World" in Epsil. Edit the code and press **Run** (or
<kbd>⌘/Ctrl</kbd>+<kbd>Enter</kbd>) — the result is the value of the last
statement, shown as an Epsil value and as its underlying MathJSON.

```epsil-live
"Hello World"
```

Epsil is **symbolic by default**: expressions stay exact unless you ask for a
numeric approximation with `N()`.

```epsil-live
Simplify(2 + 3x^3 + 2x^2 + x^3 + 1)
```

Values have a type, and strings support `\(…)` interpolation:

```epsil-live
let x = 2^11 - 1
"\(x) has type \(Type(x))"
```

Errors are ordinary values, so a program never throws to its host — a problem
surfaces as an `["Error", …]` value or a diagnostic:

```epsil-live
const answer = 42
answer = 0
```

## Start Here

<ReadMore path="/epsil/getting-started/">
Follow the **five-minute getting-started guide** — try the REPL, run a source
file, and embed Epsil in JavaScript.
</ReadMore>

<ReadMore path="/epsil/examples/">
Explore **complete Epsil programs** for symbolic computation, collections,
calculus, linear algebra, strings, and more.
</ReadMore>

<ReadMore path="/epsil/cli/">
Use the **CLI and interactive REPL** from a terminal.
</ReadMore>

<ReadMore path="/epsil/from-python/">
Coming from **Python**? Translate your idioms — and learn the three reflexes
that silently do the wrong thing.
</ReadMore>

<ReadMore path="/epsil/from-mathematica/">
Coming from **Mathematica**? Most of the mental model carries over; here is
what changes.
</ReadMore>

<ReadMore path="/epsil/for-agents/">
Writing Epsil with an LLM? Give it the **language card for AI agents** — a
condensed, machine-verified reference.
</ReadMore>

<ReadMore path="/epsil/mcp/">
Connect ChatGPT, Claude, or another AI assistant to Epsil with the built-in
**MCP server** — exact math as a tool call.
</ReadMore>

## Language Reference

<ReadMore path="/epsil/syntax/">
Read more about the **formal syntax of Epsil** — statements, primaries,
calls and indexing.
</ReadMore>

<ReadMore path="/epsil/literals/">
**Literals** — numbers, strings, symbols, and `$…$` LaTeX islands.
</ReadMore>

<ReadMore path="/epsil/operators/">
**Operators** — arithmetic, logic, relational, and the pipeline operator.
</ReadMore>

<ReadMore path="/epsil/control-flow/">
**Control flow** — `if`/`else`, `match`, loops, blocks, and functions.
</ReadMore>

<ReadMore path="/epsil/declarations/">
**Declarations** — binding names with `let` and `const`.
</ReadMore>

<ReadMore path="/epsil/types/">
**Types** — annotations, named types, effects, and absence values.
</ReadMore>

<ReadMore path="/epsil/comments/">
**Comments** — line and block comments.
</ReadMore>

<ReadMore path="/epsil/pragmas/">
**Pragmas** — parser directives embedded in the code.
</ReadMore>

## Collections

Epsil has literal syntax for the Compute Engine's collections.

**Lists** are ordered and 1-indexed with `xs[i]`:

```epsil-live
[3, 5, 7, 11]
```

**Sets** are unordered collections of unique elements:

```epsil-live
{3, 5, 7, 11}
```

**Dictionaries** are sets of key/value pairs. The empty dictionary is `{->}`:

```epsil-live
{one -> 1, two -> 2}
```

<ReadMore path="/epsil/syntax/#collections-tuples-and-dictionaries">
Read more about **lists, sets, tuples and dictionaries**.
</ReadMore>

## Future Directions

Several keywords are **reserved but not designed** — they are held so that a
future version of Epsil can introduce them without breaking existing programs,
and using one as an ordinary name today is an error. None of the following are
part of the language yet:

- **Modules and imports** — `import`, `export`, `module`.
- **Error-handling keywords** — `try`, `catch`, `throw`. In Epsil, errors are
  ordinary values, so these are not needed for the current design.
- **Concurrency** — `async`, `await`, `parallel`.
- **Macros** and compile-time metaprogramming.

If you need a symbol whose name collides with one of these reserved words, use
the verbatim form (`` `match` ``).
