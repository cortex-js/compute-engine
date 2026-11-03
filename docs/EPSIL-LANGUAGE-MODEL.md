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

A parameter with a default value (`k: number = 2`, `k = 2`) lowers to the
`Function` operand `["Optional", param, default]`, where `param` is the
symbol or the `Typed` annotation. Every parameter list accepts the spelling:
`function f(x: number, k: number = 2) -> number { … }`, `f(x, k = 2) = …`,
`hold f(e, k = 2) = …`, and the anonymous `(x, k = 2) => …` and
`(x, k: number = 2) => …`. In the anonymous form the group is parsed as an
expression before the arrow is seen, so an untyped `k = 2` arrives as
`Equal` and is read back as a default only when its operator token is `=`
(not `==`). The default is one of: a number literal with an optional sign, a
string without interpolation, `true`, `false`, a symbol, `[]` (lowered to
`["List"]`) or `{}` (lowered to `["Dictionary"]`; `{->}` is accepted too).
The parser refuses, with `default-value-invalid`, any other expression, a
default that names a parameter of the same list, `Nothing`, `Missing`, a
default on a `bind` parameter, and a default in a parameter list that has a
literal parameter (a clause of a multi-clause function). Parameters with a
default come after the required ones; the engine checks the order, the
type of the default, and the rules of the
[default-values design](plans/2026-10-31-parameter-default-values.md). The
engine completes a call at canonicalization, so `f(3)` and `f(3, 2)` are one
expression.

Limits of v1: a multi-clause function cannot have a default in any clause
(the engine refuses the second clause, "a default value in an overloaded
signature is not supported yet"), and a protocol requirement cannot have one
(`engine-protocols.ts` refuses an optional member with
`invalid-protocol-declaration`). When a definition has an effect specifier
or a type-parameter clause, its signature marker lists a defaulted parameter
with its type only (`k: number`): the type language admits a default only in
a top-level signature, and the `Optional` operand carries the default.

The formatter and `serializeEpsil()` print a default back after the
parameter (`k: number = 2`, `xs = []`, `d = {}`); `{}` in that position is
the empty dictionary.

Named call arguments lower to a normalized positional call after the callee's
parameter names are known. Unknown or ambiguous parameter names are errors;
overload resolution cannot discard names before the mapping is complete.

## Pattern matching

Surface `match` lowers to `Match` and ordered `MatchCase` nodes. Surface
`if let pattern = subject { … } else { … }` lowers to a two-case `Match` whose
final case is the wildcard (its body is `Missing` when there is no `else`); it
has no head of its own, and the serializer spells that shape back as `if let`.
Surface `while let pattern = subject { … }` is the loop form of the same shape:
it lowers to `Loop(Match(subject, MatchCase(pattern, body), MatchCase(_,
Break())))`, and the serializer spells that shape back as `while let`.
Matching is total and first-match. Literal, type, tuple/record, constructor, wildcard, pin,
and binding patterns all use the engine classification ladder. Alternatives
must bind the same names. A pattern-bound name is scoped to its case body.

Type patterns lower to `MatchesType`, so first-class types and match do not
diverge. Error values propagate through ordinary applications but `match` is a
sanctioned recovery boundary that can inspect an error explicitly.

## Conditional and error values

`When(value, condition)` represents one conditional value. `Which`/`If`
select among alternatives and are lazy in unselected arms. The LaTeX parser
reads a restriction `e\{c\}` and a `where` condition as the single-branch
`If(c, e)`, which has the value of `When(e, c)`, and the type of `e`.
Arithmetic may
thread `When` values while preserving their guards. Producers such as `Solve`
may return guarded results rather than asserting a formula outside its domain.

Error values propagate through ordinary function application and the pipe.
Control-flow heads and explicit pattern matching may consume them. A program
constructs one with `RuntimeError(code)`, a valid application typed `never`
that evaluates to `Error(code)`; a written `Error(…)` is a static diagnostic
node and invalidates the expression around it. Host throws
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
