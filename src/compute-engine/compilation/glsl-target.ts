import type { BoxedExpression } from '../global-types';
import type { MathJsonSymbol } from '../../math-json/types';

import type {
  CompileTarget,
  CompiledOperators,
  CompiledFunctions,
  LanguageTarget,
  CompilationOptions,
  CompiledExecutable,
  TargetSource,
} from './types';

/**
 * GLSL (OpenGL Shading Language) operator mappings
 *
 * GLSL uses the same operators as C/JavaScript for basic arithmetic,
 * but they work natively on vectors and matrices.
 */
const GLSL_OPERATORS: CompiledOperators = {
  Add: ['+', 11],
  Negate: ['-', 14], // Unary operator
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
  Not: ['!', 14], // Unary operator
};

/**
 * GLSL function implementations
 *
 * GLSL has built-in functions for common mathematical operations.
 * Note: No 'Math.' prefix like JavaScript
 */
const GLSL_FUNCTIONS: CompiledFunctions = {
  // Basic arithmetic (for when they're called as functions, e.g., with vectors)
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
    // For more than 2 args, fold left
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
    // For more than 2 args, fold left
    let result = compile(args[0]);
    for (let i = 1; i < args.length; i++) {
      result = `${result} / ${compile(args[i])}`;
    }
    return result;
  },

  Abs: 'abs',
  Arccos: 'acos',
  Arcsin: 'asin',
  Arctan: 'atan',
  Ceiling: 'ceil',
  Clamp: 'clamp',
  Cos: 'cos',
  Degrees: 'degrees',
  Exp: 'exp',
  Exp2: 'exp2',
  Floor: 'floor',
  Fract: 'fract',
  Inversesqrt: 'inversesqrt',
  Ln: 'log', // Natural logarithm in GLSL
  Log2: 'log2',
  Max: 'max',
  Min: 'min',
  Mix: 'mix',
  Mod: 'mod',
  Power: 'pow',
  Radians: 'radians',
  Round: 'round',
  Sign: 'sign',
  Sin: 'sin',
  Smoothstep: 'smoothstep',
  Sqrt: 'sqrt',
  Step: 'step',
  Tan: 'tan',

  // Vector/Matrix operations
  Cross: 'cross',
  Distance: 'distance',
  Dot: 'dot',
  Length: 'length',
  Normalize: 'normalize',
  Reflect: 'reflect',
  Refract: 'refract',

  // Common patterns
  List: (args, compile) => {
    // Detect vector type from number of elements
    if (args.length === 2)
      return `vec2(${args.map((x) => compile(x)).join(', ')})`;
    if (args.length === 3)
      return `vec3(${args.map((x) => compile(x)).join(', ')})`;
    if (args.length === 4)
      return `vec4(${args.map((x) => compile(x)).join(', ')})`;
    // For arrays or other cases, use array notation
    return `float[${args.length}](${args.map((x) => compile(x)).join(', ')})`;
  },
};

/**
 * GLSL language target implementation
 */
export class GLSLTarget implements LanguageTarget {
  getOperators(): CompiledOperators {
    return GLSL_OPERATORS;
  }

  getFunctions(): CompiledFunctions {
    return GLSL_FUNCTIONS;
  }

  createTarget(options: Partial<CompileTarget> = {}): CompileTarget {
    return {
      language: 'glsl',
      operators: (op) => GLSL_OPERATORS[op],
      functions: (id) => GLSL_FUNCTIONS[id],
      var: (id) => {
        // GLSL constants
        const constants = {
          Pi: '3.14159265359',
          ExponentialE: '2.71828182846',
          GoldenRatio: '1.61803398875',
          CatalanConstant: '0.91596559417',
          EulerGamma: '0.57721566490',
        };
        if (id in constants) return constants[id as keyof typeof constants];
        return id; // Variables use their names directly
      },
      string: (str) => JSON.stringify(str),
      number: (n) => {
        // GLSL requires float literals to have decimal point
        const str = n.toString();
        if (!str.includes('.') && !str.includes('e') && !str.includes('E')) {
          return `${str}.0`;
        }
        return str;
      },
      indent: 0,
      ws: (s?: string) => s ?? '',
      preamble: '',
      ...options,
    };
  }

