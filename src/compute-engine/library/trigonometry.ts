import { BigDecimal } from '../../big-decimal/index.js';

import { euclideanNormType, pointNormBroadcasts } from './utils.js';
import { bignumPreferred } from '../boxed-expression/utils.js';
import { flatten } from '../boxed-expression/flatten.js';
import {
  checkArity,
  nonNumericOperandError,
} from '../boxed-expression/validate.js';
import {
  arctan2AtInfinity,
  constructibleValues,
  evalTrig,
  halfTurnAngle,
  processInverseFunction,
  radiansToAngle,
  trigSign,
} from '../boxed-expression/trigonometry.js';

import { apply, apply2, shouldNumericize } from '../boxed-expression/apply.js';

import {
  reducedRational,
  reducedRationalFromDecimal,
} from '../numerics/rationals.js';
import type {
  OperatorDefinition,
  SymbolDefinitions,
  IComputeEngine,
} from '../global-types.js';
import type { Expression } from '../types-expression.js';
import type { OperandDescriptor } from '../types-definitions.js';
import type { Type } from '../../common/type/types.js';
import {
  isFunction,
  isNumber,
  isSymbol,
} from '../boxed-expression/type-guards.js';
import { infinitePoint } from '../boxed-expression/infinite-point.js';
import { typeFact } from '../boxed-expression/operand-descriptor.js';
import { nonNegativeSign } from '../boxed-expression/sgn.js';
import { EXTENDED_REAL_TYPE } from '../../common/type/primitive.js';
import { parseType } from '../../common/type/parse.js';
import { isTuple, isTupleShapedType } from '../collection-utils.js';
// Every `type` handler in this file is on the `'types'` (operand-descriptor)
// shape, so the helpers all come from the descriptor-shape module. The
// `OnTypes` suffixes are kept while the expression-shape module still
// exports the same names, so that the two shapes read apart at a glance.
import {
  broadcastOperandType,
  numericTypeHandler as numericTypeHandlerOnTypes,
  elementaryFunctionType as elementaryFunctionTypeOnTypes,
  boundedInverseTrigType as boundedInverseTrigTypeOnTypes,
  operandSgn as operandSgnOnTypes,
  iv,
  type RealDomain,
} from './type-handlers.js';
import { isMeasurement, measurementTrig } from './measurement-arithmetic.js';
import { trigExpand, trigToExp, trigReduce } from '../symbolic/trig-rewrite.js';
import { getUnitScale } from './unit-data.js';
import {
  bigFresnelC,
  bigFresnelS,
  bigSinc,
  cosIntegral,
  coshIntegral,
  fresnelC,
  fresnelS,
  sinc,
  sinhIntegral,
  sinIntegral,
} from '../numerics/special-functions.js';
import {
  sinIntegralComplex,
  cosIntegralComplex,
  sinhIntegralComplex,
  coshIntegralComplex,
} from '../numerics/numeric-complex.js';

/**
 * Whether a `Hypot` leg has an infinite magnitude, which makes the hypotenuse
 * `+∞` whatever the other leg is — a NaN leg included.
 *
 * A leg is infinite when it is a number literal at any infinite point — `±∞`,
 * the unsigned `~oo`, or an anonymous directed infinity such as `∞ + i`, all
 * of which have modulus `+∞` — or when it is a fixed-arity point with such a
 * component: a point enters the sum of squares through its own norm, and an
 * infinite component makes that norm `+∞`, so `Hypot((∞, NaN), 2)` is `+∞`
 * exactly as `Norm((∞, NaN))` is. One rule holds for every Euclidean norm: an
 * infinite leg dominates a NaN leg. IEEE 754 agrees —
 * `Math.hypot(Infinity, NaN)` is `Infinity` — and the compiled code emits
 * `Math.hypot`, so any other answer here would make the interpreter and the
 * compiled code disagree.
 *
 * `infinitePoint` reads the numeric value, so it answers `undefined` for NaN
 * and for an operand that is not a number literal, where a bare `!isFinite`
 * would be true for both.
 */
function hypotLegIsInfinite(v: Expression | undefined): boolean {
  if (v === undefined) return false;
  if (infinitePoint(v) !== undefined) return true;
  if (!isTuple(v) || !isFunction(v)) return false;
  return v.ops.some((c) => infinitePoint(c) !== undefined);
}

/**
 * Whether a `Hypot` leg is NaN, which makes the hypotenuse NaN when no leg is
 * infinite.
 *
 * The shape of the test mirrors `hypotLegIsInfinite`: a leg is NaN when it is
 * the NaN literal, or when it is a fixed-arity point with a NaN component — a
 * point enters the sum of squares through its own norm, and `Norm((NaN, 3))`
 * is NaN. The component scan is what the point needs: `isNaN` is `false` for a
 * tuple, whatever it holds, so a sign handler reading `isNaN` alone would
 * claim `non-negative` for `Hypot((NaN, 3), 5)` while the evaluate handler
 * answers NaN. Both handlers call this function so that they cannot disagree.
 *
 * An operand whose value is not yet known reports `isNaN` as `undefined` and
 * is not NaN here, which leaves the ordinary computation to decide.
 */
function hypotLegIsNaN(v: Expression | undefined): boolean {
  if (v === undefined) return false;
  if (v.isNaN === true) return true;
  if (!isTuple(v) || !isFunction(v)) return false;
  return v.ops.some((c) => c.isNaN === true);
}

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

/**
 * Result type of `Sinc`, `FresnelS` and `FresnelC` — a claim about ONE
 * element, since all three are broadcastable and the result-typing code
 * re-adds a collection operand's list shape around what this returns.
 *
 * All three are entire functions that are bounded on the whole real line and
 * have a finite limit at each end of it (`sinc(±∞) = 0`,
 * `S(±∞) = C(±∞) = ±1/2`), so on a proven real argument — finite or not —
 * the value is a finite real.
 *
 * A provably-NaN argument DECLINES so the framework's proven-NaN arm
 * answers the sharp `nan` (the `Sqrt`/`Erf` treatment — a handler answer
 * is never widened, so answering `number` here would suppress it).
 *
 * The wide fallback is what makes the remaining claims sound. A maybe-NaN
 * argument numericizes to `NaN`, a value only the top type `number`
 * admits, and off the real line all three are complex-valued: an unconditional
 * `real`, which these three definitions used to claim, was wrong in
 * both places. A proven FINITE argument claims the top numeric type
 * `number` too: an entire function does map a finite point to a finite
 * value, but the only remaining spelling for "finite, real or complex" is
 * `complex`, and claiming it would tell the compiler the value is NON-REAL
 * and switch the emitted lowering to complex arithmetic. Every gate narrows
 * on a proven fact, so an argument whose type decides neither realness nor
 * finiteness stays on the wide `number` as well.
 *
 * Every gate reads the ELEMENT type, because the claim is about one element.
 * The one value-channel read — `facts.finite` — describes the OPERAND, not
 * its elements (a finite collection of infinities is not what it is asking
 * about), so it is consulted only for a non-collection operand, where operand
 * and element are the same thing.
 *
 * The realness gate is the EXTENDED one. The bare name `real` denotes the
 * finite reals, so gating on it would drop the ends of the line — exactly
 * the arguments the finite-limit argument above is about — and send
 * `Sinc(∞)` (whose value is 0) to the top type.
 */
function boundedEntireRealType(
  x: OperandDescriptor | undefined
): Type | undefined {
  if (x === undefined) return 'number';
  const t = broadcastOperandType(x);
  if (typeFact(t, 'nan') === true) return undefined;
  if (typeFact(t, EXTENDED_REAL_TYPE) === true) return 'real';
  const scalar = x.facts.collection === true ? undefined : x;
  if (scalar?.facts.finite === true || typeFact(t, 'complex') === true)
    return 'number';
  return 'number';
}

