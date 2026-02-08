import type { Complex } from 'complex-esm';
import type { OneOf } from '../common/one-of';
import type {
  Expression,
  MathJsonNumberObject,
  MathJsonStringObject,
  MathJsonSymbolObject,
  MathJsonFunctionObject,
  MathJsonSymbol,
  MathJsonDictionaryObject,
} from '../math-json';
import type { Type, TypeString } from '../common/type/types';
import type { BoxedType } from '../common/type/boxed-type';
import type { NumericValue } from './numeric-value/types';
import type { BigNum } from './numerics/types';
import type { LatexString, SerializeLatexOptions } from './latex-syntax/types';

import type {
  JsonSerializationOptions,
  PatternMatchOptions,
  ReplaceOptions,
  Substitution,
  BoxedSubstitution,
  CanonicalOptions,
} from './types-serialization';
import type {
  Sign,
  BoxedBaseDefinition,
  BoxedOperatorDefinition,
  BoxedValueDefinition,
  SimplifyOptions,
} from './types-definitions';
import type {
  EvaluateOptions,
  Rule,
  BoxedRuleSet,
  Scope,
} from './types-evaluation';
import type { IComputeEngine as ComputeEngine } from './types-engine';

//
// ── Tensor & Compilation Types ──────────────────────────────────────────
//

/** @category Compiling */
export type CompiledType = boolean | number | string | object;

/** @category Compiling */
export type JSSource = string;

/** @category Compiling */
export type CompiledExpression = {
  evaluate?: (scope: {
    [symbol: string]: BoxedExpression;
  }) => number | BoxedExpression;
};

/**
 * Map of `TensorDataType` to JavaScript type.
 *
 * @category Tensors */
export type DataTypeMap = {
  float64: number;
  float32: number;
  int32: number;
  uint8: number;
  complex128: Complex;
  complex64: Complex;
  bool: boolean;
  // string: string;
  expression: BoxedExpression;
};

/**
 * The type of the cells in a tensor.
 * @category Tensors */
export type TensorDataType = keyof DataTypeMap;

/** @internal */
export type NestedArray<T> = NestedArray_<T>[];
/** @internal */
export type NestedArray_<T> = T | NestedArray_<T>[];

/**
 * A record representing the type, shape and data of a tensor.
 * @category Tensors */
export interface TensorData<DT extends TensorDataType> {
  dtype: DT;
  shape: number[]; // dimension of each axis
  rank?: number; // number of dimensions
  data: DataTypeMap[DT][]; // flattened data, stored in row-major order
}

/** @category Tensors */
export interface TensorField<
  T extends number | Complex | BoxedExpression | boolean | string = number,
> {
  readonly one: T;
  readonly zero: T;
  readonly nan: T;

  cast(x: T, dtype: 'float64'): undefined | number;
  cast(x: T, dtype: 'float32'): undefined | number;
  cast(x: T, dtype: 'int32'): undefined | number;
  cast(x: T, dtype: 'uint8'): undefined | number;
  cast(x: T, dtype: 'complex128'): undefined | Complex;
  cast(x: T, dtype: 'complex64'): undefined | Complex;
  cast(x: T, dtype: 'bool'): undefined | boolean;
  // cast(x: T, dtype: 'string'): undefined | string;
  cast(x: T, dtype: 'expression'): undefined | BoxedExpression;
  cast(x: T[], dtype: 'float64'): undefined | number[];
  cast(x: T[], dtype: 'float32'): undefined | number[];
  cast(x: T[], dtype: 'int32'): undefined | number[];
  cast(x: T[], dtype: 'uint8'): undefined | number[];
  cast(x: T[], dtype: 'complex128'): undefined | Complex[];
  cast(x: T[], dtype: 'complex64'): undefined | Complex[];
  cast(x: T[], dtype: 'bool'): undefined | boolean[];
  // cast(x: T[], dtype: 'string'): undefined | string[];
  cast(x: T[], dtype: 'expression'): undefined | BoxedExpression[];
  cast(
    x: T | T[],
    dtype: TensorDataType
  ):
    | undefined
    | Complex
    | number
    | boolean
    // | string
    | BoxedExpression
    | Complex[]
    | number[]
    | boolean[]
    // | string[]
    | BoxedExpression[];

  // Synonym for `cast(x, 'expression')`
  expression(x: T): BoxedExpression;

  isZero(x: T): boolean;
  isOne(x: T): boolean;

  equals(lhs: T, rhs: T): boolean;

  add(lhs: T, rhs: T): T;
  addn(...xs: T[]): T;
  neg(x: T): T;
  sub(lhs: T, rhs: T): T;
  mul(lhs: T, rhs: T): T;
  muln(...xs: T[]): T;
  div(lhs: T, rhs: T): T;
  pow(rhs: T, n: number): T;
  conjugate(x: T): T;
}

/**
 * @category Tensors
 */

export interface Tensor<DT extends TensorDataType> extends TensorData<DT> {
  dtype: DT;
  shape: number[];
  rank: number;
  data: DataTypeMap[DT][];

  readonly field: TensorField<DT>;
  readonly expression: BoxedExpression;
  readonly array: NestedArray<DataTypeMap[DT]>;
  readonly isSquare: boolean;
  readonly isSymmetric: boolean;
  readonly isSkewSymmetric: boolean;
  readonly isDiagonal: boolean;
  readonly isUpperTriangular: boolean;
  readonly isLowerTriangular: boolean;
  readonly isTriangular: boolean;
  readonly isIdentity: boolean;
  readonly isZero: boolean;

  at(...indices: number[]): DataTypeMap[DT] | undefined;
  diagonal(axis1?: number, axis2?: number): undefined | DataTypeMap[DT][];
  trace(
    axis1?: number,
    axis2?: number
  ): undefined | DataTypeMap[DT] | Tensor<DT>;
  reshape(...shape: number[]): Tensor<DT>;
  slice(index: number): Tensor<DT>;
  flatten(): DataTypeMap[DT][];
  upcast<DT extends TensorDataType>(dtype: DT): Tensor<DT>;
  transpose(axis1?: number, axis2?: number): undefined | Tensor<DT>;
  conjugateTranspose(axis1?: number, axis2?: number): undefined | Tensor<DT>;
  determinant(): undefined | DataTypeMap[DT];
  inverse(): undefined | Tensor<DT>;
  pseudoInverse(): undefined | Tensor<DT>;
  adjugateMatrix(): undefined | Tensor<DT>;
  minor(axis1: number, axis2: number): undefined | DataTypeMap[DT];
  map1(
    fn: (lhs: DataTypeMap[DT], rhs: DataTypeMap[DT]) => DataTypeMap[DT],
    scalar: DataTypeMap[DT]
  ): Tensor<DT>;
  map2(
    fn: (lhs: DataTypeMap[DT], rhs: DataTypeMap[DT]) => DataTypeMap[DT],
    rhs: Tensor<DT>
  ): Tensor<DT>;

