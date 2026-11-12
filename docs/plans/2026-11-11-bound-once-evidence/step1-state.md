# Bound once, step 1: state of the worktree

Worktree `/tmp/wt-compute-engine-ad-step1`, detached at 5eb1778b5. No commit,
no stage. Spec: `docs/plans/2026-11-11-bound-once-spec.md` in the MAIN tree
(sections 10 and 11 are the decisions; D5 final, D6, D7).

## Built (all in the working tree)

- Bound once (spec sections 2, 10): a free name resolves from its home scope,
  an occurrence with a definition from `_defHome` (`homeChainBinding`), cached
  in `_resolution` keyed by the type version and checked against its scope.
  `readsActivation()` (`binders.ts`) selects parameters, binder variables and
  block locals; they still use `bindingInContext()`.
- C3: no ambient chaining (`scope-chaining.ts` deleted). C5: `popScope()` of a
  frame that is not a call frame releases subscriptions only.
- Value shield without writes: `boxed-expression/hidden-values.ts`, read in
  `_BoxedValueDefinition.value`; key in the shared evaluation memo.
- D5 final: no rebinding of a boxed operand beyond the two existing
  mechanisms (`bindBindingSites` post-phase, `rebindParameters`); `Block` does
  not rebind. `nestDependentLimits()` boxes the nested operators from `.json`.
- D7: renamed calls in `compilation/shadowing-calls.ts` are bound to the
  copies of the inner scope; no callable-home read.
- Tests: `test/compute-engine/bound-once.test.ts` (rows, D5 rows, D6 table and
  hard cases 5 to 7, each with debug off and on).

## Failing in the 423 files before D6 step 1

- `compile-javascript-structured-blocks` "short-circuit operand" and
  `-random` "a Sum whose body draws": their owner changes the helper to
  `ce.box(['Function', expr.json, ...names])` (verified by a probe).
- `closure-frame-retained` "dependent limit", debug true: D6.
- `compile-shared-binder-body` "gives the value of evaluate()": D6 (the
  nested `Sum` scope does not reach the call frame).

## Decided for D6 (coordinator, 2026-11-11)

An activation holds values, not copies of definitions; the definition of a
parameter, binder variable or block local is the static one on every route.
A value read or write goes to the activation of its scope found by following
links from the current activation; none found: no value. The type is that of
the static definition (rule 4 of slice 1); a test that needs the type to
follow a run's value is reported, not decided.

## First attempt of step 1 (reverted)

Copies of definitions per activation broke `D`, `DSolve`, `JacobianMatrix`
and Rubi programs (`Simplify(D(x^2 + a x, x))`). The patches are in the
session scratchpad (`step1-*.diff`). Time before step 1: calculus 11.7/11.5 s,
simplify 2.6/2.3 s, integrate-symbolic-pole 19.2/18.5 s (load 7.5).

## Step 1, value records (built)

- `ambient-chain.ts`: `scopeActivation(parent, scope)` makes the activation
  (the template's binding records, a record `static def → value` started
  from `_staticValue()`, parent = current lexical scope);
  `activationRecordOf(def, from)` follows the links; `isActivatedDefinition`;
  `holdsActivation`.
- `boxed-value-definition.ts`: `storedValue` and the value setter of an
  activated definition read and write the record; `_staticValue()`.
- `boxed-function.ts` (both routes) and the four comprehension pushes of
  `control-structures.ts` push `scopeActivation()`; `inActivatedParent`,
  `asyncScopeActivation`, `_cloneForActivation` uses there are gone.
- `engine-scope.ts`: the pop of an activation skips its template's records
  (no dispose, no tombstone); the template tombstones are gone.
- `function-utils.ts`: a captured nested scope is an activation holding the
  values; `isInUse` counts a scope with a live activation; a renamed block
  local keeps `_blockLocal`; `rerootScopes` keeps a closure value not below
  the renamed binder; `bindEscapingLocals` replaces the block locals that a
  lazy comprehension reads.
- `lazy-view-context.ts`: a view made outside every call, in an activation,
  records the stack of its creation.
- `library/utils.ts`: `nestDependentLimits` back to the base form.
