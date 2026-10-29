// Number fields ℚ(θ), θ a root of a monic irreducible f ∈ ℤ[x], and their orders, exactly in
// bigints (Cohen, A Course in Computational Algebraic Number Theory, §§4.5–4.7, 6.1–6.2).
// An element is its coordinates on the power basis 1, θ, …, θⁿ⁻¹ over a common denominator; an
// order is a ℤ-basis in that form, kept in Hermite normal form. Every answer is exact or
// declined (`undefined`): a search past its cap, or an integer too large to factor, declines.

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

export function gcd(a: bigint, b: bigint): bigint {
  [a, b] = [abs(a), abs(b)];
  while (b !== 0n) [a, b] = [b, a % b];
  return a;
}

const mod = (a: bigint, m: bigint): bigint => ((a % m) + m) % m;

function powMod(b: bigint, e: bigint, m: bigint): bigint {
  let r = 1n;
  b = mod(b, m);
  for (; e > 0n; e >>= 1n, b = (b * b) % m) if (e & 1n) r = (r * b) % m;
  return r;
}

export function isqrt(n: bigint): bigint {
  if (n < 2n) return n;
  let x = BigInt(Math.floor(Math.sqrt(Number(n))));
  while (x * x > n) x--;
  while ((x + 1n) * (x + 1n) <= n) x++;
  return x;
}

/** Miller–Rabin with the first 13 primes as bases, a proof below this bound (Sorenson–Webster). */
const PROVEN_BELOW = 3317044064679887385961981n;
const WITNESSES = [2n, 3n, 5n, 7n, 11n, 13n, 17n, 19n, 23n, 29n, 31n, 37n, 41n];

/** Whether `n` is prime; `undefined` past the bound where the test is a proof. */
export function isPrime(n: bigint): boolean | undefined {
  if (n < 2n) return false;
  for (const p of WITNESSES) if (n % p === 0n) return n === p;
  if (n >= PROVEN_BELOW) return undefined;
  let d = n - 1n;
  let s = 0;
  while ((d & 1n) === 0n) [d, s] = [d >> 1n, s + 1];
  witness: for (const a of WITNESSES) {
    let x = powMod(a, d, n);
    if (x === 1n || x === n - 1n) continue;
    for (let r = 1; r < s; r++) {
      x = (x * x) % n;
      if (x === n - 1n) continue witness;
    }
    return false;
  }
  return true;
}

/** Trial division bound: a cofactor left below its square is prime. */
const TRIAL_LIMIT = 100_000n;

/** `n`'s prime factorization, or `undefined` when a cofactor can't be split or proven prime. */
export function factorInteger(n: bigint): Map<bigint, number> | undefined {
  n = abs(n);
  const out = new Map<bigint, number>();
  if (n === 0n) return undefined;
  for (let p = 2n; p <= TRIAL_LIMIT && p * p <= n; p += p === 2n ? 1n : 2n) {
    while (n % p === 0n) {
      out.set(p, (out.get(p) ?? 0) + 1);
      n /= p;
    }
  }
  if (n === 1n) return out;
  if (n < TRIAL_LIMIT * TRIAL_LIMIT || isPrime(n) === true) {
    out.set(n, (out.get(n) ?? 0) + 1);
    return out;
  }
  // Every factor left is past the trial bound: a square of a prime is the only shape read here.
  const r = isqrt(n);
  if (r * r === n && isPrime(r) === true) {
    out.set(r, (out.get(r) ?? 0) + 2);
    return out;
  }
  return undefined;
}

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

/**
 * The minimal polynomial of `x` over ℚ, primitive with positive leading coefficient: the
 * characteristic polynomial is its power, so it is that over its gcd with its derivative.
 */
export function minimalPolynomial(f: Poly, x: FieldElement): bigint[] {
  const n = f.length - 1;
  const c = charpolyNumerators(f, x);
  // charpoly of x, scaled to integers: Σ c_k·den^k tᵏ (multiply through by denⁿ).
  const chi = c.map((ck, k) => ck * x.den ** BigInt(k));
  const g = polyGcdQ(chi, derivative(chi));
  const m = degree(g) <= 0 ? chi : polyDivExact(chi, g);
  const ct = content(m);
  const sign = m[degree(m)]! < 0n ? -1n : 1n;
  return trim(m.map((v) => (sign * v) / ct)).slice(0, n + 1);
}

