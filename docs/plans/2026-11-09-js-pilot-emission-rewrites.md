# JavaScript pilot: what emission decides or rewrites

**Status: read from the source 2026-11-09 at `a81590bce`. Documentation only.
The decisions in the tables are proposed; none is approved.**

This is the first deliverable of step 1 of the
[JavaScript compiler plan](2026-11-09-js-compiler-status-and-plan.md). An
annotation that is built before emission describes the prepared tree. The
existing JavaScript emitter does not always emit that tree: it replaces some
nodes, drops some operands and chooses some branches while it writes code.
This document lists each such place for the pilot vocabulary and proposes
what the fragment route does there.

The pilot vocabulary is the one of step 2 of the plan: literals, typed scalar
inputs, `Add`, `Negate`, `Multiply`, `Less`, `Equal`, `And`, `Or`, `Min`,
`Max`, `If`, the real-to-complex conversion, one local with one assignment
and a call of one resolved helper.

## The fixture after boxing

The engine puts an expression in canonical form when it boxes it, before any
compilation. The fixture of step 2 was boxed with `c`, `r` declared `integer`
and the other symbols declared `real`:

| Source | Canonical form |
| --- | --- |
| `obstacle > 0.5 && c == 16 && (r < 13 \|\| r > 18)` | `And(Less(0.5, o), Equal(c, 16), Or(Less(r, 13), Less(18, r)))` |
| `min(0.25, max(0, d))` | `Min(0.25, Max(0, d))`, of the type `real<0..0.25>` |
| `v + a*(s - 4*v)` | `Add(Multiply(a, Add(s, Multiply(-4, v))), v)` |

Three consequences for the pilot:

- `Greater` does not occur: the canonical form writes it as `Less` with the
  operands exchanged. The vocabulary has `Less` and no `Greater`.
- `Subtract` does not occur, and the fixture has no `Negate`: `s - 4*v` is
  `Add(s, Multiply(-4, v))`. `Negate` stays in the vocabulary for the complex
  fixture of the pilot design.
- The canonical form puts the operands of `Add` in its own order
  (`Add(Multiply(…), v)` for `v + a*(…)`). The lowering follows the prepared
  tree and never the source text.

## Before the annotation

`JavaScriptTarget.prepareCompilation()` (`javascript-target.ts`) runs four
rewrites before any emission: `lowerParallelHeads()`, `rewriteAngularUnit()`,
`rewritePartialApplications()` and `unrollFixedWidthCollections()`. Their
result is the prepared root. Step 1 builds the annotation from that root at
the end of `prepareCompilation()`, so these rewrites need no decision. None
of them changes a node of the fixture: it has no parallel loop, no
trigonometric function, no partial application and no collection.

## During emission

`compileExpression()` (`compiler-core.ts`) calls `compileRewrittenForm()` for
each function node, then `compileWithCse()`, then `foldEmitted()`. The
handlers of the operators decide more.

### Places that the pilot vocabulary reaches

