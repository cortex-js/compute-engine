/**
 * Guard digits for the exact operands of a special or elementary function
 * under `.N()`.
 */

import type { EvaluateHandlerOptions, Expression } from '../global-types.js';
import { isFunction, isNumber } from '../boxed-expression/type-guards.js';
import { bignumPreferred } from '../boxed-expression/utils.js';
import { isExactConstantExpression } from '../boxed-expression/compare.js';
import { BigDecimal } from '../../big-decimal/index.js';
import {
  exactRealValueOf,
  isExactRealLiteral,
} from '../boxed-expression/constraint-subject.js';
import { ExactNumericValue } from '../numeric-value/exact-numeric-value.js';
import { exactIntegerValue } from '../numeric-value/exact-integer-value.js';

/**
 * The number of digits above the working precision at which an exact
 * operand is approximated, and at which the handler computes, before its
 * result is rounded to the working precision. The rounding error of the
 * operand reaches the result multiplied by the condition number of the
 * function at that point (`|x·f′(x)/f(x)|`), which is large near a zero of
 * the function: `Digamma(13/9)`, close to the zero of ψ at 1.4616…, lost
 * three digits.
 */
const EXACT_OPERAND_GUARD_DIGITS = 10;

/**
 * Operands below this magnitude (10^2) need no guard digits beyond
 * `EXACT_OPERAND_GUARD_DIGITS`: their condition number, `|x·ln x|`, is far
 * inside it.
 */
const GUARD_FREE_MAGNITUDE_DIGITS = 2;

/**
 * The most digits added to `EXACT_OPERAND_GUARD_DIGITS` for the size of an
 * operand and its distance to a pole. Past it, the handler declines (the
 * expression stays unevaluated) instead of answering from an operand it
 * cannot read with enough digits.
 */
const MAX_EXTRA_GUARD_DIGITS = 500;

/** The largest exponent of a float that is converted to an exact rational. */
const MAX_EXACT_EXPONENT = 5000;

/** An exact rational, `[numerator, denominator]`, denominator positive. */
type Rational = [bigint, bigint];

const abs = (n: bigint): bigint => (n < 0n ? -n : n);
const digitCount = (n: bigint): number => abs(n).toString().length;

/** The exact value of a big decimal. */
function rationalOfBigDecimal(v: BigDecimal): Rational | undefined {
  // Past the double range the digits are not worth an exact integer.
  if (Math.abs(v.exponent) > MAX_EXACT_EXPONENT) return undefined;
  return v.exponent >= 0
    ? [v.significand * 10n ** BigInt(v.exponent), 1n]
    : [v.significand, 10n ** BigInt(-v.exponent)];
}

/** The largest exponent of a `Power` that is evaluated exactly. */
const MAX_EXACT_POWER = 10_000;

/**
 * True when `x` is built only from exact number literals and rational
 * arithmetic (`Add`, `Subtract`, `Multiply`, `Divide`, `Negate`, `Rational`,
 * and `Power` with a small integer exponent): no symbol and no call, so
 * evaluating it exactly has no effect (a host function records the request
 * it gets) and costs little.
 */
function isRationalArithmetic(x: Expression): boolean {
  if (isNumber(x)) return x.isExact && !x.isComplex;
  if (!isFunction(x)) return false;
  switch (x.operator) {
    case 'Add':
    case 'Subtract':
    case 'Multiply':
    case 'Divide':
    case 'Negate':
    case 'Rational':
      return x.ops.every(isRationalArithmetic);
    case 'Power': {
      const e = x.op2;
      return (
        isRationalArithmetic(x.op1) &&
        isNumber(e) &&
        e.isInteger === true &&
        Math.abs(e.re) <= MAX_EXACT_POWER
      );
    }
    default:
      return false;
  }
}

/**
 * The exact value of `original` when it is a rational number (an exact real
 * literal or a pure exact expression that evaluates to one), else
 * `undefined` (`π`, `√2`).
 */
