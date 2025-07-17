// This file contains type declarations that are used across the entire
// compute engine.
//
// To avoid circular dependencies, this file should not import any other
// files in the repository that depends on global types. The following
// subdirectories are allowed:
//
// - latex-syntax/
// - numerics/
// - numeric-value/
// - ../common/
// - ../math-json/
//
// The types in this file should be kept to a minimum, and should be used
// only for types that are needed in multiple places in the compute engine.
// This file may include both public types (which are exported) and internal
// types (which are not). The public types are should be exported from
// ./src/type.ts

import type { Complex } from 'complex-esm';
import type { OneOf } from '../common/one-of';
import type {
  Expression,
  MathJsonNumberObject,
  MathJsonStringObject,
  MathJsonFunctionObject,
  MathJsonSymbolObject,
  MathJsonSymbol,
  MathJsonDictionaryObject,
} from '../math-json';
import type {
  Type,
  TypeReference,
  TypeResolver,
  TypeString,
} from '../common/type/types';
import type { BoxedType } from '../common/type/boxed-type';

import type { ConfigurationChangeListener } from '../common/configuration-change';

import type {
  ExactNumericValueData,
  NumericValue,
  NumericValueData,
} from './numeric-value/types';
import type { BigNum, IBigNum, Rational } from './numerics/types';
import type {
  LatexDictionaryEntry,
  LatexString,
  ParseLatexOptions,
  SerializeLatexOptions,
} from './latex-syntax/types';
import type { IndexedLatexDictionary } from './latex-syntax/dictionary/definitions';

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
  trace(axis1?: number, axis2?: number): undefined | DataTypeMap[DT];
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

/**
 * :::info[THEORY OF OPERATIONS]
 *
 * The `BoxedExpression` interface includes the methods and properties
 * applicable to all kinds of expression. For example it includes `expr.symbol`
 * which only applies to symbols or `expr.ops` which only applies to
 * function expressions.
 *
 * When a property is not applicable to this `BoxedExpression` its value is
 * `null`. For example `expr.symbol` for a `BoxedNumber` is `null`.
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
   * As an example, the ["Add", 2, 3]` function expression is pure, but
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
   * Return `true` if this expression is a number literal, for example
   * `2`, `3.14`, `1/2`, `√2` etc.
   *
   * When `true`, `expr.numericValue` is not `null`.
   *
   * @category Numeric Expression
   *
   */
  readonly isNumberLiteral: boolean;

  /**
   * Return the value of this expression, if a number literal.
   *
   * Note it is possible for `expr.numericValue` to be `null`, and for
   * `expr.isNotZero` to be true. For example, when a symbol has been
   * defined with an assumption.
   *
   * Conversely, `expr.isNumber` may be true even if `expr.numericValue` is
   * `null`, for example the symbol `Pi` return `true` for `isNumber` but
   * `expr.numericValue` is `null` (it's a symbol, not a number literal).
   * Its value can be accessed with `expr.value`.
   *
   * To check if an expression is a number literal, use `expr.isNumberLiteral`.
   * If `expr.isNumberLiteral` is `true`, `expr.numericValue` is not `null`.
   *
   * @category Numeric Expression
   *
   */
  readonly numericValue: number | NumericValue | null;

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

  /** If this expression is a symbol, return the name of the symbol as a string.
   * Otherwise, return `null`.
   *
   * :::info[Note]
   * Applicable to canonical and non-canonical expressions.
   * :::
   *
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

  /**
   * Return `true` if this expression is a function expression.
   *
   * If `true`, `expr.ops` is not `null`, and `expr.operator` is the name
   * of the function.
   *
   * @category Function Expression
   */
  readonly isFunctionExpression: boolean;

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

  /** The list of operands of the function.
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

  /** First operand, i.e.`this.ops[0]`.
   *
   * If there is no first operand, return the symbol `Nothing`.
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
   * If there is no second operand, return the symbol `Nothing`.
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
   * If there is no third operand, return the symbol `Nothing`.
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
   * If `options.canonical` is not set, the result is canonical if `this`
   * is canonical.
   *
   * :::info[Note]
   * Applicable to canonical and non-canonical expressions.
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
   * `ce.parse('1+x', {canonical: false}).isSame(ce.parse('x+1', {canonical: false}))` is `false`.
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

  /** If this expression is a tensor, return the tensor data.
   * Otherwise, return `null`.
   *
   * :::info[Note]
   * Applicable to canonical and non-canonical expressions.
   * :::
   *
   * @category Tensor Expression
   *
   */
  readonly tensor: null | Tensor<any>;

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
   * Expand the expression: distribute multiplications over additions,
   * and expand powers.
   */
  expand(): BoxedExpression;

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
   * Compile the expression to a JavaScript function.
   *
   * The function takes an object as argument, with the keys being the
   * symbols in the expression, and returns the value of the expression.
   *
   *
   * ```javascript
   * const expr = ce.parse("x^2 + y^2");
   * const f = expr.compile();
   * console.log(f({x: 2, y: 3}));
   * // -> 13
   * ```
   *
   * If the expression is a function literal, the function takes the
   * arguments of the function as arguments, and returns the value of the
   * expression.
   *
   * ```javascript
   * const expr = ce.parse("(x) \mapsto 2x");
   * const f = expr.compile();
   * console.log(f(42));
   * // -> 84
   * ```
   *
   * If the expression cannot be compiled, a JS function is returned that
   * falls back to the interpreting the expression, unless the
   * `options.fallback` is set to `false`. If it is set to `false`, the
   * function will throw an error if it cannot be compiled.
   *
   */
  compile(options?: {
    to?: 'javascript' | 'wgsl' | 'python' | 'webassembly';
    functions?: Record<MathJsonSymbol, JSSource | ((...any) => any)>;
    vars?: Record<MathJsonSymbol, JSSource>;
    imports?: ((...any) => any)[];
    preamble?: string;
    fallback?: boolean;
  }): ((...args: any[]) => any) & { isCompiled?: boolean };

  /**
   * If this is an equation, solve the equation for the variables in vars.
   * Otherwise, solve the equation `this = 0` for the variables in vars.
   *
   *
   * ```javascript
   * const expr = ce.parse("x^2 + 2*x + 1 = 0");
   * console.log(expr.solve("x"));
   * ```
   *
   *
   */
  solve(
    vars?:
      | Iterable<string>
      | string
      | BoxedExpression
      | Iterable<BoxedExpression>
  ): null | ReadonlyArray<BoxedExpression>;

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

