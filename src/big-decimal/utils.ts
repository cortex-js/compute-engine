/**
 * Fixed-point BigInt utilities for internal use by transcendental functions.
 *
 * A "fixed-point BigInt" represents a real number as `value = n / scale`,
 * where `scale = 10^p` for some working precision p. All arithmetic
 * stays in BigInt to preserve arbitrary precision.
 */

// ================================================================
// Cached power of 10
// ================================================================

const _pow10Cache: Map<number, bigint> = new Map();

/** Return 10^n as a bigint, caching values for n <= 100. */
export function pow10(n: number): bigint {
  if (n <= 100) {
    let v = _pow10Cache.get(n);
    if (v === undefined) { v = 10n ** BigInt(n); _pow10Cache.set(n, v); }
    return v;
  }
  return 10n ** BigInt(n);
}

/** Fixed-point multiply: (a * b) / scale */
export function fpmul(a: bigint, b: bigint, scale: bigint): bigint {
  return (a * b) / scale;
}

/** Fixed-point divide: (a * scale) / b */
export function fpdiv(a: bigint, b: bigint, scale: bigint): bigint {
  return (a * scale) / b;
}

/**
 * Fixed-point square root via Newton/Heron iteration.
 *
 * Input:  `a` is a fixed-point value representing `a / scale`.
 * Output: `sqrt(a / scale) * scale` as a bigint.
 *
 * Algorithm:
 *   x_{n+1} = (x + a * scale / x) / 2
 * Converge until |x_{n+1} - x_n| <= 1 (one ULP in the fixed-point representation).
 */
export function fpsqrt(a: bigint, scale: bigint): bigint {
  if (a === 0n) return 0n;
  if (a < 0n) throw new RangeError('fpsqrt: negative input');

  // Compute seed.
  // We need sqrt(a / scale) * scale.
  // Use Number approximation if values are small enough,
  // otherwise use a digit-count-based estimate.
  let x: bigint;

  const aNum = Number(a);
  const scaleNum = Number(scale);

  if (
    Number.isFinite(aNum) &&
    Number.isFinite(scaleNum) &&
    aNum > 0 &&
    scaleNum > 0
  ) {
    // Safe to use floating-point seed
    const approx = Math.sqrt(aNum / scaleNum) * scaleNum;
    if (Number.isFinite(approx) && approx > 0) {
      x = BigInt(Math.floor(approx));
      if (x === 0n) x = 1n;
    } else {
      x = digitBasedSeed(a, scale);
    }
  } else {
    x = digitBasedSeed(a, scale);
  }

  // Newton iteration: x_{n+1} = (x + a * scale / x) / 2
  // The product a * scale is the key fixed-point operation.
  const as = a * scale; // precompute a * scale

  let prev: bigint;
  do {
    prev = x;
    x = (x + as / x) / 2n;
  } while (bigintAbs(x - prev) > 1n);

  // One more iteration to ensure we are as close as possible
  const next = (x + as / x) / 2n;
  // Return the value closest to the true root
  // by comparing x^2 and next^2 to a*scale
  const diffX = bigintAbs(x * x - as);
  const diffNext = bigintAbs(next * next - as);
  return diffNext < diffX ? next : x;
}

/**
 * Compute a seed for fpsqrt when the values are too large for Number.
 *
 * Strategy: extract ~15 leading digits from both `a` and `scale`, compute
 * sqrt(leadA * leadScale) in float64, then scale back to the correct
 * magnitude. This gives a seed accurate to ~7-8 significant digits
 * (half of float64 precision due to sqrt), cutting Newton iterations
 * roughly in half vs a magnitude-only seed.
 */
