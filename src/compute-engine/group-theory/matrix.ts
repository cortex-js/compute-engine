import { integerRowBasis } from '../polynomial/integer-lattice.js';
import {
  integerGcd,
  PolynomialWork,
  PolynomialBudgetExceeded,
} from '../polynomial/exact-field.js';
import {
  PermutationStabilizerChain,
  PermutationChainLimitError,
} from './permutation/stabilizer-chain.js';
import {
  rationalCoefficient,
  rationalField,
  type RationalCoefficient,
} from '../polynomial/exact-field.js';
import { primeField } from '../polynomial/finite-field.js';
import {
  GroupInputError,
  GroupLimitError,
  GroupWork,
  FiniteGroupTable,
} from './finite-group.js';
import { PermutationValue, PermutationAction } from './permutation/values.js';
import { PermutationGroupValue } from './permutation/groups.js';

export type MatrixCoefficient = bigint | RationalCoefficient;
const bitLength = (x: bigint) => (x < 0n ? -x : x).toString(2).length;

/** Explicit Q or prime-field identity; rational coefficients never pass through floats. */
export class ExactMatrixField {
  readonly #characteristic: number;
  readonly #prime: ReturnType<typeof primeField> | undefined;
  constructor(characteristic = 0) {
    if (characteristic !== 0) {
      try {
        this.#prime = primeField(characteristic);
      } catch {
        throw new GroupInputError('invalid-matrix-field-characteristic');
      }
    }
    this.#characteristic = characteristic;
    Object.freeze(this);
  }
  static is(x: unknown): x is ExactMatrixField {
    return typeof x === 'object' && x !== null && #characteristic in x;
  }
  get characteristic(): number {
    return this.#characteristic;
  }
  normalize(x: MatrixCoefficient, work: GroupWork): RationalCoefficient {
    work.tick();
    if (typeof x === 'bigint') x = { numerator: x, denominator: 1n };
    if (
      !x ||
      typeof x !== 'object' ||
      typeof x.numerator !== 'bigint' ||
      typeof x.denominator !== 'bigint' ||
      x.denominator === 0n
    )
      throw new GroupInputError('invalid-exact-matrix-coefficient');
    if (bitLength(x.numerator) > 4096 || bitLength(x.denominator) > 4096)
      throw new GroupLimitError('matrix-coefficient-bit-limit');
    const q = rationalCoefficient(x.numerator, x.denominator);
    if (this.#prime) {
      const d = this.#prime.fromInteger(q.denominator);
      if (this.#prime.isZero(d))
        throw new GroupInputError('matrix-denominator-zero-in-field');
      return Object.freeze({
        numerator: this.#prime.mul(
          this.#prime.fromInteger(q.numerator),
          this.#prime.inv(d)
        ),
        denominator: 1n,
      });
    }
    return Object.freeze(q);
  }
  add(
    a: RationalCoefficient,
    b: RationalCoefficient,
    w: GroupWork
  ): RationalCoefficient {
    return this.normalize(
      this.#prime
        ? this.#prime.add(a.numerator, b.numerator)
        : rationalField.add(a, b),
      w
    );
  }
  neg(a: RationalCoefficient, w: GroupWork): RationalCoefficient {
    return this.normalize(
      this.#prime ? this.#prime.neg(a.numerator) : rationalField.neg(a),
      w
    );
  }
  mul(
    a: RationalCoefficient,
    b: RationalCoefficient,
    w: GroupWork
  ): RationalCoefficient {
    return this.normalize(
      this.#prime
        ? this.#prime.mul(a.numerator, b.numerator)
        : rationalField.mul(a, b),
      w
    );
  }
  inv(a: RationalCoefficient, w: GroupWork): RationalCoefficient {
    if (a.numerator === 0n) throw new GroupInputError('singular-matrix');
    return this.normalize(
      this.#prime ? this.#prime.inv(a.numerator) : rationalField.inv(a),
      w
    );
  }
}

