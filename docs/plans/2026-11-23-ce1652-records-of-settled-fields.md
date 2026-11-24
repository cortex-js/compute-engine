# CE-1652: compiling a function that builds a figure (records of settled fields)

Status: implemented, steps 1 to 6 (approved by the user 2026-11-23, with
Q1 (c), Q2 (b) and Q3 (a) of section 9). Commits: step 1
`ad84baac4036014f1ba6b52b5416280e3324d89b`, step 2
`0e697e6d622dd4dcedc33c7074887f9b8a6d5add`, step 3
`4eef8dd3666249e1e4e816980338b2510725687b`, step 4
`643e8dd4b4edea165890f5dbba343162819641e7`, step 4b
`1552478f8c8c1e4badc8da453cab82d424188cbf` and
`6a1331792f2f4ceab680e6918593448a3cd35c88`, step 4c
`3fe7957ebe9970ef2f0680883152e2ae7dd2fe96`, step 5
`a77758019c53574264d57a9ed520671562b51e76`; step 6 is the commit of the
acceptance tests (section 7).

Issue: `issues/CE-1652.md`, option (b), user decision 2026-11-22. Scope: the
`javascript` target of the IR compiler (`src/compute-engine/compilation/ir/`);
GLSL, interval and `bigint` decline every value of the new kind.

## 1. The question

A Tycho notebook animation calls `draw(circle((cos(t), 0), 0.1))` in a timer
callback. The callback runs interpreted because the compiler has no value for
a `Figure`: a named tuple of a string, a list, a matrix and five style fields
typed `any`. The decision asks for a plan where a record whose fields each
have a settled shape compiles, and where a protocol method is dispatched at
compile time on the static type of its receiver. This note says what the
compiler lacks, the design of each part, the order of the work, and the
choices that the board must confirm.

## 2. What the code does today

Read at `14d5c0ac584a271cebca8d765522fb3dca7ded89`, probed with the drawing
prelude of Tycho (`src/graph-paper/notebook/drawing/prelude.ts`, version 21)
and with small Epsil programs (`compile(fn, { to: 'javascript', fallback: false })`).

The witness of the issue reproduces:

| Program                                                         | Decline                                                    |
| --------------------------------------------------------------- | ---------------------------------------------------------- |
| `(t: real) => circle((cos(t), sin(t)), 0.2)`                    | the result of circle is not a scalar (Figure)              |
| `(t: real) => circle((2, 0), 0.2).rotateAbout(t / 1000, (0, 0))` | rotateAbout is not the library operator here (a user definition) |
| `(t: real) => draw(circle((cos(t), 0), 0.1))`                   | a parameter of draw that is not a name                     |
| `(t: real) => hostDraw(t)` (CE-1621)                            | compiles                                                   |

The interpreter's value of a figure is the application of the type's
constructor: `circle((1, 2), 0.2).rotateAbout(0.5, (0, 0)).fill("red")` is
the expression of type `Figure` (`.json`, numbers shortened here):

```json
["Figure", "'circle'", ["List", {"num": "1.0"}, {"num": "2.0"}, 0.2],
 ["Tuple", 0.8775825, 0.4794255, -0.4794255, 0.8775825, {"num": "0.0"}, {"num": "0.0"}],
 "'red'", "Nothing", "Nothing", "Nothing", "Nothing"]
```

Each operation that the prelude needs on the path of the three programs, and
what the compiler does with it today (probed one at a time):

| Operation                                   | Today                                                        |
| ------------------------------------------- | ------------------------------------------------------------ |
| `N(x, 15)` on a real                        | declines: "the operator N is not supported"                  |
| `Tuple("a", t)` (elements of two lanes)     | declines: "elements of two types"                            |
| `P(k, g, m, a)`, the constructor of a type  | declines: "P is not the library operator here"               |
| `Field(r, "alpha")`                         | declines: "the operator Field is not supported"              |
| `w is string` (`MatchesType`)               | declines: "the operator MatchesType is not supported"        |
| `match s { == "rect" => …; _ => … }`        | declines: "the operator Match is not supported"              |
| a parameter typed `any`                     | declines: "the parameter w of g is not a scalar (any)"       |
| a rest parameter `...args`                  | declines: "a parameter of … that is not a name"              |
| a protocol method (`rotateAbout`)           | declines: the dispatcher is not a function literal           |
| a host function with a list or tuple argument | declines (`docs/COMPILATION-MODEL.md`, "Functions of the host") |
| a host function of result `any`             | declines (R3); Tycho declares `figureDraw` `(any) -> any`    |
| a string result, `==` of two strings        | compiles                                                     |