function digitBasedSeed(a: bigint, scale: bigint): bigint {
  // We want sqrt(a * scale) as a bigint.
  // Factor: a ≈ leadA * 10^shiftA, scale ≈ leadScale * 10^shiftScale
  // sqrt(a * scale) ≈ sqrt(leadA * leadScale) * 10^((shiftA + shiftScale) / 2)
  const LEAD = 15; // digits to extract for float64 arithmetic

  const digA = bigintDigits(a);
  const shiftA = Math.max(0, digA - LEAD);
  const leadA = Number(shiftA > 0 ? a / pow10(shiftA) : a);

  const digS = bigintDigits(scale);
  const shiftS = Math.max(0, digS - LEAD);
  const leadS = Number(shiftS > 0 ? scale / pow10(shiftS) : scale);

  const totalShift = shiftA + shiftS;
  const halfShift = Math.floor(totalShift / 2);

  let floatSeed = Math.sqrt(leadA * leadS);
  // When totalShift is odd, absorb the extra factor of sqrt(10)
  if (totalShift % 2 !== 0) floatSeed *= 3.1622776601683795; // sqrt(10)

  const seed = BigInt(Math.round(floatSeed)) * pow10(halfShift);
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
    if (tmp >> BigInt(shift) > 0n) { bits += shift; tmp >>= BigInt(shift); }
  }
  bits += 1;
  const approx = Math.ceil(bits * 0.30102999566398);
  // Correct by ±1 using cached pow10
  if (n < pow10(approx - 1)) return approx - 1;
  if (n >= pow10(approx)) return approx + 1;
  return approx;
}

/**
 * Fixed-point exponential: compute exp(x/scale) * scale.
 *
 * Uses Taylor series with argument reduction (halving) and
 * repeated squaring to reconstruct the full result.
 *
 * @param x  Fixed-point input (represents x/scale)
 * @param scale  The fixed-point scale (10^precision)
 * @returns  exp(x/scale) * scale as a bigint
 */
