export type FunctionFeatures = {
  /**  If true, the function is applied element by element to lists, matrices
   * and equations.
   *
   * Default: false
   */
  threadable: boolean;

  /** If true, [f, [f, a], b] simplifies to [f, a, b]
   *
   * Default: false
   */
  associative: boolean;

  /** If true, [f, a, b] simplifies to [f, b, a]
   *
   * Default: false
   */
  commutative: boolean;

  /** If true, when the function is univariate, `[f, ["Add", x, c]]` where `c`
   * is constant, is simplified to `["Add", [f, x], c]`.
   *
   * When the function is multivariate, additivity is considered only on the
   * first argument: `[f, ["Add", x, c], y]` simplifies to `["Add", [f, x, y], c]`.
   */
  additive: boolean;

  /** If true, when the function is univariate, `[f, ["Multiply", x, y]]`
   * simplifies to `["Multiply", [f, x], [f, y]]`.
   *
   * When the function is multivariate, multipicativity is considered only on the
   * first argument: `[f, ["Multiply", x, y], z]` simplifies to
   * `["Multiply", [f, x, z], [f, y, z]]`
   */
  multiplicative: boolean;

  /** If true, when the function is univariate, `[f, ["Multiply", x, c]]`
   * simplifies to `["Multiply", [f, x], c]` where `c` is constant
   *
   * When the function is multivariate, multiplicativity is considered only on the
   * first argument: `[f, ["Multiply", x, y], z]` simplifies to
   * `["Multiply", [f, x, z], [f, y, z]]`
   */
  outtative: boolean;

  /** If true, `[f, [f, x]]` simplifies to `[f, x]`
   *
   * Default: false
   */
  idempotent: boolean;

  /** If true, `[f, [f, x]]` simplifies to `x` */
  involution: boolean;

  /** If true, invoking the function with a given set of arguments will
   * always return the same value, i.e. 'Sin' is pure, 'Random' isn't.
   * This is used to cache the result of the function.
   *
   * Default: true
   */
  pure: boolean;
};

export type Definition = {
  domain: Domain;
  /**
   * A short string indicating an entry in a wikibase. For example
   * `"Q167"` is the [wikidata entry](https://www.wikidata.org/wiki/Q167)
   *  for the Pi constant.
   */
  wikidata?: string;

  /**
   * The scope this definition belongs to. This field is usually undefined,
   * but its value is set by `getDefinition`, `getFunctionDefinition` and
   * `getSymbolDefinition`.
   */
  scope?: Scope;
};

export type FunctionDefinition = Definition &
  Partial<FunctionFeatures> & {
    /**
     * - **'none'**:  eval() is invoked for each argument.
     * - **'all'**: The arguments will not be evaluated and will be passed as is
     *  The function will be passed the result of the evaluation
     * - **'first'**: The first argument is not evaluated, the others are
     * - **'rest'**: The first argument is evaluated, the others aren't
     */

    hold?: 'none' | 'all' | 'first' | 'rest';

    /**
     * If true, `Sequence` arguments are not automatically spliced in
     */
    sequenceHold?: boolean;

    /**
     * Function signatures.
     */
    signatures?: {
      /** Input arguments */
      args?: (Domain | [name: string, domain: Domain])[];

      /** If this signature accepts unlimited additional arguments after the
       * named arguments, they should be of this domain */
      rest?: Domain | [name: string, domain: Domain];

      /** Domain result computation */
      result:
        | Domain
        | ((engine: ComputeEngine, ...args: Expression[]) => Expression);

      /** Dimensional analysis */
      dimension?: (engine: ComputeEngine, ...args: Expression[]) => Expression;
      /** Return a compiled (optimized) function for evaluation */
      compile?: (
        engine: ComputeEngine,
        ...args: CompiledExpression[]
      ) => CompiledExpression;
      /** */
      evaluate?: (engine: ComputeEngine, ...args: Expression[]) => Expression;
    }[];
  };

export type SymbolFeatures = {
  /**
   * If true the value of the symbol is constant.
   *
   * If false, the symbol is a variable.
   */
  constant: boolean;
};

