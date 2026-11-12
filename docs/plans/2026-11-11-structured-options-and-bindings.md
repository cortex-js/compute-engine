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

## Result of slice 1

On `1c448807b4e9fc40fbb33c2b72babd151cb505a7`, the `number` names of
slice 1 except the local declarations (another change owns the rules of
locals). The rule is `declaredNumberKind()` in
`javascript-fragment-target.ts`, the lane of `wideNumericType()` of the
existing compiler:

- **Inputs** declared `number` (or `number | nan`): real in `strict`
  (`_.xn + 1`, with the entry check of a real input), complex in `complex`,
  converted at each read (`_SYS.csin(_SYS.cplx(_.xn))`, `IRInput.lifted`).
  A union of a real type with `nan` or `signed_infinity` is real in both
  modes (`_SYS.csqrt(({ re: _.ex, im: 0 }))`). Other wide types
  (`finite_number`, `complex | nan`) keep their decline: no witness.
- **Parameters** of a `Function` literal: the same; `any` keeps its
  decline, read or not.
- **Helpers**: a `number` parameter is real in `strict` and complex in
  `complex`, where a real argument declines with its own message (the
  existing compiler passes the number and converts it in the body). A
  `number` result is the fact of the body: the existing compiler returns a
  number from `(real) -> number` with the body `t + 1` in the `complex`
  mode, and a complex value from `(number) -> number` with `sin(t)`. A
  result `nan | real | signed_infinity` is real. `Typed(v, 'number')`
  around the value of a body keeps the fact of `v`, and declines in the
  `complex` mode for a real `v`: the existing emitter writes
  `_SYS.cplx({ re: v, im: 0 })` there, and the lowering writes no
  conversion for `Typed`.
- **Captures**: a name declared `number` (or a mapped union) whose value is
  a finite real literal is a snapshot with the kind of its value
  (`1.5 * _.xr`); a complex value keeps its decline.
- `defaultedSymbols` lists none of these names: their type is declared.

Shadow measure, 110 test files that reached these messages (108 files
wrote counters): admitted 622 → 835 of the 4,908 compilations that the
existing compiler compiles. Messages: "unsupported binding" 560 → 325;
"the declared result type of the helper … is not a number" 351 → 105;
"the parameter x of the function has the type number" 53 → 0, and "the
parameter z … has the type any" 182 → 233 (the same crafted file, whose
`any` parameter is now the first refusal). The programs that pass a
refusal reach later ones: "the parameter … of the helper has no type
annotation, and the helper has a declared signature" 13 → 150, a helper
parameter `tuple<number, number>` 0 → 30, a chained `Less` 0 → 18. A
value check of the 835 admitted compilations against the existing
compiler (`cse: false, constantFold: false`, three sets of real inputs)
found no difference in the 192 that read a name declared `number` or a
mapped union.

The random differential tester (`scripts/js-profile-fuzz.ts`, inputs `xn`
and `ex`, a parameter `nb`, a capture `cn`, helpers `(number) -> number`
and `(real) -> number`; seeds 51 to 53, 15,000 programs) found no new
class. Two findings reach the known class D5 (an `At` of a `Comprehension`
whose element type the existing compiler reads as `number`, lifted in the
`complex` mode) through a `number` name: `i·At(Comprehension(fr(x)), -1)`
(`0` for `-0`) and `At(Comprehension(cn), 1)` (shape only). The fix of D5
that declines such an `At` covers both.

The next refusal of the helper witnesses is the annotation rule: a helper
with a declared signature whose literal has no annotation
(`f: (unknown) -> number`, `f := t ↦ t² + 1`).

## Result of slices 3 to 5

On `50e3e41a43ba6c1febb9b5f291a78d2e6bc28feb`, the options `vars`,
`functions`, `operators`, `imports`, `preamble` and `broadcast`. The rules
are in `docs/COMPILATION-MODEL.md`, "The options of the host"; the code is
the section "The options of the host" of `javascript-fragment-target.ts`
(`structuredHosts()`, `varsEntryOf()`, `admitHostRead()`, `hostHeadOf()`),
the operation `host` of `structured-ir.ts` (`IRHostCall`, with the bindings
`IRProgram.hosts`), its checks in `structured-verify.ts`, its lowering in
`javascript-structured-lower.ts` and its text in
`javascript-structured-emit.ts`.

- **`vars`, an input read.** A source `_.<id>`, `_["<id>"]` or `_['<id>']`
  is an input that the code reads at the source (`_.w + _.x` for `x + u`
  with `u: '_.w'`). The name has its declared type, also when it has a
  value, or the default kind (`defaultedSymbols`). `varsObjectRefs` and the
  entry check follow `isOpaqueVarsSource()`: only the spelling of the name
  itself (`u: '_.u'`) is recorded and checked, as on the existing route.
- **`vars`, a host read.** Another source that is one operand (a name, a
  number, a call, a member access, an expression in parentheses, with a
  trailing `++` or `--`) is the operation `host` with no operand and the
  effect `unknown`: one read per occurrence, in the order of the program.
- **`functions` and `operators`.** A string, a function value (in the
  preamble), `{ source, pure }`, and an `operators` entry `[name, prec]`
  whose operator is an identifier are the operation `host` with the operands
  of the node: `pure` when `entryIsPure()` says so, `unknown` otherwise. The
  verifier checks the binding, the arity of a read, the types of the
  operands and of the result against the binding, and that the effect is
  `pure` exactly for a pure call. `analyzeExecution()`: an `unknown` host
  operation is not pure and not shippable (`effectBlockers`); a pure one is
  pure and not shippable (a `workerPortable` blocker: a worker does not have
  the function).
- **`imports` and `preamble`** go to the existing assembly; an import that
  is not a function throws ``Unsupported import `x` `` as on the existing
  route. **`broadcast`** is ignored: no `batch`. With `broadcast: true` the
  existing compiler makes no batch for a program that it delegates either,
  and its batch body gives the values of the scalar body for the list
  programs tested.

Where the code differs from this note:

1. **A host operation is bound to a `const` at its position**, not written
   at its use: `(() => { const _tv1 = next(); return 2 * _tv1 + _.x; })()`
   for `x + 2t`. The emitter writes a value at its use only when no impure
   operation lies between; the number and the order of the calls are those
   of the existing code (`next() + next() + _.x` reads twice in the order of
   the operands; tested, and compared by the fuzz tester).
2. **The complex mode declines a host read and a host call.** The existing
   emitter reads a wide read once per part of a complex value
   (`_SYS.cplx(next())` twice), and binds a complex operand ahead of the
   others. A host operation counts as a draw in `refuseHoistedDraws()`: two
   or more draws, reads or calls when one is in a complex value decline.
3. **An entry for an operator or a constant of the library declines**
   (`functions: { Sin: … }`, `operators: { Add: … }`, `vars: { Pi: … }`).
   The existing compiler applies its own rewrites of library operators
   first (`Subtract` becomes `add(x, -y)`, an `Add` entry in `functions` is
   not used), so the code of such an entry is not the call of the entry.
   A `vars` key with the name of a library binding declines only when the
   node reads that binding (`systemScopeBinding()`): a sum index `i` that
   the series walk maps is admitted.
4. **An infix `operators` entry and the function form decline.** The note
   wrote "other text is infix at its precedence"; none of the 38 logged
   `operators` compilations needs it (17 use the function form, 19 an entry
   for a library operator).
