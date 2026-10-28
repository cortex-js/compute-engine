import type { Expression } from '../global-types.js';
import type {
  CompiledFunctions,
  FieldFunctionOptions,
  FieldFunctionResult,
} from './types.js';
import {
  GPUShaderTarget,
  assertGPUInlineElementCount,
  compileGPUMatrix,
  assertGPUScalarComponents,
  gpuUniformVectorWidth,
  gpuOperandShape,
  gpuAbsorbedConstant,
  gpuFloorModCall,
  markOperandConsuming,
  gpuAssertExpressionBody,
  type GPUShapeRules,
} from './gpu-target.js';
import { BaseCompiler, isTailAssignmentBlock } from './base-compiler.js';
import { tryGetConstant } from './constant-folding.js';
import { gpuAmplifiedTrigMod } from './gpu-exact-trig.js';
import { isFunction, isSymbol } from '../boxed-expression/type-guards.js';
import { compileWGSLFieldFunction } from './wgsl-field-function.js';

/**
 * WGSL-specific function overrides.
 *
 * These override the shared GPU functions for WGSL-specific naming
 * and syntax: `inverseSqrt`, `%` for mod, and `vec2f`/`vec3f`/`vec4f`
 * constructors.
 */
function compileWGSLList(
  args: ReadonlyArray<Expression>,
  compile: (expr: Expression) => string,
  // The operator the literal was written with, named in the decline below
  head: 'List' | 'Tuple' | 'PointList' = 'List'
) {
  // A literal above the element limit of a shader array constructor is
  // declined, whatever its element shape, with a message that names the
  // operator and the count (`GPU_MAX_INLINE_ELEMENTS`).
  assertGPUInlineElementCount(head, args.length);
  // A list of points of one arity is an array of vectors.
  const vector = gpuUniformVectorWidth(args);
  if (vector !== undefined)
    return `array<vec${vector}f, ${args.length}>(${args
      .map((x) => compile(x))
      .join(', ')})`;
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

// Null-prototype: this table is indexed by an OPERATOR or SYMBOL NAME, and a
// name is arbitrary user text. A plain object literal inherits
// `Object.prototype`, so a name such as `toString`, `constructor` or
// `valueOf` reads the inherited member instead of missing — and because that
// value is a truthy function, the caller treats the symbol as though the
// target defined it. That made `Add(toString, 1)` refuse to compile as a
// bogus "built-in operator with no fixed arity" instead of compiling
// `toString` as an ordinary free symbol.
const WGSL_FUNCTIONS: CompiledFunctions<Expression> = {
  __proto__: null as never,
  Inversesqrt: 'inverseSqrt',

  Mod: ([a, b], compile, target) => {
    if (a === null || b === null)
      throw new Error('Could not compile `Mod`: missing argument');
    const plain = (): string => {
      // A divisor of exactly one is the fractional part: WGSL defines `fract(x)`
      // as `x - floor(x)`, which is the floored convention the interpreter's
      // `Mod` uses, so the two agree for a negative dividend as well
      // (`fract(-0.25)` is 0.75). It replaces the helper call below with a
      // built-in instruction, and it needs no impurity guard: the dividend is
      // emitted once.
      //
      // `fract` is applied twice. For a tiny negative dividend `x − floor(x)`
      // is `1 − |x|`, which rounds to 1.0 in f32 (`fract(-1e-20)` is 1.0),
      // outside the range [0, 1); the interpreter's `Mod` maps a result equal
      // to the divisor to 0. The second `fract` maps 1.0 to 0 and leaves every
      // other result unchanged. CE-511 (`CHANGELOG.md`).
      //
      // The divisor is left out of the emitted call, which the lowering
      // declares after this table (`markOperandConsuming`). So the
      // operand-shape check judges `fract(v)` against the dividend alone, and
      // a `vecN` dividend takes the peephole too.
      if (tryGetConstant(b) === 1) return `fract(fract(${compile(a)}))`;
      // The general case calls a `_gpu_fmod` helper, which turns WGSL's
      // truncated `%` into the interpreter's floored `Mod` and receives each
      // operand once (`gpuFloorModLibrary`, CE-512).
      const helper = gpuFloorModCall(a, b, compile, target);
      if (helper !== undefined) return helper;
      // A shape with no helper (a matrix, an array) keeps the same formula
      // inline, which splices each operand several times. An IMPURE operand
      // (the Random family, directly or through a symbol's value) would then
      // be drawn several times, and each `_gpu_rnd_draw` advances a runtime
      // counter, which shifts every later draw in the shader: decline.
      if (BaseCompiler.foldValueImpure(a) || BaseCompiler.foldValueImpure(b))
        throw new Error(
          'Could not compile `Mod`: an impure (Random) operand of this shape ' +
            'would be drawn more than once — a repeated draw would shift ' +
            'every later value in the shader.'
        );
      // `compile()` emits sub-expressions without outer parentheses, and `%`
      // binds tighter than `+` — wrap before splicing next to `%`.
      const ca = `(${compile(a)})`;
      const cb = `(${compile(b)})`;
      const p = `(sign(${ca} % ${cb}) * sign(${cb}))`;
      return `(((${ca} % ${cb}) - ${cb} * ((${p} - abs(${p})) * 0.5)) % ${cb})`;
    };
    // A trigonometric value amplified by a large constant (the "sine hash")
    // keeps the code above on WGSL, which has no exact form yet, and the
    // result gets a warning (`gpuAmplifiedTrigMod`).
    return (
      gpuAmplifiedTrigMod(
        'Mod',
        a,
        tryGetConstant(b) === 1,
        compile,
        target,
        gpuOperandShape,
        plain
      ) ?? plain()
    );
  },

  // Override Hypot to use vec2f instead of vec2
  Hypot: ([x, y], compile) => {
    if (x === null || y === null)
      throw new Error('Could not compile `Hypot`: need two arguments');
    return `length(vec2f(${compile(x)}, ${compile(y)}))`;
  },

  List: (args, compile) => compileWGSLList(args, compile, 'List'),
  Matrix: (args, compile) =>
    compileGPUMatrix(
      args,
      compile,
      (n) => `vec${n}f`,
      (n) => `mat${n}x${n}f`,
      (n) => `array<f32, ${n}>`
    ),
  // Tuple compiles identically to List
  Tuple: (args, compile) => compileWGSLList(args, compile, 'Tuple'),
  // A `PointList` that reaches this table is ONE point (the library handler
  // declines a collection-valued component before it gets here). A point is
  // a `vecNf` of floats, so every component must be a scalar. The check
  // comes first: without it, a point whose components are all complex would
  // take the list-of-points reading of `compileWGSLList` and emit an array of
  // `vec2f`.
  PointList: (args, compile) => {
    assertGPUScalarComponents(
      args,
      args.length >= 2 && args.length <= 4 ? `vec${args.length}f` : 'array<f32>'
    );
    return compileWGSLList(args, compile, 'PointList');
  },
};

// `Mod(a, 1)` emits `fract(fract(a))` and leaves the divisor out of the
// emitted call;
// the operand-shape check reads that declaration (`markOperandConsuming`).
markOperandConsuming(WGSL_FUNCTIONS.Mod, gpuAbsorbedConstant('fract', 1, 1));

/** Map common GLSL/MathJSON types to WGSL types */
const WGSL_TYPE_MAP: Record<string, string> = {
  float: 'f32',
  int: 'i32',
  uint: 'u32',
  bool: 'bool',
  vec2: 'vec2f',
  vec3: 'vec3f',
  vec4: 'vec4f',
  ivec2: 'vec2i',
  ivec3: 'vec3i',
  ivec4: 'vec4i',
  uvec2: 'vec2u',
  uvec3: 'vec3u',
  uvec4: 'vec4u',
  bvec2: 'vec2<bool>',
  bvec3: 'vec3<bool>',
  bvec4: 'vec4<bool>',
  mat2: 'mat2x2f',
  mat3: 'mat3x3f',
  mat4: 'mat4x4f',
};

function toWGSLType(type: string): string {
  return WGSL_TYPE_MAP[type] ?? type;
}

/**
 * ` @interpolate(flat)` for a vertex output or a fragment input (`interstage`)
 * of an integer scalar or vector type, else ''. WGSL requires the flat
 * interpolation for such a value between the two stages, and a shader without
 * it fails when the GPU compiles it.
 */
function flatIf(interstage: boolean, type: string): string {
  if (!interstage) return '';
  return /^(i32|u32|vec[234][iu]|vec[234]<[iu]32>)$/.test(
    toWGSLType(type.replace(/\s+/g, ''))
  )
    ? ' @interpolate(flat)'
    : '';
}

/**
 * The location, or binding, of each declaration of a list, in order. A
 * declaration that gives one keeps it. A declaration that gives none takes the
 * smallest number that no declaration of the list gives. WGSL refuses two
 * stage inputs (or two outputs) at one `@location`, and two resources at one
 * `@group`/`@binding`: such a shader fails only when the GPU compiles it, so
 * two declarations that give the same number are refused here. `key` gives the
 * space a number belongs to (the group of a binding).
 */
function assignSlots(
  what: string,
  decls: ReadonlyArray<{ name: string; slot: number | undefined; key?: number }>
): number[] {
  const used = new Map<string, string>();
  const slotKey = (key: number | undefined, slot: number) =>
    `${key ?? 0}:${slot}`;
  for (const d of decls) {
    if (d.slot === undefined) continue;
    const k = slotKey(d.key, d.slot);
    const other = used.get(k);
    if (other !== undefined)
      throw new Error(
        `Could not compile \`compileShader()\`: "${other}" and "${d.name}" ` +
          `have the same ${what} (${d.key === undefined ? '' : `group ${d.key}, `}` +
          `${d.slot}). WGSL refuses two declarations at one ${what}. ` +
          `Give each one its own ${what}, or leave it out to get a free one.`
      );
    used.set(k, d.name);
  }
  return decls.map((d) => {
    if (d.slot !== undefined) return d.slot;
    let slot = 0;
    while (used.has(slotKey(d.key, slot))) slot += 1;
    used.set(slotKey(d.key, slot), d.name);
    return slot;
  });
}

/**
 * The first name of `params` that `expr` assigns (`Assign(x, …)` with `x` in
 * `params`), at any depth, or `undefined` when it assigns none.
 */
function wgslAssignedParameter(
  expr: Expression,
  params: ReadonlySet<string>
): string | undefined {
  if (!isFunction(expr)) return undefined;
  if (
    expr.operator === 'Assign' &&
    isSymbol(expr.ops[0]) &&
    params.has(expr.ops[0].symbol)
  )
    return expr.ops[0].symbol;
  for (const op of expr.ops) {
    const found = wgslAssignedParameter(op, params);
    if (found !== undefined) return found;
  }
  return undefined;
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
 * vecN<T>, T)`. (`Mod` is not affected: the WGSL target calls the
 * `_gpu_fmod` helpers, and broadcasts a scalar operand beside a vector with
 * `vecNf(…)` itself; the inline formula for the other shapes uses the `%`
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
 * Whether `expr` is a `Block` whose last statement is a `Block` that ends,
 * at any depth of nested blocks, with an assignment to a name or a `Declare`
 * with an initializer (`isTailAssignmentBlock`): `Block(s ≔ x;
 * Block(t ≔ s + 1))`. The value of such a block is the value of that last
 * assignment.
 */
function isNestedTailAssignmentBlock(expr: Expression): boolean {
  if (!isFunction(expr, 'Block') || expr.nops === 0) return false;
  const last = expr.ops[expr.nops - 1];
  if (!isFunction(last, 'Block')) return false;
  return isTailAssignmentBlock(last) || isNestedTailAssignmentBlock(last);
}

/**
 * What `wgslFunctionBodyShape` found about a body before its compilation,
 * for `wgslAssertFunctionBody` to check the emitted body.
 */
type WGSLFunctionBodyShape = {
  tailAssignment: boolean;
  nestedTailAssignment: boolean;
};

/**
 * Decline a body that has no value before it is compiled, for an entry
 * point that puts the body in a WGSL function declaration
 * (`compileFunction()`, `compileFieldFunction()`). `subject` names the entry
 * point in the message.
 *
 * Both forms of the declaration put the body in a position that requires a
 * VALUE: a single-line body is wrapped in `return`, and a multi-line body
 * relies on the block hook to end it with `return`. A body whose value
 * statement is an assignment or a declaration has neither form (D6): WGSL
 * assignment is a STATEMENT, unlike GLSL (see `gpuAssertExpressionBody`).
 *
 * A block whose last statement is an assignment to a name, or a `Declare`
 * with an initializer (`isTailAssignmentBlock`), is not declined before it
 * is compiled: the block hook emits that statement followed by
 * `return <name>;` (`Block(s ≔ x; t ≔ s)` → `s = x;`, `t = s;`,
 * `return t;`), as `compile()` does for the same body. The emitted body is
 * checked instead (`wgslAssertFunctionBody`): a single-statement block with
 * no local is unwrapped to its statement and emits the single line `s = x`,
 * which stays declined.
 *
 * A block whose last statement is a nested block that ends with such an
 * assignment (`Block(s ≔ x; Block(t ≔ s + 1))`) is not declined before it is
 * compiled either. The block compilation gives the nested block a
 * temporary, which the nested block assigns last, and the outer block
 * returns it (`var _tv1: f32;`, `{ … _tv1 = t; }`, `return _tv1;`), as on
 * GLSL. The emitted body is checked for that final `return <name>;`.
 */
export function wgslFunctionBodyShape(
  subject: string,
  expr: Expression
): WGSLFunctionBodyShape {
  const tailAssignment = isTailAssignmentBlock(expr);
  const nestedTailAssignment =
    !tailAssignment && isNestedTailAssignmentBlock(expr);
  if (!tailAssignment && !nestedTailAssignment)
    gpuAssertExpressionBody(subject, expr, 'wgsl');
  return { tailAssignment, nestedTailAssignment };
}

/**
 * Decline the emitted `body` of a block that `wgslFunctionBodyShape`
 * accepted because it ends with an assignment. The body is accepted only
 * when its last line is `return <name>;` and, for an assignment, the line
 * before it is the assignment `<name> = …;`: when the block hook does not
 * recognize the assignment target, it puts `return` in front of the whole
 * assignment (`return a[0] = x;`), which is not valid WGSL.
 */
export function wgslAssertFunctionBody(
  subject: string,
  expr: Expression,
  body: string,
  shape: WGSLFunctionBodyShape
): void {
  const lines = body.split('\n');
  if (shape.tailAssignment) {
    const returned = /^return\s+([^\s;]+);?$/.exec(lines[lines.length - 1]);
    if (
      lines.length < 2 ||
      returned === null ||
      !lines[lines.length - 2].startsWith(`${returned[1]} = `)
    )
      gpuAssertExpressionBody(subject, expr, 'wgsl');
  }
  if (shape.nestedTailAssignment) {
    if (
      lines.length < 2 ||
      !/^return\s+[A-Za-z_]\w*;?$/.test(lines[lines.length - 1])
    )
      gpuAssertExpressionBody(subject, expr, 'wgsl');
  }
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

  protected getShapeRules(): GPUShapeRules {
    return WGSL_SHAPE_RULES;
  }

  /**
   * Compile `expr` to a scalar field function that a host compute shader
   * calls over a grid: `fn <name>(x: f32, y: f32, z: f32) -> f32`, with the
   * coordinates of `options.coordinates` as arguments.
   *
   * Every other free symbol is a parameter, read as
   * `<paramsVariable>.<symbol>` from one uniform struct. A symbol with a
   * value is a parameter too, unless it is a constant (`Pi`) or its value is
   * a function: the field function does not read its value in the engine.
   * The host declares
   * `@group(G) @binding(B) var<uniform> ce_params: CEParams;` (the names of
   * `paramsVariable` and `paramsStruct`), adds `paramsStructSource` and the
   * `helpers` to its module, and writes the parameter values at the offsets
   * of `params`. A real or integer scalar is an `f32`. A list of n numbers
   * (`list<number^n>`, n ≤ 1024) is `array<vec4f, ⌈n/4⌉>`, and element i is
   * read with the index rules of `At`. A change of a parameter value is a
   * buffer write, with no new compilation. A list with a `'storage-buffer'`
   * hint is read from its storage buffer, not from the struct: its struct
   * type and its `var<storage, read>` declaration are in `helpers` (under
   * the struct name and the buffer name) and its layout in
   * `storageBuffers`.
   *
   * The result is `success: false` with a `diagnostic` when `compile(expr,
   * { to: 'wgsl' })` declines the expression (with the same diagnostic), when
   * the body has no value to return (as for `compileFunction()`) or a
   * `Return` whose value is not a real scalar, when the body assigns a
   * coordinate or a parameter, when a user-defined function
   * reads a coordinate that it does not take as a parameter or declares the
   * name `paramsVariable`, when a parameter has no layout in the struct, or
   * when the value is not a real scalar. A helper name always has the same
   * source text, so the host can merge the `helpers` of several field
   * functions by name. The exception is the declaration of a storage
   * buffer: it has the same text only for the same hint and element type,
   * so a host gives each buffer name one hint in every field, and treats
   * two texts under one key as an error. A `name`, `paramsStruct`, `paramsVariable` or
   * coordinate that is not a WGSL identifier, or that is a reserved word or
   * a predeclared function or type of WGSL (`sin`, `vec4f`), throws.
   */
  compileFieldFunction(
    expr: Expression,
    options: FieldFunctionOptions
  ): FieldFunctionResult {
    return compileWGSLFieldFunction(
      {
        compile: (e, o) => this.compile(e, o),
        createTarget: () => this.createTarget(),
        withTargetExtension: (extension, fn) =>
          this.withTargetExtension(extension, fn),
        emittedUserFunctionNames: () => this.emittedUserFunctionNames(),
        bodyShape: (e) => wgslFunctionBodyShape('compileFieldFunction()', e),
        assertBody: (e, body, shape) =>
          wgslAssertFunctionBody(
            'compileFieldFunction()',
            e,
            body,
            shape as WGSLFunctionBodyShape
          ),
      },
      expr,
      options
    );
  }

  compileFunction(
    expr: Expression,
    functionName: string,
    returnType: string,
    parameters: Array<[name: string, type: string]>,
    options?: { constantFold?: boolean }
  ): string {
    // The body must have a value (`wgslFunctionBodyShape`).
    const shape = wgslFunctionBodyShape('compileFunction()', expr);
    // A WGSL function parameter is an immutable value, so an assignment to it
    // (`x = x + 1.0;` in `fn f(x: f32)`) is not valid source. GLSL passes a
    // parameter as a copy that the body can write, so only WGSL declines. The
    // test is conservative: an assignment to the same name inside a nested
    // function literal that binds the name again also declines.
    const assigned = wgslAssignedParameter(
      expr,
      new Set(parameters.map(([name]) => name))
    );
    if (assigned !== undefined)
      throw new Error(
        `Could not compile with \`compileFunction()\`: the body assigns the ` +
          `parameter "${assigned}", and a WGSL function parameter is an ` +
          `immutable value. Assign a local copy of it instead ` +
          `(\`Block(y ≔ ${assigned}; y ≔ y + 1; y)\`).`
      );
    // Compiled under the caller's declared parameter shapes, so the body
    // analysis agrees with the signature emitted below.
    const body = this.compileDeclaredFunctionBody(expr, parameters, options);
    wgslAssertFunctionBody('compileFunction()', expr, body, shape);

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

  /**
   * Assemble the declaration of a user-defined function that the shader
   * `userFunctions` registry of `compile()` emits (`h := x ↦ …` called as
   * `h(u)`).
   *
   * A WGSL function parameter is an immutable value, so a body that assigns
   * a parameter (`x = x + 1.0;` in `fn _fn_h(x: f32)`) is not valid source.
   * `compileFunction()` checks the body expression for such an assignment
   * (`wgslAssignedParameter`); this route receives only the compiled body, so
   * it checks the emitted source: a line that starts with `<parameter> = `
   * is an assignment to that parameter, since a WGSL comparison is spelled
   * `==`. The test is conservative: a write to a block local that has the
   * same name as a parameter also declines.
   */
  protected declareGPUFunction(
    name: string,
    returnType: string,
    params: ReadonlyArray<[name: string, type: string]>,
    body: string
  ): string {
    const lines = body.split('\n').map((l) => l.trimStart());
    for (const [p] of params)
      if (lines.some((l) => l.startsWith(`${p} = `)))
        throw new Error(
          `Could not compile \`${name}\`: the body assigns the parameter ` +
            `"${p}", and a WGSL function parameter is an immutable value. ` +
            `Assign a local copy of it instead ` +
            `(\`Block(y ≔ ${p}; y ≔ y + 1; y)\`).`
        );
    return super.declareGPUFunction(name, returnType, params, body);
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

    // A compute entry point has no stage outputs and no `@location` inputs:
    // WGSL refuses a return type on it, and its only inputs are built-in
    // values (`global_invocation_id`, ...). Such a shader fails when the GPU
    // compiles it, so it is refused here.
    if (type === 'compute') {
      if (outputs.length > 0)
        throw new Error(
          'Could not compile `compileShader()`: a WGSL compute shader has no ' +
            'stage outputs, and its entry point cannot return a value. ' +
            'Remove the `outputs` option.'
        );
      const located = inputs.filter((d) => !d.builtin).map((d) => d.name);
      if (located.length > 0)
        throw new Error(
          'Could not compile `compileShader()`: these compute shader ' +
            'inputs have no `builtin`: ' +
            `${located.map((n) => `"${n}"`).join(', ')}. ` +
            'A compute shader input must be a built-in value ' +
            '(`global_invocation_id`, `local_invocation_id`, ...); pass other ' +
            'values as uniforms.'
        );
    }

    // WGSL refuses `bool` in the uniform address space and at a
    // `@location` (neither is host-shareable): such a shader fails only when
    // the GPU compiles it.
    for (const [kind, decls] of [
      ['uniform', uniforms],
      ['input', inputs.filter((d) => !d.builtin)],
      ['output', outputs.filter((d) => !d.builtin)],
    ] as const) {
      const booleans = decls
        .filter((d) => /\bbool\b/.test(toWGSLType(d.type)))
        .map((d) => `"${d.name}"`);
      if (booleans.length > 0)
        throw new Error(
          `Could not compile \`compileShader()\`: the ${kind} ` +
            `${booleans.join(', ')} has a boolean type, which WGSL does not ` +
            `allow for a ${kind}. Use \`u32\` (or \`uint\`) with 0 and 1.`
        );
    }

    // A built-in value has no location: only the other declarations take one.
    const locations = (
      decls: ReadonlyArray<{ name: string; location?: number; builtin?: string }>
    ): Map<string, number> => {
      const located = decls.filter((d) => !d.builtin);
      const slots = assignSlots(
        'location',
        located.map((d) => ({ name: d.name, slot: d.location }))
      );
      return new Map(located.map((d, i) => [d.name, slots[i]]));
    };
    const inputLocations = locations(inputs);
    const outputLocations = locations(outputs);
    const uniformBindings = assignSlots(
      'binding',
      uniforms.map((d) => ({
        name: d.name,
        slot: d.binding,
        key: d.group ?? 0,
      }))
    );

    let code = '';

    // The input struct is named for its stage (`VertexInput`,
    // `FragmentInput`, `ComputeInput`). The host does not read this name: the
    // pipeline binds the fields by location or built-in.
    const inputStructName = `${type[0].toUpperCase()}${type.slice(1)}Input`;

    // Generate input struct
    if (inputs.length > 0) {
      code += `struct ${inputStructName} {\n`;
      for (const input of inputs) {
        const attr = input.builtin
          ? `@builtin(${input.builtin})`
          : `@location(${inputLocations.get(input.name)})${flatIf(
              type === 'fragment',
              input.type
            )}`;
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
          : `@location(${outputLocations.get(output.name)})${flatIf(
              type === 'vertex',
              output.type
            )}`;
        code += `  ${attr} ${output.name}: ${toWGSLType(output.type)},\n`;
      }
      code += '};\n\n';
    }

    // Generate uniform bindings
    for (const [i, uniform] of uniforms.entries()) {
      const group = uniform.group ?? 0;
      const binding = uniformBindings[i];
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

    const paramStr = hasInputStruct ? `input: ${inputStructName}` : '';
    const returnStr = hasOutputStruct ? ` -> ${outputStructName}` : '';

    // Compile the body statements FIRST so the `_gpu_*` helper preamble they
    // reference can be spliced in ahead of the entry point — this route
    // returns a complete shader, with no separate `preamble` channel (see the
    // matching comment in the GLSL target). The whole body compiles against
    // ONE target, so random frames in different statements get DISTINCT
    // counters.
    // The declared inputs and uniforms are framed and bound for the body
    // analysis: nothing but these declarations carries their shader types (see
    // `compileShaderBody`). An INPUT is a field of the stage input struct the
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
