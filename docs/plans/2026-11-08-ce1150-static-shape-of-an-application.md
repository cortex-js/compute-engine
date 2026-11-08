# CE-1150, request 1: the shape of an unevaluated application from its static type

Status: proposed, waits for the user. Date: 2026-11-08. Issue: `issues/CE-1150.md`
(Tycho ROADMAP row LK). Size: M.

## 1. The rule today

An application (a `BoxedFunction`) answers `isCollection`, `isIndexedCollection`,
`count`, `isFiniteCollection` and `isEmptyCollection` from its operator's
collection handlers, or from two static rules: the broadcast count of a lifting
operator (`_broadcastCount`, `boxed-function.ts`) and the count of a user lambda
mapped over a collection argument (`_lambdaBroadcastCount`). An application
whose static type is a collection type but whose head has no collection
handlers answers `isCollection: false` and `count: undefined` until it is
evaluated. The decision is recorded at `boxed-function.ts:7040` and in the
test "count does not outrun the walk" of
`test/compute-engine/tycho-item-167-broadcast-count.test.ts` (Tycho item 169,
2026-08-12), and `docs/TYPE-SYSTEM.md` tells a reader to use the type instead.

The reason for the decision: an UNDECLARED head binds vacuously and its result
type lifts over a collection argument, so `Total([1, 2])` on a bare engine
types `list<unknown^2>` although no rule produces its elements. A count that
`each()` cannot deliver was judged worse than no count.

Measured on the repo source, 2026-11-08 (probe in the scratchpad of session
`ce-desk`):

| expression | static type | isCollection | count |
| --- | --- | --- | --- |
| `f(3)`, `f` assigned `(n) ↦ [n, n+1, n+2, n/2]` | `vector<rational^4>` | false | undefined |
| `g(3)`, `g` declared `(integer) -> list<real>` | `list<real>` | false | undefined |
| `h(3)`, `h` assigned `(n) ↦ (n, n+1)` | `tuple<integer, integer>` | false | undefined |
| `[1,2] + x` | `vector<2>` | false | 2 |
| `foo([1,2])`, `foo` undeclared | `list<unknown^2>` | false | undefined |
| `If(c, [1,2], [3,4,5])`, `c` unknown | `list<integer \| list<any>>` | false | undefined |

The cost today: Tycho evaluates at 11 sites only to read the shape of the
value (CE-1150), and a host reader that cannot evaluate (a document that is
not yet complete, a budgeted pass) has no answer.

## 2. The proposed rule

R1. **A bound head is a promise.** An application whose head is bound to a
definition with a signature (a declared signature, the inferred type of an
assigned function literal, or the `type` handler of a library operator), and
whose static type, with `missing` and `nothing` arms removed, is a collection
type, answers from that type when no collection handler and no existing
static rule answers first:

- `isCollection`: `true`.
- `isIndexedCollection`: `true` when the type is an indexed collection type
  (`list`, `vector`, `matrix`, `tuple`, `indexed_collection`), `false` for a
  `set` or a keyed type, `undefined` is not an answer of this getter, so an
  abstract `collection<T>` answers `false`, as it does for a symbol today.
- `count`: the length the type names (`vector<T^n>`, `list<T^n>`, the arity of
  a `tuple`, `typeElementCount()` in `src/common/type/utils.ts`), else
  `undefined`.
- `isFiniteCollection`: `true` when the type names a length, else `undefined`.
- `isEmptyCollection`: `false` when the type names a length above 0, `true`
  for a length of 0, else `undefined`.

R2. **The vacuous lift stays unanswered.** An application whose head has no
operator definition and no value definition with a signature (an undeclared
name, auto-declared `unknown` or the wildcard `function`) keeps today's
answers. The test of item 169 stays as it is.

R3. **A walk still comes from the value.** `each()` and `at()` of such an
application evaluate it once and walk the value, as they do today for an
eager collection operator (`_eachInReadingContext`, `boxed-function.ts:7363`).
R1 changes no walk. A value that is not a collection (an error, `Missing`, a
scalar that violates the signature) walks nothing, as today.

