/**
 * Roots, discrete logarithms and primitive roots in the unit groups (ℤ/m)ˣ,
 * over bigints.
 *
 * Every function answers `undefined` when it cannot vouch for the answer: the
 * modulus does not factor within the Pollard-rho budget, a prime of a
 * multiplicative order needing a discrete log is beyond `BSGS_LIMIT`, or the
 * answer would list more than `MAX_LISTED` values. The caller leaves the
 * expression unevaluated.
 */

import {
  CancellationError,
  checkDeadline,
  type DeadlineFrame,
} from '../../common/interruptible.js';
import {
  chineseRemainder,
  gcd,
  lcm,
  modularInverse,
} from './numeric-bigint.js';
import { bigPrimeFactors, modPow } from './primes.js';

type Deadline = number | DeadlineFrame | undefined;

/** The longest list `powerModRoots` or `primitiveRootList` will build. */
export const MAX_LISTED = 100_000;

/**
 * The largest prime order in which a discrete logarithm is attempted.
 * Baby-step giant-step stores about √q values, so 2⁴⁰ is about a million
 * table entries.
 */
const BSGS_LIMIT = 1n << 40n;

/** Below this a prime's roots are found by scanning [0, p) rather than by discrete logs. */
const SCAN_PRIME = 64n;

const mod = (a: bigint, m: bigint): bigint => ((a % m) + m) % m;

const ascending = (x: bigint, y: bigint): number =>
  x < y ? -1 : x > y ? 1 : 0;

/** ⌊√n⌋ for `n ≥ 0`, by Newton's iteration. */
function isqrt(n: bigint): bigint {
  if (n < 2n) return n;
  let x = 1n << BigInt((n.toString(2).length + 1) >> 1);
  for (;;) {
    const y = (x + n / x) >> 1n;
    if (y >= x) return x;
    x = y;
  }
}

/** The multiplicity of `q` in `n ≠ 0`, and what is left of `n` after dividing it out. */
function valuation(n: bigint, q: bigint): [number, bigint] {
  let v = 0;
  while (n % q === 0n) {
    n /= q;
    v += 1;
  }
  return [v, n];
}

/**
 * The prime factorization of `n ≥ 1`, or `undefined` when Pollard rho gives up
 * on it. A deadline cancellation is not a give-up and propagates.
 */
export function factorBudgeted(
  n: bigint,
  deadline?: Deadline
): Map<bigint, number> | undefined {
  try {
    return bigPrimeFactors(n, deadline);
  } catch (e) {
    if (
      e instanceof CancellationError &&
      e.cause === 'iteration-limit-exceeded'
    )
      return undefined;
    throw e;
  }
}

/** Carmichael's λ(n) from the factorization of `n`. */
function carmichael(factors: Map<bigint, number>): bigint {
  let result = 1n;
  for (const [p, e] of factors) {
    const phi = (p - 1n) * p ** BigInt(e - 1);
    result = lcm(result, p === 2n && e >= 3 ? phi / 2n : phi);
  }
  return result;
}

/**
 * The baby-step table of `γ` of prime order `q` mod m: `γʲ ↦ j` for j below
 * `step` = ⌊√(q − 1)⌋ + 1, and `giant` = γ^(−step).
 */
type BabySteps = { step: bigint; baby: Map<bigint, bigint>; giant: bigint };

/**
 * Baby-step tables keyed by `γ`, for one modulus m. Within one modulus `γ`
 * sets its order q, so `γ` alone identifies a table. A table holds up to
 * about 2²⁰ entries, so a caller that takes several logs to the same base
 * shares one of these maps between the calls and builds each table once.
 */
type BabyStepTables = Map<bigint, BabySteps>;

/**
 * The `x` in [0, q) with `γˣ ≡ h (mod m)` for `γ` of prime order `q`, by
 * baby-step giant-step; `undefined` when `h` is not a power of `γ` or `q` is
 * beyond `BSGS_LIMIT`. The table of `γ` is taken from `tables`, or built and
 * added to it.
 */