/** Immutable square matrix, including singular matrices used as forms. */
export class ExactMatrixValue {
  readonly #field: ExactMatrixField;
  readonly #rows: readonly (readonly RationalCoefficient[])[];
  constructor(
    field: ExactMatrixField,
    input: readonly (readonly MatrixCoefficient[])[],
    work: GroupWork
  ) {
    if (
      !ExactMatrixField.is(field) ||
      !Array.isArray(input) ||
      input.length < 1 ||
      input.length > 32 ||
      Array.from(input).some(
        (row) => !Array.isArray(row) || row.length !== input.length
      )
    )
      throw new GroupInputError('invalid-exact-square-matrix');
    this.#field = field;
    this.#rows = Object.freeze(
      Array.from(input, (row) =>
        Object.freeze(
          Array.from(row, (x: MatrixCoefficient) => field.normalize(x, work))
        )
      )
    );
    Object.freeze(this);
  }
  static is(x: unknown): x is ExactMatrixValue {
    return typeof x === 'object' && x !== null && #rows in x;
  }
  static identity(
    field: ExactMatrixField,
    dimension: number,
    work: GroupWork
  ): ExactMatrixValue {
    if (!Number.isSafeInteger(dimension) || dimension < 1 || dimension > 32)
      throw new GroupInputError('invalid-matrix-dimension');
    return new ExactMatrixValue(
      field,
      Array.from({ length: dimension }, (_, i) =>
        Array.from({ length: dimension }, (_, j) => (i === j ? 1n : 0n))
      ),
      work
    );
  }
  get field(): ExactMatrixField {
    return this.#field;
  }
  get dimension(): number {
    return this.#rows.length;
  }
  get rows(): readonly (readonly RationalCoefficient[])[] {
    return this.#rows;
  }
  key(work: GroupWork): string {
    work.tick(this.dimension ** 2);
    return this.rows
      .map((r) => r.map((x) => `${x.numerator}/${x.denominator}`).join(','))
      .join(';');
  }
  compatible(other: ExactMatrixValue): void {
    if (
      !ExactMatrixValue.is(other) ||
      other.dimension !== this.dimension ||
      other.field.characteristic !== this.field.characteristic
    )
      throw new GroupInputError('incompatible-matrix-domain');
  }
  multiply(b: ExactMatrixValue, w: GroupWork): ExactMatrixValue {
    this.compatible(b);
    const F = this.field,
      n = this.dimension,
      z = F.normalize(0n, w);
    return new ExactMatrixValue(
      F,
      this.rows.map((row) =>
        Array.from({ length: n }, (_, j) => {
          let sum = z;
          for (let k = 0; k < n; k++)
            sum = F.add(sum, F.mul(row[k], b.rows[k][j], w), w);
          return sum;
        })
      ),
      w
    );
  }
  transpose(w: GroupWork): ExactMatrixValue {
    return new ExactMatrixValue(
      this.field,
      this.rows.map((_, i) => this.rows.map((r) => r[i])),
      w
    );
  }
  determinant(w: GroupWork): RationalCoefficient {
    const F = this.field,
      a = this.rows.map((r) => [...r]);
    let det = F.normalize(1n, w);
    for (let j = 0; j < this.dimension; j++) {
      let k = j;
      while (k < this.dimension && a[k][j].numerator === 0n) {
        w.tick();
        k++;
      }
      if (k === this.dimension) return F.normalize(0n, w);
      if (k !== j) {
        [a[k], a[j]] = [a[j], a[k]];
        det = F.neg(det, w);
      }
      det = F.mul(det, a[j][j], w);
      const inv = F.inv(a[j][j], w);
      for (let i = j + 1; i < this.dimension; i++) {
        const c = F.mul(a[i][j], inv, w);
        for (let k = j; k < this.dimension; k++)
          a[i][k] = F.add(a[i][k], F.neg(F.mul(c, a[j][k], w), w), w);
      }
    }
    return det;
  }
  inverse(w: GroupWork): ExactMatrixValue {
    const F = this.field,
      n = this.dimension,
      id = ExactMatrixValue.identity(F, n, w),
      a = this.rows.map((r, i) => [...r, ...id.rows[i]]);
    const pivots = rowReduce(F, a, n, w);
    if (pivots.length !== n) throw new GroupInputError('singular-matrix');
    return new ExactMatrixValue(
      F,
      a.map((r) => r.slice(n)),
      w
    );
  }
  power(exponent: bigint, w: GroupWork): ExactMatrixValue {
    if (typeof exponent !== 'bigint' || bitLength(exponent) > 16384)
      throw new GroupInputError('invalid-matrix-exponent');
    let a: ExactMatrixValue = this,
      result = ExactMatrixValue.identity(this.field, this.dimension, w);
    if (exponent < 0n) {
      a = a.inverse(w);
      exponent = -exponent;
    }
    while (exponent) {
      if (exponent & 1n) result = result.multiply(a, w);
      exponent >>= 1n;
      if (exponent) a = a.multiply(a, w);
    }
    return result;
  }
  act(
    vector: readonly MatrixCoefficient[],
    w: GroupWork
  ): readonly RationalCoefficient[] {
    if (!Array.isArray(vector) || vector.length !== this.dimension)
      throw new GroupInputError('invalid-matrix-vector');
    const F = this.field,
      v = vector.map((x) => F.normalize(x, w)),
      z = F.normalize(0n, w);
    return Object.freeze(
      Array.from({ length: this.dimension }, (_, j) =>
        v.reduce((s, x, i) => F.add(s, F.mul(x, this.rows[i][j], w), w), z)
      )
    );
  }
}

