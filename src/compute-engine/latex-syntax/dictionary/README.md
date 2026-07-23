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
exact/symbolic; only `numericApproximation` routes to `NIntegrate` (Monte-Carlo
/ quadrature). See the project `CLAUDE.md` "Evaluate vs N" section.

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
