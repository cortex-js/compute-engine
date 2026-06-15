import { Complex } from 'complex-esm';
import './complex-esm-augment'; // adds the 1-arg `Complex.equals` overload

// Lanczos approximation coefficients (g = 7, n = 9), accurate to ~15 digits
// for the principal branch. See Numerical Recipes / mathjs gamma().
const LANCZOS_G = 7;
const LANCZOS_P = [
  0.99999999999980993, 676.5203681218851, -1259.1392167224028,
  771.32342877765313, -176.61502916214059, 12.507343278686905,
  -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
];

const SQRT_2PI = Math.sqrt(2 * Math.PI);
const HALF_LOG_2PI = 0.5 * Math.log(2 * Math.PI);

/**
 * Gamma function for a complex argument, via the Lanczos approximation.
 *
 * Uses the reflection formula Γ(z)·Γ(1−z) = π / sin(πz) for Re(z) < 0.5 so the
 * series converges on the whole complex plane (except at the non-positive
 * integer poles, where the result is a (signed) infinity / NaN).
 */
export function gamma(c: Complex): Complex {
  if (c.re < 0.5) {
    // Γ(z) = π / (sin(πz) · Γ(1 − z))
    const sinPiZ = c.mul(Math.PI).sin();
    return new Complex(Math.PI, 0).div(
      sinPiZ.mul(gamma(new Complex(1, 0).sub(c)))
    );
  }

  const z = c.sub(1);
  let x = new Complex(LANCZOS_P[0], 0);
  for (let i = 1; i < LANCZOS_G + 2; i++)
    x = x.add(new Complex(LANCZOS_P[i], 0).div(z.add(i)));

  const t = z.add(LANCZOS_G + 0.5);

  // √(2π) · t^(z + 0.5) · e^(−t) · x
  return new Complex(SQRT_2PI, 0)
    .mul(t.pow(z.add(0.5)))
    .mul(t.neg().exp())
    .mul(x);
}

/**
 * Natural logarithm of the Gamma function for a complex argument (principal
 * branch), via the Lanczos approximation.
 */
export function gammaln(c: Complex): Complex {
  if (c.re < 0.5) {
    // log Γ(z) = log(π / sin(πz)) − log Γ(1 − z)
    const sinPiZ = c.mul(Math.PI).sin();
    return new Complex(Math.PI, 0)
      .div(sinPiZ)
      .log()
      .sub(gammaln(new Complex(1, 0).sub(c)));
  }

  const z = c.sub(1);
  let x = new Complex(LANCZOS_P[0], 0);
  for (let i = 1; i < LANCZOS_G + 2; i++)
    x = x.add(new Complex(LANCZOS_P[i], 0).div(z.add(i)));

  const t = z.add(LANCZOS_G + 0.5);

  // 0.5·log(2π) + (z + 0.5)·log(t) − t + log(x)
  return new Complex(HALF_LOG_2PI, 0)
    .add(z.add(0.5).mul(t.log()))
    .sub(t)
    .add(x.log());
}

const C_NAN = new Complex(NaN, NaN);
const C_ONE = new Complex(1, 0);
const C_ZERO = new Complex(0, 0);

//
// ---------------- Arithmetic-geometric mean (complex) ----------------
//

/**
 * Complex arithmetic-geometric mean using the "optimal" branch choice:
 * at each step pick the square root with |aₙ₊₁ − bₙ₊₁| ≤ |aₙ₊₁ + bₙ₊₁|.
 */
export function agmComplex(a: Complex, b: Complex): Complex {
  if (a.isNaN() || b.isNaN()) return C_NAN;
  if (a.isZero() || b.isZero()) return new Complex(0, 0);
  for (let i = 0; i < 100; i++) {
    const an = a.add(b).mul(0.5);
    let bn = a.mul(b).sqrt();
    if (an.sub(bn).abs() > an.add(bn).abs()) bn = bn.neg();
    a = an;
    b = bn;
    if (a.sub(b).abs() <= 1e-17 * a.abs()) break;
  }
  return a.add(b).mul(0.5);
}

//
// ---------------- Complete elliptic integrals (complex, parameter m = k²) ----------------
//

/** Complex K(m) = π/(2·agm(1, √(1−m))), principal branch. */
export function ellipticKComplex(m: Complex): Complex {
  if (m.isNaN()) return C_NAN;
  if (m.equals(C_ONE)) return new Complex(Infinity, 0);
  return new Complex(Math.PI / 2, 0).div(
    agmComplex(C_ONE, C_ONE.sub(m).sqrt())
  );
}

/**
 * Complex E(m) via the AGM cₙ-sum (analytic continuation of A&S 17.6.4):
 * E = K·(1 − Σₙ 2^{n−1}cₙ²), c₀² = m, cₙ = (aₙ₋₁ − bₙ₋₁)/2.
 */
