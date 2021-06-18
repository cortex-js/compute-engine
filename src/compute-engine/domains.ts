import {
  COMPLEX_INFINITY,
  DIVIDE,
  getArg,
  getFunctionHead,
  getFunctionName,
  getNumberValue,
  getRationalValue,
  getSymbolName,
  getTail,
  IMAGINARY_UNIT,
  isDictionaryObject,
  isStringObject,
  POWER,
} from '../common/utils';
import { Expression } from '../public';
import { ComputeEngine, FunctionDefinition } from './public';
import { gcd, LARGEST_SMALL_PRIME, SMALL_PRIMES } from './numeric';
import { Decimal } from 'decimal.js';
import { Complex } from 'complex.js';
import { DECIMAL_E, DECIMAL_PI } from './numeric-decimal';

export function internalDomain(
  engine: ComputeEngine,
  expr: Expression
): Expression | null {
  //
  // 1. Is it a numeric domain (number, Decimal, Complex)?
  //
  const result = inferNumericDomain(expr);
  if (result !== null) return result;

  //
  // 2. Is it a symbol?
  // (Note, we've already handled well-known symbols in `inferNumericDomain()`
  //
  const symName = getSymbolName(expr);
  if (symName !== null) {
    // 2.1 Do we have an Element assumption about this symbol
    const domains = engine.ask(['Element', expr, '_domain']);
    if (domains.length > 0) {
      // @todo: we could handle more complex assumptions, i.e. conjunctions, etc...
      if (domains.length === 1) {
        return domains[0]['domain'];
      }
      // @todo Could query the negative and return:
      //      return ['SetMinus', domain.getArg(domain, 2)];

      return 'Anything';
    }
    // 2.2 Do we have an equality assumption about this symbol?
    // @todo: we could do more:
    // - search for ['Equal', x, '_expr'] and get the domain of expr

    // 2.3 Do we have an inequality assumption about this model?
    // - search for ['Less', x '_expr'], etc... => implies RealNumber

    // 2.4 Does the symbol definition have a domain?
    // (we look for 'Definition' in general, because Domains do not have a
    // SymbolDefinition (they don't necessarily have a value).
    const def = engine.getDefinition(symName);
    if (def && typeof def.domain === 'function') {
      return def.domain(expr) ?? 'Anything';
    } else if (def && def.domain) {
      return def.domain as Expression;
    } else if (def && 'value' in def && def.value) {
      return internalDomain(engine, def.value);
    }
    return 'Anything';
  }

  //
  // 3. Is it a function?
  //

  const head = getFunctionHead(expr);
  if (typeof head === 'string') {
    const def: FunctionDefinition | null = engine.getFunctionDefinition(head);
    if (def) {
      if (typeof def.range === 'function') {
        return def.range(engine, ...getTail(expr));
      } else if (def.range !== undefined) {
        return def.range;
      } else if (def.value !== undefined) {
        return internalDomain(engine, def.value);
      }
    }
  }

  //
  // 4. It's something else: a String or a Dictionary
  //
  if (isStringObject(expr)) return 'String';
  if (isDictionaryObject(expr)) return 'Dictionary';

  return null;
}

// export function isSubdomainOf(
//   dict: Dictionary,
//   lhs: Domain,
//   rhs: Domain
// ): boolean {
//   if (lhs === rhs) return true;
//   if (typeof lhs !== 'string') return false;
//   const def = dict[lhs];
//   if (!isSetDefinition(def)) return false;

//   for (const parent of def.supersets) {
//     if (isSubdomainOf(dict, parent, rhs)) return true;
//   }

//   return false;
// }

