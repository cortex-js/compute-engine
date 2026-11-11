# Structured route: compile options and free names

**Status: design, not approved.** Part of the retirement of the existing
JavaScript emitter ([plan](2026-11-09-js-compiler-status-and-plan.md),
"What blocks retirement beyond coverage"). It gives each option of
`compile()` for the `javascript` target a rule on the structured route
(the `numeric-kernel` profile), and a rule for each class of free name,
local and helper that the route declines today. Collections, tuples,
lambdas and function values are in
[the collections note](2026-11-11-structured-collections-and-lambdas.md);
random draws and effects in [their note](2026-11-11-structured-random-and-effects.md);
sharing in [the sharing note](2026-11-11-structured-shared-subexpressions.md);
`mode: 'bigint'` in its own note. Choices marked **(user)** change a
documented contract or a default.

## Witnesses

A Jest setup file (scratchpad `design-options/log-setup.ts`) wraps the
exports `compile` (`compilation/compile-expression.ts`) and
`recordJsProfileShadow` (`js-profile-switch.ts`) and, with
`CE_JS_PROFILE_SHADOW=1`, logs each compilation that the existing compiler
compiles and the profile declines: the message, the options, and the type
and value of the free symbols and of the named name, read after the
compilation. Ten runs (`-w 4`, at most 100 files) covered the 297 test
files that set an option and the 566 others that call `compile`; two
reruns of 122 files logged helper types (`design-options/run*.txt`), on
`6ebc2b1574cd75487533e999288fe7339ea71228` with the uncommitted edits of
another session in the tree (the sharing of CE-1198 in
`javascript-structured-lower.ts`, `javascript-fragment-target.ts`,
`compile-expression.ts`, `structured-verify.ts`); the probes too. 12,122
declines; the counts of the messages this note treats match the shadow
measure of the commit (table). Two files ran out of memory (`compile-call-broadcast-result-operand.test.ts`,
`compile-cse-shared-subtrees.test.ts`).

| Message | Shadow measure | Logs |
| --- | --- | --- |
| unsupported binding | 695 | 695 |
| the option `vars` / `functions` / `operators` / `broadcast` / `preamble` / `imports` | 313 / 118 / – / – / – / – | 292 / 118 / 34 / 22 / 1 / 0 |
| a parameter of the type `any` / `number` | 182 / 53 | 191 / 57 |
| unsupported local declaration | 139 | 139 |
| a `Block` with statements as an operand | 178 | 178 |
| a write in a root `Block` to an undeclared name | 57 (one name) | 196 (all names) |
| a local function in a root `Block` (`Declare` / `DefineFunction`) | 100 (one name) | 97 / 112 |
| the declared result of a helper / a helper with no ground signature | 361 / 222 | 361 / 198 |
| unsupported capture (root / helper) | about 90 | 88 / 32 |

Test programs are `crafted` or `plausible` witnesses
(`docs/ISSUE_TRACKING.md`); the engine's own compilations (`implicit:*`)
run for every host of their feature. A class with only crafted witnesses
keeps its decline (`AGENTS.md`). Probes: `design-options/probe-*.ts`, output
`probe-*.log`.

## 1. The options

"Route" is what `compileInProfile()` (`javascript-fragment-target.ts`) does
today: it refuses through `profileOptionDecline()`, ignores `cse` and
`constantFold` (it passes `false` for both), and otherwise compiles through
the assembly of `JavaScriptTarget`, which applies the rest.

