/**
 * Pure-bigint Diophantine kernels: linear Diophantine systems, generalized
 * Pell equations (`x² − D·y² = N`), and modular square roots.
 *
 * This module is a hand port of the relevant pieces of SymPy's
 * `sympy/solvers/diophantine/diophantine.py` (SymPy 1.14.0, BSD-3), plus a
 * direct implementation of Tonelli–Shanks / Hensel modular square roots. It is
 * deliberately engine-free: every function takes and returns `bigint`s (no
 * `BoxedExpression`, no `ComputeEngine`). Per the `numerics/` layering rule it
 * imports only from other `numerics/` files and `common/`.
 *
 * References throughout cite the SymPy source as `SymPy diophantine.py:<line>`
 * (SymPy 1.14.0). The continued-fraction machinery follows John P. Robertson,
 * "Solving the generalized Pell equation x² − D·y² = N" (2004).
 *
 * @module
 */

import { bigPrimeFactors, modPow } from './primes';

/**
 * Anti-hang backstop. Every unbounded search loop (PQa period detection, the
 * LMM divisor/continued-fraction scan, Cornacchia descent, brute force, CRT
 * recombination) is capped at this many iterations; on overflow a
 * {@link DiophantineBudgetError} is thrown so the caller can degrade
 * gracefully instead of hanging. It is a safety limit, not a tuning knob:
 * genuine continued-fraction periods for `D` up to ~10¹² stay far below it.
 */
const MAX_ITERATIONS = 20_000_000;

/**
 * Thrown when a Diophantine search exceeds {@link MAX_ITERATIONS}. Signals that
 * the computation was aborted to avoid a hang; it does NOT mean "no solution".
 */
export class DiophantineBudgetError extends Error {
  constructor(message = 'Diophantine computation exceeded iteration budget') {
    super(message);
    this.name = 'DiophantineBudgetError';
  }
}

//
// ─── Low-level integer helpers ──────────────────────────────────────────────
//

function abs(n: bigint): bigint {
  return n < 0n ? -n : n;
}

function sign(n: bigint): bigint {
  return n > 0n ? 1n : n < 0n ? -1n : 0n;
}

/** Euclidean gcd of `|a|` and `|b|` (non-negative). */
function gcd(a: bigint, b: bigint): bigint {
  a = abs(a);
  b = abs(b);
  while (b !== 0n) {
    [a, b] = [b, a % b];
  }
  return a;
}

/** Floor division `⌊a/b⌋` (SymPy's `//`), for `b ≠ 0`. */
function floorDiv(a: bigint, b: bigint): bigint {
  let q = a / b;
  if (a % b !== 0n && a < 0n !== b < 0n) q -= 1n;
  return q;
}

/** Integer (floor) square root of `n ≥ 0` via Newton's method on bigints. */
function isqrt(n: bigint): bigint {
  if (n < 0n) throw new RangeError('isqrt of negative');
  if (n < 2n) return n;
  let x = 1n << ((BigInt(n.toString(2).length) + 1n) / 2n);
  for (;;) {
    const y = (x + n / x) >> 1n;
    if (y >= x) break;
    x = y;
  }
  while (x * x > n) x -= 1n;
  return x;
}

/** `[⌊√n⌋, isPerfectSquare]` for `n ≥ 0`. */
function isqrtExact(n: bigint): [bigint, boolean] {
  if (n < 0n) return [0n, false];
  const s = isqrt(n);
  return [s, s * s === n];
}

function isPerfectSquare(n: bigint): boolean {
  if (n < 0n) return false;
  const s = isqrt(n);
  return s * s === n;
}

/**
 * Modular inverse of `a` modulo `m ≥ 1`, in `[0, m)`, or `null` if
 * `gcd(a, m) ≠ 1`.
 */
function modInverse(a: bigint, m: bigint): bigint | null {
  const { g, x } = extendedGcd(((a % m) + m) % m, m);
  if (g !== 1n) return null;
  return ((x % m) + m) % m;
}

/** All positive divisors of `|n|`, sorted ascending. `divisors(0) = []`. */
function divisors(n: bigint): bigint[] {
  n = abs(n);
  if (n === 0n) return [];
  if (n === 1n) return [1n];
  const factors = bigPrimeFactors(n);
  let divs: bigint[] = [1n];
  for (const [p, e] of factors) {
    const extended: bigint[] = [];
    let pe = 1n;
    for (let i = 0; i <= e; i++) {
      for (const d of divs) extended.push(d * pe);
      pe *= p;
    }
    divs = extended;
  }
  divs.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return divs;
}

/**
 * Largest `c ≥ 1` such that `c² | n` (equivalently `n = c²·k` with `k` square
 * free). `square_factor` in SymPy diophantine.py:3026 — `c = ∏ p^⌊e/2⌋`.
 */
function squareFactor(n: bigint): bigint {
  n = abs(n);
  if (n <= 1n) return 1n;
  let c = 1n;
  for (const [p, e] of bigPrimeFactors(n)) {
    for (let i = 0; i < Math.floor(e / 2); i++) c *= p;
  }
  return c;
}

//
// ─── Extended Euclidean algorithm ───────────────────────────────────────────
//

/**
 * Extended Euclidean algorithm. Returns `{ g, x, y }` where
 * `g = gcd(|a|, |b|) ≥ 0` and `a·x + b·y = g`. Handles zero and negative
 * inputs; `extendedGcd(0, 0) = { g: 0, x: 0, y: 0 }`.
 */
