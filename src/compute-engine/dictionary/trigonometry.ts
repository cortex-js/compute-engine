import { Decimal } from 'decimal.js';
import {
  BoxedExpression,
  Dictionary,
  IComputeEngine,
  LatexString,
} from '../public';
import {
  complexAllowed,
  latexString,
  useDecimal,
} from '../boxed-expression/utils';
import { Expression } from '../../math-json/math-json-format';
import { canonicalNegate } from '../symbolic/negate';

// Names of trigonometric functions follow ISO 80000 Section 13
const domainNumberToRealNumber = (
  ce: IComputeEngine,
  ops: BoxedExpression[]
) => {
  if (!ops[0]) return null;
  const domain = ops[0].domain;
  return domain.isSubsetOf('Number') ? ce.symbol('RealNumber') : null;
};
const domainRealToRealComplexToComplex = (
  ce: IComputeEngine,
  ops: BoxedExpression[]
) => {
  if (!ops[0]) return null;
  const domain = ops[0].domain;

  return domain.isSubsetOf('RealNumber')
    ? ce.symbol('RealNumber')
    : domain.isSubsetOf('ComplexNumber')
    ? ce.symbol('ComplexNumber')
    : null;
};
export const TRIGONOMETRY_DICTIONARY: Dictionary[] = [
  {
    //
    // Constants
    //
    symbols: [
      {
        name: 'Degrees',
        /* = Pi / 180 */
        domain: 'RealNumber',
        constant: true,
        value: ['Divide', 'Pi', 180], // 0.017453292519943295769236907,
      },

      {
        name: 'Pi',
        domain: 'TranscendentalNumber',
        algebraic: false,
        constant: true,
        hold: true,
        wikidata: 'Q167',
        value: (engine) => (useDecimal(engine) ? engine.DECIMAL_PI : Math.PI),
      },
    ],
    functions: [
      // sqrt(x*x + y*y)
      {
        name: 'Hypot',
        // Range: ['Interval', 0, Infinity],
        evaluate: ['Sqrt', ['Square', '_1'], ['Square', '_2']],
        evalDomain: domainNumberToRealNumber,
        // machineN: (x: number, y: number) => Math.sqrt(x * x * +y * y),
        // decimalN: (x: Decimal | number, y: Decimal | number) =>
        //   Decimal.sqrt(Decimal.mul(x, y).add(Decimal.mul(x, y))),
        // complexN: (x: Complex | number, y: Complex | number) =>
        //   Complex(x).mul(x).add(Complex(y).mul(y)).sqrt(),
      },
      {
        name: 'Sin',
        // outputDomain: ['Interval', -1, 1],
        evalDomain: domainRealToRealComplexToComplex,
        numeric: true,
        complexity: 5000,
        simplify: (ce, ops) =>
          constructibleValues(ce, 'Sin', ops[0]) ??
          (complexAllowed(ce)
            ? ce.box([
                'Divide',
                [
                  'Subtract',
                  ['Exp', ['Multiply', 'ImaginaryUnit', ops[0]]],
                  ['Exp', ['Multiply', 'ImaginaryUnit', ['Negate', ops[0]]]],
                ],
                ['Complex', 0, 2],
              ]).canonical
            : undefined),
        evaluate: (ce, ops) =>
          constructibleValues(ce, 'Sin', ops[0]) ??
          (complexAllowed(ce)
            ? ce.box([
                'Divide',
                [
                  'Subtract',
                  ['Exp', ['Multiply', 'ImaginaryUnit', ops[0]]],
                  ['Exp', ['Multiply', 'ImaginaryUnit', ['Negate', ops[0]]]],
                ],
                ['Complex', 0, 2],
              ]).canonical
            : undefined),

        N: (ce, ops) => {
          if (ops[0].decimalValue)
            return ce.number(ce.chop(ops[0].decimalValue.sin()));
          if (ops[0].complexValue) return ce.number(ops[0].complexValue.sin());
          if (ops[0].asFloat !== null)
            return ce.number(Math.sin(ops[0].asFloat));
          return undefined;
        },
      },
    ],
  },
  {
    //
    // Basic trigonometric function
    // (may be used in the definition of other functions below)
    //
    functions: [
      {
        name: 'Arctan',
        wikidata: 'Q2257242',
        evalDomain: domainNumberToRealNumber,
        numeric: true,
        complexity: 5200,
        simplify: (ce, ops) => constructibleValues(ce, 'Arctan', ops[0]),
        N: (ce, ops) => {
          if (ops[0].decimalValue) return ce.number(ops[0].decimalValue.atan());
          if (ops[0].complexValue) return ce.number(ops[0].complexValue.atan());
          if (ops[0].asFloat !== null)
            return ce.number(Math.atan(ops[0].asFloat));
          return undefined;
        },
      },
      {
        name: 'Arctan2',
        wikidata: 'Q776598',
        evalDomain: domainNumberToRealNumber,
        numeric: true,
        complexity: 5200,
        N: (ce, ops) => {
          if (ops[0].decimalValue && ops[1].decimalValue)
            return ce.number(
              Decimal.atan2(ops[0].decimalValue, ops[1].decimalValue)
            );
          // atan2 is not defined for complex number
          if (ops[0].asFloat !== null && ops[1].asFloat !== null)
            return ce.number(Math.atan2(ops[0].asFloat, ops[1].asFloat));
          return undefined;
        },
      },
      {
        name: 'Cos',
        evalDomain: domainNumberToRealNumber,
        numeric: true,
        complexity: 5050,
        simplify: (ce, ops) =>
          constructibleValues(ce, 'Cos', ops[0]) ??
          ce.box(['Sin', ['Add', ops[0], ['Multiply', 'Half', 'Pi']]])
            .canonical,
        evaluate: ['Sin', ['Add', '_1', ['Multiply', 'Half', 'Pi']]],
        N: (ce, ops) => {
          if (ops[0].decimalValue) return ce.number(ops[0].decimalValue.cos());
          if (ops[0].complexValue) return ce.number(ops[0].complexValue.cos());
          if (ops[0].asFloat !== null)
            return ce.number(Math.cos(ops[0].asFloat));
          return undefined;
        },
      },

      {
        name: 'Tan',
        // Range: 'RealNumber',
        evalDomain: domainRealToRealComplexToComplex,
        numeric: true,
        complexity: 5100,
        simplify: (ce, ops) =>
          constructibleValues(ce, 'Tan', ops[0]) ??
          ce.box(['Divide', ['Sin', ops[0]], ['Cos', ops[0]]]).canonical,
        evaluate: ['Divide', ['Sin', '_1'], ['Cos', '_1']],
        N: (ce, ops) => {
          if (ops[0].decimalValue) return ce.number(ops[0].decimalValue.tan());
          if (ops[0].complexValue) return ce.number(ops[0].complexValue.tan());
          if (ops[0].asFloat !== null)
            return ce.number(Math.tan(ops[0].asFloat));
          return undefined;
        },
      },
      /* converts (x, y) -> (radius, angle) */
      // ToPolarCoordinates: {
      //   domain: 'Function',
      //   outputDomain: ['TupleOf', 'RealNumber', 'RealNumber'],
      // }
    ],
  },
  //
  // Functions defined using arithmetic functions or basic
  // trigonometric functions above
  //
  {
    functions: [
      {
        name: 'Arcosh',
        evalDomain: domainNumberToRealNumber,
        numeric: true,
        complexity: 6200,
        simplify: (ce, ops) =>
          constructibleValues(ce, 'Arcoshh', ops[0]) ??
          ce.box([
            'Ln',
            ['Add', ops[0], ['Sqrt', ['Subtract', ['Square', ops[0]], 1]]],
          ]).canonical,
        evaluate: [
          'Ln',
          ['Add', '_1', ['Sqrt', ['Subtract', ['Square', '_1'], 1]]],
        ],
        N: (ce, ops) => {
          if (ops[0].decimalValue)
            return ce.number(ops[0].decimalValue.acosh());
          if (ops[0].complexValue)
            return ce.number(ops[0].complexValue.acosh());
          if (ops[0].asFloat !== null)
            return ce.number(Math.acosh(ops[0].asFloat));
          return undefined;
        },
      },
      {
        name: 'Arcsin',
        evalDomain: domainNumberToRealNumber,
        numeric: true,
        complexity: 5500,
        simplify: (ce, ops) =>
          constructibleValues(ce, 'Arcsin', ops[0]) ??
          ce.box([
            'Multiply',
            2,
            [
              'Arctan2',
              ops[0],
              ['Add', 1, ['Sqrt', ['Subtract', 1, ['Square', ops[0]]]]],
            ],
          ]).canonical,
        evaluate: [
          'Multiply',
          2,
          [
            'Arctan2',
            '_1',
            ['Add', 1, ['Sqrt', ['Subtract', 1, ['Square', '_1']]]],
          ],
        ],
        N: (ce, ops) => {
          if (ops[0].decimalValue) return ce.number(ops[0].decimalValue.asin());
          if (ops[0].complexValue) return ce.number(ops[0].complexValue.asin());
          if (ops[0].asFloat !== null)
            return ce.number(Math.asin(ops[0].asFloat));
          return undefined;
        },
      },
      //Note: Arsinh, not Arcsinh
      {
        name: 'Arsinh',
        evalDomain: domainNumberToRealNumber,
        numeric: true,
        complexity: 6100,
        simplify: (ce, ops) =>
          constructibleValues(ce, 'Arsinh', ops[0]) ??
          ce.box([
            'Ln',
            ['Add', ops[0], ['Sqrt', ['Add', ['Square', ops[0]], 1]]],
          ]).canonical,
        evaluate: ['Ln', ['Add', '_1', ['Sqrt', ['Add', ['Square', '_1'], 1]]]],
        N: (ce, ops) => {
          if (ops[0].decimalValue)
            return ce.number(ops[0].decimalValue.asinh());
          if (ops[0].complexValue)
            return ce.number(ops[0].complexValue.asinh());
          if (ops[0].asFloat !== null)
            return ce.number(Math.asinh(ops[0].asFloat));
          return undefined;
        },
      },
      {
        name: 'Artanh',
        evalDomain: domainNumberToRealNumber,
        numeric: true,
        complexity: 6300,
        simplify: (ce, ops) =>
          constructibleValues(ce, 'Artanh', ops[0]) ??
          ce.box([
            'Multiply',
            'Half',
            ['Ln', ['Divide', ['Add', 1, ops[0]], ['Subtract', 1, ops[0]]]],
          ]).canonical,
        evaluate: [
          'Multiply',
          'Half',
          ['Ln', ['Divide', ['Add', 1, '_1'], ['Subtract', 1, '_1']]],
        ],
        N: (ce, ops) => {
          if (ops[0].decimalValue)
            return ce.number(ops[0].decimalValue.atanh());
          if (ops[0].complexValue)
            return ce.number(ops[0].complexValue.atanh());
          if (ops[0].asFloat !== null)
            return ce.number(Math.atanh(ops[0].asFloat));
          return undefined;
        },
      },
      {
        name: 'Cosh',
        evalDomain: domainNumberToRealNumber,
        numeric: true,
        complexity: 6050,
        simplify: (ce, ops) => constructibleValues(ce, 'Cosh', ops[0]),
        evaluate: [
          'Multiply',
          'Half',
          ['Add', ['Exp', '_1'], ['Exp', ['Negate', '_1']]],
        ],
        N: (ce, ops) => {
          if (ops[0].decimalValue) return ce.number(ops[0].decimalValue.cosh());
          if (ops[0].complexValue) return ce.number(ops[0].complexValue.cosh());
          if (ops[0].asFloat !== null)
            return ce.number(Math.cosh(ops[0].asFloat));
          return undefined;
        },
      },
      {
        name: 'Cot',
        evalDomain: domainRealToRealComplexToComplex,
        numeric: true,
        complexity: 5600,
        simplify: (ce, ops) =>
          constructibleValues(ce, 'Cot', ops[0]) ??
          ce.box(['Divide', ['Cos', ops[0]], ['Sin', ops[0]]]).canonical,
        evaluate: ['Divide', ['Cos', '_1'], ['Sin', '_1']],
        N: (ce, ops) => {
          if (ops[0].decimalValue)
            return ce.number(ce.DECIMAL_ONE.div(ops[0].decimalValue.tan()));
          if (ops[0].complexValue)
            return ce.number(ops[0].complexValue.tan().inverse());
          if (ops[0].asFloat !== null)
            return ce.number(1 / Math.tan(ops[0].asFloat));
          return undefined;
        },
      },
      {
        name: 'Csc',
        description: 'Cosecant',
        evalDomain: domainNumberToRealNumber,
        numeric: true,
        complexity: 5600,
        simplify: (ce, ops) =>
          constructibleValues(ce, 'Csc', ops[0]) ??
          ce.box(['Divide', 1, ['Sin', ops[0]]]).canonical,
        evaluate: ['Divide', 1, ['Sin', '_1']],
        N: (ce, ops) => {
          if (ops[0].decimalValue)
            return ce.number(ce.DECIMAL_ONE.div(ops[0].decimalValue.sin()));
          if (ops[0].complexValue)
            return ce.number(ops[0].complexValue.sin().inverse());
          if (ops[0].asFloat !== null)
            return ce.number(1 / Math.sin(ops[0].asFloat));
          return undefined;
        },
      },
      /** = sin(z/2)^2 = (1 - cos z) / 2*/
      {
        name: 'Haversine',
        wikidata: 'Q2528380',
        // Range ['Interval', 0, 1],
        evalDomain: domainNumberToRealNumber,
        evaluate: ['Divide', ['Subtract', 1, ['Cos', '_1']], 2],
        numeric: true,
      },
      /** = 2 * Arcsin(Sqrt(z)) */
      {
        name: 'InverseHaversine',
        //  Range ['Interval', [['Negate', 'Pi'], 'Pi'],
        evalDomain: domainRealToRealComplexToComplex,
        numeric: true,
        evaluate: ['Multiply', 2, ['Arcsin', ['Sqrt', '_1']]],
      },
      {
        name: 'Sec',
        description: 'Secant, inverse of cosine',
        evalDomain: domainRealToRealComplexToComplex,
        numeric: true,
        complexity: 5500,
        simplify: (ce, ops) =>
          constructibleValues(ce, 'Sec', ops[0]) ??
          ce.box(['Divide', 1, ['Cos', ops[0]]]).canonical,
        evaluate: ['Divide', 1, ['Cos', '_1']],
        N: (ce, ops) => {
          if (ops[0].decimalValue)
            return ce.number(ce.DECIMAL_ONE.div(ops[0].decimalValue.cos()));
          if (ops[0].complexValue)
            return ce.number(ops[0].complexValue.cos().inverse());
          if (ops[0].asFloat !== null)
            return ce.number(1 / Math.cos(ops[0].asFloat));
          return undefined;
        },
      },
      {
        name: 'Sinh',
        // Range: ['Interval', -Infinity, Infinity],
        evalDomain: domainRealToRealComplexToComplex,
        numeric: true,
        complexity: 6000,
        simplify: (ce, ops) =>
          constructibleValues(ce, 'Sinh', ops[0]) ??
          ce.box([
            'Multiply',
            'Half',
            ['Subtract', ['Exp', ops[0]], ['Exp', ['Negate', ops[0]]]],
          ]).canonical,
        evaluate: [
          'Multiply',
          'Half',
          ['Subtract', ['Exp', '_1'], ['Exp', ['Negate', '_1']]],
        ],
      },
    ],
  },
  {
    functions: [
      {
        name: 'Csch',
        evalDomain: domainNumberToRealNumber,
        numeric: true,
        complexity: 6200,
        simplify: (ce, ops) =>
          constructibleValues(ce, 'Csch', ops[0]) ??
          ce.box(['Divide', 1, ['Sinh', ops[0]]]).canonical,
        evaluate: ['Divide', 1, ['Sinh', '_1']],
        N: (ce, ops) => {
          if (ops[0].decimalValue)
            return ce.number(ce.DECIMAL_ONE.div(ops[0].decimalValue.sinh()));
          if (ops[0].complexValue)
            return ce.number(ops[0].complexValue.sinh().inverse());
          if (ops[0].asFloat !== null)
            return ce.number(1 / Math.sinh(ops[0].asFloat));
          return undefined;
        },
      },
      {
        name: 'Sech',
        // Range: ['Interval', -1, 1],
        evalDomain: domainRealToRealComplexToComplex,
        numeric: true,
        complexity: 6200,
        simplify: (ce, ops) =>
          constructibleValues(ce, 'Sech', ops[0]) ??
          ce.box(['Divide', 1, ['Cosh', ops[0]]]).canonical,
        evaluate: ['Divide', 1, ['Cosh', '_1']],
        N: (ce, ops) => {
          if (ops[0].decimalValue)
            return ce.number(ce.DECIMAL_ONE.div(ops[0].decimalValue.cosh()));
          if (ops[0].complexValue)
            return ce.number(ops[0].complexValue.cosh().inverse());
          if (ops[0].asFloat !== null)
            return ce.number(1 / Math.cosh(ops[0].asFloat));
          return undefined;
        },
      },
      {
        name: 'Tanh',
        // Range: ['Interval', -Infinity, Infinity],
        evalDomain: domainRealToRealComplexToComplex,
        numeric: true,
        complexity: 6200,
        simplify: (ce, ops) =>
          constructibleValues(ce, 'Tanh', ops[0]) ??
          ce.box(['Divide', ['Sinh', ops[0]], ['Cosh', ops[0]]]).canonical,
        evaluate: ['Divide', ['Sinh', '_1'], ['Cosh', '_1']],
        N: (ce, ops) => {
          if (ops[0].decimalValue) return ce.number(ops[0].decimalValue.tanh());
          if (ops[0].complexValue) return ce.number(ops[0].complexValue.tanh());
          if (ops[0].asFloat !== null)
            return ce.number(Math.tanh(ops[0].asFloat));
          return undefined;
        },
      },
    ],
  },
  {
    functions: [
      {
        name: 'Arccos',
        evalDomain: domainNumberToRealNumber,
        numeric: true,
        complexity: 5550,
        evaluate: ['Subtract', ['Divide', 'Pi', 2], ['Arcsin', '_1']],
        simplify: (ce, ops) =>
          constructibleValues(ce, 'Arccos', ops[0]) ??
          ce.box(['Subtract', ['Divide', 'Pi', 2], ['Arcsin', ops[0]]])
            .canonical,
        N: (ce, ops) => {
          if (ops[0].decimalValue) return ce.number(ops[0].decimalValue.acos());
          if (ops[0].complexValue) return ce.number(ops[0].complexValue.acos());
          if (ops[0].asFloat !== null)
            return ce.number(Math.acos(ops[0].asFloat));
          return undefined;
        },
      },
      // Arccot: {
      //   domain: 'RealNumber',
      //   numeric: true,
      // },
      // Note Arcoth, not Arccoth
      // Arcoth: {
      //   domain: 'RealNumber',
      //   numeric: true,
      // },
      // Arcsec: {
      //   domain: 'RealNumber',
      //   numeric: true,
      // },
      // Arsech: {
      //   domain: 'RealNumber',
      //   numeric: true,
      // },
      // Arccsc: {
      //   domain: 'RealNumber',
      //   numeric: true,
      // },
      // Arcsch: {
      //   domain: 'RealNumber',
      //   numeric: true,
      // },

      {
        name: 'Coth',
        evalDomain: domainRealToRealComplexToComplex,
        numeric: true,
        complexity: 6300,
        simplify: (ce, ops) =>
          constructibleValues(ce, 'Coth', ops[0]) ??
          ce.box(['Divide', 1, ['Tanh', ops[0]]]).canonical,
        evaluate: ['Divide', 1, ['Tanh', '_1']],
        N: (ce, ops) => {
          if (ops[0].decimalValue)
            return ce.number(ce.DECIMAL_ONE.div(ops[0].decimalValue.tanh()));
          if (ops[0].complexValue)
            return ce.number(ops[0].complexValue.tanh().inverse());
          if (ops[0].asFloat !== null)
            return ce.number(1 / Math.tanh(ops[0].asFloat));
          return undefined;
        },
      },
      /* converts (radius, angle) -> (x, y) */
      // FromPolarCoordinates: {
      //   domain: 'Function',
      //   outputDomain: ['TupleOf', 'RealNumber', 'RealNumber'],
      // },
      {
        name: 'InverseFunction',
        domain: 'Number',
        // evalDomain: () => 'RealNumber', //@todo ExtendedRealNumber?
        simplify: (ce, ops) => processInverseFunction(ce, ops[0]),
        evaluate: (ce, ops) => processInverseFunction(ce, ops[0]),
      },
    ],
  },
];

