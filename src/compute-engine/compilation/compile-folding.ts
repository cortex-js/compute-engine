// Constant folding at compile time: the fold value, its cost estimate,
// exactness, big-op bounds, jump shifts and the fold memos.

import { hasUnknownsWithMemo } from '../boxed-expression/abstract-boxed-expression.js';
import type {
  Expression,
  FunctionInterface,
  IComputeEngine as ComputeEngine,
} from '../global-types.js';
import type { MathJsonSymbol } from '../../math-json/types.js';
import { isOperatorDef } from '../boxed-expression/utils.js';
import { isTuple } from '../collection-utils.js';
import { widen } from '../../common/type/utils.js';
import { isSubtype } from '../../common/type/subtype.js';
import { makeNumericRangeType } from '../../common/type/numeric-range.js';
import type { NumericPrimitiveType, Type } from '../../common/type/types.js';
import {
  isSymbol,
  isNumber,
  isString,
  isFunction,
  isDictionary,
} from '../boxed-expression/type-guards.js';
import { asRational } from '../boxed-expression/numerics.js';
import {
  functionLiteralParameterName,
  isDestructuringParameter,
  isRestParameter,
} from '../boxed-expression/function-literal.js';
import { multiClauseState } from '../multi-clause.js';
import { JUMP_FUNCTIONS } from '../jump-functions.js';
import type { CompileTarget, TargetSource } from './types.js';
import { CompileDeclineError } from './diagnostics.js';
import { builtinOperatorDefinition } from './builtin-callback.js';
import { exactDoubleValue } from '../numeric-value/exact-integer-value.js';
import { rangeCount } from '../numerics/range-count.js';
import { isBeyondSafeInteger } from '../numerics/numeric.js';
import { smallCount } from '../boxed-expression/collection-count.js';
import { CompilerState } from './compiler-state.js';
import { core } from './compiler-core-hooks.js';
import { recordFoldedPromotions } from './compile-statements.js';
import { storedDefinitions } from './compile-integrals.js';
import {
  signatureParamType,
  userFunctionLiteral,
} from './compile-assignment-checks.js';
import type {
  FoldCostContext,
  UnsafeIntegerOperand,
} from './compiler-types.js';
import { compilationType } from './compiler-type-facts.js';
import { BRANCH_RELATIONS } from './compile-conditions.js';
import {
  mentionsCompileBoundName,
  mentionsExcludedName,
} from './compiler-names.js';
import { declareValueOperand } from './compile-declarations.js';

/**
 * The work `foldCostEstimate` charges for ONE numeric quadrature, in
 * integrand evaluations: the adaptive Gauss–Kronrod worst case. Reaching
 * the `maxIntervals` budget (1500, the `adaptiveQuadrature` default in
 * `numerics/gauss-kronrod.ts`) evaluates BOTH child panels of every split,
 * so the panel count is ~2× the live-interval budget — ~3000 panels of 15
 * GK15 nodes each (45,000 evaluations). A result next to a singular
 * endpoint is then checked against the tanh-sinh rule, which evaluates the
 * integrand at most `2·maxIntervals` = 3,000 more times
 * (`resolveSingularEndpoints`, `numerics/endpoint-quadrature.ts`): 48,000 in
 * all. A definite integral's syntax is a handful of nodes while
 * its evaluation may run that whole budget, so without this arm a constant
 * integral was the canonical "estimate miss" — the class the retired
 * per-fold wall-clock deadline existed to catch. That wall-clock made the
 * fold decision depend on machine load and was removed by user ruling; see
 * the ROADMAP.md entry "compile-time constant-fold eligibility is
 * deterministic — the wall-clock backstop is removed". Priced at the WORST
 * case, not the typical converged cost
 * (~16 panels): the estimate is the only anti-hang gate, so it must bound
 * what the evaluation can do.
 *
 * NOT covered by this figure, deliberately: the Monte-Carlo fallback a
 * non-converged `Integrate` or `NIntegrate` can take after the quadrature
 * (1e7 samples of a COMPILED integrand, `integrateRealPart()` in
 * `library/calculus.ts`). Its sample count is a deterministic constant, so
 * it is a bounded tail — comparable to the 2 s the retired wall-clock budget
 * tolerated — not a hang, and pricing it would decline every constant
 * integral from folding. `NIntegrate` runs the same quadrature first and the
 * same fallback after it, so it takes the same price.
 */
export const FOLD_QUADRATURE_EVALS = 48_000;

/**
 * The maximum estimated work a subtree may cost before the fold declines
 * (`foldCostEstimate`). This is the eligibility decision, and it is a property
 * of the EXPRESSION alone, so the same input always compiles to the same
 * output.
 *
 * A deterministic work estimate decides eligibility because bignum folding and
 * double-based structural lowering can differ in their last digits. A
 * wall-clock cutoff would make the chosen result depend on machine load.
 */
export const CONSTANT_FOLD_MAX_COST = 200_000;

/**
 * How deep `foldCostEstimate` walks before giving up and declining.
 *
 * The estimator exists to keep the fold cheap, so it must not become the
 * expense it guards against: without a depth bound, a deeply nested tree costs
 * a full walk on every node the top-down fold visits, which is quadratic in
 * depth. A tree deeper than this is also very unlikely to be a constant worth
 * folding. Exceeding it yields an infinite estimate — the same "decline" the
 * cost ceiling produces, so there is one failure mode rather than two.
 */
export const CONSTANT_FOLD_MAX_DEPTH = 48;

/**
 * How many nodes `foldCostEstimate` may visit before declining.
 *
 * The depth bound does not constrain a wide call graph, whose analysis can grow
 * exponentially while remaining shallow. This limit keeps the estimator's own
 * work finite before the evaluation deadline is armed.
 */
export const CONSTANT_FOLD_MAX_VISITS = 20_000;

/**
 * Cap on `engine.maxCollectionSize` while a constant fold evaluates. It bounds
 * the memory a compile-time evaluation can commit to materializing a lazy
 * collection, complementing the time budget above. Matches the engine's
 * default (10 000), so it only bites when the caller raised the engine cap
 * for run-time evaluation — that intent should not implicitly license
 * compile-time materialization of the same magnitude. An oversized
 * collection stays lazy under the cap (never truncated), so a clamped
 * evaluation yields a correct value or a non-literal — never a wrong fold.
 */
export const CONSTANT_FOLD_MAX_COLLECTION_SIZE = 10_000;

/**
 * The maximum number of elements or iterations that one constant fold may
 * walk (`foldCostEstimate`): the trip count of an indexed `Sum`/`Product`,
 * and the size of a collection that a reducer, a `Map`/`Filter` or a
 * higher-order operator (`CountIf`, `Any`, `Reduce`, …) walks. A larger
 * walk declines the fold, whatever its cost per element.
 *
 * The cost per element alone does not bound the time. The interpreter pays
 * about 10 to 20 µs for each element of a walk (it binds the index or applies
 * the callback, and boxes the result), whatever the cost estimate of the
 * body. So a walk of 100 000 elements with a body of cost 1 was admitted at
 * an estimate of 100 000, and its fold took several seconds:
 * `Sum(Filter(1..99999, IsPrime))` took 6.9 s to compile, and
 * `Any(1..99999, x ↦ x > 99998)` 10 s. The structural lowering of the same
 * walk runs in milliseconds. The cap is the materialization cap of the fold,
 * so a fold walks at most as many elements as it may materialize. (CE-324.1)
 */
export const CONSTANT_FOLD_MAX_WALK = CONSTANT_FOLD_MAX_COLLECTION_SIZE;

/** The integral operators excluded from constant folding when the caller
 * requested the stochastic Monte-Carlo quadrature (see `tryConstantFold`). */
export const MONTE_CARLO_FOLD_EXCLUSIONS: ReadonlySet<string> = new Set([
  'Integrate',
  'NIntegrate',
]);

/**
 * The operators whose value depends on every digit of an operand, so that a
 * rounded operand gives a different number and not a less precise one: the
 * remainders and the common divisor and multiple. Their compiled lowerings
 * refuse an operand beyond the safe integer range at run time
 * (`integerOperand` in `javascript-runtime.ts`), and the constant fold
 * declines for the same operand (`unsafeIntegerOperands`). An operand at
 * a parameter that an operator's signature declares `integer` is treated
 * the same way, with no need to be listed here.
 */
const DIGIT_DEPENDENT_OPERATORS: ReadonlySet<string> = new Set([
  'Mod',
  'Remainder',
  'GCD',
  'LCM',
]);

/**
 * The integers inside the safe integer range, `integer<-(2^53 − 1)..2^53 − 1>`.
 * An operand that has no fold value of its own, but whose static type is a
 * subtype of this type, is known to be in the safe integer range
 * (`unsafeIntegerOperands`).
 */
const SAFE_INTEGER_TYPE = makeNumericRangeType(
  'integer',
  -Number.MAX_SAFE_INTEGER,
  Number.MAX_SAFE_INTEGER
);

/**
 * The largest operand, in decimal digits, that the exact constant fold of a
 * digit-reading operation accepts (`exactFoldValue`). A larger operand
 * declines the fold.
 *
 * `foldCostEstimate` prices the `.N()` evaluation, where one arithmetic
 * operation costs about the same at every magnitude. The exact evaluation
 * computes with every digit, so its cost grows with the size of the values,
 * and the estimate does not see that. Measured: the exact sum of `n^n` for
 * `n = 1..1000` (3,001 digits) takes about 80 ms, and for `n = 1..5000`
 * (18,495 digits) about 2.7 s. The cap admits the first and declines the
 * second. It also admits the usual large constants of exact integer
 * problems: `2^1000` has 302 digits.
 */
const EXACT_FOLD_MAX_DIGITS = 5_000;

/**
 * The decimal digits in one 64-bit word of a big integer (64 · log10 2 ≈
 * 19.3), rounded down. The exact fold prices one exact operation on a value
 * of `d` digits as `d / EXACT_FOLD_DIGITS_PER_WORD` units of the cost
 * estimate, where one unit is one machine-number operation: an exact
 * addition does one word operation per word of its operands.
 */
const EXACT_FOLD_DIGITS_PER_WORD = 19;

/**
 * Cap on the element count of a constant collection folded to a literal list
 * (`tryConstantFold`). A larger constant collection compiles structurally,
 * rather than emitting a large literal.
 *
 * The maximum is inclusive. The default of 49 matches JavaScript `Range`,
 * whose structural handler inlines when `len < 50`.
 *
 * This is the default only. It is a source-size trade-off for
 * the JavaScript and Python targets, where both emissions exist and both
 * compile. On the shader targets a dynamic collection has no lowering at
 * all, so for a constant one the inline literal is the only emission that can
 * compile and the number is a capability limit instead — they raise it via
 * `CompileTarget.maxInlineElements` to the same 256 their own `Range` handler
 * already inlines to, so one limit governs both paths rather than a fold cap
 * refusing what the `Range` handler would have accepted.
 */
export const CONSTANT_FOLD_MAX_INLINE_ELEMENTS = 49;

/**
 * Compile-time constant folding: when `expr` is a pure subtree with no free
 * variables, evaluate it now and emit the value as a target literal,
 * instead of lowering the computation structurally. Returns `undefined`
 * whenever folding is unsafe, over budget, or the value is not a number or
 * boolean — the caller then compiles the subtree as before, so a declined
 * fold is never an error.
 *
 * The folded value is the interpreter's (`.N()`), which is the parity
 * direction this compiler already commits to elsewhere (see
 * `negativeBaseRealPow` in constant-folding.ts): compiled output tracks
 * `evaluate()`, even where the structural code's different operation order
 * would round the last ulp differently.
 *
 * Safety gates, in cost order:
 * - `constantFold: false` on the target (codegen tests use this);
 * - free variables (`unknowns`) — checked FIRST and always before `.N()`
 *   (an argument with unknowns can never become a literal, and `.N()` over
 *   nested user-function applications is exponentially more expensive than
 *   the check — the gate convention of `boxed-expression/numerics.ts`);
 * - impurity (`Random(…)` and friends must keep drawing at run time);
 * - a static type that provably admits no number or boolean (a list- or
 *   string-valued subtree cannot fold to a literal; skip the evaluation);
 * - names bound by an enclosing binding form (lambda parameters, loop
 *   indices — the evaluator would read the engine symbol they shadow);
 * - `vars`-mapped symbols and caller-overridden operators
 *   (`mentionsExcludedName`);
 * - a deterministic WORK ESTIMATE over the subtree's syntax
 *   (`foldCostEstimate` against `CONSTANT_FOLD_MAX_COST`), which prices one
 *   numeric quadrature at its worst case (`FOLD_QUADRATURE_EVALS`) and
 *   declines outright the heads whose work no syntax walk can price
 *   (`Limit`, `NLimit`, `Residue`, and a flat multi-limit `Integrate`).
 *
 * The evaluation itself runs under NO per-fold wall-clock deadline, and this
 * function arms none. The work estimate above is the only anti-hang gate, and
 * it is deliberately the only one: eligibility is decided from the expression
 * alone, so the same input always compiles to the same output, where a
 * wall-clock cutoff made the fold decision depend on machine load. The bounds
 * the evaluation does run under are themselves deterministic —
 * `engine.iterationLimit`, the engine's `maxCollectionSize` clamped to a
 * fold-specific cap (so a constant subtree over a huge range degrades to
 * structural compilation instead of stalling the compile), and the adaptive
 * quadrature's own interval budget. An AMBIENT deadline armed by the CALLER
 * around the whole compilation still cancels it, through the ordinary
 * `_shouldContinueExecution` check sites.
 */
