# CE-532: the options for `ce.withValues()` (2026-11-07)

The issue file is `issues/CE-532.md`. This document holds the analysis of the
question that the issue asks the board.

The approved design was implemented (worktree `/tmp/wt-cebatch-532`,
`withValuesFn()` in `engine-declarations.ts`, 15 tests in
`test/compute-engine/with-values.test.ts`). Tycho's instrument reads READY on
it. But a declaration in a pushed scope does not reach the body of a stored
function or a stored held value: a call frame resolves its body through the
scope that defined the function, not through the caller's scope
(`bindingInContext()`, `binders.ts`). Tycho's `withValuelessVariablesBound()`
binds ONLY when the expression reads such a stored definition
(`readsStored()`), so with this design Tycho cannot remove its checkpoint
code.

Example, with `a` declared `real` and valueless:

- `f := x ↦ x + a`, then `ce.withValues({a: 1}, () => ce.parse('f(2)').evaluate())`:
  approved design `a + 2`; Tycho's checkpoint route `3`.
- `c := a + 1`, then `2c` evaluated inside `withValues({a: 1})`: approved
  design `2(a + 1)`; checkpoint route `4`.
- `a + 1` boxed before the call: `4` with every option.

Options:

- **(a) Keep the approved design** and document that a stored function or
  held value does not read the values. Cost: none in CE; Tycho keeps its
  checkpoint route, so the issue's purpose is not met.
- **(b) Write the visible binding for the call and restore it exactly**
  (recommended): for each name, take a snapshot of its definition, assign the
  value, run `fn`, and restore the snapshot in a `finally`, with a cache
  version advance. This reaches every read, as Tycho's route does, and works
  during an evaluation (a checkpoint is refused there). It reverses the
  sentence "the outer definition is never written". An expression created
  inside `fn` stays valid after it. Cost: about the same code as (a); the
  side effects of `assign()` outside the definition (a state event, a type
  narrowed on another binding by the value) are not undone.
- **(c) Keep the scope and add an override map** that the lookup reads when
  a call frame or a held value reaches an overridden definition. The outer
  definition is not written, but the call-frame rule of
  `docs/SCOPING-MODEL.md` changes for this case. Cost: a change in the core
  lookup, the highest risk.

If nothing is decided, the item waits; nothing is committed.

Review findings that apply to the code in the worktree whatever the choice:
declare every name before any value is assigned (a value `'q'` can narrow
the outer `q`); copy the declared skeleton (`_placeholderSkeleton`,
`_signatureSkeleton`) instead of the refined type, so `L: list` holding
integers accepts a string list as `assign()` does; an operator with an
inferred or derived signature must accept the values `assign()` accepts;
state that a declaration made inside `fn` is removed with the scope; add the
section of the evaluate guide on cortexjs.io; format the two long
signatures.

## The proposal that the user approved on 2026-11-06

Proposal: `ce.withValues(values, fn)` pushes a scope, declares each name in it
with the given value and the declared type of the visible binding (as the
internal `withValueShield()` does for valueless names), runs `fn`, and pops
the scope in a `finally`. The outer definition is never written, so nothing is
restored. An expression created inside `fn` must not be kept after `fn`
returns.

