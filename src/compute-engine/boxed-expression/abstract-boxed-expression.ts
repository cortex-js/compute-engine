import { BigDecimal } from '../../big-decimal/index.js';

import type {
  MathJsonExpression,
  MathJsonSymbol,
} from '../../math-json/types.js';

// To avoid circular dependency issues we have to import the following
// function *after* the class definition

import type { Type, TypeString } from '../../common/type/types.js';
import { BoxedType } from '../../common/type/boxed-type.js';

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
  ExplainOperation,
  ExplainOptions,
  Explanation,
  ExplainStep,
  IComputeEngine as ComputeEngine,
  Scope,
  Tensor,
  TensorDataType,
  ParseDiagnostic,
} from '../global-types.js';

import type { NumericValue } from '../numeric-value/types.js';
import type { SmallInteger } from '../numerics/types.js';

import { toAsciiMath } from './ascii-math.js';
// Dynamic import for serializeJson to avoid circular dependency
import { cmp, eq, same } from './compare.js';
import { CancellationError } from '../../common/interruptible.js';
import { isSymbol, isString, isNumber, isFunction } from './type-guards.js';
import { extractIntervalBounds } from './inequality-bounds.js';
import { labelFor } from './explain-labels.js';

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
export function _setGetPolynomialCoefficients(fn: GetPolynomialCoefficientsFn) {
  _getPolynomialCoefficients = fn;
}

// Lazy reference to break circular dependency for polynomialDegree
type GetPolynomialDegreeFn = (expr: Expression, variable: string) => number;
let _getPolynomialDegree: GetPolynomialDegreeFn;
/** @internal */
export function _setGetPolynomialDegree(fn: GetPolynomialDegreeFn) {
  _getPolynomialDegree = fn;
}

