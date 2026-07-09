import type {
  IComputeEngine as ComputeEngine,
  Expression,
} from '../global-types.js';
import {
  MPoly,
  igcd,
  mpolyFromBoxed,
  mpolyToBoxed,
} from './multivariate-poly.js';

/**
 * Multivariate polynomial GCD over ℤ via **Brown's dense modular algorithm**
 * (ROADMAP B11, Stage B).
 *
 * Strategy: compute the GCD modulo a single large prime `p` using Brown's
 * recursive evaluation/interpolation over the field ℤ_p (univariate Euclid at
 * the base, Newton interpolation to climb back up, leading-coefficient scaling
 * to fix the normalization), lift the symmetric representatives to ℤ, take the
 * primitive part, and **verify by exact division**. If verification fails (the
 * prime was too small, or an unlucky evaluation corrupted a step) we retry with
 * a larger prime, then give up — returning `null`, never a wrong answer.
 *
 * Single-prime + retry is used in place of multi-prime CRT: simpler, always
 * correct, and bounded by the prime size (CRT is the future optimization for
 * Fateman-power-7-scale coefficient growth).
 */
export function multivariateGCD(
  ce: ComputeEngine,
  a: Expression,
  b: Expression,
  vars: string[]
): Expression | null {
  const A0 = mpolyFromBoxed(ce, a, vars);
  const B0 = mpolyFromBoxed(ce, b, vars);
  if (!A0 || !B0 || A0.isZero() || B0.isZero()) return null;
  budget = MAX_OPS; // bound total work so a hard input can't churn (→ null)

  // Work with integer-primitive parts; the integer content GCD is folded back.
  const cA = A0.contentInteger();
  const cB = B0.contentInteger();
  const intContent = igcd(cA, cB);
  const A = A0.divExactInteger(cA);
  const B = B0.divExactInteger(cB);

  // Integer content of the main-variable leading coefficients. Brown normalizes
  // each interpolation image so its leading coefficient in x0 equals Γ (the gcd
  // of the leading coefficients); over the field that gcd is monic and drops any
  // constant integer factor (e.g. gcd(2,2) → 1), so we restore it here. For a
  // unit-content leading coefficient this is 1 (no effect).
  const lcContent = igcd(
    leadingCoeffInMainVar(A).contentInteger(),
    leadingCoeffInMainVar(B).contentInteger()
  );

  for (const p of PRIMES) {
    // The prime must not collapse the leading coefficients (degree must be
    // preserved). Cheap check: leading integer coefficients survive mod p.
    if (A.maxNorm() % p === 0n || B.maxNorm() % p === 0n) continue;

    let g: MPoly | null;
    try {
      g = mgcdModP(A.modP(p), B.modP(p), vars, p, lcContent);
    } catch {
      g = null;
    }
    if (!g || g.isZero()) continue;

    // Lift: primitive part over ℤ (symmetric representatives already in range).
    const G = g.primitivePartInteger();

    // Verify: G must divide both inputs exactly over ℤ.
    if (MPoly.tryDivide(A, G) === null || MPoly.tryDivide(B, G) === null)
      continue;

    // Fold the integer content back in (so gcd(2x+2y, 4x) keeps the 2).
    const result = G.scaleInt(intContent).primitivePartInteger();
    const finalG = intContent === 1n ? G : result;
    if (MPoly.tryDivide(A0, finalG) && MPoly.tryDivide(B0, finalG))
      return mpolyToBoxed(ce, finalG);
    return mpolyToBoxed(ce, G);
  }
  return null;
}

// A ladder of primes, smallest first (smaller ⇒ faster bigint arithmetic). The
// driver grows the prime on verification failure — correct for any gcd whose
// integer coefficients fit below p/2. Multi-prime CRT would replace this for the
// large-coefficient (Fateman-scale) regime.
const PRIMES: bigint[] = [
  1000000007n, // 10^9 + 7
  1000000009n, // 10^9 + 9
  998244353n,
  2147483647n, // 2^31 − 1 (Mersenne)
  2305843009213693951n, // 2^61 − 1 (Mersenne)
];

// Total-work budget: Brown's recursion is decremented per multiply; exceeding
// the budget throws, the driver catches it and returns null (a safe defer).
const MAX_OPS = 4_000_000;
let budget = MAX_OPS;
function spend(n: number): void {
  budget -= n;
  if (budget < 0) throw new Error('multivariateGCD: budget exceeded');
}

// ---------------------------------------------------------------------------
// Modular field arithmetic helpers (ℤ_p)
// ---------------------------------------------------------------------------

