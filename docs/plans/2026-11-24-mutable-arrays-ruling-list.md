# Mutable arrays (`array<T>`): ruling list

Status: DRAFT. No ruling below is approved. Written by session
`compute-engine-3d` on 2026-11-24 at
`cc0809c8976820647672d97c41337982a320dc3a`; the user approved the writing of
this list, not its content.

`docs/TYPE_SYSTEM_ROADMAP.md`, Appendix B, "Ref cells and mutable
collections", says that `array` lands after objects "as a follow-on with its
own short ruling list". This is that list. Appendix B stays the normative
text for what it already states about arrays (identity, the `state` effect,
the version counter, invariance in `T`, cache exclusion, lifetime, cycles, and
its five points: collection integration, effect-directed traversal, the growth
and mutation API, construction, compilation). This note does not restate
them. It adds the rulings that the first consumer needs.

The first consumer is Tycho's raster
(`~/dev/tycho/requirements/todo/EPSIL_RASTER_IMAGE.md`, not approved): an
object `object{width: integer, height: integer, pixels: array<integer>}`
defined in Tycho's prelude, whose pixels a timer callback writes in compiled
code, an event handler writes in the interpreter, and the host shows. Its
section "Requests to CE" lists ten needs; each ruling below names the ones it
answers as T1 to T10.

Section 4 lists the questions that need a decision of the user. Every other
ruling has one option that I take as sound; the alternatives are given so the
user can reverse it.

## 1. What exists today

Probed at the commit above.

- Objects work in the interpreter (`type T = object{…}`, a field store, the
  `state` effect, identity `==`). Compiled code declines them: `DeclareType`
  "is not supported by the compiler". The compile boundary is Phase 4 of
  `docs/plans/2026-08-13-mutable-objects-implementation-plan.md`, not done.
- `array` is not implemented: the type annotation gives
  `Unknown type "array"`, `ArrayFrom([1, 2, 3])` stays unevaluated, and the
  library has no operator named `Array`, `ArrayFrom`, `Push`, `Pop` or
  `RemoveAt`.
- The Epsil parser gives these forms:

  | Source         | MathJSON                                  |
  | -------------- | ----------------------------------------- |
  | `a[i] = v`     | `Assign(a, ReplaceAt(a, i, v))`           |
  | `s.px = v`     | `Assign(Field(s, "px"), v)`               |
  | `s.px[i] = v`  | `Assign(At(Field(s, "px"), i), v)`        |
  | `a[i] += v`    | `AddTo(At(a, i), v)`                      |

- With `s` an object whose field `px` is a list, `s.px[2] = 9` is the run
  error "expected `symbol`, got `integer`", and `t.px[3] += 5` is the static
  error `add-to-target`.
- Compiled code declines a function value passed as an argument to a user
  function (`docs/COMPILATION-MODEL.md`, "Function values"; user decision of
  2026-11-02).
- Measured on a frame of 320 × 200 (64,000 cells):

  | Program                                                                  | Time                         |
  | ------------------------------------------------------------------------ | ---------------------------- |
  | Compiled loop that writes a block-local list and returns it              | 0.32 ms a frame              |
  | Compiled loop that calls a host function for each cell                   | 130 ms a frame (2 µs a call) |
  | Interpreted `fb[k] = v` on a list variable of 5,000 cells                | about 1 ms a write           |
  | The same on 20,000 cells                                                 | stack overflow (CE-1796)     |
  | Interpreted store to a list field of an object, 64,000 cells             | about 7 ms a store           |

  Tycho measured the same routes on 0.201.3 with
  `~/dev/tycho/scripts/repros/2026-11-24-epsil-raster-host-call-cost.mts`.

## 2. Rulings

### AR1. Cells and storage (T1, T4)

The declared cell type selects the storage.

- **A bounded integer type** whose range fits one of `Uint8Array`,
  `Int8Array`, `Uint16Array`, `Int16Array`, `Uint32Array`, `Int32Array`: the
  cells are machine integers in the narrowest of these that holds the range.
  `array<integer<0..255>>` is a `Uint8Array`;
  `array<integer<0..4294967295>>`, the type of a packed `0xRRGGBBAA` pixel,
  is a `Uint32Array`. Every value of the type is exact in its cell, so the
  interpreter gives the values it gives for a list.
- **`real`**: see question Q1.
- **Every other cell type** (`integer` with no bound, `rational`, `number`,
  `string`, an object type, another array): the cells are evaluated
  expressions, as the slots of an object are. Compiled code declines such an
  array.

The cell type is the declared one (`let px: array<integer<0..255>> = …`, a
field type, a parameter type). `ArrayFrom(xs)` with no declared type takes
the element type of `xs`, so `ArrayFrom([0, 0])` is an `array<integer>` of
expression cells. A host or a prelude names its cell types with a type alias.

