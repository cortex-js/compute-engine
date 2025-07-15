/**
 * A primitive type is a simple type that represents a concrete value.
 *
 * - `any`: the top type
 *    - `expression`
 *    - `error`: an invalid value, such as `["Error", "missing"]`
 *    - `nothing`: the type of the `Nothing` symbol, the unit type
 *    - `never`: the bottom type
 *    - `unknown`: a value whose type is not known
 *
 * - `expression`:
 *    - a symbolic expression, such as `["Add", "x", 1]`
 *    - `<value>`
 *    - `symbol`: a symbol, such as `x`.
 *    - `function`: a function literal
 *      such as `["Function", ["Add", "x", 1], "x"]`.
 *
 * - `value`
 *    - `scalar`
 *      - `<number>`
 *      - `boolean`: a boolean value: `True` or `False`.
 *      - `string`: a string of characters.
 *    - `collection`
 *       - `set`: a collection of unique expressions, e.g. `set<string>`.
 *       - `record`: a collection of specific key-value pairs,
 *          e.g. `record<x: number, y: boolean>`.
 *       - `dictionary`: a collection of arbitrary key-value pairs
 *          e.g. `dictionary<string, number>`.
 *       - `indexed_collection`: collections whose elements can be accessed
 *             by a numeric index
 *          - `list`: a collection of expressions, possibly recursive,
 *              with optional dimensions, e.g. `[number]`, `[boolean^32]`,
 *              `[number^(2x3)]`. Used to represent a vector, a matrix or a
 *              tensor when the type of its elements is a number
 *           - `tuple`: a fixed-size collection of named or unnamed elements,
 *              e.g. `tuple<number, boolean>`, `tuple<x: number, y: boolean>`.
 *
 *
 *
 */
export type PrimitiveType =
  | NumericPrimitiveType
  | 'collection'
  | 'indexed_collection'
  | 'list'
  | 'set'
  | 'dictionary'
  | 'record'
  | 'dictionary'
  | 'tuple'
  | 'value'
  | 'scalar'
  | 'function'
  | 'symbol'
  | 'boolean'
  | 'string'
  | 'expression'
  | 'unknown'
  | 'error'
  | 'nothing'
  | 'never'
  | 'any';

/**
 * - `number`: any numeric value = `complex` + `real` plus `NaN`
 * - `complex`: a number with non-zero real and imaginary parts = `finite_complex` plus `ComplexInfinity`
 * - `finite_complex`: a finite complex number = `imaginary` + `finite_real`
 * - `imaginary`: a complex number with a real part of 0 (pure imaginary)
 * - `finite_number`: a finite numeric value = `finite_complex`
 * - `finite_real`: a finite real number = `finite_rational` + `finite_integer`
 * - `finite_rational`: a pure rational number
 * - `finite_integer`: a whole number
 * - `real`: a complex number with an imaginary part of 0 = `finite_real` + `non_finite_number`
 * - `non_finite_number`: `PositiveInfinity`, `NegativeInfinity`
 * - `integer`: a whole number = `finite_integer` + `non_finite_number`
 * - `rational`: a pure rational number (not an integer) = `finite_rational` + `non_finite_number`
 *
 */
export type NumericPrimitiveType =
  | 'number'
  | 'finite_number'
  | 'complex'
  | 'finite_complex'
  | 'imaginary'
  | 'real'
  | 'finite_real'
  | 'rational'
  | 'finite_rational'
  | 'integer'
  | 'finite_integer'
  | 'non_finite_number';

export type NamedElement = {
  name?: string;
  type: Type;
};

export type FunctionSignature = {
  kind: 'signature';
  args?: NamedElement[];
  optArgs?: NamedElement[];
  variadicArg?: NamedElement;
  variadicMin?: 0 | 1; // If variadicArg is present, this indicates whether it can be empty or not
  result: Type;
};

export type AlgebraicType = {
  kind: 'union' | 'intersection';
  types: Type[];
};

export type NegationType = {
  kind: 'negation';
  type: Type;
};

export type ValueType = {
  kind: 'value';
  value: any;
};

/** A record is a collection of key-value pairs.
 *
 * The keys are strings. The set of keys is fixed.
 *
 * For a record type to be a subtype of another record type, it must have a
 * subset of the keys, and all their types must match (width subtyping).
 *
 */