| Option | Existing compiler (`javascript-target.ts`, `compile-expression.ts`) | Route | Logged | Rule |
| --- | --- | --- | --- | --- |
| `to`, `target`, `profile` | select the target | `profile` with another target, a direct target or a target object throws | – | unchanged |
| `mode: 'strict' \| 'complex'` | the lane discipline | honoured | – | unchanged |
| `mode: 'bigint'` | the integer lane | refused | 469 | the bigint note |
| `fallback` | `success: false` and the interpreter, or a throw | honoured | – | unchanged |
| `vars` | `var(id)` splices the string (`_.x + next()`); the engine value of the name is hidden (`withVarsValuesHidden`); never folded; a string that is not `_.<id>` makes the result not shippable | refused | 292 | implement: an input read or a host read (below) |
| `functions` | an entry replaces the head: a string is called by name, a JS function goes in the preamble (`const f = t=>t*t;`), `{ source, pure }` declares purity; the head is excluded from folding and unrolling | refused | 118 | implement: a host call (below) |
| `operators` | `[op, prec]` replaces the emission of a head (`add(_.x * _.y, _.x)`); the function form disables folding (`constantFold = typeof operators === 'function' ? false : …`) | refused | 34 | implement as a host call; alternative: deprecate **(user)** |
| `imports` | each function's text goes in the preamble (`function helper(){return 1}`); anything else throws `Unsupported import` | refused | 0 | implement: assembly only |
| `preamble` | text before the body; its names are reserved for temporaries (`newNamingContext`) | refused | 1 | implement: assembly only |
| `broadcast` | a second compilation into a batch body (`result.batch`) that reads a shared list once per batch | refused | 22 | ignore first: no `batch`, the documented values of `broadcast: false`; then a batch emission (below) |
| `entryChecks` | the entry check of each input | honoured (the assembly): `{re, im}` for a real `x` throws, as on the existing route (`probe-misc.log`) | – | unchanged |
| `iterationBudget` | a `Sum` over the budget is `NaN`; a `Loop` counts passes | honoured (`_SYS.countLoopPass(10)`, the `< 1000` guard of a `Sum`) | – | unchanged |
| `quadrature` | the strategy of `Integrate` | ignored: `Integrate` declines | – | honoured when `Integrate` is admitted |
| `symbolDeps`, `varsObjectRefs` | the capture set and the vars-object reads | honoured (`deps ['a'] refs ['x']` on both routes) | – | unchanged; a new capture class adds its name |
| `cse` | shares pure subtrees; documented as changing no value (§2 has a counterexample) | ignored | – | §2 |
| `constantFold` | folds closed pure subtrees with the interpreter's value | ignored | – | §2 **(user)** |
| `storage` | validated, ignored on JavaScript | the same | – | unchanged |
| `strictTypes` | applied by `compile()` after a success | the same (`declare q`) | – | unchanged |