R4. **Agreement of the type and the value is the host's contract.** When the
value disagrees with the promised count, the type was wrong: that is a type
error of the definition, reported where the definition is checked, not a
defect of this rule. The compiled-code caveats (`docs/COMPILATION-MODEL.md`)
already state this for the compiler.

R5 (optional, static analysis). **An `If` or `Which` whose arms agree.** When
every arm's static shape answers the same `isCollection` and the same `count`
under R1 or by literal structure, the selection answers those; otherwise it
answers as today. This is the per-instance `isCollection` handler that `If`
already has, extended to `count`. Decide R5 separately: it is the only part
that reads operands, and it adds a handler.

## 3. What it changes

- **Tycho**: the 11 shape sites of CE-1150 read the property of the unevaluated
  expression. Tycho's `classifyCollectionSchema` still needs the kind of the
  elements (finite real, 2- or 3-tuple, colour); the element type of the
  static type gives `rational`, `integer` or `tuple<real, real>`, and a type of
  `real` admits infinities, so that reader keeps a value check for `real`
  elements or declares its inputs `finite_real`.
- **Compiler**: no decline that this rule removes is known. The compiler
  reads the type where `isCollection` is false for a typed node
  (`compile-conditions.ts:422`, `compile-operators.ts:331`,
  `compile-user-functions.ts:915`). The measure is the decline count of the
  Tycho corpus run, before and after, as in
  `docs/plans/2026-11-05-contraction-impact-report.md` (47 / 44 / 61 for
  javascript / glsl / interval-js at 0.178.0); the expected change is 0.
- **Library**: operators that take `isFiniteCollection === true` as their
  permission to walk (`Sort`, `Unique`, `Tally`, `Chunk`, `Partition`, the
  statistics helpers) now walk an application of a user function whose type
  names a length, by evaluating it (R3). Today they leave it unevaluated or
  decline. This is the behavior change to measure in the test suite: a
  snapshot where `Sort(f(3))` stays symbolic today and becomes a list.
- **Documentation**: the note in `docs/TYPE-SYSTEM.md` ("`.isCollection` is
  false for a computed list whose operands are symbols") is replaced by R1
  and R2; `docs/COLLECTIONS-MODEL.md` gets the rule; the item 169 comment at
  `boxed-function.ts:7040` is rewritten to state R2 only.

## 4. Risks

- A symbol declared with a collection type and no value already answers
  `count` from its type and `isCollection` from its value (`false` with no
  value). R1 makes an application answer `isCollection: true` with no value.
  The difference is R3: an application can be evaluated to get its value, a
  valueless symbol cannot. The abstract-class comment at
  `abstract-boxed-expression.ts:1600` names the hazard for symbols; it does
  not apply to applications.
- An impure head (`RandomInteger` under a user function) gives a different
  value at each walk; R1 promises the shape only, never the elements, and the
  element memo rule for repeated reads is unchanged.
- The type of an application is cached and retired by the type-cache axes;
  R1 reads the same cached type, so no new invalidation is needed.

## 5. Tests

- `f(3)`, `g(3)`, `h(3)` of §1 answer `true` and the counts `4`, `undefined`,
  `2` before evaluation, and the same after.
- `foo([1,2])` and `Total([1,2])` on a bare engine keep `false` and
  `undefined` (item 169 test unchanged).
- A declared `(integer) -> list<real> | nothing` answers `true` for
  `isCollection` (the `nothing` arm removed) and `undefined` for `count`.
- `Sort(f(3))` evaluates to the sorted list; the snapshot change is counted
  and reported.
- Tycho's instrument reads READY in the inferred case (it tests
  `isCollection === true` and `count === value.count`).

## 6. Decision asked of the user

Approve R1 to R4 (size M: the five getters, the docs, the tests, one corpus
run), and say yes or no to R5 (size S on top, one handler). Saying no to the
whole spec keeps the rule of item 169; Tycho then keeps its 11 evaluations,
and the two `BoxedType` getters `elementCount` and `elementType` (size S)
remain the alternative for a host that wants to read the type itself.
