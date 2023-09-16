import { DomainLiteral, IdTable } from '../public';

export const DOMAIN_CONSTRUCTORS = [
  'InvalidDomain',

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
  Tuple: 'Collection',
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

export function domainSetsLibrary(): IdTable {
  const table: IdTable = {};
  for (const dom of Object.keys(DOMAIN_LITERAL)) {
    // @todo: the Domain domain conflicts with the Domain function
    // Need to be renamed, as in DomainSet or Domains
    // Same thing with Symbol Nothing and Domain Nothing
    if (
      dom !== 'Domain' &&
      dom !== 'Nothing' &&
      dom !== 'String' &&
      dom !== 'Symbol' &&
      dom !== 'List' &&
      dom !== 'Tuple' &&
      dom !== 'Sequence'
    )
      table[dom] = { domain: 'Set' };
  }
  return table;
}
