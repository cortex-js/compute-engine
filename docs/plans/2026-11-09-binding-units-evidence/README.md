# Evidence for `2026-11-09-binding-units-model.md`

Files of the session `compute-engine-42` (2026-11-09). The scripts have a
`.txt` suffix so that no tool of the repository picks them up: copy them to a
scratchpad and remove the suffix.

| File | What it is |
|---|---|
| `inference-order-independence.test.ts.txt` | The test of the rejected step 1: 46 pairs of expressions boxed in both orders in new engines, with the same canonical form and the same reported types. To reuse as an acceptance test of the model. It asserts the behavior of step 1 for the reported type of a name (`unknown` on a conflict); check each assertion against the model before reuse. |
| `step1-writes-but-hides.patch.txt` | The rejected implementation of "writes, but hides" (base `a9e36bada97cc1d91448a9daf51915aa95f2d6d5`): the record of an approach that the review refused. Not to apply. |
| `tycho-corpus-sample.mts.txt` | Registers every n-th state of Tycho's Neyret corpus twice on a new `DocumentCEManager` and prints the counters that an instrumented engine put in `globalThis.__C`. It was run from the root of the Tycho repository, with Node, the `tsx` import, the redirect below as a second import, and the sampling step `6` as its argument (98 of 585 states). |
| `redirect-engine-to-worktree.mjs.txt` | A module hook that resolves `@cortex-js/compute-engine` to the source of a worktree. Replace `<WORKTREE>` by the path of the worktree. |
| `parse-simplify-loop.mts.txt` | Parses and simplifies ten expressions with undeclared names, 200 and 2,000 times, and prints the time. Its argument is the root of the tree to load the engine from. It was run with `tsx`. |

The measurements made with these files are in the three drafts that the model
document names in its header.
