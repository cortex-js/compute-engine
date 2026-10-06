import type { Expression, IComputeEngine } from '../global-types.js';
import { isFunction, isNumber } from '../boxed-expression/type-guards.js';
import { asRational } from '../boxed-expression/numerics.js';
import { rangeCount } from '../numerics/range-count.js';

/**
 * Closed forms for the statistics of a `Range` whose bounds and step are
 * exact rational numbers.
 *
 * The elements of such a range are an arithmetic sequence
 * `a, a + d, …, a + (n − 1)·d`. Its sum, mean, median and variances have
 * closed forms in `a`, `d` and `n`, so a reducer does not have to walk the
 * elements. A walk takes a time proportional to `n`, and `Sum(Range(1,
 * 10^20))` does not finish.
 *
 * All the arithmetic is on `bigint` numerators and denominators, so the
 * results are exact for every count. The functions return `undefined` when
 * the operand is not a `Range`, or when a bound or the step is not an exact
 * rational or a float with an integer value (a float such as `0.1`, a symbol,
 * an infinity, an exact constant such as `π`). The caller then keeps its
 * usual walk.
 *
 * When an operand is a float with an integer value, the range is not exact:
 * the result is the numeric approximation of the closed form, as a walk over
 * float elements gives a float (`Sum(Range(1.0, 3, 1/2))` is `10`, a float).
 */

/** An exact rational `num/den` with `den > 0`. */
type BigRational = [num: bigint, den: bigint];

/**
 * The parts of an arithmetic `Range`: the first element `a`, the step `d`
 * and the element count `n` (a `bigint`, `0n` for an empty range).
 */
export type ArithmeticRange = { a: BigRational; d: BigRational; n: bigint };

/**
 * The bounds and the step of a `Range` as rationals, or `undefined` when an
 * operand is not an exact rational or a float with an integer value (a float
 * such as `0.1`, a symbol, an infinity, an exact constant such as `π`).
 *
 * `inexact` is true when at least one operand is a float. `machine` holds the
 * numeric values of the bounds and the step, as `range()` in
 * `library/collections.ts` reads them.
 *
 * The implicit step is the same as in `range()`: `Range(upper)` starts at 1
 * with the step 1, and `Range(lower, upper)` has the step 1, or -1 when
 * `upper` is less than `lower`. A zero step gives `undefined`: the `Range`
 * count handler has its own rule for it.
 *
 * When `evaluateOperands` is false, an operand that is not a number literal
 * gives `undefined`. The engine state then does not change. When it is a
 * function, an operand that is not a number literal is evaluated only when
 * the function returns true for it.
 */
function rangeOperands(
  expr: Expression,
  evaluateOperands: boolean | ((op: Expression) => boolean)
):
  | {
      lower: BigRational;
      upper: BigRational;
      step: BigRational;
      inexact: boolean;
      machine: [lower: number, upper: number, step: number];
    }
  | undefined {
  if (!isFunction(expr, 'Range') || expr.nops === 0 || expr.nops > 3)
    return undefined;
  let inexact = false;
  // An operand must be an exact rational, or a float with an integer value.
  // `.N()` evaluates the operands of a reducer that does not hold them
  // (`Mean`), so `Mean(Range(1, 10^20)).N()` gets the float bound `1e20`. A
  // float that is not an integer is refused: the `Range` handlers count its
  // elements with a tolerance for rounding errors (`rangeCount()`), and the
  // rational value of the float can give a different count (`Range(0, 1,
  // 0.1)` has 11 elements, but `1 / 0.1` in exact binary arithmetic is a
  // little less than 10).
  const read = (op: Expression): [BigRational, number] | undefined => {
    const value = isNumber(op)
      ? op
      : evaluateOperands === true ||
          (typeof evaluateOperands === 'function' && evaluateOperands(op))
        ? op.evaluate()
        : undefined;
    if (value === undefined || !isNumber(value) || value.isComplex)
      return undefined;
    if (!value.isExact && !value.isInteger) return undefined;
    const r = asRational(value);
    if (r === undefined) return undefined;
    if (!value.isExact) inexact = true;
    return [[BigInt(r[0]), BigInt(r[1])], value.re];
  };
  const lower: [BigRational, number] | undefined =
    expr.nops === 1 ? [[1n, 1n], 1] : read(expr.op1);
  const upper = read(expr.nops === 1 ? expr.op1 : expr.op2);
  if (lower === undefined || upper === undefined) return undefined;

  let step: [BigRational, number] | undefined;
  if (expr.nops === 3) step = read(expr.op3);
  else {
    const up = upper[0][0] * lower[0][1] >= lower[0][0] * upper[0][1];
    step = up ? [[1n, 1n], 1] : [[-1n, 1n], -1];
  }
  if (step === undefined || step[0][0] === 0n) return undefined;
  return {
    lower: lower[0],
    upper: upper[0],
    step: step[0],
    inexact,
    machine: [lower[1], upper[1], step[1]],
  };
}

