import { BoxedType } from '../../common/type/boxed-type.js';
import type { MathJsonExpression } from '../../math-json/types.js';
// complex-cartesian (constructor) = re + i * im
// complex-polar = abs * exp(i * arg)

import type {
  Expression,
  OperandDescriptor,
  OperatorTypeHandlerOnTypes,
  Sign,
  SymbolDefinitions,
  IComputeEngine as ComputeEngine,
} from '../global-types.js';
import {
  isFunction,
  isNumber,
  isSymbol,
} from '../boxed-expression/type-guards.js';
import { shouldNumericize } from '../boxed-expression/apply.js';
import {
  infinitePoint,
  type InfinitePoint,
} from '../boxed-expression/infinite-point.js';
import { groundEnumerationOperand } from '../collection-utils.js';
import {
  type SubjectPart,
  hasAssumptions,
  signFromBounds,
} from '../boxed-expression/constraint-subject.js';
import { getInequalityBoundsFromAssumptions } from '../boxed-expression/inequality-bounds.js';
import type { Type } from '../../common/type/types.js';
import {
  INDEXED_COLLECTION_SHAPE_TYPE,
  SIGNED_INFINITY_TYPE,
} from '../../common/type/primitive.js';
import { isSubtype } from '../../common/type/subtype.js';
import { broadcastCellType } from '../../common/type/utils.js';
import { ExactNumericValue } from '../numeric-value/exact-numeric-value.js';
import { neg } from '../numerics/rationals.js';
import { measurementLipschitzUnary } from './measurement-arithmetic.js';
import {
  functionLiteralParameterName,
  isRestParameter,
} from '../boxed-expression/function-literal.js';
import { checkNumericArgs } from '../boxed-expression/validate.js';

/**
 * The most roots `ComplexRoots(z, n)` materializes: one element per root, so
 * the work scales with the VALUE of `n`; a larger order stays symbolic.
 * A dedicated per-file constant, as for the other value-scaled caps.
 */
const MAX_COMPLEX_ROOTS = 10_000;

/**
 * Assumption-based sign fallback for the part extractors
 * (`Real`, `Imaginary`, `Argument` — and `Abs` in the arithmetic library):
 * when the operand is a symbol with no value, look up assumed bounds for the
 * corresponding subject (e.g. `im:tau` after `assume(Im(tau) > 0)`) and
 * derive the sign from them (docs/fungrim/FUNGRIM-PLAN-3-ASSUMPTIONS.md §5.1b).
 *
 * Reads the fact index directly (never `ask()`), so it works inside
 * `verify()`. Returns `undefined` when the facts don't entail a sign.
 */
export function signFromAssumedPart(
  ce: ComputeEngine,
  op: Expression,
  part: SubjectPart
): Sign | undefined {
  if (!isSymbol(op) || op.value !== undefined) return undefined;
  // Fast gate: engines with no assumptions do no index work.
  if (!hasAssumptions(ce)) return undefined;
  return signFromBounds(
    getInequalityBoundsFromAssumptions(ce, { symbol: op.symbol, part })
  );
}

/**
 * The `type` handlers of the part extractors `Real`, `Imaginary` and
 * `Argument`, extracted so that their aliases `Re`, `Im` and `Arg` can share
 * them.
 *
 * An alias canonicalizes to its target, so on the canonical route the type of
 * `Re(z)` is whatever `Real(z)` claims. On the STRUCTURAL route the alias is
 * bound but NOT rewritten, and it answers for itself: with only the declared
 * `(number) -> real` signature to go on, `Re(NaN)` claimed `real`, which does
 * not admit NaN, while `Real(NaN)` correctly claimed `number`. Sharing the
 * handler keeps the two spellings of one function from making different
 * claims about the same value.
 */

