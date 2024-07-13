import Complex from 'complex.js';
import { Decimal } from 'decimal.js';
import {
  BoxedExpression,
  IdentifierDefinitions,
  DomainExpression,
  IComputeEngine,
  LatexString,
} from '../public';
import { asLatexString, bignumPreferred } from '../boxed-expression/utils';
import { Expression } from '../../math-json/math-json-format';
import { applyN, apply2N } from '../symbolic/utils';
import { checkArity } from '../boxed-expression/validate';
import { reducedRational } from '../numerics/rationals';
import { asFloat } from '../boxed-expression/numerics';

//
//Note: Names of trigonometric functions follow ISO 80000 Section 13
//

const domainNumberToRealNumber = (_head: string): DomainExpression => {
  return ['FunctionOf', 'Numbers', 'ExtendedRealNumbers'];
};

const trigFunction = (_head: string): DomainExpression => {
  return ['FunctionOf', 'Numbers', 'Numbers'];
};

const hyperbolicFunction = (_head: string): DomainExpression => {
  return ['FunctionOf', 'Numbers', 'Numbers'];
};

export const TRIGONOMETRY_LIBRARY: IdentifierDefinitions[] = [
  {
    //
    // Constants
    //
    Pi: {
      domain: 'TranscendentalNumbers',
      flags: { algebraic: false },
      constant: true,
      holdUntil: 'N',
      wikidata: 'Q167',
      value: (engine) =>
        bignumPreferred(engine) ? engine._BIGNUM_PI : Math.PI,
    },
  },
  {
    Degrees: {
      /* = Pi / 180 */
      signature: {
        domain: ['FunctionOf', 'Numbers', 'Numbers'],
        canonical: (ce, ops) => {
          if (ce.angularUnit === 'deg') return ops[0];
          if (ops.length !== 1) return ce._fn('Degrees', ops);
          const arg = ops[0];
          if (arg.numericValue === null || !arg.isValid)
            return ce._fn('Degrees', ops);
          let fArg = asFloat(arg);
          if (fArg !== null) {
            // Constrain fArg to [0, 360]
            fArg = fArg % 360;
            if (fArg < 0) fArg += 360;
            // Convert fArg to radians
            if (Number.isInteger(fArg)) {
              const fRadians = reducedRational([fArg, 180]);
              if (fRadians[0] === 0) return ce.Zero;
              if (fRadians[0] === 1 && fRadians[1] === 1) return ce.Pi;
              if (fRadians[0] === 1)
                return ce.div(ce.Pi, ce.number(fRadians[1]));
              return ce.evalMul(ce.number(fRadians), ce.Pi);
            }
            return ce.evalMul(ce.div(ce.number(fArg), ce.number(180)), ce.Pi);
          }
          return ce.div(ce.evalMul(arg, ce.Pi), ce.number(180));
        },
        evaluate: (ce, ops) => {
          if (ce.angularUnit === 'deg') return ops[0];
          return ce.evalMul(ops[0], ce.div(ce.Pi, ce.number(180))).evaluate();
        },
      },
    },
    // Hypot: sqrt(x*x + y*y)
    Hypot: {
      threadable: true,
      signature: {
        domain: ['FunctionOf', 'Numbers', 'Numbers', 'NonNegativeNumbers'],
        simplify: (ce, ops) =>
          ce
            .box(['Sqrt', ['Add', ['Square', ops[0]], ['Square', ops[1]]]])
            .simplify(),
        evaluate: ['Sqrt', ['Add', ['Square', '_1'], ['Square', '_2']]],
      },
    },
    Sin: {
      complexity: 5000,
      threadable: true,
      signature: {
        domain: ['FunctionOf', 'Numbers', 'Numbers'],
        simplify: (ce, ops) => constructibleValues(ce, 'Sin', ops[0]),
        evaluate: (ce, ops) => evalTrig(ce, 'evaluate', 'Sin', ops[0]),
        N: (ce, ops) => evalTrig(ce, 'N', 'Sin', ops[0]),
      },
    },
  },
  {
    //
    // Basic trigonometric function
    // (may be used in the definition of other functions below)
    //
    Arctan: {
      wikidata: 'Q2257242',
      complexity: 5200,
      threadable: true,
      signature: {
        domain: domainNumberToRealNumber('Arctan'),
        simplify: (ce, ops) => constructibleValues(ce, 'Arctan', ops[0]),
        evaluate: (ce, ops) => evalTrig(ce, 'evaluate', 'Arctan', ops[0]),
        N: (ce, ops) => evalTrig(ce, 'N', 'Arctan', ops[0]),
      },
    },
    Arctan2: {
      wikidata: 'Q776598',
      complexity: 5200,
      threadable: true,
      signature: {
        domain: ['FunctionOf', 'Numbers', 'Numbers', 'Numbers'],
        N: (_ce, ops) =>
          apply2N(ops[0], ops[1], Math.atan2, (a, b) => Decimal.atan2(a, b)),
      },
    },
    Cos: {
      complexity: 5050,
      threadable: true,
      signature: {
        domain: ['FunctionOf', 'Numbers', 'Numbers'],
        simplify: (ce, ops) => constructibleValues(ce, 'Cos', ops[0]),
        evaluate: (ce, ops) => evalTrig(ce, 'evaluate', 'Cos', ops[0]),
        N: (ce, ops) => evalTrig(ce, 'N', 'Cos', ops[0]),
      },
    },

    Tan: {
      // Range: 'RealNumbers',
      complexity: 5100,
      threadable: true,
      signature: {
        domain: trigFunction('Tan'),
        simplify: (ce, ops) => constructibleValues(ce, 'Tan', ops[0]),
        evaluate: (ce, ops) => evalTrig(ce, 'evaluate', 'Tan', ops[0]),
        N: (ce, ops) => evalTrig(ce, 'N', 'Tan', ops[0]),
      },
    },
    /* converts (x, y) -> (radius, angle) */
    // ToPolarCoordinates: {
    //   domain: 'Functions',
    //   outputDomain: ['TupleOf', 'RealNumbers', 'RealNumbers'],
    // }
  },
  //
  // Functions defined using arithmetic functions or basic
  // trigonometric functions above
  //
  {
    Arcosh: {
      complexity: 6200,
      threadable: true,
      signature: {
        domain: hyperbolicFunction('Arcosh'),
        simplify: (ce, ops) => constructibleValues(ce, 'Arcosh', ops[0]),
        evaluate: (ce, ops) => evalTrig(ce, 'evaluate', 'Arcosh', ops[0]),
        N: (ce, ops) => evalTrig(ce, 'N', 'Arcosh', ops[0]),
      },
    },
    Arcsin: {
      complexity: 5500,
      threadable: true,
      signature: {
        domain: hyperbolicFunction('Arcsin'),
        simplify: (ce, ops) => constructibleValues(ce, 'Arcsin', ops[0]),
        evaluate: (ce, ops) => evalTrig(ce, 'evaluate', 'Arcsin', ops[0]),
        N: (ce, ops) => evalTrig(ce, 'N', 'Arcsin', ops[0]),
      },
    },
    //Note: Arsinh, not ArCsinh
    Arsinh: {
      complexity: 6100,
      threadable: true,
      signature: {
        domain: hyperbolicFunction('Arsinh'),
        simplify: (ce, ops) => constructibleValues(ce, 'Arsinh', ops[0]),
        evaluate: (ce, ops) => evalTrig(ce, 'evaluate', 'Arsinh', ops[0]),
        N: (ce, ops) => evalTrig(ce, 'N', 'Arsinh', ops[0]),
      },
    },
    Artanh: {
      complexity: 6300,
      threadable: true,
      signature: {
        domain: hyperbolicFunction('Artanh'),
        simplify: (ce, ops) => constructibleValues(ce, 'Artanh', ops[0]),
        evaluate: (ce, ops) => evalTrig(ce, 'evaluate', 'Artanh', ops[0]),
        N: (ce, ops) => evalTrig(ce, 'N', 'Artanh', ops[0]),
      },
    },
    Cosh: {
      complexity: 6050,
      threadable: true,
      signature: {
        domain: hyperbolicFunction('Cosh'),
        simplify: (ce, ops) => constructibleValues(ce, 'Cosh', ops[0]),
        evaluate: (ce, ops) => evalTrig(ce, 'evaluate', 'Cosh', ops[0]),
        N: (ce, ops) => evalTrig(ce, 'N', 'Cosh', ops[0]),
      },
    },
    Cot: {
      complexity: 5600,
      threadable: true,
      signature: {
        domain: trigFunction('Cot'),
        simplify: (ce, ops) => constructibleValues(ce, 'Cot', ops[0]),
        evaluate: (ce, ops) => evalTrig(ce, 'evaluate', 'Cot', ops[0]),
        N: (ce, ops) => evalTrig(ce, 'N', 'Cot', ops[0]),
      },
    },
    Csc: {
      description: 'Cosecant',
      complexity: 5600,
      threadable: true,
      signature: {
        domain: trigFunction('Csc'),
        simplify: (ce, ops) => constructibleValues(ce, 'Csc', ops[0]),
        evaluate: (ce, ops) => evalTrig(ce, 'evaluate', 'Csc', ops[0]),
        N: (ce, ops) => evalTrig(ce, 'N', 'Csc', ops[0]),
      },
    },
    Sec: {
      description: 'Secant, inverse of cosine',
      complexity: 5500,
      threadable: true,
      signature: {
        domain: trigFunction('Sec'),
        simplify: (ce, ops) => constructibleValues(ce, 'Sec', ops[0]),
        evaluate: (ce, ops) => evalTrig(ce, 'evaluate', 'Sec', ops[0]),
        N: (ce, ops) => evalTrig(ce, 'N', 'Sec', ops[0]),
      },
    },
    Sinh: {
      // Range: ['Interval', -Infinity, Infinity],
      complexity: 6000,
      threadable: true,
      signature: {
        domain: hyperbolicFunction('Sinh'),
        simplify: (ce, ops) => constructibleValues(ce, 'Sinh', ops[0]),
        evaluate: (ce, ops) => evalTrig(ce, 'evaluate', 'Sinh', ops[0]),
        N: (ce, ops) => evalTrig(ce, 'N', 'Sinh', ops[0]),
      },
    },
    /** = sin(z/2)^2 = (1 - cos z) / 2*/
    Haversine: {
      wikidata: 'Q2528380',
      threadable: true,
      signature: {
        domain: ['FunctionOf', 'ExtendedRealNumbers', 'Numbers'],
        evaluate: ['Divide', ['Subtract', 1, ['Cos', '_1']], 2],
      },
    },
    /** = 2 * Arcsin(Sqrt(z)) */
    InverseHaversine: {
      //  Range ['Interval', [['Negate', 'Pi'], 'Pi'],
      threadable: true,
      signature: {
        domain: ['FunctionOf', 'ExtendedRealNumbers', 'RealNumbers'],
        evaluate: ['Multiply', 2, ['Arcsin', ['Sqrt', '_1']]],
      },
    },
  },
  {
    Csch: {
      complexity: 6200,
      threadable: true,
      signature: {
        domain: domainNumberToRealNumber('Csch'),
        simplify: (ce, ops) =>
          constructibleValues(ce, 'Csch', ops[0]) ??
          ce.box(['Divide', 1, ['Sinh', ops[0]]]).simplify(),
        evaluate: (ce, ops) => evalTrig(ce, 'evaluate', 'Csch', ops[0]),
        N: (ce, ops) => evalTrig(ce, 'N', 'Csch', ops[0]),
      },
    },
    Sech: {
      complexity: 6200,
      threadable: true,
      signature: {
        domain: ['FunctionOf', 'Numbers', 'Numbers'],
        simplify: (ce, ops) => constructibleValues(ce, 'Sech', ops[0]),
        evaluate: (ce, ops) => evalTrig(ce, 'evaluate', 'Sech', ops[0]),
        N: (ce, ops) => evalTrig(ce, 'N', 'Sech', ops[0]),
      },
    },
    Tanh: {
      // Range: ['Interval', -Infinity, Infinity],
      complexity: 6200,
      threadable: true,
      signature: {
        domain: hyperbolicFunction('Tanh'),
        simplify: (ce, ops) => constructibleValues(ce, 'Tanh', ops[0]),
        evaluate: (ce, ops) => evalTrig(ce, 'evaluate', 'Tanh', ops[0]),
        N: (ce, ops) => evalTrig(ce, 'N', 'Tanh', ops[0]),
      },
    },
  },
  {
    Arccos: {
      complexity: 5550,
      threadable: true,
      signature: {
        domain: domainNumberToRealNumber('Arccos'),
        simplify: (ce, ops) => constructibleValues(ce, 'Arccos', ops[0]),
        evaluate: (ce, ops) => evalTrig(ce, 'evaluate', 'Arccos', ops[0]),
        N: (ce, ops) => evalTrig(ce, 'N', 'Arccos', ops[0]),
      },
    },
    Arccot: {
      numeric: true,
      threadable: true,
      signature: {
        domain: domainNumberToRealNumber('Arccot'),
        evaluate: (ce, ops) => evalTrig(ce, 'evaluate', 'Arccot', ops[0]),
        N: (ce, ops) => evalTrig(ce, 'N', 'Arccot', ops[0]),
      },
    },

    Arcoth: {
      numeric: true,
      threadable: true,
      signature: {
        domain: domainNumberToRealNumber('Arcoth'),
        evaluate: (ce, ops) => evalTrig(ce, 'evaluate', 'Arcoth', ops[0]),
        N: (ce, ops) => evalTrig(ce, 'N', 'Arcoth', ops[0]),
      },
    },

    Arcsch: {
      numeric: true,
      threadable: true,
      signature: {
        domain: domainNumberToRealNumber('Arcsch'),
        evaluate: (ce, ops) => evalTrig(ce, 'evaluate', 'Arcsch', ops[0]),
        N: (ce, ops) => evalTrig(ce, 'N', 'Arcsch', ops[0]),
      },
    },

    Arcsec: {
      numeric: true,
      threadable: true,
      signature: {
        domain: domainNumberToRealNumber('Arcsec'),
        evaluate: (ce, ops) => evalTrig(ce, 'evaluate', 'Arcsec', ops[0]),
        N: (ce, ops) => evalTrig(ce, 'N', 'Arcsec', ops[0]),
      },
    },

    Arsech: {
      numeric: true,
      threadable: true,
      signature: {
        domain: domainNumberToRealNumber('Arsech'),
        evaluate: (ce, ops) => evalTrig(ce, 'evaluate', 'Arsech', ops[0]),
        N: (ce, ops) => evalTrig(ce, 'N', 'Arsech', ops[0]),
      },
    },
    Arccsc: {
      numeric: true,
      threadable: true,
      signature: {
        domain: domainNumberToRealNumber('Arccsc'),
        evaluate: (ce, ops) => evalTrig(ce, 'evaluate', 'Arccsc', ops[0]),
        N: (ce, ops) => evalTrig(ce, 'N', 'Arccsc', ops[0]),
      },
    },

    Coth: {
      complexity: 6300,
      threadable: true,
      signature: {
        domain: hyperbolicFunction('Coth'),
        simplify: (ce, ops) => constructibleValues(ce, 'Coth', ops[0]),
        evaluate: (ce, ops) => evalTrig(ce, 'evaluate', 'Coth', ops[0]),
        N: (ce, ops) => evalTrig(ce, 'N', 'Coth', ops[0]),
      },
    },
    /* converts (radius, angle) -> (x, y) */
    // FromPolarCoordinates: {
    //   domain: 'Function',
    //   outputDomain: ['TupleOf', 'RealNumbers', 'RealNumbers'],
    // },
    InverseFunction: {
      signature: {
        domain: ['FunctionOf', 'Functions', 'Functions'],
        canonical: (ce, ops) => {
          // The canonical handler is responsible for validating the arguments
          ops = checkArity(ce, ops, 1);
          return (
            processInverseFunction(ce, ops) ?? ce._fn('InverseFunction', ops)
          );
        },
        simplify: (ce, ops) => processInverseFunction(ce, ops),
        evaluate: (ce, ops) => processInverseFunction(ce, ops),
      },
    },
  },
];

