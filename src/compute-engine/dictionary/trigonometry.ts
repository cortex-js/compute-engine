import { DIVIDE, MULTIPLY, NEGATE } from '../../common/utils';
import type { Dictionary } from '../public';

// @todo
// sec, csc, cot
// sechh, csch, coth,
// arcsec, arccsc, arccot, arcsinh,
// arcsech, arccsch, arccoth,

export const TRIGONOMETRY_DICTIONARY: Dictionary = {
  Arcosh: { domain: 'HyperbolicFunction', range: ['Interval', 0, Infinity] },
  // Arccos: { domain: 'TrigonometricFunction' },
  // Arcsin: { domain: 'TrigonometricFunction' },
  // Arctan: {
  //   wikidata: 'Q2257242',
  //   domain: 'TrigonometricFunction',
  // },
  // Arctan2: {
  //   wikidata: 'Q776598',
  //   domain: 'TrigonometricFunction',
  // },
  // Arsinh: { domain: 'HyperbolicFunction' },
  // Artanh: { domain: 'HyperbolicFunction' },
  // Tanh: { domain: 'HyperbolicFunction' },
  // Sinh: { domain: 'HyperbolicFunction' },
  Degrees: {
    /* = Pi / 180 */
    domain: 'Real',
    constant: true,
    value: 0.017453292519943295769236907,
  },
  MinusDoublePi: {
    domain: 'IrrationalNumber',
    constant: true,
    value: [MULTIPLY, -2, 'Pi'],
  },
  MinusPi: {
    domain: 'IrrationalNumber',
    constant: true,
    value: [NEGATE, 'Pi'],
  },
  MinusHalfPi: {
    domain: 'IrrationalNumber',
    constant: true,
    value: [DIVIDE, [NEGATE, 'Pi'], 2],
  },
  QuarterPi: {
    domain: 'IrrationalNumber',
    constant: true,
    value: [DIVIDE, 'Pi', 4],
  },
  ThirdPi: {
    domain: 'IrrationalNumber',
    constant: true,
    value: [DIVIDE, 'Pi', 3],
  },
  // Used in definitions of the range of some trigonometric functions
  HalfPi: {
    domain: 'IrrationalNumber',
    constant: true,
    value: [DIVIDE, 'Pi', 2],
  },
  TwoThirdPi: {
    domain: 'IrrationalNumber',
    constant: true,
    value: [MULTIPLY, 2, [DIVIDE, 'Pi', 3]],
  },
  ThreeQuarterPi: {
    domain: 'IrrationalNumber',
    constant: true,
    value: [MULTIPLY, 3, [DIVIDE, 'Pi', 4]],
  },
  Pi: {
    domain: 'IrrationalNumber',
    constant: true,
    wikidata: 'Q167',
    value: Math.PI,
  },
  DoublePi: {
    domain: 'IrrationalNumber',
    constant: true,
    value: [MULTIPLY, 2, 'Pi'],
  },
  /* converts (radius, angle) -> (x, y) */
  FromPolarCoordinates: {
    domain: 'Function',
    range: ['TupleOf', 'RealNumber', 'RealNumber'],
  },
  /** = sin(z/2)^2 = (1 - cos z) / 2*/
  Haversine: {
    wikidata: 'Q2528380',
    domain: 'TrigonometricFunction',
    range: ['Interval', 0, 1],
  },
  // sqrt(x*x + y*y)
  Hypot: { domain: 'Function', range: ['Interval', 0, Infinity] },
  /** = 2 * Arcsin(Sqrt(z)) */
  InverseHaversine: {
    domain: 'TrigonometricFunction',
    range: ['Interval', ['Negate', 'Pi'], 'Pi'],
  },
  Cos: { domain: 'TrigonometricFunction', range: ['Interval', -1, 1] },
  Sin: { domain: 'TrigonometricFunction', range: ['Interval', -1, 1] },
  Tan: { domain: 'TrigonometricFunction', range: 'RealNumber' },
  /* converts (x, y) -> (radius, angle) */
  ToPolarCoordinates: {
    domain: 'Function',
    range: ['TupleOf', 'RealNumber', 'RealNumber'],
  },
};
