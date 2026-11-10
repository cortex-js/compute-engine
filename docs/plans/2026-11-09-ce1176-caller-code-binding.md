# CE-1176 option (a): caller code bound to temporaries on the GLSL target

**Status:** approved 2026-11-09. Issue `issues/CE-1176.md`. It changes a
documented contract (`docs/COMPILATION-MODEL.md`, "Code that the caller
supplies is held to the interpreter's order"). A prototype was measured
(below).

## The problem

Code that the caller supplies to a GLSL compilation can have an effect (count
its calls, draw a number): a `vars` entry whose source is not a plain read
(`nextValue()`, `vec3(a, b, c)`, `u_t * 2.0`); a `functions` entry that is not
known to be pure; an `operators` entry; a `compile` handler. The interpreter
evaluates each such piece once per occurrence, in the order of its operands.
Today the emitter writes the piece inline and declines a form that would run
it twice or ahead of earlier code. That decision depends on the code that the
emitter writes (whether a statement is hoisted), which the fragment pass
cannot see, so `canCompile()` says yes and `compile()` declines for 5
expressions of the tests (`docs/COMPILATION-MODEL.md`, known limitations):
`W + Max(V)`, `(W, Max(V))`, `W + Sum(V^2)`, `W + Sum(W + k, k, 1, n)` and
`If(c, Max(V), 0)`, with `vars: { W: 'nextValue()', V: 'vec3(nextValue())' }`.
The checks are about 400 lines (`gpu-draw-order.ts`, `operandsWrittenTwice()`
of `glsl-fragment.ts`, the call sites).

These programs declined before the fragment pass too: from 0.176.0 to 0.184.0
`compile()` threw for each of them. 0.164.0 compiled all five, two of them with
the caller code out of order (`W + Sum(V^2)` computed `V` before `W`;
`W + Sum(W + k, k, 1, n)` called the `W` of the loop before the outer `W`).

No GLSL record of Tycho's corpus has caller code (measured 2026-11-09 on 3,661
GLSL records: no `functions`, no `operators`, every `vars` entry a plain read).
All witnesses are `crafted`.

Code that is known to be pure is not caller code (`reachesCallerCodeOn()`,
`compile-folding.ts`): it may be shared, repeated or moved. On GLSL a
`functions` entry declared `pure: true` is still counted as caller code;
that is CE-1188, which is fixed on its own. A `vars` entry has no way to
declare that it is pure.

## The proposal

Before a statement is compiled, the emitter binds each piece of caller code
that the statement evaluates unconditionally to a temporary of its shader
type (`float`, `vec3`, …), in the order of the interpreter, and compiles the
statement with the piece read from the temporary. A piece in a position that
is evaluated on a condition or once per iteration is bound when that position
is compiled as a statement of its own: at the start of a branch (the
selection takes its statement form) or at the start of the loop body. Then the
emitter has no caller code to protect, and the order checks and
`operandsWrittenTwice()` go.

The temporaries are not locals of the program: the pass does not see them, and
the rule of the fragment that a function body has no list local does not apply
to them. (A first version of this spec bound the pieces to locals of the
program in the prepare stage; the pass then refuses the local that holds `V`,
"The local `c2` is a list", and 4 of the 5 witnesses become declines.)

| Today | Proposed |
|---|---|
| `W + 1` → `nextValue() + 1.0` | `float _cc1 = nextValue(); return _cc1 + 1.0;` |
| `W + Max(V)` → `canCompile()` yes, `compile()` throws | `float _cc1 = nextValue(); vec3 _cc2 = vec3(nextValue());` then `_cc1 + max(…_cc2.x, _cc2.y, _cc2.z…)` |
| `W + Sum(W + k, k, 1, n)` → the same | `float _cc7 = nextValue();` then a loop whose body starts with `float _cc8 = nextValue();` |
| `If(c, Max(V), 0)` → the same | `if (c) { vec3 _cc9 = vec3(nextValue()); _tv1 = …; } else { _tv1 = 0.0; }` |
| `Cot(W)` → refused by the pass | `float _cc1 = nextValue();` then `cos(_cc1) / sin(_cc1)` |

