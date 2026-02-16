# Compute Engine Integration

How the Compute Engine (CE) is used for compiling LaTeX expressions into
executable functions for the plotting system.

## Overview

The plotting components (`<math-plot>`, `<math-plot-3d>`) accept LaTeX strings
as function definitions. These are compiled to JavaScript (and optionally
interval arithmetic or GLSL) functions via the
[Compute Engine](https://cortexjs.io/compute-engine/).

**Key files:**

| File                         | Role                                                     |
| ---------------------------- | -------------------------------------------------------- |
| `src/plotting/ce-compile.ts` | Compilation mechanics                                    |
| `src/plotting/resolve-fn.ts` | CE discovery, series-type dispatch, shorthand resolution |

## CE Discovery

The CE is discovered at runtime via a well-known global symbol:

```ts
globalThis[Symbol.for("io.cortexjs.compute-engine")].ComputeEngine
```

A singleton CE instance is cached after first use. If CE is not available, a
console warning is emitted and functions resolve to `() => NaN`.

This design keeps CE out of the main bundle — users load it separately.

## Compilation API

CE >= 0.50.0 provides a target-based compilation API:

```ts
// Get a compilation target
const target = ce.getCompilationTarget("javascript"); // or "interval-js", "glsl"

// Compile a parsed expression
const expr = ce.parse("\\sin(x)");
const result = target.compile(expr);

// result: { success, code?, preamble?, run? }
```

### CompilationResult

| Field      | Type        | Description                                      |
| ---------- | ----------- | ------------------------------------------------ |
| `success`  | `boolean`   | Whether compilation succeeded                    |
| `code`     | `string?`   | Generated source code                            |
| `preamble` | `string?`   | Helper functions needed by `code` (GLSL only)    |
| `run`      | `function?` | Pre-compiled function with runtime already bound |

**Always prefer `run` over `code`.** The `run` function has the runtime (`Math`
for JS, `_IA` for intervals) already bound, so it's ready to call. The `code`
string uses `_` as the variable object, which makes it fragile to evaluate
manually.

### Compilation Targets

| Target          | Returns                    | Used for                                       |
| --------------- | -------------------------- | ---------------------------------------------- |
| `"javascript"`  | `(vars) => number`         | All series types                               |
| `"interval-js"` | `(vars) => IntervalResult` | Line series (break detection), implicit curves |
| `"glsl"`        | GLSL source string         | Heatmaps, implicit curves, parametric (GPU)    |

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
const expr = ce.parse("1 + \\cos(\\theta)") as any;
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

| Series                | Variables         | Extraction Strategy                   |
| --------------------- | ----------------- | ------------------------------------- |
| Line                  | `x`               | Hardcoded (always `x`)                |
| Implicit              | `x`, `y`          | Hardcoded (always `x`, `y`)           |
| Polar                 | typically `theta` | Extracted via `expr.unknowns`         |
| Parametric 2D         | typically `t`     | Extracted via `expr.unknowns`         |
| Parametric 3D curve   | typically `t`     | Extracted via `expr.unknowns`         |
| Parametric 3D surface | `u`, `v`          | Convention (multi-variable ambiguity) |
| 3D surface            | `x`, `y`          | Hardcoded                             |

## Tuple Parsing

Parametric functions use LaTeX tuple syntax:

```latex
(\cos(t), \sin(t))           % 2D parametric
(\cos(t), \sin(t), t/(2\pi)) % 3D parametric curve
```

CE parses these as expressions with operator `"Tuple"`, `"List"`, or
`"Delimiter"` and operands in `expr.ops`:

```ts
const expr = ce.parse("(\\cos(t), \\sin(t))") as any;
// expr.operator === "Tuple" (or "List" or "Delimiter")
// expr.ops === [cos_expr, sin_expr]
```

### Compilation Strategy

1. **Try direct compilation**: CE may compile the entire tuple to a function
   returning an array. Test with `Array.isArray(result)`.
2. **Fallback to components**: Extract `expr.ops`, compile each component
   separately with `compileScalar1D` or `compileScalar2D`, then assemble.

## Series-Type Compilation Strategy

Different series types need different compilation targets. The dispatch logic
lives in `resolve-fn.ts`:

| Series Type   | Preferred Target              | Rationale                                                   |
| ------------- | ----------------------------- | ----------------------------------------------------------- |
| Line          | `interval-js` → `js`          | IA is critical for detecting asymptotes and discontinuities |
| Implicit      | `interval-js` → `glsl` → `js` | IA for quadtree refinement, GLSL for grid rendering         |
| Heatmap       | `glsl` → `js`                 | Per-pixel GPU rendering is the practical path               |
| Polar         | `js` only (scalar)            | Polar renderer only accepts `kind: "js"`                    |
| Parametric    | `js` + `glsl`                 | No IA benefit for parametric curves                         |
| Vector field  | `js` only                     | Scalar evaluation at grid points                            |
| 3D surface    | `js` only (scalar)            | Geometry builder requires plain function                    |
| 3D parametric | `js` only (scalar)            | Component-wise scalar compilation                           |

## Interval Arithmetic Results

The `interval-js` target returns `IntervalResult` objects:

| Kind         | Meaning                      | Example                                          |
| ------------ | ---------------------------- | ------------------------------------------------ |
| `"interval"` | Bounded result               | `{ kind: "interval", lo: 0.5, hi: 1.2 }`         |
| `"singular"` | Singularity or discontinuity | `tan(x)` at `x ≈ π/2`, or `floor(x)` at integers |
| `"empty"`    | No valid result              | Division by zero in both endpoints               |
| `"entire"`   | Result spans all reals       | Rare                                             |

**Important:** `"singular"` does not distinguish between poles (vertical
asymptotes) and finite jumps (step functions). The plotting system uses endpoint
y-magnitudes relative to the viewport to tell them apart.

## Error Handling

All compilation paths are wrapped with error catching:

- **Compilation failure**: Returns `() => NaN` (JS) or a no-op interval function
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

### Why interval wrappers hardcode variable names

The `wrapInterval1D` function hardcodes `{ x: Interval }` and `wrapInterval2D`
hardcodes `{ x: Interval; y: Interval }`. This is correct because interval
arithmetic is only used for line series (variable `x`) and implicit curves
(variables `x`, `y`). Series types with non-standard variable names (polar's
`theta`, parametric's `t`) use scalar-only compilation.
