import type {
  BoxedExpression,
  SemiBoxedExpression,
  SymbolDefinition,
  BoxedSymbolDefinition,
  CollectionHandlers,
  ComputeEngine,
  NumericFlags,
  RuntimeScope,
  Sign,
} from '../global-types';
import { _BoxedExpression } from './abstract-boxed-expression';
import { isLatexString, normalizeFlags } from './utils';

import { defaultCollectionHandlers } from '../collection-utils';
import { LatexString } from '../latex-syntax/types';

import { Type, TypeString } from '../../common/type/types';
import { parseType } from '../../common/type/parse';
import { isValidType, widen } from '../../common/type/utils';
import { BoxedType } from '../../common/type/boxed-type';

/**
 * ### THEORY OF OPERATIONS
 *
 * - The value or type of a constant cannot be changed.
 *
 * - If set explicitly, the value is the source of truth: it overrides any
 *   flags.
 *
 * - Once the type has been set, it can only be changed from a numeric type
 *   to another numeric type (some expressions may have been validated with
 *   assumptions that the just a number).
 *
 * - When the type is changed, the value is preserved if it is compatible
 *   with the new type, otherwise it is reset to no value. Flags are adjusted
 *   to match the type (discarded if not a numeric type).
 *
 * - When the value is changed, the type is unaffected. If the value is not
 *   compatible with the type (setting a def with a numeric type to a value
 *   of `True` for example), the value is discarded.
 *
 * - When getting a flag, if a value is available, it is the source of truth.
 *   Otherwise, the stored flags are (the stored flags are also set when the
 *   type is changed)
 *
 */

export class _BoxedSymbolDefinition implements BoxedSymbolDefinition {
  readonly name: string;

  wikidata?: string;
  description?: string | string[];
  url?: string;

  private _engine: ComputeEngine;
  readonly scope: RuntimeScope | undefined;

  // The defValue is the value as specified in the original definition.
  // It is used to update the actual value when the environment changes,
  // e.g. when the Compute Engine precision is changed.
  private _defValue?:
    | LatexString
    | SemiBoxedExpression
    | ((ce: ComputeEngine) => SemiBoxedExpression | null);

  // If `null`, the value needs to be recalculated from _defValue
  // If `undefined`, the value is not defined (for example, the symbol `True` does not have a value: the symbol itself *is* the value)
  private _value: BoxedExpression | undefined | null;

  // If `null`, the type is the type of the value
  // Note that _type may be different (broader) than the value's type
  private _type: BoxedType | undefined | null;

  // If true, the _type is inferred
  inferredType: boolean;

  // If true, the value cannot be changed
  constant = false;

  // If 'never', the symbol is replaced by its value during canonicalization.
  // If 'evaluate', the symbol is replaced byt its value during evaluation.
  // If 'N', the symbol is replaced during a numeric evaluation.
  holdUntil: 'never' | 'evaluate' | 'N' = 'evaluate';

  // The value has priority over the flags
  private _flags: Partial<NumericFlags> | undefined;

  eq?: (a: BoxedExpression) => boolean | undefined;
  neq?: (a: BoxedExpression) => boolean | undefined;
  cmp?: (a: BoxedExpression) => '=' | '>' | '<' | undefined;

  collection?: Partial<CollectionHandlers>;

  constructor(ce: ComputeEngine, name: string, def: SymbolDefinition) {
    if (!ce.context) throw Error('No context available');

    this.name = name;
    this._engine = ce;
    this.scope = ce.context;

    this.update(def);
  }

  get isFunction(): boolean {
    return this.type.matches('function');
  }

  get isConstant(): boolean {
    return this.constant;
  }

