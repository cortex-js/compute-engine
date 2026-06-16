# Fungrim → Compute Engine: Feasibility Analysis

**Date:** 2026-06-09
**Source:** `~/dev/fungrim-master` (Fredrik Johansson's *Mathematical Functions
Grimoire*, fungrim.org — snapshot ca. 2019–2021)
**Question:** How feasible is translating the Fungrim formula database into MathJSON
so the Compute Engine can use it for additional simplification rules, equation
solving, and other symbolic transformations — and what new CE features would that
require?

---

## Verdict

**Feasible, and a good strategic fit — but it is two projects, not one.**

1. **Translation (data)** is straightforward. Fungrim's expression model is an
   immutable S-expression (head + args, exact integers, symbols, text) — structurally
   isomorphic to MathJSON. No floats, no auto-simplification, MIT-licensed (clean for
   redistribution with attribution). An offline Python→JSON translator covering ~120–150
   symbols captures the useful 80% of the corpus.

2. **Consumption (engine)** is where the real work is. Fungrim's own inference engine
   (`brain.py`, 6,400 lines) spends most of its code *discharging instantiated
   assumptions* — deciding "is this matched `z` actually in ℂ∖{−i, i}?" before a
   rewrite may fire. CE's current assumption system cannot represent most of these
   conditions, its rule application is a linear scan unsuited to 3,000 rules, and
   ~half the special-function heads Fungrim references don't exist in CE's library.

The recommended path is **phased**: start with the parts that need no new engine
features (specific values, real-domain identities, solve templates), and let the
harder phases (complex-domain assumptions, analytic-property metadata) be driven by
actual demand.

---

## 1. What Fungrim Contains

**3,130 entries** across 62 topic files; 2,764 carry a `Formula`, the rest are symbol
definitions, tables, and plots. Each entry has a permanent 6-hex-digit ID and up to
three semantic fields:

```python
make_entry(ID("d4b0b6"),
    Formula(Equal(Sin(Atan(z)), z/Sqrt(1+z**2))),
    Variables(z),
    Assumptions(Element(z, SetMinus(CC, Set(-ConstI, ConstI)))))
```

- **451 builtin symbols**, of which **~330 actually appear in formulas**. Categories:
  ~150 special functions, ~73 arithmetic/elementary/constants, ~53 set/domain
  constructors, ~49 calculus operators (incl. typed Limit/Derivative variants),
  ~15 binding/structural constructs, ~38 logic/set operations, ~29 presentation-only.
- **Assumptions are the load-bearing element**: 1,987 of 2,764 formula entries have
  them, virtually always `And(Element(x, S), …)` with relations (`NotEqual`,
  `Greater(Re(z), 0)`, `Less(Abs(q), 1)`) and occasionally quantifiers
  (`All(…, ForElement(k, Range(1, n)))`). The corpus guarantee is: *under the stated
  assumptions, every formula is valid including corner cases, and all functions are
  total* (with `Infinity`, `UnsignedInfinity`, `Undefined` as first-class values).
- **Entry taxonomy** (measured programmatically):

  | Class | Count | Usable as |
  |---|---|---|
  | General closed-form identities (`Equal` with variables) | ~1,185 (38%) | rewrite rules (direction must be chosen by consumer) |
  | Specific values (`Gamma(1/2) = √π`, no variables) | ~437 (14%) | value lookup table |
  | Series / integral / product / limit representations | ~424 (14%) | definitions/expansions (mostly inert as rules) |
  | Inequalities, bounds, asymptotics | ~248 (8%) | interval/bound knowledge, not rewriting |
  | Analytic properties (poles, zeros, branch points/cuts, holomorphicity) | ~266 (9%) | metadata for domain checks and guards |
  | Logical/relational statements (Implies, Divides, CongruentMod…) | ~194 (6%) | assumption-style facts |
  | Non-formula (symbol defs, tables, images) | ~366 (12%) | skip / documentation |

  So roughly **1,600–2,000 entries** are candidate rewrite rules / value-table rows;
  the rest is property data or presentation.

