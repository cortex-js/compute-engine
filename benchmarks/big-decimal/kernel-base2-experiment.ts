/**
 * Experiment (ROADMAP item 17.1): base-2 vs base-10 fixed-point kernel.
 *
 * BACKGROUND. The BigDecimal transcendental kernel originally worked in a
 * *base-10* fixed-point grid: values were integers scaled by `10^p`, so every
 * Taylor term and every squaring divided by `scale = 10^p` — a full-width
 * BigInt division. mpmath's defining design choice is to do the same work in a
 * *base-2* grid (`scale = 2^bits`), where scaling by the radix is a bit-shift
 * (`>> bits`) instead of a division.
 *
 * This file was the A/B harness that justified the switch, and it is kept as a
 * self-contained record: it inlines BOTH the original base-10 kernels and the
 * base-2 kernels and measures, at equal accuracy:
 *
 *   1. kernel-only time (input pre-converted) — isolates the inner-loop win
 *   2. end-to-end time  (decimal→binary in, binary→decimal out) — the real
 *      answer at the BigDecimal API boundary, including conversion overhead
 *
 * It verifies both kernels agree with a high-precision BigDecimal reference to
 * the target precision, so the timings compare like for like.
 *
 * The base-2 kernels were promoted into `src/big-decimal/utils.ts`; this file
 * no longer imports them (it carries its own copies) so it keeps working as a
 * historical comparison regardless of future kernel changes.
 *
 * Run:  npx tsx benchmarks/big-decimal/kernel-base2-experiment.ts
 */

import { BigDecimal } from '../../src/big-decimal';
import { bigintAbs, pow10, PI_DIGITS } from '../../src/big-decimal/utils';

const LOG2_10 = Math.log2(10); // ≈ 3.321928

// ============================================================
// Base-10 kernels (the ORIGINAL implementation, scale = 10^p)
// ============================================================

/** exp(x / scale) * scale — original base-10 kernel. */
function fpexp10(x: bigint, scale: bigint): bigint {
  if (x === 0n) return scale;
  let k = 0;
  let r = x;
  const half = scale / 2n;
  while (bigintAbs(r) > half) {
    r = r / 2n;
    k++;
  }
  let sum = scale;
  let term = r;
  sum += term;
  for (let n = 2; ; n++) {
    term = (term * r) / (BigInt(n) * scale); // full-width division per term
    if (bigintAbs(term) === 0n) break;
    sum += term;
  }
  for (let i = 0; i < k; i++) sum = (sum * sum) / scale;
  return sum;
}

const _pi10Cache = new Map<string, bigint>();
function fppi10(scale: bigint): bigint {
  const key = scale.toString();
  const cached = _pi10Cache.get(key);
  if (cached !== undefined) return cached;
  const p = scale.toString().length - 1; // scale = 10^p
  const digits = PI_DIGITS.slice(0, p + 11);
  const piInt = BigInt(digits);
  const value = (piInt * scale) / pow10(digits.length - 1);
  _pi10Cache.set(key, value);
  return value;
}

