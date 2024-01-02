import { Complex } from 'complex.js';
import { Decimal } from 'decimal.js';

import { Expression } from '../../math-json/math-json-format';

import {
  BoxedExpression,
  BoxedFunctionDefinition,
  BoxedRuleSet,
  BoxedSymbolDefinition,
  BoxedDomain,
  EvaluateOptions,
  IComputeEngine,
  LatexString,
  Metadata,
  NOptions,
  PatternMatchOptions,
  SimplifyOptions,
  Substitution,
  RuntimeScope,
  DomainCompatibility,
  DomainLiteral,
  BoxedBaseDefinition,
  Rational,
  BoxedSubstitution,
} from '../public';
import { isBigRational, isMachineRational } from '../numerics/rationals';
import { asFloat } from '../numerics/numeric';
import { compileToJavascript } from '../compile';

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
    rhs: BoxedExpression,
    options?: PatternMatchOptions
  ): BoxedSubstitution | null;

  readonly engine: IComputeEngine;

  /** Verbatim LaTeX, obtained from a source, i.e. from parsing,
   *  not generated synthetically
   */
  protected _latex?: string;

  constructor(ce: IComputeEngine, metadata?: Metadata) {
    this.engine = ce;
    if (metadata?.latex !== undefined) this._latex = metadata.latex;
  }

  /**
   *
   * `Object.valueOf()`: return a JavaScript primitive value for the expression
   *
   */
  valueOf(): number | any[] | string | boolean {
    if (this.symbol === 'True') return true;
    if (this.symbol === 'False') return false;
    if (
      this.head &&
      typeof this.head === 'string' &&
      ['List', 'Set', 'Sequence', 'Tuple', 'Pair', 'Single', 'Triple'].includes(
        this.head
      )
    ) {
      return this.ops?.map((x) => x.valueOf()) as any[];
    }
    return (
      asFloat(this) ?? this.string ?? this.symbol ?? JSON.stringify(this.json)
    );
  }

  /** Object.toString() */
  toString(): string {
    if (this.symbol) return this.symbol;
    if (this.string) return `"${this.string}"`;
    const num = this.numericValue;
    if (num !== null) {
      if (typeof num === 'number') return num.toString();
      if (num instanceof Decimal) return num.toString();
      if (isMachineRational(num))
        return `(${num[0].toString()}/${num[1].toString()})`;
      if (isBigRational(num))
        return `(${num[0].toString()}/${num[1].toString()})`;
      if (num instanceof Complex) {
        const im = num.im === 1 ? '' : num.im === -1 ? '-' : num.im.toString();
        if (num.re === 0) return im + 'i';
        if (num.im < 0) return `${num.re.toString()}${im}i`;
        return `(${num.re.toString()}+${im}i)`;
      }
    }

    if (this.head && typeof this.head === 'string') {
      if (this.head === 'List')
        return `[${this.ops?.map((x) => x.toString())}]`;
      if (this.head === 'Domain') return JSON.stringify(this.json);
      return `${this.head}(${this.ops?.map((x) => x.toString()).join(', ')})`;
    }

    return JSON.stringify(this.json);
  }

  print(): void {
    console.log(this.toString());
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

  /** Called by `JSON.stringify()` when serializing to json */
  toJSON(): Expression {
    return this.json;
  }

  /** @internal */
  get rawJson(): Expression {
    return this.json;
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
    return this._latex ?? this.engine.serialize(this);
  }

  set latex(val: LatexString) {
    this._latex = val;
  }

  get symbol(): string | null {
    return null;
  }

  get isNothing(): boolean {
    return false;
  }

  get string(): string | null {
    return null;
  }

  getSubexpressions(head: string): BoxedExpression[] {
    return getSubexpressions(this, head);
  }

  get subexpressions(): BoxedExpression[] {
    return this.getSubexpressions('');
  }

  get symbols(): string[] {
    const set = new Set<string>();
    getSymbols(this, set);
    return Array.from(set);
  }

  get unknowns(): string[] {
    const set = new Set<string>();
    getUnknowns(this, set);
    return Array.from(set);
  }

  get freeVariables(): string[] {
    const set = new Set<string>();
    getFreeVariables(this, set);
    return Array.from(set);
  }

  get errors(): BoxedExpression[] {
    return this.getSubexpressions('Error');
  }

  // Only return non-null for functions
  get ops(): null | BoxedExpression[] {
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

  get sgn(): -1 | 0 | 1 | undefined | null {
    return null;
  }

  get shape(): number[] {
    return [];
  }

  get rank(): number {
    return 0;
  }

  subs(_sub: Substitution, options?: { canonical: boolean }): BoxedExpression {
    if (options?.canonical) return this.canonical;
    return this;
  }

  solve(_vars: Iterable<string>): null | BoxedExpression[] {
    return null;
  }

  replace(_rules: BoxedRuleSet): null | BoxedExpression {
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

  get value(): number | boolean | string | number[] | undefined {
    return this.N().valueOf();
  }

  set value(
    _value: BoxedExpression | number | boolean | string | number[] | undefined
  ) {
    throw new Error(`Can't change the value of \\(${this.latex}\\)`);
  }

  // @ts-ignore
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

  simplify(_options?: SimplifyOptions): BoxedExpression {
    return this;
  }

  evaluate(_options?: EvaluateOptions): BoxedExpression {
    return this.simplify();
  }

  N(_options?: NOptions): BoxedExpression {
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
): BoxedExpression[] {
  const result = !head || expr.head === head ? [expr] : [];
  if (expr.ops) {
    for (const op of expr.ops) result.push(...getSubexpressions(op, head));
  } else if (expr.keys) {
    for (const op of expr.keys)
      result.push(...getSubexpressions(expr.getKey(op)!, head));
  }
  return result;
}
