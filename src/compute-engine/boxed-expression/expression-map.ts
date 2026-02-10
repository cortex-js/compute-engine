import type { Expression, ExpressionMapInterface } from '../global-types';

export class ExpressionMap<U> implements ExpressionMapInterface<U> {
  readonly _items: Map<Expression, U>;

  constructor(
    source?:
      | ExpressionMapInterface<U>
      | readonly (readonly [Expression, U])[]
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

  has(expr: Expression): boolean {
    for (const x of this._items.keys()) if (x.isSame(expr)) return true;

    return false;
  }

  get(expr: Expression): U | undefined {
    for (const [x, v] of this._items) if (x.isSame(expr)) return v;

    return undefined;
  }

  clear(): void {
    this._items.clear();
  }

  set(expr: Expression, value: U): void {
    for (const x of this._items.keys()) {
      if (x.isSame(expr)) {
        this._items.set(x, value);
        return;
      }
    }
    this._items.set(expr, value);
  }

  delete(expr: Expression): void {
    this._items.delete(expr);
  }

  [Symbol.iterator](): IterableIterator<[Expression, U]> {
    return this._items.entries();
  }

  entries(): IterableIterator<[Expression, U]> {
    return this._items.entries();
  }
}
