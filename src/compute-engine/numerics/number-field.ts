// Number fields ℚ(θ), θ a root of a monic irreducible f ∈ ℤ[x], and their orders, exactly in
// bigints (Cohen, A Course in Computational Algebraic Number Theory, §§4.5–4.7, 6.1–6.2).
// An element is its coordinates on the power basis 1, θ, …, θⁿ⁻¹ over a common denominator; an
// order is a ℤ-basis in that form, kept in Hermite normal form. The caller certifies that f is
// irreducible (`certifiedField`). The long loops check the engine's deadline, which throws.

import {
  checkDeadlineEvery,
  type DeadlineFrame,
} from '../../common/interruptible.js';
import {
  FieldPolynomials,
  integerGcd,
  rationalCoefficient as q,
  rationalField as Q,
} from '../polynomial/exact-field.js';
import { bigPrimeFactors, modPow } from './primes.js';

/** A polynomial over ℤ, constant term first. */
export type Poly = readonly bigint[];

/** An element of ℚ(θ): `num / den` on the power basis, `den > 0`, in lowest terms. */
export interface FieldElement {
  readonly num: readonly bigint[];
  readonly den: bigint;
}

/** An order: the elements `rows[i] / den` (power-basis coordinates), upper triangular. */
export interface Order {
  readonly f: Poly;
  readonly rows: readonly (readonly bigint[])[];
  readonly den: bigint;
}

// --- integers ---------------------------------------------------------------------------

const abs = (a: bigint): bigint => (a < 0n ? -a : a);

const gcd = integerGcd;

const mod = (a: bigint, m: bigint): bigint => ((a % m) + m) % m;

// --- polynomials over ℤ -------------------------------------------------------------------

export const degree = (a: Poly): number => {
  let d = a.length - 1;
  while (d >= 0 && a[d] === 0n) d--;
  return d;
};

const trim = (a: bigint[]): bigint[] => a.slice(0, degree(a) + 1);

function polyMul(a: Poly, b: Poly): bigint[] {
  if (a.length === 0 || b.length === 0) return [];
  const out = Array.from({ length: a.length + b.length - 1 }, () => 0n);
  for (let i = 0; i < a.length; i++)
    for (let j = 0; j < b.length; j++) out[i + j]! += a[i]! * b[j]!;
  return out;
}

/** `a mod f`, f monic: exact over ℤ. Length `deg f`. */
function reduceMonic(a: readonly bigint[], f: Poly): bigint[] {
  const n = f.length - 1;
  const r = [...a];
  for (let k = r.length - 1; k >= n; k--) {
    const c = r[k]!;
    if (c === 0n) continue;
    for (let j = 0; j <= n; j++) r[k - n + j]! -= c * f[j]!;
  }
  return Array.from({ length: n }, (_, i) => r[i] ?? 0n);
}

const derivative = (a: Poly): bigint[] =>
  a.slice(1).map((c, i) => c * BigInt(i + 1));

const content = (a: Poly): bigint => a.reduce((g, c) => gcd(g, c), 0n);

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

// --- matrices -----------------------------------------------------------------------------

type Matrix = bigint[][];

/** Determinant by Bareiss's fraction-free elimination. */
export function determinant(m: readonly (readonly bigint[])[]): bigint {
  const n = m.length;
  const a = m.map((r) => [...r]);
  let sign = 1n;
  let prev = 1n;
  for (let k = 0; k < n - 1; k++) {
    if (a[k]![k] === 0n) {
      const swap = a.findIndex((r, i) => i > k && r[k] !== 0n);
      if (swap < 0) return 0n;
      [a[k], a[swap]] = [a[swap]!, a[k]!];
      sign = -sign;
    }
    for (let i = k + 1; i < n; i++) {
      for (let j = k + 1; j < n; j++)
        a[i]![j] = (a[i]![j]! * a[k]![k]! - a[i]![k]! * a[k]![j]!) / prev;
    }
    prev = a[k]![k]!;
  }
  return sign * (n === 0 ? 1n : a[n - 1]![n - 1]!);
}

