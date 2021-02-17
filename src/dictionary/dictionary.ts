import type {
  Dictionary,
  DictionaryCategory,
  ComputeEngine,
  FunctionDefinition,
  SetDefinition,
  SymbolDefinition,
  CompiledDictionary,
  Expression,
} from '../public';
import {
  COMPLEX_INFINITY,
  DIVIDE,
  getArg,
  getFunctionName,
  getNumberValue,
  getRationalValue,
  MULTIPLY,
  POWER,
} from '../utils';
import { getDomainDictionary } from './domains';
import { ARITHMETIC_DICTIONARY } from './arithmetic';
import { CORE_DICTIONARY } from './core';
import { LOGIC_DICTIONARY } from './logic';
import { SETS_DICTIONARY } from './sets';
import { TRIGONOMETRY_DICTIONARY } from './trigonometry';
import { FIRST_1000_PRIMES, THOUSAND_TH_PRIME } from '../compute-engine/primes';
import {
  isSymbolDefinition,
  isFunctionDefinition,
  isSetDefinition,
} from './utils';

export function getDefaultDictionary(
  domain: DictionaryCategory | 'all' = 'all'
): Readonly<Dictionary> {
  let result: Dictionary;
  if (domain === 'all') {
    result = {};
    Object.keys(DICTIONARY).forEach((x) => {
      result = { ...result, ...DICTIONARY[x] };
    });
  } else {
    result = { ...DICTIONARY[domain] };
  }
  return result;
}

// export const ADD = 'Q32043';
// export const SUBTRACT = 'Q40754';
// export const NEGATE = 'Q715358'; // -x
// export const RECIPROCAL = 'Q216906'; // 1/x
// export const MULTIPLY = 'Q40276';
// export const DIVIDE = 'Q40276';
// export const POWER = 'Q33456';

// export const STRING = 'Q184754';
// export const TEXT = '';

// export const COMPLEX = 'Q11567'; // ℂ Set of complex numbers Q26851286
// export const REAL = 'Q12916'; // ℝ Set of real numbers: Q26851380
// export const RATIONAL = 'Q1244890'; // ℚ
// export const NATURAL_NUMBER = 'Q21199'; // ℕ0 (includes 0) or ℕ* (wihtout 0) Set of Q28777634
// // set of positive integers (incl 0): Q47339953
// // set of natural numbers (w/o 0): Q47007719
// export const INTEGER = 'Q12503'; // ℤ
// export const PRIME = 'Q47370614'; // set of prime numbers

// export const MATRIX = 'Q44337';
// export const FUNCTION = 'Q11348';

// export const LIST = 'Q12139612';

// Unary functions:
// https://query.wikidata.org/#PREFIX%20wd%3A%20%3Chttp%3A%2F%2Fwww.wikidata.org%2Fentity%2F%3E%0APREFIX%20wdt%3A%20%3Chttp%3A%2F%2Fwww.wikidata.org%2Fprop%2Fdirect%2F%3E%0A%0ASELECT%20DISTINCT%20%3Fitem%0AWHERE%20%7B%0A%20%20%20%20%3Fitem%20wdt%3AP31%2a%20wd%3AQ657596%0A%7D%0A
// https://query.wikidata.org/#PREFIX%20wd%3A%20%3Chttp%3A%2F%2Fwww.wikidata.org%2Fentity%2F%3E%0APREFIX%20wdt%3A%20%3Chttp%3A%2F%2Fwww.wikidata.org%2Fprop%2Fdirect%2F%3E%0A%0ASELECT%20DISTINCT%20%3Fitem%0AWHERE%20%7B%0A%20%20%20%20%3Fitem%20wdt%3AP279%2a%20wd%3AQ657596%0A%7D%0A

// Binary functions:
// https://query.wikidata.org/#PREFIX%20wd%3A%20%3Chttp%3A%2F%2Fwww.wikidata.org%2Fentity%2F%3E%0APREFIX%20wdt%3A%20%3Chttp%3A%2F%2Fwww.wikidata.org%2Fprop%2Fdirect%2F%3E%0A%0ASELECT%20DISTINCT%20%3Fitem%0AWHERE%20%7B%0A%20%20%20%20%3Fitem%20wdt%3AP31%2a%20wd%3AQ164307%0A%7D%0A