function exactRationalOf(original: Expression): Rational | undefined {
  if (!isRationalArithmetic(original)) return undefined;
  const v = exactRealValueOf(original);
  if (v === undefined || !isNumber(v)) return undefined;
  const nv = v.numericValue;
  if (typeof nv === 'number')
    return Number.isInteger(nv) ? [BigInt(nv), 1n] : undefined;
  const exact = nv.asExact;
  if (
    !(exact instanceof ExactNumericValue) ||
    exact.radical !== 1 ||
    nv.im !== 0
  )
    return undefined;
  let [n, d] = exact.rational.map(BigInt) as Rational;
  if (d === 0n) return undefined;
  if (d < 0n) [n, d] = [-n, -d];
  return [n, d];
}

/**
 * The digits that a distance `|n/d|` below 1 costs: `⌊−log10 |n/d|⌋`, up to
 * one more. An exact zero costs none: the handler decides an exact integer
 * on the exact operands.
 */
function digitsBelowOne([n, d]: Rational): number {
  if (n === 0n) return 0;
  return Math.max(0, digitCount(d) - digitCount(n));
}

/** The distance of `[n, d]` to the nearest integer. */
function distanceToInteger([n, d]: Rational): Rational {
  let r = n % d;
  if (r < 0n) r += d;
  return 2n * r > d ? [d - r, d] : [r, d];
}

const addRational = ([a, b]: Rational, [c, e]: Rational): Rational => [
  a * e + c * b,
  b * e,
];
const negRational = ([a, b]: Rational): Rational => [-a, b];

/** `Σ signs[k]·vals[k]`. */
function signedSum(
  vals: ReadonlyArray<BigDecimal>,
  signs: ReadonlyArray<1 | -1>
): BigDecimal {
  return vals.reduce(
    (acc, v, k) => (signs[k] > 0 ? acc.add(v) : acc.sub(v)),
    new BigDecimal(0)
  );
}

/** The signed sum of the values of `parts` at the working precision. */
function floatSum(
  parts: ReadonlyArray<GuardOperand>,
  signs: ReadonlyArray<1 | -1>
): BigDecimal {
  return signedSum(
    parts.map((p) => p.value),
    signs
  );
}

/**
 * A real operand of a guarded call: its value at the working precision, and
 * its exact value when it has one (a rational, or a float, which is exact as
 * given) or `read`, a function that approximates it at a higher precision
 * (`π`, `√2`).
 */
interface GuardOperand {
  /** The index of the operand in the call. */
  index: number;
  value: BigDecimal;
  exact: Rational | undefined;
  read: () => BigDecimal | undefined;
}

/**
 * The precision, in digits above the working precision, at which a distance
 * that is below the rounding scale of the working precision is resolved: the
 * distance of `Β(1/3, −13/3 + 10^−29)`'s `a + b` to −4 is 10^−29 at 30
 * digits, and a float of each operand cancels to 11 correct digits.
 */
const POLE_RESOLUTION_DIGITS =
  MAX_EXTRA_GUARD_DIGITS + EXACT_OPERAND_GUARD_DIGITS;

/**
 * The digits that the nearness of `operands`, or of the sums and differences
 * of two that `sums` names, to a pole costs, or `undefined` past
 * `MAX_EXTRA_GUARD_DIGITS`. The error of an operand reaches the result
 * multiplied by `1/d`, with `d` the distance of an operand, or of the sum or
 * difference of two operands (`Β(a, b)` at `a + b` a non-positive integer,
 * `Binomial(n, k)` at `n − k` a negative one), to the nearest integer, when
 * that integer is one the function is singular at. `d` is computed exactly
 * when the operands are rational. For others (`π`), a `d` within the rounding error of the
 * working precision is read again at `POLE_RESOLUTION_DIGITS` more digits,
 * and when it is still within the rounding error there, it is not known to
 * be non-zero: the handler declines.
 */
