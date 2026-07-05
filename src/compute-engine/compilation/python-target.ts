import type { Expression } from '../global-types';

import type {
  CompileTarget,
  CompiledOperators,
  CompiledFunctions,
  LanguageTarget,
  CompilationOptions,
  CompilationResult,
} from './types';
import { BaseCompiler } from './base-compiler';
import { tryGetConstant } from './constant-folding';
import { isSymbol } from '../boxed-expression/type-guards';

/**
 * Python mathematical constants, keyed by MathJSON symbol.
 *
 * Referenced both by the target's `var` resolver and — so an assigned value is
 * folded, matching the JavaScript target and `evaluate()` — by `compile()`.
 */
const PYTHON_CONSTANTS: Record<string, string> = {
  Pi: 'np.pi',
  ExponentialE: 'np.e',
  ImaginaryUnit: '1j',
  Infinity: 'np.inf',
  NaN: 'np.nan',
  GoldenRatio: '((1 + np.sqrt(5)) / 2)',
  CatalanConstant: '0.915965594177219015054603514932384110774',
  EulerGamma: '0.5772156649015328606065120900824024310421',
};

/**
 * Emit a Python equality test with the engine's numeric tolerance baked in at
 * compile time. The interpreter compares numbers within `engine.tolerance`
 * (default 1e-10) — so `0.1 + 0.2 == 0.3` is *true* — while a raw `==` on
 * floats is exact and would disagree. `kind` selects Equal (`<=`) vs NotEqual
 * (`>`). Chained (N-ary) forms are conjoined pairwise with `and`.
 */
function compilePythonEquality(
  kind: 'Equal' | 'NotEqual',
  args: ReadonlyArray<Expression>,
  compile: (e: Expression) => string
): string {
  if (args.length < 2)
    throw new Error(`${kind}: expected at least two arguments`);
  const tol = args[0]?.engine?.tolerance ?? 1e-10;
  const cmp = kind === 'Equal' ? '<=' : '>';
  const pair = (a: Expression, b: Expression): string =>
    `(abs((${compile(a)}) - (${compile(b)})) ${cmp} ${tol})`;
  if (args.length === 2) return pair(args[0], args[1]);
  const parts: string[] = [];
  for (let i = 0; i < args.length - 1; i++)
    parts.push(pair(args[i], args[i + 1]));
  return `(${parts.join(' and ')})`;
}

/**
 * Python operator mappings
 *
 * Python uses similar operators to JavaScript, but with ** for exponentiation.
 * NumPy arrays support element-wise operations with these operators.
 */
const PYTHON_OPERATORS: CompiledOperators = {
  Add: ['+', 11],
  Negate: ['-', 14], // Unary operator
  Subtract: ['-', 11], // Subtract canonicalizes to Add+Negate; kept as fallback
  Multiply: ['*', 12],
  Divide: ['/', 13],
  // Python exponentiation. A literal `0^0` is folded to NaN at canonicalization
  // (matching the interpreter) before it reaches here, and `x^0` folds to 1
  // (as the interpreter simplifies). The residual divergence is a *runtime*
  // dynamic `0**0` (both operands 0 only at run time): Python yields 1, the
  // interpreter NaN. Aligning that would require routing every power through a
  // helper — disproportionate churn (breaks `**` right-associativity) for a
  // rare edge — so it is left as a documented divergence. The JS target aligns
  // it via `_SYS.pow`. See finding CO-P2-24.
  Power: ['**', 15],
  // Equal / NotEqual are NOT operators: a raw `==` on floats is exact, but the
  // interpreter compares within `engine.tolerance`. They are handled as
  // function forms (see `compilePythonEquality`) so the tolerance is honored.
  LessEqual: ['<=', 9],
  GreaterEqual: ['>=', 9],
  Less: ['<', 9],
  Greater: ['>', 9],
  And: ['and', 4],
  Or: ['or', 3],
  Not: ['not', 14], // Unary operator
};

/**
 * Python/NumPy function implementations
 *
 * Maps mathematical functions to their NumPy equivalents.
 * Most functions are available in the numpy module with np. prefix.
 */
