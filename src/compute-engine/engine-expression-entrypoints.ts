import { Complex } from 'complex.js';
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
import { freeNameHomeScope } from './binding-unit.js';
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
 * See `docs/SCOPING-MODEL.md` A1.
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

  if (!canonical) {
    // A raw symbol of a macro name (`IComputeEngine._macroSuspects`).
    if (engine._macroCount > 0 && engine._macroNames.has(name))
      engine._macroSuspects += 1;
    return new BoxedSymbol(engine, name, { metadata });
  }

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
      // of the same name, which a parameter must shadow). All references
      // share one binding, the one that a call frame holds with the value of
      // the call: a per-block copy would have no value in the call, and
      // recursion through Block-wrapped branches would read it.
      const cached = engine._shadowedParameterDef(name);
      if (cached !== undefined)
        return new BoxedSymbol(engine, name, { metadata, def: cached });

      // The binding goes in the outermost scope below the boundary of the
      // frame on the current chain: the scope whose parent is the boundary.
      // While the body of the literal is canonicalized, that scope is the
      // body scope of the literal. The first reference can be in a nested function
      // literal: with `v` the parameter of `(v: list<integer>) ↦ Count(
      // Filter(xs, c ↦ v[3] = 1 && Min(Map(1..3, j ↦ v[j])) >= 0))`, the first
      // reference is in the body of `c ↦ …`. A binding declared there would
      // not be the one that the frame of the outer literal holds, and a read
      // of `v` by name in the body of `c ↦ …` (the callback `j ↦ v[j]` that
      // `Map` applies) would find it before the frame that holds the value.
      // A scope marked `noAutoDeclare` is not used: the search falls back to
      // the innermost scope that accepts a declaration.
      const boundary = engine._shadowedParameterBoundary(name);
      let autoScope = engine.context.lexicalScope;
      for (let s: typeof autoScope | null = autoScope; s; s = s.parent) {
        if (s.parent === boundary) {
          if (!s.noAutoDeclare) autoScope = s;
          break;
        }
      }
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
      engine._setShadowedParameterDef(name, pdef, existingTyped === undefined);
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
        recordTypeProvenance(engine, pdef.value, {
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
    // Reuse an existing local (a prior reference, or a binding a `Block`
    // hoisted for its `let`) rather than re-declaring. The search runs from
    // the current scope up to, and excluding, the boundary scope the name
    // was pushed from: a `Block` hoists its locals into its own scope and
    // pushes their names with the enclosing scope as the boundary, so a
    // reference from a NESTED block (an `if` branch, a loop body) finds the
    // hoisted binding one or more scopes up. Searching only the exact
    // current scope declared a second, `unknown` binding in the nested
    // scope for the first such reference and cached it as the name's
    // binding, so every later reference in the block bound to that copy
    // while the hoisted binding, which carries the declared or literal type
    // of the `let`, was left unused: `let xs = []` followed by
    // `while … { xs = [...xs, 4] }` typed `xs` as `collection<any>` from the
    // `Join`, not as the list it holds (Tycho item 332). NEVER a binding at
    // or beyond the boundary — a parameter shadows, so resolving to a
    // same-named global would write the body's type evidence onto it (and
    // sever the parameter's own binding from that evidence).
    const boundary = engine._shadowedParameterBoundary(name);
    // The walk is only safe when the boundary is an ancestor of the search
    // start: `autoScope` was moved up past `noAutoDeclare` scopes and can sit
    // at or above the boundary, and from there an unbounded walk would reach
    // a same-named outer or global binding. In that case only the exact
    // scope is searched, as before. The walk tests truthiness: the system
    // scope at the root of the chain has the parent `undefined`, not `null`
    // (`pushScope`, `engine-scope.ts`).
    type Scope = import('./global-types.js').Scope;
    let boundaryReachable = false;
    for (let s: Scope | null | undefined = autoScope; s; s = s.parent)
      if (s === boundary) {
        boundaryReachable = true;
        break;
      }
    let existingBare: BoxedDefinition | undefined = undefined;
    if (boundaryReachable) {
      for (
        let s: Scope | null = autoScope;
        s !== null && s !== boundary && existingBare === undefined;
        s = s.parent
      )
        existingBare = s.bindings.get(name);
    } else existingBare = autoScope.bindings.get(name);
    // A bare parameter for which the caller supplied an INFERRED type (a
    // fold's accumulator, see `canonicalFoldCombiner` in
    // `library/collections.ts`) is bound with that type, still as an
    // inferred type: a use may widen it, and nothing is enforced at apply
    // time. Without a hint the parameter starts `unknown`, as before.
    const pdef =
      existingBare ??
      engine._declareSymbolValue(
        name,
        {
          type: engine._shadowedParameterInferredType(name) ?? 'unknown',
          inferred: true,
        },
        autoScope
      );
    engine._setShadowedParameterDef(name, pdef, existingBare === undefined);
    const bareParamSym = new BoxedSymbol(engine, name, { metadata, def: pdef });
    // Provenance: binding created as a side effect of boxing a bare
    // parameter's first reference — see the annotated-parameter branch above
    // for the contract (creation only, occurrence as cause).
    if (existingBare === undefined && isValueDef(pdef))
      recordTypeProvenance(engine, pdef.value, {
        type: pdef.value.type,
        kind: 'auto-declared',
        axis: 'type',
        cause: bareParamSym,
        epoch: currentBoxingEpoch(engine),
      });
    return bareParamSym;
  }

  // `Object.hasOwn`, not a bare index: a symbol name is arbitrary user text, so
  // a name matching an inherited `Object.prototype` member (`toString`,
  // `constructor`, `valueOf`) reads that member off the prototype chain of a
  // plain-object table. The inherited value is a truthy JS function, so it was
  // returned here AS the boxed expression — `ce.box('toString')` handed the
  // caller `Object.prototype.toString` itself, and `ce.symbol('constructor')`
  // handed back `Object`. The guard belongs at the lookup rather than on the
  // table because this table arrives as a parameter and any caller may supply
  // a plain object.
  const result = Object.hasOwn(commonSymbols, name)
    ? commonSymbols[name]
    : undefined;
  const def = engine.lookupDefinition(name);
  // An interned symbol (`Pi`, `ExponentialE`, `Nothing`, …) is created once,
  // at startup, bound to its LIBRARY definition. Return it only while that is
  // still the definition the name resolves to: a user binding of the same
  // name (`let Pi = 3` in a program scope, a user function named `Pi`)
  // shadows the library name, and the symbol must then bind to the user's
  // definition, like any other name. Returning the interned symbol
  // unconditionally made `let Pi = 3; Pi` evaluate to π on the Epsil route.
  if (
    result &&
    (def === undefined ||
      (isValueDef(def) &&
        result instanceof BoxedSymbol &&
        def.value === result.valueDefinition))
  )
    return result;

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
  // Boxing declares no name
  // (`binding-unit.ts`): a name with no definition is a free name, a
  // canonical symbol with no definition, whose home scope is the scope that
  // an automatic declaration would go in. This applies to a scope that
  // existed before the boxing started, and to a symbol made outside a
  // boxing. The home scope skips the scope of a binder also
  // when the name is boxed outside the canonicalization of the binder
  // (`freeNameHomeScope()`).
  const homeScope = freeNameHomeScope(autoScope);
  if (engine._boxingState.isPersistentScope(homeScope) !== false)
    return new BoxedSymbol(engine, name, { metadata, homeScope });
  // In a scope that the boxing made (the body of a function literal), a name
  // with no definition is a free name of the scope that the literal is
  // written in.
  return new BoxedSymbol(engine, name, {
    metadata,
    homeScope: bodyFreeNameHomeScope(engine, autoScope) ?? homeScope,
  });
}

