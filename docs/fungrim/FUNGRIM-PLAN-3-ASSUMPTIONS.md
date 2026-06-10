# Design: Complex-Domain Constraints in the Assumptions System (Fungrim Track 3, Feature B)

**Status:** Draft design document (not an implementation plan)
**Scope:** `ce.assume()`, the assumptions store, `verify()`/`ask()`, symbol predicates, and rule-guard discharge in the Compute Engine
**Driving requirement:** docs/fungrim/FUNGRIM.md §4 Feature B — discharge the `complex-domain` guard slice of the Fungrim corpus (theta, modular, hypergeometric, gamma reflection/multiplication families)

---

## 1. Problem Statement

Fungrim formula guards routinely require deciding predicates like:

| Guard shape | Meaning | CE today |
|---|---|---|
| `Element(tau, HH)` | Im(τ) > 0 | `assume()` throws (`assume.ts:451`: "Invalid domain") |
| `Greater(Re(z), 0)` | half-plane constraint | `assume()` **mis-declares `z` as `real`** (`assume.ts:402-414`) |
| `Less(Abs(q), 1)` | unit disk | same destructive retype; not queryable |
| `Element(n, ZZGreaterEqual(1))` | integer AND n ≥ 1 | only the type half survives; composed form unreliable |
| `Element(z, SetMinus(CC, Set(-i, i)))` | domain minus branch points | not representable; throws |

Today `assume()` handles exactly three shapes: `Element` of one of six primitive number sets (converted to a *type*, `boxed-expression/utils.ts:154` `domainToType`), single-subject inequalities against constants (stored normalized as `Less/LessEqual(p, 0)` in the scoped assumptions `ExpressionMap`), and equalities-as-assignments. Everything else throws (`assume.ts:75`).

The query side is similarly narrow: `getSignFromAssumptions` (`assume.ts:530`) and `getInequalityBoundsFromAssumptions` (`boxed-expression/inequality-bounds.ts:158`) pattern-match the normalized inequalities **for a bare symbol only**; `BoxedSymbol.sgn` (`boxed-symbol.ts:589`) is the lone consumer of the former.

The goal is a **structural-predicate layer**: store facts about a small algebra of "subjects" — a symbol, or `Real(x)`, `Imaginary(x)`, `Abs(x)`, `Argument(x)` of a symbol — plus membership/exclusion facts in set expressions, and answer queries from those facts with strict three-valued semantics. No inference engine.

### Naming note

CE's canonical heads are `Real`, `Imaginary`, `Argument`, `Abs` (`library/complex.ts`). Fungrim's `Re/Im/Arg` map to these at translation time. `HH` (upper half-plane) has no CE symbol; the translator desugars `Element(tau, HH)` → `Greater(Imaginary(tau), 0)`. This document uses CE names.

---

## 2. Core Design Concept: Constraint Subjects

Generalize the unit of fact-keying from `symbol: string` to a **subject**:

```
Subject := symbol
         | Real(symbol) | Imaginary(symbol) | Abs(symbol) | Argument(symbol)
```

A new helper module (`boxed-expression/constraint-subject.ts`, conceptually) provides:

- `subjectOf(expr) → { symbol: string, part: 'self'|'re'|'im'|'abs'|'arg' } | undefined` — recognizes a canonical subject term (and nothing deeper; `Real(z + w)` is **not** a subject).
- `subjectKey(subject) → string` — e.g. `"re:s"`, `"abs:q"`, `"self:x"` — for indexing.

Every existing symbol-keyed assumption utility (`getSignFromAssumptions`, `getInequalityBoundsFromAssumptions`) is generalized from `(ce, symbol)` to `(ce, subject)`, with the symbol overloads kept as thin wrappers for backward compatibility.

This is deliberately the *smallest* generalization that covers the Fungrim guard corpus: the four part-extractors applied to a single symbol, compared against constants. Inequalities whose left side is any other compound expression continue to be stored as opaque normalized predicates (matchable by `ask()` verbatim, as today) but do not feed bounds/sign queries.

---

## 3. Representation and Storage

### 3.1 Where facts live: keep the scoped `ExpressionMap`, add a lazy index

