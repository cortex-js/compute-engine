import { DictionaryCategory, Expression } from '../public';

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
 */
export type Dictionary = {
  [name: string]: number | Definition;
};
/**
 * The entries of a `CompiledDictionary` have been validated and
 * optimized for faster evaluation.
 *
 * When a new scope is created with `pushScope()` or when creating a new
 * engine instance, new instances of `CompiledDictionary` are created as needed.
 */
export type CompiledDictionary = Map<
  string,
  FunctionDefinition | SetDefinition | SymbolDefinition
>;

export type SignalCode =
  | 'timeout'
  | 'out-of-memory'
  | 'recursion-depth-exceeded'
  | 'iteration-limit-exceeded'
  | 'syntax-error'
  | 'invalid-name'
  | 'cyclic-definition' // arg: [cycle]
  | 'invalid-supersets' // arg: [superset-domain]
  | 'expected-supersets'
  | 'unknown-domain' // arg: [domain]
  | 'duplicate-wikidata' // arg: [wikidata]
  | 'invalid-dictionary-entry'; // arg: [error]

export type Signal = {
  severity?: 'warning' | 'error';

  code: SignalCode;

  // Optional, one or more arguments specific to the signal code.
  args?: string[];

  // If applicable, the head of the function about which the
  // signal was raised
  head?: string;

  // Location when the signal was raised.
  origin?: {
    filename?: string;
    literal?: string;
    line: number;
    column: number;
  };
};

export type ErrorSignal = Signal & {
  severity: 'error';
};

export declare class CortexError extends Error {
  constructor(errorSignal: Signal);
}

export type WarningSignal = Signal & {
  severity: 'warning';
};

export type ErrorSignalHandler = (error: ErrorSignal) => void;
export type WarningSignalHandler = (warnings: WarningSignal[]) => void;

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

  /** Signal 'timeout' when the execution time for this scope is exceeded.
   * Time in seconds, default 2s.
   */
  timeLimit?: number;
  /** Signal 'out-of-memory' when the memory usage for this scope is exceeded.
   * Memory in Megabytes, default: 1Mb.
   */
  memoryLimit?: number;
  /** Signal 'recursion-depth-exceeded' when the recursion depth for this
   * scope is exceeded. */
  recursionLimit?: number;
  /** Signal 'iteration-limit-exceeded' when the iteration limit for this
   * scope is exceeded. Default: no limits.*/
  iterationLimit?: number;
};

export type RuntimeScope = Scope & {
  parentScope: RuntimeScope;

  dictionary?: CompiledDictionary;

  /** The location of the call site that created this scope */
  origin?: {
    name?: string;
    line?: number;
    column?: number;
  };

  /** Absolute time beyond which evaluation should not proceed */
  deadline?: number;

  /** Free memory should not go below this level for execution to proceed */
  lowWaterMark?: number;

  /** Set when one or more warning have been signaled in this scope */
  warnings?: WarningSignal[];
};

/**
 * A function definition can have some flags set indicating specific
 * properties of the function.
 */
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
   *
   * Default: false
   */
  additive: boolean;

  /** If true, when the function is univariate, `[f, ["Multiply", x, y]]`
   * simplifies to `["Multiply", [f, x], [f, y]]`.
   *
   * When the function is multivariate, multipicativity is considered only on the
   * first argument: `[f, ["Multiply", x, y], z]` simplifies to
   * `["Multiply", [f, x, z], [f, y, z]]`
   *
   * Default: false
   */
  multiplicative: boolean;

  /** If true, when the function is univariate, `[f, ["Multiply", x, c]]`
   * simplifies to `["Multiply", [f, x], c]` where `c` is constant
   *
   * When the function is multivariate, multiplicativity is considered only on the
   * first argument: `[f, ["Multiply", x, y], z]` simplifies to
   * `["Multiply", [f, x, z], [f, y, z]]`
   *
   * Default: false
   */
  outtative: boolean;

  /** If true, `[f, [f, x]]` simplifies to `[f, x]`.
   *
   * Default: false
   */
  idempotent: boolean;

  /** If true, `[f, [f, x]]` simplifies to `x`.
   *
   * Default: false
   */
  involution: boolean;

  /** If true, invoking the function with a given set of arguments will
   * always return the same value, i.e. 'Sin' is pure, 'Random' isn't.
   * This is used to cache the result of the function.
   *
   * Default: true
   */
  pure: boolean;
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

export type BaseDefinition = {
  domain: Domain;
  /**
   * A short string indicating an entry in a wikibase. For example
   * `"Q167"` is the [wikidata entry](https://www.wikidata.org/wiki/Q167)
   *  for the Pi constant.
   */
  wikidata?: string;

  /**
   * The scope this definition belongs to. This field is usually undefined,
   * but its value is set by `getDefinition()`, `getFunctionDefinition()` and
   * `getSymbolDefinition()`.
   */
  scope?: Scope;
};

