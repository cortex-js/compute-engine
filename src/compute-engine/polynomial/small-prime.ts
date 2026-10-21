import {
  FieldPolynomials,
  PolynomialWork,
  type ExactField,
} from './exact-field.js';

export function checkSmallPrime(prime: number): void {
  if (!Number.isSafeInteger(prime) || prime < 2 || prime > 65521)
    throw new RangeError('Prime must be at most 65521');
  for (let d = 2; d * d <= prime; d++)
    if (prime % d === 0) throw new RangeError('Composite field characteristic');
}

/** Internal residues are canonical integers in [0, p). */
function smallPrimeField(p: number): ExactField<number> {
  checkSmallPrime(p);
  const bigP = BigInt(p);
  return {
    zero: 0,
    one: 1,
    add: (a, b) => (a + b) % p,
    neg: (a) => (a === 0 ? 0 : p - a),
    mul: (a, b) => (a * b) % p,
    inv: (a) => {
      if (!a) throw new RangeError('Division by zero in prime field');
      let r = p,
        s = a,
        u = 0,
        v = 1;
      while (s) {
        const q = Math.floor(r / s);
        [r, s] = [s, r - q * s];
        [u, v] = [v, u - q * v];
      }
      return u < 0 ? u + p : u;
    },
    isZero: (a) => a === 0,
    fromInteger: (a) => Number(((a % bigP) + bigP) % bigP),
  };
}

/**
 * Exact small-prime arithmetic, not floating-point approximation. Each
 * multiply-add is reduced immediately: its magnitude is below p^2 < 2^32,
 * well inside JavaScript's 53-bit integer significand. No signed bitwise
 * coercions are used (p^2 can exceed 2^31).
 */
export class SmallPrimePolynomials extends FieldPolynomials<number> {
  constructor(
    readonly prime: number,
    work = new PolynomialWork()
  ) {
    super(smallPrimeField(prime), work);
  }

  fromIntegers(a: readonly bigint[]): number[] {
    return this.trim(a.map(this.field.fromInteger));
  }

  override mul(a: readonly number[], b: readonly number[]): number[] {
    if (!a.length || !b.length) return [];
    const r = Array<number>(a.length + b.length - 1).fill(0);
    for (let i = 0; i < a.length; i++) {
      this.work.tick();
      if (!a[i]) continue;
      this.work.tick(b.length);
      for (let j = 0; j < b.length; j++)
        r[i + j] = (r[i + j] + a[i] * b[j]) % this.prime;
    }
    return this.trim(r);
  }

  override divrem(
    a: readonly number[],
    divisor: readonly number[]
  ): [number[], number[]] {
    const b = this.trim(divisor);
    if (!b.length) throw new RangeError('Polynomial division by zero');
    const r = this.trim(a);
    const q = Array<number>(Math.max(0, r.length - b.length + 1)).fill(0);
    const inverse = this.field.inv(b[b.length - 1]);
    for (let d = q.length - 1; d >= 0; d--) {
      this.work.tick();
      const c = (r[d + b.length - 1] * inverse) % this.prime;
      if (!c) continue;
      q[d] = c;
      this.work.tick(b.length);
      for (let i = 0; i < b.length; i++) {
        const v = (r[i + d] - c * b[i]) % this.prime;
        r[i + d] = v < 0 ? v + this.prime : v === 0 ? 0 : v;
      }
    }
    return [this.trim(q), this.trim(r)];
  }
}
