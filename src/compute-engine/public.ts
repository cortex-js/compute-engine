/**
 * The most important classes are {@link ComputeEngine} and
 * {@link BoxedExpression}.
 *
 * With `ComputeEngine` you create `BoxedExpression` objects. With
 * `BoxedExpression` you simplify, evaluate and serialize expressions.
 *
 * @module ComputeEngine
 */

import type { Decimal } from 'decimal.js';
import type { Complex } from 'complex.js';
import type {
  SignalMessage,
  WarningSignal,
  WarningSignalHandler,
} from '../common/signals';
import type {
  Expression,
  MathJsonDictionary,
  MathJsonFunction,
  MathJsonNumber,
  MathJsonString,
  MathJsonSymbol,
} from '../math-json/math-json-format';
import type {
  NumberFormattingOptions,
  ParseLatexOptions,
  SerializeLatexOptions,
} from './latex-syntax/public';

export * from './latex-syntax/public';

export type Rational = [number, number] | [Decimal, Decimal];

/**
 * Metadata that can be associated with a `BoxedExpression`
 */

export type Metadata = {
  latex?: string | undefined;
  wikidata?: string | undefined;
};

/**
 * The numeric evaluation mode:
 * 
<div class=symbols-table>

| Mode | |
| :--- | :----- |
| `"auto"`| Use bignum or complex numbers. |
| `"machine"` |  **IEEE 754-2008**, 64-bit floating point numbers: 52-bit mantissa, about 15 digits of precision |
| `"bignum"` | Arbitrary precision floating point numbers, as provided by the "decimal.js" library | 
| `"complex"` | Complex number represented by two machine numbers, a real and an imaginary part, as provided by the "complex.js" library |

</div>
 */
export type NumericMode = 'auto' | 'machine' | 'bignum' | 'complex';

/** Options for `BoxedExpression.simplify()` */
export type SimplifyOptions = EvaluateOptions & {
  recursive?: boolean;
  rules?: BoxedRuleSet;
};

/** Options for `BoxedExpression.evaluate()`
 *
 * @internal
 */
export type EvaluateOptions = {
  //
};

/** Options for `BoxedExpression.N()`
 * @internal
 */
export type NOptions = {
  //
};

export type ReplaceOptions = {
  /** If `true`, apply replacement rules to all sub-expressions.
   * If `false`, only consider the top-level expression.
   *
   * **Default**: `true`
   */
  recursive?: boolean;
  /**
   * If `true`, stop after the first rule that matches.
   *
   * If `false`, apply all the remaining rules even after the first match.
   *
   * **Default**: `true`
   */
  once?: boolean;
  /**
   * If `iterationLimit` > 1, the rules will be repeatedly applied
   * until no rules apply, up to `maxIterations` times.
   *
   * Note that if `once` is true, `maxIterations` has no effect.
   *
   * **Default**: `1`
   */
  iterationLimit?: number;
};

/**
 * A substitution describes the values of the wildcards in a pattern so that
 * the pattern is equal to a target expression.
 *
 * A substitution can also be considered a more constrained version of a
 * rule whose `lhs` is always a symbol.
 */
export type Substitution = {
  [symbol: string]: SemiBoxedExpression;
};

export type BoxedSubstitution = {
  [symbol: string]: BoxedExpression;
};

/** A LaTeX string starts and end with `$`, for example
 * `"$\frac{\pi}{2}$"`.
 */
export type LatexString = string;

/**
 *  A rule describes how to modify an expressions that matches a `lhs` pattern
 * into a new expressions matching `rhs`.
 *
 * `x-1` \( \to \) `1-x`
 * `(x+1)(x-1)` \( \to \) `x^2-1
 *
 * The `lhs` can be expressed as a LaTeX string or a MathJSON expression.
 *
 * Unbound variables (`x`, but not `Pi`) are matched structurally with a
 * a target expression, then the expression is rewritten as the `rhs`, with
 * the corresponding unbound variables in the `rhs` replaced by their values
 * in the `lhs.
 *
 * Pattern symbols (e.g. `_1`, `_a`) can be used as well.
 *
 * In addition:
 *  - `__1` (`__a`, etc..) match a sequence of one or more expressions
 *  - `___1` (`___a`, etc...) match a sequence of zero or more expressions
 */
export type Rule = [
  lhs: LatexString | SemiBoxedExpression | Pattern,
  rhs: LatexString | SemiBoxedExpression,
  options?: {
    condition?: LatexString | ((wildcards: BoxedSubstitution) => boolean);
    priority?: number;
  }
];

export type BoxedRule = [
  lhs: Pattern,
  rhs: BoxedExpression,
  priority: number,
  condition: undefined | ((wildcards: BoxedSubstitution) => boolean)
];

export type BoxedRuleSet = Set<BoxedRule>;

export type DomainCompatibility =
  | 'covariant' // A <: B
  | 'contravariant' // A :> B
  | 'bivariant' // A <: B and A :>B, A := B
  | 'invariant'; // Neither A <: B, nor A :> B

/** A domain constructor is the head of a domain expression. */
export type DomainConstructor =
  | 'Error'
  | 'Matrix' // <domain-of-elements> <dimension>*
  | 'SquareMatrix' // <domain-of-elements> <dimension>
  | 'Vector' // <domain-of-elements> <length>?
  | 'Function' // <domain-of-args>* <co-domain>
  | 'List' // <domain-of-elements>
  | 'Dictionary'
  | 'Tuple'
  | 'Range' // <min-value> <max-value> (inclusive)
  | 'Interval' // <min-value> <max-value> (inclusive, unless Open domain expression)
  | 'Intersection'
  | 'Union'
  | 'Maybe'
  | 'Sequence'
  | 'Head'
  | 'Symbol'
  | 'Value'
  | 'Covariant'
  | 'Contravariant'
  | 'Bivariant'
  | 'Invariant';

export type DomainLiteral = string;

export type DomainExpression<T = SemiBoxedExpression> =
  | DomainLiteral
  | [DomainConstructor, ...(string | T | DomainExpression<T>)[]]
  | ['Error', T]
  | ['Error', T, T]
  | ['Union', ...DomainExpression<T>[]]
  | ['Intersection', ...DomainExpression<T>[]]
  | ['Matrix', DomainExpression<T>, T, T]
  | ['SquareMatrix', DomainExpression<T>, T]
  | ['Vector', DomainExpression<T>, T]
  | ['List', DomainExpression<T>]
  | ['Dictionary', DomainExpression<T>]
  | ['Tuple', ...DomainExpression<T>[]]
  | ['Maybe', DomainExpression<T>]
  | ['Sequence', DomainExpression<T>]
  | ['Range']
  | ['Range', T]
  | ['Range', T, T]
  | ['Range', T, T, T]
  | ['Interval', T, T]
  | ['Interval', ['Open', T], T]
  | ['Interval', T, ['Open', T]]
  | ['Interval', ['Open', T], ['Open', T]]
  | ['Value', T]
  | ['Head', string]
  | ['Symbol', string]
  | ['Covariant', DomainExpression<T>]
  | ['Contravariant', DomainExpression<T>]
  | ['Bivariant', DomainExpression<T>]
  | ['Invariant', DomainExpression<T>]
  | ['Function', ...DomainExpression<T>[]];

export interface BoxedDomain extends BoxedExpression {
  is(s: BoxedDomain): boolean;

  /** True if a valid domain, and compatible with `dom` */
  isCompatible(
    dom: BoxedDomain | DomainLiteral,
    kind?: DomainCompatibility
  ): boolean;

  get literal(): string | null;
  get ctor(): DomainConstructor | null;
  get domainArgs():
    | (DomainExpression<BoxedExpression> | BoxedExpression | string)[]
    | null;
  get domainArg1():
    | string
    | BoxedExpression
    | DomainExpression<BoxedExpression>
    | null;
  get codomain(): BoxedDomain | null;

  get canonical(): BoxedDomain;
  get json(): Expression;

