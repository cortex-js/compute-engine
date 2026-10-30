# LaTeX Dictionaries

This directory holds the LaTeX parsing/serialization dictionaries, one file per
domain (`definitions-arithmetic.ts`, `definitions-calculus.ts`, …). Each entry
maps a LaTeX trigger to a MathJSON head and back.

This README documents the **integral subsystem** (`\int`, `\iint`, `\oint`, …)
specifically: its parse → canonicalize → evaluate → serialize pipeline spans
several modules (`definitions-calculus.ts` here, plus `library/calculus.ts`,
`library/core.ts`, `symbolic/antiderivative.ts`, `boxed-expression/`), and the
pieces have non-obvious invariants that are easy to break in isolation. If you
touch one stage, read this first.

## Triggers and shadowing

A declaration can take a name back from the dictionary only when the special
meaning of the name resolves through `parseSymbol` and the scope. A bare-token
`latexTrigger` or `symbolTrigger` claims its tokens before `parseSymbol` runs,
and no declaration and no `resolveSymbol` handler can reclaim them. Before you
add a trigger on a bare letter or a bare Greek command, choose one of two
designs:

- **Free the letter.** Use this when the bare spelling is usually a variable.
  The trigger is upright markup only. Example: `CatalanConstant` is
  `\operatorname{G}`; a bare `G` is the symbol `G`. `e` and `i` follow the same
  model (`\exponentialE`, `\mathrm{e}`).
- **Yield to a declaration.** Use this when the bare spelling has a real
  mathematical meaning. The parselet keeps the default reading and declines when
  the user declared the name. Example: `\gamma` is `EulerGamma`, but after
  `ce.declare('gamma', 'real')` it is the symbol `gamma`. Euler `D_x f` is a
  derivative, but `D_x` is a symbol when `D_x` is declared, and `D_x f` is a
  product when `D` is declared with a non-function type. Test for a function
  type, not for any declaration: the library `D` is itself declared.

A parselet that declines returns `null`. It must not return the symbol name:
these parselets run before `parseFunction()`, so a returned name strands a
declared function call such as `\gamma(2, 1)` as an `InvisibleOperator` on the
raw route. Test both `ce.parse(s)` and `ce.parse(s, { form: 'raw' })`.

Some spellings are fixed on purpose:

- `\operatorname{\alpha}` is the plain symbol `alpha`, so a Greek constant
  cannot use upright markup as its trigger. `\operatorname{EulerGamma}` (any
  MathJSON name inside `\operatorname{}`) round-trips without a dictionary
  entry, which is why `EulerGamma` serializes to that form.
- `\varphi` is `GoldenRatio`; `\phi` stays a plain variable.
- The three-token triggers `\mu_0` and `\varepsilon_0` (`DEFINITIONS_PHYSICS` in
  `default-dictionary.ts`) parse as the constants `Mu0` and
  `VacuumPermittivity`. This is intentional (user decision 2026-06-22). The
  braced form `\mu_{0}` is the plain symbol `mu_0`. Known limit: the plain
  symbol `mu_0` serializes as `\mu_0`, which parses back as `Mu0`.

The serializer has no access to the scope: `SerializeLatexOptions` carries no
`resolveSymbol`. A rule such as "write `\gamma` unless `gamma` is declared"
needs a change to that interface.

## The shape of an `Integrate` expression

```
["Integrate", integrand, limit₁, limit₂, …]
```

- `integrand` — a `Function` literal `["Function", body, var]` that binds **only
  the integration variable(s) of that level**, _not_ free coefficients. So
  `∫ a·sin(x) dx` is `Integrate(Function(a·sin(x), x), Limits(x,…))` — `a` stays
  free. (Was a bug: it used to bind `a` too.)
- each `limitᵢ` is `["Limits", var, lower, upper]`. `Nothing` marks a missing
  bound (`∫_0 …`) or a missing variable.
- the order of the limits follows Mathematica (user decision 2026-07-24): the
  **first** limit is the **outermost** integral, and the last limit is
  integrated first. A bound may refer to the variables of the limits before it:
  `Integrate(1, Limits(x, 0, 1), Limits(y, 0, x))` is the area of a triangle,
  `1/2`. A bound that refers to its own variable or to a later (inner) variable
  is a free symbol for the symbolic route, and the numeric route declines it.
  See `nIntegrateMultiple` in `library/calculus.ts`.

`CircularIntegrate` (`\oint`) shares the parser/serializer but is **not**
canonicalized the same way — its body is left as a bare application and its
limits stay `Tuple`, not `Limits`. See the serialization caveat below.

## Parsing (`definitions-calculus.ts`)

