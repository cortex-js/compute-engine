import Complex from 'complex.js';
import Decimal from 'decimal.js';
import {
  Expression,
  MathJsonNumber,
  MathJsonString,
  MathJsonSymbol,
  MathJsonFunction,
  MathJsonDictionary,
  MathJsonIdentifier,
} from '../../math-json';
import type {
  SerializeLatexOptions,
  LatexDictionaryEntry,
  ParseLatexOptions,
} from '../latex-syntax/public';
import { IndexedLatexDictionary } from '../latex-syntax/dictionary/definitions';
import { Rational } from '../numerics/rationals';
import { NumericValue } from '../numeric-value/public';

import './serialize';

/**
 * :::info[THEORY OF OPERATIONS]
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
 * :::
 *
 * To get a boxed expression, use `ce.box()` or `ce.parse()`.
 *
 * @category Boxed Expression
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
   *
   */
  readonly engine: IComputeEngine;

  /** From `Object.valueOf()`, return a primitive value for the expression.
   *
   * If the expression is a machine number, or bignum or rational that can be
   * converted to a machine number, return a JavaScript `number`.
   *
   * If the expression is a symbol, return the name of the symbol as a `string`.
   *
   * Otherwise return a JavaScript primitive representation of the expression.
   *
   * @category Primitive Methods
   */
  valueOf(): number | any | string | boolean;

  /** From `Object.toString()`, return a string representation of the
   *  expression. This string is suitable to be output to the console
   * for debugging, for example. To get a LaTeX representation of the
   * expression, use `expr.latex`.
   *
   * Used when coercing a `BoxedExpression` to a `String`.
   *
   * @category Primitive Methods
   */
  toString(): string;

  /**
   * Output to the console a string representation of the expression.
   *
   * @category Primitive Methods
   */
  print(): void;

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

  /** Serialize to a MathJSON expression with specified options*/
  toMathJson(options?: Readonly<Partial<JsonSerializationOptions>>): Expression;

  /** Serialize to a LaTeX string.
   *
   * Will ignore any LaTeX metadata.
   */
  toLatex(options?: Partial<SerializeLatexOptions>): LatexString;

  /** If `true`, this expression is in a canonical form. */
  get isCanonical(): boolean;

  /** For internal use only, set when a canonical expression is created.
   * @internal
   */
  set isCanonical(val: boolean);

  /** MathJSON representation of this expression.
   *
   * This representation always use shorthands when possible. Metadata is not
   * included.
   *
   * Numbers are converted to JavaScript numbers and may lose precision.
   *
   * The expression is represented exactly and no sugaring is applied. For
   * example, `["Power", "x", 2]` is not represented as `["Square", "x"]`.
   *
   * For more control over the serialization, use `ce.serialize()`.
   *
   * :::info[Note]
   * Applicable to canonical and non-canonical expressions.
   * :::
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
   * If the expression was parsed from LaTeX, the LaTeX representation is
   * the same as the input LaTeX.
   *
   * Otherwise, the serialization can be customized with `ComputeEngine.latexOptions`
   *
   * :::info[Note]
   * Applicable to canonical and non-canonical expressions.
   * :::
   *
   */
  get latex(): LatexString;

  /**
   *
   * :::info[Note]
   * Applicable to canonical and non-canonical expressions.
   * :::
   * @internal
   */
  set latex(val: LatexString);

  /** If this expression is a symbol, return the name of the symbol as a string.
   * Otherwise, return `null`.
   *
   * :::info[Note]
   * Applicable to canonical and non-canonical expressions.
   * :::

  * @category Symbol Expression
   *
   */
  readonly symbol: string | null;

  /** If this expression is a string, return the value of the string.
   * Otherwise, return `null`.
   *
   * :::info[Note]
   * Applicable to canonical and non-canonical expressions.
   * :::

  * @category String Expression
   *
   */
  readonly string: string | null;

  /** All the subexpressions matching the head
   *
   * :::info[Note]
   * Applicable to canonical and non-canonical expressions.
   * :::
   *
   */
  getSubexpressions(head: string): ReadonlyArray<BoxedExpression>;

  /** All the subexpressions in this expression, recursively
   *
   * :::info[Note]
   * Applicable to canonical and non-canonical expressions.
   * :::
   *
   */
  readonly subexpressions: ReadonlyArray<BoxedExpression>;

  /**
   *
   * All the symbols in the expression, recursively
   *
   * :::info[Note]
   * Applicable to canonical and non-canonical expressions.
   * :::
   *
   */
  readonly symbols: ReadonlyArray<string>;

  /**
   * All the identifiers used in the expression that do not have a value
   * associated with them, i.e. they are declared but not defined.
   */
  readonly unknowns: ReadonlyArray<string>;

  /**
   *
   * All the identifiers (symbols and functions) in the expression that are
   * not a local variable or a parameter of that function.
   *
   */
  readonly freeVariables: ReadonlyArray<string>;

  /** All the `["Error"]` subexpressions
   *
   * :::info[Note]
   * Applicable to canonical and non-canonical expressions.
   * :::
   *
   */
  readonly errors: ReadonlyArray<BoxedExpression>;

  /** All boxed expressions have a head.
   *
   * If not a function this can be `Symbol`, `String`, `Number` or `Dictionary`.
   *
   * If the head expression can be represented as a string, it is returned
   * as a string.
   *
   * :::info[Note]
   * Applicable to canonical and non-canonical expressions. The head
   * of a non-canonical expression may be different than the head of its
   * canonical counterpart. For example the canonical counterpart of `["Divide", 5, 7]` is `["Rational", 5, 7]`.
   * :::

  */
  readonly head: BoxedExpression | string;

  /** The list of arguments of the function, its "tail".
   *
   * If the expression is not a function, return `null`.
   *
   * :::info[Note]
   * Applicable to canonical and non-canonical expressions.
   * :::
   *
   * @category Function Expression
   *
   */
  readonly ops: null | ReadonlyArray<BoxedExpression>;

  /** If this expression is a function, the number of operands, otherwise 0.
   *
   * Note that a function can have 0 operands, so to check if this expression
   * is a function, check if `this.ops !== null` instead.
   *
   * :::info[Note]
   * Applicable to canonical and non-canonical expressions.
   * :::
   *
   * @category Function Expression
   *
   */
  readonly nops: number;

  /** First operand, i.e.`this.ops[0]`
   *
   * :::info[Note]
   * Applicable to canonical and non-canonical expressions.
   * :::
   *
   * @category Function Expression
   *
   *
   */
  readonly op1: BoxedExpression;

  /** Second operand, i.e.`this.ops[1]`
   *
   * :::info[Note]
   * Applicable to canonical and non-canonical expressions.
   * :::
   *
   * @category Function Expression
   *
   *
   */
  readonly op2: BoxedExpression;

  /** Third operand, i.e. `this.ops[2]`
   *
   * :::info[Note]
   * Applicable to canonical and non-canonical expressions.
   * :::
   *
   * @category Function Expression
   *
   *
   */
  readonly op3: BoxedExpression;

  /** `true` if this expression or any of its subexpressions is an `["Error"]`
   * expression.
   *
   * :::info[Note]
   * Applicable to canonical and non-canonical expressions. For
   * non-canonical expression, this may indicate a syntax error while parsing
   * LaTeX. For canonical expression, this may indicate argument domain
   * mismatch, or missing or unexpected arguments.
   * :::
   *
   * @category Symbol Expression
   *
   */
  readonly isValid: boolean;

  /**
   * An exact value is not further transformed when evaluated. To get an
   * approximate evaluation of an exact value, use `.N()`.
   *
   * Exact numbers are:
   * - rationals (including integers)
   * - complex numbers with integer real and imaginary parts (Gaussian integers)
   * - square root of rationals
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
   * :::info[Note]
   * Applicable to canonical and non-canonical expressions.
   * :::
   */
  readonly isPure: boolean;

  /** True if the expression is a constant, that is a symbol with an immutable value */
  readonly isConstant: boolean;

  /**
   * Return the canonical form of this expression.
   *
   * If this is a function expression, a definition is associated with the
   * canonical expression.
   *
   * When determining the canonical form the following function definition
   * flags are applied:
   * - `associative`: \\( f(a, f(b), c) \longrightarrow f(a, b, c) \\)
   * - `idempotent`: \\( f(f(a)) \longrightarrow f(a) \\)
   * - `involution`: \\( f(f(a)) \longrightarrow a \\)
   * - `commutative`: sort the arguments.
   *
   * If this expression is already canonical, the value of canonical is
   * `this`.
   *
   */
  get canonical(): BoxedExpression;

  /**
   * Replace all the symbols in the expression as indicated.
   *
   * Note the same effect can be achieved with `this.replace()`, but
   * using `this.subs()` is more efficient, and simpler.
   *
   * :::info[Note]
   * Applicable to canonical and non-canonical expressions.
   * :::
   *
   */
  subs(
    sub: Substitution,
    options?: { canonical?: CanonicalOptions }
  ): BoxedExpression;

  /**
   * Recursively replace all the terms in the expression as indicated.
   *
   * To remove a subexpression, return an empty Sequence expression.
   *
   * The canonical option is applied to each function subexpression after
   * the substitution is applied.
   *
   * **Default**: `{canonical: true, recursive: true}`
   */
  map(
    fn: (expr: BoxedExpression) => BoxedExpression,
    options?: { canonical: CanonicalOptions; recursive?: boolean }
  ): BoxedExpression;

  /**
   * Transform the expression by applying the rules:
   *
   * If the expression matches the `match` pattern, replace it with
   * the `replace` pattern.
   *
   * If no rules apply, return `null`.
   *
   * See also `subs` for a simple substitution.
   *
   *
   * :::info[Note]
   * Applicable to canonical and non-canonical expressions. If the
   * expression is non-canonical, the result is also non-canonical.
   * :::
   */
  replace(
    rules: BoxedRuleSet | Rule | Rule[],
    options?: ReplaceOptions
  ): null | BoxedExpression;

  /**
   * True if the expression includes a symbol `v` or a function head `v`.
   *
   * :::info[Note]
   * Applicable to canonical and non-canonical expressions.
   * :::
   */
  has(v: string | string[]): boolean;

  /** Structural/symbolic equality (weak equality).
   *
   * `ce.parse('1+x').isSame(ce.parse('x+1'))` is `false`
   *
   * :::info[Note]
   * Applicable to canonical and non-canonical expressions.
   * :::
   *
   * @category Relational Operator
   */
  isSame(rhs: BoxedExpression): boolean;

  /**
   * If this expression matches `pattern`, return a substitution that makes
   * `pattern` equal to `this`. Otherwise return `null`.
   *
   * If `pattern` includes wildcards (identifiers that start
   * with `_`), the substitution will include a prop for each matching named
   * wildcard.
   *
   * If this expression matches `pattern` but there are no named wildcards,
   * return the empty substitution, `{}`.
   *
   * Read more about [**patterns and rules**](/compute-engine/guides/patterns-and-rules/).
   *
   * :::info[Note]
   * Applicable to canonical and non-canonical expressions.
   * :::
   *
   */
  match(
    pattern:
      | Decimal
      | Complex
      | [num: number, denom: number]
      | SemiBoxedExpression
      | BoxedExpression,
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
   * @category Numeric Expression
   *
   */
  readonly isNaN: boolean | undefined;

  /**
   * The numeric value of this expression is 0.
   *
   * @category Numeric Expression
   */
  readonly isZero: boolean | undefined;
  /**
   * The numeric value of this expression is not 0.
   * @category Numeric Expression
   */
  readonly isNotZero: boolean | undefined;

  /**
   * The numeric value of this expression is not 1.
   * @category Numeric Expression
   */
  readonly isOne: boolean | undefined;

  /**
   * The numeric value of this expression is not -1.
   * @category Numeric Expression
   */
  readonly isNegativeOne: boolean | undefined;

  /** The numeric value of this expression is ±Infinity or Complex Infinity
   *
   * @category Numeric Expression
   */
  readonly isInfinity: boolean | undefined;

  /** This expression is a number, but not ±Infinity and not `NaN`
   *
   * @category Numeric Expression
   */
  readonly isFinite: boolean | undefined;

  /**
   * @category Numeric Expression
   */
  readonly isEven: boolean | undefined;

  /**
   * @category Numeric Expression
   */
  readonly isOdd: boolean | undefined;

  /**
   * @category Numeric Expression
   */
  readonly isPrime: boolean | undefined;

  /**
   * @category Numeric Expression
   */
  readonly isComposite: boolean | undefined;

  /**
   * Return the value of this expression, if a number literal.
   *
   * Note it is possible for `numericValue` to be `null`, and for `isNotZero`
   * to be true. For example, when a symbol has been defined with an assumption.
   *
   * Conversely, `isNumber` may be true even if `numericValue` is `null`,
   * example the symbol `Pi` return true for `isNumber` but `numericValue` is
   * `null`. Its value can be accessed with `.value.numericValue`
   *
   * @category Numeric Expression
   *
   */
  readonly numericValue: number | Decimal | Complex | Rational | null;

  //
  // Algebraic operations
  //
  neg(): BoxedExpression;
  inv(): BoxedExpression;
  abs(): BoxedExpression;
  add(...rhs: (number | BoxedExpression)[]): BoxedExpression;
  sub(rhs: BoxedExpression): BoxedExpression;
  mul(...rhs: (number | BoxedExpression)[]): BoxedExpression;
  div(rhs: BoxedExpression): BoxedExpression;
  pow(exp: number | BoxedExpression): BoxedExpression;
  sqrt(): BoxedExpression;
  // root(exp: number | BoxedExpression): BoxedExpression;
  // log(base?: SemiBoxedExpression): BoxedExpression;
  // exp(): BoxedExpression;

  /** The shape describes the axis of the expression.
   * When the expression is a scalar (number), the shape is `[]`.
   * When the expression is a vector, the shape is `[n]`.
   * When the expression is a matrix, the shape is `[n, m]`.
   */
  readonly shape: number[];

  /** Return 0 for a scalar, 1 for a vector, 2 for a matrix, > 2 for a multidimensional matrix. It's the length of `expr.shape` */
  readonly rank: number;

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
   * @category Numeric Expression
   */
  readonly isPositive: boolean | undefined;

  /** The numeric value of this expression is >= 0, same as `isGreaterEqual(0)`
   *
   * @category Numeric Expression
   */
  readonly isNonNegative: boolean | undefined;

  /** The numeric value of this expression is < 0, same as `isLess(0)`
   *
   * @category Numeric Expression
   */
  readonly isNegative: boolean | undefined;

  /** The numeric value of this expression is &lt;= 0, same as `isLessEqual(0)`
   *
   * @category Numeric Expression
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
   * :::info[Note]
   * `undefined` if not a canonical expression.
   * :::
   */
  readonly wikidata: string | undefined;

  /** An optional short description if a symbol or function expression.
   *
   * May include markdown. Each string is a paragraph.
   *
   * :::info[Note]
   * `undefined` if not a canonical expression.
   * :::
   *
   */
  readonly description: undefined | string[];

  /** An optional URL pointing to more information about the symbol or
   *  function head.
   *
   * :::info[Note]
   * `undefined` if not a canonical expression.
   * :::
   *
   */
  readonly url: string | undefined;

  /** Expressions with a higher complexity score are sorted
   * first in commutative functions
   *
   * :::info[Note]
   * `undefined` if not a canonical expression.
   * :::
   */
  readonly complexity: number | undefined;

  /**
   * For symbols and functions, a possible definition associated with the
   *  expression. `baseDefinition` is the base class of symbol and function
   *  definition.
   *
   * :::info[Note]
   * `undefined` if not a canonical expression.
   * :::
   *
   */
  readonly baseDefinition: BoxedBaseDefinition | undefined;

  /**
   * For functions, a possible definition associated with the expression.
   *
   * :::info[Note]
   * `undefined` if not a canonical expression or not a function.
   * :::
   *
   */
  readonly functionDefinition: BoxedFunctionDefinition | undefined;

  /**
   * For symbols, a possible definition associated with the expression.
   *
   * Return `undefined` if not a symbol
   *
   */
  readonly symbolDefinition: BoxedSymbolDefinition | undefined;

  /**
   *
   * Infer the domain of this expression.
   *
   * If the domain of this expression is already known, return `false`.
   *
   * If the domain was not set, set it to the inferred domain, return `true`
   * If the domain was previously inferred, adjust it by widening it,
   *    return `true`
   *
   * @internal
   */
  infer(domain: BoxedDomain): boolean;

  /**
   * Update the definition associated with this expression, using the
   * current scope (`ce.context`).
   *
   * @internal
   */
  bind(): void;

  /**
   *
   * Reset the cached value associated with this expression.
   *
   * Use when the environment has changed, for example the numeric mode
   * or precision, to force the expression to be re-evaluated.
   *
   * @internal
   */
  reset(): void;

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
  simplify(options?: Partial<SimplifyOptions>): BoxedExpression;

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
  N(): BoxedExpression;

  compile(
    to?: 'javascript',
    options?: { optimize: ('simplify' | 'evaluate')[] }
  ): ((args: Record<string, any>) => any | undefined) | undefined;

  solve(
    vars:
      | Iterable<string>
      | string
      | BoxedExpression
      | Iterable<BoxedExpression>
  ): null | ReadonlyArray<BoxedExpression>;

  /**
   * Return a JavaScript primitive representing the value of this expression.
   *
   * Equivalent to `expr.N().valueOf()`.
   *
   */
  get value(): number | boolean | string | object | undefined;

  /**
   * Only the value of variables can be changed (symbols that are not
   * constants).
   *
   * Throws a runtime error if a constant.
   *
   * :::info[Note]
   * If non-canonical, does nothing
   * :::
   *
   */
  set value(
    value:
      | boolean
      | string
      | Decimal
      | Complex
      | { re: number; im: number }
      | { num: number; denom: number }
      | number[]
      | BoxedExpression
      | number
      | undefined
  );

  /**
   *
   * The domain of the value of this expression.
   *
   * If a function expression, the domain  of the value of the function
   * (the codomain of the function).
   *
   * If a symbol the domain of the value of the symbol.
   *
   * Use `expr.head` to determine if an expression is a symbol or function
   * expression.
   *
   * :::info[Note]
   * If non-canonical or not valid, return `undefined`.
   * :::
   *
   */
  get domain(): BoxedDomain | undefined;

  /** Modify the domain of a symbol.
   *
   * :::info[Note]
   * If non-canonical does nothing
   * :::
   *
   */
  set domain(domain: DomainExpression | BoxedDomain | undefined);

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

/** A semi boxed expression is a MathJSON expression which can include some
 * boxed terms.
 *
 * This is convenient when creating new expressions from portions
 * of an existing `BoxedExpression` while avoiding unboxing and reboxing.
 *
 * @category Boxed Expression
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

/**
 * @category Definitions
 *
 */
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
  reset(): void;
}

