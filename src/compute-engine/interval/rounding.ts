/**
 * Outward rounding for the interval library.
 *
 * Every routine of this library answers an ENCLOSURE: the interval it returns
 * contains the true range of the function over its operands. A double
 * operation rounds to NEAREST, so a computed endpoint can fall half an ulp
 * INSIDE the true range — `mul` of two non-degenerate operands, `sqrt` of an
 * irrational radicand, `exp` of anything. An enclosure that excludes the value
 * it claims to bound is worse than a loose one: a caller uses this library to
 * PROVE that a curve misses a cell or that a function has no root in a box,
 * and such a proof is only as good as the bounds it reads.
 *
 * The routines are therefore exported through the decorators here. `outward`
 * moves each finite endpoint a fixed number of ulps outward — one step per
 * correctly rounded operation the routine performs, more for a routine that
 * rounds several times per endpoint. `outwardUnlessExact` moves only the
 * endpoints its prover cannot certify as the true real value.
 *
 * Exactness matters as much as soundness. `floor`, `round`, `trunc` and the
 * other step functions report a discontinuity for an enclosure that straddles
 * an integer, so a result that IS a real number a double holds — an integer,
 * a dyadic fraction, `2 · 0.5`, `49 / 49` — must stay bit-identical, or a
 * step function over it would answer a spurious jump. The provers below decide
 * that endpoint by endpoint, from the operands and the answer. Being wrong in
 * the direction of "exact" would return an enclosure that excludes the value,
 * so every prover answers `false` when it cannot decide.
 *
 * One ulp is a PROOF only for a routine whose endpoint is one correctly
 * rounded operation: the arithmetic of `arithmetic.ts` and `Math.sqrt`. For a
 * transcendental routine — `exp`, `ln`, the trigonometry, `gamma`, `erf` — the
 * underlying `Math` member is an approximation whose own error can exceed an
 * ulp, and the step is the minimum outward move, not a proof.
 *
 * @module interval/rounding
 */

import type { Interval, IntervalResult } from './types.js';
import { unwrap } from './util.js';
import { nextDown, nextUp } from '../numerics/numeric.js';
import { exactSum, prodExact } from '../numerics/interval-arithmetic.js';

/**
 * Which endpoints of a result its operation produced with NO rounding — the
 * true real value, not a neighbour of it.
 */
export type Exactness = { readonly lo: boolean; readonly hi: boolean };

/** A per-routine proof, reading the operands the routine was called with and
 *  the enclosure it answered. */
export type ExactnessProver = (
  args: readonly unknown[],
  value: Interval
) => Exactness;

const INEXACT: Exactness = { lo: false, hi: false };
const EXACT: Exactness = { lo: true, hi: true };
const LO_EXACT: Exactness = { lo: true, hi: false };
const HI_EXACT: Exactness = { lo: false, hi: true };

/**
 * The `Exactness` for the two sides, as one of the four shared singletons.
 *
 * Every prover answers through this, so a proof allocates nothing. The
 * decorator runs on every interval operation of every compiled kernel, and a
 * per-call object for a two-field record of booleans was measurable there.
 */
function exactness(lo: boolean, hi: boolean): Exactness {
  if (lo) return hi ? EXACT : LO_EXACT;
  return hi ? HI_EXACT : INEXACT;
}

/**
 * The enclosure an operand carries, or `undefined` when it carries none
 * (`empty`, `entire`, a pole) or is not interval-shaped at all (a number
 * exponent, a `BoolInterval`, a collection).
 */
function operandInterval(value: unknown): Interval | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    return undefined;
  return unwrap(value as Interval | IntervalResult);
}

