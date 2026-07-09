import type { Expression } from '../global-types.js';

import { toBigint } from './numerics.js';
import { isFunction } from './type-guards.js';
import { modPow } from '../numerics/primes.js';
import { modularInverse } from '../numerics/numeric-bigint.js';
import {
  checkDeadline,
  getAmbientDeadline,
} from '../../common/interruptible.js';

/** Canonical residue of `x` in `[0, m)` (floored), for `m > 0`. */
function floorMod(x: bigint, m: bigint): bigint {
  return ((x % m) + m) % m;
}

/**
 * Evaluate an integer-valued expression in ℤ/mℤ without materializing
 * intermediate values. `m` must be a positive bigint. Returns the canonical
 * residue in `[0, m)`, or `null` when the expression can't be reduced.
 *
 * Callers pass `|m|` and fix the sign of the result themselves.
 *
 * Does NOT call `.simplify()` or `.evaluate()` on operand trees (recursion +
 * cost hazards); it walks the already-canonical tree structurally. The one
 * narrow exception is the exponent of a `Power`, which is read via `toBigint`
 * on the (already-evaluated) exponent operand — canonicalization has already
 * materialized evaluable exponents such as `3^{20}` into the literal
 * `3486784401`, so no extra evaluation is needed.
 */
export function reduceModulo(expr: Expression, m: bigint): bigint | null {
  if (m <= 0n) return null;

  // A literal or bound integer symbol reduces directly.
  const direct = toBigint(expr);
  if (direct !== null) return floorMod(direct, m);

  if (isFunction(expr, 'Negate')) {
    const u = reduceModulo(expr.op1, m);
    if (u === null) return null;
    return (m - u) % m;
  }

  if (isFunction(expr, 'Add')) {
    let sum = 0n;
    for (const op of expr.ops) {
      const r = reduceModulo(op, m);
      if (r === null) return null;
      sum = (sum + r) % m;
    }
    return sum;
  }

  if (isFunction(expr, 'Subtract')) {
    const a = reduceModulo(expr.op1, m);
    const b = reduceModulo(expr.op2, m);
    if (a === null || b === null) return null;
    return floorMod(a - b, m);
  }

  if (isFunction(expr, 'Multiply')) {
    let product = 1n;
    for (const op of expr.ops) {
      const r = reduceModulo(op, m);
      if (r === null) return null;
      product = (product * r) % m;
    }
    return product;
  }

  if (isFunction(expr, 'Power')) {
    const base = reduceModulo(expr.op1, m);
    if (base === null) return null;
    const exp = toBigint(expr.op2);
    if (exp === null) return null;
    if (exp >= 0n) return modPow(base, exp, m);
    // Negative exponent: raise the modular inverse of the base.
    const inv = modularInverse(base, m);
    if (inv === null) return null; // base not invertible mod m
    return modPow(inv, -exp, m);
  }

  if (isFunction(expr, 'Factorial')) {
    const n = toBigint(expr.op1);
    if (n === null || n < 0n) return null;
    // For n ≥ m, the product 1·2·…·n includes a factor of m, so m | n!.
    if (n >= m) return 0n;
    if (n > 10_000n) return null; // too many iterations to be worthwhile
    const deadline = getAmbientDeadline();
    let r = 1n;
    let steps = 0;
    for (let k = 2n; k <= n; k++) {
      if ((++steps & 0x3ff) === 0) checkDeadline(deadline);
      r = (r * k) % m;
    }
    return r;
  }

  return null;
}
