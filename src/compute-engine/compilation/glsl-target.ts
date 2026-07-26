import type { Expression } from '../global-types.js';
import type { CompiledFunctions } from './types.js';
import {
  GPUShaderTarget,
  compileGPUMatrix,
  assertGPUScalarComponents,
} from './gpu-target.js';
import { BaseCompiler } from './base-compiler.js';

/**
 * GLSL-specific function overrides.
 *
 * These override or extend the shared GPU functions for GLSL-specific naming
 * and syntax: `inversesqrt`, `mod()`, and `vec2`/`vec3`/`vec4` constructors.
 */
function compileGLSLList(
  args: ReadonlyArray<Expression>,
  compile: (expr: Expression) => string
) {
  assertGPUScalarComponents(
    args,
    args.length >= 2 && args.length <= 4 ? `vec${args.length}` : 'float[]'
  );
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
  // Annotated `string` (not the literal `'glsl'`) so subclasses can override it
  // while reusing the GLSL shader assembly.
  protected readonly languageId: string = 'glsl';

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

    if (body.includes('\n')) {
      // Block — body already has `return` on the last line
      const indented = body
        .split('\n')
        .map((l) => `  ${l}`)
        .join('\n');
      return `${returnType} ${functionName}(${params}) {\n${indented}\n}`;
    }
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

    // ES 3.00+ (or desktop 3.30+) only: the emitted code uses `in`/`out` and
    // ES 3.00 builtins. Reject an older version rather than emit constructs the
    // declared header does not support.
    const versionNumber = Number.parseInt(version, 10);
    if (!Number.isFinite(versionNumber) || versionNumber < 300)
      throw new Error(
        `GLSL version "${version}" is not supported: ES 3.00+ (or desktop 3.30+) is required`
      );

    let code = `#version ${version}\n\n`;

    if (type === 'fragment') {
      code += 'precision highp float;\n\n';
    }

    for (const input of inputs) {
      code += `in ${input.type} ${input.name};\n`;
    }
    if (inputs.length > 0) code += '\n';

    for (const output of outputs) {
      code += `out ${output.type} ${output.name};\n`;
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