Two exports of `engine-protocols.ts` that the retired compiler used have no
caller now and do the lookup that section 4.5 needs:
`protocolDispatchCandidates()` (the conformance edges that implement a member)
and `implementationLiteralAt()` (the implementation as a function literal with
`Self` replaced by the edge's target, `null` for a host callback or a
conditional edge).

## 3. The rule that the design keeps

`docs/COMPILATION-MODEL.md`, "Shapes are settled at compile time": the shape of
every value comes from its static type and from the literal structure of its
operands; no run-time test of a type is emitted; the compiler does not follow
the paths of control flow. A record keeps this rule: the shape of each field is
settled where the record is made, from the static type of the field when it
settles one, otherwise from the shape of the operand that the constructor
receives. A field typed `any` whose operand is the literal `[N(c[1], 15),
N(c[2], 15), N(r, 15)]` is a list of three reals in that record. Two records of
one engine type whose fields have different shapes are two IR types. A value
that can be either (an `if` whose arms give a `circle` and a `label`, a list of
both) has no settled shape and declines, as R3 says.

## 4. Design

### 4.1 The record value kind

`IRType` (`ir.ts`) gains a field `fields?: readonly IRType[]`, with the lane
`'record'` and the shape `[]`. Each field is an IR type of today (a scalar of
a lane, `color` included, a list of a stated or a run-time length, a tuple), a record, or the
new unit type `nothing`, the type of a field whose value is the constant
`Nothing` (no storage, a constant on read). The IR type holds the positions;
the names come from the engine type, which the lowering reads where a field is
named. `joinType()` (`ir.ts`), the type equality of the verifier
(`verify.ts`) and the lane key (4.4) compare records field by field.

On JavaScript a record is an array of its fields, as a tuple is an array
today. A `nothing` field is `null` in the array. GLSL, the interval mode and
the `bigint` mode decline a value of lane `record` (`admits()` of `index.ts`).

The same kind gives a value to a `Tuple` of elements of two lanes
(`Tuple("a", t)`), which declines today. Rule: a `Tuple` of scalars of one
numeric lane stays the tuple of today (a list marked a tuple, a `vecN` on
GLSL); any other `Tuple` whose elements each have a settled IR type is a
record. A `List` literal whose elements have settled IR types of different
lanes (the `geom` of a label, `[x, y, "a"]`; of a curve, `[xs, ys, head,
tail]`) is a record too: today it declines (`[t, "a"]` is `list<real |
string>`, "not a scalar"), and its elements are read at constant positions
only. A `List` of one lane stays the list of today. So no program that
compiles today changes its code.

### 4.2 Making a record

- The constructor of a named tuple type (`P(k, g, m, a)`, the operator that
  `type P = tuple<…>` declares, signature `(kind: string, …) -> P`): a record
  of its operands, each lowered with the declared type of its field as the
  wanted type. An operand whose static type does not prove the field's
  declared type declines (R5).
- `Tuple` and `List` literals of mixed lanes (4.1).
- `Nothing` as the operand of a field: the field has the type `nothing`.

### 4.3 Reading a record

- `Field(r, "name")` and `At(r, k)` of a constant `k`: the field's value, of
  the field's IR type. Another index declines.