  add(other: Tensor<DT> | DataTypeMap[DT]): Tensor<DT>;
  subtract(other: Tensor<DT> | DataTypeMap[DT]): Tensor<DT>;
  multiply(other: Tensor<DT> | DataTypeMap[DT]): Tensor<DT>; // Hadamard product
  divide(other: Tensor<DT> | DataTypeMap[DT]): Tensor<DT>;
  power(other: Tensor<DT> | DataTypeMap[DT]): Tensor<DT>;

  equals(other: Tensor<DT>): boolean;
}

//
// ── BoxedExpression ─────────────────────────────────────────────────────
//

/**
 * :::info[THEORY OF OPERATIONS]
 *
 * The `BoxedExpression` interface includes the methods and properties
 * applicable to all kinds of expression. For example it includes `expr.symbol`
 * which only applies to symbols or `expr.ops` which only applies to
 * function expressions.
 *
 * When a property is not applicable to this `BoxedExpression` its value is
 * `undefined`. For example `expr.symbol` for a `BoxedNumber` is `undefined`.
 *
 * This convention makes it convenient to manipulate expressions without
 * having to check what kind of instance they are before manipulating them.
 * :::
 *
 * :::info[THEORY OF OPERATIONS]
 * A boxed expression can represent a canonical or a non-canonical
 * expression. A non-canonical expression is a "raw" form of the
 * expression. For example, the non-canonical representation of `\frac{10}{20}`
 * is `["Divide", 10, 20]`. The canonical representation of the same
 * expression is the boxed number `1/2`.
 *
 * The canonical representation of symbols and function expressions are
 * bound to a definition. The definition contains metadata about the symbol
 * or function operator, such as its type, its signature, and other attributes.
 * The value of symbols are tracked in a separate table for each
 * evaluation context.
 *
 * The binding only occurs when the expression is constructed, if it is created
 * as a canonical expression. If the expression is constructed as a
 * non-canonical expression, no binding is done.
 *
 * <!--
 * Rules:
 * - nothing should cause the binding to occur outside of the constructor
 * - if an operation require a canonical expression (e.g. evaluate()),
 *  it should return undefined or throw an error if the expression is not
 *   canonical
 * -->
 *
 *
 * :::
 *
 * :::info[THEORY OF OPERATIONS]
 * The **value** of an expression is a number, a string, a boolean or a tensor.
 *
 * The value of number literals and strings are themselves.
 *
 * A symbol can have a value associated with it, in which case the value
 * of the symbol is the value associated with it.
 *
 * Some symbols (unknowns) are purely symbolic and have no value associated
 * with them.
 *
 * Function expressions do not have a value associated with them.
 * For example, `["Add", 2, 3]` has no value associated with it, it is a
 * symbolic expression.
 *
 * Some properties of a Boxed Expression are only applicable if the expression
 * has a value associated with it. For example, `expr.isNumber` is only
 * applicable if the value of the expression is a number, that is if the
 * expression is a number literal or a symbol with a numeric value.
 *
 * The following properties are applicable to expressions with a value:
 * - `expr.isNumber`
 * :::
 *
 * To create a boxed expression:
 *
 * ### `ce.box()` and `ce.parse()`
 *
 * Use `ce.box()` or `ce.parse()`.
 *
 * Use `ce.parse()` to get a boxed expression from a LaTeX string.
 * Use `ce.box()` to get a boxed expression from a MathJSON expression.
 *
 * By default, the result of these methods is a canonical expression. For
 * example, if it is a rational literal, it is reduced to its canonical form.
 * If it is a function expression:
 *    - the arguments are put in canonical form
 *    - the arguments of commutative functions are sorted
 *    - invisible operators are made explicit
 *    - a limited number of core simplifications are applied,
 *      for example rationals are reduced
 *    - sequences are flattened: `["Add", 1, ["Sequence", 2, 3]]` is
 *      transformed to `["Add", 1, 2, 3]`
 *    - associative functions are flattened: `["Add", 1, ["Add", 2, 3]]` is
 *      transformed to `["Add", 1, 2, 3]`
 *    - symbols are **not** replaced with their values (unless they have
 *       a `holdUntil` flag set to `never`).
 *
 * ### `ce.function()`
 *
 * This is a specialized version of `ce.box()` for creating a new function
 * expression.
 *
 * The canonical handler of the operator is called.
 *
 *
 * ### Algebraic methods (`expr.add()`, `expr.mul()`, etc...)
 *
 * The boxed expression have some algebraic methods, i.e. `add()`, `mul()`,
 * `div()`, `pow()`, etc. These methods are suitable for
 * internal calculations, although they may be used as part of the public
 * API as well.
 *
 *    - a runtime error is thrown if the expression is not canonical
 *    - the arguments are not evaluated
 *    - the canonical handler (of the corresponding operation) is not called
 *    - some additional simplifications over canonicalization are applied.
 *      For example number literals are combined.
 *      However, the result is exact, and no approximation is made. Use `.N()`
 *      to get an approximate value.
 *      This is equivalent to calling `simplify()` on the expression (but
 *      without simplifying the arguments).
 *    - sequences were already flattened as part of the canonicalization process
 *
 * For 'add()' and 'mul()', which take multiple arguments, separate functions
 * are provided that take an array of arguments. They are equivalent
 * to calling the boxed algebraic method, i.e. `ce.Zero.add(1, 2, 3)` and
 * `add(1, 2, 3)` are equivalent.
 *
 * These methods are not equivalent to calling `expr.evaluate()` on the
 * expression: evaluate will replace symbols with their values, and
 * evaluate the expression.
 *
 * For algebraic functions (`add()`, `mul()`, etc..), use the corresponding
 * canonicalization function, i.e. `canonicalAdd(a, b)` instead of
 * `ce.function('Add', [a, b])`.
 *
 * Another option is to use the algebraic methods directly, i.e. `a.add(b)`
 * instead of `ce.function('Add', [a, b])`. However, the algebraic methods will
 * apply further simplifications which may or may not be desirable. For
 * example, number literals will be combined.
 *
 * ### `ce._fn()`
 *
 * This method is a low level method to create a new function expression which
 * is typically invoked in the canonical handler of an operator definition.
 *
 * The arguments are not modified. The expression is not put in canonical
 * form. The canonical handler is *not* called.
 *
 * A canonical flag can be set when calling this method, but it only
 * asserts that the function expression is canonical. The caller is responsible
 * for ensuring that is the case.
 *
 *
 *
 * ### Canonical Handlers
 *
 * Canonical handlers are responsible for:
 *    - validating the signature: this can involve checking the
 *      number of arguments. It is recommended to avoid checking the
 *      type of non-literal arguments, since the type of symbols or
 *      function expressions may change. Similarly, the canonicalization
 *      process should not rely on the value of or assumptions about non-literal
 *      arguments.
 *    - flattening sequences
 *    - flattening arguments if the function is associative
 *    - sort the arguments (if the function is commutative)
 *    - calling `ce._fn()` to create a new function expression
 *
 * When the canonical handler is invoked, the arguments have been put in
 * canonical form unless the `lazy` flag is set to `true`.
 *
 * Note that the result of a canonical handler should be a canonical expression,
 * but not all arguments need to be canonical. For example, the arguments of
 * `["Declare", "x", 2]` are not canonical, since `x` refers to the name
 * of the symbol, not its value.
 *
 * @category Boxed Expression
 *
 */
