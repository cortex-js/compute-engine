# Write audit: what each fact-blind bracket encloses, and what it closes over

Companion artifact to
[`2026-08-29-assumptions-as-facts-type.md`](./2026-08-29-assumptions-as-facts-type.md)
§2.4 ("Bracketing the whole write ROUTINE") and §5 step 4. The memo half of the
same work is
[`2026-08-30-assumptions-memo-inventory.md`](./2026-08-30-assumptions-memo-inventory.md).

## Why this list exists

An assumption is a fact about the current state; a definition's type and
signature are contracts. A contract may be built only from other contracts, so
every routine that writes one runs its whole derive-and-write phase inside a
fact-blind bracket (`ce._withoutFacts`), where the assumption store and the
assumed-value overlay read as empty.

The bracket makes the write fact-free only if everything the write DEPENDS ON
is computed inside it. That is not machine-checkable: a thunk can perfectly
well return a `Type` that some earlier line computed while the facts were
visible. This document is the check. For each bracketed routine it records
where the bracket opens and closes, and every value the bracketed region uses
that was computed BEFORE the bracket opened, with one of three verdicts:

- **moved inside** — the computation now happens in the bracket, so there is
  nothing to argue about;
- **fact-free by construction** — the value cannot carry a fact, with the
  reason;
- **a value, not a type decision** — facts may legitimately shape it. Design
  §3 bounds the soundness claim to the TYPE channel given the stored value: a
  value shaped by a fact before the write stays as it is, and only the type
  derived from it is guaranteed fact-free.

A fourth verdict, **listed leak**, marks the few places where a decision made
outside the bracket selects the type that the bracket then writes. Those are
the known residue; each row says what would have to change to close it.

## 1. The routines

| Routine | Bracket opens | Bracket closes | Values crossing into it |
| --- | --- | --- | --- |
| `_BoxedValueDefinition` constructor (`boxed-expression/boxed-value-definition.ts`) | first statement of the body, which delegates to the private `_construct` | end of `_construct` | `def` — the declaration record the caller wrote. `def.type` is **fact-free by construction**: a written annotation, a type string or a `BoxedType`, never engine-derived. `def.value` is **a value, not a type decision**. The derivation that matters — `inferTypeFromValue`, the constant's `value.type`, the placeholder refinement — happens inside |
| `_BoxedValueDefinition._setType(thunk)`, and the public `type` setter that delegates to it | entry to `_setType`, before the thunk is called | after `_writeType` returns | the thunk's own captures — one row per caller in §2. The public setter's `Type` argument is the audited case by definition: it is whatever the caller computed |
| `_BoxedValueDefinition._setElementRefinement(t)` | entry | exit | `t`, the refined type. **Moved inside** at both call sites in the sense that matters: `engine-declarations.ts` computes it inside its own bracket, and `epsil/static-diagnostics.ts` computes it inside the pre-pass bracket |
| `assignFn`'s value branch (`engine-declarations.ts`), factored into `deriveAndWriteAssignedType` | immediately after `assertAssignableValueDef` — the LIVE validation, which must see the facts, since a fact in force is a constraint the assigned value has to satisfy | before `ce._setSymbolValue(id, value)` | `valueDef` (a record identity) and `value`. `value` is **a value, not a type decision**. `adopted` — the variable the design names as its canonical example — is **moved inside**: `widen(current, vt)`, the D11 union test, the promotion ladder, the provenance scan and the strict-refinement test are all evaluated in the bracket, and `current` reads the DECLARED type because the effective type answers the declared one while the store reads empty |
| `BoxedSymbol.set value` (`boxed-expression/boxed-symbol.ts`), factored into `_writeValue` | immediately after `ce.forget(this._id)` | end of the setter | the caller's raw `value` argument (a number, a string, a MathJSON object, a boxed expression): **a value, not a type decision**. Its boxing and its `evaluate()` happen inside the bracket, so what this entry point stores is itself fact-free. `forget()` is deliberately OUTSIDE and first: retracting what was assumed about the symbol is a state mutation, and a fact mutation from inside a bracket throws |
| `BoxedSymbol.set type`, factored into `_writeType` | immediately after `ce.forget(this._id)` | end of the setter | `t`, the caller's type: **fact-free by construction** — a public setter's argument is a stated type, not an engine derivation. Everything that branches on it (the signature/value split, `updateDef`, the callable-arm classification) runs inside |
| `_BoxedOperatorDefinition._setSignature(thunk)`, and the per-instance `signature` accessor that delegates to it | entry to `_setSignature`, before the thunk is called | after `_signature` is written | the thunk's own captures — one row per caller in §2 |
| `_BoxedOperatorDefinition._update`'s lambda-signature derivation | the `_setSignature` call that replaces the old direct assignment | the end of that thunk | `boxedFn`, the function literal boxed with `form: 'raw'`: **fact-free by construction**, a syntax object with no type read taken. The body's result type and each parameter's inferred collection type are **moved inside** |
| `BoxedSymbol._infer`, factored into `_inferWithoutFacts` | after the two cheap declines (no definition, resolve-only region), before the thunk is called | end of the method | the thunk's result — §2. The incumbent read, the `narrow`/`widen`, the `unknown` no-op test and the same-type no-op test are all inside |
| `BoxedFunction._infer`, factored into `_inferWithoutFacts` | after the two cheap declines, before the thunk is called | end of the method | `def`, the operator definition — a binding lookup, **fact-free by construction** (no type is read to obtain it). The incumbent signature read and the result narrow/widen are inside |
| The Epsil static pre-pass (`epsil/static-diagnostics.ts`) | the `ce._factSuppressionDepth += 1` next to `ce._staticTypeCheckDepth += 1` | the matching decrement in the same `finally` | the AST and the source text: **fact-free by construction**. Every sink the pass writes through — `_infer`, `_setElementRefinement`, the assignment-evidence map — is inside |

