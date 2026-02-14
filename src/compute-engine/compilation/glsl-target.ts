import type { Expression } from '../global-types';
import type { CompiledFunctions } from './types';
import { GPUShaderTarget, compileGPUMatrix } from './gpu-target';
import { BaseCompiler } from './base-compiler';

/**
 * GLSL-specific function overrides.
 *
 * These override or extend the shared GPU functions for GLSL-specific naming
 * and syntax: `inversesqrt`, `mod()`, and `vec2`/`vec3`/`vec4` constructors.
 */
function compileGLSLList(args, compile) {
  if (args.length === 2)
    return `vec2(${args.map((x) => compile(x)).join(', ')})`;
  if (args.length === 3)
    return `vec3(${args.map((x) => compile(x)).join(', ')})`;
  if (args.length === 4)
    return `vec4(${args.map((x) => compile(x)).join(', ')})`;
  return `float[${args.length}](${args.map((x) => compile(x)).join(', ')})`;
}

const GLSL_FUNCTIONS: CompiledFunctions<Expression> = {
  Inversesqrt: 'inversesqrt',
  Mod: 'mod',

  List: compileGLSLList,
  Matrix: (args, compile) =>
    compileGPUMatrix(
      args,
      compile,
      (n) => `vec${n}`,
      (n) => `mat${n}`,
      (n) => `float[${n}]`
    ),
  // Tuple compiles identically to List
  Tuple: compileGLSLList,
};

/**
 * GLSL (OpenGL Shading Language) compilation target.
 *
 * Extends the shared GPU base class with GLSL-specific function names,
 * C-style function declarations, and `#version`-based shader structure.
 */
export class GLSLTarget extends GPUShaderTarget {
  protected readonly languageId = 'glsl';

  protected getLanguageSpecificFunctions(): CompiledFunctions<Expression> {
    return GLSL_FUNCTIONS;
  }

  compileFunction(
    expr: Expression,
    functionName: string,
    returnType: string,
    parameters: Array<[name: string, type: string]>
  ): string {
    const target = this.createTarget();
    const body = BaseCompiler.compile(expr, target);

    const params = parameters
      .map(([name, type]) => `${type} ${name}`)
      .join(', ');

    return `${returnType} ${functionName}(${params}) {
  return ${body};
}`;
  }

  compileShader(options: {
    type: 'vertex' | 'fragment';
    version?: string;
    inputs?: Array<{ name: string; type: string }>;
    outputs?: Array<{ name: string; type: string }>;
    uniforms?: Array<{ name: string; type: string }>;
    body: Array<{ variable: string; expression: Expression }>;
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

    if (type === 'fragment') {
      code += 'precision highp float;\n\n';
    }

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

    const outputKeyword =
      version.startsWith('300') || version.startsWith('3') ? 'out' : 'varying';
    for (const output of outputs) {
      code += `${outputKeyword} ${output.type} ${output.name};\n`;
    }
    if (outputs.length > 0) code += '\n';

    for (const uniform of uniforms) {
      code += `uniform ${uniform.type} ${uniform.name};\n`;
    }
    if (uniforms.length > 0) code += '\n';

    code += 'void main() {\n';
    for (const assignment of body) {
      const glsl = this.compileToSource(assignment.expression);
      code += `  ${assignment.variable} = ${glsl};\n`;
    }
    code += '}\n';

    return code;
  }
}