export interface BoxedExpression {
  /** @internal */
  readonly _kind: string;

  /** @internal */
  readonly hash: number;

  /**
   * The Compute Engine instance associated with this expression provides
   * a context in which to interpret it, such as definition of symbols
   * and functions.
   */
  readonly engine: ComputeEngine;

  /**
   *
   * Return a JavaScript primitive value for the expression, based on
   * `Object.valueOf()`.
   *
   * This method is intended to make it easier to work with JavaScript
   * primitives, for example when mixing JavaScript computations with
   * symbolic computations from the Compute Engine.
   *
   * If the expression is a **machine number**, a **bignum**, or a **rational**
   * that can be converted to a machine number, return a JavaScript `number`.
   * This conversion may result in a loss of precision.
   *
   * If the expression is the **symbol `"True"`** or the **symbol `"False"`**,
   * return `true` or `false`, respectively.
   *
   * If the expression is a **symbol with a numeric value**, return the numeric
   * value of the symbol.
   *
   * If the expression is a **string literal**, return the string value.
   *
   * If the expression is a **tensor** (list of number or multidimensional
   * array or matrix), return an array of numbers, or an array of
   * arrays of numbers, or an array of arrays of arrays of numbers.
   *
   * If the expression is a function expression return a string representation
   * of the expression.
   *
   * @category Primitive Methods
   */
  valueOf(): number | number[] | number[][] | number[][][] | string | boolean;

  /** Similar to`expr.valueOf()` but includes a hint.
   *
   * @category Primitive Methods
   */
  [Symbol.toPrimitive](
    hint: 'number' | 'string' | 'default'
  ): number | string | null;

  /**
   * Return an ASCIIMath representation of the expression. This string is
   * suitable to be output to the console for debugging, for example.
   *
   * Based on `Object.toString()`.
   *
   * To get a LaTeX representation of the expression, use `expr.latex`.
   *
   * Note that lazy collections are eagerly evaluated.
   *
   * Used when coercing a `BoxedExpression` to a `String`.
   *
   * @category Primitive Methods
   */
  toString(): string;

  /** Serialize to a LaTeX string.
   *
   * Note that lazy collections are eagerly evaluated.
   *
   * Will ignore any LaTeX metadata.
   */
  toLatex(options?: Partial<SerializeLatexOptions>): LatexString;

  /** LaTeX representation of this expression.
   *
   * If the expression was parsed from LaTeX, the LaTeX representation is
   * the same as the input LaTeX.
   *
   * To customize the serialization, use `expr.toLatex()`.
   *
   * Note that lazy collections are eagerly evaluated.
   *
   * :::info[Note]
   * Applicable to canonical and non-canonical expressions.
   * :::
   *
   */
  get latex(): LatexString;

  /** Used by `JSON.stringify()` to serialize this object to JSON.
   *
   * Method version of `expr.json`.
   *
   * Based on `Object.toJSON()`.
   *
   * Note that lazy collections are *not* eagerly evaluated.
   *
   * @category Primitive Methods
   */
  toJSON(): Expression;

  /** Serialize to a MathJSON expression with specified options */
  toMathJson(options?: Readonly<Partial<JsonSerializationOptions>>): Expression;

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
   * For more control over the serialization, use `expr.toMathJson()`.
   *
   * Note that lazy collections are *not* eagerly evaluated.
   *
   * :::info[Note]
   * Applicable to canonical and non-canonical expressions.
   * :::
   *
   */
  readonly json: Expression;

  /**
   * Output to the console a string representation of the expression.
   *
   * Note that lazy collections are eagerly evaluated when printed.
   *
   */
  print(): void;

  /** If the expression was constructed from a LaTeX string, the verbatim LaTeX
   *  string it was parsed from.
   */
  verbatimLatex?: string;

  /** If `true`, this expression is in a canonical form. */
  get isCanonical(): boolean;

  /** For internal use only, set when a canonical expression is created.
   * @internal
   */
  set isCanonical(val: boolean);

  /** If `true`, this expression is in a structural form.
   *
   * The structural form of an expression is used when applying rules to
   * an expression. For example, a rational number is represented as a
   * function expression instead of a `BoxedExpression` object.
   *
   */
  get isStructural(): boolean;

  /**
   * Return the canonical form of this expression.
   *
   * If a function expression or symbol, they are first bound with a definition
   * in the current scope.
   *
   * When determining the canonical form the following operator definition
   * flags are applied:
   * - `associative`: \\( f(a, f(b), c) \longrightarrow f(a, b, c) \\)
   * - `idempotent`: \\( f(f(a)) \longrightarrow f(a) \\)
   * - `involution`: \\( f(f(a)) \longrightarrow a \\)
   * - `commutative`: sort the arguments.
   *
   * If this expression is already canonical, the value of canonical is
   * `this`.
   *
   * The arguments of a canonical function expression may not all be
   * canonical, for example in the `["Declare", "i", 2]` expression,
   * `i` is not canonical since it is used only as the name of a symbol, not
   * as a (potentially) existing symbol.
   *
   * :::info[Note]
   * Partially canonical expressions, such as those produced through
   * `CanonicalForm`, also yield an expression which is marked as `canonical`.
   * This means that, likewise for partially canonical expressions, the
   * `canonical` property will return the self-same expression (and
   * 'isCanonical' will also be true).
   * :::
   *
   */
  get canonical(): BoxedExpression;

  /**
   * Return the structural form of this expression.
   *
   * Some expressions, such as rational numbers, are represented with
   * a `BoxedExpression` object. In some cases, for example when doing a
   * structural comparison of two expressions, it is useful to have a
   * structural representation of the expression where the rational numbers
   * is represented by a function expression instead.
   *
   * If there is a structural representation of the expression, return it,
   * otherwise return `this`.
   *
   */
  get structural(): BoxedExpression;

