import {
  getFunctionHead,
  getRationalValue,
  getSymbolName,
  getTail,
  isAtomic,
  MISSING,
  NOTHING,
  simplifyRational,
} from '../common/utils';
import { Expression } from '../public';
import { ComputeEngine, Simplification } from './public';

export function internalSimplify(
  engine: ComputeEngine,
  expr: Expression | null,
  simplifications?: Simplification[]
): Expression | null {
  if (expr === null) return null;
  if (simplifications === undefined || simplifications[0] === 'all') {
    simplifications = ['arithmetic'];
  }
  if (simplifications.length > 1) {
    let result = expr!;
    for (const simplification of simplifications) {
      result =
        engine.simplify(result, { simplifications: [simplification] }) ??
        NOTHING;
    }
    return result;
  }

  // @todo: use `simplification` to filter which functions this applies to:
  // `arithmetic`: Add, Multiply, Negate, Power, etc..
  // `trig`: Cos, Sin, etc...
  // etc...

  //
  // 1/ Simplify assumptions
  //
  // If the expression is a predicate which is an assumption, return `True`
  //
  if (engine.is(expr)) return 'True';

  //
  // 2/ Numeric simplifications
  //
  //
  const [numer, denom] = simplifyRational(getRationalValue(expr));
  if (numer !== null && denom !== null) {
    if (denom === 1) return numer;
    return ['Divide', numer, denom];
  }
  const symDef = engine.getSymbolDefinition(getSymbolName(expr) ?? '');
  if (symDef) {
    if (symDef.hold === false && symDef.value) {
      // We can substitute the symbol for its value
      return symDef.value;
    }
  }

  if (isAtomic(expr)) return expr;

  // Dictionary
  // isDictionaryObject(lhs)
  // @todo

  //
  // It's a function (not a dictionary and not atomic)
  //

  const head = engine.simplify(getFunctionHead(expr) ?? MISSING, {
    simplifications,
  });
  if (typeof head === 'string') {
    const def = engine.getFunctionDefinition(head);
    if (def) {
      // Calculate the arguments, accounting for `hold`
      const args: Expression[] = [];
      const tail = getTail(expr);
      for (let i = 0; i < tail.length; i++) {
        if (
          (i === 0 && def.hold === 'first') ||
          (i > 0 && def.hold === 'rest') ||
          def.hold === 'all'
        ) {
          args.push(tail[i]);
        } else {
          args.push(engine.simplify(tail[i], { simplifications }) ?? tail[i]);
        }
      }
      if (typeof def.simplify === 'function') {
        return def.simplify(engine, ...args);
      }
      return [head, ...args];
    }
  }
  if (head !== null) {
    // If we can't identify the function, we don't know how to process
    // the arguments (they may be Hold...), so don't attempt to process them.
    return [head, ...getTail(expr)];
  }
  return expr;
}
