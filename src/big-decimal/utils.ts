/**
 * Fixed-point BigInt utilities for internal use by transcendental functions.
 *
 * A "fixed-point BigInt" represents a real number as `value = n / 2^bits`
 * (a *binary* grid). Scaling by the radix is therefore a bit-shift
 * (`>> bits` / `<< bits`) rather than a division by `10^p` — the dominant
 * cost in the Taylor/Newton inner loops. Benchmarks show this is 2–4× faster
 * than an equivalent base-10 grid at identical accuracy (ROADMAP item 17.1;
 * A/B harness in `benchmarks/big-decimal/kernel-base2-experiment.ts`). The
 * decimal<->binary conversion happens once at the BigDecimal boundary in
 * `transcendentals.ts` (`toFixedPoint`/`fromFixedPoint`); everything here is
 * binary. All arithmetic stays in BigInt to preserve arbitrary precision.
 *
 * Kernels take `bits` (the base-2 exponent of the scale) and internally use
 * `scale = 1n << BigInt(bits)` for value representation.
 */

// ================================================================
// Cached power of 10
// ================================================================

const _pow10Cache: Map<number, bigint> = new Map();

/** Return 10^n as a bigint, caching values for n <= 100. */
export function pow10(n: number): bigint {
  if (n <= 100) {
    let v = _pow10Cache.get(n);
    if (v === undefined) {
      v = 10n ** BigInt(n);
      _pow10Cache.set(n, v);
    }
    return v;
  }
  return 10n ** BigInt(n);
}

/** Bit length of |n| (the number of bits in its binary representation). */
export function bitLength(n: bigint): number {
  if (n < 0n) n = -n;
  if (n === 0n) return 0;
  let bits = 0;
  // Doubling search to bracket the bit length.
  let high = 1;
  while (n >> BigInt(high) > 0n) high *= 2;
  // Binary search within [0, high].
  for (let shift = high >> 1; shift >= 1; shift >>= 1) {
    if (n >> BigInt(shift) > 0n) {
      bits += shift;
      n >>= BigInt(shift);
    }
  }
  return bits + 1;
}

/** Fixed-point multiply on the base-2 grid: (a * b) >> bits */
export function fpmul(a: bigint, b: bigint, bits: number): bigint {
  return (a * b) >> BigInt(bits);
}

/** Fixed-point divide on the base-2 grid: (a << bits) / b */
export function fpdiv(a: bigint, b: bigint, bits: number): bigint {
  return (a << BigInt(bits)) / b;
}

/**
 * Fixed-point square root via Newton/Heron iteration on the base-2 grid.
 *
 * Input:  `a` is a fixed-point value representing `a / 2^bits`.
 * Output: `sqrt(a / 2^bits) * 2^bits` as a bigint.
 *
 * Note `sqrt(a/scale)·scale = sqrt(a·scale) = isqrt(a << bits)`, so the kernel
 * is just an integer square root of `a << bits`.
 *
 * Algorithm:
 *   x_{n+1} = (x + (a << bits) / x) / 2
 * Converge until |x_{n+1} - x_n| <= 1 (one ULP in the fixed-point grid).
 */
export function fpsqrt(a: bigint, bits: number): bigint {
  if (a === 0n) return 0n;
  if (a < 0n) throw new RangeError('fpsqrt: negative input');

  // as = a * scale = a << bits; the result is isqrt(as).
  const as = a << BigInt(bits);
  let x = bigSqrtSeed(as);

  // Newton iteration: x_{n+1} = (x + as / x) / 2
  let prev: bigint;
  do {
    prev = x;
    x = (x + as / x) / 2n;
  } while (bigintAbs(x - prev) > 1n);

  // One more iteration, then pick whichever of {x, next} has x²
  // closest to `as` (the true floor-root or one above it).
  const next = (x + as / x) / 2n;
  const diffX = bigintAbs(x * x - as);
  const diffNext = bigintAbs(next * next - as);
  return diffNext < diffX ? next : x;
}

/**
 * Seed for an integer square root of `n`: a value within a few bits of
 * sqrt(n). Uses a float64 sqrt directly when `n` fits in a double, else
 * extracts the top ~52 bits and scales the float result back by 2^(shift/2).
 */