5. **A pure host call is not shippable.** Conservative: the existing route
   reports `shippable: true` for a call of a function value that it puts in
   the preamble.
6. **A `vars` name that the body of the root `Function` or of a helper
   reads declines**, and so does a root symbol that an `operators` entry
   maps. The existing compiler splices the source in the body; no logged
   compilation needs it (3).
7. **A `vars` entry for a name with a value and no declared type, or for a
   constant, declines** (9 logged): the existing compiler types the name by
   its hidden value. Declare its type.
8. **A function of the host needs a result type that is real, integer or
   `number`** (12 logged decline with an `unknown`, list or tensor result).
9. **`Power(u, -2)` of a name that `vars` maps** is `Math.pow(u, -2)`, as
   the existing emitter writes it (`varsKeys` in `javascript-target.ts`);
   `1 / u / u` differs in the last place (`u = 0.4641588833612779`). The
   fuzz tester found it. A probe grid of 79 forms (each `Power` form of the
   rule, the functions of the profile, `Root`, `Log`, `Mod`, `Min`, `Max`,
   quotients, comparisons, `Sum`, complex forms) for a name declared
   `real`, `real<0..>` and `integer`, mapped to `_.w`, `_["w"]` and a host
   read, in both modes (98,856 points), finds no other difference. The
   existing emitter reads `varsKeys` only for the exponents 2 and -2, and
   `_SYS.pow2(b)` computes `b * b`. `Floor`, `Ceil` and `Round` of a name
   declared `integer` whose host read returns a non-integer differ: the
   existing compiler drops the rounding of an integer. That value is outside
   the type of the name.
10. **An `If` statement whose branch calls the host is kept**
    (`canThrow()` holds `host`), also for a function declared pure: the
    existing compiler evaluates `t = g(x)` in the branch when `t` is not
    read, so the host counts the call, and a throw of the function
    surfaces. Without it, the effect facts let such an `If` go.
11. **A `Sum` or a `Product` that calls a function of the host declared
    pure declines** (`refusePureHostInAggregates()`). The existing emitter
    skips the terms after an accumulator of `NaN` when they have no effect
    (`isEmissionSkippable()`), and so calls such a function fewer times. A
    call that is not pure has an effect: every term runs on both routes,
    tested at `x = NaN`. The fuzz tester found it on the new base.

A host operation is never shared by the lowering memo (`reachesHost()`):
a node object reached twice is two reads or two calls, also for a pure
function, as on the existing compiler with `cse: false`
(`_.x + g(_.x) + g(_.x)`); tested for a read and for a call.

Review round 2:

12. **An operation with the effect `unknown` invalidates the memo**
    (`afterUnknown()`): a host read, a host call not declared pure, and a
    call of a helper that reaches one, give a new epoch and count as a
    write outside every open `inScope()`. `h(√x, g(x), √x)` with one node
    object for `√x`, where `g` sets `_.x` from 4 to 9, gave `√4` twice
    (`h(2, 5, 2)`); it now computes `√9`, as the existing compiler. A call
    declared pure does not change the vars object: no invalidation. An
    input that is not shared is read at each occurrence, and the emitter
    does not move a read across an impure operation: `x + g(x) + x`,
    `x · g(x) · x`, a comparison, an `If` condition and a `Sum`, in its
    unrolled and its loop forms, give the values of the existing compiler
    with a `g` that changes `_.x` (probe and test).
13. **A callee source must be a name, a dotted path of names, or one
    operand that `inferSourcePurity()` reads as a function expression with
    a pure arithmetic body.** The existing emitter evaluates the callee
    first (`_.getTransform()(_.next())`), the profile after the arguments.
    It declines always, also with pure arguments: such a callee can change
    an input that an argument reads. The logged sources of the 99 files are
    names, dotted paths (`_.f`, `_SYS.mylist`, `Math.random`), function
    values (a name in the preamble) and function expressions in
    parentheses (`((t)=>t*t+1)`, 19); none has a call, an index or a
    `new` in its callee. A function expression whose body is not pure
    arithmetic (`((t) => { count++; return t; })`, 1 logged, and the
    list-valued ones that decline for their result type) declines.
14. **A `preamble` that is not blank makes the result not `pure`**: the
    runner executes it on every call (a preamble that increments a global
    counter counts 2 for two calls, on both routes). An import is a function definition that runs only when the code
    calls it, so it changes neither `pure` nor `shippable`.
15. **A source with a line terminator or a comment declines**
    (`sourceLayoutRefusal()`), for `vars` and `functions`: `return`
    followed by a line terminator returns `undefined` on the existing
    route. An `operators` entry is a name, which has neither. No logged
    source has one.
16. **The memo of `regionReachesHost()` caches no answer that read a
    region in progress**, unless the answer is `true` (a hand-built cycle
    `A = [call B, host]`, `B = [call A]` in the test). The two memos of
    `javascript-fragment-target.ts` walk the helpers, which have no cycle
    (`collectStructuredHelper()` refuses recursion first): their
    provisional `false` is removed and the comment says so.
17. **A local in a complex sum** (older than this change):
    `Function(Block(Declare(t, 'integer', 0), t + (0.5 - i)·a), a: real)` at
    `a = -0` was `-0` on the profile, `0` on the existing compiler, which
    writes the local as its name and keeps the term. The lowering records
    the values that a local holds (`IRProgram.localValues`); the complex
    `add` drops a `0` term, and writes the parts of a complex literal as
    constants, only for a value that no local holds. A probe grid over 38
    forms (`0`, `1`, `-1` factors, the bases and exponents of `Power`,
    `Root`, `Mod`, `Log`, `Arctan2`, `Max`, comparisons, `Sum` bounds and
    bodies, the rational factor of a product, an `Interval` bound of a
    draw, complex sums and products), with a local declared `integer` or
    `real` holding 0, 1, -1, 2 or 0.5 and a capture holding the same, in
    both modes (911 admitted programs, 9,110 points), found only this
    class, in the two forms `t + (0.5 - i)·a` and `a + t + i`; after the
    fix, none. A local declared `complex` holding `2i`, `1 - i`, `i` or
    `-0.5i` in a sum or a product gives the existing values too (128
    points). A capture is written as its number on both routes.
18. **A read of an input around a call that changes the vars object, with
    a complex operand.** The fuzz tester (`hm`, which sets `x` of the vars
    object) found `x + hm(1)·Arcosh(x)`: the existing emitter evaluates the
    complex operand first and reads `_.x` after `hm`, the profile reads it
    before. When a host operation of the program is not pure, a read of a
    name of the root scope counts as a draw in `refuseHoistedDraws()`, so
    such a program declines; a program with no complex operand keeps the
    order of the operands on both routes (item 12).

Fuzz tester, round 2: seeds 61 to 63 with `--host` (15,000 programs, `hm`
added) and seeds 11 to 13 without it (30,000 programs, with the locals
`k0` of item 17): no failure of the profile. Without `--host`, one value
difference of the class CE-1203 (`-At(Comprehension(Ln(x)), 1)`) and the
documented shape difference `(0·3·Mod(1, u) + x)/u`. With `--host`, the
class of item 18 (1 program) before its fix, and after it no difference
of value, shape or host calls.