**License:** MIT (© 2019 Fredrik Johansson). Redistribution of a translated MathJSON
derivative is permitted; include the copyright + permission notice. Caveat: the README
calls the formula language "pre-alpha … will probably be revised significantly," and
the local snapshot predates the live site — pin the snapshot and record entry IDs so
upstream revisions can be diffed later.

---

## 2. Translation: Fungrim → MathJSON

### What maps directly

| Fungrim | MathJSON / CE | Notes |
|---|---|---|
| `Expr` atoms (symbol, bigint, text) | symbol, number, string | identical model |
| `Add/Sub/Mul/Div/Pow/Neg/Sqrt/Exp/Log` | same operators | trivial renames |
| Trig/hyperbolic + inverses, `Atan2`, `Sinc` | exist in CE | |
| `Pi, ConstE, ConstI, ConstGamma, GoldenRatio, ConstCatalan` | `Pi, ExponentialE, ImaginaryUnit, EulerGamma, GoldenRatio, CatalanConstant` | all exist |
| `Cases(Tuple(v, cond), …, Tuple(v, Otherwise))` | `Which` | clean 1:1 |
| `Equal/Less/…/GreaterEqual`, `And/Or/Not/Implies` | exist | multi-arg `Equal(a,b,c)` chains need expansion to pairwise `And` |
| `ZZ, QQ, RR, CC` + `Element/Subset/Union/SetMinus/Set` | `Integers, RationalNumbers, RealNumbers, ComplexNumbers` + set ops | exist in `library/sets.ts` |
| `OpenInterval/ClosedInterval/…` | `Interval` with `Open` markers | exists |
| `Sum/Product/Integral` with `For(n, a, b)` | `Sum/Product/Integrate` with `Limits`-style indexing sets | CE's `canonicalBigop` already supports bounds and index conditions; `For`'s optional third-argument filter predicate maps to CE's index conditions |
| `ForElement(n, S)` in Sum/Set-builder | `Element(n, S)` indexing sets | supported |
| `Infinity, UnsignedInfinity, Undefined` | `PositiveInfinity, ComplexInfinity, NaN`-ish | semantics close enough; needs a documented convention |
| `Matrix`, `Det` | `Matrix`, `Determinant` | exist (note: tensor `determinant()`/`inverse()` bugs in REVIEW.md F1–F2 must be fixed first) |
| `Decimal("3.14159…")` exact-decimal literals (49 entries) | exact rationals / strings | lossless |
| `Parentheses/Brackets/Braces` (123 entries) | **strip during translation** | pure display |

### The hard constructs (~15 symbols, all solvable at translation time)

- **`Where(body, Def(x, val), …)`** — 196 entries. Local definitions with
  destructuring (`Def(Tuple(d,u,v), XGCD(a,b))`), indexed families, and *local
  function definitions* (`Def(f(z), z+a)`). CE has `Block` (sequential, scoped) but no
  mathematical "where." **Recommendation:** substitute at translation time when the
  definition is a plain value (most cases); skip or specially tag the ~dozen entries
  with local function definitions. A first-class `Where` in CE is optional polish, not
  a prerequisite.
- **`For(z, z0, k)` inside `ComplexDerivative`** — means (variable, point, order).
  Maps to CE's `D`/derivative forms with argument reshuffling.
- **Typed limit/derivative variants** (`RealLimit`, `ComplexLimit`, `LeftLimit`,
  `MeromorphicLimit`, `ComplexBranchDerivative`…) — CE has one `Limit`/`D`. Collapse
  to base operator + an annotation argument; the distinction only matters if/when CE
  ever computes symbolic limits.
