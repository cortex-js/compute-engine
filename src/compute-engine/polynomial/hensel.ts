import { PolynomialInvariantError, PolynomialWork } from './exact-field.js';
import { SmallPrimePolynomials } from './small-prime.js';

/** Z/mZ polynomial arithmetic. Division requires a monic divisor, not a field. */
export class ModularPolynomials {
  constructor(
    readonly modulus: bigint,
    readonly work: PolynomialWork
  ) {
    if (modulus < 2n) throw new RangeError('Invalid polynomial modulus');
  }
  scalar(n: bigint): bigint {
    const r = n % this.modulus;
    return r < 0n ? r + this.modulus : r;
  }
  normalize(a: readonly bigint[]): bigint[] {
    this.work.tick(a.length);
    const r = a.map((c) => this.scalar(c));
    while (r.length && r[r.length - 1] === 0n) r.pop();
    return r;
  }
  sub(a: readonly bigint[], b: readonly bigint[]): bigint[] {
    return this.normalize(
      Array.from(
        { length: Math.max(a.length, b.length) },
        (_, i) => (a[i] ?? 0n) - (b[i] ?? 0n)
      )
    );
  }
  mul(a: readonly bigint[], b: readonly bigint[]): bigint[] {
    if (!a.length || !b.length) return [];
    const r = Array<bigint>(a.length + b.length - 1).fill(0n);
    for (let i = 0; i < a.length; i++) {
      this.work.tick();
      if (!a[i]) continue;
      this.work.tick(b.length);
      for (let j = 0; j < b.length; j++) r[i + j] += a[i] * b[j];
    }
    return this.normalize(r);
  }
  divrem(a: readonly bigint[], b: readonly bigint[]): [bigint[], bigint[]] {
    if (!b.length || b[b.length - 1] !== 1n)
      throw new RangeError('Prime-power division requires a monic divisor');
    const r = this.normalize(a);
    const q = Array<bigint>(Math.max(0, r.length - b.length + 1)).fill(0n);
    for (let i = q.length - 1; i >= 0; i--) {
      this.work.tick(b.length);
      const c = r[i + b.length - 1];
      q[i] = c;
      for (let j = 0; j < b.length; j++)
        r[i + j] = this.scalar(r[i + j] - c * b[j]);
    }
    return [this.normalize(q), this.normalize(r)];
  }
}

interface LiftNode {
  polynomial: bigint[];
  left?: LiftNode;
  right?: LiftNode;
  /** Inverse of right.polynomial modulo left.polynomial at current precision. */
  inverse?: bigint[];
}

/** Degree-balanced product tree with atomically committed precision doubling. */
export class HenselTree {
  private root: LiftNode;
  modulus: bigint;
  constructor(
    factors: readonly (readonly bigint[])[],
    prime: number,
    readonly work: PolynomialWork,
    initialModulus = BigInt(prime)
  ) {
    const P = new SmallPrimePolynomials(prime, work);
    this.modulus = initialModulus;
    let power = initialModulus;
    while (power > 1n && power % BigInt(prime) === 0n) {
      work.tick();
      power /= BigInt(prime);
    }
    if (power !== 1n || initialModulus < BigInt(prime))
      throw new RangeError(
        'Initial modulus must be a positive power of the prime'
      );
    const R = new ModularPolynomials(initialModulus, work);
    if (
      !factors.length ||
      factors.some(
        (f) =>
          f.length < 2 ||
          f[f.length - 1] !== 1n ||
          f.some((c) => c < 0n || c >= this.modulus)
      )
    )
      throw new RangeError('Expected canonical monic modular factors');
    const build = (fs: readonly (readonly bigint[])[]): LiftNode => {
      if (fs.length === 1) return { polynomial: [...fs[0]] };
      const degree = fs.reduce((s, f) => s + f.length - 1, 0);
      let split = 1,
        sum = fs[0].length - 1;
      while (split < fs.length - 1 && sum < degree / 2)
        sum += fs[split++].length - 1;
      const left = build(fs.slice(0, split)),
        right = build(fs.slice(split));
      const g = left.polynomial.map((c) => Number(c % BigInt(prime))),
        h = right.polynomial.map((c) => Number(c % BigInt(prime)));
      let inverse = P.inverseMod(P.divrem(h, g)[1], g).map(BigInt);
      let precision = BigInt(prime);
      while (precision < initialModulus) {
        precision =
          precision * precision < initialModulus
            ? precision * precision
            : initialModulus;
        const S = new ModularPolynomials(precision, work);
        inverse = S.divrem(
          S.mul(inverse, S.sub([2n], S.mul(right.polynomial, inverse))),
          S.normalize(left.polynomial)
        )[1];
      }
      return {
        left,
        right,
        polynomial:
          initialModulus === BigInt(prime)
            ? P.mul(g, h).map(BigInt)
            : R.mul(left.polynomial, right.polynomial),
        inverse,
      };
    };
    this.root = build(factors);
  }
  factors(): bigint[][] {
    const collect = (node: LiftNode): bigint[][] =>
      node.left
        ? [...collect(node.left), ...collect(node.right!)]
        : [[...node.polynomial]];
    return collect(this.root);
  }
  lift(target: readonly bigint[]): void {
    const m = this.modulus,
      next = m * m;
    const R = new ModularPolynomials(m, this.work),
      S = new ModularPolynomials(next, this.work);
    const liftNode = (node: LiftNode, f: bigint[]): LiftNode => {
      if (
        f.length !== node.polynomial.length ||
        f[f.length - 1] !== 1n ||
        R.sub(f, node.polynomial).length
      )
        throw new PolynomialInvariantError('Invalid Hensel target congruence');
      if (!node.left) return { polynomial: f };
      const g = node.left.polynomial,
        h = node.right!.polynomial;
      const error = S.sub(f, S.mul(g, h)).map((c) => {
        if (c % m)
          throw new PolynomialInvariantError(
            'Invalid Hensel product congruence'
          );
        return c / m;
      });
      const dg = R.divrem(R.mul(error, node.inverse!), g)[1];
      const [dh, remainder] = R.divrem(R.sub(error, R.mul(dg, h)), g);
      if (remainder.length)
        throw new PolynomialInvariantError('Invalid Hensel correction');
      const G = g.map((c, i) => c + m * (dg[i] ?? 0n));
      const H = h.map((c, i) => c + m * (dh[i] ?? 0n));
      // Newton inversion doubles accuracy even though the polynomial modulus
      // also changes: H*s = 1 mod (m,G), so s*(2-H*s) is its inverse mod (m^2,G).
      const inverse = S.divrem(
        S.mul(node.inverse!, S.sub([2n], S.mul(H, node.inverse!))),
        G
      )[1];
      return {
        polynomial: f,
        inverse,
        left: liftNode(node.left, G),
        right: liftNode(node.right!, H),
      };
    };
    const root = liftNode(this.root, S.normalize(target));
    this.root = root;
    this.modulus = next;
  }
}
