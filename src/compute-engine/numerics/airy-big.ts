import { BigDecimal } from '../../big-decimal/index.js';
import type { IComputeEngine as ComputeEngine } from '../global-types.js';
import { bigGamma } from './special-functions.js';
import { bigBessel } from './bessel-big.js';
import { bigWithCancellation } from './bignum-cancellation.js';

/**
 * Arbitrary-precision Airy functions Ai(x) and Bi(x) for a real x, at
 * `BigDecimal.precision` digits, from the Bessel functions of order ±1/3 of
 * ζ = (2/3)|x|^{3/2} (DLMF 9.6.2–9.6.6):
 *
 *   Ai(x)  = (1/π)·√(x/3)·K_{1/3}(ζ)                    x > 0
 *   Bi(x)  = √(x/3)·(I_{−1/3}(ζ) + I_{1/3}(ζ))          x > 0
 *   Ai(−x) = (√x/3)·(J_{1/3}(ζ) + J_{−1/3}(ζ))          x > 0
 *   Bi(−x) = √(x/3)·(J_{−1/3}(ζ) − J_{1/3}(ζ))          x > 0
 *
 * and, at 0, Ai(0) = 3^{−2/3}/Γ(2/3), Bi(0) = 3^{−1/6}/Γ(2/3) (DLMF 9.2.3).
 * The Bessel values carry the working precision, so the cancellation of the
 * two J terms near a zero of Ai or Bi is measured on the sum
 * (`bigWithCancellation`). The kernel declines where `bigBessel` does: past
 * `AIRY_BIG_MAX_ARGUMENT`, and Bi(x) for x > about 130 (I_{±1/3}(ζ) would need
 * ζ past the series of `bigBessel`).
 */

/** |x| above this declines: ζ = (2/3)|x|^{3/2} would pass the range of `bigBessel`. */
export const AIRY_BIG_MAX_ARGUMENT = 10000;

const THIRD: readonly [bigint, bigint] = [1n, 3n];
const MINUS_THIRD: readonly [bigint, bigint] = [-1n, 3n];

/** 3^p computed at the working precision, for a rational exponent p = a/b. */
function threePower(a: number, b: number): BigDecimal {
  return new BigDecimal(3).ln().mul(a).div(b).exp();
}

/** Ai(x) or Bi(x), or `undefined` where the kernel declines. */
export function bigAiry(
  ce: ComputeEngine,
  kind: 'Ai' | 'Bi',
  x: BigDecimal
): BigDecimal | undefined {
  if (!x.isFinite() || x.abs().gt(AIRY_BIG_MAX_ARGUMENT)) return undefined;
  return bigWithCancellation((working) => {
    if (x.isZero()) {
      const value = BigDecimal.ONE.div(
        threePower(kind === 'Ai' ? 2 : 1, kind === 'Ai' ? 3 : 6).mul(
          bigGamma(ce, new BigDecimal(2).div(3))
        )
      );
      return { value, peak: value };
    }
    const ax = x.abs();
    // ζ is read by `bigBessel` at 30 digits past the working precision; the
    // phase of a large ζ needs them
    BigDecimal.precision = working + 30;
    const zeta = ax.mul(ax.sqrt()).mul(2).div(3);
    BigDecimal.precision = working;
    const root = ax.div(3).sqrt();
    const bessel = (
      kind: 'J' | 'I' | 'K',
      order: readonly [bigint, bigint]
    ): BigDecimal | undefined => bigBessel(ce, kind, order, zeta);
    const parts: BigDecimal[] = [];
    let scale: BigDecimal;
    if (x.isPositive()) {
      if (kind === 'Ai') {
        const k = bessel('K', THIRD);
        if (k === undefined) return undefined;
        parts.push(k);
        scale = root.div(BigDecimal.PI);
      } else {
        const a = bessel('I', MINUS_THIRD);
        const b = bessel('I', THIRD);
        if (a === undefined || b === undefined) return undefined;
        parts.push(a, b);
        scale = root;
      }
    } else {
      const a = bessel('J', MINUS_THIRD);
      const b = bessel('J', THIRD);
      if (a === undefined || b === undefined) return undefined;
      if (kind === 'Ai') {
        parts.push(a, b);
        scale = ax.sqrt().div(3);
      } else {
        parts.push(a, b.neg());
        scale = root;
      }
    }
    const sum = parts.reduce((s, p) => s.add(p));
    const peak = parts.reduce((m, p) => (p.abs().gt(m) ? p.abs() : m));
    return { value: scale.mul(sum), peak: scale.mul(peak) };
  });
}
