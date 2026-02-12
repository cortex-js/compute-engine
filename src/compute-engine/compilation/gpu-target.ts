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
 * GPU shader operators shared by GLSL and WGSL.
 *
 * Both languages use identical C-style operators for arithmetic,
 * comparison, and logical operations.
 */
export const GPU_OPERATORS: CompiledOperators = {
  Add: ['+', 11],
  Negate: ['-', 14],
  Subtract: ['-', 11],
  Multiply: ['*', 12],
  Divide: ['/', 13],
  Equal: ['==', 8],
  NotEqual: ['!=', 8],
  LessEqual: ['<=', 9],
  GreaterEqual: ['>=', 9],
  Less: ['<', 9],
  Greater: ['>', 9],
  And: ['&&', 4],
  Or: ['||', 3],
  Not: ['!', 14],
};

/**
 * GPU shader functions shared by GLSL and WGSL.
 *
 * Both languages share identical built-in math functions. Language-specific
 * functions (inversesqrt naming, mod, vector constructors) are provided
 * by subclass overrides.
 */
export const GPU_FUNCTIONS: CompiledFunctions<Expression> = {
  // Variadic arithmetic (for function-call form, e.g., with vectors)
  Add: (args, compile) => {
    if (args.length === 0) return '0.0';
    if (args.length === 1) return compile(args[0]);
    return args.map((x) => compile(x)).join(' + ');
  },
  Multiply: (args, compile) => {
    if (args.length === 0) return '1.0';
    if (args.length === 1) return compile(args[0]);
    return args.map((x) => compile(x)).join(' * ');
  },
  Subtract: (args, compile) => {
    if (args.length === 0) return '0.0';
    if (args.length === 1) return compile(args[0]);
    if (args.length === 2) return `${compile(args[0])} - ${compile(args[1])}`;
    let result = compile(args[0]);
    for (let i = 1; i < args.length; i++) {
      result = `${result} - ${compile(args[i])}`;
    }
    return result;
  },
  Divide: (args, compile) => {
    if (args.length === 0) return '1.0';
    if (args.length === 1) return compile(args[0]);
    if (args.length === 2) return `${compile(args[0])} / ${compile(args[1])}`;
    let result = compile(args[0]);
    for (let i = 1; i < args.length; i++) {
      result = `${result} / ${compile(args[i])}`;
    }
    return result;
  },

  // Standard math functions (identical names in both GLSL and WGSL)
  Abs: 'abs',
  Arccos: 'acos',
  Arcsin: 'asin',
  Arctan: 'atan',
  Ceil: 'ceil',
  Clamp: 'clamp',
  Cos: 'cos',
  Degrees: 'degrees',
  Exp: 'exp',
  Exp2: 'exp2',
  Floor: 'floor',
  Fract: 'fract',
  Ln: 'log',
  Log2: 'log2',
  Max: 'max',
  Min: 'min',
  Mix: 'mix',
  Power: 'pow',
  Radians: 'radians',
  Round: 'round',
  Sign: 'sign',
  Sin: 'sin',
  Smoothstep: 'smoothstep',
  Sqrt: 'sqrt',
  Step: 'step',
  Tan: 'tan',
  Truncate: 'trunc',

  Remainder: ([a, b], compile) => {
    if (a === null || b === null)
      throw new Error('Remainder: missing argument');
    return `(${compile(a)} - ${compile(b)} * round(${compile(a)} / ${compile(b)}))`;
  },

  // Reciprocal trigonometric functions (no GPU built-ins)
  Cot: ([x], compile) => {
    if (x === null) throw new Error('Cot: no argument');
    const arg = compile(x);
    return `(cos(${arg}) / sin(${arg}))`;
  },
  Csc: ([x], compile) => {
    if (x === null) throw new Error('Csc: no argument');
    return `(1.0 / sin(${compile(x)}))`;
  },
  Sec: ([x], compile) => {
    if (x === null) throw new Error('Sec: no argument');
    return `(1.0 / cos(${compile(x)}))`;
  },

  // Inverse trigonometric (reciprocal)
  Arccot: ([x], compile) => {
    if (x === null) throw new Error('Arccot: no argument');
    return `atan(1.0 / (${compile(x)}))`;
  },
  Arccsc: ([x], compile) => {
    if (x === null) throw new Error('Arccsc: no argument');
    return `asin(1.0 / (${compile(x)}))`;
  },
  Arcsec: ([x], compile) => {
    if (x === null) throw new Error('Arcsec: no argument');
    return `acos(1.0 / (${compile(x)}))`;
  },

  // Hyperbolic functions
  Sinh: 'sinh',
  Cosh: 'cosh',
  Tanh: 'tanh',

  // Reciprocal hyperbolic functions
  Coth: ([x], compile) => {
    if (x === null) throw new Error('Coth: no argument');
    const arg = compile(x);
    return `(cosh(${arg}) / sinh(${arg}))`;
  },
  Csch: ([x], compile) => {
    if (x === null) throw new Error('Csch: no argument');
    return `(1.0 / sinh(${compile(x)}))`;
  },
  Sech: ([x], compile) => {
    if (x === null) throw new Error('Sech: no argument');
    return `(1.0 / cosh(${compile(x)}))`;
  },

  // Inverse hyperbolic functions
  Arcosh: 'acosh',
  Arsinh: 'asinh',
  Artanh: 'atanh',

  // Inverse hyperbolic (reciprocal)
  Arcoth: ([x], compile) => {
    if (x === null) throw new Error('Arcoth: no argument');
    return `atanh(1.0 / (${compile(x)}))`;
  },
  Arcsch: ([x], compile) => {
    if (x === null) throw new Error('Arcsch: no argument');
    return `asinh(1.0 / (${compile(x)}))`;
  },
  Arsech: ([x], compile) => {
    if (x === null) throw new Error('Arsech: no argument');
    return `acosh(1.0 / (${compile(x)}))`;
  },

  // Additional math functions
  Lb: 'log2',
  Log: (args, compile) => {
    if (args.length === 0) throw new Error('Log: no argument');
    if (args.length === 1) return `(log(${compile(args[0])}) / log(10.0))`;
    return `(log(${compile(args[0])}) / log(${compile(args[1])}))`;
  },
  Square: ([x], compile) => {
    if (x === null) throw new Error('Square: no argument');
    const arg = compile(x);
    return `(${arg} * ${arg})`;
  },
  Root: ([x, n], compile) => {
    if (x === null) throw new Error('Root: no argument');
    if (n === null || n === undefined) return `sqrt(${compile(x)})`;
    if (n?.re === 2) return `sqrt(${compile(x)})`;
    return `pow(${compile(x)}, 1.0 / ${compile(n)})`;
  },

  // Vector/Matrix operations
  Cross: 'cross',
  Distance: 'distance',
  Dot: 'dot',
  Length: 'length',
  Normalize: 'normalize',
  Reflect: 'reflect',
  Refract: 'refract',
};