**Decision: the existing `ce.context.assumptions: ExpressionMap<boolean>` remains the single source of truth.** No new per-symbol fact-list store.

Rationale:

- **Scoping and `forget()` already work.** `pushScope` copies the assumptions map (`engine-scope.ts:42, 61`), so child-scope assumptions vanish on pop. `forget(symbol)` deletes every assumption `a` with `a.has(symbol)` (`engine-assumptions.ts:312-313`) — and since `Less(1 - Real(s), 0)` *contains* the symbol `s`, part-facts and exclusion facts are forgotten for free.
- **`ask()` pattern-matching keeps working** over the same store with zero changes (`engine-assumptions.ts:170-179`).
- A second store would need parallel copy-on-push, forget, and serialization logic — pure duplication.

**Performance:** `ExpressionMap` is a linear scan with `isSame` (`boxed-expression/expression-map.ts`). With a few dozen assumptions per scope this is fine, but rule-guard discharge will query it per candidate match. Add a **lazily built, generation-stamped index**:

```
FactIndex (cached on the engine, invalidated when ce._generation changes or assumptions mutate):
  bySubject: Map<subjectKey, { bounds: IntervalBounds, notEqual: Expression[] }>
  membership: Map<symbol, { in: Expression[] /* set exprs */, notIn: Expression[] }>
```

The index is derived purely from the `ExpressionMap` contents, so scoping/forget semantics are inherited, not reimplemented. `ce.assume()` and `forget()` already bump `_generation` (`engine-assumptions.ts:270, 295, 330`), which doubles as the invalidation signal.

### 3.2 Normal forms stored

All facts are stored as canonical boxed predicates in the map, in these normal forms:

| Fact kind | Stored form | Example source |
|---|---|---|
| Part inequality | `Less/LessEqual(subject - k, 0)` — same normalization as today, but lhs may contain a subject term instead of a bare symbol | `assume(Re(s) > 1)` → `Less(1 - Real(s), 0)` |
| Disequality | `NotEqual(subject, v)` | derived from `SetMinus`, or direct `assume(z ≠ 0)` |
| Set membership | `Element(x, setExpr)` with `setExpr` canonical, **only when** `setExpr` does not reduce to a primitive type or to part-inequalities | `Element(x, AlgebraicNumbers)`, `Element(tau, SL2Z)`-style inert sets |
| Set exclusion | `NotElement(x, setExpr)` | from `SetMinus(CC, ZZLessEqual(0))` |

**Decomposition at assume-time ("shallow saturation"):** structured assumptions are split into independent stored facts plus *type refinements*, never kept as monoliths:

- `Element(n, Range(1, +∞))` (the translation of `ZZGreaterEqual(1)`) ⇒ refine `n`'s type to `integer` **and** store bound `n ≥ 1`. (`Range` is integer-valued, `library/collections.ts:195`.)
- `Element(z, SetMinus(S, Set(a, b, …)))` ⇒ recurse on `Element(z, S)` (type refinement or stored membership) **plus** stored `NotEqual(z, a)`, `NotEqual(z, b)`, ….
- `Element(z, SetMinus(S, T))` with non-finite `T` ⇒ recurse on `Element(z, S)` **plus** stored `NotElement(z, T)`.
- `Imaginary(tau) > 0` ⇒ store the bound on subject `im:tau` **plus** derived facts: `NotElement(tau, RealNumbers)` and `NotEqual(tau, 0)` are implied, and are stored. (Design conservatively: store the two derived facts, leave finiteness alone.)
- `Abs(q) < 1` ⇒ store bound on subject `abs:q` **plus** refine `q`'s type to `finite_number` (|q| bounded ⇒ finite). The implicit lower bound `Abs(q) ≥ 0` is *not* stored (structural knowledge of `Abs`, available from the `Abs` sgn handler already).
- `And(p1, p2, …)` in an assumption ⇒ assume each conjunct (new: `assume()` accepts `And`).

Derived facts are *stored alongside*, not inferred at query time — this keeps the query path a lookup, not a search, which is the explicit non-goal boundary (§7).

### 3.3 Type refinement vs. facts — the division of labor

The type system remains the home for what it can express (`integer`, `real`, `finite_number`, sign of a real symbol via value-def flags). Facts cover what it cannot: bounds, part-constraints, disequalities, non-membership, membership in non-primitive sets. The rule:

