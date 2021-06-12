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