export function ellipticEComplex(m: Complex): Complex {
  if (m.isNaN()) return C_NAN;
  if (m.equals(C_ONE)) return C_ONE;
  let a: Complex = C_ONE;
  let b: Complex = C_ONE.sub(m).sqrt();
  let sum: Complex = m.mul(0.5); // 2^{−1}·c₀²
  let pow2 = 0.5;
  for (let i = 0; i < 100; i++) {
    const c = a.sub(b).mul(0.5);
    const an = a.add(b).mul(0.5);
    let bn = a.mul(b).sqrt();
    if (an.sub(bn).abs() > an.add(bn).abs()) bn = bn.neg();
    a = an;
    b = bn;
    pow2 *= 2;
    sum = sum.add(c.mul(c).mul(pow2));
    if (a.sub(b).abs() <= 1e-17 * a.abs()) break;
  }
  const K = new Complex(Math.PI / 2, 0).div(a);
  return K.mul(C_ONE.sub(sum));
}

//
// ---------------- Carlson symmetric elliptic integrals (complex) ----------------
//
// Duplication-theorem algorithms (Carlson 1995, same series tails as the
// machine-real kernels in numerics/special-functions.ts and as mpmath).
// With principal-branch square roots the duplication theorem is valid for
// arguments in the cut plane C ∖ (−∞, 0); arguments ON the negative real
// axis are evaluated as their boundary value from above (Im → 0⁺), which
// matches the mpmath/Mathematica convention for the incomplete elliptic
// integrals built on them.
//

const CARLSON_TOL_C = 1e-24;

/** Carlson R_C(x, y), complex, principal value for y on (−∞, 0). */
export function carlsonRCComplex(x: Complex, y: Complex): Complex {
  if (x.isNaN() || y.isNaN()) return C_NAN;
  if (y.isZero()) return new Complex(Infinity, 0);
  if (x.isZero()) return new Complex(Math.PI / 2, 0).div(y.sqrt());
  // Cauchy principal value for real y < 0 (DLMF 19.2.20)
  if (y.im === 0 && y.re < 0)
    return x
      .div(x.sub(y))
      .sqrt()
      .mul(carlsonRCComplex(x.sub(y), y.neg()));
  if (x.equals(y)) return x.sqrt().inverse();
  // Near-degenerate y ≈ x: series Σₖ (−e)ᵏ/(2k+1) (same conditioning
  // issue as the real kernel: acos at arguments → 1)
  const e = y.sub(x).div(x);
  if (e.abs() < 0.01) {
    let sum = C_ZERO;
    let term = C_ONE;
    for (let k = 0; k < 10; k++) {
      sum = sum.add(term.div(2 * k + 1));
      term = term.mul(e).neg();
    }
    return sum.div(x.sqrt());
  }
  // v = acos(√x/√y) / (√(1 − x/y)·√y)
  const sx = x.sqrt();
  const sy = y.sqrt();
  return sx
    .div(sy)
    .acos()
    .div(C_ONE.sub(x.div(y)).sqrt().mul(sy));
}

/** Carlson R_F(x, y, z), complex (cut plane). */
export function carlsonRFComplex(x: Complex, y: Complex, z: Complex): Complex {
  if (x.isNaN() || y.isNaN() || z.isNaN()) return C_NAN;
  if (y.equals(z)) return carlsonRCComplex(x, y);
  if (x.equals(z)) return carlsonRCComplex(y, x);
  if (x.equals(y)) return carlsonRCComplex(z, x);
  if ((x.isZero() ? 1 : 0) + (y.isZero() ? 1 : 0) + (z.isZero() ? 1 : 0) > 1)
    return new Complex(Infinity, 0);

  const A0 = x.add(y).add(z).div(3);
  const Q =
    Math.pow(3 * CARLSON_TOL_C, -1 / 6) *
    Math.max(A0.sub(x).abs(), A0.sub(y).abs(), A0.sub(z).abs());
  let xm = x;
  let ym = y;
  let zm = z;
  let A = A0;
  let pow4 = 1;
  for (let i = 0; i < 64 && pow4 * Q >= A.abs(); i++) {
    const sx = xm.sqrt();
    const sy = ym.sqrt();
    const sz = zm.sqrt();
    const lm = sx.mul(sy).add(sx.mul(sz)).add(sy.mul(sz));
    A = A.add(lm).div(4);
    xm = xm.add(lm).div(4);
    ym = ym.add(lm).div(4);
    zm = zm.add(lm).div(4);
    pow4 /= 4;
  }
  const t = A.inverse().mul(pow4);
  const X = A0.sub(x).mul(t);
  const Y = A0.sub(y).mul(t);
  const Z = X.add(Y).neg();
  const E2 = X.mul(Y).sub(Z.mul(Z));
  const E3 = X.mul(Y).mul(Z);
  // (9240 − 924·E2 + 385·E2² + 660·E3 − 630·E2·E3)/9240 / √A
  const series = new Complex(9240, 0)
    .sub(E2.mul(924))
    .add(E2.mul(E2).mul(385))
    .add(E3.mul(660))
    .sub(E2.mul(E3).mul(630))
    .div(9240);
  return series.div(A.sqrt());
}

