import type { Expression } from '../public';
import { match } from './patterns';

export class ExpressionMap<T extends number, U> {
  readonly _items: Map<Expression<T>, U>;

  constructor(source?: ExpressionMap<T, U> | Iterable<[T, U]>) {
    this._items = source
      ? new Map<Expression<T>, U>(
          source instanceof ExpressionMap ? source._items : source
        )
      : new Map<Expression<T>, U>();
  }

  has(expr: Expression<T>): boolean {
    for (const x of this._items.keys()) if (match(expr, x)) return true;

    return false;
  }

  get(expr: Expression<T>): U | undefined {
    for (const [x, v] of this._items) if (match(expr, x)) return v;

    return undefined;
  }

  // match(
  //   pattern: Expression<T>
  // ): [expression: { [symbol: string]: Expression<T> }, value: T][] {
  //   const result: [
  //     expression: { [symbol: string]: Expression<T> },
  //     value: T
  //   ][] = [];
  //   for (const [assumption, value] of this._items) {
  //     if (match(pattern, assumption)) {
  //       result.push([assumption, value]);
  //     }
  //   }
  //   return result;
  // }

  set(expr: Expression<T>, value: U): void {
    for (const x of this._items.keys()) {
      if (match(expr, x)) {
        this._items.set(x, value);
        return;
      }
    }
    this._items.set(expr, value);
  }

  delete(expr: Expression<T>): void {
    this._items.delete(expr);
  }

  [Symbol.iterator](): IterableIterator<[Expression<T>, U]> {
    return this._items.entries();
  }

  entries(): IterableIterator<[Expression<T>, U]> {
    return this._items.entries();
  }
}
