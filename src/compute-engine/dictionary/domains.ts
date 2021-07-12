import {
  getArg,
  getDecimalValue,
  getFunctionName,
  getNumberValue,
  getRationalValue,
  getTail,
  MISSING,
} from '../../common/utils';
import { Expression } from '../../math-json/math-json-format';
import { inferNumericDomain } from '../domains';
import { order } from '../order';
import {
  ComputeEngine,
  Dictionary,
  Domain,
  Numeric,
  NumericDomain,
  SetDefinition,
} from '../../math-json/compute-engine-interface';

/**
 * Simple description of a numeric domain as a base domain, a min and
 * max value, possibly open ends, and some excluded values.
 */
export type NumericDomainInfo = {
  domain?: NumericDomain; // Integer, RealNumber, ComplexNumber...
  // (not one of the 'shortcuts', i.e. PositiveInteger)
  min?: number; // Min and Max are not defined for ComplexNumbers
  max?: number;
  open?: 'left' | 'right' | 'both'; // For RealNumbers
  /** Values from _excludedValues_ are considered not in this domain */
  excludedValues?: number[];
  /** If defined, the values in this domain must follow the relation
   * _period_ * _n_ + _phase_ when _n_ is in _domain_.
   */
  multiple?: [period: Numeric, domain: Domain, phase: Numeric];
};

export const NUMERIC_DOMAIN_INFO = {
  Number: { domain: 'ExtendedComplexNumber' },
  ExtendedComplexNumber: { domain: 'ExtendedComplexNumber' },
  ExtendedRealNumber: {
    domain: 'ExtendedRealNumber',
    min: -Infinity,
    max: +Infinity,
  },
  ComplexNumber: { domain: 'ComplexNumber' },
  ImaginaryNumber: {
    domain: 'ImaginaryNumber',
    min: -Infinity,
    max: +Infinity,
  },
  RealNumber: { domain: 'RealNumber', min: -Infinity, max: +Infinity },
  TranscendentalNumber: {
    domain: 'TranscendentalNumber',
    min: -Infinity,
    max: +Infinity,
  },
  AlgebraicNumber: {
    domain: 'AlgebraicNumber',
    min: -Infinity,
    max: +Infinity,
  },
  RationalNumber: { domain: 'RationalNumber', min: -Infinity, max: +Infinity },
  Integer: { domain: 'Integer', min: -Infinity, max: +Infinity },
  NegativeInteger: { domain: 'Integer', min: -Infinity, max: -1 },
  NegativeNumber: {
    domain: 'RealNumber',
    min: -Infinity,
    max: 0,
    open: 'right',
  },
  NonNegativeNumber: { domain: 'RealNumber', min: 0, max: +Infinity },
  NonNegativeInteger: { domain: 'Integer', min: 0, max: +Infinity },
  NonPositiveNumber: {
    domain: 'RealNumber',
    min: -Infinity,
    max: 0,
  },
  NonPositiveInteger: { domain: 'Integer', min: -Infinity, max: 0 },
  PositiveInteger: { domain: 'Integer', min: 1, max: +Infinity },
  PositiveNumber: {
    domain: 'RealNumber',
    min: 0,
    max: +Infinity,
    open: 'left',
  },
};

// See also sympy 'assumptions'
// https://docs.sympy.org/latest/modules/core.html#module-sympy.core.assumptions

/**
 * The set of domains form a lattice with 'Anything' at the top and 'Nothing'
 * at the bottom.
 *
 * The DOMAIN_PARENT table represents this lattice by indicating the parent(s)
 * for each domain.
 */