/**
 * Use `contravariant` for the arguments of a function.
 * Use `covariant` for the result of a function.
 * Use `bivariant` to check the domain matches exactly.
 *
 * @category Boxed Expression
 */

export type DomainCompatibility =
  | 'covariant' // A <: B
  | 'contravariant' // A :> B
  | 'bivariant' // A <: B and A :>B, A := B
  | 'invariant'; // Neither A <: B, nor A :> B

/** A domain constructor is the head of a domain expression.
 *
 * @category Boxed Expression
 *
 */
export type DomainConstructor =
  | 'FunctionOf' // <domain-of-args>* <co-domain>
  | 'ListOf' // <domain-of-elements>
  | 'DictionaryOf'
  | 'TupleOf'
  | 'Intersection'
  | 'Union'
  | 'OptArg'
  | 'VarArg'
  | 'Covariant'
  | 'Contravariant'
  | 'Bivariant'
  | 'Invariant';

/**
 * @noInheritDoc
 *
 * @category Boxed Expression
 */
export interface BoxedDomain extends BoxedExpression {
  get canonical(): BoxedDomain;

  get json(): Expression;

  /** True if a valid domain, and compatible with `dom`
   * `kind` is '"covariant"' by default, i.e. `this <: dom`
   */
  isCompatible(
    dom: BoxedDomain | DomainLiteral,
    kind?: DomainCompatibility
  ): boolean;

