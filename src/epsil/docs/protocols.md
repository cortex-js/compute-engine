---
title: Epsil Protocols
sidebar_label: Protocols
slug: /epsil/protocols/
description: "Protocols in Epsil: declaring a set of operations, conforming types to it, dynamic dispatch on the receiver, properties, and conditional conformance."
hide_title: true
date: Last Modified
---
# Protocols

A **protocol** names a set of operations. A type **conforms** to a protocol
by providing an implementation of each of them, and a call to a protocol
function then runs the implementation for the value it is given — `compare`
means one thing for strings and another for numbers, and each call picks the
right one at run time.

Protocols are how code gets written once against "anything that supports
these operations": a `smallest` that works for every comparable type, a
formatter that works for everything hashable. The alternative — a
multi-clause function with one clause per type — requires editing the
function each time a type is added. With a protocol, adding a type means
declaring its conformance, and every existing call site picks it up.

## Declaring a protocol

A `protocol` declaration lists function and property requirements —
signatures only, no bodies:

```epsil
protocol Comparable {
  function compare(self: Self, other: Self) -> "<" | "=" | ">"
}
```

Inside a protocol, the type `Self` stands for whichever type conforms. The
**first parameter of every protocol function must be `Self`** — it is the
value the call dispatches on. Writing the first parameter without a type
means the same thing (`function compare(self, other: Self)`); explicitly
typing it as anything else is the `protocol-self-required` error.

Protocols are engine-global, like [named types](/epsil/types/): a protocol
declared anywhere is visible everywhere after, and declaring one inside a
local scope is `protocol-scope-invalid`. Re-executing a `protocol`
statement — the notebook pattern — replaces the previous declaration and
revalidates every implementation against the new requirements.

A protocol may also be empty. Such a **marker protocol** documents a
semantic promise rather than an operation set, and a bare conformance
declaration completes it:

```epsil
protocol Copyable {}
type string is Copyable
```

## Conforming a type

The `is` keyword declares that a type conforms, and a braced block after it
supplies the implementations:

```epsil-live
protocol Comparable {
  function compare(self: Self, other: Self) -> "<" | "=" | ">"
}

type string is Comparable {
  function compare(self: string, other: string) -> "<" | "=" | ">" {
    if (self < other) { "<" } else if (self > other) { ">" } else { "=" }
  }
}

compare("crimson", "cyan")
// ➔ "<"
```

In an implementation, `Self` and the conforming type's own name are
synonyms — `compare(self: Self, …)` and `compare(self: string, …)` declare
the same thing.

