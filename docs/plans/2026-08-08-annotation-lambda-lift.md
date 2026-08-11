# Annotation-bound parameters (lambda lift) in Epsil typed declarations

**Status: IMPLEMENTED 2026-08-10** (rulings 2026-08-08). Parse-time desugar in
`src/epsil/parser.ts` (`reconcileFunctionAnnotation` / `liftAnnotation`,
hooked into `finishDeclaration`); new `parameter-name-mismatch` diagnostic
(`src/epsil/diagnostics.ts`, humanized in `src/cli/format.ts`); tests in
`test/epsil/annotation-lambda-lift.test.ts`; user docs in
`src/epsil/docs/declarations.md`. Decisions refined at implementation time are
marked **[impl]** below.

## Motivation

User feedback on lambda syntax expected this to work:

```epsil
const f = (x:number):number -> x^2 + 2x + 1     // expected; today: KeyValuePair misparse
```

Investigation showed the root cause is a false affordance: parameter names in
function *types* are semantically inert (compatibility ignores them — a lambda
named `x` satisfies `(y: number) -> number`), yet they *look* like binders.
Users therefore expect `const f : (x: number) -> number = x^2 + 2x + 1` to
bind `x` in the right-hand side. Today that fails with
`incompatible-type … got finite_number`, while the one-character-different
`f(x: number) -> number = x^2 + 2x + 1` (math-def head) works — hard to
explain.

## The rule

**A parameter name binds wherever it appears, and appears in at most one
place.** Names in a literal function-type annotation become the binders of an
automatically generated lambda; alternatively the lambda spells its own
parameters and the annotation stays unnamed. Names are never inert.

| Spelling | Behavior |
| --- | --- |
| `const f : (x: number) -> number = x^2 + 2x + 1` | **Lift**: desugars to `= (x) \|-> x^2 + 2x + 1`, return type ascribed |
| `const f : (x: number) -> number = (x) \|-> …` | OK — names present on both sides but **match** |
| `const f : (y: number) -> number = (x) \|-> …` | **Error** — name mismatch, with fix-it (rename either side) |
| `const f : (number) -> number = (x) \|-> …` | OK (status quo) |
| `const f : (number) -> number = x^2 + 2x + 1` | Error (no binders available); message suggests the two working spellings |
| `const f : BinOp = x + 1` | No lift through an alias (opaque); error as today |

The math-def head form `f(x: number) -> number = …` is unchanged and remains
the idiomatic named-definition spelling.

## Rulings (2026-08-08)

1. **Alias opacity — RULED: aliases are opaque.** The lift applies only when
   the annotation is a *syntactically literal* function type written at the
   declaration site. Names inside a `type` alias (or nominal type) remain
   documentation and never bind. Rationale: binders must be written where they
   bind; renaming inside an alias must never change use-site meaning.
2. **Both-sides-named — RULED: mismatch-only error, with fix-it.** Named
   annotation + lambda RHS is legal when the names match positionally
   (arity mismatches are left to the existing covariant type check). A name
   mismatch is an error with a fix-it. **[impl]** The fix-it renames the
   ANNOTATION to the lambda's names — the lambda's names are the binders the
   body actually uses, so that direction is the only semantics-preserving
   single edit (renaming the lambda's binder would orphan its body's
   references). This ruling keeps the currently-canonical
   `const f : (x: number) -> number = (x) |-> …` working (also the reflexive
   spelling for TypeScript users, where function types *require* names).
3. **Nested arrows — RULED: outermost only.** For
   `const f : (x: number) -> (y: number) -> number = …`, only `x` lifts; the
   body must itself be (or produce) a function of the inner type, e.g.
   `= (y) |-> x + y`. No recursive/curried lift. **[impl]** Disambiguation of
   a lambda RHS: a lambda whose parameter names match the OUTERMOST level
   positionally is the declared function value (no lift); otherwise, when the
   annotation's result is itself a signature, the lambda is the outer lift's
   BODY (lift around it; the declared-type check validates it against the
   inner signature). The `parameter-name-mismatch` diagnostic therefore only
   fires under a NON-nested annotation, where no body reading exists.