/**
 * The exact element count `floor((upper − lower) / step) + 1` of a range,
 * or 0 when the step does not go from `lower` toward `upper`.
 */
function exactCount(
  lower: BigRational,
  upper: BigRational,
  step: BigRational
): bigint {
  // upper − lower, as a rational with a positive denominator
  const spanNum = upper[0] * lower[1] - lower[0] * upper[1];
  const spanDen = upper[1] * lower[1];
  let qNum = spanNum * step[1];
  let qDen = spanDen * step[0];
  if (qDen < 0n) {
    qNum = -qNum;
    qDen = -qDen;
  }
  return qNum < 0n ? 0n : qNum / qDen + 1n;
}

/**
 * The parts of a `Range` whose bounds and step are all exact rationals
 * (integers included), with the exact element count. Otherwise (a float,
 * a symbol, an infinity, an exact constant such as `π`, a zero step) the
 * result is `undefined`.
 *
 * For such a range, this count is the count of the range: the `Range`
 * collection handlers in `library/collections.ts` (`count`, `iterator`,
 * `at`, and the emptiness and finiteness that derive from `count`) use it,
 * and the closed forms below use it. The machine count `rangeCount()`
 * applies a tolerance for rounding errors, which is correct for float
 * operands but can count one element past `upper` for exact operands
 * (`Range(0, 99999999999999/10^14, 1/10)` has 10 elements, and the machine
 * count is 11). A machine count above 2^53 is also not exact.
 *
 * When `evaluateOperands` is false, an operand that is not a number literal
 * gives `undefined`, and the engine state does not change.
 */
export function exactArithmeticRange(
  expr: Expression,
  evaluateOperands = true
): ArithmeticRange | undefined {
  const r = rangeOperands(expr, evaluateOperands);
  if (r === undefined || r.inexact) return undefined;
  return { a: r.lower, d: r.step, n: exactCount(r.lower, r.upper, r.step) };
}

/**
 * The exact element count of a range from the rational values of its
 * operands, as written: `[upper]` for `Range(upper)`, `[lower, upper]` or
 * `[lower, upper, step]`. Each rational is `[numerator, denominator]` with a
 * positive denominator. The implicit step is the same as in `range()`
 * (`library/collections.ts`). A zero step, or a number of operands other
 * than 1, 2 or 3, gives `undefined`.
 *
 * Use this function when only the values of the operands are known, not
 * whether they are exact (the operand descriptors of a type handler). The
 * caller must then compare the result with the machine count `rangeCount()`:
 * an integer-valued float operand makes the `Range` handlers use the machine
 * count, and the two counts can differ when another operand is not an
 * integer.
 */
export function rationalRangeCount(
  operands: ReadonlyArray<readonly [bigint, bigint]>
): bigint | undefined {
  if (operands.length === 0 || operands.length > 3) return undefined;
  const one: BigRational = [1n, 1n];
  const lower: BigRational =
    operands.length === 1 ? one : [operands[0][0], operands[0][1]];
  const upper: BigRational =
    operands.length === 1
      ? [operands[0][0], operands[0][1]]
      : [operands[1][0], operands[1][1]];
  let step: BigRational;
  if (operands.length === 3) step = [operands[2][0], operands[2][1]];
  else step = upper[0] * lower[1] >= lower[0] * upper[1] ? one : [-1n, 1n];
  if (step[0] === 0n) return undefined;
  return exactCount(lower, upper, step);
}