function bigSqrtSeed(n: bigint): bigint {
  const bl = bitLength(n);
  if (bl <= 1023) {
    const s = Math.sqrt(Number(n));
    if (Number.isFinite(s) && s >= 1) return BigInt(Math.floor(s));
  }
  // n ≈ lead · 2^shift with lead ~52-bit. sqrt(n) ≈ sqrt(lead) · 2^(shift/2).
  const shift = bl - 52; // > 0 here
  const lead = Number(n >> BigInt(shift));
  let fs = Math.sqrt(lead);
  if (shift & 1) fs *= Math.SQRT2; // odd shift: absorb one factor of √2
  const seed = BigInt(Math.round(fs)) << BigInt(shift >> 1);
  return seed > 0n ? seed : 1n;
}

/** Absolute value of a bigint. */
export function bigintAbs(n: bigint): bigint {
  return n < 0n ? -n : n;
}

/** Sign of a bigint: -1n, 0n, or 1n. */
export function bigintSign(n: bigint): bigint {
  if (n > 0n) return 1n;
  if (n < 0n) return -1n;
  return 0n;
}

/** Count the number of decimal digits in a bigint (absolute value). */
export function bigintDigits(n: bigint): number {
  if (n === 0n) return 1;
  if (n < 0n) n = -n;
  // Fast path: fits in a Number (< 2^53)
  if (n < 0x20000000000000n) return Math.floor(Math.log10(Number(n))) + 1;
  // Large bigints: find bit length via doubling + binary search
  let bits = 0;
  let tmp = n;
  // Doubling search to find upper bound for bit length
  let high = 1;
  while (tmp >> BigInt(high) > 0n) high *= 2;
  // Binary search within [0, high]
  for (let shift = high >> 1; shift >= 1; shift >>= 1) {
    if (tmp >> BigInt(shift) > 0n) {
      bits += shift;
      tmp >>= BigInt(shift);
    }
  }
  bits += 1;
  const approx = Math.ceil(bits * 0.30102999566398);
  // Correct by ±1 using cached pow10
  if (n < pow10(approx - 1)) return approx - 1;
  if (n >= pow10(approx)) return approx + 1;
  return approx;
}

/**
 * Fixed-point exponential: compute exp(x/2^bits) * 2^bits.
 *
 * Uses Taylor series with argument reduction (halving) and
 * repeated squaring to reconstruct the full result.
 *
 * @param x  Fixed-point input (represents x/2^bits)
 * @param bits  The base-2 scale exponent
 * @returns  exp(x/2^bits) * 2^bits as a bigint
 */
export function fpexp(x: bigint, bits: number): bigint {
  const B = BigInt(bits);
  const scale = 1n << B;
  // exp(0) = 1
  if (x === 0n) return scale;

  // Argument reduction: halve x until |r| < scale/2 (i.e., |r/scale| < 0.5).
  let k = 0;
  let r = x;
  const half = scale >> 1n;
  while (bigintAbs(r) > half) {
    r = r / 2n;
    k++;
  }

  // Taylor series: exp(r/scale) = 1 + r/scale + r²/(2!·scale²) + ...
  // In fixed-point: sum = scale + r + r²/(2·scale) + r³/(6·scale²) + ...
  // Incremental: term_n = term_{n-1} * r / (n * scale)
  //   base-10:  (term * r) / (n * 10^p)    — one full-width division
  //   base-2:   ((term * r) >> bits) / n   — shift + small-divisor division
  let sum = scale; // 1.0
  let term = r; // r/scale in fixed-point
  sum += term;

  for (let n = 2; ; n++) {
    term = ((term * r) >> B) / BigInt(n);
    if (term === 0n) break;
    sum += term;
  }

  // Squaring phase: exp(x/scale) = exp(r/scale)^(2^k)
  for (let i = 0; i < k; i++) {
    sum = (sum * sum) >> B;
  }

  return sum;
}

/**
 * Fixed-point natural logarithm: compute ln(x/scale) * scale.
 *
 * Uses Newton's method on f(y) = exp(y) - x, where y = ln(x):
 *   y_{n+1} = y + x/exp(y) - 1
 *
 * Converges quadratically from a double-precision seed.
 *
 * @param x  Fixed-point input (represents x/2^bits), must be positive
 * @param bits  The base-2 scale exponent
 * @returns  ln(x/2^bits) * 2^bits as a bigint
 */