**Shadow measure** (on `1652626570dcdbb481e5ec15f5ccd890ce1b4113`, before
the move to `50e3e41a43ba6c1febb9b5f291a78d2e6bc28feb`), the 99 test files
that reached the option messages, before (the commit) and after (the
change):

| Consumer | Baseline | Admitted before | Admitted after |
| --- | --- | --- | --- |
| public | 3,898 | 656 | 731 |
| implicit:series | 175 / 173 | 0 | 169 |
| total | 4,430 / 4,428 | 990 | 1,234 |

The messages "the option `vars` / `functions` / `operators` / `broadcast` /
`preamble` is not in the profile" (292 / 118 / 34 / 22 / 1) are gone. Per
option, the compilations that the existing compiler compiles and the
profile admits (an option-logging Jest setup on the same files): `vars`
0 → 32 of 116 public and 0 → 169 of 173 of the series walk, `functions`
0 → 40 of 118, `operators` 0 → 1 of 38, `broadcast` 0 → 2 of 23,
`preamble` 0 → 1 of 3, `imports` 0 → 1 of 1. The series walk keeps 4
declines: `Floor` of `1e30` (2), `Factorial`, `Sinc`. The programs that pass
the option now reach other refusals: a chained `Less` (+16), `Integrate`
(+15), a tuple (+11), a `list<number>` input (+13).

**Fuzz tester.** `--host` adds `vu` (`_["vu_"]`, declared `real`), `vz`
(`_.vz_`, no declared type), `vr` (a read of `__fuzzRead()`), `hp`
(declared pure), `hq` (not pure) and `ho` (an `operators` entry); the
outcome includes the reads and calls of the host in order. Seeds 61 to 63,
15,000 programs: the first run found the `Power(u, -2)` class (14
programs), and the run on `50e3e41a4` the class of item 11 (1 program).
After both fixes: no failure of the profile, no difference of shape, and
no difference of value or of host calls in a program that reads or calls
the host. One class remains, with no host name, and it gives the same code
on `50e3e41a4` without this change:
`Function(Block(Declare(t, 'integer', 0), t + (0.5 - i)·a), a: real)` at
`a = -0` is `-0` on the profile and `0` on the existing compiler, which
adds `t`. Without `--host`, seeds 11 and 12 (20,000 programs): no
difference and no failure.

## Result of slices 2 and 6

On `775bc003b8ae9fcb40a0766fd62e2b5b40163759`. Admission in
`javascript-fragment-target.ts` (`checkValueBlock()`,
`checkLocalFunction()`, `resolveLocalFunction()`, `implicitLocal()`,
`localFunctionStatement()`), the lowering of implicit locals and capture
arguments in `javascript-structured-lower.ts`, and two hooks of
`fragment.ts` (`FragmentDefinition.localFunction`, and the `localType`
hook for an implicit local). Tests:
`compile-javascript-structured-blocks.test.ts`.

**Slice 2, blocks.**

- `Block(Block(…))` and a block as the value of a body: the inner block's
  statements in the region of the body, then its value. A block statement
  at any place is its statements in its own scope.
- A block whose statements are each a `Declare` with a value, as an
  operand: the declarations in the region of the operand, in order, then
  the value (in a branch, a short-circuit operand and a `Sum` term, in the
  region of that branch, operand or term). Another statement declines, as
  on the existing compiler. An operand block whose type is not numeric or
  boolean declines: the existing compiler reads it with `_SYS.bcast` and
  `_SYS.smul`, whose doubles differ (`0.5 · (u/xn) · {b0 ⩴ 1; u}` in the
  `complex` mode, with `u` undeclared: `NaN` where the route gives
  `-Infinity`; found by the random tester).
- `Declare(a, 'unknown', v)`: a `let` with the type of its value.
- A first write to a name that the block binds and no `Declare` declares
  declares a `let` local (the rule of `walkBlock()`), also in a nested block
  and the body of a `Function`. A first write that reads the name declines.
- Differences from the note: a local of a nested block with the name of a
  parameter, an input or an outer local declines (no shadowing), and
  `Declare(a, 'number', v)` is not done. Two rules of the existing compiler
  that the random tester found are now rules of the route: in the `strict`
  mode a `let` local written a real and a complex value declines
  (`assignedTypesConflict()`), and in the `complex` mode a read of a `let`
  local declines when its type is not real, boolean or a list (also
  `missing | real`, the value of a `Which` with no default, which the
  existing compiler reads `_SYS.cplx(t)`).

**Slice 6, local functions and helpers declared `function`.**

- A local function (`Declare(g, 'function' | 'unknown', F)`, a `let` of a
  function, `DefineFunction(g, F)`) that is a statement of the body of the
  root, in the `strict` mode, is a helper of the program: the parameters
  of the literal, then one parameter per name of the body that the literal
  reads (directly or through a local function it calls), each passed at
  the call with its value there. A closure reads that value, so the values
  are the same (`a ⩴ 2x; g(t) ⩴ t + a; a ⩴ 10; g(3)` is `13`). The
  parameters follow the rule of a helper with no declared signature.
- Declined, each with its message: a local function in a branch, a loop, a
  nested block statement, an operand or the body of a user function; one
  that calls itself; a second definition; a declared signature
  (`(real) -> real`); the name of a library operator or of another name of
  the program; a parameter with the name of a local; a use as a value
  (`Map(L, g)`); a read of a local that a later statement declares; a local
  function that no statement calls (its body is typed at its calls, and the
  existing compiler declines what the closure's body declines: `Min` of a
  complex operand); every local function in the `complex` mode, where the
  existing compiler reads the value of each call as a complex value
  (`_SYS.cplx(lf(…))`, also for a real body).
- A helper declared `function`: the rule of a helper with no declared
  signature in the `strict` mode, each annotation of the literal the type
  of its parameter. In the `complex` mode it declines: the existing
  compiler reads each parameter, also one annotated `real`, and the value
  as complex values (`i · f(x)` with `f(t: real) := 2t` has the real part
  `-0` at `x = -0.75`, and `0` on the route). A body with `Integrate`
  keeps its decline.
- Review round 2: a first write of a function literal (`g ≔ (t) ↦ t + 1`)
  is a local function by the same code path; a local function that reads a
  `vars` host read declines (the existing closure reads it in its body: not
  at all in a branch not taken, and after a host call before it), and one
  that reads an input declines when the options have a host read or a host
  function not declared pure (`h` that writes `_.x` gives the closure the
  new value); in another angular unit, a `let` local and a local function
  in the dictionary form decline (CE-1207; the other forms of a local
  function, a helper declared `function` and a helper with a signature give
  `sin(30°) = 0.5`), and so does, in the `complex` mode, a first write that
  declares a local (the existing compiler reads the local of the rebuilt
  block as complex: `t ≔ 1; arctan(t)` gives `NaN` where the interpreter
  gives 45; found by the tester with `--deg`), the calls of a local function reach it through the
  binding of the block before the rewrite, and its body, a node of the
  rewritten root, is not rewritten a second time.
- Differences from the note: the decline of the `complex` mode for both
  forms, of an uncalled local function, and of a local function declared
  with a signature (the note gives it the rule of a helper with no
  signature only when it has none). A local function that writes a name it
  reads is refused by the existing write rules (a helper body writes no
  name of the body around it).

