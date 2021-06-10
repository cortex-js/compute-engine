import { getArg, getHead, getSymbolName } from '../common/utils';
import { Expression } from '../public';
import { ComputeEngine } from './public';
import { CortexError } from './utils';

// export function isInfinity(ce: ComputeEngine, _expr: Expression): boolean | undefined {
//   // @todo inferDomainOf
//   return undefined;
// }
// isZero(expr: Expression): boolean | undefined {
//   return this.equal(expr, 0);
// }
// isOne(expr: Expression): boolean | undefined {
//   return this.equal(expr, 1);
// }
// isMinusOne(expr: Expression): boolean | undefined {
//   return this.equal(expr, -1);
// }
// /** Is `expr` >= 0? */
// isNonNegative(expr: Expression): boolean | undefined {
//   const result = this.isZero(expr);
//   if (result === undefined) return undefined;
//   if (result === true) return true;
//   return this.isPositive(expr);
// }
// /** Is `expr` > 0? */
// isPositive(_expr: Expression): boolean | undefined {
//   // @todo
//   return undefined;
// }
// /** Is `expr` < 0? */
// isNegative(expr: Expression): boolean | undefined {
//   const result = this.isNonNegative(expr);
//   if (result === undefined) return undefined;
//   return !result;
// }
// /** Is `expr` <= 0? */
// isNonPositive(expr: Expression): boolean | undefined {
//   const result = this.isPositive(expr);
//   if (result === undefined) return undefined;
//   return !result;
// }
// isInteger(_expr: Expression): boolean | undefined {
//   // @todo
//   return undefined;
// }
// /** Is `expr` an element of QQ (can be written as p/q)? */
// isRational(_expr: Expression): boolean | undefined {
//   // @todo
//   return undefined;
// }
// /** Is `expr` an element of RR? */
// isReal(_expr: Expression): boolean | undefined {
//   // @todo
//   return undefined;
// }
// /** Is `expr` an element of RR, including ±∞? */
// isExtendedReal(_expr: Expression): boolean | undefined {
//   // @todo
//   return undefined;
// }
// /** Is `expr` an algebraic number, i.e. not transcendental (π, e)? */
// isAlgebraic(_expr: Expression): boolean | undefined {
//   // @todo
//   return undefined;
// }
// /** Is `expr` a complex number? */
// isComplex(_expr: Expression): boolean | undefined {
//   // @todo
//   return undefined;
// }
// /** Is `expr` an element of `dom`? */
// isElement(_expr: Expression, _dom: Domain): boolean | undefined {
//   // @todo
//   return undefined;
// }

export function isInRange(
  symbol: Expression,
  expr: Expression
): boolean | undefined {
  return undefined;
}

/**
 * Normalize an equality or inequality to a range expression:
 * `['RealRange', min, max]` where min and max are either
 * a number, `Infinity` or `['Open', num]`
 */
export function normalizeToRange(
  engine: ComputeEngine,
  expr: Expression
): Expression | null {
  return null;
}

export function isWithEngine(
  engine: ComputeEngine,
  predicate: Expression
): boolean | undefined {
  return undefined;
}

export function assumeWithEngine(
  engine: ComputeEngine,
  predicate: Expression
): 'contradiction' | 'tautology' | 'ok' {
  const head = getHead(predicate);

  if (!head) throw new CortexError({ message: 'expected-predicate' });

  const arg = getArg(predicate, 1);

  if (!arg) return 'contradiction';

  const assumptions = getAssumptions(engine, arg);
  // @todo: check contradiction or tautology
  engine.assumptions.add(predicate);
  return 'ok';
}

export function filterAssumptions(
  engine: ComputeEngine,
  head: Expression,
  arg1?,
  arg2?
): Expression[] {
  // @todo
  return [];
}

export function getAssumptions(
  engine: ComputeEngine,
  arg: Expression
): Expression[] {
  const symbols: string[] = [...engine.getVars(arg)]
    .map((x) => getSymbolName(x))
    .filter((x) => x !== null) as string[];

  if (symbols.length === 0) return [];

  const result: Expression[] = [];
  for (const assumption of engine.assumptions) {
    const vars = engine.getVars(assumption);
    for (const symbol of symbols) {
      if (vars.has(symbol)) {
        result.push(assumption);
        break;
      }
    }
  }

  return [];
}
