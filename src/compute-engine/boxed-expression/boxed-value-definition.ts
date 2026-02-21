import type {
  Expression,
  ExpressionInput,
  ValueDefinition,
  BoxedValueDefinition,
  CollectionHandlers,
  IComputeEngine as ComputeEngine,
} from '../global-types';

import type { Type, TypeString } from '../../common/type/types';
import { parseType } from '../../common/type/parse';
import { isValidType } from '../../common/type/utils';
import { BoxedType } from '../../common/type/boxed-type';

import { defaultCollectionHandlers } from '../collection-utils';
import type { LatexString } from '../latex-syntax/types';

import { _BoxedExpression } from './abstract-boxed-expression';
import { isLatexString } from '../latex-syntax/utils';
import { ConfigurationChangeListener } from '../../common/configuration-change';

/**
 * ### THEORY OF OPERATIONS
 *
 * - The `_value` field IS the current value of the symbol. There is no
 *   separate "evaluation context" values map — the definition object is the
 *   single source of truth.
 *
 * - The `set value()` setter increments `ce._generation` so that cached
 *   results depending on this symbol are invalidated.
 *
 * - The value or type of a constant cannot be changed.
 *
 * - When the type is changed, the value is preserved if it is compatible
 *   with the new type, otherwise it is reset to no value.
 *
 * - When the value is changed, the type is unaffected. If the value is not
 *   compatible with the type (setting a def with a numeric type to a value
 *   of `True` for example), the value is discarded.
 *
 */

export class _BoxedValueDefinition
  implements BoxedValueDefinition, ConfigurationChangeListener
{
  readonly name: string; /** Used for debugging and error messages */

  wikidata?: string;
  description?: string | string[];
  url?: string;

  private _engine: ComputeEngine;

  // The defValue is the value as specified in the original definition.
  // It is used to update the actual value when the environment changes,
  // for example when the precision of the Compute Engine is changed.
  private _defValue?:
    | LatexString
    | ExpressionInput
    | ((ce: ComputeEngine) => ExpressionInput | null);

  // If `null`, the value needs to be recalculated from _defValue
  // If `undefined`, the value is not defined (for example, the symbol `True` does not have a value: the symbol itself *is* the value)
  private _value: Expression | undefined | null;

  // If `null`, the type is the type of the value
  // Note that `_type` may be different (wider) than the value's type
  private _type: BoxedType | undefined | null;

  // If true, the `_type` is inferred
  inferredType: boolean;

  // If `true`, the value or type cannot be changed
  _isConstant = false;

  // If 'never', the symbol is replaced by its value during canonicalization.
  // If 'evaluate', the symbol is replaced by its value during evaluation.
  // If 'N', the symbol is replaced during a numeric evaluation.
  holdUntil: 'never' | 'evaluate' | 'N' = 'evaluate';

  // Those optional handlers are used to compare the symbol with other
  // symbols or values. This is useful for example with sets
  eq?: (a: Expression) => boolean | undefined;
  neq?: (a: Expression) => boolean | undefined;
  cmp?: (a: Expression) => '=' | '>' | '<' | undefined;

  // This optional handler is used to do collection operations on the symbol
  collection?: CollectionHandlers;

  // This optional handler is used to evaluate subscripted expressions of this symbol
  subscriptEvaluate?: (
    subscript: Expression,
    options: { engine: ComputeEngine; numericApproximation?: boolean }
  ) => Expression | undefined;

  constructor(ce: ComputeEngine, name: string, def: Partial<ValueDefinition>) {
    this._engine = ce;
    this.name = name;

    if (def.wikidata) this.wikidata = def.wikidata;
    if (def.description) this.description = def.description;
    if (def.url) this.url = def.url;

    if (def.holdUntil) this.holdUntil = def.holdUntil;

    if (def.isConstant) {
      this._isConstant = def.isConstant;
      // Note it's OK for a constant to have no value (e.g. True)
      this._defValue = def.value;
    }

    if (def.type) {
      // Note: the type can be narrowed or widened. The canonicalization
      // handlers cannot make assumptions based on the type.
      const type =
        def.type instanceof BoxedType ? def.type : parseType(def.type);
      if (!isValidType(type))
        throw new Error(
          [`Symbol "${this.name}"`, `The type "${def.type}" is invalid `].join(
            '\n|   '
          )
        );

      this._type = new BoxedType(type, ce._typeResolver);
      this.inferredType = def.inferred ?? false;

      ce.listenToConfigurationChange(this);
    }

    this._value = dynamicValue(this._engine, def.value);

    if (this._value) {
      if (!this._type || this._type.isUnknown) {
        // Infer the type from the value if no type is specified
        if (this.isConstant) {
          // If this is a constant, the type is exactly the type of the value
          this._type = this._value.type;
          this.inferredType = false;
        } else {
          // If this is a variable, we "promote" the inferred type based on the value's type
          this._type = inferTypeFromValue(ce, this._value);
          this.inferredType = true;
        }
      } else {
        // If the value is not compatible with the type, throw
        if (!this._value.type.matches(this._type)) {
          throw new Error(
            [
              `Symbol "${this.name}"`,
              `The value "${this._value.toString()}" of type "${
                this._value.type
              }" is not compatible with the type "${this._type}"`,
            ].join('\n|   ')
          );
        }
      }
    }

    if (def.eq) this.eq = def.eq;
    if (def.neq) this.neq = def.neq;
    if (def.cmp) this.cmp = def.cmp;

    if (def.collection) {
      this.collection = defaultCollectionHandlers(def.collection);
    }

    if (def.subscriptEvaluate) this.subscriptEvaluate = def.subscriptEvaluate;

    if (this.holdUntil === 'never' && !this.isConstant)
      throw new Error(
        [
          `Symbol "${this.name}"`,
          `The "holdUntil" property cannot be "never" for a non-constant symbol`,
        ].join('\n|   ')
      );
  }

  /** For debugging */
  toJSON() {
    const result: Record<string, unknown> = {
      name: this.name,
      isConstant: this._isConstant,
    };
    if (this.wikidata) result.wikidata = this.wikidata;
    if (this.description) result.description = this.description;
    if (this.url) result.url = this.url;
    if (this._type) result.type = this._type.toString();
    result.inferredType = this.inferredType;
    result.holdUntil = this.holdUntil;
    if (this.collection) result.collection = this.collection;

    return result;
  }

  get isConstant(): boolean {
    return this._isConstant;
  }

  get value(): Expression | undefined {
    if (this._value === null)
      this._value = dynamicValue(this._engine, this._defValue);
    return this._value;
  }

  set value(v: Expression | undefined) {
    if (this._isConstant)
      throw new Error(`Cannot set value of constant "${this.name}"`);
    this._value = v;
    this._engine._generation += 1;
  }

  get type(): BoxedType {
    return this._type ?? this._value?.type ?? BoxedType.unknown;
  }

  set type(t: Type | TypeString | BoxedType) {
    if (this._isConstant)
      throw new Error(
        `The type of the constant "${this.name}" cannot be changed`
      );

    this._type =
      t instanceof BoxedType ? t : new BoxedType(t, this._engine._typeResolver);

    // Are we resetting the type/value?
    if (this._type.isUnknown) {
      this._defValue = undefined;
      this._value = undefined;
    }
  }

  onConfigurationChange(): void {
    // Force the value to be recalculated based on the original definition
    if (this.isConstant) this._value = null;
  }
}

