/**
 * Continued-fraction kernels on bigints: the expansion of a quadratic
 * irrational, which is eventually periodic (Lagrange's theorem), the terms of
 * a real number known only to an interval, and the value of a periodic
 * expansion read back as a quadratic irrational.
 *
 * Every function takes and returns `bigint`s and rationals as `[n, d]` pairs
 * with `d > 0`, no `Expression`: it imports only other `numerics/` files.
 *
 * @module
 */

import { isqrt } from './diophantine.js';

/** The most terms an expansion computed here may have: the period of
 * `√D` is of order `√D · ln D`, so a period beyond this is declined, not
 * computed to the end. */
export const MAX_CONTINUED_FRACTION_TERMS = 100_000;

/** A rational `[n, d]` with `d > 0`, in lowest terms. */
export type Q = [bigint, bigint];

/** The quadratic irrational `a + b·√d`; `b = 0` is the rational `a`. */
export type Surd = { a: Q; b: Q; d: bigint };

function gcd(a: bigint, b: bigint): bigint {
  if (a < 0n) a = -a;
  if (b < 0n) b = -b;
  while (b !== 0n) [a, b] = [b, a % b];
  return a;
}

/** Floor division `⌊a/b⌋` for `b ≠ 0` (bigint `/` truncates toward zero). */
function floorDiv(a: bigint, b: bigint): bigint {
  const q = a / b;
  return a % b !== 0n && a < 0n !== b < 0n ? q - 1n : q;
}

export function rational(n: bigint, d: bigint = 1n): Q {
  if (d < 0n) [n, d] = [-n, -d];
  const g = gcd(n, d);
  return g > 1n ? [n / g, d / g] : [n, d];
}

const add = (x: Q, y: Q): Q => rational(x[0] * y[1] + y[0] * x[1], x[1] * y[1]);
const mul = (x: Q, y: Q): Q => rational(x[0] * y[0], x[1] * y[1]);
const isZero = (x: Q): boolean => x[0] === 0n;

const ZERO: Q = [0n, 1n];

/** `s` with `b = 0` collapsed to a rational, and a perfect-square `d`
 * collapsed into `a`; `undefined` for a negative `d`, which is not real. */
function normalize(s: Surd): Surd | undefined {
  if (isZero(s.b)) return { a: s.a, b: ZERO, d: 1n };
  if (s.d < 0n) return undefined;
  const r = isqrt(s.d);
  if (r * r === s.d) return { a: add(s.a, mul(s.b, [r, 1n])), b: ZERO, d: 1n };
  return s;
}

export function surdFromRational(a: Q): Surd {
  return { a, b: ZERO, d: 1n };
}

/** `b·√d` for a rational `b` and an integer `d ≥ 0`. */
export function surdFromRoot(b: Q, d: bigint): Surd | undefined {
  return normalize({ a: ZERO, b, d });
}

export function surdNegate(x: Surd): Surd {
  return { a: [-x.a[0], x.a[1]], b: [-x.b[0], x.b[1]], d: x.d };
}

/** `√d` expressed over `√e`, as the rational `r` with `√d = r·√e`, when
 * `d·e` is a perfect square (the two radicals are in one field). */
function radicalRatio(d: bigint, e: bigint): Q | undefined {
  const g = isqrt(d * e);
  return g * g === d * e ? rational(g, e) : undefined;
}

export function surdAdd(x: Surd, y: Surd): Surd | undefined {
  if (isZero(x.b)) return normalize({ a: add(x.a, y.a), b: y.b, d: y.d });
  if (isZero(y.b)) return normalize({ a: add(x.a, y.a), b: x.b, d: x.d });
  const r = radicalRatio(y.d, x.d);
  if (r === undefined) return undefined;
  return normalize({ a: add(x.a, y.a), b: add(x.b, mul(y.b, r)), d: x.d });
}

export function surdMultiply(x: Surd, y: Surd): Surd | undefined {
  if (isZero(x.b))
    return normalize({ a: mul(x.a, y.a), b: mul(x.a, y.b), d: y.d });
  if (isZero(y.b))
    return normalize({ a: mul(x.a, y.a), b: mul(y.a, x.b), d: x.d });
  // (a₁ + b₁√d₁)(a₂ + b₂√d₂) with √d₂ = r√d₁ when d₁d₂ is a square.
  const r = radicalRatio(y.d, x.d);
  if (r !== undefined) {
    const b2 = mul(y.b, r);
    return normalize({
      a: add(mul(x.a, y.a), mul(mul(x.b, b2), [x.d, 1n])),
      b: add(mul(x.a, b2), mul(y.a, x.b)),
      d: x.d,
    });
  }
  // `√d₁·√d₂` is a new radical: one field only when both parts are pure.
  if (isZero(x.a) && isZero(y.a))
    return normalize({ a: ZERO, b: mul(x.b, y.b), d: x.d * y.d });
  return undefined;
}

export function surdInverse(x: Surd): Surd | undefined {
  if (isZero(x.b)) {
    if (isZero(x.a)) return undefined;
    return surdFromRational(rational(x.a[1], x.a[0]));
  }
  // 1/(a + b√d) = (a − b√d)/(a² − b²d)
  const den = add(mul(x.a, x.a), mul(mul(x.b, x.b), [-x.d, 1n]));
  if (isZero(den)) return undefined;
  const inv = rational(den[1], den[0]);
  return normalize({
    a: mul(x.a, inv),
    b: mul([-x.b[0], x.b[1]], inv),
    d: x.d,
  });
}

/** The state `(P + √D)/Q` of a quadratic irrational `a + b√d`, scaled so
 * that `Q` divides `D − P²`, which keeps every later state integral. */