const DOMAIN_PARENT = {
  Anything: [],
  Expression: 'Anything',
  Domain: ['Set', 'Symbol'],
  ParametricDomain: ['Domain', 'Function'],
  MaybeBoolean: 'Expression',
  Boolean: 'MaybeBoolean',
  Collection: 'Expression',
  Dictionary: 'Collection',
  List: 'Collection',
  Sequence: 'Collection',
  Tuple: 'Collection',
  String: 'Expression',
  Symbol: 'String',
  Set: 'Collection',
  EmptySet: 'Set',

  //
  // Functional Domains
  //
  Function: 'Expression',
  Predicate: 'Function',
  LogicalFunction: 'Predicate',
  // https://en.wikipedia.org/wiki/List_of_mathematical_functions
  TranscendentalFunction: 'Function',
  AlgebraicFunction: 'Function',
  PeriodicFunction: 'Function',
  TrigonometricFunction: ['PeriodicFunction', 'TranscendentalFunction'],
  HyperbolicFunction: 'TranscendentalFunction',
  MonotonicFunction: 'Function',
  StrictMonotonicFunction: 'MonotonicFunction',
  ContinuousFunction: 'Function',
  DifferentiableFunction: 'ContinuousFunction',
  InfinitelyDifferentiableFunction: 'DifferentiableFunction',
  RationalFunction: ['AlgebraicFunction', 'ContinuousFunction'],
  PolynomialFunction: ['AlgebraicFunction', 'InfinitelyDifferentiableFunction'],
  QuadraticFunction: 'PolynomialFunction',
  LinearFunction: ['QuadraticFunction', 'MonotonicFunction'],
  ConstantFunction: 'LinearFunction',

  //
  // Numeric Domains
  //
  // https://en.wikipedia.org/wiki/Category_of_sets
  Number: 'Set',
  ImaginaryNumber: 'ComplexNumber',
  ComplexNumber: 'ExtendedComplexNumber',
  ExtendedComplexNumber: 'Number',
  NaturalNumber: 'Integer',
  Integer: 'RationalNumber',
  RationalNumber: 'AlgebraicNumber',
  TranscendentalNumber: 'RealNumber',
  AlgebraicNumber: 'RealNumber',
  RealNumber: ['ComplexNumber', 'ExtendedRealNumber'],
  ExtendedRealNumber: 'ExtendedComplexNumber',

  PositiveNumber: 'NonNegativeNumber',
  NonNegativeNumber: 'RealNumber',
  NonPositiveNumber: 'NegativeNumber',
  NegativeNumber: 'RealNumber',

  PositiveInteger: 'NonNegativeInteger',
  NonNegativeInteger: 'Integer',
  NonPositiveInteger: 'NegativeInteger',
  NegativeInteger: 'Integer',

  //
  // Tensorial Domains
  //
  Tensor: 'Expression',
  Scalar: 'Tensor',
  Vector: 'Matrix',
  Row: 'Vector',
  Column: 'Vector',
  Matrix: 'Tensor',
  // https://en.wikipedia.org/wiki/List_of_named_matrices
  ComplexTensor: 'Tensor',
  RealTensor: 'ComplexTensor',
  IntegerTensor: 'RealTensor',
  LogicalTensor: 'IntegerTensor',
  SquareMatrix: 'Matrix',
  MonomialMatrix: 'SquareMatrix',
  TriangularMatrix: 'SquareMatrix',
  UpperTriangularMatrix: 'TriangularMatrix',
  LowerTriangularMatrix: 'TriangularMatrix',
  PermutationMatrix: ['MonomialMatrix', 'LogicalTensor', 'OrthogonalMatrix'],
  OrthogonalMatrix: ['SquareMatrix', 'RealTensor'],
  DiagonalMatrix: ['UpperTriangularMatrix', 'LowerTriangularMatrix'],
  IdentityMatrix: ['DiagonalMatrix', 'SymmetricMatrix', 'PermutationMatrix'],
  ZeroMatrix: ['DiagonalMatrix', 'SymmetricMatrix', 'PermutationMatrix'],
  SymmetricMatrix: ['HermitianMatrix', 'SquareMatrix', 'RealTensor'],
  HermitianMatrix: 'ComplexTensor',
  Quaternion: ['SquareMatrix', 'ComplexTensor'],
};