/**
 * The enclosure of a result that the outward step applies to.
 *
 * A bare `{ lo, hi }`, the `interval` and `partial` kinds, and a `singular`
 * result that carries a finite jump all carry a computed bound. `empty`,
 * `entire` and a pole (a `singular` with no `value`) carry none.
 *
 * A jump's enclosure is stepped like any other. Some of them are written down
 * rather than computed — `[0, 1]` for `fract`, `[floor(lo), floor(hi)]` for
 * `floor` — but those routines select or truncate their operand's endpoints
 * and are exported unwrapped, so this decorator never sees them. The jump
 * hulls it does see are computed or spelled from a rounded constant, and
 * `atan2` is the case that proves the point: it writes `[-Math.PI, Math.PI]`
 * across its branch cut, and the double `Math.PI` is BELOW the real π that
 * `atan2(0, x)` attains for a negative `x`.
 */
function resultInterval(result: unknown): Interval | undefined {
  if (typeof result !== 'object' || result === null || Array.isArray(result))
    return undefined;
  const r = result as Partial<Interval> & { kind?: string; value?: Interval };
  if (r.kind === undefined)
    return typeof r.lo === 'number' && typeof r.hi === 'number'
      ? (r as Interval)
      : undefined;
  if (r.kind === 'interval' || r.kind === 'partial' || r.kind === 'singular')
    return r.value;
  return undefined;
}

/**
 * Whether every operand the routine was called with is finite.
 *
 * This is what tells an OVERFLOWED endpoint from a genuinely unbounded one —
 * see `widenEndpoint`. Operands that carry no magnitude of their own (a
 * callback, a collection, an absent optional argument) cannot make a result
 * infinite and are skipped.
 */
function operandsFinite(args: readonly unknown[]): boolean {
  for (const arg of args) {
    if (typeof arg === 'number') {
      if (!Number.isFinite(arg)) return false;
      continue;
    }
    const v = operandInterval(arg);
    if (v === undefined) continue;
    if (!Number.isFinite(v.lo) || !Number.isFinite(v.hi)) return false;
  }
  return true;
}

/**
 * `x` moved `steps` ulps in the direction `dir`, where `dir` is the outward
 * direction of the endpoint (−1 for a lower bound, +1 for an upper one).
 *
 * A non-finite endpoint normally has no neighbour to move to and is returned
 * as it is. The exception is an infinity facing INTO the interval — a lower
 * bound of +∞, or an upper bound of −∞. That is not a range reaching
 * infinity; it is a finite computation that OVERFLOWED, and the enclosure it
 * leaves is empty. `Number.MAX_VALUE·2` is such a case: the true product is
 * a real number above `Number.MAX_VALUE`, so `[MAX_VALUE, ∞)` encloses it
 * while `[∞, ∞]` encloses nothing. The overflow is recognised from the
 * operands — all of them finite — and the outward step answers it on its own,
 * since `nextDown(∞)` is `Number.MAX_VALUE`. NaN never moves.
 */
function widenEndpoint(
  x: number,
  dir: -1 | 1,
  steps: number,
  args: readonly unknown[]
): number {
  if (!Number.isFinite(x)) {
    if (dir < 0 ? x !== Infinity : x !== -Infinity) return x;
    if (!operandsFinite(args)) return x;
  }
  let v = x;
  for (let i = 0; i < steps; i++) v = dir < 0 ? nextDown(v) : nextUp(v);
  return v;
}

/**
 * Move each endpoint of `result` that `prove` does not certify `steps` ulps
 * outward, keeping the result's shape: a bare `{ lo, hi }` is replaced
 * wholesale, and a kinded result keeps its `kind`, its jump location and its
 * domain-clip marker with the widened enclosure. An answer that moved on
 * neither endpoint is returned untouched, so an exact routine allocates
 * nothing.
 */
