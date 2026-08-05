# Equality tiers: `Same` / `Equal` / `IdenticallyEqual` — design + caller audit

**Status: design RATIFIED 2026-08-04 (naming, surfaces, and semantics below);
audit complete; ready for phased implementation.**
Context: `Equal` evaluation currently routes through `eq()`
(`boxed-expression/compare.ts`), whose free-variable branch is a prover —
stochastic sampling (a js-compile + ~50 point evaluations) with an
expand+simplify fallback. Proposal under study: `=` downgrades to arithmetic
equality (evaluate → structural `isSame` → tolerance compare of a
no-unknowns difference → otherwise inert), and the prover moves behind an
explicit "identical" operator / the `.isEqual()` API.

## Empirical blast measurement

Experiment: `eq()`'s free-variable branch replaced by `return undefined`
(no sampling, no expand/simplify) — i.e. the cheap semantics — then the full
suite was run. Result:

- **12 failed / 23,681 tests · 0 snapshot churn** (5 suites: `equal`,
  `stochastic-equal`, `arithmetic`, `trigonometry`, `latex-syntax/parsing`).
- **Every failure is a direct test of the prover** (`.isEqual()` asserts:
  `sin²x+cos²x = 1`, `(x+1)² = x²+2x+1`, `x·x = x²`, `(x²-1)/(x-1) = x+1`,
  tolerance-level function comparison, `sin(2)+x = 0.909…+x`). Under the
  split these migrate verbatim to the deep operator's suite.
- **Zero indirect consumers broke**: no piecewise/`Which`, no set membership,
  no `Solve`, no Wester, no simplify-rule, no assumptions test.
- **One wrong-`false` (not just weaker)**: `2(13.1+x)<(10-5)` vs `26.2+2x<5`
  — the relation-vs-relation equivalence handler
  (`relational-operator.ts` `eq:` handler) mishandles an undecided pair
  compare. It must be routed to the deep prover explicitly, not left on
  cheap `=`.

Key structural finding: **`Equal` evaluation is already inert on
undecidable** (deliberate — the 0.72.0-era fix that stopped collapsing
equations to `False` before `Solve`). The deep machinery only hunts for a
provable `True`/`False` first. So the flip changes two things only: symbolic
identities stop evaluating to `True`, and every evaluation attempt stops
paying the prover.

## Caller dispositions

**CHEAP (inherit the new `=`):**

| Site | Rationale |
| --- | --- |
| `relational-operator.ts:387` (Equal chain evaluation) | The change itself; already inert-on-undecidable. |
| `sets.ts:1250` (element compare) | Membership by structural/numeric equality; prover was over-reach. |
| `collections.ts:6949, 7160, 7224` (IndexOf, sort tie-detection) | `undefined` → not-equal → order fallback; safe. |
| `statistics.ts:222` (±1 parameter checks) | Numeric in practice. |
| `type-handlers.ts:260/267` (pole membership) | Undecidable → wider type; conservative direction. |
| `special-functions.ts:205` | Type handler; `undefined` → wider type. |
| `match.ts:141`, `match-dispatch.ts:525` | Pattern literal-value matching; prover in match would be surprising. |
| `rules.ts:224–231` (`notzero`/`notone` predicates) | Slight rule-applicability narrowing on exotic symbolic args; acceptable. |
| `type-constructors.ts:95` | Value-type equality. |

**DEEP (route explicitly to the prover):**

| Site | Rationale |
| --- | --- |
| `relational-operator.ts` equation/relation-equivalence `eq:` handlers (~255–286, 485–486, 1171–1176) | "Same solution set" is an identity question; the measured wrong-`false` lives here. |
| `solve.ts:3065/3080/3106` (root verification, dedup) | Parametric roots keep unknowns; numeric roots unaffected either way. |
| `solve-domain.ts:1294/1442`, `diophantine.ts:350` | Solution verification, same rationale. |
| `fungrim/loader.ts:279` | Corpus identity validation — literally the prover's job. |
| Public `.isEqual()` | ~~Stays deep~~ — superseded by ratified consequence #2 below: `.isEqual()` goes cheap with `=`; the prover's API twin is `.isIdenticallyEqual()`. (Row kept as the audit-time recommendation.) |