function dynamicValue(
  ce: ComputeEngine,
  value:
    | undefined
    | LatexString
    | ExpressionInput
    | ((ce: ComputeEngine) => ExpressionInput | null)
) {
  if (value === undefined) return undefined;

  if (isLatexString(value)) return ce.parse(value) ?? ce.symbol('Undefined');

  if (typeof value === 'function') return ce.box(value(ce) ?? 'Undefined');

  if (value instanceof _BoxedExpression) return value;

  return ce.box(value);
}

function inferTypeFromValue(
  ce: ComputeEngine,
  value: Expression | undefined
): BoxedType {
  if (!value) return ce.type('unknown');

  // Note: the order of the checks is important, we want to promote the type
  // to the most specific type possible based on the value's type.

  if (value.type.matches('integer')) {
    // If the value matches an integer (or a finite_integer), we promote the type to `integer`
    // x = 2 => integer
    return ce.type('integer');
  }

  if (value.type.matches('rational')) {
    // If the value matches a rational number, we promote the type to `real`
    // x = 1/2 => real
    return ce.type('real');
  }

  if (value.type.matches('real')) {
    // If the value matches a real number (or `finite_real_number`), we promote the type to `real`
    // x = 3.14 => real
    // x = oo => real
    return ce.type('real');
  }

  if (value.type.matches('complex')) {
    // If the value is complex (3+2i) or imaginary (-4i), we promote the type to `number`
    // x = 3+2i => number
    return ce.type('number');
  }
  // No promotion for other types.
  // @todo: could consider promoting `list<T>` to `list` or...?
  return value.type;
}