  readonly isNothing: boolean;
  // readonly isBoolean: boolean;
  readonly isNumeric: boolean;
  readonly isFunction: boolean;
  // readonly isPredicate: boolean;
  /**
   * If true, when all the arguments are numeric, the result of the
   * evaluation is numeric. Numeric is any value with a domain of `Number`.
   *
   * Example of numeric functions: `Add`, `Multiply`, `Power`, `Abs`
   *
   * Default: `false`
   */
  // readonly isNumericFunction: boolean;
  // readonly isRealFunction: boolean;
  /**
   * If true, when all the arguments are boolean, the result of the
   * evaluation is a boolean. Boolean is any value with a domain of `MaybeBoolean`.
   *
   * Example of logic functions: `And`, `Or`, `Not`, `Implies`
   *
   * **Default:** `false`
   */
  // readonly isLogicOperator: boolean;
  /**
   * The function represent a relation between the first argument and
   * the second argument, and evaluates to a boolean indicating if the relation
   * is satisfied.
   *
   * For example, `Equal`, `Less`, `Approx`, etc...
   *
   * **Default:** `false`
   */
  readonly isRelationalOperator: boolean;
}

/**
 * Options to control the serialization to MathJSON when using `BoxedExpression.json`.
 */
export type JsonSerializationOptions = {
  /** A list of space separated function names that should be excluded from
   * the JSON output.
   *
   * Those functions are replaced with an equivalent, for example, `Square` with
   * `Power`, etc...
   *
   * Possible values include `Sqrt`, `Root`, `Square`, `Exp`, `Subtract`,
   * `Rational`, `Complex`
   *
   * **Default**: `[]` (none)
   */
  exclude: string[];

  /** A list of space separated keywords indicating which MathJSON expressions
   * can use a shorthand.
   *
   * **Default**: `["all"]`
   */
  shorthands: (
    | 'all'
    | 'number'
    | 'symbol'
    | 'function'
    | 'dictionary'
    | 'string'
  )[];

  /** A list of space separated keywords indicating which metadata should be
   * included in the MathJSON. If metadata is included, shorthand notation
   * is not used.
   *
   * **Default**: `[]`  (none)
   */
  metadata: ('all' | 'wikidata' | 'latex')[];

  /** If true, repeating decimals are detected and serialized accordingly
   * For example:
   * - `1.3333333333333333` \( \to \) `1.(3)`
   * - `0.142857142857142857142857142857142857142857142857142` \( \to \) `0.(1428571)`
   *
   * **Default**: `true`
   */
  repeatingDecimals: boolean;

  /** Number literals are serialized with this precision.
   * If `"auto"`, the same precision as the compute engine calculations is used
   * If `"max"`, all available digits are serialized
   *
   * **Default**: `"auto"`
   */
  precision: 'auto' | 'max' | number;
};

/**
 * **Theory of Operations**
 *
 * The `BoxedExpression` interface includes most of the member functions
 * applicable to any kind of expression, for example `get symbol()` or
 * `get ops()`.
 *
 * When a member function is not applicable to this `BoxedExpression`,
 * for example `get symbol()` on a `BoxedNumber`, it returns `null`.
 *
 * This convention makes it convenient to manipulate expressions without
 * having to check what kind of instance they are before manipulating them.
 *
 */
export interface BoxedExpression {
  //
  // CANONICAL OR NON-CANONICAL
  //
  // The methods/properties below can be used with canonical or non-canonical
  // expressions. They do not trigger binding (associating the expression
  // with a definition).
  //
  //
  /** The Compute Engine associated with this expression provides
   * a context in which to interpret it, such as definition of symbols
   * and functions.
   */
  readonly engine: IComputeEngine;

  /** From `Object.valueOf()`, return a primitive value for the expression.
   *
   * If the expression is a machine number, or bignum or rational that can be
   * converted to a machine number, return a `number`.
   *
   * If the expression is a symbol, return the name of the symbol as a `string`.
   *
   * Otherwise return a LaTeX representation of the expression.
   *
   * @category Primitive Methods
   */
  valueOf(): number | string | boolean;

  /** From `Object.toString()`, return a LaTeX representation of the expression.
   *
   * Used when coercing a `BoxedExpression` to a `String`.
   *
   * @category Primitive Methods
   */
  toString(): string;

  /** Similar to`expr.valueOf()` but includes a hint.
   * @category Primitive Methods
   */
  [Symbol.toPrimitive](
    hint: 'number' | 'string' | 'default'
  ): number | string | null;

  /** Used by `JSON.stringify()` to serialize this object to JSON.
   *
   * Method version of `expr.json`.
   *
   * @category Primitive Methods
   */
  toJSON(): Expression;

  /** If `true`, this expression is in a canonical form.
   *
   * **Note** applicable to canonical and non-canonical expressions.
   *
   */
  get isCanonical(): boolean;

  /** For internal use only, set when a canonical expression is created.
   * @internal
   */
  set isCanonical(val: boolean);

  /** MathJSON representation of this expression.
   *
   * **Note** applicable to canonical and non-canonical expressions.
   *
   */
  readonly json: Expression;

  /**
   * The scope in which this expression has been defined.
   * Is null when the expression is not canonical.
   */
  readonly scope: RuntimeScope | null;

  /** From `Object.is()`. Equivalent to `BoxedExpression.isSame()`
   *
   * @category Primitive Methods
   *
   */
  is(rhs: unknown): boolean;

  /** @internal */
  readonly hash: number;

  /** LaTeX representation of this expression.
   *
   * The serialization can be customized with `ComputeEngine.latexOptions`
   *
   * **Note** applicable to canonical and non-canonical expressions.
   *
   */
  get latex(): LatexString;

  /**
   *
   * **Note** applicable to canonical and non-canonical expressions.
   * @internal
   */
  set latex(val: string);

  /** If this expression is a symbol, return the name of the symbol as a string.
   * Otherwise, return `null`.
   *
   * **Note** applicable to canonical and non-canonical expressions.

  * @category Symbol Expression
   *
   */
  readonly symbol: string | null;

  /**
   * If this is the `Nothing` symbol, return `true`.
   *
   * **Note** applicable to canonical and non-canonical expressions.
   */
  readonly isNothing: boolean;

  /** If this expression is a string, return the value of the string.
   * Otherwise, return `null`.
   *
   * **Note** applicable to canonical and non-canonical expressions.

  * @category String Expression
   *
   */
  readonly string: string | null;

  /** All the subexpressions matching the head
   *
   * **Note** applicable to canonical and non-canonical expressions.
   *
   */
  getSubexpressions(head: string): BoxedExpression[];

  /** All the subexpressions in this expression, recursively
   *
   * **Note** applicable to canonical and non-canonical expressions.
   *
   */
  readonly subexpressions: BoxedExpression[];

  /** All the symbols in the expression, recursively
   *
   * **Note** applicable to canonical and non-canonical expressions.
   *
   */
  readonly symbols: BoxedExpression[];

  /** All the `["Error"]` subexpressions
   *
   * **Note** applicable to canonical and non-canonical expressions.
   *
   */
  readonly errors: BoxedExpression[];

  /** All boxed expressions have a head.
   *
   * If not a function this can be `Symbol`, `String`, `Number` or `Dictionary`.
   *
   * If the head expression can be represented as a string, it is returned
   * as a string.
   *
   * **Note** applicable to canonical and non-canonical expressions. The head
   * of a non-canonical expression may be different than the head of its
   * canonical counterpart. For example the canonical counterpart of `["Divide", 5, 7]` is `["Rational", 5, 5]`.
   */
  readonly head: BoxedExpression | string;

  /** The list of arguments of the function, its "tail".
   *
   * If the expression is not a function, return `null`.
   *
   * **Note** applicable to canonical and non-canonical expressions.
   *
   * @category Function Expression
   *
   */
  readonly ops: null | BoxedExpression[];

  /** If this expression is a function, the number of operands, otherwise 0.
   *
   * Note that a function can have 0 operands, so to check if this expression
   * is a function, check if `this.ops !== null` instead.
   *
   * **Note** applicable to canonical and non-canonical expressions.
   *
   * @category Function Expression
   *
   */
  readonly nops: number;

  /** First operand, i.e.`this.ops[0]`
   *
   * **Note** applicable to canonical and non-canonical expressions.
   *
   * @category Function Expression
   *
   *
   */
  readonly op1: BoxedExpression;

  /** Second operand, i.e.`this.ops[1]`
   *
   * **Note** applicable to canonical and non-canonical expressions.
   *
   * @category Function Expression
   *
   *
   */
  readonly op2: BoxedExpression;

  /** Third operand, i.e. `this.ops[2]`
   *
   * **Note** applicable to canonical and non-canonical expressions.
   *
   * @category Function Expression
   *
   *
   */
  readonly op3: BoxedExpression;