export type RecordType = {
  kind: 'record';
  elements: Record<string, Type>;
};

/** A dictionary is a collection of key-value pairs.
 *
 * The keys are strings. The set of keys is also not defined as part of the
 * type and can be modified at runtime.
 *
 * A dictionary is suitable for use as cache or data storage.
 */
export type DictionaryType = {
  kind: 'dictionary';
  values: Type;
};

/**
 * `CollectionType` is a generic collection of elements of a certain type.
 *
 * - Indexed collections: List, Tuple
 * - Non-indexed: Set, Record, Dictionary
 *
 */
export type CollectionType = {
  kind: 'collection' | 'indexed_collection';
  elements: Type;
};

/**
 * The elements of a list can be accessed by their one-based index.
 *
 * All elements of a list have the same type, but it can be a broad type,
 * up to `any`.
 *
 * The same element can be present in the list more than once.
 *
 * A list can be multi-dimensional. For example, a list of integers with
 * dimensions 2x3x4 is a 3D tensor with 2 layers, 3 rows and 4 columns.
 *
 */
export type ListType = {
  kind: 'list';
  elements: Type;
  dimensions?: number[];
};

export type SymbolType = {
  kind: 'symbol';
  name: string;
};

export type ExpressionType = {
  kind: 'expression';
  operator: string;
};

export type NumericType = {
  kind: 'numeric';
  type: NumericPrimitiveType;
  lower?: number;
  upper?: number;
};

/** Each element of a set is unique (is not present in the set more than once).
 * The elements of a set are not indexed.
 */
export type SetType = {
  kind: 'set';
  elements: Type;
};

/** The elements of a tuple are indexed and may be named or unnamed.
 * If one element is named, all elements must be named.
 */
export type TupleType = {
  kind: 'tuple';
  elements: NamedElement[];
};

/** Nominal typing */
export type TypeReference = {
  kind: 'reference';
  name: string;
  alias: boolean;
  def: Type | undefined;
};

export type Type =
  | PrimitiveType
  | AlgebraicType
  | NegationType
  | CollectionType
  | ListType
  | SetType
  | RecordType
  | DictionaryType
  | TupleType
  | SymbolType
  | ExpressionType
  | NumericType
  | NumericPrimitiveType
  | FunctionSignature
  | ValueType
  | TypeReference;

