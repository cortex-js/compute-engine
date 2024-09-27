import { Decimal } from 'decimal.js';
import type { Expression } from '../../math-json/types.ts';
import {
  isValidIdentifier,
  validateIdentifier,
} from '../../math-json/identifiers.ts';

import type { Type, TypeString } from '../../common/type/types.ts';

import type {
  BoxedExpression,
  BoxedRuleSet,
  BoxedSymbolDefinition,
  IComputeEngine,
  EvaluateOptions,
  ReplaceOptions,
  SimplifyOptions,
  Substitution,
  Metadata,
  PatternMatchOptions,
  RuntimeScope,
  BoxedFunctionDefinition,
  BoxedBaseDefinition,
  BoxedSubstitution,
  Rule,
  CanonicalOptions,
  BoxedRule,
  Sign,
} from './public.ts';

import { mul } from './arithmetic-multiply.ts';

import { replace } from './rules.ts';
import { simplify } from './simplify.ts';
import { negate } from './negate.ts';

import { NumericValue } from '../numeric-value/public.ts';

import { match } from './match.ts';
import { _BoxedSymbolDefinition } from './boxed-symbol-definition.ts';
import { _BoxedFunctionDefinition } from './boxed-function-definition.ts';
import { _BoxedExpression } from './abstract-boxed-expression.ts';
import { hashCode, normalizedUnknownsForSolve } from './utils.ts';
import { div } from './arithmetic-divide.ts';
import { pow } from './arithmetic-power.ts';
import { add } from './arithmetic-add.ts';
import { parseType } from '../../common/type/parse.ts';
import { isSubtype } from '../../common/type/subtype.ts';
import { isSignatureType, narrow } from '../../common/type/utils.ts';
import {
  positiveSign,
  nonPositiveSign,
  negativeSign,
  nonNegativeSign,
} from './sgn.ts';
import { BigNum } from '../numerics/bignum.ts';
import type { OneOf } from '../../common/one-of.ts';

/**
 * BoxedSymbol
 *
 * A boxed symbol is a reference to a `BoxedSymbolDefinition` or a
 * `BoxedFunctionDefinition`.
 *
 * If a `BoxedSymbolDefinition`, it "owns" all the information
 * about the symbol, its value, domain and various attributes.
 *
 * If a `BoxedFunctionDefinition`, it it a reference to a function name,
 * not a function expression, i.e. `Sin`, not `["Sin", "Pi"]`. This is used
 * for example in `["InverseFunction", "Sin"]`
 *
 * @noInheritDoc
 *
 */
export class BoxedSymbol extends _BoxedExpression {
  private _scope: RuntimeScope | null;
  protected _id: string;
  private _hash: number | undefined;

  // Note: a `BoxedSymbol` is bound lazily to a definition. This is important
  // during the creation of a scope to avoid circular references.
  //
  // This can also happen if a symbol is used before being defined
  // and the engine has no default domain specified. If there
  // is a default domain, a definition is created automatically.

  // `undefined` indicate the symbol has not been bound yet,
  // `null` indicate that the symbol is not canonical and it should not be
  // bound.

  private _def:
    | OneOf<[BoxedSymbolDefinition, BoxedFunctionDefinition]>
    | null
    | undefined;

  private _isStructural: boolean = false;

  constructor(
    ce: IComputeEngine,
    name: string,
    options?: {
      metadata?: Metadata;
      canonical?: CanonicalOptions;
      structural?: boolean;
      def?: OneOf<[BoxedSymbolDefinition, BoxedFunctionDefinition]>;
    }
  ) {
    super(ce, options?.metadata);

    console.assert(
      isValidIdentifier(name),
      `Invalid symbol "${name}": ${validateIdentifier(name)}`
    );
    this._id = name;
    this._def = options?.def ?? undefined; // Mark the def as not cached if not provided

    if (options?.structural) this._isStructural = true;

    if ((options?.canonical ?? true) !== true) this._scope = null;
    else if (this._def) this._scope = ce.context;
    else this.bind();
  }

