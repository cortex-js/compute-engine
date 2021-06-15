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
  isDictionaryObject,
  isStringObject,
  POWER,
} from '../common/utils';
import { Expression } from '../public';
import { ComputeEngine } from './public';
import { LARGEST_SMALL_PRIME, nextDown, nextUp, SMALL_PRIMES } from './numeric';
import { filterAssumptions } from './assume';

export function domain(
  engine: ComputeEngine,
  expr: Expression
): Expression | null {
  // @todo

  //
  // 1. Is it a number?
  //
  const numVal = getNumberValue(expr);
  if (numVal === 0) return 'NumberZero';
  if (numVal !== null && !isNaN(numVal)) {
    if (!isFinite(numVal)) return 'SignedInfinity';

    // 1.1 Is it an integer?
    if (Number.isInteger(numVal)) return ['Range', numVal, numVal];
    return ['Interval', nextDown(numVal), nextUp(numVal)];
  }

  //
  // 2. Is it a symbol?
  //
  const symName = getSymbolName(expr);
  if (symName !== null) {
    // 2.1 Do we have an assumption about this symbol
    // @todo: we could handle more complex assumptions, i.e. conjunctions, etc...
    const assumptions = filterAssumptions(engine, 'Element', expr);
    if (assumptions.length > 0) {
      if (assumptions.length === 1) return getArg(assumptions[0], 2);
      console.error('Expected a single Element assumption');
      // @todo:  what if there are more than one assumptions? Can this happen?
      return 'Symbol';
    }
    // 2.2 Does the symbol definition have a domain?
    // (we look for 'Definition' in general, because Domains do not have a
    // SymbolDefinition (they don't necessarily have a value).
    const def = engine.getDefinition(symName);
    if (def && typeof def.domain === 'function') {
      return def.domain();
    } else if (def && def.domain) {
      return def.domain as Expression;
    }
    return 'Symbol';
  }

  //
  // 3. Is it a function?
  //

  const head = getFunctionHead(expr);
  if (typeof head === 'string') {
    const def = engine.getFunctionDefinition(head);
    if (def && typeof def.range === 'function') {
      return def.range(engine, ...getTail(expr));
    } else if (def) {
      return def.range as Expression;
    }
  }

  //
  // 4. It's something else: collection, etc...
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

export function inferNumericDomain(value: Expression | undefined): string {
  if (value === undefined) return '';
  const rational = getRationalValue(value);

  if (rational !== null) {
    const [numer, denom] = rational;
    if (!Number.isNaN(numer) && !Number.isNaN(denom)) {
      if (numer === 0) return 'NumberZero';

      // The value is a rational number
      if (denom !== 1) return 'RationalNumber';

      if (SMALL_PRIMES.has(numer)) return 'PrimeNumber';

      if (numer >= 1 && numer < LARGEST_SMALL_PRIME) return 'CompositeNumber';

      if (numer > 0) return 'NaturalNumber';

      return 'Integer';
    }
  }

  if (value === COMPLEX_INFINITY) return 'ComplexInfinity';

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
          return 'IrrationalNumber';
        }
      }
    }
  }
  // @todo: the log in a prime base of a prime number is irrational

  if (!Number.isFinite(getNumberValue(value) ?? NaN)) return 'SignedInfinity';

  return 'RealNumber';
}
