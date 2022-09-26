import { DomainLiteral } from '../public';

export const DOMAIN_CONSTRUCTORS = [
  'Error',

  'Dictionary',
  'Function',
  'List',
  'Tuple',

  'Intersection',
  'Union',

  'Maybe',
  'Sequence',

  'Interval',
  'Range',

  'Head',
  'Symbol',
  'Value',
];

export const DOMAIN_ALIAS = {
  // Function: ['Function', ['Sequence', 'Anything'], 'Anything'],
  NumericFunction: ['Function', ['Sequence', 'Number'], 'Number'],
  RealFunction: [
    'Function',
    ['Sequence', 'ExtendedRealNumber'],
    'ExtendedRealNumber',
  ],
  TrigonometricFunction: ['Function', 'Number', 'Number'],
  // HyperbolicFunction: ['Function', 'Number', 'Number'],
  LogicOperator: [
    'Function',
    'MaybeBoolean',
    ['Maybe', 'MaybeBoolean'],
    'MaybeBoolean',
  ],
  Predicate: ['Function', ['Sequence', 'Anything'], 'MaybeBoolean'],
  RelationalOperator: ['Function', 'Anything', 'Anything', 'MaybeBoolean'],
  // PositiveInteger: ['Range', 1, +Infinity],
  // NonNegativeInteger: ['Range', 0, +Infinity],
  // NegativeInteger: ['Range', -Infinity, -1],
  // NonPositiveInteger: ['Range', -Infinity, 0],
  // PositiveNumber: ['Interval', ['Open', 0], +Infinity],
  // NonNegativeNumber: ['Interval', 0, +Infinity],
  // NegativeNumber: ['Interval', -Infinity, ['Open', 0]],
  // NonPositiveNumber: ['Interval', -Infinity, 0],
};

// export const NUMERIC_DOMAIN_INFO: { [name: string]: NumericDomainInfo } = {
//   Number: { domain: 'ExtendedComplexNumber' },
//   ExtendedComplexNumber: { domain: 'ExtendedComplexNumber' },
//   ExtendedRealNumber: {
//     domain: 'ExtendedRealNumber',
//     min: -Infinity,
//     max: +Infinity,
//   },
//   ComplexNumber: { domain: 'ComplexNumber' },
//   ImaginaryNumber: {
//     domain: 'ImaginaryNumber',
//     min: -Infinity,
//     max: +Infinity,
//   },
//   RealNumber: { domain: 'RealNumber', min: -Infinity, max: +Infinity },
//   TranscendentalNumber: {
//     domain: 'TranscendentalNumber',
//     min: -Infinity,
//     max: +Infinity,
//   },
//   AlgebraicNumber: {
//     domain: 'AlgebraicNumber',
//     min: -Infinity,
//     max: +Infinity,
//   },
//   RationalNumber: { domain: 'RationalNumber', min: -Infinity, max: +Infinity },
//   Integer: { domain: 'Integer', min: -Infinity, max: +Infinity },
//   NegativeInteger: { domain: 'Integer', min: -Infinity, max: -1 },
//   NegativeNumber: {
//     domain: 'RealNumber',
//     min: -Infinity,
//     max: 0,
//     open: 'right',
//   },
//   NonNegativeNumber: { domain: 'RealNumber', min: 0, max: +Infinity },
//   NonNegativeInteger: { domain: 'Integer', min: 0, max: +Infinity },
//   NonPositiveNumber: {
//     domain: 'RealNumber',
//     min: -Infinity,
//     max: 0,
//   },
//   NonPositiveInteger: { domain: 'Integer', min: -Infinity, max: 0 },
//   PositiveInteger: { domain: 'Integer', min: 1, max: +Infinity },
//   PositiveNumber: {
//     domain: 'RealNumber',
//     min: 0,
//     max: +Infinity,
//     open: 'left',
//   },
// };

// See also sympy 'assumptions'
// https://docs.sympy.org/latest/modules/core.html#module-sympy.core.assumptions

