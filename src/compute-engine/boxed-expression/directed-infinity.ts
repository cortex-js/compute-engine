import type { Expression, IComputeEngine } from '../global-types.js';
import { isFunction, isNumber } from './type-guards.js';

/**
 * The directed infinities: `DirectedInfinity(d)` is the infinite point
 * reached along the ray `t·d`, `t → +∞`, with `d` a finite nonzero complex
 * literal of unit modulus. `DirectedInfinity(i)` is `i·∞`. The real
 * directions are the signed infinities, so `DirectedInfinity(-1)` is `-∞`;
 * direction `0`, and no direction at all, is the undirected `~∞`.
 *
 * Every consumer reads a directed infinity through the helpers below, so
 * `evaluate()`, `.N()` and `simplify()` agree on which shapes are one.
 */
export const DIRECTED_INFINITY = 'DirectedInfinity';

/** Whether `d` is a finite number literal. */
const isFiniteLiteral = (d: Expression): boolean =>
  isNumber(d) && d.isFinite === true && d.isNaN !== true;

/**
 * The unit direction of an infinity: `1` or `-1` for a signed infinity, `d`
 * for `DirectedInfinity(d)` whose `d` is a finite nonzero number literal.
 * `undefined` for `~∞` (it has no direction), for a finite value, and for a
 * `DirectedInfinity` whose direction is not a literal.
 */
export function infiniteDirection(x: Expression): Expression | undefined {
  if (isNumber(x)) {
    if (x.isInfinity === true && x.im === 0 && x.isComplex === false)
      return x.isPositive === true ? x.engine.One : x.engine.NegativeOne;
    return undefined;
  }
  if (isFunction(x, DIRECTED_INFINITY) && x.nops === 1) {
    const d = x.op1;
    if (isFiniteLiteral(d) && !d.isSame(0)) return d;
  }
  return undefined;
}

/** Whether `x` is a directed infinity that is not a real one. */
export const isDirectedInfinity = (x: Expression): boolean =>
  isFunction(x, DIRECTED_INFINITY) && infiniteDirection(x) !== undefined;

/**
 * `DirectedInfinity(d)` in normal form, or `undefined` when `d` is not a
 * finite number literal (a symbolic direction stays as written):
 * - `d = 0` is `~∞`;
 * - a real `d` is the signed infinity of its sign;
 * - any other `d` is `DirectedInfinity(d/|d|)`, exact for an exact `d`
 *   (`(1 + i)/√2`), so the same direction has one spelling.
 */
export function directedInfinity(
  ce: IComputeEngine,
  d: Expression
): Expression | undefined {
  if (!isFiniteLiteral(d)) return undefined;
  if (d.isSame(0)) return ce.ComplexInfinity;
  if (isNumber(d) && !d.isComplex)
    return d.isPositive === true ? ce.PositiveInfinity : ce.NegativeInfinity;
  return ce._fn(DIRECTED_INFINITY, [unitDirection(d)]);
}

/** Relative distance from 1 under which a float modulus counts as unit. */
const UNIT_MODULUS_TOLERANCE = 1e-15;

/**
 * `d/|d|`. A float `d` whose modulus is already 1 to within a few ulps is
 * kept, because dividing it again drifts the last digit on every pass.
 */
function unitDirection(d: Expression): Expression {
  const ce = d.engine;
  if (isNumber(d) && !d.isExact) {
    const modulus = Math.hypot(d.re, d.im);
    if (Math.abs(modulus - 1) <= UNIT_MODULUS_TOLERANCE) return d;
    return ce.function('Divide', [d, ce.number(modulus)]).evaluate();
  }
  const modulus = ce.function('Abs', [d]).evaluate();
  if (modulus.isSame(1)) return d;
  return ce.function('Divide', [d, modulus]).evaluate();
}

/**
 * The product of one infinity and finite nonzero number literals, when the
 * result is not the real infinity the ordinary product rules already give:
 * a complex multiple of `±∞` keeps its direction, `i·∞ = DirectedInfinity(i)`
 * and `(1 + i)·∞ = DirectedInfinity((1 + i)/√2)`, and a factor of a directed
 * infinity turns it, `i·DirectedInfinity(i) = -∞`.
 *
 * `undefined` (the ordinary rules apply) for no infinite factor, two infinite
 * factors (`∞·~∞`, `∞·∞`), a symbolic or zero finite factor, or a real
 * multiple of a real infinity.
 */
export function multiplyInfinity(
  ce: IComputeEngine,
  factors: ReadonlyArray<Expression>
): Expression | undefined {
  const at = factors.findIndex((x) => infiniteDirection(x) !== undefined);
  if (at < 0) return undefined;
  // `~∞` and a second infinity are not finite factors, so they decline here.
  const finite = factors.filter((_, i) => i !== at);
  if (finite.length === 0) return undefined;
  if (!finite.every((x) => isFiniteLiteral(x) && !x.isSame(0)))
    return undefined;
  const direction = infiniteDirection(factors[at])!;
  const turn = finite.reduce((acc, x) => acc.mul(x), direction);
  // A real multiple of a real infinity: the signed-infinity rules answer it.
  if (isNumber(factors[at]) && isNumber(turn) && !turn.isComplex)
    return undefined;
  return directedInfinity(ce, turn);
}

/**
 * `Re` (`part = 're'`) or `Im` (`'im'`) of `DirectedInfinity(d)`: the infinity
 * of the sign of that part of `d`, or `0` when `d` has none. `undefined` when
 * `x` is not a directed infinity with a literal direction.
 */
export function infinityPart(
  ce: IComputeEngine,
  x: Expression,
  part: 're' | 'im'
): Expression | undefined {
  const d = infiniteDirection(x);
  if (d === undefined) return undefined;
  const v = part === 're' ? d.re : d.im;
  // The imaginary part of a real direction is exactly 0, even where the
  // double projection of a unit-modulus component would round to 0.
  if (v === 0 || (part === 'im' && isNumber(d) && !d.isComplex)) return ce.Zero;
  return v > 0 ? ce.PositiveInfinity : ce.NegativeInfinity;
}
