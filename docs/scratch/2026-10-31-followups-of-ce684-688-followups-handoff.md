# Follow-ups found while fixing the CE-684..688 follow-ups (session compute-engine-79, 2026-10-31)

The items of `docs/scratch/2026-10-30-ce684-688-followups-handoff.md` are
done (items 1 to 4 fixed, item 5 not a defect, item 6d fixed with the simple,
sound rule, item 6 now compiles through the WGSL statement form, item 7 stays
on demand). That work is in the main tree, reviewed, and waits to be staged
(staging-queue entry `compute-engine-79`). The defects below were found during
that work. Each is in older code that the work did not change, and none needs
a user decision, except where noted. Do one item per implementer agent, each
with its own dual review. Build each worktree from HEAD plus the patch of the
uncommitted work if it is not committed yet (`git diff HEAD` of the main tree,
only the files of entry `compute-engine-79` in the staging queue).

## GPU (GLSL/WGSL)

1. **A negated chain loses its parentheses: wrong value.**
   `Not(Less(3, y, x))` (also the canonical form of `NotGreater(x, y, 3)`)
   emits `!(3.0 < y) && (y < x)`. With y = 4, x = 1 the interpreter gives
   True and the shader gives false. Highest priority.
2. **WGSL `Match` computes a case body that draws when the case is not
   selected.** `WithRandomSeed(1, Match(n, MatchCase(1, Random()),
   MatchCase(_, 30)))` emits `select(30.0, _gpu_rnd_draw(…), n == 1.0)`.
   Use the statement form (as for caller code) or decline.
3. **`At` of a literal list drops caller code.** `W + At(List(1, 2, 3, 4, W),
   2)` with `vars: { W: 'nextValue()' }` emits `nextValue() + 2.0`: the second
   `W` never runs, and the interpreter evaluates the whole list.
4. **An unsized list free symbol compiles to a bare name.** With
   `U: list<real>`, GLSL compiles `U` with `success: true` and
   `lowered: 'array'`, a type no shader can declare. Cause: the fallback in
   `compile-references.ts`
   (`target.loweredSymbolType?.(symbol) ?? defaultLoweredSymbolType(...)`)
   uses the JavaScript types on a shader target.
5. **`Sum` and `Product` with several index clauses decline.**
   `Sum(i·j, Limits(i, 1, 3), Limits(j, 1, 2))` (interpreter: 18) declines
   with "multi-index (N indexing sets) is not supported". Nest the loops as
   the multi-clause `Loop` now does (`gpu-functions.ts`, `Loop`). Also update
   the old message in `compile-loops.ts` (about line 196, "a Loop compiles to
   a shader only over a single Range").
6. **`Break` and `Continue` in a GPU loop body decline, also with one
   clause.** `Loop(Block(If(i > 1, Continue()), s := s + i), Element(i,
   Range(1, 3)))` (interpreter: 1) declines with a message that does not name
   the cause.

## JavaScript and other targets

7. **`NotEqual(1, W, 3)` with caller code calls it twice.** Canonicalization
   keeps an n-ary `NotEqual` only when a middle operand is impure, and caller
   code (`vars: { W: 'nextValue()' }`) is pure to the engine, so the
   expression is `And(NotEqual(1, W), NotEqual(W, 3))` with one shared `W`
   node. Fix in the compiler: an `And` whose operands share a node that
   reaches caller code must bind it once (or decline).
8. **The `And`/`Or` run-time broadcast evaluates every operand eagerly.** The
   JavaScript `_SYS.bcastPlain` route for `And`/`Or` with an operand of
   unknown type evaluates all operands; the interpreter short-circuits when no
   operand is a collection by type. Probable `And(y > 0, f(y) > 0)` with `f`
   mapped calls `f` at `y = -1`. Not reproduced yet.
9. **`Limit(Sin, 0)`: `.N()` gives NaN, compiled code gives 0** (`Limit(Cos,
   0)`: NaN and 1; exact `evaluate()` stays unevaluated). Likely cause:
   `numericLimitValue()` does not apply a bare function symbol.
10. **`Integrate(Random(), Limits(x, 0, 1))` gives three results:**
    `evaluate()` one sample, `N()` the quadrature mean (about 0.5), compiled
    JavaScript one draw folded at compile time (every `run()` the same).
11. **Compiled `Integrate` with a NaN bound gives `Infinity`.** With
    `c := NaN`, the interpreter keeps `Integrate(2, Limits(x, 0, c))`
    unevaluated; compiled JavaScript emits `_SYS.integrate(…, 0, NaN)`.
12. **A function-valued bare symbol with a named variable.**
    `['Integrate', 'Sin', ['Limits', 'x', 0, 1]]` (or `g := x ↦ x²`): an
    `incompatible-type` error under `evaluate()`, unevaluated under `N()`,
    NaN compiled.
13. **`unknowns` of an implicit integral.** `ce.parse('\\int_0^1 x').unknowns`
    gives `['x']`, while `\int_0^1 x\,dx` gives `[]`.
14. **`assume` leaves bindings after a rollback.** `ce.assume(['Equal',
    ['Error', "'bad'"], ['Add', 'x', 'y'], 1, 2])` (and the same as an `And`)
    returns `contradiction`, but `x` and `y` stay declared: a rejected
    conjunct removes its claimed names from `tx.unattributed` for good
    (`assumeConjunct`, `assume.ts`), so a later conjunct that creates them
    again cannot claim them, and the rollback does not remove them.

## Decisions for the user (recorded, not for an agent)

- ROADMAP CE-699: one rule for the implicit variable after an assignment
  (`Integrate`, `D`, `Series`; `Limit` already changed).
- Precise versions that are on demand: an `Equal` chain over a domain that
  cannot be enumerated now stays unevaluated (`Solve(x² = 4 = x + 2, x ∈
  [-10, 10])` gave the correct `[2]`); `Cot(W)` with caller code alone
  declines although a temporary would be sound when nothing else is in the
  statement; the handoff's item 7 (`realOperandGuard` declines that one
  binding would avoid).

## Continuation prompt

> Execute `docs/scratch/2026-10-31-followups-of-ce684-688-followups-handoff.md`:
> one implementer agent per item, in a worktree each, each with its own dual
> review; item 1 first.
