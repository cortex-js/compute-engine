import { Expression } from './types';
import { xop, machineValue, symbol, xhead, xops } from './utils';

function serializeBaseForm(expr: Expression): string | null {
  if (xhead(expr) !== 'BaseForm') return null;
  const op1 = machineValue(xop(expr, 1));
  if (op1 === null || !Number.isInteger(op1) || op1 < 0) return null;
  const base = machineValue(xop(expr, 2)) ?? 10;
  if (base === 2) return `0b${op1.toString(2)}`;
  if (base === 8) return `0o${op1.toString(8)}`;
  if (base === 16) return `0x${op1.toString(16)}`;
  return op1.toString();
}

function serializeNumber(expr: Expression): string | null {
  if (xhead(expr) === 'Complex') {
    const op1 = xop(expr, 1);
    const op2 = xop(expr, 2);
    if (op1 === null || op2 === null) return null;
    if (machineValue(op1) === 0) {
      return serializeNumber(op2) + 'j';
    }
    if (machineValue(op2) === 0) return serializeNumber(op1);
    return '(' + serializeNumber(op1) + ' + ' + serializeNumber(op2) + 'j)';
  }

  if (xhead(expr) === 'Rational') {
    const op1 = xop(expr, 1);
    const op2 = xop(expr, 2);
    if (op1 === null || op2 === null) return null;
    return `Rational(${serializeNumber(op1)},${serializeNumber(op2)})`;
  }

  if (xhead(expr) === 'Number') {
    const op1 = machineValue(xop(expr, 1));
    if (op1 === null) return null;
    return op1.toString();
  }

  const op1 = machineValue(expr);
  if (op1 === null) return null;
  return op1.toString();
}

function serializeSymbol(expr: Expression): string | null {
  const sym = symbol(expr);
  if (sym === null) return null;
  // @todo some special values: Pi, NaN, Nothing, Missing, True, False
  // ImaginaryUnit, ExponentialE
  return sym;
}

function serializeFunction(expr: Expression): string | null {
  const result = serializeBaseForm(expr);
  if (result !== null) return result;

  const h = xhead(expr);
  if (!h) return null;

  // @todo Convert special head:
  // Add, Multiply, Root, Power, Exp, Subtract, Divide, Negate,
  // List, Tuple, Pair, KeyValuePair,
  // String, Number,

  const args = xops(expr);
  if (args === null) return null;
  return `${h}(${args.map((x) => serializeExpression(x) ?? '')})`;
  // @todo lambdas
}

function serializeExpression(expr: Expression): string {
  return (
    serializeFunction(expr) ??
    serializeSymbol(expr) ??
    serializeNumber(expr) ??
    serializeString(expr) ??
    ''
  );
}

function serializeString(_expr: Expression): string | null {
  // @todo Handle head String  as well
  return null; // @todo
}

export function serialize(expr: Expression): string {
  try {
    return serializeExpression(expr);
  } catch (e) {
    console.error(e);
  }
  return '';
}
