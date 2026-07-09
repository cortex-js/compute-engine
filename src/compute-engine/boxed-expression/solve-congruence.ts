import type {
  Expression,
  IComputeEngine as ComputeEngine,
} from '../global-types.js';

import { isFunction } from './type-guards.js';
import { toBigint } from './numerics.js';
import { getPolynomialCoefficients } from './polynomials.js';
import { freshParameters } from './diophantine.js';
import { gcd, modularInverse } from '../numerics/numeric-bigint.js';

/** Canonical residue of `x` in `[0, m)` (floored), for `m > 0`. */
function floorMod(x: bigint, m: bigint): bigint {
  return ((x % m) + m) % m;
}

/**
 * Reduce a linear congruence `Congruent(lhs, rhs, m)` to a single normalized
 * residue class `x ≡ r (mod m')`.
 *
 * Returns `{ r, m }` (with `0 ≤ r < m`, `m ≥ 1`) for a solvable linear
 * congruence, `'none'` when the congruence is decided to have no solution, or
 * `undefined` to decline (not a `Congruent`, symbolic/zero modulus, degree ≠ 1,
 * or non-integer coefficients).
 */
export function congruenceResidue(
  expr: Expression,
  x: string
): { r: bigint; m: bigint } | 'none' | undefined {
  if (!isFunction(expr, 'Congruent') || expr.ops.length !== 3) return undefined;

  const [lhs, rhs, modulo] = expr.ops;
  const m = toBigint(modulo);
  if (m === null || m === 0n) return undefined; // symbolic/zero modulus
  const mAbs = m < 0n ? -m : m;

  // Move everything to one side: solve `residual ≡ 0 (mod mAbs)`.
  const residual = lhs.sub(rhs);
  const coeffs = getPolynomialCoefficients(residual, x);
  if (coeffs === null || coeffs.length !== 2) return undefined; // not linear

  const cExpr = coeffs[0]; // constant coefficient
  const aExpr = coeffs[1]; // linear coefficient
  if (cExpr.isInteger !== true || aExpr.isInteger !== true) return undefined;
  const c = toBigint(cExpr);
  const a = toBigint(aExpr);
  if (a === null || c === null || a === 0n) return undefined;

  // Solve `a·x ≡ −c (mod mAbs)`.
  const g = gcd(a, mAbs);
  if (c % g !== 0n) return 'none'; // g ∤ (−c) ⇒ no solution
  const m1 = mAbs / g;
  if (m1 === 1n) return { r: 0n, m: 1n }; // every integer is a solution

  const aReduced = floorMod(a / g, m1);
  const inv = modularInverse(aReduced, m1);
  if (inv === null) return undefined; // should not happen (gcd(a/g, m1) = 1)
  const rhsReduced = floorMod(-c / g, m1);
  const x0 = floorMod(inv * rhsReduced, m1);
  return { r: x0, m: m1 };
}

/**
 * Solve a linear congruence `Congruent(lhs, rhs, m)` for the unknown `x`.
 *
 * Returns an array of root expressions (the parametric family) — possibly
 * empty (a decision that there are no solutions) — or `undefined` to decline
 * (not linear, symbolic modulus, non-integer coefficients, …).
 */
export function solveCongruence(
  ce: ComputeEngine,
  expr: Expression,
  x: string
): Expression[] | undefined {
  const res = congruenceResidue(expr, x);
  if (res === undefined) return undefined;
  if (res === 'none') return []; // decided: no solutions

  const t = freshParameters(ce, expr, 1)[0];
  // mod 1: every integer is a solution — the family is the bare parameter.
  if (res.m === 1n) return [t];

  // x = r + m·t (build with canonical Add/Multiply, never `.add()`/`.mul()`,
  // which would fold the literals to a float).
  const root = ce.function('Add', [
    ce.number(res.r),
    ce.function('Multiply', [ce.number(res.m), t]),
  ]);
  return [root];
}
