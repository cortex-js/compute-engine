**NOTE** The following document has been authored by the maintainers of a
scientific plotting library that integrates the Compute Engine for LaTeX
expression compilation. It provides context on how CE is used within the
plotting system and the section "Requests for CE Maintainers" outlines specific
features and fixes needed from CE to support the plotting use case.

# Compute Engine Integration

How the Compute Engine (CE) is used for compiling LaTeX expressions into
executable functions for the plotting system.

## Overview

The plotting components (`<math-plot>`, `<math-plot-3d>`) accept LaTeX strings
as function definitions. These are compiled to JavaScript (and optionally
interval arithmetic or GLSL/WGSL) functions via the
[Compute Engine](https://cortexjs.io/compute-engine/).

**Key files:**

| File                         | Role                                                     |
| ---------------------------- | -------------------------------------------------------- |
| `src/plotting/ce-compile.ts` | Compilation mechanics                                    |
| `src/plotting/resolve-fn.ts` | CE discovery, series-type dispatch, shorthand resolution |

## CE Discovery

The CE is discovered at runtime via a well-known global symbol:

```ts
globalThis[Symbol.for("io.cortexjs.compute-engine")].ComputeEngine;
```

A singleton CE instance is cached after first use. If CE is not available, a
console warning is emitted and functions resolve to `() => NaN`.

This design keeps CE out of the main bundle — users load it separately.

## Compilation API

CE >= 0.51.1 provides a target-based compilation API. There are three ways to
compile:

```ts
// 1. Free function (accepts LaTeX strings or BoxedExpression)
import { compile } from "@cortexjs/compute-engine";
const result = compile("\\sin(x)", { to: "javascript" });

// 2. Via a compilation target
const target = ce.getCompilationTarget("javascript");
const expr = ce.parse("\\sin(x)");
const result = target.compile(expr);

// 3. Internal engine method (marked @internal)
const result = ce._compile(expr, { to: "interval-js" });
```

Use `ce.listCompilationTargets()` to discover available targets at runtime
rather than hardcoding target names.

### CompilationResult

| Field      | Type        | Description                                                   |
| ---------- | ----------- | ------------------------------------------------------------- |
| `target`   | `string`    | Target language name                                          |
| `success`  | `boolean`   | Whether compilation succeeded                                 |
| `code`     | `string`    | Generated source code                                         |
| `preamble` | `string?`   | Helper/library code needed by `code` (shader targets)         |
| `run`      | `function?` | Pre-compiled function with runtime already bound (JS targets) |

**Always prefer `run` over `code`.** The `run` function has the runtime (`Math`
and system functions for JS, `_IA` for intervals) already bound, so it's ready
to call. The `code` string references `_` as the variable object and `_SYS` /
`_IA` as runtime objects, which makes it fragile to evaluate manually.

**GLSL preamble handling:** When CE's `glsl` target returns a `preamble` (helper
function definitions needed by `code`), both are stored in the `PlotFunction`:
`{ kind: "glsl", source: code, preamble }`. The shader injection places the
preamble before the `userFn` definition at the shader's top level, so helper
functions are available when `userFn` calls them.

**`run` type signature:** `run?: (...args: unknown[]) => number | { re, im }`.
Covers both calling conventions: vars-object for plain expressions
(`run({ x: 0.5 })`) and positional args for lambda expressions (`run(0.5)`).

### Compilation Targets

| Target            | Returns                    | Used for                                                   |
| ----------------- | -------------------------- | ---------------------------------------------------------- |
| `"javascript"`    | `(vars) => number`         | All series types                                           |
| `"interval-js"`   | `(vars) => IntervalResult` | Line series (break detection), implicit curves             |
| `"glsl"`          | GLSL source string         | Heatmaps, implicit curves, parametric (GPU)                |
| `"wgsl"`          | WGSL source string         | WebGPU rendering                                           |
| `"interval-glsl"` | GLSL source with IA        | GPU-accelerated implicit curves with singularity detection |
| `"interval-wgsl"` | WGSL source with IA        | WebGPU interval arithmetic                                 |

Custom targets (e.g., Python) can be registered with
`ce.registerCompilationTarget()`.

## TypeScript Types

CE exports its types from the main package entry:

```ts
import type {
  ComputeEngine,
  Expression,
  CompilationResult,
} from "@cortex-js/compute-engine";
import { isFunction, isSymbol } from "@cortex-js/compute-engine";
```

### The `Expression` Interface

`Expression` is the base interface for all boxed expressions. It includes common
properties like `operator`, `unknowns`, `symbols`, `isValid`, `latex`, etc.

**Properties directly on `Expression`:**

| Property    | Type                    | Description                                 |
| ----------- | ----------------------- | ------------------------------------------- |
| `operator`  | `string`                | Operator name (`"Add"`, `"Function"`, etc.) |
| `unknowns`  | `ReadonlyArray<string>` | Free variables (unbound symbols)            |
| `symbols`   | `ReadonlyArray<string>` | All symbols (including bound)               |
| `isValid`   | `boolean`               | No `["Error"]` subexpressions               |
| `latex`     | `string`                | LaTeX serialization                         |
| `re` / `im` | `number`                | Real/imaginary parts (if numeric)           |