- **`Repeat`/`Step` variadic splices** — 9 entries (Carlson elliptic). Skip them.
- **Formal indeterminates / power-series domains** (`XX`, `Pol`, `SerX`,
  `PowerSeries(RR, x)`) — small entry count, no CE analogue. Skip.
- **Set-valued property operators** (`Poles`, `Zeros`, `BranchPoints`, `BranchCuts`,
  `Residues` with generator syntax) — ~242 entries. Translate into a *metadata side
  table*, not into expressions (see §4, Feature E).
- **Quantifiers** (`All`, `Exists`) — appear mostly inside Assumptions. CE's
  `ForAll`/`Exists` exist but are inert (enumerate finite domains only). For rule
  guards, translate quantified assumptions into per-binding predicate checks where
  possible; otherwise mark the entry's guard as "engine cannot discharge" and exclude
  it from the active ruleset (keep it in the data with a flag).

### Translator architecture

Write the translator **in Python inside the Fungrim repo** (a fork or a script that
imports `pygrim`): `all_entries` is already a live list of parsed `Expr` objects, and
`expr.py`'s `free_variables`/binding semantics are nontrivial to reimplement. Emit one
JSON file per topic with entries of the form:

```json
{
  "id": "d4b0b6",
  "formula": ["Equal", ["Sin", ["Arctan", "z"]], ["Divide", "z", ["Sqrt", ["Add", 1, ["Power", "z", 2]]]]],
  "variables": ["z"],
  "assumptions": ["Element", "z", ["SetMinus", "ComplexNumbers", ["Set", ["Negate", "ImaginaryUnit"], "ImaginaryUnit"]]],
  "class": "identity",
  "heads": ["Sin", "Arctan"],
  "guardLevel": "complex-domain"
}
```

The `class`, `heads` (for indexing), and `guardLevel` (how hard the assumptions are
to discharge: `none` / `real-simple` / `complex-domain` / `undischargeable`)
annotations are computed once, offline — they drive what each CE integration phase
actually loads.

**Validation:** port Fungrim's own strategy. `Expr.test()` validates entries by drawing
random values satisfying the assumptions and checking numerically. The translator
should round-trip every translated entry through CE (`ce.expr(json)`) and spot-check a
numeric instance with `N()` where CE can evaluate it. This doubles as a giant fuzz
corpus for CE itself — translating Fungrim will *find* CE bugs (the review already
shows what that looks like).

---

## 3. What CE Already Has Going For It

- **Rule format fits.** CE rules are `{match, replace, condition}` with MathJSON
  patterns, named wildcards (`_x`, `__x`, `___x`), commutative matching, and guards —
  the same shape as a Fungrim entry (formula LHS→RHS + assumptions). Object-form rules
  are pure JSON and shippable as data (`rules.ts`, `types-kernel-evaluation.ts:145`).
- **Guards consult assumptions.** Rule conditions like `(sub) => sub._a.isPositive`
  go through the same sign/type/assumptions machinery the engine uses everywhere.
  Fungrim's most common assumption shapes — `Element(x, RR)`, `Element(n, ZZ)`,
  `x > 0`, `NotEqual(z, 0)` — are *already representable and dischargeable*.
- **Solve is already a Fungrim-shaped database.** `UNIVARIATE_ROOTS` (`solve.ts:59`)
  is a list of pattern rules with conditions — exactly the form of Fungrim's
  "transcendental equations" sections (e.g. atan.py's `Tan(Atan(z)) = z`,
  `Atan(x) = c → x = Tan(c)`). These entries are the lowest-friction, highest-value
  import target.
- **Value tables work today.** ~437 specific-value entries (`Gamma(1/2) = √π`, theta
  constants, ζ values) translate directly into indexed lookup rules or into library
  `evaluate` fast paths. No new machinery needed.
- **The library bootstrap is the right loading vehicle.** `new ComputeEngine({
  libraries: [...] })` with `LibraryDefinition = {name, requires, definitions}` gives
  dependency-ordered, opt-in loading — a `fungrim` library (or several:
  `fungrim-core`, `fungrim-elliptic`, …) slots in naturally.