/**
 * Function signature: definition of the inputs and output of a function.
 *
 * A function should have at least one signature, but can have several:
 * - `Add(RealNumber, RealNumber): RealNumber`
 * - `Add(ComplexNumber, ComplexNumber): ComplexNumber`
 * - etc..
 *
 * The signature of a function that accepts any input and may output
 * anything is: `{ rest: "Anything", result: "Anything" }`.
 *
 */
export type FunctionSignature = {
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

  /** Evaluate the function with the passed in arguments and return a corresponding result. */
  evaluate?: (engine: ComputeEngine, ...args: Expression[]) => Expression;

  /** Evaluate the function with the passed in arguments and return a corresponding result. */
  asyncEvaluate?: (
    engine: ComputeEngine,
    ...args: Expression[]
  ) => Promise<Expression>;
};

export type FunctionDefinition = BaseDefinition &
  Partial<FunctionFeatures> & {
    /**
     * - **'none'**: Each of the arguments is evaluated.
     * - **'all'**: The arguments will not be evaluated and will be passed as is.
     * - **'first'**: The first argument is not evaluated, the others are
     * - **'rest'**: The first argument is evaluated, the others aren't
     */

    hold?: 'none' | 'all' | 'first' | 'rest';

    /**
     * If true, `Sequence` arguments are not automatically spliced in
     */
    sequenceHold?: boolean;

    signatures?: FunctionSignature[];
  };

export type SymbolFeatures = {
  /**
   * If true the value of the symbol is constant.
   *
   * If false, the symbol is a variable.
   */
  constant: boolean;
};

export type SymbolDefinition = BaseDefinition &
  SymbolFeatures & {
    value?: Expression;
    /** For dimensional analysis, e.g. "Scalar", "Meter", ["Divide", "Meter", "Second"] */
    unit?: Expression;
  };

export type CollectionDefinition = BaseDefinition & {
  /** If true, the elements of the collection can be iterated over using
   * the `iterator() function
   */
  iterable?: boolean;
  iterator?: {
    next: () => Expression;
    done: () => boolean;
  };
  /** If true, elements of the collection can be accessed with a numerical
   * index with the `at()` function
   */
  indexable?: boolean;
  at?: (index: number) => Expression;

  /** If true, the size of the collection is finite.
   *
   */
  countable: boolean;
  /** Return the number of elements in the collection.
   */
  size?: () => number;

  /** A predicate function that can be used to determine if an expression
   * is a member of the collection or not (answers "True", "False" or "Maybe").
   */
  isElementOf?: (expr: Expression) => boolean;
};

