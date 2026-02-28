import type { MathJsonExpression, MathJsonSymbol } from '../../math-json/types';
import { isValidSymbol, validateSymbol } from '../../math-json/symbols';

import type { Type, TypeString } from '../../common/type/types';
import { isSignatureType, widen, narrow } from '../../common/type/utils';
import type { OneOf } from '../../common/one-of';
import { BoxedType } from '../../common/type/boxed-type';
import { parseType } from '../../common/type/parse';

import type { BigNum } from '../numerics/types';
import { NumericValue } from '../numeric-value/types';

import type {
  Expression,
  SimplifyOptions,
  PatternMatchOptions,
  ReplaceOptions,
  BoxedValueDefinition,
  BoxedOperatorDefinition,
  IComputeEngine as ComputeEngine,
  Metadata,
  CanonicalOptions,
  BoxedBaseDefinition,
  BoxedSubstitution,
  EvaluateOptions,
  Rule,
  BoxedRule,
  BoxedRuleSet,
  Substitution,
  Sign,
  BoxedDefinition,
  CollectionHandlers,
  ExpressionInput,
  SymbolInterface,
} from '../global-types';

import { mul, div } from './arithmetic-mul-div';

import { replace } from './rules';
import { simplify } from './simplify';
import { negate } from './negate';

import { match } from './match';
import { _BoxedExpression } from './abstract-boxed-expression';
import {
  hashCode,
  isOperatorDef,
  isValueDef,
  normalizedUnknownsForSolve,
  updateDef,
} from './utils';
import { pow } from './arithmetic-power';
import { add } from './arithmetic-add';
import {
  positiveSign,
  nonPositiveSign,
  negativeSign,
  nonNegativeSign,
} from './sgn';
import { matchesSymbol } from '../../math-json/utils';
import { getSignFromAssumptions } from '../assume';
import { isSymbol } from './type-guards';

/**
 * ### BoxedSymbol
 *
 * A boxed symbol is a reference to a `BoxedDefinition`.
 *
 * A `BoxedDefinition` "owns" all the information about a symbol, its
 * type and various attributes (is it a constant?, etc...).
 *
 * Boxed symbols are bound to a definition during construction if they
 * are canonical.
 *
 * If a symbol is not canonical (and thus not bound to a definition),
 * some properties and methods will return `undefined`, for example
 * `isInteger`, `isRational`, `isReal`, etc...
 *
 * There is a single value definition for each symbol in each scope.
 * During recursion, fresh scopes are created per call so each
 * invocation has its own bindings (see `makeLambda` in function-utils.ts).
 *
 * The value of a symbol is stored in its `BoxedValueDefinition` — there
 * is no separate evaluation-context values map.
 *
 * The `value` property of a boxed symbol is the value found by walking
 * the scope chain from the current lexical scope. It is `undefined` if
 * the symbol is not bound to a definition or if the value is not known.
 *
 */
export class BoxedSymbol extends _BoxedExpression implements SymbolInterface {
  override readonly _kind = 'symbol';

  private _hash: number | undefined;

  /** The name of the symbol */
  protected _id: MathJsonSymbol;

  /**
   * The definition of the symbol, if the symbol is bound/canonical.
   */
  private readonly _def: BoxedDefinition | undefined;

  /** Note: to indicate that the symbol should be canonical, pass a def. */
  constructor(
    ce: ComputeEngine,
    name: MathJsonSymbol,
    options?: {
      metadata?: Metadata;
      def?: BoxedDefinition;
    }
  ) {
    super(ce, options?.metadata);

    console.assert(
      isValidSymbol(name),
      `Invalid symbol "${name}": ${validateSymbol(name)}`
    );
    this._id = name;
    this._def = options?.def;
  }

  get json(): MathJsonExpression {
    return matchesSymbol(this._id) ? this._id : { sym: this._id };
  }

  get hash(): number {
    this._hash ??= hashCode(this._id);
    return this._hash;
  }

