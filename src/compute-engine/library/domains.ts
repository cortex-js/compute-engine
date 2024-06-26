import { DomainLiteral, IdentifierDefinitions } from '../public';

export const DOMAIN_CONSTRUCTORS = [
  'InvalidDomain',

  'DictionaryOf',
  'FunctionOf',
  'ListOf',
  'TupleOf',

  'Intersection',
  'Union',

  'OptArg',
  'VarArg',

  // 'Head',
  // 'Symbol',
  // 'Value',
];

export const DOMAIN_ALIAS = {
  Functions: ['FunctionOf', ['VarArg', 'Anything'], 'Anything'],
  NumericFunctions: ['FunctionOf', 'Numbers', ['VarArg', 'Numbers'], 'Numbers'],
  RealFunctions: [
    'FunctionOf',
    'ExtendedRealNumbers',
    ['VarArg', 'ExtendedRealNumbers'],
    'ExtendedRealNumbers',
  ],
  LogicOperators: [
    'FunctionOf',
    'Booleans',
    ['VarArg', 'Booleans'],
    'Booleans',
  ],
  Predicates: ['FunctionOf', 'Anything', ['VarArg', 'Anything'], 'Booleans'],
  RelationalOperators: ['FunctionOf', 'Anything', 'Anything', 'Booleans'],
  // PositiveInteger: ['Range', 1, +Infinity],
  // NonNegativeInteger: ['Range', 0, +Infinity],
  // NegativeInteger: ['Range', -Infinity, -1],
  // NonPositiveInteger: ['Range', -Infinity, 0],
  // PositiveNumber: ['Interval', ['Open', 0], +Infinity],
  // NonNegativeNumber: ['Interval', 0, +Infinity],
  // NegativeNumber: ['Interval', -Infinity, ['Open', 0]],
  // NonPositiveNumber: ['Interval', -Infinity, 0],
};

/**
 * Simple description of a numeric domain as a base domain, a min and
 * max value, possibly open ends, and some excluded values.
 */
// export type NumericDomainInfo = {
//   domain?: string; // Integer, RealNumber, ComplexNumber...
//   // (not one of the 'shortcuts', i.e. PositiveInteger)
//   min?: number; // Min and Max are not defined for ComplexNumbers
//   max?: number;
//   open?: 'left' | 'right' | 'both'; // For RealNumbers
//   /** Values from _excludedValues_ are considered not in this domain */
//   excludedValues?: number[];
//   /** If defined, the values in this domain must follow the relation
//    * _period_ * _n_ + _phase_ when _n_ is in _domain_.
//    */
//   multiple?: [period: number, domain: BoxedExpression, phase: number];
// };

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