// Bindings to:
// - stdlib: https://github.com/stdlib-js/stdlib
// - mathjs
// - others...?

export const DICTIONARY: { [category in DictionaryCategory]?: Dictionary } = {
  'arithmetic': ARITHMETIC_DICTIONARY,
  'algebra': {
    // polynomial([0, 2, 0, 4]:list, x:symbol) -> 2x + 4x^3
    // polynomial(2x + 4x^3, x) -> {0, 2, 0, 4}
    // rational(2x + 4x^3, {3, 1}, x) -> (2x + 4x^3)/(3+x)
    // https://reference.wolfram.com/language/tutorial/AlgebraicCalculations.html
    // simplify-trig (macsyma)
    //  - trigReduce, trigExpand, trigFactor, trigToExp (mathematica)
    // Mathematica:
    // - distribute -> (a+b)(c+d) -> ac+ ad+ bc+ bd (doesn't have to be multiply,
    // f(a+b, c+d) -> f(a, c) + f(a, d) + f(b, c) + f(b, d)
    // -- distribute(expr, over=add, with=multiply)
    // https://reference.wolfram.com/language/ref/Distribute.html
    // - expand, expand-all
    // - factor
    // - simplify
  },

  'calculus': {
    // D
    // Derivative (mathematica)
    // diff (macsyma)
    // nth-diff
    // int
    // - integrate(expression, symbol)  -- indefinite integral
    // - integrate(expression, range) <range> = {symbol, min, max} -- definite integral
    // - integrate(expression, range1, range2) -- multiple integral
    // def-int
  },
  'combinatorics': {}, // fibonacci, binomial, etc...
  'complex': {
    // real
    // imaginary
    // complex-cartesian (constructor)
    // complex-polar
    // argument
    // conjugate
  },
  'core': { ...CORE_DICTIONARY, ...getDomainDictionary() },
  'dimensions': {
    // volume, speed, area
  },
  'lists': {
    // first    or head
    // rest     or tail
    // cons -> cons(first (element), rest (list)) = list
    // append -> append(list, list) -> list
    // reverse
    // rotate
    // in
    // map   ⁡ map(2x, x, list) ( 2 ⁢ x | x ∈ [ 0 , 10 ] )
    // such-that {x ∈ Z | x ≥ 0 ∧ x < 100 ∧ x 2 ∈ Z}
    // select : picks out all elements ei of list for which crit[ei] is True.
    // sort
    // contains / find
  },
  'logic': LOGIC_DICTIONARY,
  'inequalities': {},
  'intervals': {
    // interval of integers vs interval of other sets (integer interval don't need to be open/closed)
    // interval vs. ranges
    // interval, open-interval, etc..
    // upper     or min?
    // lower    or max?
  },
  'linear-algebra': {
    // matrix
    // transpose
    // cross-product
    // outer-product
    // determinant
    // vector
    // matrix
    // rank
    // scalar-matrix
    // constant-matrix
    // identitity-matrix
  },
  'numeric': {
    // Gamma function
    // Zeta function
    // erf function
    // numerator(fraction)
    // denominator(fraction)
    // exactFloatToRational
    // N -> eval as a number
    // random
    // hash
  },
  'other': {},
  'polynomials': {
    // degree
    // expand
    // factors
    // roots
  },
  'physics': {
    'mu-0': {
      constant: true,
      wikidata: 'Q1515261',
      domain: 'R+',
      value: 1.25663706212e-6,
      unit: [MULTIPLY, 'H', [POWER, 'm', -1]],
    },
  },
  'quantifiers': {},
  'relations': {
    // eq, lt, leq, gt, geq, neq, approx
    //     shortLogicalImplies: 52, // ->
    // shortImplies => 51
    // implies ==> 49
    //    impliedBy: 45, // <==
    // := assign 80
    // less-than-or-equal-to: Q55935272 241
    // greater-than-or-equal: Q55935291 242
    // greater-than: Q47035128  243
    // less-than: Q52834024 245
  },
  'rounding': {
    // ceiling, floor, trunc, round,
  },
  'sets': SETS_DICTIONARY,
  'statistics': {
    // average
    // mean
    // variance = size(l) * stddev(l)^2 / (size(l) - 1)
    // stddev
    // median
    // quantile
  },
  'transcendentals': {
    // log, ln, exp,
  },
  'trigonometry': TRIGONOMETRY_DICTIONARY,
  'units': {},
};