function discreteLogPrimeOrder(
  gamma: bigint,
  h: bigint,
  q: bigint,
  m: bigint,
  tables: BabyStepTables,
  deadline: Deadline
): bigint | undefined {
  if (h === 1n % m) return 0n;
  if (q > BSGS_LIMIT) return undefined;
  let table = tables.get(gamma);
  if (table === undefined) {
    const step = isqrt(q - 1n) + 1n;
    const baby = new Map<bigint, bigint>();
    let power = 1n % m;
    for (let j = 0n; j < step; j++) {
      if (!baby.has(power)) baby.set(power, j);
      power = (power * gamma) % m;
      if ((j & 0x3ffn) === 0n) checkDeadline(deadline);
    }
    const giant = modularInverse(modPow(gamma, step, m), m)!;
    table = { step, baby, giant };
    tables.set(gamma, table);
  }
  const { step, baby, giant } = table;
  let target = h;
  for (let i = 0n; i < step; i++) {
    const j = baby.get(target);
    if (j !== undefined) return i * step + j;
    target = (target * giant) % m;
    if ((i & 0x3ffn) === 0n) checkDeadline(deadline);
  }
  return undefined;
}

/**
 * The `x` with `aˣ ≡ h (mod m)` for `a` of order `qˢ`, one base-`q` digit at a
 * time (Pohlig–Hellman); `undefined` when `h` is not a power of `a`. Every
 * digit is a log to the same base, so its baby-step table is built once, and
 * a caller that passes the same `tables` for several `h` builds it once for
 * all of them.
 */
function discreteLogPrimePower(
  a: bigint,
  h: bigint,
  q: bigint,
  s: number,
  m: bigint,
  deadline: Deadline,
  tables: BabyStepTables = new Map()
): bigint | undefined {
  const gamma = modPow(a, q ** BigInt(s - 1), m);
  const aInverse = modularInverse(a, m)!;
  let x = 0n;
  for (let i = 0; i < s; i++) {
    const residual = (modPow(aInverse, x, m) * h) % m;
    const digit = discreteLogPrimeOrder(
      gamma,
      modPow(residual, q ** BigInt(s - 1 - i), m),
      q,
      m,
      tables,
      deadline
    );
    if (digit === undefined) return undefined;
    x += digit * q ** BigInt(i);
  }
  return modPow(a, x, m) === h ? x : undefined;
}

/** The distinct prime factors of a small positive integer, ascending. */
function smallPrimeFactors(n: bigint): bigint[] {
  const primes: bigint[] = [];
  let rest = n;
  for (let q = 2n; q * q <= rest; q++) {
    if (rest % q !== 0n) continue;
    primes.push(q);
    while (rest % q === 0n) rest /= q;
  }
  if (rest > 1n) primes.push(rest);
  return primes;
}

/**
 * Every `x` in [1, p) with `xʳ ≡ b (mod p)`, for a prime `p > 2` and `b ≢ 0`;
 * `[]` when `b` is not an r-th power, `undefined` when there are more than
 * `MAX_LISTED` roots (d = gcd(r, p − 1) is the number of roots).
 *
 * (ℤ/p)ˣ is cyclic of order n = p − 1, so `xʳ = b` is solvable iff
 * `b^(n/d) = 1` for d = gcd(r, n), and then there are exactly d roots: one
 * root times the d-th roots of unity. The root is assembled one Sylow
 * subgroup at a time; only the primes q dividing r need a discrete log, and
 * it lives in the q-part of the group, so p − 1 is never factored and a
 * 30-digit p costs a handful of exponentiations.
 */