**Shadow measure.** The 121 test files that reached the messages of
these slices: admitted 590 → 768 of the 3,620 compilations that the
existing compiler compiles (public 479 → 644, `implicit:integrand` 71 →
81, `implicit:test` 1 → 4). Messages gone: "a Block with statements only
as the root … and not as an operand" (181), "the helper … has no signature
of ground types" (213), "no local function in a root Block" (at least 158, the messages listed),
"a write in a root Block only to a local that a Declare declares" (at
least 154); "unsupported local declaration" 141 → 83. Admitted where the
existing compiler declines: 7 → 9; the two new ones read a name with no
declared type (`f(z)` with `z` undeclared, `G(x) + 1` with `x`
undeclared), the default kind of the profile.

**Random tester.** The generator adds a `Block` in a `Block`, block
statements, `ValueBlock` operands, locals declared `unknown`, first writes
to `t`, local functions `lf` (each form, with and without captures) and the
helper `fq` declared `function`. Seeds 81 to 85, 50,000 programs: the
first run found the operand-block class, two `complex` shape classes (a
local function's call, a `let` local of the type `missing | real`) and two
programs that the existing compiler declines (an uncalled local function
with `Min` of a complex operand, a `let` local written a real and a
complex value). After the fixes: no failure of the profile, no difference
of value or of shape for inputs in their types; the programs that only the
existing compiler declines all read the undeclared `u` (the default kind),
except `fs(Mod(y, 0), 2)` (2 programs, a class from before this change).
The 43 shapes of disagreement with the interpreter are the precision
caveat of a discontinuous operator and large arguments of `Gamma`,
`Sinh` and `Cot`, as before.

**Tycho preludes.** The census of the preludes held in
`compile-javascript-profile.test.ts`: 40 of 58 admitted before and after;
one program (`buddhabrot c`, a block of declarations whose value is an
`Rgb`) now declines for the type of the block operand instead of
`unsupported head Block`.

## Result of the `number` inputs and the signature types (2026-11-11)

On `fdbbf5091`, the work items 2 and 11 of the decline census of
2026-11-11 (`2026-11-11-js-profile-decline-census.md`), and the ruling of
the user of the same day: under the profile, a name declared `unknown` or
with no declared type may be read as a number. The table of each operator,
with the existing code for `real` and for `number`, is in
[the emission rewrites](2026-11-09-js-pilot-emission-rewrites.md), "Values
of the type `number` in the `strict` mode"; the tests are
`test/compute-engine/compile-javascript-structured-number-inputs.test.ts`.

- **Scalars declared `number`** were admitted in the `strict` mode by slice
  1; nothing changed for them.
- **Lists**: in the `strict` mode (the default), an input, a parameter or a
  local of the type `list<number>`, `vector<n>` or `vector` is a list of
  reals (`structuredListType()`), read with the label `"number"`. A node
  whose engine type is `number` only because it reads such values is real
  for the folds and for `At` (`isWideRealInStrict()`); a node that makes a
  type that is not real from real operands (a radical or an inverse
  function of a `real` operand, `I/2.5` with `I: list<real>`) or that has a
  complex type keeps the decline, because the existing compiler reads it on
  the complex lane through `isComplexValued()`. The `complex` mode is
  unchanged.
- **Signature types**: a parameter with no annotation whose signature type
  is `unknown` has the default kind of the mode, as for an inferred
  signature (the existing compiler writes the same function, and compiles a
  copy per argument type for a list argument, which declines). A list or a
  tuple of the signature was already read; `broadcastable<…>`,
  `collection`, `string` decline with the name of the type.
- **The ruling**: element-wise arithmetic of a list with a scalar name of no
  declared type or declared `unknown` (`L·u`) is admitted in the `strict`
  mode: the existing compiler writes the same `_SYS.bcast` closure as for a
  `real` name, in the same operand order. No probe produced the
  `_SYS.mulChecked` form that the refusal named. The `complex` mode keeps the
  decline. `any`, unions of shapes and `collection<…>` keep their declines.
- **A defect fixed on the way**: a call of a user function whose parameter
  is declared a list with a stated width (`list<real^3>`, `vector<3>`) with
  an argument whose type does not state it (`list<real>`) gave another value
  (the existing compiler unrolls by the width: `NaN` for a list of 1
  element); it declines now (`refuseListWidthArgument()`), for a helper and
  for a local function. An argument whose list type states the same width
  (`kw(V3)` with `V3: vector<3>` and `kw: (list<real^3>) -> real`) is
  admitted, with the doubles of the existing compiler.
- `Block(s := u; L·s)` with `u` undeclared, which the existing compiler
  declines (an input with no type), is admitted on the profile, and its
  value equals the interpreter's in both modes (`u` = 3, `NaN`, `-1`, `∞`;
  `L` empty, `[0]`, `[-0, 1]`).

**Replay of the census witnesses** (the 141 test files that hold the
witnesses of rows 2 and 11, the census logger, base `fdbbf5091`, after
part A, after all): declines by class, row 2 lists 405 → 10 → 11, row 2
scalars and folds 69 → 19 → 19, row 11 102 → 133 → 11 (the programs that
part A unblocked reached the helper refusal next); declines in all, outside
`js-profile-fuzz.test.ts` (whose programs the generator change alters),
4,287 → 4,064 → 4,048; admitted 2,279 → 2,506 → 2,470 (with the fuzz
file). The ruling class ("Divide of a list and the operand …, which reads
the name … with no declared type") 1 → 3 → 0 compilations.

**Shadow measure** (`CE_JS_PROFILE_SHADOW=1`, the same 141 files): admitted
2,286 of 6,902 (33.1%) → 2,477 of 6,883 (36.0%); "the input … has the type
list<number>" 360 → 71 (the route gives this message now only outside the
`strict` mode).

**The engine's consumers** (`CE_JS_PROFILE=numeric-kernel`, 42 files of
integrals, limits and solvers): 579 of 633 admitted before and after; the
tallies with and without the switch are equal (1,313 passed, 1 skipped).

**Random tester**: the generator adds the inputs `LN: list<number>` and
`VN: vector<3>` and the parameter `NV: list<number>`. Seeds 181 and 182
(10,000 each), 183 (5,000, `--random`) and 184 (5,000, `--host`): no
failure of the profile, no difference of emitted shape, and one difference
from the existing compiler, `First([])` in 2 programs of seed 181 (`NaN` on
the profile, `undefined` on the existing compiler, the type `missing`),
which is older than this change (on `f56cd5f29`, where the profile
declines `First` of an empty list literal, seed 181 shows no difference).
Seed 161 (5,000, `--calculus`) on `f56cd5f29`: no failure, no difference,
no disagreement with the interpreter; `Integrate(x·t, Limits(t, 0, 1))`
and `D(x³, x)` with `x: number` give the code and the doubles of `x: real`.
The profile disagrees with the
interpreter in 17, 15, 3 and 1 programs; in each of them it gives the
doubles of the existing compiler. Most are a discontinuous operator (`Mod`,
`Fract`, `Ceil`) at a point where the precision of a double changes the
result.

## Result of the four extensions: captures, folded nodes, ParallelLoop, unread parameters