---

## 4. New CE Features Required (beyond REVIEW.md fixes)

Ordered by how hard they gate the project. REVIEW.md items that directly matter here:
A3 (inequality predicates returning wrong definitive answers — guards would misfire),
A1 (`cmp()` eq-handler bug), E7 (`.simplify()` inside rules), B13 (equation-equality
sampling), and the rule-scan performance items. Fix those first; they're prerequisites,
not part of this estimate.

### A. Operator-indexed rule dispatch — **required, moderate effort**

`replace()` iterates every rule in a set per node per fixed-point iteration
(`rules.ts:929`). At 1,500+ imported rules this is unusable. CE's own mitigation
pattern (functional rules with an `if (operator !== X) return undefined` bailout)
points at the fix:

- Build a `Map<operator, Rule[]>` index keyed on the match pattern's head, populated
  at rule-set boxing time.
- Either expose this as a first-class indexed rule store, or register the Fungrim
  corpus behind a *single functional dispatcher rule* that does the Map lookup
  (works today with zero API changes — a good Phase-1 shim).

Related: the **1.3× cost gate** (`simplify.ts:206`) silently discards rule results
that grow the expression unless the rule id is on a hard-coded whitelist. Imported
identities need either (a) curation so only genuinely "simplifying" directions are
loaded as simplify rules, or (b) a per-ruleset cost policy / purpose tag
(`simplify` vs `expand` vs `transform`) so series expansions and argument
transformations are reachable via `expr.replace()` without fighting the gate.

### B. Assumption-system extension — **the crux, the largest engine work**

What Fungrim guards need vs. what CE can do today:

| Guard shape | Frequency | CE today |
|---|---|---|
| `Element(x, RR/ZZ/QQ/CC)`, sign conditions, `NotEqual(z, 0)` | very common | ✅ works |
| `Element(n, ZZGreaterEqual(1))` (= integer ≥ 1) | 582 entries | ⚠️ representable as `integer` + inequality, but `assume()` only handles one symbol vs constant; needs the composed form to work reliably |
| `Element(tau, HH)` (upper half-plane), `Greater(Re(z), 0)`, `Less(Abs(q), 1)` | very common in the function families that are Fungrim's core strength (theta, modular, hypergeometric) | ❌ `assume()` throws on unknown sets; `Re(s) > 1` mis-declares `s` as real (`assume.ts:402`) |
| `Element(z, SetMinus(CC, Set(...)))` (domain minus branch points) | common | ❌ not representable |
| Quantified guards (`All(..., ForElement(k, Range(1,n)))`) | rare (~50) | ❌ skip |

Minimum viable extension (enables the complex-domain half of the corpus):

1. **Structural predicates over `Re`, `Im`, `Abs`, `Arg` of a symbol** — let
   `assume(Greater(Re(s), 1))` store and be queried without retyping `s` as real,
   and teach the guard machinery (`getSignFromAssumptions` or a sibling) to answer
   `Re(s) > 1`, `Abs(q) < 1` from assumptions and from literal values.
2. **Set-membership facts for non-primitive sets** — keep `Element(x, <set expr>)`
   as a queryable fact (with `SetMinus`/`Union`/`Interval` membership evaluation,
   which `library/sets.ts` mostly has) instead of throwing when it doesn't map to a
   type. `HH` itself is just sugar for `Im(τ) > 0`.
3. **Guard evaluation = `verify()` with three-valued outcome** — rules fire only on
   definite `true`. This is consistent with CE's existing tri-valued predicates; it
   just needs the two representability items above to say `true` more often.

This is genuinely the long pole: Fungrim's brain.py is 6,400 lines largely because of
assumption discharge (backed by Arb interval arithmetic for the numeric cases). CE
doesn't need that depth — a structural-predicate layer covers the bulk of guard
shapes — but without items 1–2, every theta/modular/hypergeometric entry is dead
weight.

