import { BigDecimal } from '../../big-decimal/index.js';

import { bignumPreferred } from '../boxed-expression/utils.js';
import { checkArity } from '../boxed-expression/validate.js';
import {
  constructibleValues,
  evalTrig,
  halfTurnAngle,
  processInverseFunction,
  radiansToAngle,
  trigSign,
} from '../boxed-expression/trigonometry.js';

import { apply, apply2, shouldNumericize } from '../boxed-expression/apply.js';

import { reducedRational } from '../numerics/rationals.js';
import type {
  OperatorDefinition,
  SymbolDefinitions,
  IComputeEngine,
} from '../global-types.js';
import type { Expression } from '../types-expression.js';
import {
  isFunction,
  isNumber,
  isSymbol,
} from '../boxed-expression/type-guards.js';
import { numericTypeHandler, elementaryFunctionType } from './type-handlers.js';
import { isMeasurement, measurementTrig } from './measurement-arithmetic.js';
import { trigExpand, trigToExp, trigReduce } from '../symbolic/trig-rewrite.js';
import { getUnitScale } from './unit-data.js';
import {
  bigFresnelC,
  bigFresnelS,
  bigSinc,
  cosIntegral,
  fresnelC,
  fresnelS,
  sinc,
  sinIntegral,
} from '../numerics/special-functions.js';

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
      // Evaluate the constructed √(x²+y²) so `.N()` returns a number, not an
      // unevaluated expression (the handler result is not re-driven otherwise).
      // Under `evaluate()` the exact folding still applies (`Hypot(1/2,1/3) →
      // √13/6`); under `.N()` it numericizes.
      evaluate: ([x, y], { engine, numericApproximation }) =>
        engine
          .expr(['Sqrt', ['Add', ['Square', x], ['Square', y]]])
          .evaluate({ numericApproximation }),
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
      signature: '(number) -> number',
      type: (ops) => elementaryFunctionType('Arctan', ops),
      sgn: ([x]) => trigSign('Arctan', x),
      evaluate: ([x], { numericApproximation, engine }) => {
        // arctan(±∞) = ±π/2 (the horizontal asymptotes). Needed for improper
        // integrals: ∫₀^∞ 1/(1+x²) = arctan(∞) − arctan(0) = π/2.
        if (x.isInfinity && (x.isPositive || x.isNegative)) {
          const v = x.isPositive ? engine.Pi.div(2) : engine.Pi.div(-2);
          return numericApproximation ? v.N() : v;
        }
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
        // NaN in → NaN out, in BOTH the evaluate and the N() paths. A NaN
        // operand is not finite, so without this early return it would slip
        // through the isFinite/isPositive guards below (isPositive is
        // undefined for NaN) and be assigned a spurious definite angle.
        if (y.isNaN === true || x.isNaN === true) return ce.NaN;

        // atan2 is a real-plane function; a non-real (complex) operand has no
        // well-defined quadrant. Stay symbolic in BOTH paths — otherwise
        // evaluate() would continue analytically via Arctan (e.g. 0.549i) while
        // .N()/apply2 silently reads the real part (0), and the two disagree.
        if ((isNumber(y) && y.im !== 0) || (isNumber(x) && x.im !== 0))
          return undefined;

        // Like the other inverse trig functions, the result is an angle in
        // the engine's current `angularUnit`: the numeric path converts via
        // `radiansToAngle`, the exact paths below build on `halfTurnAngle`
        // (π rad / 180 deg / 200 grad / 1/2 turn).
        if (numericApproximation)
          return radiansToAngle(
            apply2(y, x, Math.atan2, (a, b) => BigDecimal.atan2(a, b))
          );

        const halfTurn = halfTurnAngle(ce);

        // See https://en.wikipedia.org/wiki/Argument_(complex_analysis)#Realizations_of_the_function_in_computer_languages
        // Three-valued discipline throughout: only act on an === true / ===
        // false sign, never on an undefined one (which stays symbolic).
        if (y.isFinite === false && x.isFinite === false) return ce.NaN;
        if (y.isSame(0) && x.isSame(0)) return ce.Zero;
        if (x.isFinite === false) {
          if (x.isPositive === true) return ce.Zero;
          if (x.isNegative === true) return halfTurn;
          return undefined;
        }
        if (y.isFinite === false) {
          if (y.isPositive === true) return halfTurn.div(2);
          if (y.isNegative === true) return halfTurn.div(-2);
          return undefined;
        }
        if (y.isSame(0)) {
          if (x.isPositive === true) return ce.Zero;
          if (x.isNegative === true) return halfTurn;
          return undefined;
        }
        // x = 0 (and y ≠ 0): the angle is ±π/2
        if (x.isSame(0)) {
          if (y.isPositive === true) return halfTurn.div(2);
          if (y.isNegative === true) return halfTurn.div(-2);
          return undefined;
        }

        // General case: apply the quadrant correction to the principal value
        // (the `Arctan` result is already in the current angular unit).
        //   atan2(y, x) = atan(y/x)        if x > 0
        //               = atan(y/x) + π    if x < 0 and y ≥ 0
        //               = atan(y/x) − π    if x < 0 and y < 0
        if (x.isPositive === true)
          return ce.function('Arctan', [y.div(x)]).evaluate();
        if (x.isNegative === true) {
          const principal = ce.function('Arctan', [y.div(x)]).evaluate();
          if (y.isNonNegative === true) return principal.add(halfTurn);
          if (y.isNegative === true) return principal.sub(halfTurn);
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
      // Evaluate the constructed ½(1−cos z) so `.N()` returns a number, not the
      // unevaluated expression; exact arguments still stay symbolic under
      // `evaluate()` (e.g. `Haversine(2) → ½(1−cos 2)`).
      evaluate: ([z], { engine, numericApproximation }) =>
        engine
          .expr(['Divide', ['Subtract', 1, ['Cos', z]], 2])
          .evaluate({ numericApproximation }),
    },

    /** = 2 * Arcsin(Sqrt(z)) */
    InverseHaversine: {
      description: 'Inverse haversine function.',
      //  Range ['Interval', [['Negate', 'Pi'], 'Pi'],
      broadcastable: true,
      signature: '(real) -> real',
      type: () => 'finite_real',
      // Evaluate the constructed 2·arcsin(√z): under `.N()` it numericizes,
      // and under `evaluate()` the exact fold applies (`InverseHaversine(1/2) →
      // 2·arcsin(√2/2) → 2·(π/4) → π/2`).
      evaluate: ([x], { engine, numericApproximation }) =>
        engine
          .expr(['Multiply', 2, ['Arcsin', ['Sqrt', x]]])
          .evaluate({ numericApproximation }),
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
    // Sinc/FresnelS/FresnelC/SinIntegral/CosIntegral follow the same pattern
    // as Gamma/Zeta in `library/arithmetic.ts`: exact special values fold in
    // `evaluate()`; an inexact (float) argument numericizes even under plain
    // `evaluate()` (policy D2 — no exactness to preserve), and
    // `numericApproximation` (`.N()`) always numericizes.
    // `shouldNumericize()` dispatches to the machine kernel or, when the
    // engine precision exceeds machine precision, the bignum kernel. Complex
    // arguments stay symbolic (no complex kernel — previously the real part
    // was used silently, which was incorrect).
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
        if (!shouldNumericize(numericApproximation, x)) return undefined;
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
        if (!shouldNumericize(numericApproximation, x)) return undefined;
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
        if (!shouldNumericize(numericApproximation, x)) return undefined;
        return apply(
          x,
          (x) => fresnelC(x),
          (x) => bigFresnelC(x)
        );
      },
    },

    /**
     * SinIntegral(x) = ∫₀ˣ sin t / t dt — odd function, Si(±∞) = ±π/2.
     * Numeric evaluation is machine-precision only (no bignum kernel); like
     * the other special functions it does not yet honor `ce.precision` beyond
     * machine precision (ROADMAP B1).
     */
    SinIntegral: {
      description: 'Sine integral: ∫₀ˣ sin(t)/t dt.',
      complexity: 5200,
      broadcastable: true,
      signature: '(number) -> real',
      type: () => 'finite_real',
      evaluate: ([x], { numericApproximation, engine: ce }) => {
        if (!isNumber(x) || x.im !== 0) return undefined;
        // Exact special values, regardless of numericApproximation
        if (x.isSame(0)) return ce.Zero;
        if (x.isInfinity) {
          const v = x.isPositive ? ce.Pi.div(2) : ce.Pi.div(-2);
          return numericApproximation ? v.N() : v;
        }
        if (!shouldNumericize(numericApproximation, x)) return undefined;
        return apply(x, (x) => sinIntegral(x));
      },
    },

    /**
     * CosIntegral(x) = γ + ln x + ∫₀ˣ (cos t − 1)/t dt — Ci(0⁺) = −∞,
     * Ci(∞) = 0. For x < 0 the function is complex; the real part Ci(|x|) is
     * returned. Machine-precision only (no bignum kernel; ROADMAP B1).
     */
    CosIntegral: {
      description: 'Cosine integral: γ + ln(x) + ∫₀ˣ (cos(t)−1)/t dt.',
      complexity: 5200,
      broadcastable: true,
      signature: '(number) -> real',
      // Not finite_real: Ci(0) = −∞
      type: () => 'real',
      evaluate: ([x], { numericApproximation, engine: ce }) => {
        if (!isNumber(x) || x.im !== 0) return undefined;
        // Exact special values, regardless of numericApproximation
        if (x.isSame(0)) return ce.NegativeInfinity;
        if (x.isInfinity && x.isPositive) return ce.Zero;
        if (!shouldNumericize(numericApproximation, x)) return undefined;
        return apply(x, (x) => cosIntegral(x));
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

  //
  // Trigonometric rewrite verbs (transformation functions like Expand/Factor).
  // These are `lazy` so the operand is transformed structurally rather than
  // evaluated first, then the result is canonicalized.
  //
  {
    TrigExpand: {
      description:
        'Expand trigonometric and hyperbolic functions of sums and integer ' +
        'multiples of angles. ' +
        'Example: TrigExpand(sin(a+b)) → sin(a)cos(b) + cos(a)sin(b), ' +
        'TrigExpand(sin(2x)) → 2 sin(x) cos(x)',
      lazy: true,
      signature: '(value) -> value',
      evaluate: ([x], { numericApproximation }) => {
        if (!x) return x;
        const r = trigExpand(x.canonical);
        return numericApproximation ? r.N() : r;
      },
    },

    TrigToExp: {
      description:
        'Rewrite trigonometric and hyperbolic functions in terms of the ' +
        'complex exponential, exactly. ' +
        'Example: TrigToExp(sin(x)) → -(i/2) e^{ix} + (i/2) e^{-ix}',
      lazy: true,
      signature: '(value) -> value',
      evaluate: ([x], { numericApproximation }) => {
        if (!x) return x;
        const r = trigToExp(x.canonical);
        return numericApproximation ? r.N() : r;
      },
    },

    TrigReduce: {
      description:
        'Rewrite products and integer powers of trigonometric and hyperbolic ' +
        'functions as a linear combination of functions of multiple angles ' +
        '(the inverse of TrigExpand). ' +
        'Example: TrigReduce(sin(x)^2) → (1 - cos(2x))/2',
      lazy: true,
      signature: '(value) -> value',
      evaluate: ([x], { numericApproximation }) => {
        if (!x) return x;
        const r = trigReduce(x.canonical);
        return numericApproximation ? r.N() : r;
      },
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

/**
 * Literal pole values of the inverse hyperbolic functions:
 *   `artanh(±1) = ±∞`, `arcoth(±1) = ±∞` (one-sided real poles),
 *   `arsech(0) = +∞` (approached from the domain `(0, 1]`),
 *   `arcsch(0) = ~oo` (odd function, two-sided pole).
 * Returns `undefined` for any other operator or argument. Only applies to a
 * real number literal (`im === 0`).
 */
function inverseHyperbolicPole(
  operator: string,
  x: Expression | undefined,
  ce: IComputeEngine
): Expression | undefined {
  if (!isNumber(x) || x.im !== 0) return undefined;
  switch (operator) {
    case 'Artanh':
    case 'Arcoth':
      if (x.isSame(1)) return ce.PositiveInfinity;
      if (x.isSame(-1)) return ce.NegativeInfinity;
      return undefined;
    case 'Arsech':
      if (x.isSame(0)) return ce.PositiveInfinity;
      return undefined;
    case 'Arcsch':
      if (x.isSame(0)) return ce.ComplexInfinity;
      return undefined;
    default:
      return undefined;
  }
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
    type: (ops) => elementaryFunctionType(operator, ops),
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
      // Measurement error propagation (Sin/Cos/Tan only; other operators fall
      // through). Guard on the evaluated argument being a Measurement.
      const evalX = x.evaluate();
      if (isMeasurement(evalX)) {
        const r = measurementTrig(engine, operator, evalX);
        if (r !== undefined) return numericApproximation ? r.N() : r;
      }
      if (numericApproximation) return evalTrig(operator, x);
      // Literal poles of the inverse hyperbolic functions are exact non-finite
      // values, so fold them in `evaluate()` too (not just `.N()`).
      const pole = inverseHyperbolicPole(operator, x, engine);
      if (pole) return pole;
      const a = constructibleValues(operator, x);
      if (a) return a;
      // No constructible value: numericize ONLY an inexact (float) numeric
      // argument — `sin(2.5) → 0.598…` — since a float has no exactness to
      // preserve. Everything else stays symbolic so `evaluate()` honors the
      // exactness contract and only `.N()` numericizes: an exact number
      // (`sin(2)`), an exact *constant expression* (`sin(π²)`, `sin(√2)` — these
      // have `isNumber` true but are not number literals), and a symbolic
      // argument (`sin(x)`) all return the unevaluated function.
      if (isNumber(x) && x.isExact === false) return evalTrig(operator, x);
      return engine._fn(operator, [x]);
    },
  };
}