Written on `fdbbf509117a374bf1c66cd9d0448403f1873f6d`, where the census,
shadow and switch measures below were taken; moved to
`5d5060724e7de7caaca5192bb56fa7ed5c89143d`, where the tests and the
random tester ran again. Admission in
`javascript-fragment-target.ts` (`numericSnapshot()`, `isCapturedList()`,
`frameValue()`, `closedJumpFold()`, `jumpFoldLiteral()`, the rule of
`Mod`, the unread parameters of `attachBoundFunction()`), the lowering of
a captured list, of a fold and of the form `mod-one` in
`javascript-structured-lower.ts`, `IRInput.unread` and the function
`mod-one` in `structured-ir.ts`, a check of the verifier. Tests:
`compile-javascript-structured-captures.test.ts`. The rows of the existing
code are in `2026-11-09-js-pilot-emission-rewrites.md`, "Captured values,
folded nodes and unread parameters".

**A, captured values.** A name whose value is a list of finite real number
literals of a type in `list<real>` (declared, or the type of the value) is
a constant of the program (`IRConstant`, read by `IRConstantRead`): one
array, declared in the code that the runner evaluates once
(`preambleOnce`), shared by every call and every helper. A read is never
unique (`inPlaceUpdates()`), so no update writes it, and a list value of
the root that is not unique is copied when the program has a constant
(`rootYieldsUnique()`): `L` is `_tv1.slice()`. The verifier checks the
constants (a list of reals or of integers, finite elements of the element
type, one binding each) and each read. `analyzeExecution()` counts a read
as an array of the host (`hostArrays()`); `pure` and `shippable` are
unchanged, because the literal of the constant is part of the code that a
worker loads. The first version made the list once per function at each
call; the review measured it (a list of 10,000 elements: 78,923
characters of code and 2.01 µs per call of `x·At(BL, 7)`), and this
version gives 37 characters of code, the literal once in `preambleOnce`,
0.04 µs per call (the existing compiler 0.17 µs in the same run), and for
`x + Sum(h(j), j = 1..1000)` with `h(j) := j + At(BL, j)` over 2,000
elements 0.73 µs per call (the existing compiler 4.9 µs; the first version
347.7 µs). A name whose binding holds no value and whose value the engine
reads in the frame of a call (`frameValue()`) is a snapshot as a captured
number. Both are in `symbolDeps`, as on the existing compiler. Declined: a
value that is an expression (`ev := x^2 + 1`; the existing compiler hoists
`_val_ev`, and the route would need the rewrite of the angular unit, the
purity and the admission of the stored value), lists of lists, of tuples,
of strings, of complex or of non-finite values, the empty list, a bare
`list` declaration whose value is not a list of reals.

**B, nodes that read no input.** The pass asks for the value of each
function node before its rule (`FragmentDefinition.constantValue`).
`closedJumpFold()` returns the literal that the existing compiler writes:
it calls `closedExactJump()` and `tryConstantFold()` with the state of
the outermost compilation, and reads a number or a boolean back from the
code; any other code declines. A node that names a parameter of the root
function is not asked: the prepared target of the route does not bind the
parameters, and the fold read the engine value of a symbol of the same
name (`Floor(t)` with `t := 1/3` gave 0; found in review). The pass
already skips a node that reads a name that a form binds below the root,
so a helper parameter, a lambda parameter, an index and a local are read
as themselves. The fold runs at the depth 1 of a compilation, as in the
existing compiler, so that the compilations it starts (the literal it
writes, a `Sum` whose body it compiles) do not empty the memos of the
compilation in progress. The four earlier refusals "… reads no
input, parameter or local" of `Floor`, `Mod`, `Sign` and the comparisons
are gone. `Mod(a, 1)` with a dividend that is not integer-valued is
`_SYS.fract(a)`; an integer dividend, by its engine type, by
`isIntegerValued()` or by the type of the pass (`Length(LQ)`, a
`compile-error` before the fix, found by the random tester), declines. Not
done: an `If` or a `Which` whose condition has the type `true` or `false`
(the existing compiler selects the arm; the admission, the pass and the
lowering would each need the selection).

**C, `ParallelLoop` as a sequential loop.** Not done; the decline stays. A
sequential `loop` gives the values, but the existing compiler opens the
frames of the passes (`_SYS.parallelPassesBegin()`), which consume an index
of an enclosing `WithRandomSeed` frame, also one of the interpreter that
calls an implicit compilation, and records the loop for the worker pool
(`parallelLoops`, `parallelCode`, `runAsync()`). Matching it needs a flag
of the IR loop, the emitter form of the frames of the passes and the pool
records: size L, not S.

**D, unread parameters.** A parameter of the root `Function` that the body
never names, of any type, is an input with `IRInput.unread`: in the
signature, with no check and no conversion; the verifier refuses a read of
it. A name of the body, also the parameter of a nested literal, is a read.
A default value or a rest parameter keeps its refusal.

**Census witnesses** (112 test files that reached the four rows, replayed
with the census logger; 6,657 compilations): admitted 3,223 → 3,467,
declined 3,434 → 3,135, failed 0 → 0. Row A 395 → 186 (left: expression
values, function values, strings, nested lists, matrices, tuples, complex
and non-finite values), row B 178 → 38 (left: 34 constant `If`/`Which`
conditions, 4 `e^(ln(−N))`), row C 73 → 73, row D 242 → 12 (left: a
parameter declared `any` that the body reads). The replay ran before the
fix of an integer dividend of `Mod`, which admits fewer programs.

**Shadow measure** (the same 112 files, `CE_JS_PROFILE_SHADOW=1`), before
→ after: public 2,887 → 3,071 admitted (46.5% → 49.9% of the compilations
that the existing compiler compiles), `implicit:integrand` 92 → 115,
`implicit:map-exact` 19 → 51 (all), `implicit:map-predicate` 32 → 36 (all),
`implicit:map` 19 → 20 (all); failed 0 in both. Admitted where the
existing compiler declines (public): 91 → 73. The changed test files of
the change compile 50 fewer programs, so the public totals differ.

**Consumer switch** (81 files of the consumers of the engine,
`CE_JS_PROFILE=numeric-kernel`): 2,952 tests pass with and without the
switch, before and after. Admitted, before → after: `integrand` 374 → 393
of 445, `map-exact` 151 → 183 of 183, `map` 76 → 78 of 89; the other
consumers unchanged; failed 0.

**Random tester.** The generator adds the captured rationals `cr` and
`crn`, the captured list `CL`, jumps of captures and of closed exact
constants, and `Mod(v, 1)`. Seeds 171 and 172 (10,000 programs each) and
173 (5,000, `--random`): no difference of value or of shape with the
existing compiler for inputs in their types. Seed 173 found the
`compile-error` of `Mod(Length(LQ), 1)`; after the fix, 0 failures. The
disagreements with the interpreter are the precision caveat of `Mod` and
`Fract` at a jump, and `Fract(10^30·π)`, where `evaluate()` of the
interpreter loses the fractional part (`2643000000`; `.N()` gives
`0.5028841971693994`, the value of both compilers): a defect of the
interpreter.

## Result of the bindings of the numeric kernel