function widenResult(
  result: unknown,
  steps: number,
  prove: ExactnessProver | undefined,
  args: readonly unknown[]
): unknown {
  const value = resultInterval(result);
  if (value === undefined) return result;
  // The collection accessors answer a bare `{ lo: NaN, hi: NaN }` for an
  // absent element. A NaN endpoint has no neighbour to move to, and it is not
  // equal to itself, so without this test the "nothing moved" check below
  // fails and every absent element rebuilds the interval.
  if (Number.isNaN(value.lo) && Number.isNaN(value.hi)) return result;
  const exact = prove ? prove(args, value) : INEXACT;
  if (exact.lo && exact.hi) return result;
  const lo = exact.lo ? value.lo : widenEndpoint(value.lo, -1, steps, args);
  const hi = exact.hi ? value.hi : widenEndpoint(value.hi, 1, steps, args);
  if (lo === value.lo && hi === value.hi) return result;
  const widened = { lo, hi };
  const kind = (result as { kind?: string }).kind;
  if (kind === undefined) return widened;
  // An `interval` answer is built by `ok()` on the way out of the routine, so
  // the wrapper reaching this point is freshly allocated and referenced by
  // nobody else: the widened enclosure is assigned into it rather than
  // allocating a second wrapper. A routine that returned a SHARED `interval`
  // object — a cached or a compile-time-folded constant handed straight back
  // — would be corrupted by that; none does. Every other kind carries markers
  // (`at`, `continuity`, `domainClipped`) that have to be copied.
  if (kind === 'interval') {
    (result as { value: Interval }).value = widened;
    return result;
  }
  return { ...(result as object), value: widened };
}

/**
 * Wrap a routine so each endpoint of its answer that `prove` does not certify
 * is moved `steps` ulps outward.
 *
 * The one- and two-argument kernels are the whole hot path — every arithmetic
 * operation and every elementary and trigonometric routine of a compiled
 * kernel — so they get a wrapper with a fixed parameter list: a rest parameter
 * allocates an array on every call. `scratch` is the argument list the prover
 * reads. It is filled AFTER the kernel has returned and read immediately, and
 * no decorated call runs in between, so one array per decorated routine is
 * enough. A prover must therefore not retain the array it is given; none does.
 *
 * The fixed list is taken from the kernel's DECLARED parameters, so a kernel
 * that is called with more arguments than it declares must not be decorated:
 * the extra ones would be dropped. An optional parameter is the case to watch,
 * because it does not count toward the declared arity — `chop(x, tolerance)`
 * declares one parameter and is exported unwrapped for that reason. A kernel
 * with three or more declared parameters falls through to the rest path, which
 * allocates one argument array per call.
 */
function decorate<F extends (...args: never[]) => unknown>(
  fn: F,
  steps: number,
  prove?: ExactnessProver
): F {
  const raw = fn as unknown as (...a: unknown[]) => unknown;
  if (raw.length === 1) {
    const scratch: unknown[] = [undefined];
    const rounded1 = (a0: unknown): unknown => {
      const result = raw(a0);
      scratch[0] = a0;
      return widenResult(result, steps, prove, scratch);
    };
    return rounded1 as unknown as F;
  }
  if (raw.length === 2) {
    const scratch: unknown[] = [undefined, undefined];
    const rounded2 = (a0: unknown, a1: unknown): unknown => {
      const result = raw(a0, a1);
      scratch[0] = a0;
      scratch[1] = a1;
      return widenResult(result, steps, prove, scratch);
    };
    return rounded2 as unknown as F;
  }
  const rounded = (...args: unknown[]): unknown =>
    widenResult(raw(...args), steps, prove, args);
  return rounded as unknown as F;
}

/** Wrap a routine so every finite endpoint of its answer moves `steps` ulps
 *  outward — one step per correctly rounded operation the routine performs on
 *  an endpoint. */
export function outward<F extends (...args: never[]) => unknown>(
  fn: F,
  steps = 1
): F {
  return decorate(fn, steps, undefined);
}

/** Wrap a routine so an endpoint moves `steps` ulps outward unless `prove`
 *  certifies it as the true real value. */
export function outwardUnlessExact<F extends (...args: never[]) => unknown>(
  fn: F,
  prove: ExactnessProver,
  steps = 1
): F {
  return decorate(fn, steps, prove);
}

/** An endpoint is exact when either prover certifies it. */
export function eitherExact(
  a: ExactnessProver,
  b: ExactnessProver
): ExactnessProver {
  return (args, value) => {
    const x = a(args, value);
    // Both endpoints are already certified; the second prover cannot add to
    // that, so it is not run.
    if (x.lo && x.hi) return x;
    const y = b(args, value);
    return exactness(x.lo || y.lo, x.hi || y.hi);
  };
}