/**
 * Carlson R_J(x, y, z, p), complex, via the duplication theorem. Only the
 * argument configurations for which the duplication theorem is known to be
 * valid are evaluated (mpmath's criterion): Re x, Re y, Re z ≥ 0 with
 * Re p > 0; or p equal to one of x, y, z; or one argument nonnegative real
 * with the other two complex conjugates and p not on (−∞, 0]. Other
 * configurations return NaN (mpmath falls back to contour integration
 * there; we do not).
 */
export function carlsonRJComplex(
  x: Complex,
  y: Complex,
  z: Complex,
  p: Complex
): Complex {
  if (x.isNaN() || y.isNaN() || z.isNaN() || p.isNaN()) return C_NAN;
  if (p.isZero()) return new Complex(Infinity, 0);
  if ((x.isZero() ? 1 : 0) + (y.isZero() ? 1 : 0) + (z.isZero() ? 1 : 0) > 1)
    return new Complex(Infinity, 0);

  let ok = x.re >= 0 && y.re >= 0 && z.re >= 0 && p.re > 0;
  if (!ok && (x.equals(p) || y.equals(p) || z.equals(p))) ok = true;
  if (!ok && (p.im !== 0 || p.re >= 0)) {
    const conj = (a: Complex, b: Complex): boolean =>
      a.re === b.re && a.im === -b.im;
    if (x.im === 0 && x.re >= 0 && conj(y, z)) ok = true;
    else if (y.im === 0 && y.re >= 0 && conj(x, z)) ok = true;
    else if (z.im === 0 && z.re >= 0 && conj(x, y)) ok = true;
  }
  if (!ok) return C_NAN;

  const A0 = x.add(y).add(z).add(p.mul(2)).div(5);
  const delta = p.sub(x).mul(p.sub(y)).mul(p.sub(z));
  const Q =
    Math.pow(0.25 * CARLSON_TOL_C, -1 / 6) *
    Math.max(
      A0.sub(x).abs(),
      A0.sub(y).abs(),
      A0.sub(z).abs(),
      A0.sub(p).abs()
    );
  let xm = x;
  let ym = y;
  let zm = z;
  let pm = p;
  let A = A0;
  let pow4 = 1;
  let S = C_ZERO;
  for (let i = 0; i < 64; i++) {
    const sx = xm.sqrt();
    const sy = ym.sqrt();
    const sz = zm.sqrt();
    const sp = pm.sqrt();
    const lm = sx.mul(sy).add(sx.mul(sz)).add(sy.mul(sz));
    const A1 = A.add(lm).div(4);
    xm = xm.add(lm).div(4);
    ym = ym.add(lm).div(4);
    zm = zm.add(lm).div(4);
    pm = pm.add(lm).div(4);
    const dm = sp.add(sx).mul(sp.add(sy)).mul(sp.add(sz));
    const em = delta.mul(pow4 * pow4 * pow4).div(dm.mul(dm));
    if (pow4 * Q < A.abs()) break;
    S = S.add(carlsonRCComplex(C_ONE, C_ONE.add(em)).mul(pow4).div(dm));
    pow4 /= 4;
    A = A1;
  }
  const t = A.inverse().mul(pow4);
  const X = A0.sub(x).mul(t);
  const Y = A0.sub(y).mul(t);
  const Z = A0.sub(z).mul(t);
  const P = X.add(Y).add(Z).div(-2);
  const E2 = X.mul(Y).add(X.mul(Z)).add(Y.mul(Z)).sub(P.mul(P).mul(3));
  const E3 = X.mul(Y).mul(Z).add(E2.mul(P).mul(2)).add(P.mul(P).mul(P).mul(4));
  const E4 = X.mul(Y)
    .mul(Z)
    .mul(2)
    .add(E2.mul(P))
    .add(P.mul(P).mul(P).mul(3))
    .mul(P);
  const E5 = X.mul(Y).mul(Z).mul(P).mul(P);
  const series = new Complex(24024, 0)
    .sub(E2.mul(5148))
    .add(E2.mul(E2).mul(2457))
    .add(E3.mul(4004))
    .sub(E2.mul(E3).mul(4158))
    .sub(E4.mul(3276))
    .add(E5.mul(2772))
    .div(24024);
  return series.mul(pow4).div(A.pow(1.5)).add(S.mul(6));
}