/**
 * Return a compiled and validated version of the dictionary.
 *
 * Specifically:
 * - Expressions (for values, evaluate, domain, isMemberOf, etc..) are compiled
 * when possible, put in canonical form otherwise
 * - The domain of entries is inferred and validated:
 *  - check that domains are in canonical form
 *  - check that domains are consistent with declarations (for example that
 * the signature of predicate have a MaybeBoolean codomain)
 *
 */
export function compileDictionary(
  dict: Dictionary,
  engine: ComputeEngine
): CompiledDictionary {
  const result = new Map<
    string,
    FunctionDefinition | SetDefinition | SymbolDefinition
  >();
  for (const entryName of Object.keys(dict)) {
    result.set(entryName, normalizeDefinition(dict[entryName]));
  }
  validateDictionary(engine, result);

  // @todo: compile

  return result;
}

function normalizeDefinition(
  def: number | FunctionDefinition | SymbolDefinition | SetDefinition
):
  | Required<FunctionDefinition>
  | Required<SymbolDefinition>
  | Required<SetDefinition> {
  if (typeof def === 'number') {
    return {
      domain: inferNumericDomain(def),
      constant: false,
      value: def,
    } as Required<SymbolDefinition>;
  }

  if (isSymbolDefinition(def)) {
    return {
      domain: 'Anything',
      constant: false,
      ...def,
    } as Required<SymbolDefinition>;
  }

  if (isFunctionDefinition(def)) {
    return {
      wikidata: '',

      scope: null,
      threadable: false,
      associative: false,
      commutative: false,
      additive: false,
      multiplicative: false,
      outtative: false,
      idempotent: false,
      involution: false,
      pure: true,

      hold: 'none',
      sequenceHold: false,

      signatures: [],
      ...def,
    } as Required<FunctionDefinition>;
  }

  if (isSetDefinition(def)) {
    return def as Required<SetDefinition>;
  }

  return undefined;
}

function validateDictionary(
  engine: ComputeEngine,
  dictionary: CompiledDictionary
): void {
  for (const [name, def] of dictionary) {
    if (!/[A-Za-z][A-Za-z0-9-]*/.test(name) && name.length !== 1) {
      engine.onError({ code: 'invalid-name', arg: name });
    }
    if (isSymbolDefinition(def)) {
      // @todo: validate domain (make sure domain exists)
      // @todo: for numeric domain, validate them: i.e. real are at least RealNumber, etc...
      // using inferDomain
    }
    if (isFunctionDefinition(def)) {
      // @todo: validate signatures: all arguments have known domains
      // @todo result have a valid domain
      // @todo: there is at least an evaluate or a compile property
    }
    if (isSetDefinition(def)) {
      // @todo: check that all the elements of supersets are symbols of the Set domain
      // @todo: could check that the domain of `isMemberOf` is MaybeBoolean
    }
  }
}

export function inferNumericDomain(value: Expression): string {
  const [numer, denom] = getRationalValue(value);

  if (!Number.isNaN(numer) && !Number.isNaN(denom)) {
    if (numer === 0) return 'NumberZero';

    // The value is a rational number
    if (denom !== 1) return 'RationalNumber';

    if (FIRST_1000_PRIMES.has(numer)) return 'PrimeNumber';

    if (numer > 1 && numer < THOUSAND_TH_PRIME) return 'CompositeNumber';

    if (numer > 0) return 'NaturalNumber';

    return 'Integer';
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
        if (FIRST_1000_PRIMES.has(getNumberValue(getArg(value, 1)))) {
          // Square root of a prime is irrational
          return 'IrrationalNumber';
        }
      }
    }
  }
  // @todo: the log in a prime base of a prime number is irrational

  if (!Number.isFinite(getNumberValue(value))) return 'SignedInfinity';

  return 'RealNumber';
}
