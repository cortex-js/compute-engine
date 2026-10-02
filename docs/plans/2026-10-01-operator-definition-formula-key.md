# A formula key on an operator definition, unfolded by `D`, `Expand` and others

Status: DESIGN, not decided. No code. Written 2026-10-01 for GitHub issue
cortex-js/compute-engine#393, item 5. The decisions that are necessary before
work starts are in section 8.

## 1. The problem

An operator definition can say what its operator computes in two ways today,
and each way loses something.

**A function literal as the `evaluate` value.** The engine unfolds it at every
evaluation, so the application never keeps its own form:

```js
ce.declare('Sl', {
  signature: '(number) -> number',
  evaluate: ce.expr(['Function', ['Power', 'x', 2], 'x']),
});
ce.box(['Sl', 'y']).evaluate(); // y^2: the head Sl is gone
```

**An `evaluate` handler that answers only for numbers.** The application keeps
its form, but the definition is code. No symbolic consumer can see what the
operator is:

```js
ce.declare('Sq', {
  signature: '(number) -> number',
  evaluate: ([x]) => (isNumber(x) ? x.mul(x) : undefined),
});
```

Measured on 2026-10-01 (source tree at commit f39fd4a4 plus the `derivative`
key of #393 item 4), for the two definitions above:

| Input                              | `Sl` (literal)          | `Sq` (handler)                  |
| ---------------------------------- | ----------------------- | ------------------------------- |
| `Sq(y).evaluate()`                 | `y^2`                   | `Sq(y)`                         |
| `D(Sq(x), x)`                      | `2x`                    | `Apply(Derivative("Sq", 1), x)` |
| `Expand(Sq(x + 1))`                | `x^2 + 2x + 1`          | `Sq(x + 1)`                     |
| `Integrate(Sq(x), x)`              | `1/3 * x^3`             | `int(Sq(x) dx)`                 |
| `Integrate(Sq(x), x, 0, 1).N()`    | `0.3333…` (quadrature)  | `0.334 ± 0.003` (Monte Carlo)   |
| compile `Sq(x + 1)` to JavaScript  | succeeds                | fails: no lowering for `Sq`     |
| `Sq(2).N()`                        | `4`                     | `4`                             |

The `derivative` key (issue #393 item 4, implemented separately) fixes the `D`
row for the handler form when the author also writes the derivative. It does
not fix the other rows.

The issue asks for a third way: a key whose value is an expression that says
what the operator is, that `D`, `Expand` and other symbolic consumers can
unfold, and that `evaluate` does NOT use to replace the application.

## 2. The proposal

A new key on an operator definition. This document calls it `formula`; section
7 discusses the name, and the issue calls it `definition`.

```js
ce.declare('Sq', {
  signature: '(number) -> number',
  evaluate: ([x]) => (isNumber(x) ? x.mul(x) : undefined),
  formula: ['Function', ['Power', 'x', 2], 'x'],
});
```

The value is a function literal (MathJSON or an expression) with one parameter
for each argument. The meaning is: for all arguments `a₁, …, aₙ` in the domain
of the signature, `Sq(a₁, …, aₙ)` equals the body of the literal with each
parameter replaced by the matching argument. The engine does not check this
statement. It is a promise the author makes, in the same way as a declared
result type (see "A declared result type is a promise the host makes" in
`CLAUDE.md`).

Proposed results with the definition above:

| Input                           | Today                           | Proposed                  |
| ------------------------------- | ------------------------------- | ------------------------- |
| `Sq(y).evaluate()`              | `Sq(y)`                         | `Sq(y)` (no change)       |
| `D(Sq(x), x)`                   | `Apply(Derivative("Sq", 1), x)` | `2x`                      |
| `Expand(Sq(x + 1))`             | `Sq(x + 1)`                     | `x^2 + 2x + 1`            |
| `Integrate(Sq(x), x)`           | `int(Sq(x) dx)`                 | `1/3 * x^3`               |
| `Integrate(Sq(x), x, 0, 1).N()` | Monte Carlo estimate            | quadrature, `0.3333…`     |
| compile `Sq(x + 1)`             | fails                           | succeeds, from the formula|
| `Sq(2).N()`                     | `4` (handler)                   | `4` (handler, no change)  |
| `Sq(y).simplify()`              | `Sq(y)`                         | `Sq(y)` (no change)       |

## 3. How each consumer uses the formula

The general rule: a consumer that is an explicit request to rewrite the
expression symbolically may unfold. A consumer whose job is to give a value,
or to make the expression shorter, does not.

### 3.1 `D`, `Derivative`, prime notation — unfold

`differentiate()` (`symbolic/derivative.ts`) reaches an application of a
non-library operator in `differentiateUnknownApplication()`. The order of the
rules there would be:

1. the `derivative` key, when present;
2. the formula: replace the parameters by the arguments in the body, then
   differentiate the result;
3. a function-literal `evaluate` (the existing `isUserFunction()` route);
4. the symbolic chain rule with `Apply(Derivative(F, …), …)`.

The `derivative` key comes first because it is the more specific statement:
an author who writes both wants the derivative in a stated form (for example
`Sq'(x) = 2x`, and not the derivative of a long formula). The result of rule 2
is in terms of the unfolded body: `D(Sq(sin x), x)` is `2 sin(x) cos(x)`, not
`Sq'(sin x)·cos x`. That is the same result the function-literal route gives
today.

A library operator keeps its derivative table entry. A user operator that
shadows a library name uses its own keys (`shadowsLibraryName()`).

### 3.2 `Expand` — unfold

`Expand` is an explicit request to write an expression in a longer, open
form, so it may unfold one level of each defined operator, then expand the
result. `Expand(Sq(x + 1))` gives `x^2 + 2x + 1`.

One question is open (section 8, question 3): does `Expand(Sq(y))`, where
unfolding is the only change, give `y^2`? Unfolding only when it lets the
expansion change something else is possible, but harder to explain.

### 3.3 `simplify` — do not unfold

`simplify()` keeps the form of the expression unless a rewrite makes it
shorter, and keeping the head is the purpose of the key. Unfolding in
`simplify` also causes two risks: a rule that unfolds and a rule that folds
back can alternate without end, and the cost function would usually reject an
unfolded form anyway. So `simplify` does not unfold.

A later, separate option: unfold, simplify, and keep the unfolded result only
when it is strictly shorter (for example `Sq(x) - x^2` → `0`). This needs a
recursion guard (section 5) and is not part of the first version.

### 3.4 Compilation — use the formula when there is no other lowering

The order for an application of a user operator would be:

1. a `compile` handler on the definition;
2. a lowering that the target has for the operator name;
3. the formula, compiled as a function of its parameters, with the same
   lowering that a function-literal `evaluate` gets today (a named function
   `_fn_Sq` and a call to it, not an inline copy at each call site);
4. failure, as today.

Compiling a call to a named function, and not an inline copy, is what keeps a
recursive formula from expanding without end (section 5).

The formula and the `evaluate` handler can give slightly different floats for
the same input (for example a handler that uses a special algorithm). That is
acceptable: the compiled code already uses its own algorithms for library
functions.

### 3.5 Integration — unfold when nothing else applies

`antiderivative()` (`symbolic/antiderivative.ts`) would unfold an application
of a defined operator when no rule applies to it as it is, and integrate the
result. The integrand must be lifted first (`liftIntegrand()`,
`boxed-expression/utils.ts`), as for every route to the integration provider.

For a definite integral under `.N()`, the formula makes the integrand
compilable (section 3.4), so the quadrature route applies instead of the Monte
Carlo estimate.

### 3.6 `evaluate` and `N` — do not unfold

The `evaluate` handler is the authority for values. `evaluate` never unfolds
the formula; that is the difference from a function-literal `evaluate`.

`N` is the one open case (section 8, question 4). When a definition has a
formula and NO `evaluate` handler, or the handler declines (returns
`undefined`) for a numeric argument under `.N()`, `N` could unfold the formula
and approximate the result. Example: a definition with only a formula, and
`Sq(2).N()`. Without unfolding the result is `Sq(2)`; with unfolding it is
`4`. Unfolding only under `.N()` keeps the exactness contract of `evaluate()`
(see "Evaluate vs. N: the exactness contract" in `CLAUDE.md`), since `.N()`
returns a float anyway.

### 3.7 Others, later

Series, limits, `Solve` and the identity prover (`.isIdenticallyEqual()`) can
also use the formula. They are not part of the first version. The prover
already works without it when the `evaluate` handler answers numbers, because
it samples numerically.

## 4. Interaction with the other keys

- **`evaluate`.** The handler gives values; the formula gives structure. The
  engine does not check that they agree. A test helper that compares them at
  sample points can be offered to authors, but is not necessary.
- **`evaluate` given as a function literal plus a `formula`.** The literal
  already unfolds at evaluation, so the formula adds nothing. Either refuse
  this combination with an error in the definition, or accept it and ignore
  the formula. Recommendation: refuse it, since one of the two is a mistake.
- **`derivative`.** Has precedence for `D` (section 3.1). The engine does not
  check that the derivative key agrees with the derivative of the formula.
- **`signature`.** When a definition has a formula and no signature, the
  signature could be inferred from the formula, as it is from a function
  literal today. Recommendation: do it, with the same code.
- **`compile`.** Has precedence for compilation (section 3.4).

## 5. Recursion and loops

1. **A recursive formula.** `Fact` with the formula
   `n ↦ If(n ≤ 1, 1, n·Fact(n − 1))`. Unfolding it in `D` or `Expand` without
   a limit does not end: each unfolding creates a new `Fact(…)`. `differentiate()`
   stops at `MAX_DIFFERENTIATION_DEPTH` (100) or at its node budget, but only
   after much work, and then returns nothing. Rule: a consumer unfolds an
   operator only when that operator is not already being unfolded by the same
   consumer call. A set of the operator names being unfolded, kept for the
   duration of one top-level `D`, `Expand` or `Integrate` call, implements it
   and also covers mutual recursion (`F` uses `G`, `G` uses `F`).
2. **`simplify` inside an unfolding.** An unfolding must not call `.simplify()`
   on its result: `D` and `Expand` are called from simplification rules, and a
   nested `.simplify()` starts a new simplification with its own loop guards,
   which can recurse without end (see "Simplification and Recursion
   Prevention" in `CLAUDE.md`). The unfolded result is returned canonical,
   not simplified.
3. **Fold and unfold rules.** If a later version adds a rule that folds
   `x^2` back to `Sq(x)`, it must never run in the same pass as an unfolding.
   This is why `simplify` does not unfold (section 3.3).
4. **Caches.** The derivative cache (`derivativeChains` in
   `symbolic/derivative.ts`) is keyed by the engine cache generation, which a
   change of definition advances. A formula stored on the definition record
   must be journaled with the other fields (`_checkpointSnapshot()` in
   `boxed-operator-definition.ts`), as the `derivative` key is.
5. **Scope of the literal.** The formula is boxed in the scope where the
   definition is made. A library loaded at construction has no user scope
   yet, so the literal should be boxed lazily, on first use, as the array
   form of the `derivative` key is today (`partialFromFunctionLiteral()`).

## 6. The value of the key

Two forms, the same as the `derivative` key:

- A function literal, as MathJSON or an expression, with one parameter for
  each argument. This is the common case and it can be serialized.
- A handler `(ops, { engine }) => Expression | undefined` that returns the
  unfolded form of `F(ops)`, or `undefined` when it has none. It is necessary
  for an operator with a variable number of arguments (for example
  `Norm(x₁, …, xₙ) = √(Σ xᵢ²)`).

## 7. Name

| Name         | For                                       | Against                                                                                                          |
| ------------ | ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `definition` | The word the issue uses                   | The whole record is already an "operator definition" (`OperatorDefinition`, `ce.lookupDefinition()`): `def.definition` is confusing |
| `formula`    | Says what the value is; no collision      | Less familiar in other systems                                                                                   |
| `body`       | Short                                     | Suggests the value replaces the operator at evaluation, as a function body does                                  |
| `unfold`     | Says what consumers do with it            | A verb, not a value                                                                                              |
| `identity`   | Says it is an equation that always holds  | Collides with "identity function" and `IdenticallyEqual`                                                         |

Recommendation: `formula`.

## 8. Questions for the user

1. **Add the key?** If yes, the first version is sections 3.1, 3.2, 3.4 and
   3.5, with the recursion guard of section 5. If no, the workaround stays:
   the author writes a `derivative` key for `D`, and `Expand`, compilation and
   integration see an opaque operator (the table in section 1).
2. **Name.** `formula` (recommended) or `definition` (the issue's word). Other
   names are in section 7.
3. **`Expand` of a bare application.** With `Sq` as in section 2,
   `Expand(Sq(y))`:
   - (a) gives `y^2` — `Expand` always unfolds one level (recommended: simple
     to explain, and `Expand` is an explicit request for the open form);
   - (b) gives `Sq(y)` — `Expand` unfolds only when the unfolded form then
     expands further. Harder to explain, and the result depends on the
     arguments.
4. **`N` when the handler declines or is absent.** With a definition that has
   a formula and no `evaluate` handler, `Sq(2).N()`:
   - (a) gives `4` — `N` unfolds when there is no handler or the handler
     declines (recommended: `.N()` promises a number when one can be
     computed);
   - (b) gives `Sq(2)` — the formula is for symbolic consumers only. Then an
     author who wants numbers must also write a handler.
5. **A function-literal `evaluate` together with a formula.** (a) refuse with
   an error (recommended), or (b) accept and ignore the formula.

If nothing is decided, nothing changes: the key is refused as an unexpected
key, and the behavior in the "Today" columns of sections 1 and 2 stays.

## 9. Recommendation

Add the key under the name `formula`, with the two value forms of section 6.
Use it in `D` (after the `derivative` key), `Expand`, compilation (after a
`compile` handler and a target lowering) and integration. Do not use it in
`evaluate` or `simplify`. Guard every unfolding with the set of operators
being unfolded (section 5, item 1), and never call `.simplify()` on an
unfolded result. Decide questions 3 to 5 as recommended above.
