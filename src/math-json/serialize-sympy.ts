import { Expression } from './math-json-format';
import { op, machineValue, symbol, head, ops } from './utils';

function serializeBaseForm(expr: Expression): string | null {
  if (head(expr) !== 'BaseForm') return null;
  const op1 = machineValue(op(expr, 1));
  if (op1 === null || !Number.isInteger(op1) || op1 < 0) return null;
  const base = machineValue(op(expr, 2)) ?? 10;
  if (base === 2) return `0b${op1.toString(2)}`;
  if (base === 8) return `0o${op1.toString(8)}`;
  if (base === 16) return `0x${op1.toString(16)}`;
  return op1.toString();
}

function serializeNumber(expr: Expression): string | null {
  if (head(expr) === 'Complex') {
    const op1 = op(expr, 1);
    const op2 = op(expr, 2);
    if (op1 === null || op2 === null) return null;
    if (machineValue(op1) === 0) {
      return serializeNumber(op2) + 'j';
    }
    if (machineValue(op2) === 0) return serializeNumber(op1);
    return '(' + serializeNumber(op1) + ' + ' + serializeNumber(op2) + 'j)';
  }

  if (head(expr) === 'Rational') {
    const op1 = op(expr, 1);
    const op2 = op(expr, 2);
    if (op1 === null || op2 === null) return null;
    return `Rational(${serializeNumber(op1)},${serializeNumber(op2)})`;
  }

  if (head(expr) === 'Number') {
    const op1 = machineValue(op(expr, 1));
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
  // @todo some special values: Pi, NaN, Nothing, Missing, True, False, Maybe
  // ImaginaryUnit, ExponentialE
  return sym;
}

function serializeFunction(expr: Expression): string | null {
  const result = serializeBaseForm(expr);
  if (result !== null) return result;

  const h = head(expr);
  if (h === null) return null;

  // @todo Convert special head:
  // Add, Multiply, Root, Power, Exp, Subtract, Divide, Negate,
  // List, Tuple, Pair, KeyValuePair,
  // String, Number,

  const args = ops(expr);
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
