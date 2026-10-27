import { BoxedType } from '../../common/type/boxed-type.js';
import type {
  Expression,
  OperandDescriptor,
  OperatorDefinition,
  SymbolDefinitions,
  EvaluateOptions,
  IComputeEngine as ComputeEngine,
} from '../global-types.js';

import { isRelationalOperator } from '../latex-syntax/utils.js';
import { runWithEvaluationEffects } from '../effects-registry.js';
import {
  isCollectionShaped,
  isFiniteBroadcastParticipant,
  isBroadcastableCollection,
  hasUnresolvedCollectionOperand,
  isPossiblyCollectionTyped,
  broadcastLengthMismatch,
  isTextAtom,
  isUnindexedCollectionOperand,
  isUnresolvedCollectionOperand,
} from '../collection-utils.js';
import { flatten } from '../boxed-expression/flatten.js';
import {
  eq,
  eqIdentical,
  isExactConstantExpression,
} from '../boxed-expression/compare.js';
import { holdsDoubles } from '../boxed-expression/machine-broadcast.js';
import {
  failedCellError,
  isInvalidNonCollection,
} from '../boxed-expression/error-value.js';
import {
  isNumber,
  isFunction,
  isString,
  isSymbol,
} from '../boxed-expression/type-guards.js';
import {
  typeContainsMissing,
  resolveTypeAlias,
} from '../../common/type/utils.js';
import type { Type } from '../../common/type/types.js';
import { parseType } from '../../common/type/parse.js';
import {
  compareIntervals,
  intervalOfType,
} from '../numerics/interval-arithmetic.js';
import { operandLiteralValue } from './type-handlers.js';
import { toBigint, nearJumpTolerance } from '../boxed-expression/numerics.js';
import { reduceModulo } from '../boxed-expression/modular-arithmetic.js';
import {
  subjectOf,
  finiteNumericValue,
  hasAssumptions,
  decideComparisonFromBounds,
  signFromChains,
  exactCompareNumbers,
  isExactRealLiteral,
  exactRealValueOf,
} from '../boxed-expression/constraint-subject.js';
import { isTransitivelyPure } from '../boxed-expression/transitive-purity.js';
import { getInequalityBoundsFromAssumptions } from '../boxed-expression/inequality-bounds.js';
import {
  isKindValue,
  kindCompare,
  kindEqual,
  orderAnswer,
} from '../boxed-expression/kind-compare.js';
import {
  nonNumericOperandError,
  isAbsentScalarSymbol,
} from '../boxed-expression/validate.js';

/**
 * The options of `kindCompare()` and `kindEqual()` for the pair of evaluated
 * operands `ops[i]` and `ops[j]` of a comparison: whether the comparison
 * runs under `.N()`, and the operands as written, `rawOps[i]` and
 * `rawOps[j]`, so that `exact()` evaluates a pure operand again without the
 * approximation. The values are aligned with the written operands: a value
 * that the near-tie rule replaced (`exactPairAtNearTie()`) is the exact
 * value of the same written operand. When the two lists do not have the
 * same length, the written operands are not given.
 */
function kindPairOptions(
  numericApproximation: boolean | undefined,
  rawOps: ReadonlyArray<Expression>,
  ops: ReadonlyArray<Expression>,
  i: number,
  j: number
): {
  numericApproximation: boolean;
  written?: readonly [Expression, Expression];
} {
  return {
    numericApproximation: numericApproximation === true,
    written: rawOps.length === ops.length ? [rawOps[i], rawOps[j]] : undefined,
  };
}

/**
 * Decide `lhs < rhs` (when `strict`) or `lhs ≤ rhs` from assumed bounds on
 * a constraint subject (docs/fungrim/FUNGRIM-PLAN-3-ASSUMPTIONS.md §5.1a).
 *
 * Applies when one side normalizes to a subject term — a bare symbol or
 * `Real/Imaginary/Abs/Argument` of one — and the other side is numeric.
 * The bounds are read directly from the fact index (never via `ask()`), so
 * this also works inside `verify()` where `_isVerifying` suppresses the
 * `ask()` fallbacks.
 *
 * Strict three-valued semantics: `true` only when entailed, `false` only
 * when refuted, `undefined` (stay unevaluated) otherwise.
 */
function compareFromAssumedBounds(
  lhs: Expression,
  rhs: Expression,
  strict: boolean
): boolean | undefined {
  const ce = lhs.engine;
  // Fast gate: engines with no assumptions do no subject or index work.
  if (!hasAssumptions(ce)) return undefined;

  // The comparison constant is handed over as the exact expression, never
  // as its machine projection: `u ≥ 1` does not entail `u ≥ 1 + 10⁻³⁰`,
  // and both constants are the double 1.

  // subject < k / subject ≤ k
  let subject = subjectOf(lhs);
  if (subject !== undefined && finiteNumericValue(rhs) !== undefined)
    return decideComparisonFromBounds(
      getInequalityBoundsFromAssumptions(ce, subject),
      rhs,
      strict ? 'less' : 'lessEqual'
    );

  // k < subject / k ≤ subject ⇔ subject > k / subject ≥ k
  subject = subjectOf(rhs);
  if (subject !== undefined && finiteNumericValue(lhs) !== undefined)
    return decideComparisonFromBounds(
      getInequalityBoundsFromAssumptions(ce, subject),
      lhs,
      strict ? 'greater' : 'greaterEqual'
    );

  // Symbol/expression comparison via assumed inequality chains and the sign of
  // the difference `rhs - lhs` (transitive ≥-closure, and even-power
  // monotonicity such as x > y > 0 ⇒ 2x² > 2y²).
  // `s` is the sign of `diff = rhs - lhs`.
  const s = signFromChains(ce, rhs.sub(lhs));
  if (strict) {
    // lhs < rhs  ⇔  diff > 0
    if (s === 'positive') return true;
    if (s === 'negative' || s === 'zero' || s === 'non-positive') return false;
  } else {
    // lhs ≤ rhs  ⇔  diff ≥ 0
    if (s === 'positive' || s === 'zero' || s === 'non-negative') return true;
    if (s === 'negative') return false;
  }

  return undefined;
}

//   // eq, lt, leq, gt, geq, neq, approx
//   //     shortLogicalImplies: 52, // ➔
//   // shortImplies => 51
//   // implies ==> 49
//   //    impliedBy: 45, // <==
//   // less-than-or-equal-to: Q55935272 241
//   // greater-than-or-equal: Q55935291 242
//   // greater-than: Q47035128  243
//   // less-than: Q52834024 245

/**
 * Evaluate the operands of a relational CHAIN (`a < b < c`, `a = b = c`, …)
 * left to right, stopping at the first adjacent pair that is decidably
 * `False`. A chain is the conjunction of its adjacent pairs, and — like `And`
 * (`library/logic.ts`, `evaluateShortCircuit`) — a conjunction is a
 * short-circuit form: once `a < b` is `False`, `c` is never evaluated (no
 * side effect, no error, no random draw), and the result is `False` whatever
 * the later pairs would have said — including a later `Missing` or an
 * undecided pair (Kleene: `False ∧ x = False`). An operand that evaluates to
 * an error is as final as a `False` pair: it is returned as-is and the
 * operands after it do not run.
 *
 * Returns `False` (or the error) when the walk decided the chain, and
 * otherwise the evaluated operands, in order, for the caller's ordinary
 * (all-operands) code path — each operand evaluated exactly once. Each
 * adjacent pair is decided by `pairIsFalse`, which the caller builds from the
 * SAME cheap primitives its own pairwise loop uses (`kindCompare`,
 * `isLess`/`isLessEqual`/`isEqual`/`eq`, `compareFromAssumedBounds`) — not by
 * re-dispatching the operator, which would pay canonicalization and a full
 * handler re-entry per pair. Anything but a definite `False` (`True`, an
 * absent or undecided pair) lets the walk continue; the caller's loop then
 * settles absence (`Missing`/`NaN`), inertness and the final verdict on the
 * values, so a holding chain pays the cheap comparisons twice and nothing
 * more.
 *
 * Not applied when the chain is binary (nothing to short-circuit) or when
 * some operand is collection-shaped by type (`isCollectionShaped`): the
 * comparison is then element-wise, every operand is evaluated once and the
 * result is a list — the same exception the connectives make.
 */
function evaluateChainOperands(
  ce: ComputeEngine,
  rawOps: ReadonlyArray<Expression>,
  numericApproximation: boolean | undefined,
  pairIsFalse: (
    lhs: Expression,
    rhs: Expression,
    written: readonly [Expression, Expression]
  ) => boolean
): Expression[] | Expression {
  const evalOptions = { numericApproximation };
  // A `Measurement(v, σ)` operand is kept as it is: the pair deciders order
  // it by its nominal through the `compare` hook of the measurement kind
  // (`kindCompare()`), and an undecided comparison keeps the measurement
  // (`Less(2 ± 0.1, x)` stays as written; the nominal it held before lost
  // the uncertainty).
  if (rawOps.some(isCollectionShaped))
    return rawOps.map((op) => op.evaluate(evalOptions));
  if (rawOps.length <= 2) {
    const ops = rawOps.map((op) => op.evaluate(evalOptions));
    if (numericApproximation && ops.length === 2) {
      const exact = exactPairAtNearTie(rawOps[0], ops[0], rawOps[1], ops[1]);
      if (exact !== undefined) return exact;
    }
    return ops;
  }
  const ops: Expression[] = [];
  for (let i = 0; i < rawOps.length; i++) {
    const stop = chainStep(
      ce,
      rawOps,
      i,
      rawOps[i].evaluate(evalOptions),
      ops,
      numericApproximation,
      pairIsFalse
    );
    if (stop !== undefined) return stop;
  }
  return ops;
}

/**
 * One step of a chain of three or more operands, shared by
 * `evaluateChainOperands` and `evaluateChainOperandsAsync`: `v` is the value
 * of operand `i`, and `ops` the values before it. Appends `v` to `ops` and
 * returns `undefined` to go on, or the early answer of the chain: `v` when
 * it is invalid, `False` when the pair `(ops[i-1], v)` is `False`. Under
 * `.N()` a near tie is decided exactly first (`exactPairAtNearTie`).
 */
function chainStep(
  ce: ComputeEngine,
  rawOps: ReadonlyArray<Expression>,
  i: number,
  v: Expression,
  ops: Expression[],
  numericApproximation: boolean | undefined,
  pairIsFalse: (
    lhs: Expression,
    rhs: Expression,
    written: readonly [Expression, Expression]
  ) => boolean
): Expression | undefined {
  if (!v.isValid) return v;
  if (numericApproximation && ops.length > 0) {
    const exact = exactPairAtNearTie(
      rawOps[i - 1],
      ops[ops.length - 1],
      rawOps[i],
      v
    );
    if (exact !== undefined) {
      ops[ops.length - 1] = exact[0];
      v = exact[1];
    }
  }
  if (
    ops.length > 0 &&
    pairIsFalse(ops[ops.length - 1], v, [rawOps[i - 1], rawOps[i]])
  )
    return ce.False;
  ops.push(v);
  return undefined;
}

/**
 * The asynchronous twin of `evaluateChainOperands`: each operand is
 * evaluated with `evaluateAsync`, in order, so that a long operand yields to
 * the event loop and honours the abort signal, with the same early stop
 * (an invalid operand, a `False` adjacent pair) and the same near-tie
 * handling under `.N()`. The synchronous work after an `await` (the pair
 * decider, the exact re-evaluation at a near tie) runs with this
 * evaluation's registry and context stack (`runWithEvaluationEffects`).
 */
async function evaluateChainOperandsAsync(
  ce: ComputeEngine,
  rawOps: ReadonlyArray<Expression>,
  options: {
    numericApproximation: boolean | undefined;
    signal: AbortSignal | undefined;
    _effects: EvaluateOptions['_effects'];
    _contextStack: EvaluateOptions['_contextStack'] | undefined;
    _precisionWindow: EvaluateOptions['_precisionWindow'] | undefined;
  },
  pairIsFalse: (
    lhs: Expression,
    rhs: Expression,
    written: readonly [Expression, Expression]
  ) => boolean
): Promise<Expression[] | Expression> {
  const {
    numericApproximation,
    _effects: effects,
    _contextStack,
    _precisionWindow,
  } = options;
  const inContext = <T>(f: () => T): T =>
    runWithEvaluationEffects(ce, effects, f, _contextStack, _precisionWindow);
  const ops: Expression[] = [];
  if (rawOps.some(isCollectionShaped) || rawOps.length <= 2) {
    // A measurement is kept, as in the synchronous form
    // (`evaluateChainOperands`).
    for (const op of rawOps) ops.push(await op.evaluateAsync(options));
    if (
      numericApproximation &&
      ops.length === 2 &&
      !rawOps.some(isCollectionShaped)
    ) {
      const exact = inContext(() =>
        exactPairAtNearTie(rawOps[0], ops[0], rawOps[1], ops[1])
      );
      if (exact !== undefined) return exact;
    }
    return ops;
  }
  for (let i = 0; i < rawOps.length; i++) {
    const v = await rawOps[i].evaluateAsync(options);
    const stop = inContext(() =>
      chainStep(ce, rawOps, i, v, ops, numericApproximation, pairIsFalse)
    );
    if (stop !== undefined) return stop;
  }
  return ops;
}

/**
 * Under `.N()`, the exact values of two operands of a comparison whose
 * floats are too near each other to decide it, or `undefined`.
 *
 * `rawA` and `rawB` are the operands before their numeric approximation,
 * and `a` and `b` their floats. `.N()` promises a result correct to the
 * working precision, and a comparison jumps where its two operands are
 * equal: at 21 digits, the float of `1/2 − 10⁻³⁰` is `0.5`, but
 * `1/2 − 10⁻³⁰ < 1/2` is `True`. So when the two floats are within
 * `nearJumpTolerance()` of each other (relative to `max(1, |a|, |b|)`), the
 * operands are evaluated again exactly (`exactRealValueOf()`, pure operands
 * only), and when both exact values are exact real numbers, they are
 * compared instead (`exactLiteralOrder()`), as Mathematica does
 * (`N[1/2 − 10^-30 < 1/2]` is `True`). Far from a tie, the floats decide the
 * comparison, and no exact evaluation is made: it can cost much more than
 * the numeric one.
 *
 * An exact constant expression that is not a number (`π`, `ln 2`) is an
 * exception: it is used as it is at any distance from a tie, with an exact
 * number that the other operand is (see the comment in the body).
 *
 * A float operand (`0.5`) has no exact value, so a comparison with a float
 * stays decided at the precision of the float: `1/2 − 10⁻³⁰ < 0.5` is
 * `False`, and `1/10 = 0.1` is `True`, as in Mathematica.
 */
