---
title: Getting Started with Cortex
sidebar_label: Getting Started
slug: /cortex/getting-started/
description: Install Cortex, try the interactive REPL, run a source file, and embed the language in JavaScript.
hide_title: true
date: Last Modified
---
# Getting Started

<Intro>
Install Cortex and run your first symbolic program in five minutes.
</Intro>

:::warning[Experimental]
Cortex is experimental. Its syntax and behavior may change between releases.
:::

## Install

Cortex is included with the Compute Engine package:

```shell
npm install @cortex-js/compute-engine
```

The package installs a `cortex` command. During development, run the
project-local command through `npx`.

## Try the REPL

Start an interactive session:

```shell
npx cortex
```

Enter a declaration, then use it in another expression:

```text
cortex> let x = 5
5
cortex> x^2
25
```

The REPL keeps declarations and assignments between inputs. Enter `.help` for
the available commands and `.exit` when you are done.

## Run a Source File

Save this program as `squares.cx`:

```cortex
square(x) = x^2
Map(Range(1, 5), square)
```

Run it:

```shell
npx cortex squares.cx
```

The result is:

```text
[1,4,9,16,25]
```

The conventional file extensions are `.cx` and `.cortex`.

## Work Symbolically

Cortex uses the Compute Engine, so expressions remain exact and symbolic by
default:

```cortex-live
Simplify(2 + 3x^3 + 2x^2 + x^3 + 1)
```

Use `N()` when you want a numeric approximation:

```cortex-live
N(Sqrt(2))
```

## Embed Cortex in JavaScript

Import the experimental Cortex entry point, create a `ComputeEngine`, then
execute source text:

```js
import {
  ComputeEngine,
  executeCortex,
} from "@cortex-js/compute-engine/cortex";

const ce = new ComputeEngine();
const { value, diagnostics } = executeCortex(
  ce,
  "factorial(n) = if n <= 1 { 1 } else { n * factorial(n - 1) }\nfactorial(10)"
);

if (diagnostics.length > 0) console.error(diagnostics);
console.log(value.toString()); // 3628800
```

Calls made with the same `ComputeEngine` share its top-level declarations,
which is useful for notebook cells and other stateful sessions. Create a fresh
engine when you want an isolated program.

## Where to Go Next

<ReadMore path="/cortex/examples/">
Study **complete programs** covering control flow, collections, symbolic
calculus, linear algebra, strings, and reproducible randomness.
</ReadMore>

<ReadMore path="/cortex/cli/">
Learn the **CLI and REPL** commands, output modes, diagnostics, and evaluation
limits.
</ReadMore>

<ReadMore path="/cortex/syntax/">
Use the **language reference** for syntax, operators, declarations, types, and
control flow.
</ReadMore>
