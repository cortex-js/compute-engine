import type {
  BoxedExpression,
  BoxedDomain,
  IComputeEngine,
  Metadata,
  PatternMatchOptions,
  BoxedSubstitution,
} from './public';

import { _BoxedExpression } from './abstract-boxed-expression';
import { hashCode, isBoxedExpression } from './utils';
import { isWildcard, wildcardName } from './boxed-patterns';
import { Type } from '../../common/type/types';

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

  get domain(): BoxedDomain {
    return this.engine.Strings;
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
  isEqual(rhs: number | BoxedExpression): boolean {
    if (typeof rhs === 'number') return false;
    return rhs.string === this._string;
  }
  isSame(rhs: BoxedExpression): boolean {
    return rhs.string === this._string;
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
}
