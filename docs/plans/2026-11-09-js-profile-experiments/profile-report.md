# Resolved function profile coverage study

Selected15 native showcases at Tycho8777c57e3 with installed CE0.184.0. This is a public-API research observer at the effective Tycho gateway, before CE internal emission preparation. It does not implement or measure profile admission.

| Target | Compile calls | Existing compile succeeds | Candidate syntax only | Unresolved | Calls with captured functions | Calls with Loop |
|---|---:|---:|---:|---:|---:|---:|
| JavaScript |116|116|108|8|25|14|
| interval-js |20|20|20|0|3|5|
| GLSL |18|18|18|0|12|3|

154 calls reduce to144 existing audit records and112 unique input-tree hashes. Neither is a count of unique programs: the same tree may have different options or bindings. There are43 distinct captured body hashes across40 calls.22 calls have assignment and22 have explicit Loop;14 have Break,31 If,30 Comprehension,59 At. These are call-incidence counts after transitive expansion, not execution frequency or node totals.16 calls contain at least one bound symbol whose current ambient identity differs, reinforcing the need to resolve captures by identity.

Result types include29 `real`,17 `color`,13 `tuple<list<real>>`,11 `list<nan | real | signed_infinity>`,10 `list<number>` and9 `tuple<list<integer>>` calls. Prelude wrapper tuples are not necessarily the consumer ABI. Finite arithmetic is not established by a `number` or numeric-union result type.

The8 unresolved JS calls are one Buddhabrot prelude call (step now expanded; Fract outside this observer's modeled builtin set), and7 Apollonian calls (fill/generations expanded; Count unmodeled, recursive fill, and unknown/generic intermediate types). Thus `unmodeled-or-opaque-call` diagnostics include known-but-unmodeled builtins and are not evidence of host behavior or CE defects. No observed runtime strings/dictionaries remain outside the candidate vocabulary after excluding declaration and Typed metadata. That zero is specific to this selected numeric showcase set, not a claim about notebooks.

Final selected and Life correctness runs after independent review both exited0, with unchanged counts. The144 emitted records also match the preserved pre-review run excluding timing/ID fields. No timing conclusions are drawn. Review fixes removed an unreachable builtin-classification branch, renamed the unresolved call reason without asserting builtin identity, removed ambient registration during nested DefineFunction traversal, and moved capture serialization/appending outside the compiler catch. The nested-definition control asserts an existing global body hash and verifies traversal cannot overwrite it.

Controls pass for a transitive f→g hidden loop, same-name shadowing with captured-binding identity, unknown host override, a directly constructed engine whose DefineFunction evaluation replaces the binding identity, and Typed metadata versus a true runtime string. The first observer missed evaluated prelude definition identities and treated Typed metadata as runtime strings; both were corrected. All144 deduplicated audit records are identical between initial and corrected passes excluding IDs and timing fields, including emitted source, options, success, free symbols/types and occurrence counts. This is an instrumentation comparison, not an uninstrumented production comparison.

## Game of Life

A real action fires through the existing showcase node harness. Five gateway calls are recorded (four load, one action). The action expression expands its literal function, but Apply/RotateLeft remain unmodeled and unresolved. Before and after snapshots have22500 integer elements; both the S binding identity and content hash change. Initial hash `f0b96e018a51c1e433f6ed9191e235e5dc0fbd68f2e4a5db8d34a9ebb43861d7`; after one action `aea7cad91a4eeb6ea4a48460f71ee77424070c6d328212a24d47eb95bd98ba1e`.

The harness has already materialized the seed before the first reader snapshot. It does not reproduce the earlier formula-bound audit load phase. The explicit reader snapshots inspect an authored expression in the live manager scope, not a renderer compile gateway. No GPU sampler routing, production deadline or cancellation conclusion follows.

## Migration order suggested by these observations

1. Scalar arithmetic/predicates and numeric tuple outputs, using the simple trig/polynomial specimens as differential controls.
2. Indexed numeric collections, comprehensions/reductions and color results, with explicit binding layout and by-reference carriers. At appears in59 calls; do not restrict the first useful profile to scalar-only syntax.
3. Structured local statements, loops and early exit plus resolved named calls. Burning Ship/Multibrot/Julia and Buddhabrot step require these despite numeric outputs. Emit structured fragments first; this evidence does not justify a whole-program CPS/SSA prerequisite.
4. Mutable program state and effect summaries: Life updates and Buddhabrot histogram accumulation. Attach execution requirements independently of vocabulary and require capture/alias/write proofs before concurrency admission.
5. Recursive/generic programs and indirect calls, represented here by Apollonian and the Life action Apply. Retain explicit unresolved/decline paths while the traditional JS target remains available.

## Reproduction and limits

Run in `/tmp/wt-tycho-profile-next` after acquiring the shared-machine run lock (prefix each corpus/action command with `node ~/.claude/scripts/box-lock.mjs check <owner> &&`):

```sh
node --import tsx scripts/profile-coverage-controls.mts > /tmp/js-profile-next/profile-controls.json 2> /tmp/js-profile-next/profile-controls.log
PROFILE_CAPTURE=/tmp/js-profile-next/coverage.jsonl PROFILE_IDS=rainbow-trig,damped-oscillation,fourier-harmonics,implicit-heart,domain-coloring,burning-ship,multibrot,julia-set,buddhabrot,game-of-life,three-body-problem,projectile-with-drag,metaballs,frenet-knot-tube,apollonian-gasket node --import tsx scripts/profile-coverage-audit.mts --full /tmp/js-profile-next/coverage-full.json --digest /tmp/js-profile-next/coverage-digest.json > /tmp/js-profile-next/coverage-run.log 2>&1
node --import tsx scripts/profile-coverage-life.mts > /tmp/js-profile-next/life-run.log 2>&1
python3 scripts/profile-coverage-summary.py
python3 scripts/profile-coverage-compare.py
```

The copied audit retains its inherited `desmosScope` metadata label; the actual run is the15-showcase selection above with no Desmos execution, not a complete CORE result.

The capture file is append-only: move an earlier output aside before replay. All commands exited0. Copies of instruments and results are alongside this report. `profile-scope.md` specifies the candidate vocabulary and semantic limitations. No production sources, tests, builds, git state or benchmark configuration were changed. The Desmos negative candidate and whole CORE/ALL are omitted deliberately; the selected showcases represent21 of the22 earlier candidate locators.

Remaining limitations: event provenance is partial; multiple definition histories and local call spellings remain conservative. Definition bodies retain lexical bindings; the observer never substitutes ambient lookup for them. Bound list/scalar values are hashed, not recursively expanded into complete executable replay environments. Types are an inventory, not signature/shape admission. Effects are syntactic flags, not a local-versus-captured write or alias analysis. The node limit and recursion cutoff can leave unresolved coverage. Recreate the original document/prelude/action setup to replay; these records are not standalone compiler fixtures.
