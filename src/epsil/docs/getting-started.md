---
title: Getting Started with Epsil
sidebar_label: Getting Started
slug: /epsil/getting-started/
description: Install Epsil, try the interactive REPL, run a source file, and embed the language in JavaScript.
hide_title: true
date: Last Modified
---
# Getting Started

<Intro>
Install Epsil and run your first symbolic program in five minutes.
</Intro>

:::warning[Experimental]
Epsil is experimental. Its syntax and behavior may change between releases.
:::

## Install

Epsil is included with the Compute Engine package:

```shell
npm install @cortex-js/compute-engine
```

The package installs an `epsil` command. During development, run the
project-local command through `npx`.

## Try the REPL

Start an interactive session:

```shell
npx epsil
```

Enter a declaration, then use it in another expression:

```text
epsil> let x = 5
5
epsil> x^2
25
```

The REPL keeps declarations and assignments between inputs. Enter `.help` for
the available commands and `.exit` when you are done.

## Run a Source File

Save this program as `squares.epsil`:

```epsil
square(x) = x^2
Map(1..5, square)
```

Run it:

```shell
npx epsil squares.epsil
```

The result is:

```text
[1,4,9,16,25]
```

The conventional file extension is `.epsil`.

## Work Symbolically

Epsil uses the Compute Engine, so expressions remain exact and symbolic by
default:

```epsil-live
Simplify(2 + 3x^3 + 2x^2 + x^3 + 1)
```

Use `N()` when you want a numeric approximation:

```epsil-live
N(Sqrt(2))
```

## Embed Epsil in JavaScript

Import the experimental Epsil entry point, create a `ComputeEngine`, then
execute source text:

```js
import {
  ComputeEngine,
  executeEpsil,
} from "@cortex-js/compute-engine/epsil";

const ce = new ComputeEngine();
const { value, diagnostics } = executeEpsil(
  ce,
  "factorial(n) = 1 if n <= 1 else n * factorial(n - 1)\nfactorial(10)"
);

if (diagnostics.length > 0) console.error(diagnostics);
console.log(value.toString()); // 3628800
```

Calls made with the same `ComputeEngine` share its top-level declarations,
which is useful for notebook cells and other stateful sessions. Create a fresh
engine when you want an isolated program.

## Where to Go Next

<ReadMore path="/epsil/examples/">
Study **complete programs** covering control flow, collections, symbolic
calculus, linear algebra, strings, and reproducible randomness.
</ReadMore>

<ReadMore path="/epsil/cli/">
Learn the **CLI and REPL** commands, output modes, diagnostics, and evaluation
limits.
</ReadMore>

<ReadMore path="/epsil/syntax/">
Use the **language reference** for syntax, operators, declarations, types, and
control flow.
</ReadMore>

<ReadMore path="/epsil/from-python/">
Already know **Python**? Start from the idiom-by-idiom translation guide.
</ReadMore>

<ReadMore path="/epsil/from-mathematica/">
Already know **Mathematica**? Start from the Wolfram Language translation
guide.
</ReadMore>
