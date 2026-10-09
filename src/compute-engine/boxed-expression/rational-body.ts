import type { Expression } from '../global-types.js';
import { isFunction, isNumber, isSymbol } from './type-guards.js';
import { getPolynomialCoefficients, polynomialDegree } from './polynomials.js';
import { togetherReduced } from './factor.js';
import { expand } from './expand.js';
import { isTransitivelyPure } from './transitive-purity.js';

/**
 * Tools for the closed-form recognizers of `Sum` and `Product`: read a body
 * as a rational function of its index, reduce it to lowest terms when that
 * is safe, and compare it with a pattern algebraically rather than
 * structurally. `(4k² − 1)/(4k²)`, `1 − 1/(4k²)` and `1 − 1/(2k)²` are one
 * rational function of `k` spelled three ways; a recognizer that compares
 * with `isSame` sees only one of them.
 */

/**
 * The numerator and denominator of `expr` as a rational function, read from
 * the expression AS WRITTEN: no factor is cancelled.
 * `(k − 5)(k² − 1) / ((k − 5)k²)` gives the numerator `(k − 5)(k² − 1)` and
 * the denominator `(k − 5)k²`, where `together()` would divide the common
 * factor out. The parts are built with `Multiply` and `Add` only, which
 * never introduce a division, so a common factor survives in both parts.
 * Returns undefined when `expr` is not a rational expression (a radical, a
 * transcendental function, a non-integer exponent).
 */
export function rationalPartsAsWritten(
  expr: Expression
): [Expression, Expression] | undefined {
  const ce = expr.engine;
  if (isNumber(expr) || isSymbol(expr)) return [expr, ce.One];
  if (!isFunction(expr)) return undefined;
  switch (expr.operator) {
    case 'Negate': {
      const p = rationalPartsAsWritten(expr.op1);
      return p && [ce.function('Negate', [p[0]]), p[1]];
    }
    case 'Add': {
      // n₁/d₁ + n₂/d₂ = (n₁·d₂ + n₂·d₁) / (d₁·d₂)
      let num = ce.Zero;
      let den = ce.One;
      for (const term of expr.ops) {
        const p = rationalPartsAsWritten(term);
        if (!p) return undefined;
        num = ce.function('Add', [
          ce.function('Multiply', [num, p[1]]),
          ce.function('Multiply', [p[0], den]),
        ]);
        den = ce.function('Multiply', [den, p[1]]);
      }
      return [num, den];
    }
    case 'Multiply': {
      const nums: Expression[] = [];
      const dens: Expression[] = [];
      for (const factor of expr.ops) {
        const p = rationalPartsAsWritten(factor);
        if (!p) return undefined;
        nums.push(p[0]);
        dens.push(p[1]);
      }
      return [ce.function('Multiply', nums), ce.function('Multiply', dens)];
    }
    case 'Divide': {
      const n = rationalPartsAsWritten(expr.op1);
      const d = rationalPartsAsWritten(expr.op2);
      if (!n || !d) return undefined;
      return [
        ce.function('Multiply', [n[0], d[1]]),
        ce.function('Multiply', [n[1], d[0]]),
      ];
    }
    case 'Power': {
      const base = rationalPartsAsWritten(expr.op1);
      const exponent = expr.op2;
      if (!base || !isNumber(exponent) || !exponent.isInteger) return undefined;
      const n = exponent.re;
      if (!Number.isSafeInteger(n)) return undefined;
      if (n === 0) return [ce.One, ce.One];
      const [b0, b1] = n > 0 ? base : [base[1], base[0]];
      const k = ce.number(Math.abs(n));
      return [ce.function('Power', [b0, k]), ce.function('Power', [b1, k])];
    }
    default:
      return undefined;
  }
}

/** Does `expr` contain a number literal that is not exact (a float)? */
export function hasInexactLiteral(expr: Expression): boolean {
  if (isNumber(expr)) return !expr.isExact;
  if (!isFunction(expr)) return false;
  return expr.ops.some(hasInexactLiteral);
}

/**
 * The coefficients of `poly` in `variable` as machine numbers, the constant
 * term first. Undefined when `poly` is not a polynomial in `variable` or a
 * coefficient is not a finite real number (a symbolic coefficient).
 */
