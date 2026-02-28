# Migration Guide: 0.54.x to 0.55.0

## Overview

Version 0.55.0 splits the package into seven independently importable sub-paths.
The full `@cortex-js/compute-engine` import still works and re-exports
everything, so **if you don't want to change anything, your code will mostly
work** — with a few breaking API changes listed below.

## Quick Reference

| 0.54.x | 0.55.0 |
| --- | --- |
| `ce.box(input)` | `ce.expr(input)` |
| `ce.latexDictionary` | `new LatexSyntax({ dictionary })` |
| `ce.latexDictionary = [...]` | `new LatexSyntax({ dictionary: [...] })` |
| `ComputeEngine.getLatexDictionary()` | `import { LATEX_DICTIONARY }` |
| `isBoxedExpression(x)` | `isExpression(x)` |
| `isBoxedNumber(x)` | `isNumber(x)` |
| `isBoxedSymbol(x)` | `isSymbol(x)` |
| `isBoxedFunction(x)` | `isFunction(x)` |
| `isBoxedString(x)` | `isString(x)` |
| `isBoxedTensor(x)` | `isTensor(x)` |

## Breaking Changes

### 1. `ce.box()` renamed to `ce.expr()`

The method has been renamed for clarity. A deprecated `box()` wrapper still
exists and will forward to `expr()`, but it will be removed in a future version.

```ts
// Before
const e = ce.box(['Add', 'x', 1]);

// After
const e = ce.expr(['Add', 'x', 1]);
```

The free function is also renamed:

```ts
// Before
import { box } from '@cortex-js/compute-engine';
const e = box(['Add', 'x', 1]);

// After
import { expr } from '@cortex-js/compute-engine';
const e = expr(['Add', 'x', 1]);
```

### 2. `ce.latexDictionary` removed

The `latexDictionary` getter and setter on `ComputeEngine` are removed. LaTeX
dictionaries are now managed by the standalone `LatexSyntax` class.

```ts
// Before
ce.latexDictionary = [
  ...ce.latexDictionary,
  {
    latexTrigger: '\\placeholder',
    parse: (parser) => {
      parser.parseOptionalGroup();
      return parser.parseGroup() ?? ['Error', "'missing'"];
    },
  },
];

// After
import { LatexSyntax, LATEX_DICTIONARY } from '@cortex-js/compute-engine';
// Or: import { LatexSyntax, LATEX_DICTIONARY } from '@cortex-js/compute-engine/latex-syntax';

const syntax = new LatexSyntax({
  dictionary: [
    ...LATEX_DICTIONARY,
    {
      latexTrigger: '\\placeholder',
      parse: (parser) => {
        parser.parseOptionalGroup();
        return parser.parseGroup() ?? ['Error', "'missing'"];
      },
    },
  ],
});

const mathJson = syntax.parse('\\placeholder{x}');
```

### 3. `ComputeEngine.getLatexDictionary()` removed

The static method is replaced by direct imports of dictionary constants.

```ts
// Before
const dict = ComputeEngine.getLatexDictionary();

// After
import { LATEX_DICTIONARY } from '@cortex-js/compute-engine';
```

Individual domain dictionaries are also available:

```ts
import {
  CORE_DICTIONARY,
  ARITHMETIC_DICTIONARY,
  TRIGONOMETRY_DICTIONARY,
  CALCULUS_DICTIONARY,
  // ... etc.
} from '@cortex-js/compute-engine';
```

### 4. Deprecated type guard aliases removed

The `isBoxed*` aliases were deprecated in 0.52.0 and are now removed.

```ts
// Before
import { isBoxedExpression, isBoxedNumber } from '@cortex-js/compute-engine';

// After
import { isExpression, isNumber } from '@cortex-js/compute-engine';
```

### 5. `latexDictionary` field removed from `LibraryDefinition`

If you were passing custom library definitions with `latexDictionary` entries
to the `ComputeEngine` constructor, that field is no longer recognized. Define
your LaTeX entries via a `LatexSyntax` instance instead.

```ts
// Before
const ce = new ComputeEngine({
  libraries: [{
    name: 'mylib',
    latexDictionary: [{ latexTrigger: '\\myop', parse: 'MyOp' }],
    operators: { MyOp: { ... } },
  }],
});

// After
import { LatexSyntax, LATEX_DICTIONARY } from '@cortex-js/compute-engine';

const ce = new ComputeEngine({
  libraries: [{
    name: 'mylib',
    operators: { MyOp: { ... } },
  }],
});

const syntax = new LatexSyntax({
  dictionary: [
    ...LATEX_DICTIONARY,
    { latexTrigger: '\\myop', parse: 'MyOp' },
  ],
});
```

### 6. Compilation registry methods now `@internal`

`ce.registerCompilationTarget()`, `ce.getCompilationTarget()`,
`ce.listCompilationTargets()`, and `ce.unregisterCompilationTarget()` are no
longer part of the public API. Use the `compile()` function directly with a
target:

```ts
// Before
ce.registerCompilationTarget('glsl', new GLSLTarget());
const result = expr.compile({ to: 'glsl' });

// After
import { compile, GLSLTarget } from '@cortex-js/compute-engine';
// Or: import { compile, GLSLTarget } from '@cortex-js/compute-engine/compile';

const result = compile(expr, { to: 'glsl' });
// Or with an explicit target instance:
const result = compile(expr, { target: new GLSLTarget() });
```

## New Sub-Path Imports

If you only need a subset of the library, you can import from specific
sub-paths to enable smaller bundles:

### LaTeX parsing only

```ts
import { parse, serialize, LatexSyntax } from '@cortex-js/compute-engine/latex-syntax';

const mathJson = parse('\\frac{x}{2}');      // MathJSON
const latex = serialize(['Divide', 'x', 2]); // LaTeX string
```

### Interval arithmetic only

```ts
import { add, mul, sin, point } from '@cortex-js/compute-engine/interval';

const x = point(0.5);
const result = sin(x); // guaranteed enclosure
```

### Numeric functions only

```ts
import { gamma, erf, besselJ } from '@cortex-js/compute-engine/numerics';

gamma(5);    // 24
erf(1.0);    // 0.8427...
```

### Core engine (no LaTeX, no compilation)

```ts
import { ComputeEngine, expr, simplify } from '@cortex-js/compute-engine/core';

const ce = new ComputeEngine();
const e = ce.expr(['Add', ['Power', 'x', 2], 1]);
e.simplify();
```

### Compilation targets only

```ts
import { compile, JavaScriptTarget } from '@cortex-js/compute-engine/compile';
```

### Full package (unchanged)

```ts
import { ComputeEngine, parseLatex, compile } from '@cortex-js/compute-engine';
```

Note: In the full package, the LaTeX free functions are exported as `parseLatex`
and `serializeLatex` to avoid name conflicts with the `parse` free function
(which accepts `LatexString | ExpressionInput`).

## Methods That Still Work

The following convenience methods were **kept** on `ComputeEngine` and
`BoxedExpression` even though standalone alternatives exist:

| Method | Still works? | Standalone alternative |
| --- | --- | --- |
| `ce.parse(latex)` | Yes | `parse(latex)` from `latex-syntax` + `ce.expr()` |
| `expr.latex` | Yes | `serialize(expr.json)` from `latex-syntax` |
| `expr.toLatex()` | Yes | `serialize(expr.json)` from `latex-syntax` |
| `ce.box(input)` | Yes (deprecated) | `ce.expr(input)` |

These convenience methods use the standalone `LatexSyntax` internally and
will continue to work for the foreseeable future.
