// Stage 2 sampling — a TypeScript port of the *strategy* of pygrim's
// Expr.test() (pygrim/expr.py:961) + Brain.some_values()
// (pygrim/brain.py:5767): fixed exact value pools per base set, and
// assumption-filtered seeded sampling of variable assignments.
//
// Values are exact MathJSON constants (never floats), mirroring Fungrim's
// some_integers / some_rationals / some_reals / some_complexes /
// some_upper_half_plane pools.

export type Json = unknown;

// --- seeded RNG -------------------------------------------------------------

/** mulberry32 — small deterministic PRNG */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** FNV-1a over a string — derive a per-entry seed so results are independent
 * of iteration order. */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

// --- value pools ------------------------------------------------------------

const HALF: Json = ['Rational', 1, 2];
const NEG_HALF: Json = ['Rational', -1, 2];
const I: Json = 'ImaginaryUnit';

export const POOLS: Record<string, Json[]> = {
  integer: [0, 1, -1, 2, -2, 3, -3, 4, 5, 10],
  nonnegativeInteger: [0, 1, 2, 3, 4, 5, 10],
  positiveInteger: [1, 2, 3, 4, 5, 10],
  nonpositiveInteger: [0, -1, -2, -3],
  negativeInteger: [-1, -2, -3],
  prime: [2, 3, 5, 7, 11],
  rational: [
    0, 1, -1, 2, -2, 3,
    HALF, NEG_HALF,
    ['Rational', 3, 2], ['Rational', 1, 3], ['Rational', -2, 3],
    ['Rational', 1, 4],
  ],
  real: [
    0, 1, -1, 2, -2,
    HALF, NEG_HALF, ['Rational', 3, 2],
    ['Sqrt', 2], ['Negate', ['Sqrt', 2]],
    'Pi', ['Negate', 'Pi'], ['Divide', 'Pi', 2],
  ],
  complex: [
    0, 1, -1, 2,
    HALF, NEG_HALF,
    ['Sqrt', 2], 'Pi',
    I, ['Negate', I],
    ['Add', HALF, ['Multiply', HALF, I]],
    ['Subtract', ['Multiply', 2, I], 1],
    ['Add', 1, I],
  ],
  // τ in the upper half plane: Im(τ) > 0 (Fungrim some_upper_half_plane)
  upperHalfPlane: [
    I,
    ['Multiply', 2, I],
    ['Add', HALF, I],
    ['Divide', ['Add', 1, ['Multiply', I, ['Sqrt', 3]]], 2],
    ['Add', ['Negate', HALF], ['Multiply', 2, I]],
  ],
};

/**
 * Pick the value pool for a variable from the (raw MathJSON) domain of its
 * `Element` conjunct. Returns the default complex pool when the domain is
 * absent or not recognized.
 */
export function poolForDomain(dom: Json): Json[] {
  if (dom === undefined || dom === null) return POOLS.complex;
  if (typeof dom === 'string') {
    switch (dom) {
      case 'Integers':
        return POOLS.integer;
      case 'NonNegativeIntegers':
        return POOLS.nonnegativeInteger;
      case 'PositiveIntegers':
        return POOLS.positiveInteger;
      case 'NonPositiveIntegers':
        return POOLS.nonpositiveInteger;
      case 'NegativeIntegers':
        return POOLS.negativeInteger;
      case 'Primes':
        return POOLS.prime;
      case 'RationalNumbers':
        return POOLS.rational;
      case 'RealNumbers':
        return POOLS.real;
      case 'HH':
        return POOLS.upperHalfPlane;
      default:
        return POOLS.complex;
    }
  }
  if (Array.isArray(dom)) {
    const h = dom[0];
    if (h === 'Range') {
      const lo = typeof dom[1] === 'number' ? dom[1] : undefined;
      const hi = typeof dom[2] === 'number' ? dom[2] : undefined;
      if (lo !== undefined && hi !== undefined) {
        const out: Json[] = [];
        for (let k = lo; k <= Math.min(hi, lo + 9); k++) out.push(k);
        return out;
      }
      if (lo !== undefined) return [lo, lo + 1, lo + 2, lo + 3, lo + 5];
      if (hi !== undefined) return [hi, hi - 1, hi - 2, hi - 3];
      return POOLS.integer;
    }
    if (h === 'Interval') {
      // Sample exact rationals strictly inside the interval when the
      // endpoints are simple literals; otherwise fall back to the real pool
      // (the assumption filter rejects out-of-domain picks when CE can
      // decide membership).
      const num = (x: Json): number | undefined => {
        let v = x;
        if (Array.isArray(v) && v[0] === 'Open') v = v[1];
        if (typeof v === 'number') return v;
        if (v === 'PositiveInfinity') return Infinity;
        if (v === 'NegativeInfinity') return -Infinity;
        if (v === 'Pi') return Math.PI;
        if (Array.isArray(v) && v[0] === 'Negate') {
          const inner = num(v[1]);
          return inner === undefined ? undefined : -inner;
        }
        return undefined;
      };
      const lo = num(dom[1]);
      const hi = num(dom[2]);
      if (lo !== undefined && hi !== undefined && lo < hi) {
        const candidates: [Json, number][] = [
          [0, 0], [1, 1], [-1, -1], [2, 2], [-2, -2],
          [HALF, 0.5], [NEG_HALF, -0.5],
          [['Rational', 3, 2], 1.5], [['Rational', 1, 4], 0.25],
          [['Rational', 9, 4], 2.25], [3, 3], [5, 5], [10, 10],
        ];
        const inside = candidates
          .filter(([, v]) => v > lo + 1e-12 && v < hi - 1e-12)
          .map(([j]) => j);
        if (inside.length > 0) return inside;
      }
      return POOLS.real;
    }
    if (h === 'Divisors') return POOLS.positiveInteger;
    if (h === 'SetMinus') return poolForDomain(dom[1]);
    if (h === 'Union') return poolForDomain(dom[1]);
    if (h === 'Set') return (dom as Json[]).slice(1);
  }
  return POOLS.complex;
}

// --- assignment generation --------------------------------------------------

export type Assignment = Record<string, Json>;

/**
 * Generate up to `maxCandidates` distinct random assignments (variable →
 * exact MathJSON value), seeded deterministically. Candidate order is the
 * deterministic shuffle order; the caller filters by assumptions and caps
 * accepted instances.
 */
export function generateAssignments(
  variables: string[],
  domains: Record<string, Json>,
  seed: number,
  maxCandidates: number
): Assignment[] {
  if (variables.length === 0) return [{}];
  const rng = mulberry32(seed);
  const pools = variables.map((v) => poolForDomain(domains[v]));
  const seen = new Set<string>();
  const out: Assignment[] = [];
  const space = pools.reduce((acc, p) => acc * p.length, 1);
  const tries = Math.min(maxCandidates * 4, space * 2, 400);
  for (let t = 0; t < tries && out.length < maxCandidates; t++) {
    const a: Assignment = {};
    for (let i = 0; i < variables.length; i++) {
      const pool = pools[i];
      a[variables[i]] = pool[Math.floor(rng() * pool.length)];
    }
    const key = JSON.stringify(a);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(a);
  }
  return out;
}