/** Carlson R_D(x, y, z) = R_J(x, y, z, z), complex. */
export function carlsonRDComplex(x: Complex, y: Complex, z: Complex): Complex {
  return carlsonRJComplex(x, y, z, z);
}

//
// ---------------- Incomplete elliptic integrals (complex) ----------------
//
// Same Legendre/parameter conventions as the machine-real kernels
// (numerics/special-functions.ts): the last argument is the PARAMETER
// m = k². Reductions: DLMF 19.25.5 / 19.25.9 / 19.25.14, with the
// quasi-periodic extension for |Re φ| > π/2.
//

/** Incomplete elliptic integral of the first kind F(φ|m), complex. */
export function ellipticFComplex(phi: Complex, m: Complex): Complex {
  if (phi.isNaN() || m.isNaN()) return C_NAN;
  if (Math.abs(phi.re) > Math.PI / 2) {
    // F(φ + kπ|m) = F(φ|m) + 2k·K(m)
    const k = Math.round(phi.re / Math.PI);
    const K = ellipticKComplex(m);
    if (K.isNaN() || !Number.isFinite(K.re)) return C_NAN;
    return K.mul(2 * k).add(ellipticFComplex(phi.sub(k * Math.PI), m));
  }
  const s = phi.sin();
  const c = phi.cos();
  const y = C_ONE.sub(m.mul(s).mul(s));
  return s.mul(carlsonRFComplex(c.mul(c), y, C_ONE));
}

/** Incomplete elliptic integral of the second kind E(φ|m), complex. */
export function ellipticEIncompleteComplex(phi: Complex, m: Complex): Complex {
  if (phi.isNaN() || m.isNaN()) return C_NAN;
  if (Math.abs(phi.re) > Math.PI / 2) {
    // E(φ + kπ|m) = E(φ|m) + 2k·E(m)
    const k = Math.round(phi.re / Math.PI);
    const E = ellipticEComplex(m);
    if (E.isNaN() || !Number.isFinite(E.re)) return C_NAN;
    return E.mul(2 * k).add(
      ellipticEIncompleteComplex(phi.sub(k * Math.PI), m)
    );
  }
  const s = phi.sin();
  const c = phi.cos();
  const cc = c.mul(c);
  const y = C_ONE.sub(m.mul(s).mul(s));
  return s.mul(carlsonRFComplex(cc, y, C_ONE)).sub(
    m
      .div(3)
      .mul(s.pow(3))
      .mul(carlsonRDComplex(cc, y, C_ONE))
  );
}

/** Complete elliptic integral of the third kind Π(n|m), complex. */
export function ellipticPiCompleteComplex(n: Complex, m: Complex): Complex {
  if (n.isNaN() || m.isNaN()) return C_NAN;
  if (n.equals(C_ONE) || m.equals(C_ONE)) return new Complex(Infinity, 0);
  // Π(n|m) = R_F(0, 1−m, 1) + (n/3)·R_J(0, 1−m, 1, 1−n)
  return carlsonRFComplex(C_ZERO, C_ONE.sub(m), C_ONE).add(
    n.div(3).mul(carlsonRJComplex(C_ZERO, C_ONE.sub(m), C_ONE, C_ONE.sub(n)))
  );
}

/** Incomplete elliptic integral of the third kind Π(n; φ|m), complex. */
export function ellipticPiIncompleteComplex(
  n: Complex,
  phi: Complex,
  m: Complex
): Complex {
  if (n.isNaN() || phi.isNaN() || m.isNaN()) return C_NAN;
  if (Math.abs(phi.re) > Math.PI / 2) {
    // Π(n; φ + kπ|m) = Π(n; φ|m) + 2k·Π(n|m)
    const k = Math.round(phi.re / Math.PI);
    const P = ellipticPiCompleteComplex(n, m);
    if (P.isNaN() || !Number.isFinite(P.re)) return C_NAN;
    return P.mul(2 * k).add(
      ellipticPiIncompleteComplex(n, phi.sub(k * Math.PI), m)
    );
  }
  const s = phi.sin();
  const c = phi.cos();
  const cc = c.mul(c);
  const ss = s.mul(s);
  const y = C_ONE.sub(m.mul(ss));
  const p = C_ONE.sub(n.mul(ss));
  if (p.isZero()) return new Complex(Infinity, 0);
  return s.mul(carlsonRFComplex(cc, y, C_ONE)).add(
    n
      .div(3)
      .mul(s.pow(3))
      .mul(carlsonRJComplex(cc, y, C_ONE, p))
  );
}

//
// ---------------- Hypergeometric functions (complex) ----------------
//