function mod(a: bigint, p: bigint): bigint {
  const r = a % p;
  return r < 0n ? r + p : r;
}

function modInverse(a: bigint, p: bigint): bigint {
  let [old_r, r] = [mod(a, p), p];
  let [old_s, s] = [1n, 0n];
  while (r !== 0n) {
    const q = old_r / r;
    [old_r, r] = [r, old_r - q * r];
    [old_s, s] = [s, old_s - q * s];
  }
  if (old_r !== 1n) throw new Error('modInverse: not invertible');
  return mod(old_s, p);
}

// ---------------------------------------------------------------------------
// Brown's recursive modular GCD over ℤ_p[vars]
// ---------------------------------------------------------------------------

/** Leading coefficient of `P` in its main variable (index 0), over the others. */
function leadingCoeffInMainVar(P: MPoly): MPoly {
  return P.coeffsInVar(0).at(-1) ?? MPoly.zero(P.vars.slice(1));
}

/**
 * GCD of A, B in ℤ_p[vars]; both nonzero, reduced mod p. Returns a poly mod p.
 * `lcContent` is the integer content of the main-variable leading coefficients
 * (1 except at the top level — see {@link multivariateGCD}); it scales Γ to
 * recover a constant integer factor the field-monic gcd would otherwise drop.
 */
function mgcdModP(
  A: MPoly,
  B: MPoly,
  vars: string[],
  p: bigint,
  lcContent = 1n
): MPoly | null {
  spend(A.nbTerms + B.nbTerms + 1);
  if (vars.length === 0) return MPoly.constant([], 1n); // both nonzero constants
  if (vars.length === 1) return univariateGcdModP(A, B, p);

  // Content with respect to the main variable x0 (= gcd of its coefficients,
  // over the remaining variables), then reduce to primitive parts.
  const rest = vars.slice(1);
  const coA = A.coeffsInVar(0);
  const coB = B.coeffsInVar(0);
  const cA = foldGcdModP(coA, rest, p);
  const cB = foldGcdModP(coB, rest, p);
  if (!cA || !cB) return null;
  const cG = mgcdModP(cA, cB, rest, p);
  if (!cG) return null;

  const ppA = divCoeffsByModP(A, cA, p);
  const ppB = divCoeffsByModP(B, cB, p);
  if (!ppA || !ppB) return null;

  const ppG = brownPrimitiveModP(ppA, ppB, vars, p, lcContent);
  if (!ppG) return null;

  // gcd = contentGcd · primitivePartGcd
  return mulModP(liftToVars(cG, 0, vars), ppG, p).modP(p);
}

/** GCD of two primitive-in-x0 polynomials via evaluation/interpolation in the last var. */
function brownPrimitiveModP(
  A: MPoly,
  B: MPoly,
  vars: string[],
  p: bigint,
  lcContent: bigint
): MPoly | null {
  const rest = vars.slice(1);
  // Γ = gcd of leading coefficients in x0 — fixes the interpolation lc problem.
  // Scaled by the integer content (`lcContent`) the field-monic gcd drops.
  const lcA = A.coeffsInVar(0).at(-1)!;
  const lcB = B.coeffsInVar(0).at(-1)!;
  const ΓPoly = mgcdModP(lcA, lcB, rest, p);
  if (!ΓPoly) return null;
  const Γ = lcContent === 1n ? ΓPoly : scaleByScalarModP(ΓPoly, lcContent, p);
  return mgcdScaledModP(A, B, vars, p, Γ);
}

/**
 * GCD of A, B (primitive in x0) over ℤ_p[vars], normalized so its leading
 * coefficient in x0 equals `Γ` (a polynomial over vars[1..]). Interpolates the
 * last variable; recurses on the rest; monic-univariate at the base.
 */
