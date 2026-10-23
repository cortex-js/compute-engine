import {
  FieldPolynomials,
  PolynomialInvariantError,
  type ExactField,
  type PolynomialWork,
} from './exact-field.js';

export type ResidueElement = bigint[];
export type ResiduePolynomial = ResidueElement[];

/** (Z/MZ)[a]/m. Only monic polynomial division is allowed at prime powers. */
export class NumberFieldResidueRing {
  readonly degree: number;
  readonly defining: readonly bigint[];
  constructor(
    readonly modulus: bigint,
    defining: readonly bigint[],
    readonly work: PolynomialWork
  ) {
    if (modulus < 2n || defining.length < 2 || defining.at(-1) !== 1n)
      throw new RangeError(
        'Expected a monic field polynomial and modulus >= 2'
      );
    this.degree = defining.length - 1;
    this.defining = Object.freeze(defining.map((c) => this.scalar(c)));
  }
  scalar(c: bigint): bigint {
    const r = c % this.modulus;
    return r < 0n ? r + this.modulus : r;
  }
  element(a: readonly bigint[]): bigint[] {
    this.work.tick(a.length);
    const r = a.map((c) => this.scalar(c));
    for (let i = r.length - 1; i >= this.degree; i--) {
      if (!r[i]) continue;
      this.work.tick(this.degree);
      for (let j = 0; j < this.degree; j++)
        r[i - this.degree + j] = this.scalar(
          r[i - this.degree + j] - r[i] * this.defining[j]
        );
    }
    r.length = Math.min(r.length, this.degree);
    while (r.length && !r.at(-1)) r.pop();
    return r;
  }
  addElement(a: readonly bigint[], b: readonly bigint[]): bigint[] {
    this.work.tick(Math.max(a.length, b.length));
    return this.element(
      Array.from(
        { length: Math.max(a.length, b.length) },
        (_, i) => (a[i] ?? 0n) + (b[i] ?? 0n)
      )
    );
  }
  mulElement(a: readonly bigint[], b: readonly bigint[]): bigint[] {
    if (!a.length || !b.length) return [];
    const r = Array<bigint>(a.length + b.length - 1).fill(0n);
    for (let i = 0; i < a.length; i++) {
      if (!a[i]) continue;
      this.work.tick(b.length);
      for (let j = 0; j < b.length; j++) r[i + j] += a[i] * b[j];
    }
    return this.element(r);
  }
  normalize(a: readonly (readonly bigint[])[]): ResiduePolynomial {
    const r = a.map((c) => this.element(c));
    while (r.length && !r.at(-1)!.length) r.pop();
    return r;
  }
  sub(
    a: readonly (readonly bigint[])[],
    b: readonly (readonly bigint[])[]
  ): ResiduePolynomial {
    return this.normalize(
      Array.from({ length: Math.max(a.length, b.length) }, (_, i) =>
        this.addElement(
          a[i] ?? [],
          (b[i] ?? []).map((c) => -c)
        )
      )
    );
  }
  mul(
    a: readonly (readonly bigint[])[],
    b: readonly (readonly bigint[])[]
  ): ResiduePolynomial {
    if (!a.length || !b.length) return [];
    const r: ResiduePolynomial = Array.from(
      { length: a.length + b.length - 1 },
      () => []
    );
    for (let i = 0; i < a.length; i++)
      for (let j = 0; j < b.length; j++)
        r[i + j] = this.addElement(r[i + j], this.mulElement(a[i], b[j]));
    return this.normalize(r);
  }
  divrem(
    a: readonly (readonly bigint[])[],
    b: readonly (readonly bigint[])[]
  ): [ResiduePolynomial, ResiduePolynomial] {
    if (!b.length || b.at(-1)!.length !== 1 || b.at(-1)![0] !== 1n)
      throw new RangeError(
        'Prime-power polynomial division requires a monic divisor'
      );
    const r = this.normalize(a),
      q: ResiduePolynomial = Array.from(
        { length: Math.max(0, r.length - b.length + 1) },
        () => []
      );
    for (let i = q.length - 1; i >= 0; i--) {
      const c = r[i + b.length - 1];
      q[i] = c;
      for (let j = 0; j < b.length; j++)
        r[i + j] = this.addElement(
          r[i + j],
          this.mulElement(c, b[j]).map((v) => -v)
        );
    }
    return [this.normalize(q), this.normalize(r)];
  }
}