// ---------------------------------------------------------------------------
// Per-routine exactness proofs.
//
// Each prover repeats the endpoint rule of the routine it serves — which
// endpoints of the operands produce which endpoint of the answer — so a change
// to that rule must be mirrored here.
// ---------------------------------------------------------------------------

/**
 * `[a.lo + b.lo, a.hi + b.hi]`: one addition per endpoint, and Knuth's TwoSum
 * decides each one.
 */
export function exactAdd(args: readonly unknown[]): Exactness {
  const a = operandInterval(args[0]);
  const b = operandInterval(args[1]);
  if (a === undefined || b === undefined) return INEXACT;
  return exactness(exactSum(a.lo, b.lo), exactSum(a.hi, b.hi));
}

/**
 * `[a.lo − b.hi, a.hi − b.lo]`. Negation is exact, so the subtraction is the
 * same TwoSum test on the negated operand.
 */
export function exactSub(args: readonly unknown[]): Exactness {
  const a = operandInterval(args[0]);
  const b = operandInterval(args[1]);
  if (a === undefined || b === undefined) return INEXACT;
  return exactness(exactSum(a.lo, -b.hi), exactSum(a.hi, -b.lo));
}

/**
 * Were the result endpoints reached from the operand-endpoint pairs an
 * interval multiplication takes the extremum over — with no rounding on any
 * pair that reaches them?
 *
 * Every pair whose product equals an endpoint has to be exact, not just one of
 * them: a second pair that rounded TO that endpoint may have a true product
 * below it (for a lower endpoint), in which case the endpoint is not a bound.
 * A pair whose product is any other double is at least one ulp away, so its
 * true product cannot cross the endpoint. A zero operand gives the exact
 * product zero — the `0 · ±∞ = 0` convention of `arithmetic.ts` included.
 *
 * Both endpoints are decided in ONE walk of the corners, and a degenerate
 * operand contributes one corner rather than two: this runs on every
 * multiplication of every compiled kernel, and Dekker's split is the
 * expensive part of it.
 */
function productExactness(
  a: Interval,
  b: Interval,
  value: Interval
): Exactness {
  let loSeen = false;
  let loBad = false;
  let hiSeen = false;
  let hiBad = false;
  const nx = a.lo === a.hi ? 1 : 2;
  const ny = b.lo === b.hi ? 1 : 2;
  for (let i = 0; i < nx; i++) {
    const x = i === 0 ? a.lo : a.hi;
    for (let j = 0; j < ny; j++) {
      const y = j === 0 ? b.lo : b.hi;
      const zero = x === 0 || y === 0;
      const p = zero ? 0 : x * y;
      const isLo = p === value.lo;
      const isHi = p === value.hi;
      if (!isLo && !isHi) continue;
      const exact = zero || prodExact(x, y, p);
      if (isLo) {
        loSeen = true;
        if (!exact) loBad = true;
      }
      if (isHi) {
        hiSeen = true;
        if (!exact) hiBad = true;
      }
    }
  }
  return exactness(loSeen && !loBad, hiSeen && !hiBad);
}

/** The extremum over the four endpoint products. */
export function exactMul(args: readonly unknown[], value: Interval): Exactness {
  const a = operandInterval(args[0]);
  const b = operandInterval(args[1]);
  if (a === undefined || b === undefined) return INEXACT;
  return productExactness(a, b, value);
}

/**
 * Two endpoint products, plus the exact lower bound 0 an interval that
 * straddles zero gets (no square is below it).
 */
export function exactSquare(
  args: readonly unknown[],
  value: Interval
): Exactness {
  const x = operandInterval(args[0]);
  if (x === undefined) return INEXACT;
  const square = squareExactness(x, value);
  return exactness(value.lo === 0 || square.lo, square.hi);
}

/** The same one-walk rule as `productExactness`, over the two endpoint squares
 *  a squaring takes the extremum of. The cross products `lo·hi` are NOT
 *  candidates here, so they are not walked. */