const PYTHON_FUNCTIONS: CompiledFunctions<Expression> = {
  // Basic arithmetic (for when they're called as functions)
  Add: (args, compile) => {
    if (args.length === 0) return '0';
    if (args.length === 1) return compile(args[0]);
    return args.map((x) => compile(x)).join(' + ');
  },
  Multiply: (args, compile) => {
    if (args.length === 0) return '1';
    if (args.length === 1) return compile(args[0]);
    return args.map((x) => compile(x)).join(' * ');
  },
  // No Subtract handler — canonicalizes to Add+Negate before compilation.
  Divide: (args, compile) => {
    if (args.length === 0) return '1';
    if (args.length === 1) return compile(args[0]);
    if (args.length === 2) return `${compile(args[0])} / ${compile(args[1])}`;
    // For more than 2 args, fold left
    let result = compile(args[0]);
    for (let i = 1; i < args.length; i++) {
      result = `${result} / ${compile(args[i])}`;
    }
    return result;
  },

  // Trigonometric functions (with complex dispatch via cmath)
  Sin: (args, compile) => {
    if (BaseCompiler.isComplexValued(args[0]))
      return `cmath.sin(${compile(args[0])})`;
    return `np.sin(${compile(args[0])})`;
  },
  Cos: (args, compile) => {
    if (BaseCompiler.isComplexValued(args[0]))
      return `cmath.cos(${compile(args[0])})`;
    return `np.cos(${compile(args[0])})`;
  },
  Tan: (args, compile) => {
    if (BaseCompiler.isComplexValued(args[0]))
      return `cmath.tan(${compile(args[0])})`;
    return `np.tan(${compile(args[0])})`;
  },
  Arcsin: (args, compile) => {
    if (BaseCompiler.isComplexValued(args[0]))
      return `cmath.asin(${compile(args[0])})`;
    return `np.arcsin(${compile(args[0])})`;
  },
  Arccos: (args, compile) => {
    if (BaseCompiler.isComplexValued(args[0]))
      return `cmath.acos(${compile(args[0])})`;
    return `np.arccos(${compile(args[0])})`;
  },
  Arctan: (args, compile) => {
    if (BaseCompiler.isComplexValued(args[0]))
      return `cmath.atan(${compile(args[0])})`;
    return `np.arctan(${compile(args[0])})`;
  },
  Arctan2: 'np.arctan2',
  Sinh: (args, compile) => {
    if (BaseCompiler.isComplexValued(args[0]))
      return `cmath.sinh(${compile(args[0])})`;
    return `np.sinh(${compile(args[0])})`;
  },
  Cosh: (args, compile) => {
    if (BaseCompiler.isComplexValued(args[0]))
      return `cmath.cosh(${compile(args[0])})`;
    return `np.cosh(${compile(args[0])})`;
  },
  Tanh: (args, compile) => {
    if (BaseCompiler.isComplexValued(args[0]))
      return `cmath.tanh(${compile(args[0])})`;
    return `np.tanh(${compile(args[0])})`;
  },
  Arsinh: 'np.arcsinh',
  Arcosh: 'np.arccosh',
  Artanh: 'np.arctanh',

  // Reciprocal trigonometric functions
  Cot: ([x], compile) => {
    if (x === null) throw new Error('Cot: no argument');
    return `(np.cos(${compile(x)}) / np.sin(${compile(x)}))`;
  },
  Csc: ([x], compile) => {
    if (x === null) throw new Error('Csc: no argument');
    return `(1 / np.sin(${compile(x)}))`;
  },
  Sec: ([x], compile) => {
    if (x === null) throw new Error('Sec: no argument');
    return `(1 / np.cos(${compile(x)}))`;
  },

  // Inverse trigonometric (reciprocal)
  Arccot: ([x], compile) => {
    if (x === null) throw new Error('Arccot: no argument');
    // `np.arctan(1/x)` returns the wrong branch for x < 0. `π/2 - arctan(x)` is
    // branch-free and matches the interpreter's (0, π) range for all real x.
    return `(np.pi / 2 - np.arctan(${compile(x)}))`;
  },
  Arccsc: ([x], compile) => {
    if (x === null) throw new Error('Arccsc: no argument');
    return `np.arcsin(1 / (${compile(x)}))`;
  },
  Arcsec: ([x], compile) => {
    if (x === null) throw new Error('Arcsec: no argument');
    return `np.arccos(1 / (${compile(x)}))`;
  },

  // Reciprocal hyperbolic functions
  Coth: ([x], compile) => {
    if (x === null) throw new Error('Coth: no argument');
    return `(np.cosh(${compile(x)}) / np.sinh(${compile(x)}))`;
  },
  Csch: ([x], compile) => {
    if (x === null) throw new Error('Csch: no argument');
    return `(1 / np.sinh(${compile(x)}))`;
  },
  Sech: ([x], compile) => {
    if (x === null) throw new Error('Sech: no argument');
    return `(1 / np.cosh(${compile(x)}))`;
  },

  // Inverse hyperbolic (reciprocal)
  Arcoth: ([x], compile) => {
    if (x === null) throw new Error('Arcoth: no argument');
    return `np.arctanh(1 / (${compile(x)}))`;
  },
  Arcsch: ([x], compile) => {
    if (x === null) throw new Error('Arcsch: no argument');
    return `np.arcsinh(1 / (${compile(x)}))`;
  },
  Arsech: ([x], compile) => {
    if (x === null) throw new Error('Arsech: no argument');
    return `np.arccosh(1 / (${compile(x)}))`;
  },

  // Elementary
  Lb: 'np.log2',
  Square: ([x], compile) => {
    if (x === null) throw new Error('Square: no argument');
    return `np.square(${compile(x)})`;
  },
  Fract: ([x], compile) => {
    if (x === null) throw new Error('Fract: no argument');
    return `np.modf(${compile(x)})[0]`;
  },

  // Exponential and logarithmic
  Exp: (args, compile) => {
    if (BaseCompiler.isComplexValued(args[0]))
      return `cmath.exp(${compile(args[0])})`;
    return `np.exp(${compile(args[0])})`;
  },
  Ln: (args, compile) => {
    if (BaseCompiler.isComplexValued(args[0]))
      return `cmath.log(${compile(args[0])})`;
    return `np.log(${compile(args[0])})`;
  },
  Log: (args, compile) => {
    // Log with base: log(x, base)
    if (args.length === 1) return `np.log10(${compile(args[0])})`;
    if (args.length === 2)
      return `(np.log(${compile(args[0])}) / np.log(${compile(args[1])}))`;
    return 'np.log10';
  },
  Log10: 'np.log10',
  Log2: 'np.log2',
  Exp2: 'np.exp2',

  // Power and roots
  Power: (args, compile) => {
    if (args.length !== 2) return 'np.power';
    if (
      BaseCompiler.isComplexValued(args[0]) ||
      BaseCompiler.isComplexValued(args[1])
    )
      return `(${compile(args[0])} ** ${compile(args[1])})`;
    return `np.power(${compile(args[0])}, ${compile(args[1])})`;
  },
  Sqrt: (args, compile) => {
    if (BaseCompiler.isComplexValued(args[0]))
      return `cmath.sqrt(${compile(args[0])})`;
    return `np.sqrt(${compile(args[0])})`;
  },
  Root: (args, compile) => {
    // Root(x, n) = x^(1/n)
    if (args.length !== 2) return 'np.power';
    const [x, n] = args;
    const nConst = tryGetConstant(n);
    // Odd integer degree: `np.power` is NaN for a negative base, but the real
    // root exists (interpreter convention, e.g. Root(-8, 3) = -2). Emit the
    // sign-corrected form `sign(x)·|x|^(1/n)`.
    if (nConst !== undefined && Number.isInteger(nConst) && nConst % 2 !== 0) {
      const c = compile(x);
      return `(np.sign(${c}) * np.power(np.abs(${c}), 1.0 / ${compile(n)}))`;
    }
    return `np.power(${compile(x)}, 1.0 / ${compile(n)})`;
  },

  // Rounding and absolute value
  Abs: (args, compile) => {
    if (BaseCompiler.isComplexValued(args[0]))
      return `abs(${compile(args[0])})`;
    return `np.abs(${compile(args[0])})`;
  },
  Sign: 'np.sign',
  Floor: 'np.floor',
  Ceil: 'np.ceil',
  // The interpreter rounds half away from zero (Round(-2.5) = -3, Round(2.5) =
  // 3); `np.round` uses banker's rounding (Round(2.5) = 2). Reconstruct
  // half-away as `sign(x)·floor(|x| + 0.5)`.
  Round: ([x], compile) => {
    if (x === null) throw new Error('Round: no argument');
    const c = compile(x);
    return `(np.sign(${c}) * np.floor(np.abs(${c}) + 0.5))`;
  },
  Truncate: 'np.trunc',

  // Min/Max
  Min: 'np.minimum',
  Max: 'np.maximum',

  // Modulo. `np.mod` is floored (matches the interpreter and D1). `Remainder`
  // uses the interpreter's truncated/round-to-nearest-quotient semantics, NOT
  // `np.remainder` (which is a floored modulo): mirror the JS target's
  // `a - b·round(a/b)`.
  Mod: 'np.mod',
  Remainder: ([a, b], compile) => {
    if (a === null || b === null)
      throw new Error('Remainder: missing argument');
    const ca = compile(a);
    const cb = compile(b);
    return `(${ca} - ${cb} * np.round(${ca} / ${cb}))`;
  },

  // Complex numbers
  Real: 'np.real',
  Imaginary: 'np.imag',
  Argument: 'np.angle',
  Conjugate: 'np.conj',

  // Array/Vector operations
  Sum: 'np.sum',
  Product: 'np.prod',
  Mean: 'np.mean',
  Median: 'np.median',
  Variance: 'np.var',
  StandardDeviation: 'np.std',
  // Covariance/Correlation: two-collection form only. numpy `np.cov` defaults
  // to ddof=1 (sample) and returns the 2×2 covariance matrix — the off-diagonal
  // entry [0][1] is Cov(x, y). `np.corrcoef` returns the correlation matrix.
  Covariance: ([x, y], compile) => {
    if (x === null || y === null)
      throw new Error('Covariance: expected two collection arguments');
    return `np.cov(${compile(x)}, ${compile(y)})[0][1]`;
  },
  PopulationCovariance: ([x, y], compile) => {
    if (x === null || y === null)
      throw new Error('PopulationCovariance: expected two collection arguments');
    return `np.cov(${compile(x)}, ${compile(y)}, ddof=0)[0][1]`;
  },
  Correlation: ([x, y], compile) => {
    if (x === null || y === null)
      throw new Error('Correlation: expected two collection arguments');
    return `np.corrcoef(${compile(x)}, ${compile(y)})[0][1]`;
  },

  // Linear algebra
  Dot: 'np.dot',
  Cross: 'np.cross',
  Norm: 'np.linalg.norm',
  Determinant: 'np.linalg.det',
  Inverse: 'np.linalg.inv',
  Transpose: 'np.transpose',
  MatrixMultiply: 'np.matmul',

  // Comparison — tolerance-aware equality (see compilePythonEquality). The
  // `abs(a - b) <= tol` form is element-wise for NumPy arrays too, so it also
  // serves the collection-operand path (where the base compiler skips the infix
  // operator). Less/Greater stay as the infix relational operators from
  // PYTHON_OPERATORS; their function forms below serve the collection path.
  Equal: (args, compile) => compilePythonEquality('Equal', args, compile),
  NotEqual: (args, compile) => compilePythonEquality('NotEqual', args, compile),
  Less: 'np.less',
  LessEqual: 'np.less_equal',
  Greater: 'np.greater',
  GreaterEqual: 'np.greater_equal',
  And: 'np.logical_and',
  Or: 'np.logical_or',
  Not: 'np.logical_not',

  // Control flow — the base compiler's default emits JS ternaries and a bare
  // `NaN`, both of which are Python SyntaxErrors. Emit Python conditional
  // expressions (`a if cond else b`) and `float('nan')`.
  If: (args, compile) => {
    if (args.length !== 3) throw new Error('If: wrong number of arguments');
    return `((${compile(args[1])}) if (${compile(args[0])}) else (${compile(
      args[2]
    )}))`;
  },
  // DIVERGENCE (documented, CO-P2-24): a *non-boolean* condition (e.g. one that
  // evaluates to NaN) makes the interpreter throw ("Condition must evaluate to
  // True or False"), whereas this Python conditional expression treats it by
  // truthiness and takes the else branch. Aligning would require an inline
  // Python raise (no clean expression-position form) — left documented. The JS
  // target aligns via `_SYS.cond`; conditions built from relational/logical
  // operators (the common case) are already boolean, so no divergence arises.
  When: (args, compile) => {
    if (args.length !== 2)
      throw new Error('When: expected exactly 2 arguments (expr, cond)');
    if (isSymbol(args[1], 'True')) return `(${compile(args[0])})`;
    if (isSymbol(args[1], 'False')) return "float('nan')";
    return `((${compile(args[0])}) if (${compile(args[1])}) else float('nan'))`;
  },
  // See the divergence note on `When` above (non-boolean condition → else
  // branch here vs interpreter throw).
  Which: (args, compile) => {
    if (args.length < 2 || args.length % 2 !== 0)
      throw new Error('Which: expected condition/value pairs');
    const build = (i: number): string => {
      if (i >= args.length) return "float('nan')";
      const cond = args[i];
      const val = args[i + 1];
      // `True` marks the default (else) branch.
      if (isSymbol(cond, 'True')) return `(${compile(val)})`;
      return `((${compile(val)}) if (${compile(cond)}) else ${build(i + 2)})`;
    };
    return build(0);
  },

  // Special functions
  Erf: 'scipy.special.erf',
  Erfc: 'scipy.special.erfc',
  Gamma: 'scipy.special.gamma',
  GammaLn: 'scipy.special.loggamma',
  Factorial: 'scipy.special.factorial',
  // Regularized upper incomplete gamma Q(a, z); scipy's argument order matches
  // ours directly.
  GammaRegularized: 'scipy.special.gammaincc',
  // Regularized incomplete beta I_x(a, b); scipy.special.betainc(a, b, x)
  // takes a DIFFERENT argument order than ours (x, a, b) — reorder here.
  BetaRegularized: ([x, a, b], compile) => {
    if (x === null || a === null || b === null)
      throw new Error('BetaRegularized: missing argument');
    return `scipy.special.betainc(${compile(a)}, ${compile(b)}, ${compile(x)})`;
  },

  // Common patterns
  List: (args, compile) => {
    // Python list notation
    return `[${args.map((x) => compile(x)).join(', ')}]`;
  },
  // Matrix wraps List(List(...), ...) — compile as np.array for proper matrix ops
  Matrix: (args, compile) => `np.array(${compile(args[0])})`,
  // Tuple compiles to a Python tuple
  Tuple: (args, compile) => `(${args.map((x) => compile(x)).join(', ')})`,
  Sequence: (args, compile) => {
    // NumPy array
    return `np.array([${args.map((x) => compile(x)).join(', ')}])`;
  },
  Range: (args, compile) => {
    // np.arange(start, stop, step)
    if (args.length === 1) return `np.arange(${compile(args[0])})`;
    if (args.length === 2)
      return `np.arange(${compile(args[0])}, ${compile(args[1])})`;
    if (args.length === 3)
      return `np.arange(${compile(args[0])}, ${compile(args[1])}, ${compile(
        args[2]
      )})`;
    return 'np.arange';
  },
};