// Lazy reference to break circular dependency for findUnivariateRoots
type FindUnivariateRootsFn = (
  expr: Expression,
  variable: string
) => ReadonlyArray<Expression>;
let _findUnivariateRoots: FindUnivariateRootsFn;
/** @internal */
export function _setFindUnivariateRoots(fn: FindUnivariateRootsFn) {
  _findUnivariateRoots = fn;
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
  readonly sourceOffsets?: [start: number, end: number];

  /**
   * Opt-in parse-time diagnostics, attached by `ce.parse(…, {
   * diagnostics: true })` to the top-level result only. `undefined` otherwise.
   * See {@link ParseDiagnostic}.
   */
  parseDiagnostics?: ReadonlyArray<ParseDiagnostic>;

  /**
   * @internal
   * Return an instance safe to annotate with top-level parse metadata
   * (`parseDiagnostics`) without mutating a shared/interned expression.
   *
   * Function expressions are always freshly constructed, so the base
   * implementation returns `this`. Interned leaf literals (small integers,
   * cached constants) override this to return a fresh copy so that tagging the
   * result of `ce.parse('4', { diagnostics: true })` never pollutes the shared
   * `4` returned elsewhere.
   */
  _unshared(): _BoxedExpression {
    return this;
  }

  constructor(ce: ComputeEngine, metadata?: Metadata) {
    this.engine = ce;
    if (metadata?.latex !== undefined) this.verbatimLatex = metadata.latex;
    if (metadata?.sourceOffsets !== undefined)
      this.sourceOffsets = metadata.sourceOffsets;
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
      if (e instanceof Error && e.message) return e.message;
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
      if (e instanceof Error && e.message) return e.message;
      return '<error>';
    }
  }

  /**
   * Return a LaTeX representation of this expression.
   *
   * This is a convenience getter that delegates to the standalone
   * `serialize()` function from the `latex-syntax` module.
   *
   * Uses `toMathJson()` (not `.json`) so that the serialized form
   * reflects the canonical/simplified structure, matching the behavior
   * of the engine-based serializer.
   *
   * Numeric values are rounded to `ce.precision` significant digits
   * (via `fractionalDigits: 'auto'`). This ensures that noise digits
   * from precision-bounded operations are not displayed.
   */
  get latex(): string {
    // Materialize lazy collections before serializing
    if (this.isLazyCollection) {
      const materialized = this.evaluate({ materialization: true });
      if (!materialized.isLazyCollection) return materialized.latex;
    }
    const syntax = this.engine._requireLatexSyntax();
    const json = this.toMathJson({ prettify: true, fractionalDigits: 'auto' });
    const latexOpts = this.engine.latexOptions;
    if (Object.keys(latexOpts).length === 0) return syntax.serialize(json);
    return syntax.serialize(json, { ...latexOpts });
  }

  /**
   * Return a LaTeX representation of this expression with custom
   * serialization options.
   *
   * This delegates to `LatexSyntax.serialize()` with the provided options.
   * Uses `toMathJson()` to get the canonical/simplified form.
   *
   * Numeric values are rounded to `ce.precision` significant digits
   * (via `fractionalDigits: 'auto'`).
   *
   * If `options.verbatim` is `true` and `verbatimLatex` is set on this
   * expression (i.e. it was parsed with `preserveLatex: true`), return
   * the verbatim source instead of re-serializing. Falls through to
   * re-serialization if no verbatim is available.
   */
  toLatex(options?: Record<string, any>): string {
    if (options?.verbatim === true && this.verbatimLatex !== undefined)
      return this.verbatimLatex;

    // Materialize lazy collections before serializing
    if (this.isLazyCollection) {
      const materialized = this.evaluate({
        materialization: options?.materialization ?? true,
      });
      if (!materialized.isLazyCollection) return materialized.toLatex(options);
    }

    // Round numbers at the MathJSON (kernel) layer so the LaTeX layer only
    // lays out the already-rounded digits (it must not re-crop). When the
    // caller supplies `digits`, thread it through; otherwise default to
    // `'auto'` (round to engine precision), matching prior behavior.
    const json = this.toMathJson(
      options?.digits !== undefined
        ? { prettify: options?.prettify ?? true, digits: options.digits }
        : { prettify: options?.prettify ?? true, fractionalDigits: 'auto' }
    );

    const syntax = this.engine._requireLatexSyntax();
    const latexOpts = this.engine.latexOptions;
    const haveEngineOpts = Object.keys(latexOpts).length > 0;
    const haveCallOpts = options && Object.keys(options).length > 0;

    if (!haveEngineOpts && !haveCallOpts) return syntax.serialize(json);
    if (!haveEngineOpts) return syntax.serialize(json, options);
    if (!haveCallOpts) return syntax.serialize(json, { ...latexOpts });
    return syntax.serialize(json, { ...latexOpts, ...options });
  }

  /** Called by `JSON.stringify()` when serializing to json.
   *
   * Note: this is a standard method of JavaScript objects.
   *
   * Returns the full raw value with no precision rounding, identical to
   * `.json`. This preserves data fidelity for lossless round-tripping.
   * For precision-rounded MathJSON, use
   * `toMathJson({ fractionalDigits: 'auto' })`.
   */
  toJSON(): MathJsonExpression {
    return this.json;
  }

  /**
   * Serialize to MathJSON with configurable options.
   *
   * The `fractionalDigits` option controls how many digits are emitted
   * for arbitrary-precision numbers:
   * - `'max'` (default): all available digits, no rounding
   * - `'auto'`: round to `ce.precision` significant digits
   * - `n` (number >= 0): exactly `n` digits after the decimal point
   *
   * Internally, `'auto'` is converted to `-ce.precision` to signal
   * total significant digits (negative value) to the serializer.
   */
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
      } else if (Array.isArray(options.shorthands)) {
        defaultOptions.shorthands = options.shorthands;
      }
      if (
        (typeof options.metadata === 'string' && options.metadata === 'all') ||
        options.metadata?.includes('all')
      ) {
        defaultOptions.metadata = ['latex', 'wikidata', 'sourceOffsets'];
      } else if (Array.isArray(options.metadata)) {
        defaultOptions.metadata = options.metadata;
      }
      if (options.fractionalDigits === 'auto')
        defaultOptions.fractionalDigits = -this.engine.precision; // When negative, indicate that the number of digits should be less than the number of whole digits + this value
      if (typeof options.fractionalDigits === 'number')
        defaultOptions.fractionalDigits = options.fractionalDigits;

      // Resolve the number-display control. The current `digits` option takes
      // precedence over the deprecated `fractionalDigits`.
      if (options.digits !== undefined) {
        if (options.fractionalDigits !== undefined)
          console.warn(
            '`digits` and `fractionalDigits` were both specified; `digits` takes precedence. `fractionalDigits` is deprecated — use `digits` instead.'
          );
        defaultOptions.digits = options.digits;
      } else if (options.fractionalDigits === 'auto') {
        defaultOptions.digits = 'auto';
      } else if (options.fractionalDigits === 'max') {
        defaultOptions.digits = 'max';
      } else if (typeof options.fractionalDigits === 'number') {
        defaultOptions.digits =
          options.fractionalDigits < 0
            ? { significant: -options.fractionalDigits }
            : { fractional: options.fractionalDigits };
      }
    }
    const opts: JsonSerializationOptions = {
      ...defaultOptions,
      ...options,
      digits: defaultOptions.digits,
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

  get bignumRe(): BigDecimal | undefined {
    return undefined;
  }

  get bignumIm(): BigDecimal | undefined {
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
    variable?: string | string[]
  ): ReadonlyArray<Expression> | undefined {
    let vars: string[];

    if (variable === undefined) {
      const unknowns = this.unknowns;
      if (unknowns.length !== 1) return undefined;
      vars = [unknowns[0]];
    } else if (typeof variable === 'string') {
      vars = [variable];
    } else {
      if (variable.length === 0) return undefined;
      vars = variable;
    }

    // Validate polynomial in all variables
    for (const v of vars) {
      if (_getPolynomialDegree(this, v) < 0) return undefined;
    }

    // Decompose by the first variable
    const coeffs = _getPolynomialCoefficients(this, vars[0]);
    if (coeffs === null) return undefined;
    return coeffs.reverse();
  }

  polynomialRoots(variable?: string): ReadonlyArray<Expression> | undefined {
    if (variable === undefined) {
      const unknowns = this.unknowns;
      if (unknowns.length !== 1) return undefined;
      variable = unknowns[0];
    }

    // Check it's a polynomial first
    if (_getPolynomialDegree(this, variable) < 0) return undefined;

    return _findUnivariateRoots(this, variable);
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

    // Follow the *other* side's symbol binding, mirroring `BoxedSymbol.is`.
    // Without this, `.is()` is asymmetric for expression-valued bindings:
    // with `g := x²+1`, `g.is(x²+1)` is `true` (BoxedSymbol.is follows `g`'s
    // value) but `(x²+1).is(g)` would bail at the free-variable check below.
    // Recursing on `other.value` restores the documented symmetry.
    if (other instanceof _BoxedExpression && isSymbol(other)) {
      const otherVal = other.value;
      if (otherVal && otherVal !== (other as unknown))
        return this.is(otherVal, tolerance);
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

  // `cmp()` may return a weak/indeterminate relation (`'<='` or `'>='`, e.g.
  // from an assumption like `x >= 3`). A strict or opposite predicate that the
  // weak relation does not resolve must return `undefined`, not a definitive
  // `false` — these predicates feed sign inference throughout the engine.
  isLess(other: number | Expression): boolean | undefined {
    const c = cmp(this, other);
    if (c === '<') return true;
    if (c === '>' || c === '>=' || c === '=') return false;
    return undefined; // '<=' or undefined: strictness unknown
  }

  isLessEqual(other: number | Expression): boolean | undefined {
    const c = cmp(this, other);
    if (c === '<' || c === '<=' || c === '=') return true;
    if (c === '>') return false;
    return undefined; // '>=' or undefined
  }

  isGreater(other: number | Expression): boolean | undefined {
    const c = cmp(this, other);
    if (c === '>') return true;
    if (c === '<' || c === '<=' || c === '=') return false;
    return undefined; // '>=' or undefined: strictness unknown
  }

  isGreaterEqual(other: number | Expression): boolean | undefined {
    const c = cmp(this, other);
    if (c === '>' || c === '>=' || c === '=') return true;
    if (c === '<') return false;
    return undefined; // '<=' or undefined
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

  get defines(): ReadonlyArray<string> {
    const set = new Set<string>();
    getDefines(this, set);
    return Array.from(set).sort();
  }

  get referencedFunctions(): ReadonlyArray<string> {
    const set = new Set<string>();
    getReferencedFunctions(this, set);
    return Array.from(set).sort();
  }

  get references(): ReadonlyArray<string> {
    const defined = new Set<string>();
    getDefines(this, defined);
    const set = new Set<string>();
    getReferences(this, set, set);
    const result: string[] = [];
    for (const s of set) if (!defined.has(s)) result.push(s);
    return result.sort();
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

  get constantValue(): number | boolean | string | object | undefined {
    return this.isConstant ? this.value : undefined;
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

  get isFunction(): boolean | undefined {
    const t = this.type;
    if (t.isUnknown) return undefined;
    return t.matches('function');
  }

  toSignedFunction(): Expression | undefined {
    const op = this.operator;
    if (op === undefined || this.ops === undefined || this.ops.length < 2) {
      return undefined;
    }
    const [lhs, rhs] = this.ops;
    const engine = this.engine;
    switch (op) {
      case 'Equal':
      case 'NotEqual':
      case 'Less':
      case 'LessEqual':
        return engine.function('Subtract', [lhs, rhs]);
      case 'Greater':
      case 'GreaterEqual':
        return engine.function('Subtract', [rhs, lhs]);
      default:
        return undefined;
    }
  }

  getInterval(symbol: string) {
    return extractIntervalBounds(this, symbol);
  }

  simplify(_options?: Partial<SimplifyOptions>): Expression {
    return this;
  }

  // Trivial default for expressions with no simplification machinery
  // (strings, dictionaries). Subclasses with a real trace (functions,
  // symbols, numbers, tensors) override this with `explainExpression()`,
  // which this base class cannot import (it would recreate the
  // abstract-boxed-expression → rules → box circular dependency).
  explain(operation?: ExplainOperation, options?: ExplainOptions): Explanation {
    operation ??= 'simplify';
    if (operation !== 'simplify') {
      throw new Error(
        `explain("${operation}") is not supported here: use "simplify", "solve", "D" or "Integrate" on a function expression`
      );
    }
    const initial = this.canonical;
    const result = this.simplify(options);
    const steps: ExplainStep[] = [];
    if (!result.isSame(initial)) {
      const { id, description } = labelFor('simplify-terms');
      steps.push({ value: result, id, description });
    }
    return { operation, initial, result, steps };
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
  getReferences(expr, result, new Set<string>());
}

/**
 * Return the applied user functions in the expression, recursively. See
 * {@link getReferences} for the shared traversal and scoping rules.
 */
function getReferencedFunctions(expr: Expression, result: Set<string>): void {
  getReferences(expr, new Set<string>(), result);
}

/**
 * Is `head` (the operator of a function application) a *user-definable*
 * function reference, as opposed to a built-in operator, a constant, or a
 * name already bound to a value?
 *
 * Mirrors the free-variable predicate used for ordinary symbols in
 * {@link getReferences}, but for the operator head (which is a bare string,
 * not a boxed symbol). The def-kind checks are inlined rather than using the
 * `isValueDef`/`isOperatorDef` guards from `./utils` to avoid an import cycle
 * (`utils` imports this module).
 */
function isReferencedFunctionHead(
  engine: ComputeEngine,
  head: string
): boolean {
  if (head === 'Unknown' || head === 'Undefined' || head === 'Nothing')
    return false;

  const def = engine.lookupDefinition(head);
  if (def !== undefined) {
    // A built-in or explicitly-declared operator (`Add`, `Sin`, …).
    if ('operator' in def) return false;
    // A constant value (`Pi`, `ExponentialE`, …).
    if ('value' in def && def.value.isConstant) return false;
  }

  // A name already bound to a value is resolved, not a free reference.
  if (engine._getSymbolValue(head) !== undefined) return false;

  return true;
}

/**
 * Shared traversal that collects, in a single pass, both the free variables
 * (operand symbols not bound to a value or by an enclosing scope) into
 * `freeVars` and the applied user functions (operator heads) into `refFns`.
 *
 * The two are kept in separate sets so {@link getUnknowns} /
 * `freeVariables` stay unchanged while {@link getReferencedFunctions} can
 * recover the operator-head edges. Both sets are subject to the same scoping
 * rules (`Function` parameters, `Sum`/`Product`/`Integrate` index variables,
 * `Block` locals). Passing the same set for both arguments yields their union
 * (used by the `references` accessor).
 */
function getReferences(
  expr: Expression,
  freeVars: Set<string>,
  refFns: Set<string>
): void {
  if (isSymbol(expr)) {
    const s = expr.symbol;
    if (s === 'Unknown' || s === 'Undefined' || s === 'Nothing') return;

    if (expr.valueDefinition?.isConstant) return;

    if (expr.operatorDefinition) return;

    const value = expr.engine._getSymbolValue(s);
    if (value === undefined) freeVars.add(s);
    return;
  }

  if (!isFunction(expr)) return;

  // The operator head is an applied user function when it passes the same
  // predicate a free variable would. It is referenced at *this* level, so it
  // is added directly (an enclosing binder filters it via the inner-set
  // threading below, exactly like a free variable).
  if (isReferencedFunctionHead(expr.engine, expr.operator))
    refFns.add(expr.operator);

  // A `Function` literal `["Function", body, ...params]` binds its trailing
  // operands (the parameters) in the body. Recurse into the body and drop the
  // parameters. (Previously the parameters leaked, e.g. the `x` of
  // `["Function", body, "x"]`.)
  if (expr.operator === 'Function') {
    const ops = expr.ops;
    const params = new Set<string>();
    for (let i = 1; i < ops.length; i++) {
      const p = ops[i];
      if (isSymbol(p)) params.add(p.symbol);
    }
    const innerFree = new Set<string>();
    const innerRef = new Set<string>();
    if (ops.length > 0) getReferences(ops[0], innerFree, innerRef);
    for (const s of innerFree) if (!params.has(s)) freeVars.add(s);
    for (const s of innerRef) if (!params.has(s)) refFns.add(s);
    return;
  }

  // Otherwise, collect the variables bound by this expression's structure.
  // This must NOT be gated on `isScoped`: `Integrate` is not scoped yet binds
  // its integration variable.
  //   - index variables — Sum/Product/Integrate: an inner `Limits`/`Element`
  //     carries the index/variable as its first operand.
  //   - local variables — Block: inner `Assign`/`Declare` introduce locals.
  const indexVars = new Set<string>();
  const localVars = new Set<string>();
  for (const op of expr.ops) {
    if (!isFunction(op)) continue;
    if (
      (op.operator === 'Limits' || op.operator === 'Element') &&
      isSymbol(op.op1)
    )
      indexVars.add(op.op1.symbol);
    if (
      (op.operator === 'Assign' || op.operator === 'Declare') &&
      isSymbol(op.op1)
    )
      localVars.add(op.op1.symbol);
  }

  const innerFree = new Set<string>();
  const innerRef = new Set<string>();
  for (const op of expr.ops) {
    // When this expression has index variables (e.g. an `Integrate`), a
    // `Function` operand is the integrand. `Integrate` over-lists *every*
    // referenced symbol as an integrand parameter (not just the integration
    // variable), so its parameter list is unreliable: recurse into the body
    // and rely on the index variables for binding. This keeps a free
    // coefficient (e.g. `a` in `∫ a·sin(x) dx`) reported as free.
    if (
      indexVars.size > 0 &&
      isFunction(op) &&
      op.operator === 'Function' &&
      op.ops.length > 0
    )
      getReferences(op.ops[0], innerFree, innerRef);
    else getReferences(op, innerFree, innerRef);
  }

  if (indexVars.size === 0 && localVars.size === 0) {
    for (const s of innerFree) freeVars.add(s);
    for (const s of innerRef) refFns.add(s);
  } else {
    for (const s of innerFree)
      if (!indexVars.has(s) && !localVars.has(s)) freeVars.add(s);
    for (const s of innerRef)
      if (!indexVars.has(s) && !localVars.has(s)) refFns.add(s);
  }
}

/**
 * Return the symbols **defined** by this expression: the target of a
 * top-level `Assign` or `Declare`, recursing through `Block` sequences.
 *
 * Used by the `defines` accessor. Distinct from {@link getUnknowns}: a
 * definition such as `f(x) := …` *defines* `f` while *referencing* whatever
 * its body uses.
 */
function getDefines(expr: Expression, result: Set<string>): void {
  if (!isFunction(expr)) return;
  const operator = expr.operator;
  if (operator === 'Assign' || operator === 'Declare') {
    if (isSymbol(expr.op1)) result.add(expr.op1.symbol);
    return;
  }
  if (operator === 'Block') for (const op of expr.ops) getDefines(op, result);
}
