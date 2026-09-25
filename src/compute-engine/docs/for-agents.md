---
title: Compute Engine for AI Agents
sidebar_label: For AI Agents
slug: /compute-engine/for-agents/
description: "A condensed, machine-verified reference for AI agents writing JavaScript or TypeScript with the Compute Engine: creating expressions, exact and numeric evaluation, symbolic operations, and the common traps."
hide_title: true
date: Last Modified
---
# Compute Engine for AI Agents

A condensed reference for language models and coding agents writing
JavaScript or TypeScript code that uses the Compute Engine library
(`@cortex-js/compute-engine`). Every `js` code block on this page is executed
by the test suite and its `// ➔` results verified, so the examples cannot
drift from the implementation.

To compute an answer rather than write code, use the `epsil` command or its
MCP server instead: `npx epsil --from latex -e '\int_0^1 x^2\,dx'` prints
`1/3`. See [Epsil for AI Agents](/epsil/for-agents/).

## What the Compute Engine Is

A symbolic and numeric math engine for JavaScript. It parses LaTeX into
[MathJSON](https://cortexjs.io/math-json/), a JSON representation of math
(`["Add", "x", 1]`), and evaluates, simplifies, solves, differentiates,
integrates and compiles expressions. It serializes back to LaTeX or MathJSON.

It is **exact by default**: `evaluate()` keeps rationals, radicals and
constants such as `\pi` exact. Ask for a decimal with `N()`.

## Setup

```js
import { ComputeEngine } from '@cortex-js/compute-engine';

const ce = new ComputeEngine();
ce.parse('\\frac{1}{3} + \\frac{1}{6}').evaluate(); // ➔ 1/2
```

An engine holds the definitions, assumptions and precision settings. Create
one and reuse it. For quick scripts, the package also exports free functions
that use a shared default engine and accept a LaTeX string, MathJSON or an
expression:

```js
import { simplify, evaluate, N, expand, factor, solve } from '@cortex-js/compute-engine';

evaluate('2^{11} - 1'); // ➔ 2047
simplify('x + x'); // ➔ 2x
expand('(x + 1)^2'); // ➔ x^2 + 2x + 1
factor('x^2 - 5x + 6'); // ➔ (x - 3) * (x - 2)
```

Remember to escape backslashes in JavaScript strings: `'\\frac{1}{2}'`, or use
`String.raw`.

## Creating Expressions

```js
ce.parse('x^2 + 2x + 1'); // ➔ x^2 + 2x + 1
ce.box(['Add', 'x', 1]); // ➔ x + 1
ce.box(['Add', 1, 2]); // ➔ 3
ce.box(['Add', 1, 2], { form: 'raw' }); // ➔ 1 + 2
```

- `ce.parse(latex)` parses LaTeX, `ce.box(mathjson)` wraps MathJSON.
- Both return the **canonical form** by default: operands are sorted and
  exact numeric arithmetic is folded. Pass `{ form: 'raw' }` to keep the
  structure exactly as written, for example to show a student's answer
  unchanged.
- In MathJSON, a bare string is a **symbol** (`"x"`, `"Pi"`). A string
  literal is written `"'hello'"` or `{ "str": "hello" }`.
- Expressions are **immutable**: `subs()`, `evaluate()`, `simplify()` and
  the other operations return a new expression.

## Reading Results

```js
const r = ce.parse('\\frac{5}{2}').evaluate();
r.toString(); // ➔ "5/2"
r.latex; // ➔ "\\frac{5}{2}"
r.json; // ➔ ["Rational",5,2]
r.re; // ➔ 2.5
```

- `.latex` for display, `.json` for storage or interchange, `.toString()` for
  logs.
- `.re` (and `.im`) give a JavaScript number for a numeric value, `NaN`
  otherwise.
- Use the type guards `isNumber`, `isSymbol`, `isFunction` and `isString`
  before reading `.numericValue`, `.symbol`, `.operator`/`.ops` or `.string`:

```js
import { isFunction, sym } from '@cortex-js/compute-engine';

const e = ce.parse('2x + 3y');
isFunction(e) ? e.operator : null; // ➔ "Add"
isFunction(e) ? e.ops.length : 0; // ➔ 2
sym(ce.parse('y')); // ➔ "y"
```

## Exact and Numeric Evaluation

```js
ce.parse('\\sqrt{2}').evaluate(); // ➔ sqrt(2)
ce.parse('\\sqrt{2}').N(); // ➔ 1.4142135623730950488
ce.parse('\\sin(\\frac{\\pi}{6})').evaluate(); // ➔ 1/2
ce.parse('\\sin(1)').evaluate(); // ➔ sin(1)
ce.parse('\\sin(1)').N().re; // ➔ 0.8414709848078965
ce.parse('\\pi x').N(); // ➔ 3.14159265358979323846 * x
```

- `evaluate()` computes exactly and leaves what has no exact value symbolic.
  `N()` computes a numeric approximation.
- Numeric results use arbitrary precision: `ce.precision = 50` for 50 digits.
  `.re` rounds to a JavaScript number.
- Integers of any size are exact: `ce.parse('2^{100}').evaluate().toString()`
  is `"1267650600228229401496703205376"`.

## Symbolic Operations

```js
ce.parse('\\sin^2 x + \\cos^2 x').simplify(); // ➔ 1
ce.parse('\\frac{x^2-1}{x-1}').simplify(); // ➔ x + 1
ce.parse('\\frac{d}{dx} \\sin(x^2)').evaluate(); // ➔ 2x * cos(x^2)
ce.parse('\\int x \\cos x\\,dx').evaluate(); // ➔ x * sin(x) + cos(x)
ce.parse('\\int_0^1 x^2\\,dx').evaluate(); // ➔ 1/3
ce.parse('\\sum_{k=1}^{\\infty} \\frac{1}{k^2}').evaluate(); // ➔ pi^2 / 6
ce.parse('\\lim_{x\\to 0} \\frac{\\sin x}{x}').evaluate(); // ➔ 1
ce.parse('x^2 + y').subs({ x: 3 }); // ➔ y + 9
```

Solving returns an array of solutions, or an object for a system:

```js
ce.parse('x^2 - 5x + 6 = 0').solve('x').map((s) => s.toString()); // ➔ ["3","2"]
ce.parse('x^2 + 1 = 0').solve('x').map((s) => s.toString()); // ➔ ["i","-i"]
const s = ce.parse('\\begin{cases}x+y=5\\\\x-y=1\\end{cases}').solve(['x', 'y']);
[s.x.json, s.y.json]; // ➔ [3,2]
```

`expand` and `factor` are free functions, not methods. In MathJSON they are
also operators: `ce.box(['Expand', expr]).evaluate()`.

## Comparing Expressions

```js
ce.parse('x + 1').isSame(ce.parse('1 + x')); // ➔ true
ce.parse('(x+1)^2').isSame(ce.parse('x^2+2x+1')); // ➔ false
ce.parse('(x+1)^2').isIdenticallyEqual(ce.parse('x^2+2x+1')); // ➔ true
ce.parse('2 + 2').isEqual(4); // ➔ true
ce.parse('x') === ce.parse('x'); // ➔ false
```

- `isSame()` is structural: fast, no evaluation, compares canonical forms.
- `isEqual()` compares values. With free variables, it answers `undefined`
  when the result depends on their values (`x + 1` vs `5`).
- `isIdenticallyEqual()` checks an identity for every value of the free
  variables. Use it to check that two formulas are equivalent, for example
  a student's answer.
- Never compare expressions with `===` or `==`.

## Variables, Types and Assumptions

```js
ce.assign('r', 2);
ce.parse('\\pi r^2').evaluate(); // ➔ 4pi
ce.declare('n', 'integer');
ce.parse('n').type.toString(); // ➔ "integer"
ce.parse('\\sqrt{s^2}').simplify(); // ➔ |s|
ce.assume(ce.parse('t > 0'));
ce.parse('\\sqrt{t^2}').simplify(); // ➔ t
```

- `ce.assign(name, value)` gives a symbol a value; `ce.declare(name, type)`
  gives it a type; `ce.assume(predicate)` records a fact used by
  `simplify()` and `solve()`.
- These change the engine. Wrap temporary definitions in
  `ce.pushScope()` … `ce.popScope()`, or use a separate engine.
- An unknown symbol is a free variable and an unknown function stays
  symbolic: `ce.parse('f(2)').evaluate()` is `f(2)`, not an error.

```js
ce.parse('x^2 + y + \\pi').unknowns; // ➔ ["x","y"]
```

## Invalid Input

Parsing never throws. Invalid LaTeX produces `Error` subexpressions: check
`isValid`, and read `errors` for the details.

```js
ce.parse('x^2 + 1').isValid; // ➔ true
const bad = ce.parse('\\frac{1}');
bad.isValid; // ➔ false
bad.errors.map((e) => e.json); // ➔ [["Error","'missing'"]]
```

## Compiling to Fast Functions

For repeated numeric evaluation (plotting, sampling), compile the expression
to JavaScript:

```js
import { compile } from '@cortex-js/compute-engine';

const f = compile(ce.parse('x^2 + y'));
f.success; // ➔ true
f.run({ x: 2, y: 1 }); // ➔ 5
compile(ce.parse('g(x)')).success; // ➔ false
```

`success` is `false` when part of the expression cannot be compiled (here the
unknown function `g`); `unsupported` lists the operators involved. The
compiled function only computes with machine numbers.

## Time Limits

A long computation can be canceled. Inside `ce.withTimeLimit(ms, fn)`,
evaluation throws a `CancellationError` once the deadline passes:

```js
import { CancellationError } from '@cortex-js/compute-engine';

let canceled = false;
try {
  ce.withTimeLimit(50, () => ce.parse('\\sum_{k=1}^{10^{9}} \\frac{1}{k}').evaluate());
} catch (e) {
  canceled = e instanceof CancellationError;
}
canceled; // ➔ true
```

`fn` must be synchronous. For asynchronous code, use
`expr.evaluateAsync({ signal })` with an `AbortSignal`.

## Common Traps

| Trap | Instead |
| :--- | :--- |
| `'\frac{1}{2}'` in a JavaScript string: `\f` is a form feed | `'\\frac{1}{2}'` or `` String.raw`\frac{1}{2}` `` |
| Expecting `evaluate()` to return a decimal | `N()`, then `.re` for a JavaScript number |
| Comparing with `===` or `isSame()` for math equality | `isIdenticallyEqual()` for formulas, `isEqual()` for values |
| Expecting `parse()` to keep the input as written | `{ form: 'raw' }`; the default is the canonical form |
| Calling `expr.expand()` or `expr.factor()` | the free functions `expand(expr)`, `factor(expr)` |
| A MathJSON string `"hello"` read as text | it is a symbol; write `"'hello'"` or `{ "str": "hello" }` |
| Wrapping `parse()` in `try`/`catch` to detect bad input | check `expr.isValid` and `expr.errors` |
| `ce.assign()` in shared code leaking into later calls | `ce.pushScope()`/`ce.popScope()`, or a separate engine |
| Passing an `async` function to `ce.withTimeLimit()` | `expr.evaluateAsync({ signal })` |

## Entry Points

| Import | Contents |
| :--- | :--- |
| `@cortex-js/compute-engine` | everything: `ComputeEngine`, LaTeX parsing and serialization, free functions, compilation, type guards |
| `@cortex-js/compute-engine/core` | the engine and type guards, without LaTeX parsing or compilation |
| `@cortex-js/compute-engine/compile` | compilation targets (JavaScript, GLSL, WGSL, Python, interval arithmetic) |
| `@cortex-js/compute-engine/math-json` | MathJSON types and utilities only |
| `@cortex-js/compute-engine/epsil` | `executeEpsil()` to run [Epsil](/epsil/) programs |

The full API reference is at
[cortexjs.io/compute-engine](https://cortexjs.io/compute-engine/). The
library functions and their MathJSON names are the same as in Epsil: the
`epsil doc <name or keywords>` command, or the MCP `doc` tool, looks them up.
