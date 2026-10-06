import { Complex } from 'complex.js';
import { stieltjesGammaComplex } from './stieltjes.js';

// Dirichlet characters mod k and the Laurent expansion of their L-functions at
// s = 1, in Wolfram's indexing: DirichletCharacter(k, j, n), j = 1 … φ(k),
// j = 1 the principal character.
//
// The indexing is not documented as a formula, so it was read off Wolfram's
// kernel and is pinned by its values (see the tests): write (ℤ/k)^× as a
// product of cyclic groups, one per prime-power factor of k in ascending prime
// order — an odd p^e contributes ⟨g⟩ with g the least primitive root, 2²
// contributes ⟨−1⟩, and 2^e (e ≥ 3) contributes ⟨−1⟩ × ⟨5⟩ in that order. A
// character is an exponent vector (aᵢ) against those generators, and j − 1 is
// its mixed-radix reading with the FIRST component most significant:
//   χ_j(n) = Π exp(2πi · aᵢ bᵢ / ordᵢ),   n ≡ Π gᵢ^{bᵢ}.
// So for a prime k with primitive root g, χ_j(g) = e^{2πi (j−1)/φ(k)}.

/**
 * Largest modulus the character kernel works with. Its discrete logarithms are
 * found by stepping through a cyclic group, so the cost grows with k.
 */
export const DIRICHLET_MAX_MODULUS = 100000;

interface Component {
  /** Generator of this cyclic factor, as a residue mod its prime power. */
  readonly gen: number;
  readonly ord: number;
  /** The prime power. */
  readonly modulus: number;
}

