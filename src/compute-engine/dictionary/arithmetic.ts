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
  // Used in definitions of the range of some trigonometric functions
  HalfPi: {
    domain: 'IrrationalNumber',
    constant: true,
    wikidata: 'Q167',
    value: Math.PI / 2,
  },
  QuarterPi: {
    domain: 'IrrationalNumber',
    constant: true,
    wikidata: 'Q167',
    value: Math.PI / 4,
  },
  TwoPi: {
    domain: 'IrrationalNumber',
    constant: true,
    wikidata: 'Q167',
    value: 2 * Math.PI,
  },
  MinusPi: {
    domain: 'IrrationalNumber',
    constant: true,
    wikidata: 'Q167',
    value: -Math.PI,
  },
  MinusHalfPi: {
    domain: 'IrrationalNumber',
    constant: true,
    wikidata: 'Q167',
    value: -Math.PI / 2,
  },
  MinusTwoPi: {
    domain: 'IrrationalNumber',
    constant: true,
    wikidata: 'Q167',
    value: -Math.PI / 2,
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
  MinusOne: {
    domain: 'Integer',
    wikidata: 'Q310395',
    constant: true,
    value: -1,
  },
  Half: {
    domain: 'RealNumber',
    wikidata: 'Q2114394',
    constant: true,
    value: 0.5,
  },
  Third: {
    domain: 'RealNumber',
    wikidata: 'Q20021125',
    constant: true,
    value: 1 / 3,
  },
  Quarter: {
    domain: 'RealNumber',
    wikidata: 'Q2310416',
    constant: true,
    value: 0.25,
  },

  //
  // Functions
  //
  Abs: {
    domain: 'Function',
    wikidata: 'Q3317982', //magnitude 'Q120812 (for reals)
    threadable: true,
    idempotent: true,
    range: ['Interval', 0, Infinity],
  },
  Add: {
    domain: 'Function',
    wikidata: 'Q32043',
    associative: true,
    commutative: true,
    threadable: true,
    idempotent: true,
    range: 'Number',
  },
  Chop: {
    domain: 'Function',
    associative: true,
    threadable: true,
    idempotent: true,
    range: 'Number',
  },
  Ceil: {
    domain: 'Function',
    range: 'Number',
    /** rounds a number up to the next largest integer */
  },
  Exp: {
    domain: ['ContinuousFunction', 'MonotonicFunction'],
    wikidata: 'Q168698',
    threadable: true,
    range: 'Number',
  },
  Erf: {
    // Error function
    domain: ['ContinuousFunction', 'MonotonicFunction'],
    range: 'Number',
  },
  Erfc: {
    // Complementary Error Function
    domain: ['ContinuousFunction', 'MonotonicFunction'],
    range: 'Number',
  },
  Factorial: {
    wikidata: 'Q120976',
    domain: 'MonotonicFunction',
    range: 'Integer',
  },
  Floor: { domain: 'Function', wikidata: 'Q56860783', range: 'Number' },
  Gamma: { domain: 'Function', wikidata: 'Q190573', range: 'Number' },
  LogGamma: { domain: 'Function', range: 'Number' },
  Log: {
    domain: 'Function',
    wikidata: 'Q11197',
    range: 'Number',
  },
  Log2: {
    domain: 'Function',
    wikidata: 'Q581168',
    range: 'Number',
  },
  Log10: {
    domain: 'Function',
    wikidata: 'Q966582',
    range: 'Number',
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
    value: { num: Number.EPSILON.toString() },
  },
  Multiply: {
    domain: 'Function',
    wikidata: 'Q40276',
    associative: true,
    commutative: true,
    idempotent: true,
    range: 'Number',
  },
  Negate: {
    domain: 'Function',
    wikidata: 'Q715358',
    range: 'Number',
  },
  Power: {
    domain: 'Function',
    wikidata: 'Q33456',
    commutative: false,
    range: 'Number',
  },
  Round: {
    domain: 'Function',
    range: 'Number',
  },
  SignGamma: {
    domain: 'Function',
    range: 'Number',
    /** The sign of the gamma function: -1 or +1 */
  },
  Sqrt: {
    domain: 'Function',
    wikidata: 'Q134237',
    range: 'Number',
  },
  Root: {
    domain: 'Function',
    commutative: false,
    range: 'Number',
  },
  Subtract: {
    domain: 'Function',
    wikidata: 'Q32043',
    range: 'Number',
  },
  // @todo
  // mod (modulo). See https://numerics.diploid.ca/floating-point-part-4.html,
  // regardin 'remainder' and 'truncatingRemainder'
  // lcm
  // gcd
  // root
  // sum
  // product
};