function rootsModPrimeUnit(
  b: bigint,
  r: bigint,
  p: bigint,
  deadline: Deadline
): bigint[] | undefined {
  const n = p - 1n;
  const d = gcd(r, n);
  if (modPow(b, n / d, p) !== 1n) return [];
  if (d > BigInt(MAX_LISTED)) return undefined;

  // n = (∏ over q | r of q^s_q) · rest, with rest coprime to r.
  // A prime divides both r and n exactly when it divides d, so the primes
  // are taken from d (at most `MAX_LISTED`, so trial division is cheap)
  // and never from r, which can be too large to factor.
  let rest = n;
  const sylow: { q: bigint; s: number }[] = [];
  for (const q of smallPrimeFactors(d)) {
    const [s, left] = valuation(rest, q);
    rest = left;
    if (s === 0) continue;
    sylow.push({ q, s });
  }

  // e ≡ 1 (mod order), e ≡ 0 (mod n/order): the idempotent onto that component.
  const projection = (order: bigint): bigint => {
    const cofactor = n / order;
    return cofactor * modularInverse(cofactor, order)!;
  };

  // On the part coprime to r, r is invertible: the root is a plain power.
  let root = modPow(
    modPow(b, projection(rest), p),
    modularInverse(r, rest)!,
    p
  );
  // Generates the d-th roots of unity, built alongside.
  let unity = 1n;
  for (const { q, s } of sylow) {
    const order = q ** BigInt(s);
    // c^(n/order) has order exactly q^s iff c is not a q-th power.
    let generator: bigint | undefined;
    for (let c = 2n; c < p; c++) {
      if (modPow(c, n / q, p) !== 1n) {
        generator = modPow(c, n / order, p);
        break;
      }
      if ((c & 0x3ffn) === 0n) checkDeadline(deadline);
    }
    if (generator === undefined) return undefined;
    const log = discreteLogPrimePower(
      generator,
      modPow(b, projection(order), p),
      q,
      s,
      p,
      deadline
    );
    if (log === undefined) return []; // excluded by the b^(n/d) = 1 test
    // r·X ≡ log (mod q^s), with r = q^v·r₁
    const [v, r1] = valuation(r, q);
    const shift = Math.min(v, s);
    const scale = q ** BigInt(shift);
    if (log % scale !== 0n) return [];
    const reduced = order / scale;
    const x =
      reduced === 1n
        ? 0n
        : mod((log / scale) * modularInverse(r1, reduced)!, reduced);
    root = (root * modPow(generator, x, p)) % p;
    unity = (unity * modPow(generator, q ** BigInt(s - shift), p)) % p;
  }

  const roots: bigint[] = [];
  for (let k = 0n, x = root; k < d; k++, x = (x * unity) % p) roots.push(x);
  return roots.sort(ascending);
}

/**
 * Every `x` in [0, p^e) with `xʳ ≡ b (mod p^e)`, ascending; `undefined` past
 * `MAX_LISTED`.
 *
 * A root `x` mod p^k with f'(x) = r·x^(r−1) ≢ 0 (mod p) lifts to exactly one
 * root mod p^(k+1) (Hensel). A singular one (p | r or p | x) lifts to all p of
 * its lifts or to none, by whether f(x) ≡ 0 already holds mod p^(k+1); this is
 * how x² ≡ 0 (mod p^(2k)) reaches its p^k roots.
 */
function rootsModPrimePower(
  b: bigint,
  r: bigint,
  p: bigint,
  e: number,
  deadline: Deadline
): bigint[] | undefined {
  const target = mod(b, p ** BigInt(e));
  let roots: bigint[] | undefined;
  if (p <= SCAN_PRIME) {
    roots = [];
    for (let x = 0n; x < p; x++)
      if (modPow(x, r, p) === target % p) roots.push(x);
  } else if (target % p === 0n) {
    roots = [0n];
  } else {
    roots = rootsModPrimeUnit(target % p, r, p, deadline);
  }
  if (roots === undefined) return undefined;

  let modulus = p;
  for (let k = 1; k < e && roots.length > 0; k++) {
    const next = modulus * p;
    const lifted: bigint[] = [];
    checkDeadline(deadline);
    for (const x of roots) {
      const value = mod(modPow(x, r, next) - target, next); // ≡ 0 (mod p^k)
      const slope = mod(r * modPow(x, r - 1n, p), p);
      if (slope !== 0n) {
        const t = mod(-(value / modulus) * modularInverse(slope, p)!, p);
        lifted.push(x + t * modulus);
      } else if (value === 0n) {
        if (lifted.length + Number(p) > MAX_LISTED) return undefined;
        for (let t = 0n; t < p; t++) lifted.push(x + t * modulus);
      }
    }
    roots = lifted;
    modulus = next;
  }
  return roots.sort(ascending);
}