const DOMAIN_WIKIDATA: { [domain: string]: string } = {
  // set of numbers: Q3054943, number: Q11563
  Function: 'Q11348', // entry for 'function', not 'set of functions'
  ComplexNumber: 'Q26851286', //set of complex numbers
  Integer: 'Q47007735', // ZZ ...-3, -2, -1, 0, 1, 2, 3, 4, ...
  ImaginaryNumber: 'Q47310259', // Numbers on the imaginary line // Q9165172
  NaturalNumber: 'Q28920052', //  0, 1, 2, 3...
};

const DOMAIN_VALUE: { [domain: string]: Expression } = {
  MaybeBoolean: ['Union', 'Boolean', ['Set', 'Maybe']],
  Scalar: ['Intersection', 'Row', 'Column'],
  TriangularMatrix: ['Union', 'UpperTriangularMatrix', 'LowerTriangularMatrix'],
  Vector: ['Union', 'Row', 'Column'],
};

const DOMAIN_COUNT = {
  Boolean: 2,
  MaybeBoolean: 3,
  EmptySet: 0,
  IdentityMatrix: 1,
  ZeroMatrix: 1,
};

const DOMAIN_INFO = {
  Range: {
    domain: 'ParametricDomain',
    range: 'Domain',
    evaluate: (_engine, min: number, max: number) => {
      min = Math.round(min);
      max = Math.round(max);
      if (Number.isNaN(min) || Number.isNaN(max)) return 'EmptySet';
      if (min > max) return 'EmptySet';
      if (min === -Infinity && max === +Infinity) return 'Integer';
      if (min === 0 && max === +Infinity) return 'NaturalNumber';
      return ['Range', min, max];
    },
    isElementOf: (
      expr: Expression<Numeric>,
      min: Expression<Numeric>,
      max: Expression<Numeric>
    ) => {
      min = getNumberValue(min);
      if (min === null) return undefined;

      max = getNumberValue(max);
      if (max === null) return undefined;

      //
      // Compare a number
      //
      let val = getNumberValue(expr);
      if (val === null) {
        // Is it a rational, perhaps?
        const [numer, denom] = getRationalValue(expr);
        if (numer !== null && denom !== null) {
          val = numer / denom;
        }
      }
      if (val !== null) {
        if (!Number.isInteger(val)) return false;
        if (val < min) return false;
        if (val > max) return false;

        return true;
      }
    },

    Interval: {
      domain: 'ParametricDomain',
      range: 'Domain',
      // @todo!! this should be simplify()
      evaluate: (_engine, min: number, max: number) => {
        if (Number.isNaN(min) || Number.isNaN(max)) return 'EmptySet';
        if (min > max) return 'EmptySet';
        if (min === -Infinity && max === +Infinity) {
          return 'RealNumber';
        }
        return ['Interval', min, max];
      },
      // isSubsetOf: (expr: Expression<Numeric>) =>
      //   isNumericSubset(expr, 'ImaginaryNumber'),

      // @todo!! this should have a lhs (an expr) and a rhs (the interval)
      // then call NumericDomainInfo to ascertain
      isElementOf: (
        expr: Expression<Numeric>,
        min: Expression<Numeric>,
        max: Expression<Numeric>
      ) => {
        let openLeft = false;
        let openRight = false;
        if (getFunctionName(min) === 'Open') {
          openLeft = true;
          min = getArg(min, 1);
        }
        min = getNumberValue(min);
        if (min === null) return undefined;

        if (getFunctionName(max) === 'Open') {
          openRight = true;
          max = getArg(max, 1);
        }
        max = getNumberValue(max);
        if (max === null) return undefined;

        //
        // Compare a number
        //
        let val = getNumberValue(expr);
        if (val === null) {
          // Is it a rational, perhaps?
          const [numer, denom] = getRationalValue(expr);
          if (numer !== null && denom !== null) {
            val = numer / denom;
          }
        }
        if (val !== null) {
          if (openLeft) {
            if (val < min) return false;
          } else {
            if (val <= min) return false;
          }
          if (openRight) {
            if (val > max) return false;
          } else {
            if (val >= max) return false;
          }

          return true;
        }

        //
        // Compare a decimal
        //
        const d = getDecimalValue(expr);
        if (d !== null) {
          if (openLeft) {
            if (d.lt(min)) return false;
          } else {
            if (d.lte(min)) return false;
          }
          if (openRight) {
            if (d.gt(max)) return false;
          } else {
            if (d.gte(max)) return false;
          }
          return true;
        }

        //
        // Complex numbers are not ordered, so return undefined as well.
        //

        return undefined;
      },
    },
  },
};

