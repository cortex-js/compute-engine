import type { Expression, FunctionInterface } from '../global-types';

import { isRational } from '../numerics/rationals';
import { isFunction, isSymbol, isString, isNumber } from './type-guards';

/** Helper type for expressions known to be function expressions (in operator/function callbacks) */
type FnExpr = Expression & FunctionInterface;

/** Serialize a unit expression to a human-readable string like "m/s^2". */
function unitToString(expr: Expression): string {
  if (isSymbol(expr)) return expr.symbol;
  if (isNumber(expr)) return String(expr.re);
  if (!isFunction(expr)) return '';
  const op = expr.operator;
  if (op === 'Divide')
    return `${unitToString(expr.op1)}/${unitToString(expr.op2)}`;
  if (op === 'Multiply') return expr.ops.map(unitToString).join('\u22C5');
  if (op === 'Power') {
    const exp = expr.op2?.re;
    return exp !== undefined
      ? `${unitToString(expr.op1)}^${exp}`
      : unitToString(expr.op1);
  }
  return '';
}

export type AsciiMathSerializer = (
  expr: Expression,
  precedence?: number
) => string;

export type AsciiMathOptions = {
  symbols: Record<string, string>;
  operators: Record<string, [string | ((expr: Expression) => string), number]>;
  functions: Record<
    string,
    string | ((expr: Expression, serialize: AsciiMathSerializer) => string)
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
  ContinuationPlaceholder: '...',

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
    string | ((x: Expression, AsciiMathSerializer) => string),
    precedence: number,
  ]
