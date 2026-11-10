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

### Places that the pilot vocabulary does not reach

| Place | Why it is not reached |
| --- | --- |
| `jumpShiftRewrite()` (`compile-folding.ts`) | It applies to a rounding function. The vocabulary has none. |
| `knownExponentPower()` (`compile-real-analysis.ts`) | It applies to `Power`. The vocabulary has no `Power`. |
| `MatchesType` in `compileRewrittenForm()` | Not in the vocabulary. |
| The rewrite of a `Multiply` as a division in `compileExprOperator()` | It needs a factor that is a `Power`. |
| The bigint emitter (`emitBigintLane()`) | The fragment target refuses the `bigint` mode. |

Each of these becomes a row of the first table when its operator enters the
vocabulary (step 5 of the plan for `Power`; `Sqrt` has its row above).

## What step 1 implements from this list

1. Three refusals at admission, each with its own message and a test: a
   `Less` or `Equal` with no free symbol; an `If`
   whose condition has the type `true` or `false`; a `Less` or `Equal` with
   more than two operands or with a complex operand.
2. The refusal of a `cse` or `constantFold` option that is not `false`, when
   the new emitter is selected. With the existing emitter, the fragment
   target keeps the options it accepts today.
3. Nothing for the other rows: they are rules of the lowering of step 2.