/**
 * Every `x` in [0, m) with `xʳ ≡ b (mod m)`, ascending, for `r ≥ 1` and
 * `m ≥ 1`; `[]` when there is none. By the Chinese remainder theorem a root
 * mod m is one root in each prime-power channel of m, in every combination.
 * `undefined` when m does not factor within budget or there are more than
 * `MAX_LISTED` roots.
 */
export function powerModRoots(
  b: bigint,
  r: bigint,
  m: bigint,
  deadline?: Deadline
): bigint[] | undefined {
  const roots = powerModRootsOrTooMany(b, r, m, deadline);
  return roots === 'too-many' ? undefined : roots;
}

/**
 * `powerModRoots`, but `'too-many'` when m factors and the roots cannot be
 * listed within `MAX_LISTED` entries, which tells that case apart from a
 * modulus that does not factor. Once m factors, every `undefined` from a
 * prime-power channel is an overflow.
 */
function powerModRootsOrTooMany(
  b: bigint,
  r: bigint,
  m: bigint,
  deadline: Deadline
): bigint[] | 'too-many' | undefined {
  if (r < 1n || m < 1n) return undefined;
  if (m === 1n) return [0n];
  if (r === 1n) return [mod(b, m)];
  const factors = factorBudgeted(m, deadline);
  if (factors === undefined) return undefined;

  // After an overflow the other channels are still solved: one with no root
  // makes the answer `[]`.
  const channels: { modulus: bigint; roots: bigint[] }[] = [];
  let count = 1;
  let tooMany = false;
  for (const [p, e] of factors) {
    const roots = rootsModPrimePower(b, r, p, e, deadline);
    if (roots === undefined) {
      tooMany = true;
      continue;
    }
    if (roots.length === 0) return [];
    count *= roots.length;
    if (count > MAX_LISTED) tooMany = true;
    if (!tooMany) channels.push({ modulus: p ** BigInt(e), roots });
  }
  if (tooMany) return 'too-many';

  // Glue channel by channel: a root mod M·q from x mod M and c mod q is
  // x + M·((c − x)·M⁻¹ mod q), one inverse per channel rather than a full
  // remainder reconstruction per combination.
  let glued = [0n];
  let combined = 1n;
  for (const { modulus, roots } of channels) {
    const inverse = modularInverse(combined, modulus)!;
    glued = glued.flatMap((x) =>
      roots.map((c) => x + combined * mod((c - x) * inverse, modulus))
    );
    combined *= modulus;
  }
  return glued.sort(ascending);
}

/**
 * Every `x` in [0, m) with `xʳ ≡ aˢ (mod m)`, ascending (Mathematica's
 * `PowerModList[a, s/r, m]`), for `r ≥ 1` and `m ≥ 1`. A negative `s` inverts
 * `a`, and `undefined` when `a` is not a unit mod `m`.
 */
export function powerModList(
  a: bigint,
  s: bigint,
  r: bigint,
  m: bigint,
  deadline?: Deadline
): bigint[] | undefined {
  if (r < 1n || m < 1n) return undefined;
  const target = powerTarget(a, s, m);
  if (target === undefined) return undefined;
  return powerModRoots(target, r, m, deadline);
}

/**
 * The least `x` in [0, m) with `xʳ ≡ aˢ (mod m)` (Mathematica's
 * `PowerMod[a, s/r, m]`), for `r ≥ 1` and `m ≥ 1`; `undefined` when there is
 * none, when `a` is not a unit mod `m` and `s < 0`, or when m does not factor
 * within budget.
 *
 * When there are more than `MAX_LISTED` roots, the list is not built: the
 * candidates 0, 1, 2, … below `MAX_LISTED` are tested in order instead, so
 * the least root is found when it is below `MAX_LISTED` (as for
 * x² ≡ 0 (mod 2²⁰⁰), whose least root is 0), and the result is `undefined`
 * otherwise. This test costs at most `MAX_LISTED` exponentiations.
 */
