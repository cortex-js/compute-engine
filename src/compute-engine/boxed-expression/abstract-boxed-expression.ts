import { BigDecimal } from '../../big-decimal/index.js';
import { runWithEvaluationEffects } from '../effects-registry.js';

import type {
  MathJsonExpression,
  MathJsonSymbol,
} from '../../math-json/types.js';

// To avoid circular dependency issues we have to import the following
// function *after* the class definition

import type { EffectLabel, Type, TypeString } from '../../common/type/types.js';
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
import {
  cmp,
  eq,
  eqIdentical,
  quantityComparableValue,
  quantityOrder,
  same,
} from './compare.js';
import { CancellationError } from '../../common/interruptible.js';
import {
  isSymbol,
  isString,
  isCharacter,
  isNumber,
  isFunction,
  isDictionary,
  isObject,
} from './type-guards.js';
import { functionLiteralParameterNames } from './function-literal.js';
import { bindingInContext } from './binders.js';
import {
  binderBoundAt,
  declaredBinders,
  ownIndexClauseAt,
  scopeForRebuild,
  type DeclaredBinders,
} from './binding-sites.js';
import { extractIntervalBounds } from './inequality-bounds.js';
import { labelFor } from './explain-labels.js';
import { latexSerializeOptions } from './latex-serialize-options.js';
import { isFiniteCount } from './collection-count.js';
import { recordObjectRead } from './object-deps.js';
import { containsObject } from './object-walk.js';
import { shadowsLibraryName } from '../library-shadowing.js';

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

/**
 * Lazy-collection operator heads whose *operator form* serializes faithfully
 * (i.e. `parse(serialize(x))` is the same expression). For these, the `latex`
 * getter and `toLatex` serialize the operator form directly rather than
 * materializing the collection to a (possibly lossy or corrupt) preview List.
 *
 * Materialization of a lazy collection is lossy in two ways:
 * - it drops the operator identity (a `Map`/`Filter`/`Range` becomes a bare
 *   `List` of values, so `.latex` no longer round-trips), and
 * - when the body can't fully evaluate (a free/undetermined symbol), the
 *   preview leaks unsubstituted lambda bodies (see Tycho item 26), or bakes in
 *   assigned values, both of which corrupt the serialization.
 *
 * `Comprehension` was the original member (Tycho item 22); the rest share the
 * same faithful-operator-form property.
 */
const LATEX_FAITHFUL_LAZY_HEADS = new Set([
  'Comprehension',
  'Map',
  'Filter',
  'Zip',
  'Tabulate',
  'Range',
  'Linspace',
]);

/**
 * The strings of the `latex` getter, by boxed expression (ROADMAP CE-438,
 * Tycho row 444). A boxed expression does not change, but its LaTeX also
 * depends on the engine: the serializer reads definitions, types and
 * assumptions in the current scope (a shadowed library name, a point-list
 * operand, the sign of a term), and the precision and the LaTeX options. A
 * string is reused only while none of these changed:
 *
 * - the engine's cache generation is the same (`_cacheGeneration()`: the
 *   `any` version, which advances on every declaration, assignment,
 *   assumption, inference and configuration change, `precision` included,
 *   with the facts-hidden bit and the key of an active value shield);
 * - the current scope is the same scope object at the same depth of the
 *   context stack (entering an existing scope advances no version);
 * - no shadowed-parameter frame is active (the cache is not used then);
 * - the LaTeX syntax is the same instance with the same dictionary
 *   (`addEntries()` changes the dictionary of the instance in place, and
 *   gives `dictionary` a new array to say so);
 * - the LaTeX options hold the same values, an array option compared by its
 *   elements (the options object and its arrays can be changed in place).
 *
 * An expression that contains a boxed object is not stored: a field of an
 * object can change without any version advancing. A `WeakMap`, so that a
 * box carries no extra field and a dropped box drops its string.
 */
const latexStrings = new WeakMap<
  object,
  {
    latex: string;
    generation: number;
    scope: object;
    depth: number;
    syntax: object;
    dictionary: unknown;
    options: object;
    optionValues: Record<string, unknown>;
  }
>();

/** Whether `v` is a plain object (an object literal), such as the
 * `{ fractional: 2 }` value of the `digits` option. */
function isPlainObject(v: unknown): v is Record<string, unknown> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

/** A copy of the LaTeX options for `sameOptionValues()`. An array value and
 * a plain-object value (`digits: { fractional: 2 }`) are copied one level
 * deep, so that a later change made in place (`digits.fractional = 3`) is
 * seen as a change. */
function snapshotOptionValues(
  options: Record<string, unknown>
): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  for (const key of Object.keys(options)) {
    const v = options[key];
    values[key] = Array.isArray(v) ? [...v] : isPlainObject(v) ? { ...v } : v;
  }
  return values;
}

/** Whether the LaTeX options `options` hold the values `values` (a
 * snapshot from `snapshotOptionValues()`): the same keys, each with the same
 * value, with an array of the same elements, or with a plain object of the
 * same keys and field values. */
function sameOptionValues(
  options: Record<string, unknown>,
  values: Record<string, unknown>
): boolean {
  const keys = Object.keys(options);
  if (keys.length !== Object.keys(values).length) return false;
  for (const key of keys) {
    const a = options[key];
    const b = values[key];
    if (a === b) continue;
    if (Array.isArray(a) && Array.isArray(b)) {
      if (a.length !== b.length || a.some((x, k) => x !== b[k])) return false;
      continue;
    }
    if (isPlainObject(a) && isPlainObject(b)) {
      const aKeys = Object.keys(a);
      if (
        aKeys.length !== Object.keys(b).length ||
        aKeys.some((k) => a[k] !== b[k])
      )
        return false;
      continue;
    }
    return false;
  }
  return true;
}

/**
 * The `repeatingDecimal` option of the MathJSON that the `latex` getter and
 * `toLatex()` give to the LaTeX serializer.
 *
 * In MathJSON, a number string with a repetend in parentheses (`"0.(3)"`) is
 * an exact rational, and the LaTeX serializer writes it with an overline
 * (`0.\overline{3}`), which parses back as an exact rational. A boxed exact
 * rational serializes as `["Rational", 1, 3]`, never as such a string: the
 * string comes only from the digits of a float, when the MathJSON serializer
 * finds a repeating pattern in them. So the pattern search of the MathJSON
 * serializer is on only when the LaTeX `repeatingDecimal` style asks for a
 * repetend mark on a float (`'vinculum'`, `'dots'`, `'parentheses'`,
 * `'arc'`). With `'auto'` (the default) or `'none'`, a float keeps its
 * digits, and a LaTeX round trip keeps it a float.
 */