const S2: Expression = ['Sqrt', 2];
const S3: Expression = ['Sqrt', 3];
const S5: Expression = ['Sqrt', 5];
const S6: Expression = ['Sqrt', 6];
// From https://en.wikipedia.org/wiki/Trigonometric_functions
const CONSTRUCTIBLE_VALUES: [
  key: [numerator: number, denominator: number],
  values: { [head: string]: Expression | LatexString }
][] = [
  [
    [0, 1],
    {
      Sin: 0,
      Cos: 1,
      Tan: 0,
      Cot: NaN,
      Sec: 1,
      Csc: NaN,
    },
  ],
  [
    [1, 12],
    {
      Sin: ['Divide', ['Subtract', S6, S2], 4],
      Cos: ['Divide', ['Add', S6, S2], 4],
      Tan: ['Subtract', 2, S3],
      Cot: ['Add', 2, S3],
      Sec: ['Subtract', S6, S2],
      Csc: ['Add', S6, S2],
    },
  ],
  [
    [1, 10],
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
    [1, 8],
    {
      Sin: '$\\frac\\sqrt{2-\\sqrt2}{2}$',
      Cos: '$\\frac {\\sqrt {2+{\\sqrt {2}}}}{2}$',
      Tan: '$\\sqrt{2} - 1$',
      Cot: '$\\sqrt{2} + 1$',
      Sec: '$\\sqrt{ 4 - 2\\sqrt{2}$',
      Csc: '$\\sqrt{ 4 + 2\\sqrt{2}$',
    },
  ],
  [
    [1, 6],
    {
      Sin: '$\\frac{1}{2}$',
      Cos: '$\\frac{\\sqrt{3}}{2}$',
      Tan: '$\\frac{\\sqrt{3}}{3}$',
      Cot: '$\\frac{2\\sqrt{3}}{3}$',
      Sec: '$\\sqrt{3}$',
      Csc: 2,
    },
  ],
  [
    [1, 5],
    {
      Sin: '$\\frac{\\sqrt{10- 2\\sqrt{5}}} {4}$',
      Cos: '$\\frac{1+ \\sqrt{5}} {4}$',
      Tan: '$\\sqrt{5-2\\sqrt5}$',
      Cot: '$\\frac{\\sqrt{25+10\\sqrt5}} {5}$',
      Sec: '$\\sqrt{5} - 1$',
      Csc: '$\\frac{\\sqrt{50+10\\sqrt{5}}} {5}$',
    },
  ],
  [
    [1, 4],
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
    [3, 10],
    {
      Sin: '$\\frac{1+ \\sqrt{5}} {4}$',
      Cos: '$\\frac{\\sqrt{10- 2\\sqrt{5}}} {4}$',
      Tan: '$\\frac{\\sqrt{25+10\\sqrt5}} {5}$',
      Cot: '$\\sqrt{5-2\\sqrt5}$',
      Sec: '$$',
      Csc: '$\\frac{\\sqrt{50+10\\sqrt{5}}} {5}$',
    },
  ],
  [
    [1, 3],
    {
      Sin: ['Divide', S3, 2], // '$\\frac{\\sqrt{3}}{2}$'
      Cos: 'Half', // '$\\frac{1}{2}$'
      Tan: S3, // '$\\sqrt{3}$'
      Cot: ['Divide', S3, 3], // '$\\frac{\\sqrt{3}}{3}$'
      Sec: 2,
      Csc: ['Divide', ['Multiply', 2, S3], 3], // '$\\frac{2\\sqrt{3}}{3}$'
    },
  ],
  [
    [3, 8],
    {
      Sin: '$\\frac{ \\sqrt{2 + \\sqrt{2}} } {2}$',
      Cos: '$\\frac{ \\sqrt{2 - \\sqrt{2}} } {2}$',
      Tan: '$\\sqrt{2} + 1$',
      Cot: '$\\sqrt{2} - 1$',
      Sec: '$\\sqrt{ 4 + 2 \\sqrt{2} }$',
      Csc: '$\\sqrt{ 4 - 2 \\sqrt{2} }$',
    },
  ],
  [
    [2, 5],
    {
      Sin: '$\\frac{\\sqrt{10+ 2\\sqrt{5}}} {4}$',
      Cos: '$\\frac{\\sqrt{5}-1} {4}$',
      Tan: '$\\sqrt{5+2\\sqrt{5}}$',
      Cot: '$\\frac{\\sqrt{25-10\\sqrt{5}}} {5}$',
      Sec: '$1 + \\sqrt{5}$',
      Csc: '$\\frac{\\sqrt{50-10\\sqrt{5}}} {5}$',
    },
  ],
  [
    [5, 12],
    {
      Sin: '$\\frac{\\sqrt{6} + \\sqrt{2}} {4}$',
      Cos: '$\\frac{ \\sqrt{6} - \\sqrt{2}} {4}$',
      Tan: '$2+\\sqrt{3}$',
      Cot: '$2-\\sqrt{3}$',
      Sec: '$\\sqrt{6}+\\sqrt{2}$',
      Csc: '$\\sqrt{6} - \\sqrt{2}$',
    },
  ],
  [
    [1, 2],
    {
      Sin: 1,
      Cos: 0,
      Tan: NaN,
      Cot: 0,
      Sec: NaN,
      Csc: 1,
    },
  ],
];

