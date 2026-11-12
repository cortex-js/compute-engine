# One route for an Epsil program: the `Program` operator

Status: DRAFT for the user's approval. The direction is approved
(2026-11-12: a program is one expression, with a `Program` operator distinct
from `Block`); the choices P1 to P11 below are not. No code.

Evidence: `~/dev/compute-engine-recovery/epsil-routes-investigation.md`
(ten routes, their users, the probed differences, the sizes). It is outside
the repository; its tables are copied here where a choice needs them.

## 1. The problem

An Epsil program is evaluated or checked by ten routes. Two of them define
its meaning and disagree: `executeEpsil()` boxes and runs one statement
after the other in the caller's scope; `ce.box(parseEpsil(p))` gives a
`Block` that is boxed whole and evaluated in a scope of its own. The
debugger and the inline results of the editor have loops of their own; the
compiled program is the `Block`.

| Program | Runner | As a `Block` |
|---|---|---|
| `let a = h(1); let h = (x) => x + 1; a` | `2` | `read-before-declaration` |
| `let x = 1; let x = 2; x` | `1` and a diagnostic | error (debugger: `2`) |
| `const c = 1; c = 2; c` | `1` and a diagnostic | throws to the host |
| `let a = "x" + 1; 5` | `5` | the program is invalid and not evaluated |
| `type Pt = …` at the top | allowed | refused |
| `let t = 0; let g = (k) => do { t = k + 1; t }; [g(1), t]` | `[g(1), 0]` and an error | `[2, 2]` |
| `function f(x) { x + 1 }; f` | `f` | the literal |

About 1,370 lines exist so that the routes agree: the runner copies the
block's early install of functions (about 730), the block copies the runner
(about 190), the static check copies the effects of evaluation (about 450).

## 2. The rule

`parseEpsil()` gives `Program(s1, …, sn)` for a whole program. Every route
boxes that one expression and evaluates it. `Block` stays what a `do`
block and a function body are.

A `Program` is a `Block` with three differences:

1. **No scope of its own.** Its declarations are made in the scope it is
   evaluated in, and stay after the run.
2. **Its direct statements are the top level.** A statement that is valid
   only at the top level is valid there and nowhere else. The test is the
   position in the form, not which scope is current.
3. **Each statement fails alone.** A statement that is invalid, or that
   throws, gives an error value and a diagnostic for that statement; the
   others run.

Everything else is the rule of a block (bound-once spec, D8): a local is
made by a declaration, a read before the declaration is an error, two
declarations of a name in one program are an error.

## 3. Choices

**P1. The form.** `Program` is a library operator, lazy, with the canonical
handler of a block minus the scope. A host may build one by hand. `Block`
loses every test of "is this block a program" (`isProgramBlock`,
`runsAsProgram`, the table of later declarations).

**P2. All statements are boxed once, before the first runs.** This is what
makes a compiled program and a run program the same expression. Consequence:
`let a = h(1); let h = (x) => x + 1; a` is `read-before-declaration` (it was
`2` on the runner). A `type` statement registers its type when it is boxed,
as today, so a later annotation reads it.

**P3. A `function` statement at the top level is a global function,
callable from every statement of the program,** before or after it in the
text. This is what both routes do today and what Tycho's prelude does
(functions first). It differs from a function statement in a block, which
is a local variable (D11) and is not callable before it. Alternative: no
early install at the top level either (one rule, about 400 more lines
deleted in the `DefineFunction` handler); it breaks mutual recursion written
in the natural order and every program that calls a function defined
below. Recommended: keep the early install at the top level.

**P4. A function may assign a top-level variable declared later in the
text.** The names of a program are declared when it is boxed, so the
assignment finds its target. `function g(k) scope { t = k + 1; t }; let t =
0; [g(1), t]` is `[2, 2]`. This is the "valid if simple" answer the user
gave on 2026-11-12; with one route it is the simple one. A READ of `t` by a
statement before `let t` stays an error.