/**
 * The set of domains form a lattice with 'Anything' at the top and 'Void'
 * at the bottom.
 *
 * This table represents this lattice by indicating the immediate parents of
 * each domain literal.
 */

const DOMAIN_LITERAL = {
  Anything: [],

  Value: 'Anything',
  Domain: 'Anything',
  DomainExpression: 'Domain',

  Void: 'Nothing',
  Nothing: [
    'DomainExpression',
    'Boolean',
    'String',
    'Symbol',
    'Tuple',
    'List',
    'Dictionary',
    'InfiniteSet',
    'FiniteSet',
    'ImaginaryNumber',
    'TranscendentalNumber',
    'PositiveInteger',
    'NegativeInteger',
    'NonPositiveInteger',
    'NonNegativeInteger',
    'PositiveNumber',
    'NegativeNumber',
    'NonPositiveNumber',
    'NonNegativeNumber',
    'Scalar',
    'TrigonometricFunction',
    'LogicOperator',
    'RelationalOperator',
  ],

  MaybeBoolean: 'Value',
  Boolean: 'MaybeBoolean',
  String: 'Boolean',
  Symbol: 'Boolean',

  Collection: 'Value',
  List: 'Collection',
  Dictionary: 'Collection',
  Sequence: 'Collection',
  Tuple: 'Sequence',
  Set: 'Collection',
  InfiniteSet: 'Set',
  FiniteSet: 'Set',

  //
  // Functional Domains
  //
  Function: 'Anything',
  Predicate: 'Function',
  LogicOperator: 'Predicate',
  RelationalOperator: 'Predicate',
  // https://en.wikipedia.org/wiki/List_of_mathematical_functions

  NumericFunction: 'Function',
  RealFunction: 'NumericFunction',
  TrigonometricFunction: 'RealFunction',

  //
  // Numeric Domains
  //
  // https://en.wikipedia.org/wiki/Category_of_sets
  Number: 'Value',
  ExtendedComplexNumber: 'Number',
  ComplexNumber: 'ExtendedComplexNumber',
  ImaginaryNumber: 'ComplexNumber',
  ExtendedRealNumber: 'ExtendedComplexNumber',
  RealNumber: ['ComplexNumber', 'ExtendedRealNumber'],

  PositiveNumber: 'NonNegativeNumber',
  NonNegativeNumber: 'RealNumber',
  NonPositiveNumber: 'NegativeNumber',
  NegativeNumber: 'RealNumber',

  TranscendentalNumber: 'RealNumber',

  AlgebraicNumber: 'RealNumber',
  RationalNumber: 'AlgebraicNumber',

  // NaturalNumber: 'Integer',
  Integer: 'RationalNumber',

  PositiveInteger: 'NonNegativeInteger',
  NonNegativeInteger: 'Integer',
  NonPositiveInteger: 'NegativeInteger',
  NegativeInteger: 'Integer',

  //
  // Tensorial Domains
  //
  Tensor: 'Value',
  Matrix: 'Tensor',
  Scalar: ['Row', 'Column'],
  Row: 'Vector',
  Column: 'Vector',
  Vector: 'Matrix',

  // https://en.wikipedia.org/wiki/List_of_named_matrices
  // ComplexTensor: 'Tensor',
  // RealTensor: 'ComplexTensor',
  // IntegerTensor: 'RealTensor',
  // LogicalTensor: 'IntegerTensor',
  // SquareMatrix: 'Matrix',
  // MonomialMatrix: 'SquareMatrix',
  // TriangularMatrix: 'SquareMatrix',
  // UpperTriangularMatrix: 'TriangularMatrix',
  // LowerTriangularMatrix: 'TriangularMatrix',
  // PermutationMatrix: ['MonomialMatrix', 'LogicalTensor', 'OrthogonalMatrix'],
  // OrthogonalMatrix: ['SquareMatrix', 'RealTensor'],
  // DiagonalMatrix: ['UpperTriangularMatrix', 'LowerTriangularMatrix'],
  // IdentityMatrix: ['DiagonalMatrix', 'SymmetricMatrix', 'PermutationMatrix'],
  // ZeroMatrix: ['DiagonalMatrix', 'SymmetricMatrix', 'PermutationMatrix'],
  // SymmetricMatrix: ['HermitianMatrix', 'SquareMatrix', 'RealTensor'],
  // HermitianMatrix: 'ComplexTensor',
  // Quaternion: ['SquareMatrix', 'ComplexTensor'],
};