/** @category Definitions */
export type Hold = 'none' | 'all' | 'first' | 'rest' | 'last' | 'most';

/**
 * Options to control the serialization to MathJSON when using `BoxedExpression.toMathJson()`.
 *
 * @category Serialization
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
  shorthands: ('all' | 'number' | 'symbol' | 'function' | 'string')[];

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

/**
 * Control how a pattern is matched to an expression.
 *
 * - `substitution`: if present, assumes these values for the named wildcards,
 *    and ensure that subsequent occurrence of the same wildcard have the same
 *    value.
 * - `recursive`: if true, match recursively, otherwise match only the top
 *    level.
 * - `useVariations`: if false, only match expressions that are structurally identical.
 *    If true, match expressions that are structurally identical or equivalent.
 *
 *    For example, when true, `["Add", '_a', 2]` matches `2`, with a value of
 *    `_a` of `0`. If false, the expression does not match. **Default**: `false`
 *
 * @category Pattern Matching
 *
 */
export type PatternMatchOptions = {
  substitution?: BoxedSubstitution;
  recursive?: boolean;
  useVariations?: boolean;
};

/**
 * @category Boxed Expression
 *
 */
export type ReplaceOptions = {
  /**
   * If `true`, apply replacement rules to all sub-expressions.
   *
   * If `false`, only consider the top-level expression.
   *
   * **Default**: `false`
   */
  recursive: boolean;

  /**
   * If `true`, stop after the first rule that matches.
   *
   * If `false`, apply all the remaining rules even after the first match.
   *
   * **Default**: `false`
   */
  once: boolean;

  /**
   * If `true` the rule will use some equivalent variations to match.
   *
   * For example when `useVariations` is true:
   * - `x` matches `a + x` with a = 0
   * - `x` matches `ax` with a = 1
   * - etc...
   *
   * Setting this to `true` can save time by condensing multiple rules
   * into one. This can be particularly useful when describing equations
   * solutions. However, it can lead to infinite recursion and should be
   * used with caution.
   *
   */
  useVariations: boolean;

  /**
   * If `iterationLimit` > 1, the rules will be repeatedly applied
   * until no rules apply, up to `iterationLimit` times.
   *
   * Note that if `once` is true, `iterationLimit` has no effect.
   *
   * **Default**: `1`
   */
  iterationLimit: number;

  /**
   * Indicate if the expression should be canonicalized after the replacement.
   * If not provided, the expression is canonicalized if the expression
   * that matched the pattern is canonical.
   */
  canonical: CanonicalOptions;
};

/**
 * A bound symbol (i.e. one with an associated definition) has either a type
 * (e.g. ∀ x ∈ ℝ), a value (x = 5) or both (π: value = 3.14... type = 'real').
 *
 * @category Definitions
 */
export type ValueDefinition = BaseDefinition & {
  holdUntil: 'never' | 'evaluate' | 'N';

  type: Type | TypeString | BoxedType;

  /** If true, the type is inferred, and could be adjusted later
   * as more information becomes available or if the symbol is explicitly
   * declared.
   */
  inferred: boolean;

  /** `value` can be a JS function since for some constants, such as
   * `Pi`, the actual value depends on the `precision` setting of the
   * `ComputeEngine` and possible other environment settings */
  value:
    | LatexString
    | SemiBoxedExpression
    | ((ce: ComputeEngine) => BoxedExpression | null);

  eq: (a: BoxedExpression) => boolean | undefined;
  neq: (a: BoxedExpression) => boolean | undefined;
  cmp: (a: BoxedExpression) => '=' | '>' | '<' | undefined;

  collection: CollectionHandlers;
};

/**
 * Definition record for a function.
 * @category Definitions
 *
 */
