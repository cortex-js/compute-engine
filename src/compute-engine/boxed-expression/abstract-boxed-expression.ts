import type { Decimal } from 'decimal.js';
import type { Complex } from 'complex.js';

import { Expression } from '../../math-json/math-json-format';

import {
  BoxedExpression,
  BoxedFunctionDefinition,
  BoxedRuleSet,
  BoxedSymbolDefinition,
  EvaluateOptions,
  IComputeEngine,
  LatexString,
  Metadata,
  NOptions,
  SemiBoxedExpression,
  SimplifyOptions,
  Substitution,
} from '../public';

/**
 * AbstractBoxedExpression
 */

export abstract class AbstractBoxedExpression implements BoxedExpression {
  abstract get json(): Expression;
  abstract get head(): BoxedExpression | string;
  abstract isSame(rhs: BoxedExpression): boolean;
  abstract isEqual(rhs: BoxedExpression): boolean;
  abstract get isCanonical();
  abstract set isCanonical(_val: boolean);

  readonly engine: IComputeEngine;
  /** Authentic LaTeX, obtained from a source, i.e. from parsing, not generated
   * synthetically */
  protected _latex?: string;

  protected _wikidata?: string;

  constructor(ce: IComputeEngine, metadata?: Metadata) {
    this.engine = ce;
    if (metadata?.latex) this._latex = metadata.latex;
    if (metadata?.wikidata) this._wikidata = metadata.wikidata;
  }

  /** Object.toJSON(), called by JSON.Stringify */
  toJSON(): string {
    return JSON.stringify(this.json);
  }
  /** Object.toString() */
  toString(): string {
    return this.latex;
  }
  /** Object.valueOf(): return a primitive value for the object */
  valueOf(): any {
    return this.asFloat ?? this.string ?? this.symbol ?? this.toString();
  }
  /** Object.is() */
  is(rhs: any): boolean {
    return this.isSame(this.engine.box(rhs));
  }

  has(_v: string | string[]): boolean {
    return false;
  }

  get description(): string[] {
    return [];
  }

  get url(): string {
    return '';
  }

  _purge(): undefined {
    return undefined;
  }

  get isPure(): boolean {
    return false;
  }

  get isLiteral(): boolean {
    return false;
  }

  get latex(): LatexString {
    return this._latex ?? this.engine.serialize(this);
  }
  set latex(val: LatexString) {
    this._latex = val;
  }

  get wikidata(): string {
    return this._wikidata ?? '';
  }
  set wikidata(val: string) {
    this._wikidata = val;
  }

  get complexity(): number {
    return 1;
  }

  // Only return non-null for functions
  get ops(): null | BoxedExpression[] {
    return null;
  }

  get nops(): number {
    return 0;
  }

  get op1(): BoxedExpression {
    return this.engine.symbol('Missing');
  }
  get op2(): BoxedExpression {
    return this.engine.symbol('Missing');
  }
  get op3(): BoxedExpression {
    return this.engine.symbol('Missing');
  }

  get symbolDefinition(): BoxedSymbolDefinition | undefined {
    return undefined;
  }

  get functionDefinition(): BoxedFunctionDefinition | undefined {
    return undefined;
  }

  _repairDefinition(): void {
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

  get machineValue(): number | null {
    return this.numericValue?.machineValue ?? null;
  }
  get rationalValue(): [numer: number, denom: number] | [null, null] {
    return this.numericValue?.rationalValue ?? [null, null];
  }
  get decimalValue(): Decimal | null {
    return this.numericValue?.decimalValue ?? null;
  }
  get complexValue(): Complex | null {
    return this.numericValue?.complexValue ?? null;
  }
  get asFloat(): number | null {
    return this.numericValue?.asFloat ?? null;
  }
  get asSmallInteger(): number | null {
    return this.numericValue?.asSmallInteger ?? null;
  }
  get asRational(): [number, number] | [null, null] {
    return this.numericValue?.asRational ?? [null, null];
  }

  get sgn(): -1 | 0 | 1 | undefined | null {
    return this.numericValue?.sgn ?? null;
  }

  get symbol(): string | null {
    return null;
  }

  get isMissing(): boolean {
    return false;
  }

  get value(): BoxedExpression | undefined {
    return this;
  }
  set value(_value: BoxedExpression | undefined) {
    throw new Error(`Can't change the value of \\(${this.latex}\\)`);
  }

  get numericValue(): BoxedExpression | undefined {
    return undefined;
  }

  isSubsetOf(_d: BoxedExpression | string): undefined | boolean {
    return undefined;
  }
  get domain(): BoxedExpression {
    return this.engine.domain('Nothing');
  }
  set domain(_domain: BoxedExpression) {
    throw new Error(`Can't change the domain of \\(${this.latex}\\)`);
  }

  get string(): string | null {
    return null;
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

  get isZero(): boolean | undefined {
    return undefined;
  }
  get isNotZero(): boolean | undefined {
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

  get isInfinity(): boolean | undefined {
    return undefined;
  }

  get isNaN(): boolean | undefined {
    return undefined;
  }

  // Not +- Infinity, not NaN
  get isFinite(): boolean | undefined {
    return undefined;
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

  get isOne(): boolean | undefined {
    return undefined;
  }

  get isNegativeOne(): boolean | undefined {
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

  get canonical(): BoxedExpression {
    return this;
  }

  apply(
    _fn: (x: BoxedExpression) => SemiBoxedExpression,
    _head?: string
  ): BoxedExpression {
    return this;
  }

  evaluate(options?: EvaluateOptions): BoxedExpression {
    return this.simplify(options);
  }

  simplify(_options?: SimplifyOptions): BoxedExpression {
    return this;
  }

  N(_options?: NOptions): BoxedExpression {
    return this;
  }

  replace(_rules: BoxedRuleSet): null | BoxedExpression {
    return null;
  }

  subs(_sub: Substitution): BoxedExpression {
    return this;
  }

  solve(_vars: Iterable<string>): null | BoxedExpression[] {
    return null;
  }
}