export function machineCoefficients(
  poly: Expression,
  variable: string
): number[] | undefined {
  const coefficients = getPolynomialCoefficients(poly, variable);
  if (!coefficients) return undefined;
  const result: number[] = [];
  for (const c of coefficients) {
    const v = c.evaluate();
    if (!isNumber(v) || v.im !== 0) return undefined;
    const x = v.re;
    if (!Number.isFinite(x)) return undefined;
    result.push(x);
  }
  return result;
}

/**
 * Does the polynomial with machine coefficients `c` (constant term first)
 * have an integer root at or above `from`? Every root has an absolute value
 * at most `1 + max|cᵢ/cₙ|` (the Cauchy bound), so the integers from `from`
 * to that bound are tried with Horner's rule, unless the coefficients are
 * all of one sign and `from ≥ 0`, where there is no root to find. A value
 * within rounding of zero counts as a root (conservative). Returns undefined when the bound
 * leaves more than 10 000 000 integers to try (about 30 ms of Horner steps
 * for a quadratic; `1/(k² + 10⁶)` is within the bound, `1/(k² − 10¹²)` is
 * not), when a bound is not a safe integer, or for the zero polynomial,
 * whose every integer is a root.
 */
export function hasIntegerRootFrom(
  c: readonly number[],
  from: number
): boolean | undefined {
  let n = c.length - 1;
  while (n > 0 && c[n] === 0) n -= 1;
  if (n === 0) return c[0] === 0 ? undefined : false;
  // Coefficients all of one sign (zeros aside) and a constant term other
  // than 0: the polynomial has no root at or above 0, so none at or above
  // a `from ≥ 0`, without a scan (`k² + 10¹³`).
  if (from >= 0 && c[0] !== 0) {
    const sign = Math.sign(c[0]);
    if (c.every((a) => a === 0 || Math.sign(a) === sign)) return false;
  }
  const lead = Math.abs(c[n]);
  let ratio = 0;
  for (let i = 0; i < n; i++) ratio = Math.max(ratio, Math.abs(c[i]) / lead);
  const top = Math.floor(1 + ratio);
  const start = Math.max(Math.ceil(from), -top);
  // Past 2^53 the counter cannot advance by 1.
  if (!Number.isSafeInteger(top) || !Number.isSafeInteger(start))
    return undefined;
  if (top - start > 10_000_000) return undefined;
  for (let k = start; k <= top; k++) {
    let value = c[n];
    let scale = Math.abs(c[n]);
    for (let i = n - 1; i >= 0; i--) {
      value = value * k + c[i];
      scale = scale * Math.abs(k) + Math.abs(c[i]);
    }
    if (Math.abs(value) <= 1e-12 * Math.max(1, scale)) return true;
  }
  return false;
}

/**
 * `body` reduced to lowest terms as a rational function of `index`, when
 * that reduction cannot change the value of a sum or product over the
 * integers from `from` upward. It can when the denominator as written is
 * zero at such an integer: the body has a pole there, or a `0/0` factor
 * that the cancellation would remove. `(k − 5)(k² − 1) / ((k − 5)k²)` is
 * undefined at k = 5, and reduced it is `(k² − 1)/k²`, which is not. Such a
 * body is left alone (undefined). The body must be pure (its evaluation is
 * what the reduction stands for) and rational in `index` with numeric
 * coefficients. `from` is `-Infinity` when the lower bound is not known.
 */
export function reducedRationalBody(
  body: Expression,
  index: string,
  from: number
): Expression | undefined {
  if (!isTransitivelyPure(body)) return undefined;
  const parts = rationalPartsAsWritten(body);
  if (!parts) return undefined;
  const [num, den] = parts;
  if (polynomialDegree(num, index) < 0 || polynomialDegree(den, index) < 0)
    return undefined;
  const denominator = machineCoefficients(den, index);
  if (!denominator) return undefined;
  if (hasIntegerRootFrom(denominator, from) !== false) return undefined;
  // `togetherReduced` can leave a sum unfolded (`k − k + 1`); boxing its
  // MathJSON again canonicalizes it.
  const reduced = togetherReduced(body);
  return reduced.engine.box(reduced.json);
}