## The prototype (measured 2026-11-09 at `d43d68f25`)

`docs/plans/2026-11-09-ce1176-prototype.patch`, 37 lines in 5 files plus the
new module `gpu-caller-binding.ts` (about 100 lines). A hook of the target is
called where a statement gets its sink (`compileStatementBody()`,
`compileListStatement()`), at the start of each loop body and of each
unrolled term (`gpu-functions.ts`), and at the start of each lazy clause of a
selection (`compileGPUStatementSelection()`). It walks the positions that the
statement evaluates unconditionally, binds each piece with
`BaseCompiler.hoistStatement()`, and records the temporary in `_codeAliases`
for the length of the statement; an inner statement gives a node its own
temporary and puts the outer one back after. An `If` whose arm has caller code
takes the statement form. The order check `gpuHoistKeepsCallerOrder()` was
turned off (option (a) removes it).

Results:

- All 5 witnesses compile, each piece of caller code once, in the order of the
  interpreter (the code is in the table above). `canCompile()` accepted them
  already.
- The 236 test files that name GLSL: 27 tests in 12 files fail, none with an
  error. 10 expected a decline that is gone; 17 expected caller code written
  inline (`myFn(x) + 1.0`, `_gpu_sin(x + myGamma(20.0))`) or the conditional
  expression form of a selection.
- Two of the 27 show the open question of choice 2 below: the prototype binds
  a node once per statement, and a graph that reaches the node `myG(…)` 1,023
  times now calls it 10 times. The interpreter evaluates each occurrence.

## Choices, with the recommended answer

1. **Every expression with caller code becomes statements**, also the ones
   that compile today (`W + 1`). The `code` of such a result is a statement
   list ending in `return`, as for a loop-form `Sum` today. Recommended: yes;
   binding only where a hoist happens is the decision the pass cannot make.
2. **The same node at several places** (`W + W`, a shared subgraph): one
   temporary per occurrence, as the interpreter evaluates each occurrence. A
   node object can stand at several places, so the binding is keyed by the
   position, not by the node; the prepare stage can make each occurrence a
   node of its own. Recommended: per occurrence. A graph whose occurrences
   are too many is refused by the size check (`gpuWrittenSize()`), as today.
3. **A lazy position**: an arm of `If` or `Which` and a condition after the
   first are bound at the start of the branch, which takes the statement form
   (prototyped). The right operand of `And` and `Or`, and a `Coalesce`
   fallback: written as `If` first (`And(a, b)` is `If(a, b, False)` on the
   two-valued booleans of the fragment). Not prototyped. Recommended: as
   written.
4. **A loop body** (`Sum`, `Product`, `Loop`; the terms of an unrolled `Sum`):
   bound at the start of each iteration or term (prototyped). A function
   literal body (`Map`): the same, not prototyped.
5. **Caller code reached through a symbol value or a user function body**
   (`a := W + 1`, `g(x) := F(x) + 1`): the body of a user function that the
   emitter writes as a GLSL function is compiled through the same statement
   positions, so it binds its own pieces; a call whose function body has
   caller code is itself bound, as one evaluation, at the call site. The
   prototype has both mechanisms, but no test of the 236 files exercises a
   function body with caller code, so this is not measured. A symbol value
   written in place is bound where it is read. Recommended: as written.
6. **A route that skips the pass** (a GLSL target object passed as `target`):
   it has no statement sink, so nothing is bound, and after the checks go
   caller code there is written inline with no protection. Recommended:
   accepted, as for the other step 5 removals; the route is outside the GLSL
   contract.
7. **Code known to be pure** (CE-1188, and the plain reads of `vars`) is not
   bound, so it compiles as today and the common-subexpression pass may share
   it.

## If this is not approved