**`vars`.** Each value must be a string (`{ y: 5 }` throws `Invalid
compilation option "vars.y": expected a string`). The logged sources: 175
`_["k"]` (all from `compiledSeriesTerm()` in `library/utils.ts`, the
engine's series walk, which maps the index to hide its engine value), 36
`_.<same name>`, 5 `_.<other name>`, 45 calls (`next()`, `_.draw()`,
`_.nextValue()`) and 31 other sources (`Math.PI/4`, `(2 * _.h)`,
`globalThis.__c`). Rule: a source `_.<id>` or `_["<id>"]` is the input
`<id>` (`IRInputRead`; the emitter's `names.input` gives the text); the
admission types the mapped name as today, with its engine value hidden. Any
other source is a host read: an operation with no operand, the effect
`unknown`, and its text, emitted at each occurrence as the existing code is
(`next() + next() + _.x`), never shared or folded, and the result is not
shippable. Its kind is that of the declared type of the name, as for an
input.

**`functions` and `operators`.** Rule: a call of a mapped head is a host
call: an operation with the operands of the node, the effect `unknown`
unless `entryIsPure()` (`function-purity.ts`: a `{ pure }` declaration,
or `inferSourcePurity()` of the source) says it is pure, and the result kind of the declared signature of the head (a
signature the route has no kind for declines). The emitter writes the
spelling of the existing code: an identifier is a call (`add(_.x * _.y,
_.x)`), other text is infix at its precedence (`_.x | _.y`,
`probe-last.log`). The definitions go
in the preamble as today. A mapped head is never inlined, folded or
unrolled. Two calls of a pure host function are not shared, as on the
existing route (`myF(_.x) + myF(_.x)`).

**`broadcast`.** Without a batch body, `broadcast()` runs the ordinary body
for each cell with the same values (`CompilationOptions.broadcast`). The
batch body is the same program emitted a second time with the inputs read
from parameters, which `JavaScriptBodyNames.input` already allows; the per
batch list check is a later slice with its own measure.

## 2. CSE and constant folding

The profile ignores both while it is experimental (user decision). For
retirement:

**(a) CSE.** `CompilationOptions.cse` says that CSE changes no value
("same operations, no reassociation"). The measure below finds a form where
it does: without CSE the existing emitter writes `x · (a / b)` as
`x * (x + x) / (x * x + 1)`, which JavaScript computes as `(x · a) / b`;
with CSE, `x * _cse1`, which is `x · (a / b)`. For `e_{k+1} = (x + e_k)/(x·e_k
+ 1)` the two differ in the last place for 1 to 3 of 6 inputs at each depth
2 to 7 (`probe-cse.log`; witness `ce-346-derivative-decline-across-orders.test.ts`,
`implicit:nd`). The route gives the doubles of `cse: false`. Retirement
needs the sharing of the sharing note (time and size), and that note must
say which order a shared quotient operand gets: under option A below, the
order of the existing compiler with the same options.

**(b) Constant folding.** The existing default folds three things:

- `tryConstantFold()` (`compile-folding.ts`), at each function node, top
  down: a pure closed subtree is replaced by the interpreter's value
  (`constantFoldValue()`, `.N()`), a constant list of at most 50 real
  numbers by a literal. A function with a jump (`Floor`, `Mod`, a
  comparison) of closed exact operands folds also with `constantFold:
  false` (`closedExactJump()`): `x·Floor((10^17 − 1)/10^17)` is `_.x * 0`.
  The route declines such a node ("Floor reads no input, parameter or
  local", `probe-jump.log`), so it never gives the other value.
- `foldEmittedJavaScriptCode()` (`constant-folding.ts`): the literal
  arithmetic of the emitted text, leaving each `vars` splice in place.
- The literal folds of handlers (`Power` and `Root` of two literals), which
  the route already reproduces.

Probes (`probe-fold.log`; `x: real`, 4 inputs each):

| Program | Existing, default | Existing `constantFold: false` and route | Doubles |
| --- | --- | --- | --- |
| `x·(√2 + √3 + 1/3)` | `_.x * 3.4795977032753056` | `_.x * (0.3333… + 1.4142… + 1.7320…)` | equal |
| `x·ln 3 / ln 2` | `_.x * 1.584962500721156` | `_.x * Math.log(3) / Math.log(2)` | 1 of 4 differs |
| `x·Γ(1/3)` | `_.x * 2.6789385347077475` | `_.x * _SYS.gamma(0.3333333333333333)` | 4 of 4 differ |
| `x·cos(1)²` | `_.x * 0.2919265817264288` | `Math.cos(1)` squared | 4 of 4 differ |
| `x·(0.1 + 0.2)` | `_.x * 0.3` | `_.x * (0.1 + 0.2)` | 2 of 4 differ |
| `x·Σ_{k=1}^{10} k²` | `_.x * 385` | written-out terms | equal |

**The measure** (scratchpad `design-options/fold-setup.ts`, five runs of
the file lists 1, 2, 4, 6 and 7, about 400 files). For each compilation
that the existing compiler compiles and the profile admits, the setup
compiles again with the caller's options, with `cse: false`, with `cse:
false, constantFold: false`, and with the profile, and runs the four codes
at three sets of inputs when the codes differ (an expression of more than
5,000 nodes counted on paths is skipped: 11). Of 8,275 admitted
compilations, 2,963 already pass `constantFold: false`. Of the other 5,312
(4,550 of the engine's own), folding changes the code of 105 and CSE that
of 1,207; the route's double differs from the default code in 23: 17 by a
fold (`ln 5`, `ln 3`, `Γ(1/2)`, `Erf(√2/2 · √y)·√π`, `Π_{j=1}^{153} j`;
20 of the 23 are integrands and limit probes of the engine) and 6 by CSE
(above). Where it ran, the route equals the existing compiler with `cse:
false, constantFold: false` in every case (0 of 1,305).

Two options:

- **A. Fold in the lowering, as the existing compiler does.** The admission
  applies the gates of `tryConstantFold()` and `constantFoldValue()` to each
  closed pure node and gives a `literal` operation; `constantFold: false`
  turns it off except for a closed jump. The route's doubles then equal the
  existing compiler's with the same options, and the baseline of the
  profile's contract changes from `cse: false, constantFold: false` to "the
  same options". Measure: the measure above with the route folding (0
  differences against the default), and the compile time of the engine's
  compilations, since a fold evaluates with the interpreter.
- **B. Never fold.** Retirement changes the last place of results of hosts
  with the default options; `CompilationOptions.constantFold` ("compiled
  output tracks `evaluate()`") and the guide's "Constant Folding" change.
  Measure: the measure above over the full suite and the corpus.

**Recommended: A (user decision).** It keeps a documented default; under B
the engine's own integrands and limit probes are the programs that change
(20 of 23 above), with ordinary constants (`ln 3`, `Γ(1/2)`).

## 3. Names

| Class (unsupported binding, 695) | Count | Existing compiler | Rule |
| --- | --- | --- | --- |
| declared `number` | 244 | a real input with an entry check: `_.xn + 1`, and `{re, im}` throws "compiled as a real number" | the default kind of the mode: real (`strict`), complex (`complex`) |
| declared a numeric union of `real` with `nan` or `signed_infinity` | 19 | `_.ex + 1` | real: a double holds each member |
| a value that is a list or a tuple (`vector<integer^3>`, `Range`) | 129 | folds the read (`At(lv, 2) + 1` is `3`) | collections note |
| declared a list, a tuple or a union with one (`list<real> \| real`) | 86 | R2 dispatch | collections note |
| declared `broadcastable<…>` | 33 | a shape test (`_SYS.matrixPowerShape(_.bc, 2) ?? …`) | collections note |
| declared or valued a string, a character | 51 | `_SYS.eqt(_.ss, "a")` | keep declining: no string in the numeric kernel |
| an operator name used as a value (`"readName"`) and a function value | 39 | a function value | collections note (lambdas) |
| a value that is a numeric expression (`ev := (xr + 1)²`) | 26 | `const _val_ev = _SYS.pow2(_.xr + 1);` per call | lower the value in the root region where the name is read, its free symbols as inputs; the name goes in `symbolDeps`; in a helper, decline |
| a complex value, or a number literal of a name declared `complex` | 9 | the value | a complex capture (snapshot `{re, im}`) |
| `Missing` (15), a value kind (`gf8`, `meters`, `Row`: 22), `~oo` (3), a value `Random()` (3) | 43 | various | keep declining; `Random()` is the random note |
| a number literal that the snapshot refuses: a shadowed `Pi` with the value 1 or 3, `k: number = 7` | 6 | the value | a real capture (§3, captures) |
| a type read after the compilation that is admitted (`real`) | 7 | – | not classified: the type at compile time was not logged |
| a dictionary, a union with a tuple or a collection kind | 3 | | collections note |

**`any`, `unknown` and `number` parameters (248).** R1 of
`docs/COMPILATION-MODEL.md` concerns inputs that the code reads: the
existing compiler declines `xa + 1` with `xa: any` (`untyped-input`) and
`(q: any) ↦ q + 1` ("declared `any` … compiled code does not test the
shape"), so the route keeps both declines. It compiles `(p: real, q: any)
↦ p + 1` to `(p, q) => p + 1`: the parameter is never read. 179 of the 248
are such unused parameters, all in `compile-list-element-unknown-arith.test.ts`
(crafted). Rule: a parameter that the body never reads has no
representation, whatever its type. The 69 others: 57 declared `number`,
the rule of the table; 12 `any` read, keep declining. A name declared
`unknown` already compiles on both routes (binding units give it the
default kind).

**Captures (120).** 9 are strings (keep declining), 2 lists, 2 `Missing`.
25 are number literals of a name declared `number`: `numericSnapshot()`
requires a declared subtype of `real`; rule: a `number` name with a real
literal value is a real capture. 46 are number literals of a parameter or
a local of an enclosing call (`f(d) := Sum(Map(x ↦ x + d, …))`,
`map-compile-captured-values.test.ts`; `Integrate` inside a function
call): the value is a frame value, and the identity checks of
`numericSnapshot()` (`ambient.value !== binding`, `_getSymbolValue(name)
!== value`) refuse it (from the code, not verified by a probe). The
existing compiler writes the value read at compile time, and its consumers
key their caches on `symbolDeps`. Rule: snapshot `_getSymbolValue(name)`,
add the name to `symbolDeps`, and make `assertCurrent()` compare that
value. 4 hold a numeric expression (the rule of the table). 4 are a
local of the root block that a helper reads (`Declare(minR, …); ok(4)`,
`compile-references.test.ts`): the rule of local functions passes it as a
parameter. 28 name a helper's capture that the log did not resolve.

## 4. Blocks and local declarations

| Form | Count | Existing compiler | Rule |
| --- | --- | --- | --- |
| a root `Block` whose one operand is a `Block` (`["Block", ["Block", …]]`, the form of the Epsil programs of `ce-1163-run-async.test.ts` and `assign-to-list-element.test.ts`) | 124 | the inner block: `(() => { let s; s = _.x; return s + 1 })()` | unwrap: the value of a `Block` of one operand is that operand (the route compiles the inner block alone to `_.x + 1`) |
| a `Block` of declarations with a value and a last value, as an operand (a `Sum` body `{ t: integer = j + 1; t }`: 45; `{ a ⩴ 3.7x; a − ⌊a⌋ } + 1`: 9) | 54 | a block that only declares is a value | each declaration is a value of the region of the operand; a `Block` with any other statement as an operand stays declined on both routes |
| a write in a root `Block` to a name with no definition (`m ⩴ n + 1; 2m`, the guide's example) | 196 | a local: `(() => { let s; s = (_.x * _.x); return s + 1 })()` | a local, when the first mention of the name in the block is such a write, at the top level of the block; its kind is that of the value; a read before it or a first write in a branch or a loop declines |
| `Declare(a, 'unknown', v)` | 57 | `let a = 3.7 * _.x;` | the `let` form |
| `Declare(a, 'number', v)`, `'Numbers'` | 20 | `let n = 0; n = 3` | the kind of a `number` name |
| a local of a list type | about 45 | | collections note |
| a redeclaration in a nested block, a `color` local | 5 | | keep declining |
| a local function (`Declare(g, 'function', (t) ↦ …)`: 97; `DefineFunction`: 112) | 209 | a closure: `let g = ((t) => (t * t) + _.x); return 1 + g(3)` | a helper of the program (below) |

**Local functions.** The route has helpers compiled once
(`function _tv1(_tv2) { … }`). A local function becomes such a helper: its
parameters, then one parameter for each free name it reads that is an
input or a local of the enclosing block, passed at each call. A closure
reads such a local at the call, and the route has one definition per value
at each call site, so the value passed is the value the closure would
read. A call of a name that a local function declares calls that helper,
also when the name is a library operator (`Declare(sin, 'function', (t) ↦
t + 1); sin(x)`, `compile.test.ts`). The signature follows the rule of a
helper with no declared signature. Declines: a local function that writes
a name it reads from the block, that calls itself, that is used other than
called, or that is declared in a branch or a loop. Witnesses:
`compile-block-local-function.test.ts` (59), `compiled-declared-function-type.test.ts` (41).

## 5. Helpers

| Declared result (361 declines) | Count | Rule |
| --- | --- | --- |
| `number` (`f: (unknown) -> number`; the existing code `const _fn_f = (t) => t * t + 1;`) | 217 | the default kind of the mode, as a `number` input |
| `real` with `nan` or `signed_infinity` | 10 | real |
| a bound type parameter (`(x: T) -> T where T: number`; `(xs: T) -> number where T: list<number>`) | 28 | one helper per kind of argument in the bound, as R2 compiles one function per argument shape; a later slice |
| a tuple (56), a list of lists or tuples (19), a bare `list` (12), a union with a list or a tuple (6), `broadcastable<…>` (7) | 100 | collections note |
| `any` (2), `string` (1), `character` (3) | 6 | keep declining |

A helper declared `function` (198, "no signature of ground types"; the
existing code `const _fn_q = (t) => 3 * t;`) has the rule of a helper with
no declared signature: each parameter the default kind, the result the
fact of the body. A helper whose signature has effects (41) is the random
and effects note.

## 6. Slices

Each slice: the admission and lowering change, the tests of the route
(`compile-javascript-profile.test.ts` and the structured tests) with one
test per class that compares the code and the values with the existing
compiler, the shadow measure, and a commit. The counts are the logged
declines of the class; a program can have another reason to decline, so
the admissions gained are fewer (an estimate).

1. **`number` names**: inputs, parameters, helper results, local
   declarations, captures with a literal, unions with `nan` or
   `signed_infinity`. About 590.
2. **Blocks**: the unwrap, declaration blocks as values, the `let` form of
   `'unknown'`, undeclared writes in a root block. About 430.
3. **`vars`**: input reads (`_.<id>`, `_["<id>"]`): 216, all 175 of the
   series walk among them; then host reads: 76.
4. **Host calls**: `functions` (118) and `operators` (34).
5. **Assembly options**: `imports`, `preamble`; `broadcast` ignored. About 23.
6. **Local functions and `function` helpers**: 209 + 198.
7. **Captures**: frame values, a held numeric expression, complex
   snapshots, refused literals. About 90.
8. **Constant folding**, after the user's decision: option A, then the
   shadow measure against the default options.
9. Unused parameters of any type (179, crafted), the batch body of
   `broadcast`, bound type parameters (28): each only on a measured need.

## Open choices

1. **Constant folding and the CSE order (user).** A: fold as the existing
   compiler, baseline "the same options"; alternative B: never fold.
2. **`operators`.** Implement as a host call; alternative (user):
   deprecate the option before retirement.
3. **A `vars` host read**: one operation per occurrence, as the existing
   splice; alternative: one read per call (host code runs less often).
4. **`broadcast`**: no batch body first; alternative: the batch body now.
5. **Local functions**: helpers with captured names as parameters;
   alternative: a closure operation, which GLSL could not emit.
6. **Frame values**: a snapshot keyed by `symbolDeps`, as the existing
   compiler; alternative: decline (the `Map` and integrand consumers keep
   the existing compiler).
7. **Crafted-only classes keep their decline** (unused `any` parameters,
   strings, value kinds); alternative: implement every class.
