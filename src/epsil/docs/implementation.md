---
title: Inside Epsil
sidebar_label: Implementation
slug: /epsil/implementation/
description: "Epsil uses MathJSON as its intermediate representation and the Compute Engine as its runtime. The public language entry point exposes the three stages …"
hide_title: true
date: Last Modified
---
# Inside Epsil

Epsil uses MathJSON as its intermediate representation and the Compute Engine
as its runtime. The public language entry point exposes the three stages
directly:

```js
import {
  ComputeEngine,
  executeEpsil,
  parseEpsil,
  serializeEpsil,
} from "@cortex-js/compute-engine/epsil";
```

## Parsing

`parseEpsil(source, url?, options?)` returns a MathJSON expression and an
array of diagnostics:

```js
const [expression, diagnostics] = parseEpsil("2x + 1");
```

Ignoring source-location metadata, the expression is:

```json
["Add", ["Multiply", 2, "x"], 1]
```

The parser recovers from most syntax errors and returns a partial expression
alongside its diagnostics. Every parsed node also carries source offsets so a
host can associate a diagnostic or expression with the original text.

Common surface forms lower to ordinary MathJSON:

```epsil
"The solution is \(x)"
```

```json
["String", {"str": "The solution is "}, "x"]
```

```epsil
let xs = [2, 7, 2, 4]
```

```json
["Declare", "xs",
  ["Dictionary",
    ["KeyValuePair", "value", ["List", 2, 7, 2, 4]]]]
```

```epsil
if x > 0 { x + 1 } else { x - 1 }
```

```json
["If", ["Greater", "x", 0],
  ["Block", ["Add", "x", 1]],
  ["Block", ["Subtract", "x", 1]]]
```

The examples omit the `sourceOffsets` fields for readability.

## Execution

`executeEpsil(ce, source, options?)` parses a program and evaluates its
top-level statements sequentially in the current scope of `ce`:

```js
const ce = new ComputeEngine();

const first = executeEpsil(ce, "let x = 5");
const second = executeEpsil(ce, "x = x + 1\nx");
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
const result = executeEpsil(ce, "2 * $\\frac{1}{2}$", { parseLatex });
```

Host-state pragmas remain disabled unless
`allowHostPragmas: true` is explicitly supplied.

## Serialization

`serializeEpsil(expression, options?)` converts MathJSON back to Epsil:

```js
serializeEpsil(["Add", ["Multiply", 2, "x"], 1]);
// ➔ "2 * x + 1"
```

The serializer formats an expression; it does not execute it. Comments are
currently lossy on the parse side, so parsing and then serializing source code
does not preserve comments or the author's original whitespace.