### Narrowed Interfaces and Type Guards

Some properties are only available on specific expression kinds. CE uses
TypeScript type guards to narrow `Expression` to a sub-interface:

| Type Guard     | Narrows To                            | Unlocks                                 |
| -------------- | ------------------------------------- | --------------------------------------- |
| `isFunction()` | `Expression & FunctionInterface`      | `.ops`, `.nops`, `.op1`, `.op2`, `.op3` |
| `isSymbol()`   | `Expression & SymbolInterface`        | `.symbol`                               |
| `isNumber()`   | `Expression & NumberLiteralInterface` | `.numericValue`                         |
| `isString()`   | `Expression & StringInterface`        | `.string`                               |

**Accessing `.ops` or `.symbol` without narrowing is a type error:**

```ts
// WRONG — .ops is not on Expression
const ops = expr.ops;

// CORRECT — narrow first
if (isFunction(expr)) {
  const ops = expr.ops; // ReadonlyArray<Expression>
  const arity = expr.nops; // number
}

// CORRECT — narrow to access .symbol
if (isSymbol(expr)) {
  const name = expr.symbol; // string
}
```

### `BoxedExpression` (deprecated) and `ExpressionInput`

- `BoxedExpression` is deprecated — use `Expression` instead (they are
  identical, `BoxedExpression` is just a type alias)
- `ExpressionInput` is the union of all types accepted as input:
  `number | bigint | string | MathJsonExpression | Expression | ...`
- `ce.parse()` returns `Expression`

## Expressions and Lambdas

CE can compile both plain expressions and lambda expressions (`\mapsto`):

```ts
// Plain expression — variables are inferred as unknowns
const expr = ce.parse("\\cos(t)");
expr.unknowns; // ["t"]
const result = compile(expr, { to: "javascript" });
result.run({ t: 0.5 }); // → 0.8776

// Lambda — the variable is explicitly bound
const lambda = ce.parse("t \\mapsto \\cos(t)");
const result = compile(lambda, { to: "javascript" });
result.run({ t: 0.5 }); // → 0.8776
```

Lambdas are useful when accepting user-provided expressions where the variable
name is user-specified rather than assumed by convention. A lambda like
`\theta \mapsto 1 + \cos(\theta)` makes the parameter explicit, avoiding
ambiguity about which symbol is the independent variable.

For multi-variable lambdas:

```latex
(x, y) \mapsto x^2 + y^2
```

## Variable Names

CE compiled functions expect a vars object keyed by the expression's actual
variable names:

```ts
// CE parses \theta to variable name "theta"
const expr = ce.parse("1 + \\cos(\\theta)");
const result = target.compile(expr);

// CORRECT:
result.run({ theta: 0.5 }); // → 1.8776

// WRONG (silent failure — returns null or NaN):
result.run({ x: 0.5 }); // → null
```

### Extracting Variable Names

Use `expr.unknowns` to discover the free variables in an expression:

```ts
const expr = ce.parse("1 + \\cos(\\theta)");
const unknowns = expr.unknowns; // ["theta"]
```

Common variable name mappings:

| LaTeX    | CE Variable Name |
| -------- | ---------------- |
| `x`      | `"x"`            |
| `y`      | `"y"`            |
| `t`      | `"t"`            |
| `\theta` | `"theta"`        |
| `\alpha` | `"alpha"`        |
| `u`, `v` | `"u"`, `"v"`     |

### Convention by Series Type

All series types use `extractVarNames()` which follows the fallback chain:
lambda params → `expr.unknowns` → caller-provided defaults. The "Default" column
shows the fallback when neither lambda nor unknowns is available.

| Series                | Default Variables | Notes                                    |
| --------------------- | ----------------- | ---------------------------------------- |
| Line                  | `x`               | Interval wrappers remap to external `x`  |
| Implicit              | `x`, `y`          | Interval wrappers remap to external x, y |
| Polar                 | `theta`           |                                          |
| Parametric 2D         | `t`               |                                          |
| Parametric 3D curve   | `t`               |                                          |
| Parametric 3D surface | `u`, `v`          |                                          |
| 3D surface            | `x`, `y`          |                                          |

## Tuple Parsing

Parametric functions use LaTeX tuple syntax:

```latex
(\cos(t), \sin(t))           % 2D parametric
(\cos(t), \sin(t), t/(2\pi)) % 3D parametric curve
```

CE parses `(a, b)` as a `Delimiter` expression initially. During
canonicalization, if the body is a `Sequence`, it is converted to a `Tuple`. On
canonical expressions, check for `"Tuple"`:

```ts
const expr = ce.parse("(\\cos(t), \\sin(t))");
// expr.operator === "Tuple"
// expr.ops === [cos_expr, sin_expr]
```