  /** `true` if this expression or any of its subexpressions is an `["Error"]`
   * expression.
   *
   * **Note** applicable to canonical and non-canonical expressions. For
   * non-canonical expression, this may indicate a syntax error while parsing
   * LaTeX. For canonical expression, this may indicate argument domain
   * mismatch, or missing or unexpected arguments.
   *
   * @category Symbol Expression
   *
   */
  readonly isValid: boolean;

  /**
   * An exact value is not further transformed when evaluated. To get an
   * approximate evaluation of an exact value, use `.N()`.
   *
   * Non-exact values includes:
   * - numbers with a fractional part
   * - complex numbers with a real or imaginary fractional part
   *
   */
  readonly isExact: boolean;

  /** If true, the value of the expression never changes and evaluating it has
   * no side-effects.
   * If false, the value of the expression may change, if the
   * value of other expression changes or for other reasons.
   *
   * If `this.isPure` is `false`, `this.value` is undefined. Call
   * `this.evaluate()` to determine the value of the expression instead.
   *
   * As an example, the `Random` function is not pure.
   *
   * **Note** applicable to canonical and non-canonical expressions.
   */
  readonly isPure: boolean;

  /** True if the expression is a free variable, that is a symbol with no value */
  readonly isFree: boolean;

  /** True if the expression is a constant, that is a symbol with an immutable value */
  readonly isConstant: boolean;

  /**
   * Return the canonical form of this expression.
   *
   * If this is a function expressin, a definition is associated with the
   * canonical expression.
   *
   * When determining the canonical form the following function definition
   * flags are applied:
   * - `associative`: \\( f(a, f(b), c) \longrightarrow f(a, b, c) \\)
   * - `idempotent`: \\( f(f(a)) \longrightarrow f(a) \\)
   * - `involution`: \\( f(f(a)) \longrightarrow a \\)
   * - `commutative`: sort the arguments.
   *
   * If his expression is already canonical, the value of canonical is
   * `this`.
   *
   */
  get canonical(): BoxedExpression;

  /**
   * If this expression is a function, apply the function `fn` to all its operands.
   *
   * Replace the head of this expression with `head`, if defined.
   *
   * If this expression is a dictionary, return a new dictionary with the values
   * modified by `fn`.
   *
   * If `head` is provided, return a function expression with the modified
   * dictionary as operand, otherwise return the  modified dictionary.
   *
   * **Note** applicable to canonical and non-canonical expressions.
   *
   * */
  apply(
    fn: (x: BoxedExpression) => SemiBoxedExpression,
    head?: string
  ): BoxedExpression;

  /**
   * Replace all the symbols in the expression as indicated.
   *
   * Note the same effect can be achieved with `this.replace()`, but
   * using `this.subs()` is more efficient, and simpler.
   *
   * **Note** applicable to canonical and non-canonical expressions.
   *
   */
  subs(sub: Substitution, options?: { canonical?: boolean }): BoxedExpression;

  /**
   * Transform the expression by applying the rules:
   * if the `lhs` of a rule matches, it is replaced by its `rhs`.
   *
   * If no rules apply, return `null`.
   *
   * See also `subs` for a simple substitution.
   *
   *
   * **Note** applicable to canonical and non-canonical expressions.
   *
   */
  replace(
    rules: BoxedRuleSet,
    options?: ReplaceOptions
  ): null | BoxedExpression;

  /**
   * True if the expression includes a symbol `v` or a function head `v`.
   *
   * **Note** applicable to canonical and non-canonical expressions.
   */
  has(v: string | string[]): boolean;

  /** Structural/symbolic equality (weak equality).
   *
   * `ce.parse('1+x').isSame(ce.parse('x+1'))` is `false`
   *
   * **Note** applicable to canonical and non-canonical expressions.
   *
   * @category Relational Operator
   */
  isSame(rhs: BoxedExpression): boolean;

  /** Attempt to match this expression to the `rhs` expression.
   *
   * If `rhs` does not match, return `null`.
   *
   * Otherwise return an object literal.
   *
   * If this expression includes wildcards (symbols with a name that starts
   * with `_`), the object literal will include a prop for each matching named
   * wildcard.
   *
   * If `rhs` matches this pattern but there are no named wildcards, return
   * the empty object literal, `{}`.
   *
   * **Note** applicable to canonical and non-canonical expressions.
   *
   */
  match(
    rhs: BoxedExpression,
    options?: PatternMatchOptions
  ): BoxedSubstitution | null;

  /**
   * "Not a Number".
   *
   * A value representing undefined result of computations, such as `0/0`,
   * as per the floating point format standard IEEE-754.
   *
   * Note that if `isNaN` is true, `isNumber` is also true (yes, `NaN` is a
   * number).
   *
   * @category Expression Properties
   *
   */
  readonly isNaN: boolean | undefined;

  /**
   * The numeric value of this expression is 0.
   *
   * @category Expression Properties
   */
  readonly isZero: boolean | undefined;
  /**
   * The numeric value of this expression is not 0.
   * @category Expression Properties
   */
  readonly isNotZero: boolean | undefined;

  /**
   * The numeric value of this expression is not 1.
   * @category Expression Properties
   */
  readonly isOne: boolean | undefined;

  /**
   * The numeric value of this expression is not -1.
   * @category Expression Properties
   */
  readonly isNegativeOne: boolean | undefined;

  /** The numeric value of this expression is ±Infinity or Complex Infinity
   *
   * @category Expression Properties
   */
  readonly isInfinity: boolean | undefined;

  /** This expression is a number, but not ±Infinity and not `NaN`
   *
   * @category Expression Properties
   */
  readonly isFinite: boolean | undefined;

  /**
   * @category Expression Properties
   */
  readonly isEven: boolean | undefined;

  /**
   * @category Expression Properties
   */
  readonly isOdd: boolean | undefined;

  /**
   * @category Expression Properties
   */
  readonly isPrime: boolean | undefined;

  /**
   * @category Expression Properties
   */
  readonly isComposite: boolean | undefined;

  /**
   * Return the value of this expression, if a number literal.
   *
   * Note it is possible for `numericValue` to be `null`, and for `isNotZero`
   * to be true. For example, when a symbol has been defined with an assumption.
   *
   * @category Numeric Expression
   *
   */
  readonly numericValue: number | Decimal | Complex | Rational | null;

  /**
   * Return the following, depending on the value of this expression:
   *
   * * `-1` if it is < 0
   * * `0` if it is = 0
   * * `+1` if it is > 0
   * * `undefined` this value may be positive, negative or zero. We don't know
   *    right now (a symbol with an Integer domain, but no currently assigned
   *    value, for example)
   * * `null` this value will never be positive, negative or zero (`NaN`,
   *     a string or a complex number for example)
   *
   * Note that complex numbers have no natural ordering,
   * so if the value is a complex number, `sgn` is either 0, or `null`
   *
   * If a symbol, this does take assumptions into account, that is `this.sgn`
   * will return `1` if `isPositive` is `true`, even if this expression has
   * no value
   *
   * @category Numeric Expression
   *
   */
  readonly sgn: -1 | 0 | 1 | undefined | null;

  /** If the expressions cannot be compared, return `undefined`
   *
   * The numeric value of both expressions are compared.
   *
   * @category Relational Operator
   */
  isLess(rhs: BoxedExpression): boolean | undefined;

  /**
   * The numeric value of both expressions are compared.
   * @category Relational Operator
   */
  isLessEqual(rhs: BoxedExpression): boolean | undefined;

  /**
   * The numeric value of both expressions are compared.
   * @category Relational Operator
   */
  isGreater(rhs: BoxedExpression): boolean | undefined;

  /**
   * The numeric value of both expressions are compared.
   * @category Relational Operator
   */
  isGreaterEqual(rhs: BoxedExpression): boolean | undefined;

  /** The numeric value of this expression is > 0, same as `isGreater(0)`
   *
   * @category Expression Properties
   */
  readonly isPositive: boolean | undefined;

  /** The numeric value of this expression is >= 0, same as `isGreaterEqual(0)`
   *
   * @category Expression Properties
   */
  readonly isNonNegative: boolean | undefined;

  /** The numeric value of this expression is < 0, same as `isLess(0)`
   *
   * @category Expression Properties
   */
  readonly isNegative: boolean | undefined;

  /** The numeric value of this expression is <= 0, same as `isLessEqual(0)`
   *
   * @category Expression Properties
   */
  readonly isNonPositive: boolean | undefined;

  /** The keys of the dictionary.
   *
   * If this expression not a dictionary, return `null`
   *
   * @category Dictionary Expression
   *
   */
  readonly keys: IterableIterator<string> | null;