  get base(): DomainLiteral;

  get ctor(): DomainConstructor | null;
  get params(): DomainExpression[];

  readonly isNumeric: boolean;
  readonly isFunction: boolean;
  // readonly isNothing: boolean;
  // readonly isBoolean: boolean;
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
  // readonly isRelationalOperator: boolean;
}

/**
 * The handlers are the primitive operations that can be performed on
 * collections.
 *
 * There are two types of collections:
 * - finite collections, such as lists, tuples, sets, matrices, etc...
 *  The `size()` handler of finite collections returns the number of elements
 * - infinite collections, such as sequences, ranges, etc...
 *  The `size()` handler of infinite collections returns `Infinity`
 *  Infinite collections are not indexable, they have no `at()` handler.
 *
 *  @category Definitions
 */
export type CollectionHandlers = {
  /** Return an iterator
   * - start is optional and is a 1-based index.
   * - if start is not specified, start from index 1
   * - count is optional and is the number of elements to return
   * - if count is not specified or negative, return all the elements from start to the endna
   *
   * If there is a `keys()` handler, there is no `iterator()` handler.
   *
   * @category Definitions
   */
  iterator: (
    expr: BoxedExpression,
    start?: number,
    count?: number
  ) => Iterator<BoxedExpression, undefined>;

  /** Return the element at the specified index.
   * The first element is `at(1)`, the last element is `at(-1)`.
   * If the index is &lt;0, return the element at index `size() + index + 1`.
   * The index can also be a string for example for dictionaries.
   * If the index is invalid, return `undefined`.
   */
  at: (
    expr: BoxedExpression,
    index: number | string
  ) => undefined | BoxedExpression;

  /** Return the number of elements in the collection.
   * An empty collection has a size of 0.
   */
  size: (expr: BoxedExpression) => number;

  /**
   * If the collection is indexed by strings, return the valid values
   * for the index.
   */
  keys: (expr: BoxedExpression) => undefined | Iterator<string>;

  /**
   * Return the index of the first element that matches the target expression.
   * The comparison is done using the `target.isEqual()` method.
   * If the expression is not found, return `undefined`.
   * If the expression is found, return the index, 1-based.
   * If the expression is found multiple times, return the index of the first
   * match.
   *
   * From is the starting index for the search. If negative, start from the end
   * and search backwards.
   */
  indexOf: (
    expr: BoxedExpression,
    target: BoxedExpression,
    from?: number
  ) => number | string | undefined;
};