export function tryConstantFold(
  expr: Expression,
  target: CompileTarget<Expression>,
  prec: number
): TargetSource | undefined {
  // The `constantFold` opt-out governs what CODE is emitted, so it gates
  // only this emission entry — `constantFoldValue` stays available to the
  // shape analyses (`isProvablyRealValued`), whose answers describe the
  // runtime value and must not change with the emission style.
  //
  // A function whose result jumps at a point, applied to closed exact
  // operands, folds even under the opt-out. Its structural code computes
  // the operands as doubles, and a double can be on the other side of the
  // jump from the exact value: `Floor((25! − 1)/24!)` is 24, but the double
  // of the operand is 25.0, so the code gives 25. The fold reads the exact
  // value, as the interpreter does, so the compiled value is the
  // interpreter's value (see `closedExactJump`).
  const jump = closedExactJump(expr, target);
  if (target.constantFold === false && !jump) return undefined;
  // The fold evaluates the subtree with `.N()`, and the evaluation can
  // compile a lazy `Map` callback inside this compilation. The code
  // generation of that callback can record a promotion in `_promoted`,
  // but that code is not emitted, so the record is restored. A complex
  // fold result records its own promotions below
  // (`recordFoldedPromotions`), after the restore.
  const recorded = CompilerState._promoted;
  let folded: ReturnType<typeof core.constantFoldValue>;
  try {
    folded = core.constantFoldValue(expr, target);
  } finally {
    CompilerState._promoted = recorded;
  }
  if (folded === undefined) return undefined;
  const { value, elements } = folded;
  const engine = expr.engine;

  // A constant COLLECTION folds to a literal of its elements, emitted
  // through the target's own lowering — `[1, 4, 9]` on JavaScript and
  // Python, `vec3(1.0, 4.0, 9.0)` / `float[5](…)` on the shader targets. So
  // `At(Map(_ ↦ _², 1..20), k)` with a run-time `k` indexes a baked array
  // instead of building the range and mapping over it on every call. (On the
  // shader targets that shape had no lowering at all and failed closed; a
  // folded literal base is one it can index.)
  //
  // The literal is rebuilt with the value's OWN aggregate head: a `Tuple`
  // must not come back as a `List`, because the two are different types
  // wherever the target spells them differently — a Python list is mutable
  // and unhashable, and `(1, 2) == [1, 2]` is `False` there, so folding a
  // tuple through the list lowering silently changed the value's type.
  if (elements !== undefined) {
    // A complex-ish collection does not fold AT ALL. The structural
    // lowering picks its element convention from a conservative static
    // analysis, and the evaluated values need not agree with it in either
    // direction: `Map(_ ↦ √_, [-4, -9, -16])` compiles structurally to the
    // real kernel `Math.sqrt`, so it yields `[NaN, NaN, NaN]`, while `.N()`
    // answers `[2i, 3i, 4i]` — and a mixed list like `[-4, 4]` would fold
    // to one complex element beside one bare number, a shape no consumer
    // can read uniformly. Whether an expression folds also depends on the
    // element cap and the evaluation budget, so admitting these would make
    // the emitted VALUES depend on those thresholds, not just the emitted
    // code. Decline the whole class and let the structural path define
    // both value and shape, as it did before folding existed.
    //
    // This costs the common case nothing: every real collection reports
    // `isComplexValued === false` (measured over Map/Range/Filter/list
    // literals), so only genuinely complex-ish aggregates are turned away.
    //
    // The evaluated ELEMENTS are checked too: the static analysis reads a
    // callback body's value under the same carve-outs the emitter applies
    // (an unknown-sign `Sqrt` is real in strict mode), so it can call the
    // collection real while `.N()` produced `[2i, 3i, 4i]` — and a folded
    // literal of complex objects would then stand where the structural
    // lowering emits the real kernel's `NaN`s. Undirected infinity `~oo`
    // carries an infinite imaginary part but is real-shaped at run time
    // (the non-finite typing convention `isComplexValued` follows), so it
    // does not count.
    if (core.isComplexValued(expr)) return undefined;
    if (elements.some((e) => isNumber(e) && e.isComplex && !e.isInfinity))
      return undefined;
    // A collection with a `NaN` element does not fold either. An `Error`
    // never folds, because only number literals are inlined, but a
    // collection can hold an error in a disguised form: a lazy `Map`
    // served through the lowered broadcast spine replaces an element whose
    // callback returned an `Error` with the collection's absence marker,
    // which is `NaN` for a numeric collection. Inlining that `NaN` would
    // compile an interpreter error into a number with `success: true`.
    // The fold cannot tell such a `NaN` from a computed one, so it
    // declines, and the structural lowering decides both the value and
    // whether the expression compiles at all.
    if (elements.some((e) => isNumber(e) && e.isNaN)) return undefined;
    return emitFoldedValue(
      engine.function(isTuple(value) ? 'Tuple' : 'List', elements),
      target,
      prec
    );
  }

  const foldable =
    isNumber(value) || isSymbol(value, 'True') || isSymbol(value, 'False');
  if (!foldable) return undefined;

  // A boolean folds only when the target spells the boolean constants (the
  // JS target's `True`/`False` mappings). A target without a spelling
  // (Python, the shader targets) keeps its structural lowering.
  //
  // A comparison of closed exact numbers also folds through the target's
  // inlined constants (`True`/`False` on Python). Its structural code
  // compares doubles, which can give the wrong answer: on Python,
  // `(25! − 1)/24! < 25` compiled to `25 < 25`, which is `False`.
  if (isSymbol(value, 'True') || isSymbol(value, 'False'))
    return (
      target.var?.(value.symbol) ??
      (jump ? target.constant?.(value.symbol) : undefined)
    );

  // A complex-ish expression whose value comes back with NO imaginary part
  // does not fold at all. The structural lowering may return either shape
  // here — a bare number (`_SYS.at` over a real list, even when the INDEX
  // is complex) or the target's `{re, im}` complex convention (a call to a
  // function declared `-> complex`) — and which one it picks is a property
  // of the emitted code, not of any type this can read: the result type is
  // `number` in both directions, and `isComplexValued` answers for the
  // OPERANDS, so it is true for a real-valued `At` with a complex index.
  // Emitting the wrong one silently changes the shape a caller reads back
  // (`.re` working or not, depending only on whether the inputs happened to
  // be constant), so decline and let the structural path define the shape,
  // exactly as it did before folding existed. A value with a NONZERO
  // imaginary part still folds, through the complex literal path below,
  // when the node is complex-valued (next gate).
  if (isNumber(value) && !value.isComplex && core.isComplexValued(expr))
    return undefined;

  // The converse: a finite value with a NONZERO imaginary part does not
  // fold on a node that the analysis reads as REAL. The interpreter that
  // computes the fold ignores a real ascription, while the structural
  // lowering honors it. For example, `p(0)` with `p: (real) -> real` and
  // `p := k ↦ √(k − 1)` evaluates to `i`, but the structural route calls
  // the real-lane definition `Math.sqrt(k + -1)` and gives `NaN`, as
  // `p(x)` does at `x = 0`. Folding the complex value would also hand a
  // parent that lowered real arithmetic an object to add, which
  // stringifies (`x + {…}` → `"0[object Object]"`). Decline, so the
  // structural route defines the value, whether the operands are constant
  // or not. `~oo` is excluded: the gate below emits it as a real
  // `Infinity` on such a node.
  if (
    isNumber(value) &&
    value.isComplex &&
    !value.isInfinity &&
    !core.isComplexValued(expr)
  )
    return undefined;

  // `~oo` on a node the surrounding code reads as a REAL number folds to
  // `Infinity` — the float projection of the projective infinity (its
  // magnitude, without the direction it never had) — not to the
  // `{re: ∞, im: ∞}` object the value itself carries. Emitting the complex
  // object instead hands a parent that lowered real arithmetic an object
  // to add, which stringifies (`1 + {…}` → `"1[object Object]"`). A node
  // that really is complex-valued folds to the complex pole (see below).
  // `isInfinity` with a non-zero imaginary part is the `~oo` test: a real
  // ±∞ has `im === 0`, and an exact value whose imaginary part merely
  // OVERFLOWS the float projection is not infinite, so it answers `false`
  // here (see `BoxedNumber.isInfinity`).
  if (
    isNumber(value) &&
    value.isInfinity &&
    value.isComplex &&
    !core.isComplexValued(expr)
  )
    // The float projection of `~oo` is `Infinity` (pole-encoding ruling
    // 2026-08-28), the same spelling the literal-emission path and the
    // runtime division produce — see the `~oo` arm of the number-literal
    // emission below.
    return emitFoldedValue(engine.PositiveInfinity, target, prec);

  // A complex value that reaches this point is on a node that the analysis
  // reads as complex (the gates above decline or project every other
  // complex value), and it is emitted as a complex literal. When the node
  // is complex because a promotable head promotes, the literal is a
  // promotion: the analysis does not record it (see `isComplexValued`), and
  // no emitter sees the subtree, so it is recorded here.
  if (isNumber(value) && value.isComplex) recordFoldedPromotions(expr, target);

  // `~oo` on a node that IS complex-valued folds to the complex lane's
  // spelling of the pole, `{re: ∞, im: ∞}` (`complexPole()` in
  // `javascript-target.ts`), the value the run-time complex routines give
  // at a pole (`cot 0`, `arctan i`). The number literal emission below
  // would spell it `Infinity`, a real value, so the value would depend on
  // whether the argument was a constant.
  if (
    isNumber(value) &&
    value.isInfinity &&
    value.isComplex &&
    target.complex !== undefined
  )
    return target.complex(Infinity, Infinity);

  // Emit through the ordinary number-literal path so the target's own
  // spelling applies (float formatting, complex support, negative-literal
  // parenthesization).
  return emitFoldedValue(value, target, prec);
}

/**
 * Empty the memos whose answers read engine symbol values or definitions.
 * Those are stable within one compilation but not across compilations,
 * and a boxed expression can outlive the compilation that cached its
 * answer. Called when the outermost compilation starts and when it ends.
 */
export function resetCompilationMemos(): void {
  _invalidateComplexMemo();
  CompilerState._poisonConditions = new WeakSet();
  CompilerState._foldValueMemo = new WeakMap();
  CompilerState._foldValueBlockedMemo = new Map();
  CompilerState._unknownsMemo = new WeakMap();
  CompilerState._knownExponentMemo = new WeakMap();
  CompilerState._constantPoleMemo = new WeakMap();
  CompilerState._foldValueImpureMemo = new Map();
  CompilerState._foldValueMentionsMemo = new Map();
  CompilerState._angularDefinitionMemo = new Map();
  CompilerState._absArgMemo = new Map();
  CompilerState._unsafeOperandsMemo = new WeakMap();
}

/** `expr.unknowns.length > 0`, from the memo of this compilation. The fold
 * asks it at each level of the expression it compiles: without the memo,
 * each answer walked the subtree again, on top of the compiler's own stack,
 * and a deep expression overflowed the stack there (ROADMAP CE-320.2). */
export function hasUnknowns(expr: Expression): boolean {
  return hasUnknownsWithMemo(expr, CompilerState._unknownsMemo);
}