`"List"` is a distinct construct for square-bracket syntax (`[a, b]`) and should
not be confused with tuples.

### Compilation Strategy

CE compiles `Tuple` expressions to array-returning functions:

```ts
const expr = ce.parse("(\\cos(t), \\sin(t))");
const result = target.compile(expr, { realOnly: true });
result.run({ t: 0 }); // → [1, 0]
```

No component-by-component fallback is needed.

## Series-Type Compilation Strategy

Different series types need different compilation targets. The dispatch logic
lives in `resolve-fn.ts`:

| Series Type   | Preferred Target              | Rationale                                                   |
| ------------- | ----------------------------- | ----------------------------------------------------------- |
| Line          | `interval-js` → `js`          | IA is critical for detecting asymptotes and discontinuities |
| Implicit      | `interval-js` → `glsl` → `js` | IA for quadtree refinement, GLSL for grid rendering         |
| Heatmap       | `glsl` → `js`                 | Per-pixel GPU rendering is the practical path               |
| Polar         | `js` only (scalar)            | Polar renderer only accepts `kind: "js"`                    |
| Parametric    | `js` only (scalar)            | Auto-bounds needs CPU evaluation before viewport is known   |
| Vector field  | `js` only                     | Scalar evaluation at grid points                            |
| 3D surface    | `js` only (scalar)            | Geometry builder requires plain function                    |
| 3D parametric | `js` only (scalar)            | Component-wise scalar compilation                           |

Consider using `interval-glsl` for implicit curves — it provides singularity
detection directly in the shader, which could enable GPU-accelerated quadtree
refinement without round-tripping to JS.

## Interval Arithmetic Results

The `interval-js` target returns `IntervalResult` objects:

| Kind         | Meaning                      | Shape                                                                       |
| ------------ | ---------------------------- | --------------------------------------------------------------------------- |
| `"interval"` | Bounded result               | `{ kind: "interval", value: { lo: 0.5, hi: 1.2 } }`                         |
| `"singular"` | Singularity or discontinuity | `{ kind: "singular", at?: number, continuity?: "left"\|"right" }`           |
| `"partial"`  | Valid but domain-clipped     | `{ kind: "partial", value: { lo, hi }, domainClipped: "lo"\|"hi"\|"both" }` |
| `"empty"`    | No valid result              | `{ kind: "empty" }`                                                         |
| `"entire"`   | Result spans all reals       | `{ kind: "entire" }`                                                        |

Note that `"interval"` results nest `lo`/`hi` inside a `value` object — they are
not top-level fields.

The `"singular"` kind can optionally report _where_ the singularity occurs
(`at`) and whether the function is continuous from the left or right
(`continuity`). The plotting system can use endpoint y-magnitudes relative to
the viewport to distinguish poles (vertical asymptotes) from finite jumps (step
functions).

The `"partial"` kind signals that the result is valid but one or both input
endpoints were clipped to the function's domain (e.g., `sqrt(x)` evaluated over
an interval that includes negative values). This is useful for plotting
functions near domain boundaries.

### Input Conversion

The interval-js `run` function automatically converts plain numbers to point
intervals via an internal `processInput` step:

```ts
// Both are valid — numbers are auto-converted to { lo: n, hi: n }
intervalRun({ x: { lo: 0.5, hi: 0.6 } }); // explicit interval
intervalRun({ x: 0.5 }); // auto-converted to point interval
```

## Complex Number Support

The JavaScript target supports complex arithmetic. With the `realOnly`
compilation option, complex results are automatically converted:

```ts
const result = compile(expr, { to: "javascript", realOnly: true });
result.run({ x: -1 }); // → NaN (sqrt of negative → complex → NaN)
result.run({ x: 4 }); // → 2.0 (real result passes through)
```

Without `realOnly`, the `run` function may return `{ re, im }` objects. The
plotting system always uses `realOnly: true`.

## Error Handling

All compilation paths are wrapped with error catching:

- **Compilation failure**: Falls back to interpretation (`success: false`), with
  `run` set to the expression's numeric evaluator. If `fallback: false` is
  passed in options, throws instead.
- **JS runtime errors**: Wrappers catch exceptions and return `NaN` (scalar) or
  `[NaN, NaN]` / `[NaN, NaN, NaN]` (tuple). No logging — CE runtime errors are
  typically domain errors (e.g., `sqrt(-1)` without `realOnly`) that would
  produce thousands of identical log entries during adaptive sampling.
- **Interval runtime errors**: CE now handles errors gracefully (returns
  `{ kind: "entire" }`). The wrapper returns `{ kind: "empty" }` as a final
  safety net.
- **Missing CE**: Console warning, resolves to `() => NaN`

This ensures a bad expression never crashes the plotting system.

## Architecture Decisions

### Why `ce-compile.ts` and `resolve-fn.ts` are separate

- **`ce-compile.ts`**: Pure compilation — takes a CE instance and LaTeX, returns
  typed function objects. No knowledge of series types or CE discovery.