/**
 * A function definition can have some flags to indicate specific
 * properties of the function.
 * @category Definitions
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

/** @category Compiling */
export type CompiledExpression = {
  evaluate?: (scope: {
    [symbol: string]: BoxedExpression;
  }) => number | BoxedExpression;
};

/**
 * @category Definitions
 *
 */
export type BoxedFunctionSignature = {
  inferredSignature: boolean;

  params: BoxedDomain[];
  optParams: BoxedDomain[];
  restParam?: BoxedDomain;
  result:
    | BoxedDomain
    | ((
        ce: IComputeEngine,
        args: ReadonlyArray<BoxedExpression>
      ) => BoxedDomain | null | undefined);

  canonical?: (
    ce: IComputeEngine,
    args: ReadonlyArray<BoxedExpression>
  ) => BoxedExpression | null;
  simplify?: (
    ce: IComputeEngine,
    args: ReadonlyArray<BoxedExpression>
  ) => BoxedExpression | undefined;
  evaluate?: (
    ce: IComputeEngine,
    args: ReadonlyArray<BoxedExpression>
  ) => BoxedExpression | undefined;
  N?: (
    ce: IComputeEngine,
    args: ReadonlyArray<BoxedExpression>
  ) => BoxedExpression | undefined;
  evalDimension?: (
    ce: IComputeEngine,
    args: ReadonlyArray<BoxedExpression>
  ) => BoxedExpression;
  sgn?: (
    ce: IComputeEngine,
    args: ReadonlyArray<BoxedExpression>
  ) => -1 | 0 | 1 | undefined;

  compile?: (expr: BoxedExpression) => CompiledExpression;
};

/** @category Definitions */
export type Hold = 'none' | 'all' | 'first' | 'rest' | 'last' | 'most';

/**
 * @category Definitions
 *
 */
export type BoxedFunctionDefinition = BoxedBaseDefinition &
  Partial<CollectionHandlers> &
  FunctionDefinitionFlags & {
    complexity: number;
    hold: Hold;

    signature: BoxedFunctionSignature;
  };

/**
 * @category Definitions
 *
 */
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

<div className="symbols-table">

| Operation | `"never"` | `"simplify"` | `"evaluate"` | `"N"` |
| :--- | :----- |
| `canonical()`|  (X) | | | |
| `simplify()` |   (X) | (X) | | |
| `evaluate()` |   (X) | (X) | (X) | |
| `"N()"` |  (X) | (X)  |  (X) | (X)  |

</div>

  * Some examples:
  * - `i` has `holdUntil: 'never'`
  * - `GoldenRatio` has `holdUntil: 'simplify'` (symbolic constant)
  * - `x` has `holdUntil: 'evaluate'` (variables)
  * - `Pi` has `holdUntil: 'N'` (special numeric constant)
  * 
  * **Default:** `evaluate`
  */
  holdUntil: 'never' | 'simplify' | 'evaluate' | 'N';
};

/**
 * When used in a `SymbolDefinition`, these flags are optional.
 *
 * If provided, they will override the value derived from
 * the symbol's value.
 *
 * For example, it might be useful to override `algebraic = false`
 * for a transcendental number.
 *
 * @category Definitions
 */
export type NumericFlags = {
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
  composite: boolean | undefined; // True if not a prime number
};

/**
 * @noInheritDoc
 * @category Definitions
 */
export interface BoxedSymbolDefinition
  extends BoxedBaseDefinition,
    SymbolAttributes,
    Partial<NumericFlags> {
  get value(): BoxedExpression | undefined;
  set value(val: SemiBoxedExpression | number | undefined);

  domain: BoxedDomain | undefined;
  // True if the domain has been inferred: while a domain is inferred,
  // it can be updated as more information becomes available.
  // A domain that is not inferred, but has been set explicitly, cannot be updated.
  inferredDomain: boolean;
}

