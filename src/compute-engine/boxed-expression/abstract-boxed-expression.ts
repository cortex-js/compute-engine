import { Decimal } from 'decimal.js';

import { Expression, MathJsonIdentifier } from '../../math-json/types';

import type {
  BoxedBaseDefinition,
  BoxedExpression,
  BoxedFunctionDefinition,
  BoxedRuleSet,
  BoxedSubstitution,
  BoxedSymbolDefinition,
  CanonicalOptions,
  EvaluateOptions,
  IComputeEngine,
  JsonSerializationOptions,
  Metadata,
  PatternMatchOptions,
  Rule,
  RuntimeScope,
  Sign,
  SimplifyOptions,
  Substitution,
} from './public';

import type { LatexString } from '../public';

import type { NumericValue } from '../numeric-value/public';

import type { SmallInteger } from '../numerics/numeric';

import { compileToJavascript } from '../compile';

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
import type { SerializeLatexOptions } from '../latex-syntax/public';

import { AsciiMathOptions, toAsciiMath } from './ascii-math';

/**
 * _BoxedExpression
 */

export abstract class _BoxedExpression implements BoxedExpression {
  abstract readonly hash: number;
  abstract readonly json: Expression;
  abstract readonly operator: string;

  /** @deprecated */
  get head(): string {
    return this.operator;
  }

  abstract get isCanonical(): boolean;
  abstract set isCanonical(_val: boolean);

  abstract match(
    pattern: BoxedExpression,
    options?: PatternMatchOptions
  ): BoxedSubstitution | null;

  readonly engine: IComputeEngine;

  /** Verbatim LaTeX, obtained from a source, i.e. from parsing,
   *  not generated synthetically
   */
  verbatimLatex?: string;

  constructor(ce: IComputeEngine, metadata?: Metadata) {
    this.engine = ce;
    if (metadata?.latex !== undefined) this.verbatimLatex = metadata.latex;
  }

  isSame(rhs: BoxedExpression): boolean {
    return same(this, rhs);
  }

  isEqual(rhs: number | BoxedExpression): boolean | undefined {
    return eq(this, rhs);
  }

  isLess(_rhs: number | BoxedExpression): boolean | undefined {
    const c = cmp(this, _rhs);
    if (c === undefined) return undefined;
    return c === '<';
  }

  isLessEqual(_rhs: number | BoxedExpression): boolean | undefined {
    const c = cmp(this, _rhs);
    if (c === undefined) return undefined;
    return c === '<=' || c === '<' || c === '=';
  }

  isGreater(_rhs: number | BoxedExpression): boolean | undefined {
    const c = cmp(this, _rhs);
    if (c === undefined) return undefined;
    return c === '>';
  }

  isGreaterEqual(_rhs: number | BoxedExpression): boolean | undefined {
    const c = cmp(this, _rhs);
    if (c === undefined) return undefined;
    return c === '>=' || c === '>' || c === '=';
  }

  /**
   *
   * `Object.valueOf()`: return a JavaScript primitive value for the expression
   *
   * Primitive values are: boolean, number, bigint, string, null, undefined
   *
   */
  valueOf(): number | object | string | boolean {
    if (this.symbol === 'True') return true;
    if (this.symbol === 'False') return false;
    if (this.symbol === 'NaN') return NaN;
    if (this.symbol === 'PositiveInfinity') return Infinity;
    if (this.symbol === 'NegativeInfinity') return -Infinity;
    if (this.isInfinity) {
      if (this.isPositive) return Infinity;
      if (this.isNegative) return -Infinity;
      return NaN;
    }
    if (typeof this.string === 'string') return this.string;
    if (typeof this.symbol === 'string') return this.symbol;
    if (this.im === 0) return this.re;
    return this.toString();
  }

  toAsciiMath(options: Partial<AsciiMathOptions> = {}): string {
    return toAsciiMath(this, options);
  }

  /** Object.toString() */
  toString(): string {
    return toAsciiMath(this);
  }