export function inferNumericDomain(
  value: Expression | undefined
): Expression | null {
  if (value === undefined) return null;

  //
  // 1. Is it a number?
  //
  const numVal = getNumberValue(value);
  if (numVal !== null && !isNaN(numVal)) {
    if (numVal === 0) return 'NumberZero';
    if (!isFinite(numVal)) return 'SignedInfinity';

    if (Number.isInteger(numVal)) {
      if (SMALL_PRIMES.has(numVal)) return 'PrimeNumber';
      if (numVal >= 1 && numVal < LARGEST_SMALL_PRIME) return 'CompositeNumber';
      if (numVal > 0) return 'NaturalNumber';
      return 'Integer';
    }

    if (numVal > 0) return ['Interval', ['Open', 0], +Infinity];

    return 'RealNumber';
  }

  //
  // 2 Is it a decimal?
  //
  if (value instanceof Decimal) {
    if (value.isNaN()) return 'Number';
    if (value.isZero()) return 'NumberZero';
    if (!value.isFinite()) return 'SignedInfinity';
    if (value.isInteger()) {
      if (value.abs().lessThan(Number.MAX_SAFE_INTEGER)) {
        return inferNumericDomain(value.toNumber());
      }
      if (value.isPositive()) return 'NaturalNumber';
      return 'Integer';
    }
    if (value === DECIMAL_PI || value === DECIMAL_E) {
      return 'TranscendentalNumber';
    }
    if (value.isPositive()) return ['Interval', ['Open', 0], +Infinity];
    return 'RealNumber';
  }

  //
  // 3 Is it a complex number?
  //
  if (value instanceof Complex) {
    const c = value as Complex;
    if (c.im === 0) return inferNumericDomain(c.re);
    if (c.re === 0 && c.im !== 0) return 'ImaginaryNumber';
    return 'ComplexNumber';
  }
  if (getFunctionName(value) === 'Complex') {
    const re = getNumberValue(getArg(value, 1)) ?? NaN;
    const im = getNumberValue(getArg(value, 2)) ?? NaN;
    if (im === 0) return inferNumericDomain(re);
    if (re === 0 && im !== 0) return 'ImaginaryNumber';
    return 'ComplexNumber';
  }

  //
  // 4. Is it a rational?
  //

  let [numer, denom] = getRationalValue(value);

  if (numer !== null && denom !== null) {
    const g = gcd(numer, denom);
    numer = numer / g;
    denom = denom / g;
    if (!Number.isNaN(numer) && !Number.isNaN(denom)) {
      if (numer === 0) return 'NumberZero';

      // The value is a rational number
      if (denom !== 1 && denom !== -1) return 'RationalNumber';

      return inferNumericDomain(numer);
    }
  }

  //
  // 5. Symbol
  //
  const symbol = getSymbolName(value);
  if (symbol !== null) {
    if (symbol === 'NaN') return 'Number';
    if (symbol === '+Infinity' || symbol === '-Infinity') {
      return 'SignedInfinity';
    }
    if (symbol === COMPLEX_INFINITY) return 'ComplexInfinity';
    if (symbol === IMAGINARY_UNIT) return 'ImaginaryNumber';
    if (
      ['Quarter', 'Third', 'Half', 'TwoThird', 'ThreeQuarter'].includes(symbol)
    ) {
      return 'RationalNumber';
    }
    if (
      [
        'MinusDoublePi',
        'MinusPi',
        'QuarterPi',
        'ThirdPi',
        'HalfPi',
        'TwoThirdPi',
        'ThreeQuarterPi',
        'Pi',
        'DoublePi',
        'ExponentialE',
      ].includes(symbol)
    ) {
      return 'TranscendentalNumber';
    }
    if (
      [
        'MachineEpsilon',
        'CatalanConstant',
        'GoldenRatio',
        'EulerGamma',
      ].includes(symbol)
    ) {
      return 'RealNumber';
    }
  }

  //
  // 6. Function
  // Note: most of the checking should be done in the function definitions.
  //

  const head = getFunctionName(value);
  if (head === POWER) {
    if (getFunctionName(getArg(value, 2)) === DIVIDE) {
      if (
        getArg(getArg(value, 2), 1) === 1 &&
        getArg(getArg(value, 2), 2) === 2
      ) {
        // It's a square root...
        const num = getNumberValue(getArg(value, 1));
        if (num !== null && SMALL_PRIMES.has(num)) {
          // Square root of a prime is irrational
          // https://proofwiki.org/wiki/Square_Root_of_Prime_is_Irrational
          return 'IrrationalNumber';
        }
      }
    }
  }
  // @todo: the log in a prime base of a prime number is irrational

  return 'RealNumber';
}