  /**
   * Compile to GLSL source code (not executable)
   *
   * GLSL doesn't run in JavaScript, so this returns source code as a string
   * rather than an executable function.
   */
  compileToExecutable(
    expr: BoxedExpression,
    options: CompilationOptions = {}
  ): CompiledExecutable {
    const { functions, vars } = options;

    // Dynamic import to avoid circular dependency
    const { BaseCompiler } = require('./base-compiler');

    const target = this.createTarget({
      functions: (id) => {
        if (functions && id in functions) {
          const fn = functions[id];
          if (typeof fn === 'string') return fn;
          // For GLSL, we can't use JavaScript functions directly
          // Return the function name and expect it to be defined in GLSL
          if (typeof fn === 'function') return fn.name || id;
        }
        return GLSL_FUNCTIONS[id];
      },
      var: (id) => {
        if (vars && id in vars) return vars[id] as string;
        const constants = {
          Pi: '3.14159265359',
          ExponentialE: '2.71828182846',
          GoldenRatio: '1.61803398875',
          CatalanConstant: '0.91596559417',
          EulerGamma: '0.57721566490',
        };
        if (id in constants) return constants[id as keyof typeof constants];
        return id;
      },
    });

    const glslCode = BaseCompiler.compile(expr, target);

    // Return a "compiled" object that contains the GLSL source code
    // This follows the CompiledExecutable interface but doesn't execute
    const result = function () {
      return glslCode;
    };

    // Add toString to return the GLSL code
    Object.defineProperty(result, 'toString', {
      value: () => glslCode,
    });

    // Add isCompiled flag
    Object.defineProperty(result, 'isCompiled', {
      value: true,
    });

    return result as CompiledExecutable;
  }

  /**
   * Compile an expression to GLSL source code
   *
   * Returns the GLSL code as a string.
   */
  compile(expr: BoxedExpression, options: CompilationOptions = {}): string {
    // Dynamic import to avoid circular dependency
    const { BaseCompiler } = require('./base-compiler');
    const target = this.createTarget();
    return BaseCompiler.compile(expr, target);
  }

  /**
   * Create a complete GLSL function from an expression
   *
   * @param expr - The expression to compile
   * @param functionName - Name of the GLSL function
   * @param returnType - GLSL return type (e.g., 'float', 'vec3')
   * @param parameters - Parameter declarations (e.g., [['x', 'float'], ['y', 'vec3']])
   */
  compileFunction(
    expr: BoxedExpression,
    functionName: string,
    returnType: string,
    parameters: Array<[name: string, type: string]>
  ): string {
    // Dynamic import to avoid circular dependency
    const { BaseCompiler } = require('./base-compiler');

    const target = this.createTarget();
    const body = BaseCompiler.compile(expr, target);

    const params = parameters
      .map(([name, type]) => `${type} ${name}`)
      .join(', ');

    return `${returnType} ${functionName}(${params}) {
  return ${body};
}`;
  }

  /**
   * Create a complete GLSL shader from expressions
   *
   * @param options - Shader compilation options
   */
  compileShader(options: {
    /** Shader type: 'vertex' or 'fragment' */
    type: 'vertex' | 'fragment';
    /** GLSL version (e.g., '300 es', '330', '450') */
    version?: string;
    /** Input variables (attributes or varyings) */
    inputs?: Array<{ name: string; type: string }>;
    /** Output variables */
    outputs?: Array<{ name: string; type: string }>;
    /** Uniform variables */
    uniforms?: Array<{ name: string; type: string }>;
    /** Main function body expressions */
    body: Array<{ variable: string; expression: BoxedExpression }>;
  }): string {
    const {
      type,
      version = '300 es',
      inputs = [],
      outputs = [],
      uniforms = [],
      body,
    } = options;

    let code = `#version ${version}\n\n`;

    // Add precision qualifier for fragment shaders
    if (type === 'fragment') {
      code += 'precision highp float;\n\n';
    }

    // Add inputs
    const inputKeyword =
      version.startsWith('300') || version.startsWith('3')
        ? 'in'
        : type === 'vertex'
          ? 'attribute'
          : 'varying';
    for (const input of inputs) {
      code += `${inputKeyword} ${input.type} ${input.name};\n`;
    }
    if (inputs.length > 0) code += '\n';

    // Add outputs
    const outputKeyword =
      version.startsWith('300') || version.startsWith('3') ? 'out' : 'varying';
    for (const output of outputs) {
      code += `${outputKeyword} ${output.type} ${output.name};\n`;
    }
    if (outputs.length > 0) code += '\n';

    // Add uniforms
    for (const uniform of uniforms) {
      code += `uniform ${uniform.type} ${uniform.name};\n`;
    }
    if (uniforms.length > 0) code += '\n';

    // Add main function
    code += 'void main() {\n';
    for (const assignment of body) {
      const glsl = this.compile(assignment.expression);
      code += `  ${assignment.variable} = ${glsl};\n`;
    }
    code += '}\n';

    return code;
  }
}
