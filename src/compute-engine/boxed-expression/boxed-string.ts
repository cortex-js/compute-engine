import type {
  BoxedExpression,
  IComputeEngine,
  Metadata,
  PatternMatchOptions,
  BoxedSubstitution,
} from './public.ts';

import { _BoxedExpression } from './abstract-boxed-expression.ts';
import { hashCode, isBoxedExpression } from './utils.ts';
import { isWildcard, wildcardName } from './boxed-patterns.ts';
import { Type } from '../../common/type/types.ts';

/**
 * BoxedString
 *
 * @noInheritDoc
 */

export class BoxedString extends _BoxedExpression {
  private readonly _string: string;
  constructor(ce: IComputeEngine, expr: string, metadata?: Metadata) {
    super(ce, metadata);
    // Strings are always stored in Unicode NFC canonical order
    // See https://unicode.org/reports/tr15/
    this._string = expr.normalize();

    ce._register(this);
  }
  get json(): string {
    return `'${this._string}'`;
  }
  get hash(): number {
    return hashCode('String' + this._string);
  }
  get operator(): string {
    return 'String';
  }
  get isPure(): boolean {
    return true;
  }
  get isCanonical(): boolean {
    return true;
  }
  set isCanonical(_va: boolean) {
    return;
  }

  get type(): Type {
    return 'string';
  }

  get complexity(): number {
    return 19;
  }
  get string(): string {
    return this._string;
  }

  match(
    pattern: BoxedExpression,
    _options?: PatternMatchOptions
  ): BoxedSubstitution | null {
    if (!isBoxedExpression(pattern))
      pattern = this.engine.box(pattern, { canonical: false });

    if (isWildcard(pattern)) return { [wildcardName(pattern)!]: this };

    if (!(pattern instanceof BoxedString)) return null;
    if (this._string === pattern._string) return {};
    return null;
  }

  get isCollection(): boolean {
    return true;
  }

  contains(rhs: BoxedExpression): boolean {
    if (!rhs.string) return false;
    return this._string.includes(rhs.string);
  }

  get size(): number {
    return this._string.length;
  }

  each(start?: number, count?: number): Iterator<BoxedExpression, undefined> {
    const data = this.string;
    let index = start ?? 1;
    count = Math.min(count ?? data.length, data.length);

    if (count <= 0) return { next: () => ({ value: undefined, done: true }) };

    return {
      next: () => {
        if (count! > 0) {
          count!--;
          return { value: this.engine.string(data[index++ - 1]), done: false };
        } else {
          return { value: undefined, done: true };
        }
      },
    };
  }

  at(index: number): BoxedExpression | undefined {
    return this.engine.string(this._string[index - 1]);
  }

  get(key: string | BoxedExpression): BoxedExpression | undefined {
    return undefined;
  }

  indexOf(expr: BoxedExpression): number {
    if (!expr.string) return -1;
    return this._string.indexOf(expr.string);
  }
}