const S2: Expression = ['Sqrt', 2];
const S3: Expression = ['Sqrt', 3];
const S5: Expression = ['Sqrt', 5];
const S6: Expression = ['Sqrt', 6];
// From https://en.wikipedia.org/wiki/Trigonometric_functions
// and https://en.wikipedia.org/wiki/Exact_trigonometric_values
const CONSTRUCTIBLE_VALUES: [
  key: [numerator: number, denominator: number],
  values: { [head: string]: Expression | LatexString },
][] = [
  [
    [0, 1],
    {
      Sin: 0,
      Cos: 1,
      Tan: 0,
      Cot: 'ComplexInfinity',
      Sec: 1,
      Csc: 'ComplexInfinity',
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
      Tan: ['Divide', ['Sqrt', ['Subtract', 25, ['Multiply', 10, S5]]], 5],
      Cot: ['Sqrt', ['Add', 5, ['Multiply', 2, S5]]],
      Sec: ['Divide', ['Sqrt', ['Subtract', 50, ['Multiply', 10, S5]]], 5],
      Csc: ['Add', 1, S5],
    },
  ],
  [
    [1, 8],
    {
      Sin: '$\\frac{\\sqrt{2-\\sqrt2}}{2}$',
      Cos: '$\\frac{\\sqrt {2+{\\sqrt {2}}}}{2}$',
      Tan: '$\\sqrt{2} - 1$',
      Cot: '$\\sqrt{2} + 1$',
      Sec: '$\\sqrt{ 4 - 2\\sqrt{2}}$',
      Csc: '$\\sqrt{ 4 + 2\\sqrt{2}}$',
    },
  ],
  [
    [1, 6],
    {
      Sin: '$\\frac{1}{2}$',
      Cos: '$\\frac{\\sqrt{3}}{2}$',
      Tan: '$\\frac{\\sqrt{3}}{3}$',
      Cot: '$\\sqrt{3}$',
      Sec: '$\\frac{2\\sqrt{3}}{3}$',
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
      Sin: '$\\frac{1+ \\sqrt5} {4}$',
      Cos: '$\\frac{\\sqrt{10- 2\\sqrt5}} {4}$',
      Tan: '$\\frac{\\sqrt{25+10\\sqrt5}} {5}$',
      Cot: '$\\sqrt{5-2\\sqrt5}$',
      Sec: '$\\frac{\\sqrt{50+10\\sqrt5}} {5}$',
      Csc: '$\\sqrt5-1$',
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
      Tan: 'ComplexInfinity',
      Cot: 0,
      Sec: 'ComplexInfinity',
      Csc: 1,
    },
  ],
];