export type OperatorDefinition = Partial<BaseDefinition> &
  Partial<OperatorDefinitionFlags> & {
    /**
     * The function signature, describing the type of the arguments and the
     * return type.
     *
     * If a `type` handler is provided, the return type of the function should
     * be a subtype of the return type in the signature.
     *
     */
    signature?: Type | TypeString | BoxedType;

    /**
     * The type of the result (return type) based on the type of
     * the arguments.
     *
     * Should be a subtype of the type indicated by the signature.
     *
     * For example, if the signature is `(number) -> real`, the type of the
     * result could be `real` or `integer`, but not `complex`.
     *
     * :::info[Note]
     * Do not evaluate the arguments.
     *
     * However, the type of the arguments can be used to determine the type of
     * the result.
     * :::
     *
     */
    type?: (
      ops: ReadonlyArray<BoxedExpression>,
      options: { engine: ComputeEngine }
    ) => Type | TypeString | BoxedType | undefined;

    /** Return the sign of the function expression.
     *
     * If the sign cannot be determined, return `undefined`.
     *
     * When determining the sign, only literal values and the values of
     * symbols, if they are literals, should be considered.
     *
     * Do not evaluate the arguments.
     *
     * However, the type and sign of the arguments can be used to determine the
     * sign.
     *
     */
    sgn?: (
      ops: ReadonlyArray<BoxedExpression>,
      options: { engine: ComputeEngine }
    ) => Sign | undefined;

    /** The value of this expression is > 0, same as `isGreater(0)`
     *
     * @category Numeric Expression
     */
    readonly isPositive?: boolean | undefined;

    /** The value of this expression is >= 0, same as `isGreaterEqual(0)`
     *
     * @category Numeric Expression
     */
    readonly isNonNegative?: boolean | undefined;

    /** The value of this expression is &lt; 0, same as `isLess(0)`
     *
     * @category Numeric Expression
     */
    readonly isNegative?: boolean | undefined;

    /** The  value of this expression is &lt;= 0, same as `isLessEqual(0)`
     *
     * @category Numeric Expression
     */
    readonly isNonPositive?: boolean | undefined;

    /** Return `true` if the function expression is even, `false` if it is odd
     * and `undefined` if it is neither (for example if it is not a number,
     * or if it is a complex number).
     */
    even?: (
      ops: ReadonlyArray<BoxedExpression>,
      options: { engine: ComputeEngine }
    ) => boolean | undefined;

    /**
     * A number used to order arguments.
     *
     * Argument with higher complexity are placed after arguments with
     * lower complexity when ordered canonically in commutative functions.
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
     * Return the canonical form of the expression with the arguments `args`.
     *
     * The arguments (`args`) may not be in canonical form. If necessary, they
     * can be put in canonical form.
     *
     * This handler should validate the type and number of the arguments
     * (arity).
     *
     * If a required argument is missing, it should be indicated with a
     * `["Error", "'missing"]` expression. If more arguments than expected
     * are present, this should be indicated with an
     * `["Error", "'unexpected-argument'"]` error expression
     *
     * If the type of an argument is not compatible, it should be indicated
     * with an `incompatible-type` error.
     *
     * `["Sequence"]` expressions are not folded and need to be handled
     *  explicitly.
     *
     * If the function is associative, idempotent or an involution,
     * this handler should account for it. Notably, if it is commutative, the
     * arguments should be sorted in canonical order.
     *
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
     * If the arguments do not match, they should be replaced with an
     * appropriate `["Error"]` expression. If the expression cannot be put in
     * canonical form, the handler should return `null`.
     *
     */
    canonical?: (
      ops: ReadonlyArray<BoxedExpression>,
      options: { engine: ComputeEngine; scope: Scope | undefined }
    ) => BoxedExpression | null;

    /**
     * Evaluate a function expression.
     *
     * When the handler is invoked, the arguments have been evaluated, except
     * if the `lazy` option is set to `true`.
     *
     * It is not necessary to further simplify or evaluate the arguments.
     *
     * If performing numerical calculations and `options.numericalApproximation`
     * is `false` return an exact numeric value, for example return a rational
     * number or a square root, rather than a floating point approximation.
     * Use `ce.number()` to create the numeric value.
     *
     * If the expression cannot be evaluated, due to the values, types, or
     * assumptions about its arguments, return `undefined` or
     * an `["Error"]` expression.
     */
    evaluate?:
      | ((
          ops: ReadonlyArray<BoxedExpression>,
          options: EvaluateOptions & { engine: ComputeEngine }
        ) => BoxedExpression | undefined)
      | BoxedExpression;

    /**
     * An asynchronous version of `evaluate`.
     *
     */
    evaluateAsync?: (
      ops: ReadonlyArray<BoxedExpression>,
      options: EvaluateOptions & { engine: ComputeEngine }
    ) => Promise<BoxedExpression | undefined>;

    /** Dimensional analysis
     * @experimental
     */
    evalDimension?: (
      args: ReadonlyArray<BoxedExpression>,
      options: EvaluateOptions & { engine: ComputeEngine }
    ) => BoxedExpression;

    /** Return a compiled (optimized) expression. */
    xcompile?: (expr: BoxedExpression) => CompiledExpression;

    eq?: (a: BoxedExpression, b: BoxedExpression) => boolean | undefined;
    neq?: (a: BoxedExpression, b: BoxedExpression) => boolean | undefined;

    collection?: CollectionHandlers;
  };

/**
 * Metadata common to both symbols and functions.
 *
 * @category Definitions
 *
 */
export interface BaseDefinition {
  /**
   * If a string, a short description, about one line long.
   *
   * Otherwise, a list of strings, each string a paragraph.
   *
   * May contain Markdown.
   */
  description: string | string[];

  /** A list of examples of how to use this symbol or operator.
   *
   * Each example is a string, which can be a MathJSON expression or LaTeX, bracketed by `$` signs.
   * For example, `["Add", 1, 2]` or `$\\sin(\\pi/4)$`.
   */
  examples: string | string[];

  /** A URL pointing to more information about this symbol or operator. */
  url: string;

  /**
   * A short string representing an entry in a wikibase.
   *
   * For example `"Q167"` is the [wikidata entry](https://www.wikidata.org/wiki/Q167)
   * for the `Pi` constant.
   */
  wikidata: string;

  /** If true, the value or type of the definition cannot be changed */
  readonly isConstant?: boolean;
}

/** Options for `BoxedExpression.simplify()`
 *
 * @category Boxed Expression
 */
export type SimplifyOptions = {
  /**
   * The set of rules to apply. If `null`, use no rules. If not provided,
   * use the default simplification rules.
   */
  rules?: null | Rule | ReadonlyArray<BoxedRule | Rule> | BoxedRuleSet;

  /**
   * Use this cost function to determine if a simplification is worth it.
   *
   * If not provided, `ce.costFunction`, the cost function of the engine is
   * used.
   */
  costFunction?: (expr: BoxedExpression) => number;
};

/**
 * A table mapping symbols to their definition.
 *
 * Symbols should be valid MathJSON symbols. In addition, the
 * following rules are recommended:
 *
 * - Use only latin letters, digits and `-`: `/[a-zA-Z0-9-]+/`
 * - The first character should be a letter: `/^[a-zA-Z]/`
 * - Functions and symbols exported from a library should start with an uppercase letter `/^[A-Z]/`
 *
 * @category Definitions
 *
 */

export type SymbolDefinition = OneOf<[ValueDefinition, OperatorDefinition]>;

