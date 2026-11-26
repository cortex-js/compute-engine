import type { MathJsonExpression } from '../../math-json/types.js';

import type {
  ArrayCells,
  ArrayInterface,
  BoxedSubstitution,
  CanonicalOptions,
  EvaluateOptions,
  Expression,
  ExpressionInput,
  IComputeEngine as ComputeEngine,
  PatternMatchOptions,
  SimplifyOptions,
  Substitution,
} from '../global-types.js';

import type { Type } from '../../common/type/types.js';

import { BoxedType } from '../../common/type/boxed-type.js';
import {
  arrayStorageKind,
  throughTransparentAliases,
  type ArrayStorage,
} from '../../common/type/array-storage.js';
import { isSubtype, resolveTypeReference } from '../../common/type/subtype.js';
import { stripMissingFromType } from '../../common/type/utils.js';
import { nanPoint, pointArity } from '../collection-utils.js';
import {
  _BoxedExpression,
  hasSymbolOrOperator,
} from './abstract-boxed-expression.js';
import {
  COUNTER_LIMIT,
  detachNominalType,
  isRedundantStore,
  nextSerial,
} from './boxed-object.js';
import { noteObjectConstructed, recordObjectRead } from './object-deps.js';
import { arrayJson } from './object-walk.js';
import {
  isExpression,
  isForeignEngineObject,
  isFunction,
  isMutableArray,
  isNumber,
} from './type-guards.js';
import { digest128, hashCode, markVolatileDigest } from './utils.js';
import { isWildcard, wildcardName } from './pattern-utils.js';

/**
 * What a cell type decides about the cells of an array, computed once when
 * the array is made: the storage (`arrayStorageKind()`, the only code that
 * decides it), and for a tuple cell the head of the value a read builds and
 * the type of each of its four elements.
 */
type CellSpec = {
  readonly cellType: BoxedType;
  readonly storage: ArrayStorage;
  readonly tuple: boolean;
  /** For a tuple cell: the name of the nominal type when the cell type is
   * one (`Pixel`), else `Tuple`. `undefined` for every other cell. */
  readonly tag: string | undefined;
  /** For a tuple cell: the type of each of its four elements. */
  readonly elements: readonly Type[] | undefined;
};

/**
 * Where the cells of a new array come from (`makeArray()`):
 *
 * - `fill`: `count` cells, each holding `value`;
 * - `elements`: one cell for each element, in order;
 * - `adopt`: the storage itself, with no pass over it. It must be of the
 *   storage kind of the cell type, with four bytes for each tuple cell. The
 *   cells are not checked: the caller guarantees that each holds a value of
 *   the cell type.
 *
 * The value of `fill` is evaluated once, and each element of `elements`
 * once; the evaluated value is checked and converted as the value of a store
 * is, and an expression cell holds it.
 */
export type ArraySource =
  | { readonly fill: Expression; readonly count: number }
  | { readonly elements: ReadonlyArray<Expression> }
  | { readonly adopt: ArrayCells };

/**
 * BoxedArray — a mutable array, the second mutable value kind beside
 * `BoxedObject` (`docs/plans/2026-11-25-mutable-arrays-spec.md`).
 *
 * The instance is the array: host reference identity of the instance is
 * array identity, and the invariants of `BoxedObject` hold with "array" for
 * "object": one instance per array (`canonical`, `evaluate`, `N`, `subs`,
 * `map`, ... return `this`), the hash from the construction serial alone,
 * and identity as the only equality (`compare.ts`).
 *
 * The cell type selects the storage (`arrayStorageKind()`): a typed array for
 * machine cells, four bytes for each cell of the tuple cell, and an array of
 * evaluated expressions otherwise. `_read()` and `_store()` are the only code
 * that reads or writes a cell for a program; the walks of serialization and
 * display read with `_peek()`, which records no dependency.
 *
 * An array is not a collection in this version: `isCollection` is false, and
 * the operators that read and write one are later work items.
 *
 * Every field is set in the constructor, in one order, so that every array
 * has one hidden class.
 */
export class BoxedArray extends _BoxedExpression implements ArrayInterface {
  override readonly _kind = 'array';

  [Symbol.toStringTag]: string = '[BoxedArray]';

  /** The cell type and what it decides about the storage. */
  readonly _spec: CellSpec;

  /** The cells. `_store()` and `_swapWith()` are the only writers. */
  _cells: ArrayCells;