  get isPure(): boolean {
    return true;
  }

  get isConstant(): boolean {
    const def = this._def;
    return (isValueDef(def) && def?.value.isConstant) ?? false;
  }

  bind(): void {}

  reset(): void {}

  get isCanonical(): boolean {
    return this._def !== undefined;
  }
  set isCanonical(val: boolean) {
    throw new Error(
      'Setting the isCanonical property is not allowed. Use the canonical() method instead.'
    );
  }

  get canonical(): Expression {
    // The symbol is canonical if it has a definition
    if (this._def) return this;

    // Return a new canonical symbol, scoped in the current context
    return this.engine.symbol(this._id);
  }

  is(
    other: Expression | number | bigint | boolean | string,
    tolerance?: number
  ): boolean {
    // Structural check (includes value following via isSame)
    if (tolerance === undefined && this.isSame(other)) return true;

    // If value following didn't match but we have a bound value,
    // try the smart check on the value (which may be a function expression)
    const val = this.value;
    if (val && val !== (this as unknown)) return val.is(other, tolerance);

    return false;
  }

  isSame(other: Expression | number | bigint | boolean | string): boolean {
    if (other === true)
      return this.symbol === 'True' || isSymbol(this.value, 'True');
    if (other === false)
      return this.symbol === 'False' || isSymbol(this.value, 'False');

    if (other instanceof _BoxedExpression && isSymbol(other))
      return this.symbol === other.symbol;

    const rhs = other instanceof _BoxedExpression ? other.value : other;
    if (
      typeof rhs === 'string' ||
      typeof rhs === 'number' ||
      typeof rhs === 'bigint' ||
      typeof rhs === 'boolean' ||
      rhs instanceof _BoxedExpression
    ) {
      return this.value?.isSame(rhs) ?? false;
    }

    return false;
  }

  toNumericValue(): [NumericValue, Expression] {
    console.assert(this.isCanonical);
    const ce = this.engine;

    if (this.symbol === 'ImaginaryUnit')
      return [ce._numericValue({ re: 0, im: 1 }), ce.One];
    if (
      this.symbol === 'PositiveInfinity' ||
      (this.isInfinity && this.isPositive)
    )
      return [ce._numericValue(Infinity), ce.One];
    if (
      this.symbol === 'NegativeInfinity' ||
      (this.isInfinity && this.isNegative)
    )
      return [ce._numericValue(-Infinity), ce.One];
    if (this.symbol === 'NaN') return [ce._numericValue(NaN), ce.One];

    return [ce._numericValue(1), this];
  }

  neg(): Expression {
    return negate(this);
  }

  inv(): Expression {
    return this.engine._fn('Divide', [this.engine.One, this]);
  }

  abs(): Expression {
    if (this.isNonNegative) return this;
    if (this.isNonPositive) return this.neg();
    return this.engine._fn('Abs', [this]);
  }

  add(rhs: number | Expression): Expression {
    if (rhs === 0) return this;
    return add(this, this.engine.expr(rhs));
  }

  mul(rhs: NumericValue | number | Expression): Expression {
    if (rhs === 1) return this;
    if (rhs === -1) return this.neg();
    if (rhs === 0 && !this.isNaN) return this.engine.Zero;
    if (rhs instanceof NumericValue) {
      if (rhs.isOne) return this;
      if (rhs.isNegativeOne) return this.neg();
      if (rhs.isZero && !this.isNaN) return this.engine.Zero;
    }
    return mul(this, this.engine.expr(rhs));
  }

  div(rhs: number | Expression): Expression {
    return div(this, rhs);
  }

  pow(exp: number | Expression): Expression {
    return pow(this, exp, { numericApproximation: false });
  }