export function extendedGcd(
  a: bigint,
  b: bigint
): {
  g: bigint;
  x: bigint;
  y: bigint;
} {
  let [oldR, r] = [a, b];
  let [oldS, s] = [1n, 0n];
  let [oldT, t] = [0n, 1n];
  while (r !== 0n) {
    const q = oldR / r; // truncated division is fine for the gcd recurrence
    [oldR, r] = [r, oldR - q * r];
    [oldS, s] = [s, oldS - q * s];
    [oldT, t] = [t, oldT - q * t];
  }
  // Normalize so that g ≥ 0 (the sign otherwise follows `a`/`b`).
  if (oldR < 0n) {
    oldR = -oldR;
    oldS = -oldS;
    oldT = -oldT;
  }
  return { g: oldR, x: oldS, y: oldT };
}

//
// ─── Linear Diophantine equations ───────────────────────────────────────────
//

/**
 * General integer solution of a single linear Diophantine equation
 * `a[0]·x₀ + … + a[n−1]·x_{n−1} = c`, encoded as an affine family
 *
 *     x_i = base[i] + Σ_j coef[i][j]·t_j     (t_j ∈ ℤ)
 *
 * with `nParams` free integer parameters. In the generic full-rank case
 * `nParams = n − 1`; degenerate cases (see {@link solveLinearDiophantine})
 * may differ.
 */
export interface LinearSolution {
  /** Particular solution, length `n`. */
  base: bigint[];
  /** `n × nParams` coefficient matrix of the free parameters. */
  coef: bigint[][];
  /** Number of free integer parameters `t_j`. */
  nParams: number;
}

/**
 * A linear form `const + Σ coef[j]·t_j` in the (up to `nParams`) parameters.
 * Used internally while chaining the bivariate reductions.
 */
interface LinearForm {
  const: bigint;
  coef: bigint[];
}

function zeroForm(nParams: number): LinearForm {
  return { const: 0n, coef: new Array<bigint>(nParams).fill(0n) };
}

/**
 * Base solution of the bivariate equation `a·x + b·y = k` as an affine family
 * in one fresh parameter `t`:
 *
 *     x = xConst + xHom·t,   y = yConst + yHom·t
 *
 * Faithful port of `base_solution_linear` (SymPy diophantine.py:1762),
 * including the `_remove_gcd` normalization (diophantine.py:1216) and the
 * `b < 0 ⇒ t → −t` sign flip (diophantine.py:1798, 1809). `ok` is `false` iff
 * `gcd(a, b) ∤ k` (no solution). `a` and `b` are assumed nonzero.
 */
function baseSolutionLinear(
  k: bigint,
  a: bigint,
  b: bigint
): {
  xConst: bigint;
  yConst: bigint;
  xHom: bigint;
  yHom: bigint;
  ok: boolean;
} {
  // _remove_gcd(a, b, k): divide all three by g = gcd(a, b, k).
  const g = gcd(gcd(a, b), k);
  const ap = g === 0n ? a : a / g;
  const bp = g === 0n ? b : b / g;
  const kp = g === 0n ? k : k / g;

  const flip = bp < 0n;
  // Homogeneous part (b·t, −a·t), with the b<0 ⇒ t→−t flip already applied.
  const xHom = flip ? -bp : bp;
  const yHom = flip ? ap : -ap;

  if (kp === 0n) {
    return { xConst: 0n, yConst: 0n, xHom, yHom, ok: true };
  }

  // igcdex(|a'|, |b'|): |a'|·u + |b'|·v = d.
  const { g: d, x: u, y: v } = extendedGcd(abs(ap), abs(bp));
  const x0 = u * sign(ap);
  const y0 = v * sign(bp);
  if (kp % d !== 0n) return { xConst: 0n, yConst: 0n, xHom, yHom, ok: false };

  return {
    xConst: kp * x0,
    yConst: kp * y0,
    xHom,
    yHom,
    ok: true,
  };
}

/**
 * Solve a reduced linear system `a·x = c` where every `a[i] ≠ 0` and
 * `m = a.length ≥ 2`, returning `m` linear forms over `m − 1` parameters, or
 * `null` if there is no solution.
 *
 * Port of the n-variable gcd-peeling reduction in `Linear.solve`
 * (SymPy diophantine.py:287–451): the chain `A`/`B` of bivariate coefficients
 * (diophantine.py:351–362) and the term-by-term accumulation
 * (diophantine.py:417–449). Because every contribution is *added* into the
 * running linear forms, the processing order of terms is irrelevant to the
 * result (SymPy's `Add.make_args` order does not matter here); a constant term
 * always spawns parameter `t₀`, and a `t_j` term spawns `t_{j+1}`.
 */
