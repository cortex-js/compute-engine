# The macro kind

Status: APPROVED by the user on 2026-11-12 (session compute-engine-67):
decisions M1, M4, M5, M6 as first drafted, expansion in place, which
replaced M2 and M3, then M7 and M8. The checks with `tycho-desk` are
recorded in section 11. No code is written. It is slice 4 of `2026-11-09-binding-units-model.md` and step 4 of
`2026-11-11-bound-once-spec.md` (the "rule spec" below).
Consulted on 2026-11-12: `tycho-desk` (Tycho main with CE 0.187.1) and
`compute-engine-06` (the worktree of the rule spec).

"Today" in the tables is run on main at
`7305ef84b8e97bf25bc97dbcdaef2e6e48d81772`. "Proposed" is the expanded
form, written by hand and run on the same source, unless a cell says
"derived".

## 1. The rule

1. **A macro is a definition that keeps a raw body and has no value and no
   type of its own.**
2. **A macro is expanded in place, when a raw form is made canonical.** A
   macro name written in MathJSON or LaTeX input is replaced by the raw
   body of the macro, boxed at that place, in the scope of the occurrence
   and with its options (the canonical form asked for, `autoDeclare`); the
   root of the body takes the source range of the name. The name is not
   kept. A position where an operator takes a name is not an occurrence: a
   parameter, an index, the variable of `D`, `Solve` or `Limit`, the
   target of `Assign` or `Declare`. A symbol that code makes with
   `ce.symbol(name)` is not expanded either, so a working variable of an
   engine algorithm is never replaced by a body.
3. **The body is boxed by the same rule**, so a macro that it names is
   expanded too. A macro that reaches itself through macros is
   `macro-cycle`: `Error('macro-cycle', name)` at the occurrence. The
   engine keeps the set of the macro definitions being expanded for the
   length of one boxing call.
4. **A function is not a macro.** Its body is boxed once, in its own scope,
   and a macro named in the body is expanded there. A call is by
   reference: a function never takes a name from its caller.
5. **A macro is declared before a form that names it is boxed.** The
   engine never boxes a form again because a macro appeared or changed.
6. **A parameter, an index or a declared local of the same name hides the
   macro**, by the ordinary lexical lookup.
7. **A symbol that resolves to a macro definition** (a reader boxed before
   the declaration, a symbol from `ce.symbol()`) has no value and the type
   `unknown`, and evaluates to itself. No error is made for it.

So every name written in the body resolves from the scope of the
occurrence: a parameter or an index of the reader captures it, which is
what a macro is for. No text is substituted into a bound form, so no
capture can happen besides that one.

Rules of the rule spec that this assumes: rule 1 of its section 2 (an
occurrence resolves from the scope it was boxed in) and rule 4 (a
parameter, an index and a block local are names of their unit); C3 (the
home chain is fixed at boxing); D5 (a binder with a variable binds its
variable in a boxed operand); D8 for the locals of rule 6 (a local is the
name of a `Declare` at the top of a block). It does not need the
activations (D6) or slice 2 of the model (stored bodies with stamps).

**Why not a local.** The first version of this spec, and section 11 of
`2026-11-09-binding-a-set-of-definitions.md`, bound a macro as a block
local of its reader, so that two copies of a written draw stay one draw.
Tycho frames each written draw (`WithRandomSeed`), so two copies give one
number already. The local cost a block around every reader, a read-through
in `D`, `Integrate` and `Solve`, a rule for an inner scope, and row 10.

## 2. How a host declares one

```ts
ce.declare('A', { macro: ['Add', ['Power', 'x', 2], ['Power', 'y', 2]] });
```

- The body is raw MathJSON, any expression; `ce.declare` checks only that
  it is MathJSON, and refuses another field beside `macro` as it refuses
  an unknown field today. A body that boxes to an `Error` gives that
  `Error` at each occurrence. A host with LaTeX passes the `.json` of a
  raw parse.
