# A `numeric-kernel` profile for the JavaScript target (step 7, first part)

**Status: approved 2026-11-10.** Decisions: the `profile` option of the
`javascript` target selects the route (no separate target name); `cse` and
`constantFold` are ignored under the profile during the experimental phase;
no `requires` option; the result reports `pure` and the existing `shippable`.

## The situation

The structured route of the JavaScript compiler
([plan](2026-11-09-js-compiler-status-and-plan.md), steps 1 to 6) is internal:
only tests construct it. It compiles scalar arithmetic, conditionals, helper
calls, captured numbers, loops over an integer range and lists of numbers. For
each program it admits, the value equals the interpreter's and the doubles
equal those of the existing compiler with `cse: false` and
`constantFold: false`. It also answers, per program, whether
the function is pure and whether its code can go to a worker
(`analyzeExecution()` in `structured-execution.ts`).

A host cannot ask for any of this today. `compile(expr, { to: 'javascript' })`
always uses the existing compiler, and `canCompile()` answers `ok: false` for
every target but `glsl`.

## What is added

One option of `compile()` and `canCompile()` for `to: 'javascript'`, and two
facts in the result. Nothing changes for a call that does not pass the option.

1. **`profile: 'numeric-kernel'`.** The expression is compiled by the
   structured route. A program outside the profile declines, with the
   diagnostic code `outside-profile` and the first node outside it; the
   `fallback` option then applies as it does today. The existing compiler is
   never used for a part of such a compilation.
2. **`canCompile()` answers for this profile**, with the same preparation and
   the same options as `compile()`: `ok: true` exactly when `compile()` gives
   code. Its answer also carries `pure` and `shippable`, so that a host can
   learn them before it compiles.
3. **The result reports two facts**: `result.profile`, `result.pure`, and the
   existing `result.shippable`, set from the analysis. They are facts about
   the compiled program; they do not start any parallel execution.

Under the profile, the options `cse` and `constantFold` have no effect on the
code: the route does neither, and it ignores both options while the profile
is experimental. The guide says so. The modes are `strict` and `complex`;
`bigint` declines.

There is no `requires` option. A host that needs a property reads it in the
result, or in the answer of `canCompile()`, and decides. An option would be
needed only if a requirement changed how the code is generated, and nothing
does that today.

## The two facts, defined

**`pure`.** Two calls of the compiled function, with any arguments, give the
same results whether they run one after the other or at the same time in two
workers, and a call changes nothing that the host can observe. It holds when
no operation of the program or of a function it calls has an effect or an
unknown effect, and no array that the host passed in is written (a list
argument is only read; an update in place writes only into a list that the
call built itself). A captured value is a number copied at compile time, so
no call can change it. It is the meaning of `pure` in a function declaration
and of `isPure` on an expression. It does not say that the host may change an
input array while a call reads it, that the calls will run in parallel, or
anything about a function passed at run time. An iteration budget does not
change the answer: when the budget is exceeded the call throws, and the pass
counter belongs to the runtime of each thread.

**`shippable`.** The existing field of `CompilationResult`
(`compilation/types.ts`): whether the compiled code can be sent to a worker
of the pool. Under the profile it is true when every function the code calls
is compiled into the same program, every captured value is a number written
into the code, and no operation has an effect or an unknown effect (an
unknown operation can be a host closure, which a worker does not have; for a
known effect the facts do not yet say whether a worker has it, so the answer
is false). It does not say that the arguments can be transferred cheaply.

Today every program that is shippable under the profile is also pure,
because both exclude effects. The two differ for a later program that calls
a pure function of the host: pure, and not shippable.

The loop candidates of `analyzeExecution()` are not in the public result.
They stay internal until an execution route uses them.

## Example

```
heatstep(H: list<real>, diffusivity: real, boundary: real, obstacle: real) -> list<real>
```

| Call | Today | With this change |
| --- | --- | --- |
| `compile(heatstep, { to: 'javascript' })` | existing compiler | the same, unchanged |
| `compile(heatstep, { to: 'javascript', profile: 'numeric-kernel' })` | the option is unknown | structured route; `result.pure` and `result.shippable` are `true` |
| `compile(f, { …profile… })` where `f` calls `Random()` | — | declines with `outside-profile`, naming `Random` |
| `canCompile(heatstep, { to: 'javascript', profile: 'numeric-kernel' })` | `ok: false` | `ok: true`, with `pure: true` and `shippable: true` |

## What is not in this part

- No consumer moves. `Map`, integration, the solvers and Tycho keep the
  existing compiler until each is moved by its own change, with its own
  checks.
- No `program` profile, no registered `javascript-fragment` target name, no
  parallel execution of a loop.
- No change of the default. The existing compiler stays the default route.

## Checks for the change

- `canCompile()` and `compile()` agree on every program of the structured
  test files and of the prelude census.
- Each diagnostic names its node; a test per code.
- `result.shippable` under the profile agrees with what `broadcastAsync()`
  and the kernel pool do with the result: a shippable result runs in a
  worker and gives the same values.
- The profile is part of the stored-code metadata, and a result compiled
  under the profile is never reused for a call without it, or the reverse.
- The public guides in `~/dev/cortexjs.io/docs/compute-engine/` and
  `CHANGELOG.md` describe the option and the field as experimental.
- The existing tests of `compile()` and `canCompile()` pass unchanged.