let gDomainLiterals: { [domain: string]: Set<string> };

export function isDomainLiteral(s: string | null): s is DomainLiteral {
  if (!s) return false;

  return DOMAIN_LITERAL[s] !== undefined;
}

export function isSubdomainLiteral(lhs: string, rhs: string): boolean {
  if (!gDomainLiterals) {
    gDomainLiterals = {};
    ancestors('Void');
  }

  return gDomainLiterals[lhs].has(rhs);
}

/** Return all the domain literals that are an ancestor of `dom`
 */
export function ancestors(dom: string): string[] {
  // Build the domain lattice if necessary, by calculating all the ancestors of
  // `Void` (the bottom domain)
  if (!gDomainLiterals) {
    gDomainLiterals = {};
    ancestors('Void');
  }

  if (gDomainLiterals[dom]) return Array.from(gDomainLiterals[dom]);

  let result: string[] = [];
  if (typeof dom !== 'string' || !DOMAIN_LITERAL[dom]) {
    // Not a domain literal, it should be a constructor
    if (!Array.isArray(dom)) throw Error(`Unknown domain literal ${dom}`);
    if (!DOMAIN_CONSTRUCTORS.includes(dom[0]))
      throw Error(`Unknown domain constructor ${dom[0]}`);
    if (dom[0] === 'Function' || dom[0] === 'Head')
      return ancestors('Function');
    if (dom[0] === 'Symbol') return ancestors('Symbol');
    if (dom[0] === 'Tuple') return ancestors('Tuple');
    if (dom[0] === 'List') return ancestors('List');
    if (dom[0] === 'Dictionary') return ancestors('Dictionary');
    if (dom[0] === 'Range') return ancestors('Integer');
    if (dom[0] === 'Interval') return ancestors('RealNumberExtended');
    if (dom[0] === 'Maybe' || dom[0] === 'Sequence') return ancestors(dom[1]);

    if (dom[0] === 'Literal') return ['Anything']; // @todo could do better
    if (dom[0] === 'Union') return ['Anything']; // @todo could do better
    if (dom[0] === 'Intersection') return ['Anything']; // @todo could do better
    return ['Anything'];
  }

  if (typeof DOMAIN_LITERAL[dom] === 'string')
    result = [DOMAIN_LITERAL[dom], ...ancestors(DOMAIN_LITERAL[dom])];
  else if (Array.isArray(DOMAIN_LITERAL[dom]))
    for (const parent of DOMAIN_LITERAL[dom]) {
      result.push(parent);
      result.push(...ancestors(parent));
    }

  gDomainLiterals[dom] = new Set(result);
  return result;
}

// /** Return all the domain literals that are an ancestor of `dom`
//  */
// function ancestors(dom: DomainExpression): string[] {
//   if (typeof dom === 'string' && gDomainLiterals[dom])
//     return Array.from(gDomainLiterals[dom]);

//   let result: string[] = [];
//   if (typeof dom !== 'string' || !DOMAIN_LITERAL[dom]) {
//     // Not a domain literal, it should be a constructor
//     if (!Array.isArray(dom)) throw Error(`Unknown domain literal ${dom}`);
//     if (!DOMAIN_CONSTRUCTORS.includes(dom[0]))
//       throw Error(`Unknown domain constructor ${dom[0]}`);
//     if (dom[0] === 'Function' || dom[0] === 'Head')
//       return ancestors('Function');
//     if (dom[0] === 'Symbol') return ancestors('Symbol');
//     if (dom[0] === 'Tuple') return ancestors('Tuple');
//     if (dom[0] === 'List') return ancestors('List');
//     if (dom[0] === 'Dictionary') return ancestors('Dictionary');
//     if (dom[0] === 'Range') return ancestors('Integer');
//     if (dom[0] === 'Interval') return ancestors('RealNumberExtended');
//     if (dom[0] === 'Optional' || dom[0] === 'Some') return ancestors(dom[1]);

