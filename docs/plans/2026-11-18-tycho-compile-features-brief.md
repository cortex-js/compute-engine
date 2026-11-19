# Brief: the compile features that Tycho still misses (after 0.194.0)

For a new session. The goal: compile, on the targets Tycho uses
(`javascript`, `glsl`, sometimes `interval-js`), three features that decline
today: **colormap functions**, **the broadcasting cases Tycho needs**, and
**`parallel for`** (`ParallelLoop`). Work in this order; the first is the
cheapest, the last needs a design note before code.

## State at `c322fb52c01de1a95a04b39d9c3f21faf911bbce` (0.194.0, 2026-11-18)

- The only compiler is `src/compute-engine/compilation/ir/` (lowering
  `lower.ts`, `lower-lists.ts`, `lower-functions.ts`, `lower-context.ts`;
  operator table `operators.ts`; printers `print-js.ts`, `print-glsl.ts`,
  `print-interval.ts`; adapters; `compile-expression.ts`). Read
  `ir/README.md` first. The JavaScript runtime is
  `compilation/javascript-runtime.ts`; helpers it no longer reaches were
  removed, so a new helper is added there on purpose.
- Measured by `compile(ce.box(…), { fallback: false })`:
  - `Colormap(String("viridis"), x)` and `ColorMix(Color(…), Color(…), x)`
    decline: "the operator … is not supported by the compiler". The
    library signature of `Colormap` is `(string, number?) -> color |
    list<color>` (`npx tsx scripts/where.ts Colormap`). The colour lane
    exists in the IR (`ir/README.md`, "The colour lane"): the constructors
    `Rgb`, `Hsl`, `Hsv`, `Oklab`, `Oklch` and the conversions `AsRgb`,
    `AsHsl`, `AsHsv`, `AsOklab`, `AsOklch` compile; `Color(String("red"))`,
    a colour from its name, declines.
  - `Sin(L)` with `L: list<real>` compiles, and the result has `broadcast`
    and `broadcastAsync`. Which broadcasting case Tycho misses is not known:
    get it from tycho-desk (below) before writing code.
  - `ParallelLoop` declines (`docs/MIGRATION-0.194.md`: "A program with a
    `parallel for` (`ParallelLoop`) declines"). It was removed with the old
    compilers by decision: concurrency on the worker pool was to come back
    as a follow-up phase.
- Earlier cost estimate for colour operators: 25 to 40 lines each, one
  runtime method each that reuses the library's kernel (the kernels are in
  `library/colors.ts`, for example `lerpOklchColor`), plus a row and a
  spelling per target. This is an estimate, not a measurement.
- tycho-desk is adopting 0.194.0 and, meanwhile, rewrites `colormap(h, v)`
  into table reads: constant `List`s on GLSL (three parallel lists of
  numbers; a list of `Tuple`s read at a run-time index declines on GLSL),
  a `list<real>` input on JavaScript. A native `Colormap` may let Tycho
  drop that rewrite; ask tycho-desk which form it wants.

## First step: get the requests as issues

Ask tycho-desk (a session on this machine; `ListAgents`, then
`SendMessage`) to file each missing feature as an issue file in `issues/`
with `source: tycho` and the Tycho program that needs it
(`docs/ISSUE_TRACKING.md`). Work from those issues. Do not start
`parallel for` from this brief alone.

## Rules that matter here (the full text is in AGENTS.md)

- Compiled code gives the interpreter's value within the caveats of
  `docs/COMPILATION-MODEL.md`, "Caveats of compiled code". A wrong finite
  value or shape is a defect; a decline is always acceptable.
- Shapes settle at compile time (R1 to R6); a declared union of shapes
  declines.
- Every target may decline what it cannot do; JavaScript first.
- `npm run check:deps` enforces zero circular dependencies.

## What the reviews of the last additions found (avoid these)

- Decide each convention as the interpreter decides it at run time: it
  reads the arity of a callback from its value (a user function by its
  literal, a library operator by its signature), not only from the
  declared type. Probe the interpreter; a reviewer's claim about it can be
  wrong.
- The interpreter keeps exact values (`1/3`, `π`, a local declared with an
  exact value): where a result depends on exact equality, decline.
- An effect (`Random`, an outer `Assign`) where the interpreter evaluates
  lazily or stops early: decline.
- For `parallel for`: the draw order of `Random` under `WithRandomSeed`
  (`docs/RANDOMNESS-MODEL.md`) and the determinism of the result belong in
  the design note.

## Checks and process

- Type check: `./node_modules/@typescript/native/bin/tsc -p tsconfig.json --noEmit`.
- Tests of the area, then `npm run test:core`; the full suite (`npm test`)
  under the box lock (`~/.claude/SHARED-BOX-PROTOCOL.md`) before a commit
  that touches shared code.
- Random programs against the interpreter:
  `CE_NIGHTLY=1 npx jest test/compute-engine/ir-slice-random.test.ts test/compute-engine/nightly/js-parity-fuzz.test.ts`;
  `CE_RANDOM_SEED=<n>` runs other seeds (seed 10 fails on CE-1424, an
  interpreter defect).
- Corpus: `_TASKS/2026-11-14-ir-batches/replay-texts.mts` prints a hash of
  the code of every program of Tycho's corpus for one tree
  (`CE_ROOT=<tree> [SHARD=k/n] npx tsx replay-texts.mts <out.jsonl>`); run it
  on two trees and diff the sorted outputs to list the programs whose code
  changed, then check those against the interpreter. `replay-t12.mts` no
  longer compares values (it compared with the deleted compiler).
- Review: Codex and a Claude reviewer for each change (`/review-files`),
  until a round finds no high or medium defect.
- Commits need the user's approval in the new session.
- Document a new compiled operator in `ir/README.md`, the CHANGELOG
  `[Unreleased]` section, and, for public behaviour, the guide
  `~/dev/cortexjs.io/docs/compute-engine/13-guide-compile.md` (no git in
  that repo).

## Other sessions

- `tycho-desk`: Tycho's side; the source of the requests.
- `ce-interval`: owns the interval mode (`print-interval.ts`,
  `interval/`); ask before changing interval spellings.
- The binding workstream is active, worked on by Codex: the `Program`
  operator is delivered as a proof of concept, and a `Document` operator,
  a unit of binding, is in progress. Outside such a unit the values of
  expressions can change, but not their types. Change nothing in the
  binding area. `compile()` compiles a library `Program` as the `Block` of
  its operands (`compile-expression.ts`); how a `Document` compiles is
  that workstream's decision, so ask the user before adding it to the
  compiler.