function solveReducedLinear(a: bigint[], c: bigint): LinearForm[] | null {
  const m = a.length;
  const nP = m - 1;

  const A = [...a];
  const B: bigint[] = [];
  if (m > 2) {
    // B[0] = gcd(A[-2], A[-1]); peel gcds leftwards. (diophantine.py:353-361)
    B.push(gcd(A[m - 2], A[m - 1]));
    A[m - 2] = A[m - 2] / B[0];
    A[m - 1] = A[m - 1] / B[0];
    for (let i = m - 3; i > 0; i--) {
      const g = gcd(B[0], A[i]);
      B[0] = B[0] / g;
      A[i] = A[i] / g;
      B.unshift(g);
    }
  }
  B.push(A[m - 1]); // diophantine.py:362

  const solutions: LinearForm[] = [];
  let cf: LinearForm = { const: c, coef: new Array<bigint>(nP).fill(0n) };

  for (let idx = 0; idx < m - 1; idx++) {
    const Ai = A[idx];
    const Bi = B[idx];
    const sx = zeroForm(nP);
    const cy = zeroForm(nP);

    // Constant term: p = 1, spawns parameter t₀. (diophantine.py:421-424,433)
    {
      const bs = baseSolutionLinear(cf.const, Ai, Bi);
      if (!bs.ok) return null;
      sx.const += bs.xConst;
      sx.coef[0] += bs.xHom;
      cy.const += bs.yConst;
      cy.coef[0] += bs.yHom;
    }

    // Parameter terms k·t_j: spawn t_{j+1}; multiply the constant part by t_j.
    // (diophantine.py:425-441)
    for (let j = 0; j < nP; j++) {
      const k = cf.coef[j];
      if (k === 0n) continue;
      const bs = baseSolutionLinear(k, Ai, Bi);
      if (!bs.ok) return null;
      // sol_x = xConst·t_j + xHom·t_{j+1}; likewise for y.
      sx.coef[j] += bs.xConst;
      sx.coef[j + 1] += bs.xHom;
      cy.coef[j] += bs.yConst;
      cy.coef[j + 1] += bs.yHom;
    }

    solutions.push(sx);
    cf = cy;
  }

  solutions.push(cf); // diophantine.py:449
  return solutions;
}

/**
 * Complete integer solution of `a[0]·x₀ + … + a[n−1]·x_{n−1} = c` over ℤ,
 * `n ≥ 1`, as a {@link LinearSolution} affine family. Returns `null` iff there
 * is no solution (`gcd(a) ∤ c`, or every `a[i] = 0` with `c ≠ 0`).
 *
 * Conventions (matching the pinned contract):
 * - A zero coefficient `a[i] = 0` (with some other coefficient nonzero) makes
 *   `x_i` a free parameter; the equation constrains only the nonzero part.
 * - Degenerate: every `a[i] = 0` and `c = 0` ⇒ every `x_i` is free
 *   (`base = 0`, `coef = Iₙ`, `nParams = n`).
 * - Generic full-rank case ⇒ `nParams = n − 1`.
 *
 * The nonzero part is solved by {@link solveReducedLinear}, a port of SymPy's
 * `Linear.solve`; the families it produces match SymPy's up to a renaming of
 * the parameters. Parameter ordering: the `m − 1` reduction parameters first,
 * then one fresh parameter per zero-coefficient variable in index order.
 */
export function solveLinearDiophantine(
  a: bigint[],
  c: bigint
): LinearSolution | null {
  const n = a.length;

  // Indices with a nonzero coefficient (constrained) vs zero (free).
  const nz: number[] = [];
  const zero: number[] = [];
  for (let i = 0; i < n; i++) (a[i] === 0n ? zero : nz).push(i);

  if (nz.length === 0) {
    // All coefficients zero: 0 = c.
    if (c !== 0n) return null;
    // Every variable is free: identity family, nParams = n.
    const base = new Array<bigint>(n).fill(0n);
    const coef = Array.from({ length: n }, (_, i) =>
      Array.from({ length: n }, (_, j) => (i === j ? 1n : 0n))
    );
    return { base, coef, nParams: n };
  }

  const subA = nz.map((i) => a[i]);
  const m = subA.length;

  // Solve the reduced (all-nonzero) system.
  let subBase: bigint[];
  let subCoef: bigint[][]; // m × subParams
  let subParams: number;
  if (m === 1) {
    if (c % subA[0] !== 0n) return null;
    subBase = [c / subA[0]];
    subCoef = [[]];
    subParams = 0;
  } else {
    const forms = solveReducedLinear(subA, c);
    if (forms === null) return null;
    subParams = m - 1;
    subBase = forms.map((f) => f.const);
    subCoef = forms.map((f) => f.coef);
  }

  const nParams = subParams + zero.length;
  const base = new Array<bigint>(n).fill(0n);
  const coef = Array.from({ length: n }, () =>
    new Array<bigint>(nParams).fill(0n)
  );

  // Fill nonzero-coefficient variables from the reduced solution.
  for (let p = 0; p < nz.length; p++) {
    const i = nz[p];
    base[i] = subBase[p];
    for (let j = 0; j < subParams; j++) coef[i][j] = subCoef[p][j];
  }
  // Each zero-coefficient variable gets its own fresh free parameter.
  for (let z = 0; z < zero.length; z++) {
    coef[zero[z]][subParams + z] = 1n;
  }

  return { base, coef, nParams };
}

//
// ─── Modular square roots ───────────────────────────────────────────────────
//

/**
 * Tonelli–Shanks: a single square root of `a` modulo an ODD PRIME `p`, in
 * `[0, p)`, or `null` if `a` is a quadratic non-residue. The other root is
 * `p − r`.
 */
function sqrtModPrime(a: bigint, p: bigint): bigint | null {
  a = ((a % p) + p) % p;
  if (a === 0n) return 0n;
  if (p === 2n) return a & 1n;
  // Euler's criterion.
  if (modPow(a, (p - 1n) / 2n, p) !== 1n) return null;
  if (p % 4n === 3n) return modPow(a, (p + 1n) / 4n, p);

  // Factor p − 1 = q·2^s with q odd.
  let q = p - 1n;
  let s = 0n;
  while (q % 2n === 0n) {
    q /= 2n;
    s += 1n;
  }
  // Find a quadratic non-residue z.
  let z = 2n;
  while (modPow(z, (p - 1n) / 2n, p) !== p - 1n) z += 1n;

  let m = s;
  let cc = modPow(z, q, p);
  let t = modPow(a, q, p);
  let r = modPow(a, (q + 1n) / 2n, p);
  let guard = 0;
  while (t !== 1n) {
    if (++guard > MAX_ITERATIONS) throw new DiophantineBudgetError();
    // Least i, 0 < i < m, with t^(2^i) = 1.
    let i = 0n;
    let t2 = t;
    while (t2 !== 1n) {
      t2 = (t2 * t2) % p;
      i += 1n;
      if (i === m) return null; // should not happen for a QR
    }
    let b = cc;
    for (let j = 0n; j < m - i - 1n; j++) b = (b * b) % p;
    m = i;
    cc = (b * b) % p;
    t = (t * cc) % p;
    r = (r * b) % p;
  }
  return r;
}