// The values of the part extractors at the infinite points, shared by the
// type handlers and the evaluate handlers below. The carrier of every
// extractor is `complex | infinity`: each has a value at every finite
// complex number and at every infinity, and `NaN` propagates (explicit
// `nanBehavior`: the carrier is not below `complex`, so the policy derived
// from the signature alone would be `reject`).
//
// - A signed infinity is real: `Re(±∞) = ±∞`, `Im(±∞) = 0`, `Arg(+∞) = 0`,
//   `Arg(−∞) = π`.
// - `~oo` is the point at infinity of the Riemann sphere: it has a modulus
//   but no direction, so it has no real part, no imaginary part and no
//   phase angle. All three answer NaN, the numeric codomain marker for a
//   decided "no value" (`docs/ERROR-MODEL.md` §2 rule 4).
// - An anonymous infinity is a complex literal whose REAL component is
//   infinite and whose imaginary component is finite (`∞ + i`; a literal
//   with an infinite imaginary component boxes as `~oo`). Its parts are
//   its components: `Re(∞ + i) = +∞`, `Im(∞ + i) = 1`, and its phase angle
//   is the direction of that vector, `Arg(∞ + i) = 0`, `Arg(−∞ + i) = π`.
//
// Ruled as such 2026-09-02 (Arno); the batch record is in
// `docs/plans/2026-08-30-error-model-implementation.md`, batch 9.

// The scalar claim for a COLLECTION operand, which the framework lifts to
// the collection's shape (the broadcast route). The elements keep the
// generic finite-point convention (`Real([2, 3])` is `vector<real^2>`,
// list-broadcast-typing) — unless the element type admits `nan`, where a
// NaN cell propagates through the lift (`Imaginary([1, NaN])` is
// `[0, NaN]`) and no finite claim is honest: the top numeric type then. A
// type handler's answer is authoritative, so this is the one place the
// per-cell NaN is accounted for.
function collectionPartClaim(t: Type): 'real' | 'number' {
  const el = broadcastCellType(t);
  return isSubtype('nan', el) ? 'number' : 'real';
}

/**
 * Is the operand provably NaN, as far as an operand descriptor can tell?
 *
 * A descriptor reports NaN and complex infinity identically — both are not
 * finite and both have the sign `unsigned` — so the FACTS alone cannot
 * separate them. The TYPE can, whenever it carries the value: the `~oo`
 * singleton and the `infinity` tier are subtypes of `infinity` and the NaN
 * singleton is not, so the infinity test runs first and only what it
 * refuses is treated as NaN. What stays conflated is a wide-declared
 * SYMBOL holding `~oo` (`w: number := ~oo`), whose type carries nothing:
 * it is read as possibly-NaN here and the handler declines, which leaves
 * the declared `number` result standing — the same claim the operand's
 * type would have produced anyway.
 */
function provablyNaN(d: OperandDescriptor): boolean {
  return (
    d.facts.finite === false &&
    d.facts.sgn === 'unsigned' &&
    !isSubtype(d.type, 'infinity')
  );
}

/**
 * Which infinite point a number LITERAL operand is, read from its
 * value-carrying type: the descriptor twin of `infinitePoint`
 * (`boxed-expression/infinite-point.ts`).
 *
 * The literal gate is the twin of that function's `isNumber` gate: a
 * symbol or a compound expression answers `undefined` even when its type
 * proves it infinite, and the type-channel arms of the handlers below
 * decide for it instead. A literal at one of the three named infinities
 * carries the matching singleton type; an anonymous infinity (`∞ + i`)
 * carries the `infinity` tier, which is the arm left once the three
 * singletons have been tested.
 */
function infinitePointOfDescriptor(
  d: OperandDescriptor
): InfinitePoint | undefined {
  if (d.structureOf?.()?.kind !== 'number') return undefined;
  const t = d.type;
  if (isSubtype(t, '~oo')) return '~oo';
  if (isSubtype(t, SIGNED_INFINITY_TYPE)) {
    return isSubtype(t, { kind: 'value', value: Infinity }) ? '+oo' : '-oo';
  }
  return isSubtype(t, 'infinity') ? 'anonymous' : undefined;
}

