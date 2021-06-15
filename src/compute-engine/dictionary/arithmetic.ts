import { Expression } from '../../public';
import {
  applyRecursively,
  DIVIDE,
  getArg,
  getArgCount,
  getFunctionHead,
  getFunctionName,
  getNumberValue,
  getRationalSymbolicValue,
  getRationalValue,
  getSymbolName,
  getTail,
  isAtomic,
  isNumberObject,
  MISSING,
  MULTIPLY,
  NEGATE,
  NOTHING,
  PARENTHESES,
} from '../../common/utils';
import type { ComputeEngine, Dictionary } from '../public';

export const ARITHMETIC_DICTIONARY: Dictionary = {
  //
  // Constants
  //

  ImaginaryI: {
    domain: 'ImaginaryNumber',
    constant: true,
    wikidata: 'Q193796',
  },
  ExponentialE: {
    domain: 'IrrationalNumber',
    wikidata: 'Q82435',
    constant: true,
    value: { num: '2.7182818284590452354' },
  },
  GoldenRatio: {
    domain: 'IrrationalNumber',
    wikidata: 'Q41690',
    constant: true,
    value: ['Divide', ['Add', 1, ['Sqrt', 5]], 2],
  },
  CatalanConstant: {
    domain: 'RealNumber', // Unproven if it is irrational
    wikidata: 'Q855282',
    constant: true,
    value: { num: '0.91596559417721901505' },
  },
  EulerGamma: {
    domain: 'RealNumber',
    wikidata: 'Q273023',
    constant: true,
    value: { num: '0.577215664901532860606' },
  },
  Quarter: {
    domain: 'RealNumber',
    wikidata: 'Q2310416',
    constant: true,
    value: [DIVIDE, 3, 4],
  },
  Third: {
    domain: 'RealNumber',
    wikidata: 'Q20021125',
    constant: true,
    value: [DIVIDE, 1, 3],
  },
  Half: {
    domain: 'RealNumber',
    wikidata: 'Q2114394',
    constant: true,
    value: [DIVIDE, 1, 2],
  },
  TwoThird: {
    domain: 'RealNumber',
    constant: true,
    value: [DIVIDE, 2, 3],
  },
  ThreeQuarter: {
    domain: 'RealNumber',
    constant: true,
    value: [DIVIDE, 3, 4],
  },

  //
  // Functions
  //
  Abs: {
    domain: 'Function',
    wikidata: 'Q3317982', //magnitude 'Q120812 (for reals)
    threadable: true,
    idempotent: true,
    range: ['Interval', 0, Infinity],
  },
  Add: {
    domain: 'Function',
    wikidata: 'Q32043',
    associative: true,
    commutative: true,
    threadable: true,
    idempotent: true,
    range: 'Number',
    simplify: simplifyAdd,
    evalf: evalfAdd,
  },
  Chop: {
    domain: 'Function',
    associative: true,
    threadable: true,
    idempotent: true,
    range: 'Number',
  },
  Ceil: {
    domain: 'Function',
    range: 'Number',
    /** rounds a number up to the next largest integer */
  },
  Exp: {
    domain: ['ContinuousFunction', 'MonotonicFunction'],
    wikidata: 'Q168698',
    threadable: true,
    range: 'Number',
  },
  Erf: {
    // Error function
    domain: ['ContinuousFunction', 'MonotonicFunction'],
    range: 'Number',
  },
  Erfc: {
    // Complementary Error Function
    domain: ['ContinuousFunction', 'MonotonicFunction'],
    range: 'Number',
  },
  Factorial: {
    wikidata: 'Q120976',
    domain: 'MonotonicFunction',
    range: 'Integer',
  },
  Floor: { domain: 'Function', wikidata: 'Q56860783', range: 'Number' },
  Gamma: { domain: 'Function', wikidata: 'Q190573', range: 'Number' },
  LogGamma: { domain: 'Function', range: 'Number' },
  Log: {
    domain: 'Function',
    wikidata: 'Q11197',
    range: 'Number',
  },
  Log2: {
    domain: 'Function',
    wikidata: 'Q581168',
    range: 'Number',
  },
  Log10: {
    domain: 'Function',
    wikidata: 'Q966582',
    range: 'Number',
  },
  // LogOnePlus: { domain: 'Function' },
  MachineEpsilon: {
    /*
            The difference between 1 and the next larger floating point number
            
            2^{−52}
            
            See https://en.wikipedia.org/wiki/Machine_epsilon
        */
    domain: 'RealNumber',
    constant: true,
    value: { num: Number.EPSILON.toString() },
  },
  Multiply: {
    domain: 'Function',
    wikidata: 'Q40276',
    associative: true,
    commutative: true,
    idempotent: true,
    range: 'Number',
    simplify: simplifyMultiply,
    evalf: evalfMultiply,
  },
  Negate: {
    domain: 'Function',
    wikidata: 'Q715358',
    range: 'Number',
    simplify: simplifyNegate,
  },
  Power: {
    domain: 'Function',
    wikidata: 'Q33456',
    commutative: false,
    range: 'Number',
  },
  Round: {
    domain: 'Function',
    range: 'Number',
  },
  SignGamma: {
    domain: 'Function',
    range: 'Number',
    /** The sign of the gamma function: -1 or +1 */
  },
  Sqrt: {
    domain: 'Function',
    wikidata: 'Q134237',
    range: 'Number',
  },
  Root: {
    domain: 'Function',
    commutative: false,
    range: 'Number',
  },
  Subtract: {
    domain: 'Function',
    wikidata: 'Q32043',
    range: 'Number',
  },
  // @todo
  // mod (modulo). See https://numerics.diploid.ca/floating-point-part-4.html,
  // regarding 'remainder' and 'truncatingRemainder'
  // lcm
  // gcd
  // root
  // sum
  // product
};

