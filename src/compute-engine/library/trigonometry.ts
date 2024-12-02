import { Decimal } from 'decimal.js';

import { IdentifierDefinitions, FunctionDefinition } from '../public';

import { bignumPreferred } from '../boxed-expression/utils';
import { checkArity } from '../boxed-expression/validate';
import {
  constructibleValues,
  evalTrig,
  processInverseFunction,
  trigSign,
} from '../boxed-expression/trigonometry';

import { apply2 } from '../boxed-expression/apply';

import { reducedRational } from '../numerics/rationals';

//
// Note: Names of trigonometric functions follow ISO 80000 Section 13
//

export const TRIGONOMETRY_LIBRARY: IdentifierDefinitions[] = [
  {
    //
    // Constants
    //
    Pi: {
      type: 'real',
      constant: true,
      holdUntil: 'N',
      wikidata: 'Q167',
      value: (engine) =>
        engine.number(bignumPreferred(engine) ? engine._BIGNUM_PI : Math.PI),
    },
  },
  {
    Degrees: {
      /* = Pi / 180 */
      signature: 'real -> real',
      canonical: (ops, { engine }) => {
        const ce = engine;
        if (ce.angularUnit === 'deg') return ops[0];
        if (ops.length !== 1) return ce._fn('Degrees', ops);
        const arg = ops[0];
        if (arg.numericValue === null || !arg.isValid)
          return ce._fn('Degrees', ops);

        let fArg = arg.re;

        if (Number.isNaN(fArg)) return arg.mul(ce.Pi).div(180);

        // Constrain fArg to [0, 360]
        fArg = fArg % 360;
        if (fArg < 0) fArg += 360;

        // Convert fArg to radians
        if (Number.isInteger(fArg)) {
          const fRadians = reducedRational([fArg, 180]);
          if (fRadians[0] === 0) return ce.Zero;
          if (fRadians[0] === 1 && fRadians[1] === 1) return ce.Pi;
          if (fRadians[0] === 1) return ce.Pi.div(fRadians[1]);
          return ce.number(fRadians).mul(ce.Pi);
        }
        return ce.number(fArg).div(180).mul(ce.Pi);
      },
      evaluate: (ops, options) => {
        if (options.engine.angularUnit === 'deg') return ops[0];
        return ops[0].mul(options.engine.Pi.div(180)).evaluate(options);
      },
    },

    // Hypot: sqrt(x*x + y*y)
    Hypot: {
      threadable: true,
      signature: '(real, real) -> real',
      sgn: () => 'non-negative',
      evaluate: ([x, y], { engine }) =>
        engine.box(['Sqrt', ['Add', ['Square', x], ['Square', y]]]),
    },

    // The definition of other functions may rely on Sin, so it is defined first
    // in a separate section
    Sin: trigFunction('Sin', 5000),
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
      signature: 'number -> real',
      sgn: ([x]) => trigSign('Arctan', x),
      evaluate: ([x], { numericApproximation }) =>
        numericApproximation
          ? evalTrig('Arctan', x)
          : (constructibleValues('Arctan', x) ?? evalTrig('Arctan', x)),
    },

    Arctan2: {
      wikidata: 'Q776598',
      complexity: 5200,
      threadable: true,
      signature: '(y:number, x: number) -> real',
      evaluate: ([y, x], { engine: ce, numericApproximation }) => {
        if (numericApproximation)
          return apply2(y, x, Math.atan2, (a, b) => Decimal.atan2(a, b));

        // See https://en.wikipedia.org/wiki/Argument_(complex_analysis)#Realizations_of_the_function_in_computer_languages
        if (y.isFinite === false && x.isFinite === false) return ce.NaN;
        if (y.is(0) && x.is(0)) return ce.Zero;
        if (x.isFinite === false) return x.isPositive ? ce.Zero : ce.Pi;
        if (y.isFinite === false)
          return y.isPositive ? ce.Pi.div(2) : ce.Pi.div(-2);
        if (y.is(0)) return x.isPositive ? ce.Zero : ce.Pi;
        return ce.function('Arctan', [y.div(x)]).evaluate();
      },
    },

    Cos: trigFunction('Cos', 5050),

    Tan: trigFunction('Tan', 5100),
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
    Arcosh: trigFunction('Arcosh', 6200),

    Arcsin: trigFunction('Arcsin', 5500),

    //Note: Arsinh, not ArCsinh
    Arsinh: trigFunction('Arsinh', 6100),

    Artanh: trigFunction('Artanh', 6300),

    Cosh: trigFunction('Cosh', 6050),

    Cot: trigFunction('Cot', 5600),

    Csc: trigFunction('Csc', 5600, 'Cosecant'),

    Sec: trigFunction('Sec', 5600, 'Secant, inverse of cosine'),

    Sinh: trigFunction('Sinh', 6000),

    /** = sin(z/2)^2 = (1 - cos z) / 2*/
    Haversine: {
      wikidata: 'Q2528380',
      threadable: true,
      signature: 'real -> number',
      evaluate: ([z], { engine }) =>
        engine.box(['Divide', ['Subtract', 1, ['Cos', z]], 2]),
    },

    /** = 2 * Arcsin(Sqrt(z)) */
    InverseHaversine: {
      //  Range ['Interval', [['Negate', 'Pi'], 'Pi'],
      threadable: true,
      signature: 'real -> real',
      evaluate: ([x], { engine }) =>
        engine.box(['Multiply', 2, ['Arcsin', ['Sqrt', x]]]),
    },
  },
  {
    Csch: trigFunction('Csch', 6200, 'Hyperbolic cosecant'),

    Sech: trigFunction('Sech', 6200, 'Hyperbolic secant'),

    Tanh: trigFunction('Tanh', 6200, 'Hyperbolic tangent'),
  },
  {
    Arccos: trigFunction('Arccos', 5550),

    Arccot: trigFunction('Arccot', 5650),

    Arcoth: trigFunction('Arcoth', 6350),

    Arcsch: trigFunction('Arcsch', 6250),

    Arcsec: trigFunction('Arcsec', 5650),

    Arsech: trigFunction('Arsech', 6250),

    Arccsc: trigFunction('Arccsc', 5650),

    Coth: trigFunction('Coth', 6300),

    /* converts (radius, angle) -> (x, y) */
    // FromPolarCoordinates: {
    //   domain: 'Function',
    //   outputDomain: ['TupleOf', 'RealNumbers', 'RealNumbers'],
    // },
    InverseFunction: {
      lazy: true,
      signature: '(function) -> function',
      canonical: (ops, { engine }) => {
        // The canonical handler is responsible for validating the arguments
        ops = checkArity(engine, ops, 1);
        return (
          processInverseFunction(engine, ops) ??
          engine._fn('InverseFunction', ops)
        );
      },
      evaluate: (ops, { engine: ce }) => processInverseFunction(ce, ops),
    },
  },
];

function trigFunction(
  operator: string,
  complexity: number,
  description?: string
): FunctionDefinition {
  return {
    complexity,
    description,
    threadable: true,
    signature: 'number -> number',
    sgn: ([x]) => trigSign(operator, x),
    evaluate: ([x], { numericApproximation }) => {
      if (numericApproximation) return evalTrig(operator, x);
      const a = constructibleValues(operator, x);
      return a ?? evalTrig(operator, x);
    },
  };
}