/**
 * Are `a` and `b` the same rational function of `index`? Structurally
 * equal, or their difference put over a common denominator and cancelled
 * (or, for two polynomials, expanded) is zero. That cancellation can take over 100 ms when the two differ, so
 * `samplesAgree` runs first: a pair that differs at a sample index is
 * dismissed without algebra.
 */
export function sameRationalFunction(
  a: Expression,
  b: Expression,
  index: string
): boolean {
  if (a.isSame(b)) return true;
  if (!samplesAgree(a, b, index)) return false;
  const difference = togetherReduced(a.engine.function('Subtract', [a, b]));
  if (difference.isSame(0)) return true;
  // A difference with no denominator (two polynomials) comes back as it is;
  // its expanded numerator decides.
  const parts = rationalPartsAsWritten(difference);
  return parts !== undefined && expand(parts[0]).isSame(0);
}

/**
 * Do `a` and `b` take the same value at the sample indices 2, 3 and 7, as
 * machine floats? A cheap filter before an algebraic comparison, not a
 * proof. The samples are where the bodies the recognizers know are not
 * singular; a body that is singular at a sample does not agree.
 */
export function samplesAgree(
  a: Expression,
  b: Expression,
  index: string
): boolean {
  for (const k of [2, 3, 7]) {
    const x = sampleAt(a, index, k);
    const y = sampleAt(b, index, k);
    if (x === undefined || y === undefined) return false;
    if (Math.abs(x - y) > 1e-9 * Math.max(1, Math.abs(x), Math.abs(y)))
      return false;
  }
  return true;
}

function sampleAt(e: Expression, index: string, k: number): number | undefined {
  const v = e.subs({ [index]: e.engine.number(k) }).N();
  if (!isNumber(v)) return undefined;
  const x = v.re;
  return Number.isFinite(x) ? x : undefined;
}

/**
 * Is `body`, over the integers from `from` upward, the rational function
 * `pattern` of `index`? The order of the checks keeps the common case, a
 * body that matches nothing, cheap: purity (the samples evaluate the body),
 * then the sample comparison on the body as written, and only then the
 * reduction of `reducedRationalBody` (with its pole and `0/0` guard) and
 * the algebraic comparison.
 */
export function matchesRationalPattern(
  body: Expression,
  pattern: Expression,
  index: string,
  from: number
): boolean {
  if (body.isSame(pattern)) return true;
  if (!isTransitivelyPure(body)) return false;
  if (!samplesAgree(body, pattern, index)) return false;
  const reduced = reducedRationalBody(body, index, from);
  if (!reduced) return false;
  return sameRationalFunction(reduced, pattern, index);
}

/**
 * When the polynomial `poly` in `variable` is `c·(variable − r)^s` for an
 * integer or half-integer `r` and an integer `s ≥ 1`, its leading
 * coefficient `c` (exact), root `r` (as a machine number and exact) and
 * multiplicity `s`. The root is read from the two leading machine
 * coefficients (the sum of the roots is `s·r`); the candidate factor is
 * then expanded and compared with `poly` EXACTLY, so a polynomial that
 * only approximates a repeated factor (`k² + 2k + 1 + 10⁻¹⁰`) is not one.
 * Undefined otherwise.
 */
export function repeatedLinearFactor(
  poly: Expression,
  variable: string
): { c: Expression; r: number; rExact: Expression; s: number } | undefined {
  const coefficients = machineCoefficients(poly, variable);
  if (!coefficients) return undefined;
  const s = coefficients.length - 1;
  if (s < 1) return undefined;
  const c = coefficients[s];
  if (c === 0) return undefined;
  const r = -coefficients[s - 1] / (s * c);
  if (!Number.isInteger(2 * r)) return undefined;
  const ce = poly.engine;
  const exact = getPolynomialCoefficients(poly, variable)?.[s];
  if (!exact) return undefined;
  const rExact = ce.function('Divide', [ce.number(2 * r), ce.number(2)]);
  const candidate = ce.function('Multiply', [
    exact,
    ce.function('Power', [
      ce.function('Subtract', [ce.box(variable), rExact]),
      ce.number(s),
    ]),
  ]);
  const difference = expand(ce.function('Subtract', [poly, candidate]));
  if (!difference.isSame(0)) return undefined;
  return { c: exact, r, rExact, s };
}