## Ratified design (user-ruled 2026-08-04)

Three tiers. The operator, its API method, and its surfaces share semantics
at each tier — no method/operator divergence.

| Tier | MathJSON | API | Cortex | LaTeX / glyph | Semantics |
| --- | --- | --- | --- | --- | --- |
| Structural | `Same` | `.isSame()` | `===` | `≣` (U+2263; **no LaTeX command — deliberate**, `===` is the canonical spelling; display story belongs to MathLive) | Strictly **syntactic** equality of canonical forms. **Never dereferences a symbol's value** — `x === 5` with `x := 5` is `False`. Always decidable (True/False). `Same([NaN],[NaN])` → True. |
| Arithmetic (new default) | `Equal` | `.isEqual()` | `==` | `=` | Cheap: evaluate operands → `isSame` → True (NaN-collection carve-out) → no-unknowns tolerance compare of the difference → otherwise **inert**. No expand, no simplify, no sampling. `NaN = NaN` → False. |
| Prover | `IdenticallyEqual` | `.isIdenticallyEqual()` | — (call form) | `\equiv` / `≡` | Identity in all free variables: today's `eq()` free-variable machinery (stochastic sampling + expand/simplify fallback), three-valued. Stochastic `True` is confined here and documented. |

Ratified consequences:

1. **`.isSame()` sheds its value-following shortcut** (approved). Today it is
   inconsistent: top-level symbol-vs-literal follows the binding
   (`one := 1` → `one.isSame(1)` is `true`) but symbol-vs-symbol and nested
   occurrences do not (`a:=5, b:=5` → `a.isSame(b)` false; `x+one` vs `x+1`
   false). The shortcut is removed: `isSame` = strictly syntactic,
   everywhere. Requires its own blast measurement before landing (CLAUDE.md
   currently documents the shortcut; internal `.isSame(0)`/`.isSame(1)`
   checks on literals are unaffected by construction). CLAUDE.md + the
   comparison-methods docs update in the same change.
2. **`.isEqual()` goes cheap with `=`** (consistent mapping). Prover-seeking
   callers — the 12 migrated tests, the DEEP table rows below, any external
   users — move to `.isIdenticallyEqual()`. Called-out BREAKING change.
3. **`\equiv` parselet repoint**: bare `\equiv` → `IdenticallyEqual`
   (currently `Equivalent`); followed by `\pmod` → `Congruent` (unchanged —
   the lookahead split already exists). `Equivalent` keeps `\iff` and
   `\Leftrightarrow` on parse and already serializes as `\iff`, so logic
   round-trips are unaffected; only the parse of `p \equiv q` as iff breaks
   (changelog). Note: over boolean operands the prover's verdict coincides
   with logical equivalence, so the repoint is semantically gentle.
4. **Compile targets**: `Equal` keeps tolerance-compare (unchanged);
   `Same` declines to compile initially (exact float compare can be added
   later if a consumer asks); `IdenticallyEqual` declines (by returning
   `undefined`, per the compile-handler convention — never throw).
5. The cheap dispositions for `rules.ts` predicates and the pole checks are
   confirmed (conservative failure direction).

## Phasing

1. **Additive**: introduce `IdenticallyEqual` (+ `.isIdenticallyEqual()`,
   `\equiv` repoint, `≡` parse) and `Same` (+ `===`/`≣` parse in Cortex/
   MathJSON surfaces); route the DEEP table rows and the 12 prover tests to
   the new tier. Nothing existing changes behavior yet.
2. **Flips**, each with its own blast measurement: (a) `eq()` free-variable
   branch → inert (cheap `=` / `.isEqual()`); (b) `.isSame()` value-following
   removal. Changelog **BREAKING** entries + Tycho notice per the item-149
   protocol (their witness class is unaffected: `d = m` was undecidable-inert
   under both semantics, and interpreted `=` moves closer to compiled `=`,
   shrinking the D-209 divergence class).
