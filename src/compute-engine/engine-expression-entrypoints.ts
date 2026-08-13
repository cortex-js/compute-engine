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
import {
  recordTypeProvenance,
  currentBoxingEpoch,
} from './boxed-expression/type-provenance.js';
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

/**
 * Box a symbol.
 *
 * `options.autoDeclare === false` — or running inside an `engine._resolveOnly()`
 * region — selects the **resolve-only** mode: the name is resolved against the
 * scope chain exactly as usual (a `holdUntil: 'never'` constant still
 * substitutes its value, an existing definition still binds), but a name with
 * no definition anywhere stays UNBOUND instead of being declared in the current
 * scope. This is the symbol contract of the structural route, and the one a
 * partial canonical form (`canonical: ['Number']`) uses: such output is not
 * fully canonical, so it must not write to the caller's scope.
 * See `docs/plans/2026-08-04-parse-scope-control-design.md` A1.
 *
 * (Not honored by the shadowed-parameter branch below: a `Function` literal's
 * parameter is a binder-local declaration, not a free symbol, and that branch
 * is only live while a function body is being fully canonicalized.)
 */
export function createSymbolExpression(
  engine: SymbolHost,
  commonSymbols: { [symbol: string]: null | Expression },
  symbolName: string,
  options?: {
    canonical?: CanonicalOptions;
    metadata?: Metadata;
    autoDeclare?: boolean;
  }
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
      const existingTyped = autoScope.bindings.get(name);
      const pdef =
        existingTyped ??
        engine._declareSymbolValue(
          name,
          { type: declaredType, inferred: false },
          autoScope
        );
      engine._setShadowedParameterDef(name, pdef);
      const typedParamSym = new BoxedSymbol(engine, name, {
        metadata,
        def: pdef,
      });
      // Provenance: this binding was CREATED as a side effect of boxing (an
      // annotated parameter's first reference), not by a user declaration —
      // recorded only on creation, never on reuse of an existing local. The
      // occurrence is the cause: consumers compare it against the expression
      // being canonicalized to answer "was this binding created by the pass
      // running now?" (first-boxing binding divergence, Tycho item 178).
      if (existingTyped === undefined && isValueDef(pdef))
        recordTypeProvenance(pdef.value, {
          type: pdef.value.type,
          kind: 'auto-declared',
          axis: 'type',
          cause: typedParamSym,
          epoch: currentBoxingEpoch(engine),
        });
      return typedParamSym;
    }

    // Reuse the binding a prior reference to this bare parameter already
    // auto-declared — including one made in a SIBLING or ancestor Block scope
    // (an `if` branch, a loop body). Sharing one binding is what lets type
    // evidence accumulate on the parameter: `cs[j]` inside a `while` body
    // infers `cs: indexed_collection` onto the SAME binding the literal's
    // parameter operand ends up bound to (see the adoption step in
    // `canonicalFunctionLiteralArguments`), so the inferred signature reflects
    // the use and the lambda auto-broadcast doesn't misfire on a collection
    // argument.
    const cachedBare = engine._shadowedParameterDef(name);
    if (cachedBare !== undefined)
      return new BoxedSymbol(engine, name, { metadata, def: cachedBare });

    let autoScope = engine.context.lexicalScope;
    while (autoScope.noAutoDeclare && autoScope.parent)
      autoScope = autoScope.parent;
    // Reuse an existing local in this exact scope (a prior reference or a
    // hoisted declaration here) rather than re-declaring; NEVER an outer
    // binding — a parameter shadows, so resolving to a same-named global
    // would write the body's type evidence onto it (and sever the
    // parameter's own binding from that evidence).
    const existingBare = autoScope.bindings.get(name);
    const pdef =
      existingBare ??
      engine._declareSymbolValue(
        name,
        { type: 'unknown', inferred: true },
        autoScope
      );
    engine._setShadowedParameterDef(name, pdef);
    const bareParamSym = new BoxedSymbol(engine, name, { metadata, def: pdef });
    // Provenance: binding created as a side effect of boxing a bare
    // parameter's first reference — see the annotated-parameter branch above
    // for the contract (creation only, occurrence as cause).
    if (existingBare === undefined && isValueDef(pdef))
      recordTypeProvenance(pdef.value, {
        type: pdef.value.type,
        kind: 'auto-declared',
        axis: 'type',
        cause: bareParamSym,
        epoch: currentBoxingEpoch(engine),
      });
    return bareParamSym;
  }

  const result = commonSymbols[name];
  if (result) return result;

  let def = engine.lookupDefinition(name);
  if (isValueDef(def) && def.value.holdUntil === 'never')
    return def.value.value ?? engine.Nothing;

  if (def) return new BoxedSymbol(engine, name, { metadata, def });

  // Resolve-only: the name resolved to nothing, and this caller (or the
  // enclosing region) does not want a declaration written to its scope. Leave
  // the symbol unbound.
  if (options?.autoDeclare === false || engine._resolveOnlyDepth > 0)
    return new BoxedSymbol(engine, name, { metadata });

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
  const freeSym = new BoxedSymbol(engine, name, { metadata, def });
  // Provenance: binding created as a side effect of boxing a free symbol —
  // see the annotated-parameter branch above for the contract (creation
  // only, occurrence as cause).
  if (isValueDef(def))
    recordTypeProvenance(def.value, {
      type: def.value.type,
      kind: 'auto-declared',
      axis: 'type',
      cause: freeSym,
      epoch: currentBoxingEpoch(engine),
    });
  return freeSym;
}

/**
 * The symbol denoting `scope`'s OWN binding for `name` — the one way to build a
 * binder's variable.
 *
 * A binder (a `Function` literal's parameter, a `Sum` index, `D`'s variable)
 * declares its variable in its own scope, and every occurrence of it — the
 * binding site and the body — must denote THAT binding. `ce.symbol(name)`
 * cannot answer that question: it resolves a NAME, and for a name owned by a
 * library constant (`Pi`, `e`, `i`, ...) it short-circuits to the interned
 * constant expression before the scope chain is even consulted. A binder whose
 * variable is named after a constant then silently got the constant back —
 * `Function(Pi + 1, Pi)` applied to 10 gave `1 + π` instead of `11`.
 *
 * So the scope's bindings map is the authority here, not the lookup: the symbol
 * is built directly on the definition found there. Returns `undefined` when the
 * scope has no VALUE binding for the name (an operator binding, or none at all)
 * — a caller that cannot proceed without one should leave its operand alone.
 */
export function createBindingSymbolExpression(
  engine: ComputeEngine,
  name: MathJsonSymbol,
  scope: import('./global-types.js').Scope
): Expression | undefined {
  const binding = scope.bindings.get(name);
  if (!isValueDef(binding)) return undefined;
  return new BoxedSymbol(engine, name, { def: binding });
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