/**
 * @category Definitions
 *
 */
export type SymbolDefinitions = Readonly<{
  [id: string]: Partial<SymbolDefinition>;
}>;

/**
 * When a unitless value is passed to or returned from a trigonometric function,
 * the angular unit of the value.
 *
 * | Angular Unit | Description |
 * |:--------------|:-------------|
 * | `rad` | radians, 2π radians is a full circle |
 * | `deg` | degrees, 360 degrees is a full circle |
 * | `grad` | gradians, 400 gradians is a full circle |
 * | `turn` | turns, 1 turn is a full circle |
 *
 * To change the angular unit used by the Compute Engine, use:
 *
 * ```js
 * ce.angularUnit = 'deg';
 * ```
 *
 * @category Compute Engine
 */
export type AngularUnit = 'rad' | 'deg' | 'grad' | 'turn';

/** @category Numerics */
export type Sign =
  /** The expression is equal to 0 */
  | 'zero'

  /** The expression is > 0 */
  | 'positive'

  /** The expression is < 0 */
  | 'negative'

  /** The expression is >= 0 and isPositive is either false or undefined*/
  | 'non-negative'

  /** The expression is <= 0 and isNegative is either false or undefined*/
  | 'non-positive'

  /** The expression is not equal to 0 (possibly with an imaginary part) and isPositive, isNegative, isUnsigned are all false or undefined */
  | 'not-zero'

  /** The expression has an imaginary part or is NaN */
  | 'unsigned';

/**
 * These handlers are the primitive operations that can be performed on
 * all collections, indexed or not.
 *
 *  @category Definitions
 */
export interface BaseCollectionHandlers {
  /**
   * Return an iterator that iterates over the elements of the collection.
   *
   * The order in which the elements are returned is not defined. Requesting
   * two iterators on the same collection may return the elements in a
   * different order.
   *
   * @category Definitions
   */
  iterator: (
    collection: BoxedExpression
  ) => Iterator<BoxedExpression, undefined> | undefined;

  /** Return the number of elements in the collection.
   *
   * An empty collection has a count of 0.
   */
  count: (collection: BoxedExpression) => number | undefined;

  /** Optional flag to quickly check if the collection is empty, without having to count exactly how may elements it has (useful for lazy evaluation). */
  isEmpty?: (collection: BoxedExpression) => boolean | undefined;

  /** Optional flag to quickly check if the collection is finite, without having to count exactly how many elements it has (useful for lazy evaluation). */
  isFinite?: (collection: BoxedExpression) => boolean | undefined;

  /** Return `true` if the collection is lazy, `false` otherwise.
   * If the collection is lazy, it means that the elements are not
   * computed until they are needed, for example when iterating over the
   * collection.
   *
   * Default: `true`
   */
  isLazy?: (collection: BoxedExpression) => boolean;

  /**
   * Return `true` if the target expression is in the collection,
   * `false` otherwise.
   *
   * Return `undefined` if the membership cannot be determined.
   */
  contains?: (
    collection: BoxedExpression,
    target: BoxedExpression
  ) => boolean | undefined;

  /**
   * Return `true` if all the elements of `other` are in `collection`.
   * Both `collection` and `other` are collections.
   *
   * If strict is `true`, the subset must be strict, that is, `collection` must
   * have more elements than `other`.
   *
   * Return `undefined` if the subset relation cannot be determined.
   */
  subsetOf?: (
    collection: BoxedExpression,
    other: BoxedExpression,
    strict: boolean
  ) => boolean | undefined;

  /** Return the sign of all the elements of the collection. */
  eltsgn?: (collection: BoxedExpression) => Sign | undefined;

  /** Return the widest type of all the elements in the collection */
  elttype?: (collection: BoxedExpression) => Type | undefined;
}

/**
 * These additional collection handlers are applicable to indexed
 * collections only.
 *
 * The elements of an indexed collection can be accessed by index, and
 * the order of the elements is defined.
 *
 *  @category Definitions
 */
export interface IndexedCollectionHandlers {
  /**
   * Return the element at the specified index.
   *
   * The first element is `at(1)`, the last element is `at(-1)`.
   *
   * If the index is &lt;0, return the element at index `count() + index + 1`.
   *
   * The index can also be a string for example for records. The set of valid
   * keys is returned by the `keys()` handler.
   *
   * If the index is invalid, return `undefined`.
   */
  at: (
    collection: BoxedExpression,
    index: number | string
  ) => undefined | BoxedExpression;

  /**
   * Return the index of the first element that matches the predicate.
   *
   * If no element matches the predicate, return `undefined`.
   */
  indexWhere: (
    collection: BoxedExpression,
    predicate: (element: BoxedExpression) => boolean
  ) => number | undefined;
}

/**
 * The collection handlers are the primitive operations that can be
 * performed on collections, such as lists, sets, tuples, etc...
 *
 *  @category Definitions
 */
export type CollectionHandlers = BaseCollectionHandlers &
  Partial<IndexedCollectionHandlers>;

/**
 *
 * The definition for a value, represented as a tagged object literal.
 * @category Definitions
 *
 */
export type TaggedValueDefinition = {
  value: BoxedValueDefinition;
};

/**
 *
 * The definition for an operator, represented as a tagged object literal.
 *
 * @category Definitions
 *
 */
export type TaggedOperatorDefinition = {
  operator: BoxedOperatorDefinition;
};

/**
 * A definition can be either a value or an operator.
 *
 * It is collected in a tagged object literal, instead of being a simple union
 * type, so that the type of the definition can be changed while keeping
 * references to the definition in bound expressions.
 *
 * @category Definitions
 *
 */
export type BoxedDefinition = TaggedValueDefinition | TaggedOperatorDefinition;

/**
 * @category Definitions
 *
 */
export interface BoxedBaseDefinition extends Partial<BaseDefinition> {
  /** If this is the definition of a collection, the set of primitive operations
   * that can be performed on this collection (counting the number of elements,
   * enumerating it, etc...).
   */
  collection?: CollectionHandlers;
}

