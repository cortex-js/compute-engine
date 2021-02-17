import type { Dictionary } from '../public';

// @todo
// sec, csc, cot
// sechh, csch, coth,
// arcsec, arccsc, arccot, arcsinh,
// arcsech, arccsch, arccoth,

export const TRIGONOMETRY_DICTIONARY: Dictionary = {
  Arcosh: { domain: 'HyperbolicFunction' },
  Arccos: { domain: 'TrigonometricFunction' },
  Arcsin: { domain: 'TrigonometricFunction' },
  Arctan: {
    wikidata: 'Q2257242',
    domain: 'TrigonometricFunction',
  },
  Arctan2: {
    wikidata: 'Q776598',
    domain: 'TrigonometricFunction',
  },
  Arsinh: { domain: 'HyperbolicFunction' },
  Artanh: { domain: 'HyperbolicFunction' },
  Cos: { domain: 'TrigonometricFunction' },
  Degrees: {
    /* = Pi / 180 */
    domain: 'Real',
    constant: true,
    value: 0.017453292519943295769236907,
  },
  FromPolarCoordinates: {
    /* converts (radius, angle) -> (x, y) */
    domain: 'Function',
  },
  Haversine: {
    /** = sin(z/2)^2 = (1 - cos z) / 2*/
    wikidata: 'Q2528380',
    domain: 'TrigonometricFunction',
  },
  Hypot: {
    // sqrt(x*x + y*y)
    domain: 'Function',
  },
  InverseHaversine: {
    /** = 2 * Arcsin(Sqrt(z)) */
    domain: 'TrigonometricFunction',
  },
  Sin: { domain: 'TrigonometricFunction' },
  Sinh: { domain: 'HyperbolicFunction' },
  Tan: { domain: 'TrigonometricFunction' },
  Tanh: { domain: 'HyperbolicFunction' },
  ToPolarCoordinates: {
    /* converts (x, y) -> (radius, angle) */
    domain: 'Function',
  },
};
