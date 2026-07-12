import type {
  MathJsonExpression,
  MathJsonSymbol,
} from '../../math-json/types.js';
import { isValidSymbol, validateSymbol } from '../../math-json/symbols.js';

import type { Type, TypeString } from '../../common/type/types.js';
import { isSignatureType, widen, narrow } from '../../common/type/utils.js';
import { reduceType } from '../../common/type/reduce.js';
import type { OneOf } from '../../common/one-of.js';
import { BoxedType } from '../../common/type/boxed-type.js';
import { parseType } from '../../common/type/parse.js';

import type { BigNum } from '../numerics/types.js';
import { NumericValue } from '../numeric-value/types.js';

import type {
  Expression,
  SimplifyOptions,
  ExplainOperation,
  ExplainOptions,
  Explanation,
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
} from '../global-types.js';

import { mul, div } from './arithmetic-mul-div.js';

import { replace } from './rules.js';
import { simplify } from './simplify.js';
import { explainExpression } from './explain.js';
import { negate } from './negate.js';

import { match } from './match.js';
import { _BoxedExpression } from './abstract-boxed-expression.js';
import {
  hashCode,
  isOperatorDef,
  isValueDef,
  normalizedUnknownsForSolve,
  updateDef,
} from './utils.js';
import { pow } from './arithmetic-power.js';
import { add } from './arithmetic-add.js';
import {
  positiveSign,
  nonPositiveSign,
  negativeSign,
  nonNegativeSign,
} from './sgn.js';
import { matchesSymbol } from '../../math-json/utils.js';
import { getSignFromAssumptions } from '../assume.js';
import { getFactIndex, hasAssumptions } from './constraint-subject.js';
import { isSymbol } from './type-guards.js';
import { checkDeadline } from '../../common/interruptible.js';

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

    // `other` is not a symbol. Follow *this* symbol's value binding and compare
    // it against `other` directly (isSame follows symbol value bindings).
    //
    // Do NOT unwrap `other.value` here: for a function-valued expression (e.g.
    // `g := x^2 + 1`) `other.value` is `undefined`, which used to drop the
    // comparison to `false` even when the binding matched (CM-P1-1). `same()`
    // follows the RHS binding for symmetry, so passing `other` unchanged is
    // correct for numbers, strings and function expressions alike.
    return this.value?.isSame(other) ?? false;
  }

  toNumericValue(): [NumericValue, Expression] {
    // Structural symbols are bound and behave identically here; only raw
    // (unbound) expressions are excluded from arithmetic, matching
    // `BoxedFunction.toNumericValue()` and `Product.mul()`.
    console.assert(this.isCanonical || this.isStructural);
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

    // `x·0 = 0` only when `x` is finite. A symbol with a *known infinite*
    // value (or NaN) gives `∞·0 = NaN`; the fastpath used to short-circuit to
    // Zero. Free symbols (infinity unknown) keep the conventional `·0 → 0`.
    const isZeroRhs = rhs === 0 || (rhs instanceof NumericValue && rhs.isZero);
    if (isZeroRhs) {
      if (this.isNaN || this.isInfinity === true) return this.engine.NaN;
      return this.engine.Zero;
    }
    if (rhs instanceof NumericValue) {
      if (rhs.isOne) return this;
      if (rhs.isNegativeOne) return this.neg();
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

    // A negative root index denotes a reciprocal; normalize to
    // `1/Root(a, n)` rather than the nonstandard `Root(a, -n)` (#13).
    if (e !== undefined && e < 0 && Number.isInteger(e))
      return ce._fn('Divide', [ce.One, this.root(-e)]);

    return ce._fn('Root', [this, ce.expr(n)]);
  }

  sqrt(): Expression {
    const ce = this.engine;
    if (this.symbol === 'ComplexInfinity') return ce.NaN;
    // No value-following folds here (`.isSame(0|1|-1)` on a symbol follows
    // its value binding): a mutable symbol's transient value must not leak
    // into the structure this method builds. A number-valued symbol reduces
    // via BoxedNumber.sqrt() when it is evaluated.

    return ce._fn('Sqrt', [this]);
  }

  ln(semiBase?: number | Expression): Expression {
    const base = semiBase ? this.engine.expr(semiBase) : undefined;

    // No value-following folds (see sqrt() above): `Ln(x)` while `x` happens
    // to hold `1` must remain `Ln(x)`; BoxedNumber.ln() does the exact
    // reductions once the symbol's value flows in at evaluation.

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
      // The type of a constant cannot be changed, so it is never inferred,
      // even if it is unknown (e.g. `ContinuationPlaceholder`)
      if (def.value.isConstant) return false;

      if (def.value.inferredType || def.value.type.isUnknown) {
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
      // An incompatible constraint (e.g. a symbol bound to an operator
      // definition used where a number is expected) narrows to `never`.
      // Since `never` matches any type, it would be written into the
      // shared definition below, corrupting it engine-wide. Leave the
      // definition unchanged instead.
      if (newType.matches('never')) return false;
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
            Expression,
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
        value = ce.number(ce.complex(value.re ?? 0, value.im));
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
  //
  // Mixed binding semantics (SYMBOLIC P2-13, documented): type-backed
  // predicates (`type`, `isInteger`, …) read the definition captured in
  // `_def` at construction/binding time, while sign predicates resolve
  // *dynamically* by symbol name against the live assumptions. In the
  // common path both agree — `assume()` mutates the bound definition in
  // place — but a held instance whose symbol is re-declared in a new scope
  // keeps its construction-time type while its sign tracks the current
  // scope's assumptions.
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
    const fromValue = this.value?.isFinite;
    if (fromValue !== undefined) return fromValue;
    // Type fallback (docs/fungrim/FUNGRIM-PLAN-3-ASSUMPTIONS.md §5.1e): a
    // `finite_number` refinement — e.g. from `assume(|q| < 1)` — entails
    // finiteness even without a value.
    const t = this.type;
    if (!t.isUnknown && t.matches('finite_number')) return true;
    return undefined;
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
    // Three-valued discipline (D3), mirroring the repaired `isReal`:
    //   entailed (`matches`) → true; overlap → undefined; disjoint → false.
    if (t.matches('integer')) return true;
    // A real-overlapping numeric type (`real`, `rational`, `finite_real`,
    // `finite_rational`, …) could be an integer → indeterminate. `real` is
    // checked before `complex` because `finite_real ⊑ complex` in this lattice.
    if (t.matches('real')) return undefined;
    // `number`/`finite_number` overlap the reals unless they are genuinely
    // complex (`complex`/`imaginary`/`finite_complex`, which are non-integer
    // by the same convention `isReal` uses).
    if (t.matches('number')) return t.matches('complex') ? false : undefined;
    // Non-numeric / composite types (e.g. `!string`): definitely-not only when
    // provably disjoint from the integers.
    if (
      reduceType({ kind: 'intersection', types: [t.type, 'integer'] }) ===
      'nothing'
    )
      return false;
    return undefined;
  }

  get isRational(): boolean | undefined {
    const t = this.type;
    if (t.isUnknown) return undefined;
    if (t.matches('rational')) return true;
    if (t.matches('real')) return undefined;
    if (t.matches('number')) return t.matches('complex') ? false : undefined;
    if (
      reduceType({ kind: 'intersection', types: [t.type, 'rational'] }) ===
      'nothing'
    )
      return false;
    return undefined;
  }

  get isReal(): boolean | undefined {
    const t = this.type;
    if (t.isUnknown) return undefined;
    if (t.matches('real')) return true;

    // The type cannot prove real-ness. A stored `NotElement(x, RealNumbers)`
    // fact — e.g. derived from `assume(Im(x) > 0)` — refutes it
    // (docs/fungrim/FUNGRIM-PLAN-3-ASSUMPTIONS.md §5.1e): types cannot express negation.
    if (hasAssumptions(this.engine)) {
      const facts = getFactIndex(this.engine).membership.get(this._id);
      if (facts?.notIn.some((s) => isSymbol(s, 'RealNumbers'))) return false;
    }

    // `complex`/`imaginary`-typed symbols keep the historical definitive
    // `false`. Other number types (`number`, `finite_number`, ...) overlap
    // `real`, so without a refuting fact the answer is indeterminate
    // (three-valued discipline, design §5.2).
    if (t.matches('number') && !t.matches('complex')) return undefined;
    return false;
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

  explain(operation?: ExplainOperation, options?: ExplainOptions): Explanation {
    return explainExpression(this, operation, options);
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
    // Note: `holdUntil: 'never'` means "substitute as early as possible" —
    // it never *prevents* numeric evaluation. (A previous version returned
    // `this` for 'never', which made `ImaginaryUnit.N()` a no-op and left
    // products like `0.25 * i` unfolded under N().)
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

  // For a non-collection symbol these return `undefined` (the abstract-class
  // contract), not 0 / true — a plain symbol is not an empty collection.
  get count(): number | undefined {
    return this._asCollection?.count(this._value ?? this) ?? this._value?.count;
  }

  get isEmptyCollection(): boolean | undefined {
    return (
      this._asCollection?.isEmpty?.(this._value ?? this) ??
      this._value?.isEmptyCollection
    );
  }

  get isFiniteCollection(): boolean | undefined {
    return (
      this._asCollection?.isFinite?.(this._value ?? this) ??
      this._value?.isFiniteCollection
    );
  }

  each(): Generator<Expression> {
    const iter = this._asCollection?.iterator?.(this._value ?? this);
    if (iter) {
      const engine = this.engine;
      return (function* () {
        let result = iter.next();
        let i = 0;
        while (!result.done) {
          // Enumeration can be unbounded: respect the evaluation deadline.
          if ((++i & 0xff) === 0) checkDeadline(engine._deadline);
          yield result.value;
          result = iter.next();
        }
      })();
    }
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