export type SymbolDefinition = Definition &
  SymbolFeatures & {
    value?: Expression;
    /** For dimensional analysis, e.g. "Scalar", "Meter", ["Divide", "Meter", "Second"] */
    unit?: Expression;
  };

export type SetDefinition = Definition & {
  /** The supersets of this set: they should be symbol with a 'Set' domain */
  supersets: string[];

  /** If a set can be defined explicitely in relation to other sets,
   * the `value` represents that relationship.
   * For example "NaturalNumber" = ["Union", "PrimeNumber", "CompositeNumber"].
   */
  value?: Expression;

  /** A predicate function that can be used to determine if an expression
   * is a member of the set or not (answers "True", "False" or "Maybe").
   */
  isMemberOf?: Expression;

  /**
   * A function that determins if a set is a subset of another.
   * The `rhs` argument is either the name of the symbol, or a function
   * with the head of the symbol.
   */
  isSubsetOf?: (
    engine: ComputeEngine,
    lhs: Expression,
    rhs: Expression
  ) => boolean;
};

export type ErrorListener<T> = (err: {
  code: T;
  arg?: string;
  latex?: string;
  before?: string;
  after?: string;
}) => void;

/**
 * A dictionary maps a MathJSON name to a definition.
 *
 * A named entry in a dictionary can refer to a symbol, as in the expression,
 * `"Pi"`, to a function: "Add" in the expression `["Add", 2, 3]`, or
 * to a `"Set`".
 *
 * The name can be an arbitrary string of Unicode characters, however
 * the following conventions are recommended:
 *
 * - Use only letters, digits and `-`, and the first character should be
 * a letter: `/^[a-zA-Z][a-zA-Z0-9-]+/`
 * - Built-in functions and symbols should start with an uppercase letter
 *
 * As a shorthand for a numeric symbol definition, a number can be used as
 * well. In that case the domain is determined automatically.
 *
 * ```json
 * { "x": 1.0 }
 * { "x" : { "domain": "RealNumber", "value": 1.0 } }
 * ```
 *
 *
 */
export type Dictionary = {
  [name: string]:
    | number
    | SymbolDefinition
    | FunctionDefinition
    | SetDefinition;
};

export type CompiledDictionary = Map<
  string,
  FunctionDefinition | SetDefinition | SymbolDefinition
>;

/**
 * A dictionary that contains symbol definitions.
 */
export type Scope = {
  parentScope: Scope;
  dictionary: CompiledDictionary;
};

/**
 * * `unknown-symbol`: a symbol was encountered which does not have a
 * definition.
 *
 * * `unknown-operator`: a presumed operator was encountered which does not
 * have a definition.
 *
 * * `unknown-function`: a Latex command was encountered which does not
 * have a definition.
 *
 * * `unexpected-command`: a Latex command was encountered when only a string
 * was expected
 *
 * * `unexpected-superscript`: a superscript was encountered in an unexpected
 * context, or no `powerFunction` was defined. By default, superscript can
 * be applied to numbers, symbols or expressions, but not to operators (e.g.
 * `2+^34`) or to punctuation.
 *
 * * `unexpected-subscript`: a subscript was encountered in an unexpected
 * context or no 'subscriptFunction` was defined. By default, subscripts
 * are not expected on numbers, operators or symbols. Some commands (e.g. `\sum`)
 * do expected a subscript.
 *
 * * `unexpected-sequence`: some adjacent elements were encountered (for
 * example `xy`), but no `invisibleOperator` is defined, therefore the elements
 * can't be combined. The default `invisibleOperator` is `multiply`, but you
 * can also use `list`.
 *
 * * `expected-argument`: a Latex command that requires one or more argument
 * was encountered without the required arguments.
 *
 * * `expected-operand`: an operator was encountered without its required
 * operands.
 *
 * * `non-associative-operator`: an operator which is not associative was
 * encountered in an associative context, for example: `a < b < c` (assuming
 * `<` is defined as non-associative)
 *
 * * `postfix-operator-requires-one-operand`: a postfix operator which requires
 * a single argument was encountered with no arguments or more than one argument
 *
 * * `prefix-operator-requires-one-operand`: a prefix operator which requires
 * a single argument was encountered with no arguments or more than one argument
 *
 * * `base-out-of-range`:  The base is expected to be between 2 and 36.
 *
 */
