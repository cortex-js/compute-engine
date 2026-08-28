---
title: Epsil Types
sidebar_label: Types
slug: /epsil/types/
description: "Types in Epsil: what a type is, when to annotate and when to let inference work, declaring named types and aliases, generics, and absence values."
hide_title: true
date: Last Modified
---
# Types

A **type** is what Epsil knows about a value before it computes with it: that
`3` is an integer, that `[1, 2, 3]` is a list of three integers, that `f` takes
a real and returns a real.

You get three things out of that knowledge, and they are the reason to care
about types at all:

- **Mistakes are caught where you made them.** A function that declares
  `mass: real` rejects a string at the call, instead of producing a puzzling
  symbolic result twenty lines later.
- **The right code runs.** Types choose between the clauses of a multi-clause
  function, and let the engine pick an exact algorithm for an integer where it
  would need a numeric one for a float.
- **Your intent is written down.** A signature is documentation that cannot go
  stale.

Types come from the [Compute Engine type language](/compute-engine/guides/types/),
so anything expressible there — unions, intersections, tuples, records,
function signatures, generic collections — can be written in an Epsil
annotation. This page is about using them.

## Every value already has a type

You never have to introduce types into a program: they are there from the
start. `Type` reports the one a value has. For a number literal that is the
most precise claim there is — the value itself:

```epsil-live
(Type(42), Type(2.5), Type("hi"), Type(True))
// ➔ (TypeFrom("42"), TypeFrom("2.5"), TypeFrom("string"), TypeFrom("boolean"))
```

A literal type sits inside its numeric tier — `42` is an `integer`, `2.5` a
`real` — so a literal is accepted anywhere its tier is. An exact value no
machine number holds — `1/3`, `√2`, an astronomically large integer — is
typed by the narrowest safe claim instead: its tier plus its sign (for
example `Type(1/3)` reports a positive-rational type). And anything
*stored* carries the tier: `let n = 42` declares `n: integer`, and the
`radius` example below infers `real`.

Collections carry the type of what is in them, and how many:

```epsil-live
(Type([1, 2, 3]), Type({1, 2}), Type((1, "a")), Type({x -> 1}))
// ➔ (TypeFrom("vector<integer^3>"), TypeFrom("set<integer>"), TypeFrom("tuple<integer, string>"), TypeFrom("record{x: integer}"))
```

Numeric types form a tower — `integer ⊂ rational ⊂ real ⊂ complex ⊂ number` —
and a value of a narrower type is accepted wherever a wider one is expected,
with no conversion and no cast. An `integer` *is* a `real`, so a function
declared `f(x: real)` takes `3` happily.

## When to write an annotation

**The default is not to.** Epsil infers the type of anything you declare, and
for a value used near where it is defined the inferred type is the one you
would have written:

```epsil-live
let radius = 2.5
let area = Pi * radius^2
Type(area)
// ➔ TypeFrom("real")
```

Writing `let radius: real = 2.5` adds a word and no information — the
initializer already said it. Reach for an annotation in the five situations
where it does something.

### 1. On the parameters of a function others will call

This is the one that pays for itself. A parameter annotation is **enforced at
every call**, so a wrong argument is reported at the boundary, naming both
types:

```epsil
function bmi(mass: real, height: real) -> real { mass / height^2 }
bmi("70", 1.8)
```