/**
 * All roots of `x² ≡ a (mod pᵏ)` for an ODD prime `p`, `k ≥ 1`, sorted
 * ascending in `[0, pᵏ)`. Handles the ramified case `p | a` (including
 * `a ≡ 0`) as well as the unit case via Hensel lifting.
 */
function sqrtModOddPrimePower(a: bigint, p: bigint, k: number): bigint[] {
  let pk = 1n;
  for (let i = 0; i < k; i++) pk *= p;
  a = ((a % pk) + pk) % pk;

  if (a === 0n) {
    // x ≡ 0 (mod p^⌈k/2⌉).
    const e = Math.ceil(k / 2);
    let step = 1n;
    for (let i = 0; i < e; i++) step *= p;
    const out: bigint[] = [];
    for (let x = 0n; x < pk; x += step) out.push(x);
    return out;
  }

  // a = p^v · u, u coprime to p.
  let v = 0;
  let u = a;
  while (u % p === 0n) {
    u /= p;
    v += 1;
  }
  if (v % 2 === 1) return []; // odd valuation ⇒ not a square
  const cHalf = v / 2;

  // Solve y² ≡ u (mod p^{k−v}) with u a unit, then lift x = p^c·y.
  const sub = sqrtUnitOddPrimePower(u, p, k - v);
  if (sub.length === 0) return [];

  let pc = 1n; // p^c
  for (let i = 0; i < cHalf; i++) pc *= p;
  let pkc = 1n; // p^{k−c}
  for (let i = 0; i < k - cHalf; i++) pkc *= p;
  const nExtra = pc; // s ranges over [0, p^c)

  const set = new Set<bigint>();
  for (const y of sub) {
    const b = (pc * y) % pk;
    for (let s = 0n; s < nExtra; s++) set.add((b + s * pkc) % pk);
  }
  return [...set].sort((x, y) => (x < y ? -1 : x > y ? 1 : 0));
}

/**
 * Both roots of `x² ≡ u (mod pᵏ)` for an ODD prime `p` and `u` coprime to `p`,
 * via Tonelli–Shanks mod `p` then Hensel lifting. Returns `[]` if `u` is a
 * non-residue.
 */
function sqrtUnitOddPrimePower(u: bigint, p: bigint, k: number): bigint[] {
  const r0 = sqrtModPrime(u, p);
  if (r0 === null) return [];
  let mod = p;
  let r = r0;
  for (let i = 1; i < k; i++) {
    const nextMod = mod * p;
    // Newton step: r ← r − (r² − u)·(2r)⁻¹ (mod nextMod).
    const f = (((r * r - u) % nextMod) + nextMod) % nextMod;
    const inv = modInverse((2n * r) % nextMod, nextMod);
    if (inv === null) {
      // 2r not invertible: only when p = 2 (excluded here) — bail defensively.
      return [];
    }
    r = (((r - f * inv) % nextMod) + nextMod) % nextMod;
    mod = nextMod;
  }
  const other = (mod - r) % mod;
  return r === other ? [r] : [r, other].sort((x, y) => (x < y ? -1 : 1));
}

/**
 * All roots of `x² ≡ a (mod 2ᵏ)`, `k ≥ 1`, sorted ascending in `[0, 2ᵏ)`.
 * Powers of two have special structure: mod 2 every value squares to itself;
 * mod 4 only `0,1` are squares; mod `2ᵏ` (k ≥ 3) an odd `a` is a square iff
 * `a ≡ 1 (mod 8)`, and then has four roots.
 */
function sqrtModPow2(a: bigint, k: number): bigint[] {
  const pk = 1n << BigInt(k);
  a = ((a % pk) + pk) % pk;

  if (a === 0n) {
    const e = Math.ceil(k / 2);
    const step = 1n << BigInt(e);
    const out: bigint[] = [];
    for (let x = 0n; x < pk; x += step) out.push(x);
    return out;
  }

  if (a % 2n === 0n) {
    // a = 2^v · u, u odd.
    let v = 0;
    let u = a;
    while (u % 2n === 0n) {
      u /= 2n;
      v += 1;
    }
    if (v % 2 === 1) return [];
    const cHalf = v / 2;
    const sub = sqrtModPow2(u, k - v);
    if (sub.length === 0) return [];
    const pc = 1n << BigInt(cHalf);
    const pkc = 1n << BigInt(k - cHalf);
    const nExtra = pc;
    const set = new Set<bigint>();
    for (const y of sub) {
      const b = (pc * y) % pk;
      for (let s = 0n; s < nExtra; s++) set.add((b + s * pkc) % pk);
    }
    return [...set].sort((x, y) => (x < y ? -1 : x > y ? 1 : 0));
  }

  // a odd.
  if (k === 1) return [1n];
  if (k === 2) return a % 4n === 1n ? [1n, 3n] : [];
  if (a % 8n !== 1n) return []; // k ≥ 3
  // Lift a root from mod 8 (r = 1 works since 1² ≡ 1 ≡ a mod 8) up to mod 2ᵏ.
  let r = 1n;
  for (let j = 3; j < k; j++) {
    const mod = 1n << BigInt(j + 1);
    if ((r * r - a) % mod !== 0n) r += 1n << BigInt(j - 1);
  }
  const h = 1n << BigInt(k - 1);
  const roots = new Set<bigint>([
    r % pk,
    (pk - r) % pk,
    (r + h) % pk,
    (pk - r + h) % pk,
  ]);
  return [...roots].sort((x, y) => (x < y ? -1 : x > y ? 1 : 0));
}