export function fpln(x: bigint, bits: number): bigint {
  const B = BigInt(bits);
  const scale = 1n << B;
  // Defense in depth: a non-positive input is a caller bug (callers
  // range-reduce so the kernel only sees O(1) positive values). A zero
  // input used to hang forever in the sqrt-reduction loop (fpsqrt(0) = 0).
  if (x <= 0n) throw new RangeError('fpln: input must be positive');

  // ln(1) = 0
  if (x === scale) return 0n;

  // Try direct floating-point seed first (fast path for bits <= ~1000)
  const xNum = Number(x);
  const scaleNum = Number(scale);
  let y: bigint;
  let target = x; // the value we compute ln of (may be reduced)
  let k = 0; // number of sqrt halvings applied

  if (
    Number.isFinite(xNum) &&
    Number.isFinite(scaleNum) &&
    xNum > 0 &&
    scaleNum > 0
  ) {
    const ratio = xNum / scaleNum;
    if (Number.isFinite(ratio) && ratio > 0) {
      const approx = Math.log(ratio);
      if (Number.isFinite(approx)) {
        // Good ~15-digit seed from floating-point
        y = BigInt(Math.round(approx * scaleNum));
      } else {
        y = estimateLnSeed(x, bits);
      }
    } else {
      y = estimateLnSeed(x, bits);
    }
  } else {
    // Floating-point overflows at this precision.
    // Use argument reduction: reduce x/scale to [0.5, 2] by repeated sqrt.
    // ln(x) = 2^k * ln(x^(1/2^k))
    // This ensures Number(reduced)/Number(scale) gives a good ~15-digit seed.
    target = x;
    const twoScale = scale << 1n;
    const halfScale = scale >> 1n;

    while (target > twoScale || target < halfScale) {
      target = fpsqrt(target, bits);
      k++;
    }

    // Now target/scale is in [0.5, 2] — use a bit-count seed
    // (Number(target) is still Infinity at this precision, but the
    // estimate is accurate for values near 1)
    y = estimateLnSeed(target, bits);
  }

  // Newton iteration: y_{n+1} = y + x/exp(y) - 1 in fixed-point:
  // y_{n+1} = y + (target * scale / ey) - scale
  //
  // Convergence note: fpexp has O(1) ULP truncation error and the
  // subsequent division adds another O(1) ULP, so the smallest
  // achievable |delta| can be tens of ULPs rather than 0–1. A tight
  // threshold of 1 causes limit-cycle oscillation at many precisions.
  // We detect stalled convergence: once |delta| is small (<100000)
  // AND the previous |delta| was also small AND delta didn't shrink
  // by at least 4x, we've reached the truncation floor. The gate
  // on both current and previous delta prevents false triggers during
  // the initial slow convergence from a crude seed (sqrt-reduction
  // path). Callers carry 15 guard digits, so 5 digits of noise
  // (100000 ULP) leaves 10 digits of margin.
  let prevAbsDelta = 0n;
  for (let i = 0; i < 100; i++) {
    const ey = fpexp(y, bits);
    if (ey === 0n) {
      // exp(y) underflowed to zero, y is too negative — adjust
      y = y / 2n;
      continue;
    }
    const yn = y + (target << B) / ey - scale;
    const absDelta = bigintAbs(yn - y);
    if (absDelta <= 1n) break;
    // Detect limit cycle: both deltas are small and convergence stalled
    if (
      absDelta < 100000n &&
      prevAbsDelta > 0n &&
      prevAbsDelta < 100000n &&
      absDelta * 4n >= prevAbsDelta
    )
      break;
    prevAbsDelta = absDelta;
    y = yn;
  }

  // Undo halvings: ln(x) = 2^k * ln(reduced)
  for (let i = 0; i < k; i++) {
    y = 2n * y;
  }

  return y;
}

/** round(ln(2) · 2^53), for a base-2 ln seed without float overflow. */
const LN2_Q53 = 6243314768165359n;

/**
 * Estimate a seed for ln when floating-point conversion overflows.
 * Uses bit counting: ln(x/2^bits) ≈ (bitLength(x) - bits) · ln(2).
 * In fixed-point: seed = bitDiff · ln(2) · 2^bits = bitDiff · LN2_Q53 · 2^(bits-53).
 */
function estimateLnSeed(x: bigint, bits: number): bigint {
  const bitDiff = BigInt(bitLength(x) - bits);
  if (bits >= 53) return (bitDiff * LN2_Q53) << BigInt(bits - 53);
  return (bitDiff * LN2_Q53) >> BigInt(53 - bits);
}

// ================================================================
// Fixed-point PI constant
// ================================================================