export const TRIGONOMETRY_LIBRARY: SymbolDefinitions[] = [
  {
    //
    // Constants
    //
    Pi: {
      description:
        "The constant π ≈ 3.14159, the ratio of a circle's circumference to its diameter.",
      // Bracketed like `ExponentialE` (lower bound = the machine double of
      // π): the type alone proves π > 0, so `π·i` keeps its `imaginary`
      // claim off the type channel.
      type: 'real<3.141592653589793..3.141592653589794>',
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
      // A non-real or non-finite argument flows through the linear conversion
      // (`Degrees(i) = iπ/180`), so the claim must follow the operand.
      type: (ops) => numericTypeHandlerOnTypes(ops),
      canonical: (ops, { engine }) => {
        const ce = engine;
        if (ce.angularUnit === 'deg') return ops[0];
        if (ops.length !== 1) return ce._fn('Degrees', ops);
        const arg = ops[0];
        if (!isNumber(arg) || !arg.isValid) return ce._fn('Degrees', ops);

        const fArg = arg.re;

        if (Number.isNaN(fArg)) return arg.mul(ce.Pi).div(180);

        // A non-real argument flows through the linear conversion intact
        // (`Degrees(i) = iπ/180`, per the type handler above): the `.re`-based
        // paths below would silently drop the imaginary part and turn
        // `Degrees(i)` into 0.
        if (arg.im) return arg.mul(ce.Pi).div(180);

        // `Degrees(d)` is the faithful linear conversion `d·π/180` — it does
        // NOT reduce `d` mod 360. (Reducing here made the canonical form
        // disagree with the `evaluate` handler — `Degrees(390)` canonicalized
        // to `π/6` but a symbolic arg resolving to 390 evaluated to `13π/6` —
        // and corrupted faithful values such as `Degrees(-45.5)`. Angle
        // normalization to a range is a *serialization* concern, controlled by
        // the `angleNormalization` option.)
        if (arg.isRational === true) {
          const degNumer = arg.numerator.re;
          const degDenom = arg.denominator.re;
          // `.re` truncates bignum operands beyond 2^53 (and degDenom·180 can
          // overflow the safe-integer range), which would produce a *wrong*
          // exact result: use exact boxed arithmetic instead.
          if (
            !Number.isSafeInteger(degNumer) ||
            !Number.isSafeInteger(degDenom * 180)
          )
            return arg.div(180).mul(ce.Pi);
          const fRadians = reducedRational([degNumer, degDenom * 180]);
          if (fRadians[0] === 0) return ce.Zero;
          if (fRadians[0] === 1 && fRadians[1] === 1) return ce.Pi;
          if (fRadians[0] === 1) return ce.Pi.div(fRadians[1]);
          return ce.number(fRadians).mul(ce.Pi);
        }
        // An exact non-rational literal (a radical such as `√2`) must keep its
        // exactness: `.re` is a machine float, so `ce.number(fArg)` would
        // numericize a perfectly representable exact value — `Degrees(√2)`
        // returned 0.0246826… instead of `√2·π/180`. Only `√2`-style literals
        // reach here; `Pi` and `Ln(2)` are not number literals, so they skip
        // this path and are already handled exactly by `evaluate`.
        if (arg.isExact) return arg.div(180).mul(ce.Pi);
        return ce.number(fArg).div(180).mul(ce.Pi);
      },
      evaluate: (ops, options) => {
        // The `canonical` handler above hands a non-number operand straight
        // back unvalidated, so without this check the conversion below runs
        // `"a".mul(π/180)` and answers a bare `NaN` — a silently absorbed
        // type mistake, not a reported one.
        const nonNumeric = nonNumericOperandError(options.engine, ops);
        if (nonNumeric !== undefined) return nonNumeric;
        if (options.engine.angularUnit === 'deg') return ops[0];
        // Faithful `d·π/180` conversion, matching the canonical handler (no
        // mod-360 reduction — see the note there).
        return ops[0].mul(options.engine.Pi.div(180)).evaluate(options);
      },
    },

    // DMS(degrees, minutes?, seconds?) — programmatic angle construction
    DMS: {
      description: 'Construct an angle from degrees, minutes, and seconds.',
      // A complex component cannot be folded and leaves the call
      // unevaluated rather than truncated (see the evaluate handler), so the
      // declaration admits it; the type handler claims `real` when every
      // component is provably real and the wide `number` otherwise, which
      // is what the declared result says.
      signature: '(number, number?, number?) -> number',
      type: (ops) => numericTypeHandlerOnTypes(ops),
      canonical: (ops, { engine: ce }) => {
        const deg = ops[0]?.re ?? NaN;
        const min = ops[1]?.re ?? 0;
        const sec = ops[2]?.re ?? 0;

        // Every component is read with `.re`, which loses information for
        // two kinds of operand: it is NaN for anything that is not a number
        // LITERAL yet (an unevaluated call such as `At([30, 2], 1)` in the
        // minutes slot), and it silently drops the imaginary part of a
        // complex one. Folding either way is wrong — the NaN burns into
        // `Degrees(NaN)` and puts the right answer out of reach even though
        // the operand does resolve to 30, and the truncation makes
        // `DMS(1, i)` answer exactly what `DMS(1, 0)` does. Leave the whole
        // call unfolded whenever ANY component fails to read as a real
        // number; `evaluate` runs after the operands are evaluated and
        // retries there.
        if (!foldableDMSComponents(ops)) return ce._fn('DMS', ops);

        // A lone exact degrees argument needs no decimal recovery: hand it to
        // `Degrees` intact. The `.re` reads above are a decimal-notation
        // convenience and would otherwise float it (`DMS(√2)` → 0.0246826…).
        // The mixed case (`DMS(√2, 30)`) still goes through the decimal path —
        // combining an exact radical with minutes/seconds needs symbolic
        // arithmetic this constructor does not do.
        if (ops.length === 1 && isNumber(ops[0]) && ops[0].isExact)
          return ce.function('Degrees', [ops[0]]);

        // Decimal components make totalSec non-integer: recover an exact
        // scaled rational, or fall back to float degrees (a non-integer
        // rational pair would box to NaN).
        const totalSec = 3600 * deg + 60 * min + sec;
        const rational = reducedRationalFromDecimal(totalSec, 3600);
        return ce.function('Degrees', [
          rational !== null ? ce.number(rational) : ce.number(totalSec / 3600),
        ]);
      },
      evaluate: (ops, options) => {
        const ce = options.engine;
        // A non-number component reads `.re` as NaN below, which either
        // leaves the call inert (`DMS("a")`) or, for a minutes/seconds
        // component, propagates into the arithmetic and answers a bare
        // `NaN`. Report the operand instead — the `canonical` handler above
        // replaces the default signature check, so nothing else does.
        const nonNumeric = nonNumericOperandError(ce, ops);
        if (nonNumeric !== undefined) return nonNumeric;
        const deg = ops[0]?.re ?? NaN;
        const min = ops[1]?.re ?? 0;
        const sec = ops[2]?.re ?? 0;

        // Same check as the canonical handler: a component that is still
        // symbolic here (`DMS(x, 30)`) or is complex must leave the call
        // unevaluated rather than fold to `Degrees(NaN)` or drop its
        // imaginary part.
        if (!foldableDMSComponents(ops)) return ce._fn('DMS', ops);

        // Match the canonical handler's exact-degrees passthrough.
        if (ops.length === 1 && isNumber(ops[0]) && ops[0].isExact)
          return ce.function('Degrees', [ops[0]]).evaluate(options);

        // Match the canonical handler: keep exact arguments exact.
        const totalSec = 3600 * deg + 60 * min + sec;
        const rational = reducedRationalFromDecimal(totalSec, 3600);
        const degrees =
          rational !== null ? ce.number(rational) : ce.number(totalSec / 3600);
        if (ce.angularUnit === 'deg') return degrees;
        return degrees.div(180).mul(ce.Pi).evaluate(options);
      },
    },

    // Hypot: sqrt(x*x + y*y)
    Hypot: {
      description: 'Hypotenuse length: sqrt(x^2 + y^2).',
      broadcastable: true,
      // The carrier is the finite reals plus EVERY infinity, because
      // `√(x² + y²)` has a value at an infinite operand: an infinite leg
      // makes the hypotenuse infinite, whatever the other leg is
      // (`Math.hypot(∞, 2)` is `Infinity`, and `hypot(2, y)` for y = 10⁵,
      // 10¹⁰⁰, 10³⁰⁰ is y to within the rounding of the small leg).
      // Spelling the carrier `real` rejected `Hypot(2, +oo)` as
      // `incompatible-type` although its value is well defined. The
      // unsigned complex infinity `~oo` is admitted for the same reason,
      // and it is why the carrier is `infinity` rather than the signed
      // pair: `|~oo| = +∞` by definition of the point at infinity, so
      // `Hypot(~oo, 3)` is `+∞`, the answer every Euclidean norm gives an
      // infinite component. The `infinity` type also brings in an anonymous
      // directed infinity such as `∞ + i`, whose modulus is `+∞` as well.
      // Finite complex operands stay OUT of the carrier.
      //
      // The result is `real | +oo`: `+∞` is the ONLY infinite value a norm
      // can take — it is non-negative — and `-oo` is admitted as an
      // OPERAND only. The `nan` arm is the codomain vocabulary the
      // `handle` policy below needs: a `NaN` leg enters through the NaN
      // policy channel rather than through the carrier, and the handler
      // answers `NaN` for it. The sharp claim for an application still
      // comes from the type handler, which reports `real` for two finite
      // legs.
      signature: '(real | infinity, real | infinity) -> real | +oo | nan',
      // Explicit, because neither policy the framework can derive is right
      // here: the DERIVED Contract B default for this carrier is `reject`
      // (a carrier that admits the infinities is not a subtype of
      // `complex`, which is the mechanical propagate test —
      // `docs/ERROR-MODEL.md` §4), and `propagate` answers `NaN` from the
      // generic gate BEFORE the handler runs, which loses the infinity
      // precedence below (`Hypot(∞, NaN)` is `+∞`, not `NaN`). With
      // `handle` the gate stands down and the handler owns every
      // non-finite operand, on both routes.
      nanBehavior: 'handle',
      // A point argument with a broadcasting component zips into one result
      // per element (via its norm below) — report the honest list type, not
      // a decided-but-wrong scalar (the Tycho item-44 class).
      type: ([x, y]) => {
        if (
          (x && isTupleShapedType(x.type) && pointNormBroadcasts(x)) ||
          (y && isTupleShapedType(y.type) && pointNormBroadcasts(y))
        )
          return 'list<number>';
        // Both operands enter ONE sum of squares — a fixed-arity point
        // through its own norm — so the application is itself a Euclidean
        // norm over the flattened components, and `euclideanNormType`
        // is the claim for it. Flattening the point in is what keeps a tuple
        // from being silently dropped from the computation, which would
        // decide the type from the remaining scalar operands alone; a
        // tuple-TYPED operand that is not written out as a point has no
        // components to flatten and stands as itself, where the non-numeric
        // arm of `euclideanNormType` widens it to `number`.
        const components: OperandDescriptor[] = [];
        for (const o of [x, y]) {
          if (o === undefined) continue;
          const structure = o.structureOf?.();
          if (structure?.kind === 'tuple')
            components.push(...structure.elements);
          else components.push(o);
        }
        return euclideanNormType(components);
      },
      // A hypotenuse is `√(…)` of a sum of squares, so it is non-negative
      // — `+∞` included. The one exception is the NaN the handler answers
      // for a NaN leg with NO infinite sibling: NaN has no sign, so the
      // claim must stand down there, as it does in the `Abs` and `Add`
      // sign handlers. The infinite-leg test comes first for the same
      // reason it does in the handler below — an infinite leg dominates a
      // NaN leg, so `Hypot(+oo, NaN)` is the non-negative `+∞`. Both tests
      // read the same two helpers the evaluate handler reads, so the sign
      // cannot claim `non-negative` for an application that answers NaN;
      // a NaN inside a POINT leg is what makes that a real risk, since
      // `isNaN` is `false` for a tuple. An operand whose value is not yet
      // known is neither infinite nor NaN here and keeps the non-negative
      // claim.
      sgn: ([x, y]) => {
        if (hypotLegIsInfinite(x) || hypotLegIsInfinite(y))
          return 'non-negative';
        if (hypotLegIsNaN(x) || hypotLegIsNaN(y)) return 'unsigned';
        return 'non-negative';
      },
      // Evaluate the constructed √(x²+y²) so `.N()` returns a number, not an
      // unevaluated expression (the handler result is not re-driven otherwise).
      // Under `evaluate()` the exact folding still applies (`Hypot(1/2,1/3) →
      // √13/6`); under `.N()` it numericizes.
      // A fixed-arity point squares through its Euclidean norm (`Square` of a
      // bare `Tuple` is inert): Hypot((3,4), 1) = √(‖(3,4)‖² + 1²).
      evaluate: ([x, y], { engine, numericApproximation }) => {
        // An infinite leg makes the hypotenuse infinite whatever the other
        // leg is, NaN included — so this test comes before the NaN one
        // (`hypotLegIsInfinite` states the rule and its IEEE grounding).
        // `+oo` is the same value on both routes, so `numericApproximation`
        // changes nothing here.
        if (hypotLegIsInfinite(x) || hypotLegIsInfinite(y))
          return engine.PositiveInfinity;
        // With no infinite leg, a NaN leg makes the result NaN. The
        // operator declares `nanBehavior: 'handle'`, so this handler is
        // where that answer comes from on both routes. A NaN inside a
        // point leg counts, which is why the test is `hypotLegIsNaN` and
        // not `isNaN`: the construction below would answer NaN for it
        // anyway (through the point's own norm), and the sign handler
        // reads the same helper, so all three agree.
        if (hypotLegIsNaN(x) || hypotLegIsNaN(y)) return engine.NaN;
        const sq = (v: Expression): Expression =>
          engine.expr(isTuple(v) ? ['Square', ['Norm', v]] : ['Square', v]);
        return engine
          .expr(['Sqrt', ['Add', sq(x), sq(y)]])
          .evaluate({ numericApproximation });
      },
    },

    // The definition of other trig functions may rely on Sin, so it is defined
    // first in this preliminary section
    Sin: {
      ...trigFunction('Sin', 5000, 'Sine of an angle.', 'complex'),
      keywords: ['sine'],
      // The carrier is the FINITE complex numbers: sine is entire but has
      // no value and no limit at any infinity, so `Sin(±∞)` and
      // `Sin(~oo)` are incompatible-type errors (family-wide ruling,
      // 2026-08-31 — they answered symbolic-then-NaN before). A provable
      // violation errors at boxing through the validation seam that
      // checks a `canonical`-handler head against its declaration; the
      // factory's evaluate handler enforces the same carrier for a
      // non-finite value that only evaluation reveals. `NaN`
      // propagates by the mechanical default (finite complex carrier,
      // numeric result). The RESULT stays the wide `number` on purpose:
      // the compiled lanes' kind-preservation discipline documents its
      // reliance on it (`resultIsComplexValued`,
      // `compilation/javascript-target.ts` — a declared `complex` result
      // flips synthesized callback wrappers to the complex kernel), and
      // the per-call sharpness lives in the type handler.
      signature: '(complex) -> number',
    },
  },
  {
    //
    // Basic trigonometric function
    // (may be used in the definition of other functions below)
    //
    Arctan: {
      description: 'Inverse tangent.',
      keywords: ['atan'],
      wikidata: 'Q2257242',
      complexity: 5200,
      broadcastable: true,
      // The carrier is the finite complex numbers and the signed
      // infinities (`arctan(±∞) = ±π/2`). `~oo` is outside it: the two
      // real approaches disagree (`+π/2` against `−π/2`), so there is no
      // value at the single point at infinity — the same analysis as
      // `Arccot` (2026-09-01). This operator has no `canonical` handler,
      // so boxing validation enforces the carrier: `Arctan(~oo)` is an
      // invalid expression at creation. The logarithmic singularities
      // `arctan(±i)` are in-carrier finite points valued `~oo`. `NaN`
      // propagates (explicit: the carrier is not a subtype of `complex`).
      // The result stays the wide `number` (a complex argument gives a
      // complex value; the type handler carries the per-call sharpness).
      signature: '(complex | signed_infinity) -> number',
      nanBehavior: 'propagate',
      type: (ops) => elementaryFunctionTypeOnTypes('Arctan', ops),
      // arctan is odd and strictly increasing with arctan(0) = 0, so it
      // preserves the sign of its (real) argument; a non-real argument gives
      // `x.sgn` = 'unsigned'/undefined, which is also correct. (The generic
      // `trigSign` is quadrant-based — meaningless for an inverse function —
      // and returned undefined for every input.)
      sgn: ([x]) => x.sgn,
      evaluate: ([x], { numericApproximation, engine }) => {
        // arctan(±i) = ~oo: the logarithmic singularities of
        // `(i/2)·ln((i+z)/(i−z))`, where the modulus grows without bound.
        // Exact on both routes (`.N()` already answered `~oo`; `evaluate()`
        // used to stay symbolic). `isSame` compares the exact value — an
        // exact literal a hair off `i`, such as `(1 − 2⁻⁵⁴)i`, projects to
        // the machine double `im === 1` but is a finite point.
        if (isNumber(x) && (x.isSame(engine.I) || x.isSame(engine.I.neg())))
          return engine.ComplexInfinity;
        // arctan(±∞) = ±π/2 (the horizontal asymptotes). Needed for improper
        // integrals: ∫₀^∞ 1/(1+x²) = arctan(∞) − arctan(0) = π/2. Built
        // from `halfTurnAngle` because the result is an angle in the
        // engine's current `angularUnit`, at an infinite argument exactly
        // as at a finite one (in degree mode `arctan(1)` answers 45, so
        // `arctan(∞)` answers 90, not π/2).
        if (x.isInfinity && (x.isPositive || x.isNegative)) {
          const half = halfTurnAngle(engine);
          const v = x.isPositive ? half.div(2) : half.div(-2);
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
      keywords: ['atan2'],
      wikidata: 'Q776598',
      complexity: 5200,
      broadcastable: true,
      // atan2 is a function of the real plane: each carrier is the reals
      // and the signed infinities (a point may be at infinity along an
      // axis or a diagonal). A complex operand has no quadrant and `~oo`
      // no direction, so both are outside the carrier; this operator has
      // no `canonical` handler, so boxing validation rejects them at
      // creation (they used to leave the application inert). `NaN`
      // propagates (explicit: the carriers are not subtypes of
      // `complex`). The values at infinity are IEEE `atan2`'s, which the
      // compiled lane (`Math.atan2`) already answers (ruled 2026-09-01).
      signature:
        '(y: real | signed_infinity, x: real | signed_infinity) -> real',
      nanBehavior: 'propagate',
      type: (ops) => numericTypeHandlerOnTypes(ops),
      evaluate: ([y, x], { engine: ce, numericApproximation }) => {
        // NaN in → NaN out, in BOTH the evaluate and the N() paths. A NaN
        // operand is not finite, so without this early return it would slip
        // through the isFinite/isPositive guards below (isPositive is
        // undefined for NaN) and be assigned a spurious definite angle.
        // (The dispatch NaN gate answers this first for a literal NaN; the
        // guard stays for a held value the gate cannot see.)
        if (y.isNaN === true || x.isNaN === true) return ce.NaN;

        // A non-real operand is outside the carrier: boxing validation
        // rejects a literal, and the dispatch-time conformance re-test a
        // value that arrives later. This guard is the last line — a
        // complex value that reached the handler would stay symbolic in
        // BOTH paths rather than let evaluate() continue analytically via
        // Arctan (e.g. 0.549i) while .N()/apply2 silently reads the real
        // part (0).
        if ((isNumber(y) && y.im !== 0) || (isNumber(x) && x.im !== 0))
          return undefined;

        // Like the other inverse trig functions, the result is an angle in
        // the engine's current `angularUnit`: the numeric path converts via
        // `radiansToAngle`, the exact paths below build on `halfTurnAngle`
        // (π rad / 180 deg / 200 grad / 1/2 turn).
        const halfTurn = halfTurnAngle(ce);

        // The values at an infinite operand are exact and answer on BOTH
        // routes (the bignum `atan2` kernel answers NaN at the diagonal
        // corners): fold them first, numericized under `.N()`.
        if (y.isFinite === false || x.isFinite === false) {
          const v = arctan2AtInfinity(y, x, halfTurn, ce);
          if (v !== undefined) return numericApproximation ? v.N() : v;
          return undefined;
        }

        if (numericApproximation)
          return radiansToAngle(
            apply2(y, x, Math.atan2, (a, b) => BigDecimal.atan2(a, b))
          );

        // See https://en.wikipedia.org/wiki/Argument_(complex_analysis)#Realizations_of_the_function_in_computer_languages
        // Three-valued discipline throughout: only act on an === true / ===
        // false sign, never on an undefined one (which stays symbolic).
        if (y.isSame(0) && x.isSame(0)) return ce.Zero;
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

    Cos: {
      // Like `Sin`: no value at any infinity (oscillates toward the real
      // infinities, no limit at `~oo`).
      ...trigFunction('Cos', 5050, 'Cosine of an angle.', 'complex'),
      keywords: ['cosine'],
    },

    Tan: {
      // No value at any infinity. The POLES (odd multiples of π/2) are
      // in-carrier finite points whose VALUE is `~oo` — the carrier
      // restricts arguments, not results.
      ...trigFunction('Tan', 5100, 'Tangent of an angle.', 'complex'),
      keywords: ['tangent'],
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
    // Note: we use the ISO 80000-2 standard names for inverse hyperbolic
    // functions: Arsinh, Arcosh, Artanh, etc. (not Arcsinh, Arccosh, Arctanh)
    // The "ar" prefix stands for "area", which is mathematically correct
    // since these functions relate to areas on a hyperbola, not arc lengths.
    // `Arcosh(+∞) = +∞`; `Arcosh(−∞) = ∞ + iπ` follows the `Ln(−∞)`
    // treatment (symbolic under `evaluate()`, machine complex under
    // `.N()`); no value at `~oo` (the `Ln(~oo)` ruling — the modulus
    // diverges in every direction but the limit point does not exist).
    Arcosh: trigFunction(
      'Arcosh',
      6200,
      'Inverse hyperbolic cosine (area hyperbolic cosine).',
      'complex | signed_infinity'
    ),

    Arcsin: {
      ...trigFunction(
        'Arcsin',
        5500,
        'Arcsine, the inverse sine function.',
        'complex'
      ),
      keywords: ['asin', 'inverse sine'],
      // Same carrier and rationale as `Sin` above: arcsine extends to the
      // whole finite complex plane (`Arcsin(2)` is complex) but has no
      // value at any infinity, so a non-finite argument is an
      // incompatible-type error — at boxing when provable (the validation
      // seam of a `canonical`-handler head), and in the factory's evaluate
      // handler for a value only evaluation reveals. The result stays the
      // wide `number` for the same compiled-lane reason as `Sin` above.
      signature: '(complex) -> number',
    },

    // `Arsinh(±∞) = ±∞` (odd, increasing on the whole real line); the two
    // signs disagree, so no value at `~oo`.
    Arsinh: trigFunction(
      'Arsinh',
      6100,
      'Inverse hyperbolic sine (area hyperbolic sine).',
      'complex | signed_infinity'
    ),

    // `Artanh(±∞) = ∓(π/2)i` — the imaginary asymptotes of the principal
    // branch (ruled 2026-09-01: a finite imaginary value at a real
    // infinity is encoded, not rejected). The two signs disagree, so no
    // value at `~oo`.
    Artanh: trigFunction(
      'Artanh',
      6300,
      'Inverse hyperbolic tangent (area hyperbolic tangent).',
      'complex | signed_infinity'
    ),

    Cosh: {
      // `Cosh(±∞) = +∞`; no value at `~oo` (oscillates along the
      // imaginary directions).
      ...trigFunction(
        'Cosh',
        6050,
        'Hyperbolic cosine.',
        'complex | signed_infinity'
      ),
      keywords: ['hyperbolic cosine'],
    },

    // Cot/Csc/Sec: like the other circular functions, no value at any
    // infinity; their poles are in-carrier finite points valued `~oo`.
    Cot: trigFunction(
      'Cot',
      5600,
      'Cotangent, the reciprocal of tangent.',
      'complex'
    ),

    Csc: trigFunction(
      'Csc',
      5600,
      'Cosecant, the reciprocal of sine.',
      'complex'
    ),

    Sec: trigFunction(
      'Sec',
      5600,
      'Secant, the reciprocal of cosine.',
      'complex'
    ),

    Sinh: {
      // `Sinh(±∞) = ±∞`; the two signs disagree, so no value at `~oo`.
      ...trigFunction(
        'Sinh',
        6000,
        'Hyperbolic sine.',
        'complex | signed_infinity'
      ),
      keywords: ['hyperbolic sine'],
    },

    /** = sin(z/2)^2 = (1 - cos z) / 2*/
    Haversine: {
      description: 'Haversine function.',
      wikidata: 'Q2528380',
      broadcastable: true,
      // The parameter is the bare (finite) `real`, so an infinite argument
      // is rejected at the signature — `hav(±∞)` is NaN, outside this head's
      // domain (ruling L9(a) of the numeric-lattice ratification). Widening
      // it to the extended real line would also retype every undeclared
      // symbol used as an argument, which changes what the handler and the
      // compiler's real-versus-complex lowering see.
      signature: '(real) -> number',
      // hav is entire (½(1−cos z)): finite real → [0,1] ⊂ finite real, but
      // `hav(±∞)` is NaN and a complex argument gives a complex value.
      type: (ops) => numericTypeHandlerOnTypes(ops),
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
      signature: '(real) -> number',
      // Real only on [0, 1] (`hav⁻¹(z) = 2·arcsin(√z)`): outside, the value
      // is finite complex (`hav⁻¹(−1) = 1.7627…i`); no real pole. Same
      // honest-join treatment as the Arcsin family (user ruling 2026-07-30):
      // a symbolic real of unknown magnitude claims `complex`, and
      // the compiled path emits complex code accordingly.
      type: (ops) =>
        boundedInverseTrigTypeOnTypes(ops, INVERSE_HAVERSINE_DOMAIN),
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
    // `Csch(±∞) = Sech(±∞) = 0`; no value at `~oo` (both oscillate along
    // the imaginary directions, where cosh/sinh have zeros).
    Csch: trigFunction(
      'Csch',
      6200,
      'Hyperbolic cosecant, the reciprocal of hyperbolic sine.',
      'complex | signed_infinity'
    ),

    Sech: trigFunction(
      'Sech',
      6200,
      'Hyperbolic secant, the reciprocal of hyperbolic cosine.',
      'complex | signed_infinity'
    ),

    Tanh: {
      // `Tanh(±∞) = ±1` (the horizontal asymptotes); the two signs
      // disagree, so no value at `~oo`.
      ...trigFunction(
        'Tanh',
        6200,
        'Hyperbolic tangent.',
        'complex | signed_infinity'
      ),
      keywords: ['hyperbolic tangent'],
    },
  },
  {
    Arccos: {
      // Like `Arcsin`: extends to the whole finite complex plane but
      // diverges toward every infinity — no value at any of them.
      ...trigFunction(
        'Arccos',
        5550,
        'Arccosine, the inverse cosine function.',
        'complex'
      ),
      keywords: ['acos', 'inverse cosine'],
    },

    // `Arccot(+∞) = 0`, `Arccot(−∞) = π` (the ends of the engine's
    // (0, π) branch). The two disagree, so no value at `~oo` — this head
    // used to answer `Arccot(~oo) = 0`, which contradicted its own
    // `Arccot(−∞)`; the flip makes `~oo` an incompatible-type error.
    Arccot: trigFunction(
      'Arccot',
      5650,
      'Arccotangent, the inverse cotangent function.',
      'complex | signed_infinity'
    ),

    // Arcoth/Arcsch/Arcsec/Arccsc admit EVERY infinity (ruled
    // 2026-09-01): each is a composition through `1/x` whose inner head
    // (artanh, arsinh, arccos, arcsin) is continuous at 0, so all
    // directions of infinity — `+∞`, `−∞` and `~oo` alike — give the same
    // genuine value (0, 0, π/2, 0).
    Arcoth: trigFunction(
      'Arcoth',
      6350,
      'Inverse hyperbolic cotangent (area hyperbolic cotangent).',
      'complex | infinity'
    ),

    Arcsch: trigFunction(
      'Arcsch',
      6250,
      'Inverse hyperbolic cosecant (area hyperbolic cosecant).',
      'complex | infinity'
    ),

    Arcsec: trigFunction(
      'Arcsec',
      5650,
      'Arcsecant, the inverse secant function.',
      'complex | infinity'
    ),

    // `Arsech(±∞) = (π/2)i` — both real approaches give `arcosh(0)`
    // (ruled 2026-09-01, the imaginary-value ruling) — but the complex
    // directions disagree (arcosh's branch cut passes through 0), so
    // unlike its four neighbors above `~oo` is off-carrier.
    Arsech: trigFunction(
      'Arsech',
      6250,
      'Inverse hyperbolic secant (area hyperbolic secant).',
      'complex | signed_infinity'
    ),

    Arccsc: trigFunction(
      'Arccsc',
      5650,
      'Arccosecant, the inverse cosecant function.',
      'complex | infinity'
    ),

    // `Coth(±∞) = ±1`; the two signs disagree, so no value at `~oo`.
    Coth: trigFunction(
      'Coth',
      6300,
      'Hyperbolic cotangent, the reciprocal of hyperbolic tangent.',
      'complex | signed_infinity'
    ),

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
      // The carrier is every point where sinc has a value: the finite
      // complex numbers (entire, sinc(0) = 1) and the signed infinities
      // (`sinc(±∞) = 0`). Every value is finite, so the RESULT is plain
      // `complex`. `~oo` is off-carrier — sin(z)/z has no limit at
      // complex infinity (it diverges along the imaginary directions) —
      // and errors at BOXING (no `canonical` handler bypasses
      // validation here). `NaN` propagates (explicit: this carrier is
      // not a subtype of `complex`, so the derived default would be
      // `reject`).
      signature: '(complex | signed_infinity) -> complex',
      nanBehavior: 'propagate',
      type: ([x]) => boundedEntireRealType(x),
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
      // Same carrier rationale as `Sinc` above: entire with genuine
      // finite values at the signed infinities (`S(±∞) = ±1/2`), no
      // limit at `~oo` (off-carrier, a boxing error), result `complex`
      // (every value finite), `NaN` propagates by explicit declaration.
      signature: '(complex | signed_infinity) -> complex',
      nanBehavior: 'propagate',
      type: ([x]) => boundedEntireRealType(x),
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
      // Same carrier rationale as `Sinc` above: entire with genuine
      // finite values at the signed infinities (`C(±∞) = ±1/2`), no
      // limit at `~oo` (off-carrier, a boxing error), result `complex`
      // (every value finite), `NaN` propagates by explicit declaration.
      signature: '(complex | signed_infinity) -> complex',
      nanBehavior: 'propagate',
      type: ([x]) => boundedEntireRealType(x),
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
      // The four trigonometric integrals share the carrier
      // `complex | infinity` (every finite complex point has a value — they
      // are entire, or have a pole at 0 — and the infinite points are
      // decided in each handler), explicit `nanBehavior: 'propagate'` (the
      // carrier is not a subtype of `complex`, so the derived policy would
      // be `reject`), the wide `number` result (the compiled lanes read
      // it), and boxing as the seam (no `canonical` handler). At `~oo` and
      // at an anonymous infinity (`∞ + i`) none of the four has a value —
      // `Si(iy) = i·Shi(y)` diverges while `Si(±∞) = ±π/2` — so all four
      // answer `NaN` there (ruling recorded in
      // `docs/plans/2026-08-30-error-model-implementation.md`, Phase F
      // batch 8).
      signature: '(complex | infinity) -> number',
      nanBehavior: 'propagate',
      // Si is entire and odd: a real argument → finite real (including ±∞:
      // Si(±∞) = ±π/2); a finite complex argument → finite complex value. An
      // operand of unproven realness (a `number`-typed symbol) must not claim
      // real — it keeps the generic finite-point hedge. A NaN operand is
      // refuted as an extended real, so it takes the finite test below and
      // reaches the same `number` an explicit NaN gate would give.
      type: ([x]) => {
        if (!x) return 'number';
        const extendedReal = typeFact(x.type, EXTENDED_REAL_TYPE);
        if (extendedReal === false)
          return x.facts.finite === true ? 'complex' : 'number';
        if (extendedReal === true) return 'real';
        return 'number';
      },
      evaluate: ([x], { numericApproximation, engine: ce }) => {
        if (!isNumber(x)) return undefined;
        // Exact special values, regardless of numericApproximation.
        const point = infinitePoint(x);
        if (point === '+oo' || point === '-oo') {
          const v = point === '+oo' ? ce.Pi.div(2) : ce.Pi.div(-2);
          return numericApproximation ? v.N() : v;
        }
        if (point !== undefined) return ce.NaN;
        if (x.im === 0 && x.isSame(0)) return ce.Zero;
        if (!shouldNumericize(numericApproximation, x)) return undefined;
        // Real args use the machine kernel; complex args the E₁-based kernel.
        return apply(x, (x) => sinIntegral(x), undefined, sinIntegralComplex);
      },
    },

    /**
     * CosIntegral(x) = γ + ln x + ∫₀ˣ (cos t − 1)/t dt — Ci(0⁺) = −∞,
     * Ci(∞) = 0. For x < 0 the value is the PRINCIPAL one, `Ci(−x) = Ci(x) +
     * iπ` (Mathematica's `CosIntegral[-1]` is `0.337 + 3.142i`; the engine's
     * own `Ln(−1) = iπ` is the same convention; ruling recorded in
     * `docs/plans/2026-08-30-error-model-implementation.md`, Phase F
     * batch 8). Machine-precision only (no bignum kernel; ROADMAP B1).
     */
    CosIntegral: {
      description: 'Cosine integral: γ + ln(x) + ∫₀ˣ (cos(t)−1)/t dt.',
      complexity: 5200,
      broadcastable: true,
      // Carrier, NaN policy, result and seam: see `SinIntegral` above.
      // The infinite points: `Ci(+∞) = 0` (Ci(10⁶) = −3.5·10⁻⁷) and
      // `Ci(−∞) = iπ` — the real part vanishes as it does at `+∞`, the
      // imaginary part is the constant π of the principal branch (the
      // same encoding as a finite imaginary value at a real infinity,
      // `Artanh(±∞) = ∓iπ/2`).
      signature: '(complex | infinity) -> number',
      nanBehavior: 'propagate',
      // On the NON-NEGATIVE extended real line the value is on the extended
      // real line: `Ci(0) = −∞` is the one infinite value, so the claim has
      // to spell the signed infinities out — the bare name `real` denotes
      // the finite reals and would exclude the pole. Proving the argument
      // finite does not narrow the claim, because the pole is AT a finite
      // argument. A negative real argument gives a COMPLEX value (`Ci(x) +
      // iπ`), so realness alone proves nothing and the claim is `number`.
      // A finite complex argument → finite complex value. Unproven realness
      // → `number`. A NaN operand is refuted as an extended real, so it takes
      // the finite test and reaches `number` without a separate NaN gate.
      type: ([x]) => {
        if (!x) return 'number';
        const extendedReal = typeFact(x.type, EXTENDED_REAL_TYPE);
        if (extendedReal === false)
          return x.facts.finite === true ? 'complex' : 'number';
        return extendedReal === true &&
          nonNegativeSign(operandSgnOnTypes(x)) === true
          ? EXTENDED_REAL_TYPE
          : 'number';
      },
      evaluate: ([x], { numericApproximation, engine: ce }) => {
        if (!isNumber(x)) return undefined;
        // Exact special values, regardless of numericApproximation.
        const point = infinitePoint(x);
        if (point === '+oo') return ce.Zero;
        if (point === '-oo') {
          const v = ce.I.mul(ce.Pi);
          return numericApproximation ? v.N() : v;
        }
        if (point !== undefined) return ce.NaN;
        if (x.im === 0 && x.isSame(0)) return ce.NegativeInfinity;
        if (!shouldNumericize(numericApproximation, x)) return undefined;
        // A non-negative real argument uses the machine kernel; a negative
        // real one is the principal value `Ci(−x) = Ci(x) + iπ`, built from
        // the real kernel (the complex kernel hands an exactly-real
        // argument back to the real kernel, which would drop the offset).
        return apply(
          x,
          (v) =>
            v < 0 ? ce.complex(cosIntegral(-v), Math.PI) : cosIntegral(v),
          undefined,
          cosIntegralComplex
        );
      },
    },

    /**
     * SinhIntegral(x) = ∫₀ˣ sinh(t)/t dt — odd and entire, Shi(±∞) = ±∞.
     * Machine-precision only (no bignum kernel; ROADMAP B1).
     */
    SinhIntegral: {
      description: 'Hyperbolic sine integral: ∫₀ˣ sinh(t)/t dt.',
      complexity: 5200,
      broadcastable: true,
      // Carrier, NaN policy, result and seam: see `SinIntegral` above.
      signature: '(complex | infinity) -> number',
      nanBehavior: 'propagate',
      // Shi is entire and odd: a finite real → finite real, a finite complex
      // argument → finite complex value, Shi(±∞) = ±∞. An argument only known
      // to be on the EXTENDED real line therefore needs the extended real line
      // as its claim — the bare name `real` denotes the finite reals and would
      // exclude ±∞. Unproven realness → `number` (Shi is unbounded, so no
      // finite hedge is available). A NaN operand is refuted as an extended
      // real, so it takes the finite test and reaches `number` without a
      // separate NaN gate.
      type: ([x]) => {
        if (!x) return 'number';
        const extendedReal = typeFact(x.type, EXTENDED_REAL_TYPE);
        if (extendedReal === false)
          return x.facts.finite === true ? 'complex' : 'number';
        if (extendedReal === true)
          return x.facts.finite === true ? 'real' : EXTENDED_REAL_TYPE;
        return 'number';
      },
      evaluate: ([x], { numericApproximation, engine: ce }) => {
        if (!isNumber(x)) return undefined;
        // Exact special values, regardless of numericApproximation
        const point = infinitePoint(x);
        if (point === '+oo') return ce.PositiveInfinity;
        if (point === '-oo') return ce.NegativeInfinity;
        if (point !== undefined) return ce.NaN;
        if (x.im === 0 && x.isSame(0)) return ce.Zero;
        if (!shouldNumericize(numericApproximation, x)) return undefined;
        // Real args use the machine kernel; complex args the Si-based kernel.
        return apply(x, (x) => sinhIntegral(x), undefined, sinhIntegralComplex);
      },
    },

    /**
     * CoshIntegral(x) = γ + ln|x| + ∫₀ˣ (cosh t − 1)/t dt — Chi(0⁺) = −∞,
     * Chi(∞) = ∞. For x < 0 the value is the PRINCIPAL one, `Chi(−x) =
     * Chi(x) + iπ` (the `CosIntegral` convention above).
     * Machine-precision only (no bignum kernel; ROADMAP B1).
     */
    CoshIntegral: {
      description:
        'Hyperbolic cosine integral: γ + ln|x| + ∫₀ˣ (cosh(t)−1)/t dt.',
      complexity: 5200,
      broadcastable: true,
      // Carrier, NaN policy, result and seam: see `SinIntegral` above.
      // The infinite points: `Chi(+∞) = +∞` (Chi(100) = 1.4·10⁴¹) and
      // `Chi(−∞) = ∞ + iπ` under the principal convention — an infinite
      // real part with a finite imaginary offset, which no exact number
      // spells, so `evaluate()` stays symbolic and `.N()` answers the
      // machine complex (the `Ln(−∞)` treatment).
      signature: '(complex | infinity) -> number',
      nanBehavior: 'propagate',
      // On the NON-NEGATIVE extended real line the value is on the extended
      // real line: `Chi(0) = −∞` and `Chi(+∞) = +∞` are both infinite, so
      // the claim has to spell the signed infinities out — the bare name
      // `real` denotes the finite reals and would exclude them. Proving the
      // argument finite does not narrow the claim, because the pole is AT a
      // finite argument. A negative real argument gives a COMPLEX value
      // (`Chi(x) + iπ`), so realness alone proves nothing and the claim is
      // `number`. A finite complex argument → finite complex value.
      // Unproven realness → `number`. A NaN operand is refuted as an extended
      // real, so it takes the finite test and reaches `number` without a
      // separate NaN gate.
      type: ([x]) => {
        if (!x) return 'number';
        const extendedReal = typeFact(x.type, EXTENDED_REAL_TYPE);
        if (extendedReal === false)
          return x.facts.finite === true ? 'complex' : 'number';
        return extendedReal === true &&
          nonNegativeSign(operandSgnOnTypes(x)) === true
          ? EXTENDED_REAL_TYPE
          : 'number';
      },
      evaluate: ([x], { numericApproximation, engine: ce }) => {
        if (!isNumber(x)) return undefined;
        // Exact special values, regardless of numericApproximation.
        const point = infinitePoint(x);
        if (point === '+oo') return ce.PositiveInfinity;
        if (point === '-oo')
          return numericApproximation
            ? ce.number(ce.complex(Infinity, Math.PI))
            : undefined;
        if (point !== undefined) return ce.NaN;
        if (x.im === 0 && x.isSame(0)) return ce.NegativeInfinity;
        if (!shouldNumericize(numericApproximation, x)) return undefined;
        // A non-negative real argument uses the machine kernel; a negative
        // real one is the principal value `Chi(−x) = Chi(x) + iπ`, built
        // from the real kernel (see `CosIntegral` above).
        return apply(
          x,
          (v) =>
            v < 0 ? ce.complex(coshIntegral(-v), Math.PI) : coshIntegral(v),
          undefined,
          coshIntegralComplex
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

/** `InverseHaversine`: real on `[0, 1]`, finite complex outside, no real pole. */
const INVERSE_HAVERSINE_DOMAIN: RealDomain = {
  real: [iv(0, true, 1, true)],
  complex: [iv(-Infinity, false, 0, false), iv(1, false, Infinity, false)],
  poles: [],
  poleType: 'number',
};

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

/**
 * Can `DMS`'s degrees/minutes/seconds operands be folded into a single
 * degree count by reading `.re`?
 *
 * Only when each present component is a REAL number: `.re` is NaN for an
 * operand that is not a number literal (a symbol, or a call such as
 * `At([30, 2], 1)` that has not been evaluated yet), and it drops the
 * imaginary part of a complex one. The declared signature is
 * `(real, real?, real?) -> real`, but `DMS` supplies its own `canonical`
 * handler, which replaces the default signature-based argument validation —
 * so nothing else enforces the `real` claim on the components.
 *
 * An absent optional component is foldable: the fold defaults it to 0.
 */
function foldableDMSComponents(ops: ReadonlyArray<Expression>): boolean {
  return ops.every((op) => op === undefined || (isNumber(op) && op.im === 0));
}

/**
 * The genuine value of a trig-factory head at an in-carrier infinity, or
 * `undefined` when the point has no closed form under the current route.
 * Consulted only from the factory's evaluate seam, AFTER the carrier
 * admission check — so a `~oo` operand (`isPositive`/`isNegative` both
 * undefined) reaches here only for the `complex | infinity` heads, whose
 * value is the same in every direction of infinity.
 *
 * Every value is the limit of the branch the engine already implements at
 * finite arguments, verified against those values (e.g. `Artanh(2)`
 * answers `0.549… − (π/2)i` today, and its real part tends to 0 — so
 * `Artanh(+∞) = −(π/2)i` is the continuation, not a convention picked
 * here). The values are exact, so the caller folds them on both routes.
 */
function nonFiniteTrigValue(
  operator: string,
  x: Expression,
  ce: IComputeEngine,
  numericApproximation: boolean | undefined
): Expression | undefined {
  const pos = x.isPositive === true;
  switch (operator) {
    case 'Sinh':
    case 'Arsinh':
      return pos ? ce.PositiveInfinity : ce.NegativeInfinity;
    case 'Cosh':
      return ce.PositiveInfinity;
    case 'Tanh':
    case 'Coth':
      return pos ? ce.One : ce.NegativeOne;
    case 'Sech':
    case 'Csch':
      return ce.Zero;
    case 'Arcosh':
      if (pos) return ce.PositiveInfinity;
      // Arcosh(−∞) = ∞ + iπ — an infinite real part with a finite
      // imaginary offset, which no exact number spells. `evaluate()`
      // stays symbolic and only `.N()` numericizes, as a machine complex
      // (the `Ln(−∞)` treatment; `Arcosh(−2)` already answers
      // `1.317… + iπ`, so this is the continuation of the same branch).
      return numericApproximation
        ? ce.number(ce.complex(Infinity, Math.PI))
        : undefined;
    case 'Artanh':
      // The imaginary asymptotes of the principal branch: the real part
      // of `artanh(x)` tends to 0 as `x → ±∞` and the imaginary part is
      // the constant `∓π/2` beyond the cuts.
      return pos ? ce.I.mul(ce.Pi).div(-2) : ce.I.mul(ce.Pi).div(2);
    case 'Arsech':
      // Both real approaches give `arcosh(0) = iπ/2` (`arsech(x) =
      // arcosh(1/x)`); the complex directions disagree — arcosh's branch
      // cut passes through 0 — which is why the carrier admits only the
      // SIGNED infinities.
      return ce.I.mul(ce.Pi).div(2);
    // The two angle-valued cases below build on `halfTurnAngle` (π rad /
    // 180 deg / 200 grad / 1/2 turn) because inverse-circular results
    // are angles in the engine's current `angularUnit`, at an infinite
    // argument exactly as at a finite one (`arctan(1)` answers 45 in
    // degree mode). The inverse-HYPERBOLIC values above and below are
    // areas, not angles, so they take no unit conversion.
    case 'Arccot':
      // The engine's branch has range (0, π) — `Arccot(−1) = 3π/4` — so
      // the two ends of the real line map to the two ends of the range.
      // The disagreement (0 vs π) is also why `~oo` is off-carrier for
      // this head alone among the inverse reciprocals.
      return pos ? ce.Zero : halfTurnAngle(ce);
    case 'Arcsec':
      // arcsec(z) = arccos(1/z) and arccos is continuous at 0, so every
      // direction of infinity gives arccos(0) = π/2.
      return halfTurnAngle(ce).div(2);
    case 'Arccsc':
    case 'Arcoth':
    case 'Arcsch':
      // arcsin(1/z), artanh(1/z), arsinh(1/z): each inner head is
      // continuous at 0 with value 0, so every direction of infinity
      // gives 0.
      return ce.Zero;
    default:
      return undefined;
  }
}

/**
 * The shared definition of the 23 one-argument trigonometric, hyperbolic and
 * inverse heads. Everything but the `type` handler is identical across them,
 * and every head takes its type from the shared dispatcher
 * (`elementaryFunctionType` of `library/type-handlers.ts`).
 *
 * Two notes on what that dispatcher can prove, because they were the reason
 * the heads converted one family at a time:
 *
 * - `Cot`, `Csc`, `Coth` and `Csch` have a pole at 0, so the handler must
 *   disprove zero-ness through the operand's SIGN — for a compound operand
 *   (`2p` with `p` assumed positive, `p + 1`, `Sign(p)`, `π/2`) a proof only
 *   an operator `sgn` handler can give. The descriptor's sign fact carries
 *   it: `describe()` consults the (pure) operator `sgn` handlers for
 *   applications (open item O7 of
 *   `docs/plans/2026-08-22-type-handlers-on-types.md`).
 * - The nine heads routed to `boundedInverseTrigType` (`Arcsin`, `Arccos`,
 *   `Arcsec`, `Arccsc`, `Artanh`, `Arcoth`, `Arsech`, `Arcsch`, `Arcosh`)
 *   are the one family whose conversion CHANGED derived types, by ruling
 *   (2026-08-25). Their in-domain proof differs between the shapes: the
 *   expression shape asks the numeric predicates, which answer from the
 *   assumptions system, while the descriptor shape reads the operand's
 *   ranged TYPE — so a range that came from a DECLARATION
 *   (`ce.declare('BIG', 'real<2..>')`, which records no assumption) or from
 *   a ranged RESULT type (`Sign(r)`, `Exp(r)`) now proves containment the
 *   old shape could not, narrowing those claims (`Arcosh(BIG)` types
 *   `real`, not `number`), while an exact literal with no machine value
 *   (`1/3`, `√2`, a bigint) loses the old `.re` float-projection proof and
 *   widens (accepted rational-literal residue, ruling O4 of the plan doc).
 *   The adopted claims are pinned in
 *   `test/compute-engine/type-handler-parity.test.ts` ("bounded inverse
 *   trig heads read ranged types").
 */
function trigFunction(
  operator: string,
  complexity: number,
  description?: string,
  // Contract B carrier of the head, chosen from the head's mathematical
  // domain (rulings of 2026-08-31 and 2026-09-01, recorded in
  // `docs/plans/2026-08-30-error-model-implementation.md`):
  //
  // - `'complex'`: no value at ANY infinity (`Sin`, `Cos`, `Tan`, `Sec`,
  //   `Csc`, `Cot`, `Arcsin`, `Arccos` — the circular functions oscillate
  //   toward real infinity, and their inverses diverge there).
  // - `'complex | signed_infinity'`: a genuine value at `+∞` and `−∞` but
  //   none at `~oo` — the two real approaches disagree, or a branch cut
  //   makes the complex directions disagree (the hyperbolics, `Arsinh`,
  //   `Arcosh`, `Artanh`, `Arsech`, `Arccot`).
  // - `'complex | infinity'`: a genuine value at `~oo` as well — these are
  //   compositions through `1/x` whose inner inverse-trig head is
  //   continuous at 0, so every direction of infinity gives the same value
  //   (`Arcsec`, `Arccsc`, `Arcoth`, `Arcsch`).
  //
  // The `canonical` handler below checks arity and folds; the declared
  // carrier is enforced at boxing by the validation seam that checks a
  // `canonical`-handler head against its declaration (a provable
  // off-carrier operand becomes an incompatible-type error operand there),
  // and again at EVALUATION by the head itself for a non-finite value only
  // evaluation reveals, where an in-carrier infinity folds to the head's
  // value (`nonFiniteTrigValue`). `NaN` is NOT an error — it
  // propagates: derived for the `complex` carrier, declared explicitly for
  // the extended carriers (which are not subtypes of `complex`, so the
  // mechanical default there would be `reject`).
  //
  // Every call site passes the carrier explicitly; the parameter defaults
  // to the MOST RESTRICTIVE carrier (TypeScript disallows a required
  // parameter after the optional ones above) so an omitted argument fails
  // loudly at the first infinity instead of silently admitting one.
  carrier:
    | 'complex'
    | 'complex | signed_infinity'
    | 'complex | infinity' = 'complex'
): OperatorDefinition {
  // Parsed once per head at module load, for the incompatible-type error
  // value the evaluate seam produces.
  const carrierType = parseType(carrier);
  const common: OperatorDefinition = {
    complexity,
    description,
    broadcastable: true,
    signature: `(${carrier}) -> number`,
    ...(carrier !== 'complex' ? { nanBehavior: 'propagate' as const } : {}),
    sgn: ([x]) => trigSign(operator, x),
    canonical: (ops, { engine: ce }) => {
      if (ops.length === 1) {
        const radians = angularQuantityToRadians(ops[0]);
        if (radians) return ce._fn(operator, [radians]);
      }
      // Bind/canonicalize and splice sequence operands, but leave arity and
      // type checking to the framework's signature-validation seam. The old
      // `checkArity()` call mixed those two jobs and made every ordinary trig
      // call pay a second validation pass.
      ops = ce.strict ? flatten(ops) : checkArity(ce, ops, 1);
      return ce._fn(operator, ops);
    },
    evaluate: ([x], { numericApproximation, engine }) => {
      // The boxing seam reports a statically provable carrier violation.
      // This complements it for an operand whose static type is a UNION that
      // could still be numeric — the element type of a heterogeneous list,
      // `Sin(At(["a", 2], 1))` — which no boxing-time check can settle.
      const nonNumeric = nonNumericOperandError(engine, [x]);
      if (nonNumeric !== undefined) return nonNumeric;
      // The carrier, enforced at the evaluate seam (see the factory
      // parameter's comment). A non-finite non-NaN number operand is
      // either off-carrier (an incompatible-type error, the value boxing
      // validation would have produced) or an in-carrier infinity, which
      // folds to the head's genuine value at that point on BOTH routes —
      // the values are exact, so folding them under `evaluate()` honors
      // the exactness contract (the `Erf(±∞) = ±1` precedent). The one
      // in-carrier point with no exact spelling, `Arcosh(−∞) = ∞ + iπ`,
      // stays symbolic under `evaluate()` and numericizes under `.N()`
      // (the `Ln(−∞)` precedent).
      if (isNumber(x) && x.isFinite === false && x.isNaN !== true) {
        const signed = x.isPositive === true || x.isNegative === true;
        const admitted =
          carrier === 'complex | infinity' ||
          (carrier === 'complex | signed_infinity' && signed);
        if (!admitted) return engine.typeError(carrierType, x.type, x);
        const v = nonFiniteTrigValue(operator, x, engine, numericApproximation);
        if (v !== undefined) return numericApproximation ? v.N() : v;
        return engine._fn(operator, [x]);
      }
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

  return {
    ...common,
    type: (ops) => elementaryFunctionTypeOnTypes(operator, ops),
  };
}