/**
 * ALL square roots of `a` modulo `m ≥ 1`, sorted ascending, each in `[0, m)`.
 *
 * Factors `m` into prime powers (`bigPrimeFactors`), solves `x² ≡ a` modulo
 * each prime power — Tonelli–Shanks + Hensel lifting for odd primes, a
 * dedicated 2-power routine for `2ᵏ` — and recombines by CRT. Returns `[]` when
 * `a` is a non-residue for some prime-power factor.
 *
 * Examples: `sqrtMod(1n, 8n) = [1n,3n,5n,7n]`; `sqrtMod(4n, 12n) =
 * [2n,4n,8n,10n]`; `sqrtMod(0n, 4n) = [0n,2n]`.
 */
export function sqrtMod(a: bigint, m: bigint): bigint[] {
  if (m < 1n) throw new RangeError('sqrtMod requires m ≥ 1');
  if (m === 1n) return [0n];
  a = ((a % m) + m) % m;

  const factors = bigPrimeFactors(m);
  // Per-prime-power root lists together with the prime-power modulus.
  const perPower: { roots: bigint[]; mod: bigint }[] = [];
  for (const [p, e] of factors) {
    let pe = 1n;
    for (let i = 0; i < e; i++) pe *= p;
    const roots = p === 2n ? sqrtModPow2(a, e) : sqrtModOddPrimePower(a, p, e);
    if (roots.length === 0) return [];
    perPower.push({ roots, mod: pe });
  }

  // CRT-recombine the cartesian product of per-prime-power roots.
  let combos: { value: bigint; mod: bigint }[] = [{ value: 0n, mod: 1n }];
  let guard = 0;
  for (const { roots, mod } of perPower) {
    const next: { value: bigint; mod: bigint }[] = [];
    for (const c of combos) {
      for (const r of roots) {
        if (++guard > MAX_ITERATIONS) throw new DiophantineBudgetError();
        next.push(crtPair(c.value, c.mod, r, mod));
      }
    }
    combos = next;
  }
  const out = combos.map((c) => ((c.value % m) + m) % m);
  out.sort((x, y) => (x < y ? -1 : x > y ? 1 : 0));
  return out;
}

/**
 * CRT-combine `x ≡ v1 (mod m1)` and `x ≡ v2 (mod m2)` for coprime `m1, m2`.
 * Returns the unique residue modulo `m1·m2`.
 */
function crtPair(
  v1: bigint,
  m1: bigint,
  v2: bigint,
  m2: bigint
): { value: bigint; mod: bigint } {
  const mod = m1 * m2;
  const inv = modInverse(m1 % m2, m2);
  if (inv === null)
    throw new DiophantineBudgetError('crtPair: moduli not coprime');
  // x = v1 + m1·((v2 − v1)·m1⁻¹ mod m2).
  let t = (((v2 - v1) % m2) + m2) % m2;
  t = (t * inv) % m2;
  const value = (((v1 + m1 * t) % mod) + mod) % mod;
  return { value, mod };
}

/** Residue of `a mod m` centered into `(−m/2, m/2]` (SymPy symmetric_residue). */
function symmetricResidue(a: bigint, m: bigint): bigint {
  a = ((a % m) + m) % m;
  return a <= floorDiv(m, 2n) ? a : a - m;
}

//
// ─── PQa continued-fraction engine ──────────────────────────────────────────
//

/**
 * A single PQa step output: the sextuple `(P_i, Q_i, a_i, A_i, B_i, G_i)` of
 * the continued-fraction expansion of `(P₀ + √D)/Q₀` (SymPy diophantine.py:2214).
 */
interface PQaStep {
  P: bigint;
  Q: bigint;
  a: bigint;
  A: bigint;
  B: bigint;
  G: bigint;
}

/**
 * Stateful PQa iterator over `(P₀ + √D)/Q₀`. Requires `P₀² ≡ D (mod |Q₀|)`,
 * `Q₀ ≠ 0`, and `D` a non-square positive integer (its square-free-ness is not
 * required here). `next()` yields successive {@link PQaStep}s forever.
 */
function makePQa(P0: bigint, Q0: bigint, D: bigint): { next(): PQaStep } {
  const sqD = isqrt(D);
  let A2 = 0n;
  let A1 = 1n;
  let B1 = 0n;
  let B2 = 1n;
  let G1 = Q0;
  let G2 = -P0;
  let Pi = P0;
  let Qi = Q0;

  return {
    next(): PQaStep {
      if (Qi === 0n)
        throw new DiophantineBudgetError('PQa: Q reached 0 (invalid seed)');
      const ai = floorDiv(Pi + sqD, Qi);
      [A1, A2] = [ai * A1 + A2, A1];
      [B1, B2] = [ai * B1 + B2, B1];
      [G1, G2] = [ai * G1 + G2, G1];
      const step: PQaStep = { P: Pi, Q: Qi, a: ai, A: A1, B: B1, G: G1 };
      Pi = ai * Qi - Pi;
      Qi = floorDiv(D - Pi * Pi, Qi);
      return step;
    },
  };
}

