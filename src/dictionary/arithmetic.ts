import type { Dictionary } from '../public';

export const ARITHMETIC_DICTIONARY: Dictionary = {
  //
  // Constants
  //
  Pi: {
    domain: 'IrrationalNumber',
    constant: true,
    wikidata: 'Q167',
  },
  ImaginaryI: {
    domain: 'ImaginaryNumber',
    constant: true,
    wikidata: 'Q193796',
  },

  //
  // Functions
  //
  Abs: {
    domain: 'Function',
    wikidata: 'Q3317982', //magnitude 'Q120812 (for reals)
    threadable: true,
    idempotent: true,
  },
  Add: {
    domain: 'Function',
    wikidata: 'Q32043',
    associative: true,
    commutative: true,
    threadable: true,
    idempotent: true,
  },
  Chop: {
    domain: 'Function',
    associative: true,
    threadable: true,
    idempotent: true,
  },
  Ceil: {
    domain: 'Function',
    /** rounds a number up to the next largest integer */
  },
  E: {
    domain: 'IrrationalNumber',
    wikidata: 'Q82435',
    constant: true,
    value: { num: '2.7182818284590452354' },
  },
  Exp: {
    domain: 'Function',
  },
  Exp2: { domain: 'Function' },
  Exp10: { domain: 'Function' },
  Erf: {
    // Error function
    domain: 'Function',
  },
  Erfc: {
    // Error function complement
    domain: 'Function',
  },
  ExpMinusOne: { domain: 'Function' },
  Factorial: {
    wikidata: 'Q120976',
    domain: 'Function',
  },
  Floor: { domain: 'Function' },
  Gamma: { domain: 'Function' },
  LogGamma: { domain: 'Function' },
  Log: { domain: 'Function' },
  Log2: { domain: 'Function' },
  Log10: { domain: 'Function' },
  LogOnePlus: { domain: 'Function' },
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
  },
  NotEqual: {
    domain: 'Function',
    wikidata: 'Q28113351',
    commutative: true,
  },
  Negate: {
    domain: 'Function',
    wikidata: 'Q715358',
  },
  Power: {
    domain: 'Function',
    wikidata: 'Q33456',
    commutative: false,
  },
  Round: { domain: 'Function' },
  SignGamma: {
    domain: 'Function',
    /** The sign of the gamma function: -1 or +1 */
  },
  Sqrt: { domain: 'Function' },
  Root: {
    domain: 'Function',
    commutative: false,
  },
  Subtract: {
    domain: 'Function',
    wikidata: 'Q32043',
    commutative: false,
  },
  // mod (modulo)
  // lcm
  // gcd
  // root
  // sum
  // product
};