/**
 * Does `expr`, or a stored definition that it reads at any depth (the
 * value of an assigned symbol, the body of a user function, the clauses
 * of a multi-clause function), hold an `AbsArg` node?
 */
export function reachesAbsArg(expr: Expression): boolean {
  const seen = new Set<Expression>();
  const visit = (node: Expression): boolean => {
    if (isSymbol(node)) return nameReachesAbsArg(node.engine, node.symbol);
    if (seen.has(node)) return false;
    seen.add(node);
    if (isDictionary(node)) return node.values.some(visit);
    if (isFunction(node))
      return (
        node.operator === 'AbsArg' ||
        node.ops.some(visit) ||
        nameReachesAbsArg(node.engine, node.operator)
      );
    return false;
  };
  return visit(expr);
}

/** See `reachesAbsArg`. A definition that refers to itself answers
 * `false` at the re-entry. */
export function nameReachesAbsArg(
  engine: ComputeEngine,
  name: string
): boolean {
  const memo = CompilerState._absArgMemo;
  const known = memo.get(name);
  if (known !== undefined) return known;
  memo.set(name, false);
  const hit = storedDefinitions(engine, name).some((d) => reachesAbsArg(d));
  memo.set(name, hit);
  return hit;
}

/**
 * Does `expr` emit code that the caller supplied, once the values of the
 * symbols it reads and the bodies of the user functions it calls are looked
 * through, as a compilation target inlines them? Caller code is a symbol
 * whose `vars` entry is caller source (`isStringVar`), or an application
 * whose emission the caller supplied (`isCallerMapped`: a `functions` or
 * `operators` entry, an operator's own `compile` handler). It can count its
 * calls or draw a number, and the compiler cannot see inside it, so a pass
 * that skips, repeats or moves the evaluation of `expr` must treat it as
 * code with an effect. A call whose head is a `vars` key with caller source
 * is caller code too. `readsInput` names a symbol whose reference reads an
 * input of the compiled code (a plain `vars` read, a binder's variable): its
 * stored value is not read, so the walk stops there. `localFunction` gives
 * the literal of a function that the compiled block itself defines (it is
 * called instead of an engine function with the same name): `null` when
 * that literal cannot be read, which counts as caller code because its body
 * is not known, and `undefined` when the name is not a block local.
 *
 * Each node, each symbol name and each function name is visited once, so a
 * value that refers to itself ends the walk.
 */
export function reachesCallerCode(
  expr: Expression,
  caller: {
    isStringVar?: (name: string) => boolean;
    isCallerMapped: (node: Expression & FunctionInterface) => boolean;
    readsInput?: (name: string) => boolean;
    localFunction?: (
      name: string
    ) => (Expression & FunctionInterface) | null | undefined;
  }
): boolean {
  const engine = expr.engine;
  const seen = new Set<Expression>();
  const symbols = new Set<string>();
  const functions = new Set<string>();
  const visit = (node: Expression): boolean => {
    if (seen.has(node)) return false;
    seen.add(node);
    if (isSymbol(node)) {
      const name = node.symbol;
      if (caller.isStringVar?.(name) === true) return true;
      if (symbols.has(name)) return false;
      symbols.add(name);
      // A block-local function passed by name (`Apply(f, 2)`, a callback)
      // is the block's own binding, as in a call of `f`. It is looked up
      // before `readsInput`: the block binds each of its locals, so the
      // name is also a bound variable.
      const local = caller.localFunction?.(name);
      if (local === null) return true;
      if (local !== undefined) return visit(local);
      if (caller.readsInput?.(name) === true) return false;
      const value = engine._getSymbolValue(name);
      return value !== undefined && visit(value);
    }
    if (isDictionary(node)) return node.values.some(visit);
    if (!isFunction(node)) return false;
    if (
      caller.isStringVar?.(node.operator) === true ||
      caller.isCallerMapped(node) ||
      node.ops.some(visit)
    )
      return true;
    if (functions.has(node.operator)) return false;
    functions.add(node.operator);
    const local = caller.localFunction?.(node.operator);
    if (local === null) return true;
    if (local !== undefined) return visit(local);
    const literal = userFunctionLiteral(engine, node.operator);
    if (literal !== undefined) return visit(literal);
    return (
      multiClauseState(engine.lookupDefinition(node.operator))?.clauses.some(
        (c) => visit(c.literal)
      ) ?? false
    );
  };
  return visit(expr);
}

/**
 * Is `expr` impure once every assigned symbol value it reaches is looked
 * through? `expr.isPure` stops at a symbol that has a value, so
 * `a := r + r` with `r := Random()` reports pure; the body of a called
 * user-defined function is looked through the same way. A value
 * evaluated once where the interpreter re-evaluates it at every
 * reference must not be shared, and that decision needs the transitive
 * answer.
 *
 * Linear in the DISTINCT nodes reached (memoized by identity for the
 * compilation); a value that refers to itself is answered `false` on
 * re-entry.
 */
export function foldValueImpure(expr: Expression): boolean {
  const memo = CompilerState._foldValueImpureMemo;
  const cached = memo.get(expr);
  if (cached !== undefined) return cached;
  memo.set(expr, false);
  let impure = !expr.isPure;
  if (!impure) {
    const engine = expr.engine;
    // A node reached twice inside ONE value (a boxed expression is a DAG)
    // is visited once: the answer for it is the same on every path, and
    // walking it per path is exponential in the sharing depth.
    const seen = new Set<Expression>();
    const visit = (node: Expression): boolean => {
      if (isSymbol(node)) {
        const v = engine._getSymbolValue(node.symbol);
        return v !== undefined && foldValueImpure(v);
      }
      if (seen.has(node)) return false;
      seen.add(node);
      if (isDictionary(node)) {
        for (const v of node.values) if (visit(v)) return true;
        return false;
      }
      if (isFunction(node)) {
        for (const op of node.ops) if (visit(op)) return true;
        // A call of a user-defined function inlines its body on a shader
        // target, and the engine's purity does not look through a symbol
        // with a value inside that body either (`f(n) := n + r` with
        // `r := Random()` is pure to the engine): the literal is read
        // the same way, each clause of a multi-clause function too.
        const literal = userFunctionLiteral(engine, node.operator);
        if (literal !== undefined) return foldValueImpure(literal);
        const clauses = multiClauseState(
          engine.lookupDefinition(node.operator)
        )?.clauses;
        if (clauses !== undefined)
          return clauses.some((c) => foldValueImpure(c.literal));
      }
      return false;
    };
    impure = visit(expr);
  }
  memo.set(expr, impure);
  return impure;
}

/**
 * Every symbol name `expr` mentions, once every assigned symbol value it
 * reaches is looked through — free names AND value-carrying names, at any
 * depth.
 *
 * Linear in the DISTINCT nodes reached (memoized by identity for the
 * compilation); a value that refers to itself contributes nothing on
 * re-entry.
 */
export function foldValueMentions(expr: Expression): ReadonlySet<string> {
  const memo = CompilerState._foldValueMentionsMemo;
  const cached = memo.get(expr);
  if (cached !== undefined) return cached;
  const EMPTY: ReadonlySet<string> = new Set();
  memo.set(expr, EMPTY);
  const out = new Set<string>();
  const engine = expr.engine;
  // A node reached twice inside ONE value (a boxed expression is a DAG)
  // contributes its names once; walking it per path is exponential in the
  // sharing depth.
  const seen = new Set<Expression>();
  const visit = (node: Expression): void => {
    if (isSymbol(node)) {
      out.add(node.symbol);
      const v = engine._getSymbolValue(node.symbol);
      if (v !== undefined) for (const n of foldValueMentions(v)) out.add(n);
    } else if (seen.has(node)) {
      return;
    } else if (isDictionary(node)) {
      seen.add(node);
      for (const v of node.values) visit(v);
    } else if (isFunction(node)) {
      seen.add(node);
      for (const op of node.ops) visit(op);
    }
  };
  visit(expr);
  memo.set(expr, out);
  return out;
}

/**
 * Would folding `value` at a position that binds `bound`, in a preamble
 * owner that binds `ownerBound`, let one of the position's own names
 * capture a name of the value?
 *
 * A stored symbol value keeps the binding it was written against (ruled
 * 2026-09-21), so a name the value mentions denotes what it denotes in the
 * owner's environment. A name the POSITION binds and the owner does not is
 * therefore a capture: `a := t` met inside the emitted body of
 * `g := t ↦ t + a` would read the parameter, where the interpreter reads
 * the global and answers `t + 2` for `g(2)`.
 */
export function foldValueCaptured(
  value: Expression,
  bound: ReadonlySet<string> | undefined,
  ownerBound: ReadonlySet<string> | undefined
): boolean {
  if (bound === undefined || bound.size === 0) return false;
  if (bound === ownerBound) return false;
  const mentions = foldValueMentions(value);
  for (const name of bound)
    if (mentions.has(name) && ownerBound?.has(name) !== true) return true;
  return false;
}

/**
 * The target an INLINE fold of `value` compiles against.
 *
 * Normally the requesting target: the folded code is spliced at the
 * requesting position, so that position's `vars` mapping, shape frame and
 * value facts are the ones that apply to it.
 *
 * When the position would CAPTURE a name of the value
 * (`foldValueCaptured`), the value compiles against the target that owns
 * the preamble instead — the environment the interpreter reads it in. The
 * code is still spliced inline, so an impure value is still evaluated once
 * per reference; only the names resolve elsewhere. Ruled 2026-09-21.
 */
export function inlineFoldTarget(
  target: CompileTarget<Expression>,
  value: Expression
): CompileTarget<Expression> {
  const registry = target.userFunctions;
  const owner = registry?.valueRoot ?? registry?.root;
  if (owner === undefined || owner === target) return target;
  return foldValueCaptured(value, target.boundVars, owner.boundVars)
    ? owner
    : target;
}

/**
 * Can an INLINE fold keep the value's names resolving in the preamble
 * owner's scope, although the code is spliced inside the requesting
 * position's binder (`inlineFoldTarget`)?
 *
 * Only on a target that reads a free symbol off a vars object (`_.n` on the
 * JavaScript family, `CompileTarget.varsObjectName`). That spelling is not
 * an identifier an emitted parameter or loop variable can shadow, so the
 * spliced text keeps meaning what it meant at the owner. Where a free
 * symbol is a BARE identifier — the shader targets, which read it as a
 * uniform — the spliced text is read again inside the binder and denotes
 * the binder, so resolving it elsewhere changes nothing.
 */
export function inlineFoldKeepsOwnerScope(
  target: CompileTarget<Expression>,
  owner: CompileTarget<Expression> | undefined
): boolean {
  return (
    owner !== undefined &&
    owner !== target &&
    target.varsObjectName !== undefined
  );
}

/**
 * The name a fold of `value` requested from `target` would CAPTURE — a name
 * the value mentions that a parameter or binder binds in the scope where
 * the value is written — or `undefined` when nothing is captured.
 *
 * `binds` says whether the emitter holds the value as a preamble local
 * (`bindsFoldedValue`). A bound value is written once in the scope of the
 * target that owns the preamble; an inline fold is spliced at the
 * requesting position, and keeps the owner's name resolution only where
 * `inlineFoldKeepsOwnerScope` allows it.
 *
 * A captured name has no compiled answer. The value denotes what it
 * denotes where it was written (ruled 2026-09-21), and the scope it is
 * emitted into gives that spelling another meaning, so the caller fails
 * closed instead of answering the binder's value.
 */
export function foldCapturedName(
  target: CompileTarget<Expression>,
  value: Expression,
  binds: boolean
): string | undefined {
  const registry = target.userFunctions;
  const owner = registry?.valueRoot ?? registry?.root;
  const scope =
    binds || inlineFoldKeepsOwnerScope(target, owner)
      ? (owner ?? target)
      : target;
  const bound = scope.boundVars;
  if (bound === undefined || bound.size === 0) return undefined;
  const mentions = foldValueMentions(value);
  for (const name of bound) if (mentions.has(name)) return name;
  return undefined;
}