  /** The number of cells. A tuple cell holds 4 entries of `_cells`. */
  _count: number;

  /** Per-array cache currency, as `BoxedObject._version`. */
  _version: number;

  /** Per-engine construction serial, from the counter of objects; the sole
   * input to {@link hash}. */
  readonly _serial: number;

  /** The pinned type `array<T>`. */
  private readonly _type: BoxedType;

  /**
   * Not the construction path: use `ce._array()` (`makeArray()`).
   * @internal
   */
  constructor(
    ce: ComputeEngine,
    spec: CellSpec,
    cells: ArrayCells,
    count: number,
    type: BoxedType
  ) {
    super(ce);
    this._spec = spec;
    this._cells = cells;
    this._count = count;
    this._version = 0;
    this._serial = nextSerial(ce);
    this._type = type;
    noteObjectConstructed(ce);
  }

  /** The inert head-word, for display only, as `BoxedObject.operator`. */
  get operator(): string {
    return 'Array';
  }

  /** `["Object", ["List", …cells], "'array<T>'"]`, computed fresh at each
   * access (`object-walk.ts`). */
  get json(): MathJsonExpression {
    return arrayJson(this);
  }

  /** Identity hash, from the construction serial: a store does not change
   * it, and it reads no cell. */
  get hash(): number {
    return hashCode('Array' + this._serial);
  }

  /** The content digest, as `BoxedObject.digest`: it reads every cell, and
   * it is not memoized. */
  get digest(): string {
    markVolatileDigest(this);
    return digest128(`A\u001f${JSON.stringify(this.json)}`);
  }

  get type(): BoxedType {
    return this._type;
  }

  /** The storage, by reference: a typed array for machine cells, with four
   * bytes for each tuple cell, a read-only array for expression cells. */
  get cells(): ArrayCells {
    return this._cells;
  }

  /** The change signal: a store that changes a cell increments it. */
  get version(): number {
    return this._version;
  }

  /** The number of cells. Overrides the collection count of the base class:
   * an array is not a collection, and this is its length. */
  override get count(): number {
    return this._count;
  }

  get cellType(): BoxedType {
    return this._spec.cellType;
  }

  /** @internal */
  get _storage(): ArrayStorage {
    return this._spec.storage;
  }

  /** @internal */
  get _tuple(): boolean {
    return this._spec.tuple;
  }

  /** @internal */
  get _tupleTag(): string | undefined {
    return this._spec.tag;
  }

  /** The value is inert, as an object is: making an array and storing to it
   * carry the `state` label, not the value. */
  get isPure(): boolean {
    return true;
  }

  get isCanonical(): boolean {
    return true;
  }
  set isCanonical(_val: boolean) {
    return;
  }

  get value(): Expression | undefined {
    return undefined;
  }

  /** True if a cell holds the symbol or operator `v`. Machine cells hold
   * numbers only. */
  override has(v: string | string[]): boolean {
    return hasSymbolOrOperator(this, v);
  }

  get complexity(): number {
    return 1000;
  }

  /** An array is not a collection in this version (decision U4). */
  get isCollection(): boolean {
    return false;
  }

  get isIndexedCollection(): boolean {
    return false;
  }

  get isLazyCollection(): boolean {
    return false;
  }

  /** A fixed reference, as `BoxedObject.isConstant`: the reference never
   * changes, and a read records the version (`object-deps.ts`). */
  override get isConstant(): boolean {
    return true;
  }

  //
  // One instance per array, forever.
  //

  override get canonical(): Expression {
    return this;
  }

  override get structural(): Expression {
    return this;
  }

  override evaluate(_options?: Partial<EvaluateOptions>): Expression {
    return this;
  }

  override N(): Expression {
    return this;
  }

  override simplify(_options?: Partial<SimplifyOptions>): Expression {
    return this;
  }

  override subs(
    _sub: Substitution,
    _options?: { canonical?: CanonicalOptions }
  ): Expression {
    return this;
  }

  override map(
    _fn: (x: Expression) => Expression,
    _options?: { canonical: CanonicalOptions; recursive?: boolean }
  ): Expression {
    return this;
  }

  override _unshared(): _BoxedExpression {
    return this;
  }

