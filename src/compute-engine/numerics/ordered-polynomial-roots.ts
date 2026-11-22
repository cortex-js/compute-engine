// The complex roots of a squarefree polynomial over ℤ in Wolfram's order (the real roots
// increasing, then the complex ones by real part and then imaginary part), each enclosed in a
// disk that provably holds that root and no other. The roots start from `aberthRoots`, are
// refined by Newton's method in exact Gaussian-integer fixed point, and are numbered only when
// the disks prove the order; otherwise the roots are declined (`undefined`).
//
// A disk about z of radius n·|f(z)/f′(z)| holds a root of f (the roots wⱼ satisfy
// f′/f = Σ 1/(z − wⱼ)). n pairwise disjoint such disks hold n roots, so each holds exactly one.

import {
  checkDeadline,
  type DeadlineFrame,
} from '../../common/interruptible.js';
import {
  FieldPolynomials,
  integerGcd,
  rationalCoefficient as q,
  rationalField as Q,
  type RationalCoefficient,
} from '../polynomial/exact-field.js';
import { isqrt } from './diophantine.js';
import {
  degree,
  isSquarefree,
  realRootCount,
  type Poly,
} from './number-field.js';
import { aberthRoots } from './polynomial-roots.js';

export interface Complex {
  readonly re: number;
  readonly im: number;
}

/** Past this degree the roots aren't attempted. */
export const MAX_ROOT_DEGREE = 32;

/** Guard digits carried past the digits asked for. */
const GUARD = 12;

/** Newton steps tried for one root before the attempt gives up. */
const NEWTON_STEPS = 64;

/** The fixed point is widened until the disks separate, up to this many decimal places. */
const MAX_PLACES = 1500;

/** A disk past this radius, in units of the last place, isn't a refinement of a root. */
const MAX_RADIUS = 1_000_000n;

/** Two roots are one real part only when it is a rational with a denominator up to this. */
const MAX_TIE_DENOMINATOR = 1_000_000n;

/** The disks kept, to answer `N()` and the numbering of one polynomial again at once. */
const CACHE_SIZE = 32;

/** A Gaussian integer: the point `(re + i·im) / 10^places`. */
interface Fixed {
  readonly re: bigint;
  readonly im: bigint;
}

/** A root's disk: centre and radius, all in units of 10^-places. */
interface Disk extends Fixed {
  readonly radius: bigint;
}

interface Isolation {
  readonly places: number;
  /** In Wolfram's order. */
  readonly roots: readonly Disk[];
}

interface Fraction {
  readonly num: bigint;
  readonly den: bigint;
}

const abs = (a: bigint): bigint => (a < 0n ? -a : a);

/** ⌊a / b⌋ for b > 0. */
const floorDiv = (a: bigint, b: bigint): bigint => {
  const quotient = a / b;
  return a % b !== 0n && a < 0n ? quotient - 1n : quotient;
};

/** a / b rounded to the nearest integer, b > 0. */
const roundDiv = (a: bigint, b: bigint): bigint => floorDiv(2n * a + b, 2n * b);

const mul = (a: Fixed, b: Fixed): Fixed => ({
  re: a.re * b.re - a.im * b.im,
  im: a.re * b.im + a.im * b.re,
});

/** A double as the 17 digits it prints with, scaled to `places`. */
function toFixed(x: number, places: number): bigint {
  if (x === 0) return 0n;
  const [mantissa, exponent] = x.toExponential(16).split('e');
  const m = BigInt(mantissa!.replace('.', ''));
  const shift = places + Number(exponent) - 16;
  return shift >= 0 ? m * 10n ** BigInt(shift) : m / 10n ** BigInt(-shift);
}

/** `v / 10^places` rounded to `digits` significant digits, as a decimal string. */
function decimal(v: bigint, places: number, digits: number): string {
  if (v === 0n) return '0';
  const negative = v < 0n;
  let mag = abs(v);
  let exponent = -places;
  const length = mag.toString().length;
  if (length > digits) {
    const drop = length - digits;
    mag = (mag + 10n ** BigInt(drop) / 2n) / 10n ** BigInt(drop);
    exponent += drop;
  }
  return `${negative ? '-' : ''}${mag}e${exponent}`;
}