/**
 * Length (aperiodic + one period) of the continued fraction of `(P + √D)/Q`,
 * computed by detecting the first repeat of the `(P, Q)` state — since that
 * state fully determines all subsequent terms. Assumes a valid PQa seed
 * (`P² ≡ D (mod |Q|)`, `Q ≠ 0`), matching SymPy's `length` (diophantine.py:2396)
 * for such inputs.
 */
function pqaLength(P0: bigint, Q0: bigint, D: bigint): number {
  const sqD = isqrt(D);
  let P = P0;
  let Q = Q0;
  const seen = new Map<string, number>();
  for (let i = 0; ; i++) {
    if (i > MAX_ITERATIONS) throw new DiophantineBudgetError();
    const key = `${P},${Q}`;
    const prev = seen.get(key);
    if (prev !== undefined) return i;
    seen.set(key, i);
    if (Q === 0n) throw new DiophantineBudgetError('pqaLength: Q reached 0');
    const a = floorDiv(P + sqD, Q);
    P = a * Q - P;
    Q = floorDiv(D - P * P, Q);
  }
}

//
// ─── Pell: fundamental unit and the |N| = 1 units ───────────────────────────
//

/**
 * The `|N| = 1` solutions of `x² − D·y² = N` for `D > 0` non-square, as
 * class representatives. Port of the `abs(N) == 1` branch of `diop_DN`
 * (SymPy diophantine.py:2027–2042). Returns `[]` when `N = −1` is unsolvable.
 */
function diopDNUnit(D: bigint, N: bigint): [bigint, bigint][] {
  const sD = isqrt(D);
  const pqa = makePQa(0n, 1n, D);
  const first = pqa.next();
  let prevB = first.B;
  let prevG = first.G;

  let j = 0;
  let breakB = first.B;
  let breakG = first.G;
  let count = 0;
  for (;;) {
    if (++count > MAX_ITERATIONS) throw new DiophantineBudgetError();
    const cur = pqa.next();
    j = count - 1; // enumerate index over the post-first yields
    breakB = cur.B;
    breakG = cur.G;
    if (cur.a === 2n * sD) break;
    prevB = cur.B;
    prevG = cur.G;
  }

  if (j % 2 === 1) {
    // Odd length of the period part.
    return N === 1n ? [[prevG, prevB]] : [];
  }
  // j even.
  if (N === -1n) return [[prevG, prevB]];
  // N === 1: go one more period around.
  let B = breakB;
  let G = breakG;
  for (let kk = 0; kk < j; kk++) {
    const cur = pqa.next();
    B = cur.B;
    G = cur.G;
  }
  return [[G, B]];
}

/**
 * Minimal positive solution `(x, y)` of `x² − D·y² = 1` for `D > 0`
 * non-square (the fundamental automorphism / fundamental unit); `null`
 * otherwise (`D ≤ 0` or `D` a perfect square).
 */
export function pellFundamental(D: bigint): [bigint, bigint] | null {
  if (D <= 0n) return null;
  if (isPerfectSquare(D)) return null;
  const sol = diopDNUnit(D, 1n);
  return sol.length > 0 ? sol[0] : null;
}

//
// ─── Cornacchia (definite forms, D < 0) ─────────────────────────────────────
//

/**
 * Primitive solutions of `a·x² + b·y² = m` with `gcd(a, b) = gcd(a, m) = 1`
 * and `a, b > 0`, returned as `[x, y]` with `x, y ≥ 0`. When `a = b`, only the
 * solutions with `x ≥ y` are returned. Port of `cornacchia`
 * (SymPy diophantine.py:2141).
 */
function cornacchia(a: bigint, b: bigint, m: bigint): [bigint, bigint][] {
  const sols = new Set<string>();
  const out: [bigint, bigint][] = [];
  const add = (x: bigint, y: bigint) => {
    const key = `${x},${y}`;
    if (!sols.has(key)) {
      sols.add(key);
      out.push([x, y]);
    }
  };

  if (a + b > m) {
    // xy = 0 must hold. (diophantine.py:2179)
    if (a === 1n) {
      const [s, exact] = isqrtExact(floorDiv(m, a));
      if (exact) add(s, 0n);
      if (a === b) return out;
    }
    if (m % b === 0n) {
      const [s, exact] = isqrtExact(m / b);
      if (exact) add(0n, s);
    }
    return out;
  }

  // Original Cornacchia. (diophantine.py:2197)
  const inv = modInverse(a, m);
  if (inv === null) return out;
  const rhs = (((-b * inv) % m) + m) % m;
  const half = floorDiv(m, 2n);
  let guard = 0;
  for (const t0 of sqrtMod(rhs, m)) {
    if (t0 < half) continue;
    let u = m;
    let r = t0;
    let m1 = m - a * r * r;
    while (m1 <= 0n) {
      if (++guard > MAX_ITERATIONS) throw new DiophantineBudgetError();
      [u, r] = [r, u % r];
      m1 = m - a * r * r;
    }
    if (m1 % b !== 0n) continue;
    m1 = m1 / b;
    const [s, exact] = isqrtExact(m1);
    if (exact) {
      let rr = r;
      let ss = s;
      if (a === b && rr < ss) [rr, ss] = [ss, rr];
      add(rr, ss);
    }
  }
  return out;
}

//
// ─── diop_DN: class representatives of x² − D·y² = N ─────────────────────────
//

