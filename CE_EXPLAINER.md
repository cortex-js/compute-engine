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

CE >= 0.50.0 provides a target-based compilation API. There are three ways to
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

**`run` type signature:** The `run` function expects a single vars object as the
first argument (e.g., `run({ x: 0.5 })`). The compiled function uses a `Proxy`
that injects the runtime library before the caller's arguments.

> **CE maintainer note (Request 2 — fixed):** The TypeScript type previously
> declared `(...args: (number | {re, im})[]) => ...` which was misleading. It
> has been corrected to `run?: (...args: unknown[]) => number | { re, im }`
> which covers both calling conventions: vars-object for plain expressions
> (`run({ x: 0.5 })`) and positional args for lambda expressions (`run(0.5)`).

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

> **CE maintainer note (Request 3 — already guaranteed):** `Tuple` compiles to
> an array literal `[a, b, c]` in the JavaScript target (`javascript-target.ts`,
> `JAVASCRIPT_FUNCTIONS.Tuple`). The `run` function will always return a JS
> array for Tuple expressions. The try/test/fallback path in the plotting code
> is no longer necessary and can be simplified.

1. **Try direct compilation**: CE compiles the entire tuple to a function
   returning an array. Test with `Array.isArray(result)`.
2. **Fallback to components** (legacy, can be removed): Extract `expr.ops`,
   compile each component separately with `compileScalar1D` or
   `compileScalar2D`, then assemble.

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

The JavaScript target supports complex arithmetic. The `run` function can return
`{ re: number, im: number }` for expressions that produce complex results (e.g.,
`sqrt(x)` for negative x).

For real-valued plots, you can either discard results manually or use the
`realOnly` compilation option:

```ts
// Option 1: Manual check (legacy approach)
const result = run({ x: -1 });
if (typeof result === "object" && result.im !== 0) {
  // Complex result — treat as undefined for real-valued plot
}

// Option 2: Use realOnly (preferred — see Request 4)
const result = compile(expr, { to: "javascript", realOnly: true });
result.run({ x: -1 }); // → NaN (complex results auto-converted)
```

> **CE maintainer note (Request 4 — implemented):** The `realOnly` compilation
> option is now available. When `{ realOnly: true }` is passed, the `run`
> function automatically converts complex `{ re, im }` results: returns `re`
> when `im === 0`, returns `NaN` otherwise. This avoids per-evaluation object
> checks and the `toReal()` wrapper in plotting code.

## Error Handling

All compilation paths are wrapped with error catching:

- **Compilation failure**: Falls back to interpretation (`success: false`), with
  `run` set to the expression's numeric evaluator. If `fallback: false` is
  passed in options, throws instead.
- **Runtime errors**: First error is logged with full diagnostics (input values,
  LaTeX source, stack trace), then subsequent errors silently return NaN /
  `{ kind: "empty" }`
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

### Why scalar-only helpers exist

`compileScalar1D` and `compileScalar2D` compile only the JavaScript target,
skipping interval-js and GLSL. This avoids wasted work for series types that
only need scalar evaluation (parametric curves, 3D surfaces, polar).

The multi-target `compileJs1D` and `compileJs2D` reuse these helpers internally
for their scalar path.

### How interval wrappers handle variable names

The `wrapInterval1D` and `wrapInterval2D` functions accept the actual variable
name(s) from `extractVarNames()` but expose a fixed external contract
(`{ x: Interval }` / `{ x: Interval; y: Interval }`). Internally they remap:
`{ [varName]: vars.x }`. This keeps the adaptive sampling code simple (always
uses `x`/`y`) while supporting expressions with non-standard variable names.

In practice, interval arithmetic is only used for line series and implicit
curves, which default to `x` and `x, y` respectively.

## Upstream Improvement Requests

Issues and feature requests for the Compute Engine maintainers. These reflect
real pain points encountered while building the plotting integration.

### 1. Interval-js: graceful fallback for unsupported functions