/** @category Rules */
export type PatternReplaceFunction = (
  expr: BoxedExpression,
  wildcards: BoxedSubstitution
) => BoxedExpression | undefined;

/** @category Rules */
export type PatternConditionFunction = (
  wildcards: BoxedSubstitution,
  ce: IComputeEngine
) => boolean;

/**
 * A rule describes how to modify an expressions that matches a pattern `match`
 * into a new expression `replace`.
 *
 * - `x-1` \( \to \) `1-x`
 * - `(x+1)(x-1)` \( \to \) `x^2-1
 *
 * The patterns can be expressed as LaTeX strings or a MathJSON expressions.
 *
 * As a shortcut, a rule can be defined as a LaTeX string: `x-1 -> 1-x`.
 * The expression to the left of `->` is the `match` and the expression to the
 * right is the `replace`. When using LaTeX strings, single character variables
 * are assumed to be wildcards.
 *
 * When using MathJSON expressions, anonymous wildcards (`_`) will match any
 * expression. Named wildcards (`_x`, `_a`, etc...) will match any expression
 * and bind the expression to the wildcard name.
 *
 * In addition the sequence wildcard (`__1`, `__a`, etc...) will match
 * a sequence of one or more expressions, and bind the sequence to the
 * wildcard name.
 *
 * If `exact` is false, the rule will match variants. For example
 * 'x' will match 'a + x', 'x' will match 'ax', etc...
 * For simplification rules, you generally want `exact` to be true, but
 * to solve equations, you want it to be false. Default to true.
 *
 * When set to false, infinite recursion is possible.
 *
 * @category Rules
 */

export type Rule =
  | string
  | {
      match?: LatexString | SemiBoxedExpression | Pattern;
      replace: LatexString | SemiBoxedExpression | PatternReplaceFunction;
      condition?: LatexString | PatternConditionFunction;
      exact?: boolean; // Default to true
      priority?: number;
      id?: string; // For debugging
    };

/** @category Rules */
export type BoxedRule = {
  match?: Pattern;
  replace: BoxedExpression | PatternReplaceFunction;
  condition: undefined | PatternConditionFunction;
  priority: number;
  exact?: boolean; // If false, the rule will match variants, for example
  // 'x' will match 'a + x', 'x' will match 'ax', etc...
  // For simplification rules, you generally want exact to be true, but
  // to solve equations, you want it to be false. Default to true.
  id?: string; // For debugging
};

/** @category Rules */
export type BoxedRuleSet = Iterable<BoxedRule>;

/**
 * @noInheritDoc
 *
 * @category Pattern Matching
 */
export type Pattern = BoxedExpression;

/**
 * @category Boxed Expression
 *
 */
export type BoxedSubstitution = Substitution<BoxedExpression>;

/**
 * When provided, canonical forms are used to put an expression in a
 * "standard" form.
 *
 * Each canonical form applies some transformation to an expression. When
 * specified as an array, each transformation is done in the order in which
 * it was provided.
 *
 * - `InvisibleOperator`: replace use of the `InvisibleOperator` with
 *    another operation, such as multiplication (i.e. `2x` or function
 *    application (`f(x)`).
 * - `Number`: replace all numeric values with their
 *    canonical representation, for example, reduce
 *    rationals and replace complex numbers with no imaginary part with a real number.
 * - `Multiply`: replace negation with multiplication by -1, remove 1 from multiplications, simplify signs (`-y \times -x` -> `x \times y`), complex numbers are promoted (['Multiply', 2, 'ImaginaryUnit'] -> `["Complex", 0, 2]`)
 * - `Add`: replace `Subtract` with `Add`, removes 0 in addition, promote complex numbers (["Add", "a", ["Complex", 0, "b"] -> `["Complex", "a", "b"]`)
 * - `Power`: simplify `Power` expression, for example, `x^{-1}` -> `\frac{1}{x}`, `x^0` -> `1`, `x^1` -> `x`, `1^x` -> `1`, `x^{\frac{1}{2}}` -> `\sqrt{x}`, `a^b^c` -> `a^{bc}`...
 * - `Divide`: replace with a `Rational` number if numerator and denominator are integers, simplify, e.g. `\frac{x}{1}` -> `x`...
 * - `Flatten`: remove any unnecessary `Delimiter` expression, and flatten any associative functions, for example `["Add", ["Add", "a", "b"], "c"]` -> `["Add", "a", "b", "c"]`
 * - `Order`: when applicable, sort the arguments in a specific order, for
 *    example for addition and multiplication.
 *
 *
 * @category Boxed Expression
 */
export type CanonicalForm =
  | 'InvisibleOperator'
  | 'Number'
  | 'Multiply'
  | 'Add'
  | 'Power'
  | 'Divide'
  | 'Flatten'
  | 'Order';

export type CanonicalOptions = boolean | CanonicalForm | CanonicalForm[];

/** @category Boxed Expression */
export type DomainLiteral =
  | 'Anything'
  | 'Values'
  | 'Domains'
  | 'Void'
  | 'NothingDomain'
  | 'Booleans'
  | 'Strings'
  | 'Symbols'
  | 'Collections'
  | 'Lists'
  | 'Dictionaries'
  | 'Sequences'
  | 'Tuples'
  | 'Sets'
  | 'Functions'
  | 'Predicates'
  | 'LogicOperators'
  | 'RelationalOperators'
  | 'NumericFunctions'
  | 'RealFunctions'
  | 'Numbers'
  | 'ComplexNumbers'
  | 'ExtendedRealNumbers'
  | 'ImaginaryNumbers'
  | 'Integers'
  | 'Rationals'
  | 'PositiveNumbers'
  | 'PositiveIntegers'
  | 'NegativeNumbers'
  | 'NegativeIntegers'
  | 'NonNegativeNumbers'
  | 'NonNegativeIntegers'
  | 'NonPositiveNumbers'
  | 'NonPositiveIntegers'
  | 'ExtendedComplexNumbers'
  | 'TranscendentalNumbers'
  | 'AlgebraicNumbers'
  | 'RationalNumbers'
  | 'RealNumbers';

/** @category Boxed Expression */
export type DomainExpression<T = SemiBoxedExpression> =
  | DomainLiteral
  | ['Union', ...DomainExpression<T>[]]
  | ['Intersection', ...DomainExpression<T>[]]
  | ['ListOf', DomainExpression<T>]
  | ['DictionaryOf', DomainExpression<T>]
  | ['TupleOf', ...DomainExpression<T>[]]
  | ['OptArg', ...DomainExpression<T>[]]
  | ['VarArg', DomainExpression<T>]
  // | ['Value', T]
  // | ['Head', string]
  // | ['Symbol', string]
  | ['Covariant', DomainExpression<T>]
  | ['Contravariant', DomainExpression<T>]
  | ['Bivariant', DomainExpression<T>]
  | ['Invariant', DomainExpression<T>]
  | ['FunctionOf', ...DomainExpression<T>[]];

