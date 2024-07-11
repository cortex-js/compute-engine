import Complex from 'complex.js';
import Decimal from 'decimal.js';
import { Expression } from '../../math-json/math-json-format';
import {
  BoxedExpression,
  IComputeEngine,
  EvaluateOptions,
  BoxedRuleSet,
  SemiBoxedExpression,
  ReplaceOptions,
  Substitution,
  Metadata,
  PatternMatchOptions,
  BoxedDomain,
  BoxedSubstitution,
  Rule,
  CanonicalOptions,
} from './public';
import { _BoxedExpression } from './abstract-boxed-expression';
import { hashCode, isBoxedExpression } from './utils';
import { isWildcard, wildcardName } from './boxed-patterns';

/**
 * BoxedDictionary
 *
 * @noInheritDoc
 */

export class BoxedDictionary extends _BoxedExpression {
  private _value: Map<string, BoxedExpression> = new Map();
  private _isCanonical: boolean;

  constructor(
    ce: IComputeEngine,
    dict: { [key: string]: SemiBoxedExpression } | Map<string, BoxedExpression>,
    options?: { canonical?: CanonicalOptions; metadata?: Metadata }
  ) {
    options ??= {};

    super(ce, options.metadata);

    const canonical = options.canonical ?? true;

    if (dict instanceof Map) {
      for (const [key, value] of dict)
        this._value.set(key, ce.box(value, { canonical }));
    } else {
      for (const key of Object.keys(dict))
        this._value.set(key, ce.box(dict[key], { canonical }));
    }
    ce._register(this);
  }

  bind(): void {
    for (const [_k, v] of this._value) v.bind();
  }

  reset(): undefined {
    for (const [_k, v] of this._value) v.reset();
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
    // const result: SemiBoxedExpression[] = ['Dictionary'];
    // for (const [k, v] of this._value) result.push(['Tuple', k, v.domain]);

    return this.engine.domain('Dictionaries');
  }

  get json(): Expression {
    const ce = this.engine;
    const kvs: BoxedExpression[] = [];
    for (const key of this._value.keys())
      kvs.push(ce._fn('KeyValuePair', [ce.string(key), this._value.get(key)!]));

    return ['Dictionary', ...kvs.map((x) => x.json)];
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
    pattern:
      | Decimal
      | Complex
      | [num: number, denom: number]
      | SemiBoxedExpression
      | BoxedExpression,
    options?: PatternMatchOptions
  ): BoxedSubstitution | null {
    if (!isBoxedExpression(pattern))
      pattern = this.engine.box(pattern, { canonical: false });

    if (isWildcard(pattern as BoxedExpression))
      return { [wildcardName(pattern)!]: this };

    if (!(pattern instanceof BoxedDictionary)) return null;

    if (this._value.size !== pattern._value.size) return null;

    let result = {};
    for (const [k, v] of this._value) {
      const rhsV = pattern.getKey(k);
      if (!rhsV) return null;
      const m = v.match(rhsV, options);
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

  evaluate(_options?: Partial<EvaluateOptions>): BoxedExpression {
    return this;
  }

  get isCanonical(): boolean {
    return this._isCanonical;
  }
  set isCanonical(val: boolean) {
    this._isCanonical = val;
  }

  get canonical(): BoxedExpression {
    if (this.isCanonical) return this;
    return new BoxedDictionary(this.engine, this._value, { canonical: true });
  }

  simplify(): BoxedExpression {
    return this;
  }

  N(): BoxedExpression {
    return this;
  }

  replace(
    rules: BoxedRuleSet | Rule | Rule[],
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

  subs(
    sub: Substitution,
    options?: { canonical?: CanonicalOptions }
  ): BoxedExpression {
    const result = {};
    for (const key of this.keys)
      result[key] = this.getKey(key)!.subs(sub, options);

    return new BoxedDictionary(this.engine, result, options);
  }
}
