import {
  getArg,
  getDecimalValue,
  getFunctionName,
  getNumberValue,
  getRationalValue,
  getSymbolName,
  getTail,
  MISSING,
} from '../../common/utils';
import { Expression } from '../../public';
import { order } from '../order';
import {
  ComputeEngine,
  Dictionary,
  Domain,
  Numeric,
  SetDefinition,
} from '../public';

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
  // Function Domains
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

  //
  // Tensor
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
// String: {
//   signatures: [
//     {
//       args: [],
//       result: 'Domain',
//       evaluate: () => 'String',
//     },
//     {
//       args: ['NaturalNumber'],
//       result: 'ParametricDomain',
//       evaluate: (_engine, min: number) => {
//         min = Math.round(min);
//         if (Number.isNaN(min)) return 'EmptySet';
//         if (min < 0) return 'EmptySet';
//         if (min === +Infinity) return 'EmptySet';
//         return ['String', min, min];
//       },
//     },
//     {
//       args: ['NaturalNumber'],
//       result: 'ParametricDomain',
//       evaluate: (_engine, min: number, max: number) => {
//         min = Math.round(min);
//         max = Math.round(max);
//         if (Number.isNaN(min) || Number.isNaN(max)) return 'EmptySet';
//         if (min < 0) return 'EmptySet';
//         if (min === +Infinity) return 'EmptySet';
//         if (min > max) return 'EmptySet';
//         if (min === 0 && max === +Infinity) return 'EmptySet';
//         return ['String', min, max];
//       },
//     },
//   ],
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
  const sets = new Set<string>();
  for (const domain of Object.keys(result)) sets.add(domain);
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
 * Check the domains of the entries in a dictionary for logical consistency
 *
 */

// export function checkDomains(dict: Dictionary): string[] {
//   const result = [];
//   for (const key of Object.keys(dict)) {
//     const entry = dict[key];
//     // Check: if function returns a MaybeBoolean (or Boolean), it's domain is "Predicate"
//     // Check: if the arguments and result are a MaybeBoolean (or Boolean), its domain is "LogicalFunction"

//     // Check strict monotonic functions always increase or stay the same (or decrease or stay the same)
//     // Check  monotonic functions always increase (or decrease) (never stay the same)
//     // Check ConstantFunction always return the same value
//   }

//   return result;
// }

/**
 * Simplify the domain (reduce it to its simplest form).
 *
 * Note: compare with `internalDomain()` which calculate the domain of an expression.
 *
 */
export function simplifyDomain(dom: Domain): Domain {
  const name = getFunctionName(dom);
  if (name === 'Union') {
    let [rangeMin, rangeMax] = [+Infinity, -Infinity];
    // let [intervalMin, intervalMax, intervalOpen] = [
    //   +Infinity,
    //   -Infinity,
    //   undefined,
    // ];
    const others: Domain[] = [];
    for (const arg of getTail(dom)) {
      const [min, max] = domainAsRange(arg);
      if (min !== null && max !== null) {
        rangeMin = Math.max(rangeMin, min);
        rangeMax = Math.max(rangeMax, max);
      }
      others.push(arg);
    }
  } else if (name === 'Intersection') {
  } else if (name === 'Set') {
  } else if (name === 'SetMinus') {
    const arg1 = simplifyDomain(getArg(dom, 1) ?? MISSING);
    const arg2 = simplifyDomain(getArg(dom, 1) ?? MISSING);
    return [name, arg1, arg2];
  } else if (name === 'Complement') {
    const arg1 = simplifyDomain(getArg(dom, 1) ?? MISSING);
    const arg2 = simplifyDomain(getArg(dom, 1) ?? MISSING);
    return [name, arg1, arg2];
  } else if (name === 'Range') {
    // Subset of `Integer`
    const min = getNumberValue(getArg(dom, 1) ?? MISSING);
    const max = getNumberValue(getArg(dom, 2) ?? MISSING);

    if (min === -Infinity && max == Infinity) return 'Integer';
    return dom;
  } else if (name === 'Interval') {
    // Subset of RealNumber
    const min = getNumberValue(getArg(dom, 1) ?? MISSING);
    const max = getNumberValue(getArg(dom, 2) ?? MISSING);
    if (min === -Infinity && max == Infinity) return 'RealNumber';
    return dom;
  } else if (name === 'Multiple') {
  }
  // @todo? `SymmetricDifference`

  const sym = getSymbolName(dom);
  if (sym === 'EmptySet') {
  }

  return dom;
}

function domainAsRange(dom: Domain): [min: number | null, max: number | null] {
  // @todo!
  return [null, null];
}

function domainAsInterval(
  dom: Domain
): [min: number | null, max: number | null, open?: 'left' | 'right' | 'both'] {
  if (getFunctionName(dom) !== 'Interval') return [null, null];
  let openLeft = false;
  let openRight = false;
  let min = getArg(dom, 1);
  let max = getArg(dom, 2);
  if (getFunctionName(min) === 'Open') {
    openLeft = true;
    min = getArg(min, 1);
  }
  min = getNumberValue(min);
  if (min === null) return [null, null];

  if (getFunctionName(max) === 'Open') {
    openRight = true;
    max = getArg(max, 1);
  }
  max = getNumberValue(max);
  if (max === null) return [null, null];
  return [
    min,
    max,
    openLeft && openRight
      ? 'both'
      : openLeft
      ? 'left'
      : openRight
      ? 'right'
      : undefined,
  ];
}

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
