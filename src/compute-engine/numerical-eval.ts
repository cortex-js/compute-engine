import {
  getFunctionHead,
  getNumberValue,
  getSymbolName,
  getTail,
  mapArgs,
  NOTHING,
} from '../common/utils';
import { Expression } from '../public';
import { ComputeEngine } from './public';
import { simplifyOnce } from './simplify';

export function numericalEvalWithEngine(
  engine: ComputeEngine,
  expr: Expression
): Expression | null {
  // @todo: implement evaluation algorithm:
  // 1/ Convert to Canonical Form.

  // 2/ Is it a number?
  const val = getNumberValue(expr);
  if (val !== null) return val;

  // 3/ Is is a symbol?
  const symbol = getSymbolName(expr);
  if (symbol !== null) {
    const def = engine.getSymbolDefinition(symbol);
    if (def && def.value) {
      return numericalEvalWithEngine(engine, def.value);
    }
    return expr;
  }

  // 4/ Is it a dictionary?
  // @todo:

  // 5/ Is it a function?

  const head = simplifyOnce(engine, getFunctionHead(expr));
  if (typeof head === 'string') {
    const def = engine.getFunctionDefinition(head);
    if (def && typeof def.evalf === 'function') {
      return def.evalf(engine, ...getTail(expr));
    }
  }
  if (head !== null) {
    return [head, ...mapArgs(expr, (x) => simplifyOnce(engine, x) ?? NOTHING)];
  }

  // Probably a string...
  return expr;
}