On `99cee49c8926048d73e590a0274567b9290e8bcc`, the four classes of
`unsupported binding` that section 9 of
`docs/plans/2026-11-12-structured-broadcast-over-lists.md` assigns to the
numeric kernel. Admission in `javascript-fragment-target.ts`
(`storedSnapshot()`, `recordCapture()` with its `checkStored` callback,
`hostNameOf()`, `heldValueCause()`, `unionCause()`, the rank 2 of
`isCapturedList()`, the names of a value in `attachRootBlock()` and
`admitFunctionBody()`, `refuseCapturedListsWithRows()` removed); the
lowering `storedRead()` and the rank 2 of `capturedList()` in
`javascript-structured-lower.ts`; `CaptureSnapshot` and the rows of
`IRConstant` in `structured-ir.ts`, with their checks in
`structured-verify.ts`; `rootCopyLevels()` in `structured-in-place.ts`;
the text of a complex capture and of a constant of rows, and the root copy
of two levels, in `javascript-structured-emit.ts`. Tests:
`compile-javascript-structured-bindings.test.ts`. The rows of the existing
code are in `2026-11-09-js-pilot-emission-rewrites.md`, "Values that are
expressions, captured lists of lists, complex constants and unions at an
input".

**A, a value that is an expression.** The existing compiler binds an
application that is pure through every value it reads once per call, in
the preamble, before the body (`const _val_lv = _.x + 1;`), rewritten for
the angular unit (`foldedValueInRadians()`); it writes a symbol value at
the read, and an impure value at each read. The probes show no other
order: the preamble runs before the body, a value that reads another is
written after it, and the code reads the name at each read. The route
captures such a value (`StructuredCapture.expression`): `recordCapture()`
admits the stored value once, by the admission of the program, in the
root, where its names are the inputs (the indexes of the read cleared; in
a root `Block` the names of the value are free symbols of the block; in a
root `Function` the parameters are not names of the value). The pass types
it in the root scope (`storedValue`, `symbolFacts()` of `fragment.ts`,
which refuses a value whose name a form binds where it is read and a value
that reads its own name), and the lowering computes it once, when it
lowers the first read, with its operations at the start of the root
region, before every operation of the body (`storedRead()`), as the
existing preamble computes it before the body: a function of the host that
changes the inputs object (`h(g(x), lv)` with `g` setting `x`) does not
change it, and the emitter moves no pure value across a call of the host.
The value is pure and reads no host (the admission), and a value whose
operations can throw or abort declines (the lowering). A real expression of
a name declared `complex` (`z := x + 1`) declines: the existing compiler
lifts it to the complex lane (`Sqrt(z)` is `2i` at `x = -5` in the
`strict` mode too); a declaration `number` over a real or an integer
value, and `real` over an integer value, give the same doubles on both
routes in both modes, and are admitted. The name and each name of a
chain are captures, so they are in `symbolDeps`; a new compilation reads a
new value (`assertCurrent()` compares the stored value). Declined, each
with its cause: an impure value, a value read in a helper or a local
function, a value that reads a `vars` entry or a function of the host, a
list value with a function of the host, a value that reads a name that a
parameter, an index or a local binds where it is read (the existing
compiler reads the name of the engine there, or refuses a root parameter),
a cycle, a value whose code can throw (`Mod(k, y)`) or abort. A list value
(`[x, 2y]`) and the lists that are not constants (a list of tuples, a list
of lists of lists, a list with an empty row, a list with an element that
is not finite, `list<number>` with an exact element) are captured
expressions too: the lowering makes a new array per call, where the
existing compiler hoists `_val_` once per artifact; the values are the
same.

**B, a captured list of lists.** A list of rows of finite real number
literals (ragged admitted, as the existing compiler admits it; a declared
`matrix<m×n>` too) is a constant of rank 2 (`IRConstant.elements` holds
the rows; the verifier checks each cell). A read is never unique and never
owns its rows (`inPlaceUpdates()` reads no `constant` as either), so no
update writes the constant or a row of it. The value of the program is
copied to the depth that can hold the constant (`rootCopyLevels()`): a list
of lists that is not unique or does not own its rows is copied with two
levels (`?.map((_r) => _r?.slice())`), another list that is not unique
with one (`?.slice()`, also an absent row), and a function of lists whose
result is new at every depth (`matmul`, `inv`, also its absent value
`NaN`) is not copied. This replaces the refusal of a captured list in a
program with a list of lists (`refuseCapturedListsWithRows()`): `[CL, CL]`,
`ReplaceAt(M, 1, CL)` and a comprehension of `CL` are admitted. A value of
rank 3 or more in a program with a constant declines (`rootCopyLevels()`
gives `'deep'`, `lowerStructuredProgram()`): such a value can hold the
constant or a row of it below the two levels of the copy (`[rows, rows]`,
`[[CL]]`, `List(rows)`, a helper that returns `rows`), and the ownership
rules say nothing below the rows. A loop that
updates a cell of a row of a local made from the constant gets one copy of
two levels before the loop (`withOwnedCopies()`). In the `complex` mode a
list of lists declines, as any.

**C, a complex constant.** A complex number with finite parts and an
imaginary part that is not 0, of a name with no declared type or declared
`complex` or `number`, is a capture of the type `complex` whose snapshot is
its parts (`CaptureSnapshot`); the emitter writes the object at each read
(`({ re: -0.524, im: -0.566 })`), which a complex operation reads as any
complex value, as the existing compiler does, in both modes (not as a
complex literal, whose `0` parts the route drops). A real value of a name
declared `complex` declines: the existing compiler reads `_SYS.cplx(5)`;
so does a real expression of such a name (A).
`analyzeExecution()` counts a complex snapshot as portable.

**D, a union of a number and a list at an input: not done.** The decline
names the union (`unsupported binding u: the input has the union type
list<real> | real, which the profile does not dispatch on`). The existing
compiler puts one dispatch around the whole program and one body per
member (`(Array.isArray(_.u) ? _SYS.bcast(…) : _.u + 1)`). On the route it
needs: an admission, a typing pass and a lowering of the program once per
member of each union input (a product over several such inputs), where the
preparation holds one annotation per program (`recordStructured()`); an
operation of the core that tests the shape of one input once, with one
region per member, which the verifier admits only at a binding of a
declared union (the R4/R5 rule); a result whose type is the union; and,
for the list member of the witnesses (`u + 1`, `2v`, `sin(u) + u·x`),
element-wise arithmetic of a list with scalars on the route, which the
broadcast slice of the same note adds. It is not contained in this change.

**Measures.** The witness set (128 test files of the census, minus
`compile-call-broadcast-result-operand.test.ts`, whose run on the base
spins in a union-input test), replayed with a Jest setup logger on the base
and on the change: 520 distinct compilations declined with `unsupported
binding` or `unsupported helper capture` before; after, A 25 of 58
admitted, B 0 of 24 (each now declines at a later head: `Power` of a
matrix, `Reduce` and `Map` of a list of lists, a list of lists of different
element types, a tensor of rank 3), C 2 of 11 (`Abs` and `Max` of a complex
operand that is not a name, a real value of a name declared `complex`), D 0
of 70 (the union message); 13 of 357 others. All compilations of the set:
1,509 admitted before, 1,548 after, 0 failures. The shadow measure on the
same files (`CE_JS_PROFILE_SHADOW=1`): the profile admits 2,064 of 5,550
compilations that the existing compiler compiles before, 2,103 after;
`unsupported binding` 537 before, 312 after. The consumer switch (45 files,
switch on and off): 1,956 tests pass on both. The fuzz tester
(`--seed 271 --count 10000`, `--seed 272 --count 10000`,
`--seed 273 --count 5000 --random`, `--seed 274 --count 5000 --host`): 0
failures of the profile; 3 differences between the profile and the
existing compiler, all at the base too and of no class of this change (a
local function `Sqrt(k)` read on the complex lane, `EllipticK(10)` in a
matrix product, the last bit of a complex division in a broadcast): defects
of the existing compiler, filed. These measures are of the change before
the review fixes (the decline at rank 3, the values computed at the start
of the root region, the decline of a real expression of a name declared
`complex`); after them, the fuzz runs of seeds 271 and 274 were run again
(below the report of the review fixes).