export function fpexp(x: bigint, scale: bigint): bigint {
  // exp(0) = 1
  if (x === 0n) return scale;

  // Argument reduction: divide x by 2^k until |r| < scale/2 (i.e., |r/scale| < 0.5)
  let k = 0;
  let r = x;
  const half = scale / 2n;
  while (bigintAbs(r) > half) {
    r = r / 2n;
    k++;
  }

  // Taylor series: exp(r/scale) = 1 + r/scale + r²/(2!·scale²) + ...
  // In fixed-point: sum = scale + r + r²/(2·scale) + r³/(6·scale²) + ...
  // Incremental: term_n = term_{n-1} * r / (n * scale)
  let sum = scale; // 1.0
  let term = r; // r/scale in fixed-point
  sum += term;

  for (let n = 2; ; n++) {
    term = term * r / (BigInt(n) * scale);
    if (bigintAbs(term) === 0n) break;
    sum += term;
  }

  // Squaring phase: exp(x/scale) = exp(r/scale)^(2^k)
  for (let i = 0; i < k; i++) {
    sum = sum * sum / scale;
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
 * @param x  Fixed-point input (represents x/scale), must be positive
 * @param scale  The fixed-point scale (10^precision)
 * @returns  ln(x/scale) * scale as a bigint
 */
export function fpln(x: bigint, scale: bigint): bigint {
  // ln(1) = 0
  if (x === scale) return 0n;

  // Try direct floating-point seed first (fast path for precision <= ~300)
  const xNum = Number(x);
  const scaleNum = Number(scale);
  let y: bigint;
  let target = x; // the value we compute ln of (may be reduced)
  let k = 0; // number of sqrt halvings applied

  if (Number.isFinite(xNum) && Number.isFinite(scaleNum) && xNum > 0 && scaleNum > 0) {
    const ratio = xNum / scaleNum;
    if (Number.isFinite(ratio) && ratio > 0) {
      const approx = Math.log(ratio);
      if (Number.isFinite(approx)) {
        // Good ~15-digit seed from floating-point
        y = BigInt(Math.round(approx * scaleNum));
      } else {
        y = estimateLnSeed(x, scale);
      }
    } else {
      y = estimateLnSeed(x, scale);
    }
  } else {
    // Floating-point overflows at this precision.
    // Use argument reduction: reduce x/scale to [0.5, 2] by repeated sqrt.
    // ln(x) = 2^k * ln(x^(1/2^k))
    // This ensures Number(reduced)/Number(scale) gives a good ~15-digit seed.
    target = x;
    const twoScale = 2n * scale;
    const halfScale = scale / 2n;

    while (target > twoScale || target < halfScale) {
      target = fpsqrt(target, scale);
      k++;
    }

    // Now target/scale is in [0.5, 2] — use digit-count seed
    // (Number(target) is still Infinity at this precision, but the
    // digit-based estimate is accurate for values near 1)
    y = estimateLnSeed(target, scale);
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
    const ey = fpexp(y, scale);
    if (ey === 0n) {
      // exp(y) underflowed to zero, y is too negative — adjust
      y = y / 2n;
      continue;
    }
    const yn = y + (target * scale) / ey - scale;
    const absDelta = bigintAbs(yn - y);
    if (absDelta <= 1n) break;
    // Detect limit cycle: both deltas are small and convergence stalled
    if (absDelta < 100000n && prevAbsDelta > 0n && prevAbsDelta < 100000n
      && absDelta * 4n >= prevAbsDelta) break;
    prevAbsDelta = absDelta;
    y = yn;
  }

  // Undo halvings: ln(x) = 2^k * ln(reduced)
  for (let i = 0; i < k; i++) {
    y = 2n * y;
  }

  return y;
}

/**
 * Estimate a seed for ln when floating-point conversion overflows.
 * Uses digit counting: ln(x/scale) ≈ (digits(x) - digits(scale)) * ln(10)
 */
function estimateLnSeed(x: bigint, scale: bigint): bigint {
  const xDigits = bigintDigits(x);
  const scaleDigits = bigintDigits(scale);
  const digitDiff = BigInt(xDigits - scaleDigits);
  return (digitDiff * 2302585n * scale) / 1000000n;
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
 * Return PI as a fixed-point bigint at the given scale.
 *
 * The result satisfies: fppi / scale ≈ π
 */
let _fppiCache: { scale: bigint; value: bigint } | null = null;

function fppi(scale: bigint): bigint {
  if (_fppiCache !== null && _fppiCache.scale === scale) return _fppiCache.value;

  // Compute PI * scale using the shared PI_DIGITS constant.
  // scale = 10^p, so we need ~p+10 digits of PI.
  const p = bigintDigits(scale) - 1; // scale = 10^p
  const neededDigits = p + 10; // extra guard digits

  // Take only what we need
  const digits = PI_DIGITS.slice(0, neededDigits + 1); // +1 for the "3"

  // PI ≈ digits * 10^(-fracDigits) where fracDigits = digits.length - 1
  const piInt = BigInt(digits);
  const fracDigits = digits.length - 1;

  // result = piInt * scale / 10^fracDigits
  const value = (piInt * scale) / pow10(fracDigits);
  _fppiCache = { scale, value };
  return value;
}

// ================================================================
// Fixed-point sincos (simultaneous sin and cos)
// ================================================================

/**
 * Compute sin(x/scale) and cos(x/scale) simultaneously, returning
 * [sin * scale, cos * scale] as fixed-point bigints.
 *
 * Algorithm:
 * 1. Reduce x mod 2π
 * 2. Quadrant reduction to [0, π/2]
 * 3. Double-angle halving until |arg| < scale/2
 * 4. Taylor series for small arg
 * 5. Reconstruct via double-angle formulas
 *
 * @param x  Fixed-point input (represents x/scale)
 * @param scale  The fixed-point scale (10^precision)
 * @returns  [sin(x/scale)*scale, cos(x/scale)*scale]
 */
export function fpsincos(x: bigint, scale: bigint): [bigint, bigint] {
  // sin(0) = 0, cos(0) = 1
  if (x === 0n) return [0n, scale];

  const pi = fppi(scale);
  const twoPi = 2n * pi;
  const halfPi = pi / 2n;

  // Step 1: Reduce modulo 2π to [0, 2π)
  // For large arguments, x % twoPi loses precision because x has many
  // more digits than twoPi. Use extended precision for the reduction.
  let r: bigint;
  const absX = bigintAbs(x);
  if (absX > scale * (1n << 30n)) {
    // Large argument: compute at extended precision
    // Extra guard digits: log10(|x/scale|) + 20
    const extraDigits = bigintDigits(absX) - bigintDigits(scale) + 20;
    const extScale = scale * pow10(extraDigits);
    const extX = x * pow10(extraDigits);
    const extPi = fppi(extScale);
    const extTwoPi = 2n * extPi;

    // Compute n = round(extX / extPi) using Clenshaw reduction:
    // r = x - n*pi (not 2pi, to get better precision)
    // This gives r in [-pi, pi]
    let extR = extX % extTwoPi;
    if (extR < 0n) extR += extTwoPi;

    // Scale back
    r = extR / pow10(extraDigits);
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
  const p = bigintDigits(scale) - 1;
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
  const scale2 = scale * scale; // hoisted: saves one bigint multiply per term

  for (let n = 2; ; n += 2) {
    // cos term: cosTerm = cosTerm * (-r²) / (n*(n-1)*scale²)
    // But we compute sign explicitly
    cosTerm = cosTerm * r2 / (BigInt(n) * BigInt(n - 1) * scale2);
    if (cosTerm === 0n) {
      // Also check sin at next step
      sinTerm = sinTerm * r2 / (BigInt(n + 1) * BigInt(n) * scale2);
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
    sinTerm = sinTerm * r2 / (BigInt(n + 1) * BigInt(n) * scale2);

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
    const newSin = 2n * sinVal * cosVal / scale;
    const newCos = 2n * cosVal * cosVal / scale - scale;
    sinVal = newSin;
    cosVal = newCos;
  }

  return [sinSign * sinVal, cosSign * cosVal];
}

// ================================================================
// Fixed-point atan
// ================================================================

/**
 * Compute atan(x/scale) * scale as a fixed-point bigint.
 *
 * Algorithm:
 * 1. Handle sign: atan(-x) = -atan(x)
 * 2. If |x| > scale (i.e., |x/scale| > 1): atan(x) = π/2 - atan(scale²/x)
 * 3. Halving: if |x| > 0.4*scale, use atan(x) = 2·atan(x / (1 + sqrt(scale² + x²)))
 * 4. Taylor series: atan(r) = r - r³/3 + r⁵/5 - ...
 *
 * @param x  Fixed-point input (represents x/scale)
 * @param scale  The fixed-point scale (10^precision)
 * @returns  atan(x/scale) * scale
 */
export function fpatan(x: bigint, scale: bigint): bigint {
  if (x === 0n) return 0n;

  // Handle sign
  if (x < 0n) return -fpatan(-x, scale);

  const pi = fppi(scale);
  const halfPi = pi / 2n;

  // If x/scale > 1, use atan(x/scale) = π/2 - atan(scale/x)
  // In fixed-point: atan(x, scale) = halfPi - atan(scale² / x, scale)
  if (x > scale) {
    const reciprocal = scale * scale / x; // scale²/x represents scale/x in fp
    return halfPi - fpatan(reciprocal, scale);
  }

  // Halving: if x > 0.4 * scale, use atan(x) = 2*atan(x / (1 + sqrt(1 + x²)))
  // In fixed-point: threshold = 4*scale/10
  const threshold = 4n * scale / 10n;
  let halvings = 0;
  let r = x;

  while (r > threshold) {
    // We want r_new/scale = (r/scale) / (1 + sqrt(1 + (r/scale)²))
    // fpsqrt(a, scale) = sqrt(a/scale) * scale
    // We need sqrt(1 + (r/scale)²) * scale = fpsqrt(val, scale)
    // where val/scale = 1 + (r/scale)² = (scale² + r²)/scale²
    // so val = (scale² + r²) / scale
    const r2 = r * r;
    const val = (scale * scale + r2) / scale;
    const sqrtVal = fpsqrt(val, scale); // sqrt(1 + t²) * scale
    r = r * scale / (scale + sqrtVal);
    halvings++;
  }

  // Taylor series: atan(t) = t - t³/3 + t⁵/5 - t⁷/7 + ...
  // In fixed-point: result = r - r³/(3·scale²) + r⁵/(5·scale⁴) - ...
  // Incremental: term_n = term_{n-2} * (-r²) / scale²  and divide by odd number
  let sum = r;
  let term = r;
  const r2 = r * r;
  const scale2 = scale * scale; // hoisted: saves one bigint multiply per term

  for (let n = 3; ; n += 2) {
    term = term * r2 / scale2;
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
