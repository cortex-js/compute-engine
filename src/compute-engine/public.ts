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
 * - `auto`: use machine number if precision is 15 or less, allow complex numbers.
 * - `machine`: 64-bit float, **IEEE 754-2008**, 64-bit float, 52-bit mantissa,
 *    about 15 digits of precision
 * - `decimal`: arbitrary precision floating point numbers, as provided by the
 * "decimal.js" library
 * - `complex`: complex number represented by two machine numbers, a real and
 * an imaginary part, as provided by the "complex.js" library
 */
export type NumericMode = 'auto' | 'machine' | 'decimal' | 'complex';

/** Options for `BoxedExpression.simplify()`
 *
 */
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
  /** If true, apply replacement rules to all sub-expressions.
   * If false, only consider the top-level expression.
   *
   * **Default**: `true`
   */
  recursive?: boolean;
  /**
   * If true, stop after the first rule that matches.
   *
   * If false, apply all the remaining rules even after the first match.
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
    condition?: LatexString | ((wildcards: Substitution) => boolean);
    priority?: number;
  }
];

export type BoxedRule = [
  lhs: Pattern,
  rhs: BoxedExpression,
  priority: number,
  condition: undefined | ((wildcards: Substitution) => boolean)
];

export type BoxedRuleSet = Set<BoxedRule>;

export type ParametricDomainFunction =
  | 'Function'
  | 'Union'
  | 'List'
  | 'Record'
  | 'Tuple'
  | 'Intersection'
  | 'Range'
  | 'Interval'
  | 'Optional'
  | 'Some'
  | 'Head'
  | 'Symbol'
  | 'Literal';

export type ParametricDomain = [
  ParametricDomainFunction,
  ...DomainExpression[]
];

export type DomainExpression = string | ParametricDomain;

/**
 * Domains can be defined as a union or intersection of domains:
 * - `["Union", "Number", "Boolean"]` A number or a boolean.
 * - `["SetMinus", "Number", 1]`  Any number except "1".
 *
 */
export interface Domain extends BoxedExpression {
  isSubdomainOf(dom: Domain | string): boolean;
  isMemberOf(expr: BoxedExpression): boolean;
  readonly domainExpression: DomainExpression;
  codomain: Domain | null;
  readonly isNothing: boolean;
  is(s: BoxedExpression): boolean;
  readonly isBoolean: boolean;
  readonly isNumeric: boolean;
  readonly isFunction: boolean;
  readonly isPredicate: boolean;
  /**
   * If true, when all the arguments are numeric, the result of the
   * evaluation is numeric. Numeric is any value with a domain of `Number`.
   *
   * Example of numeric functions: `Add`, `Multiply`, `Power`, `Abs`
   *
   * Default: false
   */
  readonly isNumericFunction: boolean;
  readonly isRealFunction: boolean;
  /**
   * If true, when all the arguments are boolean, the result of the
   * evaluation is a boolean. Boolean is any value with a domain of `MaybeBoolean`.
   *
   * Example of logic functions: `And`, `Or`, `Not`, `Implies`
   *
   * **Default:** false
   */
  readonly isLogicOperator: boolean;
  /**
   * The function represent a relation between the first argument and
   * the second argument, and evaluates to a boolean indicating if the relation
   * is satisfied.
   *
   * For example, `Equal`, `Less`, `Approx`, etc...
   *
   * **Default:** false
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
   * **Default**: `['all']`
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
  repeatingDecimal: boolean;
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
  /** The Compute Engine associated with this expression provides
   * a context in which to interpret it, such as definition of symbols
   * and functions.
   */
  readonly engine: IComputeEngine;

  /** From `Object.valueOf()`, return a primitive value for the expression.
   *
   * If the expression is a machine number, or a Decimal that can be
   * converted to a machine number, return a `number`.
   *
   * If the expression is a rational number, return `[number, number]`.
   *
   * If the expression is a symbol, return the name of the symbol as a `string`.
   *
   * Otherwise return a LaTeX representation of the expression.
   *
   * @category Object Methods
   */
  valueOf(): number | string | [number, number];
  /** From `Object.toString()`, return a LaTeX representation of the expression.
   *
   * @category Object Methods
   */
  toString(): string;
  /** From `Object.toJSON()`, equivalent to `JSON.stringify(this.json)`
   *
   * @category Object Methods
   */
  toJSON(): string;
  /** From `Object.is()`. Equivalent to `BoxedExpression.isSame()`
   *
   * @category Object Methods
   *
   */
  is(rhs: unknown): boolean;

  /** @internal */
  get hash(): number;

  /** An optional short description of the symbol or function head.
   *
   * May include markdown. Each string is a paragraph. */
  readonly description: string[];

  /** An optional URL pointing to more information about the symbol or function head */
  readonly url: string;

  /** All boxed expressions have a head.
   *
   * If not a function this can be `Symbol`, `String`, `Number` or `Dictionary`.
   *
   * If the head expression can be represented as a string, it is returned
   * as a string.
   */
  get head(): BoxedExpression | string;