4. **Serializer — RULED: keep emission on the mapsto side.** The serializer
   continues to emit typed parameters on the lambda
   (`(x: integer) |-> body`), never a named annotation + bare body. Since
   both-sides-with-matching-names is legal, existing emission stays valid; it
   must simply never emit mismatched names (it can't — one source).

## Semantics

- **The lift is a parse-time desugar in the Epsil parser**, not an engine
  value-coercion. When a `let`/`const` initializer's declared type is a
  literal function type with named parameters and the RHS is not a mapsto
  (`|->`) literal, the parser wraps the RHS as a `Function` with binders
  synthesized from the annotation names and the return type ascribed
  (existing typed-function-literal machinery handles the rest). Parser-side
  placement gets three things for free:
  - **Shadowing**: binders shadow enclosing bindings in the RHS (with
    `let x = 3` in scope, the lifted `x` still refers to the parameter),
    identical to the math-def head form — because the wrap happens before the
    initializer is ever evaluated in the enclosing scope.
  - **Alias opacity is structurally enforced**: the parser cannot resolve
    aliases, so only on-the-page literal types can lift.
  - Raw-MathJSON routes are unaffected — this is Epsil surface sugar.
- **The rule is syntactic, so a higher-order RHS must use an unnamed
  annotation.** `const f : (x: number) -> number = g(2)` (where `g(2)`
  returns a function) lifts to `(x) |-> g(2)` and then fails the type check;
  the correct spelling is `const f : (number) -> number = g(2)`. Teachable
  form of the rule: *names in the annotation mean the RHS is a pointwise
  body; no names mean the RHS is a function value.* The error message for a
  lifted body whose type is itself a function should include a fix-it to drop
  the annotation names.
- **All-or-nothing naming** for the lift, mirroring the tuple-element rule:
  a partially named literal signature does not lift. **[impl]** Implemented
  as silently inert (no diagnostic), like the other non-lifting shapes.
- **Zero-parameter case — RULED OUT [impl]** (was PROPOSED as a thunk lift):
  `() -> number` has no unnamed/named distinction, so lifting would make a
  thunk-VALUED initializer (`const f : () -> number = makeCounter()`)
  inexpressible. There is nothing to bind; no lift.
- **Optional/variadic parameters**: no lift when the literal signature has
  optional (`?`) or variadic parameters — binders for those cannot be
  synthesized meaningfully. RHS must be an explicit lambda. **[impl]** Also
  inert: generic (`forall`/`typeParams`) and effectful signatures, for the
  same reason (the lift cannot faithfully re-state those adjuncts on the
  synthesized literal).
- **[impl] Not implemented from the behavior table**: the improved error
  message for `const f : (number) -> number = x^2 + 1` (unnamed annotation +
  bare expression). At parse time that shape is indistinguishable from a
  perfectly legal function-VALUED initializer (`= g(2)`), so the parser
  cannot warn; the message would have to come from the engine's declared-type
  check, which is out of this change's scope. The runtime `incompatible-type`
  error is unchanged.

## Companion diagnostics (separate track, same feedback)

- `->`-for-`|->` typo: a `->` in expression (non-brace) position whose LHS is
  a parenthesized/typed parameter tuple, or whose key is not a string, should
  produce "did you mean `|->`?" with a fix-it (today it silently builds a
  `KeyValuePair` and surfaces `incompatible-type string/number` from the key
  check, or `unexpected-symbol ":"`).
- A TS-style return annotation `(x:number):number -> …` stays rejected: `:`
  deliberately has no infix parselet in expression position, and `-> type`
  is the established return-type spelling.

## Implementation notes

- Seam: Epsil parser, `let`/`const` initializer handling (the declared type
  is currently carried as a held type string — e.g.
  `["Declare", "f", "'(x:number) -> number'", {dict: {value: …}}]`); the
  desugar needs the parsed form of that literal type, which the parser
  already produces for annotation validation.
- Name-match check (ruling 2) also lives in the parser: literal named
  annotation + mapsto RHS → compare positional names; emit mismatch error +
  fix-it.
- Serializer: no change (ruling 4); add a round-trip test covering a lifted
  declaration (must re-parse via the mapsto-side emission).
- Tests must cover both routes per the lazy-operator route-parity convention,
  plus: shadowing (`let x = 3` before a lifted decl), alias opacity, nested
  arrow outermost-only, mismatch fix-it, higher-order-RHS error, zero-param
  thunk, optional/variadic refusal.