function squareExactness(x: Interval, value: Interval): Exactness {
  let loSeen = false;
  let loBad = false;
  let hiSeen = false;
  let hiBad = false;
  const n = x.lo === x.hi ? 1 : 2;
  for (let i = 0; i < n; i++) {
    const v = i === 0 ? x.lo : x.hi;
    const p = v * v;
    const isLo = p === value.lo;
    const isHi = p === value.hi;
    if (!isLo && !isHi) continue;
    const exact = v === 0 || prodExact(v, v, p);
    if (isLo) {
      loSeen = true;
      if (!exact) loBad = true;
    }
    if (isHi) {
      hiSeen = true;
      if (!exact) hiBad = true;
    }
  }
  return exactness(loSeen && !loBad, hiSeen && !hiBad);
}

/**
 * `Math.sqrt` is correctly rounded, so an endpoint `s` is the true root of an
 * operand endpoint exactly when `s·s` reproduces that endpoint with no
 * rounding. The lower bound 0 of a radicand that straddles zero is exact on
 * its own (the clipped domain starts there).
 */
export function exactSqrt(
  args: readonly unknown[],
  value: Interval
): Exactness {
  const x = operandInterval(args[0]);
  if (x === undefined) return INEXACT;
  const rootExact = (s: number, radicand: number): boolean =>
    prodExact(s, s, s * s) && s * s === radicand;
  return exactness(
    value.lo === 0 || rootExact(value.lo, x.lo),
    rootExact(value.hi, x.hi)
  );
}

/**
 * IEEE division is correctly rounded, so a quotient `q` of two endpoints is
 * the true one exactly when `q · y` reproduces the dividend `x` with no
 * rounding. The same "every pair that reaches the endpoint must be exact" rule
 * as `productEndpointExact`, over the four corner quotients `_div`
 * (`arithmetic.ts`) takes the extremum of. The annihilations that routine
 * applies — a zero dividend or an infinite divisor — give the exact quotient
 * zero. A corner over a zero divisor is infinite, which no finite endpoint
 * reaches, and an infinite endpoint is never stepped.
 */
export function exactDiv(args: readonly unknown[], value: Interval): Exactness {
  const a = operandInterval(args[0]);
  const b = operandInterval(args[1]);
  if (a === undefined || b === undefined) return INEXACT;
  return quotientExactness(a, b, value);
}

/**
 * The rule of `negDiv` (`arithmetic.ts`): the four corner quotients of the
 * NEGATED numerator against the divisor. Negation only flips the sign of each
 * endpoint, which is exact, so the corners are those of `[-a.hi, -a.lo]`
 * against `b`.
 */
export function exactNegDiv(
  args: readonly unknown[],
  value: Interval
): Exactness {
  const a = operandInterval(args[0]);
  const b = operandInterval(args[1]);
  if (a === undefined || b === undefined) return INEXACT;
  return quotientExactness({ lo: -a.hi, hi: -a.lo }, b, value);
}

/** The same one-walk rule as `productExactness`, over the four corner
 *  quotients. */
function quotientExactness(
  a: Interval,
  b: Interval,
  value: Interval
): Exactness {
  let loSeen = false;
  let loBad = false;
  let hiSeen = false;
  let hiBad = false;
  const nx = a.lo === a.hi ? 1 : 2;
  const ny = b.lo === b.hi ? 1 : 2;
  for (let i = 0; i < nx; i++) {
    const x = i === 0 ? a.lo : a.hi;
    for (let j = 0; j < ny; j++) {
      const y = j === 0 ? b.lo : b.hi;
      const annihilated = x === 0 || y === Infinity || y === -Infinity;
      const q = annihilated ? 0 : x / y;
      const isLo = q === value.lo;
      const isHi = q === value.hi;
      if (!isLo && !isHi) continue;
      const exact = annihilated || (prodExact(q, y, q * y) && q * y === x);
      if (isLo) {
        loSeen = true;
        if (!exact) loBad = true;
      }
      if (isHi) {
        hiSeen = true;
        if (!exact) hiBad = true;
      }
    }
  }
  return exactness(loSeen && !loBad, hiSeen && !hiBad);
}