/**
 * The home scope of a free name boxed in `autoScope`, a scope that the
 * boxing made (the body of a function literal): the home scope that the
 * name would have if it were boxed in the first persistent scope up the
 * chain, the scope that the literal is written in (rule 1 of
 * `docs/plans/2026-11-09-binding-units-slice-1-spec.md`). The operation in
 * progress adjusts it as it adjusts the home of every free name
 * (`homeScopeOf()`, applied by the `BoxedSymbol` constructor).
 */
function bodyFreeNameHomeScope(
  engine: SymbolHost,
  autoScope: import('./global-types.js').Scope
): import('./global-types.js').Scope | undefined {
  let scope = autoScope.parent;
  while (scope && engine._boxingState.isPersistentScope(scope) === false)
    scope = scope.parent;
  if (!scope) return undefined;
  while (scope.noAutoDeclare && scope.parent) scope = scope.parent;
  return freeNameHomeScope(scope);
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
  return new BoxedSymbol(engine, name, { def: binding, defHome: scope });
}

/**
 * The symbol `name` bound to its definition in the system scope, where the
 * standard library and the libraries of the constructor's `libraries` option
 * are installed, whatever definition the current scope resolves the name to.
 * This is the canonical form of `["Module", name]`. `undefined` when the
 * system scope does not define `name`.
 *
 * The interned symbol of the name (`Pi`, `ExponentialE`, …) is returned when
 * it is bound to that definition, so that engine code that compares such a
 * symbol by identity (`=== ce.Pi`) still recognizes it. A constant whose
 * value replaces it at boxing (`holdUntil: 'never'`) gives that value, as
 * `ce.symbol()` does.
 */