//     if (dom[0] === 'Literal') return ['Anything']; // @todo could do better
//     if (dom[0] === 'Union') return ['Anything']; // @todo could do better
//     if (dom[0] === 'Intersection') return ['Anything']; // @todo could do better
//     return ['Anything'];
//   }

//   if (typeof DOMAIN_LITERAL[dom] === 'string')
//     result = [DOMAIN_LITERAL[dom], ...ancestors(DOMAIN_LITERAL[dom])];
//   else if (Array.isArray(DOMAIN_LITERAL[dom]))
//     for (const parent of DOMAIN_LITERAL[dom]) {
//       result.push(parent);
//       result.push(...ancestors(parent));
//     }

//   gDomainLiterals[dom] = new Set(result);
//   return result;
// }

// /** Return the domain that is shared by both `a` and `b` */
// export function sharedAncestorDomain(
//   a: DomainExpression,
//   b: DomainExpression
// ): DomainExpression {
//   const aAncestors = ancestors(a);
//   const bAncestors = ancestors(b);

//   while (!includesDomain(bAncestors, aAncestors[0])) aAncestors.shift();

//   return aAncestors[0];
// }

// function includesDomain(xs: string[], y: string): boolean {
//   for (const x of xs) if (isSameDomain(x, y)) return true;
//   return false;
// }

// function isSameDomain(a: DomainExpression, b: DomainExpression): boolean {
//   if (typeof a === 'string' && typeof b === 'string' && a === b) return true;
//   if (typeof a === 'string' || typeof b === 'string') return false;

//   // Two domain expressions...
//   if (a.length !== b.length) return false;

//   const ctor = a[0];
//   if (b[0] !== ctor) return false;
//   if (DOMAIN_EXPRESSION_CONSTRUCTORS.includes(ctor)) {
//     return a.every((x, i) => isEqual(x, b[i] as Expression));
//   }

//   return a.every((x, i) =>
//     isSameDomain(x as DomainExpression, b[i] as DomainExpression)
//   );
// }

// export function isSubdomainOf(
//   lhs: DomainExpression,
//   rhs: DomainExpression
// ): boolean {
//   // Build the domain lattice if necessary, by calculating all the ancestors of
//   // `Void` (the bottom domain)
//   if (!gDomainLiterals) {
//     gDomainLiterals = {};
//     ancestors('Void');
//   }

//   //
//   // 1/ Compare two domain literals
//   //
//   if (typeof rhs === 'string' && typeof lhs === 'string') {
//     if (!gDomainLiterals[rhs])
//       throw Error('Expected a domain literal, got ' + rhs);
//     if (!gDomainLiterals[lhs])
//       throw Error('Expected a domain literal, got ' + lhs);

//     if (lhs === rhs) return true;
//     if (gDomainLiterals[lhs].has(rhs)) return true;
//     return false;
//   }

//   //
//   // 2/ Compare a rhs domain literal to a domain expression
//   //
//   if (typeof rhs === 'string') {
//     if (!gDomainLiterals[rhs])
//       throw Error('Expected a domain literal, got ' + rhs);
//     const lhsConstructor = lhs[0];
//     if (!DOMAIN_CONSTRUCTORS.includes(lhsConstructor))
//       throw Error('Expected domain constructor, got ' + lhsConstructor);
//     if (lhsConstructor === 'Function') {
//       return rhs === 'Function';
//       // @todo
//     }
//     // @todo handle domain constructors
//     // 'Union',
//     // 'List',
//     // 'Record',
//     // 'Tuple',
//     // 'Intersection',
//     // 'Range',
//     // 'Interval',
//     // 'Optional',
//     // 'Some',
//     // 'Head',
//     // 'Symbol',
//     // 'Literal',
//     return true;
//   }

