import type { Expression } from '../global-types';
import type { CompiledFunctions } from './types';
import { GPUShaderTarget } from './gpu-target';

/**
 * WGSL-specific function overrides.
 *
 * These override the shared GPU functions for WGSL-specific naming
 * and syntax: `inverseSqrt`, `%` for mod, and `vec2f`/`vec3f`/`vec4f`
 * constructors.
 */
const WGSL_FUNCTIONS: CompiledFunctions<Expression> = {
  Inversesqrt: 'inverseSqrt',

  Mod: ([a, b], compile) => {
    if (a === null || b === null) throw new Error('Mod: missing argument');
    return `(${compile(a)} % ${compile(b)})`;
  },

  List: (args, compile) => {
    if (args.length === 2)
      return `vec2f(${args.map((x) => compile(x)).join(', ')})`;
    if (args.length === 3)
      return `vec3f(${args.map((x) => compile(x)).join(', ')})`;
    if (args.length === 4)
      return `vec4f(${args.map((x) => compile(x)).join(', ')})`;
    return `array<f32, ${args.length}>(${args.map((x) => compile(x)).join(', ')})`;
  },
};

/** Map common GLSL/MathJSON types to WGSL types */
const WGSL_TYPE_MAP: Record<string, string> = {
  float: 'f32',
  int: 'i32',
  uint: 'u32',
  bool: 'bool',
  vec2: 'vec2f',
  vec3: 'vec3f',
  vec4: 'vec4f',
  mat2: 'mat2x2f',
  mat3: 'mat3x3f',
  mat4: 'mat4x4f',
};

function toWGSLType(type: string): string {
  return WGSL_TYPE_MAP[type] ?? type;
}

/**
 * WGSL (WebGPU Shading Language) compilation target.
 *
 * Extends the shared GPU base class with WGSL-specific function names,
 * `fn` declaration syntax, and `@vertex`/`@fragment`/`@compute` shader
 * structure with struct-based I/O.
 */
export class WGSLTarget extends GPUShaderTarget {
  protected readonly languageId = 'wgsl';

  protected getLanguageSpecificFunctions(): CompiledFunctions<Expression> {
    return WGSL_FUNCTIONS;
  }

  compileFunction(
    expr: Expression,
    functionName: string,
    returnType: string,
    parameters: Array<[name: string, type: string]>
  ): string {
    // Dynamic import to avoid circular dependency
    const { BaseCompiler } = require('./base-compiler');

    const target = this.createTarget();
    const body = BaseCompiler.compile(expr, target);

    const params = parameters
      .map(([name, type]) => `${name}: ${toWGSLType(type)}`)
      .join(', ');

    return `fn ${functionName}(${params}) -> ${toWGSLType(returnType)} {
  return ${body};
}`;
  }

  compileShader(options: {
    type: 'vertex' | 'fragment' | 'compute';
    inputs?: Array<{
      name: string;
      type: string;
      location?: number;
      builtin?: string;
    }>;
    outputs?: Array<{
      name: string;
      type: string;
      location?: number;
      builtin?: string;
    }>;
    uniforms?: Array<{
      name: string;
      type: string;
      group?: number;
      binding?: number;
    }>;
    workgroupSize?: [number, number?, number?];
    body: Array<{ variable: string; expression: Expression }>;
  }): string {
    const {
      type,
      inputs = [],
      outputs = [],
      uniforms = [],
      workgroupSize,
      body,
    } = options;

    let code = '';

    // Generate input struct
    if (inputs.length > 0) {
      code += 'struct VertexInput {\n';
      for (const input of inputs) {
        const attr = input.builtin
          ? `@builtin(${input.builtin})`
          : `@location(${input.location ?? 0})`;
        code += `  ${attr} ${input.name}: ${toWGSLType(input.type)},\n`;
      }
      code += '};\n\n';
    }

    // Generate output struct
    if (outputs.length > 0) {
      const structName = type === 'vertex' ? 'VertexOutput' : 'FragmentOutput';
      code += `struct ${structName} {\n`;
      for (const output of outputs) {
        const attr = output.builtin
          ? `@builtin(${output.builtin})`
          : `@location(${output.location ?? 0})`;
        code += `  ${attr} ${output.name}: ${toWGSLType(output.type)},\n`;
      }
      code += '};\n\n';
    }

    // Generate uniform bindings
    for (const uniform of uniforms) {
      const group = uniform.group ?? 0;
      const binding = uniform.binding ?? 0;
      code += `@group(${group}) @binding(${binding}) var<uniform> ${uniform.name}: ${toWGSLType(uniform.type)};\n`;
    }
    if (uniforms.length > 0) code += '\n';

    // Generate entry point
    const stageAttr = `@${type}`;
    const workgroupAttr =
      type === 'compute' && workgroupSize
        ? `@workgroup_size(${workgroupSize.join(', ')})\n`
        : '';

    const hasInputStruct = inputs.length > 0;
    const hasOutputStruct = outputs.length > 0;
    const outputStructName =
      type === 'vertex' ? 'VertexOutput' : 'FragmentOutput';

    const paramStr = hasInputStruct ? 'input: VertexInput' : '';
    const returnStr = hasOutputStruct ? ` -> ${outputStructName}` : '';

    code += `${stageAttr}\n${workgroupAttr}fn main(${paramStr})${returnStr} {\n`;

    if (hasOutputStruct) {
      code += `  var output: ${outputStructName};\n`;
    }

    for (const assignment of body) {
      const wgsl = this.compileToSource(assignment.expression);
      code += `  ${assignment.variable} = ${wgsl};\n`;
    }

    if (hasOutputStruct) {
      code += '  return output;\n';
    }

    code += '}\n';

    return code;
  }
}
