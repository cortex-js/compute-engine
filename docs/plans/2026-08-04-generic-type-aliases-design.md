# Transparent generic type aliases — `type alias Pair<T> = tuple<T, T>`

Status: draft v2, 2026-08-04 — dual spec review applied (19 findings,
record in `docs/scratch/2026-08-04-generic-type-aliases-design_SPEC_REVIEW.md`).
A1/A2/A7 await ratification; the rest is derived from rulings and
precedent. Implements the generic-alias half of the type-variables
design's §9.2 scope
([`2026-08-01-type-variables-design.md`](./2026-08-01-type-variables-design.md)),
per its ruled v1 line: **transparent generic aliases IN** (eager
substitution — the alias body is a type-level lambda body), **recursive
generic aliases OUT**, **parameterized nominal types OUT**. Builds on the
base `type` statement (2026-08-01) and the generic-function-literals
milestone (M2's clause parsing is shared).

## 1. Scope

```
type alias Pair<T> = tuple<T, T>               // Cortex
type alias Keyed<T: value> = tuple<string, T>  // ground bound, checked at use
type alias Wrap<T> = list<Pair<T>>             // composition — see A7
let p: Pair<integer> = (1, 2)                  // applied anywhere a type is written
ce.declareType('Pair', 'tuple<T, T>', { alias: true, typeParams: ['T'] })  // host
```

- An applied reference `Pair<integer>` is **eagerly expanded at type
  resolution** into the substituted body. No applied-reference node
  exists in the `Type` representation; nothing downstream (subtype,
  widen, compile, `Type` serialization) ever meets one — zero
  unfold-site changes (recon-verified).
- **Open arguments are admitted by bound-vs-bound (A7)**: a generic
  alias may be applied to an in-scope type VARIABLE (an enclosing
  `forall` clause's variable in a signature, or the enclosing alias's
  parameter in a body): `forall T. (Keyed<T>) -> T` and
  `type alias Wrap<T> = list<Pair<T>>` both work. Admission: the
  argument variable's own declared bound (`any` when unbounded) must
  satisfy the alias parameter's bound — both sides ground, so the
  algebra never sees an open type. Substitution of a variable into the
  body is a pure rebuild; the enclosing clause keeps quantifying it.
  Consequences: an UNBOUNDED variable does not satisfy a BOUNDED alias
  parameter (`Keyed<T>` under bare `forall T.` → error naming both
  bounds); `type alias K<U: number> = Keyed<U>` with
  `Keyed<T: value>` is accepted (`number <: value`).
- **Bare use of a generic alias** (`let p: Pair`) is an arity error.
- **Direct self-reference is rejected** (the record's `def` is still
  `undefined` while its own body parses — unambiguous detection at the
  expansion site). **Mutual recursion is unreachable by construction**
  (review finding, simplifying v1): a stored alias `def` contains no
  generic references — they were eagerly expanded at declaration — so no
  later application can re-enter a definition graph. No guard, no test;
  a dependent alias **snapshots** its dependencies (A8).
- **Forward references to a generic alias are rejected**: a
  `type X<…>` spelling over a `forward()` placeholder has no
  arity/body to expand against (dedicated diagnostic; the placeholder
  carries no `typeParams`).
- **Generic NOMINAL types stay rejected**: only the `alias` form takes a
  clause; the bare form with a clause keeps a diagnostic (message
  updated to say parameterized *nominal* types are unsupported).
- **No constructor is minted, and no value-namespace claim is made** —
  following the existing mint-nothing precedent (record-body aliases
  already claim nothing). Explicit carve-out in
  `deriveConstructorSignature` (without it, the unmarked default builds
  an open signature and `BoxedType`'s closedness throw aborts the whole
  declaration); a plain-alias → generic-alias redeclaration still drops
  a previously minted constructor.
- **Unused alias parameters are a declaration-time error**: under
  transparency a phantom parameter is meaningless
  (`Tagged<integer> ≡ Tagged<string>` when `T` is unused) — consistent
  with the signature rule (`unsolvable-type-variable` class).

Out of scope: recursive generic aliases, parameterized nominal types,
variance, default type arguments, higher-kinded anything, re-expanding
dependents on redeclaration (A8 snapshots instead).

## 2. Decisions

- **A1 — MathJSON encoding (recommended: attrs entry).** The clause
  rides the attrs `Dictionary` as clause TEXT in the `<var_decl>`
  grammar: `["DeclareType", "Pair", "'tuple<T, T>'", <attrs: alias → True, typeParams → "T, U: number">]`.
  The canonical parser-emitted attrs form is the operator `Dictionary`;
  the serializer tolerates both valid encodings (operator form and
  `{dict: …}` shorthand), in any key order, and falls back to the
  generic-function spelling for malformed shapes — including
  `typeParams` WITHOUT `alias → True` (a shape well-formed lowering
  never produces). Alternatives rejected: a `forall`-prefixed type
  string relaxes `visitForallType`'s clause-only-on-signatures
  invariant; a 4th operand breaks the operator signature.
- **A2 — Host API (recommended: options field).**
  `ce.declareType(name, body, { alias: true, typeParams: ['T'] | [{name, bound?}] })`.
  `parseType`/`Parser` gain a `typeVars?: readonly TypeParameter[]`
  pre-seed — **names AND bounds** (review: the bounds feed A7's
  admission) — so the body's `T` parses as `kind: 'variable'`.
  **Cache rule (review, load-bearing):** a pre-seeded parse is
  UNCACHEABLE — `cacheable = resolver === undefined && typeVars ===
  undefined` — since identical text means different things under
  different seeds; order-independence pinned by test. Parameter names
  are checked against `isReservedTypeName`; duplicates rejected.
- **A7 — open-argument admission = bound-vs-bound** (§1; the review's
  main design hole, both reviewers). The check compares declared
  bounds, never variables — the ground-invariant tripwires
  (`assertGroundInputs`) are never approached. Positive and negative
  composition tests required (alias-in-alias and alias-in-forall-head).
- **A8 — dependent aliases snapshot (ruled by precedent).**
  `Wrap<T> = list<Pair<T>>` bakes Pair's body at Wrap's declaration;
  redeclaring `Pair` does not rewrite `Wrap`. This is the intended
  notebook semantics — the polymorphism design's staleness ruling has
  the notebook host re-execute the whole scope on edit, re-declaring
  `Wrap` in order. Documented with a test pinning the snapshot.
- **A4 — serialization asymmetry (disclosed, pinned)**: SOURCE keeps the
  applied spelling (raw text in the `{str}` node; Cortex round-trips
  `Pair<integer>` verbatim); the TYPE layer shows the expansion —
  `.type`, `typeToString`, error messages, `matches()`. That is what
  "transparent" means.
- **A5 — `_generation` bump on type replacement, claim scoped
  honestly** (review): the bump serves generation-keyed caches;
  already-boxed expressions keep their computed types (existing
  engine-wide redeclaration semantics — same as value redeclaration
  today). Test the newly-parsed-expression path; do NOT promise
  invalidation of constant-expression caches keyed on `undefined`
  generation.
- **A6 — recovery fixes, all four `parseTypeBody` call sites** (review
  widened the scope): the two STATEMENT-level callers
  (`parseTypeStatement`, `finishDeclaration`) get the single-recovery
  fix (hoist `recoverAtTopLevel` out of `parseTypeBody`; today the
  internal + caller double-recovery swallows the next statement, and
  tests carry sacrificial filler lines). The PATTERN-LIST and
  PARAMETER-LIST callers (`finishBindingPattern`, function-parameter
  and typed-lambda annotations) need LOCAL resync — advance to the next
  `,` or the closing bracket — because `recoverAtTopLevel` is the wrong
  unit there and corrupts the surrounding list today. Tests for a
  malformed applied alias in each context.

## 3. Mechanics

1. **Syntax**: `parseTypeReference` (common/type/parser.ts ~:1549) gains
   an optional `<…>` argument list (comma-separated `parseUnionType` to
   `>`), emitting `TypeReferenceNode.args`. No ambiguity with builtin
   heads (all claimed earlier). BNF blocks in parser.ts and types.ts
   updated. Closes the silent-truncation hazard (`parseTypePrefix` has
   no EOF check: `p: Pair<integer>` parses as bare `Pair` today and
   leaks `<integer>` to the Cortex expression grammar).
2. **Record**: `TypeReference.typeParams?: TypeParameter[]`, set by
   `declareType` alongside `alias`. Not on `Type`.
3. **Expansion** (`type-builder.ts` `visitTypeReference` ~:280): arity
   check → per-argument admission (ground argument: `isSubtype(arg,
   bound)` via a helper exported from `instantiate.ts` calling the
   injected algebra — a direct `type-builder → subtype` import is a
   3-node cycle; open argument: A7 bound-vs-bound) →
   `substituteTypeVariables(def, bindings)` with bindings built on
   `Object.create(null)` (the `__proto__` trap; pinned with
   `__proto__`/`toString` parameter-name tests on all routes). The
   Cortex resolver shim returns a bare string, not a record — the
   expansion code guards on object shape. Substitution never descends
   into `kind:'reference'` nodes (shared resolver records), which is
   fine: bodies contain no generic references post-declaration.
4. **Self/forward**: applied reference whose record has `typeParams` and
   `def === undefined` → self-reference error; applied `isForward`
   reference (or a `forward()` placeholder, which never has
   `typeParams`) → forward-reference error.
5. **Cortex statement**: `parseTypeStatement` swaps the `<`-slot
   rejection for the shared clause parser (below); the alias name stays
   seeded (bare self-mention → arity error); the body parse threads the
   clause as the `typeVars` pre-seed. The NOMINAL form with a clause
   keeps its diagnostic.
6. **Shared clause parser** (review: Cortex's `parseTypeParamClause` is
   private and stateful — cannot be called from `library/core.ts`):
   extract a pure clause-TEXT parser (input: `"T, U: number"`; output:
   `TypeParameter[]` or structured errors; full-consumption enforced)
   into the type layer; the Cortex method becomes a wrapper adding
   source ranges and the `>>`-munch handling; the A1 attrs value and
   the A2 host `typeParams` strings both go through it.
7. **`declareTypeStatement` (library/core.ts ~:544) is the box/parse
   route choke point** (review CRITICAL — it was missing from v1's
   list): it reads the attrs bag for BOTH the canonical and evaluate
   handlers and must read `typeParams`, parse it via the shared clause
   parser, and thread it into
   `ce.declareType(name, typeStr, { alias, fromStatement: true, typeParams })`.
   Box-route parity test required (the lazy-operator lesson).
8. **Serializer** (`serialize-cortex.ts` DeclareType handler ~:682): the
   attrs guard widens from exactly-one-entry to the allowed
   `{alias, typeParams}` key set (any order, both Dictionary
   encodings); emits `type alias Pair<T> = tuple<T, T>`; malformed
   shapes (incl. typeParams-sans-alias) fall back as today.
9. **Statement replace semantics** unchanged (`_declaredByStatement`);
   redeclaration replaces the record including `typeParams` (+ A5
   bump). Atomic rollback on EVERY failure path (clause parse, body
   parse, bound validation, unused-parameter check, mint-removal),
   pinned by tests that start from an existing plain alias and verify
   both namespaces unchanged after each failed generic replacement.

### Error matrix (named codes; layer that rejects)

| Case | Code | Layer |
| --- | --- | --- |
| bare use of generic alias; under/over-arity; empty `<>` | `generic-alias-arity` | type builder (all routes) |
| args on a NON-generic alias or nominal type | `generic-alias-arity` (arity 0 reading) | type builder |
| open argument failing bound-vs-bound; ground argument failing bound | `generic-alias-bound` (names both bounds) | type builder |
| direct self-reference | `generic-alias-self-reference` | type builder |
| forward reference applied | `generic-alias-forward-reference` | type builder |
| unused clause parameter | `generic-alias-unused-parameter` | declareType |
| duplicate/reserved clause names; malformed clause text | shared clause parser's structured errors (Cortex adds ranges; host throws) | clause parser |
| `typeParams` on the nominal statement form | existing `type-variables-unsupported` (message updated) | Cortex parser |
| malformed applied reference (missing `>`, trailing comma) | type-grammar syntax error | type parser |
| host `typeParams` with non-ground bound | `unsupported-variable-position` (parent spec table) | declareType |

Host routes throw; the DeclareType operator route yields error VALUES
(the Assign/Declare conversion pattern); Cortex statements surface
diagnostics — one test per route per row where reachable.

## 4. Test plan

1. End-to-end on all routes (Cortex statement, host API, box-route
   `DeclareType` — parity per §3.7): declare, apply in `let`/parameter
   annotations, nested ground applications (`list<Pair<integer>>`,
   `Pair<Pair<integer>>`), values validate against the expansion.
2. **A7 composition**: `Wrap<T> = list<Pair<T>>` (unbounded-into-
   unbounded ✓); `K<U: number> = Keyed<U>` with `Keyed<T: value>` ✓;
   `Keyed<T>` under bare `forall T.` in a signature → `generic-alias-
   bound`; `forall T: value. (Keyed<T>) -> T` ✓ end-to-end through a
   generic function.
3. Bounds at ground use: with `Keyed<T: number>`, `Keyed<integer>` is
   accepted and `Keyed<string>` rejects with `generic-alias-bound`
   naming both the argument and the bound.
4. Arity/shape matrix: every row of §3's table, per reachable route.
5. Self-reference; forward reference; nominal-with-clause; plain
   statements unchanged (existing declare-type suite green).
6. No mint, no value-namespace claim: `Pair(1,2)` inert/unknown;
   `function Pair(x) { x }` after the alias remains legal (precedent);
   plain→generic redeclaration drops the old constructor.
7. Serialization: statement round-trip; applied spelling preserved in
   SOURCE, expansion in `.type` (A4 pinned); both attrs encodings.
8. A6 recovery: malformed applied alias in a `type` statement (next
   statement survives — remove the sacrificial filler), in a function
   parameter list, in a `match` pattern (list resync, remainder of the
   list parses).
9. A8 snapshot: redeclare `Pair` after `Wrap` — `Wrap<integer>` still
   shows the old expansion; re-declaring `Wrap` picks up the new one.
   A5: a newly parsed expression after redeclaration sees the new
   expansion.
10. Cache: identical body text parsed with no seed / seed `T` / seed
    `U` in every order (C-theme); frozen shared types never mutated
    (substitution is a pure rebuild — assert source object untouched).
11. `__proto__`/`toString` clause names on all three routes.
12. Block scope: generic alias declared in a block, applied after the
    block → `Unknown type` (matches base-statement behavior).
13. Full suite; zero unexplained snapshot churn.

## 5. Phases

1. A6 recovery fixes (all four call sites) + pins — independent, first.
2. Type layer: reference-args syntax, record field, shared clause
   parser, expansion + A7 admission + self/forward guards, `typeVars`
   pre-seed + cache rule, host API, error codes.
3. Cortex statement + `declareTypeStatement` threading + serializer +
   mint carve-out + A5 bump + rollback tests.
4. Docs (doc/08-guide-types.md, cortex docs types.md/syntax.md EBNF) +
   CHANGELOG.