  /** `false` if this expression or any of its subexpressions is an `["Error"]`
   * expression.
   *
   * :::info[Note]
   * Applicable to canonical and non-canonical expressions. For
   * non-canonical expression, this may indicate a syntax error while parsing
   * LaTeX. For canonical expression, this may indicate argument type
   * mismatch, or missing or unexpected arguments.
   * :::
   *
   */
  readonly isValid: boolean;

  /** If *true*, evaluating this expression has no side-effects (does not
   * change the state of the Compute Engine).
   *
   * If *false*, evaluating this expression may change the state of the
   * Compute Engine or it may return a different value each time it is
   * evaluated, even if the state of the Compute Engine is the same.
   *
   * As an example, the `["Add", 2, 3]` function expression is pure, but
   * the `["Random"]` function expression is not pure.
   *
   * For a function expression to be pure, the function itself (its operator)
   * must be pure, and all of its arguments must be pure too.
   *
   * A pure function expression may return a different value each time it is
   * evaluated if its arguments are not constant. For example, the
   * `["Add", "x", 1]` function expression is pure, but it is not
   * constant, because `x` is not constant.
   *
   * :::info[Note]
   * Applicable to canonical expressions only
   * :::
   */
  readonly isPure: boolean;

  /**
   * `True` if evaluating this expression always returns the same value.
   *
   * If *true* and a function expression, implies that it is *pure* and
   * that all of its arguments are constant.
   *
   * Number literals, symbols with constant values, and pure numeric functions
   * with constant arguments are all *constant*, i.e.:
   * - `42` is constant
   * - `Pi` is constant
   * - `["Divide", "Pi", 2]` is constant
   * - `x` is not constant, unless declared with a constant flag.
   * - `["Add", "x", 2]` is either constant only if `x` is constant.
   */
  readonly isConstant: boolean;

  /** All the `["Error"]` subexpressions.
   *
   * If an expression includes an error, the expression is also an error.
   * In that case, the `this.isValid` property is `false`.
   *
   * :::info[Note]
   * Applicable to canonical and non-canonical expressions.
   * :::
   *
   */
  readonly errors: ReadonlyArray<BoxedExpression>;

  /** All the subexpressions matching the named operator, recursively.
   *
   * Example:
   *
   * ```js
   * const expr = ce.parse('a + b * c + d');
   * const subexpressions = expr.getSubexpressions('Add');
   * // -> `[['Add', 'a', 'b'], ['Add', 'c', 'd']]`
   * ```
   *
   * :::info[Note]
   * Applicable to canonical and non-canonical expressions.
   * :::
   *
   */
  getSubexpressions(operator: string): ReadonlyArray<BoxedExpression>;

  /** All the subexpressions in this expression, recursively
   *
   * Example:
   *
   * ```js
   * const expr = ce.parse('a + b * c + d');
   * const subexpressions = expr.subexpressions;
   * // -> `[['Add', 'a', 'b'], ['Add', 'c', 'd'], 'a', 'b', 'c', 'd']`
   * ```
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
   * ```js
   * const expr = ce.parse('a + b * c + d');
   * const symbols = expr.symbols;
   * // -> ['a', 'b', 'c', 'd']
   * ```
   *
   * :::info[Note]
   * Applicable to canonical and non-canonical expressions.
   * :::
   *
   */
  readonly symbols: ReadonlyArray<string>;

  /**
   * All the symbols used in the expression that do not have a value
   * associated with them, i.e. they are declared but not defined.
   */
  readonly unknowns: ReadonlyArray<string>;

  /**
   * Attempt to factor a numeric coefficient `c` and a `rest` out of a
   * canonical expression such that `rest.mul(c)` is equal to `this`.
   *
   * Attempts to make `rest` a positive value (i.e. pulls out negative sign).
   *
   *```json
   * ['Multiply', 2, 'x', 3, 'a']
   *    -> [NumericValue(6), ['Multiply', 'x', 'a']]
   *
   * ['Divide', ['Multiply', 2, 'x'], ['Multiply', 3, 'y', 'a']]
   *    -> [NumericValue({rational: [2, 3]}), ['Divide', 'x', ['Multiply, 'y', 'a']]]
   * ```
   */

  toNumericValue(): [NumericValue, BoxedExpression];

  /**
   * If the value of this expression is not an **integer** return `undefined`.
   *
   * @category Numeric Expression
   */
  readonly isEven: boolean | undefined;

  /**
   * If the value of this expression is not an **integer** return `undefined`.
   *
   * @category Numeric Expression
   */
  readonly isOdd: boolean | undefined;

  /**
   * Return the real part of the value of this expression, if a number.
   *
   * Otherwise, return `NaN` (not a number).
   *
   * @category Numeric Expression
   */
  readonly re: number;

  /**
   * If value of this expression is a number, return the imaginary part of the
   * value. If the value is a real number, the imaginary part is 0.
   *
   * Otherwise, return `NaN` (not a number).
   *
   * @category Numeric Expression
   */
  readonly im: number;

  /**
   * If the value of this expression is a number, return the real part of the
   * value as a `BigNum`.
   *
   * If the value is not available as a bignum return `undefined`. That is,
   * the value is not upconverted to a bignum.
   *
   * To get the real value either as a bignum or a number, use
   * `expr.bignumRe ?? expr.re`.
   *
   * When using this pattern, the value is returned as a bignum if available,
   * otherwise as a number or `NaN` if the value is not a number.
   *
   * @category Numeric Expression
   *
   */
  readonly bignumRe: BigNum | undefined;

  /**
   * If the value of this expression is a number, return the imaginary part as
   * a `BigNum`.
   *
   * It may be 0 if the number is real.
   *
   * If the value of the expression is not a number or the value is not
   * available as a bignum return `undefined`. That is, the value is not
   * upconverted to a bignum.
   *
   * To get the imaginary value either as a bignum or a number, use
   * `expr.bignumIm ?? expr.im`.
   *
   * When using this pattern, the value is returned as a bignum if available, otherwise as a number or `NaN` if the value is not a number.
   *
   * @category Numeric Expression
   */
  readonly bignumIm: BigNum | undefined;

  /**
   * Return the sign of the expression.
   *
   * Note that complex numbers have no natural ordering, so if the value is an
   * imaginary number (a complex number with a non-zero imaginary part),
   * `this.sgn` will return `unsigned`.
   *
   * If a symbol, this does take assumptions into account, that is `this.sgn`
   * will return `positive` if the symbol is assumed to be positive
   * using `ce.assume()`.
   *
   * Non-canonical expressions return `undefined`.
   *
   * @category Numeric Expression
   *
   */
  readonly sgn: Sign | undefined;

