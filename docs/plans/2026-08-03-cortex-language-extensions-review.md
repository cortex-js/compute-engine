# Cortex language extensions review

Status: **exploratory discussion note — proposals are not approved roadmap
items**

Date: 2026-08-03

Related:

- `src/cortex/docs/` — current public language definition
- `roadmap/cortex/README.md` — current Cortex backlog
- `roadmap/cortex/language-review.md` — the earlier 2026-07-05 review
- `docs/EFFECTS-MODEL.md` — function effects
- `docs/plans/2026-08-01-type-variables-design.md` — parametric polymorphism

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

## Current-definition issues

These should generally be addressed before adding much syntax.

### Return annotations are not contracts

Today this succeeds and returns `"oops"`:

```cortex
function f() -> integer { "oops" }
f()
```

Parameter annotations are enforced, but return annotations are retained only
in the signature. A visible `-> integer` should be a checked contract. Check it
at function application; if the result is definitely incompatible, produce an
`incompatible-type` error value. If compatibility is symbolically undecidable,
defer rather than reject prematurely.

### Assignment can look like an equation

The canonical trap is:

```cortex
Solve(x^2 = 4, x)
```

It can return a plausible wrong answer because `=` is `Assign`, not `Equal`.
The existing `assign-in-argument` warning should become an error with a `==`
fix-it. More generally, assignment could be restricted to a bare binding target
in statement position. Function definitions remain their own parsed form.

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
longest match.

### Too many hypothetical keywords are reserved

Names such as `set`, `get`, `with`, `where`, `to`, and `each` are unavailable
even though their proposed constructs do not exist. Future words should be
contextual wherever possible, following the precedent of `type` and `alias`.
Keep hard reservation for active keywords, literals, and only the few future
forms whose grammar genuinely cannot be contextual.

### The public definition has drifted behind the implementation

Known examples:

- effect specifiers (`function roll(n) random -> integer`) are implemented and
  tested but absent from the public syntax/types/control-flow reference;
- the formal parameter grammar omits implemented literal parameters;
- the syntax/types docs support dictionary field access (`d.key`), while the
  agent and Python guides still say never to use it;
- `Missing`, `IsMissing`, and `Coalesce` are implemented but not adequately
  surfaced in the Cortex reference; and
- parts of the effects-model status text no longer describe the implemented
  stage accurately.

The public grammar and the executable examples should be brought back to one
versioned source of truth.

### Static diagnostics and errors-as-values need a boundary rule

Cortex intentionally permits a program to inspect or rescue an `Error` value,
but `cortex check` may still report the expression that constructs the error as
a fatal static type diagnostic. The checker should distinguish an unhandled
definite error from one that is structurally dominated by an error observer or
rescue form. This does not require hiding real errors; it requires making
"errors are values" true in checked programs as well as at runtime.

## Candidate extensions

### Absence coalescing: `??`

Add an infix spelling for the existing `Coalesce` operation:

```cortex
let timeout = config.timeout ?? 30
let first = xs[1] ?? 0
```

`a ?? b` lowers to `Coalesce(a, b)`. It handles Cortex absence (`Missing` and
numeric-domain `NaN`) but does **not** swallow an `Error`. This makes the
important distinction explicit:

- `??` discharges absence;
- `otherwise` (explored below) rescues an error.

Provably absent literal indices or fields should additionally produce a static
warning even when `??` is present, unless the access is intentionally used as
an absence probe.

### Comprehensions

The initial proposal was a generator expression:

```cortex
for x in xs if p(x) yield f(x)
```

This fits the existing distinction between effectful `for x in xs { ... }`
and value-producing iteration, and naturally lowers to `Comprehension`.

An alternative worth preferring or combining with it is collection-delimited
comprehension syntax. Braces already mean sets, so a brace comprehension can
unambiguously mean a set comprehension:

```cortex
{f(x) for x in xs if p(x)}
```

After parsing the first expression, the contextual `for` distinguishes this
from an ordinary set literal. Its result should have true set semantics:
deduplicated and unordered. Since constructing a set requires deduplication,
this form is naturally eager, consistent with collection literals being
values.

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

A coherent split would be:

- collection-delimited comprehensions are eager values of the delimiter's
  collection kind; and
- `for ... yield ...` is a lazy generator/comprehension view.

It may be better to ship only one form initially, based on real notebook use.

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

