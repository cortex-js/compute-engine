import { BigDecimal } from '../../big-decimal';

import { bignumPreferred } from '../boxed-expression/utils';
import { checkArity } from '../boxed-expression/validate';
import {
  constructibleValues,
  evalTrig,
  processInverseFunction,
  trigSign,
} from '../boxed-expression/trigonometry';

import { apply, apply2 } from '../boxed-expression/apply';

import { reducedRational } from '../numerics/rationals';
import type { OperatorDefinition, SymbolDefinitions } from '../global-types';
import type { Expression } from '../types-expression';
import {
  isFunction,
  isNumber,
  isSymbol,
} from '../boxed-expression/type-guards';
import { numericTypeHandler } from './type-handlers';
import { getUnitScale } from './unit-data';
import {
  bigFresnelC,
  bigFresnelS,
  bigSinc,
  fresnelC,
  fresnelS,
  sinc,
} from '../numerics/special-functions';

//
// Note: The name of trigonometric functions follow NIST DLMF
// - https://dlmf.nist.gov/4.14
// - https://dlmf.nist.gov/4.37
//
// The usage of the `ar-` prefix (instead of `arc-` is controversial:
// https://en.wikipedia.org/wiki/Talk:Inverse_hyperbolic_functions
// ISO 80000 and ANSI use `arsinh`, while NIST uses `arcsinh`.
// The most common usage is `arcsinh`, so we use that here.

// Also worth noting, In NIST (and ANSI) the inverse hyperbolic functions are
//  defined as:
// - arcsin z is the principal branch of the inverse sine function
// - Arcsin z = (-1)^k arcsin (z + k\pi) is the general multivalued inverse
//   sine function
// We only have definitions for the principal branches here.

