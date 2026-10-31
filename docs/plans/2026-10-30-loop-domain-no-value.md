# A loop over a collection with no value — spec

**Status:** on hold (ROADMAP CE-660). User decision 2026-10-30, after the
review of this draft (`docs/scratch/LOOP_DOMAIN_NO_VALUE_SPEC_REVIEW.md`): do
not implement this design, nor the `Error` alternative, for now. This draft
does not answer the 17 findings of that review; a new version must answer them
first. The compiled part ("Compiled code" below) is done separately.

## The problem

With `L` declared `list<number>` and no value:

| Input | Interpreter today | Compiled JavaScript today |
| --- | --- | --- |
| `Block(c := 5, Loop(c := c + k, Element(k, L)), c)` | `5` (zero iterations) | throws `_.L is not iterable` |
| `Sum(k, Element(k, L))` | `Sum(k, Element(k, L))` (no value) | declines |
| `Comprehension(2k, Element(k, L))` | unevaluated (no value) | throws |
| Epsil `let c = 5; for k in L { c = c + k }; c` | `5` | — |

`Sum` has no value because the unevaluated `Sum` is part of the result. A
`Loop` acts only through the assignments of its body, so when it is skipped,
the block reads `c` as if the loop had run over an empty list. That is a
definite value where the interpreter has none for `Sum`.

A statement list (`evaluateStatements`, `function-utils.ts`) stops early only
on `Return`, `Break`, `Continue` and an `Error` value. An unevaluated
statement is an ordinary value, and the list goes on.

## The rule

1. **The domain.** A `Loop` clause `Element(k, D)` has no value when `D`
   evaluates to an expression that is not a collection with known elements
   and holds no error: a symbol with no value (`L`), or an operator that
   stays unevaluated (`Take(L, 2)`). An empty collection (`[]`,
   `Range(1, 0, 1)`) is not such a domain: it gives zero iterations, as
   today. A domain whose evaluation gives an error keeps today's rule (the
   error is the value of the loop, `LoopState.domainError`).
2. **The loop.** Such a domain stops the loop before its first iteration of
   that clause, and the loop gives a **no-value stop**. A nested clause whose
   domain has no value stops the whole loop at that point; the iterations of
   the outer clauses that already ran keep their effects.
3. **The statement list.** `evaluateStatements` stops on a no-value stop, as
   on `Return`. The `Block` whose list stopped gives the stop to its
   enclosing statement list, and so on.
4. **Where the stop ends.** It ends at the first of these, and becomes that
   expression, unevaluated:
   - the outermost `Block` being evaluated, which then evaluates to itself
     (the canonical `Block` expression, held), as `Sum(L)` evaluates to
     itself;
   - a function application whose body stops: the call evaluates to itself,
     `f(args)` with its arguments evaluated, as a call with no value does
     today;
   - a `Loop` body inside a `Loop` (the inner loop stopped): the outer loop
     stops too (rule 3 applies to its body), so the stop goes on outward.
5. **Effects.** Effects before the stop stay done: assignments that ran, and
   draws of `Random`. The stop does not undo them. The value of a local
   assigned before the stop stays, so reading it after the evaluation (in a
   later top-level statement) gives that value.
6. **Epsil.** A top-level statement whose evaluation gives a no-value stop is
   reported as a diagnostic `no-value` (a warning, not a `runtime-error`):
   "the loop domain `L` has no value". The program stops at that statement,
   as for a `runtime-error`, because the later statements read state that the
   loop should have set.
7. **The stop is internal.** It is never a value that a user sees: the
   expression that the user receives is the held `Block` or call (rule 4).
   It is not stored in a symbol, not an element of a collection, and not an
   argument.

## Representation

A new inert internal operator, `NoValueStop(expr)`, registered as `Return`
is (`library/core.ts`), with `expr` the loop that stopped. Rule 4 replaces it
by the held expression. `evaluateStatements` and
`evaluateStatementsAsync` add it to their stop list. The debugger's result
hook receives the held expression, not the stop.

## Compiled code

Under every target the result has no value: a domain that may be absent at
run time sends the run to the run-wide marker (`_SYS.noValue`,
`catchNoValue`, `compilation/base-compiler.ts`), so `run()` gives `NaN` or
`undefined`. The existing declines hold: the compile declines when an effect
follows the loop or a function can escape the run. A domain proven present
keeps its code. This part is independent of the interpreter rule and is
implemented first.

## Hard cases

| Case | Result |
| --- | --- |
| `Block(c := 5, Loop(c := c + k, Element(k, L)), c)` | the held `Block` |
| the same with `L = [1, 2]` | `8` (unchanged) |
| `Block(c := 5, Loop(c := c + k, Element(k, [])), c)` | `5` (unchanged) |
| `Loop(…, Element(i, [1, 2]), Element(k, L))` | stops in the first outer iteration; effects of that iteration before the inner clause stay |
| `f(n) := Block(s := 0, Loop(s := s + k, Element(k, L)), s)`, then `f(3)` | `f(3)`, held |
| `Map(x ↦ 2x, L)`, `Sum(L)`, `Comprehension` | unchanged (already no value) |
| `If(c > 0, Loop(…, Element(k, L)), 0)` with `c = 1` | the stop goes through the `If` to the block |
| a loop inside a function literal that is returned, then called | the call is held (rule 4) |
| an iteration limit reached before the domain | unchanged (`CancellationError`) |

## Alternatives not chosen

- **An `Error` result**: smaller, but the result is an error, not "no
  value", and `Loop` would differ from `Sum`, `Map` and `Comprehension`.
- **Zero iterations (today)**: a definite value where `Sum` has none.

## Open questions for review

1. Is the held outermost `Block` (rule 4) the right value, or should the
   stop end at the innermost `Block` whose local the loop writes?
2. Should Epsil stop the program (rule 6), or report the warning and run the
   later statements?
3. Does any other operator that acts by effect (`Assign` of an unevaluated
   right side, `Declare`) need the same stop?
