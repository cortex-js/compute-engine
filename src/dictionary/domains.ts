import { Dictionary, Expression, SetDefinition } from '../public';

// Other domains to consider:
// - p-adic
// - SERIE power series (finite Laurent series)
// DOMAIN_RULE // a pattern and an expression
// DOMAIN_ARRAY
// DOMAIN_DICTIONARY
//  * - "table"        JS object literal, key (string)/ value (any) pairs

// See also sympy 'assumptions'
// https://docs.sympy.org/latest/modules/core.html#module-sympy.core.assumptions

//  * - "N"           Q28920044 Natural numbers (positive integers): 1, 2, 3, 4, ...
//  * - "Z*"          Non-Zero integers: -2, -1, 1, 2, 3, ...
//  * - "R-":         Q200227 Negative real number <0
//  * - "R+"          Q3176558 Positive real numbers (JS float) >0
//  * - "R0-":        Q47341108 Non-positive real number <= 0
//  * - "R0+"         Q13896108 Non-negative real numbers (JS float) >=0
//  * - "R"           Real numbers (JS float)

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
  List: 'Collection',
  Sequence: 'Collection',
  Tuple: 'Collection',
  Set: 'Collection',
  FiniteSet: 'Set',
  InfiniteSet: 'Set',
  // https://en.wikipedia.org/wiki/Category_of_sets
  EmptySet: 'FiniteSet',
  String: 'Expression',
  Symbol: 'String',
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
  Number: 'Set', // Careful: not all Number sets are infinite, i.e. NumberZero
  ImaginaryNumber: ['ComplexNumber', 'InfiniteSet'],
  ComplexNumber: 'ExtendedComplexNumber',
  ExtendedComplexNumber: 'Number',
  ComplexInfinity: 'ExtendedComplexNumber',
  NumberZero: ['CompositeNumber', 'ImaginaryNumber', 'FiniteSet'],
  NaturalNumber: 'Integer',
  CompositeNumber: 'NaturalNumber',
  PrimeNumber: 'NaturalNumber',
  Integer: ['RationalNumber', 'ExtendedInteger'],
  ExtendedInteger: 'ExtendedRationalNumber',
  RationalNumber: ['AlgebraicNumber', 'ExtendedRationalNumber'],
  IrrationalNumber: 'RealNumber',
  TranscendentalNumber: ['IrrationalNumber', 'ImaginaryNumber'],
  AlgebraicNumber: 'IrrationalNumber',
  RealNumber: ['ComplexNumber', 'ExtendedRealNumber'],
  ExtendedRealNumber: 'ExtendedComplexNumber',
  ExtendedNaturalNumber: 'ExtendedInteger',
  ExtendedRationalNumber: 'ExtendedRealNumber',
  SignedInfinity: 'ExtendedNaturalNumber',
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
  PermutationMatrix: ['MonomialMatrix', 'LogicalTensor'],
  DiagonalMatrix: ['UpperTriangularMatrix', 'LowerTriangularMatrix'],
  IdentityMatrix: ['DiagonalMatrix', 'SymmetricMatrix', 'PermutationMatrix'],
  ZeroMatrix: ['DiagonalMatrix', 'SymmetricMatrix', 'PermutationMatrix'],
  SymmetricMatrix: ['HermitianMatrix', 'SquareMatrix', 'RealTensor'],
  HermitianMatrix: 'ComplexTensor',
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
  NaturalNumber: ['Union', 'CompositeNumber', 'PrimeNumber'],
  Scalar: ['Intersection', 'Row', 'Column'],
  TriangularMatrix: ['Union', 'UpperTriangularMatrix', 'LowerTriangularMatrix'],
  Vector: ['Union', 'Row', 'Column'],
};

const PARAMETRIC_DOMAIN = {
  String: {
    signatures: [
      {
        args: [],
        result: 'Domain',
        evaluate: () => 'String',
      },
      {
        args: ['NaturalNumber'],
        result: 'ParametricDomain',
        evaluate: (_engine, min: number) => {
          min = Math.round(min);
          if (Number.isNaN(min)) return 'EmptySet';
          if (min < 0) return 'EmptySet';
          if (min === +Infinity) return 'EmptySet';
          return ['String', min, min];
        },
      },
      {
        args: ['NaturalNumber'],
        result: 'ParametricDomain',
        evaluate: (_engine, min: number, max: number) => {
          min = Math.round(min);
          max = Math.round(max);
          if (Number.isNaN(min) || Number.isNaN(max)) return 'EmptySet';
          if (min < 0) return 'EmptySet';
          if (min === +Infinity) return 'EmptySet';
          if (min > max) return 'EmptySet';
          if (min === 0 && max === +Infinity) return 'EmptySet';
          return ['String', min, max];
        },
      },
    ],
  },
};

export function getDomainsDictionary(): Dictionary {
  const result: {
    [name: string]: SetDefinition;
  } = { Nothing: { supersets: [], domain: 'Domain' } };
  for (const domain of Object.keys(DOMAIN_PARENT)) {
    const parents = Array.isArray(DOMAIN_PARENT[domain])
      ? DOMAIN_PARENT[domain]
      : [DOMAIN_PARENT[domain]];

    result[domain] = PARAMETRIC_DOMAIN[domain] ?? {};

    result[domain] = {
      domain: PARAMETRIC_DOMAIN[domain] ? 'ParametricDomain' : 'Domain',
      wikidata: DOMAIN_WIKIDATA[domain],
      supersets: parents,
      value: DOMAIN_VALUE,
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
      const parent = parents.pop();
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