/** [sin, cos](x / scale) * scale — original base-10 kernel (small-arg path). */
function fpsincos10(x: bigint, scale: bigint): [bigint, bigint] {
  if (x === 0n) return [0n, scale];
  const pi = fppi10(scale);
  const twoPi = 2n * pi;
  const halfPi = pi / 2n;
  let r = x % twoPi;
  if (r < 0n) r += twoPi;
  let sinSign = 1n;
  let cosSign = 1n;
  if (r > 3n * halfPi) {
    r = twoPi - r;
    sinSign = -1n;
  } else if (r > pi) {
    r = r - pi;
    sinSign = -1n;
    cosSign = -1n;
  } else if (r > halfPi) {
    r = pi - r;
    cosSign = -1n;
  }
  const p = scale.toString().length - 1;
  const targetK = Math.min(18, Math.max(2, Math.ceil(0.87 * Math.sqrt(p))));
  let k = 0;
  const threshold = scale >> BigInt(targetK);
  while (r > threshold) {
    r = r / 2n;
    k++;
  }
  let sinVal = r;
  let cosVal = scale;
  let sinTerm = r;
  let cosTerm = scale;
  const r2 = r * r;
  const scale2 = scale * scale;
  for (let n = 2; ; n += 2) {
    cosTerm = (cosTerm * r2) / (BigInt(n) * BigInt(n - 1) * scale2);
    if (cosTerm === 0n) {
      sinTerm = (sinTerm * r2) / (BigInt(n + 1) * BigInt(n) * scale2);
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
    sinTerm = (sinTerm * r2) / (BigInt(n + 1) * BigInt(n) * scale2);
    if (n % 4 === 2) {
      cosVal -= cosTerm;
      sinVal -= sinTerm;
    } else {
      cosVal += cosTerm;
      sinVal += sinTerm;
    }
    if (sinTerm === 0n) break;
  }
  for (let i = 0; i < k; i++) {
    const newSin = (2n * sinVal * cosVal) / scale;
    const newCos = (2n * cosVal * cosVal) / scale - scale;
    sinVal = newSin;
    cosVal = newCos;
  }
  return [sinSign * sinVal, cosSign * cosVal];
}

// ============================================================
// Base-2 kernels (scale = 2^bits — the promoted implementation)
// ============================================================

/** exp(x / 2^bits) * 2^bits — base-2 kernel. */
function fpexp2(x: bigint, bits: number): bigint {
  const B = BigInt(bits);
  const scale = 1n << B;
  if (x === 0n) return scale;
  let k = 0;
  let r = x;
  const half = scale >> 1n;
  while (bigintAbs(r) > half) {
    r = r / 2n;
    k++;
  }
  let sum = scale;
  let term = r;
  sum += term;
  for (let n = 2; ; n++) {
    term = ((term * r) >> B) / BigInt(n); // shift + small-divisor division
    if (term === 0n) break;
    sum += term;
  }
  for (let i = 0; i < k; i++) sum = (sum * sum) >> B;
  return sum;
}

const _pi2Cache = new Map<number, bigint>();
function fppi2(bits: number): bigint {
  const cached = _pi2Cache.get(bits);
  if (cached !== undefined) return cached;
  const neededDigits = Math.ceil(bits / LOG2_10) + 12;
  const digits = PI_DIGITS.slice(0, neededDigits + 1);
  const piInt = BigInt(digits);
  const value = (piInt << BigInt(bits)) / pow10(digits.length - 1);
  _pi2Cache.set(bits, value);
  return value;
}

/** [sin, cos](x / 2^bits) * 2^bits — base-2 kernel (small-arg path). */
function fpsincos2(x: bigint, bits: number): [bigint, bigint] {
  const B = BigInt(bits);
  const B2 = BigInt(2 * bits);
  const scale = 1n << B;
  if (x === 0n) return [0n, scale];
  const pi = fppi2(bits);
  const twoPi = 2n * pi;
  const halfPi = pi / 2n;
  let r = x % twoPi;
  if (r < 0n) r += twoPi;
  let sinSign = 1n;
  let cosSign = 1n;
  if (r > 3n * halfPi) {
    r = twoPi - r;
    sinSign = -1n;
  } else if (r > pi) {
    r = r - pi;
    sinSign = -1n;
    cosSign = -1n;
  } else if (r > halfPi) {
    r = pi - r;
    cosSign = -1n;
  }
  const p = Math.round(bits / LOG2_10);
  const targetK = Math.min(18, Math.max(2, Math.ceil(0.87 * Math.sqrt(p))));
  let k = 0;
  const threshold = scale >> BigInt(targetK);
  while (r > threshold) {
    r = r / 2n;
    k++;
  }
  let sinVal = r;
  let cosVal = scale;
  let sinTerm = r;
  let cosTerm = scale;
  const r2 = r * r;
  for (let n = 2; ; n += 2) {
    cosTerm = ((cosTerm * r2) >> B2) / (BigInt(n) * BigInt(n - 1));
    if (cosTerm === 0n) {
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
    sinTerm = ((sinTerm * r2) >> B2) / (BigInt(n + 1) * BigInt(n));
    if (n % 4 === 2) {
      cosVal -= cosTerm;
      sinVal -= sinTerm;
    } else {
      cosVal += cosTerm;
      sinVal += sinTerm;
    }
    if (sinTerm === 0n) break;
  }
  for (let i = 0; i < k; i++) {
    const newSin = (2n * sinVal * cosVal) >> B;
    const newCos = ((2n * cosVal * cosVal) >> B) - scale;
    sinVal = newSin;
    cosVal = newCos;
  }
  return [sinSign * sinVal, cosSign * cosVal];
}

// ============================================================
// Conversions
// ============================================================

/** Decimal → base-10 fixed point at scale 10^wp. */
function toFP10(x: BigDecimal, wp: number): bigint {
  const e = x.exponent + wp;
  return e >= 0 ? x.significand * pow10(e) : x.significand / pow10(-e);
}

/** Decimal → base-2 fixed point at scale 2^bits. */
function toFP2(x: BigDecimal, bits: number): bigint {
  if (x.exponent >= 0)
    return (x.significand * pow10(x.exponent)) << BigInt(bits);
  return (x.significand << BigInt(bits)) / pow10(-x.exponent);
}

/** Round a base-10 fixed-point value (scale 10^wp) onto the grid 10^p. */
function grid10FromFP10(fp: bigint, wp: number, p: number): bigint {
  return roundDiv(fp, pow10(wp - p));
}

/** Round a base-2 fixed-point value (scale 2^bits) onto the grid 10^p. */
function grid10FromFP2(fp: bigint, bits: number, p: number): bigint {
  const num = bigintAbs(fp) * pow10(p);
  const B = BigInt(bits);
  const q = (num + (1n << (B - 1n))) >> B;
  return fp < 0n ? -q : q;
}

/** Round a BigDecimal onto the integer grid 10^p (i.e. round(value · 10^p)). */
function grid10FromBD(x: BigDecimal, p: number): bigint {
  const e = x.exponent + p;
  if (e >= 0) return x.significand * pow10(e);
  return roundDiv(x.significand, pow10(-e));
}

function roundDiv(a: bigint, b: bigint): bigint {
  const neg = a < 0n;
  const aa = neg ? -a : a;
  const q = (aa + b / 2n) / b;
  return neg ? -q : q;
}

// ============================================================
// Timing
// ============================================================

function timeIt(fn: () => unknown, minMs = 150): number {
  for (let i = 0; i < 3; i++) fn(); // warmup
  let calls = 0;
  const minNs = BigInt(minMs) * 1_000_000n;
  const t0 = process.hrtime.bigint();
  let elapsed = 0n;
  do {
    fn();
    calls++;
    if ((calls & 7) === 0) elapsed = process.hrtime.bigint() - t0;
  } while (elapsed < minNs);
  const total = process.hrtime.bigint() - t0;
  return Number(total) / calls; // ns per call
}

// ============================================================
// Drivers
// ============================================================

const PRECISIONS = [25, 50, 100, 250, 500, 1000, 2000];
const GUARD_DIGITS = 15; // mirror the caller guard the real exp()/sin() use
const GUARD_BITS = 16; // extra base-2 margin for shift truncations

type Row = {
  p: number;
  errA: number; // base-10 kernel error (ULP @ grid 10^p)
  errB: number; // base-2 kernel error
  kA: number; // kernel-only ns, base-10
  kB: number; // kernel-only ns, base-2
  eA: number; // end-to-end ns, base-10
  eB: number; // end-to-end ns, base-2
};

function fmt(ns: number): string {
  if (ns >= 1e6) return (ns / 1e6).toFixed(2) + 'ms';
  if (ns >= 1e3) return (ns / 1e3).toFixed(2) + 'µs';
  return ns.toFixed(0) + 'ns';
}

function speedup(a: number, b: number): string {
  const s = a / b;
  return s >= 1 ? `${s.toFixed(2)}×` : `${s.toFixed(2)}× (slower)`;
}

function runExp(): Row[] {
  const x = new BigDecimal('1.7'); // representative kernel input for exp
  const rows: Row[] = [];
  for (const p of PRECISIONS) {
    const wp = p + GUARD_DIGITS;
    const bits = Math.ceil(wp * LOG2_10) + GUARD_BITS;
    const fp10 = toFP10(x, wp);
    const scale10 = pow10(wp);
    const fp2 = toFP2(x, bits);

    const savedPrec = BigDecimal.precision;
    BigDecimal.precision = p + 25;
    const ref = grid10FromBD(x.exp(), p);
    BigDecimal.precision = savedPrec;

    const errA = Number(
      bigintAbs(grid10FromFP10(fpexp10(fp10, scale10), wp, p) - ref)
    );
    const errB = Number(
      bigintAbs(grid10FromFP2(fpexp2(fp2, bits), bits, p) - ref)
    );

    const kA = timeIt(() => fpexp10(fp10, scale10));
    const kB = timeIt(() => fpexp2(fp2, bits));
    const eA = timeIt(() =>
      grid10FromFP10(fpexp10(toFP10(x, wp), scale10), wp, p)
    );
    const eB = timeIt(() => grid10FromFP2(fpexp2(toFP2(x, bits), bits), bits, p));

    rows.push({ p, errA, errB, kA, kB, eA, eB });
  }
  return rows;
}

function runSinCos(): Row[] {
  const x = new BigDecimal('1.2');
  const rows: Row[] = [];
  for (const p of PRECISIONS) {
    const wp = p + GUARD_DIGITS;
    const bits = Math.ceil(wp * LOG2_10) + GUARD_BITS;
    const fp10 = toFP10(x, wp);
    const scale10 = pow10(wp);
    const fp2 = toFP2(x, bits);

    const savedPrec = BigDecimal.precision;
    BigDecimal.precision = p + 25;
    const ref = grid10FromBD(x.sin(), p);
    BigDecimal.precision = savedPrec;

    const errA = Number(
      bigintAbs(grid10FromFP10(fpsincos10(fp10, scale10)[0], wp, p) - ref)
    );
    const errB = Number(
      bigintAbs(grid10FromFP2(fpsincos2(fp2, bits)[0], bits, p) - ref)
    );

    const kA = timeIt(() => fpsincos10(fp10, scale10));
    const kB = timeIt(() => fpsincos2(fp2, bits));
    const eA = timeIt(() =>
      grid10FromFP10(fpsincos10(toFP10(x, wp), scale10)[0], wp, p)
    );
    const eB = timeIt(() =>
      grid10FromFP2(fpsincos2(toFP2(x, bits), bits)[0], bits, p)
    );

    rows.push({ p, errA, errB, kA, kB, eA, eB });
  }
  return rows;
}

function printTable(title: string, rows: Row[]): void {
  console.log(`\n## ${title}\n`);
  console.log(
    'p'.padStart(5) +
      'errA'.padStart(7) +
      'errB'.padStart(7) +
      '  ' +
      'kernel b10'.padStart(11) +
      'kernel b2'.padStart(11) +
      'k speedup'.padStart(11) +
      '  ' +
      'e2e b10'.padStart(10) +
      'e2e b2'.padStart(10) +
      'e2e speedup'.padStart(13)
  );
  for (const r of rows) {
    console.log(
      String(r.p).padStart(5) +
        String(r.errA).padStart(7) +
        String(r.errB).padStart(7) +
        '  ' +
        fmt(r.kA).padStart(11) +
        fmt(r.kB).padStart(11) +
        speedup(r.kA, r.kB).padStart(11) +
        '  ' +
        fmt(r.eA).padStart(10) +
        fmt(r.eB).padStart(10) +
        speedup(r.eA, r.eB).padStart(13)
    );
  }
}

console.log('Base-2 vs base-10 fixed-point kernel experiment');
console.log('(errA/errB = ULP error at grid 10^p; both should be tiny)');
printTable('exp(1.7)', runExp());
printTable('sin(1.2)', runSinCos());
console.log(
  '\nNote: "speedup" > 1 means base-2 is faster. ' +
    'Kernel = inner loop only; e2e includes decimal↔binary conversion. ' +
    'The base-2 kernels here mirror the promoted versions in src/big-decimal/utils.ts.'
);