export type ErrorCode =
  | 'expected-argument'
  | 'unexpected-argument'
  | 'expected-operator'
  | 'expected-operand'
  | 'invalid-name'
  | 'invalid-dictionary-entry'
  | 'dictionary-entry-warning'
  | 'unknown-symbol'
  | 'unknown-operator'
  | 'unknown-function'
  | 'unknown-command'
  | 'unexpected-command'
  | 'unbalanced-symbols'
  | 'unexpected-superscript'
  | 'unexpected-subscript'
  | 'unexpected-sequence'
  | 'non-associative-operator'
  | 'function-has-too-many-arguments'
  | 'function-has-too-few-arguments'
  | 'operator-requires-one-operand'
  | 'infix-operator-requires-two-operands'
  | 'prefix-operator-requires-one-operand'
  | 'postfix-operator-requires-one-operand'
  | 'associative-function-has-too-few-arguments'
  | 'commutative-function-has-too-few-arguments'
  | 'threadable-function-has-too-few-arguments'
  | 'hold-first-function-has-too-few-arguments'
  | 'hold-rest-function-has-too-few-arguments'
  | 'base-out-of-range'
  | 'syntax-error';

export type Attributes = {
  /** A human readable string to annotate an expression, since JSON does not
   * allow comments in its encoding */
  comment?: string;

  /** A human readable string that can be used to indicate a syntax error or
   *other problem when parsing or evaluating an expression.
   */
  error?: string;

  /** A visual representation in LaTeX of the expression. This can be useful
    to preserve non-semantic details, for example parentheses in an expression
    or styling attributes */
  latex?: string;

  /**
   * A short string indicating an entry in a wikibase. For example
   * `"Q167"` is the [wikidata entry](https://www.wikidata.org/wiki/Q167)
   *  for the Pi constant.
   */
  wikidata?: string;

  /** A base URL for the `wikidata` key. A full URL can be produced by
    concatenating this key with the `wikidata` key. This key applies to this
    node and all its children. The default value is
    "https://www.wikidata.org/wiki/"
     */
  wikibase?: string;

  /** A short string indicating an entry in an OpenMath Content
    Dictionary. For example: `arith1/#abs`. */
  openmathSymbol?: string;

  /** A base URL for an OpenMath content dictionary. This key applies to this
    node and all its children. The default value is
    "http://www.openmath.org/cd".
     */
  openmathCd?: string;
};

export type MathJsonBasicNumber = 'NaN' | '-Infinity' | '+Infinity' | string;

export type MathJsonRealNumber = {
  num: MathJsonBasicNumber;
} & Attributes;

export type MathJsonSymbol = {
  sym: string;
} & Attributes;

export type MathJsonFunction = {
  fn: Expression[];
} & Attributes;

export type Expression =
  | MathJsonRealNumber
  // Shortcut for MathJsonRealNumber without metadata and in the JavaScript
  // 64-bit float range.
  | number
  | MathJsonSymbol
  // Shortcut for a MathJsonSymbol with no metadata. Or a string.
  | string
  | MathJsonFunction
  | Expression[];

export type CompiledExpression = {
  evaluate: (scope: { [symbol: string]: Expression }) => Expression;
};

/** A domain such as 'Number' or 'Boolean' represents a set of values.
 *
 * Domains can be defined as a union or intersection of domains:
 * - `["Union", "Number", "Boolean"]` A number or a boolean.
 * - `["SetMinus", "Number", 1]`  Any number except "1".
 *
 * Domains are defined in a hierarchy (a lattice).
 */
export type Domain = Expression;

