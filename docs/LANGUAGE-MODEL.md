# Epsil and Expression Language Model

**Status:** normative internal reference for implemented language lowering.

The parser is a surface-to-MathJSON lowering layer. It does not own a parallel
runtime semantics: Epsil/Cortex constructs lower to engine operators, and the
engine operators remain the semantic source of truth.

## Functions and arguments

Typed function literals encode parameter and return annotations in the
`Function` node. Parameter names written in a function type are descriptive;
when declaration syntax uses such an annotation as a binder, the parser
explicitly lambda-lifts those names and checks that they match the body.

Generic definitions use `<...>` or a trailing `where` clause as documented;
one declaration cannot introduce the same variables at both sites.

Named call arguments lower to a normalized positional call after the callee's
parameter names are known. Unknown or ambiguous parameter names are errors;
overload resolution cannot discard names before the mapping is complete.

## Pattern matching

Surface `match` lowers to `Match` and ordered `MatchCase` nodes. Matching is
total and first-match. Literal, type, tuple/record, constructor, wildcard, pin,
and binding patterns all use the engine classification ladder. Alternatives
must bind the same names. A pattern-bound name is scoped to its case body.

Type patterns lower to `MatchesType`, so first-class types and match do not
diverge. Error values propagate through ordinary applications but `match` is a
sanctioned recovery boundary that can inspect an error explicitly.

## Conditional and error values

`When(value, condition)` represents one conditional value. `Which`/`If`
select among alternatives and are lazy in unselected arms. Arithmetic may
thread `When` values while preserving their guards. Producers such as `Solve`
may return guarded results rather than asserting a formula outside its domain.

Error values propagate through ordinary function application and the pipe.
Control-flow heads and explicit pattern matching may consume them. Host throws
are reserved for API misuse, cancellation, or compiled runtime failures where
the target cannot represent the boxed error value.

The full error model — the `Error`/`NaN`/`Missing`/inert channel taxonomy,
the decision procedure for wrong input, propagation rules, and what a
signature's result type does and does not promise — is in
`docs/ERROR-MODEL.md`.

## Ellipsis and interpretation

Surface ellipsis that denotes a mathematical continuation lowers to the
explicit `Interpret` operator. It is not inferred from arbitrary punctuation
after parsing. Unimplemented interpretations remain inert instead of guessing
a sequence rule.

## Equality surfaces

- `Same` / `===` is structural and never follows a symbol value.
- `Equal` / `==` is cheap arithmetic equality and stays inert when undecided.
- `IdenticallyEqual` is the free-variable prover and is three-valued.

The surface operator, API method, and serialized MathJSON share the same tier;
there is no hidden stronger method behind a weaker operator.

## Open language work

Only approved and active implementation work belongs under `plans/`. Broader
Epsil language and tooling work belongs in `epsil/ROADMAP.md`; cross-cutting
engine work belongs in `ROADMAP.md`, not in completed execution plans.
