# CE-1102: when may the registry of waiting definitions forget a definition?

Status: waits for a decision of the board (2026-11-07).

## The problem

A `Function` literal whose body applies a name that has no definition yet
(`h` in `f := x ↦ h(x) + 1`) registers its definition in the registry of
`src/compute-engine/boxed-expression/provisional-application.ts`
(`DEPENDENTS`, `REGISTRATIONS`). When `h` later gets a definition, the
registry finds `f` and re-derives it, so `h(x)` reads as a call and not as
the product `h·x`. The registry holds each definition strongly. Only a
redefinition of the same name (`updateDef`) takes the old definition out.

Measured at `ad6570a95` with a script that pushes a scope with
`ce.pushScope()`, assigns `f_i := x ↦ h_i(x) + 1` for i = 0..99 and pops the
scope, twelve times: after each pop 100 more definitions wait in the
registry (100, 200, … 1,200), and the heap after a full garbage collection
grows about 2 MB a pass (90 to 114 MB).

## The approach that was tried, and why it does not work

The issue proposed: at the pop of a scope, take its definitions out of the
registry. A first version did this only for a scope that `ce.pushScope()`
made itself (no `scope` argument), at a pop that is not dormant, when no
other frame has the scope. It removed the growth (0 waiting definitions
after each pop; heap 91 to 93 MB in 12 passes).

The review found that Tycho's notebook pushes such a scope, keeps it, and
pushes it again later: `enterScope()` calls `ce.pushScope(undefined)` and
stores `ce.context.lexicalScope` (`~/dev/tycho/src/graph-paper/notebook/
ce-notebook-evaluator.ts`, `pushFrame()`), and each group of the compute
graph enters its kept scope again (`notebook-compute-graph.ts`, `enter()`).
A scope made by `pushScope()` is therefore not dead at its pop.

Example. Group scope S: a cell defines `f(x) := h(x) + 1`, `h` has no
definition. The graph leaves S (pop), then the user defines `h` in the
document scope, then the graph enters S again.

- Today: the definition of `h` re-derives `f`; `f(2)` is `h(2) + 1`.
- With the tried fix: `f` was taken out at the pop; `f` keeps the product
  reading `2h + 1` until `f` is defined again.

The same applies to a caller-owned scope made by `ce.createScope()` while the
pushed scope is current: its parent is the pushed scope, so the definitions
stay reachable after the pop.

## The options

**(a) Weak references.** The registry holds a `WeakRef` to each definition,
and prunes a reference when its target is collected (when a set is read, and
when a set doubles in size since its last pruning). No rule about the life
of a scope is needed: a definition that a scope, an expression or a closure
can still reach stays registered and is re-derived as today. Cost: one
result depends on the time of the garbage collection. `ce.withValues()`
refuses a value for a name that a waiting body applies
(`engine-declarations.ts`, "the body of a function applies"). For a name
that only unreachable bodies apply, it refuses until the collector frees
them, and accepts after.
Example: push, `f := x ↦ k(x) + 1`, pop, `ce.withValues({ k: 2 }, …)`:
today it throws; under (a) it throws or returns, by the time of the last
collection. Note: a test of (a) must yield to the event loop between
passes, because V8 keeps the target of a `WeakRef` made in the current job
until the job ends. A host that pushes and pops many times in one
synchronous job keeps the definitions until the job ends.
Size: S (about 60 lines in `provisional-application.ts`).

**(b) Park at the pop, put back at the push.** The pop of any scope that is
not retained moves its waiting definitions out of the registry into a weak
map keyed by the scope. A push of a scope that has parked definitions
registers them again and re-derives each one whose waiting name gained a
definition while the scope was off the stack. The result is the same as
today for every scope that is pushed again, and deterministic. Cost: the
push must decide "the name gained a definition" with the same rule as
`updateDef` (an operator definition, a function-typed value, or a value of
a known type that is not a function; an `unknown` placeholder decides
nothing), which is a second copy of that rule. Each re-entry of a notebook
group pays a re-registration. A definition kept by a closure or a
caller-owned child scope while its scope is off the stack is not
re-derived until the scope is pushed again (a value read through the
closure meanwhile keeps the product reading).
Size: M.

**(c) No change in CE.** Tycho makes a new engine when the registry grows
(the issue says Tycho has no other workaround). The leak stays.

## Recommendation

(a). It makes no assumption about the life of a scope, so no host pattern
loses a re-derivation, and it is the smaller change. The only effect of the
time of collection is whether `withValues()` refuses a name that only
unreachable bodies apply, a refusal that is wrong in that case today.
Saying no to (a) means (b), with its second copy of the `updateDef` rule, or
(c), with the leak.