// ImaginaryNumber: {
//   isSubsetOf: (expr: Expression<Numeric>) =>
//     isNumericSubset(expr, 'ImaginaryNumber'),
//   isElementOf: (expr: Expression<Numeric>) =>
//     isNumericElement(expr, 'ImaginaryNumber'),
// },
// ComplexNumber: {
//   isSubsetOf: (expr: Expression<Numeric>) =>
//     isNumericSubset(expr, 'ImaginaryNumber'),

//   isElementOf: (expr: Expression<Numeric>) =>
//     isNumericElement(expr, 'ImaginaryNumber'),
// },
// ExtendedComplexNumber: {
//   isSubsetOf: (expr: Expression<Numeric>) =>
//     isNumericSubset(expr, 'ImaginaryNumber'),
//   isElementOf: (expr: Expression<Numeric>) =>
//     isNumericElement(expr, 'ImaginaryNumber'),
// },
// NaturalNumber: {
//   isSubsetOf: (expr: Expression<Numeric>) =>
//     isNumericSubset(expr, 'ImaginaryNumber'),
//   isElementOf: (expr: Expression<Numeric>) =>
//     isNumericElement(expr, 'ImaginaryNumber'),
// },
// Integer: {
//   isSubsetOf: (expr: Expression<Numeric>) =>
//     isNumericSubset(expr, 'ImaginaryNumber'),
//   isElementOf: (expr: Expression<Numeric>) =>
//     isNumericElement(expr, 'ImaginaryNumber'),
// },
// RationalNumber: {
//   isSubsetOf: (expr: Expression<Numeric>) =>
//     isNumericSubset(expr, 'ImaginaryNumber'),
//   isElementOf: (expr: Expression<Numeric>) =>
//     isNumericElement(expr, 'ImaginaryNumber'),
// },
// TranscendentalNumber: {
//   isSubsetOf: (expr: Expression<Numeric>) =>
//     isNumericSubset(expr, 'ImaginaryNumber'),
//   isElementOf: (expr: Expression<Numeric>) =>
//     isNumericElement(expr, 'ImaginaryNumber'),
// },
// AlgebraicNumber: {
//   isSubsetOf: (expr: Expression<Numeric>) =>
//     isNumericSubset(expr, 'ImaginaryNumber'),
//   isElementOf: (expr: Expression<Numeric>) =>
//     isNumericElement(expr, 'ImaginaryNumber'),
// },
// RealNumber: {
//   isSubsetOf: (expr: Expression<Numeric>) =>
//     isNumericSubset(expr, 'ImaginaryNumber'),
//   isElementOf: (expr: Expression<Numeric>) =>
//     isNumericElement(expr, 'ImaginaryNumber'),
// },
// ExtendedRealNumber: {
//   isSubsetOf: (expr: Expression<Numeric>) =>
//     isNumericSubset(expr, 'ImaginaryNumber'),
//   isElementOf: (expr: Expression<Numeric>) =>
//     isNumericElement(expr, 'ImaginaryNumber'),
// },

/* {
	"resource": "/Users/arno/dev/math-json/src/compute-engine/dictionary/domains.ts",
	"owner": "typescript",
	"code": "2322",
	"severity": 8,
	"message": "Type '{ supersets: undefined[]; domain: string; }' is not
   assignable to type 'SetDefinition'.\n  Type '{ supersets: undefined[]; 
    domain: string; }' is missing the following properties from type 
    '{ iterable: boolean; iterator?: { next: () => Expression; done: () => boolean; };
     indexable: boolean; at: (index: number) => Expression; 
     countable: boolean; size: () => number; 
     isElementOf?: (expr: Expression) => boolean; }': iterable, 
     indexable, at, countable, size",
	"source": "ts",
	"startLineNumber": 172,
	"startColumn": 9,
	"endLineNumber": 172,
	"endColumn": 16,
	"relatedInformation": [
		{
			"startLineNumber": 171,
			"startColumn": 5,
			"endLineNumber": 171,
			"endColumn": 35,
			"message": "The expected type comes from this index signature.",
			"resource": "/Users/arno/dev/math-json/src/compute-engine/dictionary/domains.ts"
		}
	]
}
*/