| Place | What the existing emitter does | Proposed decision for the fragment route |
| --- | --- | --- |
| `tryConstantFold()` (`compile-folding.ts`), with `constantFold` on | Evaluates a subtree with no free symbol and writes a literal. | The pilot refuses a compilation whose `constantFold` option is not `false` (pilot design, "First vocabulary"). |
| A comparison with no free symbol, with `constantFold: false` | Is still written as a literal: `Less(1/3, 1/2)` and `Less(1, 2)` both compile to `true` (run with `cse: false, constantFold: false`). For exact numbers that are not both safe integers, `closedExactJump()` (`compile-folding.ts`) makes `tryConstantFold()` fold under the opt-out, because the comparison of the two doubles can differ from the comparison of the exact values. The code that folds `Less(1, 2)` was not identified. | Admission declines a `Less` or `Equal` node that has no free symbol. The rule does not depend on which code folds. The fixture has no such node, and a program with one is constant. |
| `compileWithCse()` (`compiler-core.ts`) | Binds a repeated subexpression to a temporary. | The pilot refuses a compilation whose `cse` option is not `false`. |
| `foldEmitted()` (`compile-cse.ts`) and the two folds of emitted literals in `compileExprOperator()` (`foldEmittedIdentityOperands`, `foldLeadingNumericRun`, `compile-operators.ts`) | Fold arithmetic of literals in the emitted text, and drop a factor `1` or `-1`. All three are off when `constantFold` is `false`. | Not reached, by the refusal of the first row. |
| The real cases of the `Add`, `Multiply` and `Negate` handlers (`javascript-target.ts`), through `tryGetConstant()` | Add the literal operands at compile time, drop an operand that is the literal `0` (`Add`) or `1` (`Multiply`), and write `0` for a product that has a literal `0` factor, without compiling the other factors. These run whatever the value of `constantFold`, but only when the infix code of `compileExprOperator()` did not write the node: `Multiply(0, x)` with `x` real compiles to `0 * _.x` (run), not to `0`. | The new emitter writes every operand, in order, as the infix code does. The canonical form removes `x + 0` and `1·x`; it keeps `0·x` (run). The differential test of step 3 has a case `0·x` with `x` infinite, where the interpreter gives `NaN`: an emitter that drops the factor would give `0`. |
| `If` in `compile-conditionals.ts`: `booleanClaim()` | When the type of the condition is the value `true` or `false` and the condition is pure, writes one branch only, with no test: `If(Equal(k, k), x, y)` with `k` integer compiles to `_.x` (run). | Admission declines an `If` whose condition has such a type. Today the fragment route reaches an invariant error ("missing operand conversion") for it; a refusal at admission replaces that error. |
| `If`: `guardCondition()` (`compile-conditions.ts`) | Wraps the condition in `_SYS.cond(…)` when it is not provably boolean. | Admission requires a condition of the type `boolean`. The lowering needs no guard. |
| `If`: `target.selection` | Selects element by element when the condition can be a collection. | Not reached: the vocabulary has scalars only, and admission requires a `boolean` condition. |
| `Less` with three operands or more (`compileExprOperator()`) | Writes a conjunction of pairs and binds each middle operand to a temporary. | The vocabulary admits `Less` and `Equal` with two operands. More operands decline. |
| `Equal` (`compileJSEquality()`) | For two numbers, writes the exact comparison `===`, not the comparison with a tolerance of the interpreter. For complex operands, compares each component. | The lowering writes `===` for two operands of the representation `number`. `Equal` with a complex operand declines in the pilot. This is a rule of the lowering, not a rewrite. |
| `And`, `Or` (infix `&&`, `\|\|`) | JavaScript does not evaluate the second operand when the first one decides. | The representation makes this explicit: each operand after the first is a region that is evaluated only when the earlier operands do not decide, as a branch of `If` is. An operand written as a plain value in an ordered block would be evaluated always, which changes the count of evaluations of an effectful operand. |
| `Min`, `Max` (`compileExtremum()`) | For scalar operands, writes `Math.min(a, b)` or `Math.max(a, b)`. The other cases are for collections. | The lowering writes the same call for operands of the representation `number`. |
| Call of a user function: `tryInlineUserFunctionCall()` (`compile-user-calls.ts`) and the variants by argument shape (`ensureUserFunctionVariantEmitted()`) | Replaces some calls by the body of the function, and writes one function per shape of the arguments. | The new emitter writes one JavaScript function for the resolved helper and one call. Each argument is evaluated once, in order, before the call. It does not inline and has no variants: each parameter has one scalar representation. |
| A local with one assignment: `compileBlock()` (`compile-blocks.ts`) and the `Declare` handler (`compile-expr-handlers.ts`) | Does not substitute the value at the use. The `Declare` statement is written `let a = <initializer>` at its place in the block, so the initializer is evaluated once, before the statements that follow, and each read of the local is the name `a` (run with `cse: false, constantFold: false`: `Block(Declare(a, real, Max(0, d)), a·v + a)` compiles to `let a = Math.max(0, d); return a * v + a`). A block of one statement with no local is unwrapped and has no `let`. | The lowering (`javascript-structured-lower.ts`) lowers the initializer at the place of the `Declare`, in the region of the block, and each read of the local is that value, with no operation. This is the order of the existing emitter. The structured route refuses a local that a later statement writes, because the value of its initializer is then not the value at each read. |

