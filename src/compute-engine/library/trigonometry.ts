import { Decimal } from 'decimal.js';
import { IdentifierDefinitions, DomainExpression } from '../public';
import { bignumPreferred } from '../boxed-expression/utils';
import { apply2 } from '../symbolic/utils';
import { checkArity } from '../boxed-expression/validate';
import { reducedRational } from '../numerics/rationals';
import {
  constructibleValues,
  evalTrig,
  processInverseFunction,
  trigSign,
} from '../boxed-expression/trigonometry';

const domainNumberToRealNumber = (_head: string): DomainExpression => {
  return ['FunctionOf', 'Numbers', 'RealNumbers'];
};

const trigFunction = (_head: string): DomainExpression => {
  return ['FunctionOf', 'Numbers', 'Numbers'];
};

const hyperbolicFunction = (_head: string): DomainExpression => {
  return ['FunctionOf', 'Numbers', 'Numbers'];
};

//
// Note: Names of trigonometric functions follow ISO 80000 Section 13
//

export const TRIGONOMETRY_LIBRARY: IdentifierDefinitions[] = [
  {
    //
    // Constants
    //
    Pi: {
      domain: 'RealNumbers',
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

          let fArg = arg.re ?? NaN;

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
        evaluate: (ce, ops) => {
          if (ce.angularUnit === 'deg') return ops[0];
          return ops[0].mul(ce.Pi.div(180)).evaluate();
        },
      },
    },

    // Hypot: sqrt(x*x + y*y)
    Hypot: {
      threadable: true,
      signature: {
        domain: ['FunctionOf', 'Numbers', 'Numbers', 'NonNegativeNumbers'],
        sgn: (_ce, _ops) => 1,
        evaluate: ['Sqrt', ['Add', ['Square', '_1'], ['Square', '_2']]],
      },
    },

    // The definition of other functions may rely on Sin, so it is defined first
    // in a separate section
    Sin: {
      complexity: 5000,
      threadable: true,
      signature: {
        domain: ['FunctionOf', 'Numbers', 'Numbers'],
        sgn: (ce, ops) => trigSign('Sin', ops[0]),
        evaluate: (ce, ops) =>
          constructibleValues('Sin', ops[0]) ?? evalTrig('Sin', ops[0]),
        N: (ce, ops) => evalTrig('Sin', ops[0]),
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
        sgn: (ce, ops) => trigSign('Arctan', ops[0]),
        evaluate: (ce, ops) =>
          constructibleValues('Arctan', ops[0]) ?? evalTrig('Arctan', ops[0]),
        N: (ce, ops) => evalTrig('Arctan', ops[0]),
      },
    },

    Arctan2: {
      wikidata: 'Q776598',
      complexity: 5200,
      threadable: true,
      signature: {
        domain: ['FunctionOf', 'Numbers', 'Numbers', 'Numbers'],
        evaluate: (ce, ops) => {
          // See https://en.wikipedia.org/wiki/Argument_(complex_analysis)#Realizations_of_the_function_in_computer_languages
          const [y, x] = ops;
          if (!y.isFinite && !x.isFinite) return ce.NaN;
          if (y.isZero && x.isZero) return ce.Zero;
          if (!x.isFinite) return x.isPositive ? ce.Zero : ce.Pi;
          if (!y.isFinite) return y.isPositive ? ce.Pi.div(2) : ce.Pi.div(-2);
          if (y.isZero) return x.isPositive ? ce.Zero : ce.Pi;
          return ce.function('Arctan', [y.div(x)]).evaluate();
        },
        N: (_ce, ops) =>
          apply2(ops[0], ops[1], Math.atan2, (a, b) => Decimal.atan2(a, b)),
      },
    },

    Cos: {
      complexity: 5050,
      threadable: true,
      signature: {
        domain: ['FunctionOf', 'Numbers', 'Numbers'],
        sgn: (ce, ops) => trigSign('Cos', ops[0]),
        evaluate: (ce, ops) =>
          constructibleValues('Cos', ops[0]) ?? evalTrig('Cos', ops[0]),
        N: (ce, ops) => evalTrig('Cos', ops[0]),
      },
    },

    Tan: {
      // Range: 'RealNumbers',
      complexity: 5100,
      threadable: true,
      signature: {
        domain: trigFunction('Tan'),
        sgn: (ce, ops) => trigSign('Tan', ops[0]),
        evaluate: (ce, ops) =>
          constructibleValues('Tan', ops[0]) ?? evalTrig('Tan', ops[0]),
        N: (ce, ops) => evalTrig('Tan', ops[0]),
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
        sgn: (ce, ops) => trigSign('Arcosh', ops[0]),
        evaluate: (ce, ops) =>
          constructibleValues('Arcosh', ops[0]) ?? evalTrig('Arcosh', ops[0]),
        N: (ce, ops) => evalTrig('Arcosh', ops[0]),
      },
    },

    Arcsin: {
      complexity: 5500,
      threadable: true,
      signature: {
        domain: hyperbolicFunction('Arcsin'),
        sgn: (ce, ops) => trigSign('Arcsin', ops[0]),
        evaluate: (ce, ops) =>
          constructibleValues('Arcsin', ops[0]) ?? evalTrig('Arcsin', ops[0]),
        N: (ce, ops) => evalTrig('Arcsin', ops[0]),
      },
    },

    //Note: Arsinh, not ArCsinh
    Arsinh: {
      complexity: 6100,
      threadable: true,
      signature: {
        domain: hyperbolicFunction('Arsinh'),
        sgn: (ce, ops) => trigSign('Arsinh', ops[0]),
        evaluate: (ce, ops) =>
          constructibleValues('Arsinh', ops[0]) ?? evalTrig('Arsinh', ops[0]),
        N: (ce, ops) => evalTrig('Arsinh', ops[0]),
      },
    },

    Artanh: {
      complexity: 6300,
      threadable: true,
      signature: {
        domain: hyperbolicFunction('Artanh'),
        sgn: (ce, ops) => trigSign('Artanh', ops[0]),
        evaluate: (ce, ops) =>
          constructibleValues('Artanh', ops[0]) ?? evalTrig('Artanh', ops[0]),
        N: (ce, ops) => evalTrig('Artanh', ops[0]),
      },
    },

    Cosh: {
      complexity: 6050,
      threadable: true,
      signature: {
        domain: hyperbolicFunction('Cosh'),
        sgn: (ce, ops) => trigSign('Cosh', ops[0]),
        evaluate: (ce, ops) =>
          constructibleValues('Cosh', ops[0]) ?? evalTrig('Cosh', ops[0]),
        N: (ce, ops) => evalTrig('Cosh', ops[0]),
      },
    },

    Cot: {
      complexity: 5600,
      threadable: true,
      signature: {
        domain: trigFunction('Cot'),
        sgn: (ce, ops) => trigSign('Cot', ops[0]),
        evaluate: (ce, ops) =>
          constructibleValues('Cot', ops[0]) ?? evalTrig('Cot', ops[0]),
        N: (ce, ops) => evalTrig('Cot', ops[0]),
      },
    },

    Csc: {
      description: 'Cosecant',
      complexity: 5600,
      threadable: true,
      signature: {
        domain: trigFunction('Csc'),
        sgn: (ce, ops) => trigSign('Csc', ops[0]),
        evaluate: (ce, ops) =>
          constructibleValues('Csc', ops[0]) ?? evalTrig('Csc', ops[0]),
        N: (ce, ops) => evalTrig('Csc', ops[0]),
      },
    },

    Sec: {
      description: 'Secant, inverse of cosine',
      complexity: 5500,
      threadable: true,
      signature: {
        domain: trigFunction('Sec'),
        sgn: (ce, ops) => trigSign('Sec', ops[0]),
        evaluate: (ce, ops) =>
          constructibleValues('Sec', ops[0]) ?? evalTrig('Sec', ops[0]),
        N: (ce, ops) => evalTrig('Sec', ops[0]),
      },
    },

    Sinh: {
      // Range: ['Interval', -Infinity, Infinity],
      complexity: 6000,
      threadable: true,
      signature: {
        domain: hyperbolicFunction('Sinh'),
        sgn: (ce, ops) => trigSign('Sinh', ops[0]),
        evaluate: (ce, ops) =>
          constructibleValues('Sinh', ops[0]) ?? evalTrig('Sinh', ops[0]),
        N: (ce, ops) => evalTrig('Sinh', ops[0]),
      },
    },

    /** = sin(z/2)^2 = (1 - cos z) / 2*/
    Haversine: {
      wikidata: 'Q2528380',
      threadable: true,
      signature: {
        domain: ['FunctionOf', 'RealNumbers', 'Numbers'],
        evaluate: ['Divide', ['Subtract', 1, ['Cos', '_1']], 2],
      },
    },

    /** = 2 * Arcsin(Sqrt(z)) */
    InverseHaversine: {
      //  Range ['Interval', [['Negate', 'Pi'], 'Pi'],
      threadable: true,
      signature: {
        domain: ['FunctionOf', 'RealNumbers', 'RealNumbers'],
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
        sgn: (ce, ops) => trigSign('Csch', ops[0]),
        evaluate: (ce, ops) =>
          constructibleValues('Csch', ops[0]) ?? evalTrig('Csch', ops[0]),
        N: (ce, ops) => evalTrig('Csch', ops[0]),
      },
    },

    Sech: {
      complexity: 6200,
      threadable: true,
      signature: {
        domain: ['FunctionOf', 'Numbers', 'Numbers'],
        sgn: (ce, ops) => trigSign('Sech', ops[0]),
        evaluate: (ce, ops) =>
          constructibleValues('Sech', ops[0]) ?? evalTrig('Sech', ops[0]),
        N: (ce, ops) => evalTrig('Sech', ops[0]),
      },
    },

    Tanh: {
      // Range: ['Interval', -Infinity, Infinity],
      complexity: 6200,
      threadable: true,
      signature: {
        domain: hyperbolicFunction('Tanh'),
        sgn: (ce, ops) => trigSign('Tanh', ops[0]),
        evaluate: (ce, ops) =>
          constructibleValues('Tanh', ops[0]) ?? evalTrig('Tanh', ops[0]),
        N: (ce, ops) => evalTrig('Tanh', ops[0]),
      },
    },
  },
  {
    Arccos: {
      complexity: 5550,
      threadable: true,
      signature: {
        domain: domainNumberToRealNumber('Arccos'),
        sgn: (ce, ops) => trigSign('Arccos', ops[0]),
        evaluate: (ce, ops) =>
          constructibleValues('Arccos', ops[0]) ?? evalTrig('Arccos', ops[0]),
        N: (ce, ops) => evalTrig('Arccos', ops[0]),
      },
    },

    Arccot: {
      numeric: true,
      threadable: true,
      signature: {
        domain: domainNumberToRealNumber('Arccot'),
        sgn: (ce, ops) => trigSign('Arccot', ops[0]),
        evaluate: (ce, ops) =>
          constructibleValues('Arccot', ops[0]) ?? evalTrig('Arccot', ops[0]),
        N: (ce, ops) => evalTrig('Arccot', ops[0]),
      },
    },

    Arcoth: {
      numeric: true,
      threadable: true,
      signature: {
        domain: domainNumberToRealNumber('Arcoth'),
        sgn: (ce, ops) => trigSign('Arcoth', ops[0]),
        evaluate: (ce, ops) =>
          constructibleValues('Arcoth', ops[0]) ?? evalTrig('Arcoth', ops[0]),
        N: (ce, ops) => evalTrig('Arcoth', ops[0]),
      },
    },

    Arcsch: {
      numeric: true,
      threadable: true,
      signature: {
        domain: domainNumberToRealNumber('Arcsch'),
        sgn: (ce, ops) => trigSign('Arcsch', ops[0]),
        evaluate: (ce, ops) =>
          constructibleValues('Arcsch', ops[0]) ?? evalTrig('Arcsch', ops[0]),
        N: (ce, ops) => evalTrig('Arcsch', ops[0]),
      },
    },

    Arcsec: {
      numeric: true,
      threadable: true,
      signature: {
        domain: domainNumberToRealNumber('Arcsec'),
        sgn: (ce, ops) => trigSign('Arcsec', ops[0]),
        evaluate: (ce, ops) =>
          constructibleValues('Arcsec', ops[0]) ?? evalTrig('Arcsec', ops[0]),
        N: (ce, ops) => evalTrig('Arcsec', ops[0]),
      },
    },

    Arsech: {
      numeric: true,
      threadable: true,
      signature: {
        domain: domainNumberToRealNumber('Arsech'),
        sgn: (ce, ops) => trigSign('Arsech', ops[0]),
        evaluate: (ce, ops) =>
          constructibleValues('Arsech', ops[0]) ?? evalTrig('Arsech', ops[0]),
        N: (ce, ops) => evalTrig('Arsech', ops[0]),
      },
    },

    Arccsc: {
      numeric: true,
      threadable: true,
      signature: {
        domain: domainNumberToRealNumber('Arccsc'),
        sgn: (ce, ops) => trigSign('Arccsc', ops[0]),
        evaluate: (ce, ops) =>
          constructibleValues('Arccsc', ops[0]) ?? evalTrig('Arccsc', ops[0]),
        N: (ce, ops) => evalTrig('Arccsc', ops[0]),
      },
    },

    Coth: {
      complexity: 6300,
      threadable: true,
      signature: {
        domain: hyperbolicFunction('Coth'),
        sgn: (ce, ops) => trigSign('Coth', ops[0]),
        evaluate: (ce, ops) =>
          constructibleValues('Coth', ops[0]) ?? evalTrig('Coth', ops[0]),
        N: (ce, ops) => evalTrig('Coth', ops[0]),
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
        evaluate: (ce, ops) => processInverseFunction(ce, ops),
      },
    },
  },
];
