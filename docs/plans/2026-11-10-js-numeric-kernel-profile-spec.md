# A `numeric-kernel` profile for the JavaScript target (step 7, first part)

**Status: proposed 2026-11-10. Two of its three choices are decided (see
"Choices for the user"); the names of the options are not. No code is written
from this document before the names are approved, because it adds public
compile options and changes the documented answer of `canCompile()`.**

## The situation

The structured route of the JavaScript compiler
([plan](2026-11-09-js-compiler-status-and-plan.md), steps 1 to 6) is internal:
only tests construct it. It compiles scalar arithmetic, conditionals, helper
calls, captured numbers, loops over an integer range and lists of numbers. For
each program it admits, the value equals the interpreter's and the doubles
equal those of the existing compiler. It also answers, per program, whether
two calls can run at the same time and whether the code can go to a worker
(`analyzeExecution()`).

A host cannot ask for any of this today. `compile(expr, { to: 'javascript' })`
always uses the existing compiler, and `canCompile()` answers `ok: false` for
every target but `glsl`.

## The proposal

Three additions to the options of `compile()` and `canCompile()` for
`to: 'javascript'`, and one addition to the result. Nothing changes for a
call that does not pass the new options.

1. **`profile: 'numeric-kernel'`.** The expression is compiled by the
   structured route. A program outside the profile declines, with the
   diagnostic code `outside-profile` and the first node outside it; the
   `fallback` option then applies as it does today. The existing compiler is
   never used for a part of such a compilation.
2. **`requires: { independentCalls?: true, workerPortable?: true }`.** Each
   requirement that the analysis cannot establish makes the compilation
   decline, with the code `requirement-not-met` and the operation that
   prevents it. A requirement is never assumed from the host's intent.
3. **`canCompile()` answers for this profile**, with the same preparation and
   the same options as `compile()`: `ok: true` exactly when `compile()` gives
   code.
4. **The result reports what was established**: `result.profile`, and
   `result.execution` with `independentCalls`, `workerPortable` and the loop
   candidates. These are facts about the compiled program; they do not start
   any parallel execution.

Under the profile, the options `cse` and `constantFold` have no effect on the
code: the route does neither, and it ignores both options while the profile
is experimental. The guide says so. The modes are `strict` and `complex`;
`bigint` declines.

## Example

```
heatstep(H: list<real>, diffusivity: real, boundary: real, obstacle: real) -> list<real>
```

| Call | Today | Under the proposal |
| --- | --- | --- |
| `compile(heatstep, { to: 'javascript' })` | existing compiler | the same, unchanged |
| `compile(heatstep, { to: 'javascript', profile: 'numeric-kernel' })` | the option is unknown | structured route; `result.execution.independentCalls` is `true`; the loop is a candidate |
| the same with `requires: { workerPortable: true }` | — | compiles; the requirement holds |
| `compile(f, { …profile… })` where `f` calls `Random()` | — | declines with `outside-profile`, naming `Random` |
| `canCompile(heatstep, { to: 'javascript', profile: 'numeric-kernel' })` | `ok: false` | `ok: true` |

## What is not in this part

- No consumer moves. `Map`, integration, the solvers and Tycho keep the
  existing compiler until each is moved by its own change, with its own
  checks.
- No `program` profile, no registered `javascript-fragment` target name, no
  parallel execution of a loop.
- No change of the default. The existing compiler stays the default route.

## Choices for the user

Decisions: choice 1, the `profile` option of the `javascript` target:
approved 2026-11-10. Choice 3, `cse` and `constantFold` are ignored under the
profile during the experimental phase: approved 2026-11-10. Choice 2, the
names: open.

**1. An option of the `javascript` target, or a separate target name.**
The original proposal named a separate registry key, `javascript-fragment`.
This document proposes an option instead (recommended): the emitted language,
the runtime and the result type are those of `javascript`, and a host changes
one option to compare the two routes on the same call. A separate name keeps
the two routes apart in every table that is keyed by target, and needs an
audit of the code that compares target names. Saying no to the option means
the separate target name, with that audit as part of the work.

**2. The names.** `profile: 'numeric-kernel'` and
`requires: { independentCalls, workerPortable }` are proposed. They become
public and documented; changing them later is a breaking change.

**3. `cse: true` or `constantFold: true` with the profile: an error, or
ignored.** An error is proposed: a host that passes them expects their
effect. Ignoring them makes the profile a drop-in option for existing call
sites, at the price of an option that silently does nothing.

## The two requirements, defined

**`independentCalls`.** Two calls of the compiled function, with any
arguments, give the same results whether they run one after the other or at
the same time in two workers. It holds when no operation of the program or of
a function it calls has an effect or an unknown effect, and no array that
the host passed in is written (a list argument is only read; an update in
place writes only into a list that the call built itself). A captured value
is a number copied at compile time, so no call can change it. It does not
say that the host may change an input array while a call reads it, that the
calls will run in parallel, or anything about a function passed at run time.
With an iteration budget, a yes carries a caveat: the pass counter belongs
to the runtime; calls are synchronous, so two calls on one thread cannot
interleave, and each worker has its own runtime.

**`workerPortable`.** The compiled code, sent to another worker as text,
computes the same results there. It holds when every function it calls is
compiled into the same program, every captured value is a number written
into the code, and no operation has an effect or an unknown effect (an
unknown operation can be a host closure, which a worker does not have; for a
known effect the facts do not yet say whether a worker has it, so the answer
is no). It does not say that the arguments can be transferred cheaply, or
that the calls are independent: that is the other property.

If nothing is decided, the route stays internal and steps 5 and 6 remain
available only to tests.

## Checks for the change

- `canCompile()` and `compile()` agree on every program of the structured
  test files and of the prelude census, with and without each requirement.
- Each diagnostic names its node; a test per code.
- The options are part of the stored-code metadata, and a result compiled
  under one profile or requirement is never reused for another.
- The public guides in `~/dev/cortexjs.io/docs/compute-engine/` and
  `CHANGELOG.md` describe the options as experimental.
- The existing tests of `compile()` and `canCompile()` pass unchanged.