- `MatchesType(x, T)` (`x is T`) of any value whose IR type is settled: a
  constant, folded at compile time from the static type of `x` (or from the
  record's engine type). When the static type neither proves nor excludes
  `T`, it declines. This is not a test of a type at run time: the answer is
  known when the code is emitted.
- `Match` with arms of a constant (`== "rect"`, `== 3`), `_`, and a `Tuple`
  pattern of names: an arm of a constant is a `Which` clause on the subject
  (the string lane compares strings today); a `Tuple` pattern is selected at
  compile time by the shape of the subject (a tuple of its length matches, a
  scalar does not), and binds its names to the elements. A guard, a pattern of
  another kind, or an arm whose result has another shape than the others
  declines. When the subject is a constant (`fig.kind` of a record built from
  the literal `"circle"`), the fold keeps one arm and the shapes of the other
  arms do not count; this is the constant fold of today applied to a known
  subject, not a path of control flow.
- `If` whose condition folds to a constant keeps one arm, as above; an `If`
  whose arms give two record types declines (R3).

### 4.4 Records as arguments and results of user functions

A parameter typed `any`, `unknown` or of the record's engine type (`fig: any`,
`self: Figure`) takes a record: the function is lowered once per IR type of
its arguments, the lane key of today (`laneKey()` of `lower-functions.ts`)
extended with the record types. A result of no stated type, `any`, or the
record's engine type is the type of the body. The parameters of the prelude
that take a point (`c: any` read as `c[1]`, `c[2]`) are points by the rule of
today. A recursive function whose result is a record declines (its result type
is a fixed point that the lowering does not compute); `figureBox` over a group
is such a function, and a figure of kind `"group"` therefore declines.

### 4.5 Protocol methods dispatched at compile time

A call whose head is a protocol dispatcher (`isProtocolDispatcher()`) and
whose first operand is a record of engine type `T`: the compiler takes the
candidates of `protocolDispatchCandidates(ce, member)` and requires that
exactly one edge has a target that overlaps `T` (`typesOverlap()`), that this
target is a supertype of `T`, and that the edge is not conditional and has an
expression implementation. Then the dispatch of the interpreter, which picks
an edge by the run-time type of the receiver (a subtype of `T`), picks the
same edge for every value of `T`. `implementationLiteralAt()` gives its
literal, which is lowered as a user function (4.4), keyed by the edge and the
member. A constant default of a member (`about: any = figureDefault`) is the
argument of a call that leaves it out, as `fillParameterDefaults()` does for a
function. Two edges, a conditional edge, a host callback, or a first operand
that is not a record decline. Step 4 reads `dispatchMember` of
`engine-protocols.ts` to confirm that the interpreter's choice of an edge is
the one stated here, and adds a test where a second edge on a narrower type
makes the call decline.

### 4.6 Rest parameters

A call of a user function with a rest parameter (`function draw(...args)`) is
lowered per call site, the rest parameter bound to the record of the
arguments of that call (its length and the IR type of each element are known
there). `ListFrom(args)` of it is a value that only a host call can take
(4.7): a list of records of different types has no settled shape. Any other
read of it declines.

### 4.7 The host boundary