  /**
   * If `this.isPure` is `true`, this is a synonym for `this.evaluate()`.
   * Otherwise, it returns `undefined`.
   */
  get value(): BoxedExpression | undefined;

  /** Only the value of variables can be changed (symbols that are not constants) */
  set value(value: BoxedExpression | number | undefined);

  /** Return an approximation of the value of this expression. Floating-point
   * operations may be performed.
   *
   * Just like `this.value`, it returns `undefined` for impure expressions.
   */
  get numericValue(): BoxedExpression | undefined;

  /** If true, the value of the expression never changes and evaluating it has
   * no side-effects.
   * If false, the value of the expression may change, if the
   * value of other expression changes or for other reasons.
   *
   * If `this.isPure` is `false`, `this.value` is undefined. Call
   * `this.evaluate()` to determine the value of the expression instead.
   *
   * As an example, the `Random` function is not pure.
   */
  get isPure(): boolean;

  /**
   * If `true`, this expression represents a value that was not calculated
   * or that does not reference another expression.
   * This means the expression is either a number, a string or a dictionary.
   * Functions and symbols are not literals.
   */
  get isLiteral(): boolean;

  /** If `true`, this expression is in a canonical form */
  get isCanonical(): boolean;

  /** For internal use only, set when a canonical expression is created.
   * @internal
   */
  set isCanonical(val: boolean);

  // ----- FUNCTION

  /** `ops` is the list of arguments of the function, its "tail"
   *
   * @category Function Expression
   *
   */
  get ops(): null | BoxedExpression[];

  /** If this expression is a function, the number of operands, otherwise 0.
   *
   * Note that a function can have 0 operands, so to check if this expression
   * is a function, check if `this.ops !== null` instead.
   *
   * @category Function Expression
   *
   */
  get nops(): number;

  /** First operand, i.e.`this.ops[0]`
   *
   *
   * @category Function Expression
   *
   *
   */
  get op1(): BoxedExpression;

  /** Second operand, i.e.`this.ops[0]`
   *
   *
   * @category Function Expression
   *
   *
   */
  get op2(): BoxedExpression;

  /** Third operand, i.e. `this.ops[2]`
   *
   *
   * @category Function Expression
   *
   *
   */
  get op3(): BoxedExpression;

  // ----- DICTIONARY

  /** The keys of the dictionary.
   *
   * If this expression not a dictionary, return `null`
   *
   * @category Dictionary Expression
   *
   */
  get keys(): IterableIterator<string> | null;

  /**
   *
   * @category Dictionary Expression
   */
  get keysCount(): number;
  /**
   * If this expression is a dictionary, return the value of the `key` entry.
   *
   * @category Dictionary Expression
   *
   */
  getKey(key: string): BoxedExpression | undefined;
  /**
   * If this expression is a dictionary, return true if the dictionary has a
   * `key` entry.
   *
   * @category Dictionary Expression
   *
   */
  hasKey(key: string): boolean;

  // ----- NUMBER/SYMBOL

  /**
   * Return the value of this number or symbol, if stored as a machine number.
   *
   * Note it is possible for `machineValue` to be `null`, and for `isNotZero` to be true.
   * For example, when a symbol has been defined with an assumption.
   *
   * If `machineValue` is not `null`, then `decimalValue`, `rationalValue`
   * and `complexValue` are `null.
   *
   * @category Numeric Expression
   *
   */
  get machineValue(): number | null;

  /** If the value of this expression is a rational number, return it.
   * Otherwise, return `[null, null]`.
   *
   * If `rationalValue` is not `[null, null]`, then `machineValue`, `decimalValue`
   * and `complexValue` are `null.
   *
   * @category Numeric Expression
   *
   */
  get rationalValue(): [numer: number, denom: number] | [null, null];

  /** If the value of this expression is a `Decimal` number, return it.
   * Otherwise, return `null`.
   *
   * A `Decimal` number is an arbitrarily long floating point number.
   *
   * If `decimalValue` is not `null`, then `machineValue`
   * and `complexValue` are `null` and `rationalValue` is `[null, null]`.
   *
   * @category Numeric Expression
   *
   */
  get decimalValue(): Decimal | null;

  /** If the value of this expression is a `Complex` number, return it.
   * Otherwise, return `null`.
   *
   * If `complexValue` is not `null`, then `machineValue`, `rationalValue`
   * and `decimalValue` are `null.
   *
   * @category Numeric Expression
   *
   *
   */
  get complexValue(): Complex | null;

  /** Return an approximation of the numeric value of this expression as
   * a 64-bit floating point number.
   *
   * If the value is a machine number, return it exactly.
   *
   * If the value is a rational number, return the numerator divided by the
   * denominator.
   *
   * If the value is a Decimal number that can be represented by a machine
   * number, return this value. There might be a small loss of precision due
   * to the limitations of the binary representation of numbers as machine
   * numbers.
   *
   * If the value of this expression cannot be represented by a float,
   * return `null`.
   *
   * @category Numeric Expression
   *
   *
   */
  get asFloat(): number | null;