function exactPairAtNearTie(
  rawA: Expression,
  a: Expression,
  rawB: Expression,
  b: Expression
): [Expression, Expression] | undefined {
  // A kind value is compared by its `compare` hook, which reads the exact
  // operand itself (`exact()`, from the operand as written): it is not
  // replaced by an exact number here. Two kind values with identical
  // approximate values are compared again by their exact values in
  // `kindCompare()` and `kindEqual()`.
  if (isKindValue(a) || isKindValue(b)) return undefined;
  // An exact constant expression that is not a number (`π`,
  // `√(10⁶⁰ + 10⁴⁰) − 10³⁰`) is always compared by its exact form, also far
  // from a tie: its float at the working precision can be wrong by much more
  // than the tolerance when its terms cancel. The comparison of the exact
  // forms uses enclosures at a raised precision (`cmp()` in
  // `boxed-expression/compare.ts`), and the first one decides two values
  // that are well apart. Using the operand as it is costs no evaluation.
  // In a chain `a < b < c`, the middle operand can already be the exact
  // constant expression that the first pair used.
  const constantA = isExactConstantExpression(a) ? a : exactConstantOf(rawA);
  const constantB = isExactConstantExpression(b) ? b : exactConstantOf(rawB);
  if (constantA !== undefined || constantB !== undefined) {
    const u = constantA ?? exactOperandOf(rawA, a);
    const v = constantB ?? exactOperandOf(rawB, b);
    if (u !== undefined && v !== undefined) return [u, v];
  }
  if (!isNearTiePair(a, b)) return undefined;
  // An operand that is already an exact real number is its own exact value:
  // in a chain `a < b < c`, the middle operand is replaced by its exact
  // value for the first pair, and it is not evaluated again for the second.
  const exactA = isExactRealLiteral(a) ? a : exactValueOrConstant(rawA);
  if (exactA === undefined) return undefined;
  const exactB = isExactRealLiteral(b) ? b : exactValueOrConstant(rawB);
  if (exactB === undefined) return undefined;
  return [exactA, exactB];
}

/**
 * True when `a` and `b` are finite real numbers, not both exact, whose
 * values are within `nearJumpTolerance()` of each other, relative to
 * `max(1, |a|, |b|)`. At such a near tie, the floats cannot decide a
 * comparison of `a` and `b`, and under `.N()` the comparison evaluates its
 * operands again exactly (`exactPairAtNearTie()`). Far from a tie, the
 * floats decide it.
 */
export function isNearTiePair(a: Expression, b: Expression): boolean {
  if (!isNumber(a) || !isNumber(b)) return false;
  if (isExactRealLiteral(a) && isExactRealLiteral(b)) return false;
  if (a.isComplex || b.isComplex) return false;
  if (a.isFinite !== true || b.isFinite !== true) return false;
  const x = a.re;
  const y = b.re;
  // A finite operand too large for a double projects to `±Infinity`, and
  // the difference of two equal projections is `NaN`: the doubles cannot
  // decide the comparison, so the pair counts as a near tie. The double of
  // the rational `(3·10⁴⁰⁰ + 1)/3` and of `(3·10⁴⁰⁰ + 2)/3` is `Infinity`.
  if (!Number.isFinite(x) || !Number.isFinite(y)) return true;
  const scale = Math.max(1, Math.abs(x), Math.abs(y));
  return Math.abs(x - y) <= nearJumpTolerance(a.engine) * scale;
}

/** `raw`, canonical, when it is an exact constant expression that is not
 *  a number (see `isExactConstantExpression()`), or `undefined`. */
function exactConstantOf(raw: Expression): Expression | undefined {
  const canonical = raw.isCanonical ? raw : raw.canonical;
  return isExactConstantExpression(canonical) ? canonical : undefined;
}

/** The exact real number literal that `raw` is, or that its float `value`
 *  is, or `undefined`. No evaluation is made. */
function exactOperandOf(
  raw: Expression,
  value: Expression
): Expression | undefined {
  if (isExactRealLiteral(value)) return value;
  const canonical = raw.isCanonical ? raw : raw.canonical;
  return isExactRealLiteral(canonical) ? canonical : undefined;
}

/**
 * The exact value of `raw` when it is an exact real number
 * (`exactRealValueOf()`), else `raw` itself when it is an exact constant
 * expression that is not a number (`π`, `ln 2`; see
 * `isExactConstantExpression()`), else `undefined`. The comparison of an
 * exact constant expression orders it by enclosures of its value at a
 * raised precision (`exactValueOrder()` in `boxed-expression/compare.ts`),
 * not by its float at the working precision.
 */
function exactValueOrConstant(raw: Expression): Expression | undefined {
  return exactRealValueOf(raw) ?? exactConstantOf(raw);
}

/**
 * The exact order of `a` and `b` when both are exact real numbers
 * (integers, rationals, or rationals times the square root of an integer):
 * `-1`, `0` or `1`. Otherwise, `undefined`.
 *
 * Two exact numbers are compared exactly, with no tolerance
 * (`exactCompareNumbers()`): `isLess()` and `isEqual()` compare within the
 * engine tolerance, and `√2` and `1414213562373095048801689/10²⁴` were
 * then equal.
 */
function exactLiteralOrder(
  a: Expression,
  b: Expression
): -1 | 0 | 1 | undefined {
  if (!isExactRealLiteral(a) || !isExactRealLiteral(b)) return undefined;
  return exactCompareNumbers(a, b);
}

/** The options of `kindCompare()` and `kindEqual()` for an adjacent pair of
 * a chain: whether the chain runs under `.N()`, and the two operands as
 * written (see `kindPairOptions()`). */
function chainKindOptions(
  numericApproximation: boolean | undefined,
  written: readonly [Expression, Expression]
): {
  numericApproximation: boolean;
  written: readonly [Expression, Expression];
} {
  return { numericApproximation: numericApproximation === true, written };
}

/** The adjacent-pair deciders of `evaluateChainOperands`, one per chainable
 * relation — each the `False` branch of the corresponding handler's own
 * pairwise loop. `written` holds the two operands as written, for the
 * exact values of the kind values under `.N()`. */
const CHAIN_PAIR_IS_FALSE = {
  Equal:
    (_ce: ComputeEngine, numericApproximation: boolean | undefined) =>
    (
      a: Expression,
      b: Expression,
      written: readonly [Expression, Expression]
    ) => {
      const k = kindEqual(
        a,
        b,
        chainKindOptions(numericApproximation, written)
      );
      if (k !== 'not-applicable') return k === false;
      if (unorderedChainPair(a, b, false, 'pole')) return true;
      const o = exactLiteralOrder(a, b);
      if (o !== undefined) return o !== 0;
      return eq(a, b) === false;
    },
  NotEqual:
    (_ce: ComputeEngine, numericApproximation: boolean | undefined) =>
    (
      a: Expression,
      b: Expression,
      written: readonly [Expression, Expression]
    ) => {
      const k = kindEqual(
        a,
        b,
        chainKindOptions(numericApproximation, written)
      );
      if (k !== 'not-applicable') return k === true;
      const o = exactLiteralOrder(a, b);
      if (o !== undefined) return o === 0;
      return a.isEqual(b) === true;
    },
  Less:
    (_ce: ComputeEngine, numericApproximation: boolean | undefined) =>
    (
      a: Expression,
      b: Expression,
      written: readonly [Expression, Expression]
    ) => {
      const k = kindCompare(
        a,
        b,
        chainKindOptions(numericApproximation, written)
      );
      // `'unordered'` (no order, a complex nominal) makes the pair `False`
      // (`orderAnswer()`).
      if (k !== undefined) return orderAnswer(k, 'Less') === false;
      if (unorderedChainPair(a, b, false)) return true;
      const o = exactLiteralOrder(a, b);
      if (o !== undefined) return o >= 0;
      const cmp = a.isLess(b) ?? compareFromAssumedBounds(a, b, true);
      if (cmp === undefined) return unorderedChainPair(a, b, true);
      return cmp === false;
    },
  LessEqual:
    (_ce: ComputeEngine, numericApproximation: boolean | undefined) =>
    (
      a: Expression,
      b: Expression,
      written: readonly [Expression, Expression]
    ) => {
      const k = kindCompare(
        a,
        b,
        chainKindOptions(numericApproximation, written)
      );
      if (k !== undefined) return orderAnswer(k, 'LessEqual') === false;
      if (unorderedChainPair(a, b, false)) return true;
      const o = exactLiteralOrder(a, b);
      if (o !== undefined) return o > 0;
      const cmp = a.isLessEqual(b) ?? compareFromAssumedBounds(a, b, false);
      // A `true` can come from a zero difference of two values with no order
      // (`Ln(-1) ≤ Ln(-1)`): see `trueOrderedRelation()`.
      if (cmp === false) return true;
      return unorderedChainPair(a, b, true);
    },
};

/**
 * True when the adjacent pair `(a, b)` of a chain is `False` because an
 * operand is an undefined number (`NaN`, `Indeterminate`) or has a value
 * with no order (`nonRealKind()`; with `only: 'pole'`, only the pole, for
 * `Equal`). This is the rule of the verdict (`decideLess`,
 * `decideLessEqual`, `decideEqual`) applied to one pair, so that the chain
 * stops there: `0 < i < Missing` and `0 < NaN < Missing` are `False`, as
 * `(0 < NaN) ∧ (NaN < Missing)` is `False ∧ Missing`, and the operands after
 * the pair are not evaluated (user decision 2026-10-23; before it a NaN pair
 * was left to the verdict over all the operands, where the absent operand
 * made the chain `Missing`). A pair with a `Missing` operand is not decided
 * here: the verdict gives it the Kleene `Missing`, as it does for the pair
 * alone (`Less(i, Missing)` and `Less(NaN, Missing)` are `Missing`; the
 * same for `Undefined`). With
 * `approximate`, a constant expression is approximated (`Ln(-1)`); the
 * callers ask for it only when the comparison methods did not decide the
 * pair.
 */
function unorderedChainPair(
  a: Expression,
  b: Expression,
  approximate: boolean,
  only?: 'pole'
): boolean {
  // `Undefined` is absent too (`readComparisonAbsence` reads it as
  // `Missing`), so a pair with it is left to the verdict as well.
  if (isAbsentScalarSymbol(a) || isAbsentScalarSymbol(b)) return false;
  if (isNumber(a) && a.isNaN === true) return true;
  if (isNumber(b) && b.isNaN === true) return true;
  return [a, b].some((x) => {
    const kind = nonRealKind(x, approximate);
    return kind !== undefined && (only === undefined || kind === only);
  });
}

/**
 * Keep an undecidable comparison inert — but over the *evaluated* operands
 * rather than the raw ones.
 *
 * `Equal`/`NotEqual`/`Less`/`LessEqual` are `lazy`, so each
 * evaluates its operands itself at the top of the handler. Returning
 * `undefined` from there means "unchanged", which makes the framework keep the
 * ORIGINAL expression and throw that operand evaluation away: `d/dx x^2 > 0`
 * reported `0 < D(x^2, x)` rather than `0 < 2x`. The non-lazy relations
 * (`Approx`, `Tilde`, `Precedes`…) never had the problem, because for them the
 * framework substitutes the evaluated operands on an `undefined` return — this
 * brings the four lazy ones in line.
 *
 * The comparison itself still stays inert when undecidable (`x^2 = 4` is a
 * *condition*, not a falsity — see the `Equal` handler): only the operands
 * change. `undefined` is returned when evaluation changed nothing, which keeps
 * this a fixpoint and avoids allocating on the hot rule-guard path.
 */
function inertRelation(
  ce: ComputeEngine,
  op: string,
  rawOps: ReadonlyArray<Expression>,
  ops: ReadonlyArray<Expression>
): Expression | undefined {
  if (ops.length !== rawOps.length) return undefined;
  if (ops.every((x, i) => x.isSame(rawOps[i]))) return undefined;
  return ce._fn(op, ops);
}

/**
 * The kind of numeric value that is not a real number that `x`, an
 * evaluated operand of a comparison, has: `'pole'` for `ComplexInfinity`
 * (the value of `1/0`), `'complex'` for a number with a nonzero imaginary
 * part (`i`, `1 + i`), or `undefined`. The real numbers include `+∞` and
 * `−∞`. `NaN` and `Indeterminate` give `undefined`: the comparison handlers
 * test them first, with the IEEE rule.
 *
 * Such a value has no order, so an ordered comparison (`<`, `≤`, `>`, `≥`)
 * with it is `False`. An equality with a pole is `False` too, since the
 * pole has no value (`1/0 = 1/0` is `False`, as `NaN = NaN` is), but an
 * equality with a complex number keeps its ordinary meaning (`i = i` is
 * `True`). User decision of 2026-10-21 (Tycho ledger row 413 (a)), recorded
 * in `docs/ERROR-MODEL.md`.
 *
 * A number literal is read without a tolerance: it is complex when its
 * numeric value holds a nonzero imaginary part (`isComplex`), also one too
 * small for a double (`1 + 10^{-800}i`, whose `im` is the double `0`).
 *
 * With `approximate`, an operand that is not a number literal but is a pure
 * numeric expression with no free variable is approximated: `Ln(-1)` stays
 * symbolic under `evaluate()`, and its value is `iπ`. An expression with a
 * free variable has no value yet, and gives `undefined` (`0 < x` stays
 * inert). No approximation is made for an expression whose type is `real`
 * (`π`, `ln 2`), or that holds an operator whose numeric evaluation is an
 * iteration with no fixed bound (`ITERATIVE_NUMERIC_OPERATORS`: an infinite
 * `Sum` can take a second to fail to converge). The approximation of a
 * quadrature is a `Measurement(v, σ)`, a value of a kind, which is not a
 * number literal: its order is the `compare` hook's to decide, and this
 * function gives `undefined` for it.
 * An imaginary part of the approximation of size up to `10⁻¹⁴` times the
 * modulus is not read as nonzero: it can be the rounding error of a real
 * value that was computed through complex intermediate values. This is the
 * noise rule of `boxComplexResult()` in `library/arithmetic.ts`.
 */
function nonRealKind(
  x: Expression,
  approximate = false
): 'pole' | 'complex' | undefined {
  if (isNumber(x)) return literalNonRealKind(x);
  if (!approximate || !mayApproximateNonReal(x)) return undefined;
  const v = x.N();
  if (!isNumber(v)) {
    // A value of a kind that has no order against a number (a measurement
    // with a complex nominal, the approximation of an integral whose value
    // is not real) is not real, as the complex number is: its kind says so
    // (`'unordered'`, `kindCompare()`).
    return isKindValue(v) && kindCompare(v, x.engine.Zero) === 'unordered'
      ? 'complex'
      : undefined;
  }
  const kind = literalNonRealKind(v);
  if (kind !== 'complex') return kind;
  return isRoundingNoiseImaginaryPart(v) ? undefined : 'complex';
}

