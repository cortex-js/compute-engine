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
 *    - <value>
 *    - `symbol`: a symbol, such as `x`.
 *    - `function`: a function expression
 *      such as `["Function", ["Add", "x", 1], "x"]`.
 *
 * - `value`
 *    - `scalar`
 *      - <number>
 *      - `boolean`: a boolean value: `True` or `False`.
 *      - `string`: a string of characters.
 *    - `collection`
 *       - `list`: a collection of expressions, possibly recursive,
 *          with optional dimensions, e.g. `[number]`, `[boolean^32]`,
 *          `[number^(2x3)]`. Used to represent a vector, a matrix or a
 *          tensor when the type of its elements is a number
 *       - `set`: a collection of unique expressions, e.g. `set<string>`.
 *       - `tuple`: a fixed-size collection of named or unnamed elements, e.g.
 *          `tuple<number, boolean>`, `tuple<x: number, y: boolean>`.
 *       - `map`: a set key-value pairs, e.g. `map<x: number, y: boolean>`.
 *
 * - `number`: any numeric value:
 *    - `finite_number`: <finite_complex> or <finite_imaginary> or
 *       <finite_real> or <finite_rational> or <finite_integer>
 *    - `non_finite_number`: `NaN`, `PositiveInfinity`, `NegativeInfinity` or
 *      `ComplexInfinity`
 *    - `complex` and `finite_complex`: a complex number, with non-zero real
 *       and imaginary parts.
 *    - `imaginary` and `finite_imaginary`: a complex number with a real part
 *       of 0 (pure imaginary).
 *    - `real` and `finite_real`: a complex number with an imaginary part of 0.
 *    - `rational` and `finite_rational`: a pure rational number
 *       (not an integer)
 *    - `integer` and `finite_integer`: a whole number
 *
 *
 */
export type PrimitiveType =
  | NumericType
  | 'collection'
  | 'list'
  | 'set'
  | 'map'
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

export type NumericType =
  | 'number'
  | 'finite_number'
  | 'complex'
  | 'finite_complex'
  | 'imaginary'
  | 'finite_imaginary'
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
  restArg?: NamedElement;
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

/** Map is not a collection. It is a set of key/value pairs.
 * An element of a map whose type is a subtype of `nothing` is optional.
 * For example, in `{x: number, y: boolean | nothing}` the element `y` is optional.
 */
export type MapType = {
  kind: 'map';
  elements: Record<string, Type>;
};

/** Collection, List, Set, Tuple and Map are collections.
 *
 * `CollectionType` is a generic collection of elements of a certain type.
 */
export type CollectionType = {
  kind: 'collection';
  elements: Type;
};

/**
 * The elements of a list are ordered.
 *
 * All elements of a list have the same type (but it can be a broad type,
 * up to `any`).
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

/** Each element of a set is unique (is not present in the set more than once).
 * The elements of a set are not ordered.
 */
export type SetType = {
  kind: 'set';
  elements: Type;
};

/* The elements of a tuple are ordered and may be named or unnamed */
export type TupleType = {
  kind: 'tuple';
  elements: NamedElement[];
};

/** Nominal typing */
export type TypeReference = {
  kind: 'reference';
  ref: string;
};

export type Type =
  | PrimitiveType
  | AlgebraicType
  | NegationType
  | CollectionType
  | ListType
  | SetType
  | MapType
  | TupleType
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