  /**
   *
   * @category Dictionary Expression
   */
  readonly keysCount: number;

  /**
   * If this expression is a dictionary, return the value of the `key` entry.
   *
   * @category Dictionary Expression
   *
   */
  getKey(key: string): BoxedExpression | undefined;

  /**
   * If this expression is a dictionary, return true if the
   *  dictionary has a `key` entry.
   *
   * @category Dictionary Expression
   *
   */
  hasKey(key: string): boolean;

  //
  // CANONICAL EXPRESSIONS ONLY
  //
  // The properties/methods below return only `undefined` for non-canonical
  // expressions
  //

  /** Wikidata identifier.
   *
   * **Note** `undefined` if not a canonical expression.
   *
   *
   */
  get wikidata(): string | undefined;
  set wikidata(val: string | undefined);

  /** An optional short description if the symbol or function head.
   *
   * May include markdown. Each string is a paragraph.
   *
   * **Note** `undefined` if not a canonical expression.
   *
   */
  readonly description: undefined | string[];

  /** An optional URL pointing to more information about the symbol or
   *  function head
   *
   * **Note** `undefined` if not a canonical expression.
   *
   */
  readonly url: string | undefined;

  /** Expressions with a higher complexity score are sorted
   * first in commutative functions
   *
   * **Note** `undefined` if not a canonical expression.
   */
  readonly complexity: number | undefined;

  /**
   * For symbols and functions, a possible definition associated with the
   *  expression. `basedDefinition` is the base class of symbol and function
   *  definition.
   *
   * **Note** `undefined` if not a canonical expression.
   *
   */
  readonly basedDefinition: BoxedBaseDefinition | undefined;

  /**
   * For functions, a possible definition associated with the expression.
   *
   * **Note** `undefined` if not a canonical expression or not a function.
   *
   */
  readonly functionDefinition: BoxedFunctionDefinition | undefined;

  /**
   * For symbols, a possible definition associated with the expression.
   *
   * **Note** `undefined` if not a symbol
   *
   */
  readonly symbolDefinition: BoxedSymbolDefinition | undefined;

  /**
   * The domain of this expression, without accounting for any inferred domain
   * or `ce.defaultDomain`. If no domain has been explicitly set via assignment
   * or via an `.assume()` directive, the `expr.explicitDomain` is `undefined`.
   *
   * This is useful to determine if the domain of an expression is inferred.
   *
   * In most cases you'll want to  use `expr.domain` instead.
   *
   * **Note** `undefined` if not a canonical expression or not a function.
   *
   */
  readonly explicitDomain: BoxedDomain | undefined;

  /**
   * Update the definition associated with this expression, taking
   * into account the specified scope.
   *
   * **Note**: applicable only to canonical expressions
   *
   * @internal
   */
  bind(scope: RuntimeScope | null): void;

  /**
   *
   * @internal
   */
  unbind(): void;

  //
  // AUTO CANONICAL
  //
  // The methods below are automatically applied to the canonical version
  // of the expression
  //

  /**
   * Return a simpler form of the canonical form of this expression.
   *
   * A series of rewriting rules are applied repeatedly, until no more rules
   * apply.
   *
   * If a custom `simplify` handler is associated with this function
   * definition, it is invoked.
   *
   * The values assigned to symbols and the assumptions about symbols may be
   * used, for example `arg.isInteger` or `arg.isPositive`.
   *
   * No calculations involving decimal numbers (numbers that are not
   * integers) are performed but exact calculations may be performed,
   * for example:
   *
   * \\( \sin(\frac{\pi}{4}) \longrightarrow \frac{\sqrt{2}}{2} \\).
   *
   * The result is in canonical form.
   *
   */
  simplify(options?: SimplifyOptions): BoxedExpression;

  /**
   * Return the value of the canonical form of this expression.
   *
   * A pure expression always return the same value and has no side effects.
   * If `expr.isPure` is `true`, `expr.value` and `expr.evaluate()` are
   * synonyms.
   *
   * For an impure expression, `expr.value` is undefined.
   *
   * Evaluating an impure expression may have some side effects, for
   * example modifying the `ComputeEngine` environment, such as its set of
   * assumptions.
   *
   * Only exact calculations are performed, no approximate calculations on
   * decimal numbers (non-integer numbers). Constants, rational numbers and
   * square root of rational numbers are preserved.
   *
   * To perform approximate calculations, use `expr.N()` instead.
   *
   * The result of `expr.evaluate()` may be the same as `expr.simplify()`.
   *
   * The result is in canonical form.
   *
   */
  evaluate(options?: EvaluateOptions): BoxedExpression;

  /** Return a numeric approximation of the canonical form of this expression.
   *
   * Any necessary calculations, including on decimal numbers (non-integers),
   * are performed.
   *
   * The calculations are performed according to the `numericMode` and
   * `precision` properties of the `ComputeEngine`.
   *
   * To only perform exact calculations, use `this.evaluate()` instead.
   *
   * If the function is not numeric, the result of `this.N()` is the same as
   * `this.evaluate()`.
   *
   * The result is in canonical form.
   */
  N(options?: NOptions): BoxedExpression;

  solve(vars: Iterable<string>): null | BoxedExpression[];

  /**
   * Synonym for `evaluate()`. If the expression is pure, the value may be
   * cached.
   *
   * It returns `undefined` for expressions that are not pure or that may
   * not be evaluated.
   *
   * **Note**: If non-canonical, return the value of its canonical counterpart
   */
  get value(): BoxedExpression | undefined;

  /** Only the value of variables can be changed (symbols that are not
   * constants).
   *
   * **Note**: If non-canonical, does nothing.
   *
   */
  set value(value: BoxedExpression | number | undefined);

  /** The domain of the value of this expression.
   *
   * If a function expression, the domain  of the value of the function (the codomain of the function).
   *
   * If a symbol the domain of the value of the symbol.
   *
   * Use `expr.head` to determine if an expression is a symbol or function.
   *
   * **Note**: If non-canonical, return the domain of its canonical
   * counterpart
   */
  get domain(): BoxedDomain;

  /** Modify the domain of a symbol that represent a variable
   * (or a function name).
   *
   * **Note**: If non-canonical, does nothing.
   *
   */
  set domain(domain: BoxedExpression | DomainExpression | BoxedDomain);

  /** `true` if the value of this expression is a number.
   *
   * `isExtendedComplex || isNaN` = `isReal || isImaginary || isInfinity || isNaN`
   *
   * Note that in a fateful twist of cosmic irony, `NaN` ("Not a Number")
   * **is** a number.
   *
   * @category Domain Properties
   */
  readonly isNumber: boolean | undefined;

  /** The value of this expression is an element of the set ℤ: ...,-2, -1, 0, 1, 2...
   *
   *
   * @category Domain Properties
   *
   */
  readonly isInteger: boolean | undefined;

  /** The value of this expression is an element of the set ℚ, p/q with p ∈ ℕ, q ∈ ℤ ⃰  q >= 1
   *
   * Note that every integer is also a rational.
   *
   *
   * @category Domain Properties
   *
   */
  readonly isRational: boolean | undefined;

  /**
   * The value of this expression is a number that is the root of a non-zero
   * univariate polynomial with rational coefficients.
   *
   * All integers and rational numbers are algebraic.
   *
   * Transcendental numbers, such as \\( \pi \\) or \\( e \\) are not algebraic.
   *
   *
   * @category Domain Properties
   *
   */
  readonly isAlgebraic: boolean | undefined;
  /**
   * The value of this expression is real number: finite and not imaginary.
   *
   * `isFinite && !isImaginary`
   *
   *
   * @category Domain Properties
   */
  readonly isReal: boolean | undefined;

  /** Real or ±Infinity
   *
   * `isReal || isInfinity`
   *
   *
   * @category Domain Properties
   */
  readonly isExtendedReal: boolean | undefined;

  /**
   * The value of this expression is a number, but not `NaN` or any Infinity
   *
   * `isReal || isImaginary`
   *
   *
   * @category Domain Properties
   *
   */
  readonly isComplex: boolean | undefined;

  /** `isReal || isImaginary || isInfinity`
   *
   *
   * @category Domain Properties
   */
  readonly isExtendedComplex: boolean | undefined;

  /** The value of this expression is a number with a imaginary part
   *
   *
   * @category Domain Properties
   */
  readonly isImaginary: boolean | undefined;