### C. Function-coverage expansion — **mechanical but wide**

Fungrim references ~150 special functions; CE has roughly the elementary tier
(Gamma/GammaLn/Digamma/Beta/Erf/Zeta/Bessel/Airy/LambertW, all N()-only) and is
missing entirely: **hypergeometric (0F1/1F1/2F1/pFq), elliptic integrals (K/E/F/Π),
Carlson forms, Jacobi theta, Dedekind eta, modular j/λ, Eisenstein series,
Weierstrass ℘, Hurwitz zeta, Dirichlet L/eta, polylogarithm, Lerch Φ, AGM, Barnes G,
orthogonal polynomials as named functions (ChebyshevT/U, LegendreP, HermiteH,
LaguerreL), Hankel, Coulomb, Stirling first kind, PrimePi, general DivisorSigma.**

Tiered approach:

- **Tier 1 (data-only, cheap):** `ce.declare()` symbolic shells with signatures for
  every referenced head — expressions become representable, serializable to LaTeX,
  and usable in rules. The translator emits this declaration table automatically from
  Fungrim's 228 `SymbolDefinition` entries (which include type/domain tables).
- **Tier 2 (selective JS):** numeric `evaluate`/`N()` kernels for the high-value
  subset (2F1, elliptic K/E, AGM, theta — AGM gives K/E nearly free; theta gives
  eta/modular forms). Note Fungrim itself provides series/AGM representations *as
  entries* that can guide the implementations.