//   //
//   // 3/ Compare a rhs domain expression with a domain literal or expression
//   //
//   const rhsConstructor = rhs[0];
//   if (!DOMAIN_CONSTRUCTORS.includes(rhsConstructor))
//     throw Error('Expected domain constructor, got ' + rhsConstructor);

//   if (rhsConstructor === 'Function') {
//     // True if LHS is a function, or an alias to a function
//     if (typeof lhs === 'string') {
//       if (lhs === 'Function') return true;
//       lhs = DOMAIN_ALIAS[lhs];
//       if (!lhs) return false;
//     }
//     if (lhs[0] !== 'Function') return false;

//     // Both constructors are 'Function':
//     // Check that the arguments and return values are compatible
//     // Parameters should be contravariant, return values should be covariant
//     if (!isSubdomainOf(rhs[rhs.length - 1], lhs[lhs.length - 1])) return false;
//     for (let i = 1; i < rhs.length - 1; i++) {
//       if (Array.isArray(rhs[i])) {
//         const ctor = rhs[i][0];
//         if (ctor === 'Optional') {
//           if (lhs[i] && !isSubdomainOf(lhs[i], rhs[i][1] as DomainExpression))
//             return false;
//           if (!lhs[i] && lhs.length - 1 === i) return true;
//         } else if (ctor === 'Some') {
//           const param = rhs[i][1];
//           if (!lhs[i] && lhs.length - 1 === i) return true;
//           do {
//             if (!isSubdomainOf(lhs[i], param as DomainExpression)) return false;
//             i += 1;
//           } while (i < lhs.length - 1);
//           return true;
//         } else if (!lhs[i] || !isSubdomainOf(lhs[i], rhs[i])) return false;
//       } else if (!lhs[i] || !isSubdomainOf(lhs[i], rhs[i])) return false;
//     }
//     return true;
//   }
//   // @todo handle domain constructors
//   // 'Function',
//   // 'Union',
//   // 'List',
//   // 'Record',
//   // 'Tuple',
//   // 'Intersection',
//   // 'Range',
//   // 'Interval',
//   // 'Optional',
//   // 'Some',
//   // 'Head',
//   // 'Symbol',
//   // 'Literal',

//   return false;
// }

// const DOMAIN_WIKIDATA: { [domain: string]: string } = {
//   // set of numbers: Q3054943, number: Q11563
//   Function: 'Q11348', // entry for 'function', not 'set of functions'
//   ComplexNumber: 'Q26851286',
//   RealNumber: 'Q26851380',
//   RationalNumber: 'Q1244890',
//   Integer: 'Q47007735', // ZZ ...-3, -2, -1, 0, 1, 2, 3, 4, ...
//   ImaginaryNumber: 'Q47310259', // Numbers on the imaginary line // Q9165172
//   // NaturalNumber: 'Q28920052', //  0, 1, 2, 3...
// };

// const DOMAIN_VALUE: { [domain: string]: Expression } = {
//   MaybeBoolean: ['Union', 'Boolean', ['Set', 'Maybe']],
//   Scalar: ['Intersection', 'Row', 'Column'],
//   TriangularMatrix: ['Union', 'UpperTriangularMatrix', 'LowerTriangularMatrix'],
//   Vector: ['Union', 'Row', 'Column'],
// };

// const DOMAIN_COUNT = {
//   Boolean: 2,
//   MaybeBoolean: 3,
//   EmptySet: 0,
//   IdentityMatrix: 1,
//   ZeroMatrix: 1,
// };

// const DOMAIN_INFO: Dictionary = {
//   functions: [
//     {
//       // Integer, withing a min..max range
//       name: 'Range',
//       domain: 'Domain',
//       // evaluate: ( min: number, max: number) => {
//       //   min = Math.round(min);
//       //   max = Math.round(max);
//       //   if (Number.isNaN(min) || Number.isNaN(max)) return 'EmptySet';
//       //   if (min > max) return 'EmptySet';
//       //   if (min === -Infinity && max === +Infinity) return 'Integer';
//       //   if (min === 0 && max === +Infinity) return 'NaturalNumber';
//       //   return ['Range', min, max];
//       // },
//       // isElementOf: () => {}
//     },