  get json(): Expression {
    return this._id;
  }

  get hash(): number {
    if (this._hash === undefined) this._hash = hashCode(this._id);
    return this._hash;
  }

  get isPure(): boolean {
    return true;
  }

  get isStructural(): boolean {
    return this._isStructural;
  }

  get structural(): BoxedExpression {
    if (this.isStructural) return this;
    return new BoxedSymbol(this.engine, this._id, {
      structural: true,
      def: this._def ?? undefined,
    });
  }

  get scope(): RuntimeScope | null {
    return this._scope;
  }

  get isConstant(): boolean {
    // Don't use `.symbolDefinition` as this has a side effect of creating
    // a def, which is not desirable whn we're just doing a test.
    const def = this._def ?? this.engine.lookupSymbol(this._id, this.wikidata);

    return !(def instanceof _BoxedSymbolDefinition) || def.constant;
  }

  private _lookupDef():
    | OneOf<[BoxedSymbolDefinition, BoxedFunctionDefinition]>
    | undefined {
    //  Prefer a symbol definition over a function definition
    // (since symbols can be redefined)
    const ce = this.engine;
    return ce.lookupSymbol(this._id) ?? ce.lookupFunction(this._id);
  }

  /** This method returns the definition associated with the value of this symbol, or associated with the symbol if it has no value. This is the definition to use with most operations on the symbol. Indeed, "x[2]" is accessing the second element of **the value** of "x".*/
  private _getDef(): BoxedBaseDefinition | undefined {
    let def: BoxedBaseDefinition | BoxedSymbolDefinition | undefined =
      this.symbolDefinition;
    if (!def) return undefined;

    // If there is a def, check if the value associated with
    // the def is an expression that has a def.
    // For example, it could be `x = List(1, 2, 3)`
    const val = 'value' in def ? def.value : undefined;
    if (val && val !== this) def = val.baseDefinition ?? def;

    return def;
  }

  /**
   * Associate a definition with this symbol
   */
  bind(): void {
    this._scope = this.engine.context;

    //
    // 1. Get a definition for this
    //
    const def = this._lookupDef();

    if (def) {
      this._def = def;
      return;
    }

    //
    // 2. Auto-binding
    //

    // No definition, create one
    this._def = this.engine.defineSymbol(this._id, {
      type: 'unknown',
      inferred: true,
    });
    this._id = this._def.name;
  }

  reset(): void {
    this._def?.reset();
    this._def = undefined;
  }

  get isCanonical(): boolean {
    return this._scope !== null;
  }
  set isCanonical(val: boolean) {
    this._scope = val ? this.engine.context : null;
    this._def = undefined;
  }

  is(rhs: any): boolean {
    if (typeof rhs === 'number')
      return this.symbolDefinition?.value?.is(rhs) ?? false;

    return false;
  }

  get canonical(): BoxedExpression {
    // If a scope has been provided, this symbol is canonical
    if (this._scope) return this;
    // Return a new canonical symbol, scoped in the current context
    return this.engine.box(this._id);
  }

