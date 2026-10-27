/**
 * A cache of decoded payloads on boxed expressions.
 *
 * A value of a value kind (`Quantity(2, m)`, `Measurement(2.5, 0.1)`, a
 * user kind) stays a call of its head, so each hook that receives it reads
 * its operands again. When this read is costly (a `Quantity` decodes its
 * boxed unit into a unit expression, then computes the dimension and the
 * scale of that unit), the hook can call `decodedPayload()`: the decode
 * runs once for each boxed expression, and the next calls return the
 * stored result.
 *
 * The cache is never invalidated. A boxed expression is immutable, so a
 * value derived only from its structure stays correct for the life of the
 * expression, as the numeric value of a `BoxedNumber` does. The entries are
 * held in a `WeakMap`, so they do not keep an expression alive.
 *
 * This module imports only types, so that any module of the engine or of the
 * library can use it without a dependency cycle.
 */

import type { Expression } from '../global-types.js';

/**
 * For each boxed expression, the decoded payloads, one for each decode
 * function that was given with this expression.
 */
const PAYLOADS = new WeakMap<
  Expression,
  Map<(expr: Expression) => unknown, unknown>
>();

/**
 * The result of `decode(expr)`, computed on the first call for this
 * expression and this decode function, and read from a cache on the next
 * calls. A result of `null` or `undefined` is stored too.
 *
 * The cache is keyed by the identity of `expr` (two expressions that are
 * equal by `isSame()` but are two different objects are decoded apart) and
 * by the identity of `decode`, so that two decode functions on one
 * expression have two separate entries.
 *
 * The decode function must be a function defined once, for example at the
 * top level of a module. A function made at each call (a closure written in
 * the argument list) is a new key at each call, so its result is never read
 * from the cache. The decode function must read only the structure of
 * `expr`, not a value that can change (the value assigned to a symbol, a
 * setting of the engine), and the caller must not modify the result.
 *
 * ```ts
 * function decodeInterval(expr: Expression) {
 *   return { lo: expr.op1.re, hi: expr.op2.re };
 * }
 * const { lo, hi } = decodedPayload(x, decodeInterval);
 * ```
 */
export function decodedPayload<T>(
  expr: Expression,
  decode: (expr: Expression) => T
): T {
  let entries = PAYLOADS.get(expr);
  if (entries === undefined) {
    entries = new Map();
    PAYLOADS.set(expr, entries);
  } else if (entries.has(decode)) return entries.get(decode) as T;
  const result = decode(expr);
  entries.set(decode, result);
  return result;
}