/**
 * True when a reader that counts the elements of the `Range` `expr` in
 * machine arithmetic, with `rangeCount()`, gets a count that is not the
 * count of the `Range` collection handlers.
 *
 * This is the case when every operand is an exact rational number literal
 * (the handlers then use the exact count of `exactArithmeticRange()`) and
 * the machine count of the numeric values of the operands is a different
 * number: `Range(0, 9999999999999/10^12, 1)` has 10 elements, and
 * `rangeCount(0, 9.999999999999, 1)` is 11, because its tolerance for
 * rounding errors counts the end point 10. It is also the case when the
 * machine count is not finite: `Range(1, 10^400)` has 10^400 elements, but
 * its machine upper bound is `Infinity`. The two counts must be the same
 * integer: `Range(1, 10^20)` has 10^20 elements, which a `number` holds
 * exactly, but `Range(1, 10^20, 1/2)` has 199999999999999999999 elements,
 * and its machine count is the `number` 2·10^20.
 *
 * Compiled code counts the elements of a range in machine arithmetic, so the
 * compiler declines a range for which this function is true
 * (`BaseCompiler.findShadowedLibraryLowering()`). A pure operand is
 * evaluated, as the compiler folds it: `10^400`, or a symbol with an
 * assigned value, which compiled code reads as a constant
 * (`Range(0, a, 1)` with `a := 9999999999999/10^12`). An operand that is
 * not pure (`Random()`) is not evaluated, and neither is an operand with a
 * symbol for which `isRuntimeInput` is true: the compiled code reads that
 * symbol at run time (a `vars` input, a loop index), so its value at
 * compile time is not the value the compiled code uses.
 */
export function machineRangeCountDiffers(
  expr: Expression,
  isRuntimeInput: (symbol: string) => boolean = () => false
): boolean {
  const r = rangeOperands(
    expr,
    (op) => op.isPure && !op.symbols.some(isRuntimeInput)
  );
  if (r === undefined || r.inexact) return false;
  const machine = rangeCount(...r.machine);
  if (!Number.isFinite(machine)) return true;
  return BigInt(machine) !== exactCount(r.lower, r.upper, r.step);
}

/**
 * The parts of a `Range` for the closed forms below, or `undefined` when the
 * closed forms do not apply.
 *
 * When every operand is an exact rational, the count is the exact count of
 * `exactArithmeticRange()`. When an operand is a float with an integer value,
 * `inexact` is true and the count is the machine count `rangeCount()`, which
 * is the count the `Range` handlers use for that range.
 *
 * A finite machine count that is not a safe integer is itself rounded, and
 * then the count is the exact count of the rational values of the operands.
 * The two counts differ by less than the rounding error of the machine count,
 * and the result is a float with a larger rounding error. A walk of that many
 * elements cannot finish: `Mean(Range(1, 10^20)).N()` evaluates the bound to
 * the float `1e20` before the reducer sees it. An infinite machine count
 * gives `undefined`: the `Range` handlers report that range as infinite.
 */
function arithmeticRange(
  expr: Expression
): (ArithmeticRange & { inexact: boolean }) | undefined {
  const r = rangeOperands(expr, true);
  if (r === undefined) return undefined;
  if (!r.inexact)
    return {
      a: r.lower,
      d: r.step,
      n: exactCount(r.lower, r.upper, r.step),
      inexact: false,
    };
  const count = rangeCount(...r.machine);
  if (!Number.isFinite(count)) return undefined;
  const n = Number.isSafeInteger(count)
    ? BigInt(count)
    : exactCount(r.lower, r.upper, r.step);
  return { a: r.lower, d: r.step, n, inexact: true };
}

/**
 * The numeric approximation of the exact number `value`, always a float. A
 * walk over float elements gives a float also for an integer value (`10.0`),
 * but `.N()` keeps an exact integer exact, so this function converts such a
 * value to a float.
 */
function approximate(ce: IComputeEngine, value: Expression): Expression {
  const approx = value.N();
  if (!isNumber(approx) || !approx.isExact) return approx;
  return ce.number(ce._inexactNumericValue(approx.bignumRe ?? approx.re));
}