/**
 * The operands, in the constant subtree `expr`, of an operation that reads
 * every digit of its operand, whose numeric value is beyond the safe
 * integer range `±(2^53 − 1)` or infinite. The operations are the
 * operators of `DIGIT_DEPENDENT_OPERATORS`, and any operand at a parameter
 * that the operator's signature declares `integer` (`DigitSum`,
 * `IntegerDigits`, …). Empty for most subtrees.
 *
 * When there is such an operand, the fold value cannot come from `.N()`. `.N()`
 * approximates each operand first, `2^1000` to a 21-digit decimal, and the
 * integer operation then reads the rounded value as an exact integer:
 * `DigitSum(2^1000)` folded to `84`, the sum of those 21 digits, where
 * `evaluate()` answers `1366`, and `Mod(Σ n^n, 10^10)` over `n = 1..1000`
 * folded to `2683211021` where `evaluate()` answers `9110846700`. The
 * fold takes the value of `evaluate()` instead, when it is exact
 * (`exactFoldValue`), and declines otherwise. A declined fold leaves the
 * subtree to its structural lowering, whose run-time helper refuses the
 * same operand (`integerOperand` in `javascript-runtime.ts`), or which
 * declines when the target has no lowering for the operator. An operand
 * that is NaN is not beyond the range: NaN propagates.
 *
 * Each checked operand is evaluated through `constantFoldValue`, whose
 * memo the top-down fold reads again when it reaches that operand, so the
 * evaluation is not repeated. An operand that does not fold itself, and is
 * not a number literal, cannot be checked here. Usually it mentions a
 * variable bound in the subtree, such as the index of a `Sum`:
 * `DigitSum(2^n)` in `Sum(DigitSum(2^n), n, 1000, 1000)`. The value of such
 * an operand can be beyond the safe integer range, and `.N()` then gives a
 * wrong value (`84` for that sum, where `evaluate()` answers `1366`). So it
 * is included with an unknown digit count (`digits: undefined`), and the
 * fold value comes from `evaluate()` or the fold declines
 * (`exactFoldValue`). There is one exception: when the static type of the
 * operand is an integer range whose two bounds are finite and inside
 * `±(2^53 − 1)` (`SAFE_INTEGER_TYPE`), such as `integer<1..1000>` for `n`
 * in `Sum(Mod(n, 7), n, 1, 1000)`, the operand is known to be safe and is
 * not included. A bare `integer`, a range with an infinite bound such as
 * `integer<0..>`, and a non-integer type stay unknown.
 *
 * The answer for a node is the checked operands among its own operands,
 * followed by the answer for each operand. It is memoized per node
 * (`_unsafeOperandsMemo`), so one compilation scans each node once, however
 * many ancestors ask.
 */
export function unsafeIntegerOperands(
  expr: Expression,
  target: CompileTarget<Expression>
): ReadonlyArray<UnsafeIntegerOperand> {
  if (!isFunction(expr)) return [];
  let byExpr = CompilerState._unsafeOperandsMemo.get(target);
  const cached = byExpr?.get(expr);
  if (cached !== undefined) return cached;
  // The number of decimal digits of the integer part of `|v|`, read from
  // the working-precision value when there is one, since a machine number
  // overflows to `Infinity` beyond about 308 digits.
  const digitsOf = (v: Expression): number => {
    if (!isNumber(v)) return Infinity;
    const big = v.bignumRe;
    if (big !== undefined)
      return big.isFinite() ? big.exponent + big._digitCount() : Infinity;
    const x = Math.abs(v.re);
    return Number.isFinite(x) ? Math.floor(Math.log10(x)) + 1 : Infinity;
  };
  // The digit count of the largest value of `op` beyond the safe integer
  // range, or `undefined` when there is no such value. `'unknown'` when
  // `op` cannot be checked, because it has no fold value, is not a number
  // literal, and its static type is not inside `SAFE_INTEGER_TYPE`.
  const unsafeDigits = (op: Expression): number | 'unknown' | undefined => {
    const folded = core.constantFoldValue(op, target);
    if (folded === undefined && !isNumber(op)) {
      const t = compilationType(op);
      return t !== 'never' && isSubtype(t, SAFE_INTEGER_TYPE)
        ? undefined
        : 'unknown';
    }
    let digits: number | undefined = undefined;
    for (const v of folded?.elements ?? [folded?.value ?? op])
      if (isNumber(v) && !v.isComplex && isBeyondSafeInteger(v.re))
        digits = Math.max(digits ?? 0, digitsOf(v));
    return digits;
  };
  const engine = expr.engine;
  const result: UnsafeIntegerOperand[] = [];
  const h = expr.operator;
  const all = DIGIT_DEPENDENT_OPERATORS.has(h);
  const def = all ? undefined : engine.lookupDefinition(h);
  const signature =
    def !== undefined && 'operator' in def
      ? def.operator.signature?.type
      : undefined;
  for (const [i, op] of expr.ops.entries()) {
    let checked = all;
    if (!checked && signature !== undefined) {
      const t = signatureParamType(signature, i);
      checked = t !== undefined && isSubtype(t, 'integer');
    }
    if (checked) {
      const digits = unsafeDigits(op);
      if (digits === 'unknown') result.push({ operand: op, digits: undefined });
      else if (digits !== undefined) result.push({ operand: op, digits });
    }
    result.push(...unsafeIntegerOperands(op, target));
  }
  if (byExpr === undefined) {
    byExpr = new Map();
    CompilerState._unsafeOperandsMemo.set(target, byExpr);
  }
  byExpr.set(expr, result);
  return result;
}

/**
 * The fold value of `expr` taken from `evaluate()`, for a subtree where an
 * operation that reads every digit of its operand has the operands
 * `unsafe`, beyond the safe integer range (`unsafeIntegerOperands`). The
 * exact result is approximated once, at the end, so it is the float of the
 * value the interpreter answers.
 *
 * `undefined`, and the fold declines, when an operand in `unsafe` is not
 * an exact RATIONAL, or the result is not exact: a symbolic value, an
 * inexact number, or a list with such an element. The operands are checked
 * first because an integer operation is exact only on an exact rational
 * operand: `√2 · 10^30` is an exact value but not a rational, and
 * `evaluate()` of `Mod` reads a rounding of it and answers the exact `5`,
 * where the value is `0.698…`.
 *
 * An operand with an unknown digit count (`digits: undefined`) has no
 * value before the evaluation, because it mentions a variable bound in
 * the subtree. It is not replaced: the `evaluate()` of the whole subtree
 * computes it for each value of the bound variable. Its value cannot be
 * checked for rationality, so its static type is checked instead: the
 * fold declines unless the type is a subtype of `rational`. The type of
 * `√2 · 10^30 · n` is `real`, so `Sum(Mod(√2 · 10^30 · n, 7), n, 1, 1)`
 * declines, where `evaluate()` answers the wrong exact `5`. When there is
 * such an operand, the result must also be an exact rational, and a
 * boolean result declines.
 *
 * The fold also declines when the exact evaluation is too expensive.
 * `foldCostEstimate`, which admitted the subtree, prices the `.N()`
 * evaluation, where an operation costs the same at every magnitude; an
 * exact operation costs more as its values get larger. So the fold
 * declines when an operand has more than `EXACT_FOLD_MAX_DIGITS` digits,
 * or when the iterations of the `Sum` and `Product` operators in the
 * subtree, times the size of the largest operand in machine words, exceed
 * `CONSTANT_FOLD_MAX_COST`. The size of the largest operand is an upper
 * bound for the values that each iteration computes when the operand is
 * the result of the iteration, as in `Mod(Sum(n^n, …), 10^10)`. An
 * operand with an unknown digit count has the largest size that the fold
 * accepts, `EXACT_FOLD_MAX_DIGITS`, only when its syntax and integer ranges
 * prove that it fits that size (`exactFoldOperandFits`). Otherwise the
 * fold declines before evaluating it. Thus
 * `Sum(Mod(n^n, 10^10), n, 1, 1000)` declines (1000
 * iterations of 264 words), and its compiled loop refuses the large
 * operand at run time.
 *
 * Each operand in `unsafe` is evaluated once, and the subtree is then
 * evaluated with the operand replaced by its exact value, so the operand
 * is not evaluated a second time.
 */
export function exactFoldValue(
  expr: Expression,
  unsafe: ReadonlyArray<UnsafeIntegerOperand>
): Expression | undefined {
  const digits = Math.max(
    ...unsafe.map((u) => u.digits ?? EXACT_FOLD_MAX_DIGITS)
  );
  if (!(digits <= EXACT_FOLD_MAX_DIGITS)) return undefined;
  const unknown = unsafe.filter((u) => u.digits === undefined);
  const callbackRanges =
    unknown.length === 0 ? undefined : exactFoldCallbackRanges(expr);
  if (
    !unknown.every(
      (u) =>
        isSubtype(compilationType(u.operand), 'rational') &&
        exactFoldOperandFits(u.operand, callbackRanges)
    )
  )
    return undefined;
  const words = Math.ceil(digits / EXACT_FOLD_DIGITS_PER_WORD);
  if (!(bigOpIterations(expr) * words <= CONSTANT_FOLD_MAX_COST))
    return undefined;

  // The items of a result: the operands of a `List` or `Tuple`, the
  // elements of a finite indexed collection that `evaluate()` left lazy (a
  // `Filter` or `Map` over a range: `.N()` materializes it, `evaluate()`
  // does not), or the value itself.
  const allItems = (
    v: Expression,
    test: (x: Expression) => boolean
  ): boolean => {
    if (isFunction(v, 'List') || isFunction(v, 'Tuple'))
      return v.ops.every(test);
    if (v.isCollection) {
      const elements = foldableCollectionElements(
        v,
        CONSTANT_FOLD_MAX_INLINE_ELEMENTS
      );
      return elements !== undefined && elements.every(test);
    }
    return test(v);
  };
  const operands = new Set(
    unsafe.filter((u) => u.digits !== undefined).map((u) => u.operand)
  );
  // A copy of `node` where each operand in `unsafe` with a known digit
  // count is replaced by its exact value, or `undefined` when such an
  // operand is not an exact rational. The walk does not go into a replaced
  // operand. An operand in `unsafe` inside a replaced one was already
  // checked: the outer operand has a known digit count only if it has a
  // fold value, and its own fold was exact (this function) because the
  // inner operand is beyond the range. The walk goes into an operand with
  // an unknown digit count, which stays in the copy.
  let rational = true;
  const replace = (node: Expression): Expression => {
    if (!rational) return node;
    if (operands.has(node)) {
      const v = node.evaluate();
      rational = allItems(
        v,
        (x) => isNumber(x) && x.isExact && x.isRational === true
      );
      return v;
    }
    if (!isFunction(node)) return node;
    const ops = node.ops.map(replace);
    if (ops.every((op, i) => op === node.ops[i])) return node;
    return node.engine._fn(node.operator, ops, {
      canonical: node.isCanonical,
      scope: node.localScope,
    });
  };
  const replaced = replace(expr);
  if (!rational) return undefined;
  const v = replaced.evaluate();
  if (unknown.length > 0)
    return allItems(v, (x) => isNumber(x) && x.isExact && x.isRational === true)
      ? v.N()
      : undefined;
  if (isSymbol(v, 'True') || isSymbol(v, 'False')) return v;
  return allItems(v, (x) => isNumber(x) && x.isExact) ? v.N() : undefined;
}

/** Bound both parts of a rational before exact evaluation. A numeric range
 * bounds an integer's digits, but does not bound a rational's denominator.
 * Unsupported operations therefore decline rather than evaluate to find
 * their size. Each shared node is measured once in this binding context. */