export function leastPowerModRoot(
  a: bigint,
  s: bigint,
  r: bigint,
  m: bigint,
  deadline?: Deadline
): bigint | undefined {
  if (r < 1n || m < 1n) return undefined;
  const target = powerTarget(a, s, m);
  if (target === undefined) return undefined;
  const roots = powerModRootsOrTooMany(target, r, m, deadline);
  if (roots !== 'too-many') return roots?.[0];
  const limit = BigInt(MAX_LISTED) < m ? BigInt(MAX_LISTED) : m;
  for (let x = 0n; x < limit; x++) {
    if (modPow(x, r, m) === target) return x;
    if ((x & 0x3ffn) === 0n) checkDeadline(deadline);
  }
  return undefined;
}

/**
 * `aˢ mod m` in [0, m) for `m ≥ 1`, through the inverse of `a` when `s < 0`;
 * `undefined` when that inverse does not exist.
 */
function powerTarget(a: bigint, s: bigint, m: bigint): bigint | undefined {
  let base = mod(a, m);
  if (s < 0n) {
    const inverse = modularInverse(base, m);
    if (inverse === null) return undefined;
    base = inverse;
  }
  return modPow(base, s < 0n ? -s : s, m);
}

/** The factorization of `n ≥ 1` and the order of the unit `k` in (ℤ/n)ˣ with its factorization. */
function orderWithFactors(
  k: bigint,
  n: bigint,
  deadline: Deadline
): { order: bigint; factors: [bigint, number][] } | undefined {
  if (n < 1n || gcd(mod(k, n), n) !== 1n) return undefined;
  if (n === 1n) return { order: 1n, factors: [] };
  const nFactors = factorBudgeted(n, deadline);
  if (nFactors === undefined) return undefined;
  const lambda = carmichael(nFactors);
  const lambdaFactors = factorBudgeted(lambda, deadline);
  if (lambdaFactors === undefined) return undefined;
  // The order divides λ(n): strip each prime factor of λ(n) while k still
  // raises to 1 without it.
  let order = lambda;
  const factors: [bigint, number][] = [];
  for (const [q, e] of lambdaFactors) {
    if (q === 1n) continue; // λ = 1 factors as {1: 1}
    let kept = e;
    while (kept > 0 && modPow(k, order / q, n) === 1n) {
      order /= q;
      kept -= 1;
    }
    if (kept > 0) factors.push([q, kept]);
  }
  return { order, factors };
}

/**
 * The least `m ≥ 1` with `kᵐ ≡ rᵢ (mod n)` for some `i`: Mathematica's
 * `MultiplicativeOrder[k, n, {r₁, r₂, …}]`, a discrete logarithm. `undefined`
 * when `k` is not a unit mod `n`, no `rᵢ` is a power of `k`, or a prime of the
 * order of `k` is beyond `BSGS_LIMIT`.
 *
 * Pohlig–Hellman over the prime-power factors of the order of `k`, each
 * discrete log by baby-step giant-step, so the cost is set by the largest
 * prime dividing that order (about its square root).
 */
export function generalizedMultiplicativeOrder(
  k: bigint,
  n: bigint,
  targets: readonly bigint[],
  deadline?: Deadline
): bigint | undefined {
  const found = orderWithFactors(k, n, deadline);
  if (found === undefined) return undefined;
  const { order, factors } = found;
  const base = mod(k, n);
  // One set of baby-step tables for every target: the bases depend only on
  // `k` and the prime factors of its order.
  const tables: BabyStepTables = new Map();
  let best: bigint | undefined;
  for (const target of targets) {
    const h = mod(target, n);
    if (n !== 1n && gcd(h, n) !== 1n) continue;
    const residues: bigint[] = [];
    const moduli: bigint[] = [];
    let ok = true;
    for (const [q, e] of factors) {
      const prime = q ** BigInt(e);
      const cofactor = order / prime;
      const x = discreteLogPrimePower(
        modPow(base, cofactor, n),
        modPow(h, cofactor, n),
        q,
        e,
        n,
        deadline,
        tables
      );
      if (x === undefined) {
        ok = false;
        break;
      }
      residues.push(x);
      moduli.push(prime);
    }
    if (!ok) continue;
    const log = chineseRemainder(residues, moduli) ?? 0n;
    if (modPow(base, log, n) !== h % n) continue; // h is outside ⟨k⟩
    const m = log === 0n ? order : log;
    if (best === undefined || m < best) best = m;
  }
  return best;
}

