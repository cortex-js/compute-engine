import { Complex } from 'complex.js';

//
// Scaled replacements for the `complex.js` methods that square the parts of
// a complex number.
//
// `complex.js` (version 2.4) computes `|z|`, `ln|z|` and `1/z` from
// `a² + b²` without scaling: `hypot()` scales only a part of `10⁸` or more,
// and `logHypot()` only halves the parts of `3000` or more. For a value with
// a very small part, the square underflows: the result loses digits (a
// subnormal square) or becomes 0, and `|3e-200 + 4e-200i|` is 0 and
// `ln(1e-200 + 1e-200i)` is `-∞`. For a value with a very large part, the
// square overflows: `ln(3e154 + 4e154i)` has an infinite real part and
// `1/(1e200 + 1e200i)` is 0.
//
// `installComplexScaling()` replaces the affected methods of
// `Complex.prototype` once. Each replacement calls the original method,
// unless the largest part `m = max(|re|, |im|)` of the value is finite and
// outside the range where the squares that the original method forms are
// normal doubles. Outside its range, a replacement scales the parts by a
// power of 2 (an exact multiplication) or uses a formula that does not form
// `a² + b²`. The range of each method:
//
// | Method                                   | Range of `m`        |
// | ---------------------------------------- | ------------------- |
// | `abs`, `sign`                            | `[2⁻⁵⁰⁰, ∞)`        |
// | `sqrt`                                   | `[2⁻⁵⁰⁰, 2¹⁰²¹]`    |
// | `log`, `pow`, `inverse`, `acot`, `asec`, | `[2⁻⁵⁰⁰, 2⁵¹⁰]`     |
// | `acsc`, `acoth`, `acsch`, `asech`        |                     |
// | `asin`, `acos`, `atan`, `atanh`,         | `[2⁻⁵¹⁰, 2⁵¹⁰]`     |
// | `asinh`, `acosh`                         |                     |
//
// The original methods fail at about `2⁻⁵¹¹` (a square is subnormal) and
// `2⁵¹¹` (a square overflows); `sqrt` overflows only when `|z| + |a|`
// does, above about `2¹⁰²²·⁷`. The ranges are set so that for any `m` in
// `[2⁻⁵⁰⁰, 2⁵⁰⁰]`, every replaced method returns the result of the original
// method, bit for bit, including the methods that call other replaced
// methods: `asin()` and `acos()` call `sqrt()` with about `|z|²` and `log()`
// with about `2|z|`, `asinh()` and `acosh()` call `sqrt()` with about `|z|²`
// or `|z|` and `log()` with about `2|z|`, and the reciprocal functions call
// `atan()`, `acos()`, `asin()`, `atanh()`, `asinh()` or `acosh()` with
// `1/z`. With these ranges, those inner calls stay in the range of the
// inner method. One exception: `atanh()` of a value that is not real and is
// very near 1 or −1. There, the original method forms
// `x = (1 + z)/(1 − z)`, and a part of `x` or the square of its denominator
// can overflow or underflow even when `m` is in the range. For such a
// value, the replacement does not form `x` (see `atanh` below), and its
// result can differ from the result of the original method, which is not
// correct there.
//
// Outside their range, the inverse circular and hyperbolic functions use
// closed forms, because the reciprocal functions call them with `1/z`, and
// `1/z` is outside their range when `z` is outside the range of the
// reciprocal function:
// - below `2⁻⁵¹⁰`, `arcsin z = arctan z = artanh z = arsinh z = z`,
//   `arccos z = π/2 − z` and `arcosh z = ±i·(π/2 − z)` (the next term of
//   each series is smaller than `z` by a factor of `|z|² < 2⁻¹⁰¹⁹`, which is
//   less than half a unit in the last place);
// - above `2⁵¹⁰`, the leading terms of the expansions at infinity, on the
//   side of each branch cut that the original method uses.
//
// Below `2⁻¹⁰⁰⁰`, the reciprocal functions do not form `1/z`, because a part
// of `1/z` can overflow when `m` is less than about `2⁻¹⁰²⁴` (a subnormal
// `z`). They use the leading terms of their expansions at 0, which are the
// results that the inner method gives for `1/z` above `2⁵¹⁰`, written with
// `ln|1/z| = −ln|z|` and `arg(1/z) = −arg z`.
//
// With these replacements, the magnitude of a finite value does not make a
// method overflow or underflow. When a part of the result (or of `1/z` for
// a large `z`) is subnormal, that part has only the digits that a
// subnormal can hold.
//
// The replacements only correct the magnitude problems above. In the range,
// some original methods also lose digits for other reasons (for example
// `asinh(1e-20)` is 0, and `asin(2.3e9 + 0.0004i)` has an infinite part).
// For a finite value, the engine computes the inverse functions with its
// own functions in `numerics/numeric-complex.ts` (`complexAsin()`, ...),
// not with these methods. One exception: the integrand of Hermite's
// integral in `numerics/lerch-phi.ts` calls `atan()`, whose absolute error
// there stays near 10⁻¹⁶.
//

