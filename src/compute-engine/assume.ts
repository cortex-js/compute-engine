import {
  equalExpr,
  getArg,
  getFunctionName,
  getHead,
  getSymbolName,
} from '../common/utils';
import { Expression } from '../public';
import { ComputeEngine } from './public';
import { CortexError } from './utils';

export function isInRange(
  _symbol: Expression,
  _expr: Expression
): boolean | undefined {
  // @todo
  return undefined;
}

/**
 * Normalize an equality or inequality to a range expression:
 * `['RealRange', min, max]` where min and max are either
 * a number, `Infinity` or `['Open', num]`
 */
export function normalizeToRange(
  _engine: ComputeEngine,
  _expr: Expression
): Expression | null {
  // @todo
  return null;
}

export function isWithEngine(
  _engine: ComputeEngine,
  _predicate: Expression
): boolean | undefined {
  //  @todo
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

  // @todo: check contradiction or tautology
  // const assumptions = getAssumptions(engine, arg);
  engine.assumptions.add(predicate);
  return 'ok';
}

export function filterAssumptions(
  engine: ComputeEngine,
  head: Expression,
  arg1?: Expression,
  arg2?: Expression
): Expression[] {
  const result: Expression[] = [];
  const assumptions = engine.assumptions;
  for (const assumption of assumptions) {
    if (getFunctionName(assumption) === head) {
      if (arg1 === undefined) {
        result.push(assumption);
      } else {
        if (equalExpr(arg1, getArg(assumption, 1))) {
          if (arg2 === undefined) {
            result.push(assumption);
          } else {
            if (equalExpr(arg2, getArg(assumption, 2))) {
              result.push(assumption);
            }
          }
        }
      }
    }
  }
  return result;
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
