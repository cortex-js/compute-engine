import type { Expression, DictionaryCategory } from '../../public';
import type {
  Dictionary,
  FunctionDefinition,
  SetDefinition,
  SymbolDefinition,
  CompiledDictionary,
  ComputeEngine,
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
import { getDomainsDictionary } from './domains';
import { ARITHMETIC_DICTIONARY } from './arithmetic';
import { CORE_DICTIONARY } from './core';
import { LOGIC_DICTIONARY } from './logic';
import { SETS_DICTIONARY } from './sets';
import { TRIGONOMETRY_DICTIONARY } from './trigonometry';
import { FIRST_1000_PRIMES, THOUSAND_TH_PRIME } from './primes';
import {
  isSymbolDefinition,
  isFunctionDefinition,
  isSetDefinition,
} from './utils';

export function getDefaultDictionaries(
  categories: DictionaryCategory[] | 'all' = 'all'
): Readonly<Dictionary>[] {
  if (categories === 'all') {
    return getDefaultDictionaries([
      'domains',
      'core',
      'algebra',
      'arithmetic',
      'calculus',
      'complex',
      'combinatorics',
      'dimensions',
      'inequalities',
      'intervals',
      'linear-algebra',
      'lists',
      'logic',
      'numeric',
      'other',
      'physics',
      'polynomials',
      'relations',
      'sets',
      'statistics',
      'symbols',
      'transcendentals',
      'trigonometry',
      'rounding',
      'units',
    ]);
  }
  const result: Readonly<Dictionary>[] = [];
  for (const category of categories) {
    result.push(DICTIONARY[category]);
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
  'core': CORE_DICTIONARY,
  'domains': getDomainsDictionary(),
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
    'Mu-0': {
      constant: true,
      wikidata: 'Q1515261',
      domain: 'RealNumber',
      value: 1.25663706212e-6,
      unit: [MULTIPLY, 'H', [POWER, 'm', -1]],
    },
  },
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
 * the signature of predicate have a "MaybeBoolean" codomain)
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
    const [def, error] = normalizeDefinition(dict[entryName], engine);
    if (error) {
      engine.onError({
        code: def ? 'dictionary-entry-warning' : 'invalid-dictionary-entry',
        arg: `${entryName}: ${error}`,
      });
    }
    if (def) result.set(entryName, def);
  }

  // Temporarily put this dictionary in scope
  // (this is required so that compilation and validation can success
  // when symbols in this dictionary refer to *other* symbols int his dictionary)
  engine.scope = { parentScope: engine.scope, dictionary: result };

  // @todo: compile

  validateDictionary(engine, result);

  // Restore the original scope
  engine.scope = engine.scope.parentScope;

  return result;
}

function normalizeDefinition(
  def: number | FunctionDefinition | SymbolDefinition | SetDefinition,
  engine: ComputeEngine
): [
  def: FunctionDefinition | SymbolDefinition | SetDefinition,
  error?: string
] {
  if (typeof def === 'number') {
    //  If the dictionary entry is provided as a number, assume it's a
    // variable, and infer its type based on its value.
    return [
      {
        domain: inferNumericDomain(def),
        constant: false,
        value: def,
      },
    ];
  }

  let domain = def.domain;

  if (isSymbolDefinition(def)) {
    let warning;
    if (!domain) {
      warning = 'no domain provided.';
      domain = 'Anything';
    }

    def = {
      domain,
      constant: false,
      ...def,
    };
    return [def, warning];
  }

  if (isFunctionDefinition(def) || engine.isSubsetOf(domain, 'Function')) {
    def = {
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
      ...(def as any),
    } as FunctionDefinition;
    let warning: string;
    if (def.signatures.length === 0) {
      warning = `no function signature provided.`;
    } else if (def.signatures.length === 1) {
      const sig = def.signatures[0];
      if (sig.result === 'Boolean' || sig.result === 'MaybeBoolean') {
        if (sig.args.length === 2) {
          if (
            (sig.args[0] === 'Boolean' || sig.args[0] === 'MaybeBoolean') &&
            (sig.args[1] === 'Boolean' || sig.args[1] === 'MaybeBoolean')
          ) {
            warning = `looks like a "LogicalFunction"?`;
          }
        }
        if (!warning) warning = `looks like a "Predicate"?`;
      }
    }
    return [def, warning];
  }

  if (isSetDefinition(def) || engine.isSubsetOf(domain, 'Function')) {
    return [def];
  }

  if (def) {
    // This might be a partial definition (missing `constant` for a symbol)
    if (domain && engine.isSubsetOf(domain, 'Number')) {
      if (typeof (def as SymbolDefinition).value === 'undefined') {
        return [null, 'expected "value" property in definition'];
      }
      // That's a numeric variable definition
      const inferredDomain = inferNumericDomain(
        (def as SymbolDefinition).value
      );
      return [
        {
          domain: inferredDomain,
          constant: false,
          ...(def as SymbolDefinition),
        },
        inferredDomain !== domain ? 'inferred domain "${inferredDomain}"' : '',
      ];
    }
    // This might be a partial definition (missing `signatures` for a Function)
    if (domain && engine.isSubsetOf(domain, 'Function')) {
      return [
        {
          signatures: [{ rest: 'Anything', result: 'Anything' }],
          ...(def as FunctionDefinition),
        },
        'a "Function" should have a "signatures" property in its definition',
      ];
    }
    // This might be a partial definition (missing `supersets` for a Set)
    if (domain && engine.isSubsetOf(domain, 'Set')) {
      return [
        def,
        'a "Set" should have a "supersets" property in its definition',
      ];
    }
  }
  return [def, 'could not be validate'];
}