  /** An array matches itself and an ordinary wildcard, as an object does. */
  match(
    pattern: string | ExpressionInput,
    _options?: PatternMatchOptions
  ): BoxedSubstitution | null {
    const p = isExpression(pattern)
      ? pattern
      : this.engine.expr(pattern as ExpressionInput, { form: 'raw' });

    if (isWildcard(p)) return { [wildcardName(p)!]: this };
    if (!isMutableArray(p)) return null;
    return (p as Expression) === (this as Expression) ? {} : null;
  }

  //
  // The cells.
  //

  /**
   * The cell at the 1-based `index`, a negative index counting from the end.
   * For an index that is 0, not an integer or out of range: what `At` gives
   * for a list of the cell type (`NaN` for a number cell, the tuple of four
   * `NaN` for a tuple cell, `Missing` otherwise).
   *
   * The read is reported to the open dependency collectors before the load,
   * as `BoxedObject._field()` reports one.
   */
  _read(index: number): Expression {
    recordObjectRead(this, this._version);
    const i = cellOffset(index, this._count);
    if (i < 0) return absentCell(this.engine, this._spec);
    return this._peek(i);
  }

  /**
   * The cell at the 0-based offset `i`, which must be in range, with no
   * dependency recorded: for the walks of serialization and display, whose
   * results are never memoized. A program reads with {@link _read}.
   */
  _peek(i: number): Expression {
    const spec = this._spec;
    const cells = this._cells;
    if (spec.storage === 'expression') return (cells as Expression[])[i];
    const ce = this.engine;
    if (spec.tuple) {
      const bytes = cells as Uint8Array;
      const at = 4 * i;
      return ce._fn(spec.tag!, [
        ce.number(bytes[at]),
        ce.number(bytes[at + 1]),
        ce.number(bytes[at + 2]),
        ce.number(bytes[at + 3]),
      ]);
    }
    return ce.number((cells as Float64Array)[i]);
  }

  /**
   * Store the evaluated `value` in the cell at the 1-based `index` (a
   * negative index counts from the end).
   *
   * Returns `undefined` when the cell holds the value after the call: the
   * value was written, or the cell already held it. Otherwise returns an
   * error and changes nothing:
   *
   * - `out-of-range`, for an index that is 0, not an integer or out of
   *   range, with the message of the element write of a list;
   * - `incompatible-type` (`ce.typeError()`), for a value that the cell type
   *   does not hold (spec section 3, "The value of a store");
   * - `value` itself when it is not valid (an error), as a field store
   *   returns it.
   *
   * Throws `object-foreign-engine` for an object or an array of another
   * engine, as `BoxedObject._store()` does.
   *
   * A store that changes the cell increments `_version`, advances
   * `_objectStoreEpoch` and reports one `object-store` state event, as a
   * field store does.
   */
  _store(index: number, value: Expression): Expression | undefined {
    if (isForeignEngineObject(value, this.engine)) {
      throw new Error(
        `object-foreign-engine: cannot store a value that belongs to a different engine into an array`
      );
    }
    const i = cellOffset(index, this._count);
    if (i < 0) return outOfRange(this.engine, index, this._count);
    if (!value.isValid) return value;

    const spec = this._spec;
    if (spec.storage === 'expression') {
      if (!value.type.matches(spec.cellType))
        return this.engine.typeError(spec.cellType.type, value.type, value);
      const cells = this._cells as Expression[];
      if (isRedundantStore(cells[i], value)) return undefined;
      this._beforeChange();
      cells[i] = value;
    } else if (spec.tuple) {
      const bytes = tupleBytes(spec, value);
      if (bytes === undefined)
        return this.engine.typeError(spec.cellType.type, value.type, value);
      const cells = this._cells as Uint8Array;
      const at = 4 * i;
      if (
        cells[at] === bytes[0] &&
        cells[at + 1] === bytes[1] &&
        cells[at + 2] === bytes[2] &&
        cells[at + 3] === bytes[3]
      )
        return undefined;
      this._beforeChange();
      cells.set(bytes, at);
    } else {
      const x = machineNumber(spec, value);
      if (x === undefined)
        return this.engine.typeError(spec.cellType.type, value.type, value);
      const cells = this._cells as Float64Array;
      // `Object.is`, not `===`: `-0` over `0` changes a `real` cell.
      if (Object.is(cells[i], x)) return undefined;
      this._beforeChange();
      cells[i] = x;
    }
    this._afterChange();
    return undefined;
  }

