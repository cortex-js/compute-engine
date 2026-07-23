import type {
  Expression,
  FunctionInterface,
  DisplayDigits,
} from '../global-types.js';
import type { BigDecimal } from '../../big-decimal/index.js';

import { machineValue } from '../../math-json/utils.js';
import { isRational } from '../numerics/rationals.js';
import {
  roundToSignificant,
  roundToDecimalPlace,
  roundMeasurementForDisplay,
} from '../numerics/strings.js';
import { isFunction, isSymbol, isString, isNumber } from './type-guards.js';

/** Helper type for expressions known to be function expressions (in operator/function callbacks) */
type FnExpr = Expression & FunctionInterface;

const SERIES_NAMED_CONSTANTS = new Set([
  'Pi',
  'ExponentialE',
  'ImaginaryUnit',
  'GoldenRatio',
  'EulerGamma',
  'CatalanConstant',
  'MachineEpsilon',
]);

function expressionHasSymbol(expr: Expression, variable: string): boolean {
  if (isSymbol(expr)) return expr.symbol === variable;
  return (
    isFunction(expr) && expr.ops.some((x) => expressionHasSymbol(x, variable))
  );
}

function asciiSeriesVariable(expr: Expression): string | undefined {
  if (isSymbol(expr))
    return SERIES_NAMED_CONSTANTS.has(expr.symbol) ? undefined : expr.symbol;
  if (!isFunction(expr)) return undefined;
  for (const op of expr.ops) {
    const result = asciiSeriesVariable(op);
    if (result) return result;
  }
  return undefined;
}

function asciiSeriesDegree(
  expr: Expression,
  variable: string
): number | undefined {
  if (isNumber(expr)) return 0;
  if (isSymbol(expr)) return expr.symbol === variable ? 1 : 0;
  if (!isFunction(expr)) return 0;
  if (expr.operator === 'Negate') return asciiSeriesDegree(expr.op1, variable);
  if (expr.operator === 'Multiply') {
    let total = 0;
    for (const factor of expr.ops) {
      const degree = asciiSeriesDegree(factor, variable);
      if (degree === undefined) return undefined;
      total += degree;
    }
    return total;
  }
  if (expr.operator === 'Divide') {
    const numerator = asciiSeriesDegree(expr.op1, variable);
    const denominator = asciiSeriesDegree(expr.op2, variable);
    return numerator === undefined || denominator === undefined
      ? undefined
      : numerator - denominator;
  }
  if (expr.operator === 'Power') {
    const baseDegree = asciiSeriesDegree(expr.op1, variable);
    if (baseDegree === undefined) return undefined;
    if (baseDegree === 0)
      return expressionHasSymbol(expr.op2, variable) ? undefined : 0;
    const exponent = expr.op2.re;
    return Number.isInteger(exponent) ? baseDegree * exponent : undefined;
  }
  if (expr.operator === 'Add' || expr.operator === 'Subtract') {
    let maximum: number | undefined;
    for (const term of expr.ops) {
      const degree = asciiSeriesDegree(term, variable);
      if (degree !== undefined && (maximum === undefined || degree > maximum))
        maximum = degree;
    }
    return maximum;
  }
  return expressionHasSymbol(expr, variable) ? undefined : 0;
}

function asciiBigOArgument(expr: Expression): Expression | undefined {
  if (isFunction(expr, 'Negate')) expr = expr.op1;
  return isFunction(expr, 'BigO') ? expr.op1 : undefined;
}

function reorderAsciiSeriesTerms(
  ops: ReadonlyArray<Expression>
): ReadonlyArray<Expression> {
  const bigOArgs = ops.map(asciiBigOArgument);
  const firstBigOArg = bigOArgs.find((x) => x !== undefined);
  if (!firstBigOArg) return ops;
  const variable = asciiSeriesVariable(firstBigOArg);
  if (!variable) return ops;
  const ascending = (asciiSeriesDegree(firstBigOArg, variable) ?? 0) >= 0;
  const terms = ops.filter((_, i) => bigOArgs[i] === undefined);
  const bigOTerms = ops.filter((_, i) => bigOArgs[i] !== undefined);
  const degree = (term: Expression) => asciiSeriesDegree(term, variable) ?? 0;
  terms.sort((a, b) =>
    ascending ? degree(a) - degree(b) : degree(b) - degree(a)
  );
  return [...terms, ...bigOTerms];
}

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
    | string
    | ((
        expr: Expression,
        serialize: AsciiMathSerializer,
        options?: Partial<AsciiMathOptions>
      ) => string)
  >;
  /** Controls how many digits numbers are displayed with. See `DisplayDigits`. */
  digits?: DisplayDigits;
};