  /** Mathematical equality (strong equality), that is the value
   * of this expression and of `rhs` are numerically equal.
   *
   * The numeric value of both expressions are compared.
   *
   * Numbers whose difference is less than `engine.tolerance` are
   * considered equal. This tolerance is set when the `engine.precision` is
   * changed to be such that the last two digits are ignored.
   *
   * @category Relational Operator
   */
  isEqual(rhs: BoxedExpression): boolean;
}

/** A semi boxed expression is an MathJSON expression which can include some
 * boxed terms.
 *
 * This is convenient when creating new expressions from portions
 * of an existing `BoxedExpression` while avoiding unboxing and reboxing.
 */
export type SemiBoxedExpression =
  | number
  | string
  | Decimal
  | Complex
  | MathJsonNumber
  | MathJsonString
  | MathJsonSymbol
  | MathJsonFunction
  | MathJsonDictionary
  | SemiBoxedExpression[]
  | BoxedExpression;

export type PatternMatchOptions = {
  substitution?: BoxedSubstitution;
  recursive?: boolean;
  numericTolerance?: number;
  exact?: boolean;
};

export interface Pattern extends BoxedExpression {
  /** If `expr` matches the pattern, return `true`, otherwise `false` */
  test(expr: BoxedExpression, options?: PatternMatchOptions): boolean;

  /** Return the number of exprs that matched the pattern */
  count(
    exprs: Iterable<BoxedExpression>,
    options?: PatternMatchOptions
  ): number;

  /**
   * If `expr` does not match the pattern, return `null`.
   *
   * Otherwise, return a substitution describing the values that the named
   * wildcards in the pattern should be changed to in order for the pattern
   * to be equal to the expression. If there are no named wildcards and
   * the expression matches the pattern, an empty object literal `{}` is
   * returned.
   */
  // match(
  //   expr: BoxedExpression,
  //   options?: PatternMatchOptions
  // ): BoxedSubstitution | null;

  // subs(sub: Substitution, options?: { canonical: boolean }): BoxedExpression;
}

export interface ExpressionMapInterface<U> {
  has(expr: BoxedExpression): boolean;
  get(expr: BoxedExpression): U | undefined;
  set(expr: BoxedExpression, value: U): void;
  delete(expr: BoxedExpression): void;
  clear(): void;
  [Symbol.iterator](): IterableIterator<[BoxedExpression, U]>;
}

/**
 * An ID table contains definitions for symbols and functions.
 *
 * The index of the table is an identifier, the  name of the symbol or
 * function for this definition
 *
 * The name of a symbol or function is an arbitrary string of Unicode
 * characters, however the following conventions are recommended:
 *
 * - Use only letters, digits and `-`: `/[a-zA-Z0-9-]+/`
 * - The first character should be a letter: `/^[a-zA-Z]/`
 * - Functions and symbols exported from a library should start with an uppercase letter `/^[A-Z]/`
 *
 */

export type IDTable = { [id: string]: SymbolDefinition | FunctionDefinition };

/**
 * The entries of a `RuntimeIdentifierTable` have been validated and
 * optimized for faster evaluation.
 *
 * When a new scope is created with `pushScope()` or when creating a new
 * engine instance, new instances of `RuntimeIdentifierTable` are created
 * as needed.
 */
export type RuntimeIdentifierTable = Map<
  string,
  BoxedSymbolDefinition | BoxedFunctionDefinition
>;

/**
 * A scope is a set of names in a dictionary that are bound (defined) in
 * a MathJSON expression.
 *
 * Scopes are arranged in a stack structure. When an expression that defined
 * a new scope is evaluated, the new scope is added to the scope stack.
 * Outside of the expression, the scope is removed from the scope stack.
 *
 * The scope stack is used to resolve symbols, and it is possible for
 * a scope to 'mask' definitions from previous scopes.
 *
 * Scopes are lexical (also called a static scope): they are defined based on
 * where they are in an expression, they are not determined at runtime.
 *
 */
export type Scope = {
  /** This handler is invoked when exiting this scope if there are any
   * warnings pending. */
  warn?: WarningSignalHandler;

  /** Signal `timeout` when the execution time for this scope is exceeded.
   * Time in seconds, default 2s.
   *
   * @experimental
   */
  timeLimit?: number;

  /** Signal `out-of-memory` when the memory usage for this scope is exceeded.
   * Memory in Megabytes, default: 1Mb.
   *
   * @experimental
   */
  memoryLimit?: number;

  /** Signal `recursion-depth-exceeded` when the recursion depth for this
   * scope is exceeded.
   *
   * @experimental
   */
  recursionLimit?: number;

  /** Signal `iteration-limit-exceeded` when the iteration limit for this
   * scope is exceeded. Default: no limits.
   *
   * @experimental
   */
  iterationLimit?: number;
};

export type RuntimeScope = Scope & {
  parentScope?: RuntimeScope;

  idTable?: RuntimeIdentifierTable;

  assumptions: undefined | ExpressionMapInterface<boolean>;

  /** The location of the call site that created this scope */
  origin?: {
    name?: string;
    line?: number;
    column?: number;
  };

  /** Free memory should not go below this level for execution to proceed */
  lowWaterMark?: number;

  /** Set when one or more warnings have been signaled in this scope */
  warnings?: WarningSignal[];
};

export type BaseDefinition = {
  /** A short (about 1 line) description. May contain Markdown. */
  description?: string | string[];

  /** A URL pointing to more information about this symbol or head. */
  url?: string;

  /**
   * A short string representing an entry in a wikibase.
   *
   * For example `Q167` is the [wikidata entry](https://www.wikidata.org/wiki/Q167)
   * for the `Pi` constant.
   */
  wikidata?: string;
};

export interface BoxedBaseDefinition {
  name: string;
  wikidata?: string;
  description?: string | string[];
  url?: string;
  /**
   * The scope this definition belongs to.
   *
   * This field is usually undefined, but its value is set by `getDefinition()`
   */
  scope: RuntimeScope | undefined;

  /** When the environment changes, for example the numerical precision,
   * call `reset()` so that any cached values can be recalculated.
   */
  reset();
}

/**
 * A function definition can have some flags to indicate specific
 * properties of the function.
 */
export type FunctionDefinitionFlags = {
  /**  If `true`, the function is applied element by element to lists, matrices
   * (`["List"]` or `["Tuple"]` expressions) and equations (relational
   * operators).
   *
   * **Default**: `false`
   */
  threadable: boolean;

  /** If `true`, `["f", ["f", a], b]` simplifies to `["f", a, b]`
   *
   * **Default**: `false`
   */
  associative: boolean;

  /** If `true`, `["f", a, b]` equals `["f", b, a]`. The canonical
   * version of the function will order the arguments.
   *
   * **Default**: `false`
   */
  commutative: boolean;

  /** If `true`, when the function is univariate, `["f", ["Add", x, c]]` where `c`
   * is constant, is simplified to `["Add", ["f", x], c]`.
   *
   * When the function is multivariate, additivity is considered only on the
   * first argument: `["f", ["Add", x, c], y]` simplifies to `["Add", ["f", x, y], c]`.
   *
   * For example, `Log` is additive.
   *
   * **Default**: `false`
   */
  // additive: boolean;

  /** If `true`, when the function is univariate, `["f", ["Multiply", x, y]]`
   * simplifies to `["Multiply", ["f", x], ["f", y]]`.
   *
   * When the function is multivariate, multiplicativity is considered only on the
   * first argument: `["f", ["Multiply", x, y], z]` simplifies to
   * `["Multiply", ["f", x, z], ["f", y, z]]`
   *
   * **Default**: `false`
   */

  /** If `true`, when the function is univariate, `["f", ["Multiply", x, c]]`
   * simplifies to `["Multiply", ["f", x], c]` where `c` is constant
   *
   * When the function is multivariate, multiplicativity is considered only on
   * the first argument: `["f", ["Multiply", x, y], z]` simplifies to
   * `["Multiply", ["f", x, z], ["f", y, z]]`
   *
   * Default: `false`
   */

  /** If `true`, `["f", ["f", x]]` simplifies to `["f", x]`.
   *
   * **Default**: `false`
   */
  idempotent: boolean;

  /** If `true`, `["f", ["f", x]]` simplifies to `x`.
   *
   * **Default**: `false`
   */
  involution: boolean;

  /** If `true`, the value of this function is always the same for a given
   * set of arguments and it has no side effects.
   *
   * An expression using this function is pure if the function and all its
   * arguments are pure.
   *
   * For example `Sin` is pure, `Random` isn't.
   *
   * This information may be used to cache the value of expressions.
   *
   * **Default:** `true`
   */
  pure: boolean;

  /**
   * An inert function evaluates directly to one of its argument, typically
   * the first one. They may be used to provide formating hints, but do
   * not affect simplification or evaluation.
   *
   * **Default:** false
   */
  inert: boolean;

  /**
   * All the arguments of a numeric function are numeric,
   * and its value is numeric.
   */
  numeric: boolean;
};