  /**
   * Exchange the cells and the count of this array and `other`, in O(1)
   * (spec section 6, "The exchange of two arrays"). Neither array changes
   * identity. Both versions are incremented, the store epoch advances once
   * and one state event is reported.
   *
   * Returns `true` when the exchange is done, and for `a._swapWith(a)`,
   * which changes nothing. Returns `false`, and changes nothing, when the
   * cell types of the two arrays are not the same type (mutual subtypes):
   * the caller gives `incompatible-type`. Throws `object-foreign-engine` for
   * an array of another engine.
   */
  _swapWith(other: BoxedArray): boolean {
    if (other === this) return true;
    if (isForeignEngineObject(other, this.engine)) {
      throw new Error(
        `object-foreign-engine: cannot exchange the cells of arrays of two engines`
      );
    }
    const a = this._spec;
    const b = other._spec;
    if (
      a.storage !== b.storage ||
      a.tuple !== b.tuple ||
      !isSubtype(a.cellType.type, b.cellType.type) ||
      !isSubtype(b.cellType.type, a.cellType.type)
    )
      return false;
    this._beforeChange();
    other._beforeChange();
    const cells = this._cells;
    const count = this._count;
    this._cells = other._cells;
    this._count = other._count;
    other._cells = cells;
    other._count = count;
    other._version += 1;
    this._afterChange();
    return true;
  }

  /** The overflow guard of `BoxedObject._store()`, before a write. */
  private _beforeChange(): void {
    if (this._version >= COUNTER_LIMIT) {
      console.assert(false, 'Array version counter exhausted');
      throw new Error(
        'Array version counter exhausted: too many stores to this array'
      );
    }
  }

  /** What a store does after its write, as `BoxedObject._store()`. */
  private _afterChange(): void {
    this._version += 1;
    this.engine._objectStoreEpoch += 1;
    this.engine._noteStateEvent({ kind: 'object-store' });
  }
}

/**
 * Make an array whose cells have the type `cellType`, from `source`
 * (`ArraySource`) — `ce._array()` is its engine-facing spelling.
 *
 * The value of `fill` and each element of `elements` is evaluated once, and
 * the cells hold the evaluated values.
 *
 * Returns the array, or, when a value of `fill` or `elements` is not a value
 * of the cell type, the error that a store of it gives (`incompatible-type`,
 * or the value itself when it is an error): one element that fails fails the
 * whole construction, and no array is made. `isMutableArray()` tells the
 * two apart.
 *
 * Throws for a count that is not a non-negative integer, for an adopted
 * storage of another kind than the cell type selects (or a tuple storage
 * whose length is not a multiple of 4), and `object-foreign-engine` for a
 * value of another engine.
 */
export function makeArray(
  ce: ComputeEngine,
  cellType: BoxedType,
  source: ArraySource
): Expression {
  cellType = pinCellType(cellType);
  const spec = cellSpec(cellType);
  const type = ce.type({ kind: 'array', elements: cellType.type });

  if ('adopt' in source) {
    const cells = source.adopt;
    if (!isStorageOf(cells, spec.storage))
      throw new Error(
        `The storage of an array<${cellType.toString()}> must be ${storageName(spec.storage)}`
      );
    if (spec.tuple && cells.length % 4 !== 0)
      throw new Error(
        `The storage of an array<${cellType.toString()}> must hold 4 bytes for each cell`
      );
    const count = spec.tuple ? cells.length / 4 : cells.length;
    return new BoxedArray(ce, spec, cells, count, type);
  }

  if ('fill' in source) {
    const count = source.count;
    if (!Number.isInteger(count) || count < 0)
      throw new RangeError(`The count of an array must be a non-negative integer, not ${count}`);
    const value = source.fill.evaluate();
    const cell = convertCell(ce, spec, value);
    if (cell.error !== undefined) return cell.error;
    const cells = allocate(spec, count);
    if (spec.storage === 'expression') (cells as Expression[]).fill(value);
    else if (spec.tuple) {
      const bytes = cells as Uint8Array;
      for (let at = 0; at < bytes.length; at += 4) bytes.set(cell.bytes!, at);
    } else (cells as Float64Array).fill(cell.number!);
    return new BoxedArray(ce, spec, cells, count, type);
  }

  const elements = source.elements;
  const count = elements.length;
  const cells = allocate(spec, count);
  for (let i = 0; i < count; i++) {
    const value = elements[i].evaluate();
    const cell = convertCell(ce, spec, value);
    if (cell.error !== undefined) return cell.error;
    if (spec.storage === 'expression') (cells as Expression[])[i] = value;
    else if (spec.tuple) (cells as Uint8Array).set(cell.bytes!, 4 * i);
    else (cells as Float64Array)[i] = cell.number!;
  }
  return new BoxedArray(ce, spec, cells, count, type);
}