**Nested integrals parse by recursion, one integral sign per level — not by a
loop.** `\int_1^2\int_3^4 x·y dx dy` is parsed as the outer `\int` whose
integrand is, recursively, the inner `\int`. The result nests:

```
Integrate(Function(Integrate(Function(x·y, x), Limits(x,3,4)), y), Limits(y,1,2))
```

The load-bearing rule is **`nIntegrals`** (the
`parseIntegral(command, nIntegrals)` argument): it caps how many trailing
differentials a level may consume. A single `\int` claims exactly one
differential; the rest belong to the enclosing integrals.

- `\int` → 1, `\iint` → 2, `\iiint` → 3 (same for `\oint`/`\oiint`/`\oiiint`).
- Without this cap the innermost integral greedily swallowed **all** the
  differentials (`dx dy dz`), leaving the outer integrals with a `Nothing`
  variable — so the expression could not evaluate. This was the original bug.

Convention: the **innermost** differential pairs with the **innermost** integral
(`dx` ↔ `\int_3^4`), the next outward differential with the next integral (`dy`
↔ `\int_1^2`). Verify any change with **distinct** bounds (`\int_1^2\int_3^4`),
never `\int_0^1\int_0^1`, which can't reveal a swap.

`\iint` / `\iiint` are genuine multi-sign-at-one-level notations: they parse to
a single, **flat** `Integrate` with 2/3 limits (`nIntegrals` lets one level bind
several differentials). `\int\int` parses to a **nested** `Integrate`. Both are
correct; they are different expressions.

The sub/superscript-capturing code is straight-line (one set of limits per
sign). An earlier `while` loop gated on `parser.match(command)` where `command`
is the MathJSON head (`'Integrate'`), which never matches a `\int` token — so it
always ran once. It was removed; do not reintroduce it thinking it merges
`\int\int` into one level (that would defeat the nesting above).

## Evaluation (`library/calculus.ts`, `library/core.ts`, `symbolic/antiderivative.ts`)

A definite integral evaluates as: find an antiderivative `F`, then
`["EvaluateAt", F, a, b]` reduces to `F(b) − F(a)`.

Two invariants make nested and parametric integrals work:

1. **`EvaluateAt` reduces _symbolic_ results, not only numeric ones**
   (`library/core.ts`). `∫_3^4 k·x dx` → `7/2·k`, not an inert bracket. The
   guard is "reduce unless the application stalled on an unresolved
   antiderivative" — i.e. unless `F(a)`/`F(b)` still contains an inert
   `Integrate` (`!result.has('Integrate')`). An older guard required a pure
   number and so left every parametric definite integral unevaluated.

2. **`antiderivative()` collapses an inert nested integral before integrating
   it** (`symbolic/antiderivative.ts`). The outer integrand of `∫∫ x·y dx dy` is
   the inner `∫_3^4 x·y dx`, which arrives inert; it is `.evaluate()`d to
   `7/2·y` first, so the outer integration sees a concrete integrand. Together
   with (1), `∫_1^2∫_3^4 x·y dx dy → 21/4`.

`evaluate()` vs `.N()` honors the exactness contract: an exact integrand stays
exact/symbolic; only `numericApproximation` routes to `NIntegrate` (adaptive
quadrature, with a Monte-Carlo fallback). See the project `ARCHITECTURE.md`
"What `.N()` promises" section.

## Serialization (`serializeIntegral`)

- A limit is recognized as a tuple/range only for the heads the serializer
  lists: `Tuple`, **`Triple`**, `Pair`, `Limits`, `Range`. A 3-element `Tuple`
  is emitted to MathJSON as **`Triple`** (arity mapping in
  `boxed-expression/serialize.ts`), so `Triple` must be in that list — omitting
  it made `\oint` (whose limits are `Tuple`→`Triple`) serialize to the literal
  string `\ointundefined`.
- A flat 2-/3-limit integral serializes back to the **compact** sign (`\iint` /
  `\iiint` / `\oiint` / `\oiiint`) via `compactMultiIntegralSign`, so it
  round-trips to the same structure instead of a `\int\int…` stack. This only
  applies when the extra limits are bare (those signs take a single region
  subscript); otherwise it falls back to the iterated form. Nested integrals
  serialize one limit per level and never hit the compact path.

## Tests

- `test/compute-engine/latex-syntax/calculus.test.ts` — parse + serialize +
  round-trip snapshots (incl. `MULTIPLE INTEGRALS`, `EXOTIC INTEGRALS`).
  **Snapshot suite — eval tests alone won't catch a broken parse structure.**
- `test/compute-engine/calculus.test.ts` — `DEFINITE INTEGRATION` (resolves
  symbolically, then applies the limits).
- `test/compute-engine/integration-rules.test.ts` — rule-driven integration.