const toDouble = (v: bigint, places: number): number =>
  Number(decimal(v, places, 17));

// --- one attempt at one precision -------------------------------------------------------------

/** What an attempt at one precision holds: `f`, its derivative and the powers of 10^places. */
interface Context {
  readonly f: Poly;
  readonly df: Poly;
  readonly places: number;
  readonly pow: readonly bigint[];
  readonly frame: DeadlineFrame | undefined;
}

/**
 * F = f(z)·10^(places·n) and F′ = f′(z)·10^(places·(n−1)) at z = w / 10^places, exactly (Horner on
 * Gaussian integers): f/f′ at z is F / (F′·10^places).
 */
function evaluate(c: Context, w: Fixed): [Fixed, Fixed] {
  const n = c.f.length - 1;
  let p: Fixed = { re: c.f[n]!, im: 0n };
  for (let k = n - 1; k >= 0; k--) {
    const t = mul(p, w);
    p = { re: t.re + c.f[k]! * c.pow[n - k]!, im: t.im };
  }
  let d: Fixed = { re: c.df[n - 1]!, im: 0n };
  for (let k = n - 2; k >= 0; k--) {
    const t = mul(d, w);
    d = { re: t.re + c.df[k]! * c.pow[n - 1 - k]!, im: t.im };
  }
  return [p, d];
}

/**
 * The root of `f` near `start`, as a disk: Newton's steps w − F/F′ rounded to the grid, until
 * n·|F/F′| is a few units of the last place. A real `start` (`im` 0) stays on the real line.
 */
function newton(c: Context, start: Fixed): Disk | undefined {
  const n = BigInt(c.f.length - 1);
  const real = start.im === 0n;
  let w = start;
  for (let step = 0; step < NEWTON_STEPS; step++) {
    checkDeadline(c.frame);
    const [F, D] = evaluate(c, w);
    const norm = D.re * D.re + D.im * D.im;
    if (norm === 0n) return undefined;
    // The radius n·|F|/|F′|, rounded up: its square is at least n²|F|² / |F′|².
    const size = F.re * F.re + F.im * F.im;
    const radius = isqrt((n * n * size + norm - 1n) / norm) + 1n;
    if (radius <= 8n * n) return { ...w, radius };
    const stepRe = roundDiv(F.re * D.re + F.im * D.im, norm);
    const stepIm = real ? 0n : roundDiv(F.im * D.re - F.re * D.im, norm);
    w = { re: w.re - stepRe, im: w.im - stepIm };
  }
  return undefined;
}

// --- ties among real parts --------------------------------------------------------------------

/** The simplest (least denominator) rational in `[lo, hi]`, 0 < lo ≤ hi. */
function simplestPositive(lo: Fraction, hi: Fraction, depth = 0): Fraction {
  const whole = lo.num / lo.den;
  if (whole * lo.den === lo.num) return { num: whole, den: 1n };
  if ((whole + 1n) * hi.den <= hi.num) return { num: whole + 1n, den: 1n };
  if (depth > 4000) return { num: lo.num, den: lo.den };
  // whole < lo ≤ hi < whole + 1: the fractional parts' reciprocals, swapped.
  const inner = simplestPositive(
    { num: hi.den, den: hi.num - whole * hi.den },
    { num: lo.den, den: lo.num - whole * lo.den },
    depth + 1
  );
  return { num: whole * inner.num + inner.den, den: inner.num };
}

/** The simplest rational in `[lo, hi]`, lo ≤ hi, of any sign. */
function simplest(lo: Fraction, hi: Fraction): Fraction {
  if (lo.num <= 0n && hi.num >= 0n) return { num: 0n, den: 1n };
  if (hi.num < 0n) {
    const r = simplestPositive(
      { num: -hi.num, den: hi.den },
      { num: -lo.num, den: lo.den }
    );
    return { num: -r.num, den: r.den };
  }
  return simplestPositive(lo, hi);
}