export function exactFoldOperandFits(
  expr: Expression,
  callbackRanges?: ReadonlyMap<object, Type | undefined>
): boolean {
  type Size = { numerator: number; denominator: number };
  const memo = new Map<Expression, Size | undefined>();
  let visits = 0;
  const digits = (x: number | bigint): number =>
    typeof x === 'bigint'
      ? (x < 0n ? -x : x).toString().length
      : Math.max(1, Math.floor(Math.log10(Math.abs(x))) + 1);
  const typeOf = (node: Expression): Type =>
    (isSymbol(node) && node.valueDefinition !== undefined
      ? callbackRanges?.get(node.valueDefinition)
      : undefined) ?? compilationType(node);
  const bound = (node: Expression): Size | undefined => {
    if (memo.has(node)) return memo.get(node);
    if (++visits > CONSTANT_FOLD_MAX_VISITS) return undefined;
    // Install the decline first to stop a cyclic graph.
    memo.set(node, undefined);
    const result = measure(node);
    if (
      result !== undefined &&
      result.numerator <= EXACT_FOLD_MAX_DIGITS &&
      result.denominator <= EXACT_FOLD_MAX_DIGITS
    ) {
      memo.set(node, result);
      return result;
    }
    return undefined;
  };
  const measure = (node: Expression): Size | undefined => {
    if (isNumber(node)) {
      const rational = node.isExact ? asRational(node) : undefined;
      if (rational === undefined || rational === null) return undefined;
      return {
        numerator: digits(rational[0]),
        denominator:
          rational[1] === 1 || rational[1] === 1n ? 0 : digits(rational[1]),
      };
    }
    const t = typeOf(node);
    const range = numericRangeOf(t);
    if (
      isSubtype(t, 'integer') &&
      range !== undefined &&
      Number.isFinite(range.lower) &&
      Number.isFinite(range.upper)
    )
      return {
        numerator:
          digits(Math.max(Math.abs(range.lower), Math.abs(range.upper))) + 1,
        denominator: 0,
      };
    if (!isFunction(node)) return undefined;
    const ops = node.ops;
    const h = node.operator;
    if (h === 'Negate' || h === 'Abs' || h === 'Typed') return bound(ops[0]);
    if (h === 'Power' || h === 'Square') {
      const base = bound(ops[0]);
      const exponent =
        h === 'Square'
          ? { lower: 2, upper: 2 }
          : numericRangeOf(typeOf(ops[1]));
      if (
        base === undefined ||
        exponent === undefined ||
        (h === 'Power' && !isSubtype(typeOf(ops[1]), 'integer')) ||
        !Number.isFinite(exponent.lower) ||
        !Number.isFinite(exponent.upper)
      )
        return undefined;
      const magnitude = Math.max(
        Math.abs(exponent.lower),
        Math.abs(exponent.upper)
      );
      const numerator = Math.max(1, base.numerator * magnitude);
      const denominator = base.denominator * magnitude;
      // Negative exponents can exchange numerator and denominator.
      return exponent.lower < 0
        ? {
            numerator: Math.max(numerator, denominator),
            denominator: numerator,
          }
        : { numerator, denominator };
    }
    if (!['Add', 'Subtract', 'Multiply', 'Divide'].includes(h))
      return undefined;
    const sizes = ops.map(bound);
    if (sizes.some((s) => s === undefined) || sizes.length === 0)
      return undefined;
    const known = sizes as Size[];
    if (h === 'Multiply')
      return {
        numerator: known.reduce((sum, s) => sum + s.numerator, 0),
        denominator: known.reduce((sum, s) => sum + s.denominator, 0),
      };
    if (h === 'Divide') {
      if (known.length !== 2) return undefined;
      return {
        numerator: known[0].numerator + known[1].denominator,
        denominator: known[0].denominator + known[1].numerator,
      };
    }
    const denominator = known.reduce((sum, s) => sum + s.denominator, 0);
    return {
      numerator:
        Math.max(
          ...known.map((s) => s.numerator + denominator - s.denominator)
        ) +
        Math.ceil(Math.log10(known.length)) +
        1,
      denominator,
    };
  };
  return bound(expr) !== undefined;
}

/** A literal pipeline callback receives the elements of its source. Keep
 * that range as local evidence, keyed by the parameter binding, rather
 * than changing the function's declared type. Any use with an unknown
 * source, a parameter write, or an ordinary function-value use removes
 * the evidence for that binding. */
export function exactFoldCallbackRanges(
  expr: Expression
): ReadonlyMap<object, Type | undefined> {
  const ranges = new Map<object, Type | undefined>();
  const visited = [new Set<Expression>(), new Set<Expression>()];
  let visits = 0;
  let exhausted = false;
  const sourceRange = (source: Expression | undefined): Type | undefined => {
    if (isFunction(source, 'List')) {
      let lower = Infinity;
      let upper = -Infinity;
      const values = source._numericStore ?? source.ops;
      for (const item of values) {
        if (++visits > CONSTANT_FOLD_MAX_VISITS) {
          exhausted = true;
          return undefined;
        }
        const value =
          typeof item === 'number'
            ? item
            : isNumber(item) && item.isInteger === true
              ? item.re
              : NaN;
        if (!Number.isSafeInteger(value)) return undefined;
        lower = Math.min(lower, value);
        upper = Math.max(upper, value);
      }
      return lower <= upper
        ? makeNumericRangeType('integer', lower, upper)
        : undefined;
    }
    if (!isFunction(source, 'Range')) return undefined;
    const [a, b, step] = source.ops;
    if (
      !isNumber(a) ||
      !isNumber(b) ||
      a.isInteger !== true ||
      b.isInteger !== true ||
      !Number.isSafeInteger(a.re) ||
      !Number.isSafeInteger(b.re) ||
      (step !== undefined &&
        (!isNumber(step) ||
          step.isInteger !== true ||
          !Number.isSafeInteger(step.re) ||
          step.re === 0))
    )
      return undefined;
    return makeNumericRangeType(
      'integer',
      Math.min(a.re, b.re),
      Math.max(a.re, b.re)
    );
  };
  const record = (
    literal: Expression & FunctionInterface,
    sources: ReadonlyArray<Expression>
  ): void => {
    const writable = !parametersCanBeTyped(literal);
    literal.ops.slice(1).forEach((p, i) => {
      const symbol = isFunction(p, 'Typed') ? p.op1 : p;
      const binding = isSymbol(symbol) ? symbol.valueDefinition : undefined;
      if (binding === undefined) return;
      const type = writable ? undefined : sourceRange(sources[i]);
      if (!ranges.has(binding)) ranges.set(binding, type);
      else {
        const before = ranges.get(binding);
        ranges.set(
          binding,
          before === undefined || type === undefined
            ? undefined
            : widen(before, type)
        );
      }
    });
  };
  const visit = (node: Expression, callback = false): void => {
    if (!isFunction(node) || node._numericStore !== undefined) return;
    const seen = visited[callback ? 1 : 0];
    if (seen.has(node)) return;
    seen.add(node);
    if (++visits > CONSTANT_FOLD_MAX_VISITS) {
      exhausted = true;
      return;
    }
    if (isFunction(node, 'Function') && !callback) record(node, []);
    const ops = node.ops;
    if (node.operator === 'Map' || node.operator === 'Filter') {
      const callbackIndex = node.operator === 'Map' ? 0 : 1;
      const literal = ops[callbackIndex];
      if (isFunction(literal, 'Function')) {
        record(literal, node.operator === 'Map' ? ops.slice(1) : [ops[0]]);
        ops.forEach((op, i) => visit(op, i === callbackIndex));
        return;
      }
    }
    for (const op of ops) visit(op);
  };
  visit(expr);
  return exhausted ? new Map() : ranges;
}

/**
 * The repetition work of an exact fold: `Sum` and `Product` multiply their
 * nested body's work, and pipelines add their source work and the number
 * of callback invocations. A filter's input bounds its work even when it
 * keeps few elements. `Infinity` means there is no static bound.
 * A collection reducer adds its source work and its upper element count,
 * using `1` when that size is not static, as in `foldCostEstimate`.
 * For the cost of an exact fold (`exactFoldValue`).
 */
export function bigOpIterations(expr: Expression, depth = 0): number {
  if (!isFunction(expr) || expr._numericStore !== undefined) return 0;
  if (depth > CONSTANT_FOLD_MAX_DEPTH) return Infinity;
  const ops = expr.ops;
  if (
    (expr.operator === 'Map' || expr.operator === 'Filter') &&
    ops.length >= 2
  ) {
    const [callback, sources] =
      expr.operator === 'Map' ? [ops[0], ops.slice(1)] : [ops[1], [ops[0]]];
    let trips: number | undefined;
    let sourceWork = 0;
    for (const source of sources) {
      const size = exactFoldCollectionSize(source, depth + 1);
      if (size !== undefined && (trips === undefined || size < trips))
        trips = size;
      sourceWork += bigOpIterations(source, depth + 1);
    }
    if (trips === undefined) return Infinity;
    return (
      sourceWork + trips * Math.max(1, bigOpIterations(callback, depth + 1))
    );
  }
  let inner = 0;
  for (const op of ops) inner = Math.max(inner, bigOpIterations(op, depth + 1));
  if (expr.operator !== 'Sum' && expr.operator !== 'Product') return inner;
  if (ops.length === 1)
    return inner + (exactFoldCollectionSize(ops[0], depth + 1) ?? 1);
  const trips = bigOpTripCount(expr);
  if (trips === undefined) return Infinity;
  return trips * Math.max(1, inner);
}

/** An upper bound on pipeline output size without reading its count facet.
 * A filter can keep every input element; nested maps stop at the shortest
 * source. The actual survivor count could evaluate an expensive callback. */
export function exactFoldCollectionSize(
  expr: Expression,
  depth: number
): number | undefined {
  if (depth > CONSTANT_FOLD_MAX_DEPTH || !isFunction(expr)) return undefined;
  if (expr.operator === 'List' || expr.operator === 'Set') return expr.nops;
  if (expr.operator === 'Filter')
    return exactFoldCollectionSize(expr.op1, depth + 1);
  if (expr.operator === 'Map') {
    let size: number | undefined;
    for (const source of expr.ops.slice(1)) {
      const bound = exactFoldCollectionSize(source, depth + 1);
      if (bound !== undefined && (size === undefined || bound < size))
        size = bound;
    }
    return size;
  }
  return staticCollectionSize(expr, depth);
}

/**
 * Does `expr` mention a free symbol, or an impure operation, once every
 * assigned symbol value it reaches is looked through?
 *
 * `expr.unknowns` and `expr.isPure` both stop at a symbol that has a
 * value. `f8` with `f8 := f7 + 2 f7`, …, `f0 := x` reports no unknowns,
 * yet evaluating it yields `6561x`, never a literal: without this check
 * the constant fold evaluated such a subtree at every level of the chain
 * until its time budget expired — and the interpreter's cost on a value
 * that references another value from several places grows exponentially
 * with the depth of the chain — only to decline on the symbolic result
 * each time. And `r + r` with `r := Random()` reports pure, so the fold
 * baked ONE sample into the artifact where the interpreter draws two fresh
 * ones at every evaluation.
 *
 * Linear in the DISTINCT nodes reached: each node's answer is memoized by
 * identity for the compilation, so a value referenced from many places is
 * walked once. A value that refers to itself is answered `false` on
 * re-entry, which only lets the fold proceed to its usual gates.
 */
export function foldValueBlocked(expr: Expression): boolean {
  const memo = CompilerState._foldValueBlockedMemo;
  const cached = memo.get(expr);
  if (cached !== undefined) return cached;
  // Provisional answer for a re-entrant reference.
  memo.set(expr, false);
  let reaches = hasUnknowns(expr) || !expr.isPure;
  if (!reaches) {
    const engine = expr.engine;
    // A node object at several positions of the tree is visited once: a
    // node seen before answered `false`, since a `true` ends the visit.
    const seen = new Set<Expression>();
    const visit = (node: Expression): boolean => {
      if (seen.has(node)) return false;
      seen.add(node);
      if (isSymbol(node)) {
        const v = engine._getSymbolValue(node.symbol);
        return v !== undefined && foldValueBlocked(v);
      }
      if (isDictionary(node)) {
        for (const v of node.values) if (visit(v)) return true;
        return false;
      }
      if (isFunction(node)) {
        for (const op of node.ops) if (visit(op)) return true;
      }
      return false;
    };
    reaches = visit(expr);
  }
  memo.set(expr, reaches);
  return reaches;
}

/**
 * True when `expr` applies a function whose result jumps at a point
 * (`JUMP_FUNCTIONS`: `Floor`, `Fract`, `Mod`, the comparisons, …) to
 * operands that are closed exact numbers.
 *
 * The structural code of such a node computes its operands as doubles. The
 * double of an exact operand can be on the other side of the jump from the
 * exact value: `Floor((25! − 1)/24!)` is 24, but the operand's double is
 * 25.0; `Fract(π·10³⁰)` is 0.50288…, but the double of `π·10³⁰` is an
 * integer, so its fractional part is 0. `.N()` reads the exact value of an
 * exact operand for these functions (`exactRoundingOperand` in
 * `library/arithmetic.ts`), so the constant fold, which evaluates with
 * `.N()`, gives the interpreter's value. This predicate admits such a node
 * to the fold also under `constantFold: false` and under a `symbolDeps`
 * capture, where other constant subtrees keep their structural code.
 *
 * Each condition:
 * - no free variable: an operand with one is computed at run time, and its
 *   code is not changed;
 * - every operand is a number (a comparison of collections or strings
 *   is not a jump at a point);
 * - no inexact (float) number literal in the node: an operand with a float
 *   is approximate in the interpreter too, so the structural code is kept;
 * - not every operand is an integer literal in the safe integer range: the
 *   double of such a literal is exact, so the structural code gives the
 *   exact value and is kept (`Floor(3)` stays `Math.floor(3)`);
 * - not the interval target, which never bakes a `.N()` point: its code
 *   computes an enclosure, and the enclosure of a jump at a point is
 *   reported as `singular`, which contains the exact value.
 */
