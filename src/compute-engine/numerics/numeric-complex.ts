import { Complex } from 'complex-esm';

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
  return new Complex(Math.PI / 2, 0).div(agmComplex(C_ONE, C_ONE.sub(m).sqrt()));
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

/**
 * Complex Gauss hypergeometric ₂F₁(a, b; c; z): direct series for |z| ≤ 0.8,
 * Pfaff transformation when |z/(z−1)| ≤ 0.8. Outside that region returns
 * NaN (the expression stays symbolic).
 */
export function hypergeometric2F1Complex(
  a: Complex,
  b: Complex,
  c: Complex,
  z: Complex
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
  if (z.abs() <= 0.8) return gauss2F1SeriesC(a, b, c, z);

  // Pfaff: (1−z)^{−a}·₂F₁(a, c−b; c; z/(z−1))
  const w = z.div(z.sub(C_ONE));
  if (w.abs() <= 0.8) {
    const factor = C_ONE.sub(z).pow(a.neg());
    return factor.mul(gauss2F1SeriesC(a, c.sub(b), c, w));
  }

  return C_NAN; // outside the implemented convergence region
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
    term = term.mul(a.add(n)).mul(z).div(b.add(n).mul(n + 1));
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
        -Math.PI * imTau * (n + 0.5) * (n + 0.5) +
          (2 * n + 1) * Math.PI * imZ
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
