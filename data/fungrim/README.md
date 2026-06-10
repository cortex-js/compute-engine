# Fungrim Corpus for the Compute Engine

A machine-translated snapshot of the [Fungrim](https://fungrim.org) (Mathematical
Functions Grimoire) formula collection, expressed as MathJSON, annotated for
Compute Engine consumption. This is the Phase-0 deliverable of the Fungrim
integration plan (`docs/fungrim/FUNGRIM-PLAN-1-TRANSLATOR.md` at the repository root).

## Provenance

- **Upstream:** Fungrim by Fredrik Johansson, MIT licensed (see `LICENSE` —
  the upstream notice is reproduced verbatim; this data set is a *translated
  derivative*, not a copy, of the upstream Python sources).
- **Source pin:** the corpus is generated from the published fork
  [`arnog/fungrim`](https://github.com/arnog/fungrim) (branch
  `grim2mathjson`); `MANIFEST.json` records the fork commit, the upstream
  parent commit it mirrors (`pygrim/` content verified identical by recursive
  diff), and a belt-and-braces content hash: SHA-256 over the concatenation of
  all `pygrim/**/*.py` files sorted by path.
- **Translator:** `grim2mathjson` (lives in the fungrim fork as a sibling
  package to `pygrim`). Every emitted file embeds a
  `"generator": "grim2mathjson <version>"` field.
- **Determinism:** the translator emits stable key order, entries sorted by id
  within topic, and `\n` line endings — regeneration produces byte-identical
  files when nothing changed, so the diff is the review artifact.

## Files

| File | Contents |
|---|---|
| `MANIFEST.json` | schema version, generation date, upstream pin, counts |
| `corpus/<topic>.json` | 57 per-topic files, 2,551 annotated formula entries |
| `declarations.json` | 152 symbol-shell declarations for heads CE does not define |
| `properties.json` | 131 analytic-property records (Poles, Zeros, BranchCuts, …) |
| `skipped.json` | full skip ledger: 448 records with machine-readable reason codes |
| `LICENSE` | upstream MIT license |

## Entry schema (`corpus/<topic>.json`)

Each topic file is `{ "topic", "title", "source", "generator", "entries": [...] }`.
Each entry:

```json
{
  "id": "d4b0b6",                  // Fungrim entry id (stable, 6 hex chars)
  "formula": ["Equal", ...],       // non-canonical MathJSON (source form)
  "variables": ["z"],              // free variables, from Expr.free_variables()
  "assumptions": ["Element", ...], // MathJSON; null when the entry has none
  "assumptionAlternatives": [...], // OPTIONAL (27 entries): alternative assumption sets, see below
  "class": "identity",             // taxonomy, see below
  "subclass": null,                // for class=representation: series|integral|product|limit
  "heads": ["Sin", "Arctan"],      // named function heads (post-mapping), the rule-dispatch index
  "guardLevel": "complex-domain",  // assumption-discharge difficulty, see below
  "flavor": null,                  // typed limit/derivative variant: real|complex|left|right|sequence|meromorphic
  "references": null,              // upstream literature references, when present
  "topics": ["atan"],              // all topics referencing the entry (first = defining module)
  "directedInfinity": true,        // OPTIONAL (26 entries): formula contains c·∞; CE evaluates
                                   //   Multiply(c, PositiveInfinity) to NaN — exclude from numeric checks
  "indexedFamilies": ["a_"]        // OPTIONAL (5 entries): trailing-underscore family heads used
                                   //   in call form ["a_", k] to preserve binder scoping
}
```

### `assumptionAlternatives`

