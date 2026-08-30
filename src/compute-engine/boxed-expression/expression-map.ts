import type { Expression, ExpressionMapInterface } from '../global-types.js';

export class ExpressionMap<U> implements ExpressionMapInterface<U> {
  readonly _items: Map<Expression, U>;

  /** Bumped by every `set`/`delete`/`clear`. See the `version` getter. */
  private _version = 0;

  constructor(
    source?: ExpressionMapInterface<U> | readonly (readonly [Expression, U])[]
  ) {
    if (!source) {
      this._items = new Map<Expression, U>();
    } else if (source instanceof ExpressionMap) {
      this._items = new Map<Expression, U>(source._items);
    } else {
      this._items = new Map<Expression, U>(
        source as readonly (readonly [Expression, U])[]
      );
    }
  }

  /** The number of entries, in constant time (the wrapped `Map`'s size). */
  get size(): number {
    return this._items.size;
  }

  /**
   * A counter advanced by every mutation of this map, so a consumer that
   * caches something derived from the contents can revalidate with one
   * integer comparison instead of a walk.
   *
   * It counts MUTATIONS, not entries: a map that was filled and then cleared
   * has `size === 0` and a non-zero `version`. A map built from a source in
   * the constructor starts at 0 — copying is not a mutation of the copy, and
   * a fresh object is never confused with the one it was copied from because
   * a cache also keys on the map's identity.
   */
  get version(): number {
    return this._version;
  }

  has(expr: Expression): boolean {
    for (const x of this._items.keys()) if (x.isSame(expr)) return true;

    return false;
  }

  get(expr: Expression): U | undefined {
    for (const [x, v] of this._items) if (x.isSame(expr)) return v;

    return undefined;
  }

  clear(): void {
    this._version += 1;
    this._items.clear();
  }

  set(expr: Expression, value: U): void {
    this._version += 1;
    for (const x of this._items.keys()) {
      if (x.isSame(expr)) {
        this._items.set(x, value);
        return;
      }
    }
    this._items.set(expr, value);
  }

  delete(expr: Expression): void {
    this._version += 1;
    // Delete by value (`isSame`), consistent with `has`/`get`/`set` (which all
    // key on `isSame`, not object identity). An identity-based delete would
    // silently no-op when handed a structurally-equal but distinct instance
    // (e.g. a re-boxed assumption), leaving stale entries behind.
    for (const x of this._items.keys()) {
      if (x.isSame(expr)) {
        this._items.delete(x);
        return;
      }
    }
    this._items.delete(expr);
  }

  [Symbol.iterator](): IterableIterator<[Expression, U]> {
    return this._items.entries();
  }

  entries(): IterableIterator<[Expression, U]> {
    return this._items.entries();
  }
}