/**
 *
 */

export type FunctionSignature = {
  /** The domain of this signature, a domain compatible with the `Function`
   * domain) */
  domain?: BoxedDomain | DomainExpression;

  /** The minimum and maximum values of the result of the function */
  // range?: [min: number, max: number];

  /** An optional handler to determine the codomain of the function.
   * If not provided, the codomain of the function is determined from `domain`
   */
  codomain?: (ce: IComputeEngine, args: BoxedDomain[]) => BoxedDomain | null;

  /**
   * Return the canonical form of the expression with the arguments `args`.
   *
   * The arguments (`args`) may not be in canonical form. If necessary, they
   * can be put in canonical form.
   *
   * This handler should validate the domain and number of the arguments.
   * If a required argument is missing, it should be indicated with a
   * `["Error", "'missing"]` expression. If more arguments than expected
   * are present, this should be indicated with a `unexpected-argument` error.
   * If the domain of an argument is not compatible, it should be indicated with
   * a `incompatible-domain` error.
   *
   * `["Sequence"]` expressions are not folded and need to be handled
   *  explicitly.
   *
   * If the function is associative, idempotent or an involution,
   * this handler should account for it. Notably, if it is commutative, the
   * arguments should be sorted in canonical order.
   *
   * The handler can make transformations based on the value of the arguments
   * that are exact and literal
   * (i.e. `arg.numericValue !== null && arg.isExact`).
   *
   * Values of symbols should not be substituted.
   *
   * The handler should not consider the value or any assumptions about any
   * of the arguments that are symbols or functions (i.e. `arg.isZero`,
   * `arg.isInteger`, etc...) since those may change over time.
   *
   * The result of the handler should be a canonical expression.
   *
   * If the arguments do not match, they should be replaced with an appropriate
   * `["Error"]` expression. If the expression cannot be put in canonical form,
   * the handler should return `null`.
   *
   */
  canonical?: (
    ce: IComputeEngine,
    args: BoxedExpression[]
  ) => BoxedExpression | null;

  /**
   * Rewrite an expression into a simpler form.
   *
   * The arguments are in canonical form and have been simplified.
   *
   * The handler can use the values assigned to symbols and the assumptions
   * about symbols, for example with `arg.numericValue`, `arg.isInteger` or
   * `arg.isPositive`.
   *
   * Even though a symbol may not have a value, there may be some information
   * about it reflected for example in `this.isZero` or `this.isPrime`.
   *
   * The handler should not perform approximate numeric calculations, such
   * as calculations involving decimal numbers (non-integers). Making exact
   * calculations on integers or rationals is OK.
   *
   * This handler should not have any side-effects: do not modify
   * the environment of the `ComputeEngine` instance, do not perform I/O,
   * do not do calculations that depend on random values.
   *
   * If no simplification can be performed due to the values, domains or
   * assumptions about its arguments, for example, return `undefined`.
   *
   */
  simplify?: (
    ce: IComputeEngine,
    args: BoxedExpression[]
  ) => BoxedExpression | undefined;

  /**
   * Evaluate symbolically a function expression.
   *
   * The arguments have been symbolically evaluated, except the arguments to
   * which a `hold` apply.
   *
   * It is not necessary to further simplify or evaluate the arguments.
   *
   * If performing numerical calculations, if all the arguments are exact,
   * return an exact expression. If any of the arguments is not exact, that is
   * if it is a literal decimal (non-integer) number, return an approximation.
   * In this case, the value may be the same as `expr.N()`.
   *
   * When doing an exact calculation:
   * - do not reduce rational numbers to decimal (floating point approximation)
   * - do not down convert bignums to machine numbers
   * - do not reduce square roots of rational numbers
   * - do not reduce constants with a `hold` attribute
   *
   * If the expression cannot be evaluated, due to the values, domains, or
   * assumptions about its arguments, for example, return `undefined` or
   * an `["Error"]` expression.
   */
  evaluate?:
    | SemiBoxedExpression
    | ((
        ce: IComputeEngine,
        args: BoxedExpression[]
      ) => BoxedExpression | undefined);

  /**
   * Evaluate numerically a function expression.
   *
   * The arguments `args` have been simplified and evaluated, numerically
   * if possible, except the arguments to which a `hold` apply.
   *
   * The arguments may be a combination of numbers, symbolic
   * expressions and other expressions.
   *
   * Perform as many calculations as possible, and return the result.
   *
   * Return `undefined` if there isn't enough information to perform
   * the evaluation, for example one of the arguments is a symbol with
   * no value. If the handler returns `undefined`, symbolic evaluation of
   * the expression will be returned instead to the caller.
   *
   * Return `NaN` if there is enough information to  perform the
   * evaluation, but a literal argument is out of range or
   * not of the expected type.
   *
   * Note that regardless of the current value of `ce.numericMode`, the
   * arguments may be boxed numbers representing machine numbers, bignum
   * numbers, complex numbers, rationals or big rationals.
   *
   * Use the value of `ce.numericMode` to determine how to perform
   * the numeric evaluation.
   *
   * If the numeric mode does not allow complex numbers (the
   * `engine.numericMode` is not `"complex"` or `"auto"`) and the result of
   * the evaluation would be a complex number, return `NaN` instead.
   *
   * If `ce.numericMode` is `"bignum"` or `"auto"` the evaluation should be done
   * using bignums.
   *
   * Otherwise, `ce.numericMode` is `"machine", the evaluation should be
   * performed using machine numbers.
   *
   * You may perform any necessary computations, including approximate
   * calculations on floating point numbers.
   *
   */
  N?: (
    ce: IComputeEngine,
    args: BoxedExpression[]
  ) => BoxedExpression | undefined;

  /** Dimensional analysis
   * @experimental
   */
  evalDimension?: (
    ce: IComputeEngine,
    args: BoxedExpression[]
  ) => BoxedExpression;

  /** Return the sign of the function expression. */
  sgn?: (ce: IComputeEngine, args: BoxedExpression[]) => -1 | 0 | 1 | undefined;

  /** Return a compiled (optimized) expression. */
  compile?: (expr: BoxedExpression) => CompiledExpression;
};

export type BoxedFunctionSignature = {
  domain: BoxedDomain;

  codomain?:
    | BoxedDomain
    | ((ce: IComputeEngine, args: BoxedExpression[]) => BoxedDomain | null);
  canonical?: (
    ce: IComputeEngine,
    args: BoxedExpression[]
  ) => BoxedExpression | null;
  simplify?: (
    ce: IComputeEngine,
    args: BoxedExpression[]
  ) => BoxedExpression | undefined;
  evaluate?:
    | BoxedExpression
    | ((
        ce: IComputeEngine,
        args: BoxedExpression[]
      ) => BoxedExpression | undefined);
  N?: (
    ce: IComputeEngine,
    args: BoxedExpression[]
  ) => BoxedExpression | undefined;
  evalDimension?: (
    ce: IComputeEngine,
    args: BoxedExpression[]
  ) => BoxedExpression;
  sgn?: (ce: IComputeEngine, args: BoxedExpression[]) => -1 | 0 | 1 | undefined;

  compile?: (expr: BoxedExpression) => CompiledExpression;
};

/**
 * Definition record for a function.
 *
 */
export type FunctionDefinition = BaseDefinition &
  Partial<FunctionDefinitionFlags> & {
    /**
     * A number used to order arguments.
     *
     * Argument with higher complexity are placed after arguments with lower
     * complexity when ordered canonically in commutative functions.
     *
     * - Additive functions: 1000-1999
     * - Multiplicative functions: 2000-2999
     * - Root and power functions: 3000-3999
     * - Log functions: 4000-4999
     * - Trigonometric functions: 5000-5999
     * - Hypertrigonometric functions: 6000-6999
     * - Special functions (factorial, Gamma, ...): 7000-7999
     * - Collections: 8000-8999
     * - Inert and styling:  9000-9999
     * - Logic: 10000-10999
     * - Relational: 11000-11999
     *
     * **Default**: 100,000
     */
    complexity?: number;

    /**
     * - `"none"` Each of the arguments is evaluated (default)
     * - `"all"` None of the arguments are evaluated and they are passed as is
     * - `"first"` The first argument is not evaluated, the others are
     * - `"rest"` The first argument is evaluated, the others aren't
     * - `"last"`: The last argument is not evaluated, the others are
     * - `"most"`: All the arguments are evaluated, except the last one
     *
     * **Default**: `"none"`
     */

    hold?: 'none' | 'all' | 'first' | 'rest' | 'last' | 'most';

    signature?: FunctionSignature;
  };