/**
 * Python/NumPy language target implementation
 *
 * Generates Python code that uses NumPy for mathematical operations.
 * The generated code is compatible with NumPy arrays and supports
 * vectorized operations.
 */
export class PythonTarget implements LanguageTarget<Expression> {
  /** Whether to include 'import numpy as np' in generated code */
  private includeImports: boolean;

  /** Whether to use scipy.special for advanced functions */
  private useScipy: boolean;

  constructor(options: { includeImports?: boolean; useScipy?: boolean } = {}) {
    this.includeImports = options.includeImports ?? false;
    this.useScipy = options.useScipy ?? false;
  }

  getOperators(): CompiledOperators {
    return PYTHON_OPERATORS;
  }

  getFunctions(): CompiledFunctions<Expression> {
    return PYTHON_FUNCTIONS;
  }

  createTarget(
    options: Partial<CompileTarget<Expression>> = {}
  ): CompileTarget<Expression> {
    return {
      language: 'python',
      // Chained relations join with Python's `and`, not `&&`.
      chainOp: 'and',
      // Evaluate a shared middle operand of a chained relation exactly once
      // (matching the interpreter) by binding it in an immediately-applied
      // `lambda` — Python's expression-position value binding.
      bindExpr: (bindings, body) =>
        `(lambda ${bindings.map((b) => b[0]).join(', ')}: ${body})(${bindings
          .map((b) => b[1])
          .join(', ')})`,
      operators: (op) => PYTHON_OPERATORS[op],
      functions: (id) => PYTHON_FUNCTIONS[id],
      // Resolve a mathematical constant; otherwise return `undefined` so
      // BaseCompiler folds an assigned value / declared constant into the code
      // (matching `evaluate()` and the JavaScript target) and falls back to the
      // bare identifier — a Python parameter name — only for a genuinely free
      // symbol.
      var: (id) => PYTHON_CONSTANTS[id],
      complex: (re, im) => `complex(${re}, ${im})`,
      string: (str) => JSON.stringify(str),
      number: (n) => {
        // Python number literals
        if (!isFinite(n)) {
          if (n === Infinity) return 'np.inf';
          if (n === -Infinity) return '-np.inf';
          return 'np.nan';
        }
        return n.toString();
      },
      indent: 0,
      ws: (s?: string) => s ?? '',
      preamble: '',
      ...options,
    };
  }