function simplifyAdd(ce: ComputeEngine, ...args: Expression[]): Expression {
  if (args.length === 0) return 0;
  if (args.length === 1) return ce.simplify(args[0]) ?? 0;

  let c = 0;
  const others: Expression[] = [];

  for (const arg of args) {
    const simplifiedArg = ce.simplify(arg) ?? NOTHING;
    const val = getNumberValue(simplifiedArg);
    if (val !== null && (!Number.isFinite(val) || Number.isInteger(val))) {
      c += val;
    } else {
      // @todo: if head is Subtract
      others.push(simplifiedArg);
    }
  }

  if (others.length === 0) return c;
  if (others.length === 1 && c === 0) return others[0];
  if (c === 0) return ['Add', ...others];
  return ['Add', ...others, c];
}

function simplifyMultiply(
  ce: ComputeEngine,
  ...args: Expression[]
): Expression {
  if (args.length === 0) return 1;
  if (args.length === 1) return ce.simplify(args[0]) ?? 1;

  const others: Expression[] = [];
  let c = 1;

  for (const arg of args) {
    const simplifiedArg = ce.simplify(arg) ?? NOTHING;
    const val = getNumberValue(simplifiedArg);
    if (val === 0) return 0;
    if (val !== null && (!Number.isFinite(val) || Number.isInteger(val))) {
      c *= val;
    } else {
      // @todo: consider distributing if the head of arg is Add or Negate or Subtract or Divide
      others.push(simplifiedArg);
    }
  }

  if (c === 0 || !isFinite(c)) return c;
  if (others.length === 0) return c;
  if (others.length === 1 && c === 1) return others[0];
  if (others.length === 1 && c === -1) return ['Negate', others[0]];
  if (c === 1) return ['Multiply', ...others];
  if (c === -1) return ['Negate', ['Multiply', ...others]];
  return ['Multiply', c, ...others];
}

function simplifyNegate(ce: ComputeEngine, arg: Expression): Expression {
  return applyNegate(ce.simplify(arg) ?? NOTHING) ?? ['Negate', arg];
}

/** Apply some simplifications for negate.
 * Used by `canonical-negate` and `simplify`
 */
export function applyNegate(expr: Expression): Expression {
  expr = ungroup(expr);
  if (typeof expr === 'number') {
    // Applying negation is safe on floating point numbers
    expr = -expr;
  } else if (expr && isNumberObject(expr)) {
    if (expr.num[0] === '-') {
      expr = { num: expr.num.slice(1) };
    } else {
      expr = { num: '-' + expr.num };
    }
  } else {
    // [NEGATE, [NEGATE, x]] -> x
    const name = getFunctionName(expr);
    const argCount = getArgCount(expr!);
    if (name === NEGATE && argCount === 1) {
      return getArg(expr, 1)!;
    } else if (name === MULTIPLY) {
      let arg = getArg(expr, 1) ?? MISSING;
      if (typeof arg === 'number') {
        arg = -arg;
      } else if (isNumberObject(arg)) {
        if (arg.num[0] === '-') {
          arg = { num: arg.num.slice(1) };
        } else {
          arg = { num: '-' + arg.num };
        }
      } else {
        arg = [NEGATE, arg];
      }
      return [MULTIPLY, arg, ...getTail(expr).slice(1)];
    } else if (name === PARENTHESES && argCount === 1) {
      return applyNegate(getArg(getArg(expr, 1)!, 1)!);
    }

    expr = [NEGATE, expr ?? MISSING];
  }
  return expr;
}