export type SetDefinition = CollectionDefinition & {
  /** The supersets of this set: they should be symbol with a 'Set' domain */
  supersets: string[];

  /** If a set can be defined explicitely in relation to other sets,
   * the `value` represents that relationship.
   * For example "NaturalNumber" = ["Union", "PrimeNumber", "CompositeNumber"].
   */
  value?: Expression;

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

export type Definition =
  | SymbolDefinition
  | FunctionDefinition
  | SetDefinition
  | CollectionDefinition;

export type CompiledExpression = {
  evaluate?: (scope: { [symbol: string]: Expression }) => Expression;
  asyncEvaluate?: (scope: {
    [symbol: string]: Expression;
  }) => Promise<Expression>;
};

/**
 * For best performance when calling repeatedly `format()` or `evaluate()`,
 * create an instance of `ComputeEngine` and call its methods. The constructor
 * of `ComputeEngine` will compile and optimize the dictionary so that calls of
 * the `format()` and `evaluate()` methods will bypass that step. By contrast
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

  /**
   * The current scope.
   *
   * A scope is a dictionary that contains the definition of local symbols.
   *
   * Scopes form a stack, and definitions in more recent
   * scopes can obscure definitions from older scopes.
   *
   */
  context: RuntimeScope;

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
  constructor(options?: { dictionaries?: Readonly<Dictionary>[] });

  /** Create a new scope and add it to the top of the scope stack */
  pushScope(dictionary?: Dictionary): void;

  /** Remove the topmost scope from the scope stack.
   */
  popScope(): void;

  /**
   * Call this function if an unexpected condition occurs during execution a
   * function in the engine.
   *
   * An `ErrorSignal` a problem that cannot be recovered from.
   *
   * A `WarningSignal` indicate a minor problem that should not
   * prevent the execution to continue.
   *
   */
  signal(sig: ErrorSignal | WarningSignal): void;

  /**
   * Return false if the execution should stop.
   *
   * This can occur if:
   * - an error has been signaled
   * - the time limit or memory limit has been exceeded
   */
  shouldContinueExecution(): boolean;

  getFunctionDefinition(name: string): FunctionDefinition | null;
  getSymbolDefinition(name: string): FunctionDefinition | null;
  getSetDefinition(name: string): SetDefinition | null;
  getDefinition(name: string): FunctionDefinition | null;

  /** Return the variables (free or not) in this expression */
  getVars(expr: Expression): Set<string>;

  /** Format the expression to the canonical form.
   *
   * In the canonical form, some operations are simplified (subtractions
   * becomes additions of negative, division become multiplications of inverse,
   * etc...) and terms are ordered using a deglex order. This can make
   * subsequent operations easier.
   */
  canonical(expr: Expression | null): Expression | null;

  /** Format the expression according to the specified forms.
   *
   * If no form is provided, the expression is formatted with the 'canonical'
   * form.
   *
   */
  format(expr: Expression | null, forms?: Form | Form[]): Expression | null;

  /**
   * Evaluate the expression `exp` asynchronously.
   *
   * Evaluating some expressions can take a very long time. Some can invole
   * making network queries. Therefore to avoid blocking the main event loop,
   * a promise is returned.
   *
   * Use `result = await engine.evaluate(expr)` to get the result without
   * blocking.
   */
  evaluate(exp: Expression): Promise<Expression | null>;

  /** Return the domain of the expression */
  domain(expr: Expression): Expression;

  /** Test if `lhs` is a subset of `rhs`.
   *
   * `lhs` and `rhs` can be set expressions, i.e.
   * `["SetMinus", "ComplexNumber", 0]`
   *
   */
  isSubsetOf(lhs: Domain, rhs: Domain): boolean;

  /**
   * Indicate if two expressions are structurally identical, using a literal
   * symbolic identity.
   *
   * Using a canonical format will result in more positive matches.
   *
   * Two expressions are the same if:
   * - they have the same domain
   * - if they are numbers, if their value and domain are identical.
   * - if they are symbols, if their names are identical.
   * - if they are functions, if the head of the functions are identical, and
   * if all the arguments are identical.
   *
   * ```js
   * same(["Add", "x", 1], ["Add", 1,  "x"])
   * // ➔ false
   *
   * same(canonical(["Add", "x", 1]), canonical(["Add", 1,  "x"]))`
   * // ➔ true
   * ```
   */
  same(lhs: Expression, rhs: Expression): boolean;
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
    dictionaries?: Readonly<Dictionary>[];
  }
): Expression;

/**
 * Apply the definitions in the supplied dictionary to an expression
 * and return the result.
 *
 * Unlike `format` this may entail performing calculations and irreversible
 * transformations.
 *
 * See also `[ComputeEngine.evaluate()](#(ComputeEngine%3Aclass).(evaluate%3Ainstance))`.
 *
 * @param dictionaries - An optional set of functions and constants to use
 * when evaluating the expression. Evaluating the expression may modify the
 * scope, for example if the expression is an assignment or definition.
 */
export declare function evaluate(
  expr: Expression,
  options?: {
    dictionaries?: Readonly<Dictionary>[];
  }
): Promise<Expression | null>;

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
 * - **`'canonical-add'`**: `addition of 0 is simplified, associativity rules
 *      are applied, unnecessary groups are moved, single argument 'add' are simplified
 * - **`'canonical-divide'`**: `divide` is replaced with `multiply` and `power',
 *       division by 1 is simplified,
 * - **`'canonical-exp'`**: `exp` is replaced with `power`
 * - **`'canonical-multiply'`**: multiplication by 1 or -1 is simplified
 * - **`'canonical-power'`**: `power` with a first or second argument of 1 is
 *     simplified
 * - **`'canonical-negate'`**: real or complex number is replaced by the
 * negative of that number. Negation of negation is simplified.
 * - **`'canonical-number'`**: complex numbers with no imaginary compnents are
 *    simplified
 * - **`'canonical-root'`**: `root` is replaced with `power`
 * - **`'canonical-subtract'`**: `subtract` is replaced with `add` and `negate`
 * - **`'canonical'`**: the following transformations are performed, in this order:
 *      - 'canonical-number', // ➔ simplify number
 *      - 'canonical-exp', // ➔ power
 *      - 'canonical-root', // ➔ power, divide
 *      - 'canonical-subtract', // ➔ add, negate, multiply,
 *      - 'canonical-divide', // ➔ multiply, power
 *      - 'canonical-power', // simplify power
 *      - 'canonical-multiply', // ➔ multiply, power
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