const DOMAIN_LITERAL: Record<string, DomainLiteral | DomainLiteral[]> = {
  Anything: [],

  Values: 'Anything',
  Domains: 'Anything',

  Void: 'NothingDomain',
  NothingDomain: [
    'Booleans',
    'Strings',
    'Symbols',
    'Tuples',
    'Lists',
    'Dictionaries',
    'ImaginaryNumbers',
    'TranscendentalNumbers',
    'PositiveIntegers',
    'NegativeIntegers',
    'NonPositiveIntegers',
    'NonNegativeIntegers',
    'PositiveNumbers',
    'NegativeNumbers',
    'NonPositiveNumbers',
    'NonNegativeNumbers',
    'LogicOperators',
    'RelationalOperators',
  ],

  Booleans: 'Values',

  Strings: 'Values',
  Symbols: 'Values',

  Collections: 'Values',
  Lists: 'Collections',
  Dictionaries: 'Collections',
  Sequences: 'Collections',
  Tuples: 'Collections',
  Sets: 'Collections',

  //
  // Functional Domains
  //
  // https://en.wikipedia.org/wiki/List_of_mathematical_functions
  //
  Functions: 'Anything',
  Predicates: 'Functions',
  LogicOperators: 'Predicates',
  RelationalOperators: 'Predicates',

  NumericFunctions: 'Functions',
  RealFunctions: 'NumericFunctions',

  //
  // Numeric Domains
  //
  // https://en.wikipedia.org/wiki/Category_of_sets
  //
  Numbers: 'Values',
  ExtendedComplexNumbers: 'Numbers',
  ComplexNumbers: 'ExtendedComplexNumbers',
  ImaginaryNumbers: 'ComplexNumbers',
  ExtendedRealNumbers: 'ExtendedComplexNumbers',
  RealNumbers: ['ComplexNumbers', 'ExtendedRealNumbers'],

  PositiveNumbers: 'NonNegativeNumbers',
  NonNegativeNumbers: 'RealNumbers',
  NonPositiveNumbers: 'NegativeNumbers',
  NegativeNumbers: 'RealNumbers',

  TranscendentalNumbers: 'RealNumbers',

  AlgebraicNumbers: 'RealNumbers',
  RationalNumbers: 'AlgebraicNumbers',

  // NaturalNumbers: 'Integers',
  Integers: 'RationalNumbers',

  PositiveIntegers: 'NonNegativeIntegers',
  NonNegativeIntegers: 'Integers',
  NonPositiveIntegers: 'NegativeIntegers',
  NegativeIntegers: 'Integers',

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

let gDomainLiterals: Partial<{ [domain in DomainLiteral]: Set<string> }>;

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
export function ancestors(dom: DomainLiteral): DomainLiteral[] {
  // Build the domain lattice if necessary, by calculating all the ancestors of
  // `Void` (the bottom domain)
  if (!gDomainLiterals) {
    gDomainLiterals = {};
    ancestors('Void');
  }

  if (gDomainLiterals[dom])
    return Array.from(gDomainLiterals[dom]!) as DomainLiteral[];

  let result: DomainLiteral[] = [];
  if (typeof dom !== 'string' || !DOMAIN_LITERAL[dom]) {
    // Not a domain literal, it should be a constructor
    if (!Array.isArray(dom)) throw Error(`Unknown domain literal ${dom}`);
    if (!DOMAIN_CONSTRUCTORS.includes(dom[0]))
      throw Error(`Unknown domain constructor ${dom[0]}`);
    if (dom[0] === 'FunctionOf') return ancestors('Functions');
    // if (dom[0] === 'Head') return ancestors('Functions');
    // if (dom[0] === 'Symbol') return ancestors('Symbols');
    // if (dom[0] === 'Value') return ancestors('Values');
    if (dom[0] === 'TupleOf') return ancestors('Tuples');
    if (dom[0] === 'ListOf') return ancestors('Lists');
    if (dom[0] === 'DictionaryOf') return ancestors('Dictionaries');
    if (dom[0] === 'OptArg' || dom[0] === 'VarArg') return ancestors(dom[1]);

    if (dom[0] === 'Literal') return ['Anything']; // @todo could do better
    if (dom[0] === 'Union') return ['Anything']; // @todo could do better
    if (dom[0] === 'Intersection') return ['Anything']; // @todo could do better
    return ['Anything'];
  }

  if (typeof DOMAIN_LITERAL[dom] === 'string')
    result = [
      DOMAIN_LITERAL[dom] as DomainLiteral,
      ...ancestors(DOMAIN_LITERAL[dom] as DomainLiteral),
    ];
  else if (Array.isArray(DOMAIN_LITERAL[dom]))
    for (const parent of DOMAIN_LITERAL[dom] as DomainLiteral[]) {
      result.push(parent);
      result.push(...ancestors(parent));
    }

  gDomainLiterals[dom] = new Set(result);
  return result;
}

export function domainSetsLibrary(): IdentifierDefinitions {
  const table = {};
  for (const dom of Object.keys(DOMAIN_LITERAL))
    table[dom] = { domain: 'Domains', value: ['Domain', dom] };

  table['InvalidDomain'] = {
    signature: {
      domain: ['FunctionOf', 'Domains', 'Domains'],
      canonical: (ce, ops) => ce.domain(['InvalidDomain', ops[0]]),
    },
  };

  for (const ctor of ['DictionaryOf', 'FunctionOf', 'ListOf', 'TupleOf']) {
    table[ctor] = {
      signature: {
        domain: ['FunctionOf', ['VarArg', 'Domains'], 'Domains'],
        canonical: (ce, ops) => ce.domain([ctor, ...ops]),
      },
    };
  }

  for (const ctor of ['OptArg', 'VarArg']) {
    table[ctor] = {
      signature: {
        domain: ['FunctionOf', 'Domains', 'Domains'],
        canonical: (ce, ops) => ce.domain([ctor, ops[0]]),
      },
    };
  }

  // for (const ctor of ['Head', 'Symbol', 'Value']) {
  //   table[ctor] = {
  //     signature: {
  //       domain: ['FunctionOf', 'Anything', 'Domains'],
  //       canonical: (ce, ops) => ce.domain([ctor, ops[0]]),
  //     },
  //   };
  // }

  return table as IdentifierDefinitions;
}