function evalfAdd(ce: ComputeEngine, ...args: Expression[]): Expression {
  if (args.length === 0) return 0;
  if (args.length === 1) return ce.N(args[1]) ?? args[1];

  const others: Expression[] = [];
  let c = 0;

  for (const arg of args) {
    const val = getNumberValue(arg) ?? getNumberValue(ce.N(arg));
    if (val !== null) {
      c += val;
    } else {
      // @todo: if head is Subtract
      others.push(arg);
    }
  }

  if (others.length === 0) return c;
  if (others.length === 1 && c === 0) return others[0];
  if (c === 0) return ['Add', ...others];
  return ['Add', ...others, c];
}

function evalfMultiply(ce: ComputeEngine, ...args: Expression[]): Expression {
  if (args.length === 0) return 1;
  if (args.length === 1) return ce.simplify(args[0]) ?? 1;

  const others: Expression[] = [];
  let c = 1;

  for (const arg of args) {
    const val = getNumberValue(arg) ?? getNumberValue(ce.N(arg));
    if (val === 0) return 0;
    if (val !== null) {
      c *= val;
    } else {
      // @todo: consider distributing if the head of arg is Add or Negate or Subtract or Divide
      others.push(arg);
    }
  }

  if (c === 0 || !isFinite(c)) return c;
  if (others.length === 0) return c;
  if (others.length === 1 && c === 1) return others[0];
  if (others.length === 1 && c === -1) return ['Negate', others[0]];
  if (c === 1) return ['Multiply', ...others];
  if (c === -1) return ['Negate', ['Multiply', ...others]];
  return ['Multiply', c, ...others];
}

export function ungroup(expr: Expression | null): Expression {
  if (expr === null) return NOTHING;
  if (isAtomic(expr)) return expr;
  if (getFunctionHead(expr) === PARENTHESES && getArgCount(expr) === 1) {
    return ungroup(getArg(expr, 1));
  }
  return applyRecursively(expr, ungroup);
}

// Used by `simplify()` and `canonical()`
// @todo: see https://docs.sympy.org/1.6/modules/core.html#pow

export function applyPower(expr: Expression): Expression {
  expr = ungroup(expr);

  console.assert(getFunctionName(expr) === 'Power');

  if (getArgCount(expr) !== 2) return expr;

  const arg1 = getArg(expr, 1)!;
  const val1 = getNumberValue(arg1) ?? NaN;
  const arg2 = getArg(expr, 2)!;

  if (getSymbolName(arg2) === 'ComplexInfinity') return NaN;

  const val2 = getNumberValue(arg2) ?? NaN;

  if (val2 === 0) return 1;
  if (val2 === 1) return arg1;

  if (val2 === -1) {
    if (val1 === -1 || val1 === 1) return -1;
    if (!Number.isFinite(val1)) return 0;
  }
  if (!Number.isFinite(val2)) {
    if (val1 === 0 && val2 < 0) return 'ComplexInfinity';

    if (val1 === 1 || val1 === -1) return NaN;

    if (val1 === Infinity) {
      if (val2 > 0) return Infinity;
      if (val2 < 0) return 0;
    }
    if (val1 === -Infinity && !Number.isFinite(val2)) return NaN;
  }
  return expr;
}

/** Used by `simplify` and `canonical` to simplify some arithmetic
 * and trigonometric constants */

export function applyConstants(expr: Expression): Expression {
  if (isAtomic(expr)) return expr;

  let [numer, denom] = getRationalValue(expr);
  if (numer === 3 && denom === 4) return 'ThreeQuarter';
  if (numer === 2 && denom === 3) return 'TwoThird';
  if (numer === 1 && denom === 2) return 'Half';
  if (numer === 1 && denom === 4) return 'Quarter';

  // Trigonometric constants: -π, π/4, etc...
  [numer, denom] = getRationalSymbolicValue(expr, 'Pi');
  if (isNaN(numer) || isNaN(denom)) {
    return applyRecursively(expr, (x) => applyConstants(x));
  }
  if (numer === -2 && denom === 1) return 'MinusDoublePi';
  if (numer === -1 && denom === 2) return 'MinusHalfPi';
  if (numer === 1 && denom === 4) return 'QuarterPi';
  if (numer === 1 && denom === 3) return 'ThirdPi';
  if (numer === 1 && denom === 2) return 'HalfPi';
  if (numer === 2 && denom === 3) return 'TwoThirdPi';
  if (numer === 3 && denom === 4) return 'ThreeQuarterPi';
  if (numer === 2 && denom === 1) return 'DoublePi';
  if (numer === 1 && denom === 1) return 'Pi';
  if (numer === 1) return ['Divide', 'Pi', denom];
  if (denom === 1) return ['Multiply', numer, 'Pi'];
  return ['Multiply', ['Divide', numer, denom], 'Pi'];
}