/**
 *
 * @category Definitions
 */
export interface BoxedValueDefinition extends BoxedBaseDefinition {
  /**
    * If the symbol has a value, it is held as indicated in the table below.
    * A green checkmark indicate that the symbol is substituted.

  <div className="symbols-table">

  | Operation     | `"never"` | `"evaluate"` | `"N"` |
  | :---          | :-----:   | :----:      | :---:  |
  | `canonical()` |    (X)    |              |       |
  | `evaluate()`  |    (X)    |     (X)      |       |
  | `"N()"`       |    (X)    |     (X)      |  (X)  |

  </div>

    * Some examples:
    * - `ImaginaryUnit` has `holdUntil: 'never'`: it is substituted during canonicalization
    * - `x` has `holdUntil: 'evaluate'` (variables)
    * - `Pi` has `holdUntil: 'N'` (special numeric constant)
    * 
    * **Default:** `evaluate`
    */
  holdUntil: 'never' | 'evaluate' | 'N';

  /** This is either the initial value of the symbol (i.e. when a new
   *  evaluation context is created), or its constant value, if a constant.
   *  Otherwise, the current value is tracked in the evaluation context.
   *
   */
  readonly value: BoxedExpression | undefined;

  eq?: (a: BoxedExpression) => boolean | undefined;
  neq?: (a: BoxedExpression) => boolean | undefined;
  cmp?: (a: BoxedExpression) => '=' | '>' | '<' | undefined;

  /**
   * True if the type has been inferred. An inferred type can be updated as
   * more information becomes available.
   *
   * A type that is not inferred, but has been set explicitly, cannot be updated.
   */
  inferredType: boolean;

  type: BoxedType;
}

/**
 * An operator definition can have some flags to indicate specific
 * properties of the operator.
 * @category Definitions
 */
export type OperatorDefinitionFlags = {
  /**
   * If `true`, the arguments to this operator are not automatically
   * evaluated. The default is `false` (the arguments are evaluated).
   *
   * This can be useful for example for operators that take symbolic
   * expressions as arguments, such as `Declare` or `Integrate`.
   *
   * This is also useful for operators that take an argument that is
   * potentially an infinite collection.
   *
   * It will be up to the `evaluate()` handler to evaluate the arguments as
   * needed. This is convenient to pass symbolic expressions as arguments
   * to operators without having to explicitly use a `Hold` expression.
   *
   * This also applies to the `canonical()` handler.
   *
   */
  lazy: boolean;

  /**
   * If `true`, the operator requires a new lexical scope when canonicalized.
   * This will allow it to declare variables that are not visible outside
   * the function expression using the operator.
   *
   * **Default**: `false`
   */
  scoped: boolean;

  /**  If `true`, the operator is applied element by element to lists, matrices
   * (`["List"]` or `["Tuple"]` expressions) and equations (relational
   * operators).
   *
   * **Default**: `false`
   */
  broadcastable: boolean;

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

  /**
   * If `commutative` is `true`, the order of the arguments is determined by
   * this function.
   *
   * If the function is not provided, the arguments are ordered by the
   * default order of the arguments.
   *
   */
  commutativeOrder:
    | ((a: BoxedExpression, b: BoxedExpression) => number)
    | undefined;

  /** If `true`, when the operator is univariate, `["f", ["Multiply", x, c]]`
   * simplifies to `["Multiply", ["f", x], c]` where `c` is constant
   *
   * When the operator is multivariate, multiplicativity is considered only on
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

  /** If `true`, the value of this operator is always the same for a given
   * set of arguments and it has no side effects.
   *
   * An expression using this operator is pure if the operator and all its
   * arguments are pure.
   *
   * For example `Sin` is pure, `Random` isn't.
   *
   * This information may be used to cache the value of expressions.
   *
   * **Default:** `true`
   */
  pure: boolean;
};

/**
 *
 * The definition includes information specific about an operator, such as
 * handlers to canonicalize or evaluate a function expression with this
 * operator.
 *
 * @category Definitions
 *
 */
export interface BoxedOperatorDefinition
  extends BoxedBaseDefinition,
    OperatorDefinitionFlags {
  complexity: number;

  /** If true, the signature was inferred from usage and may be modified
   * as more information becomes available.
   */
  inferredSignature: boolean;

  /** The type of the arguments and return value of this function */
  signature: BoxedType;

  /** If present, this handler can be used to more precisely determine the
   * return type based on the type of the arguments. The arguments themselves
   * should *not* be evaluated, only their types should be used.
   */
  type?: (
    ops: ReadonlyArray<BoxedExpression>,
    options: { engine: ComputeEngine }
  ) => Type | TypeString | BoxedType | undefined;

  /** If present, this handler can be used to determine the sign of the
   *  return value of the function, based on the sign and type of its
   *  arguments.
   *
   * The arguments themselves should *not* be evaluated, only their types and
   * sign should be used.
   *
   * This can be used in some case for example to determine when certain
   * simplifications are valid.
   */
  sgn?: (
    ops: ReadonlyArray<BoxedExpression>,
    options: { engine: ComputeEngine }
  ) => Sign | undefined;

  eq?: (a: BoxedExpression, b: BoxedExpression) => boolean | undefined;
  neq?: (a: BoxedExpression, b: BoxedExpression) => boolean | undefined;

  canonical?: (
    ops: ReadonlyArray<BoxedExpression>,
    options: { engine: ComputeEngine; scope: Scope | undefined }
  ) => BoxedExpression | null;

  evaluate?: (
    ops: ReadonlyArray<BoxedExpression>,
    options: Partial<EvaluateOptions> & { engine?: ComputeEngine }
  ) => BoxedExpression | undefined;

  evaluateAsync?: (
    ops: ReadonlyArray<BoxedExpression>,
    options?: Partial<EvaluateOptions> & { engine?: ComputeEngine }
  ) => Promise<BoxedExpression | undefined>;

  evalDimension?: (
    ops: ReadonlyArray<BoxedExpression>,
    options: { engine: ComputeEngine }
  ) => BoxedExpression;

  compile?: (expr: BoxedExpression) => CompiledExpression;

  /** @internal */
  update(def: OperatorDefinition): void;
}