- **Tier 3 (optional):** sgn/type/derivative handlers fed *from the imported data*
  (e.g. Fungrim's holomorphicity and derivative entries) rather than hand-written.

### D. Solve-rule extension API — **small, high value**

`UNIVARIATE_ROOTS` and `HARMONIZATION_RULES` are module constants with **no public
extension API** (unlike `ce.simplificationRules`). Add `ce.solveRules` (same
push/replace pattern, same cache invalidation). Then Fungrim's "transcendental
equations" and inverse-function sections import directly as solve templates.
Optional follow-on: a representation for general solution families (`x = tan(c) + πn`)
— CE currently returns principal solutions only (`solve.ts:434` acknowledges this).

### E. Analytic-property metadata store — **new concept, deferrable**

The ~266 set-valued property entries (poles, zeros, branch points/cuts, residues,
holomorphic domains) don't fit the rule model. Proposal: a per-operator metadata table
(loaded with the library) that the engine can query —
`ce.functionProperties('Gamma').poles → ZZ≤0` — and that feeds:
- domain guards for simplification (don't rewrite across a branch cut),
- `N()` domain checks (poles → ComplexInfinity instead of garbage),
- future symbolic limit/residue work.

Nothing in CE consumes this today, so it's Phase-3 material — but the translator
should extract it from day one since it's cheap to carry.

### F. Minor gaps

- **`Where` construct**: handle at translation time (substitute); first-class support optional.
- **`AlgebraicNumbers` set**, `ZZp/QQp`, lattices, `SL2Z`: declare as inert set
  symbols; only membership facts about them need to work (and only for the modular
  topics).
- **`UnsignedInfinity`/`Undefined` conventions**: document the mapping to
  `ComplexInfinity`/`NaN` and audit the ~handful of entries where the distinction is
  load-bearing.
- **Multi-argument `Equal` chains**: expand in the translator.

---

## 5. Proposed Phasing

| Phase | Content | Engine prerequisites | Payoff |
|---|---|---|---|
| **0. Translator + shells** | Python translator in fungrim fork; JSON corpus with class/heads/guardLevel annotations; `ce.declare` shell table for ~150 heads; round-trip validation harness | REVIEW.md fixes A1, A3 (guards), E7 | Corpus exists, versioned, testable; CE can *represent* everything |
| **1. Value tables + real-domain identities** | ~437 specific values + the `guardLevel ∈ {none, real-simple}` slice of the ~1,185 identities (likely 400–600 rules), loaded behind an operator-indexed dispatcher; curated direction per identity (complexity heuristic, as Fungrim's brain does) | Feature A (indexing; the functional-dispatcher shim suffices) | Visible simplification wins (special values, inverse-trig/log identities, argument transformations) with no assumption-engine work |
| **2. Solve knowledge** | Transcendental-equation and inverse-function entries → solve templates | Feature D (`ce.solveRules`) | Equation solving expands beyond the current hand-coded list |
| **3. Complex-domain rules** | The `complex-domain` guard slice (theta, modular, hypergeometric, gamma reflection/multiplication, …) | Feature B (assumptions extension), parts of C Tier 2 | The mathematically deep half of the corpus activates |
| **4. Properties & representations** | Analytic-property metadata store; series/integral representations exposed via an `expand`/`representations` API rather than simplify; bounds for future interval work | Features E, A cost-policy | Branch-cut-safe simplification, representation lookup, groundwork for symbolic limits |

Rough effort feel (excluding REVIEW.md fixes): Phase 0 ≈ 2–3 weeks; Phase 1 ≈ 2–3
weeks (mostly curation + the dispatcher); Phase 2 ≈ 1 week; Phase 3 is the big one —
the assumptions extension is open-ended but a useful core is ~3–4 weeks; Phase 4
incremental. Phases 0–2 deliver standalone value even if 3–4 never happen.

---

## 6. Risks & Open Questions

- **Rule direction is not in the data.** Fungrim deliberately stores undirected
  equalities; its brain orients them per-use with a complexity heuristic. Bulk-loading
  both directions doubles the set and risks rewrite loops (CE's dedup/step guards help
  but weren't designed for adversarial rule sets). Curation — even just "LHS→RHS iff
  RHS is structurally smaller, else register under `expand`" — is unavoidable.
- **Guard discharge failures are silent.** A rule whose condition can't be decided
  simply never fires; users see "nothing happened." The `guardLevel` annotation should
  drive what gets loaded so the active set is honest about what it can actually do.
- **Fungrim is a frozen pre-alpha snapshot.** The language spec says it will change;
  entry IDs are stable but semantics of a few constructs may drift vs fungrim.org.
  Pin the snapshot hash in the data package and keep the translator re-runnable.
- **Verification will surface CE bugs.** Random-instance testing of 2,700 formulas
  against CE's `N()` will hit the numeric issues in REVIEW.md (complex pow/inv,
  BigDecimal exp/ln, Arctan2 quadrant…). That's a feature — but budget for triage,
  and fix the REVIEW.md numerics first or the validation signal will be noise.
- **Performance ceiling.** Even indexed, 1,500 active rules with guard evaluation per
  candidate match has a cost. Mitigations: per-head rule counts are naturally small
  (the corpus is spread over ~150 heads); guards short-circuit on type info before
  touching assumptions; and the library split (`fungrim-core` vs per-family packages)
  lets users load only what they use.
- **Scope discipline (per project memory):** consumers wanting Fungrim-flavored
  behavior beyond rules — e.g. domain-specific notations — should translate at their
  boundary; CE should absorb the *mathematical* content only.

---

## 7. Bottom Line

The data model alignment is unusually good — Fungrim is, in effect, a MathJSON corpus
that happens to be written in Python — and the MIT license removes all friction. The
translation itself is a bounded, low-risk project that immediately yields a
high-quality test corpus and a specific-values/identities payload CE can use with only
one new mechanism (indexed rule dispatch). The strategic decision is **Feature B**:
extending the assumption system to complex-plane constraints is what separates "CE
ships a nice identity table" from "CE can actually wield a special-functions
grimoire." Phasing it last-but-one keeps that decision reversible while the cheap
phases prove out the pipeline.
