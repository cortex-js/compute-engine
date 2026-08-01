# Library `type:` handler audit — D4 migration candidates

Date: 2026-08-01. Companion to
`docs/plans/2026-08-01-type-variables-design.md` (§7.3, D4).
Method: four parallel reviewers covered every `type:` site in
`src/compute-engine/library/` (281 sites across 15 files); every
**candidate** verdict below was then re-verified against source by hand
(handler body + `signature:` + `lazy`/`broadcastable` flags). Classes:
**A** constant (no generics needed) · **B** migratable with plain
`forall` · **C** migratable with a ground-bounded variable · **D**
blocked (specific blocker recorded).

## Headline counts

| File | A | B | C | D | total |
| --- | --- | --- | --- | --- | --- |
| collections.ts | 3 | 16 | 1 | 35 | 55 |
| arithmetic.ts | 16 | 0 | 4 | 45 | 65 |
| core.ts | 2 | 2 | 1 | 23 | 28 |
| control-structures.ts | 0 | 0 | 0 | 7 | 7 |
| number-theory.ts | 30 | 0 | 0 | 1 | 31 |
| trigonometry.ts | 4 | 0 | 0 | 12 | 16 |
| special-functions.ts | 4 | 0 | 0 | 10 | 14 |
| combinatorics.ts | 4 | 0 | 0 | 3 | 7 |
| complex.ts | 0 | 0 | 1 | 3 | 4 |
| statistics.ts | 13 | 0 | 0 | 4 | 17 |
| linear-algebra.ts | 1 | 0 | 1 | 7 | 9 |
| calculus.ts | 0 | 0 | 0 | 3 | 3 |
| sets.ts / distributions.ts / relational-operator.ts | 21+ | 0 | 0 | 4 | 25 |
| **Total** | **~98** | **18** | **8** | **~157** | **281** |

(sets.ts's 19 `type:` sites are constant-symbol fields, not operator
handlers; relational operators are all `lazy: true`.)

## The 26 migration candidates (all hand-verified)

### B — plain `forall` (18)

| Operator | file:line | verified signature | caveat |
| --- | --- | --- | --- |
| Identity | core.ts:1097 | `forall T. (T) -> T` | — (current sig is `(any) -> unknown`; pure echo) |
| Prime | core.ts:3228 | `forall T. (T, integer?) -> T` | undefined-fallback branch dead under valid calls |
| KeyValuePair | collections.ts:1323 | `forall T. (string, T) -> tuple<string, T>` | — |
| Single | collections.ts:1381 | `forall T. (T) -> tuple<T>` | — |
| Pair | collections.ts:1393 | `forall T, U. (T, U) -> tuple<T, U>` | — |
| Triple | collections.ts:1406 | `forall T, U, V. (T, U, V) -> tuple<T, U, V>` | — |
| Take | collections.ts:3664 | `forall T. (indexed_collection<T>, number) -> list<T>` | dimensioned-list decomposition rule (below) |
| Drop | collections.ts:3748 | same shape as Take | same |
| Slice | collections.ts:4021 | `forall T. (indexed_collection<T>, number, number) -> list<T>` | same |
| DeleteAt | collections.ts:4257 | `forall T. (indexed_collection<T>, integer) -> list<T>` | same |
| Insert | collections.ts:4149 | `forall T. (indexed_collection<T>, integer, T) -> list<T>` | **repeated-variable form** — handler computes `widen(elt, value)`, and the solver's repeated-variable join IS `widen`; do NOT use `list<T\|U>` (never collapses; not equivalent) |
| ReplaceAt | collections.ts:4348 | same repeated-variable form as Insert | same |
| Sort | collections.ts:4736 | `forall T. (indexed_collection<T>, order: ((T, T) any -> number)?) -> list<T>` | **plain, NOT identity** — result always rebuilds as `List` (in-source comment); do not use a bounded echo |
| Unique | collections.ts:5121 | `forall T. (collection<T>) -> list<T>` | plain, NOT identity (same reason) |
| RandomShuffle | collections.ts:4900 | `forall T. (indexed_collection<T>) random -> list<T>` | plain, NOT identity; keeps `random` effect |
| Tally | collections.ts:5097 | `forall T. (collection<T>) -> tuple<list<T>, list<integer>>` | has a `t === 'string'` branch — show dead on the canonical route, or keep a string overload arm |
| Partition | collections.ts:5266 | `forall T. (collection<T>, integer \| ((T) any -> boolean), integer?) -> list<list<T>>` | `T` under the param union is the *non-generic* arm's shape; confirm the fragment rule reads it as a function-typed alternative, else split into an overload pair |
| ChunkBy | collections.ts:5403 | `forall T. (collection<T>, key: (T) any -> any) -> list<list<T>>` | — |