/** `nonRealKind()` of a number literal: no tolerance, no approximation. */
function literalNonRealKind(
  x: Expression & { readonly isComplex: boolean }
): 'pole' | 'complex' | undefined {
  if (x.isNaN === true || !x.isComplex) return undefined;
  return x.isFinite === false ? 'pole' : 'complex';
}

/**
 * The operators whose numeric evaluation is an iteration with no fixed
 * bound: a series summed until it converges, a limit extrapolated, a
 * differential equation integrated. `nonRealKind()` does not approximate an
 * operand that holds one. The comparison has already paid one numeric
 * evaluation of the operand (`isLess()` approximates it), and a second one
 * doubled the time of an undecided comparison: `0 < Σ_{k≥1} sin(k)/k²` took
 * 1.3 s instead of 0.7 s. A definite integral is not in the list: its
 * quadrature has a bounded number of subintervals.
 */
const ITERATIVE_NUMERIC_OPERATORS: ReadonlySet<string> = new Set([
  'Sum',
  'Product',
  'Limit',
  'NLimit',
  'NDSolve',
]);

/**
 * True when `nonRealKind()` approximates `x`: a pure numeric function
 * expression with no free variable, whose type is not `real`, and that
 * holds no operator of `ITERATIVE_NUMERIC_OPERATORS`.
 */
function mayApproximateNonReal(x: Expression): boolean {
  if (!isFunction(x) || x.unknowns.length > 0) return false;
  if (!x.type.matches('number') || x.type.matches('real')) return false;
  const holdsIteration = (e: Expression): boolean =>
    isFunction(e) &&
    (ITERATIVE_NUMERIC_OPERATORS.has(e.operator) || e.ops.some(holdsIteration));
  if (holdsIteration(x)) return false;
  return isTransitivelyPure(x);
}

/**
 * True when the imaginary part of the complex number literal `v`, an
 * approximation, is within the rounding noise of its modulus: at most
 * `10⁻¹⁴·|v|`. The parts are read as doubles, and as big decimals when one
 * of them is outside the double range.
 */
function isRoundingNoiseImaginaryPart(v: Expression): boolean {
  const re = v.re;
  const im = v.im;
  if (Number.isFinite(re) && Number.isFinite(im))
    return Math.abs(im) <= 1e-14 * Math.hypot(re, im);
  const ce = v.engine;
  const bre = (v.bignumRe ?? ce.bignum(re)).abs();
  const bim = (v.bignumIm ?? ce.bignum(im)).abs();
  const modulus = bre.gt(bim) ? bre : bim;
  return bim.lte(modulus.mul(1e-14));
}

/**
 * True when an operand of an ordered comparison has a value with no order
 * (`nonRealKind()`, which approximates a constant expression), so that the
 * comparison is `False`.
 */
function hasUnorderedOperand(ops: ReadonlyArray<Expression>): boolean {
  return ops.some((x) => nonRealKind(x, true) !== undefined);
}

/**
 * The answer of an ordered comparison (`Less`, `LessEqual`) that its
 * operands did not decide: `False` when an operand is a constant expression
 * whose value is not a real number (`hasUnorderedOperand()`), and otherwise
 * the comparison kept inert (`inertRelation()`).
 */
function undecidedOrderedRelation(
  ce: ComputeEngine,
  op: 'Less' | 'LessEqual',
  rawOps: ReadonlyArray<Expression>,
  ops: ReadonlyArray<Expression>
): Expression | undefined {
  if (hasUnorderedOperand(ops)) return ce.False;
  return inertRelation(ce, op, rawOps, ops);
}

/**
 * The answer of an ordered comparison whose operands decided it `True`:
 * `False` when an operand is a constant expression whose value is not a
 * real number. `isLessEqual()` can answer `true` for such an operand, when
 * the difference of the operands is zero: `Ln(-1) ≤ Ln(-1)` is `False`, as
 * `i ≤ i` is.
 */
function trueOrderedRelation(
  ce: ComputeEngine,
  ops: ReadonlyArray<Expression>
): Expression {
  return hasUnorderedOperand(ops) ? ce.False : ce.True;
}

/**
 * The `evaluate` and `evaluateAsync` handlers of a chainable relation
 * (`Equal`, `NotEqual`, `Less`, `LessEqual`).
 *
 * These operators are `lazy`, which skips evaluating the arguments before
 * the handler runs. So the handler evaluates them itself — otherwise a
 * compound operand such as `Im(𝑖)` or `R^2` (with `R = [1,2,3]`) never
 * folds — and a chain stops at
 * the first adjacent pair that is `False` (`evaluateChainOperands`). The
 * asynchronous twin awaits each operand with `evaluateAsync`, in order and
 * with the same stop, so that a long operand (`Σ 1/k²` over many terms)
 * yields to the event loop and honours the abort signal (GitHub issue
 * #392); the synchronous handler ran it to the end. The verdict over the
 * values (`decide`) is the same function on both routes.
 */
function chainedRelationHandlers(
  op: keyof typeof CHAIN_PAIR_IS_FALSE,
  decide: (
    ce: ComputeEngine,
    rawOps: ReadonlyArray<Expression>,
    chain: Expression[] | Expression,
    numericApproximation: boolean | undefined
  ) => Expression | undefined
): Pick<OperatorDefinition, 'evaluate' | 'evaluateAsync'> {
  return {
    evaluate: (rawOps, { engine: ce, numericApproximation }) =>
      decide(
        ce,
        rawOps,
        evaluateChainOperands(
          ce,
          rawOps,
          numericApproximation,
          CHAIN_PAIR_IS_FALSE[op](ce, numericApproximation)
        ),
        numericApproximation
      ),
    evaluateAsync: async (
      rawOps,
      {
        engine: ce,
        numericApproximation,
        signal,
        effects,
        _contextStack,
        _precisionWindow,
      }
    ) => {
      const chain = await evaluateChainOperandsAsync(
        ce,
        rawOps,
        {
          numericApproximation,
          signal,
          _effects: effects,
          _contextStack,
          _precisionWindow,
        },
        CHAIN_PAIR_IS_FALSE[op](ce, numericApproximation)
      );
      // The verdict runs after the `await`s: it may evaluate (an exact
      // operand at a near tie, an assumption), and a synchronous evaluation
      // after an `await` must run with this evaluation's registry and
      // context stack (`docs/EFFECTS-MODEL.md`, rule 3 for an asynchronous
      // handler).
      return runWithEvaluationEffects(
        ce,
        effects,
        () => decide(ce, rawOps, chain, numericApproximation),
        _contextStack,
        _precisionWindow
      );
    },
  };
}

/**
 * The verdict of `Equal` over its evaluated operands. `chain` is what
 * `evaluateChainOperands` (or its asynchronous twin) gave: the values, or
 * the early answer of a chain (`False` at the first adjacent pair that is
 * `False`, or an invalid operand). `rawOps` are the operands as written;
 * they decide what an absent value means (`readComparisonAbsence`) and
 * whether an inert answer changed anything (`inertRelation`).
 */
function decideEqual(
  ce: ComputeEngine,
  rawOps: ReadonlyArray<Expression>,
  chain: Expression[] | Expression,
  numericApproximation: boolean | undefined
): Expression | undefined {
  if (!Array.isArray(chain)) return chain;
  const ops = chain;
  // Element-wise broadcast when an operand evaluated to a collection, so a
  // named list behaves like a literal one: `x^2+y^2 = R^2` broadcasts to a
  // list of `Equal`s, matching the inequality operators (which already
  // broadcast via the same helper) and Desmos semantics (Tycho report).
  // Restricted to the list-vs-scalar case: when two or more operands are
  // collections, whole-list equality stays a scalar boolean — broadcasting
  // there would also recurse forever, since re-dispatching `Equal` on the
  // same two collections re-enters this handler (`skipBroadcastForVectorOps`
  // enforces the same rule for the engine-level broadcast).
  if (broadcastableComparisonOperands(ops)) {
    const bc = broadcastComparison(ce, 'Equal', ops, numericApproximation);
    if (bc) return bc;
  }
  // An operand that is not a collection value yet (`X` declared
  // `list<number>` with no value) may still be any list: the comparison is
  // undecided before any failed cell is read.
  if (undecidedCollectionComparison(ops))
    return inertRelation(ce, 'Equal', rawOps, ops);
  const failed = failedCellComparison(ce, ops, false);
  if (failed === 'undecided') return inertRelation(ce, 'Equal', rawOps, ops);
  if (failed !== undefined) return failed;
  // One element pair with no answer makes the WHOLE comparison undecided
  // (user ruling of 2026-09-21): see `absentCollectionComparison`. The
  // answer is the absent marker `Missing`, which compiled code spells
  // `NaN`.
  if (absentCollectionComparison(ops)) return ce.Missing;
  // Absence semantics (§3.D, amended 2026-07-24): once broadcast has had
  // its chance (so a list-vs-scalar operand comparison is per-cell), a
  // SCALAR `Missing` operand makes the comparison `Missing` (Kleene), while
  // a `NaN` operand makes it `False` (IEEE: `NaN == NaN` is `false`).
  // `Missing` wins over `NaN` (Kleene propagation). Per-cell broadcast
  // re-enters this handler on scalar cells, so the rule applies
  // element-wise too. A `Missing` read from a numeric-domain slot
  // (`number | missing`) is `NaN`, not Kleene (`readComparisonAbsence`).
  const vals = readComparisonAbsence(ce, ops);
  if (vals.some((op) => isSymbol(op, 'Missing'))) return ce.Missing;
  if (vals.some((op) => isNumber(op) && op.isNaN === true)) return ce.False;
  // The pole `ComplexInfinity` (`1/0`) has no value, so an equality with it
  // is `False`, as with `NaN` (user decision of 2026-10-21). A complex
  // number keeps the ordinary equality (`i = i` is `True`): see
  // `nonRealKind()`.
  if (vals.some((op) => nonRealKind(op) === 'pole')) return ce.False;
  let lhs: Expression | undefined = undefined;
  // The index of `lhs` in `ops`, for its operand as written.
  let lhsIndex = 0;
  for (const [i, arg] of ops.entries()) {
    if (!lhs) lhs = arg;
    else {
      // A pair with a kind value is decided by the kinds (`kindEqual()`).
      const k = kindEqual(
        lhs,
        arg,
        kindPairOptions(numericApproximation, rawOps, ops, lhsIndex, i)
      );
      if (k !== 'not-applicable') {
        if (k === false) return ce.False;
        if (k === undefined) return inertRelation(ce, 'Equal', rawOps, ops);
        lhs = arg;
        lhsIndex = i;
        continue;
      }

      const order = exactLiteralOrder(lhs, arg);
      const test = order !== undefined ? order === 0 : eq(lhs, arg);
      if (test === false) return ce.False;

      // An undecidable comparison (free variables present, no proof
      // either way) stays INERT: `x^2 = 4` is a *condition*, not a
      // falsity — it evaluates to itself, like the inequality operators
      // (`x^2 < 4` already stays symbolic) and like Mathematica's `==`.
      // Decidable comparisons are unchanged (`2+2=4` → True,
      // `x = x+1` → False when provable). This replaced the earlier
      // pragmatic collapse-to-False, which silently ruined equations
      // that were later piped into `Solve` (Tycho 0.72.0 report,
      // item 8). Three-valued verification mode (`ce.isVerifying`)
      // behaves identically. `inertRelation` keeps the *evaluated*
      // operands (`x^2 = 2+2` → `x^2 = 4`). Only a pole LITERAL decides
      // `False` (above): a constant expression is not approximated to find
      // a pole, since `1/0` and the special functions at a pole evaluate to
      // the literal `ComplexInfinity`.
      if (test === undefined) return inertRelation(ce, 'Equal', rawOps, ops);
    }
  }
  return ce.True;
}

/**
 * The verdict of `NotEqual` over its evaluated operands. `chain` is what
 * `evaluateChainOperands` (or its asynchronous twin) gave: the values, or
 * the early answer of a chain (`False` at the first adjacent pair that is
 * `False`, or an invalid operand). `rawOps` are the operands as written;
 * they decide what an absent value means (`readComparisonAbsence`) and
 * whether an inert answer changed anything (`inertRelation`).
 */
function decideNotEqual(
  ce: ComputeEngine,
  rawOps: ReadonlyArray<Expression>,
  chain: Expression[] | Expression,
  numericApproximation: boolean | undefined
): Expression | undefined {
  if (!Array.isArray(chain)) return chain;
  const ops = chain;
  if (ops.length < 2) return ce.False;
  // Broadcast over a list operand that only appeared after evaluation (e.g.
  // `R^2` with `R = [1,2,3]`), matching `Equal` and the literal-list form;
  // list-vs-scalar only (see `Equal`'s handler for why 2+ collections stay
  // a scalar boolean and would otherwise recurse).
  if (broadcastableComparisonOperands(ops)) {
    const bc = broadcastComparison(ce, 'NotEqual', ops, numericApproximation);
    if (bc) return bc;
  }
  // As for `Equal`: an unresolved collection operand comes first.
  if (undecidedCollectionComparison(ops))
    return inertRelation(ce, 'NotEqual', rawOps, ops);
  const failed = failedCellComparison(ce, ops, true);
  if (failed === 'undecided') return inertRelation(ce, 'NotEqual', rawOps, ops);
  if (failed !== undefined) return failed;
  // The same undecided marker as `Equal`, never its negation (user ruling
  // of 2026-09-21): a comparison with no answer has no answer under
  // negation either, so `NotEqual` must not report a confident `True`
  // where `Equal` could not report `False`.
  if (absentCollectionComparison(ops)) return ce.Missing;
  // Absence semantics (§3.D, amended 2026-07-24): Kleene over `Missing`
  // (`NotEqual(Missing, x) = Missing`), IEEE over `NaN` (`NotEqual(NaN, x)
  // = True`). `Missing` wins over `NaN`; a numeric-domain slot's `Missing`
  // reads as `NaN` (`readComparisonAbsence`).
  const vals = readComparisonAbsence(ce, ops);
  if (vals.some((op) => isSymbol(op, 'Missing'))) return ce.Missing;
  if (vals.some((op) => isNumber(op) && op.isNaN === true)) return ce.True;
  let lhs: Expression | undefined = undefined;
  for (const [i, arg] of ops.entries()) {
    if (!lhs) lhs = arg;
    else {
      // A pair with a kind value is decided by the kinds, as in `Equal`.
      // `lhs` is always the first operand.
      const k = kindEqual(
        lhs,
        arg,
        kindPairOptions(numericApproximation, rawOps, ops, 0, i)
      );
      if (k !== 'not-applicable') {
        if (k === true) return ce.False;
        if (k === undefined) return inertRelation(ce, 'NotEqual', rawOps, ops);
        continue;
      }
      const order = exactLiteralOrder(lhs, arg);
      const test = order !== undefined ? order === 0 : lhs.isEqual(arg);
      if (test === true) return ce.False;

      // An undecidable comparison stays INERT (three-valued logic in
      // every mode, matching `Equal` and the inequality operators) —
      // but first try to *prove* the two sides distinct from assumed
      // bounds. A proven strict inequality in either direction entails
      // ≠ (e.g. `assume(z > 0)` ⇒ `z ≠ 0`), so rule guards like
      // `; z ≠ 0` fire under such assumptions. If distinctness is not
      // provable, stay symbolic: `x ≠ 4` is a condition, not a truth.
      // (This replaced the earlier pragmatic collapse-to-True in normal
      // evaluation mode — Tycho 0.72.0 report, item 8.)
      if (test === undefined) {
        const distinct =
          compareFromAssumedBounds(lhs, arg, true) === true ||
          compareFromAssumedBounds(arg, lhs, true) === true;
        if (!distinct) return inertRelation(ce, 'NotEqual', rawOps, ops);
      }
      // Continue the loop - if all comparisons are not equal, return True
    }
  }
  return ce.True;
}