> **`assume()` may only ever *narrow* a symbol's type (move down the subtype lattice), and only when the predicate genuinely implies the narrowing for the symbol itself.** `Re(s) > 1` implies `s` is a number — it does **not** imply `s : real`. The correct refinement for any part-predicate over `Real/Imaginary/Abs/Argument(s)` is at most `s : number`, and only if `s` is currently `unknown`.

This kills the destructive `s := real` retype (`assume.ts:402-414`) — see §4.

---

## 4. The `assume()` Surface

### 4.1 Newly accepted input shapes

| Input | Action |
|---|---|
| `Greater/Less/…(Part(x), k)` where `Part ∈ {Real, Imaginary, Abs, Argument}`, `k` numeric | store normalized part-bound; refine `x` to `number` only if currently unknown; **no `real` retype** |
| `NotEqual(x, v)`, `NotEqual(Part(x), v)` | store disequality fact (new operator accepted; today `assume()` throws on `NotEqual`) |
| `Element(x, <interval/Range/integer-interval>)` | type refinement + bound facts (the `ZZGreaterEqual(1)` case) |
| `Element(x, SetMinus(…))`, `Element(x, Union(…of intervals))` | decompose per §3.2 |
| `Element(x, <inert/unknown set symbol>)` | store as membership fact instead of throwing (`assume.ts:451` stops throwing) |
| `NotElement(x, S)` | store exclusion fact |
| `And(p1, …, pn)` | assume each conjunct; result is `'contradiction'` if any conjunct contradicts, else `'ok'`/`'tautology'` |

`assume()`'s final fallback changes from `throw` to returning `'not-a-predicate'` for shapes the layer cannot represent (e.g. quantified guards, `Or`). Rationale: the Fungrim loader must be able to probe guard dischargeability in bulk; exceptions as control flow are hostile to that, and `AssumeResult` (`types-kernel-evaluation.ts:49`) already has the right vocabulary. *(Compat note in §9 — this is an observable API change.)*

### 4.2 Fixing the inequality side-effect

`assumeInequality` (`assume.ts:180-420`) is restructured around `subjectOf`:

1. Normalize to `Less/LessEqual(lhs - rhs, 0)` as today.
2. If the difference is `±subject + constant`: run the existing tautology/contradiction check against `getInequalityBoundsFor(ce, subject)` (the generalized bounds function), then store.
3. Type side-effect rules:
   - subject is a **bare symbol** → keep today's behavior (declare/infer `real`); an order comparison legitimately implies a real symbol.
   - subject is a **part term** → refine the underlying symbol to `number` only if its type is unknown/inferred; never to `real`.
4. Multi-unknown / non-subject inequalities: stored opaque, as today (case 4) — but **without** the per-unknown `real` declaration that case 3 currently applies (`assume.ts:404-414` applies it whenever there is exactly one unknown, which is precisely the `Re(s) > 1` bug: the one unknown is `s`).

### 4.3 Contradiction checking scope

Contradiction detection for the new facts is **bounds-level only**, per subject: a new part-bound is checked against existing bounds on the same subject (reusing the existing interval logic), and `NotEqual(x, v)` is checked against an assigned value of `x`. Cross-subject consistency (e.g. `Abs(q) < 1` vs `Re(q) > 2`) is *not* detected — documented as out of scope (it requires interval arithmetic over parts; see non-goals).

---

## 5. Query / Discharge Path

### 5.1 Where guards actually get evaluated

Both consumers reduce to **predicate evaluation**:

- Declarative rule conditions compile to `condition.subs(sub).canonical.evaluate()` and fire only on literal `True` (`boxed-expression/rules.ts:575-578, 631-640`). An unknown predicate stays unevaluated ≠ `True` ⇒ rule does not fire. This is already fail-safe.
- Closure conditions (e.g. Fungrim loader-generated, `solve.ts`-style `(sub) => sub._z.isPositive === true`) go through symbol/expression predicates (`CONDITIONS` table, `rules.ts:163-231`, note `checkConditions` correctly requires `!== true`).
- `verify()` (`engine-assumptions.ts:199-257`) evaluates the predicate and maps `True/False/other` → `true/false/undefined`, with Kleene logic for `And/Or/Not` — already correctly three-valued.

