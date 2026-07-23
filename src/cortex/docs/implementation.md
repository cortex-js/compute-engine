---
title: Inside Cortex
sidebar_label: Implementation
slug: /cortex/implementation/
description: "Cortex uses MathJSON as its intermediate representation and the Compute Engine as its runtime. The public language entry point exposes the three stages …"
hide_title: true
date: Last Modified
---
# Inside Cortex

Cortex uses MathJSON as its intermediate representation and the Compute Engine
as its runtime. The public language entry point exposes the three stages
directly:

```js
import {
  ComputeEngine,
  executeCortex,
  parseCortex,
  serializeCortex,
} from "@cortex-js/compute-engine/cortex";
```

## Parsing

`parseCortex(source, url?, options?)` returns a MathJSON expression and an
array of diagnostics:

```js
const [expression, diagnostics] = parseCortex("2x + 1");
```

Ignoring source-location metadata, the expression is:

```json
["Add", ["Multiply", 2, "x"], 1]
```

The parser recovers from most syntax errors and returns a partial expression
alongside its diagnostics. Every parsed node also carries source offsets so a
host can associate a diagnostic or expression with the original text.

Common surface forms lower to ordinary MathJSON:

```cortex
"The solution is \(x)"
```

```json
["String", {"str": "The solution is "}, "x"]
```

```cortex
let xs = [2, 7, 2, 4]
```

```json
["Declare", "xs",
  ["Dictionary",
    ["KeyValuePair", "value", ["List", 2, 7, 2, 4]]]]
```

```cortex
if x > 0 { x + 1 } else { x - 1 }
```

```json
["If", ["Greater", "x", 0],
  ["Block", ["Add", "x", 1]],
  ["Block", ["Subtract", "x", 1]]]
```

The examples omit the `sourceOffsets` fields for readability.

## Execution

`executeCortex(ce, source, options?)` parses a program and evaluates its
top-level statements sequentially in the current scope of `ce`:

```js
const ce = new ComputeEngine();

const first = executeCortex(ce, "let x = 5");
const second = executeCortex(ce, "x = x + 1\nx");
// second.value.re === 6
```

Reusing the engine preserves declarations between calls, which is the
notebook/REPL execution model. A fresh `ComputeEngine` starts a fresh session.
The returned object contains the last statement's boxed value and all
diagnostics. Runtime failures are represented as error values rather than
escaping to the host as ordinary exceptions.

To enable `$…$` LaTeX islands, inject the engine's LaTeX parser:

```js
const parseLatex = (latex) => ce.parse(latex).json;
const result = executeCortex(ce, "2 * $\\frac{1}{2}$", { parseLatex });
```

Host-state pragmas remain disabled unless
`allowHostPragmas: true` is explicitly supplied.

## Serialization

`serializeCortex(expression, options?)` converts MathJSON back to Cortex:

```js
serializeCortex(["Add", ["Multiply", 2, "x"], 1]);
// ➔ "2 * x + 1"
```

The serializer formats an expression; it does not execute it. Comments are
currently lossy on the parse side, so parsing and then serializing source code
does not preserve comments or the author's original whitespace.