/**
 * The verdict of `Less` over its evaluated operands. `chain` is what
 * `evaluateChainOperands` (or its asynchronous twin) gave: the values, or
 * the early answer of a chain (`False` at the first adjacent pair that is
 * `False`, or an invalid operand). `rawOps` are the operands as written;
 * they decide what an absent value means (`readComparisonAbsence`) and
 * whether an inert answer changed anything (`inertRelation`).
 */
function decideLess(
  ce: ComputeEngine,
  rawOps: ReadonlyArray<Expression>,
  chain: Expression[] | Expression,
  numericApproximation: boolean | undefined
): Expression | undefined {
  if (!Array.isArray(chain)) return chain;
  const ops = chain;
  // Element-wise broadcast when an operand evaluated to a collection (e.g.
  // `|[1...5]-2| > 0`, canonical `Less(0, Abs(…))`). See `broadcastComparison`.
  const bc = broadcastComparison(ce, 'Less', ops, numericApproximation);
  if (bc) return bc;
  // Absence semantics (§3.D, amended 2026-07-24): Kleene over `Missing`,
  // IEEE over `NaN` (unordered ⇒ `False`). Applies per-cell too (broadcast
  // re-enters this handler on scalar cells). A numeric-domain slot's
  // `Missing` reads as `NaN` (`readComparisonAbsence`).
  const vals = readComparisonAbsence(ce, ops);
  if (vals.some((op) => isSymbol(op, 'Missing'))) return ce.Missing;
  if (vals.some((op) => isNumber(op) && op.isNaN === true)) return ce.False;
  // A value that is not a real number (the pole `1/0`, a complex number
  // such as `i`) has no order: `False` (user decision of 2026-10-21, see
  // `nonRealKind()`). An undecided pair below also tests a constant
  // expression such as `Ln(-1)` (`undecidedOrderedRelation()`).
  if (vals.some((op) => nonRealKind(op) !== undefined)) return ce.False;
  if (ops.length === 2) {
    const [lhs, rhs] = ops;
    // A pair with a value of a kind that has `compare` is decided by the
    // kinds (`kindCompare()`).
    const k = kindCompare(
      lhs,
      rhs,
      kindPairOptions(numericApproximation, rawOps, ops, 0, 1)
    );
    // Two values with no order (a measurement with a complex nominal): no
    // order relation holds, as for a complex number. A pair that the kinds
    // do not order, or that is only known to be `'<='` (two enclosures that
    // touch), stays unevaluated (`orderAnswer()`).
    if (k !== undefined) {
      const verdict = orderAnswer(k, 'Less');
      if (verdict === undefined) return inertRelation(ce, 'Less', rawOps, ops);
      return verdict ? ce.True : ce.False;
    }
    const order = exactLiteralOrder(lhs, rhs);
    const cmp =
      order !== undefined
        ? order < 0
        : (lhs.isLess(rhs) ?? compareFromAssumedBounds(lhs, rhs, true));
    if (cmp === undefined)
      return undecidedOrderedRelation(ce, 'Less', rawOps, ops);
    return cmp ? ce.True : ce.False;
  }
  if (ops.length < 2) return ce.True;
  // Less can have multiple arguments, i.e. a < b < c < d
  let lhs: Expression | undefined = undefined;
  for (const [i, arg] of ops.entries()) {
    if (!lhs) lhs = arg;
    else {
      // `lhs` is the operand before `arg`.
      const k = kindCompare(
        lhs,
        arg,
        kindPairOptions(numericApproximation, rawOps, ops, i - 1, i)
      );
      if (k !== undefined) {
        const verdict = orderAnswer(k, 'Less');
        if (verdict === undefined)
          return inertRelation(ce, 'Less', rawOps, ops);
        if (!verdict) return ce.False;
      } else {
        const order = exactLiteralOrder(lhs, arg);
        const cmp =
          order !== undefined
            ? order < 0
            : (lhs.isLess(arg) ?? compareFromAssumedBounds(lhs, arg, true));
        if (cmp === undefined)
          return undecidedOrderedRelation(ce, 'Less', rawOps, ops);
        if (cmp === false) return ce.False;
      }
      lhs = arg;
    }
  }
  return ce.True;
}

/**
 * The verdict of `LessEqual` over its evaluated operands. `chain` is what
 * `evaluateChainOperands` (or its asynchronous twin) gave: the values, or
 * the early answer of a chain (`False` at the first adjacent pair that is
 * `False`, or an invalid operand). `rawOps` are the operands as written;
 * they decide what an absent value means (`readComparisonAbsence`) and
 * whether an inert answer changed anything (`inertRelation`).
 */