- The definition is a third kind beside a value definition and an operator
  definition: `isValueDef()` and `isOperatorDef()` are false for it. For
  the parser it is not a function.
- A macro is declared once in a scope: a second `ce.declare` of the name
  there is the error of today for a second declaration, and `ce.assign()`
  or an `Assign` on a macro name is an error. A host that changes a macro declares its
  set again in a new scope and boxes the readers again (Tycho does this at
  each edit of a row).
- `ce.lookupDefinition('A')` gives the macro definition, with its kind and
  its raw body. `ce.box('A')` is the body, boxed in the current scope.
- A macro has no parameters. LaTeX `A(x+1)` is a product, since `A` is not
  a function, and `A` is expanded; MathJSON `['A', 1]` is the error of
  today for a call of a name that is not a function. This replaces
  "the macro kind, with parameters" of section 6 of the rule spec; Tycho
  needs none (`tycho-desk`: a row with explicit parameters is a function
  and reads an axis as a global; for `c = |\cos a|` drawn as `y = c(x)` it
  declares a function itself).
- The batch (step 5) declares a macro with the same definition.

Where the code goes: the place where canonical boxing turns a name of the
input into a symbol (`boxed-expression/box.ts`), not `ce.symbol()`. The
engine substitutes a `holdUntil: 'never'` constant in `ce.symbol()`
(`engine-expression-entrypoints.ts`), which library code also calls for its
working variables (`ce.symbol('t')` in `solve-linear-system.ts`), so that
site is not used. Besides it: the definition kind and the readers of a
definition that must know it (the parser's test of a function, `ce.assign`,
`ce.withValues`, the scope printer, the undo of `ce.loadLibrary()`).

## 3. Examples

`x` and `y` have no value. A value row is `ce.assign()` today and a macro
under the proposal; a row with parameters is a function in both.

| # | Document | Read | Today | Proposed |
|---|---|---|---|---|
| 1 | `A = x^2 + y^2`, `f(x) = A + 1` | `f(3)` | `x^2 + y^2 + 1` | `y^2 + 10` |
| 2 | `A = x^2`, `B = A + 1`, `f(x) = B` | `f(3)` | `x^2 + 1` | `10` |
| 3 | `g(u) = u + x`, `f(x) = g(1)` | `f(3)` | `x + 1` | `x + 1` |
| 4 | `k(v) = v + x`, `A = x + k(1)`, `f(x) = A` | `f(3)` | `2x + 1` | `x + 4` |
| 5 | `A = x^2`, `g(u) = u + A`, `f(x) = g(1)` | `f(3)` | `x^2 + 1` | `x^2 + 1` |
| 6 | `A = x^2 + y^2` | the host expression `A + 1` | `x^2 + y^2 + 1` | the same; `.json` is `x^2 + y^2 + 1` |
| 7 | `A = k x` | `\sum_{k=1}^{3} A` | derived: `3kx` | `6x` |
| 8 | `A = x`, `f(x) = [A, \sum_{x=1}^{3} A]` | `f(10)` | derived: `[x, 3x]` | `[10, 6]` |
| 9 | `A = n·f(n-1)`, `f(n) = \{n = 0: 1, A\}` | `f(4)` | derived: an expression in `n` | `24` |
| 10 | `f(x) = A` assigned, then `A = x^2` declared (against rule 5) | `f(3)` | `x^2` | `A`, a symbol with no value |

Rows 1, 3, 4, 5 are Tycho's four reference results
(`2026-11-09-binding-a-set-of-definitions.md`, section 11), row 2 the fifth
of its answer; `tycho-desk` measured the five again on 2026-11-12 on both
of its routes, and row 9 gives `24` in Tycho today. Row 7: Tycho gives `6x`
inlined and `3kx` by reference, which it reports as its own defect; its
test "GY: under a sum over x" fixes the capture by an index.

What the engine stores: row 4, `f := x ↦ x + k(1)` (`k` is a function: its
`x` is the global one); row 5, `g := u ↦ u + x^2`; row 7,
`Sum(k·x, k, 1, 3)`.