function poleDigits(
  operands: ReadonlyArray<GuardOperand>,
  working: number,
  mode: PoleMode | ReadonlyArray<PoleMode>,
  sums: ReadonlyArray<PoleSum>
): number | undefined {
  const terms: {
    parts: GuardOperand[];
    signs: (1 | -1)[];
    mode: PoleMode;
  }[] = [];
  for (let i = 0; i < operands.length; i++) {
    const m =
      typeof mode === 'string' ? mode : (mode[operands[i].index] ?? 'none');
    if (m !== 'none') terms.push({ parts: [operands[i]], signs: [1], mode: m });
  }
  // Only the sums and differences the function is singular at: `Β(π, π)`
  // and `Binomial(π, π)` are regular at `a − b = 0`.
  for (const [i, j, sign, m] of sums) {
    const p = operands.find((op) => op.index === i);
    const q = operands.find((op) => op.index === j);
    if (p !== undefined && q !== undefined)
      terms.push({ parts: [p, q], signs: [1, sign], mode: m });
  }
  let pole = 0;
  for (const { parts, signs, mode } of terms) {
    // `one`: the distance to 1, as the distance of `x - 1` to 0.
    const shift = mode === 'one' ? -1n : 0n;
    const sum = parts.every((p) => p.exact !== undefined)
      ? addRational(
          parts
            .map((p, k) => (signs[k] > 0 ? p.exact! : negRational(p.exact!)))
            .reduce(addRational),
          [shift, 1n]
        )
      : undefined;
    // A function singular at the non-positive integers is regular at the
    // positive ones (`Gamma(1 + 10^-600)`), one singular at the negative
    // integers is regular at 0 too, and one singular at 1 only is regular at
    // the other integers (`HurwitzZeta(10^-600, 1/3)`): the nearest integer
    // must be one it is singular at. For `one`, `sum` is shifted by −1.
    const lowest = mode === 'negative' ? -1n : 0n;
    const regular =
      sum !== undefined
        ? mode === 'one'
          ? 2n * abs(sum[0]) >= sum[1]
          : sum[0] * 2n > (2n * lowest + 1n) * sum[1]
        : mode === 'one'
          ? Math.abs(floatSum(parts, signs).toNumber() - 1) >= 0.5
          : floatSum(parts, signs).round().toNumber() > Number(lowest);
    if (regular) continue;
    if (sum !== undefined) {
      pole = Math.max(pole, digitsBelowOne(distanceToInteger(sum)));
      continue;
    }
    // A non-rational operand: the distance from the floats.
    const measure = (vals: BigDecimal[], digits: number) => {
      const s = signedSum(vals, signs);
      const t = shift === 0n ? s : s.sub(1);
      const d = Math.abs(t.sub(t.round()).toNumber());
      const noise = 10 ** (2 - digits) * Math.max(1, Math.abs(s.toNumber()));
      return { d, noise };
    };
    const near = measure(
      parts.map((p) => p.value),
      working
    );
    if (near.d >= near.noise) {
      pole = Math.max(pole, Math.floor(-Math.log10(near.d)));
      continue;
    }
    const raised = parts.map((p) => p.read());
    if (raised.some((v) => v === undefined)) return undefined;
    const far = measure(
      raised as BigDecimal[],
      working + POLE_RESOLUTION_DIGITS
    );
    if (far.d < far.noise) return undefined;
    pole = Math.max(pole, Math.floor(-Math.log10(far.d)));
  }
  return pole > MAX_EXTRA_GUARD_DIGITS ? undefined : pole;
}

