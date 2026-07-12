import { Complex } from 'complex-esm';
import { BigDecimal } from '../big-decimal/index.js';

import { isValidSymbol, validateSymbol } from '../math-json/symbols.js';
import type {
  MathJsonNumberObject,
  MathJsonSymbol,
} from '../math-json/types.js';

import { BoxedSymbol } from './boxed-expression/boxed-symbol.js';
import {
  BoxedNumber,
  canonicalNumber,
} from './boxed-expression/boxed-number.js';
import { isValueDef } from './boxed-expression/utils.js';
import { NumericValue } from './numeric-value/types.js';
import { isRational } from './numerics/rationals.js';
import type { Rational } from './numerics/types.js';
import type {
  BoxedDefinition,
  Expression,
  CanonicalOptions,
  Metadata,
  ValueDefinition,
  IComputeEngine as ComputeEngine,
} from './global-types.js';

export type CommonNumberTable = {
  [num: number]: null | Expression;
};

type SymbolHost = ComputeEngine & {
  strict: boolean;
  Nothing: Expression;
  lookupDefinition(id: MathJsonSymbol): undefined | BoxedDefinition;
  _declareSymbolValue(
    name: MathJsonSymbol,
    def: Partial<ValueDefinition>,
    scope?: import('./global-types.js').Scope
  ): BoxedDefinition;
  error(message: string | string[], where?: string): Expression;
};

type NumberHost = ComputeEngine & {
  Zero: Expression;
  One: Expression;
  NegativeOne: Expression;
  Two: Expression;
  NaN: Expression;
  PositiveInfinity: Expression;
  NegativeInfinity: Expression;
  _fn(
    name: MathJsonSymbol,
    ops: ReadonlyArray<Expression>,
    options?: { metadata?: Metadata; canonical?: boolean }
  ): Expression;
  number(
    value:
      | number
      | bigint
      | string
      | NumericValue
      | MathJsonNumberObject
      | BigDecimal
      | Complex
      | Rational,
    options?: { metadata: Metadata; canonical: CanonicalOptions }
  ): Expression;
};

function isNumberCanonicalized(canonical?: CanonicalOptions): boolean {
  if (canonical === undefined) return true;
  if (canonical === 'Number' || canonical === true) return true;
  if (Array.isArray(canonical) && canonical.includes('Number')) return true;
  return false;
}

export function createSymbolExpression(
  engine: SymbolHost,
  commonSymbols: { [symbol: string]: null | Expression },
  symbolName: string,
  options?: { canonical?: CanonicalOptions; metadata?: Metadata }
): Expression {
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

  // A function parameter shadows any same-named constant (`i`, `e`, ...) within
  // its body: while that body is being canonicalized, the parameter name is on
  // the engine's shadowed-parameter stack. Resolve it as an ordinary local
  // variable — use a closer non-constant binding if one exists, otherwise
  // auto-declare it locally. This leaves the closure-capture machinery (which
  // relies on free/captured variables auto-declaring in the innermost function
  // scope) completely untouched.
  if (engine._isShadowedParameter(name)) {
    // An annotated parameter (`["Typed", x, type]`) carries a declared type on
    // the shadowed-parameter stack. Bind it with that type, non-inferred, in
    // the body scope so canonicalization sees the annotation — even when an
    // outer non-constant binding of the same name exists (a parameter is a
    // fresh local and must shadow it, not reuse it).
    const declaredType = engine._shadowedParameterType(name);
    if (declaredType !== undefined) {
      // Reuse the parameter's own pre-declaration if a prior reference in this
      // body already created one — even in an ANCESTOR block scope (e.g. the
      // condition of an `If` whose branch Blocks reference the same parameter).
      // The binding is cached on the shadowed-parameter stack, so reuse is
      // bounded to THIS body's canonicalization (never an outer/global binding
      // of the same name, which a parameter must shadow). Sharing one binding
      // across all references avoids stray per-block copies that apply-time
      // parameter hiding never removes — those break recursion through
      // Block-wrapped branches.
      const cached = engine._shadowedParameterDef(name);
      if (cached !== undefined)
        return new BoxedSymbol(engine, name, { metadata, def: cached });

      let autoScope = engine.context.lexicalScope;
      while (autoScope.noAutoDeclare && autoScope.parent)
        autoScope = autoScope.parent;
      // Reuse an existing local in this exact scope (a prior reference here)
      // rather than re-declaring.
      const pdef =
        autoScope.bindings.get(name) ??
        engine._declareSymbolValue(
          name,
          { type: declaredType, inferred: false },
          autoScope
        );
      engine._setShadowedParameterDef(name, pdef);
      return new BoxedSymbol(engine, name, { metadata, def: pdef });
    }

    let pdef = engine.lookupDefinition(name);
    if (!pdef || (isValueDef(pdef) && pdef.value.isConstant)) {
      let autoScope = engine.context.lexicalScope;
      while (autoScope.noAutoDeclare && autoScope.parent)
        autoScope = autoScope.parent;
      pdef = engine._declareSymbolValue(
        name,
        { type: 'unknown', inferred: true },
        autoScope
      );
    }
    return new BoxedSymbol(engine, name, { metadata, def: pdef });
  }

  const result = commonSymbols[name];
  if (result) return result;

  let def = engine.lookupDefinition(name);
  if (isValueDef(def) && def.value.holdUntil === 'never')
    return def.value.value ?? engine.Nothing;

  if (def) return new BoxedSymbol(engine, name, { metadata, def });

  // Auto-declare: if current scope has noAutoDeclare, redirect to parent scope
  // so free variables in BigOp bodies land in the enclosing scope, not the BigOp scope.
  let autoScope = engine.context.lexicalScope;
  while (autoScope.noAutoDeclare && autoScope.parent)
    autoScope = autoScope.parent;
  def = engine._declareSymbolValue(
    name,
    { type: 'unknown', inferred: true },
    autoScope
  );
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
    | BigDecimal
    | Complex
    | Rational,
  options?: { metadata: Metadata; canonical: CanonicalOptions }
): Expression {
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
