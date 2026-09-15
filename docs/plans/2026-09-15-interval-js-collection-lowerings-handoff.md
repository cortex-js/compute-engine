# Handoff — collection values on the interval-js compile target

Date: 2026-09-15. Status: DRAFT for the next session; no decision taken yet.
Source of the numbers: the all-states code-generation census of the Tycho corpus
on CE 0.128.12 (18,713 records, 684 documents), regenerated with the recipe in
§7.

## 1. What the interval-js target is for

Tycho compiles two kinds of expression to `interval-js`:

- the UNMASKED body `f(x, y)` of an implicit curve or an inequality, evaluated
  over a rectangle of the plane to decide whether a region can be excluded
  (`src/plot/ce-compile.ts`, `compileAtomNode` and the implicit-member route:
  the predicate is a separately compiled tri-state tree, and a leaf that does
  not compile degrades to "maybe" — it only weakens exclusion, never
  soundness);
- a one-variable function `y = f(x)` (`Function2D`), where the interval variant
  sits beside the scalar one.

A value on this target is an interval `{lo, hi}` with the `IntervalResult`
markers (`partial`, `singular`, absence as the bare whole-NaN interval). The
result contract admits arrays (decided 2026-08-22, Tycho item 220):
`IntervalValue = IntervalResult | Interval | IntervalValue[]`, so a
comprehension or a `Map` at the ROOT returns an array of intervals and the
interpreter fallback maps a list element by element.

## 2. Decisions already taken that this work must respect

- **No global `List`/`Tuple` lowering** (2026-08-22). The array spelling is
  emitted only in the OPERAND position of `At`, `Length`, `PointX/Y/Z`, `Norm`,
  `Sum`, `Product`, `Integrate` (`compileIntervalCollectionOperand`). A global
  entry made `Which(b(u), 1, True, 2)` with `b(t) := [t < 1, t < 2]` — a
  contradicted `-> boolean` declaration — compile, which the 2026-08-12 wave-6
  pin forbids. Memory: `project_tycho_item220_interval_js_six_heads`.
- **Scalar kernels are gated** (same decision): every kernel is wrapped by
  `guardedIntervalFunction` → `assertScalarIntervalOperands`, because a list
  reaching `_IA.add` read `.lo`/`.hi` off an array and answered `NaN` behind
  `success: true`. The gate runs after the handler so a head's own diagnostic
  wins.
- **Static-width lists are unrolled before compiling** (2026-09-12): the
  fixed-width pre-pass fans out lists of any width, including constant lists
  (`CompileTarget.unrollMinWidth = 1`, `unrollConstantLists = true`), and
  collection-bodied helpers are inlined at the root
  (`BaseCompiler.inlineCollectionValuedCallsAtRoot`). Rule 5 folds
  `At([..], k)` with a literal `k` to the element. Memory:
  `project_interval_static_lists_0912`. What is left is therefore the DYNAMIC
  case: a width or a bound the compiler cannot see.
- **`Range` is decomposed only under `Sum`/`Product`** (2026-08-30, item 237),
  mirroring `literalRange`; `Random` is the support enclosure `[0, 1]` by
  design (a seeded sequence would be unsound).