/** Options for `BoxedExpression.simplify()`
 *
 * @category Compute Engine
 */
export type SimplifyOptions = {
  depth: number; // Depth in the expression tree
  maxDepth: number; // Do not simplify beyong this depth
  rules: null | BoxedRuleSet;
};

/** Options for `BoxedExpression.evaluate()`
 *
 * @category Boxed Expression
 */
export type EvaluateOptions = {
  numericMode?: boolean; // Default to false
};

/**
 * The numeric evaluation mode:
 * 
<div className="symbols-table">

| Mode | |
| :--- | :----- |
| `"auto"`| Use bignum or complex numbers. |
| `"machine"` |  **IEEE 754-2008**, 64-bit floating point numbers: 52-bit mantissa, about 15 digits of precision |
| `"bignum"` | Arbitrary precision floating point numbers, as provided by the "decimal.js" library | 
| `"complex"` | Complex number represented by two machine numbers, a real and an imaginary part, as provided by the "complex.js" library |

</div>

 * @category Compute Engine
 */
export type NumericMode = 'auto' | 'machine' | 'bignum' | 'complex';

/**
 * Metadata that can be associated with a `BoxedExpression`
 *
 * @category Boxed Expression
 */

export type Metadata = {
  latex?: string | undefined;
  wikidata?: string | undefined;
};

/**
 * When a unitless value is passed to or returned from a trigonometric function,
 * the angular unit of the value.
 *
 * - `rad`: radians, 2π radians is a full circle
 * - `deg`: degrees, 360 degrees is a full circle
 * - `grad`: gradians, 400 gradians is a full circle
 * - `turn`: turns, 1 turn is a full circle
 *
 * @category Compute Engine
 */
export type AngularUnit = 'rad' | 'deg' | 'grad' | 'turn';

/** @category Compute Engine */
export type ArrayValue =
  | boolean
  | number
  | string
  | Decimal
  | Complex
  | BoxedExpression
  | undefined;

/** @category Assumptions */
export type AssumeResult =
  | 'internal-error'
  | 'not-a-predicate'
  | 'contradiction'
  | 'tautology'
  | 'ok';

/** @category Compute Engine */
export type AssignValue =
  | boolean
  | number
  | string
  | Decimal
  | Complex
  | LatexString
  | SemiBoxedExpression
  | ((ce: IComputeEngine, args: BoxedExpression[]) => BoxedExpression)
  | undefined;

/** @internal */
export interface IComputeEngine {
  latexDictionary: readonly LatexDictionaryEntry[];

  /** @private */
  indexedLatexDictionary: IndexedLatexDictionary;

  decimalSeparator: LatexString;

  // Common domains
  readonly Anything: BoxedDomain;
  readonly Void: BoxedDomain;
  readonly Strings: BoxedDomain;
  readonly Booleans: BoxedDomain;
  readonly Numbers: BoxedDomain;

  // Common symbols
  readonly True: BoxedExpression;
  readonly False: BoxedExpression;
  readonly Pi: BoxedExpression;
  readonly E: BoxedExpression;
  readonly Nothing: BoxedExpression;

  readonly Zero: BoxedExpression;
  readonly One: BoxedExpression;
  readonly Half: BoxedExpression;
  readonly NegativeOne: BoxedExpression;
  readonly I: BoxedExpression;
  readonly NaN: BoxedExpression;
  readonly PositiveInfinity: BoxedExpression;
  readonly NegativeInfinity: BoxedExpression;
  readonly ComplexInfinity: BoxedExpression;

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

  /** @hidden */
  readonly timeLimit: number;
  /** @hidden */
  readonly iterationLimit: number;
  /** @hidden */
  readonly recursionLimit: number;

  numericMode: NumericMode;

  tolerance: number;

  angularUnit: AngularUnit;

  chop(n: number): number;
  chop(n: Decimal): Decimal | 0;
  chop(n: Complex): Complex | 0;
  chop(n: number | Decimal | Complex): number | Decimal | Complex;

  bignum: (a: Decimal.Value | bigint) => Decimal;
  isBignum(a: unknown): a is Decimal;

  complex: (a: number | Complex, b?: number) => Complex;
  isComplex(a: unknown): a is Complex;

  /** @internal */
  _numericValue(
    value: number | Rational | Decimal | Complex | { re: number; im?: number }
  ): NumericValue;
  /** @internal */
  _toNumericValue(expr: BoxedExpression): [NumericValue, BoxedExpression];
  /** @internal */
  _fromNumericValue(
    coeff: NumericValue,
    expr?: BoxedExpression
  ): BoxedExpression;

  set precision(p: number | 'machine');
  get precision(): number;

  costFunction: (expr: BoxedExpression) => number;

  strict: boolean;

  box(
    expr:
      | Decimal
      | Complex
      | [num: number, denom: number]
      | SemiBoxedExpression,
    options?: { canonical?: CanonicalOptions }
  ): BoxedExpression;

  function(
    head: string | BoxedExpression,
    ops: ReadonlyArray<SemiBoxedExpression>,
    options?: { metadata?: Metadata; canonical?: CanonicalOptions }
  ): BoxedExpression;

  number(
    value:
      | number
      | bigint
      | string
      | MathJsonNumber
      | Decimal
      | Complex
      | Rational,
    options?: { metadata?: Metadata; canonical?: CanonicalOptions }
  ): BoxedExpression;

  symbol(
    sym: string,
    options?: { metadata?: Metadata; canonical?: CanonicalOptions }
  ): BoxedExpression;

  string(s: string, metadata?: Metadata): BoxedExpression;

  domain(
    domain: BoxedDomain | DomainExpression,
    metadata?: Metadata
  ): BoxedDomain;

  error(
    message:
      | MathJsonIdentifier
      | [MathJsonIdentifier, ...ReadonlyArray<SemiBoxedExpression>],
    where?: SemiBoxedExpression
  ): BoxedExpression;

  domainError(
    expectedDomain: BoxedDomain | DomainLiteral,
    actualDomain: undefined | BoxedDomain,
    where?: SemiBoxedExpression
  ): BoxedExpression;

  hold(expr: SemiBoxedExpression): BoxedExpression;

  add(...ops: ReadonlyArray<BoxedExpression>): BoxedExpression;

  evalMul(...ops: ReadonlyArray<BoxedExpression>): BoxedExpression;

  pow(
    base: BoxedExpression,
    exponent: number | Rational | BoxedExpression
  ): BoxedExpression;

  inv(expr: BoxedExpression): BoxedExpression;