function modPow(b: number, e: number, m: number): number {
  let r = 1 % m;
  b %= m;
  while (e > 0) {
    if (e & 1) r = (r * b) % m;
    b = (b * b) % m;
    e >>= 1;
  }
  return r;
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

/** Prime-power factorisation of k, ascending: [[p, e], …]. */
function factorize(k: number): [number, number][] {
  const out: [number, number][] = [];
  for (let p = 2; p * p <= k; p++) {
    if (k % p) continue;
    let e = 0;
    while (k % p === 0) {
      k /= p;
      e++;
    }
    out.push([p, e]);
  }
  if (k > 1) out.push([k, 1]);
  return out;
}

/** Least primitive root mod p^e, p an odd prime. */
function primitiveRoot(p: number, e: number): number {
  const m = p ** e;
  const phi = (p - 1) * p ** (e - 1);
  const primes = factorize(phi).map(([q]) => q);
  for (let g = 2; g < m; g++) {
    if (g % p === 0) continue;
    if (primes.every((q) => modPow(g, phi / q, m) !== 1)) return g;
  }
  throw new Error(`no primitive root mod ${m}`);
}

const componentCache = new Map<number, Component[]>();

/** The cyclic decomposition of (ℤ/k)^×, in Wolfram's order. */
function components(k: number): Component[] {
  const hit = componentCache.get(k);
  if (hit) return hit;
  const out: Component[] = [];
  for (const [p, e] of factorize(k)) {
    const modulus = p ** e;
    if (p === 2) {
      if (e === 2) out.push({ gen: 3, ord: 2, modulus });
      else if (e >= 3) {
        out.push({ gen: modulus - 1, ord: 2, modulus });
        out.push({ gen: 5, ord: modulus / 4, modulus });
      }
    } else {
      out.push({
        gen: primitiveRoot(p, e),
        ord: (p - 1) * p ** (e - 1),
        modulus,
      });
    }
  }
  componentCache.set(k, out);
  return out;
}

/** φ(k), the number of characters mod k, as the product of the component orders. */
export function dirichletCharacterCount(k: number): number {
  return components(k).reduce((p, c) => p * c.ord, 1);
}

/** Exponent vector of n against the generators: n ≡ Π genᵢ^{bᵢ}. */
function discreteLog(comps: Component[], n: number): number[] {
  const b: number[] = [];
  for (let i = 0; i < comps.length; i++) {
    const c = comps[i];
    let target = n % c.modulus;
    // For 2^e (e ≥ 3) the −1 and 5 components share a modulus: peel ⟨−1⟩ off
    // first, so that the 5-component sees a residue ≡ 1 mod 4.
    if (c.modulus % 8 === 0 && c.gen === c.modulus - 1) {
      const sign = target % 4 === 3 ? 1 : 0;
      b.push(sign);
      const next = comps[i + 1];
      target = sign ? (c.modulus - target) % c.modulus : target;
      let e = 0;
      let x = 1;
      while (x !== target) {
        x = (x * next.gen) % c.modulus;
        e++;
      }
      b.push(e);
      i++;
      continue;
    }
    let e = 0;
    let x = 1 % c.modulus;
    while (x !== target) {
      x = (x * c.gen) % c.modulus;
      e++;
    }
    b.push(e);
  }
  return b;
}

/** Exponent vector of the j-th character: j − 1 in mixed radix, first component most significant. */
function exponents(comps: Component[], j: number): number[] {
  let rest = j - 1;
  const a = Array.from<number>({ length: comps.length });
  for (let i = comps.length - 1; i >= 0; i--) {
    a[i] = rest % comps[i].ord;
    rest = Math.floor(rest / comps[i].ord);
  }
  return a;
}

/**
 * χ_j(n) mod k as a reduced rational exponent [num, den], num/den ∈ [0, 1): the
 * value is e^{2πi·num/den}. `undefined` when gcd(n, k) > 1 (the character is 0
 * there) or when k or j is out of range.
 */
export function dirichletCharacterExponent(
  k: number,
  j: number,
  n: number
): [number, number] | undefined {
  if (!(k >= 1 && k <= DIRICHLET_MAX_MODULUS)) return undefined;
  if (!(j >= 1 && j <= dirichletCharacterCount(k))) return undefined;
  n = ((n % k) + k) % k;
  if (gcd(n === 0 ? k : n, k) !== 1) return undefined;
  const comps = components(k);
  const a = exponents(comps, j);
  const b = discreteLog(comps, n);
  // Σ aᵢ bᵢ / ordᵢ, reduced mod 1.
  let num = 0;
  let den = 1;
  for (let i = 0; i < comps.length; i++) {
    const ord = comps[i].ord;
    num = num * ord + a[i] * b[i] * den;
    den *= ord;
    const g = gcd(num, den);
    num /= g;
    den /= g;
  }
  num = ((num % den) + den) % den;
  return [num, den];
}

// --- L(s, χ) near s = 1 -------------------------------------------------------

/** The number of Laurent terms summed at most; past it the series is declined. */
const LAURENT_TERMS = 24;
/** The Laurent sum stops once a term is this small next to the running value. */
const LAURENT_TOLERANCE = 1e-17;

/** e^{2πi·num/den}, exact at the quarter turns. */
function rootOfUnity([num, den]: [number, number]): Complex {
  if (num === 0) return new Complex(1, 0);
  if (2 * num === den) return new Complex(-1, 0);
  if (4 * num === den) return new Complex(0, 1);
  if (4 * num === 3 * den) return new Complex(0, -1);
  const angle = (2 * Math.PI * num) / den;
  return new Complex(Math.cos(angle), Math.sin(angle));
}

/**
 * L(s, χ_j mod k) for a non-principal χ near s = 1, summed from
 *   L(s, χ) = k^{−s} Σ_r χ(r) Σₙ (−1)ⁿ γₙ(r/k) (s−1)ⁿ / n!.
 * The Hurwitz form Σ_r χ(r) ζ(s, r/k) k^{−s} cancels the poles of the ζ and
 * loses about log₁₀(1/|s−1|) digits there; this form does not. Double
 * precision. `undefined` when the series has not converged within the cap.
 */
export function dirichletLNearOne(
  k: number,
  j: number,
  s: Complex
): Complex | undefined {
  const d = new Complex(s.re - 1, s.im); // s − 1
  let total = new Complex(0, 0);
  for (let r = 1; r <= k; r++) {
    const q = dirichletCharacterExponent(k, j, r);
    if (q === undefined) continue;
    const chi = rootOfUnity(q);
    let term = new Complex(1, 0); // (−1)ⁿ (s−1)ⁿ / n!
    let acc = new Complex(0, 0);
    let converged = false;
    for (let n = 0; n < LAURENT_TERMS; n++) {
      const g = stieltjesGammaComplex(n, new Complex(r / k, 0))?.re;
      if (g === undefined) return undefined;
      acc = acc.add(term.mul(g));
      term = term.mul(d).mul(-1 / (n + 1));
      if (term.abs() * Math.abs(g) < LAURENT_TOLERANCE) {
        converged = true;
        break;
      }
    }
    if (!converged) return undefined;
    total = total.add(chi.mul(acc));
  }
  return total.mul(new Complex(k).pow(new Complex(-s.re, -s.im)));
}