export function createLibrarySymbolExpression(
  engine: ComputeEngine,
  commonSymbols: { [symbol: string]: null | Expression },
  name: MathJsonSymbol
): Expression | undefined {
  const library = engine._evalContextStack[0]?.lexicalScope.bindings.get(name);
  if (library === undefined) return undefined;
  const common = Object.hasOwn(commonSymbols, name)
    ? commonSymbols[name]
    : undefined;
  if (
    common instanceof BoxedSymbol &&
    isValueDef(library) &&
    common.valueDefinition === library.value
  )
    return common;
  if (isValueDef(library) && library.value.holdUntil === 'never')
    return library.value.value ?? engine.Nothing;
  return new BoxedSymbol(engine, name, {
    def: library,
    defHome: engine._evalContextStack[0]?.lexicalScope,
  });
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

  // A rational pair with a zero denominator: a nonzero numerator over zero is
  // a pole, `~oo`, and `0/0` is the indeterminate form. This is the answer
  // `ce.box(["Rational", n, 0])` gives (`boxed-expression/box.ts`).
  // `canonicalNumber()` returns a machine number or a `NumericValue`, which
  // cannot hold `~oo`, so the pair is read here first.
  if (
    isRational(value) &&
    value.length === 2 &&
    (typeof value[0] === 'number' || typeof value[0] === 'bigint') &&
    (typeof value[1] === 'number' || typeof value[1] === 'bigint') &&
    value[1] == 0
  ) {
    const n = value[0];
    if (typeof n === 'number' && Number.isNaN(n)) return engine.NaN;
    return n == 0 ? engine.NaN : engine.ComplexInfinity;
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
      // Only an exact value can be one of the shared exact constants. A float
      // whose value is 0, 1 or -1 (the literal `1.0`, or a numeric result)
      // stays a float, as the literal `2.0` does.
      if (canonicalValue.isExact) {
        if (canonicalValue.isZero) return engine.Zero;
        if (canonicalValue.isOne) return engine.One;
        if (canonicalValue.isNegativeOne) return engine.NegativeOne;
      }
      if (canonicalValue.isNaN) return engine.NaN;
      if (canonicalValue.isNegativeInfinity) return engine.NegativeInfinity;
      if (canonicalValue.isPositiveInfinity) return engine.PositiveInfinity;
    }
  }

  return new BoxedNumber(engine, canonicalValue, { metadata });
}