  /** The value of this expression is > 0, same as `isGreaterEqual(0)`
   *
   * @category Numeric Expression
   */
  readonly isPositive: boolean | undefined;

  /** The value of this expression is >= 0, same as `isGreaterEqual(0)`
   *
   * @category Numeric Expression
   */
  readonly isNonNegative: boolean | undefined;

  /** The value of this expression is &lt; 0, same as `isLess(0)`
   *
   * @category Numeric Expression
   */
  readonly isNegative: boolean | undefined;

  /** The  value of this expression is &lt;= 0, same as `isLessEqual(0)`
   *
   * @category Numeric Expression
   */
  readonly isNonPositive: boolean | undefined;

  /*
   * Algebraic operations
   *
   */
  /** Negate (additive inverse) */
  neg(): BoxedExpression;
  /** Inverse (multiplicative inverse) */
  inv(): BoxedExpression;
  /** Absolute value */
  abs(): BoxedExpression;
  /** Addition */
  add(rhs: number | BoxedExpression): BoxedExpression;
  /** Subtraction */
  sub(rhs: BoxedExpression): BoxedExpression;
  /** Multiplication */
  mul(rhs: NumericValue | number | BoxedExpression): BoxedExpression;
  /** Division */
  div(rhs: number | BoxedExpression): BoxedExpression;
  /** Power */
  pow(exp: number | BoxedExpression): BoxedExpression;
  /** Exponentiation */
  root(exp: number | BoxedExpression): BoxedExpression;
  /** Square root */
  sqrt(): BoxedExpression;
  /** Logarithm (natural by default) */
  ln(base?: number | BoxedExpression): BoxedExpression;
  // exp(): BoxedExpression;

  /**
   * Return this expression expressed as a numerator.
   */
  get numerator(): BoxedExpression;

  /**
   * Return this expression expressed as a denominator.
   */
  get denominator(): BoxedExpression;

  /**
   * Return this expression expressed as a numerator and denominator.
   */
  get numeratorDenominator(): [BoxedExpression, BoxedExpression];

  /**
   * The name of the operator of the expression.
   *
   * For example, the name of the operator of `["Add", 2, 3]` is `"Add"`.
   *
   * A string literal has a `"String"` operator.
   *
   * A symbol has a `"Symbol"` operator.
   *
   * A number has a `"Number"`, `"Real"`, `"Rational"` or `"Integer"` operator; amongst some others.
   * Practically speaking, for fully canonical and valid expressions, all of these are likely to
   * collapse to `"Number"`.
   *
   * @category Function Expression
   */
  readonly operator: string;

  /** If true, the expression has its own local scope that can be used
   * for local variables and arguments. Only true if the expression is a
   * function expression.
   */
  readonly isScoped: boolean;

  /** If this expression has a local scope, return it. */
  get localScope(): Scope | undefined;

  /**
   * Replace all the symbols in the expression as indicated.
   *
   * Note the same effect can be achieved with `this.replace()`, but
   * using `this.subs()` is more efficient and simpler, but limited
   * to replacing symbols.
   *
   * The result is bound to the current scope, not to `this.scope`.
   *
   * If `options.canonical` is not set, the result is canonical if `this`
   * is canonical.
   *
   * :::info[Note]
   * Applicable to canonical and non-canonical expressions.
   *
   * If this is a function, an empty substitution is given, and the computed value of `canonical`
   * does not differ from that of this expr.: then a call this method is analagous to requesting a
   * *clone*.
   * :::
   *
   */
  subs(
    sub: Substitution,
    options?: { canonical?: CanonicalOptions }
  ): BoxedExpression;

  /**
   * Recursively replace all the subexpressions in the expression as indicated.
   *
   * To remove a subexpression, return an empty `["Sequence"]` expression.
   *
   * The `canonical` option is applied to each function subexpression after
   * the substitution is applied.
   *
   * If no `options.canonical` is set, the result is canonical if `this`
   * is canonical.
   *
   * **Default**: `{ canonical: this.isCanonical, recursive: true }`
   *
   * :::info[Note]
   * Applicable to canonical and non-canonical expressions.
   * :::
   */
  map(
    fn: (expr: BoxedExpression) => BoxedExpression,
    options?: { canonical: CanonicalOptions; recursive?: boolean }
  ): BoxedExpression;

  /**
   * Transform the expression by applying one or more replacement rules:
   *
   * - If the expression matches the `match` pattern and the `condition`
   *  predicate is true, replace it with the `replace` pattern.
   *
   * - If no rules apply, return `null`.
   *
   * See also `expr.subs()` for a simple substitution of symbols.
   *
   * Procedure for the determining the canonical-status of the input expression and replacements:
   *
   * - If `options.canonical` is set, the *entire expr.* is canonicalized to this degree: whether
   * the replacement occurs at the top-level, or within/recursively.
   *
   * - If otherwise, the *direct replacement will be canonical* if either the 'replaced' expression
   * is canonical, or the given replacement (- is a BoxedExpression and -) is canonical.
   * Notably also, if this replacement takes place recursively (not at the top-level), then exprs.
   * containing the replaced expr. will still however have their (previous) canonical-status
   * *preserved*... unless this expr. was previously non-canonical, and *replacements have resulted
   * in canonical operands*. In this case, an expr. meeting this criteria will be updated to
   * canonical status. (Canonicalization is opportunistic here, in other words).
   *
   * :::info[Note]
   * Applicable to canonical and non-canonical expressions.
   *
   * To match a specific symbol (not a wildcard pattern), the `match` must be
   * a `BoxedExpression` (e.g., `{ match: ce.box('x'), replace: ... }`).
   * For simple symbol substitution, consider using `subs()` instead.
   * :::
   */
  replace(
    rules: BoxedRuleSet | Rule | Rule[],
    options?: Partial<ReplaceOptions>
  ): null | BoxedExpression;

  /**
   * True if the expression includes a symbol `v` or a function operator `v`.
   *
   * :::info[Note]
   * Applicable to canonical and non-canonical expressions.
   * :::
   */
  has(v: string | string[]): boolean;

  /** Structural/symbolic equality (weak equality).
   *
   * `ce.parse('1+x', {form: 'raw'}).isSame(ce.parse('x+1', {form: 'raw'}))` is `false`.
   *
   * See `expr.isEqual()` for mathematical equality.
   *
   * :::info[Note]
   * Applicable to canonical and non-canonical expressions.
   * :::
   *
   * @category Relational Operator
   */
  isSame(rhs: BoxedExpression): boolean;

  /**
   * Equivalent to `BoxedExpression.isSame()` but the argument can be
   * a JavaScript primitive. For example, `expr.is(2)` is equivalent to
   * `expr.isSame(ce.number(2))`.
   *
   * @category Primitive Methods
   *
   */
  is(other: BoxedExpression | number | bigint | boolean | string): boolean;