//     {
//       // Interval, can be open, closed, open/close or close/open
//       name: 'Interval',
//       domain: 'Domain',
//       // @todo!! this should be simplify()
//       // evaluate: (min: number, max: number) => {
//       //   if (Number.isNaN(min) || Number.isNaN(max)) return 'EmptySet';
//       //   if (min > max) return 'EmptySet';
//       //   if (min === -Infinity && max === +Infinity) {
//       //     return 'RealNumber';
//       //   }
//       //   return ['Interval', min, max];
//       // },
//       // isSubsetOf: (expr: BoxedExpression) =>
//       //   isNumericSubset(expr, 'ImaginaryNumber'),

//       // @todo!! this should have a lhs (an expr) and a rhs (the interval)
//       // then call NumericDomainInfo to ascertain
//       // isElementOf: (
//       //   expr: BoxedExpression,
//       //   min: BoxedExpression,
//       //   max: BoxedExpression
//       // ) => {
//       //   let openLeft = false;
//       //   let openRight = false;
//       //   if (min.head === 'Open') {
//       //     openLeft = true;
//       //     min = min.op(1);
//       //   }
//       //   min = min.numericValue;
//       //   if (min === null) return undefined;

//       //   if (max.head === 'Open') {
//       //     openRight = true;
//       //     max = max.op(1);
//       //   }
//       //   max = max.numericValue;
//       //   if (max === null) return undefined;

//       //   //
//       //   // Compare a number
//       //   //
//       //   const val = expr.numericValue;
//       //   if (val !== null) {
//       //     if (openLeft) {
//       //       if (val < min) return false;
//       //     } else {
//       //       if (val <= min) return false;
//       //     }
//       //     if (openRight) {
//       //       if (val > max) return false;
//       //     } else {
//       //       if (val >= max) return false;
//       //     }

//       //     return true;
//       //   }

//       //   //
//       //   // Compare a decimal
//       //   //
//       //   const d = getDecimalValue(expr);
//       //   if (d !== null) {
//       //     if (openLeft) {
//       //       if (d.lt(min)) return false;
//       //     } else {
//       //       if (d.lte(min)) return false;
//       //     }
//       //     if (openRight) {
//       //       if (d.gt(max)) return false;
//       //     } else {
//       //       if (d.gte(max)) return false;
//       //     }
//       //     return true;
//       //   }

//       //   //
//       //   // Complex numbers are not ordered, so return undefined as well.
//       //   //

//       //   return undefined;
//       // },
//     },
//   ],
// };

// ImaginaryNumber: {
//   isSubsetOf: (expr: BoxedExpression) =>
//     isNumericSubset(expr, 'ImaginaryNumber'),
//   isElementOf: (expr: BoxedExpression) =>
//     isNumericElement(expr, 'ImaginaryNumber'),
// },
// ComplexNumber: {
//   isSubsetOf: (expr: BoxedExpression) =>
//     isNumericSubset(expr, 'ImaginaryNumber'),

