# Package Modularization Design

## Goal

Split the monolithic `@cortex-js/compute-engine` package (1 MB minified) into
independently importable sub-paths. Users who only need LaTeX parsing, interval
arithmetic, or the core engine without compilation targets should be able to
import only what they need.

Backward compatibility is not a concern. Breaking API changes are acceptable.

## Module Map

Seven package exports, ordered from leaf to root:

```
@cortex-js/compute-engine/math-json      → MathJSON types + utils (existing)
@cortex-js/compute-engine/latex-syntax    → LaTeX ↔ MathJSON (new)
@cortex-js/compute-engine/interval        → Interval arithmetic (new)
@cortex-js/compute-engine/numerics        → Special functions, rationals, bignum (new)
@cortex-js/compute-engine/core            → ComputeEngine class + expr() (new)
@cortex-js/compute-engine/compile         → Compilation targets (new)
@cortex-js/compute-engine                 → Full package: re-exports all + free functions
```

### Dependency Graph

```
math-json ←── latex-syntax
           ←── numerics
           ←── interval (standalone, no deps on math-json)

latex-syntax ─┐
numerics ─────┤→ core (ComputeEngine class)
interval ─────┘

core ──→ compile (needs BoxedExpression to walk expression trees)
```

## Module APIs

### `@cortex-js/compute-engine/math-json`

Unchanged from today. MathJSON types and utility functions.

```ts
import type { MathJsonExpression } from '@cortex-js/compute-engine/math-json';
import { operator, operands, symbol } from '@cortex-js/compute-engine/math-json';
```

### `@cortex-js/compute-engine/latex-syntax`

LaTeX ↔ MathJSON conversion. No engine dependency. No BoxedExpression.

```ts
import {
  LatexSyntax,
  parse,                    // free function, lazy singleton
  serialize,                // free function, lazy singleton
  LATEX_DICTIONARY,         // full default dictionary
  ARITHMETIC_DICTIONARY,    // individual domain dictionaries
  CALCULUS_DICTIONARY,
  TRIGONOMETRY_DICTIONARY,
  // ... one constant per domain
} from '@cortex-js/compute-engine/latex-syntax';
```

**Free functions** (lazy `LatexSyntax` singleton behind the scenes):

```ts
const json = parse('\\frac{x}{2}');           // → MathJsonExpression
const latex = serialize(['Divide', 'x', 2]);  // → string
```

**Custom setup** (explicit instance):

```ts
const syntax = new LatexSyntax({
  dictionary: [ARITHMETIC_DICTIONARY, CALCULUS_DICTIONARY],
  decimalSeparator: ',',
});
syntax.parse('1,5 + x');
syntax.serialize(['Add', 1.5, 'x']);
```

**`LatexSyntax` class**: Holds the indexed dictionary (built lazily on first
use) and options. `parse()` returns `MathJsonExpression`. `serialize()` takes
`MathJsonExpression`. The serializer already works on raw MathJSON internally.

**Dictionary constants**: Each existing `definitions-*.ts` file becomes a named
export. `LATEX_DICTIONARY` is their concatenation. Dictionaries are pure data
arrays with no engine references.

### `@cortex-js/compute-engine/interval`

Fully standalone interval arithmetic. No changes from current internal API.

```ts
import {
  add, mul, sin, pow, point, ok,
  type Interval, type IntervalResult,
} from '@cortex-js/compute-engine/interval';

const x = point(0.5);
const result = sin(x);  // → { lo: 0.479..., hi: 0.479... }
```

### `@cortex-js/compute-engine/numerics`

Standalone pure numeric functions. No engine, no expressions.

```ts
import {
  gamma, erf, erfc, gcd, lcm,
  besselJ, besselY, fresnelS,
  // rational arithmetic, complex arithmetic,
  // bignum support, primes, statistics, monte carlo
} from '@cortex-js/compute-engine/numerics';

gamma(5);     // → 24
erf(1.0);     // → 0.8427...
```

### `@cortex-js/compute-engine/core`

The ComputeEngine class and `expr()`. No LaTeX, no compilation.

```ts
import { ComputeEngine, expr } from '@cortex-js/compute-engine/core';

const ce = new ComputeEngine();
const e = ce.expr(['Add', ['Power', 'x', 2], 1]);

// Free function version (lazy global engine)
const e2 = expr(['Add', 'x', 1]);

// All computation on BoxedExpression
e.simplify();
e.evaluate();
e.N();
e.solve('x');
e.expand();
e.factor();
e.match(['Add', '_a', '_b']);
e.json;         // → MathJsonExpression
e.toString();   // → ASCII math
```

**`LatexSyntax` is an injectable dependency** (implemented):

`ComputeEngine` accepts an optional `latexSyntax` constructor option. When
importing the full package, a `LatexSyntax` is auto-created via a static
factory. When importing only from `/core`, no `LatexSyntax` is bundled.