/** PI digits without decimal point (2370 digits). */
export const PI_DIGITS =
  '3' +
  '1415926535897932384626433832795028841971693993751058209749445923078164062862089986280348253421170679' +
  '8214808651328230664709384460955058223172535940812848111745028410270193852110555964462294895493038196' +
  '4428810975665933446128475648233786783165271201909145648566923460348610454326648213393607260249141273' +
  '7245870066063155881748815209209628292540917153643678925903600113305305488204665213841469519415116094' +
  '3305727036575959195309218611738193261179310511854807446237996274956735188575272489122793818301194912' +
  '9833673362440656643086021394946395224737190702179860943702770539217176293176752384674818467669405132' +
  '0005681271452635608277857713427577896091736371787214684409012249534301465495853710507922796892589235' +
  '4201995611212902196086403441815981362977477130996051870721134999999837297804995105973173281609631859' +
  '5024459455346908302642522308253344685035261931188171010003137838752886587533208381420617177669147303' +
  '5982534904287554687311595628638823537875937519577818577805321712268066130019278766111959092164201989' +
  '3809525720106548586327886593615338182796823030195203530185296899577362259941389124972177528347913151' +
  '557485724245415069595082953311686172785588907509838175463746493931925506040092770167113900984882401285836160356370766010471018194295559619894676783744944825537977472684710404753464620804668425906949129331367702898915210475216205696602405803815019351125338243003558764024749647326391419927260426992279678235478163600934172164121992458631503028618297455570674983850549458858692699569092721079750930295532116534498720275596023648066549911988183479775356636980742654252786255181841757467289097777279380008164706001614524919217321721477235014144197356854816136115735255213347574184946843852332390739414333454776241686251898356948556209921922218427255025425688767179049460165346680498862723279178608578438382796797668145410095388378636095068006422512520511739298489608412848862694560424196528502221066118630674427862203919494504712371378696095636437191728746776465757396241389086583264599581339047802759009946576407895126946839835259570982582262052248940772671947826848260147699090264013639443745530506820349625245174939965143142980919065925093722169646151570985838741059788595977297549893016175392846813826868386894277415599185592524595395943104997252468084598727364469584865383673622262609912460805124388439045124413654976278079771569143599770012961608944169486855584840635';

/**
 * Return PI as a base-2 fixed-point bigint at the given scale.
 *
 * The result satisfies: fppi / 2^bits ≈ π
 */
const LOG10_2 = Math.log10(2); // ≈ 0.30103

let _fppiCache: { bits: number; value: bigint } | null = null;

function fppi(bits: number): bigint {
  if (_fppiCache !== null && _fppiCache.bits === bits) return _fppiCache.value;

  // Compute PI * 2^bits using the shared PI_DIGITS constant.
  // We need ~bits·log10(2) decimal digits of PI, plus guard digits.
  const neededDigits = Math.ceil(bits * LOG10_2) + 12;

  // Take only what we need (slice is clamped to the available digits; callers
  // guard against requesting beyond the ~2370-digit table — see sin/cos).
  const digits = PI_DIGITS.slice(0, neededDigits + 1); // +1 for the "3"

  // PI ≈ piInt · 10^(-fracDigits) where fracDigits = digits.length - 1.
  // result = π · 2^bits = (piInt << bits) / 10^fracDigits
  const piInt = BigInt(digits);
  const fracDigits = digits.length - 1;
  const value = (piInt << BigInt(bits)) / pow10(fracDigits);
  _fppiCache = { bits, value };
  return value;
}

// ================================================================
// Fixed-point sincos (simultaneous sin and cos)
// ================================================================

/**
 * Compute sin(x/2^bits) and cos(x/2^bits) simultaneously, returning
 * [sin * 2^bits, cos * 2^bits] as base-2 fixed-point bigints.
 *
 * Algorithm:
 * 1. Reduce x mod 2π
 * 2. Quadrant reduction to [0, π/2]
 * 3. Double-angle halving until |arg| < scale/2
 * 4. Taylor series for small arg
 * 5. Reconstruct via double-angle formulas
 *
 * @param x  Fixed-point input (represents x/2^bits)
 * @param bits  The base-2 scale exponent
 * @returns  [sin(x/2^bits)*2^bits, cos(x/2^bits)*2^bits]
 */
