import { Expression } from '../../public';
import {
  ADD,
  applyRecursively,
  COMPLEX_INFINITY,
  DIVIDE,
  getArg,
  getArgCount,
  getComplexValue,
  getDecimalValue,
  getFunctionHead,
  getFunctionName,
  getNumberValue,
  getRationalSymbolicValue,
  getRationalValue,
  getSymbolName,
  getTail,
  isAtomic,
  isNumberObject,
  mapArgs,
  MISSING,
  MULTIPLY,
  NEGATE,
  NOTHING,
  PARENTHESES,
  SUBTRACT,
} from '../../common/utils';
import type { ComputeEngine, Dictionary, Numeric } from '../public';
import { chop, factorial, gamma, lngamma, gcd } from '../numeric';
import {
  DECIMAL_MINUS_ONE,
  DECIMAL_ONE,
  DECIMAL_ZERO,
  factorial as factorialDecimal,
  gamma as gammaDecimal,
  lngamma as lngammaDecimal,
} from '../numeric-decimal';
import {
  isInfinity,
  isNegative,
  isNotZero,
  isPositive,
  isZero,
} from '../predicates';
import { Decimal } from 'decimal.js';
import { Complex } from 'complex.js';
import { gamma as gammaComplex } from '../numeric-complex';

export const ARITHMETIC_DICTIONARY: Dictionary<Numeric> = {
  //
  // Constants
  //
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

  ImaginaryUnit: {
    domain: 'ImaginaryNumber',
    constant: true,
    wikidata: 'Q193796',
  },
  ExponentialE: {
    domain: 'TranscendentalNumber',
    wikidata: 'Q82435',
    constant: true,
    value: { num: '2.7182818284590452354' },
  },
  GoldenRatio: {
    domain: 'IrrationalNumber',
    wikidata: 'Q41690',
    constant: true,
    hold: false,
    value: ['Divide', ['Add', 1, ['Sqrt', 5]], 2],
  },
  CatalanConstant: {
    domain: 'RealNumber', // Not proven irrational or transcendental
    wikidata: 'Q855282',
    constant: true,
    value: { num: '0.91596559417721901505' },
  },
  EulerGamma: {
    domain: 'RealNumber', // Not proven irrational
    wikidata: 'Q273023',
    constant: true,
    value: { num: '0.577215664901532860606' },
  },
  Quarter: {
    domain: 'RationalNumber',
    wikidata: 'Q2310416',
    constant: true,
    hold: false,
    value: [DIVIDE, 3, 4],
  },
  Third: {
    domain: 'RationalNumber',
    wikidata: 'Q20021125',
    constant: true,
    hold: false,
    value: [DIVIDE, 1, 3],
  },
  Half: {
    domain: 'RationalNumber',
    wikidata: 'Q2114394',
    constant: true,
    hold: false,
    value: [DIVIDE, 1, 2],
  },
  TwoThird: {
    domain: 'RationalNumber',
    constant: true,
    hold: false,
    value: [DIVIDE, 2, 3],
  },
  ThreeQuarter: {
    domain: 'RationalNumber',
    constant: true,
    hold: false,
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
    numeric: true,
    range: ['Interval', 0, Infinity],
    evalNumber: (_ce, val: number): number => Math.abs(val),
    evalComplex: (_ce, n: Complex | number): Complex => Complex.abs(n),
    evalDecimal: (_ce, n: Decimal | number): Decimal => Decimal.abs(n),
  },
  Add: {
    domain: 'Function',
    wikidata: 'Q32043',
    associative: true,
    commutative: true,
    threadable: true,
    idempotent: true,
    range: 'Number',
    numeric: true,
    simplify: simplifyAdd,
    evalNumber: (_ce: ComputeEngine, ...args: number[]): number => {
      if (args.length === 0) return 0;

      let c = 0;
      for (const arg of args) c += arg;
      return c;
    },
    evalComplex: (
      _ce: ComputeEngine,
      ...args: (Complex | number)[]
    ): Complex => {
      if (args.length === 0) return Complex.ZERO;

      let c = Complex.ZERO;
      for (const arg of args) c = c.add(arg);
      return c;
    },
    evalDecimal: (
      _ce: ComputeEngine,
      ...args: (number | Decimal)[]
    ): Decimal => {
      if (args.length === 0) return DECIMAL_ZERO;

      let c = DECIMAL_ZERO;
      for (const arg of args) c = c.add(arg);
      return c;
    },
    evaluate: (
      ce: ComputeEngine,
      ...args: Expression[]
    ): Expression<Numeric> => {
      // Some arguments could not be evaluated to numbers:
      // still try to add the ones that are numeric, keep the others as is.
      if (args.length === 0) return 0;
      const numerics: (number | Decimal | Complex)[] = [];
      const others: Expression[] = [];
      for (const arg of args) {
        if (
          typeof arg === 'number' ||
          arg instanceof Decimal ||
          arg instanceof Complex ||
          isNumberObject(arg)
        ) {
          numerics.push(arg);
        } else {
          others.push(arg);
        }
      }
      if (numerics.length === 0) return ['Add', ...others];
      const val =
        numerics.length === 1 ? numerics[0] : ce.N(['Add', ...numerics]);
      if (others.length === 0) return val;
      return ['Add', ...others, val];
    },
  },
  Chop: {
    domain: 'Function',
    associative: true,
    threadable: true,
    idempotent: true,
    numeric: true,
    range: 'Number',
    evalNumber: (_ce, val: number): number => chop(val),
  },
  Ceil: {
    domain: 'Function',
    range: 'Number',
    numeric: true,
    /** rounds a number up to the next largest integer */
    evalNumber: (_ce, val: number): number => Math.ceil(val),
    evalComplex: (_ce, n: Complex | number): Complex => Complex.ceil(n),
    evalDecimal: (_ce, n: Decimal | number): Decimal => Decimal.ceil(n),
  },
  Divide: {
    domain: 'Function',
    range: 'Number',
    numeric: true,
    evalNumber: (_ce, lhs: number, rhs: number): number => lhs / rhs,
    evalComplex: (_ce, lhs: Complex | number, rhs: Complex | number): Complex =>
      typeof lhs === 'number' ? new Complex(lhs).div(rhs) : lhs.div(rhs),
    evalDecimal: (_ce, lhs: Decimal | number, rhs: Decimal | number): Decimal =>
      Decimal.div(lhs, rhs),
  },
  Exp: {
    domain: ['ContinuousFunction', 'MonotonicFunction'],
    wikidata: 'Q168698',
    threadable: true,
    range: 'Number',
    numeric: true,
    evalNumber: (_ce, val: number): number => Math.exp(val),
    evalComplex: (_ce, val: Complex | number): Complex =>
      typeof val === 'number' ? new Complex(val).exp() : val.exp(),
    evalDecimal: (_ce, val: Decimal | number): Decimal => Decimal.exp(val),
  },
  Erf: {
    // Error function
    domain: ['ContinuousFunction', 'MonotonicFunction'],
    range: 'Number',
    numeric: true,
  },
  Erfc: {
    // Complementary Error Function
    domain: ['ContinuousFunction', 'MonotonicFunction'],
    range: 'Number',
    numeric: true,
  },
  Factorial: {
    wikidata: 'Q120976',
    domain: 'MonotonicFunction',
    range: 'Integer',
    numeric: true,
    evalNumber: (_ce, n: number): number => factorial(n),
    evalComplex: (_ce, c: Complex | number): Complex =>
      typeof c === 'number'
        ? gammaComplex(new Complex(c + 1))
        : gammaComplex(c.add(1)),
    evalDecimal: (_ce, d: Decimal | number): Decimal => factorialDecimal(d),
  },
  Floor: {
    domain: 'Function',
    wikidata: 'Q56860783',
    range: 'Number',
    numeric: true,
    evalNumber: (_ce, x: number): number => Math.floor(x),
    evalDecimal: (_ce, x: Decimal | number): Decimal => Decimal.floor(x),
  },
  Gamma: {
    domain: 'Function',
    wikidata: 'Q190573',
    range: 'Number',
    numeric: true,
    evalNumber: (_ce, n: number): number => gamma(n),
    // evalComplex: (_ce, c: Complex): Complex => gammaComplex(c),
    evalDecimal: (_ce, d: Decimal | number): Decimal => gammaDecimal(d),
  },
  LogGamma: {
    domain: 'Function',
    range: 'Number',
    numeric: true,
    evalNumber: (_ce, n: number): number => lngamma(n),
    // evalComplex: (_ce, c: Complex): Complex => lngammaComplex(c),
    evalDecimal: (_ce, d: Decimal | number): Decimal => lngammaDecimal(d),
  },
  Ln: {
    domain: 'Function',
    wikidata: 'Q11197',
    range: 'Number',
    numeric: true,
    evalNumber: (_ce, x: number): number => Math.log(x),
    evalComplex: (_ce, c: Complex | number): Complex =>
      typeof c === 'number' ? new Complex(c).log() : c.log(),
    evalDecimal: (_ce, x: Decimal | number): Decimal => Decimal.log(x),
  },
  Log: {
    domain: 'Function',
    range: 'Number',
    numeric: true,
    evalNumber: (_ce, base: number, x: number): number =>
      Math.log(x) / Math.log(base),
    evalComplex: (
      _ce,
      base: Complex | number,
      x: Complex | number
    ): Complex => {
      const cBase = typeof base === 'number' ? new Complex(base) : base;
      const cX = typeof x === 'number' ? new Complex(x) : x;
      return cX.log().div(cBase.log());
    },
    evalDecimal: (_ce, base: Decimal | number, x: Decimal | number): Decimal =>
      Decimal.log(x).div(Decimal.log(base)),
  },
  Lb: {
    domain: 'Function',
    wikidata: 'Q581168',
    range: 'Number',
    numeric: true,
    evalNumber: (_ce, x: number): number => Math.log2(x),
    evalComplex: (_ce, base: Complex, x: Complex): Complex => {
      const cX = typeof x === 'number' ? new Complex(x) : x;
      return cX.log().div(Complex.log(2));
    },
    evalDecimal: (_ce, x: Decimal): Decimal =>
      Decimal.log(x).div(Decimal.log(2)),
  },
  Lg: {
    domain: 'Function',
    wikidata: 'Q966582',
    range: 'Number',
    numeric: true,
    evalNumber: (_ce, x: number): number => Math.log10(x),
    evalComplex: (_ce, base: Complex, x: Complex): Complex => {
      const cX = typeof x === 'number' ? new Complex(x) : x;
      return cX.log().div(Complex.log(10));
    },
    evalDecimal: (_ce, x: Decimal): Decimal =>
      Decimal.log(x).div(Decimal.log(10)),
  },
  // LogOnePlus: { domain: 'Function' },
  Multiply: {
    domain: 'Function',
    wikidata: 'Q40276',
    associative: true,
    commutative: true,
    idempotent: true,
    range: 'Number',
    simplify: simplifyMultiply,
    numeric: true,
    evalNumber: evalNumberMultiply,
    evalComplex: (
      _ce: ComputeEngine,
      ...args: (number | Complex)[]
    ): Decimal => {
      if (args.length === 0) return Complex.ONE;

      let c = Complex.ONE;
      for (const arg of args) c = c.mul(arg);
      return c;
    },
    evalDecimal: (
      _ce: ComputeEngine,
      ...args: (number | Decimal)[]
    ): Decimal => {
      if (args.length === 0) return DECIMAL_ONE;

      let c = DECIMAL_ONE;
      for (const arg of args) c = c.mul(arg);
      return c;
    },
    evaluate: (
      ce: ComputeEngine,
      ...args: Expression[]
    ): Expression<Numeric> => {
      // Some arguments could not be evaluated to numbers:
      // still try to multiply the ones that are numeric, keep the others as is.
      if (args.length === 0) return 0;
      const numerics: (number | Decimal | Complex)[] = [];
      const others: Expression[] = [];
      for (const arg of args) {
        if (
          typeof arg === 'number' ||
          arg instanceof Decimal ||
          arg instanceof Complex ||
          isNumberObject(arg)
        ) {
          numerics.push(arg);
        } else {
          others.push(arg);
        }
      }
      if (numerics.length === 0) return ['Multiply', ...others];
      const val = ce.N(['Multiply', ...numerics]);
      if (others.length === 0) val;
      return ['Multiply', val, ...others];
    },
  },
  Negate: {
    domain: 'Function',
    wikidata: 'Q715358',
    range: 'Number',
    simplify: (_ce: ComputeEngine, x: Expression): Expression =>
      applyNegate(x) ?? ['Negate', x],
    numeric: true,
    evalNumber: (_ce, val: number) => -val,
    evalComplex: (_ce, x: Complex | number): Complex =>
      typeof x === 'number' ? new Complex(-x) : x.neg(),
    evalDecimal: (_ce, x: Decimal | number): Decimal =>
      typeof x === 'number' ? new Decimal(-x) : x.neg(),
  },
  Power: {
    domain: 'Function',
    wikidata: 'Q33456',
    commutative: false,
    numeric: true,
    range: 'Number',
    simplify: (ce: ComputeEngine, ...args: Expression[]): Expression =>
      applyPower(ce, ['Power', ...args]),
    evalNumber: (_ce, base: number, power: number) => Math.pow(base, power),
    evalComplex: (_ce, base: Complex | number, power: Complex | number) => {
      const cBase = typeof base === 'number' ? new Complex(base) : base;
      const cPower = typeof power === 'number' ? new Complex(power) : power;
      return Complex.pow(cBase, cPower);
    },
    evalDecimal: (
      _ce,
      base: Decimal | number,
      power: Decimal | number
    ): Decimal => Decimal.pow(base, power),
  },
  Round: {
    domain: 'Function',
    range: 'Number',
    numeric: true,
    evalNumber: (_ce, val: number) => Math.round(val),
    evalComplex: (_ce, val: Complex | number): Complex =>
      typeof val === 'number' ? new Complex(val).round() : val.round(),
    evalDecimal: (_ce, val: Decimal | number): Decimal => Decimal.round(val),
  },
  Sign: {
    domain: 'Function',
    range: ['Range', -1, 1],
    numeric: true,
    simplify: (ce: ComputeEngine, x: Expression): Expression =>
      isZero(ce, x) ? 0 : isNegative(ce, x) ? -1 : 1,
    evalNumber: (_ce, val: number) => (val === 0 ? 0 : val < 0 ? -1 : 1),
    evalComplex: (_ce, z: Complex | number): Complex => {
      const cZ = typeof z === 'number' ? new Complex(z) : z;
      return cZ.div(cZ.abs());
    },
    evalDecimal: (_ce, val: Decimal | number) => {
      if (typeof val === 'number') {
        return val === 0
          ? DECIMAL_ZERO
          : val < 0
          ? DECIMAL_MINUS_ONE
          : DECIMAL_ONE;
      }
      return val.isZero()
        ? DECIMAL_ZERO
        : val.isNeg()
        ? DECIMAL_MINUS_ONE
        : DECIMAL_ONE;
    },
  },
  SignGamma: {
    domain: 'Function',
    range: 'Number',
    numeric: true,
    /** The sign of the gamma function: -1 or +1 */
  },
  Sqrt: {
    domain: 'Function',
    wikidata: 'Q134237',
    range: 'Number',
    numeric: true,
    evalNumber: (_ce, val: number) => Math.sqrt(val),
    evalComplex: (_ce, z: Complex | number): Complex =>
      typeof z === 'number' ? new Complex(z).sqrt() : z.sqrt(),
    evalDecimal: (_ce, val: Decimal): Decimal => Decimal.sqrt(val),
  },
  Square: {
    domain: 'Function',
    wikidata: 'Q3075175',
    range: 'Number',
    numeric: true,
    evalNumber: (_ce, val: number) => val * val,
    evalComplex: (_ce, z: Complex | number): Complex =>
      typeof z === 'number' ? new Complex(z).multiply(z) : z.mul(z),
    evalDecimal: (_ce, val: Decimal): Decimal => Decimal.mul(val, val),
  },
  Root: {
    domain: 'Function',
    commutative: false,
    range: 'Number',
    numeric: true,
    evalNumber: (_ce, base: number, power: number) => Math.pow(base, 1 / power),
    evalComplex: (_ce, base: Complex, power: Complex): Complex => {
      const cBase = typeof base === 'number' ? new Complex(base) : base;
      const cPower =
        typeof power === 'number'
          ? new Complex(1 / power)
          : new Complex(Complex.ONE.div(power));
      return Complex.pow(cBase, cPower);
    },
    evalDecimal: (_ce, base: Decimal, power: Decimal): Decimal =>
      Decimal.pow(base, DECIMAL_ONE.div(power)),
  },
  Subtract: {
    domain: 'Function',
    wikidata: 'Q32043',
    range: 'Number',
    numeric: true,
    evalNumber: (_ce, lhs: number, rhs: number) => lhs - rhs,
    evalComplex: (_ce, lhs: Complex | number, rhs: Complex | number): Complex =>
      typeof lhs === 'number' ? new Complex(lhs).sub(rhs) : lhs.sub(rhs),
    evalDecimal: (_ce, lhs: Decimal | number, rhs: Decimal | number): Decimal =>
      Decimal.sub(lhs, rhs),
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

function simplifyAdd(
  ce: ComputeEngine,
  ...args: Expression<Numeric>[]
): Expression<Numeric> {
  if (args.length === 0) return 0;
  if (args.length === 1) return args[0];

  let numerTotal = 0;
  let denomTotal = 1;
  let dTotal = DECIMAL_ZERO;
  let cTotal = Complex.ZERO;

  let posInfinity = false;
  let negInfinity = false;
  const others: Expression<Numeric>[] = [];

  for (const arg of args) {
    const symbol = getSymbolName(arg);
    if (symbol === MISSING || symbol === NOTHING) return NaN;
    if (symbol === COMPLEX_INFINITY) return COMPLEX_INFINITY;
    if (isInfinity(ce, arg)) {
      if (isPositive(ce, arg)) {
        posInfinity = true;
      } else {
        negInfinity = true;
      }
    }
    const [n, d] = getRationalValue(arg);
    if (n !== null && d !== null) {
      if (isNaN(n) || isNaN(d)) return NaN;
      numerTotal = numerTotal * d + n * denomTotal;
      denomTotal = denomTotal * d;
    } else {
      const c = getComplexValue(arg);
      if (c !== null) {
        if (Number.isInteger(c.re) && Number.isInteger(c.im)) {
          cTotal = cTotal.add(c);
        } else {
          others.push(arg);
        }
      } else {
        const d = getDecimalValue(arg);
        if (d !== null && d.isInteger()) {
          dTotal = dTotal.add(d);
        } else {
          const val = getNumberValue(arg);
          if (val !== null && Number.isInteger(val)) {
            numerTotal += val;
          } else if (isNotZero(ce, arg) !== false) {
            others.push(arg);
          }
        }
      }
    }
  }

  if (posInfinity && negInfinity) return NaN;
  if (posInfinity) return Infinity;
  if (negInfinity) return -Infinity;

  // Group similar terms
  // @todo
  // const terms: { [term: string]: number } = {};
  // for (const [term, coeff] of forEachTermCoeff(others)) {
  // }

  if (!dTotal.isZero()) others.push(dTotal);
  if (!cTotal.isZero()) others.push(cTotal);

  if (others.length === 0) {
    if (numerTotal === 0) return 0;
    if (denomTotal === 1) return numerTotal;
    return ['Divide', numerTotal, denomTotal];
  }
  if (numerTotal !== 0) {
    const g = gcd(numerTotal, denomTotal);
    numerTotal = numerTotal / g;
    denomTotal = denomTotal / g;
    if (denomTotal === 1) {
      others.push(numerTotal);
    } else {
      others.push(['Divide', numerTotal, denomTotal]);
    }
  }
  if (others.length === 1) return others[0];
  if (others.length === 2 && getFunctionName(others[1]) === NEGATE) {
    // a + (-b) -> a - b
    return ['Subtract', others[0], getArg(others[1], 1) ?? MISSING];
  } else if (others.length === 2 && getFunctionName(others[0]) === NEGATE) {
    // (-a) + b -> b - a
    return ['Subtract', others[1], getArg(others[0], 1) ?? MISSING];
  }
  return ['Add', ...others];
}

function simplifyMultiply(
  ce: ComputeEngine,
  ...args: Expression[]
): Expression {
  if (args.length === 0) return 1;
  if (args.length === 1) return args[0];

  const others: Expression[] = [];
  let numer = 1;
  let denom = 1;
  let c = Complex.ONE;

  for (const arg of args) {
    const val = getNumberValue(arg);
    if (val === 0) return 0;
    if (val !== null && (!Number.isFinite(val) || Number.isInteger(val))) {
      numer *= val;
    } else {
      const [n, d] = [null, null]; // getRationalValue(arg);

      if (n !== null && d !== null) {
        numer *= n!;
        denom *= d!;
      } else {
        const cVal = getComplexValue(arg);
        if (cVal !== null) {
          if (Number.isInteger(cVal.re) && Number.isInteger(cVal.im)) {
            c = c.mul(cVal);
          } else {
            others.push(arg);
          }
        } else {
          // @todo: consider distributing if the head of arg is Add or Negate or Subtract or Divide
          if (isZero(ce, arg)) return 0;
          others.push(arg);
        }
      }
    }
  }

  if (c.im !== 0) {
    c = c.mul(numer);
    numer = 1;
  } else {
    numer = numer * c.re;
    c = Complex.ONE;
  }

  // Divide numer by denom to get the proper signed infinite or NaN
  if (numer === 0 || !isFinite(numer)) return numer / denom;

  if (!c.equals(Complex.ONE)) {
    others.push(['Complex', c.re, c.im]);
  }
  if (others.length === 0) {
    if (denom === 1) return numer;
    return ['Divide', numer, denom];
  }
  if (denom !== 1) {
    others.unshift(['Divide', numer, denom]);
    numer = 1;
    denom = 1;
  }
  if (others.length === 1 && numer === 1) return others[0];
  if (others.length === 1 && numer === -1) return ['Negate', others[0]];
  if (numer === 1) return ['Multiply', ...others];
  if (numer === -1) return ['Negate', ['Multiply', ...others]];
  return ['Multiply', numer, ...others];
}

/** Apply some simplifications for `Negate`.
 *  Used by `canonical-negate` and `simplify`
 */
export function applyNegate(expr: Expression): Expression {
  expr = ungroup(expr);
  if (typeof expr === 'number') {
    // Applying negation is safe on floating point numbers
    return -expr;
  }
  if (expr && isNumberObject(expr)) {
    if (expr.num[0] === '-') {
      return { num: expr.num.slice(1) };
    } else if (expr.num[0] === '+') {
      return { num: '-' + expr.num.slice(1) };
    } else {
      return { num: '-' + expr.num };
    }
  }
  if (expr instanceof Decimal) {
    const d = expr as Decimal;
    return d.mul(-1) as unknown as Expression;
  }
  if (expr instanceof Complex) {
    const c = expr as Complex;
    return c.mul(-1);
  }
  const name = getFunctionName(expr);
  const argCount = getArgCount(expr!);
  if (name === NEGATE && argCount === 1) {
    // [NEGATE, [NEGATE, x]] -> x
    return getArg(expr, 1) ?? MISSING;
  } else if (name === MULTIPLY) {
    const arg = applyNegate(getArg(expr, 1) ?? MISSING);
    return [MULTIPLY, arg, ...getTail(expr).slice(1)];
  } else if (name === ADD) {
    return [ADD, ...mapArgs<Expression>(expr, applyNegate)];
  } else if (name === SUBTRACT) {
    return [SUBTRACT, getArg(expr, 2) ?? MISSING, getArg(expr, 1) ?? MISSING];
  } else if (name === PARENTHESES && argCount === 1) {
    return applyNegate(getArg(getArg(expr, 1)!, 1)!);
  }

  return [NEGATE, expr ?? MISSING];
}

// The function is `numeric` so it will be passed numbers
function evalNumberMultiply(_ce: ComputeEngine, ...args: number[]): number {
  if (args.length === 0) return 1;
  if (args.length === 1) return args[0];

  let c = 1;
  for (const arg of args) c *= arg;
  return c;
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

export function applyPower(
  engine: ComputeEngine,
  expr: Expression
): Expression {
  // @todo: using engine predicates (isEqual(x, 1)...)
  expr = ungroup(expr);

  console.assert(getFunctionName(expr) === 'Power');

  if (getArgCount(expr) !== 2) return expr;

  const arg1 = getArg(expr, 1)!;
  const val1 = getNumberValue(arg1) ?? NaN;
  const arg2 = getArg(expr, 2)!;

  if (getSymbolName(arg2) === 'ComplexInfinity') return NaN;

  const val2 = getNumberValue(arg2) ?? NaN;

  if (isZero(engine, arg2)) return 1;
  if (val2 === 1) return arg1;
  if (val2 === 2) return ['Square', arg1];

  if (val2 === -1) {
    if (val1 === -1 || val1 === 1) return -1;
    if (!Number.isFinite(val1)) return 0;
    return ['Divide', 1, arg1];
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
  if (numer === null || denom === null) {
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

// function* forEachTermCoeff(
//   terms: Expression[]
// ): Generator<[term: Expression, coef: number]> {
//   return;
// }
