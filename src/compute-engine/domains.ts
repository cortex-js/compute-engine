import {
  COMPLEX_INFINITY,
  DIVIDE,
  getArg,
  getFunctionHead,
  getFunctionName,
  getNumberValue,
  getRationalValue,
  getSymbolName,
  IMAGINARY_UNIT,
  isDictionaryObject,
  isStringObject,
  POWER,
} from '../common/utils';
import { Expression } from '../math-json/math-json-format';
import {
  ComputeEngine,
  Domain,
  NumericDomain,
} from '../math-json/compute-engine-interface';
import { gcd, SMALL_PRIMES } from './numeric';
import { Decimal } from 'decimal.js';
import { Complex } from 'complex.js';
import { getDomains } from './utils';

/** Calculate the domain of an expression */
export function internalDomain(
  ce: ComputeEngine,
  expr: Expression
): Domain | null {
  //
  // 1. Is the expression a number or a well-known numeric constant?
  //
  const result = inferNumericDomain(expr);
  if (result !== null) return result;

  //
  // 2. Is it a symbol?
  //
  // Note: we've already handled some well-known symbols in
  // `inferNumericDomain()`. This is the regular code path which will look
  // up symbols in the dictionaries.
  //
  const symbol = getSymbolName(expr);
  if (symbol !== null) {
    // 2.1 Do we have an Element assumption about this symbol
    const domains = ce.ask(['Element', expr, '_domain']);
    if (domains.length > 0) {
      // There should be a single `Element` assumption...
      console.assert(domains.length === 1);
      return domains[0]['domain'];
    }
    // @todo Could query the negative and return:
    //      return ['Complement', domain.getArg(domain, 2)];

    // 2.2 Do we have an equality assumption about this symbol?
    // @todo: we could do more:
    // - search for ['Equal', x, '_expr'] and get the domain of expr

    // 2.3 Do we have an inequality assumption about this model?
    // @todo
    // - search for ['Less', x '_expr'], etc... => implies RealNumber
    // @todo! alternative: when calling assume('x > 0'), assume could add
    // an assumption that assume(x, 'RealNumber')

    // 2.4 Does the symbol definition have a domain?
    // (we look for 'Definition' in general, because Domains do not have a
    // SymbolDefinition (they don't necessarily have a value).
    const def = ce.getDefinition(symbol);
    if (def) {
      if (def.domain) return def.domain;

      if ('value' in def && def.value) {
        return internalDomain(
          ce,
          typeof def.value === 'function' ? def.value(ce) : def.value
        );
      }
    }
    return 'Anything';
  }

  //
  // 3. Is it a function?
  //

  const head = getFunctionHead(expr);
  if (typeof head === 'string') {
    const def = ce.getFunctionDefinition(head);
    if (def) {
      if (typeof def.evalDomain === 'function') {
        return def.evalDomain(ce, ...getDomains(ce, expr)!);
      }
      if (def.numeric) return 'Number';
      if (def.value !== undefined) return internalDomain(ce, def.value);
    }
  }

  //
  // 4. It's something else: a String or a Dictionary
  //
  if (isStringObject(expr)) return 'String';
  if (isDictionaryObject(expr)) return 'Dictionary';

  return null;
}

/** Quickly determine the numeric domain of a number or constant
 * For the symbols, this is a hard-coded optimization that doesn't rely on the
 * dictionaries. The regulat path is in `internalDomain()`
 */
export function inferNumericDomain(
  value: Expression | undefined
): NumericDomain | null {
  if (value === undefined) return null;

  //
  // 1. Is it a number?
  //
  const numVal = getNumberValue(value);
  if (numVal !== null && !isNaN(numVal)) {
    if (!isFinite(numVal)) return 'ExtendedRealNumber';

    if (numVal === 0) return 'NonNegativeInteger'; // Bias: Could be NonPositiveInteger

    if (Number.isInteger(numVal)) {
      if (numVal > 0) return 'PositiveInteger';
      if (numVal < 0) return 'NegativeInteger';
      return 'Integer';
    }

    if (numVal > 0) return 'PositiveNumber';
    if (numVal < 0) return 'NegativeNumber';

    return 'RealNumber';
  }

  //
  // 2 Is it a decimal?
  //
  if (value instanceof Decimal) {
    if (value.isNaN()) return 'Number';
    if (!value.isFinite()) return 'ExtendedRealNumber';
    if (value.isZero()) return 'NonNegativeInteger'; // Bias: Could be NonPositiveInteger

    if (value.isInteger()) {
      if (value.gt(0)) return 'PositiveInteger';
      if (value.lt(0)) return 'NegativeInteger';
      return 'Integer';
    }

    if (value.gt(0)) return 'PositiveNumber';
    if (value.lt(0)) return 'NegativeNumber';
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
      // The value is a rational number
      if (denom !== 1) return 'RationalNumber';

      return inferNumericDomain(numer);
    }
  }

  //
  // 5. Symbol
  //
  // (We handle these common symbols here for performance only.
  // The general case is handled by looking up the definition of the symbol and
  // using its `domain` property)
  //
  const symbol = getSymbolName(value);
  if (symbol !== null) {
    if (symbol === 'NaN') return 'Number'; // Yes, `Not A Number` is a `Number`. Bite me.
    if (symbol === '+Infinity' || symbol === '-Infinity') {
      return 'ExtendedRealNumber';
    }
    if (symbol === COMPLEX_INFINITY) return 'ExtendedComplexNumber';
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
    if (['GoldenRatio'].includes(symbol)) {
      return 'AlgebraicNumber';
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
          return 'AlgebraicNumber';
        }
      }
    }
  }
  // @todo: the log in a prime base of a prime number is irrational

  return null;
}