/**
 * The exact value `num/den` as a number literal, or its numeric
 * approximation when `numericApproximation` is true. When `inexact` is true
 * (an operand of the range is a float), the result is always a float.
 */
function result(
  ce: IComputeEngine,
  num: bigint,
  den: bigint,
  numericApproximation: boolean | undefined,
  inexact: boolean
): Expression {
  const value = ce.number([num, den]);
  if (inexact) return approximate(ce, value);
  return numericApproximation ? value.N() : value;
}

/**
 * The sum of the elements of an exact arithmetic `Range`:
 * `n·a + d·n·(n − 1)/2`. An empty range sums to 0.
 */
export function rangeSumClosedForm(
  ce: IComputeEngine,
  expr: Expression,
  numericApproximation?: boolean
): Expression | undefined {
  const r = arithmeticRange(expr);
  if (r === undefined) return undefined;
  const { a, d, n } = r;
  // n·a + d·n(n − 1)/2 = (2·n·aN·dD + dN·n(n − 1)·aD) / (2·aD·dD)
  return result(
    ce,
    2n * n * a[0] * d[1] + d[0] * n * (n - 1n) * a[1],
    2n * a[1] * d[1],
    numericApproximation,
    // An empty range has no float element, and its sum is the exact 0, as
    // for a walk.
    r.inexact && n > 0n
  );
}

/**
 * The mean of the elements of an exact arithmetic `Range`, which is also its
 * median: the mean of the first and last elements, `a + d·(n − 1)/2`. An
 * empty range gives `undefined`, and the caller keeps its own answer for
 * empty data.
 */
export function rangeMeanClosedForm(
  ce: IComputeEngine,
  expr: Expression,
  numericApproximation?: boolean
): Expression | undefined {
  const r = arithmeticRange(expr);
  if (r === undefined || r.n === 0n) return undefined;
  const { a, d, n } = r;
  // a + d(n − 1)/2 = (2·aN·dD + dN·(n − 1)·aD) / (2·aD·dD)
  return result(
    ce,
    2n * a[0] * d[1] + d[0] * (n - 1n) * a[1],
    2n * a[1] * d[1],
    numericApproximation,
    r.inexact
  );
}

/**
 * The variance of the elements of an exact arithmetic `Range`: the sample
 * variance `d²·n·(n + 1)/12`, or with `population` the population variance
 * `d²·(n² − 1)/12`. Fewer than two elements give `undefined`, and the caller
 * keeps its own answer for that data.
 */
export function rangeVarianceClosedForm(
  ce: IComputeEngine,
  expr: Expression,
  population: boolean,
  numericApproximation?: boolean
): Expression | undefined {
  const r = arithmeticRange(expr);
  if (r === undefined || r.n < 2n) return undefined;
  const { d, n } = r;
  const factor = population ? n * n - 1n : n * (n + 1n);
  return result(
    ce,
    d[0] * d[0] * factor,
    12n * d[1] * d[1],
    numericApproximation,
    r.inexact
  );
}

/**
 * The largest element (`upper` true) or the smallest element (`upper`
 * false) of an exact arithmetic `Range`: the first element `a` or the last
 * element `a + (n − 1)·d`, as the sign of the step decides. An empty range
 * gives `undefined`, and the caller keeps its own answer for empty data.
 *
 * The result is exact also when a bound is larger than 2^53, where a
 * machine number cannot hold the element: `Max(Range(1, 10^20 + 1))` is
 * `10^20 + 1`. A float operand gives a float result.
 */
export function rangeExtremumClosedForm(
  ce: IComputeEngine,
  expr: Expression,
  upper: boolean
): Expression | undefined {
  const r = arithmeticRange(expr);
  if (r === undefined || r.n === 0n) return undefined;
  const { a, d, n } = r;
  // The step goes up when `d > 0`: then the last element is the largest.
  // a + (n − 1)·d = (aN·dD + (n − 1)·dN·aD) / (aD·dD)
  const value =
    upper === d[0] > 0n
      ? ce.number([a[0] * d[1] + (n - 1n) * d[0] * a[1], a[1] * d[1]])
      : ce.number([a[0], a[1]]);
  return r.inexact ? approximate(ce, value) : value;
}