- **Complex numbers are not supported** on this target ("Complex numbers are
  not supported by this target"): out of scope here.

## 3. The census: 233 interval-js declines on 0.128.12, by class

| records | docs | class | witness |
|---:|---:|---|---|
| 43 | 16 | `List` has no lowering | `\sin(P(x, y)) \le 0.1` with `P` returning a list (`0et6fx01id`); `x = c(y, 10, E)` (`2agcgxq87y`) |
| 34 | 11 | an absent (`missing`) position has no object representation | 15 of them on the coordinate-accessor union `list<number> \| missing \| number \| tuple<…>` (`n7uhaaoq1q`, `hpr2q4kles`); 9 on `broadcastable<number> \| missing` |
| 25 | 5 | `PointList` has no lowering for these operand types | 3-D parametric surfaces written as point lists (`n7uhaaoq1q`, `mqm2eamst1`) |
| 23 | 12 | `Range` has no lowering | data-dependent bounds: `2^{-(\lfloor \lb(\max(x,1)) \rfloor .. 0)}` (`mavxszbvzk`); `(1..4)[y]` (`n7uhaaoq1q`) |
| 16 | 8 | `D` has no lowering for these operand types | `\frac{d}{dx} L_{inf}(x)` (`dmibg1uaof`); `c_g(x) + B(x)` with a derivative-defined helper (`4bxr9em1mk`) |
| 19 | 8 | complex (`Real`, `Imaginary`, "not supported") | `\|\tan(\tan(x+iy))\| < 1` (`adgm2frjcq`) — out of scope |
| 8 | 4 | `Unknown operator` | Tycho binding failures — not CE |
| 7 | 3 | `RandomChoice` no lowering | design (random support enclosure) |
| 7 | 2 | `Map` no lowering | `S(5x, 15)` (`lrpzqnemhy`) |
| 6 | 1 | `GeometricVector` | geometry, one document |
| 5 | 2 | `Apply` with a non-literal callee | design |
| 4 | 2 | `Tuple` no lowering | `2ki2hjsouf` (invalid document), `0vlrmhen37` (`\min([T(x,y,i,j) for …]) \le 0.3`) |
| 4 | 1 | `Integrate` over a collection-valued body | `2agcgxq87y` |

Not every class is a target. `PointList` rows are parametric surfaces (a point
list is not an implicit curve; the interval route cannot use them), the
complex rows are excluded by design, the binding failures are Tycho's, and the
absent-position rows on the accessor union sit behind `PointList` arithmetic
that would not lower anyway. The classes with a plausible interval meaning are
`List` (43), `Range` (23), `D` (16), `Map` (7) and the `broadcastable | missing`
half of the absent rows (9).

## 4. What a list-valued implicit body MEANS, and the candidate design

Desmos reads `\sin(P(x, y)) \le 0.1` with `P` list-valued as several implicit
curves, one per element. On the interval route that is an array of intervals
per rectangle — exactly the admitted result contract. The gap is that the
kernels between the list and the root refuse collection operands.

Candidate A — element-wise interval broadcast (recommended to evaluate first).
Give the interval target a broadcast wrapper like the JavaScript target's
`_SYS.bcast`: when an operand's TYPE proves a list of numbers
(`list<number>`, `indexed_collection<number>`, or a comprehension/`Map` result
of scalar body), lower the kernel as a map over the array; a scalar operand is
applied to every element; two arrays are zipped (shorter wins, the
interpreter's rule). The result is `IntervalValue[]`. This keeps the 2026-08-22
gate for anything the type does NOT prove a numeric list (a wide `unknown`, a
point-or-point-list union, a `list<tuple>`), so the wave-6 pin stays. The
`List` literal would lower to an array only when every element compiles to a
scalar interval, and only in a position the broadcast consumes — never as a
free-standing global entry (the decision above).

Candidate B — treat a list-valued body as "maybe" on the Tycho side (no CE
change): Tycho's tri-state tree already degrades an uncompilable leaf to
"maybe", so exclusion is merely weaker for these rows. This is the status quo;
its cost is plotting time, not correctness. The handoff owner should measure
how many of the 43 `List` rows are implicit members Tycho actually plots
through the interval route (the census compiles every row on every target it
might use; not every `List` row is an implicit curve).

Candidate C — `Range` with dynamic bounds: an array whose length depends on
the point cannot be an `IntervalValue[]` of fixed width; the honest interval
of `f(k)` over `k ∈ a..b` for interval `a`, `b` is the hull over the integer
range `[⌈a.lo⌉, ⌊b.hi⌋]`, which `_IA.at` already computes for an index
interval. So `Range(a, b)` in a REDUCING position (`Sum`, `Product`, `Min`,
`Max`, `Total`) could lower to a hull-of-range loop; in a list-valued position
it stays declined.

Candidate D — `D` of a user function: the JavaScript target lowers `D` by
symbolic differentiation of the helper body (`compileDerivative`,
`library/calculus.ts`). The interval target lacks the head. If the symbolic
derivative of the body exists, the same closed form lowers through the interval
kernels; otherwise fail closed. Sixteen rows, eight documents — a bounded
task, independent of A–C.

## 5. Questions for the user before any code

1. Is a list-valued implicit body (several curves) something the interval
   route should serve, or should Tycho split such a member into per-element
   members before compiling? (Decides between A and B.)
2. Is the 2026-08-22 "no global `List` lowering" decision to be kept as
   stated (array spelling only in consuming positions), with the broadcast
   wrapper as the only new consumer? (A assumes yes.)
3. Is `D` on the interval target wanted (D), independently of the list work?

## 6. Files, tests and pins the work touches

- `src/compute-engine/compilation/interval-javascript-target.ts` — the head
  table `INTERVAL_JAVASCRIPT_FUNCTIONS`, `compileIntervalCollectionOperand`,
  `guardedIntervalFunction` / `assertScalarIntervalOperands`, the absence
  spelling (a whole-NaN bare interval; `absence.numeric` only — no object
  axis, which is what raises "an absent position has no representation").
- `src/compute-engine/interval/collections.ts` (`_IA.at` and the point
  accessors), `src/compute-engine/interval/integrate.ts`.
- `src/compute-engine/compilation/fixed-width-unroll.ts` (the pre-pass; its
  options on the interval target).
- Pins that encode the decisions above: `compile-loop.test.ts` (array at the
  root), the wave-6 contradicted-declaration pins (2026-08-12),
  `tycho-220*`/`tycho-237*` interval tests, the interval static-list tests
  of 2026-09-12 (`Sum([1,2] + [3,4])` zips to `[4, 6]`).
- Docs: `docs/COMPILATION-MODEL.md` (absence axes §3.F),
  `docs/plans/2026-08-27-interval-arithmetic-result-types.md`,
  `docs/plans/2026-08-29-interval-division.md`.

## 7. Regenerating the census

The all-states record lives only in a session scratchpad and is lost with it;
regenerate it in a Tycho worktree so the shared tree is never touched:

```
git -C ~/dev/tycho worktree add --detach <WT> HEAD
# node_modules: symlink every entry of ~/dev/tycho/node_modules except
# @cortex-js/compute-engine, which is a real copy unpacked from the npm tarball
ln -s ~/dev/tycho/_TASK <WT>/_TASK          # the gitignored corpus
cd <WT> && npx tsx scripts/audit-ce-codegen.mts --all \
  --full <scratch>/ce-<version>-all.json --digest <scratch>/ce-<version>-all-digest.json
# teardown: rm the symlinks first, then git worktree remove --force <WT>
```

About nine minutes at moderate load. The CORE-only records
(`_TASK/desmos/desmos-corpus/codegen-audit/ce-<version>.json`, 769 records)
are kept per version in the Tycho corpus folder; `ce-0.128.11.json` is the
last one written. Tally by target and message with a short node script over
`records[]` (`target`, `success`, `error`, `doc`, `row`, `input`).
