import { Decimal } from 'decimal.js';
import { Complex } from 'complex.js';
import { DIVIDE, getArg, MISSING, MULTIPLY, NEGATE } from '../../common/utils';
import { ComputeEngine, Dictionary, Numeric } from '../public';
import { ExpressionMap } from '../expression-map';
import { Expression } from '../../public';
import { DECIMAL_ONE } from '../numeric-decimal';

// Names after ISO 80000 Section 13

const S2 = ['Sqrt', 2];
const S3 = ['Sqrt', 3];
const S5 = ['Sqrt', 5];
const S6 = ['Sqrt', 6];

// @todo: add more values from https://en.wikipedia.org/wiki/Trigonometric_functions
const SPECIAL_VALUES = new ExpressionMap<
  Numeric,
  { [fn: string]: Expression<Numeric> }
>([
  [
    ['Divide', 'Pi', 12],
    {
      Sin: ['Divide', ['Subtract', S6, S2], 4],
      Cos: ['Divide', ['Add', S6, S2], 4],
      Tan: ['Subtract', [2, S3]],
      Cot: ['Add', [2, S3]],
      Sec: ['Subtract', [S6, S2]],
      Csc: ['Add', [S6, S2]],
    },
  ],
  [
    ['Divide', 'Pi', 10],
    {
      Sin: ['Divide', ['Subtract', S5, 1], 4],
      Cos: ['Divide', ['Sqrt', ['Add', 10, ['Multiply', 2, S5]]], 4],
      Tan: ['Divide', ['Sqrt', ['Subtract', 25, ['Multiply', 10, S5]]], 4],
      Cot: ['Sqrt', ['Add', 5, ['Multiply', 2, S5]]],
      Sec: ['Divide', ['Sqrt', ['Subtract', 50, ['Multiply', 10, S5]]], 5],
      Csc: ['Add', 1, S5],
    },
  ],
  [
    ['Divide', 'Pi', 4],
    {
      Sin: ['Divide', S2, 2],
      Cos: ['Divide', S2, 2],
      Tan: 1,
      Cot: 1,
      Sec: S2,
      Csc: S2,
    },
  ],
  [
    ['Divide', 'Pi', 3],
    {
      Sin: ['Divide', S3, 2],
      Cos: 'Half',
      Tan: S3,
      Cot: ['Divide', S3, 3],
      Sec: 2,
      Csc: ['Divide', ['Multiply', 2, S3], 3],
    },
  ],
  [
    ['Divide', 'Pi', 2],
    {
      Sin: 1,
      Cos: 0,
      Tan: +Infinity,
      Cot: 0,
      Sec: +Infinity,
      Csc: 1,
    },
  ],
]);

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
    domain: 'TranscendentalNumber',
    constant: true,
    hold: false,
    value: [MULTIPLY, -2, 'Pi'],
  },
  MinusPi: {
    domain: 'TranscendentalNumber',
    constant: true,
    hold: false,
    value: [NEGATE, 'Pi'],
  },
  MinusHalfPi: {
    domain: 'TranscendentalNumber',
    constant: true,
    hold: false,
    value: [DIVIDE, [NEGATE, 'Pi'], 2],
  },
  QuarterPi: {
    domain: 'TranscendentalNumber',
    constant: true,
    hold: false,
    value: [DIVIDE, 'Pi', 4],
  },
  ThirdPi: {
    domain: 'TranscendentalNumber',
    constant: true,
    hold: false,
    value: [DIVIDE, 'Pi', 3],
  },
  // Used in definitions of the range of some trigonometric functions
  HalfPi: {
    domain: 'TranscendentalNumber',
    constant: true,
    hold: false,
    value: [DIVIDE, 'Pi', 2],
  },
  TwoThirdPi: {
    domain: 'TranscendentalNumber',
    constant: true,
    hold: false,
    value: [MULTIPLY, 2, [DIVIDE, 'Pi', 3]],
  },
  ThreeQuarterPi: {
    domain: 'TranscendentalNumber',
    constant: true,
    hold: false,
    value: [MULTIPLY, 3, [DIVIDE, 'Pi', 4]],
  },
  Pi: {
    domain: 'TranscendentalNumber',
    constant: true,
    wikidata: 'Q167',
    value: (engine: ComputeEngine) => {
      if (engine.numericFormat === 'decimal') return Decimal.acos(-1);
      if (engine.numericFormat === 'complex') return Complex.PI;
      return Math.PI;
    },
  },
  DoublePi: {
    domain: 'TranscendentalNumber',
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
    simplify: (_ce, x: Expression) =>
      SPECIAL_VALUES.get(x)?.['Arccos'] ?? [
        'Subtract',
        'HalfPi',
        ['Arcsin', x],
      ],
    evalNumber: (_ce, x: number) => Math.acos(x),
    evalDecimal: (_ce, x: Decimal) => Decimal.acos(x),
    evalComplex: (_ce, x: Complex) => Complex.acos(x),
  },
  Arcosh: {
    domain: 'HyperbolicFunction',
    range: ['Interval', 0, Infinity],
    numeric: true,
    value: ['Ln', ['Add', '_', ['Sqrt', ['Subtract', ['Square', '_'], 1]]]],
    simplify: (_ce, x: Expression) =>
      SPECIAL_VALUES.get(x)?.['Arccosh'] ?? [
        'Ln',
        ['Add', x, ['Sqrt', ['Subtract', ['Square', x], 1]]],
      ],
    evalNumber: (_ce, x: number) => Math.acosh(x),
    evalDecimal: (_ce, x: Decimal) => Decimal.acosh(x),
    evalComplex: (_ce, x: Complex) => Complex.acosh(x),
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
    simplify: (_ce, x: Expression) =>
      SPECIAL_VALUES.get(x)?.['Arcsin'] ?? [
        'Multiply',
        2,
        ['Arctan2', x, ['Add', 1, ['Sqrt', ['Subtract', 1, ['Square', x]]]]],
      ],
    value: [
      'Multiply',
      2,
      ['Arctan2', '_', ['Add', 1, ['Sqrt', ['Subtract', 1, ['Square', '_']]]]],
    ],
    evalNumber: (_ce, x: number) => Math.asin(x),
    evalDecimal: (_ce, x: Decimal) => Decimal.asin(x),
    evalComplex: (_ce, x: Complex) => Complex.asin(x),
  },
  //Note: Arsinh, not Arcsinh
  Arsinh: {
    domain: 'HyperbolicFunction',
    range: ['Interval', -Infinity, Infinity],
    numeric: true,
    simplify: (_ce, x: Expression) =>
      SPECIAL_VALUES.get(x)?.['Arsinh'] ?? [
        'Ln',
        ['Add', x, ['Sqrt', ['Add', ['Square', x], 1]]],
      ],
    value: ['Ln', ['Add', '_', ['Sqrt', ['Add', ['Square', '_'], 1]]]],
    evalNumber: (_ce, x: number) => Math.asinh(x),
    evalDecimal: (_ce, x: Decimal) => Decimal.asinh(x),
    evalComplex: (_ce, x: Complex) => Complex.asinh(x),
  },
  Arctan: {
    wikidata: 'Q2257242',
    domain: 'TrigonometricFunction',
    range: ['Interval', 'MinusHalfPi', 'HalfPi'],
    numeric: true,
    simplify: (_ce, x: Expression) => SPECIAL_VALUES.get(x)?.['Arctan'] ?? x,
    evalNumber: (_ce, x: number) => Math.atan(x),
    evalDecimal: (_ce, x: Decimal) => Decimal.atan(x),
    evalComplex: (_ce, x: Complex) => Complex.atan(x),
  },
  Arctan2: {
    wikidata: 'Q776598',
    range: ['Interval', 'MinusPi', 'Pi'],
    domain: 'TrigonometricFunction',
    numeric: true,
    evalNumber: (_ce, x: number, y: number) => Math.atan2(x, y),
    evalDecimal: (_ce, x: Decimal, y: Decimal) => Decimal.atan2(x, y),
    evalComplex: (_ce, x: Complex, y: Complex) => Complex.atan2(x, y),
  },
  Artanh: {
    domain: 'HyperbolicFunction',
    range: ['Interval', -Infinity, Infinity],
    numeric: true,
    simplify: (_ce, x: Expression) =>
      SPECIAL_VALUES.get(x)?.['Artanh'] ?? [
        'Multiply',
        'Half',
        ['Ln', ['Divide', ['Add', 1, x], ['Subtract', 1, x]]],
      ],
    value: [
      'Multiply',
      'Half',
      ['Ln', ['Divide', ['Add', 1, '_'], ['Subtract', 1, '_']]],
    ],
    evalNumber: (_ce, x: number) => Math.atanh(x),
    evalDecimal: (_ce, x: Decimal) => Decimal.atanh(x),
    evalComplex: (_ce, x: Complex) => Complex.atanh(x),
  },

  Cosh: {
    domain: 'HyperbolicFunction',
    range: ['Interval', 1, Infinity],
    numeric: true,
    simplify: (_ce, x: Expression) => SPECIAL_VALUES.get(x)?.['Cosh'] ?? x,
    value: [
      'Multiply',
      'Half',
      ['Add', ['Exp', '_'], ['Exp', ['Negate', '_']]],
    ],
    evalNumber: (_ce, x: number) => Math.cosh(x),
    evalDecimal: (_ce, x: Decimal) => Decimal.cosh(x),
    evalComplex: (_ce, x: Complex) => Complex.cosh(x),
  },
  Cos: {
    domain: 'TrigonometricFunction',
    range: ['Interval', -1, 1],
    numeric: true,
    simplify: (_ce, x: Expression) =>
      SPECIAL_VALUES.get(x)?.['Cos'] ?? ['Sin', ['Add', x, 'HalfPi']],
    value: ['Sin', ['Add', '_', 'HalfPi']],
    evalNumber: (_ce, x: number) => Math.cos(x),
    evalDecimal: (_ce, x: Decimal) => Decimal.cos(x),
    evalComplex: (_ce, x: Complex) => Complex.cos(x),
  },
  Cot: {
    domain: 'TrigonometricFunction',
    range: 'ComplexNumber',
    numeric: true,
    simplify: (_ce, x: Expression) =>
      SPECIAL_VALUES.get(x)?.['Cot'] ?? ['Divide', ['Cos', x], ['Sin', x]],
    value: ['Divide', ['Cos', '_'], ['Sin', '_']],
    evalNumber: (_ce, x: number) => 1 / Math.tan(x),
    evalDecimal: (_ce, x: Decimal) => DECIMAL_ONE.div(Decimal.tan(x)),
    evalComplex: (_ce, x: Complex) => Complex.ONE.div(Complex.tan(x)),
  },
  Coth: {
    domain: 'HyperbolicFunction',
    range: 'ComplexNumber',
    numeric: true,
    simplify: (_ce, x: Expression) =>
      SPECIAL_VALUES.get(x)?.['Coth'] ?? ['Divide', 1, ['Tanh', x]],
    value: ['Divide', 1, ['Tanh', '_']],
    evalNumber: (_ce, x: number) => 1 / Math.tanh(x),
    evalDecimal: (_ce, x: Decimal) => DECIMAL_ONE.div(Decimal.tanh(x)),
    evalComplex: (_ce, x: Complex) => Complex.ONE.div(Complex.tanh(x)),
  },
  Csc: {
    domain: 'TrigonometricFunction',
    range: ['Interval', -1, 1],
    numeric: true,
    simplify: (_ce, x: Expression) =>
      SPECIAL_VALUES.get(x)?.['Csc'] ?? ['Divide', 1, ['Sin', x]],
    value: ['Divide', 1, ['Sin', '_']],
    evalNumber: (_ce, x: number) => 1 / Math.tanh(x),
    evalDecimal: (_ce, x: Decimal) => DECIMAL_ONE.div(Decimal.tanh(x)),
    evalComplex: (_ce, x: Complex) => Complex.ONE.div(Complex.tanh(x)),
  },
  Csch: {
    domain: 'HyperbolicFunction',
    range: ['Interval', -1, 1],
    numeric: true,
    simplify: (_ce, x: Expression) =>
      SPECIAL_VALUES.get(x)?.['Csch'] ?? ['Divide', 1, ['Sinh', x]],
    value: ['Divide', 1, ['Sinh', '_']],
    evalNumber: (_ce, x: number) => 1 / Math.sinh(x),
    evalDecimal: (_ce, x: Decimal) => DECIMAL_ONE.div(Decimal.sinh(x)),
    evalComplex: (_ce, x: Complex) => Complex.ONE.div(Complex.sinh(x)),
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
    evalNumber: (_ce, x: number, y: number) => Math.sqrt(x * x * +y * y),
    evalDecimal: (_ce, x: Decimal, y: Decimal) =>
      Decimal.sqrt(x.mul(x).add(y.mul(y))),
    evalComplex: (_ce, x: Complex, y: Complex) =>
      Complex.sqrt(x.mul(x).add(y.mul(y))),
  },
  InverseFunction: {
    domain: 'Function',
    range: 'Function',
    simplify: (_ce, x: Expression): Expression => {
      const fn = getArg(x, 1) ?? MISSING;
      if (typeof fn !== 'string') return x;
      return (
        {
          Sin: 'Arcsin',
          Cos: 'Arccos',
          Tan: 'Arctan',
          Sec: 'Arcsec',
          Csc: ' Arccsc',
          Sinh: 'Arsinh',
          Cosh: 'Arcosh',
          Tanh: 'Artanh',
          Sech: 'Arcsech',
          Csch: 'Arcsch',
          Arcosh: 'Cosh',
          Arcos: 'Cos',
          Arccsc: 'Csc',
          Arcsch: 'Csch',
          // '??': 'Cot',
          // '??': 'Coth',
          Arcsec: 'Sec',
          Arcsin: 'Sin',
          Arsinh: 'Sinh',
          Arctan: 'Tan',
          Artanh: 'Tanh',
        }[fn] ?? x
      );
    },
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
    simplify: (_ce, x: Expression) =>
      SPECIAL_VALUES.get(x)?.['Sec'] ?? ['Divide', 1, ['Cos', x]],
    value: ['Divide', 1, ['Cos', '_']],
    evalNumber: (_ce, x: number) => 1 / Math.cos(x),
    evalDecimal: (_ce, x: Decimal) => DECIMAL_ONE.div(Decimal.cos(x)),
    evalComplex: (_ce, x: Complex) => Complex.ONE.div(Complex.cos(x)),
  },
  Sech: {
    domain: 'HyperbolicFunction',
    range: ['Interval', -1, 1],
    numeric: true,
    simplify: (_ce, x: Expression) =>
      SPECIAL_VALUES.get(x)?.['Sech'] ?? ['Divide', 1, ['Cosh', x]],
    value: ['Divide', 1, ['Cosh', '_']],
    evalNumber: (_ce, x: number) => 1 / Math.cosh(x),
    evalDecimal: (_ce, x: Decimal) => DECIMAL_ONE.div(Decimal.cosh(x)),
    evalComplex: (_ce, x: Complex) => Complex.ONE.div(Complex.cosh(x)),
  },
  Sinh: {
    domain: 'HyperbolicFunction',
    range: ['Interval', -Infinity, Infinity],
    numeric: true,
    simplify: (_ce, x: Expression) =>
      SPECIAL_VALUES.get(x)?.['Sinh'] ?? [
        'Multiply',
        'Half',
        ['Subtract', ['Exp', x], ['Exp', ['Negate', x]]],
      ],
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
    simplify: (_ce, x: Expression) => SPECIAL_VALUES.get(x)?.['Sin'] ?? x,
    value: [
      'Divide',
      [
        'Subtract',
        ['Exp', ['Multiply', 'ImaginaryUnit', '_']],
        ['Exp', ['Multiply', 'ImaginaryUnit', ['Negate', '_']]],
      ],

      ['Multiply', 2, 'ImaginaryUnit'],
    ],
    evalNumber: (_ce, x: number) => Math.sin(x),
    evalDecimal: (_ce, x: Decimal) => x.sin(),
    evalComplex: (_ce, x: Complex) => x.sin(),
  },
  Tanh: {
    domain: 'HyperbolicFunction',
    range: ['Interval', -Infinity, Infinity],
    numeric: true,
    simplify: (_ce, x: Expression) =>
      SPECIAL_VALUES.get(x)?.['Tanh'] ?? ['Divide', ['Sinh', x], ['Cosh', x]],
    value: ['Divide', ['Sinh', '_'], ['Cosh', '_']],
    evalNumber: (_ce, x: number) => Math.tanh(x),
    evalDecimal: (_ce, x: Decimal) => x.tanh(),
    evalComplex: (_ce, x: Complex) => x.tanh(),
  },

  Tan: {
    domain: 'TrigonometricFunction',
    range: 'RealNumber',
    numeric: true,
    simplify: (_ce, x: Expression) =>
      SPECIAL_VALUES.get(x)?.['Tan'] ?? ['Divide', ['Sin', x], ['Cos', x]],
    value: ['Divide', ['Sin', '_'], ['Cos', '_']],
    evalNumber: (_ce, x: number) => Math.tan(x),
    evalDecimal: (_ce, x: Decimal) => x.tan(),
    evalComplex: (_ce, x: Complex) => x.tan(),
  },
  /* converts (x, y) -> (radius, angle) */
  ToPolarCoordinates: {
    domain: 'Function',
    range: ['TupleOf', 'RealNumber', 'RealNumber'],
  },
};