/**
 * The type of a boxed expression indicates the kind of expression it is and
 * the value it represents.
 *
 * The type is represented either by a primitive type (e.g. number, complex, collection, etc.), or a compound type (e.g. tuple, function signature, etc.).
 *
 * Types are described using the following BNF grammar:
 *
 * ```bnf
 * <type> ::= <union_type> | "(" <type> ")"
 *
 * <union_type> ::= <intersection_type> (" | " <intersection_type>)*
 *
 * <intersection_type> ::= <primary_type> (" & " <primary_type>)*
 *
 * <primary_type> ::=  <primitive>
 *                | <tuple_type>
 *                | <signature>
 *                | <list_type>
 *
 * <primitive> ::= "any" | "unknown" | <value-type> | <symbolic-type> | <numeric-type>
 *
 * <numeric-type> ::= "number" | "complex" | "imaginary" | "real" | "rational" | "integer"
 *
 * <value-type> ::= "value" | <numeric-type> | "collection" | "boolean" | "string"
 *
 * <symbolic-type> ::= "expression" | "function" | "symbol"
 *
 * <tuple_type> ::= "tuple<" (<name> <type> "," <named_tuple_elements>*) ">"
 *            | "tuple<" (<type> "," <unnamed_tuple_elements>*) ">" |
 *            | "tuple<" <tuple_elements> ">"
 *
 * <tuple_elements> ::= <unnamed_tuple_elements> | <named_tuple_elements>
 *
 * <unnamed_tuple_elements> ::= <type> ("," <type>)*
 *
 * <named_tuple_elements> ::= <name> <type> ("," <name> <type>)*
 *
 * <signature> ::=  <arguments> " -> " <type>
 *
 * <arguments> ::= "()"
 *            | <argument>
 *            | "(" <argument-list> ")"
 *
 * <argument> ::= <type>
 *            | <name> <type>
 *
 * <rest_argument> ::= "..." <type>
 *            | <name> "..." <type>
 *
 * <optional_argument> ::= <argument> "?"
 *
 * <optional_arguments> ::= <optional_argument> ("," <optional_argument>)*
 *
 * <required_arguments> ::= <argument> ("," <argument>)*
 *
 * <argument-list> ::= <required_arguments> ("," <rest_argument>)?
 *            | <required_arguments> <optional_arguments>?
 *            | <optional_arguments>?
 *            | <rest_argument>
 *
 * <list_type> ::= "list<" <type> <dimensions>? ">"
 *
 * <dimensions> ::= "^" <fixed_size>
 *            | "^(" <multi_dimensional_size> ")"
 *
 * <fixed_size> ::= <positive-integer_literal>
 *
 * <multi_dimensional_size> ::= <positive-integer_literal> "x" <positive-integer_literal> ("x" <positive-integer_literal>)*
 *
 * <map> ::= "map" | "map<" <map_elements> ">"
 *
 * <map_elements> ::= <name> <type> ("," <name> <type>)*
 *
 * <set> ::= "set<" <type> ">"
 *
 * <collection ::= "collection<" <type> ">"
 *
 * <name> ::= <identifier> ":"
 *
 * <identifier> ::= [a-zA-Z_][a-zA-Z0-9_]*
 *
 * <positive-integer_literal> ::= [1-9][0-9]*
 *```
 *
 * Examples of types strings:
 * - `"number"`    -- a simple type primitive
 * - `"(number, boolean)"` -- a tuple type
 * - `"(x: number, y:boolean)"` -- a named tuple/record type. Either all arguments are named, or none are
 * - `"collection<any>"` -- an arbitrary collection type, with no length or element type restrictions
 * - `"collection<integer>"` -- a collection type where all the elements are integers
 * - `"collection<(number, boolean)>"` -- a collection of tuples
 * - `"collection<(value:number, seen:boolean)>"` -- a collection of named tuples
 * - `"[boolean]^32"` -- a collection type with a fixed size of 32 elements
 * - `"[integer]^(2x3)"` -- an integer matrix of 2 columns and 3 rows
 * - `"[integer]^(2x3x4)"` -- a tensor of dimensions 2x3x4
 * - `"number -> number"` -- a signature with a single argument
 * - `"(x: number, number) -> number"` -- a signature with a named argument
 * - `"(number, y:number?) -> number"` -- a signature with an optional named argument (can have several optional arguments, at the end)
 * - `"(number, number+) -> number"` -- a signature with a rest argument (can have only one, and no optional arguments if there is a rest argument).
 * - `"() -> number"` -- a signature with an empty argument list
 * - `"number | boolean"` -- a union type
 * - `"(x: number) & (y: number)"` -- an intersection type
 * - `"number | ((x: number) & (y: number))"` -- a union type with an intersection type
 * - `"(number -> number) | number"` -- a union type with a signature and a primitive type
 */

export type TypeString = string;

export type TypeCompatibility =
  | 'covariant' // A <: B
  | 'contravariant' // A :> B
  | 'bivariant' // A <: B and A :>B, A := B
  | 'invariant'; // Neither A <: B, nor A :> B

/** A type resolver should return a definition for a given type name.
 */
export type TypeResolver = {
  /** Return a list of all type names that are defined in the resolver. This is
   * used to display error messages when a type is not found. */
  get names(): string[];
  forward: (name: string) => TypeReference | undefined;
  resolve: (name: string) => TypeReference | undefined;
};

/**
 * ### Future considerations:
 * - Add support for generics (e.g. `list<T>`), i.e. parametric polymorphism,
 * - Add support for type constraints (e.g. `list<T: number>` or list<T> where T: number),
 * - Add support for type variants (e.g. a la Rust enums)
 *     Maybe something like
 *      `variant<Square, Circle>` or
 *      `variant<Square(side: integer), Circle(radius: integer)>`
 *      `variant<Square: {side: integer}, Circle: {radius: integer}>`
 * - Add support for dependent types, with type-level computations
 * - Add support for integers, booleans, symbols and strings, i.e. "T = "red" | "green" | "blue""
 * - Add support for conditional types (e.g. `T extends U ? X : Y`)
 *
 *
 */