  /**
   * If the value of this expression is an integer with a 'small' absolute value,
   * return this value. Otherwise, return `null`.
   *
   * Some calculations, for example to put in canonical forms, are only
   * performed if they are safe from overflow. This method makes it easy
   * to check for this, whether the value is a Decimal or a number.
   *
   * By default, "small" is less than 10,000.
   *
   * @category Numeric Expression
   *
   */
  get asSmallInteger(): number | null;

  /**
   * If the value of this an expression is a small integer or a rational,
   * return this value. Otherwise, return `[null, null`].
   *
   * @category Numeric Expression
   *
   */
  get asRational(): [number, number] | [null, null];

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
   * If a symbol, this does take assumptions into account, that is `this.sgn` will return
   * `1` if `isPositive` is `true`, even if this expression has no value
   *
   * @category Numeric Expression
   *
   */
  get sgn(): -1 | 0 | 1 | undefined | null;

  // ----- SYMBOL

  /** If this expression is a symbol, return the name of the symbol as a string.
   * Otherwise, return `null`.
   *
   * @category Symbol Expression
   *
   */
  get symbol(): string | null;

  /**  Shortcut for `this.symbol === "Missing"`
   *
   * @category Symbol Expression
   *
   */
  get isMissing(): boolean;

  // ----- STRING

  /** If this expression is a string, return the value of the string.
   * Otherwise, return `null`.
   *
   * @category String Expression
   *
   */
  get string(): string | null;

  //
  // --- PREDICATES
  //

  /** True if the value of this expression is a number.
   *
   * `isExtendedComplex || isNaN` = `isReal || isImaginary || isInfinity || isNaN`
   *
   * Note that in a fateful twist of cosmic irony, `NaN` ("Not a Number")
   * is a number.
   *
   * @category Expression Properties
   */
  get isNumber(): boolean | undefined;

  /** The value of this expression is an element of the set ℤ: ...,-2, -1, 0, 1, 2...
   *
   *
   * @category Expression Properties
   *
   */
  get isInteger(): boolean | undefined;

  /** The value of this expression is an element of the set ℚ, p/q with p ∈ ℕ, q ∈ ℤ ⃰  q >= 1
   *
   * Note that every integer is also a rational.
   *
   *
   * @category Expression Properties
   *
   */
  get isRational(): boolean | undefined;

  /**
   * The value of this expression is a number that is the root of a non-zero
   * univariate polynomial with rational coefficients.
   *
   * All integers and rational numbers are algebraic.
   *
   * Transcendental numbers, such as \\( \pi \\) or \\( e \\) are not algebraic.
   *
   *
   * @category Expression Properties
   *
   */
  get isAlgebraic(): boolean | undefined;
  /**
   * The value of this expression is real number: finite and not imaginary.
   *
   * `isFinite && !isImaginary`
   *
   *
   * @category Expression Properties
   */
  get isReal(): boolean | undefined;

  /** Real or ±Infinity
   *
   * `isReal || isInfinity`
   *
   *
   * @category Expression Properties
   */
  get isExtendedReal(): boolean | undefined;

  /**
   * The value of this expression is a number, but not `NaN` or any Infinity
   *
   * `isReal || isImaginary`
   *
   *
   * @category Expression Properties
   *
   */
  get isComplex(): boolean | undefined;

  /** `isReal || isImaginary || isInfinity`
   *
   *
   * @category Expression Properties
   */
  get isExtendedComplex(): boolean | undefined;

  /** The value of this expression is a number with a imaginary part
   *
   *
   * @category Expression Properties
   */
  get isImaginary(): boolean | undefined;

  /**
   * @category Expression Properties
   */
  get isZero(): boolean | undefined;
  /**
   * @category Expression Properties
   */
  get isNotZero(): boolean | undefined;
  /**
   * @category Expression Properties
   */
  get isOne(): boolean | undefined;
  /**
   * @category Expression Properties
   */
  get isNegativeOne(): boolean | undefined;

  /** ±Infinity or Complex Infinity
   *
   * @category Expression Properties
   */
  get isInfinity(): boolean | undefined;
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
  get isNaN(): boolean | undefined;

  /** Not ±Infinity and not `NaN`
   *
   * @category Expression Properties
   */
  get isFinite(): boolean | undefined;

  /**
   * @category Expression Properties
   */
  get isEven(): boolean | undefined;
  /**
   * @category Expression Properties
   */
  get isOdd(): boolean | undefined;
  /**
   * @category Expression Properties
   */
  get isPrime(): boolean | undefined;
  /**
   * @category Expression Properties
   */
  get isComposite(): boolean | undefined;

  /** Structural/symbolic equality (weak equality).
   *
   * `ce.parse('1+x').isSame(ce.parse('x+1'))` is `false`
   *
   * @category Relational Operator
   */
  isSame(rhs: BoxedExpression): boolean;