  /**
   * If this expression matches `pattern`, return a substitution that makes
   * `pattern` equal to `this`. Otherwise return `null`.
   *
   * If `pattern` includes wildcards (symbols that start
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
    pattern: BoxedExpression,
    options?: PatternMatchOptions
  ): BoxedSubstitution | null;

  /**
   *
   * The **shape** describes the **axes** of the expression, where each axis
   * represent a way to index the elements of the expression.
   *
   * When the expression is a scalar (number), the shape is `[]`.
   *
   * When the expression is a vector of length `n`, the shape is `[n]`.
   *
   * When the expression is a `n` by `m` matrix, the shape is `[n, m]`.
   *
   *
   * @category Tensor Expression
   *
   */
  readonly shape: number[];

  /**
   * The **rank** refers to the number of dimensions (or axes) of the
   * expression.
   *
   * Return 0 for a scalar, 1 for a vector, 2 for a matrix, > 2 for
   * a multidimensional matrix.
   *
   * The rank is equivalent to the length of `expr.shape`
   *
   * :::info[Note]
   * There are several definitions of rank in the literature.
   * For example, the row rank of a matrix is the number of linearly
   * independent rows. The rank can also refer to the number of non-zero
   * singular values of a matrix.
   * :::
   *
   * @category Tensor Expression
   * */
  readonly rank: number;

  /**
   *
   * The value of both expressions are compared.
   *
   * If the expressions cannot be compared, return `undefined`
   *
   * @category Relational Operator
   */
  isLess(other: number | BoxedExpression): boolean | undefined;

  /**
   * The value of both expressions are compared.
   *
   * If the expressions cannot be compared, return `undefined`
   * @category Relational Operator
   */
  isLessEqual(other: number | BoxedExpression): boolean | undefined;

  /**
   * The value of both expressions are compared.
   *
   * If the expressions cannot be compared, return `undefined`
   * @category Relational Operator
   */
  isGreater(other: number | BoxedExpression): boolean | undefined;

  /**
   * The value of both expressions are compared.
   *
   * If the expressions cannot be compared, return `undefined`
   * @category Relational Operator
   */
  isGreaterEqual(other: number | BoxedExpression): boolean | undefined;

  /**
   * If true, the value of this expression is "Not a Number".
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
   * The numeric value of this expression is `±Infinity` or ComplexInfinity.
   *
   * @category Numeric Expression
   */
  readonly isInfinity: boolean | undefined;

  /** This expression is a number, but not `±Infinity`, `ComplexInfinity` or
   *  `NaN`
   *
   * @category Numeric Expression
   */
  readonly isFinite: boolean | undefined;

  /**
   * Wikidata identifier.
   *
   * If not a canonical expression, return `undefined`.
   *
   */
  readonly wikidata: string | undefined;

  /** An optional short description if a symbol or function expression.
   *
   * May include markdown. Each string is a paragraph.
   *
   * If not a canonical expression, return `undefined`.
   *
   */
  readonly description: undefined | string[];

  /** An optional URL pointing to more information about the symbol or
   *  function operator.
   *
   * If not a canonical expression, return `undefined`.
   *
   */
  readonly url: string | undefined;

  /** Expressions with a higher complexity score are sorted
   * first in commutative functions
   *
   * If not a canonical expression, return `undefined`.
   */
  readonly complexity: number | undefined;

  /**
   * For symbols and functions, a definition associated with the
   * expression. `this.baseDefinition` is the base class of symbol and function
   * definition.
   *
   * If not a canonical expression, return `undefined`.
   *
   */
  readonly baseDefinition: BoxedBaseDefinition | undefined;

  /**
   * For function expressions, the definition of the operator associated with
   * the expression. For symbols, the definition of the symbol if it is an
   * operator, for example `"Sin"`.
   *
   * If not a canonical expression or not a function expression,
   * its value is `undefined`.
   *
   */
  readonly operatorDefinition: BoxedOperatorDefinition | undefined;

  /**
   * For symbols, a definition associated with the expression, if it is
   * not an operator.
   *
   * If not a canonical expression, or not a value, its value is `undefined`.
   *
   */
  readonly valueDefinition: BoxedValueDefinition | undefined;

  /**
   *
   * Infer the type of this expression.
   *
   * For symbols, inference may take place for undeclared symbols,
   * symbols with an `unknown` type, or symbols with an inferred type.
   *
   * Constant symbols always have a defined type, and will return `false`.
   *
   * For functions, inference only takes place if it has an *inferred
   * signature*.
   *
   *
   * For a successful inference, *narrows* the type for symbols,
   * and for functions, narrows the *(return) type*.
   *
   * Subsequent inferences can be made and will refine previous ones if valid.
   *
   * If the given type is incompatible with the declared or previously inferred
   * type, return `false`.
   *
   *
   * @internal
   */
  infer(t: Type, inferenceMode?: 'narrow' | 'widen'): boolean;

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
   * Use when the environment, for example the precision, has changed to
   * force the expression to be re-evaluated.
   *
   * @internal
   */
  reset(): void;

  /**
   * Return a simpler form of this expression.
   *
   * A series of rewriting rules are applied repeatedly, until no more rules
   * apply.
   *
   * The values assigned to symbols and the assumptions about symbols may be
   * used, for example `expr.isInteger` or `expr.isPositive`.
   *
   * No calculations involving decimal numbers (numbers that are not
   * integers) are performed but exact calculations may be performed,
   * for example:
   *
   * $$ \sin(\frac{\pi}{4}) \longrightarrow \frac{\sqrt{2}}{2} $$.
   *
   * The result is canonical.
   *
   * To manipulate symbolically non-canonical expressions, use `expr.replace()`.
   *
   */
  simplify(options?: Partial<SimplifyOptions>): BoxedExpression;

  /**
   * Return the value of the canonical form of this expression.
   *
   * A pure expression always returns the same value (provided that it
   * remains constant / values of sub-expressions or symbols do not change),
   * and has no side effects.
   *
   * Evaluating an impure expression may return a varying value, and may have
   * some side effects such as adjusting symbol assumptions.
   *
   * To perform approximate calculations, use `expr.N()` instead,
   * or call with `options.numericApproximation` to `true`.
   *
   * It is possible that the result of `expr.evaluate()` may be the same as
   * `expr.simplify()`.
   *
   * The result is in canonical form.
   *
   */
  evaluate(options?: Partial<EvaluateOptions>): BoxedExpression;

  /** Asynchronous version of `evaluate()`.
   *
   * The `options` argument can include a `signal` property, which is an
   * `AbortSignal` object. If the signal is aborted, a `CancellationError` is thrown.
   *
   */
  evaluateAsync(options?: Partial<EvaluateOptions>): Promise<BoxedExpression>;

