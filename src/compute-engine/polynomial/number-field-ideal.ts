import {
  PolynomialInvariantError,
  type PolynomialWork,
  rationalCoefficient as q,
  rationalField as Q,
} from './exact-field.js';
import { reduceIntegerLattice, integerGramSchmidt } from './integer-lattice.js';
import { NumberFieldResidueRing } from './number-field-hensel.js';

const abs = (a: bigint) => (a < 0n ? -a : a);
const nearest = (n: bigint, d: bigint) =>
  n < 0n ? -((-2n * n + d) / (2n * d)) : (2n * n + d) / (2n * d);

/**
 * Power-basis lattice of the ideal (M, h(alpha)), where h lifts one
 * unramified irreducible factor of the defining polynomial modulo p.
 * No maximal-order or floating-point embedding computation is required.
 */
export class NumberFieldIdealRecovery {
  readonly basis: bigint[][];
  /** Columns of M B^-1, integral because M Z^d is contained in the ideal. */
  readonly forms: bigint[][];
  private readonly ring: NumberFieldResidueRing;
  constructor(
    readonly degree: number,
    readonly modulus: bigint,
    defining: readonly bigint[],
    readonly work: PolynomialWork
  ) {
    this.ring = new NumberFieldResidueRing(modulus, defining, work);
    const e = defining.length - 1;
    if (e >= degree)
      throw new RangeError('Expected a proper residue extension');
    const rows = Array.from({ length: degree }, (_, j) => {
      const row = Array<bigint>(degree).fill(0n);
      if (j < e) row[j] = modulus;
      else {
        row[j] = 1n;
        const residue = this.ring.element(row);
        for (let i = 0; i < e; i++) row[i] = -(residue[i] ?? 0n);
      }
      return row;
    });
    this.basis = reduceIntegerLattice(rows, work).basis;
    const { mu, norms } = integerGramSchmidt(this.basis, work);
    const orth = this.basis.map((row) => row.map((v) => q(v)));
    for (let i = 0; i < degree; i++)
      for (let j = 0; j < i; j++) {
        work.tick(degree);
        orth[i] = orth[i].map((v, k) =>
          Q.add(v, Q.neg(Q.mul(mu[i][j], orth[j][k])))
        );
      }
    const dual = orth.map((row, i) =>
      row.map((v) => Q.mul(v, Q.inv(norms[i])))
    );
    for (let i = degree - 1; i >= 0; i--)
      for (let j = i + 1; j < degree; j++) {
        work.tick(degree);
        dual[i] = dual[i].map((v, k) =>
          Q.add(v, Q.neg(Q.mul(mu[j][i], dual[j][k])))
        );
      }
    this.forms = dual.map((row) =>
      row.map((v) => {
        const a = v.numerator * modulus;
        if (a % v.denominator)
          throw new PolynomialInvariantError('Nonintegral ideal dual');
        return a / v.denominator;
      })
    );
  }
  /** Every coordinate-bounded true coefficient lies inside B's fundamental domain. */
  certified(bound: bigint): boolean {
    return this.forms.every(
      (row) => 2n * bound * row.reduce((s, c) => s + abs(c), 0n) < this.modulus
    );
  }
  recover(residue: readonly bigint[], denominator: bigint): bigint[] {
    const a = this.ring.element(residue.map((v) => v * denominator));
    const result = Array.from({ length: this.degree }, (_, j) => a[j] ?? 0n);
    for (let i = 0; i < this.degree; i++) {
      this.work.tick(this.degree);
      const t = nearest(
        this.forms[i].reduce((s, c, j) => s + c * (a[j] ?? 0n), 0n),
        this.modulus
      );
      for (let j = 0; j < this.degree; j++) result[j] -= t * this.basis[i][j];
    }
    return result;
  }
}
