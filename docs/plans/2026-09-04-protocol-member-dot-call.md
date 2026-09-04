# Calling a protocol function with the dot: `c.area()`

**Status:** ruled 2026-09-04, implemented the same day.

## The decision

In Epsil, `base.name(args)` calls the protocol function `name` on the value
`base`, with `base` as the first argument. It means exactly `name(base, args)`.

```epsil
protocol Shape {
  function area(self: Self) -> number
  function scale(self: Self, k: number) -> Self
}
type Circle = tuple<r: number> is Shape {
  function area(self: Circle) -> number { Pi * self.r^2 }
  function scale(self: Circle, k: number) -> Circle { Circle(self.r * k) }
}
c := Circle(1)
c.area()            // ➔ π          the same as area(c)
c.scale(2).area()   // ➔ 4π         the same as area(scale(c, 2))
c.scale(k: 2)       // ➔ Circle(2)  named arguments work after the receiver
```

The rules the user ruled on, in the order they were decided:

1. **Only protocol functions.** A library function or a user function that is
   not a protocol member is not reached this way: `xs.Sort()` is an error, and
   `Sort(xs)` or `xs |> Sort` is the spelling. Every protocol function takes
   the receiver first by construction (the parser refuses a first parameter
   that is not `self: Self`), so the receiver is always the first argument and
   there is no argument placement rule to learn.
2. **Any receiver expression.** The receiver is not limited to a symbol, so
   calls chain: `c.scale(2).area()`.
3. **The parentheses are the call.** `c.area` without parentheses keeps its
   meaning: a field or property read. On a protocol function member it is
   still the `protocol-function-not-a-field` error. No bound-method value is
   introduced: `c.area` never evaluates to a function that remembers `c`.
4. **A field wins over a member.** When the receiver's static type declares a
   field named `name` (a record, an object layout, a named tuple), or when the
   receiver is a dictionary, `base.name(args)` keeps today's meaning: read the
   field, then call what it holds. A protocol function of the same name is not
   reached through the dot on such a value.

Why protocols only: the pipe already gives left-to-right chaining for library
functions, with a type-directed placement rule. The gain of the dot is for
user-defined types that conform to protocols, where `c.area()` is the
spelling every reader expects. Restricting the dot to protocol members keeps it
with one meaning, "reach a member of this value", the meaning fields and
properties already give it.

## How it is implemented

### Parse

The postfix loop of the parser (`src/epsil/parser.ts`, `parsePostfix`)
already reads `.name` as a field clause. When the field clause is immediately
followed by `(` with no whitespace, the parser now produces a **member call**
node instead of a field read applied to arguments:

| Source                 | Parse                                              |
| ---------------------- | -------------------------------------------------- |
| `c.area()`             | `["MemberCall", c, "area"]`                        |
| `c.scale(2)`           | `["MemberCall", c, "scale", 2]`                    |
| `c.(Shape.scale)(2)`   | `["ProtocolMember", "Shape", "scale", c, 2]`       |
| `(c.area)(2)`          | `["Apply", ["Field", c, "area"], 2]` (unchanged)   |
| `c .area()`            | `c` then a stray-token diagnostic (unchanged)      |

The qualified form `c.(Shape.scale)(2)` lowers straight to the existing
`ProtocolMember` operator, which dispatches inside one protocol. It is the
spelling that resolves a `protocol-call-ambiguous` error when two protocols the
type conforms to declare the same member name.

A parenthesized field read followed by a call, `(c.area)(2)`, is not a member
call. It keeps the `Apply(Field(...))` shape and its current meaning.

### Canonicalization

`MemberCall` is a parse-level node. Its canonical handler rewrites it and it
never survives canonicalization, so the evaluator, the compiler, the effects
inference and the static checker see only shapes they already know:

1. The receiver is a valueless symbol that names a protocol in the registry
   (`Shape.area(c)`): the result is `Apply(Field(Shape, "area"), c)`, the shape
   the qualified call has always canonicalized to. Nothing downstream changes.
2. The receiver's static type declares a field with that name, or is a
   dictionary: the result is `Apply(Field(receiver, "name"), args)`, today's
   shape for calling a stored function.
