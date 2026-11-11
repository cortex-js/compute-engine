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

## Names with no declared type (approved 2026-11-10, after the first run of the switch)

Under the profile, a parameter of a `Function` literal or a free symbol with
no **declared** type is a real number in the `strict` mode and a complex
number in the `complex` mode. The type that the engine inferred for it is
not read. The first rule of this spec required a declared type; the run of
the engine's own compilations with the profile
([result](2026-11-10-js-profile-first-consumer.md)) showed that this rule
alone caused about 5,200 of 5,801 declines.

- **Why the inferred type is not read.** The engine narrows an undeclared
  free symbol each time an expression that uses it is boxed, and keeps the
  result on the engine: `x` is `unknown` after `x < 1`, `number` after
  `Sin(x)`. A rule that read it would admit or decline a program by what
  was boxed before it.
- **The host's part.** A name that the host does not declare is a scalar
  number. A value of another shape for it is outside its type, and the
  result is unspecified, as for a declared type. This is an exception, for
  the profile, to rule R1 of `docs/COMPILATION-MODEL.md` (an input typed
  `unknown` is refused).
- **A conflict declines.** A body that uses the name as a list
  (`At(L, 1)`) or as a condition (`If(b, 1, 2)`) declines: the host
  declares the name.
- **The result lists the names** that took the default type, so that a host
  can find a name it did not mean to leave undeclared (`x + u` with a typo
  `u` compiles, and `u` is an input).
- **A symbol with a value and no declared type** (`ce.assign('a', 3)`) is
  captured as a number copied at compile time and takes the type of that
  value.
- **The `complex` mode.** The compiled function accepts a number or a
  complex value for such a name, as the existing compiler does. Where the
  profile cannot give exactly the values of the existing compiler, the
  program declines.

**Result (2026-11-10), `6b3e1e341858468e2b04ce64e3e3ffbaafb6705d`.** Both
modes are implemented; the predicate is `hasNoDeclaredType()`, built on
`hasInferredType()` (`boxed-expression/type-guards.ts`) as the session of
the binding units asked, and it holds with the flag `_bindingUnits` off and
on. The field is `defaultedSymbols`. Three points differ from the text
above, each found by the review:

- "The inferred type is not read" holds for the kind of the name. Some rules
  (`Power`) read the type of a node, which the engine computes from the
  inferred type: an earlier use can make a program decline
  (`Exp(Sqrt(x))` after `Mod(x, 2)`), and never changes the code of one
  that compiles.
- An assumption (`n` assumed an integer) does not change the kind. The
  profile gives the interpreter's value for every real `n`; the existing
  compiler drops `Floor(n)`. The two differ only for a value outside the
  assumption.
- A name declared `unknown` declines only until a use narrows it; it then
  takes the default (with `_bindingUnits` on, it always does).

**Later change, decided 2026-11-10.** When boxing no longer writes
inferred types (the binding-units work, `_bindingUnits` on by default), a
type that `ce.infer()` wrote is read by the profile as a declared type is:
the guidance for a host is then "declare the types, or call `ce.infer()`
before `compile()`". Until then the rule above stands and `ce.infer()`
changes nothing for the profile.

In the `strict` mode the existing compiler already computes with an untyped
name as a real number: for 37 of 43 bodies its code for an untyped parameter
is the code for `x: real`, and the 6 others use operators outside the
profile (`Arcsin`, `Arccos`, `Arcosh`, `Artanh`, `Arcsec`, a parameter as a
condition).

**Helpers with no declared signature (2026-11-10).** A call of a user
function whose signature the engine inferred (`f(x) := …`,
`ce.assign('f', Function(…))`), or derived from a literal with an
annotation on some parameters only (`_derivedSignature`), follows the same
rule: each parameter with no annotation has the default kind of the mode,
by the code of the root (`defaultedParameterKind()`), and the result is the
fact of the body. An argument of another kind declines (a list, a boolean,
a complex value in the `strict` mode, a real value in the `complex` mode),
so the helper is one function with one parameter type, as in the existing
compiler for a real argument. `defaultedSymbols` lists the name of such a
helper after the names of the inputs: a host declares its signature. A
helper declared `function`, or whose signature has an optional or a
variadic parameter, a type parameter or effects other than `random`, keeps
its decline, each with its own message. The body of every helper is now rewritten for the
angular unit of the engine, as the root is; before, it was compiled in
radians whatever the unit.

**Names declared `number` (2026-11-11, slice 1 of
[the options and bindings note](2026-11-11-structured-options-and-bindings.md)).**
A name declared `number` (an input, a parameter of a `Function` literal or of
a helper) has the kind of the existing compiler (`wideNumericType()`): real in
the `strict` mode, complex in the `complex` mode, where an input or a
parameter of the root is converted at each read (`IRInput.lifted`); a union of
a real type with `nan` or `signed_infinity` is real in both modes
(`declaredNumberKind()`). Other wide types (`finite_number`, `complex | nan`)
keep their decline. A helper declared with the result `number` returns the
fact of its body, as the existing compiler does; `Typed(v, 'number')` of a
real `v` declines in the `complex` mode, where the existing emitter makes the
value complex. A real argument of a helper parameter declared `number`
declines in the `complex` mode, as for a parameter with no declared type. A
name declared `number` with a finite real literal value is a capture with the
kind of its value. These names have a declared type, so `defaultedSymbols`
does not list them.

## The two facts, defined

**`pure`.** Two calls of the compiled function, with any arguments, give the
same results whether they run one after the other or at the same time in two
workers, and a call changes nothing that the host can observe. It holds when
no operation of the program or of a function it calls has an effect or an
unknown effect, and no array that the host passed in is written (a list
argument is only read; an update in place writes only into a list that the
call built itself). A captured value is a number copied at compile time, so
no call can change it. It is the meaning of `pure` in a function declaration
and of `isPure` on an expression. A draw from the random stream outside every
`WithRandomSeed` region is an effect: two calls give different values, and a
call inside an interpreted `WithRandomSeed` advances its frame. A
`WithRandomSeed` region discharges the draws of its body, as `isPure` does, so
a program whose draws are all in such regions is pure
(`docs/plans/2026-11-11-structured-random-and-effects.md`). It does not say that the host may change an
input array while a call reads it, that the calls will run in parallel, or
anything about a function passed at run time. An iteration budget does not
change the answer: when the budget is exceeded the call throws, and the pass
counter belongs to the runtime of each thread.

**`shippable`.** The existing field of `CompilationResult`
(`compilation/types.ts`): whether the compiled code can be sent to a worker
of the pool. Under the profile it is true when every function the code calls
is compiled into the same program, every captured value is a number written
into the code, no operation has an effect or an unknown effect (an
unknown operation can be a host closure, which a worker does not have; for a
known effect the facts do not yet say whether a worker has it, so the answer
is false), and the code neither draws from nor seeds the random stream, also
inside a `WithRandomSeed` region, as `isShippableCode()` refuses code that
names the random helpers. It does not say that the arguments can be
transferred cheaply.

A program that draws only inside `WithRandomSeed` regions is pure and not
shippable. A later program that calls a pure function of the host will be
the same.

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
| `compile(f, { …profile… })` where `f` calls `Random()` | — | compiles; `result.pure` and `result.shippable` are `false` |
| `compile(f, { …profile… })` where `f` calls `RandomChoice(L, 2)` | — | declines with `outside-profile`, naming `RandomChoice` |
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