- `ce.parse()` — available when `LatexSyntax` is injected, throws otherwise
- `ce.latexSyntax` — getter returning the `ILatexSyntax` instance or `undefined`
- `ce._requireLatexSyntax()` — returns instance or throws with clear message

**Removed from `ComputeEngine`**:

- `ce.latexDictionary` (get/set) — owned by `LatexSyntax`
- `ce.decimalSeparator` — moves to `LatexSyntax` options
- `static getLatexDictionary()` — moves to latex-syntax exports
- `registerCompilationTarget()`, `getCompilationTarget()`,
  `listCompilationTargets()`, `unregisterCompilationTarget()` — registry removed
- `_compile()` — replaced by free `compile()` in compile module

**Still on `BoxedExpression`** (require injected LatexSyntax):

- `.toLatex()` / `.latex` — available when `LatexSyntax` is injected; alternatively use `serialize(expr.json)` from latex-syntax directly
- `.compile()` — use `compile(expr)` from compile module

**Renamed**:

- `ce.box()` → `ce.expr()`

**Library loading**: The `libraries` constructor option stays. Library
definitions no longer bundle LaTeX dictionaries — they only define operators
(evaluate, simplify, canonical handlers). LaTeX dictionaries are entirely owned
by the latex-syntax module.

### `@cortex-js/compute-engine/compile`

Compilation targets. Depends on core (needs BoxedExpression).

```ts
import {
  compile,
  JavaScriptTarget, GLSLTarget, WGSLTarget,
  PythonTarget, IntervalJavaScriptTarget,
  BaseCompiler,
} from '@cortex-js/compute-engine/compile';

// Built-in target by name
compile(e, { to: 'javascript' });

// Explicit target instance
compile(e, { target: new GLSLTarget() });

// Options
compile(e, { to: 'javascript', realOnly: true });
```

**No registry**: Targets are passed directly to `compile()`. Built-in names are
resolved internally without engine state.

### `@cortex-js/compute-engine` (full package)

Re-exports everything from all sub-paths. Adds convenience free functions.

```ts
// Re-exports
export * from './math-json';
export * from './latex-syntax';
export * from './interval';
export * from './numerics';
export * from './core';
export * from './compile';

// Free functions
export { simplify, evaluate, N, expand, expandAll, factor, solve,
         declare, assign };
```

## Free Functions

All expression-accepting free functions uniformly accept
`string | MathJsonExpression | Expression`:

- **string**: treated as LaTeX, parsed via lazy `LatexSyntax` singleton
- **MathJsonExpression**: boxed via lazy global `ComputeEngine`
- **Expression**: passed through directly

```ts
import { expr, simplify, evaluate, N, expand, expandAll,
         factor, solve, compile } from '@cortex-js/compute-engine';

// All equivalent:
simplify('x^2 + 2x + 1');
simplify(['Add', ['Power', 'x', 2], ['Multiply', 2, 'x'], 1]);
simplify(expr(parse('x^2 + 2x + 1')));
```

**Special cases**:

- `parse(latex: string) → MathJsonExpression` — re-exported from latex-syntax,
  takes LaTeX only, returns MathJSON
- `serialize(expr: MathJsonExpression) → string` — re-exported from
  latex-syntax, takes MathJSON only, returns LaTeX
- `declare(...)`, `assign(...)` — take symbol names + definitions, not
  expressions

## Breaking Changes Summary

| Changed | Replacement |
| --- | --- |
| `ce.parse(latex)` | Still available when `LatexSyntax` is injected; or `ce.expr(parse(latex))` |
| `expr.toLatex()` / `expr.latex` | Still available when `LatexSyntax` is injected; or `serialize(expr.json)` |
| `expr.compile(options)` | `compile(expr, options)` |
| `ce.box(input)` | `ce.expr(input)` |
| `ce.latexDictionary` | `new LatexSyntax({ dictionary })` |
| `ce.decimalSeparator` | `new LatexSyntax({ decimalSeparator })` |
| `ce.registerCompilationTarget()` | pass target to `compile()` directly |
| `static getLatexDictionary()` | import dictionaries from latex-syntax |
| Free `box()` | Free `expr()` |

## Build Output

Each sub-path produces its own bundle (ESM + UMD, minified + non-minified). The
root entry point bundles everything (same as today's monolith).

```
dist/math-json.min.esm.js         ~2 KB
dist/latex-syntax.min.esm.js       ~130 KB
dist/interval.min.esm.js           ~25 KB
dist/numerics.min.esm.js           ~90 KB
dist/core.min.esm.js               ~550 KB
dist/compile.min.esm.js            ~180 KB
dist/compute-engine.min.esm.js     ~1 MB (everything)
```

## Dead Code Removal

20+ files in `src/common/` are never imported: `buffer.ts`, `json5.ts`,
`markdown*.ts`, `parser.ts`, `result.ts`, `sigil.ts`, `styled-text.ts`,
`syntax-highlighter.ts`, `terminal.ts`, and several `type/` files. These should
be removed.
