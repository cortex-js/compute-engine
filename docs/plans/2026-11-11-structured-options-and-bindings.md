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
