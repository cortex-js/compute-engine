import type { Expression } from '../global-types.js';
import type { CompiledFunctions } from './types.js';
import {
  GPUShaderTarget,
  compileGPUMatrix,
  assertGPUScalarComponents,
  gpuOperandShape,
  gpuAssertExpressionBody,
  type GPUShapeRules,
} from './gpu-target.js';
import { BaseCompiler } from './base-compiler.js';

/**
 * WGSL-specific function overrides.
 *
 * These override the shared GPU functions for WGSL-specific naming
 * and syntax: `inverseSqrt`, `%` for mod, and `vec2f`/`vec3f`/`vec4f`
 * constructors.
 */
function compileWGSLList(
  args: ReadonlyArray<Expression>,
  compile: (expr: Expression) => string
) {
  assertGPUScalarComponents(
    args,
    args.length >= 2 && args.length <= 4 ? `vec${args.length}f` : 'array<f32>'
  );
  if (args.length === 2)
    return `vec2f(${args.map((x) => compile(x)).join(', ')})`;
  if (args.length === 3)
    return `vec3f(${args.map((x) => compile(x)).join(', ')})`;
  if (args.length === 4)
    return `vec4f(${args.map((x) => compile(x)).join(', ')})`;
  return `array<f32, ${args.length}>(${args
    .map((x) => compile(x))
    .join(', ')})`;
}