  /**
   * Build a `var` resolver honoring, in order: shadowed parameters (kept bare),
   * an explicit `vars` mapping (which always wins over folding — a per-call
   * substitution), mathematical constants, then `undefined` so BaseCompiler
   * folds an assigned value / emits the bare identifier for a free symbol.
   */
  private makeVarResolver(
    vars?: Record<string, string>,
    shadowed?: ReadonlyArray<string>
  ): (id: string) => string | undefined {
    return (id: string) => {
      if (shadowed?.includes(id)) return id;
      if (vars && id in vars) return JSON.stringify(vars[id]);
      return PYTHON_CONSTANTS[id];
    };
  }

  /**
   * Compile to Python source code (not executable in JavaScript)
   *
   * Returns Python code as a string. To execute it, use Python runtime.
   */
  compile(
    expr: Expression,
    options: CompilationOptions<Expression> = {}
  ): CompilationResult<'python'> {
    const vars = options.vars as Record<string, string> | undefined;
    const target = this.createTarget({
      var: this.makeVarResolver(vars),
    });
    let code = BaseCompiler.compile(expr, target);
    if (this.includeImports) code = this.withImports(code);

    const result: CompilationResult<'python'> = {
      target: 'python',
      success: true,
      code,
    };
    return BaseCompiler.withReferences(
      result,
      expr,
      target,
      vars ? new Set(Object.keys(vars)) : undefined
    );
  }