  root(n: number | Expression): Expression {
    const e = typeof n === 'number' ? n : n.im === 0 ? n.re : undefined;

    const ce = this.engine;
    if (this.symbol === 'ComplexInfinity') return ce.NaN;
    if (e === 0) return ce.NaN;
    if (e === 1) return this;
    if (e === 2) return this.sqrt();
    if (e === -1) return this.inv();

    return ce._fn('Root', [this, ce.expr(n)]);
  }

  sqrt(): Expression {
    const ce = this.engine;
    if (this.symbol === 'ComplexInfinity') return ce.NaN;
    if (this.isSame(0)) return this;
    if (this.isSame(1)) return this.engine.One;
    if (this.isSame(-1)) return ce.I;

    return ce._fn('Sqrt', [this]);
  }

  ln(semiBase?: number | Expression): Expression {
    const base = semiBase ? this.engine.expr(semiBase) : undefined;

    // Mathematica returns `Log[0]` as `-∞`
    if (this.isSame(0)) return this.engine.NegativeInfinity;

    // ln(e) = 1 (natural log)
    // ln_c(e) = 1/ln(c) (for other bases)
    if (this.symbol === 'ExponentialE') {
      if (!base || isSymbol(base, 'ExponentialE')) return this.engine.One;
      return this.engine.One.div(base.ln()); // log_c(e) = 1/ln(c)
    }

    if (base) {
      if (base.re === 10) return this.engine._fn('Log', [this]);
      return this.engine._fn('Log', [this, base]);
    }

    return this.engine._fn('Ln', [this]);
  }

  solve(
    vars?: Iterable<string> | string | Expression | Iterable<Expression>
  ): null | ReadonlyArray<Expression> {
    const varNames = normalizedUnknownsForSolve(vars);
    if (varNames.length !== 1) return null;
    if (varNames.includes(this.symbol)) return [this.engine.Zero];
    return null;
  }

  get complexity(): number {
    return 7;
  }

  get operator(): MathJsonSymbol {
    return 'Symbol';
  }

  get symbol(): MathJsonSymbol {
    return this._id;
  }

  //  A base definition is the base class of both value and operator definition
  get baseDefinition(): BoxedBaseDefinition | undefined {
    return this.valueDefinition ?? this.operatorDefinition;
  }

  get valueDefinition(): BoxedValueDefinition | undefined {
    if (isValueDef(this._def)) return this._def.value;
    return undefined;
  }

  get operatorDefinition(): BoxedOperatorDefinition | undefined {
    if (isOperatorDef(this._def)) return this._def.operator;
    return undefined;
  }

  /**
   *
   * Assuming the symbol is used as an argument, subsequent inferences will
   * narrow the domain of the symbol:
   *
   * ```
   * f: real -> number, g: integer -> number
   * f(x) => x: inferred to real
   * g(x) => x: narrowed to integer
   * ```
   *
   * If the symbol is used as a return value, its domain should be widened:
   *
   * ```
   * f: number -> integer, g: number -> real
   * x = f(2) => x: inferred to integer
   * x = g(2) => x: widened to real
   * ```
   *
   * Arguments accumulate constraints and narrow.
   * Return values accumulate possibilities and widen.
   *
   * @inheritdoc
   */
  infer(t: Type, inferenceMode: 'narrow' | 'widen' = 'narrow'): boolean {
    if (!this._def) return false;

    const def = this._def;
    if (isValueDef(def)) {
      if (def.value.inferredType || def.value.type.isUnknown) {
        // Constants should never be inferred
        console.assert(!def.value.isConstant);

        def.value.type = this.engine.type(
          inferenceMode === 'widen'
            ? widen(def.value.type.type, t)
            : narrow(def.value.type.type, t)
        );
        return true;
      }
      return false;
    }

    if (isOperatorDef(def)) {
      const newType = this.engine.type(
        inferenceMode === 'widen'
          ? widen(def.operator.signature.type, t)
          : narrow(def.operator.signature.type, t)
      );
      if (newType.matches('function')) {
        // The function signature was modified
        def.operator.signature = newType;
        return true;
      }
      // The type is no longer a function, use a value definition
      updateDef(this.engine, this._id, def, { type: newType.type });
      return true;
    }

    // The type was not modified
    return false;
  }