/**
 * The digits above `EXACT_OPERAND_GUARD_DIGITS` that the guarded evaluation
 * of `operands` (the real operands as the handler received them, at the
 * working precision `working`) needs, or `undefined` past
 * `MAX_EXTRA_GUARD_DIGITS`. Two conditions grow beyond what the fixed guard
 * covers:
 * - magnitude, of the `sized` values, for a function whose condition number
 *   grows with the operand (`sizeCondition`): the error of an operand `x`
 *   reaches the result multiplied by about `|x|·ln|x|`
 *   (`Γ(3000000001/3)` lost 7 units at every precision), so `⌈log10|x|⌉`
 *   digits are added. A function whose condition number does not grow
 *   (`Ln`, `Sin`, `Sqrt`, `Arctan`) adds none, and `Ln(2^2000 + 1)` is
 *   answered;
 * - a pole, see `poleDigits()`.
 */
function extraGuardDigits(
  operands: ReadonlyArray<GuardOperand>,
  sized: ReadonlyArray<BigDecimal>,
  working: number,
  sizeCondition: boolean,
  pole: PoleMode | ReadonlyArray<PoleMode> | undefined,
  sums: ReadonlyArray<PoleSum>
): number | undefined {
  let extra = 0;
  if (sizeCondition) {
    let magnitude = 0;
    for (const v of sized) {
      if (v.isZero()) continue;
      // Digits of the integer part, from the significand and exponent: the
      // value may be past the range of a double.
      magnitude = Math.max(magnitude, v.exponent + digitCount(v.significand));
    }
    extra = Math.max(0, magnitude - GUARD_FREE_MAGNITUDE_DIGITS);
  }
  if (pole !== undefined) {
    const digits = poleDigits(operands, working, pole, sums);
    if (digits === undefined) return undefined;
    extra += digits;
  }
  return extra > MAX_EXTRA_GUARD_DIGITS ? undefined : extra;
}

/**
 * The precision of the guarded evaluation that runs now (the working
 * precision plus `EXACT_OPERAND_GUARD_DIGITS`), or `undefined` when none
 * runs. A handler called inside that evaluation, at that precision or
 * higher, does not add guard digits again: its operands were approximated
 * with the guard digits already. Without this, each level of a nested call
 * (`Sin(Cos(Sin(1/3)))`) approximated its operand again, and that operand
 * approximated its own operand again, so the cost doubled with each level.
 *
 * It is kept for each engine: a guarded evaluation on one engine does not
 * remove the guard digits of an evaluation on another engine that it calls.
 */
const guardedPrecision = new WeakMap<object, number>();

/**
 * True when `original`, an operand as written before `.N()` approximated
 * it, is an exact value whose approximation at the working precision has a
 * rounding error: an exact real number literal that is not an integer
 * (`1/3`, `√2`), or an exact constant expression (`π`, `ln 2`,
 * `isExactConstantExpression()`). An integer has no rounding error, and a
 * float has no more digits to read.
 */
function needsGuardDigits(original: Expression): boolean {
  if (isNumber(original))
    return isExactRealLiteral(original) && original.isInteger !== true;
  return isExactConstantExpression(original);
}

/**
 * True when `original`, an exact integer expression (`10^600`, `2^100 + 1`),
 * has exactly the value of `op`, its approximation at the working
 * precision: nothing was rounded, so its size adds no guard digits.
 */
function readExactly(original: Expression, op: Expression): boolean {
  if (isNumber(original) || original.isInteger !== true) return false;
  const exact = original.evaluate();
  if (!isNumber(exact) || !exact.isExact || exact.isComplex) return false;
  // The exact integer, not `exact.bignumRe`, which is rounded to the working
  // precision: at 30 digits `2^100` rounds to `…5380` on both sides, where
  // the integer ends in `…5376`.
  const nv = exact.numericValue;
  const integer =
    typeof nv === 'number'
      ? Number.isSafeInteger(nv)
        ? BigInt(nv)
        : null
      : exactIntegerValue(nv);
  if (integer === null || !isNumber(op)) return false;
  return new BigDecimal(integer).eq(op.bignumRe ?? op.engine.bignum(op.re));
}