function decideLessEqual(
  ce: ComputeEngine,
  rawOps: ReadonlyArray<Expression>,
  chain: Expression[] | Expression,
  numericApproximation: boolean | undefined
): Expression | undefined {
  if (!Array.isArray(chain)) return chain;
  const ops = chain;
  // Element-wise broadcast when an operand evaluated to a collection.
  const bc = broadcastComparison(ce, 'LessEqual', ops, numericApproximation);
  if (bc) return bc;
  // Absence semantics (§3.D, amended 2026-07-24): Kleene over `Missing`,
  // IEEE over `NaN` (unordered ⇒ `False`). See `Less`.
  const vals = readComparisonAbsence(ce, ops);
  if (vals.some((op) => isSymbol(op, 'Missing'))) return ce.Missing;
  if (vals.some((op) => isNumber(op) && op.isNaN === true)) return ce.False;
  // A value that is not a real number has no order: `False`. See `Less`.
  if (vals.some((op) => nonRealKind(op) !== undefined)) return ce.False;
  if (ops.length === 2) {
    const [lhs, rhs] = ops;
    const k = kindCompare(
      lhs,
      rhs,
      kindPairOptions(numericApproximation, rawOps, ops, 0, 1)
    );
    if (k !== undefined) {
      const verdict = orderAnswer(k, 'LessEqual');
      if (verdict === undefined)
        return inertRelation(ce, 'LessEqual', rawOps, ops);
      return verdict ? ce.True : ce.False;
    }
    const order = exactLiteralOrder(lhs, rhs);
    const cmp =
      order !== undefined
        ? order <= 0
        : (lhs.isLessEqual(rhs) ?? compareFromAssumedBounds(lhs, rhs, false));
    if (cmp === undefined)
      return undecidedOrderedRelation(ce, 'LessEqual', rawOps, ops);
    return cmp ? trueOrderedRelation(ce, ops) : ce.False;
  }
  if (ops.length < 2) return ce.True;
  // LessEqual can have multiple arguments, i.e. a <= b <= c <= d
  let lhs: Expression | undefined = undefined;
  for (const [i, arg] of ops.entries()) {
    if (!lhs) lhs = arg;
    else {
      // `lhs` is the operand before `arg`.
      const k = kindCompare(
        lhs,
        arg,
        kindPairOptions(numericApproximation, rawOps, ops, i - 1, i)
      );
      if (k !== undefined) {
        const verdict = orderAnswer(k, 'LessEqual');
        if (verdict === undefined)
          return inertRelation(ce, 'LessEqual', rawOps, ops);
        if (!verdict) return ce.False;
      } else {
        const order = exactLiteralOrder(lhs, arg);
        const cmp =
          order !== undefined
            ? order <= 0
            : (lhs.isLessEqual(arg) ??
              compareFromAssumedBounds(lhs, arg, false));
        if (cmp === undefined)
          return undecidedOrderedRelation(ce, 'LessEqual', rawOps, ops);
        if (cmp === false) return ce.False;
      }
      lhs = arg;
    }
  }
  return trueOrderedRelation(ce, ops);
}
export const RELOP_LIBRARY: SymbolDefinitions = {
  Congruent: {
    description: 'Indicate that two expressions are congruent modulo a number',
    keywords: ['congruence'],
    complexity: 11000,
    // `modulo` is `number` (not `integer`) so a symbolic modulus expression
    // such as `p^{k+1}` (statically typed `number`, not `integer`) is
    // accepted and the congruence stays symbolic instead of erroring. The
    // `evaluate` handler only reduces when all three operands are concrete
    // integers (`toBigint`), so a non-integer modulus simply stays unevaluated.
    signature: '(number, number, modulo: number) -> boolean',
    evaluate: (ops, { engine: ce }) => {
      if (ops.length < 3) return undefined;
      const [lhs, rhs, modulo] = ops;
      // Congruence is integer arithmetic. Use bigint so it works under the
      // bignum-preferred default precision (where `.value` is not a JS
      // number), and reduce with a floored modulo so negatives are handled
      // correctly (JS `%` is a remainder: `-1 % 7 === -1`, not `6`).
      // A symbolic (non-integer) modulus stays unevaluated.
      const m = toBigint(modulo);
      if (m === null || m === 0n) return undefined;
      const mAbs = m < 0n ? -m : m;
      // Reduce each side to its canonical residue in [0, mAbs). `toBigint`
      // handles concrete integer literals directly; when it declines (e.g.
      // `2^(3^20)`, whose value can't be materialized), fall back to the
      // modular walker, which reduces in ℤ/mℤ without forming the integer.
      const reduce = (x: Expression): bigint | null => {
        const v = toBigint(x);
        if (v !== null) return ((v % mAbs) + mAbs) % mAbs;
        return reduceModulo(x, mAbs);
      };
      const a = reduce(lhs);
      const b = reduce(rhs);
      if (a === null || b === null) return undefined;
      return a === b ? ce.True : ce.False;
    },
  },

  IsSame: {
    description: 'Compare two expressions for structural equality',
    lazy: true,
    signature: '(any, any) -> boolean',

    // Since we want to work on non-canonical expressions,
    // do nothing to canonicalize the arguments (the lazy flag will prevent
    // canonicalization of the arguments)
    evaluate: (ops, { engine: ce }) => {
      if (ops.length !== 2) return undefined;
      const [lhs, rhs] = ops;
      return lhs.isSame(rhs) ? ce.True : ce.False;
    },
  },

  Equal: {
    description: 'Equality comparison (equal to).',
    complexity: 11000,
    signature: '(any, any) -> boolean',

    lazy: true,

    // Comparisons follow IEEE 754 for `NaN` and Kleene for the `Missing` symbol
    // (the Julia model, §3.D amended 2026-07-24). A `Missing` operand makes the
    // comparison `Missing` (Kleene); a `NaN` operand makes it `False` (IEEE:
    // `NaN == NaN` is `false`). Declared `handle` so a `Missing` operand
    // validates (its `missing` arm is stripped against the `any` parameter,
    // which already admits it, but the handle declaration keeps the gate off the
    // propagate path). Result type: `missing` when an operand is definitely
    // absent, `boolean | missing` when only possibly (an operand's type carries
    // the arm), `boolean` otherwise.
    missingBehavior: 'handle',

    type: (ops, { engine }) =>
      BoxedType.forResult(
        comparisonType('Equal', comparisonResultType, ops, engine.tolerance),
        engine._typeResolver
      ),

    // Broadcast element-wise over a list operand (Desmos `L[d=4]` filtering).
    // Restricted to the list-vs-scalar case by the exemption below: with two
    // or more collection operands the evaluate handler applies whole-list
    // (structural/mathematical) equality, a scalar boolean. See
    // docs/COLLECTIONS-MODEL.md.
    broadcastable: true,
    broadcastExemptions: ['whole-collection-compare'],

    canonical: (args, { engine: ce }) => canonicalRelational(ce, 'Equal', args),

    // Comparing two equalities...
    // Two equations are equivalent if they have the same solution set.
    // For polynomial equations, this means the LHS-RHS expressions differ
    // only by a non-zero constant factor.
    eq: (a, b, prover) => {
      // Relation equivalence (same solution set) is an *identity* question in
      // the free variables of the operands: prover tier only, per the ratified
      // audit (docs/LANGUAGE-MODEL.md). The cheap
      // arithmetic tier (`eq()` / `.isEqual()`) declines. `cmp()` passes no
      // flag, so its behavior is unchanged.
      if (prover === false) return undefined;
      if (a.operator !== b.operator) return undefined;
      if (!isFunction(a) || !isFunction(b)) return undefined;

      const ce = a.engine;

      // Get LHS - RHS for each equation
      const expr1 = a.op1.sub(a.op2);
      const expr2 = b.op1.sub(b.op2);

      // Handle special cases where expressions are zero (identity equations)
      const s1 = expr1.simplify();
      const s2 = expr2.simplify();
      const expr1Zero = s1.isSame(0) || (isNumber(s1) && s1.re === 0);
      const expr2Zero = s2.isSame(0) || (isNumber(s2) && s2.re === 0);

      // If both are identities (0 = 0), they're equivalent
      if (expr1Zero && expr2Zero) return true;

      // If only one is an identity, they're not equivalent
      if (expr1Zero || expr2Zero) return false;

      // Get unknowns from both expressions
      const unknowns = [...new Set([...expr1.unknowns, ...expr2.unknowns])];

      // If no unknowns, compare directly
      if (unknowns.length === 0) {
        const v1 = expr1.N().re;
        const v2 = expr2.N().re;
        if (!Number.isFinite(v1) || !Number.isFinite(v2)) return undefined;
        if (Math.abs(v2) < ce.tolerance) return false;
        // Both are constants - they differ by a constant factor if both are non-zero
        return (
          Math.abs(v1) > ce.tolerance &&
          Math.abs(v2) > ce.tolerance &&
          Number.isFinite(v1 / v2)
        );
      }

      // Sample-based check: if expr1/expr2 evaluates to the same constant
      // for multiple values of unknowns, they're likely equivalent
      const testValues = [0.5, 1.5, 2, -1, 3, -0.5, 0.7, 2.3];
      let constantRatio: number | undefined = undefined;
      const tolerance = ce.tolerance;

      for (let t = 0; t < testValues.length; t++) {
        // Assign an INDEPENDENT value to each unknown. Previously every
        // unknown was given the same value, so e.g. `x + y` and `2x` both
        // collapsed to `2·v` and compared equal. Rotating the sample pool by
        // the unknown's index (plus an index offset) keeps the unknowns
        // distinct within a trial and varies the assignment across trials.
        const sub: Record<string, number> = {};
        unknowns.forEach((u, j) => {
          sub[u] = testValues[(t + j * 3) % testValues.length] + j;
        });

        const v1 = expr1.subs(sub).N();
        const v2 = expr2.subs(sub).N();

        const n1 = v1.re;
        const n2 = v2.re;

        if (!Number.isFinite(n1) || !Number.isFinite(n2)) continue;
        if (Math.abs(n2) < tolerance) continue; // Skip if denominator is zero

        const r = n1 / n2;
        if (!Number.isFinite(r)) continue;

        if (constantRatio === undefined) {
          constantRatio = r;
        } else if (Math.abs(r - constantRatio) > tolerance) {
          // Ratio is not constant - equations are not equivalent
          return false;
        }
      }

      // If we found a constant ratio (non-zero), equations are equivalent
      if (constantRatio !== undefined && Math.abs(constantRatio) > tolerance) {
        return true;
      }

      return undefined;
    },

    // The operands are evaluated by the handlers (this operator is `lazy`,
    // see `chainedRelationHandlers`); the verdict is `decideEqual`.
    ...chainedRelationHandlers('Equal', decideEqual),
  } as OperatorDefinition,

  IdenticallyEqual: {
    description: [
      'Identity comparison (`\\equiv`).',
      'True iff the operands are equal for every value of their free variables.',
    ],
    complexity: 11000,

    signature: '(any, any) -> boolean',

    // `lazy` like `Equal`: the handlers evaluate the operands themselves.
    lazy: true,
    evaluatesOperands: true,

    // Same absence semantics as `Equal` (§3.D): a `Missing` operand makes the
    // comparison `Missing` (Kleene), a `NaN` operand makes it `False` (IEEE).
    missingBehavior: 'handle',

    type: (ops, context) =>
      BoxedType.forResult(
        relationalAbsenceType(ops),
        context.engine._typeResolver
      ),

    // Deliberately NOT `broadcastable`: this is a PROVER (is this an identity
    // in all the free variables?), not an arithmetic comparison, so a list
    // operand is compared as a whole rather than zipped element-wise.

    canonical: (args, { engine: ce }) =>
      canonicalRelational(ce, 'IdenticallyEqual', args),

    evaluate: (rawOps, { engine: ce, numericApproximation }) => {
      if (rawOps.length < 2) return ce.True;
      // `lazy` skips evaluating the arguments before this handler runs, so
      // evaluate them here (see the `Equal` handler).
      const ops = rawOps.map((op) => op.evaluate({ numericApproximation }));
      const vals = readComparisonAbsence(ce, ops);
      if (vals.some((op) => isSymbol(op, 'Missing'))) return ce.Missing;
      if (vals.some((op) => isNumber(op) && op.isNaN === true)) return ce.False;
      let lhs: Expression | undefined = undefined;
      for (const arg of ops) {
        if (!lhs) lhs = arg;
        else {
          // Two quantities compare by their physical value, like `Equal`
          // (`5 m ≡ 500 cm`): `eqIdentical()` asks the kinds
          // (`kindEqual()`).
          const test = eqIdentical(lhs, arg);
          if (test === false) return ce.False;
          // Undecidable stays INERT, like `Equal`: `x ≡ y` is a *claim*, not a
          // falsity. Note the prover degrades a sampled disagreement to
          // `undefined` (D9), so a non-identity such as `x ≡ x+1` also stays
          // inert rather than collapsing to `False`.
          if (test === undefined)
            return inertRelation(ce, 'IdenticallyEqual', rawOps, ops);
          lhs = arg;
        }
      }
      return ce.True;
    },
  } as OperatorDefinition,

  Same: {
    description: [
      'Structural identity comparison (Epsil `===`).',
      'True iff every adjacent pair of operands is structurally identical.',
    ],
    complexity: 11000,

    // Variadic (the Epsil parser emits a chained `a === b === c` as a single
    // n-ary `Same`). Documentary only: like the other `lazy` relations
    // (`Equal`, whose fixed `(any, any)` signature only works for the same
    // reason), argument validation is skipped.
    signature: '(any, any*) -> boolean',

    // `lazy`, so the operands are CANONICALIZED but never evaluated: `Same` is
    // strictly SYNTACTIC equality of the canonical forms. Canonicalization
    // still folds exact arithmetic (`Same(1+1, 2)` is `True`) and binds
    // structure, but it does NOT dereference a symbol's value — so `Same` never
    // depends on the current bindings, unlike `Equal`. `IsSame` remains the
    // fully raw counterpart (no canonicalization at all).
    //
    // A `lazy` operator with no `canonical` handler is inert on the box/parse
    // routes (its held operands arrive UNBOUND), hence the handler below; the
    // `evaluate` handler canonicalizes defensively too, since it consumes held
    // operands.
    lazy: true,

    canonical: (args, { engine: ce }) =>
      ce._fn(
        'Same',
        args.map((x) => x.canonical)
      ),

    //
    // Deliberately NOT `broadcastable`: `Same` is a structural predicate, so a
    // list operand is compared as a whole (`[1,2] === [1,2]` is the scalar
    // `True`, not a list of booleans). This is the point of the operator —
    // `Equal` is the broadcasting, tolerant, possibly-inert comparison.
    //
    // `handle` (rather than the default absence propagation) because `Same` is
    // TOTAL: it always decides. A `Missing` operand is just another structure
    // to compare — `Missing === Missing` is `True`, `Missing === 1` is `False`
    // — never a Kleene `Missing` result.
    missingBehavior: 'handle',

    // Total structural complement of `Equal`: where `Equal` may stay inert
    // (`x = y` is a *condition*) and compares numerically within tolerance
    // (`sqrt(2) = 1.4142135623730951` is `True`), `Same` always answers, uses
    // no tolerance, and never evaluates a radical to a float
    // (`sqrt(2) === 1.4142135623730951` is `False`). Same philosophy as the
    // structural totality of `match`.
    evaluate: (rawOps, { engine: ce }) => {
      if (rawOps.length < 2) return ce.True;
      const ops = rawOps.map((op) => op.canonical);
      for (let i = 1; i < ops.length; i++)
        if (!ops[i - 1].isSame(ops[i])) return ce.False;
      return ce.True;
    },
  },

  NotEqual: {
    description: 'Inequality comparison (not equal to).',
    wikidata: 'Q28113351',
    complexity: 11000,

    signature: '(any, any) -> boolean',

    // Kleene over the `Missing` symbol, IEEE over `NaN` (§3.D, family coherence
    // with `Equal`, amended 2026-07-24): `NotEqual(Missing, x) = Missing`;
    // `NotEqual(NaN, x) = True` (IEEE: `NaN != x` is `true`, incl. `NaN != NaN`).
    // Declared `handle` so a `Missing` operand validates and the propagate gate
    // stays off.
    missingBehavior: 'handle',

    type: (ops, { engine }) =>
      BoxedType.forResult(
        comparisonType('NotEqual', comparisonResultType, ops, engine.tolerance),
        engine._typeResolver
      ),

    // Broadcast element-wise over a list operand (list-vs-scalar only; two or
    // more collection operands compare whole, as at `Equal` above).
    broadcastable: true,
    broadcastExemptions: ['whole-collection-compare'],

    // `lazy` like `Equal`. The `canonical` handler makes the n-ary
    // `a ≠ b ≠ c` the conjunction `And(a ≠ b, b ≠ c)` (see
    // `canonicalComparisonChain`).
    lazy: true,

    canonical: (args, { engine: ce }) =>
      canonicalRelational(ce, 'NotEqual', args),

    // Comparing two equalities...
    eq: (a, b, prover) => {
      // Relation equivalence is an identity question in the free variables:
      // prover tier only (see `Equal`'s handler).
      if (prover === false) return undefined;
      if (a.operator !== b.operator) return undefined;
      if (!isFunction(a) || !isFunction(b)) return undefined;
      // Equality is commutative.
      // Comparing two relations asks whether they express the same condition:
      // an identity question in their free variables, hence the prover tier
      // (`isIdenticallyEqual`) rather than arithmetic `isEqual()`.
      if (
        (a.op1.isIdenticallyEqual(b.op1) === true &&
          a.op2.isIdenticallyEqual(b.op2) === true) ||
        (a.op1.isIdenticallyEqual(b.op2) === true &&
          a.op2.isIdenticallyEqual(b.op1) === true)
      )
        return true;
      // Three-valued: pairwise NON-identity does not prove the two relations
      // are non-equivalent (`x ≠ 1` and `x+1 ≠ 2` have the same solution set
      // with pairwise-different operands), and neither does a different
      // operator. Decline rather than assert a definitive `false`.
      return undefined;
    },

    // The operands are evaluated by the handlers (this operator is `lazy`,
    // see `chainedRelationHandlers`); the verdict is `decideNotEqual`.
    ...chainedRelationHandlers('NotEqual', decideNotEqual),
  } as OperatorDefinition,

  // Every relation of this family accepts a single operand as the degenerate
  // chain (`Less(3)` evaluates to `True`, `NotEqual(3)` to `False`), so the
  // declarations say `any*`: the boxing validation seam checks a
  // `canonical`-handler head against its declaration, and `any+` refused
  // the one-operand call with a `missing` error.
  Less: {
    description: 'Less-than comparison (strictly less than).',
    complexity: 11000,
    signature: '(any, any*) -> boolean',

    // Kleene over the `Missing` symbol, IEEE over `NaN` (§3.D, family coherence,
    // amended 2026-07-24): a `Missing` operand makes the ordering `Missing`; a
    // `NaN` operand makes it `False` (IEEE: `NaN` is unordered). `Greater`/
    // `GreaterEqual` canonicalize to `Less`/`LessEqual`, so this handler (and
    // `LessEqual`'s) covers all four orderings. Declared `handle` so a `Missing`
    // operand validates and the propagate gate stays off.
    missingBehavior: 'handle',
    // The Contract B declaration for the same arm (`docs/ERROR-MODEL.md`
    // §4): the handler owns `NaN` — it answers `False`, a success value in
    // the boolean codomain, per the IEEE unordered rule above. The
    // comparisons keep their wide `(any, any+)` carriers on purpose: the
    // chain decomposition (`a < b < c`), quantity and `Missing` operands
    // all ride through them, ordering is checked at evaluation, and as
    // `lazy` operators they sit in §4's sanctioned validation opt-out —
    // so the order-dependent "declare `(real)`" rule of §4 deliberately
    // does NOT reshape these signatures.
    nanBehavior: 'handle',

    type: (ops, { engine }) =>
      BoxedType.forResult(
        comparisonType('Less', relationalAbsenceType, ops, engine.tolerance),
        engine._typeResolver
      ),

    lazy: true,
    // Broadcast element-wise over a list operand so `L > 0` (canonicalizes to
    // `Less(0, L)`) yields a `list<boolean>` mask for Desmos `L[L>0]` filtering.
    broadcastable: true,
    canonical: (ops, { engine: ce }) => canonicalRelational(ce, 'Less', ops),

    eq: (a, b, prover) => inequalityEq(a, b, 'Greater', prover),

    // The operands are evaluated by the handlers (this operator is `lazy`,
    // see `chainedRelationHandlers`); the verdict is `decideLess`.
    ...chainedRelationHandlers('Less', decideLess),
  } as OperatorDefinition,

  NotLess: {
    description: 'Negated less-than relation (not less than).',
    complexity: 11000,
    signature: '(any, any*) -> boolean',
    canonical: (ops, { engine: ce }) =>
      ce._fn('Not', [canonicalRelational(ce, 'Less', ops)]),
  },

  Greater: {
    type: (ops, { engine }) =>
      BoxedType.forResult(
        comparisonType('Greater', relationalAbsenceType, ops, engine.tolerance),
        engine._typeResolver
      ),
    description: 'Greater-than comparison (strictly greater than).',
    complexity: 11000,
    signature: '(any, any*) -> boolean',
    // Same declared contract as `Less` (which this operator canonicalizes
    // into): the handler owns `NaN` — IEEE unordered → `False`.
    nanBehavior: 'handle',
    lazy: true,
    // Broadcast element-wise over a list operand (canonicalizes to `Less`; the
    // flag is kept here for a non-canonicalized `Greater`).
    broadcastable: true,
    // Pass the operator through unchanged (rather than reversing to `Less`
    // here). `canonicalRelational` needs the original direction to correctly
    // decompose mixed-direction chains (e.g. `a ≤ b > c`); the Greater→Less
    // normalization happens there, per chain segment.
    canonical: (ops, { engine: ce }) => canonicalRelational(ce, 'Greater', ops),
  },

  NotGreater: {
    description: 'Negated greater-than relation (not greater than).',
    complexity: 11000,
    signature: '(any, any*) -> boolean',
    canonical: (args, { engine: ce }) =>
      ce._fn('Not', [canonicalRelational(ce, 'Greater', args)]),
  },

  LessEqual: {
    description: 'Less-than-or-equal comparison (less than or equal to).',
    complexity: 11000,
    signature: '(any, any*) -> boolean',

    // Kleene over the `Missing` symbol, IEEE over `NaN` (§3.D, family coherence,
    // amended 2026-07-24); see `Less`. Covers `GreaterEqual` too (canonicalizes
    // here).
    missingBehavior: 'handle',
    // See `Less`: the handler owns `NaN` (IEEE unordered → `False`), and
    // the wide chain carrier is deliberate.
    nanBehavior: 'handle',

    type: (ops, { engine }) =>
      BoxedType.forResult(
        comparisonType(
          'LessEqual',
          relationalAbsenceType,
          ops,
          engine.tolerance
        ),
        engine._typeResolver
      ),

    lazy: true,
    // Broadcast element-wise over a list operand (see `Less`).
    broadcastable: true,
    canonical: (ops, { engine: ce }) =>
      canonicalRelational(ce, 'LessEqual', ops),

    eq: (a, b, prover) => inequalityEq(a, b, 'LessGreater', prover),

    // The operands are evaluated by the handlers (this operator is `lazy`,
    // see `chainedRelationHandlers`); the verdict is `decideLessEqual`.
    ...chainedRelationHandlers('LessEqual', decideLessEqual),
  } as OperatorDefinition,

  NotLessNotEqual: {
    description: 'Neither less than nor equal to.',
    complexity: 11000,
    signature: '(any, any*) -> boolean',
    canonical: (ops, { engine: ce }) =>
      ce._fn('Not', [canonicalRelational(ce, 'LessEqual', ops)]),
  },

  GreaterEqual: {
    type: (ops, { engine }) =>
      BoxedType.forResult(
        comparisonType(
          'GreaterEqual',
          relationalAbsenceType,
          ops,
          engine.tolerance
        ),
        engine._typeResolver
      ),
    description: 'Greater-than-or-equal comparison (greater than or equal to).',
    complexity: 11000,
    signature: '(any, any*) -> boolean',
    // Same declared contract as `LessEqual` (which this operator
    // canonicalizes into): the handler owns `NaN` — IEEE unordered →
    // `False`.
    nanBehavior: 'handle',

    lazy: true,
    // Broadcast element-wise over a list operand (canonicalizes to `LessEqual`).
    broadcastable: true,
    // Pass the operator through unchanged (see `Greater` above): the
    // GreaterEqual→LessEqual normalization is done per chain segment inside
    // `canonicalRelational`.
    canonical: (args, { engine: ce }) =>
      canonicalRelational(ce, 'GreaterEqual', args),
  },

  NotGreaterNotEqual: {
    description: 'Neither greater than nor equal to.',
    complexity: 11000,
    signature: '(any, any*) -> boolean',
    canonical: (args, { engine: ce }) =>
      ce._fn('Not', [canonicalRelational(ce, 'GreaterEqual', args)]),
  },

  TildeFullEqual: {
    description: 'Indicate isomorphism, congruence and homotopic equivalence',
    signature: '(any, any*) -> boolean',

    canonical: (args, { engine: ce }) =>
      canonicalRelational(ce, 'TildeFullEqual', args),
    evaluate: (ops, { engine: ce }) => evaluateApproxChain(ops, ce),
  },

  NotTildeFullEqual: {
    description:
      'Negated isomorphism/congruence relation (not isomorphic or congruent).',
    complexity: 11100,
    signature: '(any, any*) -> boolean',

    canonical: (args, { engine: ce }) =>
      ce._fn('Not', [canonicalRelational(ce, 'TildeFullEqual', args)]),
  },

  Tilde: {
    description:
      'Generic similarity relation (`\\sim`): similar geometric figures, asymptotic equivalence, or "is distributed as". Inert: stays symbolic.',
    complexity: 11000,
    signature: '(any, any*) -> boolean',
    canonical: (args, { engine: ce }) => canonicalRelational(ce, 'Tilde', args),
  },

  NotTilde: {
    description: 'Negated similarity relation (not similar).',
    complexity: 11100,
    signature: '(any, any*) -> boolean',
    canonical: (args, { engine: ce }) =>
      ce._fn('Not', [canonicalRelational(ce, 'Tilde', args)]),
  },

  TildeEqual: {
    description: 'Approximately or asymptotically equal',
    complexity: 11000,
    signature: '(any, any*) -> boolean',
    canonical: (args, { engine: ce }) =>
      canonicalRelational(ce, 'TildeEqual', args),
    evaluate: (ops, { engine: ce }) => evaluateApproxChain(ops, ce),
  },

  NotTildeEqual: {
    description:
      'Negated approximately/asymptotically-equal relation (not approximately equal).',
    complexity: 11100,
    signature: '(any, any*) -> boolean',

    canonical: (args, { engine: ce }) =>
      ce._fn('Not', [canonicalRelational(ce, 'TildeEqual', args)]),
  },

  Approx: {
    description: 'Approximate-equality relation (approximately equal).',
    complexity: 11100,
    // A single operand is a degenerate chain and evaluates to `True`
    // (`evaluateApproxChain`); the declaration admits it.
    signature: '(any, any*) -> boolean',
    canonical: (args, { engine: ce }) =>
      canonicalRelational(ce, 'Approx', args),
    evaluate: (ops, { engine: ce }) => evaluateApproxChain(ops, ce),
  },

  NotApprox: {
    description:
      'Negated approximate-equality relation (not approximately equal).',
    complexity: 11100,
    signature: '(any, any*) -> boolean',
    canonical: (args, { engine: ce }) =>
      ce._fn('Not', [canonicalRelational(ce, 'Approx', args)]),
  },

  ApproxEqual: {
    description: 'Approximately-equal relation.',
    complexity: 11100,
    signature: '(any, any*) -> boolean',
    canonical: (args, { engine: ce }) =>
      canonicalRelational(ce, 'ApproxEqual', args),
    evaluate: (ops, { engine: ce }) => evaluateApproxChain(ops, ce),
  },

  NotApproxEqual: {
    description: 'Negated approximately-equal relation.',
    complexity: 11100,
    canonical: (args, { engine: ce }) =>
      ce._fn('Not', [canonicalRelational(ce, 'ApproxEqual', args)]),
  },

  ApproxNotEqual: {
    description: 'Approximately-not-equal relation.',
    complexity: 11100,
    signature: '(any, any*) -> boolean',
    canonical: (args, { engine: ce }) =>
      canonicalRelational(ce, 'ApproxNotEqual', args),
    evaluate: (ops, { engine: ce }) => {
      const result = evaluateApproxChain(ops, ce);
      if (result === undefined) return undefined;
      return result === ce.True ? ce.False : ce.True;
    },
  },

  NotApproxNotEqual: {
    description: 'Negated approximately-not-equal relation.',
    complexity: 11100,
    signature: '(any, any*) -> boolean',
    canonical: (args, { engine }) =>
      engine._fn('Not', [canonicalRelational(engine, 'ApproxNotEqual', args)]),
  },

  Precedes: {
    description: 'Precedes relation in an ordering (comes before).',
    complexity: 11100,
    signature: '(any, any*) -> boolean',
    canonical: (args, { engine: ce }) =>
      canonicalRelational(ce, 'Precedes', args),
    evaluate: (ops, { engine: ce }) => {
      if (ops.length < 2) return ce.True;
      let prev = ops[0];
      for (let i = 1; i < ops.length; i++) {
        const result = prev.isLess(ops[i]);
        if (result === undefined) return undefined;
        if (result === false) return ce.False;
        prev = ops[i];
      }
      return ce.True;
    },
  },

  NotPrecedes: {
    description: 'Negated precedes relation (does not precede).',
    complexity: 11100,
    signature: '(any, any*) -> boolean',
    canonical: (args, { engine }) =>
      engine._fn('Not', [canonicalRelational(engine, 'Precedes', args)]),
  },

  Succeeds: {
    description: 'Succeeds relation in an ordering (comes after).',
    signature: '(any, any*) -> boolean',
    canonical: (args, { engine }) =>
      canonicalRelational(engine, 'Succeeds', args),
    evaluate: (ops, { engine: ce }) => {
      if (ops.length < 2) return ce.True;
      let prev = ops[0];
      for (let i = 1; i < ops.length; i++) {
        const result = ops[i].isLess(prev);
        if (result === undefined) return undefined;
        if (result === false) return ce.False;
        prev = ops[i];
      }
      return ce.True;
    },
  },

  NotSucceeds: {
    description: 'Negated succeeds relation (does not succeed).',
    complexity: 11100,
    signature: '(any, any*) -> boolean',
    canonical: (args, { engine }) =>
      engine._fn('Not', [canonicalRelational(engine, 'Succeeds', args)]),
  },
};

