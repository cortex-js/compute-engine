import type { NumericType, Type } from './types.js';
import { resolveTypeReference } from './subtype.js';

/**
 * The storage of the cells of an array, chosen by its cell type alone
 * (`arrayStorageKind()`): one of the typed arrays of JavaScript for a machine
 * cell, or `'expression'` for cells that hold evaluated expressions.
 */
export type ArrayStorage =
  | 'uint8'
  | 'int8'
  | 'uint16'
  | 'int16'
  | 'uint32'
  | 'int32'
  | 'float64'
  | 'expression';

/**
 * The storage of an array whose cells have a given type. `tuple` is true for
 * the one tuple machine cell, a tuple of four bytes stored flat: cell `i`
 * holds its four bytes at the positions `4(i − 1)` to `4(i − 1) + 3` of one
 * `Uint8Array`.
 */
export type ArrayStorageKind = { storage: ArrayStorage; tuple: boolean };

/**
 * The cell type of an array type: `T` for `array<T>`, read through type
 * references (an alias, and a nominal type whose definition is an array
 * type). `undefined` for bare `array`, whose cell type is not stated, and for
 * a type that is not an array type.
 */
export function arrayCellType(type: Type): Type | undefined {
  const t = resolveTypeReference(type);
  if (t === undefined || typeof t === 'string' || t.kind !== 'array')
    return undefined;
  return t.elements;
}

/** The integer storages, in the order of the table: the first one whose
 * range holds the range of the cell type applies. */
const INTEGER_STORAGES: ReadonlyArray<
  readonly [ArrayStorage, number, number]
> = [
  ['uint8', 0, 255],
  ['int8', -128, 127],
  ['uint16', 0, 65_535],
  ['int16', -32_768, 32_767],
  ['uint32', 0, 4_294_967_295],
  ['int32', -2_147_483_648, 2_147_483_647],
];

const EXPRESSION_CELLS: ArrayStorageKind = Object.freeze({
  storage: 'expression',
  tuple: false,
});

/**
 * The storage of an array whose cells have the type `cellType`, the table of
 * `docs/plans/2026-11-25-mutable-arrays-spec.md`, section 3:
 *
 * - an integer type whose range (both bounds finite) is within 0..255 is
 *   `uint8`; within −128..127, `int8`; within 0..65535, `uint16`; within
 *   −32768..32767, `int16`; within 0..4294967295, `uint32`; within
 *   −2147483648..2147483647, `int32`. The first row that holds the range
 *   applies;
 * - `real`, with or without a range, is `float64`;
 * - a tuple of exactly four elements, named or not, each an integer type
 *   within 0..255, is `uint8` with `tuple: true`;
 * - every other type is `expression`: `integer` with no bound, one bound or
 *   a wider range, `rational`, `number`, `boolean`, `string`, a union, any
 *   other tuple, a list, an object type, an array type, `any`.
 *
 * A type reference (an alias, or a nominal type such as
 * `type Byte = integer<0..255>`) is read through its definition, at the cell
 * type and at each element of a tuple.
 *
 * The interpreter, the compiler and the host interface call this function;
 * no other code decides a storage.
 */
export function arrayStorageKind(cellType: Type): ArrayStorageKind {
  const t = resolveTypeReference(cellType);
  if (t === undefined) return EXPRESSION_CELLS;
  if (t === 'real') return { storage: 'float64', tuple: false };
  if (typeof t === 'string') return EXPRESSION_CELLS;
  if (t.kind === 'numeric') {
    if (t.type === 'real') return { storage: 'float64', tuple: false };
    const storage = integerStorage(t);
    return storage === undefined ? EXPRESSION_CELLS : { storage, tuple: false };
  }
  if (
    t.kind === 'tuple' &&
    t.elements.length === 4 &&
    t.elements.every((e) => {
      const x = resolveTypeReference(e.type);
      return (
        x !== undefined &&
        typeof x !== 'string' &&
        x.kind === 'numeric' &&
        integerStorage(x) === 'uint8'
      );
    })
  )
    return { storage: 'uint8', tuple: true };
  return EXPRESSION_CELLS;
}

/** The storage of the integer type `t` with finite bounds, or `undefined`
 * when `t` is not an integer type, has an infinite bound, or has a range
 * that no integer storage holds. */
function integerStorage(t: NumericType): ArrayStorage | undefined {
  if (t.type !== 'integer') return undefined;
  const lower = t.lower;
  const upper = t.upper;
  if (
    lower === undefined ||
    upper === undefined ||
    !Number.isFinite(lower) ||
    !Number.isFinite(upper)
  )
    return undefined;
  for (const [storage, min, max] of INTEGER_STORAGES)
    if (lower >= min && upper <= max) return storage;
  return undefined;
}