| `Sqrt` (`javascript-target.ts`), with `isComplexValued()` and `promotesToComplexLane()` | Writes `_SYS.csqrt(z)` for a complex operand. For a real operand: with a literal operand, writes the root as a literal also with `constantFold: false` (`tryGetConstant()`: `Sqrt(2)` is `1.4142135623730951`, `Sqrt(-2)` the complex literal of `complexSqrtLiteral()`); otherwise `_SYS.csqrt(({ re: x, im: 0 }))` when the operand is negative (`isNegative` and a non-real type) or, in the `complex` mode, not proved non-negative (`assumedRealNonNegative()`), and `Math.sqrt(x)` in the other cases. | The rule of the structured route (`structuredSqrtRule()`, `javascript-fragment-target.ts`) decides real or complex from the fact of the operand, the mode and the sign of the operand (`signOf()`: a literal, a snapshot, the declared type of a name, and `Add`, `Multiply`, `Min`, `Max` and `Sqrt` of non-negative operands), with the rules of `assumedRealNonNegative()` for these operators. It declines when the engine knows a sign that these facts do not give (`Sqrt(-n)` with `n: real<..-1>` in the `complex` mode). The lowering converts a real operand of a complex root (`real-to-complex`), and the emitter writes `Math.sqrt` or `_SYS.csqrt`. A literal operand is not folded: `Math.sqrt(2)` gives the same number as the literal, and `_SYS.csqrt` of `-2` the value of the interpreter (the differential test of step 5). |