export function closedExactJump(
  expr: Expression,
  target: CompileTarget<Expression>
): boolean {
  if (!isFunction(expr) || !JUMP_FUNCTIONS.has(expr.operator)) return false;
  if (target.language === 'interval-javascript') return false;
  if (expr.unknowns.length > 0) return false;
  if (!expr.ops.every((op) => isSubtype(compilationType(op), 'number')))
    return false;
  if (
    expr.ops.every(
      (op) =>
        isNumber(op) &&
        typeof op.numericValue === 'number' &&
        Number.isSafeInteger(op.numericValue)
    )
  )
    return false;
  // The walk visits each node once. An expression can share a subtree
  // between operands: `Add(e, e)` applied n times to its own result has
  // n + 1 distinct nodes but 2ⁿ paths from the root, and this check runs
  // before the fold's cost estimate and also under `constantFold: false`.
  // A node seen again answers `false`: had it held a float, the walk would
  // have stopped at the first visit.
  // The pole `ComplexInfinity` (`1/0`) is not exact, but it is not a
  // float approximation either: it is a value with no order, and the
  // interpreter decides a comparison with it (`0 < 1/0` and `1/0 = 1/0`
  // are `False`). The structural code of the pole is the double
  // `Infinity`, which has an order (`0 < Infinity` is `true`), so a
  // comparison with the pole folds. Only a comparison: the fold of
  // `Floor(1/0)` would not change its value.
  const isComparison = BRANCH_RELATIONS.has(expr.operator);
  const seen = new Set<Expression>();
  const hasFloat = (node: Expression): boolean => {
    if (seen.has(node)) return false;
    seen.add(node);
    if (isNumber(node))
      return (
        !node.isExact &&
        !(isComparison && node.isFinite === false && node.isComplex)
      );
    if (isFunction(node)) return node.ops.some(hasFloat);
    return false;
  };
  return !hasFloat(expr);
}

/** The rounding functions that `jumpShiftRewrite` applies to. */
export const SHIFT_JUMP_HEADS: ReadonlySet<string> = new Set([
  'Floor',
  'Ceil',
  'Round',
  'Truncate',
  'Fract',
]);

/**
 * An equivalent form of a rounding function (`Floor`, `Ceil`, `Round`,
 * `Truncate`, `Fract`) whose operand mixes a variable with an exact
 * constant that no double holds exactly, or `undefined` when `expr` is not
 * such a node. Throws a `CompileDeclineError` when such a node has no
 * equivalent form.
 *
 * The structural code computes the constant as a double, and the rounding
 * can then go to the other side of the jump: the double of
 * `c = (25! − 1)/24!` is 25.0, so `Floor(k + c)` at the integer `k = 1`
 * gives 26, where the exact value is 25. When the operand is `v + c`, with
 * `v` integer-typed (a loop index, an integer-typed variable, a sum of
 * them with integer coefficients) and `c` the closed terms, the rounding
 * commutes with the integer shift `v`:
 * - `Floor(v + c) = v + Floor(c)` and `Ceil(v + c) = v + Ceil(c)`;
 * - `Fract(v + c) = Fract(c)`, since `Fract(x)` is `x − Floor(x)`;
 * - `Round(v + c) = v + Round(c)` when `c` is not halfway between two
 *   integers: away from a tie, `Round(x)` is `Floor(x + 1/2)`. At a tie the
 *   result depends on the tie rule (`ce.roundingTies`), and most rules are
 *   not shift-invariant (to even, away from zero, toward zero), so a `c`
 *   at or near a tie declines;
 * - `Truncate` is not shift-invariant across 0 (`Truncate(−3 + 1/2)` is
 *   −2, but `−3 + Truncate(1/2)` is −3). `Truncate(x)` is `Floor(x)` for
 *   `x ≥ 0` and `Ceil(x)` for `x < 0`, and for an integer `v`,
 *   `v + c ≥ 0` exactly when `v ≥ −Floor(c)`. So `Truncate(v + c)` is
 *   `If(v ≥ −Floor(c), v + Floor(c), v + Ceil(c))`.
 * Each rounded constant is a closed exact jump node, which the constant
 * fold computes with the exact value (`closedExactJump`).
 *
 * Every other shape whose variables are all integer-typed declines: a sum
 * whose variable part is not integer-typed (`Floor(k/3 + c)`), a product
 * (`Floor(k·π)`), a constant inside a variable term (`Floor(k·√2 + 1)`),
 * a step form (`Floor(k + c, 2)`), a `Round` whose constant may be a tie.
 *
 * A shape with a variable that is not integer-typed (a real `x`) keeps its
 * structural code: `Floor(x + 1/3)`, `Floor(π·x)`, `Floor(x/√2)`, and also
 * `Floor(k + x + c)` with an integer `k`. The double of the constant can
 * move the jump by about one unit in the last place of the operand, as in
 * any float code, and the jump of such an operand is not at a point that
 * an integer input hits exactly. So `Floor(x + (25! − 1)/24!)` at `x = 1`
 * gives 26, where the interpreter gives 25. The walk that looks for such a
 * variable stops at an integer-typed subtree (`k`, `2k + m`). `Floor(x)`
 * for a real `x` is typed `integer | infinity`, not `integer`, so the walk
 * goes into it, and `Floor(Floor(x) + c)` keeps its structural code.
 *
 * The constants that do not trigger this: a literal that a double holds
 * exactly (an integer within the reach of the significand, a rational
 * with a power-of-two denominator: `Floor(k + 1/2)` keeps its structural
 * code), and a rational factor of a product whose numerator and
 * denominator are such integers, because the targets emit it as a
 * division and a multiplication by those integers (`Floor(2k/3)` is
 * `Math.floor(k / 3 * 2)`), which round the exact integer quotient
 * correctly. A symbol is judged by its assigned value. A rounding node
 * inside the operand is judged on its own, not as a part of this one.
 *
 * Nothing changes for an operand with a float literal (the interpreter
 * computes such an operand approximately too), for a closed operand (the
 * constant fold handles it), and on an interval target, whose code
 * computes an enclosure that contains the exact value. Nothing changes
 * either for a node with an effect (`Floor(k + Random())`), or when the
 * caller replaced the lowering of an operator the identities use or of a
 * name in the operand: the structural code is kept.
 */
export function jumpShiftRewrite(
  expr: Expression,
  target: CompileTarget<Expression>
): Expression | undefined {
  if (!isFunction(expr)) return undefined;
  const head = expr.operator;
  if (!SHIFT_JUMP_HEADS.has(head)) return undefined;
  if (target.language?.startsWith('interval')) return undefined;
  if (expr.unknowns.length === 0) return undefined;
  if (!expr.ops.every((op) => isSubtype(compilationType(op), 'number')))
    return undefined;
  // A node with an effect anywhere (`Random()`, `10·Random()`) is left
  // alone. The rewrite would compute the closed terms more than once (the
  // `Truncate` form uses the constant three times), evaluate them at
  // compile time to choose a form (the tie test of `Round`), or drop the
  // integer terms (`Fract(v + c)` is `Fract(c)`). Each of these changes the
  // number of effects or the value.
  if (!expr.isPure) return undefined;
  // The identities hold for the semantics of the engine's operators. A
  // caller can replace the lowering of an operator (the `functions` and
  // `operators` compile options) or of a symbol (a string `vars` entry),
  // and the rewritten form would then route the constant through that
  // lowering in a different shape: with a custom `Floor` lowering that
  // gives 42, `Floor(k + 1/3)` must give 42, not `k + 42`. So the rewrite
  // is skipped when the caller replaced the rounding functions, the
  // arithmetic operators, the operators of the `Truncate` form, or any
  // operator or symbol of the operand. The compilation records which
  // names the caller replaced on the CSE session (`openCseSession`), also
  // when CSE is disabled. When it recorded nothing (a direct custom target,
  // whose lowerings are all the caller's), the rewrite is skipped too.
  const provenance = target.cse?.harvestOptions;
  if (provenance === undefined) return undefined;
  const overridden = (name: string): boolean =>
    provenance.isOverriddenOperator?.(name) === true;
  if (
    [
      ...SHIFT_JUMP_HEADS,
      'Add',
      'Multiply',
      'Negate',
      'Subtract',
      'Divide',
      'If',
      'GreaterEqual',
    ].some(overridden)
  )
    return undefined;
  const callerSeen = new Set<Expression>();
  const callerSupplied = (node: Expression): boolean => {
    if (callerSeen.has(node)) return false;
    callerSeen.add(node);
    if (isSymbol(node)) return provenance.isStringVar?.(node.symbol) === true;
    if (isFunction(node))
      return overridden(node.operator) || node.ops.some(callerSupplied);
    return false;
  };
  if (expr.ops.some(callerSupplied)) return undefined;
  const engine = expr.engine;

  // A node with a variable that is not integer-typed is left alone. An
  // open subtree that is integer-typed (`k`, `2k + m`, `Floor(k/3)`) counts
  // as an integer, so the walk does not go into it. Each node is visited
  // once, since an expression can share a subtree between operands.
  const realSeen = new Set<Expression>();
  const hasRealVariable = (node: Expression): boolean => {
    if (realSeen.has(node)) return false;
    realSeen.add(node);
    if (node.unknowns.length === 0) return false;
    if (isSubtype(compilationType(node), 'integer')) return false;
    if (isSymbol(node)) return true;
    if (isFunction(node)) return node.ops.some(hasRealVariable);
    return false;
  };
  if (expr.ops.some(hasRealVariable)) return undefined;

  // A node with a float literal anywhere is left alone. The walk visits
  // each node once, since an expression can share a subtree between
  // operands.
  const floatSeen = new Set<Expression>();
  const hasFloat = (node: Expression): boolean => {
    if (floatSeen.has(node)) return false;
    floatSeen.add(node);
    if (isNumber(node)) return !node.isExact;
    if (isFunction(node)) return node.ops.some(hasFloat);
    return false;
  };
  if (hasFloat(expr)) return undefined;

  // Whether the value of the closed node `node` is held exactly by a
  // double. A node that is not a number literal (a symbol with a value,
  // `Factorial(10)`) is judged by its exact value, when its evaluation is
  // pure and within the work budget of the constant fold; otherwise it
  // counts as a constant that no double holds.
  const doubleExact = (node: Expression): boolean => {
    const literal = (n: Expression): boolean => {
      if (!isNumber(n) || !n.isExact) return false;
      const nv = n.numericValue;
      return typeof nv === 'number' || exactDoubleValue(nv) !== undefined;
    };
    if (isNumber(node)) return literal(node);
    if (
      !node.isPure ||
      !(core.foldCostEstimate(node) <= CONSTANT_FOLD_MAX_COST)
    )
      return false;
    return literal(node.evaluate());
  };
  // A rational literal `p/q` whose `p` and `q` are integers that a double
  // holds: as a factor of a product, it is emitted as a division by `q`
  // and a multiplication by `p`.
  const divisionFactor = (node: Expression): boolean => {
    if (!isNumber(node)) return false;
    const nv = node.numericValue;
    if (typeof nv === 'number' || !nv.isExact || nv.im !== 0) return false;
    return [nv.numerator, nv.denominator].every((part) =>
      Number.isSafeInteger(exactDoubleValue(part) ?? Number.NaN)
    );
  };

  // The maximal closed subtrees of the operands that no double holds.
  // A closed node is judged at each of its positions, since the answer
  // depends on the parent (a rational is excused as a factor of a
  // product only): an expression can share one `1/3` object between a
  // product factor and a term of the sum. The open nodes, whose answer
  // does not depend on the parent, are visited once each.
  const risky: Expression[] = [];
  const seen = new Set<Expression>();
  const exactMemo = new Map<Expression, boolean>();
  const visit = (node: Expression, parent: Expression): void => {
    if (node.unknowns.length === 0) {
      // A constant that is not real (`i`, `1 + i`) is not compared with
      // the jumps of the real line here: the real-only gate of the head
      // judges an operand that may be complex.
      if (!isSubtype(compilationType(node), 'real')) return;
      let exact = exactMemo.get(node);
      if (exact === undefined) {
        exact = doubleExact(node);
        exactMemo.set(node, exact);
      }
      if (exact) return;
      if (isFunction(parent, 'Multiply') && divisionFactor(node)) return;
      if (!risky.includes(node)) risky.push(node);
      return;
    }
    if (seen.has(node)) return;
    seen.add(node);
    if (!isFunction(node)) return;
    if (SHIFT_JUMP_HEADS.has(node.operator)) return;
    for (const op of node.ops) visit(op, node);
  };
  for (const op of expr.ops) visit(op, expr);
  if (risky.length === 0) return undefined;

  const decline = (reason: string): never => {
    throw new CompileDeclineError({
      code: 'inexact-jump-operand',
      kind: 'correctness',
      message:
        `Could not compile \`${expr.toString()}\`: its operand combines a ` +
        `variable with the exact constant \`${risky[0].toString()}\`, ` +
        `which no double holds exactly, and ${reason}. The compiled code ` +
        `would compute the constant as a double, and the rounding could ` +
        `go to the other side of the jump of \`${head}\`.`,
    });
  };

  const x = expr.op1;
  if (expr.nops !== 1 || !isFunction(x, 'Add'))
    return decline('the operand is not a sum of the constant and an integer');
  const closed = x.ops.filter((t) => t.unknowns.length === 0);
  const open = x.ops.filter((t) => t.unknowns.length > 0);
  if (!risky.every((r) => closed.includes(r)))
    return decline('the constant is inside a variable term of the operand');
  if (!open.every((t) => isSubtype(compilationType(t), 'integer')))
    return decline('the variable part of the operand is not an integer');

  const S = { form: 'structural' } as const;
  const sum = (terms: ReadonlyArray<Expression>): Expression =>
    terms.length === 1 ? terms[0] : engine.function('Add', [...terms], S);
  const v = sum(open);
  const c = sum(closed);
  const round = (h: string): Expression => engine.function(h, [c], S);
  // Whether `c` is halfway between two integers, or may be: `true` unless
  // that is excluded. `.N()` reads the exact value of an exact operand of
  // `Fract`, so a fractional part that is not near 1/2 excludes a tie. Near
  // 1/2, the exact value decides: an exact rational is a tie exactly when
  // its reduced denominator is 2, and an exact number that is not rational
  // (a radical) is never a tie. A constant with no exact value (a
  // transcendental) near a tie counts as a tie.
  const isTie = (): boolean => {
    const f = round('Fract').N().re;
    if (!Number.isFinite(f)) return true;
    if (Math.abs(f - 0.5) >= 1e-9) return false;
    const value = c.evaluate();
    if (!isNumber(value) || !value.isExact) return true;
    const nv = value.numericValue;
    if (typeof nv === 'number') return false;
    if (!isSubtype(compilationType(value), 'rational')) return false;
    return exactDoubleValue(nv.denominator) === 2;
  };
  switch (head) {
    case 'Floor':
    case 'Ceil':
      return engine.function('Add', [v, round(head)], S);
    case 'Fract':
      return round('Fract');
    case 'Round': {
      if (isTie())
        return decline('the constant may be halfway between two integers');
      return engine.function('Add', [v, round('Round')], S);
    }
    case 'Truncate': {
      const floor = round('Floor');
      return engine.function(
        'If',
        [
          engine.function(
            'GreaterEqual',
            [v, engine.function('Negate', [floor], S)],
            S
          ),
          engine.function('Add', [v, floor], S),
          engine.function('Add', [v, round('Ceil')], S),
        ],
        S
      );
    }
  }
  return undefined;
}