/** How many factors an integer power is checked through before the proof
 *  gives up and the endpoint is widened. The bound keeps the check from
 *  walking a huge exponent; a power that appears in a plotted expression is
 *  small. */
const MAX_PROVEN_POWER = 64;

/**
 * The exact value of `v` raised to the non-negative integer `n`, or `NaN` when
 * no double holds it.
 *
 * The power is built one multiplication at a time and every product is checked
 * with Dekker's TwoProduct, so a single rounded factor makes the whole answer
 * `NaN`. This is what keeps an alternating sign sum `Σ (−1)^k` at the exact
 * point 0: `Math.pow` is not a correctly rounded operation, so its answer
 * cannot be trusted on its own, but here it only has to AGREE with the exact
 * chain.
 */
function exactIntegerPower(v: number, n: number): number {
  if (!Number.isInteger(n) || n < 0 || n > MAX_PROVEN_POWER) return NaN;
  let acc = 1;
  for (let i = 0; i < n; i++) {
    const p = acc * v;
    if (acc !== 0 && v !== 0 && !prodExact(acc, v, p)) return NaN;
    acc = p;
  }
  return acc;
}

/**
 * The exactness of an interval power's two endpoints.
 *
 * The same "every reaching candidate must be exact" rule as
 * `productExactness`, over the two endpoint powers `intPow`
 * (`elementary.ts`) takes the extremum of, and in one walk of them for the
 * same reason.
 *
 * An even power of an interval that straddles zero has the exact lower bound 0
 * (no such power is below it); the exemption is restricted to a NON-NEGATIVE
 * exponent, because a zero lower bound of a negative power comes from an
 * infinite intermediate, where zero does not bound the values below the axis.
 */
function powExactness(x: Interval, n: number, value: Interval): Exactness {
  // `exactIntegerPower` decides nothing outside a non-negative integer
  // exponent within its walk bound, so an exponent outside it makes the walk
  // below pure cost — every candidate would answer `NaN`. Only the zero lower
  // bound survives, and it needs no candidate.
  if (!Number.isInteger(n) || n < 0 || n > MAX_PROVEN_POWER)
    return n >= 0 && value.lo === 0 ? LO_EXACT : INEXACT;
  let loSeen = false;
  let loBad = false;
  let hiSeen = false;
  let hiBad = false;
  const count = x.lo === x.hi ? 1 : 2;
  for (let i = 0; i < count; i++) {
    const v = i === 0 ? x.lo : x.hi;
    const p = Math.pow(v, n);
    const isLo = p === value.lo;
    const isHi = p === value.hi;
    if (!isLo && !isHi) continue;
    const exact = exactIntegerPower(v, n) === p;
    if (isLo) {
      loSeen = true;
      if (!exact) loBad = true;
    }
    if (isHi) {
      hiSeen = true;
      if (!exact) hiBad = true;
    }
  }
  return exactness(value.lo === 0 || (loSeen && !loBad), hiSeen && !hiBad);
}

/**
 * A NON-NEGATIVE INTEGER exponent only: the endpoint is then a product chain
 * that either reproduces exactly or does not. A negative exponent goes through
 * a reciprocal and a fractional one through `Math.pow`, and neither is decided
 * here.
 */
export function exactPow(args: readonly unknown[], value: Interval): Exactness {
  const x = operandInterval(args[0]);
  const n = args[1];
  if (x === undefined || typeof n !== 'number') return INEXACT;
  return powExactness(x, n, value);
}

/**
 * The same proof through the interval-exponent entry point, which hands a
 * point integer exponent straight to the scalar-exponent power
 * (`elementary.ts`). This is the spelling an unrolled `Σ (−1)^k` uses, where
 * the exponent is the loop index rather than a literal.
 */
