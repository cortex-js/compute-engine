import Complex from 'complex.js';
import { Decimal } from 'decimal.js';

import { Expression } from '../../math-json/math-json-format';

import { LatexString } from '../public';
import { Rational } from '../numerics/rationals';
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
import {
  BoxedBaseDefinition,
  BoxedDomain,
  BoxedExpression,
  BoxedFunctionDefinition,
  BoxedRuleSet,
  BoxedSubstitution,
  BoxedSymbolDefinition,
  CanonicalOptions,
  DomainCompatibility,
  DomainLiteral,
  EvaluateOptions,
  IComputeEngine,
  JsonSerializationOptions,
  Metadata,
  PatternMatchOptions,
  Rule,
  RuntimeScope,
  SemiBoxedExpression,
  Substitution,
} from './public';
import { SerializeLatexOptions } from '../latex-syntax/public';
import { asFloat } from './numerics';
import { AsciiMathOptions, toAsciiMath } from './ascii-math';

/**
 * _BoxedExpression
 */

export abstract class _BoxedExpression implements BoxedExpression {
  abstract readonly hash: number;
  abstract readonly json: Expression;
  abstract readonly head: BoxedExpression | string;
  abstract get isCanonical(): boolean;
  abstract set isCanonical(_val: boolean);

  abstract isSame(rhs: BoxedExpression): boolean;
  abstract isEqual(rhs: BoxedExpression): boolean;
  abstract match(
    pattern:
      | Decimal
      | Complex
      | [num: number, denom: number]
      | SemiBoxedExpression
      | BoxedExpression,
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

  /**
   *
   * `Object.valueOf()`: return a JavaScript primitive value for the expression
   *
   * Primitive values are: boolean, number, bigint, string, null, undefined
   *
   */
  valueOf(): number | Object | string | boolean {
    if (this.symbol === 'True') return true;
    if (this.symbol === 'False') return false;
    if (this.symbol === 'NaN') return NaN;
    if (this.symbol === 'PositiveInfinity') return Infinity;
    if (this.symbol === 'NegativeInfinity') return -Infinity;
    if (typeof this.string === 'string') return this.string;
    if (typeof this.symbol === 'string') return this.symbol;
    return asFloat(this) ?? this.toString();
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
    const log = console['log'];
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
      shorthands: ['function', 'symbol', 'string', 'dictionary', 'number'],
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
          'dictionary',
          'number',
        ];
      }
      if (
        (typeof options.metadata === 'string' && options.metadata === 'all') ||
        options.metadata?.includes('all')
      ) {
        defaultOptions.metadata = ['latex', 'wikidata'];
      }
      if (options.fractionalDigits === 'auto')
        defaultOptions.fractionalDigits = -this.engine.precision; // When negative, indicate that the number of digits should be less than the number of whole digits + this value
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

  get scope(): RuntimeScope | null {
    return null;
  }

  /** Object.is() */
  is(rhs: any): boolean {
    if (rhs === null || rhs === undefined) return false;
    return this.isSame(this.engine.box(rhs));
  }