The `interval-js` target throws at runtime when a function lacks an IA
implementation (e.g. `_IA.gamma is not a function` for `\Gamma(x)`). This
produces console errors on every evaluation until our one-shot error guard
silences them.

**Request:** When an interval implementation is unavailable, return
`{ kind: "entire" }` instead of throwing. This tells the caller "I can't bound
this" without crashing. Alternatively, report unsupported functions at
_compilation_ time (`success: false`) so we can skip the interval target
entirely.

> **CE maintainer note — fixed (both failure modes):**
>
> - The specific `_IA.gamma is not a function` error is fixed: `gamma` and
>   `gammaln` are now exported from the interval library.
> - **Compile-time:** `compileToIntervalTarget()` now wraps
>   `BaseCompiler.compile()` in a try-catch. If the expression contains
>   unsupported operators/functions, the result has `success: false` and empty
>   `code`, so callers can skip the interval target cleanly.
> - **Runtime:** The `ComputeEngineIntervalFunction` proxy `apply` handler now
>   catches errors and returns `{ kind: "entire" }` instead of throwing. This
>   handles the case where a function compiles but the corresponding `_IA`
>   method is missing at runtime.

### 2. `run` type signature doesn't match runtime behavior

The TypeScript declaration says:

```ts
run?: (...args: (number | {re: number, im: number})[]) => number | {re: number, im: number}
```

But at runtime `run` expects a single vars object: `run({ x: 0.5 })`. The
Proxy-based injection makes positional args work for some cases, but the type is
misleading. We cast to `(vars: Record<string, number>) => unknown` everywhere.

**Request:** Fix the type declaration to match actual usage:

```ts
run?: (vars: Record<string, unknown>) => number | {re: number, im: number}
```

> **CE maintainer note — fixed.** The type in `CompilationResult` is now
> `run?: (...args: unknown[]) => number | { re: number; im: number }`, which
> covers both `run({ x: 0.5 })` (plain expressions) and `run(0.5)` (lambdas).
> The misleading variadic `(number | {re, im})[]` signature is gone.

### 3. Reliable tuple compilation for JS target

Compiling `(\cos(t), \sin(t))` sometimes returns a function yielding
`[number, number]` and sometimes doesn't (requiring component-by-component
fallback). The plotting code has a try → test → fallback path to handle this.

**Request:** Guarantee that compiling a `Tuple` expression to the `javascript`
target returns a function yielding an array. This would let us remove the
fallback logic.

> **CE maintainer note — already guaranteed.** `Tuple` is compiled to an array
> literal `[a, b, c]` via `JAVASCRIPT_FUNCTIONS.Tuple` in
> `javascript-target.ts`. This has been reliable since the compilation rewrite.
> The fallback path in plotting code can safely be removed.

### 4. Real-only compilation mode

CE's JavaScript target can return `{ re, im }` for complex results (e.g.
`\sqrt{x}` at negative x). For plotting we always discard the imaginary part via
`toReal()`. This adds per-evaluation overhead.

**Request:** A compilation option like `{ realOnly: true }` that makes the
compiled function return `NaN` directly for complex results, avoiding the object
allocation and our downstream guard.

> **CE maintainer note — implemented.** Pass `{ realOnly: true }` in
> `CompilationOptions`. The `run` function is wrapped to convert complex
> returns: `im === 0` yields `re`, otherwise `NaN`. The wrapping is zero-cost
> for purely real-valued expressions (it only checks `typeof result`).

### 5. GLSL target coverage documentation

Not all functions that compile to `javascript` also compile to `glsl`. When GLSL
compilation fails we fall back to JS (CPU evaluation), which is much slower for
heatmaps and implicit curves. Knowing _which_ functions are GLSL-supported would
help us provide better user feedback.

**Request:** Document or expose programmatically which functions/operators the
`glsl` target supports. Even a simple list in the docs would help.