A host function (`docs/COMPILATION-MODEL.md`, "Functions of the host") takes,
in addition to scalars, an argument of lane `record`, a list or a tuple: the
compiled code converts it to the engine's value before the call, a record to
the application of its type's constructor (`["Figure", "'circle'", ["List", …],
…]`), the value of `ListFrom` to a `List` of the converted elements, `nothing`
to `Nothing`, a `color` (the run-time color object of today) to the
engine's color value. The conversion is one function of the runtime, `_SYS.box(type,
value)`, given the IR type at compile time. The rule of the result is not
changed: a host function must declare a result `nothing` or a scalar. Tycho
declares `figureDraw` `(any) -> nothing` (it is `(any) -> any` today).

### 4.8 The result of `run()`

Inside the compiled code a record stays the array of its fields (4.1). Where
the root function returns, the result is converted once to a JavaScript
object whose keys are the field names of the engine type:
`result.run(1)` of the `figure` program gives
`{kind: "circle", geom: [0.54, 0.84, 0.2], matrix: [1, 0, 0, 1, 0, 0],
fillPaint: null, strokePaint: null, strokePx: null, dashPattern: null,
alpha: null}`. A record in a field is converted the same way, a `nothing`
field is `null`, and a tuple with no field names (a `Tuple` of mixed lanes,
4.1) stays an array. The compiler emits the conversion from the IR type of
the result, so it runs only at the root, once per call.

Today a named tuple type of reals (`type P = tuple<x: real, y: real>`,
`f(t: real) = P(cos(t), sin(t))`) declines ("the result of f is not a
scalar (P)"), and an unnamed `(cos(t), sin(t))` returns an array. So the
rule is: a value of a named tuple type is an object at `run()`, an unnamed
tuple is an array, and no program that compiles today changes its result.

### 4.9 `N(x, p)`

`N` of a real, an integer or a rational on the real lane is its value; `N` of
a string, a boolean or a record is the operand. `N(x, 15)` in the interpreter
gives a machine number of 15 digits; the compiled double agrees within the
agreement of the target (1e-12 relative). `N` of a complex is the complex. Any
other operand declines.

### 4.10 Values settled per lowered function (step 4b)

Added 2026-11-23 (user decision) after step 4: in Tycho's prelude, only
`strokeWidth` and `opacity` compiled, because the bodies reached by the other
members test or compare values whose type is `any` in the source. A function
is lowered once per IR type of its arguments (4.4), so inside one lowered
function each such value has a settled IR type, and these operations are
decided when the code is emitted, with no test of a type at run time:

- `x is T` (`MatchesType`) of a parameter typed `any` or untyped, holding a
  record, a string, a colour or a number: decided from the IR type of the
  argument of that lowered function (a record by its nominal type, as
  `typesOverlap` and `isSubtype` decide on the engine types).
- `a == b` and `a != b` whose operands have different IR types that cannot
  be equal (a tuple of reals and a string, `about == figureDefault`): the
  constant `false` (`true` for `!=`), as the interpreter gives for values of
  those types; operands of one IR type compare as today. The interpreter's
  value for each pair of IR types is checked, not assumed.
- A parameter typed `any` or untyped takes a real or an integer (`k: any`
  holding `2` or `(2, 3)`), one lowered function per IR type, as step 3 does
  for records, strings and colours; a boolean stays as today.
- `N(x, p)` of a list or a tuple of reals is the list or the tuple (4.9).

A parameter with a declared union type (`c: string | color`) still declines
(the rule of `AGENTS.md`); Tycho declares it `any`.

Decided 2026-11-23 (user): a condition made only of tests decided from types
(`x is T`, a folded `==`, and `And`/`Or`/`Not` of them) lowers only the arm
taken (`docs/COMPILATION-MODEL.md` states the exception). A `list<real>`
parameter of a run-time length stored in a record field (`dash([t, 2])`)
keeps declining: one lowered function per length would change the code of
programs that compile today.

### 4.11 String constants settled in the IR type (step 4c)

Added 2026-11-23 (user decision) after step 4b: in Tycho's prelude (version
24), `rotate(t)`, `scale`, `reflect`, `skew`, `bounds`, `center` and `anchor`
decline because `figureKindBox` matches `fig.kind` at run time, so every arm
is lowered and the `"group"` arm declines; `stroke("blue")` and `rotate(t)`
decline because `w == figureDefault` and `about == figureDefault` compare a
string at run time and the arms give two record types. In each case the
string is a constant known when the code is emitted: the `kind` operand of a
constructor is a literal (`figureOf("circle", …)`), and a default is the
evaluated constant of the requirement.

- A string value whose value is known at compile time (a literal, a constant
  default, a field of a record built from such a value, a parameter of a
  lowered function whose argument is such a value) carries that value in its
  IR type. Two records whose constant fields differ are two IR types, and a
  function is lowered once per such type (the lane key includes the value).
- `==`, `!=`, `match` on constant arms and `x is T` whose operands carry
  known values fold to a constant, and the conditional lowers only the arm
  taken (4.10, decision above).
- A value that is not a constant (a string computed at run time, an `if` of
  two constant strings with a run-time condition) has the plain string type,
  as today.
- The constant is part of the type only where the lowering reads it; the
  emitted value is the string itself, so `run()` and the host see the same
  value as today.

## 5. What Tycho changes

- `Figure` is declared, as Tycho's prelude version 22 does (checked by
  Tycho on 0.200.0):
  `tuple<kind: string, geom: list, matrix: tuple<real, real, real, real,
  real, real>, fillPaint: string | color | nothing, strokePaint: string |
  color | nothing, strokePx: real | nothing, dashPattern: list<real> |
  nothing, alpha: real | nothing>`. `geom` stays `list`: per kind it holds
  reals, a string (label, path, svg), nested lists (curve), figures (group,
  canvas) or a raster (bitmap). Its shape in a record comes from the operand
  of the constructor (4.1, 4.2); a group or canvas declines (4.4).
- The parameters of the prelude's functions are typed where a parameter has
  one shape (the parameters that feed the matrix are typed, because a
  `tuple<any, any>` operand is refused at a `tuple<real, real>` field when
  the function is defined). Left `any`, with several shapes: `rotate`'s
  `about`, `scale`'s `k`, `stroke`'s `w`, the argument of `path` and `svg`,
  `canvas`'s figures and options, `figureBox`'s `x`, and the box helpers.
- `figureDraw` is declared `(any) -> nothing`.
- After step 4 (2026-11-23): the bodies that destructure the matrix into
  `let`s (`figureCompose`) read it by index or declare a local per element
  (`let a: real = m[1]`), because a local declared with no type widens a real
  to `number` (`docs/TYPE-SYSTEM.md`, "Initialization-defined Program and
  Block contracts"); and a parameter typed `string | color` is typed `any`.
- A field typed `string | color | nothing` has no settled shape by its type, so the
  compiler takes its shape from the operand of the constructor (4.2), as for
  `any`: a filled and an unfilled circle are two record types, and an `if`
  that mixes them declines (R3). Removing `nothing` from the style fields
  (`""` for none) would let it compile; that is a separate decision, taken
  only for a notebook that needs it.
- After the CE release, Tycho runs its instrument
  (`scripts/repros/2026-11-20-ce-compile-figures.mts`) and AN10 of
  `requirements/archive/EPSIL_ANIMATION.md`, and removes the marker that cites
  CE-1652 in `compiledTick` of `ce-notebook-evaluator.ts`.

## 6. Steps

Each step is one commit with its tests and its README section, and leaves
every program that compiles today with the same code.

1. `N` (4.9), `MatchesType` folded (4.3), `Match` of constants and `Tuple`
   patterns (4.3). Useful alone; size S.
2. The record kind (4.1), its construction (4.2) and reads (4.3), the record
   result (4.8), the decline on the other targets. Size M.
3. Records as arguments and results of user functions (4.4). Size M.
4. Protocol methods (4.5). Size M.
4b. Values settled per lowered function (4.10). Size M.
4c. String constants settled in the IR type (4.11). Size M.
5. Rest parameters and the host boundary (4.6, 4.7). Size M.
6. The acceptance tests (section 7), `docs/COMPILATION-MODEL.md` (the paragraph
   that says that a function that builds a `Figure` declines is replaced by
   the rule of records), the CHANGELOG entry, the Tycho answer in the issue.

The whole is size L, as the issue says.

## 7. Acceptance

`test/compute-engine/compile-records-acceptance.test.ts` holds a reduced
prelude copied from Tycho's prelude version 25, not imported: the type
`Figure`, the protocol `Drawable` (`translate`, `rotate` with
`about: any = figureDefault`, `rotateAbout`, `scale`, `fill`, `stroke`,
`strokeWidth`, `dash`, `center`), `figureOf`, `figureCompose`,
`figureTransform`, `figureTransformAbout`, `figureRotation`, `figureScaling`,
`figureBox`, `figureKindBox` and `figureBoxCenter` (the box read by index,
`box is nothing`), `circle`, `label`, `group`, `bitmap`, and
`draw(...args) -> nothing { figureDraw(listFrom(args)) }` over a host
`figureDraw` declared `(any) -> nothing`, `pure: false`, that records its
argument. Each case is compiled on JavaScript with `fallback: false`, and the
value of `run()`, or the argument that `figureDraw` receives, equals the
interpreter's: numbers within 1e-12, structure exact.

| Program                                                                     | Outcome                                                                 |
| --------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `t => circle((cos(t), sin(t)), 0.2)`                                        | compiles; an object with the field names                                |
| `t => circle((2, 0), 0.2).rotateAbout(t / 1000, (0, 0))`                    | compiles                                                                |
| `t => circle((0, 0), t).fill("red").translate((1, 2))`                      | compiles                                                                |
| `t => circle((0, 0), t).fill(rgb(t, 0, 0))`                                 | compiles; `fillPaint` is the compiled colour, the other fields agree    |
| `t => circle((t, 0), 1).center()`                                           | compiles                                                                |
| `t => draw(circle((cos(t), 0), 0.1))`                                       | compiles                                                                |
| `t => draw(circle((t, 0), 1).rotate(t))`, `.scale(2)`, `.stroke("blue")`    | compiles                                                                |
| `t => draw(circle((0, 0), t).fill("red").translate((1, 2)))`                | compiles                                                                |
| `t => draw(circle((0, 0), 1), circle((t, 0), 0.5).fill("red"))`             | compiles (two record types in one `draw`)                               |
| the orbit of Tycho's `EPSIL_ANIMATION.md` § 1, the three figures built once | compiles                                                                |
| the Game of Life state update, n = 12, `t => do { g = step(g) }`            | compiles; `g` equals the interpreter's after five ticks                 |
| `t => draw(circle((0, 0), 1), label((0, 1), "a"))`                          | declines: the parameter `geom` of `figureOf` is not a scalar (list)     |
| `t => draw(circle((0, 0), t).fill(rgb(t, 0, 0)))`                           | declines: a colour at the host (the compiled colour is in OKLCh)        |
| `if t > 0 { circle(…) } else { label(…) }`                                  | declines: the label's `geom`, as above                                  |
| `if t > 0 { circle(…) } else { circle(…).fill("red") }`                     | declines: arms of two types (R3)                                        |
| a figure of kind `"group"` (`draw`, `.rotate(t)`, `.center()`)              | declines: the group's `geom`, a list of figures, at `figureOf`          |
| `t => draw(circle((0, 0), 1).dash([t, 2]))`                                 | declines: a record with a field of a run-time length (user decision)    |
| `t => do { g = step(g); draw(bitmap(g, …)) }`                               | declines: a host call in a function that assigns a variable of the engine (user decision; Tycho compiles the update and interprets the `draw`) |
| every case that compiles, on GLSL and `interval-js`                         | declines: records, strings, rest parameters and engine assignments compile on JavaScript only |

The orbit is
`draw([orbit, sun, earth.rotateAbout(t / 1000, (0, 0))])`, with
`sun = circle((0, 0), 0.5).fill("orange")`,
`earth = circle((2, 0), 0.2).fill("blue")` and
`orbit = circle((0, 0), 2).stroke("gray")` declared by `let` before the
callback. A `label` and a colour at the host decline by the rules of step 5,
and a group declines at its geometry before its recursive `figureBox` is
reached.

## 8. Risks

- The cost of lowering the prelude bodies at each compilation. A callback
  calls a few functions of the prelude; each is lowered once per IR type. To
  be measured at step 5 on the acceptance cases (time of `compile()`).
- The lane key grows with records: a key must stay a function of the IR type,
  so two calls with records of one type share one lowered function.
- `implementationLiteralAt()` has had no caller since the old compiler was
  retired; its tests must be added in step 4.

## 9. Choices (decided by the user 2026-11-23)

- **Q1.** The result of `run()` for a record: (c) a JavaScript object with
  the field names, converted at the root only (4.8). Rejected: (a) the array
  of the fields (the host needs the static type to name them); (b) the
  engine's MathJSON (a conversion of the whole value at each call). A host
  that draws reads the argument of `figureDraw`, which is the engine's value.
- **Q2.** The style fields of `Figure`: (b) Tycho types each field and each
  parameter of the prelude, and `nothing` stays in the type of the style
  fields (section 5). Rejected: (a) the fields stay `any`.
- **Q3.** GLSL: (a) declines a record; records compile on JavaScript only.
  Rejected: (b) a `struct` per record type.