```bnf
<type> ::= <union_type>

<union_type> ::= <intersection_type> (" | " <intersection_type>)*

<intersection_type> ::= <primary_type> (" & " <primary_type>)*

<primary_type> ::=  <primitive>
                | <tuple_type>
                | <function_type>
                | <list_type>
                | <wrapped_primary_type>

<wrapped_primary_type> ::= "(" <primary_type> ")"


<primitive> ::= "any" | "unknown" | <value-type> | <symbolic-type> | <numeric-type>

<numeric-type> ::= "number" | "complex" | "imaginary" | "real" | "rational" | "integer"

<value-type> ::= "value" | <numeric-type> | "collection" | "boolean" | "string"

<symbolic-type> ::= "expression" | "function" | "symbol"

<tuple_type> ::= "(" (<name> <type> "," <named_tuple_elements>*) ")"
            | "(" (<type> "," <unnamed_tuple_elements>*) ")" |
            | "tuple(" <tuple_elements> ")"

<tuple_elements> ::= <unnamed_tuple_elements> | <named_tuple_elements>

<unnamed_tuple_elements> ::= <type> ("," <type>)*

<named_tuple_elements> ::= <name> <type> ("," <name> <type>)*

<function_type> ::=  <arguments> " -> " <type>

<arguments> ::= "()"
            | <argument>
            | "(" <argument-list> ")"
            | <deferred_evaluation>

<deferred_evaluation> ::= "???" <argument>
                       | "???" "(" <argument-list> ")"

<argument> ::= <type>
            | <name> <type>

<rest_argument> ::= "..." <type>
            | <name> "..." <type>

<optional_argument> ::= <argument> "?"

<optional_arguments> ::= <optional_argument> ("," <optional_argument>)*

<required_arguments> ::= <argument> ("," <argument>)*

<argument-list> ::= <required_arguments> ("," <rest_argument>)?
            | <required_arguments> <optional_arguments>?
            | <optional_arguments>?
            | <rest_argument>


<list_type> ::= "[" <type> <dimensions>? "]"

<dimensions> ::= "^" <fixed_size>
            | "^(" <multi_dimensional_size> ")"

<fixed_size> ::= <positive-integer_literal>

<multi_dimensional_size> ::= <positive-integer_literal> "x" <positive-integer_literal> ("x" <positive-integer_literal>)*

<map> ::= "{}"
            |"{" <map_elements> "}"
            | "map(" <map_elements> ")"

<map_elements> ::= <name> <type> ("," <name> <type>)*

<set> ::= "set<" <type> ">"

<collection ::= "collection<" <type> ">"

<name> ::= <identifier> ":"

<identifier> ::= [a-zA-Z_][a-zA-Z0-9_]*

<positive-integer_literal> ::= [1-9][0-9]*
```


Examples of types:
   "number"    -- a simple type primitive


   "(number, boolean)" -- a tuple type
   "(x: number, y:boolean)" -- a named tuple/record type. Either all arguments are named, or none are

   "[any]" -- an arbitrary collection type, with no length or element type restrictions
   "[integer]" -- a collection type where all the elements are integers
   "[(number, boolean)]" -- a collection of tuples
   "[(value:number, seen:boolean)]" -- a collection of named tuples
   "[boolean]^32" -- a collection type with a fixed size of 32 elements
   "[integer]^(2x3)" -- an integer matrix of 2 columns and 3 rows
   "[integer]^(2x3x4)" -- a tensor of dimensions 2x3x4

   "number -> number" -- a function type with a single argument
   "(x: number, number) -> number" -- a function type with a named argument
   "(number, y:number?) -> number" -- a function type with an optional named argument (can have several optional arguments, at the end)
   "(number, ...number) -> number" -- a function type with a rest argument (can have only one, and no optional arguments if there is a rest argument).
   "() -> number" -- a function type with an empty argument list

   "number | boolean" -- a union type
   "(x: number) & (y: number)" -- an intersection type
   "number | ((x: number) & (y: number))" -- a union type with an intersection type
   "(number -> number) | number" -- a union type with a function type
*/

export type TypeString = string;

export type TypeCompatibility =
  | 'covariant' // A <: B
  | 'contravariant' // A :> B
  | 'bivariant' // A <: B and A :>B, A := B
  | 'invariant'; // Neither A <: B, nor A :> B

export type TypeResolver = (name: string) => Type | undefined;

/* Future considerations:
 * - Add support for generics (e.g. `List<T>`), i.e. parametric polymorphism,
 * - Add support for type constraints (e.g. `T extends number`),
 * - Add support for type aliases
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