  /** Prepend the numpy / cmath / scipy imports when `includeImports` is set. */
  private withImports(code: string): string {
    let imports = 'import numpy as np\n';
    imports += 'import cmath\n';
    if (this.useScipy) imports += 'import scipy.special\n';
    return `${imports}\n${code}`;
  }

  /**
   * Compile an expression to Python source code
   *
   * Returns the Python code as a string. Honors `options.vars` (per-call
   * substitution) and folds assigned symbols.
   */
  compileToSource(
    expr: Expression,
    options: CompilationOptions<Expression> = {}
  ): string {
    const vars = options.vars as Record<string, string> | undefined;
    const target = this.createTarget({ var: this.makeVarResolver(vars) });
    const code = BaseCompiler.compile(expr, target);
    return this.includeImports ? this.withImports(code) : code;
  }

  /**
   * Create a complete Python function from an expression
   *
   * @param expr - The expression to compile
   * @param functionName - Name of the Python function
   * @param parameters - Parameter names (e.g., ['x', 'y', 'z'])
   * @param docstring - Optional docstring for the function
   */
  compileFunction(
    expr: Expression,
    functionName: string,
    parameters: string[],
    docstring?: string
  ): string {
    // Shadow the declared parameters so they stay bare identifiers (never
    // folded to an assigned engine value).
    const target = this.createTarget({
      var: this.makeVarResolver(undefined, parameters),
    });
    const body = BaseCompiler.compile(expr, target);

    const params = parameters.join(', ');
    let code = '';

    if (this.includeImports) {
      code += 'import numpy as np\n';
      code += 'import cmath\n';
      if (this.useScipy) {
        code += 'import scipy.special\n';
      }
      code += '\n';
    }

    code += `def ${functionName}(${params}):\n`;

    if (docstring) {
      code += `    r"""${docstring}"""\n`;
    }

    code += `    return ${body}\n`;

    return code;
  }

  /**
   * Create a vectorized NumPy function from an expression
   *
   * The generated function will work with both scalar values and NumPy arrays.
   *
   * @param expr - The expression to compile
   * @param functionName - Name of the Python function
   * @param parameters - Parameter names
   * @param docstring - Optional docstring
   */
  compileVectorized(
    expr: Expression,
    functionName: string,
    parameters: string[],
    docstring?: string
  ): string {
    const baseFunction = this.compileFunction(
      expr,
      `_${functionName}_scalar`,
      parameters,
      docstring
    );

    let code = baseFunction + '\n';

    code += `# Vectorized version\n`;
    code += `${functionName} = np.vectorize(_${functionName}_scalar)\n`;

    return code;
  }

  /**
   * Create a lambda function from an expression
   *
   * @param expr - The expression to compile
   * @param parameters - Parameter names
   */
  compileLambda(expr: Expression, parameters: string[]): string {
    const target = this.createTarget({
      var: this.makeVarResolver(undefined, parameters),
    });
    const body = BaseCompiler.compile(expr, target);

    const params = parameters.join(', ');
    return `lambda ${params}: ${body}`;
  }
}