  /**
   * True if the expression includes a symbol `v` or a function head `v`.
   */
  has(v: string | string[]): boolean;

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
   */
  match(
    rhs: BoxedExpression,
    options?: PatternMatchOption
  ): Substitution | null;

  /** Mathematical equality (strong equality), that is the value
   * of this expression and of `rhs` are numerically equal.
   *
   * Both expressions are numerically evaluated.
   *
   * Numbers whose difference is less than `engine.tolerance` are
   * considered equal. This tolerance is set when the `engine.precision` is
   * changed to be such that the last two digits are ignored.
   *
   * @category Relational Operator
   */
  isEqual(rhs: BoxedExpression): boolean;

  /** If the expressions cannot be compared, `undefined` is returned
   *
   * @category Relational Operator
   */
  isLess(rhs: BoxedExpression): boolean | undefined;
  /**
   * @category Relational Operator
   */
  isLessEqual(rhs: BoxedExpression): boolean | undefined;
  /**
   * @category Relational Operator
   */
  isGreater(rhs: BoxedExpression): boolean | undefined;
  /**
   * @category Relational Operator
   */
  isGreaterEqual(rhs: BoxedExpression): boolean | undefined;

  /** The value of this expression is > 0, same as `isGreater(0)`
   *
   * @category Expression Properties
   */
  get isPositive(): boolean | undefined;

  /** The value of this expression is  >= 0, same as `isGreaterEqual(0)`
   *
   * @category Expression Properties
   */
  get isNonNegative(): boolean | undefined;

  /** The value of this expression is  < 0, same as `isLess(0)`
   *
   * @category Expression Properties
   */
  get isNegative(): boolean | undefined;

  /** The value of this expression is  <= 0, same as `isLessEqual(0)`
   *
   * @category Expression Properties
   */
  get isNonPositive(): boolean | undefined;

  //
  // ----- OTHER OPERATIONS
  //

  /** Wikidata identifier */
  get wikidata(): string;
  set wikidata(val: string);

  /** MathJSON representation of this expression */
  get json(): Expression;

  /** LaTeX representation of this expression */
  get latex(): LatexString;
  set latex(val: string);

  /** Expressions with a higher complexity score are sorted
   * first in commutative functions
   */
  get complexity(): number;

  /** The domain of this expression. */
  get domain(): Domain;

  /** Symbols that represent a variable, can have their domain modified */
  set domain(domain: Domain | string);

  /** The domain of the value of this expression, using the value of the expression,
   * definitions associated with this expression and assumptions if necessary.
   *
   * For symbols, the `domain` and `valueDomain` are the same.  For functions,
   * the `valueDomain` is the codomain of the function.
   */
  get valueDomain(): Domain;

  /** For symbols and functions, a possible definition associated with the expression */
  get functionDefinition(): BoxedFunctionDefinition | undefined;
  get symbolDefinition(): BoxedSymbolDefinition | undefined;

  /**
   * Return the canonical form of this expression.
   *
   * If a function, consider the function definition flags:
   * - `associative`: \\( f(a, f(b), c) \longrightarrow f(a, b, c) \\)
   * - `idempotent`: \\( f(f(a)) \longrightarrow f(a) \\)
   * - `involution`: \\( f(f(a)) \longrightarrow a \\)
   * - `commutative`: sort the arguments.
   *
   * Additionally, some simplifications involving exact computations on
   * small integers may be performed.
   *
   * For example:
   * - \\( 2 + x + 1 \longrightarrow x + 3 \\)
   * - \\( \sqrt{4} \longrightarrow 2 \\)
   * - \\(\frac{4}{10} \longrightarrow \frac{2}{5} \\).
   *
   * However, no calculation is performed involving floating point numbers, so
   * \\( \sqrt(2) \longrightarrow \sqrt(2) \\).
   *
   * Determining the canonical form does not depend on the values assigned to,
   * or assumptions about, symbols.
   */
  get canonical(): BoxedExpression;

  /**
   * Return a simpler form of this expression.
   *
   * The expression is first converted to canonical form. Then a series of
   * rewriting rules are applied repeatedly, until no rules apply.
   *
   * If a custom `simplify` handler is associated with this function definition,
   * it is invoked.
   *
   * The values assigned to symbols and the assumptions about symbols may be
   * used, for example `arg.isInteger` or `arg.isPositive`.
   *
   * No calculations involving floating point numbers are performed but exact
   * calculations may be performed, for example
   * \\( \sin(\frac{\pi}{4}) \longrightarrow \frac{\sqrt{2}}{2} \\).
   *
   * The result is in canonical form.
   *
   */
  simplify(options?: SimplifyOptions): BoxedExpression;

  /**
   * Return the value of this expression.
   *
   * The expression is first converted to canonical form.
   *
   * A pure expression always return the same value and has no side effects.
   * If `this.isPure` is `true`, `this.value` and `this.evaluate()` are synonyms.
   * For an impure expression, `this.value` is undefined.
   *
   * Evaluating an impure expression may have some side effects, for
   * example modifying the `ComputeEngine` environment, such as its set of assumptions.
   *
   * Only exact calculations are performed, no floating point calculations.
   * To perform approximate floating point calculations, use `this.N()` instead.
   *
   * The result of `this.evaluate()` may be the same as `this.simplify()`.
   *
   * The result is in canonical form.
   *
   */
  evaluate(options?: EvaluateOptions): BoxedExpression;