/**
 * Record in `deps` the engine state that the evaluation of `expr` reads,
 * for a closed exact jump node folded under a `symbolDeps` capture (see
 * `closedExactJump`). The capture set is the cache key of an implicit
 * compilation: a symbol in it causes a recompilation when the symbol is
 * assigned again. An evaluation has no hook that reports each read, so
 * the reads are found by a walk: every symbol of `expr` is recorded, and
 * the value of each one is walked in turn.
 *
 * Returns `false` (and records nothing) when a read cannot be found by the
 * walk: a function head that is not the library's own operator (a user
 * function reads its body, which the walk does not enter), or a node that
 * is not a symbol, a function, a number or a string.
 */
export function recordJumpFoldReads(
  expr: Expression,
  deps: Set<MathJsonSymbol>
): boolean {
  const engine = expr.engine;
  const read = new Set<MathJsonSymbol>();
  // The walk visits each node once, since an expression can share a
  // subtree between operands (n + 1 distinct nodes can have 2ⁿ paths from
  // the root). A node seen again answers `true`: had it answered `false`,
  // the walk would have stopped at the first visit.
  const seen = new Set<Expression>();
  const visit = (node: Expression): boolean => {
    if (seen.has(node)) return true;
    seen.add(node);
    if (isSymbol(node)) {
      if (read.has(node.symbol)) return true;
      read.add(node.symbol);
      const value = engine._getSymbolValue(node.symbol);
      return value === undefined || visit(value);
    }
    if (isFunction(node)) {
      if (builtinOperatorDefinition(engine, node.operator) === undefined)
        return false;
      return node.ops.every(visit);
    }
    return isNumber(node) || isString(node);
  };
  if (!visit(expr)) return false;
  for (const id of read) deps.add(id);
  return true;
}

/**
 * The cost of ONE application of `operand` as a callback, for the
 * higher-order arm of `foldCostEstimate`, or `undefined` when `operand` is
 * not a callback. A callback is a function literal (`x ↦ x^2`), or the
 * name of a user function or of a library operator (`IsPrime`). One
 * application costs the call node, its argument and the body.
 */
export function callbackApplicationCost(
  operand: Expression,
  depth: number,
  c: FoldCostContext
): number | undefined {
  if (isFunction(operand, 'Function'))
    return 2 + core.foldCostEstimate(operand.ops[0], depth + 1, c);
  if (!isSymbol(operand)) return undefined;
  const engine = operand.engine;
  const name = operand.symbol;
  if (userFunctionLiteral(engine, name) !== undefined)
    return 2 + calleeBodyCost(engine, name, depth, c);
  const def = engine.lookupDefinition(name);
  if (def !== undefined && isOperatorDef(def)) return 2;
  return undefined;
}

/**
 * The cost of the BODY of the user function `name` for one call, for
 * `foldCostEstimate`: `0` when `name` is not a user function (a library
 * operator, a free symbol), `Infinity` when the function is recursive (it
 * has no static bound).
 */
export function calleeBodyCost(
  engine: ComputeEngine,
  name: string,
  depth: number,
  c: FoldCostContext
): number {
  const literal = userFunctionLiteral(engine, name);
  if (literal === undefined || !isFunction(literal) || literal.ops.length === 0)
    return 0;
  const cached = c.cache.get(name);
  // A genuine CACHE, not merely a cycle guard. Without it the name was
  // added to a set for the duration of one expansion and removed on the
  // way out, so a function called from N sibling positions was re-walked
  // N times, independently, at every level — the estimator was
  // exponential in the call graph while its own docstring claimed it was
  // linear.
  if (cached !== undefined) return cached;
  if (c.inProgress.has(name)) return Infinity; // recursive: no static bound
  c.inProgress.add(name);
  const cost = core.foldCostEstimate(literal.ops[0], depth + 1, c);
  c.inProgress.delete(name);
  // Only a settled answer is cached. An `Infinity` reached because the
  // VISIT BUDGET ran out is a property of this walk, not of the
  // function, so caching it would make the estimate depend on where the
  // walk started — the very order-dependence this design removes.
  if (Number.isFinite(cost)) c.cache.set(name, cost);
  return cost;
}

/**
 * The number of iterations a `Sum`/`Product` node performs, or `undefined`
 * when it has no statically resolvable count (a symbolic or non-finite
 * bound, an `Element` domain, a multi-index form). Used only by
 * `foldCostEstimate`, where `undefined` means "decline".
 */
/**
 * The element count a collection-valued expression yields, when it is
 * statically resolvable, for `foldCostEstimate`'s pipeline pricing.
 * `undefined` means "no static size", which the caller turns into a
 * decline.
 *
 * Only the shapes whose size is readable from the SYNTAX are answered — a
 * literal `List`/`Set`, a `Range` with literal bounds, and the bounding
 * consumers `Take`/`Drop` — because the point is to price the walk without
 * performing it. Anything else (a symbolic bound, an infinite range, a
 * `Filter` whose survivor count is only known by running it) declines, so
 * the estimate never under-reports the work.
 */
export function staticCollectionSize(
  expr: Expression,
  depth: number
): number | undefined {
  if (depth > CONSTANT_FOLD_MAX_DEPTH) return undefined;
  if (!isFunction(expr)) return undefined;
  const ops = expr.ops;
  if (expr.operator === 'List' || expr.operator === 'Set') return ops.length;
  if (expr.operator === 'Range') {
    // Read the bounds WITHOUT rounding. `bigOpBoundConstant` floors, which
    // is right for an integer iteration index but wrong here: a `Range`
    // takes a real step, and flooring turned `Range(1, 100000, 0.5)` into
    // step `0`, so the size read as unknown and the pipeline was priced as
    // a single element — it folded in 984 ms, back within reach of the
    // anti-hang deadline this estimate exists to keep out of the decision.
    const lo = ops.length > 1 ? realBoundOf(ops[0]) : 1;
    const hi = realBoundOf(ops.length > 1 ? ops[1] : ops[0]);
    const step = ops.length > 2 ? realBoundOf(ops[2]) : undefined;
    if (lo === undefined || hi === undefined) return undefined;
    const s = step ?? (hi >= lo ? 1 : -1);
    if (s === 0 || !Number.isFinite(s)) return undefined;
    // A step pointing away from the stop yields an empty range, not a
    // negative count (`rangeCount` returns 0 for it).
    const n = rangeCount(lo, hi, s);
    return Number.isFinite(n) ? n : undefined;
  }
  // A bounding consumer caps its source: `Take(xs, n)` keeps at most `|n|`
  // elements. A negative count counts from the end (`Take(xs, -2)` is the
  // last two elements, `Drop(xs, -2)` is `xs` without them), so both sizes
  // depend on the magnitude of the count only.
  if (expr.operator === 'Take' && ops.length >= 2) {
    const n = core.bigOpBoundConstant(ops[1]);
    if (n === undefined) return undefined;
    const src = staticCollectionSize(ops[0], depth + 1);
    return src === undefined ? Math.abs(n) : Math.min(src, Math.abs(n));
  }
  if (expr.operator === 'Drop' && ops.length >= 2) {
    const src = staticCollectionSize(ops[0], depth + 1);
    const n = core.bigOpBoundConstant(ops[1]);
    if (src === undefined || n === undefined) return undefined;
    return Math.max(0, src - Math.abs(n));
  }
  // A unary `Map` preserves its source's length; the zipWith form
  // `Map(f, xs, ys, …)` is as long as its SHORTEST source. A source whose
  // size is unresolvable can only make the result shorter, so the minimum
  // over the resolvable sources is still a bound the cost estimate can
  // price by; with no resolvable source there is no bound at all.
  if (expr.operator === 'Map' && ops.length >= 2) {
    let min: number | undefined = undefined;
    for (const source of ops.slice(1)) {
      const n = staticCollectionSize(source, depth + 1);
      if (n !== undefined && (min === undefined || n < min)) min = n;
    }
    return min;
  }
  return undefined;
}

/**
 * The exact finite real value of a `Range` bound or step, or `undefined`.
 *
 * Distinct from `bigOpBoundConstant`, which FLOORS: that is correct for an
 * integer iteration index, but a `Range` step is a real, and flooring
 * `0.5` to `0` silently reports "no static size". Shares the same safety
 * conditions — a name bound by an enclosing binder has no compile-time
 * value, and a nonzero imaginary part leaves no ordering.
 */
export function realBoundOf(expr: Expression | undefined): number | undefined {
  if (expr === undefined) return undefined;
  if (mentionsCompileBoundName(expr)) return undefined;
  const im = expr.im;
  if (!Number.isNaN(im) && im !== 0) return undefined;
  const re = expr.re;
  return Number.isFinite(re) ? re : undefined;
}

