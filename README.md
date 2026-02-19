<div align="center">
    <img alt="math live" src="assets/compute-engine.jpg?raw=true"/>
</div>

<h3><strong>Cortex Compute Engine</strong></h3>
<h1>Symbolic manipulation and numeric evaluation of MathJSON expressions</h1>

[MathJSON](https://cortexjs.io/math-json/) is a lightweight mathematical
notation interchange format based on JSON.

The Cortex Compute Engine can parse LaTeX to MathJSON, serialize MathJSON to
LaTeX or MathASCII, format, simplify and evaluate MathJSON expressions.

Reference documentation and guides at
[cortexjs.io/compute-engine](https://cortexjs.io/compute-engine/).

[![](https://dcbadge.vercel.app/api/server/yhmvVeJ4Hd)](https://discord.gg/yhmvVeJ4Hd)

## Installation

```bash
$ npm install --save @cortex-js/compute-engine
```

## Quick Start

### Basic Parsing and Evaluation

No setup required:

```js
import { simplify, evaluate, N, assign } from "@cortex-js/compute-engine";

simplify("x + x + 1").print();
// ➔ 2x + 1

evaluate("2^{11} - 1").print();
// ➔ 2047

N("\\sqrt{2}").print();
// ➔ 1.414213562...

assign("x", 3);
evaluate("x + 2").print();
// ➔ 5
```

These functions use a shared `ComputeEngine` instance created on first use. Use
`getDefaultEngine()` to configure it, or create your own instance for isolated
configurations.

### Working with Numbers (Type-Safe)

Use type guards to safely access specialized properties:

```js
import { evaluate, isNumber } from "@cortex-js/compute-engine";

const expr = evaluate("\\frac{5}{2}");

if (isNumber(expr)) {
  console.log(expr.numericValue);  // 2.5 (type-safe access)
  console.log(expr.isInteger);     // false
}
```

### Working with Symbols

```js
import { parse, isSymbol, sym } from "@cortex-js/compute-engine";

const expr = parse("x + 1");

// Check if expression is a specific symbol
if (sym(expr) === "x") {
  console.log("This is the variable x");
}

// Or use full type guard for more access
const variable = parse("y");
if (isSymbol(variable)) {
  console.log(variable.symbol);  // "y"
}
```

### Working with Functions

```js
import { parse, isFunction } from "@cortex-js/compute-engine";

const expr = parse("2x + 3y");

// Access function structure safely
if (isFunction(expr)) {
  console.log(expr.operator);    // "Add"
  console.log(expr.ops.length);  // 2

  // Iterate over operands
  for (const op of expr.ops) {
    console.log(op.toString());
  }
}
```

### Simplification and Manipulation

```js
import { parse, simplify, expand } from "@cortex-js/compute-engine";

// Simplify expressions
simplify("x + x").print();
// ➔ 2x

// Expand from LaTeX or Expression
expand("(x + 1)^2").print();
// ➔ x^2 + 2x + 1

// Substitute values
const expr = parse("x^2 + 2x + 1");
expr.subs({ x: 3 }).evaluate().print();
// ➔ 16
```

### Solving Equations

```js
import { solve, parse } from "@cortex-js/compute-engine";

// Solve from LaTeX
solve("x^2 - 5x + 6 = 0", "x");
// ➔ [2, 3]

// Solve a linear system
const system = parse("\\begin{cases}x+y=5\\\\x-y=1\\end{cases}");
const solution = system.solve(["x", "y"]);

console.log(solution.x.json);  // 3
console.log(solution.y.json);  // 2
```

**💡 Best Practices:**

- Always use type guards (`isNumber`, `isSymbol`, `isFunction`) before accessing
  specialized properties
- Use the `sym()` helper for quick symbol name checks

**📚 Learn More:**
[Full documentation and guides](https://cortexjs.io/compute-engine/)

## FAQ

**Q** How do I build the project?

[Build](BUILD.md) instructions

## Related Projects

<dl>
  <dt><a href="https://cortexjs.io/math-json/">MathJSON</a></dt>
  <dd>A lightweight mathematical notation interchange format</dd>  
  <dt><a href="https://cortexjs.io/mathlive">MathLive</a> (on <a href="https://github.com/arnog/mathlive">GitHub</a>)</dt>
  <dd>A Web Component for math input.</dd>  
</dl>

## Support the Project

- <span style='font-size:1.5em'>🌟</span> Star the GitHub repo (it really helps)
- <span style='font-size:1.5em'>💬</span> Ask questions and give feedback on our
  [Discussion Forum](https://cortexjs.io/forum/)
- <span style='font-size:1.5em'>📨</span> Drop a line to arno@arno.org

## License

This project is licensed under the [MIT License](LICENSE).
