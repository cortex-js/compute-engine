import type {
  BoxedExpression,
  PatternMatchOptions,
  BoxedSubstitution,
  ComputeEngine,
  Metadata,
  SemiBoxedExpression,
  DictionaryInterface,
} from '../global-types';

import { _BoxedExpression } from './abstract-boxed-expression';
import { hashCode } from './utils';
import { isWildcard, wildcardName } from './boxed-patterns';
import { BoxedType } from '../../common/type/boxed-type';
import { Expression } from '../../math-json/types';
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

  constructor(
    ce: ComputeEngine,
    keyValues: Record<string, SemiBoxedExpression> | BoxedExpression,
    options?: {
      metadata?: Metadata;
      canonical?: boolean;
    }
  ) {
    super(ce, options?.metadata);

    // Handle different input types for canonical form support
    if (keyValues instanceof _BoxedExpression) {
      this._initFromExpression(keyValues, options);
    } else {
      this._initFromRecord(
        keyValues as Record<string, SemiBoxedExpression>,
        options
      );
    }
  }

  private _initFromRecord(
    keyValues: Record<string, SemiBoxedExpression>,
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
      if (keyValues[key] instanceof _BoxedExpression) {
        this._keyValues[key] = keyValues[key];
      } else {
        this._keyValues[key] = this.engine.box(keyValues[key], options);
      }
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
    return [
      'Dictionary',
      {
        dict: Object.fromEntries(
          Object.entries(this._keyValues).map(([k, v]) => [k, v.json])
        ),
      },
    ];
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