function isNonPositiveIntegerC(x: Complex): boolean {
  return x.im === 0 && Number.isInteger(x.re) && x.re <= 0;
}

function gauss2F1SeriesC(
  a: Complex,
  b: Complex,
  c: Complex,
  z: Complex,
  maxTerms = 10_000
): Complex {
  let term: Complex = C_ONE;
  let sum: Complex = C_ONE;
  for (let n = 0; n < maxTerms; n++) {
    term = term
      .mul(a.add(n))
      .mul(b.add(n))
      .mul(z)
      .div(c.add(n).mul(n + 1));
    if (term.isZero()) return sum;
    sum = sum.add(term);
    if (n > 2 && term.abs() <= Number.EPSILON * sum.abs()) return sum;
  }
  return sum;
}

/** Distance from a complex number to the nearest (real) integer. */
function distToIntegerC(x: Complex): number {
  if (Number.isNaN(x.re) || Number.isNaN(x.im)) return NaN;
  return Math.hypot(x.re - Math.round(x.re), x.im);
}

/**
 * Product of Γ over `num` divided by the product of Γ over `den`, with
 * explicit pole handling: a Γ-pole (non-positive integer argument) in the
 * denominator makes the whole coefficient 0; a pole in the numerator means
 * the connection formula degenerates (callers gate on that — NaN here is
 * defensive).
 */
function gammaRatioC(
  num: ReadonlyArray<Complex>,
  den: ReadonlyArray<Complex>
): Complex {
  const numPole = num.some(isNonPositiveIntegerC);
  if (den.some(isNonPositiveIntegerC))
    return numPole ? C_NAN : new Complex(0, 0);
  if (numPole) return C_NAN;
  let r: Complex = C_ONE;
  for (const x of num) r = r.mul(gamma(x));
  for (const x of den) r = r.div(gamma(x));
  return r;
}

// Treat a parameter difference within this distance of an integer as
// degenerate: the two-term connection formulas have Γ-factors that blow up
// like 1/dist, so closer than this the cancellation destroys the result.
// Such cases are routed to another transformation, or evaluated by averaging
// two parameter-perturbed evaluations (±1e-6), accurate to ~1e-9.
const DEGENERATE_TOL = 1e-7;

// |w| bounds for the transformed series argument. Below W_PREFERRED the
// series converges in well under 10k terms; up to W_MAX it still converges
// (≈250k-term budget, |0.99|ⁿ needs ~3700 terms for 1e-16). The only region
// where no transformation reaches W_MAX is a thin sliver around the two
// points z = e^{±iπ/3} (where all six Kummer maps have |w| = 1).
const W_PREFERRED = 0.92;
const W_MAX = 0.99;

/**
 * Complex Gauss hypergeometric ₂F₁(a, b; c; z), analytic continuation over
 * (almost) the whole plane.
 *
 * Picks among the six Kummer transformations the one with the smallest
 * transformed argument |w| (A&S 15.3.4–15.3.9): direct series, Pfaff
 * z/(z−1), and the two-term Γ-connection formulas in 1−z, 1/z, 1/(1−z),
 * and 1−1/z. Degenerate parameter differences (a−b ∈ ℤ for the 1/z and
 * 1/(1−z) maps, c−a−b ∈ ℤ for the 1−z and 1−1/z maps) are routed to a
 * non-degenerate map when one converges, otherwise handled by symmetric
 * parameter perturbation (~9 significant digits).
 *
 * On the branch cut z ∈ (1, ∞) the principal branch is the limit from
 * below (the standard z − i0 convention).
 *
 * Returns NaN only near z = e^{±iπ/3} (all maps have |w| ≈ 1 there).
 */
