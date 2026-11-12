# D8: result of the test migration (2026-11-12)

Worktree `/tmp/wt-compute-engine-ad-step1`. About 181 test files changed:
134 mechanically (a first assignment became a declaration), 43 with at
least one test restated for the rule. 33 tests still fail: 3 known
(`ce-586`, `closure-frame-retained` "dependent limit",
`derivative-literal-parameter-shadow`), 38 more in 7 files of the structured
compiler that this work does not edit, and the cases below.

## Code that does not give what the rules give

1. A recursive function literal that is the value of a `Declare` cannot
   call itself, except in a function body or at an Epsil top-level `let`:
   `Block(Declare(f, x ↦ If(x ≤ 0, 0, n + f(x − 1))), f(3))` with `n = 2`
   gives `2 + f(2)`, expected 6 (6 tests).
2. A `Declare` whose value is a function literal gives the local the type
   `unknown`. A compiled block that returns a dictionary from such a local
   gives a wrong finite value (`compile-dictionary`: 1 where `{re: 1, im: 0}`
   is expected); `Count(S, g)` declines; an incompatible second assignment
   of a function is accepted (`execute.test.ts`, 2 tests). `ce-772` requires
   `unknown` for such a local, so the fix is not simply the signature of the
   literal.
3. A function local made by `Declare` does not give its caller the
   whole-collection parameter that a global assigned function gives
   (`whole-collection-parameter`, 5 tests).
4. `iterationBudget` no longer declines a block whose value is a function
   (`compile-loop-iteration-budget`, 2 tests): the decline was on the path
   of implicit locals.
5. Structured profile, degrees, complex mode: the guard ran only on the
   path of implicit locals; the profile gives 45 and does not decline, the
   existing compiler gives NaN where the interpreter gives 45.
6. A write to a `match` capture inside a function is refused at run time
   (`function f(v) { match v { n => do { n = n + 1; n } } }`).
7. Epsil `let g: integer` then `g = 2` at the top level gives two errors
   where a `do` block gives one.
8. `static-check-const-assignment`: a diagnostic whose range is the whole
   statement; an error reported twice.
9. A run-time `scope` effect error after the static error for an undeclared
   assignment in a mapped function body.

## Programs that the rules do not decide

1. A read before a top-level `let` in Epsil: `let a = q + 1; let q = 2; a`
   gives 3 with no diagnostic; in a `do` block it is
   `read-before-declaration`.
2. A function that writes a name declared by a later top-level `let`: the
   routes disagree (`executeEpsil`: the undeclared error;
   `ce.box(parseEpsil(src)[0]).evaluate()`: `[2, 2]`).
3. The type of a local declared with a function literal (see 2 above).
4. An undeclared assignment in a value operand (`Sum(Assign(s, s + i), …)`):
   `assignment-to-undeclared-variable` or `assignment-in-operand`.
5. `compile-glsl-fragment` "user functions and caller code": a function
   declared with a union return type whose body returns a tuple now
   compiles; the test expects a decline.
6. Smaller: the `scope` effect of a `Declare` of a block local;
   `Typed(Declare(…))`; a three-operand `Declare` whose value is a
   `Dictionary`.

## Code made unreachable

`fragment.ts` `walkBlock` (the implicit-local branch), a decline message of
`compile-locals.ts`, and the `implicitLocal()` path of
`javascript-fragment-target.ts`.

## The structured compiler's tests (not edited here)

38 failures in `compile-javascript-structured-blocks` (19), `-scalar2` (12),
`-collections` (3), `-calculus2`, `-calculus`, `-nested`, `-locals` (1
each): each first `Assign` of a local becomes a `Declare`; three tests state
the removed rule and change in meaning.
