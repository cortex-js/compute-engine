import type { Type } from '../../common/type/types.js';
import type { Expression, OperandDescriptor } from '../global-types.js';
import { describe } from './operand-descriptor.js';
import { isFunction } from './type-guards.js';

/**
 * The type of the value that an access PROVED to find nothing would read
 * if its position existed, or `undefined`. The answer comes from the
 * collection library (`provedAbsentDomainD()`, `library/collections.ts`),
 * which registers it when it loads: the proof reads the lengths that the
 * library knows how to prove.
 *
 * Such an access is typed by its absence marker alone: `At(M, 7)` for a
 * matrix `M` of two rows is typed `missing`. The marker does not say that
 * the absent value is a row, and an operator that propagates absence
 * answers the marker of its codomain: `At(M, 7) + 1` is the sum of a row
 * and a number, a row, so its value is `Missing` (`docs/ERROR-MODEL.md`,
 * "An absent OBJECT in compiled arithmetic is the object null too"), not
 * the `NaN` of an absent number (`Missing + 1`). The application typing
 * (`BoxedFunction` type derivation) gives the type handler this type in
 * place of the marker, and keeps the whole absence for the absorption.
 */
let provedAbsentDomainHook:
  | ((d: OperandDescriptor) => Type | undefined)
  | undefined;

/** Register the function that reads the domain of an access proved to
 * find nothing. Called once by the collection library. */
export function registerProvedAbsentDomain(
  f: (d: OperandDescriptor) => Type | undefined
): void {
  provedAbsentDomainHook = f;
}

/** The domain of the operand `x` when it is an access typed `missing` that
 * is proved to find nothing (see `registerProvedAbsentDomain`). */
export function provedAbsentDomainOf(x: Expression): Type | undefined {
  if (provedAbsentDomainHook === undefined || !isFunction(x)) return undefined;
  if (x.type.type !== 'missing') return undefined;
  return provedAbsentDomainHook(describe(x));
}
