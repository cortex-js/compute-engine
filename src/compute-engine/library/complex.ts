// complex-cartesian (constructor) = re + i * im
// complex-polar = abs * exp(i * arg)

import type {
  Expression,
  OperatorTypeHandlerOnExpressions,
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
import { infinitePoint } from '../boxed-expression/infinite-point.js';
import { groundEnumerationOperand } from '../collection-utils.js';
import {
  type SubjectPart,
  hasAssumptions,
  signFromBounds,
} from '../boxed-expression/constraint-subject.js';
import { getInequalityBoundsFromAssumptions } from '../boxed-expression/inequality-bounds.js';
import type { Type } from '../../common/type/types.js';
import type { BoxedType } from '../../common/type/boxed-type.js';
import { isSubtype } from '../../common/type/subtype.js';
import { broadcastElementType } from '../../common/type/utils.js';
import { ExactNumericValue } from '../numeric-value/exact-numeric-value.js';
import { neg } from '../numerics/rationals.js';
import { measurementLipschitzUnary } from './measurement-arithmetic.js';

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
function collectionPartClaim(t: BoxedType): 'real' | 'number' {
  let el: Type = t.type;
  while (true) {
    const e = broadcastElementType(el);
    if (e === el) break;
    el = e;
  }
  return isSubtype('nan', el) ? 'number' : 'real';
}

// Re follows the operand's finiteness: a finite number has a finite real
// part, a signed or anonymous infinity has an infinite one, and `~oo` has
// none. A proven-NaN literal declines, so the framework's proven-NaN arm
// answers for it.
const realPartType: OperatorTypeHandlerOnExpressions = ([z]) => {
  if (!z) return 'number';
  if (z.isNaN === true) return undefined;
  const point = infinitePoint(z);
  if (point === '~oo') return 'nan';
  if (point !== undefined) return '+oo | -oo';
  const t = z.type;
  if (t.matches('complex')) return 'real';
  if (t.matches('+oo | -oo')) return '+oo | -oo';
  // Collection operand: scalar claim for the broadcast lift — elements
  // keep the generic finite-point convention (list-broadcast-typing).
  if (t.matches('indexed_collection<any>')) return collectionPartClaim(t);
  // A real-typed operand is its own real part. The bare name `real` is
  // finite and excludes `~oo` and NaN, so this claim is exact; a
  // `number`-typed operand may be either of those and keeps the top type.
  return t.matches('real') ? 'real' : 'number';
};

// Im of a finite number is a finite real, a real ±∞ and an anonymous
// infinity have a finite imaginary part, and `~oo` has none.
const imaginaryPartType: OperatorTypeHandlerOnExpressions = ([z]) => {
  if (!z) return 'number';
  if (z.isNaN === true) return undefined;
  const point = infinitePoint(z);
  if (point === '~oo') return 'nan';
  if (point !== undefined) return 'real';
  const t = z.type;
  if (t.matches('complex') || t.matches('+oo | -oo')) return 'real';
  if (t.matches('indexed_collection<any>')) return collectionPartClaim(t);
  // A real-typed operand has Im = 0. The bare name `real` is finite and
  // excludes `~oo` and NaN; a `number`-typed operand may be either, and
  // their imaginary part is not a finite real.
  return t.matches('real') ? 'real' : 'number';
};

// Arg of a finite number, of a real ±∞ (0 or π) or of an anonymous
// infinity (0 or π as well) is a finite real; `~oo` has no phase angle.
const argumentType: OperatorTypeHandlerOnExpressions = ([z]) => {
  if (!z) return 'number';
  if (z.isNaN === true) return undefined;
  const point = infinitePoint(z);
  if (point === '~oo') return 'nan';
  if (point !== undefined) return 'real';
  const t = z.type;
  if (t.matches('complex') || t.matches('+oo | -oo')) return 'real';
  if (t.matches('indexed_collection<any>')) return collectionPartClaim(t);
  // A real-typed operand has Arg ∈ {0, π}. The bare name `real` is finite
  // and excludes `~oo` and NaN; a `number`-typed operand may be either,
  // where Arg is NaN.
  return t.matches('real') ? 'real' : 'number';
};

// `AbsArg` builds the pair `(Abs(z), Argument(z))`, so its cells follow the
// two components: the modulus is a finite real or `+∞`, the angle a finite
// real — except at `~oo`, whose angle is NaN. Only that literal needs a
// claim sharper than the declared result.
const absArgType: OperatorTypeHandlerOnExpressions = ([z]) => {
  if (!z || z.isNaN === true) return undefined;
  if (infinitePoint(z) === '~oo') return 'tuple<+oo, nan>';
  return undefined;
};

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
      description: 'Complex conjugate of a number.',
      broadcastable: true,
      complexity: 1200,
      // Generic so that the result keeps the operand's own type (the
      // conjugate of an integer is an integer). The mathematical carrier is
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
      signature: '(T) -> T where T: number',
      nanBehavior: 'propagate',
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
        return Number.isInteger(n) && n > 0;
      },
      evaluate: (ops, { engine: ce }) => {
        const re = ops[0].re;
        if (isNaN(re)) return undefined;
        const n = ops[1].re;
        if (!Number.isInteger(n) || n <= 0) return undefined;

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
