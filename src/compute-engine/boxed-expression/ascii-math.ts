import Complex from 'complex.js';
import Decimal from 'decimal.js';
import { isBigRational, isMachineRational } from '../numerics/rationals';
import { BoxedExpression } from './public';

const DELIMITERS = {};

const SYMBOLS = {
  PositiveInfinity: 'oo',
  NegativeInfinity: '-oo',
  Pi: 'pi',
  ExponentialE: 'e',
  ImaginaryUnit: 'i',
};

const OPERATORS = {
  Add: [
    (expr) => {
      // Use a reduce, so that if the second argument starts with a + or -, don't include a '+' in the result
      return (
        expr.ops?.reduce((acc, x) => {
          let rhs = toAsciiMath(x, 11);
          if (acc === '') return rhs;
          if (rhs.startsWith('+') || rhs.startsWith('-'))
            return `${acc} ${rhs}`;
          return `${acc} + ${rhs}`;
        }, '') ?? ''
      );
    },
    11,
  ],
  Negate: ['-', 14], // Unary operator
  Subtract: [
    (expr) => {
      return (
        expr.ops?.reduce((acc, x) => {
          let rhs = toAsciiMath(x, 11);
          if (acc === '') return rhs;
          if (rhs.startsWith('+') || rhs.startsWith('-'))
            return `${acc} ${rhs}`;
          return `${acc} - ${rhs}`;
        }, '') ?? ''
      );
    },
    ,
    11,
  ],
  Multiply: [
    (expr) => {
      if (expr.nops === 2) {
        if (expr.op1.numericValue !== null) {
          return toAsciiMath(expr.op1, 12) + toAsciiMath(expr.op2, 12);
        }
      }
      return expr.ops?.map((x) => toAsciiMath(x, 12)).join(` * `) ?? '';
    },
    12,
  ],
  Divide: ['/', 13],
  Power: [
    (expr) => expr.ops?.map((x) => toAsciiMath(x, 12)).join(`^`) ?? '',
    15,
  ],
  Equal: ['===', 8],
  NotEqual: ['!==', 8],
  LessEqual: ['<=', 9],
  GreaterEqual: ['>=', 9],
  Less: ['<', 9],
  Greater: ['>', 9],
  And: ['&&', 4],
  Or: ['||', 3],
  Not: ['!', 14], // Unary operator
};

const FUNCTIONS = {
  Abs: (expr: BoxedExpression) => `|${toAsciiMath(expr.op1)}|`,

  Sin: 'sin',
  Cos: 'cos',
  Tan: 'tan',
  Sec: 'sec',
  Csc: 'csc',
  Arcsin: 'arcsin',
  Arccos: 'arccos',
  Arctan: 'arctan',
  Sinh: 'sinh',
  Cosh: 'cosh',
  Tanh: 'tanh',
  Sech: 'sech',
  Csch: 'csch',
  Coth: 'coth',

  Ceil: (expr) => `|~${toAsciiMath(expr.op1)}~|`,
  Exp: 'exp',
  Factorial: (expr) => `${toAsciiMath(expr.op1)}!`,
  Floor: (expr) => `|__${toAsciiMath(expr.op1)}__|`,
  Log: 'log',
  Ln: 'ln',
  Log10: 'log10',
  Sqrt: 'sqrt',
  Root: (expr) => `root(${toAsciiMath(expr.op1)})(${toAsciiMath(expr.op2)})`,

  Det: 'det',
  Dim: 'dim',
  Mod: 'mod',

  GCD: 'gcd',
  LCM: 'lcm',
  Lub: 'lub',
  Glb: 'glb',
  Max: 'max',
  Min: 'min',

  Delimiter: (expr) => delimiter(expr.op1, expr.op2.string),
  Sequence: (expr) => {
    const delimiter = expr.op1;
    return `(${toAsciiMath(delimiter)})${toAsciiMath(expr.op2)}`;
  },
  Tuple: (expr) => {
    const delimiter = expr.op1;
    return `(${toAsciiMath(delimiter)})${toAsciiMath(expr.op2)}`;
  },
  Pair: (expr) => {
    const delimiter = expr.op1;
    return `(${toAsciiMath(delimiter)})${toAsciiMath(expr.op2)}`;
  },

  Sum: (expr) => bigOp(expr, 'sum'),
  Integrate: (expr) => bigOp(expr, 'int'),
  List: (expr) => `[${expr.ops?.map((x) => toAsciiMath(x)) ?? ''}]`,
  Domain: (expr) => JSON.stringify(expr.json),
};