// Re follows the operand's finiteness: a finite number has a finite real
// part, a signed or anonymous infinity has an infinite one, and `~oo` has
// none. A proven-NaN literal declines, so the framework's proven-NaN arm
// answers for it.
const realPartType: OperatorTypeHandlerOnTypes = ([z], context) => {
  if (!z) return BoxedType.forResult('number', context.engine._typeResolver);
  if (provablyNaN(z)) return undefined;
  const point = infinitePointOfDescriptor(z);
  if (point === '~oo')
    return BoxedType.forResult('nan', context.engine._typeResolver);
  if (point !== undefined)
    return BoxedType.forResult('+oo | -oo', context.engine._typeResolver);
  const t = z.type;
  if (isSubtype(t, 'complex'))
    return BoxedType.forResult('real', context.engine._typeResolver);
  if (isSubtype(t, SIGNED_INFINITY_TYPE))
    return BoxedType.forResult('+oo | -oo', context.engine._typeResolver);
  // Collection operand: scalar claim for the broadcast lift — elements
  // keep the generic finite-point convention (list-broadcast-typing).
  if (isSubtype(t, INDEXED_COLLECTION_SHAPE_TYPE))
    return BoxedType.forResult(
      collectionPartClaim(t),
      context.engine._typeResolver
    );
  // A real-typed operand is its own real part. The bare name `real` is
  // finite and excludes `~oo` and NaN, so this claim is exact; a
  // `number`-typed operand may be either of those and keeps the top type.
  return BoxedType.forResult(
    isSubtype(t, 'real') ? 'real' : 'number',
    context.engine._typeResolver
  );
};

// Im of a finite number is a finite real, a real ±∞ and an anonymous
// infinity have a finite imaginary part, and `~oo` has none.
const imaginaryPartType: OperatorTypeHandlerOnTypes = ([z], context) => {
  if (!z) return BoxedType.forResult('number', context.engine._typeResolver);
  if (provablyNaN(z)) return undefined;
  const point = infinitePointOfDescriptor(z);
  if (point === '~oo')
    return BoxedType.forResult('nan', context.engine._typeResolver);
  if (point !== undefined)
    return BoxedType.forResult('real', context.engine._typeResolver);
  const t = z.type;
  if (isSubtype(t, 'complex') || isSubtype(t, SIGNED_INFINITY_TYPE))
    return BoxedType.forResult('real', context.engine._typeResolver);
  if (isSubtype(t, INDEXED_COLLECTION_SHAPE_TYPE))
    return BoxedType.forResult(
      collectionPartClaim(t),
      context.engine._typeResolver
    );
  // A real-typed operand has Im = 0. The bare name `real` is finite and
  // excludes `~oo` and NaN; a `number`-typed operand may be either, and
  // their imaginary part is not a finite real.
  return BoxedType.forResult(
    isSubtype(t, 'real') ? 'real' : 'number',
    context.engine._typeResolver
  );
};

// Arg of a finite number, of a real ±∞ (0 or π) or of an anonymous
// infinity (0 or π as well) is a finite real; `~oo` has no phase angle.
const argumentType: OperatorTypeHandlerOnTypes = ([z], context) => {
  if (!z) return BoxedType.forResult('number', context.engine._typeResolver);
  if (provablyNaN(z)) return undefined;
  const point = infinitePointOfDescriptor(z);
  if (point === '~oo')
    return BoxedType.forResult('nan', context.engine._typeResolver);
  if (point !== undefined)
    return BoxedType.forResult('real', context.engine._typeResolver);
  const t = z.type;
  if (isSubtype(t, 'complex') || isSubtype(t, SIGNED_INFINITY_TYPE))
    return BoxedType.forResult('real', context.engine._typeResolver);
  if (isSubtype(t, INDEXED_COLLECTION_SHAPE_TYPE))
    return BoxedType.forResult(
      collectionPartClaim(t),
      context.engine._typeResolver
    );
  // A real-typed operand has Arg ∈ {0, π}. The bare name `real` is finite
  // and excludes `~oo` and NaN; a `number`-typed operand may be either,
  // where Arg is NaN.
  return BoxedType.forResult(
    isSubtype(t, 'real') ? 'real' : 'number',
    context.engine._typeResolver
  );
};