The conforming type must be a **named, concrete type**: a built-in
(`string`, `integer`, `list<integer>`) or a [declared nominal
type](/epsil/types/#nominal-type). A union, an anonymous tuple or
record shape, or a `type alias` name cannot conform
(`protocol-conformance-target-invalid`) — wrap the shape in a nominal type
first. A new nominal type can declare its conformance in the same
statement:

```epsil-live
protocol Area { function area(self: Self) -> number }

type Circle = tuple<radius: number> is Area {
  function area(self: Circle) -> number { Pi * self.radius^2 }
}

area(Circle(1)) == Pi
// ➔ True
```

Conformance may also be declared **ahead of** its implementation — declare
in one statement (or one notebook cell), implement in a later one. Until
the implementation arrives the conformance is *pending*: each program run
that leaves it pending ends with a `protocol-implementation-pending`
warning, and dispatching through it produces the ordinary
`protocol-implementation-missing` error value.

An implementation block is checked as it lands: a member the protocol does
not declare is `protocol-member-unknown` (with a "did you mean"), a missing
one is `protocol-implementation-missing`, and a signature that does not
match the requirement — after substituting the conforming type for `Self` —
is `protocol-signature-mismatch`. Parameter types may be *wider* than the
requirement and the result *narrower*; parameter names are not significant
for matching. Implementing the same protocol twice for one type in a single
program is `protocol-implementation-duplicate`; a later run replaces.

## Calling a protocol function

A protocol function is called like any function. The implementation is
chosen by the **runtime type of the first argument**, and the most specific
conformance wins:

```epsil-live
protocol Describable { function describe(self: Self) -> string }
type number is Describable { function describe(self) -> string { "a number" } }
type integer is Describable { function describe(self) -> string { "an integer" } }

(describe(3), describe(2.5))
// ➔ ("an integer", "a number")
```

Subtypes inherit conformance: with only the `number` implementation
declared, `describe(3)` still answers `"a number"` — an `integer` *is* a
`number`, and the `number` implementation witnesses it. Declaring the
`integer` implementation as well, as above, is not a conflict: it is a more
specific implementation, and values that are integers get it. (Two
conformances whose types overlap without one containing the other are
rejected — `protocol-conformance-overlap` — because a value in the
intersection would have no best implementation.)

Calling a protocol function on a value with **no** applicable
implementation produces the `protocol-implementation-missing` error value;
a call whose receiver's type cannot be decided yet simply stays symbolic
until it can.

### When the bare name is taken, qualify

Two situations take the bare name away. A lexically visible definition of
the same name **shadows** protocol members — your `size` wins over any
protocol's. And two protocols can both declare a member that applies to the
same receiver, making the bare call ambiguous. Both have the same escape
hatch: qualify the member with the protocol's name.

```epsil
compare("a", "b")
// -> protocol-call-ambiguous: `compare` applies to a value of type
//    `string` through `Comparable(string)` and `Comparator(string)`.
//    Use a qualified name to narrow the one you meant.

Comparable.compare("a", "b")   // ➔ "<" — just Comparable's
Comparator.compare("a", "b")   // ➔ -1  — just Comparator's
```

The qualified name is also a first-class **value** — pass it wherever a
function is expected:

```epsil-live
protocol Negatable { function negated(self: Self) -> Self }
type number is Negatable { function negated(self) -> number { -self } }

Map(Negatable.negated, [1, 2, 3])
// ➔ [-1, -2, -3]
```

[Named arguments](/epsil/syntax/#named-arguments) work with protocol
functions in both spellings, and the call dispatches on the argument bound
to the declared first parameter wherever it is written:
`tag(prefix: "n", self: 5)` and `Tagged.tag(prefix: "n", self: 5)` both
dispatch on `5`.

### The dot form: `c.area()` {#dot-call}

A protocol function can also be called **with the dot**, the value first:
`c.area()` is exactly `area(c)`, and `c.scale(2)` is `scale(c, 2)`. The
value before the dot becomes the first argument, which is the argument the
call dispatches on. Because any expression can be the receiver, calls
chain from left to right:

```epsil-live
protocol Shape {
  function area(self: Self) -> number
  function scale(self: Self, k: number) -> Self
}
type Circle = tuple<r: number> is Shape {
  function area(self: Circle) -> number { Pi * self.r^2 }
  function scale(self: Circle, k: number) -> Circle { Circle(self.r * k) }
}

let c = Circle(1)
(c.area(), c.scale(2).area(), c.scale(k: 2))
// ➔ (pi, 4pi, Circle(2))
```

The parentheses are what make the dot a call. Without them, `c.area` is a
field or [property](#properties) read, and on a `function` member it is
the `protocol-function-not-a-field` error; `c.area` is never a function
value that remembers `c`. And the dot reaches **members** only: a field, a
property, or a protocol function. A library function or a plain function is
not a member of anything, so `xs.Sort()` is the error
`dot-call-not-a-protocol-function`; write `Sort(xs)`, or chain such calls
with the [pipe](/epsil/operators/#pipe), `xs |> Sort |> Reverse`.

Two details follow from the rest of the language. A field the receiver's
type declares wins over a protocol function of the same name, so on a
record or object whose field `f` holds a function, `v.f(2)` still calls the
stored function. And a number literal never takes a dot (`5.name()` reads as
`5.` followed by `name()`, the same rule that makes `2.x` a multiplication):
bind the number to a name first.

When two protocols the type conforms to declare the same member, the bare
call and the dot form are both `protocol-call-ambiguous`; the qualified
dot form names the protocol: `c.(Shape.area)()`. And because the dot names
a member, it reaches the protocol even when a definition of your own has
taken the bare name (see [above](#when-the-bare-name-is-taken-qualify)):
with your own `area` in scope, `area(c)` calls yours and `c.area()` still
calls the protocol's.

## Properties

A protocol can require **properties**, read with ordinary field syntax.
`readonly` requires a getter; `readwrite` a getter and a setter:

```epsil-live
protocol Signed { readonly sign: string }

type number is Signed {
  get sign(self) -> string { if (self < 0) { "-" } else { "+" } }
}

let x = -12
x.sign
// ➔ "-"
```

A `get` implementation takes `self` and returns the property's type. A
`set` implementation takes `self` and the new value, stores it, and
**returns the receiver**:

```epsil-live
protocol Nameable { readwrite name: string }

type Person = object{first: string, last: string} is Nameable {
  get name(self) -> string { "\(self.first) \(self.last)" }
  set name(self, value: string) -> Person {
    self.first = value
    self
  }
}

let p = Person(first: "Ada", last: "Lovelace")
p.name = "Augusta"        // stores into p — every reference to it sees the change
p.name
// ➔ "Augusta Lovelace"
```

### The mutability gate

`Person` above is an **object** type, and that is required rather than
incidental: a writable property is meaningful only on a mutable object,
so a protocol that can modify state — one with at least one `readwrite`
property, or a function member whose declared effects include `state` —
can be conformed to only by object types. A protocol with only
`readonly` properties and no declared `state` can be conformed to by any
type, as `Signed` is by `number` above.

```epsil
protocol Identifiable { readwrite id: string }
type Badge = record{id: string} is Identifiable
// ➔ protocol-requires-object: the `Identifiable` protocol has settable
//   properties. `Badge` is a record, and records are immutable; declare
//   `Badge` as an object type to conform.
```

A **bare** requirement never gates — its effects are derived from
whatever conformers exist, so a record may conform to a bare-function
protocol with a pure implementation — and an explicit `pure` member never
gates either, since the empty effect set is not `state`.

Assigning to a property is a **store**, and the assignment evaluates to
the value assigned. The target does not have to be a variable: any
expression that evaluates to an object can be stored into, so
`xs[1].name = "Ada"` works when the list holds objects, and a `const`
binding is no obstacle either — the store writes the object, never the
binding. On a record, a tuple or any other immutable value it is
`immutable-value-assignment`, which names the two ways forward: build an
updated copy, or declare the type as `object{…}`. Providing a `set`
implementation for a `readonly` property is
`protocol-property-readonly-set`, and so is a write through the read-only
protocol view — the qualified `p.(Named.name) = v`, or the unqualified
`p.name = v` when `name` is a computed property. A `readonly` requirement
that a stored FIELD satisfies is a different matter: `readonly` constrains
that protocol's view of the field, not the object, so a holder of the object
can still write the field directly. That asymmetry is deliberate for now and
is under review (see the `readonly` entry in `ROADMAP.md`).

If two protocols declare a property with the same name, the qualified
form disambiguates, for reads and for writes alike:
`person.(Nameable.name)` and `person.(Nameable.name) = "Ada"`.

## Conditional conformance

A parameterized type can conform **only when its arguments do**. The head
names the type's variables, and the trailing `where` clause constrains
them:

```epsil-live
protocol Summable { function total(self: Self) -> number }
type integer is Summable { function total(self) -> number { self } }

type list<T> is Summable where T is Summable {
  function total(self: list<T>) -> number {
    Reduce(self, (acc, x) => acc + total(x), 0)
  }
}

(total([1, 2, 3]), total([[1, 2], [3]]))
// ➔ (6, 6)
```

`list<integer>` conforms because `integer` does; `list<string>` does not,
unless `string` is made `Summable` too. The conformance is recursive for
free — `list<list<integer>>` conforms because `list<integer>` does, as the
second call shows.

### No effect specifiers on a conditional member

A member of a **conditional** conformance may not carry an
[effect specifier](/epsil/control-flow/#effect-specifiers). Its effects are
inferred from its body instead:

```epsil
protocol Summable { function total(self: Self) -> number }

type list<T> is Summable where T: number {
  function total(self: Self) pure -> number { Sum(self) }
}
```

That is refused when the conformance is declared, with
`protocol-conditional-member-effects`. Drop the `pure` and the same block
works — and `total([1, 2, 3])` answers `6`.

The restriction is specific to the conditional form. A conformance to a
ground type accepts specifiers on every member:

```epsil-live
protocol Summable { function total(self: Self) -> number }

type Box = object{n: integer} is Summable {
  function total(self: Self) pure -> number { self.n }
}

total(Box(n: 5))
// ➔ 5
```

The reason is that a conditional conformance's `Self` stands for a whole
family of types (`list<T>`, not one type), and a specifier has to be recorded
against a concrete receiver. The restriction is expected to lift; until then
the failure is reported at the declaration rather than at the call.

## Requiring conformance in a signature

A generic function can require its type variable to conform, with the `is`
slot of the [`where` clause](/epsil/types/#generic-functions):

```epsil-live
protocol Comparable {
  function compare(self: Self, other: Self) -> "<" | "=" | ">"
}
type string is Comparable {
  function compare(self, other: Self) -> "<" | "=" | ">" {
    if (self < other) { "<" } else if (self > other) { ">" } else { "=" }
  }
}

function smallest(a: T, b: T) -> T where T is Comparable {
  if (compare(a, b) == "<") { a } else { b }
}

smallest("pear", "fig")
// ➔ "fig"
```

Multiple protocols are an *and*, joined with `&`:
`where T is Comparable & Hashable`. A call whose solved type does not
conform is rejected — `smallest(True, False)` above reports
`protocol-constraint-unsatisfied`, naming the protocol and the type.

A protocol name is **not a type**: `function sort(xs: list<Comparable>)`
is `protocol-in-type-position`, and the diagnostic shows the constrained
spelling to use instead.

## Diagnostics

The protocol diagnostics carry their explanation in the message itself —
each names the protocol, the type, and the way out. The full set of codes,
grouped by when they fire:

- **Declaring**: `protocol-member-keyword-missing`,
  `protocol-self-required`, `protocol-scope-invalid`.
- **Conforming**: `protocol-conformance-target-invalid`,
  `protocol-target-unknown`, `protocol-conformance-overlap`,
  `protocol-implementation-split` (an implementation block on a
  multi-protocol `is A & B` — provide one block per protocol),
  `protocol-requires-object` (the mutability gate: a protocol that can
  modify state, conformed to by a non-object type),
  `protocol-implementation-pending` (a warning).
- **Implementing**: `protocol-implementation-missing`,
  `protocol-implementation-duplicate`, `protocol-member-unknown`,
  `protocol-signature-mismatch`, `protocol-property-readonly-set`,
  `protocol-conditional-member-effects` (an effect specifier on a member of a
  conditional conformance).
- **Calling**: `protocol-call-ambiguous`, `protocol-property-ambiguous`,
  `protocol-constraint-unsatisfied`, `protocol-in-type-position`,
  `immutable-value-assignment` (a property store on a value).
