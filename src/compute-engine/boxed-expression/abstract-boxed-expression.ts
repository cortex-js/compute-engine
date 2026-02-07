import { Decimal } from 'decimal.js';

import type { Expression, MathJsonSymbol } from '../../math-json/types';

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
  Sign,
  BoxedExpression,
  JsonSerializationOptions,
  PatternMatchOptions,
  SimplifyOptions,
  ComputeEngine,
  Scope,
  Tensor,
} from '../global-types';

import type { NumericValue } from '../numeric-value/types';
import type { SmallInteger } from '../numerics/types';
// Dynamic import for JavaScriptTarget and applicableN1 to avoid circular dependency

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
// Dynamic import for expand to avoid circular dependency
import { CancellationError } from '../../common/interruptible';

/**
 * _BoxedExpression
 *
 * @internal
 */

export abstract class _BoxedExpression implements BoxedExpression {
  abstract readonly hash: number;
  abstract readonly json: Expression;
  abstract isCanonical: boolean;

  abstract match(
    pattern: BoxedExpression,
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
  toJSON(): Expression {
    return this.json;
  }

  toMathJson(
    options?: Readonly<Partial<JsonSerializationOptions>>
  ): Expression {
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

    // Dynamic import to avoid circular dependency
    const { serializeJson } = require('./serialize');
    return serializeJson(this.engine, this, opts);
  }

  print(): void {
    // Make sure the console.log is not removed by minification
    const log = console['info'];
    log?.(this.toString());
  }

  get isStructural(): boolean {
    return true;
  }

  get canonical(): BoxedExpression {
    return this;
  }

  get structural(): BoxedExpression {
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

  get numericValue(): number | NumericValue | null {
    return null;
  }

  toNumericValue(): [NumericValue, BoxedExpression] {
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

  get numerator(): BoxedExpression {
    return this;
  }

  get denominator(): BoxedExpression {
    return this.engine.One;
  }

  get numeratorDenominator(): [BoxedExpression, BoxedExpression] {
    return [this, this.engine.One];
  }

  is(other: BoxedExpression | number | bigint | boolean | string): boolean {
    // If the other is a number, the result can only be true if this
    // is a BoxedNumber (the BoxedNumber.is() method will handle it)
    if (typeof other === 'number' || typeof other === 'bigint') return false;

    if (other === null || other === undefined) return false;

    if (typeof other === 'boolean') {
      if (other === true) return this.value?.symbol === 'True';
      if (other === false) return this.value?.symbol === 'False';
      return false;
    }

    if (typeof other === 'string') return this.value?.string === other;

    return same(this, this.engine.box(other));
  }

  isSame(other: BoxedExpression): boolean {
    return same(this, other);
  }

  isEqual(other: number | BoxedExpression): boolean | undefined {
    return eq(this, other);
  }

  isLess(other: number | BoxedExpression): boolean | undefined {
    const c = cmp(this, other);
    if (c === undefined) return undefined;
    return c === '<';
  }

  isLessEqual(other: number | BoxedExpression): boolean | undefined {
    const c = cmp(this, other);
    if (c === undefined) return undefined;
    return c === '<=' || c === '<' || c === '=';
  }

  isGreater(other: number | BoxedExpression): boolean | undefined {
    const c = cmp(this, other);
    if (c === undefined) return undefined;
    return c === '>';
  }

  isGreaterEqual(other: number | BoxedExpression): boolean | undefined {
    const c = cmp(this, other);
    if (c === undefined) return undefined;
    return c === '>=' || c === '>' || c === '=';
  }

  get symbol(): string | null {
    return null;
  }

  get tensor(): null | Tensor<any> {
    return null;
  }

  get string(): string | null {
    return null;
  }

  getSubexpressions(operator: MathJsonSymbol): ReadonlyArray<BoxedExpression> {
    return getSubexpressions(this, operator);
  }

  get subexpressions(): ReadonlyArray<BoxedExpression> {
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

  get errors(): ReadonlyArray<BoxedExpression> {
    return this.getSubexpressions('Error');
  }

  get isFunctionExpression(): boolean {
    return false;
  }

  // Only return non-null for functions
  get ops(): null | ReadonlyArray<BoxedExpression> {
    return null;
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

  get op1(): BoxedExpression {
    return this.engine.Nothing;
  }

  get op2(): BoxedExpression {
    return this.engine.Nothing;
  }

  get op3(): BoxedExpression {
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
    _vars?:
      | Iterable<string>
      | string
      | BoxedExpression
      | Iterable<BoxedExpression>
  ):
    | null
    | ReadonlyArray<BoxedExpression>
    | Record<string, BoxedExpression>
    | Array<Record<string, BoxedExpression>> {
    return null;
  }

  replace(_rules: BoxedRuleSet | Rule | Rule[]): null | BoxedExpression {
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

  infer(t: Type, inferenceMode?: 'narrow' | 'widen'): boolean {
    return false; // The inference was ignored if false
  }

  bind(): void {
    return;
  }

  reset(): void {
    return;
  }

  get value(): BoxedExpression | undefined {
    return undefined;
  }

  set value(_value: any) {
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

  simplify(_options?: Partial<SimplifyOptions>): BoxedExpression {
    return this;
  }

  trigSimplify(): BoxedExpression {
    return this.simplify({ strategy: 'fu' });
  }

  expand(): BoxedExpression {
    // Dynamic import to avoid circular dependency
    const { expand } = require('./expand');
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
    to?: string;
    target?: any; // CompileTarget, but any to avoid circular deps
    operators?:
      | Partial<Record<MathJsonSymbol, [op: string, prec: number]>>
      | ((op: MathJsonSymbol) => [op: string, prec: number] | undefined);
    functions?: Record<MathJsonSymbol, string | ((...any) => any)>;
    vars?: Record<MathJsonSymbol, string>;
    imports?: ((...any) => any)[];
    preamble?: string;
    fallback?: boolean;
  }): ((...args: any[]) => any) & { isCompiled?: boolean } {
    try {
      // eslint-disable-next-line @typescript-eslint/no-this-alias
      const expr = this as BoxedExpression;

      // Determine the target to use
      let languageTarget;

      if (options?.target) {
        // Direct target override - use BaseCompiler
        const { BaseCompiler } = require('../compilation/base-compiler');
        const code = BaseCompiler.compile(expr, options.target);

        // Create a function that returns the compiled code
        const result = function () {
          return code;
        };
        Object.defineProperty(result, 'toString', { value: () => code });
        Object.defineProperty(result, 'isCompiled', { value: true });
        return result as any;
      }

      const targetName = options?.to ?? 'javascript';

      // Look up the target in the registry
      // @ts-ignore - accessing internal property
      languageTarget = this.engine._getCompilationTarget(targetName);

      if (!languageTarget) {
        throw new Error(
          `Compilation target "${targetName}" is not registered. Available targets: ${Array.from(this.engine['_compilationTargets'].keys()).join(', ')}`
        );
      }

      // Use the language target to compile
      return languageTarget.compileToExecutable(expr, {
        operators: options?.operators,
        functions: options?.functions,
        vars: options?.vars,
        imports: options?.imports,
        preamble: options?.preamble,
      });
    } catch (e) {
      // @fixme: the fallback needs to handle multiple arguments
      if (options?.fallback ?? true) {
        console.warn(`Compilation fallback for "${this.operator}": ${(e as Error).message}`);
        // Dynamic import to avoid circular dependency
        const { applicableN1 } = require('../function-utils');
        return applicableN1(this);
      }
      throw e;
    }
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

  contains(_rhs: BoxedExpression): boolean | undefined {
    return undefined;
  }

  subsetOf(_target: BoxedExpression, _strict: boolean): boolean | undefined {
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

  each(): Generator<BoxedExpression> {
    return (function* () {})();
  }

  at(_index: number): BoxedExpression | undefined {
    return undefined;
  }

  get(_key: string | BoxedExpression): BoxedExpression | undefined {
    return undefined;
  }

  indexWhere(
    _predicate: (element: BoxedExpression) => boolean
  ): number | undefined {
    return undefined;
  }
}

export function getSubexpressions(
  expr: BoxedExpression,
  name: MathJsonSymbol
): ReadonlyArray<BoxedExpression> {
  const result = !name || expr.operator === name ? [expr] : [];
  if (expr.ops) {
    for (const op of expr.ops) result.push(...getSubexpressions(op, name));
  }
  return result;
}

/**
 * Return the symbols in the expression, recursively. This does not include
 * the symbols used as operator names, e.g. `Add`, `Sin`, etc...
 *
 */
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
 * An unknown is symbol that is not bound to a value.
 *
 */
function getUnknowns(expr: BoxedExpression, result: Set<string>): void {
  if (expr.symbol) {
    const s = expr.symbol;
    if (s === 'Unknown' || s === 'Undefined' || s === 'Nothing') return;

    if (expr.valueDefinition?.isConstant) return;

    if (expr.operatorDefinition) return;

    const value = expr.engine._getSymbolValue(s);
    if (value === undefined) result.add(s);
    return;
  }

  if (expr.ops) for (const op of expr.ops) getUnknowns(op, result);
}
