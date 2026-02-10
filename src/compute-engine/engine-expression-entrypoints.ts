import { Complex } from 'complex-esm';
import { Decimal } from 'decimal.js';

import { isValidSymbol, validateSymbol } from '../math-json/symbols';
import type { MathJsonNumberObject, MathJsonSymbol } from '../math-json/types';

import { BoxedSymbol } from './boxed-expression/boxed-symbol';
import { BoxedNumber, canonicalNumber } from './boxed-expression/boxed-number';
import { isValueDef } from './boxed-expression/utils';
import { NumericValue } from './numeric-value/types';
import { isRational } from './numerics/rationals';
import type { Rational } from './numerics/types';
import type {
  BoxedDefinition,
  BoxedExpression,
  CanonicalOptions,
  Metadata,
  ValueDefinition,
  IComputeEngine as ComputeEngine,
} from './global-types';

export type CommonNumberTable = {
  [num: number]: null | BoxedExpression;
};

type SymbolHost = ComputeEngine & {
  strict: boolean;
  Nothing: BoxedExpression;
  lookupDefinition(id: MathJsonSymbol): undefined | BoxedDefinition;
  _declareSymbolValue(
    name: MathJsonSymbol,
    def: Partial<ValueDefinition>
  ): BoxedDefinition;
  error(message: string | string[], where?: string): BoxedExpression;
};

type NumberHost = ComputeEngine & {
  Zero: BoxedExpression;
  One: BoxedExpression;
  NegativeOne: BoxedExpression;
  Two: BoxedExpression;
  NaN: BoxedExpression;
  PositiveInfinity: BoxedExpression;
  NegativeInfinity: BoxedExpression;
  _fn(
    name: MathJsonSymbol,
    ops: ReadonlyArray<BoxedExpression>,
    options?: { metadata?: Metadata; canonical?: boolean }
  ): BoxedExpression;
  number(
    value:
      | number
      | bigint
      | string
      | NumericValue
      | MathJsonNumberObject
      | Decimal
      | Complex
      | Rational,
    options?: { metadata: Metadata; canonical: CanonicalOptions }
  ): BoxedExpression;
};

function isNumberCanonicalized(canonical?: CanonicalOptions): boolean {
  if (canonical === undefined) return true;
  if (canonical === 'Number' || canonical === true) return true;
  if (Array.isArray(canonical) && canonical.includes('Number')) return true;
  return false;
}

export function createSymbolExpression(
  engine: SymbolHost,
  commonSymbols: { [symbol: string]: null | BoxedExpression },
  symbolName: string,
  options?: { canonical?: CanonicalOptions; metadata?: Metadata }
): BoxedExpression {
  const canonical = options?.canonical ?? true;
  const metadata = options?.metadata;

  // Symbols should use the Unicode NFC canonical form.
  const name = symbolName.normalize();

  // These are not valid symbols, but we allow them.
  const lcName = name.toLowerCase();
  if (lcName === 'infinity' || lcName === '+infinity')
    return engine.PositiveInfinity;
  if (lcName === '-infinity') return engine.NegativeInfinity;

  if (engine.strict && !isValidSymbol(name))
    return engine.error(['invalid-symbol', validateSymbol(name)], name);

  if (!canonical) return new BoxedSymbol(engine, name, { metadata });

  const result = commonSymbols[name];
  if (result) return result;

  let def = engine.lookupDefinition(name);
  if (isValueDef(def) && def.value.holdUntil === 'never')
    return def.value.value ?? engine.Nothing;

  if (def) return new BoxedSymbol(engine, name, { metadata, def });

  def = engine._declareSymbolValue(name, { type: 'unknown', inferred: true });
  return new BoxedSymbol(engine, name, { metadata, def });
}

export function createNumberExpression(
  engine: NumberHost,
  commonNumbers: CommonNumberTable,
  value:
    | number
    | bigint
    | string
    | NumericValue
    | MathJsonNumberObject
    | Decimal
    | Complex
    | Rational,
  options?: { metadata: Metadata; canonical: CanonicalOptions }
): BoxedExpression {
  const metadata = options?.metadata;
  const canonical = isNumberCanonicalized(options?.canonical);

  // We have been asked for a non-canonical rational...
  if (!canonical && isRational(value)) {
    return engine._fn(
      'Rational',
      [engine.number(value[0]), engine.number(value[1])],
      { ...metadata, canonical: false }
    );
  }

  // If not a rational, it's always canonical
  const canonicalValue = canonicalNumber(engine, value);

  // Is this number eligible to be a cached number expression?
  // (i.e. it has no associated metadata)
  if (metadata === undefined) {
    if (typeof canonicalValue === 'number') {
      const n = canonicalValue;
      if (n === 1) return engine.One;
      if (n === 0) return engine.Zero;
      if (n === -1) return engine.NegativeOne;
      if (n === 2) return engine.Two;

      if (Number.isInteger(n) && commonNumbers[n] !== undefined) {
        commonNumbers[n] ??= new BoxedNumber(engine, canonicalValue);
        return commonNumbers[n];
      }

      if (Number.isNaN(n)) return engine.NaN;
      if (!Number.isFinite(n))
        return n < 0 ? engine.NegativeInfinity : engine.PositiveInfinity;
    } else if (canonicalValue instanceof NumericValue) {
      if (canonicalValue.isZero) return engine.Zero;
      if (canonicalValue.isOne) return engine.One;
      if (canonicalValue.isNegativeOne) return engine.NegativeOne;
      if (canonicalValue.isNaN) return engine.NaN;
      if (canonicalValue.isNegativeInfinity) return engine.NegativeInfinity;
      if (canonicalValue.isPositiveInfinity) return engine.PositiveInfinity;
    }
  }

  return new BoxedNumber(engine, canonicalValue, { metadata });
}
