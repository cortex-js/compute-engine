import { Decimal } from 'decimal.js';

import type { MathJsonExpression, MathJsonSymbol } from '../../math-json/types';

// To avoid circular dependency issues we have to import the following
// function *after* the class definition

import type { Type, TypeString } from '../../common/type/types';
import { BoxedType } from '../../common/type/boxed-type';

import type {
  BoxedSubstitution,
  Metadata,
  Substitution,
  CanonicalOptions,
  BoxedRuleSet,
  Rule,
  BoxedBaseDefinition,
  BoxedValueDefinition,
  BoxedOperatorDefinition,
  EvaluateOptions,
  ExpressionInput,
  Sign,
  Expression,
  JsonSerializationOptions,
  PatternMatchOptions,
  SimplifyOptions,
  IComputeEngine as ComputeEngine,
  Scope,
  Tensor,
  TensorDataType,
} from '../global-types';

import type { NumericValue } from '../numeric-value/types';
import type { SmallInteger } from '../numerics/types';

import {
  getApplyFunctionStyle,
  getFractionStyle,
  getGroupStyle,
  getLogicStyle,
  getNumericSetStyle,
  getPowerStyle,
  getRootStyle,
} from '../latex-syntax/serializer-style';
import { serializeLatex } from '../latex-syntax/serializer';
import type { LatexString, SerializeLatexOptions } from '../latex-syntax/types';

import { toAsciiMath } from './ascii-math';
// Dynamic import for serializeJson to avoid circular dependency
import { cmp, eq, same } from './compare';
import { CancellationError } from '../../common/interruptible';
import { isSymbol, isString, isNumber, isFunction } from './type-guards';

// Lazy reference to break circular dependency:
// serialize → numerics → utils → abstract-boxed-expression
type SerializeJsonFn = (
  ce: ComputeEngine,
  expr: Expression,
  options: Readonly<JsonSerializationOptions>
) => MathJsonExpression;
let _serializeJson: SerializeJsonFn;
/** @internal */
export function _setSerializeJson(fn: SerializeJsonFn) {
  _serializeJson = fn;
}

type ExpandFn = (expr: Expression) => Expression;
let _expandForIs: ExpandFn;
/** @internal */
export function _setExpandForIs(fn: ExpandFn) {
  _expandForIs = fn;
}

// Lazy reference to break circular dependency:
// abstract-boxed-expression → polynomials → arithmetic-add → boxed-tensor → abstract-boxed-expression
type GetPolynomialCoefficientsFn = (
  expr: Expression,
  variable: string
) => Expression[] | null;
let _getPolynomialCoefficients: GetPolynomialCoefficientsFn;
/** @internal */
export function _setGetPolynomialCoefficients(
  fn: GetPolynomialCoefficientsFn
) {
  _getPolynomialCoefficients = fn;
}

const EXPANDABLE_OPS = ['Multiply', 'Power', 'Negate', 'Divide'];

/** Return true if at least one side contains an operator where expansion could
 *  produce a structurally different result.  Uses `.has()` which recursively
 *  walks the expression tree, so nested cases like `Add(Multiply(a, Add(b,c)), 1)`
 *  are detected. */
function _couldBenefitFromExpand(
  a: _BoxedExpression,
  b: Expression | number | bigint | boolean | string
): boolean {
  if (a.has(EXPANDABLE_OPS)) return true;
  if (typeof b === 'object' && b !== null && 'has' in b)
    return (b as _BoxedExpression).has(EXPANDABLE_OPS);
  return false;
}

/**
 * _BoxedExpression
 *
 * @internal
 */

export abstract class _BoxedExpression implements Expression {
  readonly _kind: string = 'expression';

  abstract readonly hash: number;
  abstract readonly json: MathJsonExpression;
  abstract isCanonical: boolean;

  abstract match(
    pattern: string | ExpressionInput,
    options?: PatternMatchOptions
  ): BoxedSubstitution | null;

  readonly engine: ComputeEngine;

  /** Verbatim LaTeX, obtained from a source, i.e. from parsing,
   *  not generated synthetically
   */
  readonly verbatimLatex?: string;

  constructor(ce: ComputeEngine, metadata?: Metadata) {
    this.engine = ce;
    if (metadata?.latex !== undefined) this.verbatimLatex = metadata.latex;
  }

