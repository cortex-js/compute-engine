# Tycho prelude showcase refresh — source inventory

Initial read-only inspection on 2026-11-09. During that inventory, no git commands were run in Tycho main, and no source imports/evaluation, tests, builds, corpus runs or production edits were performed. After the parent supplied a private checkout, read-only git diffs were used there. The inventory initially treated assertions as **authored contracts and fixture candidates**. The final section records the subsequently authorized14-test execution, without upgrading other source observations into execution evidence.

## Baseline and additions

The retained `docs/plans/2026-11-08-js-profile-audit/evidence/core-digest.json.gz` identifies Tycho `8777c57e3`, CE `0.184.0`, generated `2026-11-09T07:09:51.852Z`. Its document list has six prelude showcases: burning-ship, multibrot, buddhabrot, julia-set, game-of-life, apollonian-gasket. The current `src/graph-paper/onboarding/template-data.js` retains these six and imports/inserts three additional prelude entries at lines23–25 and762–764: **traffic-jam, othello, heat-spread**. All three IDs are absent from the pinned full CORE digest, not merely absent from the later15-document selection.

Current source thus has nine prelude showcase entries, with17 named functions across the three additions. This count follows the catalogue's explicit entries and imports; it is not a runtime parse/compile census. A subsequent read-only diff in the parent-provided private checkout `/tmp/wt-tycho-browser-profile` at `0e6482e1f` against `8777c57e3` shows only the three new imports and three entry insertions in template-data.js; showcase-geometry.js has no diff. Thus the existing six authored preludes are unchanged between those commits. All five catalogue source files hashed below are byte-identical between that checkout and the inspected main tree. Buddhabrot still authors `step(H_0, 1200000)` and no action. No git commands were run in main.

## New workload families

| Entry/source | Authored vocabulary and bindings | State/execution contract to preserve |
|---|---|---|
| `traffic-jam`, `showcase-traffic.js:2` | Four functions: roadseed, roadstart, roadstep, roadtrail. Captured constants L=240, N=24, W=80; typed `list<real>` and scalar arguments/results; numeric comprehensions, indexed reads, Mod, floor-like index arithmetic, tanh, min/max, loops, local assignment and replaceAt. | S holds48 values (24positions then24speeds), H holds1920 positions of history. The autoplay action writes S and H together; the H RHS independently calls roadstep(S,a,V). Both read the old S, and every driver's update reads the old array. This is a strong snapshot/multiple-target action fixture; common-subexpression reuse must respect the action boundary. |
| `heat-spread`, `showcase-heat.js:2` | Five functions: heatwall, heatseed, heatneighbor, heatstep, heatpaint. N=32 captured; real lists and integer grid coordinates; boolean predicates, nested selections, exponentials, modulus/floor, local clamping, indexed neighbors, loops, replaceAt and comprehension. |1024 temperatures; heatstep reads H and writes separate L. Insulated/cooled boundary and wall behavior; diffusivity clamp to[0,0.25]. Autoplay diffusion, explicit brush action with point coordinates, restart, live heatmap plus cross-section. Separate input/output arrays make this a useful future independent-output partition candidate, but no concurrency proof has run. |
| `othello`, `showcase-othello.js:8` | Eight functions: ray, flips, legal, hasmove, choosecell, play, score, stones. `list<integer>`, integer and boolean annotations; nested loops, early exit, filtering comprehensions, dynamic-length legal/stone lists, indexed reads and repeated replaceAt. |65-entry board:64 cells plus player-to-move;0 means end. The click action maps marker ordinal through choosecell before play; invalid moves leave state unchanged, automatic pass and game end update slot65. A fixed-state program has variable-length derived lists, so shape/rank must not be conflated with length. The source explicitly documents CE-1178/CE-1179 workarounds; this refresh neither diagnoses nor reopens them. |

These are numeric-data programs, not evidence for separate syntax universes. A useful profile must distinguish a scalar decision such as heatneighbor or flips from a whole transition that allocates/writes lists, while allowing the named call graph to expose that distinction. Heat and traffic have gather reads into disjoint outputs; Buddhabrot has scatter accumulation and needs private histograms plus reduction. Othello's early-exit scans and move application are another effect pattern. None of those eligibility statements should be inferred from the surface operator names alone.

## Strongest next fixtures for annotation/admission

Prefer a small selected capture over another broad corpus run:

1. **heatneighbor + heatwall**: typed scalar/boolean decisions, indexed access and captured N. Pair interior, boundary and wall inputs. Carry exact node annotation identity through transitive calls; compare explicit facts against current typed backend decisions.
2. **roadstep** with externally supplied list B:48-value output, numeric locals and captured N/L. Confirm locals j/gap/target/speed never become free inputs, and all readers see old B. Capture the actual product action too: the two-target S/H action exercises a binding/effect boundary a standalone function misses.
3. **heatstep and heatpaint**: separate output allocation, clamp and fixed-grid writes; use uniform field, corner and blocked-wall spot. These provide meaningful correctness oracles for an eventual partitioned output implementation.
4. **ray → flips → hasmove/choosecell**: transitive hidden loops, break, integer/boolean scalar facts and typed locals. Good next numeric-program profile specimens without starting from the full Othello click pipeline.
5. **legal/stones and play**: filtered numeric lists of varying length, board alias `R = B`, multiple writes and early branch exits. Keep them as explicit program/alias/ownership admission cases; do not infer disjointness or in-place safety from list type.
6. **One real post-action capture per new entry**: traffic advance+restart; heat diffuse/paint; Othello legal move+automatic pass. Record live bindings and actual gateway options before/after, alongside authored/pre-CE trees and reachable definitions. These are not replaceable by load-time-only captures.