/**
 * A given mathematical expression can be represented in multiple equivalent
 * ways as a MathJSON expression.
 *
 * `Form` is used to specify a representation:
 * - **`'full'`**: only transformations applied are those necessary to make it
 *      valid JSON (for example making sure that `Infinity` and `NaN` are
 *      represented as strings)
 * - **`'flatten'`**: associative functions are combined, e.g.
 *      f(f(a, b), c) -> f(a, b, c)
 * - **`'sorted'`**: the arguments of commutative functions are sorted such that:
 *       - numbers are first, sorted numerically
 *       - complex numbers are next, sorted numerically by imaginary value
 *       - symbols are next, sorted lexicographically
 *       - `add` functions are next
 *       - `multiply` functions are next
 *       - `power` functions are next, sorted by their first argument,
 *           then by their second argument
 *       - other functions follow, sorted lexicographically
 * - **`'stripped-metadata'`**: any metadata associated with elements of the
 *      expression is removed.
 * - **`'object-literal'`**:  each term of an expression is expressed as an
 *      object literal: no shorthand representation is used.
 * - *`'canonical-add'`**: `addition of 0 is simplified, associativity rules
 *      are applied, unnecessary groups are moved, single argument 'add' are simplified
 * - *`'canonical-divide'`**: `divide` is replaced with `multiply` and `power',
 *       division by 1 is simplified,
 * - *`'canonical-exp'`**: `exp` is replaced with `power`
 * - *`'canonical-multiply'`**: multiplication by 1 or -1 is simplified
 * - *`'canonical-power'`**: `power` with a first or second argument of 1 is
 *     simplified
 * - *`'canonical-negate'`**: real or complex number is replaced by the
 * negative of that number. Negation of negation is simplified.
 * - *`'canonical-number'`**: complex numbers with no imaginary compnents are
 *    simplified
 * - *`'canonical-root'`**: `root` is replaced with `power`
 * - *`'canonical-subtract'`**: `subtract` is replaced with `add` and `negate`
 * - **`'canonical'`**: the following transformations are performed, in this order:
 *      - 'canonical-number', // -> simplify number
 *      - 'canonical-exp', // -> power
 *      - 'canonical-root', // -> power, divide
 *      - 'canonical-subtract', // -> add, negate, multiply,
 *      - 'canonical-divide', // -> multiply, power
 *      - 'canonical-power', // simplify power
 *      - 'canonical-multiply', // -> multiply, power
 *      - 'canonical-negate', // simplify negate
 *      - 'canonical-add', // simplify add
 *      - 'flatten', // simplify associative, idempotent and groups
 *      - 'sorted',
 *      - 'full',
 */
export type Form =
  | 'canonical'
  | 'canonical-add'
  | 'canonical-divide'
  | 'canonical-domain'
  | 'canonical-exp'
  | 'canonical-list'
  | 'canonical-multiply'
  | 'canonical-power'
  | 'canonical-negate'
  | 'canonical-number'
  | 'canonical-root'
  | 'canonical-subtract'
  | 'flatten' // simplify associative, idempotent and groups
  | 'full'
  | 'object-literal'
  | 'sorted'
  | 'stripped-metadata'
  | 'sum-product';

export type DictionaryCategory =
  | 'algebra'
  | 'arithmetic'
  | 'calculus'
  | 'complex'
  | 'combinatorics'
  | 'core'
  | 'dimensions'
  | 'domains'
  | 'inequalities'
  | 'intervals'
  | 'linear-algebra'
  | 'lists'
  | 'logic'
  | 'numeric'
  | 'other'
  | 'physics'
  | 'polynomials'
  | 'relations'
  | 'rounding'
  | 'sets'
  | 'statistics'
  | 'symbols'
  | 'transcendentals'
  | 'trigonometry'
  | 'units';

/**
 * For best performance when calling repeatedly `format()` or `evalute()`,
 * create an instance of `ComputeEngine` and call its methods. The constructor
 * of `ComputeEngine` will compile and optimize the dictionary so that calls of
 * the `format()` and `evalute()` methods will bypass that step. By contrast
 * invoking the `format()` and `evaluate()` functions will compile the
 * dictionary each time they are called.
 */
export declare class ComputeEngine {
  /**
   * Return dictionaries suitable for the specified categories, or `"all"`
   * for all categories (`"arithmetic"`, `"algebra"`, etc...).
   *
   * A symbol dictionary defines how the symbols and function names in a MathJSON
   * expression should be interpreted, i.e. how to evaluate and manipulate them.
   *
   */
  static getDictionaries(
    categories: DictionaryCategory[] | 'all'
  ): Readonly<Dictionary>[];

  scope: Scope;
  onError: ErrorListener<ErrorCode>;