/** A gcd over ℚ, as a primitive integer polynomial (pseudo-remainders). */
function polyGcdQ(a: Poly, b: Poly): bigint[] {
  let [x, y] = [trim([...a]), trim([...b])];
  while (degree(y) >= 0) {
    const r = [...x];
    const lc = y[degree(y)]!;
    while (degree(r) >= degree(y)) {
      const k = degree(r);
      const c = r[k]!;
      for (let i = 0; i <= k; i++) r[i]! *= lc;
      for (let j = 0; j <= degree(y); j++) r[k - degree(y) + j]! -= c * y[j]!;
    }
    const rem = trim(r);
    const ct = content(rem);
    [x, y] = [y, ct === 0n ? [] : rem.map((v) => v / ct)];
  }
  const ct = content(x);
  return x.map((v) => v / ct);
}

/** `a / b` up to a constant (`lc(b)^(δ+1)·a / b`, exact over ℤ), b dividing a over ℚ. */
function polyDivExact(a: Poly, b: Poly): bigint[] {
  const r = trim([...a]);
  const db = degree(b);
  const lc = b[db]!;
  // Clear denominators: lc^(deg a − deg b + 1)·a divides exactly.
  const scale = lc ** BigInt(degree(r) - db + 1);
  for (let i = 0; i < r.length; i++) r[i]! *= scale;
  const q: bigint[] = Array.from({ length: degree(r) - db + 1 }, () => 0n);
  for (let k = degree(r); k >= db; k--) {
    const c = r[k]! / lc;
    q[k - db] = c;
    for (let j = 0; j <= db; j++) r[k - db + j]! -= c * b[j]!;
  }
  return q;
}

// --- discriminants --------------------------------------------------------------------------

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

/** O[y] = O + yO + … + yⁿ⁻¹O, y integral. */
function adjoin(o: Order, y: FieldElement): Order {
  const n = o.f.length - 1;
  const basis = o.rows.map((r) => element(r, o.den));
  const all: FieldElement[] = [...basis];
  let power: FieldElement = element([
    1n,
    ...Array.from({ length: n - 1 }, () => 0n),
  ]);
  for (let k = 1; k < n; k++) {
    power = multiply(o.f, power, y);
    for (const b of basis) all.push(multiply(o.f, power, b));
  }
  const den = all.reduce((l, x) => (l * x.den) / gcd(l, x.den), 1n);
  return orderSpanned(
    o.f,
    all.map((x) => x.num.map((c) => c * (den / x.den))),
    den
  );
}

/** Candidates tried in all, across one maximal-order computation, before it declines. */
const SEARCH_LIMIT = 200_000;

/**
 * O enlarged to be p-maximal, or `undefined` past the search cap. O isn't p-maximal exactly
 * when some y ∈ (1/p)O \ O is integral (an element of order p in the p-part of O_K/O), and the
 * integral y form a subspace there, so one per line through the origin of (ℤ/p)ⁿ is tried.
 */
function pMaximal(
  o: Order,
  p: bigint,
  budget: { left: number }
): Order | undefined {
  const n = o.rows.length;
  for (;;) {
    let found: FieldElement | undefined;
    // Lines through the origin: the first nonzero coordinate is 1.
    search: for (let lead = 0; lead < n; lead++) {
      const free = n - lead - 1;
      const count = p ** BigInt(free);
      for (let t = 0n; t < count; t++) {
        if (--budget.left < 0) return undefined;
        const a: bigint[] = Array.from({ length: n }, () => 0n);
        a[lead] = 1n;
        for (let i = lead + 1, rest = t; i < n; i++, rest /= p) a[i] = rest % p;
        const num = Array.from({ length: n }, (_, j) =>
          a.reduce((s, ai, i) => s + ai * o.rows[i]![j]!, 0n)
        );
        const y = element(num, o.den * p);
        if (isIntegral(o.f, y)) {
          found = y;
          break search;
        }
      }
    }
    if (found === undefined) return o;
    o = adjoin(o, found);
  }
}

