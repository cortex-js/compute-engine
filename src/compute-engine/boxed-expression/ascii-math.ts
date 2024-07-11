import Complex from 'complex.js';
import Decimal from 'decimal.js';
import {
  isBigRational,
  isMachineRational,
  isRational,
} from '../numerics/rationals';
import { BoxedExpression } from './public';

export type AsciiMathSerializer = (
  expr: BoxedExpression,
  precedence?: number
) => string;

export type AsciiMathOptions = {
  symbols: Record<string, string>;
  operators: Record<
    string,
    [string | ((expr: BoxedExpression) => string), number]
  >;
  functions: Record<
    string,
    string | ((expr: BoxedExpression, serialize: AsciiMathSerializer) => string)
  >;
};

const SYMBOLS = {
  PositiveInfinity: 'oo',
  NegativeInfinity: '-oo',
  Pi: 'pi',
  ExponentialE: 'e',
  ImaginaryUnit: 'i',
  // Greek letters are valid symbols (i.e. don't need to be quoted)
  alpha: 'alpha',
  beta: 'beta',
  gamma: 'gamma',
  delta: 'delta',
  epsilon: 'epsilon',
  epsilonSymbol: 'varepsilon',
  zeta: 'zeta',
  eta: 'eta',
  theta: 'theta',
  thetaSymbol: 'vartheta',
  iota: 'iota',
  kappa: 'kappa',
  lambda: 'lambda',
  mu: 'mu',
  nu: 'nu',
  xi: 'xi',
  omicron: 'omicron',
  pi: 'pi',
  rho: 'rho',
  sigma: 'sigma',
  tau: 'tau',
  upsilon: 'upsilon',
  phi: 'phi',
  phiSymbol: 'varphi',
  chi: 'chi',
  psi: 'psi',
  omega: 'omega',
  Gamma: 'Gamma',
  Delta: 'Delta',
  Theta: 'Theta',
  Lambda: 'Lambda',
  Xi: 'Xi',
  Sigma: 'Sigma',
  Upsilon: 'Upsilon',
  Phi: 'Phi',
  Psi: 'Psi',
  Omega: 'Omega',
};

