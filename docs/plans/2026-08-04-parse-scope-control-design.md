# Parse-Time Scope Control & Structural-Tier Contract Hardening

**Status: DRAFT for review — nothing implemented.**
**Origin: Tycho items 151/152/153 (`dev/tycho/docs/COMPUTE_ENGINE.md`), CE
responses and Tycho acceptances 2026-08-04.**

## Summary

Canonical parsing/boxing writes to the engine's lexical scope (free-symbol
usage-inference, undeclared call heads, the Subscript fold, `Assign` LHS
pre-declare). Consumers that parse untrusted or out-of-order input must
contain these writes with push/popScope discipline today. This design makes
containment first-class: a per-call `scope` that *receives* the writes, a
declarations-as-data initializer (`ce.createScope(table)`) that turns
each parse into a pure function of (latex, dictionary, declarations), and
a harvest API to read back what a contained parse declared and inferred. Alongside: three standalone fixes,
two documented contracts, and a serialize→parse round-trip property in CI.

Investigation notes (choke points, probe transcripts): session records
2026-08-04; key facts inlined below where load-bearing.

---

## A. Standalone fixes (Stage 0 — each independently shippable)

### A1. Partial-form parses must not auto-declare

**Today**: `ce.parse(s, { canonical: ['Number'] })` (any form array)
declares free symbols into the current scope. Only the literal
`canonical: false` and `structural: true` are inert. Cause:
`box.ts:571` — `const canonicalSymbol = canonical || options.canonical !== false;`
routes symbols through the declaring path for any non-`false` value.

**Fix (recommended)**: under a partial form, symbols resolve against the
scope chain (bind to an existing definition if one exists) but never
auto-declare; unresolved symbols stay unbound, exactly as on the
structural route. Partial-form output is not fully canonical anyway, so
the structural symbol contract is the consistent one.

**Alternative considered**: declare into an internal ephemeral scope.
Rejected: adds machinery for no consumer (Tycho confirmed zero
`canonical: [...]` call sites; we have none in-repo outside tests).

### A2. `BoxedSymbol.isSame` reflexivity early-out

**Today**: `x.isSame(x) === true` for the identical object is *emergent*
(same name + `sameBindingDef(d, d)` identity), not guaranteed — there is
no `this === other` short-circuit in the symbol path
(`boxed-symbol.ts:239`; the generic `a === b` check in `compare.ts:274`
is never reached for symbol-vs-symbol).

**Fix**: add `if (other === this) return true;` at the top of
`BoxedSymbol.isSame`. Zero behavior change, closes the emergent-only gap.

### A3. Structural `freeVariables` / scope answers via binding sites

**Today**: `getReferences` (`abstract-boxed-expression.ts:1355–1375`)
hand-rolls binder recognition (`Function` params, `Limits`/`Element`
first operands, `Block`-level `Assign`/`Declare`). It predates the
binding-site machinery and does not know the raw parse spellings, so on a
**structural** tree a `Sum`'s bound index leaks as a free variable:

```
["Sum", ["Power","n",2], ["Tuple","n",1,10]]  (structural)
  → freeVariables: ['n']        // wrong; canonical route: []
```

**Fix**: when the node's operator definition is available (structural
trees are bound, so it is), derive bound names from the definition's
binding-site selectors (`binding-sites.ts` — `operandSites`,
`operandsFrom`, `indexingSetSite`; these already read raw operand shapes,
including the `Tuple`/`Element`/`Limits` spellings). Keep the current
heuristic only as the fallback for unbound nodes. This removes a
duplicated, drifting copy of binder knowledge (per the
derive-from-the-definition-flag principle).

**CHANGELOG**: called-out entry — Tycho retires their binder-spelling
capture-avoidance collectors on this flag.

---

## B. Per-call scope control (Stage 1 — item 151 core)

### B1. `scope` option that receives writes

```ts
// NEW option on parse; CHANGED semantics on expr/box
ce.parse(latex, { scope?: Scope, ... });
ce.expr(json,   { scope?: Scope, ... });
```