/** @category Assumptions */
export interface Assumption {
  isPositive: boolean | undefined;
  isNonNegative: boolean | undefined;
  isNegative: boolean | undefined;
  isNonPositive: boolean | undefined;

  isNumber: boolean | undefined;
  isInteger: boolean | undefined;
  isRational: boolean | undefined;
  isReal: boolean | undefined;
  isComplex: boolean | undefined;
  isImaginary: boolean | undefined;

  isFinite: boolean | undefined;
  isInfinite: boolean | undefined;
  isNaN: boolean | undefined;
  isZero: boolean | undefined;

  matches(t: BoxedType): boolean | undefined;

  isGreater(other: BoxedExpression): boolean | undefined;
  isGreaterEqual(other: BoxedExpression): boolean | undefined;
  isLess(other: BoxedExpression): boolean | undefined;
  isLessEqual(other: BoxedExpression): boolean | undefined;
  isEqual(other: BoxedExpression): boolean | undefined;

  toExpression(ce: ComputeEngine, x: MathJsonSymbol): BoxedExpression;
}

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

/** @category Assumptions */
export type AssumeResult =
  | 'internal-error'
  | 'not-a-predicate'
  | 'contradiction'
  | 'tautology'
  | 'ok';

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
 *    application (`f(x)`). Also replaces ['InvisibleOperator', real, imaginary] instances with
 *    complex (imaginary) numbers.
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

/** @category Boxed Expression */
export type CanonicalOptions = boolean | CanonicalForm | CanonicalForm[];

/** Options for `BoxedExpression.evaluate()`
 *
 * @category Boxed Expression
 */
export type EvaluateOptions = {
  /**
   * If `true`, the evaluation will return a numeric approximation
   * of the expression, if possible.
   * If `false`, the evaluation will return an exact value, if possible.
   * Defaults to `false`.
   */
  numericApproximation: boolean;
  /**
   * If `false`, and the result of the expression is a lazy collection,
   * the collection will not be evaluated and will remain lazy.
   *
   * If `true` and the expression is a finite lazy collection,
   * the collection will be evaluated and returned as a non-lazy collection.
   *
   * If an integer, the collection will be evaluated up to that many elements.
   *
   * If a pair of integers `[n,m]`, and the collection is finite, the first `n`
   * elements will be evaluated, and the last `m` elements will be evaluated.
   *
   * Defaults to `false`.
   */
  materialization: boolean | number | [number, number];
  signal: AbortSignal;
  withArguments: Record<MathJsonSymbol, BoxedExpression>;
};

/**
 * Metadata that can be associated with an MathJSON expression.
 *
 * @category Boxed Expression
 */

export type Metadata = {
  latex?: string | undefined;
  wikidata?: string | undefined;
};

/**
  * A substitution describes the values of the wildcards in a pattern so that
  * the pattern is equal to a target expression.
  *
  * A substitution can also be considered a more constrained version of a
  * rule whose `match` is always a symbol.

  * @category Pattern Matching
  */
export type Substitution<T = SemiBoxedExpression> = {
  [symbol: string]: T;
};

/**
 * @category Pattern Matching
 *
 */
export type BoxedSubstitution = Substitution<BoxedExpression>;

/**
 * Given an expression and set of wildcards, return a new expression.
 *
 * For example:
 *
 * ```ts
 * {
 *    match: '_x',
 *    replace: (expr, {_x}) => { return ['Add', 1, _x] }
 * }
 * ```
 *
 * @category Rules */
export type RuleReplaceFunction = (
  expr: BoxedExpression,
  wildcards: BoxedSubstitution
) => BoxedExpression | undefined;

/** @category Rules */
export type RuleConditionFunction = (
  wildcards: BoxedSubstitution,
  ce: ComputeEngine
) => boolean;

/** @category Rules */
export type RuleFunction = (
  expr: BoxedExpression
) => undefined | BoxedExpression | RuleStep;

/** @category Rules */
export type RuleStep = {
  value: BoxedExpression;
  because: string; // id of the rule
};

/** @category Rules */
export type RuleSteps = RuleStep[];

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
 * Sequence wildcards are useful when the number of elements in the sequence
 * is not known in advance. For example, in a sum, the number of terms is
 * not known in advance. ["Add", 0, `__a`] will match two or more terms and
 * the `__a` wildcard will be a sequence of the matchign terms.
 *
 * If `exact` is false, the rule will match variants.
 *
 * For example 'x' will match 'a + x', 'x' will match 'ax', etc...
 *
 * For simplification rules, you generally want `exact` to be true, but
 * to solve equations, you want it to be false. Default to true.
 *
 * When set to false, infinite recursion is possible.
 *
 * @category Rules
 */

export type Rule =
  | string
  | RuleFunction
  | {
      match?: LatexString | SemiBoxedExpression | BoxedExpression;
      replace:
        | LatexString
        | SemiBoxedExpression
        | RuleReplaceFunction
        | RuleFunction;
      condition?: LatexString | RuleConditionFunction;
      useVariations?: boolean; // Default to false
      id?: string; // Optional, for debugging or filtering
      onBeforeMatch?: (rule: Rule, expr: BoxedExpression) => void;
      onMatch?: (
        rule: Rule,
        expr: BoxedExpression,
        replace: BoxedExpression | RuleStep
      ) => void; // For debugging, called when rule matches
    };

/**
 *
 * If the `match` property is `undefined`, all expressions match this rule
 * and `condition` should also be `undefined`. The `replace` property should
 * be a `BoxedExpression` or a `RuleFunction`, and further filtering can be
 * done in the `replace` function.
 *
 * @category Rules
 */