export function fpsincos(x: bigint, bits: number): [bigint, bigint] {
  const B = BigInt(bits);
  const scale = 1n << B;
  // sin(0) = 0, cos(0) = 1
  if (x === 0n) return [0n, scale];

  const pi = fppi(bits);
  const twoPi = 2n * pi;
  const halfPi = pi / 2n;

  // Step 1: Reduce modulo 2π to [0, 2π)
  // For large arguments, x % twoPi loses precision because x has many
  // more bits than twoPi. Use extended precision for the reduction.
  let r: bigint;
  const absX = bigintAbs(x);
  if (absX > scale << 30n) {
    // Large argument: compute at extended precision.
    // Extra guard bits: bitLength(|x/scale|) + 64.
    const extraBits = bitLength(absX) - bits + 64;
    const extBits = bits + extraBits;
    const extX = x << BigInt(extraBits);
    const extPi = fppi(extBits);
    const extTwoPi = 2n * extPi;

    let extR = extX % extTwoPi;
    if (extR < 0n) extR += extTwoPi;

    // Scale back
    r = extR >> BigInt(extraBits);
  } else {
    r = x % twoPi;
  }
  if (r < 0n) r += twoPi;

  // Step 2: Quadrant reduction to [0, π/2]
  // Determine quadrant and adjust sign
  let sinSign = 1n;
  let cosSign = 1n;

  if (r > 3n * halfPi) {
    // Quadrant 4: [3π/2, 2π) → sin negative, cos positive, use 2π - r
    r = twoPi - r;
    sinSign = -1n;
  } else if (r > pi) {
    // Quadrant 3: [π, 3π/2] → sin negative, cos negative, use r - π
    r = r - pi;
    sinSign = -1n;
    cosSign = -1n;
  } else if (r > halfPi) {
    // Quadrant 2: [π/2, π] → sin positive, cos negative, use π - r
    r = pi - r;
    cosSign = -1n;
  }
  // else Quadrant 1: [0, π/2] — no change

  // Step 3: Double-angle halving
  // Each halving is cheap (integer divide by 2) but reconstruction costs O(M(p)).
  // Each Taylor term also costs O(M(p)). Balance the two for O(√p) total steps.
  // Error amplification in reconstruction: ~4x per step, so limit to ~18 halvings
  // to stay within the 15 guard digits (4^18 ≈ 7·10^10 ULP, ~11 digits).
  //
  // With k halvings, r/scale ≈ 0.5/2^(k-1), and Taylor needs ~p/(k·1.33) terms.
  // Choose k to minimize k + p/(k·1.33): optimal k ≈ √(p/1.33) ≈ 0.87·√p,
  // capped at 18 for error safety.
  const p = Math.round(bits * LOG10_2); // ≈ decimal precision
  const targetK = Math.min(18, Math.max(2, Math.ceil(0.87 * Math.sqrt(p))));
  let k = 0;
  // Halve until r < scale / 2^targetK (roughly)
  const threshold = scale >> BigInt(targetK);
  while (r > threshold) {
    r = r / 2n;
    k++;
  }

  // Step 4: Taylor series for sin(r/scale) and cos(r/scale)
  // sin(t) = t - t³/3! + t⁵/5! - ...
  // cos(t) = 1 - t²/2! + t⁴/4! - ...
  // In fixed-point: sin_fp = r - r³/(3!·scale²) + ...
  //                 cos_fp = scale - r²/(2!·scale) + ...

  let sinVal = r; // first term: r
  let cosVal = scale; // first term: scale (1.0)

  // For sin: term_n = term_{n-2} * (-r²) / (n*(n-1)*scale²)
  // Start with term = r (n=1), next is n=3: term * (-r²) / (2*3*scale²)
  let sinTerm = r;
  let cosTerm = scale;

  const r2 = r * r; // r²
  const B2 = 2n * B; // dividing by scale² is a >> (2·bits) shift

  for (let n = 2; ; n += 2) {
    // cos term: cosTerm = cosTerm * (-r²) / (n*(n-1)*scale²)
    // base-2: ((cosTerm * r²) >> 2·bits) / (n*(n-1)); sign applied explicitly
    cosTerm = ((cosTerm * r2) >> B2) / (BigInt(n) * BigInt(n - 1));
    if (cosTerm === 0n) {
      // Also check sin at next step
      sinTerm = ((sinTerm * r2) >> B2) / (BigInt(n + 1) * BigInt(n));
      if (sinTerm !== 0n) {
        if (n % 4 === 2) {
          cosVal -= cosTerm;
          sinVal -= sinTerm;
        } else {
          cosVal += cosTerm;
          sinVal += sinTerm;
        }
      }
      break;
    }

    // sin term at n+1: sinTerm = sinTerm * r² / ((n+1)*n*scale²)
    sinTerm = ((sinTerm * r2) >> B2) / (BigInt(n + 1) * BigInt(n));

    if (n % 4 === 2) {
      // n=2: subtract for cos (term 2: -r²/2!), subtract for sin (term 3: -r³/3!)
      cosVal -= cosTerm;
      sinVal -= sinTerm;
    } else {
      // n=4: add for cos (term 4: +r⁴/4!), add for sin (term 5: +r⁵/5!)
      cosVal += cosTerm;
      sinVal += sinTerm;
    }

    if (sinTerm === 0n) break;
  }

  // Step 5: Reconstruct via double-angle formulas
  // sin(2θ) = 2·sin(θ)·cos(θ)
  // cos(2θ) = 2·cos²(θ) - 1
  for (let i = 0; i < k; i++) {
    const newSin = (2n * sinVal * cosVal) >> B;
    const newCos = ((2n * cosVal * cosVal) >> B) - scale;
    sinVal = newSin;
    cosVal = newCos;
  }

  return [sinSign * sinVal, cosSign * cosVal];
}

