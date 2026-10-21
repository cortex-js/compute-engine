/** Arithmetic required by polynomial algorithms, independent of expressions. */
export interface ExactField<T> {
  readonly zero: T;
  readonly one: T;
  add(a: T, b: T): T;
  neg(a: T): T;
  mul(a: T, b: T): T;
  inv(a: T): T;
  isZero(a: T): boolean;
  fromInteger(a: bigint): T;
}

export type RationalCoefficient = Readonly<{
  numerator: bigint;
  denominator: bigint;
}>;

export function integerGcd(a: bigint, b: bigint): bigint {
  a = a < 0n ? -a : a;
  b = b < 0n ? -b : b;
  while (b !== 0n) [a, b] = [b, a % b];
  return a;
}

export function rationalCoefficient(
  numerator: bigint,
  denominator = 1n
): RationalCoefficient {
  if (denominator === 0n) throw new RangeError('Zero rational denominator');
  const g = integerGcd(numerator, denominator) * (denominator < 0n ? -1n : 1n);
  return { numerator: numerator / g, denominator: denominator / g };
}

export const rationalField: ExactField<RationalCoefficient> = {
  zero: rationalCoefficient(0n),
  one: rationalCoefficient(1n),
  add: (a, b) =>
    rationalCoefficient(
      a.numerator * b.denominator + b.numerator * a.denominator,
      a.denominator * b.denominator
    ),
  neg: (a) => ({ numerator: -a.numerator, denominator: a.denominator }),
  mul: (a, b) =>
    rationalCoefficient(
      a.numerator * b.numerator,
      a.denominator * b.denominator
    ),
  inv: (a) => rationalCoefficient(a.denominator, a.numerator),
  isZero: (a) => a.numerator === 0n,
  fromInteger: (a) => rationalCoefficient(a),
};

export class PolynomialBudgetExceeded extends Error {
  constructor(readonly reason: string) {
    super(reason);
  }
}

/** A per-computation budget, shared by nested algorithms and never global. */
export class PolynomialWork {
  operations = 0;
  constructor(
    readonly limit = 2_000_000,
    readonly check?: () => void
  ) {
    if (!Number.isSafeInteger(limit) || limit < 0)
      throw new RangeError('Invalid polynomial work limit');
  }
  tick(count = 1): void {
    this.operations += count;
    if (this.operations > this.limit)
      throw new PolynomialBudgetExceeded('operation-limit');
    this.check?.();
  }
}

/** Coefficients are ascending in degree; the zero polynomial is the empty array. */
export class FieldPolynomials<T> {
  constructor(
    readonly field: ExactField<T>,
    readonly work = new PolynomialWork()
  ) {}
  trim(p: readonly T[]): T[] {
    let n = p.length;
    while (n && this.field.isZero(p[n - 1])) n--;
    return p.slice(0, n);
  }
  add(a: readonly T[], b: readonly T[]): T[] {
    this.work.tick(Math.max(a.length, b.length));
    return this.trim(
      Array.from({ length: Math.max(a.length, b.length) }, (_, i) =>
        this.field.add(a[i] ?? this.field.zero, b[i] ?? this.field.zero)
      )
    );
  }
  sub(a: readonly T[], b: readonly T[]): T[] {
    return this.add(
      a,
      b.map((x) => this.field.neg(x))
    );
  }
  scale(a: readonly T[], b: T): T[] {
    this.work.tick(a.length);
    return this.trim(a.map((x) => this.field.mul(x, b)));
  }
  mul(a: readonly T[], b: readonly T[]): T[] {
    if (!a.length || !b.length) return [];
    const r = Array<T>(a.length + b.length - 1).fill(this.field.zero);
    for (let i = 0; i < a.length; i++) {
      this.work.tick(b.length);
      for (let j = 0; j < b.length; j++)
        r[i + j] = this.field.add(r[i + j], this.field.mul(a[i], b[j]));
    }
    return this.trim(r);
  }
  divrem(a: readonly T[], divisor: readonly T[]): [T[], T[]] {
    const b = this.trim(divisor);
    if (!b.length) throw new RangeError('Polynomial division by zero');
    let r = this.trim(a);
    const q = Array<T>(Math.max(0, r.length - b.length + 1)).fill(
      this.field.zero
    );
    const inv = this.field.inv(b[b.length - 1]);
    while (r.length >= b.length) {
      this.work.tick(b.length);
      const d = r.length - b.length;
      const c = this.field.mul(r[r.length - 1], inv);
      q[d] = c;
      for (let i = 0; i < b.length; i++)
        r[i + d] = this.field.add(
          r[i + d],
          this.field.neg(this.field.mul(c, b[i]))
        );
      r = this.trim(r);
    }
    return [this.trim(q), r];
  }
  exactDivide(a: readonly T[], b: readonly T[]): T[] {
    const [q, r] = this.divrem(a, b);
    if (r.length) throw new Error('Non-exact polynomial division');
    return q;
  }
  monic(a: readonly T[]): T[] {
    const p = this.trim(a);
    return p.length ? this.scale(p, this.field.inv(p[p.length - 1])) : [];
  }
  gcd(a: readonly T[], b: readonly T[]): T[] {
    let x = this.trim(a),
      y = this.trim(b);
    while (y.length) [x, y] = [y, this.divrem(x, y)[1]];
    return this.monic(x);
  }
  derivative(a: readonly T[]): T[] {
    return this.trim(
      a
        .slice(1)
        .map((x, i) => this.field.mul(x, this.field.fromInteger(BigInt(i + 1))))
    );
  }
  powmod(a: readonly T[], exponent: bigint, modulus: readonly T[]): T[] {
    if (exponent < 0n) throw new RangeError('Negative polynomial exponent');
    let r = [this.field.one],
      b = this.divrem(a, modulus)[1];
    while (exponent) {
      if (exponent & 1n) r = this.divrem(this.mul(r, b), modulus)[1];
      exponent >>= 1n;
      if (exponent) b = this.divrem(this.mul(b, b), modulus)[1];
    }
    return this.divrem(r, modulus)[1];
  }
  inverseMod(a: readonly T[], modulus: readonly T[]): T[] {
    let r = this.trim(modulus),
      s = this.trim(a);
    let u: T[] = [],
      v = [this.field.one];
    while (s.length) {
      const [q, rem] = this.divrem(r, s);
      [r, s] = [s, rem];
      [u, v] = [v, this.sub(u, this.mul(q, v))];
    }
    if (r.length !== 1) throw new RangeError('Polynomial is not invertible');
    return this.divrem(this.scale(u, this.field.inv(r[0])), modulus)[1];
  }
  /** Characteristic-zero square-free decomposition of a monic polynomial. */
  squareFree(a: readonly T[]): { polynomial: T[]; multiplicity: number }[] {
    const f = this.monic(a);
    if (f.length <= 1) return [];
    let c = this.gcd(f, this.derivative(f));
    let w = this.exactDivide(f, c);
    const result: { polynomial: T[]; multiplicity: number }[] = [];
    for (let multiplicity = 1; w.length > 1; multiplicity++) {
      const y = this.gcd(w, c);
      const z = this.exactDivide(w, y);
      if (z.length > 1) result.push({ polynomial: z, multiplicity });
      w = y;
      c = this.exactDivide(c, y);
    }
    if (c.length > 1)
      throw new RangeError(
        'Square-free decomposition requires characteristic zero'
      );
    return result;
  }
}