### C — bounded identity echo (8)

| Operator | file:line | verified signature | caveat |
| --- | --- | --- | --- |
| Reverse | collections.ts:4084 | `forall T: indexed_collection. (T) -> T` | the ONLY identity-preserving collections handler (kind + dims verbatim) |
| Conjugate | complex.ts:187 | `forall T: number. (T) -> T` | `broadcastable: true` — governed by the spec's D10 lifted-echo rule (bind full actual, admit at base) |
| Inverse | linear-algebra.ts:436 | `forall T: matrix. (T) -> T` | — |
| Chop | arithmetic.ts:485 | `forall T: number. (T) -> T` | `broadcastable: true` |
| Negate | arithmetic.ts:1861 | `forall T: value. (T) -> T` | `broadcastable: true`; echo is broadcast-correct since `value ⊇ collection`; `missingBehavior: 'propagate'` must survive migration |
| PlusMinus | arithmetic.ts:1972 | `forall T: value, U: value. (T, U) -> tuple<T, U>` | — |
| Remainder | arithmetic.ts:2350 | `forall T: number. (T, T) -> T` | handler is raw `widen(a, b)`; the solver's `joinBounds` deliberately differs on a non-inferable `unknown` operand (absorbs instead of discarding) — migration *tightens* that edge per the spec's own §4.3 ruling; accepted delta, test it |
| BaseForm | core.ts:3036 | `forall T: number. (T, (string\|number)?) -> T` | **pre-existing defect**: declared signature says `-> string \| nothing` but handler + `evaluate` echo the operand — fix the declared result first, then migrate |

## Defects and adjacent findings (not generics candidates)

- **`Find` (collections.ts:4629) — latent type bug.** `type: (ops) =>
  ops[0].type` returns the *whole collection's* type, but `evaluate`
  returns a single element or `Nothing`. `Find([1,2,3], p)` statically
  claims `list<integer>`, evaluates to an integer. Correct typing is
  element-type `| nothing` — a union-position variable, out of the v1
  fragment — so the near-term fix is a handler correction
  (`collectionElementType(...) | nothing`), independent of generics.
- **`BaseForm` signature/handler contradiction** — see table above.
- **Lazy-only blocked, otherwise clean** (the §4.5 landmine ledger's
  concrete entries): `Dedup` (collections.ts:5144 — verbatim echo, the
  cleanest would-be C in the file), `Comprehension`
  (control-structures.ts:244 — clean covariant wrap, would-be B),
  `Filter`/`Reduce`/`Scan`/`Differences`/`TakeWhile`/`DropWhile`/
  `FlatMap`/`MaxBy`/`MinBy` (plausible generic shapes). If the lazy
  carve-out ever closes, re-audit these first.
- **Overload-set (no variables) cleanups, out of D4 scope**:
  `DigitCount` (number-theory.ts:678 — arity-conditional
  `finite_integer` vs `list`), `Trace` (linear-algebra.ts:612 —
  rank-conditional, expressible as a ground overload pair).
- **Assumption-coupled handlers are structurally unmigratable**:
  `Erf`/`Erfc`/`Erfi`/`ErfInv` branch on `isReal`/`isFinite`, which
  consult the assumption fact index — dispatch on *assumptions*, not
  types; no static signature can reproduce them.

## Dominant blockers (the ~157 D's)

1. **Value/pole/domain reasoning** (~70): `numericTypeHandler`,
   `elementaryFunctionType`, `gammaPoleType`, `logType`, literal
   `isSame(0/1)` pole checks, `isFinite`/`isNaN` tier collapses —
   arithmetic.ts and the trig/special families. Excluded by design
   (value-dependent + numeric-range reasoning).
2. **`lazy: true`** (~40): all of control-structures, relational
   operators, `Map`-class, core's held operators — the §4.5 lazy-idle
   carve-out.
3. **Type packs / positional / dimension arithmetic** (~20): `Tuple`,
   `PointList`, `First`/`Second`/`Third`/`Last`, `At`,
   `Transpose`/`Reshape`/`Norm`/`Vector`, `Block`.
4. **Structural/kind dispatch** (~15): `Join`/`Append`/`Values`/
   `ListFrom`/`SetFrom`/`Random`, `Abs`'s tuple arm, `GCD`/`LCM`,
   `Max`/`Min` aggregates.

## New spec obligation surfaced by the audit

`indexed_collection<T>` / `list<T>` patterns against a **dimensioned**
actual (`matrix<integer^(2x3)>`): the element-extraction rule must be
pinned to match `collectionElementType`'s existing behavior (what does
`T` bind to — the scalar dtype or the one-dimension-peeled row type?)
before the Take/Drop/Slice/DeleteAt conversions land. Added to the
spec's §4.3 as an explicit sub-rule requirement.