/** Constants shared by both GLSL and WGSL */
const GPU_CONSTANTS: Record<string, string> = {
  Pi: '3.14159265359',
  ExponentialE: '2.71828182846',
  GoldenRatio: '1.61803398875',
  CatalanConstant: '0.91596559417',
  EulerGamma: '0.57721566490',
};

/**
 * Format a number as a GPU float literal.
 *
 * Both GLSL and WGSL require float literals to have a decimal point.
 */
function formatGPUNumber(n: number): string {
  const str = n.toString();
  if (!str.includes('.') && !str.includes('e') && !str.includes('E')) {
    return `${str}.0`;
  }
  return str;
}

/**
 * Abstract base class for GPU shader compilation targets.
 *
 * Provides shared operators, math functions, constants, and number formatting
 * for both GLSL and WGSL. Subclasses implement language-specific details:
 * function naming differences, vector constructors, function declaration
 * syntax, and shader structure.
 */
export abstract class GPUShaderTarget implements LanguageTarget<Expression> {
  /** Language identifier (e.g., 'glsl', 'wgsl') */
  protected abstract readonly languageId: string;

  /**
   * Return language-specific function overrides.
   *
   * These are merged on top of the shared GPU_FUNCTIONS, allowing
   * subclasses to override specific entries (e.g., `Inversesqrt`, `Mod`, `List`).
   */
  protected abstract getLanguageSpecificFunctions(): CompiledFunctions<Expression>;

  /**
   * Create a complete function declaration in the target language.
   */
  abstract compileFunction(
    expr: Expression,
    functionName: string,
    returnType: string,
    parameters: Array<[name: string, type: string]>
  ): string;

  /**
   * Create a complete shader program in the target language.
   */
  abstract compileShader(options: Record<string, unknown>): string;

  getOperators(): CompiledOperators {
    return GPU_OPERATORS;
  }

  getFunctions(): CompiledFunctions<Expression> {
    return { ...GPU_FUNCTIONS, ...this.getLanguageSpecificFunctions() };
  }

  getConstants(): Record<string, string> {
    return GPU_CONSTANTS;
  }

  createTarget(
    options: Partial<CompileTarget<Expression>> = {}
  ): CompileTarget<Expression> {
    const functions = this.getFunctions();
    const constants = this.getConstants();
    return {
      language: this.languageId,
      operators: (op) => GPU_OPERATORS[op],
      functions: (id) => functions[id],
      var: (id) => {
        if (id in constants) return constants[id];
        return id;
      },
      string: (str) => JSON.stringify(str),
      number: formatGPUNumber,
      indent: 0,
      ws: (s?: string) => s ?? '',
      preamble: '',
      ...options,
    };
  }

  compile(
    expr: Expression,
    options: CompilationOptions<Expression> = {}
  ): CompilationResult {
    const { functions: userFunctions, vars } = options;
    const allFunctions = this.getFunctions();
    const constants = this.getConstants();

    const target = this.createTarget({
      functions: (id) => {
        if (userFunctions && id in userFunctions) {
          const fn = userFunctions[id];
          if (typeof fn === 'string') return fn;
          if (typeof fn === 'function') return fn.name || id;
        }
        return allFunctions[id];
      },
      var: (id) => {
        if (vars && id in vars) return vars[id] as string;
        if (id in constants) return constants[id];
        return id;
      },
    });

    const code = BaseCompiler.compile(expr, target);
    return { target: this.languageId, success: true, code };
  }

  compileToSource(
    expr: Expression,
    _options: CompilationOptions<Expression> = {}
  ): string {
    const target = this.createTarget();
    return BaseCompiler.compile(expr, target);
  }
}