This is the error-value analogue of Swift optional binding. It should test the
result value itself, not recursively reject a collection merely because one of
its elements contains an error; collection operators already define their own
error propagation/inspection boundaries.

The annotated form remains the general feature: `if let x: T = expr` succeeds
when the result inhabits `T`. The unannotated form is sugar for the particularly
important `!error` case. Tuple/record patterns could be added once the basic
rule is stable.

This requires full type expressions in typed patterns. The current simple-name
restriction prevents `!error`, unions, and parameterized collection types.

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

That is an early error-propagation operation, not a return of `Nothing`. It
therefore requires a real non-local `Return` construct and a rule for use at top
level. Possible top-level behavior is simply to make the original error the
cell's final value.

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

Reject them outside a loop. A value-carrying `break value` should wait until or
unless loops become value-producing expressions. General `return` is a separate
decision, though `otherwise return` creates new pressure to define it.

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
available. It does not introduce mutable indexed assignment. The surface can
lower to `SetAt`/`SetField`-class primitives; those library primitives are also
useful independently of the syntax.

### Parametric polymorphism

Implement the already designed rank-1 type variables and Cortex sugar:

```cortex
function first<T>(xs: list<T>) -> T { xs[1] }
function swap<T, U>(p: tuple<T, U>) -> tuple<U, T> { (p[2], p[1]) }
type pair<T> = tuple<T, T>
```

This is substantially more valuable than adding isolated type-handler special
cases. Higher-rank types, higher-kinded types, and type packs can remain out of
scope.

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

### Testing, strings, and diagnostics

Library/tooling improvements with language-level ergonomic impact:

- `Assert`, `AssertEqual`, and `cortex test`;
- `StringLength`, trim, case conversion, find, replace, and number parsing;
- effect reporting in `cortex check`;
- exhaustiveness and unreachable-pattern diagnostics; and
- eventual preservation/attachment of documentation comments for reusable
  source files.

## UFCS and the pipe operator

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

Allow a pipe into a call to insert the piped value as the first argument when
there is no explicit `_` placeholder:

```cortex
xs |> Filter(pred) |> Map(f) |> Take(10)
```

An explicit placeholder remains available for a non-first position:

```cortex
value |> Clamp(0, _, 100)
```

This delivers most of UFCS's multi-argument benefit while preserving field
calls and keeping one left-to-right composition model. It does require a clear
rule distinguishing a call template on the right of `|>` from a call that must
be evaluated before piping.

### UFCS conclusion

UFCS is a worthwhile ergonomic candidate, not a low-value feature. Its priority
depends on the desired resolution of callable fields versus extension-method
syntax. Option E is currently the most coherent with Cortex's existing pipe and
field model; true UFCS remains reasonable if callable fields are judged less
important or a separate field-call spelling is introduced.

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

### Second: high-leverage surface forms over existing concepts

1. `??` for `Coalesce`.
2. `if let` for error-refutable binding.
3. `otherwise fallback`, after its direct-error semantics are ruled.
4. `otherwise => body` as a `match` catch-all.
5. `break` and `continue`.
6. One comprehension syntax after eager/lazy and collection-kind questions are
   settled.
7. Pipe first-argument shorthand or UFCS, after the field collision is ruled.
8. Immutable update primitives and possibly `with` syntax.

### Third: type and domain expressiveness

1. Full type expressions in patterns and exhaustiveness checking.
2. Generic functions and generic declared types.
3. Default, variadic, and possibly named function arguments.
4. Symbolic rewrite blocks.
5. Unit literals.

### Later, if Cortex becomes a multi-file language

1. Modules/imports/exports.
2. A test declaration syntax and runner.
3. Documentation-comment fidelity and richer source tooling.

## Features not currently recommended as priorities

- General exception semantics (`throw`/`try`/`catch`): typed/refutable binding
  and `otherwise` fit the errors-as-values model better.
- String `+`: interpolation and `StringJoin` keep arithmetic unambiguous.
- Changing to zero-based indexing: disruptive and inconsistent with the engine
  and mathematical conventions.
- General macros: symbolic rewrite forms address the domain-specific need with
  a much smaller semantic surface.
- Concurrency/`async`: no current notebook use case justifies the runtime and
  effect-system cost.

UFCS is intentionally **not** in this declined list; it remains an open design
candidate as discussed above.