function jsonRepeatingDecimal(
  ce: ComputeEngine,
  options?: Record<string, any>
): boolean {
  const style =
    options?.repeatingDecimal ?? ce.latexOptions.repeatingDecimal ?? 'auto';
  return style !== 'auto' && style !== 'none';
}

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
 * The preview that `toString()`, the `latex` getter and `toLatex()` (without a
 * `materialization` option) give of a lazy collection: the first 5 and the
 * last 5 elements of a finite indexed collection, with a
 * `ContinuationPlaceholder` between them, or the first 5 elements and a
 * placeholder for any other collection. The `materialization: true` evaluate
 * option is NOT this preview: it asks for every element of a finite
 * collection.
 */
export const DISPLAY_MATERIALIZATION: readonly [number, number] = Object.freeze(
  [5, 5] as const
);

/**
 * _BoxedExpression
 *
 * @internal
 */

export abstract class _BoxedExpression implements Expression {
  readonly _kind: string = 'expression';

  /** Only a number literal carries a handler-visible literal type
   * (`BoxedNumber` overrides this); see the `Expression` interface doc. */
  get _literalType(): Type | undefined {
    return undefined;
  }

  abstract readonly hash: number;
  abstract readonly digest: string;
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

  /** The binding environment captured by a parse with external symbol facts.
   * Rebuilding a function must retain its head's signature as well as the
   * bindings of its operands. Raw nodes remain unbound until rebuilt. */
  _parseScope?: Scope;

  /** Retain bindings on function nodes and unbound descendants. Canonical
   * leaves already carry their bindings and can be shared or interned. */
  _retainParseScope(scope: Scope): void {
    const pending: [Expression, Scope][] = [[this, scope]];
    const seen = new Set<Expression>();
    while (pending.length) {
      const [expr, inherited] = pending.pop()!;
      if (seen.has(expr)) continue;
      seen.add(expr);
      if (!isFunction(expr) && expr.isCanonical) continue;
      const node = expr as _BoxedExpression;
      const captured = node._parseScope ?? inherited;
      node._parseScope = captured;
      if (isFunction(expr)) {
        // A canonical binder's children were bound in its own scope. Keep
        // that scope when an operand is extracted and rebuilt on its own.
        const childScope = expr.localScope ?? captured;
        for (const op of expr.ops) pending.push([op, childScope]);
      }
    }
  }

