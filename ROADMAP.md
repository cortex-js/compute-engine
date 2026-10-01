# Compute Engine — Roadmap

**Last updated:** 2026-09-30.

This document tracks **remaining** work; an item leaves this file once it lands.
Detail on completed work lives in git history, `CHANGELOG.md`, the linked source
files, and `docs/rubi/RUBI.md` / `docs/fungrim/`.

That rule had drifted, and was applied again on 2026-08-20 in two passes: 44
whole entries whose HEADING said FIXED, RESOLVED, REFUTED or DELETED, and then
22 individual bullets struck through as done inside entries that are otherwise
open. Everything removed is recoverable from git history, and each landed change
is described in `CHANGELOG.md`.

Two conventions follow from that, both worth keeping:

- An entry whose heading says it is done belongs in neither this file nor a
  follow-up entry. If part of it is still open, the open part gets its OWN entry
  stating what remains — the way the cross-term CSE note below does.
- Inside a still-open entry, strike through a bullet (`~~…~~`) when it lands,
  and delete it at the next pass. Keep a landed bullet only while a sibling OPEN
  bullet needs it to make sense; say so in the surviving bullet rather than
  relying on the reader to look upward, since the landed one will go.

## Current state

The 2026-06 release shipped:

- the Fungrim-derived identities library
  (`@cortex-js/compute-engine/identities`, 1,450 rules incl. 10 solve
  templates), the complex-domain assumptions extension, the operator-indexed
  rule dispatcher with purpose tags, `ce.solveRules`/`ce.harmonizationRules`,
  and exact `Zeta`;
- the Rubi rule driver as an opt-in entry point
  (`@cortex-js/compute-engine/integration-rules`, `loadIntegrationRules(ce)`),
  consulted by `Integrate` before the built-in antiderivative;
- a large symbolic-capability expansion — symbolic/improper integration,
  symbolic limits, expanded `Solve`, polynomial `Factor`/`GCD`/`Resultant`,
  multivariate GCD (Brown) — surfaced by the cross-library benchmark (items
  B1–B13);
- a substantial bignum/numeric performance pass (item 17): base-2 internal
  kernels, AGM `ln`, faster `sqrt`/`Gamma`, on-demand π and γ.

**MathNet parser hardening (2026-07-04):** all four tiers of the campaign
summarized in `docs/mathnet/README.md` landed and are test-locked
(`ContinuationPlaceholder` crash, ellipsis/trailing-punctuation recovery,
Unicode relation tokens, congruence/divisibility, geometry heads; corpus
clean-parse 3/345 → 278/345, throws 9 → 0). Fresh unseen-sample validation
measured 97.4% clean parse with 0 throws/0 hangs; the remaining MathNet work is
a small notation tail tracked below.

**0.141.0 released 2026-09-29** (latest; adopted by Tycho the same day). The
0.111–0.141 line is described release by release in `CHANGELOG.md`. The
0.97–0.110 line carried the Tycho-compatibility rounds through items 177–190
(the canonicalization-time facet-probe storm and its document-context survivor,
the `Add` collection-view nesting fix, `broadcastable` divide admission, opt-in
`complexPromotion`), compile-time constant folding on a deterministic cost
estimate, named-argument calls, protocols with compiled dispatch, mutable
objects phases 0–1, the `unknown`-as-placeholder ruling, the default-`!scope`
ceiling, and the Epsil parameter-shadowing repair. **0.96.0** (2026-07-26)
carried the **symbol-identity repair** — a stored value's free symbols now
denote the binding they were canonicalized against, not whatever an inner scope
calls that name, with dereference (`evaluateInOwnBindings`), named-parameter
rebind, and the sanctioned **binder mechanism** (binding sites declared by a
`scoped:` selector; see `docs/SCOPING-MODEL.md`) — plus all-branch union
assignability, the peaked-quadrature and non-finite-integrand fixes, and
deletion of the 0.95.0 random-family tombstones. The 0.91–0.95 line carried
`FindFit`/`FindRoot` (Tycho item 77), the `Nothing`-erasure/`Missing` marker
work, overload sets, the **Random family redesign** (`WithRandomSeed` frames,
PCG3D, domain-only `Random` — see `docs/RANDOMNESS-MODEL.md`), and Epsil
spread/destructuring. The 0.87–0.90 line carried the Tycho items 56–76 rounds
(complex-compile emission, the timeout-span model replacing `ce.timeLimit`,
compiled recursive lambdas, `RandomList`, `Abs(point)` = norm), the tensor
unification (BoxedTensor removed; tensor values are canonical Lists with a lazy
view), and honest shaped list types. The 0.74–0.86 line carried the
Tycho-compatibility rounds (through items 50–54: hybrid-lazy `PointList`
transposes, the serialize→re-parse juxtaposition fixes, machine-precision
exact-sum crash, `ce.withTimeLimit`), the collection-operator-gaps + laziness
waves, the `broadcastable<T>` typing lift, conditional values (`When`/`Which`),
typed function literals, Mathematica-style surface forms, `NDSolve` adaptive
stepping + `NDSolveFunction`, the DSolve frontier round (SymPy parity on the ODE
audit), and the disposition of the 2026-07 correctness/symbolic/performance
reviews — see `CHANGELOG.md`. Earlier milestones: **0.73.0** (2026-07-09;
solving parity 38/40 with SymPy/Mathematica, Rubi R13–R16, `Interpret`, number
theory) and the 0.7x `Measurement` MVP / control-flow-scoping / Desmos-lists
releases. Neyret-corpus parse coverage 92.9%; the remaining Desmos gaps are
importer-side (tracked in tycho's `COMPUTE_ENGINE.md`), not engine items.

**Epsil language shipped (2026-07-09):** the revived Epsil language (parser,
serializer, `executeEpsil` interpreter — phases 0–5 of the revival) is published
as an **experimental** entry point `@cortex-js/compute-engine/epsil`, joined to
the code-splitting ESM build so `executeEpsil(ce, …)` shares engine-class
identity with a host-created engine. Residual language, tooling, documentation,
and release-maintenance items are tracked in `docs/epsil/ROADMAP.md`, not here.

The June 2026 codebase review (REVIEW.md) is fully dispositioned. **Rubi
status:** R1–R30 + R8 landed — chapters 1/2/3/5/6/7, 4.1/4.3/4.5, §8.8
Polylogarithm, 6,574 rules bundled; see the **Coverage tracks → Rubi** section
below for current scores and next rungs (per-rung history in `docs/rubi/RUBI.md`
§5).

**Related documents:** `docs/fungrim/FUNGRIM.md` (feasibility + feature map),
`docs/fungrim/FUNGRIM-PLAN-1…5` (executed architecture plans), `data/fungrim/`
(translated corpus + manifest), `scripts/fungrim/` (translator tooling),
`docs/rubi/RUBI.md` (Rubi integration), `benchmarks/` (cross-library harness +
`REPORT.md`, `BIGNUM-COMPARISON.md`).

---

## Remaining work

### A library list with `core` but without `control-structures` breaks every function literal (OPEN, decision — found 2026-10-01 by the fix of the library load order for issue #393)

`Function` is defined in `core`, but building a function literal needs
`Block`, which `control-structures` defines. With
`libraries: ['core', 'arithmetic']`, every `Function` literal, and every
caller library with an `evaluate` formula, prints "Cannot read properties of
undefined (reading 'bindings')". `control-structures` already requires
`core`, so `core` cannot require it back without a cycle. The options: move
`Block` into `core`; load `control-structures` with `core` automatically; or
throw a clear error at construction when `control-structures` is missing.

### Redeclaring an arithmetic operator with an unchanged copy of its definition changes canonical forms and types (OPEN, decision — found 2026-10-01 by the analysis of issue #394)

`doc/06-guide-augmenting.md` ("Overloading Functions") documents how to
extend a library operator: redeclare it with a copy of its definition and
change one field. For eleven operators (`Add`, `Multiply`, `Negate`,
`Square`, `Sqrt`, `Exp`, `Ln`, `Log`, `Power`, `Root`, `Divide`) this
changes the result even when no field changes. The reason:
`makeNumericFunction` (`boxed-expression/box.ts`) canonicalizes these
operators by NAME, not through a `canonical` handler of their definition, and
since the decision of 2026-09-27 (`library-shadowing.ts`) any user
definition of one of these names sends the call to the generic boxing code.
`Add` is `lazy` with no `canonical` handler, so there its operands arrive
unbound. Measured after `ce.declare('Add', { ...oldAdd })`: `Add(2, x, 5)`
gives `2 + x + 5` (stock: `x + 7`); `Add(1, "s")` is valid (stock: invalid);
`Add(1, ImaginaryUnit)` is typed `integer` (stock: `complex`). After the
same copy of `Sqrt`, `Sqrt(8)` stays `sqrt(8)` (stock: `2√2`). One fix:
move the per-name canonicalization into a `canonical` handler of each
definition, so a copy takes it along; `_update` then must accept `canonical`
together with the `associative`/`commutative` flags that `Add` and
`Multiply` set. The decision to make: whether a redeclared arithmetic
operator keeps the built-in canonical form (this fix), or the documentation
says that redeclaring these eleven names gives up that form.

### A named call through a `function`-typed variable keeps the parameter order of the value it held when the call was made canonical (OPEN, decision — found 2026-10-01 by the analysis of issue #390)

When the callee of a named call is a variable declared `function`, the names
are matched against the signature of the variable's CURRENT value when the
call is made canonical (`calleeSignatureType`,
`boxed-expression/box.ts`), and the call is stored with positional
arguments. A later assignment of a function with a different parameter order
gives a wrong result with no error. Example: `alias: function = bob_S`, then
`e = alias(3, factor: 5)` is stored as `alias(3, 5)`; after `alias` is
assigned `other(factor, x)` (which computes `factor - x`), `e` evaluates to
`-2`, while the names ask for `2`. The same callee also loses `lazy`: with
`y := 10` and a lazy `bob_H`, `aliasH(y·z)` gives `Hold(10·z)`, while
`bob_H(y·z)` gives `Hold(y·z)`. The decision to make: match the names again
when the call is evaluated, or reject names for a callee whose declared type
is only `function`.

### A compiled loop that assigns `xs = ReplaceAt(xs, i, v)` copies the whole list at each assignment (OPEN, small — issue #386, 2026-10-01)

A compiled `Fold` whose step only updates its accumulator now updates a copy
of the seed in place (`inPlaceUpdateChains`,
`compilation/in-place-update.ts`, used by the `Reduce` lowerings of the
JavaScript and Python targets). A loop that keeps the list in a local
variable and replaces it at each turn, `xs = ReplaceAt(xs, i, v)`, still
copies the list at each assignment: O(n) per turn, O(n²) for a loop that
visits each element once. The same analysis applies: the assignment can write
in place when the variable holds an array the loop created (copy it once
before the loop) and no other value can hold a reference to it (every other
use of `xs` is a read in `NON_RETAINING_READS`). Not requested yet; the
reporter of #386 mentions a cycle walk that may be written as a loop.

### The lenient grammar makes reading choices that a host cannot detect (OPEN, decision — Tycho paste converter, 2026-10-01)

Goal (Arno, 2026-10-01): a host that converts pasted plain text, such as
Tycho's `plainTextToLatex`, should not need its own parser; the lenient
grammar (`ce.parse(text, { strict: false })`) should give it what it needs.
Tycho's converter keeps a first stage (a closed list of tokens and an
adjacency table) because the lenient grammar reads almost any text and gives
no signal when it picks one of two common readings. Tycho will remove that
stage if CE publishes the list of reading choices the lenient grammar makes,
with a diagnostic code (one `ambiguous-*` group) for each choice that has
another common reading, and counts a choice with no code as a CE defect.
That commitment is the decision. Of 300 inputs that the converter refuses
(`tycho/scripts/repros/2026-10-01-paste-refused-inputs.json`), the lenient
grammar on CE main reads about 210 with no signal. The classes, with
examples: the end of an unbraced exponent (`e^2pi`, `x^2y`); an implicit
subscript (`x2`); a comma outside brackets (`1,5`); `5!=120`; a name, a
space and a number (`x 2`); a function name with no parentheses before
several factors (`sin x y`, `log 2 x` = `log_2 x`); a document function
with no parentheses (`f x`); list labels (`1. y = x`); equation numbers
(`y = x^2 (2)`); juxtaposed groups (`(a)(b)`); the extent of a radical
(`3√8`, `√2π`); `+-` and `±`; `<-`; `a..b..c`; `in` after an equation;
`Δx`; chains of `=`; bars that pair two ways; dates and phone numbers;
`atan3(y)`; Greek capitals that look like Latin letters. Readings that
may be defects rather than ambiguities: `(a)(b)` is the call `a(b)` in the
canonical form (strict too), `±1` is `Measurement(0, 1)`, `+-` is two
signs, `mod`/`pow`/`trunc`/`Re`/`Im` are not lenient function names.
The full reply is in Tycho's `docs/COMPUTE_ENGINE.md`, "CE reply 2026-10-01
to answer 4".

### A `Delimiter` with square brackets reads back as a `List` (OPEN, decision — found 2026-10-01 by the fix of the parentheses written twice in a fraction)

`["Delimiter", "x", "'[,]'"]` (a group written with square brackets, for
example `[a+b]c` in a physics formula built by a host) stays a `Delimiter` in
the canonical form, and the LaTeX writer writes it `\lbrack x\rbrack`. That
LaTeX parses as `["List", "x"]`, so a round trip through LaTeX changes the
value from `x` to a list of one element; `["Delimiter", ["Sequence", "a",
"b"], "'[,]'"]` comes back as `["List", "a", "b"]`. The parser has no reading
of square brackets as a group, so no LaTeX spelling round-trips today. The
decision: (a) the writer writes such a group with parentheses (the value
round-trips, the brackets are lost), or (b) the parser reads one spelling as a
bracket group (for example `\left[ … \right]` with one operand), which
changes what that spelling gives today. Writer: the `Delimiter` serializer in
`latex-syntax/dictionary/definitions-core.ts`.

### `list<integer^(2x0)>` reduces to `vector<integer^2>` (OPEN, decision — found 2026-09-29 by the review of the dimension-variables round)

`reduceListType` (`src/common/type/reduce.ts`) drops every zero-length axis and
reads an all-zero shape as `nothing`. So `list<integer^(2x0)>`, two empty rows,
reduces to `vector<integer^2>`, a list of two integers, and
`list<integer^(0x2)>`, no rows, reduces the same way. Measured 2026-09-29:
`2x0 → vector<integer^2>`, `0x2 → vector<integer^2>`, `0 → nothing`. The
question is what a zero axis should mean: keep the axis (`matrix<integer^(2x0)>`
stays as written, and a value of that shape is two empty lists), or read any
zero axis as the empty type. Recommendation: keep the axis, since a 2x0 matrix
is a value the engine can hold and its element count is 0 by multiplication;
dropping the axis changes the rank of the type. Until decided, the behavior is
unchanged from before the dimension-variables round, which only kept the
dimension-variable names aligned with the surviving axes.

### `MatrixPower` is typed `matrix`, with no element type or shape (OPEN, small — found 2026-10-01 by the fix that reads a nested spelling as its flat shape)

With `m` declared `matrix<integer^(2x2)>`, `Power(m, 2)` canonicalizes to
`MatrixPower(m, 2)`, typed `matrix` (`matrix<number>` of any shape), although
its value is a 2×2 matrix of integers (`[[7,10],[15,22]]` for
`[[1,2],[3,4]]`). The descriptor route of `Power`'s type handler, which does
not see the canonical rewrite, answers `matrix<2x2>`, so the two routes
disagree on a matrix base (`derive-broadcast-lift.test.ts` compares them on a
nested list that is not a matrix for that reason). A fix gives `MatrixPower`
a type handler that keeps the shape and the element type of a square
operand.

### A nested list spelling is not a subtype of a list type with no dimensions (OPEN, small — found 2026-10-01 by the fix that reads a nested spelling as its flat shape)

Since 2026-10-01 a list of dimensioned lists is read as the flat shape it
spells at a target with two or more dimensions: `list<vector<integer^3>^2>` is
a subtype of `matrix<integer^(2x3)>` and of `matrix<integer>`, and the
dimension solver pins `cols(nl)` to `3` (`flattenNestedListType`,
`common/type/instantiate.ts`). A target with no dimensions is left out:
`matrix<integer^(2x3)>` is a subtype of `list<integer>` (a list type with no
dimensions accepts any shape) and of `tensor<integer>`, which parses to the
same type, but `list<vector<integer^3>^2>` is not. Code that reads the element
type of a `list<integer>` operand expects scalars, and a nested type would give
it rows, so extending the conversion needs a check of those readers first.
Also not accepted: a nesting of three levels at a target whose elements are
still rows (`list<vector<vector<integer^2>^3>^4>` at
`list<vector<integer^2>^(4x3)>`), because every level is merged at once; a
fix would merge only as many levels as the target has dimensions.

### Registering a chain of `-> unknown` functions reads the declared signatures a number of times that grows faster than the depth (OPEN, low — narrowed 2026-10-01)

With `W_k` declared `(unknown) -> unknown` and each body calling `W_{k+1}`
twice, registering the chain reads the declared signatures (`_deriveSignature`)
850 times at depth 6, 5 666 at depth 12 and 20 962 at depth 20, about 70 ms at
depth 20 (measured 2026-10-01). The doubling per level is gone (89 794 reads at
depth 12 before): the effects inference walked a callee once per call, and now
skips a callee already walked into the same accumulator (`expandedLiterals`,
`effects-inference.ts`). What remains is polynomial: each assignment types its
body again, and each read of a signature whose cache generation has moved
reads the type of the function value before its memo key is built. A cache of
the derived signature stamped with the cache generation, checked before the
key is built, was tried and gave no measurable gain at these depths, so it was
not kept. Single-call chains are linear.

### A signature derivation that runs inside a cached type read does not see a widening made in its own temporary scope until the read finishes (OPEN, small — found 2026-09-29 by the review of the fix for Tycho item 336)

A value-type inference advances the `any` version only when no cached
computation is running (`runWhenIdle`), so that it does not retire the type
being computed. A derivation reached from a `_type` read runs inside one; a type
its body cached before a WIDENING of one of its own temporary symbols can then
be read once more, and the memoized result may be narrower than it should be. No
reachable witness was found. Closing it needs an immediate advance for a
widening inside the derivation's scope, which the deferred design avoids on
purpose.

### An ordering comparison pairs a set with a list (OPEN — found 2026-09-29 while pinning the relational types over abstract collections)

`Less(Set(5, 6), [1, 2])` evaluates to `[False, False]`, and
`Less(Set(0), [1, 2])` to `[True]` (typed `list<boolean^1>` where the static
type is `list<boolean^2>`): an unordered set is paired position by position with
a list. The comment of `broadcastLiftType`
(`boxed-expression/broadcast-lift-type.ts`) says a set beside a list gives an
error value, and `Sin` of a set is already an `incompatible-type` error. It
reaches a symbol declared `collection<number>` that holds a set (`P < [1, 2]`).
Where the pairing happens is not traced yet.

### A comparison with a list expands early over a valueless operand declared `number | collection<number>` (OPEN — found 2026-09-29, same probe)

With `P` declared `number | collection<number>` and no value, `P < [1, 2]`
evaluates to `[P < 1, P < 2]` and `P = [1, 2]` to `[P == 1, P == 2]`. The
expansion assumes `P` is a number. When `P` is later assigned `[5, 6, 7]` the
ORIGINAL expressions give a length error and `False`, the expanded forms give
lists of lists: the result depends on when `P` gets its value. With `P` declared
`collection<number>` the comparison stays unevaluated, as it should. The
probable cause is the pre-evaluation broadcast in
`boxed-expression/boxed-function.ts`, whose test for a valueless operand does
not see the union declaration.

### What `Join` of a dictionary and a list gives (OPEN, decision — found 2026-09-29 by the review fixes for the spread literal)

`Join(Dictionary(x: 1), [2, 3])` is a type error that names the first
element that is not a key-value entry:
`Error(incompatible-type, tuple<string, any>, 2)` (since 2026-09-30; before,
the error named the internal `ContinuationPlaceholder` symbol). `Append` of a
dictionary and a value that is not an entry gives the same error. The open
question is whether a dictionary joined with a list should instead give a list
of the entries followed by the elements. Until decided, the error stays.

### `Append` over an operand typed `any` is typed `list` (OPEN, small — found 2026-09-29, measured again 2026-09-30)

`Join` over an operand typed `unknown` or `any` is typed `collection`, because
the operand may hold a set. For `Append`, measured 2026-09-30: with `u`
declared `unknown`, `Append(u, 1)` is typed `collection<any>` (canonicalization
infers `u` as `collection<any>` from the signature), but with `a` declared
`any`, `Append(a, 1)` is typed `list`, and the structural nested form
`Append(Append(u, 1), 2)` is typed `list<integer>`, where the flattened
canonical form is `collection<any>`. `appendResultTypeD`
(`library/collections.ts`) types a source whose type says nothing as a list on
purpose, so that the nested and flattened forms in `append-variadic.test.ts`
agree; a fix must type both forms `collection` together.

### A list-building self-recursion assigned WITHOUT a declaration is still typed `collection` (OPEN, small — found 2026-09-29 by the fix for Tycho row 338)

With `F` declared `(unknown, unknown) -> unknown` and assigned
`(n, K) ↦ { n = K - 1: [n], otherwise: join([n], F(n + 1, K)) }`, the derivation
of the placeholder signature re-types the body under the hypothesis that the
result is a list and keeps it when the pass reproduces it (`_deriveSignature` in
`boxed-value-definition.ts` and `boxed-operator-definition.ts`), so `F` is
`-> list<number>`. The same literal assigned to an UNDECLARED name
(`ce.assign("G", literal)`) takes the inferred-signature route, where a call is
typed from the literal per call: `G` reports `(unknown, unknown) -> collection`
and `G(0, 5)` types `collection<integer>`. The hypothesis is not applied on that
route. Tycho declares every document function first, so it does not meet this.

### A mutually recursive pair that builds a list is typed `collection`, and a callee derived inside another function's derivation can keep `-> unknown` (OPEN, small — found 2026-09-29 by the fix for Tycho row 338)

The list hypothesis of `_deriveSignature` runs only for a body that names its
own function. With `F: (unknown, unknown) -> unknown` assigned
`(n, K) ↦ { n = K - 1: [n], otherwise: join([n], G(n + 1, K)) }` and `G`
assigned `(n, K) ↦ F(n, K)`, both derive `-> collection<number>` (pinned in
`recursive-function-result-type.test.ts`). A pair that is also self-recursive
(`F` names `F` and `G`) does not improve either: `G`'s signature is derived
while `F`'s is, reads the re-entrancy guard's `unknown` for `F`, and is memoized
as `-> unknown` (measured 2026-09-29: `F` is `-> collection<number>` and `G`
stays `-> unknown` on later reads), so the hypothesis pass reads `unknown` from
`G` and is refuted. A fix would treat the strongly connected component of the
call graph as one unit, or retire a callee's memo when the function it was
derived inside settles.

### Lazy collection operators over an eager source stay unevaluated (OPEN, decision — found 2026-09-30 by the fix for issue #383)

With `t: tuple<list<integer>, list<integer>>` assigned `([3, 1, 2], [4])`, the
read `At(t, 1)` is typed `list<integer>` and its value is the list, but it is an
eager operator with no collection handlers before it is evaluated. A lazy view
over it reads `isFiniteCollection` and `isEnumerableCollection` off the
unevaluated read, both `undefined`, and stays unevaluated: `ArgMax(At(t, 1))`,
`ArgMin`, `Dedup`, `Differences`, `FlatMap`, `Scan(At(t, 1), f)` and
`TakeWhile`/`DropWhile` under a plain `evaluate()`; `Numerator(At(t, 1))` and
`Denominator` report an `incompatible-type` error naming `vector<integer^3>`
where the literal list broadcasts.
`Reverse(At(t, 1)).evaluate({ materialization: true })` also returns the
unevaluated view: the materialization step (step 3 of `_computeValue`,
`boxed-function.ts`) runs before the operands are evaluated, and `materialize()`
returns the node itself when the walk cannot start; the `toLatex()` contract of
Tycho item 247 (a symbolic carrier prints without evaluation) depends on that
return. `Reduce` and the count of `Filter` resolve such a source with
`eagerViewSource` since 2026-09-30, as `Join`, `Reverse` and `Take` did before;
the operators above do not. A general fix would evaluate an eager source once
when the lazy node is evaluated, which is a change to the laziness contract
(`docs/COLLECTIONS-MODEL.md`) and needs a decision.

### An operator result that may be absent is typed `number` when it is numeric (OPEN, small — found 2026-09-30)

With `xs` declared `list<list<real>>`, `Length(At(xs, 1))` is typed `number`,
where its values are the integers, `+oo` and `NaN`. `At(xs, 1)` is typed
`list<real> | missing`, and `Length` propagates the absent operand. The type
of an absent operand in a numeric result is removed by
`absorbNumericAbsence` (`common/type/utils.ts`), which replaces every numeric
arm by `number` instead of adding `nan` to the arms the type handler
answered (`integer | +oo`). The type is wide but not wrong. The same rule
types `Sin(x)` as `number` for an `x` that may be absent. A fix would add
`nan` to the handler's arms, and changes the types of many expressions:
measure the snapshot changes before landing it.

### An absent argument at a function parameter: what the decisions of 2026-09-30 left open (OPEN — two defects)

The rule since 2026-09-30, for a function literal (an Epsil `function`, a lambda
with an annotated parameter): at evaluation, an absent value (`Missing`) at a
parameter annotated with a type that has no `missing` member is an
`incompatible-type` error, a parameter annotated with a numeric type reads it as
`NaN` (the absence marker of a numeric domain) and accepts `NaN`, and at a bare
parameter the body runs with the absent value; at boxing, the engine admits an
argument typed `missing | T` at a parameter annotated `T` and refuses one typed
`missing` alone at a parameter that is not numeric; the Epsil static pre-pass
reports the first too. Pinned by
`test/compute-engine/absent-argument-annotated-parameter.test.ts`. What is not
settled:

1. **A false report of the pre-pass on the gasket program (defect, not
   reduced).** With every parameter of `fill` annotated and the absent case
   removed (`let C = first(filter(…)) ?? (0, 0, 0)`), the program
   `tycho/scripts/repros/2026-09-28-epsil-gasket-compile/e-natural-recursion.epsil`
   runs, compiles and answers `(224, [4,6,18,54,86,28,8,8,4,4,4,0])`, and the
   pre-pass reports "expected `tuple<number, number, number>`, got
   `dictionary<any> | indexed_collection<any>` at `gap[3]`". In the pre-pass `C`
   is typed from its uses (`C[1]`), not from its initializer; boxed whole, it is
   typed `tuple<number, number, number>`. The report predates 2026-09-30. Twelve
   smaller programs built from the same helper functions did not reproduce it.
2. **A list of points at a BARE parameter of a function declared in the compiled
   program declines to compile (defect).** With
   `function h(q: tuple<number, number>) { q[1] + 1 }` and
   `const g = (p) => h(p)`, the type of `p` is inferred as one point, the
   interpreter binds a list of points whole to `p` and maps at the call of `h`,
   and answers `[2, 4]`. The body of `g` is compiled for one point, so the
   JavaScript target declines `g(xs)` (`tryCompileLocalFunctionCall`,
   `base-compiler.ts`); until 2026-09-30 it answered the string `"1,21"`. An
   ANNOTATED point parameter is mapped by the compiled code. Fix: compile the
   body of such a function for a parameter that may be a list.

The accessor side of the same decision (`First`, `Second`, `Third`, `Last`, `At`
with a literal index lose their absent member when the operand is proved to hold
the position) reads the length from a list type with a length, a list literal, a
string literal and a `Range` with literal bounds (`provenLengthD`,
`library/collections.ts`). Not proved, so the member stays: `First(Rest(xs))`
and `First(Take(xs, 2))` over a literal (the types of `Rest` and `Take` carry no
length), and a symbol declared `list<T>` that holds a list that is not empty. A
position proved NOT to exist (`At([7, 8, 9], 99)`) keeps `T | marker(T)`
although its value is always the marker: a chained read (`M[7][1]` over a
matrix) chooses `NaN` or `Missing` from the element type the inner access
states.

### Three lazy collections assigned to a variable are still a live view of the variables they read (OPEN, small — residue of the decision of 2026-09-30)

Since 2026-09-30 an assignment statement stores the elements of a FINITE lazy
collection that reads a variable, as a list when the value is an indexed
collection and as a set when it is typed as a set (`assignedValue`,
`library/core.ts`). Three cases are left lazy and keep their variables by name.
(1) A collection with no last element cannot be listed:
`let big = filter(1..oo, c => c > k)` still keeps `k`, and a later `k = 10`
changes `first(big)` from `4` to `11`. (2) A `Filter` over a dictionary is a
dictionary, and no operator lists a lazy dictionary as a dictionary. (3) A
`Filter` over a set held by a local whose type was inferred `collection<any>` is
not typed as a set, and is not indexed. A fix replaces each variable the
collection reads by its current value and keeps the collection lazy; the
replacement must reach inside the function literal (the `k` of the predicate)
without touching the literal's own parameters. The host function `ce.assign()`
stores the value it is given, on purpose: a host that defines one name from
another wants the live view.

### A parameter that reaches a whole-collection operator indirectly is still applied element by element (OPEN — recorded 2026-09-29 with the decision on whole-collection parameters)

The decision of 2026-09-29 binds a list whole only when the bare parameter is
the ONLY operand of `Mean`, `Median`, `Variance`, `StandardDeviation`, `Mode`,
`Quartiles`, `Flatten`, `SetFrom` or `TupleFrom`. Three shapes still differ from
the body with the list substituted: a use through another operator
(`function h(xs) { mean(xs^2) }` over `[1, 2, 3]` gives `[1, 4, 9]`, the
substitution gives `14/3`), a use through a local (`let ys = xs; mean(ys)`), and
`Max`/`Min`/`GCD`/`LCM`/`ListFrom` of the parameter. The first and the third are
held back by the compiled route: the compiled definition types an undeclared
parameter from its uses, so `xs^2` compiles to scalar code and an array argument
gives `NaN`. They can follow once the compiled definition types a lifted
parameter from its signature slot. (A parameter DECLARED `collection<any>` or
`collection<any> | number` already compiles under `Max`, `Min`, `Sum` and
`Product` since the fix for issue #385; the gap is the undeclared parameter.) `norm(v)` over a
list of numbers gives the list itself (the norm of each number), on both routes;
whether `Norm` of an untyped parameter should read a list of numbers as one
vector is part of the same question.

### The static type of a block local narrowed by a use depends on statement order (OPEN, small — found 2026-09-28 by the fixpoint re-read of assignment evidence)

The re-read of `let`/`Assign` value types (`library/assignment-evidence.ts`)
excludes locals with a declared type, and a local that a USE narrows after its
first recorded assignment type keeps the order-dependent result: a `mutate(v)`
call placed before or after the assignment gives a different static type. Making
the narrowing order-independent would treat use evidence and assignment evidence
as two sets joined at the end of the block rather than as writes in statement
order. Not a wrong value at runtime; a static-type imprecision.

### A closure created before a `let` of the same body, on a later loop iteration, captures the previous iteration's binding (OPEN, small — found 2026-09-28 by the fix for Tycho item 330)

In a loop body such as `for i in [1, 2] { fs = [...fs, () => k]; let k = i }`
the closure of the second iteration captures the `k` binding of the first
iteration, because the `let` that would re-create the binding has not run yet
when the closure is made. JavaScript reports a temporal-dead-zone error there.
Rare in practice (a closure over a local declared after it); left as is by the
2026-09-28 fix, which captures a nested block's locals at closure creation. A
fix would either refuse the read (an error like JavaScript's) or pre-create the
iteration's bindings when the body starts.

### Point arithmetic with a valued symbol: three type/value disagreements (OPEN, small — found 2026-09-29 by the fix that types a list of numbers plus a point `error`)

With `L := [0, 1, 2, 3]`, `P := (1, 1)`, `Q := [(1, 2), (3, 4)]` and `x := 5`:
(1) `L · P` is typed `tuple<integer, integer>` but evaluates to
`[(0, 0), (1, 1), (2, 2), (3, 3)]`; the list-times-point typing of `Multiply`
applies to a list literal (`[0, 1, 2, 3] · P` is
`list<tuple<integer, integer>^4>`) but not to a symbol that holds the list. (2)
`P / L` and `(1, 1) / [1, 2]` are typed `tuple<number, number>` but never
evaluate (they stay `(1, 1) / [0, 1, 2, 3]`); a point over a list of numbers
should give a list of points, or an error, not an inert form. (3) `Q + x` is
typed `list<tuple<integer, integer>^2>` but evaluates to a list of errors, and
`x + (1, 1)` is typed `integer | tuple<integer, integer>` but evaluates to one
error: a number-typed symbol beside a point. The check of 2026-09-29
(`addsPointToNumberCollection`, `collection-utils.ts`) reads operand TYPES only,
and a number symbol whose type was only inferred keeps such a sum symbolic under
`evaluate()`, so typing it `error` from the type alone would be wrong; a fix
needs the symbol's value.

### `PolyGamma`/`Digamma`/`Trigamma` have no GPU shader lowering (OPEN, capability gap — found 2026-09-28 widening `PolyGamma` to a complex `z` for #340)

Neither `gpu-target.ts` shader (GLSL or WGSL) declares a lowering for these
three heads at all, unlike every other special function in `arithmetic.ts`
(`Zeta`, `HurwitzZeta`, `Gamma`, `Erf`, …). This already fails closed — a
`PolyGamma`/`Digamma`/`Trigamma` call in a GPU-compiled expression declines to
the interpreter rather than emitting anything wrong — so it is not a correctness
bug, only a missing capability: a plot or shader that calls these compiles the
rest of the expression and evaluates this part off the GPU. Fix: port
`numerics/special-functions.ts`'s real `digamma`/`trigamma`/ `polygamma`
(recurrence + asymptotic series, the same shape already used for `_gpu_gamma`)
to GLSL/WGSL helpers and wire them into `GPU_FUNCTIONS`.

### `HurwitzZeta(s, a)` of an order that is not an integer stays symbolic far left of the imaginary axis (OPEN, capability gap — found 2026-09-28 reviewing #340, narrowed 2026-09-30)

`hurwitzEMComplex` (`numerics/numeric-complex.ts`) sums one direct term for
each unit of −Re(a) before its Euler-Maclaurin tail, so the kernel declines
when more than `HURWITZ_MAX_PASSED_TERMS` (2²⁰) terms lie between a and the
right half-plane: `HurwitzZeta(2.5, −10^7 + i).N()` stays unevaluated (at
once; before the limit, `HurwitzZeta(2, −10^12 + i).N()` did not finish).
Since 2026-09-30 an integer order has a route whose cost does not depend on
Re(a) (`hurwitzZetaFarLeft`): the polygamma reflection for 2 ≤ s ≤ 10 001,
and the Bernoulli polynomial for s = −n ≤ 0 (n ≤ 60). What still declines:
an order that is not an integer, which needs a representation whose cost
does not grow with −Re(a) (for example the Hurwitz functional equation for a
real a); an order above about 3 000 at a small Im(a), where the error of the
reflection grows past 1e−12 of the value; and a real a that is a
non-positive integer, at every order (there `HurwitzZeta` drops the
(a + k) = 0 term, while ψ has a pole). The generalized `Zeta(s, a)` follows
for an even order only: for an odd order its terms left of the axis are
((k + a)²)^(−s/2), which is not (k + a)^(−s).

### `PolyGamma(m, z)` of an order above 100 stays symbolic close to a half-integer on the real axis (OPEN — found 2026-09-28 reviewing #340)

`PolyGamma(120, -1/2 + 10^{-5} i).N()` stays unevaluated, although mpmath gives
a value near 8.6e232, inside the range of a double (at `Im(z) = 10^{-4}` it
answers). For `Re(z) < 0`, `polygammaComplex` needs the m-th derivative of
cot(πz). Close to a half-integer with a small `Im(z)`, the two series it can use
for that derivative both lose all their digits (the two halves of the
partial-fraction series are near-conjugates, and the Fourier series needs too
many terms), and its third form, a polynomial in cot(πz), is used only up to
order 100 because its coefficients overflow a double from order 120 on. Fix:
carry the polynomial coefficients in scaled form (a mantissa and a power-of-two
exponent, as `ScaledComplex` does), then raise `COT_POLYNOMIAL_MAX_ORDER` to
`POLYGAMMA_MAX_ORDER`.

### The machine-precision `PolyGamma` loses digits at a very high order (OPEN, small — found 2026-09-29 by the fix of the order limit)

At machine precision, `PolyGamma(1000, 400).N()` has a relative error of about
9·10⁻¹³ and `PolyGamma(10000, 3679).N()` (answered through the complex kernel,
which carries the factorial in scaled form) about 3·10⁻¹², against mpmath. The
default precision is not affected (the big-decimal kernel is correct to the
working precision at these orders, checked 2026-09-29). Same class as the
`Hypergeometric2F1` machine-precision entry below; whether this error is
acceptable at machine precision is not decided.

### Next items to pick up, ranked (2026-09-23)

The entries below are the ones judged worth starting next, most valuable first.
Each links to its own entry further down, which holds the detail. The ranking
weighs what a consumer sees (a wrong value first, then a slow one) against the
size of the work. The user-function cache item (decided "yes, after a soundness
check" on 2026-09-23) left the list: the check failed, and it needs a design
first (entry "Every call of a user function invalidates every generation-keyed
cache").

1. **The Tycho corpus document `s8ishknvhe`, what stays open** (the `Hsv` gate
   chain under complex mode) and the interval constant-list fan-out cap.
   Consumer-visible declines; medium size. Entries: "The Tycho corpus document
   `s8ishknvhe`: what stays open after the mixed-cell and pole round",
   "Coordinate projection through point arithmetic: what stays open".
2. **A new all-states Tycho baseline** on the next release, to measure the
   large-list and codegen work on real documents. Entry: "Code-generation census
   on CE 0.128.13: ranked candidates".

Not in this list: the design questions that need a ruling before any work (the
pre-canonicalization validation phase, the protocol conformers, the
`i`-in-subscript reading), and the entries marked deprioritized or demand-gated.

### Interval target: the census rows that remain are not implicit curves (triaged 2026-09-18; the user chose not to build the zip; the list-valued case arm landed the same day)

Point arithmetic (`_IA.bcastPoint`) and the point-coordinate accessor over a
list of points (`_IA.pointComponent`) took 30 interval-lane rows of the Tycho
census from a decline to a compile (documents `hpr2q4kles`, `mqm2eamst1`,
`lhjmsl5pbq`, `czpf52khpc`, `0vlrmhen37`), each value-checked against the
JavaScript lane. The remaining declines in the same 17 documents were traced to
their source rows, and the question asked of each was whether Tycho sends that
row to the interval lane at all. Tycho uses the interval lane for line plots
(break detection, with a JavaScript fallback) and for implicit curves (the CPU
quadtree); parametric curves, surfaces and 3-D members never use it, although
the census compiles every row on every target.

- **A `PointList` with list components (7 rows) — not built, by decision.** Five
  rows (`n7uhaaoq1q`) are `[PointList(…) for …]` comprehensions, 3-D parametric
  surfaces; one (`2ki2hjsouf`) is in a document the plan of 2026-09-15 already
  marks invalid; one (`mk7duulwxf`) is the restriction
  `1 > 0 {|2C·√min(…) − (0..C)| ≤ 1}`, which past the zip stops again at a
  relation over a `list<boolean>` (a list of verdicts is not a result of this
  target — see the entry below). The zip would give Tycho no implicit curve. If
  it is ever wanted: `_IA.bcastPoint` already consumes a list of points, so the
  missing piece is only the zip that builds one from the component lists
  (shortest length, a scalar component repeated), spelled in
  `compileIntervalCollectionValue` under the `PointList` head when a component
  is a list.
- **`List` in an operand position (11 rows).** Seven rows are `sgtdqnj2ox`,
  whose helper `H(x, y) := {B(x,y) > 0 : 0, h(⌊x⌋, ⌊y⌋)·2 − 1}` answers a scalar
  in one case arm and a LIST in the other; that now compiles (a `Which` at a
  consuming position is a selection among values, landed 2026-09-18), and the
  six interval-lane rows of the document agree with the JavaScript lane. Two
  rows (`rwhqbsp4wq`) are `P(0.1x, 6000·[0, 0.1, …, 1])`, an explicit list of
  ten line plots; the JavaScript lane compiles them, so the cost is break
  detection on those lines, not the plot. Two rows (`epq7yidtim`) are a 3-D
  `PointList` comprehension under a `distance` restriction — a surface.
- **A matrix operand of a kernel (2 rows, `jgcclk1njk`), `GeometricVector` (6),
  `At` over a tuple with a component that is not a number (3).** Not
  interval-lane members (vectors are drawing primitives; the matrix rows are
  parametric), listed so the next measurement starts from the same numbers.
- **An elementary function over a DECLARED point.** `Sin(P)` with
  `P: tuple<number, number>` declines ("the operand is a collection") while
  `Sin((a, b))` over a literal point of untyped symbols maps over the
  coordinates, as the interpreter does for both. The 2026-09-15 pin "a point is
  consumed whole, never mapped over" keeps the declared case declining; point
  arithmetic admits only `Add`, `Subtract`, `Negate`, `Multiply` and `Divide`.
  `Abs` and `Hypot` read a point whole (its norm) and must stay out of any
  widening. No census row stops here.

### Colour handling residue (audit of 2026-09-08; the five colour rulings — a tuple is 0–1 sRGB, `ColorFromColorspace` answers the route's canonical components, a well-formed spelling that packs to zero is transparent black, a list is not a colour, `ContrastingColor` answers the candidate — landed 2026-09-09)

- `doc/86-reference-colors.md` says `Color` returns a `Tuple`; it returns an
  `Oklch` head. Update the reference.
- `ContrastingColor((u, 1, 1), Rgb(1, 0, 0), Rgb(0, 0, 1))` declines on WGSL:
  `gpuCheckOperandShapes` refuses `select` over a `vec3` operand and a scalar
  one. GLSL compiles the same expression. A fail-closed decline in the shared
  shape gate, not a wrong value; pre-existing.
- A colour tuple that reaches a colour operator through a VARIABLE keeps the
  route's canonical reading (OKLCh on the compiled targets): its shape is
  unknowable at compile time. Documented in the handler comments and pinned; no
  better answer exists without a runtime tag on colour values.
- On `glsl`/`wgsl`, `Oklch(∞, 0.1, 30)` and `AsOklch` of it keep the raw
  channels `(Inf, 0.1, 30)`: the shader `Oklch`/`AsOklch` lowerings pass the
  channels through without the finiteness check the other routes apply, where an
  infinite L is an error (interpreter) or the NaN colour (javascript). Any later
  sRGB or OKLab conversion gives NaN, so no wrong colour is drawn, but the raw
  value is not the NaN colour (OPEN, route parity — found 2026-09-23). The fix
  is a check in those two lowerings; it changes many emitted-code pins.

### What the rulings of 2026-09-21 left open (OPEN — recorded 2026-09-22 when the six rulings landed)

The eight decisions of 2026-09-21 (the `Round` tie rule, the empty-list
broadcast, `Undefined` in a numeric slot, a stored value keeps its binding on
the compiled route, no by-name interception by a caller's binder,
whole-collection equality with an absent cell, no one-argument `Clamp`, the
shader statement order documented) are in `CHANGELOG.md`. Each left a residue
that no ruling covers yet.

- **Absence parity residues.** A comparison on `Undefined` TYPES `boolean` while
  its value is `Missing` (the type handlers read a `missing`-typed operand, not
  the symbol). `Xor` and `Equivalent` accept an absent operand since 2026-09-27
  (user decision: they answer `Missing`, as `And`, `Or` and `Not` do).

### What the second review of the 2026-09-23 to 2026-09-26 commits left open (OPEN — found 2026-09-26)

A Codex review of the commits made while it was unavailable found 41 defects;
the fixes and four user decisions of the same day landed. These items remain.

Defects:

1. **Inverse trigonometric functions of a huge complex argument are `NaN`.**
   `Arccot(10^{-200}+10^{-200}i).N()` and `Arccsc(10^{-200}+10^{-200}i).N()` are
   `NaN`: the reciprocal is now right (`5e199 - 5e199i`, since 2026-09-27), but
   `complex-esm`'s `atan` and `asin` return `NaN` for an argument near `5e199`
   (`new Complex(5e199, -5e199).atan()` is `NaN`). Found 2026-09-27 while
   scaling the interpreter's complex division; the fix is a scaled `atan`/`asin`
   kernel, or a reduction for large arguments.
2. **A lazy `Map` or `Filter` over a `Join` or `Append` whose operand is absent
   stays unevaluated.** `Map(f, Join(Missing, [3]))` should be `Missing`, as
   `Map(f, Missing)` is. The source correctly declines to enumerate, but a lazy
   operator does not evaluate its collection operand, and conditional threading
   reads only direct `When`/`Which` operands. An `evaluate` handler on
   `Map`/`Filter` was tried and broke ordinary lazy evaluation (45 suites). The
   fix belongs in the evaluation step (`boxed-function.ts`): evaluate a lazy
   operator's `Join`/`Append` operand when it may be absent, then thread the
   result.

### `.N()` rounds an exact operand before a special function sees it (OPEN — found 2026-09-28 by the review of PR #360)

At `ce.precision = 50`, `HurwitzZeta(3, 1/3).N()` is
`27.561061199700803776227877977407509284542095313016`; the correct value ends
`…313015` (it is `…3130148811…`). `Digamma(1/3).N()` ends `…67205` where the
correct value ends `…67204` (it is `…672041806…`). The cause is not the kernels:
a `.N()` evaluates each operand numerically first, so `1/3` reaches the evaluate
handler as a 50-digit decimal, and the rounding error of that operand reaches
the last digit of the result. The same call on the `.evaluate()` route with an
inexact `s` keeps `a` exact, and `HurwitzZeta(3.0, 1/3).evaluate()` is correct
to the last digit (the bignum Hurwitz kernel converts an exact rational at its
own working precision). A fix is either an engine-wide one (evaluate the
operands of a numeric evaluation with guard digits, or pass exact operands
through) or a per-operator one (hold the operands of `Zeta`, `HurwitzZeta`,
`Digamma` and similar functions and evaluate them in the handler).

### A matrix to a non-integer power is element-wise (OPEN, decision — found 2026-09-28 by the agents writing the linear-algebra examples)

`[[1, 2], [3, 4]] ^ (1/2)` is `[[1, √2], [√3, 2]]`, the square root of each
entry, while an integer exponent is the matrix power (`^2` is
`[[7, 10], [15, 22]]`, `^-1` the inverse). `canonicalPower`
(`arithmetic-power.ts`) says element-wise power "is not expressed via `^`" and
leaves non-integer exponents "to other handling", which is the broadcast. The
decision: a matrix function (`A^(1/2)` the principal square root, computed or
left symbolic), an error, or the element-wise reading kept and documented.

### A calculus operator over a function parameter is folded before the argument arrives (OPEN — found 2026-09-27 while writing the core reference examples)

`g(f) = D(f, x); g(x^2)` evaluates to `0`, and so do `(f => D(f, x))(x^2)` and
the box route
`["Apply", ["Function", ["D", "f", "x"], "f"], ["Power", "x", 2]]`; the answer
is `2x`. `g(f) = Integrate(f, x); g(x^2)` gives `x·x^2`; the answer is `x^3/3`.
The LaTeX route shows the mechanism: `g(f) := \frac{d}{dx} f` canonicalizes to
`(f) => D((x) => f, x)`. The body is canonicalized when the function is defined,
the integrand is lifted with `f` as a symbol free of `x`, and the derivative (or
antiderivative) of an `x`-free symbol is folded before the call substitutes
`x^2` for `f`. An operator that does not fold on a parameter is not affected:
`g(f) = f + 1` and `g(f) = Expand(f)` answer correctly. The fix is in the binder
handling of `D`/`Integrate` (`liftIntegrand`, `boxed-expression/utils.ts`, and
the canonical handlers): a symbol bound by an enclosing `Function` is not a
constant of the differentiation variable, so the fold must wait until the
argument is substituted.

### Engine code that builds a node by name picks up a user binding in the active scope (OPEN — found 2026-09-27 by the dual review of the shadowing change)

Inside a function body, a local definition named like a library operator is seen
by engine code that runs during that body's evaluation:
`function f() { function Add(a, b) { 12345 }; expand((y + 1) * (y + 2)) }; f()`
evaluates to `152399025` (the user `Add` applied to the terms `Expand` builds),
`function f() { function Add(a, b) { 999 }; D(y^2 + y, y) }; f()` is `999`, and
`function f() { function Sin(a) { 999 }; D(cos(y), y) }; f()` is `-999`.
Measured identical on the tree before 2026-09-27, so the shadowing change did
not introduce it. The same shadow in a `do { }` block does not reproduce it.
Engine code (`Expand`, `D`, the polynomial and simplification code) builds
`Add`/`Multiply`/`Sin` nodes by name while the user's function scope is the
current scope, and name resolution cannot tell that construction from a
user-written call. The fix direction: engine-built nodes resolve their head
against the system scope (a construction route that does not consult the current
scope), leaving scope-based resolution to user-written code.

The same happens at the top level, through the formulas of the derivative
table (measured 2026-10-01): after `Sinh(x) := 3x`, `D(Cosh(t), t)` gives
`3t`, because the rule for `Cosh` is the formula `Sinh(x)`, and that formula
picks up the user's `Sinh`. (`D(Sinh(t), t)` itself is `3` since 2026-10-01:
`D` now checks whether a user definition shadows the name before it uses the
rule for that name.)

### A function-typed factor is a product under juxtaposition and a type error under an explicit operator (OPEN, ruling — found 2026-09-22 while fixing the MathNet round-trip check)

In one engine, after `ce.parse('f(x)')` has declared `f` a function, `fy` parses
to the clean product `Multiply(f, y)`, while `f\times y`, `f\cdot y` and `f + y`
parse to an `incompatible-type` error (`number` expected, `function` found) on
the `f` operand. The juxtaposition reader documents a function-typed operand as
a product (`2f`, `f x`; `boxed-expression/ invisible-operator.ts` near the
`canonicalInvisibleOperator` comment) and builds the node with `ce._fn`, which
skips the signature; the explicit-operator route boxes canonically and meets
`Multiply`'s `(number*) -> number` signature. Two directions, both a typing
decision: widen `Multiply` and `Add` to accept a `function` operand (aligns with
the documented `2f` intent), or make juxtaposition strict (contradicts that
comment). No corpus row reaches it since the round-trip fix of 2026-09-22
(`f(yf(x))(x + y)` now parses as the application it is;
`test/compute-engine/juxtaposition-application.test.ts`).

### `Dot` of a tuple of points stays symbolic in the interpreter but compiles to a matrix product (OPEN — found 2026-09-22 while making `Dot` broadcast over a point list)

`Dot(((1, 2), (3, 4)), (5, 6))` stays symbolic in the interpreter, because a
tuple of tuples is read as ONE point with nested coordinates (`Norm` of it is
the flattened 4-vector, `PointX` of it is `(3, 4)`), while the compiled
JavaScript route lowers it to `_SYS.matmul([[1, 2], [3, 4]], [5, 6])` and
answers `[17, 39]`. Pre-existing; the fail-closed guard does not catch the
shape. Either the compiled route declines a tuple-of-tuples operand of `Dot`, or
the interpreter reads it as a point list; the point-list broadcast of 2026-09-22
excludes a tuple operand on all three routes and pins the exclusion
(`test/compute-engine/dot-point-list-broadcast.test.ts`).

### Findings of the Tycho code-generation audit of 2026-09-09 (OPEN — CE 0.127.0; report `~/dev/tycho/_TASK/desmos/desmos-corpus/codegen-audit/2026-09-09-report.md`, records in `ce-0.127.0.json` of that folder)

The report was reviewed on 2026-09-09 and each item was reproduced against HEAD
from source before it was listed here. The items are in the order of their
expected effect on the corpus.

- **A user function declared `-> unknown` types `broadcastable<number>` through
  every broadcastable head** (`\sin(u(t))` for `u: (unknown) -> unknown`). This
  is the cause of the audit's largest item (465 `_SYS.bcast` sites, 42
  `PointList` declines on GLSL): Tycho's importer declares each user function
  `(unknown, …) -> unknown` and refines the result only when its probe reads a
  type that `matches('number')` — `missing | number` (the default-less piecewise
  again) fails that test, so the result stays `unknown`. The typing is honest on
  CE's side; a default-less piecewise keeps its `missing | T` type by ruling
  (2026-09-09), so the remaining lever is the Tycho-side change to accept
  `missing | T` as scalar in that probe. The 2026-09-08 note "J3 is not
  reproducible at HEAD" was true only for the constructions tried; the
  `-> unknown` declaration with the body assigned in ANOTHER scope reproduces
  it.
- **Absence at the boxing seam, residue found while fixing the consumers
  (2026-09-09).** (1) A bare `missing` big-operator bound
  (`Sum(x, (x, Missing, 3))`) is still an `incompatible-type` error while a
  `NaN` bound stays symbolic; `checkBound` (`library/utils.ts`) now accepts
  `missing | numeric` only. Decide whether the early diagnostic or the §3
  normalization wins. (2) `g(3) + 0` evaluates to `Missing` while `g(3) + 1`
  evaluates to `NaN`, because the identity element is dropped at
  canonicalization and no numeric slot remains for the absence gate. Judged
  consistent with the ruling (`g(3) + 0` IS `g(3)`), recorded so the difference
  is a known one.
- **The piecewise decidedness guard is NOT redundant after the exact equality
  (checked 2026-09-09, closing a note that said the opposite):** a comparison
  operand behind the guard `(v === v) ? … : NaN` still needs it.
  `Which(Equal(NaN, 5), 1, True, 0)` evaluates to `Missing` in the interpreter,
  so the compiled piecewise must answer `NaN` when the compared value is `NaN`;
  without the guard `NaN === 5` is `false` and the else arm would answer
  instead. The exact test answers `false` on `NaN`, which is the right answer
  for the COMPARISON, not for the piecewise that contains it. Tycho's item 276
  asks for the guard to be dropped; it stays, and the test
  `compile-equality-exact.test.ts` pins the interpreter's `Missing`.
- **Not CE's:** the inline `At` lambda (Tycho's own override), the "Unknown
  operator" declines (importer binding), and the 2× re-compile of every declined
  row.

### Residue of the Tycho items 275–280 round (OPEN — found by the dual review of 2026-09-09, not fixed in the round)

- **A SCALAR compiled comparison answers a decided boolean where the interpreter
  is undecided.** `Equal(a, b)` with either operand absent from the object of
  variables compiles to `false` (and `NotEqual` to `true`), where the
  interpreter answers `Missing` for `Equal(Missing, 5)` and for
  `NotEqual(Missing, 5)` alike. The ELEMENT-WISE runtime was made three-valued
  (an absent cell is marked `NaN`, which the selection runtime and the
  element-wise connective guard both read); the scalar lowering deliberately was
  not, and the reasons were measured rather than assumed. Its answer is relied
  on to be a real boolean in four places: `BRANCH_RELATIONS` states so;
  `kleeneRelationLeaf` negates the compiled comparison with a bare `not`, which
  would turn a marker into a confident `true`; a value-position `And`/`Or` is a
  plain `&&`, which returns its first falsy operand and so cannot let a decided
  `false` absorb an undecided operand; and a chained comparison would need a
  three-valued fold that still stops at the first false pair, because the
  interpreter short-circuits a chain there (`evaluateChainOperands`). Two
  further consequences were measured: the marker arm would have to fire when
  EITHER operand may be absent (a literal on one side currently makes the pair
  decided, so `Equal(a, 3)` and `Equal(a, b)` would disagree), and the emitted
  arm splices both operands twice, which double-evaluates a pure but expensive
  operand that only impure operands are currently bound against. Closing this
  means doing all of that together, not changing the comparison alone.
- **`Re((x+ib)^2)` still builds one `{re, im}` object (noted by the complex-lane
  slice of 2026-09-09).** The statement lowering removed the closures; splitting
  a small-integer `Power` of a complex operand into its two real parts at the
  reader (`tryGetJSComplexParts`) would emit `x*x - b*b` with no object at all,
  at the cost of splicing each part twice (a cheapness gate is needed) and of
  inheriting the reader's `re = 0` convention for a non-finite imaginary factor.
  A new optimization, not a defect; the expression-position `code` keeps one
  enclosing function by contract either way.
- **Symbolic differentiation still grows super-exponentially with the order, in
  the expansion, not in `factor()`.** Witness `f(x) := √(x+√(x+√(x+√(x+x))))`.
  Step 1 of the 2026-09-22 ruling landed: `factor()` memoizes its answers per
  engine on the structural digest (`boxed-expression/factor.ts`; results
  byte-identical on a 379-line corpus), so the third derivative does 1,091
  factorizations instead of 1,166,395 and takes 5.4 s instead of 10.9 s; the
  second derivative built with `mulFactored` is now 2.1 times the `.mul()` build
  at order two (was 15 times), 468 ms against 220 ms. Step 2 was measured and
  NOT taken: the factored build is larger at order three (150,008 characters
  against 72,637) and takes 44 s, so the chain rule keeps `.mul()`. What remains
  is the growth itself: the profile names `expandProduct`/`expandProducts` (9 s
  of the 11.7 s third derivative) and `add`, because the chain rule distributes
  each level over the previous one. Levers not taken: build the derivative of a
  nested radical as a product of powers without opening it, or simplify per
  order before differentiating again; either changes the shape of `evaluate()`
  results and needs a snapshot-churn measurement.
- **RULED 2026-09-22 (a): first fix `factor()` on nested quotients, then measure
  the snapshot blast radius of factored derivatives and decide on that number.**
  The corpus row of Tycho item 284,
  `\sum_{i=0}^{3}\frac{(x-\epsilon)^i}{i!}F(\epsilon)[i+1]` with
  `F := [f, f', f'', f''']`, parses as the application of a list element since
  2026-09-29 (`["At", ["F", "epsilon"], ["Add", "i", 1]]` inside the `Sum`; it
  parsed as a juxtaposition before), so the row can be re-tested on the Tycho
  side; the explicit four-term sum compiles in 65 ms and matches `.N()`.
- **`_gpu_powi` vector variants answer NaN for a zero component under a negative
  odd exponent** (`sign(x) · pow(0, n)` is `0 · ∞`), where the scalar helper
  answers `+∞`. Both sit in hardware-undefined territory (a pole); a
  per-component `select` would make the two agree. Reachable now that a negative
  run-time exponent over a `vecN` base routes to the helper.
- **The interval-js runner copies its answer on the way out.** The constant
  table now lives for the artifact's lifetime, so `freshIntervalValue` copies
  the top-level result (and, for a collection-valued root, every element) so a
  caller that writes into a returned enclosure cannot corrupt the table. One or
  two small allocations per call; for a collection-valued root the copy is
  linear in its length. The alternative is to document the returned enclosure as
  read-only and drop the copy. Today no in-repo consumer writes to a returned
  enclosure. The copy stays until ruled otherwise.

### JavaScript target: a call with a complex-valued point coordinate declines (OPEN, compile gap — found 2026-09-23, narrowed 2026-09-29)

With `k := i` and `p: (unknown) -> unknown`, `p(P) := P.x + k`: `p((x, 1)) + 1`,
`\sum_{k} (k + p((x, 1)))` and a `Block` local `k` beside `p((x, 1))` compile
since 2026-09-29 through the point-specialized definition and run to `3+i`,
`7+2i` and `5+i` at `x = 2`. What still declines, in both `auto` and `strict`
mode: `\sum_{k=1}^{3} p((x, \sqrt{x-5}))`, with "argument 1 is a point with a
complex-valued coordinate, and the emitted definition reads a point parameter's
coordinates as real numbers".

### Residues of the exactness-by-route rule (OPEN, decisions — 2026-09-27)

Since 2026-09-27 (user decision) exactness is decided by the route: a literal
with a fraction part (`1.0`, `2.0`, `{num: "1.0"}`) is a float on every route,
and `ce.number(bigDecimal)` is exact for an integer-valued big decimal at any
magnitude (`doc/12-guide-numerical-evaluations.md`, "Exact and Inexact Numbers:
the Spelling Decides"). What that left:

1. **A float exponent `1.0` is still an identity in `Power`, and exact `0`
   divided by a float is exact.** `x^{1.0}` evaluates to `x` (its MathJSON is
   `"x"`, so the float does not survive a round trip) and exact `0` divided by a
   float is exact `0`. `Add` and `Multiply` keep the float since 2026-09-29
   (`1.0x` stays `1.0·x`, `1.0^x` stays `Power(1.0, x)`, `0.0 + x` stays
   `Add(x, 0.0)`, `0.0x` is a float `0`, `2.0x + x` is `3.0x`); `Power` and the
   exact-zero quotient need the same decision.
2. **An exponent literal with no fraction part (`1e3`) is exact**, as
   Mathematica's `1*^3` is; `1.5e3` is a float. It cannot become a float without
   first changing the MathJSON serialization of a large exact integer, which is
   `{num: "1e+30"}` today, and `numbers.test.ts` pins
   `parse('1e100000').isInteger`.
3. **A float quotient does not survive a LaTeX round trip.** `\frac{1.0}{3}`
   evaluates to a float whose LaTeX is `0.\overline{3}`, which re-parses as the
   exact `1/3` (true of any float with repeating digits). A fix needs a LaTeX
   mark for an inexact number.
4. `.N()` of an exact small integer stays exact (`\sqrt{4}.N()` at precision 30
   is the exact `2`, `(\sqrt{2})^2.N()` too): `BoxedNumber.N()` returns a small
   exact integer unchanged, on purpose. Under the exactness contract `.N()`
   produces a float; changing it has a large effect and is a decision.

### Residues of the fixes for Tycho asks 306–315 (OPEN — found 2026-09-24)

Not fixed, accepted rule: on `javascript`, a list held by a free point
coordinate becomes `NaN` (`_SYS.pointSlot`), so `[1,2]·PointList(t,t)` run with
`t = [1,2]` gives `[[NaN,NaN],[NaN,NaN]]` where the interpreter answers
`[(1,1),(4,4)]`. Refusing the compile whenever a coordinate type is `unknown`
would also refuse ordinary plot expressions. On `interval-js`,
`2·PointList(t,1)` with `t = [1,2]` gives the point `([2,4], 2)`; plot variables
on that target are numbers.

Found while fixing 313 (not fixed; each gives a visible error, not a wrong
value): `x4[1,2]` (the left side is already the product `x·4`), `2^3[1,2]` and
`\sin 4[1,2]` (read as an index, `At(…)`, then a type error), and `4[x=0]` (an
Iverson bracket, so no product reading). `4]1,2[` canonicalizes to
`Tuple(4, Interval(…))`, which is probably not what an author means.

### Residues of the 2026-09-27 decision batch (OPEN, small — found by the implementation of decisions 1A, 2A and 4A)

- **Compiled division by zero of a point cell.** `[P\{c\}, (3,4)] / t` at
  `t = 0` gives `[Infinity, Infinity]` for the present cell when compiled, and
  the interpreter fallback gives the complex infinity
  `{re: Infinity, im: Infinity}`. A decision: whether `Infinity` per coordinate
  is the accepted real-target spelling of complex infinity.
- **Point arithmetic that still refuses to compile** (a refusal, not a wrong
  value): `P\{c\} + [Q_1, Q_2]` ("may be a point or a list of points at run
  time", the `'runtime-list'` emission), `[P\{c\}, Q] + R` and
  `[1,2]·P\{c\} + Q` ("scalar arithmetic over a list-valued operand").
- **The type of an element-wise comparison over an absent list.** `L\{c\} < 3`
  is typed `list<boolean | missing>`, but when `L` is absent the value is
  `Missing` for the whole list, not a list; the type should be
  `missing | list<boolean>`.
- **Other code may box an integer-valued double as exact.** Until 2026-09-28 an
  exact `1` and a float `1` serialized the same way, so a site that boxes a
  double result with `ce.number(n)` was invisible; since the `2.0` spelling it
  shows. The full suite found one (the compiled `N()` of a lazy `Map`, fixed);
  kernel bridges and compiled-value readers that call `ce.number(double)` need
  an audit (the float lane is `ce._inexactNumericValue`). Also: at machine
  precision `1.0e800` overflows to `PositiveInfinity`, which reports
  `isExact === true`. Also: the compiled `N()` of a lazy `Map` boxes an
  integer-valued result as exact when its operands and the lambda are exact; an
  elementary function of an exact integer whose double is exactly an integer
  near 2^53 (`exp(36)`) is then exact where the interpreter gives a float (found
  2026-09-28, rare).
- **Float Gaussian integers are still exact.** `(2.0i)^2` evaluates to the exact
  `-4`, `2.0i + 3` canonicalizes to the exact `3 + 2i`, and `(3.0+2i)(1+i)` is
  exact: several places keep a Gaussian integer exact (`isExactNumber` in
  `apply.ts`, `ExactNumericValue.sum`, `_liftComplex`, the fold in
  `arithmetic-add.ts`), from when the literal `3i` was a float. A decision:
  whether `ce.number(new Complex(2, 3))` (a `complex-esm` value, doubles by
  definition) is exact; if not, these exceptions go.
- **Integer functions of a float argument answer exactly.** `Fibonacci(5.0)`,
  `Lucas`, `BellNumber`, `CatalanNumber`, `NthPrime`, `PrimePi`, `Totient`,
  `DigitSum`, `Subfactorial`, `StirlingS1`, `BernoulliB`, `HurwitzZeta(0.0, 2)`
  give exact results. Mathematica refuses a real argument for most of them. A
  decision: refuse (a type error), or answer a float. (`Arg(2.0)`, `Im(2.0)`,
  `Heaviside`, `KroneckerDelta`, `Denominator`, `Rationalize`, `MatrixRank` are
  exact in Mathematica too and stay.) The rounding family (`Round`, `Floor`,
  `Ceil`, `Truncate`) is decided the Mathematica way: a float argument gives an
  exact integer, and `Round(3.14159, 2)` is `157/50`
  (cortex-js/compute-engine#351).
- **WGSL `Mod` when the quotient underflows.** The componentwise floor-mod
  `(((a % b) - b * floor((a % b) / b)) % b)` (2026-09-27, it replaced
  `((a % b) + b) % b`, which rounded in `f32`) makes no correction when
  `(a % b) / b` underflows to `-0`, so the result keeps the wrong sign for a
  tiny remainder of the opposite sign.
- **Unfolded identities beside an unknown.** `Nand(True, A)`, `Nor(False, A)`,
  `Implies(True, A)`, `Implies(A, False)`, `Implies(A, A)`, `Nand(A, A)`,
  `Equivalent(A, A)` stay unevaluated while `And(True, A)` evaluates to `A`;
  each value is correct. Folding them (to `¬A`, `¬A`, `A`, `¬A`, `True`, `¬A`,
  `True`) is new work.

### A callback ignores the callee's parameter annotation on both routes, and a folded `Map` over per-element errors (OPEN — found 2026-09-27, widened 2026-09-29)

`Map(k ↦ h(k), [1, 2.5])` with `h` declared `(x: integer) -> …` compiles to
JavaScript and runs to `[2, 5]`, and since 2026-09-29 the interpreter answers
`[2, 5]` too, although a direct `h(2.5)` is an `incompatible-type` error:
neither route checks the parameter annotation inside a callback. The bare-symbol
form `Map(h, …)` now compiles (to the constant `[2, 5]`) where it refused
before. Related, recorded convention rather than a defect: under `.N()` a `Map`
whose callback errors per element answers `NaN` cells (the lowered broadcast in
`library/map-lowering.ts` turns a bad element into the collection's absence
marker, pinned by `test/epsil/programs.test.ts` "errors are values: a bad
element becomes NaN" and two more), while `evaluate()` keeps the `Error`
elements. Since 2026-09-27 the constant fold declines a collection with a `NaN`
element, because it cannot tell an error's `NaN` from a computed one, so
`compile(Map(w, [1, 2, 3]))` with an unemittable `w` refuses as before instead
of compiling `[NaN, NaN, NaN]`.

### `Map` with a bare symbol callback: what the 2026-09-27 decision left (OPEN, low)

Since 2026-09-27 (user decision) a bare-symbol callback with a known signature
types the elements of `Map` from that signature's result type, and the source
type is copied only when the callback is unknown. Two residues: (1) the zip form
`Map(Add, xs, ys)` is typed `list<value^2>` (it was `list<unknown^2>`) because
`Add`'s declared result is `value`; no test covers it. (2) Only the declared
signature is used; running the operator's own type handler on the source element
type would give narrower types (`Sin` over integers gives `real`), and an
assigned lambda `x ↦ x + 10` over integers now types `number` elements where the
copied type said `integer`.

### Definite integrals of `Abs` and `Sign`: what the fix of issue #352 left (OPEN, small — found 2026-09-28)

A definite integral whose integrand has `Abs(u)` or `Sign(u)` is now split at
the points where `u` changes sign, and each piece is integrated with `Abs(u)`
replaced by `±u` and `Sign(u)` by `±1` (`integrateAcrossKinks`,
`library/calculus.ts`). Two cases are not covered:

- The split applies only when `u` is linear in the integration variable. With a
  nonlinear argument, such as `\int_{-1}^{1} |x^2 - 1/4|\,dx` (value `1/2`), the
  integral is not split and stays unevaluated, because the built-in
  antiderivative of `|x^2 - 1/4|` is not found. The fix would find the real
  roots of a polynomial `u` in the interval and split there in the same way.
- When the position of a sign change relative to the bounds cannot be decided,
  the integral is not split, and an antiderivative with a `Sign(u)` term that
  depends on the variable now leaves the integral unevaluated, because
  `F(b) − F(a)` includes the jump of that term if the sign change is between the
  bounds. This also leaves unevaluated some integrals that had a value that was
  correct for part of the parameter range: `\int_2^a |x|\cos x\,dx` gave
  `\sin(a)|a| + \cos(a)\operatorname{sgn}(a) - 2\sin 2 - \cos 2`, which is
  correct for `a > 0` and wrong for `a < 0`; it now stays unevaluated.
  `\int_0^1 |x - c|\cos x\,dx` is the same case. A conditional value (a `When`
  over the sign of `a`, or of `c`), or a use of the assumptions on `a`, would
  give these a value again. A nonlinear `Sign` argument does not reach this
  check today: the built-in antiderivative and the Rubi rules both leave
  `\int_2^3 x\operatorname{sgn}(x^2-1)\,dx` unevaluated, before and after the
  change.

### The exact numeric lane answers `n/0` and `∞·2` with `NaN` (OPEN, small — found 2026-09-28 by Phase 0 of `docs/plans/2026-09-28-indeterminate-value.md`)

`ExactNumericValue.div(0)` (a JavaScript number `0`) returns `NaN` for every
dividend (`numeric-value/exact-numeric-value.ts:907`): `5.div(0)` is `NaN`,
while `5.div(<exact 0>)` is `Infinity`. The normalization of a rational with a
zero denominator also makes `[n, 0]` `NaN` for `n ≠ 0` (`:474`). And an exact
infinity (made by `inv()` of `0`, `:664`) times an integer is `NaN`, because the
rational helpers map any non-finite machine rational to `NaN`
(`numerics/rationals.ts:192`, `:208`, `:213`): `inv(0).mul(2)` is `NaN`, not
`Infinity`. No boxed route reaches these today (the boxed folds answer `~oo` and
`∞` before the lane is used). Phase 2 of the plan above switched no producer
that routes through the lane, so a pole is not read as an indeterminate form
(`5/0`, `Rational(5, 0)`, `Divide(5, 0)`, `1/0` and `-1/0` are still `~oo`,
pinned in `test/compute-engine/indeterminate.test.ts`); a later change that maps
an exact-lane `NaN` to `Indeterminate` must fix this first. The fix gives `n/0`
the value `±∞` (or `~oo` for a complex `n`) and lets the rational helpers carry
a signed infinity.

### Three special-function points answer `NaN` where a signed or complex infinity exists (OPEN, decision — found 2026-09-29 by Phase 2 of `docs/plans/2026-09-28-indeterminate-value.md`)

Three values at an infinite point are `NaN` by a recorded ruling (Phase F batch
8 of `docs/plans/2026-08-30-error-model-implementation.md`) because the answer
depends on the other operand, although for given operands a limit exists:
`Gamma(s, −∞)` (for a positive integer `s`,
`Γ(n, x) = (n−1)!·e^{−x}·Σ_{k<n} x^k/k!` gives `(−1)^{n−1}·∞`:
`Γ(2, −100) = −2.7·10⁴⁵`, `Γ(3, −100) = +2.6·10⁴⁷`; for a non-integer `s` the
value is complex with an unbounded modulus, `~oo`); `Beta(+∞, b)` for a `b` with
a non-positive real part (`B(a, b) ~ Γ(b)·a^{−b}`, so `B(+∞, −1/2) = −∞` since
`Γ(−1/2) = −2√π`); `GammaRegularized(a, −∞)` for a non-integer `a` (complex,
with an unbounded modulus). Phase 2 kept `NaN` there, because `Indeterminate`
would state that the form has no value. Example today: `Gamma(2, -oo)` → `NaN`.
Options: (a) answer the limit (`-oo` for `Gamma(2, −∞)`, `~oo` for a non-integer
`s`), (b) keep `NaN` (nothing changes).

### A float absorbed by an infinity is not seen by the float rule of `Indeterminate` (OPEN, small — found 2026-09-29 in the review of Phase 2 of `docs/plans/2026-09-28-indeterminate-value.md`)

An indeterminate form with a float operand answers `NaN` (`0.0·∞` is `NaN`), but
the rule reads the operands of the form as they are when the form is built. When
a float was first absorbed by an infinity, it is gone by then: `Fract(∞ + 0.5)`
and `0·(∞ + 0.5)` evaluate to `Indeterminate`, because `∞ + 0.5` is the exact
`∞` before `Fract` or the product sees it. The absorption itself is correct
(`∞ + 0.5` is `∞`). A fix would have `∞ + x` with a float `x` keep a mark that
it came from a float, which the infinity literal cannot carry today. Both
answers are pinned in `test/compute-engine/indeterminate.test.ts`.

### The `.mul()` method stores the current value of a variable in a point or a list (OPEN, small — found 2026-09-30 by the review of the zero-factor fix)

With `w := 4`, `ce.number(2).mul(ce.box(['Tuple', 'w', 2]))` is the point
`(8, 4)`, and `ce.number(2).mul(ce.box(['List', 'w', 2]))` is `[8, 4]`: the
point product (`mulTuples`, `arithmetic-mul-div.ts`) evaluates each component
before it multiplies, and the list product does the same, so the result keeps
the value `w` holds now. A later `w := 5` does not change it. The canonical
`Multiply(2, (w, 2))` keeps the product and reads the value at evaluation. For
a zero factor this also hides a `NaN`: with `w := NaN`,
`ce.Zero.mul((w, 2))` is `(NaN, 0)` now and stays so after `w := 4`. A scalar
factor no longer has this defect (`0·w` is kept since 2026-09-30). A fix would
multiply the components without evaluating them, as `mul()` does for a
scalar; the evaluation of a component is there so that a component such as
`0.3n` with `n` a list is broadcast, and that case must keep working.

### Residues of the absent-value round (OPEN, small — found 2026-09-25)

The round of that date made arithmetic with an absent operand `NaN`, an
out-of-range read `NaN`, `Trace(Missing)` `NaN`, and put an absent cell last in
`Sort`. What it left: (1) Since 2026-09-27 (user decision) the interpreter
fallback of a compiled function (`buildInterpreterFallback`,
`compilation/base-compiler.ts`) spells an absent result or cell by the type of
its position, `NaN` for a number and `undefined` for a point, list, tuple,
colour, boolean or string, as compiled JavaScript does, and the interval-js
fallback spells it `{kind: 'empty'}`. What that left, decisions: (a) the
COMPILED route spells an absent point three ways for the same static type
`missing | tuple<…>`: a restricted point, `At(P, 5)` and `Distance` to a list
give `undefined`; point + absent point gives `[NaN, NaN]`
(`point-list-length-mismatch-compiled.test.ts`); scalar × absent point gives
`NaN` (`compile-restricted-point.test.ts`); the fallback follows the type and
gives `undefined`, so the two arithmetic cases still differ by route. (b) A bare
`Undefined` (type `unknown`) falls back to `NaN` while compiled code gives
`undefined`. (c) The Python fallback gives `undefined` for an absent object
result while a written `Missing` compiles to `math.nan` on that target. (d) On
interval-js a present number is `{kind: 'interval', value: {lo, hi}}` compiled
and `{lo, hi}` from the fallback, and a written `Missing` or an out-of-range
`At` compiles to `{lo: NaN, hi: NaN}` while the fallback gives
`{kind: 'empty'}`. Also found 2026-09-27, interpreter defects against
`docs/ERROR-MODEL.md` §3: `Less(First([Missing, 1]), 0)` is `False` but `If`
over it is an "absent condition" error, and `If(Less(Missing, t), …)` is that
error where §3 says a branch on an undecided comparison takes no arm; compiled
code answers `NaN` in both. `python-target.ts` calls `conditionDecidability`
without a target at two sites (lines near 2409 and 2564); the absent-relation
rule is handled inside `conditionNode` instead. Not a defect (checked
2026-09-27): the `.neg()`, `.inv()`, `.pow()` and `.sqrt()` methods keep an
absent operand (`-"Missing"`, `1/"Missing"`; both evaluate to `NaN`) on purpose,
because canonicalization builds a difference as `a + (-b)` and the kept
`Negate(Missing)` is the marker that makes `(1, 2) - Missing` absent rather than
a type error (`absent-point-arithmetic.test.ts` pins six such cases). Not a
defect, recorded rule: compiled arithmetic with an absent POINT gives `NaN`
where the interpreter gives `Missing` (`compile-restricted-point.test.ts`, as
for `A\{0<t\} + 1`).

### An absent list carries no shape: `Missing + 2\{b>0\}` is a scalar (OPEN, small — found 2026-09-25)

`[1,2]\{a>0\} + 2\{b>0\}` with both conditions undecided is
`[3\{b>0\}, 4\{b>0\}]\{a>0\}`, and once `a = -1` that held value is `Missing`.
Evaluated fresh with `a = -1`, the list restriction is already `Missing` when
the sum is formed, and `Missing + 2\{b>0\}` threads to `NaN\{b>0\}`: the absent
operand is a bare `Missing`, which carries no shape, so the sum reads it as an
absent scalar and answers the numeric marker still gated by `b`. The two routes
agree once `b` is decided too (`[NaN, NaN]` for `b = -1` with `a` free on both).
The point case no longer shows it (probed 2026-09-29): at `t = −1`,
`(A\{0<t\}, B) + (A, B)` is `(NaN, 2B)` typed `tuple<nan, number>`, so a point
keeps its shape; the list case above still does not. A fix needs the absent
value of a list to remember that it was a list (a typed absence), which
`Missing` does not.

### Residues of the tuple-of-lists change (OPEN, small — 2026-09-25)

Block-local functions and variadic parameters do not map over a list of points.
(Probed 2026-09-29: an untyped `k := P ↦ 2P` applied to `[Missing, (3,4)]` now
compiles and runs to `[null, [6, 8]]`, the interpreter answers `[NaN, (6, 8)]`
typed `list<nan | tuple<integer, integer>>`; a point list at an untyped
parameter beside another collection argument compiles and agrees with the
interpreter.)

### Extended-real declarations lose precision through a call of a function declared `function` (OPEN, low — reported by Tycho 2026-09-24; narrowed 2026-09-26)

A host declares plot variables and list seams as `real | signed_infinity | nan`
instead of `number` (Tycho, 2026-09-24), and reads `number` as possibly complex.
Arithmetic, powers, the elementary functions, `Max`/`Min`,
`Sum`/`Product`/`Mean` (with or without limits), literal lists, operations on a
scalar-or-list union, and `Abs`/`Real`/ `Imaginary`/`Arg` keep a narrow type
since 2026-09-26. What still widens to `number`: a call of a function declared
bare `function` with a union argument. A function declared with a result
`unknown` reports the result of its body under the declared parameter types, and
a declared result is used as given, but `callResultType` returns early when the
declared result is a number type. Relaxing that early return typed every call
from its body, and 17 tests failed (calls took literal value types, `g(3)` →
`integer<6..6>`, and a complex-mode compiled call lost its `_SYS.cplx` wrapper).
Under the decision of 2026-09-26 (the host that constructs a function gives its
type), the host's declaration is the intended fix, so this is low priority.

Probe: Tycho's `scripts/repros/2026-09-24-declared-type-precision-probe.mts`.

### A tuple argument at a scalar parameter is typed `any` (OPEN, small — 2026-09-26)

The call `h((1, 2))` with `h := x ↦ 2x` (declared `(real) -> real` or not)
evaluates to `(2, 4)` and is typed `any`, since the body decides the shape
(`x ↦ |x|` gives a scalar). Typing the body with the parameter typed as the
tuple was tried on 2026-09-26 and removed: the descriptor-based derivation
(`callResultType`) gave wrong narrow types for a nested user call inside a list
(`P ↦ [q(P), q(P)]`), for `P ↦ P·Norm(P)`, and for `P ↦ P/(P[1] − 1)`. A precise
type needs a tuple-aware derivation. The same holds for `Apply(x ↦ 2x, (1, 2))`.

### Ordering of constants with special functions: what stays open after the 2026-09-25 bounds (OPEN, low)

`approximate()` (`compare.ts`) propagates an error bound through `Gamma`, `Erf`,
`Erfc`, `Erfi`, `Zeta`, `Arcosh` and `Artanh` since 2026-09-25, and at machine
precision a fast path orders `f(literal)` from the machine values when the two
are farther apart than `10⁻⁶` relative. Not covered: the `Bessel` family (a
clean derivative bound exists only for an integer order, and the kernels'
accuracy is unmeasured), `LambertW`, the polygamma functions, and any tree whose
leaves are not literals on the machine fast path (`Max(1 + Γ(1/3), 3)` at
machine precision stays unevaluated; above machine precision the rigorous bound
decides it). The intervals for Γ, ζ, arcosh and artanh are computed with
doubles, so an argument within about `10⁻¹⁵` relative of a pole is refused at
every precision (`Γ(−3 + 10⁻³⁰)` against `0` stays undecided at 50 digits):
never a wrong order, a lost answer.

### `Hypergeometric2F1` at machine precision: up to 2e-11 relative error (OPEN, small — found 2026-09-28)

Over 1,000 random real arguments (`a`, `b` from −25 to 25, `c` from −25 to 45,
`z` from 0.5 to 1 or below −1), measured against mpmath, 936 have a machine
value and 5 of them have a relative error above 1e-12 (the largest 2e-11,
`Hypergeometric2F1(-8.613, 24.352, 29.789, 0.6065)`). Over 700 arguments with an
integer `b − a` or `c − a − b` and a complex `z`, 622 have a value and 9 have an
error above 1e-12 (the largest 7e-11). The connection formulas are accepted when
their two parts exceed the result by at most a factor of 1e3 (1e4 when no other
formula applies), and the prefactors are not accurate enough for that factor:
the complex `gamma()` (`numerics/numeric-complex.ts`) evaluates `t^(z + 1/2)`
directly, so `Γ(54.731)` has a relative error of 2.6e-14 (about 100ε), where the
real `gamma()` (`numerics/special-functions.ts`) shifts the argument down first
and is accurate to a few ε. A lower bound would decline more arguments. The fix
is a more accurate complex `gamma()` for a large argument (the same shift as the
real one), or a Γ ratio computed as one quotient.

### Upper incomplete gamma: where the machine kernels still decline or lose digits (OPEN — found 2026-09-28 while fixing issue #353; the region next to the poles closed 2026-09-30)

The complex kernel `incompleteGammaUpperComplex` (`numerics/numeric-complex.ts`)
returns NaN, so `Gamma(s, x).N()` stays unevaluated, where it cannot certify
about 12 digits in doubles. Its series forms carry an error estimate that bounds
the actual error (measured against mpmath on about 7500 points); where no method
passes, it declines. Next to the poles of `Γ(s)` (`s` within 0.5 of
`0, −1, −2, …`, `x` in the band `|x| + Re x ≤ 3`) the kernel now sums `Γ(s)` and
the cancelling term of its power series as one expression in `ε = s + n`: on
6000 points within 1e−9 to 0.6 of the poles down to `n = 60`, all answer, worst
error 6.2e−14. The regions that remain:

- `|Im s| > 10` and `|x| < 3|s|`, with `Re x < 0`, or with `Re s < 0` and
  `|x| < |s| + 1`. The continued fraction converges there but to a wrong value
  (error `2e−8` at `s = −0.41 − 23.9i`, `x = 0.088 − 4.0i`), and the power
  series often cancel too far. On 2500 random points with `|Re s|, |Im s| ≤ 30`
  and `0.01 ≤ |x| ≤ 600`, 68 declines are in this region. Example:
  `Gamma(19.427 + 13.838i, -8.4445 - 49.849i)`; mpmath gives
  `-2.3715013352684768e45 - 1.8981893850660706e44i`. Uniform asymptotic
  expansions for a large `|s|` would cover it.
- `|x| > 700` near the negative real axis, where only the asymptotic series is
  available, when the part of `Γ(s, x)` that it omits (about
  `2π·e^{π|Im s|}/|Γ(1 − s)|`) is not negligible, for example
  `Gamma(100 + 600i, -800)` (mpmath `4.714e−133 − 1.980e−133i`).

For a large `|s|` the accuracy is that of the complex `Γ(s)` (Lanczos formula):
the relative error of `Γ(s)` grows from about `5ε` at `|s| < 1` to `500ε` at
`|s| = 13` and `5300ε` at `|s| = 790`, and `Gamma(s, x)` inherits it (`1.1e−12`
at `s = 106 + 657i`, `x = −205 + 517i`). The per-point error estimate the kernel
returns (`incompleteGammaUpperComplexWithError`) grows with it, and so does the
cancellation check of `PolyLog`'s inversion formula (`polylogInversionComplex`,
`numerics/polylog.ts`), which declines about 6% of the complex orders with
`Re(s) < 0` past the unit disk for this reason. A more accurate `Γ(s)` for a
large `|s|` (Stirling series with the argument shifted) would tighten all three.

### Complex transcendental functions keep machine precision (OPEN, capability — decision D4 of `docs/plans/2026-09-27-big-decimal-imaginary-part.md`)

Since 2026-09-27 an inexact complex value holds its imaginary part as a big
decimal, and `Ln`, `Exp`, `Power`, `Root`, `Sqrt` and the arithmetic compute
both parts at the working precision. `Sin`, `Cos`, `Tan` and the other
trigonometric and hyperbolic functions, `Gamma`, `Zeta`, the Bessel family and
every other complex kernel still compute in doubles (`complex-esm`,
`numerics/numeric-complex.ts`) at every engine precision: `Sin(1+i).N()` at 50
digits has 16 correct digits, and an imaginary part below the double range
reaches those kernels as `0`. The fix is a big-decimal complex kernel per
function family (the real `BigDecimal` kernels exist). Also:
`e^{1152921504606846977.5 i\pi}` `.N()` at precision 50 is `4.5e-32 − i`, the
rounding of `c·π` for a 19-digit `c` at 50 digits, which is expected float
behaviour. Related, in the `e^{iθ}` Euler branch
(`boxed-expression/arithmetic-power.ts`, `halfTurns`): a large FLOAT angle is
reduced modulo π at the working precision with no extra digits, so
`e^{10^{30} i}` at 40 digits has about 10 correct digits
(`-0.99593119441358739…`, true `-0.99593119440539570…`); `BigNumericValue.exp`
called directly is correct. The reduction needs about `log10|θ|` more digits, or
a float angle above machine precision should take `exp` directly (found
2026-09-27 by the review of the big-decimal imaginary part).

### Complex eigenvalues, eigenvectors and decompositions of size 3 or more have no numeric route (OPEN, capability — found 2026-09-24 by the review of `168de97d`)

`Eigenvalues([[1, i, 0], [i, 2, 0], [0, 0, 3]])`, `Eigenvectors` of it,
`CholeskyDecomposition([[2, 1+i], [1-i, 3]])`, and `LUDecomposition` and
`QRDecomposition` of a complex matrix stay unevaluated under `evaluate()` AND
under `.N()` (before `168de97d` they answered wrong real values).
`SingularValues(...).N()` of a complex matrix of any size is computed since
2026-09-24, and `SVD(...).N()` since 2026-09-27, both through the kernel
`singularValueDecomposition(re, im)` in `numerics/linear-algebra.ts` (QR with
column pivoting, then a one-sided Jacobi pass), which returns the complex `U`
and `V`. Left open by the `SVD` change: a complex matrix of exact entries is
decomposed only under `.N()`, while a real matrix of exact entries still
decomposes to floats under `evaluate()` (`linear-algebra.test.ts` pins it);
aligning real `SVD` with the exactness contract is a behaviour change that needs
a decision. The same embedding gives the eigenvalues of a HERMITIAN matrix (run
Jacobi on the embedding itself, take each eigenvalue once; an eigenvector
`[x; y]` gives `x + iy`); a general complex matrix needs a complex QR iteration.

### Compiled colour values: keep the colour space; non-rounding conversions in `@arnog/colors` (OPEN, design — found 2026-09-23 by the review of `168de97d`)

The compiled constructors store every colour in OKLCh (`_SYS.rgb(0.2, 0.5, 0.7)`
is `{space: 'oklch', …}`), so each `AsRgb`/`AsHsv` of a constructed sRGB colour
makes an OKLCh round trip (compiled `AsRgb(Rgb(0.2, 0.5, 0.7))` gives
`0.20000000000000512`), which the snapping tolerances in
`numerics/color-conversion.ts` then correct. Fix at the cause: the compiled
constructors keep their own space, as the interpreter keeps the `Rgb` head.
Also, `numerics/color-conversion.ts` copies conversions of `@arnog/colors`
because that package rounds to integers and does not clamp HSL
(`hslToRgb(30, 1, 2)` is `{r: 255, g: 510, b: 765}`); fix it there and delete
the copies. Two symptoms of the OKLCh storage, found 2026-09-24 by the review of
`168de97d`: a same-space conversion of an ACHROMATIC colour disagrees between
the interpreter and the `javascript` target (`AsHsv(Hsv(120, 1, 0))` is
`Hsv(120, 1, 0)` on the interpreter and `[0, 0, 0]` compiled, because OKLCh has
no hue at zero chroma; 112 of 200 random achromatic inputs differ), and the
interpreter's `AsHsv`/`AsHsl` snap a saturation below `1e-9` to 0 and a hue
within `1e-9` of 0 to 0 (`ACHROMATIC_TOLERANCE`, `HUE_TOLERANCE` in
`numerics/color-conversion.ts`) only to match the compiled round trip
(`AsHsv(Rgb(0.5, 0.5, 0.5000000001))` was exact, it is now `Hsv(0, 0, …)`). The
shader helpers (`gpu-target.ts`, `_gpu_srgb_to_oklab` and neighbours) are a
third copy of the conversion math with their own f32 coefficients and an
achromatic threshold of `1e-6`. A third symptom: compiled
`ColorToString(Rgb(1, 0.5, 0))` is `#ff7f00`, the interpreter's is `#ff8000`,
because the OKLCh round trip gives a green channel of `0.49999999999999795`,
which rounds down.

### The lane question of a user call emits code and can throw (OPEN, design — found 2026-09-24 by the review of the return-lane record)

A user-function call reads the lane its emitted definition recorded
(`userCallLane`, `recordUserFunctionLane` in `compilation/base-compiler.ts`). A
parent lowering asks for the lane of an operand before it compiles the operand,
so the question emits the definition on demand, which needs a global
`_callSiteTarget`, a per-call route memo, and pruning of definitions the
question emitted but nothing uses; `isComplexValued` can therefore write
definitions and throw user-facing diagnostics. Cleaner: in `compileExpr`, before
a lowering reads the lanes of its operands, emit the definitions of the
user-function calls among its direct operands with the current target and
frames; then `userCallLane` only reads the record, and the global, the route
memo, the ask-time pruning and the throws inside the predicate go away.

### A point argument with a complex-valued coordinate declines where the interpreter answers a real number (OPEN — found 2026-09-15 in the Tycho corpus document `neyret/hpr2q4kles`)

`P_0(M_0, D, d, e_0, a, T_0, r_0) = l(d_{iv}(r(M_0, -a) - C(D, d), A(e_0))) - (D + d) / 2`
with `A(e_0) = (1, \sqrt{1 - e_0^2})` and `l(V) = \sqrt{V.x^2 + V.y^2}`. Under
the default `auto` discipline the square root of `1 - e_0^2` (an unknown-sign
parameter expression) promotes to the complex kernel, so the inlined `d_{iv}`
hands `l` a point whose second coordinate is a `{re, im}` object. The emitted
`_fn_l` reads a point parameter's coordinates as plain numbers, so the call used
to answer `NaN` behind `success: true`; it now fails closed at that call
(`compile-point-complex-coordinate.test.ts`). The interpreter answers 1.024 for
the document's eccentricities (all below 1).

The correct lowering needs the inline substitution to read through the
return-type ascription an inlined helper leaves around its point
(`Typed(PointList(…), '…')`) AND the enclosing arithmetic's lane analysis to see
the inlined body instead of the call node — removing the wrapper alone was
measured to concatenate a string (`"-0.39[object Object]"`), because the
enclosing `Add` had analyzed the call as real. The lane analysis of a call whose
written-out point argument carries a complex coordinate is already answered from
the substituted body (`isComplexValuedUserCall`); extending that reading to the
ascription-wrapped case, and making the substitution accept it, is the remaining
work.

Measured again 2026-09-15 in a CE-only replica of the document (every helper
declared with the signature the Tycho manager derives, then assigned its lambda;
`x` and `y` declared `number`; the field macro `U` written out as `(x, y)`): the
row `P((x, y), 0.47, …) = 0` declines at this same `Add` under BOTH
point-parameter declarations — the three-arm union with the
`indexed_collection<number | tuple<…>>` arm and the two-arm
`tuple<…> | list<tuple<…>>`. Every helper compiles when its point argument is
written out at the call (`r((x, y), 1)`, `l(r((x, y), 1) - (x, y))`,
`d_iv(r((x, y), 1) - C(1, 2), A(0.5))`); only `P_0((x, y), …)` and
`P_1((x, y), …)` decline, inside their bodies. So the earlier statement to Tycho
that the two-arm parameter declaration makes these rows compile was a prediction
from the decline reason, not a measurement, and it was wrong: the parameter
union is not what blocks this document. The arithmetic type of a
point-or-point-list operand (`P / 2` typed a nested list of the union) was a
separate defect and is fixed (`point-union-arithmetic-type.test.ts`); the
replica still declines after that fix.

### A tuple-or-number-list union nests through the broadcast type wrapper (OPEN — found 2026-09-15)

A symbol declared `tuple<number, number> | list<number>` and left valueless
types `2V` as `list<list<number> | tuple<…>> | list<number> | tuple<…>`, a
nested union no value has: the broadcast type wrapper re-wraps the handler's
union answer around the operand's list arm. The same defect for a
POINT-or-point-list union (`tuple<…> | list<tuple<…>>`) is fixed
(`point-union-arithmetic-type.test.ts`), by returning the handler's answer when
every collection arm on both sides holds points. That scoping is deliberate: a
union with a list of numbers beside a tuple cannot be told apart, at the
wrapper, from a declared per-element result that merely mentions a number list
(`tuple<…> | list<number>` as the cell of a lifted operator), which must be
wrapped. Fixing this case needs the wrapper to know that the handler already
computed the lift (an explicit exemption label on `Divide`, which does not carry
`collection-result` today, or a per-handler signal). No document in the audited
corpus declares such a union.

### A product of two point-or-point-list operands claims a number (OPEN — found 2026-09-15)

With `P` and `Q` declared `tuple<number, number> | list<tuple<number, number>>`
and left valueless, `P \cdot Q` types `list<number> | number`, while the same
product of two plain `tuple<number, number>` symbols types `error` (a point has
no product with a point). The `Multiply` type handler's point branches skip the
case (two could-be-tuple operands and no separate scalar or collection factor),
so the scalar tiers below claim a number for a value the evaluator refuses. The
honest claim is the same `error` the tuple pair receives, or `never`. Low blast
radius: no document in the audited corpus multiplies two point-shaped operands.

### Coordinate projection through point arithmetic: what stays open (OPEN, compile performance — found 2026-09-19 while implementing item 1 of `docs/plans/2026-09-19-codegen-reassessment-ce1313.md`)

The pre-pass (`foldPointAccessor` in `compilation/fixed-width-unroll.ts`) now
rewrites `PointX(p + k·[points])` to `PointX(p) + k·[first coordinates]` when
the list of points is written out and has five or more elements. Two shapes are
left as they were.

**1. The interval target writes a constant list of numbers out element by
element, with no upper width.** The element-wise rule of the pre-pass
(`distributeOverList`) has a lower width limit and no upper one, and the
interval target turns it on for constant lists
(`UnrollOptions.unrollConstantLists`). Measured on the unchanged tree:
`Sin(x + 4·[2,000 numbers])` compiles on `interval-js` to a 60,876-character
body, where the same arithmetic over a list of 2,000 POINTS compiles to a
307-character body that reads a table bound once per artifact
(`_IA.bcastPoint`). For that reason the new projection rule is withheld on that
target when any list of points in the arithmetic has a number literal at the
coordinate being read in every point (`isPointArithmeticOverWideList`); without
the exception the 7,225-point witness grew from a 413-character interval body to
a 202,510-character one.

An experiment gave the fan-out of a constant list an upper limit of 100 elements
(the value of `INTERVAL_UNROLL_LIMIT`). At 150 elements, the interval bodies of
`Sin(x + 4·L)`, `Max(x + 4·L)`, `Sum((M − x·L)²)`, a run-time index into
`x + 4·L`, and `x·L + M` went from 3,075–8,671 characters to 113–338, with
identical enclosures. One shape regressed: `Reduce((M − x·L)², Add)` declined,
because the `Reduce` lowering of that target only accepts the written-out list
the fan-out produces. The limit was not landed: it changes which interval rows
compile, and the plan asks for a new whole-corpus baseline before another broad
lowering change. To land it: give the interval `Reduce` lowering a run-time list
operand (or keep the fan-out under `Reduce`), apply the limit, and then remove
the constant-list exception from `isPointArithmeticOverWideList`.

**2. A list of points that is a symbol, not a written-out list.**
`PointX(4·P + 0.3·(t, t))` with `P` declared `list<tuple<number, number>>` still
builds every transformed point and maps over them twice (records 687 and 688 of
the targeted audit, `woeywky0kj` setup rows). The rewrite needs a fourth leaf in
`coordinateAndArity`: an operand whose TYPE is a list of points, to which the
accessor is re-applied (`4·PointX(P) + 0.3·t`). The open questions are the width
floor — the rule cannot see the width of `P`, and a narrow list is a native
vector on the shader targets — and a `P` whose type is the union of a point and
a list of points, where `PointX(P)` dispatches at run time.

### The Tycho corpus document `s8ishknvhe`: what stays open after the mixed-cell and pole round (OPEN — found 2026-09-19; item 3 of `docs/plans/2026-09-19-codegen-reassessment-ce1313.md`)

The round (in `CHANGELOG.md`) made a broadcast head read a list that mixes
complex and real cells, and made the compiled complex arithmetic of the
JavaScript target answer a pole as the interpreter does. The stereographic
projection of the document (audit record 146 of
`/private/tmp/ce-codegen-reassessment-0919/ce-0.131.3-targeted.json`) now
compiles when its point list `C_c` is declared
`list<tuple<number, number, number>>`. Three things stay open.

1. **With `C_c` undeclared, the body still declines.** Its type is then
   `broadcastable<tuple<broadcastable<number>, …>>`, a value that may be a
   scalar or a collection at run time, and the lane analysis of the broadcast
   closure refuses such an operand when it has complex evidence
   (`_operandElementLane` in `compilation/base-compiler.ts`, the
   `isBoundPossiblyCollectionTyped` case, pinned in
   `test/compute-engine/broadcastable-compile.test.ts`). The reason given there
   is that a scalar binding of a complex-typed parameter is refused at the entry
   of the compiled function, so compiling the array case would trade a decline
   for a run-time error. Whether Tycho declares `C_c` with the narrow type is a
   Tycho question; on the CE side the refusal could be revisited now that a
   mixed cell is read through `_SYS.cplx`.
2. **The second decline of the document is a chain of gates under
   `mode: 'complex'`, of which three are understood.** The row is the colour of
   the point cloud, `AsOklab(c_f)` with
   `c_f = Hsv((180/π)·PointX(A_rg(C_cf)), Min(1, 2 − 2·PointZ(C_cf)), Min(1, 2·PointZ(C_cf)))`
   and `A_rg(p) := (Arg(p.x + i·p.y), Arccos(2·p.z − 1))`. It compiles under
   `mode: 'strict'` and `'auto'` and declines under `'complex'`, the mode Tycho
   compiles it in. Repro without Tycho: assign `A_rg` as above, declare
   `C: list<tuple<number, number, number>>`, and compile
   `Hsv(57.29·PointX(A_rg(C)), 1, 0.5)` with `mode: 'complex'`. The gates, in
   the order the row meets them (measured 2026-09-20 on Tycho's route, each with
   a trial fix that let the row reach the next one):
   - **A coordinate read inherits the verdict of the whole point.** Under
     complex mode `Arccos` of a value of unknown range is complex-valued, so the
     pair `A_rg(p)` is, and `isComplexValued(PointX(A_rg(C)))` answers `true`
     although `PointX` reads `Arg(…)`, which is real. The hue then has complex
     evidence and a possibly-collection type, `operandElementLane` answers
     "undecided", and `Hsv` declines. Trial fix: an arm in
     `_isComplexValuedFunction` (`compilation/base-compiler.ts`) beside the one
     for `At`: a point accessor over ONE point whose coordinates can be seen (a
     `Tuple`, or a call of a user function whose body is a `Tuple` or a
     `PointList`) answers from that coordinate. Tycho's converted `A_rg` builds
     its point with `PointList`, whose operands are not provably numbers, so
     `collectionConstructorBody` must accept any `PointList` for this question.
   - **`PointList` refuses a component typed `list<number> | number`.**
     `compileJSPointList` (`compilation/javascript-target.ts`) has a run-time
     role test (`Array.isArray`) for a `broadcastable<number>` component, and
     throws "neither a scalar slot nor a list source" for the union that means
     the same thing — the type a coordinate read has when its point may be one
     point or a list of points. Trial fix: admit a union whose every member is a
     scalar number type or an indexed collection of scalar numbers, with no
     tuple member, to the same run-time test.
   - **An ordering over `|1/Conjugate(…)|` is refused as complex-valued.** Not
     traced: `Less` declines with "an ordering comparison over the
     complex-valued operand" for an `Abs`, which is real by definition. The
     stereographic projection of the same document has the same comparison and
     compiles, so the difference is in the operand's shape here (`C_cf` is the
     fully expanded `S(f(N(F(0))))`).
   - In the repro without Tycho, the first fix moves the decline to `Argument`
     ("a broadcastable head over a possibly list-valued operand"), which is the
     refusal described in item 1. None of the trial fixes was landed: no route
     yet compiles the row to a value that can be compared with the interpreter.
     A separate observation for Tycho, not a Compute Engine defect: `Min(1, L)`
     with a list `L` is a REDUCTION in Compute Engine (it answers one number, in
     the interpreter and compiled alike), so the saturation and the value of
     `c_f` are one number for the whole cloud. If Desmos evaluates `min(1, L)`
     element by element, the conversion of that row needs an element-wise form.
3. **The other targets were not examined at a pole.** The shader targets and the
   Python target have their own complex division and power. Python raises
   `ZeroDivisionError` for a complex division by zero; the shader result is
   whatever the hardware answers for `0.0 / 0.0`. The kernels of the JavaScript
   runtime were checked at an exact zero argument only, which is the one pole a
   floating-point argument reaches exactly.

### Every call of a user function invalidates every generation-keyed cache (OPEN, caching design — found 2026-09-22)

`invoke` → `declareParameterActivation` declares the function's parameters in a
new activation scope, and the `declare` state event advances the `any` cache
axis. So any value cached against `ce._cacheGeneration()` misses after any
user-function call in between. Example: `Apply(Derivative(f, 3), x).N()` at
several points computes and simplifies the derivative again at each point. A
declaration into an activation scope could be marked `scratch` (advances no
axis), but a value can outlive its activation, which is the soundness question
discussed in the `declare` case of `axisMaskOf`
(`engine-configuration-lifecycle.ts`). User decision (2026-09-23): yes, make
activation declarations `scratch` once the soundness check passes.

Soundness check (2026-09-23): it FAILS. With every activation declaration marked
`scratch`, three tests of `lambda-param-collection-inference.test.ts` overflow
the stack: `countdown(xs)` with the body
`if Length(xs) == 0 { 0 } else { 1 + countdown(Rest(xs)) }`, and the two
mutual-recursion tests. The body node `Length(xs) == 0` is shared by every call,
and its value cache is keyed on the generation; with no advance per call, the
second call reads the first call's answer (4), so the base case is never
reached. The type and sign of a body SYMBOL are safe (its definition is fixed
when it is boxed), but a cached answer of a compound body node can read the
call's values through `_contextValue()`. Other probes (sign-dependent bodies
with alternating signs, `Simplify`, `D`, `N`, `Integrate` in a body, a returned
closure) gave the same answers with and without the change, and the rest of the
suite passed. The gain is also smaller than expected:
`item-284-derivative-compile-cost.test.ts` took 20.6 s instead of 22.9 s (one
run each, under load). A sound version needs the caches of a body node to depend
on the call: for example a per-activation stamp in the key of the value and
facet caches of a node that reads a parameter, or an axis that only activation
declarations advance.

Measured 2026-09-24 at MACHINE precision (the precision of a Tycho plot
document; an upper bound, with the unsound `scratch` change applied in a
worktree, same answers except the known recursion case): removing every
activation advance saves nothing measurable on realistic interpreted workloads —
a `g`, `h`, `k` chain at 1,000 points 119 → 124 ms, a list broadcast 14 → 15 ms,
the noise functions of Tycho document `hyvhlz4chj` on a 20×20 grid (18,820
calls, 24,020 advances) 465 → 442 ms (5%) — because the recomputations the
advances cause are cheap. It saves 30% on a list recursion (77 → 52 ms) and
about 78% on `Apply(Derivative(f, 3), x).N()` at 100 points (255 → 56 ms), where
the closed form is re-differentiated and simplified at each point. Decision
taken on this measurement: no general per-call cache design now; instead (a) key
the derivative closed form on the definition of `f` rather than on the `any`
axis, and (b) reduce per-call costs. The machine precision profile of the Tycho
case (40×40 grid, top self time): development- only `console.assert` calls 8.0%,
`viewOfExpression` (from the broadcast check `skipBroadcastForVectorOps` in
`evaluate`) 7.4%, a V8 built-in 5.7%, garbage collection 5.1%, then `isSubtype`,
`lookup` and `declareParameterActivation` at 1–2% each; no big-decimal
arithmetic (an earlier profile at the default 21 digits showed it, because the
benchmark used a bare engine).

Done 2026-09-24: item (a), and the broadcast check of item (b). The finished
closed form of `Derivative(f, n)` (`symbolic/derivative.ts`) records the
definitions and `_writeVersion` of the symbols its simplification reads, and
stays valid across the per-call `any` advances while the semantic version, those
definitions and the assumptions-hidden bit are unchanged (100 points 326 → 77
ms, 1,000 points 1,936 → 158 ms). `skipBroadcastForVectorOps` returns before it
builds operand views when the operator declares no broadcast exemption (the
Tycho case 1,465 → 1,264 ms at 40×40). Still open: the cost of each parameter
declaration (`declareParameterActivation`), and the general per-call cache
design (not worth it, measured above).

### Rubi 1.2.2.4 #214 reaches the 30 s guard in the rule matcher (OPEN, performance — found 2026-09-24)

After the polynomial GCD fix, one problem of a 200-problem chapter-1 sample
(`--sample 200 --seed 14`) still reaches the 30 s wall-clock guard: 1.2.2.4
#214, unsolved after about 80,000 steps. Its profile has no time in the GCD: the
time is in the rule matcher (`match.ts`), garbage collection, and about 3.6 s of
`console.assert` calls in the `ExactNumericValue` constructor
(`exact-numeric-value.ts`) and near `get isCollection`. The production build
strips `console.*`, so that part is a cost of development and test runs only;
the matcher time is real. The other guard problems of chapters 2–7 were not
re-measured; measure them before shortening the guard. Also: the
`.sub()`/`.add()`/`.div()` methods fold exact radicals to floats (`√2 − 2` →
`-0.5857…`); `polynomialDivide` no longer uses them on coefficients, but
`makeMonic` (`.div()`), `resultantRec` and `polyDivide` in `rubi-utils.ts` were
not audited.

### Slow operations and slow tests found by a review of the slowest test files (OPEN, performance — found 2026-09-22)

The sample cache of complex integrands, the NaN stop in adaptive quadrature, the
derivative cache, the nested-quadrature test budget, the GLSL loop test, the
Rubi rule-pack loads in tests and the Monte Carlo cost of
`derived-substreams.test.ts` were fixed on 2026-09-22. What stays open:

- **Compiled complex arithmetic is about 10 times slower inside jest than under
  tsx.** One `_SYS.cpow(Math.E, {re: 0, im: x})` call takes about 1.5 µs in jest
  and 0.15 µs under tsx, probably because jest runs the code in a separate `vm`
  realm. `measurement.test.ts` makes 2 × 1e7 such calls and takes about 40 s.
- **The adaptive quadrature stops when all panels are NaN, there are at least
  16, and a bisection gave two NaN children** (`ALL_BAD_STOP_PANELS` and
  `mustStopAllBad` in `numerics/gauss-kronrod.ts`). Isolated removable
  singularities move to panel boundaries when their panel is bisected, so they
  still converge, also when there is one at the center of each of the 16
  starting panels. An integrand that is finite only on a region narrower than
  1/16 of the interval now answers NaN where the old loop could find a finite
  value. No test covers this case.

### Reductions over ten thousand elements: what is left outside the interpreter's arithmetic (OPEN, evaluation performance — measured 2026-09-20, revised 2026-09-21)

Found while looking at `Min(1, 2 − 2·PointZ(C))` over ten thousand points, the
colour row of the Tycho corpus document `s8ishknvhe`, which Tycho interprets
today (the row declines to compile, see the entry for that document). At machine
precision that expression is now 5 ms under `evaluate()` (it was 219 ms on
2026-09-20): written-out data evaluates to itself, the coordinates are read into
a list of unboxed doubles, the arithmetic runs on doubles, and `Min` scans them.
What is left:

- **At the default precision each element is computed with `BigDecimal`**, about
  12 µs per element (`add` → `nvSum` → `BigDecimal`). The derived `array` of a
  list of such floats is also slow to build (8–15 ms), because each float is a
  big-number value that is checked by boxing its machine value again
  (`machineNumberOf`).
- Smaller, measured and not built: on the JavaScript target `Min(1, L)` copies
  its operand (`[1, ...L]`) and `Min(L, M)` copies both (0.22 ms against 0.07 ms
  for `Min(L)` at ten thousand elements); a seeded `reduce` would not copy.

For Tycho, not a Compute Engine defect: its lowering of Desmos `min`/`max` with
two or more arguments to `ElementMin`/`ElementMax`
(`elementwise-extrema-lowering.ts`) did not reach that colour row: the engine
received the reducing `Min(1, …)`, so the saturation and the value of the colour
are one number for the whole cloud.

### Residue of the Tycho code-generation audit of 2026-09-08 (OPEN — the audit's C1, I2, J1/G1, G2–G9, J4–J9 items landed 2026-09-08)

The audit
(`~/dev/tycho/_TASK/desmos/desmos-corpus/codegen-audit/2026-09-08-report.md`, CE
0.126.2, 862 records over 71 documents) was worked in eight slices; what follows
is what the slices measured and did not change. Each line names the decision or
the work that remains.

- **Interval-js library residue after outward rounding (2026-09-08).**
  `integrate.ts` keeps its `widen()` margin for the partition widths, with a
  deliberate factor of three; the composed hyperbolic and reciprocal routines
  are built from unrounded kernels and take one step at their own export, except
  `remainder`, whose three-operation composition takes three.
- **Identity lowerings that return their operand's code, other targets.** The
  JavaScript handlers were fixed this round (`identityPassthrough`,
  `javascript-target.ts`). The same pattern — `return compile(op)` spliced bare
  into an infix parent — is likely in `python-target.ts` and `gpu-target.ts` and
  was not checked; the arithmetic passthroughs of the JavaScript target
  (`Add`/`Multiply` with one operand left after filtering identities,
  `Power(x, 1)`, `Divide(x, 1)`) are reachable only from non-canonical input,
  and non-canonical `Multiply(3, Multiply(Add(x, 1)))` emits `3 * * _.x + 1`, a
  syntax error. One sweep across the three targets, or threading the caller's
  precedence into `OperandCompiler` (it compiles at precedence 0 today), closes
  the family.
- **Audit item J3 is not reproducible at HEAD.** The 496 `_SYS.bcast` sites over
  user-function results needed the call to type top; every construction tried
  (assign, declared `-> unknown`, `Block`, `If`, `Which`, piecewise) types
  `number` at HEAD — the Block analysis moved to value-before-type on
  2026-09-08, after the 0.126.2 run. The constructed-scalar arm added this round
  is a guard for weaker inference. Re-run the audit against HEAD before spending
  more here.
- **`Sum(At(P, Range(a, b)))` materializes the range.** The 24 `Array.from`
  range sites in the corpus are all places where the range is needed as a list
  (7 gather indices, 15 spread elements, 2 broadcast operands); a counting loop
  has no site. The 7 gather sites would take a gather/reduce fusion in
  `emitCollectionReduce` (`javascript-target.ts`) — a new lowering.
- **GLSL `fract` and `exp2` apply to scalar operands only.** The peepholes
  consume an operand, so the emitted call has fewer arguments than the head has
  operands and `gpuCheckOperandShapes` declines a vector (`Mod(v, 1)` stays
  `mod(v, 1.0)`). Teaching the gate about operand-consuming lowerings
  (`markAggregateConsuming` exists) lifts the restriction.
- **GPU literal spelling.** Folded GPU literals are spelled with the full double
  `toString` through `formatFloat` (`0.00015625001105945557`); the shortest
  float32 round-trip spelling would be about 9 digits and shrink shaders
  further. `formatFloat` is shared by every GPU emission.
- **Audit item J6a (the 200-character index lambda, 211 sites) is Tycho's.** The
  lambda is emitted by Tycho's own `At` override
  (`~/dev/tycho/src/graph-paper/graph/at-index-semantics.ts`, `atDef.compile`),
  not by the engine. Its semantics differ from `_SYS.at` (no
  negative-from-the-end indexing; a per-position absence marker for a list
  index). The engine now ships `_SYS.atNoWrap(base, index)` with exactly the
  lambda's semantics; the 42 KB is recovered when Tycho's override calls it.
  Hand off to Tycho.
- **Audit item I4 (interval piecewise arms as per-call closures; the `Sum` bound
  read through an inline shape probe) was not worked** this round.
- **A record reaching an `unknown`-typed parameter through a callback value is
  broadcast over its fields.** The broadcast-aware wrapper a function value
  receives decides with `Array.isArray`, and a record, tuple or nominal value
  lowers to a bare JavaScript array. A parameter TYPED as one of those keeps the
  bare reference (`signatureParamsLowerToScalars`, `base-compiler.ts`); a
  parameter left `unknown` is admitted, as the interpreter's own broadcast gate
  admits it, so `Map(f, persons)` with an unannotated `f(p)` would map over each
  person's fields. Objects have no compiled representation yet, so no corpus
  reaches this; recorded so the gate is tightened when they do.
- **The broadcast wrapper around an inline function literal is wider than
  callback position.** The `Function`-literal lowering cannot see its parent, so
  the wrapper also lands on a block-local definition (`let g = (k) ↦ …`, whose
  call sites are already broadcast-aware), on an `Apply` head (`\sin'(x)`) and
  on a whole-artifact function result. Redundant, not wrong: one extra call
  frame and one `Array.isArray` per call. Narrowing it means moving the wrap
  into the callback funnel of `javascript-target.ts` (`hoistedCallbackLambda` /
  `fnArg`), which was carrying a peer's in-flight work when this landed
  (2026-09-08).
- **A partly nested source diverges between the routes.** With
  `k(L: list) := Map(f, L)` and `f: (number) -> number`, the interpreter types
  the whole source `[[1, 2], 3]` as a union a scalar satisfies and broadcasts
  each row (`[[2, 4], 6]`), while the compiled reference tests one element at a
  time and answers `[NaN, 6]` — the ruling of 2026-09-08 (a declared-scalar
  callback refuses a collection element) spelled per element. A per-element test
  cannot reconstruct the source's type; documented in
  `docs/COMPILATION-MODEL.md` § Collections.
- ** RULED 2026-09-22 (a): `Map` broadcasts per row like a direct call,
  `[[2, 4], [6, 8]]` on both routes.An accepted hoist binding can be left unread
  on GLSL.** For `\sum_{i=1}^{200}(i x + \min([1,2,3]))` the list literal is
  hoisted as its own class (`vec3 _tv2 = vec3(1.0, 2.0, 3.0);`) and the `Min`
  class then folds to `1.0` without reading the override, so the declaration has
  no reader. Valid shader source (dead code the driver drops), not a miscompile.
  The fix is in the hoist contract or in `gpu-target.ts` (the caller writes the
  declarations into the returned string), found by the review of this round.
- **Plain arithmetic over a captured symbol whose scalar type was inferred does
  not broadcast at run time.** `compile(2y)` emits `2 * _.y` and
  `run({ y: [1, 2, 3] })` answers NaN where the interpreter answers `[2, 4, 6]`.
  This is the compile target's standing contract for a free symbol (a number
  unless typed as a collection), not a regression of this round; the
  user-function call guard covers only call sites. Recorded so the contract is
  decided knowingly if a consumer asks.
- **Not this round, noted by the slices:** `vars: { g: '…' }` does not override
  a user-function head — the call still emits `_fn_g` from the engine definition
  (head resolution); `ColorMix((1,0,0), (0,0,1), 0.5)` compiles the tuples as
  OKLCh components, which may not be the intended reading of a bare tuple
  (colour lowering owner); compiled `\arg(x - iy)` at `x = -3, y = 0` is
  `atan2(-0, -3) = -π` where the interpreter answers `+π` (pre-existing
  signed-zero seam); JavaScript unrolled sums below four terms have no statement
  form and do not hoist; the Python target does not hoist at all.

### Open items from the small-fix release batch (2026-08-31)

- **Past the exact-expansion caps a few Γ-ratio points stay symbolic**:
  `Pochhammer(a, k)` with both `Γ(a)` and `Γ(a + k)` on a pole and `|k| > 20`
  (`SYMBOLIC_EXPANSION_CAP`), and `GammaRegularized(n, z)` for `z < 0` and
  `n > 20` (`MAX_GAMMA_Q_SERIES_ORDER`). Honest gaps, never `NaN`.

- **A matrix p-norm for `p ∉ {1, 2, ∞}` stays inert.** The order passes the
  declared precondition (it is a well-formed order at rank 1) and the operand is
  inside the carrier, but the general matrix p-norm has no closed form and would
  need a numeric kernel. (The Frobenius norm of a rank ≥ 3 tensor, which was
  inert for the same structural reason, is computed now.)
- **A compiled `Norm(v, 0)` answers `NaN` where the interpreter answers the
  precondition error.** An `Error` has no float representation, and `NaN` is the
  documented compiled spelling for "no value" (the compiled `If`/`Which`
  ruling), so the lane degrades the error to `NaN` rather than refusing to
  compile a whole program for one bad order. Recorded, not planned.

### The interpreted growing-list loop stays quadratic (OPEN, no urgency — recorded 2026-09-04)

`let xs = []; for k in 1..n { xs = Join(xs, [k]) }` costs about 0.5 µs per
element per turn on the interpreter since the literal-list fold of 2026-09-04
(857 ms at 1000 turns; the compiled route was already a native array copy per
turn): an immutable append copies the list. Levers not taken, for a later round
if interpreted loops of many thousands of turns matter: a growable backing
buffer with prefix views (amortized O(1) append, safe without ownership analysis
because every holder of an older value keeps its own prefix) paired with an
incremental type for the new node, and a per-node descriptor cache on the type
cache's invalidation axis.

### Open items from the undecided-condition ruling (2026-09-02)

The ruling ("a compiled `If`/`Which` whose condition is not exactly `true` or
`false` at run time takes no branch") is implemented for the JavaScript-family
lowering of both the expression form and the statement form
(`BaseCompiler.conditionDecidability`), and the interpreter agrees since
2026-09-03. One deliberate non-alignment remains.

- **The GPU targets keep JavaScript-style selection.** Python IS aligned: its
  `If`/`Which` entries share the compiler's decidability analysis and answer
  `float('nan')` for an undecided condition (`compilePythonBranch`,
  `compilation/python-target.ts`). GLSL and WGSL are deliberately NOT aligned —
  the rule answers with NaN, and NaN propagation is not guaranteed on every
  driver (a shader compiler may assume operands are never NaN under fast-math,
  which is why the shader targets already omit the `isAbsent` capability), so a
  NaN-valued no-branch answer cannot be relied on there. Interval-JavaScript
  lowers `If` to its own `_IA.piecewise` helper and is unaffected. `When` keeps
  the truthiness test on every target: it is not a two-armed selection, so the
  ruling has no arm to withhold.

### Doc-sweep triage (2026-08-29)

Found by checking published examples and reference prose against the engine,
closing out the doc sweeps of the numeric-lattice migration. Each item was
measured on the main tree at that date. The items the same round FIXED —
`Count`'s dishonest `integer` result, the `(number)` carriers on
`Totient`/`Divides`, and `Which`'s odd-arity operand count — are not listed
here.

- **Clause sets that dispatch on `infinity`, `nan` or `non_finite_number` do not
  compile (OPEN — the decline was ruled 2026-08-29, its re-admission REFUTED by
  measurement 2026-08-30).** Compiled float arithmetic does not preserve a pole:
  the interpreter's `~oo - ~oo` is `~oo`, compiled it is `Infinity - Infinity`,
  which is `NaN`, so a guard on a produced value asks a different question than
  the interpreter's — on `g(a: infinity) = 1; g(x: number) = 0`, compiled
  `g(1 / w - 1 / w)` at `w = 0` answers 0 where the interpreter answers 1.
  `jsClauseParamGuard` (`src/compute-engine/compilation/base-compiler.ts`)
  therefore declines the whole clause set for those tiers and for the non-finite
  VALUE types, and the set runs interpreted (pinned in
  `test/compute-engine/multi-clause-compile.test.ts`). Restoring compilability
  is not a guard problem: it needs either a float encoding in which a pole
  survives arithmetic as a pole, or a compiler that refuses to fold a pole into
  a plain JS number at all. The narrower open question: a `~oo` ARGUMENT now
  projects to `Infinity` at the compiled boundary (`isUnsignedPole`,
  `javascript-target.ts`, 2026-08-30), so compiled `Heaviside(x)` at `x = ~oo`
  answers `1` and compiled `x > 0` answers `true`, where the interpreter leaves
  both unevaluated — both previously threw; whether those two divergences are
  acceptable is undecided.
- **`.value =` does not infer a symbol's type, while `ce.assign()` does.**
  `doc/04-guide-symbols.md:19-27` promises inference and uses `n.value = 5` as
  its live example. Measured: after `ce.expr('n')` then `n.value = 5`, the type
  is `unknown`; after `ce.assign('n', 5)` it is `integer` (and `assign` refines
  even when the definition already exists). The setter ends at
  `ce._setSymbolValue`
  (`src/compute-engine/boxed-expression/ boxed-symbol.ts:811`), and
  `setSymbolValue` writes only `def.value.value`, never `def.value.type`
  (`src/compute-engine/engine-declarations.ts:654`); `assignFn` instead either
  declares with inference (`engine-declarations.ts:2584`) or runs its explicit
  inferred-type update just below `assertAssignableValueDef`. Worse than a
  missing inference: the setter can leave the declared type INCONSISTENT with
  the held value — after `ce.assign('m', 1)` (type `integer`),
  `m.value = ce.string('hi')` leaves type `integer` holding `"hi"`.
- **`assume(t ∈ ExtendedRealNumbers)` answers `ok` but leaves `t: unknown`.**
  `RealNumbers` gives `real`, `Integers` gives `integer`, `ComplexNumbers` gives
  `complex`; `ExtendedRealNumbers` and `ExtendedComplexNumbers` give `unknown`,
  and `t.isReal`/`t.isNumber` stay `undefined` — though the structural fact IS
  recorded (`Element(t, ExtendedRealNumbers)` evaluates `True`). Cause:
  `domainToType` (`src/compute-engine/boxed-expression/ utils.ts:574-585`) is a
  hardcoded six-entry table with no extended-set entry, falling through to
  `return 'unknown'`; it is called from `assume.ts:1083` and `assume.ts:1126`.
  The right type is already available two ways — the set definition declares
  `set<real | non_finite_number>` and its `elttype()` returns
  `EXTENDED_REAL_TYPE` (`src/compute-engine/library/sets.ts:298-312`).
- **Else-less `\keyword{if}` does not parse to `If`, and fails silently.**
  `doc/07-guide-latex-syntax.md:298-300` says the `else` branch is optional.
  Measured, `\keyword{if} x > 0 \keyword{then} x` parses to
  `["Less", ["Text", 0, "'then'", "x"], ["Text", "'if'", "x"]]` — the keywords
  degrade to ordinary text juxtaposed with the operands — and it reports
  `isValid: true`, so nothing signals the failure. Cause: `parseIfExpression`
  makes `else` MANDATORY
  (`src/compute-engine/latex-syntax/dictionary/definitions-core.ts:5220`,
  `if (!matchKeyword(parser, 'else')) return null;`); the `null` aborts the
  whole `if` build and the parser backtracks. The true-branch parse at `:5213`
  also terminates only on `else`, so recognizing an else-less `if` needs a
  second termination condition. Separately, the operand-order note at
  `doc/07-guide-latex-syntax.md:295` is wrong: it shows
  `["If", ["Greater", "x", 0], …]`, but the snippet reads `.json` off the
  CANONICAL parse, which measures `["If", ["Less", 0, "x"], …]` —
  canonicalization rewrites `Greater(x, 0)` to `Less(0, x)`. The `Greater`
  spelling appears only under `{canonical: false}`.
- **A qualified protocol call on an UNDECLARED protocol name throws instead of
  erroring.** The reported symptom `Comparable.compare("a", "b")` → "expected 1,
  got 2" does NOT reproduce for the documented form: with the protocols declared
  as `src/epsil/docs/protocols.md:153-170` does, `Comparable.compare("a", "b")`
  answers `"<"` and `Comparator.compare("a", "b")` answers `-1`, exactly as
  documented. It reproduces only when `Comparable` is undeclared, and then the
  failure mode is bad. The parse is correct
  (`["Apply", ["Field", "Comparable", {"str": "compare"}], "a", "b"]`), but
  `Field`'s handlers key off the protocol registry (`protocolOfSymbol`,
  `src/compute-engine/library/collections.ts:6147` and `:6195`), an unregistered
  name falls through leaving a free undeclared symbol, and
  `canonicalFunctionLiteral` then LIFTS that symbol into an implicit parameter —
  making the callee the unary lambda
  `("Comparable") => Field("Comparable", "compare")`, which rejects two
  arguments. On the raw engine route it THROWS out of `invoke`
  (`src/compute-engine/function-utils.ts:2761`) rather than returning an error
  value. Wanted: an unknown protocol name should say so.

### Fungrim Stage-2 residues: `Fibonacci` growth class, the corpus manifest fork id, `CartesianPower` (OPEN, low — Stage-2 triage of 2026-08-29)

**Left from the Stage-2 triage of 2026-08-29.** (With the deadline restored,
Stage 2 finished in 47 s and reported 16 False instances in 6 entries. The
defects it found are fixed: the `leadingOrder` rewrite in `symbolic/limit.ts`
that turned `Fibonacci(n+1)/Fibonacci(n)` into `1`, `Integrate(…).N()` dropping
the imaginary part of a complex integrand, the upstream statement of
`π = Σ n!/(2n+1)!!` in entry `419b45` — the sum is π/2 — and the translator's
elementwise reading of Fungrim's Cartesian power in entry `4099d2`.)

- `Limit(Fibonacci(n+1)/Fibonacci(n), n→∞)` stays an inert `Limit` (no growth
  class for `Fibonacci`); resolving it to φ needs a growth level for
  exponential-class special functions — OPEN, low.
- A Compute Engine `CartesianPower` operator would make entry `4099d2`
  evaluable: `grim2mathjson` emits the shell `CartesianPower(S, n)` for a
  set-based `Pow`, so the entry is `not-evaluable` instead of False — OPEN, low.

### A re-declared operator carrying a caller `compile` handler switches off the compiler's call-sharing (OPEN, design — measured 2026-08-21 under Tycho item 217)

`R(i,x,y) = R(i-1,x,y) + 0.5·S(x,y,R(i-1,x,y))` compiles to a linear artifact on
a stock engine (the CSE harvest binds the repeated self-call: 0.03 ms/call at
depth 18), and stays linear when a `compile` handler is attached IN PLACE to the
stock `Which` definition, or when `Which` is re-declared from a copy of the
stock definition WITHOUT a handler. It goes exponential — ×4 per two levels, 39
ms/call at depth 18 on `main`, 50 ms on 0.117.0 — only when BOTH happen:
`engine.declare("Which", {...stock})` followed by `operator.compile = …` on the
new definition (Tycho's retired "OLD route"; their shipped install attaches in
place and is flat). The switch is `Harvester.hasCallerCompileHandler`
(`compilation/cse.ts`): a `compile` handler on a definition that is not the
system-scope one is a live-source splice the harvest cannot analyse, so every
node under that head is refused as a CSE candidate and every callee body
containing it fails `calleeBodyClean` — admitted for the NaN-skippability
question only, where the definition's declared `pure` is trusted (an explicit
`pure: true` on the re-declaration does NOT restore sharing, measured). The
built-in definition's own handler is exempt by object identity.

Option, if a consumer needs the re-declaration shape: the lazy-operand region
table (`LAZY_OPERANDS`) is keyed by operator NAME, so a re-declared `Which`
still opens the right regions at harvest; a caller handler that DECLINES at
emission (returns `undefined`, Tycho's case) then emits through the built-in
lowering, which pushes those regions. The refusal could be narrowed to "a caller
handler that EMITS" — unknowable at harvest time, so it would have to be a
declaration on the handler (or a `pure` + "lazy operands as the built-in"
contract). Demand-gated: the only known consumer route is flat.

### Assigning a function literal whose body shares operands is exponential in the sharing depth (OPEN, evaluation — found 2026-08-22 with the shared-operand walk fix)

`ce.assign('f', Function(Hold(e), t))` with `e` a depth-_n_ shared tower
(`Max(e, e)` nested, 31 distinct nodes at depth 30) doubles per level: 1.7 s at
depth 16, 3.1 s at 18, 10.6 s at 19, and the process runs out of memory at 30 —
while BOXING the same literal takes 1 ms and APPLYING it to an argument takes 9
ms at depth 30 (both pinned in `dag-shared-walks.test.ts`). Two walks on the
assign path descend each operand independently:

- `Walker.visit` in `boxed-expression/effects-inference.ts` — the latent-
  effects inference of the literal's body (`inferFunctionLiteralEffects`), also
  reached when a lazy collection reads its callback's effects:
  `Map(k ↦ e + k, Range(1, 3)).count` does not return at depth 30 either,
  whereas the same `Map` with the tower in its SOURCE answers in 3 ms. The visit
  carries order-sensitive state (the confinement frontier of declared names per
  sequence, the registry-consulted bits, the saturation early return), so a
  per-node memo needs the same analysis the binder rewrite's got — the answer
  must depend only on (node, frontier) for the memo to be sound.
- `jsonWithSourceOffsets` in `engine-declarations.ts` — the literal is re-boxed
  from its MathJSON (with `sourceOffsets`) to stamp parameter types, and
  `BoxedFunction.structural` rebuilds each path of a shared operand as a fresh
  tree on the way; MathJSON cannot express sharing, so the serialization itself
  is exponential in size. The re-box would have to work from boxed operands
  (`ce.function('Function', [body, …params])`) instead.

Not fixed with the evaluation-path walks because no consumer shape assigns a
literal whose body is an evaluated value: parsed bodies are trees, and the
shared-operand values arise as RESULTS (a document function applied to its own
previous result), which Tycho's document pass never re-assigns as a function
body. Probe: the `assign` line above at depths 16/18/19.

### The recursion limit can lose to the JS stack when each level nests deeply (OPEN, evaluation — found 2026-08-22)

`ce.recursionLimit` (default 256, `engine-runtime-state.ts`) counts
user-function applications, and a runaway numeric recursion normally ends in a
clean `CancellationError: Recursion limit exceeded` — `f(n) := n f(n-1)` applied
to `f(2)` does. But when each level pushes many JS frames before the next
application, the JS stack runs out first and the caller gets a bare
`RangeError: Maximum call stack size exceeded` instead:
`h(n) := \text{T}(n \le 1, 1, n h(n-1))` (a body whose `\text{…}` made a
`Text(…, Tuple(…))` node — the author meant `If`) throws the `RangeError` on
`h(2)`. Options: lower the default limit, or make the guard stack-aware (catch
the `RangeError` at the outermost application and rethrow it as the
cancellation). Repro: the two parses above, then `ce.box(['h', 2]).evaluate()`.

### Built-in collections as `Iterable`/`Indexable` protocol conformers — audit and sizing (OPEN, design — audited 2026-08-21; ruling P8 / §7 item 6(h) of `docs/TYPE_SYSTEM_ROADMAP.md`)

A read-only audit sized the migration of the collection capability from the type
lattice onto the protocol system. Findings, so the next round does not re-derive
them:

- **The engine already has three overlapping answers to "is this a
  collection".** (1) The lattice: `collection<T>`, `indexed_collection<T>`,
  `list<T>`, … (~139 predicate sites + 76 operator-signature bounds). (2) The
  runtime handler layer: `CollectionHandlers` on a definition
  (`types-definitions.ts`, 14 members, `iterator` + `count` required,
  `defaultCollectionHandlers` in `collection-utils.ts` derives the rest) with
  the `isCollection`/`isIndexedCollection`/`isFiniteCollection` accessors — a
  structural protocol in everything but name, reachable from JS only. (3) The
  nominal protocol registry (`engine-protocols.ts`), which has no collection
  protocol at all. The documented CAPABILITY-vs-SHAPE split
  (`types-expression.ts`, the `isCollection` doc) is why ~24 sites double-gate
  (`op.isCollection || op.type.matches('collection<any>')`); the sharpest seam
  is `BoxedFunction.isIndexedCollection`, a capability accessor whose final
  answer is `this.type.matches('indexed_collection<any>')`.
- **Site classification** (`src/`, excluding the lattice implementation in
  `common/type/`): 69 predicate sites are pure capability gates ("can I
  iterate/index/count this"; 40 of them in `compilation/`), 70 are
  shape/element/inference/representation reads (28 in `library/collections.ts`)
  and must stay on the lattice, 10 are mixed (capability gates with tuple/string
  atomicity carve-outs). Of the 76 signature bounds, ~57 are capability bounds
  (`Count`, `IsEmpty`, `Contains`, `Join`, the statistics folds). Migrating the
  capability sites alone touches 19 files (24 with the signature bounds).
- **What the protocol system can already do**: built-in lattice types are legal
  conformance targets (`conformanceTargetProblem` admits `string`,
  `list<integer>`, a conditional head `list<T>`); a JS host handler satisfies a
  member with no Epsil source (`ProtocolHostHandler`); dispatch keys on the
  receiver's TYPE, so an untagged `["List", 1, 2]` dispatches; and
  `where T is Iterable` is a working constraint slot today. What it cannot do,
  by effort: protocol refinement (`Indexable` requires `Iterable`) — no
  `requires` field; parameterized protocols (`Iterable<T>` —
  `assertV1MemberShape` bans generic members; conditional conformance gets
  element MATCHING but not element OUTPUT in a member's result type); a
  dynamic-tier compiled guard that can see element types (the `array` bucket is
  rejected); and the membership-granting bridge (conformance ⇒ inhabits
  `collection`), which needs `isSubtype` to consult the conformance oracle and
  inverts the `common/type` ⊥ engine layering that the P36 oracle seam exists to
  preserve. Compiled dispatch is JavaScript-only.
- **Handler members that are not protocol-shaped**: `elementMemo` is a boolean
  attribute, not a member; `isCollection` is a PER-INSTANCE conformance veto
  (`When`), which nominal conformance cannot express;
  `isLazy`/`isFinite`/`isEmpty`/`isEnumerable` are derived facets, not
  conformance; the `string` arm of `at`'s index is dead (no library `at` handler
  accepts a string — keyed access lives on `BoxedDictionary`); and
  `canEnumerate`/`elementCount` on eager producers form a second, mutually
  exclusive partial conformance that a unification must place.

Recommendation from the audit: do not replace the lattice; make
`CollectionHandlers` the implementation of two engine-declared protocols
(`Iterable` over the `collection` tier, `Indexable` over the
`indexed_collection` tier, as §4 already rules), and retarget the 69 capability
gates at conformance so the double-gating disappears. First deliverable is the
requirement-table design doc item 6(h) asks for; the member table above is its
input.

### Ranged types — remaining design tasks (OPEN; the interval arithmetic and open-bound halves shipped 2026-08-27 and 2026-08-28)

Each of these is a separate design task left over from the ranged-types line
("Ranged types should carry sign", raised 2026-08-22).

- **Literal types for STRING and BOOLEAN literals.** The public `.type` of a
  number literal is its value (`ce.box(21).type` is `21`, shipped 2026-08-23);
  `ce.string('a').type` is still `string`. Neither measured nor ruled, and the
  impact on Tycho is unknown until measured from Tycho's side.
- **A value-bounded type variable rejects its own literal.** A declared
  `(x: T) -> T where T: 5` applied to the literal `5` errors with
  `incompatible-type` — the solver binds tiers, never value types, so `T` binds
  `finite_integer`, which fails the declared bound `5`. Pre-existing (verified
  at commit 5720d468, before the public-type flip); found by the O9 dual review,
  2026-08-23. Only the Epsil lexer test exercises the spelling
  (`type-variables-epsil.test.ts`, a token-boundary pin), so nothing observable
  depends on it today. A fix would keep the unwidened actual for a variable
  whose declared bound has a value component.

Historical note from the user: the lattice once had `positive_integer` and
similar named types, simplified away; ranges are the replacement they should
have been connected to.

### Nightly type-soundness grid: 6 binary arithmetic suites fail on a range-granularity artifact — OPEN 2026-08-31 (pre-existing; found while running the grid for the Sign Phase F flip)

`CE_NIGHTLY=1` on `test/compute-engine/nightly/type-soundness-grid.test.ts`
fails the `Add`/`Subtract`/`Multiply`/`Divide`/`Power`/`Root` suites (18–21
cells each; unary suites all pass). Reproduced identically at HEAD `ec3c8456`
with and without the Sign-flip changes, so the class is not new. The shape, from
a sample cell: `Add(2/3, 0.5)` gets the static claim `real<1.16..1.171>`
(interval propagation), evaluates to the big-decimal `1.1666…67`, and that
VALUE's own literal type is spelled with coarser bounds — `real<1.1..1.2>` —
which is a WIDER interval, so `isSubtype(evalType, staticT)` fails even though
the value lies inside the static range. The value is right and the static claim
is right; the disagreement is between two range-spelling granularities (the
evaluated literal's range keeps fewer digits than the interval propagation). To
close: either the evaluated big-decimal literal's range spelling keeps enough
digits to stay inside propagated claims, or the grid's oracle should compare the
VALUE against the static range instead of comparing the two range spellings.
Nightly-only, so no default-suite impact.

### Type derivation reaches state mutation at 7 handlers, 2 `elttype` handlers and 1 getter — AUDITED 2026-08-22 (OPEN, defects — the getter half is done: `_reviseInferredType` no longer writes on read; the 7 handlers and 2 `elttype` handlers remain)

A transitive call-graph audit (depth ≤ 8) of every `type:` handler in
`library/*.ts` — 220 arrow-form handlers plus ~65 string/named entries — for the
side-effect pattern behind item 219 ("Reading a nested lazy view's type was
exponential in depth": a type derivation that writes engine state invalidates
the caches it is filling). 213 handlers reach only pure leaves. The exceptions,
each a live or latent instance of the 219 pattern:

- `Pipe` (`library/core.ts`, `pipeImplicitMapType`): canonicalizes both held
  operands to decide implicit mapping, and `canonicalWithFreshPlaceholders`
  (`src/compute-engine/function-utils.ts:1546`) declares the placeholder into a
  scope that is NOT registered in `_scratchDeclarationScopes` — so every type
  read of a `Pipe` stage advances `_anyVersion` and retires every `_type`/`_sgn`
  memo mid-derivation. Memoized on `_anyVersion`, which the read itself moves.
  FIXED 2026-08-22 for the placeholder declarations (`scratchDeclarations`
  option, pinned in `pipe-type-read-purity.test.ts`): drift per re-derivation 2
  → 1. The residual advance is the literal's own parameter declared into a
  `block.localScope` the canonical literal keeps — not exemptable under the
  scope-targeting rule (doc §4.1, open item O5).
- `Dot` (`linear-algebra.ts`, `innerProductType`): builds and canonicalizes n+1
  `Multiply`/`Add` applications per type read, no memo. The audit's "`_infer`
  reachable" claim did NOT reproduce (measured: drift 0 on 20 shapes); the cost
  is ≈44 µs of allocation per re-derivation, and a canonicalization-free rewrite
  NARROWS two declared-symbol rows (doc §4.1, open item O6). Today's table is
  pinned in `dot-type-read-purity.test.ts`.
- `Set` (`collections.ts`, `parseSetComprehension`, reached from the `type:`
  handler and from `Set.elttype`): canonicalizes the domain/condition
  sub-expressions (auto-declare, `_infer` writes reachable), no memo; and
  `Set.elttype` EVALUATES each domain element (`enumerateSetComprehension`).
- `Interval.elttype`: `.N()` on both endpoints (`numerics/interval.ts`).
- `JacobianMatrix` (`calculus.ts`): canonicalizes its operand and beta-reduces
  via `resolveToList`, no memo.
- `Sqrt` (`arithmetic.ts`, `closedRealSign` in `library/type-handlers.ts`):
  `x.N()` during a type query — guarded (`isPure`, no unknowns), recorded for
  completeness.
- The getter: `op.type` on a symbol whose recorded type is INFERRED and
  refutable runs `_reviseInferredType`
  (`boxed-expression/boxed-value-definition.ts`), which journals a `type-write`
  and advances `_anyVersion` — a read that moves the cache axis, reachable from
  any of the 213 pure handlers. The code calls it a deliberate bounded
  exception; by the 219 standard it is the pattern.

Not traced: dynamic `def.type`/`elttype` dispatch edges beyond the two `elttype`
handlers above, and call depth > 8. Full table (file:line for every claim) in
the audit recorded by `docs/plans/2026-08-22-type-handlers-on-types.md` §2.5;
the design's success criterion — item-219 drift 0 with the `scratch` exemption
made a no-op — is what closes each row.

### A pre-canonicalization validation phase (OPEN, design — raised by the user 2026-08-21 at the item-219 ruling)

Item 219 is the second time a computation has needed to VALIDATE an expression —
decide what it is or what it would produce — without perturbing the environment,
and has had to buy that with a scratch scope plus an exemption from cache
invalidation. The `Pipe` implicit-map type handler (`PIPE_IMPLICIT_MAP_TYPE`,
`library/core.ts`) is the first: it canonicalizes held operands to decide
whether a stage implicitly maps, and pays for it with a memo recording the
generation observed AFTER the derivation.

The idea, as raised: give the engine a pre-canonicalization phase whose job is
validation, which regular canonicalization would call, and which internal
constructions could SKIP in favour of a cheaper validation-less
canonicalization. A probe that needs only "what type would this application
have" would then run the cheap path and never declare at all, which removes the
need for a scratch-scope exemption rather than making it safe.

Not scoped or scheduled. Recorded because the two existing workarounds are
individually sound but structurally identical, and a third instance is the point
at which the general mechanism is worth more than another local exemption.

### Cross-term CSE could partition a region by index-dependence (OPEN, design note — deferred from the `Sum` unroll round, 2026-08-19)

A `Sum`/`Product` with compile-time-constant bounds and at most 100 terms
unrolls into a flat operator chain (`UNROLL_LIMIT`,
`compilation/javascript-target.ts`). The unroll arm opens a FRESH CSE region per
term by design: the same body nodes are compiled once per index value, so a
node-keyed reuse across terms would emit term 1's temporary for every later term
— silent wrong values. Hoisting an index-independent subexpression out of the
terms is therefore a separate, deliberately narrow mechanism, and today it
covers COLLECTION-valued subexpressions only (`hoistLoopInvariants`, gated by
the CSE admissibility predicate; pinned by
`test/compute-engine/compile-sum-unroll-guards.test.ts`).

Nothing is known to be wrong with that. This entry records the shape of the
principled fix should more hoist sites of this kind appear: partition a region's
candidate set by index-dependence inside `compilation/cse.ts`, rather than
adding further local hoists next to the collection one. Doing that speculatively
is not worth it — the narrow mechanism already covers the reported case, so this
waits for a second witness.

### No lowering compiles a stored symbol value where a binder rebinds one of its names (OPEN, found 2026-09-21 while carrying out the two scoping decisions of that date)

A stored symbol value keeps the binding it was written against, and the
JavaScript and `interval-js` targets honour that by emitting the value as a
preamble local outside every emitted function (`bindsFoldedValue`,
`base-compiler.ts`). Two shapes have no such place to put it, and both now fail
closed (D6) naming the symbol and the shadowing name, so the public route
answers through the interpreter. What is open is the lost capability, not a
wrong answer.

- A compiled top-level lambda holds its preamble INSIDE the lambda body
  (`userFunctions.valueRoot`), because a compiled lambda takes only its declared
  parameters: a free symbol has no supply channel there. So
  `compile((n) ↦ Σ_{n=1}^{3} a)` with `a := n + 1` declines, where the
  interpreter answers `3n + 3`. Compiling it needs a lowering that puts the
  preamble at the ROOT and gives the lambda a channel for the value's free
  names.
- The shader targets (`glsl`, `wgsl`) declare statically typed functions and
  have no place for an untyped value binding, so they fold inline:
  `compile(g(2), { to: 'glsl' })` with `a := 3t + 1` and `g := t ↦ t + a`
  declines, where it used to emit
  `_fn_g(float t) { return (3.0 * t + 1.0) + t; }` and read the parameter.
  Compiling it needs the value as a uniform, or the emitted parameter
  alpha-renamed. A shader `Sum` whose body folds a value naming the index
  declines for the same reason.

Both shapes are pinned in `compile-fold-shared-values.test.ts`. A document that
relied on the capture — a Desmos-style kernel where `d_00 := p(x, y) · S` is
read inside `c_2(x, y)` — now declines on the shader targets instead of
computing what the interpreter never computed.

### JavaScript list-arithmetic declines, triaged (2026-09-14, the point-list-arithmetic candidate)

A fresh CORE-corpus audit at HEAD found 52 `javascript` records that fail closed
with "cannot compile scalar arithmetic over a list-valued operand" (and one
`Abs` variant). They are not one gap. Each bin below carries its witness; the
record counts are from the 2026-09-14 run.

Not defects (the interpreter itself does not produce a value):

- **Invalid input.** `2ki2hjsouf` (10 records) boxes with an
  `Error(incompatible-type)` node inside it, and `ifnnzttcqg` (1) likewise;
  `6kalzeiedk` (1) references an undefined operator `B`. The compiler correctly
  refuses an expression the interpreter also rejects.
- **A point summed with a scalar.** `urbddymicb` (8) is
  `(x − C_x)² + (y − C_y)² + (−R_2, −o_ut)` — a scalar plus a point. The
  interpreter answers `Error(incompatible-type, "tuple", "number")` at that sum
  (measured 2026-09-14), so failing closed matches interpretation.

Open, each with a witness:

- **A point summed with a symbol declared as a point-OR-point-list union
  (`indexed_collection<number | tuple<…>> | list<tuple<…>> | tuple<…>`) fails
  closed, and that is a RULING for Tycho, not a compiler change.** The
  declaration admits a flat array of numbers, which at run time has the same
  shape as a point, so the sum with a point list cannot be decided by the
  value's shape (`runtimePointShapeIsUnambiguous`). Concrete input:
  `W(…) + PointList(…)` where Tycho declares `W`'s result with that union
  (`0d6251b03c`, `n7uhaaoq1q`, `pwceub9smn`, and the earlier `njncrg9fkv`).
  Options: (a) Tycho narrows the declaration to `list<tuple<…>> | tuple<…>`,
  which the shape test decides at run time and the sum then compiles; (b) the
  compiler adds a scalar-shape dispatch arm that answers `NaN` where the
  interpreter errors, which loses the interpreter's per-element error. If
  nothing is decided, these ~5 records keep failing closed. Recommend (a): it
  makes the sum compile without changing any answer.
- **`Power` over an operand that is a point, a list, or a list of points is
  element-wise identically** — `(3,4)² = (9,16)`, `[3,4]² = [9,16]`, a list of
  points → `[(9,16),(25,36)]` (measured 2026-09-14) — so the point-vs-list
  ambiguity that blocks `Add` does not change `Power`'s answer. A union-typed
  SYMBOL operand already compiles for `Power` (probed 2026-09-14), so the corpus
  rows decline in a call structure not yet reproduced: `hpr2q4kles` (9 records,
  `P(U(x, y), …)`), `hbvzf9yk1r` (1), and the `Power` records of `jgcclk1njk`. A
  follow-up must reproduce one of those rows and locate the decline before
  broadening the `Power` broadcast admission.
- **A point whose own coordinate is a list.** `u1bpof8xfg`'s Multiply now
  compiles, but the enclosing `Add` still fails closed: the point
  `(−cos t, sin t · sgn R)` has a list second coordinate (`sgn R` over a list).
  This is the open point-with-a-list-coordinate shape (ruled A,
  `COMPILATION-MODEL.md`), not the list-symbol case.

The "color family" (`s8ishknvhe`, `woeywky0kj`, `iqnkdz3ptt`; `wgxnrn87sx` was
resolved 2026-09-14) is NOT a distinct color-broadcast gap (reproduced
2026-09-14). The color-broadcast path already handles a head over a list of
colors: `AsOklab` over a `list<color>` compiles to `_SYS.bcastColor`. These
records trace to point-list arithmetic surfacing in color-heavy documents:

- `s8ishknvhe`: `Abs(C_c)` over the wide union type
  (`indexed_collection<number | tuple<…>> | list<tuple<…>> | tuple<…>`) compiles
  from source since 2026-09-29 (`_SYS.bcast((_tv1) => Math.abs(_tv1), _.C)`);
  whether the whole document row compiles is Tycho's count to re-run.
- `iqnkdz3ptt` (2 records): the failing row is a point plus a number list
  (`(⌊…⌋, …) + [0, 1]`), which the interpreter answers as an `incompatible-type`
  error per element (measured 2026-09-14) — so the decline matches
  interpretation and is not a defect.
- `woeywky0kj`: builds an RGB triple in a `list<color>` context; the exact
  failing operand was not pinned (the isolated row compiles), and needs a clean
  audit run to capture.

### Compiling a DAG-shared symbol value on the inline targets still refuses above the fold-size guard (OPEN, no urgency — the JavaScript-family targets were resolved 2026-08-29)

On the `javascript` and `interval-js` targets a symbol's compound pure value is
emitted once as a preamble local (`ensureFoldedValueEmitted`,
`base-compiler.ts`), which closed the exponential emission of Tycho item 225.
The inline targets (Python) still fold a value into the emission per reference,
so `MAX_FOLD_EXPANDED_NODES = 20 000` (`expandedFoldSize` /
`assertFoldableSize`, `base-compiler.ts`; ruled fail-closed 2026-08-23) refuses
the pathological DAG-shared tower there: the public `fallback: true` route
degrades to interpreted evaluation, the direct registered-target route throws
(pinned in `compile-fold-size-guard.test.ts`). The remaining levers are the same
preamble binding on those targets, or a runtime-binding channel (a `_SYS`
engine-value lookup) so a compiled member survives instead of falling back —
Tycho's ledger prefers the latter. The consumer states NO URGENCY: their macro
pipeline now binds document functions as by-reference lambdas, and the item-225
witness (`art/nxlddeh5zv`) no longer OOMs, though its interpreted member sweep
still exceeds 300 s on the fallback.

The preamble binding is per SYMBOL, so it does not reach sharing INSIDE one
symbol's value. Tycho now publishes that document's height map with the helper
bodies substituted (measured 2026-09-16 on Tycho `03ebe4fc8`): the value of
`h_eightMap` is one expression of 236,663 distinct nodes in which each level's
argument is shared by the dozen reads of the level above, 25 billion nodes as
text, and `b_ase` holds no value at all. On the JavaScript target the four
terrain triangle rows therefore decline at the guard (census 2026-09-16; they
compiled on Tycho `5ce55d2bd`, where the sliders were untyped and the value
open). Evaluating the closed value first would not help either: at size 64 the
literal is 8,192 points, above the guard on its own. The lever is the one the
consumer prefers, a runtime-binding channel for a symbol value, or a per-node
binding of each sub-expression that has several parents. The reference analysis
that a declined result carries walks such a value once per node and no longer
runs a caller's `compile` handler inside it (`CHANGELOG.md`).

### Fixed-width collection chains: residue after the 2026-09-08 and 2026-09-09 rounds (OPEN, compile performance — consult with Tycho, Desmos state 62urmx2dcm)

The rounds of 2026-09-08 and 2026-09-09 (fixed-width unroll pass, callback
hoist, call-site inlining of point arguments, the last-call memo on pure scalar
definitions; all in `CHANGELOG.md`) took the by-reference Voronoi row from 58 µs
to about 2.7 µs a sample. What remains:

- **Cross-definition CSE: the shared block inside two definitions.** The
  2026-09-09 last-call memo (`memoizeSharedDefinitions`, `javascript-target.ts`)
  removed one of the three evaluations of the nine-point block per sample: the
  row's second call of `m(x, y)` is now answered from the record of the call
  inside `m2` (by-reference row 3.4 → 2.7 µs per sample; the inlined row is 1.2
  µs on the same machine at the same time). The remaining 2× is the block
  itself, computed once inside `m2` (its own inlined `d(x, y)`) and once inside
  `m`. Sharing it means emitting the block once as a helper over `(x, y)` that
  returns the nine distances, memoized the same way, and reading from it in both
  bodies. Scoped 2026-09-09 and NOT built, because it needs two new concepts: a
  CSE harvest whose region spans several emitted definitions (`cse.ts` regions
  are per root today, and a candidate found in two bodies must be materialized
  as a call that passes the bodies' parameters, not as a `const` at a region
  entry), and an alignment of parameter names across the bodies (`m(x, y)` and
  `m2(x, y)` share names by luck of authorship; `m(u, v)` would not match
  without alpha-renaming the harvest). The memo of an ARRAY result — which the
  helper would return — is a third question the current memo deliberately
  declines (an array compares by identity and may be mutated by its consumer).
  Inlining small scalar callees at call sites was measured and rejected earlier:
  a size bound on the AUTHORED body does not bound the EMITTED code (`m` is 4
  nodes authored, 2 456 characters emitted), and making the inliner the primary
  route retargets 374 `_fn_*` call shapes across 35 test files. Tycho was asked
  to re-measure on 0.127.0 before this is reconsidered. Corpus count
  (tycho-perf, 2026-09-09, 71 documents): a collection-valued helper reached
  from two or more definitions occurs in 2 of 30 core documents, and only ONE
  plotted row anywhere — this Voronoi diamond — reaches such a helper through
  two callers. An array-result memo would fire on that one row; it is not a
  general mechanism on this corpus.
- **A fixed width known only from a TYPE** (`P: list<tuple<number, number>^9>`
  as a symbol, `At(P, i)` reads) is not unrolled; the pass needs a literal
  `List`. Unrolling from the type would rewrite `Map(f, P)` to
  `[f(At(P, 1)), …, f(At(P, 9))]`, which then needs an `At` lowering over a
  declared list on the shader targets. Corpus count (tycho-perf, 2026-09-09): 0
  sites on every target — Tycho expands value macros before compiling, so a wide
  list reaches the engine as a literal `List`. The only witness is the
  by-reference Voronoi row, which the audit harness cannot see: its by-reference
  records fail at binding on Tycho's side (`Unknown operator d`). Not built.
- **A point bound to an untyped parameter that cannot be inlined fails closed.**
  The call-site substitution declines for an impure point argument, a recursive
  or multi-clause callee, and a body that is invalid over a point (`P·P`,
  `2P + 1`); the compile then reports the reason and the `fallback: true` route
  answers through the interpreter. A parameter the body never mentions keeps the
  by-reference call, whatever its argument is. A per-shape specialization of the
  emitted definition would compile those cases too; not built, no consumer has
  asked.
- **`Map(h, list)` with a bare head is unrolled only for a user function with
  ONE plain parameter.** A variadic `h` would be sound for a bare head (the
  rewrite writes `h(e)` either way) but is declined with the lambda case for
  now; a library operator head (`Map(Sin, list)`) is not unrolled either. Both
  are missed optimizations, not defects.
- **Consumer-side fact for Tycho:** on `glsl`/`interval-js` the by-reference
  route needs the plot variables DECLARED (or supplied through `vars`): an
  `unknown`-typed argument could hold a collection the by-reference call would
  broadcast, so `provablyScalarArg` refuses to inline over it. This is a
  soundness guard, not a defect.

### Code-generation census on CE 0.128.13: ranked candidates (OPEN — measured 2026-09-16, data and table in `docs/plans/2026-09-15-interval-js-collection-lowerings-handoff.md` §9)

Declines per target on the all-states Tycho corpus (684 documents): javascript
112 in 38 documents, glsl 148 in 55, interval-js 188 in 66 (down from 233 on
0.128.12). The first two candidates of that census landed (the lazy-list
re-evaluation on 2026-09-16, the interval absence class and the coordinate
accessor over a point list on 2026-09-18; both in `CHANGELOG.md`). What is left,
in order of value: (1) JavaScript scalar arithmetic over a list-valued operand,
33 rows (the triaged list-arithmetic entry); (2) GLSL `At` over a run-time
indexed collection, 32 rows, and GLSL `Integrate`, 15 rows; (3) the remaining
interval `List` rows, triaged in the entry "Interval target: the census rows
that remain are not implicit curves". `D`, `PointList` and the complex rows on
the interval target are design boundaries, not candidates. The next measurement
is a new all-states baseline on the current release (item 4 of the ranked list
at the top of this section).

### Collection values on the interval target: what stays open after the 2026-09-15 round (OPEN — the round itself is in `CHANGELOG.md`, design record in `docs/plans/2026-09-15-interval-js-collection-lowerings-handoff.md`)

The interval target now maps scalar kernels over provable lists of numbers,
carries arrays across user-function boundaries, builds a range at run time and
reduces over it. Three things were left out of that round on purpose:

- **A reduction over a bound that is not constant over the cell answers
  `entire`.** The indexed `Sum`/`Product` loop (a bound whose endpoints floor to
  different integers) and the run-time range (`_IA.range`, a bound that is not a
  point interval) both give up instead of enclosing. The sound refinement is the
  hull over the integer bound pairs: for `Σ_{k=a}^{b} f(k)` with `a ∈ A`,
  `b ∈ B`, the union of the sums over every `(⌊a'⌋, ⌊b'⌋)` pair, computed from
  prefix sums under a pair budget. A plotter's cells refine until the bound is
  constant, so the cost of `entire` is plotting time, not soundness; do the
  refinement when a corpus document shows the cost.
- **`D` (a derivative) on the interval target has no lowering beyond the closed
  form.** `d/dx L(x)` compiles when the derivative of the body has a closed form
  (the shared `compileDerivative`), which is what the census's witnesses lacked
  (16 declines, 8 documents: a body with a sum over a symbolic bound, an
  integral, a piecewise). The JavaScript target's numeric fallback is a
  finite-difference stencil, which is not an enclosure of the derivative over a
  cell and must not be ported. The sound route is forward-mode automatic
  differentiation in interval arithmetic — a jet lane over the interval kernels,
  the interval counterpart of `jet-derivative.ts`. Design work; demand-gated.
- **A relation over a provable list (`L < 1`) keeps the scalar-operand gate.**
  Its element-wise value is a list of tri-state verdicts, which the result
  contract (`IntervalValue`) does not admit. Tycho compiles the UNMASKED body of
  an implicit member, never the relation, so no corpus row needs it.

### Static broadcast unroll for the compile route — elementwise `Which` over statically-sized collections at `glsl`/`interval-js` (OPEN, demand-gated — opened 2026-08-19 from Tycho item 206)

The evaluator broadcasts `Which` elementwise over collection-valued operands
(shipped for Tycho item 193 in 0.112.0), and the `javascript` compile target
lowers the same shape (`compileJSSelection`, `javascript-target.ts`). The `glsl`
and `interval-js` targets fail closed instead — correctly, given their value
models: the interval target holds one interval per quantity (no collection
values, by design), and the GPU elementwise selection (`compileGPUSelection`,
`gpu-target.ts`) only lowers static `vec2`–`vec4` shapes. Tycho's Voronoi
second-minimum idiom (`Min(Which(d == m, 10^9, True, d))` with `d` a broadcast
expression over a 20-point `PointList` literal) therefore declines at both
targets even though every collection operand has a compile-time-known length.

The clean design is NOT per-target: a target-independent static broadcast unroll
before target lowering. When every collection leaf in the `Which` clauses is
statically enumerable (materialized `List`/`PointList`/`Range` literals) with
one common length N, project the broadcast expression per element and rewrite to
N scalar selections — the compile-route twin of the evaluator half. The
consumers already exist: `compileGPUExtremum` folds compile-time component lists
of any length, and the interval `Min`/`Max` handlers fold n scalar arguments.
The projection transform must be conservative — fail closed whenever a
collection subterm is not statically enumerable, lengths disagree, or an
index-sensitive operator (`Sort`, `Unique`, …) sits between the leaf and the
selection, since those are not positionwise maps.

Two cautions recorded while scoping (2026-08-19 probes against source at
0.115.0):

- On `glsl` the unroll alone is NOT sufficient for the witness: `Power`/
  `Square` of a vec operand with a scalar exponent independently fails closed
  (`_gpu_powi` is declared scalar-only, and the `pow` builtin requires matching
  genTypes) — a known hole pinned in
  `test/compute-engine/compile-gpu-shape-gate-holes.test.ts`. Unrolling to
  SCALAR selections sidesteps it for the idiom (each projected element is
  scalar), but any design that instead lifts the vec-width cap runs straight
  into it.
- The `javascript` target already compiles the exact witness shape and returns
  the correct second minimum (verified by hand against the 20 distances), so the
  consumer-facing urgency is low: Tycho was told (item 206 answer, 2026-08-19)
  to retry `to: 'javascript'` before dropping to the interpreter-backed
  fallback, and to unroll on their side if they need GPU-shaded rendering before
  this lands.

Demand-gated: pick this up if Tycho (or another consumer) reports that the
compiled-JS sampling path is not enough — e.g. an implicit-curve row that needs
interval arithmetic for robustness, or a shaded-region row that needs the shader
target.

**What the pre-pass covers since 2026-09-12** (`fixed-width-unroll.ts`; the full
corpus run refuted the "demand at zero" paragraph that follows — `ccoc40kfhj`,
24 `interval-js` records, writes every colour channel as a `Which` broadcast
over a three-element list read back at one index). A literal index is pushed
through a `Which`/`If` whose first condition is a list — a later scalar
condition and a scalar or point arm repeat at every position, as the interpreter
lifts them — and on through the ordering relations, `Equal`/`NotEqual` against a
scalar, `Mod`, the other element-wise heads and a literal `Range`, down to the
literal list, so the row is one scalar selection on every target; and a
`Which`/`If` whose first condition is a WIDE list built from non-constant lists
(five or more elements, at most 64) is written out as the list of its
per-position selections.
`test/compute-engine/compile-elementwise-selection-unroll.test.ts` pins the
rows, the walk's refusals and the shader compiles. What is NOT covered, with the
reason:

- a selection with no default clause and a point arm (a position no clause
  selects is `NaN` element-wise but `Missing` for a scalar selection);
- a `Which` in statement form inside a lambda the pass does not enter
  (`5qn5kcrszu`, 6 `javascript` records);
- the Voronoi witness above, whose condition is built from a list of POINTS
  (`|P − (x, y)|` over a `PointList` literal) — the width walk reads lists of
  scalars only;
- `When` over a list condition, whose interpreter semantics for a point value
  are undecided (no ruling entry records the question yet).

**Demand measured at zero (2026-08-20).** Tycho retracted the escalation after
measuring against 0.116.1: the blocker was on their side, one layer upstream of
the compile route — a collection-carrier predicate that consulted their own
definition table, returned early on a miss, and never reached its type arm, so a
carrier owned by their computed-collection registry answered "not a collection"
while their type predicate said it was. With that fixed, the witness expressions
take the elementwise zip lowering and never construct a collection-valued
`Which` at all; both remaining witnesses render. The two other expressions
originally named were retired as never having been witnesses (neither reads the
collection-valued definition; it appears only as its own definition head).
Caveat recorded by the reporter: their oracle fix was still uncommitted in a
working tree when measured, so this is "stop scoping", not "cause proven
landed". The two cautions above about the `glsl` `Power`-of-vec hole and the
vec-width cap remain accurate and remain unmotivated by any consumer.

### A `Which` over a list condition: a repeated sub-expression is evaluated once per reference (OPEN — Tycho ask 296, cause found 2026-09-18)

Tycho ask 296 reports that `evaluate()` of a piecewise whose condition is a list
returns a symbolic `Which` of 52 MB at 500 elements, and that at 10 000 elements
the process exhausts its heap before `ce.withTimeLimit(5000, …)` throws. The ask
said the engine has no elementwise selection. That was not the cause: the
evaluator does select elementwise over a list condition
(`Which([1,5,2] < 3, 10, True, 20)` evaluates to `[10, 20, 10]`, and the same
holds when the list is the value of a symbol, when the arms are lists, and when
the arms are point lists).

The cause was the function `conj` in the witness (`s8ishknvhe`, Desmos's complex
conjugate). `conj` had no parse entry, so the boxed body held `conj(L)`, an
unknown function applied to the complete list. An unknown function does not
broadcast, so each element of the condition list held a copy of `conj(L)`, no
element could be decided, and the `Which` stayed symbolic: N copies of an
N-element list for each reference to `conj`. `\operatorname{conj}` now parses as
`Conjugate` (`definitions-complex.ts`), and the body Tycho sends evaluates to a
`List`. Instrument on the Tycho side:
`scripts/repros/2026-09-15-list-conditioned-piecewise-probe.mts` in `dev/tycho`.

One defect remains; it does not depend on `conj`: any unknown function over the
list inside the condition gives the same symbolic `Which` (measured with `foo`
in place of `conj`). The time-limit overrun on the undecidable body that this
entry recorded until 2026-09-29 no longer reproduces: 10 000 elements under
`withTimeLimit(5000)` return the symbolic `Which` in about 0.2 s.

1. **The selection over a decidable list condition costs2. **The selection over
   a decidable list condition costs about 2 ms per element for this body**
   (measured from source with `tsx`, which adds loader overhead: 500 points →
   0.9–1.2 s, 2 000 points → 4.2 s; at 10 000 points the 5 s limit refuses the
   evaluation). Two causes, measured 2026-09-18:
   - The body holds the same inner `Which` six times (Tycho expands the document
     functions `S`, `f` and `N` in place), and `evaluate()` computes each
     reference separately: one inner `Which` costs 130–190 ms at 500 points.
     With the inner `Which` evaluated once and bound to a symbol, the same
     result takes 0.2–0.3 s in place of 0.9–1.2 s. Tycho addressed this on its
     side (2026-09-18, `shared-subexpressions.ts` in `dev/tycho`): each repeated
     function node that reads a collection is evaluated once and bound in the
     resolver's child scope — 10 000 points 11.0 s → 1.8 s on a quiet box, the
     production resolver answering in 2.6 s. Two facts from that work matter
     here. (1) Calling `S`, `f`, `N` by reference in place of expanding them is
     NOT value-safe: a named function with an untyped parameter is mapped
     element-wise over a list argument (the declared `broadcastable<T>` contract
     of item 157), so a function that reads its list as a whole
     (`g(L) = L - mean(L)`) answers `[0, 0, 0, 0]` by reference and
     `[-1.5, -0.5, 0.5, 1.5]` expanded; `Apply` of the same lambda, or a
     `list<number>`-typed parameter, gives the whole-list value. The expansion
     is what gives a whole-list function its value, so Tycho keeps it. (2) A
     symbol ASSIGNED an unevaluated expression is re-evaluated on every read
     (measured 2026-09-18: three reads of `W + 1` with
     `W := Abs(PointX(L)) + Abs(PointY(L))` over 2 000 points, 430 ms; the same
     with the evaluated value assigned, 67 ms). That is the definition semantics
     of an assigned expression, not a defect; a caller that wants a value must
     assign the evaluated value. Sharing the value of structurally identical
     sub-expressions during one `evaluate()` (`expr.digest` as the key) remains
     the engine-side option that would help every caller.
   - Each element of each broadcast operator is computed by boxing a new
     canonical function (`mapAtCell` and the drain iterator in
     `library/collections.ts`, through `computeBroadcastCell`): operator lookup,
     type handler, operand descriptor, allocation. Measured: 30–40 µs per
     element for `Abs(PointX(L))`, 60–80 µs for `PointX(L) + PointY(L)`, 140–190
     µs for `Conjugate(PointZ(L) / (PointX(L) + i PointY(L)))`. The comment on
     `evaluateElementwiseSelection` (`library/control-structures.ts`) quotes
     about 8 µs per element per condition for the lazy broadcast `Map`; that
     figure must be measured again on a built bundle.

The compiled route does not take this body: Tycho's `javascript` compile of
`C_cf` declines at `Abs` ("cannot compile a broadcastable head over a possibly
list-valued operand", `base-compiler.ts`), because `C_c` carries a
`number | tuple` element arm in its declared type. That decline is the
`s8ishknvhe` bullet of "JavaScript list-arithmetic declines, triaged"; after the
`conj` release the interpreted route serves `C_cf`.

### An element-wise ordering relation compares a NaN operand where the scalar branch treats it as undecided (OPEN — found 2026-09-12 by the Codex review of the selection index push-through)

A scalar branch whose relation has a NaN operand is UNDECIDED: the interpreter
answers `Which(NaN < 2, 1, True, 0)` with `Missing`, and the JavaScript target
guards the operand (`_.b === _.b && _.b !== undefined`) and answers `NaN`. The
element-wise form of the same selection decides the position instead:
`Which([1, NaN, 3] < 2, 1, True, 0)` is `[1, 0, 0]` in the interpreter (the cell
`NaN < 2` evaluates to `False`) and in the compiled run-time selection (the
fused loop reads `NaN < 2` as `false` and takes the default). The element-wise
EQUALITY already marks such a cell absent (the compiled-equality absent marker
landed 2026-09-10), so `select` consumes the position and answers `NaN` there;
the ordering relations (`Less`, `LessEqual`, `Greater`, `GreaterEqual`) do not
mark it, in the interpreter's element-wise relation handler or in the JavaScript
emitter. The pre-pass index push-through of 2026-09-12 (`fixed-width-unroll.ts`,
`indexedOperands`) rewrites `Which([a, b, c] < 2, 1, True, 0)[2]` to the scalar
`Which(b < 2, 1, True, 0)`, so a NaN `b` now answers the undecided value (`NaN`,
`Missing`) where the element-wise form answered `0`. The rewrite is kept: the
scalar answer is the ratified undecided-condition contract, and the fix belongs
in the element-wise ordering relations — mark a cell whose operand is NaN
absent, as the equality does — after which the two forms agree and the pre-pass
note on `indexedOperands` can go.

### A shared subexpression inside a shader lazy operand with no statement position expands once per occurrence (OPEN — found 2026-09-13, narrowed 2026-09-13)

A boxed expression is a DAG: `Max(e, e)` holds `e` once. The GLSL and WGSL
targets bind such a shared node to a temporary through the common-subexpression
pass wherever a statement position exists. A conditional whose arm repeats a
subexpression now takes the statement form (`gpuArmSharesWork` selects it,
`compileGPUStatementSelection` emits it), whose captured branch is a statement
position where the shared node is declared once. What remains is a shared
subexpression in a lazy operand that has NO reachable statement position: the
right side of an `&&`/`||`, and a conditional nested where hoisting is refused —
inside another arm, or an expression-only position. There the pass binds nothing
and the operand's text unfolds the sharing. Both shader languages lack a scoped
let-expression, so closing this needs a restructure that lifts such an operand
to a statement, or the acceptance that a deeply shared lazy operand stays
inline. (A separate, pre-existing cost: the common-subexpression pass itself
runs super-linearly on a very deeply shared DAG — a depth-20 shared tower takes
tens of seconds to compile even with no conditional, its emission linear. That
is in the harvest, not the conditional lowering.)

### `Match` with a case body that needs statements still declines on the shader targets (OPEN — found 2026-09-13 by the review of the statement-form conditional)

`If`, `When` and `Which` on the GLSL and WGSL targets take a statement form when
an arm needs statements (a loop-form `Sum`/`Product`, a `Block`, a `Loop`):
`compileGPUStatementSelection` in
`src/compute-engine/compilation/gpu-target.ts`. `Match` lowers through the
shared `compileMatchTernary`, whose case bodies are compiled by
`compileGPUConditionalArm` alone, so a `Match` whose case body holds a loop-form
`Sum` declines as every conditional arm did before the statement form existed.
The fix is to give `compileMatchTernary` the same statement form: the case tests
become the conditions and the case bodies the arms, under the same gate (no
effect in a case, no write outside the cases at the statement position). No
document of the code-generation audit has the shape; the entry records the
reachable decline.

### Compatibility gate for USER-DECLARED lazy operators (OPEN, demand-gated — opened 2026-08-19)

Design E's compatibility admission covers every eager slot and the library's
lazy collection operators (through their canonical-handler funnel,
`canonicalCallbackOperand`), but a user-declared `lazy: true` operator with an
arrow-typed callback slot still admits every callback until application —
`validateArguments`' lazy branches return each operand before the gate runs.
Closing it takes a read-only planning pass at the lazy branches whose payoff is
narrow by construction: the lazy solve contributes no bindings, so only GROUND
arrow slots could ever be judged, and an unbound operand's type reads `unknown`
(admits everything), so only NAMED callbacks read through a side-effect-free
`lookupDefinition` would be judged at all. Do this when a consumer actually
declares lazy operators with arrow slots, not before. (Recorded with reasoning
in `docs/TYPE-SYSTEM.md`.)

### Element-typed comparator arms need multi-variable union arms (OPEN, type-system — opened 2026-08-19)

The ruled `Sort`/`Ordering` slot spelling was
`((T) any -> unknown) | ((T, T) any -> number)` (Design E §9 item 6), but the
type language enforces "at most one arm of a union may reference a type
variable" — a solver-simplicity constraint predating Design E — so the
comparator arm shipped grounded as `(any, any) any -> number`: arity duality and
honest documentation kept, comparator-side disjointness rejection given up (a
`(string, string) -> number` comparator over an integer list is admitted and
fails per element). Restoring the ruled spelling means lifting the
one-variable-arm constraint in `parseType`/the solve, with its own blast radius
across union solving. Low urgency: the key arm keeps `T`, and no shipped
signature needs the second variable-bearing arm. (Deviation recorded in
`docs/TYPE-SYSTEM.md`.)

### Parameter-side callback inference (OPTION, demand-gated — opened 2026-08-19)

Ruled deferred (Design E R-E3): a callback operand's parameter types never bind
a data-anchored domain variable, so `apply2(IsPrime, x)` leaves `x` `unknown`
where it once inferred `number`, and `CountIf(zs, IsPrime)` leaves
`zs: collection<unknown>` (the ruling's anchor pin — binding it would
manufacture a contract the slot deliberately does not carry, breaking a later
`zs := [1, "a", 2]`). The seam is open in `solveArm`
(`generic-instantiation.ts`): R-E3′ already lets a callback bind variables with
NO data anchor (the ratified `comp`/`both` behavior), so the remaining question
is only the data-anchored case. If a consumer asks for apply-style inference,
the recommended shape is SOFT, PER-CALL, WRITE-FREE bounds: the callback's
parameter types may sharpen the call's instantiation (stamping and result
precision) but are droppable on conflict with any data bound (the union-source
flagship must never conflict) and never reach an `_infer` write (no symbol
narrowing, so the anchor pin holds). Full contribution with inference writes
would need the `zs` KEEP pin re-ruled. Do not build ahead of demand.

### The capability registry has handlers for `console` and `entropy` only (OPEN, effects, on demand — opened 2026-09-18)

`ce.effects` (the host capability registry, Stage 4 of `docs/EFFECTS-MODEL.md`)
holds two handlers: `console` (`Print`/`Input`) and `entropy`
(`RandomExpression`, and every random operator evaluated outside a
`WithRandomSeed` frame — the stated exception to the coupling rule, ruled
2026-09-18). The specification names four more: `network`, `filesystem`, `time`,
`environment`, and the `random` draw kernel. They were left out deliberately —
no library operator would read them, so a host could install an override and
nothing would change — and each is to be added with the first operator that uses
it.

- **`random`.** The seeded draw kernel `draw(seed, n)`, captured at frame entry,
  with compile declining for an expression that carries `random` while a
  non-default kernel is installed. Unframed draws are `entropy` now, so the
  kernel is only about replacing PCG3D under a frame.
- **`time`, `network`, `filesystem`, `environment`** have no operator yet. The
  first `network` operator (`Fetch`) is also the first operator that returns a
  promise, and it starts the admission of the `async` label.
- **Compiled code** draws through `_SYS.drawNextRandomNumber()` → `ce._random()`
  and, for the Monte-Carlo integrals, through the engine-bound
  `ce._liveRandom()`, so a mocked `entropy` handler applies to it, but a DENIED
  handler makes a compiled function THROW `CapabilityDeniedError` at run time
  (compiled code has no error-value channel, `docs/ERROR-MODEL.md` §6). A
  compile-time decline for a `random`-bearing expression under a denied
  `entropy` handler would fail closed instead; not built until a host asks.

### A free `i` in a subscript index is the imaginary unit on one canonicalization path and a symbol on the other (OPEN, low priority — consumers have a complete workaround; engine fix explored and reverted 2026-08-21)

Measured on a fresh engine: `A_{i,j}` canonicalizes to
`Subscript(A, Sequence(ImaginaryUnit, j))` — the index `i` becomes the imaginary
unit, and the matrix form `M_{i,j}` to `At(M, ImaginaryUnit, j)`, both
evaluating to `NaN` — while `A_{i+1}` canonicalizes to `Subscript(A, Add(i, 1))`
with `i` a plain `unknown`-typed symbol, and `\sum_{i=1}^{3} A_{i,j}` keeps `i`
as the bound index. The two free-`i` answers come from two code paths in the
`Subscript` canonical handler (`library/core.ts`): a parenthesized or comma
subscript arrives as a `Delimiter` and is canonicalized
(`sub = op2.op1.canonical`), so the engine-wide "unbound `i` is the imaginary
unit" convention applies; any other subscript expression is passed through
UNCANONICALIZED (`sub = op2`), which is what keeps `i` symbolic there — by
accident, and it leaves a non-canonical operand inside a canonical expression.
(A dead arm the handler also carried — a `Sequence` subscript rebuilt as a
`List` with the result discarded, no `return` — was removed 2026-08-21 and is
not part of what follows; it changed nothing.)

**What is actually wrong is the INCONSISTENCY**, not the default. The
engine-wide reading of an unbound `i` as the imaginary unit is right for a
general mathematical user, and changing it would be wrong for anyone doing
complex analysis. What no reading justifies is `A_{i+1}` and `A_{i,j}`
disagreeing, or a canonical expression carrying a non-canonical operand.

**A consumer whose domain has no complex arithmetic should declare the name, and
that is the recommended answer — it is strictly better than the engine change
explored here.** `ce.declare('i', 'integer')`, before anything is parsed, makes
`A_{i,j}`, `A_{i+1}`, `L_i`, `L[i]` and `M_{i,j}` all index by the symbol. It
reaches the bracket and `subscriptEvaluate` paths that an engine-side subscript
fix structurally cannot (below), `integer` rejects a fractional index at the
assignment boundary where `unknown` would pass one through, and round-trips stay
safe because the serializer emits `\imaginaryI`, never a bare `i`. The trade is
that bare-`i` complex literals in that scope become products (`2i` → `2·i`);
`\imaginaryI` remains available for documents that need both. `e` is the
opposite trade — declaring it breaks `e^x` — so it wants per-document scoping
plus `\exp(x)`, which canonicalizes to `Power(ExponentialE, x)` and is
unaffected by the declared variable.

A first engine-side implementation (a `canonicalSubscriptIndex` helper shielding
via `pushScope`/`declare`/`popScope`, plus removing the parser's `At` minting)
was reverted the same day after dual review. Its four constraints stand as the
bar for any future attempt:

- **A temporary shielding scope is not viable.** Canonicalizing the index under
  a pushed scope that declares the constant-named letters as plain symbols, then
  popping it, returns operands bound to a DISPOSED scope. Measured: two parses
  of `A_{i,j}` then answer `isSame === false` (the control `A_{p,q}` answers
  `true`), which breaks the unconditional equivalence relation `.isSame()` is
  documented to be and is relied on as a dedup/matching key. Any undeclared
  sibling name in the same index (`n` in `A_{i+n}`) is also auto-declared into
  the throwaway scope and is then disconnected from a later top-level
  declaration of `n`.
- **The parser's `At` lowering must stay.** Routing collection-base subscripts
  through the `Subscript` canonical handler (so the handler can see the index
  before canonicalization) removes the parse-time `At`, and the RAW form is a
  contract with a consumer: `ce.parse('a_{1}', { form: 'raw' })` must be
  `At(a, 1)`, pinned in `raw-subscript-fold-parity.test.ts` and
  `subscript-declared-name-precedence.test.ts` (10 tests fail otherwise).
- **`At` cannot shield in its own canonical handler.** `At` is not lazy, so its
  operands arrive already canonical — the index has become the constant before
  the handler runs. Shielding there needs `At` to hold its index position, which
  is a wider change than this item.
- **Three paths need the rule, not one.** Besides the two `Subscript` paths, the
  `subscriptEvaluate` branch (a base that owns its subscripts, the
  `declareSequence` shape) returns `Subscript(base, op2.canonical)` and folds a
  free `i` the same way; bracket indexing (`L[i]`) is minted straight to `At` by
  the parser and folds it too. A fix that covers only the `Subscript` arms
  leaves the same index meaning different things by notation.

Taken together these point away from a per-call-site shield and toward a
canonicalization-level mechanism — a way to canonicalize a subtree with
`holdUntil: 'never'` constant substitution suppressed for named symbols, which
every one of the four paths could then ask for. Since the declaration workaround
already covers the consumer case completely, the cheap half of this item is the
one worth doing on its own: make the two `Subscript` paths agree and stop
returning a non-canonical operand, without changing what a free `i` MEANS.

### Symbolic-side commutativity for `And`/`Or` — step 3 (OPEN, demand-gated)

Steps 1–2 (the `eq` handler comparing modulo permutation and nesting, and the
`commutativeMatch` definition flag driving the matcher's permutation branch)
shipped 2026-08-18 — see `CHANGELOG.md` and `logic-ac-equivalence.test.ts`. Step
3 of the agreed design ("Option B", 2026-08-16) — a gated canonical sort inside
`simplify()` so simplification can normalize operand order without touching the
written form or short-circuit evaluation — remains unbuilt by design: skip
unless a concrete workflow needs it.

### The declare-WITH-value route bypasses the default-`!scope` ceiling

`ce.declare('f', { type: '(...) -> ...', value: writerLiteral })` — the third
`assertDeclaredEffects` caller — installs a proven escaping writer without the
scope ceiling that the two declare-then-assign reconciliation routes got on
2026-08-15. It stays ungated because the same code path serves block-local `let`
bindings whose writer closures (a closure mutating its enclosing literal's
local) must remain installable, and no global-vs-local discriminator is
available at that seam: the Epsil static pass also evaluates top-level declares
under pushed scopes, so context depth does not separate the two. The arrow it
installs still carries the inferred `scope` label honestly, so the effect stays
visible; what is missing is the refusal.

### `.N()` still declines a few convergent series with a slowly decaying or doubly logarithmic tail (OPEN, low — residue of the fitted-exponent acceleration of 2026-09-29)

Since 2026-09-29 the infinite-series `.N()` fits the tail exponent of the
partial sums (`fittedExponentExtrapolation`, `library/utils.ts`) when the
integer-power Richardson tableau does not certify, so `Σ 1/n^1.5`, `Σ 1/n^2.5`,
`Σ ln(n)/n²`, `Σ (−1)ⁿ/√n` and `Π (1 + k^−1.5)` now evaluate. The fitted route
accepts only an error estimate at or under `max(1e-12, 1e-11·|v|)`, agreement
between the samples after `2^k` and `2^k + 1` terms, and a fitted exponent above
0.05, so a divergent series still declines. What stays symbolic, all safely:
`Σ 1/n^1.1` (a small exponent amplifies round-off, estimate 1.2e-10),
`Σ ln(n)/n^1.5` (does not certify under the tight tolerance), `Σ ln²(n)/n²`
(needs each exponent three times in the tableau), and a doubly-infinite sum with
a non-integer-power tail (the absolute-series check that runs first declines
it). An infinite product that does not converge now walks the full term budget
before it declines, as a declining sum already did.

### `Divide` over a bare dimensioned list types one tier wider than the tuple and lift paths

Deliberately untouched when `quotientComponentType` (`arithmetic.ts`) landed on
2026-08-15: `vector<finite_integer^2> / <integer-valued call>` routes through
the boxed-function broadcast arm and types `vector<finite_number^2>`, where the
tuple and `broadcastable<...>` paths derive `finite_rational` for the same
arithmetic. The wider claim is SOUND, just imprecise. Tightening it means
changing the shared broadcast-arm element computation, a different blast radius
from the per-component derivation that fixed the tuple and lift branches —
measure the snapshot count before starting.

### `TYPE_CACHE` evicts by clearing the whole map — a real cliff, dormant today

`TYPE_CACHE` (`common/type/parse.ts`) is capped at 2048 entries and evicts by
CLEARING THE ENTIRE MAP, on the stated assumption that the working set of
distinct type strings is small. That assumption fails for types carrying
LENGTHS: every distinct vector size is its own type string
(`vector<finite_integer^303>`, `^304`, ...). Measured by re-parsing a working
set of W distinct length-typed strings in a loop: W <= 2048 costs 0.02-0.11
us/parse, W = 2100 costs ~3-4 us/parse — a ~150x cliff — and stays flat above
it, because clearing drops 100% of entries per overflow so the hit rate
collapses rather than degrading.

Eviction POLICY is not the fix, measured: FIFO eviction of the oldest entry was
slightly worse (5.8 vs 4.3 us/parse over-cap), since a working set larger than
the cache, re-parsed in a repeating order, is the worst case for any policy. The
levers are reducing the number of distinct type strings (cache a
length-parameterized type by structure, with the length as a parameter) or
sizing the cache to the working set.

**Dormant, with a re-open trigger.** No real workload engages it: the largest
consumer document measured mints 329 distinct type strings — ONE of them
length-carrying — with zero overflow clears and a 97.1% hit rate over 11,245
reads, and the hundreds-of-distinct-sizes pressure existed only in a synthetic
probe. So the structural levers stay unbuilt and observability landed instead:
`TYPE_CACHE` reports under `CE_CACHE_STATS` as the `typeParse` class (hits, cold
stores, and `evictClear` — the count of whole-cache overflow drops).
**`evictClear > 0` on a real workload re-opens this item.**

### Deeply nested parentheses: the parser recurses on a deep raw tree (OPEN, pre-existing — found 2026-09-22 and 2026-09-25)

A chain of `Delimiter` wrappers boxes to its operand at any depth since
2026-09-25 (`canonicalDelimiter`, `library/core.ts`, removes consecutive
parenthesis wrappers iteratively; `boxing-deep-trees.test.ts`), and the walk
that looks for objects owned by another engine (`containsForeignEngineObject`,
`boxed-expression/type-guards.ts`) uses an explicit stack. Two things stay:

- The LaTeX parser's own recursive descent
  (`parseEnclosure → parsePrimary → parseExpression`) throws at about 1,870
  nesting levels. Unreachable from realistic input; a parser change.
- `.toString()` and `.evaluate()` on a NON-canonical `Delimiter` chain 5,000 or
  more levels deep still overflow (the canonical route no longer produces such a
  chain; a raw-boxed chain that is serialized before canonicalization reaches
  it).

Also found 2026-09-25, a decision: a `Delimiter` whose delimiter is not a
parenthesis (`'[]'`) is canonical while its operand is the RAW operand, not the
canonical body the handler computed
(`ce.box(['Delimiter', ['Add', 1, 2, 'x'], "'[]'"]).op1.isCanonical` is
`false`). The handler's comment says delimiters are left uninterpreted so other
operators can read them, so this may be intended; if not, changing it touches
snapshots.

### The LaTeX parser cannot honor a deadline at all (OPEN but DEPRIORITIZED — ruled 2026-08-19 unlikely to ever be scheduled; found while fixing canonicalization deadline granularity, shipped 2026-08-15)

**Ruling (user, 2026-08-19): this is unlikely to be prioritized, because the
inputs that make it matter are self-inflicted.** The megabyte-scale parses
observed in the field come from the consumer fanning out and RE-TEXTUALIZING
expressions to LaTeX, then re-parsing the result — LaTeX used as an internal
interchange format, which it is not. The supported answer is to stop
round-tripping through LaTeX text: keep expressions boxed and hand the engine
structure directly (raw MathJSON via `ce.box`, or Epsil source — both routes are
deadline-aware since 0.111.0/0.116.0), so parse cost stays proportional to what
the user actually typed. The analysis below is kept because it is correct and
hard-won (the budget is decorative on this path — tightening it buys nothing),
and because the fix shape at the end is the right one if a non-self-inflicted
workload ever surfaces. Consumers were told to plan around this entry, not for
it (CE-0.116.0 pre-release brief, 2026-08-19).

The canonicalization deadline-granularity fix of 2026-08-15 bounds the SMALLER
and better-behaved half of `ce.parse(…)`. The RAW PARSE is the expensive half,
it grows superlinearly, and it is the unbounded one — so the share of
`ce.parse()` that ignores a deadline gets worse as inputs grow. Medians of 3,
fresh engine per run, `form: 'raw'` isolating the parser from canonicalization:

    N        raw parse   canonicalization   raw : canon
    3 000     71 ms          45 ms            1.6 : 1
    6 000    209 ms          49 ms            4.3 : 1
    12 000   719 ms         111 ms            6.5 : 1

Canonicalization is close to linear; the parser is not (roughly 3x per
doubling). An earlier note on this entry recorded the two halves as "about the
same" from a single 6 000-term measurement of 608 ms and 657 ms — that pairing
does not reproduce, and taking one size as the ratio hid the fact that the ratio
itself moves.

`form: 'raw'` does NOT avoid the problem, which is worth stating because it is
the obvious workaround: skipping canonicalization skips the half that is already
bounded and keeps the half that is not. A raw parse under a 1 ms budget and
under a 50 ms budget both ran ~560 ms.

**The consumer-facing danger is not the size of the overrun, it is that
TIGHTENING THE BUDGET BUYS NOTHING.** Elapsed time is essentially independent of
the budget, because the parse runs to completion and only then notices it was
cancelled. Measured 2026-08-15 on a 12 000-term sum, against the now-fixed
canonicalization half for contrast:

    CANONICALIZE   budget  1 ms → elapsed  17 ms   (17x)
    CANONICALIZE   budget 50 ms → elapsed  51 ms   (1.02x)
    PARSE          budget  1 ms → elapsed 832 ms   (832x)
    PARSE          budget 50 ms → elapsed 795 ms   (16x)

So an operator tuning a span DOWNWARD to bound a risk does nothing at all while
believing the risk is bounded — no error, a plausible configuration, and no
effect. That is worse than a large constant overrun, which at least responds to
the knob. A consumer whose spans wrap parse AND canonicalization has, after the
canonicalization fix, bounded the half that was already the more responsive one.

**FIELD EVIDENCE (consumer audit, 2026-08-15): on the paths where this matters
most, the canonicalization fix buys nothing at all — not half.** The consumer
already passes `form: 'raw'` at its three hottest parse sites: the Desmos import
session (their largest workload, with no deadline armed at any level), the
action-firing path (a 50 ms budget, one parse per step), and formula
classification (a 5 000 ms budget). Because `form: 'raw'` skips canonicalization
entirely, 100% of the cost at those sites is in the unbounded parser. Their
audit had recorded the exposure as "half fixed, half remaining", which was wrong
in the reassuring direction for exactly the sites that matter.

**FIELD MEASUREMENT ON REAL CONTENT (Tycho, on imported Desmos formula slots,
2026-08-15) — quote this WITH its shape caveat or not at all.** 6 679 slots
across 585 states: **0.232 ms/slot raw, 0.380 ms/slot canonical, worst single
slot 71 ms** (a 69 KB list literal), and the **worst slot under a 50 ms span
elapsed 53.9 ms — 1.08x**, against the ~110 ms the synthetic curve above
projects.

The caveat is not decoration: **their slots are wide flat LIST LITERALS, not
deep operator chains**, which is exactly why they land an order of magnitude
under the projection. Quoted bare, these numbers support "the unbounded parse is
not a problem in practice", which is FALSE for content that is deep chains
rather than wide literals. The field number is evidence for that shape; the
synthetic curve remains the right guide for the other. Recorded at the
consumer's own insistence, and against their interest — it lowers the urgency of
work they had asked us to prioritise.

Priority argument for whoever picks this up: the action-firing span is an
INTERACTIVE path — a user waiting on a direct interaction, with the budget
chosen to protect responsiveness — while every other exposed span they have is
background or batch, where an overrun costs throughput rather than perceived
latency. That is the case where fixing this changes user-visible behaviour
rather than tightening a bound.

This is NOT the same fix. The parser has **no engine handle at all**: nothing
under `latex-syntax/` references `ComputeEngine`, `_deadlineFrame` or
`_timeRemaining`, which is deliberate — `LatexSyntax` is an injected,
structurally-typed dependency (`ILatexSyntax`), and that decoupling is the
architecture described in `CLAUDE.md` and `ARCHITECTURE.md`. So there is no
deadline for a strided check to read, and adding one means threading a deadline
(or an abstract "should I stop" callback) across the `ILatexSyntax` boundary.

Fix shape when picked up: give the parser an optional cancellation callback
supplied at construction or per-parse, checked strided in `parseExpression`
(`latex-syntax/parse.ts`), the recursive chokepoint of the parse walk — and keep
it engine-agnostic so the boundary stays structural. Deferred from the
2026-08-15 round deliberately: it is an interface change to a decoupled
subsystem, not the localized addition the canonicalization half was, and it
should not land in the same pass as a release.

### `process.env`-gated diagnostics are stripped from the published bundle

Measured against `dist/esm-min/compute-engine.js` (2026-08-14): `process.env`
occurs 0 times, and so do `CE_CACHE_STATS` and `mapAutoCompileStats`. Every
`process.env`-gated diagnostic in this repo — `CE_CACHE_STATS`, `CE_DEBUG_DEPS`,
`CE_MEMO_PARANOID` — is therefore ELIMINATED from the published artifact, not
merely defaulted off in it. They serve CE's own Node-side debugging and CI, and
are unreachable for EVERY consumer of the package, browser or Node alike; adding
another one reproduces the same dead end a consumer already hit asking whether a
`Map` drain compiled.

The established shape for a consumer-reachable diagnostic is an `_`-prefixed
ENGINE MEMBER (`_deadline`, `_random()`, `_compile()`, and now
`_mapAutoCompileStats`): it survives bundling, needs no subpath export, and
works in a browser, which is where the consumer asking the question runs. One
surface was converted that way on 2026-08-14; whether the remaining env flags
should follow is UNDECIDED as policy. Note for whoever picks it up: a new engine
member must also be declared on `IComputeEngine` (`types-engine.ts`) — that
applies to `_`-prefixed members too, 60 of which are already declared there — so
each conversion is an implementation + interface change, not a one-file edit.

### Degree-mode folding flips `angularUnit` per fold attempt, purging caches (OPEN, perf — small)

Measured before `foldCostEstimate` replaced the wall-clock budget. That change
narrows the exposure but does not remove it: the cost gate returns BEFORE the
setter is touched, so a subtree the estimator declines now costs nothing here,
while every subtree that actually folds still pays the two purges below. The
numbers therefore still hold for the folding case, which is the common one.

The 0.108.0 degree-mode fold fix neutralizes `engine.angularUnit` around each
constant-fold evaluation (necessary — see the CHANGELOG entry). The setter is
not a cheap flag: `set angularUnit` calls `_reset()`, which runs `purgeValues()`
on the cache store. So a degree-mode compile pays two cache purges per fold
ATTEMPT.

Measured (60 constant subtrees, median of 5, javascript target): angular
constants 4.2 ms in radian mode vs 9.4 ms in degree (2.2×); NON-angular
constants 0.3 ms in both. So the cost is not the flag itself — it tracks how
warm the purged caches are, and only an angular-heavy degree-mode compile is
warm enough to notice.

Note what that rules out: narrowing the gate to "subtree contains an angular
operator" would save nothing, because the penalty falls exactly on the subtrees
that genuinely need the neutralization. The fix that would work is hoisting the
neutralization to the compilation boundary so it happens once — but that is not
free either, because `compileDerivative` (`library/calculus.ts`) calls
`rewriteAngularUnit` DURING compilation and that function reads `ce.angularUnit`
from the engine. Hoisting therefore has to make the derivative lowering's unit
explicit rather than ambient, or degree-mode derivatives silently stop being
rewritten. Raised by the compilation session, who own the folder.

### Lazy infinite-collection compilation — v1 limits (JS target)

`Take`/`TakeWhile`-bounded infinite pipelines compile to lazy `_SYS` iterator
streams as of 2026-08-13 (`emitLazyStream`, `javascript-target.ts`; tests in
`compile-lazy-collections.test.ts`). The v1 lazy algebra is deliberately small —
sources: `Range` with a literal `±∞` stop; transformers:
`Map`/`Filter`/`Drop`/`Rest`; bounders: `Take`/`TakeWhile`. Everything else
fails closed at compile time with an error naming the bounding fix. Not defects
— each is a clean compile-time decline today — but natural extensions:

- **More lazy sources**: 1-argument `Repeat(v)` (its handler still fails closed
  with the pre-existing "no compiled representation" message, now only true
  outside a bounding consumer) and `Cycle` (which has no compile handler at
  all).
- **More bounding consumers**: `First`/`At(k)`/`Find`/`IndexWhere` over an
  infinite stream all have finite answers a lazy scan could produce; today they
  fail closed.
- **A symbolic step with an infinite stop** (`Range(1, ∞, s)`) is not lazily
  compilable: a runtime-negative step means an EMPTY range, and a stream cannot
  decide that lazily (see `infiniteRangeStep`).
- **Python target**: no lazy lowering — a non-finite `Range` bound fails closed
  at compile time even under `Take` (a documented divergence from the JS
  target).
- `DropWhile` over an infinite source is INERT in the interpreter, so it
  deliberately does not compile — parity, not a gap.

### `Error` match normalization is root-only (limitation)

An `Error` subject is normalized for pattern matching at the ROOT of the match
only: its `ErrorTrace` breadcrumb is stripped, and its where/site operand is
stripped when the pattern's arity doesn't ask for it (`normalizeErrorSubject`,
`match-dispatch.ts`). A sited or bubbled error NESTED as another error's cause
is not normalized, so an `Error(Error(c))` pattern does not see through the
inner error's where or trace. This predates the 2026-08-13 site operand —
trace-stripping was always root-only — and extending it needs the generic
recursive matcher to normalize `Error`/`Error` subject–pattern pairs as it
descends. Surfaced by the dual review of the site-operand change; no known user
report.

### Named-argument calls — v1 residuals

Named-argument calls shipped 2026-08-12; the durable lowering contract is in
`docs/LANGUAGE-MODEL.md` and the full surface specification is in
`docs/TYPE_SYSTEM_ROADMAP.md` Appendix C. One deliberate v1 limit remains open.
(A declared-only overload set declining a named call whose name-eliminated arm
is more specific is RULED correct behavior, 2026-08-13: the engine asks the
author to be explicit rather than guessing, design doc §4. What still declines
through `Apply` is a callee whose names are genuinely not knowable there: a
symbol callee (`Apply(f, x: 1)` — write `f(x: 1)`), and a literal with a
parameter that is not a bare symbol or `Typed` annotation.)

- **Unannotated function literals are not addressable by name through a
  BINDING** — type inference drops parameter names (`effects-inference.ts` types
  a bare parameter as `{ type: 'unknown' }`), so
  `f := (a, b) => …; f(a: 1, b: 2)` declines even though the same literal
  applied inline now works. MEASURED 2026-08-13: the one-line fix breaks 37
  tests across 11 suites + 1 snapshot, including semantic suites
  (`effects-contracts`, `application-validation-regressions`, callback-contract
  and lambda-inference batteries) — a dedicated follow-up round, not a snapshot
  refresh.

### `Derivative` compile time vs body nesting depth (perf ask)

The capability half is closed (2026-08-14, user-ruled): past the differentiation
growth budget the javascript compile emits an 8th-order centered-difference
stencil (`_SYS.nd`) and interpreted `N()` computes the same shared function,
bit-identical across routes (`compile-derivative-numeric-fallback.test.ts`).

**Open residual (perf):** the failed symbolic attempt still runs to the growth
budget before the fallback engages — once per derivative node per compile (~1–2
s per node on the deep shapes; Tycho's Taylor witness pays it three times, once
per order, because each order's `derivative()` call re-runs the shared first
differentiation). If Tycho's compile-band gates trip on this, the fix is an
over-budget memo keyed on the resolved function LITERAL (shared across the
sibling `Derivative(f, k)` nodes) + the semantic version — not a lower budget,
which would change which expressions get exact derivatives.

Historical numbers (pre-fallback): order-1 compile 6/21/77/429 ms at depth
1/4/8/16, THROWS at depth 37, undifferentiated body single-digit ms at every
depth. (Reported by the Tycho project as its item 177, `docs/COMPUTE_ENGINE.md`
in `dev/tycho`; bare-engine repro `docs/scratch/d209-ce-asks-repro.mts` there.)

### Static argument-checking of user-defined callees — residue

Static checking of calls to `function` definitions landed 2026-08-12
(`DefineFunction`'s canonical handler installs the clause once the body has
canonicalized, so later statements of the same program validate against the real
signature; `CHANGELOG.md`). Two cases stay unchecked until they evaluate:

- **Generic definitions.** Rule G2 refuses any clause onto a generic target,
  which makes the install non-repeatable, and the evaluate route would then
  reject its own re-installation. Closing that exclusion means deciding which
  route OWNS the clause install, so the second one can recognise its own work
  rather than re-running it. Worth doing together with anything else that wants
  canonicalization and evaluation to share an installation step.
- **An ALIAS of a binding that holds a function literal**
  (`let k = (n: integer) => n + 1`, `let g = k`, then `g(1.5)`), because the
  pass pins a signature only from a function LITERAL (`registerPinnedSignature`,
  `src/epsil/static-diagnostics.ts`) and an alias's static type is an upper
  bound, not the signature the binding will hold.

### Dead post-install `effectsDeclared` write in `defineFunctionClause`

Found 2026-08-19 while journaling the checkpoint hooks (dual review of stage
C1). In `multi-clause.ts`'s `defineFunctionClause`, `retarget` is the operator
half in force before the clause is installed, and after a SUCCESSFUL install the
code writes `retarget.effectsDeclared = incomingExplicit !== undefined`. By then
`retarget` is an orphan: `ce.assign` routes to `updateDef`, which constructs a
fresh `_BoxedOperatorDefinition` for a plain-object definition and swaps the
record's pointer to it, so the write lands on an object the binding no longer
holds. Verified by probe: after `w(x: integer) = x + 1` then
`w(x: string) = "s"`, the captured pre-assign half is not the installed one.

Not an observable defect today — the installed half derives the same
`effectsDeclared` from the incoming literal, so the live definition ends up with
the value this write intends — and the same statement's REFUSAL path (the
`catch`) does need the write, because there the old half is still installed. So
the write is dead on one path and load-bearing on the other, and its comment
describes only the second. Left as-is rather than "fixed" because re-deriving
the target after the install would change which definition the
effects-annotation contract is recorded on, and `contractViolation` reads that
flag; that is a decision about the effects-provenance contract, not a mechanical
repair. What to do when someone picks it up: either drop the success-path write
and say in the comment that the install derives the flag, or re-fetch the live
half and write it there — and pin whichever with a test that distinguishes the
two.

### The strict linear posture initiative — the remaining Epsil-route flip (RATIFIED 2026-08-18; stages R1/C1/C2/C3/v2 shipped 2026-08-18/19)

Arno ratified (2026-08-18, with Tycho's code-verified concurrence):
cross-program redefinition of types/protocols/conformances/same-signature
clauses becomes an ERROR on the Epsil (`executeEpsil`) route only — the box
route and host API keep today's replace/throw semantics permanently (Tycho's
recompute passes re-assert declarations via the box route every 300 ms and
depend on idempotency) — and the notebook edit gesture moves to the engine
`checkpoint()`/`restore()` API, which is shipped (contract in
`docs/CHECKPOINT-MODEL.md`; stages R1, C1–C3 and checkpoint v2 all landed
2026-08-18/19 and are pinned, incl. `checkpoint-in-scope.test.ts` and the
differential harness).

What remains is the last stage: **the Epsil-route strictness flip and the
deletion of the superseded machinery** (~1,384 source lines, ~1,891 test lines,
≈92 test flips — audit §5 of
`docs/plans/2026-08-18-checkpoint-restore-design.md`), gated on Tycho shipping
restore-before-Run client-side. Until then both mechanisms coexist.

### Protocols residue (protocols + compiled dispatch landed 2026-08-12)

- **A provisional rebuild of a VALUE-bound literal never re-verifies its
  declared effects contract** (found 2026-08-14, dual review of the
  effects-provenance + Phase-0a staged set). `installRebuiltLiteral`
  (`function-utils.ts`) swaps a value definition's stored literal via the bare
  `value` setter, which touches neither `type` nor `effectsDeclared` — so a
  binding declared `(…) pure -> …` whose body froze a provisional application
  can have that body rebuilt into an EFFECTFUL one with no contract check on
  this route (the operator branch re-validates inside `update()`). Reachable
  only through the provisional-dependents cascade on declare-then-assign value
  bindings; the fix is an `assertDeclaredEffects`-style check in the value
  branch, re-deriving the rebuilt literal's effects against the declared arrow.

- **A value-bound function literal's arrow is baked into callers' effect
  stamps** (recorded 2026-08-14, Phase-0a residual). The derived-effects
  re-derivation (`consultsRegistry`, `effects-inference.ts`) keeps a definition
  fresh when its body reaches a protocol dispatcher directly or through
  OPERATOR-definition callees, but a body that reaches one only through a
  VALUE-bound literal (`g := (x) => speak(x)` stored as a value binding, then
  `f` calling `g`) freezes `g`'s arrow as read at `f`'s install: the walk cannot
  see that the value's own arrow is registry-dependent. Consistent with the
  shipped construction-time snapshot semantics, but it narrows the widening
  guard's transitive reach on that path. Lifting it needs a registry-dependence
  bit on the LITERAL's arrow (or type), not just on operator definitions.

- **`InverseFunction(f)` / `Derivative(f, n)` as a lazy operator's callback are
  rejected** (found 2026-08-13; same family as the qualified-protocol-member
  callback fix that landed that day). `Map(InverseFunction(Sin), [1, 0])`
  reports `incompatible-type function/unknown`: the held callback arrives RAW,
  where its type reads `unknown`, so the function-value gate (`denotesFunction`,
  function-utils.ts) cannot answer and the constant-nullary reject fires. A loud
  error, not silent wrong values — and the explicit-lambda spelling
  (`Map((x) => InverseFunction(Sin)(x), xs)`) works. The protocol-member case
  was fixable with a registry-keyed syntactic recognizer
  (`isQualifiedProtocolMember`); these shapes need per-operator knowledge
  ("which operator applications denote function values when raw?") — a small
  denotes-function operator table, or canonicalizing the callback operand before
  the gate, would lift them.

### Contextual callback typing residue (Design D landed 2026-08-09)

The `callback<S>` conversion of the 15 collection operators closed with these
items open. Items marked RULED-DEFERRED have a maintainer decision on record;
the rest are recorded here so they are not rediscovered from the outside.

**Deferred by ruling (each names what unblocks it):** RULED 2026-09-22 (a):
desugar to one conformance edge per variant with `Self` the variant; a variant
added later re-runs the conformance; a per-variant duplicate is an error.

- **`Map`'s honest signature spelling** — the declared
  `(collection<T>, mapping: callback<(T) -> U>, collection*)` misorders the zip
  form's callback-last convention; the type system cannot spell
  required-after-variadic. RULED-DEFERRED 2026-08-09 (spec §9 item 5b, with the
  two candidate fixes: suffix-parameter support, or flipping `Map` to
  callback-first). Unblocked by: choosing one.
- **Standalone-lambda runtime check emission** — `literal.compile()` then
  `run(violatingValue)` silently computes where the interpreter errors; every
  in-engine route is enforced. RULED-DEFERRED 2026-08-09 with the direction
  fixed (per-primitive check-emission table + "unenforceable → decline"); see
  the "Known limit" section of `docs/TYPE-SYSTEM.md`.
- **`FlatMap`'s `evaluate` materializes on the SOURCE's finiteness alone** — it
  retains the optimistic assumption its `isFinite` facet dropped (2026-08-09);
  re-gating on `expr.isFiniteCollection` would make every unprovable-callback
  `FlatMap` stay symbolic. Needs a ruling before changing.
- **Phase 4: comparator slots** (`Sort`, `ChunkBy`, …) — whether they convert to
  `callback<(T, T) -> …>` at all (spec §9 item 6).
- **Seeded-fold accumulator stamping** — deliberately never stamped (spec §12.1:
  stamping it breaks type-changing accumulators, probed); re-opening needs a
  bound (`forall T, U: value.`) and a re-ruling.

**Known limits, recorded in spec §9b, no action unless demanded:** binder-route
(`rawOps`) applications skip the contextual stamp (unreachable today — tripwire
comment at the gate); `callback<S>`'s parameter-position-only intent is
unenforced (other positions behave as `function`); a union of two DIFFERENT
`callback<S>` members resolves first-seen; undeclared source symbols infer
`collection<unknown>` (the standing polytype behavior).

**Cleanups (opened 2026-08-09):**

- **An eager IMPURE collection source is evaluated several times**
  (pre-existing, measured 2026-08-09 during the above): counting handler
  invocations over a 5-element source, `Map(f, RandomShuffle(xs))` evaluates the
  shuffle **8** times, `Filter(RandomShuffle(xs), p)` 5, `Any(…)` 2 — the
  materialize-then-iterate path in `each()` re-evaluates a source that has no
  collection handlers, once per facet query. Results stay correct; the number of
  DRAWS consumed does not, so a seeded program is not reproducible across these
  shapes. Needs the evaluated form to be computed once and threaded through the
  facets.
- **`FlatMap` has no `count` facet**, so `Length(FlatMap(…))` is inert even when
  the result is provably finite (a count requires applying the callback per
  element — needs a design, not a one-liner).
- **Nested `Map`/`Filter` canonicalization is superlinear in depth** (measured
  2026-08-09: 10→20 levels ≈ 2.65× on both the current and the pre-conversion
  path — pre-existing, cause unidentified).
- **Bounded numeric element types** (`integer<1..10>`) and value-literal types
  still decline the stamp admission gate (`admissibleElementType`) — a one-line
  widening if ever wanted.

### Broadcast semantics residue (element-wise lowering landed 2026-07-26)

The element-wise compiled lowering shipped, and with it the two interpreter
rulings it depended on (record in `CHANGELOG.md`). The ordering relations and
the logical connectives now broadcast on the JavaScript target through
`_SYS.bcast`; broadcast operands are evaluated ONCE; and a length mismatch is
`incompatible-dimensions` across the eager zip, the arithmetic broadcast and the
lazy form, instead of a silent zip-to-shortest. (`PointList` opts out by design
— it zips components rather than broadcasting an operator, and its shortest-zip
is a consumer contract.) The full policy — strict for LIFTED operators, shortest
for explicit PAIRING constructors (`Zip`, variadic `Map`, `PointList`) — is
recorded in `docs/BROADCAST-MODEL.md`. Genuinely remaining:

- **An operand whose length is not yet KNOWN is not compared.** The check reads
  `count`, so a participant reporting `undefined` (a symbolic-length `Range`
  before its bound resolves, an operand held raw by a lazy operator) is skipped
  and the broadcast proceeds. It is the lazy `Map` that then zips those, and the
  variadic `Map` uses shortest-input semantics — so a mismatch that only becomes
  visible after the length resolves can still truncate silently. Diagnosing it
  means a strict lazy zipper that reports `incompatible-dimensions` when one
  participant ends before another, which is a change to `Map` iteration, not to
  this check. (An _infinite_ operand is already caught: `count` is `Infinity`,
  which mismatches any finite length.)
- **A compiled ordering cannot tell an ERROR operand from a numeric NaN.** Both
  are NaN at the ABI, and `NaN < 3` is `false` — which is right for a numeric
  NaN (IEEE) but wrong for an error, where the interpreter stays an error. The
  connectives are guarded (`guardConnectiveAbsence`), because there JS coercion
  produced a plainly wrong truth value (`!NaN` → `true`); the orderings would
  need a distinct absence sentinel carried through nested broadcasts to do
  better.

- **Python connectives over a boolean list may be wrong, not declined**
  (reported by the roadmap audit of 2026-09-29, not yet independently verified).
  Orderings over a list or `broadcastable<number>` operand compile through the
  `_ce_ord` helper since 2026-08-08, but `And`/`Or`/`Not` over a `list<boolean>`
  operand reportedly emit Python truthiness (`bs and q`, `not bs`) where the
  interpreter broadcasts (`And([True, False], True)` is `[True, False]`): a
  silent divergence. The target has no generic scalar-closure broadcaster for
  connectives; until it does they must decline. `_ce_bcast` matches the mismatch
  ruling for the heads it does cover (`ElementMax`/`ElementMin`/`Clamp`).

### Compile-target coverage (ledger opened 2026-07-30)

Until 2026-07-30, "which heads have no lowering on which target" was tracked
nowhere in this repo — it lived only in the consumer's census markdown, so every
gap was rediscovered from the outside. This is the ledger. It was sized by an
external corpus (Tycho's 684-document Desmos corpus at CE 0.99.0; the entry
"Code-generation census on CE 0.128.13" above carries the current counts), so
the `members / states` counts are a proxy for demand from one workload, not a
ranking of importance. A compile decline is not a slow path — the consumer's JS
wrapper installs a `() => NaN` stub, so a declining row **draws nothing**. Treat
these as correctness gaps with a performance-shaped symptom. It is a ledger, not
a work item: scope a session to one entry, and give a design-first entry (the
`Integrate` row) a design pass before an implementer touches it. The landed
rounds of 2026-07-30 to 2026-08-30 that this ledger used to narrate are in
`CHANGELOG.md` and git history.

**JavaScript band.**

- **JavaScript band** (230 members / 81 states fail). Per the consumer's
  per-bucket provenance rules, **82 members / 25 states are our target gaps**;
  the other 148/61 are their own unexpanded user-function heads, unparsed LaTeX,
  and document-defined function heads. (Their first pass called the whole
  remainder ours — 202/69 — and they corrected it in review. Use 82/25.)

- **Multi-clause user functions** (feature-parity note, 2026-08-02, no corpus
  sizing yet): the §8 guard chain compiles on the **JavaScript target only**.
  The interval, GLSL/WGSL and Python targets decline the whole function (fail
  closed, interpreted fallback). Interval needs interval-aware guards; the
  shader targets need a monomorphized (per-call-site arity) lowering since they
  have no variadic dispatch.

- **Generic user functions: what still declines.** The bound reading landed
  2026-08-30 (a quantified parameter is read at its DECLARED BOUND, at the call
  boundary and in the body, on the engine and block-local routes alike;
  `test/compute-engine/compile-generic-monomorphization.test.ts`). Per-call-site
  monomorphization was rejected, not deferred: it would reintroduce the
  `$`-suffixed specializations retired 2026-08-16 and has no call site on the
  value-position route.

  **What still declines** (whole-fn, with the sound interpreted fallback): a
  variable with NO ground bound — `(x: T) -> T where T` names no type to compile
  against, so `gd(y)` there emits no `_fn_gd` and the fallback runner answers
  `42` for `y = 21` and `[2,4,6]` for `y = [1,2,3]`; every target other than
  JavaScript, since the coercion and the `_SYS.bcastFn` broadcast are JavaScript
  conventions and the shader targets synthesize a static signature this reading
  was never validated against; a declared `broadcastable<T>` parameter over a
  possibly-collection argument, which fails closed as before; and a body whose
  bound does not prove the capability it needs, such as an indexed read under a
  `collection<number>` bound.

**GLSL/WGSL band** (the GPU→CPU demotion class).

- **`Integrate` on glsl — design question first.** Quadrature inside a shader:
  which rule, what iteration budget, what happens on non-convergence. Large; do
  not start without deciding the budget question. The one design-first entry
  left from the 2026-07-30 triage (22 states in the 0.99.0 census).
- **`At` on GPU — residue after the 2026-08-01 landing** (scalar-index and
  literal-gather tiers over statically-sized numeric bases shipped; design and
  rulings in `docs/COMPILATION-MODEL.md`, whose D4 disposition table is not to
  be re-derived):
  - **Point-list bases: blocked on §3.F** (the node types `missing | tuple` and
    the object-domain-absence gate intercepts before any GPU table entry).
    Unblocking needs its own ruling: a per-operator absence projection (Missing
    point → NaN-component vector), or in-range type narrowing. Filed with the
    consumer item.
  - Demand-gated: static-count dynamic gather (near-zero cost to flip — the same
    helpers in a constructor; witness count requested from the consumer), gather
    K > 4 (width ceiling), gather K 0/1 (the pinned 1-element-list contract has
    no shader shape), dictionary/string-key/ multi-index forms.
  - Permanent (not TODOs): runtime-valued boolean masks (result length is not
    static — no shader value shape), unknown-length bases/index lists.
  - Latent observation from the round (own look, out of scope):
    `BaseCompiler.isComplexValued` answers `true` for a literal `List`
    containing one complex element, skewing `aggregateComponentCount` for other
    callers.
  - No retirement of the 26-state count without the consumer re-measure.

- **`PointList`/`PointZ` — residue after the 2026-07-31 landing** (rulings in
  `docs/COLLECTIONS-MODEL.md`; GPU _construction_ stays fail-closed **by
  ruling** — no runtime-length GPU expression values). Remaining, all
  demand-gated:
  - Non-`isListType` components (tuple/set/union-with-collection) still decline
    on JS — lowering is deliberately narrower than typing (no per-point
    representation for such a slot).
  - The **type handler's** `isListType` (`collections.ts`) classifies a bare
    `tuple`-typed or all-collection-union component as a list — so
    `PointList(k, P)` with `P: tuple` types `list<tuple<number, unknown>>` and,
    since 2026-09-29, also evaluates to a list whose second coordinate is the
    whole point (`[(1, (5, 6)), (2, (5, 6))]`): the routes agree, but the shape
    wants a decision. The compile predicates were hardened against this (staged
    review 2026-07-31); aligning the type handler is interpreter-visible and
    wants its own pass. Same-family holes, same pass: `hasPointElementType`
    (`collections.ts` ~684) accepts only `{kind:'tuple'}` nodes, not the bare
    `'tuple'` string; and projecting an **empty** point list diverges (compiled
    `[]`, interpreter absence — the evaluated empty transpose types
    `list<never>`, so the point-ness is unrecoverable; pinned as a known parity
    edge in `pointlist-compile-zip.test.ts`).
  - No corpus re-measure yet: how much of the 11 st / 36 mem + 2 st actually
    closed is the consumer's count to re-run — do not mark this bucket resolved
    on our numbers.

- **Still open from the GPU invalid-source sweep** (the unary fan-out and the
  generic function-codegen paths were closed 2026-07-30 with
  `gpuIsComponentwise` / `gpuOperandShape` / `gpuCheckOperandShapes`, whose
  per-language shape tables default to their intersection so a new subclass
  fails closed):
  - **Complex-element collections** — `gpuOperandShape` reads a list of complex
    elements as `scalar` (via `isComplexValued`'s operand fallback), so the
    generic gate is inert for them. The fan-out path declines them explicitly;
    the generic path needs a separate complex-element rule.

  - `LCM` and `GCD` over a run-time vector still need their own lowering
    (`GCD([4,6,8])` evaluates to `2` but `GCD(v)` declines with "need at least
    two arguments"; measured 2026-09-29); `Product(v)` compiles to
    `(v.x) * (v.y) * (v.z)`, `Sum` over a static vector compiles and `Length`
    declines by design (measured 2026-09-21).

**Standing sweep — audit the other compile-time refusals for the same
inconsistency.** The `realOnly` constant-fold refusal (retired 2026-07-30:
`Sqrt(-N)` folds to the complex value, or to `NaN` under `realOnly`, on every
target) was not a one-off, it was an instance of a class: _a deliberate refusal
enforced at some sites but not at the sibling sites_. A rationale comment and a
passing test establish **intent**; neither establishes **consistency**. The
check is cheap — for each refusal, probe the same mathematical situation reached
a different way (via a variable, an assigned symbol, a different head in the
same family, a different target) and see whether it is refused there too.

Known candidates, all currently defended as "documented and deliberate":

- **Python arithmetic over a collection — what still fails closed after the
  2026-08-30 fan-out (recorded).** An arithmetic head with exactly ONE
  collection operand — an ordered list of numbers, every other operand provably
  a number — compiles as a list comprehension (`tryCompilePythonElementwise`,
  `base-compiler.ts`; parity pinned in
  `test/compute-engine/compile-python-parity.test.ts`). Three shapes keep
  failing closed, each for a reason no Python emission removes: two or more
  collection operands (NumPy silently recycles a length-1 axis and a `zip`
  comprehension truncates, where the interpreter answers
  `incompatible-dimensions`); a collection whose elements are not scalars (a
  matrix or a point list, where one level of fan-out hands a row or a point to a
  scalar operator); and an operand that is only possibly a collection
  (`broadcastable<T>`, a top-typed call), which may still bind to a list at run
  time.

- **A bare-function, assign-inferred point function compiled with a LIST
  argument reads it as ONE point** (witness from the Tycho D-15 session,
  2026-08-30; filed here, compile lane). With `f(v) = PointList(…)` declared as
  a bare `function` and its signature inferred at assign time,
  `compile(f(P), {to: 'javascript'})` SUCCEEDS and the emitted `_fn_f(v)` reads
  its argument as a single point (`v[0]`/`v[1]`); a LIST-of-points argument then
  throws `RangeError: PointList: source component 1 is not an array` at run
  time. Loud, not silent — but it diverges from the interpreter, and it is a
  sibling of the D-232 lambda auto-broadcast residual. It also pins a design
  constraint for the ruled runtime broadcast-dispatch guard: `Array.isArray`
  cannot distinguish a list-to-broadcast-over from a point that IS the argument,
  so the guard must key on the parameter's DECLARED scalar type, never on the
  runtime shape alone. Repro: tycho `scripts/repros/d15-eval-cost-probe.mts`
  (lands with the D-15 diff).

- **`Equal`/`NotEqual` with exactly one collection operand declines on the
  Python target but is now expressible** by the same comprehension machinery the
  arithmetic guard uses (`[_tv1 == 5 for _tv1 in L]` with the target's existing
  tolerance test is the interpreter's list of booleans). Left declined because
  the relational family is deliberately excluded from the arithmetic guard; it
  is the same lift one operator family over, when someone wants it.

- **The arithmetic OPERAND boundary has the same statically-scalar-but-
  actually-array hole the call boundary just had** (surfaced 2026-08-30 while
  implementing the runtime broadcast-dispatch guard). The guard fixes the CALL
  boundary: `f(y)` with `run({y: [1,2,3]})` now broadcasts. But an arithmetic
  node between the input and the call does not: `f(y + z)` with
  `run({y: [1,2,3], z: 0})` emits `(_.y + _.z)`, JavaScript string- concatenates
  the array to `"1,2,30"`, `Array.isArray` on the RESULT is false, and the
  guarded call's direct branch answers `NaN`. Fixing it means the same
  declared-scalar-type-keyed treatment at scalar-infix operand boundaries (or a
  broadcast-aware `+` lowering), which is the same perf-sensitive shape as the
  ungated infix `target.operators` path entry above — the two should be designed
  together.

- **Arity-mismatched user-function calls diverge between the lanes, and the
  interpreter's too-many-arguments path THROWS a raw JS error out of
  `.evaluate()`** (surfaced 2026-08-30 by the Spread round; reproduces on a
  direct call with no `Spread` involved). Too few arguments: the interpreter
  answers a partial application (`a(3, 4)` for a 3-parameter function returns
  `(_) => _ + 7`), while compiled code calls with `undefined` holes and runs to
  `null`/`NaN`. Too many: compiled code silently drops the extras and computes,
  while the interpreter throws an UNCAUGHT
  `Error: Too many arguments for function ...` from
  `src/compute-engine/function-utils.ts` (~line 2761) instead of returning an
  error expression — an `.evaluate()` that throws a raw JS error is a defect
  independent of the lane divergence. Two fixes needed: the interpreter's
  too-many path must produce an error EXPRESSION, and the compiled call emission
  must mirror whichever arity semantics are affirmed (partial application is
  likely too rich to compile — a decline is acceptable there).

- The `Multiply` ≥2-arrayish carve-out and the complex-element deferral —
  preserved verbatim through the broadcast rework, never re-examined.

**Residuals of the odd-denominator real-root fix for `.N()` on a negative base
(fixed 2026-08-03 on both lanes; recorded, not fixed).** The branch of
`(-2)^(p/q)` is decided by recovering `p/q` from the numericized exponent under
a coincidence-budget criterion (`realPowerBranchTerms`, `arithmetic-power.ts`;
pins in `power-negative-base-branch.test.ts`). (a) `_bignumComponent`'s
`radical === 1` fast path (`exact-numeric-value.ts`) still numericizes an exact
rational at the ambient precision before the handler sees it; keeping the exact
exponent was MEASURED (28 snapshot failures across 5 suites — machine `.N()`
display widths change) and REVERTED as broad churn needing its own gated pass.
(b) The branch is still decided by float reconstruction at `.N()` time — an
exponent with terms too large to recover from a 15-digit double (denominator ≳
3·10⁵ under the coincidence bound) takes the complex branch; curing that means
letting the exact exponent survive numericization (evaluate-handler signature
change, own design). Worth a ruling only if a consumer relies on
very-large-denominator float exponents.

**Follow-ups from the 2026-07-30 review round** (each found while fixing
something else; none is a regression):

- **`Power`/`Root` still yield `NaN` where the interpreter returns a complex
  value.** This is the ratified `finite_number` policy, not a defect, but it is
  the same user-visible surprise the `realOnly` retirement removed for `Sqrt`.
  Resolvable only by making those type handlers track the negative-base /
  fractional-exponent case — which would then let the emitter fold them complex.

**Needs a witness — cannot classify without seeing the consumer's shape.** Ask
before building; the compiled _meaning_ is genuinely unclear.

- `Set` (3/4), `Polygon` (3/16), `Sphere` (1/1), `GeometricVector` (1/3) —
  geometry/collection heads. What is `compile(Polygon(…))` supposed to _return_
  at run time? If the real need is membership (`x ∈ S`) rather than the
  aggregate as a value, that is a different and much smaller fix.
- `Subscript` (1/1) — **probe COMPILES**: `['Subscript','a','k']` canonicalizes
  to the fused symbol `a_k` → `_.a_k`. Their bucket is either stale or a shape
  where the fusion does not happen (cf. the G5 note in _Review residue_, where a
  binder-bound index severs the binding). Get the witness before assuming a gap.
- `Loop: Element index must be a symbol` (1/1) — reproduced only by handing
  `Loop` a malformed index (a literal where a symbol belongs), i.e. CE correctly
  rejecting bad input. Likely their expansion emitting a malformed `Loop`.
- **Width ceiling, accepted by both sides**: an expression-level shader value
  _is_ a vec2–4, so arbitrary-width rows (a 10-curve family, a 900-element
  board) have no `vecN` to live in. Un-fanning those is a consumer-side
  mechanism (instanced draw), not a CE change. If profiles ever justify
  one-shader-body arbitrary-width rows, the ask is _array-uniform loop codegen_,
  and it requires witnesses first.

**Interval-js band:** the domain is deliberately scalar — one interval per
quantity — so a collection-valued condition or operand declines by design beyond
the provable-list lowerings of 2026-09-15 (entry "Collection values on the
interval target").

**Caveat on the numbers throughout this section.** They come from a single
consumer's Desmos-derived corpus. That is the only population data we have, and
it is genuinely informative, but it is one workload: a head that is rare there
may be common elsewhere, and prioritizing strictly by these counts over-fits CE
to one consumer. Treat them as evidence of _demand_, not as a ranking of
_importance_.

**Ruled, not gaps:**

- **Loop-form `Sum`/`Product` inside a conditionally-evaluated arm** stays
  fail-closed (7 members / 1 state). The carve-out is a correctness boundary,
  not conservatism: GLSL's `?:` short-circuits, so hoisting a loop out of an arm
  it never feeds would shift every later `Random()` draw in the shader. The
  escalation route (an `if`/`else`-with-temporary lowering) needs a second
  witness; the count starts at one.
- **Interpreted-mode evaluation memo (CSE Phase 3) — NOT PURSUED.** Its gate was
  "bucket the interpreted residue first"; the bucketing says the residue is
  target gaps, not memoizable work. See
  [`docs/plans/2026-07-28-compile-cse-design.md`](./docs/plans/2026-07-28-compile-cse-design.md)
  §10.

### Broadcast typing residue (`broadcastable<T>` lift landed 2026-07-17)

The lift itself shipped (record in `CHANGELOG.md` and
`docs/plans/2026-07-11-broadcast-typing-lift-design.md`). Genuinely remaining,
as separate demand-gated items:

- **Phase-2 declared-type reconciliation** for symbolic-length ranges (see the
  design doc). Two broadcast-lift Phase-2 test pins currently assert the
  declared type + Map form pending this item.
- **Param-type-driven lambda-body typing:** lambda BODIES over untyped params
  still type scalar — only applications are lifted; revisit only with a
  param-type-driven design.
- **Python broadcast compilation:** the Python target lowers arithmetic to infix
  and has no generic `_ce_bcastf` helper, so possibly-collection operands fail
  closed (interpreter fallback is sound). Build the helper only if a
  compiled-NumPy binding path is ever needed.

Interactions to respect: non-finite typing convention, `infer(unknown)`
destructiveness, scalar-requiring contexts (exponents, comparisons, plot
coordinates).

### Symbol-identity residue (initiative complete, shipped 0.96.0)

The name-vs-binder repair is done — phases 1–3 including the sanctioned binder
mechanism. The current contract is `docs/SCOPING-MODEL.md`; the detailed
implementation stages remain in Git history. What is genuinely left:

- **Raw-name-fallback provenance** — the one open thread, deferred to a future
  phase. A pre-boxed operand can be applied twice through a raw name rather than
  a binding, which binding identity cannot distinguish; the behavior is
  characterization-pinned (`@fixme`) rather than fixed.
- **Found-not-fixed, all pre-existing and pathological:** `Limit(1/(x-a), …)`
  capture in `library/calculus.ts` (the variable is lost: it prints as
  `lim_(a) 1/(−a + x)`).

### Random-redesign residue (shipped 0.95.0/0.96.0)

The redesign shipped and the one-release tombstones are deleted. The current
model is `docs/RANDOMNESS-MODEL.md`. Remaining:

- **`compileShader` does not apply `rewriteAngularUnit`.** Both GLSL and WGSL
  `compileShader` route through `compileShaderBody`, never `compileOrThrow`
  (`gpu-target.ts` ~:4249), so a degree-mode engine emits radian trig on that
  route only. Pre-existing and unrelated to randomness.
- **`Map` element-type derivation** still widens independently of the domain
  narrowing the random family uses (`RandomChoice` itself was aligned with
  `Random` on 2026-07-27 via the shared `randomElementType`).

Settled, not work: the GLSL sibling-draw order is an accepted documented caveat
(operand evaluation order is unspecified in GLSL; WGSL pins L→R), and the "host
uniform" seed-ABI deferral is user-ratified.

**Open consult with the Tycho team** (do not land unilaterally): whether the
_released_ seeded `Random()`/`Shuffle` forms should move from bake to stream,
matching the two-primitive model. Awaiting their acknowledgement.

### Product feature track (agreed 2026-07-04)

CE is the foundation for Tycho / Graph Paper: an app helping scientists,
students and educators collaborate and communicate about scientific topics. The
2026-07-04 capability survey against that goal found the engine strong on
plotting/compile targets, units & quantities, logic/sets, linear algebra,
equation systems, and number formatting — and thin in the areas below. The
agreed items (`Series`, trig rewrites, statistics Phases 1–2, the explain API,
significant-figures display, the `Measurement` MVP) have all landed. Their
user-facing record lives in `CHANGELOG.md`; internal chronology lives in
`docs/STATUS_REPORT.md` and Git history. What remains (effort S/M/L):

**Statistics residue (demand-gated Phase 3, design doc §10):** inverse
regularized incomplete gamma/beta kernels and the distributions that need them
(Student-t, χ², F, Geometric…), `RandomVariate` sampling (reuse the `Sample`
RNG/seed policy), and fit diagnostics (R²). Also: the Python execution-parity
suite for the new scipy mappings is guarded/skipped until scipy is installed in
`./venv`.

**Series residue:** bare `O(…)` parsing remains deferred (design doc §8 Q3);
revisit for lenient mode once the parser work settles. From the Puiseux/log
round (landed 2026-07-12), deliberate defers that could be revisited on demand:
log-carrying expansions at ±∞ (`1/ln x`, `ln(ln x)`, `sin(ln x)`, `e^{1/x}`
defer — correct-over-wrong), exact terminating expansions still emit a
conservative `BigO` (`assembleLaurent` has no exactness notion), combined
distinct radicals grow `lcm(d)` uncapped inside add/mul (bounded by the deadline
→ clean defer), and `diffLaurent` asserts `d === 1` (polygamma ladder only).

**Typed function literals residue (demand-gated; current contract in
`docs/LANGUAGE-MODEL.md`):** the typed `Function`/`Typed` core landed 2026-07-12
(652a20fc); the signature-string sugar
(`["Function", body, "'(x: integer) -> real'"]` canonicalizing into the
structural form) landed 2026-07-19. Deferred until a consumer asks: **(S/M)**
optional/variadic parameter annotations (`["Typed", "xs", "'number+'"]` — the
encoding already admits it; needs `makeLambda` arity handling — the sugar
rejects these markers until then), **(S)** a strict-mode runtime check of the
result against the declared return type (returns are pure ascriptions today),
and **(S)** LaTeX typed-parameter notation behind a serialization style flag
(annotations currently drop in LaTeX).

**Compiled recursive lambdas** shipped 2026-07-19 as lenient true recursion.
Standing contracts: termination is the caller's — runaway recursion throws a
catchable `RangeError`; complex-valued recursion needs a `Typed` `complex`
return ascription (untyped applications type `broadcastable<number>` and hit the
complex-bcast deferral). Remaining follow-ups, both demand-gated:

- **(M) GPU literal-depth unrolling** (WGSL/GLSL cannot recurse; GPU stays
  fail-closed): the v1 memoized literal-argument specialization design
  (preserved in the design doc's git history) is the route — gate on a GPU
  consumer.
- **(M) Interpreter perf** (triaged + fixes landed 2026-07-19: the D2 numericize
  tail now gates on lexical `isConstant`, and the full-library sweep made
  non-lazy handlers trust pre-evaluated operands — symbolic recursive unwinding
  is linear, not exponential). What this leaves behind is the governing
  **evaluate-handler contract** (the one to enforce in review): a `lazy: true`
  operator receives RAW operands and its handler owns their (single) evaluation
  — `Add`/`Multiply`/`Sum`/`Product`/ `Measurement`/`NumeratorDenominator`
  re-evaluate legitimately; a non-lazy operator receives EVALUATED operands and
  must not re-evaluate them (each call re-descends the unmemoized subtree; under
  nesting that compounds exponentially). Do not delete the lazy `Add`/`Multiply`
  maps — the experiment was run and froze recursive unrolling at one level per
  pass, which is what confirmed the lazy/non-lazy split is the real contract.
  Remaining, all demand-gated:
  - two sites carry the same dynamic-scope `unknowns.length === 0` predicate as
    a _latent_ instance of the trap, with no demonstrated observable misbehavior
    — leave them until one surfaces: the equation-equivalence `eq` in
    `relational-operator.ts` is reachable only via a direct `.isEqual()` on two
    equation objects (normal `Equal(eq1, eq2)` canonicalizes to a chain and
    never compares them as equations), and that path runs at top level where
    `unknowns` is correct; `isPolynomialExpression` in `linear-algebra.ts` ×3
    sits behind callers that pre-evaluate operands. A naive `isConstant` swap at
    either would change classification of assigned symbols in unevaluated input,
    so it is not a free rename.

**MathNet parser tail (S/M; corpus at 371/428 CI-gated after the 2026-07-09
rounds):**

_Next up (agreed 2026-07-09):_

- **MATH genre-gap tail (S/M):** the Hendrycks MATH genre sweep (report:
  `docs/mathnet/math-genre-sweep.md`, tagged failures:
  `math-genre-failures.json`) stands at **97.66%** clean (371 of 735 failures
  fixed) after the 2026-07-09 rounds. Remaining ranked tail: (1) styling
  remnants (11, mostly array-env/prose — low value); (2) units residue:
  `yd`/`qt`/`pt` and currency (`USD`, `cents`, `euro`) have no `unit-data.ts`
  symbols (adding them is a units-subsystem call, not parser work); (3) small
  leftovers: `\cancel` inside `array`-env `@{}`/`\cline` layouts, set-congruence
  `\{0,1\}+\{1,4\}\equiv…` (set arithmetic, out of scope), and possible future
  upgrades to `IndexedSequence` (lazy-collection semantics, the parenthesized
  `(a_n)_{n\in\mathbb{N}}` form). Ascii-pipe divisibility evidence doubled (36
  more hits, tracked below). Skip: `array`-env long-division layouts, `\nabla`
  puzzle ops, repeating decimals `0.abab\overline{ab}`. _Rest of the tail:_

- **Set-image bracket notation audit (S/M):** `f[S]` is parser-clean today as
  `At(f, S)`; decide whether set contexts need a distinct structural
  function-image head for expressions such as
  `f[\operatorname{divs}(m)] = \operatorname{divs}(n)`. **`Interpret` —
  generalization ladder (design: `docs/LANGUAGE-MODEL.md`):** v1 landed
  2026-07-09 — the explicit `Interpret(expr)` head turns continuation-bearing
  sums/products into formal `Sum`/`Product` under a strict arithmetic-
  progression gate (`1+2+\dots+n` → `Sum(k,(k,1,n))`; parity mismatches and
  anything unproven stay inert); v2–v4 (polynomial/geometric recognition,
  Berlekamp–Massey → `RSolve`, async OEIS-backed `ce.interpret`) followed.
  Remaining, demand-paced:

- **Known edge:** `simplify()` on `-(2·4·\dots·2n)` distributes the outer sign
  into the product and folds (pre-existing).
- **Promotion decision** (after product usage): whether bare
  `evaluate()`/`simplify()` should invoke the recognizer by default.

Still deferred: ASCII-pipe divisibility (`p|a+1`) because it conflicts with
absolute-value syntax (though the parenthesized form `(a+f(b)) | (a^2+bf(a))` is
unambiguous and could be revisited); set arithmetic such as `2\mathbb{Z}+1`;
richer `array`/`cases` environment variants; prose-heavy or fragment-boundary
inputs that need surrounding natural-language context.

**Uncertainty/Measurement residue** (MVP landed 2026-07-07). Deferred:

- **Dual-number correlation tracking** (correct-by-default) — the documented
  upgrade past independent propagation, which over/under-estimates when one
  measured variable is reused across operands (`x·x`, `x/(x+1)`). A
  `BoxedMeasurement` carrier with per-source identity; the hard part is
  source-id stability across re-boxing (design doc "Non-goals").
- **Relative-error notation** (`±5%`) and **distribution/`RandomVariate` links**
  (reuse the statistics RNG/seed policy).

**`FindFit`/`FindRoot` residue (landed 2026-07-21, Tycho item 77):**
demand-gated v2 items — per-point **weights** (resolved future shape: a trailing
optional `weights` argument, NOT tuple-shape deduction), parameter
uncertainty/covariance output (`JᵀJ⁻¹` is a byproduct), general `FindMinimum`,
and multi-start/global search (revisit only on corpus evidence of basin
sensitivity). Known naming quirk to document for consumers: a parameter named
`e` canonicalizes to `ExponentialE` and cannot be fit.

**Mathematica surface forms — deferred tail (need user steer before attempting;
landed record in the 2026-07-14 commits):** Tier 3 heads (`NSolve` — cheap as
Solve+N — and `Reduce`; `FindRoot` landed 2026-07-21 via the item-77 nonlinear
least-squares core, with `(x, x0)` start tuples and box constraints); the
`{i, n}` 2-element iterator shorthand (rejected as malformed; the bare-count
`Table(expr, n)` form is accepted today, `Table(k^2, 3)` is `[1, 4, 9]`);
symbolic directional limits (`lim_{x→a⁺}` at a symbolic point stays inert —
representation correct, evaluation gap).

**Not yet agreed (proposed 2026-07-04, awaiting a call):**

6. **MathML output + speakable text (M).** Communication and accessibility:
   MathML serialization for export/interchange (web, Word, EPUB) and a
   speakable-text serializer for screen readers. AsciiMath output already
   exists; MathML and speech are absent. Accessibility matters for the education
   audience.
7. **Chemistry notation — mhchem `\ce{}` (M).** Chemical formulas, isotopes,
   reaction arrows. Only if chemistry is in scope for Graph Paper — decide
   before investing; `mol` exists solely as a unit dimension today.

### Review findings (2026-07-04) — residue

The 2026-07-04 review's P0/P1 fixes all landed (DSolve repeated-root and
Error-node bugs, the ODE P1 tail incl. the parsed-LaTeX path, the loose-parsing
cluster with the `strict` escape hatch, and the top P2/P3 items: Beta poles,
`x·∞`, inverse-hyperbolic poles, the rules.ts edge bugs). The completed review
campaign is summarized in [`docs/STATUS_REPORT.md`](./docs/STATUS_REPORT.md).
Still open from its ranked list:

- **defint error bar 1.6× optimistic on endpoint-singular integrands** — large
  (tanh-sinh quadrature).
- **Perf tail.** The 2026-07-01 performance review (P0–P3,
  `PERFORMANCE_FINDINGS.md`) fully closed 2026-07-18 — its status table records
  what shipped and, importantly, what was **measured unprofitable and must not
  be re-attempted without a new profile** (P2-2 `isSubtype` memo, P2-4
  simplify-history scan, the `bignumRe` memo, P3-1 `.json` cache). Still open,
  measurement-gated: cold-start bundle size, and the post-drift-fix residual
  tail — 6 benchmark cases still < 0.95× vs 0.73.0, worst CE4 erf-integral 0.62×
  (case-specific integrate/simplify machinery growth, not box tax) — a candidate
  future perf item. **Also measured-unprofitable: both P1 differentiation levers
  and the `.mul()` fast-path pivot** (2026-07-19) — see "Symbolic-evaluation
  performance → P1" below before touching `derivative.ts` or
  `sortProductOperands` for speed.
- **Loose-parsing low items:** infix calculator notation `5 nPr 2` is
  unsupported (a new-notation design item, not a map gap); explicit `_a`
  wildcards in arrow-string rules are a silent no-op (redundant there —
  auto-wildcarding covers it). `sqrt2x` → `√(2x)` is a deliberate policy
  (consistent with the bare-function convention `cos 2x` → `Cos(2x)`), not a
  bug.
- **Doc/cosmetic tail:** locale separators.
- ODE P2s — folded into the DSolve/NDSolve track below (**B12**).

### Symbolic capability gaps

#### B9. `Solve` — beyond the Wester ceiling

The Wester `Solve` score is saturated at our principled ceiling (14/21; the last
two gaps — `xˣ = x`, `sin x = tan x` — are harness artifacts: the harness grades
SymPy's arbitrary finite root-slices, not a CE capability gap). The section is
kept for that harness-artifact explanation, which the Fungrim track
cross-references. Genuinely open Solve items:

- **Diophantine deferrals** (Phase 3 shipped linear n-variable + Pell +
  Pythagorean triples; remaining porting assessment in
  `docs/plans/2026-07-04-diophantine-assessment.md`): sum-of-squares tier (fits
  a representation function better than Solve), general binary quadratics via
  `transformation_to_DN`, half-bounded-Range instantiation (currently inert by
  design), `factor_list`-style auto-factoring. Ternary quadratics deliberately
  skipped (low value); weighted-coefficient / ≥4-square parametrizations
  deliberately refused (textbook families are provably incomplete — the contract
  emits only complete families).
- **Inequality and system solving via `Solve`** remain partial (see
  `test/compute-engine/solve.test.ts` commented `@todo` cases); linear
  inequality systems are handled, general ones are not.
- The solve rule set is acknowledged incomplete (`solve.ts` "MOAR RULES", plus
  two deferred side-condition checks noted in-file).

#### B11. Multivariate polynomial GCD — Stage C (Fateman-scale)

The variadic `GCD` handles textbook multivariate cases (Brown's dense modular
GCD in `multivariate-gcd.ts` — the baseline Zippel extends), but the 7-variable
**Fateman GCD benchmark** (Symbolica 4 s / Mathematica 89 s / SymPy 61 min)
exceeds the dense algorithm's complexity cap and defers. To reach Fateman scale:
**Zippel** sparse interpolation (dense interpolation is the bottleneck at 7
variables), **multi-prime CRT + rational reconstruction** (a single large prime
caps coefficient size), and faster `MPoly` arithmetic (the `Map`-keyed
leading-term scan is O(terms) per call). The kernel
(`boxed-expression/multivariate-poly.ts` + `multivariate-gcd.ts`) is shared
infrastructure — multivariate factorization, `Cancel`/`Together`, partial
fractions, and `Resultant` all want the same representation. Tracked against the
`benchmarks/audit/` Fateman footnote.

#### B6. Audit-harness expansion

The CE-vs-SymPy audit (`benchmarks/audit/`) already grades the
`Solve`/`Resultant`/`GCD` heads (and, since 2026-07-10, `DSolve` — see B12)
through the real opt-in loaders. **Done (2026-07-21):** the Bondarenko
integration set (35 hard nested-radical / log / transcendental integrals, MIT)
is wired in — `benchmarks/audit/bondarenko.ts` → `REPORT-bondarenko.md`, graded
by the invariant `d/dx(F) ≈ f` across base CE / CE+R/F / SymPy / Mathematica
(with a finite-difference fallback where the symbolic derivative doesn't
numericize — PolyLog, elliptic kernels): CE 0/35 · CE+R/F 21/35 · SymPy 7/35 ·
Mathematica 32/35 (CE+R/F **12 → 20** after the R31 nested-radical substitution
fallback — closing

#2/#10/#11/#12/#15/#16/#17/#18 — then **20 → 21** after the R32
Euler-substitution lever ("Lever C") closing the √(quadratic)-nested **#9**; see
**Coverage tracks → Rubi**). (Rubi chapter translation — the lever for the
indefinite-∫ gap, with Rubi now recovering 6 of the 8 hard Wester integrals — is
its own track: see **Coverage tracks → Rubi**.)

#### B12. ODE solving — `DSolve`/`NDSolve` beyond the first slice

`DSolve` now covers first-order linear (integrating factor),
constant-coefficient homogeneous up to order _n_ (numeric characteristic roots
with clustering), nonhomogeneous constant-coefficient with polynomial, sine, and
exponential forcing via undetermined coefficients — including resonance (forcing
`sin(ωx)` when `±iω` is a characteristic root) and orders ≥ 3 — second-order
Cauchy–Euler (homogeneous and, since 2026-07-18, nonhomogeneous via an x-power
indicial ansatz with a variation-of-parameters fallback), the Airy family
`y″ = (px+q)y` (`AiryAi`/`AiryBi`, with new `AiryAiPrime`/ `AiryBiPrime`
operators and full derivative closure), the first-order nonlinear classes
(separable with _implicit_ `F(y) = G(x) + C` solutions, Bernoulli `v = y^{1−n}`,
first-order homogeneous `y′ = F(y/x)`, exact `M dx + N dy = 0`, and Riccati —
constant-particular, plus the `y = −u′/(q₂u)` Airy linearization for
`y′ = q₀(x) + q₂y²` with linear `q₀`), first-order linear systems (distinct
eigenvalues, diagonal with repeats, and defective 2×2 via a generalized
eigenvector, gated on an exact `(A−λI)² = 0` check so near-repeated numeric
eigenvalues stay inert), and initial/boundary conditions (solving the linear
system for the integration constants). `NDSolve` integrates adaptively
(Dormand–Prince 5(4) with dense output; scalar, higher-order reduction, and
first-order-system forms). Unsupported forms stay **inert rather than wrong** —
preserve that contract as coverage grows. (The constant-coefficient Abel rung —
dead code shadowed by the separable rung — was removed 2026-07-18.)

The CE-vs-SymPy audit harness (`benchmarks/audit/dsolve.ts` + `gen_dsolve.py`,
substitute-back residual oracle, 51-case corpus seeded from SymPy's
`test_ode.py`; landed 2026-07-10) grades **CE 50/51 correct, 0 wrong — at parity
with SymPy (50/51)** after the 2026-07-18 frontier round (BY1 Riccati→Airy —
which SymPy errors on —, BY3 nonhomogeneous Cauchy–Euler, BY4 Airy, BY5
repeated-eigenvalue system). The one remaining `unsupported` row is
**variable-coefficient second order** (`sin(x)y″ + y′ = cos x`), where SymPy's
"solution" is nested unevaluated integrals — a `p = y′` reduction-of-order rung
would need to emit inert-integral-carrying results to match, a contract question
before it is a coding task. Ranked next steps (good contributor territory):

- **`NDSolveFunction` system form:** `NDSolve` is adaptive (Dormand–Prince 5(4)
  with dense output, landed 2026-07-18) and `NDSolveFunction` returns a callable
  `Function(InterpolatingFunction(data, x), x)` — but **scalar forms only**; the
  multi-dependent system form stays inert. A vector-valued interpolating result
  needs a shape decision — demand-paced. Known engine-level quirk (pre-existing,
  pinned in tests): applying a MathJSON-**re-boxed** literal resolves the
  interpolation one `evaluate()` late (`N()` is immediate).
- **Tolerance hardening** in the numeric characteristic-root clustering, so
  near-degenerate roots are grouped reliably as coverage of higher-order
  nonhomogeneous problems grows.
- **Adjacent, reusing the same kernel:** a
  `LaplaceTransform`/`InverseLaplaceTransform` pair (currently inert) — a
  capability on its own and a second, independent route to constant-coefficient
  IVPs that cross-checks the initial-conditions work. (`RSolve` already reuses
  the characteristic-polynomial / root-multiplicity machinery for linear
  constant-coefficient recurrences, with an `rⁿ·n^k` basis instead of
  `e^{rx}·x^k`.)
- A proper `DiracDelta` (for derivatives of step functions, currently 0 a.e.)
  remains a possible future refinement.

#### B13. Wester capability gaps — the skip ledger in `wester.test.ts`

`test/compute-engine/wester.test.ts` is the CI correctness suite transcribed
from Wester's CAS review (the categories the `benchmarks/audit/wester.ts`
harness cannot ingest). The convention: a gap exists there as a `test.skip`
asserting the **correct** answer — unskipping is the acceptance test. The
2026-07 campaign worked the ledger from 18 skips down to **one**:

- **Wester 9 — recursive denesting** (the Putnam radical
  `√(14+3√(3+2√(5−12√(3−2√2)))) → 3+√2`): only single-level `√(a+b√c)` denesting
  is implemented; the multi-level/recursive case is a deliberate algorithmic
  project (Landau/Blömer-style).
- **Linear algebra residue** (not skip-representable, tracked here): matrix
  square root beyond exact 2×2 (n×n wants eigendecomposition or Denman–Beavers);
  exact singular values beyond a 2×2 Gram matrix. Two wester tests are
  active-but-weakened rather than skipped (stale "skipped" comments in-file):
  fused-form `row-vector · (a·M1 + M2)` asserts the current `MatrixMultiply`
  type rejection, and the symbolic Vandermonde determinant is spot-checked
  numerically because `Factor`/`simplify` leave it unfactored (a `/(−w+x)`
  division artifact).
- Missing heads noted in comments: `MatrixExp` (`Exp` of a matrix broadcasts
  elementwise — it is _not_ the matrix exponential), matrix functions generally
  (sine of a matrix), Jordan / Smith normal forms (→ B14).
- Closed-form table growth for infinite sums/products (beyond the
  `namedSeriesClosedForm` table landed 2026-07-18 — e.g. `β(4)`, Hurwitz-shifted
  bases `(k+m)^{−s}`, higher moments `Σk²rᵏ`) remains demand-paced.

Untranscribed corpus categories (future tranches): systems of equations /
congruence solving, special functions, transforms, ODEs/PDEs (→ B12),
vector/tensor analysis, numerical analysis.

#### B14. Wester representation gaps — problems the suite cannot state

Distinct from B13: these Wester problems have **no CE API to express them**, so
they cannot exist as `test.skip`s — each needs a naming/design decision first,
then its acceptance test goes into `wester.test.ts`. Mathematica spellings are
deliberately NOT aliased (decision 2026-07-05); the Mathematica→CE
correspondence table lives in
[`docs/MATHEMATICA-NAMES.md`](./docs/MATHEMATICA-NAMES.md) — **probe CE's own
names before adding an entry here** (many presumed-missing heads exist under CE
names: `NthPrime`, `NPartition`, `PowerMod`, `ModularInverse`, `StirlingS1`,
`Rationalize`, `PrimitiveRoot`, `ContinuedFraction`, matrix ∞-`Norm`,
`BaseForm`, finite-domain `ForAll`/`Exists`).

- **Repeating-decimal representation — producer direction:** an equivalent of
  `ToPeriodicForm`, rendering an exact rational as its periodic-decimal object
  (the LaTeX serializer's `repeatingDecimal` option covers only float display;
  the consumer direction — repeating-decimal literals boxing as exact rationals
  — is done).
- **Quantifier elimination over ℝ:** `ForAll`/`Exists` evaluate only over finite
  domains; the Wester/Liska–Steinberg stability problems need QE over real
  closed fields (CAD or virtual substitution) — a major subsystem, catalogued
  here for completeness, not planned.
- **Matrix decompositions & functions:** `MatrixExp` / general matrix functions
  (`Exp` of a matrix **broadcasts elementwise** — the footgun is documented, but
  an actual matrix exponential remains future work); symbolic singular values
  (`SVD` is float-only); Jordan / Smith normal forms.
- **Hypothesis testing:** `MeanTest` etc. — undeclared; only worth pursuing if
  the statistics track (GP items) calls for it.

#### B15. Parameter-conditional results — the last `Which` producer

The conditional-values design
([`docs/plans/2026-07-12-conditional-values-design.md`](./docs/plans/2026-07-12-conditional-values-design.md))
is ratified and its Phases 1–3b landed: `When` threading algebra, the Solve
adopter (trig/hyperbolic validity + radical extraneous-root guards), and the
convergence-conditions adopter (improper-integral endpoint guards, geometric
series `1/(1−x) {|x|<1}`). Remaining:

- **Definite-integration region splitting (`Which`) — the only open producer.**
  Motivating case: `∫_{−π}^{π} (1 − x·cos t)/(x² − 2x·cos t + 1) dt` = `2π` for
  `|x| < 1`, `0` for `|x| > 1` — CE correctly stays inert today; locating where
  poles cross the contour is the hardest part and stays with this adopter.
- **Cosmetic residual:** an unsatisfiable conjoined guard (`∫₀^∞xᵖdx`) displays
  rather than collapsing — needs contradiction detection in assumptions; not
  worth it standalone.

### Collections — laziness & fusion backlog

The 2026-07 laziness audits (rounds 1–2 + review rounds, landed by 2026-07-17)
and the T1/T2 follow-up round (landed 2026-07-19: finiteness guards on
`CountIf`/`Position`/`Ordering`/`DictionaryFrom`/`RecordFrom`; threshold-hybrid
lazy views for `Insert`/`DeleteAt`/`ReplaceAt`, `Partition` chunk/window forms,
`SlidingWindow`, `ChunkBy` via the shared `windowedCollectionOps` helper) leave
this backlog:

- **T3 (deferred, low value):** `Keys`/`Values` (dicts are small), `Chunk`
  (needs count only).
- **Map auto-compile v1 gaps (shipped 2026-07-19; revisit on a profile):** the
  explicit-materialization route stays interpreted (ratified non-goal — do not
  reorder `_computeValue` steps 3/3b), and non-`Map` lazy collections (`Filter`,
  `Comprehension` bodies) and bignum drains are not attempted. See
  [`docs/COMPILATION-MODEL.md`](./docs/COMPILATION-MODEL.md).
- **Structural rewrite layer — open design decision (user has not ruled).** The
  stacked-lazy-`Map` drain cost that motivated fusion is addressed: drain-time
  lowering (`map-lowering.ts`, shipped in this cycle's release) applies
  broadcast-shaped lambda levels directly at iteration, ~3× (`evaluate()`) / ~4×
  (`.N()`, machine path) on the Tycho item-103 witness; structural
  canonical-level fusion (`Map(Map(s,f),g)` → `Map(s, g∘f)`) was considered and
  REJECTED (canonical forms are user-visible; reactivity). What remains open is
  the broader question: `Count(f(x))`-through-eager-op cheapness needs
  canonical-level rewrites, a churn-heavy direction to decide deliberately.
  (Related closed rulings, recorded in `docs/COMPILATION-MODEL.md` and the
  0.95–0.98 CHANGELOG entries: Map auto-compile stays machine-precision-only —
  no bignum-safe compile tier.)
- **Latent issues: none remaining.** The 2026-07-19 latent sweep dispositioned
  the whole former list (fixes, could-not-reproduce verifications, and an `At`
  `@todo` audit — record in that day's commits and `CHANGELOG.md`); the one
  lasting convention: `Slice` finiteness is honest — negative end over an
  infinite source is an infinite tail, negative start over one is inert,
  unknown-length sources report finiteness unknown.

### Coverage tracks

Two opt-in libraries extend coverage **without touching the core engine**:
**Rubi** (integration rules, `loadIntegrationRules(ce)`) and **Fungrim**
(identities, `loadIdentities(ce, { solve: true })`). The remaining Wester gap to
SymPy is concentrated and maps cleanly onto these, so each is a self-contained
track measured by **its own suite** — the 48-case Wester harness is a
spot-check, not the scoreboard. The two tracks are independent and should not
gate each other.

#### R. Rubi — integration coverage by chapter

**State (2026-07-12, R1–R30 + R8 landed):** the shipped bundle
(`src/compute-engine/rubi/rubi-rules-data.json`, via
`@cortex-js/compute-engine/integration-rules`) contains **Chapters 1
(Algebraic), 2 (Exponentials), 3 (Logarithms), 5 (Inverse trig), 6
(Hyperbolics), 7 (Inverse hyperbolic), 4.1 Sine, 4.3 Tangent, 4.5 Secant, and
§8.8 Polylogarithm** — 6,574 rules, 6.98 MB (CI has a bundle-freshness gate).
Scores (seed 5): **4.1 Sine 107/120 and 331/400 (4.1.11 file 93/113,
post-R18)**, **4.3 Tangent 72/120**, **4.5 Secant 69/120**, **ch3 Logarithms
70/120 (post-R25 re-baseline)**, **Chapter 5 Inverse trig: 5.1 sine 65/120, 5.2
cosine 76–78 (verify-deadline flutter band), 5.3 tangent 64 (post-R28), 5.4
cotangent 62, 5.5 secant 56, 5.6 cosecant 52 (≥375/720 ≈ 52%; R27 +19 on 5.1/5.2
via the poly×trig-product reduction closing the reciprocal-arcsin/arccos family;
earlier: R24 +15 via the complex-argument Erf/Erfi kernel, R23 +5 via the
InvTrig^n multiple-angle → CosIntegral reduction; 5.5/5.6 scores predate R25–R28
re-runs)**, **Chapter 7 Inverse hyperbolic (R22): 7.1 sine 79/120, 7.2 cosine
51, 7.3 tangent 85, 7.4 cotangent 95, 7.5 secant 44, 7.6 cosecant 54 (408/720 =
56.7%, R22 +2 — ch7's hyperbolic sub-integrals were already covered by the
ungated `containsHyperbolic` fallback)**, **ch1 1.1 Binomial products 112/120
(post-R28)**, **1.1.3 General 185/200 s200 (post-R28: unsolved 6 → 1; the
survivor #259 is an integer-power rational)**, ch1 exhaustive ≈90–91%, ch2 ≈72%
effective (seed 42), **ch6 Hyperbolics 73/120 (s120 seed 5, post-R30-reorder
2026-07-11; 0 wrongs)**, Wester indefinite-∫ 6/8. Per-rung history (R1–R30, each
rung's mechanism, score deltas and dead ends) lives in `docs/rubi/RUBI.md` §5
and git history — it is deliberately not repeated here. **Genuine wrongs are 0
across all suites** — every flagged "wrong" is a documented **verification
false-wrong** (numeric ₂F₁/AppellF1 mis-grading at non-integer symbolic-exponent
substitution; `√(sin²)=|sin|`; cube-root/fractional-power branch at negative x):
before believing a wrong flag, differentiate the antiderivative back and compare
at integer substitutions. The trig routing lives in the runtime layer
(`rubi-utils.ts`/`driver.ts`): argument-aware `deactivateTrig` (only
x-free/linear/bare-monomial args inert — composite quadratic/√-inner args stay
ACTIVE for the substitution rules), `cofunctionShift` (`sec → csc[θ+π/2]` and,
since R12, `cot → −tan[θ+π/2]`, both default-ON; the mixed-cross-pair decline
gate keeps `(g·cot)^p(a+b·sin)^m` on `unifyInertTrig`'s matched-±π/2 clauses),
`unifyInertTrig` + its cofunction product clauses, `standaloneCosineShift`,
`reciprocalToPower` (frozen under fractional powers — branch safety; since R13
it also keeps REFLECTION-produced `csc[·+π/2]` heads raw — the +π/2 shift
signature — so pure-sec binomials `(a+b·sec)^n` reach the 4.5.1 csc-binomial
rules, with a `(a+b·sec²)^p`-Power exception routing 4.5.7 to the sin/cos
rules), and five driver fallbacks (trig→exp with a numeric-evaluability
self-check; R15's rational×sin/cos(linear) → Si/Ci partial-fraction split with a
central-difference D-self-check (R18 extends it to irreducible-quadratic
denominators via `expandRationalOverComplexLinears`, splitting over
complex-conjugate linear roots → complex Si/Ci that recombine real, behind
`RUBI_NO_SICI_COMPLEX`); R16's poly×csc²/sec²(linear) by-parts; R17's
`singleAngleTrigExpFallback` — `∫P(x)·R(trig(w))` with `w` linear and an
additive `(a+b·trig)` denominator, rewritten via `y=E^{iw}` + partial-fractions
and routed through the §2.2→Ch3→§8.8 PolyLog telescope, fail-closed D-check;
native-rational). A/B env switches: `RUBI_NO_FOUNDATION`, `RUBI_NO_RECIP`,
`RUBI_NO_COFN`, `RUBI_NO_COFN_COT`, `RUBI_NO_SKELETON`, `RUBI_NO_SICI`,
`RUBI_NO_SICI_COMPLEX`, `RUBI_NO_SECBIN`, `RUBI_NO_TRIGSQ`, `RUBI_NO_TRIGEXP`,
`RUBI_NO_TRIGSUB` (R22 subproblem trig-bridge), `RUBI_NO_R25` (R25
quartic-denominator ExpandIntegrand guard), `RUBI_NO_R26` (R26B
rational-normal-form retry in the exp-substitution fallback), `RUBI_NO_R27`
(poly×trig-product reduction fallback), `RUBI_NO_R28` (R28a mixed-parity
Laurent-numerator × binomial-radical linearity split), `RUBI_NO_R29` (R29
algebraic-in-hyperbolic `u = Sinh/Cosh/Tanh[v]` substitution fallback),
`RUBI_NO_R30` (R30 rational-in-hyperbolic cyclotomic-factored `t = e^v`
substitution fallback), `RUBI_NO_R8` (R8 poly×single-angle-hyperbolic →
single-exponential `y = e^w` PolyLog fallback), `RUBI_NO_R31` (R31
nested-radical substitution fallback — Lever A iterated `u = (a+b·x)^(1/k)`
fractional-power-of-linear substitution with factored-denominator presentation,
Lever B `(√L₁+√L₂)^(−n)` conjugate rationalization; closes the Bondarenko
nested-radical family, CE+R/F 12 → 20/35; structurally inert off-family via a
tight `hasNestedRadicalCandidate` pre-filter, fail-closed on a domain-aware
D-check), `RUBI_NO_R32` (R32 Euler-substitution lever "Lever C" — an Euler I
substitution `t = √a·x + √Q` at a √(quadratic)- nested radical that rationalizes
`√Q` and collapses the outer radical to a √-of-linear the existing Lever A
removes; closes Bondarenko **#9**, CE+R/F 20 → 21/35; two-pass so R31 stays
byte-identical, inert off-family via the Euler branch of
`hasNestedRadicalCandidate`).

**Driver determinism (2026-09-23):** the driver gives up after a step budget
(300,000 steps per integral, `RUBI_STEP_BUDGET`), not after a time, and its two
sub-searches (the native rational fallback, the clean-up simplify) have step
budgets of their own. On seeded samples of chapters 1 to 7 the outcomes of all
1,400 problems were the same as under the former time budgets, and the step
counts were the same from run to run under different loads. What still depends
on the clock is listed in the entry "Big-decimal coefficients grow to thousands
of digits in the polynomial GCD of a Rubi simplification". (Two independent
budgets trap: `loadIntegrationRules(ce, { stepBudget, timeLimitMs })` is
independent of any `withTimeLimit` span — a heavy test must raise the loader
budget and arm a long enough span.)

**Benchmark protocol.**
`npx tsx scripts/rubi/benchmark.ts --rubi "data/rubi/corpus/4 Trig functions" --chapter "4 Trig functions/4.1 Sine" --sample 120 --seed 5 --report /tmp/x.json`.
Always pass `--report` (the default path clobbers the committed baseline);
`--rubi` mode preloads the ch1/2/3/**4.1/4.3/4.5**/5/6/7/§8.8 foundation
(matching the shipped bundle so it measures the integrator as it ships —
`RUBI_NO_FOUNDATION` to disable; **pre-2026-07-04 4.1 baselines are not
comparable**); run suites **sequentially** — concurrent benchmark runs
contaminate each other's driver/verifier timing. NB: a `--rubi` target that is a
Chapter-4 SUBSECTION (e.g. `.../4 Trig functions/4.1 Sine`) resolves
`corpusRoot` to the ch4 dir, so no foundation loads and the driver-only score
(58) understates the shipped §4.1 Sine (107, `loadIntegrationRules`) — measure
ch4 sections via the shipped bundle, not `--rubi` on the subsection.

**Kernel status.** The complex-argument `ExpIntegralEi`/`SinIntegral`/
`CosIntegral`, negative-order incomplete Γ, and hyperbolic `Shi`/`Chi` kernels
are all in (mpmath-validated; see `docs/rubi/RUBI.md` §5 R18/R21 for the branch
subtleties). Remaining: hard cubic-and-higher x-denominator Si/Ci shapes still
decline cleanly (unsolved, not wrong).

**Method note (hard-won).** The "unimplemented-predicate" trace census is
_misleading_ for picking levers: the late catch-all rules
(`FunctionOfTrigOfLinearQ`, `TrigSimplifyQ`) are checked on nearly every
unsolved problem and dominate the tally without being the blocker. Diagnose
instead by tallying the _actual_ rule-fail/inner-condition reasons and tracing
the residual integrand; and use **`wolframscript`** to see Rubi's real chain
(load Rubi, then trace recursive `Int` calls, or probe `DeactivateTrig`
directly):

```mathematica
Get["~/dev/rubi/Rubi-4.17.3.0/Rubi/Rubi.m"];
Trace[Rubi`Int[Cos[x]^4, x], HoldPattern[Rubi`Int[_, _]]]
Rubi`Private`DeactivateTrig[Cos[x]^4, x]   (* -> sin[Pi/2 + x]^4 *)
```

**Next rungs (priority order).** Each is a self-contained work item: do the
change, then verify with the benchmark command above (watch `solved-correct`
climb while genuine `wrong`/`not-evaluable` stay 0 — but see the R2 note on
hypergeometric verification false-wrongs). Diagnose any stall per the Method
note — trace the residual integrand, don't trust the predicate census.

- **Ch3 unsolved tail** (43/120 at s120 seed5, post-R20; was 45 post-R19). **R19
  censused all 46** and found one bounded fix: `FunctionOfLog` (→ #261). The
  residual splits into **15 expected-`Unintegrable`** (Rubi itself returns
  unevaluated — CE's inert `Integrate` is the correct match, not a defect) and
  **~30 genuinely deep**. Next-rung shopping list from the census (see
  `docs/rubi/RUBI.md` §5 R19/R20 for the full family table):
  - **Biggest family: poly×log by-parts residuals** bottoming in `∫artanh(√)/x`,
    symbolic-order-`k` `PolyLog` recurrences, or `ArcSinh·Log` (3.1.4/3.1.5) —
    shapes the bundled ch5/ch7 base cases don't reach. A symbolic-order
    `PolyLog` recurrence remains the lever.
  - **6: `∫Log[Sin/Tan/Csc²]`** (3.5) — a two-part gap: an inert-trig `D`
    reduction (CE's `D` knows `Tan`, not the inert `tan` head the driver
    carries) PLUS a Chapter-4 trig-integration foundation for the by-parts
    sub-integral (only 4.1/4.3/4.5 bundled).
  - **4 (D): `∫Log[·]/rational`→`PolyLog[2]`**; **3 (E):
    `(a+b·Log[c(d+ex)ⁿ])^p × rational` half-integer residuals**; **4 (F):
    fractional/negative power in the log arg → `Gamma`/`Ei`/`LogIntegral`** with
    `x^(2/3)`/`e/√x` substitution. All need new production/kernels, not
    bundling.
- **R3′ — residual half-integer/elliptic chains.** #604/#609/#1395 were closed
  by R9's cosine shift, #294 by R17's exp-route telescope; what remains is the
  genuinely deep tail: #53 (23-step half-integer Fresnel chain), #248 (48
  steps), plus the composite `cot^m/(a+b·sin)^n` / `(a+b·sin²)^(p/2)`
  tan/cot-power recursions (4.1.1.3 / 4.1.7), which may fold into R5.
- **R5 — `TrigSimplify`/`TrigSimplifyQ`** (Pythagorean reductions). _Low value /
  optional:_ the predicate census over-weights it (it's a late catch-all, not a
  blocker). Only pursue if R14/R3′ leave a concrete residual class that needs it
  — one confirmed member so far: #93 (`csc^(−1/2)·sin` cancellation). A related
  deferred item from R9: a proper circular `TrigReduce` (multiple-angle
  elementary form) for `sin^n` products — the exp-form reduction works but
  verifies past the harness budget and preempts trig-form rules chapter-wide, so
  it was deliberately gated off.
- **Ch5 residual — ₚFq only.** The rung ladder closed the chapter's structural
  gaps in sequence: R22's bridge (`RUBI_NO_TRIGSUB`) closed the
  `∫f(x)·Cot[x]`-bottoming family (294 → 331), R23's `circularTrigReduce` closed
  the `∫x^m·ArcSin^n/√(1−c²x²)` (n<0) family (331 → 336), and **R27's
  `polyTrigProductReduce` closed the mixed `∫θⁿ·Sinᵐ·Cosᵏ` inner integrals of
  the reciprocal-arcsin/arccos class** (5.1 57→65, 5.2 67→78 — the former
  residual (a)). What remains: only the ₃F₂/`HypergeometricPFQ` terminal forms,
  which need a generalized ₚFq head CE lacks (out of scope). _(The
  formerly-listed "complex-Erfi evaluator" residual is stale — verified
  2026-07-10 post-R27: the fractional-`n` family's complex-`Erfi` results
  numericize via the R24 kernel, and the sole remaining `not-evaluable` row in
  each of 5.1/5.2 (s120 seed5) is a ₚFq terminal.)_ Ch7's analog is smaller and
  already covered (arsinh → hyperbolic fallback).

**Exponential** (Ch 2, 125 rules) and **hyperbolic** (Ch 6, 390 rules) are
bundled; the former R6/R7/R8 items all landed as rungs R25/R26/R29/R30 (see
`docs/rubi/RUBI.md` §5). The remaining Chapter-6 residual is mostly shared
capability rather than Ch6-specific:

- **R6′ tail:** the residual-degree-≥4 function-of-exp rows
  (`Sinh⁶/(a+b·Cosh²)`, `Csch⁴/(I+Sinh)²`, `Sinh⁴/(a+b·Sech²)²`,
  `Coth⁵/(a+b·Coth)`) whose symbolic quartic-or-higher residual needs a genuine
  root-finder — out of a contained rung's reach — plus 7 expected-`Unintegrable`
  (Rubi itself returns unevaluated there; CE's inert `Integrate` is the correct
  match).
- **R8 follow-ups:** (1) extend the shared linear-factor partial fraction
  (`expandRationalOverLinears`) to REPEATED (`Csch²`/`Coth²` → `(y−1)²(y+1)²`)
  and COMPLEX (`Tanh` → `y²+1`) denominator roots — #243/#408/#455 decline
  structurally today, and the extension also reaches the analogous R17 trig
  rows; (2) the by-parts-only tail (rows whose numerator hyperbolic is itself a
  POWER in the additive denominator, e.g. `a+b·Sinh⁴`) still wants genuine
  by-parts machinery.
- **R29 residual:** the bare `(a+b·Sinh²)^(3/2)` even-parity shape (genuinely
  EllipticE/F), the ₚFq row #518, and the `√(Sinh·Tanh)`/`√(Cosh·Coth)`
  quarter-power oddballs (6.7.1 #560/#563).

### Bignum / numeric track

The item-17 / B-series performance pass is largely complete (`ln`, `exp`, `kˣ`,
`sqrt`, `Γ` at 1000 digits now beat or match mpmath). Two deferred items remain:

- **17.12 — r-step / rectangular splitting in `fpexp`.** A real but small kernel
  win (~3×); the kernel is <10% of `exp(.N())` time, so the user-facing impact
  is low. Lowest priority.
- **17.15 — base-2 special-function kernels (`gammaln` et al.).** The deeper
  half of the `Γ`-vs-mpmath gap (still ~5–7× at 200 digits after 17.14). The
  _elementary_ kernels run on a base-2 fixed-point grid where "round to p bits"
  is a free bit-shift; the _special_ functions (`gammalnCore` + Bernoulli
  Stirling machinery, `digamma`/`trigamma`/`polygamma`, `zeta`, `beta`) still
  run at the base-10 `BigDecimal` level and pay the rounding tax. Porting is a
  substantial undertaking (argument-shift product, Bernoulli-rational series,
  reflection formula, `exp`/`ln` glue all move onto `bits`-scaled `bigint`s).
  Expected to close most of the gap; the residual ~2× is V8 `BigInt` vs GMP, not
  closable without a different bigint backend (e.g. WASM GMP). Lower priority:
  the special functions are already 130–170× faster than 0.59.0 and competitive
  for typical use — a "catch mpmath" item, not a correctness/capability gap.

### Symbolic-evaluation performance

#### P1. Symbolic evaluation still 1.2–1.5× slower than 0.118.2 after the 2026-09-05 fix (OPEN, perf — residual)

Found while regenerating the CHANGELOG benchmark tables for 0.124.0: against the
same Mathematica baseline, the symbolic ratios of the current build were about
half of those published with 0.116.0, while the 200-digit numeric rows were
unchanged. Timing each published bundle and the current build in ONE warm
process (`benchmarks/runners/run_ce_rubi.mjs` with `CE_PUBLISHED_BUNDLE` pointed
at each release; the bundles for 0.116.0 through 0.123.2 are provisioned under
`benchmarks/.competitors/`) showed the slowdown accumulated in steps at 0.119.0,
0.120.0, 0.121.0 and 0.122.0 — 1.7–2.8× in total on simplification, integration,
definite integrals and solving.

**Fixed (2026-09-05, shipped in 0.124.1; the CHANGELOG entry describes it):**
three causes, found with CPU profiles of unminified bundles of the release tags
diffed function by function. (1) `BoxedNumber._computeLiteralType` read
`bignumRe` — a working-precision square root for a radical — on every fresh
exact literal, twice (exactness test, enclosure); the exactness test no longer
reads it and `literalEnclosureType` works from the double `re`. (2) The directed
decimal rounding of every derived range bound (`finalizeInterval`) and of the
enclosure ran through `BigDecimal`; `roundSignificantToward`
(`numerics/interval-arithmetic.ts`) does it in double arithmetic, bit-identical
to the decimal route (pinned by
`test/compute-engine/round-significant-toward.test.ts`). (3) `factsFromType`
computed the collection facts (two `provablyDisjoint` proofs) whenever a handler
asked only for finiteness, and the `typeFact(…) === true` probes across the
library paid a `provablyDisjoint` on their `false` arm for an answer they never
read; the facts are per-fact now and the probes are `isSubtype` tests. Plus
cheap first checks in `provablyNaNOperand`, `isExtendedRealOperand`,
`isTensorOperand`, `isNumericTuple` and `isTuple`.

**What remains** (µs per call, one warm process per build, interleaved runs,
median of 50; box load 1.5–2.5):

| Case                 | 0.118.2 | 0.124.0 | fixed | fixed ÷ 0.118.2 |
| -------------------- | ------: | ------: | ----: | --------------: |
| box `√6x + √2x`      |      60 |     147 |    79 |            1.32 |
| simplify `√6x + √2x` |     716 |    1526 |   957 |            1.34 |
| simplify `√(3+2√2)`  |     194 |     360 |   225 |            1.16 |
| solve `x⁴+x²−1=0`    |    4940 |    8540 |  5950 |            1.20 |
| `∫1/(x³+1)dx`        |    2380 |    4740 |  3120 |            1.31 |
| `∫₁² 1/x dx`         |     163 |     301 |   242 |            1.48 |

The residual is diffuse — no single function above 3 % of a call. Per-function
self-time diffs of the fixed build against 0.118.2 (simplify case, µs per call)
name: garbage collection +18, `isSubtype` +15, the memoized type derivation of
function nodes (`type`/`compute`/`cachedValue`) +12, `structureOfExpression` +8,
`addTypeOnTypes` with `foldIntervalsOfTypes` / `finalizeInterval` +8,
`get finite` +5, `sortProductOperands` +4, `isSame` +3. Two structural sources
behind those numbers: the type derivations that the `Add`/`Multiply`
canonicalization forced on every intermediate product and sum through `isTuple`
/ `isNumericTuple` (a quarter of a simplify call), and the allocation per
derivation (a descriptor and its facts object per operand, a structure view per
`structureOf()` call, an interval per fold, a fresh literal type per fresh
literal).

**Forced derivations removed (2026-09-06, shipped in 0.124.2; the CHANGELOG
entry describes it).** `isTuple` / `isNumericTuple` now answer from the operands
for an arithmetic application (`SCALAR_LIFT_HEADS` in `collection-utils.ts`:
tuple-shaped only when an operand is), the evaluate-time NaN gate no longer asks
an application (`isNaN === true` is never its answer), the runtime conformance
check declines a symbolic operand before reading its type, and
`nonNumericOperandError` skips literals and `number`-typed operands. With
`isSubtype` fast paths and four smaller cuts: 5–12 % less time per call on
simplify, solve and the indefinite integral; boxing and `∫₁² 1/x` unchanged.
Measured with the lock held at box load 3–5, five interleaved rounds, medians
(µs per call):

| Case                 | 0.118.2 | 0.124.1 |  now | now ÷ 0.118.2 |
| -------------------- | ------: | ------: | ---: | ------------: |
| box `√6x + √2x`      |      41 |      45 |   44 |          1.07 |
| simplify `√6x + √2x` |     234 |     292 |  279 |          1.19 |
| simplify `√(3+2√2)`  |      85 |      95 |   87 |          1.02 |
| solve `x⁴+x²−1=0`    |    2475 |    3165 | 2859 |          1.16 |
| `∫1/(x³+1)dx`        |    1985 |    2661 | 2393 |          1.21 |
| `∫₁² 1/x dx`         |     173 |     221 |  220 |          1.27 |

**What remains** is the cost of a derivation itself and its allocation. A fresh
`Add(x, y)` / `Power(x, 2)` / `Multiply(√6, x)` node types in 2.3 / 2.8 / 3.3 µs
against 1.2 / 1.1 / 2.5 µs on 0.118.2 (micro-benchmark on `ce._fn` nodes, 20 000
each), and no single line of the derivation carries it: the handler call
(Add/Multiply/Power handlers with their interval folds) is ~0.4 µs, the
function's own body ~0.5 µs (closures, descriptor array, the missing-absorption
and broadcast scans over the operands), then `skipBroadcastForVectorOps`,
`provablyNaNOperand`, `isExtendedRealOperand`, `broadcastsOverTuples` at 0.1–0.2
µs each. The solve case's per-function self-time deltas against 0.118.2 (µs per
call) are led by garbage collection +160, then `roundSignificantToward` +70 (now
cut for integer bounds), `get re` in `getImaginaryFactor` +45,
`makeNumericFunction` +38, `replace` +32, `provablyNaNOperand` +31,
`structureOfExpression` +28, `factor` +27, `canonicalPower` +26, the derivation
body +26, `broadcastsOverTuples` +25 (now a set lookup), `isPrimitiveSubtype`
+24, `makeNumericValue` +22, `addTypeOnTypes` +22, `_BoxedExpression` +22 (more
nodes built), `finiteFromType` +21. The definite integral's gap is in boxing,
not evaluation: `makeCanonicalFunctionCore` 110 vs 81 µs,
`applyOperatorDefinition` 63 vs 48, with `hasSignatureArm`, `reduceUnionType`
(under `widen`), `recordTypeProvenance` and `_withoutFacts` new since 0.118.2 at
1–3 µs each. The next round is designed in
`docs/plans/2026-09-06-type-facts-per-type.md`: an instrumented count shows that
the volume is not the derivations (146 per solve call) but the questions asked
of types afterwards (4 389 subtype queries over 1 121 distinct pairs, 1 818 type
reads), so the facts a type has are to be computed once per type value and read
by every predicate. Levers after that: a per-value literal-type cache (the same
rational or radical value boxes to the same type object), a descriptor pool, and
a memo of `broadcastsOverTuples` / `broadcastableParamSlots` per definition.

**Literal types are not the lever (measured 2026-09-06, box load 2.7, three
interleaved rounds, medians).** Four retreats from the literal-tier types were
timed against the shipped 0.124.1 build on the same six probes, and the fourteen
type-related test suites were run under each to count the proofs lost: replacing
the enclosure of a non-machine-exact literal (`real<2.4..2.5>` for `√6`) by the
open sign range `real<0<..>` changes NO timing (79 / 953 / 6210 µs on box /
simplify / solve, identical) and fails 15 pins; typing such a literal by its
bare tier fails 16 pins for 5–10 %; keeping value types for integers only fails
27 pins for the same 5–10 %; and dropping literal types altogether fails 81 pins
for 10–18 %, at most a third of the remaining gap to 0.118.2. The capability
lost is concrete: `arcsin(1/3)` and `artanh(1/3)` type `complex` instead of
`real` without the enclosure, `arcsin(0.5)` needs the value type of a
non-integer, and `1/(x + 1/3)` with `x: real<0..1>` loses its bounds. Decision:
keep the literal-tier types as they are; the residual lies in the derivation of
function nodes, above.

**Shared type facts and boxed handler results implemented (2026-09-06, shipped
in 0.124.3).** `OperatorTypeHandlerOnTypes` now returns `BoxedType | undefined`.
Immutable types share lazy proofs, intervals, normalized boxes, and equal
numeric value/range identities. Mutable types and aliases keep live reads;
literal precision and derived bounds are preserved. Two warm, interleaved
comparisons against 0.124.2 reduce time by 14–16% on `√6x + √2x` simplification,
7% on solving `x⁴+x²−1=0`, 9% on `∫1/(x³+1)dx`, and 25% on `∫₁² 1/x dx`. Boxing
improves 5–8%, nested-root simplification 3–4%, and the ranged-product type
control 44–46%. Subtype queries fall 871 → 26 / 4 243 → 333 / 4 491 → 392 on
simplify / solve / integrate, while descriptor counts are unchanged. The
measured setup and raw results are in
[`docs/plans/2026-09-06-type-facts-per-type.md`](docs/plans/2026-09-06-type-facts-per-type.md#measured-outcome).
P1 stays open: the next experiment is a scalar arithmetic dispatch path; the
historical gap to 0.118.2 has not been remeasured in this round.

Reproduce a measurement with
`CE_PUBLISHED_BUNDLE=<bundle to compare> node benchmarks/runners/run_ce_rubi.mjs`:
it times the published bundle and the current build
(`dist/esm-min/compute-engine.js`, so build first) on the whole case set in one
warm process — one shared engine per build, a warm-up pass, then the median of
up to 50 timed calls per case — and prints one JSON line per (engine, case);
compare the `ce-pub` and `ce-current` lines of a case. Take the box lock: the
numbers are meaningless under load.

#### P2. The `.unknowns` numeric gate is not universally sound (funnel LANDED 2026-07-26, scope cut in half)

`boxed-expression/numerics.ts` exports one gate in three shapes —
`numberLiteralOf()` (the literal), `numericValueOf()` (a finite real machine
`number`), and `complexValueOf()` (the `[re, im]` pair, finiteness deliberately
NOT filtered) — all of which check `.unknowns` before `.N()`. Kept here for the
rule the round discovered, which governs every future call site.

Partial numericization floats the exponents, so `.N()` resolves symbolic
identities that carry free variables and that `simplify()` cannot see:
`(4-root b / 4-root a)^2 - sqrt(b)/sqrt(a)` numericizes to `0` with `a`, `b`
unknown. Gating Rubi's `PossibleZeroQ` (`zeroQ`) on `.unknowns` therefore made
it answer "not zero" for a true zero and LOST a closed form outright
(integration-rules #544).

So the rule is: **ask which branch `undefined` lands the caller in.** The funnel
is for sites where "no numeric value" is the give-up branch. It must NOT be
applied where the site exists to probe a symbolic expression numerically —
`zeroQ` and the `PosAux` sign heuristic (`rubi/rubi-utils.ts`),
`numericMagnitude` (`symbolic/solver-utils.ts`, hence `symbolic/recurrences.ts`
which consumes it), and the rationalize-denominator gate
(`symbolic/simplify-power.ts`) each keep a bare `.N()` and say so in a comment.
At two of those the gate is not even conservative — they accept on a non-value —
so declining would have made them more permissive, not less.

**Do not cache `unknowns` for this**: the gate is 2-50x cheaper than the `.N()`
it replaces, so a `cachedValue`-keyed `_unknowns` would add invalidation surface
for no measurable win.

#### Free-variable `eq()` follow-ups (reordered to sampling-first 2026-08-03; both levers unbuilt, tracked so they aren't re-derived)

The `eq()` free-variable branch now samples before the expand+simplify proof
(commit `aa48b48e`; a Tycho witness dropped 14.6 s → 6.2 s). Two further levers
were designed and deliberately NOT built, because the reorder alone met the
need:

- **Expand+simplify memo** — for a workload where repeated comparisons _agree_
  under sampling (so the symbolic proof still runs each time), memoize
  `_expand(x).simplify()` per engine: structural-hash key, `isSame` guard,
  invalidated on `_mutationGeneration` **plus** per-free-symbol `_writeVersion`
  dependencies (the item-126/127 element-memo discipline — plain `_generation`
  churns on ephemeral loop-index writes and would never hit inside a drain). A
  bundle-patch prototype measured 14.6 s → 6.6 s on the same witness before the
  reorder superseded it.
- **Loop-invariant broadcast operand hoisting** — each broadcast element
  evaluation re-resolves invariant scalar operands to _fresh_ nodes (verified: a
  WeakMap keyed on node identity got zero hits within a drain), so
  `stochasticEqual` recompiles the same tree per element. Hoisting invariant
  operands once per drain would restore node identity and enable a per-node
  compiled-evaluator cache. Only worth it if a witness shows sampling-compile as
  the hot path; per-comparison cost is currently a compile + ~50 point
  evaluations.

### Strategic

#### 7. Fungrim Phase 4 — branch-cut-safe simplify & exact pole asymptotics

The analytic-property store (`ce.functionProperties`, pole-aware `N()`), the
`Residue` operator, and the `onBranchCut` guard are in place. Two consumers of
the store are only partially built:

- **(a) Branch-cut-safe simplification — largely complete.** The logarithm
  family is guarded: `ln(a) + ln(b) → ln(ab)` (`simplify-log.ts`) requires
  every argument to be provably non-negative (decision of 2026-10-01), and the
  `.ln()` expansions `ln(bⁿ) → n·ln(b)` / `ln(a/b)` / `ln(root)`
  (`boxed-function.ts`) consult `onBranchCut` and stay symbolic when an operand
  is provably on the negative-real cut. Power/root _products_ (`√a·√b → √(ab)`,
  `(ab)^p`) were already safe — gated on `isNonNegative` in
  `arithmetic-mul-div.ts` (see also the `foldIsSound` `(base^r)^e → base^(r·e)`
  gate). What's left is **not** store- driven: a guarded `arctan(x) + arctan(y)`
  addition would be a _new capability_ (CE doesn't combine inverse-trig today),
  and its validity region (`xy < 1`) is an arithmetic condition, not an
  `onBranchCut` cut-membership test — so the store doesn't serve it.
  Complex-domain Fungrim rules already carry their own loader guards. (The
  generic-real simplification policy for even/odd/irrational exponents is
  settled and documented in
  [`docs/SIMPLIFY.md`](./docs/SIMPLIFY.md#generic-real-simplification-policy).)

- **(c) Exact asymptotics at special-function poles — one rung remains** (the
  kernel, residue-at-∞, signed pole limits, and `Beta` pole data all landed;
  `GammaLn` is a genuine non-goal — logarithmic branch point, not meromorphic).
  Demand-paced:
  - **Sum-of-residues-in-a-region helper** — needs a pole-enumeration API over
    the analytic-property store.

**Effort:** (a) residual and the (c) rung are each small-to-medium,
self-contained items.

#### 8. Disjunctive guards (`Or`) in the assumptions system

**What:** 87 complex-domain corpus entries remain undischargeable because their
guards are `Or`-rooted (the assumptions design deliberately scoped disjunction
out — `docs/fungrim/FUNGRIM-PLAN-3-ASSUMPTIONS.md` §7 non-goals). The remaining
~43 failures are symbolic bounds (`|z| < φ−1`), which the assume-side
decomposition deliberately drops.

**Why "strategic":** disjunctive facts are a real design extension (case
splitting or watched-disjunct propagation), not an incremental patch. The guard
census (`scripts/fungrim/guard-census.json`, currently 89.6% complex-domain
dischargeable) quantifies exactly what it would buy. Let demand justify it.

#### 10. TypeScript 7 — retire the TS 6 compat alias

The TS 7 side-by-side install landed 2026-07-08 (`@typescript/native` drives the
build/typecheck; the module name `typescript` is aliased to the TS 6 API because
TS 7.0 ships no programmatic API and ts-jest/typedoc/ typescript-eslint/madge
all require one; bare `npx tsc` is ambiguous — use the explicit native-binary
path). The nodenext `.js`-specifier codemod landed the same day; **new-file
convention: relative imports in `src/` use `.js` specifiers.**

**Remaining:** drop the TS 6 compat alias once TS 7.1 ships its (new, different)
programmatic API **and** ts-jest/typedoc/typescript-eslint/madge support it.
Until then the side-by-side install is the intended end state, not a hack.
**Effort:** small once the ecosystem is ready.

### Correctness & symbolic findings (2026-07) — residue

The July 2026 correctness and symbolic reviews are fully dispositioned: every
verified P0 and P1 landed across the Wave 1–4 commits, and the **P2/P3 sweep
itself completed in the tail-phase rounds 8–10** (`72f3a353`, `f5e0e339`,
`a2b78928`, plus the P2-1 dispatch index `8667a0aa` and the benchmark capstone
`c20a4b2e`) and the follow-on round (`e65eee11` complex-type inference,
`99fa7276` D12-A exact Gaussians + parser perf, `c4def410` non-finite typing
convention). The campaign is summarized in
[`docs/STATUS_REPORT.md`](./docs/STATUS_REPORT.md); detailed execution records
remain in Git history. What remains from the reviews is the residual tail: the
item-4 filed residuals (Artanh/Arcoth-class literal poles, `∞+i` numeric-value
finiteness, the `~oo` lattice question, the `Multiply(x, +∞)` fold positivity
review), the non-blocking tracked residuals (fu `sin⁴−cos⁴`, defint
error-bar/tanh-sinh, machine `gamma()` mid-range digits, …), and the item-5 perf
levers — of which only bundle cold-start survives: the cache-shaped levers were
closed measured-unprofitable by the 2026-07-18 P2/P3 tail; do not re-attempt
them without a new profile.

The Stage-2 corpus audit (2026-07-10, all 57 topics) surfaced three
engine/tooling items — all fixed; the full-corpus run grades **0 False** (True
1589, seed 42).

### Test-suite ledger — skips and `@fixme` markers (sweep 2026-07-18)

Deferred capability recorded directly in the test suite (beyond the Wester
ledger, B13). Each entry's acceptance test already exists:

- **Simplification gaps** — 12 `test.skip` in `simplify.test.ts`: common
  denominator for rational expressions (`1/(x+1) − 1/x → −1/(x²+x)`);
  ln→inverse-hyperbolic recognition (six identities, e.g.
  `ln(x+√(x²+1)) → arsinh x`); inverse-trig conversion
  (`arctan(x/√(1−x²)) → arcsin x`); `factor()` extracting common factors from
  `Add` (`2π+2πe < 4π → 1+e < 2`); `(−x)^{3/4}`; `ln((x+1)/e^{2x})`
  (canonicalization expands before log rules fire); the Fu-paper Phase-14
  multi-step trig identity.
- **Parser `@fixme` clusters** (latex-syntax tests): pre-sub/superscripts
  (`_p^qx`, `\vec{AB}` over multi-letter args — `supsub.test.ts`); chained
  `\over` mis-association (`errors.test.ts`); postfix `\degree` precedence
  (`trigonometry.test.ts`); partial-derivative fraction forms
  `\frac{\partial^2}{\partial_{x,y}} f(x,y)` (2 skips, `operators.test.ts`);
  malformed integrand `\int\frac{3x}{5dx}` not rejected (`calculus.test.ts`);
  lowercase-arrow `Implies`/`Equivalent` expectations outdated by the issue-#156
  `\rightarrow`→`To` change (`logic.test.ts`).
- **Numeric known-wrongs** (nightly + unit markers): bignum `Arccos` near 1
  loses ~8 digits (endpoint cancellation; per-case skip in
  `mpmath-kernels.test.ts`); `ζ(−0.5)` ~4 ulp (tolerance-relaxed); one
  `Multiply` inexact case where the big-precision path is worse than machine
  evaluate (`arithmetic.test.ts` `@fixme`).
- **Misc:** SymPy-interop literal parses `0`/`0e0`
  (`test/math-json/sympy.test.ts`, see the interop stubs below); range/interval
  membership assumptions not wired (`assumptions.test.ts` `@fixme` setup lines);
  malformed positional-parameter name `_1_0` in a `Function` snapshot
  (`functions.test.ts`); the `grudnitski.test.ts` equivalence benchmark keeps 9
  `describe.skip` groups (equation-scaling / identity-based `isEquivalent`
  capabilities).

`test/playground.ts` remains the tracker for its own residue (notation
decisions, Iverson/Boole and inequality→`Range` wishlist, matcher internals).

### Source-marker backlog (`src/` sweep 2026-07-18)

Significant in-code `@todo`/`@fixme` not already covered by a section above:

- **SymPy interop is stubbed:** `math-json/serialize-sympy.ts` (special
  values/heads, lambdas, strings unhandled) and `math-json/parse-sympy.ts`
  (atom/attributeref/subscription/slicing/call grammar not covered). Decide
  whether this surface is worth finishing or should be retired.
- **Operator-signature type arguments:** the result-type/`at`-handler
  consistency warning in `boxed-operator-definition.ts` is disabled — needs
  generic type arguments in signatures (`Map`/`Filter` return an indexed
  collection iff the input is indexed).
- **Declared-symbol validation** deferred at `latex-syntax/parse.ts` ~2459
  (declared symbols not checked against existing symbol/function/inferred uses;
  likely belongs in canonicalization).
- **Issue #189** simplification case referenced in `simplify-rules.ts`.
- **Compile targets:** GLSL `TODO(E3-GLSL)` (needs loop unrolling or fixed-size
  arrays, `base-compiler.ts`); the public per-operator `compile` handler has no
  preamble/helper-injection hook, so GLSL/WGSL custom loops aren't ergonomic —
  extend `OperatorCompileContext` if a real need appears.
- **Risch algorithm** noted as the principled endpoint for
  `symbolic/antiderivative.ts` (the Rubi track is the practical lever; kept as a
  marker, not planned).
- **Fractional calculus** (`library/calculus.ts` `@todo`: Liouville–Riemann
  derivative) — unplanned, catalogued.

### Review residue (open low-priority items)

The June 2026 codebase review (REVIEW.md) is fully dispositioned; its full text
is in git history. The only items deliberately left open:

- **A14 (LOW)** — `boxed-expression/order.ts` tie-breaks: operator and string
  branches sort descending while the symbol branch and doc comment say
  ascending. Deferred because forcing ascending changes established canonical
  orderings in a debatably _worse_ direction (e.g. `-(sech x · tanh x)` instead
  of the textbook `-(tanh x · sech x)`) and churns calculus snapshots. Resolving
  it is a canonical-form design choice, not a bug fix.
- **G5 (LOW)** — `["Subscript", "a", "k"]` canonicalizes to the fused symbol
  `a_k`, severing the binding when `k` is a binder-bound index. A correct fix
  needs binder-aware canonicalization (the canonicalizer has no enclosing-binder
  scope at fusion time) — too broad for a LOW finding. Workaround: the call form
  `["a_", "k"]` (which the Fungrim corpus uses).
- **validate.ts round (2026-07-18), flagged not fixed:** the optional/variadic
  parameter loops lack the devolve fallback and `inferredSignature` acceptance
  the required-param loop has (probably intentional; no observed hits);
  `arithmetic-power.ts` ~:345 carries an order-dependent `matches('complex')`
  with its own `fix?` comment (narrowing to literals).
- **List-valued big-op bodies on non-JS targets — residues of the 2026-08-12 fix
  (Tycho item 171).** A body with POSITIVE collection evidence (a user function
  whose `Function`-literal body types `collection`) under an item-121 exemption
  now declines on every non-JS target with an actionable D6 message
  (`assertScalarBigOpBody`, `base-compiler.ts`; pins in
  `list-valued-summand-compile.test.ts`). Deliberately untouched: a LYING
  declaration (`-> number` head over a `List`-constructing body) keeps its
  current path on every target, including the broken GPU emission (shader source
  that does not compile, behind `success: true`) — declining it would change JS,
  a different defect; and the JS comparison-gate side effect (`a(h(i)) < y`)
  still has no dedicated pin.
- **`elementCount` adoption — residues of the `_broadcastCount` fix
  (2026-08-12).** `_broadcastCount` is gated on `broadcastable === true`, and
  the optional `elementCount` operator-definition handler (the `count` twin of
  `canEnumerate`) lets an operator that knows its own length say so without
  evaluating; `Sort`/`Ordering`/`RandomShuffle` and `Chunk` adopted it (pinned
  in `test/compute-engine/tycho-item-167-broadcast-count.test.ts`).
  - Every other reshaping/eager operator now reports an honest `undefined`
    instead of a wrong number (`GroupBy`, `BinCounts`, `Histogram`, `Tally`,
    `Unique`, `Flatten`, `Shape`, `Quartiles`, `RandomChoice`, `RandomSample`,
    `LinearRegression`, `PolynomialFit`, …), as do the count-preserving
    pass-throughs that were right by accident (`N`, `Evaluate`, `Identity`,
    `Typed`, `Matrix`, `Transpose`, …). Each is an `elementCount` handler away
    from answering again; adopt on demand, never as a name list in engine code.
  - Whether `Prime` (and other type-handler-lifting operators) should carry the
    `broadcastable` definition flag is undecided. Today is consistent
    (`Prime([1,2,3]).count` and its `evaluate().count` are both `undefined`), so
    nothing is wrong — but the flag would give such operators the broadcast
    count AND the `isEnumerableCollection` broadcast tier. Deciding needs a
    sweep of every flag consumer (canonicalization, compile gates, the facet),
    for the whole class at once, not per operator.
- **Typed `Declare` does not survive a LaTeX round trip (RULED DEMAND-GATED
  2026-08-12).** A standalone `["Declare","s","'number'"]` round-trips typed
  since 2026-09-29 (`\mathrm{Declare}(s, \text{number})`), but a leading
  `Declare` in an outer `Block` still vanishes
  (`Block(Declare(s,'number'), Assign(s,1))` serializes to `s\coloneq1`): LaTeX
  has no spelling for a type annotation, no consumer round-trips typed
  declarations through LaTeX today (Tycho emits untyped ones), and the first
  real consumer's usage should pick the notation. Re-open when one appears;
  until then the drop is silent — the accepted cost of not guessing a notation.
- **Dispatch admission residues, no witness (recorded 2026-08-12 with the
  multi-clause dispatch fix).** `accepts` (`value-membership.ts`), like
  `valueComponent`, reads `t.def` directly instead of `aliasDefinitionAt(t)`, so
  a PARAMETERIZED structural alias unfolds without substituting its type
  arguments — a divergence from `subtype.ts`, wrong-verdict-capable if a
  parameterized alias with a value component reaches dispatch. A self-negating
  alias (`type n = !n`) has no fixed point, so the alias-unfolding cycle guard's
  cut there is arbitrary-but-terminating (the parser may not even accept the
  shape). And a concrete non-numeric value (a `Tuple` against a
  nominal-reference clause) now refutes where it previously blocked —
  oracle-consistent by construction, untested in the wild.
- **Degenerate big-op round (2026-08-03), flagged not fixed:**
  - Dependent multi-index big-op bounds don't evaluate:
    `Sum(j, Limits(i,5,5), Limits(j,i,10))` canonicalizes intact (the vacuity
    fix keeps `i`'s set) but stays symbolic — `classifyBigopDomain` reads the
    symbolic lower bound `i` as non-enumerable. Enumerating would need
    per-iteration re-resolution of dependent bounds in the multi-set walk.
  - Collection-valued body of a degenerate big-op is a semantic fork:
    `Σ_{i=a}^{a} L` (L a collection, index unused) routes through the
    pre-existing arity-1 rewrite `Reduce(L, 'Add', 0)` — it sums L's elements —
    where the one-point fold would yield `L` itself (one term, that term being
    the list). Decide which reading is intended before touching it; the current
    behavior predates the fold and is deliberately preserved.

**Lessons worth keeping in mind** (the durable ones are in CLAUDE.md): the
`undefined → false` collapse in three-valued predicates was the single most
recurring bug class (A3, G3, the sets/Union/Range contains family, NaN
comparisons); validation-by-corpus (the Fungrim harness) found 15 engine bugs
that targeted review missed — keep running it.

### Load-sensitive test flakes under a full-suite run (observed 2026-08-31)

Three suites failed under a 6-worker full-suite run and pass cleanly — at bare
HEAD `3e8bd6ed` and with the error-model diff alike — when run alone on an idle
box, so the failures are contention artifacts, not code defects:
`functions.test.ts` ("ASYNC LANE KEEPS A SCOPED HANDLER'S LOCAL SCOPE ALIVE", 6
tests — concurrency-timing sensitive), `fungrim-loader.test.ts` ("loads in a
reasonable time" — a wall-clock budget pin), and `rubi-utils.test.ts` (one R18
closure). If these recur in quiet-box full runs, they stop being flakes and
deserve a real investigation; until then a full-suite report should attribute
them before blaming the change under test. Added 2026-09-22:
`elementwise-which.test.ts` "perf smoke › the 3-clause × 900-element witness
evaluates promptly" — a canary-normalized timing assertion (limit 5000 canary
units) read 6251 in a six-worker full run on a box at load 4 and passed alone
(70 of 70), while the same tree's other timing pins held.

### `LerchPhi` past |z| = 1 still declines for a complex `a` whose shift terms dwarf the value (OPEN — residue of the two 2026-09-30 rounds, #340, #353)

`lerchPhiComplex` (`numerics/lerch-phi.ts`) declines (`N()` stays symbolic)
where no route can vouch for 1e−11 relative accuracy; it never returns a wrong
number (every returned value on about 30 000 sweep points is within 1.1e−12 of a
reference). The routes past the circle: the continuation
(`lerchContinuedWithError`), the sum over the Fourier modes of the base point
for a real `a` and every `s` that is not a positive integer
(`lerchModesComplex`), an integral route for `Re(s) > 0`
(`lerchIntegralComplex`), and Lerch's transformation formula for a complex `a`
(`lerchFunctionalComplex`); a Taylor series in `a` was tried and removed (it
answered no point the others miss and cost up to 0.5 s per declined call). What
still declines:

- A complex `a` with `Re(a) < 0` where the terms that move `a` into the strip
  `0 ≤ Re(a) ≤ 1` are hundreds of times the value or more: 217 of 1197 points
  (`Re(s)` from −30 to 1, `|z|` up to 1e7), 31 of 1200 with `|z| < 32`. Example:
  `LerchPhi(-246.62-375.42i, -29.535, -5.5009-2.4185i)`, reference
  `1.1285770581632545e21 − 1.6446479143332522e22i`. The formula's value is
  3.6e−12 off there, but its estimate is 1.7e−10: the term for the rounding of
  `v = e^{2πib}` is pessimistic at a large order. Extended precision for the
  shift would answer the worst of them.
- A complex `a` with `Re(s) ≥ 1/2`, `|Im a| ≳ 3` and `|z| ≥ 1000`, where the
  integral oscillates: 44 of 800 points, for example
  `LerchPhi(2626400, 7.1652, -5.2092-3.5859i)`.
- A real `a`, `Re(s) < −9`, `|z| ≥ 1000`: 3 of 3000, where the estimate is 8 to
  25 times the actual error. Example:
  `LerchPhi(-552.66+1009.12i, -23.020, -6.1124)`, reference
  `−4.7098482456230114e17 − 1.9081680693676611e18i`.

Re-measured after the `hurwitzZetaComplex` change for `|Im s| ≥ 2` (same day):
the same points decline; the kernel is no longer a limit of the modes route
(within 88ε of its envelope up to `|Im s| = 20`, `hurwitzKernelWeight`).

Do not take references for a complex `a` past the unit circle from mpmath's
`lerchphi`: it returns a value on the wrong sheet of the incomplete gamma term
in part of the `a` plane (the engine had the same defect until 2026-09-30; see
`closedTermSheet` in `lerch-phi.ts` and the tests that pin the corrected
values). For `|z|` above about 1e5, `lerchphi` at 60 digits is also wrong
(7.5e−7 at `lerchphi(-9959.2, -8.16, 1.25)`); use 200 digits or more, or the
integral `(1/Γ(s))∫₀^∞ t^(s−1)e^(−at)/(1 − z·e^(−t)) dt` for `Re(s) > 0`.

### `HurwitzZeta` declines some complex arguments with a large `|Im a|` and a large `|Im s|` (OPEN, capability — residue of the 2026-09-30 round)

`hurwitzZetaComplexWithError` (`numerics/numeric-complex.ts`) declines, so the
expression stays unevaluated, when its per-call error estimate is above 1e−12 of
the value even after the powers are recomputed in double-double. On 11 900 sweep
points against mpmath this happened at 26 points, all with `|Im a| ≥ 3.4` and
`|Im s| ≥ 7` (20 of 1500 with `Re(a)` from −10 to 0, 3 of 2000 with
`Re(a) > 0`). Example: `HurwitzZeta(-0.22+12.28i, -6.93-4.78i)`, mpmath
`-1.9865506122150481e-14 - 1.4517190884718218e-13i`: the terms of every route
are about 1e−7, so their sum in doubles loses the digits, while the condition
number is small (below 4.4e−14), so a route that does not cancel would answer —
a big-decimal complex Hurwitz kernel, or a representation that does not pass
over the terms left of the imaginary axis. Another example with `Re(a) > 0`:
`HurwitzZeta(-11.57+17.97i, 0.0085-4.458i)`, mpmath
`-1.5251523329103249e-7 - 5.5532800426926228e-7i`. The kernel also declines for
`|Im s|` above about 12 800 (unless `Re(a)` is large enough for the
Euler–Maclaurin sum) and for `Re(a) < −2^20`, both to bound its work; and
`HurwitzZeta(0.5, 0.5+1e300i)` is `NaN`, not a decline, because the modulus of
`a` overflows. Do not take references for `Re(a)` far below 0 from mpmath's
`zeta(s, a)`: at `s = 0.3+50i`, `a = −300.5+2i` it disagrees with its own sum of
the 301 passed-over terms plus `ζ(s, a+301)` by 6.8e−6.

### GPU `LerchPhi` and `PolyLog` still answer NaN where the terms cancel in f32 (OPEN, capability — residue of the 2026-09-30 rounds, #340)

The shader targets (`GPU_LERCH_PREAMBLE_GLSL`/`_WGSL`,
`compilation/gpu-target.ts`) compute `LerchPhi(z, s, a)` and `PolyLog(s, z)` for
real operands past the unit disk since 2026-09-30 (a positive integral for
`s > 0`, the Hermite form with a complex incomplete gamma for `s ≤ 0`, a
rational form for an integer `s` from 0 to −16, the inversion formula for a
negative non-integer order of `PolyLog`, and, tried after every other method,
the sum over the Fourier modes of the base point `_gpu_lerch_modes` for `z < 0`
and `−30 ≤ s ≤ −3`), within 1.5e−5 of the reference wherever they answer (worst
1.38e−5 on 4193 + 900 points, measured on an Apple M5 Max GPU through headless
Chromium, GLSL and WGSL). Each method declines (NaN) when its own error estimate
exceeds 3e−5 of the value. On 600 `LerchPhi` and 300 `PolyLog` points with `s`
from −16 to −3, the mode sum took NaN from 37 to 2 at `z = −1`, from 88 to 7
below it, from 25 to 6 between −1 and −0.3, and from 84 to 25 for `PolyLog`
below −1; values answered before are bit-identical. What remains:

- Values small against the modes: `Φ(−0.8818, −13.863, 1.7443) = −35.664`,
  `Li_{−11.65}(−22837.6) = −9.73e−6`.
- `−3 < s < 0` below `z = −1`: `Φ(−381112, −2.5, 0.33116) = −7.403e−6`.
- `z > 1` with an integer `s`: `Φ(1.617, −6, 5.7837) = −16191.1`.
- Values about 1e37 next to `z = 1` (f32 overflow); `z < −1` with `a < 0` and an
  integer `s > 0` (`Φ(−5.76, 12, −8.464)`, the shifted terms cancel); and values
  below the smallest normal f32, which the GPU flushes to zero.

Far below `z = −1` (review of the same day): the mode sum and Jonquière's
inversion decline unless the value is a finite normal f32, their 3e−5 test is
written `err ≤ 500·|value|` because the old form `ε·err ≤ 3e−5·|value|` flushed
both sides to 0 below about 4e−34 and accepted 0 and ∞, `PolyLog` passes the
factor `z` into the modes' exponent, and the inversion's `Li_s(1/z)` series
stops on the ratio `|1/z|·((k+1)/k)^(−s)` (it stopped after one term for
`s < −20`, 2.6× off at `|z| = 8e8`). On the M5 Max, over `z` in [−1e38, −1] and
`s` in [−30, −3], values more than 1.5e−5 off fell from 786 of 3792 to 16 of
3485 (`PolyLog`) and from 170 of 1141 to 17 of 960 (`LerchPhi`, 15 of them with
a true value below the smallest normal f32). Two things stay open there: the
3e−5 estimate test admits values up to 2.04e−5 off on this GPU (the inversion at
`s < −20`, `|z| > 1e20`, and the modes), where the older domains state 1.5e−5 —
a tighter test would decline more values, and the doc comment states 2.1e−5 for
that region; and a `LerchPhi` true value below 1.18e−38 still returns 0 or a
wrong subnormal through the core methods. In an f32 model whose `log2` is 2.5
ulp off, the error estimates (built for about 1 ulp) do not cover the far domain
(worst 1.24e−4).

A call costs at most about 1100 loop iterations below `z = −1`, plus up to 128
modes and 100 shift terms for the mode sum, and about 4700 next to `z = 1` with
`s < 0` (the 4096-term series first). The f32 model of the shader text is
`test/compute-engine/gpu-lerch-f32-model.ts`; keep it in step with the text.

### GLSL on ANGLE Metal: arithmetic with a constant infinity reads back 0 (OPEN — found 2026-09-30 while validating the WGSL non-finite constants)

On the Apple M5 Max through headless Chromium's WebGL2 (ANGLE over Metal),
`z + _gpu_inf()` reads back `0.0`, while returning `_gpu_inf()` directly,
negating it, `min`/`max` and comparisons are correct. Every constant spelling of
the infinity was tried (a bit pattern, a global, a loop, `exp(1000)`); only a
bit pattern computed from a run-time input works, so no helper can fix it; a
uniform would. WGSL is correct. Related: the WGSL constant `bitcast<f32>` to NaN
or infinity was a shader-creation error in Chrome ("value inf cannot be
represented as 'f32'") at every site until 2026-09-30, so no WGSL shader that
used `Gamma`, `Zeta`, `HurwitzZeta`, `LerchPhi` or `PolyLog`, or any non-finite
literal, compiled in a browser; both targets now spell them through
`_gpu_nan()`/`_gpu_inf()`, and the WGSL versions bitcast a `let`.

### The f32 shader Hurwitz zeta answers NaN next to a zero of ζ(s, a) (OPEN, small — residue of the 2026-09-30 base-point round)

Where the Euler–Maclaurin terms cancel, `_gpu_hurwitz_zeta`
(`GPU_ZETA_PREAMBLE_GLSL`/`_WGSL`, `compilation/gpu-target.ts`) takes ζ(s, b) at
a base point `b` in (0, 1]: Hurwitz's Fourier formula for `s ≤ −3`, Hermite's
integral for `−3 < s < 1`, and `b^(−s) + ζ(s, 1 + b)` from the Taylor series for
`b < 2^−10`. It answers NaN when its error estimate exceeds 3e−5 of the value.
On 18 361 points (`s` from −24.5 to 12, `a` from 0.01 to 30) every value is
within 8.1e−6 on an Apple M5 Max GPU (before: 795 values above 1.5e−5, up to 77×
off at `ζ(−23, 1/4)`), and 432 are NaN: 387 of them are points where a half-ulp
change of `s` or `a` moves the value by more than 1e−5, and the other 45 have
`−3 < s < 0` next to a zero where Hermite's closed terms and integral cancel,
for example `ζ(−2, 0.4666789…) = −0.0027644` and
`ζ(−2.99, 0.8854986…) = 0.0058845` (mpmath at the f32 operands). An error
estimate on the Taylor series in `a − round(a)` recovers 11 of them; the double
kernel's exact Bernoulli value plus a correction was not ported. In an f32 model
whose `log2` is 2.5 ulp off, 17 values with `a > 16` and `s < −21` are up to
1.7e−5 off. `_gpu_zeta` answers NaN below `s = −24.5`, although its Stirling
prefactor would carry it to about `s = −63`. The Apple GPU compiler reassociates
`s + (2b − 1)` into `(s + 2b) − 1` (6.7% error at `ζ(−1e−6, 1/2)`); the text
guards it with `max(2b − 1, −1)`, and a test pins the guard.
