# Protocol extension: a protocol that extends other protocols (spec)

Status: APPROVED by the user 2026-10-31 (revision 3, every decision of §8
as recommended; the repo implements it, not the reporter). User decision
2026-10-31: the keyword is `extends`, and the parents are separated by
commas (`protocol A extends B, C { … }`). Revision 2 answered the first
dual review (`docs/scratch/2026-10-31-protocol-refinement_SPEC_REVIEW.md`, 17
findings); revision 3 answers the second
(`docs/scratch/2026-10-31-protocol-refinement_SPEC_REVIEW_ROUND2.md`, 14
findings). The answers are marked "(review 1.n)" and "(review 2.n)".
Revision 3 has not been reviewed; the two rounds the process allows are
used. Issue: <https://github.com/cortex-js/compute-engine/issues/491>
(follows #362; the host API `conformsTo` and the `Self` binding asked there
shipped). ROADMAP: CE-713. Related: CE-51 (`Indexable` extends `Iterable`).

The issue calls the feature "refinement"; this spec says "extension" and
"extends", the spelling of Lean 4 and Mathlib (`class LinearOrder (α)
extends PartialOrder α`), Java, TypeScript and Kotlin. A protocol `Q` that
extends `P` has every requirement of `P` plus its own, and a type that
conforms to `Q` conforms to `P`.

## 1. What is asked, and why the current shape costs the user

A protocol hierarchy (`FloorRing` extends `LinearOrder`, `Ring` and
`FloorOrder`; those three extend `PartialOrder`) has no spelling today. The
reporter builds a Mathlib-style order and algebra hierarchy and declares
every ancestor by hand, parents first:

```js
ce.declareProtocolImplementation("Money", "PartialOrder", { functions: { compare } });
ce.declareProtocolImplementation("Money", "LinearOrder",  {});   // members: none
ce.declareProtocolImplementation("Money", "Ring",         { functions: { add, mul, zero, one } });
ce.declareProtocolImplementation("Money", "FloorOrder",   { functions: { floor } });
ce.declareProtocolImplementation("Money", "FloorRing",    {});
ce.conformsTo("Money", "PartialOrder");   // true, because of the first line only
```