function rowReduce(
  F: ExactMatrixField,
  a: RationalCoefficient[][],
  columns: number,
  w: GroupWork
): number[] {
  const pivots: number[] = [];
  for (let j = 0; j < columns && pivots.length < a.length; j++) {
    const r = pivots.length;
    let k = r;
    while (k < a.length && a[k][j].numerator === 0n) {
      w.tick();
      k++;
    }
    if (k === a.length) continue;
    [a[k], a[r]] = [a[r], a[k]];
    const inv = F.inv(a[r][j], w);
    a[r] = a[r].map((x) => F.mul(x, inv, w));
    for (let i = 0; i < a.length; i++) {
      if (i === r || a[i][j].numerator === 0n) continue;
      const c = a[i][j];
      a[i] = a[i].map((x, h) => F.add(x, F.neg(F.mul(c, a[r][h], w), w), w));
    }
    pivots.push(j);
  }
  return pivots;
}

export class ExactMatrixGroup {
  readonly #generators: readonly ExactMatrixValue[];
  readonly #identity: ExactMatrixValue;
  constructor(
    field: ExactMatrixField,
    dimension: number,
    generators: readonly ExactMatrixValue[],
    w: GroupWork
  ) {
    const identity = ExactMatrixValue.identity(field, dimension, w);
    if (!Array.isArray(generators) || generators.length > 256)
      throw new GroupInputError('invalid-matrix-generators');
    for (const g of generators) {
      identity.compatible(g);
      if (g.determinant(w).numerator === 0n)
        throw new GroupInputError('singular-matrix-generator');
    }
    this.#generators = Object.freeze([...generators]);
    this.#identity = identity;
    Object.freeze(this);
  }
  static is(x: unknown): x is ExactMatrixGroup {
    return typeof x === 'object' && x !== null && #generators in x;
  }
  get generators(): readonly ExactMatrixValue[] {
    return this.#generators;
  }
  get identity(): ExactMatrixValue {
    return this.#identity;
  }
  get field(): ExactMatrixField {
    return this.identity.field;
  }
  get dimension(): number {
    return this.identity.dimension;
  }
  transpose(w: GroupWork): ExactMatrixGroup {
    return new ExactMatrixGroup(
      this.field,
      this.dimension,
      this.generators.map((g) => g.transpose(w)),
      w
    );
  }
  isSubgroupSL(w: GroupWork): boolean {
    return this.generators.every((g) => {
      const d = g.determinant(w);
      return d.numerator === d.denominator;
    });
  }
  isIntegral(w: GroupWork): boolean {
    if (this.field.characteristic !== 0) return false;
    return this.generators.every((g) => {
      w.tick(g.dimension ** 2);
      const d = g.determinant(w);
      return (
        g.rows.every((r) => r.every((x) => x.denominator === 1n)) &&
        (d.numerator === d.denominator || d.numerator === -d.denominator)
      );
    });
  }
  enumerate(maxElements: number, w: GroupWork): readonly ExactMatrixValue[] {
    if (
      !Number.isSafeInteger(maxElements) ||
      maxElements < 1 ||
      maxElements > 256
    )
      throw new GroupInputError('invalid-matrix-group-element-limit');
    const elements = [this.identity],
      seen = new Set([this.identity.key(w)]);
    for (let i = 0; i < elements.length; i++)
      for (const g of this.generators) {
        const y = elements[i].multiply(g, w),
          key = y.key(w);
        if (seen.has(key)) continue;
        if (elements.length >= maxElements)
          throw new GroupLimitError('matrix-group-element-limit');
        seen.add(key);
        elements.push(y);
      }
    return Object.freeze(elements);
  }
  finiteModel(maxElements: number, w: GroupWork) {
    const elements = this.enumerate(maxElements, w),
      index = new Map(elements.map((x, i) => [x.key(w), i]));
    const rows = elements.map((a) =>
      elements.map((b) => {
        const i = index.get(a.multiply(b, w).key(w));
        if (i === undefined) throw new Error('Incomplete matrix closure');
        return i;
      })
    );
    return Object.freeze({
      table: FiniteGroupTable.fromTable(rows, w),
      elements,
      indexOf: (x: ExactMatrixValue) => {
        this.identity.compatible(x);
        return index.get(x.key(w));
      },
    });
  }
  /** Rows act on the right. The vector action is faithful; the projective action need not be. */
  action(projective: boolean, maxPoints: number, w: GroupWork) {
    const p = this.field.characteristic,
      n = this.dimension;
    if (!p) throw new GroupInputError('matrix-action-requires-finite-field');
    if (!Number.isSafeInteger(maxPoints) || maxPoints < 1 || maxPoints > 100000)
      throw new GroupInputError('invalid-matrix-action-point-limit');
    const count = projective
      ? (BigInt(p) ** BigInt(n) - 1n) / BigInt(p - 1)
      : BigInt(p) ** BigInt(n);
    if (count > BigInt(maxPoints))
      throw new GroupLimitError('matrix-action-point-limit');
    if (count * BigInt(Math.max(n, this.generators.length)) > 1_000_000n)
      throw new GroupLimitError('matrix-action-storage-limit');
    const mutable: RationalCoefficient[][] = [];
    if (projective) {
      for (let lead = 0; lead < n; lead++) {
        const tails = p ** (n - lead - 1);
        for (let code = 0; code < tails; code++) {
          let q = code;
          const row = Array<bigint>(n).fill(0n);
          row[lead] = 1n;
          for (let j = lead + 1; j < n; j++) {
            row[j] = BigInt(q % p);
            q = Math.floor(q / p);
          }
          mutable.push(row.map((x) => this.field.normalize(x, w)));
        }
      }
    } else {
      for (let code = 0; code < Number(count); code++) {
        let q = code;
        const row: bigint[] = [];
        for (let j = 0; j < n; j++) {
          row.push(BigInt(q % p));
          q = Math.floor(q / p);
        }
        mutable.push(row.map((x) => this.field.normalize(x, w)));
      }
    }
    const key = (v: readonly RationalCoefficient[]) =>
      v.map((x) => x.numerator.toString()).join(',');
    const index = new Map(mutable.map((v, i) => [key(v), i + 1]));
    const images = this.generators.map(
      (g) =>
        new PermutationValue(
          mutable.map((v) => {
            let y = g.act(v, w);
            if (projective) {
              const lead = y.find((x) => x.numerator !== 0n);
              if (!lead)
                throw new Error('Invertible matrix killed nonzero vector');
              const inv = this.field.inv(lead, w);
              y = y.map((x) => this.field.mul(x, inv, w));
            }
            const target = index.get(key(y));
            if (target === undefined)
              throw new Error('Matrix action is not closed');
            return target;
          }),
          { check: () => w.tick() }
        )
    );
    return Object.freeze({
      group: new PermutationGroupValue(
        images,
        new PermutationAction(mutable.length),
        { check: () => w.tick() }
      ),
      points: Object.freeze(mutable.map((v) => Object.freeze(v))),
      // A full projective action has scalar kernel. Over F2 the only nonzero
      // scalar is one; over other fields this subgroup's scalar kernel is unknown.
      faithful: !projective || p === 2 ? true : undefined,
    });
  }
  /** Upper-triangular coefficient matrices of invariant homogeneous quadratic forms. */
  invariantQuadraticForms(w: GroupWork): readonly ExactMatrixValue[] {
    const n = this.dimension,
      F = this.field;
    if (n > 8) throw new GroupLimitError('matrix-form-dimension-limit');
    const pairs: [number, number][] = [];
    for (let i = 0; i < n; i++) for (let j = i; j < n; j++) pairs.push([i, j]);
    const z = F.normalize(0n, w),
      one = F.normalize(1n, w),
      equations: RationalCoefficient[][] = [];
    for (const g of this.generators)
      for (let t = 0; t < pairs.length; t++) {
        const [r, s] = pairs[t];
        const row = pairs.map(([i, j]) => {
          const a = F.mul(g.rows[r][i], g.rows[s][j], w);
          return r === s
            ? a
            : F.add(a, F.mul(g.rows[s][i], g.rows[r][j], w), w);
        });
        row[t] = F.add(row[t], F.neg(one, w), w);
        equations.push(row);
      }
    const pivots = rowReduce(F, equations, pairs.length, w),
      result: ExactMatrixValue[] = [];
    for (let j = 0; j < pairs.length; j++) {
      if (pivots.includes(j)) continue;
      const v = Array<RationalCoefficient>(pairs.length).fill(z);
      v[j] = one;
      pivots.forEach((p, i) => {
        v[p] = F.neg(equations[i][j], w);
      });
      const rows = Array.from({ length: n }, () =>
        Array<RationalCoefficient>(n).fill(z)
      );
      pairs.forEach(([i, k], t) => {
        rows[i][k] = v[t];
      });
      result.push(new ExactMatrixValue(F, rows, w));
    }
    return Object.freeze(result);
  }
  /** Basis of all B satisfying g B g^T = B; individual basis forms may be singular. */
  invariantBilinearForms(w: GroupWork): readonly ExactMatrixValue[] {
    const n = this.dimension,
      F = this.field,
      m = n * n;
    if (n > 8) throw new GroupLimitError('matrix-form-dimension-limit');
    const z = F.normalize(0n, w),
      one = F.normalize(1n, w),
      equations: RationalCoefficient[][] = [];
    for (const g of this.generators)
      for (let i = 0; i < n; i++)
        for (let j = 0; j < n; j++) {
          const row = Array.from({ length: m }, (_, t) =>
            F.mul(g.rows[i][Math.floor(t / n)], g.rows[j][t % n], w)
          );
          row[i * n + j] = F.add(row[i * n + j], F.neg(one, w), w);
          equations.push(row);
        }
    const pivots = rowReduce(F, equations, m, w),
      result: ExactMatrixValue[] = [];
    for (let j = 0; j < m; j++) {
      if (pivots.includes(j)) continue;
      const v = Array<RationalCoefficient>(m).fill(z);
      v[j] = one;
      pivots.forEach((p, i) => {
        v[p] = F.neg(equations[i][j], w);
      });
      result.push(
        new ExactMatrixValue(
          F,
          Array.from({ length: n }, (_, i) => v.slice(i * n, (i + 1) * n)),
          w
        )
      );
    }
    return Object.freeze(result);
  }
}