// For each trig function, by quadrant (0-π/2, π/2-π, π-3π/2, 3π/2-2π),
// what is the corresponding identity (sign and function)
// E.g 'Sin[θ+π/2] = Cos[θ]` -> Quadrant 2, Positive sign, Cos
const TRIG_IDENTITIES: { [key: string]: [sign: number, head: string][] } = {
  Sin: [
    [+1, 'Sin'],
    [+1, 'Cos'],
    [-1, 'Sin'],
    [-1, 'Cos'],
  ],
  Cos: [
    [+1, 'Cos'],
    [-1, 'Sin'],
    [-1, 'Cos'],
    [+1, 'Sin'],
  ],
  Sec: [
    [+1, 'Sec'],
    [-1, 'Csc'],
    [-1, 'Sec'],
    [+1, 'Csc'],
  ],
  Csc: [
    [+1, 'Csc'],
    [+1, 'Sec'],
    [-1, 'Csc'],
    [-1, 'Sec'],
  ],
  Tan: [
    [+1, 'Tan'],
    [-1, 'Cot'],
    [+1, 'Tan'],
    [-1, 'Cot'],
  ],
  Cot: [
    [+1, 'Cot'],
    [-1, 'Tan'],
    [+1, 'Cot'],
    [-1, 'Tan'],
  ],
};