> **CE maintainer note — documented below.**
>
> The GLSL target supports ~80 functions via `GPU_FUNCTIONS` (shared with WGSL)
> in `gpu-target.ts` plus GLSL-specific overrides in `glsl-target.ts`:
>
> **Arithmetic:** Add, Subtract, Multiply, Divide, Negate
>
> **Elementary:** Abs, Ceil, Floor, Round, Truncate, Fract, Sign, Sqrt, Square,
> Root, Power, Exp, Exp2, Ln, Log, Log10, Log2, Lb, Lg, Min, Max, Clamp,
> Smoothstep, Mix, Step
>
> **Trigonometric:** Sin, Cos, Tan, Arcsin, Arccos, Arctan, Arctan2, Cot, Csc,
> Sec, Arccot, Arccsc, Arcsec, Haversine, InverseHaversine, Hypot
>
> **Hyperbolic:** Sinh, Cosh, Tanh, Coth, Csch, Sech, Arsinh, Arcosh, Artanh,
> Arcoth, Arcsch, Arsech
>
> **Special (via preamble):** Gamma, GammaLn, Factorial, Beta, Erf, Erfc, ErfInv
>
> **Complex (vec2):** Re, Im, Arg, Conjugate, and complex-aware versions of
> trig/exp/log/power functions
>
> **Comparison/Logic:** Equal, NotEqual, Less, LessEqual, Greater, GreaterEqual,
> And, Or, Not
>
> **Other:** Remainder, Mod, Degrees, Distance, Dot, Cross, Length, Normalize,
> Reflect, Refract, List/Tuple/Matrix (as vec/mat constructors), Color functions
>
> **Notable omissions (JS-only):** statistics (Mean, Median, Variance, etc.),
> Bessel functions (BesselJ/Y/I/K), Airy functions (AiryAi/Bi), Zeta, LambertW,
> Digamma, Trigamma, PolyGamma, Fibonacci, Binomial, Factorial2, Sum, Product,
> Integrate, Range, Random, Limit

### 6. GLSL preamble documentation

We now support GLSL results with a `preamble` (helper function definitions
placed before the user function). But we've never seen CE actually produce one —
it's unclear which expressions trigger preamble generation.

**Request:** Document when and why the GLSL target produces a `preamble`, with
examples. This helps us verify our preamble injection is correct.

> **CE maintainer note — documented below.**
>
> The preamble is generated by `GPUShaderTarget.compile()` in `gpu-target.ts`.
> It detects which helper functions are referenced in the compiled code via
> string pattern matching, then emits only the required definitions (with
> topological dependency sorting). Four categories trigger preamble generation:
>
> 1. **Complex arithmetic** — any expression involving complex-valued operands
>    (e.g., `sqrt` of a potentially-negative value, `ImaginaryUnit`). Emits
>    `_gpu_cmul`, `_gpu_cdiv`, `_gpu_csqrt`, `_gpu_cexp`, `_gpu_cln`,
>    `_gpu_cpow`, and complex trig wrappers as needed.
> 2. **Gamma/factorial** — `Gamma(x)`, `GammaLn(x)`, `x!`, `Beta(a,b)`. Emits
>    `_gpu_gamma` and `_gpu_gammaln` using Lanczos approximation (g=7, 9
>    coefficients).
> 3. **Error functions** — `Erf(x)`, `Erfc(x)`, `ErfInv(x)`. Emits `_gpu_erf`
>    (Abramowitz & Stegun approximation) and `_gpu_erfinv`.
> 4. **Color operations** — `ColorMix`, `ColorContrast`, `ContrastingColor`,
>    `ColorToColorspace`, `ColorFromColorspace`. Emits sRGB↔linear, OKLab, OKLCh
>    conversions and APCA contrast.
>
> **Example:** `\Gamma(x) + \text{erf}(x)` would produce a preamble with both
> gamma and error function helpers, while `\sin(x) + x^2` produces no preamble
> (built-in GLSL functions suffice).
>
> Your preamble injection strategy (placing it before the `userFn` definition at
> shader top level) is correct — the helpers are standalone `float`/`vec2`
> functions that just need to be defined before use.