const OPERATORS = {
  Add: [
    (expr, serialize) => {
      // Use a reduce, so that if the second argument starts with a + or -, don't include a '+' in the result
      return (
        expr.ops?.reduce((acc, x) => {
          if (x.head === 'Negate') {
            const rhs = serialize(x.op1, 10);
            if (acc === '') return `-${rhs}`;
            if (rhs.startsWith('+')) return `${acc} - ${rhs.substring(1)}`;
            if (rhs.startsWith('-')) return `${acc} + ${rhs.substring(1)}`;
            return `${acc} - ${rhs}`;
          }
          const rhs = serialize(x, 10);
          if (acc === '') return rhs;
          if (rhs.startsWith('+')) return `${acc} + ${rhs.substring(1)}`;
          if (rhs.startsWith('-')) return `${acc} - ${rhs.substring(1)}`;
          return `${acc} + ${rhs}`;
        }, '') ?? ''
      );
    },
    11,
  ],
  Negate: ['-', 14], // Unary operator
  Subtract: [
    (expr, serialize) => {
      return (
        expr.ops?.reduce((acc, x) => {
          const rhs = serialize(x, 10);
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
    (expr, serialize) => {
      if (expr.nops === 2) {
        const lhs = expr.op1.numericValue;
        if (lhs !== null) {
          if (lhs === 1) return serialize(expr.op2, 12);
          if (lhs === -1) return `-${serialize(expr.op2, 12)}`;
          if (lhs instanceof Complex) {
            if (lhs.re === 0 && lhs.im === 1)
              return `${serialize(expr.op2, 12)}i`;
            if (lhs.re === 0) return `${serialize(expr.op2, 12)} * ${lhs.im}i`;
            return `${serialize(expr.op2, 12)} * (${lhs.re} + ${lhs.im}i)`;
          }
          const rhs = expr.op2;
          if (
            rhs.symbol ||
            rhs.head === 'Power' ||
            rhs.head === 'Square' ||
            typeof FUNCTIONS[rhs.head] === 'string'
          ) {
            if (isRational(lhs) && lhs[0] === 1) {
              const den = lhs[1];
              return `${serialize(rhs, 12)}/${den}`;
            }
          }
          const l = serialize(expr.op1, 12);
          const r = serialize(expr.op2, 12);
          // Is it a digit followed by a non-digit?
          if (l.match(/\d$/) && r.match(/^[a-zA-Z\(]/)) return l + r;
          if (r.match(/\d$/) && l.match(/^[a-zA-Z\(]/)) return r + l;
          return l + ' * ' + r;
        }
      }
      if (!expr.ops) return '';
      // Use a reduce over each term
      return (
        expr.ops
          // .reverse()
          .reduce((acc, x) => {
            const rhs = serialize(x, 12);
            const lhs = acc[0];
            if (lhs === '-1' || lhs === '(-1)')
              return [...acc.slice(1), `-${rhs}`];
            if (lhs && /\d$/.test(lhs) && /^[a-zA-Z\(]/.test(rhs))
              return [...acc.slice(1), `${lhs}${rhs}`];
            return [...acc, rhs];
          }, [])
          .join(' * ')
      );
    },
    12,
  ],
  Divide: ['/', 13],
  Power: [
    (expr, serialize) => {
      const exponent = serialize(expr.op2, 14);
      if (exponent === '1') return serialize(expr.op1);
      if (exponent === '(1/2)') return `sqrt(${serialize(expr.op1)})`;
      return `${serialize(expr.op1, 14)}^${exponent}`;
    },
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
  Abs: (expr: BoxedExpression, serialize) => `|${serialize(expr.op1)}|`,

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

  Ceil: 'ceil', // also: (expr, serialize) => `|~${serialize(expr.op1)}~|`,
  Exp: 'exp',
  Factorial: (expr, serialize) => `${serialize(expr.op1)}!`,
  Floor: 'floor', // also: (expr, serialize) => `|__${serialize(expr.op1)}__|`,
  Log: 'log',
  Ln: 'ln',
  Log10: 'log10',
  Sqrt: 'sqrt',
  Root: (expr, serialize) =>
    `root(${serialize(expr.op1)})(${serialize(expr.op2)})`,
  Square: (expr, serialize) => `${serialize(expr.op1, 12)}^2`,

  Det: 'det',
  Dim: 'dim',
  Mod: 'mod',

  GCD: 'gcd',
  LCM: 'lcm',
  Lub: 'lub',
  Glb: 'glb',
  Max: 'max',
  Min: 'min',

  Sum: (expr, serialize) => bigOp(expr, 'sum', serialize),
  Product: (expr, serialize) => bigOp(expr, 'prod', serialize),
  Integrate: (expr, serialize) => bigOp(expr, 'int', serialize),

  // Note: use ops[0], not op1 because op1 is "Nothing" when empty, and
  // we need to correctly handle `["Delimiter"]`
  Delimiter: (expr, serialize) =>
    delimiter(expr.ops[0], expr.ops[1]?.string, serialize),
  Sequence: (expr, serialize) => {
    if (expr.nops === 0) return '';
    return expr.ops.map((x) => serialize(x)).join(' ');
  },

  List: (expr, serialize) => `[${expr.ops?.map((x) => serialize(x)) ?? ''}]`,
  Single: (expr, serialize) =>
    `(${expr.ops.map((x) => serialize(x)).join(', ')})`,
  Pair: (expr, serialize) =>
    `(${expr.ops.map((x) => serialize(x)).join(', ')})`,
  Triple: (expr, serialize) =>
    `(${expr.ops.map((x) => serialize(x)).join(', ')})`,
  Tuple: (expr, serialize) =>
    `(${expr.ops.map((x) => serialize(x)).join(', ')})`,

  Function: (expr, serialize) =>
    `(${expr
      .ops!.slice(1)
      .map((x) => serialize(x))
      .join(', ')}) |-> {${serialize(expr.op1)}}`,

  Domain: (expr) => JSON.stringify(expr.json),
};

export function toAsciiMath(
  expr: BoxedExpression,
  options: Partial<AsciiMathOptions> = {},
  precedence = 0
): string {
  if (expr.symbol) {
    const symbols = options.symbols
      ? { ...SYMBOLS, ...options.symbols }
      : SYMBOLS;
    if (symbols[expr.symbol]) return symbols[expr.symbol];
    if (expr.symbol.length === 1) return expr.symbol;
    return `"${expr.symbol}"`;
  }

  const serialize: AsciiMathSerializer = (expr, precedence = 0) =>
    toAsciiMath(expr, options, precedence);

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
      return wrap(`${num[0].toString()}/${num[1].toString()}`, precedence, 12);
    if (isBigRational(num))
      return wrap(`${num[0].toString()}/${num[1].toString()}`, precedence, 12);
    if (num instanceof Complex) {
      const im = num.im === 1 ? '' : num.im === -1 ? '-' : num.im.toString();
      if (num.re === 0) return im + 'i';
      if (num.im < 0) return `${num.re.toString()}${im}i`;
      return wrap(`${num.re.toString()}+${im}i`, precedence, 11);
    }
  }

  if (expr.head && typeof expr.head === 'string') {
    const operators = options.operators
      ? { ...OPERATORS, ...options.operators }
      : OPERATORS;
    const [operator, precedence_] = operators[expr.head] ?? [];
    if (operator) {
      // Go over each operands and convert them to ascii math
      let result = '';
      if (typeof operator === 'function') {
        result = operator(expr, serialize);
      } else {
        if (expr.nops === 1)
          return `${operator}${serialize(expr.op1, precedence_ + 1)}`;

        result =
          expr.ops
            ?.map((x) => serialize(x, precedence_ + 1))
            .join(` ${operator} `) ?? '';
      }
      if (precedence > precedence_) result = `(${result})`;
      return result;
    }
    const functions = options.functions
      ? { ...FUNCTIONS, ...options.functions }
      : FUNCTIONS;
    const func = functions[expr.head];
    if (typeof func === 'function') return func(expr, serialize);
    if (typeof func === 'string')
      return `${func}(${expr.ops?.map((x) => serialize(x)).join(', ') ?? ''})`;
    return `${expr.head}(${expr.ops?.map((x) => serialize(x)).join(', ') ?? ''})`;
  }

  return JSON.stringify(expr.json);
}

function bigOp(
  expr: BoxedExpression,
  op: string,
  serialize: AsciiMathSerializer
) {
  const op2 = expr.op2;
  let index: BoxedExpression | null = op2?.op1;
  let start: BoxedExpression | null = op2?.op2;
  let end: BoxedExpression | null = op2?.op3;
  if (index.symbol === 'Nothing') index = null;
  if (start.symbol === 'Nothing') start = null;
  if (end.symbol === 'Nothing') end = null;

  let result = op;

  if (index && start) result += `_(${serialize(index)}=${serialize(start)})`;

  if (end) result += `^(${serialize(end)})`;

  result += `(${serialize(expr.op1)})`;

  return result;
}

function delimiter(
  expr: BoxedExpression | undefined,
  delimiter: string | undefined | null,
  serialize: AsciiMathSerializer
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

  if (!expr) return `${open}${close}`;

  let items: ReadonlyArray<BoxedExpression> = [expr.op1];
  if (expr.op1.head === 'Sequence') items = expr.op1.ops!;

  return `${open}${items.map((x) => serialize(x)).join(separator)}${close}`;
}

function wrap(s: string, precedence: number, target: number): string {
  if (precedence >= target) return `(${s})`;
  return s;
}
