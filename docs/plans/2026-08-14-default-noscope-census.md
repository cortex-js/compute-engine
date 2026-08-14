# Default-`!scope` exploration: escaping-write census

**Status: design exploration, NO ruling yet** (2026-08-14). This document
records a measurement, not a decision. The proposal below is open until the
user rules on it.

## The proposal

Make the default effect bound for function definitions "everything except
`scope`": a function body containing a write that escapes its own scope
(mutating a binding that outlives the application) is rejected at install
unless the definition's specifier slot explicitly says `scope`. Every other
effect label (`random`, `entropy`, capability labels, …) stays on the
inferred track exactly as ruled in the bare-specifier fork
(`docs/EFFECTS-MODEL.md`); this proposal reverses that ruling for the
`scope` label only.

Rationale for the asymmetry: an escaping write is always a deliberate
design choice by the author, so requiring an annotation matches the
"annotation is for chosen contracts" ergonomics principle — whereas "my
body happens to call `Random`" is often incidental and fine to infer.

No new syntax is needed. `!scope` is expressed by *absence*: the existing
`scope` specifier (already parsed and serialized, e.g.
`(number) scope -> number`) becomes the opt-in, and a bare slot becomes the
guarantee. The internal co-finite effect representation (`{not: [...]}`)
stays internal; nothing new reaches the surface grammar.

**Enforcement rule (load-bearing):** the ceiling must key on the
confinement analysis's *proven* escaping writes — the unconfined branch of
`scopeWrite` in `src/compute-engine/boxed-expression/effects-inference.ts`
— never on conservative `effectsOf`. The conservative channel reports
`{any}` for unresolved forward-referenced heads, which contains `scope`;
rejecting on that verdict would break mutual recursion and every
forward-referencing bare definition.

## What the change would buy

Unannotated code could no longer mutate the world during evaluation: any
function whose transitive call graph contains no `scope`-annotated
definition cannot invalidate a binding mid-expression. Consequences:

- The state-event invalidation axes only need to matter *between*
  top-level statements, not mid-evaluation — the self-invalidation bug
  class (three instances found to date) becomes structurally impossible
  for the unannotated majority.
- Sibling-operand evaluation order becomes unobservable for that majority
  (legal to reorder, skip lazily, or parallelize).
- Caches stamped at evaluation entry stay valid for the whole evaluation.

`scope`-annotated functions keep today's write-through semantics
unchanged; the change makes the *absence* of the annotation a guarantee
instead of a guess.

## Census method

A temporary env-gated hook (`CE_SCOPE_CENSUS`) was placed on the
unconfined-write branch of `scopeWrite` — the exact site the ceiling would
check — emitting one JSON line per proven-escaping write with stack-derived
test attribution. The full jest suite ran green under the flag (26,726
passed, 4,269 snapshots, exit 0). The hook was removed after the run; it is
not in the tree.

## Results

**49 distinct (test file, write) pairs across 18 of 493 suites; zero
escaping writes in the real-program corpus** (all three
`docs/scratch/cache-stats-workloads.ts` workloads including the recursive
Epsil JSON parser, `demo.epsil`, and every vscode-epsil example and
fixture).

Classification of the 49:

| Bin | Count | Disposition under the proposal |
| --- | ---: | --- |
| Effects suites themselves (`user-function-purity`, `effects-contracts`, `effects-of`, `effects-call-boundary`, `effects-currying`, `epsil/effects`) | ~20 | Spec tests that deliberately construct escaping writes; updated as part of the feature |
| Compile suites (`compile.test.ts`, `compile-destructuring-from-call`, `list-valued-summand-compile`, `compile-elseless-if-statement`, `map-auto-compile`) | ~16 | Mostly writes to the function's own parameters or assignment-without-`let`; dissolve with the parameter-frontier fix below |
| Protocol field setters (`Assign(Field(p, "name"), v)` in `protocol-dispatch-compile`, `protocol-properties`) | 5 | Mutating a parameter's object genuinely escapes; natural long-term home is the mutable-objects track's `state` label (currently inert), `scope` until then |
| Genuine closure-counter idiom (`scope.test.ts` closure-mutation pins, `lambda-capture`, `makeCounter` in `epsil/programs.test.ts`, the counter example in `epsil/documentation.test.ts`, `map-fusion` "leaked") | ~8 | The real breakage; each fixed by a one-word `scope` annotation |

## Probe results that shape the design

1. **Top-level accumulation loops are untouched.** `let total = 0; for k
   in Range(1, 10) { total = total + k }` produced zero census events —
   loop bodies at top level never route through the function-literal walk,
   so the most common stateful idiom needs no annotation.

2. **Parameter mutation is call-local but conservatively flagged.**
   Probed: `function f(x) { x = x + 1; x }; let a = 5; f(a)` — `f` returns
   6 and `a` stays 5, so a write to one's own parameter never escapes. But
   the confinement frontier (`ctx.declared` in `scopeWrite`) contains only
   `Declare`d locals, not parameters, so such writes are stamped `scope`.
   Sound over-approximation today; under a ceiling it becomes a false
   rejection. **Prerequisite fix: admit parameters to the confinement
   frontier.** This is a precision improvement independent of the
   proposal and accounts for most of the compile-suite hits.

## Rollout sketch (if ruled yes)

1. Admit parameters to the confinement frontier in `scopeWrite`.
2. Flip the bare-slot default for the `scope` label only: at install, a
   proven-escaping write in a bare-slot definition errors with a message
   naming the fix ("add `scope` to the signature").
3. Migrate the ~8 civilian sites and the documentation counter example
   (one-word annotations); update the effects suites.
4. Protocol setters ride `scope` until the `state` label becomes real.

Total migration cost in this repository: roughly a dozen one-word
annotations. Breaking change for user code that uses the closure-counter
pattern; the error message makes the fix self-evident.
