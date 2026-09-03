---
title: Epsil Control Flow
sidebar_label: Control Flow
slug: /epsil/control-flow/
description: "Control flow in Epsil: function definitions in math and block style, conditionals, pattern matching, loops and blocks."
hide_title: true
date: Last Modified
---
# Control Flow

## Functions

A function can be defined in two forms, which mean the same thing.

The **math style** is a single expression:

```epsil
f(x) = x + 1
```

```epsil
f(x, y) = x + y
```

The **block style** wraps the body in a statement block, whose value is its
last expression:

```epsil
function f(x) { x + 1 }
```

Parameters can carry a type annotation (`f(x: real) = …`), and the block
form accepts a return-type annotation after the parameter list 
(`function f(x) -> real { … }`). Parameter types are enforced when
the function is called. Return types are retained in the function signature;
the current runtime does not validate the inferred type of every returned
value against that annotation.

```epsil
f(x: real) = x + 1
```

### Which form to use

The three spellings differ only in ergonomics, so pick by the shape of the
body:

- **Math style** (`f(x) = …`) for a formula that fits on one line. It is how
  the definition would be written on paper, and it is the right default for
  mathematical code.
- **Block style** (`function f(x) { … }`) once the body needs more than an
  expression — a local `let`, a `match`, a loop. It is also the only form that
  carries a name *and* a multi-statement body.
- **Anonymous** (`x => …`) when the function is an argument to another
  function and a name would add nothing: `Map(x => x^2, xs)`.

