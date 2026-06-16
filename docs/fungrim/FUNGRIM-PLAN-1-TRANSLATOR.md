# Implementation Plan — Track 1: Fungrim → Compute Engine Translator + Corpus Pipeline

**Scope:** Phase 0 of `docs/fungrim/FUNGRIM.md` §5 — the Python translator, the JSON corpus with `class`/`heads`/`guardLevel` annotations, the auto-generated symbol-shell declaration table, the CE-side validation harness, and packaging/versioning. No engine features (rule dispatch, assumption extensions) are in scope; this track only has to make the corpus *exist, be honest about itself, and be loadable/boxable by CE*.

**Sources verified during planning:**
- Fungrim snapshot at `/Users/arno/dev/fungrim-master`: `pygrim.formulas.all_entries` imports cleanly under `python3` and yields **3,130 entries, 2,764 with `Formula`, 228 with `SymbolDefinition`** (matches docs/fungrim/FUNGRIM.md §1).
- **292 distinct builtin heads** actually occur inside `Formula(...)` expressions (docs/fungrim/FUNGRIM.md's "~330 incl. assumptions" is consistent).
- Assumption-condition head census (after flattening `And`): `Element` 3,647, `NotElement` 181, `Greater` 132, `NotEqual` 109, `Or` 85, `Less` 72, `GreaterEqual` 34, `All` 24, `LessEqual` 15, `Equal` 15, plus a tail (`IsHolomorphic` 7, `Divides` 5, `Where` 2, `CongruentMod` 1, …).
- `Element` domain census: `CC` 1,373, `ZZGreaterEqual` 616, `ZZ` 373, `HH` 348, `SetMinus` 329, `RR` 184, `OpenInterval` 128, `ClosedOpenInterval` 68, `DirichletGroup` 42, …, `SL2Z` 18, `PP` 14. These numbers directly drive the `guardLevel` classifier below.
- CE names verified against `/Users/arno/dev/compute-engine/src/compute-engine/library/*.ts` (details in the mapping table, §2.2).

---

## 1. Deliverables Overview & Milestone Map

| # | Milestone | Depends on | Effort | Output |
|---|---|---|---|---|
| M0 | Risk spike: 15 hard constructs | — | 2–3 days | throwaway notebook/script + decisions log |
| M1 | Core translator: walker, symbol map, MathJSON emitter | M0 | 3–4 days | `Add/Mul/Sin/Gamma/...` entries translate end-to-end |
| M2 | Structural constructs + failure policy | M1 | 4–5 days | full corpus pass: every entry → JSON record or skip record |
| M3 | Annotations: `class`, `heads`, `guardLevel` + report | M2 | 2–3 days | annotated per-topic JSON files |
| M4 | Symbol-shell declaration table | M1 (parallel w/ M2–3) | 2 days | `declarations.json` |
| M5 | CE validation harness (box + optional numeric) | M2 (corpus exists) | 3–4 days | `scripts/fungrim/validate.ts` + report |
| M6 | Packaging, manifest, license, regeneration docs | M3–M5 | 1–2 days | `data/fungrim/` layout + `MANIFEST.json` |

Total ≈ 2.5–3.5 weeks, matching the docs/fungrim/FUNGRIM.md Phase-0 estimate. M4 can run in parallel with M2/M3; M5 can start against the partial M1 corpus to shake out the harness early.

---

## 2. Deliverable 1 — Python Translator (in the fungrim fork)

### 2.1 Module layout

Lives in the fungrim fork as a sibling package to `pygrim`, so `from pygrim.formulas import all_entries` works unmodified:

```
/Users/arno/dev/fungrim-master/
  grim2mathjson/
    __init__.py
    cli.py            # python -m grim2mathjson --out <dir> [--topic atan] [--strict]
    mapping.py        # SYMBOL_MAP, SKIP_HEADS, METADATA_HEADS tables (data, no logic)
    walker.py         # Expr -> MathJSON recursive translator core
    structural.py     # Where/Def, For/ForElement, Cases, chains, Subscript, Decimal
    classify.py       # class taxonomy, guardLevel, heads extraction
    shells.py         # SymbolDefinition -> declarations.json generator
    properties.py     # Poles/Zeros/BranchPoints/... -> properties side table
    emit.py           # per-topic JSON writers, deterministic ordering, manifest
    report.py         # skip/failure ledger, summary statistics
    tests/
      test_atoms.py test_mapping.py test_structural.py test_golden.py
      golden/         # ~30 hand-checked entry translations (incl. d4b0b6)
```

Key implementation choices:

- **Walk `all_entries` directly.** Each `Entry` is an `Expr` with `ID`, `Formula`, `Variables`, `Assumptions`, `References` sub-args, retrievable via `entry.get_arg_with_head(...)` (`pygrim/expr.py:1286-1295`). Topic membership comes from `all_topics` (`Topic`/`Entries` IDs, `expr.py:1279-1295`); entries referenced from multiple topics are emitted once, into the topic of their defining source file (recoverable via `pygrim/formulas/__init__.py` module attribution), with a `topics: [...]` cross-reference list.
- **Reuse, don't reimplement, binding semantics.** `Expr.free_variables()` (`expr.py:303-394`) gives the `variables` field directly (and validates the `Variables(...)` declaration against it — mismatches are flagged). `Expr.replace(..., semantic=True)` (`expr.py:396-490`) performs the capture-avoiding substitution needed for `Where` elimination, including destructuring `Def(Tuple(...))` and local-function `Def(f(x), ...)` cases — this is exactly the "nontrivial to reimplement" machinery the feasibility doc warned about.
- **Emit non-canonical MathJSON.** The translator's output is *source form*: `["Subtract", a, b]`, `["Negate", x]`, raw `["Interval", ["Open", a], b]` etc. CE's `ce.expr()` does canonicalization; the corpus should stay diff-stable and human-readable.
- **Integers** emit as JSON numbers when within the IEEE-754 safe-integer range, else as `{"num": "<digits>"}` (per `MathJsonNumberObject`, `src/math-json/types.ts:100`). `Decimal("...")` literals emit as `{"num": "..."}` — lossless.
- **Determinism:** stable key order, sorted entries by ID within topic, `\n` line endings, so regeneration produces byte-identical files when nothing changed.

### 2.2 Symbol-mapping table (`mapping.py`)

One flat `SYMBOL_MAP: dict[str, str]` for pure renames, verified against CE sources. Highlights (CE names confirmed in the listed files):

| Fungrim | CE (verified) | Where verified |
|---|---|---|
| `Add, Mul, Div, Pow, Sub, Neg, Pos` | `Add, Multiply, Divide, Power, Subtract, Negate, (strip)` | `library/arithmetic.ts` |
| `Inv(x)` | `["Divide", 1, x]` (CE `Inverse` is matrix inverse) | `linear-algebra.ts` |
| `Atan, Asin, Acos, Asec, Acot, Acsc` | `Arctan, Arcsin, Arccos, Arcsec, Arccot, Arccsc` | `trigonometry.ts` |
| `Asinh, Acosh, Atanh, Asech, Acoth, Acsch` | `Arsinh, Arcosh, Artanh, Arsech, Arcoth, Arcsch` | `trigonometry.ts` |
| `Atan2(y,x)` | `Arctan2` | `trigonometry.ts:157` |
| `ConstI, ConstE, ConstGamma, ConstCatalan, Pi, GoldenRatio` | `ImaginaryUnit, ExponentialE, EulerGamma, CatalanConstant, Pi, GoldenRatio` | `arithmetic.ts:1448-1574` |
| `ConstGlaisher` | shell-declare (`Glaisher` not in CE) | — |
| `DoubleFactorial` | `Factorial2` | `arithmetic.ts:484` |
| `DigammaFunction, PolyGamma, LogGamma` | `Digamma, PolyGamma, GammaLn` | `arithmetic.ts` |
| `Floor, Ceil, Sign, Abs, Conjugate, Re, Im, Arg, Max, Min, GCD, LCM, Mod` | same / `Ceil`, `Real`, `Imaginary`, `Argument` | `arithmetic.ts`, `complex.ts` |
| `ZZ, QQ, RR, CC` | `Integers, RationalNumbers, RealNumbers, ComplexNumbers` | `sets.ts` |
| `PP` | `Primes` (verify; else shell) | — |
| `Element, NotElement, Union, Intersection, SetMinus, Subset, SubsetEqual, Set, PowerSet` | same names | `sets.ts`, `core.ts` |
| `Equal/NotEqual/Less/.../GreaterEqual, And/Or/Not/Implies/Equivalent` | same names | `relational-operator.ts`, `logic.ts` |
| `Cases/Otherwise` | `Which` (see §2.3) | `control-structures.ts` |
| `Det, Matrix, IdentityMatrix, ZeroMatrix` | `Determinant, Matrix, IdentityMatrix, ZeroMatrix` | `linear-algebra.ts` |
| `Fibonacci, Totient, BellNumber, Binomial, KroneckerDelta, StirlingS2→Stirling(?)` | exist (`number-theory.ts`, `combinatorics.ts`, `core.ts`); `MoebiusMu`, `LiouvilleLambda`, `DivisorSigma`, `PartitionsP` need shells (only `Sigma0/Sigma1/SigmaMinus1`, `NPartition` variants exist — decide alias vs shell in M0) | |
| `Infinity, -Infinity, UnsignedInfinity, Undefined` | `PositiveInfinity, NegativeInfinity, ComplexInfinity, NaN` | `arithmetic.ts` |
| `Erf, Erfc, Erfi` | `Erf, Erfc` (`statistics.ts:33`); `Erfi` shell | |
| `OpenInterval(a,b)` etc. | `["Interval", ["Open", a], ["Open", b]]` and half-open variants | `sets.ts:32-55` |
| `ZZGreaterEqual(a)` / `ZZLessEqual(b)` / `Range(a,b)` | `["Range", a, "PositiveInfinity"]` / `["Range", "NegativeInfinity", b]` / `["Range", a, b]` | `collections.ts` |

Everything in the 292-head census not mapped and not skipped (≈150 special-function heads: `JacobiTheta` (974 occurrences!), `RiemannZeta`→`Zeta`?, `HurwitzZeta`, `DedekindEta`, `EisensteinE/G`, `CarlsonR*`, `AGM`, `EllipticK/E/Pi`, `Hypergeometric*`, `ChebyshevT/U`, `ModularJ/Lambda`, `WeierstrassP/Zeta/Sigma`, `DirichletL`, `PolyLog`, `LerchPhi`, `BarnesG`, …) keeps its Fungrim name verbatim and is covered by the M4 shell table. Rule: **a head is either (a) mapped, (b) kept + shell-declared, (c) a structural construct, (d) metadata-extracted, or (e) on the explicit skip list. An unknown head is a translator error**, so new heads can never leak through silently.

### 2.3 Structural constructs (`structural.py`)

- **`Where(body, Def(x, val), ...)`** (197 occurrences): substitute right-to-left using `replace(semantic=True)`. Handles plain values and destructuring `Def(Tuple(d,u,v), XGCD(a,b))` by leaving the Tuple-valued def as a skip (no CE destructuring) *unless* the RHS is a literal `Tuple` (then componentwise substitution). Entries with **local function definitions** `Def(f(z), expr)` (~a dozen) and `Def(Tuple(f(i), For(i,1,n)), T)` indexed families: emit to the skip ledger with reason `where-function-def` (decision point: optionally translate `Def(f(z), e)` to a CE `["Function", e, "z"]` substitution — spike in M0, default skip).
- **`For` / `ForElement`** — three contexts, dispatched by parent head:
  1. `Sum/Product/Integral(body, For(k, a, b))` → `["Sum"/"Product"/"Integrate", body, ["Limits", "k", a, b]]` — matches `canonicalLimits` (`library/utils.ts:223-268`). A trailing condition argument (`Sum(1/p, For(p), Divides(...))`) becomes the indexing-set condition form CE's `canonicalIndexingSet` accepts (`["Element"/condition]`); verify exact accepted shape in M0 and emit that.
  2. `ForElement(k, S)` → `["Element", "k", S]` indexing set (`utils.ts:281+` preserves Element forms).
  3. `ComplexDerivative(f, For(z, z0, n))` → CE `D`/`Derivative` form — exact target shape is M0 spike #2.
- **`Cases(Tuple(v1, c1), ..., Tuple(vN, Otherwise))`** (115) → `["Which", c1, v1, ..., "True", vN]` (note the **argument-order swap**: Fungrim is (value, cond), `Which` is cond, value).
- **Multi-arg relation chains**: `Equal(a,b,c)` → `["And", ["Equal",a,b], ["Equal",b,c]]`; same for `Less/LessEqual/...` chains (M0 check: CE `Equal`/`Less` may already be n-ary chain-semantics — if so, pass through and simplify the translator).
- **`Parentheses/Brackets/Braces/AngleBrackets`** (≈140): strip, keep child.
- **`Subscript(z, k)` and generator-variable calls `z_(k)`**: translate to plain symbols when the index is a literal integer (`z_1` → symbol `z_1`); symbolic indices `z_(k)` → `["Subscript", "z_", "k"]` (CE `core.ts` has `Subscript`). The trailing-underscore family symbols (`z_`) are how Fungrim writes indexed families — normalize the name (`z_` → `z`) and record `indexedFamily: true` on the entry so consumers can treat it specially.
- **Typed limit/derivative variants** (`RealLimit, ComplexLimit, LeftLimit, RightLimit, SequenceLimit, MeromorphicLimit; RealDerivative, ComplexBranchDerivative, MeromorphicDerivative`): collapse to CE `Limit`/`D` and record the variant in an entry-level `"flavor"` annotation (not inside the expression) — per docs/fungrim/FUNGRIM.md the distinction only matters for future symbolic-limits work.
- **Skip list** (emit skip records, never expressions): `Repeat`, `Step` (9 Carlson entries), `XX/SerX/Pol*/PowerSeries/SeriesCoefficient/FormalGenerator` formal-indeterminate domains, `Ellipsis`, `EqualQSeriesEllipsis`, `CodeExample`, presentation heads (`Description`, `Table*`, `Image*`, `SourceForm`, …).
- **Metadata heads** (`properties.py`): formulas whose top-level shape is `Equal(Poles/Zeros/BranchPoints/BranchCuts/EssentialSingularities/Residue/AnalyticContinuation/ComplexZeroMultiplicity(...), S)` or `IsHolomorphic/IsMeromorphic(...)` → routed to `properties.json` keyed by operator (docs/fungrim/FUNGRIM.md §4-E says extract from day one). Their generator syntax (`Var`, `ForElement`) is preserved in a documented JSON micro-format rather than forced into MathJSON expressions.

### 2.4 Failure policy

Translation is **total**: for every entry in `all_entries` the pipeline produces exactly one of
- a corpus record (success),
- a `properties.json` record (metadata route), or
- a **skip record**: `{ "id", "topic", "reason": "<machine-readable code>", "heads": [unsupported heads], "source": "<Expr str()>" }` in `skipped.json`.

`report.py` prints a summary table (per reason-code counts, per-topic coverage %) and the build **fails in `--strict` mode if any entry hits the catch-all `unknown-head` reason** — only enumerated, deliberate skip codes are acceptable. Nothing is silently dropped; the skip ledger ships with the corpus so coverage claims are auditable.

---

## 3. Deliverable 2 — Output Format

### 3.1 Files

One file per topic source module (62): `corpus/atan.json`, `corpus/gamma.json`, … Each file:

```json
{
  "topic": "atan",
  "title": "Inverse tangent",
  "source": "pygrim/formulas/atan.py",
  "entries": [ ... ]
}
```

### 3.2 Entry schema (docs/fungrim/FUNGRIM.md §2, extended)

```json
{
  "id": "d4b0b6",
  "formula": ["Equal", ["Sin", ["Arctan", "z"]],
              ["Divide", "z", ["Sqrt", ["Add", 1, ["Power", "z", 2]]]]],
  "variables": ["z"],
  "assumptions": ["Element", "z", ["SetMinus", "ComplexNumbers",
                  ["Set", ["Negate", "ImaginaryUnit"], "ImaginaryUnit"]]],
  "class": "identity",
  "heads": ["Sin", "Arctan"],
  "guardLevel": "complex-domain",
  "flavor": null,
  "references": ["..."],
  "topics": ["atan"]
}
```

`assumptions` is `null` when absent; `variables` comes from `free_variables()` cross-checked against `Variables(...)`. `heads` = the set of *named function heads* (post-mapping) appearing in the formula, minus structural/arithmetic noise (the index that rule dispatch will key on; reuse Fungrim's own `exclude_symbols` notion at `expr.py:1232` as a starting blacklist).

### 3.3 `class` computation (`classify.py`)

Decision tree on the translated formula, in order:

1. Routed to properties table → class `analytic-property` (lives in `properties.json`, not corpus).
2. Top head not a relation (`Implies`, `Equivalent`, `Divides`, `CongruentMod`, `Exists`/`All`, `Iff` shapes) → `logical`.
3. Top head an inequality (`Less/LessEqual/Greater/GreaterEqual`, `Abs`-bound shapes, `AsymptoticTo`) → `inequality`.
4. Top head `Equal`:
   - zero free variables → `specific-value`;
   - either side's top head ∈ {`Sum`, `Product`, `Integrate`, `Limit` (post-collapse)} → `representation` (sub-tagged `series`/`integral`/`product`/`limit`);
   - otherwise → `identity`.
5. Anything else → `other` (counted; expected near-zero).

These thresholds reproduce the §1 taxonomy counts (~1,185 / ~437 / ~424 / ~248 / ~266 / ~194); the M3 acceptance test asserts the computed distribution is within ±10% of those measured numbers.

### 3.4 `guardLevel` computation

Flatten `assumptions` over `And`; classify each conjunct; the entry's level is the **max** over conjuncts of (`none` < `real-simple` < `complex-domain` < `undischargeable`):

| Conjunct shape | Level |
|---|---|
| (no assumptions) | `none` |
| `Element(x, ZZ/QQ/RR/PP/ZZGreaterEqual/ZZLessEqual/Range/real Interval)` with `x` a bare variable; `NotEqual/Less/.../Greater(x, c)` with real-constant `c`; `NotElement(x, ZZ…)`; `Odd/Even(x)`; `Divides(a,b)` over already-integer vars; `CongruentMod` | `real-simple` |
| `Element(x, CC/HH)`; predicates over `Re/Im/Abs/Arg(x)`; `Element(x, SetMinus(...))/Union/Set(...)` with complex content; `NotElement(x, complex set)` | `complex-domain` |
| `All`/`Exists` quantifiers; `Where` in assumptions; `IsHolomorphic`; `FormalGenerator`; membership in structural domains (`DirichletGroup`, `SL2Z`, `PSL2Z`, `PrimitiveDirichletCharacters`, `ModularGroupFundamentalDomain`, `Lattice`); `Or` whose branches differ in level (use max of branches, min `complex-domain`) | `undischargeable` |

The census above says this covers everything observed (3,647 `Element` + small tail); the classifier keeps an explicit table and errors on unrecognized conjunct heads rather than guessing.

---

## 4. Deliverable 3 — Symbol-Shell Declaration Table (`shells.py`)

Input: the 228 `SymbolDefinition(symbol, example, "description")` entries (registered via `make_entry`, `expr.py:1286-1295`), plus the same entry's domain/codomain `Table` (see `atan.py:159-190` for the canonical shape: rows `Tuple(Element(args, Domain), Element(f(args), Codomain))` under `TableRelation(Tuple(P,Q), Implies(P,Q))`).

Output `declarations.json`:

```json
{
  "JacobiTheta": {
    "fungrimId": "...",
    "description": "Jacobi theta function",
    "arity": 3,
    "signature": "(integer, complex, complex) -> complex",
    "domainTable": [ {"domain": [...], "codomain": [...]} ],
    "wikidata": null
  }, ...
}
```

- **Arity** from the `example` expression (`Atan2(y, x)` → 2). Variadic/optional arities (e.g. `JacobiTheta` with optional derivative order) detected by scanning actual call-site arities across the corpus — emit `"arity": [3, 4]` ranges.
- **Signature** inferred from the "Numbers" rows of the domain table via a small set→type map (`ZZ→integer`, `RR→real`, `CC→complex`, `ZZGreaterEqual(0)→integer`, …); rows mentioning power series/infinities are kept in `domainTable` but excluded from the primary signature. When the table is missing or unparsable, fall back to `(any+) -> any` with a `"signatureInferred": false` flag. Signature strings use CE's type syntax so they feed `ce.declare(name, {signature})` directly (`src/compute-engine/index.ts:1172-1190` accepts `Type | TypeString | Partial<SymbolDefinition>` and a batch object form — the JSON is shaped for the batch form).
- **Filtering:** only emit heads CE does *not* already define. The generator takes a `ce-known-symbols.txt` input produced by the M5 harness (dump of CE's global lexicon) so the two repos stay decoupled; anything CE knows is listed in a separate `"existing"` section for audit.
- **Wikidata:** Fungrim has no wikidata; provide a hand-curated optional overlay `wikidata-overrides.json` (start with the obvious ~30: Q371631 Jacobi theta, etc.) merged at generation time. Not a blocker.

---

## 5. Deliverable 4 — Validation Harness (in compute-engine)

Location: `/Users/arno/dev/compute-engine/scripts/fungrim/` (runner scripts, run via `npx tsx`, *not* part of the default jest suite) plus one lightweight jest smoke test later.

```
scripts/fungrim/
  validate.ts        # CLI: --corpus <dir> [--numeric] [--topic t] [--id xxxxxx] [--seed n]
  load.ts            # read corpus JSON + declarations.json, ce.declare() shells
  box-check.ts       # stage 1: ce.expr() every formula & assumptions
  numeric-check.ts   # stage 2 (--numeric): random-instance spot checks
  sample.ts          # some_values port: value pools + assumption filtering
  report.ts          # JSON + console report, diffable across runs
```

**Stage 1 — representability (always on):** for each entry, `ce.expr(entry.formula)` and `ce.expr(entry.assumptions)` with the shell declarations loaded; record per-entry outcome: `ok` / `box-error` (exception or `["Error", ...]` subexpression in the canonical form) / `unknown-symbol`. Also round-trip `boxed.json` and verify it re-boxes equal (catches canonicalization instability). Output `validation-report.json` with per-topic pass rates. This is the Phase-0 gate: **goal ≥ 99% of corpus entries box without errors.**

**Stage 2 — numeric spot checks (behind `--numeric`, since REVIEW.md numerics fixes are in flight):** a TypeScript port of the *strategy* of `Expr.test()` (`pygrim/expr.py:961-1039`) + `Brain.some_values()` (`pygrim/brain.py:5767-5862`):

- Fixed value pools per base set, mirroring Fungrim's `some_integers`/`some_rationals`/`some_reals`/`some_complexes`/`some_upper_half_plane` (small integers, ±1/2, `Sqrt(2)`, `Pi`, `1/2 + i/2`, `i`, `2i−1`, `τ = i`, `τ = (1+i√3)/2`, …) — exact MathJSON constants, not floats.
- For each entry with variables: derive each variable's base pool from its `Element` conjunct (the same dispatch as `some_values`, brain.py:5810-5841), iterate a seeded randomized cartesian product, keep assignments where `ce.expr(assumptions).subs(assignment).evaluate()` is definitively `True` (three-valued: skip `Unknown`), cap candidates.
- For each accepted assignment (default 5/entry): substitute into the formula; for `Equal` classes compare `N()` of both sides to relative tolerance 1e-10 at 30-digit precision; for inequalities check the relation numerically; record `True`/`False`/`Unknown` per instance, Fungrim-style.
- **A `False` instance flags the entry (likely a translation bug or CE numeric bug) but does not fail the build initially** — failures land in `numeric-failures.json` for triage, since docs/fungrim/FUNGRIM.md §6 predicts this doubles as a CE fuzz corpus. Entries whose heads have no CE numeric kernel are reported `not-evaluable` (expected for most special functions until Tier-2 work).

---

## 6. Deliverable 5 — Packaging & Versioning

**Recommendation: in-repo data directory, not a submodule or npm package (yet).**

```
/Users/arno/dev/compute-engine/data/fungrim/
  MANIFEST.json          # snapshot id/hash of fungrim-master, translator version,
                         # generation date, entry/skip counts, schema version
  LICENSE                # MIT, © 2019 Fredrik Johansson — full upstream notice
  README.md              # provenance, schema docs, regeneration instructions
  corpus/<topic>.json    # 62 files
  declarations.json
  properties.json
  skipped.json
  wikidata-overrides.json
```

Rationale: Track-1's consumer is the validation harness and Phase-1 curation work inside this repo; the corpus is ~ a few MB of JSON; `/data` keeps it versioned with the code that reads it without npm-publishing or submodule friction. Revisit as `@cortex-js/fungrim-data` when Phase 1 ships runtime loading (the per-topic file split already matches the future `fungrim-core`/`fungrim-elliptic` library split). Keep it out of the npm package `files` list until then.

- **Snapshot pinning:** the local `fungrim-master` is an unversioned snapshot — record a content hash (e.g. SHA-256 over sorted `pygrim/**/*.py`) in `MANIFEST.json` as the upstream pin; if the fork gets pushed to a git host, record its commit instead. Every corpus file embeds `"generator": "grim2mathjson <version>"`.
- **License propagation:** Fungrim's MIT notice copied verbatim into `data/fungrim/LICENSE`, referenced from `MANIFEST.json` and the data README; add an attribution line to the compute-engine top-level README/NOTICE when the data ships in a distributed artifact.
- **Regeneration workflow** (documented in the data README): `cd fungrim-master && python3 -m grim2mathjson --strict --out /Users/arno/dev/compute-engine/data/fungrim` → `cd compute-engine && npx tsx scripts/fungrim/validate.ts --corpus data/fungrim`. Deterministic output makes the diff the review artifact.

---

## 7. The 10–15 Riskiest Translations — Spike First (M0)

In priority order, each spiked against real entries before committing to the architecture:

1. **`Where` + `Def` substitution** (197 entries) — esp. destructuring `Def(Tuple(d,u,v), XGCD(a,b))`, indexed-family `Def(Tuple(f(i), For(i,1,n)), T)`, and local function defs. Decides the skip-vs-`Function`-literal policy.
2. **`For` inside `ComplexDerivative`** (148 occurrences) — (var, point, order) → CE `D`/`Derivative` shape; the chosen encoding must round-trip `ce.box`.
3. **`Sum`/`Product` with bare `For(p)` + separate condition arg** (`Sum(1/p, For(p), Divides(...))`) and `DivisorSum/PrimeSum/DivisorProduct/PrimeProduct` — what indexing-set + condition form does CE's `canonicalIndexingSet`/`canonicalBigop` actually accept today?
4. **`ForElement(k, S)` indexing sets** → `["Element", "k", S]` — confirm box-ability for non-enumerable `S`.
5. **Directed infinities**: `-ConstI*Infinity`, `ConstI*Infinity`, `Neg(Infinity)` and the `UnsignedInfinity`/`Undefined` → `ComplexInfinity`/`NaN` convention; audit the handful of entries where the distinction is load-bearing.
6. **`Cases`/`Otherwise` → `Which`** including nested `Cases` and missing-`Otherwise` (partial) cases — what value for the uncovered branch (`Nothing`? omit?).
7. **Subscripted/indexed variables** `z_(k)`, `Subscript(a, n)`, the `x_` trailing-underscore family symbols, incl. their appearance in `free_variables` (special-cased at `expr.py:323-327`).
8. **`JacobiTheta` variadic forms** (974 occurrences; optional 4th derivative-order argument) — arity handling in shells + corpus.
9. **Multi-arg relation chains** — confirm whether CE `Equal`/`Less` n-ary semantics match Fungrim chains or pairwise-`And` expansion is required.
10. **Interval family** → `["Interval", ["Open", a], b]` half-open encodings round-tripping `ce.box` (`sets.ts:32-55` suggests support; verify all four variants).
11. **`ZZGreaterEqual/ZZLessEqual/Range`** → CE `Range` with infinite endpoints — confirm boxing + `Element` over them.
12. **Set-valued property operators** (`Zeros`, `Poles`, `Solutions`, `UniqueSolution`, `BranchCuts` with `Var`/predicate generator syntax) — fix the `properties.json` micro-format on 5 real gamma/atan entries (`atan.py` "Analytic properties" section is a good testbed).
13. **Typed limit variants** (`LeftLimit`, `SequenceLimit`, …) → single `Limit` + `flavor` — check argument shapes against CE `Limit`/`Limits` (`calculus.ts`).
14. **`Matrix2x2` / matrix destructuring in `Where`** (modular-transformation topics, `Element(Matrix2x2(a,b,c,d), SL2Z)` assumptions).
15. **`RiemannZeta` 2-arg form / `Zeta` collision** and other near-name collisions (`BetaFunction` vs CE `Beta`, `Erf` in `statistics.ts`) — collision audit between Fungrim names kept verbatim and existing CE symbols with different semantics/arities.

---

## 8. Acceptance Criteria ("done") per Milestone

**M0 — Spike.** Each of the 15 items above has a written decision (mapping, encoding, or skip-code) recorded in `mapping.py`/`structural.py` docstrings; at least one real entry per item hand-translated and `ce.box`-verified via a scratch script.

**M1 — Core translator.** `python3 -m grim2mathjson --topic atan` emits `atan.json`; all atoms, arithmetic, elementary functions, constants, relations, sets translate; pytest golden tests pass for ≥20 hand-checked entries including `d4b0b6` matching the docs/fungrim/FUNGRIM.md §2 example byte-for-byte (modulo schema fields); unknown-head ⇒ hard error.

**M2 — Structural + totality.** Full `all_entries` run completes with **zero `unknown-head` failures**; every entry lands in corpus / properties / skip ledger; skip ledger ≤ ~10% of formula entries and every skip has an enumerated reason code; `Where`-substituted entries verified by golden tests; deterministic re-run produces identical bytes.

**M3 — Annotations.** `class` distribution within ±10% of docs/fungrim/FUNGRIM.md §1 table; `guardLevel` classifier errors on no conjunct (full coverage of observed shapes); summary report prints per-topic and per-level counts; spot-audit of 30 random entries (10 per non-trivial level) confirms labels.

**M4 — Shells.** `declarations.json` covers every head appearing in the corpus that CE doesn't define (cross-checked mechanically by the harness, not by eye); ≥80% of shells have a table-derived signature (rest flagged inferred); loading the full table via `ce.declare()` in the harness raises no errors.

**M5 — Harness.** `npx tsx scripts/fungrim/validate.ts` runs Stage 1 over the full corpus in < a few minutes; report shows ≥99% box-success (failures triaged into translator-bug vs CE-bug buckets); `--numeric --seed 42` reproducibly runs on the `guardLevel ∈ {none, real-simple}` slice and produces zero *untriaged* `False` instances; harness exit code reflects Stage-1 health for CI use.

**M6 — Packaging.** `data/fungrim/` populated with manifest, license, README; regeneration documented and exercised end-to-end once from a clean state; corpus excluded from npm `files`.

---

## 9. Open Questions Needing a Human Decision

1. **Corpus location:** in-repo `data/fungrim/` (recommended) vs separate `@cortex-js/fungrim-data` package vs git submodule — affects M6 only.
2. **`UnsignedInfinity` → `ComplexInfinity`, `Undefined` → `NaN` convention** — sign off, plus the directed-infinity (`c·∞`) encoding (no CE representation today; options: `["Multiply", c, "PositiveInfinity"]` passthrough vs skip).
3. **Where-with-function-defs (~12 entries):** skip, or translate `Def(f(z), e)` via CE `["Function", e, "z"]` substitution?
4. **Indexed-variable convention:** `z_(k)` → `["Subscript", "z", "k"]` vs synthesized symbol names — affects how Phase-1 rules will pattern-match families.
5. **Name collisions:** keep Fungrim `RiemannZeta`/`BetaFunction` verbatim (shells) or map onto CE `Zeta`/`Beta` where arities/semantics agree? (Mapping is better for rule utility; verbatim is safer. Recommend: map when semantics verified, case-by-case in M0.)
6. **n-ary relation chains:** rely on CE chain semantics if confirmed, or always expand pairwise (deterministic but noisier corpus)?
7. **`flavor` annotation for typed limits/derivatives:** entry-level field (proposed) vs in-expression annotation (e.g. `["Limit", ..., "left"]`)?
8. **Numeric-check failure policy once REVIEW.md numerics land:** when does `False` become build-failing?
9. **Skip-ledger budget:** is ~10% skipped acceptable for Phase-0 sign-off, or should specific topics (e.g. Carlson) be explicitly descoped instead?
10. **Translator runtime:** plain `python3` + stdlib (recommended — pygrim has no hard deps for `all_entries`) vs a managed venv with pinned tooling.

---

### Critical Files for Implementation

- `/Users/arno/dev/fungrim-master/pygrim/expr.py` — Expr model, `free_variables`/`replace` binding semantics (303–490), `test()` (961), builtin list (1059–1228), `all_entries`/`make_entry` (1279–1295)
- `/Users/arno/dev/fungrim-master/pygrim/brain.py` — `some_values()` sampler to port for the numeric harness (5767–5862)
- `src/compute-engine/library/utils.ts` — `canonicalLimits`/`canonicalIndexingSet` target shapes for `For`/`ForElement` translation (161–290)
- `src/compute-engine/library/arithmetic.ts` — verified CE names for constants/elementary operators (the rename table's ground truth, with trigonometry.ts and sets.ts)
- `src/compute-engine/index.ts` — `ce.declare()` overloads (1172–1190) the shell table must target
- `src/math-json/types.ts` — MathJSON encoding rules for numbers/symbols/functions (75–158)