/**
 * How many roots of `f` have the real part `c` exactly: with f(c + it) = A(t) + i·B(t), they are
 * the real roots of gcd(A, B). `undefined` when that gcd isn't squarefree.
 */
function rootsWithRealPart(f: Poly, c: Fraction): number | undefined {
  const P = new FieldPolynomials(Q);
  const n = f.length - 1;
  const re = q(c.num, c.den);
  // Horner on (A, B): (A + iB)·(c + it) + fₖ.
  let a: RationalCoefficient[] = [q(f[n]!)];
  let b: RationalCoefficient[] = [];
  for (let k = n - 1; k >= 0; k--) {
    const next = P.add(P.scale(a, re), P.scale([Q.zero, ...b], q(-1n)));
    b = P.add(P.scale(b, re), [Q.zero, ...a]);
    a = P.add(next, [q(f[k]!)]);
  }
  const g = P.gcd(a, b);
  if (g.length <= 1) return 0;
  const den = g.reduce(
    (l, x) => (l * x.denominator) / integerGcd(l, x.denominator),
    1n
  );
  const ints = g.map((x) => (x.numerator * den) / x.denominator);
  return isSquarefree(ints) ? realRootCount(ints) : undefined;
}

/** Whether `c` is a root of `f`. */
const isRoot = (f: Poly, c: Fraction): boolean => {
  const n = f.length - 1;
  let sum = 0n;
  for (let k = 0; k <= n; k++)
    sum += f[k]! * c.num ** BigInt(k) * c.den ** BigInt(n - k);
  return sum === 0n;
};

// --- the isolation ------------------------------------------------------------------------------

/**
 * The roots of `f` at `places` decimal places, ordered and enclosed, or `undefined` when a
 * refinement doesn't converge, two disks meet, or an order of real parts can't be proved.
 */
function attempt(
  f: Poly,
  real: readonly Complex[],
  upper: readonly Complex[],
  places: number,
  frame: DeadlineFrame | undefined
): Disk[] | undefined {
  const n = f.length - 1;
  const pow: bigint[] = [1n];
  for (let j = 1; j <= n; j++) pow.push(pow[j - 1]! * 10n ** BigInt(places));
  const c: Context = {
    f,
    df: f.slice(1).map((x, i) => x * BigInt(i + 1)),
    places,
    pow,
    frame,
  };
  const reals: Disk[] = [];
  for (const z of real) {
    const d = newton(c, { re: toFixed(z.re, places), im: 0n });
    if (d === undefined || d.radius > MAX_RADIUS) return undefined;
    reals.push(d);
  }
  // The upper half-plane roots, each with its conjugate: the same real part exactly.
  const uppers: Disk[] = [];
  for (const z of upper) {
    const d = newton(c, {
      re: toFixed(z.re, places),
      im: toFixed(z.im, places),
    });
    // The disk must miss the real axis, or its root might be real.
    if (d === undefined || d.radius > MAX_RADIUS || d.im <= d.radius)
      return undefined;
    uppers.push(d);
  }
  const lowers = uppers.map((d) => ({ ...d, im: -d.im }));
  const all = [...reals, ...uppers, ...lowers];
  // Disjoint disks: n of them hold n roots, one each.
  for (let i = 0; i < all.length; i++)
    for (let j = i + 1; j < all.length; j++) {
      const dx = all[i]!.re - all[j]!.re;
      const dy = all[i]!.im - all[j]!.im;
      const reach = all[i]!.radius + all[j]!.radius;
      if (dx * dx + dy * dy <= reach * reach) return undefined;
    }
  reals.sort((a, b) => (a.re < b.re ? -1 : 1));
  // Complex roots by real part. The real parts of two disks are told apart when their
  // intervals miss; a conjugate pair shares one; any other overlap must be a proved tie.
  uppers.sort((a, b) => (a.re < b.re ? -1 : 1));
  const ordered: Disk[] = [...reals];
  let start = 0;
  while (start < uppers.length) {
    let end = start + 1;
    let reach = uppers[start]!.re + uppers[start]!.radius;
    while (
      end < uppers.length &&
      uppers[end]!.re - uppers[end]!.radius <= reach
    ) {
      const top = uppers[end]!.re + uppers[end]!.radius;
      if (top > reach) reach = top;
      end++;
    }
    const cluster = uppers.slice(start, end);
    if (cluster.length > 1 && !isTie(f, cluster, places)) return undefined;
    // In a tie the order is by imaginary part: the disks are disjoint, so their centres' order is the roots'.
    const both = cluster.flatMap((d) => [d, { ...d, im: -d.im }]);
    ordered.push(...both.sort((a, b) => (a.im < b.im ? -1 : 1)));
    start = end;
  }
  return ordered;
}