//   isElementOf: (expr: BoxedExpression) =>
//     isNumericElement(expr, 'ImaginaryNumber'),
// },
// ExtendedComplexNumber: {
//   isSubsetOf: (expr: BoxedExpression) =>
//     isNumericSubset(expr, 'ImaginaryNumber'),
//   isElementOf: (expr: BoxedExpression) =>
//     isNumericElement(expr, 'ImaginaryNumber'),
// },
// NaturalNumber: {
//   isSubsetOf: (expr: BoxedExpression) =>
//     isNumericSubset(expr, 'ImaginaryNumber'),
//   isElementOf: (expr: BoxedExpression) =>
//     isNumericElement(expr, 'ImaginaryNumber'),
// },
// Integer: {
//   isSubsetOf: (expr: BoxedExpression) =>
//     isNumericSubset(expr, 'ImaginaryNumber'),
//   isElementOf: (expr: BoxedExpression) =>
//     isNumericElement(expr, 'ImaginaryNumber'),
// },
// RationalNumber: {
//   isSubsetOf: (expr: BoxedExpression) =>
//     isNumericSubset(expr, 'ImaginaryNumber'),
//   isElementOf: (expr: BoxedExpression) =>
//     isNumericElement(expr, 'ImaginaryNumber'),
// },
// TranscendentalNumber: {
//   isSubsetOf: (expr: BoxedExpression) =>
//     isNumericSubset(expr, 'ImaginaryNumber'),
//   isElementOf: (expr: BoxedExpression) =>
//     isNumericElement(expr, 'ImaginaryNumber'),
// },
// AlgebraicNumber: {
//   isSubsetOf: (expr: BoxedExpression) =>
//     isNumericSubset(expr, 'ImaginaryNumber'),
//   isElementOf: (expr: BoxedExpression) =>
//     isNumericElement(expr, 'ImaginaryNumber'),
// },
// RealNumber: {
//   isSubsetOf: (expr: BoxedExpression) =>
//     isNumericSubset(expr, 'ImaginaryNumber'),
//   isElementOf: (expr: BoxedExpression) =>
//     isNumericElement(expr, 'ImaginaryNumber'),
// },
// ExtendedRealNumber: {
//   isSubsetOf: (expr: BoxedExpression) =>
//     isNumericSubset(expr, 'ImaginaryNumber'),
//   isElementOf: (expr: BoxedExpression) =>
//     isNumericElement(expr, 'ImaginaryNumber'),
// },

// export function getDomainsDictionary(): Dictionary {
//   const result: {
//     [name: string]: SetDefinition;
//   } = { Nothing: { supersets: [], domain: 'Domain' } };
//   for (const domain of Object.keys(DOMAIN_PARENT)) {
//     const parents = Array.isArray(DOMAIN_PARENT[domain])
//       ? DOMAIN_PARENT[domain]
//       : [DOMAIN_PARENT[domain]];

//     result[domain] = DOMAIN_INFO[domain] ?? {};

//     result[domain] = {
//       domain: DOMAIN_INFO[domain] ?? 'Domain',
//       wikidata: DOMAIN_WIKIDATA[domain],
//       supersets: parents,
//       value: DOMAIN_VALUE,
//       countable: DOMAIN_COUNT[domain] !== undefined,
//       size: () => DOMAIN_COUNT[domain],
//       ...(result[domain] as any),
//     };

//     for (const parent of parents) {
//       if (parent !== 'Anything' && !DOMAIN_PARENT[parent]) {
//         throw new Error(`Unknown parent of domain "${domain}": "${parent}"`);
//       }
//     }
//   }

//   // Add all the supersets of Nothing: all the sets that are not the parent of anyone
//   const sets = new Set<Domain>();
//   for (const domain of Object.keys(result)) sets.add(domain as Domain);
//   for (const domain of Object.keys(result)) {
//     for (const parent of result[domain].supersets) sets.delete(parent);
//   }
//   sets.delete('Nothing');
//   result['Nothing'].supersets = [...sets.values()];

//   // for (const domain of Object.keys(result)) {
//   //   for (const parent of result[domain].supersets) {
//   //     for (const candidate of result[domain].supersets) {
//   //       if (candidate !== parent && isSubdomainOf(result, candidate, parent)) {
//   //         throw new Error(
//   //           `In domain ${domain}, the parent ${candidate} is redundant with ${parent}`
//   //         );
//   //       }
//   //     }
//   //   }
//   // }

//   for (const domain of Object.keys(result)) {
//     let found = false;
//     let count = 0;
//     let parents: string[] = [domain];
//     while (count < 512 && !found) {
//       const parent = parents.pop()!;
//       found = parent === 'Anything';
//       if (!found) parents = [...parent, ...result[parent].supersets];
//       count++;
//     }
//     if (!found) {
//       throw new Error(`The "${domain}" domain cannot reach "Anything"`);
//     }
//   }
//   return result;
// }

