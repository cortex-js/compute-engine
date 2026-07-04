# Architecture

This document describes the overall architecture of the **Cortex Compute
Engine** — a TypeScript library for symbolic manipulation and numeric
evaluation of mathematical expressions, published as
[`@cortex-js/compute-engine`](https://www.npmjs.com/package/@cortex-js/compute-engine).

It is the high-level map of the codebase, intended for contributors and
maintainers. For the public API and usage guides, see
[`README.md`](./README.md) and
[cortexjs.io/compute-engine](https://cortexjs.io/compute-engine/). For the
detailed module-boundary and dependency-direction rules, see
[`docs/architecture/CURRENT-ARCHITECTURE.md`](./docs/architecture/CURRENT-ARCHITECTURE.md).

## What the Compute Engine does

The Compute Engine parses, manipulates, evaluates, and serializes mathematical
expressions. Its capabilities fall into a few categories:

- **Parse** LaTeX (and ASCIIMath-ish lenient syntax) into a structured
  representation.
- **Canonicalize** expressions into a normalized form for consistent comparison
  and efficient operations.
- **Evaluate** expressions symbolically or numerically (machine precision or
  arbitrary precision).
- **Simplify**, **expand**, **factor**, **solve**, differentiate, and integrate.
- **Reason** about expressions using assumptions and a type system.
- **Compile** expressions to executable JavaScript (and GLSL/WGSL/Python).
- **Serialize** back to LaTeX, MathASCII, or MathJSON.

## The big picture: three representations and one engine

Everything in the Compute Engine flows between three representations of an
expression, mediated by the `ComputeEngine` instance:

```
   LaTeX string                MathJSON                 BoxedExpression
  "x + \frac{1}{2}"   ◄──►   ["Add","x",...]   ◄──►   (boxed, typed, canonical)
        │                         │                          │
   latex-syntax/             math-json/              boxed-expression/
   (parse/serialize)      (interchange format)    (the runtime object model)
```

1. **LaTeX** is the human-facing input/output notation.
2. **MathJSON** is the JSON-based interchange format — plain data, no behavior.
   It is the serialization boundary and the format consumers store and exchange.
3. **BoxedExpression** is the live, in-memory object model. Boxed expressions
   carry a type, a definition binding, cached properties, and methods to
   evaluate, simplify, compare, and serialize themselves. All computation
   happens on boxed expressions.

The typical lifecycle:

```
Parse        LaTeX ──► MathJSON ──► BoxedExpression   (ce.parse)
Canonicalize             normalize structure & operands
Evaluate                 symbolic / numeric result
Simplify                 apply algebraic rewrite rules
Serialize    BoxedExpression ──► MathJSON ──► LaTeX   (.json / .latex)
```

The `ComputeEngine` (`src/compute-engine/index.ts`) is the composition root that
owns scopes, symbol/operator definitions, assumptions, numeric configuration,
the standard library, and the LaTeX syntax. It exposes the public API:
`parse()`, `box()`/`expr()`, `function()`, `evaluate()`, `simplify()`,
`declare()`, `assign()`, `assume()`, `ask()`, and more.

## Repository layout

```
src/
├── compute-engine.ts        Full package entry (engine + LaTeX + compilation)
├── core.ts                  Core engine entry (no LaTeX, no compilation)
├── math-json.ts             MathJSON types + utilities entry
├── latex-syntax.ts          Standalone LaTeX parser/serializer entry
├── interval.ts              Interval-arithmetic entry
├── numerics.ts              Numeric primitives entry
├── compile.ts               Compilation-targets entry
├── cortex.ts                Experimental Cortex language (not a published entry)
│
├── math-json/               MathJSON format: types + accessors/guards
│   ├── types.ts             MathJsonExpression and its object forms
│   └── utils.ts             operator(), operands(), type guards, accessors
│
├── big-decimal/             Arbitrary-precision decimals backed by native bigint
│   ├── big-decimal.ts       BigDecimal class: arithmetic, comparison, rounding
│   ├── transcendentals.ts   sqrt/exp/ln/sin/cos/atan/… (prototype-merged)
│   └── utils.ts             fixed-point bigint primitives, π constant, pow10 cache
│
├── common/                  Cross-cutting utilities
│   └── type/                The type system (see "Type system" below)
│
└── compute-engine/          The engine itself
    ├── index.ts             ComputeEngine class (composition root, ~1700 lines)
    ├── compute-engine.ts    Full-package wiring (LatexSyntax factory injection)
    ├── engine-*.ts          Runtime services (one bounded concern per file)
    ├── types-*.ts           Type contracts (kernel generics + concrete wrappers)
    ├── free-functions.ts    Top-level parse/simplify/evaluate/N/… via a global engine
    │
    ├── boxed-expression/     The runtime object model (the heart of the engine)
    ├── latex-syntax/         LaTeX ↔ MathJSON tokenizer, parser, serializer, dictionary
    ├── library/              Standard library of operators & constants, by domain
    ├── symbolic/             Simplification rules, calculus, the Fu trig algorithm
    ├── numerics/             Numeric algorithms (primes, rationals, special functions)
    ├── numeric-value/        NumericValue abstraction (exact / machine / bignum)
    ├── compilation/          Expression → JS/GLSL/WGSL/Python code generation
    ├── interval/             Interval arithmetic
    └── tensor/               Vectors, matrices, multi-dimensional arrays
```

## Layered module architecture

Within `src/compute-engine/`, modules are organized into layers with a strict,
acyclic dependency direction (enforced by ESLint `import/no-restricted-paths`
and a zero-circular-dependency budget checked with `madge`):

```
4. Composition root      index.ts (ComputeEngine) — composes services, public API
3. Runtime services      engine-*.ts — one bounded concern per file
2. Type wrappers         types-*.ts, global-types.ts — bind generics to concrete types
1. Kernel type layer     types-kernel-*.ts — generic contracts, no engine imports
```

The `ComputeEngine` class is deliberately an "API shell and integration point":
business logic lives in the `engine-*.ts` services (startup, scoping,
declarations, assumptions, numeric configuration, caching, extension contracts,
compilation-target registry, etc.). See
[`docs/architecture/CURRENT-ARCHITECTURE.md`](./docs/architecture/CURRENT-ARCHITECTURE.md)
for the full service inventory and the dependency rules.

## MathJSON: the interchange format

`src/math-json/` defines the format. A `MathJsonExpression` is plain JSON in one
of these forms:

- A **number** — `2.5`, or `{ num: "3.14159..." }` for arbitrary precision /
  special values (`"NaN"`, `"+Infinity"`).
- A **symbol** — `"x"`, `"Pi"`, or `{ sym: "Pi" }`.
- A **string** — `{ str: "hello" }`.
- A **function** — `["Add", "x", 1]`, or `{ fn: [...] }`. The first element is
  the operator (head); the rest are operands.
- A **dictionary** — `{ dict: { ... } }`.

Any object form may carry optional metadata: `comment`, `latex`, `wikidata`,
`sourceUrl`, and similar. `src/math-json/utils.ts` provides safe accessors
(`operator()`, `operands()`, `stringValue()`) and type guards. MathJSON has no
behavior — it is the inert boundary between the LaTeX layer, the boxed object
model, and the outside world.

## Boxed expressions: the runtime object model

`src/compute-engine/boxed-expression/` is the heart of the engine. A
"boxed" expression is a class instance that wraps a piece of math with a
consistent interface for evaluation, comparison, and serialization.

### Class hierarchy

`_BoxedExpression` (`abstract-boxed-expression.ts`) is the abstract base; the
concrete subclasses are:

| Class | File | Represents |
|---|---|---|
| `BoxedNumber` | `boxed-number.ts` | Numeric literals (int, rational, radical, float, bignum, complex) |
| `BoxedSymbol` | `boxed-symbol.ts` | Symbols/identifiers, bound to a value definition when canonical |
| `BoxedFunction` | `boxed-function.ts` | Function applications `[operator, ...operands]`, bound to an operator definition |
| `BoxedString` | `boxed-string.ts` | String literals (stored NFC-normalized) |
| `BoxedDictionary` | `boxed-dictionary.ts` | Key/value maps |
| `BoxedTensor` | `boxed-tensor.ts` | Vectors, matrices, n-dimensional arrays |

The shared public surface (on `_BoxedExpression`) includes the getters/methods
most consumers use: `.json`, `.latex`/`.toLatex()`, `.operator`, `.ops`,
`.type`, `.canonical`, `.structural`, `.evaluate()`, `.simplify()`, `.N()`,
`.subs()`, `.match()`, the algebra helpers (`.add()`, `.mul()`, `.pow()`, …),
and the three comparison methods `.isSame()` / `.is()` / `.isEqual()` (see
[CLAUDE.md](./CLAUDE.md#expression-comparison-methods) for their distinct
semantics).

### Boxing and canonical forms

`box.ts` is the factory: it takes raw input (a number, string, MathJSON, or
existing boxed expression), chooses the concrete class, and — by default —
canonicalizes the result. Canonicalization normalizes structure so that
mathematically equal expressions share a representation: it flattens associative
operators, orders operands, and folds exact numeric operands. The arithmetic
modules implement the per-operator canonical logic:

- `arithmetic-add.ts` — flatten, drop zeros, fold exact numbers, sort terms.
- `arithmetic-mul-div.ts` — group by exponent, combine coefficients (`Product`).
- `arithmetic-power.ts` — exponent rules, root/radical normalization.
- `flatten.ts`, `negate.ts`, `order.ts` — supporting transforms.

`canonical.ts` orchestrates partial/selective canonicalization by named form
(`Number`, `Multiply`, `Add`, `Power`, `Divide`, `Flatten`, `Order`).

Three creation modes exist — **canonical** (default), **structural** (bound but
not canonicalized), and **non-canonical** (not bound, usable only for pattern
matching/serialization). The distinctions and pitfalls are documented in detail
in [CLAUDE.md](./CLAUDE.md#expression-creation-modes-canonical-vs-structural).

### Generic-symbol conventions at canonicalization

Canonicalization applies a small set of algebraic folds to **generic**
(unconstrained) symbols — an operand that carries a free variable stands for a
generic value of that variable. These are deliberate conventions, not bugs: they
trade exactness at a measure-zero point for a simpler canonical form.

| Input                    | Canonical form              |
| ------------------------ | --------------------------- |
| `x / x`, `(x + 1)/(x + 1)` | `1`                       |
| `1 ^ x`                  | `1`                         |
| `x / 0`                  | `~∞` (`ComplexInfinity`)    |
| `0 / x`                  | `0`                         |
| `x / ∞`                  | `0`                         |

The cancellation **asserts genericity**: `x/x → 1` treats `x` as a generic
(hence non-zero) value. This is why the fold survives a later substitution —
`ce.parse('\\frac{x}{x}').subs({ x: 0 })` is `1`, not `NaN`, because the `.json`
is already the literal `1` before the substitution reaches it. To recover the
true value at an excluded point, keep the expression uncanonicalized
(`{ canonical: false }`) and evaluate after substituting.

**Constant operands are protected.** These folds fire only on operands that
carry a free variable. A numerator or denominator that is a *constant
expression* is never collapsed by the generic rules; it is evaluated instead, so
a provably-zero constant denominator surfaces the true indeterminate:

- `0 / (1 − 1)` canonicalizes to `NaN` — the denominator evaluates to `0`,
  giving `0/0` — **not** to `0`: the `0/x → 0` fold does not reach a constant
  zero.
- `(1 − 1) / 0` and `0 / 0` likewise canonicalize to `NaN`.
- `(π + 1)/(π + 1)` is left as a fraction at canonicalization (a constant, so the
  identical-operand fold is skipped); it reduces to `1` only under `.simplify()`,
  which first proves the denominator non-zero.

Larger cancellations (`x²/(5x²) → 1/5`) and the wider policy that governs which
`.simplify()` rewrites treat an unknown as a generic **real** (why
`ln(x) + ln(y) → ln(xy)` fires for an unconstrained `x` but not for a
declared-`complex` one) are **simplify-level**, documented in
[`docs/SIMPLIFY.md`](./docs/SIMPLIFY.md#generic-real-simplification-policy).

### Non-finite typing convention for type handlers

The numeric lattice (D10) can name only some of the non-finite values:
`non_finite_number` is **exactly `{+∞, −∞}`**; `real`/`rational`/`integer` and
`complex` admit ±∞ on top of their finite tower; **`~oo` (`ComplexInfinity`)
and NaN are admitted only by the top type `number`**. Since the lattice cannot
distinguish "±∞" from "maybe `~oo`" from "maybe NaN" (SYM P2-23, resolved as a
convention, not a lattice extension), every operator `type` handler follows
these rules:

1. **Claim `non_finite_number` only when the value is _provably_ `±∞`.**
   Examples: `Ln(0) = −∞`; `Round/Ceil/Floor/Truncate` of a provably real ±∞;
   `±∞ · (finite reals all provably non-zero)`; `EllipticK(1) = +∞`;
   `(+∞)^p` for finite real `p > 0`; `±∞ + (real terms)`.
2. **When a non-finite value or NaN is merely _possible_ — or the value is
   provably `~oo` — claim `number`.** Do not claim `non_finite_number`
   speculatively, do not claim a finite type, and do not claim `complex`
   (which does not admit `~oo`/NaN). Examples: `x · ∞` with a possibly-zero
   `x` (0·∞ = NaN); `∞/∞`, `k/0`; pole-capable operators at arguments that can
   land on a pole (`Tan(π/2)`, `Csc(0)`, `Gamma(0)`, `Zeta(1)`,
   `Factorial(−2)` — all `~oo`); `√(−∞) = i·∞ = ~oo`.
3. **Unknown finiteness follows the generic-point convention; zero-ness must
   be proven when a non-finite operand is present.** An operand whose
   finiteness is _unknown_ (a bare `real` symbol; `isFinite === undefined`)
   is treated as a generic (finite) point — `Sin(x)` claims `finite_real`,
   and only a _provably_ non-finite operand (`isFinite === false`) triggers
   the non-finite analysis. But once an operand is provably non-finite, a
   claim that depends on another operand being non-zero (e.g. `x · ∞ = ±∞`,
   where `x = 0` gives NaN) must _prove_ it (via `sgn`), never assume it.
   (A possibly-zero _denominator_ with finite operands keeps `Divide`'s
   documented generic-point behavior — see the handler's comment.)

The **value** `~oo` itself currently reports type `complex` (the
`ComplexInfinity` symbol declaration and the numeric-value `type` getters);
this is a historical placement that the lattice cannot express better without
the deferred `~oo`/NaN lattice refinement. Handlers must not rely on it: an
expression that can evaluate to `~oo` is typed `number` per rule 2.

The shared handler implementations (and per-operator dispatch) live in
`src/compute-engine/library/type-handlers.ts`; the convention is pinned by
`test/compute-engine/non-finite-typing.test.ts`.

### Definitions: the semantics of symbols and operators

Behavior is attached not to the expression but to its **definition**, resolved
during binding against the current scope:

- `boxed-value-definition.ts` — `_BoxedValueDefinition`: a symbol's type, value,
  constancy, and `holdUntil` evaluation semantics.
- `boxed-operator-definition.ts` — `_BoxedOperatorDefinition`: a function's
  type signature, algebraic flags (`associative`, `commutative`, `idempotent`,
  `pure`, `lazy`, `broadcastable`, …), and its handlers (`canonical`,
  `evaluate`, `evaluateAsync`, `compile`, comparison, collection).

The standard library (below) is just a large table of such definitions.

### Evaluation, simplification, and other operations

`BoxedFunction.evaluate()` looks up the operator definition and dispatches to its
`evaluate` handler. `simplify.ts` drives rule-based simplification with guards
against infinite recursion (deduplication, a step limit, and loop detection —
see [CLAUDE.md](./CLAUDE.md#simplification-and-recursion-prevention)).
`serialize.ts` produces MathJSON from a boxed expression. The directory also
holds focused modules for `expand.ts`, `factor.ts`, `solve.ts` /
`solve-linear-system.ts`, `polynomials.ts`, `trigonometry.ts`, pattern matching
(`match.ts`, `pattern-utils.ts`), comparison (`compare.ts`), and the type guards
exported to consumers (`type-guards.ts`).

## Type system

`src/common/type/` is a self-contained type system used to describe and check
the types of mathematical expressions. It models:

- **Numeric primitives** in a subtype lattice:
  `integer ⊂ rational ⊂ real ⊂ complex ⊂ number`, with finite/non-finite
  variants and bounded ranges (e.g. `integer<5..10>`).
- **Collections**: `list`, `set`, `tuple`, `record`, `dictionary`, with shapes
  (e.g. `matrix<number^(2x3)>` for a matrix).
- **Function signatures**: `(x: number, number?) -> number`, including named,
  optional, and variadic arguments.
- **Algebraic types**: union (`|`), intersection (`&`), negation (`!`), plus the
  special types `any`, `unknown`, `nothing`, `never`, `error`.

Types are written as strings in a small grammar and parsed through
`lexer.ts → parser.ts → type-builder.ts` into a `Type` AST; `subtype.ts` and
`reduce.ts` implement compatibility checking and simplification; `serialize.ts`
renders types back to strings. `boxed-type.ts` provides `BoxedType`, the
immutable wrapper used throughout the engine and exposed on every
`BoxedExpression` via `.type`.

`src/common/` also hosts other shared utilities (an interruptible/cancellation
helper, JSON/JSON5, Markdown rendering, grapheme handling, fuzzy string
matching).

## LaTeX syntax

`src/compute-engine/latex-syntax/` converts between LaTeX and MathJSON,
independently of the engine. The pipeline:

```
LaTeX string ──tokenizer.ts──► tokens ──parse.ts──► MathJSON
MathJSON ──serializer.ts──► LaTeX string
```

`LatexSyntax` (`latex-syntax.ts`) is the public class, exposing `parse()` and
`serialize()`. Parsing is a recursive-descent / precedence-climbing parser
driven by a **dictionary** of entries (`dictionary/`) that map LaTeX notation to
MathJSON operators. The dictionary is assembled in `default-dictionary.ts` from
domain files (`definitions-arithmetic.ts`, `definitions-algebra.ts`,
`definitions-trigonometry.ts`, `definitions-sets.ts`, …), each contributing
`symbol`, `function`, `infix`, `prefix`, `postfix`, `matchfix`, or `environment`
entries with precedence. A **lenient** (non-strict) mode accepts ASCIIMath-style
input such as bare `sin(x)` and `x^(2)`; see
[`docs/LENIENT_PARSER.md`](./docs/LENIENT_PARSER.md).

`LatexSyntax` is an **injectable dependency** of `ComputeEngine`, not a static
import. The full package entry wires it in via a factory so `ce.parse()` works
out of the box; the core entry omits it (LaTeX methods then throw a clear
error). This keeps LaTeX out of bundles that don't need it — see
[`docs/architecture/CURRENT-ARCHITECTURE.md`](./docs/architecture/CURRENT-ARCHITECTURE.md#latexsyntax-as-injectable-dependency).

## The ComputeEngine and its services

`ComputeEngine` (`src/compute-engine/index.ts`) ties everything together. Its
public API groups into:

- **Construction**: `parse()`, `box()`/`expr()`, `function()`, `hold()`,
  `tuple()`, plus numeric helpers `bignum()`, `complex()`, `chop()`.
- **Operations**: `evaluate()`, `N()`, `simplify()`, `expand()`/`expandAll()`,
  `factor()`, `solve()`.
- **Declarations & assignment**: `declare()`, `declareType()`,
  `declareSequence()`, `assign()`.
- **Reasoning**: `assume()`, `ask()`, `verify()`, `forget()`.
- **Compilation**: `registerCompilationTarget()`, `getCompilationTarget()`,
  `listCompilationTargets()`.
- **Configuration**: `precision` (default 21 significant digits; `'machine'`
  selects 64-bit float), `tolerance` (default `1e-10`), `angularUnit`
  (default `'rad'`), `strict` (validation depth), `timeLimit` (default 2000 ms),
  `iterationLimit` / `recursionLimit` (default 1024).

Internally these responsibilities are delegated to focused services
(`engine-startup-coordinator.ts`, `engine-scope.ts`, `engine-declarations.ts`,
`engine-assumptions.ts`, `engine-numeric-configuration.ts`,
`engine-runtime-state.ts`, `engine-cache.ts`,
`engine-compilation-targets.ts`, `engine-extension-contracts.ts`, …).

**Scopes & assumptions.** Symbol and operator definitions live in lexical scopes
with proper inheritance. Assumptions (e.g. "x > 0") are recorded per scope and
consulted during simplification and three-valued (`true`/`false`/`undefined`)
queries via `ask()` / `verify()`. The contract is detailed in the next section.

### Assumptions & reasoning

The assumptions subsystem (`engine-assumptions.ts`, `assume.ts`,
`boxed-expression/constraint-subject.ts`) lets callers state facts about
otherwise-free symbols and query them back. Its public surface is `assume()`,
`ask()`, `verify()`, and `forget()`.

**Predicate forms.** `assume()` accepts a `BoxedExpression`, a MathJSON
expression, or a **string** (parsed as LaTeX — `'x > 0'`, `'$x > 0$'`, or
`'\pi > 0'`; `verify()` accepts the same three forms). The supported predicates
are membership (`Element` / `NotElement`), (dis)equality (`Equal` / `NotEqual`),
the inequalities (`Less` / `LessEqual` / `Greater` / `GreaterEqual`), and their
conjunction (`And`). The predicate is canonicalized, then stored in a normalized
shape: inequalities as `Less`/`LessEqual` against `0` (e.g. `x + y > 0` →
`Less(Add(Negate(x), Negate(y)), 0)`), equalities as `Equal(lhs − rhs, 0)`. A
value assumption (`assume(x = 5)`) additionally installs a value binding for the
symbol. `assume()` returns `'ok'`, `'tautology'` (already implied), or
`'contradiction'` (incompatible with existing facts).

**Scoping.** Assumptions are recorded in the current lexical scope
(`ce.context.assumptions`). A child scope sees the parent's facts (they are
copied on push) but discards its own additions on `popScope()`; a
subsequently-restored scope therefore recovers the parent's original facts. Any
mutation bumps the engine generation counter (`ce._generation`), which
invalidates the cached rule sets and the FactIndex (below) so stale sign/bound
answers cannot survive a scope change.

**Three-valued discharge.** `verify(P)` returns `true` when `P` is provable from
the current assumptions, `false` when its negation is provable, and `undefined`
when neither can be decided (Kleene semantics). It first evaluates the predicate
(so `x < 0` reduces to `False` under `assume(x > 0)`), recurses through
`And`/`Or`/`Not` with Kleene combination, and finally consults the assumptions
DB directly (via `ask`) for opaque multi-symbol facts such as `x·y > 0` that the
evaluator cannot reduce. `ask(pattern)` matches a pattern **containing
wildcards** (`_k`, `_val`, …) against the stored facts and returns the list of
binding substitutions; for a closed (wildcard-free) predicate it degrades to a
`verify`-style existence check. Recursion between the two (`verify → ask →
verify`) is broken by an `_isVerifying` re-entrancy flag: while it is set,
`ask` skips its closed-predicate `verify` fallback.

**Bounds & the FactIndex.** Sign and bound queries are answered from a cached
`FactIndex` (`getFactIndex`, keyed on the generation counter, the assumptions
map identity, and the fact count). It maps each **subject** — a bare symbol or a
part extractor of one (`Re(z)`, `Im(τ)`, `Abs(q)`, `Argument(z)`) — to its
numeric `lower`/`upper` bounds with strictness flags. `assume()` uses it for the
tautology/contradiction checks; the sign getters (`isPositive`, `isNonNegative`,
…) and `verify()` both read the same bounds, so they **converge**: an assumption
that fixes a sign is reflected identically whether queried through `expr.sgn` /
`isPositive` or through `verify(Greater(x, 0))`. A legacy linear scan remains
only as a fallback for facts the index does not capture.

**`forget()` and provenance.** `forget(symbol)` removes every stored fact that
references the symbol and resets any value the symbol received **from an
assumption** — `declare()` / `assign()` values are left intact. To tell the two
apart, assume-installed value bindings are tracked in a per-scope provenance set
(`context.assumptionBindings`); `forget()` (no argument) clears all facts and
undoes exactly those bindings, so a symbol assigned only via `assume(x = …)`
evaluates back to itself, while a user `assign()` survives.

**Free functions.** `free-functions.ts` exports top-level `parse`, `simplify`,
`evaluate`, `N`, `expand`, `factor`, `solve`, `assign`, etc., backed by a
lazily-created shared engine (`getDefaultEngine()`), so simple use needs no
explicit `ComputeEngine` setup.

## Standard library

`src/compute-engine/library/` is the table of built-in operator and constant
definitions, organized by domain: `core`, `arithmetic`, `trigonometry`,
`calculus`, `polynomials`, `logic`, `collections`, `sets`, `linear-algebra`,
`complex`, `combinatorics`, `number-theory`, `statistics`, `units`, and more.
`library.ts` declares the domains, their `requires` dependencies, and a
topological sort so dependencies load first. Libraries can be loaded selectively,
and consumers can register their own (validated by the extension contracts).

## Simplification and symbolic algebra

`src/compute-engine/symbolic/` implements rewriting:

- `simplify-rules.ts` is the main rule set, supported by domain-specific
  simplifiers (`simplify-sum.ts`, `simplify-product.ts`, `simplify-power.ts`,
  `simplify-trig.ts`, `simplify-log.ts`, `simplify-logic.ts`, …).
- `fu.ts` / `fu-transforms.ts` / `fu-cost.ts` implement the Fu et al. algorithm
  for automated trigonometric simplification, using a cost function to greedily
  reduce complexity.
- `derivative.ts` and `antiderivative.ts` provide symbolic calculus;
  `distribute.ts` handles distribution.

Rules are pattern/predicate based and must avoid re-entrant `.simplify()` calls;
the recursion constraints are documented in
[CLAUDE.md](./CLAUDE.md#simplification-and-recursion-prevention).

## Numerics

Numeric values are abstracted so the engine can stay exact when possible and
fall back to floating or arbitrary precision when needed.

- **`numeric-value/`** defines the `NumericValue` abstraction with three
  concrete variants:
  - `ExactNumericValue` — `(rational × √radical) + imaginary`, keeping integers,
    rationals, and radicals exact.
  - `MachineNumericValue` — IEEE-754 64-bit float (with Gaussian-integer
    imaginary part).
  - `BigNumericValue` — arbitrary precision via `BigDecimal`.
- **`big-decimal/`** is a custom arbitrary-precision decimal type backed by
  native `bigint` (significand × 10^exponent), with its own transcendental
  functions. It replaces the former `decimal.js` dependency in `src/`;
  `decimal.js` now appears only in `test/big-decimal/` cross-validation and
  benchmarks.
- **`numerics/`** holds the algorithms: rationals, primes/factorization,
  special functions (gamma, zeta, Bessel, …), statistics, interval helpers,
  and numeric integration/extrapolation. Complex numbers use the `complex-esm`
  package.

## Compilation

`src/compute-engine/compilation/` turns a boxed expression into source code in a
target language. `base-compiler.ts` walks the expression tree language-agnostically
and delegates formatting to a `LanguageTarget` / `CompileTarget`
(`types.ts`). Built-in targets:

- `javascript-target.ts` — executable JavaScript (with `constant-folding.ts`).
- `glsl-target.ts`, `wgsl-target.ts`, `gpu-target.ts` — GPU shaders.
- `python-target.ts` — Python 3.
- `interval-javascript-target.ts` — JavaScript with interval arithmetic.

Targets are registered in the engine's compilation-target registry and validated
by the extension contracts. Consumers can register custom targets via
`ce.registerCompilationTarget()`.

## Packaging and entry points

The package ships several independently importable bundles (the `exports` map in
`package.json`). Each is built by `scripts/build.mjs` (esbuild) as ESM + UMD,
minified, with `.d.ts` types in `dist/types/`:

| Import path | Source | Contents |
|---|---|---|
| `@cortex-js/compute-engine` | `src/compute-engine.ts` | Full: engine + LaTeX + compilation + free functions |
| `…/core` | `src/core.ts` | Engine + free functions, **no** LaTeX/compilation |
| `…/math-json` | `src/math-json.ts` | MathJSON types + utilities only |
| `…/latex-syntax` | `src/latex-syntax.ts` | Standalone LaTeX parser/serializer |
| `…/numerics` | `src/numerics.ts` | Numeric primitives (BigDecimal, rationals, special functions) |
| `…/interval` | `src/interval.ts` | Interval arithmetic |
| `…/compile` | `src/compile.ts` | Compilation targets |

The **full** entry (`compute-engine.ts`) registers
`ComputeEngine._latexSyntaxFactory` and a default-engine factory that injects
`LatexSyntax`; the **core** entry registers a factory without it. This is the
mechanism that lets `new ComputeEngine()` support LaTeX when imported from the
full package while keeping LaTeX out of core bundles. (`src/cortex.ts` is an
experimental Cortex-language entry and is not part of the published `exports`.)

## Build, test, and docs tooling

- **Build**: `npm run build` (dev → `/build`), `npm run build production`
  (minified → `/dist`). Driven by `scripts/build.sh` → `scripts/build.mjs`
  (esbuild) plus `tsc --emitDeclarationOnly` for types.
- **Type check**: `npm run typecheck` (run when completing a task).
- **Test**: `npm run test compute-engine/<name>` runs
  `test/compute-engine/<name>.test.ts` (Jest via `config/jest.config.cjs`).
  `npm run test snapshot` updates snapshots.
- **Lint**: `npm run lint` (ESLint + Prettier).
- **Dependency check**: `npm run check:deps` (`madge` — zero circular
  dependencies; ESLint also enforces the layering rules).
- **Docs**: `npm run doc` (TypeDoc + `concat-md`) regenerates `src/api.md`. It is
  generated — do not edit it by hand.

## Architectural invariants

These properties are intentional and enforced; preserve them when contributing:

1. **Zero circular dependencies** in `src/compute-engine` (runtime *and*
   type-only), checked with `madge`. See
   [CLAUDE.md](./CLAUDE.md#circular-dependency-resolution) and
   `docs/architecture/ZERO-CYCLES-PLAN.md`.
2. **Layered imports**: kernel types → wrappers → services → composition root;
   no upward imports. Enforced by ESLint `import/no-restricted-paths`.
3. **LaTeX is optional**: the engine depends on the structural `ILatexSyntax`
   interface, never the concrete class.
4. **Extension points are validated at runtime**: custom libraries, compilation
   targets, and `compile()` options are shape-checked (extension contracts).
5. **Public type surfaces avoid explicit `any`.**
6. **Don't call `.simplify()` from within simplification rules** or functions
   they invoke (infinite-recursion risk).

## Where to go next

- [`README.md`](./README.md) — installation, quick start, public API examples.
- [`CLAUDE.md`](./CLAUDE.md) — detailed conventions: comparison methods,
  creation modes, simplification/recursion rules, circular-dependency patterns.
- [`docs/architecture/CURRENT-ARCHITECTURE.md`](./docs/architecture/CURRENT-ARCHITECTURE.md)
  — module/service inventory, dependency rules, extension contracts.
- [`docs/`](./docs/) — focused notes: `LENIENT_PARSER.md`, `SIMPLIFY.md`,
  `NUMERIC-SERIALIZATION.md`, and architecture/refactor plans.
- [`BUILD.md`](./BUILD.md) — build instructions.