  /** Return the value of the symbol, undefined if an operator or not bound */
  get _value(): Expression | undefined {
    if (!this._def || isOperatorDef(this._def)) return undefined;

    // If the symbol is a constant, the definition has the value
    if (this._def.value.isConstant) return this._def.value.value;

    // Lookup the value by walking the scope chain
    const result = this.engine._getSymbolValue(this._id);

    // Guard: if the value is the symbol itself (degenerate self-assignment),
    // return undefined to avoid infinite loops.
    if (
      result !== undefined &&
      'symbol' in result &&
      result.symbol === this._id
    )
      return undefined;

    return result;
  }

  get value(): Expression | undefined {
    // If the definition is an operator definition, return a special value
    // @todo:  not clear this is something useful... Could return a hash of the operator, and keep a map of hash to their definitions...
    if (isOperatorDef(this._def))
      return this.engine._fn('Operator', [this.engine.string(this._id)]);

    return this._value;
  }

  set value(
    value:
      | boolean
      | string
      | BigNum
      | number[]
      | OneOf<
          [
            { re: number; im: number },
            { num: number; denom: number },
            Expression
          ]
        >
      | number
      | undefined
  ) {
    if (!this._def)
      throw new Error(`Cannot set value of non-canonical ${this._id}`);

    const ce = this.engine;

    //
    // Clear assumptions about this symbol
    //
    ce.forget(this._id);

    //
    // Determine the new value
    //
    let v: Expression | undefined;
    if (typeof value === 'boolean') value = value ? ce.True : ce.False;
    if (typeof value === 'string') value = ce.string(value);
    if (typeof value === 'object') {
      if ('re' in value && 'im' in value)
        value = ce.complex(value.re ?? 0, value.im);
      else if ('num' in value && 'denom' in value)
        value = ce.number([value.num!, value.denom!]);
      else if (Array.isArray(value))
        value = ce._fn(
          'List',
          value.map((x) => ce.expr(x))
        );
      else throw new Error(`Invalid value for symbol ${this._id}: ${value}`);
    }

    if (value !== undefined) {
      const boxedValue = ce.expr(value as Expression);
      v = boxedValue.evaluate();
    }

    //
    // Assign the value to the corresponding definition
    //
    if (v?.type.matches('function')) {
      // New operator definitions always completely replace an existing one
      // @ts-expect-error - value may not exist on all def types
      delete this._def.value;
      // @ts-expect-error - adding operator to def that may not have it
      this._def.operator = {
        signature: v.type,
        evaluate: v, // Evaluate as a lambda
      };
      return;
    }

    if (isValueDef(this._def) && this._def.value.isConstant)
      throw new Error(
        `The value of the constant "${this._id}" cannot be changed`
      );

    ce._setSymbolValue(this._id, v);
  }

  /**
   * The type of the symbol.
   *
   * Note that the type of the value of the symbol may be more specific.'
   * For example, a symbol could have a type of 'number' but the value
   * could be 'integer'.
   *
   * If the symbol is not canonical (not bound to a definition), the type is
   * 'unknown'
   */
  get type(): BoxedType {
    const def = this._def;
    if (isValueDef(def)) return def.value.type;
    if (isOperatorDef(def)) return def.operator.signature;
    return BoxedType.unknown;
  }