**P5. The untyped function that writes an outer variable**
(`let t = 0; let g = (k) => do { t = k + 1; t }; [g(1), t]`): `[2, 2]`,
what a block gives today and what the runner gives when the program is
wrapped in `do { }`. The runner's error comes from an effect check that
applies to a global function definition. Recommended: `[2, 2]`. To decide
with it: whether the documented effect rule (`declarations.md`, a function
that writes an outer variable must say `scope`) applies to a function
value held by a variable; today it does not.

**P6. Top-level-only statements:** `type`, `protocol`, the pair `let g:
sig` then `function g`, and (when event handlers are built) `on`. Inside a
block or a body each is an error, as today.

**P7. Redeclaration.** Two declarations of one name in one program:
`variable-redeclaration` on the second, the first stands, the other
statements run (rule 3). A program that declares a name which the scope
already holds from an EARLIER program replaces it: running a notebook cell
again declares again. The debugger's "the second `let` replaces the first"
goes.

**P8. `const c = 1; c = 2; c`:** an error value and a diagnostic on the
assignment; the value is `1`. Nothing is thrown to the host.

**P9. A program that ends with the name of a function gives the name**
(`f`), because the definition stays in the scope. The step that replaces it
by the literal stays for a `Block`, whose definitions end with it.

**P10. The routes after the change.** `executeEpsil()` and
`executeEpsilAsync()` parse, resolve library names, box the `Program`, and
evaluate it with the existing per-statement hooks (diagnostics with source
ranges, the debugger's pause). The debugger and the inline results call
them; their loops go (and with them CE-1252). `compile()` of a `Program`
compiles its statements as it does a `Block`: the value is the value of the
last statement, and no declaration leaves the compiled code. The limits of
a run (the lifted iteration limit, the time and step budget, cancellation
between statements) are those of `executeEpsil()` today.

**P11. The static check** boxes the `Program` in a scope that is thrown
away. Whether its copy of the effects of evaluation (about 450 lines) then
goes is measured during the work, not promised here.

## 4. What it deletes

Measured by reading (the investigation, section 4): `prepareFunctionDeclarations`
and its helpers (about 730 lines), the later-declarations code on both
sides (about 110), `isProgramBlock`, the deferral and `runsAsProgram`
(about 115), `boxTopLevelStatement` (about 23), the two editor loops (about
120): about 1,100 lines. Candidates not verified: the static check's
emulation (about 450) and part of the engine fields that exist for the
runner (146 references outside `src/epsil`).

## 5. What changes for a host

- `parseEpsil()` gives `Program(…)`, not `Block(…)`. Code that takes the
  statements of the result reads the operands of `Program`. Tycho's prelude
  runner and its analysis do this; they change one test of the operator
  name.
- Tycho's notebook script cell runs the program in a pushed scope and reads
  the top-level values before it pops the scope: unchanged (rule 1).
- Tycho's prelude runner (2,836 lines) is a route of its own that already
  follows this rule (functions first, values in order, no forward read of a
  value). Whether it can become `executeEpsil()` of a `Program`, and what
  that deletes in Tycho, is a question for `tycho-desk`; it is not part of
  this change.
- The Epsil guide: "The top level of a program is not a block"
  (`src/epsil/docs/declarations.md`) is replaced by the three differences
  of section 2.

## 6. Order and acceptance

After step 1 of the bound-once spec is on main. First a measurement: the
rule built behind nothing, on a worktree, and the count of the tests that
change among the 290 files that call `executeEpsil()` and the 49 that
compare the routes, grouped by the row of the table in section 1 that each
one pins. The user sees that count before the tests are moved.

Acceptance: every row of the table gives one value on every route; the
functions of section 4 are gone; `issues/CE-1007.md`, `CE-1008.md` and
`CE-1252.md` are closed or restated; the source of `src/epsil` and of the
block code is smaller than before.

## 7. Not in this change

The asynchronous twins stay: their sequential awaits are the meaning of a
program. No order of floating-point operations is guaranteed for a
parallel loop (user decision 2026-11-12); the about 35 lines of
`run-async.ts` that fix an order can go in a change of their own.