/** The Hermite normal form of the lattice `rows` span (rank `n`): upper triangular, pivots positive. */
export function hermite(
  rows: readonly (readonly bigint[])[],
  n: number
): Matrix {
  const a = rows.map((r) => [...r]).filter((r) => r.some((c) => c !== 0n));
  const out: Matrix = [];
  for (let col = 0; col < n; col++) {
    // Euclid down the column, until one row is left with a nonzero entry there.
    for (;;) {
      const live = a.filter((r) => r[col] !== 0n);
      if (live.length <= 1) break;
      live.sort((x, y) => (abs(x[col]!) < abs(y[col]!) ? -1 : 1));
      const pivot = live[0]!;
      for (const r of live.slice(1)) {
        const q = r[col]! / pivot[col]!;
        for (let j = 0; j < n; j++) r[j]! -= q * pivot[j]!;
      }
    }
    const at = a.findIndex((r) => r[col] !== 0n);
    if (at < 0) throw new Error("hermite: the rows don't span a full lattice");
    const pivot = a.splice(at, 1)[0]!;
    if (pivot[col]! < 0n) for (let j = 0; j < n; j++) pivot[j] = -pivot[j]!;
    out.push(pivot);
  }
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < i; k++) {
      const q = floorDiv(out[k]![i]!, out[i]![i]!);
      if (q !== 0n) for (let j = 0; j < n; j++) out[k]![j]! -= q * out[i]![j]!;
    }
  }
  return out;
}

const floorDiv = (a: bigint, b: bigint): bigint => {
  const q = a / b;
  return a % b !== 0n && a < 0n !== b < 0n ? q - 1n : q;
};

/** The characteristic polynomial of an integer matrix (Faddeev–LeVerrier; each division exact). */
export function characteristicPolynomial(
  a: readonly (readonly bigint[])[]
): bigint[] {
  const n = a.length;
  const c: bigint[] = Array.from({ length: n + 1 }, () => 0n);
  c[n] = 1n;
  let m: Matrix = Array.from({ length: n }, () =>
    Array.from({ length: n }, () => 0n)
  );
  for (let k = 1; k <= n; k++) {
    const next: Matrix = Array.from({ length: n }, (_, i) =>
      Array.from({ length: n }, (_, j) => {
        let s = i === j ? c[n - k + 1]! : 0n;
        for (let l = 0; l < n; l++) s += a[i]![l]! * m[l]![j]!;
        return s;
      })
    );
    m = next;
    let trace = 0n;
    for (let i = 0; i < n; i++)
      for (let l = 0; l < n; l++) trace += a[i]![l]! * m[l]![i]!;
    c[n - k] = -trace / BigInt(k);
  }
  return c;
}

// --- the field ------------------------------------------------------------------------------

/** An element in lowest terms. */
export function element(num: readonly bigint[], den = 1n): FieldElement {
  if (den < 0n) [num, den] = [num.map((c) => -c), -den];
  const g = num.reduce((x, c) => gcd(x, c), den);
  return g === 1n || g === 0n
    ? { num: [...num], den }
    : { num: num.map((c) => c / g), den: den / g };
}

export function multiply(
  f: Poly,
  a: FieldElement,
  b: FieldElement
): FieldElement {
  return element(reduceMonic(polyMul(a.num, b.num), f), a.den * b.den);
}

/** Multiplication by `num` (an integer vector) on the power basis: row i is θⁱ·num. */
function multiplicationMatrix(f: Poly, num: readonly bigint[]): Matrix {
  const n = f.length - 1;
  const rows: Matrix = [];
  let row = reduceMonic(num, f);
  for (let i = 0; i < n; i++) {
    rows.push(row);
    row = reduceMonic([0n, ...row], f);
  }
  return rows;
}

/** The characteristic polynomial of `x` over ℚ, as numerators over `x.den^(n−k)`. */
const charpolyNumerators = (f: Poly, x: FieldElement): bigint[] =>
  characteristicPolynomial(multiplicationMatrix(f, x.num));