export function hypergeometric2F1Complex(
  a: Complex,
  b: Complex,
  c: Complex,
  z: Complex,
  depth = 0
): Complex {
  if (a.isNaN() || b.isNaN() || c.isNaN() || z.isNaN()) return C_NAN;

  const aTerm = isNonPositiveIntegerC(a) ? -a.re : Infinity;
  const bTerm = isNonPositiveIntegerC(b) ? -b.re : Infinity;
  const nTerms = Math.min(aTerm, bTerm);
  if (isNonPositiveIntegerC(c)) {
    if (nTerms === Infinity || nTerms > -c.re) return C_NAN;
  }
  if (nTerms !== Infinity) return gauss2F1SeriesC(a, b, c, z, nTerms + 1);

  if (z.isZero()) return C_ONE;

  const one = C_ONE;
  const s = c.sub(a).sub(b); // c − a − b
  const d = b.sub(a); // b − a

  if (z.equals(one)) {
    // Gauss summation: Γ(c)Γ(c−a−b)/(Γ(c−a)Γ(c−b)), requires Re(c−a−b) > 0
    if (s.re <= 0) return C_NAN; // divergent (or log-divergent at s = 0)
    return gammaRatioC([c, s], [c.sub(a), c.sub(b)]);
  }

  // Principal branch on the cut [1, ∞): the z − i0 convention (limit from
  // below). Forcing im = −0 makes atan2 yield Arg(1−z) = Arg(−z) = +π for
  // real z > 1, which is exactly the z − i0 limit.
  if (z.im === 0) z = new Complex(z.re, -0);

  const sIsDegenerate = distToIntegerC(s) <= DEGENERATE_TOL;
  const dIsDegenerate = distToIntegerC(d) <= DEGENERATE_TOL;

  // The six Kummer maps, by transformed argument. `degenerate` marks maps
  // whose connection formula breaks down for the current parameters.
  const candidates: {
    kind:
      | 'direct'
      | 'pfaff'
      | 'one-minus-z'
      | 'inv-z'
      | 'inv-one-minus-z'
      | 'one-minus-inv-z';
    w: Complex;
    degenerate: boolean;
  }[] = [
    { kind: 'direct', w: z, degenerate: false },
    { kind: 'pfaff', w: z.div(z.sub(1)), degenerate: false },
    { kind: 'one-minus-z', w: one.sub(z), degenerate: sIsDegenerate },
    { kind: 'inv-z', w: one.div(z), degenerate: dIsDegenerate },
    {
      kind: 'inv-one-minus-z',
      w: one.div(one.sub(z)),
      degenerate: dIsDegenerate,
    },
    {
      kind: 'one-minus-inv-z',
      w: one.sub(one.div(z)),
      degenerate: sIsDegenerate,
    },
  ];
  candidates.sort((p, q) => p.w.abs() - q.w.abs());

  let sawDegenerateCandidate = false;
  for (const cand of candidates) {
    const { kind, w } = cand;
    if (w.abs() > W_MAX) break; // sorted: no further candidate fits
    if (cand.degenerate) {
      sawDegenerateCandidate = true;
      continue;
    }
    const maxTerms = w.abs() <= W_PREFERRED ? 10_000 : 250_000;

    switch (kind) {
      case 'direct':
        return gauss2F1SeriesC(a, b, c, z, maxTerms);

      case 'pfaff':
        // A&S 15.3.4: (1−z)^{−a}·₂F₁(a, c−b; c; z/(z−1))
        return one
          .sub(z)
          .pow(a.neg())
          .mul(gauss2F1SeriesC(a, c.sub(b), c, w, maxTerms));

      case 'one-minus-z': {
        // A&S 15.3.6, w = 1−z, s = c−a−b ∉ ℤ
        const t1 = gammaRatioC([c, s], [c.sub(a), c.sub(b)]).mul(
          gauss2F1SeriesC(a, b, one.sub(s), w, maxTerms)
        );
        const t2 = gammaRatioC([c, s.neg()], [a, b])
          .mul(w.pow(s))
          .mul(gauss2F1SeriesC(c.sub(a), c.sub(b), one.add(s), w, maxTerms));
        return t1.add(t2);
      }

      case 'inv-z': {
        // A&S 15.3.7, w = 1/z, b−a ∉ ℤ
        const t1 = gammaRatioC([c, d], [b, c.sub(a)])
          .mul(z.neg().pow(a.neg()))
          .mul(
            gauss2F1SeriesC(
              a,
              one.sub(c).add(a),
              one.sub(b).add(a),
              w,
              maxTerms
            )
          );
        const t2 = gammaRatioC([c, d.neg()], [a, c.sub(b)])
          .mul(z.neg().pow(b.neg()))
          .mul(
            gauss2F1SeriesC(
              b,
              one.sub(c).add(b),
              one.sub(a).add(b),
              w,
              maxTerms
            )
          );
        return t1.add(t2);
      }

      case 'inv-one-minus-z': {
        // A&S 15.3.8, w = 1/(1−z), b−a ∉ ℤ
        const oneMinusZ = one.sub(z);
        const t1 = gammaRatioC([c, d], [b, c.sub(a)])
          .mul(oneMinusZ.pow(a.neg()))
          .mul(gauss2F1SeriesC(a, c.sub(b), a.sub(b).add(1), w, maxTerms));
        const t2 = gammaRatioC([c, d.neg()], [a, c.sub(b)])
          .mul(oneMinusZ.pow(b.neg()))
          .mul(gauss2F1SeriesC(b, c.sub(a), b.sub(a).add(1), w, maxTerms));
        return t1.add(t2);
      }

      case 'one-minus-inv-z': {
        // A&S 15.3.9, w = 1 − 1/z, s = c−a−b ∉ ℤ
        const t1 = gammaRatioC([c, s], [c.sub(a), c.sub(b)])
          .mul(z.pow(a.neg()))
          .mul(
            gauss2F1SeriesC(
              a,
              a.sub(c).add(1),
              a.add(b).sub(c).add(1),
              w,
              maxTerms
            )
          );
        const t2 = gammaRatioC([c, s.neg()], [a, b])
          .mul(one.sub(z).pow(s))
          .mul(z.pow(a.sub(c)))
          .mul(gauss2F1SeriesC(c.sub(a), one.sub(a), s.add(1), w, maxTerms));
        return t1.add(t2);
      }
    }
  }

  // Only degenerate maps converge: evaluate at symmetrically perturbed
  // parameters and average. The perturbation (±ε on a, ±ε√2 on c) breaks
  // both a−b ∈ ℤ and c−a−b ∈ ℤ; averaging cancels the O(ε) error, leaving
  // O(ε²) + Γ-cancellation ≈ 1e-9 relative accuracy.
  if (depth === 0 && sawDegenerateCandidate) {
    const EPS = 1e-6;
    const f1 = hypergeometric2F1Complex(
      a.add(EPS),
      b,
      c.add(EPS * Math.SQRT2),
      z,
      1
    );
    const f2 = hypergeometric2F1Complex(
      a.sub(EPS),
      b,
      c.sub(EPS * Math.SQRT2),
      z,
      1
    );
    return f1.add(f2).mul(0.5);
  }

  return C_NAN; // near z = e^{±iπ/3}: no implemented map converges
}