  set type(t: Type | TypeString | BoxedType) {
    if (!this._def)
      throw new Error(`Cannot set type of non-canonical symbol "${this._id}"`);

    if (this._id[0] === '_')
      throw new Error(
        `The type of the wildcard "${this._id}" cannot be changed`
      );

    // Clear assumptions about this symbol
    this.engine.forget(this._id);

    if (typeof t === 'string') t = parseType(t);
    else if (t instanceof BoxedType) t = t.type;

    if (t === 'function' || isSignatureType(t)) {
      if (isOperatorDef(this._def)) {
        // We are changing the signature of a function
        // @ts-expect-error - signature is readonly but we need to update it
        this._def.operator.signature = t;
      } else {
        // We are changing a symbol to a function
        updateDef(this.engine, this._id, this._def, { signature: t });
      }
    } else {
      if (isOperatorDef(this._def)) {
        // We are changing a function to a symbol
        updateDef(this.engine, this._id, this._def, { type: t });
      } else {
        // We are changing the type of a symbol
        this._def.value.type = this.engine.type(t);
      }
    }
  }

  has(x: MathJsonSymbol | MathJsonSymbol[]): boolean {
    if (typeof x === 'string') return this._id === x;
    return x.includes(this._id);
  }

  match(
    pattern: string | ExpressionInput,
    options?: PatternMatchOptions
  ): BoxedSubstitution | null {
    return match(this, pattern, options);
  }

  /** The shape of the tensor (dimensions), derived from the type */
  get shape(): number[] {
    const t = this.type.type;
    if (typeof t === 'object' && t.kind === 'list' && t.dimensions)
      return t.dimensions;
    return [];
  }

  /** The rank of the tensor (number of dimensions), derived from the type */
  get rank(): number {
    return this.shape.length;
  }

  // The sign of the value of the symbol
  get sgn(): Sign | undefined {
    // First check if there's an assigned value
    if (this.value) return this.value.sgn;

    // Otherwise, check if there are assumptions about this symbol's sign
    return getSignFromAssumptions(this.engine, this.symbol);
  }

  get isOdd(): boolean | undefined {
    return this.value?.isOdd;
  }

  get isEven(): boolean | undefined {
    return this.value?.isEven;
  }

  get isFinite(): boolean | undefined {
    return this.value?.isFinite;
  }

  get isInfinity(): boolean | undefined {
    return this.value?.isInfinity;
  }

  get isNaN(): boolean | undefined {
    return this.value?.isNaN;
  }

  // x > 0
  get isPositive(): boolean | undefined {
    return positiveSign(this.sgn);
  }

  get isNonPositive(): boolean | undefined {
    return nonPositiveSign(this.sgn);
  }

  get isNegative(): boolean | undefined {
    return negativeSign(this.sgn);
  }

  get isNonNegative(): boolean | undefined {
    return nonNegativeSign(this.sgn);
  }

  get isFunction(): boolean | undefined {
    const t = this.type;
    if (t.isUnknown) return undefined;
    return this.type.matches('function');
  }

  get isNumber(): boolean | undefined {
    const t = this.type;
    if (t.isUnknown) return undefined;
    return t.matches('number');
  }

  get isInteger(): boolean | undefined {
    const t = this.type;
    if (t.isUnknown) return undefined;
    return t.matches('integer');
  }

  get isRational(): boolean | undefined {
    const t = this.type;
    if (t.isUnknown) return undefined;
    return t.matches('rational');
  }

  get isReal(): boolean | undefined {
    const t = this.type;
    if (t.isUnknown) return undefined;
    return t.matches('real');
  }

  get re(): number {
    return this.value?.re ?? NaN;
  }

  get im(): number {
    return this.value?.im ?? NaN;
  }

  get bignumRe(): BigNum | undefined {
    return this.value?.bignumRe;
  }

  get bignumIm(): BigNum | undefined {
    return this.value?.bignumIm;
  }

  simplify(options?: Partial<SimplifyOptions>): Expression {
    return simplify(this, options).at(-1)?.value ?? this;
  }