/**
 * `_special_diop_DN` fast path for `1 < N² < D`, `D` non-square
 * (SymPy diophantine.py:2064). Returns class representatives.
 */
function specialDiopDN(D: bigint, N: bigint): [bigint, bigint][] {
  const sqrtD = isqrt(D);
  const F = new Map<string, bigint>(); // key(N//f²) -> f
  for (const f of divisors(squareFactor(abs(N)))) {
    F.set((N / (f * f)).toString(), f);
  }
  let P = 0n;
  let Q = 1n;
  let G0 = 0n;
  let G1 = 1n;
  let B0 = 1n;
  let B1 = 0n;
  const solutions: [bigint, bigint][] = [];
  let guard = 0;
  for (;;) {
    for (let i = 0; i < 2; i++) {
      const a = floorDiv(P + sqrtD, Q);
      P = a * Q - P;
      Q = floorDiv(D - P * P, Q);
      [G0, G1] = [G1, a * G1 + G0];
      [B0, B1] = [B1, a * B1 + B0];
      const s = G1 * G1 - D * B1 * B1;
      const f = F.get(s.toString());
      if (f !== undefined) solutions.push([f * G1, f * B1]);
    }
    if (Q === 1n) break;
    if (++guard > MAX_ITERATIONS) throw new DiophantineBudgetError();
  }
  return solutions;
}

/**
 * Class representatives for `x² − D·y² = N` with `D > 0` non-square and
 * `N ≠ 0`. Port of the general LMM path of `diop_DN`
 * (SymPy diophantine.py:2019–2061), including the `|N| = 1` and `1 < N² < D`
 * fast paths. Returns the fundamental representative of each solution class
 * (possibly empty when there is no solution).
 */
function diopDNGeneral(D: bigint, N: bigint): [bigint, bigint][] {
  if (N * N > 1n && N * N < D) return specialDiopDN(D, N);
  if (abs(N) === 1n) return diopDNUnit(D, N);

  const sol: [bigint, bigint][] = [];
  for (const f of divisors(squareFactor(N))) {
    const m = N / (f * f);
    const am = abs(m);
    for (const sqm of sqrtMod(D, am)) {
      const z = symmetricResidue(sqm, am);
      const pqa = makePQa(z, am, D);
      const first = pqa.next();
      let prevB = first.B;
      let prevG = first.G;
      const len = pqaLength(z, am, D);
      for (let step = 0; step < len - 1; step++) {
        const cur = pqa.next();
        const q = cur.Q;
        if (abs(q) === 1n) {
          if (prevG * prevG - D * prevB * prevB === m) {
            sol.push([f * prevG, f * prevB]);
          } else {
            const aUnit = diopDNGeneral(D, -1n); // x² − D·y² = −1
            if (aUnit.length > 0) {
              const [u0, u1] = aUnit[0];
              sol.push([
                f * (prevG * u0 + prevB * D * u1),
                f * (prevG * u1 + prevB * u0),
              ]);
            }
          }
          break;
        }
        prevB = cur.B;
        prevG = cur.G;
      }
    }
  }
  return sol;
}

/** Primitive-plus-scaled solutions of `x² − D·y² = N` for `D < 0`, `N > 0`. */
function diopDNNegative(D: bigint, N: bigint): [bigint, bigint][] {
  const sol: [bigint, bigint][] = [];
  for (const d of divisors(squareFactor(N))) {
    const mm = N / (d * d);
    for (const [x, y] of cornacchia(1n, -D, mm)) {
      sol.push([d * x, d * y]);
      if (D === -1n) sol.push([d * y, d * x]);
    }
  }
  return sol;
}

//
// ─── Public Pell solver ─────────────────────────────────────────────────────
//

/**
 * Result of {@link solvePell}. The three original variants (`empty`,
 * `finite`, `family`) are pinned; `linear-family` is an additive extension for
 * the degenerate parametric (non-Pell) cases.
 *
 * Family-generation rule (the caller enumerates EXACTLY this):
 * for `kind: 'family'`, the complete integer solution set of `x² − D·y² = N`
 * is, over ALL classes `(r, s)` in `classes`:
 *
 *   - every `(x, y) = (r + s√D)·(T + U√D)^t` for `t ∈ ℤ`, where `(T, U) = unit`
 *     is the fundamental solution of `x² − D·y² = 1`; for `t < 0` use the
 *     inverse unit `(T, −U)`. Multiplication in ℤ[√D] is
 *     `(x₁,y₁)·(x₂,y₂) = (x₁x₂ + D·y₁y₂, x₁y₂ + y₁x₂)`;
 *   - TOGETHER WITH the negation `(−x, −y)` of each such member.
 *
 * A separate `(r, −s)` reflection of the class reps is NOT required: iterating
 * `t` over all of ℤ and adding the global negation covers every solution. This
 * matches SymPy's `BinaryQuadratic.solve` (diophantine.py:632–646), which adds
 * `(−X, −Y)` to the class set and lets the parameter run over ℤ, and is
 * verified against a brute-force enumeration in the module tests.
 */
export type PellResult =
  | { kind: 'empty' }
  | { kind: 'finite'; solutions: Array<[bigint, bigint]> }
  | {
      kind: 'family';
      classes: Array<[bigint, bigint]>;
      unit: [bigint, bigint];
    }
  | {
      kind: 'linear-family';
      families: Array<{ xOfY: [bigint, bigint] }>;
    };