## 4. Compiled code: one local per repeated body

The compiler sees the expanded form and no macro. A body that a reader
names several times is a repeated subexpression, which the targets share
today. Run today for `x·A + 1/A + A` with `A = \sin(x^2 + y^2)` expanded:

```js
(() => { const _cse1 = Math.sin((_.x * _.x) + (_.y * _.y)); return _.x * _cse1 + 1 / _cse1 + _cse1; })()
```

GLSL: `float _cse1 = _gpu_sin((x * x) + (y * y)); return x * _cse1 + 1.0 / _cse1 + _cse1;`.
The interval-js and Python targets emit one `_cse1` too. WGSL was not run.
Nothing is added to a target. The structured route (session
compute-engine-ef) shares or does not share by its own rules.

## 5. Three things Tycho needs before it deletes its inlining and threading

### 5a. A stored body and an inlined body mean the same thing

The engine gives one value for one MathJSON on both routes. The difference
is two lowerings of Tycho that run only where it inlines:

| Program | By reference | Inlined by Tycho |
|---|---|---|
| `y_r = [1,2,3]`, `d(x) = \max(0, x - y_r)`, `d(2)` | Tycho stores `Max(0, …)`: `1` | Tycho hands `ElementMax(0, …)`: `[1, 0, 0]` |
| `a(t) = [\cos t, \sin t]`, `A(t) = \sum_{i=0}^{2} a(2^i t)`, `A(0)[1]` | `At(A(0), 1)`: `3` | a `Sum` of cosines: `3` |

The rule: **a dialect meaning is lowered once, on the raw body, before the
body is handed to the engine; it reads no type at a call.**

- `max`, `min`. Tycho's lowering reads only the number of operands, so it
  can run on a stored body (`tycho-desk`). `ElementMax(0, x - y_r)` in a
  stored function gives the list, and `ElementMax(1, 2)` is `2` (run
  today). Nothing to do in the engine.
- `At`. The values agree. Tycho's lowering exists because the engine typed
  a `Sum` over a list-valued body as `number`, so the index typed `any` and
  the JavaScript target declined. On main today `A(t)` is `vector<2>`,
  `At(A(t), 1)` is `number`, and it compiles. Tycho runs its
  `list-index-lowering` tests without the lowering on a scratch build; a
  program that still declines or types `any` is an issue file.

### 5b. A parameter that takes a list whole

The engine keeps the rule it has for a global function, and this spec
changes none of it: **a parameter whose type admits a list takes the list
whole; a call maps over a list argument at any other parameter, an
`unknown` one included. The type of an undeclared parameter is inferred
from the body, through the functions the body calls.** Run today:

| Function (parameters undeclared) | Call | Result |
|---|---|---|
| `r(p) = \mathrm{ElementMax}(0, p_1)` | `r([3,-1])` | `3`: whole |
| `l(p) = \sqrt{p_1^2 + p_2^2}`, `k(p) = \mathrm{ElementMax}(0, l(p))` | `k([3,4])` | `5`: whole, through `l` |
| `tri(n) = \sum_{j=1}^{n} j` | `tri([1,2,3])` | `[1,3,6]`: mapped |
| `dd(p) = \mathrm{ElementMax}(0, p)` | `dd([1,-2,3])` | `[1,0,3]` |
| `m(L) = L_1 + L` | `m([3,4])` | error at the definition; Desmos, and Tycho inlined: `[6,7]` |

These are the Desmos results of Tycho's `broadcast-positions.ts`. The last
row is CE-1246, filed with this spec. A declared width is not what decides
(`list<number^2>` on a parameter refuses a list of pairs): Tycho leaves
the parameter undeclared or declares it without a width; the width that a
shader needs is the `byReference` option of the rule spec (C6).

### 5c. A shader helper that reads an input (decision M7)

