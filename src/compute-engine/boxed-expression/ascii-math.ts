import type { BoxedExpression } from './public';

import { isRational } from '../numerics/rationals';

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
  PositiveInfinity: '+oo',
  NegativeInfinity: '-oo',
  ComplexInfinity: '~oo',
  NaN: 'NaN',
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

const OPERATORS: Record<
  string,
  [
    string | ((x: BoxedExpression, AsciiMathSerializer) => string),
    precedence: number,
  ]
> = {
  Add: [
    (expr, serialize) => {
      // Use a reduce, so that if the second argument starts with a + or -
      // we don't include a '+' in the result
      return (
        expr.ops?.reduce((acc: string, x) => {
          if (x.operator === 'Negate') {
            const rhs = serialize(x.op1, 10);
            if (acc === '') return `-${rhs}`;
            if (rhs.startsWith('+')) return `${acc} - ${rhs.substring(1)}`;
            if (rhs.startsWith('-')) return `${acc} + ${rhs.substring(1)}`;
            return `${acc} - ${rhs}`;
          }
          return joinAdd(acc, serialize(x, 10));
        }, '') ?? ''
      );
    },
    11,
  ],
  Negate: [
    (expr, serialize) => {
      const base = serialize(expr.op1, 14);
      // Always wrap the base in parentheses if power to avoid ambiguity,
      // i.e. -3^2 -> -(3^2)
      if (base === 'Power') return `-(${base})`;
      return `-${base}`;
    },
    14,
  ],
  Subtract: [
    (expr, serialize) => {
      return (
        expr.ops?.reduce((acc, x) => {
          const rhs = serialize(x, 10);
          if (acc === '') return rhs;
          if (rhs.startsWith('-')) return `${acc} - (${rhs})`;
          return `${acc} - ${rhs}`;
        }, '') ?? ''
      );
    },
    11,
  ],
  Multiply: [
    (expr, serialize) => {
      if (!expr.ops) return '';
      if (expr.nops === 2) {
        const lhs = expr.op1.numericValue;
        if (lhs !== null) {
          if (typeof lhs !== 'number' && lhs.im !== 0) {
            joinMul(
              serialize(expr.op2, 12),
              joinAdd(lhs.re.toString(), `${lhs.im}i`)
            );
          }

          const rhs = expr.op2;
          if (
            rhs.symbol ||
            rhs.operator === 'Power' ||
            rhs.operator === 'Square' ||
            typeof FUNCTIONS[rhs.operator] === 'string'
          ) {
            if (isRational(lhs) && lhs[0] === 1) {
              const den = lhs[1];
              return `${serialize(rhs, 12)}/${den}`;
            }
          }

          return joinMul(serialize(expr.op1, 12), serialize(expr.op2, 12));
        }
      }
      // Use a reduce over each term
      return expr.ops.reduce((acc, x) => joinMul(acc, serialize(x, 12)), '');
    },
    12,
  ],
  Divide: ['/', 13],
  Power: [
    (expr, serialize) => {
      const exponent = serialize(expr.op2, 14);
      if (exponent === '1') return serialize(expr.op1);
      if (exponent === '(1/2)' || exponent === '1/2' || exponent === '0.5')
        return `sqrt(${serialize(expr.op1)})`;
      if (exponent === '-0.5') return `(1/sqrt(${serialize(expr.op1)}))`;
      let base = serialize(expr.op1, 14);
      // Always wrap the base in parentheses if negative to avoid ambiguity,
      // i.e. -3^2 -> (-3)^2
      if (base.startsWith('-')) base = `(${base})`;
      // Wrap the exponent in parentheses if longer than 1 character
      if (exponent.length === 1) return `${base}^${exponent}`;
      return `${base}^${wrap(exponent)}`;
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

const FUNCTIONS: Record<
  string,
  string | ((expr: BoxedExpression, serialize: AsciiMathSerializer) => string)
> = {
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
  Factorial: (expr, serialize) => `${serialize(expr.op1, 12)}!`,
  Floor: 'floor', // also: (expr, serialize) => `|__${serialize(expr.op1)}__|`,
  Log: 'log',
  Ln: 'ln',
  Log10: 'log10',
  Sqrt: 'sqrt',
  Root: (expr, serialize) => {
    const x = expr.op1;
    const n = expr.op2;
    if (n.isEqual(2)) return `sqrt${wrap(serialize(x))}`;
    return `root${wrap(serialize(n))}${wrap(serialize(x))}`;
  },
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

  Sum: (expr: BoxedExpression, serialize) => bigOp(expr, 'sum', serialize),
  Product: (expr: BoxedExpression, serialize) => bigOp(expr, 'prod', serialize),
  Integrate: (expr: BoxedExpression, serialize) =>
    bigOp(expr, 'int', serialize),

  // Note: use ops[0], not op1 because op1 is "Nothing" when empty, and
  // we need to correctly handle `["Delimiter"]`
  Delimiter: (expr: BoxedExpression, serialize) =>
    delimiter(expr.ops![0], expr.ops![1]?.string, serialize),
  Sequence: (expr: BoxedExpression, serialize) => {
    if (expr.nops === 0) return '';
    return expr.ops!.map((x) => serialize(x)).join(' ');
  },

  List: (expr: BoxedExpression, serialize) =>
    `[${expr.ops?.map((x) => serialize(x)) ?? ''}]`,
  Single: (expr: BoxedExpression, serialize) =>
    `(${expr.ops!.map((x) => serialize(x)).join(', ')})`,
  Pair: (expr: BoxedExpression, serialize) =>
    `(${expr.ops!.map((x) => serialize(x)).join(', ')})`,
  Triple: (expr: BoxedExpression, serialize) =>
    `(${expr.ops!.map((x) => serialize(x)).join(', ')})`,
  Tuple: (expr: BoxedExpression, serialize) =>
    `(${expr.ops!.map((x) => serialize(x)).join(', ')})`,

  Function: (expr: BoxedExpression, serialize) =>
    `(${expr
      .ops!.slice(1)
      .map((x) => serialize(x))
      .join(', ')}) |-> {${serialize(expr.op1)}}`,

  Domain: (expr: BoxedExpression) => JSON.stringify(expr.json),
  Error: (expr: BoxedExpression, serialize) => {
    if (expr.nops === 1) return `Error(${serialize(expr.op1)})`;
    if (expr.nops === 2) {
      if (expr.op1.string)
        return `Error("${expr.op1.string}", ${serialize(expr.op2)})`;
      return `Error(${serialize(expr.op1)}, ${serialize(expr.op2)})`;
    }
    return `Error(${expr.ops!.map((x) => serialize(x)).join(', ')})`;
  },
  LatexString: (expr: BoxedExpression) => {
    return `"${expr.op1.string ?? ''}"`;
  },
};

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

  if (end) result += `^${wrap(serialize(end))}`;

  return result + wrap(serialize(expr.op1));
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
  if (expr.op1.operator === 'Sequence') items = expr.op1.ops!;

  return `${open}${items.map((x) => serialize(x)).join(separator)}${close}`;
}

function wrap(s: string, precedence = 0, target = -1): string {
  if (precedence > target && !/^\(.+\)$/.test(s)) return `(${s})`;
  return s;
}

function serializeSymbol(
  symbol: string,
  options: Partial<AsciiMathOptions> = {}
): string {
  // Is there a custom definition for this symbol?
  if (options.symbols?.[symbol]) return options.symbols[symbol];

  // Is there a default definition for this symbol?
  if (SYMBOLS[symbol]) return SYMBOLS[symbol];

  // Otherwise, quote the symbol if it's not a single character
  return symbol.length === 1 ? symbol : `"${symbol}"`;
}

export function toAsciiMath(
  expr: BoxedExpression,
  options: Partial<AsciiMathOptions> = {},
  precedence = 0
): string {
  //
  // A symbol?
  //
  if (expr.symbol) return serializeSymbol(expr.symbol, options);

  const serialize: AsciiMathSerializer = (expr, precedence = 0) =>
    toAsciiMath(expr, options, precedence);

  //
  // A string ?
  //
  if (expr.string) return expr.string;

  //
  // A number ?
  //
  const num = expr.numericValue;
  if (num !== null) {
    const ce = expr.engine;
    if (expr.isNaN) return serializeSymbol('NaN', options);
    if (!expr.isFinite) {
      return serializeSymbol(
        expr.isNegative ? 'NegativeInfinity' : 'PositiveInfinity',
        options
      );
    }

    // It's either a plain number or a NumericValue...
    return num.toString();
  }

  //
  // A function expression?
  //
  if (expr.operator) {
    const operators = options.operators
      ? { ...OPERATORS, ...options.operators }
      : OPERATORS;
    const [operator, precedence_] = operators[expr.operator] ?? [];
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
      return wrap(result, precedence, precedence_);
    }
    const functions = options.functions
      ? { ...FUNCTIONS, ...options.functions }
      : FUNCTIONS;
    const func = functions[expr.operator];
    if (typeof func === 'function') return func(expr, serialize);
    if (typeof func === 'string')
      return `${func}(${expr.ops?.map((x) => serialize(x)).join(', ') ?? ''})`;
    return `${expr.operator}(${expr.ops?.map((x) => serialize(x)).join(', ') ?? ''})`;
  }

  return JSON.stringify(expr.json);
}

function joinMul(lhs: string, rhs: string) {
  if (!lhs) return rhs;
  if (!rhs) return lhs;
  if (lhs === '1') return rhs;
  if (rhs === '1') return lhs;

  if (rhs.startsWith('-')) rhs = `(${rhs})`;

  if (lhs === '-1') return `-${rhs}`;
  if (rhs === '-1') return `-${lhs}`;

  // Is it a sequence of digits (integer) followed by a non-digit?
  // e.g. 2x, 3y, 4z, etc.
  if (lhs.match(/^[-+]?\d+$/) && rhs.match(/^[a-zA-Z\(]/)) return lhs + rhs;
  return `${lhs} * ${rhs}`;
}

function joinAdd(lhs: string, rhs: string) {
  if (!lhs) return rhs;
  if (!rhs) return lhs;
  if (lhs === '0') return rhs;
  if (rhs === '0') return lhs;
  if (rhs.startsWith('-')) return `${lhs} - ${rhs.substring(1)}`;
  return `${lhs} + ${rhs}`;
}