The engine does not know that `FloorRing` implies `PartialOrder`, so nothing
stops a type from declaring `FloorRing` without `PartialOrder`, and a generic
head written against `FloorRing` cannot rely on `compare`. The reporter
measured (issue #491, M1 Pro, 0.173.0): one `declareProtocolImplementation`
costs about 100 µs, so depth 8 costs about 860 µs per type instead of about
100; `conformsTo` costs 0.3–0.6 µs when the answer is a flat lookup and
0.9–4.1 µs when a chain of depth 1–8 is walked at query time; dispatch never
asks about the hierarchy (a generic head calls members by name), so
evaluation cost does not change.

Asked: a parent list on a protocol, a conformance to an extending protocol
that checks the inherited members, and a `conformsTo` that stays a flat
lookup.

## 2. The design in one paragraph

A protocol record gets an `extends` list of protocol names. The closure of a
protocol is the set of its ancestors plus itself. A conformance declared to
protocol `Q` registers one ordinary conformance edge on **every** protocol of
the closure of `Q` that the target does not already conform to. Nothing else
changes: `conformsTo`, dispatch, the `where T is P` constraint, the compiled
dispatch planner, inheritance by subtype, the pending model, the effect
contracts and the rollback point all read conformance edges, and a derived
edge is an ordinary edge. The invariant the design keeps is: **a type that
conforms to `Q` conforms to every ancestor of `Q`**, and it keeps it under
protocol replacement by making the closure of a protocol monotone (R9).

The alternative, a walk of the `extends` chain at query time inside
`conformsTo` and `bestCandidates`, is rejected: it would touch every reader
of the registry (about 15 functions in `engine-protocols.ts`, the compiled
planner `compilation/protocol-dispatch.ts`, the constraint oracle in
`engine-type-resolver.ts`), and the reporter measured it at up to 10 times
the cost of a flat lookup at depth 8.

## 3. Rules

The rules are numbered R1–R10. On approval they join the protocol rulings of
`docs/TYPE_SYSTEM_ROADMAP.md` (the series is at P47).

**Vocabulary.** The *statement protocol* is the protocol written in a
conformance statement that names one protocol (`FloorRing` in `type Money is
FloorRing { … }`); a block-less `type T is A & B` has none. The *closure* of
a protocol is its ancestors plus itself, in a fixed order (review 1.15): a
depth-first post-order over the `extends` lists in their written order, each
protocol kept at its first occurrence; the statement protocol comes last.
For `FloorRing extends LinearOrder, Ring, FloorOrder` with the three
extending `PartialOrder`, the closure is `PartialOrder, LinearOrder, Ring,
FloorOrder, FloorRing`. Diagnostics report the protocols of a closure in that
order and name the statement protocol as the one that "extends" the
ancestor. The *part* of a block for a protocol is the subset of the block's
members that this protocol declares. Two head patterns are *the same head*
when they are identical up to a renaming of their variables (review 2.2);
`headConflictOf` compares only the head KEY (`list`), which is weaker, and
decides where this spec says it does. A conformance edge is *authored* when
its `_authored` field is set (review 1.13).

**R1. Spelling.** Host API:

```js
ce.declareProtocol("LinearOrder", { functions: {…} }, { extends: ["PartialOrder"] });
```

Epsil, with a soft keyword after the name, before the member block, and the
parents separated by commas (user decision 2026-10-31):

```epsil
protocol LinearOrder extends PartialOrder {
  function lt(self: Self, other: Self) -> boolean
}
protocol FloorRing extends LinearOrder, Ring, FloorOrder {}   // a marker may extend
```

`&` stays the separator of the protocol names of a conformance (`type T is A
& B`) and of a `where` clause; the comma here reads like a parameter list.
MathJSON: `["DeclareProtocol", name, members, ["List", parent, …]]`. The
member dictionary becomes a required operand when a parent list is present
(`["Dictionary"]` when the protocol has no members), so the operand position
of the parents is fixed; a two-operand `DeclareProtocol` keeps its current
meaning, and the signature of the `DeclareProtocol` operator in
`library/core.ts` gains the optional third operand (review 1.14). The
serializer prints the `extends` clause back; an empty parent list is the
same as no parent list, and is not printed. `extends` is a soft keyword:
recognized only in this position, like `is` and `where`, so a symbol named
`extends` stays legal everywhere else (neither `extends` nor `refines` is in
`src/epsil/reserved-words.ts` today). Rejected spellings: `refines` (Swift
prose and Dafny's module keyword only), `protocol A is B` (`is` is the
conformance of a TYPE, and a protocol is not a type, ruling P8), `protocol
A: B` (a colon is a type annotation or a bound everywhere else in Epsil).

Validation of the parent list (review 1.14): a repeated name is
`invalid-protocol-declaration` ("`PartialOrder` is listed twice"); a name
that is a type, not a protocol, is `protocol-unknown` with the message
"`integer` is a type, not a protocol"; a host `extends` option that is not an
array of strings throws `invalid-protocol-declaration`.

**R2. Parents first, no cycles.** Every name in `extends` must be a declared
protocol (`protocol-unknown` otherwise; no forward reference, like the
protocol names of a conformance). The closure of the parents must not
contain the protocol being declared (`protocol-extends-cycle`). A fresh
declaration cannot form a cycle, because its parents exist before it; a
notebook re-run that replaces a protocol can, and this check is what refuses
it. A protocol may list a parent that another parent already extends
(`FloorRing extends LinearOrder, PartialOrder`): the closure is a set, so
the diamond is harmless.

**R3. One declaring protocol per member name in a closure.** A protocol may
not declare a member (function or property) that one of its ancestors
declares (`protocol-member-inherited`: "`compare` is already a member of
`PartialOrder`, which `LinearOrder` extends"). Two parents whose closures
declare the same member name cannot be extended together
(`protocol-extends-member-conflict`). Reason: the bare dispatcher of a
member name serves every protocol that declares it, and a type conforming to
the closure would then reach the same member through two edges, which is
`protocol-call-ambiguous` on every call. Two UNRELATED protocols may still
share a member name, as today (Appendix A, "Dispatching").

At a fresh declaration both checks refuse the statement. At a REPLACEMENT
(a later `protocol` statement for the same name), the check against the new
parents refuses the statement in the same way, but a conflict with a
DESCENDANT is not refused at the statement (review 2.3): a member the
replacement adds that a descendant declares, or a parent the replacement
adds whose closure declares what another parent of a descendant declares
(review 2.13), is recorded, and the end of the batch reports every conflict
still present as `protocol-extends-member-conflict`, naming the descendant
and the two declaring protocols. Between the replacement and the end of the
batch, a call of the shared member on a conformer of the descendant is the
ordinary `protocol-call-ambiguous`, and a conformance statement to the
descendant is `protocol-extends-member-conflict` at that statement (its
split is not well defined). Reason: with the natural order of an edited
program (`protocol P { m }` first, then `protocol Q extends P {}` which drops
`m`), the replacement of `P` runs while the old `Q` still declares `m`; a
refusal at the statement would need the other order, which R2 refuses on a
new engine. With the batch-end report, the same program converges in one
run on a new engine and as a re-run. The full check runs on the new closure
of every transitive descendant.

This is a v1 restriction; Swift allows the redeclaration and treats it as a
second requirement that the same implementation satisfies. Relaxing it needs
the dispatcher to merge the two requirements, and it is not asked.

**R4. The closure expands at the conformance.** The expansion applies to a
conformance statement that names ONE protocol, and to the host route. The
`protocol-implementation-split` check keeps reading the names as the author
wrote them (review 1.9): `type T is A & B { block }` stays refused, because
R3 does not make member names unique across two unrelated closures; a
block-less `type T is A & B` registers the union of the two closures, each
protocol once, and sets no `_via` stamp (review 2.14). `type T is Q {
block }`, with closure `P1, …, Pn, Q`, means the same as:

```epsil
type T is P1 { part of the block for P1 }
…
type T is Pn { part of the block for Pn }
type T is Q  { part of the block for Q }
```

with these differences from writing the n+1 statements by hand:

- (a) The statement is atomic: every protocol of the closure runs the
  per-protocol pre-pass of `declareConformance` (`conformanceTargetProblem`,
  `headConflictOf`, `overlapConflict`, `mutabilityGateProblem`, then the
  validation of its part) before any edge is registered, the registry
  rollback point is taken once, and the widening check of the declared
  effect contracts runs once over all the new edges.
- (b) A protocol of the closure that `T` ALREADY conforms to, and whose part
  is EMPTY, gets no derived edge (reviews 1.8, 2.1). "Already conforms"
  means a non-pending edge on that protocol that dispatch would select for
  `T`: for a ground target, an unconditional edge whose target is `T` or a
  supertype of `T`, or a conditional edge whose clause `T`'s arguments
  satisfy; for a conditional target (a head pattern), an unconditional edge
  whose target contains the widest instantiation of the head
  (`edgeComparisonTarget`, the test `refreshInheritedPending` uses, review
  2.9), or a conditional edge with the same head whose clause the new clause
  implies (R7). Conformance is monotone, so skipping the edge is sound, and
  it is what lets `type list<integer> is FloorRing { … }` follow an existing
  `type list<T> is PartialOrder where T is PartialOrder`, or `type list<T> is
  FloorRing where T is FloorRing { … }` follow `type list<any> is
  PartialOrder { compare }`, without the one-per-head refusal of
  `headConflictOf`. A NON-EMPTY part for such a protocol registers an edge
  for `T` with the part, as the hand-written statement does (review 2.1): a
  subtype's own, more specific implementation is allowed by Appendix A
  ("Lattice inheritance and overlap"), and `overlapConflict` admits
  comparable targets. The only refusal is R7's: a non-empty part under a
  conditional edge with the same head and a different clause.
- (c) An ancestor whose part is EMPTY and that `T` does not already conform
  to gets a BLOCK-LESS edge (`type T is Pk`), not an empty block: an empty
  block claims the edge and refuses inheritance, while the block-less edge is
  settled by the existing rules (R5), and no `_implOrigin` stamp (review
  2.8): the duplicate check of `declareConformance` reads that stamp, and a
  block-less edge must stay fillable by a later `type T is Pk { … }` in the
  same batch.
- (d) An edge that receives a NON-EMPTY part is stamped `_implOrigin = {
  batch, block }` with the WHOLE statement block (review 1.13), and the
  same-block no-op of `declareConformance` (one statement registers up to
  three times per batch) is tested for each protocol of the closure, not for
  `records[0]` only.
- (e) The `_via` stamp (reviews 1.4, 2.4, 2.5). Every statement WITH A BLOCK
  that installs a part on an edge (creates it, fills a pending one, or
  replaces an authored one) sets the edge's `_via` to its statement
  protocol; a statement whose statement protocol is the edge's own protocol
  (`type Money is PartialOrder { compare }`) deletes `_via`; a block-less
  statement never sets or clears it; the rollback point restores it with the
  other edge fields. A later statement with a block, for the same target and
  the same statement protocol `Q`, REPLACES every AUTHORED edge stamped
  `_via: Q` with its new part, empty or not: an empty replacement part is an
  EMPTY block, so a member the edited cell dropped is
  `protocol-implementation-missing`, as it is today for a single-protocol
  re-run. A stamped edge that is not authored (block-less, whether still
  pending or settled by inheritance in between) is classified again by (b)
  and (c) and stays block-less, so an unchanged cell re-run is accepted. An
  edge with no stamp, or with another statement protocol's stamp, is
  coverage under (b), never a replacement target. A user who moves `compare`
  from the `FloorRing` block into its own `type Money is PartialOrder {
  compare }` statement in the same edited program writes that statement
  first: it clears the stamp, and the `FloorRing` statement then reads the
  edge as coverage.

R3 makes the split well defined: every member name of the block belongs to
at most one protocol of the closure. A member that no protocol of the
closure declares is `protocol-member-unknown`, with the usual spelling
suggestion over the whole closure.

**R5. Completeness and settlement.** Each protocol of the closure is, after
the split, in one of these states:

1. already conformed to, empty part (R4(b)): nothing registered;
2. its part is non-empty: the part is validated by `implementationProblem`
   as today (signatures, properties, field-backed properties, the mutability
   gate), and the edge is registered with the part as its authored block, or
   fills or replaces an existing edge with the same `targetKey` (R6);
3. its part is empty and no edge for the ancestor exists: a block-less edge
   is registered and settled at once by the existing rules (review 1.5):
   `settleFieldBacking` (a stored field of an object target satisfies a
   property requirement) and the marker rule (a protocol with no
   requirements is never pending). Inheritance from a supertype cannot
   settle it at this point, because (b) already classified that case as
   state 1 (review 2.12); a state-3 edge left pending is settled later by
   `refreshInheritedPending` when a supertype edge is filled, as any
   block-less edge is today;
4. its part is empty and a PENDING edge for the ancestor exists (review
   2.10): the same `targetKey`, or a conditional edge with the same head
   whose clause the new clause implies (R7). Nothing is registered, and the
   edge stays pending with its own P3 warning: the author declared that
   conformance ahead of its implementation, and this statement does not
   take it over.

When the statement carries a block, a protocol left PENDING by state 3 is
`protocol-implementation-missing`, the message names the ancestor and the
statement protocol ("the `PartialOrder` protocol, which `FloorRing` extends,
expects a definition of `compare`"), and the whole statement is refused
(nothing registered, rollback point). When the statement carries no block
(`type T is FloorRing`), the edges of state 3 stay, and the ones still
pending after settlement get the ordinary end-of-batch
`protocol-implementation-pending` warning, one per protocol (ruling P3).

**R6. Duplicates and replacement.** A member of the block whose declaring
ancestor already has an AUTHORED edge for the same `targetKey` follows the
rule of that ancestor's block today: a second block in the same batch is
`protocol-implementation-duplicate`, a later batch replaces, and the host
route throws (rulings P5 and P47). A pending or block-less edge is filled by
the part, as today. Examples (review 1.1):

- The reporter's code of §1, parents first, keeps working unchanged after
  `LinearOrder` extends `PartialOrder`: the second line's part for
  `PartialOrder` is empty and `Money` already conforms (R4(b)), so the line
  registers the `LinearOrder` edge only. The hand-written ancestor lines are
  then redundant, not wrong.
- Line 1 followed by `ce.declareProtocolImplementation("Money", "FloorRing",
  { functions: { compare, floor, … } })` throws
  `protocol-implementation-duplicate` for `compare`: the `PartialOrder` edge
  of `Money` is authored. The migration is to move the ancestors' members
  into the one `FloorRing` call and delete the ancestor calls.

**R7. Conditional conformance.** `type list<T> is Q where T is Q { … }`
expands like R4, and every derived edge carries the same `where` clause. The
one-conditional-per-(head, protocol) rule of `headConflictOf` applies to
each derived edge, and an ancestor that already has a conditional edge with
the same head is handled by R4(b): the target already conforms when the
existing clause is IMPLIED by the new one. Implied means (reviews 1.11,
2.2): the two head patterns are the same head (identical up to a renaming
of variables, which fixes the correspondence of the variables; a different
structure, `list<T>` against `list<list<U>>`, or `tuple<T, T>` against
`tuple<T, U>`, is not an implication, and `headConflictOf` decides); for each
pair of corresponding variables, the bound (`T: number`, the type after the
colon) is the same type, and every protocol of the existing clause's `is`
list is in the closure of the new clause's `is` list. The implication is
sound as long as the closures only grow, which R9 guarantees (review 1.3).
The part of the block for an ancestor covered this way must be EMPTY
(review 1.6): a non-empty part needs an existing edge with the same
`targetKey` (identical clause, then R6 applies); otherwise the statement is
`protocol-conformance-overlap`, with the message "`list<T> where T is
PartialOrder` already conforms to `PartialOrder`; its implementation of
`compare` cannot be replaced from a conformance to `FloorRing` under the
narrower clause `T is FloorRing`".

Order (review 2.11). `list<T> is FloorRing where T is FloorRing` declared
alone derives `list<T> is PartialOrder where T is FloorRing`, block-less and
stamped `_via: FloorRing`. A later, wider `list<T> is PartialOrder where T is
PartialOrder` REPLACES that derived edge when the derived edge is not
authored and the derived clause implies the new one (the same test, in the
other direction): the edge takes the wider clause and the new block, and
loses its stamp. The §2 invariant holds, because the wider clause admits
every argument the narrower one did. When the derived edge IS authored (a
non-empty part under the narrower clause), the later statement is
`protocol-conformance-overlap`, and its message says that the wider
conformance must be declared before the one to `FloorRing`, in a new engine
if the program already ran. So the pair can be declared in either order, as
long as the narrower statement does not implement the ancestor's members
itself.

**R8. Sum types.** `type shape is Q { … }` for a sum type desugars to one
edge per variant (user ruling 2026-09-22). `declareSumConformance` receives
the names as the author wrote them, and each per-variant `declareConformance`
call does the expansion of R4 (review 2.6), so the split check and the
expansion run once per variant. The whole-sum record (`_sumConformances`) is
written on the written names only; when the sum gains a variant,
`refreshSumConformances` re-applies the block through the expansion, which
reads the closure as it stands at that time (an ancestor added later by R9
is covered), and it deletes `_implOrigin` on EVERY edge the expansion
registers, as it does today on the one edge of the written protocol, so a
cell that grows the sum and states its conformance again is not a
duplicate.

**R9. Protocol replacement: the closure only grows.** Re-running a
`protocol` statement replaces the record (members and `extends`) and
revalidates its edges, as today. A replacement whose closure LACKS a
protocol of the previous closure is refused (`protocol-extends-removal`:
"`LinearOrder` extended `PartialOrder`; an extension cannot be removed. Start
a new engine to drop it"), the same monotonicity as conformance (Appendix A,
"Conformance": added, never removed). This is what keeps the implication of
R7 true for types declared later (review 1.3). The host route
(`ce.declareProtocol`) does not replace, as today.

For each ancestor the replacement ADDS, where added means closure(new)
minus closure(old) (review 1.2), every edge of the replaced protocol `Q` is
walked, conditional edges and the per-variant edges of a sum included, and
its target gets, on the added ancestor: nothing, when it already conforms
(R4(b), with the tests for a ground and for a conditional target); nothing,
when a pending edge of R5 state 4 exists; otherwise a derived edge with the
same target and clause, block-less, settled as R5 state 3, stamped `_via:
Q`, with the pending reason "`T` conforms to `Q`, which now extends `P`".
Each derived edge goes through the same pre-pass as R4(a) (review 2.7):
`conformanceTargetProblem`, `headConflictOf` and `overlapConflict` refuse
the whole replacement with `protocol-conformance-overlap`; the mutability
gate (an object-only ancestor, a value-type conformer of `Q`) does not
refuse but leaves the derived edge pending with that reason, as a
replacement that makes a protocol object-only does today; the widening check
runs once after the walk, and a violation refuses the replacement with
`conformance-widens-declared-contract`. A refusal throws from
`declareProtocolImpl` after `restore()` and `syncProtocolDispatchers`, the
route the widening refusal takes today. The rollback point of the registry
snapshots `extends` with the other record fields, and `_via` with the other
edge fields.

**R10. Qualified names.** `P.m` names only a member that `P` declares.
`FloorRing.compare` is `protocol-member-unknown` with the hint "`compare` is
a member of `PartialOrder`, which `FloorRing` extends; write
`PartialOrder.compare`". The same for the dot form `x.(FloorRing.compare)`
and for property qualification. Reason: the value of `P.m` "dispatches inside
`P` only" (its edges), and an inherited member would need the edges of the
ancestor restricted to the conformers of `P`, which no reader of the registry
computes today. Resolving an inherited member through the ancestors is a
later extension, not asked.

## 4. What does not change

- `ce.conformsTo(T, P)` and the `where T is P` oracle: a flat scan of the
  edges of `P`, unchanged, because the derived edges are on `P`'s record.
- Dispatch (`protocolsWithMember`, `candidateRecords`, `bestCandidates`,
  `dispatchMember`, `selfBindingTarget`): keyed on the protocol that DECLARES
  the member, whose record holds the derived edge. `Self` binds to the edge's
  target as today.
- The compiled planner (`planProtocolDispatch`) and the static resolution:
  they read edges and their implementation literals.
- Inheritance by subtype, the pending model, the effect contracts and the
  widening check, the field-backed properties, the mutability gate.
- The introspection of the registry: no new public reader. (A public
  `ce.protocolExtends(name)` is not asked; add on request.)
- CE-51 (review 1.17): when CE-51 makes `Indexable` extend `Iterable`, the
  sentence "`Indexable` alone grants no membership" of Appendix A ("Built-in
  protocols") is removed, because a conformance to `Indexable` alone can
  then not exist; `indexed_collection is Indexable` is enough. CE-51's
  design document records that change; this spec only makes it possible.
  CE-51 was closed on 2026-11-06 (user decision): the engine declares no
  `Iterable` or `Indexable` protocol, so this change does not happen. The
  reason is at the end of §4 of `docs/TYPE_SYSTEM_ROADMAP.md`.

## 5. Cost

Estimates, not measurements (review 1.12). The reporter's numbers (§1) are
for their own implementation of the same shape on top of the public API.

- Declaration: one statement registers the closure's edges. What was paid
  once per hand-written call is paid once per statement: the registry
  rollback point, `conformanceWideningViolations`, the state events
  (`_noteStateEvent`, `_noteConformanceRegistryChange`), and the
  `refreshInheritedPending` loop, which runs per protocol of the closure but
  once per statement. The block is validated once per protocol of the
  closure, on its own part, so the validation cost is the same as the n+1
  calls. Target to accept the implementation: declaring a type at depth 8
  (closure of 9 marker-free protocols, one member each) in one statement
  costs at most 2× one single-protocol declaration with the same 9 members,
  measured by a script `docs/scratch/2026-10-31-protocol-extends-bench.mts`
  written with the implementation (median of 7 runs, as the reporter did).
- `conformsTo`: unchanged.
- Dispatch: unchanged.
- Memory: one edge per (type, protocol of the closure), the same as the
  hand-written form, minus the protocols the type already conformed to.

## 6. Diagnostics

New codes: `protocol-extends-cycle`, `protocol-extends-removal`,
`protocol-member-inherited`, `protocol-extends-member-conflict` (at a fresh
declaration, at a conformance statement during a batch, and at the end of a
batch after a replacement). Reused with a message that names the statement
protocol (review 1.16): `protocol-unknown` (a parent, or a type in the
parent list), `invalid-protocol-declaration` (a repeated parent, a malformed
host option), `protocol-member-unknown`, `protocol-implementation-missing`,
`protocol-implementation-duplicate`, `protocol-conformance-overlap`,
`protocol-implementation-pending`, `protocol-requires-object` (an ancestor
that only object types may conform to, `mutabilityGateProblem`),
`conformance-widens-declared-contract`,
`protocol-conformance-target-invalid`.

## 7. Files

- `src/compute-engine/types-engine.ts`: `extends: string[]` on
  `ProtocolRecord`; `_via?: string` on `ConformanceRecord`; the `extends`
  option of `declareProtocol`; the batch-end list of descendant conflicts
  (R3), next to the pending-conformance warning list.
- `src/compute-engine/engine-protocols.ts`: `protocolClosure(ce, name)`
  (the order of §3 "Vocabulary"); `sameHead(a, b)` (identical up to
  renaming) and `clauseImplies(existing, new)` (R7); R1 validation, R2 and
  R3 in `declareProtocolImpl` (fresh and replacement, plus the R9 steps);
  the expansion, split, coverage and settlement (R4–R7) in
  `declareConformance` after the `protocol-implementation-split` check on
  the written names, called per variant by `declareSumConformance` (R8);
  `declareProtocolImplementationImpl` (host route) goes through the same
  expansion; R10 hints in `qualifiedMemberRequirementShape`,
  `protocolMemberValue`, `canonicalProtocolMember` and the property readers.
- `src/compute-engine/index.ts`: the `extends` field in
  `_protocolRegistryRollbackPoint` (and `_via` with the other edge fields);
  the public `declareProtocol` signature; the batch-end report of R3 where
  the pending warnings are emitted.
- `src/compute-engine/library/core.ts`: `declareProtocolStatement` reads the
  parent list operand; the `DeclareProtocol` signature gains it.
- `src/epsil/parser.ts`: the `extends` tail of `parseProtocolStatement`;
  `src/epsil/serialize-epsil.ts`: print it; `src/epsil/static-diagnostics.ts`:
  nothing (the pre-pass registers through the canonical handler).
- Docs: `docs/TYPE_SYSTEM_ROADMAP.md` Appendix A (grammar, an "Extension"
  subsection after "Conformance"), `src/epsil/docs/protocols.md` (an
  "Extending a protocol" section and the diagnostics list),
  `src/epsil/docs/literals.md` if the reserved-word table lists soft
  keywords, `src/api.md` (generated by typedoc from the doc comment),
  `CHANGELOG.md`.
- Tests, new file `test/compute-engine/protocol-extends.test.ts`: host API
  and Epsil for the reporter's hierarchy (depth 2, a diamond, a marker
  ancestor); each diagnostic of §6; R1 parent-list validation; the closure
  order of a diamond in a message; R3 the member move (`P` first, then `Q`)
  on a new engine and as a re-run, and the batch-end conflict when `Q` is
  not re-declared; R4(b) an ancestor already conformed to directly, through
  a supertype, through a conditional edge, and a conditional target covered
  by `list<any>`; R4(b) a non-empty part that specializes a supertype's
  implementation; R4(c) a block-less derived edge filled in the same batch;
  R4(e) a later-batch re-run that drops an inherited member, an unchanged
  re-run after the derived edge was settled by inheritance, the three stamp
  cases of review 2.4, and a block-less re-declaration that changes nothing;
  R5 state 3 for a marker, a field-backed property, a genuinely missing
  member, and state 4 for a forward-declared ancestor; R6 the two examples;
  R7 implied and non-implied clauses, heads that differ in structure, and
  both declaration orders of the wider and the narrower conditional
  conformance; R8 a sum that gains a variant after R9 added an ancestor, and
  a grown sum whose conformance is restated in the same batch; R9 a
  replacement that adds a parent (plain, conditional and sum conformers,
  a target covered by a supertype), one that removes a parent, one refused
  by `headConflictOf`, one by `overlapConflict` (`integer<1..10>` against
  `integer<5..20>`), one with an object-only ancestor (pending, not
  refused), each refusal with the registry unchanged after it; R10 the hint;
  a compiled dispatch (`protocol-dispatch-compile.test.ts` style) through a
  derived edge; a `where T is FloorRing` constraint; a serialization round
  trip with and without parents.

## 8. Decisions

All decided by the user 2026-10-31, each as recommended: 2 refuse, 3
batch-end report, 4 no removal, 5 own-member only, 6 the repo implements.
The options are kept for the record.

1. **Spelling: DECIDED 2026-10-31**, `protocol A extends B, C { … }`, host
   option `{ extends: [...] }`.
2. **R3, member names unique in a closure**: refuse (recommended, v1) or
   allow a redeclaration as a second requirement that one implementation
   satisfies. Allowing it means a dispatcher change that merges requirements,
   about twice the work.
3. **R3 at replacement, batch-end report** (new in revision 3): report a
   conflict with a descendant at the end of the batch (recommended; the
   natural program order converges in one run) or refuse at the statement
   (simpler to implement, but a member move then needs a new engine).
4. **R9, the closure only grows**: refuse the removal of a parent by
   replacement (recommended; the same monotonicity as conformance, and it
   is what keeps R7 sound). The alternative keeps R7 sound by recording, on
   each derived conditional edge, the witness it reused and refusing only a
   replacement that breaks one, at the cost of that bookkeeping.
5. **R10, qualified names stay own-member only**: recommended. Resolving
   `FloorRing.compare` through the ancestors is a later extension.
6. **Who implements, and what is posted** (review 1.7): the reporter offered
   a PR. The change touches the registry invariants (rollback, replacement,
   sums, field-backed properties, effect contracts) that only
   `engine-protocols.ts` documents, so an external PR needs this spec as its
   contract and the full dual review. Nothing is posted to the issue until
   the user approves the spec and writes or approves the comment; if nothing
   is decided, nothing is posted and the issue stays open with this draft.

## 9. Implementation notes (step 1, engine side, 2026-10-31)

Where the code differs from the rules above, the code is the behavior and
the rule is read with these amendments:

- **R3 at a replacement.** A recorded descendant conflict is reported at the
  end of EVERY later batch until it is resolved, like a pending conformance.
  The record is not in the registry rollback point: each name is checked
  again at the end of each batch, so a name the static pre-pass left behind
  is dropped. A replacement made outside a batch (the box route) is reported
  by the next batch. A conformance statement to a descendant whose closure
  has a member conflict is refused whether or not it carries a block.
- **R4(d).** An empty part that replaces an authored edge stamped `_via: Q`
  also receives the `_implOrigin` stamp: the same-block no-op and the
  same-batch duplicate rule read it.
- **R7, wider replacement.** It applies only to a block-less edge that an
  expansion derived (flagged `_derived`). A hand-written narrower block-less
  conditional edge keeps the one-per-head refusal of `headConflictOf`. The
  replacement removes the old edge object and pushes a new one, which the
  rollback point restores.
- **R4(a) pre-pass of an ancestor.** `conformanceTargetProblem` runs once,
  against the written names: the verdict does not depend on the protocol.
- **R10.** The hint is produced where the qualified call or property is
  EVALUATED (`protocolMemberValue`, `evaluateProtocolMember`,
  `evaluateProtocolPropertyOperator`, `protocolNamedPropertyRefusal`);
  `qualifiedMemberRequirementShape` and `canonicalProtocolMember` keep
  returning `null` or an inert expression for an inherited member.
- **Host route.** The `headConflictOf` and `overlapConflict` checks run in
  the shared `registerConformance` after the member map is built, so an
  invalid callback is reported before an overlap; the host duplicate check
  stays before the map is built.
- **R9.** An edge the walk derives copies `declaredByStatement` from the
  source edge.
- The engine-side entry point shared by the statement route and the host
  route is `registerConformance` (expansion, split, coverage, settlement,
  duplicates, `_via`, the R5 refusal). The batch-end report of R3 is in
  `src/epsil/execute-epsil.ts`, next to the pending warnings.
- **R3, the transient state after a replacement** (step 2 probe). The rule
  says a call of the shared member on a conformer of the descendant is
  `protocol-call-ambiguous` between the replacement and the end of the
  batch. It is not, in the common case: the edge the walk derives on the
  parent is pending, so only the descendant's implementation applies and
  the call is served. The ambiguity arises only when the conformer holds an
  authored implementation on both protocols. The batch-end report is the
  diagnostic of the transient state.
- **Moving a member up the hierarchy** leaves the earlier conformers of the
  descendant pending until their conformance statement is run again (the
  parent now expects the member, and the descendant no longer declares it):
  the ordinary revalidation of a replacement, not a defect.
- **Measured** (step 2, `docs/scratch/2026-10-31-protocol-extends-bench.mts`,
  medians of 7 runs, three script runs): a depth-8 chain declared in one
  call 190–200 µs; nine protocols in nine calls 532–572 µs; one flat
  protocol with the same nine members 122–142 µs. Ratio chain / flat 1.34 to
  1.58, under the §5 target of 2. `conformsTo` on the root and on the leaf
  of the chain: 0.16 µs each.
- **R7, `_derived`** (code review 2026-10-31): the wider replacement reads a
  `_derived` flag that every ancestor edge the expansion creates carries,
  with or without a block, not the `_via` stamp.
- **`_derived` lifecycle** (code review round 2, 2026-10-31): the flag is set
  on every edge the expansion or the replacement walk creates for an
  unwritten ancestor, and cleared when a written statement claims the edge
  (fills it, or restates it block-less); the wider replacement of R7 reads
  this flag only.