The rows below are the scalar numeric functions that the prelude census of
the [plan](2026-11-09-js-compiler-status-and-plan.md) ("Prelude census
(2026-11-10)") needs, read from the source at `a289574ce` (2026-11-10). The
emitted code of each case was checked with `cse: false, constantFold: false`
in both modes. "Same code": the structured route writes the call that the
existing emitter writes. "Same value": other code, the same number.
"Decline": the structured route refuses the program, with a message.

| Place | What the existing emitter does | Proposed decision for the fragment route |
| --- | --- | --- |
| `Exp` (`Power(ExponentialE, x)`, the canonical form; the `Power` handler) | A real exponent that is not a number literal: `Math.exp(x)`, in both modes (`isComplexValued()` is false: the type is `real<0<..>`, no promotion for an exponent that is not a number literal). A number literal exponent: the code of that exponent (`(Math.E * Math.E)` for 2, `Math.sqrt(Math.E)` for 0.5). An exponent that reads only constants and assigned symbols, with a value that is not an integer: replaced by its value (`knownExponentPower()`), then as a literal. A complex exponent: `_SYS.cexp(z)`, or `_SYS.cexppi(u)` for `a + iπu` (`eulerPiSplit()`). | Real exponent that reads an input, a parameter or a local: same code (`exp`). Number literal exponent, an exponent that reads no input, parameter or local (wider than `knownExponentPower()`), a real exponent whose node type is not real: decline. Complex exponent that is a name: same code (`_SYS.cexp`); any other complex exponent: decline. `±Infinity`, `NaN`, 0, large: `Math.exp` on both routes. |
| `Sin`, `Cos` | A real operand: `Math.sin(x)`, `Math.cos(x)`; an operand `π·u` (`piMultiple()`): `_SYS.sinpi(u)`, `_SYS.cospi(u)` (exact at the multiples of π). A complex operand: `_SYS.csin(z)`, `_SYS.ccos(z)` in the `strict` mode, wrapped in `_SYS.cplx()` in the `complex` mode (the node type is `number`). | Real operand that does not read `Pi`: same code. Operand that reads `Pi` (wider than `piMultiple()`): decline. Complex operand that is a name, `strict` mode: same code. Any other complex operand, and every complex operand in the `complex` mode: decline. |
| `Tanh` | A real operand: `Math.tanh(x)`, also for a closed operand (`Math.tanh(2.6666666666666665)` for `tanh(8/3)`). A complex operand: `_SYS.ctanhipi(u)` for `i·π·u` (`imaginaryPiMultiple()`), else `_SYS.ctanh(z)`, wrapped in `_SYS.cplx()` in the `complex` mode. | Real operand: same code. Complex operand: as `Sin`. |
| `Abs` | A complex operand: `Math.hypot(re, im)` when the operand is a sum of a real and an imaginary part (`tryGetJSComplexParts()`), else `_SYS.cabs(z)`. A real operand that the engine proves non-negative: the operand itself (`identityPassthrough()`). An operand whose type admits a string or a set: `_SYS.absAny(x)`. Otherwise `Math.abs(x)`; an integer operand gives an integer. | Real operand that the existing predicate (`isNonNegative()`: a literal at least 0, or `isNonNegative` true) proves non-negative: the operand itself (the recorded form `abs-identity`), so `-0` stays `-0`, as on the existing route. Other real operand: `Math.abs(x)`, same code. The type of an integer operand is the integer fact: a loop bound can read it. Complex operand that is a name: same code (`_SYS.cabs`), real result. Any other complex operand: decline. A string or set type does not reach the route (no fact for it). |
| `Arctan2` | `Math.atan2(y, x)` (a name mapping), for real and integer operands. | Real operands: same code. A complex operand: decline. |
| `Ln` (`javascript-target.ts`), with `isComplexValued()` and `promotesToComplexLane()` | The `Sqrt` rule (`Sqrt`, `Ln`, `Log` share one branch of `isComplexValued()` and `promotesRadicalToComplex()`): a complex operand `_SYS.cln(z)`; a real operand `_SYS.cln(({ re: x, im: 0 }))` when it is provably negative and the node type is not real, or, in the `complex` mode, not proved non-negative (`assumedRealNonNegative()`); `Math.log(x)` otherwise (`NaN` for a negative `x`, `-Infinity` for 0). A literal operand is not folded (`Math.log(2)`). | `structuredRadicalRule('Ln', …)`, the rule of `Sqrt`: the sign from `signOf()`, the guard that declines when the engine knows a sign that the rule does not find, and, in the `strict` mode, a decline when the operand is negative and the node type is real. Same code for each case it admits. `signOf()` now also has the rules of `assumedRealNonNegative()` for `Divide`, `Abs`, `Power` with an even integer literal exponent, `Min` and `Max` of real-typed operands only, and a function node of a non-real type, so `Sqrt` reads them too. |
| `Power(b, 1.5)` and `Power(b, 3/2)` (`realRadicalPower()`) | A base that `assumedRealNonNegative()` proves non-negative: `(b * Math.sqrt(b))` for a name or a literal, `_SYS.pow3h(b)` (`b * Math.sqrt(b)`) for another base. Another real base: `Math.pow(b, 1.5)` in the `strict` mode, `_SYS.cpow` in the `complex` mode. | A real base that `signOf()` proves non-negative, and a node type that is real: the product of the base and its square root, the base evaluated once (same value). A real number literal base: decline, because the handler folds two finite literals to `Math.pow(b, e)` before every other rule (`10^1.5` folds to `31.622776601683793`, the product gives `31.622776601683796`); the same decline for the exponent 2 (`1.1^2`). Another base, a complex base: decline. |
| `knownExponentPower()` (`compile-real-analysis.ts`) | Replaces an exponent that reads only constants and assigned symbols, with a value that is not an integer, by that value, before the `Power` handler and `isComplexValued()`. | Not reached for the forms of the route: the exponents 2 and 1.5 are literals, and an exponential whose exponent reads no input, parameter or local is declined (above). |

A cross-check of the branches of the existing emitter (2026-11-10) found
four more places where the structured route wrote other code; each is now a
row of the route:

| Place | What the existing emitter does | Decision for the fragment route |
| --- | --- | --- |
| The complex branch of `Add` | The real parts of every operand, then the imaginary parts of the complex operands only, in the order of the operands; a complex literal gives its two parts as constants; a term that is the constant `0` is dropped: `z + 1` is `{ re: z.re + 1, im: z.im }`, `x + i` is `{ re: x, im: 1 }`. A real operand is written as it is, with no parentheses. | The same text: a real operand of a complex `add` is not converted (`structuredAddRule`), and the emitter writes the parts as above, so a `-0` part stays `-0`. A real operand whose text is a sum or a conditional fails the emission (the existing emitter groups it otherwise). `Multiply` with a complex result has two complex operands only (unchanged); `Negate` of a real operand is real, and its parent converts it, as on the existing route. |
| A node whose type is the value `true` or `false` (`booleanClaim()`, `compileExprBooleanClaim()`) | Writes the literal before any handler, for a pure node of a head that is not control flow. | Every function node of such a type is refused (`refuseBooleanClaim()`): `LessEqual(0, p·q·r)` with `p`, `q`, `r` of the type `real<0..>`. |
| `closedExactJump()` (`compile-folding.ts`) | Folds a node of `JUMP_FUNCTIONS` with no unknowns (every symbol a constant or a captured binding) with its exact value, also with `constantFold: false`. | A `Less`, `LessEqual`, `Equal`, `Mod`, `Floor`, `Sign`, `Ceil` or `Round` with no unknowns is refused (`closedJumpRefusal()`); the other heads of the route are not in `JUMP_FUNCTIONS` (`Min`, `Max`, `Abs` are not). |
| `Mod` | `((a) % (b))` when both operands are non-negative integers and the divisor is the literal 1, or both are literals or of types in `integer<0..2^53 - 1>`; `((a - Math.floor(a)) % 1)` or `_SYS.fract(a)` for another operand with the divisor 1; `_SYS.floorMod(a, b)` otherwise. | `_SYS.floorMod` for the third case; the first two are refused. The `Mod` nodes of the heat and traffic preludes have an unbounded `integer` dividend and stay in the third case. |

The two other forms of `Power` that the census needs are admitted since
2026-11-10: `ln(…)^1.6` (`julia-set`) and `s^(d/2)` (`multibrot`). The
branches of the `Power` handler of the existing emitter
(`javascript-target.ts`), in its order, and what the route does:

| Branch of the existing handler | Emission | Structured route |
| --- | --- | --- |
| Before the handler, `knownExponentPower()`: an exponent that reads an assigned symbol, with a value that is not an integer | the exponent replaced by its value | Declined, and wider: every exponent with no unknown. |
| A complex base, an integer literal exponent 2 to 8 | a chain of squares and products | 2 admitted (`square`); 3 to 8 declined, and every other number literal exponent of a complex base. |
| A complex exponent, the base `ExponentialE` | `_SYS.cexppi`, `_SYS.cexp` | An exponent that is a name: admitted (`exp`); others declined. |
| Another complex base or exponent | `_SYS.cpow` | Declined. |
| Two finite literals | folded | Declined. |
| `realPowerExponent()`: the value `2/3` | `_SYS.pow2(Math.cbrt(b))` | Declined. |
| A float literal exponent, not an integer; a base not proved non-negative; recovered `p/q` with `q` odd, `p` even | `Math.pow(Math.abs(v), e)` | Admitted: `abs-pow` (`J`). |
| The same with `p` odd | `(v < 0 ? -Math.pow(…) : Math.pow(…))` | Admitted: `signed-pow`. |
| An exact rational exponent with an odd denominator (`8/5`) | as the two rows above | Declined; also an exact exponent whose terms are not safe integers. |
| A node on the complex lane (`resultIsComplexValued()`, `promotesToComplexLane()`, `resultIsWideUnderComplexDiscipline()`) | `_SYS.cpow` | Declined: in the `complex` mode `x^y` has the type `number`, so `M` declines there. For a number literal exponent the route declines a type, without its infinities and `NaN`, that is one of numbers that are not real in the `strict` mode and that is not real in the `complex` mode, and, in the `complex` mode, every exponent that is not an integer with a base that `signOf()` does not prove non-negative (`promotesRadicalToComplex()`): `x^1.1` with `x: real`. |
| `realRadicalPower()`: 1.5 with a base proved non-negative; 2.5; a `Sqrt` base under an integer exponent of at least 2 | `(b * Math.sqrt(b))`, `_SYS.pow3h`, `_SYS.pow5h`, the radicand power | 1.5 admitted (`three-halves`); the others declined. |
| The exponent 2 | `(b * b)`, `_SYS.pow2` | Admitted (`square`). |
| The base `ExponentialE`, a real exponent | `Math.exp(e)` | Admitted (`exp`). |
| An integer exponent 0, 1, −1 | `1`, the base, `(1 / (b))` | Declined (their canonical forms are not a power). |
| An integer exponent 3 to 5 | `_SYS.pow3(b)`, `_SYS.pow4(b)`, `_SYS.pow5(b)` | Admitted (`product-power`): the products of the helpers in their order, `(b·b)·b`, `s·s` and `(s·s)·b` with `s = b·b`, the base evaluated once; an integer base gives an integer. |
| The exponent −2, a base that is a name or a literal | `(1 / b / b)` | Admitted (`reciprocal-square`): two divisions, the base evaluated once. Another base takes the last row. |
| 0.5; −0.5; 1/3 (the float, with a base that the engine proves non-negative) | `Math.sqrt`, `(1 / Math.sqrt(b))`, `Math.cbrt` | Declined. |
| An exponent that is not a finite literal, both operands real, not on the complex lane | `_SYS.pow(b, e)` | Admitted: `pow` (`M`), when the exponent has an unknown. |
| Another constant exponent | `Math.pow(b, e)` | Admitted (`real-pow`) for a number literal exponent: an integer that is a safe integer (`x^-3`, `x^10`, `(x + 1)^-2`); a float with an even or no recovered denominator in the `strict` mode (`x^1.1`, `x^-0.95`, `x^1.5` for an `x` of unknown sign); an exact exponent with an even denominator (`x^(5/2)`); a float for a base that the engine proves non-negative (`p^1.6`, also in the `complex` mode). An integer beyond the safe integers and a non-finite exponent (`_SYS.pow(b, Infinity)`) are declined. |

The `Root` handler of the existing emitter, for a real radicand and a real
degree, in its order:

| Branch of the existing handler | Emission | Structured route |
| --- | --- | --- |
| Two finite literals | folded | Declined. |
| A complex radicand or degree | `_SYS.croot` | Declined. |
| A node on the complex lane (`resultIsComplexValued()`, `promotesRadicalToComplex()`: an even integer degree of a radicand not proved non-negative in the `complex` mode) | `_SYS.cpow` | Declined, and wider: a type that is not real in the `complex` mode (`Root(x, k)` has the type `number`, and the handler writes `_SYS.cplx(_SYS.root(x, k))` there). |
| The degree 2 | `Math.sqrt(x)` | Declined (the canonical form is `Sqrt`). |
| The degree 3 | `Math.cbrt(x)` | Admitted (`cbrt`). |
| An odd integer degree; a degree read as a rational with an odd denominator; another literal degree | `(Math.sign(x) * Math.pow(Math.abs(x), 1/n))`, `Math.pow(Math.abs(x), 1/n)`, `Math.pow(x, 1/n)` | Declined. |
| A degree that is not a literal | `_SYS.root(x, n)` | Admitted (`root`), when the degree has an unknown. |

In the `complex` mode the route admits a loop that sums `x^1.4` into a local
of a function with the result type `real`; the existing compiler throws for
it (its analysis puts the local on the complex lane), so that program has no
existing code to compare with. Its values are the interpreter's.

### Places that the pilot vocabulary does not reach

| Place | Why it is not reached |
| --- | --- |
| `jumpShiftRewrite()` (`compile-folding.ts`) | It applies to a rounding function. The vocabulary has none. |
| `MatchesType` in `compileRewrittenForm()` | Not in the vocabulary. |
| The rewrite of a `Multiply` as a division in `compileExprOperator()` | It needs a factor that is a `Power`. |
| The bigint emitter (`emitBigintLane()`) | The fragment target refuses the `bigint` mode. |

Each of these becomes a row of the first table when its operator enters the
vocabulary (`Sqrt`, `Power` and the functions of the census have their rows
above).

### The functions that the engine's own compilations need

The rows below are the functions of one operand, and `Log`, that the
compilations of the engine reach (the limit probes, the fits, stochastic
equality, the scan of periodic roots), read from the handlers of
`javascript-target.ts` at `04c9bd783` (2026-11-10). The code of each case
was checked with `cse: false, constantFold: false` in both modes, and the
tests are `test/compute-engine/compile-javascript-structured-functions2.test.ts`.
For every head, a literal operand is not folded (`_SYS.erf(2.5)`), an
integer operand takes the real call (`_SYS.gamma(k)`), and a list operand
and a boolean operand are declined. The lane of a real operand is the
answer of `isComplexValued()` for the node, which the route reads from the
type of the node (`ScalarFunctionLane` in `javascript-fragment-target.ts`).

| Place | What the existing emitter does | Decision for the fragment route |
| --- | --- | --- |
| `Tan`, `Cot`, `Sec`, `Csc`, `Sinh`, `Cosh`, `Arctan`, `Arsinh` | A complex operand: `_SYS.ctan(z)`, `_SYS.ccot(z)`, `_SYS.csec(z)`, `_SYS.ccsc(z)`, `_SYS.csinh(z)` (`_SYS.csinhipi(u)` for `i·π·u`), `_SYS.ccosh(z)` (`_SYS.ccoshipi(u)`), `_SYS.catan(z)`, `_SYS.casinh(z)`, wrapped in `_SYS.cplx()` in the `complex` mode. `Tan` of `π·u` (`piMultiple()`): `_SYS.tanpi(u)`. Otherwise `_SYS.tan(x)`, `_SYS.cot(x)`, `_SYS.sec(x)`, `_SYS.csc(x)`, `Math.sinh(x)`, `Math.cosh(x)`, `Math.atan(x)`, `Math.asinh(x)`. The type of `Cot(x)` and `Csc(x)` with `x: real` is `number`: the node is complex in the `complex` mode, and the compiler wraps the real call in `_SYS.cplx()`. | A real operand, a node whose type without its infinities is real, or wide in the `strict` mode: the same call. A wide type in the `complex` mode, a type of numbers that are not real: declined. A complex operand that is a name, `strict` mode: the same helper. Every other complex operand: declined. `Tan` of `π·u`: as `Sin` below. |
| `Sin`, `Cos`, `Tan` of an operand that reads `Pi` | `piMultiple()`: `Pi` alone is `π·1`; `Multiply` with the factor `Pi` and other factors that do not read `Pi` is `π·u`, `u` the other factor or a new product of the others; `Negate(π·u)` and `Divide(π·u, d)` are `π·(-u)` and `π·(u/d)`, new nodes. For these `_SYS.sinpi(u)`, `_SYS.cospi(u)`, `_SYS.tanpi(u)`. Any other operand (`asin(a) + π`) is `Math.sin(x)`. | `Multiply(Pi, u)` with two operands, `Pi` of the library and a real or integer `u` that does not read `Pi` (`piMultipleFactor()`): the same call of the same `u` (the form `pi-multiple`). Another `Multiply`, `Negate`, `Divide` and the symbol `Pi` (`readsAsPiMultiple()`): declined. Any other operand that reads `Pi`: the real call, as the existing emitter writes it. |
| `Arcsin`, `Arccos`, `Arcosh`, `Artanh` | A complex operand: `_SYS.casin(z)` and the others. A real operand whose node type without its infinities is one of numbers that are not real (`resultIsComplexValued()`): `_SYS.casin(({ re: x, im: 0 }))`, in both modes. The type of `Arcsin(x)` is `complex` for `x: real` and `number` for a name with no declared type, so the same program is `_SYS.casin(({ re: x, im: 0 }))` with the declaration and `Math.asin(x)` without it; for `s: real<-1..1>` the type is real and the code `Math.asin(s)`. In the `complex` mode a wide node is wrapped in `_SYS.cplx()`. Otherwise `Math.asin(x)`, `Math.acos(x)`, `Math.acosh(x)`, `Math.atanh(x)`. | The route reads the same type: a type of numbers that are not real gives the complex lane with the real operand converted (`real-to-complex`), the same text; a real type, or a wide type in the `strict` mode, the real call; a wide type in the `complex` mode is declined. Complex operand: as `Tan`. The engine's stochastic equality passes `-a + cos(arccos(a))` with `a` of no declared type (admitted: `Math.acos`) and with `a: real`, where `Arccos(a)` is complex and the `Cos` of it, a complex operand that is not a name, declines. |
| `Gamma` | Two operands: the upper incomplete gamma (`continuationCall()`, `_SYS.gammaUpper` or `_SYS.cgammaUpper`). One operand: `_SYS.cgamma(z)` for a complex operand (wrapped in `_SYS.cplx()` in the `complex` mode), `_SYS.gamma(x)` otherwise; a real operand is real in both modes (`complexContinuation()` answers `real` for one operand). | One operand: as `Tan`. Two operands: declined. |
| `Erf`, `Erfc`, `Digamma` | A name mapping (`_SYS.erf`, `_SYS.erfc`, `_SYS.digamma`), a real lowering only: a complex operand declines in the `strict` mode and is guarded (`_SYS.cisreal`) in the `complex` mode. | A real operand: the same call. A complex operand: declined. `Digamma(+∞)` is `NaN` on both routes, where the interpreter gives `+∞`. |
| `Haversine` | `(1 - Math.cos(t)) / 2`, with `t` the code of the operand (`inlineExpression()`): when that code is a name or digits (a parameter, a local, a capture written as a literal), the expression is written in its parent with no parentheses, else in a function that binds `t`. So the existing compiler writes `2 / (1 - Math.cos(x)) / 2` for `2 / Haversine(x)` with a parameter `x`, a quarter of the value: a defect of the existing compiler (CE-1196). A complex operand is written as a real one. | The same expression. A `Haversine` that is a factor after the first of a `Multiply`, the divisor of a `Divide` or the operand of a `Negate`, where the existing emitter can group it wrongly, is declined at admission (`refuseHaversineGrouping()`, `outside-profile`) unless its operand is a free symbol with no value, which both emitters write `_.x` and the existing one binds: `(x - 1) · Haversine(x)` with a free `x` is admitted. The emitter checks the same case (`Source.bare`). A complex operand: declined. |
| `Sign` | A complex operand: `_SYS.csign(z)`; otherwise `Math.sign(x)`. The node is complex exactly when its operand is (`COMPLEX_PROPAGATING_HEADS`), whatever its type (`complex \| nan` for a name with no declared type). In `JUMP_FUNCTIONS`. | The lane of the operand: the same calls (a complex name in the `strict` mode only). A node with no unknown: declined (`closedJumpRefusal()`). |
| `Ceil`, `Round` | A second operand: the multiple of a step (`jsRoundToStep()`). An operand that the compiler proves an integer: the operand (`identityPassthrough()`). Otherwise `Math.ceil(x)`, and for `Round` the code of `ce.roundingTies` (`jsRoundToInteger()`): `(Math.sign(t) * Math.round(Math.abs(t)))` for `'away-from-zero'`, the default, with `t` bound once. Real lowerings only. In `JUMP_FUNCTIONS` and `SHIFT_JUMP_HEADS`: `closedExactJump()` and `jumpShiftRewrite()`. | One real operand: `Math.ceil(x)`, and the code of `'away-from-zero'` with the operand evaluated once (`round-ties-away`); both give the operand itself for an integer, `-0`, an infinity and `NaN`, so the route writes them also where the existing emitter writes the operand. Another rule for ties, a step, a complex operand, a node with no unknown, and an operand with an exact constant that no double holds (`inexactJumpConstant()`): declined. |
| `Conjugate` | A complex operand: `_SYS.cconj(z)`. Otherwise the operand itself (`identityPassthrough()`). | A real operand: the operand itself (the form `identity`), with its fact. A complex operand: declined. |
| `Log` | One operand (base 10), or the literal base 10 or 2 (`fixedLogBase()`): `Math.log10(x)` or `Math.log2(x)`; on the complex lane `_SYS.clog10` or `_SYS.clog2` of the operand, converted when it is real. Another base: `(Math.log(x) / Math.log(b))`, on the complex lane a complex quotient of `_SYS.cln`. The lane is the rule of `Sqrt` and `Ln` for every operand (`isComplexValued()`, `promotesToComplexLane()`). | The rule of `Ln` (`radicalLane()`) for the first operand with a fixed base, for both operands with another base. Fixed base: the same calls (`log10`, `log2`). Another base, both operands real: the quotient of two `ln`, the same doubles; complex: declined. A complex operand: declined. |
| `LogGamma` | No lowering on the JavaScript target: the existing compiler declines (`no lowering for it`). | Declined (`unsupported head`), as before. |

## What step 1 implements from this list

1. Three refusals at admission, each with its own message and a test: a
   `Less` or `Equal` with no free symbol; an `If`
   whose condition has the type `true` or `false`; a `Less` or `Equal` with
   more than two operands or with a complex operand.
2. The refusal of a `cse` or `constantFold` option that is not `false`, when
   the new emitter is selected. With the existing emitter, the fragment
   target keeps the options it accepts today.
3. Nothing for the other rows: they are rules of the lowering of step 2.