The checks stay, and `canCompile()` and `compile()` keep disagreeing on the 5
crafted expressions (known limitations of `docs/COMPILATION-MODEL.md`).
`gpu-draw-order.ts` keeps about 350 lines. Option (b) of the issue (a copy of
the hoisting rule in the pass) is not recommended.

## Measure and checks of the implementation

The GLSL test files (about 27 tests change their expected code or lose a
decline), `npm run test:glsl` with 0 disagreements, the whole-corpus audit
with 0 changed records (the corpus has no caller code), and the removed
lines. The `docs/COMPILATION-MODEL.md` section on caller code and its
known-limitations entry are rewritten. Size M.

## The result of the implementation

Implemented in the worktree of session compute-engine-8d on HEAD
`7520d089c99f414c1c0e479871177ddcaa7bf6ed`. The binding is in
`gpu-caller-binding.ts` (`gpuBindCallerCode()`, `gpuSeparateCallerCode()`).

- The five witnesses compile, with the caller code in the order of the
  interpreter, and are tests
  (`test/compute-engine/ce-1176-glsl-caller-code-binding.test.ts`, with
  `W + W`, a shared node object and a symbol value read twice).
- Removed: `gpu-draw-order.ts` (379 lines; `gpuOperandOnce()` is kept, in
  `gpu-statements.ts`, without its caller-code checks),
  `operandsWrittenTwice()` and `callerCodeOperandWrittenTwice()` of
  `glsl-fragment.ts` (159 lines), the chained-comparison check of
  `compile-operators.ts`, `isShaderVariableRead()` of `compile-folding.ts`,
  and their call sites. `findReferences` at `7520d089c` listed each
  reference; each is removed or re-imported. Source: 726 lines added (453 in
  the new module), 790 removed.
- The GLSL test files (238 files): 11,384 tests pass. The expectations of 10
  test files changed; each now shows the caller code computed once, into a
  temporary, where the test expected it written in place or expected a
  decline.
- `npm run test:glsl`: 5,482 expressions, 966 accepted by `canCompile()`, 0
  disagreements. Typecheck and `check:deps` pass.
- Tycho's whole-corpus codegen audit (`--all`, Tycho `6e106b4ff`, 764
  documents, 17,421 records), base `7520d089c` against this change: 0
  records with changed code, 0 new declines, 0 `canCompile()`
  disagreements.

Where the code differs from the choices above:

- Choice 7 (plain reads not bound): a part of a statement that reads a
  `vars` key and that the interpreter evaluates before a piece of caller
  code is read into a temporary first, because caller code can write the
  variable that it reads; the order check that this replaces refused that
  case. A read with no caller code after it stays in place.
- Choice 3: a chained comparison whose third or later operand holds caller
  code is written as an `If` too (`Less(a, b, c)` is
  `If(Less(a, b), Less(b, c), False)`): the interpreter stops at the first
  pair that is false.
- Choice 2: a node that holds a position evaluated on a condition or
  repeatedly (`If`, `Which`, a loop-form `Sum`, a block used as a value) is
  itself computed into a temporary at its place in the order, so that its
  caller code runs after the caller code written before it.
- Choice 5: the body of a user function written in place of its call binds
  its caller code at the call (`tryInlineUserFunctionCall()`).
- Declines that remain, with `canCompile()` accepting (crafted; known
  limitations of `docs/COMPILATION-MODEL.md`): a `Loop` guard or later
  clause with caller code; `And`, `Or` or a chained comparison with caller
  code after the first operand inside the body of a user function (the
  rewrite runs on the root tree only) or under a head that the caller maps;
  a selection with caller code in a branch that cannot take its statement
  form; a piece of caller code with no shader type for a temporary.
- Not handled (crafted, a known-limitations line): one node object of caller
  code at two places of a user-function body that the host built, when the
  body is written in place of its call, runs once.
- Dual review: two rounds. Round 1: Claude 4 findings (2 high), Codex 1
  (high); all fixed. Round 2 on the fix delta: Codex none; Claude 3 (2 low,
  1 nit): two fixed, the shared node in a host-built body recorded as above.
