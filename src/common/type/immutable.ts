import type { NumericPrimitiveType, NumericType, ValueType } from './types.js';

// Constructor-owned leaves need no reflective immutability proof. Keep this
// registry below both the constructors and the facts module to avoid a cycle.
const immutableTypes = new WeakSet<object>();

const RANGE_TYPES_MAX_SIZE = 4096;
const numericRangeTypes = new Map<string, NumericType>();

/**
 * A shared frozen numeric leaf built only from scalar fields. The key keeps
 * the exact stored shape: absent bounds differ from explicit infinities,
 * and signed zero is preserved. No normalization or precision is lost here.
 */
export function immutableNumericType(
  tier: NumericPrimitiveType,
  lower?: number,
  upper?: number,
  lowerOpen = false,
  upperOpen = false
): NumericType {
  const key = `${tier}:${Object.is(lower, -0) ? '-0' : lower}:${Object.is(upper, -0) ? '-0' : upper}:${lowerOpen ? 1 : 0}${upperOpen ? 1 : 0}`;
  const cached = numericRangeTypes.get(key);
  if (cached !== undefined) return cached;
  const result: NumericType = { kind: 'numeric', type: tier };
  if (lower !== undefined) result.lower = lower;
  if (upper !== undefined) result.upper = upper;
  if (lowerOpen) result.lowerOpen = true;
  if (upperOpen) result.upperOpen = true;
  Object.freeze(result);
  immutableTypes.add(result);
  if (numericRangeTypes.size >= RANGE_TYPES_MAX_SIZE) numericRangeTypes.clear();
  numericRangeTypes.set(key, result);
  return result;
}

const VALUE_TYPES_MAX_SIZE = 4096;
const numericValueTypes = new Map<number, ValueType>();

/**
 * Shared literal singleton, including NaN and signed infinities. The bounded
 * table holds only machine numbers; exact rationals keep their ranged type.
 * Map uses SameValueZero, so all NaNs share a key and -0 shares the 0 key.
 */
export function immutableNumericValueType(value: number): ValueType {
  let result = numericValueTypes.get(value);
  if (result !== undefined) return result;
  result = Object.freeze({ kind: 'value', value: value === 0 ? 0 : value });
  immutableTypes.add(result);
  if (numericValueTypes.size >= VALUE_TYPES_MAX_SIZE) numericValueTypes.clear();
  numericValueTypes.set(value, result);
  return result;
}

/** Only leaves made by these constructors carry this identity brand. */
export function isKnownImmutableType(t: object): boolean {
  return immutableTypes.has(t);
}