**Semantics**: when `scope` is supplied, the parse/box runs with that
scope as the current lexical scope (internally `ce._inScope(scope, ...)`):
lookups walk `scope → parents`, and **all auto-declares and inference
land rooted at the supplied scope** per the normal rules. Discarding the
scope discards the writes.

**Behavior change, must be a called-out CHANGELOG entry**: `ce.expr`'s
existing `scope` option steers *lookup only* today — auto-declares still
land in the engine's current scope. Nobody can be relying on that
half-honored behavior on purpose (it is the surprise the new semantics
remove), but it is a semantic change to a shipped option.

**Implementation note**: the auto-declare walk
(`engine-expression-entrypoints.ts:170` and the two parameter sites)
starts from `engine.context.lexicalScope`; running the whole box/parse
inside `_inScope(scope, …)` redirects it with no per-site edits. The
LaTeX parser itself never writes scope (pinned by
`expression-properties.test.ts:527`), so wrapping the `box()` call inside
`ce.parse` (`index.ts:2266`) covers the parse route.

### B2. `createScope` — per-call declarations as data

There is deliberately **no separate `bindings` option on `parse`/`expr`**:
the declarations table is the *scope's initializer*, so `scope` remains
the single per-call option and no option-interaction rules exist.

```ts
// NEW: create a scope for the `scope` option. `parent` defaults to the
// engine's current lexical scope AT CALL TIME (documented — callers with
// ordering discipline, e.g. Tycho, pass their document scope explicitly).
ce.createScope(
  bindings?: Record<string, Type | TypeString | BoxedDefinition>,
  parent?: Scope
): InspectableScope;   // Scope + read surface, defined in B3

const scope = ce.createScope({ h: 'function', p: 'tuple<3>' });
const expr  = ce.parse(row, { scope });
```

**`BoxedDefinition` initializer values (Tycho rider 1)**: a harvested
`def` re-installs the **same definition object** — a plain
`bindings.set(name, def)`, NOT a re-declare through
`declareSymbolValue` (which would mint a fresh holder). Binding identity
and `_writeVersion` continuity are preserved, so pass N+1 seeded from
pass N's harvest keeps memo validation warm (the consumer D-203
invariant) by construction. Constraints: same engine only (definitions
are engine-bound); installing one def in two live scopes makes it
*shared mutable state* — a type narrowing through either scope is
visible in both. That aliasing is the intended semantics for sequential
pass-seeding and is documented, not prevented.

**Semantics**: each entry is declared into the fresh scope; the parse/box
runs with it current (B1); the caller keeps or discards the scope.
Bindings shadow outer declarations, innermost-wins. Reusing one scope
across several calls is supported and useful — e.g. parsing every row of
a document pass into the same scope accumulates the harvest (B3) across
rows.

Properties this delivers (all probe-verified on current main via the
pushScope-equivalent):

- **Pass-1 replacement**: `createScope({ h: 'function' })` — bare
  `'function'` is an arity wildcard in `assertFunctionLiteralArity` — makes
  `h(u) = u^2` parse valid against a predeclared 2-arg `h`, and
  `N(x,m,s) = …` valid against the builtin. One binding per definition
  head, per call, no mutation, no ordering.
- **Trigger-spelled folds**: `\theta_z` with `createScope({ theta_z: 'number' })`
  — the Subscript fold's `ce.symbol('theta_z')` *resolves* the binding
  instead of declaring (the fold consults the scope chain).
- **Purity**: with the caller supplying every free name, a parse is a
  function of (latex, dictionary, declarations) plus the engine's standard
  library — the D-217 value-equality obligation becomes assertable.

**Value type**: `Type | TypeString` only in v1. Full partial declarations
(values, `isConstant`, …) can widen later if a consumer needs them;
starting narrow keeps the purity story simple.