  evaluate(options?: Partial<EvaluateOptions>): Expression {
    const def = this.valueDefinition;
    if (!def) return this;
    const hold = def.holdUntil;

    if (def.isConstant) {
      if (options?.numericApproximation) {
        if (hold === 'never' || hold === 'evaluate' || hold === 'N')
          return def.value?.N() ?? this;
      } else if (hold === 'never' || hold === 'evaluate')
        return def.value?.evaluate(options) ?? this;
    } else {
      if (
        hold === 'never' ||
        hold === 'evaluate' ||
        (hold === 'N' && options?.numericApproximation)
      ) {
        let expr = this.engine._getSymbolValue(this._id) ?? this;
        if (expr.operator === 'Unevaluated')
          expr = expr.evaluate(options) ?? this;
        return expr;
      }
    }
    return this;
  }

  N(): Expression {
    const def = this.valueDefinition;
    if (def && def.holdUntil === 'never') return this;
    // For non-constants, check the scope-chain value first
    if (def && !def.isConstant) {
      const contextValue = this.engine._getSymbolValue(this._id);
      if (contextValue) return contextValue.N();
    }
    return def?.value?.N() ?? this;
  }

  replace(
    rules: Rule | (Rule | BoxedRule)[] | BoxedRuleSet,
    options?: Partial<ReplaceOptions>
  ): Expression | null {
    return replace(this, rules, options).at(-1)?.value ?? null;
  }

  subs(
    sub: Substitution,
    options?: { canonical?: CanonicalOptions }
  ): Expression {
    const canonical = options?.canonical ?? this.isCanonical;
    if (sub[this._id] === undefined) return canonical ? this.canonical : this;

    const form =
      canonical === true
        ? 'canonical'
        : canonical === false
        ? 'raw'
        : canonical;
    return this.engine.expr(sub[this._id], { form });
  }

  get _asCollection(): CollectionHandlers | undefined {
    if (isValueDef(this._def)) return this._def.value.collection;
    return undefined;
  }

  get isCollection(): boolean {
    return (
      this._asCollection?.iterator !== undefined ||
      (this._value?.isCollection ?? false)
    );
  }

  get isIndexedCollection(): boolean {
    return (
      this._asCollection?.at !== undefined ||
      (this._value?.isIndexedCollection ?? false)
    );
  }

  get isLazyCollection(): boolean {
    return (
      this._asCollection?.isLazy?.(this._value ?? this) ??
      this._value?.isLazyCollection ??
      false
    );
  }

  contains(rhs: Expression): boolean | undefined {
    return (
      this._asCollection?.contains?.(this._value ?? this, rhs) ??
      this._value?.contains?.(rhs)
    );
  }

  get count(): number {
    return (
      this._asCollection?.count(this._value ?? this) ?? this._value?.count ?? 0
    );
  }

  get isEmptyCollection(): boolean {
    return (
      this._asCollection?.isEmpty?.(this._value ?? this) ??
      this._value?.isEmptyCollection ??
      this.count === 0
    );
  }

  get isFiniteCollection(): boolean | undefined {
    return (
      this._asCollection?.isFinite?.(this._value ?? this) ??
      this._value?.isFiniteCollection ??
      isFinite(this.count)
    );
  }

  each(): Generator<Expression> {
    const iter = this._asCollection?.iterator?.(this._value ?? this);
    if (iter)
      return (function* () {
        let result = iter.next();
        while (!result.done) {
          yield result.value;
          result = iter.next();
        }
      })();
    return this._value?.each() ?? (function* () {})();
  }

  at(index: number): Expression | undefined {
    return (
      this._asCollection?.at?.(this._value ?? this, index) ??
      this._value?.at?.(index)
    );
  }

  get(index: Expression | string): Expression | undefined {
    return this._value?.get?.(index);
  }

  indexWhere(predicate: (element: Expression) => boolean): number | undefined {
    if (this._asCollection?.indexWhere)
      return this._asCollection.indexWhere(this._value ?? this, predicate);
    return this._value?.indexWhere(predicate);
  }

  subsetOf(rhs: Expression, strict: boolean): boolean {
    return (
      this._asCollection?.subsetOf?.(this._value ?? this, rhs, strict) ??
      this._value?.subsetOf?.(rhs, strict) ??
      false
    );
  }
}
