import type {
  BoxedExpression,
  PatternMatchOptions,
  BoxedSubstitution,
  ComputeEngine,
  Metadata,
  DictionaryInterface,
  JsonSerializationOptions,
} from '../global-types';

import { _BoxedExpression } from './abstract-boxed-expression';
import { hashCode } from './utils';
import { isWildcard, wildcardName } from './boxed-patterns';
import { BoxedType } from '../../common/type/boxed-type';
import { DictionaryValue, Expression } from '../../math-json/types';
import { widen } from '../../common/type/utils';

/**
 * BoxedDictionary
 *
 */

export class BoxedDictionary
  extends _BoxedExpression
  implements DictionaryInterface
{
  [Symbol.toStringTag]: string = '[BoxedDictionary]';
  private readonly _keyValues: Record<string, BoxedExpression> = {};
  private _type: BoxedType | undefined;

  /** The input to the constructor is either a ["Dictionary", ["KeyValuePair", ..., ...], ...] expression or a record of key-value pairs */
  constructor(
    ce: ComputeEngine,
    keyValues: Record<string, DictionaryValue> | BoxedExpression,
    options?: {
      metadata?: Metadata;
      canonical?: boolean;
    }
  ) {
    super(ce, options?.metadata);

    if (keyValues instanceof _BoxedExpression) {
      this._initFromExpression(keyValues, options);
    } else {
      this._initFromRecord(
        keyValues as Record<string, DictionaryValue>,
        options
      );
    }
  }

  private _initFromRecord(
    keyValues: Record<string, DictionaryValue>,
    options?: { canonical?: boolean }
  ) {
    for (const key in keyValues) {
      if (typeof key !== 'string') {
        throw new Error(
          `Dictionary keys must be strings, but got ${typeof key}`
        );
      }
      if (key.length === 0)
        throw new Error('Dictionary keys must not be empty strings');
      this._keyValues[key] = dictionaryValueToBoxedExpression(
        this.engine,
        keyValues[key],
        options
      );
    }
  }

  private _initFromExpression(
    dictionary: BoxedExpression,
    options?: { canonical?: boolean }
  ) {
    // Return early if already a BoxedDictionary
    if (dictionary instanceof BoxedDictionary) {
      Object.assign(this._keyValues, dictionary._keyValues);
      return;
    }

    // Parse a tuple as a dictionary expression with a single key-value pair
    if (
      dictionary.operator === 'Tuple' ||
      dictionary.operator === 'Pair' ||
      dictionary.operator === 'KeyValuePair'
    ) {
      if (dictionary.nops !== 2) {
        throw new Error(
          `Expected a key/value pair, got ${dictionary.nops} elements`
        );
      }
      const [key, value] = dictionary.ops!;
      let k: string;
      if (key.string) k = key.string;
      else if (key.symbol) k = key.symbol;
      else throw new Error(`Expected a string key, got ${key.type}`);

      this._keyValues[k] = value.canonical;
      return;
    }

    // Parse as a dictionary expression
    if (dictionary.operator === 'Dictionary') {
      for (const pair of dictionary.ops!) {
        if (
          pair.operator === 'KeyValuePair' ||
          pair.operator === 'Pair' ||
          pair.operator === 'Tuple'
        ) {
          const [key, value] = pair.ops!;
          let k: string;
          if (key.string) k = key.string;
          else if (key.symbol) k = key.symbol;
          else return; // Empty dictionary

          this._keyValues[k] = value.canonical;
        } else throw new Error(`Expected a key/value pair, got ${pair.type}`);
      }
      return;
    }

    // Default to empty dictionary for unrecognized expressions
  }

  get json(): Expression {
    return {
      dict: Object.fromEntries(
        Object.entries(this._keyValues).map(([k, v]) => [
          k,
          boxedExpressionToDictionaryValue(v),
        ])
      ),
    };
  }

  toMathJson(options: Readonly<JsonSerializationOptions>): Expression {
    if (options.shorthands.includes('dictionary')) {
      const result = this.json;
      return result;
    }
    if (this.isEmptyCollection) return { dict: {} };

    const result: Record<string, Expression> = {};
    for (const [key, value] of this.entries)
      result[key] = value.toMathJson(options);

    return { dict: result };
  }

  get hash(): number {
    return hashCode('Dictionary' + JSON.stringify(this._keyValues));
  }

  get operator(): string {
    return 'Dictionary';
  }

  get type(): BoxedType {
    if (this._type) return this._type;
    const eltType = widen(
      ...Object.values(this._keyValues).map((op) => op.type.type)
    );
    this._type = this.engine.type(`dictionary<${eltType}>`);
    return this._type;
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

  get value(): BoxedExpression | undefined {
    return undefined;
  }

  get complexity(): number {
    return 1000;
  }

  get isCollection(): boolean {
    return true;
  }

  get isIndexedCollection(): boolean {
    return false;
  }

  get isLazyCollection(): boolean {
    return false;
  }

  contains(_rhs: BoxedExpression): boolean | undefined {
    return undefined;
  }

  get count(): number | undefined {
    return Object.keys(this._keyValues).length;
  }

  get isEmptyCollection(): boolean {
    return Object.keys(this._keyValues).length === 0;
  }

  get isFiniteCollection(): boolean {
    return true;
  }

  each(): Generator<BoxedExpression> {
    // Return a tuple for each key-value pair
    const ce = this.engine;
    return (function* (self: BoxedDictionary) {
      for (const [key, value] of Object.entries(self._keyValues)) {
        yield ce.tuple(ce.string(key), value);
      }
    })(this);
  }

  get(key: string): BoxedExpression | undefined {
    return this._keyValues[key];
  }

  has(key: string): boolean {
    return this._keyValues.hasOwnProperty(key);
  }

  get keys(): string[] {
    return Object.keys(this._keyValues);
  }

  get entries(): [string, BoxedExpression][] {
    return Object.entries(this._keyValues);
  }

  get values(): BoxedExpression[] {
    return Object.values(this._keyValues);
  }

  match(
    pattern: BoxedExpression,
    _options?: PatternMatchOptions
  ): BoxedSubstitution | null {
    if (isWildcard(pattern)) return { [wildcardName(pattern)!]: this };

    if (!(pattern instanceof BoxedDictionary)) return null;

    // Match by values of the keys
    let result: BoxedSubstitution | null = null;
    const keys = Object.keys(pattern._keyValues);
    for (const key of keys) {
      if (!this._keyValues.hasOwnProperty(key)) return null;
      const value = this._keyValues[key];
      const patternValue = pattern._keyValues[key];
      if (!value.match(patternValue)) return null;
      if (isWildcard(pattern._keyValues[key])) {
        const wcKey = wildcardName(pattern._keyValues[key]);
        if (wcKey) result = { ...(result ?? {}), [wcKey]: value };
      }
    }
    return result;
  }
}

function boxedExpressionToDictionaryValue(
  value: BoxedExpression
): DictionaryValue {
  if (value.string) return value.string;
  if (value.symbol === 'True') return true;
  if (value.symbol === 'False') return false;
  if (value.symbol) return { sym: value.symbol };

  if (value.numericValue !== null && value.type.matches('real'))
    return value.re;

  if (value.operator === 'List')
    return value.ops!.map(boxedExpressionToDictionaryValue);

  return value.toMathJson({ shorthands: [] });
}

function dictionaryValueToBoxedExpression(
  ce: ComputeEngine,
  value: DictionaryValue | null | undefined,
  options?: { canonical?: boolean }
): BoxedExpression {
  if (value === null || value === undefined) return ce.Nothing;
  if (value instanceof _BoxedExpression) return value;
  if (typeof value === 'string') return ce.string(value);
  if (typeof value === 'number') return ce.number(value, options);
  if (typeof value === 'boolean') return value ? ce.True : ce.False;

  if (Array.isArray(value)) {
    return ce.function(
      'List',
      value.map((x) => dictionaryValueToBoxedExpression(ce, x, options))
    );
  }
  if (typeof value === 'object') {
    if ('num' in value) return ce.number(value.num, options);
    if ('str' in value) return ce.string(value.str);
    if ('sym' in value) return ce.symbol(value.sym, options);
    if ('fn' in value) return ce.box(value, options);
    if ('dict' in value) return new BoxedDictionary(ce, value.dict, options);
  }
  return ce.Nothing;
}