So the work is to make **`evaluate()` on the predicate operators consult the fact index**, and everything above inherits the improvement. Concretely:

**(a) Relational operators over subjects.** When `Less/Greater/LessEqual/GreaterEqual` cannot be decided from values/signs, and one side normalizes to a subject term with the other side numeric, query `getInequalityBoundsFor(ce, subject)` and decide by interval comparison. Return *unevaluated* when indeterminate. This is the generalization of what `ask()`'s B2 branch does for symbols (`engine-assumptions.ts:124-167`).

**(b) `sgn` handlers for `Real`/`Imaginary`/`Abs`/`Argument`.** Each already has a value-based `sgn` (`library/complex.ts:16, 35`); extend: when the operand is a symbol with no value, fall back to a `getSignFromAssumptions`-style lookup on the corresponding subject. Since `BoxedFunction.sgn` feeds `isPositive`/`cmp` engine-wide, this single hook makes `Im(tau).isPositive === true` after `assume(Im(tau) > 0)`, which is exactly what closure-style guards ask.

**(c) `Element`/`NotElement` evaluation** (`library/sets.ts:532-655`): after the existing `contains`/type checks return undefined, consult the membership index — exact (`isSame`) match of the set expression answers `True`; a stored `NotElement` match answers `False`; and a `SetMinus` *query* is decomposed exactly like a `SetMinus` assumption (conjunction of membership + disequalities/exclusions), with Kleene combination. This gives compositionality without search: assume-side and query-side use the same decomposition, so facts stored decomposed answer queries decomposed.

**(d) Disequalities.** `eq()` already calls `ask(NotEqual(x, v))` (per the recursion note at `engine-assumptions.ts:185-188`), so stored `NotEqual` facts are consumed by the existing equality machinery with no new wiring beyond storage.

**(e) Symbol predicates.**

- `isInteger`, `isReal`, `isNumber`: unchanged — they read the type (`boxed-symbol.ts:~640-660`), and the `ZZGreaterEqual(1)`-style facts refine the type at assume time. ⇒ `Element(n, Range(1,∞))` yields `n.isInteger === true` and `n.isGreaterEqual(1) === true` through (a).
- `isFinite`: currently `this.value?.isFinite` only (`boxed-symbol.ts:601`); extend to consult the type (`finite_number` refinement from `Abs(q) < 1`) — arguably a pre-existing gap.
- `isReal === false` for `Im(tau) > 0`: the stored `NotElement(tau, RealNumbers)` fact is consulted by `isReal` as a final fallback (type says "number", fact says "not in ℝ" → `false`). This is the one predicate that needs a fact lookup rather than pure type reading, because types cannot express negation.
- `.sgn` on symbols: unchanged (`getSignFromAssumptions`).

### 5.2 Three-valued discipline (and the prerequisite fixes)

The design **builds on corrected three-valued semantics** and requires two hygiene items as prerequisites:

1. **REVIEW.md A3** (`abstract-boxed-expression.ts:636-658`): `isLess`/`isGreater` must return `undefined`, not `false`, when `cmp()` yields the indeterminate `'<='`/`'>='`. Without this, guards *misfire negatively* in a way that masks whether the new facts are being consulted, and `extractIntervalBounds`/`_mergeBounds` (`inequality-bounds.ts:96, 122`) silently drop bounds. All new code in this design treats `boolean | undefined` honestly and compares `=== true` before acting.
2. **`contains` handlers returning `false` for unknowns** (`library/sets.ts:96-528`): e.g. `PositiveNumbers.contains` is `x.type.matches('real') && x.isPositive === true` — a symbol of unknown sign yields `false`, so `Element(x, PositiveNumbers)` evaluates to **`False`** (`sets.ts:603-607`) when the truth is *unknown*. The `contains` contract already allows `undefined` (`types-definitions.ts:699`, `abstract-boxed-expression.ts:926`); the number-set handlers must be audited to return `undefined` when the sign/type predicate is `undefined` rather than definitively false. Without this audit, the new fact layer can never reach the membership index — `Element` will have already returned a wrong `False`. This is the same bug class as A3, one level down.

