# Compilation Model

**Status:** normative internal reference for implemented compilation behavior.

## Caveats of compiled code

Compiled code is a fast numeric approximation of the interpreter, not a
second implementation of it. A host that needs the interpreter's exact
result calls the interpreter. The host accepts the differences listed here
when it compiles. A difference that this list does not name is a defect.

**Allowed differences.**

- The precision of the target: `f32` arithmetic on `glsl` and `wgsl`, a
  different order of summation, a different library routine for `Sin`,
  `Exp` or `Gamma`.
- A value where the interpreter gives no number. Where `evaluate()` gives
  `Missing`, `Nothing`, `Indeterminate`, an unevaluated form or an error,
  the compiled code can give `NaN`, `0`, `±Infinity`, `undefined` or
  `null`, can throw, or can decline. With `q: real | missing` and `q`
  absent, `Sqrt(q)` can give `0` on `javascript` where the interpreter
  gives `NaN`.
- A value for an input that holds a value outside its declared type, for an
  input left out, or for an error that the static type does not show.
  "Fail closed" below lists these cases; they were never specified.

**Not allowed.** For a program with inputs of their declared types, a finite
number that differs from the interpreter's by more than the precision of the
target, or a result of another shape (a number for a list, a list of another
length, a real for a complex). A `Sum` that skips a term, or `[1, 2] + 1`
that gives `3`, is a defect on every target.

**A decline is always allowed.** A target that cannot give the value within
these caveats declines, and the host gets the interpreter (with fallback) or
the diagnostic. A decline is the preferred fix for a case that would need a
handler of its own: it costs the host speed on that expression and nothing
else. "The decline stays" is a valid resolution of a reported difference,
recorded with its witness in the known-limitations list below or in
`ROADMAP.md`.

**Witness.** A reported difference names the program that shows it and the
strength of that witness:

- `corpus`: a Tycho document or ledger row, a GitHub issue, a benchmark, or
  a program a host sent;
- `plausible`: a program of one or two lines that a user would write, with
  the inputs declared as a host declares them;
- `crafted`: a program built to reach the case, where a type union, a
  target and a construct are chosen together.

A `crafted` witness of an allowed difference is not a defect and is not
recorded. A `crafted` witness of a wrong finite value or shape is one line
in the known-limitations list below, not a `ROADMAP.md` entry: it is fixed,
by a decline or a handler, when a stronger witness appears. A `corpus` or
`plausible` witness of a wrong finite value or shape is a defect: fixed at
once, or a `ROADMAP.md` entry.

### Known limitations

One line each: the target, the program, the compiled value, the
interpreter's value. A line is removed when the case declines or is fixed.

- `javascript`, `x: real | nan`: `Arcsec(x)` and `Arccsc(x)` at `x = 0.5`,
  and `InverseHaversine(x)` at `x = 4`, compile to the real lowering
  (`Math.acos(1 / x)`, `2 * Math.asin(Math.sqrt(x))`) and give `NaN`; the
  interpreter gives a complex value (`Arcsec(0.5)` is `1.3170i`). With
  `x: real` the same programs take the complex lane and agree.
- `javascript`: in a loop with an outer `a = 100`, `function f() { a }` and
  `let (a, b) = (k, f())`, the compiled `b` is `k`; the interpreter gives
  `b = 100` (was CE-756).
- `javascript`: `Map(t ↦ 7, LL)` with `LL: list<list<real> | missing>` holding
  `[[1, 2], [3]]` gives `[[7, 7], [7]]`; the interpreter gives `[7, 7]` (was
  CE-742).

## Fail closed

Compilation is an optional acceleration route. A target emits code only when
it can give the interpreter's value within the caveats above, with the
interpreter's effects and evaluation count. Unsupported heads,
representations, guards, or numeric lanes decline with a structured
diagnostic. They never emit code that gives a wrong finite value or a wrong
shape for a program with inputs of their declared types.

With fallback enabled, a decline returns an interpreted runner. With fallback
disabled, the decline is visible to the caller. Runtime exceptions from
successfully compiled user code are not silently reinterpreted.

**What is guaranteed.** For a well-typed expression whose inputs are
supplied and hold values of their declared types (or, for an input with no
declaration, the type that the engine infers), the compiled value is the
interpreter's value within the caveats above. An expression that has a sub-expression that is invalid,
or whose static type is `error`, declines on every target: `"ab" + u` and,
with `ADD = (x, y) ↦ x + y`, `ADD("ab", u)` both decline. The result of the
decline has the token `ErrorCode` in `unsupported`, which a host reads to tell
an error in the expression from an operator that has no lowering
(`throwStaticTypeError()`, `compilation/compile-static-type-error.ts`; the
token is added by `buildInterpreterFallback()`,
`compilation/compile-references.ts`); its diagnostic has the code
`'static-type-error'` and the kind `'correctness'`. The check walks into every
operand, which includes every `If`/`Which` branch, the bodies of function
literals and the values of a dictionary: `If(u > 1, ADD("ab", u), 1)` declines,
also when the branch is not taken. It also walks into the body of each user
function, and into the stored value of each symbol, that the code reaches by
a name that is free where it occurs (the compiler emits that body and
inlines that value). A name bound where it occurs (a parameter, the index of
a `Sum`, a name that a `Block` statement assigns, after that statement, a
`vars` key, a function or an operator that the caller replaces) is not
followed to its global definition. Every node, a bound symbol and a call of
a bound name included, still declines when its own static type is `error`.
Type inference can read that type from the global definition of the name, so
this simple version can decline where the interpreter has a value: with a
global `G` whose body has the type `error`, `G() + u` with `G` replaced
through `functions` declines; a symbol that a `Block` assigns, such as `v` in
`Block(v := 1, v + 1)`, declines in the same way when its stored value has
the type `error`. The value of an assignment reads the outer name:
`Block(G := Equal(G(), 1), G)` calls the global `G`. The check does not go
into a `Hold`.
Every other case is unspecified: the compiled code can give any value,
`NaN`, or throw, and the host validates its inputs if it needs to.

- An error that the static type does not show: `If(u > 1, "ab", 1) + 1` (its
  static type is `integer`) can give `"ab1"` on `javascript`;
  `Sum(p, k = 1..u)` with `p: boolean` can give `2`.
- An input value outside its declared type: `"ab"`, `true`, `[1, 2]` or
  `{re, im}` for an input declared `real`.
- A non-finite value for an input declared `real` (`real` holds only finite
  values): the `javascript` target computes as for an input declared
  `real | signed_infinity | nan`; a GPU target can assume a finite value
  (`a - a` is `0`, `a/a` is `1`). `NaN` and `±Infinity` keep their meaning
  in an input declared `real | signed_infinity | nan`.
- A value outside a declared range (`7` for `real<0..5>`): the `javascript`
  target computes with the value; a GPU target can use the range (it can
  drop `|x|` for `x` in `real<0..5>`).
- An input left out (see `docs/ERROR-MODEL.md`, "An unsupplied variable").

**One exception: a `number` result of the `bigint` mode.** In the `bigint`
compile mode of the JavaScript target, a `bigint` or a `boolean` result is
the value of `evaluate()`. A `number` result (`NaN` or `Infinity`) means
that a sub-expression had no finite value, and it need not equal the value
of `evaluate()`: with `n: integer`, `n! > 5` at `n = −1` gives `Infinity`,
and the interpreter gives `False`. A `bigint` cannot hold a non-finite
value, and the one catch that returns the `number` skips every operator
between the pole and the result. See "Compile modes", "The `bigint` mode".

**An input with no type declines.** The compiled code reads each input (a
free symbol of the code, as `freeSymbols` lists it) in one shape, and the
shape comes from the type of the input. An input whose static type is
`unknown` or `any`, because nothing declares it and nothing infers a type for
it, declines on every target: with `M` undeclared, `If(M < 3, M, 0)`
declines, where the code read `M` as a number and gave `0` for `M = [1, 5]`
(the interpreter gives `[1, 0]`). The `unsupported` list of the result has
the name of each such input (`["M"]`), and the diagnostic has the code
`'untyped-input'` and the kind `'correctness'`. A host declares the input
(`ce.declare("M", "real")`). A declared union of shapes
(`real | list<real>`) is a type, and is not refused. A parameter of a
function literal, of a user function or of the root function is not an input
and is not refused: `t ↦ 2t` compiles, and a list passed to its untyped
parameter is a value outside the type that the body implies (`2t` reads a
number), so the result is unspecified. The parameter names passed to
`compileFunction(expr, name, params)` are inputs, not the parameters of a
root `Function` literal: the host chooses them and passes their values, so
their types come from the engine's declarations, and a name whose type is
`unknown` or `any` declines with `'untyped-input'`. With `i` declared `any`,
`compileFunction(At(b, i), "f", ["b", "i"])` declines. A host that wants an
untyped parameter compiles a root `Function` with a `Typed` parameter
instead. A transparent alias of `unknown` or
`any` (`ce.declareType("U", "unknown", { alias: true })`) is that type, so
an input declared `U` declines. A local of a function body is not an input,
also when only a nested block (a loop body, a branch) assigns it. A name
that only a nested statement of a block outside a function body assigns (a
branch of an `If`) is an input: with `b` undeclared,
`Block(If(a < 1, b ≔ 1); b)` declines, because the compiled code reads the
input `b` at `a = 2`, where the interpreter has no value for `b`. The variable of an indefinite
integral (`\int x^2 dx`) is an input, with the type of its declaration
outside the integral. A name that the code assigns and that no scope of the
expression binds is an input, also when the code only writes it: with `u`
undeclared, `u ≔ If(x < 0, u, 0)` declines. An assignment to a local of the
same name (a loop index, a local of a nested block) does not write the
input. A value that the code assigns to an input must have the shape of the
type of the input, declared or inferred, or the compilation declines with
the code `'unsettled-shape'`: inference reads the type from a read of the
name, and does not see the values that the code assigns. With `x: real` and
`p` undeclared, `Block(If(x > 0, p ≔ [1, 2], p ≔ [3, 4]), 2p)` declines: the
read `2p` gave `p` the type `number`, and the code gave `null` where the
interpreter gives `[2, 4]`. An input that the code assigns values of the
shape of its type compiles: `Block(Loop(acc ≔ acc + i, i ∈ 1..5), acc)`. The
check runs after the code was generated: when the expression also declines
for another reason (an operator with no lowering, a value with no settled
shape, a timeout), that reason is the `error` and the diagnostic, and
`unsupported` also has the names of the inputs with no type. In both cases
the compilation declines. The check is `assertAdmitted()`
(`compilation/compile-admission.ts`).

**A value with no settled shape declines.** The compiled code gives each
value one shape, which its static type settles. An `If`, a `Which` or a
`Match` whose branches have conflicting shapes (a number and a list, a point
and a list of points) declines on every target: `If(x > 0, [1, 2], 3) + 1`
declines, also when the conditional is in the
body of a user function that the code calls. The `unsupported` list has the
conditional as `toString()` writes it, and the diagnostic has the code
`'unsettled-shape'` and the kind `'capability'`. The values that a function
body or the root can give (the value of each `Return` that belongs to it,
also through a `Loop`, and its last value), and the values of the `Break`
statements of a `Loop`, are compared in the same way, and a `Return` of a
nested function literal belongs to that literal: with `M: list<real>`,
`At(Apply(a ↦ Block(If(Length(a) > 1, Return(First(a))), Reverse(a)), M), 1)`
declines, because the body gives a number or a list. This simple version
compares only the branches whose type settles a shape: a branch of type
`unknown`, `any`, `broadcastable<T>` or a union of shapes (the result of a
user-function call that the code tests at run time) is not compared, and a
conditional over a collection condition, which selects element by element,
is not checked when its branches change nothing. When a branch of such a
conditional assigns a name or has a `Return`, a `Break` or a `Continue`, it
declines with the code `'unsettled-shape'`: the compiled code cannot run a
branch for some elements only. With `L: list<real>`,
`Block(p ≔ 0; If(L > 0, p ≔ 5); 2p)` declines. A condition of type `any`
can be a list, and the interpreter then selects element by element: with
`M: list<any>`, `Block(p ≔ 0; If(M[1], p ≔ 5); 2p)` declines. A condition
of type `unknown` (an untyped parameter of a function literal) is read as a
boolean, so the branches of its conditional are compared as alternatives.
On the targets that are not shaders, a conditional whose
value the code discards is not checked: a statement of a `Block` that is not
its last one, the body of a `Loop`, and a branch of such a conditional. An
`Assign` has the type of its value, and
`Block(p ≔ (0, 0); n ≔ 0; If(x > 0, p ≔ (1, 2), n ≔ 3); n)` compiles.

The compiled code gives each variable one representation, which its type
selects. So, in one scope, the values that the code assigns to a name, and
the type of the name (declared, or inferred from its uses), must have one
shape class: a number, a complex number, a string, a list, a point or a
matrix. The length of a list is not part of its shape, so a local assigned
`[1, 2]` and then `[1, 2, 3]` compiles. Otherwise the compilation declines
with the code `'unsettled-shape'`. With `x: real`,
`Block(p ≔ 0; If(x > 0, p ≔ [1, 2]); 2p)` declines, and so does
`Block(p ≔ 0; p ≔ [1, 2]; p)`, although the interpreter gives `[1, 2]`: the
order of the assignments and the paths of the code are not examined. A
declared type settles the shape of a local: `Block(Declare(p, "real");
p ≔ (x, 2); p)` declines. A type that a `Declare` states and that admits
several shapes (`real | list<real>`, `broadcastable<number>`) is not
checked, as a declared union of an input is not refused. The parameter of a
function literal has the type of the parameter (and, for a literal that
`Apply` applies where it is written, the type of each scalar argument), so
`p ↦ Block(Loop(p ≔ [i, i], i ∈ [1, 2, 3]); 2p)` declines. A name is a new
variable only where it is certainly one: a parameter of a function literal,
a name that a `Declare` of a `Block` declares (in that block), and the index
of a clause. Every other occurrence of a name is the same variable, so two
locals of the same name with no `Declare`, in two function bodies, are
compared as one. This is the simple, sound version of the rule (ROADMAP
CE-724 lists what a precise version would accept).

Some assignments decline with the code `'unsettled-shape'` whatever their
shapes, because the interpreter and the compiled code do not agree on their
effect:

- In the body and in the clauses of a `Comprehension` (except the source of
  its first clause), in the clauses of a `Sum` or a `Product`, and in the
  integrand and the bounds of an `Integrate`, an assignment of a name of an
  enclosing scope, a `Return`, a `Break` or a `Continue`. The interpreter
  evaluates the body of a `Comprehension` in a scope of its own, so
  `Block(p ≔ 0; Comprehension(Block(p ≔ 5, i), i ∈ [1]); p)` is `0`; the
  compiled code of the integrand of an `Integrate` is a function of its own,
  where the interpreter changes the outer name. A name that the part binds
  (a name that a `Block` of the part declares, a parameter or a loop index of
  the part) is not a name of an enclosing scope. A local that a block of the
  part assigns with no `Declare` counts as one (ROADMAP CE-721). A `Return`, a
  `Break` or a `Continue` in the body of a `Sum` or a `Product` declines too:
  the compiled body is an expression, not a loop body (CE-721).
- In a function literal, an assignment of a name of an enclosing scope (or
  of an element of one), or a `Break` or a `Continue` that leaves it. In a
  callback (`Filter`, `Map`, `Tabulate`, `Limit`, …) the two do not agree:
  for `Filter` the interpreter does not run the callback when the result is
  not used, and for `Limit` the compiled code does not change the outer name
  (CE-720). A function can reach a callback operator in many ways (stored
  and passed by name, behind an `If`, returned by another function), so
  every such literal declines: a callback, the value of a `Declare` or an
  `Assign`, a function returned by another one, and the body of a user
  function that the code calls. Two are exempt: the root of the
  compilation, and a function that `Apply` applies where it is written,
  whose body runs once as inline code. That one still declines when a
  `Break` or a `Continue` leaves it, or when an argument is not known to be
  a scalar (it can then map over the argument and run its body zero or more
  times) and it assigns a name of an enclosing scope. A local of a function
  or of a block (a name that it declares or assigns first, with a binding
  of its own) is not a name of an enclosing scope: two user functions that
  each assign a local `t` compile.
- In a function literal, an assignment of the index of a `Loop`, a `Sum`, a
  `Product`, a `Comprehension` or an `Integrate` that encloses the literal
  (CE-723).
- In a branch of an `If` or a `Which` whose condition is or can be a
  collection, an assignment, a `Return`, a `Break` or a `Continue` (CE-722).