interface Node {
  polynomial: ResiduePolynomial;
  left?: Node;
  right?: Node;
  inverse?: ResiduePolynomial;
}

/** Balanced Hensel product tree over an unramified power-basis extension. */
export class NumberFieldHenselTree {
  private root: Node;
  modulus: bigint;
  readonly defining: readonly bigint[];
  constructor(
    factors: readonly number[][][],
    readonly prime: number,
    defining: readonly bigint[],
    coefficientField: ExactField<number[]>,
    readonly work: PolynomialWork
  ) {
    this.modulus = BigInt(prime);
    this.defining = Object.freeze([...defining]);
    const P = new FieldPolynomials(coefficientField, work);
    const encode = (f: number[][]) => f.map((c) => c.map(BigInt));
    const decode = (f: ResiduePolynomial) => f.map((c) => c.map(Number));
    if (
      !factors.length ||
      factors.some(
        (f) => f.length < 2 || f.at(-1)!.length !== 1 || f.at(-1)![0] !== 1
      )
    )
      throw new RangeError('Expected nonconstant monic factors');
    const build = (fs: readonly number[][][]): Node => {
      if (fs.length === 1) return { polynomial: encode(fs[0]) };
      const halfDegree = fs.reduce((s, f) => s + f.length - 1, 0) / 2;
      let split = 1,
        degree = fs[0].length - 1;
      while (split < fs.length - 1 && degree < halfDegree)
        degree += fs[split++].length - 1;
      const left = build(fs.slice(0, split)),
        right = build(fs.slice(split));
      const g = decode(left.polynomial),
        h = decode(right.polynomial);
      return {
        left,
        right,
        polynomial: encode(P.mul(g, h)),
        inverse: encode(P.inverseMod(P.divrem(h, g)[1], g)),
      };
    };
    this.root = build(factors);
  }
  factors(): ResiduePolynomial[] {
    const collect = (node: Node): ResiduePolynomial[] =>
      node.left
        ? [...collect(node.left), ...collect(node.right!)]
        : [node.polynomial.map((c) => [...c])];
    return collect(this.root);
  }
  lift(target: readonly (readonly bigint[])[]): void {
    const m = this.modulus,
      next = m * m;
    const R = new NumberFieldResidueRing(m, this.defining, this.work),
      S = new NumberFieldResidueRing(next, this.defining, this.work);
    const lift = (node: Node, f: ResiduePolynomial): Node => {
      if (
        f.length !== node.polynomial.length ||
        f.at(-1)!.length !== 1 ||
        f.at(-1)![0] !== 1n ||
        R.sub(f, node.polynomial).length
      )
        throw new PolynomialInvariantError(
          'Invalid number field Hensel target'
        );
      if (!node.left) return { polynomial: f };
      const g = node.left.polynomial,
        h = node.right!.polynomial;
      const error = S.sub(f, S.mul(g, h)).map((a) =>
        a.map((c) => {
          if (c % m)
            throw new PolynomialInvariantError(
              'Invalid number field Hensel congruence'
            );
          return c / m;
        })
      );
      const dg = R.divrem(R.mul(error, node.inverse!), g)[1];
      const [dh, remainder] = R.divrem(R.sub(error, R.mul(dg, h)), g);
      if (remainder.length)
        throw new PolynomialInvariantError(
          'Invalid number field Hensel correction'
        );
      const correct = (a: ResiduePolynomial, d: ResiduePolynomial) =>
        S.normalize(
          a.map((c, i) =>
            S.addElement(
              c,
              (d[i] ?? []).map((v) => m * v)
            )
          )
        );
      const G = correct(g, dg),
        H = correct(h, dh);
      const inverse = S.divrem(
        S.mul(node.inverse!, S.sub([[2n]], S.mul(H, node.inverse!))),
        G
      )[1];
      return {
        polynomial: f,
        inverse,
        left: lift(node.left, G),
        right: lift(node.right!, H),
      };
    };
    // Commit only after the entire tree has lifted successfully.
    const root = lift(this.root, S.normalize(target));
    this.root = root;
    this.modulus = next;
  }
}