  div(num: BoxedExpression, denom: BoxedExpression): BoxedExpression;

  pair(
    first: BoxedExpression,
    second: BoxedExpression,
    metadata?: Metadata
  ): BoxedExpression;

  tuple(elements: ReadonlyArray<number>, metadata?: Metadata): BoxedExpression;
  tuple(
    elements: ReadonlyArray<BoxedExpression>,
    metadata?: Metadata
  ): BoxedExpression;

  array(
    elements: ArrayValue[] | ArrayValue[][],
    metadata?: Metadata
  ): BoxedExpression;

  rules(rules: Rule[]): BoxedRuleSet;

  /**
   * Return a set of built-in rules.
   */
  getRuleSet(
    id?: 'harmonization' | 'solve-univariate' | 'standard-simplification'
  ): BoxedRuleSet | undefined;

  /**
   * This is a primitive to create a boxed function.
   *
   * In general, consider using `ce.box()` or `ce.functin()` or
   * `canonicalXXX()` instead.
   *
   * The caller must ensure that the arguments are in canonical form:
   * - arguments are `canonical()`
   * - arguments are sorted
   * - arguments are flattened and desequenced
   *
   * @internal
   */
  _fn(
    head: string | BoxedExpression,
    ops: ReadonlyArray<BoxedExpression>,
    options?: Metadata & { canonical?: boolean }
  ): BoxedExpression;

  parse(
    latex: null,
    options?: Partial<ParseLatexOptions> & { canonical?: CanonicalOptions }
  ): null;
  parse(
    latex: LatexString,
    options?: Partial<ParseLatexOptions> & { canonical?: CanonicalOptions }
  ): BoxedExpression;
  parse(
    latex: LatexString | null,
    options?: Partial<ParseLatexOptions> & { canonical?: CanonicalOptions }
  ): BoxedExpression | null;

  pushScope(scope?: Partial<Scope>): IComputeEngine;

  popScope(): IComputeEngine;

  swapScope(scope: RuntimeScope | null): RuntimeScope | null;

  resetContext(): void;

  defineSymbol(name: string, def: SymbolDefinition): BoxedSymbolDefinition;
  lookupSymbol(
    name: string,
    wikidata?: string,
    scope?: RuntimeScope
  ): undefined | BoxedSymbolDefinition;

  defineFunction(
    name: string,
    def: FunctionDefinition
  ): BoxedFunctionDefinition;
  lookupFunction(
    head: string | BoxedExpression,
    scope?: RuntimeScope | null
  ): undefined | BoxedFunctionDefinition;

  assign(ids: { [id: string]: AssignValue }): IComputeEngine;
  assign(id: string, value: AssignValue): IComputeEngine;
  assign(
    arg1: string | { [id: string]: AssignValue },
    arg2?: AssignValue
  ): IComputeEngine;

  declare(identifiers: {
    [id: string]:
      | BoxedDomain
      | DomainExpression
      | SymbolDefinition
      | FunctionDefinition;
  }): IComputeEngine;
  declare(
    id: string,
    def: BoxedDomain | DomainExpression | SymbolDefinition | FunctionDefinition
  ): IComputeEngine;
  declare(
    arg1:
      | string
      | {
          [id: string]:
            | BoxedDomain
            | DomainExpression
            | SymbolDefinition
            | FunctionDefinition;
        },
    arg2?:
      | BoxedDomain
      | DomainExpression
      | SymbolDefinition
      | FunctionDefinition
  ): IComputeEngine;

  assume(predicate: SemiBoxedExpression): AssumeResult;

  forget(symbol?: string | string[]): void;

  get assumptions(): ExpressionMapInterface<boolean>;

  ask(pattern: SemiBoxedExpression): BoxedSubstitution[];

  verify(query: SemiBoxedExpression): boolean;

  /** @internal */
  shouldContinueExecution(): boolean;

  /** @internal */
  checkContinueExecution(): void;

  /** @internal */
  cache<T>(name: string, build: () => T, purge?: (t: T) => T | undefined): T;

  /** @internal */
  readonly stats: ComputeEngineStats;

  /** @internal */
  reset(): void;

  /** @internal */
  _register(expr: BoxedExpression): void;

  /** @internal */
  _unregister(expr: BoxedExpression): void;
}

/** @internal */
export interface ComputeEngineStats {
  symbols: Set<BoxedExpression>;
  expressions: null | Set<BoxedExpression>;
  highwaterMark: number;
}

/**
 * Options to control the serialization to MathJSON when using `BoxedExpression.toMathJson()`.
 *
 * @category Compute Engine
 */
export type JsonSerializationOptions = {
  /** If true, the serialization applies some transformations to make
   * the JSON more readable. For example, `["Power", "x", 2]` is serialized
   * as `["Square", "x"]`.
   */
  prettify: boolean;

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
  repeatingDecimal: boolean;

  /**
   * The maximum number of significant digits in serialized numbers.
   * - `"max"`: all availabe digits are serialized.
   * - `"auto"`: use the same precision as the compute engine.
   *
   * **Default**: `"auto"`
   */
  fractionalDigits: 'auto' | 'max' | number;
};

/** A LaTeX string starts and end with `$`, for example
 * `"$\frac{\pi}{2}$"`.
 *
 * @category Latex Parsing and Serialization
 */
export type LatexString = string;

/**
 * Control how a pattern is matched to an expression.
 *
 * - `substitution`: if present, assumes these values for the named wildcards, and ensure that subsequent occurence of the same wildcard have the same value.
 * - `recursive`: if true, match recursively, otherwise match only the top level.
 * - `numericTolerance`: if present, the tolerance for numeric comparison.
 * - `exact`: if true, only match expressions that are structurally identical. If false, match expressions that are structurally identical or equivalent. For example, when false, `["Add", '_a', 2]` matches `2`, with a value of `_a` of `0`. If true, the expression does not match.
 *
 * @category Pattern Matching
 *
 */
export type PatternMatchOptions = {
  substitution?: BoxedSubstitution;
  recursive?: boolean;
  numericTolerance?: number;
  exact?: boolean;
};

/**
 * @category Boxed Expression
 *
 */