Invariant stated for the whole layer: **a predicate evaluation may return `True` only when the facts logically entail it, `False` only when they logically refute it, and must otherwise stay unevaluated.** Rules fire only on `True`.

### 5.3 The four composition cases, end to end

| Fungrim guard | assume-time | query-time |
|---|---|---|
| `Element(n, ZZGreaterEqual(1))` | type(n) := integer; store `n ≥ 1` | `n.isInteger` → type; `n ≥ 1`, `n > 0`, `n ≠ 0` → bounds via (a)/(d) |
| `Im(tau) > 0` | bound on `im:tau`; store `NotElement(tau, ℝ)`, `NotEqual(tau, 0)` | `Imaginary(tau).isPositive` via (b); `tau.isReal === false` via (e); `tau ≠ 0` via (d) |
| `Abs(q) < 1` | bound on `abs:q`; type(q) := finite_number | `Abs(q) < 1` via (a); `q.isFinite === true` via (e) |
| `Element(z, SetMinus(CC, Set(i, -i)))` | type(z) := number(=ℂ); store `z ≠ i`, `z ≠ -i` | query decomposes identically; conjunction of type check + disequality facts via (c)/(d) |

---

## 6. Set-Membership Evaluation: Reuse vs. Symbolic Facts

`library/sets.ts` already has correct *concrete* membership for `Interval`, `SetMinus` (`sets.ts:892-915`), `Union`, `Range`, and the primitive number sets — these are reused untouched for literal values (`Element(0.5, Interval(0,1))` etc.). The split is:

- **Concrete element** (value known): the `contains` handler decides. No change except the §5.2(2) undefined-audit.
- **Symbolic element**: `Element.evaluate` falls through `contains` (now honestly `undefined`) into the new fact-index lookup + structural decomposition of §5.1(c).
- **Inert sets** (`AlgebraicNumbers`, `SL2Z`, `ZZp` — docs/fungrim/FUNGRIM.md §4.F): declared as set symbols with no `contains`; membership works purely by exact-match facts. That is all the modular topics need.
- `domainToType` (`utils.ts:154`) is extended only marginally (e.g. recognize `NonNegativeIntegers` etc. where a type exists); it is no longer the gatekeeper whose failure throws — its failure now routes to fact storage.

---

## 7. Non-Goals (Explicit)

1. **No forward-chaining inference engine.** Consequences are computed once, shallowly, at assume time, from a fixed table of decompositions. Nothing re-derives facts from combinations of facts at query time. (E.g. `Re(s) > 1 ∧ Im(s) = 0 ⇒ s > 1` is *not* derived.)
2. **No quantified assumptions.** `All(...)`/`ForElement` guards (~50 entries) remain undischargeable; the Fungrim loader marks them `guardLevel: undischargeable` and excludes them from the active rule set.
3. **No numeric interval-arithmetic discharge** (Fungrim brain.py / Arb style). No evaluation of `Abs(f(z)) < 1` for symbolic `z` by interval enclosure; no cross-part consistency (`Abs(q) < 1 ∧ Re(q) > 2` is not detected as contradictory).
4. **Guard shapes that remain undischargeable** after this design, stated for honesty:
   - parts of compound expressions: `Re(a + b) > 0`, `Re(s) > Re(t)` (stored opaque, never decides);
   - constraints between two symbols (`Abs(z) < Abs(w)`);
   - membership in image sets / set comprehensions; lattice/`SL2Z` membership beyond verbatim facts;
   - `Argument`-range constraints used to pick branches when combined with arithmetic (`-π < Arg(z) ≤ π` stores fine; consequences like `Re(z) > 0 ⇒ Arg(z) ∈ (-π/2, π/2)` are not derived);
   - anything requiring the analytic-property metadata store (Feature E).

---

## 8. Alternatives Considered

**A. Encode everything in the type system** (refinement types for Re/Im bounds). Rejected: CE's type lattice has no dependent/refinement types; forcing `Im > 0` into a type either invents a parallel type algebra or recreates today's bug (lossy projection to `real`). Types stay for what they express natively.