// For each trig function, by quadrant (0..π/2, π/2..π, π..3π/2, 3π/2..2π),
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

type ConstructibleTrigValues = [
  [numerator: number, denominator: number],
  { [head: string]: BoxedExpression },
][];

function constructibleValues(
  ce: IComputeEngine,
  head: string,
  x: BoxedExpression | undefined
): undefined | BoxedExpression {
  if (!x) return undefined;
  x = angleToRadians(x)!;
  let theta = asFloat(x.N());
  if (theta === null) return undefined;

  //
  // Create the cache of special values
  //
  const specialValues = ce.cache<ConstructibleTrigValues>(
    'constructible-trigonometric-values',
    () => {
      return CONSTRUCTIBLE_VALUES.map(([val, results]) => [
        val,
        Object.fromEntries(
          Object.entries(results).map(([head, r]) => [
            head,
            ce.parse(asLatexString(r)) ?? ce.box(r),
          ])
        ),
      ]);
    },

    (cache: ConstructibleTrigValues) => {
      for (const [_k, v] of cache) {
        for (const v2 of Object.values(v)) v2.reset();
      }
      return cache;
    }
  );

  if (isInverseTrigFunc(head))
    return constructibleValuesInverse(ce, head, x, specialValues);

  // Odd-even identities
  const identitySign = trigFuncParity(head) == -1 ? Math.sign(theta) : +1;

  theta = Math.abs(theta % (2 * Math.PI));

  const quadrant = Math.floor((theta * 2) / Math.PI); // 0..3

  theta = theta % (Math.PI / 2); // 0..π/2

  // Adjusting for the position in the quadrant
  let sign: number;
  [sign, head] = TRIG_IDENTITIES[head]?.[quadrant] ?? [1, head];

  for (const [[n, d], value] of specialValues) {
    const r = value[head];
    if (r && ce.chop(theta - (Math.PI * n) / d) === 0) {
      if (r.symbol === 'ComplexInfinity') return r;
      return identitySign * sign < 0 ? r.neg() : r.evaluate();
    }
  }
  return undefined;
}