// `AbsArg` builds the pair `(Abs(z), Argument(z))`, so its cells follow the
// two components: the modulus is a finite real or `+∞`, the angle a finite
// real — except at `~oo`, whose angle is NaN. Only that literal needs a
// claim sharper than the declared result.
const absArgType: OperatorTypeHandlerOnTypes = ([z], context) => {
  if (!z || provablyNaN(z)) return undefined;
  if (infinitePointOfDescriptor(z) === '~oo')
    return BoxedType.forResult('tuple<+oo, nan>', context.engine._typeResolver);
  return undefined;
};

/**
 * The pointwise conjugate of a function-typed operand of `Conjugate`, as a
 * function literal: `Conjugate(chi)` is `(...args) ↦ Conjugate(chi(...args))`.
 *
 * `Conjugate`'s signature is generic over `number`, and the boxing seam
 * re-validates a same-head result against it, so a function operand cannot
 * stay as an inert `Conjugate(chi)` node: the canonical handler returns this
 * literal instead. It is exactly what the conjugate of a function IS, and it
 * applies (`Apply(Conjugate(chi), n)` is `Conjugate(chi(n))`) without a
 * dedicated composition operator.
 *
 * The parameter list mirrors the operand's: a `Function` literal keeps its
 * own parameters (which cannot capture a free variable of the body, since
 * the body already binds those names); a symbol or other function-typed
 * expression gets one parameter per REQUIRED argument of its signature,
 * named so as not to capture a free variable of the operand, plus a REST
 * parameter when the signature has optional or variadic arguments — the bare
 * `function` type is `(any*) -> any`, so a function declared without a
 * signature gets the rest parameter alone. The rest parameter is spread back
 * into the application, which passes the trailing arguments on unchanged.
 *
 * The literal is built from RAW MathJSON, so that its body canonicalizes
 * inside the literal's own scope, after the parameters are bound. Building
 * the `Apply` canonical first validated `f(x)` against whatever the
 * ENCLOSING scope held under the parameter's name — an outer `x: string`
 * embedded an `incompatible-type` error in the wrapper, and an undeclared
 * outer `x` was inferred `complex` by a call that never concerned it. The
 * application is `Apply`, whose canonical form is the ordinary call for a
 * symbol head (`chi(x)`).
 */
function pointwiseConjugate(ce: ComputeEngine, f: Expression): Expression {
  // The literal's parameters and the matching arguments of the application,
  // both as raw MathJSON.
  let params: MathJsonExpression[] | undefined;
  let args: MathJsonExpression[] | undefined;
  if (isFunction(f, 'Function')) {
    const own = f.ops.slice(1);
    if (own.every((p) => functionLiteralParameterName(p) !== '')) {
      params = own.map((p) => p.json);
      args = own.map((p) => {
        const name = functionLiteralParameterName(p);
        return isRestParameter(p) ? ['Spread', name] : name;
      });
    }
  }
  if (params === undefined || args === undefined) {
    const t = f.type.type;
    let required = 0;
    let rest = true;
    if (typeof t !== 'string' && t.kind === 'signature') {
      required = t.args?.length ?? 0;
      rest = (t.optArgs?.length ?? 0) > 0 || t.variadicArg !== undefined;
    }
    // `x` for a single required argument, `x_1, x_2, …` otherwise, and
    // `args` for the rest parameter; a name the operand mentions free is
    // skipped so the literal cannot capture it.
    const taken = new Set<string>(f.unknowns);
    const fresh = (base: string): string => {
      let name = base;
      for (let k = 1; taken.has(name); k++) name = `${base}_${k}`;
      taken.add(name);
      return name;
    };
    params = [];
    args = [];
    for (let i = 1; i <= required; i++) {
      const name = fresh(required === 1 ? 'x' : `x_${i}`);
      params.push(name);
      args.push(name);
    }
    if (rest) {
      const name = fresh('args');
      params.push(['Spread', name]);
      args.push(['Spread', name]);
    }
  }
  return ce.box([
    'Function',
    ['Conjugate', ['Apply', f.json, ...args]],
    ...params,
  ]);
}

