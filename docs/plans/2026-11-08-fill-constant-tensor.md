# `Fill(value, d1, d2, …)`: a tensor filled with one value

Status: approved 2026-11-08, with an empty list for an extent of 0
(decision 2). Implemented.

## The problem

1. **`Fill(f, (m, n))` gives the same values as `Tabulate(f, m, n)`.** Both
   call `f(i, j)` with 1-based indexes and build an m×n matrix. The compiled
   JavaScript of the two is the same code (the `Fill` and `Tabulate`
   lowerings in `compilation/javascript-target.ts`). `Fill` makes only
   matrices and takes its extents as one tuple; `Tabulate` takes one or two
   extents as separate operands.
2. **`Fill` has a defect that `Tabulate` does not have.** Indexing a `Fill`
   gives a cell, while its length and its walk give rows:

   | Input, with `f = (i, j) ↦ 10i + j` | `Fill(f, (2, 3))` | `Tabulate(f, 2, 3)` |
   | ---------------------------------- | ----------------- | ------------------- |
   | value                              | `[[11,12,13],[21,22,23]]` | the same |
   | `Length(…)`                        | `2`               | `2`                 |
   | `At(…, 2)`                         | `12` (wrong)      | `[21,22,23]`        |
   | type                               | `list`            | `matrix<integer^(2x3)>` |

3. **There is no operator that fills a tensor of any shape with one value.**
   `Zeros(d1, …)` and `Ones(d1, …)` (added 2026-11-08, not yet committed)
   fill with 0 and 1. `Repeat(value, count)` makes only a list. `Repeat`
   cannot take more counts: a library operator has one signature, a
   signature cannot have both an optional parameter and a variadic one, and
   the named call `repeat(x, count: 3)` is documented.

## The proposal

1. **`Fill` gets a new meaning**, the meaning of Julia's `fill(x, dims...)`:
   `Fill(value, d1, d2, …)` is a tensor with one axis for each extent, and
   each cell is `value`. Signature `(value: any, integer+) -> list`. In
   Epsil, `fill(7, 2, 3)`.
   - `Fill(7, 3)` is `[7,7,7]`; `Fill(7, 2, 3)` is `[[7,7,7],[7,7,7]]`.
   - The value is evaluated once, as for every operand that is not lazy:
     `Fill(Random(), 2, 2)` is four copies of one number, as
     `Repeat(Random(), 4)` is. A function value is a cell, not called:
     `Fill(f, 2)` is `[f, f]`.
   - An extent of 0 or less gives an empty axis, as `Repeat(x, 0)` does:
     `Fill(7, 0)` is `[]`, `Fill(7, 2, 0)` is `[[], []]` (decision 2). The
     axes after an empty axis are not reached: `Fill(7, 2, 0, 3)` is
     `[[], []]`, of rank 2, and its type is `matrix<integer^(2x0)>`. A
     symbolic extent (`Fill(7, n)`) leaves the expression unevaluated.
   - The type is `list<T^(d1×d2×…)>`, with `T` the type of `value` widened
     as a list literal widens its elements, when every extent is an integer
     literal, there are at most 10,000 cells and `T` is a scalar type (a
     dimensioned list type cannot have list cells). Otherwise it is a `list`
     nested once per extent, with no dimensions.
   - Above 10,000 cells the result is lazy: no cell is made before it is
     read. The lazy form must not capture a free symbol of the value (a
     value `i` inside a `Function` of a parameter `i`), so it is a nested
     `Repeat(Repeat(value, d2), d1)`, not a `Tabulate`.
2. **`Zeros` and `Ones` stay**, as the short names that NumPy, Julia and
   MATLAB users expect. The three operators use one implementation, so the
   extent rules of item 1 apply to all three.
3. **The old form is removed.** `Fill(f, (2, 3))` gives an
   `incompatible-type` error, because a tuple is not an integer: an old call
   fails, it does not give a different value. The CHANGELOG entry (Breaking
   changes) tells callers to write `Tabulate(f, 2, 3)`. This also removes
   the defect of item 2 of the problem.
4. **Compilation.** The `Fill` lowerings of the JavaScript and Python targets
   and the `Fill` entry of `compilation/compile-callbacks.ts` are removed.
   The new `Fill` has no lowering: a constant `Fill` is folded to its value
   as `Zeros(3)` is, and every other `Fill` declines to the interpreter. A
   lowering is a separate task, done when a `corpus` or `plausible` witness
   needs it.

## What changes

- `library/collections.ts`: the `Fill` definition, `FILL_SUPPLY` and
  `fillDims()`; the shared implementation goes in `library/linear-algebra.ts`
  next to `Zeros`, or `Fill` moves there.
- Tests: the `Fill` cases of 8 test files move to `Tabulate`, or are removed
  where a `Tabulate` case already covers the same behavior
  (`collections.test.ts`, `callback-arity.test.ts`, `lazy-view-scope.test.ts`,
  `lazy-collection-regimes.test.ts`, `compile.test.ts`,
  `compile-predicate-errors.test.ts`, `compile-python-parity.test.ts`,
  `tycho-62urmx2dcm-map-lambda-hoist.test.ts`). New tests for the new form.
- Documentation: the `Fill` section and the three other mentions in
  `82-reference-collections.md` on cortexjs.io; the lists of operators in
  `docs/BROADCAST-MODEL.md` and `docs/RANDOMNESS-MODEL.md`; the generated
  Epsil pages and `OPERATORS.json`.
- Tycho: no change. It names `Fill` in two sets of operator names
  (`plot-core/list-materialize.ts`, `plot-core/ce-type-guards.ts`) and never
  builds a `Fill`. The new `Fill` belongs in both sets too: its count comes
  from scalar operands, and its large form is lazy.

## Decisions for the user

1. Reuse the name `Fill` for the new meaning (this proposal), or remove
   `Fill` and give the constant fill another name. Reuse `Fill`: approved
   2026-11-08.
2. An extent of 0: an error, as for `ZeroMatrix` and `IdentityMatrix`, or
   an empty list, as for `Repeat(x, 0)` and NumPy. An empty list: approved
   2026-11-08. `Fill(7, 0, 3)` is `[]`, and the type of such a tensor has a
   zero extent (`matrix<integer^(0x3)>`). A negative extent also gives an
   empty axis, as for `Repeat`; no error code exists for it.