function constructibleValuesInverse(
  ce: IComputeEngine,
  head: string,
  x: BoxedExpression | undefined,
  specialValues: ConstructibleTrigValues
): undefined | BoxedExpression {
  if (!x) return undefined;
  let x_N = asFloat(x.N());
  if (x_N === null) return undefined;
  // head is arcFn, and inverse_head is Fn
  const inverse_head = inverseTrigFuncName(head);

  //
  // Create the cache of special values of the head function by inverting
  // specialValues of inverse_head function
  //
  type ConstructibleTrigValuesInverse = [
    [match_arg: BoxedExpression, match_arg_N: number],
    angle: [numerator: number, denominator: number],
  ][];
  const specialInverseValues = ce.cache<ConstructibleTrigValuesInverse>(
    'constructible-inverse-trigonometric-values-' + head,
    () => {
      const cache: ConstructibleTrigValuesInverse = [];
      for (const [[n, d], value] of specialValues) {
        const r = value[inverse_head!];
        if (r === undefined) continue;
        const rn = asFloat(r.N());
        if (rn === null) continue;
        cache.push([
          [r, rn],
          [n, d],
        ]);
      }
      return cache;
    },

    (cache: ConstructibleTrigValuesInverse) => {
      for (const [[match_arg, match_arg_N], [n, d]] of cache) {
        match_arg.reset();
      }
      return cache;
    }
  );

  // Odd-even identities

  let quadrant = 0;
  if (x_N < 0) {
    quadrant = trigFuncParity(inverse_head!) == -1 ? -1 : 1;
    // shift x to quadrant 0 to match the key in specialInverseValues
    x_N = -x_N;
    x = x.neg();
  }

  for (const [[match_arg, match_arg_N], [n, d]] of specialInverseValues) {
    if (ce.chop(x_N - match_arg_N) === 0) {
      // there is an implicit Pi in the numerator
      let theta = ce.box(['Divide', ['Multiply', n, 'Pi'], d]);
      if (quadrant == -1) {
        theta = theta.neg();
      } else if (quadrant == 1) {
        theta = ce.box(['Subtract', 'Pi', theta]);
      }
      return theta.evaluate();
    }
  }
  return undefined;
}