export function bigOpTripCount(expr: Expression): number | undefined {
  if (!isFunction(expr)) return undefined;
  const indexes = expr.ops.slice(1);
  if (indexes.length !== 1) return undefined;
  const limits = indexes[0];
  if (!isFunction(limits, 'Limits')) return undefined;
  const lower = core.bigOpBoundConstant(limits.op2);
  const upper = core.bigOpBoundConstant(limits.op3);
  if (lower === undefined || upper === undefined) return undefined;
  // Both bounds arrive already floored from `bigOpBoundConstant` — which is
  // what `normalizeIndexingSet` does to a Sum/Product index as well — so the
  // count is a plain difference. Spelling it `ceil(lower)`, the textbook
  // form for UNROUNDED real bounds, would read as a floor/ceil asymmetry
  // that does not exist here, and could not round anything if it did.
  const trips = upper - lower + 1;
  if (!Number.isFinite(trips)) return undefined;
  return Math.max(0, trips);
}

/**
 * The elements of a constant collection VALUE as number literals, ready to
 * inline — or `undefined` when it is not a foldable collection, which is the
 * common case and leaves the caller's number/boolean handling to run.
 *
 * Requirements, each with a reason:
 * - **finite** and **indexed**: an infinite collection cannot be inlined at
 *   all, and a non-indexed one (a `Set`) has no defined element ORDER, so a
 *   literal list would fix an order the source never promised;
 * - **within the inline cap** (`maxInlineElements`, the target's own limit
 *   — see `CONSTANT_FOLD_MAX_INLINE_ELEMENTS` for the default), checked
 *   against the `count` facet BEFORE walking so an oversized collection
 *   costs nothing, and again during the walk because `count` is a facet
 *   while the walk is the truth;
 * - **every element a number literal**: strings, nested collections, tuples
 *   (a point list) and symbolic elements decline. Each element is emitted
 *   through the target's ordinary number path, so this keeps the folded
 *   list to values that path already vets.
 */
export function foldableCollectionElements(
  value: Expression,
  maxElements: number
): Expression[] | undefined {
  if (value.isFiniteCollection !== true) return undefined;
  if (value.isIndexedCollection !== true) return undefined;
  const count = smallCount(value);
  if (count === undefined || count > maxElements) return undefined;
  const elements: Expression[] = [];
  for (const element of value.each()) {
    if (!isNumber(element)) return undefined;
    if (elements.length > maxElements) return undefined;
    elements.push(element);
  }
  return elements;
}

/**
 * Emit an already-computed folded VALUE through the target's ordinary
 * lowering, so each target's own spelling applies. A value the target cannot
 * represent throws — decline, and let the structural lowering produce its
 * own (equivalent) failure.
 *
 * `_emittingFoldedValue` makes this re-entry safe. The emission compiles a
 * value that is itself a candidate — a folded `List` is a pure, constant,
 * collection-typed function node, so `tryConstantFold` would evaluate it,
 * materialize the same elements, and compile another `List`, forever. The
 * flag turns folding off for the duration; the value being emitted is
 * already fully evaluated, so there is nothing left to fold inside it.
 */
export function emitFoldedValue(
  value: Expression,
  target: CompileTarget<Expression>,
  prec: number
): TargetSource | undefined {
  const saved = CompilerState._emittingFoldedValue;
  CompilerState._emittingFoldedValue = true;
  try {
    return core.compile(value, target, prec);
  } catch (e) {
    // Same discrimination the evaluation's own catch applies: a failure
    // here normally means "this target cannot represent that literal", a
    // quiet decline. But a cancellation raised because the AMBIENT (outer)
    // deadline expired must keep cancelling the whole compilation rather
    // than being absorbed as a fold miss. That matters more for a folded
    // COLLECTION than it did for a single number: emission recurses through
    // `compile()` for every element, so there is real work — and real
    // surface for an unrelated codegen defect — running under this catch.
    if (!value.engine._shouldContinueExecution()) throw e;
    return undefined;
  } finally {
    CompilerState._emittingFoldedValue = saved;
  }
}

/**
 * Refuse a `Sum`/`Product` whose bounds have a compile-time value that does
 * not floor to a safe integer (magnitude above 2^53 − 1). At such a value
 * `k++` does not change `k`, so an unrolled clause would add terms forever
 * at compile time, and a loop would never end at run time. The interpreter
 * answers `out-of-range` for the same bounds, so the compile declines with
 * the same code.
 *
 * The bounds are read with `bigOpBoundValue`, not `bigOpBoundConstant`: the
 * second answers `undefined` for a folded value that is not a safe integer
 * (`2^{53}`, `10^{20}`), which a caller then reads as "not a constant" and
 * emits as a loop.
 */
export function assertSafeBigOpBounds(
  kind: string,
  bounds: ReadonlyArray<Expression | undefined>,
  target?: CompileTarget<Expression>
): void {
  for (const expr of bounds) {
    const value = bigOpBoundValue(expr, target);
    if (value !== undefined && !Number.isSafeInteger(Math.floor(value)))
      throw new Error(
        `Could not compile \`${kind}\`: out-of-range, a bound with magnitude at most ${Number.MAX_SAFE_INTEGER} (got ${value})`
      );
  }
}

/**
 * The finite compile-time real value of a `Sum`/`Product` bound, before the
 * floor and with no safe-integer test, or `undefined` when the bound has no
 * compile-time value (it mentions a compile-bound name or an excluded name,
 * it is not real, it is not finite, or it does not fold). With a target,
 * a bound that is not a number literal is folded with `foldedRealNumber`.
 * The folded value is only read, never emitted, so the fold runs even on a
 * target that sets `constantFold: false` (the interval target does): there
 * a bound `2^{53}` would otherwise be found only by the run-time guard.
 */
export function bigOpBoundValue(
  expr: Expression | undefined,
  target?: CompileTarget<Expression>
): number | undefined {
  if (expr === undefined) return undefined;
  if (mentionsCompileBoundName(expr)) return undefined;
  if (
    target?.boundVars !== undefined &&
    mentionsExcludedName(expr, target.boundVars, undefined)
  )
    return undefined;
  const im = expr.im;
  if (!isNaN(im) && im !== 0) return undefined;
  let re = expr.re;
  if (isNaN(re) && target !== undefined)
    re =
      foldedRealNumber(expr, {
        ...target,
        constantFold: undefined,
      }) ?? NaN;
  return Number.isFinite(re) ? re : undefined;
}

/** A real scalar accepted by the ordinary constant-fold emission gates. */
export function foldedRealNumber(
  expr: Expression,
  target: CompileTarget<Expression>
): number | undefined {
  if (target.constantFold === false) return undefined;
  if (
    target.boundVars !== undefined &&
    mentionsExcludedName(expr, target.boundVars, undefined)
  )
    return undefined;
  const value = core.constantFoldValue(expr, target)?.value;
  return value !== undefined &&
    isNumber(value) &&
    !value.isComplex &&
    !core.isComplexValued(expr)
    ? value.re
    : undefined;
}

/**
 * Drop every memoized complexness answer, at every layer.
 *
 * For WHOLESALE context changes: the compilation boundary (engine symbol
 * values may differ) and a `_boundVarsCtx` swap (not a lexical push, so
 * layering does not model it). Lexical enter/exit uses
 * `_pushComplexMemoLayer`/`_popComplexMemoLayer` instead; an in-place
 * mutation of the CURRENT frame uses `_resetComplexMemoTop`. Every context
 * mutation goes through one of these — routed via the helpers below
 * (`_pushLocalComplex`/`_popLocalComplex`/`_setLocalComplex`,
 * `withBinderMask`, `withLocalShapeFrame`) and `compile()`'s
 * `_boundVarsCtx` sync — so no new call site has to remember.
 */
export function _invalidateComplexMemo(): void {
  CompilerState._complexMemoStack = [new WeakMap()];
  CompilerState._elementLaneMemoStack = [new WeakMap()];
}

/**
 * True when the parameters of `literal` can be typed again for an
 * emission: each one is a plain name (not a rest parameter, not a
 * destructuring pattern), and the body never assigns one. A typed
 * parameter also checks each assignment to it, so typing it would change
 * what an assignment in the body does.
 */
export function parametersCanBeTyped(
  literal: Expression & FunctionInterface
): boolean {
  const params = literal.ops.slice(1);
  if (params.some((p) => isRestParameter(p) || isDestructuringParameter(p)))
    return false;
  const names = new Set(params.map(functionLiteralParameterName));
  const visited = new Set<Expression>();
  const writes = (expr: Expression): boolean => {
    if (
      !isFunction(expr) ||
      expr._numericStore !== undefined ||
      visited.has(expr)
    )
      return false;
    visited.add(expr);
    return (
      (expr.operator === 'Assign' &&
        expr.op1.symbols.some((name) => names.has(name))) ||
      expr.ops.some(writes)
    );
  };
  return !writes(literal.op1);
}

/**
 * The bounds of a real numeric type that carries a range: a ranged type
 * (`integer<1..16>`, `real<0..>`) or the type of a number literal (`3`).
 * `undefined` for any other type, and for a type with no finite bound.
 */
export function numericRangeOf(t: Type):
  | {
      tier: NumericPrimitiveType;
      lower: number;
      upper: number;
      lowerOpen: boolean;
      upperOpen: boolean;
    }
  | undefined {
  if (typeof t === 'string') return undefined;
  if (t.kind === 'value') {
    const v = t.value;
    if (typeof v !== 'number' || !Number.isFinite(v)) return undefined;
    return {
      tier: Number.isInteger(v) ? 'integer' : 'real',
      lower: v,
      upper: v,
      lowerOpen: false,
      upperOpen: false,
    };
  }
  if (t.kind !== 'numeric' || !isSubtype(t, 'real')) return undefined;
  const lower = t.lower ?? -Infinity;
  const upper = t.upper ?? Infinity;
  if (!Number.isFinite(lower) && !Number.isFinite(upper)) return undefined;
  return {
    tier: t.type,
    lower,
    upper,
    lowerOpen: t.lowerOpen === true,
    upperOpen: t.upperOpen === true,
  };
}

/**
 * Does `e` have an effect the rest of the enclosing expression can
 * observe — is it impure by the engine's own purity, which follows a
 * called user function into its body? The engine calls a `Block` impure
 * when it assigns its OWN locals, but those writes are not visible
 * outside the block, so a block is read statement by statement instead:
 * an `Assign` to a name the block declared earlier (a plain name, or the
 * names of a destructuring pattern) is not an effect and only its value
 * is read; the initializer of a `Declare` (positional, or the `value` of
 * its attributes dictionary) is read; any other statement is read as an
 * expression. An `Assign` to any other name — an enclosing binding — is
 * an effect the rest of the expression can read. Every other node is
 * read by `foldValueImpure`: impure itself, or reaching an impure value
 * through an assigned symbol the shader inlines.
 */
export function hasObservableEffect(e: Expression): boolean {
  if (isFunction(e, 'Block')) {
    const own = new Set<string>();
    return e.ops.some((stmt) => {
      if (isFunction(stmt, 'Declare')) {
        const declared = stmt.ops[0];
        if (isSymbol(declared)) own.add(declared.symbol);
        else if (
          isFunction(declared, 'Tuple') ||
          isFunction(declared, 'List') ||
          isFunction(declared, 'Delimiter') ||
          isFunction(declared, 'Sequence')
        )
          for (const leaf of declared.ops)
            if (isSymbol(leaf)) own.add(leaf.symbol);
        // The initializer is positional or under the `value` key of a
        // trailing attributes dictionary; a dictionary is pure as a value,
        // so the initializer is read out of it, not through it.
        const init = declareValueOperand(stmt.ops);
        return init !== undefined && hasObservableEffect(init);
      }
      if (isFunction(stmt, 'Assign')) {
        const name = stmt.ops[0];
        if (!isSymbol(name) || !own.has(name.symbol)) return true;
        return hasObservableEffect(stmt.ops[1]);
      }
      return hasObservableEffect(stmt);
    });
  }
  // Through `foldValueImpure`, not `isPure`: a symbol with a value is pure
  // to the engine, while the shader inlines the value — a symbol assigned
  // `Random()` draws where it is read.
  return foldValueImpure(e);
}