`BoxedValueDefinition._setElementRefinement`, `_setType` and
`_BoxedOperatorDefinition._setSignature` are re-entrant with the brackets above
them; the depth is a counter, so a nested write inside an outer one costs one
increment and changes nothing.

**Not bracketed, deliberately.** `receiverType` (`engine-protocols.ts`) and
`solveArm` (`generic-instantiation.ts`) are dispatch READS. Reached from a live
read they see the effective type, as they always have; reached from inside a
bracketed write they inherit the hiding, which is what the design wants, since
their answer feeds a stored type. Giving them a bracket of their own would
wrongly hide the facts from an ordinary read.

## 2. `_infer` call sites: what each thunk closes over

`_infer` takes a thunk so that the type COMPUTATION lands inside the bracket
with the write. Where the argument was an inline expression it simply moved
there. Where a guard had to compute the type first in order to decide whether
to call at all, the thunk closes over that variable, and the row says so.

| Site | Thunk | Verdict |
| --- | --- | --- |
| `library/control-structures.ts` (the iterated collection), `library/collections.ts` (`Length`'s operand), `library/calculus.ts` (`Derivative`'s function and order), `boxed-expression/invisible-operator.ts` ×4 | a bare type literal — `'collection'`, `'function'`, `'number'` | fact-free by construction: a constant |
| `boxed-expression/validate.ts`, the tuple-slot and collection-element distribution (`slot`, `element`) | a slot of the callee's SIGNATURE | fact-free by construction: a signature is a contract. A declared one was written by its author; an inferred one was written by `_infer`, which is itself fact-blind |
| `boxed-expression/validate.ts`, the evidence-guarded narrow (`param`) and the final parameter pass (`t`, from `inferenceTypeAt`) | a parameter type of the callee's signature | fact-free by construction, same reason |
| `boxed-expression/box.ts`, the collection-parameter narrow (`paramType`) | `sig.args[i].type` | fact-free by construction, same reason |
| `epsil/static-diagnostics.ts` ×4 (`widenAssignedType(ce, leafType)`, `inferTypeFromValue(ce, rhs).type`, `already`, `pinnedType`) | derived from the statement's right-hand side, or from a signature this same pass pinned earlier | moved inside — and the whole pass is bracketed anyway, so nothing here is computed with the facts visible |
| `library/sets.ts` (`Element`'s canonical handler) and `library/control-structures.ts` (the loop index), both narrowing to `elt` | `collectionElementType(<collection>.type.type)`, computed by the guard immediately above the call so that the call can be skipped when the element type is `unknown`/`any` | **closed.** `<collection>.type` is an EFFECTIVE type read, so an assumption that narrows the collection symbol chose the element type the thunk returned. The guard and the call are now inside one bracket at each site. Witness: with `declare q real; assume(q > 3)`, the parameter of `u ↦ (u ∈ [q, q])` stored `real<3<..>` and now stores `real` |
| `boxed-expression/validate.ts`, the scalar numeric context (`inferredType`, three sites) | `'real'`, or `'number'` when `couldBeNonRealNumber(x.type.type)` holds for some operand | **closed.** The choice reads each operand's EFFECTIVE type, so a fact that narrows one operand out of the complex tier flipped the constant inferred onto the others. The operand scan and the inference loop are now inside one bracket, in the strict pass and the non-strict fast path alike. Witness: with `declare c number; assume(c > 0)`, `Multiply(c, [g1, g2])` stored `real` on `g1`/`g2` and now stores `number` |
| `library/collections.ts` (`Length`'s target), `library/calculus.ts` (`Derivative`'s symbolic order), `library/control-structures.ts` (the iterated collection), `boxed-expression/box.ts` (`narrowArgsFromInferredSignature`), `boxed-expression/validate.ts` (the final parameter pass) | a bare type literal, or a slot of the callee's signature — the THUNK was already fact-free | **closed.** Same shape as the two rows above, found by a sweep after they were fixed: the guard reads the operand's EFFECTIVE type to decide WHETHER to record the use as evidence, so an assumption that gives the operand a tier suppressed a narrowing that outlives the assumption. Witness for `Length`: with `assume(tgt ∈ Integers)` then `forget(tgt)`, `Length(tgt)` left `tgt` at `unknown` where a fact-free engine stores `collection`. Each is now one bracket around the guard and the call |

Every leak of this shape shares one cause: a guard reads a type to decide
WHETHER to write, and the thunk can only carry the value the guard already
computed. The fix is a bracket around the guard and the call together, which is
what the design means by "the bracket encloses the DECISION and the WRITE".

## 3. A window that hides nothing

Brackets are now ordinary: every assignment, every declaration with a value,
every `_infer` opens one, on every engine, whether or not anything is assumed.
That made one property load-bearing which had been merely economical.
`ce._factsHidden()` — the predicate every suppression-keyed memo asks — is true
only when the depth is above zero AND the current context actually holds an
assumption or an assumed value. With an empty store the accessors answer the
same on both sides, so the bracket changes nothing observable and must not
split a memo entry in two.

Splitting it anyway was measured to do real damage. A node whose type is first
read by a WRITE has its answer stored on the hidden side; the live side stays
cold; and a later live read of a node that has meanwhile become
self-referential has no previous value to terminate on, because that is exactly
how the cache breaks such a recursion. It overflowed the host stack
(`test/compute-engine/compile-fold-shared-values.test.ts`, "a value that refers
to its own symbol fails closed on both routes"). A second, quieter symptom: a
cold hidden cell recomputes where the live cell would have hit, so a derivation
whose live entry was stale within its generation silently changed answer.

## 4. What is still not guaranteed

The bracket is an API shape and this document is its audit; neither is a proof.
Three residues are known and accepted:

- An argument that a fact contradicts is still admitted, and its inferred
  contract can be empty while the fact holds. The admission decision for a
  use-driven narrowing runs fact-blind (the `evidenceGuardedNarrow` gates in
  `validate.ts`), so with `declare hh (list<integer>) -> integer` and
  `assume(zz ∈ Integers)`, boxing `hh(zz)` records the same evidence a
  fact-free engine records: `zz`'s stored contract becomes `list<integer>`,
  identical to the twin without the assumption, and that is the property the
  bracket exists to give. The cost is visible only while the fact is in
  force: `zz`'s effective type reads `never` — the truthful intersection of
  the two contradictory claims the user made about `zz` — and no diagnostic
  points at the call. `forget(zz)` heals the read to `list<integer>`. An
  earlier revision of this document described the opposite behavior (a live
  `incompatible-type` refusal that recorded no evidence); that was measured
  before the review pass bracketed these gates, and it no longer holds. If a
  diagnostic at the call site is wanted, it has to be a separate LIVE
  consistency check layered after the fact-blind write — the same two-phase
  shape assignment uses — not a return to deciding the write on live facts.
- A routine OUTSIDE this inventory can still write a type through the public
  accessors. The accessors bracket the write itself, so what such a routine
  stores is written fact-blind, but a decision it made beforehand is not
  covered by anything here.
- A stored VALUE that a fact shaped before it reached a write
  (`assume(x > 0); g := simplify(√(x²))` stores `x` where a fact-free engine
  stores `|x|`) stays as it is. Only the type derived from that value is
  fact-free. Design §7 records this as out of scope.