> = {
  Add: [
    (expr_, serialize) => {
      const expr = expr_ as FnExpr;
      let ops = [...expr.ops];

      // For binary sums like "-x^2 + 1", swap to display as "1 - x^2"
      // Only applies when: exactly 2 terms, first is negative, second is a positive constant
      if (
        ops.length === 2 &&
        ops[0].operator === 'Negate' &&
        ops[1].operator !== 'Negate' &&
        isNumber(ops[1])
      ) {
        ops = [ops[1], ops[0]];
      }

      // Use a reduce, so that if the second argument starts with a + or -
      // we don't include a '+' in the result
      return (
        ops.reduce((acc: string, x) => {
          if (isFunction(x, 'Negate')) {
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
    (expr_, serialize) => {
      const expr = expr_ as FnExpr;
      const base = serialize(expr.op1, 14);
      // Always wrap the base in parentheses if power to avoid ambiguity,
      // i.e. -3^2 -> -(3^2)
      const op = expr.op1?.operator;
      if (op === 'Power' || op === 'Square') return `-(${base})`;
      return `-${base}`;
    },
    14,
  ],
  Subtract: [
    (expr_, serialize) => {
      const expr = expr_ as FnExpr;
      return (
        expr.ops.reduce((acc, x) => {
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
    (expr_, serialize) => {
      const expr = expr_ as FnExpr;
      if (expr.nops === 2) {
        const op1 = expr.op1;
        if (isNumber(op1)) {
          const lhs = op1.numericValue;
          if (typeof lhs !== 'number' && lhs.im !== 0) {
            joinMul(
              serialize(expr.op2, 12),
              joinAdd(lhs.re.toString(), `${lhs.im}i`)
            );
          }

          const rhs = expr.op2;
          if (
            isSymbol(rhs) ||
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
    (expr_, serialize) => {
      const expr = expr_ as FnExpr;
      const exponent = serialize(expr.op2, 14);
      if (exponent === '1') return serialize(expr.op1);
      if (exponent === '(1/2)' || exponent === '1/2' || exponent === '0.5')
        return `sqrt(${serialize(expr.op1)})`;
      if (exponent === '-0.5' || exponent === '-1/2' || exponent === '(-1/2)')
        return `1 / sqrt(${serialize(expr.op1)})`;
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
  string | ((expr: Expression, serialize: AsciiMathSerializer) => string)
> = {
  Abs: (expr: Expression, serialize) => `|${serialize((expr as FnExpr).op1)}|`,
  Norm: (expr: Expression, serialize) =>
    `||${serialize((expr as FnExpr).op1)}||`,

  // Trigonometric functions
  Sin: 'sin',
  Cos: 'cos',
  Tan: 'tan',
  Sec: 'sec',
  Csc: 'csc',
  Cot: 'cot',

  // Inverse trigonometric functions
  Arcsin: 'arcsin',
  Arccos: 'arccos',
  Arctan: 'arctan',
  Arcsec: 'arcsec',
  Arccsc: 'arccsc',
  Arccot: 'arccot',

  // Hyperbolic functions
  Sinh: 'sinh',
  Cosh: 'cosh',
  Tanh: 'tanh',
  Sech: 'sech',
  Csch: 'csch',
  Coth: 'coth',

  // Inverse hyperbolic functions (ISO 80000-2 standard names)
  Arsinh: 'arsinh',
  Arcosh: 'arcosh',
  Artanh: 'artanh',
  Arsech: 'arsech',
  Arcsch: 'arcsch',
  Arcoth: 'arcoth',

  Ceil: 'ceil', // also: (expr, serialize) => `|~${serialize(expr.op1)}~|`,
  Exp: 'exp',
  Factorial: (expr, serialize) => `${serialize((expr as FnExpr).op1, 12)}!`,
  Floor: 'floor', // also: (expr, serialize) => `|__${serialize(expr.op1)}__|`,
  Log: 'log',
  Ln: 'ln',
  Log10: 'log10',
  Sqrt: 'sqrt',
  Root: (expr_, serialize) => {
    const expr = expr_ as FnExpr;
    const x = expr.op1;
    const n = expr.op2;
    if (n.isSame(2)) return `sqrt${wrap(serialize(x))}`;
    return `root${wrap(serialize(n))}${wrap(serialize(x))}`;
  },
  Square: (expr, serialize) => `${serialize((expr as FnExpr).op1, 12)}^2`,

  Det: 'det',
  Dim: 'dim',
  Mod: 'mod',

  Quantity: (expr_, serialize) => {
    const expr = expr_ as FnExpr;
    return `${serialize(expr.op1)} ${unitToString(expr.op2)}`;
  },

  GCD: 'gcd',
  LCM: 'lcm',
  Lub: 'lub',
  Glb: 'glb',
  Max: 'max',
  Min: 'min',

  PlusMinus: (expr_, serialize) => {
    const [lhs, rhs] = (expr_ as FnExpr).ops;
    if (!rhs) return serialize(lhs);
    if (lhs && rhs) {
      const lhs_ = serialize(lhs);
      const rhs_ = serialize(rhs);
      return `${lhs_} ± ${rhs_}`;
    }
    if (lhs) return `± ${serialize(lhs)}`;
    if (rhs) return `± ${serialize(rhs)}`;
    return '0';
  },

  Sum: (expr: Expression, serialize) => bigOp(expr, 'sum', serialize),
  Product: (expr: Expression, serialize) => bigOp(expr, 'prod', serialize),
  Integrate: (expr: Expression, serialize) => bigOp(expr, 'int', serialize),
  Limit: (expr_: Expression, serialize) => {
    const expr = expr_ as FnExpr;
    const [fn, val] = expr.ops;

    if (isFunction(fn, 'Function')) {
      const args = fn.ops.slice(2);
      const body = fn.op1 ?? fn;
      let arg: Expression | null = null;
      if (args.length === 1) arg = args[0];
      return arg
        ? `lim_(${serialize(arg)} -> ${serialize(val)}) ${serialize(body)}`
        : `lim_(${serialize(val)}) ${serialize(body)}`;
    } else if (isSymbol(fn)) {
      return `lim_(x -> ${serialize(val)}) ${serialize(fn)}(x)`;
    }

    return `lim`;
  },

  // Note: use ops[0], not op1 because op1 is "Nothing" when empty, and
  // we need to correctly handle `["Delimiter"]`
  Delimiter: (expr_: Expression, serialize) => {
    const expr = expr_ as FnExpr;
    const delimStr = isString(expr.ops[1]) ? expr.ops[1].string : undefined;
    return delimiter(expr.ops[0], delimStr, serialize);
  },
  Sequence: (expr_: Expression, serialize) => {
    const expr = expr_ as FnExpr;
    if (expr.nops === 0) return '';
    return expr.ops.map((x) => serialize(x)).join(' ');
  },

  List: (expr_: Expression, serialize) => {
    const expr = expr_ as FnExpr;
    return `[${expr.ops.map((x) => serialize(x))}]`;
  },
  Single: (expr_: Expression, serialize) => {
    const expr = expr_ as FnExpr;
    return `(${expr.ops.map((x) => serialize(x)).join(', ')})`;
  },
  Pair: (expr_: Expression, serialize) => {
    const expr = expr_ as FnExpr;
    return `(${expr.ops.map((x) => serialize(x)).join(', ')})`;
  },
  Triple: (expr_: Expression, serialize) => {
    const expr = expr_ as FnExpr;
    return `(${expr.ops.map((x) => serialize(x)).join(', ')})`;
  },
  Tuple: (expr_: Expression, serialize) => {
    const expr = expr_ as FnExpr;
    return `(${expr.ops.map((x) => serialize(x)).join(', ')})`;
  },

  Block: (expr_: Expression, serialize) => {
    const expr = expr_ as FnExpr;
    if (expr.nops === 0) return '{}';
    if (expr.nops === 1) return `{${serialize(expr.op1)}}`;
    return `{    ${expr.ops.map((x) => serialize(x)).join(';\n     ')}\n    }`;
  },

  EvaluateAt: (expr_: Expression, serialize) => {
    const expr = expr_ as FnExpr;
    // Output f|_(...)
    const f = expr.op1;
    const args = expr.ops.slice(1);
    if (args.length === 0) return serialize(f);
    if (args.length === 1) return `(${serialize(f)})|_(${serialize(args[0])})`;
    if (args.length === 2)
      return `(${serialize(f)})|_(${serialize(args[0])})^(${serialize(args[1])})`;
    return `(${serialize(f)})|_(${args.map((x) => serialize(x)).join(', ')})`;
  },

  Function: (expr_: Expression, serialize) => {
    const expr = expr_ as FnExpr;
    const args = expr.ops.slice(1);

    const serializedArgs = () => args.map((x) => serialize(x)).join(', ');

    if (isFunction(expr.op1, 'Block')) {
      if (expr.op1.nops === 0) return `(${serializedArgs()}) |-> {}`;
      if (expr.op1.nops === 1) {
        if (args.length === 1 && isSymbol(args[0], '_1')) {
          // If there is a single argument and it's _1, we can use _ instead
          return `(_) |-> ${serialize(expr.op1.op1.subs({ _1: '_' }))}`;
        }
        return `(${serializedArgs()}) |-> ${serialize(expr.op1.op1)}`;
      }
      return `(${serializedArgs()}) |-> {\n    ${expr.op1.ops
        .map((x) => serialize(x))
        .join(';\n     ')}\n}`;
    }
    return `(${serializedArgs()}) |-> ${serialize(expr.op1)}`;
  },

  Domain: (expr: Expression) => JSON.stringify(expr.json),
  Error: (expr_: Expression, serialize) => {
    const expr = expr_ as FnExpr;
    if (expr.nops === 1) return `Error(${serialize(expr.op1)})`;
    if (expr.nops === 2) {
      if (isString(expr.op1))
        return `Error("${expr.op1.string}", ${serialize(expr.op2)})`;
      return `Error(${serialize(expr.op1)}, ${serialize(expr.op2)})`;
    }
    return `Error(${expr.ops.map((x) => serialize(x)).join(', ')})`;
  },
  LatexString: (expr_: Expression) => {
    const expr = expr_ as FnExpr;
    return `"${isString(expr.op1) ? expr.op1.string : ''}"`;
  },
};

function bigOp(
  expr: Expression,
  op: string,
  serialize: AsciiMathSerializer
): string {
  if (!isFunction(expr)) return `${op}()`;
  const [fn, ...limits] = expr.ops;

  const indexes: Expression[] = [];
  let body: string;

  let args: ReadonlyArray<Expression> = [];

  if (isFunction(fn, 'Function')) {
    args = fn.ops.slice(1);
    const b = fn.op1 ?? fn;
    if (isFunction(b, 'Block')) body = serialize(b.op1 ?? b);
    else body = serialize(b);
  } else if (fn) {
    // Handle symbols and general expressions (e.g., Multiply, Add)
    args = [];
    body = serialize(fn);
  } else {
    return `${op}()`;
  }

  let result = op;

  for (const limit of limits) {
    if (
      !['Range', 'Tuple', 'Pair', 'Single', 'Limits'].includes(limit.operator)
    )
      continue;
    if (!isFunction(limit)) continue;
    if (limit.nops === 0) continue;
    if (limit.nops === 2) {
      if (isSymbol(limit.op1) && limit.op1.symbol) {
        // ["Integrate", ["Tuple", "x", 1]]
        if (limit.op1.symbol !== 'Nothing') indexes.push(limit.op1);
        if (!isSymbol(limit.op2, 'Nothing')) {
          if (op === 'int') result += `_${wrap(serialize(limit.op2))}`;
          else
            result += '_' + wrap(`${limit.op1.symbol}=${serialize(limit.op2)}`);
        }
      } else {
        // ["Integrate", ["Tuple", 1, 2]]
        if (!isSymbol(limit.op1, 'Nothing'))
          result += `_${wrap(serialize(limit.op1))}`;
        if (!isSymbol(limit.op2, 'Nothing'))
          result += `^${wrap(serialize(limit.op2))}`;
      }
    } else if (limit.nops === 3) {
      let index = '';
      if (!isSymbol(limit.op1, 'Nothing')) {
        indexes.push(limit.op1);
        index = isSymbol(limit.op1) ? limit.op1.symbol : '';
      }
      const start = !isSymbol(limit.op2, 'Nothing') ? limit.op2 : null;
      const end = !isSymbol(limit.op3, 'Nothing') ? limit.op3 : null;

      if (start) {
        if (op === 'int' || !index) result += `_${wrap(serialize(start))}`;
        else result += '_' + wrap(`${index}=${serialize(start)}`);
      } else if (op !== 'int') {
        result += `_${wrap(serialize(limit.op1))}`;
      }
      if (end) result += `^${wrap(serialize(end))}`;
    }
  }

  if (op === 'int') {
    result += wrap(body + args.map((x) => ` d${serialize(x)}`).join(' '));
  } else {
    result += wrap(body);
  }

  return result;
}

function delimiter(
  expr: Expression | undefined,
  delimiter: string | undefined,
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

  let items: ReadonlyArray<Expression> = [expr];
  if (isFunction(expr, 'Sequence')) items = expr.ops;

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

  // Don't quote wildcards
  if (symbol.startsWith('_')) return symbol;

  if (FUNCTIONS[symbol] && typeof FUNCTIONS[symbol] === 'string')
    return FUNCTIONS[symbol];

  // Otherwise, quote the symbol if it's not a single character
  return symbol.length === 1 ? symbol : `"${symbol}"`;
}

export function toAsciiMath(
  expr: Expression,
  options: Partial<AsciiMathOptions> = {},
  precedence = 0
): string {
  if (expr === undefined) return '[undefined]';
  if (expr === null) return '[null]';

  //
  // A symbol?
  //
  if (isSymbol(expr)) return serializeSymbol(expr.symbol, options);

  const serialize: AsciiMathSerializer = (expr, precedence = 0) =>
    toAsciiMath(expr, options, precedence);

  //
  // A string ?
  //
  if (isString(expr)) {
    return `"${expr.string.replace(/"/g, '\\"')}"`;
  }

  //
  // A number ?
  //
  if (isNumber(expr)) {
    const num = expr.numericValue;
    if (expr.isNaN) return serializeSymbol('NaN', options);
    if (expr.isFinite === false) {
      if (expr.isNegative !== true && expr.isPositive !== true)
        return serializeSymbol('ComplexInfinity', options);
      return serializeSymbol(
        expr.isNegative ? 'NegativeInfinity' : 'PositiveInfinity',
        options
      );
    }

    // It's either a plain number or a NumericValue...
    return num.toString();
  }

  //
  // A function expression (or tensor with operator)?
  //
  // Check operator (available on all expression types) for dispatch,
  // then use isFunction for narrowing to access .ops, .op1 etc.
  // Tensors like List also have operator but _kind = 'tensor'.
  //
  const fnExpr = isFunction(expr) ? expr : null;
  const operators = options.operators
    ? { ...OPERATORS, ...options.operators }
    : OPERATORS;
  const [operator, precedence_] = operators[expr.operator] ?? [];
  if (operator && fnExpr) {
    // Go over each operands and convert them to ascii math
    let result = '';
    if (typeof operator === 'function') {
      result = operator(fnExpr, serialize);
    } else {
      if (fnExpr.nops === 1)
        return `${operator}${serialize(fnExpr.op1, precedence_ + 1)}`;

      result =
        fnExpr.ops
          .map((x) => serialize(x, precedence_ + 1))
          .join(` ${operator} `) ?? '';
    }
    return wrap(result, precedence, precedence_);
  }
  const functions = options.functions
    ? { ...FUNCTIONS, ...options.functions }
    : FUNCTIONS;
  const func = functions[expr.operator];
  if (typeof func === 'function') return func(expr, serialize);
  // For non-function expression types with operators (e.g., tensors like List),
  // fall through to JSON serialization if no matching function/operator handler
  if (fnExpr) {
    if (typeof func === 'string')
      return `${func}(${fnExpr.ops.map((x) => serialize(x)).join(', ') ?? ''})`;
    return `${expr.operator}(${fnExpr.ops.map((x) => serialize(x)).join(', ') ?? ''})`;
  }

  return JSON.stringify(expr.json);
}

function joinMul(lhs: string, rhs: string) {
  if (!lhs) return rhs;
  if (!rhs) return lhs;

  if (rhs.startsWith('-') || rhs.startsWith('+')) rhs = `(${rhs})`;

  // Is it a sequence of digits (integer) followed by a non-digit?
  // e.g. 2x, 3y, 4z, etc.
  if (lhs.match(/^[-+]?\d+$/) && rhs.match(/^[a-zA-Z\(]/)) return lhs + rhs;
  return `${lhs} * ${rhs}`;
}

function joinAdd(lhs: string, rhs: string) {
  if (!lhs) return rhs;
  if (!rhs) return lhs;
  if (rhs.startsWith('-')) return `${lhs} - ${rhs.substring(1)}`;
  if (rhs.startsWith('+')) return `${lhs} + ${rhs.substring(1)}`;
  return `${lhs} + ${rhs}`;
}