export const TRIGONOMETRY_LIBRARY: SymbolDefinitions[] = [
  {
    //
    // Constants
    //
    Pi: {
      type: 'finite_real',
      isConstant: true,
      holdUntil: 'N',
      wikidata: 'Q167',
      value: (engine) =>
        engine.number(bignumPreferred(engine) ? BigDecimal.PI : Math.PI),
    },
  },
  {
    Degrees: {
      description: 'Convert an angle in degrees.',
      /* = Pi / 180 */
      signature: '(real) -> real',
      type: () => 'finite_real',
      canonical: (ops, { engine }) => {
        const ce = engine;
        if (ce.angularUnit === 'deg') return ops[0];
        if (ops.length !== 1) return ce._fn('Degrees', ops);
        const arg = ops[0];
        if (!isNumber(arg) || !arg.isValid) return ce._fn('Degrees', ops);

        const fArg = arg.re;

        if (Number.isNaN(fArg)) return arg.mul(ce.Pi).div(180);

        // `Degrees(d)` is the faithful linear conversion `d·π/180` — it does
        // NOT reduce `d` mod 360. (Reducing here made the canonical form
        // disagree with the `evaluate` handler — `Degrees(390)` canonicalized
        // to `π/6` but a symbolic arg resolving to 390 evaluated to `13π/6` —
        // and corrupted faithful values such as `Degrees(-45.5)`. Angle
        // normalization to a range is a *serialization* concern, controlled by
        // the `angleNormalization` option.)
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
        // Faithful `d·π/180` conversion, matching the canonical handler (no
        // mod-360 reduction — see the note there).
        return ops[0].mul(options.engine.Pi.div(180)).evaluate(options);
      },
    },

    // DMS(degrees, minutes?, seconds?) — programmatic angle construction
    DMS: {
      description: 'Construct an angle from degrees, minutes, and seconds.',
      signature: '(real, real?, real?) -> real',
      type: () => 'finite_real',
      canonical: (ops, { engine: ce }) => {
        const deg = ops[0]?.re ?? NaN;
        const min = ops[1]?.re ?? 0;
        const sec = ops[2]?.re ?? 0;

        if (Number.isNaN(deg)) return ce._fn('DMS', ops);

        const total = deg + min / 60 + sec / 3600;
        return ce.function('Degrees', [ce.number(total)]);
      },
      evaluate: (ops, options) => {
        const ce = options.engine;
        const deg = ops[0]?.re ?? NaN;
        const min = ops[1]?.re ?? 0;
        const sec = ops[2]?.re ?? 0;

        if (Number.isNaN(deg)) return ce._fn('DMS', ops);

        const total = deg + min / 60 + sec / 3600;
        if (ce.angularUnit === 'deg') return ce.number(total);
        return ce.number(total).div(180).mul(ce.Pi).evaluate(options);
      },
    },

    // Hypot: sqrt(x*x + y*y)
    Hypot: {
      description: 'Hypotenuse length: sqrt(x^2 + y^2).',
      broadcastable: true,
      signature: '(real, real) -> real',
      type: () => 'finite_real',
      sgn: () => 'non-negative',
      evaluate: ([x, y], { engine }) =>
        engine.expr(['Sqrt', ['Add', ['Square', x], ['Square', y]]]),
    },

    // The definition of other trig functions may rely on Sin, so it is defined
    // first in this preliminary section
    Sin: trigFunction('Sin', 5000),
  },
  {
    //
    // Basic trigonometric function
    // (may be used in the definition of other functions below)
    //
    Arctan: {
      description: 'Inverse tangent.',
      wikidata: 'Q2257242',
      complexity: 5200,
      broadcastable: true,
      signature: '(number) -> finite_real',
      type: (ops) => numericTypeHandler(ops),
      sgn: ([x]) => trigSign('Arctan', x),
      evaluate: ([x], { numericApproximation, engine }) => {
        if (numericApproximation) return evalTrig('Arctan', x);
        const a = constructibleValues('Arctan', x);
        if (a) return a;
        // Keep arctan of an EXACT numeric argument symbolic (only .N()
        // numericizes); an inexact float falls through to evalTrig and
        // numericizes; evalTrig also handles symbolic arguments.
        if (isNumber(x) && x.isExact) return engine._fn('Arctan', [x]);
        return evalTrig('Arctan', x);
      },
    },

    Arctan2: {
      description: 'Two-argument arctangent giving the angle of a vector.',
      wikidata: 'Q776598',
      complexity: 5200,
      broadcastable: true,
      signature: '(y:number, x: number) -> real',
      type: (ops) => numericTypeHandler(ops),
      evaluate: ([y, x], { engine: ce, numericApproximation }) => {
        if (numericApproximation)
          return apply2(y, x, Math.atan2, (a, b) => BigDecimal.atan2(a, b));

        // See https://en.wikipedia.org/wiki/Argument_(complex_analysis)#Realizations_of_the_function_in_computer_languages
        if (y.isFinite === false && x.isFinite === false) return ce.NaN;
        if (y.isSame(0) && x.isSame(0)) return ce.Zero;
        if (x.isFinite === false) return x.isPositive ? ce.Zero : ce.Pi;
        if (y.isFinite === false)
          return y.isPositive ? ce.Pi.div(2) : ce.Pi.div(-2);
        if (y.isSame(0)) {
          if (x.isPositive) return ce.Zero;
          if (x.isNegative) return ce.Pi;
          return undefined;
        }
        // x = 0 (and y ≠ 0): the angle is ±π/2
        if (x.isSame(0)) {
          if (y.isPositive) return ce.Pi.div(2);
          if (y.isNegative) return ce.Pi.div(-2);
          return undefined;
        }

        // General case: apply the quadrant correction to the principal value.
        //   atan2(y, x) = atan(y/x)        if x > 0
        //               = atan(y/x) + π    if x < 0 and y ≥ 0
        //               = atan(y/x) − π    if x < 0 and y < 0
        if (x.isPositive) return ce.function('Arctan', [y.div(x)]).evaluate();
        if (x.isNegative) {
          const principal = ce.function('Arctan', [y.div(x)]).evaluate();
          if (y.isNonNegative) return principal.add(ce.Pi);
          if (y.isNegative) return principal.sub(ce.Pi);
        }
        // Sign of x (or of y, when x < 0) is indeterminate: leave unevaluated.
        return undefined;
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
    // Note: we use the ISO 80000-2 standard names for inverse hyperbolic
    // functions: Arsinh, Arcosh, Artanh, etc. (not Arcsinh, Arccosh, Arctanh)
    // The "ar" prefix stands for "area", which is mathematically correct
    // since these functions relate to areas on a hyperbola, not arc lengths.
    Arcosh: trigFunction('Arcosh', 6200),

    Arcsin: trigFunction('Arcsin', 5500),

    Arsinh: trigFunction('Arsinh', 6100),

    Artanh: trigFunction('Artanh', 6300),

    Cosh: trigFunction('Cosh', 6050),

    Cot: trigFunction('Cot', 5600),

    Csc: trigFunction('Csc', 5600, 'Cosecant'),

    Sec: trigFunction('Sec', 5600, 'Secant, inverse of cosine'),

    Sinh: trigFunction('Sinh', 6000),

    /** = sin(z/2)^2 = (1 - cos z) / 2*/
    Haversine: {
      description: 'Haversine function.',
      wikidata: 'Q2528380',
      broadcastable: true,
      signature: '(real) -> number',
      type: () => 'finite_real',
      evaluate: ([z], { engine }) =>
        engine.expr(['Divide', ['Subtract', 1, ['Cos', z]], 2]),
    },

    /** = 2 * Arcsin(Sqrt(z)) */
    InverseHaversine: {
      description: 'Inverse haversine function.',
      //  Range ['Interval', [['Negate', 'Pi'], 'Pi'],
      broadcastable: true,
      signature: '(real) -> real',
      type: () => 'finite_real',
      evaluate: ([x], { engine }) =>
        engine.expr(['Multiply', 2, ['Arcsin', ['Sqrt', x]]]),
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

    //
    // Note (REVIEW.md B23): Sinc/FresnelS/FresnelC follow the same pattern
    // as Gamma/Zeta in `library/arithmetic.ts`: exact special values fold
    // in `evaluate()`, anything else stays symbolic unless
    // `numericApproximation` is set, in which case `apply()` dispatches to
    // the machine kernel or, when the engine precision exceeds machine
    // precision, the bignum kernel. Complex arguments stay symbolic (no
    // complex kernel — previously the real part was used silently, which
    // was incorrect).
    //

    /** sinc(x) = sin(x)/x with sinc(0) = 1 (unnormalized cardinal sine) */
    Sinc: {
      description: 'Unnormalized sinc function: sin(x)/x with sinc(0)=1.',
      complexity: 5100,
      broadcastable: true,
      signature: '(number) -> real',
      type: () => 'finite_real',
      evaluate: ([x], { numericApproximation, engine: ce }) => {
        if (!isNumber(x) || x.im !== 0) return undefined;
        // Exact special values, regardless of numericApproximation
        if (x.isSame(0)) return ce.One;
        if (x.isInfinity) return ce.Zero;
        if (!numericApproximation) return undefined;
        return apply(
          x,
          (x) => sinc(x),
          (x) => bigSinc(x)
        );
      },
    },

    /** FresnelS(x) = ∫₀ˣ sin(πt²/2) dt — odd function, S(∞) = 1/2 */
    FresnelS: {
      description: 'Fresnel sine integral.',
      complexity: 5200,
      broadcastable: true,
      signature: '(number) -> real',
      type: () => 'finite_real',
      evaluate: ([x], { numericApproximation, engine: ce }) => {
        if (!isNumber(x) || x.im !== 0) return undefined;
        // Exact special values, regardless of numericApproximation
        if (x.isSame(0)) return ce.Zero;
        if (x.isInfinity) return x.isPositive ? ce.Half : ce.Half.neg();
        if (!numericApproximation) return undefined;
        return apply(
          x,
          (x) => fresnelS(x),
          (x) => bigFresnelS(x)
        );
      },
    },

    /** FresnelC(x) = ∫₀ˣ cos(πt²/2) dt — odd function, C(∞) = 1/2 */
    FresnelC: {
      description: 'Fresnel cosine integral.',
      complexity: 5200,
      broadcastable: true,
      signature: '(number) -> real',
      type: () => 'finite_real',
      evaluate: ([x], { numericApproximation, engine: ce }) => {
        if (!isNumber(x) || x.im !== 0) return undefined;
        // Exact special values, regardless of numericApproximation
        if (x.isSame(0)) return ce.Zero;
        if (x.isInfinity) return x.isPositive ? ce.Half : ce.Half.neg();
        if (!numericApproximation) return undefined;
        return apply(
          x,
          (x) => fresnelC(x),
          (x) => bigFresnelC(x)
        );
      },
    },

    /* converts (radius, angle) -> (x, y) */
    // FromPolarCoordinates: {
    //   domain: 'Function',
    //   outputDomain: ['TupleOf', 'RealNumbers', 'RealNumbers'],
    // },
    InverseFunction: {
      description: 'Inverse of a function.',
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

const ANGULAR_UNITS = new Set([
  'deg',
  'rad',
  'grad',
  'turn',
  'arcmin',
  'arcsec',
]);

/**
 * If `expr` is a `Quantity` with an angular unit (deg, rad, grad, etc.),
 * return a plain numeric expression in radians.  Otherwise return `null`.
 *
 * Only handles simple symbol units (not compound expressions).
 * The `Number.isFinite` check intentionally rejects both `undefined`
 * (from `.re` on non-numeric expressions) and `Infinity`.
 */
function angularQuantityToRadians(expr: Expression): Expression | null {
  if (!isFunction(expr, 'Quantity')) return null;

  const unitArg = expr.op2;
  if (!isSymbol(unitArg)) return null;
  const unitSymbol = unitArg.symbol;

  if (!ANGULAR_UNITS.has(unitSymbol)) return null;

  const scale = getUnitScale(unitSymbol);
  if (scale === null) return null;

  const magnitude = expr.op1.re;
  if (!Number.isFinite(magnitude)) return null;

  return expr.engine.number(magnitude * scale);
}

function trigFunction(
  operator: string,
  complexity: number,
  description?: string
): OperatorDefinition {
  return {
    complexity,
    description,
    broadcastable: true,
    signature: '(number) -> number',
    type: (ops) => numericTypeHandler(ops),
    sgn: ([x]) => trigSign(operator, x),
    canonical: (ops, { engine: ce }) => {
      if (ops.length === 1) {
        const radians = angularQuantityToRadians(ops[0]);
        if (radians) return ce._fn(operator, [radians]);
      }
      // Validate arity (inserts error markers for missing args)
      ops = checkArity(ce, ops, 1);
      return ce._fn(operator, ops);
    },
    evaluate: ([x], { numericApproximation, engine }) => {
      if (numericApproximation) return evalTrig(operator, x);
      const a = constructibleValues(operator, x);
      if (a) return a;
      // No constructible value: keep the function of an EXACT numeric argument
      // symbolic — `sin(2)` is an exact constant, so `evaluate()` returns
      // `sin(2)` and only `.N()` numericizes. An INEXACT (float) argument has
      // no exactness to preserve, so it falls through to `evalTrig` and
      // numericizes (`sin(2.5) → 0.598…`); `evalTrig` also handles symbolic
      // arguments (returning undefined, leaving the expression unevaluated).
      if (isNumber(x) && x.isExact) return engine._fn(operator, [x]);
      return evalTrig(operator, x);
    },
  };
}
