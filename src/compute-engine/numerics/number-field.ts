// The maximal order of a number field ℚ(θ), θ a root of a monic irreducible f ∈ ℤ[x], by
// Round 2 (Cohen, A Course in Computational Algebraic Number Theory, §§6.1–6.2), the count of
// the real roots of a polynomial, and the invariants of an element (characteristic and minimal
// polynomial, discriminant). The field arithmetic is the engine's `RationalNumberField`; an
// order is a ℤ-basis in the power basis of θ over a common denominator, in echelon form. The
// long loops check the engine's deadline, which throws.

import {
  checkDeadlineEvery,
  type DeadlineFrame,
} from '../../common/interruptible.js';
import {
  FieldPolynomials,
  integerGcd,
  PolynomialWork,
  rationalCoefficient as q,
  rationalField as Q,
  type RationalCoefficient,
} from '../polynomial/exact-field.js';
import { integerRowBasis } from '../polynomial/integer-lattice.js';
import {
  numberFieldPolynomialNorm,
  type NumberFieldElement,
  type RationalNumberField,
} from '../polynomial/number-field.js';
import { bigPrimeFactors, modPow } from './primes.js';

/** A polynomial over ℤ, constant term first. */
export type Poly = readonly bigint[];

/** An order: the elements `rows[i] / den` (power-basis coordinates), upper triangular. */
export interface Order {
  readonly K: RationalNumberField;
  readonly rows: readonly (readonly bigint[])[];
  readonly den: bigint;
}

/** Calls of a loop's check between two deadline tests. */
const DEADLINE_MASK = 0x3f;

/** The work one exact computation in a field may take. */
const WORK_LIMIT = 50_000_000;

const workOf = (frame: DeadlineFrame | undefined): PolynomialWork =>
  new PolynomialWork(WORK_LIMIT, () =>
    checkDeadlineEvery(frame, DEADLINE_MASK)
  );

// --- integers ---------------------------------------------------------------------------

const abs = (a: bigint): bigint => (a < 0n ? -a : a);

const gcd = integerGcd;

const mod = (a: bigint, m: bigint): bigint => ((a % m) + m) % m;

const floorDiv = (a: bigint, b: bigint): bigint => {
  const q = a / b;
  return a % b !== 0n && a < 0n !== b < 0n ? q - 1n : q;
};

// --- polynomials over ℤ -------------------------------------------------------------------

export const degree = (a: Poly): number => {
  let d = a.length - 1;
  while (d >= 0 && a[d] === 0n) d--;
  return d;
};

const trim = (a: bigint[]): bigint[] => a.slice(0, degree(a) + 1);

const derivative = (a: Poly): bigint[] =>
  a.slice(1).map((c, i) => c * BigInt(i + 1));

const content = (a: Poly): bigint => a.reduce((g, c) => gcd(g, c), 0n);

const P = new FieldPolynomials(Q);

const toQ = (a: Poly) => a.map((c) => q(c));

/** Whether `f` has no repeated root: gcd(f, f′) is constant. */
export const isSquarefree = (f: Poly): boolean =>
  P.gcd(toQ(f), toQ(derivative(f))).length <= 1;

/** The real roots of `f` (squarefree), counted by its Sturm sequence. */
export function realRootCount(f: Poly): number {
  const seq: bigint[][] = [trim([...f]), trim(derivative(f))];
  while (degree(seq.at(-1)!) > 0) {
    const [a, b] = [seq.at(-2)!, seq.at(-1)!];
    // −prem(a, b), scaled by |lc(b)|^(δ+1) so signs survive, then by its content.
    const r = [...a];
    const lc = b[degree(b)]!;
    const scale = abs(lc);
    for (let k = degree(r); k >= degree(b); k = degree(r)) {
      const c = r[k]!;
      for (let i = 0; i < r.length; i++) r[i]! *= scale;
      const q = (c * scale) / lc;
      for (let j = 0; j <= degree(b); j++) r[k - degree(b) + j]! -= q * b[j]!;
      if (degree(r) < 0) break;
    }
    const rem = trim(r).map((c) => -c);
    if (rem.length === 0) break;
    const g = content(rem);
    seq.push(rem.map((c) => c / g));
  }
  const sign = (p: bigint[], atPlus: boolean): number => {
    const lc = p[degree(p)]!;
    const s = lc > 0n ? 1 : -1;
    return atPlus || degree(p) % 2 === 0 ? s : -s;
  };
  const changes = (atPlus: boolean): number => {
    let count = 0;
    let last = 0;
    for (const p of seq) {
      if (degree(p) < 0) continue;
      const s = sign(p, atPlus);
      if (last !== 0 && s !== last) count++;
      last = s;
    }
    return count;
  };
  return changes(false) - changes(true);
}