export type BoxedRule = {
  /** @internal */
  readonly _tag: 'boxed-rule';

  match: undefined | BoxedExpression;

  replace: BoxedExpression | RuleReplaceFunction | RuleFunction;

  condition: undefined | RuleConditionFunction;

  useVariations?: boolean; // If true, the rule will match variations, for example
  // 'x' will match 'a + x', 'x' will match 'ax', etc...
  // Default to false.

  id?: string; // For debugging

  onBeforeMatch?: (rule: Rule, expr: BoxedExpression) => void;
  onMatch?: (
    rule: Rule,
    expr: BoxedExpression,
    replace: BoxedExpression | RuleStep
  ) => void; // For debugging, called when rule matches
};

/**
 * To create a BoxedRuleSet use the `ce.rules()` method.
 *
 * Do not create a `BoxedRuleSet` directly.
 *
 * @category Rules
 */
export type BoxedRuleSet = { rules: ReadonlyArray<BoxedRule> };

/**
 * The argument of `ce.assign()` is a value that can be assigned to a variable.
 * It can be a primitive value, a boxed expression, or a function that
 * takes a list of arguments and returns a boxed expression.
 * @category Compute Engine */
export type AssignValue =
  | boolean
  | number
  | bigint
  | SemiBoxedExpression
  | ((
      args: ReadonlyArray<BoxedExpression>,
      options: EvaluateOptions & { engine: ComputeEngine }
    ) => BoxedExpression)
  | undefined;

/**
 * A lexical scope is a table mapping symbols to their definitions. The
 * symbols are the names of the variables, unknowns and functions in the scope.
 *
 * The lexical scope is used to resolve the metadata about symbols, such as
 * their type, whether they are constant, etc...
 *
 * It does not resolve the values of the symbols, since those depend on the
 * evaluation context. For example, the local variables of a recursive function
 * will have the same lexical scope, but different values in each evaluation
 * context.
 *
 * @category Definitions
 */
export type Scope = {
  parent: Scope | null;
  bindings: Map<string, BoxedDefinition>;
  types?: Record<string, TypeReference>;
};

/**
 * An evaluation context is a set of bindings mapping symbols to their
 * values. It also includes a reference to the lexical scope of the
 * context, as well as a set of assumptions about the values of the
 * symbols.
 *
 *
 * Eval contexts are arranged in a stack structure. When a new context is
 * created, it is pushed on the top of the stack.
 *
 * A new eval context is created when a function expression that needs to track
 * its own local variables and named arguments is evaluated. This kind of
 * function is a "scoped" function, meaning that it has its own local variables
 * and named arguments.
 *
 * For example, the `Sum` function creates a new eval context to track the local
 * variable used as the index of the sum.
 *
 * The eval context stack is used to resolve the value of symbols.
 *
 * When a scoped recursive function is called, a new context is created for each
 * recursive call.
 *
 * In contrast, the lexical scope is used to resolve the metadata about
 * symbols, such as their type, whether they are constant, etc... A new
 * scope is not created for recursive calls, since the metadata
 * does not change, only the values of the symbols change.
 *
 * The name of the eval context is used to print a "stack trace" for
 * debugging.
 *
 * @category Compute Engine
 */
export type EvalContext = {
  lexicalScope: Scope;
  assumptions: ExpressionMapInterface<boolean>;
  values: Record<string, BoxedExpression | undefined>;
  name: undefined | string;
};

/** @internal */
export interface ComputeEngine extends IBigNum {
  latexDictionary: readonly LatexDictionaryEntry[];

  /** @private */
  _indexedLatexDictionary: IndexedLatexDictionary;

  decimalSeparator: LatexString;

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
  /** ImaginaryUnit */
  readonly I: BoxedExpression;
  readonly NaN: BoxedExpression;
  readonly PositiveInfinity: BoxedExpression;
  readonly NegativeInfinity: BoxedExpression;
  readonly ComplexInfinity: BoxedExpression;

  /** @internal */
  readonly _BIGNUM_NAN: BigNum;
  /** @internal */
  readonly _BIGNUM_ZERO: BigNum;
  /** @internal */
  readonly _BIGNUM_ONE: BigNum;
  /** @internal */
  readonly _BIGNUM_TWO: BigNum;
  /** @internal */
  readonly _BIGNUM_HALF: BigNum;
  /** @internal */
  readonly _BIGNUM_PI: BigNum;
  /** @internal */
  readonly _BIGNUM_NEGATIVE_ONE: BigNum;

  readonly context: EvalContext;
  contextStack: ReadonlyArray<EvalContext>;

  /** @internal */
  readonly _typeResolver: TypeResolver;

  /** Absolute time beyond which evaluation should not proceed
   * @internal
   */
  _deadline?: number;

  /** Time remaining before _deadline
   * @internal
   */
  _timeRemaining: number;

  /** @internal */
  _generation: number;

  timeLimit: number;

  iterationLimit: number;

  recursionLimit: number;

  chop(n: number): number;
  chop(n: BigNum): BigNum | 0;
  chop(n: number | BigNum): number | BigNum;

  bignum: (a: string | number | bigint | BigNum) => BigNum;

  complex: (a: number | Complex, b?: number) => Complex;

  /** @internal */
  _numericValue(
    value:
      | number
      | bigint
      | OneOf<[BigNum | NumericValueData | ExactNumericValueData]>
  ): NumericValue;

  set precision(p: number | 'machine' | 'auto');
  get precision(): number;

  tolerance: number;

  angularUnit: AngularUnit;

  costFunction: (expr: BoxedExpression) => number;

  strict: boolean;

  box(
    expr: NumericValue | SemiBoxedExpression,
    options?: {
      canonical?: CanonicalOptions;
      structural?: boolean;
      scope?: Scope;
    }
  ): BoxedExpression;