function trigFuncParity(head: string): number {
  // Cos and Sec are even functions, the others are odd
  return head !== 'Cos' && head !== 'Sec' ? -1 : 1;
}

function isInverseTrigFunc(head: string): boolean {
  if (head.startsWith('Ar') && inverseTrigFuncName(head)) return true;
  return false;
}

function inverseTrigFuncName(head: string): string | undefined {
  return {
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
    Arccos: 'Cos',
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
}

function processInverseFunction(
  ce: IComputeEngine,
  xs: ReadonlyArray<BoxedExpression>
): BoxedExpression | undefined {
  if (xs.length !== 1 || !xs[0].isValid) return undefined;
  const expr = xs[0];
  const head = expr.symbol;
  if (typeof head !== 'string') return undefined;
  if (head === 'InverseFunction') return expr.op1;
  const newHead = inverseTrigFuncName(head);
  return newHead ? ce.symbol(newHead) : undefined;
}

function evalTrig(
  ce: IComputeEngine,
  mode: 'N' | 'evaluate',
  head: string,
  op: BoxedExpression | undefined
): BoxedExpression | undefined {
  if (!op) return undefined;
  let result = constructibleValues(ce, head, op);
  if (mode === 'N' && result) result = result.N();
  if (result) return result;
  if (mode === 'evaluate' && op.isExact) return undefined;
  switch (head) {
    case 'Arccos':
      return radiansToAngle(
        applyN(
          op,
          Math.acos,
          (x) => x.acos(),
          (x) => x.acos()
        )
      );
    case 'Arccot':
      return radiansToAngle(
        applyN(
          op,
          (x) => Math.atan2(1, x),
          (x) => Decimal.atan2(ce._BIGNUM_ONE, x),
          (x) => x.inverse().atan()
        )
      );
    case 'Arccsc':
      return radiansToAngle(
        applyN(
          op,
          (x) => Math.asin(1 / x),
          (x) => ce._BIGNUM_ONE.div(x).asin(),
          (x) => x.inverse().asin()
        )
      );
    case 'Arcosh':
      return radiansToAngle(
        applyN(
          op,
          Math.acosh,
          (x) => x.acosh(),
          (x) => x.acosh()
        )
      );
    case 'Arcoth':
      // ln[(1 + x) /(x − 1)] /2
      return radiansToAngle(
        applyN(
          op,
          (x) => Math.log((1 + x) / (x - 1)) / 2,
          (x) => ce._BIGNUM_ONE.add(x).div(x.sub(ce._BIGNUM_ONE)).log().div(2),
          (x) => ce.complex(1).add(x).div(x.sub(1)).log().div(2)
        )
      );

    case 'Arcsch':
      // ln[1/x + √(1/x2 + 1)],
      return radiansToAngle(
        applyN(
          op,
          (x) => Math.log(1 / x + Math.sqrt(1 / (x * x) + 1)),
          (x) =>
            ce._BIGNUM_ONE
              .div(x.mul(x))
              .add(ce._BIGNUM_ONE)
              .sqrt()
              .add(ce._BIGNUM_ONE.div(x))
              .log(),
          (x) => x.mul(x).inverse().add(1).sqrt().add(x.inverse()).log()
        )
      );

    case 'Arcsec':
      return radiansToAngle(
        applyN(
          op,
          (x) => Math.acos(1 / x),
          (x) => ce._BIGNUM_ONE.div(x).acos(),
          (x) => x.inverse().acos()
        )
      );

    case 'Arcsin':
      return radiansToAngle(
        applyN(
          op,
          Math.asin,
          (x) => x.asin(),
          (x) => x.asin()
        )
      );

    case 'Arsech':
      return radiansToAngle(
        applyN(
          op,
          (x) => Math.log((1 + Math.sqrt(1 - x * x)) / x),
          (x) => ce._BIGNUM_ONE.sub(x.mul(x).add(ce._BIGNUM_ONE).div(x)).log(),
          (x) => ce.complex(1).sub(x.mul(x)).add(1).div(x).log()
        )
      );

    case 'Arsinh':
      return radiansToAngle(
        applyN(
          op,
          Math.asinh,
          (x) => x.asinh(),
          (x) => x.asinh()
        )
      );

    case 'Arctan':
      return radiansToAngle(
        applyN(
          op,
          Math.atan,
          (x) => x.atan(),
          (x) => x.atan()
        )
      );

    case 'Artanh':
      return radiansToAngle(
        applyN(
          op,
          Math.atanh,
          (x) => x.atanh(),
          (x) => x.atanh()
        )
      );

    case 'Cos':
      return applyAngle(
        op,
        Math.cos,
        (x) =>
          x
            .toSignificantDigits(ce.precision + 4)
            .cos()
            .toSignificantDigits(ce.precision),
        (x) => x.cos()
      );

    case 'Cosh':
      return applyAngle(
        op,
        Math.cosh,
        (x) => x.cosh(),
        (x) => x.cosh()
      );

    case 'Cot':
      return applyAngle(
        op,
        (x) => 1 / Math.tan(x),
        (x) => ce._BIGNUM_ONE.div(x.tan()),
        (x) => x.tan().inverse()
      );
    case 'Coth':
      return applyAngle(
        op,
        (x) => 1 / Math.tanh(x),
        (x) => ce._BIGNUM_ONE.div(x.tanh()),
        (x) => x.tanh().inverse()
      );
    case 'Csc':
      return applyAngle(
        op,
        (x) => 1 / Math.sin(x),
        (x) => ce._BIGNUM_ONE.div(x.sin()),
        (x) => x.sin().inverse()
      );
    case 'Csch':
      return applyAngle(
        op,
        (x) => 1 / Math.sinh(x),
        (x) => ce._BIGNUM_ONE.div(x.sinh()),
        (x) => x.sinh().inverse()
      );
    case 'Sec':
      return applyAngle(
        op,
        (x) => 1 / Math.cos(x),
        (x) => ce._BIGNUM_ONE.div(x.cos()),
        (x) => x.cos().inverse()
      );
    case 'Sech':
      return applyAngle(
        op,
        (x) => 1 / Math.cosh(x),
        (x) => ce._BIGNUM_ONE.div(x.cosh()),
        (x) => x.cosh().inverse()
      );
    case 'Sin':
      return applyAngle(
        op,
        Math.sin,
        (x) =>
          x
            .toSignificantDigits(ce.precision + 4)
            .sin()
            .toSignificantDigits(ce.precision),
        (x) => x.sin()
      );
    case 'Sinh':
      return applyAngle(
        op,
        Math.sinh,
        (x) => x.sinh(),
        (x) => x.sinh()
      );
    case 'Tan':
      return applyAngle(
        op,
        Math.tan,
        (x) =>
          x
            .toSignificantDigits(ce.precision + 4)
            .tan()
            .toSignificantDigits(ce.precision),
        (x) => x.tan()
      );
    case 'Tanh':
      return applyAngle(
        op,
        Math.tanh,
        (x) => x.tanh(),
        (x) => x.tanh()
      );
  }
  return undefined;
}

function applyAngle(
  angle: BoxedExpression,
  fn: (x: number) => number | Complex,
  bigFn?: (x: Decimal) => Decimal | Complex | number,
  complexFn?: (x: Complex) => number | Complex
): BoxedExpression | undefined {
  return applyN(angleToRadians(angle)!, fn, bigFn, complexFn);
}

function angleToRadians(
  x: BoxedExpression | undefined
): BoxedExpression | undefined {
  if (!x) return x;
  const ce = x.engine;
  const angularUnit = ce.angularUnit;
  if (angularUnit === 'rad') return x;

  const theta = asFloat(x.N());
  if (theta === null) return x;
  if (angularUnit === 'deg') return ce.number(theta * (Math.PI / 180));
  if (angularUnit === 'grad') return ce.number(theta * (Math.PI / 200));
  if (angularUnit === 'turn') return ce.number(theta * (2 * Math.PI));
  return x;
}

/** Assuming x in an expression in radians, convert to current angular unit. */
function radiansToAngle(
  x: BoxedExpression | undefined
): BoxedExpression | undefined {
  if (!x) return x;
  const ce = x.engine;
  const angularUnit = ce.angularUnit;
  if (angularUnit === 'rad') return x;

  const theta = asFloat(x.N());
  if (theta === null) return x;
  if (angularUnit === 'deg') return ce.number(theta * (180 / Math.PI));
  if (angularUnit === 'grad') return ce.number(theta * (200 / Math.PI));
  if (angularUnit === 'turn') return ce.number(theta / (2 * Math.PI));
  return x;
}