export function naturalLinearGroup(
  dimension: number,
  prime: number,
  special: boolean,
  w: GroupWork
): ExactMatrixGroup {
  const F = new ExactMatrixField(prime);
  if (!prime)
    throw new GroupInputError('natural-linear-group-requires-prime-field');
  const id = ExactMatrixValue.identity(F, dimension, w),
    gens: ExactMatrixValue[] = [];
  const elementary = (i: number, j: number, value: bigint) => {
    const rows = id.rows.map((r) => r.map((x) => x.numerator));
    rows[i][j] = value;
    return new ExactMatrixValue(F, rows, w);
  };
  for (let i = 0; i < dimension; i++)
    for (let j = 0; j < dimension; j++)
      if (i !== j) gens.push(elementary(i, j, 1n));
  if (!special && prime > 2) {
    const K = primeField(prime);
    let primitive = 0n;
    for (let candidate = 2; candidate < prime; candidate++) {
      let x = 1n,
        order = 0;
      do {
        w.tick();
        x = K.mul(x, BigInt(candidate));
        order++;
      } while (x !== 1n);
      if (order === prime - 1) {
        primitive = BigInt(candidate);
        break;
      }
    }
    if (!primitive)
      throw new Error('Prime field has no multiplicative generator');
    gens.push(elementary(0, 0, primitive));
  }
  return new ExactMatrixGroup(F, dimension, gens, w);
}