  /**
   * Construct a new ComputeEngine environment.
   *
   * If no `options.dictionaries` is provided a default set of dictionaries
   * will be used. The `ComputeEngine.getDictionaries()` method can be called
   * to access some subset of dictionaries, e.g. for arithmetic, calculus, etc...
   * The order of the dictionaries matter: the definitions from the later ones
   * override the definitions from earlier ones. The first dictionary should
   * be the `'core'` dictionary which include some basic definitions such
   * as domains ('Boolean', 'Number', etc...) that are used by later dictionaries.
   */
  constructor(options?: {
    dictionaries?: Readonly<Dictionary>[];
    onError?: ErrorListener<ErrorCode>;
  });

  /** Remove the topmost scope from the scope stack.
   *
   * A scope is a dictionary that contains the definition of local symbols.
   *
   */
  popScope(): void;

  /** Create a new scope and add it to the top of the scope stack */
  pushScope(dictionary?: Dictionary): void;

  getFunctionDefinition(name: string): FunctionDefinition | null;
  getSymbolDefinition(name: string): FunctionDefinition | null;
  getSetDefinition(name: string): SetDefinition | null;
  getDefinition(name: string): FunctionDefinition | null;

  /** Return the variables (free or not) in this expression */
  getVars(expr: Expression): Set<string>;

  /** Format the expression according to the specified forms.
   *
   * If no form is provided, the expression is formatted with the 'canonical'
   * form.
   *
   */
  canonical(expr: Expression | null): Expression | null;
  format(expr: Expression | null, forms?: Form | Form[]): Expression | null;

  evaluate(exp: Expression): Expression | null;

  /** Return the domain of the expression */
  domain(expr: Expression): Expression;

  /** Test if `lhs` is a subset of `rhs`.
   *
   * `lhs` and `rhs` can be set expressions, i.e.
   * `["SetMinus", "ComplexNumber", 0]`
   *
   */
  isSubsetOf(lhs: Domain, rhs: Domain): boolean;

  /** Compare expression `lhs` with expression `rhs`.
   *
   * Return:
   * - `undefined` if the expressions can't be compared
   * - `-1` if `lhs` is less than `rhs`
   * - `0` is `lhs` is equal to `rhs`
   * - `1` if `lhs` is greater than `rhs`
   *
   * This is a structural comparison, i.e. `x+1` and `1+x` are different.
   *
   * Applying a canonical format (with `form()`) or evaluating the expressions
   * (with `evaluate()`) before comparing will result in more matches.
   *
   *
   */
  compare(lhs: Expression, rhs: Expression): -1 | 0 | 1 | undefined;
  equal(lhs: Expression, rhs: Expression): boolean | undefined;
  less(lhs: Expression, rhs: Expression): boolean | undefined;
  lessEqual(lhs: Expression, rhs: Expression): boolean | undefined;
  greater(lhs: Expression, rhs: Expression): boolean | undefined;
  greaterEqual(lhs: Expression, rhs: Expression): boolean | undefined;
}

/**
 * Transform an expression by applying one or more rewriting rules to it,
 * recursively.
 *
 * There are many ways to symbolically manipulate an expression, but
 * transformations with `form` have the following characteristics:
 *
 * - they don't require calculations or assumptions about the domain of free
 *    variables or the value of constants
 * - the output expression is expressed with more primitive functions,
 *    for example subtraction is replaced with addition
 *
 *
 */
export declare function format(
  expr: Expression,
  forms: Form[],
  options?: {
    dictionary?: Dictionary;
    onError?: ErrorListener<ErrorCode>;
  }
): Expression;

/**
 * Apply the definitions in the supplied dictionary to an expression
 * and return the result.
 *
 * Unlike `format` this may entail performing calculations and irreversible
 * transformations.
 *
 * @param scope - An optional set of functions and constants to use
 * when evaluating the expression. Evaluating the expression may modify the
 * scope, for example if the expression is an assignment or definition.
 */
export declare function evaluate(
  expr: Expression,
  options?: {
    scope?: Dictionary;
    dictionary?: Dictionary;
    onError?: ErrorListener<ErrorCode>;
  }
): Expression;