  print(): void {
    // Make sure the console.log is not removed by minification
    const log = console['info'];
    log?.(this.toString());
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

  /** Called by `JSON.stringify()` when serializing to json.
   *
   * Note: this is a standard method of JavaScript objects.
   *
   */
  toJSON(): Expression {
    return this.json;
  }

  toMathJson(
    options?: Readonly<Partial<JsonSerializationOptions>>
  ): Expression {
    const defaultOptions: JsonSerializationOptions = {
      exclude: [],
      shorthands: ['function', 'symbol', 'string', 'number'],
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
        defaultOptions.shorthands = ['function', 'symbol', 'string', 'number'];
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

    return serializeJson(this.engine, this, opts);
  }

  toLatex(options?: Partial<SerializeLatexOptions>): LatexString {
    // We want to use toMathJson(), not .json, so that we have all
    // the digits for numbers, repeated decimals
    const json = this.toMathJson();

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

      prettify: true,

      invisibleMultiply: '', // '\\cdot',
      invisiblePlus: '', // '+',
      // invisibleApply: '',

      multiply: '\\times',

      missingSymbol: '\\blacksquare',

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
      this.engine.indexedLatexDictionary,
      effectiveOptions
    );
  }

  toNumericValue(): [NumericValue, BoxedExpression] {
    return [this.engine._numericValue(1), this];
  }

  get scope(): RuntimeScope | null {
    return null;
  }

  is(rhs: any): boolean {
    // If the rhs is a number, the result can only be true if this
    // is a BoxedNumber
    if (typeof rhs === 'number' || typeof rhs === 'bigint') return false;

    if (typeof rhs === 'boolean') {
      if (this.symbol === 'True' && rhs === true) return true;
      if (this.symbol === 'False' && rhs === false) return true;
      return false;
    }

    if (rhs === null || rhs === undefined) return false;

    return same(this, this.engine.box(rhs));
  }

  get canonical(): BoxedExpression {
    return this;
  }

  get structural(): BoxedExpression {
    return this;
  }

  get isStructural(): boolean {
    return true;
  }

  get latex(): LatexString {
    return this.toLatex();
  }

  set latex(val: LatexString) {
    this.verbatimLatex = val;
  }

  get symbol(): string | null {
    return null;
  }

  get tensor(): null | AbstractTensor<'expression'> {
    return null;
  }

  get string(): string | null {
    return null;
  }

  getSubexpressions(
    operator: MathJsonIdentifier
  ): ReadonlyArray<BoxedExpression> {
    return getSubexpressions(this, operator);
  }

  get subexpressions(): ReadonlyArray<BoxedExpression> {
    return this.getSubexpressions('');
  }

  get symbols(): ReadonlyArray<string> {
    const set = new Set<string>();
    getSymbols(this, set);
    return Array.from(set);
  }

  get unknowns(): ReadonlyArray<string> {
    const set = new Set<string>();
    getUnknowns(this, set);
    return Array.from(set);
  }

  get freeVariables(): ReadonlyArray<string> {
    const set = new Set<string>();
    getFreeVariables(this, set);
    return Array.from(set);
  }

  get errors(): ReadonlyArray<BoxedExpression> {
    return this.getSubexpressions('Error');
  }

  // Only return non-null for functions
  get ops(): null | ReadonlyArray<BoxedExpression> {
    return null;
  }

  get nops(): SmallInteger {
    return 0;
  }

  get op1(): BoxedExpression {
    return this.engine.Nothing;
  }

  get op2(): BoxedExpression {
    return this.engine.Nothing;
  }

  get op3(): BoxedExpression {
    return this.engine.Nothing;
  }

  get isValid(): boolean {
    return true;
  }

  get isPure(): boolean {
    return false;
  }

  /** Literals (number, string, boolean) are constants. Some symbols
   * may also be constants (e.g. Pi, E, True, False). Expressions of constant
   * symbols are also constants (if the function is pure).
   */
  get isConstant(): boolean {
    return true;
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

  get isEven(): boolean | undefined {
    return undefined;
  }

  get isOdd(): boolean | undefined {
    return undefined;
  }

  get numericValue(): number | NumericValue | null {
    return null;
  }

  get isNumberLiteral(): boolean {
    return false;
  }

  get isFunctionExpression(): boolean {
    return false;
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

  get numerator(): BoxedExpression {
    return this;
  }

  get denominator(): BoxedExpression {
    return this.engine.One;
  }

  get numeratorDenominator(): [BoxedExpression, BoxedExpression] {
    return [this, this.engine.One];
  }

  //
  // Algebraic operations
  //
  neg(): BoxedExpression {
    return this.engine.NaN;
  }

  inv(): BoxedExpression {
    return this.engine.NaN;
  }

  abs(): BoxedExpression {
    return this.engine.NaN;
  }

  add(rhs: number | BoxedExpression): BoxedExpression {
    return this.engine.NaN;
  }

  sub(rhs: BoxedExpression): BoxedExpression {
    return this.add(rhs.neg());
  }

  mul(rhs: NumericValue | number | BoxedExpression): BoxedExpression {
    return this.engine.NaN;
  }

  div(rhs: number | BoxedExpression): BoxedExpression {
    return this.engine.NaN;
  }

  pow(exp: number | BoxedExpression): BoxedExpression {
    return this.engine.NaN;
  }

  root(exp: number | BoxedExpression): BoxedExpression {
    return this.engine.NaN;
  }

  sqrt(): BoxedExpression {
    return this.engine.NaN;
  }

  ln(base?: number | BoxedExpression): BoxedExpression {
    return this.engine.NaN;
  }

  get sgn(): Sign | undefined {
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
  ): BoxedExpression {
    return options?.canonical === true ? this.canonical : this;
  }

  map(
    fn: (x: BoxedExpression) => BoxedExpression,
    options?: { canonical: CanonicalOptions; recursive?: boolean }
  ): BoxedExpression {
    if (!this.ops) return fn(this);
    const canonical = options?.canonical ?? this.isCanonical;
    const recursive = options?.recursive ?? true;

    const ops = this.ops.map((x) => (recursive ? x.map(fn, options) : fn(x)));
    return fn(this.engine.function(this.operator, ops, { canonical }));
  }

  solve(
    _vars:
      | Iterable<string>
      | string
      | BoxedExpression
      | Iterable<BoxedExpression>
  ): null | ReadonlyArray<BoxedExpression> {
    return null;
  }

  replace(_rules: BoxedRuleSet | Rule | Rule[]): null | BoxedExpression {
    return null;
  }

  has(_v: string | string[]): boolean {
    return false;
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
  //
  //
  //
  //

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

  get symbolDefinition(): BoxedSymbolDefinition | undefined {
    return undefined;
  }

  get functionDefinition(): BoxedFunctionDefinition | undefined {
    return undefined;
  }

  infer(_t: Type): boolean {
    return false; // The inference was ignored if false
  }

  bind(): void {
    return;
  }

  reset(): void {
    return;
  }

  get value(): number | boolean | string | object | undefined {
    return this.N().valueOf();
  }

  set value(
    _value: BoxedExpression | number | boolean | string | number[] | undefined
  ) {
    throw new Error(`Can't change the value of \\(${this.latex}\\)`);
  }

  get type(): Type {
    return 'unknown';
  }

  set type(_type: Type) {
    throw new Error(`Can't change the type of \\(${this.latex}\\)`);
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

  simplify(_options?: Partial<SimplifyOptions>): BoxedExpression {
    return this;
  }

  expand(): BoxedExpression {
    return expand(this) ?? this;
  }

  evaluate(_options?: Partial<EvaluateOptions>): BoxedExpression {
    return this.simplify();
  }

  evaluateAsync(_options?: Partial<EvaluateOptions>): Promise<BoxedExpression> {
    return Promise.resolve(this.evaluate());
  }

  N(): BoxedExpression {
    return this.evaluate({ numericApproximation: true });
  }

  compile(options?: {
    to?: 'javascript';
    optimize?: ('simplify' | 'evaluate')[];
    functions?: Record<MathJsonIdentifier, string | ((...any) => any)>;
    vars?: Record<MathJsonIdentifier, string>;
    imports?: Function[];
    preamble?: string;
  }): (args: Record<string, any>) => any | undefined {
    if (options?.to && options.to !== 'javascript')
      throw new Error('Unknown target');
    options ??= { optimize: ['simplify'] };
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    let expr = this as BoxedExpression;
    if (options?.optimize?.includes('simplify')) expr = expr.simplify();
    if (options?.optimize?.includes('evaluate')) expr = expr.evaluate();
    return compileToJavascript(
      expr,
      options?.functions,
      options?.vars,
      options?.imports,
      options?.preamble
    );
  }

  get isCollection(): boolean {
    return false;
  }

  contains(_rhs: BoxedExpression): boolean {
    return false;
  }

  subsetOf(_target: BoxedExpression, _strict: boolean): boolean {
    return false;
  }

  get size(): number {
    return 0;
  }

  each(_start?: number, _count?: number): Iterator<BoxedExpression, undefined> {
    return {
      next() {
        return { done: true, value: undefined };
      },
    };
  }

  at(_index: number): BoxedExpression | undefined {
    return undefined;
  }

  get(_key: string | BoxedExpression): BoxedExpression | undefined {
    return undefined;
  }

  indexOf(_expr: BoxedExpression): number {
    return -1;
  }
}

/**
 * Return the free variables (non local variable) in the expression,
 * recursively.
 *
 * A free variable is an identifier that is not an argument to a function,
 * or a local variable.
 *
 */
function getFreeVariables(expr: BoxedExpression, result: Set<string>): void {
  // @todo: need to check for '["Block"]' which may contain ["Declare"] expressions and exclude those

  if (expr.operator === 'Block') {
  }

  if (expr.symbol) {
    const def = expr.engine.lookupSymbol(expr.symbol);
    if (def && def.value !== undefined) return;

    const fnDef = expr.engine.lookupFunction(expr.symbol);
    if (fnDef && fnDef.evaluate) return;

    result.add(expr.symbol);
    return;
  }

  if (expr.ops) for (const op of expr.ops) getFreeVariables(op, result);
}

function getSymbols(expr: BoxedExpression, result: Set<string>): void {
  if (expr.symbol) {
    result.add(expr.symbol);
    return;
  }

  if (expr.ops) for (const op of expr.ops) getSymbols(op, result);
}

/**
 * Return the unknowns in the expression, recursively.
 *
 * An unknown is an identifier (symbol or function) that is not bound
 * to a value.
 *
 */
function getUnknowns(expr: BoxedExpression, result: Set<string>): void {
  if (expr.symbol) {
    const s = expr.symbol;
    if (s === 'Unknown' || s === 'Undefined' || s === 'Nothing') return;

    const def = expr.engine.lookupSymbol(s);
    if (def && def.value !== undefined) return;

    const fnDef = expr.engine.lookupFunction(s);
    if (fnDef && fnDef.evaluate) return;

    result.add(s);
    return;
  }

  if (expr.ops) for (const op of expr.ops) getUnknowns(op, result);
}

export function getSubexpressions(
  expr: BoxedExpression,
  name: MathJsonIdentifier
): ReadonlyArray<BoxedExpression> {
  const result = !name || expr.operator === name ? [expr] : [];
  if (expr.ops) {
    for (const op of expr.ops) result.push(...getSubexpressions(op, name));
  }
  return result;
}

// To avoid circular dependency issues we have to import the following
// function *after* the class definition

import { serializeJson } from './serialize';
import type { Type } from '../../common/type/types';
import { cmp, eq, same } from './compare';
import { AbstractTensor } from '../tensor/tensors';
import { expand } from './expand';
