import { Expression } from '../../math-json/math-json-format';
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
  SUBTRACT,
  UNDEFINED,
} from '../../common/utils';
import type {
  ComputeEngine,
  Dictionary,
  Numeric,
} from '../../math-json/compute-engine-interface';
import { factorial, gamma, lngamma, SMALL_INTEGERS } from '../numeric';
import {
  DECIMAL_MINUS_ONE,
  DECIMAL_ONE,
  DECIMAL_ZERO,
  factorial as factorialDecimal,
  gamma as gammaDecimal,
  lngamma as lngammaDecimal,
  gcd as decimalGcd,
} from '../numeric-decimal';
import {
  isEqual,
  isInfinity,
  isNegative,
  isNotZero,
  isOne,
  isPositive,
  isZero,
} from '../predicates';
import { Decimal } from 'decimal.js';
import { Complex } from 'complex.js';
import { gamma as gammaComplex } from '../numeric-complex';
import { box } from '../../math-json/boxed/expression';

// @todo
// Re or RealPart
// Im or ImaginaryPart
// Arg or Argument
// Conjugate
// complex-cartesian (constructor)
// complex-polar

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
    value: (engine: ComputeEngine) => {
      if (engine.numericFormat === 'decimal') return Decimal.exp(1);
      if (engine.numericFormat === 'complex') return Complex.E;
      return 2.7182818284590452354;
    },
  },
  GoldenRatio: {
    domain: 'AlgebraicNumber',
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
    range: domainAdd,
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
      // Some arguments could not be evaluated to numbers or there's a mix
      // of Decimal and Complex:
      // still try to add the ones that are numeric, keep the others as is.

      if (args.length === 0) return 0;

      let result: Expression[] = ['Add'];
      const decimals = args.filter((x) => x instanceof Decimal);
      if (decimals.length > 0) {
        if (decimals.length === 1) {
          result.push(decimals[0]);
        } else {
          result.push(ce.N(['Add', ...decimals]));
        }
      }

      const complexes = args.filter((x) => x instanceof Complex);
      if (complexes.length > 0) {
        if (complexes.length === 1) {
          result.push(complexes[0]);
        } else {
          result.push(ce.N(['Add', ...complexes]));
        }
      }

      const numbers = args.filter((x) => typeof x === 'number');
      if (numbers.length > 0) {
        if (numbers.length === 1) {
          result.push(numbers[0]);
        } else {
          result.push(ce.N(['Add', ...numbers]));
        }
      }
      const others = args.filter(
        (x) =>
          typeof x !== 'number' &&
          !(x instanceof Decimal) &&
          !(x instanceof Complex)
      );

      result = [...result, ...others];

      if (result.length === 0) return 0;
      if (result.length === 1) return result[1];
      return result;
    },
  },
  Chop: {
    domain: 'Function',
    associative: true,
    threadable: true,
    idempotent: true,
    numeric: true,
    range: 'Number',
    evalNumber: (ce: ComputeEngine, val: number): number => ce.chop(val),
    evalComplex: (ce: ComputeEngine, n: Complex | number): Complex =>
      ce.chop(n),
    evalDecimal: (ce: ComputeEngine, n: Decimal | number): Decimal =>
      ce.chop(n),
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
    domain: 'Function',
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
    domain: 'Function',
    range: 'Number',
    numeric: true,
  },
  Erfc: {
    // Complementary Error Function
    domain: 'Function',
    range: 'Number',
    numeric: true,
  },
  Factorial: {
    wikidata: 'Q120976',
    domain: 'Function',
    range: domainFactorial,
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
      // Some arguments could not be evaluated to numbers or there's a mix
      // of Decimal and Complex:
      // still try to add the ones that are numeric, keep the others as is.

      if (args.length === 0) return 0;

      let result: Expression[] = ['Multiply'];
      const decimals = args.filter((x) => x instanceof Decimal);
      if (decimals.length > 0) {
        if (decimals.length === 1) {
          result.push(decimals[0]);
        } else {
          result.push(ce.N(['Multiply', ...decimals]));
        }
      }

      const complexes = args.filter((x) => x instanceof Complex);
      if (complexes.length > 0) {
        if (complexes.length === 1) {
          result.push(complexes[0]);
        } else {
          result.push(ce.N(['Multiply', ...complexes]));
        }
      }

      const numbers = args.filter((x) => typeof x === 'number');
      if (numbers.length > 0) {
        if (numbers.length === 1) {
          result.push(numbers[0]);
        } else {
          result.push(ce.N(['Multiply', ...numbers]));
        }
      }

      const others = args.filter(
        (x) =>
          typeof x !== 'number' &&
          !(x instanceof Decimal) &&
          !(x instanceof Complex)
      );

      result = [...result, ...others];

      if (result.length === 0) return 1;
      if (result.length === 1) return result[1];
      return result;
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
    // Defined as RealNumber for all power in RealNumber when base > 0;
    // when x < 0, only defined if n is an integer
    // if x is a non-zero complex, defined as ComplexNumber
    // evalDomain: (ce, base: Expression, power: Expression) ;
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
    wikidata: 'Q40754',
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

function domainFactorial(
  ce: ComputeEngine,
  arg: Expression<Numeric>
): Expression<Numeric> {
  if (ce.isInteger(arg) && ce.isPositive(arg)) return 'Integer';
  return 'Nothing';
}

function domainAdd(
  ce: ComputeEngine,
  ...args: Expression<Numeric>[]
): Expression<Numeric> | null {
  let dom: Expression<Numeric> | null = null;
  for (const arg of args) {
    const argDom = box(arg, ce).domain;
    if (ce.isSubsetOf(argDom, 'Number') === false) return 'Nothing';
    if (!ce.isSubsetOf(argDom, dom)) dom = argDom;
  }
  return dom;
}

function simplifyAdd(
  ce: ComputeEngine,
  ...args: Expression<Numeric>[]
): Expression<Numeric> {
  if (args.length === 0) return 0;
  if (args.length === 1) return args[0];

  // To avoid underflows (i.e. '1+1e199'), use Decimal for accumulated sum
  let numerTotal = DECIMAL_ZERO;
  let denomTotal = DECIMAL_ONE;
  let cTotal = Complex.ZERO;

  let posInfinity = false;
  let negInfinity = false;
  const others: Expression<Numeric>[] = [];

  for (const arg of args) {
    const symbol = getSymbolName(arg);
    if (symbol === MISSING || symbol === NOTHING || symbol === UNDEFINED)
      return NaN;
    if (symbol === COMPLEX_INFINITY) return COMPLEX_INFINITY;
    if (isInfinity(ce, arg)) {
      if (isPositive(ce, arg)) {
        posInfinity = true;
      } else {
        negInfinity = true;
      }
    }

    const dValue = getDecimalValue(arg);
    if (dValue !== null) {
      if (dValue.isInteger() && dValue.abs().lte(SMALL_INTEGERS)) {
        numerTotal = numerTotal.add(dValue.mul(denomTotal));
      } else {
        others.push(dValue);
      }
    } else {
      const c = getComplexValue(arg);
      if (c !== null) {
        if (
          Number.isInteger(c.re) &&
          Number.isInteger(c.im) &&
          Math.abs(c.re) <= SMALL_INTEGERS &&
          Math.abs(c.im) <= SMALL_INTEGERS
        ) {
          cTotal = cTotal.add(c);
        } else {
          others.push(arg);
        }
      } else {
        const [n, d] = getRationalValue(arg);
        if (
          n !== null &&
          d !== null &&
          Math.abs(n) <= SMALL_INTEGERS &&
          Math.abs(d) <= SMALL_INTEGERS
        ) {
          const nDecimal = new Decimal(n);
          const dDecimal = new Decimal(d);
          numerTotal = Decimal.add(
            numerTotal.mul(dDecimal),
            denomTotal.mul(nDecimal)
          );
          denomTotal = denomTotal.mul(dDecimal);
        } else {
          const val = getNumberValue(arg);
          if (
            val !== null &&
            Number.isInteger(val) &&
            Math.abs(val) < SMALL_INTEGERS
          ) {
            numerTotal = numerTotal.add(denomTotal.mul(val));
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

  if (!cTotal.isZero()) others.push(cTotal);

  const g = decimalGcd(numerTotal, denomTotal);
  numerTotal = numerTotal.div(g);
  denomTotal = denomTotal.div(g);

  if (!numerTotal.isZero()) {
    if (denomTotal.equals(DECIMAL_ONE)) {
      if (numerTotal.abs().lt(SMALL_INTEGERS))
        others.push(numerTotal.toNumber());
      else others.push(numerTotal);
    } else {
      if (
        numerTotal.abs().lt(SMALL_INTEGERS) &&
        denomTotal.abs().lt(SMALL_INTEGERS)
      )
        others.push(['Divide', numerTotal.toNumber(), denomTotal.toNumber()]);
      else others.push(['Divide', numerTotal, denomTotal]);
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
    if (val !== null) {
      if (
        !Number.isFinite(val) ||
        (Number.isInteger(val) && Math.abs(val) < SMALL_INTEGERS)
      )
        numer *= val;
      else others.push(arg);
    } else {
      const [n, d] = [null, null]; // getRationalValue(arg);

      if (
        n !== null &&
        d !== null &&
        Math.abs(d!) < SMALL_INTEGERS &&
        Math.abs(n!) < SMALL_INTEGERS
      ) {
        numer *= n!;
        denom *= d!;
      } else {
        const cVal = getComplexValue(arg);
        if (cVal !== null) {
          if (
            Number.isInteger(cVal.re) &&
            Number.isInteger(cVal.im) &&
            Math.abs(cVal.re) < SMALL_INTEGERS &&
            Math.abs(cVal.im) < SMALL_INTEGERS
          ) {
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
  if (numer === 0 || !Number.isFinite(numer)) return numer / denom;

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
  } else if (name === 'Delimiter' && argCount === 1) {
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
  if (getFunctionHead(expr) === 'Delimiter' && getArgCount(expr) === 1) {
    return ungroup(getArg(expr, 1));
  }
  return applyRecursively(expr, ungroup);
}

export function unstyle(expr: Expression | null): Expression {
  if (expr === null) return NOTHING;
  if (isAtomic(expr)) return expr;
  if (getFunctionHead(expr) === 'Style') return getArg(expr, 1) ?? NOTHING;
  return applyRecursively(expr, unstyle);
}

// Used by `simplify()` and `canonical()`
// See https://docs.sympy.org/1.6/modules/core.html#pow

export function applyPower(
  engine: ComputeEngine,
  expr: Expression
): Expression {
  expr = ungroup(expr);

  console.assert(getFunctionName(expr) === 'Power');

  if (getArgCount(expr) !== 2) return expr;

  const arg2 = getArg(expr, 2)!;
  if (getSymbolName(arg2) === 'ComplexInfinity') return NaN;
  if (isZero(engine, arg2)) return 1;

  const arg1 = getArg(expr, 1)!;

  if (isOne(engine, arg2)) return arg1;
  if (isEqual(engine, arg2, 2)) return ['Square', arg1];

  if (isEqual(engine, arg2, -1)) {
    if (isEqual(engine, arg1, -1) || isEqual(engine, arg1, 1)) return -1;
    if (engine.isInfinity(arg1)) return 0;
    return ['Divide', 1, arg1];
  }
  if (engine.isInfinity(arg2)) {
    if (engine.isZero(arg1) && engine.isNegative(arg1)) {
      return 'ComplexInfinity';
    }

    if (engine.isOne(arg1) || engine.isEqual(arg1, -1)) return NaN;

    if (engine.isInfinity(arg1)) {
      if (engine.isPositive(arg1)) {
        if (engine.isPositive(arg2)) return Infinity;
        return 0;
      }
      return NaN;
    }
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