/**
 * The cell type that an array keeps, from the `cellType` given: read through
 * transparent aliases, and, for a nominal type, a detached copy of the
 * registry's reference (`detachNominalType()`, as an object pins its type).
 * A later declaration of the same name then changes neither the storage nor
 * the checks nor the type of the array (spec section 3, "Aliases and
 * declared types").
 */
function pinCellType(cellType: BoxedType): BoxedType {
  const t = throughTransparentAliases(cellType.type) ?? cellType.type;
  const pinned =
    t === cellType.type ? cellType : new BoxedType(t, cellType.typeResolver);
  return typeof t === 'object' && t.kind === 'reference'
    ? detachNominalType(pinned)
    : pinned;
}

/** The cell spec of the (pinned) cell type `cellType`. */
function cellSpec(cellType: BoxedType): CellSpec {
  const { storage, tuple } = arrayStorageKind(cellType.type);
  if (!tuple)
    return { cellType, storage, tuple, tag: undefined, elements: undefined };
  const t = resolveTypeReference(cellType.type);
  // Each element is read through its transparent aliases now, so that a
  // later declaration of an alias does not change the check of a byte.
  const elements =
    typeof t === 'object' && t.kind === 'tuple'
      ? t.elements.map((e) => throughTransparentAliases(e.type) ?? e.type)
      : undefined;
  return { cellType, storage, tuple, tag: tupleTag(cellType.type), elements };
}

/** The head of the value of a tuple cell: the name of the nominal type that
 * the cell type is, through aliases, or `Tuple` for a structural tuple
 * type. A nominal tuple value is the inert tagged application of its name
 * (`type-constructors.ts`). */
function tupleTag(t: Type): string {
  const seen = new Set<object>();
  while (typeof t === 'object' && t.kind === 'reference' && !seen.has(t)) {
    if (!t.alias) return t.name;
    if (t.def === undefined) break;
    seen.add(t);
    t = t.def;
  }
  return 'Tuple';
}

/** The 0-based offset of the 1-based `index` in an array of `count` cells,
 * a negative index counting from the end, or -1 for an index that is 0, not
 * an integer or out of range. */
function cellOffset(index: number, count: number): number {
  if (!Number.isInteger(index) || index === 0 || Math.abs(index) > count)
    return -1;
  return index > 0 ? index - 1 : count + index;
}

/** The error of a store at an index out of range, worded as the element
 * write of a list words it (`library/control-structures.ts`). */
function outOfRange(ce: ComputeEngine, index: number, count: number): Expression {
  return ce.error([
    'out-of-range',
    count === 0
      ? 'an index of a non-empty array'
      : `an index in 1..${count} or -${count}..-1`,
    ce.number(index).toString(),
  ]);
}

/**
 * The value of a read out of range: what `At` gives for a list whose
 * elements have the cell type (`domainAbsenceMarker()` of
 * `library/collections.ts`): `NaN` for a number type, a tuple of `NaN` for a
 * point type, `Missing` otherwise. A tuple cell gives the tuple of four
 * `NaN`, also when its type is nominal (spec section 3, "Tuple cells").
 */
function absentCell(ce: ComputeEngine, spec: CellSpec): Expression {
  if (spec.tuple) return nanPoint(ce, 4);
  if (spec.storage !== 'expression') return ce.NaN;
  const t = stripMissingFromType(spec.cellType.type);
  if (t === 'never' || t === 'unknown' || t === 'any') return ce.Missing;
  if (isSubtype(t, 'number')) return ce.NaN;
  const n = pointArity(t);
  if (n !== undefined) return nanPoint(ce, n);
  return ce.Missing;
}

/**
 * The machine number that a scalar machine cell (integer or `real`) holds
 * for `value`, or `undefined` when the cell type does not hold it (spec
 * section 3, "The value of a store"):
 *
 * - an integer cell takes an integer literal of the cell type; the test is
 *   against the cell type, not the storage (200 is refused by
 *   `integer<0..100>`);
 * - a `real` cell takes a finite real number of the cell type (an integer, a
 *   rational, an exact constant such as `Pi`, a machine number), and holds
 *   its machine number.
 */