That call evaluates to `Error(ErrorCode("incompatible-type", "real",
"string"))` — an [error value](/epsil/evaluation/#errors-are-values) pointing
at the call site. Without the annotation the string would have flowed into the
division and come back as something symbolic and mystifying.

A **return** annotation (`-> real`) is a different kind of thing: it is
recorded in the function's signature and shown by `About`, but the current
runtime does not reject a returned value for disagreeing with it. Write it for
the reader; don't rely on it as a check.

### 2. To choose between clauses

When a function has several clauses, parameter types are how a call finds the
right one:

```epsil-live
describe(x: integer) = "an integer"
describe(x: string) = "a string"
describe(x: list) = "a list"
(describe(3), describe("a"), describe([1, 2]))
// ➔ ("an integer", "a string", "a list")
```

See [Multiple clauses](/epsil/control-flow/#multiple-clauses-literal-parameters)
for how the most specific clause is selected.

### 3. To hold a mutable binding to a contract

An annotation on a `let` constrains not just the initial value but every later
write to that name. This is how to say "this counter stays an integer":

```epsil
let count: integer = 0
count = 2.5
```

The assignment produces an `incompatible-type` error value and `count` keeps
its old value. Without the annotation, assigning `2.5` simply widens the
binding to a real — inference follows the values, and asks no questions.

### 4. When there is nothing to infer from

An empty collection says nothing about what will go into it, so inference
starts at the bottom of the lattice:

```epsil-live
let xs = []
Type(xs)
// ➔ TypeFrom("list<never>")
```

Say what you mean instead:

```epsil-live
let xs: list<integer> = []
Type(xs)
// ➔ TypeFrom("list<integer>")
```

The same applies to a name declared without an initializer (`let x: real`) and
to a function parameter that the body never constrains.

### 5. When the inferred type is not what you meant

Inference is a guess from evidence, and a guess can be narrower or wider than
your intent — a variable that happens to start at `0` but will hold a fraction,
a parameter you intend as `complex` though the body only ever adds. An
annotation is a commitment: it is never silently revised, so it pins the type
where the guess would have drifted.

## Where an annotation goes

An annotation follows a `:` after the name being declared:

```epsil
x: real
x: real = 5
```

Function parameters and return values take one too, in all three function
spellings:

```epsil
f(x: real, n: integer) -> real = x^n
function g(x: integer) -> integer { x + 1 }
(x: integer) => x + 1
```

A declaration whose annotation is a function type **written out with named
parameters** binds those names too — the initializer is then the function's
body, no `=>` needed:

```epsil
const f : (x: real) -> real = x^2 + 2x + 1
```

The names bind only when the signature is spelled at the declaration site
(an alias never binds). See
[Function-type annotations](/epsil/declarations/#function-type-annotations-bind-their-parameter-names).

Everything after the `:` is read as a **type**, not as an expression. That is
why `<`, `>`, `|`, `&` and `->` mean something different there than they do in
ordinary code — in `u: integer | boolean` the `|` is a union, not a logical
or, and in `f: (real) -> real` the arrow is a function type, not a
`KeyValuePair`:

```epsil
xs: list<integer>
f: (real) -> real
u: integer | boolean
```

A `:` that does not follow a declaration target is not an annotation at all, so
this rule never reaches into the rest of your program.

Named functions may also declare their **effects**, between the parameter list
and the return type:

```epsil
function roll(n: integer) random -> integer { Random(n) }
```

Effect labels are part of the function type. See
[Effect specifiers](/epsil/control-flow/#effect-specifiers) for the syntax and
the [function type guide](/compute-engine/guides/types/#function-types) for how
they affect subtyping.

## When a type doesn't fit

Type checking happens as the program runs, not in a separate pass beforehand.
The practical consequences are worth knowing:

- A type failure is an **error value**, not a thrown exception and not a refusal
  to run. The statement that failed evaluates to an `Error`; the statements
  around it still run.
- A program with a type error still **parses**, so the formatter, the
  serializer and the editor tooling keep working on it.
- Because errors are values, they flow: an error handed to another function
  usually comes back as an error, so the first genuine mismatch is the one to
  read.

Only an annotation that is not a valid *type* is caught earlier — see
[Diagnostics](#diagnostics) below.

## How inference decides

A name with no annotation gets its type from how it is used. The engine does
not solve equations; it **accumulates evidence** and moves through the type
lattice as more arrives. Using a name as an argument narrows it toward the
parameter's type; assigning a value widens it to cover that value. A name first
seen in `x + 1` is provisionally a `number` — a working assumption, not a
conclusion.

Two consequences follow, and both are usually what you want:

**Inferred types are revisable.** A guess incompatible with a later assignment
is discarded in favor of the value's own type, and a function that referred to
a name defined only later is re-derived once that definition appears — so the
order you write your statements in does not change what the program means.

**Annotated types are not.** What you write is a commitment; only guesses move.

One inherited behavior can surprise you: evaluating a bare symbol as a boolean
operand (`And`/`Or`/`Xor`/`Not`) infers that symbol `boolean` for the lifetime
of the engine, and a later numeric use of the same name then errors. The
convention is to keep boolean-only names distinct — uppercase `A`, `B`, `C` is
the usual choice.

## Naming a type

Once a shape shows up in more than one signature — or once two different things
share a shape and must not be confused — it is worth giving it a name. A `type`
statement does that. The name is usable by every annotation later in the
program, and by later cells sharing the same engine.

There are two forms, and choosing between them is the main decision here.

### `type alias`: a shorter name for the same thing {#type-alias}

An alias is an **abbreviation**. `pair` and `tuple<number, number>` are the
same type, spelled two ways, and values move between them freely:

```epsil-live
type alias pair = tuple<number, number>
let a: pair = (1, 2)
a
// ➔ (1, 2)
```

Use an alias when the only problem is that a type is long or repeated:

```epsil
type alias grid = list<list<number>>
type alias handler = (string) -> nothing
```

### `type`: a new, distinct type {#nominal-type}

The bare form declares a type that is **its own thing**. Nothing that merely
looks like the definition belongs to it — the definition says how values are
built, not which existing values qualify:

```epsil-live
type point = tuple<x: number, y: number>
let p = point(1, 2)
p
// ➔ point(1, 2)
```

Use it when the distinction matters more than the convenience: two quantities
with the same representation that must never be mixed up, or a value you want
to construct through one checked entry point.

Temperature scales are the canonical case. As nominal types, the units cannot
be interchanged:

```epsil-live
type celsius = number
type fahrenheit = number
function toF(c: celsius) -> fahrenheit {
  match c { celsius(v) => fahrenheit(v * 9 / 5 + 32) }
}
toF(celsius(100))
// ➔ fahrenheit(212)
```

`toF(fahrenheit(212))` is an `incompatible-type` error — the mistake you wanted
caught. The price is visible in the body: because a `celsius` is not a number,
the arithmetic needs a [`match`](#values-of-a-new-type-are-opaque) to get at
the value inside, and the result must be re-tagged on the way out.

Written with aliases instead, the same program computes just as well and
protects nothing:

```epsil-live
type alias celsius = number
type alias fahrenheit = number
function toF(c: celsius) -> fahrenheit { c * 9 / 5 + 32 }
toF(100)
// ➔ 212
```

Both spellings are legitimate. The question to ask is whether you are naming a
shape for readability, or drawing a line the engine should enforce.

|                            | `type alias X = …`      | `type X = …`                |
| -------------------------- | ----------------------- | --------------------------- |
| Relation to the definition | the same type           | a new, distinct type        |
| A plain value of the shape | accepted                | rejected                    |
| Constructor `X(…)`         | checked cast, no tag    | builds and tags a value     |
| Reading the parts          | ordinary operations     | `match`, or `.field`        |
| Prints as                  | the underlying value    | `X(…)`                      |
| Reach for it when          | the type is long/repeated | two things must not mix   |

### Declaring a type {#declaring-a-type}

Neither `type` nor `alias` is a reserved word. Only the statement-position
shapes `type name =`, `type name<`, `type alias name =` and `type alias name<`
are read as a type declaration, so `type` remains an ordinary identifier
everywhere else — `type: integer = 4` still declares a variable named `type`:

```epsil-live
let type = 5
type + 1
// ➔ 6
```

(And `type alias = tuple<number, number>`, with nothing between `alias` and
`=`, declares a type *named* `alias` — legal, but not a spelling to reach
for.)

### Constructors

A type declaration also declares a **constructor**: a function of the same
name that builds values of the type. A `tuple` definition gives a constructor
with one argument per field; any other definition gives a one-argument
constructor:

```epsil-live
type point = tuple<x: number, y: number>
type meters = number
(point(1, 2), meters(5))
// ➔ (point(1, 2), meters(5))
```

The arguments are checked against the definition, so `point(1)` and
`point("a", 2)` produce an error value rather than a malformed point.

A value built this way carries its type with it, wherever it goes:

```epsil-live
type point = tuple<x: number, y: number>
let ps = [point(1, 2), point(3, 4)]
Type(ps)
// ➔ TypeFrom("list<point^2>")
```

An **alias** constructor is a checked cast instead of a tag: it validates the
arguments against the definition and hands back the plain value.

```epsil-live
type alias pair = tuple<number, number>
pair(1, 2)
// ➔ (1, 2)
```

A `record` definition auto-declares **no** constructor: a record's fields
are named, so building one from positional arguments would silently depend
on the order the fields happen to be written in. Write one instead — see
[constructor functions](#constructor-functions) below. Until one is
declared, calling the name reports a `type-not-callable` warning.

### Constructor functions

A `function` bearing a declared type's name — after the `type` statement —
is that type's **constructor function**. The body
computes the *payload*: a value that must satisfy the type's definition
(for a record, exactly the definition's keys, each field matching its
type). The engine checks the payload and tags it; the result is a value of
the type. This is how a `record`-bodied type gets its constructor:

```epsil-live
type circle = record{x: number, y: number, r: number}
function circle(x, y, r) { {x -> x, y -> y, r -> r} }
Type(circle(1, 2, 3))
// ➔ TypeFrom("circle")
```

Constructor functions are not record-specific: one may be written for any
definition, replacing the automatic constructor. This is the *smart
constructor* idiom — the single place a value of the type can come into
existence, so validation or normalization written there cannot be bypassed:

```epsil-live
type frac = record{n: integer, d: integer}
function frac(n: integer, d: integer) {
  {n -> n / GCD(n, d), d -> d / GCD(n, d)}
}
frac(2, 4) == frac(1, 2)
// ➔ True
```

A value that already satisfies the definition can be handed to the
constructor directly — one argument, checked and tagged, body skipped.
That raw spelling is also how a constructed value prints and reads back
(`circle(1, 2, 3)` prints as `circle({x -> 1, y -> 2, r -> 3})`), so a
round trip injects the payload unchanged and a normalizing constructor's
values stay equal after it.

Because the payload spelling must construct unchanged, a constructor's
parameters have to be *distinguishable* from the payload itself: a
`function` whose parameters could also be a valid payload — same number of
arguments, types the definition overlaps — is rejected when it is
declared. Use a different number of arguments, or annotate the parameters
with types the definition body cannot mistake.

A constructor function may call itself, and returning its own constructed
value passes it through unchanged. A `function` with a type's name declared
*before* the type is an ordinary function — the later `type` statement then
reports the usual conflict. And for an **alias**, a same-name function is
just an ordinary function: there is no tag to apply.

### Values of a new type are opaque

A `point` is not the tuple it is defined from — that is what makes it a new
type, and what makes the mix-ups it prevents impossible. The same reserve means
a plain tuple is not accepted where a `point` is expected, and the operations
that take a tuple apart do not reach inside one:

```epsil
type point = tuple<x: number, y: number>
let q: point = (1, 2)   // error: a tuple is not a point
let p = point(1, 2)
First(p)                // error
let (a, b) = p          // error
```

Each of those lines parses: the rejection happens when the program runs, as
an [error value](/epsil/evaluation/#errors-are-values), not as a parse
error.

There are two ways in. To take the value apart all at once, use
[`match`](/epsil/control-flow/#match) on the constructor — a constructor
pattern is an ordinary operator pattern, and binds one variable per field:

```epsil-live
type point = tuple<x: number, y: number>
let p = point(3, 4)
match p {
  point(x, y) => x + y
}
// ➔ 7
```

To read a single **named field**, use the `.` accessor. It works on values
of a declared type whose definition has named fields — a record body or a
named-tuple body — and on records and dictionaries generally:

```epsil-live
type point = tuple<x: number, y: number>
let p = point(3, 4)
p.x + p.y
// ➔ 7
```

On a dictionary, `d.x` is exactly `d["x"]`, absent-key behavior included.
The accessor reads one named field through the type's definition; it does
not make the value a collection — `First(p)`, `p["x"]` and destructuring
keep rejecting. (The dot must touch the value it reads: `p.x` is a field
access, `p .x` is not; and a number never takes a field — `2.x` is a
multiplication.)

An **alias** has none of this reserve — it *is* its definition, so an
alias-typed value works anywhere the underlying shape works:

```epsil-live
type alias meters = number
function height(m: meters) { m + 1 }
height(2)
// ➔ 3
```

### Equality

Two values built by the same constructor are equal when their arguments are.
Values built by different constructors are never equal, and neither is a
constructed value and a plain one of the same shape:

```epsil-live
type point = tuple<x: number, y: number>
type polar = tuple<r: number, t: number>
(point(1, 2) == point(1, 2), point(1, 2) == (1, 2), polar(1, 2) == point(1, 2))
// ➔ (True, False, False)
```

### Types are global, and re-running a cell

A type declaration — both the type name and its constructor — is **global**:
it belongs to the whole program (and to later cells on the same engine), not
to any block. A type name means the same thing everywhere it appears.
Consequently a `type` statement is only allowed at the top level of a
program. Inside a `do` block, a function body, an `if` branch or a loop body
it is an error:

<!-- epsil-test: expect-diagnostics -->

```epsil
do {
  type inner = tuple<number, number> // ✘ type-declaration-not-top-level
  inner(3, 4)
}
```

Declare the type at the top level instead, and use it anywhere — inside
blocks and function bodies included:

```epsil-live
type inner = tuple<number, number>
do { inner(3, 4) }
// ➔ inner(3, 4)
```

Re-running a `type` statement for a name that an earlier `type` statement
declared **replaces** the earlier definition, constructor included —
[constructor functions](#constructor-functions) too, since an edited
definition may invalidate the old body; re-running the whole cell restores
both. Re-running a `function` statement that declares a constructor
replaces the constructor. A name declared some other way — a `function` of
that name *predating* the type, or a type declared by the host
application — is not replaced: the statement reports an error value and
declares nothing.

A `type` statement registers its name as the program is prepared, which is why
the statements *after* it — in the same program or in a later cell — can
annotate with it. A type the host declares on its own is visible to a program
the same way, constructor and all.

## Types with parameters

A type that is the same shape at several element types — a pair of *somethings*,
a tree of *somethings* — takes a **type parameter** rather than being written
out once per element type. The clause goes between the name and the `=`.

For an **alias**, the application expands transparently: `Pair<integer>` means
exactly `tuple<integer, integer>`, and that expansion is what type displays and
error messages show:

```epsil
type alias Pair<T> = tuple<T, T>
let p: Pair<integer> = (1, 2)
```

A parameter may carry a ground bound, enforced wherever the alias is
applied — including application to another clause's type variable, which
is admitted when the variable's own bound satisfies the parameter's. One
alias may therefore be built out of another:

```epsil
type alias Keyed<T: number> = tuple<string, T>
type alias Table<T: integer> = list<Keyed<T>>
let rows: Table<integer> = [("a", 1), ("b", 2)]
```

A generic alias may not refer to itself, every parameter must be used in
the body, and applying one without its arguments (a bare `Pair`) is an
error. Unlike a plain alias, a generic one declares **no**
[constructor](#constructor-functions) and claims nothing in the value
namespace: a `function` of the same name is an ordinary function,
declared before or after. A dependent alias **snapshots** the
definitions it was built from: re-running the `type` statement for
`Keyed` leaves `Table` as it was until `Table`'s own statement is re-run
too — which re-running the cell does.

A parameterized **nominal** type takes a clause the same way. The difference is
what an application means: a nominal type is **opaque**, so `tree<integer>` is
never expanded — which is exactly what lets its body mention itself:

```epsil-live
type tree<T> = tuple<value: T, children: list<tree<T>>>
let t = tree(1, [tree(2, [])])
Type(t)
// ➔ TypeFrom("tree<integer>")
```

The constructor is **quantified** — `tree: (T, list<tree<T>>) -> tree<T>
where T` — so `T` is solved at each construction, from the arguments.
Applying the type at the wrong arity — including a bare `tree` — is the same
error as for an alias, and a parameter bound is enforced the same way.

Reading a **field** reads the definition **instantiated at the application's
arguments**, so it comes back at the type the application supplied, not at
`T`:

```epsil-live
type tree<T> = tuple<value: T, children: list<tree<T>>>
let t: tree<number> = tree(1, [])
Type(t.value)
// ➔ TypeFrom("number")
```

`match` is not a projection of the annotation — it binds **values**, so each
capture comes back at the matched value's *own* type, usually narrower than
the annotation's:

```epsil-live
type tree<T> = tuple<value: T, children: list<tree<T>>>
let t: tree<number> = tree(1, [])
match t { tree(v, cs) => Type(v) }
// ➔ TypeFrom("integer")
```

### Variance

A parameter may carry an `in`/`out`/`inout` marker saying how two applications
relate: `out` (covariant) makes a `tree<integer>` usable where a `tree<number>`
is expected, `in` (contravariant) reverses that, and `inout` (invariant) relates
only identical arguments. The words are contextual, claimed only inside a
clause. An alias takes no marker — it expands rather than relates.

```epsil
type tree<out T> = tuple<value: T, children: list<tree<T>>>
type sink<in T> = tuple<accept: (T) -> nothing>
```

**A parameter with no marker means `out`** — declared, not inferred, and
verified against the body like any written marker. Values are immutable, so
covariance is sound, and it is what the common case (a payload container)
wants; only the minority that consumes its parameter needs to say so. Because
the default is *declared*, a body that uses its parameter in an input
position does not quietly change the type's subtyping contract — it is a
`variance-violation` naming the offending occurrence and the markers that
would verify:

```epsil
type events<T> = tuple<log: list<T>, notify: (T) -> nothing>
```

This statement parses, but declares nothing: it evaluates to an error value
carrying a `variance-violation`. `T` appears in both an output position
(`log`) and an input one (`notify.(arg 1)`), so `events` can only be
`inout` — writing `type events<inout T> = …` accepts the definition, at the
cost of `events<integer>` no longer being usable as an `events<number>`.
`inout` verifies against any body: invariance promises nothing, so it is
always sound, just less permissive.

One limitation follows from that. A construction solves its parameters from
its arguments alone, and an annotation does not widen them: `let t:
tree<number> = tree(1, [])` works only because the `tree<integer>` it
builds *is* a `tree<number>` under `out`. For an explicitly `inout` or `in`
parameter that step is not available, so such a type can only be constructed
at exactly its argument type.

### Optional payloads

A type variable may stand in one arm of a union, which is what makes an
optional payload expressible:

```epsil-live
type opt<T> = T | missing
let a = opt(1)
Type(a)
// ➔ TypeFrom("opt<integer>")
```

Each construction takes exactly one arm. Taking the **ground** arm says
nothing about `T`, so `T` is solved to `never` — the narrowest member of the
family, and (under `out`) a subtype of every other:

```epsil-live
type opt<T> = T | missing
let b = opt(Missing)
Type(b)
// ➔ TypeFrom("opt<never>")
```

Only **one** arm may mention a variable: with two open arms nothing at the
construction site says which arm a value took, so neither variable could be
solved. `type both<T, U> = T | U` therefore declares nothing — it evaluates to
an error value carrying an `unsupported-variable-position`. A variable may not
stand in an intersection or a negation at all; an intersection is usually a
constraint written in the wrong place, and the error says so — write a bound
(`type box<T: number> = …`) instead of `T & number`.

### Generic functions

A `function` definition takes a type-parameter clause between its name and its
parameter list, and the quantified names scope over the definition's head (its
parameters, effect specifier, and return type):

```epsil
function swap<T, U>(x: T, y: U) -> tuple<U, T> { (y, x) }
swap(1, "a")
```

A type parameter may carry a ground bound (`function g<T: number>(x: T) -> T`),
which is enforced at every call.

The same clause can be written as a trailing **`where` clause** instead of the
`<…>` binder. The two spellings are synonyms, and the clause always comes last
— after the effect specifier and after the return type:

```epsil
function swap(x: T, y: U) -> tuple<U, T> where T, U { (y, x) }
function g(x: T) -> T where T: number { x }
function f(x: T) where T { x }                 // return type inferred
function tick(x: T) random -> T where T { x }  // with an effect specifier
f(x: T) -> T where T = x + x                   // math definition form
```

A declaration has **one binding site**: it may carry a `<…>` clause or a
`where` clause, never both. `function f<T>(x: T) -> T where T: number` is an
error, not a bounded `<T: number>`.

A full-type annotation has no binder slot, so it always uses the `where`
clause — `let f: (T) -> T where T = x => x`.

Note that a function is generic only when it is **declared** generic. Nothing
is silently generalized: `x => x` is a function on some inferred type, not an
implicit "for all `T`".

## Absence values

Epsil distinguishes three related kinds of absence:

- `Nothing` means “no value here” and is removed from function arguments and
  collection literals.
- `Missing` is a position-preserving missing value. Its type is `missing`.
- `NaN` is the numeric form of an absent or undefined result. Numeric
  operations and missing numeric fields generally normalize absence to `NaN`.

`IsMissing(x)` recognizes both `Missing` and `NaN`, regardless of how the
value arose. `Coalesce(a, b, ...)` evaluates from left to right and returns the
first value that is not missing; if every argument is missing, it returns the
last one unchanged.

```epsil-live
(Length([1, Missing, 3]), IsMissing(Missing), IsMissing(NaN),
  Coalesce(Missing, 0), Missing + 1)
// ➔ (3, True, True, 0, NaN)
```

A missing dictionary field follows the expected value domain: a numeric field
produces `NaN`, while a string or other nonnumeric field produces `Missing`.
Use `IsMissing` when the distinction between those representations is not
important, and [`??`](/epsil/operators/#absence-coalescing) — the operator form
of `Coalesce` — to supply a fallback.

## Background: what kind of type system this is

None of this section is needed to use Epsil — it is background for readers
curious about why the system behaves the way it does.

### Types form a lattice

The foundation is **subtyping**: types are arranged in a hierarchy, and most
questions the engine asks are of the form "is this type a subtype of that
one?". The numeric tower — `integer ⊂ rational ⊂ real ⊂ complex ⊂ number` — is
the familiar part. Around it the type language adds unions
(`integer | boolean`), range refinements (`integer<0..10>`), collections with
element types (`list<integer>`, `set<string>`), tuples and records, and
function signatures with effect labels.

Any two types have a **join** (the narrowest type that covers both — the
join of `integer` and `real` is `real`) and a **meet** (the widest type
inside both). Joins and meets are the workhorses of the whole system: the
type of a mixed list is the join of its element types, and inference is built
out of these two moves.

### It is not Hindley–Milner

Languages in the ML family (OCaml, Haskell, Elm) use a different
foundation, called Hindley–Milner: types are compared for *equality* and
solved by unification, which buys two famous guarantees. Every expression
has a **principal type** — a single most general type that every other
valid type is a specialization of — and inference is **whole-program**:
the compiler sees the finished program at once, and a use of a function
far from its definition can determine the definition's type, with no
annotations anywhere.

This system deliberately trades those guarantees away, for two reasons.

First, subtyping and principal types pull against each other. In
Hindley–Milner, `integer` and `real` simply fail to unify; here, a
function declared `(T, T) -> T where T` called with an `integer` and a
`real` succeeds, solving `T` to their join (a `real`). That is the
behavior mathematics wants — but once many types are valid for an
expression, "the single most general one" stops being the useful answer,
and the engine makes pragmatic choices instead.

Second, there is no "whole program" to infer over. A session is
open-ended: definitions arrive one statement (or one cell) at a time, may
refer to names defined later, and may be redefined. The engine therefore
types what it has seen so far and refines as more arrives, rather than
solving a closed program once.

In character the system is closer to TypeScript or Go than to ML:
subtyping at the base, generics that are explicitly declared rather than
silently inferred, and types solved locally rather than globally.

### Generics are solved per call

At each call of a generic function, the engine collects what the arguments say
about each type variable and solves the variables on the spot, by joining that
evidence; the call's result type comes from substituting the solution into the
signature.

Subtyping also quietly absorbs a classic use of polymorphism: the empty
list needs no "for all" type — it is simply `list<never>`, and since
`never` is the bottom of the lattice (joining it with anything gives the
other type back), `Join([], [1, 2])` comes out as `list<integer>`
with no quantifier anywhere.

For the representation a type declaration lowers to, see
[Type declarations](/epsil/implementation/#type-declarations).

## Diagnostics

An invalid type inside an annotation position surfaces as a
`type-annotation-error` diagnostic, offset-corrected to point at the
offending token within the type text (not at the `:` or the declaration
target):

<!-- epsil-test: expect-diagnostics -->

```epsil
x: notatype
```

produces a `type-annotation-error` diagnostic pointing at `notatype`.