/** Whether `x` is an algebraic integer: its characteristic polynomial is integral. */
export function isIntegral(f: Poly, x: FieldElement): boolean {
  const n = f.length - 1;
  const c = charpolyNumerators(f, x);
  for (let k = 0; k < n; k++)
    if (c[k]! % x.den ** BigInt(n - k) !== 0n) return false;
  return true;
}

/** N(x) = (−1)ⁿ·charpoly(0), as a fraction. */
export function norm(f: Poly, x: FieldElement): { num: bigint; den: bigint } {
  const n = f.length - 1;
  const c0 = charpolyNumerators(f, x)[0]!;
  return reduced(n % 2 === 0 ? c0 : -c0, x.den ** BigInt(n));
}

/** Tr(x) = −(coefficient of tⁿ⁻¹). */
export function trace(f: Poly, x: FieldElement): { num: bigint; den: bigint } {
  const n = f.length - 1;
  return reduced(-charpolyNumerators(f, x)[n - 1]!, x.den);
}

const reduced = (num: bigint, den: bigint): { num: bigint; den: bigint } => {
  const g = gcd(num, den) || 1n;
  return { num: num / g, den: den / g };
};

const P = new FieldPolynomials(Q);

const toQ = (a: Poly) => a.map((c) => q(c));

/** A rational polynomial scaled to a primitive integer one, positive leading coefficient. */
function primitive(
  a: readonly { numerator: bigint; denominator: bigint }[]
): bigint[] {
  const den = a.reduce(
    (l, c) => (l * c.denominator) / gcd(l, c.denominator),
    1n
  );
  const ints = a.map((c) => (c.numerator * den) / c.denominator);
  const g = content(ints);
  const sign = ints[ints.length - 1]! < 0n ? -1n : 1n;
  return ints.map((c) => (sign * c) / g);
}

/**
 * The minimal polynomial of `x` over ℚ, primitive with positive leading coefficient: the
 * characteristic polynomial is a power of it, so it is the squarefree part.
 */
export function minimalPolynomial(f: Poly, x: FieldElement): bigint[] {
  const c = charpolyNumerators(f, x);
  // charpoly of x, scaled to integers: Σ c_k·den^k tᵏ (multiply through by denⁿ).
  const chi = c.map((ck, k) => ck * x.den ** BigInt(k));
  const [factor] = P.squareFree(toQ(chi));
  return primitive(factor!.polynomial);
}

// --- discriminants --------------------------------------------------------------------------

/** Whether `f` has no repeated root: gcd(f, f′) is constant. */
export const isSquarefree = (f: Poly): boolean =>
  P.gcd(toQ(f), toQ(derivative(f))).length <= 1;

/** disc(f) = det(Tr θ^(i+j)), the traces Newton's power sums of f's roots. */
export function polynomialDiscriminant(f: Poly): bigint {
  const n = f.length - 1;
  const s: bigint[] = [BigInt(n)];
  // Newton: s_k = −k·a_{n−k} − Σ_{i=1}^{k−1} a_{n−i}·s_{k−i}, f monic, aᵢ its coefficients.
  for (let k = 1; k <= 2 * n - 2; k++) {
    let v = k <= n ? -BigInt(k) * f[n - k]! : 0n;
    for (let i = 1; i <= Math.min(k - 1, n); i++) v -= f[n - i]! * s[k - i]!;
    s.push(v);
  }
  return determinant(
    Array.from({ length: n }, (_, i) =>
      Array.from({ length: n }, (_, j) => s[i + j]!)
    )
  );
}

// --- orders ---------------------------------------------------------------------------------

/** ℤ[θ]. */
export const equationOrder = (f: Poly): Order => {
  const n = f.length - 1;
  return {
    f,
    rows: Array.from({ length: n }, (_, i) =>
      Array.from({ length: n }, (_, j) => (i === j ? 1n : 0n))
    ),
    den: 1n,
  };
};