// --- elements ------------------------------------------------------------------------------

/** The defining polynomial of `K` over ℤ: `K` comes from a monic integer polynomial. */
export function definingPolynomial(K: RationalNumberField): Poly {
  return K.definingPolynomial.map((c) => {
    if (c.denominator !== 1n)
      throw new RangeError('The defining polynomial is not over the integers');
    return c.numerator;
  });
}

/** `x` as an integer vector on the power basis over a common denominator. */
function integerForm(
  K: RationalNumberField,
  x: NumberFieldElement
): { num: bigint[]; den: bigint } {
  const den = x.coefficients.reduce(
    (l, c) => (l * c.denominator) / gcd(l, c.denominator),
    1n
  );
  return {
    num: Array.from({ length: K.degree }, (_, i) => {
      const c = x.coefficients[i];
      return c === undefined ? 0n : c.numerator * (den / c.denominator);
    }),
    den,
  };
}

const fromIntegerForm = (
  K: RationalNumberField,
  num: readonly bigint[],
  den: bigint
): NumberFieldElement => K.element(num.map((c) => q(c, den)));

/** The characteristic polynomial of `x` over ℚ: the norm of t − x, monic of degree `[K : ℚ]`. */
export const characteristicPolynomial = (
  K: RationalNumberField,
  x: NumberFieldElement,
  frame?: DeadlineFrame
): RationalCoefficient[] =>
  numberFieldPolynomialNorm(K, [K.neg(x), K.one], workOf(frame));

/** Whether `x` is an algebraic integer: its characteristic polynomial is integral. */
export const isIntegral = (
  K: RationalNumberField,
  x: NumberFieldElement,
  frame?: DeadlineFrame
): boolean =>
  characteristicPolynomial(K, x, frame).every((c) => c.denominator === 1n);

/**
 * The minimal polynomial of `x` over ℚ, primitive with positive leading coefficient: the
 * characteristic polynomial is a power of it, so it is the squarefree part.
 */
export function minimalPolynomial(
  K: RationalNumberField,
  x: NumberFieldElement,
  frame?: DeadlineFrame
): bigint[] {
  const [factor] = P.squareFree(characteristicPolynomial(K, x, frame));
  const a = factor!.polynomial;
  const den = a.reduce(
    (l, c) => (l * c.denominator) / gcd(l, c.denominator),
    1n
  );
  const ints = a.map((c) => (c.numerator * den) / c.denominator);
  const g = content(ints);
  const sign = ints[ints.length - 1]! < 0n ? -1n : 1n;
  return ints.map((c) => (sign * c) / g);
}

/** disc(f) = (−1)^(n(n−1)/2) · N(f′(θ)) for the monic defining polynomial f of `K`. */
export function polynomialDiscriminant(
  K: RationalNumberField,
  frame?: DeadlineFrame
): bigint {
  const n = K.degree;
  const f = definingPolynomial(K);
  const slope = K.element(derivative(f).map((c) => q(c)));
  const [norm] = numberFieldPolynomialNorm(K, [slope], workOf(frame));
  if (norm === undefined || norm.denominator !== 1n)
    throw new RangeError('The discriminant is not a nonzero integer');
  return ((n * (n - 1)) / 2) % 2 === 1 ? -norm.numerator : norm.numerator;
}

// --- orders ---------------------------------------------------------------------------------

/** ℤ[θ]. */
export const equationOrder = (K: RationalNumberField): Order => ({
  K,
  rows: Array.from({ length: K.degree }, (_, i) =>
    Array.from({ length: K.degree }, (_, j) => (i === j ? 1n : 0n))
  ),
  den: 1n,
});

/** The order the elements `vectors / den` span over ℤ, in lowest terms. */
function orderSpanned(
  K: RationalNumberField,
  vectors: readonly (readonly bigint[])[],
  den: bigint,
  work: PolynomialWork
): Order {
  const rows = integerRowBasis(vectors, work);
  if (rows.length !== K.degree)
    throw new RangeError("The vectors don't span a full lattice");
  const g = rows.flat().reduce((x, c) => gcd(x, c), den);
  return { K, rows: rows.map((r) => r.map((c) => c / g)), den: den / g };
}