Upstream `Assumptions(expr, alt_expr, ...)` with multiple args states
**alternative** assumption sets — the formula holds under each set
independently (pygrim renders args past the first as "Alternative
assumptions"). They are NOT conjoined: 16 of the 27 affected entries would
otherwise produce genuinely contradictory conjunctions (e.g. `sqrt/0d8e03`:
`b ∈ (0,∞)` AND `b ∈ ℂ∖(−∞,0]`). The first set is the entry's primary
`assumptions`; the remaining sets are emitted under the optional
`assumptionAlternatives` array (same translation pipeline per alternative).
`guardLevel` is computed from the primary set only.

### `class` taxonomy

- `specific-value` — `Equal` with zero free variables (e.g. ζ(2) = π²/6)
- `identity` — `Equal` between closed forms with variables
- `representation` — `Equal` whose side is a `Sum`/`Product`/`Integrate`/`Limit`
  (sub-tagged via `subclass`)
- `inequality` — top head `Less`/`LessEqual`/`Greater`/`GreaterEqual`/`AsymptoticTo`-like
- `logical` — top head `Implies`/`Equivalent`/`Element`/quantifier shapes
- `other` — residual (2 entries)

### `guardLevel` semantics

Difficulty of discharging the entry's assumptions, the max over the flattened
`And` conjuncts (`none` < `real-simple` < `complex-domain` < `undischargeable`):

- `none` — no assumptions
- `real-simple` — memberships in integer/rational/real sets or intervals over
  bare variables, simple real inequalities, parity, divisibility
- `complex-domain` — membership in ℂ/ℍ, predicates over `Re/Im/Abs/Arg`,
  complex set algebra (`SetMinus`, `Union`, …), and plain-symbol membership
  in inert shell sets (`DirichletGroup(q)`, `SL2Z`, lattices, symbolic sets,
  …) — dischargeable via CE stored-membership facts (Track 3; verified by
  the `scripts/fungrim/guard-census.ts` measurement)
- `undischargeable` — quantifiers, `Where` in assumptions, holomorphy
  predicates, Riemann-hypothesis atoms, indexed-family memberships, and
  structural objects in *term* position (`Matrix(...) ∈ SL2Z`, lattice
  bounds inside `Infimum`, `DirichletCharacter` comparisons, …)

## `declarations.json`

`{ "generator", "declarations": { <name>: {...} }, "existing": { <name>: {...} } }`.
Each declaration record carries `fungrimId`, `description`, `arity`
(number or `[min, max]`), `signature` (CE type syntax, feeds `ce.declare()`
directly), `signatureSource`/`signatureInferred`, `domainTable`, `wikidata`.
The `existing` section audits heads CE already defines (not declared by the
harness), including the **LambertW note**: CE's `LambertW` is 1-arg (principal
branch) while the corpus emits 2-arg `["LambertW", z, k]` for non-principal
branches — consumers must re-declare `LambertW: (complex, integer?) -> complex`
in a child scope before boxing (the validation harness does this).

## `skipped.json` reason codes

Translation is total: every upstream entry lands in the corpus, in
`properties.json`, or here. Codes:

| code | meaning |
|---|---|
| `symbol-definition` | entry defines a symbol (no `Formula`) — feeds `declarations.json` |
| `tuple-indexing-set` | `ForElement(Tuple(...), S)` index — no CE encoding |
| `where-def-tuple` | `Where` with `Def(Tuple(...), <non-literal>)` destructuring |
| `where-function-def` | `Where` local function def that could not be beta-reduced |
| `where-recursive-def` | `Where` with a self-referential function def |
| `formal-indeterminate` | formal power-series indeterminates (`XX`, `SerX`, …) |
| `generator-list` | list/tuple-generator syntax with no MathJSON encoding |
| `matrix-generator` | matrix built from a generator expression |
| `repeat-splice` / `step-splice` | `Repeat`/`Step` argument splices (Carlson topics) |
| `ellipsis` | literal `Ellipsis`/`EqualQSeriesEllipsis` |
| `path-integral` | integral over a path object |

## Validation

The CE-side harness lives at `scripts/fungrim/` (repository root):

```sh
# Stage 1 (always): shell-declare, type-declare variables, box every entry
npx tsx scripts/fungrim/validate.ts --corpus data/fungrim

# Stage 2: seeded numeric spot checks on the none/real-simple guard slice
npx tsx scripts/fungrim/validate.ts --corpus data/fungrim --numeric --seed 42
```

Reports are written to `scripts/fungrim/validation-report.json` (and
`numeric-failures.json` for Stage-2 `False` instances, which are triage input,
not build failures).

## Regeneration workflow

From a clean state:

```sh
# 0. Get the translator + source (once)
gh repo clone arnog/fungrim ~/dev/fungrim   # branch grim2mathjson is the default

# 1. Re-run the translator (check out the MANIFEST.json commit for an exact
#    reproduction, or HEAD of grim2mathjson for a refresh)
cd ~/dev/fungrim
python3 -m grim2mathjson --strict --out grim2mathjson/out

# 2. Copy the artifacts into this directory
cd /Users/arno/dev/compute-engine
cp -R ~/dev/fungrim/grim2mathjson/out/corpus data/fungrim/corpus
cp ~/dev/fungrim/grim2mathjson/out/{declarations,properties,skipped}.json data/fungrim/

# 3. Update the provenance in MANIFEST.json: the fork commit
#    (git -C ~/dev/fungrim log -1 --format=%H), and the content hash:
(cd ~/dev/fungrim && find pygrim -name '*.py' -type f | LC_ALL=C sort | xargs cat | shasum -a 256)

# 4. Validate, then recompile the rule artifact
npx tsx scripts/fungrim/validate.ts --corpus data/fungrim
npx tsx scripts/fungrim/compile-rules.ts
```

The output is deterministic; review the git diff of `data/fungrim/` as the
change artifact. This directory is intentionally **not** part of the npm
package (`package.json` `files` is `["/dist"]`); revisit as
`@cortex-js/fungrim-data` when Phase 1 ships runtime loading.
