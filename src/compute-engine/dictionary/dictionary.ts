import type { Expression, DictionaryCategory } from '../../public';
import type {
  Dictionary,
  FunctionDefinition,
  SymbolDefinition,
  CompiledDictionary,
  ComputeEngine,
  CollectionDefinition,
  Definition,
  Numeric,
} from '../public';
import { getDomainsDictionary } from './domains';
import { ARITHMETIC_DICTIONARY } from './arithmetic';
import { CORE_DICTIONARY } from './core';
import { LOGIC_DICTIONARY } from './logic';
import { SETS_DICTIONARY } from './sets';
import { COLLECTIONS_DICTIONARY } from './collections';
import { TRIGONOMETRY_DICTIONARY } from './trigonometry';
import {
  isSymbolDefinition,
  isFunctionDefinition,
  isSetDefinition,
  isCollectionDefinition,
} from './utils';
import { MULTIPLY, POWER, getFunctionName } from '../../common/utils';
import { inferNumericDomain } from '../domains';
import { ExpressionMap } from '../expression-map';

export function getDefaultDictionaries<T extends number = number>(
  categories: DictionaryCategory[] | 'all' = 'all'
): Readonly<Dictionary<T>>[] {
  if (categories === 'all') {
    return getDefaultDictionaries([
      'domains',
      'core',
      'collections', // Dictionary, List, Sets
      'algebra',
      'arithmetic',
      'calculus',
      'complex',
      'combinatorics',
      'dimensions',
      'inequalities',
      'intervals',
      'linear-algebra',
      'logic',
      'numeric',
      'other',
      'physics',
      'polynomials',
      'relations',
      'statistics',
      'transcendentals',
      'trigonometry',
      'rounding',
      'units',
    ]);
  }
  const result: Readonly<Dictionary<T>>[] = [];
  for (const category of categories) {
    if (DICTIONARY[category]) result.push(DICTIONARY[category]!);
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

export const DICTIONARY: {
  [category in DictionaryCategory]?: Dictionary<Numeric>;
} = {
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
  'collections': { ...SETS_DICTIONARY, ...COLLECTIONS_DICTIONARY },
  'domains': getDomainsDictionary(),
  'dimensions': {
    // volume, speed, area
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
    //     shortLogicalImplies: 52, // ➔
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
 * - Expressions (for values, evaluate, domain, isElementOf, etc..) are compiled
 * when possible, put in canonical form otherwise
 * - The domain of entries is inferred and validated:
 *  - check that domains are in canonical form
 *  - check that domains are consistent with declarations (for example that
 * the signature of predicate have a "MaybeBoolean" codomain)
 *
 */
export function compileDictionary<T extends number = Numeric>(
  dict: Dictionary<T>,
  engine: ComputeEngine<T>
): CompiledDictionary<T> {
  const result = new Map<string, Definition<T>>();
  for (const entryName of Object.keys(dict)) {
    const [def, error] = normalizeDefinition(dict[entryName], engine);
    if (error) {
      engine.signal({
        severity: def ? 'warning' : 'error',
        message: ['invalid-dictionary-entry', error],
        head: entryName,
      });
    }
    if (def) result.set(entryName, def);
  }

  // Temporarily put this dictionary in scope
  // (this is required so that compilation and validation can succeed
  // when symbols in this dictionary refer to *other* symbols from this dictionary)
  engine.context = {
    parentScope: engine.context,
    dictionary: result,
    assumptions: new ExpressionMap(),
  };

  // @todo: compile

  validateDictionary(engine, result);

  // Restore the original scope
  engine.context = engine.context.parentScope;

  return result;
}

function normalizeDefinition(
  def: number | Definition<Numeric>,
  engine: ComputeEngine
): [def: null | Definition<Numeric>, error?: string] {
  if (typeof def === 'number') {
    //  If the dictionary entry is provided as a number, assume it's a
    // variable, and infer its domain based on its value.
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
    let warning: string | undefined;
    if (!domain) {
      warning = 'no domain provided.';
      domain = 'Anything';
    }
    def = {
      domain,
      constant: false,
      ...(def as Partial<SymbolDefinition>),
    };

    if (def.hold === false && !def.value) {
      def.hold = true;
    }

    return [def, warning];
  }

  if (
    isCollectionDefinition(def) ||
    (typeof domain !== 'function' && engine.isSubsetOf(domain, 'Collection'))
  ) {
    return [
      {
        domain: 'Collection',
        iterable: (def as CollectionDefinition).iterator !== undefined,
        indexable: (def as CollectionDefinition).at !== undefined,
        countable: (def as CollectionDefinition).size !== undefined,
        ...(def as Partial<CollectionDefinition>),
      },
      undefined,
    ];
  }

  if (
    isFunctionDefinition(def) ||
    (typeof domain !== 'function' && engine.isSubsetOf(domain, 'Function'))
  ) {
    let functionDef = { ...(def as FunctionDefinition) };
    functionDef = {
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
      numeric: false,
      pure: true,

      hold: 'none',
      sequenceHold: false,

      signatures: [],
      ...(def as FunctionDefinition),
    } as FunctionDefinition;
    let warning: string | undefined;
    if (!functionDef.range) {
      warning = `no function range provided.`;
    } else if (domain === 'LogicalFunction' || domain === 'Predicate') {
      if (
        functionDef.range !== 'Boolean' &&
        functionDef.range !== 'MaybeBoolean'
      ) {
        warning = `A "LogicalFunction" or a "Predicate" should have a range of "Boolean" or "MaybeBoolean"`;
      }
    } else {
      if (
        functionDef.range === 'Boolean' ||
        functionDef.range === 'MaybeBoolean'
      ) {
        warning = `looks like a "LogicalFunction" or a "Predicate"?`;
      }
    }
    return [functionDef, warning];
  }

  if (
    isSetDefinition(def) ||
    (typeof domain !== 'function' && engine.isSubsetOf(domain, 'Function'))
  ) {
    // @todo
    return [def];
  }

  if (def) {
    // This might be a partial definition (missing `constant` for a symbol)
    if (
      domain &&
      typeof domain !== 'function' &&
      engine.isSubsetOf(domain, 'Number')
    ) {
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
          ...(def as Partial<SymbolDefinition>),
        },
        inferredDomain !== domain ? 'inferred domain "${inferredDomain}"' : '',
      ];
    }
    // This might be a partial definition (missing `signatures` for a Function)
    if (
      domain &&
      typeof domain !== 'function' &&
      engine.isSubsetOf(domain, 'Function')
    ) {
      return [
        {
          range: 'Anything',
          ...(def as Partial<FunctionDefinition>),
        } as FunctionDefinition,
        'a "Function" should have a "range" property in its definition',
      ];
    }
    // This might be a partial definition (missing `supersets` for a Set)
    if (
      domain &&
      typeof domain !== 'function' &&
      engine.isSubsetOf(domain, 'Set')
    ) {
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
function validateDictionary<T extends number = number>(
  engine: ComputeEngine<T>,
  dictionary: CompiledDictionary<T>
): void {
  const wikidata = new Set<string>();
  for (const [name, def] of dictionary) {
    if (!/[A-Za-z][A-Za-z0-9-]*/.test(name) && name.length !== 1) {
      engine.signal({ severity: 'error', message: 'invalid-name', head: name });
    }
    if (def.wikidata) {
      if (wikidata.has(def.wikidata)) {
        engine.signal({
          severity: 'warning',
          message: ['duplicate-wikidata', def.wikidata],
          head: name,
        });
      }
      wikidata.add(def.wikidata);
    }
    if (isSymbolDefinition(def)) {
      // Validate domain (make sure domain exists)
      if (
        typeof def.domain !== 'function' &&
        !engine.isSubsetOf(def.domain, 'Anything')
      ) {
        engine.signal({
          severity: 'warning',
          message: ['unknown-domain', def.domain as string], //@todo might not be a string
          head: name,
        });
      }

      if (def.hold === false && !def.value) {
        engine.signal({
          severity: 'warning',
          message: [
            'invalid-dictionary-entry',
            'symbol has hold = false, but no value',
          ],
          head: name,
        });
      }

      // @todo: for numeric domain, validate them: i.e. real are at least RealNumber, etc...
      // using inferDomain
    }
    if (isCollectionDefinition(def)) {
      // @todo
    }
    if (isFunctionDefinition(def)) {
      // Validate range
      const sig = def.range;
      if (typeof sig !== 'function' && !engine.isSubsetOf(sig, 'Anything')) {
        engine.signal({
          severity: 'warning',
          message: ['unknown-domain', sig as string], //@todo might not be a string
          head: name,
        });
      }

      // @todo could do some additional checks
      // - if it's numeric, it can't have a 'hold' argument
      // - if it's commutative it must have at least one signature with multiple arguments
      // - if an involution, it's *not* idempotent
      // - if it's threadable it must have at least one signature with a rest argument
    }
    if (isSetDefinition(def)) {
      // Check there is at least one superset defined
      if (def.supersets.length === 0 && name !== 'Anything') {
        engine.signal({
          severity: 'warning',
          message: 'expected-supersets',
          head: name,
        });
      }
      // Check that all the parents are valid
      for (const parent of def.supersets) {
        if (!engine.isSubsetOf(parent, 'Anything')) {
          engine.signal({
            severity: 'warning',
            message: ['expected-supersets', parent],
            head: name,
          });
        }
        // Check for loops in set definition
        if (engine.isSubsetOf(parent, name)) {
          engine.signal({
            severity: 'warning',
            message: ['cyclic-definition', setParentsToString(engine, name)],
            head: name,
          });

          // Remove entry from dictionary
          dictionary.delete(name);
        }
      }
      // @todo: could check that the domain of `isElementOf` and `isSubsetOf` is
      // MaybeBoolean
    }
  }
}

/**
 * For debugging purposes,  a textual representation of the inheritance
 * chain of sets.
 */
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