export function getDomainsDictionary(): Dictionary {
  const result: {
    [name: string]: SetDefinition;
  } = { Nothing: { countable: true, supersets: [], domain: 'Domain' } };
  for (const domain of Object.keys(DOMAIN_PARENT)) {
    const parents = Array.isArray(DOMAIN_PARENT[domain])
      ? DOMAIN_PARENT[domain]
      : [DOMAIN_PARENT[domain]];

    result[domain] = DOMAIN_INFO[domain] ?? {};

    result[domain] = {
      domain: DOMAIN_INFO[domain] ?? 'Domain',
      wikidata: DOMAIN_WIKIDATA[domain],
      supersets: parents,
      value: DOMAIN_VALUE,
      countable: DOMAIN_COUNT[domain] !== undefined,
      size: () => DOMAIN_COUNT[domain],
      ...(result[domain] as any),
    };

    for (const parent of parents) {
      if (parent !== 'Anything' && !DOMAIN_PARENT[parent]) {
        throw new Error(`Unknown parent of domain "${domain}": "${parent}"`);
      }
    }
  }

  // Add all the supersets of Nothing: all the sets that are not the parent of anyone
  const sets = new Set<Domain>();
  for (const domain of Object.keys(result)) sets.add(domain as Domain);
  for (const domain of Object.keys(result)) {
    for (const parent of result[domain].supersets) sets.delete(parent);
  }
  sets.delete('Nothing');
  result['Nothing'].supersets = [...sets.values()];

  // for (const domain of Object.keys(result)) {
  //   for (const parent of result[domain].supersets) {
  //     for (const candidate of result[domain].supersets) {
  //       if (candidate !== parent && isSubdomainOf(result, candidate, parent)) {
  //         throw new Error(
  //           `In domain ${domain}, the parent ${candidate} is redundant with ${parent}`
  //         );
  //       }
  //     }
  //   }
  // }

  for (const domain of Object.keys(result)) {
    let found = false;
    let count = 0;
    let parents: string[] = [domain];
    while (count < 512 && !found) {
      const parent = parents.pop()!;
      found = parent === 'Anything';
      if (!found) parents = [...parent, ...result[parent].supersets];
      count++;
    }
    if (!found) {
      throw new Error(`The "${domain}" domain cannot reach "Anything"`);
    }
  }
  return result;
}

/**
 * Return a canonical representation of a domain.
 *
 * Convert Range/Interval to constants
 */
export function canonicalDomain(
  engine: ComputeEngine,
  dom: Expression
): Expression {
  // @todo: same as commutative functions
  const name = getFunctionName(dom);
  if (name === 'Union' || name === 'Intersection') {
    // If a Union or Intersection sort the arguments...
    return [name, ...getTail(dom).sort(order)];
  } else if (name === 'SetMinus' || name === 'Complement') {
    return [name, canonicalDomain(engine, getArg(dom, 1) ?? MISSING)];
  }

  return dom;
}

export function asNumber(x: Expression<Numeric>): number | null {
  const val = getNumberValue(x);
  if (val !== null) return val;

  const [numer, denom] = getRationalValue(x);
  if (numer !== null && denom !== null) {
    return numer / denom;
  }
  const d = getDecimalValue(x);
  if (d !== null) return d.toNumber();

  return null;
}

/**
 * Return an efficient data structure describing a numeric domain,
 * an `Interval` or `Range`
 * @todo could also check for `Multiple`
 */