function mgcdScaledModP(
  A: MPoly,
  B: MPoly,
  vars: string[],
  p: bigint,
  Γ: MPoly
): MPoly | null {
  if (vars.length === 1) {
    // Univariate in x0: monic gcd, then scale so lc == Γ (a constant here).
    const g = univariateGcdModP(A, B, p);
    if (!g) return null;
    const γ = Γ.asConstant();
    if (γ === undefined) return null;
    return scaleByScalarModP(g, mod(γ, p), p).modP(p);
  }

  const lastIdx = vars.length - 1;
  const lastInRest = lastIdx - 1; // index of last var within vars[1..]
  const restVars = vars.filter((_, j) => j !== lastIdx);

  // Degree bound of the gcd in the interpolation variable.
  const dLast = Math.min(A.degreeIn(lastIdx), B.degreeIn(lastIdx));
  // Expected degree of the gcd in x0 (the main var), for bad-point detection.
  let expectDeg0 = -1;

  const points: bigint[] = [];
  const images: MPoly[] = [];

  for (let a = 0n; a < p && points.length <= dLast; a++) {
    // Skip points where the leading-coefficient image vanishes.
    const Γa = evalVarModP(Γ, lastInRest, a, p);
    if (Γa.isZero()) continue;
    const Aa = evalVarModP(A, lastIdx, a, p);
    const Ba = evalVarModP(B, lastIdx, a, p);
    if (Aa.degreeIn(0) < A.degreeIn(0) || Ba.degreeIn(0) < B.degreeIn(0))
      continue; // evaluation dropped the main degree → unlucky point

    const ga = mgcdScaledModP(Aa, Ba, restVars, p, Γa);
    if (!ga) return null;
    const deg0 = ga.degreeIn(0);

    if (expectDeg0 < 0 || deg0 < expectDeg0) {
      // First image, or a lower-degree (so previous points were unlucky): reset.
      expectDeg0 = deg0;
      points.length = 0;
      images.length = 0;
    } else if (deg0 > expectDeg0) {
      continue; // unlucky point: gcd degree too high
    }
    points.push(a);
    images.push(ga);
  }

  if (points.length < dLast + 1) {
    // Not enough good points to interpolate a degree-`dLast` result; but the
    // true gcd degree in the last var may be < dLast, so what we have can still
    // be exact. Interpolation below uses exactly the points collected.
    if (points.length === 0) return null;
  }

  return newtonInterpolateModP(points, images, lastIdx, vars, p);
}

/** Fold a list of polynomials (over `vars`) into their GCD mod p. */
function foldGcdModP(polys: MPoly[], vars: string[], p: bigint): MPoly | null {
  const nz = polys.filter((q) => !q.isZero());
  if (nz.length === 0) return MPoly.zero(vars);
  let g = nz[0];
  for (let i = 1; i < nz.length; i++) {
    const ng = mgcdModP(g, nz[i], vars, p);
    if (!ng) return null;
    g = ng;
    if (g.asConstant() !== undefined) break; // constant gcd: done
  }
  return g;
}

// ---------------------------------------------------------------------------
// Univariate GCD over ℤ_p (dense)
// ---------------------------------------------------------------------------

function univariateGcdModP(A: MPoly, B: MPoly, p: bigint): MPoly | null {
  const vars = A.vars;
  let a = toDense(A, p);
  let b = toDense(B, p);
  while (b.length > 0) {
    const r = remDenseModP(a, b, p);
    a = b;
    b = r;
  }
  // Make monic.
  a = monicDense(a, p);
  return fromDense(a, vars, p);
}

/** Dense coefficient array (index = exponent of the single variable), [0,p). */
function toDense(P: MPoly, p: bigint): bigint[] {
  const d = P.degreeIn(0);
  const out = new Array<bigint>(d + 1).fill(0n);
  for (const [k, c] of P.terms) out[MPoly.exp(k)[0]] = mod(c, p);
  return trimDense(out);
}

function fromDense(d: bigint[], vars: string[], p: bigint): MPoly {
  const r = new MPoly(vars);
  for (let i = 0; i < d.length; i++) {
    const c = mod(d[i], p);
    if (c !== 0n) {
      let v = c;
      if (v > p / 2n) v -= p; // symmetric representative
      r.terms.set(String(i), v);
    }
  }
  return r;
}

function trimDense(d: bigint[]): bigint[] {
  let n = d.length;
  while (n > 0 && d[n - 1] === 0n) n--;
  return d.slice(0, n);
}

function monicDense(d: bigint[], p: bigint): bigint[] {
  if (d.length === 0) return d;
  const inv = modInverse(d[d.length - 1], p);
  return d.map((c) => mod(c * inv, p));
}

/** Remainder of a / b for dense univariate polynomials over ℤ_p. */
function remDenseModP(a: bigint[], b: bigint[], p: bigint): bigint[] {
  const r = a.slice();
  const db = b.length - 1;
  const invLeadB = modInverse(b[db], p);
  for (let i = r.length - 1; i >= db; i--) {
    if (r[i] === 0n) continue;
    const factor = mod(r[i] * invLeadB, p);
    for (let j = 0; j <= db; j++)
      r[i - db + j] = mod(r[i - db + j] - factor * b[j], p);
  }
  return trimDense(r);
}

// ---------------------------------------------------------------------------
// Newton interpolation over ℤ_p with MPoly (over restVars) coefficients
// ---------------------------------------------------------------------------

