import type { BoxedExpression, ExpressionMapInterface } from '../global-types';

export class ExpressionMap<U> implements ExpressionMapInterface<U> {
  readonly _items: Map<BoxedExpression, U>;

  constructor(
    source?:
      | ExpressionMapInterface<U>
      | readonly (readonly [BoxedExpression, U])[]
  ) {
    if (!source) {
      this._items = new Map<BoxedExpression, U>();
    } else if (source instanceof ExpressionMap) {
      this._items = new Map<BoxedExpression, U>(source._items);
    } else {
      this._items = new Map<BoxedExpression, U>(
        source as readonly (readonly [BoxedExpression, U])[]
      );
    }
  }

  has(expr: BoxedExpression): boolean {
    for (const x of this._items.keys()) if (x.isSame(expr)) return true;

    return false;
  }

  get(expr: BoxedExpression): U | undefined {
    for (const [x, v] of this._items) if (x.isSame(expr)) return v;

    return undefined;
  }

  clear(): void {
    this._items.clear();
  }

  set(expr: BoxedExpression, value: U): void {
    for (const x of this._items.keys()) {
      if (x.isSame(expr)) {
        this._items.set(x, value);
        return;
      }
    }
    this._items.set(expr, value);
  }

  delete(expr: BoxedExpression): void {
    this._items.delete(expr);
  }

  [Symbol.iterator](): IterableIterator<[BoxedExpression, U]> {
    return this._items.entries();
  }

  entries(): IterableIterator<[BoxedExpression, U]> {
    return this._items.entries();
  }
}