/** Whether the roots in `cluster` and their conjugates all have one rational real part, and no others do. */
function isTie(f: Poly, cluster: readonly Disk[], places: number): boolean {
  const scale = 10n ** BigInt(places);
  const lo = cluster.reduce(
    (m, d) => (d.re - d.radius > m ? d.re - d.radius : m),
    cluster[0]!.re - cluster[0]!.radius
  );
  const hi = cluster.reduce(
    (m, d) => (d.re + d.radius < m ? d.re + d.radius : m),
    cluster[0]!.re + cluster[0]!.radius
  );
  if (lo > hi) return false;
  const c = simplest({ num: lo, den: scale }, { num: hi, den: scale });
  if (c.den > MAX_TIE_DENOMINATOR) return false;
  const count = rootsWithRealPart(f, c);
  return count === 2 * cluster.length + (isRoot(f, c) ? 1 : 0);
}

const cache = new Map<string, Isolation>();

/**
 * The roots of `f` (squarefree, degree 1 to `MAX_ROOT_DEGREE`) in Wolfram's order, each with a
 * disk about it, accurate to about `digits` significant digits, or `undefined` when `f` isn't
 * squarefree or the roots can't be told apart or ordered with certainty.
 */
function isolate(
  f: Poly,
  digits: number,
  frame: DeadlineFrame | undefined
): Isolation | undefined {
  const n = degree(f);
  if (n < 1 || n > MAX_ROOT_DEGREE || n !== f.length - 1) return undefined;
  const key = `${f.join(',')}/${digits}`;
  const cached = cache.get(key);
  if (cached !== undefined) return cached;
  const coefficients = f.map(Number);
  if (coefficients.some((x) => !Number.isFinite(x)) || !isSquarefree(f))
    return undefined;
  const found = aberthRoots(coefficients, frame?.at);
  if (found === null) return undefined;
  // The real roots are the r₁ of least |im|; the others pair off about the real axis.
  const r1 = realRootCount(f);
  const byImag = [...found].sort((a, b) => Math.abs(a.im) - Math.abs(b.im));
  const complex = byImag.slice(r1);
  const upper = complex.filter((z) => z.im > 0);
  if (2 * upper.length !== complex.length) return undefined;
  // Every root has |z| ≥ 1/(1 + H), H the largest coefficient: the places that give the digits asked.
  const height = f.reduce((m, c) => (abs(c) > m ? abs(c) : m), 0n);
  let places = digits + GUARD + height.toString().length;
  for (; places <= MAX_PLACES; places *= 2) {
    const roots = attempt(f, byImag.slice(0, r1), upper, places, frame);
    if (roots === undefined) continue;
    const result = { places, roots };
    if (cache.size >= CACHE_SIZE) cache.delete(cache.keys().next().value!);
    cache.set(key, result);
    return result;
  }
  return undefined;
}

// --- what the callers read ----------------------------------------------------------------------

/** The roots of `f` in Wolfram's order, as doubles, or `undefined` (see `isolate`). */
export function orderedRoots(
  f: Poly,
  frame?: DeadlineFrame
): Complex[] | undefined {
  const iso = isolate(f, 15, frame);
  return iso?.roots.map((d) => ({
    re: toDouble(d.re, iso.places),
    im: toDouble(d.im, iso.places),
  }));
}

/**
 * The `k`-th root of `f` (1-based, in Wolfram's order) to `digits` significant digits, as
 * `{ re, im }` decimal strings, or `undefined` when the roots can't be numbered with certainty.
 */