export type BoxedFunctionDefinition = BoxedBaseDefinition &
  FunctionDefinitionFlags & {
    complexity: number;
    hold: 'none' | 'all' | 'first' | 'rest' | 'last' | 'most';

    signature: BoxedFunctionSignature;
  };

/**
 * When used in a `SymbolDefinition`, these flags are optional.
 *
 * If provided, they will override the value derived from
 * the symbol's value.
 *
 * For example, it might be useful to override `algebraic = false`
 * for a transcendental number.
 */
export type SymbolFlags = {
  number: boolean | undefined;
  integer: boolean | undefined;
  rational: boolean | undefined;
  algebraic: boolean | undefined;
  real: boolean | undefined;
  extendedReal: boolean | undefined;
  complex: boolean | undefined;
  extendedComplex: boolean | undefined;
  imaginary: boolean | undefined;

  positive: boolean | undefined; // x > 0
  nonPositive: boolean | undefined; // x <= 0
  negative: boolean | undefined; // x < 0
  nonNegative: boolean | undefined; // x >= 0

  zero: boolean | undefined;
  notZero: boolean | undefined;
  one: boolean | undefined;
  negativeOne: boolean | undefined;
  infinity: boolean | undefined;
  NaN: boolean | undefined;
  finite: boolean | undefined;

  even: boolean | undefined;
  odd: boolean | undefined;

  prime: boolean | undefined;
  composite: boolean | undefined;
};

export type SymbolAttributes = {
  /**
   * If `true` the value of the symbol is constant. The value or domain of
   * symbols with this attribute set to `true` cannot be changed.
   *
   * If `false`, the symbol is a variable.
   *
   * **Default**: `false`
   */
  constant: boolean;

  /**
   * If the symbol has a value, it is held as indicated in the table below.
   * A green checkmark indicate that the symbol is substituted.

<div class=symbols-table>

| Operation | `"never"` | `"simplify"` | `"evaluate"` | `"N"` |
| :--- | :----- |
| `canonical()`|  {% icon "circle-check" "green-700" %} | | | |
| `simplify()` |   {% icon "circle-check" "green-700" %} | {% icon "circle-check" "green-700" %} | | |
| `evaluate()` |   {% icon "circle-check" "green-700" %} | {% icon "circle-check" "green-700" %} | {% icon "circle-check" "green-700" %} | |
| `"N()"` |  {% icon "circle-check" "green-700" %} | {% icon "circle-check" "green-700" %}  |  {% icon "circle-check" "green-700" %} | {% icon "circle-check" "green-700" %}  |

</div>

  * Some examples:
  * - `i` has `holdUntil: 'never'`
  * - `GoldenRatio` has `holdUntil: 'simplify'` (symbolic constant)
  * - `x` has `holdUntil: 'evaluate'` (variables)
  * - `Pi` has `holdUntil: 'N'` (special numeric constant)
  * 
  * **Default:** `simplify`
  */
  holdUntil: 'never' | 'simplify' | 'evaluate' | 'N';
};

/**
 * A bound symbol (i.e. one with an associated definition) has either a domain
 * (e.g. ∀ x ∈ ℝ), a value (x = 5) or both (π: value = 3.14... domain = TranscendentalNumber)
 */
export type SymbolDefinition = BaseDefinition &
  Partial<SymbolAttributes> & {
    domain?: string | BoxedDomain;

    /** `value` can be a function since for some constants, such as
     * `Pi`, the actual value depends on the `precision` setting of the
     * `ComputeEngine` */
    value?:
      | LatexString
      | SemiBoxedExpression
      | ((ce: IComputeEngine) => SemiBoxedExpression | null);

    flags?: Partial<SymbolFlags>;

    /**
     * If this symbol is an indexable collection, return the
     * element at the provided index.
     */
    // @todo at?: (index: string | number) => SemiBoxedExpression;

    /**
     * If this symbol is a finite collection, return the number
     * of elements in the collection.
     */
    // @todosize?: () => number;

    /**
     * If this symbol is an iterable collection, return
     * an iterator.
     */
    // @todo iterator?: {
    //   next: () => null | BoxedExpression;
    //   hasNext: () => boolean;
    // };
    // @todo reverseIterator?: {
    //   next: () => null | BoxedExpression;
    //   hasNext: () => boolean;
    // };

    // unit?: SemiBoxedExpression;
  };

export interface BoxedSymbolDefinition
  extends BoxedBaseDefinition,
    SymbolAttributes,
    Partial<SymbolFlags> {
  get value(): BoxedExpression | undefined;
  set value(val: SemiBoxedExpression | number | undefined);

  domain: BoxedDomain | undefined;

  // @todo unit?: BoxedExpression;

  at?: (index: string | number) => undefined | BoxedExpression;
}

export type AssumeResult =
  | 'internal-error'
  | 'not-a-predicate'
  | 'contradiction'
  | 'tautology'
  | 'ok';

export type CompiledExpression = {
  evaluate?: (scope: {
    [symbol: string]: BoxedExpression;
  }) => number | BoxedExpression;
};

export interface ComputeEngineStats {
  symbols: Set<BoxedExpression>;
  expressions: null | Set<BoxedExpression>;
  highwaterMark: number;
}

/** @internal */
export interface IComputeEngine {
  /** @internal */
  readonly _ZERO: BoxedExpression;
  /** @internal */
  readonly _ONE: BoxedExpression;
  /** @internal */
  readonly _HALF: BoxedExpression;
  /** @internal */
  readonly _NEGATIVE_ONE: BoxedExpression;
  /** @internal */
  readonly _I: BoxedExpression;
  /** @internal */
  readonly _NAN: BoxedExpression;
  /** @internal */
  readonly _POSITIVE_INFINITY: BoxedExpression;
  /** @internal */
  readonly _NEGATIVE_INFINITY: BoxedExpression;
  /** @internal */
  readonly _COMPLEX_INFINITY: BoxedExpression;

  /** @internal */
  readonly _BIGNUM_NAN: Decimal;
  /** @internal */
  readonly _BIGNUM_ZERO: Decimal;
  /** @internal */
  readonly _BIGNUM_ONE: Decimal;
  /** @internal */
  readonly _BIGNUM_TWO: Decimal;
  /** @internal */
  readonly _BIGNUM_HALF: Decimal;
  /** @internal */
  readonly _BIGNUM_PI: Decimal;
  /** @internal */
  readonly _BIGNUM_NEGATIVE_ONE: Decimal;

  /** The current scope */
  context: RuntimeScope | null;

  /** Absolute time beyond which evaluation should not proceed
   * @internal
   */
  deadline?: number;

  /** @experimental */
  readonly timeLimit: number;
  /** @experimental */
  readonly iterationLimit: number;
  /** @experimental */
  readonly recursionLimit: number;
  defaultDomain: null | BoxedDomain;

  /** {@inheritDoc  NumericMode} */
  numericMode: NumericMode;

  tolerance: number;
  chop(n: number): number;
  chop(n: Decimal): Decimal | 0;
  chop(n: Complex): Complex | 0;
  chop(n: number | Decimal | Complex): number | Decimal | Complex;

  /** @internal */
  bignum: (a: Decimal.Value) => Decimal;
  /** @internal */
  complex: (a: number | Complex, b?: number) => Complex;

  set precision(p: number | 'machine');
  get precision(): number;

  costFunction: (expr: BoxedExpression) => number;

  /** In strict mode (the default) the Compute Engine performs
   * validation of domains and signature and may report errors.
   *
   * When strict mode is off, results may be incorrect or generate JavaScript
   * errors if the input is not valid.
   *
   */
  strict: boolean;

  /**
   * Associate a new definition to a symbol in the current context.
   *
   * If a definition existed previously, it is replaced.
   */
  defineSymbol(name: string, def: SymbolDefinition): BoxedSymbolDefinition;

  /**
   * Associate a new definition to a function in the current context.
   *
   * If a definition existed previously, it is replaced.
   */
  defineFunction(
    name: string,
    def: FunctionDefinition
  ): BoxedFunctionDefinition;

