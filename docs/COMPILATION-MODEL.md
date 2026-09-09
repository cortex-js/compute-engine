# Compilation Model

**Status:** normative internal reference for implemented compilation behavior.

## Fail closed

Compilation is an optional acceleration route. A target emits code only when
it can preserve the interpreter's value, effects, evaluation count, and error
contract. Unsupported heads, representations, guards, or numeric lanes decline
with a structured diagnostic. They never emit plausible but different code.

With fallback enabled, a decline returns an interpreted runner. With fallback
disabled, the decline is visible to the caller. Runtime exceptions from
successfully compiled user code are not silently reinterpreted.

One value carve-out is ruled (pole-encoding ruling, 2026-08-28): where the
interpreter answers the projective infinity `~oo` — a division pole, a Gamma
or Factorial pole, an embedded `~oo` constant — a float-only target answers
the IEEE `Infinity` instead of declining. The projection keeps the infinite
magnitude and drops the direction `~oo` never had; it is what the bare
division instruction already answers at a runtime pole, so folded and
runtime spellings of the same pole agree. `NaN` remains reserved for the
genuinely indeterminate (`0/0`, `0 · ∞`) and for NaN propagation under
Contract B's `propagate` policy.

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
cheaper encoding. Two divergences from the projection itself are
accepted and pinned: compiled `Heaviside(~oo)` answers `1` and compiled
`~oo > 0` answers `true`, where the interpreter leaves both symbolic
(both formerly threw at the boundary).

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
directions. On a binding whose declared type proves a JS array, a plain
`Array` passes as it is, and a numeric typed array (`Float64Array`,
`Int32Array`, …) gets a plain-array copy once, at entry. Any other value
passes untouched and the lowerings dispatch on its runtime shape, as before: a
scalar there is not an error, because a declared type is routinely wider than
the value a caller binds and several lowerings project on the runtime shape —
a `list`-typed summand of an element-wise big operator bound to a number gives
the scalar sum. A list-valued result always comes back as a fresh plain
`Array`, never as a typed array and never aliasing caller data. Typed arrays
are not used inside the artifact: a typed pipeline measured no faster than the
plain one on the witness that asked for it, so the container would add
per-helper result-kind rules for no gain. The measurements and the decision
are in
`docs/plans/2026-09-07-numeric-list-store-and-typed-array-boundary.md`.

## Complex modes

`strict` preserves real-lane assumptions and declines on an incompatible
complex boundary. `complex` compiles wide numeric bindings through complex
kernels. `auto` first attempts strict mode and retries once in complex mode on
a lane mismatch. The result records its effective mode, promotion, escalation,
and diagnostic.

Unknown-sign radical operations are the promotion trigger. Real-only kernels
guard and project only where the model explicitly permits it.

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
without it keeps the compile-time decline. The deprecated
`complexPromotion` option is a compatibility shim, not separate semantics. The
`realOnly` option, which projected a compiled unit's RESULT to a real number
(or `NaN`) after the kernel had run, is removed: a compiled value whose
imaginary part is exactly zero is already returned as a plain number, so a
consumer tests `typeof v === 'number'` per sample and maps a `{re, im}` at its
own value boundary.

The remaining quiet-machine performance measurement is tracked in
`plans/2026-08-16-compile-complex-mode.md`.

## User functions and dispatch

Single and multi-clause functions compile once per artifact. Multi-clause
dispatch uses the same specificity order as the interpreter. If any required
guard cannot be expressed, the entire function declines; compiling a subset of
clauses would change dispatch.

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

## Collections

Compiled broadcasting preserves the interpreter's strict lifted regime.
Compiled pairing preserves shortest-input semantics. `PointList`, elementwise
selection, Map lowering/fusion, exact-map proof, and collection callbacks must
retain evaluation-once and effect ordering.

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
`Array.isArray`. There are three forms of it, and which one a function gets
follows what the INTERPRETER does with a collection element at that callback:

- A function whose parameters are typed `unknown` — every signature the engine
  infers from a body, whatever the body computes — is applied ELEMENT-WISE by
  the interpreter: `Map(f, [[1, 2], [3, 4]])` over `f(x) := 2x` answers
  `[[2, 4], [6, 8]]`. It is handed out as a broadcasting wrapper (`_fn_f$b`)
  that dispatches through `_SYS.bcastFn`.
- A function whose parameters are typed as DEFINITE scalars — which in
  practice means a declared signature such as `(number) -> number` — is
  REFUSED by the interpreter at that position: the same map answers
  `Map(Error(ErrorCode("incompatible-type", …)), …)`, because a row is not a
  number. It is handed out as a guarding wrapper (`_fn_f$s`) that projects an
  array argument to NaN, which is how the compiled routes spell an error
  value. That guard is the run-time half only: when the source's element type
  is provably a collection, the error is already in the expression, which
  makes it invalid, so the compile declines and the interpreter reports the
  error. (Applying such a function DIRECTLY still broadcasts — `f([1, 2])` is
  `[2, 4]` — which is an asymmetry of the interpreter between an application
  and a callback position, and the compiled routes keep it.) One case divides
  the two routes: a source only SOME of whose elements are collections. The
  interpreter reads the element type of the whole source, finds a union that
  a scalar satisfies, and broadcasts each collection element, so
  `[[1, 2], 3]` answers `[[2, 4], 6]`; the guard tests one element at a time
  and answers `[NaN, 6]`. There is no static element type to decline on
  there, and a per-element test cannot reconstruct the type of the source.
