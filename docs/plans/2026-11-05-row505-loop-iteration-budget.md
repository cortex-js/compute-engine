# A limit on compiled `Loop` passes, set at compile time (Tycho row 505)

Status: implemented, and the user has not read the details. The user chose on
2026-11-05 a limit that is a property of the compile phase, not of the engine,
with no check when no limit is given. The user then asked for the Tycho reports to
be addressed while away. So the details below are the author's choices. Each one
lists its alternative, so the user can reverse it. Delete this file when the user
has read them: `docs/COMPILATION-MODEL.md`, "A limit on `Loop` passes", states the
contract.

## Choices made in the implementation

- **A clause iteration counts, not only a body pass.** `Loop(b, Element(i, 1..3),
  Element(j, 1..3))` counts 12, as the two nested `Loop`s that it equals do.
  Otherwise `Element(i, 1..4e9, i < m)` with `m` at 0 runs every element with no
  check, because no body pass runs. Alternative: count the innermost body only.
- **A `broadcast()` cell over the limit gives `NaN`, and the batch goes on.** Each
  cell catches its own error, and each starts at 0, so a batch costs up to
  cells × budget. A sync `broadcast()` gives no report of the failure. Alternative:
  a cell rethrows, which stops the batch and loses the values of the other cells.
- **A `Limit` reads a sample over the budget as `NaN`.** The numeric ladder of
  `Limit` compiles with this option, and `NaN` is its signal to stop at that sample,
  as it is for `Sum`. So `N(Limit(...))` over a `Loop` keeps its value, and only a
  host that sets the option gets the throw. Alternative: none that keeps those
  values.
- **A compiled value that is a function declines when it counts passes,** unless it
  is a function literal, whose calls each reset the count. Without this, the calls
  of such a function would share one total, and a valid call would throw.
  Alternative: reset in each emitted function, which adds a handler.

## The problem

`Loop(k := k + 1)` compiles to JavaScript as `while (true) { k = k + 1 }`. It does
not return, also under `ce.withTimeLimit({ ms: 500 })`, because emitted loops have
no check. `Loop(Block(k := k + 1, If(k < 0, Break())))` and a range of `1..1e12`
have the same effect. The interpreter stops all three with
`iteration-limit-exceeded`. A host page that runs an imported document can hang.

## The contract

1. **The option.** The existing compile option `iterationBudget` also limits
   `Loop`. No new public name. It is already a compile-phase option, and it caps
   the trip count of emitted `Sum` and `Product` loops. Alternative: a new option,
   which would add a second limit with a similar name. No file in Tycho's `src`
   uses `iterationBudget`, so the extension changes no current result there.
2. **No limit, no check.** Without `iterationBudget`, the emitted code is the same,
   byte for byte, as before this change.
3. **What counts.** One pass of a compiled `Loop` body, in all three loop shapes
   (no indexing set, counted, for-each), counts one. The count is one total for a
   call of the compiled code. It covers nested loops and loops in the bodies of user
   functions: a limit for each loop would allow budget² passes for two nested loops.
4. **Over the limit.** The code throws `CancellationError`, with the cause
   `iteration-limit-exceeded` and a message that names `iterationBudget`. A `Loop`
   has no value to replace, and the statements after it would read partial state, so
   the `NaN` of `Sum` does not apply. The throw is not caught by a compiled `catch`,
   and it does not start the interpreter fallback.
5. **A count, not a time.** The limit is deterministic, so a test and two machines
   agree, and it needs no clock. A host that wants a time limit measures the cost of
   a pass. Alternative: milliseconds, checked each 1024 passes. Measured in plain
   Node on a loaded machine, as an estimate: a count check adds about 0.5 ns to a
   pass and a clock check about 1 to 3 ns, and each is paid only when the option is
   set.
6. **Targets.**
   - `javascript` and `interval-js`: as above.
   - `python`: a program with a `Loop` declines when the option is set, because
     the code cannot honor the limit. This fails closed.
   - `glsl`, `wgsl`: no change. A shader cannot throw, its loop bounds are known at
     compile time, and a `Loop` with no indexing set already declines.
7. **Not covered.** `Sum` and `Product` keep their own rule (the loop gives `NaN`).
   A helper of the runtime over a list that exists is finite, and is not counted.
   One long call inside a pass is not interrupted. `ce.withTimeLimit` still does not
   stop compiled code: it belongs to the engine, and this limit to the compile phase.

## Tests

- Each of the three forms in the problem section, with a budget, throws
  `CancellationError` with that cause. A loop with fewer passes than the budget gives
  the same value as with no budget, and exactly at the budget it does not throw.
- Two nested loops count together. A loop in a user function counts in the same total.
- A second `run()` starts its count at 0.
- With no option, the code holds no check: the emitted text is the same.
- Stored code run through `createJavaScriptRuntime()` keeps the limit.
- `interval-js` throws too. `python` declines. `glsl` and `wgsl` are unchanged.
- The `bigint` mode does not turn the throw into `NaN`.

## Documents

`docs/COMPILATION-MODEL.md`, the doc comment of `iterationBudget` in
`compilation/types.ts`, `CHANGELOG.md`, and the compile guide of cortexjs.io.