- **`resolve-fn.ts`**: Orchestration — discovers CE, decides which compilation
  target to use based on series type, handles the `string | function | object`
  shorthand resolution.

This separation means `ce-compile.ts` is testable without a real CE instance and
`resolve-fn.ts` handles the messy real-world concerns.

### Multi-target vs. single-target compilation

`compileJs1D` and `compileJs2D` compile all three targets (JS, interval-js,
GLSL) in one pass. Series types that only need scalar JS (parametric, polar, 3D)
use `compileToParametricFunction`, `compileTo3DParametricCurveFunction`, etc.,
which compile only the JavaScript (and optionally GLSL) target.

### How interval wrappers handle variable names

The `wrapInterval1D` and `wrapInterval2D` functions accept the actual variable
name(s) from `extractVarNames()` but expose a fixed external contract
(`{ x: Interval }` / `{ x: Interval; y: Interval }`). Internally they remap:
`{ [varName]: vars.x }`. This keeps the adaptive sampling code simple (always
uses `x`/`y`) while supporting expressions with non-standard variable names.

In practice, interval arithmetic is only used for line series and implicit
curves, which default to `x` and `x, y` respectively.

## Known CE Gaps and Workarounds

Issues discovered during the conversion of
`tests/visual/plotting/grid_paper.html` from JS arrow functions to LaTeX/CE
compilation. These are documented here so they can be addressed in future CE
releases.

### 1. `expr.unknowns` includes bound summation variables

**Problem:** For expressions with `\sum_{k=0}^{N} f(k, x)`, CE's `expr.unknowns`
returns `["k", "x"]` — the summation index `k` appears as a free unknown
alongside the actual plot variable `x`. When `extractVarNames()` naively took
the first element, it picked `k`, causing the interval wrapper to bind `k`
instead of `x`. At runtime, `x` was unbound and the interval function returned
`{ kind: "entire" }` for every input, producing a blank plot.

**Workaround:** `extractVarNames()` now prefers default variable names when they
appear in `unknowns`. For a line series (default `"x"`), if
`unknowns = ["k", "x"]`, it picks `"x"` first. Remaining slots are filled from
leftover unknowns.

**Upstream fix:** CE should distinguish between bound variables (summation
indices, product indices) and free variables. `expr.unknowns` should only return
truly free variables, or CE should provide a separate `expr.freeVariables`
property.

**Fixed in next version of Compute Engine**

### 2. Interval-js fails for `(-1)^k` in `\sum`

**Problem:** Taylor series like `\sum_{k=0}^{n} \frac{(-1)^k x^{2k+1}}{(2k+1)!}`
fail `interval-js` compilation entirely (`success: false`). The `(-1)^k` pattern
with integer exponentiation is not supported by the interval arithmetic engine.
The `javascript` target compiles these correctly.

**Current behavior:** Falls back to JS scalar correctly — the plot renders, but
without adaptive break detection from interval arithmetic.

**Upstream fix:** Support `(-1)^n` (alternating sign) in the IA engine, at
minimum as a special case returning
`{ kind: "interval", value: { lo: -1, hi: 1 } }`.

**Fixed in next version of Compute Engine**

### 3. Degenerate interval probe (defense-in-depth)