/**
 * The conditions beyond the fixed guard that a function opts into, because
 * they hold only for some functions:
 * - `size`: its condition number grows with the operand (`Gamma`, `Zeta`,
 *   `Exp`); a function that is well conditioned at a large operand (`Ln`,
 *   `Sin`, `Sqrt`, `Arctan`) must not have it, or `Ln(2^2000 + 1)` is
 *   declined. A function selects the operands that set it: `Power` selects
 *   its exponent, not its base (`Sqrt(10^600 + 1/3)` is answered);
 * - `pole`: it is singular at the integers it names, `nonpositive` for the
 *   gamma family, `negative` for `Binomial` (`Γ(n + 1)`), one mode per
 *   operand for `HurwitzZeta` (`s` at 1, `a` at the non-positive integers).
 *   A function regular there (`Zeta(10^-600)`, `DirichletEta(1 + 10^-500)`)
 *   must not have it, or the distance past the cap declines a defined value.
 *   A function, for a call as written: `Beta` is for its two-operand form
 *   only;
 * - `poleSums`: the sums and differences of two operands that the function
 *   is singular at (`a + b` of `Β(a, b)`, `n − k` of `Binomial(n, k)`), read
 *   only with a `pole` rule.
 */
export type PoleMode = 'nonpositive' | 'negative' | 'one' | 'none';

/** `[i, j, sign, mode]`: the function is singular where
 * `ops[i] + sign·ops[j]` is an integer of `mode`. */
export type PoleSum = readonly [number, number, 1 | -1, PoleMode];

type PoleRule = PoleMode | ReadonlyArray<PoleMode>;

export interface GuardRules {
  /**
   * `true`: the magnitude of each guarded operand sets the digits that the
   * size rule adds, except an integer read exactly. A function: it selects,
   * for the call and the index of an operand, the operands whose magnitude
   * sets them, also an operand that is not guarded, because its size can
   * multiply the error of another operand (`Power`).
   */
  size?: boolean | ((expression: Expression, index: number) => boolean);
  /** A mode for every operand, or one for each operand (`one`: singular at
   * 1 only; `none`: regular). */
  pole?: PoleRule | ((expression: Expression) => PoleRule | undefined);
  poleSums?: ReadonlyArray<PoleSum>;
}

/**
 * An `evaluate` handler of a special or elementary function that reads its
 * exact operands with guard digits under `.N()`.
 *
 * Under `.N()`, the operands reach the handler as floats at the working
 * precision. The float of an exact operand (`1/3`, `√2`, `π`) has a
 * rounding error in its last digit, and the function carries that error to
 * the last digit of its result: at 50 digits, `Digamma(1/3).N()` ended in
 * `…67205`, where the correct value ends in `…67204`. The kernels compute
 * with their own guard digits, but they cannot get back digits that the
 * operand lost before they read it.
 *
 * So when an operand as written (`options.expression`) is an exact value
 * with a rounding error (`needsGuardDigits()`), and the handler received a
 * real number literal for it, the handler runs at the working precision plus
 * `EXACT_OPERAND_GUARD_DIGITS` digits. Each such operand is approximated
 * again at that precision; the other operands are kept as they are. A
 * float result is then rounded to the working precision. Another result (an
 * exact value, a symbolic expression, a non-finite value) is returned as it
 * is.
 *
 * Only above machine precision: at machine precision the kernels compute in
 * doubles, and a raised precision would change them to the big-decimal
 * kernels. Only for a real operand: a complex operand goes to the complex
 * kernels, which compute in doubles at every precision, so guard digits
 * add cost and no correct digit.
 *
 * `readAgain`, when given, selects the operands that can be approximated
 * again, by their operand as written and their index. An operand that it
 * rejects is kept as the handler received it.
 *
 * Do not use it for a `lazy` operator: its handler gets the operands as they
 * are written, not approximated.
 */