  function(
    name: string,
    ops: ReadonlyArray<SemiBoxedExpression>,
    options?: {
      metadata?: Metadata;
      canonical?: CanonicalOptions;
      structural?: boolean;
      scope?: Scope;
    }
  ): BoxedExpression;

  /**
   * This is a primitive to create a boxed function.
   *
   * In general, consider using `ce.box()` or `ce.function()` or
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
    name: string,
    ops: ReadonlyArray<BoxedExpression>,
    options?: {
      metadata?: Metadata;
      canonical?: boolean;
      scope?: Scope;
    }
  ): BoxedExpression;

  number(
    value:
      | number
      | bigint
      | string
      | NumericValue
      | MathJsonNumberObject
      | BigNum
      | Complex
      | Rational,
    options?: { metadata?: Metadata; canonical?: CanonicalOptions }
  ): BoxedExpression;

  symbol(
    sym: string,
    options?: { canonical?: CanonicalOptions }
  ): BoxedExpression;

  string(s: string, metadata?: Metadata): BoxedExpression;

  error(message: string | string[], where?: string): BoxedExpression;

  typeError(
    expectedType: Type,
    actualType: undefined | Type | BoxedType,
    where?: SemiBoxedExpression
  ): BoxedExpression;

  hold(expr: SemiBoxedExpression): BoxedExpression;

  tuple(...elements: ReadonlyArray<number>): BoxedExpression;
  tuple(...elements: ReadonlyArray<BoxedExpression>): BoxedExpression;

  type(type: Type | TypeString | BoxedType): BoxedType;

  rules(
    rules:
      | Rule
      | ReadonlyArray<Rule | BoxedRule>
      | BoxedRuleSet
      | undefined
      | null,
    options?: { canonical?: boolean }
  ): BoxedRuleSet;

  getRuleSet(
    id?: 'harmonization' | 'solve-univariate' | 'standard-simplification'
  ): BoxedRuleSet | undefined;

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

  pushScope(scope?: Scope, name?: string): void;
  popScope(): void;

  /**
   *
   * When a new eval context is created, it has slots for the local variables
   * from the current lexical scope. It also copies the current set of
   * assumptions.
   *
   * Need a pointer to the current lexical scope (may have a scope chain without an evaluation context). Each lexical scope includes a pointer to the parent scope (it's a DAG).
   *
   * If a function is "scoped" (has a `scoped` flag), create a new lexical scope
   * when the function is canonicalized, store the scope with the function
   * definition (if the function has a lazy flag, and a canonical handler, it
   * can behave like a scoped function, but a scoped flag is convenient,
   * it would still evaluate the arguments).
   *
   * Note: if an expression is not canonical, evaluating it return itself.
   * This is important to support arguments that are just symbol names
   * (they are not canonicalized).
   *
   * When the function expression is evaluated, if it is "scoped", push the
   * scope associated with the function (maybe not?) and a matching eval
   * context, including all the symbols in the lexical scope (including
   * constants). Need some way to indicate that a symbol maps to an argument
   * (in value definition?).
   *
   * When searching the value of a symbol, start with the current
   * eval context, then the previous one.
   *
   * When looking for a definition, start with the lexical scope of the
   * current eval context, then the parent lexical context.
   *
   * @internal */
  _pushEvalContext(scope: Scope, name?: string): void;

  /** @internal */
  _popEvalContext(): void;

  /**
   * Temporarily sets the lexical scope to the provided scope, then
   * executes the function `f` in that scope and returns the result.
   * @internal */
  _inScope<T>(scope: Scope | undefined, f: () => T): T;

  /**
   * Use `ce.box(id)` instead
   * @internal */
  _getSymbolValue(id: MathJsonSymbol): BoxedExpression | undefined;
  /**
   * Use `ce.assign(id, value)` instead.
   * @internal */
  _setSymbolValue(
    id: MathJsonSymbol,
    value: BoxedExpression | boolean | number | undefined
  ): void;

  /** A list of the function calls to the current evaluation context */
  trace: ReadonlyArray<string>;

  lookupContext(id: MathJsonSymbol): undefined | EvalContext;

  /** @internal */
  _swapContext(context: EvalContext): void;

  lookupDefinition(id: MathJsonSymbol): undefined | BoxedDefinition;

  assign(ids: { [id: MathJsonSymbol]: AssignValue }): ComputeEngine;
  assign(id: MathJsonSymbol, value: AssignValue): ComputeEngine;
  assign(
    arg1: MathJsonSymbol | { [id: MathJsonSymbol]: AssignValue },
    arg2?: AssignValue
  ): ComputeEngine;

  declareType(name: string, type: Type, options?: { alias?: boolean }): void;

  declare(symbols: {
    [id: MathJsonSymbol]: Type | TypeString | Partial<SymbolDefinition>;
  }): ComputeEngine;
  declare(
    id: MathJsonSymbol,
    def: Type | TypeString | Partial<SymbolDefinition>,
    scope?: Scope
  ): ComputeEngine;
  declare(
    arg1:
      | MathJsonSymbol
      | {
          [id: MathJsonSymbol]: Type | TypeString | Partial<SymbolDefinition>;
        },
    arg2?: Type | TypeString | Partial<SymbolDefinition>,
    arg3?: Scope
  ): ComputeEngine;

  assume(predicate: BoxedExpression): AssumeResult;

  forget(symbol?: MathJsonSymbol | MathJsonSymbol[]): void;

  ask(pattern: BoxedExpression): BoxedSubstitution[];

  verify(query: BoxedExpression): boolean;

  /** @internal */
  _shouldContinueExecution(): boolean;

  /** @internal */
  _checkContinueExecution(): void;

  /** @internal */
  _cache<T>(name: string, build: () => T, purge?: (t: T) => T | undefined): T;

  /** @internal */
  _reset(): void;

  /** @internal */
  listenToConfigurationChange(tracker: ConfigurationChangeListener): () => void;
}