export function exactPowInterval(
  args: readonly unknown[],
  value: Interval
): Exactness {
  const x = operandInterval(args[0]);
  const e = operandInterval(args[1]);
  if (x === undefined || e === undefined) return INEXACT;
  if (e.lo !== e.hi || !Number.isInteger(e.lo)) {
    // The base −1 with an exponent that spans consecutive integers alternates
    // between −1 and 1, and the routine answers that literal hull. Both
    // endpoints bound every value the power takes, so neither is a rounded
    // number.
    if (x.lo === -1 && x.hi === -1)
      return exactness(value.lo === -1, value.hi === 1);
    // A non-integer exponent has a real value only over the non-negative part
    // of the base, so every value of the power is non-negative and the lower
    // bound of 0 the routine writes down for a base that reaches 0 is a true
    // bound, not a rounded one. Widening it below zero would report the smooth
    // field of a fractional power as domain-clipped on every box that touches
    // the axis.
    return value.lo === 0 ? LO_EXACT : INEXACT;
  }
  return powExactness(x, e.lo, value);
}

/**
 * The prover shared by the routines that answer an INTEGER over an integer
 * grid (`gcd`, `lcm`, `factorial`, `factorial2`, `binomial`, `mod`,
 * `remainder`, `exp2`). Their answer is the true value — not a neighbour of it
 * — when it is a degenerate point at a SAFE integer and every operand is a
 * degenerate point at an integer: every integer below 2^53 is a double, so a
 * result in that range was reached with no rounding, and a result that WAS
 * rounded (a factorial past 18, say) lands outside the safe range and stays
 * conservative.
 *
 * The operand condition is not decoration. `exp2` is `Math.pow(2, x)`, which
 * answers exactly 3 for the double nearest `log2(3)` even though the true
 * value there is not 3; calling that endpoint exact would answer a point the
 * value is outside of. With an integer exponent the power is exact.
 */
export function exactIntegerGridPoint(
  args: readonly unknown[],
  value: Interval
): Exactness {
  if (value.lo !== value.hi || !Number.isSafeInteger(value.lo)) return INEXACT;
  for (const arg of args) {
    const a = operandInterval(arg);
    if (a === undefined || a.lo !== a.hi || !Number.isInteger(a.lo))
      return INEXACT;
  }
  return EXACT;
}

/**
 * The prover for a routine whose values lie in `[min, max]` for EVERY operand
 * — `sin` in [−1, 1], `exp` in [0, ∞), `hypot` in [0, ∞), `cosh` in [1, ∞).
 * A computed endpoint that equals one of those bounds needs no outward step:
 * the bound holds for the whole function, so it holds for the true range too,
 * whatever the routine rounded on the way there.
 *
 * Keeping such an endpoint exact preserves the contracts the rest of the
 * library reads. A widened `cos` would leave the domain of `acos` and answer a
 * domain-clipped `partial` for `acos(cos(x))`; a widened `hypot` or `exp`
 * would acquire a lower bound of −5·10⁻³²⁴, which turns a later `sqrt` into a
 * `partial` and a later division into a spurious pole report.
 *
 * The bound given here must be a double that lies OUTSIDE the true range or
 * exactly on its edge. `acos` has the range [0, π], but the double `Math.PI`
 * is BELOW the real π, so it is not a valid upper bound to certify: that
 * routine passes `Infinity` for the upper side. An infinite bound turns its
 * side off, since an infinite endpoint is never stepped anyway.
 */
export function exactInRange(min: number, max: number): ExactnessProver {
  return (_args, value) => exactness(value.lo === min, value.hi === max);
}

/**
 * The prover for `mod`, whose whole value set lies inside a range fixed by the
 * divisor: the floored modulo is in `[0, b)` for a positive divisor and in
 * `(b, 0]` for a negative one. Both ends of that range are true bounds of the
 * operation, whatever it rounded on the way to an endpoint that reads one of
 * them, and stepping either outward would answer a modulo outside the range
 * the operation promises.
 *
 * Which end is which depends on the SIGN of the divisor, which is why the
 * divisor — the second operand — is read here. Certifying an endpoint of 0 on
 * both sides regardless would call the far end of the range exact as well: for
 * a positive divisor an upper bound of 0 is not a range bound at all, it is a
 * computed endpoint like any other.
 *
 * `period` repeats the divisor magnitude `mod` itself uses for the far end
 * (`elementary.ts`), so a change to that rule has to be mirrored here.
 */
