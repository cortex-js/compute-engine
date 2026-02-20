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

/**
 * Python operator mappings
 *
 * Python uses similar operators to JavaScript, but with ** for exponentiation.
 * NumPy arrays support element-wise operations with these operators.
 */
const PYTHON_OPERATORS: CompiledOperators = {
  Add: ['+', 11],
  Negate: ['-', 14], // Unary operator
  Subtract: ['-', 11],
  Multiply: ['*', 12],
  Divide: ['/', 13],
  Power: ['**', 15], // Python exponentiation operator
  Equal: ['==', 8],
  NotEqual: ['!=', 8],
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
  Subtract: (args, compile) => {
    if (args.length === 0) return '0';
    if (args.length === 1) return compile(args[0]);
    if (args.length === 2) return `${compile(args[0])} - ${compile(args[1])}`;
    // For more than 2 args, fold left
    let result = compile(args[0]);
    for (let i = 1; i < args.length; i++) {
      result = `${result} - ${compile(args[i])}`;
    }
    return result;
  },
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
    return `np.arctan(1 / (${compile(x)}))`;
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
    return `np.power(${compile(args[0])}, 1.0 / ${compile(args[1])})`;
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
  Round: 'np.round',
  Truncate: 'np.trunc',

  // Min/Max
  Min: 'np.minimum',
  Max: 'np.maximum',

  // Modulo
  Mod: 'np.mod',
  Remainder: 'np.remainder',

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

  // Linear algebra
  Dot: 'np.dot',
  Cross: 'np.cross',
  Norm: 'np.linalg.norm',
  Determinant: 'np.linalg.det',
  Inverse: 'np.linalg.inv',
  Transpose: 'np.transpose',
  MatrixMultiply: 'np.matmul',

  // Logic functions
  Equal: 'np.equal',
  NotEqual: 'np.not_equal',
  Less: 'np.less',
  LessEqual: 'np.less_equal',
  Greater: 'np.greater',
  GreaterEqual: 'np.greater_equal',
  And: 'np.logical_and',
  Or: 'np.logical_or',
  Not: 'np.logical_not',

  // Special functions
  Erf: 'scipy.special.erf',
  Erfc: 'scipy.special.erfc',
  Gamma: 'scipy.special.gamma',
  GammaLn: 'scipy.special.loggamma',
  Factorial: 'scipy.special.factorial',

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
      operators: (op) => PYTHON_OPERATORS[op],
      functions: (id) => PYTHON_FUNCTIONS[id],
      var: (id) => {
        // Python mathematical constants
        const constants = {
          Pi: 'np.pi',
          ExponentialE: 'np.e',
          ImaginaryUnit: '1j',
          Infinity: 'np.inf',
          NaN: 'np.nan',
          // Compute other constants
          GoldenRatio: '((1 + np.sqrt(5)) / 2)',
          CatalanConstant: '0.915965594177219015054603514932384110774',
          EulerGamma: '0.5772156649015328606065120900824024310421',
        };
        if (id in constants) return constants[id as keyof typeof constants];
        return id; // Variables use their names directly
      },
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
   * Compile to Python source code (not executable in JavaScript)
   *
   * Returns Python code as a string. To execute it, use Python runtime.
   */
  compile(
    expr: Expression,
    options: CompilationOptions<Expression> = {}
  ): CompilationResult<'python'> {
    const code = this.compileToSource(expr, options);
    return { target: 'python', success: true, code };
  }

  /**
   * Compile an expression to Python source code
   *
   * Returns the Python code as a string.
   */
  compileToSource(
    expr: Expression,
    _options: CompilationOptions<Expression> = {}
  ): string {
    const target = this.createTarget();
    const code = BaseCompiler.compile(expr, target);

    if (this.includeImports) {
      let imports = 'import numpy as np\n';
      imports += 'import cmath\n';
      if (this.useScipy) {
        imports += 'import scipy.special\n';
      }
      return `${imports}\n${code}`;
    }

    return code;
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
    const target = this.createTarget();
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
    const target = this.createTarget();
    const body = BaseCompiler.compile(expr, target);

    const params = parameters.join(', ');
    return `lambda ${params}: ${body}`;
  }
}
