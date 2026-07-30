import type { Expression } from '../global-types.js';
import type { CompiledFunctions } from './types.js';
import {
  GPUShaderTarget,
  compileGPUMatrix,
  assertGPUScalarComponents,
} from './gpu-target.js';

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
    // Compiled under the caller's declared parameter shapes, so the body
    // analysis agrees with the signature emitted below.
    const body = this.compileDeclaredFunctionBody(expr, parameters);

    const params = parameters
      .map(([name, type]) => `${type} ${name}`)
      .join(', ');

    // A user-defined function the body calls is emitted once as its own GLSL
    // declaration. This route returns a complete declaration with no preamble
    // channel, so the whole preamble is prepended — GLSL requires declaration
    // before use, and the registry orders a callee ahead of its caller.
    // `preambleFor` (NOT a raw `userFunctionDefs()` prepend) is what declares
    // the `_gpu_*` helpers the DEFINITION BODIES reference, and it already
    // folds the definitions in exactly once, after those helpers.
    const rawDefs = this.preambleFor(body);
    const userDefs = rawDefs ? `${rawDefs}\n` : '';

    if (body.includes('\n')) {
      // Block — body already has `return` on the last line
      const indented = body
        .split('\n')
        .map((l) => `  ${l}`)
        .join('\n');
      return `${userDefs}${returnType} ${functionName}(${params}) {\n${indented}\n}`;
    }
    return `${userDefs}${returnType} ${functionName}(${params}) {
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
      // `highp int` is declared alongside `highp float`: the PCG3D draw helper
      // needs EXACT 32-bit unsigned arithmetic, and the default integer
      // precision of an ES 3.00 fragment shader is not reliably `highp`.
      code += 'precision highp float;\nprecision highp int;\n\n';
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

    // Compile the body statements FIRST: the shader must define every
    // `_gpu_*` helper they reference, so the preamble is derived from the
    // emitted code and spliced in ahead of `main()` — this route returns a
    // complete shader, with no separate `preamble` channel for the caller to
    // assemble. (Passing the STAGE is the redesign's §7 check: an unframed
    // `Random()` lowers to `gl_FragCoord`-derived spatial noise, which only a
    // fragment shader has.) The whole body compiles against ONE target, so
    // random frames in different statements get DISTINCT counters.
    // The declared inputs and uniforms are framed and bound for the body
    // analysis: nothing but these declarations carries their shader types, and
    // GLSL references both kinds bare (see `compileShaderBody`).
    const statements = this.compileShaderBody(body, type, [
      ...inputs,
      ...uniforms,
    ]);
    // Over the FULL emission: a helper may be referenced only from inside a
    // hoisted loop (Tycho item 110), and an undeclared helper is a shader that
    // fails to compile on the GPU.
    const preamble = this.preambleFor(
      statements.map((s) => [...s.stmts, s.code].join('\n')).join('\n')
    );
    if (preamble) code += `${preamble}\n`;

    code += 'void main() {\n';
    for (const s of statements) {
      for (const stmt of s.stmts)
        code += stmt
          .split('\n')
          .map((l) => `  ${l}\n`)
          .join('');
      code += `  ${s.variable} = ${s.code};\n`;
    }
    code += '}\n';

    return code;
  }
}