export const exactAtZeroBound: ExactnessProver = (args, value) => {
  const b = operandInterval(args[1]);
  if (b === undefined) return INEXACT;
  const period = Math.max(Math.abs(b.lo), Math.abs(b.hi));
  if (b.lo > 0) return exactness(value.lo === 0, value.hi === period);
  if (b.hi < 0) return exactness(value.lo === -period, value.hi === 0);
  return INEXACT;
};

/**
 * The prover for a routine that answers exactly 0 at exactly 0 — an odd
 * function through the origin. When the operand endpoint is 0 and the routine
 * reports 0 as the corresponding bound, that bound is the value of the
 * function at 0, which is 0 with no rounding at all.
 *
 * PRECONDITION: attach this only to a routine whose enclosure endpoint at an
 * operand endpoint of 0 IS the function's value there. Monotone through the
 * origin is the usual reason (the lower bound of the enclosure comes from the
 * lower operand endpoint and the upper bound from the upper one), and a true
 * one-sided range bound at 0 is the other. A routine whose extremum sits away
 * from the operand endpoints — `cos`, `cosh`, `sinc` — does not qualify: its
 * enclosure endpoint at 0 can come from an interior point instead.
 *
 * Attached to `sin`, `tan`, `asin`, `atan`, `atanh`, `sinh`, `tanh`, `asinh`,
 * `erf`, `fresnelS` and `fresnelC`.
 *
 * Keeping it exact matters at the origin, where a sign test on a cell that
 * touches 0 would otherwise read an enclosure straddling zero — the outward
 * step of a zero endpoint is a subnormal of the opposite sign, so `sin([0, 0])`
 * would no longer be the point 0.
 */
export function exactAtOrigin(
  args: readonly unknown[],
  value: Interval
): Exactness {
  const x = operandInterval(args[0]);
  if (x === undefined) return INEXACT;
  return exactness(x.lo === 0 && value.lo === 0, x.hi === 0 && value.hi === 0);
}

/**
 * The prover for a routine with a known EXACT value at a single point of its
 * domain — `sech(0) = 1`. When the operand is that degenerate point the
 * routine's answer is the exact value on both sides, whatever it rounded on
 * the way there. A non-degenerate operand decides nothing here: the endpoints
 * of the enclosure are then values at other points of the domain.
 */
export function exactAtPoint(x0: number, v0: number): ExactnessProver {
  return (args, value) => {
    const x = operandInterval(args[0]);
    if (x === undefined || x.lo !== x0 || x.hi !== x0) return INEXACT;
    return exactness(value.lo === v0, value.hi === v0);
  };
}

/**
 * The prover for the logarithms.
 *
 * A logarithm is monotone increasing, so each endpoint of the enclosure is the
 * logarithm of the corresponding operand endpoint. Two endpoints are the true
 * real value: `log(1)` is 0 for every base, and — with an integer `base` given
 * — a value `k` whose exact product chain `base^k` reproduces the operand
 * endpoint, which is what keeps `log2([8, 8])` the point 3 and
 * `log10([100, 100])` the point 2.
 *
 * Keeping those exact matters for the same reason as everywhere else here: a
 * widened `ln([1, 1])` is `[−5·10⁻³²⁴, 5·10⁻³²⁴]`, and a `sqrt` of it reports
 * a domain-clipped `partial` where the true value is the point 0.
 */
export function exactLog(base?: number): ExactnessProver {
  return (args, value) => {
    const x = operandInterval(args[0]);
    if (x === undefined) return INEXACT;
    const isLog = (v: number, e: number): boolean =>
      (e === 1 && v === 0) ||
      (base !== undefined && exactIntegerPower(base, v) === e);
    return exactness(isLog(value.lo, x.lo), isLog(value.hi, x.hi));
  };
}
