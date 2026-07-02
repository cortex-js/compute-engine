# Migration Guide: 0.55.0 to 0.60.0

## Overview

Unlike the 0.55.0 release — which split the package into sub-paths and renamed
several core APIs — the 0.56 → 0.60 line is **mostly additive**. The package
shape, the constructor, `ce.parse()`, `compile()`, `evaluate()`, and
`simplify()` all work the way they did in 0.55.0. **Most existing code keeps
working unchanged.**

The bulk of the work in these releases went into the symbolic engine (calculus,
solving, special functions, identities) and into numeric precision and speed.
For a consumer focused on **plotting and code generation via compilation**, the
practical surface area is small, and this guide concentrates on exactly that.

If you read nothing else, read the next section.

## TL;DR for a plotting / compilation consumer

1. **`evaluate()` now keeps exact transcendental results symbolic.** `ln(2)`
   evaluates to `ln(2)`, not `0.693…`. If you feed evaluated results into a
   plotter or numeric pipeline, **call `.N()`** (or `evaluate({
   numericApproximation: true })`) where you need an actual float. This is the
   single change most likely to affect you. See [§1](#1-evaluate-stays-symbolic-for-exact-values--use-n).

2. **`Linspace(a, b, n)` now includes both endpoints** (NumPy/MATLAB
   semantics). If you generate sample grids, the sample positions changed. See
   [§2](#2-linspace-includes-both-endpoints).

3. **Fixed-size numeric arrays now have dimensioned types**: `[1, 2, 3]` is
   `vector<3>`, not `list<number>`. Only matters if you branch on
   `expr.type`. See [§3](#3-fixed-size-numeric-collections-get-dimensioned-types).

4. **Compilation gained GPU/host parity for several heads you likely use**
   (component access `p.x`, `Range`, `Variance`/`GCD`/`Median`, seeded
   `Random`, color values). `Loop` and definite `Integrate` now compile
   correctly as well; only a *bounds-less* indefinite integral has no numeric
   value to compile to. See [§7](#7-compilation).

5. **Fungrim identities and the Rubi integrator are opt-in and off by default.**
   They cost nothing if you don't import them, and you almost certainly don't
   need them for plotting. See [§9](#9-opt-in-heavy-features-likely-skip-for-now).

Everything else below is detail and new conveniences.

---

## Breaking and behavior changes

### 1. `evaluate()` stays symbolic for exact values — use `.N()`

*(0.60.0)*

`evaluate()` now honors an exactness contract: it returns the **most exact**
form and stays symbolic when there is no closed form, while `.N()` produces a
float.

```ts
ce.parse('\\ln 2').evaluate().latex;   // "\ln 2"   (was: "0.6931...")
ce.parse('\\ln 2').N().latex;          // "0.6931471805599453"

ce.parse('\\int_1^2 \\frac{1}{x} dx').evaluate().latex; // "\ln 2"  (exact!)
ce.parse('\\int_1^2 \\frac{1}{x} dx').N().latex;        // "0.6931..."
```

A transcendental of an **exact** argument is itself an exact constant (like
`√2`) and stays symbolic; an **inexact** (float) argument still numericizes
(`cos(5.1) → 0.377…`). Known exact reductions still happen (`cos(π) = -1`,
`arctan(1) = π/4`).

**What to do:** anywhere you take an expression and expect a number out
(plotting, table generation, feeding another numeric routine), use `.N()` or
`evaluate({ numericApproximation: true })` rather than `evaluate()`.
`expr.N()` is exactly `expr.evaluate({ numericApproximation: true })`.

> Note: compiling to JavaScript/GLSL/WGSL is unaffected — a compiled function
> always returns numbers. This change only concerns the *interpreted*
> `evaluate()` path.

Related, smaller numeric-correctness behavior changes in 0.60.0 (all "more
correct", unlikely to need code changes):

- `N()` at a known pole returns `ComplexInfinity` instead of `NaN`
  (e.g. `Digamma(0).N()`).
- `(aⁿ)ᵐ` no longer folds to `aⁿᵐ` based solely on an odd inner exponent
  (it was unsound on the principal branch for negative bases).
- `ln(a) + ln(b) → ln(ab)` and friends no longer combine across the branch cut
  (only for positive/unconstrained arguments). An unconstrained symbol is treated
  as a generic real; a symbol *declared* `complex` is excluded from these
  real-only rewrites. The authoritative statement of that policy is
  [`docs/SIMPLIFY.md`](./SIMPLIFY.md#generic-real-simplification-policy).
- `e^{iθ}` stays in exponential form for a symbolic angle under `evaluate()`.
  Convert on demand with the new `expr.simplify({ strategy: 'trig' })`.
- `isFinite` is now known (`true`) for finite symbolic constants such as `√π`,
  `1/π`, `π^π` (was `undefined`).

### 2. `Linspace` includes both endpoints

*(0.58.0)*

`Linspace(a, b, n)` now produces `n` points evenly spanning `[a, b]`
**inclusive of both endpoints**, matching NumPy, Julia, and MATLAB. Previously
the last sample fell short of `b`.

```ts
// Linspace(0, 1, 5)
// before: 0, 0.2, 0.4, 0.6, 0.8
// now:    0, 0.25, 0.5, 0.75, 1
```

If you were generating axis ticks or sample grids with `Linspace`, **the
positions changed**. `Linspace(a, b, 1)` returns just `a`.

### 3. Fixed-size numeric collections get dimensioned types

*(0.59.0)*

A fixed-size numeric collection now infers a dimensioned type:

```ts
ce.parse('[1, 2, 3]').type.toString();   // "vector<3>"   (was "list<number>")
// a 3×3 numeric collection → "matrix<3x3>"
```

This only matters if you **branch on `expr.type`** or compare type strings.
Heterogeneous lists infer a structural union (e.g. `[1, "hello", 3]` →
`list<finite_integer | string>`), which is handy for detecting mixed input but
again only relevant if you inspect types.

### 4. `replace()` no longer eagerly canonicalizes the whole result

*(0.59.0)*

`replace()` (and `simplify({ rules })`) no longer canonicalizes the entire
result. The requested `form` — or the form produced by the rule — applies to the
replaced subexpressions only. To restore the old behavior, call `.canonical` on
the result:

```ts
const out = expr.replace(rules);
const canonical = out?.canonical;   // restore previous eager-canonical behavior
```

Replacement form is now controlled by `ReplaceOptions.form`
(`'canonical'` | `'structural'` | `'raw'` | a specific canonical transform). The
old boolean `canonical` option is a deprecated alias.

### 5. Color values return typed heads, not tuples

*(0.56.0)*

`Color('…')`, `ColorMix`, `ContrastingColor`, and `Colormap` now return typed
color heads (`Oklch`, `Rgb`, …) instead of anonymous 0–1 sRGB tuples. If you
consumed the tuple shape, wrap with `AsRgb` to recover 0–1 sRGB:

```ts
// before: ce.expr(['Color', "'red'"]).evaluate()  // [r, g, b] in 0-1
ce.expr(['AsRgb', ['Color', "'red'"]]).evaluate();  // ['Rgb', r, g, b], channels 0-1
```

`Rgb` components are 0–1 sRGB across the engine, JS compile, and GPU compile.
Skip this section entirely if you don't use CE's color values.

### 6. `box()` remains a deprecated alias for `expr()`

No change since 0.55.0, but worth restating: `ce.box()` still works and forwards
to `ce.expr()`, which carries the `@deprecated Use 'expr()' instead.` tag. The
free function exported from the package is `expr` (there is no free `box`). The
alias has not been removed, so there is no action required this cycle — but new
code should use `ce.expr()`.

---

## 7. Compilation

Compilation is your primary path, so here is the full picture as of 0.60.0.

### The API (unchanged since 0.55.0)

Compilation is the **standalone `compile()` function** — there is no
`expr.compile()` method.

```ts
import { compile } from '@cortex-js/compute-engine';
// or the smaller sub-path: import { compile } from '@cortex-js/compute-engine/compile';

const fn   = compile(ce.parse('x^2 + 1'));                 // JS (default)
const glsl = compile(ce.parse('x^2 + 1'), { to: 'glsl' }); // 'glsl' | 'wgsl' | 'python'
```

`to` accepts `'javascript'` (default), `'glsl'`, `'wgsl'`, and `'python'`. The
`/compile` sub-path also exports the target classes (`JavaScriptTarget`,
`GLSLTarget`, `WGSLTarget`, `PythonTarget`, `BaseCompiler`) if you need a target
instance via `{ target: … }`.

### New things you can now compile (0.56–0.59)

- **Component access** — `First`/`Second`/`Third` (`p.x`, `p.y`, `p.z`) compile
  cleanly: JS uses `[0]`/`[1]`/`[2]`, GLSL/WGSL use `.x`/`.y`/`.z` swizzles
  (assuming the argument compiles to a `vec2`/`vec3`/`vec4`). 5+-element tuples
  (which compile to `float[N]`) are not supported. *(0.58.0)*
- **`Range(lo, hi[, step])`** on GPU with compile-time-constant bounds emits an
  inline `float[N](...)` (GLSL) / `array<f32, N>(...)` (WGSL) literal, capped at
  256 elements. Non-constant bounds throw a clear error telling you to
  materialize on the host and upload as a uniform. *(0.58.0)*
- **`Variance`, `GCD`, `Median`** GPU entries with GLSL+WGSL parity. `Median`
  supports list sizes 2–8 (9+ throws). *(0.58.0)*
- **Seeded `Random(seed)`** compiles to a hash-based PRNG in GLSL/WGSL.
  `Random()` with no args falls back to a `gl_FragCoord` seed in GLSL
  (fragment-shader only) and **throws in WGSL** — provide an explicit seed
  there. The fract-sin hash bands near `seed ≈ kπ`; use a stronger hash for
  high-quality shader noise. JS-side `Random` is still non-seeded
  `Math.random`. *(0.58.0)*
- **Color values** — all color constructors, the `As*` converters, `ColorDelta`,
  and `Distance` compile to JS, where a color is a 3- or 4-element OKLCh array
  matching the GPU `vec3`/`vec4` representation, so values move between JS, GLSL,
  and WGSL without conversion. *(0.56.0)*
- **Restriction braces / `When`** — `f(x)\{cond\}` compiles to a ternary
  `(cond ? e : NaN)` in JS and GLSL. *(0.57.0)*

### Compile fixes in 0.59.0

Corrected JS compilation of symbolic `Range`, compound-bounded interval
`Sum`/`Product`, and the interpreted fallback for multi-argument lambdas;
Python parentheses for `(a^b)^c`; GLSL/WGSL output for `Degrees`, complex
multiplication, `Gamma`/`Factorial`/`Beta`/`Erf`, and `If`/`Which`/`When`; and
symbolic derivatives of `Arcsec`/`Arccsc`.

### `Loop` and `Integrate` compilation

Both of the JS compile cases that previously produced wrong values are resolved:

- **`Loop` compiles correctly.** The `for`-loop IIFE generated for
  `Loop(body, Element(i, Range(lo, hi)))` now returns the list of body values —
  `Loop(i², Element(i, Range(1, 4)))` compiles and runs to `[1, 4, 9, 16]`.
- **Definite `Integrate` compiles and evaluates.** `\int_0^2 x^2\,dx` compiles to
  a single-lambda `_SYS.integrate(…)` call and runs to `2.667`. Only a
  *bounds-less indefinite* integral (`\int x^2\,dx`) has no numeric value to
  compile to — its compiled function returns `null`. Evaluate an indefinite
  integral symbolically in the interpreter (its antiderivative is not a number)
  rather than through a compiled function.

  > **The compiled definite integral is a Monte-Carlo estimate, not adaptive
  > quadrature.** `_SYS.integrate` draws 1e7 uniform samples over `[a, b]`, so a
  > compiled `Integrate` is **stochastic** (a different result each call, and
  > unseeded), converges only at ~1/√N (typical error ≈ 1e-4), and is
  > comparatively slow (≈ 200 ms/call). It exists so an expression *containing* a
  > definite integral can still compile to a self-contained numeric function; for
  > a deterministic or high-accuracy value use the interpreter's `.N()` (adaptive
  > quadrature) instead. Only real, finite, constant bounds are meaningful.

---

## 8. New helpers worth knowing (additive)

These are all new since 0.55.0 and oriented toward exactly the plotting/UI use
cases a Desmos-style consumer hits. Nothing here is required — adopt as useful.

### Domain restrictions and clipping

- **Restriction braces**: `f(x)\{0 < x < 2\}` parses to a `When` head; stacked
  restrictions canonicalize to a single `When(expr, And(c₁, c₂))`. Downstream
  evaluation/compilation see one canonical shape. *(0.57.0)*
- **`expr.getInterval(symbol)`** returns `IntervalBounds`
  (`lower`/`upper`/`lowerStrict`/`upperStrict`) from `When`, `And`, and bare
  comparison expressions — useful for deriving a 2D-plot domain, e.g. clipping
  `y = f(x)\{0 < x < 5\}` to `[0, 5]`. Returns `undefined` for unsupported
  shapes. *(0.58.0)*

### Implicit surfaces / region classification

- **`expr.toSignedFunction()`** turns a relation into a function that is zero on
  the surface and negative where the relation holds: `Equal(a,b) → a−b`,
  `Less`/`LessEqual(a,b) → a−b`, `Greater`/`GreaterEqual(a,b) → b−a`. Returns
  `undefined` for non-relations. Note CE canonicalizes `Greater`/`GreaterEqual`
  to `Less`/`LessEqual`, so you'll usually see the `Less` operator on parsed
  input; the signed-function semantics are preserved. *(0.58.0)*

### Notation conveniences

- **Component access** `p.x`/`p.y`/`p.z`, `z.re`/`z.im`, `L.\operatorname{count}`,
  etc. parse to existing semantic heads (`First`/`Second`/`Third`, `Real`,
  `Imaginary`, `Length`, …). *(0.57.0)*
- **List-range ellipsis** inside brackets: `[1...9] → Range(1, 9)`, and the
  inferred-step float idiom `[0, 0.1, ..., 1]` (tolerance-aware). *(0.57.0)*
- **For-comprehensions**: `(x, y) \operatorname{for} x = L₁, y = L₂` →
  nested-loop `Loop(...)` producing an indexed collection (Cartesian for
  independent bindings, dependent when later clauses reference earlier). *(0.57.0)*
- **`ce.latexOptions`** — engine-wide mutable LaTeX parse/serialize options
  (`decimalSeparator`, `digitGroupSeparator`, `dotNotation`, …), settable in the
  constructor or as a property; merged into every `parse`/`toLatex`. *(0.56.0)*
- **`dotNotation` serializer option** and **`toLatex({ verbatim: true })`** for
  round-tripping authored notation back to its source form. *(0.57.0)*

### Limits and safety

- **`ce.maxCollectionSize`** (default `10_000`) caps how many elements a
  collection materializes into a concrete `List`; larger stays lazy. Set `<= 0`
  or `Infinity` to disable. *(0.58.0)*
- **Interruptible evaluation**: collection ops, number theory, limits,
  differentiation, simplification, and integration now respect `ce.timeLimit`
  more consistently, throwing `CancellationError` or returning the best numeric
  estimate. *(0.60.0)*

### Introspection (handy for editor tooling)

- **`ce.operatorInfo(head)`** → `{ kind: 'function' | 'opaque', signature? }` or
  `undefined`. Classify heads by capability without a parallel allow-list. *(0.57.0)*
- **`ce.symbolInfo(name)`** → `{ kind: 'constant' | 'variable', type }` for
  constants and declared variables. *(0.58.0)*
- **`ce.normalizeIdentifier(latex)`** → canonical MathJSON name for a LaTeX
  identifier (`R_{3} → R_3`), side-effect free; useful before `ce.declare()`. *(0.58.0)*
- **`ce.functionProperties(name)`** → analytic metadata (poles, zeros, branch
  cuts, holomorphic domain) from the Fungrim corpus. *(0.60.0)*

---

## 9. Opt-in heavy features (likely skip for now)

Two large capabilities are **off by default** and live behind dedicated
sub-paths, so they add **zero bundle cost** unless you import them. For a
plotting/compilation workload you can ignore both for now.

### Curated identities (Fungrim)

```ts
import { loadIdentities } from '@cortex-js/compute-engine/identities';
loadIdentities(ce);                          // or { topics: ['gamma'] }
ce.parse('\\Gamma(\\frac12)').simplify();    // → √π
```

~1,376 guarded simplification rules and special values, synchronous and
idempotent per engine. Rules fire only when their side conditions are provable.
Useful for symbolic simplification, not for plotting.

### Symbolic integration (Rubi)

```ts
import { loadIntegrationRules } from '@cortex-js/compute-engine/integration-rules';
loadIntegrationRules(ce);
```

Adds a large rule-based integrator that closes many antiderivatives the base
engine leaves unevaluated. Relevant only if you compute symbolic integrals;
irrelevant to numeric plotting.

> The base engine already solves a wide range of derivatives, limits, exact
> definite/improper integrals, and polynomial equations **without** either
> loader — these improvements are built in.

---

## Quick reference

| Concern | 0.55.0 | 0.60.0 |
| --- | --- | --- |
| Numeric value out of `evaluate()` | `evaluate()` often numericized | use `.N()` / `evaluate({ numericApproximation: true })` |
| `Linspace(a, b, n)` | last point short of `b` | inclusive of both endpoints |
| `[1, 2, 3]` type | `list<number>` | `vector<3>` |
| `replace()` result | eagerly canonical | replaced subexprs only; add `.canonical` |
| Replacement form option | `{ canonical }` | `{ form }` (`canonical` is a deprecated alias) |
| `Color('…')` etc. | 0–1 sRGB tuple | typed head; `AsRgb(…)` for old shape |
| Compile | `compile(expr, { to })` | unchanged; more heads + GPU parity |
| `ce.box()` | deprecated alias of `expr()` | still a deprecated alias |

## Methods that are unchanged

`new ComputeEngine({ latexSyntax })`, `ce.parse()`, `expr.latex` /
`expr.toLatex()`, `ce.expr()`, `evaluate()`, `simplify()`, `solve()`, the
`compile()` free function and its targets, the sub-path imports (`/core`,
`/latex-syntax`, `/compile`, `/interval`, `/numerics`, `/math-json`), and the
`ce.latexSyntax` accessor all behave as in 0.55.0. If your 0.55.0 integration
compiles and runs today, the only items above that can change its *output* are
§1 (symbolic `evaluate()`), §2 (`Linspace`), and §3 (collection types).