  /**
   *
   * `Object.valueOf()`: return a JavaScript primitive value for the expression
   *
   * Primitive values are: boolean, number, bigint, string, null, undefined
   *
   */
  valueOf(): number | number[] | number[][] | number[][][] | string | boolean {
    try {
      if (this.symbol === 'True') return true;
      if (this.symbol === 'False') return false;
      if (this.symbol === 'NaN') return NaN;
      if (this.symbol === 'PositiveInfinity') return Infinity;
      if (this.symbol === 'NegativeInfinity') return -Infinity;
      if (this.symbol === 'ComplexInfinity') return '~oo';
      if (this.isInfinity) {
        if (this.isPositive) return Infinity;
        if (this.isNegative) return -Infinity;
        return '~oo'; // ComplexInfinity
      }
      if (typeof this.string === 'string') return this.string;
      if (typeof this.symbol === 'string')
        return this.value?.valueOf() ?? this.symbol;

      // Numeric values are handled in the BoxedNumber class

      return toAsciiMath(this);
    } catch (e) {
      // Because `valueOf()` can be called by the debugger, we want to
      // be extra robust.
      if (e instanceof CancellationError) {
        const msg = e.message ?? '<canceled>';
        return e.cause ? `${msg}: ${e.cause}` : `${msg}`;
      }
      if (e.message) return e.message;
      return '<error>';
    }
  }

  [Symbol.toPrimitive](
    hint: 'number' | 'string' | 'default'
  ): number | string | null {
    if (hint === 'number') {
      const v = this.valueOf();
      return typeof v === 'number' ? v : null;
    }
    return this.toString();
  }

  /** Object.toString() */
  toString(): string {
    try {
      // If this is a lazy collection, we need to force evaluation
      if (this.isLazyCollection) {
        const materialized = this.evaluate({ materialization: true });
        if (!materialized.isLazyCollection) return toAsciiMath(materialized);
      }

      return toAsciiMath(this);
    } catch (e) {
      // Because `toString()` can be called by the debugger, we want to
      // be extra robust.
      if (e instanceof CancellationError) {
        const msg = e.message ?? '<canceled>';
        return e.cause ? `${msg}: ${e.cause}` : `${msg}`;
      }
      if (e.message) return e.message;
      return '<error>';
    }
  }

  toLatex(options?: Partial<SerializeLatexOptions>): LatexString {
    // If this is a finite lazy collection, we force evaluation
    if (this.isLazyCollection) {
      const materialized = this.evaluate({
        materialization: options?.materialization ?? true,
      });
      if (!materialized.isLazyCollection) return materialized.toLatex(options);
    }

    // We want to use toMathJson(), not .json, so that we have all
    // the digits for numbers, repeated decimals
    const json = this.toMathJson({ prettify: options?.prettify ?? true });

    let effectiveOptions: SerializeLatexOptions = {
      imaginaryUnit: '\\imaginaryI',

      positiveInfinity: '\\infty',
      negativeInfinity: '-\\infty',
      notANumber: '\\operatorname{NaN}',

      decimalSeparator: this.engine.decimalSeparator,
      digitGroupSeparator: '\\,', // for thousands, etc...
      exponentProduct: '\\cdot',
      beginExponentMarker: '10^{', // could be 'e'
      endExponentMarker: '}',

      digitGroup: 3,

      truncationMarker: '\\ldots',

      repeatingDecimal: 'vinculum',

      fractionalDigits: 'max',
      notation: 'auto',
      avoidExponentsInRange: [-7, 20],

      prettify: true, // (overridden subseq. by options)
      materialization: false,

      invisibleMultiply: '', // '\\cdot',
      invisiblePlus: '', // '+',
      // invisibleApply: '',

      multiply: '\\times',

      missingSymbol: '\\blacksquare',

      dmsFormat: false,
      angleNormalization: 'none' as const,

      // openGroup: '(',
      // closeGroup: ')',
      // divide: '\\frac{#1}{#2}',
      // subtract: '#1-#2',
      // add: '#1+#2',
      // negate: '-#1',
      // squareRoot: '\\sqrt{#1}',
      // nthRoot: '\\sqrt[#2]{#1}',
      applyFunctionStyle: getApplyFunctionStyle,
      groupStyle: getGroupStyle,
      rootStyle: getRootStyle,
      fractionStyle: getFractionStyle,
      logicStyle: getLogicStyle,
      powerStyle: getPowerStyle,
      numericSetStyle: getNumericSetStyle,
    };

    if (options?.fractionalDigits === 'auto')
      effectiveOptions.fractionalDigits = -this.engine.precision;
    else effectiveOptions.fractionalDigits = options?.fractionalDigits ?? 'max';

    if (
      typeof effectiveOptions.fractionalDigits === 'number' &&
      effectiveOptions.fractionalDigits > this.engine.precision
    )
      effectiveOptions.fractionalDigits = this.engine.precision;

    effectiveOptions = {
      ...effectiveOptions,
      ...(options ?? {}),
      fractionalDigits: effectiveOptions.fractionalDigits,
    };

    if (!effectiveOptions.prettify && this.verbatimLatex)
      return this.verbatimLatex;

    return serializeLatex(
      json,
      this.engine._indexedLatexDictionary,
      effectiveOptions
    );
  }