function machineNumber(spec: CellSpec, value: Expression): number | undefined {
  if (spec.storage === 'float64') {
    if (!value.type.matches(spec.cellType)) return undefined;
    const n = isNumber(value) ? value : value.N();
    if (!isNumber(n) || n.im !== 0) return undefined;
    const x = n.re;
    return Number.isFinite(x) ? x : undefined;
  }
  return machineInteger(value, spec.cellType);
}

/** The integer of `value` when it is an integer literal of type `type`,
 * with `-0` read as `0`. */
function machineInteger(
  value: Expression,
  type: BoxedType | Type
): number | undefined {
  if (!isNumber(value) || !value.type.matches(type)) return undefined;
  const x = value.re;
  // `-0` is the integer 0: a store of it over a 0 changes nothing.
  return Number.isInteger(x) && value.im === 0 ? (x === 0 ? 0 : x) : undefined;
}

/**
 * The four bytes of a tuple cell for `value`, or `undefined` when the cell
 * type does not hold it: a tuple of four elements, each an integer of its
 * element type. For a nominal cell type the value is that type's tagged
 * value (`Pixel(1, 2, 3, 4)`); for a structural one, a `Tuple`.
 */
function tupleBytes(spec: CellSpec, value: Expression): number[] | undefined {
  if (!isFunction(value) || value.operator !== spec.tag || value.nops !== 4)
    return undefined;
  const elements = spec.elements!;
  const bytes: number[] = [];
  for (let k = 0; k < 4; k++) {
    const x = machineInteger(value.ops[k], elements[k]);
    if (x === undefined) return undefined;
    bytes.push(x);
  }
  return bytes;
}

/** The cell of `value` in an array of the spec `spec`, or the error of a
 * store of it. */
function convertCell(
  ce: ComputeEngine,
  spec: CellSpec,
  value: Expression
): { number?: number; bytes?: number[]; error?: Expression } {
  if (isForeignEngineObject(value, ce)) {
    throw new Error(
      `object-foreign-engine: cannot construct an array with a value that belongs to a different engine`
    );
  }
  if (!value.isValid) return { error: value };
  if (spec.storage === 'expression') {
    if (!value.type.matches(spec.cellType))
      return { error: ce.typeError(spec.cellType.type, value.type, value) };
    return {};
  }
  if (spec.tuple) {
    const bytes = tupleBytes(spec, value);
    if (bytes === undefined)
      return { error: ce.typeError(spec.cellType.type, value.type, value) };
    return { bytes };
  }
  const x = machineNumber(spec, value);
  if (x === undefined)
    return { error: ce.typeError(spec.cellType.type, value.type, value) };
  return { number: x };
}

/** New storage of `count` cells for the spec `spec`, filled with zeros (or
 * with holes for expression cells, which the caller fills). */
function allocate(spec: CellSpec, count: number): ArrayCells {
  switch (spec.storage) {
    case 'uint8':
      return new Uint8Array(spec.tuple ? 4 * count : count);
    case 'int8':
      return new Int8Array(count);
    case 'uint16':
      return new Uint16Array(count);
    case 'int16':
      return new Int16Array(count);
    case 'uint32':
      return new Uint32Array(count);
    case 'int32':
      return new Int32Array(count);
    case 'float64':
      return new Float64Array(count);
    case 'expression':
      return new Array<Expression>(count);
  }
}

/** Is `cells` a storage of the kind `storage`? */
function isStorageOf(cells: ArrayCells, storage: ArrayStorage): boolean {
  switch (storage) {
    case 'uint8':
      return cells instanceof Uint8Array;
    case 'int8':
      return cells instanceof Int8Array;
    case 'uint16':
      return cells instanceof Uint16Array;
    case 'int16':
      return cells instanceof Int16Array;
    case 'uint32':
      return cells instanceof Uint32Array;
    case 'int32':
      return cells instanceof Int32Array;
    case 'float64':
      return cells instanceof Float64Array;
    case 'expression':
      return Array.isArray(cells);
  }
}

function storageName(storage: ArrayStorage): string {
  if (storage === 'expression') return 'an array of expressions';
  const name = `${storage[0].toUpperCase()}${storage.slice(1)}Array`;
  // `an Int8Array`, but `a Uint8Array` (a "you" sound) and `a Float64Array`.
  return `${storage.startsWith('int') ? 'an' : 'a'} ${name}`;
}
