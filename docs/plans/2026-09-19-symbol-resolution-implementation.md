# Symbol facts and application notation

## Delivered

CE 0.132.1 is published and adopted in Tycho. Registry integrity matches the
validated artifact exactly:
`sha512-T4UQO4u/+sVo7/8KGRduTUMLM6FJrAcefkttYX1C+r7uRZzS6Uv4fZGajNbxd0dmLe+2ipu8HL/DIZsDF3BTwg==`.
Tycho's manifest and lockfile pin the registry release, and its three reachable
copied CE bundle files match the package byte for byte.

The partial `ce-wt-ask305` implementation was adapted into CE main; the original
worktree was preserved. The user committed the Tycho changes as `9bf421e2d`.
The CE changes are prepared for a separate commit. No commits were made by this
task. Unrelated edits and index contents were preserved.

## Contract

1. Lexical parameters and explicit declarations, including `unknown`, are
   authoritative. Only inferred, unassigned guesses yield to external facts.
2. `resolveSymbol(name)` supplies stable facts per parse. Captured facts belong
   to the expression and support deferred canonicalization without declarations
   leaking into the ambient scope.
3. `resolveApplication(context)` supplies occurrence-specific syntax policy.
   Context includes parsed arguments, normalized LaTeX offsets, and structural
   ancestry. An `apply`/`multiply` answer is encoded in raw MathJSON. No answer
   preserves CE's ordinary heuristic. Known types bypass this hook.
4. Tycho discovers definition headers, propagates value shapes through
   dependencies in disposable scopes, publishes declarations, then reparses
   retained rows and function bodies. Parameters shadow document names.
5. Graphing coefficient policy uses `resolveApplication`, replacing
   `declareCoefficientHeads`. Notebook, validator, import-helper and the new
   action-recognition profile retain stock notation. Action recognition checks
   its own action-name registry after parsing call shapes.

## Validation

- CE: 829 suites, 35,829 tests and 4,260 snapshots passed; 10 suites and 861
  tests skipped, one todo. Source fingerprints before and after the run match.
  Checkpoint bypass canaries passed 46/46. Production build, public declaration
  checks, final typecheck and minified range/fact-retention probes passed.
  Logs: `/tmp/ce1321-{full,canary,build,final-typecheck,public-declarations}.log`.
- Tycho full Node rerun: 14,872 passed, zero failed, three skipped, two todo.
  Source/test fingerprints remained unchanged through the run. API: 255 files,
  2,629 passed, four skipped. Lints, typecheck and build passed.
- Full Chromium: 3,081 passed, 43 skipped, one action-call failure. That failure
  exposed the action recognizer's shared display coefficient policy. A dedicated
  profile fixed it; subsequent validation passed 323 action/profile/alias Node
  checks, typecheck, build and 47 affected browser tests (12 skipped), including
  the formerly failing `M(5)` witness. The full browser run was not rerun after
  this focused fix; the affected cases were rerun against the rebuilt app.
- Installed published-package probes: symbol-fact witness 14/14 and
  context/type-propagation witness 20/20. Logs:
  `/tmp/tycho-ce1321-{asks,context}-probe.log`.
- Final CORE arm `render-audit-2026-09-19-core-ce1321.json`: 20 rendered and four
  unchanged no-paint states. All 24 outcomes, series counts and chromatic
  fractions match the 0.131.3 baseline. The only painted-fraction delta is
  0.11071 to 0.11070 for `neyret/zstlwmmpkp`; no degradation counter rose.
  Tracker-claim check reports no disagreements. No performance claim is made.
- All four regressions in the earlier 0.132.0 candidate restored rendering and
  series counts in isolated reruns. A pixel difference for `qm6cgwyusu` was
  checked on the same Tycho build with only the served CE bundle changed:
  0.131.3 and 0.132.1 both produce three series, non-background fraction 0.0387
  and chromatic fraction 0.02997. Browser-loaded versions were verified.
  The full CORE sample matches the historical baseline for this graph.
- Reference packages: an isolated same-converter comparison covered 54 unique
  documents and 56 memberships. CE 0.131.3 matches the previous packages; the
  new engine changes only equivalent eye-shader term order, `-f(x)+y` to
  `y-f(x)`. All final package contents match the new-engine control exactly.
- Codex and Claude independently reviewed both implementations and follow-up
  fixes. Actionable findings were fixed and verified. Shape gates were reviewed;
  the remaining production tuple predicates have structural guards.

## Adoption fixes

CE 0.132.0 was published but never adopted. Reference regeneration exposed a
range-precedence bug when an application hook declined a decision. CE 0.132.1
preserves range provenance through parser rebuilds and source decoration,
including `preserveLatex` metadata.

Tycho follow-ups preserve call shapes during initial Desmos capture, select
outer definition assignments before nested assignments, recognize raw calculus
binders in dependency scans, and separate action recognition from display
notation. A timing-sensitive action test now uses its existing controlled
clock; production deadlines were not changed. Earlier Node deadline failures
passed in isolation and the subsequent full Node rerun was clean.

Tycho adoption records are `docs/COMPUTE_ENGINE.md` and
`docs/COMPUTE_ENGINE_LOG.md` in its repository. The notebook-specific row 302
interim remains separate from this graph parsing migration. The registration
retry queue remains intentional for forward references.

Investigation: `docs/scratch/2026-09-19-symbol-resolution-investigation.md`.