**The review fixes.** A value of rank 3 or more in a program with a
constant declines (`rootCopyLevels()` gives `'deep'`); a captured
expression is computed at the start of the root region, so a function of
the host that changes the inputs object before the read (`h(g(x), lv)`)
gives the value of the existing compiler (505); a real expression of a name
declared `complex` declines; a bare integrand that the scope of the
integral binds with no value (`\int_0^x k\,dt` with `k := sin(30)` in
degrees) declines with that cause. The fuzz tester after these fixes:
`--seed 271 --count 10000` and `--seed 274 --count 5000 --host`, 0
failures; the same two differences between the profile and the existing
compiler as before (seed 271), none for seed 274.

**The second review.** A value that is a name (`sv := y`) is a read of
that name where the alias is read: the existing compiler binds only an
application before the body (`bindsFoldedValue()`: `isFunction(value)`),
and writes a symbol value at each read, so a function of the host that
changes `y` before the read changes the value (`h(g(x), sv)` is 509 on
both routes). A value of a name is lifted to the complex lane by the
existing compiler's own test (`compileSymbol()` in `compile-inner.ts`:
the name complex-valued, the value a number that is not,
`isComplexValued()`), and the route declines exactly those values
(`liftedByDeclaration()`), not by the engine type of the value: `x / y`
(`real | infinity | nan`), `Sqrt(x)`, `Ln(x)`, `x^y` and
`If(y > 0, x, 1/x)` of a name declared `complex` decline.

The choices of the route for a stored value, each against the test that
the existing compiler makes for the same choice:

| Choice | The existing compiler | The route | Result |
| --- | --- | --- | --- |
| Before the body or at each read | `bindsFoldedValue()`: an application that is not `foldValueImpure()`, outside the lowering of a user function, and not a collection when the options have functions of the host (`foldExcludedOps`) | an application: once, at the start of the root region (`storedRead()`); a name: at each read; a read in a helper: declines; a value that is not a number with a function of the host: declines | the same where admitted; the route declines more (a boolean value with a function of the host) |
| Not bound at all | `foldValueImpure()` | the same function: declines | declines |
| Lift to the complex lane | `isComplexValued(name) && !isComplexValued(value) && value is a number` | the same test (`liftedByDeclaration()`): declines | declines |
| A real literal of a name declared `complex` | the same lift (`_SYS.cplx(5)`) | `numericSnapshot()` admits a literal only for a declared real or `number`: declines | declines; `number` is not lifted on either route |
| A complex literal | folded as the object of its parts (complex-valued: no lift) | a complex capture, the object at each read | the same |
| A name that a `vars` entry maps | not folded (`varsKeys`) | not captured (`varsEntryOf()` first) | the same |
| The angular unit | `foldedValueInRadians()` | the same function | the same |
| Once per artifact (`hoistable`) or once per call | once per artifact when the value reads no per-call binding | once per call | the same doubles: the value is pure |

Not compared: a definition that a checkpoint restore marked `_rewound`
(the existing compiler does not fold it; the route reads the ambient
binding and its value, `storedSnapshot()`).

## Result of the statement and loop forms

On `984f3e66014c1b44c03948ff097781550c6562fd`, the statement and loop
forms that the existing compiler compiles and the profile declined, in five
parts. The existing code of each form is in
`2026-11-09-js-pilot-emission-rewrites.md`, "Statements and loops: several
index sets, comprehensions, destructuring, `Return`, `Continue`, defaults".
Tests: `compile-javascript-structured-statements.test.ts` (a differential
against the existing compiler with `cse: false, constantFold: false` and
the interpreter, the inputs unchanged, the order of host calls, the
iteration budget, and each decline that stays).

**(a) Loops and comprehensions over several index sets.** Admitted:

- a `Loop` over several index sets, nested with the first one outermost
  (`loopStatement()` with a clause number); a later range reads the
  earlier indexes. Each range is tested against 2^32 − 1 elements before
  its first pass (`IRLoop.checksCount`), as `compileCountedRange()` does;
- a `Loop` with no index set: `IRLoop.unbounded`, written `while (true)`.
  The verifier checks that no operation reads its index;
- a `Loop` over a list value or a range with a step (the range is made as
  a list first);
- a `Comprehension` with several generators, filters, a list or a stepped
  range: `nestedBuild()`, one carried list per loop level, a filter as an
  `if`, no budget count (the existing emitter writes none).

Declined: a `Break` in a loop over several index sets (the existing
compiler declines it); a `Loop` clause with a guard; a comprehension whose
filter or source reads a later index; a comprehension whose body, filter
or later source is not pure (the interpreter's comprehension is a lazy
view); a comprehension whose type is not a list (`list | missing` over
`[]`, which the existing compiler reads with `_SYS.atWithValueMarker`).

**(b) Locals.** Admitted: a destructuring declaration
`Declare((a, b), {value: v})` (or the type `unknown`) of a literal tuple
or of the tuple value of a user function, in the `strict` mode
(`checkDestructuring()`, `destructure()`). Each name of a literal tuple
receives the facts of its operand
(`FragmentDefinition.literalTupleComponents`, absent for GLSL). Declined:
a declared type on the pattern; a tuple input (the interpreter rejects
it); the `complex` mode (the check of the writes of that mode reads one
name); `Declare(g, signature)` before `DefineFunction(g, …)` (8 witnesses);
a declaration with no value; the `constant` flag (4 operands); a nested
pattern; locals of the types `any`, `number` in the `complex` mode,
`Numbers`, `color`.

**(c) Statements.** Admitted:

- the destructuring write `(a, b) ≔ v`: every component in order before
  any name is written; the carried names of a loop include each name of
  the pattern (`assignedNames()`, `exposedReads()`);
- `Return(v)` in tail position of a body or of the expression (its value);
- `Continue` at the end of a branch of an `If` that is a statement of the
  loop body: the statements after the `If` are lowered in the other branch
  (`statements()` with the body flag, `ifStatement()` with `rest`).

Declined:

- a `Return` before the end of a body: the IR has no exit from a function,
  4 witnesses;
- a `Continue` in a nested `If` or block;
- a write to a parameter (20 witnesses after, with the reserved names
  `_SYS` and `Math`): the root `Function` reads its parameters as inputs;
- `ParallelLoop`, which stays declined (19).

**(d) Optional and default parameters.** A helper with a parameter with a
default value is admitted: the engine completes each call when it boxes
it, and the existing compiler passes every argument (`_fn_hd(_.x, 2)`). A
call with fewer arguments declines. Declined: a default on a parameter of
the root `Function` (11 witnesses). The existing compiler writes
`(x, k) => { if (k === undefined) k = 2; … }` through
`lambdaDefaultFill()`, which compiles the default with the target of the
root `Function`. The fragment route reserves that target for the body
(`assertEmitter()` in `javascript-fragment-facts.ts`, outside the files of
this task). A default on a parameter of a local function is declined too
(5 witnesses).

