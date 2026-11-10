# A `numeric-kernel` profile for the JavaScript target (step 7, first part)

**Status: proposed 2026-11-10. Not approved. No code is written from this
document before the user approves it, because it adds public compile options
and changes the documented answer of `canCompile()`.**

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
code: the route does neither. Passing `cse: true` or `constantFold: true`
with the profile is an error of the options, not a silent difference. The
modes are `strict` and `complex`; `bigint` declines.

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
