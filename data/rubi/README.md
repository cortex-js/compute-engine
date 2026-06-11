# Rubi rule corpus (MathJSON translation)

This directory holds the MathJSON translation of the
[Rubi](https://rulebasedintegration.org/) integration rules (MIT, see
`LICENSE`), produced by `scripts/rubi/translate.ts` from the Rubi 4.17.3.0
release. See `docs/rubi/RUBI.md` for the integration plan and
`MANIFEST.json` for provenance (version, content hash, counts).

**Current scope: Chapter 1 (Algebraic functions), 2,647 rules** — the
Phase R1/R2 target. The translator extracts the *full* corpus (7,413 rules,
100%) and later chapters can be added by re-running with a wider
`--section` (or none).

## Layout

- `corpus/<chapter>/…/<file>.json` — one JSON file per Rubi source file,
  one rule per line, **in Rubi's original order (= match-priority order;
  do not reorder)**. Each rule has:
  - `lhs` — the integrand pattern; WL pattern atoms appear as
    `["Blank", name(, head)]` (`a_`) and `["BlankOptional", name]` (`a_.`,
    optional with operator-derived default).
  - `variable` — integration-variable name (from `x_`/`x_Symbol`).
  - `rhs` — the rule body. `Int` (recursive integration), `Subst`, and all
    Rubi utility heads (`Simp`, `Rt`, `ExpandIntegrand`, …) are kept
    verbatim; standard heads are mapped to CE names (`Log`→`Ln`,
    `ArcTan`→`Arctan`, `E`→`ExponentialE`, …). Symbols colliding with CE
    built-ins are renamed (`e`→`e_var`, `i`→`i_var`, `N`→`N_var`,
    `D`→`D_var`), matching the Fungrim corpus convention.
  - `condition` — the outer `/;` guard (over pattern variables), or null.
  - `bindings` / `scoped` / `innerCondition` — `With`/`Module` locals and
    the guard inside their scope (which may reference the locals).
  - `source` — the original WL cell text (ground truth for review).
- `skipped.json` — extraction failures (currently none).
- `MANIFEST.json` — provenance pin + per-file rule counts.

The corpus is engine-independent: optional-pattern expansion, predicate
mapping, and dispatch bucketing happen in a separate compile step (the
Fungrim corpus/compile split).

## Regeneration

```sh
# Rubi 4.17.3.0 release tarball extracted at ~/dev/rubi/Rubi-4.17.3.0
# (or set RUBI_HOME)
npx tsx scripts/rubi/translate.ts --section "1 Algebraic functions" --out data/rubi
```

Deterministic: same input ⇒ byte-identical output (except the MANIFEST
`generated` date). Translator regression tests:
`npm run test compute-engine/rubi-translator`.
