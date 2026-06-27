import type { Expression, IComputeEngine } from './global-types';
import { isFunction, isSymbol } from './boxed-expression/type-guards';

export function symbolArg(
  engine: IComputeEngine,
  arg: Expression | undefined
): Expression {
  if (arg === undefined) return engine.error('missing');
  if (!isSymbol(arg)) return engine.typeError('symbol', arg.type, arg);
  return arg;
}

export function isDependentFunction(
  expr: Expression,
  dependentName: string,
  independentName: string
): boolean {
  return (
    isFunction(expr) &&
    expr.operator === dependentName &&
    expr.nops === 1 &&
    isSymbol(expr.op1, independentName)
  );
}

export function isDerivativeOfDependent(
  expr: Expression,
  dependentName: string,
  independentName: string
): boolean {
  if (isFunction(expr, 'D')) {
    return (
      isDependentFunction(expr.op1, dependentName, independentName) &&
      isSymbol(expr.op2, independentName)
    );
  }

  if (isFunction(expr, 'Apply') && isFunction(expr.op1, 'Derivative')) {
    return (
      isSymbol(expr.op1.op1, dependentName) &&
      expr.nops === 2 &&
      isSymbol(expr.op2, independentName)
    );
  }

  return false;
}