export type ReplaceOptions = {
  /** If `true`, apply replacement rules to all sub-expressions.
   * If `false`, only consider the top-level expression.
   *
   * **Default**: `false`
   */
  recursive?: boolean;
  /**
   * If `true`, stop after the first rule that matches.
   *
   * If `false`, apply all the remaining rules even after the first match.
   *
   * **Default**: `false`
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

* @category Boxed Expression
 */
export type Substitution<T = SemiBoxedExpression> = {
  [symbol: string]: T;
};

/** @category Assumptions */
export interface ExpressionMapInterface<U> {
  has(expr: BoxedExpression): boolean;
  get(expr: BoxedExpression): U | undefined;
  set(expr: BoxedExpression, value: U): void;
  delete(expr: BoxedExpression): void;
  clear(): void;
  [Symbol.iterator](): IterableIterator<[BoxedExpression, U]>;
  entries(): IterableIterator<[BoxedExpression, U]>;
}

/**
 * The entries have been validated and optimized for faster evaluation.
 *
 * When a new scope is created with `pushScope()` or when creating a new
 * engine instance, new instances of this type are created as needed.
 *
 * @category Definitions
 */
export type RuntimeIdentifierDefinitions = Map<
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
 * @category Compute Engine
 */
export type Scope = {
  /** Signal `timeout` when the execution time for this scope is exceeded.
   *
   * Time in seconds, default 2s.
   *
   * @experimental
   */
  timeLimit: number;

  /** Signal `out-of-memory` when the memory usage for this scope is exceeded.
   *
   * Memory is in Megabytes, default: 1Mb.
   *
   * @experimental
   */
  memoryLimit: number;

  /** Signal `recursion-depth-exceeded` when the recursion depth for this
   * scope is exceeded.
   *
   * @experimental
   */
  recursionLimit: number;

  /** Signal `iteration-limit-exceeded` when the iteration limit
   * in a loop is exceeded. Default: no limits.
   *
   * @experimental
   */
  iterationLimit: number;
};

/** @category Compute Engine */
export type RuntimeScope = Scope & {
  parentScope?: RuntimeScope;

  ids?: RuntimeIdentifierDefinitions;

  assumptions: undefined | ExpressionMapInterface<boolean>;

  /** The location of the call site that created this scope */
  // origin?: {
  //   name?: string;
  //   line?: number;
  //   column?: number;
  // };

  /** Free memory should not go below this level for execution to proceed */
  // lowWaterMark?: number;
};

/**
 * A bound symbol (i.e. one with an associated definition) has either a domain
 * (e.g. ∀ x ∈ ℝ), a value (x = 5) or both (π: value = 3.14... domain = TranscendentalNumbers)
 * @category Definitions
 */
export type SymbolDefinition = BaseDefinition &
  Partial<SymbolAttributes> & {
    domain?: DomainLiteral | BoxedDomain;

    /** If true, the domain is inferred, and could be adjusted later
     * as more information becomes available or if the symbol is explicitly
     * declared.
     */
    inferred?: boolean;

    /** `value` can be a JS function since for some constants, such as
     * `Pi`, the actual value depends on the `precision` setting of the
     * `ComputeEngine` and possible other environment settings */
    value?:
      | LatexString
      | SemiBoxedExpression
      | ((ce: IComputeEngine) => SemiBoxedExpression | null);

    flags?: Partial<NumericFlags>;
  };

/**
 * Definition record for a function.
 * @category Definitions
 *
 */
export type FunctionDefinition = BaseDefinition &
  Partial<CollectionHandlers> &
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

    hold?: Hold;

    signature: FunctionSignature;
  };

/**
 * @category Definitions
 *
 */
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

/**
 * @category Definitions
 *
 */

export type FunctionSignature = {
  /** The domain of this signature, a domain compatible with the `Functions`
   * domain).
   *
   * @deprecated Use params, optParams, restParam and result instead
   */
  domain?: DomainExpression;

  params?: DomainExpression[];
  optParams?: DomainExpression[];
  restParam?: DomainExpression;

  /** The domain of the result of the function. Either a domain
   * expression, or a function that returns a boxed domain.
   */
  result?:
    | DomainExpression
    | ((
        ce: IComputeEngine,
        args: BoxedDomain[]
      ) => BoxedDomain | null | undefined);

  /**
   * Return the canonical form of the expression with the arguments `args`.
   *
   * The arguments (`args`) may not be in canonical form. If necessary, they
   * can be put in canonical form.
   *
   * This handler should validate the domain and number of the arguments.
   *
   * If a required argument is missing, it should be indicated with a
   * `["Error", "'missing"]` expression. If more arguments than expected
   * are present, this should be indicated with an
   * ["Error", "'unexpected-argument'"]` error expression
   *
   * If the domain of an argument is not compatible, it should be indicated
   * with an `incompatible-domain` error.
   *
   * `["Sequence"]` expressions are not folded and need to be handled
   *  explicitly.
   *
   * If the function is associative, idempotent or an involution,
   * this handler should account for it. Notably, if it is commutative, the
   * arguments should be sorted in canonical order.
   *
   * The handler can make transformations based on the value of the arguments
   * that are exact and literal (i.e.
   * `arg.numericValue !== null && arg.isExact`).
   *
   * Values of symbols should not be substituted, unless they have
   * a `holdUntil` attribute of `"never"`.
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
    args: ReadonlyArray<BoxedExpression>
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
   * Do not reduce constants with a `holdUntil` attribute of `"N"`
   * or `"evaluate"`.
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
    args: ReadonlyArray<BoxedExpression>
  ) => BoxedExpression | undefined;

  /**
   * Evaluate a function expression.
   *
   * The arguments have been evaluated, except the arguments to which a
   * `hold` applied.
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
   * - do not reduce constants with a `holdUntil` attribute of `"N"`
   *
   * If the expression cannot be evaluated, due to the values, domains, or
   * assumptions about its arguments, for example, return `undefined` or
   * an `["Error"]` expression.
   */
  evaluate?:
    | SemiBoxedExpression
    | ((
        ce: IComputeEngine,
        args: ReadonlyArray<BoxedExpression>
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
   * Use the value of `ce.numericMode` to determine how to perform
   * the numeric evaluation.
   *
   * Note that regardless of the current value of `ce.numericMode`, the
   * arguments may be boxed numbers representing machine numbers, bignum
   * numbers, complex numbers, rationals or big rationals.
   *
   * If the numeric mode does not allow complex numbers (the
   * `engine.numericMode` is not `"complex"` or `"auto"`) and the result of
   * the evaluation would be a complex number, return `NaN` instead.
   *
   * If `ce.numericMode` is `"bignum"` or `"auto"` the evaluation should
   * be done using bignums.
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
    args: ReadonlyArray<BoxedExpression>
  ) => BoxedExpression | undefined;

  /** Dimensional analysis
   * @experimental
   */
  evalDimension?: (
    ce: IComputeEngine,
    args: ReadonlyArray<BoxedExpression>
  ) => BoxedExpression;

  /** Return the sign of the function expression. */
  sgn?: (
    ce: IComputeEngine,
    args: ReadonlyArray<BoxedExpression>
  ) => -1 | 0 | 1 | undefined;

  /** Return a compiled (optimized) expression. */
  compile?: (expr: BoxedExpression) => CompiledExpression;
};