function kummer1F1SeriesC(
  a: Complex,
  b: Complex,
  z: Complex,
  maxTerms = 20_000
): Complex {
  let term: Complex = C_ONE;
  let sum: Complex = C_ONE;
  for (let n = 0; n < maxTerms; n++) {
    term = term
      .mul(a.add(n))
      .mul(z)
      .div(b.add(n).mul(n + 1));
    if (term.isZero()) return sum;
    sum = sum.add(term);
    if (n > 2 && term.abs() <= Number.EPSILON * sum.abs()) return sum;
  }
  return sum;
}

/**
 * Complex Kummer confluent hypergeometric ₁F₁(a; b; z). Entire in z;
 * Kummer transformation for Re(z) < 0 to limit cancellation.
 */
export function hypergeometric1F1Complex(
  a: Complex,
  b: Complex,
  z: Complex
): Complex {
  if (a.isNaN() || b.isNaN() || z.isNaN()) return C_NAN;
  const aTerm = isNonPositiveIntegerC(a) ? -a.re : Infinity;
  if (isNonPositiveIntegerC(b)) {
    if (aTerm === Infinity || aTerm > -b.re) return C_NAN;
  }
  if (aTerm !== Infinity) return kummer1F1SeriesC(a, b, z, aTerm + 1);
  if (z.re < 0)
    return z.exp().mul(hypergeometric1F1Complex(b.sub(a), b, z.neg()));
  return kummer1F1SeriesC(a, b, z);
}

/**
 * Complex Appell F₁(a; b₁, b₂; c; x, y) by the double Pochhammer series.
 * Converges for |x| < 1 and |y| < 1 (or when the corresponding index
 * terminates); outside returns NaN (the expression stays symbolic).
 */
export function appellF1Complex(
  a: Complex,
  b1: Complex,
  b2: Complex,
  c: Complex,
  x: Complex,
  y: Complex
): Complex {
  if ([a, b1, b2, c, x, y].some((v) => v.isNaN())) return C_NAN;
  if (isNonPositiveIntegerC(c)) return C_NAN;

  const xConverges = x.abs() < 1 || isNonPositiveIntegerC(b1);
  const yConverges = y.abs() < 1 || isNonPositiveIntegerC(b2);
  if (!xConverges || !yConverges) return C_NAN;

  const MAX_ROWS = 10_000;
  const MAX_COLS = 10_000;
  let sum = new Complex(0, 0);
  let rowLead: Complex = C_ONE; // (a)ₘ(b₁)ₘ/((c)ₘ m!) xᵐ
  let negligibleRows = 0;
  for (let m = 0; m < MAX_ROWS; m++) {
    let term = rowLead;
    let rowSum = term;
    for (let n = 0; n < MAX_COLS; n++) {
      term = term
        .mul(a.add(m + n))
        .mul(b2.add(n))
        .mul(y)
        .div(c.add(m + n).mul(n + 1));
      if (term.isZero()) break;
      rowSum = rowSum.add(term);
      if (term.abs() <= Number.EPSILON * (1 + rowSum.abs())) break;
    }
    sum = sum.add(rowSum);
    if (rowSum.abs() <= Number.EPSILON * (1 + sum.abs())) {
      if (++negligibleRows >= 3) return sum;
    } else negligibleRows = 0;

    rowLead = rowLead
      .mul(a.add(m))
      .mul(b1.add(m))
      .mul(x)
      .div(c.add(m).mul(m + 1));
    if (rowLead.isZero()) return sum;
  }
  return sum;
}