Tycho threads `g(1)` to `g(1, x)` for a function that reads an axis,
because in its shaders the axes are locals of `main` and a helper cannot
see them. Under rule 4 `g(u) = u + x` is by reference and reads `x` as a
global. Run today, GLSL, `g(1)` with `x` declared `real`:

```glsl
float _fn_g(float u) { return u + x; }   // preamble
_fn_g(1.0)                                // code
```

The helper names `x` and takes no parameter for it. For Tycho to delete the
function half of its threading (`_fnImplicitParams`, the function half of
`_threadNode`), the GLSL and WGSL targets pass each compile input that a
helper reads, directly or through the helpers it calls, as a parameter of
the emitted helper. Without it Tycho keeps that half. It is a change of the
shader targets, not of the macro kind.

## 6. The hard cases

- **A reader boxed before the macro is declared** (row 10). Nothing is
  boxed again. By rule 2 of the rule spec the occurrence resolves to the
  macro definition once it exists, and rule 7 says what that is: a symbol
  with no value. No error (user, 2026-11-12: the literal reading is
  enough). Tycho keeps
  rule 5 at no new cost: it knows its macros from the raw rows before it
  registers anything, and registers the whole document again, in a new
  scope, at each edit of a row; it adds the order "macros first" in its
  registration and in the replay on a plot element's engine.
- **An expression that is already boxed.** `ce.function('Add', [e, 1])`
  boxes nothing again, and `e` holds no macro name any more. A binder built
  around a boxed reader binds its variable in the expanded body, by D5:
  `Sum(ce.box('A'), k, 1, 3)` with `A = k x` is `6x`.
- **A held operand** (`Hold(A)`, a lazy operand) is raw and keeps the
  name. It is expanded when it is made canonical (`ReleaseHold`), with the
  macros of the scope current then: the one case where an expansion
  happens during an evaluation.
- **A rule** (`ce.rules()`, `replace()`) is a form like any other: a macro
  name in its pattern or its replacement is expanded when that part is
  made canonical.
- **Size.** There is no limit: a host that declares a chain of depth 25
  that doubles at each level gets a form of 2^25 nodes. A reader holds one copy of a body for each occurrence, and a
  chain multiplies (`B = A + A`, `C = B + B`). Measured by `tycho-desk` on
  its 688 corpus states (section 11): the largest expanded reader has
  1,097 nodes, the deepest chain of macros is 4.
- **The name is not kept.** `.json` and `.latex` of a reader show the
  expanded body. The raw form (`ce.parse(latex, { form: 'raw' })`) never
  expands, and a host that wants the names reads it. The head of a
  definition row is an occurrence like any other: `A = x^2 + y^2` boxed
  whole is `Equal(x^2 + y^2, x^2 + y^2)`, in both forms, so a host boxes
  the right side of such a row alone (Tycho: adoption work at the entry of
  its classification). No option to box without expansion is added.
- **The structural form** (decision M8). It
  expands too: the body is boxed structurally at the occurrence. A
  structural binder makes no scope, so the hiding of rule 6 is found from
  the operand roles of the binder heads that the engine knows, read from
  the table that `binderSitesOf()` reads (`src/epsil/`,
  `resolve-library-names.ts`), which works on unbound trees; the canonical
  and the structural form then agree on which occurrence is hidden. The
  form still keeps the name of a `holdUntil: 'never'` constant, as today.
  Why: two steps of Tycho's classification run recognizers of written
  shape on the expanded body (the mask parts of a restriction; a row whose
  shape is in a value, `A = (\cos t, \sin t)` with the row `A`), and the
  canonical form drops what they read (`tycho-desk`, 2026-11-12).
- **A body with an effect that is not framed** (`Random()`) is evaluated
  once per occurrence, which is the meaning of the engine's `Random()`.
  The Desmos meaning of a draw is Tycho's lowering.
- **Type.** A macro has none; `ce.box('A').type` is the type of the body
  in the current scope, and it differs between readers.

## 7. Capture