3. `name` is a protocol dispatcher (the operator the engine installs for every
   protocol function member): the result is the bare call
   `name(receiver, args)`. The dispatcher's own canonical handler then checks
   the arity and the argument types against the requirement, its `type`
   handler gives the static result type, its declared effects are the union
   over the conformers, the compiler lowers it as it lowers any dispatcher
   call, and evaluation dispatches on the receiver's runtime type with the
   usual `protocol-implementation-missing` and `protocol-call-ambiguous`
   errors. When a definition of the author's own has taken the bare name
   (the dispatcher is shadowed, so `area(c)` runs the author's `area`), the
   dot still reaches the protocol: the call lowers to the qualified
   `ProtocolMember(Shape, "area", c)` when one protocol declares the member,
   or when the receiver's static type picks one among several.
4. Otherwise the result is `Apply(Field(receiver, "name"), args)`, which
   produces today's errors at evaluation (`unknown-field` on a nominal type,
   `incompatible-type` on a number or a list). One case gets a better message:
   when the receiver's static type is decided and has no fields, and `name`
   is a known function that is not a protocol member, the call canonicalizes
   to the error `dot-call-not-a-protocol-function`, which names the two valid
   spellings (`Sort(xs)`, `xs |> Sort`). This error is on the static route, so
   `epsil check` reports it.

`MemberCall` is declared `lazy` so that its canonical handler receives the
written operands unchanged. That is what lets a named argument
(`c.scale(k: 2)`) travel to the dispatcher call `scale(c, k: 2)`, where the
named-argument seam of `box.ts` permutes it against the dispatcher's
signature. A strict operator would have canonicalized the named-argument
carrier into an `argument-names-unavailable` error before the handler ran.

### The static decision between a field and a member

Rule 4 above is decided from the receiver's **static** type at
canonicalization. When that type is undecided (an unannotated parameter,
`function g(x) { x.area() }`), the protocol member wins: the call lowers to
`area(x)`. The one program this misreads is an unannotated parameter that
receives, at run time, an object or a dictionary storing a function under a
name that is also a protocol function member. The stored function is not
called; the dispatcher runs. This is accepted: the case needs a function stored
in a field under a protocol member's name, reached through a parameter with no
type. Annotating the parameter restores the field reading.

### Serialization

`serializeEpsil` prints a raw `MemberCall` node as `base.name(args)`, with the
receiver parenthesized when it is an operator expression, exactly as `Field`
does. A canonical expression has no `MemberCall` node, so MathJSON produced by
the engine prints the bare call, `area(c)`. The dot form is sugar by
definition, and this is the round-trip contract.

## What does not change

- `p.x(2)` on a record or dictionary whose field `x` holds a function.
- `Shape.area(c)`, the qualified call, and its MathJSON after canonicalization.
- `c.area` without parentheses.
- Property reads (`b.name`) and property stores (`b.name = v`).
- The compiler: it never sees a `MemberCall` node.

## Out of scope

- A bound-method value (`c.area` as a function). Ruled out; see rule 3.
- The dot on library functions (`xs.Sort()`). Ruled out; see rule 1.
- Editor navigation: the member name in `c.area()` is a string operand in the
  parse, as it is in `c.area` today, so "go to definition" on it does not
  resolve. Both spellings would need the same addition.

## Files

- `src/epsil/parser.ts`: the member-call clause in `parsePostfix`.
- `src/compute-engine/library/collections.ts`: the `MemberCall` operator, next
  to `Field`.
- `src/compute-engine/boxed-expression/box.ts`: `MemberCall` excluded from the
  named-argument seam, as `Apply` is.
- `src/compute-engine/engine-protocols.ts`: `protocolsWithMember` exported for
  the shadowed-dispatcher route.
- `src/epsil/serialize-epsil.ts`: the `MemberCall` arm.
- `src/epsil/error-explanations.ts`, `src/epsil/docs/errors.md`,
  `src/epsil/static-diagnostics.ts`: the `dot-call-not-a-protocol-function`
  code and the updated `protocol-function-not-a-field` advice.
- `src/epsil/docs/protocols.md`, `src/epsil/docs/syntax.md`,
  `src/epsil/docs/from-python.md`: the documentation.
- `test/epsil/member-call.test.ts`: the tests.