/** The low end of the range of most methods. */
const SMALL = 2 ** -500;

/** The high end of the range of most methods. */
const LARGE = 2 ** 510;

/** The low end of the range of the inverse circular and hyperbolic
 * functions. */
const TINY = 2 ** -510;

/** The high end of the range of `sqrt`. For `m ≤ 2¹⁰²¹`,
 * `|z| + |a| ≤ (√2 + 1)·m < 2¹⁰²⁴`. */
const SQRT_LARGE = 2 ** 1021;

/** Scale factor for a value below `SMALL`: the scaled parts are in
 * `[2⁻⁴⁷⁴, 2¹⁰⁰)`, so their squares are normal doubles. */
const UP = 2 ** 600;

/** Scale factor for a value above `LARGE`: the scaled parts are in
 * `(2⁻⁹⁰, 2⁴²⁴)`, so their squares are normal doubles. */
const DOWN = 2 ** -600;

/** Below this largest part, the reciprocal functions (`acot`, ...) do not
 * form `1/z`: a part of `1/z` can be as large as `1/m`, which overflows
 * when `m` is less than about `2⁻¹⁰²⁴`. */
const NEAR_ZERO = 2 ** -1000;

/** The smallest positive normal double. */
const MIN_NORMAL = 2 ** -1022;

const HALF_PI = Math.PI / 2;

/** The names of the replaced methods. */
const METHODS = [
  'abs',
  'sign',
  'sqrt',
  'log',
  'pow',
  'inverse',
  'asin',
  'acos',
  'atan',
  'atanh',
  'asinh',
  'acosh',
  'acot',
  'asec',
  'acsc',
  'acoth',
  'acsch',
  'asech',
] as const;

type MethodName = (typeof METHODS)[number];

/** The original methods, as `complex.js` defines them. */
export type ComplexMethods = { [K in MethodName]: Complex[K] };

/**
 * The key of the property of `Complex.prototype` that records the
 * installation. Its value is the record of the original methods. A global
 * symbol, so that two copies of this module that share one `complex.js`
 * class install the replacements only once.
 */
const INSTALLED = Symbol.for('cortex-js.complex-scaling');

/** `max(|a|, |b|)`. It is NaN when a part is NaN. */
function largestPart(a: number, b: number): number {
  return Math.max(Math.abs(a), Math.abs(b));
}

/** True when `m` is finite, not 0, and outside `[low, high]`. A NaN `m`
 * gives false. */
function isOutside(m: number, low: number, high: number): boolean {
  return (m > 0 && m < low) || (m > high && m <= Number.MAX_VALUE);
}

/**
 * True when the original `ln|a + bi|` of `complex.js` is not correct. It
 * forms `a² + b²` only when both parts are not 0 (with one part 0, it is
 * `ln` of the other part).
 */
function isLogHypotOutside(a: number, b: number): boolean {
  return a !== 0 && b !== 0 && isOutside(largestPart(a, b), SMALL, LARGE);
}

/**
 * `ln|a + bi|` for a value that is not 0, as `ln m + ½·ln(1 + (n/m)²)` with
 * `m` the largest and `n` the smallest of `|a|`, `|b|`. No intermediate
 * value overflows or underflows (`n/m` can underflow to 0, and then the
 * result is `ln m`).
 */