function surdState(x: Surd): { P: bigint; Q: bigint; D: bigint } {
  const C = x.a[1] * x.b[1];
  let A = x.a[0] * x.b[1];
  let B = x.b[0] * x.a[1];
  const g = gcd(gcd(A, B), C);
  if (g > 1n) {
    A /= g;
    B /= g;
  }
  let P = A;
  let Q = C / (g > 1n ? g : 1n);
  // `b < 0`: (A − √(B²d))/C = (−A + √(B²d))/(−C)
  if (B < 0n) {
    P = -P;
    Q = -Q;
    B = -B;
  }
  const D = B * B * x.d;
  const m = Q < 0n ? -Q : Q;
  return { P: P * m, Q: Q * m, D: D * Q * Q };
}

/** The next term and state of `(P + √D)/Q`, `D` not a perfect square. */
function advance(P: bigint, Q: bigint, D: bigint, s: bigint) {
  const a = Q > 0n ? floorDiv(P + s, Q) : -(floorDiv(P + s, -Q) + 1n);
  const P1 = a * Q - P;
  return { a, P: P1, Q: (D - P1 * P1) / Q };
}

/** The first `n` terms of the quadratic irrational `x` (`b ≠ 0`), or
 * `undefined` past the cap on the number of terms. */
export function surdTerms(x: Surd, n: number): bigint[] | undefined {
  if (n > MAX_CONTINUED_FRACTION_TERMS) return undefined;
  const state = surdState(x);
  const { D } = state;
  let { P, Q } = state;
  const s = isqrt(D);
  const terms: bigint[] = [];
  while (terms.length < n) {
    const t = advance(P, Q, D, s);
    terms.push(t.a);
    ({ P, Q } = t);
  }
  return terms;
}

/**
 * The expansion of the quadratic irrational `x` (`b ≠ 0`) as a leading part
 * and a period, `x = [pre…, period…, period…, …]`. The first term `a₀` is
 * always in `pre`, as `ContinuedFraction[Sqrt[2]]` is `{1, {2}}` and the
 * golden ratio `{1, {1}}`. `undefined` past the cap on the number of terms.
 *
 * The state `(P, Q)` of `(P + √D)/Q` determines every later term, so the
 * first repeated state closes the period (Lagrange's theorem: it repeats).
 */
export function surdPeriodicTerms(
  x: Surd
): { pre: bigint[]; period: bigint[] } | undefined {
  const state = surdState(x);
  const { D } = state;
  let { P, Q } = state;
  const s = isqrt(D);
  const terms: bigint[] = [];
  const seen = new Map<string, number>();
  for (;;) {
    if (terms.length > 0) {
      const key = `${P},${Q}`;
      const at = seen.get(key);
      if (at !== undefined)
        return { pre: terms.slice(0, at), period: terms.slice(at) };
      seen.set(key, terms.length);
    }
    if (terms.length >= MAX_CONTINUED_FRACTION_TERMS) return undefined;
    const t = advance(P, Q, D, s);
    terms.push(t.a);
    ({ P, Q } = t);
  }
}

/** The first `n` terms of the rational `a/b` (`b > 0`): all of them for
 * `n = Infinity`. */
export function rationalTerms(a: bigint, b: bigint, n: number): bigint[] {
  const terms: bigint[] = [];
  while (b !== 0n && terms.length < n) {
    const q = floorDiv(a, b);
    terms.push(q);
    [a, b] = [b, a - q * b];
  }
  return terms;
}

/**
 * The terms shared by every real number in the closed interval `[lo, hi]`:
 * the common prefix of the expansions of the two ends, less its last term,
 * which a terminating end writes two ways (`[…, a]` and `[…, a − 1, 1]`).
 */
export function certifiedTerms(lo: Q, hi: Q, n: number): bigint[] {
  const x = rationalTerms(lo[0], lo[1], n + 1);
  const y = rationalTerms(hi[0], hi[1], n + 1);
  let m = 0;
  while (m < x.length && m < y.length && x[m] === y[m]) m += 1;
  return x.slice(0, Math.max(0, Math.min(m - 1, n)));
}

/**
 * The quadratic irrational `[pre…, period…, period…, …]`, or `undefined`
 * for an empty period. Each period term is positive; a term of the leading
 * part is any integer, as `a₀` may be.
 */
export function surdFromPeriodicTerms(
  pre: ReadonlyArray<bigint>,
  period: ReadonlyArray<bigint>
): Surd | undefined {
  if (period.length === 0 || period.some((t) => t < 1n)) return undefined;
  if (pre.some((t, i) => i > 0 && t < 1n)) return undefined;
  // The purely periodic tail y = [p₀; p₁, …, p_{k−1}, y]: with the matrix of
  // the period `[[A, B], [C, D]]`, y = (A·y + B)/(C·y + D), so
  // C·y² + (D − A)·y − B = 0, whose positive root is
  // y = ((A − D) + √((D − A)² + 4BC)) / (2C).
  let A = 1n;
  let B = 0n;
  let C = 0n;
  let D = 1n;
  for (const t of period) [A, B, C, D] = [A * t + B, A, C * t + D, C];
  const disc = (D - A) * (D - A) + 4n * B * C;
  const tail = normalize({
    a: rational(A - D, 2n * C),
    b: rational(1n, 2n * C),
    d: disc,
  });
  if (tail === undefined) return undefined;
  // x_i = pre_i + 1/x_{i+1}, with x_m = y
  let x: Surd | undefined = tail;
  for (let i = pre.length - 1; i >= 0 && x !== undefined; i--) {
    const inv = surdInverse(x);
    x = inv && surdAdd(surdFromRational(rational(pre[i])), inv);
  }
  return x;
}