/** ℤ[y], y integral and generating the field: the span of 1, y, …, yⁿ⁻¹. */
export function monogenicOrder(f: Poly, y: FieldElement): Order {
  const n = f.length - 1;
  const powers: FieldElement[] = [
    element([1n, ...Array.from({ length: n - 1 }, () => 0n)]),
  ];
  for (let k = 1; k < n; k++) powers.push(multiply(f, powers[k - 1]!, y));
  const den = powers.reduce((l, x) => (l * x.den) / gcd(l, x.den), 1n);
  return orderSpanned(
    f,
    powers.map((x) => x.num.map((c) => c * (den / x.den))),
    den
  );
}

/** The order the elements `vectors / den` span over ℤ, in lowest terms. */
function orderSpanned(
  f: Poly,
  vectors: readonly (readonly bigint[])[],
  den: bigint
): Order {
  const n = f.length - 1;
  const h = hermite(vectors, n);
  const g = h.flat().reduce((x, c) => gcd(x, c), den);
  return { f, rows: h.map((r) => r.map((c) => c / g)), den: den / g };
}

/** [O : ℤ[θ]] = denⁿ / det(rows). */
export function orderIndex(o: Order): bigint {
  const n = o.rows.length;
  const det = o.rows.reduce((p, r, i) => p * r[i]!, 1n);
  return o.den ** BigInt(n) / det;
}

export function orderDiscriminant(o: Order): bigint {
  const index = orderIndex(o);
  return polynomialDiscriminant(o.f) / (index * index);
}

/** Calls of a loop's check between two deadline tests. */
const DEADLINE_MASK = 0x3f;

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
  const basis = o.rows.map((r) => element(r, o.den));
  // ωᵢ·ωⱼ on the basis, exactly: the structure constants of O.
  const T = basis.map((a) =>
    basis.map((b) => {
      checkDeadlineEvery(frame, DEADLINE_MASK);
      return coordinates(o, multiply(o.f, a, b))!;
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
  // I_p's ℤ-basis: pO and the lifted radical, in Hermite form (upper triangular).
  const identity = Array.from({ length: n }, (_, i) =>
    one(i).map((c) => c * p)
  );
  const ip = hermite([...identity, ...radical], n);
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
  return orderSpanned(o.f, vectors, o.den * p);
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
  if (eisensteinAt(o.f, p)) return o;
  for (;;) {
    const next = roundTwoStep(o, p, frame);
    if (next === undefined) return o;
    o = next;
  }
}

/** The maximal order O_K. The deadline of `frame` interrupts the factoring and the rounds. */
export function maximalOrder(f: Poly, frame?: DeadlineFrame): Order {
  const disc = polynomialDiscriminant(f);
  let o = equationOrder(f);
  for (const [p, e] of bigPrimeFactors(abs(disc), frame)) {
    if (e < 2) continue;
    o = pMaximal(o, p, frame);
  }
  return o;
}

/** The coordinates of `x` on the order's basis, or `undefined` when x isn't in it. */
export function coordinates(o: Order, x: FieldElement): bigint[] | undefined {
  const n = o.rows.length;
  // Solve c·rows = x.num·(o.den / x.den), back substitution on the upper triangular rows.
  const target = x.num.map((c) => c * o.den);
  const out: bigint[] = Array.from({ length: n }, () => 0n);
  const rest = [...target];
  for (let j = 0; j < n; j++) {
    const pivot = o.rows[j]![j]! * x.den;
    if (rest[j]! % pivot !== 0n) return undefined;
    const c = rest[j]! / pivot;
    out[j] = c;
    for (let k = j; k < n; k++) rest[k]! -= c * o.rows[j]![k]! * x.den;
  }
  return out;
}

/** The element with coordinates `c` on the order's basis. */
export const fromCoordinates = (o: Order, c: readonly bigint[]): FieldElement =>
  element(
    o.rows[0]!.map((_, j) =>
      c.reduce((s, ci, i) => s + ci * o.rows[i]![j]!, 0n)
    ),
    o.den
  );
