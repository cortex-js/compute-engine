import type { Dictionary } from '../public';

export const ARITHMETIC_DICTIONARY: Dictionary = {
  //
  // Constants
  //
  Pi: {
    domain: 'IrrationalNumber',
    constant: true,
    wikidata: 'Q167',
    value: Math.PI,
  },
  ImaginaryI: {
    domain: 'ImaginaryNumber',
    constant: true,
    wikidata: 'Q193796',
  },
  ExponentialE: {
    domain: 'IrrationalNumber',
    wikidata: 'Q82435',
    constant: true,
    value: { num: '2.7182818284590452354' },
  },

  //
  // Functions
  //
  Abs: {
    domain: 'Function',
    wikidata: 'Q3317982', //magnitude 'Q120812 (for reals)
    threadable: true,
    idempotent: true,
    signatures: [{ args: ['RealNumber'], result: 'RealNumber' }],
  },
  Add: {
    domain: 'Function',
    wikidata: 'Q32043',
    associative: true,
    commutative: true,
    threadable: true,
    idempotent: true,
    signatures: [{ rest: ['RealNumber'], result: 'RealNumber' }],
  },
  Chop: {
    domain: 'Function',
    associative: true,
    threadable: true,
    idempotent: true,
    signatures: [{ args: ['RealNumber'], result: 'RealNumber' }],
  },
  Ceil: {
    domain: 'Function',
    /** rounds a number up to the next largest integer */
  },
  Exp: {
    domain: ['ContinuousFunction', 'MonotonicFunction'],
    wikidata: 'Q168698',
    threadable: true,
    signatures: [{ args: ['RealNumber'], result: 'RealNumber' }],
  },
  Erf: {
    // Error function
    domain: ['ContinuousFunction', 'MonotonicFunction'],
    signatures: [{ args: ['RealNumber'], result: 'RealNumber' }],
  },
  Erfc: {
    // Complementary Error Function
    domain: ['ContinuousFunction', 'MonotonicFunction'],
    signatures: [{ args: ['RealNumber'], result: 'RealNumber' }],
  },
  Factorial: {
    wikidata: 'Q120976',
    domain: 'MonotonicFunction',
    signatures: [{ args: ['NaturalNumber'], result: 'NaturalNumber' }],
  },
  Floor: { domain: 'Function', wikidata: 'Q56860783' },
  Gamma: { domain: 'Function', wikidata: 'Q190573' },
  LogGamma: { domain: 'Function' },
  Log: {
    domain: 'Function',
    wikidata: 'Q11197',
    signatures: [
      { args: ['RealNumber'], result: 'RealNumber' },
      { args: ['RealNumber', ['base', 'NaturalNumber']], result: 'RealNumber' },
    ],
  },
  Log2: {
    domain: 'Function',
    wikidata: 'Q581168',
    signatures: [{ args: ['RealNumber'], result: 'RealNumber' }],
  },
  Log10: {
    domain: 'Function',
    wikidata: 'Q966582',
    signatures: [{ args: ['RealNumber'], result: 'RealNumber' }],
  },
  // LogOnePlus: { domain: 'Function' },
  MachineEpsilon: {
    /*
            The difference between 1 and the next larger floating point number
            
            2^{−52}
            
            See https://en.wikipedia.org/wiki/Machine_epsilon
        */
    domain: 'RealNumber',
    constant: true,
    value: { num: '2.220446049250313e-16' },
  },
  Multiply: {
    domain: 'Function',
    wikidata: 'Q40276',
    associative: true,
    commutative: true,
    idempotent: true,
    signatures: [{ rest: ['RealNumber'], result: 'RealNumber' }],
  },
  Negate: {
    domain: 'Function',
    wikidata: 'Q715358',
    signatures: [{ args: ['RealNumber'], result: 'RealNumber' }],
  },
  Power: {
    domain: 'Function',
    wikidata: 'Q33456',
    commutative: false,
    signatures: [{ args: ['RealNumber', 'RealNumber'], result: 'RealNumber' }],
  },
  Round: {
    domain: 'Function',
    signatures: [{ args: ['RealNumber', 'RealNumber'], result: 'RealNumber' }],
  },
  SignGamma: {
    domain: 'Function',
    /** The sign of the gamma function: -1 or +1 */
  },
  Sqrt: {
    domain: 'Function',
    wikidata: 'Q134237',
    signatures: [
      // @todo: arg should be positive number to map to a RealNumber
      { args: ['RealNumber'], result: 'RealNumber' },
      { args: ['Number'], result: 'Number' },
    ],
  },
  Root: {
    domain: 'Function',
    commutative: false,
    signatures: [{ args: ['NaturalNumber'], result: 'RealNumber' }],
  },
  Subtract: {
    domain: 'Function',
    wikidata: 'Q32043',
    commutative: false,
    signatures: [
      { args: ['RealNumber', 'RealNumber'], result: 'RealNumber' },
      { args: ['Number', 'Number'], result: 'Number' },
    ],
  },
  // mod (modulo). See https://numerics.diploid.ca/floating-point-part-4.html,
  // regardin 'remainder' and 'truncatingRemainder'
  // lcm
  // gcd
  // root
  // sum
  // product
};