**Why scope declarations when `resolveSymbol` exists**: the oracle is a
parse-phase hint; every item-151 problem lives in the box phase, where
the oracle no longer exists. Specifically, `resolveSymbol` (a) cannot
shadow a scope declaration — the definition-head collision (`h(u) = u^2`
vs a predeclared 2-arg `h`) fails at canonicalization, where argument
validation walks the scope chain and never consults the oracle; (b)
cannot reach the Subscript fold, which resolves via `ce.symbol` inside a
canonical handler; (c) carries no types into validation/inference — it
disambiguates spelling and head-ness but creates no definition; (d)
cannot be harvested (B3 enumerates real definitions) and cannot be
value-compared (the D-217 agreement obligation reduces to input value
equality only for data, not closures). Conversely, the initializer table
feeds the parse phase for free: the oracle already falls back to scope
lookup (`_resolveSymbolFromScope`), so declarations in the supplied scope
are visible to parse-time decisions through the existing consultation
points. `resolveSymbol` stays — the two compose; `createScope` does not
replace it.

### B3. Harvest API — the enumerable scope

Tycho's addition: some contained writes are wanted (registration harvests
inferred parameter types). Design: the caller *owns* the scope object, so
harvesting = enumerating it after the call.

```ts
// createScope (B2) returns an inspectable scope: structurally a Scope
// (assignable anywhere a Scope goes), plus the read surface.
interface InspectableScope extends Scope {
  // Sorted lexicographically by name — DETERMINISTIC (consumers
  // fingerprint the harvest), independent of declare interleaving.
  declarations(): ReadonlyArray<{
    name: string;
    type: BoxedType;     // post-inference type (narrowed in place);
                         // .toString() = canonical fingerprintable
                         // spelling, .matches() works directly
                         // (user-ruled 2026-08-05: BoxedType, not raw
                         // Type — raw Type made fingerprints depend on
                         // internal representation stability)
    inferred: boolean;   // true if auto-declared/type-inferred rather
                         // than explicitly declared (incl. initializer)
    def: BoxedDefinition;
  }>;

  // OUTER symbols narrowed by contained parses run against this scope —
  // the phase-1 residual, made observable (Tycho rider 2). Same
  // deterministic order.
  narrowings(): ReadonlyArray<{
    name: string;
    from: BoxedType;
    to: BoxedType;
    def: BoxedDefinition;   // a def NOT in this scope's bindings
  }>;

  // Deterministic release: unsubscribes owned defs from engine
  // configuration-change tracking. Idempotent. Bumps each def's
  // _writeVersion once (visible to writeVersion-keyed consumer caches —
  // dispose BETWEEN passes, not mid-pass). Defs stay data-readable
  // after disposal; re-installing a DISPOSED def is out of contract.
  dispose(): void;
}
ce.createScope(bindings?, parent?): InspectableScope;
```

Usage — the harvest-scope pattern:

```ts
const scope = ce.createScope(heads);          // initializer = B2 table
const expr = ce.parse(row, { scope });
const harvested = scope.declarations();
// … read inferred param types; discard `scope` when done
```

The harvest sees the initializer's entries with their post-inference
types alongside any auto-declares. Callers that want no harvest simply
drop the scope reference — there is no separate discard path.

**Design notes.** `Scope` itself stays a plain structural type
(`types-kernel-evaluation.ts:307`), created as object literals throughout
the engine (binder scopes, push-scope frames, bootstrap) — those sites
are untouched. Only `createScope` returns the enriched instance;
structural typing makes it a `Scope` everywhere one is accepted. The
read surface exists because the scope's content is *opaque by design*:
`Scope.bindings` is publicly `Map<string, unknown>` — its values are
internal definition records whose shape is not API — so `declarations()`
is the supported decode, and the internals stay free to move.
`declarations()` needs no engine back-reference (definition records are
self-describing: type and inferred flag live on the record), so the
method carries no hidden coupling. Boundary: a hand-rolled
`{ parent, bindings }` literal still satisfies `Scope` and works as the
`scope` option, but only `createScope` products are inspectable — the
documented way to make a harvest scope.