  get latex(): LatexString {
    return this.toLatex();
  }

  /** Called by `JSON.stringify()` when serializing to json.
   *
   * Note: this is a standard method of JavaScript objects.
   *
   */
  toJSON(): MathJsonExpression {
    return this.json;
  }

  toMathJson(
    options?: Readonly<Partial<JsonSerializationOptions>>
  ): MathJsonExpression {
    const defaultOptions: JsonSerializationOptions = {
      exclude: [],
      shorthands: ['function', 'symbol', 'string', 'number', 'dictionary'],
      metadata: [],
      fractionalDigits: 'max',
      repeatingDecimal: true,
      prettify: true,
    };

    if (options) {
      if (
        (typeof options.shorthands === 'string' &&
          options.shorthands === 'all') ||
        options.shorthands?.includes('all')
      ) {
        defaultOptions.shorthands = [
          'function',
          'symbol',
          'string',
          'number',
          'dictionary',
        ];
      }
      // if (options.shorthands?.includes('none')) defaultOptions.shorthands = [];
      if (Array.isArray(options.shorthands))
        defaultOptions.shorthands = options.shorthands;
      if (
        (typeof options.metadata === 'string' && options.metadata === 'all') ||
        options.metadata?.includes('all')
      ) {
        defaultOptions.metadata = ['latex', 'wikidata'];
      }
      if (options.fractionalDigits === 'auto')
        defaultOptions.fractionalDigits = -this.engine.precision; // When negative, indicate that the number of digits should be less than the number of whole digits + this value
      if (typeof options.fractionalDigits === 'number')
        defaultOptions.fractionalDigits = options.fractionalDigits;
    }
    const opts: JsonSerializationOptions = {
      ...defaultOptions,
      ...options,
      fractionalDigits: defaultOptions.fractionalDigits,
      shorthands: defaultOptions.shorthands,
      metadata: defaultOptions.metadata,
    };

    return _serializeJson(this.engine, this, opts);
  }

  print(): void {
    // Make sure the console.log is not removed by minification
    const log = console['info'];
    log?.(this.toString());
  }

  get isStructural(): boolean {
    return true;
  }

  get canonical(): Expression {
    return this;
  }

  get structural(): Expression {
    return this;
  }

  get isValid(): boolean {
    return true;
  }

  get isPure(): boolean {
    return false;
  }

  get isConstant(): boolean {
    return true;
  }

  get isNumberLiteral(): boolean {
    return false;
  }

  get numericValue(): number | NumericValue | undefined {
    return undefined;
  }

  toNumericValue(): [NumericValue, Expression] {
    return [this.engine._numericValue(1), this];
  }

  get isEven(): boolean | undefined {
    return undefined;
  }

  get isOdd(): boolean | undefined {
    return undefined;
  }

  get re(): number {
    return NaN;
  }

  get im(): number {
    return NaN;
  }

  get bignumRe(): Decimal | undefined {
    return undefined;
  }

  get bignumIm(): Decimal | undefined {
    return undefined;
  }

  get sgn(): Sign | undefined {
    return undefined;
  }

  // x > 0
  get isPositive(): boolean | undefined {
    return undefined;
  }

  // x >= 0
  get isNonNegative(): boolean | undefined {
    return undefined;
  }

  // x < 0
  get isNegative(): boolean | undefined {
    return undefined;
  }

  // x <= 0
  get isNonPositive(): boolean | undefined {
    return undefined;
  }

  //
  // Algebraic operations
  //
  neg(): Expression {
    return this.engine.NaN;
  }

  inv(): Expression {
    return this.engine.NaN;
  }

  abs(): Expression {
    return this.engine.NaN;
  }

  add(_rhs: number | Expression): Expression {
    return this.engine.NaN;
  }

  sub(rhs: Expression): Expression {
    return this.add(rhs.neg());
  }

  mul(_rhs: NumericValue | number | Expression): Expression {
    return this.engine.NaN;
  }