**Problem:** When an interval function returns `{ kind: "entire" }` for all
inputs (due to gap #1 or unsupported operations), the adaptive sampler
interprets every interval as a potential asymptote. This produces entirely blank
plots with no visible error — a silent failure mode.

**Workaround:** `isIntervalDegenerate1D()` and `isIntervalDegenerate2D()` probe
the compiled interval function with 3 sample inputs at compile time. If all
return `{ kind: "entire" }`, the interval function is discarded and only the JS
scalar function is kept. This catches degenerate interval compilation before it
reaches the renderer.

### 4. Interval-js returns raw `{lo, hi}` for `\text{if}` constant branches

**Problem:** When `\text{if}...\text{then}...\text{else}` is compiled to
`interval-js`, constant branches (e.g., `0` or `1`) return raw `{lo, hi}`
objects instead of the expected `{kind: "interval", value: {lo, hi}}` format.
Complex expression branches return the proper format. This inconsistency causes
the adaptive sampler to receive unrecognized result types, producing blank
plots.

Example: `\text{if}\; x \geq 0 \;\text{then}\; 1 \;\text{else}\; 0`

- For `x ∈ [-1, -0.5]`: returns `{lo: 0, hi: 0}` (raw — missing `kind` wrapper)
- For `x ∈ [3, 4]`: returns `{lo: 1, hi: 1}` (raw — missing `kind` wrapper)

The degenerate probe (gap #3) also missed this because `{lo: 0, hi: 0}.kind` is
`undefined` (not `"entire"`), so it incorrectly classified the function as
non-degenerate.

**Workaround:** `normalizeIntervalResult()` in `ce-compile.ts` normalizes raw
`{lo, hi}` objects to `{kind: "interval", value: {lo, hi}}` at the wrapper
boundary. Both `wrapInterval1D` / `wrapInterval2D` and the degenerate probes now
go through this normalizer.

**Upstream fix:** CE's `interval-js` compilation target should always return
properly typed `IntervalResult` objects, regardless of whether the expression is
a constant, a conditional branch, or a complex expression. **This has been
confirmed as a known issue and will be resolved in the next CE release.** The
`normalizeIntervalResult()` workaround should be kept as defense-in-depth.

### 5. `;\;` (semicolon + thin space) breaks CE parsing

**Problem:** When semicolon block statements use `;\;` as the separator
(semicolon followed by LaTeX thin space `\;`), CE mis-parses the expression. The
`\;` after a semicolon creates an `InvisibleOperator` node in the parse tree,
which makes `expr.isValid` return `false` and causes `compile()` to fail with
`success: false`. The expression still evaluates at runtime via CE's slower
expression interpreter (because `run` is always set even when `success` is
`false`), so plots render but without the performance benefits of compiled code.

**Example:** `a \coloneq ((x-1)^2 + y^2)^{1.5};\; (x/a)` — `expr.unknowns`
includes `InvisibleOperator`, `expr.isValid` is `false`, and all compilation
targets return `success: false`.

**Discovery:** All four semicolon block expressions in `grid_paper.html`
(Joukowski, Seashell, Gravitational Potential, Electric Dipole) were affected.
They appeared to work because CE's interpreter fallback rendered them, but they
were not being compiled.

**Fix:** Changed all `;\;` separators to plain `;` (optionally followed by a
regular space). Note that `\;` _inside_ tuple components (e.g., `(a,\; b)`) is
unaffected — it only causes problems immediately after a semicolon statement
separator.

**Upstream note:** CE could either ignore `\;` after semicolons or document this
restriction. The current behavior is a parsing pitfall since `;\;` looks natural
in LaTeX.

**Fixed in next version of Compute Engine.** The parser now skips visual spacing
(`\;`, `\,`, `\quad`, etc.) after semicolon separators and before
`\text{then}`/`\text{else}` keywords. The Block serializer no longer emits
`;\;`, using `; ` instead, so round-tripping is also safe. As defense-in-depth,
the Block compiler filters out any residual `Nothing` operands.

### 6. CE features exercised and test results

The conversion now exercises the following CE features:

| CE Feature                          | Used? | Example                                                                |
| ----------------------------------- | ----- | ---------------------------------------------------------------------- |
| `\sum`                              | Yes   | Fourier series, Taylor series                                          |
| `\operatorname{…}`                  | Yes   | `Gamma`, `sgn`, `sinc`, `BesselJ`, `FresnelC`, `FresnelS`, `Heaviside` |
| `\begin{cases}`                     | Yes   | Antenna pattern, drumhead boundary                                     |
| `\operatorname{Heaviside}`          | Yes   | Step input, step response                                              |
| `\text{if}…\text{then}…\text{else}` | No    | Tested; replaced by `Heaviside` for step functions                     |
| `\text{ where }`                    | Yes   | Klein bottle, Butterfly, Möbius, Spherical Harmonics, Wave, Step       |
| Semicolon blocks                    | Yes   | Joukowski airfoil, Seashell, Gravitational Potential, Electric Dipole  |
| `\coloneq` assignment               | Yes   | All `where` and semicolon block expressions                            |
| `\mapsto` (lambda)                  | No    | Not needed — `extractVarNames` infers from unknowns/defaults           |
| `while`                             | No    | Not applicable — all expressions are declarative, not imperative       |

#### `where` clause syntax

```latex
(r\cos(u),\; r\sin(u),\; \sin(u/2)\sin(v) + \cos(u/2)\sin(2v))
  \text{ where } r \coloneq 2.5 + \cos(u/2)\sin(v) - \sin(u/2)\sin(2v)
```

CE parses this as a `Block` with `Declare`/`Assign` for `r`, followed by the
tuple expression that references `r`. The `where`-bound variable does NOT appear
in `expr.unknowns` — only the free variables `u` and `v` do.

#### Semicolon block syntax

```latex
a \coloneq -0.1 + 1.1\cos(t);
b \coloneq 0.1 + 1.1\sin(t);
s \coloneq a^2 + b^2;
(a + \frac{a}{s},\; b - \frac{b}{s})
```

CE parses `\coloneq` as `Assign`, semicolons as statement separators, and the
final expression as the block's return value. This compiles to scoped JS with
intermediate variable bindings — no variable leakage. All four semicolon block
expressions (Joukowski, Seashell, Gravitational Potential, Electric Dipole)
compile and render correctly.

> **Note**: Both `; ` and `;\;` now work as statement separators. The parser
> skips visual spacing (`\;`, `\,`, `\quad`, etc.) after semicolons. Earlier
> versions of CE did not handle `;\;` correctly — if you need to support older
> CE versions, use plain `;` followed by a regular space.

#### `\text{if}…\text{then}…\text{else}` syntax

```latex
\text{if}\; x \geq 0 \;\text{then}\; 1 \;\text{else}\; 0
```

CE parses this as `["If", ["GreaterEqual", "x", 0], 1, 0]` — a conditional
expression with three branches. More concise than `\begin{cases}` for simple
two-branch conditions.

#### `Heaviside` function

```latex
\operatorname{Heaviside}(x) \cdot \left(1 - \frac{\exp(-0.25x)}{\omega_d}
  \sin(\omega_d \cdot x + \arccos(0.25))\right)
  \text{ where } \omega_d \coloneq \sqrt{0.9375}
```

CE provides `\operatorname{Heaviside}(x)` as a built-in function (unit step: 0
for x < 0, 1 for x >= 0). This is more concise than `\text{if}` for multiplying
by a step. Combined with `\text{ where }` for local bindings, it compiles to
both `javascript` and `interval-js` targets.

### 7. All functions converted to LaTeX

All functions in `grid_paper.html` are now LaTeX strings compiled by the Compute
Engine. The last holdout was the **electric dipole vector field**, which was
converted after adding LaTeX string support to `VectorFunction2DInput`:

- `compileToVectorFunction2D()` in `ce-compile.ts` — parses a LaTeX 2-tuple,
  extracts variable names (defaulting to `["x", "y"]`), compiles to JS
- `resolveVectorFunction2D()` in `resolve-fn.ts` — handles
  `typeof input === "string"`
- `VectorFunction2DInput` in `types.ts` — now accepts `string` alongside
  `(x, y) => [number, number]` and `{ kind: "js", fn }`

### 8. Recursive `_gpu_gamma` in `interval-glsl` preamble

**Problem:** The CE's `interval-glsl` compilation target emits a monolithic
~29KB preamble containing the full interval arithmetic library. This preamble
includes a `_gpu_gamma(float z)` function that uses the reflection formula
`Gamma(z) = pi / (sin(pi*z) * Gamma(1-z))` — a recursive call. GLSL forbids
recursion, so any shader that includes this preamble fails to compile. The
preamble is always emitted in full regardless of whether the expression actually
uses the gamma function, so even simple expressions like `x^2 + y^2 - 1` are
affected.

**Discovery:** GPU interval arithmetic for implicit curves produced no visual
output. Manual shader compilation in the browser console revealed the GLSL
compiler error pointing to the recursive `_gpu_gamma` call.

**Workaround:** `sanitizeIntervalPreamble()` in `shader-templates.ts` detects
the recursive `_gpu_gamma` function via regex and replaces it with a
non-recursive Lanczos approximation (`NON_RECURSIVE_GPU_GAMMA`) that handles
both the `z >= 0.5` and `z < 0.5` branches inline without recursion.

**Upstream fix:** The `interval-glsl` preamble should use non-recursive function
implementations. Either replace the recursive gamma with a Lanczos/Stirling
approximation, or emit the preamble selectively (only include functions that the
compiled expression actually references).

**Fixed in current version of Compute Engine.** The `_gpu_gamma` function in
the `interval-glsl` preamble now uses a non-recursive Lanczos approximation.
The `sanitizeIntervalPreamble()` workaround is no longer needed but can be
kept as defense-in-depth.

## Conversion Patterns

50 of 51 functions in `grid_paper.html` were converted from JS to LaTeX/CE. The
one exception is **KDE (Kernel Density Estimation)** — it iterates over a
runtime data array, which is fundamentally non-compilable.

### Piecewise functions → `\begin{cases}` or `\text{if}`

Multi-branch conditionals compile via `Which` (chained ternaries in JS,
`_IA.piecewise` in interval-js):

```latex
\begin{cases}
  1 & |x| < 0.001 \\
  \left(\frac{\sin(x)}{x}\right)^2 & \text{otherwise}
\end{cases}
```

For simple two-branch conditions, `\text{if}` is more concise:

```latex
\text{if } x > 0 \text{ then } x \text{ else } -x
```

**Better alternative for common patterns:** Use dedicated functions when
available — `\operatorname{sinc}(x)^2` instead of the piecewise sinc,
`\operatorname{Heaviside}(x)` instead of step-function conditionals.

### Loops → `\sum` / `\prod`

`Sum` and `Product` with fixed integer bounds compile to `for` loops:

```latex
\frac{4}{\pi}\sum_{k=0}^{n} \frac{\sin((2k+1)x)}{2k+1}
```

No manual term expansion needed — the compiled code iterates efficiently.

### Intermediate variables → `\text{ where }` or semicolon blocks

For expressions with repeated subexpressions, use local bindings:

```latex
% where syntax (single binding, postfix)
\frac{1}{r} \text{ where } r \coloneq \sqrt{x^2 + y^2}

% semicolon blocks (multiple bindings, prefix)
a \coloneq -0.1 + 1.1\cos(t);
b \coloneq 0.1 + 1.1\sin(t);
s \coloneq a^2 + b^2;
(a + \frac{a}{s},\; b - \frac{b}{s})
```

Both compile to scoped JS with no variable leakage. Use simple identifiers (`a`,
`b`, `s`) — subscripted names like `r_1` don't work in blocks.

### Parameterized families → template literals + inlined constants

For families of curves (e.g., Planck's law at multiple temperatures), generate
LaTeX strings programmatically:

```typescript
function planckLatex(T: number): string {
  const c = 5.0 / (T / 3000);
  return `\\frac{1}{\\lambda^5 (\\exp(\\frac{${c}}{\\lambda}) - 1)}`;
}
```

### Parametric curves → tuple syntax

2D and 3D parametric curves use LaTeX tuple syntax:

```latex
(\cos(t), \sin(t))                      % 2D parametric
(\cos(t), \sin(t), t/(2\pi))            % 3D parametric curve
(\cos(u)\cos(v), \sin(u)\cos(v), \sin(v)) % 3D parametric surface
```

### Vector fields → 2-tuple syntax

Vector field series now accept LaTeX strings (2-tuples with optional local
bindings):

```latex
a \coloneq ((x-1)^2 + y^2 + 0.1)^{1.5};
b \coloneq ((x+1)^2 + y^2 + 0.1)^{1.5};
(\frac{x-1}{a} - \frac{x+1}{b},\; \frac{y}{a} - \frac{y}{b})
```

## Resolved CE Integration Issues (CE 0.51.1)

Issues resolved in CE 0.51.1 that simplified the plotting integration:

1. **Interval-js graceful fallback**: Unsupported functions now return
   `{ kind: "entire" }` at runtime instead of throwing. Compile-time detection
   returns `success: false` for unsupported operators.
2. **`run` type signature**: Corrected to
   `(...args: unknown[]) => number | { re, im }`, covering both vars-object and
   positional-arg calling conventions.
3. **Reliable tuple compilation**: `Tuple` expressions always compile to
   array-returning functions. No component-by-component fallback needed.
4. **`realOnly` compilation**: `{ realOnly: true }` makes `run` return `NaN` for
   complex results, eliminating per-evaluation object checks.
5. **GLSL target coverage**: ~80 functions supported (arithmetic, elementary,
   trig, hyperbolic, special via preamble, complex, comparison/logic). Notable
   JS-only: statistics, Bessel, Airy, Zeta, LambertW.
6. **GLSL preamble**: Generated by `GPUShaderTarget.compile()` via string
   pattern matching. Triggered by complex arithmetic, gamma/factorial, error
   functions, and color operations. Helpers are standalone functions placed
   before `userFn`.

## Resolved CE Gaps (pre-0.51.1)

Gaps identified during the conversion that were subsequently fixed in CE:

1. **Compilable `\sum` / `\prod`**: Sum and Product with fixed integer bounds
   now compile to `for` loops in both JavaScript and interval-js targets.
   Detected via `["Sum", body, ["Element", var, ["Range", lo, hi]]]` pattern.
2. **`\begin{cases}` compilation (`Which`)**: Piecewise functions compile to
   chained ternaries (JS) or `_IA.piecewise` calls (interval-js). `True`
   condition is treated as the default branch.
3. **Fresnel integrals**: `\operatorname{FresnelC}(t)` and
   `\operatorname{FresnelS}(t)` implemented with power series (small |t|) and
   asymptotic expansion (large |t|). Compile to JS and interval-js.
4. **Sinc function**: `\operatorname{sinc}(x) = \sin(x)/x` with sinc(0) = 1.
   Compiles to `_SYS.sinc(x)` (JS) and `_IA.sinc(x)` (interval-js).
5. **Spherical harmonics / Associated Legendre**: Deferred — low priority since
   specific (l, m) values can be expanded to closed-form trig expressions.

## Learnings and Best Practices

Key lessons learned during the conversion of ~50 functions from JS to LaTeX/CE.

### 1. Silent compilation failures are the biggest debugging hazard

When `compile()` returns `success: false`, CE still sets `run` to the
expression's numeric interpreter. This means the function still "works" — but
via slow interpretation rather than compiled code. There is no error, no
warning, and no visual difference in the rendered plot. The only way to detect
this is to check `success` explicitly.

**Best practice:** Always check `result.success` after compilation. Log a
warning if `false` — silent fallback to interpretation is a debugging trap.

### 2. `expr.isValid` is a prerequisite for successful compilation

If `expr.isValid` is `false`, the parse tree contains `Error` nodes and
compilation will always fail. Common causes:

- `;\;` after semicolons (creates `InvisibleOperator` — see gap #5)
- Subscripted variable names like `r_1` in semicolon blocks (CE parses as
  `Subscript(r, 1)`, not a single variable — use simple names like `a`, `b`)
- Mismatched delimiters or unrecognized LaTeX commands

**Best practice:** Check `expr.isValid` and `expr.unknowns` after parsing.
`InvisibleOperator` in `unknowns` is a red flag for parse errors.

### 3. Variable name mapping is a silent failure mode

CE compiled functions expect a vars object keyed by the expression's actual
variable names. If you pass `{ x: 0.5 }` but the expression uses `theta`, the
function silently returns `null` or `NaN`.

**Best practice:** Always use `extractVarNames()` to discover variable names
from `expr.unknowns`, and build the wrapper to remap from the series type's
canonical variable names (x, y, t, etc.) to the expression's actual names.

### 4. Interval arithmetic has coverage gaps

Not all functions that compile to `javascript` also compile to `interval-js`.
The `(-1)^k` pattern in sums (formerly gap #2) is now supported. Remaining gaps
are primarily special functions. The fallback from `interval-js` → `js` is
graceful but loses break detection.

**Best practice:** Always attempt interval compilation first, fall back to
scalar JS. Use `isIntervalDegenerate1D/2D()` to detect degenerate interval
functions (all inputs → `{ kind: "entire" }`) and discard them.

### 5. Semicolon block variable names must be simple identifiers

CE semicolon blocks (`a \coloneq expr; b \coloneq expr; result`) require simple
variable names. Subscripted names like `r_1` are parsed as `Subscript(r, 1)` — a
function application, not an assignment target.

**Best practice:** Use short identifiers (`a`, `b`, `s`, `r`) for semicolon
block bindings. For clarity, `\text{ where }` syntax with single bindings is
often more readable.

### 6. `\;` placement in LaTeX

- `\;` between tuple components (`(a,\; b)`) — fine, just spacing
- `\;` after semicolons (`;\;`) — now handled correctly (was gap #5)
- `\;` inside `\text{if}` syntax (`\text{if}\; x \geq 0`) — fine

**Best practice:** Never use `\;` immediately after a semicolon statement
separator. Use plain `;` followed by a regular space if needed.

### 7. The `realOnly` flag prevents complex-number surprises

Without `realOnly: true`, functions like `sqrt(-1)` return `{ re: 0, im: 1 }`
instead of `NaN`. The plotting system always uses `realOnly: true` to get clean
`NaN` values for out-of-domain inputs.

### 8. GLSL preamble must be handled explicitly

When CE's GLSL target returns a `preamble` string, it contains helper function
definitions that the generated `code` calls. If you only inject `code` into your
shader, you get undefined function errors. Both `preamble` and `code` must be
placed in the shader — preamble first, before the `userFn` wrapper.

### 9. Use series-type-aware compilation targets

Different series types benefit from different compilation targets:

- **Line series**: `interval-js` for adaptive break detection
- **Implicit curves**: `interval-js` for quadtree + `glsl` for grid rendering
- **Heatmaps**: `glsl` for per-pixel GPU evaluation
- **Parametric/polar/vector/3D**: `js` only (no IA benefit, needs CPU eval)

Don't waste cycles compiling to targets that won't be used.

## Requests for CE Maintainers

Consolidated list of upstream fixes and improvements that would benefit the
plotting integration. Ordered by impact.

### High Priority

1. ~~**Fix `;\;` parsing (gap #5)**~~: **FIXED.** The parser now skips visual
   spacing after semicolons and before `\text{then}`/`\text{else}` keywords.
   The Block serializer uses `; ` instead of `;\; `. The Block compiler also
   filters out residual `Nothing` operands as defense-in-depth.

2. ~~**Fix `expr.unknowns` for bound variables (gap #1)**~~: **FIXED.**
   `getUnknowns()` excludes Sum/Product/Integrate/Block bound variables.
   `freeVariables` property added as an alias for `unknowns`.

3. ~~**Fix interval-js constant branch wrapping (gap #4)**~~: **FIXED.**
   `_IA.piecewise()` returns properly typed `IntervalResult` for all branches
   including constants.

4. ~~**Support `(-1)^k` in interval-js (gap #2)**~~: **FIXED.**
   `powInterval()` handles variable exponents correctly.

### Medium Priority

5. ~~**Fix recursive `_gpu_gamma` in `interval-glsl` preamble (gap #8)**~~:
   **FIXED.** The preamble now uses a non-recursive Lanczos approximation.

6. ~~**Warn on `success: false` fallback**~~: **DONE.** `console.warn()`
   emitted at `compile-expression.ts:86` when compilation falls back to
   interpretation.

7. **Add `SphericalHarmonic(l, m, theta, phi)` and
   `AssociatedLegendreP(n, m, x)`**: Not currently planned. Low priority per
   your doc — specific (l, m) values can be expanded to closed-form trig
   expressions.

8. ~~**Support `\prod` in interval-js**~~: **FIXED.** Compiles via
   `compileIntervalSumProduct`.

### Low Priority (Nice to Have)

9. **GLSL compilation for Bessel, Airy, Zeta, LambertW**: Not currently
   planned. Significant implementation effort for GPU-based special functions.

10. **Subscripted variable names in blocks**: Allow `r_1 \coloneq expr` to
    define a variable named `r_1` rather than parsing as `Subscript(r, 1)`. This
    is common in mathematical notation for intermediate values. **Open — design
    decision needed.** This intersects with how CE handles subscripts
    generally (indexing vs. variable naming). Use simple identifiers (`a`, `b`,
    `s`) for now.