/**
 * Apply the `digits` display control to a real number value for AsciiMath
 * output. Returns the numeric string, or `undefined` to fall through to the
 * default serialization.
 */
function serializeAsciiNumber(
  value: number | BigDecimal,
  isExact: boolean,
  digits: DisplayDigits | undefined
): string {
  if (digits === undefined || digits === 'auto' || digits === 'max')
    return value.toString();
  if ('significant' in digits) {
    // No-op on exact values (integers, rationals, radicals).
    if (isExact) return value.toString();
    return roundToSignificant(value, digits.significant).toString();
  }
  return roundToDecimalPlace(value, digits.fractional);
}

const SYMBOLS: Record<string, string> = {
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
    string | ((x: Expression, serialize: AsciiMathSerializer) => string),
    precedence: number,
  ]
> = {
  Add: [
    (expr_, serialize) => {
      const expr = expr_ as FnExpr;
      let ops = [...reorderAsciiSeriesTerms(expr.ops)];

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
  | string
  | ((
      expr: Expression,
      serialize: AsciiMathSerializer,
      options?: Partial<AsciiMathOptions>
    ) => string)
> = {
  Abs: (expr: Expression, serialize) => `|${serialize((expr as FnExpr).op1)}|`,
  Norm: (expr: Expression, serialize) =>
    `||${serialize((expr as FnExpr).op1)}||`,

  // The dense-output table of an `InterpolatingFunction` (see
  // `NDSolveFunction`) is elided: only the covered interval and the applied
  // argument are displayed. (The LaTeX serializer elides identically; the
  // full table is carried by MathJSON.)
  InterpolatingFunction: (expr: Expression, serialize) => {
    const fn = expr as FnExpr;
    const data = fn.op1 as FnExpr;
    let domain = '';
    if (data.operator === 'List' && data.nops > 0) {
      const first = data.ops[0] as FnExpr;
      const last = data.ops[data.nops - 1] as FnExpr;
      const x0 = first.ops?.[0]?.re;
      const xl = last.ops?.[0]?.re;
      const hl = last.ops?.[1]?.re;
      if (
        Number.isFinite(x0) &&
        xl !== undefined &&
        hl !== undefined &&
        Number.isFinite(xl + hl)
      )
        domain = `[${Math.round(x0 * 1e6) / 1e6}, ${Math.round((xl + hl) * 1e6) / 1e6}]`;
    }
    const arg = fn.nops > 1 ? `(${serialize(fn.ops[1])})` : '';
    return `InterpolatingFunction_${domain}${arg}`;
  },

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
    // A Measurement magnitude is parenthesised so the unit applies to the whole
    // measurement: `(5.1 ± 0.2) cm`.
    const mag = isFunction(expr.op1, 'Measurement')
      ? `(${serialize(expr.op1)})`
      : serialize(expr.op1);
    return `${mag} ${unitToString(expr.op2)}`;
  },

  GCD: 'gcd',
  LCM: 'lcm',
  Lub: 'lub',
  Glb: 'glb',
  Max: 'max',
  Min: 'min',

  // Indexed sequence `\{a_n\}_{n=1}^{\infty}` → `{a_n : n = 1..oo}`. The term
  // is held in call form (`["a_", "n"]`); render that back as `a_n` for
  // readability, and drop the upper bound when absent.
  IndexedSequence: (expr_, serialize) => {
    const expr = expr_ as FnExpr;
    const t = expr.op1;
    const term =
      isFunction(t) &&
      t.operator.length > 1 &&
      t.operator.endsWith('_') &&
      t.nops === 1
        ? `${t.operator.slice(0, -1)}_${serialize(t.op1)}`
        : serialize(t);
    const index = serialize(expr.op2);
    const lower = serialize(expr.op3);
    const upper = expr.ops[3] ? serialize(expr.ops[3]) : '';
    return `{${term} : ${index} = ${lower}..${upper}}`;
  },

  Measurement: (expr_, serialize, options) => {
    const [lhs, rhs] = (expr_ as FnExpr).ops;
    if (!rhs) return serialize(lhs);
    // Physics significant-figures display when both operands are plain numbers;
    // exact/symbolic operands fall through to lossless serialization (mirrors
    // the LaTeX `Measurement` serializer).
    const v = machineValue(lhs.json);
    const e = machineValue(rhs.json);
    if (
      v !== null &&
      e !== null &&
      Number.isFinite(v) &&
      Number.isFinite(e) &&
      e > 0
    ) {
      const { value, error } = roundMeasurementForDisplay(
        v,
        e,
        options?.digits
      );
      return `${value} ± ${error}`;
    }
    return `${serialize(lhs)} ± ${serialize(rhs)}`;
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

  // Restriction/conditional value: `arcsin(a) {|a| <= 1}` — mirrors the
  // LaTeX restriction notation `expr\left\{cond\right\}` (D3).
  When: (expr_: Expression, serialize) => {
    const expr = expr_ as FnExpr;
    if (expr.nops !== 2)
      return `When(${expr.ops.map((x) => serialize(x)).join(', ')})`;
    return `${serialize(expr.op1)} {${serialize(expr.op2)}}`;
  },

  EvaluateAt: (expr_: Expression, serialize) => {
    const expr = expr_ as FnExpr;
    // Output f|_(...)
    const f = expr.op1;
    const args = expr.ops.slice(1);
    if (args.length === 0) return serialize(f);
    if (args.length === 1) return `(${serialize(f)})|_(${serialize(args[0])})`;
    if (args.length === 2)
      return `(${serialize(f)})|_(${serialize(args[0])})^(${serialize(
        args[1]
      )})`;
    return `(${serialize(f)})|_(${args.map((x) => serialize(x)).join(', ')})`;
  },

  Function: (expr_: Expression, serialize) => {
    const expr = expr_ as FnExpr;
    const args = expr.ops.slice(1);

    // Drop type annotations (`["Typed", x, type]` -> `x`) from parameters and
    // the return-type marker on body statements (design §8).
    const unwrap = (x: Expression): Expression =>
      isFunction(x, 'Typed') ? x.op1 : x;

    const serializedArgs = () =>
      args.map((x) => serialize(unwrap(x))).join(', ');

    if (isFunction(expr.op1, 'Block')) {
      if (expr.op1.nops === 0) return `(${serializedArgs()}) |-> {}`;
      if (expr.op1.nops === 1) {
        if (args.length === 1 && isSymbol(args[0], '_1')) {
          // If there is a single argument and it's _1, we can use _ instead
          return `(_) |-> ${serialize(unwrap(expr.op1.op1).subs({ _1: '_' }))}`;
        }
        return `(${serializedArgs()}) |-> ${serialize(unwrap(expr.op1.op1))}`;
      }
      return `(${serializedArgs()}) |-> {\n    ${expr.op1.ops
        .map((x) => serialize(unwrap(x)))
        .join(';\n     ')}\n}`;
    }
    return `(${serializedArgs()}) |-> ${serialize(unwrap(expr.op1))}`;
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

/**
 * Whether `s` is a single parenthesized group, i.e. its leading `(` is closed
 * by its trailing `)`.
 *
 * A `/^\(.+\)$/` test is not enough: `(x + 1) * (x^2 - 1)` starts with `(` and
 * ends with `)` yet is two groups joined by an operator. Treating it as already
 * wrapped dropped the parentheses a lower-precedence context needed, so
 * `Divide(1, (x+1)(x^2-1))` printed as `1 / (x + 1) * (x^2 - 1)` — which reads
 * back as `(1/(x+1))·(x^2-1)`.
 */
function isParenthesizedGroup(s: string): boolean {
  if (s.length < 2 || !s.startsWith('(') || !s.endsWith(')')) return false;
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '(') depth += 1;
    else if (s[i] === ')') {
      depth -= 1;
      // The opening parenthesis closed before the end: not a single group.
      if (depth === 0 && i < s.length - 1) return false;
    }
  }
  return depth === 0;
}

function wrap(s: string, precedence = 0, target = -1): string {
  if (precedence > target && !isParenthesizedGroup(s)) return `(${s})`;
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
    if (options.digits !== undefined) {
      if (typeof num === 'number')
        return serializeAsciiNumber(num, expr.isExact, options.digits);
      // Round real values only; leave complex values to their default form.
      if (num.im === 0)
        return serializeAsciiNumber(
          num.bignumRe ?? num.re,
          expr.isExact,
          options.digits
        );
    }
    return num.toString();
  }

  //
  // A function expression (or tensor with operator)?
  //
  // Check operator (available on all expression types) for dispatch,
  // then use isFunction for narrowing to access .ops, .op1 etc.
  // A tensor value is a plain `List` `BoxedFunction` (_kind = 'function').
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
  if (typeof func === 'function') return func(expr, serialize, options);
  // For non-function expression types with operators (e.g., tensors like List),
  // fall through to JSON serialization if no matching function/operator handler
  if (fnExpr) {
    if (typeof func === 'string')
      return `${func}(${fnExpr.ops.map((x) => serialize(x)).join(', ') ?? ''})`;
    return `${expr.operator}(${
      fnExpr.ops.map((x) => serialize(x)).join(', ') ?? ''
    })`;
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