  div(_rhs: number | Expression): Expression {
    return this.engine.NaN;
  }

  pow(_exp: number | Expression): Expression {
    return this.engine.NaN;
  }

  root(_exp: number | Expression): Expression {
    return this.engine.NaN;
  }

  sqrt(): Expression {
    return this.engine.NaN;
  }

  ln(_base?: number | Expression): Expression {
    return this.engine.NaN;
  }

  get numerator(): Expression {
    return this;
  }

  get denominator(): Expression {
    return this.engine.One;
  }

  get numeratorDenominator(): [Expression, Expression] {
    return [this, this.engine.One];
  }

  toRational(): [number, number] | null {
    return null;
  }

  factors(): ReadonlyArray<Expression> {
    return [this];
  }

  polynomialCoefficients(
    variable?: string
  ): ReadonlyArray<Expression> | undefined {
    if (variable === undefined) {
      const unknowns = this.unknowns;
      if (unknowns.length !== 1) return undefined;
      variable = unknowns[0];
    }

    const coeffs = _getPolynomialCoefficients(this, variable);
    if (coeffs === null) return undefined;
    return coeffs.reverse();
  }

  is(
    other: Expression | number | bigint | boolean | string,
    tolerance?: number
  ): boolean {
    // Fast path: exact structural/value check
    if (this.isSame(other)) return true;

    // Try expansion — catches equivalences like (x+1)^2 vs x^2+2x+1
    // even when the expression has free variables (where the numeric
    // fallback below would bail out).
    //
    // Only expand when at least one side contains Multiply, Power, or
    // Negate — those are the only operators where expansion can produce
    // a structurally different result. This avoids needlessly
    // reconstructing Add trees (expand recurses into Add operands).
    if (_expandForIs && _couldBenefitFromExpand(this, other)) {
      const expandedThis = _expandForIs(this);
      if (expandedThis !== this && expandedThis.isSame(other)) return true;
      if (other instanceof _BoxedExpression) {
        const expandedOther = _expandForIs(other);
        if (expandedThis.isSame(expandedOther)) return true;
      }
    }

    // Numeric fallback only when there are no free variables
    if (this.freeVariables.length > 0) return false;

    // Only attempt numeric comparison for numeric arguments
    if (typeof other === 'number' || typeof other === 'bigint') {
      const n = this.N();
      if (n === this) return false; // .N() returned self — can't evaluate
      if (!isNumber(n)) return false;
      const tol = tolerance ?? this.engine.tolerance;
      const nRe = n.re;
      const nIm = n.im;
      if (typeof other === 'number') {
        if (Number.isNaN(other)) return Number.isNaN(nRe);
        if (!Number.isFinite(other)) return nRe === other; // ±Infinity exact
        return Math.abs(nRe - other) <= tol && Math.abs(nIm) <= tol;
      }
      // bigint
      return Math.abs(nRe - Number(other)) <= tol && Math.abs(nIm) <= tol;
    }

    // Expression argument: evaluate both sides
    if (other instanceof _BoxedExpression) {
      if (other.freeVariables.length > 0) return false;
      const nThis = this.N();
      const nOther = other.N();
      if (!isNumber(nThis) || !isNumber(nOther)) return false;
      const tol = tolerance ?? this.engine.tolerance;
      return (
        Math.abs(nThis.re - nOther.re) <= tol &&
        Math.abs(nThis.im - nOther.im) <= tol
      );
    }

    return false;
  }

  isSame(other: Expression | number | bigint | boolean | string): boolean {
    if (typeof other === 'number' || typeof other === 'bigint') return false;
    if (other === null || other === undefined) return false;
    if (typeof other === 'boolean') {
      const val = this.value;
      if (other === true) return isSymbol(val, 'True');
      if (other === false) return isSymbol(val, 'False');
      return false;
    }
    if (typeof other === 'string') {
      const val = this.value;
      return isString(val) ? val.string === other : false;
    }
    return same(this, other);
  }

  isEqual(other: number | Expression): boolean | undefined {
    return eq(this, other);
  }

  isLess(other: number | Expression): boolean | undefined {
    const c = cmp(this, other);
    if (c === undefined) return undefined;
    return c === '<';
  }

  isLessEqual(other: number | Expression): boolean | undefined {
    const c = cmp(this, other);
    if (c === undefined) return undefined;
    return c === '<=' || c === '<' || c === '=';
  }

  isGreater(other: number | Expression): boolean | undefined {
    const c = cmp(this, other);
    if (c === undefined) return undefined;
    return c === '>';
  }