function dedupePairs(pairs: [bigint, bigint][]): [bigint, bigint][] {
  const seen = new Set<string>();
  const out: [bigint, bigint][] = [];
  for (const [x, y] of pairs) {
    const key = `${x},${y}`;
    if (!seen.has(key)) {
      seen.add(key);
      out.push([x, y]);
    }
  }
  out.sort((a, b) =>
    a[0] !== b[0]
      ? a[0] < b[0]
        ? -1
        : 1
      : a[1] < b[1]
        ? -1
        : a[1] > b[1]
          ? 1
          : 0
  );
  return out;
}

/** Expand class reps to all four sign combinations (deduplicated). */
function signExpand(pairs: [bigint, bigint][]): [bigint, bigint][] {
  const all: [bigint, bigint][] = [];
  for (const [x, y] of pairs) {
    all.push([x, y], [-x, y], [x, -y], [-x, -y]);
  }
  return dedupePairs(all);
}

/**
 * Complete integer solution of `x² − D·y² = N`, following SymPy's `diop_DN`
 * semantics. See {@link PellResult} for the exact meaning of each variant and
 * the family-generation rule the caller must apply.
 *
 * Case analysis (SymPy diophantine.py:1979–2061):
 * - `D < 0`: `N < 0` ⇒ empty; `N = 0` ⇒ finite `{(0,0)}`; `N > 0` ⇒ finite,
 *   found via Cornacchia over the divisors of `squareFactor(N)`, then expanded
 *   to all sign combinations.
 * - `D = 0`: solves `x² = N`. `N < 0` ⇒ empty; `N = 0` ⇒ `x = 0, y` free;
 *   `N = s²` ⇒ `x = ±s, y` free (linear families); non-square `N > 0` ⇒ empty.
 * - `D = t²` perfect square: `N = 0` ⇒ `x = ±t·y` (linear families); `N ≠ 0` ⇒
 *   finite, from the factor pairs of `N` in `(x − t·y)(x + t·y) = N`.
 * - `D > 0` non-square: `N = 0` ⇒ finite `{(0,0)}`; otherwise a Pell family
 *   with the class representatives of `diop_DN` and the fundamental unit, or
 *   empty when no class exists.
 */
export function solvePell(D: bigint, N: bigint): PellResult {
  // D < 0.
  if (D < 0n) {
    if (N < 0n) return { kind: 'empty' };
    if (N === 0n) return { kind: 'finite', solutions: [[0n, 0n]] };
    const reps = diopDNNegative(D, N);
    const full = signExpand(reps);
    return full.length === 0
      ? { kind: 'empty' }
      : { kind: 'finite', solutions: full };
  }

  // D = 0: x² = N.
  if (D === 0n) {
    if (N < 0n) return { kind: 'empty' };
    if (N === 0n)
      return { kind: 'linear-family', families: [{ xOfY: [0n, 0n] }] };
    const [s, exact] = isqrtExact(N);
    if (!exact) return { kind: 'empty' };
    return {
      kind: 'linear-family',
      families: [{ xOfY: [s, 0n] }, { xOfY: [-s, 0n] }],
    };
  }

  // D > 0.
  const [t, square] = isqrtExact(D);
  if (square) {
    // Perfect square: (x − t·y)(x + t·y) = N.
    if (N === 0n)
      return {
        kind: 'linear-family',
        families: [{ xOfY: [0n, t] }, { xOfY: [0n, -t] }],
      };
    const sols = perfectSquareFinite(t, N);
    return sols.length === 0
      ? { kind: 'empty' }
      : { kind: 'finite', solutions: sols };
  }

  // D > 0 non-square.
  if (N === 0n) return { kind: 'finite', solutions: [[0n, 0n]] };

  const classes = dedupePairs(diopDNGeneral(D, N));
  if (classes.length === 0) return { kind: 'empty' };
  const unit = pellFundamental(D);
  if (unit === null) return { kind: 'empty' }; // unreachable for non-square D>0
  return { kind: 'family', classes, unit };
}

/**
 * All integer solutions of `x² − t²·y² = N` (`t ≥ 1`, `N ≠ 0`), enumerated via
 * the factor pairs `(A, B)` with `A·B = N`, `A = x − t·y`, `B = x + t·y`. This
 * yields the complete signed set directly.
 */
function perfectSquareFinite(t: bigint, N: bigint): [bigint, bigint][] {
  const out: [bigint, bigint][] = [];
  const twoT = 2n * t;
  for (const d of divisors(N)) {
    for (const A of [d, -d]) {
      const B = N / A;
      const sum = A + B;
      const diff = B - A;
      if (sum % 2n !== 0n) continue;
      if (diff % twoT !== 0n) continue;
      out.push([sum / 2n, diff / twoT]);
    }
  }
  return dedupePairs(out);
}

/**
 * Brute-force enumeration of ALL integer solutions `(x, y)` of
 * `x² − D·y² = N` with `|x| ≤ bound` and `|y| ≤ bound`. Complete within that
 * box; intended for testing and for cross-checking {@link solvePell}. Loosely
 * corresponds to `diop_bf_DN` (SymPy diophantine.py:2270), but enumerates the
 * full symmetric box rather than the minimal Robertson window.
 */
export function bruteForcePell(
  D: bigint,
  N: bigint,
  bound: bigint = 1000n
): [bigint, bigint][] {
  const out: [bigint, bigint][] = [];
  for (let y = -bound; y <= bound; y++) {
    const rhs = N + D * y * y;
    if (rhs < 0n) continue;
    const [s, exact] = isqrtExact(rhs);
    if (!exact) continue;
    for (const x of s === 0n ? [0n] : [s, -s]) {
      if (x <= bound && x >= -bound) out.push([x, y]);
    }
  }
  return dedupePairs(out);
}