const WGSL_FUNCTIONS: CompiledFunctions<Expression> = {
  Inversesqrt: 'inverseSqrt',

  Mod: ([a, b], compile, target) => {
    if (a === null || b === null) throw new Error('Mod: missing argument');
    // WGSL `%` on floats is the *truncated* remainder (sign of the dividend);
    // the interpreter's `Mod` is *floored* (sign of the divisor, D1). Convert
    // truncated → floored with `((a % b) + b) % b`, matching the JS target.
    // `compile()` emits sub-expressions without outer parentheses, and `%`
    // binds tighter than `+` — wrap before splicing next to `%`.
    // An IMPURE operand (the Random family) must be evaluated exactly once:
    // the divisor is spliced three times and `_gpu_rnd_draw` advances a
    // runtime counter, so a repeated draw returns a different value AND
    // shifts every later draw in the shader. Bind scalars to hoisted
    // temporaries; where there is no statement sink (a conditional arm), or
    // an operand is not a scalar, there is no safe reading — decline
    // (see `Remainder` in the shared GPU target).
    if (a.isPure === false || b.isPure === false) {
      if (
        !BaseCompiler.canHoist(target) ||
        gpuOperandShape(a) !== 'scalar' ||
        gpuOperandShape(b) !== 'scalar'
      )
        throw new Error(
          'Mod: an impure (Random) operand cannot be bound to a ' +
            'temporary at this position — a repeated draw would shift every ' +
            'later value in the shader. Fail closed (D6).'
        );
      const ta = BaseCompiler.tempVar(target);
      const tb = BaseCompiler.tempVar(target);
      BaseCompiler.hoistStatement(
        target,
        `var ${ta}: f32 = ${compile(a)};`,
        `var ${tb}: f32 = ${compile(b)};`
      );
      return `(((${ta} % ${tb}) + ${tb}) % ${tb})`;
    }
    const ca = `(${compile(a)})`;
    const cb = `(${compile(b)})`;
    return `(((${ca} % ${cb}) + ${cb}) % ${cb})`;
  },

  // Override Hypot to use vec2f instead of vec2
  Hypot: ([x, y], compile) => {
    if (x === null || y === null) throw new Error('Hypot: need two arguments');
    return `length(vec2f(${compile(x)}, ${compile(y)}))`;
  },

  List: compileWGSLList,
  Matrix: (args, compile) =>
    compileGPUMatrix(
      args,
      compile,
      (n) => `vec${n}f`,
      (n) => `mat${n}x${n}f`,
      (n) => `array<f32, ${n}>`
    ),
  // Tuple compiles identically to List
  Tuple: compileWGSLList,
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
 * Where WGSL admits a SCALAR among otherwise-`vecN` operands — a much shorter
 * list than GLSL's.
 *
 * WGSL has no implicit scalar→vector promotion in its builtins: `min`, `max`,
 * `clamp`, `step` and `smoothstep` are declared as `(T, T)` / `(vecN<T>,
 * vecN<T>)` with no mixed form, so `max(vec3f, 2.0)` — valid GLSL — is not
 * valid WGSL. Only the two builtins whose scalar argument is part of the
 * signature survive: `mix(vecN<T>, vecN<T>, T)` and `refract(vecN<T>,
 * vecN<T>, T)`. (`Mod` is not affected: the WGSL target lowers it to the `%`
 * operator, which IS mixed-shape polymorphic.)
 *
 * In both of those the scalar is the THIRD argument and nowhere else, which is
 * what the 0-based slot sets record: `mix(vec3f, vec3f, 0.5)` compiles,
 * `mix(0.5, vec3f, vec3f)` does not. Strictly narrower than GLSL's table, as a
 * WGSL rule set must be.
 *
 * Arithmetic: WGSL defines `matN * matN`, `matN * vecN` and `matN * scalar`,
 * but matrix addition and subtraction ONLY between two matrices — `mat2x2f +
 * 2.0` has no overload, where GLSL applies it componentwise. Unary negation
 * (WGSL §8.7, "Unary arithmetic expressions") is declared over scalars and
 * `vecN` only, so `-mat2x2f(…)` is not valid source either — where GLSL
 * negates a matrix componentwise.
 */
const WGSL_SHAPE_RULES: GPUShapeRules = {
  scalarGenTypeSlots: new Map([
    ['mix', new Set([2])],
    ['refract', new Set([2])],
  ]),
  // `mix` has an all-genType overload (`mix(e1: vecN<T>, e2: vecN<T>, e3:
  // vecN<T>)`, WGSL §17.5) so its scalar third argument is a permission;
  // `refract` is declared ONLY `refract(e1: vecN<T>, e2: vecN<T>, e3: T)`, so
  // its third argument is an obligation.
  mandatoryScalarSlots: new Map([['refract', new Set([2])]]),
  // WGSL's geometric functions have no all-scalar form, where GLSL's genType
  // includes `float`: §17.5 declares `cross(e1: vec3<T>, e2: vec3<T>)`,
  // `dot(e1: vecN<T>, e2: vecN<T>)`, `faceForward(e1: vecN<T>, e2: vecN<T>,
  // e3: vecN<T>)`, `normalize(e: vecN<T>)`, `reflect(e1: vecN<T>, e2:
  // vecN<T>)` and `refract(e1: vecN<T>, e2: vecN<T>, e3: T)` — and nothing
  // else. So `refract(1.0, 2.0, 0.5)`, which GLSL accepts, is not WGSL source
  // at all. (`length` and `distance` ARE declared over a scalar as well as a
  // `vecN`, so they are absent. `faceForward` has no CE head today; it is
  // tabulated because the entry is a fact of the language, not of the
  // lowerings.)
  vectorOnlySlots: new Map([
    ['cross', new Set([0, 1])],
    ['dot', new Set([0, 1])],
    ['faceForward', new Set([0, 1, 2])],
    ['normalize', new Set([0])],
    ['reflect', new Set([0, 1])],
    ['refract', new Set([0, 1])],
  ]),
  matrixArithmetic: (sym, allMatrix) =>
    sym === '*' || (allMatrix && (sym === '+' || sym === '-')),
  matrixNegate: false,
};

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

  protected getShapeRules(): GPUShapeRules {
    return WGSL_SHAPE_RULES;
  }

  compileFunction(
    expr: Expression,
    functionName: string,
    returnType: string,
    parameters: Array<[name: string, type: string]>,
    options?: { constantFold?: boolean }
  ): string {
    // Both branches below put the body in a position that requires a VALUE:
    // the single-line one wraps it in `return`, the multi-line one relies on
    // the block hook having done so. A body whose value statement is an
    // assignment or a declaration has neither emission (D6) — WGSL
    // assignment is a STATEMENT, unlike GLSL (see `gpuAssertExpressionBody`).
    gpuAssertExpressionBody('compileFunction()', expr, this.languageId);
    // Compiled under the caller's declared parameter shapes, so the body
    // analysis agrees with the signature emitted below.
    const body = this.compileDeclaredFunctionBody(expr, parameters, options);

    const params = parameters
      .map(([name, type]) => `${name}: ${toWGSLType(type)}`)
      .join(', ');

    // A user-defined function the body calls is emitted once as its own WGSL
    // declaration. This route returns a complete declaration with no preamble
    // channel, so the whole preamble is prepended (WGSL needs no forward
    // declarations, but one ordering is kept across both shader languages).
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
      return `${userDefs}fn ${functionName}(${params}) -> ${toWGSLType(
        returnType
      )} {\n${indented}\n}`;
    }
    return `${userDefs}fn ${functionName}(${params}) -> ${toWGSLType(returnType)} {
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
    /** `false` disables compile-time constant folding of the body statements
     * (see `CompilationOptions.constantFold`). */
    constantFold?: boolean;
  }): string {
    const {
      type,
      inputs = [],
      outputs = [],
      uniforms = [],
      workgroupSize,
      body,
      constantFold,
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
      code += `@group(${group}) @binding(${binding}) var<uniform> ${
        uniform.name
      }: ${toWGSLType(uniform.type)};\n`;
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

    // Compile the body statements FIRST so the `_gpu_*` helper preamble they
    // reference can be spliced in ahead of the entry point — this route
    // returns a complete shader, with no separate `preamble` channel (see the
    // matching comment in the GLSL target). The whole body compiles against
    // ONE target, so random frames in different statements get DISTINCT
    // counters.
    // The declared inputs and uniforms are framed and bound for the body
    // analysis: nothing but these declarations carries their shader types (see
    // `compileShaderBody`). An INPUT is a field of the `VertexInput` struct the
    // entry point binds as `input`, so it is referenced `input.<name>` — a bare
    // `v` names nothing in a WGSL shader. A uniform is a module-scope global
    // and stays bare.
    const statements = this.compileShaderBody(
      body,
      type,
      [
        ...inputs.map((d) => ({
          name: d.name,
          type: d.type,
          ref: `input.${d.name}`,
        })),
        ...uniforms,
      ],
      constantFold
    );
    // Over the FULL emission: a helper may be referenced only from inside a
    // hoisted loop (Tycho item 110), and an undeclared helper is a shader that
    // fails to compile on the GPU.
    const preamble = this.preambleFor(
      statements.map((s) => [...s.stmts, s.code].join('\n')).join('\n')
    );
    if (preamble) code += `${preamble}\n`;

    code += `${stageAttr}\n${workgroupAttr}fn main(${paramStr})${returnStr} {\n`;

    if (hasOutputStruct) {
      code += `  var output: ${outputStructName};\n`;
    }

    for (const s of statements) {
      for (const stmt of s.stmts)
        code += stmt
          .split('\n')
          .map((l) => `  ${l}\n`)
          .join('');
      code += `  ${s.variable} = ${s.code};\n`;
    }

    if (hasOutputStruct) {
      code += '  return output;\n';
    }

    code += '}\n';

    return code;
  }
}