  /** Return a numeric approximation of the canonical form of this expression.
   *
   * Any necessary calculations, including on decimal numbers (non-integers),
   * are performed.
   *
   * The calculations are performed according to the
   * `precision` property of the `ComputeEngine`.
   *
   * To only perform exact calculations, use `this.evaluate()` instead.
   *
   * If the function is not numeric, the result of `this.N()` is the same as
   * `this.evaluate()`.
   *
   * The result is in canonical form.
   */
  N(): BoxedExpression;

  /**
   * If this is an equation, solve the equation for the variables in vars.
   * Otherwise, solve the equation `this = 0` for the variables in vars.
   *
   * For univariate equations, returns an array of solutions (roots).
   * For systems of linear equations (List of Equal expressions), returns
   * an object mapping variable names to their values.
   * For non-linear polynomial systems (like xy=6, x+y=5), returns an array
   * of solution objects (multiple solutions possible).
   *
   * ```javascript
   * // Univariate equation
   * const expr = ce.parse("x^2 + 2*x + 1 = 0");
   * console.log(expr.solve("x")); // Returns array of roots
   *
   * // System of linear equations
   * const system = ce.parse("\\begin{cases}x+y=70\\\\2x-4y=80\\end{cases}");
   * console.log(system.solve(["x", "y"])); // Returns { x: 60, y: 10 }
   *
   * // Non-linear polynomial system (product + sum)
   * const nonlinear = ce.parse("\\begin{cases}xy=6\\\\x+y=5\\end{cases}");
   * console.log(nonlinear.solve(["x", "y"])); // Returns [{ x: 2, y: 3 }, { x: 3, y: 2 }]
   * ```
   */
  solve(
    vars?:
      | Iterable<string>
      | string
      | BoxedExpression
      | Iterable<BoxedExpression>
  ):
    | null
    | ReadonlyArray<BoxedExpression>
    | Record<string, BoxedExpression>
    | Array<Record<string, BoxedExpression>>;

  /**
   * If this expression is a number literal, a string literal or a function
   *  literal, return the expression.
   *
   * If the expression is a symbol, return the value of the symbol.
   *
   * Otherwise, the expression is a symbolic expression, including an unknown
   * symbol, i.e. a symbol with no value, return `undefined`.
   *
   */
  get value(): BoxedExpression | undefined;

  /**
   * If the expression is a symbol, set the value of the symbol.
   *
   * Will throw a runtime error if either not a symbol, or a symbol with the
   * `constant` flag set to `true`.
   *
   * Setting the value of a symbol results in the forgetting of all assumptions
   * about it in the current scope.
   *
   */
  set value(
    value:
      | boolean
      | string
      | BigNum
      | OneOf<
          [
            { re: number; im: number },
            { num: number; denom: number },
            BoxedExpression,
          ]
        >
      | number[]
      | number
      | undefined
  );

  /**
   *
   * The type of the value of this expression.
   *
   * If a symbol the type of the value of the symbol.
   *
   * If a function expression, the type of the value of the function
   * (the result type).
   *
   * If a symbol with a `"function"` type (a function literal), returns the
   * signature.
   *
   * If not valid, return `"error"`.
   *
   * If the type is not known, return `"unknown"`.
   *
   * @category Type Properties
   */
  get type(): BoxedType;

  set type(type: Type | TypeString | BoxedType);

  /** `true` if the value of this expression is a number.
   *
   *
   * Note that in a fateful twist of cosmic irony, `NaN` ("Not a Number")
   * **is** a number.
   *
   * If `isNumber` is `true`, this indicates that evaluating the expression
   * will return a number.
   *
   * This does not indicate that the expression is a number literal. To check
   * if the expression is a number literal, use `expr.isNumberLiteral`.
   *
   * For example, the expression `["Add", 1, "x"]` is a number if "x" is a
   * number and `expr.isNumber` is `true`, but `isNumberLiteral` is `false`.
   *
   * @category Type Properties
   */
  readonly isNumber: boolean | undefined;

  /**
   *
   * The value of this expression is an element of the set ℤ: ...,-2, -1, 0, 1, 2...
   *
   * Note that ±∞ and NaN are not integers.
   *
   * @category Type Properties
   *
   */
  readonly isInteger: boolean | undefined;

  /** The value of this expression is an element of the set ℚ, p/q with p ∈ ℕ, q ∈ ℤ ⃰  q >= 1
   *
   * Note that every integer is also a rational.
   *
   * This is equivalent to `this.type === "rational" || this.type === "integer"`
   *
   * Note that ±∞ and NaN are not rationals.
   *
   * @category Type Properties
   *
   */
  readonly isRational: boolean | undefined;

  /**
   * The value of this expression is a real number.
   *
   * This is equivalent to `this.type === "rational" || this.type === "integer" || this.type === "real"`
   *
   * Note that ±∞ and NaN are not real numbers.
   *
   * @category Type Properties
   */
  readonly isReal: boolean | undefined;

  /** Mathematical equality (strong equality), that is the value
   * of this expression and the value of `other` are numerically equal.
   *
   * Both expressions are evaluated and the result is compared numerically.
   *
   * Numbers whose difference is less than `engine.tolerance` are
   * considered equal. This tolerance is set when the `engine.precision` is
   * changed to be such that the last two digits are ignored.
   *
   * Evaluating the expressions may be expensive. Other options to consider
   * to compare two expressions include:
   * - `expr.isSame(other)` for a structural comparison which does not involve
   *   evaluating the expressions.
   * - `expr.is(other)` for a comparison of a number literal
   *
   * **Examples**
   *
   * ```js
   * let expr = ce.parse('2 + 2');
   * console.log(expr.isEqual(4)); // true
   * console.log(expr.isSame(ce.parse(4))); // false
   * console.log(expr.is(4)); // false
   *
   * expr = ce.parse('4');
   * console.log(expr.isEqual(4)); // true
   * console.log(expr.isSame(ce.parse(4))); // true
   * console.log(expr.is(4)); // true (fastest)
   *
   * ```
   *
   * @category Relational Operator
   */
  isEqual(other: number | BoxedExpression): boolean | undefined;

  /**
   * Is `true` if the expression is a collection.
   *
   * When `isCollection` is `true`, the expression:
   *
   * - has an `each()` method that returns a generator over the elements
   *   of the collection.
   * - has a `size` property that returns the number of elements in the
   *   collection.
   * - has a `contains(other)` method that returns `true` if the `other`
   *   expression is in the collection.
   *
   */
  isCollection: boolean;