function constructibleValues(
  ce: IComputeEngine,
  head: string,
  x: BoxedExpression | undefined
): undefined | BoxedExpression {
  if (!x || x.isMissing) return undefined;

  const specialValues = ce.cache(
    'constructible-trigonometric-values',
    () => {
      const values: [
        [numerator: number, denominator: number],
        { [head: string]: BoxedExpression }
      ][] = [];

      for (const [val, results] of CONSTRUCTIBLE_VALUES) {
        const boxedResults = {};
        for (const head of Object.keys(results)) {
          // console.log(`Caching  ${head}(${val}) = ${results[head]}`);
          boxedResults[head] = (
            ce.parse(latexString(results[head])) ?? ce.box(results[head])
          ).canonical;
        }

        values.push([val, boxedResults]);
      }
      return values;
    },
    (cache) => {
      for (const [_k, v] of cache) {
        for (const v2 of Object.values(v)) (v2 as BoxedExpression)._purge();
      }
      return cache;
    }
  );
  x = x.numericValue ?? x;
  if (!x.isLiteral) return undefined;
  let theta = x.asFloat;
  if (theta === null) return undefined;
  theta = theta % (2 * Math.PI);
  // Odd-even identities
  const identitySign = head !== 'Cos' && head !== 'Sec' ? Math.sign(theta) : +1;
  theta = Math.abs(theta);

  const quadrant = Math.floor((theta * 2) / Math.PI); // 0-3
  theta = theta % (Math.PI / 2);

  let sign: number;
  [sign, head] = TRIG_IDENTITIES[head][quadrant];
  sign = sign * identitySign;
  for (const [[n, d], result] of specialValues) {
    if (ce.chop(theta - (Math.PI * n) / d) === 0) {
      // Cos and Sec are even functions, the others are odd
      return sign < 0 ? canonicalNegate(result[head]) : result[head];
    }
  }
}

function processInverseFunction(
  ce: IComputeEngine,
  expr: BoxedExpression
): BoxedExpression | undefined {
  const head = expr.op1.head;
  if (typeof head !== 'string') return expr;
  const newHead = {
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
  }[head];
  if (newHead) return ce._fn(newHead, [expr.op1.op1]);
  return expr;
}