**Lifetime contract (verified against the engine, answers Tycho rider
1's ownership question).** The `scope` option is implemented on
`inScope` (`engine-scope.ts:129`), whose exit path pops the temporary
eval context **without** the disposal loop — only `popScope` /
`removeEvalContext` route through `discardEvalContext`
(`engine-scope.ts:85`), which calls `def.dispose()` on the scope's value
defs. A caller-owned scope is never pushed through that path, so **its
definitions are never auto-disposed**: holding a harvested `def` after
the parse — or after dropping the scope reference — is supported.
`dispose()` itself is mild (`boxed-value-definition.ts:326`): one
`_writeVersion` bump plus unsubscribing from configuration-change
events; data reads keep working. The explicit `dispose()` on
`InspectableScope` exists for deterministic release of those event
subscriptions (held by constant/dynamic-valued defs; plain inferred
value defs subscribe to nothing and need no disposal).

**`narrowings()` implementation note**: the parse/box entry points
already run inside an inference transaction
(`beginInferenceTransaction`, `box.ts:434` — tracking-only today).
Extend the transaction record to capture `{def, from, to}` on each
`infer()` that targets a def outside the supplied scope, and surface the
per-call window's captures on the scope. This is the data that will
justify or retire the phase-2 suppression flag.

**Known residual (phase 1, disclosed and accepted by Tycho)**: type
inference can narrow a symbol declared in an *outer* scope during a
contained parse. An ephemeral scope contains new declarations, not
narrowing of existing ones. **Phase 2 (on record, not in this round)**: a
suppression option that also gates `infer()` against scopes outside the
supplied one — the D-217 end state.

### B4. Trigger-spelled call heads consult the oracle

**Today**: the speculative subscript-absorption loop that consults
`resolveSymbol` with joined names (`a_1`) runs only in the
single-ASCII-letter branch of `parse-symbol.ts` (~:367). `\alpha_1`
resolves through the symbol table and returns before the loop, so neither
a `resolveSymbol` handler nor a scope binding can make `\alpha_1(x)`
parse as a function application.

**Fix**: after a trigger-spelled base symbol (`\alpha`, `\theta`, …)
followed by a subscript, form the joined candidate name under the same
commit rules as the ASCII path and consult the same oracle
(per-call/engine `resolveSymbol` composed with scope lookup). A binding
`{ alpha_1: 'function' }` then covers the call-head case, completing
B2's coverage of the `makeResolveSymbolHandler` gap.

---

## C. Documented contracts (Stage 2)

One maintained doc page (the item-149.2 offer, now committed to), with a
stable URL, carrying:

1. **Parse-vs-canonical vocabulary** — the item-146 difference list + the
   binder spellings (`Tuple` limits, no `Block` wrapper, `Delimiter`
   retained), under the ratified notice guarantee (respellings =
   called-out BREAKING changelog entries).
2. **Vacuous binding** — a structural box of an undeclared call head
   succeeds with no error, no auto-declare, `operatorDefinition`
   undefined; the canonical route auto-declares (`function`, inferred).
3. **Bound-symbol equality** — per-binder-instance identity; whole-tree
   comparison is alpha-aware; compare at/below a common root; detached
   cross-tree leaf comparison out of contract; reflexivity guaranteed
   (A2). **Tier naming (Tycho rider 4)**: this contract describes the
   STRUCTURAL tier (`Same` / `.isSame()` post-split) and is invariant
   under the value-following flip — binder/alpha comparison is untouched
   by it. The page also carries (or links) the three-tier semantic
   definitions from the equality-split design.
4. **Error attachment** (answers Tycho's 152 follow-up; probe-verified):
   - A type violation attaches at the nearest **type-constraining
     consumer** — possibly arbitrarily far above the edit, through
     broadcasting/transparent operators.
   - Scalar→collection changes usually produce **no box-time error at
     all**: broadcastable lift at applications defers list mismatches to
     runtime (`g(42)` errors at box; `g(["List",1,2])` boxes valid even
     for `g: (string) -> number`). Only operators that constrain
     collections in their canonical handlers (e.g. `Sum` bounds) fire at
     box time.
   - **Sound incremental rule**: compare the changed subtree's *type*
     pre/post edit. Type unchanged ⇒ no ancestor's validity can change
     (subtree probe suffices). Type changed ⇒ re-probe from the root, or
     walk up until a node's recomputed type equals its pre-edit type.
5. **The per-call scope/bindings contract** (section B), including the
   phase-1 narrowing residual.

---

## D. Serialize→parse round-trip property (Stage 3 — item 153)

**Corpus lane (regular CI)**: harvest canonical trees by running the
existing corpora (MathNet `check-corpus` harness + the Tycho-donated
687-state reference-package trees, accepted as a seed) through
parse→canonicalize; assert `ce.parse(t.latex).isSame(t)` — the
STRUCTURAL tier (`Same`), named explicitly per Tycho rider 4; the
harness runs fresh engines with no assignments, so the assertion is
invariant under the value-following flip — against a versioned
exception list (`test/.../roundtrip-exceptions.json` or
similar, each entry carrying a reason: `bug` — link to issue — or
`documented-lossy`, e.g. `indexStyle: 'subscript'`). The initial
exception list is the first deliverable.

**Generator lane (nightly)**: a *seeded* random canonical-tree generator
(adapt `library/random-expression.ts`, which is `Math.random`-based
today) in the nightly battery, same assertion. Lands after the corpus
lane is green.

**Declined (recorded)**: `{ verifyRoundTrip: true }` serialize option —
wrong layer; superseded by the CI property. Tycho retires their
per-lowering guards after the property is green across two releases.

---

## Sequencing & verification

1. Stage 0: A1, A2, A3 — independent, each with targeted tests
   (A3 gets the structural-Sum pin + route parity).
2. Stage 1: B1 → B2 → B3 → B4 (B1 is the foundation; B4 is
   parser-local and can land in parallel).
3. Stage 2: doc page + CHANGELOG entries + CE response updates in
   Tycho's doc.
4. Stage 3: corpus lane, then generator lane.

Tests pinned from the probe transcripts: scope containment
(document scope untouched after `{scope}` parse), the `h`/`N` collision
cases, harvest read-back including inferred narrowing of a binding,
trigger-spelled head with and without binding, partial-form no-declare,
structural `freeVariables` correctness, reflexivity. Both box and parse
routes throughout (lazy-operator route-parity discipline). Full suite +
typecheck + `check:deps` before each stage ships.

## Open questions for review

1. **Naming**: `createScope` / `InspectableScope` / `declarations()` —
   alternatives welcome (`ce.scope()`, `OwnedScope`, `entries()`).
2. **`ce.expr` `scope` semantics change** (lookup-only → receives
   writes): confirm acceptable as a called-out breaking CHANGELOG entry,
   vs. introducing a differently-named option and deprecating `scope`.
3. **A1 shape**: confirm no-declare (structural-symbol contract) over
   declare-into-ephemeral for partial forms.
4. ~~**`createScope` initializer value type**~~ RESOLVED (Tycho rider 1,
   2026-08-04): `Type | TypeString | BoxedDefinition` — harvested defs
   re-install the same object (see B2).

## Release note (supersedes the earlier separate-release plan)

Per the maintainer ruling relayed to Tycho 2026-08-04: this work ships
in the **same release** as the equality-tiers split
(`2026-08-04-cheap-equal-audit.md`). Implementation order is unchanged
(equality flips first, then this plan), and Tycho structures their
adoption probes to attribute equality-driven and scope-driven pin flips
independently. The release notice must carry: the three tier
definitions, the tier namings above (round-trip property = `Same`;
bound-symbol contract = `Same`), and the two breaking entries
(`ce.expr` scope semantics; equality flips).