  /** Return a numeric approximation of this expression.
   *
   * The expression is first converted to canonical form.
   *
   * Any necessary calculations, including on floating point numbers,
   * are performed. The calculations are performed according
   * to the `numericMode` and `precision` properties of the `ComputeEngine`.
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
   * If this expression is a function, apply the function `fn` to all its operands.
   * Replace the head of this expression with `head`, if defined.
   *
   * If this expression is a dictionary, return a new dictionary with the values
   * modified by `fn`.
   *
   * If `head` is provided, return a function
   * with the modified dictionary as operand, otherwise return the
   * modified dictionary. */
  apply(
    fn: (x: BoxedExpression) => SemiBoxedExpression,
    head?: string
  ): BoxedExpression;

  /**
   * Transform the expression by according to the rules:
   * the matching `lhs` of a rule is replaced by its `rhs`.
   *
   * If no rules apply, return `null`.
   *
   * See also `subs` for a simple substitution.
   */
  replace(
    rules: BoxedRuleSet,
    options?: ReplaceOptions
  ): null | BoxedExpression;

  /**
   * Replace all the symbols in the expression as indicated.
   *
   * Note the same effect can be achieved with `this.replace()`, but
   * using `this.subs()` is more efficient, and simpler.
   *
   */
  subs(sub: Substitution): BoxedExpression;

  /**
   * Update the definition associated with this expression, taking
   * into account the current context.
   *
   * @internal
   */
  _repairDefinition(): void;

  /** Purge any cached values.
   *
   * @internal
   */
  _purge(): undefined;
}

/** A semi boxed expression is an MathJSON expression which can include some
 * boxed terms.
 *
 * This is convenient when creating new expressions from portions
 * of an existing `BoxedExpression` while avoiding unboxing and reboxing.
 */
export type SemiBoxedExpression =
  | BoxedExpression
  | number
  | Decimal
  | Complex
  | MathJsonNumber
  | MathJsonString
  | MathJsonSymbol
  | string
  | MathJsonFunction
  | MathJsonDictionary
  | SemiBoxedExpression[];

export type LambdaExpression = SemiBoxedExpression;
export type BoxedLambdaExpression = BoxedExpression;

export type PatternMatchOption = {
  recursive?: boolean;
  numericTolerance?: number;
  exact?: boolean;
};

export interface Pattern extends BoxedExpression {
  /**
   * If `expr` does not match the pattern, return `null`.
   *
   * Otherwise, return a substitution describing the values that the named
   * wildcard in the pattern should be changed to in order for the pattern to be
   * equal to the expression. If there are no named wildcards and the expression
   * matches the pattern, and empty object literal `{}` is returned.
   */
  match(
    expr: BoxedExpression,
    options?: PatternMatchOption
  ): Substitution | null;
  /** If `expr` matches the pattern, return `true`, otherwise `false` */
  test(expr: BoxedExpression, options?: PatternMatchOption): boolean;
  /** Return the number of exprs that matched the pattern */
  count(exprs: Iterable<BoxedExpression>, options?: PatternMatchOption): number;
  subs(sub: Substitution): Pattern;
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
 * A dictionary contains definitions for symbols, functions and rules.
 *
 */
export type Dictionary = {
  symbols?: SymbolDefinition[];
  functions?: FunctionDefinition[];
  simplifyRules?: BoxedRuleSet;
};

/**
 * The entries of a `CompiledDictionary` have been validated and
 * optimized for faster evaluation.
 *
 * When a new scope is created with `pushScope()` or when creating a new
 * engine instance, new instances of `RuntimeDictionary` are created as needed.
 */
export type RuntimeDictionary = {
  symbols: Map<string, BoxedSymbolDefinition>;
  symbolWikidata: Map<string, BoxedSymbolDefinition>;
  functions: Map<string, BoxedFunctionDefinition[]>;
  functionWikidata: Map<string, BoxedFunctionDefinition>;
};

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
  parentScope: RuntimeScope;

  dictionary?: RuntimeDictionary;

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
  /** The name of the symbol or function for this definition
   *
   * The name of a symbol or function is an arbitrary string of Unicode
   * characters, however the following conventions are recommended:
   *
   * - Use only letters, digits and `-`, and the first character should be
   * a letter: `/^[a-zA-Z][a-zA-Z0-9-]+/`
   * - Built-in functions and symbols should start with an uppercase letter
   *
   */
  name: string;

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