//
// ---------------- Jacobi theta functions ----------------
//
// Fungrim convention (f96eac): θⱼ(z, τ) with nome q = e^{iπτ}, Im(τ) > 0,
// and trigonometric arguments in multiples of πz (period 1 in z):
//   θ₁(z,τ) = 2·Σₙ≥₀ (−1)ⁿ e^{iπτ(n+½)²} sin((2n+1)πz)
//   θ₂(z,τ) = 2·Σₙ≥₀ e^{iπτ(n+½)²} cos((2n+1)πz)
//   θ₃(z,τ) = 1 + 2·Σₙ≥₁ e^{iπτn²} cos(2nπz)
//   θ₄(z,τ) = 1 + 2·Σₙ≥₁ (−1)ⁿ e^{iπτn²} cos(2nπz)
//

/** e^{iπτ·s} for real s */
function nomePower(tau: Complex, s: number): Complex {
  return tau.mul(new Complex(0, Math.PI * s)).exp();
}

/**
 * Jacobi theta function θⱼ(z, τ), j ∈ {1,2,3,4}, Fungrim convention.
 * Requires Im(τ) > 0; returns NaN otherwise or if the series does not
 * converge within the iteration cap (extremely small Im(τ)).
 */
export function jacobiTheta(
  j: 1 | 2 | 3 | 4,
  z: Complex,
  tau: Complex
): Complex {
  if (z.isNaN() || tau.isNaN()) return C_NAN;
  if (tau.im <= 0) return C_NAN;

  const maxTerms = 4000;
  let sum = new Complex(0, 0);
  // Truncation criterion: bound term n by its envelope
  // e^{−π·Im(τ)·s(n)}·e^{w(n)·π·|Im z|} (nome decay × max trig growth),
  // NOT by the computed term itself — a trig factor can be accidentally
  // ~0 at some n (e.g. sin((2n+1)πz) with rational real z) without the
  // tail being negligible.
  const imTau = tau.im;
  const imZ = Math.abs(z.im);

  if (j === 1 || j === 2) {
    for (let n = 0; n < maxTerms; n++) {
      const qPow = nomePower(tau, (n + 0.5) * (n + 0.5));
      const trig = z.mul((2 * n + 1) * Math.PI);
      let term = qPow.mul(j === 1 ? trig.sin() : trig.cos());
      if (j === 1 && n % 2 === 1) term = term.neg();
      sum = sum.add(term);
      const env = Math.exp(
        -Math.PI * imTau * (n + 0.5) * (n + 0.5) + (2 * n + 1) * Math.PI * imZ
      );
      if (n > 1 && env <= 1e-18 * (1 + sum.abs())) break;
      if (n === maxTerms - 1) return C_NAN; // did not converge
    }
    return sum.mul(2);
  }

  // j === 3 || j === 4
  for (let n = 1; n < maxTerms; n++) {
    const qPow = nomePower(tau, n * n);
    let term = qPow.mul(z.mul(2 * n * Math.PI).cos());
    if (j === 4 && n % 2 === 1) term = term.neg();
    sum = sum.add(term);
    const env = Math.exp(-Math.PI * imTau * n * n + 2 * n * Math.PI * imZ);
    if (n > 1 && env <= 1e-18 * (1 + sum.abs())) break;
    if (n === maxTerms - 1) return C_NAN; // did not converge
  }
  return C_ONE.add(sum.mul(2));
}

//
// ---------------- Dedekind eta function ----------------
//

/**
 * Dedekind eta η(τ) = e^{iπτ/12}·∏ₖ≥₁ (1 − e^{2πikτ}), Im(τ) > 0
 * (Fungrim 1dc520).
 */
export function dedekindEta(tau: Complex): Complex {
  if (tau.isNaN()) return C_NAN;
  if (tau.im <= 0) return C_NAN;

  const q = tau.mul(new Complex(0, 2 * Math.PI)).exp(); // e^{2πiτ}
  const absQ = q.abs();
  if (absQ >= 1) return C_NAN;

  // ∏ (1 − qᵏ): stop when |q|ᵏ is below machine epsilon
  const kMax = Math.min(100_000, Math.ceil(-40 / Math.log10(absQ)) + 1);
  if (kMax >= 100_000) return C_NAN; // |q| too close to 1 to converge

  let prod: Complex = C_ONE;
  let qk: Complex = q;
  for (let k = 1; k <= kMax; k++) {
    prod = prod.mul(C_ONE.sub(qk));
    qk = qk.mul(q);
    if (qk.abs() < 1e-18) break;
  }
  return nomePower(tau, 1 / 12).mul(prod);
}