  get canonical(): BoxedExpression {
    return this;
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

  get string(): string | null {
    return null;
  }

  getSubexpressions(head: string): ReadonlyArray<BoxedExpression> {
    return getSubexpressions(this, head);
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

  get nops(): number {
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

  get isExact(): boolean {
    return false;
  }

  /** For a symbol, true if the symbol is a constant (unchangeable value) */
  get isConstant(): boolean {
    return false;
  }

  get isNaN(): boolean | undefined {
    return undefined;
  }

  get isZero(): boolean | undefined {
    return undefined;
  }

  get isNotZero(): boolean | undefined {
    return undefined;
  }

  get isOne(): boolean | undefined {
    return undefined;
  }

  get isNegativeOne(): boolean | undefined {
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

  get isPrime(): boolean | undefined {
    return undefined;
  }

  get isComposite(): boolean | undefined {
    return undefined;
  }

  get numericValue(): number | Decimal | Complex | Rational | null {
    return null;
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
  add(...rhs: (number | BoxedExpression)[]): BoxedExpression {
    return this.engine.NaN;
  }
  sub(rhs: BoxedExpression): BoxedExpression {
    return this.engine.NaN;
  }
  mul(...rhs: (number | BoxedExpression)[]): BoxedExpression {
    return this.engine.NaN;
  }
  div(rhs: BoxedExpression): BoxedExpression {
    return this.engine.NaN;
  }
  pow(exp: number | BoxedExpression): BoxedExpression {
    return this.engine.NaN;
  }
  sqrt(): BoxedExpression {
    return this.engine.NaN;
  }
  // root(exp: number | BoxedExpression): BoxedExpression {
  //   return this.engine.NaN;
  // }
  // log(base?: SemiBoxedExpression): BoxedExpression;
  // exp(): BoxedExpression;

  get sgn(): -1 | 0 | 1 | undefined | null {
    return null;
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
    const canonical = options?.canonical ?? true;
    const recursive = options?.recursive ?? true;
    if (!recursive)
      return fn(
        this.engine.function(
          this.head,
          this.ops.map((x) => fn(x)),
          {
            canonical,
          }
        )
      );
    return fn(
      this.engine.function(
        this.head,
        this.ops.map((x) => x.map(fn, options)),
        {
          canonical,
        }
      )
    );
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

  isLess(_rhs: BoxedExpression): boolean | undefined {
    return undefined;
  }

  isLessEqual(_rhs: BoxedExpression): boolean | undefined {
    return undefined;
  }

  isGreater(_rhs: BoxedExpression): boolean | undefined {
    return undefined;
  }

  isGreaterEqual(_rhs: BoxedExpression): boolean | undefined {
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
  //
  //
  //
  //

  isCompatible(
    _dom: BoxedDomain | DomainLiteral,
    _kind?: DomainCompatibility
  ): boolean {
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

  get symbolDefinition(): BoxedSymbolDefinition | undefined {
    return undefined;
  }

  get functionDefinition(): BoxedFunctionDefinition | undefined {
    return undefined;
  }

  infer(_domain: BoxedDomain): boolean {
    return false; // The inference was ignored if false
  }

  bind(): void {
    return;
  }

  reset(): void {
    return;
  }

  get keys(): IterableIterator<string> | null {
    return null;
  }
  get keysCount() {
    return 0;
  }
  getKey(_key: string): BoxedExpression | undefined {
    return undefined;
  }
  hasKey(_key: string): boolean {
    return false;
  }

  get value(): number | boolean | string | object | undefined {
    return this.N().valueOf();
  }

  set value(
    _value: BoxedExpression | number | boolean | string | number[] | undefined
  ) {
    throw new Error(`Can't change the value of \\(${this.latex}\\)`);
  }

  get domain(): BoxedDomain | undefined {
    return undefined;
  }
  set domain(_domain: BoxedDomain) {
    throw new Error(`Can't change the domain of \\(${this.latex}\\)`);
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

  get isAlgebraic(): boolean | undefined {
    return false;
  }

  get isReal(): boolean | undefined {
    return undefined;
  }

  // Real or +-Infinity
  get isExtendedReal(): boolean | undefined {
    return undefined;
  }

  get isComplex(): boolean | undefined {
    return undefined;
  }

  get isImaginary(): boolean | undefined {
    return undefined;
  }

  get isExtendedComplex(): boolean | undefined {
    return undefined;
  }

  simplify(): BoxedExpression {
    return this;
  }

  evaluate(_options?: Partial<EvaluateOptions>): BoxedExpression {
    return this.simplify();
  }

  N(): BoxedExpression {
    return this.evaluate({ numericMode: true });
  }

  compile(
    to = 'javascript',
    options?: { optimize: ('simplify' | 'evaluate')[] }
  ): ((args: Record<string, any>) => any | undefined) | undefined {
    if (to !== 'javascript') return undefined;
    options ??= { optimize: ['simplify'] };
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    let expr = this as BoxedExpression;
    if (options.optimize.includes('simplify')) expr = expr.simplify();
    if (options.optimize.includes('evaluate')) expr = expr.evaluate();
    // try {
    return compileToJavascript(expr);
    // } catch (e) {}
    // return undefined;
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

  if (expr.head === 'Block') {
  }

  if (expr.symbol) {
    const def = expr.engine.lookupSymbol(expr.symbol);
    if (def && def.value !== undefined) return;

    const fnDef = expr.engine.lookupFunction(expr.symbol);
    if (fnDef && (fnDef.signature.evaluate || fnDef.signature.N)) return;

    result.add(expr.symbol);
    return;
  }

  if (expr.head && typeof expr.head !== 'string')
    getFreeVariables(expr.head, result);

  if (expr.ops) for (const op of expr.ops) getFreeVariables(op, result);

  if (expr.keys)
    for (const key of expr.keys) getFreeVariables(expr.getKey(key)!, result);
}

function getSymbols(expr: BoxedExpression, result: Set<string>): void {
  if (expr.symbol) {
    result.add(expr.symbol);
    return;
  }

  if (expr.head && typeof expr.head !== 'string') getSymbols(expr.head, result);

  if (expr.ops) for (const op of expr.ops) getSymbols(op, result);

  if (expr.keys)
    for (const key of expr.keys) getSymbols(expr.getKey(key)!, result);
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
    if (fnDef && (fnDef.signature.evaluate || fnDef.signature.N)) return;

    result.add(s);
    return;
  }

  if (expr.head && typeof expr.head !== 'string')
    getUnknowns(expr.head, result);

  if (expr.ops) for (const op of expr.ops) getUnknowns(op, result);

  if (expr.keys)
    for (const key of expr.keys) getUnknowns(expr.getKey(key)!, result);
}

export function getSubexpressions(
  expr: BoxedExpression,
  head: string
): ReadonlyArray<BoxedExpression> {
  const result = !head || expr.head === head ? [expr] : [];
  if (expr.ops) {
    for (const op of expr.ops) result.push(...getSubexpressions(op, head));
  } else if (expr.keys) {
    for (const op of expr.keys)
      result.push(...getSubexpressions(expr.getKey(op)!, head));
  }
  return result;
}

// To avoid circular dependency issues we have to import the following
// function *after* the class definition

import { serializeJson } from './serialize';