A store is O(1) in time and in stack, in the interpreter and in compiled
code, for every storage. This is the guarantee that Appendix B asks of the
type ("an asymptotic guarantee has to be semantics").

In the interpreter a store checks the value against the cell type and gives
the error of a value outside a declared type. Compiled code makes no test of
the range, as it makes none of a declared result type today
(`function f(x: integer) -> integer<0..10> { x }`: `f(300)` is an error in
the interpreter and `300` compiled). A value outside the cell type is an
error that the static type does not show, which the caveats of compiled code
leave unspecified: the typed array stores what JavaScript stores, so a
`Uint8Array` cell keeps the low 8 bits of 300. A value of another lane (a
real for integer cells) declines, as for a list local.

So a store in a compiled loop never pays a test, whatever the static type of
the value. The static type seldom proves a range: the type handlers keep four
significant digits, so `r*16777216 + g*65536 + b*256 + a` with each operand
an `integer<0..255>` is typed `integer<0..4296000000>`, and `Mod(x, 256)` is
typed `integer`. A pixel function declares its result type
(`-> integer<0..4294967295>`) so that the interpreter checks it.

Alternative, not taken: compiled code tests the range and throws, unless the
static type proves it. With the types above, nearly every store would pay the
test or need a declared result type.

Alternative, not taken: one storage for all arrays, a plain JavaScript array
of numbers. It is simpler, and the host then converts every pixel at every
frame (T1).

### AR2. The indexed store

`Assign(At(base, i), v)` is the store when `base` evaluates to an array:
`p.pixels[i] = v` parses to it today. `AddTo(At(base, i), e)` reads the cell,
adds and stores, with `i` evaluated once.

For a target that is a name, `a[i] = v`, see question Q2.

A binding declared `const` that holds an array accepts a store, as a `const`
object accepts a field store: the binding does not change.

`ReplaceAt(a, i, v)` of an array is a value, a list with the cell replaced,
and stores nothing: an operator over an array gives an immutable result
(Appendix B, "Results stay immutable").

An indexed store through a list field (`s.px[2] = 9`, `px` a list) stays an
error, with the diagnostic `immutable-value-assignment` and its two remedies
(store a new list in the field, or declare the field an array). Today's
message is filed as CE-1797.

### AR3. The index

The index contract is that of a list: 1-based, a negative index counts from
the end, and an index that is 0, out of range or not an integer is an error
in the interpreter and throws `out-of-range` in compiled code. A store never
grows the array.

An array has one dimension. A grid is arithmetic on the index, written by the
program (`(y - 1)*w + x`), as for the list read of the shader targets
(`docs/plans/2026-09-05-sampler-backed-positional-access.md`, "Layout").

### AR4. One store for the interpreter, compiled code and the host (T3, T7)

The cells of an array exist once. The interpreter, compiled JavaScript and
the host read and write the same storage.

- Compiled code takes an array by reference: one that a variable of the
  engine holds, one that a field of an object holds, one passed as an
  argument. `run()` copies no cell at its start or at its end. This extends
  ruling B9 ("parameters in") to a name that the code reads.
- A compiled unit keeps no array of its own between two calls. In one kept
  run of a Tycho cell a timer tick is compiled, an event handler is
  interpreted and a debug tick is interpreted, and the three write the same
  cells.
- `ArrayFrom` in compiled code makes the engine's array value, with one call
  into the engine. Every array that compiled code holds is then an array of
  the engine, so a store of an array reference to a field (`p.pixels = next`,
  T7) and an array argument of a host function need no conversion.
- Compiled code reads the storage from the array at each use, not once for
  the unit, so a field store that exchanges two arrays needs no alias
  analysis.

### AR5. The version counter and the state event (T2)

Each array has its own version counter, as Appendix B says; a store of a
cell increments it and changes no field of an object that holds the array.
Compiled code increments it at each store (one addition).

A compiled unit that can store registers one state event when `run()`
returns and before each host call it makes, not one for each store. The
interpreter registers one for each store, as for a field store; if the
instrument of stage 1 shows that this cost depends on the number of
dependents, the interpreter coalesces to one event for each statement.

### AR6. What compiles (extends B9)

On the `javascript` target, for an array of machine cells:

- `At`, the indexed store, `AddTo` of a cell, the count, `ArrayFrom` of a
  list or of `Repeat(v, n)`, and `ListFrom(a)` (a copy to the list carrier).
- An array, an object that holds one, and a record that holds one (a Tycho
  `Figure`, T6) as an argument of a host function: the host receives the
  value of the engine, the same reference as in the interpreter.