`subs()` avoids capture under `Sum` and under a function literal today
(`Sum(k·a, k).subs({a: k})` renames the index to `k_1`) and not under
`Integrate` (`Integrate(a·t, t).subs({a: t})` gives the integrand `t·t`;
both run today). The macro kind does not use it: an argument is the value
of a parameter in the activation of the call, and a macro body is raw text
boxed where its name is written, which is the capture that rule 2 states
and no other. `subs()` stays a tool of the host. Tycho's capture checks
(`argsWouldCapture()`, `walkBinders()`, `collectFreeSymbolsForCapture()`)
go with its inliner, and its `ceArg`/`ceIdx` renamings with the threading.

## 8. Left to later steps

- The batch (step 5), which also returns the inputs that each definition
  reaches; Tycho's classification reads them, and until then that part of
  `macro-arity.ts` stays.
- Style and colour expressions: not served by this slice. Their call of
  Tycho's threading goes; their snapshot values wait for `ce.withValues()`
  or the batch (rule spec, section 6, fourth row).
- The transport of a definition to another engine: Tycho's record carries
  "macro" and the raw body.

## 9. Acceptance

The engine:

1. A test for each rule of section 1, each bullet of section 2, each row
   of section 3 and each case of section 6, written with
   `ce.declare(…, { macro })`; and one per route by which a name is boxed
   (LaTeX, `ce.box` of JSON, a function body at `ce.assign`, a binder
   body, `ce.function` with a boxed operand, the raw form, `ce.symbol`, a
   macro named `t` with a `Solve` of a linear system). The time to box
   Tycho's document `neyret/sc3azg0frd` (the largest growth) is reported.
2. The JavaScript, GLSL, interval-js and Python targets compile rows 1 and
   7, and emit one local for the program of section 4; WGSL is run and
   reported. If M7 is approved: row 3 compiled to GLSL with `x` an input
   gives a helper that takes `x` as a parameter.
3. The rows of section 5a and the first four of 5b, as tests.
4. CHANGELOG, the `ce.declare` page of
   `~/dev/cortexjs.io/docs/compute-engine/`, `docs/SCOPING-MODEL.md`; the
   result paragraph lists the files changed and the lines added.

Tycho's adoption (the delivery rule of the rule spec, section 7: the kind
goes to Tycho when it can delete with it):

5. Its tests pass on a scratch build with every value row that Tycho's
   policy makes a macro declared as one (a row that reaches an axis or a
   name that no row defines; a slider, a list that an action writes and a
   computed collection stay values) and no threading of a value row; the
   threading of a function that reads an axis, and the tests that assert
   it, stay until 5c is built:
   `cy-function-implicit-params.test.ts` (the "CY", "GY" and "D-310"
   tests), `function-body-axis-binding.test.ts`,
   `free-name-value-definition.test.ts`, `cx-macro-transport.test.ts`.
   Their values and classifications stay; their assertions on Tycho's
   mechanism (`implicitParams`, `ceArg`, threaded calls) are removed. Its
   codegen audit: each changed record is explained by the rule.
6. Tycho deletes, in `document-ce-manager.ts`: the threading
   (`_threadMacroRefs`, `threadMacroRefsForRow`, `_threadNode`,
   `_scanMacroArities`, `_registerMacroLambda`, the `ceArg_` renamings,
   the four parameter fields) and the inlining (`expandFunctionRefs`,
   `_expandBoxedFixpoint`, `_buildFunction`, `_expandBodyEntry`,
   `_expandExpr`, `argsWouldCapture`, `walkBinders`,
   `collectFreeSymbolsForCapture`, the memos); `macro-arity.ts` except the
   reach of inputs. About 3,900 lines is its upper bound of 2026-11-11,
   not counted again. Then `list-index-lowering.ts` (669 lines) when 5a
   passes on its tests, and `broadcast-positions.ts` (367 lines) when
   CE-1246 is fixed. What stays: the `max`/`min` lowering (114 lines), run
   on every body; the policy of which rows are macros and which names are
   axes; a rewrite for a name that is read bare and also called
   (`c = |\cos a|` drawn as `y = c(x)`); the function half of the
   threading unless 5c is built; the structural expansion of FUNCTION
   bodies that classification reads (`expandFunctionRefsStructural` and
   what it needs of `_expandExpr`), until classification can decide from
   the type of a call; the items of section 8.