export function refineRoot(
  f: Poly,
  k: number,
  digits: number,
  frame?: DeadlineFrame
): { re: string; im: string } | undefined {
  const iso = isolate(f, digits, frame);
  const d = iso?.roots[k - 1];
  return iso === undefined || d === undefined
    ? undefined
    : {
        re: decimal(d.re, iso.places, digits),
        im: decimal(d.im, iso.places, digits),
      };
}

// --- elements of a field at an embedding ---------------------------------------------------------

/** A complex ball: centre and radius in units of 10^-places (an enclosure of one number). */
type Ball = Disk;

/** ⌈a / b⌉ for b > 0. */
const ceilDiv = (a: bigint, b: bigint): bigint => -floorDiv(-a, b);

/**
 * The product of two balls, enclosing every product of their points: the centre is rounded
 * down (an error under 2 units), and the radius covers |a|·r_b + |b|·r_a + r_a·r_b.
 */
function ballMul(a: Ball, b: Ball, one: bigint): Ball {
  const size = (x: Ball) => abs(x.re) + abs(x.im);
  return {
    re: floorDiv(a.re * b.re - a.im * b.im, one),
    im: floorDiv(a.re * b.im + a.im * b.re, one),
    radius:
      ceilDiv(
        size(a) * b.radius + size(b) * a.radius + a.radius * b.radius,
        one
      ) + 2n,
  };
}

/** The rational `num / den` as a ball, scaled by `one`. */
const ballConstant = (num: bigint, den: bigint, one: bigint): Ball => ({
  re: floorDiv(num * one, den),
  im: 0n,
  radius: 1n,
});

const meets = (a: Ball, b: Ball): boolean => {
  const dx = a.re - b.re;
  const dy = a.im - b.im;
  const reach = a.radius + b.radius;
  return dx * dx + dy * dy <= reach * reach;
};

/**
 * For each element `Σ cᵢθⁱ` of ℚ(θ) (θ a root of `field`, `elements[j]` its rational
 * coefficients) that is a root of `target` at the embedding θ ↦ the first root of `field`: the
 * number (1-based, in Wolfram's order) of the root of `target` it is. An element is evaluated
 * in ball arithmetic from the proved disk of θ, and is numbered only when that enclosure meets
 * exactly one of the proved, pairwise disjoint disks of the roots of `target`, which then holds
 * it; the precision doubles until it does. `undefined` when the matching can't be proved.
 */
export function matchRoots(
  target: Poly,
  field: Poly,
  elements: readonly (readonly { numerator: bigint; denominator: bigint }[])[],
  frame?: DeadlineFrame
): number[] | undefined {
  for (let digits = 15; ; digits *= 2) {
    const t = isolate(target, digits, frame);
    const g = isolate(field, digits, frame);
    if (t === undefined || g === undefined) return undefined;
    // Both at the finer grid.
    const places = Math.max(t.places, g.places);
    const widen = (d: Disk, from: number): Ball => {
      const f = 10n ** BigInt(places - from);
      return { re: d.re * f, im: d.im * f, radius: d.radius * f };
    };
    const disks = t.roots.map((d) => widen(d, t.places));
    const theta = widen(g.roots[0]!, g.places);
    const one = 10n ** BigInt(places);
    const found: number[] = [];
    for (const cs of elements) {
      checkDeadline(frame);
      let value = ballConstant(
        cs[cs.length - 1]?.numerator ?? 0n,
        cs[cs.length - 1]?.denominator ?? 1n,
        one
      );
      for (let i = cs.length - 2; i >= 0; i--) {
        const product = ballMul(value, theta, one);
        const c = ballConstant(cs[i]!.numerator, cs[i]!.denominator, one);
        value = {
          re: product.re + c.re,
          im: product.im,
          radius: product.radius + c.radius,
        };
      }
      const hit = disks.flatMap((d, k) => (meets(value, d) ? [k + 1] : []));
      if (hit.length !== 1) break;
      found.push(hit[0]!);
    }
    if (found.length === elements.length)
      return new Set(found).size === found.length ? found : undefined;
  }
}