function scaledLogHypot(a: number, b: number): number {
  const x = Math.abs(a);
  const y = Math.abs(b);
  const m = Math.max(x, y);
  const r = Math.min(x, y) / m;
  return Math.log(m) + 0.5 * Math.log1p(r * r);
}

/**
 * `1/(a + bi)` for a finite value below `SMALL` or above `LARGE`, with the
 * formula of the original `inverse()`, `(a − bi)/(a² + b²)`, applied to the
 * parts scaled by a power of 2. With `x = s·a` and `y = s·b`,
 * `1/z = s·(x − iy)/(x² + y²)`. The scaling is exact, so the result is the
 * result of the original formula for the scaled value, scaled back. (The
 * last multiplication rounds only when the result is subnormal. For a large
 * value, `s·b` can underflow; the part of the result that it gives is then
 * below the smallest subnormal, and the sign of the zero is kept.)
 */
function scaledInverse(a: number, b: number): Complex {
  const s = largestPart(a, b) < SMALL ? UP : DOWN;
  const x = a * s;
  const y = b * s;
  const d = x * x + y * y;
  return new Complex((x / d) * s, (-y / d) * s);
}

/**
 * `ln(iz + √(1 − z²))` for `|z| > 2⁵¹⁰`, as `[real part, imaginary part]`.
 * The original `asin()` and `acos()` compute this logarithm (`arcsin z` is
 * `−i` times it and `arccos z` is `π/2 + i` times it) with the principal
 * square root of `complex.js`, which has a real part `≥ 0` and the sign of
 * the imaginary part of its argument (a zero imaginary part counts as
 * positive).
 *
 * The `1` in `1 − z²` is less than `|z|²·2⁻¹⁰²⁰`, so `√(1 − z²)` is `±iz`
 * to double precision:
 * - when it is `+iz` (`Im z < 0`, or `z` real and positive), the sum is
 *   `2iz`;
 * - when it is `−iz` (`Im z > 0`, or `z` real and negative), the sum
 *   cancels. Since `(iz + √(1 − z²))·(√(1 − z²) − iz) = 1`, the sum is
 *   `1/(−2iz)` and its logarithm is `−ln(−2iz)`. `−2iz = 2b − 2ai` has a
 *   positive real part, so it is not on the cut of `ln`.
 */
function asinLogParts(a: number, b: number): [number, number] {
  const lnTwoModulus = Math.LN2 + scaledLogHypot(a, b);
  if (b > 0 || (b === 0 && a < 0)) return [-lnTwoModulus, -Math.atan2(-a, b)];
  return [lnTwoModulus, Math.atan2(a, -b)];
}

/**
 * Replace the methods of `Complex.prototype` that square the parts of a
 * value with versions that do not overflow or underflow for any finite
 * magnitude (a subnormal part of a result has only the digits that a
 * subnormal can hold). A value whose largest part is in `[2⁻⁵⁰⁰, 2⁵⁰⁰]` gets the result
 * of the original method, bit for bit, except for `atanh()` of a value
 * that is not real and is very near 1 or −1, where the original method is
 * not correct.
 *
 * `numerics/numeric-complex.ts` calls this function when it loads. Every
 * bundle that contains `complex.js` (the engine, the `core`, `numerics`,
 * `interval` and `compile` entry points, and the runtime of compiled
 * JavaScript) contains that module. A second call does nothing.
 */