/**
 * May this operand turn out to be a collection at runtime? The
 * descriptor-shape reading of `isPossiblyCollectionTyped`
 * (`collection-utils.ts`): a top-typed APPLICATION may evaluate to one, a
 * `broadcastable<…>` type says so outright, and a union with a
 * `broadcastable` branch hides one the same way.
 */
function possiblyCollectionTypedOperand(d: OperandDescriptor): boolean {
  const t = resolveTypeAlias(d.type);
  if (t === 'unknown' || t === 'any' || t === 'value') {
    const s = d.structureOf?.();
    // A symbol declared `any` or `value` may hold a collection, as the
    // expression predicate reads it (user decision 2026-10-17, Tycho ledger
    // row 379): `a = [1, 2]` with `a: any` is `broadcastable<boolean>`, and
    // evaluates to `[True, False]` when `a` is 1. An auto-declared symbol
    // is typed `unknown` and stays a scalar.
    if ((t === 'any' || t === 'value') && s?.kind === 'symbol')
      return s.inferred !== true;
    const kind = s?.kind;
    return (
      kind === 'application' ||
      kind === 'tuple' ||
      kind === 'list-literal' ||
      kind === 'function-literal'
    );
  }
  if (typeof t === 'string') return false;
  if (t.kind === 'broadcastable') return true;
  if (t.kind !== 'union') return false;
  return t.types.some((branch) => {
    const b = resolveTypeAlias(branch);
    return typeof b !== 'string' && b.kind === 'broadcastable';
  });
}

/**
 * Result-type handler for the absence-aware relational operators
 * (`IdenticallyEqual`, `Less`, `LessEqual`; `Equal` and `NotEqual` apply it
 * first, through `comparisonResultType`). Mirrors §3.D: a
 * definitely-absent operand (`missing`) makes the result `missing`; a
 * possibly-absent operand (an operand type carrying a `missing` arm) makes it
 * `boolean | missing`; otherwise `boolean` (unchanged). A `NaN` operand is not
 * visible at the type level (its static type is `number`), so it does not
 * widen the result type — the IEEE `False`/`True` is a runtime-only outcome.
 */
function relationalAbsenceType(ops: ReadonlyArray<OperandDescriptor>) {
  let definite = false;
  let possible = false;
  for (const op of ops) {
    const absence = operandAbsence(op);
    if (absence === 'definite') definite = true;
    else if (absence === 'possible') possible = true;
  }
  if (definite) return 'missing';
  if (possible) return parseType('boolean | missing');
  return 'boolean';
}

/**
 * Can this operand be absent when it is evaluated? `'definite'` when its type
 * is exactly `missing`, `'possible'` when it may be absent, `undefined` when
 * it cannot be. The comparisons (`relationalAbsenceType`) and the logical
 * connectives (`connectiveType` in `library/logic.ts`) read an operand with
 * the same test, so that they agree on which operands make a `Missing`
 * result reachable.
 */
export function operandAbsence(
  op: OperandDescriptor
): 'definite' | 'possible' | undefined {
  const t = op.type;
  if (t === 'missing') return 'definite';
  // Any `missing` arm, a numeric one (`number | missing`) included, makes
  // the Kleene `Missing` result reachable: a comparison with an absent
  // operand is absent, in a numeric slot too (user decision 2026-10-23,
  // ROADMAP CE-93). Before, a numeric slot read its absent value as `NaN`
  // and the comparison was a plain boolean, so `w > 0` was `False` while
  // `If(w > 0, 1, 0)` had no value.
  if (typeContainsMissing(t)) return 'possible';
  // The library `Undefined` symbol is typed `unknown`, which has no
  // `missing` arm, but the evaluate handlers read it as an absent operand
  // (`readComparisonAbsence`): `Less(Undefined, 3)` evaluates to `Missing`.
  // Its type is read from the symbol itself, so that the result type admits
  // that value.
  if (isUndefinedSymbolOperand(op)) return 'possible';
  return undefined;
}

/** Is the operand the `Undefined` symbol? The test is on the name only, as
 * the value-level test `isAbsentSymbol` is: the symbol has no value
 * definition, so the structure node never carries the `system` flag. */
function isUndefinedSymbolOperand(op: OperandDescriptor): boolean {
  const s = op.structureOf?.();
  return s?.kind === 'symbol' && s.name === 'Undefined';
}

type ComparisonHead =
  'Less' | 'LessEqual' | 'Greater' | 'GreaterEqual' | 'Equal' | 'NotEqual';

/**
 * A comparison's VALUE type — `true` or `false` — when the operands' TYPES
 * and facts decide it, else `undefined` (boolean value types,
 * `docs/plans/2026-08-29-boolean-value-types.md` §3.1). Layered strictly
 * onto the head's absence/broadcast answer: `comparisonType` calls it only
 * when that answer is the bare, scalar `boolean`, so an operand that may
 * be absent or collection-shaped never reaches it. The proof reads
 * intervals only (`intervalOfType` — a NaN-admitting operand has none and
 * declines automatically; `NaN < 1` and `NaN == NaN` are both `False`, so
 * no order proof may be built over a possible NaN).
 *
 * `Equal`: two number literals compare by VALUE through
 * `operandLiteralValue` (which unifies the value-node and the rational
 * singleton spellings: `0.5` and `1/2` are equal) — never by comparing
 * type nodes, since `True` and `False` both type the bare `boolean` and
 * two large integers can share one coarse range. The same SYMBOL on both
 * sides proves `true` only when its type is NaN-free (`NaN ≠ NaN`); the
 * absence case was already excluded by the caller.
 */
function comparisonValueType(
  head: ComparisonHead,
  ops: ReadonlyArray<OperandDescriptor>,
  tolerance: number
): Type | undefined {
  if (ops.length !== 2) return undefined;
  const [a, b] = ops;
  const verdict = (v: boolean): Type => ({ kind: 'value', value: v });

  if (head === 'Equal' || head === 'NotEqual') {
    const eq = literalEquality(a, b);
    if (eq !== undefined) return verdict(head === 'Equal' ? eq : !eq);
  }
  const ia = intervalOfType(a.type);
  const ib = intervalOfType(b.type);
  if (ia === undefined || ib === undefined) return undefined;
  const c = compareIntervals(ia, ib);
  if (c === undefined) return undefined;
  // The evaluated comparison is TOLERANCE-based: `Less(0.3, 0.3 + 1e-12)`
  // evaluates `False` and `Equal` of the pair evaluates `True`, because
  // two numbers closer than `engine.tolerance` count as equal. A claim
  // that the operands are SEPARATED (`Less` is `true`, `Equal` is
  // `false`) therefore needs the gap between the two ranges to exceed
  // the tolerance in force when the type is derived; the non-strict
  // claims (`LessEqual` is `true` when `a` ends where `b` starts) agree
  // with the tolerant evaluation as they stand.
  const tol = tolerance;
  const eq = c === 'equal';
  const lt = c === 'less' && ib.lo - ia.hi > tol;
  const gt = c === 'greater' && ia.lo - ib.hi > tol;
  const le = eq || c === 'less' || c === 'lessOrEqual';
  const ge = eq || c === 'greater' || c === 'greaterOrEqual';
  switch (head) {
    case 'Less':
      return lt ? verdict(true) : ge ? verdict(false) : undefined;
    case 'Greater':
      return gt ? verdict(true) : le ? verdict(false) : undefined;
    case 'LessEqual':
      return le ? verdict(true) : gt ? verdict(false) : undefined;
    case 'GreaterEqual':
      return ge ? verdict(true) : lt ? verdict(false) : undefined;
    case 'Equal':
      return eq ? verdict(true) : lt || gt ? verdict(false) : undefined;
    case 'NotEqual':
      return eq ? verdict(false) : lt || gt ? verdict(true) : undefined;
  }
}

