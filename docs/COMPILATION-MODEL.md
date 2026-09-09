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

A parameter typed `unknown`, `any` or a collection is the exception and keeps
its dispatch: such a body may legitimately receive a list whole, the way
`k(L) := Sum(L)` does.

The runtime broadcast of a user-function call is handed the emitted function
itself (`_SYS.bcastFn(_fn_f, …)`). A closure is emitted only when an argument
needs the `{ re, im }` coercion inside it; otherwise the closure would be an
eta-expansion of the callee.

A function REFERENCED AS A VALUE — the callback of `Map`, `Filter`, `Reduce`,
a comparator, a `PointList` role — is a call site too, and it is
broadcast-aware for the same reason the others are. The consumer of a function
value hands the callee whatever element the source holds, and an element can
itself be a collection: a row of a matrix. So a function whose parameters are
all scalar is handed out as a broadcast-aware wrapper (`_fn_f$b`) instead of
the bare name — one closure per function, emitted next to the function itself,
which tests its arguments and applies `_SYS.bcastFn` only when one of them is
an array. That reproduces the interpreter, which applies such a function
element-wise to a collection argument. A function with a parameter that is not
scalar keeps the bare reference, because the interpreter binds its arguments
whole as well. Where a parameter also needs the `{ re, im }` coercion, the
broadcast wrapper takes the coercing shim as its callee, so an element reaches
the body coerced.

The other two things that can stand in a callback position take the same
wrapper. A bare BUILT-IN operator name (`Map(Sin, xs)`) is eta-expanded into a
scalar kernel, so an element-wise operator is handed out as `_fn_Sin$b`; its
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