  /** The symbol was previously inferred, but now it has a declaration. Update the def accordingly (we can't replace defs, as other expressions may be referencing them) */
  update(def: SymbolDefinition): void {
    if (def.wikidata) this.wikidata = def.wikidata;
    if (def.description) this.description = def.description;
    if (def.url) this.url = def.url;

    if (def.flags) this._flags = normalizeFlags(def.flags);

    if (def.holdUntil) this.holdUntil = def.holdUntil;

    if (this.constant && def.constant === false) {
      throw new Error(
        `The constant "${this.name}" cannot be changed to a variable`
      );
    }

    if (def.constant) {
      this.constant = def.constant;
      this._defValue = def.value;
    }
    this._value = dynamicValue(this._engine, def.value);

    if (def.type) {
      // @todo: could check that the type is a narrowing of the current type
      const type = parseType(def?.type);
      if (!isValidType(type)) throw new Error(`Invalid type: "${def.type}"`);

      this._type = new BoxedType(type);
      this.inferredType = def.inferred ?? false;
    }

    if (this._value) {
      if (!this._type || this._type.isUnknown) {
        // The type is inferred, because the type of the value could be more restrictive than the intended type. For example, the value might be "2" (integer), but the intent is to declare it as a "number".
        this._type = this._value.type;
        this.inferredType = true;
      } else {
        // If the value is not compatible with the type, throw
        if (!this._value.type.matches(this._type)) {
          throw new Error(
            [
              `Symbol "${this.name}"`,
              `The value "${this._value.toString()}" of type "${this._value.type}" is not compatible with the type "${this._type}"`,
            ].join('\n|   ')
          );
        }
      }
    }

    if (def.eq) this.eq = def.eq;
    if (def.neq) this.neq = def.neq;
    if (def.cmp) this.cmp = def.cmp;

    if (def.collection)
      this.collection = defaultCollectionHandlers(def.collection);
  }

  reset(): void {
    // Force the value to be recalculated based on the original definition
    // Useful when the environment (e.g. precision) changes
    if (this.constant) this._value = null;
  }

  get value(): BoxedExpression | undefined {
    if (this._value === null)
      this._value = dynamicValue(this._engine, this._defValue);
    return this._value;
  }

  set value(val: SemiBoxedExpression | number | undefined) {
    if (this.constant)
      throw new Error(
        `The value of the constant "${this.name}" cannot be changed`
      );

    // There should be no _defValue (only constants would have them)
    console.assert(this._defValue === undefined);

    if (val !== undefined) {
      const newVal = this._engine.box(val);
      // If the new value is not compatible with the domain, discard it
      if (this.inferredType) {
        this._value = newVal;
        this._type = this._type
          ? new BoxedType(widen(this._type.type, newVal.type.type))
          : newVal.type;
      } else if (
        !this._type ||
        this.type.isUnknown ||
        !newVal.type ||
        newVal.type.matches(this._type)
      )
        this._value = newVal;
      else this._value = undefined;
    } else this._value = undefined;
  }

  get type(): BoxedType {
    return this._type ?? this._value?.type ?? BoxedType.unknown;
  }

  set type(type: Type | TypeString | BoxedType) {
    if (this.constant)
      throw new Error(
        `The type of the constant "${this.name}" cannot be changed`
      );

    if (!this.inferredType && !this.type.isUnknown)
      throw Error(
        `The type of "${this.name}" cannot be changed because it has already been declared`
      );

    if (type instanceof BoxedType) type = type.type;

    // Are we resetting the type/value?
    if (type === 'unknown') {
      this._defValue = undefined;
      this._value = undefined;
      this._flags = undefined;
      this._type = BoxedType.unknown;
      return;
    }

    // If the type is unknown, we can set it to anything
    if (this._type?.isUnknown) {
      this._type = new BoxedType(type);
      return;
    }

    if (this._value?.type && !this._value.type.matches(type))
      throw Error(
        `The type of "${this.name}" cannot be changed to "${type}" because its value has a type of "${this._value.type}"`
      );

    this._type = new BoxedType(type);
  }

  //
  // Flags
  //

  get sgn(): Sign | undefined {
    return this.value?.sgn ?? this._flags?.sgn;
  }
  set sgn(val: Sign | undefined) {
    this.updateFlags({ sgn: val });
  }
  get even(): boolean | undefined {
    return this.value?.isEven ?? this._flags?.even;
  }
  set even(val: boolean | undefined) {
    this.updateFlags({ even: val });
  }
  get odd(): boolean | undefined {
    return this.value?.isOdd ?? this._flags?.odd;
  }
  set odd(val: boolean | undefined) {
    this.updateFlags({ odd: val });
  }

  updateFlags(flags: Partial<NumericFlags>): void {
    // If this is a constant, can't set the flags
    if (this.constant)
      throw Error(
        `The flags of "${this.name}" cannot be changed because it is a constant`
      );

    this._flags = normalizeFlags({ ...(this._flags ?? {}), ...flags });
  }
}

function dynamicValue(
  ce: ComputeEngine,
  value:
    | undefined
    | LatexString
    | SemiBoxedExpression
    | ((ce: ComputeEngine) => SemiBoxedExpression | null)
) {
  if (value === undefined) return undefined;

  if (isLatexString(value)) return ce.parse(value) ?? ce.symbol('Undefined');

  if (typeof value === 'function') return ce.box(value(ce) ?? 'Undefined');

  if (value instanceof _BoxedExpression) return value;
  return ce.box(value);
}