/** Equality of two operands decided WITHOUT intervals: the same symbol
 * (NaN-free by type), or two number literals with the SAME value. Two
 * literals with different values are left to the interval proof, which
 * applies the tolerance gate (`comparisonValueType`): `0.3` and
 * `0.3 + 1e-12` are different values but evaluate as equal. */
function literalEquality(
  a: OperandDescriptor,
  b: OperandDescriptor
): boolean | undefined {
  const sa = a.structureOf?.();
  const sb = b.structureOf?.();
  if (sa?.kind === 'symbol' && sb?.kind === 'symbol' && sa.name === sb.name)
    return intervalOfType(a.type) !== undefined ? true : undefined;
  const va = operandLiteralValue(a);
  const vb = operandLiteralValue(b);
  if (va !== undefined && vb !== undefined && va === vb) return true;
  return undefined;
}

/** The head's existing absence/broadcast answer, refined to a VALUE type
 * when the proof exists. `base` is the head's own result-type function
 * (`comparisonResultType` for the equality heads, `relationalAbsenceType`
 * for the ordering heads), whose non-`boolean` answers are kept as is. */
function comparisonType(
  head: ComparisonHead,
  base: (ops: ReadonlyArray<OperandDescriptor>) => Type,
  ops: ReadonlyArray<OperandDescriptor>,
  tolerance: number
): Type {
  const t = base(ops);
  if (t !== 'boolean') return t;
  return comparisonValueType(head, ops, tolerance) ?? 'boolean';
}

/**
 * Result-type handler for `Equal`/`NotEqual`.
 *
 * These two operators broadcast element-wise ONLY in the list-vs-scalar case:
 * `Equal([1,2,3], 2)` is the mask `[False, True, False]`, while two collection
 * operands are compared as a whole and yield a single boolean. (That rule is
 * applied at evaluation by `broadcastableComparisonOperands` below and by its
 * pre-evaluation twin `skipBroadcastForVectorOps` in
 * `boxed-expression/boxed-function.ts`.)
 *
 * Which of the two outcomes applies is not always decidable statically. When
 * one operand is DEFINITELY a collection and another is only POSSIBLY one —
 * a top-typed application such as `At(U, 1)` where `U` is declared bare
 * `indexed_collection`, or an operand already typed `broadcastable<…>` — the
 * answer is only fixed once that operand evaluates: a scalar makes the result
 * an element-wise `list<boolean>` mask, a collection makes it a scalar
 * `boolean`. `broadcastable<boolean>` is exactly the type that admits both
 * (it is the union `boolean | list<boolean>`), and it is the
 * spelling the engine already gives every other possibly-broadcast result.
 *
 * Answering the scalar `boolean` there was a type/value disagreement rather
 * than a conservative approximation: a possibly-collection operand also makes
 * the pre-evaluation broadcast gate skip, so nothing lifted the declared type,
 * yet the evaluate handler went on to broadcast over the definite collection
 * and produced a list. `\sum_i Which(C = U_i, i, 0)` with both symbols
 * declared `indexed_collection` typed `number` while evaluating to `[1,2,1]`.
 *
 * Two-or-more DEFINITE collections stay the scalar `boolean`: that is the
 * whole-collection compare, decided statically. With no possibly-collection
 * operand at all the plain `boolean` also stands, and the generic broadcast
 * typing in `boxed-function.ts` lifts it to `list<boolean>` when a definite
 * collection is present.
 */
function comparisonResultType(ops: ReadonlyArray<OperandDescriptor>): Type {
  const absence = relationalAbsenceType(ops);
  // An absent operand decides the result before broadcasting is even reached
  // (`missing`/`boolean | missing` per §3.D), so leave those answers alone.
  if (absence !== 'boolean') return absence;
  if (!ops.some((op) => possiblyCollectionTypedOperand(op))) return 'boolean';
  // The DEFINITE half of the operand count `skipBroadcastForVectorOps` and
  // `broadcastableComparisonOperands` share — an enumerable collection value,
  // or a valueless operand whose declared type is definitely a collection.
  // The descriptor merges those two channels into one fact: `collection` is
  // `true` exactly when the type proves the shape OR the value enumerates,
  // which is the union those two predicates spell out separately.
  const definiteCollections = ops.filter(
    (op) => op.facts.collection === true
  ).length;
  if (definiteCollections >= 2) return 'boolean';
  return { kind: 'broadcastable', elements: 'boolean' };
}

/**
 * Absence read for comparison operands (§3.D).
 *
 * An operand that EVALUATED to an absence symbol is Kleene, whatever the
 * type of the operand it evaluated from: in a numeric slot
 * (`number | missing`) too, the comparison is `Missing` (user decision
 * 2026-10-23, ROADMAP CE-93), as the condition of an `If` reads it. Before,
 * such a slot read its absent value as `NaN`, and `w > 0` was `False`.
 *
 * An `Undefined` operand is normalized to the `Missing` symbol here, so that
 * the one test each caller makes afterwards — "is an operand the `Missing`
 * symbol?" — decides for both absence symbols.
 */
function readComparisonAbsence(
  ce: ComputeEngine,
  ops: ReadonlyArray<Expression>
): ReadonlyArray<Expression> {
  if (!ops.some(isAbsentScalarSymbol)) return ops;
  return ops.map((op) => (isAbsentScalarSymbol(op) ? ce.Missing : op));
}

/**
 * May an `Equal`/`NotEqual` over these EVALUATED operands broadcast
 * element-wise, or does it stay a whole-collection boolean?
 *
 * This must apply the same rule as `skipBroadcastForVectorOps` (step 2 in
 * `boxed-function`), because that is the step this handler defers from: step 2
 * skips whenever two or more operands are collections **or possibly-collection
 * typed**, and hands the decision here "with full information".
 *
 * Counting only `isCollection` here made the two rules DISAGREE, and the
 * disagreement was an infinite loop rather than a wrong answer. An application
 * with a top type (`A(t)` with `A` undeclared) is possibly-collection typed and
 * stays so after evaluation — it never resolves. Step 2 therefore skipped
 * forever, this handler counted one collection, `broadcastComparison` rebuilt
 * the identical node, and evaluating it re-entered step 2: `A(t) = [1, 2]`
 * overflowed the stack out of `evaluate()` on a bare engine.
 *
 * Deferring is still what step 2 intends: an opaque operand that turns out to
 * be a genuine scalar has a concrete type by the time it reaches here, so it no
 * longer counts and the element-wise broadcast happens exactly as before.
 */
function broadcastableComparisonOperands(
  ops: ReadonlyArray<Expression>
): boolean {
  return (
    ops.filter(
      (op) =>
        // A STRING is a collection of its characters in the lattice, but it is
        // ATOMIC here — it must stay the SCALAR side of a list-vs-scalar
        // comparison, so `Equal([1,2,3], "a")` keeps broadcasting element-wise
        // instead of degrading to whole-collection equality. Must stay in
        // lockstep with `skipBroadcastForVectorOps`
        // (`boxed-expression/boxed-function.ts`), which excludes it too.
        !isTextAtom(op) &&
        (op.isCollection ||
          isPossiblyCollectionTyped(op) ||
          // A DEFINITELY collection-typed operand that is not a collection NODE:
          // a symbol declared `vector<2>` with no value, or an application
          // `L(1)` under `L: (number) -> vector<2>`. `isCollection` is false
          // (nothing to enumerate) and the concrete type is neither top nor
          // `broadcastable`, so the two predicates above both miss it. This
          // disjunct must stay in lockstep with `skipBroadcastForVectorOps`
          // (`boxed-expression/boxed-function.ts`), which gained the same test
          // on 2026-08-15 when placeholder-signature refinement started giving
          // such operands their concrete collection types: while only step 2
          // counted them, step 2 skipped and this handler broadcast, so
          // `broadcastComparison` rebuilt the identical node and evaluating it
          // re-entered step 2 — `M = [1,2]` with `M: vector<2>` overflowed the
          // stack out of `evaluate()` on a bare engine, in the same way the
          // top-typed case described above once did.
          op.type.matches('collection<any>'))
    ).length < 2
  );
}

/**
 * Does the element recursion of a whole-collection comparison of `a` against
 * `b` meet a pair that has NO answer?
 *
 * One undecided element pair makes the whole comparison undecided (user
 * ruling of 2026-09-21). An absent cell can stand for any value, so no walk
 * of the cells that ARE there can tell whether the two collections hold the
 * same values. The rule holds even when another pair is decidedly unequal:
 * `Equal([1, Missing, 3], [2, Missing, 3])` answers the absent marker, not
 * `False`, because equality asks about the two collections as a whole and
 * that question still has no answer. `NotEqual` answers the same marker, so
 * neither operator ever reports a confident truth it cannot support. The
 * marker is `Missing` here and `NaN` in compiled code, where `eqTensor`
 * (`compilation/javascript-target.ts`) applies the same fold.
 *
 * Three shapes stay DECIDED, and the walk declines each of them:
 * - a length mismatch (`ca !== cb`): no value in an absent cell can make 2
 *   elements equal 3, so the comparison is `False` as it always was;
 * - a cell pair of different SHAPE (a nested list against a scalar), which
 *   the comparison decides `False` whatever the cells hold;
 * - a pair left undecided by FREE VARIABLES (`Equal([x], [y])`): that is not
 *   absence. The comparison stays INERT, exactly as the scalar `x = y` does,
 *   which keeps a list equation usable as an equation.
 *
 * Two `List` nodes of machine doubles cannot hold an absent cell, so they
 * skip the walk (`holdsDoubles` memoizes its answer per list, and it reads
 * the OPERANDS of the node, which is why the `List` head is required: the
 * operands of a `Range` or a `Map` are its bounds or its callback, not its
 * elements). Text is skipped for the same reason: a character is never
 * absent.
 */
function undecidedElementPair(a: Expression, b: Expression): boolean {
  if (isAbsentScalarSymbol(a) || isAbsentScalarSymbol(b)) return true;
  if (!a.isCollection || !b.isCollection) return false;
  if (isTextAtom(a) || isTextAtom(b)) return false;
  if (
    isFunction(a, 'List') &&
    isFunction(b, 'List') &&
    holdsDoubles(a) &&
    holdsDoubles(b)
  )
    return false;
  const ca = a.count;
  const cb = b.count;
  if (ca === undefined || cb === undefined || ca !== cb) return false;
  if (!Number.isFinite(ca)) return false;
  if (a.isIndexedCollection && b.isIndexedCollection) {
    const itB = b.each();
    for (const xa of a.each()) {
      const xb = itB.next();
      if (xb.done) return false;
      if (undecidedElementPair(xa, xb.value)) return true;
    }
    return false;
  }
  // Unordered (set-like) collections are compared by membership, not by
  // position, so there is no element PAIR to test: an absent element on
  // either side leaves every membership question about it unanswered.
  for (const x of a.each()) if (isAbsentScalarSymbol(x)) return true;
  for (const x of b.each()) if (isAbsentScalarSymbol(x)) return true;
  return false;
}

/**
 * Is a whole-collection `Equal`/`NotEqual` over these EVALUATED operands
 * undecided because its element recursion meets a pair with no answer?
 *
 * Only the whole-collection shape is concerned — two or more collection
 * operands. The ELEMENT-WISE shape (a collection against a scalar, such as
 * `Equal([1, Missing], 1)`) has already broadcast by the time this is asked,
 * and it marks exactly the absent POSITIONS, which is a different and
 * unchanged answer. Adjacent operands are paired the way the handlers'
 * own loops pair them, so a chain (`a = b = c`) is undecided as soon as one
 * of its adjacent pairs is.
 */
function absentCollectionComparison(ops: ReadonlyArray<Expression>): boolean {
  if (ops.filter((op) => op.isCollection).length < 2) return false;
  for (let i = 1; i < ops.length; i++) {
    const a = ops[i - 1];
    const b = ops[i];
    if (a.isCollection && b.isCollection && undecidedElementPair(a, b))
      return true;
  }
  return false;
}

/**
 * Is a whole-collection `Equal`/`NotEqual` over these operands UNDECIDED?
 *
 * Once the element-wise broadcast has declined, a collection operand is
 * compared structurally against the other side. That is only sound when both
 * sides have resolved: an opaque operand (a top-typed application such as
 * `q(2)`, or a `broadcastable<T>` node) may still BE that collection, so
 * answering `False` would claim a mismatch the engine cannot see. Stay inert
 * instead — the same rule the handlers already apply to `x^2 = 4`.
 *
 * "Unresolved" includes an operand that is DEFINITELY collection-typed but
 * carries no value — a symbol declared `vector<2>`, or an application whose
 * head returns one. Such an operand is exactly as unresolved as an opaque one,
 * and for the same reason: it may still be equal to the other side. This
 * predicate is the last line of defense before the structural comparison, so
 * omitting them here would rest on `eq()` happening to decline for a free
 * variable — true today, but a coincidence rather than a guarantee, and it
 * would become an unsound `False` the moment `eq()` grew stronger. It also
 * keeps this in step with `broadcastableComparisonOperands` above, whose twin
 * `skipBroadcastForVectorOps` (`boxed-expression/boxed-function.ts`) applies
 * the same test. When those two disagreed, the pre-evaluation guard skipped,
 * this handler broadcast and rebuilt the identical node, and evaluating it
 * re-entered the pre-evaluation guard — `M = [1,2]` with `M` declared
 * `vector<2>` overflowed the stack out of `evaluate()` on a bare engine.
 * Pinned by `test/compute-engine/relational-broadcast-recursion.test.ts`.
 */
function undecidedCollectionComparison(
  ops: ReadonlyArray<Expression>
): boolean {
  // `isUnresolvedCollectionOperand` sees an operand with no value that is
  // typed as a collection, and one whose type only admits a collection
  // (`P: number | collection<number>`): `P = [1, 2]` may still be `True`.
  const unresolved = (op: Expression): boolean =>
    isPossiblyCollectionTyped(op) || isUnresolvedCollectionOperand(op);
  return ops.some(unresolved) && ops.some((op) => op.isCollection);
}

/**
 * The verdict of `Equal` (`negate` false) or `NotEqual` (`negate` true) over
 * operands of which one or more is a collection that holds a failed cell (an
 * element that is, or holds, an `Error`), or `undefined` when no operand
 * holds one.
 *
 * Each adjacent pair gets its own verdict (`failedCellEquality()`): equal,
 * different, the error of a failed cell that the comparison reaches (the
 * verdict depends on its value), or undecided. The pair verdicts combine as
 * the chain does. A pair that refutes the chain decides it: a pair that is
 * different makes `Equal` `False`, a pair that is equal makes `NotEqual`
 * `False` (`NotEqual([1], [1], [2, <error>])` is `False`). Otherwise the
 * answer is the error of the first pair that gives one, then `'undecided'`
 * (the caller keeps the comparison inert) when a pair is undecided, and the
 * value of the chain when every pair is decided.
 *
 * `isSame()` and `isEqual()` do not change: they compare the trees.
 */