  lookupSymbol(
    name: string,
    wikidata?: string,
    scope?: RuntimeScope
  ): undefined | BoxedSymbolDefinition;

  /** Return `undefined` if no definition exist for this `head` */
  lookupFunction(
    head: string | BoxedExpression,
    scope?: RuntimeScope | null
  ): undefined | BoxedFunctionDefinition;

  /**
   * Return a boxed expression from the input.
   */
  box(
    expr:
      | Decimal
      | Complex
      | [num: number, denom: number]
      | SemiBoxedExpression,
    options?: { canonical?: boolean }
  ): BoxedExpression;

  /** Return a boxed number */
  number(
    value:
      | number
      | string
      | MathJsonNumber
      | Decimal
      | Complex
      | [num: number, denom: number]
      | [num: Decimal, denom: Decimal],
    options?: { metadata?: Metadata; canonical?: boolean }
  ): BoxedExpression;

  /** Return a canonical boxed symbol */
  symbol(
    sym: string,
    options?: { metadata?: Metadata; canonical?: boolean }
  ): BoxedExpression;

  /** Return a canonical boxed string */
  string(s: string, metadata?: Metadata): BoxedExpression;

  /** Return a canonical boxed domain.
   *
   * If the domain is invalid, may return an `["Error"]` expression
   *
   */
  domain(
    domain: SemiBoxedExpression | BoxedDomain | string,
    metadata?: Metadata
  ): BoxedDomain;

  /**
   * Return a canonical expression.
   *
   * Note that the result may not be a function, or may have a different
   * `head` than the one specified.
   *
   * For example:
   * `ce.fn("Rational", [ce.number(1),  ce.number(2)]))` \( \to \) `ce.number([1,2])`
   *
   */
  fn(
    head: string | SemiBoxedExpression,
    ops: SemiBoxedExpression[],
    metadata?: Metadata
  ): BoxedExpression;

  /**
   * This is a primitive to create a boxed function. It doesn't perform
   * any checks or normalization on its arguments.
   *
   * In general, consider using `ce.fn()` or `ce.box()` instead.
   *
   * The result is canonical, but the caller has to ensure that all the
   * conditions are met (i.e. `ops` properly normalized and sorted, all
   * `ops` canonical, etc..) so that the result is actually canonical.
   */
  _fn(
    head: string | BoxedExpression,
    ops: BoxedExpression[],
    metadata?: Metadata
  ): BoxedExpression;

  /** Shortcut for `this.fn("Error"...)`.
   *
   * The result is canonical.
   */
  error(
    message: string | [string, ...SemiBoxedExpression[]],
    where?: SemiBoxedExpression
  ): BoxedExpression;

  /**
   * Add a`["Hold"]` wrapper to `expr.
   */
  hold(expr: SemiBoxedExpression): BoxedExpression;

  /** Shortcut for `this.fn("Add"...)`.
   *
   * The result is canonical.
   */
  add(ops: BoxedExpression[], metadata?: Metadata): BoxedExpression;
  /** Shortcut for `this.fn("Multiply"...)`
   *
   * The result is canonical.
   */
  mul(ops: BoxedExpression[], metadata?: Metadata): BoxedExpression;
  /** Shortcut for `this.fn("Power"...)`
   *
   * The result is canonical.
   */
  power(
    base: BoxedExpression,
    exponent: number | Rational | BoxedExpression,
    metadata?: Metadata
  ): BoxedExpression;

  sqrt(base: BoxedExpression, metadata?: Metadata);

  /** Shortcut for `this.fn("Divide", [1, expr])`
   *
   * The result is canonical.
   */
  inverse(expr: BoxedExpression, metadata?: Metadata): BoxedExpression;
  /** Shortcut for `this.fn("Negate", [expr])`
   *
   * The result is canonical.
   */
  negate(expr: BoxedExpression, metadata?: Metadata): BoxedExpression;
  /** Shortcut for `this.fn("Divide", [num, denom])`
   *
   * The result is canonical.
   */
  divide(
    num: BoxedExpression,
    denom: BoxedExpression,
    metadata?: Metadata
  ): BoxedExpression;

  /** Shortcut for `this.fn("Pair"...)`
   *
   * The result is canonical.
   */
  pair(
    first: BoxedExpression,
    second: BoxedExpression,
    metadata?: Metadata
  ): BoxedExpression;

  /** Shortcut for `this.fn("Tuple"...)`
   *
   * The result is canonical.
   */
  tuple(elements: BoxedExpression[], metadata?: Metadata): BoxedExpression;

  rules(rules: Rule[]): BoxedRuleSet;
  pattern(expr: LatexString | SemiBoxedExpression): Pattern;

  /**
   * Parse a string of LaTeX and return a corresponding `BoxedExpression`.
   *
   * The result may not be canonical.
   *
   */
  parse(
    s: LatexString | string,
    options?: { canonical?: boolean }
  ): BoxedExpression;
  parse(s: null, options?: { canonical?: boolean }): null;
  parse(
    s: LatexString | string | null,
    options?: { canonical?: boolean }
  ): null | BoxedExpression;

  /** Serialize a `BoxedExpression` or a `MathJSON` expression to
   * a LaTeX string
   */
  serialize(expr: SemiBoxedExpression): LatexString;

  /**
   * Options to control the serialization of MathJSON expression to LaTeX
   * when using `this.latex` or `this.engine.serialize()`.
   *
   *
   * {@inheritDoc  NumberFormattingOptions}
   * {@inheritDoc  ParseLatexOptions}
   * {@inheritDoc  SerializeLatexOptions}
   *
   */
  get latexOptions(): NumberFormattingOptions &
    ParseLatexOptions &
    SerializeLatexOptions;
  set latexOptions(
    opts: Partial<NumberFormattingOptions> &
      Partial<ParseLatexOptions> &
      Partial<SerializeLatexOptions>
  );

  /** {@inheritDoc  JsonSerializationOptions} */
  get jsonSerializationOptions(): Readonly<JsonSerializationOptions>;
  set jsonSerializationOptions(val: Partial<JsonSerializationOptions>);

  pushScope(
    symbolTable?: Readonly<IDTable> | Readonly<IDTable>[],
    scope?: Partial<Scope>
  ): void;
  popScope(): void;

  /** Assign a value to an identifier in the current scope. Use `null` to reset the identifier to no value */
  set(identifiers: { [identifier: string]: SemiBoxedExpression | null }): void;

  /** Declare identifiers (specify their domain without necessarily assigning them a value in the current scope*/
  let(identifiers: {
    [identifier: string]: SymbolDefinition | FunctionDefinition;
  }): void;

  /**
   * Add an assumption.
   *
   * Note that the assumption is put into canonical form before being added.
   *
   * @param symbol - The symbol to make an assumption about
   *
   * Returns:
   * - `contradiction` if the new assumption is incompatible with previous
   * ones.
   * - `tautology` if the new assumption is redundant with previous ones.
   * - `ok` if the assumption was successfully added to the assumption set.
   *
   *
   */
  assume(
    symbol: LatexString | SemiBoxedExpression,
    domain: BoxedDomain
  ): AssumeResult;
  assume(predicate: LatexString | SemiBoxedExpression): AssumeResult;
  assume(
    arg1: LatexString | SemiBoxedExpression,
    arg2?: BoxedExpression
  ): AssumeResult;

  /** Remove all assumptions about one or more symbols */
  forget(symbol?: string | string[]): void;

  get assumptions(): ExpressionMapInterface<boolean>;

  ask(pattern: LatexString | SemiBoxedExpression): BoxedSubstitution[];

  /**
   * When `condition` is false, signal.
   *
   * - `condition` - If `true`, do nothing. If `false`, signal.
   *
   * @experimental
   */
  assert(
    condition: boolean,
    expr: BoxedExpression,
    msg: string,
    code?: SignalMessage
  );
  signal(expr: BoxedExpression, msg: string, code?: SignalMessage): void;
  signal(sig: WarningSignal): void;
  /** @internal */
  shouldContinueExecution(): boolean;
  /** @internal */
  checkContinueExecution(): void;

  /** @internal */
  cache<T>(name: string, build: () => T, purge?: (T) => T | undefined): T;

  readonly stats: ComputeEngineStats;

  /** @internal */
  reset(): void;
  /** @internal */
  _register(expr: BoxedExpression): void;
  /** @internal */
  _unregister(expr: BoxedExpression): void;
}