  toNumericValue(): [NumericValue, BoxedExpression] {
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

  neg(): BoxedExpression {
    return negate(this);
  }

  inv(): BoxedExpression {
    return this.engine._fn('Divide', [this.engine.One, this]);
  }

  abs(): BoxedExpression {
    if (this.isNonNegative) return this;
    if (this.isNonPositive) return this.neg();
    return this.engine._fn('Abs', [this]);
  }

  add(rhs: number | BoxedExpression): BoxedExpression {
    if (rhs === 0) return this;
    return add(this.canonical, this.engine.box(rhs));
  }

  mul(rhs: NumericValue | number | BoxedExpression): BoxedExpression {
    if (rhs === 1) return this;
    if (rhs === -1) return this.neg();
    if (rhs === 0) return this.engine.Zero;
    if (rhs instanceof NumericValue) {
      if (rhs.isOne) return this;
      if (rhs.isNegativeOne) return this.neg();
      if (rhs.isZero) return this.engine.Zero;
    }
    return mul(this.canonical, this.engine.box(rhs));
  }

  div(rhs: number | BoxedExpression): BoxedExpression {
    return div(this, rhs);
  }

  pow(exp: number | BoxedExpression): BoxedExpression {
    return pow(this, exp, { numericApproximation: false });
  }

  root(n: number | BoxedExpression): BoxedExpression {
    if (!this.isCanonical) return this.canonical.root(n);

    if (typeof n !== 'number') n = n.canonical;

    const e = typeof n === 'number' ? n : n.im === 0 ? n.re : undefined;

    const ce = this.engine;
    if (this.symbol === 'ComplexInfinity') return ce.NaN;
    if (e === 0) return ce.NaN;
    if (e === 1) return this;
    if (e === 2) return this.sqrt();
    if (e === -1) return this.inv();

    return ce._fn('Root', [this, ce.box(n)]);
  }

  sqrt(): BoxedExpression {
    const ce = this.engine;
    if (this.symbol === 'ComplexInfinity') return ce.NaN;
    if (this.is(0)) return this;
    if (this.is(1)) return this.engine.One;
    if (this.is(-1)) return ce.I;

    return ce._fn('Sqrt', [this]);
  }

  ln(semiBase?: number | BoxedExpression): BoxedExpression {
    const base = semiBase ? this.engine.box(semiBase) : undefined;
    if (!this.isCanonical) return this.canonical.ln(base);

    // Mathematica returns `Log[0]` as `-∞`
    if (this.is(0)) return this.engine.NegativeInfinity;

    if (
      (!base || base.symbol === 'ExponentialE') &&
      this.symbol === 'ExponentialE'
    )
      return this.engine.One;

    if (base) {
      if (base.re === 10) return this.engine._fn('Log', [this]);
      return this.engine._fn('Log', [this, base]);
    }

    return this.engine._fn('Ln', [this]);
  }

  solve(
    vars:
      | Iterable<string>
      | string
      | BoxedExpression
      | Iterable<BoxedExpression>
  ): null | ReadonlyArray<BoxedExpression> {
    const varNames = normalizedUnknownsForSolve(vars);
    if (varNames.length !== 1) return null;
    if (varNames.includes(this.symbol)) return [this.engine.Zero];
    return null;
  }

  get complexity(): number {
    return 7;
  }

  get operator(): string {
    return 'Symbol';
  }

  get symbol(): string {
    return this._id;
  }

  //  A base definition is the base class of both symbol and function definition
  get baseDefinition(): BoxedBaseDefinition | undefined {
    if (this._def === undefined) this.bind();
    return this._def ?? undefined;
  }

  get symbolDefinition(): BoxedSymbolDefinition | undefined {
    if (this._def === undefined) this.bind();
    return this._def instanceof _BoxedSymbolDefinition ? this._def : undefined;
  }

  get functionDefinition(): BoxedFunctionDefinition | undefined {
    if (this._def === undefined) this.bind();
    return this._def instanceof _BoxedFunctionDefinition
      ? this._def
      : undefined;
  }

  /**
   * Subsequence inferences will narrow the domain of the symbol.
   * f: integer -> real, g: real -> real
   * g(x) => x: real
   * f(x) => x: integer narrowed from integer to real
   */
  infer(t: Type): boolean {
    // Call _lookupDef() to *not* auto-bind the symbol
    // which would defeat the purpose of inferring the type
    const def = this._lookupDef();
    if (!def) {
      // We don't know anything about this symbol yet, create a definition
      const scope = this.engine.swapScope(this._scope ?? this.engine.context);
      this._def = this.engine.defineSymbol(this._id, {
        type: t,
        inferred: true,
      });
      this.engine.swapScope(scope);
      return true;
    }

    // Narrow the type, if it was previously inferred
    if (
      def instanceof _BoxedSymbolDefinition &&
      (def.inferredType || def.type === 'unknown')
    ) {
      def.type = narrow(def.type, t);
      return true;
    }

    return false;
  }

  get value(): number | boolean | string | object | undefined {
    return this.symbolDefinition?.value?.value;
  }

  set value(
    value:
      | boolean
      | string
      | Decimal
      | number[]
      | OneOf<
          [
            { re: number; im: number },
            { num: number; denom: number },
            BoxedExpression,
          ]
        >
      | number
      | object
      | undefined
  ) {
    const ce = this.engine;

    //
    // Clear assumptions  about this symbol
    //
    ce.forget(this._id);

    //
    // Determine the new value
    //
    let v: BoxedExpression | undefined;
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
          value.map((x) => ce.box(x))
        );
      else throw new Error(`Invalid value for symbol ${this._id}: ${value}`);
    }