export function inferNumericDomainInfo(
  expr: Expression
): NumericDomainInfo | null {
  const head = getFunctionName(expr);
  if (head === 'Range' || head == 'Interval') {
    let open: 'both' | 'left' | 'right' | undefined = undefined;
    const arg1 = getArg(expr, 1);
    const arg2 = getArg(expr, 2);
    let min: number | null = null;
    let max: number | null = null;
    if (getFunctionName(arg1) === 'Open') {
      open = 'left';
      min = asNumber(getArg(arg1, 1));
    } else {
      min = asNumber(arg1);
    }
    if (getFunctionName(getArg(expr, 2)) === 'Open') {
      open = open === undefined ? 'right' : 'both';
      max = asNumber(getArg(arg2, 1));
    } else {
      max = asNumber(arg2);
    }
    if (min === null || max === null) return null;
    return {
      min,
      max,
      open,
      domain: head === 'Range' ? 'Integer' : 'RealNumber',
    };
  }
  const val = asNumber(expr);
  if (val !== null) {
    return { min: val, max: val, domain: inferNumericDomain(val) ?? 'Number' };
  }
  return null;
}

/**
 * Check two `NumericDomainInfo` against each other
 */
export function compareNumericDomainInfo(
  lhs: NumericDomainInfo,
  op: string, // 'Equal' | 'Less' | 'LessEqual' | 'Greater' | 'GreaterEqual' | 'Element',
  rhs: NumericDomainInfo
): boolean | undefined | null {
  //
  // Is it a domain check?
  //
  if (op === 'Element') {
    // Check if element of a domain
    // lhs must be a subdomain of rhs, and lhs.min and lhs.max have to
    // be in the range of rhs
    if (!lhs.domain || !rhs.domain) return null;
    if (!isNumericSubdomain(lhs.domain, rhs.domain)) return false;

    // If there's no min/max, it's a complex number
    if (!rhs.min || !rhs.max || !lhs.min || !lhs.max) return true;

    return isValueInDomain(lhs.min, rhs)! && isValueInDomain(lhs.max, rhs)!;
  }

  if (op === 'Equal') {
    return (
      lhs.domain === rhs.domain && lhs.min === rhs.min && lhs.max == rhs.max
    );
  }

  if (op === 'Less') {
    if (!lhs.domain || !rhs.domain) return null;
    if (!lhs.min || !lhs.max || !rhs.min || !rhs.max) return null;
    if (isNumericSubdomain(lhs.domain, rhs.domain)) {
      return lhs.max < rhs.min;
    }
    return false;
  }

  if (op === 'LessEqual') {
    if (!lhs.domain || !rhs.domain) return null;
    if (!lhs.min || !lhs.max || !rhs.min || !rhs.max) return null;
    if (isNumericSubdomain(lhs.domain, rhs.domain)) {
      if (rhs.open === 'left' || rhs.open === 'both') {
        return lhs.max <= rhs.min;
      } else {
        return lhs.max < rhs.min;
      }
    }
    return false;
  }

  if (op === 'Greater') {
    if (!lhs.domain || !rhs.domain) return null;
    if (!lhs.min || !lhs.max || !rhs.min || !rhs.max) return null;
    if (isNumericSubdomain(lhs.domain, rhs.domain)) {
      return lhs.min > rhs.max;
    }
    return false;
  }

  if (op === 'GreaterEqual') {
    if (!lhs.domain || !rhs.domain) return null;
    if (!lhs.min || !lhs.max || !rhs.min || !rhs.max) return null;
    if (isNumericSubdomain(lhs.domain, rhs.domain)) {
      if (rhs.open === 'right' || rhs.open === 'both') {
        return lhs.min >= rhs.max;
      } else {
        return lhs.min > rhs.max;
      }
    }
    return false;
  }

  return null;
}

/**
 * Return true if the lhs is in the rhs (regardless of domain compatibility)
 */