- A `Return` inside a `Loop`, unless that loop is the only loop around it, is
  the last statement of the function (or of the root), and has no indexing
  set: the compiled loop is a function of its own, so the `Return` ends only
  the loop, and the code after the loop would still run (CE-719). A loop
  with an indexing set declines also when it is the last statement, because
  it gives `Nothing` when it ends with no `Return` (see "`Nothing` in a
  value position declines" below).

A read of a local that may have no value is checked by the compilation of
the block (JavaScript throws `read-before-declaration`, a shader declines),
as the interpreter gives that error.

**`Nothing` in a value position declines.** `Nothing` is the erasure marker,
and the compiled result has no form for it. So these decline on every
target where their value is used (the root, the last statement of a block
whose value is used, the body of a function, an operand): an empty block, a
block whose last statement is a declaration with no value
(`Block(Declare(t, "integer"))`), and a `Loop`. The value of a loop is
`Nothing` when it ends at the end of its indexing sets or with a `Break`
with no value, and the compiled loop does not carry the value of a
`Break(v)`, so every loop whose value is used declines:
`Loop(k + x, k ∈ 1..3)` declines, where the JavaScript code gave
`undefined`. Put the loop in a statement position and end the block with
its value: `Block(s ≔ 0; Loop(s ≔ s + k, k ∈ 1..3); s)` compiles. Only a
loop with no indexing set and no `Break` of its own compiles where its value
is used: it ends only through a `Return` or never ends, so its value is the
value of the `Return`. A loop with an indexing set declines also when it has
a `Return` and is the body of its function, or the last statement of a block
in tail position. For example, with `x: real`, the search loop
`((p) ↦ Loop(If(k > p, Return(k)), k ∈ 1..5))(x)` gives `3` for `x = 2` and
`Nothing` for `x = 9`, where no `Return` runs; the compiled function gave
`undefined` (JavaScript) or `None` (Python) for `x = 9`, so the loop
declines. To compile a search loop, put the loop in a statement position,
store the value that it finds in a local, and end the block with that local:
`Block(r ≔ 0; Loop(If(k > x, Block(r ≔ k, Break())), k ∈ 1..5); r)` compiles
on JavaScript and Python, and gives `3` for `x = 2` and `0` for `x = 9`, as
the interpreter does for this block. No compiled form gives `Nothing` when
no value is found: the initial value of the local (here `0`) takes its
place, and `r ≔ Nothing` declines. A loop in a case of a `Match` whose value
is used is checked in the same way. The loop check is `unsettledShapeIn()`
(`compilation/compile-admission.ts`).

On the shader targets, a conditional whose value the code discards (with
branches of different shapes) declines too, because its shader code is a
conditional expression (`c ? a : b`) whose branches must have the same
type. Points of different sizes (`If(x > 0, (1, 2), (3, 4, 5))`)
conflict only on the shader targets, where they are a `vec2` and a `vec3`;
on the other targets a point of any size is one array, and the union of the
two tuple types compiles. A written `NaN` is a number, so a `NaN` branch
beside a point or a list declines: `If(c, (x, y), NaN)` is a point when `c`
is true and the number `NaN` when `c` is false. A branch that a condition
known when the code is generated excludes is not compared: a condition that
is `True` or `False`, or whose static type is the literal `True` or `False`
(`2 < 3`), selects its branch, so `Which(2 < 3, [1, 2], True, 0)` compiles
to the list. On the shader targets, only the branches that the shader code
keeps are compared, as every branch in the shader must have the same type:
an `If` whose condition has a literal static type keeps one branch
(`If(2 < 3, (1, 2), 0)` compiles to `vec2(1.0, 2.0)`), but an `If` whose
condition is the symbol `True` or `False` keeps both, and a `Which` keeps
every value up to its first `True` clause, so `If(False, (1, 2), 0)` and
`Which(2 < 3, (1, 2), True, 0)` decline there. A conditional inside a
branch that the code drops is not checked, because the code never evaluates
it: `If(2 < 3, 0, If(x > 0, [1, 2], 3))` compiles to `0` on every target.
In the same way, a name that occurs only in a dropped branch is not an
input: with `z` undeclared, `If(2 < 3, 0, z)` compiles, also when `vars`
maps `z`. A name that occurs anywhere in the code that is kept, also where a
binder binds it, stays an input: the check cannot always tell a bound name
from a read of the outer input (the variable of an indefinite integral), so
`If(2 < 3, 0, x) + Integrate(x^2, Limits(x, Nothing, Nothing))` with `x`
undeclared declines, and so does
`List(If(2 < 3, 0, z), Sum(z, Limits(z, 1, 3)))`, although the `z` of the
sum is its index. On the shader
targets, `If(True, 0, z)` keeps both branches, so it reads `z` and `z` is
refused there. A sub-expression of static type `error` declines also in a
dropped branch. The conditional is found before the code is generated
(`unsettledShapeIn()`), and the decline is thrown after the code was
generated with no other decline (`assertAdmitted()`), so a more specific
reason of the target stays the reason: `If(x > 0, [1, 2], 3) + 1` on `glsl`
declines because a shader array has no arithmetic. Design:
`docs/plans/2026-10-31-static-shape-compilation.md`, rules R1 and R3.

A typed array for a `list` input and a string for a bare
`indexed_collection` input are values of their types and keep the
guarantee. Checks that exist only for the unspecified cases can be removed;
the decision and the survey of these checks are in
`docs/plans/2026-10-31-compiled-code-contract-for-errors.md`.

One value carve-out is ruled (pole-encoding ruling, 2026-08-28): where the
interpreter answers the projective infinity `~oo` — a division pole, a Gamma
or Factorial pole, an embedded `~oo` constant — a float-only target answers
the IEEE `Infinity` instead of declining. The projection keeps the infinite
magnitude and drops the direction `~oo` never had; it is what the bare
division instruction already answers at a runtime pole, so folded and
runtime spellings of the same pole agree. `NaN` remains reserved for the
genuinely indeterminate (`0/0`, `0 · ∞`) and for NaN propagation under
Contract B's `propagate` policy.

For an indeterminate form the two routes spell the answer differently, and
the compiled output did not change for it. Since 2026-09-29 the
interpreter's exact route answers `Indeterminate` for an exact form with no
value (`0/0`, `0 · ∞`, `0^0`, `Mod(x, 0)`), and answers `NaN` for the same
form with a float operand and under `.N()`. Every compiled target has only
the IEEE `NaN`, so it answers `NaN` for both: an `Indeterminate` constant
compiles to `NaN` in JavaScript, `np.nan` in Python and `_gpu_nan()` in the
shaders. This agrees with the interpreter's numeric route. Design:
`docs/plans/2026-09-28-indeterminate-value.md`.

The projection is applied where the pole is spelled, not at the result
boundary, so a SIGNED cofactor can give the two routes different signs:
`-2 · (-1)!` folds as a whole to the interpreter's `~oo` and embeds
`+Infinity`, while the structural lowering computes `-2 · Infinity` and
answers `-Infinity`. Both agree on the infinite magnitude, which is the
promise; the sign is the direction `~oo` does not have, and a float lane
may report either. Code that must not see a signed answer at a pole should
test `Number.isFinite`, never the sign.

The carve-out also covers the ARGUMENT boundary (extension ruled
2026-08-30): a `~oo` value passed INTO compiled code projects to
`+Infinity` at entry (`isUnsignedPole` in the JavaScript target), so one
pole has one spelling on both the produced and the boundary routes. A
genuine complex value with a nonzero imaginary part still rejects at a
real-lane entry; only the unsigned pole projects.

The projection does NOT make non-finite clause guards compilable. Float
arithmetic can degrade one non-finite class into another before a guard
runs — compiled `1/w - 1/w` at `w = 0` computes `Infinity - Infinity =
NaN` while the interpreter's operand stays `~oo` — so a parameter guard
typed `infinity` or `nan`, and a clause guarded on a non-finite VALUE
literal or their unions (`oo`, `-oo`, `NaN`, the signed pair
`+oo | -oo`), each decline the whole function. This was measured, not assumed: re-admitting the `infinity`
and `nan` guards under the boundary projection made each diverge from
the interpreter through the degradation route. Restoring compilability
here requires a tagged pole representation (a full pole lane), not a
cheaper encoding. The divergences that the projection itself causes are
accepted; the next section lists them.

### Divergences of the `Infinity` projection (user decision 2026-10-17)

Compiled code on a real target has no value for `~oo`, so it uses the IEEE
`Infinity` (above). A function of the SIGN of its operand then answers as if
the operand were `+∞`, where the interpreter has no sign to use. These
differences are accepted; they are not defects:

| Expression | Input | Compiled (JavaScript) | Interpreter |
|---|---|---|---|
| `Heaviside(x)` | `x = ~oo` | `1` | `Error(incompatible-type, "real \| signed_infinity", "~oo")` |
| `x > 0` | `x = ~oo` | `true` | `False` (`~oo` has no order, user decision 2026-10-21; before, `0 < ~oo`, not decided) |
| `\{1/x > 0: 1, 0\}` | `x = 0` | `1` (also `python`, with a NumPy `x`) | `0` (`~oo` has no order, user decision 2026-10-21) |
| `Sign(1/x)` | `x = 0` | `1` | `Indeterminate` (`evaluate()`), `NaN` (`.N()`) |
| `Floor(1/x)` | `x = 0` | `Infinity` | `~oo` |

In the first two rows, the argument `~oo` (`{re: Infinity, im: Infinity}`)
becomes `Infinity` at the entry of the compiled function. In the third
row and the last two rows, the pole is computed inside the compiled code:
`1/0` is the double `Infinity`, and the comparison, `Sign` and `Floor` read
it as `+∞`.

A CONSTANT pole in an ordering comparison is not a divergence. When an
operand of `Less`, `LessEqual`, `Greater` or `GreaterEqual` is a closed
operand whose exact value is `~oo` (`1/0`, `(-1)!`, `1/0 + 2`, a symbol
assigned `1/0`), the comparison compiles to the target's `False` on every
target, as the interpreter answers (`~oo` has no order, user decision
2026-10-21): `x < 1/0` at `x = 1` is `false` on `javascript`, `python`,
`glsl`, `wgsl` and `interval-js` (`'false'`), and so is `0 < 1/0`. This
applies when the other operands are pure and cannot be lists at run time;
otherwise the comparison keeps its code, with the pole as `Infinity`
(`constantPoleOrdering` in `base-compiler.ts`, ROADMAP CE-211). The value
`False` was chosen because no single compiled value of the pole gives the
interpreter's answers both in an ordering and in arithmetic: `NaN` gives
`false` in every ordering, but `x + 1/0` would then be `NaN` where the
interpreter answers `~oo`, which the projection spells `Infinity`. An
equality is not changed: `x = 1/0` compiles to `x === Infinity`, `false`
for a finite `x`, as the interpreter answers, and `1/0 = 1/0` folds to
`false` on `javascript`, `glsl`, `wgsl` and `python`, also under
`constantFold: false`. `interval-js` does not fold an equality and answers
`'true'` for `1/0 = 1/0` (`docs/ERROR-MODEL.md`, "a value with no order").

A point (a tuple of numbers) divided by zero is the same case, coordinate by
coordinate. The interpreter gives `~oo` for each nonzero coordinate, and the
compiled code gives the IEEE infinity of each coordinate, with the sign of the
coordinate: with `t = 0`, `(3, 4)/t` is `[Infinity, Infinity]` compiled and
`(~oo, ~oo)` interpreted, and `(-3, 4)/t` is `[-Infinity, Infinity]`
compiled. A list of points is divided point by point:
`[(1, 2), (3, 4)]/t` is `[[Infinity, Infinity], [Infinity, Infinity]]`
compiled and `[(~oo, ~oo), (~oo, ~oo)]` interpreted. On a real target, this
is the spelling of the complex infinity, as for the scalar `1/0`. Code that
must not see a sign at a pole tests `Number.isFinite`, as above.

### A complex result with an infinite real part (user decision 2026-10-18)

The interpreter boxes a complex value with an infinite real part and a
finite imaginary part as the real infinity of the sign of its real part:
`∞ + i` is `+oo` and `-∞ + 2i` is `-oo`. Compiled code does not apply this
rule. The JavaScript complex lane adds and multiplies the two parts
separately, and returns them as they are:

| Expression | Input | Compiled (JavaScript) | Interpreter |
|---|---|---|---|
| `(1 + i) + x` | `x = Infinity` | `{re: Infinity, im: 1}` | `+oo` |

This difference is accepted; it is not a defect. The two answers have the
same real part, and the imaginary part of the compiled answer is finite, so
`Number.isFinite(result.re)` is `false` for both. Code that must treat such
a result as `+∞` tests the real part, not the imaginary part.

### Folds over rows of unequal length give `NaN` (user decision 2026-10-17)

This is a named exception to the rule of `docs/ERROR-MODEL.md` §6 that a
compiled expression does not answer `NaN` where the interpreter answers an
error. With `v: list<list<real>>`, compiled `Sum(v)`, `Product(v)`,
`Reduce(v, Add)` and `Scan(v, Add)` combine the rows element by element. Two
rows of unequal length have no element-wise sum, and the compiled
element-wise combiner (`_SYS.add`) answers `NaN` for them, as the compiled
`Add` of two lists of unequal length does:

| `v` | Compiled | Interpreter |
|---|---|---|
| `[[1, 2], [3]]`, `Sum(v)` | `NaN` | `Error("incompatible-dimensions", "1 vs 2")` |
| `[[1, 2], [3]]`, `Product(v)` | `NaN` | `Error("incompatible-dimensions", "2 vs 1")` |
| `[[1, 2], [3]]`, `Reduce(v, Add)` | `NaN` | `Error("incompatible-dimensions", "1 vs 2")` |
| `[[1, 2], [3]]`, `Scan(v, Add)` | `[[1, 2], NaN]` | `[[1, 2], Error("incompatible-dimensions", "1 vs 2")]` |
| `[[1, 2], [3, 4]]`, `Sum(v)` | `[4, 6]` | `[4, 6]` |

The type `list<list<real>>` does not fix the length of a row, so a compiler
that obeys §6 would have to refuse every fold over such a list, including
the correct ones (the last row). A list of rows is the usual input of a plot,
and an input with rows of unequal length already shows the failure as
`NaN`, so the compiled fold is kept. A caller that needs the error evaluates
through the interpreter. The test "rows of unequal length…" in
`test/compute-engine/compile-absent-collection-operand.test.ts` pins this
behavior.

A second value carve-out is ruled (compiled-equality ruling, 2026-09-09):
compiled `Equal` and `NotEqual` on numeric operands are EXACT, the IEEE 754
comparison (`===` on JavaScript, `==` on Python, `==` on the shader targets),
with no tolerance. The interpreter compares two numbers within
`engine.tolerance`, so `0.1 + 0.2 = 0.3` evaluates to `True` and compiles to
`false`. The compiled lanes serve plot kernels, where every comparison runs
per sample and a tolerance test costs a subtraction, an absolute value and a
compare each time, and where the exact answer is the one the reference
graphing calculators give. The same rule covers `KroneckerDelta`, the
element-wise and whole-collection equality helpers (`_SYS.eq`, `_ce_eqcoll`),
and the `IndexOf` element test, which was already exact. `NotEqual` is the
negation of the `Equal` test, so it answers `true` on a `NaN` operand, as the
interpreter does. Two absent operands (`undefined` on JavaScript, `None` on
Python) are not equal in the SCALAR lowering: the interpreter answers `Missing`
for `Equal(Missing, Missing)`, and the emitted test guards the left operand when
both sides may be absent.

A comparison whose VALUE is the result (not a branch condition) has no value
when it reads a variable that the caller leaves out of the vars object (user
decision 2026-10-30). The JavaScript target answers `undefined` there, as the
interpreter has no value for `x > 0` while `x` has none. The emission runs the
plain comparison first, so its `true` costs nothing more:
`((0 < _.x) || ((_.x !== undefined) ? false : undefined))`. `NotEqual` uses the
`&&` form with `true` and `false` exchanged. The comparison runs first only when
each operand reads an absent value as `NaN` or `undefined` (a variable,
arithmetic, an elementary function). Otherwise it could be `true` for an absent
read (`Boole(x > 0) = 0`), so the tests come first:
`((_.x !== undefined) ? (cmp) : undefined)`; a string or boolean comparison
also takes this form. A variable with no declared type is tested too, since it
compiles to the same scalar comparison. A `NaN` operand still decides the
comparison (`false`, or `true` for `NotEqual`), as in the interpreter: a `NaN`
literal with no test at all, a computed or local operand when its own inputs
are present, and, for an ordering, a complex operand that is not real. A
consumer that reads only the truth of the comparison (`Boole`, the predicate of
`Filter`, `Count` and the other selecting operators) gets the plain comparison
with no test when it is numeric and its operands read an absent value as `NaN`,
because there `false` and `undefined` select alike. See `docs/ERROR-MODEL.md`,
the "An unsupplied variable" item.

The ELEMENT-WISE runtime is three-valued, and that is where an absence shows.
An absent CELL makes its comparison undecided, so the runtime marks exactly that
position with `NaN` — how a real target renders `Missing` in a cell — instead of
answering a decided `false`: `Equal([1, 2, 3], Missing)` compiles to three marks
as the interpreter answers `[Missing, Missing, Missing]`, and
`Equal([1, Missing], 1)` compiles to `[true, NaN]` as the interpreter answers
`[True, Missing]`. A `NaN` OPERAND is not an absence — it is a number that
equals nothing — and still answers a decided `false`. Two consumers already read
the mark: the selection runtime consumes a position whose condition cell is
absent instead of offering it to a later clause, so an element-wise piecewise
answers absent there rather than taking a branch; and the element-wise
connective guard tests absence as `x !== x`, so a marked cell combines
three-valued with `And`/`Or` and a decided `false` still absorbs it.
`KroneckerDelta` is unaffected, since its codomain is numeric and it answers `0`.

Making the SCALAR comparison undecided as well was measured and declined: it
reaches the fused selection lane, the value-position connectives, the
operand-binding rules and the short-circuit order of a chained comparison, which
is a far wider change than the cell-level defect it would fix. The remaining
divergences are recorded in `ROADMAP.md`.

A consumer that needs tolerant equality evaluates through the interpreter, or
asks for a compile option; none exists today.

### Integer operations beyond the safe integer range

Compiled arithmetic is machine arithmetic. Every number is a double, so a
compiled `1/3` is `0.333…` and a compiled `2^1000` is `1.07e301`, where the
interpreter keeps exact values. A float result where the interpreter answers
an exact number is expected, and a sum that overflows the double range is
`Infinity`.

An operation that reads every digit of its operand is different. A double
beyond `±(2^53 − 1)` (`Number.MAX_SAFE_INTEGER`) is the rounding of the value
that produced it: `2^60 + 1` is held as `2^60`. The remainder or the common
divisor of that double is a different number, not a less precise one:
`Mod(2^60 + 1, 10)` on the double is `6`, and the interpreter answers `7`.
For these operations, an operand beyond the safe integer range, or an
infinite operand, is an error. The compiled JavaScript throws a `RangeError`
that names the operation and the value (`Mod: Infinity is beyond the safe
integer range of compiled code …`). The CLI's compile mode reports it as an
error value. The operations are `Mod`, `Remainder`, `GCD` and `LCM` (the
runtime helper `integerOperand` in `compilation/javascript-runtime.ts`). The
Python target raises a `ValueError` for `Mod` and `Remainder` (`GCD` and `LCM`
have no Python lowering); there a Python integer is exact at any magnitude and
passes `Mod`. A `NaN` operand is not an error: it propagates as through the
other arithmetic. `Mod` by the literal `1` is not checked, because the
remainder by `1` of every double beyond the range is `0`, which is also the
exact answer.

The `bigint` mode of the JavaScript target (`compile(expr, { mode:
'bigint' })`, "Compile modes") is exact beyond this range. It computes every
integer value of an integer-typed expression as a `bigint`, so `Mod(n, 10)`
at `n = 2^60 + 1` gives `7n`, and `Mod`, `Remainder`, `GCD` and `LCM` do not
throw. It has a size limit: `Power`, `Factorial`, `Factorial2`, `Binomial`
and `Fibonacci` throw a `RangeError` when their result would have more than
1,000,000 decimal digits, where the interpreter leaves the expression
unevaluated. Both mean that there is no value, but the host receives a
different answer from each.

Constant folding follows the same rule. A constant subtree is folded with the
interpreter's `.N()`, which rounds each operand to the working precision
first, so an integer operation then reads a rounded operand as exact:
`DigitSum(2^1000)` folded to `84` where `evaluate()` answers `1366`. When an
operand of `Mod`, `Remainder`, `GCD`, `LCM`, or an operand at a parameter
that the operator's signature declares `integer`, is beyond the safe integer
range, the fold uses the value of `evaluate()` when that value is exact and
every such operand evaluates to an exact rational. Otherwise the fold
declines, and the structural lowering throws at run time, or declines when
the target has no lowering for the operator (`DigitSum`, `IntegerDigits`).
The shader and interval targets have no error channel and are not changed.

Whether a constant subtree is folded at all is decided by a deterministic
estimate of the work its evaluation can cost (`foldCostEstimate` in
`base-compiler.ts`), never by a time limit. The estimate depends on the
expression only, so the same input always compiles to the same code on any
machine and under any load. A definite integral is priced at the worst case of
the adaptive quadrature, so a nested integral declines to fold.

## Running stored JavaScript

The code of a JavaScript compilation result reads only `_SYS` and `_`.
`@cortex-js/compute-engine/runtime` exports `createJavaScriptRuntime(options)`,
the `_SYS` that `run()` uses, with no engine behind it, so code compiled in one
place (a worker, a build) runs in another with only the numerics it calls. Its
type exposes `load`, `frame` (set with `setFrame`), `iterationLimit`, `deadline`
and `runtimeVersion`;
the helper table is internal and may change in any release. `load()` evaluates
the definitions that read nothing per call (`preambleOnce`) once, as `run()`
does, and the rest (`preamblePerCall`) on every call, and applies the input
conversions of `run()` from `entryPlan` (a real given to a complex-declared
symbol is lifted, a complex value for a real symbol is refused, a string or a
typed array for a symbol read as an array is refused). The
engine-bound helpers take their state as options: `random` (draws outside a
`WithRandomSeed` frame and the integrals' Monte-Carlo samples; `null` denies),
`frame` (the enclosing frame, set with `setFrame()` and read back from
`runtime.frame.next`),
`iterationLimit` (`Infinity` when 0 or less) and `deadline`. A denied draw
throws a `CapabilityDeniedError`, a different class in each bundle: test
`e.name`, not `instanceof`. Tolerance, angular unit and the digits a negative
base's float exponent is read to (`reconstructionDigits`, 15 to 17 by the
engine's precision) are fixed at compile time, and compiled code always uses
machine floats.

The result and the runtime both carry `runtimeVersion`; a mismatch means the
code was compiled by another release, and `runtime.load()` refuses it, as it
refuses code with no `runtimeVersion`.

`runtime.load()` and `runtime.loadBroadcast()` also refuse code compiled with
the compile contract of a value kind (see "Value kinds" below): the result
lists the kind types in `valueKinds`, and the entry plan lists the bindings
of a kind type in `entryPlan.kinds`. Such code reads a host value for a
symbol of a kind type through the `entry` check of the kind's contract, which
is a function of the host that compiled the code, and stored code cannot
carry a function. Code that reads no binding of a kind type and whose
contracts all say `shippable: true` is accepted by the batch loaders that a
worker of the kernel pool uses; `load()` refuses it. There is no `store()`:
such code runs only through the `run()` of its compilation result.

Functions passed in the `functions` or `imports` compile options are copied into
the code as source (`toString()`): a closure loses its enclosing scope, and a
function given by name must exist where the code runs.

`compilation/javascript-runtime.ts` holds the helpers and imports no engine code
(`test/compute-engine/js-runtime.test.ts` bundles the entry point and checks
it). `run.SYS` is built from the same factory.

## Target boundaries

The JavaScript target supports the broadest dynamic representation. Python,
GLSL, WGSL, interval, and other targets expose narrower capabilities and must
decline outside them. A feature implemented for JavaScript is not implicitly a
cross-target promise.

Values crossing the compiled boundary use the target ABI. Complex values use
the documented scalar-or-`{re, im}` convention; nested collections retain
their shape. Target entry checks reject values incompatible with the compiled
lane assumptions.

The list carrier of the JavaScript target is the plain `Array`, in both
directions, and the contract of `run()` is: **inputs of the shape the
compiled code reads, results read-only** (decided by the user, 2026-10-13).
The runner does a constant amount of work per binding on each call — one
`typeof`, to refuse a `{re, im}` object in a real slot, lift a plain number
into a complex slot, project the unsigned pole, and refuse a string for a
binding the code reads as an array, and one brand check to refuse a numeric
typed array (`Float64Array`, `Int32Array`, …) there — and nothing whose cost
grows with an input. On a binding whose declared type proves a JS array, the
value passes as it is: its entries are never read, and a typed array is not
converted but refused with a `TypeError` that names the binding, so a host
converts it to a plain `Array` once, on its side (a typed array nested as a
row is an entry, and is not read). A
`{re, im}` object or a string at an entry of a list read on the real lane
computes with that value, as it would in plain JavaScript; the interpreter
is the route that validates. The `strict` mode, and the default `auto` mode
when it does not escalate, read the entries of a `list<number>` on the real
lane; the `complex` mode reads them on the complex lane (see "Complex
modes"). Any other value passes untouched and the
lowerings dispatch on its runtime shape: a scalar there is not an error,
because a declared type is routinely wider than the value a caller binds and
several lowerings project on the runtime shape — a `list`-typed summand of
an element-wise big operator bound to a number gives the scalar sum. A
collection or a `{re, im}` result comes back as the code built it, with no
copy: it may be a value the runner keeps for every later call (a hoisted
constant list literal, a bound symbol value), so a caller that writes to a
result changes what the next call answers. The result convention is kept —
a `{re, im: 0}` cell reads as a plain number — and a collection is copied
only when such a cell has to be rewritten, never in place. That walk, one
`typeof` per cell of a returned collection with no allocation, is the one
per-call cost at the boundary that grows with the data.

Before 2026-10-13 the runner walked every entry of a list input read on the
real lane on every call (to refuse a complex or non-numeric entry), copied a
typed-array input to a plain array on every call, and returned every
collection as a fresh array. For a kernel called 1.2 million times with a
9 801-element list input, the entry walk was the whole per-call cost (Tycho
ledger row 371, filed 2026-10-12); the typed-array copy and the result copy
were as long as the data. The engine-initiated compilations already ran with
`entryChecks: false`.

A string is the one value the entry refuses for a binding whose declared type
is a list, an indexed collection or a `collection`, bare (`indexed_collection`)
or with an element type (`list<number>`, `list<string>`). The engine reads a
string as an indexed collection of its grapheme clusters, so the bare
`indexed_collection` and `collection` types admit one, but the compiled code
reads such a binding as an array and would read the string as UTF-16 code
units: `Length(S)` of `"😀a"` would be 3, where the interpreter gives 2. The
entry throws a `TypeError` that names the binding and its declared type
instead (decided by the user, 2026-10-07). A string does not inhabit
`list<string>`, `list<character>` or `list<list<string>>`, and the
interpreter refuses it there too. A type alias is read as the type it names.
A declared type and an inferred one are checked alike: an annotated
parameter and a declared symbol, and also an unannotated parameter or an
undeclared symbol whose collection type the engine inferred from its uses,
because the compiled code reads the binding as an array in every one of
these cases. A type that a string inhabits through a text member is not
affected: `string` itself is compiled as text, and a union with a string
member (`string | list<number>`) does not compile and runs on the
interpreter. `indexed_collection<character>` and `collection<character>` are
an open case: a string inhabits them, the entry does not refuse it, and the
compiled code still reads it as UTF-16 code units. The Python target binds its parameters as plain Python names and
has no entry check, so it has no equivalent of this refusal. Typed arrays
are not used inside the artifact: a typed pipeline measured no faster than the
plain one on the witness that asked for it, so the container would add
per-helper result-kind rules for no gain. The measurements and the decision
are in
`docs/plans/2026-09-07-numeric-list-store-and-typed-array-boundary.md`.

### Interval results

The `run` of an `interval-js` compilation gives one shape for each kind of
value (decided by the user, 2026-10-18):

- A scalar value is always a kinded `IntervalResult`:
  `{ kind: 'interval', value: { lo, hi } }`, `{ kind: 'empty' }` (no value
  over the cell), `{ kind: 'entire' }` (no bound is known), a `singular`
  result (a pole, or a jump with its enclosure), or a `partial` result (a
  value over part of the cell only). The runner never gives a bare
  `{ lo, hi }`. A constant (`5`, `π`), a bare variable (`x`) and a block that
  returns a local gave one before 2026-10-18, while a computed value
  (`x + 1`) gave the kinded form; the runner now wraps such a value. An
  enclosure whose lower bound is `NaN` is the absent marker of the compiled
  code, bare or carried by an `interval` or `partial` result (an operation
  over an absent operand), and the runner gives `{ kind: 'empty' }` for it:
  `Min(L)` with `L = []`, a broadcast over lists of different lengths, and a
  conditional whose undecided arms are a number and a list all give `empty`.
- A collection value (a list, a range, a tuple, a point) is an array of these
  values, nested as the collection is. Each element is wrapped in the same
  way: `[x, 3]` over `x = [−1, 1]` gives
  `[{ kind: 'interval', value: { lo: −1, hi: 1 } }, { kind: 'interval', value: { lo: 3, hi: 3 } }]`.
- A relation is a tri-state verdict: the string `'true'`, `'false'` or
  `'maybe'`. An ordered comparison or an `Equal` with an `empty` operand
  (no value over the cell) is `'false'`, as the scalar targets answer
  `NaN > 0` with `false`; with a `partial` operand it is at most `'maybe'`.
  A `NotEqual` is the negation of `Equal`, so with an `empty` operand it is
  `'true'`, as the scalar targets answer `NaN ≠ 0` with `true` (user
  decision 2026-10-25, ROADMAP CE-396). With a `partial` operand it is
  `'true'` only when the enclosures do not overlap, since `≠` holds where
  the operand is undefined. An absent operand (an `empty` with the `missing`
  flag) gives `'maybe'` for every relation.

The interpreter fallback (`success: false`, with `fallback` not `false`)
gives the same shapes: a number is the `interval` result of a point, and an
absent value is `empty`.

A root whose value is a function (a `Function` literal, a block whose value
is one, a symbol whose value is one, a partial application) is never given
as a function value. The result has `calling: 'lambda'`, as a root
`Function` literal has on the JavaScript target: `run` takes the arguments
of the function, each converted as a variable of a vars object is (a number
is a point interval), and gives one of the shapes above. `x ↦ 2x` with
`run(3)` gives `{ kind: 'interval', value: { lo: 6, hi: 6 } }`, and with
`run({ lo: 1, hi: 2 })` the enclosure `[2, 4]`. There is no vars object, so
such a root declines when it reads a free symbol (`x ↦ a·x`), and the
result has no `broadcast()`. The root must be a literal, a symbol or a block
whose value is one of these: the interval lowering of an `If` takes the hull
of its arms and `When` wraps its value as an interval result, so neither
gives a function. A function-valued `If` or `When` at the root reads no free
symbol, so its condition is a constant: it is evaluated at compile time, and
the function it selects is the root (`If(1 > 0, x ↦ 2x, x ↦ 3x)` is
`x ↦ 2x`; a nested `If` is selected in the same way). The root declines when
the condition is not decided: it has an effect (`If(Random() > 2, x ↦ 2x,
x ↦ 3x)`, where the interpreter draws on each call), it does not evaluate to
`True` or `False`, or it is the `False` condition of a `When` (the
interpreter gives no function). No selection is made, and the root declines,
when the `functions` option maps the `If` head or a head in the condition,
since the caller's code runs on the compiled route only. The branch that is
not selected is still checked: when it is invalid or has a sub-expression of
static type `error`, the root declines for it. An `If` that is the last
statement of a block is not selected, since its condition can read a local
of the block, and declines. A function whose value is a function
(`x ↦ (y ↦ x + y)`) declines too: the runner converts the arguments of the
outer function only. The interpreter fallback of a declined function-valued
root has `calling: 'lambda'` as well: it evaluates `Apply(expr, …)` with
each argument boxed by the type of its parameter (an array for a `tuple`
parameter is a point; `'true'` and `'false'` are booleans for a boolean
parameter only), and a function value gives `{ kind: 'entire' }`. Before 2026-10-31 `run` gave the compiled
JavaScript function over enclosures, which a caller could not call with
numbers (ROADMAP CE-726).

A conditional whose condition is undecided over the cell gives the hull of
its arms. When one arm is `empty` — the missing default of a `Which`, or an
arm with no value, such as an `At` out of range — the other arm is present
over part of the cell only, and the hull is that arm clipped as an undecided
`When` clips it: an `interval` becomes `partial`, and a list is clipped
element by element. `Which(x < 0, 1)` over `x = [−1, 1]` gives
`{ kind: 'partial', value: { lo: 1, hi: 1 }, domainClipped: 'both' }`; before
2026-10-18 it gave an `interval` result, a value claimed over the whole cell
(`hullValues`, `interval/comparison.ts`).

### Statement order on the shader targets

GLSL and WGSL have no let-expression, so a lowering that needs statements — a
loop-form `Sum` or `Product`, a `Block` used as a value, the statement form of
a conditional, a lowering that binds an impure operand to a temporary — is
hoisted into the enclosing statement sink, AHEAD of the whole enclosing
expression. An operand written EARLIER in that expression therefore runs after
the hoisted statements where the interpreter runs it first. Random draws are
the exception: when the order of the draws of a statement would change, the
statement is compiled again with each draw bound to a temporary of its own, in
the order of the interpreter. With constant folding off,
`(Random(), Σ_{n=1}^{⌊t⌋} Random())` in a `WithRandomSeed` frame emits

```glsl
float _tv2 = _gpu_rnd_draw(uvec2(0x3ff00000u, 0x00000000u), _gpu_rnd_n1);
float _tv3 = 0.0;
for (int n = 1; n <= int(floor(floor(t))); n++) {
  float _tv4 = _gpu_rnd_draw(uvec2(0x3ff00000u, 0x00000000u), _gpu_rnd_n1);
  _tv3 += _tv4;
}
return vec2(_tv2, _tv3);
```

so the first component is the first draw. Other effects are not bound:
`(k := 1, Σ_n k·n)` reads `k` into `_tv1` before the assignment. This is a
documented difference of the shader targets (decided 2026-09-21): an
expression that mixes a hoisting operand with an effect other than a draw
written before it does not keep the interpreter's order. A general reordering (bind an earlier operand
ahead of a hoisting sibling, decided per occurrence at the parent's lowering
dispatch) was built and withdrawn in 2026-09 after review kept finding compile
paths it did not cover; it is not planned. Pure expressions, which every corpus
document has at this position, are unaffected.

Code that the caller supplies is held to the interpreter's order: a `vars`
entry whose value is shader source other than a plain read (`nextValue()`,
`vec3(u + v)`; a uniform name such as `u_x` or `params.x` is a plain read), a
head mapped through `functions` or `operators`, and an operator's own `compile`
handler. Such code can count its calls or draw a number, and the compiler does
not see inside it. The values of the symbols that an expression reads and the
bodies of the user functions it calls are looked through, as the shader
inlines them, except the value of a symbol that reads an input (a plain `vars`
read, a bound variable): with `vars: { T: 'u_T' }`, `T` emits `u_T` whatever
value `T` has. The shader targets decline, rather than emit, a form that would
run caller code more than once, move it ahead of code with an effect written
before it, or compute it in a branch that is not taken. With
`vars: { W: 'nextValue()', V: 'vec3(nextValue())' }`:

- `Max(V)` compiles to a temporary that holds `V` once, but `W + Max(V)`
  declines (the temporary would call `V` before `W`), and so do `Cot(W)`
  (`cos` and `sin` would each call `W`), `Cot([W, x, 1])`, `x < W < 3`,
  `Random(Interval(W, 1))` (the draw would run before `W`) and
  `(W, Cot(Random()))`.
- A `vars` entry whose code is the read of one variable (`u_t`, `params.x`,
  `v[0]`) runs no code, so a form may write it twice even when it counts as
  caller source (`{ a: 'u_t', b: 'u_t' }`: `Cot(a)` is
  `cos(u_t) / sin(u_t)`). A random draw can also move ahead of such a read,
  as can a bound draw whose endpoints are such reads. Hoisted caller code
  cannot move ahead of it (next item).
- On WGSL, `select(f, t, c)` computes both branches. A branch with caller code
  takes the statement form of the selection when a statement can be placed:
  `If(c, W, 0)` emits `if (c) { _tv1 = nextValue(); } else { _tv1 = 0.0; }`,
  and a `Match` case does the same. The statement form keeps the order check
  above; when it is refused (`W + If(c, W, 0)`), the `select` form declines.
  Only the operands that the `select` form places behind a `select` count: a
  leading `True` clause of `Which`, a single `Match` case that always matches,
  and the clauses after a `True` clause are not checked
  (`Which(True, W)` is `(nextValue())`). GLSL's `?:` computes one branch and
  keeps the ternary form.
- Caller code can also write a variable that a plain read reads. So hoisted
  caller code declines when the interpreter reads a `vars` key (whatever its
  source) before it: with `vars: { W: 'state.value' }`, `(W, Max(V))`
  declines, and `(Max(V), W)` compiles. A canonical `Add` can put the read
  first: `Max(V) + U` declines.
- A statement hoisted into the branch of a statement form runs ahead of the
  rest of its clause only, so it is checked against that clause.

The check is simple, not precise: a hoisted statement with caller code
declines when anything else in its statement has an effect, also when that
code comes after it. Binding caller code in order, as random draws are bound,
is not implemented. A form with no caller code compiles as before.

### NaN-safe helpers on the shader targets

On GLSL and WGSL, `sin`, `cos`, `sign`, `min`, `max` and `clamp` call a
NaN-safe helper (`_gpu_sin`, `_gpu_min`, …), because a GPU built-in can turn a
NaN operand into a number. The built-in is emitted only when the operand is
finite for certain (`gpuProvablyFinite()`,
`src/compute-engine/compilation/gpu-finite-proof.ts`). The proof includes f32
overflow, rounding, the flush of subnormal values to 0, and the error of the
GPU functions. When the proof is not certain, the helper stays.

The proof uses these facts, among others:

- The index of a `Sum` or `Product` whose bounds are integer literals (in
  the loop body: integers known at compile time) is finite, inside its bounds.
- A call of a user function is finite when its body is finite for the
  arguments of that call. This rule applies only under `angularUnit: 'rad'`,
  because the emitted body is rewritten for the other units.
- A divisor is not zero when a lower bound of its magnitude is a normal f32
  value. For `cos(u)` with `|u| < π/2`, the lower bound is `cos(|u|)` minus
  the GPU error of `cos`.

The error of `cos` is the one exception to "certain": WGSL specifies an
absolute error of at most 2⁻¹¹ on [-π, π], but GLSL ES 3.00 specifies none.
On GLSL the proof assumes an absolute error of at most 2⁻⁶ on [-π/2, π/2]
(user decision 2026-10-31). On a driver with a larger error, a quotient by
`cos(u)²` that this rule proves finite can be `±∞` or NaN.

## Compile modes

The `mode` option selects how the compiled code computes numeric values:
`strict`, `complex`, `auto` or `bigint`. The `javascript` target offers the
four modes, `python` offers the first three, and `interval-js`, `glsl` and
`wgsl` offer `strict` only. A request for a mode that the target does not
offer declines with the code `'unsupported-mode'`. The default is `auto`
when the target offers it, else `strict`. The first three modes select how
the code handles complex values (below). The `bigint` mode selects how it
computes integers ("The `bigint` mode", at the end of this section).

`strict` preserves real-lane assumptions and declines on an incompatible
complex boundary. `complex` compiles wide numeric bindings through complex
kernels. This includes the cells of a list or tensor input whose cell type
admits a complex value (`list<number>`, `tensor<number>`, `list<unknown>`):
the element-wise lowering of arithmetic and of the cell functions uses the
complex-aware kernels (`_SYS.sadd`, `_SYS.smul`, `_SYS.csqrt`, …), as for
`list<complex>`, while cells typed `real` or `integer` keep the real lane.
`auto` first attempts strict mode and retries once in complex mode on a lane
mismatch. The result records its effective mode, promotion, escalation,
and diagnostic.

Unknown-sign radical operations are the promotion trigger. Real-only kernels
guard and project only where the model explicitly permits it. `Mean`,
`Variance`, `StandardDeviation` and their population forms are the exception
on JavaScript (`CompileTarget.complexLowering`): in the `auto` and `complex`
modes, data that may hold a complex entry takes `_SYS.cmean`, `_SYS.cvariance`
and the like, which compute the interpreter's value (`Mean([3, 4i])` is
`1.5 + 2i`; the variance is the real sum of `|x − mean|²` over `n − 1`)
instead of `NaN`. Real data gives the same bits as the real lowerings. A
caller's own lowering of these heads is used as it is. The `strict` mode
still declines such data.

A `Power` whose base type does not give its rank and cannot hold a point
(`tensor<number>`, `list<list<number>>`, `broadcastable<number>`) decides on
the value at run time, as the interpreter does: `_SYS.matrixPowerShape` gives
the matrix power for an integer power of a square matrix, and of each matrix
of a tensor of rank 3, throws for an integer power other than 1 of a matrix
that is not square (the interpreter's `expected-square-matrix` error; the
`matrix<…>` lowering `_SYS.matpow` throws it too), and the element-wise power
runs for any other shape. The interpreter takes the matrix power for an EXACT
integer exponent only, so the compiler reads the exponent expression: one
with a float in it (`1.5x`) keeps the element-wise code; an exact one (a
symbol, an integer-typed expression, `n/2`, `2^k`) takes the matrix power at
an integer value; and one whose exactness it cannot read (`2x` on a `real`
input, a user function, `sin x`) throws where the value is a matrix and the
exponent an integer other than 1. An exponent that is not an integer but
within a relative `1e-12` of a nonzero integer throws too where the base holds
a matrix: it is most likely an exact integer computed in floating point
(`√n·√n` at `n = 2` is `2.0000000000000004`). `Inverse` and `m^-1` of a
non-square `matrix<…>` throw the same error. A caller's own `Power` lowering
(`functions`, `operators`) is used as it is, with no dispatch. A list exponent is paired with
the base level by level, as in the interpreter; when that pairing meets a
matrix with an integer entry (`p^[1, 2]` for `p` of rank 3), the code throws,
since it does not compute that matrix power. A base whose type may hold a
point (`list<unknown>`, a bare `list`, `list<tuple<…>>`) keeps the
element-wise power: a point is an array at run time, so a list of points and
a matrix have the same value there, and hosts pass lists of points.

A declared real result is real on every mode. A function declared with a real
result type (`p: (real) -> real`, also `-> finite_real` and `-> nan | real`)
has its body wrapped in a real ascription, `Typed(body, 'real')`. When the
body is complex only because of promotion — complex with promotion on, real
with promotion off — the ascription selects the real lane for the body: the
body compiles with promotion off, as `strict` compiles it, in the `auto` mode
and in the `complex` mode. An unknown-sign `Sqrt`, `Ln`, `Log`, even `Root` or
non-integer `Power` in the body then gives `NaN` outside its real domain, the
same value that `strict` gives. This is the reading that a real-typed symbol
already has: the type `real` excludes `NaN`, and `NaN` is the answer when a
real result has no value. The result reports `promoted: false` for such a body.
For example, with `p := k ↦ sin(2.4k)·√((k − 0.5)/16)`, `p(x)` compiles to
`Math.sin(2.4 * k) * Math.sqrt(0.0625 * (k + -0.5))` and is `NaN` at `x = 0`.

The rule applies only where it changes the lane of the body:

- A body that is real also with promotion on (`|√k|`) keeps its promoted
  heads, and `|√(−4)|` is `2`, as the interpreter computes it.
- A body that is complex also with promotion off still declines with "Could
  not compile `Typed`: the value … is complex, but its ascribed type `real`
  says it is real". Such a body has an operand that is complex by its type
  (`q := z ↦ z²` called with a `complex` argument), a call of a user function
  whose definition is complex (a definition is shared by every call site, so
  it is never recompiled on the real lane for one caller), or, in the `complex`
  mode, a node whose type admits a complex value. The `complex` mode reads
  such a node as complex without promotion: a parameter declared `unknown`
  (`(unknown) -> real`), and also a radical over a parameter that the
  function literal leaves untyped, which types `number`. A call that the
  compiler inlines substitutes the typed argument and avoids this. An emitted
  definition (a recursive function, for example) is compiled in the `complex`
  mode with the parameter types of the declared signature when they are real
  types narrower than the literal's, so `p: (real) -> real` assigned a
  recursive `k ↦ …` compiles there too (ROADMAP CE-230.1).
- A result type that admits a complex value (`-> number`, `-> complex`) is not
  a real result, and the body promotes as before.
- The value of an assigned symbol that the body reads is compiled with
  promotion off too, as the rest of the body: with `a := √(c − 1)` and
  `p := y ↦ a·y`, `p(x)` reads `Math.sqrt(c - 1)`, `NaN` for `c < 1`. The
  shared preamble local of the value (`_val_a`) keeps the promotion of the
  mode for the other readers; a value that is complex only by promotion gets a
  second local with promotion off (`_val_a$r`) for the readers in a real
  ascription (ROADMAP CE-230.2). A user-function definition is not recompiled
  this way: it is shared by every call site.
- The shader targets never promote, so nothing changes there.

The fold-before-shape rule: the analysis that decides whether a node is
complex (`BaseCompiler.isComplexValued`) and the emitters that write the node
must give the same answer, so they ask one question in one place. For a closed
constant, that place reads the memoized constant fold first
(`_withFoldedRealOverride` in `base-compiler.ts`): `√(5 − √5)` has a type that
admits a complex value, but it folds to a real number, so it is read as real
and emitted as a real literal. The fold is memoized for each target and
expression, so the answer cannot change between analysis and emission. A
change to how a shape is read must go into that shared question, not into one
consumer: a consumer that reads the shape on its own wraps a plain number in
the `{re, im}` convention, which turns a safe decline into a silent `NaN`.
Where the compilation does not fold (`constantFold: false`, a `symbolDeps`
capture, a target other than JavaScript), the type alone decides.

A `Sum` or `Product` over a small constant range is unrolled by mapping the
index NAME to a literal in the emitted code, so the analysis reads a body in
which the index is still a free symbol. Each unrolled term therefore also
hands the analysis its own index VALUES: a subtree that mentions the index and
folds to a real constant under those values is real-emitted, which keeps a
radical such as `√(1 − 0.025²(i − 0.5)²)` on the real kernel in every term.

Three conditions hold this to the shape invariant. The clause must have a
single indexing set with constant bounds inside the unroll limit, so the
terms the analysis reads are the terms the emitter writes. Every term must be
real under its own value, because the terms feed ONE accumulator, which holds
plain numbers or `{re, im}` objects and never a mix; a clause whose terms
disagree keeps the index-masked verdict and its uniform lowering. And the
question is asked in one place — the target's `unrolledClauseLane` — which
both the emitter and `isComplexValued`'s answer for the whole `Sum` read, so
the enclosing expression expects the shape the terms produce.

A subtree that does NOT mention the index is left to the ordinary
fold-before-shape rule, because loop-invariant hoisting may compile it once
outside any term. The whole mechanism is inert wherever the compilation does
not fold constants (`constantFold: false`, a `symbolDeps` capture, a
non-JavaScript target).

A function whose result jumps at a point (`JUMP_FUNCTIONS` in
`jump-functions.ts`: `Floor`, `Fract`, `Mod`, `Sign`, the comparisons, …)
applied to closed exact operands is folded on every target except
`interval-js`, also under `constantFold: false` and under a `symbolDeps`
capture. The structural code computes the operands as doubles, and a double
can be on the other side of the jump from the exact value:
`Floor((25! − 1)/24!)` is `24`, but the double of the operand is `25.0`. The
fold reads the exact value, as the interpreter does. A comparison folded this
way is emitted as the target's boolean constant (`True` on Python). Under a
`symbolDeps` capture the fold records every symbol whose value it reads, and
declines when the operand calls a user function. Operands with a free
variable, operands with a float literal, and operands that are all integer
literals in the safe integer range keep their structural code. The interval
target is excluded because its code computes an enclosure, and the enclosure
of such a node contains the exact value (`closedExactJump` in
`base-compiler.ts`).

A rounding function (`Floor`, `Ceil`, `Round`, `Truncate`, `Fract`) whose
operand adds an integer-typed variable `v` (a loop index, an integer-typed
symbol, a sum of them with integer coefficients) to closed exact terms `c`
that no double holds exactly is compiled from a form that rounds `c` alone:
`Floor(v + c) = v + Floor(c)`, `Ceil(v + c) = v + Ceil(c)`,
`Fract(v + c) = Fract(c)`, `Round(v + c) = v + Round(c)` when `c` is not
halfway between two integers, and `Truncate(v + c) = If(v ≥ −Floor(c),
v + Floor(c), v + Ceil(c))`, since truncation is not shift-invariant across 0.
The rounded constant is then a closed exact jump node, folded as above. So
`Sum(x·Floor(k + (25! − 1)/24!), k, 1, 300)` gives the interpreter's value in
the unrolled form and in the loop form. Every other shape whose variables are
all integer-typed declines with the `correctness` diagnostic
`inexact-jump-operand`: a variable part that is not an integer
(`Floor(k/3 + 1/7)`), a product (`Floor(k·π)`), a constant inside a variable
term (`Floor(k·√2 + 1)`), a step form, and a `Round` whose constant may be a
tie. A shape with a variable that is not integer-typed keeps its structural
code on every target, GLSL and WGSL included: `Floor(π·x)`, `Floor(x + 1/3)`,
`Floor(x/√2)`, `Floor(y/3 + 1/7)` for a real `x` or `y`, and also
`Floor(k + x + c)` with an integer `k` and a real `x`. There, the double of the
constant moves the jump by about one unit in the last place, as in any float
code. So `Floor(x + (25! − 1)/24!)` at `x = 1` gives 26 in the compiled code,
where the interpreter gives 25: the double of `(25! − 1)/24!` is 25.0. A
literal that a double holds exactly (`Floor(k + 1/2)`) and a rational factor
whose numerator and denominator a double holds (`Floor(2k/3)`, emitted as a
division and a multiplication by integers) keep their structural code, as do
an operand with a float literal and the interval target (`jumpShiftRewrite`
in `base-compiler.ts`).

A real-only head (an ordering comparison, `Floor`, `Mod`, `Min`, `Erf`, …)
over an operand that may be complex at run time takes the runtime rule in the
`auto` and `complex` modes: the operand is bound once, the head's real
lowering runs on its real part when the imaginary part is exactly zero, and
the value is `NaN` (or `false`, for an ordering) otherwise. A statically
non-real operand (`i`, `2i`, an `imaginary`-typed symbol, a list literal every
element of which is non-real) is a compile-time decline. When such an operand
is an ARRAY at run time — `√L` over a real list `L`, a `list<complex>` symbol,
a selection with such an arm — the rule is element-wise: every maybe-complex
operand of the head is replaced by its element-wise real projection (each
exactly-real element as its real part, every other element as `NaN`), and the
real lowering broadcasts or reduces over the projections. `⌊√L⌋` floors each
real root and answers `NaN` at a complex one; `min(√L)` is `NaN` as soon as
one root is complex; `√L < 1` is `false` at a complex root; `L < w` at a
complex scalar `w` is `false` at every element (the value keeps the head's
shape). In `strict` mode nothing changes: such an operand fails closed.
Targets provide the projection through the `complexRealElements` hook
(`_SYS.crealElements` on JavaScript, `_ce_creal_elems` on Python); a target
without it keeps the compile-time decline. The `complexPromotion` option, a
compatibility alias of `mode: 'complex'` since 0.115.0, is removed with no
warning: a call that still passes `true` is compiled in the default `auto`
mode, which promotes unknown-sign radicals but does not lift wide bindings as
`complex` does. The `realOnly` option, which projected a compiled unit's
RESULT to a real number (or `NaN`) after the kernel had run, is removed, and
so is its warning: a compiled value whose
imaginary part is exactly zero is already returned as a plain number, so a
consumer tests `typeof v === 'number'` per sample and maps a `{re, im}` at its
own value boundary.

The remaining quiet-machine performance measurement is tracked in
`plans/2026-08-16-compile-complex-mode.md`.

### The `bigint` mode

**What it is for.** In the other modes every number is a double, so an
integer past `2^53 − 1` is rounded, and `Mod`, `Remainder`, `GCD` and `LCM`
throw for such an operand ("Integer operations beyond the safe integer
range"). The `bigint` mode computes every integer value as a JavaScript
`bigint`, so a counting function (a binomial sum, a ballot number, the
unranking of a Dyck path) is exact at any size. With `n: integer`, the
Catalan form `Binomial(2n, n) − Binomial(2n, n + 1)` at `n = 40n` gives
`2622127042276492108820n`, and `Mod(n, 10)` at `n = 2^60 + 1` gives `7n`
(GitHub issue #503).

**How to request it.** `compile(expr, { mode: 'bigint' })`. Only the
built-in `javascript` target offers it. A custom target that lists
`'bigint'` in its `supportedModes` still declines with
`'unsupported-mode'`. The `auto` mode never selects `bigint`, and a request
for `bigint` compiles once, with no retry in another mode. The result
reports `mode: 'bigint'` and `promoted: false`. Inside the compiler the mode
is the `strict` discipline with a second setting, the integer lane
(`'bigint'` in place of `'double'`).

**Which nodes compile.** Every numeric node is on the integer lane (its
value at run time is a `bigint`), or the compilation declines. A node is on
the lane when two conditions are true:

- Its type is a subtype of `integer | nan | infinity | signed_infinity`: each
  finite value is an integer. For some heads the engine gives a wider type
  than the value that the operands permit, and the mode uses a narrower
  type, for this mode only: `Abs(n!)` is `integer<0..> | infinity`,
  `Mod(n, m)` is `integer | nan`, `n^k` with `k: integer<0..>` is `integer`,
  `Length(L)` is `integer<0..>`, and a sum, a product, `Min`, `Max`, `If`,
  `Which`, `Fold`, `Reduce`, `Sum`, `Product` or a user call whose operands
  are all on the lane is `integer` plus the non-finite members of the
  operands (`f(n) + 1` with `f := x ↦ x!`).
- Its head is on the list of the mode, or it is an integer literal, an input
  of a subtype of `integer`, or a call of a user function. The list:
  `Add`, `Subtract`, `Negate`, `Multiply`; `Power` with an exponent of type
  `integer<0..>`, and `(−1)^k` for any `k` on the lane; `Abs`, `Min`, `Max`,
  `Sign`; `Mod`, `Remainder`, `GCD`, `LCM`; `Factorial`, `Binomial`,
  `Fibonacci`, and `Factorial2` of an operand of type `integer<0..>`;
  `Floor`, `Ceil`, `Round`, `Truncate` (see below); `Sum` and `Product`;
  `Fold` and `Reduce` over a `Range` or a `list<integer>`; `Range`, `List`,
  `Map`; `If` with an else branch and `Which` with a final `True` clause;
  `Typed(…, T)` with `T` a subtype of `integer`; `Length`, `Count`,
  `Boole`; `At`, `First`, `Last`, `Take`, `Drop` and `ReplaceAt` with an
  index or a count on the lane. Many heads of type `integer` are not on the
  list, because their lowering gives a double (`DigitSum`,
  `IntegerDigits`, `RandomInteger`, `IndexOf`).

A boolean node is not on the lane. It compiles when it is a comparison
(`Less`, `Greater`, `LessEqual`, `GreaterEqual`, `Equal`, `NotEqual`) of two
operands on the lane, `IsPrime` of an operand on the lane, or `And`, `Or`,
`Not` of such nodes. A comparison with a rational constant is exact: `n < p/q`
is computed as `q·n < p` with `bigint` values. So `n ≥ (3·2^53 + 1)/2` at
`n = 3·2^52` is `false`, as in the interpreter, where a comparison with the
double of the constant gives `true`. `Equal(n, 1/3)` is `false` and
`NotEqual(n, 1/3)` is `true` for every `n`.

**A quotient under a rounding function or an integer promise.** A node of
type `rational` has no `bigint` value. Four shapes of such a node compile,
when their operands are on the lane and their parent requires an integer:
`p/q · t` (canonicalization writes `n(n + 1)/2` as
`Multiply(Rational(1, 2), n, n + 1)`), `a/b`, `a^e` with an exponent that
can be negative (`2^(−n)`), and `Sqrt(t)` (under a rounding function only).
The parent sets the lowering:

- Under `Floor`, `Ceil`, `Round` or `Truncate`, the quotient is rounded
  exactly: `Floor(n/3)`, `Ceil(n/2)`, `Floor(2^(−n))` (`0n` at `n = 3`).
  `Round` rounds a half away from zero (`Round(5/2)` is `3`, `Round(−5/2)`
  is `−3`), as the interpreter does. `Floor(Sqrt(n))` is the integer square
  root, and `Ceil` and `Round` of `Sqrt(n)` are exact too, also past `2^53`.
- Under an integer promise, the division is checked: a remainder that is not
  zero throws a `RangeError` that names the operands (`The quotient 7 / 2 is
  not an integer, but its value was promised to be an integer`). An integer
  promise is `Typed(…, T)` with `T` a subtype of `integer`, the body of a
  user function declared `-> integer`, and an argument at a parameter that
  the signature of the head declares `integer` (`Fibonacci(n/2)`). The
  interpreter gives a type error there. `Mod`, `Binomial`, `GCD`, `Range`
  and the limits of a `Sum` are not integer promises: `Mod(n/2, 7)` is `3/2`
  at `n = 3` in the interpreter, and it declines.

Such a quotient is computed for its parent only, so common-subexpression
elimination does not share it: `Floor(n/2) + Ceil(n/2)` at `n = 7` is `7n`.

**Loops.** `Sum`, `Product`, `Range` and `Fold` over a range with bounds on
the lane count with a `bigint` index, so `Sum(Mod(k, 7), k = 1..n)` at
`n = 10^6` is exact. These sums compile: `Sum(k!, k = 0..n)`,
`Sum(Floor(n/k), k = 1..n)`, and the derangement sum
`Sum((−1)^k·Binomial(n, k)·(n − k)!, k = 0..n)`. A rational bound
(`Sum(i, i = 1..n/2)`) declines.

**User functions.** A parameter of a subtype of `integer` is on the lane,
and a parameter of type `number`, `real` or `complex` is not. A call whose
argument is on the lane at a parameter that is not, or the reverse, declines:
with `h: (number) -> number`, `h(n)` declines. A function literal with no
parameter types takes the lane of its argument. A recursive function
compiles with the parameter lanes of its signature.

**What declines.** The compilation declines with the diagnostic code
`'bigint-lane'`, of kind `'capability'`, whose message names the node and
its type, and the expression runs on the interpreter, as every decline does.
This code is not `'lane-mismatch'`, so the `auto` retry does not start.
Examples, with `n`, `m: integer` and `x: real`:

| Expression                                                | Reason of the decline                                          |
| --------------------------------------------------------- | -------------------------------------------------------------- |
| `n + x`                                                    | an input that is not of a subtype of `integer`                 |
| `n(n + 1)/2`, `2^n`, `Binomial(2n, n)/(n + 1)`             | a type that is not an integer type, with no rounding parent    |
| `Sqrt(n)`                                                  | the same; `Floor(Sqrt(n))` compiles                            |
| `Mod(n/2, 7)`                                              | `Mod` is not an integer promise                                |
| `n^m`                                                      | the exponent is not of type `integer<0..>`                     |
| `Factorial2(n)`                                            | the operand is not of type `integer<0..>` (`(−5)!! = 1/3`)     |
| `DigitSum(n)`, `IsEven(n)`                                 | a head that is not on the list                                 |
| `String(n)`                                                | the interpreter writes a large integer in exponent form (`"1e+30"`) |
| `n + 10π`                                                  | a real constant has no exact `bigint` value                    |
| `h(n)` with `h: (number) -> number`                        | the argument and the parameter are on different lanes          |
| `Piecewise(…)`, `If` with no else, `0 < n < m`, a `Block` of more than one statement | not on the list in this version              |
| `Sum(i, i = 1..n/2)`                                       | a rational bound                                               |

An input whose type admits a non-finite value (`integer | infinity`)
declines too.

**Inputs.** An integer input (a free symbol or a parameter of a subtype of
`integer`) takes a `bigint`, or a `number` that is a safe integer. The
emitted code converts a `number` to a `bigint`, so the conversion is done in
every runner, also with `entryChecks: false`. With the entry checks on (the
default), a `number` that is not a safe integer (`1.5`, `2^60`), and a value
that is neither a `number` nor a `bigint`, throw a `TypeError` that names
the input: `"n" was compiled in mode 'bigint' as an integer, and received
the number 1.5`. With the checks off, a `number` that is not an integer
throws the `RangeError` of `BigInt()`, and another value outside the type
gives an unspecified result. A `list<integer>` input (also nested) is an
array of `bigint`. With the entry checks on, its `number` cells are
converted in a copy, and a cell that is not an integer throws a `TypeError`
that names the cell; with the checks off, the host must give `bigint` cells.
A function literal at the root returns a function that converts and checks
its arguments in the same way.

**Results.** A result on the lane is a `bigint` for every finite integer,
also a small one, and a list result is an array of `bigint`. A boolean
result is a `boolean`. A result is a `number`, `NaN` or `Infinity`, when a
sub-expression had no finite value (a pole): a helper at a pole throws an
internal error that carries the `number`, and one catch around the compiled
entry (and around a function returned to the host) returns it. `Infinity` is
the value for a `~oo` of the interpreter (`(−1)!`, a zero divisor with a
dividend that is not zero, `0` to a negative power), and `NaN` for an
`Indeterminate` (`Mod(n, 0)`, `0/0`, `0^0`, the square root of a negative
number, an index out of range). A recursive function has no catch of its
own: the catch of the entry gets the error. A pole in one cell of a list
makes the whole result a `number`.

A `number` result has no defined relation to the value of `evaluate()`.
This is the exception to the rule of "Fail closed". The compiler does not
test where a pole can occur: the throw ends the whole computation, so no
operator receives a non-finite value and no finite result is computed from
one, but the operators between the pole and the result do not change the
`number`. Examples at `n = −1`, `m = 0`:

| Expression                   | `evaluate()`                | Compiled                   |
| ---------------------------- | --------------------------- | -------------------------- |
| `n!`                         | `~oo`                       | `Infinity`                 |
| `−\|n!\|`                    | `−oo`                       | `Infinity`                 |
| `n! > 5`                     | `False`                     | `Infinity` (not a boolean) |
| `g(n!)`, `g := x ↦ 1`        | `1`                         | `Infinity`                 |
| `Mod(n, m)`                  | `Indeterminate`             | `NaN`                      |
| `Mod(n!, 7)`                 | `incompatible-type` error   | `Infinity`                 |
| `Map(Range(−1, 1), k ↦ k!)`  | `[~oo, 1, 1]`               | `Infinity` (the whole list) |
| `If(n < 0, 0, n!)`           | `0`                         | `0n`                       |

A host that needs the value at such an input evaluates the expression with
the interpreter.

The compiled `Map` builds every element, and the interpreter's `Map` is
lazy. So with `hf: (integer) -> integer := x ↦ x/2`,
`Length(Map(hf, L))` at `L = [1, 2]` is `2` in the interpreter, and the
compiled code throws the `RangeError` of the checked division at `hf(1)`.

**Two `RangeError` cases.** A checked division with a remainder under an
integer promise, and the size limit (below), throw a `RangeError` to the
caller. When an expression holds a pole and one of these, the one that the
code computes first decides whether the result is a `number` or a
`RangeError`: `n! + Fibonacci(m)` at `n = −1`, `m = 10^9` throws the
`RangeError`, because the canonical order puts `Fibonacci(m)` first. Common-subexpression
elimination computes a shared subexpression before the other code, so the
`cse` option can change which of the two the host receives. It never changes
a `bigint` or a `boolean` result. A `bigint` division by `0n` never throws
its native `RangeError`: every helper tests its divisor.

**The size limit.** `Power`, a quotient `a^e` under a rounding function,
`Factorial`, `Factorial2`, `Binomial` and `Fibonacci` estimate the number
of decimal digits of their result before they compute it. Past 1,000,000
digits, the limit of the interpreter, they throw a `RangeError` that names
the operation: `Fibonacci(n)` at `n = 10n ** 9n` throws at once. The
interpreter leaves such an expression unevaluated. Both mean "no value", but
the host receives a `RangeError` from the compiled code and an unevaluated
expression from the interpreter. A power of `0`, `1` or `−1` has no limit.
The loops and the `*` operator have no limit: `Product(k, k = 1..n)`
computes `n!` with no limit, as a loop of the other modes runs with no
limit. A host that compiles expressions it does not trust limits its
inputs.

**Constant folding.** A constant subtree on the lane is folded to a
`bigint` literal from the exact value of `evaluate()`:
`Mod(2^60 + 1, 10)` compiles to `7n`, and no rounding occurs. A constant
whose value is a finite number that is not an integer declines outside a
rounding function or an integer promise (`n + 1/2`), and so does a
constant that the interpreter leaves unevaluated (`Fibonacci(10^9)`). A
constant whose value is not finite (`(−1)!`, `0^(−1)`, `Mod(5, 0)`, or a
symbol whose value is `~oo`) is a pole: the code throws it only where the
node is evaluated, so `If(n > 0, n, (−1)!)` is `3n` at `n = 3` and
`Infinity` at `n = −2`. A constant pole is not shared by
common-subexpression elimination.

**The batch runners refuse the mode.** `broadcast()` and `broadcastAsync()`
call the code for each element and write `Float64Array` outputs, which
cannot hold a `bigint`. In the `bigint` mode they throw `Code compiled in
mode 'bigint' cannot be broadcast`. The stored JavaScript records the mode
(the `mode` field), and the batch loaders `loadBroadcast`,
`loadBroadcastSlice` and `loadBroadcastAsync` of
`createJavaScriptRuntime()` refuse it before they start a worker. The code
that `load()` rebuilds gives the same values as `run()`, because the
conversion of the inputs and the catch are in the emitted code.

The Python target does not offer the mode: a Python integer is exact at
any size already. Design and the deferred shapes (ROADMAP CE-715.2 to
CE-715.8): `docs/plans/2026-10-31-ce715-bigint-compile-mode.md`.

## User functions and dispatch

Single and multi-clause functions compile once per artifact. Multi-clause
dispatch uses the same specificity order as the interpreter. If any required
guard cannot be expressed, the entire function declines; compiling a subset of
clauses would change dispatch.

A compiled artifact contains each user function as it was defined when
`compile()` ran. Assigning a new definition later does not change an artifact
that is already compiled. The public `compile()` keeps no cache: each call
compiles again and reads the current definitions. A caller that needs a
function it can replace after compiling passes it through the `functions`
option and reads the live implementation from `globalThis` (see "Running
stored JavaScript" for how such a function is copied).

A recursive or mutually recursive user function compiles to real recursion on
the JavaScript target, with no depth guard: a runaway recursion throws a
`RangeError` from the JavaScript stack, as an unbounded `Loop` already runs
without a guard. The shader targets cannot recurse, so a recursive function
fails closed there with a message that asks for a bounded loop. The Python
target declines it too.

Protocol calls resolve directly when static typing proves one implementation.
Dynamic JavaScript dispatch uses the receiver's runtime nominal tag. Targets
without the tag representation decline.

Common-subexpression elimination never crosses a definition boundary: each call
of a definition emitted by reference is a fresh evaluation of its body. On the
JavaScript target, a definition whose body has no observable effect (directly
or through an assigned symbol value) and whose parameters are all scalar is
wrapped in a last-call memo when the artifact calls it from inside another
definition and from two or more places in all, and its emitted body is at
least 600 characters (below that the engine inlines the definition and shares
its subexpressions itself): the wrapper remembers the arguments and result of
the most recent call and answers a repeated call with the same arguments from
that record. Every vars-object binding the body reads, directly or through a
definition it calls (a slider reaches a compiled row this way), is part of the
key next to the arguments. Keys are compared by value, with `NaN` equal to
`NaN` and `0` distinct from `-0`; a key that is not a number, a string or a
boolean, or a result that is an object or a function, bypasses the record. The
record lives in the definition's closure, so two artifacts never share it. A
definition called from one place, or only from the root, is emitted unchanged.
The rule is implemented by `memoizeSharedDefinitions` in `javascript-target.ts`.

### Parameters with a default value

A parameter with a default value (`(x, k = 2) => x * k`, the MathJSON
parameter `["Optional", "k", 2]`) is filled when a call leaves it out. A call
of a declared function written in the expression needs no compiler work: its
canonical form already holds the default (`f(3)` is `f(3, 2)`). The compiler
fills the other calls. In each case the default is compiled as the operand
that a call written at that place would read: a value default is the target's
spelling of the value, a symbol default is a read of the symbol when the call
is made, and `[]` or `{}` is a new value at each call (`({})` in JavaScript,
`{}` in Python; the interval-js, GLSL and WGSL targets have no dictionary
value, so a `{}` default declines there, as a written `{}` does).

- JavaScript, a function literal compiled as a value (a `Map` callback, a
  block-local function, the root of `compile()`): the emitted function fills
  each parameter that the call leaves out. When the parameter's type cannot
  hold `missing` (an annotation such as `k: number`), the fill is a JavaScript
  default parameter, `(x, k = 2) => …`. A JavaScript default is also used for
  a supplied `undefined`, which is the run-time value of `Missing`, and the
  interpreter keeps a supplied `Missing`. So when the type can hold `missing`
  (an unannotated parameter is `unknown`, or `k: number | missing = 2`), the
  fill tests the number of arguments in a `function` expression:
  `if (arguments.length < 2) k = 2`. A symbol default and a literal that a
  broadcasting or complex-coercing wrapper calls take the fill in an outer
  wrapper, so the inner wrappers receive every argument. A function from
  `compile()` itself fills the omitted arguments before its entry checks,
  after the definitions of its preamble, which a default can read (the
  default `D` of a constant list is the definition `_val_D`).
- JavaScript, a user function referenced as a value (`Map(f, L)`): its value
  is an outer wrapper, `_fn_f$…$d`, with the same fills; its definition is
  emitted with every parameter required, as all its written calls supply
  them. When a default is a symbol, the wrapper is compiled where the value
  is referenced, and is not shared: the symbol is read in that scope, as
  for a call written there.
- Python: a number, string or boolean default is a Python default parameter
  (`lambda x, k=2: …`). A Python default is evaluated once, when the lambda
  is made, so a symbol default and `[]` take an omission marker, a fresh
  `object()` bound once around the lambda under a fresh name: `lambda x,
  k=_tv1: …` runs the body with `d if k is _tv1 else k`.
- GLSL and WGSL: a shader function has no default parameters. A call of a
  literal that leaves out a parameter (a partial application applied to the
  remaining required arguments, or the callback of a `Map` that is written
  out element by element) is completed at the call site with the default
  operand, compiled as a written operand. A symbol default that the target
  cannot compile declines as the written symbol would.
- Interval JavaScript: an application of a literal is completed at the call
  site in the same way, so a value default is an interval constant (`_k1`).
  A literal compiled as a value (the callback of `_IA.map`, a block-local
  function) is a JavaScript function and takes the fills of the JavaScript
  target, compiled by the interval target.

A call of a block-local function is completed at the call site on every
target, except for a local that is assigned more than once: its other values
can have other defaults, so such a call must supply every parameter. The
`Apply` arity checks of the targets accept any count from the number of
required parameters to the number of parameters. A multi-clause function
cannot have a default (it is a declaration error), so the multi-clause
emission never sees one.

## Collections

Compiled broadcasting preserves the interpreter's strict lifted regime.
Compiled pairing preserves shortest-input semantics. `PointList`, elementwise
selection, Map lowering/fusion, exact-map proof, and collection callbacks must
retain evaluation-once and effect ordering.

A `PointList` with list components compiles on the JavaScript target to a
map over the shortest component, scalar components repeated in each point.
An `iterationBudget` option caps that length, and the list is then truncated
(user decision 2026-07-31). This differs on purpose from a `Sum` or `Product`
over budget, which gives `NaN`: a truncated point list still draws its first
points.

A restriction `value\{conditions\}` (`When`) whose condition is a list
compiles on the JavaScript target through `_SYS.restrict`, one position for
each condition (user decision 2026-09-15). A list value is aligned with the
conditions and truncated to the shorter of the two, as the interpreter aligns
them; a number or a point is one value, repeated at each position. A position
whose condition is not true holds the absence value: `NaN` (or its complex
form) for a number, `undefined` for a point or a string. A value that may be
either a list or a point at run time declines.

An infinite collection compiles on the JavaScript target only under a
bounding consumer: `Take`, `TakeWhile`, or `First` and `At` with a constant
positive integer index. A `Range` with an infinite literal end and a `Map`,
`Filter`, `Drop` or `Rest` pipeline over one, and an `Iterate` with a
`Drop` or `Rest` pipeline over it, lower to lazy iterators
(`_SYS.rangeIter`, `_SYS.iterateIter`, `_SYS.mapIter`, …) under that
consumer; every other consumer declines with "bound it with `Take` or
`TakeWhile`". A `Map` or a `Filter` over an `Iterate` declines: the check
of the omitted elements of the stage reads the type of the `Iterate`, a
`list` with no element type. `At` with another index declines: the
interpreter answers `Missing` for an `Iterate` and `NaN` for a `Range`
there. An `Iterate` compiles only for a sequence of real numbers with an
initial value: the initial value and the result of the function must be real
numbers that cannot be absent, so that the accumulator has one shape at every
step. The function must be pure: the interpreter computes the elements before
a position again for each read, so the effects of a function that is not pure
would run more often there than in the compiled stream. A finite
collection keeps its eager array lowering. `DropWhile` over an infinite source
declines, because the interpreter leaves it unevaluated. In
`javascript-target.ts`, `isLazyStream` decides which operands take the lazy
lowering and `emitLazyStream` writes it, so the two must accept exactly the
same shapes.

`Sort` with an ordering function compiles on the JavaScript target
(`compileJSSortWithCallback`). As in the interpreter, a function whose type
says it takes one argument is a sort key, and any other function is a
comparator. A sort key compiles when its result is a real number; a comparator
compiles when its result is a boolean or a number, and its elements are real
numbers or values that cannot be numbers. A result that can compile to a
complex value (`x ↦ √x`) declines. The compiled sort orders the positions of
the elements with `Array.prototype.sort`, as the interpreter does, so the two
routes ask the same comparisons in the same order.

`Pipe(x, stage)` compiles on the JavaScript and Python targets as the
expression that it evaluates (`pipeApplication`): a call that is missing one
argument receives `x` in the slot that the interpreter selects
(`Pipe(xs, Map(f))` is `Map(f, xs)`), a function literal with one parameter is
applied to `x`, and the name of an operator is called with `x`. A call with
its own slots is lifted to a function literal whose parameters are the slots
(`Pipe(L, Take(_, 2))` is `Apply(_1 ↦ Take(_1, 2), L)`). Any other stage
declines, and so does a call stage whose piped value is itself a `Pipe` when
the static type of the inner pipe does not settle the slot: the interpreter
selects the slot from the type of the value of the inner pipe.

Two analyses decide whether an operand can be an array at run time on the
JavaScript target, and they are separate code. The comparison and connective
lowerings ask `isPossiblyCollectionTypedJS` in `javascript-target.ts`. The
arithmetic broadcast (`Add`, `Multiply`, … through `tryCompileBroadcast`) asks
`isBoundPossiblyCollectionTyped` in `base-compiler.ts`, which reads the
"scalar by construction" facts of `javascript-value-facts.ts`
(`isConstructedScalar`). A change to one does not change the other: when an
arithmetic broadcast does not go away, look at `javascript-value-facts.ts`.

Both analyses read one more source of arrays, which a static type does not
show: a call of a user function that maps over a list argument at run time
(`mayHoldCallBroadcastResult` in `compiler-type-facts.ts`). With
`q(t) := 2t` and a free input `u` that nothing types, the engine types
`q(u)` as `number`, but the call is `_SYS.bcastFn(_fn_q, _.u)`, and
`run({ u: [1, 2, 3] })` gives `[2, 4, 6]`. So an operator over the call maps
over its result too: `1 + q(u)` compiles to `_SYS.bcast(…)` and gives the
interpreter's `[3, 5, 7]`. The rule reaches through the arguments of nested
calls (`1 + p(q(u))`), through library operators that broadcast
(`1 + sin(q(u))`), through the branches of `If` and `Which`, the last
statement of a `Block`, and the locals of a block that are assigned such a
value (`z := q(u); 1 + z`). It is not applied to an argument whose static
type is a scalar: a symbol declared `number`, or narrowed to `number` by a
use such as `u + 1`, makes a list there a break of the host's input
contract, and the scalar code stays. The rule can also flag a call that the
emitter compiles as a direct call (an argument that is a scalar by
construction but not by its static type); the operator then takes
`_SYS.bcast`, which applies its closure directly to scalar operands. Only
the JavaScript target maps a call over a list argument, so the rule does not
apply on the other targets.

This rule agrees with the rule that only a symbol declared `any` or `value`
is read as a possible list (user decision 2026-10-17, Tycho ledger row 379;
`isPossiblyCollectionTyped()` in `collection-utils.ts`): the run-time test is
on the result of the call, not on the undeclared symbol `u`, and the compiled
call already maps over a list `u` (user decision 2026-10-31). The other
choice, a decline of every operator over such a call, would send expressions
such as `q(x) + 1` with an untyped plot variable `x` to the interpreter.

The value of such a call is a number at almost every evaluation (a plot
variable), and `_SYS.bcast` costs a closure call per evaluation. So when the
calls are reached from the operator through library operators only
(`1 + q(u)`, `1 + 2 q(u)`, `Sin(q(u)) + q(u)`), the code evaluates each call
once, into a temporary, and tests it at run time (`callResultGuard` in
`compile-expr-handlers.ts`): an array or an absent value takes the
`_SYS.bcast` code, any other value takes the scalar code compiled with the
call read as a scalar. A call in a branch of an `If` or a `Which`, the last
statement of a `Block`, or a block local keeps the `_SYS.bcast` code with no
test, because the test would evaluate the call before its branch is taken.

An input that the host declared `any` or `value` can hold a list, and the
JavaScript target tests its value at run time at an element-wise site: it
emits the scalar code and the list code, and selects one with
`Array.isArray` (`declaredTopGuard` in `compile-expr-handlers.ts`). The
collection form of `Sum` and `Product` over such an input or over a
parameter declared `any` or `value` (`Sum(x)`, no indexing set) compiles to a
fold that tests the value at run time: a list is folded, a nested list
element-wise (`[[1, 2], [3, 4]]` gives `[4, 6]`), and a scalar gives itself,
as in the interpreter (`Sum(5)` is 5). An input
declared `expression` (or with an alias of it) can hold a list too, but the
compiled code has no such test for it, so the JavaScript target declines a
read of it as an input, and the interpreter computes the value: with
`ce.declare("x", "expression")`, `2x` declines, and `run({ x: [1, 2] })`
gives `[2, 4]`. A symbol declared `expression` with an assigned value is not
an input: its value is folded, and the expression compiles. A parameter
declared `expression` declines in the shapes that ROADMAP CE-693 lists.

A compiled user-function call whose parameters are all scalar carries a
runtime `Array.isArray` guard around each argument that is not a literal, so
a `run()` caller that supplies a list gets the interpreter's broadcast instead
of a silent wrong answer (user ruling 2026-08-30). The guard is not emitted
for an argument whose scalar type is an explicit declaration or is constructed
from such values by scalar arithmetic (user ruling 2026-09-07): the
declaration is the caller's input contract, and the interpreter itself refuses
a list for a `number`-declared symbol. A symbol whose scalar type was inferred
from its use in a scalar parameter keeps the guard, because that inference is
not a promise about the value the caller passes.

Two values inherit that same "scalar by construction" standing. A call of an
engine-defined function whose every argument is such a value is one, when the
callee's body yields a single scalar under scalar parameters — the body's
static type says so, or its `Block`, `If`/`Which` arms and nested calls all
do. And inside an emitted body, a parameter whose type in the function's
signature is a scalar one — `number` and its subtypes, `boolean`, `string`,
whether the author wrote that type or the engine inferred it (user ruling
2026-09-08) — is one. Every emitted call site of such a function hands that
parameter a scalar, because a call whose argument is not provably scalar is
dispatched element-wise or guarded, and the only form that passes an argument
straight through is the one an explicit caller declaration already exempts —
a caller that hands that form a list has broken its own declared contract.
The inference is trusted here, unlike at a top-level input, because the body
never chooses what reaches it: the call sites do, and they are all
broadcast-aware.

A compiled array carries no tuple-versus-list tag, and the compiled norm of
a point reads each coordinate by its static type: a scalar as is, a `tuple`
coordinate as a nested point that contributes its magnitude, a `list` or
`broadcastable` coordinate as a broadcast source, and a coordinate typed
`unknown`, bare `tuple` or `indexed_collection` — which may hold either — as
a list, the way the compiled arithmetic reads every nested array (user ruling
2026-09-11). The one value where that differs from the interpreter is a
nested point at such a coordinate, `((1, 2), 3)` under `tuple<unknown,
number>`, which the interpreter flattens into one norm and the compiled code
broadcasts. Declining the shape instead would refuse every untyped point
parameter whose body takes a norm, the commonest shape a document function
has, and the nested point is not a value the plotting consumers produce.

A parameter typed `unknown` or `any` has the same standing (user ruling
2026-09-09). The argument for it is the one above, and it does not depend on
the parameter's own type at all: what makes the parameter a run-time scalar is
that every emitted call site of its function is broadcast-aware, which is a
property of the FUNCTION — none of its parameters binds an argument whole — not
of the type inference. So `f(x) := g(x) + 1` emits the bare `_fn_g(x)`, the
same call an explicitly annotated `f(x: number)` emits, and a caller that
passes a list is broadcast element-wise at its own call site, so the body runs
once per element with a scalar bound. The body's own arithmetic already assumes
this: `x * x` is written for a product, not for a Hadamard product. This
matters because a whole class of consumer input cannot be annotated — a Desmos
macro chain is a chain of small untyped functions of one or two variables — and
each dispatch it used to emit cost roughly a factor of two in run time.

A COLLECTION parameter is the exception and keeps its dispatch: such a body
legitimately receives a list whole, the way `k(L) := Sum(L)` does, so its call
sites emit a bare call that could hand a list to a scalar sibling parameter. A
tuple- or point-typed parameter is excluded for the same reason.

The runtime broadcast of a user-function call is handed the emitted function
itself (`_SYS.bcastFn(_fn_f, …)`). A closure is emitted only when an argument
needs the `{ re, im }` coercion inside it; otherwise the closure would be an
eta-expansion of the callee.

An ATOMIC argument — a tuple (a point) or a nominal value — is bound whole by
the interpreter and never mapped over, yet it lowers to a JS array the runtime
broadcast would descend into. Such an argument is therefore HELD: it is bound
to a temporary once, and the broadcast closes over that temporary and maps the
other arguments only. So `f((a, b), [u, v])` with `f(p, x) := g(x)` runs the
body once per element of the list with the point bound whole, which is what the
interpreter does. Every argument that is not a literal is bound in the same
outer call, so an argument is evaluated exactly once and in source order — a
random draw in a coordinate draws one number. When every argument that is not
atomic is provably scalar, there is nothing to map over and the call is the
bare direct one.

A function REFERENCED AS A VALUE — the callback of `Map`, `Filter`, `Reduce`,
a comparator, a `PointList` role — is a call site too, and it is shape-aware
for the same reason the others are. The consumer of a function value hands the
callee whatever element the source holds, and an element can itself be a
collection: a row of a matrix. So a function whose parameters are all scalar
is handed out as a wrapper instead of the bare name — one closure per
function, emitted next to the function itself, which tests its arguments with
`Array.isArray`. Whether a function gets that wrapper follows what the
INTERPRETER does with a collection element at that callback:

- A function whose parameters are all scalar is applied ELEMENT-WISE by the
  interpreter: `Map(f, [[1, 2], [3, 4]])` over `f(x) := 2x` answers
  `[[2, 4], [6, 8]]`. It is handed out as a broadcasting wrapper (`_fn_f$b`)
  that dispatches through `_SYS.bcastFn`. The parameter TYPES make no
  difference here: a declared signature such as `(number) -> number`
  broadcasts exactly as an inferred `unknown` one does, which is the user
  ruling of 2026-09-22. Before that ruling the interpreter refused a
  declared-scalar callback at a callback position, and such a function was
  handed out as a second, guarding wrapper (`_fn_f$s`) that projected an array
  argument to NaN. Both halves now broadcast, so the two routes also agree on
  a source only SOME of whose elements are collections: `[[1, 2], 3]` answers
  `[[2, 4], 6]` compiled and interpreted alike.
- A function with a parameter that is not scalar at all keeps the bare
  reference, because the interpreter binds its arguments whole as well.

A MULTI-CLAUSE function is handed out through the same wrapper, under the same
rule read over the whole clause set: a clause that binds a collection, a tuple
or a nominal value whole keeps the bare dispatcher, and every other clause set
broadcasts. Its wrapper takes a REST parameter, where a single-clause one takes
a fixed parameter list, because the dispatcher selects its clause on the number
of arguments. That is safe because every consumer this compiler emits applies a
function value through an arrow of the arity it means to pass — `(_x) => _f(_x)`
for `Map`, `(_a, _b) => _f(_a, _b)` for a `Reduce` combiner — so none of them
supplies the extra index and source arguments `Array.prototype.map` would.

Where a parameter also needs the `{ re, im }` coercion, the wrapper takes the
coercing shim as its callee, so an element reaches the body coerced.

The other two things that can stand in a callback position both broadcast, and
take a wrapper of the first kind. A bare BUILT-IN operator name
(`Map(Sin, xs)`) is eta-expanded into a scalar kernel, so an element-wise
operator is handed out as `_fn_Sin$b`; its
wrapper dispatches through `_SYS.bcast`, the OPERATOR broadcast; a function
literal takes `_SYS.bcastFn`. The two follow the same element-wise rule,
empty operand included — a broadcast over a lone empty operand answers the
empty list (`Sin([])` is `[]`). A built-in that consumes its argument whole,
such as `Length` or `First`, is not broadcast by the interpreter either and
keeps the bare name. An INLINE function literal (`Map((x) ↦ 2x, xs)`) takes
the `_SYS.bcastFn` wrapper a named user function gets; having no name of its
own, the arrow is bound once — a `const` where a statement sink exists, an
immediately applied arrow otherwise — so the wrapper's two mentions of its
callee do not build a fresh closure per element. A literal with a
collection-typed parameter keeps the bare arrow.

The Python target has none of these run-time tests, and its arithmetic
operators do not map over a list (`2 * [[1, 2], [3, 4]]` repeats the list). It
reads a parameter that is not declared with a collection type as a scalar. So
an application of a function literal (`Apply`, `ApplyWhole`) declines when an
argument can be a collection (it is one, or its type is a collection type or a
union with one) and its parameter is not declared with a collection type: at a
scalar parameter the interpreter maps the function over the elements
(`((t) ↦ 2t)([[1, 2], [3, 4]])` is `[[2, 4], [6, 8]]`, and `((t) ↦ 1)([1, 2])`
is `[1, 1]`), and at a parameter declared `any` or `value` that the body reads
it binds the collection whole and maps each element-wise operator over it. A
callback of `Map`, `Reduce`, `Filter`, … declines for the same reason when a
parameter declared `any` or `value` that the body reads receives a value that
can be a collection: `Map((t: any) ↦ 2t, [[1, 2], [3, 4]])` declines, and the
interpreter gives `[[2, 4], [6, 8]]`. An argument of a top type (`unknown`,
`any`, `value`) is read as a scalar, as everywhere else on this target. A
parameter declared with a collection type (`list<number>`) compiles, through
the list lowerings of the body. This is the simple, sound version: a precise
one would map the lambda over the collection, or compile the body at the type
of the argument (`assertPyAppliedLiteralBindsScalars` and
`assertPyCallbackWideParams` in `python-target.ts`).

Implicit Map compilation obeys the engine-wide `jit` gate. Exact-mode Map
compilation requires an explicit proof that native-number execution preserves
the requested exact result. Structural or ABI failures are cached at the
appropriate expression-instance boundary.

### Dictionary literals

A dictionary literal compiles on the `javascript` and `python` targets, with
each value compiled: `{a -> x + 1}` is `({"a": _.x + 1})` in JavaScript and
`{"a": x + 1}` in Python. Each evaluation makes a new object, which has the
run-time form of a `dictionary` input (a plain object, a `dict`). A key is a
string literal; the JavaScript literal writes the key `__proto__` as the
computed key `["__proto__"]: v`, because the plain form `"__proto__": v` sets
the prototype of the object instead of making an own key. The shape of each
value comes from its static type: a value whose type is `unknown` or `any`
declines (a call of a block-local function has the result type of its
literal; an untyped free input is refused by the admission of the inputs,
which names it in `unsupported`; an untyped parameter or local is not an
input there, and declines here). A value whose type can be `Nothing` declines:
the interpreter leaves out such an entry, and the literal would keep the
key. Each value compiles as a value operand (`compileValueOperand()`), so an
assignment in a value declines on Python, as in any other operand. The
values are not operands of the node, so the shared-subexpression pass does
not enter them, but it records each assignment in them: a subexpression is
not shared across a write in a value (`recordDictionaryAssignments()` in
`cse.ts`). The interval-js, GLSL and WGSL targets have no dictionary value,
and a dictionary declines on them with that reason
(`CompileTarget.dictionary`, `_compileInner()` in `compiler-core.ts`).

On the JavaScript target, a result whose static type holds a dictionary or a
record at some depth (in a union member, a tuple element or a collection
element, at every level: `typeHoldsKeyedValue()`; for a `Block` that ends
with a call of a block-local function, the result type of its literal) is
returned under `normalizeKeyedRunResult()`, not
`normalizeRunResult()`: an object of such a result with the keys `re` and
`im` is a dictionary, not a complex number, so it is returned as it is. In
a value whose type holds both a record and a complex number, a complex
cell with a zero imaginary part is then returned as `{re, im: 0}`, not as a
number. A `dictionary` or `record` input or parameter has no real or complex
entry rule (`isKeyedEntryType()` in `javascript-target.ts`).

### GPU `At`

GPU `At` preserves the engine's 1-based indexing through a guarded target
projection. A statically sized real-scalar vector/array base and a scalar index
may lower; negative indices count from the end, while zero, out-of-range,
non-integer, and missing indices project to the target's NaN value. Literal
integer gathers may fold or lower when every selected element preserves
evaluation count. A discarded impure element forbids folding.

Dynamic gathers, runtime boolean masks, point-list bases, unknown extents, and
non-real element/index shapes decline. GLSL/WGSL bounds behavior is never
relied upon: the emitted helper guards before indexing. Aggregate widths and
index types are read from the GPU declaration frame when the boxed expression
itself is typed `unknown`.

## Color values

A color VALUE on the JavaScript target is a flat object that carries the color
space of its channels:

```ts
type CompiledColorSpace = 'oklch' | 'rgb' | 'hsv' | 'hsl' | 'oklab';
interface CompiledColor {
  space: CompiledColorSpace;
  c0: number;
  c1: number;
  c2: number;
  alpha: number | undefined;
}
```

The five keys are always created in that order, so every color shares one
hidden class and a channel read stays monomorphic. `alpha` is present and
`undefined` when the color carries no alpha; it is never omitted. An alpha that
is absent, non-finite, or within `1e-9` of 1 is `undefined`, on the compiled
route and on the interpreter fallback alike.

The channel meaning follows the space. `oklch` holds `L`, `C` and `H` in
degrees; `rgb` holds `r`, `g` and `b` as 0-1 sRGB; `hsv` and `hsl` hold a hue in
degrees and two 0-1 components; `oklab` holds `L`, `a` and `b`.

OKLCh is the preferred internal space. Every color constructor (`Rgb`, `Hsv`,
`Hsl`, `Oklab`, `Oklch`) and every operator that produces a color (`Color`,
`Colormap`, `ColorMix`, `ContrastingColor`) answers a color in it.
`ContrastingColor` normalizes the candidate it chooses, so its value is
canonical whatever space the candidate was written in. An EXPLICIT conversion
answers a color tagged with the space it names: `AsRgb` answers `rgb`,
`AsHsv` answers `hsv`, `AsOklab` answers `oklab`.

`ColorFromColorspace(components, space)` is the other head that answers a
named space. It BUILDS a color from channel values in the space it names, and
it keeps them there: the value carries those channels and is tagged with that
space, so `ColorFromColorspace((0.5, 0.1, 20), "rgb")` is
`{space: 'rgb', c0: 0.5, c1: 0.1, c2: 20, alpha: undefined}`. That is the
color the interpreter answers — the color HEAD of the named space,
`Rgb(0.5, 0.1, 20)` here — so a caller that reads `space`, or a channel, sees
the same color on both routes. Converting to OKLCh at the operator would have
shown different numbers from the interpreter for the same expression. The
operator is declared `-> color`, so its value has the color representation by
TYPE, like every other color-valued head.

`ColorToColorspace` is the opposite direction and is NOT one of these. It
answers COMPONENTS — it is declared `-> tuple`, the interpreter evaluates it
to a `Tuple`, and consumers index the result
(`At(ColorToColorspace(c, "rgb"), 1)`) — so its compiled value is the plain
array of three channels, four with an alpha. The two are inverses:
`ColorToColorspace(ColorFromColorspace(t, s), "rgb")` answers the 0-1 sRGB
components, which is how a caller reads channel values back out of a color.

A color value whose `space` is not one of the five spellings is not a color:
the readers switch on the space, so an object tagged `srgb` reaching a helper
through `vars` throws the same `TypeError` a bare numeric array gets, naming
the offending spelling.

Every helper that CONSUMES a color reads the tag through one internal
`toOklch`, so a conversion result reaching a second color operator is
understood rather than misread. `AsRgb(AsRgb(c))` therefore equals `AsRgb(c)`
channel for channel, and `ColorDelta(AsRgb(a), b)` measures the same distance
as `ColorDelta(a, b)`. Before the tag existed these nestings answered a
different color from the interpreter, and the compiler declined them
statically; the decline is gone.

A color STRING stays a JavaScript string until a helper parses it, and a LIST
of colors is a JavaScript array of color objects or color strings. So a bare
numeric array is NEVER a color on this target: it is a list. A color helper
handed one throws a `TypeError` naming the expected shape. The static gates
refuse a literal list at a color position, so that throw is a run-time
backstop for the shapes they cannot see: a `vars` input, and a caller still
passing the pre-2026-09 array representation.

A TUPLE at a color position is COMPONENTS, and how it is read depends on
whether the compiler can see it. A tuple written LITERALLY at the call site
denotes 0-1 sRGB on every route — the color operators are declared
`(color | string | tuple, …)` and the interpreter reads such a tuple — so it
is converted here with the same conversion `Rgb(r, g, b)` takes. A tuple that
arrives any OTHER way — a tuple-typed variable, or a head that answers
components such as `ColorToColorspace` — is read at a head that TAKES
components and DECLINED at a head that consumes a color.

The heads that take components are the five `As*` conversions and
`ColorToColorspace`; they are how a caller turns components into a color, so a
tuple at their operand is legitimate input whichever way it arrives, and it is
read as 0-1 sRGB components at run time. On JavaScript the reader is
`_SYS.colorFromSrgbComponents`, which builds the color of a 3- or 4-element
numeric array — the 4th component is alpha — and throws the color-shape
`TypeError` for any other shape. On a shader the operand's compiled value is
the `vec3` of its channels and `_gpu_srgb_to_oklch` makes the canonical color
of it; a tuple whose type says it is 4 wide is declined there, because a
shader color carries no alpha. On both targets a width the type states as
anything but 3 (or 4 on JavaScript) is declined at compile time. sRGB is the
reading even where `colorSpaceOf` names another space for the channels,
because the interpreter reads every tuple at a color position as 0-1 sRGB:
`AsRgb(ColorToColorspace(c, "hsv"))` answers the hue, saturation and value
read as red, green and blue on every route. A caller who means the channels in
the space they were computed in writes `ColorFromColorspace(components,
space)`, whose own first operand is components and is unaffected by any of
this.

Every OTHER color head — `ColorMix`, `ColorDelta`, `ColorContrast`,
`ContrastingColor`, `ColorToString` — consumes a color and declines such an
operand. Its value is a bare array, which this target reads as a list and
never as a color, so passing it through emitted code that threw the
color-shape `TypeError` on every run — a compile-time-provable failure behind
`success: true`. On the shader targets the same vector was read as canonical
OKLCh, which answers a color the interpreter, which refuses such an operand,
never agrees with. Declining hands the expression back to the interpreter; the
diagnostic names `AsRgb((r, g, b))` and `ColorFromColorspace(components,
space)`, the two spellings that build a color from components.

Both routes read the channels of a color by one rule, `readColorChannels` in
`src/compute-engine/numerics/color-conversion.ts`:

- `Rgb` channels are extended sRGB. A finite channel outside `[0, 1]` is a color
  outside the sRGB gamut (a Display P3 screen can show it), and it is kept on
  every route: no clamp, and no gamut mapping in the conversions among `Rgb`,
  `Oklab` and `Oklch`, in `ColorMix`, or in `ColorToColorspace`. Gamut mapping
  is the job of the renderer. The sRGB transfer function is sign-extended
  (`sign(c)·f(|c|)`, as CSS Color 4 does for extended sRGB), so a negative
  channel converts to OKLab and back.
- `Hsv`/`Hsl` describe only the sRGB gamut. Their saturation, value and
  lightness are clamped into `[0, 1]`, an infinite one included (`+∞` reads as 1
  and `−∞` as 0), and the hue is reduced modulo 360. A conversion of an extended
  `Rgb` color to `Hsv`/`Hsl` first clips each channel into `[0, 1]`.
- A color with a `NaN` channel, or with an infinite channel that is not clamped
  (an sRGB channel, a hue, an OKLab/OKLCh channel), is `incompatible-type` on
  the interpreter. On the JavaScript target it is the same object with `NaN`
  channels, in the space the answering helper names: the numeric projection of
  that error.

The shader helpers apply the same rule. They do not clamp an sRGB channel (the
canvas clamps at output), they clamp the HSV/HSL channels, and an infinite sRGB
or OKLab channel makes `NaN` channels through the arithmetic of the conversion.

A color-VALUED expression is NOT constant-folded on this target. The
interpreter's value for a color is a typed head, whose literal emission is a
bare numeric array — a list on this target, never a color — so the color
lowering runs instead and builds the object. The test is the expression's TYPE
alone, so every color-valued expression is covered whatever head built it, and
an expression that answers components rather than a color folds like any other
tuple: `ColorToColorspace(c, s)` with `s` a symbol bound to a string folds to
the interpreter's tuple, which is the same 3-array its lowering emits.

The interpreter FALLBACK answers the same object, and CONSUMES one. A declining
color expression run under `fallback: true` comes back as
`{space, c0, c1, c2, alpha}` read off the interpreter's typed color head
(`Rgb(...)` → `rgb`, `Hsv(...)` → `hsv`, and so on), and a list of colors comes
back as an array of those objects. In the other direction, a color object a
compiled runner produced is boxed back to the head that names its space when it
is passed in as a `vars` value, recursively inside arrays, so a color can cross
from a compiled runner into a declining expression.

On the SHADER targets (GLSL, WGSL) a color is a bare `vec3` with no run-time
tag and no alpha, read as OKLCh unless the compiler knows otherwise. The space
is a COMPILE-TIME fact instead (`colorSpaceOf`,
`compilation/color-space-fact.ts`): the constructors and the color-producing
operators answer `oklch`, each `As*` answers the space it names, and
`ColorToColorspace(c, "<literal>")` and `ColorFromColorspace(comps,
"<literal>")` answer that literal space. A color operand whose fact is a named
space other than `oklch` is converted back to OKLCh statically, with the
`_gpu_srgb_to_oklch`, `_gpu_oklab_to_oklch`, `_gpu_hsl_to_rgb` and
`_gpu_hsv_to_rgb` helpers the preamble already carries, so no nesting has to be
declined for want of a reverse conversion.

`ColorFromColorspace` therefore emits the channels themselves, and the
conversion to OKLCh appears at its CONSUMER, the same place an `AsHsv`
operand's conversion appears. A shader whose whole expression is a
`ColorFromColorspace` gets that named space as its result; `AsOklch(...)` is
how a caller asks for the canonical one.

The fact follows a value through the shapes that FORWARD one: a block's last
statement, a return-type ascription (`Typed`, the normalized spelling of a
function literal's return type), the body of a user function the engine holds,
and the arms of a selection. `Which` and `If` answer the space their value arms
agree on.

An operand whose fact is UNKNOWN — a symbol, a `vars` input, or a user function
whose body is not visible — is read as OKLCh, which is the shader's `vec3`
color contract. Where the compiler can SEE a converted color at one of the
positions the value comes from but cannot say which position it comes from —
`Which(cond, AsRgb(x), AsHsv(y))`, whose arms name two different spaces — the
operand is DECLINED instead, because reading it as OKLCh would answer a
different color for at least one of its run-time values. A plain unknown keeps
the OKLCh reading; only a visible disagreement declines.

The space is deliberately NOT a type. There is no `color<space>` in the type
lattice: on the JavaScript target the value carries the space, on the shader
targets the compiler proves it, and the interpreter already carries it in the
color's head.

## Sums and objects

A sum with representation-disjoint variants erases tags. A sum whose variants
overlap uses tagged JavaScript objects. Other targets decline unless they gain
an equivalent representation. Mutable boxed objects do not cross into compiled
code unless a target explicitly implements identity, slots, versioning, and
effects.

## Value kinds

A value of a value kind (a residue class, an element of a finite field, a
kind declared by a host with the `arithmetic` field of an operator
definition; `TYPE-SYSTEM.md`, "Value kinds and kind types") is not a number,
and the number lowerings compute a wrong value for it with no error: `c - c`
lowered to `0`, `c / c` to `1`. So the compile boundary declines it unless
the kind type gives a lowering for the target.

The boundary uses the STRICT recognition: an expression that holds a kind
value for certain, or whose result type is a kind type for certain,
declines, with a message that names the kind type ("holds a residue class
(type 'residue')", "holds a value of the kind type 'gf8'"). An expression
that only MAY hold a kind value (a parameter typed `number | residue`, a
symbol of a signature that admits a kind) compiles as a number, as before.

The library kinds `measurement` and `quantity` have no `compile` contract,
and the library kind `enclosure` has one for the `interval-js` target only
(see "The enclosure on `interval-js`" below). So an expression with a
`Measurement` or a `Quantity` value, or with an `Enclosure` value on any
other target, declines with
the kind message ("holds a value of the kind type 'measurement'"). A
physical constant symbol (`SpeedOfLight`) is declared `value`, so the strict
recognition does not see its quantity: `x · SpeedOfLight` declines at the
`Quantity` call of its value, with the message "Could not compile
`Quantity`".

**The compile contract.** The `compile` field of an `ArithmeticDefinition`
(`ArithmeticCompile`, `types-definitions.ts`; read by
`compilation/kind-lowering.ts` and `base-compiler.ts`) has two parts:

- `compile.type` belongs to the kind TYPE, because a free symbol of the
  type has no head, and every head of the type must lower `Add`, `Multiply`
  and the other operators to one representation. Its fields: `lowered()`,
  the name of the representation on the target, which
  `freeSymbolTypes[…].lowered` reports; `add()` and `multiply()`, a sum and
  a product with an operand of the kind (a number operand beside a kind
  value is the hook's to promote); `apply()`, the other arithmetic
  operators, the comparisons and the other operators with an operand of the
  kind; `entry()`, the run-time check of a host value given for a symbol of
  the type (the JavaScript runner calls it in place of its numeric and
  collection checks); `shippable` and `hostNames`.
- `compile.value` belongs to the HEAD: the source of a literal value of that
  head in the type's representation. A literal of a head without it
  declines.

Each hook receives the `OperatorCompileContext` and branches on
`context.language`, so a target registered with
`ce.registerCompilationTarget()` is reachable. `undefined` from any hook
declines, with the message "Could not compile `<Operator>` with an operand
of the kind type '<type>'". The structural and control-flow operators (`If`,
`Block`, `List`, `Tuple`, `Assign`, `Hold`, a call of a user function) do
not call the contract: they pass the representation through as an opaque
value. With two kinds that have a contract among the operands, the kinds are
asked in the order of their first occurrence and the first answer wins, as
at evaluation.

**The representation.** The value of `run()` for a kind result is returned
as the code makes it: `normalizeRunResult()`, which reads a `{ re, im: 0 }`
record as a number, is not applied. So on the JavaScript targets a kind type
may not name, with `lowered()`, a value convention of the runner (`number`,
`real`, `integer`, `complex`, `array`, `list`, `point`, `color`): the host
would read the value as a number, a complex number or a list. Such a
contract is refused with a message that asks for a representation of its
own (an object with a field that names the kind). The representation must be
faithful (the rule of "Fail closed").

**The result.** `CompilationResult.valueKinds` lists the kind types whose
representation the code reads or makes, and `StoredEntryPlan.kinds` the
bindings of a kind type (both JavaScript only, absent when no kind is
involved). A result is `shippable` only when every contract involved says
`shippable: true`, lists no `hostNames`, and no input of the code is a kind
value: a worker cannot run the host's `entry` check, and it cannot carry
the helpers that `hostNames` would name. Such code cannot be stored and
loaded again (see "Running stored JavaScript").

**Limits.**

- An expression that holds a COLLECTION of kind values (`L + L` with
  `L: list<gf8>`, a list literal of kind values) declines on every target:
  `entry` and `lowered()` describe one value.
- On `interval-js`, the only kind with a contract is the enclosure; the
  runner checks the inputs of that kind (below). A residue class, a
  measurement and a quantity decline on every target.
- A kind is never compiled through the number rules.

The design is `docs/plans/2026-10-26-value-kinds.md`, section 4.8.

### The enclosure on `interval-js`

`Enclosure(lo, hi)`, an interval that holds one real (`TYPE-SYSTEM.md`,
"Enclosures"), is the one library kind with a compile contract
(`ENCLOSURE_COMPILE`, `library/enclosure-compile.ts`). The contract answers
for the target `interval-js` only; every other target declines with the
kind message. The design is section 4.9.2 of
`docs/plans/2026-10-26-value-kinds.md`, "Compilation".

**The representation.** An enclosure is the `{ lo, hi }` interval of the
`_IA` runtime, and `lowered()` answers `'interval'`
(`freeSymbolTypes.x` is `{ type: 'enclosure', lowered: 'interval',
provenance: 'declared' }`). A literal `Enclosure(a, b)` with endpoints that
are number literals or exact constants lowers to a record whose endpoints
are converted to doubles OUTWARD (`lo` down, `hi` up), the conversion of
the interpreter under `.N()`; when the canonical order of the endpoints was
not decided (`Enclosure(Sin(10^600), 0)`) the record is
`{ lo: min, hi: max }` of the converted endpoints, never reversed. A number
operand beside an enclosure is a point: `_IA.point(c)` when `c` is a
double, else the record of its outward conversion (`0.1` is
`{ lo: 0.09999999999999999, hi: 0.1 }`). A complex literal and an endpoint
with a free variable decline.

**One kernel for each form.** The hooks emit, operation by operation, the
`_IA` call that the `.N()` route of the interpreter makes for the same form
(`enclosure-arithmetic.ts`), so the compiled code and `.N()` give the same
doubles: `add`/`mul` folds, `div`, `sub`, `negate`; for a power, one kernel
for each exponent form (`square` for `2`, `sqrt` for `1/2`, `pow` for
another integer, `powRational` for a rational with an odd denominator,
`powRealBranch` or `pow` for a float exponent by the target's selection
rule, `exp` for the base `e`, `powInterval` for an exponent that is not a
point, only when the base is provably positive); a negative integer power
as `1 / x^|n|`; the step of `Round`/`Floor`/`Ceil`/`Truncate` through
`intervalRoundToStep()`; `Log(x)` with `log10`, `Log(x, 2)` with `log2`,
another base with `div(ln x, ln b)`; `mod`, `hypot`, `atan2`; the unary
functions of the `apply` table through `ENCLOSURE_UNARY_KERNELS`. Three
run-time helpers of `IntervalArithmetic` (`interval/util.ts`) connect the
library's results to the interpreter's rules:

- `_IA.enclose(r)` wraps every ARITHMETIC result. It removes the metadata
  (`partial`, and `singular` with a value, give the value; `singular` with
  no value and `entire` give the whole line), because the interpreter's
  enclosure has no such marker: `Sqrt(x) < 3` run with `x: [-1, 4]` is
  `'true'`, as the interpreter's `Enclosure(0, 2) < 3` is. It answers
  `empty` (the indeterminate value) for `empty`, for a `NaN` endpoint and
  for an infinite singleton (`[+∞, +∞]` holds no real).
- `_IA.stripEnclosure(r)` is the metadata part only. The comparisons read
  their operands through it, and the extrema (`Max`, `Min`, `Clamp`,
  `ElementMax`, `ElementMin`, through `_IA.max`, `_IA.min`, `_IA.clamp`)
  wrap their result in it. It keeps an infinite singleton (`x < y` run with
  `y: Infinity` is `'true'`, and `Max(x, y)` is `[+∞, +∞]`) and the
  absence marker (`empty` with `missing: true`).
- `_IA.finiteOperand(v)` takes each operand of an arithmetic operation
  BEFORE the kernel, and answers `empty` for an infinite singleton: the
  kernels would answer `[0, +∞]` for `[0, 1] · [+∞, +∞]` and `[0, 0]` for
  `[1, 2] / [+∞, +∞]`, where the interpreter answers the indeterminate
  value. So `x + y`, `x · y` and `x / y` run with `y: Infinity` give `empty`.

**A possible enclosure.** On this target only, an operand whose type has
an `enclosure` arm (`real | enclosure`, the value of `If(t > 0, x, 0)` with
`x: enclosure`) is dispatched to the hooks as a certain one, and a free
symbol with such a type sets up the kind lowering and its entry check. A
number is a point interval on this target, so the code of a hook is valid
for it. So `Factorial(y)` with `y: real | enclosure` declines, as the
interpreter leaves `Factorial` of an enclosure unevaluated.

**The entry check of the interval runner.** For each free symbol whose type
has an `enclosure` arm (`intervalKindEntries()`,
`interval-javascript-target.ts`), `run()` checks the host value BEFORE it
converts the inputs, and OUTSIDE the `try` whose `catch` answers `entire`,
so a refused value throws. The kind's `entry` admits a record `{ lo, hi }`
of two numbers with `lo <= hi`, `±Infinity` allowed but not the same
infinity twice, no `NaN`; or a finite number. A UNION input is checked by
arm: a record by the kind's `entry`, a number by the numeric arms
(`NaN` admitted when an arm admits `nan` or `missing`, `±Infinity` when an
arm admits an infinity), so `y: number | enclosure` admits `Infinity` and
`y: enclosure | nan` admits `NaN`. `broadcast()` and `broadcastAsync()`,
which call the compiled body without the `run()` wrapper, check every cell
BEFORE the loop (outside the per-cell `try`): a cell whose two bounds are
the same value is read as that number when the type has a numeric arm, any
other cell by the kind's `entry`. One refused cell throws, or rejects the
promise, for the whole call. Every other input keeps the pass-through of
the runner, including the `NaN` that marks the absent value of a
`real | missing` input.

**No interpreter fallback.** A decline of an expression with an input
whose type has an `enclosure` arm, or whose result type has one, THROWS on
`interval-js`, also with `compile(…, { fallback: true })`. The fallback of
this target collapses each `{ lo, hi }` input to its midpoint
(`collapseIntervalInput()`), which would give a number to a symbol typed
`enclosure`, and reads a scalar result through `.N().re`, which is `NaN`
for an enclosure. `Measurement`, `Quantity` and the `javascript` target keep
the fallback.

**The declines.** A hook answers `undefined`, and the compilation declines
with the kind message, exactly where the interpreter leaves the call
unevaluated: an operator that is not in the `apply` table (`Factorial`),
`Gamma(s, x)` with two operands, `Log` with an enclosure base, `Round`
with an enclosure step, `Mod` with a divisor that is not a point, a power
with a base that is not provably positive and an exponent that is not a
point (`(-2)^Enclosure(1, 2)`), and an integer exponent that is not a safe
integer. `Mean`, `Sum` and `Product` decline too: the library has no kernel
for them, and their list forms decline by the collection limit.

**Accepted differences between the interpreter and the compiled code.**

1. **The identity shortcut of the six comparisons.** The interpreter
   decides a comparison of two identical operands before any hook:
   `c = c` and `c <= c` are `True`, `c < c` and `c != c` are `False`. The
   compiled code has no identity information, so `_IA.equal(c, c)` and
   `_IA.lessEqual(c, c)` are `'maybe'` for an enclosure that is not a
   point.
2. **No engine tolerance.** The interpreter compares two float points
   within the engine tolerance; the compiled comparisons compare doubles
   exactly, as the `javascript` target does for numbers. Elsewhere the
   compiled answer is the target's three-valued one: `'maybe'` where the
   interpreter stays unevaluated, `'true'` for the touching `LessEqual`
   that the interpreter answers `True` too.
3. **An angular mode other than radians.** The target scales an angle by
   the exact factor (`rewriteAngularUnit(expr, { exactFactors: true })`),
   enclosed outward, so the result contains the true value. The `.N()` route
   computes the exact product and converts it once. The endpoints of the
   two routes may differ by the rounding of the factor.
4. **A non-integer point exponent with a negative base at run time.** An
   exponent that is a free symbol of a number type (`x^n` with
   `n: integer`) lowers to `_IA.powInterval`, whose run-time point shortcut
   covers an integer and, for a negative point base, answers the symmetric
   hull over an exponent interval. At a non-integer point exponent with a
   negative base (`n: 0.5`, `x: [-8, -8]`) it answers `empty`, where the
   interpreter, which sees the value, uses the real branch.

**The limits kept from phase 1.**

- Code with an enclosure input cannot be loaded again from its stored form:
  the loaders of `createIntervalRuntime()` (`load()`, `loadBroadcast()`,
  `loadBroadcastSlice()`) refuse code that names a kind type, because the
  `entry` check is a function of the host. `shippable` is `false`
  (`ENCLOSURE_COMPILE` says so), so the kernel pool is not used and
  `willUsePool()` answers `false`.
- An input typed `list<enclosure>` declines (`entry` and `lowered()`
  describe one value).

Lifting these two limits needs a serializable entry check (ROADMAP
CE-507.12).

## CSE and naming

Common-subexpression elimination is region-based and must respect effects,
bindings, evaluation order, and target representation. Compiler-internal types
stay structurally opaque where importing boxed-expression types would create a
module cycle. The remaining CSE design work is in the active
`plans/2026-07-28-compile-cse-design.md`.

A target can set its own admission thresholds for a shared subexpression
(`CompileTarget.cseMinSize` and `cseMinScore`; the defaults are 4 and 8 in
`cse.ts`). The nested harvests of user-function bodies use the same
thresholds. The `interval-js` target sets 2 and 4, so a node of size 2 or 3 is
bound once it occurs three times: every interval operation is an allocating
`_IA` call, so the size of its syntax does not measure its cost.

## Compiler internals

A lowering that rewrites one statement into several statements must be added
to each of the four places that compile a list of statements, because none of
them goes through another:

1. `BaseCompiler.compileBlock` (`base-compiler.ts`) compiles a `Block` that is
   compiled as an expression.
2. `BaseCompiler.compileLoopBody` compiles the loop bodies of the JavaScript
   and interval targets.
3. `compilePythonStatements` (`python-target.ts`) is the Python dispatcher for
   statements.
4. `BaseCompiler.compileStatementList` compiles the loop bodies of the shader
   targets, which reach statements through the ordinary `compile` route. It
   calls `compileBlock` with the value of the last statement unused, so the
   last statement is not emitted as a `return`.

On a target with a `declare` hook (Python and the shader targets), the
`Declare` case emits only the declaration, and `compileBlock` emits the initial
value as a separate assignment. A rewrite that emits `Declare(sym, type,
value)` from one of the other places therefore loses the value on those
targets. Emit `Declare(sym, type)` and `Assign(sym, value)` as two statements.
A temporary from `BaseCompiler.tempVar` must also be registered as a local of
the statement list (`BaseCompiler.loopBodyTempTarget` does this), or it is
emitted as a read of the caller's scope object (`_.name`).

Check such a lowering on `javascript`, `python`, `glsl` and `wgsl` by reading
`.code`: a comparison of `run()` with the interpreter checks the JavaScript
target only.
