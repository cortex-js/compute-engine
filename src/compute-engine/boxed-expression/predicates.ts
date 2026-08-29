import type { Expression } from '../global-types.js';
import { asBigint } from './numerics.js';
import { isPrimeBigint } from '../numerics/primes.js';
import { isNumber } from './type-guards.js';
import { typesOverlap } from '../../common/type/reduce.js';

/**
 * Three-valued primality test: `true` prime, `false` provably not prime,
 * `undefined` undecided (the caller leaves the application inert).
 *
 * Primality is a MEMBERSHIP question, so `false` is a success value: "3.5 is
 * not prime" is a well-formed true sentence, not a failure to answer. The
 * undecided answer is therefore reserved for arguments that genuinely could
 * still turn out prime — an unknown symbol, a `real`-typed subexpression —
 * and never used for an argument whose non-membership is already settled.
 * (`docs/SIGNATURE-GUIDELINES.md` §3.3 on membership predicates;
 * `docs/ERROR-MODEL.md` §1 on inertness as a non-answer.)
 */
export function isPrime(expr: Expression): boolean | undefined {
  // Proven not to be an integer, so proven not to be a prime: `3.5`, `1/2`,
  // `√2`, `i` and `1+i` (a Gaussian integer is not a RATIONAL prime), and
  // `NaN`.
  if (expr.isInteger === false) return false;

  if (expr.isInteger !== true) {
    // Integrality is not decided on the value. Decide "not prime" anyway
    // whenever the operand's TYPE cannot hold an integer at all — this is
    // what settles the irrational constants `π`, `e` and `φ`, whose types are
    // narrow ranges around a non-integer. An argument whose type still admits
    // an integer — an undeclared symbol, anything typed `real` or wider —
    // stays undecided.
    if (typesOverlap(expr.type.type, 'integer')) return undefined;
    return false;
  }

  // A negative integer is NOT prime. This engine defines a prime as a
  // positive integer greater than 1, which is SymPy's convention for
  // `isprime`; Mathematica's `PrimeQ` takes the other one and accepts the
  // negatives of primes (primality up to units). The choice is definitional,
  // not a mathematical indeterminacy, so it is made rather than declined —
  // and answering `False` is what keeps the uniform set-membership reading
  // this predicate gives every other decidable non-member (`3.5`, `π`, `i`,
  // `NaN`). Ruled 2026-08-29; recorded in `docs/ERROR-MODEL.md` §7.
  if (expr.isNegative) return false;

  if (!isNumber(expr)) return undefined;

  // Use the exact bigint path: `toInteger` would silently round integers
  // beyond 2^53 (e.g. a large Mersenne prime), yielding a wrong answer.
  // `isPrimeBigint` is already O(1) for small values.
  const b = asBigint(expr);
  if (b !== null) return isPrimeBigint(b);

  return undefined;
}

/**
 * Three-valued compositeness test, with the same contract as `isPrime`:
 * `true` composite, `false` provably not composite, `undefined` undecided.
 *
 * A composite number is a positive integer greater than 1 that is not prime.
 * So `0`, `1`, every negative integer and every non-integer are neither prime
 * NOR composite — compositeness is not the negation of primality, and
 * `Not(IsPrime(n))` is the wrong definition for it.
 */
export function isComposite(expr: Expression): boolean | undefined {
  const prime = isPrime(expr);
  if (prime === undefined) return undefined;
  if (prime === true) return false;
  // `isPrime` answered `false`, which it does for numbers that are outside the
  // composite range too. Those three tests are what separate the two.
  if (
    expr.isInteger !== true ||
    expr.isPositive !== true ||
    expr.isEqual(1) !== false
  )
    return false;
  return true;
}