    if (value !== undefined) {
      const boxedValue = ce.box(value as Decimal | BoxedExpression);
      v = boxedValue.evaluate();
    }

    //
    // Assign the value to the corresponding definition
    //
    if (v?.type && isSubtype(v.type, 'function')) {
      console.assert(!this.engine.lookupSymbol(this._id));

      // New function definitions always completely replace an existing one
      this._def = ce.defineFunction(this._id, {
        signature: v.type.toString(),
        evaluate: v, // Evaluate as a lambda
      });
      return;
    }

    const def = this.engine.lookupSymbol(this._id);

    if (def && def instanceof _BoxedSymbolDefinition) {
      // We are already bound to a symbol definition, update it
      // (this may throw if the definition is readonly)
      def.value = v;
    } else {
      // Create a new symbol definition
      this._def = ce.defineSymbol(this._id, {
        value: v,
        type: v?.type.toString(),
      });
    }
  }

  // The type of the value of the symbol.
  // If the symbol is not bound to a definition, the type is 'any'
  get type(): Type {
    const def = this._def;
    if (!def) return 'unknown';
    if (def instanceof _BoxedSymbolDefinition) return def.type;
    if (def instanceof _BoxedFunctionDefinition) return def.signature;
    return 'unknown';
  }

  set type(t: Type | TypeString) {
    // Do nothing if the symbol is not bound
    if (!this._def) return;

    if (this._id[0] === '_')
      throw new Error(
        `The type of the wildcard "${this._id}" cannot be changed`
      );

    if (t === 'function' || isSignatureType(t)) {
      this.engine.forget(this._id);
      this._def = this.engine.defineFunction(this._id, {
        signature: t.toString(),
      });
    } else if (this._def instanceof _BoxedSymbolDefinition) {
      // Setting the domain will also update the flags
      this._def.type = typeof t === 'string' ? parseType(t) : t;
    } else {
      // Symbol was not bound to a definition, bind it in the current scope
      this.engine.forget(this._id);
      this._def = this.engine.defineSymbol(this._id, { type: t.toString() });
    }
  }

  // The sign of the value of the symbol
  get sgn(): Sign | undefined {
    const def = this._def;
    if (!def || !(def instanceof _BoxedSymbolDefinition)) return undefined;

    return def.sgn;
  }

  has(x: string | string[]): boolean {
    if (typeof x === 'string') return this._id === x;
    return x.includes(this._id);
  }

  match(
    pattern: BoxedExpression,
    options?: PatternMatchOptions
  ): BoxedSubstitution | null {
    return match(this, pattern, options);
  }

  get isFunction(): boolean | undefined {
    return !!this.functionDefinition;
  }

  get isOdd(): boolean | undefined {
    return this.symbolDefinition?.odd;
  }

  get isEven(): boolean | undefined {
    return this.symbolDefinition?.even;
  }

  get isInfinity(): boolean | undefined {
    const s = this.sgn;
    return s === 'negative-infinity' || s === 'positive-infinity';
  }

  get isNaN(): boolean | undefined {
    const s = this.sgn;
    return s === 'nan';
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

  get isNumber(): boolean | undefined {
    const t = this.type;
    if (t === 'unknown') return undefined;
    return isSubtype(t, 'number');
  }

  get isInteger(): boolean | undefined {
    const t = this.type;
    if (t === 'unknown') return undefined;
    return isSubtype(t, 'integer');
  }

  get isRational(): boolean | undefined {
    const t = this.type;
    if (t === 'unknown') return undefined;
    return isSubtype(t, 'rational');
  }

  get isReal(): boolean | undefined {
    const t = this.type;
    if (t === 'unknown') return undefined;
    return isSubtype(t, 'real');
  }

  get re(): number {
    return this.symbolDefinition?.value?.re ?? NaN;
  }

  get im(): number {
    return this.symbolDefinition?.value?.im ?? NaN;
  }

  get bignumRe(): BigNum | undefined {
    return this.symbolDefinition?.value?.bignumRe;
  }

  get bignumIm(): BigNum | undefined {
    return this.symbolDefinition?.value?.bignumIm;
  }

  simplify(options?: Partial<SimplifyOptions>): BoxedExpression {
    return simplify(this, options).at(-1)?.value ?? this;
  }

  evaluate(options?: EvaluateOptions): BoxedExpression {
    const def = this.symbolDefinition;
    if (!def) return this;
    const hold = def.holdUntil;

    if (options?.numericApproximation) {
      if (hold === 'never' || hold === 'evaluate' || hold === 'N')
        return def.value?.N() ?? this;
    } else {
      if (hold === 'never' || hold === 'evaluate')
        return def.value?.evaluate(options) ?? this;
    }
    return this;
  }

  N(): BoxedExpression {
    const def = this.symbolDefinition;
    if (def && def.holdUntil === 'never') return this;
    return def?.value?.N() ?? this;
  }

  replace(
    rules: Rule | (Rule | BoxedRule)[] | BoxedRuleSet,
    options?: Partial<ReplaceOptions>
  ): BoxedExpression | null {
    return replace(this, rules, options).at(-1)?.value ?? null;
  }

  subs(
    sub: Substitution,
    options?: { canonical?: CanonicalOptions }
  ): BoxedExpression {
    const canonical = options?.canonical ?? this.isCanonical;
    if (sub[this._id] === undefined) return canonical ? this.canonical : this;

    return this.engine.box(sub[this._id], { canonical });
  }

  get isCollection(): boolean {
    return this._getDef()?.collection?.contains !== undefined;
  }

  contains(rhs: BoxedExpression): boolean {
    return this._getDef()?.collection?.contains?.(this, rhs) ?? false;
  }

  get size(): number {
    return this._getDef()?.collection?.size?.(this) ?? 0;
  }

  each(start?: number, count?: number): Iterator<BoxedExpression, undefined> {
    const iter = this._getDef()?.collection?.iterator?.(this, start, count);
    if (!iter)
      return {
        next() {
          return { done: true, value: undefined };
        },
      };
    return iter;
  }

  at(index: number): BoxedExpression | undefined {
    return this._getDef()?.collection?.at?.(this, index);
  }

  get(index: BoxedExpression | string): BoxedExpression | undefined {
    if (typeof index === 'string')
      return this.baseDefinition?.collection?.at?.(this, index);

    if (!index.string) return undefined;
    return this.symbolDefinition?.collection?.at?.(this, index.string);
  }

  indexOf(expr: BoxedExpression): number {
    return this._getDef()?.collection?.indexOf?.(this, expr) ?? -1;
  }

  subsetOf(rhs: BoxedExpression, strict: boolean): boolean {
    return this._getDef()?.collection?.subsetOf?.(this, rhs, strict) ?? false;
  }
}

export function makeCanonicalSymbol(
  ce: IComputeEngine,
  name: string
): BoxedExpression {
  const def = ce.lookupSymbol(name);
  if (def?.holdUntil === 'never' && def.value) return def.value;
  return new BoxedSymbol(ce, name, { canonical: true, def });
}