export const COMPLEX_LIBRARY: SymbolDefinitions[] = [
  {
    Real: {
      description: 'Real part of a complex number.',
      // @todo: could be extended to return an expression, i.e. ["Real", ["Add", "x", ["Complex", 0, 5]]] -> "x". Not for any operator, but at least for Add, Multiply, Negate, etc.
      broadcastable: true,
      complexity: 1200,
      // The declared result is the top numeric type because the type
      // handler legitimately claims `+oo | -oo` for an infinite operand and
      // `nan` for `~oo`, neither of which is below `real`; the handler
      // tightens the claim per call (the `Abs` arrangement).
      signature: '(complex | infinity) -> number',
      nanBehavior: 'propagate',
      type: realPartType,
      sgn: ([op], { engine: ce }) => {
        // The values the evaluate handler answers NaN for have no sign: a
        // NaN operand, and `~oo` — whose machine projection `re` is `+∞`
        // and would otherwise read as `positive`.
        if (op.isNaN === true || infinitePoint(op) === '~oo') return 'unsigned';
        const re = op.re;
        // Symbol with no value: fall back to assumed bounds on `re:op`
        // (design §5.1b)
        if (isNaN(re)) return signFromAssumedPart(ce, op, 're');
        if (re === 0) return 'zero';
        return re > 0 ? 'positive' : 'negative';
      },
      evaluate: (ops, { engine: ce }) => {
        // `Real(Measurement(v, σ))` is `Measurement(Real(v), σ)`: a numeric
        // integral of a complex-valued integrand comes back as a complex
        // Measurement, and its parts must stay extractable.
        const m = measurementLipschitzUnary(ce, 'Real', ops[0]);
        if (m !== undefined) return m;
        if (!isNumber(ops[0])) return undefined;
        // `~oo` has no direction, so no real part (see the table above the
        // type handlers). A signed infinity is its own real part and an
        // anonymous infinity reads its infinite real component: both take
        // the ordinary arms below.
        if (infinitePoint(ops[0]) === '~oo') return ce.NaN;
        const op = ops[0].numericValue;
        // A real value is its own real part: return the operand unchanged so an
        // exact real (`1/2`, `√2`) stays exact instead of being rounded to a
        // float. Only a genuinely complex value extracts a real part.
        if (typeof op === 'number' || op.im === 0) return ops[0];
        // An exact complex value carries its real part as an exact component
        // (a rational multiple of a square root): read that component rather
        // than the numeric projection, so `Re(1/3 + 2i/5)` is `1/3` and not a
        // 21-digit approximation of it.
        if (op instanceof ExactNumericValue)
          return ce.number(
            ce._numericValue({ rational: op.rational, radical: op.radical })
          );
        return ce.number(op.bignumRe ?? op.re);
      },
    },
    Imaginary: {
      description: 'Imaginary part of a complex number.',
      broadcastable: true,
      complexity: 1200,
      // Top numeric result for the same reason as `Real`: the handler
      // claims `nan` for `~oo`.
      signature: '(complex | infinity) -> number',
      nanBehavior: 'propagate',
      type: imaginaryPartType,
      sgn: ([op], { engine: ce }) => {
        // No sign where the value is NaN: a NaN operand (whose machine
        // projection `im` is `0` and would read as `zero`) and `~oo`.
        if (op.isNaN === true || infinitePoint(op) === '~oo') return 'unsigned';
        const im = op.im;
        // Symbol with no value: fall back to assumed bounds on `im:op`
        // (design §5.1b)
        if (isNaN(im)) return signFromAssumedPart(ce, op, 'im');
        if (im === 0) return 'zero';
        return im > 0 ? 'positive' : 'negative';
      },
      evaluate: (ops, { engine: ce }) => {
        // See `Real`: the imaginary part of a complex Measurement.
        const m = measurementLipschitzUnary(ce, 'Imaginary', ops[0]);
        if (m !== undefined) return m;
        if (!isNumber(ops[0])) return undefined;
        // A NaN operand normally never reaches the handler (the NaN gate
        // propagates it); the arm keeps the handler honest on the routes
        // that call it directly. `~oo` has no imaginary part.
        if (ops[0].isNaN === true) return ce.NaN;
        if (infinitePoint(ops[0]) === '~oo') return ce.NaN;
        const op = ops[0].numericValue;
        if (typeof op === 'number' || op.im === 0) return ce.Zero;
        // Exact operand: the imaginary part is an exact component too
        // (`Im(1/3 + 2i/5)` is `2/5`, `Im(√2·i)` is `√2`). `op.im` is the
        // machine projection of that component, so it must not be the source.
        if (op instanceof ExactNumericValue)
          return ce.number(
            ce._numericValue({ rational: op.imRational, radical: op.imRadical })
          );
        return ce.number(op.im);
      },
    },
    // The three aliases below (`Re`, `Im` and `Arg`) are canonical REWRITES to
    // their preferred spellings. Each builds its target with `ce.function()`,
    // not `ce._fn()`: `_fn()` skips signature validation, so `Re(1, 2)`
    // silently dropped the extra operand and answered `1` while `Real(1, 2)`
    // reported the unexpected argument. An alias must fail exactly where the
    // name it stands for fails. Each also shares its target's `type` handler,
    // so the narrow declared signature cannot leak on the structural route —
    // see the handlers above.
    Re: {
      description:
        '`Re` is an alias for `Real`, which is the preferred name. Returns the real part of a complex number.',
      broadcastable: true,
      complexity: 1200,
      signature: '(complex | infinity) -> number',
      nanBehavior: 'propagate',
      type: realPartType,
      canonical: (ops, { engine: ce }) => ce.function('Real', ops),
    },

    Im: {
      description:
        '`Im` is an alias for `Imaginary`, which is the preferred name. Returns the imaginary part of a complex number.',
      broadcastable: true,
      complexity: 1200,
      signature: '(complex | infinity) -> number',
      nanBehavior: 'propagate',
      type: imaginaryPartType,
      canonical: (ops, { engine: ce }) => ce.function('Imaginary', ops),
    },

    Argument: {
      description: 'Complex argument (phase angle) of a number.',
      broadcastable: true,
      complexity: 1200,
      // Top numeric result for the same reason as `Real`: the handler
      // claims `nan` for `~oo`.
      signature: '(complex | infinity) -> number',
      nanBehavior: 'propagate',
      type: argumentType,
      // Sign from assumed bounds on `arg:op` (design §5.1b); values are
      // handled by `evaluate`
      sgn: ([op], { engine: ce }) => signFromAssumedPart(ce, op, 'arg'),
      evaluate: (ops, { engine: ce, numericApproximation }) => {
        if (!isNumber(ops[0])) return undefined;
        // NaN has no phase angle. Without this guard the zero-imaginary-part
        // branch below asks `op >= 0`, which is false for NaN, and the
        // operand would be reported as if it were on the negative real axis
        // (`Argument(NaN)` → `π`).
        if (ops[0].isNaN) return ce.NaN;
        // `~oo` has no direction, so no phase angle: NaN. Its internal
        // representation is `(∞, ∞)`, which the `Arctan2` delegation below
        // would read as the direction π/4 (the IEEE diagonal corner of
        // `Arctan2(+∞, +∞)`). The signed infinities keep their axis
        // (`Argument(−∞) = π`) through the real branch, and an anonymous
        // infinity (`∞ + i`) keeps the direction of its vector through
        // `Arctan2` (0 or π).
        if (infinitePoint(ops[0]) === '~oo') return ce.NaN;
        const op = ops[0].numericValue;
        if (typeof op === 'number' || op.im === 0) {
          const isNonNegative = typeof op === 'number' ? op >= 0 : op.re >= 0;
          const result = isNonNegative ? ce.Zero : ce.Pi;
          // D2: an inexact (float) argument numericizes even under plain
          // evaluate() — `Argument(-5.1)` → 3.14159… (not the symbolic `Pi`).
          return shouldNumericize(numericApproximation, ops[0])
            ? result.N()
            : result;
        }
        return ce
          .function('Arctan2', [op.im, op.re])
          .evaluate({ numericApproximation });
      },
    },

    Arg: {
      description:
        '`Arg` is an alias for `Argument`, which is the preferred name. Returns the complex argument (phase angle) of a number.',
      broadcastable: true,
      complexity: 1200,
      signature: '(complex | infinity) -> number',
      nanBehavior: 'propagate',
      type: argumentType,
      canonical: (ops, { engine: ce }) => ce.function('Argument', ops),
    },

    // For Abs (magnitude) see src/compute-engine/library/processAbs

    AbsArg: {
      description: 'Tuple of magnitude and argument of a complex number.',
      keywords: ['polar form'],
      broadcastable: true,
      complexity: 1200,
      // The cells follow `Abs` and `Argument`: the modulus of an infinite
      // operand is `+∞`, and the angle of `~oo` is NaN (claimed by the
      // type handler for that literal). A NaN operand propagates to the
      // bare marker, not to a tuple of markers (ruled 2026-09-02; batch 9
      // of `docs/plans/2026-08-30-error-model-implementation.md`).
      signature: '(complex | infinity) -> tuple<real | +oo, real>',
      nanBehavior: 'propagate',
      type: absArgType,
      // Complete precondition: the evaluate guard (`isNumber`) on the ground
      // operand — the tuple is always built for a number literal, ±∞ and
      // `~oo` included (a NaN literal answers the NaN marker, which the
      // `nanBehavior` gate decides before this handler). A ground COLLECTION
      // operand takes the broadcast route instead, which this precondition
      // does not model.
      canEnumerate: (expr) => {
        if (!isFunction(expr)) return undefined;
        const z = groundEnumerationOperand(expr.op1);
        if (z === undefined) return undefined;
        if (z === null) return false;
        if (z.isCollection) return undefined;
        if (z.isNaN === true) return false;
        return isNumber(z);
      },
      evaluate: (ops, { engine: ce, numericApproximation }) => {
        if (!isNumber(ops[0])) return undefined;
        if (ops[0].isNaN === true) return ce.NaN;
        return ce.tuple(
          ce.function('Abs', ops).evaluate({ numericApproximation }),
          ce.function('Argument', ops).evaluate({ numericApproximation })
        );
      },
    },

    Conjugate: {
      description:
        'Complex conjugate of a number, or the pointwise conjugate of a function.',
      broadcastable: true,
      complexity: 1200,
      // Generic so that the result keeps the operand's own type (the
      // conjugate of an integer is an integer, the conjugate of a function
      // is a function with the same signature). The mathematical carrier is
      // every number but NaN — every finite complex number and every
      // infinity has a conjugate (`Conjugate(±∞) = ±∞`, `Conjugate(~oo) =
      // ~oo`, `Conjugate(∞ + i) = ∞ − i`) — so the only Contract B fact to
      // declare is the NaN policy, which is explicit here because the
      // `number` bound admits `nan` and would otherwise leave NaN to the
      // handler (inert). The bound is deliberately NOT the precise spelling
      // `complex | infinity`: the generic solver tests a bound by SUBTYPE,
      // so a `number`-typed operand (`Conjugate(Sinc(z))`, thirteen Fungrim
      // identities) would be a bound violation there, while a ground
      // carrier admits such an operand provisionally and leaves the
      // refutation to the runtime. Until the polytype route gains that
      // parity, the bound stays `number`.
      //
      // A FUNCTION operand is admitted by the canonical handler, not by the
      // signature: widening the bound to `number | function` made every
      // valueless operand infer that union, and `Conjugate(u) + 1` then typed
      // `function | number` instead of narrowing `u` to a number. The handler
      // rewrites `Conjugate(f)` to the pointwise literal `(x) ↦ Conjugate(f(x))`
      // (`pointwiseConjugate`), which is what the conjugate Dirichlet
      // character `Conjugate(chi)` in `DirichletLambda(1 - s, Conjugate(chi))`
      // denotes (Fungrim entry `288207`). A number operand takes the numeric
      // path: the boxing seam re-validates a same-head result against the
      // declaration but never infers on it — a canonical-handler head types
      // its own operands, as `Sin(x)` gives `x` the `number` of its numeric
      // check — so `checkNumericArgs` supplies the arity check, the
      // threading over a collection operand and the `number` narrowing of a
      // valueless symbol that the handler-less path used to provide.
      signature: '(T) -> T where T: number',
      nanBehavior: 'propagate',
      canonical: (ops, { engine: ce }) => {
        const [f] = ops;
        if (ops.length === 1 && f !== undefined && f.type.matches('function'))
          return pointwiseConjugate(ce, f);
        return ce._fn('Conjugate', checkNumericArgs(ce, ops, 1));
      },
      sgn: ([z]) => z.sgn,
      evaluate: (ops, { engine: ce }) => {
        // See `Real`: the conjugate of a complex Measurement.
        const m = measurementLipschitzUnary(ce, 'Conjugate', ops[0]);
        if (m !== undefined) return m;
        if (!isNumber(ops[0])) return undefined;
        const op = ops[0].numericValue;
        if (typeof op === 'number' || op.im === 0) return ops[0];
        // Negating the exact imaginary component keeps an exact operand exact
        // (`Conjugate(1/3 + 2i/5)` is `1/3 - 2i/5`), which is what makes
        // `z · Conjugate(z)` — the natural spelling of `|z|²` — answer with
        // the exact `61/225`. Going through `ce.complex(op.re, -op.im)` would
        // round both components to machine floats first.
        if (op instanceof ExactNumericValue)
          return ce.number(
            ce._numericValue({
              rational: op.rational,
              radical: op.radical,
              imRational: neg(op.imRational),
              imRadical: op.imRadical,
            })
          );
        return ce.number(ce.complex(op.re, -op.im));
      },
    },

    ComplexRoots: {
      description: 'All n-th complex roots of a number.',
      broadcastable: true,
      complexity: 1200,
      // The radicand is a FINITE complex number: the root set of an
      // infinite radicand has no usable value (every root has infinite
      // modulus and no determinable direction), so an infinite radicand is
      // off-carrier — an `incompatible-type` error at boxing (ruled
      // 2026-09-02; batch 9 of
      // `docs/plans/2026-08-30-error-model-implementation.md`). A NaN
      // radicand propagates (explicit: the result is a list, not a number,
      // so the derived policy would be `reject`); a NaN root count is a
      // contract violation, the ordinary `reject`. The root count must be
      // a positive integer: `requires` decides it for a literal count and
      // leaves a symbolic count to the handler.
      signature: '(complex, integer) -> list<number>',
      nanBehavior: ['propagate', 'reject'],
      requires: ([, n]) => {
        if (n === undefined || !isNumber(n)) return undefined;
        return n.re >= 1;
      },
      // Complete precondition, mirroring both evaluate declines on the ground
      // operands: a non-NaN real part, and a positive integer root count. (A
      // ground collection operand broadcasts — not modelled here.)
      canEnumerate: (expr) => {
        if (!isFunction(expr)) return undefined;
        const z = groundEnumerationOperand(expr.ops[0]);
        if (z === undefined) return undefined;
        if (z === null) return false;
        if (z.isCollection) return undefined;
        if (isNaN(z.re)) return false;
        const nOp = groundEnumerationOperand(expr.ops[1]);
        if (nOp === undefined) return undefined;
        if (nOp === null) return false;
        if (nOp.isCollection) return undefined;
        const n = nOp.re;
        // The root-count cap is part of the evaluate guard: past it the
        // roots stay symbolic, so the promise must decline too.
        return Number.isInteger(n) && n > 0 && n <= MAX_COMPLEX_ROOTS;
      },
      evaluate: (ops, { engine: ce }) => {
        const re = ops[0].re;
        if (isNaN(re)) return undefined;
        const n = ops[1].re;
        if (!Number.isInteger(n) || n <= 0) return undefined;
        // The result has `n` elements, so the loop scales with the operand
        // VALUE: past the cap the roots stay symbolic.
        if (n > MAX_COMPLEX_ROOTS) return undefined;

        const roots: [number, number][] = [];

        const im = ops[0].im ?? 0;

        const arg = Math.atan2(im, re);
        const mod = Math.sqrt(re * re + im * im);

        for (let k = 0; k < n; k++) {
          const theta = (arg + 2 * Math.PI * k) / n;
          const r = Math.pow(mod, 1 / n);
          roots.push([r * Math.cos(theta), r * Math.sin(theta)]);
        }

        return ce.function(
          'List',
          roots.map((r) =>
            ce.number(r[1] !== 0 ? ce.complex(r[0], r[1]) : r[0])
          )
        );
      },
    },
  },
];