An anonymous function can have a multi-statement body too, by making that body
a [`do` block](#do-block-expressions) — but at that point a named `function` is
usually clearer.

### Effect specifiers

A definition can state the effects that calling it may perform. The specifier
sits after the parameter list and before the return arrow:

```epsil
function roll(n) random -> integer { Random(n) }
```

The ten effect labels are `console`, `entropy`, `environment`, `fs_read`,
`fs_write`, `network`, `random`, `scope`, `state`, and `time`. Several
labels may be listed with spaces. `pure` explicitly promises no effects; `any` means the
effects are unknown. `pure` and `any` must appear alone.

Without a specifier, effects are inferred from the body and may change when
the definition is replaced. A written specifier is a contract: the body's
inferred effects must be a subset of it. A pure body may satisfy a broader
contract, but a body that performs an undeclared effect is rejected.

The block form may omit the return annotation (`function f() random { … }`),
in which case its declared result is `unknown`. In the math form, a written
effect specifier must be followed by a return arrow:

```epsil
roll(n) random -> integer = Random(n)
```

See [Effect Specifiers](/compute-engine/guides/types/#effect-specifiers) for
subtyping, callback checks, and the distinction between inferred and declared
effects.

### Multiple clauses (literal parameters)

A parameter can be a **literal** — a number, string, boolean, `Infinity`,
`-Infinity`, or `NaN` (the spellings that are literals in expression
position; `oo` is an input alias for `Infinity`. A constant *name* like
`Pi` is a symbol and stays a parameter name — writing `f(Pi) = …` binds a
parameter named `Pi` and draws an advisory `parameter-shadows-constant`
diagnostic). Definition statements **accumulate**: defining the same name again
with a different parameter list adds a *clause* rather than replacing the
function, and a call dispatches to the most specific clause that matches
its arguments (declaration order only breaks ties between equally specific
clauses). A non-finite literal clause matches only itself — `f(NaN) = 0`
handles exactly `NaN`; a `f(x: real)` clause never captures it:

```epsil
f(NaN) = 0
f(Infinity) = 1
f(x: number) = x + 1
f(Infinity) + f(NaN)
// ➔ 1
```

```epsil
fib(0) = 0
fib(1) = 1
fib(n: integer) = fib(n - 1) + fib(n - 2)
fib(10)
// ➔ 55
```

Redefining a clause with the *same* parameter list replaces just that
clause — so re-running an edited definition behaves as expected. A plain
assignment (`f = x => …`) still replaces the whole binding, clauses and
all.

A literal parameter behaves as an anonymous parameter constrained to that exact
value — the clause is selected only when the argument *is* that value.

If no clause matches the evaluated arguments, the call is a
`no-matching-clause` error. To inspect the clause set of a function, use
`About`:

```epsil
f(0) = 1
f(n: integer) = n + 1
About(f)
```

The listing shows one line per clause, in declaration order, and annotates
clauses that overlap an earlier one of equal specificity as well as clauses
made unreachable by more specific ones covering their whole (finite)
domain.

### Hold functions

By default a call **evaluates its arguments first**, and the function sees
their values: with `let a = 3`, `f(a + 1)` receives `4`. A function that
needs to see what the caller *wrote* — the expression `a + 1`, to inspect it,
transform it, serialize it, or decide whether to evaluate it at all — is
declared with the `hold` prefix, in either form:

```epsil
hold f(e) = Head(e)
hold function twice(e) { let v = e; v + v }
```

In a hold function every parameter is bound to its argument **as written**
(canonicalized and bound in the caller's scope, but not evaluated — so
`f(1 + 1)` receives the canonical `2`, while `f(a + 1)` receives `a + 1`).
Reading
the parameter in an ordinary position evaluates the argument *there*, so
`hold twice(e) = e + e` computes `e` on each read (call-by-name); read it
once into a local — `let v = e` — to evaluate once. A structural operator sees
the expression itself:

```epsil
let a = 3
hold f(e) = Head(e)
f(a + 1)
// ➔ Add          (an ordinary function would answer Integer: it receives 4)
```

Because the argument is never evaluated by the call, a hold function can
decide whether it runs at all — here `Random()` draws only when the
condition is false:

```epsil
hold unless(cond, body) = if !cond { body } else { Nothing }
unless(a > 5, Random())
```

`hold` applies to the **whole definition** — every parameter is held — and
it maps to the engine's `lazy` operator flag: the definition is installed as
a `lazy` operator, and `DefineFunction` carries it as the attribute
`{hold: True}`. Three consequences:

- A hold function is **single-clause**: a literal parameter selects a clause
  by an argument's *value*, which a hold function never has, so
  `hold f(0) = …` is refused (`hold-literal-parameter`), and a second clause
  of a hold function — hold or not — at a different parameter list is refused
  (`hold-single-clause`). Redefining the lone clause replaces it as usual.
- Parameter types are checked against the **argument expression's** type
  (`hold k(e: integer) = …` admits `k(n + 1)` and refuses `k("s")`).
- The effects of an argument are the caller's business: they contribute to
  the call exactly as they would under an ordinary function, since the body
  may evaluate the argument.

`hold` is a contextual keyword, like `type`: it claims a statement only as
the prefix of a function definition, and stays a legal identifier everywhere
else (`let hold = 5`, `hold(2)`). Anonymous functions have no hold form.

### Bound-variable parameters: `bind`

A hold function can define its own **binder** — an operator like `Sum` or
`D` that takes a variable to bind. Mark the parameter that receives the
variable with `bind`:

```epsil
hold mySum(body, bind i, n) = Sum(body, (i, 1, n))
mySum(k^2, k, 3)
// ➔ 14
```

The caller passes a **symbol** at a `bind` position (anything else is a
`bind-symbol-expected` error), and the function's parameter is *substituted*
by that symbol throughout the body — including where the body's own binder
uses it, so `Sum(body, (i, 1, n))` becomes `Sum(k^2, (k, 1, 3))` and the
sum runs over the caller's `k`. The call declares that symbol in its own
scope, exactly as `Sum` does with its index: a `let k = 5` outside the call
does not leak in, and `mySum(k * j, j, 3)` with `k = 5` is `30`. `bind` is
contextual (`f(bind) = …` declares an ordinary parameter named `bind`) and
requires `hold` (`bind-requires-hold`): a bound variable can only be received
unevaluated. Every parameter of the function is held; `bind` says which of
them names a variable.

The substitution is by **name**, and deliberately reaches inside the body's
own binders (that is what ties `Sum`'s index to the caller's variable), so it
also reaches any *other* use of that name in the body: do not reuse a `bind`
parameter's name for an unrelated local or index inside the same function.

### Algebraic properties

A user-defined operator can declare the algebraic properties the engine
uses when it canonicalizes a call, in the same slot as the effect specifier:

```epsil
function op(a, b) commutative associative -> number { a + b + 1 }
op(2, op(1, 3))     // ➔ 8 — sorted, flattened to op(1, 2, 3), folded pairwise
conj(z) involution -> number = -z
conj(conj(w))       // ➔ w
```

- **`commutative`** — the operands of a call are sorted into canonical order.
- **`associative`** — nested calls flatten (`op(a, op(b, c))` is `op(a, b,
  c)`); the function is written binary and a longer call is folded from the
  left, `op(op(a, b), c)`.
- **`idempotent`** — `f(f(x))` is `f(x)`.
- **`involution`** — `f(f(x))` is `x`.

The words are contracts, not checks: declaring `commutative` on a body that
is not commutative gives whatever the canonical order produces. In the math
form the slot must be followed by a return arrow (`op(a, b) commutative ->
number = …`), like an effect specifier. `commutative`/`associative` need at
least two parameters (`associative` exactly two), `idempotent`/`involution`
exactly one; a `hold` function cannot carry them (its calls are neither
reordered nor flattened); every clause of a multi-clause function must state
the same ones. `About(op)` lists them.

### Documenting a function

A **doc comment** — `///` lines or a `/** … */` block — written immediately
before a definition becomes the function's *description*: it is shown by
`About(f)`, by an editor hover, and it is the one comment that survives a
serialization round trip (it comes back as `///` lines). Ordinary `//`
comments are not attached.

```epsil
/// Doubles its argument.
/// Accepts anything `*` accepts.
twice(x) = 2x
About(twice)
```

### Anonymous functions

An anonymous function uses the ASCII mapsto arrow `=>` (`⇒` in fancy-symbol
output, and `↦` is accepted as input too);
`->` itself is taken by `KeyValuePair` and by function types in annotations,
so the two arrows never collide. The same `=>` separates a `match` case from
its body — one arrow, meaning "yields", in both places (see
[Guards](#guards)):

```epsil
x => x + 1
```

```epsil
(x, y) => x + y
```

A mapsto binds loosely enough to sit on the right-hand side of an
assignment:

```epsil
f = x => x + 1
```

A lambda can take **no** parameters — an empty parameter list `()` before the
arrow:

```epsil
() => 42
```

Writing `->` where a function was meant — `(x, y) -> x + y`,
`(n: integer) -> n^2` — is a diagnosed typo: the parser suggests `=>` with a
fixit and recovers as the intended function, so the program still runs. And
when a declaration's annotation is a function type with named parameters, the
lambda can be omitted entirely — `const f : (x: number) -> number = x^2 + 1`
binds `x` from the annotation. See
[Function-type annotations](/epsil/declarations/#function-type-annotations-bind-their-parameter-names).

## `if` / `else` {#if-else}

`if`/`else` is an **expression**, not a statement — it evaluates to a value:

```epsil
if x > 0 { 1 } else { 2 }
```

The `else` branch is optional:

```epsil
if x > 0 { 1 }
```

`else if` chains nest, so an `if` in `else` position is just another
conditional:

```epsil
if x > 0 { 1 } else if x < 0 { 2 } else { 3 }
```

A `{ }` block's value is its last expression — the same block semantics
as a multi-statement program (see [Blocks](#blocks) below).

### The conditional expression `a if c else b`

When both branches are single expressions, the braces are noise. The
conditional form spells the same conditional without them:

```epsil
let x = 5
10 if x > 3 else 20
// ➔ 10
```

It is the *same* conditional as `if`/`else` — only the branches differ: plain
expressions instead of blocks, so it introduces no scope and no statement can
appear in a branch.

Three rules follow from where it sits in the grammar:

**The `else` is required.** It is what ends the condition, and a missing branch
would leave the false case with no value to name. `1 if c` is an error; use the
block form (`if c { 1 }`) when there is nothing to return.

**It binds looser than every operator that computes, but tighter than the four
that bind or pair — `=`, `=>`, `|>` and `->`.** So the whole conditional is the
right-hand side of an assignment, the body of a function, or the value of a
dictionary entry, and no parentheses are needed around a comparison:

```epsil
let scale = 2
let tag = n => "big" if n * scale > 10 else "small"
tag(6)
// ➔ "big"
```

```epsil
let n = 7
{ "value" -> n, "parity" -> "odd" if n % 2 == 1 else "even" }
// ➔ {"value" -> 7, "parity" -> "odd"}
```

Going the other way — a conditional used as an operand — does need
parentheses, since `1 if c else 2 + 3` reads as `1 if c else (2 + 3)`:

```epsil
(10 if 3 > 0 else 20) + 5
// ➔ 15
```

**Chains nest to the right,** so there is no `else if` spelling to learn:

```epsil
let n = 0
"zero" if n == 0 else "negative" if n < 0 else "positive"
// ➔ "zero"
```

One layout rule: the `if` must be on the **same line** as the value before it.
A line break separates statements, so an `if` that starts a line always begins
a new `if`-statement, never a continuation of the line above.

## `match`

`match` is an **expression** that inspects the structure of a subject against
a sequence of `pattern => body` cases and evaluates to the body of the first
matching case:

```epsil
match x {
  0 => "zero"
  _ => "other"
}
```

Unlike `if`/`Which`, `match` is **structural** and **total**: it always
selects a case, it never stays inert. A literal pattern (`0`) matches
structurally, and `_` is the anonymous wildcard, matching anything — with a
symbolic (unbound) `x` as the subject above, `match` selects the `_` case: `x`
is structurally not `0`, even though it *could* be zero semantically. Use
`if`/`Which` when you want that kind of semantic case-split instead.

A list pattern matches a list *value* whatever produced it: `Rest(xs)`,
`Drop(xs, 1)` or `Range(1, 3)` evaluate to a lazy collection rather than a
list literal, and the case holding the list pattern reads it as a list —
element by element for the positions the pattern names, with a copy only for
a named `...rest`. (A lazy list of more than 100 000 elements is left as it
is, and then matches only the wildcard.)

The final catch-all may also be spelled `otherwise`, a synonym for a bare
`_` pattern (it takes a guard the same way, and binds nothing):

```epsil
match x {
  0 => "zero"
  otherwise => "other"
}
```

`otherwise` is contextual, not reserved: it means the wildcard only when it
is the entire pattern of a case. Anywhere else — including inside a
structured pattern like `[otherwise, 2]` — it is an ordinary identifier, and
a bare identifier in a nested pattern position *binds* (next section).

### Bindings

A bare identifier in pattern position **binds** a new variable to the value
at that position — for *any* name, including ones that happen to name an
engine constant (`e`, `i`, `Pi`). A pattern is parsed as an ordinary
expression first, so this applies inside nested patterns too:

```epsil
match p {
  (x, e) => x + e
}
```

Matching `(2, 7)` against this case binds `x` to `2` and `e` to `7` — the
body's `e` is the captured value, not `ExponentialE`. Because a bare binding
matches unconditionally, a *non-final* case consisting of just a binding (or
`_`) makes every case after it unreachable; this is flagged as a
`match-irrefutable-case` diagnostic (a final catch-all is expected and not
flagged):

<!-- epsil-test: expect-diagnostics -->

```epsil
match x {
  Pi => 1
  0 => 2
}
```

This does **not** match the constant π — `Pi` in pattern position binds a new
variable named `Pi`, shadowing the constant, and the diagnostic is the safety
net for that: it fires because the `Pi => 1` case is non-final and matches
anything, not because `Pi` is a reserved name. To test against the value of
the constant, use a pin.

### Pins

`== expr` matches the subject against the **value** of `expr`, evaluated in
the enclosing scope — this is how to test a symbolic constant or a runtime
variable, since a bare identifier always binds instead:

```epsil
match x {
  == Pi => "is-pi"
  _ => "no"
}
```

```epsil
match x {
  == limit => 1
  _ => 0
}
```

A pin is resolved at match time, and a pinned name may equally be a constant or
a runtime variable — the parser cannot tell the two apart lexically, and does
not need to. A pin of a *literal* (`== 5`) simply matches structurally, the
same as writing the literal directly; `Infinity`/`NaN` are numeric literals in
Epsil, so `== Infinity` is a literal pin too, with no binding trap to avoid.

### Or-alternatives

`p₁ | p₂ | …` at the **top level** of a case pattern matches if any
alternative matches; a guard, if present, applies after whichever alternative
matched:

```epsil
match x {
  1 | 2 | == Pi => "small"
  _ => "big"
}
```

Alternatives must be **binding-free** — `_` is fine (`[0, _] | [_, 0]`), but a
named binding inside an alternative (`a | 2 => …`) is a
`match-alternative-binding` diagnostic, since there is no single value for
the body to bind `a` to when the alternatives disagree on shape.

### Range patterns

`lo..hi` in pattern position is an **inclusive numeric membership test**: the
case is selected when the subject is a real number or an infinity and
`lo ≤ subject ≤ hi`.
The call spelling `Range(lo, hi)` means exactly the same thing — the pattern
form keys on the operator, not on how it was written:

```epsil
match x {
  0..9 => "digit"
  10..99 => "two digits"
  _ => "big"
}
```

Both endpoints are included, and they are compared with the same tolerance
`match` uses for every other number leaf, so a subject a hair outside an
endpoint still selects the case. Only a number **on the real line** matches: a
symbol, a collection, a string, a complex number with a nonzero imaginary part
and `NaN` all fall through to the next case.

Bounds must be **numeric literals** — negated literals and `Infinity` /
`-Infinity` included, so `0..Infinity` reads as "any nonnegative number":

```epsil
match x {
  0..Infinity => "nonnegative"
  _ => "negative"
}
```

A bound that is a bare identifier (which would otherwise *bind*, like any
identifier in pattern position), a computed expression, or `NaN` is a
`range-pattern-bounds` diagnostic; a stepped range is a `range-pattern-step`
diagnostic; and a range whose lower bound exceeds its upper bound is a
`range-pattern-empty` diagnostic (that case can never match). Use a guard when
a bound is not a literal:

<!-- epsil-test: expect-diagnostics -->

```epsil
match x {
  0..limit => "in"
  _ => "out"
}
```

Write instead:

```epsil
match x {
  n if n >= 0 && n <= limit => "in"
  _ => "out"
}
```

A range pattern binds nothing, so it is legal inside an or-alternative, and a
guard on a range case can only reference names from the enclosing scope:

```epsil
match x {
  0..9 | 100..109 => "in"
  _ => "out"
}
```

Two consequences worth knowing. First, this is a **carve-out**: a `Range`
*value* can no longer be matched structurally in pattern position — write
`== Range(1, 10)` (a pin) to compare against the range value itself. Second,
a range nested inside a list, tuple or dictionary pattern keeps its ordinary
structural meaning; membership applies at the top level of a case pattern (or
of an or-alternative). A `Range` whose bounds are not literals is likewise
still an ordinary structural pattern.

Because a run of operator characters lexes as one token, a **negative upper
bound needs a space**: write `0 .. -1`, not `0..-1` (the same maximal-munch
rule that makes `3! ^ 2` require its space). The formatter always spaces `..`
in pattern position for this reason.

### Guards

`pattern if guard => body` adds a boolean condition, checked after the
pattern matches and after its bindings are in scope:

```epsil
match n {
  n if n > 3 => "big"
  _ => "small"
}
```

If the guard is undecidable for a symbolic subject, the case falls through to
the next one — consistent with `match`'s totality, a guard never leaves the
whole expression inert.

The case arrow `=>` is the same arrow that builds an anonymous function, so a
guard ends at the first `=>` written at the case's own level: in
`n if valid => n` the guard is `valid` and the body is `n`, never the lambda
`valid => n`. A lambda genuinely wanted in a pattern or a guard is
parenthesized — `n if (f => f)(n) => n` — which costs nothing, since a bare
lambda as a guard is a function value and therefore always true. A case BODY
has no such restriction: `0 => x => x + 1` is a case whose result is a lambda.

### Destructuring

List, tuple, and dictionary patterns decompose the subject and bind their
elements:

```epsil
match xs {
  [first, ...rest] => first
}
```

```epsil
match p {
  (x, y) => x
}
```

```epsil
match p {
  {x -> px, y -> py} => px + py
}
```

`...rest` (or bare `...`) captures the remaining elements of a list pattern;
at most one rest is allowed per pattern — a second one is a
`match-multiple-rest` diagnostic.

Dictionary pattern keys are literal (not patternized); the values are full
patterns — bindings, literals, pins, or nested shapes. Dictionary matching is
**open**: a case matches when the subject is a dictionary that has *at least*
the named keys, each with a matching value; extra subject keys are ignored. A
subject missing any named key falls through to the next case. So

```epsil
match {x -> 3, y -> 4, z -> 5} {
  {x -> px, y -> py} => px + py
  _ => 0
}
```

binds `px = 3` and `py = 4` (the extra `z` key is ignored) and evaluates to
`7`.

### Typed bindings

`name: type` binds like a bare identifier, plus an implicit type guard,
conjoined with any explicit guard:

```epsil
match n {
  n: integer if n > 0 => "positive integer"
  _ => "other"
}
```

### Algebraic patterns

Because a pattern is parsed as an ordinary expression, matching on operator
structure comes for free — a pattern like `a + b` dispatches on the addition
operator and captures its operands, with the same commutative matching the
rule system already uses for sums and products:

```epsil
match z {
  a + b if a > 0 => a
  _ => 0
}
```

This is symbolic destructuring, evaluated by the engine's general pattern
matcher — it works when evaluating a `match` expression, but such patterns
are not supported by `compile()`; compiling a `match` with an operator
pattern fails closed, naming the offending pattern in the error.

### No match

If no case matches, `match` evaluates to an `Error` value tagged
`'match-no-case'` carrying the subject, rather than throwing or silently
producing `Nothing` — errors are ordinary values in Epsil (see
[Evaluation](/epsil/evaluation/)):

```epsil
match 3 {
  0 => "zero"
}
```

Evaluating this expression yields `Error("match-no-case", 3)`.

### `if let` {#if-let}

When one case is what matters and everything else is the fallback, `if let`
spells the test as a conditional. The pattern is any `match` pattern; the
block runs with the pattern's bindings in scope when the subject matches, and
the `else` branch — optional, and chainable with `else if` — when it does not:

```epsil-live
let point = (2, 5)
if let (x, y) = point { x * y } else { 0 }
// ➔ 10
```

It is sugar over `match`: the statement above is
`match point { (x, y) => do { x * y }; _ => do { 0 } }`, and the two forms
lower to the same expression. Without an `else`, a subject that does not
match evaluates to `Missing`, as a false `if` without an `else` does.

The form earns its keep with a typed binding, which is how a result that may
have failed is taken apart without a `match` block:

```epsil-live
function head(xs: list) {
  match xs {
    [h, ...] => h
  }
}
if let h: !error = head([]) { h } else { "empty" }
// ➔ "empty"
```

`head([])` has no matching case, so it evaluates to a `match-no-case` error
value; the typed binding `h: !error` refuses it and the `else` branch runs.
With `head([4, 5])`, `4` binds to `h`. The same test reads absence:
`if let v: !missing = First(xs) { … }` binds `v` only when the list has a
first element.

`if let` chains with `else if` in either direction, and a plain `if` can
follow an `if let`:

```epsil-live
let v = [1]
if let [] = v { "empty" } else if let [x] = v { x } else { "many" }
// ➔ 1
```

A pattern that cannot fail — a bare name or `_` with no type — makes the
`else` branch dead code; that is what `let` is for, and it is reported as an
`if-let-irrefutable` warning. There is no guard slot: to test a condition on
the bound values, nest an `if` in the block. Bindings are scoped to the
block, as in a `match` case.

### `if`, `a if c else b`, or `match`? {#choosing-a-conditional}

All three produce a value, so the choice is about what you are branching *on*.

Branch on a **condition** — something that is true or false — with `if`. Use
the block form when a branch needs more than one statement, and the
[conditional expression](#the-conditional-expression-a-if-c-else-b) when both
branches are single expressions and the braces are just noise:

```epsil-live
let n = -3
"negative" if n < 0 else "zero" if n == 0 else "positive"
// ➔ "negative"
```

Branch on the **shape** of a value — how it is built, and what is inside it —
with `match`. It tests structure and binds the pieces in the same step, which
an `if` chain cannot do without taking the value apart by hand:

```epsil-live
let v = [1, 2]
match v {
  [] => "empty"
  [x] => "one item"
  [_, ...] => "several items"
}
// ➔ "several items"
```

When only one shape matters — a non-empty list, a value that is not an
error — [`if let`](#if-let) tests it as a conditional, and the `else` takes
everything else.

Two differences are worth remembering when the subject may be symbolic.
`match` is **structural**: a symbolic `x` is not `0`, even though it might turn
out to be zero, so it takes the wildcard case. And `match` is **total**: it
always selects a case (or returns a `match-no-case` error), where an `if` on an
undecidable condition can stay inert. When you want the semantic question —
"is this actually zero?" — use `if`.

## Loops

There is one loop keyword form for each of the two common shapes. Both are
evaluated **for effect**, not for their value — a loop's value is `Nothing`.
Value-producing iteration over a collection belongs to the library functions
`Map`/`Filter`/`Reduce`, not to a loop statement.

`while cond { … }` repeats its body until the condition becomes false:

```epsil
while x > 0 { x }
```

`while let pattern = subject { … }` is the loop form of [`if let`](#if-let):
each turn matches the subject against the pattern and runs the body with the
pattern's bindings in scope, and the first turn on which the subject does not
match ends the loop. It consumes a list one element at a time:

```epsil-live
let xs = [1, 2, 3]
let s = 0
while let [h, ...t] = xs { s = s + h; xs = [t] }
s
// ➔ 6
```

The pattern is any `match` pattern, so a typed binding drains a function that
may fail: `while let h: !error = head(xs) { … }` runs while `head(xs)` is not
an error value. `break` and `continue` in the body apply to this loop. It is
sugar over `while` and `match`: the loop above is
`while true { match xs { [h, ...t] => do { s = s + h; xs = [t] }; _ => do { break } } }`,
and the two forms lower to the same expression. A pattern that cannot fail —
a bare name or `_` with no type — makes the loop end only on a `break`; that
is `while true` with a `let` in the body, and it is reported as a
`while-let-irrefutable` warning.

`for x in xs { … }` binds the loop variable to each element in turn:

```epsil
for x in xs { x }
```

The loop variable may be a **tuple pattern**, using the same grammar as
[`let (a, b) = v`](/epsil/declarations/#destructuring-declarations) — bare
names, `_` to skip a position, nested `(…)` patterns:

```epsil
let s = 0
for (p, q) in [(1, 2), (3, 4)] { s = s + p * q }
s
// ➔ 14
```

Each element must be a tuple of the pattern's shape; one that is not stops
the loop with the `incompatible-type` error value as its result, the same one
the destructuring `let` produces.

`in` is contextual: only the loop-variable `in` introduces the iterator
clause. A second, later `in` in the collection expression is still the
ordinary membership operator, so `for x in a in b { … }` iterates over the
value of `a in b`:

```epsil
for x in a in b { x }
```

## Pipelines

`x |> f` means exactly `f(x)`. For a single call that is a wash — `Sqrt(2)`
says it better than `2 |> Sqrt`. What the pipe buys you is **reading order**
once several transformations are applied one after another.

Here is the same computation — keep the passing scores, curve them, take the
average — written three ways.

Nested calls:

```epsil-live
let scores = [88, 42, 95, 61, 73]
Mean(Map(s => s + 5, Filter(scores, s => s >= 60)))
// ➔ 337/4
```

Named intermediates:

```epsil-live
let scores = [88, 42, 95, 61, 73]
let passing = Filter(scores, s => s >= 60)
let curved = Map(s => s + 5, passing)
Mean(curved)
// ➔ 337/4
```

A pipeline:

```epsil-live
[88, 42, 95, 61, 73] |> Filter(s => s >= 60) |> s => s + 5 |> Mean
// ➔ 337/4
```

All three compute the same value. They differ in what the reader has to do.
The nested form is written **inside-out**: to follow it you find `scores` in
the middle and unwind outward, discovering only at the end that the last step
is an average. The pipeline is written in the order the steps happen, and the
subject comes first. The `let` version reads in that order too, at the price of
naming two values that exist only to be handed to the next line.

### The placeholder `_` {#pipe-placeholder}

A stage that needs only the piped value is named bare:

```epsil-live
16 |> Sqrt |> N
// ➔ 4
```

A stage that takes **more than one** argument is written as a call, with `_`
marking the slot the piped value fills. It does not have to be the first
argument:

```epsil-live
[3, 1, 2] |> Sort |> Take(_, 2)
// ➔ [1, 2]
```

The `_` may be left out entirely: a call that is missing required arguments
receives the piped value in the first slot its type fits — first for a
collection piped into `Take(3)`, second for one piped into the
callback-first `Map(f)` — so these are the same pipeline:

```epsil
[1, 2, 3] |> Map(n => n^2, _)      // [1, 4, 9]
[1, 2, 3] |> Map(n => n^2)         // [1, 4, 9] — implicit argument
```

The implicit argument only fills a hole. A call that is already complete is
never rewritten: `xs |> f(y)` applies the *value* of `f(y)` to `xs`, exactly
as if the pipe were not there.

A one-parameter **lambda** stage over a collection is applied to each
element (an implicit `Map`), so the pipeline above can shed its `Map`
entirely — `[1, 2, 3] |> n => n^2` and `[1, 2, 3] |> _^2` also produce
`[1, 4, 9]`. See [the pipe operator](/epsil/operators/#pipe) for the exact
rules.

### Choosing between a pipeline and a nested call

Reach for a pipeline when:

- there are **three or more** steps, and
- each step consumes the whole result of the one before it, and
- the intermediate values have no name worth inventing.

Prefer a nested call when the expression is **mathematical** rather than a
sequence of stages. `Sqrt(1 + x^2)` is how the formula is written on paper;
`1 + x^2 |> Sqrt` is the same value spelled worse. One or two calls rarely
benefit either way — `Mean(xs)` needs no pipe.

Prefer named intermediates when a value is **used twice**, deserves a name that
explains what it is, or is worth inspecting while you develop. A pipeline is a
straight line: it cannot fork, so the moment a result feeds two places, give it
a `let`.

### Precedence

`|>` sits at the loosest tier of all the computing operators, so a stage may be
an arbitrary arithmetic or boolean expression without parentheses, and a
pipeline is the whole right-hand side of an assignment:

```epsil
a + b |> f        // (a + b) |> f
a || b |> f       // (a || b) |> f
x = a |> f        // x = (a |> f)
```

It is left-associative, so `a |> f |> g` is `g(f(a))`, which is what reading it
left to right suggests. `~>` is an alias for `|>`; the two are the same
operator, and a program written back out uses `|>`. See
[Operators](/epsil/operators/#pipe) for the table entry.

## Blocks

A `{ … }` that immediately follows a keyword (`function`/`if`/`else`/
`while`/`for`) is a **statement block**, and is distinct from the `{ … }`
**collection** grammar (set/dictionary literals). A bare `{ … }` with no
introducing keyword is always the collection grammar, so `{ 1, 2 }` on its own
is a set.

Each block pushes its own lexical scope. A block's value is its last
expression; an empty block's value is `Nothing`:

```epsil
if a { }
```

Statements inside a block are separated the same way as top-level
statements — a linebreak or a `;`:

```epsil
if a { 1; 2; 3 }
```

Blocks nest freely:

```epsil
if a { if b { 1 } }
```

### `do { … }` block expressions {#do-block-expressions}

To use a statement block **in expression position** — where a bare `{ … }`
would be the collection grammar — prefix it with `do`. `do { … }` opens a
statement block usable anywhere an expression can appear: a lambda body, an
assignment right-hand side, a function argument. Its value is its last
statement, and it pushes its own lexical scope, exactly like a keyword-led
block:

```epsil
let y = do { let t = 3; t + 1 }
```

Because a lambda body is an ordinary expression, `x => do { … }` gives a
lambda the same multi-statement body a named `function` has — so a closure
whose body runs several statements is written with `do`:

```epsil
counter => do { counter = counter + 1; counter }
```

A `do` **not** followed by `{` is an `opening-bracket-expected` diagnostic.

## `break` and `continue`

`break` leaves the innermost enclosing loop; `continue` skips to its next
iteration.

```epsil
for x in [1, 2, 3, 4] {
  if x > 3 { break }
  if x == 2 { continue }
  f(x)
}
```

They are valid anywhere inside a loop body — directly, or nested in an `if`, a
`match` case, or a `do` block:

```epsil
for x in xs {
  match x {
    0 => continue
    _ => f(x)
  }
}
```

Outside a loop they are a `control-outside-loop` diagnostic:

<!-- epsil-test: expect-diagnostics -->

```epsil
if x > 1 { break }
```

The loop context **resets at every function and lambda boundary**. A `break`
written inside a function or lambda defined in a loop body does not target
that loop — it is outside a loop, and diagnosed:

<!-- epsil-test: expect-diagnostics -->

```epsil
for x in xs {
  function h() { break }
}
```

This boundary is not a style rule; it follows from how the engine propagates a
break out of a block (see
[Loops and control transfer](/epsil/implementation/#loops-and-control-transfer)).

Only the value-less forms are surface syntax. A break that makes the loop
evaluate to a value has no Epsil spelling yet; it is bundled with the ruling on
a general `return`. Serialized back, `break` and `continue` appear in their
call form (`Break()`, `Continue()`), like the loop they belong to.

## `return`

`return` is **not implemented**: Epsil's expression-oriented style (an `if` is
a value, a block's value is its last expression) doesn't need an explicit
`return` yet. It is listed among the words the language reserves the right to
claim later, but nothing claims it today — so `return` is an ordinary
identifier and carries no control-flow meaning at all, rather than producing a
diagnostic. Prefer not to use it as a name.