function failedCellComparison(
  ce: ComputeEngine,
  ops: ReadonlyArray<Expression>,
  negate: boolean
): Expression | 'undecided' | undefined {
  if (!ops.some(holdsFailedCell)) return undefined;
  const budget: WalkBudget = { left: ce.maxCollectionSize, exhausted: false };
  let error: Expression | undefined;
  let undecided = false;
  for (let i = 1; i < ops.length; i++) {
    const verdict = failedCellEquality(ops[i - 1], ops[i], budget);
    if (verdict === (negate ? true : false)) return ce.False;
    if (verdict === true || verdict === false) continue;
    if (verdict === undefined) undecided = true;
    else error ??= verdict;
  }
  // A walk that used up the budget did not see every pair, and a pair that
  // it did not see could refute the chain: the answer is undecided, also
  // when an earlier pair gave an error.
  if (budget.exhausted) return 'undecided';
  if (error !== undefined) return error;
  if (undecided) return 'undecided';
  // Every pair is decided and none refutes the chain. For `NotEqual`, every
  // pair is different. For `Equal` this is not reached: a pair with an
  // operand that holds a failed cell is never `true`.
  return ce.True;
}

/** The pairs of elements that the walks of one `failedCellComparison()`
 * may still compare, and whether a walk stopped because there were none
 * left. */
type WalkBudget = { left: number; exhausted: boolean };

/** True when `x` is a collection that holds a failed cell. */
function holdsFailedCell(x: Expression): boolean {
  return !x.isValid && !isInvalidNonCollection(x);
}

/**
 * The verdict of `failedCellComparison()` for two operands: `true` (equal),
 * `false` (different), the error of a failed cell that the comparison
 * reaches, or `undefined` (undecided).
 *
 * Two collections are different, with no walk, when the facts that `eq()`
 * reads for two valid collections prove it: one is a set and the other is
 * not, one is a string or a `Tuple` and the other is not, or their counts
 * are known and differ, an infinite count included (`[1, <error>]` and
 * `Range(1, 10^12)` or `Range(1, +oo)`). Otherwise two finite indexed
 * collections are walked together, one element at a time, and the walk
 * stops at the first pair of elements that are different. A walk that ends
 * with no such pair is the error of the first failed cell that it met. Any
 * other pair (two sets) is the error: whether a failed cell matches an
 * element depends on its value.
 *
 * The walks of all the levels and of all the pairs of a chain share
 * `budget`, at most `maxCollectionSize` pairs of elements. A walk that uses
 * it up sets `budget.exhausted` and is undecided, since a pair that it did
 * not see could still be different (the answer would then be `False`, not
 * the error).
 */
function failedCellEquality(
  a: Expression,
  b: Expression,
  budget: WalkBudget
): boolean | Expression | undefined {
  const aHolds = holdsFailedCell(a);
  const bHolds = holdsFailedCell(b);
  if (!aHolds && !bHolds) {
    // A failed scalar cell (an `Error`) is equal to nothing that is known.
    if (!a.isValid || !b.isValid)
      return failedCellError(a) ?? failedCellError(b);
    const order = exactLiteralOrder(a, b);
    return order !== undefined ? order === 0 : eq(a, b);
  }
  const error = failedCellError(aHolds ? a : b);
  if (!a.isCollection || !b.isCollection) return error;
  // The kinds and the counts first: these prove a difference whatever the
  // value of the failed cell.
  if (a.type.matches('set<any>') !== b.type.matches('set<any>')) return false;
  if (isString(a) !== isString(b)) return false;
  if (isFunction(a, 'Tuple') !== isFunction(b, 'Tuple')) return false;
  if (
    a.isFiniteCollection !== undefined &&
    b.isFiniteCollection !== undefined &&
    a.isFiniteCollection !== b.isFiniteCollection
  )
    return false;
  const countA = a.count;
  const countB = b.count;
  // A `bigint` count is compared as a number: two different counts that
  // round to the same number are walked, and the walk is bounded.
  if (
    countA !== undefined &&
    countB !== undefined &&
    Number(countA) !== Number(countB)
  )
    return false;
  // Two collections are compared cell by cell when both have positions. A
  // set has none, so whether a failed cell matches an element of the other
  // set depends on its value.
  if (
    a.isIndexedCollection !== true ||
    b.isIndexedCollection !== true ||
    a.isFiniteCollection !== true ||
    b.isFiniteCollection !== true
  )
    return error;
  const xs = a.each()[Symbol.iterator]();
  const ys = b.each()[Symbol.iterator]();
  let first: Expression | undefined;
  let undecided = false;
  while (true) {
    const x = xs.next();
    const y = ys.next();
    if (x.done || y.done) {
      if (x.done !== y.done) return false;
      break;
    }
    if (--budget.left < 0) {
      budget.exhausted = true;
      return undefined;
    }
    const verdict = failedCellEquality(x.value, y.value, budget);
    if (verdict === false) return false;
    if (verdict === undefined) undecided = true;
    else if (verdict !== true) first ??= verdict;
  }
  // An inner walk that used up the budget did not see every pair.
  if (budget.exhausted) return undefined;
  if (first !== undefined) return first;
  return undecided ? undefined : error;
}

/**
 * Post-evaluation element-wise broadcast for the `lazy` comparison operators.
 *
 * `Less`/`LessEqual` are `lazy`, so the generic broadcast in `boxed-function`
 * (steps 2 and 4b) does not fire when an operand only *becomes* a collection
 * after evaluation — e.g. `|[1...5]-2| > 0`, whose operand `Abs(Add(…, Range))`
 * is not a materialized collection until evaluated. The handlers evaluate their
 * operands internally; once evaluated, if any operand is a finite indexed
 * collection, rebuild the comparison so the generic broadcast (step 2) zips it
 * into a `list<boolean>`. Reusing the already-evaluated operands means no
 * double evaluation on the scalar path.
 */
function broadcastComparison(
  ce: ComputeEngine,
  operator: string,
  ops: ReadonlyArray<Expression>,
  numericApproximation: boolean | undefined
): Expression | undefined {
  // Tuples are excluded, matching the pre-evaluation broadcast (step 2 in
  // boxed-function): a `Tuple` is an atomic value, never mapped over. Without
  // the exclusion, a tuple-only comparison re-enters evaluate — whose step 2
  // now skips tuples — and ping-pongs back here forever (stack overflow).
  if (!ops.some((op) => isFiniteBroadcastParticipant(op))) return undefined;
  // A collection that is not indexed (a set, an interval, a dictionary) is
  // excluded too. It has no positions, and step 2 DECLINES a broadcast when
  // such an operand is at a number parameter, or is an operand of an
  // ordering comparison (`unindexedOperandBroadcast` in boxed-function). For
  // such an operator, re-entering evaluate here would come straight back and
  // recurse until the stack is exhausted. An ordering comparison cannot pair
  // such a collection with the cells of a list, and a set has no order with
  // a number, so the comparison is the `incompatible-type` error that `Sin`
  // and `Add` give for a set: `Less(Set(5, 6), [1, 2])` is
  // `Error(incompatible-type, number, set<integer>)`. Beside no list, the
  // comparison stays inert, as `1 < Set(1, 2)` is.
  if (ops.some(isUnindexedCollectionOperand)) {
    if (operator !== 'Less' && operator !== 'LessEqual') return undefined;
    return nonNumericOperandError(ce, ops.filter(isUnindexedCollectionOperand));
  }
  // A collection-TYPED but valueless operand is excluded for the same reason,
  // and it is the same ping-pong: step 2 DECLINES such a comparison (it would
  // splice the valueless operand into every cell as a scalar — see
  // `hasUnresolvedCollectionOperand`), so re-entering evaluate here would come
  // straight back and recurse until the stack is exhausted. Declining leaves
  // the comparison inert, which is what the veto wants; once the operand is
  // assigned it broadcasts normally.
  if (hasUnresolvedCollectionOperand(ops, isBroadcastableCollection)) {
    // A length disagreement among the operands that DO have values outranks the
    // veto: no assignment to the unresolved operand can reconcile 2 elements
    // against 3, so the comparison is the same error it would be without that
    // operand, rather than an inert form waiting on a value.
    const mismatch = broadcastLengthMismatch(ce, ops);
    if (mismatch) return mismatch;
    return undefined;
  }
  return ce._fn(operator, ops).evaluate({ numericApproximation });
}

/**
 * Check if two expressions are approximately equal, i.e. their numeric
 * values differ by at most `ce.tolerance`.
 * Returns `true`, `false`, or `undefined` if the comparison can't be made.
 */
function approxEq(a: Expression, b: Expression): boolean | undefined {
  const ce = a.engine;
  // An operand with unknowns cannot numericize, so the `isNumber` test below
  // would reject it after an unbounded (exponential, for nested user-function
  // applications) traversal.
  if (a.unknowns.length > 0 || b.unknowns.length > 0) return undefined;
  const aN = a.N();
  const bN = b.N();

  if (!isNumber(aN) || !isNumber(bN)) return undefined;

  const diff = aN.sub(bN);
  if (!isNumber(diff)) return undefined;

  const n = diff.numericValue;
  if (typeof n === 'number') return ce.chop(n) === 0;
  return n.isZeroWithTolerance(ce.tolerance);
}

/**
 * Evaluate a chain of approximately-equal comparisons:
 * `a ≈ b ≈ c` means `a ≈ b` and `b ≈ c`.
 */
function evaluateApproxChain(
  ops: ReadonlyArray<Expression>,
  ce: ComputeEngine
): Expression | undefined {
  if (ops.length < 2) return ce.True;
  let prev = ops[0];
  for (let i = 1; i < ops.length; i++) {
    const result = approxEq(prev, ops[i]);
    if (result === false) return ce.False;
    if (result === undefined) return undefined;
    prev = ops[i];
  }
  return ce.True;
}

// The comparison operators whose n-ary form is canonicalized by
// `canonicalComparisonChain`. The LaTeX parser chains the same operators
// (`CHAINABLE_COMPARISONS` in `latex-syntax/comparison-chain.ts`).
const CHAINABLE_COMPARISON = new Set([
  'Less',
  'LessEqual',
  'Greater',
  'GreaterEqual',
  'Equal',
  'NotEqual',
  'IdenticallyEqual',
]);

function canonicalRelational(
  ce: ComputeEngine,
  operator: string,
  ops: ReadonlyArray<Expression>
): Expression {
  // Core comparisons need the direction-aware chain handling in
  // `canonicalComparisonChain`.
  if (CHAINABLE_COMPARISON.has(operator))
    return canonicalComparisonChain(ce, operator, ops);

  // Legacy path for the other relational operators (approx/precedes/…). These
  // are not `lazy` and never flip direction, so the simple boundary-term
  // splice below is adequate.
  ops = flatten(ops, operator);

  const nestedRelational: Expression[] = [];
  const newOps: Expression[] = [];
  for (let i = 0; i < ops.length; i++) {
    const op = ops[i];
    if (isRelationalOperator(op.operator) && isFunction(op)) {
      nestedRelational.push(op);
      newOps.push(i === 0 ? op.ops[op.ops.length - 1] : op.ops[0]);
    } else newOps.push(op);
  }

  if (nestedRelational.length === 0) return ce._fn(operator, newOps);

  return ce._fn('And', [ce._fn(operator, newOps), ...nestedRelational]);
}

/** Build a single (n-ary) canonical comparison, normalizing the direction:
 *  `Greater`→`Less` and `GreaterEqual`→`LessEqual` (with the terms reversed). */
function buildComparison(
  ce: ComputeEngine,
  operator: string,
  terms: ReadonlyArray<Expression>
): Expression {
  if (operator === 'Greater') return ce._fn('Less', [...terms].reverse());
  if (operator === 'GreaterEqual')
    return ce._fn('LessEqual', [...terms].reverse());
  return ce._fn(operator, terms);
}

/**
 * Canonicalize an n-ary comparison.
 *
 * A same-operator chain stays n-ary (`1 < 2 < 3` → `Less(1, 2, 3)`), except
 * `NotEqual`, which is decomposed into an `And` of its adjacent pairs. A
 * chain that mixes operators (`a ≤ b > c`) reaches this function already
 * split by the parser into an `And` of its links, so each link is
 * canonicalized on its own. An operand that is itself a comparison is a
 * term, not a continuation of the chain:
 * `Equal(LessEqual(a, 0), LessEqual(b, 0))` compares the truth values of the
 * two conditions (see `chainComparison()` in
 * `latex-syntax/comparison-chain.ts`).
 */
function canonicalComparisonChain(
  ce: ComputeEngine,
  operator: string,
  ops: ReadonlyArray<Expression>
): Expression {
  const terms = ops.map((t) => t.canonical);

  // `NotEqual` is not transitive: `a ≠ b ≠ c` means `a ≠ b ∧ b ≠ c`
  // (adjacent pairs), NOT the n-ary "all distinct". Decompose it into an
  // `And` of its adjacent pairs.
  if (operator === 'NotEqual' && terms.length > 2)
    return ce.function(
      'And',
      terms.slice(1).map((t, i) => buildComparison(ce, operator, [terms[i], t]))
    );

  return buildComparison(ce, operator, terms);
}

function inequalityEq(
  a: Expression,
  b: Expression,
  oppositeOperator?: string,
  prover?: boolean
): boolean | undefined {
  // Relation equivalence is an identity question in the free variables:
  // prover tier only (see `Equal`'s `eq` handler).
  if (prover === false) return undefined;
  if (!isFunction(a) || !isFunction(b)) return undefined;

  // Two relations are equivalent when they have the same solution set — an
  // *identity* question in the free variables of the operands (`2(13.1+x) < 5`
  // vs `26.2+2x < 5`), not arithmetic equality. Use the prover tier
  // (`isIdenticallyEqual`), which keeps the free-variable machinery; cheap
  // `isEqual()` would report a spurious `false` here.
  //
  // Three-valued: only an all-pairs *provable* identity yields `true`. An
  // undecided pair (or pairwise non-identity, which does not prove the
  // relations differ: `x < 1` vs `x+1 < 2`) yields `undefined`, never `false`.
  if (a.operator === b.operator) {
    if (a.nops !== b.nops) return undefined;
    return a.ops.every((op, i) => op.isIdenticallyEqual(b.ops[i]) === true)
      ? true
      : undefined;
  }

  if (b.operator === oppositeOperator) {
    if (a.nops !== b.nops) return undefined;
    return a.ops.every(
      (op, i) => op.isIdenticallyEqual(b.ops[b.nops - 1 - i]) === true
    )
      ? true
      : undefined;
  }

  return undefined;
}