/**
 * The primitive roots of `n` ascending (Mathematica's `PrimitiveRootList[n]`):
 * the generators of (ℤ/n)ˣ, which is cyclic exactly for n = 2, 4, pᵏ and 2pᵏ
 * with p an odd prime. The sign of `n` is ignored. `n = 1` gives `[0]`: the
 * unit group mod 1 is {0}. `n = 0` gives `[]`. `[]` when the group is not
 * cyclic, `undefined` when n does not factor within budget or there are more
 * than `MAX_LISTED` roots.
 *
 * With one generator g found, the others are gᵏ for k coprime to φ(n), and
 * there are φ(φ(n)) of them.
 */
export function primitiveRootList(
  n0: bigint,
  deadline?: Deadline
): bigint[] | undefined {
  const n = n0 < 0n ? -n0 : n0;
  if (n === 0n) return [];
  // The unit group mod 1 is the trivial group {0}, generated by 0.
  if (n === 1n) return [0n];
  if (n === 2n) return [1n];
  if (n === 4n) return [3n];
  const factors = factorBudgeted(n, deadline);
  if (factors === undefined) return undefined;
  const twos = factors.get(2n) ?? 0;
  if (factors.size - (twos > 0 ? 1 : 0) !== 1 || twos > 1) return [];

  const phi = carmichael(factors); // = φ(n): the group is cyclic
  const phiFactors = factorBudgeted(phi, deadline);
  if (phiFactors === undefined) return undefined;
  let count = 1n; // φ(φ(n))
  for (const [q, e] of phiFactors) count *= (q - 1n) * q ** BigInt(e - 1);
  if (count > BigInt(MAX_LISTED)) return undefined;

  let g = 2n;
  for (;;) {
    if (
      gcd(g, n) === 1n &&
      [...phiFactors.keys()].every((q) => modPow(g, phi / q, n) !== 1n)
    )
      break;
    g += 1n;
    checkDeadline(deadline);
  }
  const roots: bigint[] = [];
  let power = 1n;
  for (let k = 1n; k <= phi; k++) {
    power = (power * g) % n;
    if (gcd(k, phi) === 1n) roots.push(power);
    if ((k & 0x3ffn) === 0n) checkDeadline(deadline);
  }
  return roots.sort(ascending);
}

/**
 * The fraction `p/q` with `p ≡ a·q (mod m)`, `|p| ≤ N`, `0 < q ≤ N` and
 * N = ⌊√((m − 1)/2)⌋, as `[p, q]` in lowest terms; `undefined` when there is
 * none (Wang's algorithm). Sage's `rational_reconstruction` uses the bound
 * ⌊√⌊|m|/2⌋⌋ instead, which is one larger when m = 2k² (Sage gives 2 for
 * a = 2, m = 8; this function gives `undefined`), and it accepts m < 0.
 *
 * Under 2·N² < m there is at most one such fraction. It is found by running
 * the extended Euclidean algorithm on (m, a mod m) and stopping at the first
 * remainder that is at most N.
 */
export function rationalReconstruction(
  a: bigint,
  m: bigint
): [bigint, bigint] | undefined {
  if (m < 1n) return undefined;
  const bound = isqrt((m - 1n) / 2n);
  let [r0, r1] = [m, mod(a, m)];
  let [t0, t1] = [0n, 1n];
  while (r1 > bound) {
    const q = r0 / r1;
    [r0, r1] = [r1, r0 - q * r1];
    [t0, t1] = [t1, t0 - q * t1];
  }
  if (t1 === 0n) return undefined;
  const [p, q] = t1 < 0n ? [-r1, -t1] : [r1, t1];
  if (q > bound || gcd(p, q) !== 1n) return undefined;
  return [p, q];
}