/**
 * Validate the contents of the dictionary.
 *
 * Unlike `normalizeDefinition` which only considers the properties of the
 * definition entry, `validateDictionary` will consider the entries
 * in relation to each other, for example validating that the referenced
 * domains are valid.
 */
function validateDictionary(
  engine: ComputeEngine,
  dictionary: CompiledDictionary
): void {
  const wikidata = new Set<string>();
  for (const [name, def] of dictionary) {
    if (!/[A-Za-z][A-Za-z0-9-]*/.test(name) && name.length !== 1) {
      engine.onError({ code: 'invalid-name', arg: name });
    }
    if (def.wikidata) {
      if (wikidata.has(def.wikidata)) {
        engine.onError({
          code: 'dictionary-entry-warning',
          arg: `${name}: duplicate wikidata "${def.wikidata}"`,
        });
      }
      wikidata.add(def.wikidata);
    }
    if (isSymbolDefinition(def)) {
      // Validate domain (make sure domain exists)
      if (!engine.isSubsetOf(def.domain, 'Anything')) {
        engine.onError({
          code: 'dictionary-entry-warning',
          arg: `${name}: unknown domain "${def.domain}"`,
        });
      }
      // @todo: for numeric domain, validate them: i.e. real are at least RealNumber, etc...
      // using inferDomain
    }
    if (isFunctionDefinition(def)) {
      // Validate signatures
      for (const sig of def.signatures) {
        if (
          typeof sig.result !== 'function' &&
          !engine.isSubsetOf(sig.result, 'Anything')
        ) {
          engine.onError({
            code: 'dictionary-entry-warning',
            arg: `${name}: unknown result domain "${sig.result}"`,
          });
        }
        if (sig.rest && !engine.isSubsetOf(sig.rest, 'Anything')) {
          engine.onError({
            code: 'dictionary-entry-warning',
            arg: `${name}: unknown rest domain "${def.domain}"`,
          });
        }
        if (sig.args) {
          for (const arg of sig.args) {
            if (!engine.isSubsetOf(arg, 'Anything')) {
              engine.onError({
                code: 'dictionary-entry-warning',
                arg: `${name}: unknown argument domain "${def.domain}"`,
              });
            }
          }
        }
      }
      // @todo could do some additional checks
      // - if it's commutative it must have at least one signature with multiple arguments
      // - if an involution, it's *not* idempotent
      // - if it's threadable it must have at least one signature with a rest argument
    }
    if (isSetDefinition(def)) {
      // Check there is at least one superset defined
      if (def.supersets.length === 0 && name !== 'Anything') {
        engine.onError({
          code: 'dictionary-entry-warning',
          arg: `${name}: expected supersets`,
        });
      }
      // Check that all the parents are valid
      for (const parent of def.supersets) {
        if (!engine.isSubsetOf(parent, 'Anything')) {
          engine.onError({
            code: 'dictionary-entry-warning',
            arg: `${name}: invalid superset "${parent}" is not "Anything": ${setParentsToString(
              engine,
              parent
            )}`,
          });
        }
        // Check for loops in set definition
        if (engine.isSubsetOf(parent, name)) {
          engine.onError({
            code: 'invalid-dictionary-entry',
            arg: `${name}: cyclic definition ${setParentsToString(
              engine,
              name
            )}`,
          });
          // Remove entry from dictionary
          dictionary.delete(name);
        }
      }
      // @todo: could check that the domain of `isMemberOf` and `isSubsetOf` is
      // MaybeBoolean
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

    if (numer >= 1 && numer < THOUSAND_TH_PRIME) return 'CompositeNumber';

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

function setParentsToString(
  engine: ComputeEngine,
  expr: Expression,
  cycle?: string[]
): string {
  const result: string[] = [`${expr}`];

  const name = typeof expr === 'string' ? expr : getFunctionName(expr);
  if (cycle) {
    if (cycle.includes(name)) return `${name} ↩︎ `;
    cycle.push(name);
  } else {
    cycle = [name];
  }
  const def = engine.getSetDefinition(name);
  if (!def) return `${name}?!`;
  if (!def.supersets.length || def.supersets.length === 0) return '';

  for (const parent of def?.supersets) {
    if (typeof parent === 'string') {
      result.push(setParentsToString(engine, parent, [...cycle]));
    } else {
    }
  }
  if (result.length <= 1) {
    return result[0] ?? '';
  }
  return '[' + result.join(' ➔ ') + ']';
}