export function guardDigitsN(
  evaluate: (
    ops: ReadonlyArray<Expression>,
    options: EvaluateHandlerOptions
  ) => Expression | undefined,
  readAgain?: (original: Expression, index: number) => boolean,
  rules: GuardRules = {}
): (
  ops: ReadonlyArray<Expression>,
  options: EvaluateHandlerOptions
) => Expression | undefined {
  return (ops, options) => {
    const { numericApproximation, engine: ce, expression } = options;
    if (
      !numericApproximation ||
      !bignumPreferred(ce) ||
      expression === undefined ||
      !isFunction(expression) ||
      expression.nops !== ops.length ||
      ce.precision >= (guardedPrecision.get(ce) ?? Infinity)
    )
      return evaluate(ops, options);
    const originals = expression.ops;
    const guarded = ops.map(
      (op, i) =>
        isNumber(op) &&
        !op.isComplex &&
        needsGuardDigits(originals[i]) &&
        (readAgain === undefined || readAgain(originals[i], i))
    );
    if (!guarded.some((x) => x)) return evaluate(ops, options);

    const working = ce.precision;
    const sizeRule = rules.size;
    const grows = sizeRule !== undefined && sizeRule !== false;
    const pole =
      typeof rules.pole === 'function' ? rules.pole(expression) : rules.pole;
    const operands: GuardOperand[] = [];
    const sized: BigDecimal[] = [];
    ops.forEach((op, i) => {
      if (!isNumber(op) || op.isComplex || op.isFinite !== true) return;
      const value = op.bignumRe ?? ce.bignum(op.re);
      operands.push({
        index: i,
        value,
        // A float, or an operand read exactly, is its own exact value. Only a
        // function with a pole rule reads it: evaluating an operand exactly
        // has effects (a host function records the request it got).
        exact:
          pole === undefined
            ? undefined
            : guarded[i]
              ? exactRationalOf(originals[i])
              : rationalOfBigDecimal(value),
        read: () => {
          const v = ce._withTransientPrecision(
            working + POLE_RESOLUTION_DIGITS,
            () => {
              const r = originals[i].N();
              return isNumber(r) && !r.isComplex
                ? (r.bignumRe ?? ce.bignum(r.re))
                : undefined;
            }
          );
          return v;
        },
      });
      // An integer held exactly has no rounding error to grow with its size.
      if (
        typeof sizeRule === 'function'
          ? sizeRule(expression, i)
          : sizeRule === true && guarded[i] && !readExactly(originals[i], op)
      )
        sized.push(value);
    });
    const extra = extraGuardDigits(
      operands,
      sized,
      working,
      grows,
      pole,
      rules.poleSums ?? []
    );
    if (extra === undefined) return undefined;
    const raisedPrecision = working + EXACT_OPERAND_GUARD_DIGITS + extra;
    const outerGuardedPrecision = guardedPrecision.get(ce);
    const result = ce._withTransientPrecision(raisedPrecision, () => {
      guardedPrecision.set(ce, raisedPrecision);
      try {
        const raised: Expression[] = [];
        for (let i = 0; i < ops.length; i++) {
          if (!guarded[i]) {
            raised.push(ops[i]);
            continue;
          }
          const value = originals[i].N();
          // The approximation of an exact constant expression is not always
          // a real number literal (an application that has only an
          // asynchronous handler stays unevaluated). Then the handler runs
          // at the working precision with the operands it received: at the
          // raised precision, the float of that operand has the error of
          // the working precision, and the handler reads this error as a
          // value (`sin` of the float of `π` is not rounded to `0`).
          if (!isNumber(value) || value.isComplex) return null;
          raised.push(value);
        }
        return evaluate(raised, options);
      } finally {
        if (outerGuardedPrecision === undefined) guardedPrecision.delete(ce);
        else guardedPrecision.set(ce, outerGuardedPrecision);
      }
    });
    if (result === null) return evaluate(ops, options);
    return roundToWorkingPrecision(result, working);
  };
}