/**
 * Reconstruct a polynomial over `fullVars` from its images at `points` along
 * the variable `interpIdx`. Each image is a polynomial over fullVars minus that
 * variable. Newton's divided differences over the ring ℤ_p[restVars].
 */
function newtonInterpolateModP(
  points: bigint[],
  images: MPoly[],
  interpIdx: number,
  fullVars: string[],
  p: bigint
): MPoly {
  const m = points.length;
  const dd = images.map((im) => im.modP(p)); // divided-difference table (in place)
  for (let level = 1; level < m; level++) {
    for (let i = m - 1; i >= level; i--) {
      const denomInv = modInverse(mod(points[i] - points[i - level], p), p);
      dd[i] = scaleByScalarModP(dd[i].sub(dd[i - 1]), denomInv, p).modP(p);
    }
  }
  // Horner from the top: H = (((d_m)(x-α_{m-1}) + d_{m-1})(x-α_{m-2}) + …) + d_0
  let H = liftToVars(dd[m - 1], interpIdx, fullVars);
  for (let k = m - 2; k >= 0; k--) {
    const xMinus = xMinusAlpha(interpIdx, points[k], fullVars, p);
    H = mulModP(H, xMinus, p)
      .add(liftToVars(dd[k], interpIdx, fullVars))
      .modP(p);
  }
  return H.modP(p);
}

/** The polynomial (x_interpIdx − α) over fullVars, mod p. */
function xMinusAlpha(
  interpIdx: number,
  alpha: bigint,
  fullVars: string[],
  p: bigint
): MPoly {
  const r = new MPoly(fullVars);
  const e1 = fullVars.map((_, i) => (i === interpIdx ? 1 : 0));
  r.terms.set(MPoly.key(e1), 1n);
  const a = mod(-alpha, p);
  if (a !== 0n)
    r.terms.set(MPoly.key(fullVars.map(() => 0)), a > p / 2n ? a - p : a);
  return r;
}

// ---------------------------------------------------------------------------
// MPoly modular utilities
// ---------------------------------------------------------------------------

function mulModP(a: MPoly, b: MPoly, p: bigint): MPoly {
  spend(a.nbTerms * b.nbTerms + 1);
  return a.mul(b).modP(p);
}

function evalVarModP(a: MPoly, i: number, value: bigint, p: bigint): MPoly {
  // Reduce coefficients mod p as we evaluate (value already a field element).
  return a.evalVar(i, value).modP(p);
}

function scaleByScalarModP(a: MPoly, s: bigint, p: bigint): MPoly {
  return a.scaleInt(mod(s, p)).modP(p);
}

/** Lift a polynomial over fullVars-minus-`insertIdx` to fullVars (exponent 0). */
function liftToVars(poly: MPoly, insertIdx: number, fullVars: string[]): MPoly {
  return MPoly.fromVarCoeffs([poly], insertIdx, fullVars);
}

/**
 * Divide A (over `vars`) by `c` (over vars[1..]) where `c` divides every
 * x0-coefficient of A exactly over ℤ_p. Returns the quotient over `vars`.
 */
function divCoeffsByModP(A: MPoly, c: MPoly, p: bigint): MPoly | null {
  const coeffs = A.coeffsInVar(0);
  const cConst = c.asConstant();
  const out: MPoly[] = [];
  for (const co of coeffs) {
    if (co.isZero()) {
      out.push(co);
      continue;
    }
    if (cConst !== undefined) {
      out.push(scaleByScalarModP(co, modInverse(cConst, p), p));
    } else {
      const q = divExactModP(co, c, p);
      if (!q) return null;
      out.push(q);
    }
  }
  return MPoly.fromVarCoeffs(out, 0, A.vars);
}

/** Exact division a / b over ℤ_p[a.vars] (field coefficients), or null. */
function divExactModP(a: MPoly, b: MPoly, p: bigint): MPoly | null {
  if (b.isZero()) return null;
  const lb = b.leadingLex()!;
  const invLb = modInverse(lb.c, p);
  let r = a.modP(p);
  const q = new MPoly(a.vars);
  let guard = 0;
  while (!r.isZero()) {
    if (++guard > 200000) return null;
    spend(b.nbTerms + 1);
    const lr = r.leadingLex()!;
    if (!lr.exp.every((x, i) => x >= lb.exp[i])) return null;
    const fe = lr.exp.map((x, i) => x - lb.exp[i]);
    const fc = mod(lr.c * invLb, p);
    const term = new MPoly(a.vars);
    term.terms.set(MPoly.key(fe), fc);
    q.terms.set(MPoly.key(fe), fc > p / 2n ? fc - p : fc);
    r = r.sub(b.mul(term)).modP(p);
  }
  return q;
}