export function toAsciiMath(expr: BoxedExpression, precedence = 0): string {
  if (expr.symbol) return SYMBOLS[expr.symbol] ?? expr.symbol;

  if (expr.string) return expr.string;
  const num = expr.numericValue;
  if (num !== null) {
    if (expr.isNaN) return 'NaN';
    if (!expr.isFinite) {
      if (expr.isNegative) return '-oo';
      return 'oo';
    }
    if (typeof num === 'number') return num.toString();
    if (num instanceof Decimal) return num.toString();
    if (isMachineRational(num))
      return `(${num[0].toString()}/${num[1].toString()})`;
    if (isBigRational(num))
      return `(${num[0].toString()}/${num[1].toString()})`;
    if (num instanceof Complex) {
      const im = num.im === 1 ? '' : num.im === -1 ? '-' : num.im.toString();
      if (num.re === 0) return im + 'i';
      if (num.im < 0) return `${num.re.toString()}${im}i`;
      return `(${num.re.toString()}+${im}i)`;
    }
  }

  if (expr.head && typeof expr.head === 'string') {
    const [operator, precedence_] = OPERATORS[expr.head] ?? [];
    if (operator) {
      // Go over each operands and convert them to ascii math
      let result = '';
      if (typeof operator === 'function') {
        result = operator(expr);
      } else {
        if (expr.nops === 1)
          return `${operator}${toAsciiMath(expr.op1, precedence_)}`;

        result =
          expr.ops
            ?.map((x) => toAsciiMath(x, precedence_))
            .join(` ${operator} `) ?? '';
      }
      if (precedence > precedence_) result = `(${result})`;
      return result;
    }
    const func = FUNCTIONS[expr.head];
    if (typeof func === 'function') return func(expr);
    if (typeof func === 'string')
      return `${func}(${expr.ops?.map((x) => toAsciiMath(x)).join(', ') ?? ''})`;
    return `${expr.head}(${expr.ops?.map((x) => toAsciiMath(x)).join(', ') ?? ''})`;
  }

  return JSON.stringify(expr.json);
}

function bigOp(expr: BoxedExpression, op: string) {
  const op2 = expr.op2;
  let index: BoxedExpression | null = op2?.op1;
  let start: BoxedExpression | null = op2?.op2;
  let end: BoxedExpression | null = op2?.op3;
  if (index.symbol === 'Nothing') index = null;
  if (start.symbol === 'Nothing') start = null;
  if (end.symbol === 'Nothing') end = null;

  let result = op;

  if (index && start)
    result += `_(${toAsciiMath(index)}=${toAsciiMath(start)})`;

  if (end) result += `^(${toAsciiMath(end)})`;

  result += `(${toAsciiMath(expr.op1)})`;

  return result;
}

function delimiter(
  expr: BoxedExpression,
  delimiter: string | undefined | null
) {
  if (!delimiter) delimiter = '(,)';
  let separator = '';
  let open = '';
  let close = '';
  if (delimiter.length === 1) separator = delimiter;
  if (delimiter.length === 2) {
    open = delimiter[0];
    close = delimiter[1];
  }
  if (delimiter.length === 3) {
    open = delimiter[0];
    separator = delimiter[1];
    close = delimiter[2];
  }

  let items: ReadonlyArray<BoxedExpression> = [expr.op1];
  if (expr.op1.head === 'Sequence') items = expr.op1.ops!;

  return `${open}${items.map((x) => toAsciiMath(x)).join(separator)}${close}`;
}