/** `guardDigitsN` with the size rule (`Zeta`, `DirichletEta`, `Exp`). */
export function guardDigitsSizeN(
  evaluate: Parameters<typeof guardDigitsN>[0],
  readAgain?: Parameters<typeof guardDigitsN>[1],
  size: GuardRules['size'] = true
): ReturnType<typeof guardDigitsN> {
  return guardDigitsN(evaluate, readAgain, { size });
}

/** `guardDigitsN` with the size rule and the pole rule at the non-positive
 * integers (`Gamma`, `Factorial`). */
export function guardDigitsGammaN(
  evaluate: Parameters<typeof guardDigitsN>[0],
  readAgain?: Parameters<typeof guardDigitsN>[1]
): ReturnType<typeof guardDigitsN> {
  return guardDigitsN(evaluate, readAgain, {
    size: true,
    pole: 'nonpositive',
  });
}

/** `guardDigitsN` with the pole rule at the non-positive integers (`GammaLn`,
 * `Digamma`: conditioned well at a large operand). */
export function guardDigitsPoleN(
  evaluate: Parameters<typeof guardDigitsN>[0],
  readAgain?: Parameters<typeof guardDigitsN>[1]
): ReturnType<typeof guardDigitsN> {
  return guardDigitsN(evaluate, readAgain, { pole: 'nonpositive' });
}

/** `guardDigitsN` with the pole rule of `Β(a, b)`: singular where `a`, `b`
 * or `a + b` is a non-positive integer. The incomplete forms (three and four
 * operands) have no pole rule. */
export function guardDigitsBetaN(
  evaluate: Parameters<typeof guardDigitsN>[0]
): ReturnType<typeof guardDigitsN> {
  return guardDigitsN(evaluate, undefined, {
    pole: (expression) =>
      isFunction(expression) && expression.nops === 2
        ? 'nonpositive'
        : undefined,
    poleSums: [[0, 1, 1, 'nonpositive']],
  });
}

/** `guardDigitsN` with the size rule and the pole rule of
 * `Binomial(n, k) = Γ(n + 1)/(Γ(k + 1)·Γ(n − k + 1))`: singular where `n`,
 * `k` or `n − k` is a negative integer. */
export function guardDigitsBinomialN(
  evaluate: Parameters<typeof guardDigitsN>[0]
): ReturnType<typeof guardDigitsN> {
  return guardDigitsN(evaluate, undefined, {
    size: true,
    pole: 'negative',
    poleSums: [[0, 1, -1, 'negative']],
  });
}

/** `guardDigitsN` with the size rule and, for each operand, its own pole:
 * `HurwitzZeta(s, a)` is singular at `s = 1` and at `a` a non-positive
 * integer, and regular elsewhere. */
export function guardDigitsSizePoleN(
  evaluate: Parameters<typeof guardDigitsN>[0],
  readAgain?: Parameters<typeof guardDigitsN>[1]
): ReturnType<typeof guardDigitsN> {
  return guardDigitsN(evaluate, readAgain, {
    size: true,
    pole: ['one', 'nonpositive'],
  });
}

/**
 * `result` rounded to `working` digits when it is a finite float with
 * big-decimal parts; `result` otherwise. It is called after the precision
 * of the engine is restored to `working`.
 */
export function roundToWorkingPrecision(
  result: Expression | undefined,
  working: number
): Expression | undefined {
  if (result === undefined || !isNumber(result)) return result;
  if (result.isExact || result.isFinite !== true) return result;
  const re = result.bignumRe;
  const im = result.bignumIm;
  if (re === undefined && im === undefined) return result;
  const ce = result.engine;
  const bigRe = (re ?? ce.bignum(result.re)).toPrecision(working);
  if (!result.isComplex) return ce.number(ce._numericValue(bigRe));
  const bigIm = (im ?? ce.bignum(result.im)).toPrecision(working);
  return ce.number(ce._inexactNumericValue({ re: bigRe, im: bigIm }));
}