// /**
//  * Return a canonical representation of a domain.
//  *
//  * Convert Range/Interval to constants
//  */
// // export function canonicalDomain(
// //   ce: ComputeEngineInterface,
// //   dom: BoxedExpression
// // ): BoxedExpression {
// //   // @todo: same as commutative functions
// //   const name = dom.head;
// //   if (name === 'Union' || name === 'Intersection') {
// //     // If a Union or Intersection sort the arguments...
// //     return ce.boxFunction(name, [...[...dom.tail!].sort(order)]);
// //   } else if (name === 'SetMinus' || name === 'Complement') {
// //     const op1 = dom.op(1);
// //     const op2 = dom.op(2);
// //     if (!op1 || !op2) return dom;
// //     return ce.boxFunction(name, [op1, op2]);
// //   }

// //   return dom;
// // }

// /**
//  * Check two `NumericDomainInfo` against each other
//  */
// export function compareNumericDomainInfo(
//   lhs: NumericDomainInfo,
//   op: string, // 'Equal' | 'Less' | 'LessEqual' | 'Greater' | 'GreaterEqual' | 'Element',
//   rhs: NumericDomainInfo
// ): boolean | undefined | null {
//   //
//   // Is it a domain check?
//   //
//   if (op === 'Element') {
//     // Check if element of a domain
//     // lhs must be a subdomain of rhs, and lhs.min and lhs.max have to
//     // be in the range of rhs
//     if (!lhs.domain || !rhs.domain) return null;
//     if (!isNumericSubdomain(lhs.domain, rhs.domain)) return false;

//     // If there's no min/max, it's a complex number
//     if (!rhs.min || !rhs.max || !lhs.min || !lhs.max) return true;

//     return isValueInDomain(lhs.min, rhs)! && isValueInDomain(lhs.max, rhs)!;
//   }

//   if (op === 'Equal') {
//     return (
//       lhs.domain === rhs.domain && lhs.min === rhs.min && lhs.max == rhs.max
//     );
//   }

//   if (op === 'Less') {
//     if (!lhs.domain || !rhs.domain) return null;
//     if (!lhs.min || !lhs.max || !rhs.min || !rhs.max) return null;
//     if (isNumericSubdomain(lhs.domain, rhs.domain)) {
//       return lhs.max < rhs.min;
//     }
//     return false;
//   }

//   if (op === 'LessEqual') {
//     if (!lhs.domain || !rhs.domain) return null;
//     if (!lhs.min || !lhs.max || !rhs.min || !rhs.max) return null;
//     if (isNumericSubdomain(lhs.domain, rhs.domain)) {
//       if (rhs.open === 'left' || rhs.open === 'both') {
//         return lhs.max <= rhs.min;
//       } else {
//         return lhs.max < rhs.min;
//       }
//     }
//     return false;
//   }

//   if (op === 'Greater') {
//     if (!lhs.domain || !rhs.domain) return null;
//     if (!lhs.min || !lhs.max || !rhs.min || !rhs.max) return null;
//     if (isNumericSubdomain(lhs.domain, rhs.domain)) {
//       return lhs.min > rhs.max;
//     }
//     return false;
//   }

//   if (op === 'GreaterEqual') {
//     if (!lhs.domain || !rhs.domain) return null;
//     if (!lhs.min || !lhs.max || !rhs.min || !rhs.max) return null;
//     if (isNumericSubdomain(lhs.domain, rhs.domain)) {
//       if (rhs.open === 'right' || rhs.open === 'both') {
//         return lhs.min >= rhs.max;
//       } else {
//         return lhs.min > rhs.max;
//       }
//     }
//     return false;
//   }

//   return null;
// }

// /**
//  * Return true if the lhs is in the rhs (regardless of domain compatibility)
//  */
// function isValueInDomain(lhs: number, rhs: NumericDomainInfo): boolean | null {
//   if (typeof rhs.min !== 'number' || typeof rhs.max !== 'number') return null;

//   if (rhs.open === 'both') return lhs > rhs.min && lhs < rhs.max;
//   if (rhs.open === 'left') return lhs > rhs.min && lhs <= rhs.max;
//   if (rhs.open === 'right') return lhs >= rhs.min && lhs < rhs.max;

//   return lhs >= rhs.min && lhs <= rhs.max;
// }