/** Certified order through the faithful vector action; no group-element enumeration. */
export function primeFieldMatrixGroupOrder(
  group: ExactMatrixGroup,
  maxPoints: number,
  w: GroupWork
): bigint {
  if (!ExactMatrixGroup.is(group))
    throw new GroupInputError('invalid-matrix-group');
  const action = group.action(false, maxPoints, w);
  try {
    const chain = PermutationStabilizerChain.compute(
      action.group,
      { maxWork: Math.max(0, w.limit - w.used) },
      { check: () => w.tick() }
    );
    // Nested certificates and cancellation checkpoints both consume the caller ledger.
    w.tick(chain.workUsed);
    return chain.order;
  } catch (e) {
    if (e instanceof PermutationChainLimitError)
      throw new GroupLimitError(e.code);
    throw e;
  }
}
export function isNaturalLinearGroup(
  group: ExactMatrixGroup,
  special: boolean,
  maxPoints: number,
  w: GroupWork
): boolean {
  const p = group.field.characteristic;
  if (!p)
    throw new GroupInputError(
      'natural-linear-recognition-requires-prime-field'
    );
  if (special && !group.isSubgroupSL(w)) return false;
  let expected = 1n;
  const q = BigInt(p),
    n = BigInt(group.dimension);
  for (let i = 0n; i < n; i++) {
    w.tick();
    expected *= q ** n - q ** i;
  }
  if (special) expected /= q - 1n;
  return primeFieldMatrixGroupOrder(group, maxPoints, w) === expected;
}
/** A full row lattice stabilized by a finite rational group. */
export function invariantRationalGroupLattice(
  group: ExactMatrixGroup,
  maxElements: number,
  w: GroupWork
): ExactMatrixValue {
  if (group.field.characteristic !== 0)
    throw new GroupInputError('lattice-requires-rational-matrix-group');
  const elements = group.enumerate(maxElements, w),
    rows = elements.flatMap((g) => g.rows);
  let denominator = 1n;
  for (const row of rows)
    for (const x of row) {
      w.tick();
      denominator =
        (denominator / integerGcd(denominator, x.denominator)) * x.denominator;
      if (bitLength(denominator) > 4096)
        throw new GroupLimitError('matrix-lattice-denominator-limit');
    }
  const integers = rows.map((row) =>
    row.map((x) => {
      w.tick();
      const value = x.numerator * (denominator / x.denominator);
      if (bitLength(value) > 4096)
        throw new GroupLimitError('matrix-lattice-coefficient-limit');
      return value;
    })
  );
  const nested = new PolynomialWork(Math.max(0, w.limit - w.used), () =>
      w.tick()
    ),
    basis = (() => {
      try {
        return integerRowBasis(integers, nested);
      } catch (e) {
        if (e instanceof PolynomialBudgetExceeded)
          throw new GroupLimitError(e.reason);
        throw e;
      }
    })();
  w.tick(nested.operations);
  const B = new ExactMatrixValue(
      group.field,
      basis.map((row) => row.map((numerator) => ({ numerator, denominator }))),
      w
    ),
    inverse = B.inverse(w);
  for (const g of group.generators) {
    const conjugate = B.multiply(g, w).multiply(inverse, w);
    if (
      !new ExactMatrixGroup(
        group.field,
        group.dimension,
        [conjugate],
        w
      ).isIntegral(w)
    )
      throw new Error('Invariant lattice verification failed');
  }
  return B;
}
