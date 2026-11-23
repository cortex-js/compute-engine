// From a statistic to an operator handler: the operand reader, the domain
// check, and the compiled Epsil definition run as a function.

import type { Expression, IComputeEngine } from '../global-types.js';
import { isFunction, isNumber } from '../boxed-expression/type-guards.js';
import type { Domain, Statistic } from './areas.js';

/** A safe integer from a number literal, else `undefined`. */
const safeInteger = (x: Expression): number | undefined =>
  isNumber(x) && x.isInteger === true && Number.isSafeInteger(x.re)
    ? x.re
    : undefined;

/**
 * Read the integers of an operand that is a list literal, or a value of the
 * domain's `alsoReads` constructor (its image list). `undefined` when the
 * operand is anything else, so the call stays unevaluated.
 */
export function readIntegers(
  op: Expression,
  domain: Domain
): number[] | undefined {
  const list =
    domain.alsoReads !== undefined && isFunction(op, domain.alsoReads)
      ? op.op1
      : op;
  if (!isFunction(list, 'List')) return undefined;
  const values: number[] = [];
  for (const item of list.ops) {
    const v = safeInteger(item);
    if (v === undefined) return undefined;
    values.push(v);
  }
  return values;
}

/**
 * The evaluate handler of a statistic. An operand outside the domain, or one
 * not yet known, leaves the call unevaluated. `useFast: false` runs the Epsil
 * definition even where a kernel exists.
 */
export function statisticHandler(
  ce: IComputeEngine,
  domain: Domain,
  statistic: Statistic,
  useFast = true
): (ops: ReadonlyArray<Expression>) => Expression | undefined {
  // Boxed on the first call: boxing costs milliseconds, and most heads of an
  // area are never called.
  let definition: Expression | undefined;
  return (ops) => {
    const values = readIntegers(ops[0], domain);
    if (values === undefined || !domain.accepts(values)) return undefined;
    if (useFast && statistic.fast) return ce.number(statistic.fast(values));
    definition ??= ce.box(statistic.literal);
    const result = ce
      .function('Apply', [
        definition,
        ce.function(
          'List',
          values.map((v) => ce.number(v))
        ),
      ])
      .evaluate();
    return isNumber(result) && result.isInteger === true ? result : undefined;
  };
}