- A function with a parameter that is not scalar at all keeps the bare
  reference, because the interpreter binds its arguments whole as well.

A MULTI-CLAUSE function is handed out through the same wrapper, chosen by the
same two rules read over the whole clause set: a clause that binds a
collection, a tuple or a nominal value whole keeps the bare dispatcher, and a
clause set whose every parameter is a definite scalar guards where the others
broadcast. Its wrapper takes a REST parameter, where a single-clause one takes
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
wrapper dispatches through `_SYS.bcast`, the OPERATOR broadcast, because an
empty operator position evaluates to `Nothing` — `Sin([])` — which a
real-valued target spells NaN, where applying a function literal to `[]` zips
zero elements into an empty list. A built-in that consumes its argument whole,
such as `Length` or `First`, is not broadcast by the interpreter either and
keeps the bare name. An INLINE function literal (`Map((x) ↦ 2x, xs)`) takes
the `_SYS.bcastFn` wrapper a named user function gets; having no name of its
own, the arrow is bound once — a `const` where a statement sink exists, an
immediately applied arrow otherwise — so the wrapper's two mentions of its
callee do not build a fresh closure per element. A literal with a
collection-typed parameter keeps the bare arrow.

Implicit Map compilation obeys the engine-wide `jit` gate. Exact-mode Map
compilation requires an explicit proof that native-number execution preserves
the requested exact result. Structural or ABI failures are cached at the
appropriate expression-instance boundary.

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
`Colormap`, `ColorMix`, `ContrastingColor`, `ColorFromColorspace`) answers a
color in it. `ContrastingColor` normalizes the candidate it chooses, so its
value is canonical whatever space the candidate was written in. An EXPLICIT
conversion answers a color tagged with the space it names: `AsRgb` answers
`rgb`, `AsHsv` answers `hsv`, `AsOklab` answers `oklab`.

`ColorToColorspace` is NOT one of these. It answers COMPONENTS — it is
declared `-> tuple`, the interpreter evaluates it to a `Tuple`, and consumers
index the result (`At(ColorToColorspace(c, "rgb"), 1)`) — so its compiled value
is the plain array of three channels, four with an alpha. To get a color from
components, pass them to `ColorFromColorspace`.

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
refuse a literal list at a color position, so that throw is a run-time backstop
for the shapes they cannot see: a `vars` input, a caller still passing the
pre-2026-09 array representation, and a COMPONENTS tuple whose width is not
visible at compile time — a tuple-typed variable, or `ColorToColorspace` —
which is passed through unconverted and reaches the helper as a bare array.

A color whose channels are not all finite is the same object with `NaN`
channels, in the space the answering helper names. It is the numeric projection
of the interpreter's `incompatible-type` rejection of an infinite or `NaN`
channel.

A color-VALUED expression is NOT constant-folded on this target. The
interpreter's value for a color is a typed head, whose literal emission is a
bare numeric array — a list on this target, never a color — so the color
lowering runs instead and builds the object. The test is the expression's TYPE,
so every color-valued expression is covered whatever head built it, and an
expression that answers components rather than a color folds like any other
tuple: `ColorToColorspace(c, s)` with `s` a symbol bound to a string folds to
the interpreter's tuple, which is the same 3-array its lowering emits.
`ColorFromColorspace` is the one head the type cannot speak for — it is
declared `-> tuple` while its lowering answers a color value — and it is
excluded by name.

The interpreter FALLBACK answers the same object, and CONSUMES one. A declining
color expression run under `fallback: true` comes back as
`{space, c0, c1, c2, alpha}` read off the interpreter's typed color head
(`Rgb(...)` → `rgb`, `Hsv(...)` → `hsv`, and so on), and a list of colors comes
back as an array of those objects. In the other direction, a color object a
compiled runner produced is boxed back to the head that names its space when it
is passed in as a `vars` value, recursively inside arrays, so a color can cross
from a compiled runner into a declining expression.

On the SHADER targets (GLSL, WGSL) a color is a bare `vec3` in OKLCh, end to
end, with no run-time tag and no alpha. The space is a COMPILE-TIME fact
instead (`colorSpaceOf`, `compilation/color-space-fact.ts`): the constructors
and the color-producing operators answer `oklch`, each `As*` answers the space
it names, and `ColorToColorspace(c, "<literal>")` answers that literal space. A
color operand whose fact is a named space other than `oklch` is converted back
to OKLCh statically, with the `_gpu_srgb_to_oklch`, `_gpu_oklab_to_oklch`,
`_gpu_hsl_to_rgb` and `_gpu_hsv_to_rgb` helpers the preamble already carries,
so no nesting has to be declined for want of a reverse conversion.

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

## CSE and naming

Common-subexpression elimination is region-based and must respect effects,
bindings, evaluation order, and target representation. Compiler-internal types
stay structurally opaque where importing boxed-expression types would create a
module cycle. The remaining CSE design work is in the active
`plans/2026-07-28-compile-cse-design.md`.