**(e) Helper captures: not done, declined (62 witnesses).** A helper that
reads an input of the program (`g1(t) := t + y`, `const _fn_g1 = (t) =>
t + _.y;`) or a value that is an expression (`c := 3x + 1`) needs a new
mechanism. The IR body of a helper reads only its parameters (the emitter
fails "the body of a helper reads an input"), so each such input would be
an extra parameter. It would be passed at each call, also through each
helper that calls the helper, and it would need its own typing in the pass.
That is a design of its own, larger than the other four parts together.

**Measures.**

- Witnesses (94 files, a logger of the profile's declines): admitted
  2,282 → 2,400, declines 2,218 → 2,071.
- By the census classes:

  | Class | Before | After |
  | --- | --- | --- |
  | `loop-several` | 53 | 0 |
  | `compr-several` | 17 | 0 |
  | `compr-over` | 35 | 5 (strings, a set, a tuple pattern) |
  | `loop-form` | 102 | 14 (tuple patterns of an index, a guard) |
  | `local-explicit` | 57 | 28 |
  | `stmt` | 87 | 56 (`ParallelLoop` 19, `Match` 9, `Nothing` 8) |
  | `helper-optional` | 56 | 17 (root and local defaults) |
  | `return` | 13 | 5 |
  | `helper-capture` | 59 | 62 (part (e), a few programs moved from other declines) |

  The 55 `ParallelDomain` loops of `loop-form` now decline with that head.
- Shadow measure on the same files: admitted 2,273 of 4,484 (50.7%) →
  2,391 of 4,455 (53.7%), 0 failures. Both runs stop at the 900 s timeout
  after every file has written its stats, so the baselines differ by 29
  compilations.
- Tycho prelude census (fish-swarm and turing-patterns left out): 29 of 40
  before and after. The causes of `apollonian-gasket`'s `fourth` and
  `fill` moved to the next decline: a loop over a tuple pattern
  `Element((zx, zy), …)`.

The random tester adds loops over two index sets, loops with no index
set, `Continue`, comprehensions with two generators and a filter or over
a list, destructuring declarations and writes, and the helpers `fdf` and
`fdu` (defaults) and `fcw` (a `Continue` and a destructuring write). Most
statement forms appear only at `--size 100`. The two value differences of
seeds 284 and 285 are older than this change and outside its forms
(the gather `At(At(M2, k), Range(1, 3))`, which now declines, and the
known-limitations line of a branch that the existing compiler selects
without the lift of a name with no declared type).

The engine's consumers (`CE_JS_PROFILE=numeric-kernel`, 45 files of
integrals, limits, fits and `Map`), with the switch off and on: 1,029
tests pass both times; 0 failures of the profile. Random tester on the final
code: seeds 281 and 282 (10,000 each), 283 (5,000, `--random`), 284
(5,000, `--host`), 285 (5,000, `--size 100`). There are no failures of the
profile and no differences in emitted shape. There are two differences from
the existing compiler, the two older lines above. One difference in an
earlier run of seed 282 came from this change: `At(Comprehension(3, j ∈ []
if x = −1), 1)`, which gave `NaN` where the existing compiler gives
`undefined`. It now declines.

**After review.** Four corrections:

1. A loop with no index set may not terminate. `operationCanAbort()` gives
   it the abort fact, so the region that holds it is `canAbort` and the
   dead-statement removal of `ifStatement()` keeps it. The verifier checks
   the fact as it checks the other abort facts. `analyzeExecution()` judges
   such a loop no candidate ("the loop has no index set: it runs until an
   exit, and may not terminate"). An unused bounded loop with a pure body
   is still removed: it ends, and time is not an effect (the existing
   compiler keeps its code).
2. In a loop over several index sets, a local that the body writes and
   that the source of a later index set reads is carried by each
   enclosing loop. With `limit := 2`, the body `s := s + j; limit := 1`
   over `i ∈ 1..2, j ∈ 1..limit` gives 4, as the existing compiler does.
   Comprehensions have pure bodies, so no local changes there.
3. `IRLoop.checksCount` is set where `compileCountedRange()` writes its
   test (`testsRangeCount()`): every `Range` clause of a `Loop` or a
   `Comprehension` whose bounds are not number literals, or whose literal
   count is above 2^32 − 1, except the single ascending range of literal
   bounds of a `Loop` (the counted `for`). The known-limitations line of the
   single loop is removed. Four pinned strings change, and one test now
   expects the `If` to be kept because the count test can throw. No value
   changes. `Sum` and `Product` write no such test on either compiler (a
   safe-integer guard), and the single-generator comprehension build
   already had it.
4. The emitter fails on `checksCount` with no last index, and the verifier
   rejects `checksCount` on an index that is not a `number`. The `bigint`
   mode declines blocks of statements on both compilers, so no such loop is
   lowered there.

The gather of a row read (`At(At(M2, k), Range(1, 3))`, `At(First(R), L)`)
now declines: the existing compiler reads `undefined` for a gather of an
absent row. A real index of a row read gives `NaN` on both and stays
admitted. Its known-limitations line is removed.

**On `eca1a53ca353095480b9270c3039666fdd3102fc`** (the broadcast change and the linear admission):

- The throw table `OPERATION_THROWS` has `loop: 'count'`, and
  `throwsItself()` answers `checksCount` for a loop. A loop that tests its
  count throws a `RangeError` above 2^32 − 1 passes. A loop with no end is
  an abort (`operationCanAbort()`), not a throw. The new operations have no
  other kinds.
- A comprehension with several generators, a filter, a list source or a
  stepped range has no length key: `comprehensionParts()` reads only one
  range generator.
- As an arm of an element-wise selection, a comprehension with two
  generators declines: it can throw. As the arm of a scalar `Which` and as
  a `Sum` term, it compiles with the values of the existing compiler.
- The new walks visit each node once: `breaksLoop()`, `isTailOf()`, and
  the reads of a later index in `comprehensionClauses()` (`symbolsOnce()`).
- A shared tower of depth 40 in a comprehension with two generators
  compiles in milliseconds; it is a row of the depth-40 table of
  `compile-javascript-structured-shared-depth.test.ts`. In the body of a
  `Loop` the cost is in the engine: `loopBodyYieldsValue()`, the type of
  the `Loop`, walks the body once per path. It costs about 10 s at depth 28,
  for one index set as for two. That shape is left out of the table, as
  its header says, and the test of the two-index loop is skipped
  (CE-1240).
- The memo of `checkValue()` (`valueContext()`: names, locals, loop
  indexes, `bodyValue`) holds the context that the new checks of a value
  read. The indexes of a loop over several index sets are in `indices` and
  `names`, and the place of a `Return` is a fact of the node (`tails`).
  `Continue`, `Break` and the destructuring names are checked by
  `checkStructuredStatement()`, which is not memoised.
- The place of a `Return` is not a fact of its node: one node object can
  be in tail position on one path and an operand on another
  (`If(0 < x, r, r + 1)` with one `r`). The admission refuses a `Return`
  that some path reaches out of tail position (`nonTailReturns()`, each
  node at most once in each of the two places). A node that holds a
  `Return` is checked at each path, as a statement block is
  (`holdsStatementBlock()`).