function isValueInDomain(lhs: number, rhs: NumericDomainInfo): boolean | null {
  if (!rhs.min || !rhs.max) return null;

  if (rhs.open === 'both') return lhs > rhs.min && lhs < rhs.max;
  if (rhs.open === 'left') return lhs > rhs.min && lhs <= rhs.max;
  if (rhs.open === 'right') return lhs >= rhs.min && lhs < rhs.max;

  return lhs >= rhs.min && lhs <= rhs.max;
}

/** Return true if lhs is a numeric subdomain (or equal to) rhs
 */
export function isNumericSubdomain(
  lhs: Domain,
  rhs: NumericDomain
): boolean | undefined {
  return (
    {
      Number: [
        'Number',
        'ExtendedComplexNumber',
        'ExtendedRealNumber',
        'ComplexNumber',
        'ImaginaryNumber',
        'RealNumber',
        'TranscendentalNumber',
        'AlgebraicNumber',
        'RationalNumber',
        'Integer',
        'NegativeInteger',
        'NegativeNumber',
        'NonNegativeNumber',
        'NonNegativeInteger',
        'NonPositiveNumber',
        'NonPositiveInteger',
        'PositiveInteger',
        'PositiveNumber',
      ],
      ExtendedComplexNumber: [
        'Number', // Since `Number` and `ComplexNumber` are synonyms
        'ExtendedRealNumber',
        'ComplexNumber',
        'ImaginaryNumber',
        'RealNumber',
        'TranscendentalNumber',
        'AlgebraicNumber',
        'RationalNumber',
        'Integer',
        'NegativeInteger',
        'NegativeNumber',
        'NonNegativeNumber',
        'NonNegativeInteger',
        'NonPositiveNumber',
        'NonPositiveInteger',
        'PositiveInteger',
        'PositiveNumber',
      ],
      ExtendedRealNumber: [
        'ExtendedRealNumber',
        'RealNumber',
        'TranscendentalNumber',
        'AlgebraicNumber',
        'RationalNumber',
        'Integer',
        'NegativeInteger',
        'NegativeNumber',
        'NonNegativeNumber',
        'NonNegativeInteger',
        'NonPositiveNumber',
        'NonPositiveInteger',
        'PositiveInteger',
        'PositiveNumber',
      ],
      ComplexNumber: ['ComplexNumber', 'ImaginaryNumber'],
      ImaginaryNumber: ['ImaginaryNumber'],
      RealNumber: [
        'RealNumber',
        'TranscendentalNumber',
        'AlgebraicNumber',
        'RationalNumber',
        'Integer',
        'NegativeInteger',
        'NegativeNumber',
        'NonNegativeNumber',
        'NonNegativeInteger',
        'NonPositiveNumber',
        'NonPositiveInteger',
        'PositiveInteger',
        'PositiveNumber',
      ],
      TranscendentalNumber: ['TranscendentalNumber'],
      AlgebraicNumber: [
        'AlgebraicNumber',
        'RationalNumber',
        'Integer',
        'NegativeInteger',
        'NonNegativeInteger',
        'NonPositiveInteger',
        'PositiveInteger',
      ],
      RationalNumber: [
        'RationalNumber',
        'Integer',
        'NegativeInteger',
        'NonNegativeInteger',
        'NonPositiveInteger',
        'PositiveInteger',
      ],
      Integer: [
        'Integer',
        'NegativeInteger',
        'NonNegativeInteger',
        'NonPositiveInteger',
        'PositiveInteger',
      ],
      NegativeNumber: ['NegativeNumber', 'NegativeInteger'],
      NonNegativeNumber: [
        'NonNegativeNumber',
        'PositiveNumber',
        'NonNegativeInteger',
        'PositiveInteger',
      ],
      NonPositiveNumber: [
        'NonPositiveNumber',
        'NegativeNumber',
        'NegativeInteger',
      ],
      PositiveNumber: ['PositiveNumber', 'PositiveInteger'],

      NegativeInteger: ['NegativeInteger'],
      PositiveInteger: ['PositiveInteger'],
      NonNegativeInteger: ['NonNegativeInteger', 'PositiveInteger'],
      NonPositiveInteger: ['NegativeInteger'],
    }[rhs]?.includes(lhs) ?? undefined
  );
}