// ================================================================
// Fixed-point atan
// ================================================================

/**
 * Compute atan(x/2^bits) * 2^bits as a base-2 fixed-point bigint.
 *
 * Algorithm:
 * 1. Handle sign: atan(-x) = -atan(x)
 * 2. If |x| > scale (i.e., |x/scale| > 1): atan(x) = π/2 - atan(scale²/x)
 * 3. Halving: if |x| > 0.4*scale, use atan(x) = 2·atan(x / (1 + sqrt(scale² + x²)))
 * 4. Taylor series: atan(r) = r - r³/3 + r⁵/5 - ...
 *
 * @param x  Fixed-point input (represents x/2^bits)
 * @param bits  The base-2 scale exponent
 * @returns  atan(x/2^bits) * 2^bits
 */
export function fpatan(x: bigint, bits: number): bigint {
  if (x === 0n) return 0n;

  // Handle sign
  if (x < 0n) return -fpatan(-x, bits);

  const B = BigInt(bits);
  const scale = 1n << B;
  const pi = fppi(bits);
  const halfPi = pi / 2n;

  // If x/scale > 1, use atan(x/scale) = π/2 - atan(scale/x)
  // In fixed-point: atan(x) = halfPi - atan(scale² / x); scale² = scale << bits.
  if (x > scale) {
    const reciprocal = (scale << B) / x; // scale²/x represents scale/x in fp
    return halfPi - fpatan(reciprocal, bits);
  }

  // Halving: if x > 0.4 * scale, use atan(x) = 2*atan(x / (1 + sqrt(1 + x²)))
  // In fixed-point: threshold = 4*scale/10
  const threshold = (4n * scale) / 10n;
  let halvings = 0;
  let r = x;

  while (r > threshold) {
    // We want r_new/scale = (r/scale) / (1 + sqrt(1 + (r/scale)²))
    // val/scale = 1 + (r/scale)² = (scale² + r²)/scale², so val = (scale² + r²) >> bits
    const r2 = r * r;
    const val = ((scale << B) + r2) >> B;
    const sqrtVal = fpsqrt(val, bits); // sqrt(1 + t²) * scale
    r = (r << B) / (scale + sqrtVal);
    halvings++;
  }

  // Taylor series: atan(t) = t - t³/3 + t⁵/5 - t⁷/7 + ...
  // In fixed-point: result = r - r³/(3·scale²) + r⁵/(5·scale⁴) - ...
  // Incremental: term_n = term_{n-2} * (-r²) >> 2·bits  and divide by odd number
  let sum = r;
  let term = r;
  const r2 = r * r;
  const B2 = 2n * B; // dividing by scale² is a >> (2·bits) shift

  for (let n = 3; ; n += 2) {
    term = (term * r2) >> B2;
    if (term === 0n) break;
    // Late division by n: the per-term truncation error is < 1 ULP each,
    // so total error is bounded by ~nTerms/2 ULP — well within the 15 guard digits.
    if (n % 4 === 3) {
      sum -= term / BigInt(n);
    } else {
      sum += term / BigInt(n);
    }
  }

  // Undo halvings: atan(x) = 2^halvings * atan(r)
  for (let i = 0; i < halvings; i++) {
    sum = 2n * sum;
  }

  return sum;
}