  isGreaterEqual(other: number | Expression): boolean | undefined {
    const c = cmp(this, other);
    if (c === undefined) return undefined;
    return c === '>=' || c === '>' || c === '=';
  }

  get symbol(): string | undefined {
    return undefined;
  }

  get tensor(): Tensor<TensorDataType> | undefined {
    return undefined;
  }

  get string(): string | undefined {
    return undefined;
  }

  getSubexpressions(operator: MathJsonSymbol): ReadonlyArray<Expression> {
    return getSubexpressions(this, operator);
  }

  get subexpressions(): ReadonlyArray<Expression> {
    return this.getSubexpressions('');
  }

  get symbols(): ReadonlyArray<string> {
    const set = new Set<string>();
    getSymbols(this, set);
    return Array.from(set).sort();
  }

  get unknowns(): ReadonlyArray<string> {
    const set = new Set<string>();
    getUnknowns(this, set);
    return Array.from(set).sort();
  }

  get freeVariables(): ReadonlyArray<string> {
    return this.unknowns;
  }

  get errors(): ReadonlyArray<Expression> {
    return this.getSubexpressions('Error');
  }

  get isFunctionExpression(): boolean {
    return false;
  }

  // Only return non-undefined for functions
  get ops(): ReadonlyArray<Expression> | undefined {
    return undefined;
  }

  get isScoped(): boolean {
    return false;
  }
  get localScope(): Scope | undefined {
    return undefined;
  }

  abstract readonly operator: string;

  get nops(): SmallInteger {
    return 0;
  }

  get op1(): Expression {
    return this.engine.Nothing;
  }

  get op2(): Expression {
    return this.engine.Nothing;
  }

  get op3(): Expression {
    return this.engine.Nothing;
  }

  get isNaN(): boolean | undefined {
    return undefined;
  }

  get isInfinity(): boolean | undefined {
    return undefined;
  }

  // Not +- Infinity, not NaN
  get isFinite(): boolean | undefined {
    return undefined;
  }

  get shape(): number[] {
    return [];
  }

  get rank(): number {
    return 0;
  }

  subs(
    _sub: Substitution,
    options?: { canonical?: CanonicalOptions }
  ): Expression {
    return options?.canonical === true ? this.canonical : this;
  }

  map(
    fn: (x: Expression) => Expression,
    options?: { canonical: CanonicalOptions; recursive?: boolean }
  ): Expression {
    if (!this.ops) return fn(this);
    const canonical = options?.canonical ?? this.isCanonical;
    const recursive = options?.recursive ?? true;

    const ops = this.ops.map((x) => (recursive ? x.map(fn, options) : fn(x)));
    return fn(
      this.engine.function(this.operator, ops, {
        form: canonical ? 'canonical' : 'raw',
      })
    );
  }

  solve(
    _vars?: Iterable<string> | string | Expression | Iterable<Expression>
  ):
    | null
    | ReadonlyArray<Expression>
    | Record<string, Expression>
    | Array<Record<string, Expression>> {
    return null;
  }

  replace(_rules: BoxedRuleSet | Rule | Rule[]): null | Expression {
    return null;
  }

  has(_v: string | string[]): boolean {
    return false;
  }

  get description(): string[] | undefined {
    if (!this.baseDefinition) return undefined;
    if (!this.baseDefinition.description) return undefined;
    if (typeof this.baseDefinition.description === 'string')
      return [this.baseDefinition.description];
    return this.baseDefinition.description;
  }

  get url(): string | undefined {
    return this.baseDefinition?.url ?? undefined;
  }

  get wikidata(): string | undefined {
    return this.baseDefinition?.wikidata ?? undefined;
  }
  // set wikidata(val: string | undefined) {}

  get complexity(): number | undefined {
    return undefined;
  }

  get baseDefinition(): BoxedBaseDefinition | undefined {
    return undefined;
  }

  get valueDefinition(): BoxedValueDefinition | undefined {
    return undefined;
  }

  get operatorDefinition(): BoxedOperatorDefinition | undefined {
    return undefined;
  }

  infer(_t: Type, _inferenceMode?: 'narrow' | 'widen'): boolean {
    return false; // The inference was ignored if false
  }

  bind(): void {
    return;
  }

  reset(): void {
    return;
  }

  get value(): Expression | undefined {
    return undefined;
  }

  set value(_value: unknown) {
    throw new Error(`Can't change the value of \\(${this.toString()}\\)`);
  }