  /** Rebuild with the expression's retained bindings. @internal */
  _withParseScope(f: () => Expression): Expression {
    const captured = this._parseScope;
    if (!captured) return f();
    // A binder created while rebuilding this expression must retain its own
    // local bindings above the captured environment.
    for (
      let scope: Scope | null = this.engine.context.lexicalScope;
      scope;
      scope = scope.parent
    )
      if (scope === captured) {
        const result = f();
        (result as _BoxedExpression)._retainParseScope(
          this.engine.context.lexicalScope
        );
        return result;
      }
    const result = this.engine._inScope(captured, f);
    (result as _BoxedExpression)._retainParseScope(captured);
    return result;
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
        // Project only a *proven* direction. For an infinity, non-negative
        // implies `+∞` and non-positive implies `-∞` (an infinity cannot be
        // zero, and either predicate implies the value is real).
        if (this.isPositive === true) return Infinity;
        if (this.isNegative === true) return -Infinity;
        if (this.isNonNegative === true) return Infinity;
        if (this.isNonPositive === true) return -Infinity;
        // `~oo` only when the value is provably non-real. Otherwise fall
        // through: a direction-unproven real infinity is not complex infinity.
        if (this.isExtendedReal === false) return '~oo'; // ComplexInfinity
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
      // If this is a lazy collection, we need to force evaluation.
      // Exception: a symbol always serializes as its name — its spelling must
      // not depend on what the name currently holds (Tycho item 100).
      if (this.isLazyCollection && this.symbol === undefined) {
        const materialized = this.evaluate({
          materialization: DISPLAY_MATERIALIZATION,
        });
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
   * Numbers are written with the engine-wide `ce.latexOptions.digits`. When
   * it is not set, they are rounded to `ce.precision` significant digits
   * (`digits: 'auto'`), so that noise digits from precision-bounded
   * operations are not displayed.
   */
  get latex(): string {
    // Materialize lazy collections before serializing.
    // Exception: `Comprehension` has a faithful serializer that round-trips
    // (`body \operatorname{for} x = domain`). Materializing it would replace
    // it with an elided preview List (e.g. `[1, 4, …, 62500]`) that re-parses
    // to a corrupt finite List, so serialize it directly instead.
    // Exception: a symbol always serializes as its name — its spelling must
    // not depend on what the name currently holds (Tycho item 100).
    if (
      this.isLazyCollection &&
      this.symbol === undefined &&
      !LATEX_FAITHFUL_LAZY_HEADS.has(this.operator)
    ) {
      // Materialization EVALUATES, and evaluation can fail on an expression
      // that is nonetheless perfectly printable — a comprehension over an
      // unresolvable binding raises "Condition must evaluate to True or
      // False" from its `Which`, and that would otherwise escape a *formatting*
      // call (Tycho item 168). An unresolvable binding is not a formatting
      // error, so fall through to the symbolic spelling instead: it is exactly
      // what the same expression prints with nothing bound. Callers who want
      // the un-materialized form by contract rather than by fallback should
      // pass `toLatex({ materialization: false })`, which never evaluates.
      // A CancellationError is deliberately NOT swallowed: deadlines are
      // installed only by an enclosing `ce.withTimeLimit()` span, and a caller
      // who set a budget must see it expire rather than get a silently
      // degraded spelling.
      try {
        const materialized = this.evaluate({
          materialization: DISPLAY_MATERIALIZATION,
        });
        if (!materialized.isLazyCollection) return materialized.latex;
      } catch (e) {
        if (e instanceof CancellationError) throw e;
      }
    }
    const ce = this.engine;
    const syntax = ce._requireLatexSyntax();
    const options = ce.latexOptions as Record<string, unknown>;
    const useCache = !ce._hasShadowedParameterFrame();
    const generation = ce._cacheGeneration();
    const scope = ce.context.lexicalScope;
    const depth = ce._evalContextStack.length;
    const cached = useCache ? latexStrings.get(this) : undefined;
    if (
      cached !== undefined &&
      cached.generation === generation &&
      cached.scope === scope &&
      cached.depth === depth &&
      cached.syntax === syntax &&
      cached.dictionary === syntax.dictionary &&
      cached.options === options &&
      sameOptionValues(options, cached.optionValues)
    )
      return cached.latex;
    // The engine-wide `ce.latexOptions.digits` chooses the number of digits;
    // without it, numbers are rounded to the engine precision. The cache
    // check above compares the values of `ce.latexOptions`, so a change of
    // this setting is not served from the cache.
    const jsonOptions: Partial<JsonSerializationOptions> = {
      prettify: true,
      digits: (options.digits as JsonSerializationOptions['digits']) ?? 'auto',
      repeatingDecimal: jsonRepeatingDecimal(ce),
    };
    const json = this.toMathJson(jsonOptions);
    const latex = syntax.serialize(
      json,
      latexSerializeOptions(ce, undefined, this, jsonOptions)
    );
    // The serialization can itself declare or infer, which advances the
    // generation: the string is then not stored, and the next read
    // serializes again.
    if (
      useCache &&
      ce._cacheGeneration() === generation &&
      !containsObject(this)
    )
      latexStrings.set(this, {
        latex,
        generation,
        scope,
        depth,
        syntax,
        dictionary: syntax.dictionary,
        options,
        optionValues: snapshotOptionValues(options),
      });
    return latex;
  }

  /**
   * Return a LaTeX representation of this expression with custom
   * serialization options.
   *
   * This delegates to `LatexSyntax.serialize()` with the provided options.
   * Uses `toMathJson()` to get the canonical/simplified form.
   *
   * Numeric values are rounded to `ce.precision` significant digits
   * (via `digits: 'auto'`) unless `options.digits` says otherwise.
   *
   * If `options.verbatim` is `true` and `verbatimLatex` is set on this
   * expression (i.e. it was parsed with `preserveLatex: true`), return
   * the verbatim source instead of re-serializing. Falls through to
   * re-serialization if no verbatim is available.
   */
  toLatex(options?: Record<string, any>): string {
    if (options?.verbatim === true && this.verbatimLatex !== undefined)
      return this.verbatimLatex;

    // Materialize lazy collections before serializing.
    // Exception: heads with a faithful round-trip serializer (see the `latex`
    // getter above) stay in operator form BY DEFAULT — but an explicitly
    // supplied `materialization` option (documented: `true` materializes all
    // elements, a number bounds the preview) takes precedence over the
    // faithful-head exemption.
    // A symbol always serializes as its name — its spelling must not depend
    // on what the name currently holds (Tycho item 100).
    // `materialization: false` is the by-contract opt-out: the expression is
    // serialized as it stands and NOTHING is evaluated. It used to reach the
    // `evaluate()` call below with the flag set to `false`, which skips the
    // materialization step but still evaluates the operands — for
    // `Join(p)` with `p` bound to an unevaluated chain `m(m(m(p_0)))`, that
    // evaluated the whole chain to print the 18-character `\mathrm{Join}(p)`
    // (Tycho item 247: seconds, then minutes, per serialization).
    const explicitMaterialization = options?.materialization !== undefined;
    if (
      options?.materialization !== false &&
      this.isLazyCollection &&
      this.symbol === undefined &&
      (explicitMaterialization || !LATEX_FAITHFUL_LAZY_HEADS.has(this.operator))
    ) {
      // See the `latex` getter: materialization evaluates, and a printable
      // expression whose evaluation fails must still print (Tycho item 168).
      // A CancellationError still propagates.
      try {
        const materialized = this.evaluate({
          materialization: options?.materialization ?? DISPLAY_MATERIALIZATION,
        });
        if (!materialized.isLazyCollection)
          return materialized.toLatex(options);
      } catch (e) {
        if (e instanceof CancellationError) throw e;
      }
    }

    // Round numbers when they are serialized to MathJSON, where `'auto'` can
    // read the engine precision. The LaTeX serializer receives the same
    // `digits` and rounds a float again, which gives the same digits. The
    // per-call `digits` wins, then the engine-wide `ce.latexOptions.digits`,
    // then `'auto'` (round to the engine precision).
    const jsonOptions: Partial<JsonSerializationOptions> = {
      prettify: options?.prettify ?? true,
      digits: options?.digits ?? this.engine.latexOptions.digits ?? 'auto',
      repeatingDecimal: jsonRepeatingDecimal(this.engine, options),
    };
    const json = this.toMathJson(jsonOptions);

    const syntax = this.engine._requireLatexSyntax();
    return syntax.serialize(
      json,
      latexSerializeOptions(this.engine, options, this, jsonOptions)
    );
  }

  /** Called by `JSON.stringify()` when serializing to json.
   *
   * Note: this is a standard method of JavaScript objects.
   *
   * Returns the full raw value with no precision rounding, identical to
   * `.json`. This preserves data fidelity for lossless round-tripping.
   * For precision-rounded MathJSON, use `toMathJson({ digits: 'auto' })`.
   */
  toJSON(): MathJsonExpression {
    return this.json;
  }

  /**
   * Serialize to MathJSON with configurable options.
   *
   * The `digits` option controls how many digits are emitted for a number
   * (see `DisplayDigits`):
   * - `'max'` (default): all available digits, no rounding
   * - `'auto'`: round to `ce.precision` significant digits
   * - `{ significant: n }`: round to `n` significant digits
   * - `{ fractional: n }`: exactly `n` digits after the decimal point
   *
   * A float keeps its digits by default. With `repeatingDecimal: true`, the
   * repeating digits of a float are written as a repetend (`"0.(3)"`), which
   * `ce.box()` reads back as an exact rational.
   */
  toMathJson(
    options?: Readonly<Partial<JsonSerializationOptions>>
  ): MathJsonExpression {
    const defaultOptions: JsonSerializationOptions = {
      exclude: [],
      shorthands: ['function', 'symbol', 'string', 'number', 'dictionary'],
      metadata: [],
      digits: 'max',
      repeatingDecimal: false,
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
      if (options.digits !== undefined) defaultOptions.digits = options.digits;
    }
    const opts: JsonSerializationOptions = {
      ...defaultOptions,
      ...options,
      digits: defaultOptions.digits,
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

  /** Derived from the effect channel below, so the two views of the same
   * question cannot contradict each other: purity is "this expression fires
   * nothing when evaluated", i.e. an empty computed effect set. Producing an
   * effectful function is not invoking it, which is exactly what the `effects`
   * default encodes. Every concrete subclass overrides this today; the
   * derivation is what keeps a future one honest. */
  get isPure(): boolean {
    return this.effects === undefined;
  }

  /** The default answer for everything that is not an application: evaluating
   * a number, a string or a symbol merely PRODUCES a value, and producing a
   * value fires nothing — even when the value is an effectful function
   * (`docs/EFFECTS-MODEL.md`, worked example 4: the latent set lives on the
   * arrow, reachable as `.type.effects`). `BoxedFunction` overrides this with
   * the projection rule, and `BoxedDictionary` with the union of the effects
   * of its values, which its evaluation evaluates. */
  get effects(): ReadonlyArray<EffectLabel> | 'any' | undefined {
    return undefined;
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

    // Two quantities with units of the same dimension compare by their
    // physical value within the tolerance: `1000 m` is `1 km`. Their unit
    // symbols are free variables, so the check below would answer `false`.
    // A quantity whose unit is dimensionless compares with a number in the
    // same way: `6 percent` is `0.06`, also when `0.06` is a JavaScript
    // number.
    const otherQuantityOperand =
      other instanceof _BoxedExpression
        ? other
        : this.operator === 'Quantity' &&
            (typeof other === 'number' || typeof other === 'bigint')
          ? this.engine.number(other)
          : undefined;
    if (otherQuantityOperand !== undefined) {
      // When one side only is a quantity, the other side can have a number
      // value that is not a number literal as written (`0.05 + 0.01`, a
      // symbol whose value is `0.06`): its value is compared, exact when it
      // has an exact value, as `isEqual()` does
      // (`quantityComparableValue()`). So `6 percent` is `0.05 + 0.01`, in
      // both directions.
      const oneQuantity =
        (this.operator === 'Quantity') !==
        (otherQuantityOperand.operator === 'Quantity');
      const order = quantityOrder(
        oneQuantity ? quantityComparableValue(this) : this,
        oneQuantity
          ? quantityComparableValue(otherQuantityOperand)
          : otherQuantityOperand,
        tolerance ?? this.engine.tolerance,
        false
      );
      if (order !== undefined) return order === 0;
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
      // A value that is not a number (a residue class) has no tolerance:
      // the two values are the same or they are not.
      // `ResidueClass(1, 5) + 1` is `ResidueClass(2, 5)`.
      if (
        nThis.operator === 'ResidueClass' &&
        nOther.operator === 'ResidueClass'
      )
        return nThis.isSame(nOther);
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
      // A CHARACTER answers this too: its content is text, and the string/
      // character bridge in `same()` makes the two kinds equal values whenever
      // their content matches, so the primitive overload must not disagree.
      return isString(val) || isCharacter(val) ? val.string === other : false;
    }
    return same(this, other);
  }

  isEqual(other: number | Expression): boolean | undefined {
    const equal = eq(this, other);
    if (equal !== undefined) return equal;
    // `eq()` reads no bounds. Two assumptions (`b ≥ 0` and `b ≤ 0`) that
    // bound a symbol from both sides at the same number pin it (CE-104).
    // Only a symbol is read: the comparison methods have no meaning for a
    // relation such as `x < 5`. The symbol can be either operand, so that
    // `a.isEqual(b)` and `b.isEqual(a)` agree.
    if (
      this.symbol !== undefined &&
      this.isGreaterEqual(other) === true &&
      this.isLessEqual(other) === true
    )
      return true;
    if (
      typeof other !== 'number' &&
      isSymbol(other) &&
      other.isGreaterEqual(this) === true &&
      other.isLessEqual(this) === true
    )
      return true;
    return undefined;
  }

  isIdenticallyEqual(other: number | Expression): boolean | undefined {
    return eqIdentical(this, other);
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
    getReferences(this, set, set, new Map(), 'references');
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

  /** Only the `Indeterminate` number literal answers `true` (see
   * `BoxedNumber`). */
  get isIndeterminate(): boolean {
    return false;
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
    return this._withParseScope(() => this._mapInParseScope(fn, options));
  }

  private _mapInParseScope(
    fn: (x: Expression) => Expression,
    options?: { canonical: CanonicalOptions; recursive?: boolean }
  ): Expression {
    if (!this.ops) return fn(this);
    // No explicit form request: preserve the receiver's form — canonical
    // stays canonical, structural stays structural, raw stays raw (the same
    // contract as `subs()`; a structural receiver used to fall into the raw
    // arm and come back unbound).
    const structuralForm =
      options?.canonical === undefined &&
      !this.isCanonical &&
      this.isStructural;
    const canonical = options?.canonical ?? this.isCanonical;
    const recursive = options?.recursive ?? true;

    const ops = this.ops.map((x) => (recursive ? x.map(fn, options) : fn(x)));

    // No operand was rewritten and the node is already in the form the
    // rebuild would produce: hand `this` to `fn` instead of reconstructing
    // (and re-canonicalizing) an identical node. (A `CanonicalForm[]` request
    // is a transformation pipeline, not a plain form, so it always rebuilds.)
    if (
      (canonical === true
        ? this.isCanonical
        : structuralForm ||
          (canonical === false && !this.isCanonical && !this.isStructural)) &&
      ops.every((x, i) => x === this.ops![i])
    )
      return fn(this);

    // Rebuilt onto the node's OWN scope — the same rule `subs()` follows, and
    // for the same reason: a scoped node given a fresh scope is parented at
    // the rewriting site, so a binder nested inside it keeps a `parent`
    // pointing at the original outer scope while this node advertises a
    // different one. The chain from the inner body then no longer reaches the
    // outer binder's index, and an index colliding with a library constant
    // resolves to the CONSTANT (`docs/SCOPING-MODEL.md`, "Rebuilding a scoped
    // node"). `scopeForRebuild` withholds the reuse when `fn` renamed the
    // binding site, which would otherwise declare the new name into the
    // original expression's live scope.
    return fn(
      this.engine.function(this.operator, ops, {
        form: structuralForm ? 'structural' : canonical ? 'canonical' : 'raw',
        scope: scopeForRebuild(
          this.localScope,
          this.engine,
          this.operator,
          ops
        ),
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

  _infer(
    _t: () => Type,
    _inferenceMode?: 'narrow' | 'widen' | 'replace'
  ): boolean {
    // The thunk is never called: nothing is inferred here, so the caller's
    // type computation is skipped along with the write it would have fed.
    return false; // The inference was ignored if false
  }

  _bind(): void {
    return;
  }

  _reset(): void {
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

  get isExtendedReal(): boolean | undefined {
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

  // The options are forwarded: a leaf (a number, a symbol, a string) has no
  // asynchronous work of its own, but `numericApproximation` and the other
  // options decide WHAT it evaluates to, and dropping them made
  // `[1/3].evaluateAsync({ numericApproximation: true })` keep the rational
  // where the synchronous route floats it.
  //
  // A symbol reads its value through the current scope, which is the top of
  // the engine's evaluation-context stack. Inside a scoped operator (the
  // index of a `Sum`), an asynchronous evaluation keeps its scopes on its
  // own stack (`EvaluateOptions._contextStack`), so that stack is put in
  // place of the engine's stack while the leaf is evaluated.
  //
  // Inside the window of a `N(x, p)` call with more digits than the engine
  // has (`EvaluateOptions._precisionWindow`), the leaf is evaluated at the
  // working precision: a symbol's `N()` computes the value of a constant at
  // that precision.
  evaluateAsync(options?: Partial<EvaluateOptions>): Promise<Expression> {
    const contextStack = options?._contextStack;
    const window = options?._precisionWindow;
    if (contextStack === undefined && window === undefined)
      return Promise.resolve(this.evaluate(options));
    const engine = this.engine;
    return Promise.resolve(
      runWithEvaluationEffects(
        engine,
        options?._effects ?? engine._evaluationEffects ?? engine.effects,
        () => this.evaluate(options),
        contextStack,
        window
      )
    );
  }

  N(): Expression {
    return this.evaluate({ numericApproximation: true });
  }

  get isCollection(): boolean {
    return false;
  }

  /** The elements as machine numbers, for a `List` whose elements all are
   * machine numbers; `undefined` for every other expression. See
   * `BoxedFunction.array`. */
  get array(): readonly number[] | undefined {
    return undefined;
  }

  /** Whether re-boxing the machine value reproduces this expression,
   * exactness included: `true` for a number that is a float, an integer a
   * double holds, `NaN` or an infinity, and for a `List` of such numbers.
   * `false` for every other expression. See `BoxedFunction.isMachineNumeric` and
   * `BoxedNumber.isMachineNumeric`. */
  get isMachineNumeric(): boolean {
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

  // Base contract: nothing to walk and no declared size to fall back on.
  // Subclasses that CAN answer from a declaration override this — see
  // `BoxedSymbol.count`. The default deliberately stays `undefined` rather
  // than consulting `this.type`: `BoxedFunction` must NOT answer from its
  // type, because an application's collection type can be an artifact of the
  // vacuous lift rather than a promise, and a base class that answered would
  // make that an easily-missed opt-OUT instead of an explicit opt-in.
  get count(): number | bigint | undefined {
    return undefined;
  }

  // These stay gated on `isCollection`, deliberately: a DECLARED size does not
  // make a valueless collection answer them. Much of the library uses
  // `isFiniteCollection === true` as its sole precondition for "I may walk
  // this now" (`Sort`, `Unique`, `Tally`, `Chunk`, `Partition`,
  // `RandomShuffle`, the statistics helpers via `flattenArguments`), so
  // answering `true` for a symbol whose `each()` yields nothing turns those
  // into definite wrong values — an empty walk baked into `[]`, a
  // `(NaN, NaN, NaN)` quartile tuple, or a crash when `at(i)` returns
  // `undefined`. `count` may answer from the type (it is not a walk gate);
  // these two may not until every such caller also consults
  // `isEnumerableCollection`.
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
    return isFiniteCount(count);
  }

  // Base contract: a self-contained collection (a dictionary, a string, a
  // tensor) holds its elements, so a walk of it is faithful; anything that is
  // not a collection has nothing to walk. Subclasses whose elements may be
  // out of reach (a valueless symbol, an operator over symbolic bounds)
  // override this.
  get isEnumerableCollection(): boolean | undefined {
    return this.isCollection;
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

  indexWhere(predicate: (element: Expression) => boolean): number | undefined {
    // Default for any finite indexed collection that does not supply a
    // dedicated `indexWhere` handler (e.g. a shaped `List` tensor): scan
    // the elements and return the 1-based index of the first match, or
    // `undefined` if none. Non-collections keep returning `undefined`.
    if (!this.isIndexedCollection || this.isFiniteCollection !== true)
      return undefined;
    let i = 1;
    for (const x of this.each()) {
      if (predicate(x)) return i;
      i += 1;
    }
    return undefined;
  }
}

/**
 * The subexpressions of `expr` whose operator is `name` (all of them when
 * `name` is empty), `expr` included, in pre-order.
 *
 * The walk continues into the operands of a function expression and into
 * the VALUES of a dictionary (the keys are strings, not expressions).
 *
 * A function expression or a dictionary that is reached several times (a
 * shared operand: a user function applied to its own previous result
 * embeds that result once per mention of the parameter) is listed and
 * walked only the first time. Otherwise the walk is exponential in the
 * nesting depth of the sharing.
 */
export function getSubexpressions(
  expr: Expression,
  name: MathJsonSymbol
): ReadonlyArray<Expression> {
  const result: Expression[] = [];
  collectSubexpressions(expr, name, result, new Set());
  return result;
}

function collectSubexpressions(
  expr: Expression,
  name: MathJsonSymbol,
  result: Expression[],
  visited: Set<Expression>
): void {
  const isNode = isFunction(expr) || isDictionary(expr);
  if (isNode) {
    if (visited.has(expr)) return;
    visited.add(expr);
  }
  if (!name || expr.operator === name) result.push(expr);
  if (isFunction(expr))
    for (const op of expr.ops) collectSubexpressions(op, name, result, visited);
  else if (isDictionary(expr))
    for (const value of expr.values)
      collectSubexpressions(value, name, result, visited);
}

/**
 * True if `root` includes the symbol `v`, or a node whose operator is `v`.
 * When `v` is an array, true if `root` includes any of the names in `v`.
 * This is the body of `has()` for function expressions and dictionaries.
 *
 * A dictionary is a node too: its operator is `Dictionary`, and the walk
 * continues into the VALUES of its entries. The keys are strings, not
 * symbols, so a key never matches.
 *
 * The walk is explicit, with ONE visited set for the function nodes and the
 * dictionaries. It does not ask each operand or value for its own `has()`,
 * because each such call would start a new walk with a new visited set. An
 * expression that shares its operands (a user function applied to its own
 * previous result embeds that result once per mention of the parameter, and
 * a dictionary can hold the same dictionary under several keys) unfolds
 * exponentially in the nesting depth, so each node must be asked once.
 */
export function hasSymbolOrOperator(
  root: Expression,
  v: string | string[]
): boolean {
  const matches =
    typeof v === 'string'
      ? (name: string) => name === v
      : (name: string) => v.includes(name);
  const visited = new Set<Expression>();
  const pending: Expression[] = [root];
  while (pending.length > 0) {
    const e = pending.pop()!;
    if (isFunction(e)) {
      if (visited.has(e)) continue;
      visited.add(e);
      if (matches(e.operator)) return true;
      // A store-backed list has only number operands, which never match a
      // name, so it is not walked (and not boxed).
      if (e._numericStore !== undefined) continue;
      for (const op of e.ops) pending.push(op);
    } else if (isDictionary(e)) {
      if (visited.has(e)) continue;
      visited.add(e);
      if (matches(e.operator)) return true;
      for (const value of e.values) pending.push(value);
    } else if (isObject(e)) {
      // A mutable object is opaque as a node (its operator is a display word
      // that never matches), but its field values are read, as the values of a
      // dictionary are. The visited set also stops a cycle through a field
      // that holds the object itself. (CE-99.2)
      if (visited.has(e)) continue;
      visited.add(e);
      // Reading the fields is an object read: a cached answer derived from
      // this walk must record the object's version, because a store changes
      // the fields without advancing any engine cache generation.
      recordObjectRead(e, e._version);
      for (const value of e._slots.values()) pending.push(value);
    } else if (isSymbol(e)) {
      if (matches(e.symbol)) return true;
    }
  }
  return false;
}

/**
 * Return the symbols in the expression, recursively. This does not include
 * the symbols used as operator names, e.g. `Add`, `Sin`, etc...
 *
 * The values of a dictionary are walked; its keys are strings, not symbols.
 */
function getSymbols(
  expr: Expression,
  result: Set<string>,
  // A subtree reached through several operands contributes the same names
  // each time, so it is walked once (see `getReferences` on why that walk
  // is otherwise exponential on a value that shares its operands).
  visited: Set<Expression> = new Set()
): void {
  if (isSymbol(expr)) {
    result.add(expr.symbol);
    return;
  }

  if (isDictionary(expr)) {
    if (visited.has(expr)) return;
    visited.add(expr);
    for (const value of expr.values) getSymbols(value, result, visited);
    return;
  }

  if (!isFunction(expr) || visited.has(expr)) return;
  visited.add(expr);
  // A store-backed list (`ce.list()`) holds numbers only: no symbol to
  // collect, and walking it would box every element. Other written-out data
  // (a list of numbers and failed cells, `_isLiteralData()`) holds no symbol
  // either.
  if (expr._numericStore !== undefined || expr._isLiteralData()) return;
  for (const op of expr.ops) getSymbols(op, result, visited);
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
 * The memo of `getReferences`: the free variables and the referenced
 * functions of each function node or dictionary already walked. Only `get`
 * and `set` are used, so a `Map` (for one walk) or a `WeakMap` (kept between
 * walks, without keeping the expressions alive) can be one.
 */
export type ReferencesMemo = {
  get(key: Expression): readonly [Set<string>, Set<string>] | undefined;
  set(key: Expression, value: readonly [Set<string>, Set<string>]): unknown;
};

/**
 * Which names the walk of `getReferences` collects. A memo holds the result
 * of one mode only, so a memo is never shared between the two.
 *
 * - `'unknowns'`: the symbols that have no value (`unknowns`,
 *   `freeVariables`). A symbol with a value, or bound to a function
 *   definition, is resolved and not listed. The applied functions are not
 *   collected.
 * - `'references'`: every user name that the expression reads, whether it
 *   has a value or a definition (`references`, `referencedFunctions`): the
 *   in-edges of a dependency graph keyed on cells. A name defined by a
 *   library (`isLibraryDefinition()`), a constant, and a name bound
 *   by the expression itself (a parameter, an index, a `Block` local) are not
 *   listed. (User decision 2026-10-25, option (a) of CE-499 in
 *   `ROADMAP.md`.)
 */
type ReferenceMode = 'unknowns' | 'references';

/**
 * True when `def`, the definition that the name `name` resolves to, was
 * installed by a library and not by the user. A library is the standard
 * library, a library given to the constructor (`libraries`), or a library
 * loaded with `ce.loadLibrary()`: a dependency graph keyed on the user's
 * cells has no cell for these names. The test reads:
 *
 * - the binding of the outermost (system) scope, where the standard library
 *   and the constructor's libraries are installed;
 * - `_libraryProvenance`, which records the binding each library installed,
 *   in the global scope for `ce.loadLibrary()`;
 * - for a library name that the current scope resolves to another binding,
 *   `shadowsLibraryName()` (`library-shadowing.ts`): an extension made with
 *   `ce.declare(name, patch, { extend: true })` that keeps the library's
 *   handlers is still the library operator.
 *
 * A user definition (`f(x) := …`, `ce.assign()`, `ce.declare()`) is none of
 * these. `def` is the binding (`{ value }` or `{ operator }`) or the
 * definition it holds.
 */
function isLibraryDefinition(
  engine: ComputeEngine,
  name: string,
  def: object | undefined
): boolean {
  if (def === undefined) return false;
  const holds = (binding: unknown): boolean => {
    if (binding === undefined || binding === null) return false;
    const b = binding as { value?: object; operator?: object };
    return (
      b === def ||
      (b.value !== undefined && b.value === def) ||
      (b.operator !== undefined && b.operator === def)
    );
  };
  const system = engine.contextStack[0]?.lexicalScope.bindings.get(name);
  if (holds(system)) return true;
  if (holds(engine._libraryProvenance.get(name)?.binding)) return true;
  return (
    system !== undefined &&
    holds(engine.lookupDefinition(name)) &&
    !shadowsLibraryName(engine, name)
  );
}

/**
 * Whether `expr` has unknowns (the same answer as `expr.unknowns.length >
 * 0`), with a memo that the caller keeps between calls. The memo holds the
 * answer of each function node already walked, so a caller that asks the
 * question of a node and then of the nodes below it walks the tree once.
 * The compiler asks it at each level of an expression that it compiles: the
 * walk of a node deep in the expression then reads the memo, instead of
 * recursing through the rest of the tree on top of the compiler's own stack
 * (ROADMAP CE-320.2).
 *
 * The memo is valid only while the values of the symbols, and the scopes
 * that bind them, do not change: the compiler keeps one for a compilation.
 */
export function hasUnknownsWithMemo(
  expr: Expression,
  memo: ReferencesMemo
): boolean {
  const result = new Set<string>();
  getReferences(expr, result, new Set<string>(), memo);
  return result.size > 0;
}

/**
 * Return the applied user functions in the expression, recursively. See
 * {@link getReferences} for the shared traversal and scoping rules.
 */
function getReferencedFunctions(expr: Expression, result: Set<string>): void {
  getReferences(expr, new Set<string>(), result, new Map(), 'references');
}

/**
 * Is the operator of the function application `expr` a user function that
 * the expression references, as opposed to an operator of a library or a
 * constant? A user function is listed whether it is undefined, declared, or
 * defined (`f(x) := …`, `ce.assign()`), and whether its binding holds a value
 * or not.
 *
 * The head is classified by the definition the application is bound to,
 * when it is bound: a name can have a binding that the call does not use
 * (with `N := 85`, the application `N(x)` still calls the library `N`,
 * because the number is not callable). An unbound application (a raw form)
 * is classified by the definition its name resolves to. The def-kind checks
 * are inlined rather than using the `isValueDef`/`isOperatorDef` guards from
 * `./utils` to avoid an import cycle (`utils` imports this module).
 */
function isReferencedFunctionHead(expr: Expression): boolean {
  const head = expr.operator;
  if (head === 'Unknown' || head === 'Undefined' || head === 'Nothing')
    return false;

  const engine = expr.engine;
  const def = expr.operatorDefinition ?? engine.lookupDefinition(head);
  if (def === undefined) return true;
  // A constant value (`Pi`, `ExponentialE`, …).
  if ('value' in def && def.value.isConstant) return false;
  return !isLibraryDefinition(engine, head, def);
}

/**
 * The **index variables** this node binds, according to its operator
 * definition's binding-site selectors — the one place binder knowledge lives
 * (`binding-sites.ts`). `undefined` when this node declares none, and the
 * caller then falls back to the structural recognition below.
 *
 * The selectors read the RAW operand shapes — a bare symbol, `Tuple`,
 * `Element`, `Limits`, held or not — so a STRUCTURAL tree answers the same as
 * a canonical one. Before this, the hand-rolled recognition below knew only
 * the canonical `Limits`/`Element` spellings, and a structural
 * `["Sum", ["Power","n",2], ["Tuple","n",1,10]]` leaked its index `n` as a
 * free variable.
 *
 * Only `clauseLocal` sites count — the *indexing-set* clauses (`Sum`,
 * `Product`, `Integrate`, the quantifiers, `Comprehension`, …), which is
 * exactly the class the structural recognition below covers. A binder whose
 * variable is a plain operand (`D`'s differentiation variable, `Series`'
 * expansion variable) is NOT an index: the variable survives into the result,
 * so it is deliberately reported as free (pinned by
 * `expression-properties.test.ts`, "D: differentiation variable remains
 * free"). This function is a spelling upgrade of the recognition below, not a
 * reclassification of which operators eliminate their variable.
 */
function bindingSiteNames(
  expr: Expression & { ops: ReadonlyArray<Expression> }
): DeclaredBinders | undefined {
  // An UNBOUND node (no operator definition — `canonical: false`) consults
  // no selector: only the canonical `Limits`/`Element` spellings are
  // recognized for it, by the structural fallback in the caller (pinned by
  // `expression-properties.test.ts`, "a node with no definition falls back
  // to the spelling heuristic"). `declaredBinders` would find the definition
  // by name and read a `Tuple` spelling the unbound tree does not carry.
  if (expr.operatorDefinition === undefined) return undefined;
  const binders = declaredBinders(expr, 'post');
  return binders === undefined || binders.clauseLocal.size === 0
    ? undefined
    : binders;
}

/**
 * Shared traversal of the names an expression reads. What it collects
 * depends on `mode` (`ReferenceMode`):
 *
 * - `'unknowns'`: into `freeVars`, the operand symbols that have no value and
 *   no function definition (`unknowns`, `freeVariables`). `refFns` is not
 *   filled.
 * - `'references'`: into `freeVars`, every operand symbol that is a user
 *   name, with a value or not; into `refFns`, every applied head that is a
 *   user function (`isReferencedFunctionHead`). A name of a library and a
 *   constant are left out. Passing the same set for both arguments yields
 *   their union (the `references` accessor).
 *
 * In both modes, a name bound by the expression itself is left out: the
 * parameters of a `Function`, the index variables of `Sum`, `Product` or
 * `Integrate`, the locals of a `Block`.
 *
 * `memo` records, per function node, the two sets the node contributes, for
 * one mode: a memo is never used with the other mode. What a
 * node contributes depends only on the node (its own binders filter its
 * operands' references before they reach the caller), so a subtree reached
 * through several operands is walked once per call, not once per path: a
 * user function applied to its own previous result embeds that result as
 * many times as its body mentions the parameter, and the walk over such a
 * value is exponential in the nesting depth without the memo — one
 * `unknowns` read of a four-level heightmap chain ran for minutes. The memo
 * is per CALL, never module-level: a symbol's freeness is read off the
 * engine's current definitions, which a later call may see changed.
 */
function getReferences(
  expr: Expression,
  freeVars: Set<string>,
  refFns: Set<string>,
  memo: ReferencesMemo = new Map(),
  mode: ReferenceMode = 'unknowns'
): void {
  // A dictionary is memoized as a function node is: the same dictionary can
  // be the value of several keys, or of several dictionaries.
  if (isFunction(expr) || isDictionary(expr)) {
    // A store-backed list (`ce.list()`) holds numbers only: nothing to
    // reference, and walking it would box every element. Other written-out
    // data (a list of numbers and failed cells, `_isLiteralData()`) holds no
    // symbol either. Each `Error` node of a list in which every cell failed
    // was walked, with two lookups of its operator, at each read.
    if (
      isFunction(expr) &&
      (expr._numericStore !== undefined || expr._isLiteralData())
    )
      return;
    const hit = memo.get(expr);
    if (hit !== undefined) {
      for (const s of hit[0]) freeVars.add(s);
      for (const s of hit[1]) refFns.add(s);
      return;
    }
    const own: readonly [Set<string>, Set<string>] = [new Set(), new Set()];
    collectReferences(expr, own[0], own[1], memo, mode);
    memo.set(expr, own);
    for (const s of own[0]) freeVars.add(s);
    for (const s of own[1]) refFns.add(s);
    return;
  }
  collectReferences(expr, freeVars, refFns, memo, mode);
}

/** The body of {@link getReferences}: one node's own contribution. */
function collectReferences(
  expr: Expression,
  freeVars: Set<string>,
  refFns: Set<string>,
  memo: ReferencesMemo,
  mode: ReferenceMode
): void {
  if (isSymbol(expr)) {
    const s = expr.symbol;
    if (s === 'Unknown' || s === 'Undefined' || s === 'Nothing') return;

    if (expr.valueDefinition?.isConstant) return;

    // Every user name read is a reference, with a value or not, a function
    // or not (`ReferenceMode`). Only a name of the standard library is left
    // out: the `Add` of `Reduce(L, Add)`.
    if (mode === 'references') {
      const bound = expr.valueDefinition ?? expr.operatorDefinition;
      // An unbound occurrence (a raw form) has no definition of its own: the
      // binding its name resolves to says whether it is a constant (a bound
      // constant was left out above).
      const looked =
        bound === undefined ? expr.engine.lookupDefinition(s) : undefined;
      if (looked !== undefined && 'value' in looked && looked.value.isConstant)
        return;
      if (!isLibraryDefinition(expr.engine, s, bound ?? looked))
        freeVars.add(s);
      return;
    }

    if (expr.operatorDefinition) return;

    // A single scope-chain lookup serves both remaining cases (so the common
    // free-variable path pays one walk, not two — this avoided a separate
    // `_getSymbolValue` scope traversal).
    //
    // The walk is the one the evaluator uses to read the value of this
    // occurrence (`bindingInContext`), not a plain lookup by name. Inside
    // the call of a user function, the scope chain holds the parameters of
    // the function. An argument of the call can hold a symbol of the caller
    // with the name of a parameter: in `f(y, x)` for `f = (x, y) ↦ x = y`,
    // the `x` of the second argument is the free `x` of the caller. A
    // lookup by name finds the parameter `x`, which has a value, and
    // reported no unknowns, so `Equal` compared two "constants" and
    // answered `False`. `bindingInContext` skips a parameter of a call
    // frame that is not the binding this occurrence denotes, as the
    // evaluator does. An occurrence of the parameter itself in the body
    // still resolves to the parameter's value in the call frame.
    //
    // An UNBOUND occurrence (a raw operand held by a lazy operator) keeps the
    // lookup by name. It denotes no binding in particular, and evaluating it
    // binds it in the current scope first, so inside a call it reads the
    // parameter of the same name. `bindingInContext` would skip that
    // parameter whenever an outer binding of the name exists, and report as
    // free a symbol that evaluates to the parameter's value.
    const own = expr.valueDefinition;
    const def =
      own === undefined
        ? expr.engine.lookupDefinition(s)
        : bindingInContext(expr.engine, s, own);

    // An unbound symbol operand that names an operator — e.g. the `Add` of
    // `Reduce(L, Add)`, held raw by a lazy operator so it carries no bound
    // definition — is a function reference, not a free variable. (The
    // def-kind check is inlined, as in `isReferencedFunctionHead`, to avoid
    // an import cycle.)
    if (def !== undefined && 'operator' in def) return;

    // A name bound to a value is resolved, not free (mirrors
    // `_getSymbolValue`: only a value definition carries a value).
    const value =
      def !== undefined && 'value' in def ? def.value.value : undefined;
    if (value === undefined) freeVars.add(s);
    return;
  }

  // A dictionary binds no name: it references what its values reference. Its
  // keys are strings, not symbols.
  if (isDictionary(expr)) {
    for (const value of expr.values)
      getReferences(value, freeVars, refFns, memo, mode);
    return;
  }

  if (!isFunction(expr)) return;

  // The operator head is an applied user function when it passes the same
  // predicate a free variable would. It is referenced at *this* level, so it
  // is added directly (an enclosing binder filters it via the inner-set
  // threading below, exactly like a free variable).
  if (mode === 'references' && isReferencedFunctionHead(expr))
    refFns.add(expr.operator);

  // A `Function` literal `["Function", body, ...params]` binds its trailing
  // operands (the parameters) in the body. Recurse into the body and drop the
  // parameters. (Previously the parameters leaked, e.g. the `x` of
  // `["Function", body, "x"]`.) A parameter operand may be a bare symbol OR
  // the annotated spelling `["Typed", "x", type]` that canonicalization
  // produces for `x: type` — `functionLiteralParameterName` unwraps both; a
  // bare-symbol-only check left every annotated parameter leaking as an
  // unknown (`Map(_ ↦ _^2, xs)` reported `_` free, because `Map`'s callback
  // canonicalizes with a typed parameter).
  if (expr.operator === 'Function') {
    const ops = expr.ops;
    // A DESTRUCTURING parameter (`((p, q)) => …`) binds every leaf of its
    // pattern, which is why the names come from
    // `functionLiteralParameterNames` (plural) rather than the single-name
    // accessor: reading only the latter left `p` and `q` reported free.
    const params = new Set<string>();
    for (let i = 1; i < ops.length; i++)
      for (const name of functionLiteralParameterNames(ops[i]))
        params.add(name);
    const innerFree = new Set<string>();
    const innerRef = new Set<string>();
    if (ops.length > 0) getReferences(ops[0], innerFree, innerRef, memo, mode);
    for (const s of innerFree) if (!params.has(s)) freeVars.add(s);
    for (const s of innerRef) if (!params.has(s)) refFns.add(s);
    return;
  }

  // Otherwise, collect the variables bound by this expression's structure.
  // This must NOT be gated on `isScoped`: `Integrate` is not scoped yet binds
  // its integration variable.
  //   - index variables — Sum/Product/Integrate: the operator definition's
  //     binding-site selectors answer this, on a canonical tree AND on a raw
  //     or structural one (they read the raw operand spellings: a bare symbol,
  //     `Tuple`, `Element`, `Limits`, held or not). Only when the node
  //     declares no indexing-set site (no definition, or a non-index binder)
  //     do we fall back to recognizing an inner `Limits`/`Element` here.
  //   - local variables — Block: inner `Assign`/`Declare` introduce locals.
  //     `Block` is `scoped: true` with no binding sites, so this stays a
  //     structural recognition.
  const sites = bindingSiteNames(expr);
  const siteVars = sites?.clauseLocal;
  const indexVars = new Set<string>(siteVars);
  // Is the index `name` in scope in operand `i`? Always, for a structurally
  // recognized index; for a clause site, from its own clause onward and in
  // the body (every operand before the first clause) — the clause ordering
  // `bindBindingSites` canonicalized against (`binderBoundAt`).
  const boundIn = (name: string, i: number): boolean =>
    sites === undefined || binderBoundAt(sites, name, i);
  const localVars = new Set<string>();
  for (const op of expr.ops) {
    if (!isFunction(op)) continue;
    if (
      siteVars === undefined &&
      (op.operator === 'Limits' || op.operator === 'Element') &&
      isSymbol(op.op1)
    )
      indexVars.add(op.op1.symbol);
    // A `DefineFunction` statement (`f(x) = x + 1` in Epsil) introduces a
    // local too: the name it defines is bound by the block, not read from
    // the enclosing scope, so a program that defines `f` and then applies
    // it has no free `f`.
    if (
      (op.operator === 'Assign' ||
        op.operator === 'Declare' ||
        op.operator === 'DefineFunction') &&
      isSymbol(op.op1)
    )
      localVars.add(op.op1.symbol);
  }

  const ops = expr.ops;
  for (let i = 0; i < ops.length; i++) {
    const op = ops[i];
    // The bounds of a `Limits` clause and the collection of an `Element`
    // clause are outside the scope of the clause's own index
    // (`ownIndexClause()`, `binding-sites.ts`): with `k` free, `∫₀ᵏ k dk`
    // reads the free `k` in its upper bound.
    const own = ownIndexClauseAt(expr, i, sites);
    if (own !== undefined && isFunction(op)) {
      op.ops.forEach((child, j) => {
        const childFree = new Set<string>();
        const childRef = new Set<string>();
        getReferences(child, childFree, childRef, memo, mode);
        const bound = (s: string): boolean =>
          (indexVars.has(s) &&
            boundIn(s, i) &&
            !(own.outside(j) && s === own.name)) ||
          localVars.has(s);
        for (const s of childFree) if (!bound(s)) freeVars.add(s);
        for (const s of childRef) if (!bound(s)) refFns.add(s);
      });
      continue;
    }
    const innerFree = new Set<string>();
    const innerRef = new Set<string>();
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
      getReferences(op.ops[0], innerFree, innerRef, memo, mode);
    else getReferences(op, innerFree, innerRef, memo, mode);
    if (indexVars.size === 0 && localVars.size === 0) {
      for (const s of innerFree) freeVars.add(s);
      for (const s of innerRef) refFns.add(s);
    } else {
      // Filtered PER OPERAND: an index is bound only where it is in scope.
      for (const s of innerFree)
        if (!(indexVars.has(s) && boundIn(s, i)) && !localVars.has(s))
          freeVars.add(s);
      for (const s of innerRef)
        if (!(indexVars.has(s) && boundIn(s, i)) && !localVars.has(s))
          refFns.add(s);
    }
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
  if (
    operator === 'Assign' ||
    operator === 'Declare' ||
    operator === 'DefineFunction'
  ) {
    if (isSymbol(expr.op1)) result.add(expr.op1.symbol);
    return;
  }
  if (operator === 'Block') for (const op of expr.ops) getDefines(op, result);
}