/** The maximal order O_K, or `undefined` when disc(f) can't be factored or a search runs past its cap. */
export function maximalOrder(f: Poly): Order | undefined {
  const disc = polynomialDiscriminant(f);
  const primes = factorInteger(disc);
  if (primes === undefined) return undefined;
  let o = equationOrder(f);
  const budget = { left: SEARCH_LIMIT };
  for (const [p, e] of primes) {
    if (e < 2) continue;
    const next = pMaximal(o, p, budget);
    if (next === undefined) return undefined;
    o = next;
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

// --- irreducibility -------------------------------------------------------------------------

/** f mod p, as numbers (p small enough that products stay exact). */
type PolyP = number[];

const trimP = (a: PolyP): PolyP => {
  let d = a.length - 1;
  while (d >= 0 && a[d] === 0) d--;
  return a.slice(0, d + 1);
};

const invModP = (a: number, p: number): number =>
  Number(powMod(BigInt(a), BigInt(p - 2), BigInt(p)));

function remP(a: PolyP, b: PolyP, p: number): PolyP {
  const r = [...a];
  const db = b.length - 1;
  const inv = invModP(b[db]!, p);
  for (let k = r.length - 1; k >= db; k--) {
    const c = (r[k]! * inv) % p;
    if (c === 0) continue;
    for (let j = 0; j <= db; j++)
      r[k - db + j] = (((r[k - db + j]! - c * b[j]!) % p) + p) % p;
  }
  return trimP(r.slice(0, Math.max(db, 0)));
}

function mulModP(a: PolyP, b: PolyP, m: PolyP, p: number): PolyP {
  const out: PolyP = Array.from({ length: a.length + b.length - 1 }, () => 0);
  for (let i = 0; i < a.length; i++)
    for (let j = 0; j < b.length; j++)
      out[i + j] = (out[i + j]! + a[i]! * b[j]!) % p;
  return remP(trimP(out), m, p);
}

function gcdP(a: PolyP, b: PolyP, p: number): PolyP {
  [a, b] = [trimP(a), trimP(b)];
  while (b.length > 0) [a, b] = [b, remP(a, b, p)];
  return a;
}

function divP(a: PolyP, b: PolyP, p: number): PolyP {
  const r = [...a];
  const db = b.length - 1;
  const inv = invModP(b[db]!, p);
  const q: PolyP = Array.from({ length: Math.max(r.length - db, 0) }, () => 0);
  for (let k = r.length - 1; k >= db; k--) {
    const c = (r[k]! * inv) % p;
    q[k - db] = c;
    for (let j = 0; j <= db; j++)
      r[k - db + j] = (((r[k - db + j]! - c * b[j]!) % p) + p) % p;
  }
  return trimP(q);
}

/** The degrees of f's irreducible factors mod p (distinct-degree factorization; f squarefree mod p). */
function factorDegreesModP(f: Poly, p: number): number[] {
  let g = trimP(f.map((c) => Number(mod(c, BigInt(p)))));
  const degrees: number[] = [];
  let h: PolyP = [0, 1];
  for (let d = 1; 2 * d <= g.length - 1; d++) {
    // h = x^(p^d) mod g, by p-th powers.
    let r: PolyP = [1];
    for (let e = p, b = remP(h, g, p); e > 0; e >>= 1, b = mulModP(b, b, g, p))
      if (e & 1) r = mulModP(r, b, g, p);
    h = r;
    const minusX = [...h];
    minusX[1] = ((((minusX[1] ?? 0) - 1) % p) + p) % p;
    const common = gcdP(g, trimP(minusX), p);
    const k = common.length - 1;
    if (k > 0) {
      for (let i = 0; i < k / d; i++) degrees.push(d);
      g = divP(g, common, p);
      h = remP(h, g, p);
    }
  }
  if (g.length - 1 > 0) degrees.push(g.length - 1);
  return degrees;
}

/** Primes tried for a degree pattern that rules out every proper factor. */
const IRREDUCIBILITY_PRIMES = 60;

/**
 * Whether monic f is irreducible over ℚ: `true` when the factor degrees mod primes not dividing
 * disc(f) leave no degree a proper factor could have, `false` when f has a repeated factor or an
 * integer root, and `undefined` otherwise (x⁴ + 1 splits mod every prime).
 */
export function isIrreducible(f: Poly): boolean | undefined {
  const n = f.length - 1;
  if (n === 1) return true;
  const disc = polynomialDiscriminant(f);
  if (disc === 0n) return false;
  if (f[0] === 0n) return false;
  // An integer root divides f(0); try the small ones.
  for (let r = -100n; r <= 100n; r++) {
    if (
      r !== 0n &&
      f[0]! % r === 0n &&
      f.reduce((s, c, i) => s + c * r ** BigInt(i), 0n) === 0n
    )
      return false;
  }
  let possible = new Set(Array.from({ length: n - 1 }, (_, i) => i + 1));
  for (let p = 2, tried = 0; tried < IRREDUCIBILITY_PRIMES; p++) {
    if (isPrime(BigInt(p)) !== true || disc % BigInt(p) === 0n) continue;
    tried++;
    const sums = new Set([0]);
    // A snapshot of the sums so far: adding while iterating would count a degree twice.
    for (const d of factorDegreesModP(f, p))
      for (const s of Array.from(sums)) sums.add(s + d);
    possible = new Set([...possible].filter((d) => sums.has(d)));
    if (possible.size === 0) return true;
  }
  return undefined;
}