  get type(): BoxedType {
    return BoxedType.unknown;
  }

  set type(_type: Type | TypeString | BoxedType) {
    throw new Error(`Can't change the type of \\(${this.toString()}\\)`);
  }

  get isNumber(): boolean | undefined {
    return undefined;
  }

  get isInteger(): boolean | undefined {
    return undefined;
  }

  get isRational(): boolean | undefined {
    return undefined;
  }

  get isReal(): boolean | undefined {
    return undefined;
  }

  simplify(_options?: Partial<SimplifyOptions>): Expression {
    return this;
  }

  evaluate(_options?: Partial<EvaluateOptions>): Expression {
    return this.simplify();
  }

  evaluateAsync(_options?: Partial<EvaluateOptions>): Promise<Expression> {
    return Promise.resolve(this.evaluate());
  }

  N(): Expression {
    return this.evaluate({ numericApproximation: true });
  }

  get isCollection(): boolean {
    return false;
  }

  get isIndexedCollection(): boolean {
    return false;
  }

  get isLazyCollection(): boolean {
    return false;
  }

  contains(_rhs: Expression): boolean | undefined {
    return undefined;
  }

  subsetOf(_target: Expression, _strict: boolean): boolean | undefined {
    return undefined;
  }

  get count(): number | undefined {
    return undefined;
  }

  get isEmptyCollection(): boolean | undefined {
    if (!this.isCollection) return undefined;
    const count = this.count;
    if (count === undefined) return undefined;
    return count === 0;
  }

  get isFiniteCollection(): boolean | undefined {
    if (!this.isCollection) return undefined;
    const count = this.count;
    if (count === undefined) return undefined;
    return Number.isFinite(count);
  }

  each(): Generator<Expression> {
    return (function* () {})();
  }

  at(_index: number): Expression | undefined {
    return undefined;
  }

  get(_key: string | Expression): Expression | undefined {
    return undefined;
  }

  indexWhere(_predicate: (element: Expression) => boolean): number | undefined {
    return undefined;
  }
}

export function getSubexpressions(
  expr: Expression,
  name: MathJsonSymbol
): ReadonlyArray<Expression> {
  const result = !name || expr.operator === name ? [expr] : [];
  if (isFunction(expr)) {
    for (const op of expr.ops) result.push(...getSubexpressions(op, name));
  }
  return result;
}

/**
 * Return the symbols in the expression, recursively. This does not include
 * the symbols used as operator names, e.g. `Add`, `Sin`, etc...
 *
 */
function getSymbols(expr: Expression, result: Set<string>): void {
  if (isSymbol(expr)) {
    result.add(expr.symbol);
    return;
  }

  if (isFunction(expr)) for (const op of expr.ops) getSymbols(op, result);
}

/**
 * Return the unknowns in the expression, recursively.
 *
 * An unknown is symbol that is not bound to a value.
 *
 */
function getUnknowns(expr: Expression, result: Set<string>): void {
  if (isSymbol(expr)) {
    const s = expr.symbol;
    if (s === 'Unknown' || s === 'Undefined' || s === 'Nothing') return;

    if (expr.valueDefinition?.isConstant) return;

    if (expr.operatorDefinition) return;

    const value = expr.engine._getSymbolValue(s);
    if (value === undefined) result.add(s);
    return;
  }

  if (isFunction(expr)) {
    if (expr.isScoped && expr.localScope) {
      // For scoped functions (Sum, Product, Integrate, Block, etc.),
      // collect unknowns from ops then exclude the bound variables.
      // The scope's bindings map includes all symbols referenced during
      // canonicalization (including free variables like upper bounds),
      // so we extract the actual bound variables from the structure.
      const boundVars = new Set<string>();
      for (const op of expr.ops) {
        if (!isFunction(op)) continue;
        // Sum/Product/Integrate: Limits(index, ...) or Element(index, ...)
        if (
          (op.operator === 'Limits' || op.operator === 'Element') &&
          isSymbol(op.op1)
        )
          boundVars.add(op.op1.symbol);
        // Block: Assign(symbol, value) or Declare(symbol, ...)
        if (
          (op.operator === 'Assign' || op.operator === 'Declare') &&
          isSymbol(op.op1)
        )
          boundVars.add(op.op1.symbol);
      }

      const inner = new Set<string>();
      for (const op of expr.ops) getUnknowns(op, inner);
      for (const s of inner) {
        if (!boundVars.has(s)) result.add(s);
      }
    } else {
      for (const op of expr.ops) getUnknowns(op, result);
    }
  }
}