## 10. Decisions (user, 2026-11-12)

- **M1.** A macro is bound where it is written, in each scope, so an index
  inside a reader captures (row 7). Approved.
- **M2, M3.** Replaced: a macro is expanded in place (rule 2), not bound as
  a block local. Approved.
- **M4.** `ce.declare(name, { macro: rawJson })`. Approved.
- **M5.** No parameters. Approved.
- **M6.** A macro is declared before its readers are boxed (rule 5); the
  macro kind does not wait for slice 2. Approved.
- A reader boxed too early reads the name literally, with no error (rule
  7).
- **M7.** The shader targets pass the inputs that a helper reads as
  parameters of the helper (section 5c), as a task of its own after the
  macro kind; it is what lets Tycho delete the function half of its
  threading. Approved.
- **M8.** The structural form expands a macro, with the body boxed
  structurally and the hiding names found from the operand roles of the
  binder heads the engine knows (section 6). Approved.

## 11. Record

**Review** (`/review-spec`, Claude and Codex, 22 findings, on the version
with a block local). Most findings were consequences of the local (a held
body against a local computed early in compiled code, the hidden locals in
`.json`, the symbolic operations on a block, an engine-made local that
hides the macro in an inner scope) and have no object with rule 2. Kept:
which scope an occurrence belongs to (rule 2), a reader boxed too early,
the other targets, the acceptance split between the engine and Tycho.

**Second review** (the version with expansion in place, 18 findings).
Changed: expansion happens where a name of the input is boxed, not in
`ce.symbol()`, which engine algorithms call for their working variables;
the positions that take a name; rule 7 for a symbol that resolves to a
macro definition (it follows from rule 2 of the rule spec, with no
exception); the definition as a third kind and its readers; the call head;
a held operand and a rule; the cycle set; the acceptance routes; D8 as an
assumption of rule 6; the function threading stays until 5c. The
structural form was open then (M8). Not taken: a limit on the size of an expansion.

**The structural form, `tycho-desk`** (2026-11-12, read in
`classify-formula.ts`, nothing run): classification reads the structural
row through two hooks. Most uses need only the inputs that a macro reaches,
which Tycho's scan gives from the raw bodies. Two need the expanded body
in its written shape. Classification also looks inside function bodies for
structure (a polygon head, a point or a list that a function returns), so
the structural inliner of functions is not deleted by the macro kind; how
many corpus rows depend on it was not measured.

**The check of expansion in place with `tycho-desk`** (2026-11-12, Tycho
`aac4551a562ef8ab45278d4df405c05807ffe7cf`): it works.

- Size, measured with Tycho's
  `scripts/repros/2026-11-12-macro-expansion-size-census.mts` on 688 corpus
  states, the value rows that its policy makes macros, functions not
  expanded, no sharing (upper bounds): 102 states have a macro; the
  deepest chain is 4; the largest expanded reader is 1,097 nodes (1,081
  raw); the largest growth of one reader is 10 to 438 nodes; the largest
  growth of a document total is 14.69 times (72 to 1,058 nodes), the next
  5.19. One state has a macro that reaches itself by the script's matching
  (`art/ue1rgdbp3e`), not investigated. The time to box was not measured.
  Tycho's large expansions are chains of functions, which go by reference.
- The name: nothing in Tycho needs it from a boxed row, with the two
  statements now in section 6 (the head of a definition row, the raw
  form).
- An unframed draw: nothing relies on one draw per reader.
- Its tests: no value differs from the block local; the self-referential
  macro test becomes `macro-cycle`; D-316 keeps a small rewrite in Tycho;
  the GLSL tests of a function that reads an axis need section 5c.