  /**
   * The domain of this item.
   *
   * For dictionaries, this is the domain of all the items in the dictionary.
   *
   * For strings, it's always 'String'.
   *
   * For symbols, this is the domain of their value.
   *
   * For functions, this is the signature of the function
   *
   * When `domain` is a handler, calculate the domain (or signature) based on
   * the arguments (for expressions others than functions, `args` is an empty
   * array). If the function cannot be applied to the arguments, return
   * `null`.
   */
  domain?:
    | Domain
    | DomainExpression
    | string
    | ((
        ce: IComputeEngine,
        args: BoxedExpression[]
      ) => Domain | DomainExpression);
};

export type BoxedBaseDefinition = {
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
  domain?:
    | Domain
    | ((
        ce: IComputeEngine,
        args: BoxedExpression[]
      ) => Domain | DomainExpression);

  _purge(): undefined;
};

/**
 * A function definition can have some flags to indicate specific
 * properties of the function.
 */
export type FunctionDefinitionFlags = {
  /**  If true, the function is applied element by element to lists, matrices
   * and equations.
   *
   * **Default**: `false`
   */
  threadable: boolean;

  /** If true, `["f", ["f", a], b]` simplifies to `["f", a, b]`
   *
   * **Default**: `false`
   */
  associative: boolean;

  /** If true, `["f", a, b]` equals `["f", b, a]`. The canonical
   * version of the function will order the arguments.
   *
   * **Default**: `false`
   */
  commutative: boolean;

  /** If true, when the function is univariate, `["f", ["Add", x, c]]` where `c`
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

  /** If true, when the function is univariate, `["f", ["Multiply", x, y]]`
   * simplifies to `["Multiply", ["f", x], ["f", y]]`.
   *
   * When the function is multivariate, multiplicativity is considered only on the
   * first argument: `["f", ["Multiply", x, y], z]` simplifies to
   * `["Multiply", ["f", x, z], ["f", y, z]]`
   *
   * **Default**: `false`
   */
  // multiplicative: boolean;

  /** If true, when the function is univariate, `["f", ["Multiply", x, c]]`
   * simplifies to `["Multiply", ["f", x], c]` where `c` is constant
   *
   * When the function is multivariate, multiplicativity is considered only on the
   * first argument: `["f", ["Multiply", x, y], z]` simplifies to
   * `["Multiply", ["f", x, z], ["f", y, z]]`
   *
   * Default: `false`
   */
  // outtative: boolean;

  /** If true, `["f", ["f", x]]` simplifies to `["f", x]`.
   *
   * **Default**: `false`
   */
  idempotent: boolean;

  /** If true, `["f", ["f", x]]` simplifies to `x`.
   *
   * **Default**: `false`
   */
  involution: boolean;

  /** If true, the value of this function is always the same for a given
   * set of arguments and it has no side effects.
   *
   * An expression using this function is pure if the function and all its
   * arguments are pure.
   *
   * For example `Sin` is pure, `Random` isn't.
   *
   * This information may be used to cache the value of expressions.
   *
   * **Default:** true
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
};

/**
 * Definition record for a function.
 *
 */
export type FunctionDefinition = BaseDefinition &
  Partial<FunctionDefinitionFlags> & {
    /**
     * A number used to order arguments. Argument with higher
     * complexity are placed after arguments with lower complexity when
     * ordered canonically in commutative functions.
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
     * - `none` Each of the arguments is evaluated (default)
     * - `all` None of the arguments are evaluated and they are passed as is
     * - `first` The first argument is not evaluated, the others are
     * - `rest` The first argument is evaluated, the others aren't
     */

    hold?: 'none' | 'all' | 'first' | 'rest' | 'last' | 'most';

    /**
     * If true, `Sequence` arguments appearing in the arguments of a function
     * should not automatically be flattened out
     */
    sequenceHold?: boolean;

    /** The minimum and maximum values of the result of the function */
    range?: [min: number, max: number];

    /**
     * Return the canonical form of the expression with the arguments `args`.
     *
     * All the arguments that are not subject to a hold are in canonical form.
     * Any `Nothing` argument has been removed.
     *
     * If the function is associative, idempotent or an involution,
     * it should handle its arguments accordingly. Notably, if it
     * is commutative, the arguments should be sorted in canonical order.
     *
     * The handler can make transformations based on the value of the arguments
     * that are literal and either rational numbers (i.e.
     * `arg.isLiteral && arg.isRational`) or integers (i.e.
     * `isLiteral && arg.isInteger`).
     *
     * The handler should not consider the value of the arguments
     * that are symbols or functions.
     *
     * The handler should not consider any assumptions about any of the
     * arguments that are symbols or functions i.e. `arg.isZero`,
     * `arg.isInteger`, etc...
     *
     * The handler should not make transformations based on the value of
     * floating point numbers.
     *
     * The result of the handler should be a canonical expression.
     *
     */
    canonical?: (
      ce: IComputeEngine,
      args: BoxedExpression[]
    ) => BoxedExpression;

    /**
     * Rewrite an expression into a simpler form.
     *
     * The arguments are in canonical form and have been simplified.
     *
     * The handler can use the values assigned to symbols and the assumptions about
     * symbols, for example with `arg.machineValue`, `arg.isInteger` or
     * `arg.isPositive`.
     *
     * Even though a symbol may not have a value, there may be some information
     * about it reflected for example in `this.isZero` or `this.isPrime`.
     *
     * The handler should not perform approximate numeric calculations, such
     * as calculations involving floating point numbers. Making exact
     * calculations on integers or rationals is OK. It is recommended, but not
     * required, that the calculations be limited to `this.smallIntegerValue`
     * (i.e. numeric representations of the expression as an integer of small
     * magnitude).
     *
     * This handler should not have any side-effects: do not modify
     * the environment of the `ComputeEngine` instance, do not perform I/O,
     * do not do calculations that depend on random values.
     *
     * If no simplification can be performed due to the values, domains or assumptions
     * about its arguments, for example, return `undefined`.
     *
     */
    simplify?: (
      ce: IComputeEngine,
      args: BoxedExpression[]
    ) => BoxedExpression | undefined;

    /**
     * Evaluate symbolically an expression.
     *
     * The arguments have been symbolically evaluated, except the arguments to
     * which a `hold` apply.
     *
     * It is not necessary to further simplify or evaluate the arguments.
     *
     * If the expression cannot be evaluated, due to the values, domains, or
     * assumptions about its arguments, for example, return `undefined`.
     *
     *
     */
    evaluate?:
      | LambdaExpression
      | ((
          ce: IComputeEngine,
          args: BoxedExpression[]
        ) => BoxedExpression | undefined);

    /**
     * Evaluate numerically an expression.
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
     * Also return `NaN` if the result of the evaluation would be a complex
     * number, but complex numbers are not allowed (the `engine.numericMode`
     * is not `complex` or `auto`).
     *
     * If the `ce.numericMode` is `auto` or `complex`, you may return
     * a Complex number as a result. Otherwise, if the result is a complex
     * value, return `NaN`. If Complex are not allowed, none of the arguments
     * will be complex literals.
     *
     * If the `ce.numericMode` is `decimal` or `auto` and
     * `this.engine.precision` is > 15, you may return a Decimal number.
     * Otherwise, return a `machine` number approximation. If Decimal are
     * not allowed, none of the arguments will be Decimal literal.
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

    /** Return the sign of the function given a list of arguments. */
    sgn?: (
      ce: IComputeEngine,
      args: BoxedExpression[]
    ) => -1 | 0 | 1 | undefined;

    /** Return a compiled (optimized) expression. */
    compile?: (expr: BoxedExpression) => CompiledExpression;
  };

export type BoxedFunctionDefinition = BoxedBaseDefinition &
  FunctionDefinitionFlags & {
    complexity: number;
    hold: 'none' | 'all' | 'first' | 'rest' | 'last' | 'most';
    sequenceHold: boolean;
    range?: [min: number, max: number];

    canonical?: (
      ce: IComputeEngine,
      args: BoxedExpression[]
    ) => BoxedExpression;
    simplify?: (
      ce: IComputeEngine,
      args: BoxedExpression[]
    ) => BoxedExpression | undefined;
    evaluate?:
      | BoxedLambdaExpression
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
    sgn?: (
      ce: IComputeEngine,
      args: BoxedExpression[]
    ) => -1 | 0 | 1 | undefined;

    compile?: (expr: BoxedExpression) => CompiledExpression;
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

export type SymbolDefinitionFlags = {
  /**
   * If true the value of the symbol is constant.
   *
   * If false, the symbol is a variable.
   */
  constant: boolean;

  /**
   * If false, the value of the symbol is substituted during canonicalization
   * or simplification.
   *
   * If true, the value is only replaced during a `ce.N()` or `ce.evaluate()`.
   *
   * **Default:** `true`
   */
  hold: boolean;
};

/**
 * A bound symbol (i.e. one with an associated definition) has either a domain
 * (e.g. ∀ x ∈ ℝ), a value (x = 5) or both (π: value = 3.14... domain = TranscendentalNumber)
 */
export type SymbolDefinition = BaseDefinition &
  Partial<SymbolFlags> &
  Partial<SymbolDefinitionFlags> & {
    /** `value` can be a function since for some constants, such as
     * `Pi`, the actual value depends on the `precision` setting of the
     * `ComputeEngine` */
    value?:
      | LatexString
      | SemiBoxedExpression
      | ((ce: IComputeEngine) => SemiBoxedExpression | null);

    domain?: string | Domain;

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
    Partial<SymbolFlags>,
    SymbolDefinitionFlags {
  get value(): BoxedExpression | undefined;
  set value(val: BoxedExpression | undefined);
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
  readonly ZERO: BoxedExpression;
  /** @internal */
  readonly ONE: BoxedExpression;
  /** @internal */
  readonly TWO: BoxedExpression;
  /** @internal */
  readonly HALF: BoxedExpression;
  /** @internal */
  readonly NEGATIVE_ONE: BoxedExpression;
  /** @internal */
  readonly I: BoxedExpression;
  /** @internal */
  readonly NAN: BoxedExpression;
  /** @internal */
  readonly POSITIVE_INFINITY: BoxedExpression;
  /** @internal */
  readonly NEGATIVE_INFINITY: BoxedExpression;
  /** @internal */
  readonly COMPLEX_INFINITY: BoxedExpression;

  /** @internal */
  readonly DECIMAL_NAN: Decimal;
  /** @internal */
  readonly DECIMAL_ZERO: Decimal;
  /** @internal */
  readonly DECIMAL_ONE: Decimal;
  /** @internal */
  readonly DECIMAL_TWO: Decimal;
  /** @internal */
  readonly DECIMAL_HALF: Decimal;
  /** @internal */
  readonly DECIMAL_PI: Decimal;
  /** @internal */
  readonly DECIMAL_NEGATIVE_ONE: Decimal;

  /** The current scope */
  context: RuntimeScope;

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
  defaultDomain: null | Domain;

  /** {@inheritDoc  NumericMode} */
  numericMode: NumericMode;

  tolerance: number;
  chop(n: number): number;
  chop(n: Decimal): Decimal | 0;
  chop(n: Complex): Complex | 0;
  chop(n: number | Decimal | Complex): number | Decimal | Complex;

  /** @internal */
  decimal: (a: Decimal.Value) => Decimal;
  /** @internal */
  complex: (a: number | Complex, b?: number) => Complex;

  set precision(p: number | 'machine');
  get precision(): number;

  costFunction: (expr: BoxedExpression) => number;

  /**
   * Associate a new definition to a symbol in the current context.
   *
   * If a definition existed previously, it is replaced.
   */
  defineSymbol(def: SymbolDefinition): BoxedSymbolDefinition;
  getSymbolDefinition(
    name: string,
    wikidata?: string
  ): undefined | BoxedSymbolDefinition;
  /**
   * Return `undefined` if no definition exist for this `head.
   */
  getFunctionDefinition(
    head: string,
    args?: BoxedExpression[]
  ): undefined | BoxedFunctionDefinition;

  /**
   * Returned a boxed expression from the input.
   *
   * The result may not be canonical.
   */
  box(
    expr: Decimal | Complex | [num: number, denom: number] | SemiBoxedExpression
  ): BoxedExpression;
  /** Return a canonical boxed number */
  number(
    value:
      | number
      | MathJsonNumber
      | Decimal
      | Complex
      | [num: number, denom: number],
    metadata?: Metadata
  ): BoxedExpression;
  /** Return a canonical boxed symbol */
  symbol(sym: string, metadata?: Metadata): BoxedExpression;
  /** Return a canonical boxed string */
  string(s: string, metadata?: Metadata): BoxedExpression;
  /** Return a canonical boxed domain */
  domain(
    domain: SemiBoxedExpression | Domain | string,
    metadata?: Metadata
  ): Domain;

  /** Return a canonical expression.
   *
   * Note that the result may not be a function, or may have a different
   * `head` than the one specified.
   *
   * For example `ce.fn("Add", [ce.number(2),  ce.number(3)]))` \( \to \) 5
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
   * In general, consider using `fn()` or `box()` instead.
   *
   * The result is canonical, but the caller has to ensure that all the
   * conditions are met (i.e. ops properly normalized and sorted, all
   * ops canonical, etc..) so that the result is actually canonical.
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
  error(val: BoxedExpression, message: string, messageArg: SemiBoxedExpression);

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
    exponent: number | [number, number] | BoxedExpression,
    metadata?: Metadata
  ): BoxedExpression;
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
  parse(s: LatexString | string): BoxedExpression;
  parse(s: null): null;
  parse(s: LatexString | string | null): null | BoxedExpression;

  /** Serialize a `BoxedExpression` or a `MathJSON` expression to
   * a LaTeX string
   */
  serialize(expr: SemiBoxedExpression): LatexString;

  /**
   * Options to control the serailization of MathJSON expression to LaTeX
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
  get jsonSerializationOptions(): JsonSerializationOptions;
  set jsonSerializationOptions(val: Partial<JsonSerializationOptions>);

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
    domain: Domain
  ): AssumeResult;
  assume(predicate: LatexString | SemiBoxedExpression): AssumeResult;
  assume(
    arg1: LatexString | SemiBoxedExpression,
    arg2?: BoxedExpression
  ): AssumeResult;

  /** Remove all assumptions about one or more symbols */
  forget(symbol?: string | string[]): void;

  get assumptions(): ExpressionMapInterface<boolean>;

  ask(pattern: LatexString | SemiBoxedExpression): Substitution[];

  pushScope(options?: {
    dictionary?: Readonly<Dictionary> | Readonly<Dictionary>[];
    assumptions?: (LatexString | Expression | BoxedExpression)[];
    scope?: Partial<Scope>;
  }): void;
  popScope(): void;

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
  purge(): void;
  /** @internal */
  _register(expr: BoxedExpression): void;
  /** @internal */
  _unregister(expr: BoxedExpression): void;
}