**B. New per-symbol fact record store** (`facts: Map<symbol, SymbolFacts>` in `EvalContext`). Structured and fast, but duplicates copy-on-push scoping, `forget`, and would bypass `ask()`'s pattern-matching, splitting the source of truth in two. Rejected as *storage*; its shape survives as the **derived index** of §3.1.

**C. Single scoped `ExpressionMap` + lazy subject index + shallow assume-time saturation.** **Recommended.** Minimal new state, inherits scoping/forget/ask, query cost amortized by the generation-stamped index, and the decomposition table is the only "smart" component — small, testable, and bounded.

**D. Query-time decomposition only (no assume-time saturation).** Store assumptions verbatim, decompose at every query. Simpler writes, but every query becomes a structural search over all assumptions, and derived facts (`tau ≠ 0` from `Im(tau) > 0`) would need rederivation logic in *every* consumer (`eq()`, `isReal`, sgn handlers). Rejected: pay once at assume time instead.

---

## 9. Migration / Compatibility Risks

| Change | Risk | Mitigation |
|---|---|---|
| `assume(Re(s) > 1)` no longer types `s` as `real` | **Behavioral change.** Any downstream code relying on the (incorrect) `real` typing — e.g. `s.isReal === true`, real-only simplifications firing — changes answers from `true` to `undefined`. | This is the bug being fixed; changelog entry + tests asserting the new semantics. Bare-symbol inequalities (`x > 0`) keep the `real` inference, so the common case is untouched. |
| `assume()` returns `'not-a-predicate'` instead of throwing on unsupported shapes | Callers using `try/catch` as the "unsupported" signal silently proceed. | Audit in-repo callers (tests, docs); the public docs already describe `AssumeResult` as the contract. Possibly keep a throw for outright malformed (non-predicate-operator) input and reserve `'not-a-predicate'` for well-formed-but-unsupported. |
| `Element(x, PositiveNumbers)` (symbolic `x`, unknown sign) evaluates to unevaluated instead of `False` | Tests/users depending on the wrong `False`. | Same class as A3; fix is a correctness prerequisite, documented together. |
| `forget(symbol)` does not undo type refinements | Pre-existing (`engine-assumptions.ts:288`: "don't change the domain"); new refinements (`integer`, `finite_number`) make it slightly more visible. | Document; optionally record refinements done by `assume()` in the scope so `forget` can revert exactly those (small follow-on, not required for Fungrim since guards are evaluated inside transient scopes). |
| New evaluation hooks (`sgn`, relational, `Element`) consult the fact index | Performance regression risk on hot paths when no assumptions exist. | Index lookup is gated on a non-empty assumptions map (single emptiness check), and the index is generation-cached. |
| `ask()` B2 generalization to subjects may produce new matches | Strictly additive; dedup via `pushResult` already in place. | Snapshot tests on existing `ask()` behavior. |

---

## 10. Phased Implementation Sketch (sizes only)

| Phase | Content | Size |
|---|---|---|
| **P0 — hygiene prerequisites** | REVIEW.md A3 three-valued comparison fix; `contains`-returns-`undefined` audit of the number-set handlers in `library/sets.ts` | S–M |
| **P1 — subjects + storage** | `subjectOf`/`subjectKey`; generalize `getInequalityBoundsFromAssumptions` and `getSignFromAssumptions` to subjects; fact index with generation invalidation | M |
| **P2 — `assume()` extension** | part-inequalities without retype; `NotEqual`/`NotElement`/`And`; `Element` decomposition table (Range/intervals, SetMinus finite & infinite, inert sets); stop throwing; bounds-level contradiction checks | M–L |
| **P3 — query hooks** | relational-operator subject bounds; `Real/Imaginary/Abs/Argument` sgn fallbacks; `Element/NotElement` fact lookup + query-side SetMinus decomposition; `isFinite`/`isReal` fact fallbacks | M |
| **P4 — integration + acceptance** | `ask()` subject generalization; rule-condition end-to-end tests; the Fungrim guard acceptance suite (§11); docs (`assumptions` guide update) | S–M |

P0–P1 are independently shippable; P2 and P3 can land behind tests without the Fungrim corpus existing.

---

## 11. Validation Strategy