These decline: an array as the result of a unit (B9); an array of expression
cells; a collection operator over an array (`Map`, `Filter`, `Sum`, …), until
the traversal rule of Appendix B is implemented for compiled code, so a
program writes an index loop or takes `ListFrom(a)`; a host call whose result
is an array (a photo or a file is loaded by an interpreted statement of the
program, T8); the GLSL target, `interval-js` and the `bigint` mode.

The field reads and stores of the object that holds the array are Phase 4 of
the objects plan, which this list needs on `javascript` only.

### AR7. The host interface (T1, T2, T8, T9)

The public interface gives a host, with no member whose name starts with an
underscore:

- from an array value: its storage by reference (a typed array for machine
  cells), its version and its length, each in O(1);
- a constructor that adopts a typed array as the storage of a new array, with
  no pass over the cells (a decoded photo, the bytes of a file);
- an engine option, a function called before each allocation of array
  storage with the number of cells and the bytes of a cell; when it returns
  false the construction is an error. The host keeps the total (T9). The
  engine does not track the arrays that are alive.

The storage that a host reads is valid until the array grows (AR9); a host
reads it at each use.

### AR8. Serialization and display (T5)

The default of Appendix B (B5) holds: an array converts to its `ListFrom`
snapshot under the provenance head. Two additions:

- The serializer option of Phase 3 of the objects plan (candidate spelling
  `objects: 'record' | 'reject'`) also takes a function from the object or
  the array to the MathJSON written in its place. A host that sends a figure
  to another thread writes a reference of its own there and sends the storage
  beside it.
- A display serializer (`print`, the Epsil form of a value, the text of a
  result) writes the type and the count of an array of more than 16 cells,
  not its cells: `array<integer<0..255>> of 64000`.

### AR9. Stages

1. Interpreter: the type, `ArrayFrom`, the read, the store, the count,
   `ListFrom`, the storages of AR1, the version, the host interface, the
   display. Acceptance: Tycho's instrument, with a store whose time does not
   depend on the length.
2. `javascript`: AR4 to AR6, with Phase 4 of the objects plan.
3. Growth (`Push`, `Pop`, `Insert`, `RemoveAt`) and the traversal rule of
   Appendix B. A raster does not need them.

## 3. Not in this list

Each of these comes from Tycho's proposal and is a separate item. None is
filed: the proposal is not approved.

- A function literal passed to a user function that calls it in a loop
  declines in compiled code (`docs/COMPILATION-MODEL.md`, "Function values";
  user decision of 2026-11-02). Tycho does not wait for it: `compute` and
  `adjust` stay host functions, which compile the pixel function themselves
  for JavaScript and for GLSL (T7). A user who writes a whole-raster helper
  of their own meets the decline.
- Bitwise operators on integers, with one meaning on JavaScript and on GLSL
  (T10). The library has only the boolean `Xor`.
- On GLSL (T10): a `uint` lane, a read at `(x, y)` of a texture of four 8-bit
  channels or of one `uint` channel, a color result with alpha, and a
  filtered `sample`. A shader never reads an array (B9): it reads the
  `ListFrom` snapshot that the host uploads.
- CE-1796, the interpreted element write of a list variable.
- The decline of a host call "in a function that assigns a variable of the
  engine" (`docs/COMPILATION-MODEL.md`, "Functions of the host").

## 4. Questions for the user

**Q1. What does `array<real>` store?** The witness is a table of reals that
a compiled loop writes: the depth of each column of a raycaster, a table of a
dynamic program.

- (a) Doubles, in a `Float64Array`. A store writes the machine number of the
  value, as the write-back of a compiled function does today. The interpreter
  then gives `0.3333333333333333` for `a[1] = 1/3; a[1]`, where a list keeps
  `1/3`. A program that wants exact cells declares `array<rational>` or
  `array<number>`. Recommended.
- (b) Expression cells. The values are those of a list, and compiled code
  declines the array.

**Q2. Which form does `a[i] = v` have when `a` is a name?** The parser cannot
know that `a` holds an array, and today's form rebinds `a`, which fails for a
`const` array and reads `ReplaceAt` as a copy.

- (a) The parser gives `Assign(At(a, i), v)` for every target. On an array
  it is the store; on a name that holds a list it is today's rebinding, with
  the same values. The MathJSON of a list element write changes, and the
  compiler reads both forms. The number of tests and snapshots that change is
  not measured. Recommended.
- (b) The parser keeps `Assign(a, ReplaceAt(a, i, v))`, and a program writes
  a store to an array only through a field or a method (`p.pixels[i] = v`,
  `a.set(i, v)`).

The form of 2026-11-06 was a user decision, so (a) needs the user's word.