/**
 * The basis of the lattice `rows` span (of full rank) in Hermite normal form: upper triangular,
 * pivots positive, the entries above a pivot reduced to `[0, pivot)`.
 */
export function hermiteBasis(
  rows: readonly (readonly bigint[])[],
  frame?: DeadlineFrame
): bigint[][] {
  const basis = integerRowBasis(rows, workOf(frame));
  for (let i = 1; i < basis.length; i++)
    for (let k = 0; k < i; k++) {
      const quotient = floorDiv(basis[k]![i]!, basis[i]![i]!);
      if (quotient !== 0n)
        basis[k] = basis[k]!.map((c, j) => c - quotient * basis[i]![j]!);
    }
  return basis;
}

/** [O : ℤ[θ]] = denⁿ / det(rows). */
export function orderIndex(o: Order): bigint {
  const n = o.rows.length;
  const det = o.rows.reduce((p, r, i) => p * r[i]!, 1n);
  return o.den ** BigInt(n) / det;
}

export function orderDiscriminant(o: Order, frame?: DeadlineFrame): bigint {
  const index = orderIndex(o);
  return polynomialDiscriminant(o.K, frame) / (index * index);
}

/** The basis of `{v ∈ 𝔽ₚ^m : v·M = 0}` for the m×k matrix `M`, by row reduction of [M | I]. */
function leftKernelModP(
  m: readonly (readonly bigint[])[],
  p: bigint,
  frame: DeadlineFrame | undefined
): bigint[][] {
  const rows = m.length;
  const cols = m[0]?.length ?? 0;
  const a = m.map((r, i) => [
    ...r.map((c) => mod(c, p)),
    ...Array.from({ length: rows }, (_, j) => (i === j ? 1n : 0n)),
  ]);
  let pivot = 0;
  for (let c = 0; c < cols && pivot < rows; c++) {
    const r = a.findIndex((row, i) => i >= pivot && row[c] !== 0n);
    if (r < 0) continue;
    [a[pivot], a[r]] = [a[r]!, a[pivot]!];
    const inverse = modPow(a[pivot]![c]!, p - 2n, p);
    a[pivot] = a[pivot]!.map((x) => (x * inverse) % p);
    for (let i = 0; i < rows; i++) {
      checkDeadlineEvery(frame, DEADLINE_MASK);
      const factor = a[i]![c]!;
      if (i === pivot || factor === 0n) continue;
      a[i] = a[i]!.map((x, k) => mod(x - factor * a[pivot]![k]!, p));
    }
    pivot++;
  }
  return a.slice(pivot).map((row) => row.slice(cols));
}

/** Whether `f` is Eisenstein at `p`, which makes ℤ[θ] p-maximal. */
const eisensteinAt = (f: Poly, p: bigint): boolean =>
  f.slice(0, -1).every((c) => c % p === 0n) && f[0]! % (p * p) !== 0n;

/**
 * One round of Pohst–Zassenhaus (Cohen, Algorithm 6.1.8): O enlarged by (1/p)·U, where
 * U/pO is the kernel of the maps by which O's elements multiply the p-radical I_p into pI_p.
 * `O` is p-maximal exactly when that kernel is zero, and then `undefined` is returned.
 */