  /**
   * Is `true` if this is an indexed collection, such as a list, a vector,
   * a matrix, a tuple, etc...
   *
   * The elements of an indexed collection can be accessed by a one-based
   * index.
   *
   * When `isIndexedCollection` is `true`, the expression:
   * - has an `each()`, `size()` and `contains(rhs)` methods
   *    as for a collection.
   * - has an `at(index: number)` method that returns the element at the
   *    specified index.
   * - has an `indexWhere(predicate: (element: BoxedExpression) => boolean)`
   *    method that returns the index of the first element that matches the
   *    predicate.
   */
  isIndexedCollection: boolean;

  /**
   * False if not a collection, or if the elements of the collection
   * are not computed lazily.
   *
   * The elements of a lazy collection are computed on demand, when
   * iterating over the collection using `each()`.
   *
   * Use `ListFrom` and related functions to create eager collections from
   * lazy collections.
   *
   */
  isLazyCollection: boolean;

  /**
   * If this is a collection, return an iterator over the elements of the
   * collection.
   *
   * ```js
   * const expr = ce.parse('[1, 2, 3, 4]');
   * for (const e of expr.each()) {
   *  console.log(e);
   * }
   * ```
   */
  each(): Generator<BoxedExpression>;

  /**
   * If this is a collection, return true if the `rhs` expression is in the
   * collection.
   *
   * Return `undefined` if the membership cannot be determined without
   * iterating over the collection.
   */
  contains(rhs: BoxedExpression): boolean | undefined;

  /**
   * Check if this collection is a subset of another collection.
   *
   * @param other The other collection to check against.
   * @param strict If true, the subset relation is strict (i.e., proper subset).
   */
  subsetOf(other: BoxedExpression, strict: boolean): boolean | undefined;

  /**
   * If this is a collection, return the number of elements in the collection.
   *
   * If the collection is infinite, return `Infinity`.
   *
   * If the number of elements cannot be determined, return `undefined`, for
   * example, if the collection is lazy and not finite and the size cannot
   * be determined without iterating over the collection.
   *
   */
  get count(): number | undefined;

  /** If this is a finite collection, return true. */
  isFiniteCollection: boolean | undefined;

  /** If this is an empty collection, return true.
   *
   * An empty collection has a size of 0.
   */
  isEmptyCollection: boolean | undefined;

  /** If this is an indexed collection, return the element at the specified
   *  index. The first element is at index 1.
   *
   * If the index is negative, return the element at index `size() + index + 1`.
   *
   * The last element is at index -1.
   *
   */
  at(index: number): BoxedExpression | undefined;

  /** If this is a keyed collection (map, record, tuple), return the value of
   * the corresponding key.
   *
   * If `key` is a `BoxedExpression`, it should be a string.
   *
   */
  get(key: string | BoxedExpression): BoxedExpression | undefined;

  /**
   * If this is an indexed collection, return the index of the first element
   * that matches the predicate.
   *
   */
  indexWhere(
    predicate: (element: BoxedExpression) => boolean
  ): number | undefined;
}

//
// ── Role Interfaces ─────────────────────────────────────────────────────
//
// These interfaces narrow `BoxedExpression` to expression-kind-specific
// members.  Use the corresponding type guard (`isBoxedNumber`, etc.) to
// narrow an expression, then access these members without `undefined`.
//

/**
 * Narrowed interface for number literal expressions.
 *
 * Obtained via `isBoxedNumber()`.
 *
 * @category Boxed Expression
 */
export interface NumberLiteralInterface {
  readonly numericValue: number | NumericValue;
  readonly isNumberLiteral: true;
}

/**
 * Narrowed interface for symbol expressions.
 *
 * Obtained via `isBoxedSymbol()`.
 *
 * @category Boxed Expression
 */
export interface SymbolInterface {
  readonly symbol: string;
}

/**
 * Narrowed interface for function expressions.
 *
 * Obtained via `isBoxedFunction()`.
 *
 * @category Boxed Expression
 */
export interface FunctionInterface {
  readonly isFunctionExpression: true;
  readonly ops: ReadonlyArray<BoxedExpression>;
  readonly nops: number;
  readonly op1: BoxedExpression;
  readonly op2: BoxedExpression;
  readonly op3: BoxedExpression;
}

/**
 * Narrowed interface for string expressions.
 *
 * Obtained via `isBoxedString()`.
 *
 * @category Boxed Expression
 */
export interface StringInterface {
  readonly string: string;
}

/**
 * Narrowed interface for tensor expressions.
 *
 * Obtained via `isBoxedTensor()`.
 *
 * @category Boxed Expression
 */
export interface TensorInterface {
  readonly tensor: Tensor<any>;
  readonly shape: number[];
  readonly rank: number;
}

/**
 * Narrowed interface for collection expressions.
 *
 * Obtained via `isCollection()`.
 *
 * @category Boxed Expression
 */
export interface CollectionInterface {
  readonly isCollection: true;
  each(): Generator<BoxedExpression>;
  contains(rhs: BoxedExpression): boolean | undefined;
  subsetOf(other: BoxedExpression, strict: boolean): boolean | undefined;
  readonly count: number | undefined;
  readonly isFiniteCollection: boolean | undefined;
  readonly isEmptyCollection: boolean | undefined;
}

/**
 * Narrowed interface for indexed collection expressions (lists, vectors,
 * matrices, tuples).
 *
 * Obtained via `isIndexedCollection()`.
 *
 * @category Boxed Expression
 */
export interface IndexedCollectionInterface extends CollectionInterface {
  readonly isIndexedCollection: true;
  at(index: number): BoxedExpression | undefined;
  indexWhere(
    predicate: (element: BoxedExpression) => boolean
  ): number | undefined;
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
  | bigint
  | string
  | BigNum
  | MathJsonNumberObject
  | MathJsonStringObject
  | MathJsonSymbolObject
  | MathJsonFunctionObject
  | MathJsonDictionaryObject
  | readonly [MathJsonSymbol, ...SemiBoxedExpression[]]
  | BoxedExpression;

/** Interface for dictionary-like structures.
 * Use `isDictionary()` to check if an expression is a dictionary.
 */
export interface DictionaryInterface {
  get(key: string): BoxedExpression | undefined;
  has(key: string): boolean;
  get keys(): string[];
  get entries(): [string, BoxedExpression][];
  get values(): BoxedExpression[];
}

/**
 * These handlers compare two expressions.
 *
 * If only one of the handlers is provided, the other is derived from it.
 *
 * Having both may be useful if comparing non-equality is faster than equality.
 *
 *  @category Definitions
 *
 */
export interface EqHandlers {
  eq: (a: BoxedExpression, b: BoxedExpression) => boolean | undefined;
  neq: (a: BoxedExpression, b: BoxedExpression) => boolean | undefined;
}
