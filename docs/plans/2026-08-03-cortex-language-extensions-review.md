# Cortex language extensions review

Status: **exploratory discussion note — proposals are not approved roadmap
items**

Date: 2026-08-03

Reviewed against the repository implementation and public Cortex docs on
2026-08-03. Statements about current behavior below describe that snapshot;
candidate syntax is illustrative until a dedicated design rules its grammar,
lowering, typing, diagnostics, and serialization.

Related:

- [`src/cortex/docs/`](../../src/cortex/docs/) — current public language definition
- [`roadmap/cortex/README.md`](../../roadmap/cortex/README.md) — current Cortex backlog
- [`roadmap/cortex/language-review.md`](../../roadmap/cortex/language-review.md) — the earlier 2026-07-05 review
- [`docs/EFFECTS-MODEL.md`](../EFFECTS-MODEL.md) — function effects
- [`docs/plans/2026-08-01-type-variables-design.md`](2026-08-01-type-variables-design.md) — parametric polymorphism

## Prioritized backlog (added 2026-08-05)

Ordered by **implementation cost**, cheapest first — a complement to
[Tentative sequencing](#tentative-sequencing) at the end of this note, which
orders the same material by theme and dependency. Neither list is approval;
this note remains exploratory.

Every status claim below was re-verified against the implementation on
2026-08-05, two days after the note was written. Several items had already
landed, and one had landed only partially — see tier 0.

### Tier 0 — already landed; do not schedule

- **Transparent generic type aliases** (third-tier item 2).
  `type alias Pair<T> = tuple<T, T>` parses clean.
- **Generic function definitions** (third-tier item 3, v1).
  `function g<T>(x: T) -> T { x }` parses clean.
- **The documentation drift repair**, as recorded in
  [the section on it](#the-public-definition-had-drifted-behind-the-implementation--repaired).
- **The reserved-word relaxation — but only partially.** A binding name in
  `let`, `const` or `function` now rejects just the five literal words
  (`true`, `false`, `NaN`, `Infinity`, `oo`); the other 82 words in
  `RESERVED_WORDS` are usable as identifiers. Three positions were missed —
  see tier 1 item 1.

### Tier 1 — easy wins

1. **Finish the reserved-word relaxation.**
   ([section](#too-many-hypothetical-keywords-are-reserved)) The policy and its
   precedent (`LITERAL_WORDS`) already exist; three positions still reject all
   82 words — a bare assignment target (`with = 5`), a mapsto parameter
   (`set |-> set`), and a call's callee (`label(6)`). The inconsistency is
   already user-visible: `label(6)` is an error today while `label(6) = 1` is
   accepted. Localized parser change; acceptance is the same five-word
   rejection set in every position.

2. **`break` and `continue`.** ([section](#break-and-continue)) Pure surface
   syntax over a protocol that already works: `Loop(Block(If(k > 2, Break),
   …))` over `1..5` evaluates to `3` today, and Cortex's own `while` lowering
   already emits `["Break"]`. Needs statement-position parsing, a "not inside a
   loop" diagnostic, and round-trip coverage — no engine work.

3. **Make `assign-in-argument` an error with a `==` fix-it.**
   ([section](#assignment-can-look-like-an-equation)) The diagnostic fires
   today (as a warning) and the fix-it machinery is in place, so this is a
   severity flip plus a fix-it string. Scope it to *that* change: the broader
   "restrict assignment to a statement-position binding target" half is a
   separate, larger item — chained `a = b = 5` still parses clean.

4. **An `is` type-test operator (`x is integer`).**
   ([section](#1-flow-sensitive-narrowing-and-exhaustiveness)) The smallest new
   surface form in the note: one infix operator over the existing dynamic type
   test. Independently useful, and the stated prerequisite for flow-sensitive
   narrowing.

5. **`??` for `Coalesce`.** ([section](#absence-coalescing-)) One infix
   operator over an operator that already exists and is already lazy —
   `Coalesce` is declared `lazy: true` and short-circuits (`Coalesce(1, 1/0)`
   → `1`, no division). Before starting, establish what "the `Coalesce`
   lazy-tail fix" in the sequencing section refers to; the tail behavior looks
   correct now, so that precondition may be stale.

### Tier 2 — moderate, mostly self-contained

6. **Known-operator tokenization.**
   ([section](#operator-runs-are-tokenized-too-coarsely)) Still broken:
   `3!^2` → `unexpected-symbol "!^"`, `0..-1` → `unexpected-symbol "..-"`.
   One lexer change, but the rule is whole-run validation rather than
   longest-known-prefix, and it needs a recovery-diagnostic design. Acceptance
   cases are already enumerated in the section.

7. **Enforce return contracts.**
   ([section](#return-annotations-are-not-contracts)) Confirmed unenforced:
   `function f() -> integer { "oops" }` returns `"oops"`. The result matrix is
   fully specified, so the design work is done — the cost is breadth, since
   direct calls, `Apply`, pipes, recursion and every compile target must agree,
   and tests must prove an existing error's code and trace survive unchanged.

8. **`otherwise` fallback, and `otherwise =>` as a `match` catch-all.**
   ([section](#error-fallback-and-propagation-otherwise)) Two related surface
   forms sharing one ruling on direct-error semantics; do them together.

9. **`if let`.** ([section](#refutable-binding-if-let)) Blocked on
   first-tier item 7 — resolving full type expressions in typed patterns —
   which is independently useful and should be scheduled first.

### Tier 3 — needs a design ruling or a prerequisite landing first

10. **Comprehensions** — one syntax, once eager/lazy, filter lowering, and
    collection-kind questions are settled ([section](#comprehensions)).
11. **Flow-sensitive narrowing and exhaustiveness** — needs statement
    environments and joins in the checker, plus the `is` operator
    ([section](#1-flow-sensitive-narrowing-and-exhaustiveness)).
12. **The static-diagnostic / error-value boundary rule** — a checker
    semantics question, not a syntax one
    ([section](#static-diagnostics-and-errors-as-values-need-a-boundary-rule)).
13. **Pipe first-argument shorthand or UFCS** — five options, none ruled
    ([section](#ufcs-and-the-pipe-operator)).
14. **Immutable update expressions** and a possible `with` form
    ([section](#immutable-update-expressions)).
15. **The remaining type-system gaps** — dimension and shape variables,
    physical-dimension types, record optionality and exactness, limited type
    projections, typed fallibility ([section](#remaining-type-system-gaps)).
16. **Large domain features** — symbolic rewrite blocks, unit literals,
    modules, deterministic parallelism, coroutines. Each is its own design
    note, and the note already recommends deferring most of them until demand
    is demonstrated.

## Purpose

Review Cortex as it exists now and record possible extensions that would
improve expressiveness, safety, or ergonomics. This note deliberately
separates:

1. inconsistencies or footguns in the language as currently defined;
2. relatively direct extensions that lower to existing engine concepts; and
3. larger design directions that need more exploration.

The discussion assumes Cortex remains primarily an exact, symbolic scientific
language for notebooks and small programs whose IR is MathJSON. It does not
assume that Cortex should grow every facility of a general-purpose systems
language.

## Summary assessment

Cortex already has a substantial and coherent core:

- exact and symbolic evaluation by default;
- expression-valued `if`, `match`, and `do` blocks;
- lexical closures and first-class functions;
- multi-clause function definitions with literal/type dispatch;
- structural patterns, guards, pins, and destructuring;
- immutable collections, lazy collection operators, and pipelines;
- nominal types, aliases, field access, and typed parameters;
- function effect annotations;
- runtime errors as values and parse/static problems as diagnostics; and
- parser recovery, source ranges, fix-its, a formatter, and `cortex check`.

The central weakness is no longer a lack of basic constructs. It is the set of
seams where the language surface, the type/effect model, and the engine do not
yet tell one simple story. Some mistakes produce plausible values (`NaN`, `[]`,
or an accepted value violating a declared return type), while several common
operations require verbose library composition.

For each accepted extension, completion should mean more than accepting the
new spelling. It should include:

- one documented parse/lowering shape in MathJSON;
- parse/serialize round-trip coverage, including precedence and parentheses;
- static type and effect behavior on direct, piped, and compiled routes;
- diagnostics and fix-its for the nearest likely mistakes; and
- executable public examples plus CLI `check`/`run` coverage.

This is especially important for contextual syntax: resolution must not depend
on evaluating a value, mutating scope, or testing runtime field existence. A
stable declared signature may participate in ordinary overload resolution, but
the parsed structure should not depend on which definitions happen to be
installed.

## Current-definition issues

These should generally be addressed before adding much syntax.

### Return annotations are not contracts

Today the annotation is retained in the installed function signature, but the
result is not checked at the call boundary. This succeeds and returns
`"oops"` with no diagnostic:

```cortex
function f() -> integer { "oops" }
f()
```

Parameter annotations are enforced. A visible `-> integer` should likewise be
a checked contract, applied after the body has evaluated and before returning
to the caller, with this result matrix:

- **`Error` result — exempt.** An `Error` value bypasses the contract and
  propagates unchanged. Errors are an implicit possible result of every
  evaluation: error is an absorbing element under strict evaluation, the type
  lattice deliberately keeps `error` incomparable to ordinary types, and the
  effects model rejected tracking partiality in signatures. Replacing a
  propagating error with `incompatible-type` would destroy the original error
  and its trace. The contract constrains successful results only.
- **Definitely compatible** — return the result.
- **Definitely incompatible, non-error** — produce an `incompatible-type`
  error value with the call in its trace.
- **Symbolically undecidable** (the result still carries free variables or an
  unresolved type) — pass it through unchecked. There is no persistent
  deferred obligation or ascription node in the first version; this is a
  boundary check on what is decidable at return time.
- **`Nothing`, `Missing`, `NaN`** — ordinary values, checked against the
  declared type like any other result (`NaN` inhabits the number types;
  `-> integer` does not admit `Nothing` unless declared `integer | nothing`).

Direct calls, `Apply`, pipes, recursive calls, and compiled targets must
agree, and acceptance tests must prove an existing error's code and trace
survive the boundary unchanged.

### Assignment can look like an equation

The canonical trap is:

```cortex
Solve(x^2 = 4, x)
```

It can return a plausible wrong answer because `=` is `Assign`, not `Equal`.
The existing `assign-in-argument` warning should become an error with a `==`
fix-it. More generally, assignment should be restricted to a bare binding
target in statement position. Statement position means a direct statement of
the program or of a `{ ... }` block body — nothing else. In particular a
parenthesized assignment is an expression and is rejected, so
`Solve((x = 4), x)` does not reopen the trap, and chained assignment
(`a = b = 5`) is rejected because its right-hand side is itself an assignment
expression. Function definitions remain their own parsed form.

This preserves Cortex's established `=` spelling without allowing it in the
positions where it is overwhelmingly likely to be a mistaken equation.

### Operator runs are tokenized too coarsely

`3!^2` currently lexes `!^` as one unknown token; negative range bounds have a
similar spacing trap. The lexer should longest-match a *known* operator at each
position instead of consuming an arbitrary run of operator characters. Then
these spellings become natural:

```cortex
3!^2
0..-1
```

Known compound operators such as `!=`, `!in`, `|>`, and `|->` still win by
longest match. Longest-matching a known prefix is not sufficient by itself: an
unsupported run with a known prefix (`|>>` starting with `|>`) would still lex
as a misleading sequence of valid operators. The rule should therefore
validate the entire maximal punctuation run: split it greedily into known
operators only when every resulting token is known and the adjacency is
grammatically legal at that position (a postfix operator followed by an infix
or prefix operator, as in `3!^2`); otherwise issue one diagnostic covering the
whole run. Acceptance cases: `3!^2`, `0..-1`, an unsupported run with a known
prefix, and the diagnostic count and source range on recovery.

### Too many hypothetical keywords are reserved

Names such as `set`, `get`, `with`, `where`, `to`, and `each` are unavailable
even though their proposed constructs do not exist. Future words should be
contextual wherever possible, following the precedent of `type` and `alias`.
Keep hard reservation for active keywords, literals, and only the few future
forms whose grammar genuinely cannot be contextual.

### The public definition had drifted behind the implementation — repaired

The 2026-08-03 documentation repair brought these items back into sync:

- effect specifiers (`function roll(n) random -> integer`) are now covered by
  the public syntax, types, and control-flow references;
- the formal parameter grammar now includes literal parameters;
- the agent, Python, and Mathematica guides now agree with the syntax/types
  docs that identifier-shaped dictionary keys support `d.key`;
- the Cortex type reference now explains `Nothing`, `Missing`, `NaN`,
  `IsMissing`, and `Coalesce`; and
- comments in `reserved-words.ts` now identify active declaration, function,
  loop, and membership words correctly.

The executable documentation test covers the public Cortex examples and links.
The broader architectural goal remains one versioned source of truth for the
grammar and implementation tables, so this category of drift is detected
rather than rediscovered manually.

### Static diagnostics and errors-as-values need a boundary rule

Cortex intentionally permits a program to inspect or rescue an `Error` value,
and direct observers such as `IsError("a" + 1)` already suppress the contained
type diagnostic. The suppression does not consistently extend through other
structural rescue boundaries: for example, a `match` can successfully catch an
error subject at runtime while `cortex check` still reports the subject's
definite type error.

The checker should define which constructs dominate a contained error and how
far that protection extends through bindings. It should distinguish an
unhandled definite error from one consumed by `IsError`, an explicit
error-matching case, or a future rescue form. This does not require hiding real
errors; it requires making "errors are values" true in checked programs as well
as at runtime.

## Candidate extensions

### Absence coalescing: `??`

Add an infix spelling for the existing `Coalesce` operation:

```cortex
let timeout = config.timeout ?? 30
let first = xs[1] ?? 0
```

`a ?? b` lowers to `Coalesce(a, b)`. It handles Cortex absence (`Missing` and
`NaN`, regardless of provenance) but does **not** swallow an `Error`. This
makes the important distinction explicit:

- `??` discharges absence;
- `otherwise` (explored below) rescues an error.

The operator should be right-associative by the usual coalescing convention;
canonicalization may flatten `a ?? b ?? c` to the existing variadic
`Coalesce(a, b, c)` — but only after a prerequisite fix to `Coalesce` itself.
The current implementation eagerly evaluates the entire remaining tail the
moment an operand is symbolically undecided, so flattening today would change
observable effect and error timing relative to the nested form. Fix
`Coalesce` first so an undecided operand leaves the tail unevaluated
(`Coalesce(v, …rest)` with `rest` untouched) and choices are genuinely
evaluated lazily from left to right, with acceptance tests using an unresolved
first operand and an effectful or erroring later operand on both the
interpreter and compiled routes. Its
precedence relative to `|>`, `||`, and assignment needs an explicit ruling and
round-trip tests; the examples above do not settle expressions such as
`value |> parse ?? fallback`.

Provably absent literal indices or fields should additionally produce a static
warning even when `??` is present, unless the access is intentionally used as
an absence probe. A design needs an observable rule for that exception rather
than relying on intent: for example, warn for an impossible index into a known
tuple/list literal, but not for a dynamic dictionary lookup immediately
consumed by `??` or `IsMissing`.

### Comprehensions

The engine already has a lazy `Comprehension(body, Element(...), ...)` value,
including multiple and dependent generators. Cortex does not yet have a
surface spelling for it. The initial proposal was a generator expression:

```cortex
for x in xs if p(x) yield f(x)
```

This fits the existing distinction between effectful `for x in xs { ... }`
and value-producing iteration. The generator clauses naturally lower to
`Element` operands of `Comprehension`.

The filter does **not** yet have an equally direct lowering: the current
`Comprehension` implementation accepts only `Element` clauses. Before adopting
trailing `if`, either add an explicit guard clause to `Comprehension` or define
a composition that preserves laziness, binding scope, dependent generators,
effects, and element type. Do not encode filtering by yielding `Nothing`
without first ruling how that interacts with collection erasure and counting.

An alternative worth preferring or combining with it is collection-delimited
comprehension syntax. Braces already mean sets, so a brace comprehension can
unambiguously mean a set comprehension:

```cortex
{f(x) for x in xs if p(x)}
```

After parsing the first expression, the contextual `for` distinguishes this
from an ordinary set literal. Its result should have true set semantics:
deduplicated and unordered. A finite enumerable result is naturally
materialized and deduplicated eagerly; a symbolic or unbounded result may stay
an intensional set, but it is not an ordered generator stream. This is
consistent with collection literals being values.

The engine already recognizes a separate set-builder encoding,
`Set(body, Element(x, domain, condition?))`, and can enumerate a finite
single-generator filtered set. That is a plausible direct lowering for the
brace form. It is not the same primitive as lazy `Comprehension`, and its
current shape does not generalize automatically to multiple generators.

The same grammar raises useful related possibilities:

```cortex
[f(x) for x in xs if p(x)]          // list comprehension
{k -> f(k) for k in keys}           // dictionary comprehension
```

These should not be adopted automatically as one package. Questions to settle:

1. Is only the set form desirable, or should the delimiter select the result
   collection kind?
2. Are bracket/brace comprehensions eager snapshots, leaving `for ... yield`
   as the explicitly lazy generator spelling?
3. Do multiple generators form a Cartesian product?
4. Are filters written as trailing `if` clauses, `where` clauses, or guards?
5. What is the exact order of generator binding, filtering, and evaluation?
6. Are unbounded domains rejected in collection-delimited forms, kept as
   symbolic/intensional values, or allowed to produce lazy collections?
7. How does the chosen surface interact with effectful element bodies? The
   underlying `Comprehension` primitive already has a documented trap: a body
   drawing randomness escapes the enclosing `WithRandomSeed` frame and draws
   live at materialization. The surface form must rule this explicitly rather
   than inherit it silently.

A coherent split would be:

- collection-delimited comprehensions have value semantics for the delimiter's
  collection kind, eagerly materializing finite extensional results; and
- `for ... yield ...` is a lazy generator/comprehension view.

It may be better to ship only one form initially, based on real notebook use.
If only one form ships, the lazy `for ... yield ...` form aligns most directly
with the existing engine primitive; the eager delimiter forms add collection-
kind semantics and should justify that additional surface.

### Refutable binding: `if let`

The explicit typed form remains useful:

```cortex
if let value: !error = parse(text) {
  use(value)
} else {
  fallback
}
```

However, error rescue is common enough that the unannotated form can have a
clear specialized meaning:

```cortex
if let value = parse(text) {
  use(value)
} else {
  fallback
}
```

Proposed semantics:

1. Evaluate the right-hand side exactly once.
2. If the resulting value itself is an `Error`, take the `else` branch and do
   not bind `value`.
3. Otherwise bind `value` in the success block, narrowed to the non-error part
   of the result type.

The unannotated form should not treat `Missing` or `NaN` as an error. Absence
remains the job of `??`/`IsMissing`; broadening `if let` to that second failure
family would erase the distinction this proposal is trying to make. `Nothing`
needs a separate ruling because it is an argument/binding erasure marker rather
than a position-preserving value: it cannot simply enter the success branch as
an ordinary bound value.

This is the error-value analogue of Swift optional binding. It should test the
result value itself, not recursively reject a collection merely because one of
its elements contains an error; collection operators already define their own
error propagation/inspection boundaries.

The annotated form remains the general feature: `if let x: T = expr` succeeds
when the result inhabits `T`. The unannotated form is sugar for the particularly
important `!error` case. Tuple/record patterns could be added once the basic
rule is stable.

This requires full type expressions in typed patterns. The current simple-name
restriction prevents `!error`, unions, and parameterized collection types; the
parser accepts those annotations but diagnoses them as
`type-pattern-unsupported`, and the pattern does not match. That prerequisite
should land independently before `if let` syntax.

### Error fallback and propagation: `otherwise`

Explore `otherwise` as an expression-level error rescue operator, distinct from
absence coalescing:

```cortex
let value = parse(text) otherwise 0
```

This means: evaluate `parse(text)` once; if it yields an `Error`, evaluate and
return `0`; otherwise return the successful value. It can lower to `Match` or a
small existing/new error-observer primitive while preserving lazy fallback
evaluation.

The expression-level interpretation is preferable to making `otherwise` part
of assignment syntax, because it composes everywhere:

```cortex
compute(parse(text) otherwise 0)
let value = (read() otherwise cached()) + 1
```

The proposed shorthand:

```cortex
let value = parse(text) otherwise return
```

needs a separate control-flow ruling. The most useful interpretation is:

- on success, bind/return the unwrapped successful value;
- on error, return the *original error value* from the current function.

That is an early error-propagation operation, not a return of `Nothing`. The
engine already implements the required machinery: `Return` propagates
structurally through `Block` and `Loop` and is unwrapped at the
function-application boundary. What is missing is only Cortex surface syntax
lowering to that protocol, plus a rule for use at top level. Possible
top-level behavior is simply to make the original error the cell's final
value.

Questions to settle:

1. Does `otherwise fallback` rescue only a direct `Error`, or use the broader
   current `IsError` notion of an expression carrying an embedded error?
   Direct-result testing is recommended for consistency with `if let`.
2. Is the original error available to a handler, for example
   `expr otherwise err => recover(err)`?
3. Does `otherwise return` justify adding general `return`, or should Cortex
   expose a narrower error-propagation primitive?
4. How does the static checker represent the success type after rescue?

### `otherwise` as a `match` catch-all

The same word is a natural, more readable spelling for the final catch-all
case of a `match`:

```cortex
match value {
  0 => "zero"
  n: integer if n > 0 => "positive integer"
  otherwise => "something else"
}
```

In pattern position, `otherwise` means the anonymous irrefutable pattern `_`.
It binds no name and should normally be the final case; an earlier
`otherwise` receives the same unreachable-case diagnostic as an earlier `_`.
The serializer can either preserve the authored spelling through source
metadata or choose one canonical form. If source spelling is not preserved,
prefer serializing the catch-all as `otherwise` because it communicates intent
more clearly at the whole-case level.

Keep `_` as the general wildcard, especially inside structural patterns where
`otherwise` would read poorly or ambiguously:

```cortex
match pair {
  (0, _) => "first is zero"
  otherwise => "other pair"
}
```

The two uses of `otherwise` are contextual and do not conflict:

- after an expression, `expr otherwise fallback` is error rescue;
- at the start of a `match` case pattern, `otherwise => body` is catch-all.

In both roles `otherwise` remains a contextual word, consistent with the
reservation principle stated earlier: it is not added to the reserved-word
list, it is recognized only in these two structural positions, and its use as
an ordinary identifier elsewhere remains legal.

An alternative postfix layout—`match value { cases } otherwise body`—is not
recommended. It competes visually and grammatically with the expression-level
error-rescue operator and makes the catch-all less obviously part of the
ordered case list.

### `break` and `continue`

Implement the conventional loop-local forms, lowering to the engine's existing
`Break` and `Continue` primitives:

```cortex
for x in xs {
  if skip(x) { continue }
  if done(x) { break }
  consume(x)
}
```

Reject them outside a loop, with precise boundaries: loop context resets at
every function/lambda boundary — a `break` inside a lambda defined or invoked
within a loop must not escape to the enclosing loop — and control targets the
innermost lexically enclosing loop. `break`/`continue` remain valid inside
`if`, `match`, and `do` blocks within a loop body. These rules matter because
the engine's `Block` already short-circuits structurally on
`Break`/`Continue`, so a parser-only loop-depth check without a function
boundary would permit unintended non-local control flow.

The engine also already supports the value-carrying forms: the `Loop` operator
consumes `Break(v)` as the loop's value and types such loops accordingly, and
`Return` propagation exists at the engine layer (see `otherwise return`
above). Value-carrying `break value` and general `return` are therefore
surface-syntax decisions, not blocked on new runtime machinery. General
`return` still needs its own ruling, and `otherwise return` creates new
pressure to define it.

### Function parameter ergonomics

Add default and user-defined variadic parameters:

```cortex
function roundTo(x, digits: integer = 3) { ... }
function mean(...xs: number) { ... }
```

Named call arguments are also worth exploring for scientific APIs with several
optional controls:

```cortex
fit(data, tolerance: 1e-10, maxIterations: 200)
```

`name: value` is currently unambiguous in a call argument list. It needs a
stable MathJSON encoding and a ruling on whether names are part of a function's
type/signature or merely mapped to positional slots at the call boundary.

### Immutable update expressions

Collections are correctly immutable, but rebuilding an element through
`Map`/`Join` is poor ergonomics. Explore:

```cortex
let ys = xs with [3] = 42
let moved = point with .x = point.x + 1
let config2 = config with .precision = 50
```

The expression returns a new value and should use structural sharing where
available. It does not introduce mutable indexed assignment. Cortex does not
currently have `SetAt`/`SetField` primitives to lower to; introduce and specify
those library operations first. They are independently useful, give the syntax
a testable semantic base, and force rulings for an absent index/field, nested
paths, and preservation of nominal record types.

### Parametric polymorphism

Follow the already designed rank-1 type-variable plan. Its first milestone is
engine polytypes with `forall` signatures; inline generic Cortex bodies and
the `function f<T>(...)` sugar are a ruled v2 milestone, not syntax that exists
today:

```cortex
function first<T>(xs: list<T>) -> T { xs[1] }
function swap<T, U>(p: tuple<T, U>) -> tuple<U, T> { (p[2], p[1]) }
```

Transparent generic type aliases (`type alias pair<T> = tuple<T, T>`) are
ruled to ride the phase-1 substitution machinery and need not wait for
generic bodies; parameterized **nominal** type declarations remain a separate
future extension. Neither is part of the ruled generic-function milestone.

This is substantially more valuable than adding isolated type-handler special
cases. Higher-rank types, higher-kinded types, and type packs can remain out of
scope.

### Behavioral constraints: requirements before protocols

Cortex does not currently need object-oriented interfaces. Structural record
types and aliases already describe data shape; nominal types describe identity
and construction; function signatures describe callability; and multi-clause
functions provide concrete type/value dispatch. Adding methods, inheritance,
mixins, visibility rules, or interface-typed object values would duplicate
those mechanisms and pull the language away from its expression-oriented
model.

There is, however, one capability that the generic-function milestone will
eventually need. A generic body must be checked under the assumption that
operations exist for its type variables. In the common case, those requirements
can and should be inferred from the body:

```cortex
function twice<T>(x: T) -> T {
  Add(x, x)
}
```

Here the operands give `Add` the argument types `(T, T)` and the function's
declared result supplies the expected result type `T`. Instead of rejecting the
call because `T` is not ground, the checker can emit an internal requirement
equivalent to `Add: (T, T) -> T`. The inferred requirement becomes part of the
generic function's inferred contract and should be visible through
introspection and tooling.

The current rank-1 design can constrain `T` to a ground upper bound such as
`number` or `indexed_collection`, but it cannot express "there is an
applicable `Add(T, T) -> T` operation." Without such evidence, a generic
Cortex body either cannot type-check `Add(x, x)`, must be restricted to a
closed built-in type family, or must defer an avoidable error until runtime.
This behavioral constraint—not field access—is the strongest justification
for a protocol-like feature.

Everything in this section presupposes the type-variable plan's v2 milestone
M1 (per-call generic-body instantiation), which that design explicitly leaves
to a future dedicated document with several competing candidate approaches.
The M1 approach chosen materially constrains how requirement inference over a
body can work; requirement inference should be designed together with M1, not
before it.

Start with **inferred anonymous operation requirements**, not mandatory
`requires` sections. A requirement is a compile-time obligation over existing
Cortex symbols and overload arms, not a method declaration and not dynamic
dispatch:

```cortex
function minimum<T>(a: T, b: T) -> T {
  if Less(a, b) { a } else { b }
}

// inferred: Less: (T, T) -> boolean
```

At a call site, resolution must find one unambiguous implementation for every
requirement after substituting the inferred type arguments. The resolved
operations become explicit internal witnesses available while checking and
evaluating or compiling the generic body. Resolution must not re-run arbitrary
expressions or depend on a returned runtime value.

When a reusable named abstraction exists, put the explicit contract directly
on the generic parameter rather than in a separate section:

```cortex
function twice<T: additive>(x: T) -> T {
  Add(x, x)
}
```

The `additive` protocol supplies the `Add: (Self, Self) -> Self` requirement.
The body still calls the ordinary global `Add`; protocol lookup supplies and
captures the applicable implementation. This extends the already ruled generic
bound position naturally. Its signature-level counterpart would be something
like `forall T: additive. (T) -> T`, with the type-variable design extended to
distinguish a protocol constraint from its currently supported ground type
upper bound.

This gives Cortex a useful hybrid:

- With no named protocol bound, infer the smallest anonymous requirement set
  from the body.
- With a named protocol bound, use it as an explicit public contract. Every
  operation on the type variable must be supplied by its stated bounds (or by a
  universally available operation); otherwise diagnose the missing constraint
  instead of silently widening the API.
- Never infer a *named* protocol merely because the body happens to use the
  same operations. A protocol name can carry authorial intent or documented
  laws that call-shape inference cannot establish.

Explicit named bounds are especially useful when:

- a bodyless or externally implemented generic declaration has nothing from
  which to infer requirements;
- a published API wants its constraints to remain stable when its body changes;
- overload inference has more than one valid operation/result relationship; or
- the author wants the checker to verify that the body stays within a named
  capability budget.

A separate `requires` surface is therefore not justified initially. It would
only add expressiveness for an **explicit but unnamed** one-off constraint.
Defer that spelling until bodyless declarations or overload disambiguation show
that defining a small named protocol is materially too heavy. This mirrors
Cortex's existing distinction between inferred and author-declared effects
without introducing a second constraint location preemptively.

Inference removes surface noise but not the underlying semantic work. Overload
constraint solving, stable witness capture, ambiguity diagnostics, recursive
generic definitions, and separate compilation still need precise rules. In
particular, inference can discover that a signature exists; it cannot infer
algebraic laws such as associativity from the body.

Named honestly, this is a restricted typeclass system — dictionary passing
with witnesses fixed at instantiation, and no dynamic dispatch — and it
carries two more prerequisites beyond the rules above. Requirements and
witness sets need a MathJSON representation: the promise that inferred
requirements are visible through introspection and tooling is meaningless
without a serialization, and in this language the IR *is* the serialization.
And witness transport needs a mechanism: how a captured witness set travels
with an instantiated generic body into evaluation and compilation — including
across the worker-boundary serialization used by parallel execution, where a
body and its witnesses must ship together.

Only introduce **named protocols** if groups of requirements repeat in real
code. They can then be aliases or bundles over the same mechanism rather than a
second dispatch system:

```cortex
protocol additive {
  Zero: Self
  Add: (Self, Self) -> Self
}

function sum<T: additive>(xs: collection<T>) -> T { ... }
```

This reuses the existing generic-bound position, although protocol bounds and
ordinary type upper bounds must remain distinguishable internally. If both are
needed, an intersection-like constraint such as `T: number & additive` is a
plausible spelling, subject to kind checking. `Self` is illustrative syntax,
not a settled type-system feature. A generic protocol parameter could be used
instead if it composes better with the rank-1 solver.

Initial semantic constraints should be conservative:

- Protocols constrain generic code; they are not initially first-class value
  types. Defer existential or dynamic forms such as "some additive" and runtime
  protocol casts.
- Requirements name global Cortex operations. Do not add a parallel method
  lookup or `value.method(...)` dispatch system.
- Satisfaction of inferred requirements may select existing overload arms, but
  those selections must be captured as a witness set at generic instantiation.
  They must not change later because an unrelated overload enters lexical
  scope. Named conformances—especially ones asserting laws—should be explicit.
- Exactly one visible conformance or witness set must win for a concrete
  protocol/type combination; ambiguity is an error. Notebook re-evaluation and
  lexical scope make this coherence rule more important, not less.
- Named conformances need a concrete mechanism before named protocols are
  implementable: a declaration syntax or API, ownership/orphan rules, lexical
  visibility, duplicate/ambiguity diagnostics, and a witness-invalidation rule
  for notebook re-evaluation — when a definition participating in a captured
  witness set is replaced, dependent instantiations must be invalidated rather
  than silently kept or silently re-resolved.
- No protocol inheritance or default implementations initially. Composition
  can be expressed by requiring several protocols; defaults can be ordinary
  generic functions.
- Avoid associated types in the first version. Parameterized relationships
  such as `collection<T>` already state the important element-type relation and
  fit the existing rank-1 solver better.
- Algebraic laws such as associativity, commutativity, or total ordering cannot
  be proved by signature checking. A protocol may document such a promise, but
  the compiler must not silently use it to change evaluation order unless the
  programmer has explicitly opted into that contract. This is especially
  important for parallel reduction.

The threshold for adding the feature is concrete and testable:

1. user-authored generic Cortex bodies are implemented;
2. those bodies need to call operations unavailable from a ground type bound;
3. user-defined nominal types need to participate in the same algorithms as
   built-in types; and
4. repeated inferred requirement sets demonstrate that names improve the
   language.

Until the first three occur, protocols add machinery without unlocking a real
program. Once they occur, operation requirements are likely necessary; named
protocol declarations remain an ergonomic consequence, not the foundation.

### Remaining type-system gaps

The type grammar is already broad: it has unions, intersections, negation,
literal and bounded numeric types, records, dictionaries, tuples, homogeneous
collections, tensor dimensions, overload sets, function variance, effects,
nominal and structural recursive types, and a designed rank-1 generic layer.
The next gaps are mostly about **relationships between types and values**, not
about adding more Boolean type operators.

#### 1. Flow-sensitive narrowing and exhaustiveness

Unions, negation, literal types, and type patterns deliver only part of their
value until control flow can refine them:

```cortex
function describe(x: integer | string) {
  if x is integer {
    x + 1       // x: integer here
  } else {
    StringLength(x) // x: string here
  }
}
```

Two prerequisites need to be named. First, `x is integer` is not current
Cortex syntax: a dynamic `is` type-test operator is independently useful and
should be adopted as a high-priority surface form of its own (see the
sequencing section), regardless of when static narrowing lands. Second, the
static checker currently canonicalizes each statement independently — prior
declarations are not modeled — so narrowing needs a checker-design
prerequisite covering statement transfer, lexical environments, assignment
invalidation, branch joins, and conservative guard handling across bindings.

`match` already binds typed patterns dynamically, but static exhaustiveness,
redundant-case detection, and branch-local narrowing are deferred. This is the
highest-leverage checker improvement because it makes existing type syntax
useful rather than introducing a new family of types. Narrowing should support:

- type and literal tests;
- `match` cases, with the matched remainder subtracted after each unguarded
  case;
- `if let`, including elimination of `error` on the success branch;
- `Missing` tests for optional data; and
- conservative treatment of guards, which generally cannot subtract a type
  unless the checker understands the predicate.

Do not add a general theorem prover. Recognize a small closed set of narrowing
forms and fail conservatively elsewhere.

#### 2. Generic type aliases, followed cautiously by parameterized nominals

The generic-function design already supplies most of the machinery needed for
transparent aliases:

```cortex
type alias pair<T> = tuple<T, T>
type alias result<T, E> = T | E
```

This is a direct, useful extension: substitute arguments and eagerly expand the
alias. It requires an applied-reference/type-application representation but no
new runtime semantics.

Parameterized **nominal** types are a separate, harder feature:

```cortex
type point<T> = tuple<x: T, y: T>
```

They affect constructor identity, recursive references, serialization, and
subtyping. Default them to invariant if admitted; Cortex can add inferred or
declared variance later only when a real covariance use case outweighs the
complexity. Immutability makes covariance plausible for some representations,
but nominal opacity means it should not be assumed automatically.

Recursive generic aliases and algebraic data types should follow applied type
references, not be bundled into the first alias milestone.

#### 3. Dimension and shape variables

The current `?` dimension wildcard forgets correlation. It can say "some
matrix" but cannot state that two dimensions are the same or that matrix
multiplication preserves the outer dimensions:

```text
forall T, M, N, P.
  (matrix<T^(M x N)>, matrix<T^(N x P)>) -> matrix<T^(M x P)>
```

This is unusually valuable for Cortex because matrices and tensors are a core
domain, not a library afterthought. Treat dimensions as a separate variable
kind with equality constraints; do not turn ordinary type variables into
integers. A staged design could support:

1. named dimension variables and repeated-name equality;
2. a shape variable representing a dimension tuple;
3. rank/concatenation constraints needed by reshape and tensor operations; and
4. only then, limited dimension arithmetic if concrete operators require it.

General dependent types are unnecessary. A small decidable shape solver covers
the important cases while keeping ordinary subtyping write-free.

#### 4. Physical-dimension types for units and quantities

The units library already parses compound units, computes dimension vectors,
checks compatibility, and performs conversions, but its public signatures are
currently only `(value, value) -> value`. The type system therefore cannot
reject adding a length to a duration or converting a force to an energy even
when both units are statically known.

A domain-specific type family could preserve the magnitude type and physical
dimension without baking a particular display unit into value identity:

```text
unit<length>
quantity<real, length>
quantity<real, length / time>
```

Meters and feet should have the same physical-dimension type; conversion changes
the representation, not the dimension. Core typing rules can remain small:

- addition/subtraction and conversion require compatible dimensions;
- multiplication/division add or subtract dimension exponents;
- integer powers scale exponents; and
- `QuantityMagnitude` preserves the magnitude type while `QuantityUnit`
  returns the corresponding `unit<D>`.

Use a closed normalized dimension-vector representation internally rather than
general symbolic type arithmetic. This is related to, but distinct from,
matrix **shape** variables: physical dimensions describe units, tensor
dimensions describe cardinalities.

Affine units such as Celsius and Fahrenheit are the important trap. A physical
dimension alone cannot distinguish an absolute temperature from a temperature
difference, and their addition/subtraction rules differ. Either model that
distinction explicitly or keep the initial static rules conservative around
affine units. Do not advertise full dimensional soundness while erasing it.

This type family is justified even if the `unit"..."` literal syntax is not:
the runtime already carries the information, and library signatures currently
discard it.

#### 5. Higher-order inference and type packs for the `Map` family

Simple rank-1 variables are insufficient for the real variadic contract of
`Map(xs, ys, ..., callback)`: each source has its own element type and the
callback has a corresponding parameter. The current design also lacks a solver
site for lazy held callbacks.

This is a concrete reason to explore a restricted type pack or correlated
variadic mechanism, together with post-canonical higher-order inference. It
would improve `Map`, `Filter`, `Zip`, tuple transforms, and the proposed
parallel variants. Avoid general variadic metaprogramming initially; target the
specific relation "one element type per source collection, in the same order."

#### 6. Record optionality and exactness

Records currently use width subtyping: a value with extra fields satisfies a
record type requiring fewer fields. That makes `record<x: number>` an open
minimum-field contract, even though some documentation describes record keys
as fixed and nominal-constructor payload validation separately requires exact
keys. The model should make this distinction explicit.

Useful forms are:

```cortex
record<x: number, label?: string> // label may be absent
record<x: number, ...>            // explicitly open, if openness is not default
```

An optional field read naturally has type `string | missing`. An exact/closed
record form may also be useful for schemas and constructor payloads, but the
existing width-subtyping behavior should not be silently reversed. First
clarify whether ordinary `record<...>` denotes required fields with extras
allowed; then add explicit optionality and, only if needed, exactness.

Full row polymorphism can wait. A bounded whole-record variable often preserves
unknown extra fields without introducing row variables, especially once
immutable update expressions exist.

#### 7. Limited type projections for value-dependent library results

Some library contracts remain imperative because the result depends on a key,
index, or operand structure: indexing a heterogeneous tuple, reading a record
field, broadcasting a shape, or selecting a collection's element type. Full
dependent or conditional types would be disproportionate.

If generic substitution and overloads still leave many `type:` handlers, add a
small closed family of type projections, for example conceptually:

```text
element<C>
field<R, K>
at<C, I>
shape<C>
```

These are compiler-known, pure type functions over ground type arguments—not
user-programmable type-level computation. Literal overload arms can handle
small fixed cases; projections are justified only where they replace recurring
imperative result-typing logic.

#### 8. Typed fallibility, only after the error boundary is settled

The grammar has one undifferentiated `error` type while the proposed `if let`
and `otherwise` forms make recoverable errors more visible. It may eventually
be useful to distinguish declared recoverable failures:

```text
number | error<parse_error | out_of_range>
```

Do not add this before deciding which errors participate in static result
types. If every possible validation or arithmetic-domain error infects every
signature, useful types collapse into pervasive `T | error`. A better boundary
may track only intentionally recoverable, author-declared error results and
leave invariant violations or statically rejected calls on the existing
diagnostic/error-value path.

#### Features to continue deferring

- **General refinement predicates** such as `{x: real | p(x)}` require proof
  obligations or runtime checks and would overlap assumptions.
- **General dependent and conditional types** are much more machinery than the
  few value-dependent library contracts warrant.
- **Higher-rank and higher-kinded types** have no demonstrated Cortex use case;
  rank-1 generics, protocols, and generic aliases cover the near-term needs.
- **Effect rows/variables** remain unnecessary while higher-order operators can
  project effects from the actual callback value, as ruled by the effects
  model.
- **Existential protocol values and runtime casts** should wait for a concrete
  heterogeneous-storage or plugin-boundary use case.
- **User-written variance annotations** should wait for parameterized nominal
  types and a proven need; invariance is a safe initial rule.

Recommended order: flow narrowing and exhaustiveness; transparent generic
aliases; dimension/shape variables; physical-dimension quantity types; the lazy
higher-order/type-pack seam; record optionality and semantic clarification;
then limited projections based on the remaining handler audit. Parameterized
nominals and typed fallibility should be separate later decisions.

### Symbolic rewrite blocks

`ReplaceAll(expr, Rule(...))` exists, but a symbolic language should make
authored structural transformation more direct and should reuse the pleasant
`match` pattern language:

```cortex
rewrite expr {
  a + 0 => a
  0 + a => a
  Sin(a)^2 + Cos(a)^2 => 1
}
```

This form must hold the target and patterns so canonicalization does not erase
the authored structure before matching. Specify traversal order, simultaneous
versus sequential rules, single pass versus fixed point, guards, and behavior
when several rules match. This is domain-specific metaprogramming and does not
require adopting general macros.

### Unit literals

Provide a tagged, validated unit literal rather than treating unit names as free
symbols:

```cortex
let speed = 30 * unit"km/h"
```

`unit"..."` is a primary that parses the existing unit DSL. Juxtaposed
`30unit"km/h"` could be considered later as invisible multiplication, but the
explicit product is a safer first step. This composes with existing `Quantity`
semantics and avoids overloading indexing or backtick symbols.

### Modules and reusable source

If Cortex grows beyond notebook fragments, add a deliberately small module
system:

```cortex
import "./stats.cx" as stats
export function robustMean(xs) { ... }
stats.robustMean(data)
```

Start with explicit file modules and namespace values; defer package management,
implicit prelude customization, and elaborate visibility systems.

Even the smallest version must specify its trust boundary. Module reading is a
load-time host concern — imports are resolved when the program is parsed and
loaded, before evaluation — so it is not the runtime `fs_read` effect, but it
deserves the same default-deny posture: the host injects a module resolver,
and without one, imports fail with a diagnostic rather than reaching the
filesystem. The design must specify the resolution root, path normalization
and symlink policy (no traversal outside the root by default), allowed
extensions, cycle handling, caching and re-evaluation semantics, and that
imported code gains no host capabilities beyond those of the importing
evaluation.

## Async, parallelism, threads, and coroutines

These names describe different facilities and should not enter Cortex as one
undifferentiated "concurrency" feature:

- **async** means an application may suspend while waiting for an external or
  long-running operation;
- **parallelism** means evaluating independent computations concurrently as an
  execution strategy;
- **threads** expose a particular shared-memory runtime mechanism; and
- **coroutines/generators** are user-authored resumable computations that
  produce a sequence over time.

The effects model has already ruled the most important async question:
`async` is a function effect, **not** a `promise<T>` value type. This is the
right fit for a symbolic engine. A pending promise cannot participate sensibly
in canonicalization, algebra, or pattern matching, while an unevaluated/held
expression already represents a computation not yet performed. JavaScript
Promises remain at the host API boundary (`evaluateAsync()`), not in Cortex's
mathematical value space.

`async` is a ruled future label, not one of the currently accepted effect
labels. The type parser and Cortex surface reject it today. Adding it is a
visible type-language change and must land before any example in this section
becomes valid Cortex.

### Async suspension

Admit the `async` effect only when Cortex gets its first genuinely asynchronous
operator, such as a host-backed `Fetch` or remote solver:

```cortex
function load(url: string) async network -> string {
  Fetch(url)
}
```

The exact spelling already fits the effect-specifier slot. `async` is not an
impurity: an async computation can be referentially transparent and its settled
value cacheable. It is nevertheless not callable from a synchronous evaluation
entry point. A sync entry point rejects an application carrying `async` before
running it; `evaluateAsync()` is the outer boundary that can discharge the
suspension.

Two gaps must be closed before any example here becomes executable. First,
the host contract does not exist yet: Cortex's public entry point is the
synchronous `executeCortex()`, with no awaiting variant, no abort signal, and
no evaluation identity. An `executeCortexAsync(..., { signal })` (or an
equivalent engine `evaluateAsync` route) must specify statement ordering under
suspension, sync-entry rejection diagnostics, and CLI behavior; rerun
cancellation must be assigned to the notebook host through an explicit
evaluation handle, because the language runtime cannot infer cell identity.

Second, lazy collection views need a rule. `Map`, `Filter`, `Comprehension`,
and the proposed `ParallelMap` defer element work until later synchronous
`each()`/`at()` access, so `Map(urls, Fetch)` could escape the awaiting
boundary with undischarged async work and no promise value or async iteration
protocol to resolve it. The first version should reject `async` effects
inside callbacks or bodies of lazy views that can escape the awaiting
boundary — equivalently, an async-carrying view must be fully materialized
within the async evaluation that created it.

Do not add promise-valued variables, promise combinator methods, or implicit
promise lifting across the library. Errors from an awaited computation remain
ordinary Cortex `Error` values, so the proposed rescue forms compose normally:

```cortex
let data = Fetch(url) otherwise cachedData
```

Whether Cortex needs an explicit `await` expression is still open. It may add
little in the first version if async evaluation is direct-style and the cell or
host boundary awaits the whole expression. Add `await` only if it creates a
real, observable delimiting/discharge boundary inside a program; do not add it
merely to imitate JavaScript syntax.

Notebook execution needs structured lifetime rules from the start:

1. an evaluation owns every asynchronous operation it starts;
2. canceling or re-running a cell cancels its outstanding work;
3. time/iteration/cancellation budgets propagate into child work;
4. capability handlers are snapshotted at evaluation entry; and
5. no detached/background task survives a cell in the first design.

### Deterministic parallelism

Scientific Cortex may benefit more immediately from deterministic data
parallelism than from general async I/O. Prefer held-expression or collection
operators over exposed threads. The name `Parallel` is unavailable: it already
denotes the inert geometry relation `Parallel(a, b)`. Use a distinct candidate
name unless that existing public head is deliberately migrated:

```cortex
ParallelEvaluate(Hold(f(a)), Hold(g(b)))
ParallelMap(xs, f)
```

or, if syntax proves worthwhile:

```cortex
parallel (f(a), g(b))
parallel Map(xs, f)
```

The operator evaluates independent operands/elements concurrently but preserves
the same value and result ordering as sequential evaluation. The scheduler may
choose worker threads, processes, or a serial fallback; none of those
mechanisms belongs in the language contract. GPU execution is admissible only
as an explicit opt-in precision tier (see the execution model below), because
`f32` kernels cannot reproduce sequential double-precision values.

#### A concrete `ParallelMap` contract

`ParallelMap` is useful enough to specify independently of a general
`parallel` syntax:

```cortex
ParallelMap(xs, f)
xs |> ParallelMap(_, f)
```

A conservative first version would have these rules:

1. **Ordered result.** Element `i` of the result is `f(xs[i])`, regardless of
   completion order. Internally completed values wait in a bounded reorder
   buffer.
2. **Lazy and bounded — as a property of the drain, not of the escaping
   value.** Like `Map`, it is a lazy list view, and
   `Take(ParallelMap(Iterate(f, seed), g), 10)` never tries to enumerate the
   infinite source. The parallel window exists only while a driving
   `evaluateAsync` is materializing the view: prefetch, the reorder buffer,
   and worker dispatch are internal scheduling of that drain, and completed
   elements are memoized. The collection interface itself stays synchronous
   (`each()`/`at()`): an element demanded after the view has escaped the
   async evaluation is computed serially on demand — legal because serial
   execution is always a valid strategy under this contract, and the value
   is identical; it is simply not accelerated. No async-collection protocol
   is required. (Callbacks carrying the `async` *effect* are the different,
   stricter case ruled in the async section: there serial fallback is
   impossible rather than merely slow, so such views must be fully
   materialized within the async evaluation that created them.) A host
   option or optional argument controls maximum concurrency.
3. **Exactly once per demanded element.** Retries are not implicit. Element
   memoization ensures that re-reading a materialized position does not rerun
   its callback.
4. **Same error positions as `Map`.** A callback error occupies the
   corresponding collection position, following ordinary `Map`'s
   collection/error boundary. It does not cancel unrelated elements unless the
   whole evaluation is canceled.
5. **Structured cancellation.** Abandoning or canceling the consumer cancels
   outstanding work for no-longer-demanded elements. Cancellation does not
   corrupt the view: an implementation may retain already-memoized elements
   (later demands replay them and compute the rest serially) or drop the
   partial memo wholesale and recompute on demand — both are observationally
   legal, because the callback is pure and recomputation is therefore
   unobservable. The only obligation is never to expose a partially computed
   element.
6. **Scope snapshot.** Captured values are snapshotted once, when the view
   first materializes, and that snapshot is retained for the lifetime of the
   view; every element sees the same captured state regardless of batching,
   concurrency window, or backend. Escaping writes from the callback are
   forbidden. This is deliberately scheduler-independent: a per-batch
   snapshot would let a captured binding mutated between demands produce
   different results at different concurrency settings, breaking the
   equal-to-sequential guarantee. Where this differs observably from
   sequential `Map` (which reads captures at each element's materialization),
   the difference is part of the documented contract. Acceptance test: mutate
   a captured binding between demands and require identical results at
   concurrency 1, concurrency N, and serial fallback.

For v1, require the callback to be **pure**. This is clearer than trying to
make every current effect schedule-independent. `scope`, console output,
filesystem writes and similar actions are order-sensitive; clock/environment
reads can observe different external states at different completion times; and
the current framed-random contract consumes a sequential draw index that
parallel scheduling must not reorder.

Purity is necessary but not sufficient. The effects model classifies writes
and actions, not reads of captured mutable scope, so a pure callback can
still observe a binding that is reassigned between demands. Admissibility
therefore adds two structural conditions on the callback value: it must be
**closed** — every free symbol resolves into the captured snapshot, with no
live-scope reads at call time — and its captured snapshot must be
**serializable**, since it crosses the worker boundary. These are checked at
dispatch by inspecting the actual callback value, exactly where higher-order
operators already project effects from the callback; a callback failing
either condition declines to serial fallback with identical values. They are
deliberately *not* new effect labels: closed-ness is a property of a
particular closure value relative to the bindings it captured — like
constness, a binding-level attribute knowable at closure creation — not a
context-free label on a function signature, and encoding it as an effect
would force conservative contagion through every higher-order composition. A
static diagnostic may later surface the classification as an analysis
result.

A later version could admit `random` under an explicit per-element substream
rule derived from `(frame seed, element index)`. That would be deterministic
across schedules, but it would intentionally partition the stream differently
from sequential `Map`, so it must be part of `ParallelMap`'s documented
semantics rather than an invisible optimization. Concurrently awaited I/O
belongs in a separately named bounded `ConcurrentMap`/async facility if it is
ever needed.

Backend choice is an implementation detail with one exception: compiled SIMD,
a worker pool, and serial fallback are all valid because they produce the same
ordered `f64` value. A GPU backend cannot: WGSL/GLSL execute in `f32` with
looser NaN/infinity semantics, so a GPU kernel cannot reproduce sequential
double-precision results bit for bit. GPU execution is therefore an explicit
opt-in precision tier — like the existing machine-versus-bignum split — never
a silent scheduler choice.

The policy question — does `ParallelMap` promise an attempt at parallel
execution, or merely grant permission to parallelize? — is resolved as
**promise to attempt**. The explicit operator is a request: `evaluateAsync`
honors it unconditionally, subject to admissibility (a pure, compilable
callback), and falls back to serial execution otherwise, mirroring the
existing compile-with-interpreter-fallback pattern. Anything automatic (see
the execution model below) is permission, not promise.

#### Execution model

Parallelism is an execution strategy, never a semantics: under the contract
above, a parallel backend may not change the value. Three consequences fix
the API shape.

1. **No new evaluation entry point, and no `parallel` flag.**
   `numericApproximation` changes *what* is computed — exact versus float,
   two different correct answers. Parallelism changes only *how*, so it must
   not be a peer of that flag. The synchronous `evaluate()` route always runs
   the serial fallback — legal precisely because the contract pins the
   value — and the existing `evaluateAsync()` is where a genuinely parallel
   backend runs, necessarily, since every real mechanism (worker messaging,
   GPU readback) is asynchronous. Execution *policy* lives in the options bag
   the async design needs anyway for cancellation:
   `evaluateAsync({ signal, maxConcurrency, ... })`, including a
   `parallel: false` kill-switch for debugging and reproduction — policy, not
   meaning.

2. **Real parallelism implies compilation, because values cannot cross a
   thread boundary.** Boxed expressions and compiled closures hold engine
   references and are not structured-cloneable. Two transports:

   - **Numeric tier (the payoff case):** compile the callback to JavaScript
     *source*, ship the string to a persistent worker pool, and move data as
     `Float64Array` transferables — zero-copy, and deployable without the
     cross-origin isolation that `SharedArrayBuffer` requires. Decline to
     compile → serial fallback, exactly like `Map` auto-compilation today.
     This tier admits only callbacks whose compiled form is total over
     floats: `NaN` is the error representation, as in compiled kernels
     generally. A callback that can produce a genuine `Error` value takes
     the symbolic tier, which preserves error values in their collection
     positions, or declines to serial.
   - **Symbolic tier (general fallback):** one engine per worker; the
     callback and the captured-scope snapshot travel as MathJSON, results
     return as MathJSON. Correct for arbitrary pure callbacks but heavy —
     engine startup, per-element serialization — so it should exist without
     leading.

   The scope-snapshot rule above maps directly onto this model: "snapshot
   once at first materialization" is literally "serialize the captured
   bindings once and ship them." The WGSL compile target already exists; a
   GPU backend needs only a host-side compute-dispatch harness (one
   invocation per element, storage buffers in and out, asynchronous readback)
   plus the opt-in precision tier ruled above.

3. **In the interpreter, transparent parallelization of plain `Map` is a
   possible later optimization, not a substitute for `ParallelMap`.** (In the
   compiled `javascript-async` target below it is instead the default story,
   because a compiled artifact's closed world makes the safety gate easy to
   prove.) The explicit operator
   is needed for two reasons. It is where the documented contract deltas
   live — the snapshot epoch, and any future per-element random substream
   rule; an operator byte-identical to `Map` would not deserve a name, and
   this one differs in exactly the corners that justify one. And heuristics
   cannot see callback cost: total work is `n × cost(f)` against a real fixed
   dispatch cost, so collection length is a poor proxy — ten elements at two
   seconds each deserve parallelism; a million at nanoseconds each do not.
   The user knows which stage is expensive; a threshold does not.

   If automatic `Map` parallelization is ever added under `evaluateAsync`, it
   is gated on provable indistinguishability: a pure, compiled callback, and
   no speculation past the current demand. The speculation condition is the
   subtle one: sequential lazy `Map` reads captures at each element's
   materialization, so evaluating a demanded batch concurrently is safe (the
   sequential order would have evaluated all of it after the same preceding
   assignments), but prefetching beyond the demand can observe stale captures
   relative to sequential order — the automatic path must not speculate
   unless captured bindings are provably immutable. For the cost decision,
   sampling beats thresholds: run the first element serially through the
   compiled kernel, measure, then decide whether dispatch overhead pays —
   which also validates the kernel before shipping it to workers.

4. **Compilation targets encode the same split: the target is the opt-in.**

   - **`javascript` (sync):** a `ParallelMap` node compiles exactly like
     `Map` — a serial drain loop. The contract makes this legal, and the
     artifact's synchronous shape is a consumer guarantee: a flag that
     silently turned `(x) => number` into `(x) => Promise<number>` would be a
     semantics flag in disguise.
   - **`javascript-async` (new target):** a Promise-returning artifact, and a
     wholesale grant of *permission*: within it the compiler may parallelize
     any admissible data-parallel stage — explicit `ParallelMap` or plain
     `Map` — using the effect, purity, and type information it already has.
     A compiled artifact is a closed world (a pure function of its arguments,
     with no interleaved assignments between element demands), so the
     indistinguishability gate that is subtle in the interpreter is easy
     here: pure callback → parallelize; impure or unprovable → serial. The
     deterministic value contract is retained — `javascript-async` returns
     the same `f64` values as `javascript`, just asynchronously — so a
     consumer can switch targets without revalidating output, and does not
     need to choose `Map` versus `ParallelMap` when compiling; selecting the
     target does the work. The motivating case is repeated invocation with
     varying arguments (an animated plot): the worker pool stays warm, the
     kernel ships once, per-call cost is data transfer — and repetition lets
     the artifact decide adaptively, timing early calls serially and
     switching to workers once dispatch overhead pays.

     Pool ownership follows the engine: the engine owns one persistent
     worker pool, shared by runtime `ParallelMap` execution and every
     `javascript-async` artifact it compiles, and disposed with the engine.
     An artifact therefore stays bound to its engine — either invoked
     through an engine execute method or self-executing while holding a
     reference to its engine's pool. Each invocation accepts a per-call
     abort signal so a superseded call (a stale animation frame) can be
     abandoned without disturbing the pool.
   - **GPU targets (`wgsl`, `glsl`):** target selection is the
     precision-tier opt-in, per the ruling above. Here `ParallelMap` is not a
     scheduling hint but the *compilation unit marker*: the callback becomes
     the compute kernel and the collection becomes the dispatch — one
     invocation per element, storage buffers in and out — with the operator
     boundary telling the compiler where the kernel ends and the host
     dispatch description begins. A serial `Map` drain has no meaning in a
     shader; the explicit operator is what gives collection compilation to
     GPU targets a well-defined shape.

The composition story is then: write `Map` everywhere; when running
interpreted, flip the one hot stage to `ParallelMap` (a request the runtime
promises to attempt under `evaluateAsync`); when compiling, select
`javascript-async` and let the compiler parallelize what it can prove
admissible (a permission granted by target selection). Either way, no program
can tell the difference except by the clock — only the GPU targets trade the
value contract, explicitly, for the `f32` tier.

#### Parallel-pipe syntax

A custom pipe-like operator is a plausible surface for the common
`ParallelMap` case. Keep its meaning deliberately narrow rather than defining
it as a generic "make the right side parallel" hint:

```cortex
xs ||> f
xs ||> (x |-> expensive(x, option))
xs ||> (_^2 + 1)
```

with the exact lowering:

```cortex
xs ||> f                         // ParallelMap(xs, f)
xs ||> (x |-> expensive(x, c))  // ParallelMap(xs, x |-> expensive(x, c))
```

`||>` can be read as a widened or parallel pipe. It also has a common ligature
in programming fonts, which makes the intended unit visually clear without
requiring Unicode input. The existing Cortex character table already
normalizes `⧐` (U+29D0, VERTICAL BAR BESIDE RIGHT TRIANGLE) to `||>`, providing
a natural fancy spelling. The operator has the same loose precedence and left
associativity as `|>`. It composes naturally with ordinary collection stages:

```cortex
1..1000
  |> Filter(_, IsPrime)
  ||> expensiveTransform
  |> Sum
```

The left operand must be a collection and the right operand must be a callable
or ordinary shorthand-function expression. In this operator, `_` denotes one
source element, matching `Map` callback shorthand; it does not denote the whole
left collection. An explicit lambda remains preferable whenever that contextual
meaning could be unclear.

A chain is semantically nested ordered parallel maps:

```cortex
xs ||> f ||> g
// ParallelMap(ParallelMap(xs, f), g)
```

An implementation may fuse adjacent stages, but must preserve the same bounded
laziness, ordering, errors, and cancellation. The spelling does **not** mean
concurrent I/O and does not relax the pure-callback requirement.

Because Cortex maximal-munches punctuation runs, the `||` Boolean-OR prefix is
not by itself a lexical conflict: `||>` is recognized as a distinct operator
token when registered in the shared operator table. F# does use `||>` for a
two-argument tuple pipe, but the font-ligature support and the visual metaphor
of multiple lanes make it the preferred Cortex spelling. `|>>` remains a
possible alternative, but has much less coding-font support and no compensating
semantic advantage.

The more explicit alternative is a contextual execution modifier:

```cortex
xs |> parallel Map(_, f)
parallel Map(xs, f)
```

This is more readable and could later cover `Filter`, `Table`, or reductions,
but "parallel" is not semantics-preserving for every operator. A parallel
reduction changes grouping unless its reducer is known associative, and
effectful filters introduce ordering questions. Supporting the modifier
therefore requires a per-operator parallel contract. The narrow `||>` form is a
better first feature if the immediate goal is parallel element transformation;
the keyword form is a better foundation only if several independently designed
parallel operators are expected soon.

#### Generalizing the parallel pipe to `Filter` and other stages

If parallel filtering and other collection operations are likely, redefine the
operator as a **parallel-stage pipe**, not as an implicit `ParallelMap`:

```cortex
xs ||> Map(_, f)
xs ||> Filter(_, predicate)
xs ||> FlatMap(_, f)
```

With the proposed input-first pipe shorthand, the lighter spellings are:

```cortex
xs ||> Map(f)
xs ||> Filter(predicate)
xs ||> FlatMap(f)
```

The general rule is:

```text
source ||> Stage(source-hole, arguments...)
```

The top-level `Stage` must have a registered parallel implementation and
contract. The syntax does not recursively parallelize arbitrary calls inside
the stage. The parser/lowering can target concrete heads (`ParallelMap`,
`ParallelFilter`, ...) or a single execution-policy wrapper carrying the
original stage; concrete heads are simpler for compilation and diagnostics.

Under this general form, a bare callable can retain the convenient implicit
`Map` meaning. Call-shaped mapper templates remain potentially ambiguous and
therefore require an explicit lambda, as specified below.

`ParallelFilter` has a precise deterministic contract:

1. Pull a bounded window of source elements.
2. Evaluate the pure predicate for those elements concurrently.
3. Commit predicate results in **source order**.
4. Emit each accepted element in source order, exactly as sequential `Filter`.
5. Keep later completed predicates in a bounded reorder buffer while an earlier
   predicate is outstanding.
6. If a predicate produces a non-boolean/error result, surface the first such
   failure in source order and cancel later speculative work. A failure from
   work that sequential `Filter` would never demand must not become observable.

This preserves values and lazy demand at the cost of head-of-line blocking: a
slow early predicate can delay already-completed later matches. Removing that
block would require an explicitly **unordered** operator with a different
result contract; `||> Filter(...)` should remain ordered.

Other stages need separate admission rules:

- **`Map`** — straightforward ordered element transformation.
- **`Filter`** — ordered parallel predicate evaluation as above.
- **`FlatMap`** — evaluate per-source expansions concurrently, then concatenate
  them in source order; memory bounds need care when one expansion is large.
- **`Any`/`All`/search** — speculative evaluation is possible, but results and
  errors must be committed in the same short-circuit order as the sequential
  operator.
- **`Sort`** — possible with a pure total comparator and a stable-result rule;
  comparator call count/order is allowed to differ only because purity makes it
  unobservable.
- **`Reduce`/`Fold`** — not generally admissible. Tree reduction changes
  grouping and therefore changes non-associative, floating, symbolic, or
  effectful computations. Require a declared associative operation plus an
  identity, or provide specialized parallel aggregates instead of treating
  arbitrary `Reduce` as parallelizable.

Thus there are two coherent designs:

1. **Map-only `||>`:** concise `xs ||> f`, with separately named
   `ParallelFilter` and other operators. Smallest language change.
2. **Parallel-stage `||>`:** regular `xs ||> Map(f)` / `Filter(p)`, backed by a
   registry of operator-specific parallel contracts. Better if parallelism is
   intended to become a family of collection operations.

Given interest in parallel filtering, the second design is the stronger
long-term direction. The keyword spelling `xs |> parallel Filter(p)` remains
the more self-explanatory surface; `||>` is its compact operator form.

The general design can still retain the convenient map/apply shorthand without
ambiguity for the common cases:

```cortex
xs ||> f                    // xs ||> Map(f)
xs ||> (x |-> f(x, option)) // xs ||> Map(x |-> f(x, option))
xs ||> (_^2 + 1)            // xs ||> Map(_^2 + 1)
xs ||> Filter(predicate)    // explicit registered Filter stage
```

Suggested resolution:

1. A bare callable, lambda, or shorthand-function expression means
   `Map(callback)` — "apply this callback independently to every element."
2. A call whose outer operator has a registered parallel-stage contract means
   that explicit stage (`Filter`, `FlatMap`, and so on).
3. A call-shaped mapper with additional arguments uses an explicit lambda:
   `xs ||> (x |-> expensive(x, option))`. Do not guess whether
   `expensive(option)` is a stage, a partially applied function, or a callback
   template.
4. An unregistered call-shaped stage is a diagnostic, with a fix-it suggesting
   an explicit lambda when it appears to be intended as a map.

This preserves `xs ||> f` as the lightweight parallel-apply form while keeping
the larger family regular. Internally, retaining a `ParallelPipe` node until
the stage head is resolved is safer than baking a list of operator spellings
into the parser; operator-definition metadata can declare whether and how a
head supports parallel execution.

The effect system supplies the safety boundary:

- pure callbacks are freely parallelizable;
- deterministic `random` callbacks are a possible later extension using the
  explicit index-derived substream rule above;
- escaping `scope` writes are rejected in parallel bodies;
- action effects such as `console`, `fs_write`, and general `network` are
  rejected initially because their observable order would vary; and
- read-only observations need an explicit reproducibility ruling rather than
  being silently duplicated or reordered.

Do not add locks, atomics, thread IDs, thread-local storage, or shared mutable
collections initially. They conflict with immutable values, reproducibility,
and portable compilation. If stateful concurrency is eventually needed,
isolated actors/messages are a better direction than exposing shared-memory
threads.

### Coroutines and user-defined generators

Cortex already calls `Range`, `Map`, `Filter`, `Take`, and related lazy views
"generators", but they are functional collection pipelines, not user-authored
stackful coroutines. That distinction should remain explicit.

Most scientific sequence generation can be covered first by:

- comprehensions;
- the existing lazy `Iterate(step, initial)` primitive;
- existing lazy collection transformations; and
- ordinary closures when local state is genuinely needed.

These forms are deterministic, serializable as MathJSON, and easier to compile.

`Iterate` is already Cortex's practical unfold operation: it repeatedly emits
the next state.

```cortex
Take(Iterate(2 * _, 1), 5)
// -> [2, 4, 8, 16, 32]
```

A textbook `unfold` is only more general in that its step can return a separate
`(emittedValue, nextState)` and signal termination. Cortex can encode separate
output in tuple state followed by `Map`, and termination with `TakeWhile` or an
explicit bound. Do not add a second `Unfold` operator unless those encodings
prove materially awkward; extending or documenting `Iterate` is preferable.

Only add generator functions if real programs need stateful suspension that
cannot be expressed adequately this way:

```cortex
generator function fibonacci() -> integer {
  let a = 0
  let b = 1
  while True {
    yield a
    let next = a + b
    a = b
    b = next
  }
}
```

Such a feature needs a new iterator/stream value contract, single- versus
multiple-consumption rules, closure-state serialization semantics, cancellation,
and a decision about replay after notebook re-evaluation. It is therefore much
larger than comprehension syntax.

Keeping collection comprehensions inside braces/brackets rather than consuming
`yield` immediately is one advantage of the delimiter-based comprehension
proposal: the `yield` keyword remains available for genuine generator functions
if they are later justified. Conversely, adopting `for ... yield` now should be
understood as choosing a shared foundation for comprehensions and future
generators, not merely picking punctuation.

### Concurrency recommendation

Tentative order:

1. deterministic `ParallelEvaluate`/`ParallelMap` over effect-safe
   computations;
2. the `async` effect with the first real asynchronous capability and an
   `evaluateAsync`/notebook cancellation contract;
3. structured race/timeout combinators over held expressions, if needed; and
4. user-defined generator functions only after comprehensions and `Iterate` prove
   insufficient.

Raw threads and shared-memory synchronization should not be Cortex language
features in the foreseeable design.

### Testing, strings, and diagnostics

Library/tooling improvements with language-level ergonomic impact:

- `Assert`, `AssertEqual`, and `cortex test`;
- `StringLength`, trim, case conversion, find, replace, and number parsing;
- effect reporting in `cortex check`;
- exhaustiveness and unreachable-pattern diagnostics; and
- eventual preservation/attachment of documentation comments for reusable
  source files.

## UFCS and the pipe operator

The current roadmap records UFCS as declined, partly on the older assumption
that dictionary `.key` access had not been adopted. Field access is now part of
the language, and concrete examples expose the cost of repeated pipe
placeholders, so this note deliberately reopens the ergonomics question. It
does not by itself reverse the roadmap decision.

UFCS should not be dismissed: it is attractive precisely where a pipeline
stage needs additional arguments.

```cortex
xs.Filter(pred).Map(f).Take(10)
```

is more compact than repeated placeholders:

```cortex
xs |> Filter(_, pred) |> Map(_, f) |> Take(_, 10)
```

The reason to rank it below some other items was not lack of utility. It is a
specific collision with Cortex's existing field semantics. Today:

```cortex
p.x(2)
```

means `Apply(Field(p, "x"), 2)`: read field `x`, then call the value stored
there. True UFCS would instead mean `x(p, 2)`. Both are useful, and selecting
between them based on whether a field or global function happens to exist would
make symbolic code and round-tripping context-dependent.

The design options are:

### A. Dot is always UFCS

```cortex
x.f(a)    // f(x, a)
```

Simple, familiar, but it removes callable-field semantics and complicates
ordinary nominal/record values.

### B. Capitalized names are UFCS

```cortex
xs.Map(f) // Map(xs, f)
p.x       // field
```

This looks natural with Cortex's naming convention, but turns a convention
into semantics. A user-defined lowercase function and a capitalized field
become awkward, and the language currently promises that capitalization is not
enforced.

### C. Field wins, UFCS is fallback

Resolve `x.f(a)` as a callable field when known, otherwise as `f(x, a)`. This
is ergonomic in concrete code but poor for a symbolic language: the parse or
meaning changes with type/scope knowledge and can change after a declaration is
added.

### D. Give UFCS distinct punctuation

For example:

```cortex
xs.>Filter(pred).>Map(f)
```

This is unambiguous but loses much of the familiarity that makes UFCS
appealing.

### E. Enhance the pipe's first-argument shorthand

Allow a pipe into a call to use the piped value as an implicit first argument
when there is no explicit `_` placeholder:

```cortex
xs |> Filter(pred) |> Map(f) |> Take(10)
text |> StringSplit(",")
xs |> Reduce(combine, initial)
```

For example, the common frontend operation of deriving avatar initials would
lose its only plumbing placeholder:

```cortex
"Ada Lovelace"
  |> StringSplit
  |> Map(word |-> First(Characters(word)))
  |> StringJoin
// ➔ "AL"
```

An explicit placeholder remains available for a non-first position:

```cortex
value |> Clamp(0, _, 100)
```

This delivers most of UFCS's multi-argument benefit while preserving field
calls and keeping one left-to-right composition model. It cannot be defined as
an arity-mismatch rewrite alone:

- `Map(f)` and `Take(10)` are under-applied, so arity is enough there;
- `StringSplit(",")` is already a valid unary call, but its result is a list,
  not a function; and
- `Reduce(combine, initial)` or `Map(ys, f)` may have an admissible argument
  count while still being intended as an input-first stage.

Treat it as pipe-stage resolution. For a stage with an outermost call and no
placeholder:

```cortex
topic |> F(args...)
```

consider these two candidates without evaluating either one:

```cortex
F(args...)(topic)  // existing Pipe/Apply meaning
F(topic, args...)  // implicit input-first stage
```

Resolve them with the following rules:

1. If the stage contains a free explicit pipeline placeholder, use the explicit
   template and do no implicit insertion. Placeholders bound inside a nested
   lambda are not pipeline topics.
2. If `F(args...)` is statically callable, preserve the existing meaning. This
   keeps curried/function-producing stages working.
3. Otherwise, if prepending the topic produces one uniquely applicable
   signature arm, use `F(topic, args...)`.
4. If both meanings remain viable, or type information is too weak to decide,
   require an explicit `_` and issue a targeted ambiguity diagnostic/fix-it.
5. If neither is viable, retain the ordinary type/arity diagnostic rather than
   guessing a different argument position.

Resolution must use signatures and static types, not the evaluated value of
`F(args...)`; otherwise a stage could run twice, trigger effects while being
resolved, or change meaning with runtime state. Only the outermost call is a
candidate for insertion. The raw AST can remain `Pipe(topic, F(args...))` for
faithful parse/serialize round-tripping, with canonical/evaluation and static
typing sharing one resolver.

This rule is backward-compatible for every pipeline whose current stage is
provably callable. It intentionally gives useful meaning to some programs that
currently fail because the stage is provably non-callable. Symbolic or unknown
stages are the important compatibility boundary and should fail closed to the
explicit-placeholder form.

Acceptance cases should include:

- under-applied fixed arity: `xs |> Take(3)`;
- optional/overloaded arity: `text |> StringSplit(",")`;
- variadic collection inputs: `xs |> Map(ys, f)`;
- a function-producing stage whose existing `F(args...)(topic)` meaning wins;
- unknown and ambiguous stages that request `_` rather than guessing;
- explicit insertion in a non-first position; and
- parity across interpreter, compiler, serializer, effects, and error
  propagation.

### UFCS conclusion

UFCS is a worthwhile ergonomic candidate, not a low-value feature. Its priority
depends on the desired resolution of callable fields versus extension-method
syntax. Option E is currently the most coherent with Cortex's existing pipe and
field model and should be explored first. It has a narrower semantic footprint,
preserves `p.x(2)` as a callable field, and directly removes the placeholder
noise that motivated UFCS. True UFCS remains reasonable if callable fields are
later judged less important or a separate field-call spelling is introduced.

## Tentative sequencing

This is prioritization, not approval.

### First: coherence and safety

1. Synchronize the language definition with effects, fields, multi-clause
   parameters, and missing-data operations.
2. Enforce return contracts.
3. Make assignment-in-argument an error.
4. Fix known-operator tokenization.
5. Make unused future keywords contextual.
6. Clarify checked handling of error values.
7. Resolve full type expressions in typed patterns; this is independently
   useful and is a prerequisite for `if let`.

### Second: high-leverage surface forms over existing concepts

1. `??` for `Coalesce`, after the `Coalesce` lazy-tail fix.
2. `if let` for error-refutable binding.
3. `otherwise fallback`, after its direct-error semantics are ruled.
4. `otherwise => body` as a `match` catch-all.
5. `break` and `continue`.
6. General `return` and `otherwise return`, lowering to the engine's existing
   `Return` protocol, once their top-level behavior is ruled.
7. An `is` type-test operator (`x is integer`): a small surface form over the
   existing dynamic type test, independently useful and a prerequisite for
   flow-sensitive narrowing.
8. One comprehension syntax after eager/lazy, filter lowering, and
   collection-kind questions are settled.
9. Pipe first-argument shorthand or UFCS, after the field collision is ruled.
10. Immutable update primitives and possibly `with` syntax.

### Third: type and domain expressiveness

1. Flow-sensitive narrowing, exhaustiveness, and redundancy checking, after
   the checker-design prerequisite (statement environments and joins) and the
   `is` operator land.
2. Transparent generic type aliases, riding the type-variable plan's phase-1
   substitution machinery.
3. Generic Cortex bodies/syntax, per the type-variable plan's v2 milestones.
4. Dimension variables and repeated-shape correlation.
5. Physical-dimension types for units and quantities.
6. Inferred operation requirements plus named generic-parameter protocol
   bounds, if generic bodies need constraints beyond ground type bounds.
7. The restricted lazy higher-order/type-pack seam needed by `Map`-class
   operators.
8. Record optionality and an explicit ruling on open versus exact shapes.
9. Default, variadic, and possibly named function arguments.
10. Symbolic rewrite blocks.
11. Unit literals.
12. Deterministic parallel collection/held-expression operators.

### Later, on demonstrated demand

1. Modules/imports/exports, if Cortex becomes a multi-file language.
2. A test declaration syntax and runner.
3. Documentation-comment fidelity and richer source tooling.
4. Per-operator `async` with host capabilities, when a real asynchronous
   operator requires it.
5. User-defined generator functions only on demonstrated demand.
6. Named protocol bundles, only after repeated operation requirement sets show
   that names materially improve generic code.
7. Parameterized nominal types and recursive generic aliases.
8. Typed recoverable-error variants, only after the checked-error boundary is
   settled.

## Features not currently recommended as priorities

- General exception semantics (`throw`/`try`/`catch`): typed/refutable binding
  and `otherwise` fit the errors-as-values model better.
- String `+`: interpolation and `StringJoin` keep arithmetic unambiguous.
- Changing to zero-based indexing: disruptive and inconsistent with the engine
  and mathematical conventions.
- General macros: symbolic rewrite forms address the domain-specific need with
  a much smaller semantic surface.
- Raw threads, locks, and shared-memory synchronization: deterministic
  parallel operators and immutable values fit Cortex better.

UFCS is intentionally **not** in this declined list; it remains an open design
candidate as discussed above.