function roundTwoStep(
  o: Order,
  p: bigint,
  frame: DeadlineFrame | undefined
): Order | undefined {
  const n = o.rows.length;
  const work = workOf(frame);
  const basis = o.rows.map((r) => fromIntegerForm(o.K, r, o.den));
  // ωᵢ·ωⱼ on the basis, exactly: the structure constants of O.
  const T = basis.map((a) =>
    basis.map((b) => {
      checkDeadlineEvery(frame, DEADLINE_MASK);
      return coordinates(o, o.K.mul(a, b))!;
    })
  );
  // The product in O/pO, coordinates mod p.
  const times = (a: readonly bigint[], b: readonly bigint[]): bigint[] => {
    const out: bigint[] = Array.from({ length: n }, () => 0n);
    for (let i = 0; i < n; i++) {
      if (a[i] === 0n) continue;
      for (let j = 0; j < n; j++) {
        if (b[j] === 0n) continue;
        checkDeadlineEvery(frame, DEADLINE_MASK);
        const w = a[i]! * b[j]!;
        for (let k = 0; k < n; k++) out[k] = (out[k]! + w * T[i]![j]![k]!) % p;
      }
    }
    return out;
  };
  const one = (i: number): bigint[] =>
    Array.from({ length: n }, (_, k) => (k === i ? 1n : 0n));
  // The Frobenius x ↦ xᵖ is 𝔽ₚ-linear on O/pO: row i is ωᵢᵖ.
  const frobenius = Array.from({ length: n }, (_, i) => {
    let result: bigint[] | undefined;
    let square = one(i).map((c) => c % p);
    for (let e = p; e > 0n; e >>= 1n) {
      if (e & 1n)
        result = result === undefined ? square : times(result, square);
      if (e > 1n) square = times(square, square);
    }
    return result!;
  });
  const product = (
    a: readonly (readonly bigint[])[],
    b: readonly (readonly bigint[])[]
  ): bigint[][] =>
    a.map((row) =>
      Array.from({ length: n }, (_, k) =>
        row.reduce((s, x, j) => (s + x * b[j]![k]!) % p, 0n)
      )
    );
  // The p-radical is the kernel of xᵖʲ for the least j with pʲ ≥ n.
  let power = frobenius;
  for (let q = p; q < BigInt(n); q *= p) power = product(power, frobenius);
  const radical = leftKernelModP(power, p, frame);
  // I_p's ℤ-basis: pO and the lifted radical, upper triangular.
  const identity = Array.from({ length: n }, (_, i) =>
    one(i).map((c) => c * p)
  );
  const ip = integerRowBasis([...identity, ...radical], work);
  // x·αⱼ ∈ pI_p for x = Σ xᵢωᵢ: the coordinates of ωᵢ·αⱼ on (αₖ) must vanish mod p.
  const onIp = (v: readonly bigint[]): bigint[] => {
    const rest = [...v];
    return ip.map((row, k) => {
      const c = rest[k]! / row[k]!;
      for (let t = k; t < n; t++) rest[t]! -= c * row[t]!;
      return c;
    });
  };
  const conditions = basis.map((_, i) =>
    ip.flatMap((alpha) => {
      checkDeadlineEvery(frame, DEADLINE_MASK);
      const v = Array.from({ length: n }, (_, k) =>
        alpha.reduce((s, ak, t) => s + ak * T[i]![t]![k]!, 0n)
      );
      return onIp(v);
    })
  );
  const kernel = leftKernelModP(conditions, p, frame);
  if (kernel.length === 0) return undefined;
  const vectors = [
    ...o.rows.map((r) => r.map((c) => c * p)),
    ...kernel.map((w) =>
      Array.from({ length: n }, (_, k) =>
        w.reduce((s, wi, i) => s + wi * o.rows[i]![k]!, 0n)
      )
    ),
  ];
  return orderSpanned(o.K, vectors, o.den * p, work);
}

/**
 * O enlarged to be p-maximal: Round 2 until it stops. Where f is Eisenstein at p, ℤ[θ] is
 * p-maximal, and so is O, whose index over it is prime to p.
 */
function pMaximal(
  o: Order,
  p: bigint,
  frame: DeadlineFrame | undefined
): Order {
  if (eisensteinAt(definingPolynomial(o.K), p)) return o;
  for (;;) {
    const next = roundTwoStep(o, p, frame);
    if (next === undefined) return o;
    o = next;
  }
}

/** The maximal order O_K. The deadline of `frame` interrupts the factoring and the rounds. */
export function maximalOrder(
  K: RationalNumberField,
  frame?: DeadlineFrame
): Order {
  const disc = polynomialDiscriminant(K, frame);
  let o = equationOrder(K);
  for (const [p, e] of bigPrimeFactors(abs(disc), frame)) {
    if (e < 2) continue;
    o = pMaximal(o, p, frame);
  }
  return o;
}

/** The coordinates of `x` on the order's basis, or `undefined` when x isn't in it. */
export function coordinates(
  o: Order,
  x: NumberFieldElement
): bigint[] | undefined {
  const n = o.rows.length;
  const { num, den } = integerForm(o.K, x);
  // Solve c·rows = num·(o.den / den), back substitution on the upper triangular rows.
  const out: bigint[] = Array.from({ length: n }, () => 0n);
  const rest = num.map((c) => c * o.den);
  for (let j = 0; j < n; j++) {
    const pivot = o.rows[j]![j]! * den;
    if (rest[j]! % pivot !== 0n) return undefined;
    const c = rest[j]! / pivot;
    out[j] = c;
    for (let k = j; k < n; k++) rest[k]! -= c * o.rows[j]![k]! * den;
  }
  return out;
}