**Target slice:** with this design, the Fungrim `guardLevel: complex-domain` annotation (docs/fungrim/FUNGRIM.md §2 translator output) becomes the loadable slice — guards composed of part-inequalities vs constants, `SetMinus`/finite-exclusion membership, `NotEqual`, and conjunctions thereof. The translator's offline `guardLevel` computation is re-run against the *implemented* capability list so the active rule set stays honest (docs/fungrim/FUNGRIM.md §6, "guard discharge failures are silent").

**Acceptance tests** — each asserts (i) `assume()` returns `'ok'`, (ii) the guard `verify()`s to `true` under the assumption and to `undefined` without it, (iii) a guarded rule fires only under (ii)-true, and (iv) no destructive retype occurred (`s.type` unchanged or only narrowed to `number`):

1. `Element(n, Range(1, +∞))` ⊢ `n.isInteger === true` ∧ `verify(n ≥ 1) === true` ∧ `verify(n > 0) === true` — (ZZGreaterEqual(1), 582 entries; e.g. Eisenstein/zeta even-integer entries).
2. `Greater(Imaginary(tau), 0)` ⊢ `verify(Im(tau) > 0)`, `tau.isReal === false`, `verify(tau ≠ 0) === true` — (HH desugaring; theta/eta/modular-j guards).
3. `Greater(Real(s), 1)` ⊢ `verify(Re(s) > 1) === true`, `verify(Re(s) > 0) === true` (bound implication), `s.isReal === undefined` — (zeta Euler product/Dirichlet series).
4. `Less(Abs(q), 1)` ⊢ `verify(|q| < 1) === true`, `q.isFinite === true` — (nome/q-series convergence).
5. `Element(z, SetMinus(ComplexNumbers, Set(ImaginaryUnit, Negate(ImaginaryUnit))))` ⊢ guard of entry `d4b0b6` (`Sin(Arctan(z))` identity) verifies `true`; `verify(z = i) === false`.
6. `Element(z, SetMinus(ComplexNumbers, NonPositiveIntegers))` ⊢ `verify(NotElement(z, NonPositiveIntegers)) === true` — (Gamma recurrence/reflection guards).
7. `And(Element(z, ComplexNumbers), NotEqual(z, 0))` ⊢ both conjuncts verify; `eq(z, 0)` is `false` — (Log/Argument identities).
8. Conjunction across symbols: `And(Greater(Re(a), 0), Greater(Re(b), 0))` ⊢ Beta-integral guard verifies `true`.
9. Negative control: under `Greater(Real(s), 1)`, `verify(Re(s) > 2) === undefined` (not `false`), and a rule guarded on `Re(s) > 2` does **not** fire.
10. Regression control: `assume(x > 0)` still yields `x.isPositive === true`, `x.isReal === true`; existing `assume`/`ask`/`verify` test suites pass unchanged except documented §9 deltas.
11. Scope test: assumptions from 2–4 made inside `ce.pushScope()` disappear after `popScope()`; `forget('tau')` removes all `tau` facts including derived `NotEqual(tau, 0)`.

Secondary validation: re-run the Phase-0 Fungrim round-trip harness counting dischargeable guards before/after; the design succeeds if the `complex-domain` slice (the theta/modular/hypergeometric families) moves from 0% to the large majority dischargeable, with the residue accounted for by the §7.4 list.

---

### Critical Files for Implementation

- `src/compute-engine/assume.ts` — `assume()` entry, `assumeElement`/`assumeInequality` restructuring, `getSignFromAssumptions` generalization
- `src/compute-engine/boxed-expression/inequality-bounds.ts` — subject-keyed bounds extraction (core of the query path)
- `src/compute-engine/engine-assumptions.ts` — `ask()`/`verify()`/`forget()` integration with the new fact kinds
- `src/compute-engine/library/sets.ts` — `Element`/`NotElement` evaluation, `contains` three-valued audit, SetMinus decomposition reuse
- `src/compute-engine/library/complex.ts` — assumption-aware `sgn` fallbacks for `Real`/`Imaginary`/`Argument` (plus `Abs` in arithmetic library)
- `src/compute-engine/boxed-expression/boxed-symbol.ts` — `isReal`/`isFinite`/`.sgn` fact fallbacks