export function installComplexScaling(): void {
  const proto = Complex.prototype as Complex & {
    [INSTALLED]?: ComplexMethods;
  };
  if (proto[INSTALLED]) return;

  const original = {} as Record<MethodName, unknown>;
  for (const name of METHODS) original[name] = proto[name];
  const orig = original as ComplexMethods;
  Object.defineProperty(proto, INSTALLED, {
    value: Object.freeze({ ...orig }),
    enumerable: false,
  });

  // The original `abs()` and `sign()` are correct for a large value: when a
  // part is 10⁸ or more, `hypot()` computes `m·√(1 + (n/m)²)`. For a small
  // value, `s·z` with `s` a power of 2 has the same sign, and `|s·z|` is
  // `s·|z|` exactly.
  proto.abs = function (this: Complex): number {
    const a = this.re;
    const b = this.im;
    if (largestPart(a, b) < SMALL && (a !== 0 || b !== 0))
      return orig.abs.call(new Complex(a * UP, b * UP)) * DOWN;
    return orig.abs.call(this);
  };

  proto.sign = function (this: Complex): Complex {
    const a = this.re;
    const b = this.im;
    if (largestPart(a, b) < SMALL && (a !== 0 || b !== 0))
      return orig.sign.call(new Complex(a * UP, b * UP));
    return orig.sign.call(this);
  };

  proto.sqrt = function (this: Complex): Complex {
    const a = this.re;
    const b = this.im;
    const m = largestPart(a, b);
    if (!isOutside(m, SMALL, SQRT_LARGE)) return orig.sqrt.call(this);
    // `√(s·z) = √s·√z`, with `s` an even power of 2, so `√s` is exact. The
    // original method underflows in `|z|` for a small value, and overflows
    // in `|z| + |a|` near the largest double; `2⁻⁴` is enough to avoid
    // that. The original method takes the sign of the imaginary part of the
    // result from `b < 0`, and `s·b` can underflow to −0, which does not
    // pass that test. So the scaled value has the imaginary part `|s·b|`,
    // and the sign is applied to the result.
    const small = m < SMALL;
    const s = small ? UP : 2 ** -4;
    const w = orig.sqrt.call(new Complex(a * s, Math.abs(b * s)));
    const t = small ? 2 ** -300 : 2 ** 2;
    return new Complex(w.re * t, b < 0 ? -w.im * t : w.im * t);
  };

  proto.log = function (this: Complex): Complex {
    const a = this.re;
    const b = this.im;
    if (isLogHypotOutside(a, b))
      return new Complex(scaledLogHypot(a, b), Math.atan2(b, a));
    return orig.log.call(this);
  };

  proto.pow = function (
    this: Complex,
    ...args: Parameters<Complex['pow']>
  ): Complex {
    const a = this.re;
    const b = this.im;
    const z = new Complex(args[0], args[1]);
    // When both parts of the base are not 0 and the exponent is not 0, the
    // original method uses its general formula,
    // `exp(w·ln z) = exp(c·ln|z| − d·arg z)·cis(d·ln|z| + c·arg z)` for the
    // exponent `w = c + di`. Use that formula with a correct `ln|z|`.
    if (z.isZero() || !isLogHypotOutside(a, b))
      return orig.pow.apply(this, args);
    const arg = Math.atan2(b, a);
    const loh = scaledLogHypot(a, b);
    const r = Math.exp(z.re * loh - z.im * arg);
    const t = z.im * loh + z.re * arg;
    return new Complex(r * Math.cos(t), r * Math.sin(t));
  };

  proto.inverse = function (this: Complex): Complex {
    const a = this.re;
    const b = this.im;
    if (isOutside(largestPart(a, b), SMALL, LARGE)) return scaledInverse(a, b);
    return orig.inverse.call(this);
  };

  proto.asin = function (this: Complex): Complex {
    const a = this.re;
    const b = this.im;
    const m = largestPart(a, b);
    if (!isOutside(m, TINY, LARGE)) return orig.asin.call(this);
    // The signs of the zero parts are the ones the original method gives:
    // a real part +0 for an imaginary `z`, and an imaginary part −0 for a
    // small real `z`.
    if (m < TINY) return new Complex(a === 0 ? 0 : a, b === 0 ? -0 : b);
    // arcsin z = −i·ln(iz + √(1 − z²))
    const [lr, li] = asinLogParts(a, b);
    return new Complex(a === 0 ? 0 : li, -lr);
  };

  proto.acos = function (this: Complex): Complex {
    const a = this.re;
    const b = this.im;
    const m = largestPart(a, b);
    if (!isOutside(m, TINY, LARGE)) return orig.acos.call(this);
    // For a small real `z`, the original method gives an imaginary part +0.
    if (m < TINY) return new Complex(HALF_PI - a, b === 0 ? 0 : -b);
    // arccos z = π/2 + i·ln(iz + √(1 − z²)). The real part is `π/2 − θ`
    // with `θ` the imaginary part of the logarithm (see `asinLogParts()`).
    // It is computed as one `atan2`, with `π/2 − atan2(y, x) = atan2(x, y)`
    // for `x ≥ 0`, because the subtraction cancels when `θ` is near `π/2`
    // (`z` near the positive real axis). The `+ 0` changes a −0 to +0, so
    // that a real `z` gets the side of the cut of the original method.
    const [lr] = asinLogParts(a, b);
    const re =
      b > 0 || (b === 0 && a < 0) ? Math.atan2(b + 0, a) : Math.atan2(0 - b, a);
    return new Complex(re, lr);
  };

  proto.atan = function (this: Complex): Complex {
    const a = this.re;
    const b = this.im;
    const m = largestPart(a, b);
    if (!isOutside(m, TINY, LARGE)) return orig.atan.call(this);
    // For a real `z`, the original method gives an imaginary part +0.
    if (m < TINY) return new Complex(a, b === 0 ? 0 : b);
    // arctan z = ±π/2 − arctan(1/z), and arctan(1/z) = 1/z for a small
    // `1/z`. The sign is the sign of Re z. On the cut (the imaginary axis,
    // `|Im z| > 1`), the original method takes the sign of the zero real
    // part: +π/2 for +0, −π/2 for −0.
    const w = scaledInverse(a, b);
    const half = a > 0 || Object.is(a, 0) ? HALF_PI : -HALF_PI;
    return new Complex(half - w.re, b === 0 ? 0 : -w.im);
  };

  proto.atanh = function (this: Complex): Complex {
    const a = this.re;
    const b = this.im;
    const m = largestPart(a, b);
    // `artanh 1` is ∞ in the original method.
    if (!(m > 0 && m <= Number.MAX_VALUE) || (a === 1 && b === 0))
      return orig.atanh.call(this);
    // For an imaginary `z`, the original method gives a real part +0, and
    // for a real `z`, an imaginary part +0.
    if (m < TINY) return new Complex(a === 0 ? 0 : a, b === 0 ? 0 : b);
    if (m > LARGE) {
      // artanh z = artanh(1/z) ± iπ/2, and artanh(1/z) = 1/z for a small
      // `1/z` (the imaginary part of `1/z` is too small to change ±π/2).
      // The sign is the sign of Im z. For a real `z`, the original method
      // gives −π/2 when `z > 1` and +π/2 when `z < −1`.
      const w = scaledInverse(a, b);
      const up = b > 0 || (b === 0 && a < 0);
      return new Complex(a === 0 ? 0 : w.re, up ? HALF_PI : -HALF_PI);
    }
    // In the range, the original method computes `x = (1 + z)/(1 − z)` with
    // the denominator `d = (1 − a)² + b²` and returns `½·ln x`, for a `z`
    // that is not real (a real `z` has its own formulas, which do not
    // square a part, and the checks below send it to the original method).
    // It is not correct when `d` underflows (`z` within about 2⁻⁵⁰⁰ of 1),
    // when `ln|x|` is outside the range of `log` (`x` near 0 or very
    // large), or when one part of `x` is 0 and the other one is subnormal
    // or 0 (`z` within about 2⁻¹⁰²² of −1: the subnormal part has lost
    // digits, and `ln 0` is −∞). The checks below repeat its computation
    // of `x`.
    const oneMinus = 1 - a;
    const onePlus = 1 + a;
    const d = oneMinus * oneMinus + b * b;
    const xr = (onePlus * oneMinus - b * b) / d;
    const xi = (b * oneMinus + onePlus * b) / d;
    if (
      b === 0 ||
      (d >= SMALL * SMALL &&
        !isLogHypotOutside(xr, xi) &&
        largestPart(xr, xi) >= MIN_NORMAL)
    )
      return orig.atanh.call(this);
    // Here, compute `½·ln x` as `½·(ln(1 + z) − ln(1 − z))`, and do not
    // form `x`: near 1, `x` can overflow (`z = 1 + 10⁻³²⁰i`), and near −1,
    // it can be subnormal or 0. The real part is half the difference of the
    // two scaled log-magnitudes. The imaginary part is half the difference
    // of the two arguments. Because `z` is not real here, that difference
    // is the principal argument of `x`: for `Im z > 0`, it is
    // `atan2(b, 1 + a) + atan2(b, 1 − a)`, the sum of two angles of the
    // triangle with the vertices −1, 1 and `z`, which is in `(0, π)` (and
    // in `(−π, 0)` for `Im z < 0`). So it is the value that the original
    // method gets from `atan2(Im x, Re x)`.
    return new Complex(
      (scaledLogHypot(onePlus, b) - scaledLogHypot(oneMinus, b)) / 2,
      (Math.atan2(b, onePlus) - Math.atan2(-b, oneMinus)) / 2
    );
  };

  proto.asinh = function (this: Complex): Complex {
    const a = this.re;
    const b = this.im;
    const m = largestPart(a, b);
    if (!isOutside(m, TINY, LARGE)) return orig.asinh.call(this);
    // For a real or an imaginary `z`, the original method gives the zero
    // part +0.
    if (m < TINY) return new Complex(a === 0 ? 0 : a, b === 0 ? 0 : b);
    // arsinh z = ln(2z) + O(1/z²) on the right of the imaginary axis, and
    // arsinh z = −arsinh(−z). On the imaginary axis, the original method
    // gives `ln(2z)` above 0 and `−ln(−2z)` below 0.
    const lnTwoModulus = Math.LN2 + scaledLogHypot(a, b);
    if (a > 0 || (a === 0 && b > 0))
      return new Complex(lnTwoModulus, b === 0 ? 0 : Math.atan2(b, a));
    return new Complex(-lnTwoModulus, b === 0 ? 0 : -Math.atan2(-b, -a));
  };

  proto.acosh = function (this: Complex): Complex {
    const a = this.re;
    const b = this.im;
    const m = largestPart(a, b);
    // A small real `z` also uses the original method: for a real `|z| ≤ 1`,
    // it computes `i·arccos z`, which does not square a part.
    if (!isOutside(m, TINY, LARGE) || (m < TINY && b === 0))
      return orig.acosh.call(this);
    if (m < TINY) {
      // arcosh z = ±i·arccos z, and arccos z = π/2 − z, with the sign that
      // makes the real part positive: the sign of Im z.
      return b > 0 ? new Complex(b, HALF_PI - a) : new Complex(-b, a - HALF_PI);
    }
    // arcosh z = ln(2z) + O(1/z²). For a real `z < 0`, the original method
    // gives the imaginary part +π.
    const re = Math.LN2 + scaledLogHypot(a, b);
    if (b === 0) return new Complex(re, a < 0 ? Math.PI : 0);
    return new Complex(re, Math.atan2(b, a));
  };

  // The original reciprocal functions compute `1/z` as
  // `(a/d, −b/d)` with `d = a² + b²`, the formula of `inverse()`, and then
  // apply `atan()`, `acos()`, `asin()`, `atanh()`, `asinh()` or `acosh()`.
  // Outside the range, use the scaled inverse instead. The original `acot()`
  // has a separate formula for a real value, `atan2(1, a)`, which is correct
  // for any magnitude; it keeps it. The formula of `acsch()` for a real
  // value, `ln(1/a + √(1/a² + 1))`, squares `1/a` and overflows for a small
  // `a`, so a real value outside the range uses the scaled inverse as well.
  //
  // Below `NEAR_ZERO`, a part of `1/z` can overflow, so `1/z` is not formed.
  // The function `nearZero` then gives the result from `z`. It is the
  // result that the inner method gives for `w = 1/z` when `|w| > 2⁵¹⁰` (the
  // leading terms of the expansions at infinity), written with
  // `ln|w| = −ln|z|` and `arg w = −arg z`. The sign of a zero part of `w` is
  // the sign of the zero part of `(a, −b)`.
  const reciprocal = (
    name: 'acot' | 'asec' | 'acsc' | 'acoth' | 'acsch' | 'asech',
    inner: 'atan' | 'acos' | 'asin' | 'atanh' | 'asinh' | 'acosh',
    keepReal: boolean,
    nearZero: (a: number, b: number) => Complex
  ) => {
    const fn = orig[name];
    proto[name] = function (this: Complex): Complex {
      const a = this.re;
      const b = this.im;
      const m = largestPart(a, b);
      if ((keepReal && b === 0) || !isOutside(m, SMALL, LARGE))
        return fn.call(this);
      if (m < NEAR_ZERO) return nearZero(a, b);
      return scaledInverse(a, b)[inner]();
    };
  };

  // In the functions below, `lnTwoOverModulus()` is `ln|2w| = ln 2 − ln|z|`,
  // and `lowSide` is true when `w = 1/z` is in the upper half-plane or on
  // the negative real axis: `Im z < 0`, or `z` real and negative. That is
  // the side test of `asinLogParts()`, of `acos()` and of `atanh()` for
  // `w`.
  const lnTwoOverModulus = (a: number, b: number) =>
    Math.LN2 - scaledLogHypot(a, b);
  const lowSide = (a: number, b: number) => b < 0 || (b === 0 && a < 0);

  // arccot z = arctan w = ±π/2 − 1/w = ±π/2 − z, with the sign of Re z
  // (+π/2 for a real part +0). `z` is not real here.
  reciprocal('acot', 'atan', true, (a, b) => {
    const half = a > 0 || Object.is(a, 0) ? HALF_PI : -HALF_PI;
    return new Complex(half - a, -b);
  });

  // arcsec z = arccos w. Its real part is `atan2(|Im w|, Re w)`, which is
  // `atan2(|b|, a)`. Its imaginary part is `−ln|2w|` when `lowSide` is
  // true, and `+ln|2w|` on the other side.
  reciprocal('asec', 'acos', false, (a, b) => {
    const l = lnTwoOverModulus(a, b);
    return new Complex(Math.atan2(Math.abs(b), a), lowSide(a, b) ? -l : l);
  });

  // arccsc z = arcsin w. A real part +0 for an imaginary `z`.
  reciprocal('acsc', 'asin', false, (a, b) => {
    const l = lnTwoOverModulus(a, b);
    if (lowSide(a, b)) return new Complex(a === 0 ? 0 : -Math.atan2(-a, -b), l);
    return new Complex(a === 0 ? 0 : Math.atan2(a, b), -l);
  });

  // arcoth z = artanh w = 1/w ± iπ/2 = z ± iπ/2. The imaginary part of `z`
  // is too small to change ±π/2. A real part +0 for an imaginary `z`.
  reciprocal(
    'acoth',
    'atanh',
    false,
    (a, b) => new Complex(a === 0 ? 0 : a, lowSide(a, b) ? HALF_PI : -HALF_PI)
  );

  // arcsch z = arsinh w = ±ln(±2w): `ln(2/z)` when `Re z > 0`, or
  // `Re z = 0` and `Im z < 0`, and `−ln(−2/z)` on the other side. A real
  // `z` gets an imaginary part +0.
  reciprocal('acsch', 'asinh', false, (a, b) => {
    const l = lnTwoOverModulus(a, b);
    if (a > 0 || (a === 0 && b < 0))
      return new Complex(l, b === 0 ? 0 : Math.atan2(-b, a));
    return new Complex(-l, b === 0 ? 0 : -Math.atan2(b, -a));
  });

  // arsech z = arcosh w = ln(2w) = ln(2/z). For a real `z < 0`, the
  // imaginary part is +π.
  reciprocal('asech', 'acosh', false, (a, b) => {
    const l = lnTwoOverModulus(a, b);
    if (b === 0) return new Complex(l, a < 0 ? Math.PI : 0);
    return new Complex(l, Math.atan2(-b, a));
  });
}

/**
 * The original `complex.js` methods that `installComplexScaling()`
 * replaced, or `undefined` before the installation. Tests use them to check
 * that a value in the range gets the same result as before.
 */
export function originalComplexMethods(): Readonly<ComplexMethods> | undefined {
  return (Complex.prototype as Complex & { [INSTALLED]?: ComplexMethods })[
    INSTALLED
  ];
}
