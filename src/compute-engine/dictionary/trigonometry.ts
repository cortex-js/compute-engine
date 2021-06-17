import { DIVIDE, MULTIPLY, NEGATE } from '../../common/utils';
import type { Dictionary } from '../public';

// Names after ISO 80000 Section 13

export const TRIGONOMETRY_DICTIONARY: Dictionary = {
  //
  // Constants
  //
  Degrees: {
    /* = Pi / 180 */
    domain: 'Real',
    constant: true,
    value: 0.017453292519943295769236907,
  },
  MinusDoublePi: {
    domain: 'IrrationalNumber',
    constant: true,
    hold: false,
    value: [MULTIPLY, -2, 'Pi'],
  },
  MinusPi: {
    domain: 'IrrationalNumber',
    constant: true,
    hold: false,
    value: [NEGATE, 'Pi'],
  },
  MinusHalfPi: {
    domain: 'IrrationalNumber',
    constant: true,
    hold: false,
    value: [DIVIDE, [NEGATE, 'Pi'], 2],
  },
  QuarterPi: {
    domain: 'IrrationalNumber',
    constant: true,
    hold: false,
    value: [DIVIDE, 'Pi', 4],
  },
  ThirdPi: {
    domain: 'IrrationalNumber',
    constant: true,
    hold: false,
    value: [DIVIDE, 'Pi', 3],
  },
  // Used in definitions of the range of some trigonometric functions
  HalfPi: {
    domain: 'IrrationalNumber',
    constant: true,
    hold: false,
    value: [DIVIDE, 'Pi', 2],
  },
  TwoThirdPi: {
    domain: 'IrrationalNumber',
    constant: true,
    hold: false,
    value: [MULTIPLY, 2, [DIVIDE, 'Pi', 3]],
  },
  ThreeQuarterPi: {
    domain: 'IrrationalNumber',
    constant: true,
    hold: false,
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
    hold: false,
    value: [MULTIPLY, 2, 'Pi'],
  },

  //
  // Functions
  //
  Arccos: {
    domain: 'TrigonometricFunction',
    range: ['Interval', 0, 'Pi'],
    numeric: true,
    value: ['Subtract', 'HalfPi', ['Arcsin', '_']],
  },
  Arcosh: {
    domain: 'HyperbolicFunction',
    range: ['Interval', 0, Infinity],
    numeric: true,
    value: ['Ln', ['Add', '_', ['Sqrt', ['Subtract', ['Square', '_'], 1]]]],
  },
  // Arccot: {
  //   domain: 'TrigonometricFunction',
  //   numeric: true,
  // },
  // Note Arcoth, not Arccoth
  // Arcoth: {
  //   domain: 'HyperbolicFunction',
  //   numeric: true,
  // },
  // Arcsec: {
  //   domain: 'TrigonometricFunction',
  //   numeric: true,
  // },
  // Arsech: {
  //   domain: 'HyperbolicFunction',
  //   numeric: true,
  // },
  // Arccsc: {
  //   domain: 'TrigonometricFunction',
  //   numeric: true,
  // },
  // Arcsch: {
  //   domain: 'HyperbolicFunction',
  //   numeric: true,
  // },
  Arcsin: {
    domain: 'TrigonometricFunction',
    range: ['Interval', 'MinusHalfPi', 'HalfPi'],
    numeric: true,
    value: [
      'Multiply',
      2,
      ['Arctan2', '_', ['Add', 1, ['Sqrt', ['Subtract', 1, ['Square', '_']]]]],
    ],
  },
  //Note: Arsinh, not Arcsinh
  Arsinh: {
    domain: 'HyperbolicFunction',
    range: ['Interval', -Infinity, Infinity],
    numeric: true,
    value: ['Ln', ['Add', '_', ['Sqrt', ['Add', ['Square', '_'], 1]]]],
  },
  Arctan: {
    wikidata: 'Q2257242',
    domain: 'TrigonometricFunction',
    range: ['Interval', 'MinusHalfPi', 'HalfPi'],
    numeric: true,
    evalf: (_ce, x: number) => Math.atan(x),
  },
  Arctan2: {
    wikidata: 'Q776598',
    range: ['Interval', 'MinusPi', 'Pi'],
    domain: 'TrigonometricFunction',
    numeric: true,
    evalf: (_ce, x: number, y: number) => Math.atan2(x, y),
  },
  Artanh: {
    domain: 'HyperbolicFunction',
    range: ['Interval', -Infinity, Infinity],
    numeric: true,
    value: [
      'Multiply',
      'Half',
      ['Ln', ['Divide', ['Add', 1, '_'], ['Subtract', 1, '_']]],
    ],
  },

  Cosh: {
    domain: 'HyperbolicFunction',
    range: ['Interval', 1, Infinity],
    numeric: true,
    value: [
      'Multiply',
      'Half',
      ['Add', ['Exp', '_'], ['Exp', ['Negate', '_']]],
    ],
  },
  Cos: {
    domain: 'TrigonometricFunction',
    range: ['Interval', -1, 1],
    numeric: true,
    value: ['Sin', ['Add', '_', 'HalfPi']],
    evalf: (_ce, x: number) => Math.cos(x),
  },
  Cot: {
    domain: 'TrigonometricFunction',
    range: 'RealNumber',
    numeric: true,
    value: ['Divide', ['Cos', '_'], ['Sin', '_']],
    evalf: (_ce, x: number) => 1 / Math.tan(x),
  },
  Coth: {
    domain: 'HyperbolicFunction',
    range: 'RealNumber',
    numeric: true,
    value: ['Divide', 1, ['Tanh', '_']],
  },
  Csc: {
    domain: 'TrigonometricFunction',
    range: ['Interval', -1, 1],
    numeric: true,
    value: ['Divide', 1, ['Sin', '_']],
  },
  Csch: {
    domain: 'HyperbolicFunction',
    range: ['Interval', -1, 1],
    numeric: true,
    value: ['Divide', 1, ['Sinh', '_']],
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
    value: ['Divide', ['Subtract', 1, ['Cos', '_']], 2],
    numeric: true,
  },
  // sqrt(x*x + y*y)
  Hypot: {
    domain: 'Function',
    range: ['Interval', 0, Infinity],
    value: ['Sqrt', ['Square', '_'], ['Square', '_2']],
  },
  /** = 2 * Arcsin(Sqrt(z)) */
  InverseHaversine: {
    domain: 'TrigonometricFunction',
    range: ['Interval', ['MinusPi'], 'Pi'],
    numeric: true,
    value: ['Multiply', 2, ['Arcsin', ['Sqrt', '_']]],
  },
  Sec: {
    domain: 'TrigonometricFunction',
    range: ['Interval', -1, 1],
    numeric: true,
    value: ['Divide', 1, ['Cos', '_']],
  },
  Sech: {
    domain: 'HyperbolicFunction',
    range: ['Interval', -1, 1],
    numeric: true,
    value: ['Divide', 1, ['Cosh', '_']],
  },
  Sinh: {
    domain: 'HyperbolicFunction',
    range: ['Interval', -Infinity, Infinity],
    numeric: true,
    value: [
      'Multiply',
      'Half',
      ['Subtract', ['Exp', '_'], ['Exp', ['Negate', '_']]],
    ],
  },
  Sin: {
    domain: 'TrigonometricFunction',
    range: ['Interval', -1, 1],
    numeric: true,
    value: [
      'Divide',
      [
        'Subtract',
        ['Exp', ['Multiply', 'ImaginaryI', '_']],
        ['Exp', ['Multiply', 'ImaginaryI', ['Negate', '_']]],
      ],

      ['Multiply', 2, 'ImaginaryI'],
    ],
    evalf: (_ce, x: number) => Math.sin(x),
  },
  Tanh: {
    domain: 'HyperbolicFunction',
    range: ['Interval', -Infinity, Infinity],
    numeric: true,
    value: ['Divide', ['Sinh', '_'], ['Cosh', '_']],
  },

  Tan: {
    domain: 'TrigonometricFunction',
    range: 'RealNumber',
    numeric: true,
    value: ['Divide', ['Sin', '_'], ['Cos', '_']],
    evalf: (_ce, x: number) => Math.atan(x),
  },
  /* converts (x, y) -> (radius, angle) */
  ToPolarCoordinates: {
    domain: 'Function',
    range: ['TupleOf', 'RealNumber', 'RealNumber'],
  },
};