The prior observer has known vocabulary gaps and partial provenance, so extend its declared catalogue deliberately, retain unresolved cases, and state the actual CE-preparation boundary. Typed parameter declarations alone do not establish specialized call-site shapes, host-call safety, purity, portable captures or a concurrent execution contract.

## Authored oracle sources (not run)

- `tests/node/graph-paper/showcase-traffic.test.ts:16` computes expected updates independently from old state for eight actions and checks history shifting; line49 checks concrete prelude snapshots and expected scalar dependencies; line82 has a4000-step compiled scenario checking finite values, spacing and congestion. Prefer the short old-state oracle first. Lines116 onward also contain focused declaration-initializer/free-symbol controls; these are especially relevant to annotation capture.
- `tests/node/graph-paper/showcase-heat.test.ts:14` checks total heat, bounds and symmetry; line33 checks uniform field, cooled corner, wall flux and a literal diffusivity10 clamp; line73 checks brush/restart. These are stronger than source-equivalent output snapshots alone.
- `tests/node/graph-paper/showcase-othello.test.ts:32` supplies an independent ray/move reference; line66 compares actual actions through a game; line94 authors an automatic-pass/end-state witness. Opening legal moves are expected as[20,27,38,45]. Those are test expectations, not values observed during this refresh.

## Browser Buddhabrot work

Use the existing `tests/unit/graph-paper/graph-document/graph-paper-buddhabrot-showcase.spec.ts:228` as the browser integration baseline. It authors assertions for the1.2million sample count, reference field sum, selected histogram cells/total, `glsl:1:H_1` by-reference lane, visible color proportions, no action firing, no persisted computed list, and replacement after editing to600000 samples. Its plain-JS reference and catalogue guard are useful independent controls; it does not assert every histogram bin and should not be described as a complete all-bin comparison.

Pair it with `prelude-worker-check.spec.ts:151`, which authors invalid-candidate/deadline behavior and recovery after worker termination. The browser Buddhabrot suite is an integration fixture for a **single prelude worker**, not proof of multiworker partition/reduction. Add a separate scenario for partitioned kernels with deterministic sample ranges/private histograms, exact all-bin reduction and cursor checks, and request-generation routing under cancellation/replacement. Require an acknowledgement that actual compute has started if making cancellation-of-active-compute claims; receiving a request alone is insufficient. Measure transport/render integration independently of kernel correctness and do not reuse the source's historical timing comments as new measurements.

## Fingerprints and limitations

Paths below are relative to `/Users/arno/dev/tycho`. SHA-256 hashes identify the bytes inspected; the shared tree can change afterward. Authored Epsil strings contain source interpolation (for example Othello seed generation), so file hashes do not stand in for evaluated prelude hashes. No compilation success rate, admitted-profile percentage, worker eligibility count or performance result is claimed.

| File | SHA-256 |
|---|---|
| `src/graph-paper/onboarding/template-data.js` | `fe5a6e7618c6d6b0c55ef5c90926a16835f581cd5742fffa134c9a4d5785182c` |
| `src/graph-paper/onboarding/showcase-geometry.js` | `04f86c2de5c088e35159ff6b6188941598d10f51973e069b639f9644da10289e` |
| `src/graph-paper/onboarding/showcase-traffic.js` | `300e9b94ce10043a6da4208708a55e65975fa16a43a7c013d905da14086a50a2` |
| `src/graph-paper/onboarding/showcase-heat.js` | `73d5c1dd7c46a2615c58203f3348e43474572191f55b533e0a04cea05a25dc9b` |
| `src/graph-paper/onboarding/showcase-othello.js` | `3096caa7c6e867806efc4861fb3a77b20592a22089904c5bff3bf1d50046cb00` |
| `tests/node/graph-paper/showcase-traffic.test.ts` | `429b599e8b8123182d8482c6fab88dffb77a3f3160c1ca12558e9342ebb8c4cb` |
| `tests/node/graph-paper/showcase-heat.test.ts` | `f2dfd444a572efcd65153c73d51c1a5e24a1f33085967e7d83fc7d785b8394db` |
| `tests/node/graph-paper/showcase-othello.test.ts` | `888ff05428f170b56ab7ece2899d7885e2b6a4bc5e59885ddb324665ba77455f` |
| `tests/unit/graph-paper/graph-document/graph-paper-buddhabrot-showcase.spec.ts` | `7f01dcaaa9e9a33e94c934a97765ea5bb99ab94e66931fb2699c8049b172625d` |
| `tests/unit/graph-paper/graph-document/prelude-worker-check.spec.ts` | `15f3fc75a709bba99cdded6af9a42a5bb366f2e49d9fde8125398f38fb39d845` |

## Authorized focused execution follow-up

After the source inventory, the parent authorized only the three existing Node showcase files. In the private checkout `0e6482e1f` with installed CE `0.184.0`, the documented `test:quick` route ran fresh with two workers and bounded timeouts: **exit0,14 passed,0 failed,0 skipped** (traffic6, heat5, Othello3). No broad build or suite ran. Exact command, file fingerprints and copied runner logs are in `evidence/inventory/status.json` and adjacent logs. This validates the authored assertions exercised by those tests, not separately printed numerical measurements, current profile admission, prepared-tree capture or browser concurrency. The earlier source-only caveats still apply to claims outside those14 tests.
