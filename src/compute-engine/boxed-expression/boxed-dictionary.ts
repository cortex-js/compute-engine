import { Expression } from '../../math-json/math-json-format';
import {
  BoxedExpression,
  IComputeEngine,
  EvaluateOptions,
  NOptions,
  BoxedRuleSet,
  SemiBoxedExpression,
  SimplifyOptions,
  ReplaceOptions,
  Substitution,
  Metadata,
  PatternMatchOption,
  BoxedDomain,
} from '../public';
import { AbstractBoxedExpression } from './abstract-boxed-expression';
import { serializeJsonFunction } from './serialize';
import { hashCode } from './utils';

/**
 * BoxedDictionary
 */

export class BoxedDictionary extends AbstractBoxedExpression {
  private _value: Map<string, BoxedExpression> = new Map();
  private _isCanonical: boolean;

  constructor(
    ce: IComputeEngine,
    dict: { [key: string]: SemiBoxedExpression },
    metadata?: Metadata
  ) {
    super(ce, metadata);
    this._isCanonical = false; // @todo: if all the values are canonical, it's canonical
    for (const key of Object.keys(dict))
      this._value.set(key, ce.box(dict[key]));

    ce._register(this);
  }

  _purge(): undefined {
    for (const [_k, v] of this._value) v._purge();
    return undefined;
  }

  get hash(): number {
    let h = hashCode('Dictionary');
    for (const [k, v] of this._value) h ^= hashCode(k) ^ v.hash;
    return h;
  }

  get complexity(): number {
    return 97;
  }

  get head(): 'Dictionary' {
    return 'Dictionary';
  }

  get isPure(): boolean {
    // @todo
    return false;
  }

  getKey(key: string): BoxedExpression | undefined {
    return this._value.get(key);
  }

  hasKey(key: string): boolean {
    return this._value.has(key);
  }

  get keys(): IterableIterator<string> {
    return this._value.keys();
  }

  get keysCount(): number {
    return this._value.size;
  }

  has(x: string | string[]): boolean {
    for (const [_k, v] of this._value) if (v.has(x)) return true;
    return false;
  }

  get domain(): BoxedDomain {
    const result: SemiBoxedExpression[] = ['Dictionary'];
    for (const [k, v] of this._value) result.push(['Tuple', k, v.domain]);

    return this.engine.domain(result);
  }

  get json(): Expression {
    // Is dictionary shorthand notation allowed?
    if (
      this.engine.jsonSerializationOptions.shorthands.includes('dictionary')
    ) {
      const dict = {};
      for (const key of this._value.keys())
        dict[key] = this._value.get(key)!.json;
      return { dict };
    }

    // The dictionary shorthand is not allowed, output it as a "Dictionary"
    // function
    const kvs: BoxedExpression[] = [];
    for (const key of this._value.keys())
      kvs.push(
        this.engine._fn('KeyValuePair', [
          this.engine.string(key),
          this._value.get(key)!,
        ])
      );

    return serializeJsonFunction(this.engine, 'Dictionary', kvs, {
      latex: this._latex,
    });
  }

  /** Structural equality */
  isSame(rhs: BoxedExpression): boolean {
    if (this === rhs) return true;
    if (!(rhs instanceof BoxedDictionary)) return false;

    if (this._value.size !== rhs._value.size) return false;

    for (const [k, v] of this._value) {
      const rhsV = rhs.getKey(k);
      if (!rhsV || !v.isSame(rhsV)) return false;
    }
    return true;
  }

  match(
    rhs: BoxedExpression,
    _options?: PatternMatchOption
  ): Substitution | null {
    if (!(rhs instanceof BoxedDictionary)) return null;

    if (this._value.size !== rhs._value.size) return null;

    let result = {};
    for (const [k, v] of this._value) {
      const rhsV = rhs.getKey(k);
      if (!rhsV) return null;
      const m = v.match(rhsV);
      if (m === null) return null;
      result = { ...result, ...m };
    }
    return result;
  }

  /** Mathematical equality */
  isEqual(rhs: BoxedExpression): boolean {
    if (this === rhs) return true;
    if (!(rhs instanceof BoxedDictionary)) return false;
    if (!rhs.keys || this._value.size !== rhs._value.size) return false;

    for (const [k, v] of this._value) {
      const rhsV = rhs.getKey(k);
      if (!rhsV || !v.isEqual(rhsV)) return false;
    }
    return true;
  }

  apply(
    fn: (x: BoxedExpression) => SemiBoxedExpression,
    head?: string
  ): BoxedExpression {
    const result = {};
    for (const key of this.keys)
      result[key] = this.engine.box(fn(this.getKey(key)!));
    if (head) return this.engine.fn(head, [{ dict: result }]);
    return new BoxedDictionary(this.engine, result);
  }

  evaluate(options?: EvaluateOptions): BoxedExpression {
    return this.apply((x) => x.evaluate(options) ?? x);
  }

  get isCanonical(): boolean {
    return this._isCanonical;
  }
  set isCanonical(val: boolean) {
    this._isCanonical = val;
  }

  get canonical(): BoxedExpression {
    if (this.isCanonical) return this;
    const result = this.apply((x) => x.canonical);
    result.isCanonical = true;
    return result;
  }

  simplify(options?: SimplifyOptions): BoxedExpression {
    if (!(options?.recursive ?? true)) return this;

    // In general, we should simplify the canonical form of this
    // expression, but for dictionaries, there is no canonical
    // form, except the canonical form of its elements

    return this.apply((x) => x.simplify(options) ?? x);
  }

  N(options?: NOptions): BoxedExpression {
    return this.apply((x) => x.N(options));
  }

  replace(
    rules: BoxedRuleSet,
    options?: ReplaceOptions
  ): null | BoxedExpression {
    // @todo: rules that apply to a `Dictionary` head should be accounted for
    let changeCount = 0;
    const result = {};
    for (const key of this.keys) {
      const val = this.getKey(key)!;
      const newVal = val.replace(rules, options);
      if (newVal !== null) changeCount += 1;
      result[key] = newVal ?? val;
    }
    return changeCount === 0 ? null : new BoxedDictionary(this.engine, result);
  }

  subs(sub: Substitution): BoxedExpression {
    const result = {};
    for (const key of this.keys) result[key] = this.getKey(key)!.subs(sub);

    return new BoxedDictionary(this.engine, result);
  }
}
