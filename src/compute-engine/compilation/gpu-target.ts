import type { Expression } from '../global-types.js';
import {
  isFunction,
  isNumber,
  isString,
  isSymbol,
} from '../boxed-expression/type-guards.js';
import { parseColor, rgbToOklch } from '@arnog/colors';
import {
  tryGetConstant,
  foldTerms,
  tryGetComplexParts,
  formatFloat,
  gpuNonFiniteLiteral,
  parenthesizeFactor,
  negativeBaseRealPow,
  principalComplexPow,
} from './constant-folding.js';

import type {
  CompileTarget,
  CompiledOperators,
  CompiledFunction,
  CompiledFunctions,
  LanguageTarget,
  CompilationOptions,
  CompilationResult,
} from './types.js';
import { BaseCompiler, pointHasBroadcastComponent } from './base-compiler.js';
import { isNonRealNumber } from '../../common/type/utils.js';
import { isSubtype } from '../../common/type/subtype.js';
import type { Type } from '../../common/type/types.js';
import { isRelationalOperator } from '../latex-syntax/utils.js';
import { rewriteAngularUnit } from './angular-unit.js';
import { foldSeed } from '../numerics/random.js';

/**
 * GPU shader operators shared by GLSL and WGSL.
 *
 * Both languages use identical C-style operators for arithmetic,
 * comparison, and logical operations.
 */
export const GPU_OPERATORS: CompiledOperators = {
  Add: ['+', 11],
  Negate: ['-', 14],
  Subtract: ['-', 11], // Subtract canonicalizes to Add+Negate; kept as fallback
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
 * GLSL reserved keywords (ES 3.x + desktop) and reserved-for-future-use words.
 * A user variable carrying one of these names cannot be emitted as a bare
 * identifier — the shader would fail to compile — so the target fails closed
 * (D6) rather than silently emit invalid source. Includes type/qualifier
 * keywords, control-flow keywords, and common built-in function names that a
 * bare reference would shadow/collide with (`texture`, `sample`, …).
 */
const GLSL_RESERVED: ReadonlySet<string> = new Set([
  // storage/parameter qualifiers
  'attribute',
  'const',
  'uniform',
  'varying',
  'buffer',
  'shared',
  'coherent',
  'volatile',
  'restrict',
  'readonly',
  'writeonly',
  'layout',
  'centroid',
  'flat',
  'smooth',
  'noperspective',
  'patch',
  'sample',
  'in',
  'out',
  'inout',
  'precision',
  'invariant',
  'precise',
  'subroutine',
  // control flow
  'break',
  'continue',
  'do',
  'for',
  'while',
  'switch',
  'case',
  'default',
  'if',
  'else',
  'discard',
  'return',
  // scalar/vector/matrix types
  'void',
  'bool',
  'int',
  'uint',
  'float',
  'double',
  'vec2',
  'vec3',
  'vec4',
  'dvec2',
  'dvec3',
  'dvec4',
  'bvec2',
  'bvec3',
  'bvec4',
  'ivec2',
  'ivec3',
  'ivec4',
  'uvec2',
  'uvec3',
  'uvec4',
  'mat2',
  'mat3',
  'mat4',
  'mat2x2',
  'mat2x3',
  'mat2x4',
  'mat3x2',
  'mat3x3',
  'mat3x4',
  'mat4x2',
  'mat4x3',
  'mat4x4',
  'dmat2',
  'dmat3',
  'dmat4',
  // opaque/sampler types
  'sampler2D',
  'sampler3D',
  'samplerCube',
  'sampler2DArray',
  'sampler2DShadow',
  'samplerCubeShadow',
  'isampler2D',
  'usampler2D',
  'atomic_uint',
  'image2D',
  // literals
  'true',
  'false',
  // reserved-for-future-use / common built-ins that a bare var would collide with
  'filter',
  'texture',
  'asm',
  'union',
  'enum',
  'typedef',
  'template',
  'this',
  'packed',
  'goto',
  'inline',
  'noinline',
  'public',
  'static',
  'extern',
  'external',
  'interface',
  'long',
  'short',
  'half',
  'fixed',
  'unsigned',
  'superp',
  'input',
  'output',
  'hvec2',
  'hvec3',
  'hvec4',
  'fvec2',
  'fvec3',
  'fvec4',
  'sizeof',
  'cast',
  'namespace',
  'using',
]);

/**
 * WGSL reserved words + keywords. As with GLSL, a user variable matching one of
 * these cannot be emitted bare; the target fails closed (D6).
 */
const WGSL_RESERVED: ReadonlySet<string> = new Set([
  // keywords
  'alias',
  'break',
  'case',
  'const',
  'const_assert',
  'continue',
  'continuing',
  'default',
  'diagnostic',
  'discard',
  'else',
  'enable',
  'false',
  'fn',
  'for',
  'if',
  'let',
  'loop',
  'override',
  'requires',
  'return',
  'struct',
  'switch',
  'true',
  'var',
  'while',
  // types / type-generators
  'bool',
  'f16',
  'f32',
  'i32',
  'u32',
  'vec2',
  'vec3',
  'vec4',
  'vec2f',
  'vec3f',
  'vec4f',
  'vec2i',
  'vec3i',
  'vec4i',
  'vec2u',
  'vec3u',
  'vec4u',
  'mat2x2',
  'mat2x3',
  'mat2x4',
  'mat3x2',
  'mat3x3',
  'mat3x4',
  'mat4x2',
  'mat4x3',
  'mat4x4',
  'array',
  'atomic',
  'ptr',
  'sampler',
  'sampler_comparison',
  'texture_1d',
  'texture_2d',
  'texture_2d_array',
  'texture_3d',
  'texture_cube',
  'texture_cube_array',
  'texture_multisampled_2d',
  // address spaces / builtins that a bare var would collide with
  'function',
  'private',
  'workgroup',
  'uniform',
  'storage',
  'read',
  'write',
  'read_write',
  'texture',
  'sample',
  'filter',
  // reserved words (subset of the WGSL reserved list)
  'as',
  'async',
  'attribute',
  'auto',
  'binding',
  'cast',
  'compile',
  'do',
  'enum',
  'extern',
  'external',
  'inline',
  'instance',
  'interface',
  'match',
  'namespace',
  'new',
  'null',
  'of',
  'operator',
  'public',
  'reference',
  'self',
  'set',
  'shared',
  'static',
  'super',
  'template',
  'this',
  'typedef',
  'union',
  'unless',
  'using',
  'virtual',
  'where',
]);

/** The reserved-word set for a GPU shader language, or an empty set. */
function gpuReservedWords(language?: string): ReadonlySet<string> {
  if (language === 'wgsl') return WGSL_RESERVED;
  if (language === 'glsl') return GLSL_RESERVED;
  return new Set();
}

/**
 * Fail closed (D6) if `id` is a reserved word in the target shader language.
 * A user variable / loop index carrying a reserved name would emit source that
 * fails to compile on the GPU — surface a clear diagnostic instead. Returns the
 * identifier unchanged when it is safe.
 */
function gpuCheckIdentifier(id: string, language?: string): string {
  if (gpuReservedWords(language).has(id))
    throw new Error(
      `"${id}" is a reserved word in ${language ?? 'this shader language'} and cannot be used as a variable name. Rename it before compiling to a GPU target (fail closed, D6).`
    );
  return id;
}

/** Return the vec2 constructor name for the target language. */
function gpuVec2(target?: CompileTarget<Expression>): string {
  return target?.language === 'wgsl' ? 'vec2f' : 'vec2';
}

/**
 * The principal complex power of two real constants, as a shader `vec2(re, im)`
 * literal — the fold for a `Power`/`Root` node whose TYPE is complex (a
 * negative base whose reduced-rational exponent has an even denominator).
 *
 * `Complex.pow` is the routine `_gpu_cpow`'s host-side counterpart and the
 * interpreter both use, so the folded constant is the value the uncompiled
 * expression produces (down to shader float precision).
 */
function gpuComplexPowLiteral(
  base: number,
  exp: number,
  target?: CompileTarget<Expression>
): string {
  const r = principalComplexPow(base, exp);
  return `${gpuVec2(target)}(${formatFloat(r.re, target?.language)}, ${formatFloat(
    r.im,
    target?.language
  )})`;
}

/** Return the vec3 constructor name for the target language. */
function gpuVec3(target?: CompileTarget<Expression>): string {
  return target?.language === 'wgsl' ? 'vec3f' : 'vec3';
}

/**
 * Fail closed (D6) on a color constructor given a 4th (alpha) operand.
 *
 * The whole `_gpu_*` color chain — `srgb_to_oklch`, `oklch_to_srgb`,
 * `hsl_to_rgb`, `hsv_to_rgb`, `oklab_to_oklch`, … — is `vec3` end to end, and
 * alpha is orthogonal to color-space conversion, so there is no vec4 form to
 * lower to. Emitting the 3-component value would silently DROP the alpha the
 * JavaScript target preserves, so decline instead and let the caller pass
 * alpha separately.
 */
function assertNoGPUAlpha(
  head: string,
  args: ReadonlyArray<Expression>
): void {
  if (args.length <= 3) return;
  throw new Error(
    `${head}: an alpha (4th) operand is not representable on the GPU target — ` +
      `color values are \`vec3\` (OKLCh) end to end, with no alpha channel. ` +
      `Drop the alpha operand and pass it separately (e.g. as a uniform) at ` +
      `the framebuffer boundary. Fail closed (D6).`
  );
}

/**
 * Whether applying `head` to `args` produces a complex value — the SAME signal
 * `BaseCompiler.isComplexValued` reports to the ENCLOSING expression for this
 * node.
 *
 * A handler that picks its real-vs-complex lowering from the ARGUMENT alone can
 * disagree with its own parent. With `a := -2`, `Sqrt(a)` is typed `complex`
 * (the type handler reads the assigned value's sign) while the operand `a` is
 * typed `integer`: the parent emits the `vec2(re, im)` convention around a
 * scalar `sqrt(-2.0)`, and shader scalar-broadcast makes that a silent
 * `vec2(NaN, NaN)` rather than a compile error.
 *
 * The node is rebuilt STRUCTURALLY (bound, not canonicalized) so its head and
 * operands are the ones being lowered, and its type is therefore the type the
 * parent read. A wide result type (`number`, as `Power`/`Root`/`Arcsin` have)
 * is NOT complex — those project to NaN, matching their real lowering.
 */
function gpuResultIsComplexValued(
  head: string,
  args: ReadonlyArray<Expression>
): boolean {
  const engine = args[0]?.engine;
  if (engine === undefined) return false;
  try {
    const t = engine.function(head, [...args], { structural: true }).type;
    return isNonRealNumber(t.type);
  } catch {
    return false;
  }
}

/**
 * An operand as `vec2(re, im)` source, lifting a real-emitted operand to
 * `vec2(x, 0.0)`. The `_gpu_c…` helpers take a `vec2`; handing one a scalar is
 * not valid shader source.
 */
function gpuComplexOperand(
  x: Expression,
  compile: (expr: Expression) => string,
  target?: CompileTarget<Expression>
): string {
  if (BaseCompiler.isComplexValued(x)) return compile(x);
  return `${gpuVec2(target)}(${compile(x)}, 0.0)`;
}

/**
 * Compile an operand the caller will splice MORE THAN ONCE into its emitted
 * source. A pure operand compiles directly (byte-identical to `compile(x)`
 * for the common case); an IMPURE one (the Random family — `_gpu_rnd_draw`
 * advances a runtime counter, so a repeated splice re-draws and shifts every
 * later value in the shader) is bound to a hoisted temporary, or the head
 * declines where no statement sink is available. `complex` selects a
 * `vec2`/`vec2f` temporary (a complex operand has no scalar shape, so the
 * scalar-shape gate is skipped there — `canHoist` is the applicable gate).
 */
function gpuOperandOnce(
  head: string,
  x: Expression,
  compile: (expr: Expression) => string,
  target: CompileTarget<Expression>,
  complex = false
): string {
  if (x.isPure !== false) return compile(x);
  if (
    !BaseCompiler.canHoist(target) ||
    (!complex && gpuOperandShape(x) !== 'scalar')
  )
    throw new Error(
      `${head}: an impure (Random) operand cannot be bound to a temporary ` +
        'at this position — a repeated draw would shift every later value ' +
        'in the shader. Fail closed (D6).'
    );
  const t = BaseCompiler.tempVar(target);
  const type = complex
    ? gpuVec2(target)
    : target.language === 'wgsl'
      ? 'f32'
      : 'float';
  const decl = target.language === 'wgsl' ? `var ${t}: ${type}` : `${type} ${t}`;
  BaseCompiler.hoistStatement(target, `${decl} = ${compile(x)};`);
  return t;
}

/**
 * The complex lowering of a RECIPROCAL inverse head (`Arcsec`, `Arccsc`,
 * `Arsech`, `Arcoth`), as `helper(1 / z)`.
 *
 * There is no direct `_gpu_casec`/`_gpu_cacsc`/`_gpu_casech`/`_gpu_cacoth`
 * preamble helper, so this is the complex lift of the head's OWN real lowering
 * (`acos(1/x)`, `asin(1/x)`, `acosh(1/x)`, `atanh(1/x)`). The composition is
 * the principal value — checked against `Complex.asec`/`acsc`/`asech`/`acoth`
 * at real in-domain, real out-of-domain and general complex points.
 */
function gpuReciprocalComplex(
  helper: string,
  x: Expression,
  compile: (expr: Expression) => string,
  target?: CompileTarget<Expression>
): string {
  const v2 = gpuVec2(target);
  return `${helper}(_gpu_cdiv(${v2}(1.0, 0.0), ${gpuComplexOperand(x, compile, target)}))`;
}

/**
 * Emit a NaN value valid for the target shader language.
 *
 * Neither GLSL nor WGSL has a `NaN` identifier (the base compiler's default
 * `If`/`Which`/`When` emit a bare `NaN`, which fails to compile on GPU). WGSL
 * rejects a constant `0.0 / 0.0` during const-evaluation, so it uses a NaN bit
 * pattern inline. GLSL routes through the `_gpu_nan()` preamble helper (see
 * `GPU_NAN_PREAMBLE_GLSL`): a masked (`When`/`Which` else) branch's NaN is thus
 * centralized in one overridable symbol, so a host can redefine what a masked
 * branch produces without touching the generated code.
 *
 * The spelling itself lives in `gpuNonFiniteLiteral` (`constant-folding.ts`),
 * shared with the non-finite LITERAL path (`formatGPUNumber`/`formatFloat`) so
 * a `NaN` constant and a masked branch produce the same symbol.
 */
function gpuNaN(target?: CompileTarget<Expression>): string {
  return gpuNonFiniteLiteral(NaN, target?.language);
}

/**
 * Number of vector components a value expression occupies on the GPU (2–4),
 * or `undefined` for a scalar. Structural for `Tuple`/`List` literals (the
 * parametric-body shape `(x(t), y(t))` → `vec2`), type-based for typed
 * operands (`tuple<…>`, a 1-axis `list`), and 2 for a complex value (lowered
 * as `vec2(re, im)`).
 */
function gpuComponentCount(expr: Expression | null): 2 | 3 | 4 | undefined {
  return BaseCompiler.vectorComponentCount(expr);
}

/**
 * Guard the `vecN(…)` lowering of a `Tuple`/`List` literal: every element must
 * be a SCALAR, so the constructor's argument count is its component count.
 *
 * A vector-valued element (a complex component — lowered as `vec2(re, im)` —
 * or a nested tuple) contributes 2+ components, so `(t, i·t)` would emit
 * `vec2(t, vec2(0.0, t))`: three components into a two-component constructor,
 * which a driver rejects with "constructor: too many arguments". Neither is
 * there a correct flattening — a tuple whose element is complex is not a GPU
 * vector — so fail closed (D6) with a diagnostic naming the shape instead of
 * emitting shader source that cannot compile.
 *
 * The check is on AGGREGATE-ness, not on having a `vecN` lowering: a 1- or
 * 5-element list element (`(⟦1⟧, 2)` → `vec2(float[1](1.0), 2.0)`) is just as
 * invalid, and asking `gpuComponentCount` — which reports `undefined` for
 * those widths — would wave them through. It is on being provably NON-SCALAR,
 * not on having a component count: a `Matrix` element has no single count, but
 * `(mat2(…), 1)` → `vec2(mat2(…), 1.0)` is exactly as unacceptable to a driver.
 *
 * Also rejects the EMPTY constructor: an empty tuple/list would lower to
 * `float[0]()` / `array<f32, 0>()`, and neither language has a zero-length
 * array type.
 */
export function assertGPUScalarComponents(
  args: ReadonlyArray<Expression>,
  ctor: string
): void {
  if (args.length === 0)
    throw new Error(
      `${ctor}: an empty tuple/list has no GPU lowering — neither GLSL nor ` +
        `WGSL has a zero-length array type. Fail closed.`
    );
  for (const arg of args) {
    if (!BaseCompiler.isNonScalarShape(arg)) continue;
    const n = BaseCompiler.aggregateComponentCount(arg);
    const shape =
      n === undefined
        ? 'a matrix/tensor value'
        : `${n} component${n === 1 ? '' : 's'} — a complex value or a ` +
          `nested tuple/list`;
    throw new Error(
      `${ctor}: a tuple/list element that is itself vector-valued ` +
        `(${shape}) has no GPU ` +
        `lowering; a ${ctor} constructor takes scalar components. Fail closed.`
    );
  }
}

/**
 * A NaN matching the SHAPE of `val`: scalar NaN for a scalar value, a
 * broadcast vector constructor (`vec2(_gpu_nan())` / `vec2f(bitcast<…>)`)
 * for a vector-valued one. GLSL has no implicit float→vecN conversion in a
 * ternary, so a masked (`When`/`Which` else) branch whose value is a tuple
 * body (a restricted parametric `(x(t), y(t))`) must emit a NaN of the same
 * component count or the driver rejects the shader (Tycho item 49). WGSL's
 * `select` likewise requires both operands to share one type.
 */
function gpuNaNFor(
  val: Expression | null,
  target?: CompileTarget<Expression>
): string {
  const n = gpuComponentCount(val);
  if (n === undefined) return gpuNaN(target);
  const ctor = target?.language === 'wgsl' ? `vec${n}f` : `vec${n}`;
  return `${ctor}(${gpuNaN(target)})`;
}

/**
 * Compile a **conditionally-evaluated** operand of a GPU conditional — an
 * `If`/`When`/`Which`/`Match` arm, or a `Which` condition past the first —
 * with hoisting forbidden.
 *
 * GLSL's `?:` short-circuits: an arm runs only when it is selected. A lowering
 * that hoists statements (the loop form of `Sum`/`Product`, Tycho item 110)
 * would move that work OUT of the conditional, where it runs unconditionally.
 * That is not merely a cost: `_gpu_rnd_draw(seed, inout uint n)` advances a
 * RUNTIME counter, so a loop stranded ahead of a ternary it never feeds shifts
 * the value of every later draw in the shader — a silent disagreement with the
 * interpreter, which evaluates only the taken branch. Fail closed (D6); the
 * caller falls back to interpretation, exactly as it did before hoisting
 * existed.
 *
 * (WGSL's `select` is a function, so both operands ARE evaluated there — but
 * the emission is shared and the counter-ordering hazard is the same, so the
 * guard is not language-gated.)
 */
function compileGPUConditionalArm(
  head: string,
  compiled: () => string,
  target: CompileTarget<Expression>
): string {
  const sink = BaseCompiler.canHoist(target) ? target.hoist : undefined;
  const before = sink?.stmts.length ?? 0;
  const code = compiled();
  if (sink !== undefined && sink.stmts.length > before) {
    // Drop the escaped statements: the throw is recoverable (the engine-level
    // `compile()` catches it to build the interpreter fallback) and a caller
    // reusing the target must not inherit orphaned code.
    sink.stmts.length = before;
    throw new Error(
      `${head}: a conditionally-evaluated branch contains a multi-statement ` +
        `construct (a loop-form Sum/Product). Hoisting it out of the branch ` +
        `would run it unconditionally — a shader conditional is an expression, ` +
        `not a statement — which changes the result whenever the branch draws ` +
        `from the random stream. Fail closed (D6).`
    );
  }
  return code;
}

/**
 * Emit a conditional `cond ? whenTrue : whenFalse` for the target language.
 *
 * GLSL has the ternary operator; WGSL does not and uses
 * `select(false_value, true_value, condition)` instead.
 */
function gpuConditional(
  cond: string,
  whenTrue: string,
  whenFalse: string,
  target?: CompileTarget<Expression>
): string {
  if (target?.language === 'wgsl')
    return `select(${whenFalse}, ${whenTrue}, ${cond})`;
  return `((${cond}) ? (${whenTrue}) : (${whenFalse}))`;
}

/** Componentwise comparison builtins (GLSL) / operators (WGSL). */
const GPU_COMPARE_GLSL: Readonly<Record<string, string>> = {
  Less: 'lessThan',
  LessEqual: 'lessThanEqual',
  Greater: 'greaterThan',
  GreaterEqual: 'greaterThanEqual',
  Equal: 'equal',
  NotEqual: 'notEqual',
};
const GPU_COMPARE_WGSL: Readonly<Record<string, string>> = {
  Less: '<',
  LessEqual: '<=',
  Greater: '>',
  GreaterEqual: '>=',
  Equal: '==',
  NotEqual: '!=',
};

/** The boolean-vector (`bvecN` / `vecN<bool>`) type name for the target. */
function gpuBVec(n: number, target?: CompileTarget<Expression>): string {
  return target?.language === 'wgsl' ? `vec${n}<bool>` : `bvec${n}`;
}

/** The float-vector (`vecN` / `vecNf`) type name for the target. */
function gpuFVec(n: number, target?: CompileTarget<Expression>): string {
  return target?.language === 'wgsl' ? `vec${n}f` : `vec${n}`;
}

/** True when `expr` is a `Tuple` literal or is tuple-typed. */
function gpuIsTupleShaped(expr: Expression): boolean {
  if (isFunction(expr, 'Tuple')) return true;
  const t = expr.type.type;
  return typeof t !== 'string' && t.kind === 'tuple';
}

/** Fail closed (D6) on a shape the element-wise selection cannot render. */
function gpuSelectionDecline(reason: string): never {
  throw new Error(`Which: ${reason} Fail closed (D6).`);
}

/**
 * Width (2–4) of a `Which` CONDITION lowered element-wise on a GPU target, or
 * `undefined` when the condition is a plain shader scalar. Throws (D6) for a
 * non-scalar condition with no static `vec2`–`vec4` shape — the case that used
 * to emit garbage such as `u_L == 3.0` behind `success: true`.
 */
function gpuSelectionConditionWidth(c: Expression): 2 | 3 | 4 | undefined {
  // `True` marks the default clause; `False` is a scalar (never-taken) mask.
  if (isSymbol(c, 'True') || isSymbol(c, 'False')) return undefined;

  if (isFunction(c, 'List')) {
    for (const cell of c.ops) {
      // A cell that is provably a SCALAR boolean lowers as its own scalar
      // condition inside the `bvecN`/`vecN<bool>` constructor — a literal
      // `True`/`False`, or a scalar comparison such as `x < 0`. Anything
      // else declines: the interpreter selects only when every cell
      // evaluates to a boolean, and a non-scalar cell has no single slot.
      if (isSymbol(cell, 'True') || isSymbol(cell, 'False')) continue;
      if (
        BaseCompiler.isBooleanValued(cell) &&
        !BaseCompiler.isComplexValued(cell) &&
        !BaseCompiler.isNonScalarShape(cell)
      )
        continue;
      gpuSelectionDecline(
        `a literal list condition needs provably boolean scalar cells ` +
          `(\`True\`/\`False\` or a scalar comparison); the cell ` +
          `\`${cell.toString()}\` is not one, and the interpreter only ` +
          `selects when every cell evaluates to a boolean.`
      );
    }
    const n = c.nops;
    if (n < 2 || n > 4)
      gpuSelectionDecline(
        `a ${n}-element list condition has no GPU vector lowering (only ` +
          `vec2–vec4 are shader values).`
      );
    return n as 2 | 3 | 4;
  }

  const h = c.operator;
  const ops: ReadonlyArray<Expression> = isFunction(c) ? c.ops : [];
  if (isRelationalOperator(h)) {
    let width: 2 | 3 | 4 | undefined = undefined;
    for (const op of ops) {
      // A complex value is ALSO lowered as a `vec2`, so it must be recognized
      // BEFORE the width or it masquerades as a 2-cell collection.
      if (BaseCompiler.isComplexValued(op))
        gpuSelectionDecline(
          `a complex-valued operand (\`${op.toString()}\`) in an element-wise ` +
            `condition is lowered as a \`vec2\` of (re, im), which has no cell ` +
            `meaning in a selection.`
        );
      if (gpuIsTupleShaped(op))
        gpuSelectionDecline(
          `a tuple operand (\`${op.toString()}\`) in an element-wise condition ` +
            `has no element-wise reading — the interpreter binds a tuple ` +
            `atomically.`
        );
      const w = BaseCompiler.vectorComponentCount(op);
      if (w === undefined) {
        if (BaseCompiler.isNonScalarShape(op))
          gpuSelectionDecline(
            `the condition operand \`${op.toString()}\` is not a shader scalar ` +
              `and has no static vec2–vec4 shape (an unknown-length list, a ` +
              `matrix, or a 5+-element list).`
          );
        continue;
      }
      if (width !== undefined && width !== w)
        gpuSelectionDecline(
          `an element-wise condition mixes vec${width} and vec${w} operands.`
        );
      width = w;
    }
    if (width === undefined) return undefined;
    if ((h === 'Equal' || h === 'NotEqual') && ops.length > 2)
      gpuSelectionDecline(
        `an n-ary \`${h}\` over a collection operand has no faithful ` +
          `element-wise lowering — the interpreter's n-ary form switches shape ` +
          `on how many operands are collections at run time, so no pairwise ` +
          `conjunction matches it.`
      );
    if (GPU_COMPARE_GLSL[h] === undefined)
      gpuSelectionDecline(
        `the relation \`${h}\` has no componentwise shader form.`
      );
    return width;
  }

  if (h === 'And' || h === 'Or' || h === 'Not') {
    let width: 2 | 3 | 4 | undefined = undefined;
    for (const op of ops) {
      const w = gpuSelectionConditionWidth(op);
      if (w === undefined) continue;
      if (width !== undefined && width !== w)
        gpuSelectionDecline(
          `an element-wise \`${h}\` mixes vec${width} and vec${w} operands.`
        );
      width = w;
    }
    return width;
  }

  // A complex-valued condition is a scalar-side value (its `vec2` is (re, im),
  // not two cells): left exactly as it is today.
  if (BaseCompiler.isComplexValued(c)) return undefined;
  const w = BaseCompiler.vectorComponentCount(c);
  if (w !== undefined) {
    // A value used DIRECTLY as a boolean-vector condition (e.g. a `vars`-mapped
    // `bvec` uniform). Anything else with a vector shape is a numeric vector,
    // which is not a condition.
    if (!c.type.matches('indexed_collection<boolean>'))
      gpuSelectionDecline(
        `the condition \`${c.toString()}\` is a collection of ` +
          `\`${c.type.toString()}\`, not of booleans.`
      );
    return w;
  }
  if (BaseCompiler.isNonScalarShape(c))
    gpuSelectionDecline(
      `the condition \`${c.toString()}\` is not a shader scalar and has no ` +
        `static vec2–vec4 shape.`
    );
  return undefined;
}

/** Conjoin boolean-vector masks componentwise. */
function gpuMaskAnd(
  masks: ReadonlyArray<string>,
  n: 2 | 3 | 4,
  target: CompileTarget<Expression>
): string {
  if (masks.length === 1) return masks[0];
  if (target.language === 'wgsl') return `(${masks.join(' & ')})`;
  // GLSL has no componentwise `&&`: convert to 0/1 floats, multiply, and let
  // the `bvecN` constructor read nonzero back as `true`.
  const f = gpuFVec(n, target);
  return `${gpuBVec(n, target)}(${masks.map((m) => `${f}(${m})`).join(' * ')})`;
}

/** Disjoin boolean-vector masks componentwise. */
function gpuMaskOr(
  masks: ReadonlyArray<string>,
  n: 2 | 3 | 4,
  target: CompileTarget<Expression>
): string {
  if (masks.length === 1) return masks[0];
  if (target.language === 'wgsl') return `(${masks.join(' | ')})`;
  const f = gpuFVec(n, target);
  return `${gpuBVec(n, target)}(${masks.map((m) => `${f}(${m})`).join(' + ')})`;
}

/**
 * Emit a `bvecN` / `vecN<bool>` mask for one `Which` condition.
 *
 * Boolean vectors — NOT float masks: a float `mix(a, b, t)` computes
 * `a·(1−t) + b·t`, so a NaN in the unselected operand poisons the result
 * (`mix(NaN, x, 1.0)` is NaN). The `genBType` `mix` / WGSL `select` overloads
 * are true per-component SELECTION and are therefore NaN-safe.
 */
function gpuSelectionMask(
  c: Expression,
  n: 2 | 3 | 4,
  compile: (e: Expression) => string,
  target: CompileTarget<Expression>
): string {
  const bvec = gpuBVec(n, target);
  const fvec = gpuFVec(n, target);

  if (isSymbol(c, 'True')) return `${bvec}(true)`;
  if (isSymbol(c, 'False')) return `${bvec}(false)`;

  if (isFunction(c, 'List'))
    return `${bvec}(${c.ops
      .map((x) =>
        isSymbol(x, 'True')
          ? 'true'
          : isSymbol(x, 'False')
            ? 'false'
            : // A provably-boolean scalar cell (validated by
              // `gpuSelectionConditionWidth`) compiles as its own scalar
              // condition inside the constructor: `bvec2((x < 0.0), true)`.
              compile(x)
      )
      .join(', ')})`;

  const h = c.operator;
  const ops: ReadonlyArray<Expression> = isFunction(c) ? c.ops : [];
  if (isRelationalOperator(h)) {
    // `isRelationalOperator` covers the FULL inequality set (`Precedes`,
    // `Approx`, `Tilde`, …), not just the six componentwise comparators. A
    // scalar-operand relation skips the width pass's compare-form check, so
    // guard again at the emission site — indexing past the map would splice
    // the literal string `undefined` into the shader source.
    const cmp =
      target.language === 'wgsl' ? GPU_COMPARE_WGSL[h] : GPU_COMPARE_GLSL[h];
    if (cmp === undefined)
      gpuSelectionDecline(
        `the relation \`${h}\` has no componentwise shader form.`
      );
    const operand = (op: Expression): string => {
      const code = compile(op);
      return BaseCompiler.vectorComponentCount(op) === undefined
        ? `${fvec}(${code})`
        : code;
    };
    const codes = ops.map(operand);
    const masks: string[] = [];
    // A chained ordering `a < m < b` conjoins the successive pairwise masks.
    // The shared middle operand is compiled twice: safe here because GPU
    // targets have no `bindExpr` and only support deterministic operands.
    for (let i = 0; i < codes.length - 1; i++) {
      masks.push(
        target.language === 'wgsl'
          ? `((${codes[i]}) ${cmp} (${codes[i + 1]}))`
          : `${cmp}(${codes[i]}, ${codes[i + 1]})`
      );
    }
    return gpuMaskAnd(masks, n, target);
  }

  if (h === 'And' || h === 'Or' || h === 'Not') {
    const masks = ops.map((op) => gpuSelectionMask(op, n, compile, target));
    if (h === 'Not') {
      if (masks.length !== 1) throw new Error('Not: expected one argument');
      return target.language === 'wgsl'
        ? `(!(${masks[0]}))`
        : `not(${masks[0]})`;
    }
    return h === 'And'
      ? gpuMaskAnd(masks, n, target)
      : gpuMaskOr(masks, n, target);
  }

  // A boolean-vector value used directly as the condition, or a scalar boolean
  // splat across the selection width.
  if (
    !BaseCompiler.isComplexValued(c) &&
    BaseCompiler.vectorComponentCount(c) !== undefined
  )
    return compile(c);
  return `${bvec}(${compile(c)})`;
}

/**
 * Lower a `Which`/`If` whose condition may be an indexed collection to the GPU
 * ELEMENT-WISE selection form (`np.select` semantics — R1–R4 of
 * `docs/plans/2026-07-27-elementwise-which-design.md`). Clauses arrive in
 * `Which` shape (condition, arm, condition, arm, …); the base compiler
 * normalizes `If(c, t, f)` to `[c, t, True, f]`.
 *
 * Only STATICALLY SHAPED conditions lower: every non-scalar condition must have
 * a `vec2`–`vec4` shape, and all of them the same one. Each condition becomes a
 * boolean vector (`bvecN` / `vecN<bool>`), and the clauses are folded
 * right-to-left with GLSL `mix` / WGSL `select` — first match wins (R1), with
 * `vecN(NaN)` as the no-match value (R4). Returns `null` when every condition is
 * provably scalar, so the ordinary scalar `Which`/`If` emission is untouched;
 * throws (D6) on any shape the shader languages cannot render.
 *
 * Documented divergences from the interpreter (a shader cannot throw —
 * CO-P2-24, the same reason the `absence` capability at `createTarget` declares
 * no `isAbsent`):
 *
 * - R2: a shader evaluates EVERY condition and EVERY arm. This goes BEYOND
 *   what R2 licenses (R2 promises an arm is evaluated only if selection
 *   reaches it; it only permits computing unselected CELLS of a selected
 *   arm) — a genuine GPU-specific divergence, accepted because the domain is
 *   pure and total: no arm can throw, no draw count is observable, so only
 *   the cells selection keeps are visible in the result.
 * - R4′: an absent (NaN) condition cell follows IEEE comparison semantics
 *   rather than the interpreter's consumed error cell: the orderings and
 *   `equal` answer `false` (the position falls through to LATER clauses),
 *   but `notEqual` answers `true` for a NaN cell (the clause SELECTS it) and
 *   `Not` inverts. Absence is not detectable here — `isnan`, and under
 *   aggressive fast-math even the NaN-comparison results themselves, are
 *   unreliable (the same limitation that omits `absence.isAbsent`).
 * - A non-boolean condition VALUE at run time cannot throw; only statically
 *   visible non-boolean conditions are declined here.
 */
function compileGPUSelection(
  args: ReadonlyArray<Expression>,
  compile: (e: Expression) => string,
  target: CompileTarget<Expression>
): string | null {
  let n: 2 | 3 | 4 | undefined = undefined;
  for (let i = 0; i < args.length; i += 2) {
    const w = gpuSelectionConditionWidth(args[i]);
    if (w === undefined) continue;
    if (n !== undefined && n !== w)
      gpuSelectionDecline(
        `the conditions of an element-wise selection mix vec${n} and vec${w}.`
      );
    n = w;
  }
  // Every condition is a scalar: leave the ordinary emission alone.
  if (n === undefined) return null;

  const width = n;
  const fvec = gpuFVec(width, target);

  const armCode = (arm: Expression): string => {
    if (BaseCompiler.isComplexValued(arm))
      gpuSelectionDecline(
        `an element-wise selection cannot have a complex-valued arm ` +
          `(\`${arm.toString()}\`) — a compiled complex value is a \`vec2\` of ` +
          `(re, im), which has no cell convention inside a selection.`
      );
    if (gpuIsTupleShaped(arm))
      gpuSelectionDecline(
        `an element-wise selection cannot have a tuple arm ` +
          `(\`${arm.toString()}\`) — a lifted point would be a list of points, ` +
          `which is not a GPU value.`
      );
    // A boolean arm has no GPU rendering: the selection's value operands are
    // one numeric vector type, and a `bvecN` (or a scalar `true`/`false`,
    // which is not even a float) spliced into `mix`/`select` is invalid
    // shader source. (The JS target returns boolean cells; a GPU consumer
    // should spell the mask numerically — 1 and 0 arms.)
    if (
      isSymbol(arm, 'True') ||
      isSymbol(arm, 'False') ||
      arm.type.matches('boolean') ||
      arm.type.matches('indexed_collection<boolean>')
    )
      gpuSelectionDecline(
        `an element-wise selection cannot have a boolean-valued arm ` +
          `(\`${arm.toString()}\`) — a GPU selection produces one numeric ` +
          `vector, and there is no boolean-cell convention. Use numeric arms ` +
          `(e.g. 1 and 0) instead.`
      );
    const w = BaseCompiler.vectorComponentCount(arm);
    if (w === width) return compile(arm);
    if (w === undefined && !BaseCompiler.isNonScalarShape(arm))
      return `${fvec}(${compile(arm)})`;
    gpuSelectionDecline(
      `the arm \`${arm.toString()}\` does not fit the vec${width} shape of the ` +
        `element-wise conditions (the interpreter answers ` +
        `\`incompatible-dimensions\`).`
    );
  };

  // First match wins: fold the clauses from LAST to FIRST over the no-match
  // vector, so an earlier clause's mask overrides a later one.
  let acc = `${fvec}(${gpuNaN(target)})`;
  for (let i = args.length - 2; i >= 0; i -= 2) {
    const code = armCode(args[i + 1]);
    // A `True` condition is the default clause: everything built for the later
    // (now unreachable) clauses is replaced.
    if (isSymbol(args[i], 'True')) {
      acc = code;
      continue;
    }
    const mask = gpuSelectionMask(args[i], width, compile, target);
    acc =
      target.language === 'wgsl'
        ? `select(${acc}, ${code}, ${mask})`
        : `mix(${acc}, ${code}, ${mask})`;
  }
  return acc;
}

/**
 * Lower a `broadcastable` unary head applied to a collection operand
 * (`Sin([1,2,3,4])`, `-[1,2,3,4]`) on a shader target — WITHOUT fanning out.
 *
 * GLSL and WGSL builtins and operators are already componentwise on a vector
 * (`sin(vec4)` is a `vec4`, `-vec4` is a `vec4`), so the faithful lowering is
 * the head's OWN scalar form applied directly to the vector operand. There is
 * no element loop, no callback and no temporary — the base compiler's former
 * default emitted a JavaScript `.map((v) => …)` arrow here, which no shader
 * compiler accepts.
 *
 * Gated on the operand having a static `vec2`–`vec4` shape — the same
 * activation gate as the element-wise selection lowering
 * (`BaseCompiler.vectorComponentCount`). Anything else (an unknown-length
 * list, a matrix, a 5+-element list) has no shader vector value at all, so it
 * fails closed (D6) rather than emitting source a driver would reject.
 *
 * The EMITTED lowering is then checked for componentwise safety: most scalar
 * lowerings are built from genType-polymorphic pieces (`sin(v)`, `-v`,
 * `1.0 / sin(v)`, `log(v) / log(10.0)`) and stay valid verbatim on a `vecN`,
 * but three constructs do not — see `gpuIsComponentwise`.
 */
function compileGPUBroadcastUnary(
  head: string,
  operand: Expression,
  lowering: {
    collection: () => string;
    element: (code: string) => string;
  }
): string {
  const decline = (reason: string): never => {
    throw new Error(`${head}: ${reason} Fail closed (D6).`);
  };
  // A complex value is ALSO lowered as a `vec2` (of re, im), so it must be
  // recognized BEFORE the width or it masquerades as a 2-cell collection —
  // the same ordering the selection lowering depends on.
  if (BaseCompiler.isComplexValued(operand))
    decline(
      `a complex-valued operand (\`${operand.toString()}\`) is lowered as a ` +
        `\`vec2\` of (re, im), which has no element-wise reading — a ` +
        `componentwise shader builtin would treat its real and imaginary ` +
        `parts as two independent elements.`
    );
  if (BaseCompiler.vectorComponentCount(operand) === undefined)
    decline(
      `the operand \`${operand.toString()}\` has no static vec2–vec4 shape ` +
        `(an unknown-length list, a matrix, or a 5+-element list), so it is ` +
        `not a shader vector and the componentwise builtins do not apply to it.`
    );
  const vector = lowering.collection();
  const code = lowering.element(vector);
  const unsafe = gpuIsComponentwise(code, vector);
  if (unsafe !== undefined)
    decline(
      `the scalar shader lowering \`${code}\` is not componentwise — ` +
        `${unsafe} A shader has no element loop, so a non-componentwise ` +
        `lowering cannot be broadcast over a \`vecN\` at all.`
    );
  return code;
}

/**
 * Why an emitted scalar lowering canNOT be reused verbatim on a `vecN`, or
 * `undefined` when it can.
 *
 * The shader builtins (`sin`, `sqrt`, `abs`, …) and the arithmetic operators
 * are genType-polymorphic, including the mixed scalar/vector forms
 * (`1.0 / vec3`, `vec3 / log(10.0)`), so the overwhelming majority of the
 * scalar lowerings are already componentwise. The exceptions are recognized
 * from the SHAPE OF THE EMITTED SOURCE — not from a list of operator names,
 * which would go stale the moment a lowering changed:
 *
 *  - a `_gpu_…` PREAMBLE HELPER (`_gpu_sinc`, `_gpu_gamma`, `_gpu_heaviside`,
 *    `_gpu_fresnelC`, `_gpu_powi`, …). Every helper reachable from a SCALAR
 *    element lowering is declared with scalar `float`/`f32` parameters, so
 *    `_gpu_sinc` of a `vec3` is source no driver accepts. The `_gpu_` prefix
 *    IS the property being tested. (A few helpers ARE aggregate-aware — the
 *    complex arithmetic and the colour converters take `vec2`/`vec3` — which
 *    is why the generic gate `gpuCheckOperandShapes` consults the emitted
 *    DECLARATION, `gpuHelperIsScalarOnly`, before reusing this verdict.)
 *  - a COMPARISON or a TERNARY (`Argument(x)` → `((x >= 0.0) ? 0.0 : π)`):
 *    GLSL has no `vecN >= float`, and both languages require a scalar `bool`
 *    condition, so there is no componentwise reading of either.
 *  - a lowering that DROPS the operand (`Imaginary(x)` → `0.0` for a real
 *    `x`): the result is a scalar where the caller is owed a `vecN`, which is
 *    a silent SHAPE error rather than a driver error.
 *
 * The last two are only decidable when the caller can name the operand's own
 * compiled source (`vector`) — i.e. on the fan-out route, where the WHOLE
 * emission derives from the element lowering. A caller with no such handle
 * (the generic gate, which sees a lowering over several independently
 * compiled operands) passes none, and gets the helper verdict alone: there,
 * a comparison may perfectly well be over an unrelated scalar operand
 * (`ContrastingColor` → `(_gpu_apca(…) > 50.0) ? … : …`).
 */
function gpuIsComponentwise(code: string, vector?: string): string | undefined {
  const helper = /_gpu_[A-Za-z0-9_]+\s*\(/.exec(code);
  if (helper !== null)
    return (
      `it calls the preamble helper \`${helper[0].slice(0, -1).trim()}\`, ` +
      `which is declared with scalar float/f32 parameters.`
    );
  if (vector === undefined) return undefined;
  if (/\?|[<>]=?|[=!]=/.test(code))
    return (
      `it branches on a comparison, which a shader requires to be a scalar ` +
      `bool.`
    );
  if (!code.includes(vector))
    return `it does not use the operand at all, so its result is a scalar.`;
  return undefined;
}

/**
 * The SHADER shape an operand lowers to: a scalar, a `vecN` (reported as its
 * width), a `matN`, or an array (`float[N]` / `array<f32, N>`).
 *
 * Derived from the shape helpers the rest of the GPU analysis already uses —
 * `isNonScalarShape` ("is this a scalar at all?") and `vectorComponentCount`
 * ("does it have a `vec2`–`vec4` lowering?") — so it stays in step with them
 * rather than re-deciding shape from scratch.
 *
 * A COMPLEX value reads as a scalar here, even though it lowers to a `vec2` of
 * (re, im): the complex convention is its own, carried by the complex codegen
 * (`_gpu_cmul`, `_gpu_cdiv`, …), and reading it as a 2-cell vector would make
 * every complex lowering look like a shape error. This is the same ordering
 * the fan-out and selection lowerings depend on.
 */
export function gpuOperandShape(
  expr: Expression
): 'scalar' | 'matrix' | 'array' | 2 | 3 | 4 {
  if (BaseCompiler.isComplexValued(expr)) return 'scalar';
  if (!BaseCompiler.isNonScalarShape(expr)) return 'scalar';
  const width = BaseCompiler.vectorComponentCount(expr);
  if (width !== undefined) return width;
  if (isFunction(expr, 'Matrix')) return 'matrix';
  const t = expr.type.type;
  if (
    typeof t !== 'string' &&
    t.kind === 'list' &&
    (t.dimensions?.length ?? 0) >= 2
  )
    return 'matrix';
  // A non-scalar with no `vecN` and no matrix reading: a 1-element or
  // 5+-element list, or a list of unknown length — a shader ARRAY.
  return 'array';
}

/** How `gpuCheckOperandShapes` names a shape in a diagnostic. */
function gpuShapeName(shape: ReturnType<typeof gpuOperandShape>): string {
  return typeof shape === 'number' ? `vec${shape}` : shape;
}

/**
 * The `[rows, cols]` of a matrix-shaped operand, or `undefined` when they are
 * not statically known. The kind alone is not enough for the operator gate:
 * `mat2 + mat3` and `mat2 * vec3` are as invalid as `vec2 + vec3`, so the
 * dimensions must be read — structurally for a `Matrix` literal, from the
 * declared list dimensions otherwise (an unknown extent is reported as a
 * negative count there, and answers `undefined` here).
 */
function gpuMatrixDims(
  expr: Expression
): readonly [rows: number, cols: number] | undefined {
  if (isFunction(expr, 'Matrix')) {
    const body = expr.ops[0];
    if (!isFunction(body) || body.nops === 0) return undefined;
    const rows = body.ops;
    const cols = isFunction(rows[0]) ? rows[0].nops : 0;
    if (cols > 0 && rows.every((r) => isFunction(r) && r.nops === cols))
      return [rows.length, cols];
    return undefined;
  }
  const t = expr.type.type;
  if (typeof t !== 'string' && t.kind === 'list') {
    const dims = t.dimensions;
    if (dims?.length === 2 && dims[0] > 0 && dims[1] > 0)
      return [dims[0], dims[1]];
  }
  return undefined;
}

/**
 * The callee and top-level argument count of `code` when the WHOLE emission is
 * a single call. `undefined` for an infix/compound emission (`a + b`,
 * `(c ? a : b)`, `log(a) / log(10.0)`), which is what tells the gate below
 * that no single builtin signature governs the operand shapes.
 *
 * The argument count is what distinguishes a lowering that passes its operands
 * THROUGH (`_gpu_powi(x, n)`, one argument per operand) from one that
 * DESTRUCTURES a collection operand into scalars (`Median([1,5,3,2,4])` →
 * `_gpu_median_5(1.0, 5.0, 3.0, 2.0, 4.0)`, five arguments for one operand) —
 * a reduction the shape gate must leave alone.
 *
 * `operands` are those arguments' own sources, which is what lets a reduction
 * read the components back out of an aggregate CONSTRUCTOR
 * (`gpuScalarComponents`).
 */
function gpuTopLevelCall(
  code: string
): { callee: string; argCount: number; operands: string[] } | undefined {
  const s = code.trim();
  // `sin`, `_gpu_powi`, `vec3f`, `mat2x2f`, `float[5]`, `array<f32, 5>`
  const m = /^([A-Za-z_]\w*(?:\s*<[^<>()]*>)?(?:\s*\[\d+\])?)\s*\(/.exec(s);
  if (m === null) return undefined;
  let depth = 0;
  let start = m[0].length;
  const operands: string[] = [];
  for (let i = m[0].length - 1; i < s.length; i++) {
    if (s[i] === '(') {
      if (++depth === 1) start = i + 1;
    } else if (s[i] === ',' && depth === 1) {
      operands.push(s.slice(start, i).trim());
      start = i + 1;
    } else if (s[i] === ')' && --depth === 0) {
      if (i !== s.length - 1) return undefined;
      const last = s.slice(start, i).trim();
      // `f()` has no arguments; `f(a)` has one, even when `a` is empty text.
      if (last !== '' || operands.length > 0) operands.push(last);
      return { callee: m[1].trim(), argCount: operands.length, operands };
    }
  }
  return undefined;
}

/**
 * An aggregate CONSTRUCTOR of either shader language (`vec3`, `bvec2`,
 * `mat2x2f`, `float[5]`, `array<f32, 5>`). Such a lowering BUILDS a shape from
 * its operands instead of acting on them, so the componentwise gate does not
 * apply to it; the constructors have their own guards
 * (`assertGPUScalarComponents`, `gpuValueHasVectorComponents`). The spellings
 * of the two languages are disjoint, so one predicate serves both.
 */
const GPU_AGGREGATE_CONSTRUCTOR =
  /^(?:[iub]?vec[234]|mat[234]|array\s*<|(?:float|f32|int|i32|uint|u32|bool)\s*\[)/;

/**
 * `GPU_AGGREGATE_CONSTRUCTOR` unanchored: does an aggregate constructor appear
 * ANYWHERE in this source? Used to tell a scalar component apart from a nested
 * aggregate one when a reduction reads an operand's components back out.
 */
const GPU_AGGREGATE_CONSTRUCTOR_ANYWHERE =
  /\b(?:[iub]?vec[234]|mat[234]|array\s*<|(?:float|f32|int|i32|uint|u32|bool)\s*\[)/;

/**
 * Is the preamble helper `name` declared with SCALAR parameters only?
 *
 * Read off the declaration the target itself emits for it, rather than
 * assumed: most helpers are scalar (`float _gpu_powi(float x, float n)`), but
 * the complex arithmetic takes `vec2` and the colour converters take `vec3`,
 * and handing those an aggregate is exactly what they are for.
 *
 * A helper with no declaration in the preamble answers `false` (permissive) —
 * the gate then leaves the call alone rather than declining a lowering it
 * cannot see.
 */
function gpuHelperIsScalarOnly(name: string, preamble: string): boolean {
  // GLSL: `float _gpu_powi(float x, float n) {`
  // WGSL: `fn _gpu_powi(x: f32, n: f32) -> f32 {`
  // Anchored to a declaration (a return type or `fn` at the head of a line) so
  // a CALL of the same helper inside another body cannot be read as one.
  const decl = new RegExp(
    `(?:^|\\n)[^\\S\\n]*(?:fn[^\\S\\n]+|[A-Za-z_]\\w*(?:\\[\\d+\\])?[^\\S\\n]+)` +
      `${name}[^\\S\\n]*\\(([^)]*)\\)`
  ).exec(preamble);
  if (decl === null) return false;
  return !/[iub]?vec[234]|mat[234]|array\s*<|\[\s*\d+\s*\]/.test(decl[1]);
}

/**
 * A VECTOR constructor in `code` whose own arguments contain another aggregate
 * constructor — `length(vec2(vec3(…), vec3(…)))`, `length(vec2(float[1](3.0),
 * 4.0))` — or `undefined` when there is none.
 *
 * Such a lowering RESHAPES its operands (it packs them into a vector) instead
 * of acting on them componentwise, so it is only correct for the scalar
 * operands it was written for: `Hypot(x, y)` → `length(vec2(x, y))` is
 * `√(x²+y²)` for scalars, but `vec2(vec3, vec3)` is not source a driver
 * accepts, and the element-wise hypotenuse it was asked for is not what it
 * would mean. Only `vecN(` heads are scanned — a `matN(` constructor takes
 * `vecN` columns BY DESIGN, and the aggregate constructors are exempt from the
 * gate entirely (they build a shape rather than consume one).
 */
function gpuReshapesOperands(code: string): string | undefined {
  const ctor = /\b([iub]?vec[234][fhiu]?)\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = ctor.exec(code)) !== null) {
    let depth = 0;
    for (let i = m.index + m[0].length - 1; i < code.length; i++) {
      if (code[i] === '(') depth++;
      else if (code[i] === ')' && --depth === 0) {
        const inner = code.slice(m.index + m[0].length, i);
        const nested =
          /\b(?:[iub]?vec[234]|mat[234]|array\s*<|(?:float|f32)\s*\[)/.exec(
            inner
          );
        if (nested !== null)
          return (
            `it packs its operands into a \`${m[1]}\` constructor, which ` +
            `has no room for the aggregate \`${nested[0].trim()}\` value ` +
            `standing in each slot.`
          );
        break;
      }
    }
  }
  return undefined;
}

/**
 * Does this emission APPLY nothing — a bare identifier (possibly swizzled or
 * indexed) or a bare numeric literal?
 *
 * Such a lowering passes ONE operand through (`Real(m)` → `m`, a
 * `WithRandomSeed` body) or answers a constant (`Imaginary(x)` → `0.0`)
 * instead of combining its operands with a componentwise builtin, so the
 * shapes of the operands it did NOT use constrain it in no way. Read off the
 * source rather than from a list of heads: anything with a call or an operator
 * in it is a genuine compound emission and is judged as one.
 */
function gpuIsAtomicEmission(code: string): boolean {
  const s = code.trim();
  return (
    /^[A-Za-z_]\w*(?:\.\w+|\[\d+\])*$/.test(s) ||
    /^[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?$/.test(s)
  );
}

/**
 * Per-language shape rules for `gpuCheckOperandShapes`. GLSL and WGSL agree on
 * the broad strokes — the builtins and the arithmetic operators are
 * genType-polymorphic — but not on where a SCALAR may stand in for a `vecN`,
 * so each target supplies its own table (see `GPUShaderTarget.getShapeRules`).
 */
export type GPUShapeRules = {
  /**
   * Shader builtins that accept a scalar where their other genType arguments
   * are a `vecN`, and — crucially — WHERE. The scalar-tailed overloads
   * constrain the POSITION as well as the presence: GLSL declares
   * `mod(genType, float)` (scalar only LAST), `step(float, genType)` (scalar
   * only FIRST), `mix(genType, genType, float)` and `refract(genType, genType,
   * float)` (scalar only third), `clamp(genType, float, float)` (scalars in
   * slots 2–3). So the value is the set of 0-based argument positions at which
   * a scalar may stand; a scalar anywhere else is as invalid as one in a
   * builtin with no such overload at all.
   *
   * A builtin ABSENT from the map requires MATCHING genTypes throughout, so
   * `atan(vec3, float)` and `pow(float, vec3)` are not valid source in either
   * language.
   *
   * These are shader BUILTIN names — a fact of each language's specification,
   * not a list of CE heads — so tabulating them is what keeps the two
   * languages' genuinely different overload sets apart.
   */
  readonly scalarGenTypeSlots: ReadonlyMap<string, ReadonlySet<number>>;
  /**
   * Shader builtins with an argument that is ALWAYS a scalar — an OBLIGATION,
   * where `scalarGenTypeSlots` records a PERMISSION.
   *
   * The distinction is the overload SET, not the presence of a scalar-tailed
   * signature. `mix` is declared BOTH `mix(genType, genType, float)` AND
   * `mix(genType, genType, genType)`, so its third argument MAY be a scalar;
   * `refract` is declared ONLY `refract(genType I, genType N, float eta)`
   * (GLSL ES 3.00 §8.4 / GLSL 4.60 §8.5 / WGSL §17.5, `refract(e1: vecN<T>,
   * e2: vecN<T>, e3: T)`), so its third argument MUST be one. Every other
   * builtin in `scalarGenTypeSlots` — `min`, `max`, `clamp`, `step`,
   * `smoothstep`, `mod` — has a matched all-genType overload alongside its
   * scalar-tailed one, so none of them belongs here.
   *
   * Checked independently of `scalarGenTypeSlots`, and in particular when NO
   * operand is a scalar: `refract(vec3, vec3, vec3)` has no overload at all,
   * but the permission table is only consulted once a scalar is present, so an
   * all-vector call used to slip through behind `success: true`.
   */
  readonly mandatoryScalarSlots: ReadonlyMap<string, ReadonlySet<number>>;
  /**
   * Shader builtins with an argument that is ALWAYS a `vecN` — the mirror of
   * `mandatoryScalarSlots`, and the other obligation an ALL-SCALAR call can
   * fail.
   *
   * GLSL declares its geometric functions over the genType, which INCLUDES
   * `float`: `refract(float, float, float)`, `dot(float, float)` and
   * `normalize(float)` are all valid GLSL (§8.4 / §8.5 — "genType" is
   * `float`, `vec2`, `vec3`, `vec4`). WGSL does not: `refract(e1: vecN<T>,
   * e2: vecN<T>, e3: T)`, `dot(e1: vecN<T>, e2: vecN<T>)`,
   * `faceForward(e1: vecN<T>, e2: vecN<T>, e3: vecN<T>)`,
   * `normalize(e: vecN<T>)` and `reflect(e1: vecN<T>, e2: vecN<T>)` (§17.5)
   * have no all-scalar form at all, so `refract(1.0, 2.0, 0.5)` — perfectly
   * good GLSL — is source no WebGPU driver accepts. `cross` is narrower still
   * and vector-only in BOTH languages (`vec3` only). `length` and `distance`
   * are declared over both a scalar and a `vecN` in either language and are
   * therefore absent.
   *
   * The all-scalar case is exactly the one the rest of the gate never sees: it
   * returns early on operands that are all scalars, which is why this check
   * runs first.
   */
  readonly vectorOnlySlots: ReadonlyMap<string, ReadonlySet<number>>;
  /**
   * Does the arithmetic operator `sym` accept a `matN` operand? `allMatrix` is
   * true when EVERY operand is a matrix (`mat2 * mat2`, `mat2 + mat2`) and
   * false when a scalar is mixed in (`mat2 * 2.0`). Admissibility of the
   * KIND pairing only — the dimension constraints (same size under the
   * componentwise operators, agreeing sizes under `*`) are language-shared
   * facts checked by the gate itself.
   */
  matrixArithmetic(sym: string, allMatrix: boolean): boolean;
  /**
   * Does the language define unary negation on a `matN`? GLSL does — its
   * unary operators "operate on integer or floating-point values (including
   * vectors and matrices)" (GLSL 4.60 §5.9) — but WGSL's negation (§8.7,
   * "Unary arithmetic expressions") is declared over scalars and `vecN` only,
   * so `-mat2x2f(…)` is not valid WGSL source.
   */
  readonly matrixNegate: boolean;
};

/**
 * The GPU targets' extension of `CompileTarget`: the language's own shape
 * rules, carried on the target so a LOWERING — not just the generic gate —
 * can judge the calls it generates against the same table
 * (`foldNaryBuiltin`). Written once by `createTarget()`; a hand-rolled target
 * that never went through it simply has none, and those lowerings then fall
 * back on the generic gate alone.
 */
type GPUShapeRulesTarget = CompileTarget<Expression> & {
  gpuShapeRules?: GPUShapeRules;
};

/** The shape rules `target` was created with, if any. */
function gpuShapeRules(
  target: CompileTarget<Expression> | undefined
): GPUShapeRules | undefined {
  return (target as GPUShapeRulesTarget | undefined)?.gpuShapeRules;
}

/**
 * Lowerings that CONSUME their aggregate operands — destructuring a collection
 * into scalars and combining those — rather than handing the aggregate to a
 * componentwise builtin. The `Max`/`Min` reduction (`compileGPUExtremum`),
 * `Median`'s sorting network and `Variance`'s inline mean/deviation sum are
 * the three. The operand shapes such a lowering was handed are no longer in
 * its emission at all, so judging the emission against them declines a
 * perfectly good reduction.
 *
 * The capability is DECLARED, at the handler's own definition site
 * (`markAggregateConsuming`) — never a table of CE head names kept elsewhere,
 * and never inferred from the shape of the emitted source. The gate used to
 * read "is not a single call and the head is absent from `GPU_OPERATORS`" as
 * the signal, which let every ORDINARY compound lowering (WGSL's `Mod` →
 * `(((a % b) + b) % b)`) past as well.
 *
 * The value is a PREDICATE over the operands, not a flag, because a handler
 * that destructures a LITERAL collection still passes scalar operands straight
 * through in its other form: `Variance([1,2,3,4,5])` consumes an aggregate,
 * `Variance(v, w)` does not, and only the first should step the gate aside.
 */
const GPU_AGGREGATE_CONSUMING = new WeakMap<
  object,
  (args: ReadonlyArray<Expression>) => boolean
>();

/**
 * Declare `fn` an aggregate-consuming lowering for the calls `when` accepts
 * (every call, by default) — see `GPU_AGGREGATE_CONSUMING`.
 */
function markAggregateConsuming<T extends CompiledFunction<Expression>>(
  fn: T,
  when: (args: ReadonlyArray<Expression>) => boolean = () => true
): T {
  if (typeof fn === 'function') GPU_AGGREGATE_CONSUMING.set(fn, when);
  return fn;
}

/**
 * `Median` and `Variance` destructure a SINGLE `List` operand into its
 * elements; given N scalar arguments instead they use them one for one, and
 * the gate must go on judging that form.
 */
const gpuDestructuresListOperand = (
  args: ReadonlyArray<Expression>
): boolean => args.length === 1 && isFunction(args[0], 'List');

/** `{1}` → "in argument 2"; `{1, 2}` → "in arguments 2 and 3". */
function gpuSlotNames(slots: ReadonlySet<number>): string {
  const ns = [...slots].sort((a, b) => a - b).map((n) => `${n + 1}`);
  if (ns.length === 0) return 'nowhere';
  if (ns.length === 1) return `in argument ${ns[0]}`;
  return `in arguments ${ns.slice(0, -1).join(', ')} and ${ns[ns.length - 1]}`;
}

/**
 * Does this emitted argument source read as a `vecN` VALUE?
 *
 * Source-level, and deliberately conservative. Once a lowering has folded
 * several operands into NESTED calls (`ElementMax(a, b, c)` →
 * `max(max(a, b), c)`) the CE operand positions no longer line up with the
 * emitted argument positions, so the call tree is all there is to judge. A
 * vector is recognized as an aggregate CONSTRUCTOR, or as a genType-polymorphic
 * builtin call (one carrying scalar-slot rules) over a vector. Everything else
 * — including a bare identifier declared `vector<3>` — reads as a scalar, so an
 * argument list with no recognizable vector is left alone rather than judged on
 * a guess. (The one-for-one case is judged on the CE operand shapes instead,
 * which ARE exact; see `gpuCheckOperandShapes`.)
 */
function gpuSourceIsVector(
  code: string,
  slots: ReadonlyMap<string, ReadonlySet<number>>
): boolean {
  const call = gpuTopLevelCall(code);
  if (call === undefined) return false;
  if (GPU_AGGREGATE_CONSTRUCTOR.test(call.callee)) return true;
  if (!slots.has(call.callee)) return false;
  return call.operands.some((o) => gpuSourceIsVector(o, slots));
}

/**
 * A scalar argument standing where the emitted builtin's overload requires the
 * `vecN` genType, anywhere in the emitted call TREE — or `undefined` when there
 * is none.
 *
 * The counterpart of the one-for-one positional check in
 * `gpuCheckOperandShapes`, for a lowering that does NOT pass its operands
 * through: `ElementMax([1,2,3], [4,5,6], 2)` folds to
 * `max(max(vec3(…), vec3(…)), 2.0)` — valid GLSL — while
 * `ElementMax(2, [1,2,3], [4,5,6])` folds to `max(max(2.0, vec3(…)), vec3(…))`,
 * whose INNER call puts the scalar first, where GLSL's `max(genType, float)`
 * has no overload.
 */
function gpuMisplacedScalarArgument(
  code: string,
  slots: ReadonlyMap<string, ReadonlySet<number>>
): string | undefined {
  const call = gpuTopLevelCall(code);
  if (call === undefined) return undefined;
  const allowed = slots.get(call.callee);
  if (allowed !== undefined) {
    const isVector = call.operands.map((o) => gpuSourceIsVector(o, slots));
    if (isVector.some((v) => v)) {
      const bad = isVector.findIndex((v, i) => !v && !allowed.has(i));
      if (bad >= 0)
        return (
          `the shader builtin \`${call.callee}\` takes a scalar only ` +
          `${gpuSlotNames(allowed)}, but the emitted call \`${code.trim()}\` ` +
          `has a scalar in argument ${bad + 1}, where the overload requires ` +
          `the \`vecN\` genType; the scalar is not promoted to a vector.`
        );
    }
  }
  for (const o of call.operands) {
    const why = gpuMisplacedScalarArgument(o, slots);
    if (why !== undefined) return why;
  }
  return undefined;
}

/**
 * Fail closed (D6) when a non-scalar operand — a collection, a matrix, an
 * array — reaches a lowering whose shader type system cannot accept it.
 *
 * The counterpart of `compileGPUBroadcastUnary` for every emission that does
 * NOT go through the fan-out hook: the generic function-codegen and
 * string-mapped-helper paths, which the base compiler splices verbatim. Those
 * used to emit `atan(vec3, 1.0)`, `pow(2.71828182846, vec3(…))`,
 * `length(vec2(float[1](3.0), 4.0))` and `sin(mat2(…))` behind `success:
 * true` — mixed genTypes, an array constructor inside a vector constructor,
 * and a matrix handed to a scalar builtin, none of which a driver accepts.
 *
 * Every decision is derived from the operands' shapes (`gpuOperandShape`) and
 * from the SHAPE OF THE EMITTED SOURCE (`gpuTopLevelCall`,
 * `gpuIsComponentwise`), never from a list of head names: a head that changes
 * its lowering is re-judged on the new source. The one exception is DECLARED
 * rather than inferred — a lowering that consumes its aggregate operands
 * (`GPU_AGGREGATE_CONSUMING`) steps the gate aside, because the shapes it was
 * handed are no longer in its emission.
 */
function gpuCheckOperandShapes(
  head: string,
  args: ReadonlyArray<Expression>,
  code: string,
  rules: GPUShapeRules,
  preambleFor: (code: string) => string,
  lowering?: CompiledFunction<Expression>
): void {
  const shapes = args.map(gpuOperandShape);

  // A lowering that DESTRUCTURED its aggregate operands (`Max`/`Min`, whose
  // reduction folds every collection down to one scalar) has an emission the
  // operand shapes no longer describe. It says so explicitly, at its own
  // definition site; nothing about the shape of its emitted source is read as
  // that claim.
  if (typeof lowering === 'function') {
    const consumes = GPU_AGGREGATE_CONSUMING.get(lowering);
    if (consumes?.(args) === true) return;
  }

  // Annotated (rather than inferred) so a `decline(…)` call narrows what
  // follows it: the positional check below reads a rule the preceding
  // `decline` has already ruled out as absent.
  const decline: (reason: string) => never = (reason) => {
    throw new Error(`${head}: ${reason} Fail closed (D6).`);
  };

  // A slot with no SCALAR overload at all — the mirror of
  // `mandatoryScalarSlots`, and the only fault an ALL-SCALAR call can have.
  // WGSL declares `refract(e1: vecN<T>, e2: vecN<T>, e3: T)` and no all-scalar
  // form, where GLSL's genType includes `float`, so `Refract(1, 2, 0.5)`
  // emitted `refract(1.0, 2.0, 0.5)` — good GLSL, and source no WebGPU driver
  // accepts. Positional, so it needs the lowering to pass its operands through
  // one for one; and only SCALARS are judged here, because a `matN` or array
  // in such a slot gets a more specific verdict from the branches below.
  const topCall = gpuTopLevelCall(code);
  const declineVectorOnly = (): void => {
    if (topCall === undefined || topCall.argCount !== args.length) return;
    const vectorOnly = rules.vectorOnlySlots.get(topCall.callee);
    if (vectorOnly === undefined) return;
    const bad = shapes.findIndex((s, i) => vectorOnly.has(i) && s === 'scalar');
    if (bad >= 0)
      decline(
        `the shader builtin \`${topCall.callee}\` is declared over the ` +
          `\`vecN\` genType ${gpuSlotNames(vectorOnly)} in this language — it ` +
          `has no scalar overload there — but argument ${bad + 1} lowers to a ` +
          `scalar; the scalar is not promoted to a vector.`
      );
  };

  // Nothing but scalars: the overwhelmingly common case, left untouched apart
  // from the vector-only obligations, which are exactly the rule that a call
  // with no non-scalar operand anywhere can still break.
  if (shapes.every((s) => s === 'scalar')) {
    declineVectorOnly();
    return;
  }

  const widths = new Set(
    shapes.filter((s): s is 2 | 3 | 4 => typeof s === 'number')
  );
  const declineWidths = (): void => {
    if (widths.size > 1)
      decline(
        `its operands lower to shader vectors of different widths ` +
          `(${[...widths].map((w) => `vec${w}`).join(', ')}); the ` +
          `componentwise builtins and operators require ONE genType.`
      );
  };
  const hasMatrix = shapes.includes('matrix');
  const hasArray = shapes.includes('array');
  const call = topCall;

  if (call === undefined) {
    // Not a single call: an infix operator emission, or an ORDINARY COMPOUND
    // lowering (WGSL's `Mod` → `(((a % b) + b) % b)`, `Log10` →
    // `log(a) / log(10.0)`). A lowering that consumes its aggregate operands
    // has already returned above, on its own DECLARED capability — this branch
    // used to infer that from "is not a single call and the head is absent
    // from `GPU_OPERATORS`", which waved every compound lowering through:
    // `Mod(P, Q)` over a `vector<3>` and a `vector<2>` emitted
    // `(((P % Q) + Q) % Q)` behind `success: true` on WGSL, while GLSL — whose
    // `Mod` IS a single `mod(…)` call — declined it correctly.
    const sym = GPU_OPERATORS[head]?.[0];
    if (sym === undefined || !/^[-+*/]$/.test(sym)) {
      // An emission that COMBINES nothing constrains nothing: a lowering that
      // passes ONE operand through (`Real(m)` → `m`, `WithRandomSeed(m, s)` →
      // the body) or answers a constant (`Imaginary(x)` → `0.0`) says nothing
      // about the shapes of the operands it did not use, and judging it
      // against all of them is a false decline.
      if (gpuIsAtomicEmission(code)) return;
      // No ONE signature governs a compound emission, but its pieces are the
      // same genType-polymorphic builtins and operators, which require ONE
      // genType across the whole expression and have no `matN` or array
      // reading at all. (A scalar mixed with same-width vectors stays
      // admissible: the arithmetic operators broadcast it in both languages,
      // and a compound lowering is built from those.)
      if (hasArray || hasMatrix)
        decline(
          `the compound shader lowering \`${code}\` is built from the ` +
            `genType-polymorphic builtins and operators, which have no ` +
            `${hasMatrix ? '`matN`' : 'array'} reading, so the operand ` +
            `shapes (${shapes.map(gpuShapeName).join(', ')}) have no lowering.`
        );
      declineWidths();
      const packs = gpuReshapesOperands(code);
      if (packs !== undefined)
        decline(
          `the shader lowering \`${code}\` cannot take the non-scalar operand ` +
            `shapes (${shapes.map(gpuShapeName).join(', ')}) — ${packs}`
        );
      return;
    }
    if (hasArray)
      decline(
        `an operand lowers to a shader ARRAY (\`float[N]\` / ` +
          `\`array<f32, N>\`), which has no arithmetic operators — only ` +
          `scalars, \`vecN\` and \`matN\` values do.`
      );
    if (!hasMatrix) {
      declineWidths();
      // A scalar mixed with (same-width) vectors is valid in BOTH languages
      // under every arithmetic operator: GLSL 4.60 §5.9 ("one operand is a
      // scalar, and the other is a vector or matrix"), WGSL §8.7 ("Binary
      // arithmetic expressions with mixed scalar and vector operands", which
      // lists `+ - * / %` in both orders).
      return;
    }

    // A matrix operand enters infix arithmetic only through its NATIVE shader
    // form: the square `matN` (N = 2–4) the `Matrix` lowering emits, or — for
    // an N×1 column `Matrix` literal — the `vecN` it flattens to
    // (`compileGPUMatrix`). Everything else (non-square, 5+ rows, unknown
    // dimensions) lowers to nested arrays, which have no operators. And the
    // DIMENSIONS matter, not just the kind: `mat2 + mat3` and `mat2 * vec3`
    // are as invalid as `vec2 + vec3`.
    const eff: Array<number | 'scalar' | { mat: number }> = [];
    for (let i = 0; i < shapes.length; i++) {
      const s = shapes[i];
      if (s !== 'matrix') {
        eff.push(s as number | 'scalar');
        continue;
      }
      const dims = gpuMatrixDims(args[i]);
      if (
        dims !== undefined &&
        dims[1] === 1 &&
        dims[0] >= 2 &&
        dims[0] <= 4 &&
        isFunction(args[i], 'Matrix')
      ) {
        eff.push(dims[0]);
        continue;
      }
      if (
        dims === undefined ||
        dims[0] !== dims[1] ||
        dims[0] < 2 ||
        dims[0] > 4
      )
        decline(
          `its operand \`${args[i].toString()}\` lowers to a matrix with no ` +
            `native square \`matN\` (N = 2–4) shader type` +
            (dims !== undefined
              ? ` (its dimensions are ${dims[0]}×${dims[1]})`
              : ` (its dimensions are not statically known)`) +
            `, so the shader operator \`${sym}\` has no overload for it.`
        );
      eff.push({ mat: dims[0] });
    }
    const effName = (e: number | 'scalar' | { mat: number }): string =>
      typeof e === 'number' ? `vec${e}` : e === 'scalar' ? e : `mat${e.mat}`;
    const shapeList = `(${eff.map(effName).join(', ')})`;
    // The single size every non-scalar operand must share: with only SQUARE
    // native matrices, the componentwise same-genType rule, the matrix
    // same-dimensions rule and the `*` inner-dimension rule (`matCxR * vecC`,
    // `vecR * matCxR`, `matKxR * matCxK`) all collapse to one size.
    const sizes = new Set<number>(
      eff.flatMap((e) =>
        e === 'scalar' ? [] : [typeof e === 'number' ? e : e.mat]
      )
    );
    if (!eff.some((e) => typeof e === 'object')) {
      // Every matrix was an N×1 column literal: plain vector arithmetic.
      if (sizes.size > 1)
        decline(
          `its operands lower to shader vectors of different widths ` +
            `${shapeList}; the componentwise operators require ONE genType.`
        );
      return;
    }
    if (args.length === 1) {
      // Unary negation of a matrix — the one arity where the two languages
      // split on the KIND itself (see `GPUShapeRules.matrixNegate`).
      if (!rules.matrixNegate)
        decline(
          `the shader unary \`-\` is declared over scalars and \`vecN\` ` +
            `only in this language; it has no overload for the ` +
            `${effName(eff[0])} operand.`
        );
      return;
    }
    if (sym !== '*') {
      if (eff.some((e) => typeof e === 'number'))
        decline(
          `a \`matN\` and a \`vecN\` operand combine only under \`*\` ` +
            `(matrix-vector product), not \`${sym}\`.`
        );
      if (
        !rules.matrixArithmetic(
          sym,
          eff.every((e) => typeof e === 'object')
        )
      )
        decline(
          `the shader operator \`${sym}\` has no overload for the operand ` +
            `shapes ${shapeList}.`
        );
      if (sizes.size > 1)
        decline(
          `the componentwise \`${sym}\` requires matrices of the SAME ` +
            `dimensions, but the operand shapes are ${shapeList}.`
        );
      return;
    }
    // `*`: matrix-scalar scaling and the linear-algebraic products. The inner
    // dimensions must agree; with square `matN` types that is ONE size across
    // every non-scalar operand.
    if (sizes.size > 1)
      decline(
        `under \`*\` the matrix and vector dimensions must agree ` +
          `(\`matCxR * vecC\`, \`matKxR * matCxK\`), but the operand shapes ` +
          `${shapeList} do not.`
      );
    return;
  }

  const { callee, argCount } = call;

  // An aggregate constructor BUILDS a shape from its operands (`List`,
  // `Tuple`, `Matrix`); its own guards own that check.
  if (GPU_AGGREGATE_CONSTRUCTOR.test(callee)) return;

  // A preamble helper. The aggregate-aware ones (complex arithmetic, colour
  // conversion) own their operand shapes, so the gate steps aside; a
  // scalar-only one cannot take an aggregate — unless the lowering DESTRUCTURED
  // the collection into one scalar argument per element (`Median` →
  // `_gpu_median_5(…)`), which the argument count reveals.
  if (callee.startsWith('_gpu_')) {
    if (argCount !== args.length) return;
    if (!gpuHelperIsScalarOnly(callee, preambleFor(callee))) return;
    const why = gpuIsComponentwise(code);
    if (why !== undefined)
      decline(
        `the shader lowering \`${code}\` cannot take the non-scalar operand ` +
          `shapes (${shapes.map(gpuShapeName).join(', ')}) — ${why}`
      );
    return;
  }

  if (hasMatrix || hasArray)
    decline(
      `the shader builtin \`${callee}\` is declared over scalar and \`vecN\` ` +
        `genTypes; it has no ${hasMatrix ? '`matN`' : 'array'} overload, so ` +
        `the operand shapes (${shapes.map(gpuShapeName).join(', ')}) have no ` +
        `lowering.`
    );
  declineWidths();
  const reshapes = gpuReshapesOperands(code);
  if (reshapes !== undefined)
    decline(
      `the shader lowering \`${code}\` cannot take the non-scalar operand ` +
        `shapes (${shapes.map(gpuShapeName).join(', ')}) — ${reshapes}`
    );
  if (widths.size === 1 && shapes.includes('scalar')) {
    const slots = rules.scalarGenTypeSlots.get(callee);
    if (slots === undefined)
      decline(
        `the shader builtin \`${callee}\` requires MATCHING genType ` +
          `arguments, but it is applied to a vec${[...widths][0]} operand and ` +
          `a scalar one; the scalar is not promoted to a vector.`
      );
    // The overload says WHERE a scalar may stand, not merely that one may:
    // `mod(genType, float)` admits it only LAST, `step(float, genType)` only
    // FIRST, `mix(genType, genType, float)` only third. When the lowering
    // passes its operands through ONE FOR ONE the CE operand shapes give the
    // positions exactly — including for an operand with no constructor in its
    // source (a symbol declared `vector<3>`).
    if (argCount === args.length) {
      const bad = shapes.findIndex((s, i) => s === 'scalar' && !slots.has(i));
      if (bad >= 0)
        decline(
          `the shader builtin \`${callee}\` takes a scalar only ` +
            `${gpuSlotNames(slots)}, but here the scalar stands in argument ` +
            `${bad + 1}, where the overload requires the vec${
              [...widths][0]
            } genType; the scalar is not promoted to a vector.`
        );
    }
    // A lowering that does NOT pass its operands through (the variadic
    // `min`/`max` fold) is judged on the emitted call TREE, where each nested
    // call has its own argument positions.
    const misplaced = gpuMisplacedScalarArgument(code, rules.scalarGenTypeSlots);
    if (misplaced !== undefined) decline(misplaced);
  }
  // The OBLIGATIONS, last: a slot that must be scalar is violated by a `vecN`
  // standing in it, so — unlike everything above — this check does not depend
  // on a scalar being present ANYWHERE, and is the only one an ALL-VECTOR call
  // can fail. `refract(vec3, vec3, vec3)` is not a signature either language
  // declares, but the permission table above is consulted only once
  // `shapes.includes('scalar')`, so such a call used to reach a driver.
  // Positional, so it needs the lowering to pass its operands through one for
  // one; and reported after the permission verdict, which names the more
  // specific fault when a scalar is ALSO misplaced.
  const mandatory = rules.mandatoryScalarSlots.get(callee);
  if (mandatory !== undefined && argCount === args.length) {
    const bad = shapes.findIndex((s, i) => mandatory.has(i) && s !== 'scalar');
    if (bad >= 0)
      decline(
        `the shader builtin \`${callee}\` requires a SCALAR ` +
          `${gpuSlotNames(mandatory)} — that argument is not ` +
          `genType-polymorphic, so there is no overload with a ` +
          `${gpuShapeName(shapes[bad])} standing there — but argument ` +
          `${bad + 1} lowers to a ${gpuShapeName(shapes[bad])}.`
      );
  }
  // And the mirror obligation, for a scalar the checks above left standing (a
  // builtin whose permission table admits a scalar in a slot the language
  // nonetheless declares `vecN`). Defensive: with today's tables every mixed
  // scalar/`vecN` call already declines above, and the ALL-SCALAR calls — the
  // ones this rule exists for — returned before reaching here.
  declineVectorOnly();
}

/**
 * Fold a variadic application of a 2-argument shader builtin (`min`/`max`)
 * into a left-nested tree of 2-argument calls: `max(max(a, b), c)`. GLSL and
 * WGSL do not accept a 3+-argument `min`/`max`, so emitting `max(a, b, c)`
 * would be invalid shader source.
 *
 * Each GENERATED call is validated as it is produced, against the ORIGINAL
 * operand shapes (`gpuOperandShape`) rather than against the emitted source:
 * once the fold has nested the calls, the CE operand positions no longer line
 * up with the emitted argument positions, and the generic gate's source-level
 * reconstruction (`gpuSourceIsVector`) cannot see a vector in a BARE
 * IDENTIFIER at all — so `ElementMax(2, v, w)` over two declared `vector<3>`
 * symbols emitted `max(max(2.0, v), w)`, which no GLSL driver accepts, behind
 * `success: true`. The accumulator's shape is exact by construction: it is a
 * vector as soon as any operand folded into it is one.
 *
 * With TWO operands the emission passes them through ONE FOR ONE, so the
 * generic gate already judges it on the same exact shapes (and phrases the
 * diagnostic in its own positional terms); only the nested calls of a longer
 * fold need the shapes carried in here.
 */
function foldNaryBuiltin(
  name: string,
  head: string,
  args: ReadonlyArray<Expression>,
  compile: (e: Expression) => string,
  rules: GPUShapeRules | undefined
): string {
  if (args.length === 0)
    throw new Error(`${name}: needs at least one argument`);
  if (args.length === 1) return compile(args[0]);
  const shapes = args.map(gpuOperandShape);
  const slots = rules?.scalarGenTypeSlots.get(name);
  // A builtin the language gives no scalar/genType overload AT ALL is judged
  // exactly by the generic gate already (it compares the CE operand shapes, not
  // the source, to reach its `requires MATCHING genType` verdict), so the fold
  // leaves that case — and the one-for-one two-operand case — to it.
  const check = slots !== undefined && args.length > 2;
  let acc = `${name}(${compile(args[0])}, ${compile(args[1])})`;
  let accShape = shapes[0];
  for (let i = 1; i < args.length; i++) {
    if (i > 1) acc = `${name}(${acc}, ${compile(args[i])})`;
    if (check) {
      const pair = [accShape, shapes[i]];
      const bad = pair.findIndex(
        (s, k) => s === 'scalar' && !slots!.has(k) && pair[1 - k] !== 'scalar'
      );
      if (bad >= 0)
        throw new Error(
          `${head}: the shader builtin \`${name}\` takes a scalar only ` +
            `${gpuSlotNames(slots!)}, but the emitted call \`${acc}\` has a ` +
            `scalar in argument ${bad + 1}, where the overload requires the ` +
            `\`vecN\` genType; the scalar is not promoted to a vector. ` +
            `Fail closed (D6).`
        );
    }
    // The accumulator is a vector as soon as any operand folded into it is.
    if (accShape === 'scalar') accShape = shapes[i];
  }
  return acc;
}

/**
 * The SCALAR component sources of a NON-SCALAR operand, or `undefined` when it
 * has none — what a shader reduction needs in order to consume a collection.
 *
 * Two routes, both derived from the emitted source and from the shape helpers
 * the rest of this file already uses, never from a list of head names:
 *
 *  - the operand lowers to an aggregate CONSTRUCTOR (`vec3(1.0, 2.0, 3.0)`,
 *    `float[5](…)`, `array<f32, 5>(…)`) — a `List`/`Tuple`/`Range` literal, and
 *    any other head that builds one. Its top-level arguments ARE the
 *    components. (`assertGPUScalarComponents` already guarantees a vector
 *    constructor's arguments are scalars; an argument that is itself an
 *    aggregate — a `matN`'s `vecN` columns — is refused here rather than folded
 *    into nonsense.)
 *  - the operand has a static `vec2`–`vec4` shape but no constructor to read (a
 *    declared `vector<3>` symbol, an expression over one): reduce over its
 *    swizzles. That repeats the operand's source once per component, so it is
 *    used verbatim only for a BARE identifier; anything compound is bound to a
 *    hoisted temporary first, and where there is no statement sink (inside a
 *    conditional arm — see `compileGPUConditionalArm`) there is no safe reading
 *    and this declines. Repeating a compound source is not merely slow:
 *    `_gpu_rnd_draw` advances a runtime counter, so a repeated draw shifts
 *    every later value in the shader.
 *
 * A matrix, or an array of unknown/runtime length, has no compile-time
 * component list at all, and a shader has no dynamic iteration to fall back on.
 */
function gpuScalarComponents(
  expr: Expression,
  code: string,
  target: CompileTarget<Expression>
): string[] | undefined {
  const call = gpuTopLevelCall(code);
  if (call !== undefined && GPU_AGGREGATE_CONSTRUCTOR.test(call.callee)) {
    if (call.operands.some((o) => GPU_AGGREGATE_CONSTRUCTOR_ANYWHERE.test(o)))
      return undefined;
    return call.operands.length > 0 ? call.operands : undefined;
  }
  const width = gpuOperandShape(expr);
  if (typeof width !== 'number') return undefined;
  const comps = ['x', 'y', 'z', 'w'].slice(0, width);
  if (/^[A-Za-z_]\w*$/.test(code)) return comps.map((c) => `${code}.${c}`);
  if (!BaseCompiler.canHoist(target)) return undefined;
  const tv = BaseCompiler.tempVar(target);
  const type = target.language === 'wgsl' ? `vec${width}f` : `vec${width}`;
  const decl =
    target.language === 'wgsl' ? `var ${tv}: ${type}` : `${type} ${tv}`;
  BaseCompiler.hoistStatement(target, `${decl} = ${code};`);
  return comps.map((c) => `${tv}.${c}`);
}

/**
 * Compile `Max`/`Min`.
 *
 * These are REDUCTIONS: the interpreter (`evaluateMinMax`) and the JavaScript
 * target (`compileExtremum`) both FLATTEN every collection operand and fold the
 * lot to ONE scalar — `Max([1,2,3])` is `3`, `Max([1,2,3], 5)` is `5`. The
 * shader `max`/`min` builtins are COMPONENTWISE, so reusing the scalar variadic
 * fold on a collection operand returned an AGGREGATE where a scalar was owed:
 * `Max([1,2,3])` emitted `vec3(1.0, 2.0, 3.0)` and `Max([1,2,3], 5)` emitted
 * `max(vec3(1.0, 2.0, 3.0), 5.0)` — valid shader source, wrong value, behind
 * `success: true`.
 *
 * With every operand a scalar nothing changes (`foldNaryBuiltin`). Otherwise
 * each non-scalar operand is destructured into its scalar components
 * (`gpuScalarComponents`) and everything is folded pairwise down to one scalar;
 * an operand with no compile-time component list fails closed (D6).
 *
 * An EMPTY collection operand contributes NO components, and is recognized
 * before its constructor is compiled: an empty list has no shader lowering at
 * all (neither language has a zero-length array type), so compiling it would
 * decline a reduction that has a perfectly good answer. `Max([], 5)` is `5`,
 * and `Max([])` — nothing left to fold — is the target NaN, which is what both
 * the interpreter and the JavaScript target return.
 *
 * The gate must not judge this emission against the operand shapes, which it no
 * longer contains: `Max([1,2,3,4,5])` (an `array` operand, no array overload)
 * and, on WGSL, `Max([1,2,3], 5)` (a scalar mixed with a `vec3f`, which WGSL's
 * `max` has no overload for) would both be declined although both reduce
 * correctly — as would the empty-collection NaN, whose WGSL spelling is a
 * `bitcast<f32>(…)` CALL over an `array`-shaped `[]` operand. That is why the
 * `Max`/`Min` entries in `GPU_FUNCTIONS` are wrapped in
 * `markAggregateConsuming`, which DECLARES the capability
 * (`GPU_AGGREGATE_CONSUMING`); `compile-gpu-extremum.test.ts` pins it. The
 * parentheses around the emission are ordinary precedence hygiene and carry no
 * part of that claim — the gate used to infer it from them, which let every
 * unrelated compound lowering past as well.
 */
function compileGPUExtremum(
  name: 'max' | 'min',
  head: string,
  args: ReadonlyArray<Expression>,
  compile: (e: Expression) => string,
  target: CompileTarget<Expression>
): string {
  if (args.length === 0)
    throw new Error(`${head}: needs at least one argument`);
  const shapes = args.map(gpuOperandShape);
  // An EMPTY collection contributes nothing to the fold. Recognized BEFORE the
  // operand is compiled: `[]` lowers to `float[0]()` / `array<f32, 0>()`, which
  // `assertGPUScalarComponents` refuses outright, so compiling it first would
  // decline the whole reduction.
  const isEmpty = args.map((a) => a.isCollection && a.count === 0);
  // Each operand is compiled EXACTLY ONCE: a second `compile()` of the same
  // operand would re-advance the `_gpu_rnd_draw` counter.
  const codes = args.map((a, i) => (isEmpty[i] ? '' : compile(a)));
  // Non-scalar by the shape analysis, OR by the emitted source: a `Range` types
  // only as `indexed_collection` (no `list` dimensions), which
  // `gpuOperandShape` reads as a scalar, but it lowers to an array
  // CONSTRUCTOR — and a constructor is exactly what a reduction can consume.
  const isAggregate = codes.map((c, i) => {
    if (isEmpty[i]) return true;
    if (shapes[i] !== 'scalar') return true;
    const call = gpuTopLevelCall(c);
    return call !== undefined && GPU_AGGREGATE_CONSTRUCTOR.test(call.callee);
  });
  const fold = (parts: ReadonlyArray<string>): string => {
    let acc = parts[0];
    for (let i = 1; i < parts.length; i++) acc = `${name}(${acc}, ${parts[i]})`;
    return acc;
  };
  // Every operand a scalar: the componentwise variadic fold, byte-identical to
  // what `foldNaryBuiltin` emitted.
  if (!isAggregate.some((x) => x)) return fold(codes);

  const parts: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (isEmpty[i]) continue;
    if (!isAggregate[i]) {
      parts.push(codes[i]);
      continue;
    }
    const comps = gpuScalarComponents(args[i], codes[i], target);
    if (comps === undefined)
      throw new Error(
        `${head}: the operand \`${args[i].toString()}\` lowers to a shader ` +
          `${gpuShapeName(shapes[i])} with no compile-time component list, so ` +
          `there is nothing for the reduction to fold over — a shader has no ` +
          `dynamic iteration here, and the \`${name}\` builtin is ` +
          `componentwise, not a reduction. Fail closed (D6).`
      );
    parts.push(...comps);
  }
  // Nothing left to fold — every operand was an empty collection. The
  // interpreter and the JavaScript target both answer NaN here (an empty
  // reduction has no extremum), and the shader NaN is reachable for a literal.
  if (parts.length === 0) return `(${gpuNaN(target)})`;
  return `(${fold(parts)})`;
}

/**
 * Compile a point-coordinate accessor (`PointX`/`PointY`/`PointZ`) as a GPU
 * swizzle. A single point is a `vec2`/`vec3`/`vec4`, so `.x`/`.y`/`.z` is
 * valid. A *list* of points is not a GPU value — a swizzle on it is invalid
 * shader source, so a list-of-points operand fails closed (D6) rather than
 * silently emitting garbage. A tuple type also matches `indexed_collection`, so
 * the single-point case is checked first.
 */
function compilePointSwizzle(
  arg: Expression,
  comp: 'x' | 'y' | 'z',
  compile: (e: Expression) => string
): string {
  const t = arg.type.type;
  const isSinglePoint = typeof t !== 'string' && t.kind === 'tuple';
  if (!isSinglePoint && arg.type.matches('indexed_collection'))
    throw new Error(
      `Point${comp.toUpperCase()}: a list of points has no GPU lowering ` +
        `(a point must be a single vec2/vec3/vec4). Fail closed.`
    );
  return `${compile(arg)}.${comp}`;
}

/**
 * Extract a lowercase string literal from a boxed expression, or `null`
 * if it isn't a string literal. Operators that need to switch on a
 * colorspace name at compile time use this to peek at the argument.
 */
function readStringLiteral(expr: Expression): string | null {
  if (!isString(expr)) return null;
  return expr.string?.toLowerCase() ?? null;
}

/** Compile an expression as a GPU integer argument.
 *  Integer constants emit as plain literals (`200`); other expressions
 *  are wrapped in a cast (`int(...)` or `i32(...)`). */
function compileIntArg(
  expr: Expression,
  compile: (e: Expression) => string,
  target?: CompileTarget<Expression>
): string {
  const c = tryGetConstant(expr);
  if (c !== undefined && Number.isInteger(c)) return c.toString();
  const intCast = target?.language === 'wgsl' ? 'i32' : 'int';
  return `${intCast}(${compile(expr)})`;
}

/** Maximum range for inline unrolling of Sum/Product loops in GPU targets. */
const GPU_UNROLL_LIMIT = 100;

/**
 * Fail closed (D6) on a Sum/Product bound that is statically non-finite (a
 * `±∞`/`NaN` literal, or an expression typed `non_finite_number`), so
 * `compile()` reports failure and the caller falls back to the interpreter.
 * `for (int i = 1; i <= _gpu_inf(); i++)` has no terminating condition (and is
 * a shader type error besides), so such a bound must never be emitted. Mirrors
 * `assertFiniteBound` in the JavaScript target.
 */
function assertFiniteGPUBound(
  kind: 'Sum' | 'Product',
  expr: Expression,
  which: 'lower' | 'upper'
): void {
  const nonFinite =
    (isNumber(expr) && !Number.isFinite(expr.re)) ||
    expr.type.matches('non_finite_number');
  if (!nonFinite) return;
  throw new Error(
    `${kind}: the ${which} bound \`${expr.toString()}\` is not a finite ` +
      `number — an infinite or NaN bound has no terminating loop. ` +
      `Fail closed (D6).`
  );
}

/**
 * Maximum absolute exponent for inlining an integer `Power` as repeated
 * multiplication (`x*x*x`), for a *simple* base only (symbol or number, so the
 * base subexpression can be safely repeated). Larger exponents — or any
 * compound base — route through the `_gpu_powi` preamble helper instead, which
 * evaluates the base once and keeps the sign correct for a negative base.
 */
const GPU_POWI_INLINE_LIMIT = 4;

/**
 * Compile a Sum or Product expression for GPU targets.
 *
 * Two compilation strategies:
 * - **Unrolled** (constant bounds, range ≤ GPU_UNROLL_LIMIT): pure inline
 *   expression with no statements, usable as a subexpression.
 * - **For-loop** (large or symbolic bounds): multi-line statement block
 *   ending with `return <acc>`, suitable for `compileFunction`.
 *
 * Complex-valued bodies are not supported (would require vec2 accumulation
 * with complex preamble helpers) and throw at compile time.
 */
function compileGPUSumProduct(
  kind: 'Sum' | 'Product',
  args: ReadonlyArray<Expression>,
  _compile: (expr: Expression) => string,
  target: CompileTarget<Expression>
): string {
  if (!args[0]) throw new Error(`${kind}: no body`);
  if (!args[1]) throw new Error(`${kind}: no indexing set`);

  // Reject a collection-valued body for the indexed form (see
  // `BaseCompiler.assertScalarBigOpBody`): scalar accumulation over arrays
  // would silently produce a wrong value. Reached only for the indexed form
  // (the `!args[1]` guard above rules out the reduce form).
  BaseCompiler.assertScalarBigOpBody(kind, args[0]);

  if (BaseCompiler.isComplexValued(args[0]))
    throw new Error(
      `${kind}: complex-valued body not supported in GPU targets`
    );

  // Multi-index Sum/Product (more than one indexing set) would drop the
  // trailing clauses. Fail closed (D6) rather than emit code with a dangling
  // index.
  if (args.length > 2)
    throw new Error(
      `${kind}: multi-index (${args.length - 1} indexing sets) is not supported in GPU targets`
    );

  const limitsExpr = args[1];
  if (!isFunction(limitsExpr, 'Limits'))
    throw new Error(`${kind}: expected Limits indexing set`);

  const limitsOps = limitsExpr.ops;
  const index = isSymbol(limitsOps[0]) ? limitsOps[0].symbol : '_';
  assertFiniteGPUBound(kind, limitsOps[1], 'lower');
  assertFiniteGPUBound(kind, limitsOps[2], 'upper');
  const lowerRe = limitsOps[1].re;
  const upperRe = limitsOps[2].re;
  const lowerNum =
    !isNaN(lowerRe) && Number.isFinite(lowerRe)
      ? Math.floor(lowerRe)
      : undefined;
  const upperNum =
    !isNaN(upperRe) && Number.isFinite(upperRe)
      ? Math.floor(upperRe)
      : undefined;

  const isSum = kind === 'Sum';
  const op = isSum ? '+' : '*';
  const identity = isSum ? '0.0' : '1.0';
  const isWGSL = target.language === 'wgsl';
  const bothConstant = lowerNum !== undefined && upperNum !== undefined;

  if (bothConstant && lowerNum > upperNum) return identity;

  // Unroll small constant ranges — pure inline expression
  if (bothConstant && upperNum - lowerNum + 1 <= GPU_UNROLL_LIMIT) {
    const terms: string[] = [];
    // Statements a term hoists (a nested loop-form Sum with a symbolic bound)
    // are drained into the ENCLOSING sink: the index is substituted as a
    // literal in `var` below, so nothing a term emits refers to the bound name,
    // and the statements are valid where the unrolled expression itself is.
    // Without an enclosing sink they have nowhere to go, and the term falls
    // back to the legacy multi-line block — which `compileValueOperand` then
    // rejects, as before (fail closed, D6).
    //
    // A term that hoists is drained IMMEDIATELY and its remaining value bound
    // to a temporary, which is what enters the combined expression. Collecting
    // every term's statements first and draining them at the end reordered the
    // unroll — term1-loop, term2-loop, term1-rest, term2-rest — and
    // `_gpu_rnd_draw` advances a runtime counter, so a draw in term2's loop
    // would move ahead of a draw in term1's remainder and every later value in
    // the shader would shift.
    for (let k = lowerNum; k <= upperNum; k++) {
      const kStr = formatGPUNumber(k);
      const termBoundVars = BaseCompiler.withBoundNames(target, [index]);
      const termSink = { stmts: [] as string[], boundVars: termBoundVars };
      const innerTarget: CompileTarget<Expression> = {
        ...target,
        var: (id) => (id === index ? kStr : target.var(id)),
        boundVars: termBoundVars,
        hoist: BaseCompiler.canHoist(target) ? termSink : undefined,
      };
      const code = BaseCompiler.compile(args[0], innerTarget);
      if (termSink.stmts.length === 0) {
        terms.push(`(${code})`);
        continue;
      }
      // The sink is non-empty only when `canHoist(target)` held above.
      const tv = BaseCompiler.tempVar(target);
      const scalar = isWGSL ? 'f32' : 'float';
      const decl = isWGSL ? `var ${tv}: ${scalar}` : `${scalar} ${tv}`;
      BaseCompiler.hoistStatement(
        target,
        ...termSink.stmts,
        `${decl} = ${code};`
      );
      terms.push(`(${tv})`);
    }
    return `(${terms.join(` ${op} `)})`;
  }

  // For-loop form. A shader has no expression-level loop, so this emits
  // STATEMENTS. When the enclosing position accepts hoisted statements (Tycho
  // item 110) they go to the sink and the loop's accumulator is returned as an
  // ordinary expression — so `1 + \sum…` and `0.03\sum…` compose. Otherwise the
  // legacy bare block is returned, valid only as a top-level function body.
  const acc = BaseCompiler.tempVar(target);
  const floatType = isWGSL ? 'f32' : 'float';
  const intType = isWGSL ? 'i32' : 'int';

  // The body binds `index`, so it gets its OWN sink: a statement it hoists
  // belongs inside this loop (a nested Sum), not ahead of it.
  const bodyBoundVars = BaseCompiler.withBoundNames(target, [index]);
  const bodySink = { stmts: [] as string[], boundVars: bodyBoundVars };
  const bodyTarget: CompileTarget<Expression> = {
    ...target,
    var: (id) =>
      id === index
        ? isWGSL
          ? `f32(${index})`
          : `float(${index})`
        : target.var(id),
    boundVars: bodyBoundVars,
    hoist: bodySink,
  };
  const body = BaseCompiler.compile(args[0], bodyTarget);

  // Compiled BEFORE the loop statements are pushed, so anything the bounds
  // themselves hoist lands ahead of the loop that consumes them.
  const lowerStr =
    lowerNum !== undefined
      ? String(lowerNum)
      : BaseCompiler.compile(limitsOps[1], target);
  const upperStr =
    upperNum !== undefined
      ? String(upperNum)
      : BaseCompiler.compile(limitsOps[2], target);

  // The loop index is declared and referenced bare — reject a reserved name
  // (fail closed, D6) rather than emit a shader that fails to compile.
  gpuCheckIdentifier(index, target.language);
  const accDecl = isWGSL ? `var ${acc}: ${floatType}` : `${floatType} ${acc}`;
  const indexDecl = isWGSL ? `var ${index}: ${intType}` : `${intType} ${index}`;

  const loop = [
    `${accDecl} = ${identity};`,
    `for (${indexDecl} = ${lowerStr}; ${index} <= ${upperStr}; ${index}++) {`,
    ...bodySink.stmts.map((s) =>
      s
        .split('\n')
        .map((l) => `  ${l}`)
        .join('\n')
    ),
    `  ${acc} ${op}= ${body};`,
    `}`,
  ];

  if (BaseCompiler.canHoist(target)) {
    BaseCompiler.hoistStatement(target, loop.join('\n'));
    return acc;
  }
  return [...loop, `return ${acc};`].join('\n');
}

/**
 * GPU shader functions shared by GLSL and WGSL.
 *
 * Both languages share identical built-in math functions. Language-specific
 * functions (inversesqrt naming, mod, vector constructors) are provided
 * by subclass overrides.
 *
 * Complex numbers are represented as vec2(re, im). Functions that can
 * operate on complex values check `BaseCompiler.isComplexValued()` and
 * dispatch to `_gpu_c*` helper functions from the complex preamble.
 */
export const GPU_FUNCTIONS: CompiledFunctions<Expression> = {
  // Variadic arithmetic (for function-call form, e.g., with vectors)
  Add: (args, compile, target) => {
    if (args.length === 0) return '0.0';
    if (args.length === 1) return compile(args[0]);
    const anyComplex = args.some((a) => BaseCompiler.isComplexValued(a));
    if (!anyComplex) {
      return foldTerms(
        args.map((x) => compile(x)),
        '0.0',
        '+',
        target.language
      );
    }
    // Try to decompose all operands into re/im parts
    const parts = args.map((a) =>
      tryGetComplexParts(a, compile, target.language)
    );
    if (parts.some((p) => p === null)) {
      // Opaque complex operand — fall back to promote-and-add
      const v2 = gpuVec2(target);
      return args
        .map((a) => {
          const code = compile(a);
          return BaseCompiler.isComplexValued(a) ? code : `${v2}(${code}, 0.0)`;
        })
        .join(' + ');
    }
    // All decomposed — collect re and im parts, fold each
    const reParts: string[] = [];
    const imParts: string[] = [];
    for (const p of parts) {
      if (p!.re !== null) reParts.push(p!.re);
      if (p!.im !== null) imParts.push(p!.im);
    }
    const reSum = foldTerms(reParts, '0.0', '+', target.language);
    const imSum = foldTerms(imParts, '0.0', '+', target.language);
    return `${gpuVec2(target)}(${reSum}, ${imSum})`;
  },
  Multiply: (args, compile, target) => {
    if (args.length === 0) return '1.0';
    if (args.length === 1) return compile(args[0]);
    const anyComplex = args.some((a) => BaseCompiler.isComplexValued(a));
    if (!anyComplex) {
      return foldTerms(
        args.map((x) => compile(x)),
        '1.0',
        '*',
        target.language
      );
    }
    // Special case: scalars * imaginary_factor → vec2(0.0, product)
    // Recognizes both ImaginaryUnit symbol and Complex(0, k) literals
    const iIndex = args.findIndex(
      (op) =>
        isSymbol(op, 'ImaginaryUnit') ||
        (isNumber(op) && op.re === 0 && op.im !== 0)
    );
    if (iIndex >= 0) {
      const iFactor = args[iIndex];
      const iScale = isSymbol(iFactor, 'ImaginaryUnit')
        ? 1
        : (iFactor as any).im;
      const realFactors = args.filter((_, i) => i !== iIndex);
      const v2 = gpuVec2(target);
      if (realFactors.length === 0)
        return `${v2}(0.0, ${formatFloat(iScale, target.language)})`;
      const factors = realFactors.map((f) => parenthesizeFactor(f, compile(f)));
      if (iScale !== 1) factors.unshift(formatFloat(iScale, target.language));
      const imCode = foldTerms(factors, '1.0', '*', target.language);
      return `${v2}(0.0, ${imCode})`;
    }
    // General complex multiply: separate real scalars and complex operands
    const realCodes: string[] = [];
    const complexCodes: string[] = [];
    for (const a of args) {
      if (BaseCompiler.isComplexValued(a)) complexCodes.push(compile(a));
      else realCodes.push(parenthesizeFactor(a, compile(a)));
    }
    const scalarCode = foldTerms(realCodes, '1.0', '*', target.language);
    // Pairwise reduce complex operands
    let result = complexCodes[0];
    for (let i = 1; i < complexCodes.length; i++) {
      result = `_gpu_cmul(${result}, ${complexCodes[i]})`;
    }
    // Apply scalar factor
    if (scalarCode !== '1.0') result = `(${scalarCode} * ${result})`;
    return result;
  },
  // No Subtract function handler — Subtract canonicalizes to Add+Negate.
  // The operator entry in GPU_OPERATORS handles any edge cases.
  Divide: (args, compile, target) => {
    if (args.length === 0) return '1.0';
    if (args.length === 1) return compile(args[0]);
    const ac = BaseCompiler.isComplexValued(args[0]);
    const bc = args.length >= 2 && BaseCompiler.isComplexValued(args[1]);
    if (!ac && !bc) {
      if (args.length === 2) {
        const a = tryGetConstant(args[0]);
        const b = tryGetConstant(args[1]);
        if (a !== undefined && b !== undefined && b !== 0)
          return formatFloat(a / b, target.language);
        if (b === 1) return compile(args[0]);
        // `compile()` emits sub-expressions without outer parentheses — wrap
        // before splicing next to `/`.
        return `(${compile(args[0])}) / (${compile(args[1])})`;
      }
      let result = `(${compile(args[0])})`;
      for (let i = 1; i < args.length; i++)
        result = `${result} / (${compile(args[i])})`;
      return result;
    }
    // Complex division
    if (ac && bc) return `_gpu_cdiv(${compile(args[0])}, ${compile(args[1])})`;
    if (ac && !bc) return `((${compile(args[0])}) / (${compile(args[1])}))`;
    const v2 = gpuVec2(target);
    return `_gpu_cdiv(${v2}(${compile(args[0])}, 0.0), ${compile(args[1])})`;
  },
  Negate: ([x], compile, target) => {
    if (x === null) throw new Error('Negate: no argument');
    const c = tryGetConstant(x);
    if (c !== undefined) return formatFloat(-c, target.language);
    if (isNumber(x) && x.im !== 0) {
      return `${gpuVec2(target)}(${formatFloat(
        -x.re,
        target.language
      )}, ${formatFloat(-x.im, target.language)})`;
    }
    if (isSymbol(x, 'ImaginaryUnit')) return `${gpuVec2(target)}(0.0, -1.0)`;
    return `(-(${compile(x)}))`;
  },

  // Standard math functions with complex dispatch
  // Note: `Abs` of a fixed-arity point never reaches this handler — the
  // shared compiler rewrites `Abs(Tuple)` → `Norm` (base-compiler.ts) so the
  // point compiles through the `Norm` codegen below (Tycho item 74).
  Abs: (args, compile) => {
    if (BaseCompiler.isComplexValued(args[0]))
      return `length(${compile(args[0])})`;
    if (BaseCompiler.isNonNegative(args[0])) return compile(args[0]);
    return `abs(${compile(args[0])})`;
  },
  Arccos: (args, compile, target) => {
    if (BaseCompiler.isComplexValued(args[0]))
      return `_gpu_cacos(${compile(args[0])})`;
    // Real operand, complex RESULT (`Arccos(2)`, or a real symbol of unknown
    // magnitude): outside `[−1, 1]` the value is complex, so the node is typed
    // `finite_complex` and the parent emits the `vec2` convention — a scalar
    // `acos` there is broadcast against a `vec2` and yields garbage. See
    // `gpuResultIsComplexValued`.
    if (gpuResultIsComplexValued('Arccos', args))
      return `_gpu_cacos(${gpuComplexOperand(args[0], compile, target)})`;
    return `acos(${compile(args[0])})`;
  },
  Arcsin: (args, compile, target) => {
    if (BaseCompiler.isComplexValued(args[0]))
      return `_gpu_casin(${compile(args[0])})`;
    if (gpuResultIsComplexValued('Arcsin', args))
      return `_gpu_casin(${gpuComplexOperand(args[0], compile, target)})`;
    return `asin(${compile(args[0])})`;
  },
  Arctan: (args, compile) => {
    if (BaseCompiler.isComplexValued(args[0]))
      return `_gpu_catan(${compile(args[0])})`;
    return `atan(${compile(args[0])})`;
  },
  Ceil: (args, compile) => {
    if (BaseCompiler.isIntegerValued(args[0])) return compile(args[0]);
    return `ceil(${compile(args[0])})`;
  },
  Clamp: 'clamp',
  Cos: (args, compile) => {
    if (BaseCompiler.isComplexValued(args[0]))
      return `_gpu_ccos(${compile(args[0])})`;
    return `cos(${compile(args[0])})`;
  },
  // CE's `Degrees` converts degrees→radians (Degrees(180) = π), which is
  // GLSL's `radians()`. GLSL's `degrees()` is the inverse (rad→deg).
  Degrees: 'radians',
  Exp: (args, compile) => {
    if (BaseCompiler.isComplexValued(args[0]))
      return `_gpu_cexp(${compile(args[0])})`;
    return `exp(${compile(args[0])})`;
  },
  Exp2: 'exp2',
  // Component access — assumes the argument compiles to a vec2/vec3/vec4
  // (the common case for 2D/3D points). For 5+-element tuples that compile
  // to `float[N]` arrays, swizzle access is invalid GLSL and the shader
  // will fail to compile; that's an edge case `First`/`Second`/`Third`
  // aren't designed for. Vec swizzles are identical between GLSL and WGSL.
  First: (args, compile) => `${compile(args[0])}.x`,
  Second: (args, compile) => `${compile(args[0])}.y`,
  Third: (args, compile) => `${compile(args[0])}.z`,
  // Point-coordinate accessors. On the GPU a point is a `vec2`/`vec3`/`vec4`,
  // so a single point maps to the same swizzle as First/Second/Third. A list of
  // points is not a GPU value: emitting a swizzle on it produces invalid shader
  // source, so a list-of-points operand fails closed (D6) rather than compiling
  // to garbage behind `success: true`.
  PointX: (args, compile) => compilePointSwizzle(args[0], 'x', compile),
  PointY: (args, compile) => compilePointSwizzle(args[0], 'y', compile),
  PointZ: (args, compile) => compilePointSwizzle(args[0], 'z', compile),
  Floor: (args, compile) => {
    if (BaseCompiler.isIntegerValued(args[0])) return compile(args[0]);
    return `floor(${compile(args[0])})`;
  },
  Fract: 'fract',
  Ln: (args, compile, target) => {
    if (BaseCompiler.isComplexValued(args[0]))
      return `_gpu_cln(${compile(args[0])})`;
    // PROVABLY negative real operand, complex result (`a := -2` → `Ln(a)` is
    // `finite_complex`): the parent emits the `vec2` convention. An operand of
    // merely UNKNOWN sign keeps the scalar `log` (pinned; the
    // `isComplexValued` Sqrt/Ln/Log carve-out makes the parent agree). See
    // `gpuResultIsComplexValued`.
    if (args[0]?.isNegative === true && gpuResultIsComplexValued('Ln', args))
      return `_gpu_cln(${gpuComplexOperand(args[0], compile, target)})`;
    return `log(${compile(args[0])})`;
  },
  Log2: 'log2',
  // GLSL/WGSL `min`/`max` are strictly 2-argument builtins; a variadic
  // `max(a, b, c)` is invalid shader source. Fold 3+ arguments into a nest of
  // 2-argument calls: `max(max(a, b), c)`. A COLLECTION operand makes these a
  // reduction rather than a componentwise fold — see `compileGPUExtremum`.
  // `markAggregateConsuming`: the reduction DESTRUCTURES its collection
  // operands, so the generic shape gate must not judge the emission against
  // operand shapes the emission no longer contains (`GPU_AGGREGATE_CONSUMING`).
  Max: markAggregateConsuming((args, compile, target) =>
    compileGPUExtremum('max', 'Max', args, compile, target)
  ),
  Min: markAggregateConsuming((args, compile, target) =>
    compileGPUExtremum('min', 'Min', args, compile, target)
  ),
  // Element-wise max/min — genuinely COMPONENTWISE, unlike `Max`/`Min` above,
  // so the native fold is the right lowering for a `vecN` operand too. Both
  // require at least two operands (a lone collection is a `Max`/`Min`, and CE
  // rejects `ElementMax([1,2,3])` as missing an argument), so the reduction
  // case does not arise. (`Clamp` is mapped to the native `clamp` above.)
  ElementMax: (args, compile, target) =>
    foldNaryBuiltin('max', 'ElementMax', args, compile, gpuShapeRules(target)),
  ElementMin: (args, compile, target) =>
    foldNaryBuiltin('min', 'ElementMin', args, compile, gpuShapeRules(target)),
  Mix: 'mix',
  // Control-flow forms — the base compiler's default emits a JS ternary and a
  // bare `NaN`, neither of which is valid GPU code (WGSL has no `?:`, and no
  // shader language has a `NaN` identifier). Emit `select(...)` for WGSL and a
  // language-appropriate NaN.
  //
  // DIVERGENCE (documented, CO-P2-24): a shader cannot throw. Where the
  // interpreter throws on a non-boolean/NaN `Which`/`When` condition, the GPU
  // target instead falls through to the documented fail-closed value (the else
  // branch / NaN) — the JS target aligns via a runtime throw, which is not
  // expressible here.
  If: (args, compile, target) => {
    if (args.length !== 3) throw new Error('If: wrong number of arguments');
    // The condition is evaluated unconditionally, so it may hoist; the two arms
    // are selected and must not (see `compileGPUConditionalArm`).
    return gpuConditional(
      compile(args[0]),
      compileGPUConditionalArm('If', () => compile(args[1]), target),
      compileGPUConditionalArm('If', () => compile(args[2]), target),
      target
    );
  },
  When: (args, compile, target) => {
    if (args.length !== 2)
      throw new Error('When: expected exactly 2 arguments (expr, cond)');
    // `When` is deliberately NOT a selection form (elementwise-Which design
    // §5): its condition must be a scalar boolean. A provably collection-valued
    // condition would otherwise emit garbage (`(vec2(True, False)) ? …`).
    BaseCompiler.assertScalarCondition(args[1]);
    if (isSymbol(args[1], 'True')) return `(${compile(args[0])})`;
    // The masked branch's NaN must match the value's SHAPE (a tuple-valued
    // body compiles to a vecN) — see `gpuNaNFor` (Tycho item 49).
    if (isSymbol(args[1], 'False')) return gpuNaNFor(args[0], target);
    return gpuConditional(
      compile(args[1]),
      compileGPUConditionalArm('When', () => compile(args[0]), target),
      gpuNaNFor(args[0], target),
      target
    );
  },
  Which: (args, compile, target) => {
    if (args.length < 2 || args.length % 2 !== 0)
      throw new Error('Which: expected condition/value pairs');
    // The fall-through NaN must match the branch values' shape (see
    // `gpuNaNFor`); every branch of a well-typed `Which` shares one shape,
    // so the first determinable value decides.
    const shapeRef =
      args.filter((_, i) => i % 2 === 1).find((v) => gpuComponentCount(v)) ??
      null;
    const build = (i: number): string => {
      if (i >= args.length) return gpuNaNFor(shapeRef, target);
      const cond = args[i];
      const val = args[i + 1];
      // Only the FIRST condition is evaluated unconditionally. Every value, and
      // every LATER condition, sits behind a branch and must not hoist out of
      // it. (`build(i + 2)` needs no wrapper of its own: it guards its own
      // pieces on the next turn of the recursion.)
      const armed = (f: () => string): string =>
        i === 0 ? f() : compileGPUConditionalArm('Which', f, target);
      // `True` marks the default branch.
      if (isSymbol(cond, 'True')) return `(${armed(() => compile(val))})`;
      return gpuConditional(
        armed(() => compile(cond)),
        compileGPUConditionalArm('Which', () => compile(val), target),
        build(i + 2),
        target
      );
    };
    return build(0);
  },
  // Cortex `Match`: tier-0/1 constant dispatch as a nested `select`/ternary with
  // `==` comparisons, the subject inlined into each comparison (deterministic on
  // GPU). Tier-2 destructuring, refutable tier-3, and string constants (no
  // string type) fail closed (D6). See BaseCompiler.compileMatchTernary.
  // `compileMatchTernary` compiles the pieces itself, so the no-hoist guard is
  // handed to it (`arm`) and applied PER PIECE — each case body, each case
  // guard, and each condition past the first — the way the `If`/`Which`
  // lowerings do. The SUBJECT stays outside it: it is compiled first and
  // evaluated unconditionally, so a loop-form `Sum` there is safe to hoist.
  Match: (args, _compile, target) =>
    BaseCompiler.compileMatchTernary(args[0]!.engine, args, target, {
      ternary: (c, t, e) => gpuConditional(c, t, e, target),
      eq: '==',
      noMatch: gpuNaN(target),
      allowStrings: false,
      arm: (f) => compileGPUConditionalArm('Match', f, target),
    }),
  Power: (args, compile, target) => {
    const base = args[0];
    const exp = args[1];
    if (base === null) throw new Error('Power: no argument');
    if (
      BaseCompiler.isComplexValued(base) ||
      BaseCompiler.isComplexValued(exp)
    ) {
      if (isSymbol(base, 'ExponentialE')) return `_gpu_cexp(${compile(exp)})`;
      const v2 = gpuVec2(target);
      const bCode = BaseCompiler.isComplexValued(base)
        ? compile(base)
        : `${v2}(${compile(base)}, 0.0)`;
      const eCode = BaseCompiler.isComplexValued(exp)
        ? compile(exp)
        : `${v2}(${compile(exp)}, 0.0)`;
      return `_gpu_cpow(${bCode}, ${eCode})`;
    }
    const bConst = tryGetConstant(base);
    const eConst = tryGetConstant(exp);
    if (bConst !== undefined && eConst !== undefined) {
      const r = Math.pow(bConst, eConst);
      // `Math.pow` (like the shader `pow`) is NaN for every negative base with
      // a non-integer exponent, which is narrower than CE's branch convention.
      // WHICH value is folded is decided by the node's TYPE — the same ruling
      // as the JavaScript target's `NO_REAL_VALUE_FOLD`, and as of 2026-07-30
      // the type distinguishes the two branches:
      // - An EVEN reduced-rational denominator is the complex branch and the
      //   node is typed `finite_complex`, so the enclosing emission is the
      //   `vec2(re, im)` convention. Fold the principal complex value; a
      //   scalar NaN there would be silently scalar-broadcast into a
      //   `vec2(NaN, NaN)` (valid shader source, wrong value).
      // - An ODD denominator has a real root (`(−8)^(2/3) = 4`) that `pow`
      //   misses; the node stays `finite_number` and folds to that real value.
      // - An unprovable branch keeps the shader NaN fold: it is exactly what
      //   this head's OWN `pow` lowering yields once the base is a runtime
      //   variable (`pow(x, 0.3)` at `x = -2`), so refusing only the
      //   provable-constant case buys no safety.
      if (Number.isNaN(r)) {
        if (gpuResultIsComplexValued('Power', args))
          return gpuComplexPowLiteral(bConst, eConst, target);
        const real = negativeBaseRealPow(bConst, exp, eConst);
        if (real !== undefined) return formatFloat(real, target.language);
      }
      return formatFloat(r, target.language);
    }
    // Real-emitted operands but a complex RESULT type (a negative base on the
    // even-denominator branch, e.g. `a^{0.3}` with `a ⩴ -2`). The enclosing
    // emission is `vec2(re, im)`; a scalar `pow` here would scalar-broadcast
    // into a silent `vec2(NaN, NaN)`. See `gpuResultIsComplexValued`.
    if (gpuResultIsComplexValued('Power', args))
      return `_gpu_cpow(${gpuComplexOperand(base, compile, target)}, ${gpuComplexOperand(exp, compile, target)})`;
    if (eConst === 0) return '1.0';
    if (eConst === 1) return compile(base);
    if (eConst === 0.5) return `sqrt(${compile(base)})`;
    // Literal integer exponent: emit sign-preserving code. GLSL/WGSL `pow(x, y)`
    // is spec-defined as `exp2(y·log2(x))` and is undefined for a negative base
    // even when `y` is an integer-valued literal — on a real GPU `pow(-2.0, 3.0)`
    // returns `+8`, flipping the sign of odd powers (and `pow(-2.0, 2.0)` is NaN,
    // since `log2` of a negative is NaN). Emit repeated multiplication (small
    // exponents, simple base) or the sign-preserving `_gpu_powi` helper instead.
    if (eConst !== undefined && Number.isInteger(eConst)) {
      const n = eConst;
      const absN = Math.abs(n);
      let pos: string;
      if (absN === 1) {
        pos = `(${compile(base)})`;
      } else if (
        (isSymbol(base) || isNumber(base)) &&
        absN <= GPU_POWI_INLINE_LIMIT
      ) {
        // Simple base (no side effects, cheap to repeat) with a small exponent:
        // unroll to repeated multiplication — exact and free of any `pow` call.
        const code = compile(base);
        pos = `(${Array(absN).fill(code).join(' * ')})`;
      } else {
        // Compound or large: route through the helper so the base subexpression
        // is evaluated once (not duplicated) and the sign stays correct.
        pos = `_gpu_powi(${compile(base)}, ${formatGPUNumber(absN)})`;
      }
      return n < 0 ? `(1.0 / ${pos})` : pos;
    }
    // DIVERGENCE (documented, CO-P2-24): a literal `0^0` folds to NaN at
    // canonicalization and then fails closed here (no GPU NaN literal); `x^0`
    // folds to 1. A *runtime* dynamic `0^0` reaches `pow(0.0, 0.0)`, which is
    // undefined in GLSL/WGSL and cannot be made to yield NaN (no NaN literal),
    // so it is left to the hardware — the JS target aligns this via `_SYS.pow`.
    // A genuinely fractional exponent (e.g. `x^2.5`) stays `pow`: it is
    // undefined for a negative base mathematically too under realOnly.
    return `pow(${compile(base)}, ${compile(exp)})`;
  },
  Radians: 'radians',
  Round: (args, compile, target) => {
    // GLSL/WGSL `round()` rounds half to even (implementation-defined ties);
    // the interpreter rounds half away from zero (Round(-2.5) = -3).
    // Reconstruct half-away as `sign(x)·floor(|x| + 0.5)`.
    const halfAway = (c: string): string =>
      `(sign(${c}) * floor(abs(${c}) + 0.5))`;
    if (args.length < 2) {
      if (BaseCompiler.isIntegerValued(args[0])) return compile(args[0]);
      return halfAway(compile(args[0]));
    }
    // The SECOND operand is a precision: `Round(x, n)` rounds to `n` DECIMAL
    // PLACES (the Desmos/spreadsheet form the signature `(number, integer?)`
    // declares) — `Round(x·10ⁿ)/10ⁿ`, which is what the interpreter and the
    // JavaScript and interval targets all compute. This lowering used to
    // consume only `args[0]`, so `Round(3.14159, 2)` emitted the round-to-
    // integer form and reported success on a shader computing `3` where the
    // interpreter answers `157/50`.
    //
    // The factor must be a compile-time constant. A shader `pow(10.0, n)` for
    // a RUNTIME `n` is spec-defined as `exp2(n·log2(10.0))`, which is not
    // exactly a power of ten — it moves the very tie boundary the rounding it
    // scales for depends on — and neither language has an integer `pow` to
    // fall back on. A non-constant precision therefore fails closed (D6), as
    // it already does on the interval target.
    const n = tryGetConstant(args[1]);
    if (n === undefined || !Number.isInteger(n))
      throw new Error(
        `Round: rounding to \`n\` decimal places compiles on the ` +
          `${target.language ?? 'GPU'} target only for a compile-time ` +
          `INTEGER precision — the factor 10ⁿ has to be folded, because a ` +
          `shader \`pow(10.0, n)\` is \`exp2(n·log2(10.0))\` and is not ` +
          `exactly a power of ten. Fail closed (D6).`
      );
    // 10ⁿ and its reciprocal must both be representable as a shader float
    // (f32 normals stop at ~3.4e38 / ~1.2e-38); past that the emitted literal
    // is an infinity and the whole expression collapses to 0 or NaN.
    if (Math.abs(n) > 37)
      throw new Error(
        `Round: the rounding factor 10^${n} is outside the shader float ` +
          `range. Fail closed (D6).`
      );
    // An integer-valued operand is unchanged by rounding to a NON-NEGATIVE
    // number of decimal places (it is not, for a negative `n`, which rounds
    // to tens, hundreds, …).
    if (n >= 0 && BaseCompiler.isIntegerValued(args[0]))
      return compile(args[0]);
    const factor = formatFloat(Math.pow(10, n), target.language);
    return `(${halfAway(`(${compile(args[0])} * ${factor})`)} / ${factor})`;
  },
  Sign: 'sign',
  Sin: (args, compile) => {
    if (BaseCompiler.isComplexValued(args[0]))
      return `_gpu_csin(${compile(args[0])})`;
    return `sin(${compile(args[0])})`;
  },
  Smoothstep: 'smoothstep',
  Sqrt: (args, compile, target) => {
    if (BaseCompiler.isComplexValued(args[0]))
      return `_gpu_csqrt(${compile(args[0])})`;
    const c = tryGetConstant(args[0]);
    if (c !== undefined) {
      // A NEGATIVE constant has no real square root, and a canonical
      // `Sqrt(negative)` is typed `complex` — so the enclosing emission is the
      // vec2(re, im) complex codegen, and the folded constant must agree with
      // it. Fold the complex principal value (the interpreter's answer, and the
      // JS target's `complexSqrtLiteral`), never a scalar NaN, which the
      // surrounding complex arithmetic would consume as a real.
      if (c < 0)
        return `${gpuVec2(target)}(0.0, ${formatFloat(
          Math.sqrt(-c),
          target.language
        )})`;
      return formatFloat(Math.sqrt(c), target.language);
    }
    // The operand is real-emitted but PROVABLY negative (a symbol with an
    // assigned negative value: `a := -2`), so the result is complex. The
    // enclosing emission is the `vec2(re, im)` convention, and shader
    // scalar-broadcast would silently turn a `sqrt(-2.0)` NaN into
    // `vec2(NaN, NaN)`. An operand of merely UNKNOWN sign keeps the scalar
    // `sqrt` (pinned; the `isComplexValued` Sqrt/Ln/Log carve-out makes the
    // parent agree). See `gpuResultIsComplexValued`.
    if (args[0]?.isNegative === true && gpuResultIsComplexValued('Sqrt', args))
      return `_gpu_csqrt(${gpuComplexOperand(args[0], compile, target)})`;
    return `sqrt(${compile(args[0])})`;
  },
  Step: 'step',
  Tan: (args, compile) => {
    if (BaseCompiler.isComplexValued(args[0]))
      return `_gpu_ctan(${compile(args[0])})`;
    return `tan(${compile(args[0])})`;
  },
  Truncate: (args, compile) => {
    if (BaseCompiler.isIntegerValued(args[0])) return compile(args[0]);
    return `trunc(${compile(args[0])})`;
  },

  // Complex-specific functions
  Real: (args, compile) => {
    if (BaseCompiler.isComplexValued(args[0])) return `(${compile(args[0])}).x`;
    return compile(args[0]);
  },
  Imaginary: (args, compile) => {
    if (BaseCompiler.isComplexValued(args[0])) return `(${compile(args[0])}).y`;
    return '0.0';
  },
  Argument: (args, compile, target) => {
    if (BaseCompiler.isComplexValued(args[0])) {
      const code = compile(args[0]);
      return `atan(${code}.y, ${code}.x)`;
    }
    // A real value's argument is 0 (x ≥ 0) or π (x < 0). Use the
    // target-appropriate conditional: WGSL has no `?:`, so this becomes
    // `select(3.14159265359, 0.0, x >= 0.0)`.
    return gpuConditional(
      `${compile(args[0])} >= 0.0`,
      '0.0',
      '3.14159265359',
      target
    );
  },
  Conjugate: (args, compile, target) => {
    if (BaseCompiler.isComplexValued(args[0])) {
      const v2 = gpuVec2(target);
      const code = compile(args[0]);
      return `${v2}(${code}.x, -${code}.y)`;
    }
    return compile(args[0]);
  },

  Remainder: ([a, b], compile, target) => {
    if (a === null || b === null)
      throw new Error('Remainder: missing argument');
    // An IMPURE operand (the Random family) must be evaluated exactly once:
    // both operands are spliced twice, and `_gpu_rnd_draw` advances a runtime
    // counter, so a repeated draw returns a different value AND shifts every
    // later draw in the shader. Bind scalars to hoisted temporaries; where
    // there is no statement sink (a conditional arm), or the operand is not
    // a scalar, there is no safe reading — decline.
    if (a.isPure === false || b.isPure === false) {
      if (
        !BaseCompiler.canHoist(target) ||
        gpuOperandShape(a) !== 'scalar' ||
        gpuOperandShape(b) !== 'scalar'
      )
        throw new Error(
          'Remainder: an impure (Random) operand cannot be bound to a ' +
            'temporary at this position — a repeated draw would shift every ' +
            'later value in the shader. Fail closed (D6).'
        );
      const ta = BaseCompiler.tempVar(target);
      const tb = BaseCompiler.tempVar(target);
      const decl = (n: string) =>
        target.language === 'wgsl' ? `var ${n}: f32` : `float ${n}`;
      BaseCompiler.hoistStatement(
        target,
        `${decl(ta)} = ${compile(a)};`,
        `${decl(tb)} = ${compile(b)};`
      );
      return `(${ta} - ${tb} * round(${ta} / ${tb}))`;
    }
    // `compile()` emits sub-expressions without outer parentheses, and
    // `*`/`/` bind tighter than `+` — wrap before splicing.
    const ca = `(${compile(a)})`;
    const cb = `(${compile(b)})`;
    return `(${ca} - ${cb} * round(${ca} / ${cb}))`;
  },

  // Reciprocal trigonometric functions (no GPU built-ins)
  Cot: ([x], compile, target) => {
    if (x === null) throw new Error('Cot: no argument');
    if (BaseCompiler.isComplexValued(x)) {
      // The operand is spliced TWICE below, so an IMPURE one must first be
      // bound to a hoisted temporary — compiling it once is not enough, since
      // `_gpu_rnd_draw` advances its counter on every evaluation of the
      // spliced text (see the real branch and `Remainder`).
      if (x.isPure === false) {
        if (!BaseCompiler.canHoist(target))
          throw new Error(
            'Cot: an impure (Random) complex operand cannot be bound to a ' +
              'temporary at this position — a repeated draw would shift ' +
              'every later value in the shader. Fail closed (D6).'
          );
        const t = BaseCompiler.tempVar(target);
        const decl =
          target.language === 'wgsl'
            ? `var ${t}: ${gpuVec2(target)}`
            : `${gpuVec2(target)} ${t}`;
        BaseCompiler.hoistStatement(target, `${decl} = ${compile(x)};`);
        return `_gpu_cdiv(_gpu_ccos(${t}), _gpu_csin(${t}))`;
      }
      // Compile the operand ONCE: two `compile()` calls would allocate two
      // distinct `_gpu_rnd` sites for an impure operand.
      const z = compile(x);
      return `_gpu_cdiv(_gpu_ccos(${z}), _gpu_csin(${z}))`;
    }
    // An IMPURE operand (Random) is spliced twice below, and `_gpu_rnd_draw`
    // advances a runtime counter — bind it to a hoisted temporary, or decline
    // where there is no statement sink (see `Remainder`).
    if (x.isPure === false) {
      if (!BaseCompiler.canHoist(target) || gpuOperandShape(x) !== 'scalar')
        throw new Error(
          'Cot: an impure (Random) operand cannot be bound to a temporary ' +
            'at this position — a repeated draw would shift every later ' +
            'value in the shader. Fail closed (D6).'
        );
      const t = BaseCompiler.tempVar(target);
      const decl =
        target.language === 'wgsl' ? `var ${t}: f32` : `float ${t}`;
      BaseCompiler.hoistStatement(target, `${decl} = ${compile(x)};`);
      return `(cos(${t}) / sin(${t}))`;
    }
    const arg = compile(x);
    return `(cos(${arg}) / sin(${arg}))`;
  },
  Csc: ([x], compile, target) => {
    if (x === null) throw new Error('Csc: no argument');
    if (BaseCompiler.isComplexValued(x)) {
      const v2 = gpuVec2(target);
      return `_gpu_cdiv(${v2}(1.0, 0.0), _gpu_csin(${compile(x)}))`;
    }
    return `(1.0 / sin(${compile(x)}))`;
  },
  Sec: ([x], compile, target) => {
    if (x === null) throw new Error('Sec: no argument');
    if (BaseCompiler.isComplexValued(x)) {
      const v2 = gpuVec2(target);
      return `_gpu_cdiv(${v2}(1.0, 0.0), _gpu_ccos(${compile(x)}))`;
    }
    return `(1.0 / cos(${compile(x)}))`;
  },

  // Inverse trigonometric (reciprocal)
  Arccot: ([x], compile) => {
    if (x === null) throw new Error('Arccot: no argument');
    // `atan(1/x)` returns the wrong branch for x < 0. `π/2 - atan(x)` is
    // branch-free and matches the interpreter's (0, π) range for all real x.
    return `(1.5707963267948966 - atan(${compile(x)}))`;
  },
  Arccsc: ([x], compile, target) => {
    if (x === null) throw new Error('Arccsc: no argument');
    if (
      BaseCompiler.isComplexValued(x) ||
      gpuResultIsComplexValued('Arccsc', [x])
    )
      return gpuReciprocalComplex('_gpu_casin', x, compile, target);
    return `asin(1.0 / (${compile(x)}))`;
  },
  Arcsec: ([x], compile, target) => {
    if (x === null) throw new Error('Arcsec: no argument');
    if (
      BaseCompiler.isComplexValued(x) ||
      gpuResultIsComplexValued('Arcsec', [x])
    )
      return gpuReciprocalComplex('_gpu_cacos', x, compile, target);
    return `acos(1.0 / (${compile(x)}))`;
  },

  // Hyperbolic functions with complex dispatch
  Sinh: (args, compile) => {
    if (BaseCompiler.isComplexValued(args[0]))
      return `_gpu_csinh(${compile(args[0])})`;
    return `sinh(${compile(args[0])})`;
  },
  Cosh: (args, compile) => {
    if (BaseCompiler.isComplexValued(args[0]))
      return `_gpu_ccosh(${compile(args[0])})`;
    return `cosh(${compile(args[0])})`;
  },
  Tanh: (args, compile) => {
    if (BaseCompiler.isComplexValued(args[0]))
      return `_gpu_ctanh(${compile(args[0])})`;
    return `tanh(${compile(args[0])})`;
  },

  // Reciprocal hyperbolic functions
  Coth: ([x], compile, target) => {
    if (x === null) throw new Error('Coth: no argument');
    // Both branches splice the operand twice — an impure one is bound to a
    // hoisted temporary (see `gpuOperandOnce` and the `Cot` handler).
    if (BaseCompiler.isComplexValued(x)) {
      const z = gpuOperandOnce('Coth', x, compile, target, true);
      return `_gpu_cdiv(_gpu_ccosh(${z}), _gpu_csinh(${z}))`;
    }
    const arg = gpuOperandOnce('Coth', x, compile, target);
    return `(cosh(${arg}) / sinh(${arg}))`;
  },
  Csch: ([x], compile, target) => {
    if (x === null) throw new Error('Csch: no argument');
    if (BaseCompiler.isComplexValued(x)) {
      const v2 = gpuVec2(target);
      return `_gpu_cdiv(${v2}(1.0, 0.0), _gpu_csinh(${compile(x)}))`;
    }
    return `(1.0 / sinh(${compile(x)}))`;
  },
  Sech: ([x], compile, target) => {
    if (x === null) throw new Error('Sech: no argument');
    if (BaseCompiler.isComplexValued(x)) {
      const v2 = gpuVec2(target);
      return `_gpu_cdiv(${v2}(1.0, 0.0), _gpu_ccosh(${compile(x)}))`;
    }
    return `(1.0 / cosh(${compile(x)}))`;
  },

  // Inverse hyperbolic functions with complex dispatch
  Arcosh: (args, compile, target) => {
    if (BaseCompiler.isComplexValued(args[0]))
      return `_gpu_cacosh(${compile(args[0])})`;
    if (gpuResultIsComplexValued('Arcosh', args))
      return `_gpu_cacosh(${gpuComplexOperand(args[0], compile, target)})`;
    return `acosh(${compile(args[0])})`;
  },
  Arsinh: (args, compile) => {
    if (BaseCompiler.isComplexValued(args[0]))
      return `_gpu_casinh(${compile(args[0])})`;
    return `asinh(${compile(args[0])})`;
  },
  Artanh: (args, compile, target) => {
    if (BaseCompiler.isComplexValued(args[0]))
      return `_gpu_catanh(${compile(args[0])})`;
    if (gpuResultIsComplexValued('Artanh', args))
      return `_gpu_catanh(${gpuComplexOperand(args[0], compile, target)})`;
    return `atanh(${compile(args[0])})`;
  },

  // Inverse hyperbolic (reciprocal)
  Arcoth: ([x], compile, target) => {
    if (x === null) throw new Error('Arcoth: no argument');
    if (
      BaseCompiler.isComplexValued(x) ||
      gpuResultIsComplexValued('Arcoth', [x])
    )
      return gpuReciprocalComplex('_gpu_catanh', x, compile, target);
    return `atanh(1.0 / (${compile(x)}))`;
  },
  Arcsch: ([x], compile) => {
    if (x === null) throw new Error('Arcsch: no argument');
    return `asinh(1.0 / (${compile(x)}))`;
  },
  Arsech: ([x], compile, target) => {
    if (x === null) throw new Error('Arsech: no argument');
    if (
      BaseCompiler.isComplexValued(x) ||
      gpuResultIsComplexValued('Arsech', [x])
    )
      return gpuReciprocalComplex('_gpu_cacosh', x, compile, target);
    return `acosh(1.0 / (${compile(x)}))`;
  },

  // Trigonometric (additional)
  Arctan2: (args, compile) => {
    if (args.length < 2) throw new Error('Arctan2: need two arguments');
    return `atan(${compile(args[0])}, ${compile(args[1])})`;
  },
  Hypot: ([x, y], compile) => {
    if (x === null || y === null) throw new Error('Hypot: need two arguments');
    return `length(vec2(${compile(x)}, ${compile(y)}))`;
  },
  Haversine: ([x], compile) => {
    if (x === null) throw new Error('Haversine: no argument');
    return `((1.0 - cos(${compile(x)})) * 0.5)`;
  },
  InverseHaversine: ([x], compile) => {
    if (x === null) throw new Error('InverseHaversine: no argument');
    return `(2.0 * asin(sqrt(${compile(x)})))`;
  },

  // Special functions
  Gamma: (args, compile, target) => {
    const x = args[0];
    if (!x) throw new Error('Gamma: no argument');
    // The TWO-operand form is the upper incomplete gamma
    // `Γ(s, z) = ∫_z^∞ tˢ⁻¹e⁻ᵗ dt` (the signature is `(number, number?)`) — a
    // different function from `Γ(z)`, not a variant of it: `Γ(5, 2)` is
    // 22.736…, `Γ(5)` is 24. `_gpu_gamma` is the COMPLETE Γ, so consuming
    // only the first operand reported success on a shader computing the wrong
    // value. There is no shader builtin for the incomplete form and no
    // preamble helper for it, so it fails closed (D6).
    if (args.length > 1)
      throw new Error(
        `Gamma: the two-operand form is the upper incomplete gamma Γ(s, z), ` +
          `which has no ${target.language ?? 'GPU'} lowering ` +
          `(\`_gpu_gamma\` is the COMPLETE Γ). Fail closed (D6).`
      );
    return `_gpu_gamma(${compile(x)})`;
  },
  GammaLn: ([x], compile) => {
    if (x === null) throw new Error('GammaLn: no argument');
    return `_gpu_gammaln(${compile(x)})`;
  },
  Factorial: ([x], compile) => {
    if (x === null) throw new Error('Factorial: no argument');
    return `_gpu_gamma(${compile(x)} + 1.0)`;
  },
  Beta: ([a, b], compile, target) => {
    if (a === null || b === null) throw new Error('Beta: need two arguments');
    // Each operand is spliced twice — an impure one is bound to a hoisted
    // temporary (see `gpuOperandOnce`).
    const ca = gpuOperandOnce('Beta', a, compile, target);
    const cb = gpuOperandOnce('Beta', b, compile, target);
    return `(_gpu_gamma(${ca}) * _gpu_gamma(${cb}) / _gpu_gamma(${ca} + ${cb}))`;
  },
  Erf: ([x], compile) => {
    if (x === null) throw new Error('Erf: no argument');
    return `_gpu_erf(${compile(x)})`;
  },
  Erfc: ([x], compile) => {
    if (x === null) throw new Error('Erfc: no argument');
    return `(1.0 - _gpu_erf(${compile(x)}))`;
  },
  ErfInv: ([x], compile) => {
    if (x === null) throw new Error('ErfInv: no argument');
    return `_gpu_erfinv(${compile(x)})`;
  },
  Heaviside: ([x], compile) => {
    if (x === null) throw new Error('Heaviside: no argument');
    return `_gpu_heaviside(${compile(x)})`;
  },
  Sinc: ([x], compile) => {
    if (x === null) throw new Error('Sinc: no argument');
    return `_gpu_sinc(${compile(x)})`;
  },
  FresnelC: ([x], compile) => {
    if (x === null) throw new Error('FresnelC: no argument');
    return `_gpu_fresnelC(${compile(x)})`;
  },
  FresnelS: ([x], compile) => {
    if (x === null) throw new Error('FresnelS: no argument');
    return `_gpu_fresnelS(${compile(x)})`;
  },
  BesselJ: ([n, x], compile, target) => {
    if (n === null || x === null)
      throw new Error('BesselJ: need two arguments');
    const intCast = target?.language === 'wgsl' ? 'i32' : 'int';
    return `_gpu_besselJ(${intCast}(${compile(n)}), ${compile(x)})`;
  },

  // Additional math functions
  Lb: 'log2',
  Log: (args, compile, target) => {
    if (args.length === 0) throw new Error('Log: no argument');
    // Complex either because an operand is, or because the RESULT is complex
    // from a PROVABLY negative argument (`a := -2` makes `Log(a)`
    // `finite_complex`). Either way the enclosing emission is the `vec2`
    // convention. An operand of merely UNKNOWN sign keeps the scalar kernel
    // (pinned; the `isComplexValued` Sqrt/Ln/Log carve-out makes the parent
    // agree). See `gpuResultIsComplexValued`.
    if (
      args.some((a) => BaseCompiler.isComplexValued(a)) ||
      (args.some((a) => a.isNegative === true) &&
        gpuResultIsComplexValued('Log', args))
    ) {
      const num = `_gpu_cln(${gpuComplexOperand(args[0], compile, target)})`;
      // `ln(x) / ln(b)`: the base may itself be complex, or real-but-negative
      // (whose own `ln` is complex). Base 10 divides by a real, so it stays a
      // componentwise scalar multiply.
      if (args.length === 1) return `(${num} * 0.4342944819032518)`;
      return `_gpu_cdiv(${num}, _gpu_cln(${gpuComplexOperand(args[1], compile, target)}))`;
    }
    if (args.length === 1) return `(log(${compile(args[0])}) / log(10.0))`;
    return `(log(${compile(args[0])}) / log(${compile(args[1])}))`;
  },
  Log10: ([x], compile) => {
    if (x === null) throw new Error('Log10: no argument');
    return `(log(${compile(x)}) * 0.4342944819032518)`;
  },
  Lg: ([x], compile) => {
    if (x === null) throw new Error('Lg: no argument');
    return `(log(${compile(x)}) * 0.4342944819032518)`;
  },
  Square: ([x], compile) => {
    if (x === null) throw new Error('Square: no argument');
    if (isSymbol(x) || isNumber(x)) {
      const arg = compile(x);
      return `(${arg} * ${arg})`;
    }
    // Compound base: `pow(x, 2.0)` is NaN for x < 0 on a real GPU (log2 of a
    // negative). Route through the sign-preserving helper, which also evaluates
    // the base subexpression once instead of duplicating it.
    return `_gpu_powi(${compile(x)}, 2.0)`;
  },
  Root: ([x, n], compile, target) => {
    if (x === null) throw new Error('Root: no argument');
    if (n === null || n === undefined) return `sqrt(${compile(x)})`;
    const nConst = tryGetConstant(n);
    if (nConst === 2) return `sqrt(${compile(x)})`;
    const xConst = tryGetConstant(x);
    if (xConst !== undefined && nConst !== undefined) {
      const r = Math.pow(xConst, 1 / nConst);
      // Negative base. WHICH value is folded is decided by the node's TYPE —
      // the same ruling as the JS target's `NO_REAL_VALUE_FOLD`. An ODD
      // integer degree has a real root (interpreter convention, e.g.
      // Root(-8, 3) = -2) and stays `finite_number`. An EVEN degree is the
      // complex branch: as of the 2026-07-30 ruling the node is typed
      // `finite_complex`, so the enclosing emission is `vec2(re, im)` and the
      // fold must be the principal complex value — a scalar NaN there would be
      // silently scalar-broadcast into `vec2(NaN, NaN)`. (A canonical even root
      // of a negative already folds to an exact complex literal before
      // compile: `√-4` → `2i`.)
      if (Number.isNaN(r)) {
        if (Number.isInteger(nConst) && nConst % 2 !== 0 && xConst < 0)
          return formatFloat(-Math.pow(-xConst, 1 / nConst), target.language);
        if (gpuResultIsComplexValued('Root', [x, n]))
          return gpuComplexPowLiteral(xConst, 1 / nConst, target);
      }
      return formatFloat(r, target.language);
    }
    // Real-emitted operands but a complex RESULT type (an even degree over a
    // negative base, e.g. `\sqrt[4]{a}` with `a ⩴ -2`). See
    // `gpuResultIsComplexValued`.
    if (gpuResultIsComplexValued('Root', [x, n]))
      return `_gpu_cpow(${gpuComplexOperand(x, compile, target)}, ${gpuVec2(target)}(1.0 / (${compile(n)}), 0.0))`;
    // Odd integer degree: GPU has no `cbrt`, and `pow` is NaN for a negative
    // base. Emit the sign-corrected form `sign(x)·|x|^(1/n)`.
    if (nConst !== undefined && Number.isInteger(nConst) && nConst % 2 !== 0) {
      const c = compile(x);
      return `(sign(${c}) * pow(abs(${c}), ${formatFloat(
        1 / nConst,
        target.language
      )}))`;
    }
    return `pow(${compile(x)}, 1.0 / ${compile(n)})`;
  },

  // Color functions (pure-math, GPU-compilable)
  ColorMix: (args, compile) => {
    if (args.length < 2) throw new Error('ColorMix: need two colors');
    const c1 = compile(args[0]);
    const c2 = compile(args[1]);
    const ratio = args.length >= 3 ? compile(args[2]) : '0.5';
    return `_gpu_color_mix(${c1}, ${c2}, ${ratio})`;
  },
  ColorContrast: ([bg, fg], compile) => {
    if (bg === null || fg === null)
      throw new Error('ColorContrast: need two colors');
    return `_gpu_apca(${compile(bg)}, ${compile(fg)})`;
  },
  ContrastingColor: (args, compile, target) => {
    if (args.length === 0) throw new Error('ContrastingColor: no argument');
    const bg = compile(args[0]);
    if (args.length >= 3) {
      const fg1 = compile(args[1]);
      const fg2 = compile(args[2]);
      return `(abs(_gpu_apca(${bg}, ${fg1})) >= abs(_gpu_apca(${bg}, ${fg2})) ? ${fg1} : ${fg2})`;
    }
    // Default: pick black or white in OKLCh. Black is vec3(0); white is L=1
    // achromatic — vec3(1.0, 0.0, 0.0). Heuristic from the JS path: low-luma
    // backgrounds get white text and vice versa.
    const isWGSL = target?.language === 'wgsl';
    const v3 = isWGSL ? 'vec3f' : 'vec3';
    const black = `${v3}(0.0)`;
    const white = `${v3}(1.0, 0.0, 0.0)`;
    return `((_gpu_apca(${bg}, ${black}) > 50.0) ? ${black} : ${white})`;
  },
  ColorToColorspace: ([color, space], compile) => {
    if (color === null || space === null)
      throw new Error('ColorToColorspace: need color and space');
    // The input color is canonical OKLCh; route to the requested space.
    // The space arg must be a string literal so we can pick the helper
    // at compile time (no runtime branching in shader code).
    const spaceName = readStringLiteral(space);
    if (spaceName === null)
      throw new Error('ColorToColorspace: space must be a string literal');
    const c = compile(color);
    switch (spaceName) {
      case 'oklch':
        return c;
      case 'oklab':
      case 'lab':
        return `_gpu_oklch_to_oklab(${c})`;
      case 'rgb':
        return `_gpu_oklch_to_srgb(${c})`;
      case 'hsl':
        return `_gpu_rgb_to_hsl(_gpu_oklch_to_srgb(${c}))`;
      case 'hsv':
        return `_gpu_rgb_to_hsv(_gpu_oklch_to_srgb(${c}))`;
      default:
        throw new Error(
          `ColorToColorspace: unsupported space "${spaceName}" on GPU target`
        );
    }
  },
  ColorFromColorspace: ([components, space], compile) => {
    if (components === null || space === null)
      throw new Error('ColorFromColorspace: need components and space');
    // Components are in the named space; build a canonical OKLCh value.
    const spaceName = readStringLiteral(space);
    if (spaceName === null)
      throw new Error('ColorFromColorspace: space must be a string literal');
    // A 4-component tuple carries alpha. Same fail-closed policy as the typed
    // color heads: the `_gpu_*` chain is `vec3` end to end, so a `vec4` here
    // would either not type-check or silently drop the alpha downstream.
    if (
      isFunction(components) &&
      (components.operator === 'Tuple' || components.operator === 'List')
    )
      assertNoGPUAlpha('ColorFromColorspace', components.ops);
    const c = compile(components);
    switch (spaceName) {
      case 'oklch':
        return c;
      case 'oklab':
      case 'lab':
        return `_gpu_oklab_to_oklch(${c})`;
      case 'rgb':
        return `_gpu_srgb_to_oklch(${c})`;
      case 'hsl':
        return `_gpu_srgb_to_oklch(_gpu_hsl_to_rgb(${c}))`;
      case 'hsv':
        return `_gpu_srgb_to_oklch(_gpu_hsv_to_rgb(${c}))`;
      default:
        throw new Error(
          `ColorFromColorspace: unsupported space "${spaceName}" on GPU target`
        );
    }
  },

  // ---------------------------------------------------------------------------
  // Color literals. Each typed head compiles to a canonical OKLCh vec3.
  // An alpha (4th) argument is DECLINED (`assertNoGPUAlpha`) — GPU color
  // values are vec3 only, so there is nowhere to carry it. Pass alpha as a
  // separate uniform if it's needed at the framebuffer boundary.
  // ---------------------------------------------------------------------------

  Color: ([s], _compile, target) => {
    // Compile-time CSS-color-string parsing. Runtime parsing is impractical
    // in shader code, so the string must be a literal at compile time.
    if (s === null) throw new Error('Color: no argument');
    const str = readStringLiteral(s);
    if (str === null)
      throw new Error('Color: argument must be a string literal on GPU target');
    const packed = parseColor(str);
    if (packed === 0 && str.trim().toLowerCase() !== 'transparent')
      throw new Error(`Color: invalid color string "${str}"`);
    // `parseColor()` returns 0xrrggbbaa. Only the RGB is lowered below, so a
    // literal carrying a non-opaque alpha would silently become opaque.
    // Decline instead, matching `assertNoGPUAlpha`.
    if ((packed & 0xff) !== 0xff)
      throw new Error(
        `Color: the color string "${str}" carries an alpha channel, which is ` +
          `not representable on the GPU target — color values are \`vec3\` ` +
          `(OKLCh) end to end, with no alpha channel. Use a fully opaque ` +
          `color and pass the alpha separately (e.g. as a uniform) at the ` +
          `framebuffer boundary. Fail closed (D6).`
      );
    const r = (packed >>> 24) & 0xff;
    const g = (packed >>> 16) & 0xff;
    const b = (packed >>> 8) & 0xff;
    const oklch = rgbToOklch({ r, g, b });
    return `${gpuVec3(target)}(${formatFloat(oklch.L)}, ${formatFloat(oklch.C)}, ${formatFloat(oklch.H)})`;
  },

  Rgb: (args, compile, target) => {
    if (args.length < 3) throw new Error('Rgb: need 3 components');
    assertNoGPUAlpha('Rgb', args);
    const v3 = gpuVec3(target);
    // Channels are 0-1 sRGB — no scaling needed.
    return `_gpu_srgb_to_oklch(${v3}(${compile(args[0])}, ${compile(args[1])}, ${compile(args[2])}))`;
  },

  Hsv: (args, compile, target) => {
    if (args.length < 3) throw new Error('Hsv: need 3 components');
    assertNoGPUAlpha('Hsv', args);
    const v3 = gpuVec3(target);
    return `_gpu_srgb_to_oklch(_gpu_hsv_to_rgb(${v3}(${compile(args[0])}, ${compile(args[1])}, ${compile(args[2])})))`;
  },

  Hsl: (args, compile, target) => {
    if (args.length < 3) throw new Error('Hsl: need 3 components');
    assertNoGPUAlpha('Hsl', args);
    const v3 = gpuVec3(target);
    return `_gpu_srgb_to_oklch(_gpu_hsl_to_rgb(${v3}(${compile(args[0])}, ${compile(args[1])}, ${compile(args[2])})))`;
  },

  Oklab: (args, compile, target) => {
    if (args.length < 3) throw new Error('Oklab: need 3 components');
    assertNoGPUAlpha('Oklab', args);
    const v3 = gpuVec3(target);
    return `_gpu_oklab_to_oklch(${v3}(${compile(args[0])}, ${compile(args[1])}, ${compile(args[2])}))`;
  },

  Oklch: (args, compile, target) => {
    if (args.length < 3) throw new Error('Oklch: need 3 components');
    assertNoGPUAlpha('Oklch', args);
    // Already in canonical form — no conversion needed.
    const v3 = gpuVec3(target);
    return `${v3}(${compile(args[0])}, ${compile(args[1])}, ${compile(args[2])})`;
  },

  // ---------------------------------------------------------------------------
  // As* operators. AsOklch is identity (canonical). The other As* return
  // components in the named space, equivalent to ColorToColorspace(c, 'x').
  // ---------------------------------------------------------------------------

  AsOklch: ([c], compile) => {
    if (c === null) throw new Error('AsOklch: no argument');
    return compile(c);
  },

  AsOklab: ([c], compile) => {
    if (c === null) throw new Error('AsOklab: no argument');
    return `_gpu_oklch_to_oklab(${compile(c)})`;
  },

  AsRgb: ([c], compile) => {
    if (c === null) throw new Error('AsRgb: no argument');
    return `_gpu_oklch_to_srgb(${compile(c)})`;
  },

  AsHsv: ([c], compile) => {
    if (c === null) throw new Error('AsHsv: no argument');
    return `_gpu_rgb_to_hsv(_gpu_oklch_to_srgb(${compile(c)}))`;
  },

  AsHsl: ([c], compile) => {
    if (c === null) throw new Error('AsHsl: no argument');
    return `_gpu_rgb_to_hsl(_gpu_oklch_to_srgb(${compile(c)}))`;
  },

  // Fractal functions
  Mandelbrot: ([c, maxIter], compile, target) => {
    if (c === null || maxIter === null)
      throw new Error('Mandelbrot: missing arguments');
    const iterCode = compileIntArg(maxIter, compile, target);
    return `_fractal_mandelbrot(${compile(c)}, ${iterCode})`;
  },
  Julia: ([z, c, maxIter], compile, target) => {
    if (z === null || c === null || maxIter === null)
      throw new Error('Julia: missing arguments');
    const iterCode = compileIntArg(maxIter, compile, target);
    return `_fractal_julia(${compile(z)}, ${compile(c)}, ${iterCode})`;
  },

  // Vector/Matrix operations
  Cross: 'cross',
  Distance: 'distance',
  Dot: 'dot',
  // The GLSL/WGSL `length()` builtin is the Euclidean NORM of a vector, which
  // is CE `Norm` — NOT CE `Length` (element count; fails closed below).
  // `length()` only accepts scalars and vec2/3/4: a fixed-arity point or list
  // literal outside that range compiles to an ARRAY constructor
  // (`float[5](...)`), which `length()` rejects — so emit `abs` for arity 1
  // and fail closed (D6) for arity ≥ 5 or a norm-type argument rather than
  // reporting success on invalid shader source.
  Norm: (args, compile, target) => {
    if (args.length > 1)
      throw new Error(
        `Norm: only the default L2 norm compiles on the ` +
          `${target.language ?? 'GPU'} target. Fail closed (D6).`
      );
    const arg = args[0];
    if (isFunction(arg, 'Tuple') || isFunction(arg, 'List')) {
      // A broadcasting component means one norm per zipped element — not a
      // scalar. Fail closed (D6).
      if (pointHasBroadcastComponent(arg))
        throw new Error(
          'Norm: cannot compile a point with a broadcasting component. ' +
            'Fail closed (D6).'
        );
      const n = arg.nops;
      if (n === 0 || n > 4)
        throw new Error(
          `Norm: the ${target.language ?? 'GPU'} 'length()' builtin only ` +
            `accepts 2-4 component vectors (got ${n}). Fail closed (D6).`
        );
      if (n === 1) return `abs(${compile(arg.op1)})`;
      return `length(${compile(arg)})`;
    }
    // Non-literal operand (e.g. a vec-typed symbol): `length()` applies.
    return `length(${compile(arg)})`;
  },
  Length: (_args, _compile, target) => {
    throw new Error(
      `Length (collection element count) is not supported on the ` +
        `${target.language ?? 'GPU'} target: the '${target.language ?? 'GPU'}' ` +
        `'length()' builtin is the Euclidean norm (CE 'Norm'), not a count. ` +
        `Fail closed (D6).`
    );
  },
  Normalize: 'normalize',
  Reflect: 'reflect',
  Refract: 'refract',

  // Sum/Product — unrolled or for-loop
  Sum: (args, compile, target) =>
    compileGPUSumProduct('Sum', args, compile, target),
  Product: (args, compile, target) =>
    compileGPUSumProduct('Product', args, compile, target),

  // Range — inline constant array literal (bounds must be compile-time constants)
  Range: (args, _compile, target) => {
    if (args.length < 2 || args.length > 3) {
      throw new Error(
        'Range: GPU compile expects 2 or 3 arguments (lo, hi, step?)'
      );
    }
    const lo = args[0].re;
    const hi = args[1].re;
    const step = args.length === 3 ? args[2].re : 1;
    if (
      !Number.isFinite(lo) ||
      !Number.isFinite(hi) ||
      !Number.isFinite(step)
    ) {
      throw new Error(
        'Range: GPU compile requires constant numeric bounds' +
          ' (non-constant ranges must be materialized at JS host then uploaded as a uniform)'
      );
    }
    if (step === 0) throw new Error('Range: step cannot be zero');
    const count = Math.max(0, Math.floor((hi - lo) / step) + 1);
    if (count === 0) {
      throw new Error(
        'Range: empty range (lo > hi for positive step, or lo < hi for negative step)'
      );
    }
    if (count > 256) {
      throw new Error(
        `Range: GPU compile inlines ranges up to 256 elements (got ${count})`
      );
    }
    const values: number[] = [];
    for (let i = 0; i < count; i++) values.push(lo + i * step);
    const isWGSL = target.language === 'wgsl';
    const arrayType = isWGSL ? `array<f32, ${count}>` : `float[${count}]`;
    return `${arrayType}(${values
      .map((v) => formatGPUNumber(v, target.language))
      .join(', ')})`;
  },

  // Loop — GPU for-loop (no IIFE, no let)
  Loop: (args, _compile, target) => {
    if (!args[0]) throw new Error('Loop: no body');
    if (!args[1]) throw new Error('Loop: no indexing set');

    const indexing = args[1];
    if (!isFunction(indexing, 'Element'))
      throw new Error('Loop: expected Element(index, Range(lo, hi))');

    const indexExpr = indexing.ops[0];
    const rangeExpr = indexing.ops[1];

    if (!isSymbol(indexExpr)) throw new Error('Loop: index must be a symbol');
    if (!isFunction(rangeExpr, 'Range'))
      throw new Error('Loop: expected Range(lo, hi)');

    const index = indexExpr.symbol;
    // The loop index is declared and referenced bare — reject a reserved name.
    gpuCheckIdentifier(index, target.language);
    const lower = Math.floor(rangeExpr.ops[0].re);
    const upper = Math.floor(rangeExpr.ops[1].re);

    if (!Number.isFinite(lower) || !Number.isFinite(upper))
      throw new Error('Loop: bounds must be finite numbers');

    const isWGSL = target.language === 'wgsl';
    const intType = isWGSL ? 'i32' : 'int';

    // The counter is declared as an integer (for `i++`), but shader scalar math
    // is float. Consume the index as a float (`float(i)` / `f32(i)`) so it is
    // type-consistent wherever the body uses it in float arithmetic — mirroring
    // the Sum/Product for-loop path.
    const indexAsFloat = isWGSL ? `f32(${index})` : `float(${index})`;
    const bodyCode = BaseCompiler.compile(args[0], {
      ...target,
      var: (id) => (id === index ? indexAsFloat : target.var(id)),
      // The counter shadows any same-named engine symbol (an index named `i`
      // must not resolve to the imaginary unit in the operand analysis).
      boundVars: BaseCompiler.withBoundNames(target, [index]),
    });

    const indexDecl = isWGSL
      ? `var ${index}: ${intType}`
      : `${intType} ${index}`;
    return `for (${indexDecl} = ${lower}; ${index} <= ${upper}; ${index}++) {\n  ${bodyCode};\n}`;
  },

  // Statistical functions

  /**
   * GCD of two scalar arguments.
   *
   * Uses a preamble helper `_gpu_gcd` (Euclidean algorithm via `mod`).
   * Only two-argument form is supported in GPU targets.
   */
  GCD: (args, compile) => {
    if (args.length < 2) throw new Error('GCD: need at least two arguments');
    if (args.length > 2)
      throw new Error('GCD: GPU target supports only two-argument GCD');
    const a = args[0];
    const b = args[1];
    if (a === null || b === null) throw new Error('GCD: missing argument');
    return `_gpu_gcd(${compile(a)}, ${compile(b)})`;
  },

  /**
   * Variance of a compile-time-known list.
   *
   * Accepts either a single `List(...)` argument or N scalar arguments.
   * Generates fully inline code: computes mean then sum of squared deviations,
   * divided by (N-1) for sample variance (matches JS `_SYS.variance`).
   *
   * `markAggregateConsuming`: with a single `List` operand the elements are
   * DESTRUCTURED into scalars, so the emission contains no aggregate at all
   * and must not be judged against the operand's `array`/`vecN` shape. The
   * N-scalar-argument form passes its operands through and stays gated.
   */
  Variance: markAggregateConsuming((args, compile) => {
    // Normalise: if single List arg, use its elements; else use args directly.
    let elems: ReadonlyArray<Expression>;
    if (args.length === 1 && isFunction(args[0], 'List')) {
      elems = args[0].ops;
    } else if (args.length >= 2) {
      elems = args;
    } else {
      throw new Error(
        'Variance: GPU target requires a List argument or at least 2 scalar arguments'
      );
    }
    const n = elems.length;
    if (n < 2) throw new Error('Variance: need at least 2 elements');
    const compiled = elems.map((e) => compile(e));
    // mean = (v0 + v1 + ... + vN-1) / N
    const sum = compiled.join(' + ');
    const mean = `((${sum}) / ${formatGPUNumber(n)})`;
    // sum of squared deviations: (v0 - mean)^2 + ...
    const sqDiffs = compiled
      .map((c) => `(${c} - ${mean}) * (${c} - ${mean})`)
      .join(' + ');
    // sample variance: sum / (N - 1)
    return `((${sqDiffs}) / ${formatGPUNumber(n - 1)})`;
  }, gpuDestructuresListOperand),

  /**
   * Median of a compile-time-known list.
   *
   * Accepts either a single `List(...)` argument or N scalar arguments.
   * For N ≤ 8: generates a fully unrolled inline sorting network followed by
   * a middle-element pick. For larger N, throws (too large to inline cleanly).
   *
   * The sorting network uses the "odd-even merge sort" comparator pattern
   * inlined as `min`/`max` calls — no GPU statements required.
   *
   * `markAggregateConsuming`: a single `List` operand is DESTRUCTURED into one
   * scalar per element (`_gpu_median_5(1.0, 5.0, …)`), so the emission carries
   * none of the operand's aggregate shape. The N-scalar-argument form passes
   * its operands through and stays gated.
   */
  Median: markAggregateConsuming((args, compile) => {
    // Normalise to element list
    let elems: ReadonlyArray<Expression>;
    if (args.length === 1 && isFunction(args[0], 'List')) {
      elems = args[0].ops;
    } else if (args.length >= 1) {
      elems = args;
    } else {
      throw new Error(
        'Median: GPU target requires a List argument or at least 1 scalar argument'
      );
    }
    const n = elems.length;
    if (n === 0) throw new Error('Median: empty list');
    if (n > 8) {
      throw new Error(
        `Median: GPU target supports up to 8 elements via inline sorting network (got ${n}). ` +
          'For larger lists, compute on the CPU and pass the result as a uniform.'
      );
    }

    // Compile each element. We'll refer to them by variable names v0..vN-1.
    // Build a sequence of min/max comparators that sort the array in place.
    // Then return the middle element (or average of two middles for even N).
    const compiled = elems.map((e) => compile(e));

    // For N=1, median is the single element
    if (n === 1) return compiled[0];

    // Build a small inline sort using a Batcher odd-even sort network.
    // We represent the "array" as a mutable JS array of code strings.
    // Each "comparator" sorts a pair: (v[i], v[j]) → min then max.
    // We inline this as: new_i = min(a, b); new_j = max(a, b)
    // But since GLSL/WGSL have no statements in expressions, we encode
    // the full sorted sequence using nested min/max only when possible.
    //
    // Strategy: generate all comparator pairs for sorting network (as a list),
    // then materialise the sorted array as named sub-expressions via let-binding.
    // Since GPU compile() returns strings (not blocks), we use a different
    // approach: produce a comma-expression–style sequence using _gpu_median helper.
    //
    // Simpler approach that avoids preamble: for each position from 0..n-1,
    // compute the k-th order statistic inline using the formula:
    //   kth_element(k, v[]) = sum over all subsets S of size k+1 of (-1)^...
    // This is exponential. Instead use the "min of maxes" approach:
    //   sorted[k] = (k+1)-th smallest = min over all (k+1)-subsets of max(subset)
    // This is O(n choose k+1) — too expensive for n=8.
    //
    // Cleanest solution: call `_gpu_median_N` preamble function.
    // We emit a per-size preamble (GPU_MEDIAN_PREAMBLE_N_GLSL / WGSL)
    // and return a call to `_gpu_median_N(v0, v1, ..., vN-1)`.
    return `_gpu_median_${n}(${compiled.join(', ')})`;
  }, gpuDestructuresListOperand),

  /**
   * One draw from the counter-based PCG3D stream — the GPU tier of the
   * random family redesign
   * (`docs/plans/2026-07-25-random-signature-redesign.md` §2, §4, §7).
   *
   * Every form returns a GLSL `float` (WGSL `f32`), so it composes with the
   * surrounding float arithmetic without a cast. The domain forms return an
   * integer-valued float (the result of `floor`) for a `Range`, matching the
   * convention `Floor` and the other ostensibly integer-returning operators
   * of this target use.
   *
   * | Form | GLSL | WGSL |
   * |---|---|---|
   * | `Random()` inside `WithRandomSeed` | `hash(seed, n)` | `hash(seed, n)` |
   * | `Random(Interval/Range)` inside a frame | arithmetic on the draw | same |
   * | `Random()` unframed | fragment stage: spatial noise; any other stage **throws** | **throws** |
   * | `Random(collection)` | **throws** — no general indexing | **throws** |
   *
   * The presented value is `(w0 >> 8) * 2⁻²⁴` — an EXACT power-of-two
   * conversion of the top 24 bits of the same `w0` the f64 tier is built
   * from, so the two tiers agree to within 2⁻²⁴ by construction rather than
   * by tuning. See `gpuRandomDraw`.
   */
  Random: (args, compile, target) => {
    if (args.length === 0) return gpuRandomDraw(target);
    if (args.length === 1) return gpuRandomDomainDraw(args[0], compile, target);
    throw new Error(
      'Random: expects at most one operand, the DOMAIN to draw from ' +
        '(`Random()`, `Random(Interval(a, b))`, `Random(Range(…))`). The ' +
        'seed argument was removed by the Random family redesign — seed with ' +
        '`WithRandomSeed(seed, body)`.'
    );
  },

  /**
   * A LEXICALLY scoped random-seed frame (§4 "The GPU boundary is genuinely
   * one-domain"). A shader invocation cannot share the host's mutable draw
   * counter, and fragments run in parallel, so a GPU frame lives entirely
   * inside the shader: the seed is folded (see `gpuFoldSeedSource` for the
   * seed ABI) and the frame gets its own invocation-local u32 counter, which
   * every invocation starts at 0.
   *
   * `WithRandomSeed` returns its body's value, so the emission is the body's
   * code — the frame exists only as the counter the enclosed draws consume.
   * Nested frames each allocate their own counter, so an inner frame cannot
   * perturb its parent's subsequent draws (the §2 per-frame-counter rule).
   */
  WithRandomSeed: (args, compile, target) => {
    if (args.length !== 2)
      throw new Error(
        'WithRandomSeed(seed, body): expects exactly two operands'
      );
    const state = gpuRandomState(target);
    // The seed is folded ONCE per frame, before the body is compiled.
    const seed = gpuFoldSeedSource(args[0], compile, target);
    const counter = allocGPURandomCounter(state);
    state.frames.push({ seed, counter });
    try {
      return compile(args[1]);
    } finally {
      state.frames.pop();
    }
  },

  // The multi-draw members of the family need general collection indexing (or
  // a mutable permutation buffer), which a shader expression has no way to
  // express. Fail closed (D6) with the reason rather than let them fall
  // through to a bare `Unknown operator`.
  RandomChoice: (_args, _compile, target) => {
    throw new Error(gpuNoIndexingMessage('RandomChoice(domain, k)', target));
  },
  RandomSample: (_args, _compile, target) => {
    throw new Error(gpuNoIndexingMessage('RandomSample(xs, k)', target));
  },
  RandomShuffle: (_args, _compile, target) => {
    throw new Error(gpuNoIndexingMessage('RandomShuffle(xs)', target));
  },

  // Function (lambda) — not supported in GPU
  Function: () => {
    throw new Error(
      'Anonymous functions (Function) are not supported in GPU targets'
    );
  },
};

//
// ─── Counter-based random draws (PCG3D) ─────────────────────────────────────
//
// The GPU tier of `docs/plans/2026-07-25-random-signature-redesign.md`. The
// n-th draw of a frame is `hash(seed, n)` — a pure function of the seed and
// the draw index — so a shader, which has no persistent stream and cannot
// carry mutable RNG state across invocations, can still replay a frame.
//
// Three things make the tier well-defined:
//
// 1. `pcg3d` is transcribed VERBATIM from the paper (§2 of the design), pure
//    u32 arithmetic, so it is a transcription on every target rather than an
//    independent reimplementation. `pcg3dWords` in `numerics/random.ts` is
//    the reference: the shader must compute the identical integer words.
// 2. The presentation is `(w0 >> 8) * 2⁻²⁴` — an EXACT power-of-two scaling
//    of the top 24 bits of `w0`, never implementation-rounded float math.
//    The f64 tier is built from the SAME `w0`, so the tiers agree to within
//    2⁻²⁴ by construction.
// 3. Frames are LEXICAL (§4): the seed is folded in the shader (or on the
//    host, for a literal — see `gpuFoldSeedSource`) and each frame owns an
//    invocation-local u32 counter that every invocation starts at 0.
//

/**
 * Per-compilation state for the counter-based random draws.
 *
 * Installed eagerly by `GPUShaderTarget.createTarget()` so it survives the
 * `{ ...target }` spreads the base compiler makes while recursing — the state
 * object is shared by reference, which is what lets a `WithRandomSeed` handler
 * push a frame that the `Random` handlers nested inside its body can see.
 */
export type GPURandomState = {
  /** The stack of enclosing LEXICAL frames, innermost last. */
  frames: Array<{ seed: string; counter: string }>;

  /** How many counter variables have been allocated (names are positional). */
  counters: number;

  /** The counter shared by unframed (spatial-noise) draws, allocated lazily. */
  spatialCounter: string | undefined;

  /**
   * The shader stage being compiled, when known. `undefined` means the caller
   * did not say — the `compile()`/`compileToSource()` entry points — and the
   * historical fragment-shader assumption applies. `compileShader()` sets it,
   * which is what makes the §7 vertex-stage check possible.
   */
  stage: string | undefined;

  /**
   * Whether a HOST `WithRandomSeed` frame was active when this GPU compile
   * ran. An unframed shader draw is then the cross-domain case (§4) and fails
   * closed — never a silent live/spatial draw.
   */
  hostFrame: boolean;

  /**
   * The names the caller mapped through `vars`, when the entry point knows
   * them. A seed that resolves to one of these is the HOST-UNIFORM row of the
   * seed ABI, which is not implemented — see `gpuFoldSeedSource`.
   */
  varNames: ReadonlySet<string> | undefined;
};

type GPURandomTarget = CompileTarget<Expression> & {
  /**
   * The identity of the compilation this target belongs to.
   *
   * The state itself lives in the module-level `GPU_RANDOM_STATES` map, never
   * on the target, so a CALLER-supplied target is not mutated (and does not
   * carry counter numbering from one compilation into the next). The token is
   * a plain enumerable property because the base compiler recurses through
   * `{ ...target }` spreads: those copy the token BY REFERENCE, which is what
   * keeps a frame pushed by `WithRandomSeed` visible to the draws nested in
   * its body.
   */
  gpuRandomRoot?: object;
};

/**
 * Per-compilation random state, keyed by the compilation's root token — or,
 * for a hand-rolled target that never went through `createTarget()`, by the
 * target itself. Never stored ON the target.
 */
const GPU_RANDOM_STATES = new WeakMap<object, GPURandomState>();

/** A fresh (empty) random state — one per compilation. */
export function newGPURandomState(): GPURandomState {
  return {
    frames: [],
    counters: 0,
    spatialCounter: undefined,
    stage: undefined,
    hostFrame: false,
    varNames: undefined,
  };
}

/**
 * Give `target` — freshly created by `createTarget()`, so ours to write to —
 * its own compilation identity and a fresh random state.
 */
function installGPURandomState(target: GPURandomTarget): void {
  const token = {};
  target.gpuRandomRoot = token;
  GPU_RANDOM_STATES.set(token, newGPURandomState());
}

/**
 * The random state of the compilation `target` belongs to. A hand-rolled
 * target that never went through `createTarget()` gets one keyed by the target
 * object itself — enough for a single unframed draw, and without writing
 * anything to the caller's object.
 */
export function gpuRandomState(
  target: CompileTarget<Expression>
): GPURandomState {
  const key = (target as GPURandomTarget).gpuRandomRoot ?? target;
  let state = GPU_RANDOM_STATES.get(key);
  if (state === undefined) {
    state = newGPURandomState();
    GPU_RANDOM_STATES.set(key, state);
  }
  return state;
}

/**
 * Compilation-boundary hook (`CompileTarget.beginCompilation`): restart the
 * per-compilation counter NUMBERING of the compilation `target` belongs to.
 *
 * A target the engine creates is fresh for every `compile()`, so its numbering
 * starts at `_gpu_rnd_n0` on its own. A target the CALLER built once and passes
 * to two successive `compile()` calls does not — without this reset the second
 * compilation of the same expression would number its draws `n1, n2, …`,
 * breaking recompile-replay determinism on that path.
 *
 * Reset through the state, not by replacing it: the state is reached by the
 * identity token (which `{ ...target }` spreads copy by reference), and the
 * compilation CONTEXT `createTargetFor` stamped on it — shader stage, active
 * host frame, `vars` names — describes the caller, not this compilation, and
 * must survive. Frames are cleared because an unbalanced frame can only be the
 * residue of a compilation that threw.
 */
function resetGPURandomNumbering(target: CompileTarget<Expression>): void {
  const state = gpuRandomState(target);
  state.frames.length = 0;
  state.counters = 0;
  state.spatialCounter = undefined;
  // The generated-temporary numbering (`_tv1`, `_tv2`, … — the `Sum`/`Product`
  // loop accumulator) is per-compilation for exactly the same reason, and
  // restarts on the same boundary. Its collision inventory describes the
  // caller's expression, not this compilation, so it survives the reset — the
  // same split as the random state's CONTEXT above.
  BaseCompiler.resetNaming(target);
}

/**
 * Allocate the next invocation-local counter variable.
 *
 * Each frame owns one, plus one shared by the unframed spatial-noise draws.
 * The counter is a shader global (`var<private>` in WGSL): per-invocation and
 * initialized before the entry point runs, so every invocation runs each of
 * its frames from `n = 0`.
 *
 * Caveat worth knowing: GLSL and WGSL leave the evaluation ORDER of an
 * expression's operands unspecified, so which of two sibling draws in one
 * frame gets `n = 0` is not pinned by the source. The set of values drawn is,
 * and so is each draw's own determinism — but `Random() - Random()` inside one
 * frame may differ in sign between GPU drivers. The host tiers, which evaluate
 * left to right, do not have this freedom.
 */
function allocGPURandomCounter(state: GPURandomState): string {
  return `_gpu_rnd_n${state.counters++}`;
}

/** The prefix every allocated counter name carries (scanned for by the
 * preamble assembly). */
const GPU_RANDOM_COUNTER_PREFIX = '_gpu_rnd_n';

/** How a draw site passes its counter: GLSL takes it by `inout`, WGSL by a
 * pointer into the private address space. */
function gpuCounterArg(name: string, language: string | undefined): string {
  return language === 'wgsl' ? `&${name}` : name;
}

/** A `uvec2` (WGSL `vec2<u32>`) literal holding the two folded seed words. */
function gpuSeedWords(
  lo: number,
  hi: number,
  language: string | undefined
): string {
  const hex = (w: number) => `0x${(w >>> 0).toString(16).padStart(8, '0')}u`;
  const ctor = language === 'wgsl' ? 'vec2<u32>' : 'uvec2';
  return `${ctor}(${hex(lo)}, ${hex(hi)})`;
}

/**
 * One draw `u ∈ [0, 1)`.
 *
 * Inside a lexical frame this is `_gpu_rnd_draw(seed, n)`, which advances the
 * frame's own counter. Outside any frame it is the GLSL fragment-shader
 * spatial-noise exception (§7): a `gl_FragCoord`-derived seed through the same
 * PCG3D stream, with an invocation-local counter so repeated unframed draws
 * decorrelate instead of returning one value. Every other unframed case throws.
 */
function gpuRandomDraw(target: CompileTarget<Expression>): string {
  const state = gpuRandomState(target);
  const language = target.language;

  const frame = state.frames[state.frames.length - 1];
  if (frame !== undefined)
    return `_gpu_rnd_draw(${frame.seed}, ${gpuCounterArg(
      frame.counter,
      language
    )})`;

  // Unframed. The cross-domain case first (§4): the enclosing frame lives on
  // the HOST, whose mutable counter a parallel shader invocation cannot share.
  if (state.hostFrame)
    throw new Error(
      'Random(): an unframed draw cannot be compiled to a shader while a host ' +
        '`WithRandomSeed` frame is active — a shader invocation cannot share ' +
        "the host's mutable draw counter, and fragments run in parallel. GPU " +
        'frames must be LEXICAL: move the `WithRandomSeed(seed, …)` inside the ' +
        'compiled expression. Fail closed (D6).'
    );

  if (language === 'wgsl')
    throw new Error(
      'Random(): an unframed draw cannot be compiled to WGSL — a shader has no ' +
        'live random stream, and WGSL has no `gl_FragCoord` built-in to derive ' +
        'spatial noise from. Wrap the draw in `WithRandomSeed(seed, …)`, whose ' +
        'seed may be an invocation-varying expression. Fail closed (D6).'
    );

  // `gl_FragCoord` exists only in a fragment shader. A vertex (or other) stage
  // fails at CE compile time rather than emitting code that fails later, at
  // GPU shader-compile time. An UNKNOWN stage keeps the historical
  // fragment-shader assumption of the `compile()` entry points.
  if (state.stage !== undefined && state.stage !== 'fragment')
    throw new Error(
      `Random(): an unframed draw compiles to \`gl_FragCoord\`-derived spatial ` +
        `noise, which exists only in a fragment shader (this is a ` +
        `\`${state.stage}\` shader). Wrap the draw in ` +
        `\`WithRandomSeed(seed, …)\` to get a stage-independent stream. ` +
        `Fail closed (D6).`
    );

  state.spatialCounter ??= allocGPURandomCounter(state);
  // A fragment's coordinate is stable across renders, so this is DETERMINISTIC
  // SPATIAL NOISE, not the live randomness an unframed draw has on the host —
  // the one documented exception to the liveness contract (§7). Both
  // coordinates are reinterpreted whole, so there is no row-aliasing bound.
  return (
    `_gpu_rnd_draw(uvec2(floatBitsToUint(gl_FragCoord.x), ` +
    `floatBitsToUint(gl_FragCoord.y)), ${state.spatialCounter})`
  );
}

/** The message for a random form that would need general collection indexing. */
function gpuNoIndexingMessage(
  form: string,
  target: CompileTarget<Expression>
): string {
  const lang = target.language ?? 'GPU';
  return (
    `${form} is not supported on the ${lang} target: a shader expression has ` +
    `no general collection indexing. Only \`Random()\`, ` +
    `\`Random(Interval(a, b))\` and \`Random(Range(…))\` compile — the ` +
    `closed-form domains. Fail closed (D6).`
  );
}

/**
 * `Random(domain)` — the closed-form domains only.
 *
 * `Interval` → `lo + u * (hi - lo)`; `Range` → `first + step * floor(u * n)`
 * over the range's NORMALIZED parameters, matching the interpreter's
 * `selectRandomElement` (`library/core.ts`) term for term. Any other domain
 * would need indexing, so it fails closed.
 */
function gpuRandomDomainDraw(
  domain: Expression,
  compile: (expr: Expression) => string,
  target: CompileTarget<Expression>
): string {
  if (isFunction(domain, 'Interval')) {
    if (domain.nops !== 2)
      throw new Error('Random(Interval(a, b)): expects two endpoints');
    // Endpoint markers are IGNORED — a float draw cannot respect an open
    // endpoint, so the draw is half-open `[lo, hi)` either way.
    const strip = (x: Expression): Expression =>
      isFunction(x, 'Open') || isFunction(x, 'Closed') ? x.op1 : x;
    const loExpr = strip(domain.op1);
    const hiExpr = strip(domain.op2);

    // Endpoints are SPLICED into the emitted expression — `lo` twice — because
    // a shader expression has no statement to evaluate them into once. Pure
    // arithmetic on uniforms is only an ALU cost, but an endpoint that
    // consumes draws would consume a different NUMBER of them than the host.
    // Fail closed (D6).
    for (const [role, endpoint] of [
      ['lower', loExpr],
      ['upper', hiExpr],
    ] as const)
      if (!endpoint.canonical.isPure)
        throw new Error(
          `Random(Interval(a, b)): the ${role} endpoint is not pure — a ` +
            `shader expression has no statement to evaluate it into once, so ` +
            `the endpoint is spliced (and would run) more than once per ` +
            `draw. Hoist the draw out of the endpoint. Fail closed (D6).`
        );

    const lo = tryGetConstant(loExpr);
    const hi = tryGetConstant(hiExpr);
    if (lo !== undefined && hi !== undefined) {
      if (!(hi > lo))
        throw new Error(
          `Random(Interval(${lo}, ${hi})): the interval is empty or reversed ` +
            `— there is no uniform distribution to draw from.`
        );
      return `(${formatGPUNumber(lo)} + ${gpuRandomDraw(
        target
      )} * ${formatGPUNumber(hi - lo)})`;
    }
    // Symbolic endpoints (typically uniforms) stay live. `lo` is spliced
    // twice, so an endpoint with a side effect (a nested draw) would be
    // consumed twice — endpoints are expected to be uniforms or constants.
    const loSrc = compile(loExpr);
    const hiSrc = compile(hiExpr);
    return `((${loSrc}) + ${gpuRandomDraw(
      target
    )} * ((${hiSrc}) - (${loSrc})))`;
  }

  if (isFunction(domain, 'Range')) {
    const n = domain.count;
    if (n === undefined || !Number.isFinite(n))
      throw new Error(
        'Random(Range(…)): the GPU target requires a Range with constant, ' +
          'finite bounds — a symbolic or unbounded range has no known element ' +
          'count to draw from. Fail closed (D6).'
      );
    if (n === 0)
      throw new Error('Random(Range(…)): the range is empty (no elements).');

    // The normalized (first, step) of the range — mirrors `range()` in
    // `library/collections.ts`: a two-operand range infers a DESCENDING step
    // when its bounds are reversed (`Range(7, 2)`).
    const ops = domain.ops;
    let first: number;
    let step: number;
    if (ops.length === 1) {
      first = 1;
      step = 1;
    } else if (ops.length === 2) {
      first = ops[0].re;
      step = ops[1].re >= ops[0].re ? 1 : -1;
    } else {
      first = ops[0].re;
      step = ops[2].re;
    }
    if (!Number.isFinite(first) || !Number.isFinite(step))
      throw new Error(
        'Random(Range(…)): the GPU target requires constant numeric bounds.'
      );

    const index = `floor(${gpuRandomDraw(target)} * ${formatGPUNumber(n)})`;
    // `first + step * index`, with the sign lifted out of the literal so a
    // descending range emits `(7.0 - 1.0 * …)` rather than `(7.0 + -1.0 * …)`.
    const sign = step < 0 ? '-' : '+';
    const magnitude = Math.abs(step);
    if (magnitude === 1) return `(${formatGPUNumber(first)} ${sign} ${index})`;
    return `(${formatGPUNumber(first)} ${sign} ${formatGPUNumber(
      magnitude
    )} * ${index})`;
  }

  throw new Error(gpuNoIndexingMessage('Random(collection)', target));
}

/**
 * The GPU seed ABI (§7). Which fold applies is decided by WHERE the seed value
 * lives, because a shader has neither f64 nor strings and so cannot run the
 * normative `foldSeed`:
 *
 * | Seed form | Folding | Stream identity |
 * |---|---|---|
 * | compile-time constant (number or string literal, a declared constant such as `Pi`, an assigned engine value) | HOST `foldSeed`, emitted as a `uvec2` constant | **identical** to the interpreted/JS stream |
 * | a FREE symbol the shader supplies (uniform/varying, not in `vars`) | in-shader `floatBitsToUint` / `bitcast<u32>`, `seedHi = 0u` | its OWN stream — deterministic given the seed BITS |
 * | a `vars`-mapped symbol (a HOST-supplied uniform) | — | **compile error**: the host-uniform ABI row is not implemented |
 * | a COMPUTED expression | — | **compile error**: the seed is spliced per draw site |
 * | a string computed at run time | impossible in a shader | **compile error** |
 *
 * The last two rows are the once-evaluation rule. The emitted seed source is
 * spliced into EVERY draw site of the frame — a shader expression has no
 * statement to evaluate it into once — so anything but a constant or a single
 * identifier would be recomputed per draw (and, if it consumed draws, would
 * silently change the draw count). Symbol handling is therefore: a symbol that
 * resolves to a VALUE folds on the host; a symbol the caller mapped through
 * `vars` fails closed (below); any other symbol is a name the shader itself
 * must declare, and stays live as its own stream.
 *
 * A bit reinterpretation is exact, so the derived stream is bit-deterministic
 * given the seed bits; the seed's own f32 value remains subject to ordinary
 * GPU float variance. Determinism claims stop at the fold's input.
 */
function gpuFoldSeedSource(
  seedExpr: Expression,
  compile: (expr: Expression) => string,
  target: CompileTarget<Expression>
): string {
  const language = target.language;

  if (isString(seedExpr)) {
    const [lo, hi] = foldSeed(seedExpr.string);
    return gpuSeedWords(lo, hi, language);
  }
  if (seedExpr.type.matches('string'))
    throw new Error(
      'WithRandomSeed(seed, …): a string seed that is not a compile-time ' +
        'literal cannot be folded in a shader — GLSL and WGSL have no ' +
        'strings. Use a literal string, a numeric seed, or fold the seed on ' +
        'the host. Fail closed (D6).'
    );

  // `WithRandomSeed` is `lazy`, so the held seed arrives UNBOUND on the box
  // and parse routes: canonicalize before asking it anything. (`.canonical` is
  // value-safe — it binds structure without substituting assigned values.)
  const seed = seedExpr.canonical;

  // The seed source is spliced at every draw site, so a seed with a side
  // effect — a nested draw above all — would run once per draw. Fail closed
  // (D6) rather than silently consume extra draws.
  if (!seed.isPure)
    throw new Error(
      'WithRandomSeed(seed, …): the seed expression is not pure — the folded ' +
        'seed is spliced at EVERY draw site of the frame, so it would be ' +
        'evaluated once per draw. Use a compile-time constant or a single ' +
        'shader-supplied symbol. Fail closed (D6).'
    );

  // A compile-time constant — a literal, a declared constant such as `Pi`, or
  // an assigned engine value — folds on the HOST with the normative
  // `foldSeed`, so the shader draws the SAME integer stream as the interpreter
  // and the JS target. Read off the EXPRESSION, never off the emitted source:
  // `Pi` emits the truncated `3.14159265359`, which folds to a different f64
  // than `Math.PI`.
  const value = tryGetConstant(seed) ?? tryGetConstant(seed.N());
  if (value !== undefined) {
    const [lo, hi] = foldSeed(value);
    return gpuSeedWords(lo, hi, language);
  }

  const symbol = isSymbol(seed) ? seed.symbol : undefined;
  if (symbol === undefined)
    throw new Error(
      'WithRandomSeed(seed, …): a COMPUTED seed expression cannot be ' +
        'compiled to a shader — the folded seed is spliced at every draw ' +
        'site of the frame, so it would be recomputed per draw. Use a ' +
        'compile-time constant seed (host-identical stream) or a single ' +
        'shader-supplied symbol (its own stream). Fail closed (D6).'
    );

  const mapped = target.var(symbol);
  if (mapped !== undefined) {
    if (gpuRandomState(target).varNames?.has(symbol))
      throw new Error(
        `WithRandomSeed(${symbol}, …): a seed supplied through \`vars\` ` +
          `(\`${symbol}\` → \`${mapped}\`) is the HOST-UNIFORM row of the ` +
          `seed ABI, which is not implemented: the host folds an f64 seed ` +
          `with \`foldSeed\` into TWO words, while a shader can only ` +
          `reinterpret the f32 bits it receives (\`seedHi = 0u\`), so the ` +
          `shader would silently draw a DIFFERENT stream than the host. Use ` +
          `either a compile-time literal seed — the host-identical stream — ` +
          `or an explicitly invocation-varying seed symbol that is NOT in ` +
          `\`vars\`, which owns its own stream. Fail closed (D6).`
      );
    throw new Error(
      `WithRandomSeed(${symbol}, …): the seed resolves to the shader ` +
        `constant \`${mapped}\`, which the seed ABI cannot fold. Use a ` +
        `compile-time numeric or string seed. Fail closed (D6).`
    );
  }

  // A free symbol: the shader supplies its value (a uniform or varying the
  // caller declares), so there is no host counterpart to agree with and the
  // frame derives its OWN stream from the seed's BITS.
  const src = compile(seed).trim();
  return language === 'wgsl'
    ? `vec2<u32>(bitcast<u32>(${src}), 0u)`
    : `uvec2(floatBitsToUint(${src}), 0u)`;
}

/**
 * Compile a Matrix expression to GPU-native types when possible.
 *
 * Handles two optimizations:
 * - Column vectors (Nx1): flatten to vecN instead of nested single-element arrays
 * - Square matrices (NxN, N=2,3,4): use native matN types with column-major transposition
 *
 * Falls back to compiling the nested List structure for other shapes.
 */
export function compileGPUMatrix(
  args: ReadonlyArray<Expression>,
  compile: (expr: Expression) => string,
  vecFn: (n: number) => string,
  matFn: (n: number) => string,
  arrayFn: (n: number) => string
): string {
  const body = args[0];
  if (!isFunction(body)) return compile(body);

  const rows = body.ops;
  if (rows.length === 0) return compile(body);

  const numRows = rows.length;
  const firstRow = rows[0];
  const numCols = isFunction(firstRow) ? firstRow.nops : 0;

  // Column vector (Nx1): flatten to vecN or array<f32, N>
  if (numCols === 1 && rows.every((row) => isFunction(row) && row.nops === 1)) {
    const elements = rows.map((row) =>
      compile(isFunction(row) ? row.ops[0] : row)
    );
    if (numRows >= 2 && numRows <= 4)
      return `${vecFn(numRows)}(${elements.join(', ')})`;
    return `${arrayFn(numRows)}(${elements.join(', ')})`;
  }

  // Square matrix NxN (N=2,3,4): use native matrix type
  // GPU matrices are column-major, our Matrix is row-major → transpose
  if (
    numRows === numCols &&
    numRows >= 2 &&
    numRows <= 4 &&
    rows.every((row) => isFunction(row) && row.nops === numCols)
  ) {
    const cols: string[] = [];
    for (let c = 0; c < numCols; c++) {
      const colElements = rows.map((row) =>
        compile(isFunction(row) ? row.ops[c] : row)
      );
      cols.push(`${vecFn(numRows)}(${colElements.join(', ')})`);
    }
    return `${matFn(numRows)}(${cols.join(', ')})`;
  }

  // Default: compile the nested list structure as-is
  return compile(body);
}

/**
 * GPU gamma function using Lanczos approximation (g=7, n=9 coefficients).
 *
 * Uses reflection formula for z < 0.5 (with inlined, non-recursive Lanczos)
 * and Lanczos for z >= 0.5. `_gpu_gammaln` is the Stirling asymptotic
 * expansion of ln(Gamma(z)), valid for z > 0. GLSL syntax.
 */
export const GPU_GAMMA_PREAMBLE_GLSL = `
float _gpu_gamma(float z) {
  const float PI = 3.14159265358979;
  float w = z;
  if (z < 0.5) w = 1.0 - z;
  w -= 1.0;
  float x = 0.99999999999980993;
  x += 676.5203681218851 / (w + 1.0);
  x += -1259.1392167224028 / (w + 2.0);
  x += 771.32342877765313 / (w + 3.0);
  x += -176.61502916214059 / (w + 4.0);
  x += 12.507343278686905 / (w + 5.0);
  x += -0.13857109526572012 / (w + 6.0);
  x += 9.9843695780195716e-6 / (w + 7.0);
  x += 1.5056327351493116e-7 / (w + 8.0);
  float t = w + 7.5;
  float g = sqrt(2.0 * PI) * pow(t, w + 0.5) * exp(-t) * x;
  if (z < 0.5) return PI / (sin(PI * z) * g);
  return g;
}

float _gpu_gammaln(float z) {
  float z3 = z * z * z;
  return z * log(z) - z - 0.5 * log(z)
    + 0.5 * log(2.0 * 3.14159265358979)
    + 1.0 / (12.0 * z)
    - 1.0 / (360.0 * z3)
    + 1.0 / (1260.0 * z3 * z * z);
}
`;

/**
 * GPU Gamma function preamble (WGSL syntax). WGSL has no implicit GLSL-style
 * `float`/braceless-`if` syntax, so a `_WGSL` variant is required (the GLSL
 * preamble does not compile as WGSL).
 */
export const GPU_GAMMA_PREAMBLE_WGSL = `
fn _gpu_gamma(z: f32) -> f32 {
  let PI = 3.14159265358979;
  var w = z;
  if (z < 0.5) { w = 1.0 - z; }
  w = w - 1.0;
  var x = 0.99999999999980993;
  x = x + 676.5203681218851 / (w + 1.0);
  x = x + -1259.1392167224028 / (w + 2.0);
  x = x + 771.32342877765313 / (w + 3.0);
  x = x + -176.61502916214059 / (w + 4.0);
  x = x + 12.507343278686905 / (w + 5.0);
  x = x + -0.13857109526572012 / (w + 6.0);
  x = x + 9.9843695780195716e-6 / (w + 7.0);
  x = x + 1.5056327351493116e-7 / (w + 8.0);
  let t = w + 7.5;
  let g = sqrt(2.0 * PI) * pow(t, w + 0.5) * exp(-t) * x;
  if (z < 0.5) { return PI / (sin(PI * z) * g); }
  return g;
}

fn _gpu_gammaln(z: f32) -> f32 {
  let z3 = z * z * z;
  return z * log(z) - z - 0.5 * log(z)
    + 0.5 * log(2.0 * 3.14159265358979)
    + 1.0 / (12.0 * z)
    - 1.0 / (360.0 * z3)
    + 1.0 / (1260.0 * z3 * z * z);
}
`;

/**
 * GPU error function using Abramowitz & Stegun approximation.
 * Maximum error: |epsilon(x)| <= 1.5e-7. GLSL syntax.
 */
export const GPU_ERF_PREAMBLE_GLSL = `
float _gpu_erf(float x) {
  float ax = abs(x);
  float t = 1.0 / (1.0 + 0.3275911 * ax);
  float y = ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t;
  float result = 1.0 - y * exp(-ax * ax);
  return x < 0.0 ? -result : result;
}

float _gpu_erfinv(float x) {
  float pi = 3.14159265358979;
  float x2 = x * x;
  float x3 = x * x2;
  float x5 = x3 * x2;
  float x7 = x5 * x2;
  float x9 = x7 * x2;
  return sqrt(pi) * 0.5 * (x + (pi / 12.0) * x3 + (7.0 * pi * pi / 480.0) * x5 + (127.0 * pi * pi * pi / 40320.0) * x7 + (4369.0 * pi * pi * pi * pi / 5806080.0) * x9);
}
`;

/**
 * GPU error function preamble (WGSL syntax). See GPU_GAMMA_PREAMBLE_WGSL.
 */
export const GPU_ERF_PREAMBLE_WGSL = `
fn _gpu_erf(x: f32) -> f32 {
  let ax = abs(x);
  let t = 1.0 / (1.0 + 0.3275911 * ax);
  let y = ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t;
  let result = 1.0 - y * exp(-ax * ax);
  if (x < 0.0) { return -result; }
  return result;
}

fn _gpu_erfinv(x: f32) -> f32 {
  let pi = 3.14159265358979;
  let x2 = x * x;
  let x3 = x * x2;
  let x5 = x3 * x2;
  let x7 = x5 * x2;
  let x9 = x7 * x2;
  return sqrt(pi) * 0.5 * (x + (pi / 12.0) * x3 + (7.0 * pi * pi / 480.0) * x5 + (127.0 * pi * pi * pi / 40320.0) * x7 + (4369.0 * pi * pi * pi * pi / 5806080.0) * x9);
}
`;

/**
 * GPU Heaviside step function preamble (GLSL syntax).
 * Returns 0 for x<0, 0.5 at x=0, 1 for x>0.
 */
export const GPU_HEAVISIDE_PREAMBLE_GLSL = `
float _gpu_heaviside(float x) {
  if (x < 0.0) return 0.0;
  if (x > 0.0) return 1.0;
  return 0.5;
}
`;

/**
 * GPU Heaviside step function preamble (WGSL syntax).
 */
export const GPU_HEAVISIDE_PREAMBLE_WGSL = `
fn _gpu_heaviside(x: f32) -> f32 {
  if (x < 0.0) { return 0.0; }
  if (x > 0.0) { return 1.0; }
  return 0.5;
}
`;

/**
 * GPU sinc function preamble (GLSL syntax).
 * sinc(x) = sin(x)/x, sinc(0) = 1.
 */
export const GPU_SINC_PREAMBLE_GLSL = `
float _gpu_sinc(float x) {
  if (abs(x) < 1e-10) return 1.0;
  return sin(x) / x;
}
`;

/**
 * GPU sinc function preamble (WGSL syntax).
 */
export const GPU_SINC_PREAMBLE_WGSL = `
fn _gpu_sinc(x: f32) -> f32 {
  if (abs(x) < 1e-10) { return 1.0; }
  return sin(x) / x;
}
`;

/**
 * GPU Horner polynomial evaluation helper (GLSL syntax).
 * Shared by FresnelC and FresnelS preambles.
 */
export const GPU_POLEVL_PREAMBLE_GLSL = `
float _gpu_polevl(float x, float c[12], int n) {
  float ans = c[0];
  for (int i = 1; i < n; i++) ans = ans * x + c[i];
  return ans;
}
`;

/**
 * GPU Horner polynomial evaluation helper (WGSL syntax).
 */
export const GPU_POLEVL_PREAMBLE_WGSL = `
fn _gpu_polevl(x: f32, c: array<f32, 12>, n: i32) -> f32 {
  var ans = c[0];
  for (var i: i32 = 1; i < n; i++) { ans = ans * x + c[i]; }
  return ans;
}
`;

/**
 * GPU Fresnel cosine integral preamble (GLSL syntax).
 *
 * C(x) = integral from 0 to x of cos(pi*t^2/2) dt.
 * Uses rational Chebyshev approximation (Cephes/scipy) with three regions:
 * |x|<1.6, 1.6<=|x|<36, |x|>=36.
 * Requires _gpu_polevl preamble.
 */
export const GPU_FRESNELC_PREAMBLE_GLSL = `
float _gpu_fresnelC(float x_in) {
  float sgn = x_in < 0.0 ? -1.0 : 1.0;
  float x = abs(x_in);

  if (x < 1.6) {
    float x2 = x * x;
    float t = x2 * x2;
    float cn[6] = float[6](
      -4.98843114573573548651e-8, 9.50428062829859605134e-6,
      -6.45191435683965050962e-4, 1.88843319396703850064e-2,
      -2.05525900955013891793e-1, 9.99999999999999998822e-1
    );
    float cd[7] = float[7](
      3.99982968972495980367e-12, 9.15439215774657478799e-10,
      1.25001862479598821474e-7, 1.22262789024179030997e-5,
      8.68029542941784300606e-4, 4.12142090722199792936e-2, 1.0
    );
    return sgn * x * _gpu_polevl(t, cn, 6) / _gpu_polevl(t, cd, 7);
  }

  if (x < 36.0) {
    float x2 = x * x;
    float t = 3.14159265358979 * x2;
    float u = 1.0 / (t * t);
    float fn[10] = float[10](
      4.21543555043677546506e-1, 1.43407919780758885261e-1,
      1.15220955073585758835e-2, 3.450179397825740279e-4,
      4.63613749287867322088e-6, 3.05568983790257605827e-8,
      1.02304514164907233465e-10, 1.72010743268161828879e-13,
      1.34283276233062758925e-16, 3.76329711269987889006e-20
    );
    float fd[11] = float[11](
      1.0, 7.51586398353378947175e-1,
      1.16888925859191382142e-1, 6.44051526508858611005e-3,
      1.55934409164153020873e-4, 1.8462756734893054587e-6,
      1.12699224763999035261e-8, 3.60140029589371370404e-11,
      5.8875453362157841001e-14, 4.52001434074129701496e-17,
      1.25443237090011264384e-20
    );
    float gn[11] = float[11](
      5.04442073643383265887e-1, 1.97102833525523411709e-1,
      1.87648584092575249293e-2, 6.84079380915393090172e-4,
      1.15138826111884280931e-5, 9.82852443688422223854e-8,
      4.45344415861750144738e-10, 1.08268041139020870318e-12,
      1.37555460633261799868e-15, 8.36354435630677421531e-19,
      1.86958710162783235106e-22
    );
    float gd[12] = float[12](
      1.0, 1.47495759925128324529,
      3.37748989120019970451e-1, 2.53603741420338795122e-2,
      8.14679107184306179049e-4, 1.27545075667729118702e-5,
      1.04314589657571990585e-7, 4.60680728515232032307e-10,
      1.10273215066240270757e-12, 1.38796531259578871258e-15,
      8.39158816283118707363e-19, 1.86958710162783236342e-22
    );
    float f = 1.0 - u * _gpu_polevl(u, fn, 10) / _gpu_polevl(u, fd, 11);
    float g = (1.0 / t) * _gpu_polevl(u, gn, 11) / _gpu_polevl(u, gd, 12);
    float z = 1.5707963267948966 * x2;
    float c = cos(z);
    float s = sin(z);
    return sgn * (0.5 + (f * s - g * c) / (3.14159265358979 * x));
  }

  return sgn * 0.5;
}
`;

/**
 * GPU Fresnel cosine integral preamble (WGSL syntax).
 * Requires _gpu_polevl preamble.
 */
export const GPU_FRESNELC_PREAMBLE_WGSL = `
fn _gpu_fresnelC(x_in: f32) -> f32 {
  let sgn: f32 = select(1.0, -1.0, x_in < 0.0);
  let x = abs(x_in);

  if (x < 1.6) {
    let x2 = x * x;
    let t = x2 * x2;
    var cn = array<f32, 12>(
      -4.98843114573573548651e-8, 9.50428062829859605134e-6,
      -6.45191435683965050962e-4, 1.88843319396703850064e-2,
      -2.05525900955013891793e-1, 9.99999999999999998822e-1,
      0.0, 0.0, 0.0, 0.0, 0.0, 0.0
    );
    var cd = array<f32, 12>(
      3.99982968972495980367e-12, 9.15439215774657478799e-10,
      1.25001862479598821474e-7, 1.22262789024179030997e-5,
      8.68029542941784300606e-4, 4.12142090722199792936e-2, 1.0,
      0.0, 0.0, 0.0, 0.0, 0.0
    );
    return sgn * x * _gpu_polevl(t, cn, 6) / _gpu_polevl(t, cd, 7);
  }

  if (x < 36.0) {
    let x2 = x * x;
    let t = 3.14159265358979 * x2;
    let u = 1.0 / (t * t);
    var fn = array<f32, 12>(
      4.21543555043677546506e-1, 1.43407919780758885261e-1,
      1.15220955073585758835e-2, 3.450179397825740279e-4,
      4.63613749287867322088e-6, 3.05568983790257605827e-8,
      1.02304514164907233465e-10, 1.72010743268161828879e-13,
      1.34283276233062758925e-16, 3.76329711269987889006e-20,
      0.0, 0.0
    );
    var fd = array<f32, 12>(
      1.0, 7.51586398353378947175e-1,
      1.16888925859191382142e-1, 6.44051526508858611005e-3,
      1.55934409164153020873e-4, 1.8462756734893054587e-6,
      1.12699224763999035261e-8, 3.60140029589371370404e-11,
      5.8875453362157841001e-14, 4.52001434074129701496e-17,
      1.25443237090011264384e-20, 0.0
    );
    var gn = array<f32, 12>(
      5.04442073643383265887e-1, 1.97102833525523411709e-1,
      1.87648584092575249293e-2, 6.84079380915393090172e-4,
      1.15138826111884280931e-5, 9.82852443688422223854e-8,
      4.45344415861750144738e-10, 1.08268041139020870318e-12,
      1.37555460633261799868e-15, 8.36354435630677421531e-19,
      1.86958710162783235106e-22, 0.0
    );
    var gd = array<f32, 12>(
      1.0, 1.47495759925128324529,
      3.37748989120019970451e-1, 2.53603741420338795122e-2,
      8.14679107184306179049e-4, 1.27545075667729118702e-5,
      1.04314589657571990585e-7, 4.60680728515232032307e-10,
      1.10273215066240270757e-12, 1.38796531259578871258e-15,
      8.39158816283118707363e-19, 1.86958710162783236342e-22
    );
    let f = 1.0 - u * _gpu_polevl(u, fn, 10) / _gpu_polevl(u, fd, 11);
    let g = (1.0 / t) * _gpu_polevl(u, gn, 11) / _gpu_polevl(u, gd, 12);
    let z = 1.5707963267948966 * x2;
    let c = cos(z);
    let s = sin(z);
    return sgn * (0.5 + (f * s - g * c) / (3.14159265358979 * x));
  }

  return sgn * 0.5;
}
`;

/**
 * GPU Fresnel sine integral preamble (GLSL syntax).
 *
 * S(x) = integral from 0 to x of sin(pi*t^2/2) dt.
 * Uses rational Chebyshev approximation (Cephes/scipy) with three regions.
 * Requires _gpu_polevl preamble.
 */
export const GPU_FRESNELS_PREAMBLE_GLSL = `
float _gpu_fresnelS(float x_in) {
  float sgn = x_in < 0.0 ? -1.0 : 1.0;
  float x = abs(x_in);

  if (x < 1.6) {
    float x2 = x * x;
    float t = x2 * x2;
    float sn[6] = float[6](
      -2.99181919401019853726e3, 7.08840045257738576863e5,
      -6.29741486205862506537e7, 2.54890880573376359104e9,
      -4.42979518059697779103e10, 3.18016297876567817986e11
    );
    float sd[7] = float[7](
      1.0, 2.81376268889994315696e2, 4.55847810806532581675e4,
      5.1734388877009640073e6, 4.19320245898111231129e8, 2.2441179564534092094e10,
      6.07366389490084914091e11
    );
    return sgn * x * x2 * _gpu_polevl(t, sn, 6) / _gpu_polevl(t, sd, 7);
  }

  if (x < 36.0) {
    float x2 = x * x;
    float t = 3.14159265358979 * x2;
    float u = 1.0 / (t * t);
    float fn[10] = float[10](
      4.21543555043677546506e-1, 1.43407919780758885261e-1,
      1.15220955073585758835e-2, 3.450179397825740279e-4,
      4.63613749287867322088e-6, 3.05568983790257605827e-8,
      1.02304514164907233465e-10, 1.72010743268161828879e-13,
      1.34283276233062758925e-16, 3.76329711269987889006e-20
    );
    float fd[11] = float[11](
      1.0, 7.51586398353378947175e-1,
      1.16888925859191382142e-1, 6.44051526508858611005e-3,
      1.55934409164153020873e-4, 1.8462756734893054587e-6,
      1.12699224763999035261e-8, 3.60140029589371370404e-11,
      5.8875453362157841001e-14, 4.52001434074129701496e-17,
      1.25443237090011264384e-20
    );
    float gn[11] = float[11](
      5.04442073643383265887e-1, 1.97102833525523411709e-1,
      1.87648584092575249293e-2, 6.84079380915393090172e-4,
      1.15138826111884280931e-5, 9.82852443688422223854e-8,
      4.45344415861750144738e-10, 1.08268041139020870318e-12,
      1.37555460633261799868e-15, 8.36354435630677421531e-19,
      1.86958710162783235106e-22
    );
    float gd[12] = float[12](
      1.0, 1.47495759925128324529,
      3.37748989120019970451e-1, 2.53603741420338795122e-2,
      8.14679107184306179049e-4, 1.27545075667729118702e-5,
      1.04314589657571990585e-7, 4.60680728515232032307e-10,
      1.10273215066240270757e-12, 1.38796531259578871258e-15,
      8.39158816283118707363e-19, 1.86958710162783236342e-22
    );
    float f = 1.0 - u * _gpu_polevl(u, fn, 10) / _gpu_polevl(u, fd, 11);
    float g = (1.0 / t) * _gpu_polevl(u, gn, 11) / _gpu_polevl(u, gd, 12);
    float z = 1.5707963267948966 * x2;
    float c = cos(z);
    float s = sin(z);
    return sgn * (0.5 - (f * c + g * s) / (3.14159265358979 * x));
  }

  return sgn * 0.5;
}
`;

/**
 * GPU Fresnel sine integral preamble (WGSL syntax).
 * Requires _gpu_polevl preamble.
 */
export const GPU_FRESNELS_PREAMBLE_WGSL = `
fn _gpu_fresnelS(x_in: f32) -> f32 {
  let sgn: f32 = select(1.0, -1.0, x_in < 0.0);
  let x = abs(x_in);

  if (x < 1.6) {
    let x2 = x * x;
    let t = x2 * x2;
    var sn = array<f32, 12>(
      -2.99181919401019853726e3, 7.08840045257738576863e5,
      -6.29741486205862506537e7, 2.54890880573376359104e9,
      -4.42979518059697779103e10, 3.18016297876567817986e11,
      0.0, 0.0, 0.0, 0.0, 0.0, 0.0
    );
    var sd = array<f32, 12>(
      1.0, 2.81376268889994315696e2, 4.55847810806532581675e4,
      5.1734388877009640073e6, 4.19320245898111231129e8, 2.2441179564534092094e10,
      6.07366389490084914091e11,
      0.0, 0.0, 0.0, 0.0, 0.0
    );
    return sgn * x * x2 * _gpu_polevl(t, sn, 6) / _gpu_polevl(t, sd, 7);
  }

  if (x < 36.0) {
    let x2 = x * x;
    let t = 3.14159265358979 * x2;
    let u = 1.0 / (t * t);
    var fn = array<f32, 12>(
      4.21543555043677546506e-1, 1.43407919780758885261e-1,
      1.15220955073585758835e-2, 3.450179397825740279e-4,
      4.63613749287867322088e-6, 3.05568983790257605827e-8,
      1.02304514164907233465e-10, 1.72010743268161828879e-13,
      1.34283276233062758925e-16, 3.76329711269987889006e-20,
      0.0, 0.0
    );
    var fd = array<f32, 12>(
      1.0, 7.51586398353378947175e-1,
      1.16888925859191382142e-1, 6.44051526508858611005e-3,
      1.55934409164153020873e-4, 1.8462756734893054587e-6,
      1.12699224763999035261e-8, 3.60140029589371370404e-11,
      5.8875453362157841001e-14, 4.52001434074129701496e-17,
      1.25443237090011264384e-20, 0.0
    );
    var gn = array<f32, 12>(
      5.04442073643383265887e-1, 1.97102833525523411709e-1,
      1.87648584092575249293e-2, 6.84079380915393090172e-4,
      1.15138826111884280931e-5, 9.82852443688422223854e-8,
      4.45344415861750144738e-10, 1.08268041139020870318e-12,
      1.37555460633261799868e-15, 8.36354435630677421531e-19,
      1.86958710162783235106e-22, 0.0
    );
    var gd = array<f32, 12>(
      1.0, 1.47495759925128324529,
      3.37748989120019970451e-1, 2.53603741420338795122e-2,
      8.14679107184306179049e-4, 1.27545075667729118702e-5,
      1.04314589657571990585e-7, 4.60680728515232032307e-10,
      1.10273215066240270757e-12, 1.38796531259578871258e-15,
      8.39158816283118707363e-19, 1.86958710162783236342e-22
    );
    let f = 1.0 - u * _gpu_polevl(u, fn, 10) / _gpu_polevl(u, fd, 11);
    let g = (1.0 / t) * _gpu_polevl(u, gn, 11) / _gpu_polevl(u, gd, 12);
    let z = 1.5707963267948966 * x2;
    let c = cos(z);
    let s = sin(z);
    return sgn * (0.5 - (f * c + g * s) / (3.14159265358979 * x));
  }

  return sgn * 0.5;
}
`;

/**
 * GPU Bessel J function preamble (GLSL syntax).
 *
 * J_n(x) for integer order n. Uses three algorithms:
 * - Power series for small x (x < 5+n)
 * - Hankel asymptotic for large x (x > 25+n^2/2)
 * - Miller's backward recurrence for intermediate x
 */
export const GPU_BESSELJ_PREAMBLE_GLSL = `
float _gpu_factorial(int n) {
  float f = 1.0;
  for (int i = 2; i <= n; i++) f *= float(i);
  return f;
}

float _gpu_besselJ_series(int n, float x) {
  float halfX = x / 2.0;
  float negQ = -(x * x) / 4.0;
  float term = 1.0;
  for (int i = 1; i <= n; i++) term /= float(i);
  float s = term;
  for (int k = 1; k <= 60; k++) {
    term *= negQ / (float(k) * float(n + k));
    s += term;
    if (abs(term) < abs(s) * 1e-7) break;
  }
  return s * pow(halfX, float(n));
}

float _gpu_besselJ_asymptotic(int n, float x) {
  float mu = 4.0 * float(n) * float(n);
  float P = 1.0;
  float Q = 0.0;
  float ak = 1.0;
  float e8x = 8.0 * x;
  for (int k = 1; k <= 12; k++) {
    float twokm1 = float(2 * k - 1);
    ak *= mu - twokm1 * twokm1;
    float denom = _gpu_factorial(k) * pow(e8x, float(k));
    float contrib = ak / denom;
    if (k == 1 || k == 3 || k == 5 || k == 7 || k == 9 || k == 11) {
      if (((k - 1) / 2) % 2 == 0) Q += contrib;
      else Q -= contrib;
    } else {
      if ((k / 2) % 2 == 1) P -= contrib;
      else P += contrib;
    }
    if (abs(contrib) < 1e-7) break;
  }
  float chi = x - (float(n) / 2.0 + 0.25) * 3.14159265358979;
  return sqrt(2.0 / (3.14159265358979 * x)) * (P * cos(chi) - Q * sin(chi));
}

float _gpu_besselJ(int n, float x) {
  if (x == 0.0) return n == 0 ? 1.0 : 0.0;
  float sgn = 1.0;
  if (n < 0) {
    n = -n;
    if (n % 2 != 0) sgn = -1.0;
  }
  if (x < 0.0) {
    x = -x;
    if (n % 2 != 0) sgn *= -1.0;
  }
  if (x > 25.0 + float(n * n) / 2.0) return sgn * _gpu_besselJ_asymptotic(n, x);
  if (x < 5.0 + float(n)) return sgn * _gpu_besselJ_series(n, x);
  int M = max(n + 20, int(ceil(x)) + 30);
  if (M > 200) return sgn * _gpu_besselJ_series(n, x);
  float vals[201];
  float jp1 = 0.0;
  float jk = 1.0;
  vals[M] = jk;
  for (int k = M; k >= 1; k--) {
    float jm1 = (2.0 * float(k) / x) * jk - jp1;
    jp1 = jk;
    jk = jm1;
    vals[k - 1] = jk;
  }
  float norm = vals[0];
  for (int k = 2; k <= M; k += 2) norm += 2.0 * vals[k];
  return sgn * vals[n] / norm;
}
`;

/**
 * GPU Bessel J function preamble (WGSL syntax).
 */
export const GPU_BESSELJ_PREAMBLE_WGSL = `
fn _gpu_factorial(n: i32) -> f32 {
  var f: f32 = 1.0;
  for (var i: i32 = 2; i <= n; i++) { f *= f32(i); }
  return f;
}

fn _gpu_besselJ_series(n_in: i32, x: f32) -> f32 {
  let halfX = x / 2.0;
  let negQ = -(x * x) / 4.0;
  var term: f32 = 1.0;
  for (var i: i32 = 1; i <= n_in; i++) { term /= f32(i); }
  var s = term;
  for (var k: i32 = 1; k <= 60; k++) {
    term *= negQ / (f32(k) * f32(n_in + k));
    s += term;
    if (abs(term) < abs(s) * 1e-7) { break; }
  }
  return s * pow(halfX, f32(n_in));
}

fn _gpu_besselJ_asymptotic(n_in: i32, x: f32) -> f32 {
  let mu = 4.0 * f32(n_in) * f32(n_in);
  var P: f32 = 1.0;
  var Q: f32 = 0.0;
  var ak: f32 = 1.0;
  let e8x = 8.0 * x;
  for (var k: i32 = 1; k <= 12; k++) {
    let twokm1 = f32(2 * k - 1);
    ak *= mu - twokm1 * twokm1;
    let denom = _gpu_factorial(k) * pow(e8x, f32(k));
    let contrib = ak / denom;
    if (k == 1 || k == 3 || k == 5 || k == 7 || k == 9 || k == 11) {
      if (((k - 1) / 2) % 2 == 0) { Q += contrib; }
      else { Q -= contrib; }
    } else {
      if ((k / 2) % 2 == 1) { P -= contrib; }
      else { P += contrib; }
    }
    if (abs(contrib) < 1e-7) { break; }
  }
  let chi = x - (f32(n_in) / 2.0 + 0.25) * 3.14159265358979;
  return sqrt(2.0 / (3.14159265358979 * x)) * (P * cos(chi) - Q * sin(chi));
}

fn _gpu_besselJ(n_in: i32, x_in: f32) -> f32 {
  var n = n_in;
  var x = x_in;
  if (x == 0.0) { return select(0.0, 1.0, n == 0); }
  var sgn: f32 = 1.0;
  if (n < 0) {
    n = -n;
    if (n % 2 != 0) { sgn = -1.0; }
  }
  if (x < 0.0) {
    x = -x;
    if (n % 2 != 0) { sgn *= -1.0; }
  }
  if (x > 25.0 + f32(n * n) / 2.0) { return sgn * _gpu_besselJ_asymptotic(n, x); }
  if (x < 5.0 + f32(n)) { return sgn * _gpu_besselJ_series(n, x); }
  var M = max(n + 20, i32(ceil(x)) + 30);
  if (M > 200) { return sgn * _gpu_besselJ_series(n, x); }
  var vals: array<f32, 201>;
  var jp1: f32 = 0.0;
  var jk: f32 = 1.0;
  vals[M] = jk;
  for (var k: i32 = M; k >= 1; k--) {
    let jm1 = (2.0 * f32(k) / x) * jk - jp1;
    jp1 = jk;
    jk = jm1;
    vals[k - 1] = jk;
  }
  var norm = vals[0];
  for (var k2: i32 = 2; k2 <= M; k2 += 2) { norm += 2.0 * vals[k2]; }
  return sgn * vals[n] / norm;
}
`;

/**
 * Fractal preamble (GLSL syntax).
 *
 * Smooth escape-time iteration for Mandelbrot and Julia sets.
 * Both functions return a normalized float in [0, 1] with smooth coloring
 * (log2(log2(|z|²)) formula) to avoid banding.
 */
export const GPU_FRACTAL_PREAMBLE_GLSL = `
float _fractal_mandelbrot(vec2 c, int maxIter) {
  vec2 z = vec2(0.0, 0.0);
  for (int i = 0; i < maxIter; i++) {
    z = vec2(z.x*z.x - z.y*z.y + c.x, 2.0*z.x*z.y + c.y);
    if (dot(z, z) > 4.0)
      return clamp((float(i) - log2(log2(dot(z, z))) + 4.0) / float(maxIter), 0.0, 1.0);
  }
  return 1.0;
}

float _fractal_julia(vec2 z, vec2 c, int maxIter) {
  for (int i = 0; i < maxIter; i++) {
    z = vec2(z.x*z.x - z.y*z.y + c.x, 2.0*z.x*z.y + c.y);
    if (dot(z, z) > 4.0)
      return clamp((float(i) - log2(log2(dot(z, z))) + 4.0) / float(maxIter), 0.0, 1.0);
  }
  return 1.0;
}
`;

/**
 * Fractal preamble (WGSL syntax).
 */
export const GPU_FRACTAL_PREAMBLE_WGSL = `
fn _fractal_mandelbrot(c: vec2f, maxIter: i32) -> f32 {
  var z = vec2f(0.0, 0.0);
  for (var i: i32 = 0; i < maxIter; i++) {
    z = vec2f(z.x*z.x - z.y*z.y + c.x, 2.0*z.x*z.y + c.y);
    if (dot(z, z) > 4.0) {
      return clamp((f32(i) - log2(log2(dot(z, z))) + 4.0) / f32(maxIter), 0.0, 1.0);
    }
  }
  return 1.0;
}

fn _fractal_julia(z_in: vec2f, c: vec2f, maxIter: i32) -> f32 {
  var z = z_in;
  for (var i: i32 = 0; i < maxIter; i++) {
    z = vec2f(z.x*z.x - z.y*z.y + c.x, 2.0*z.x*z.y + c.y);
    if (dot(z, z) > 4.0) {
      return clamp((f32(i) - log2(log2(dot(z, z))) + 4.0) / f32(maxIter), 0.0, 1.0);
    }
  }
  return 1.0;
}
`;

// ─── Statistical preambles ────────────────────────────────────────────────────

/**
 * GPU GCD preamble (GLSL syntax).
 * Tolerant floating Euclidean algorithm: terminates when the remainder falls
 * below `ε · max(|a|, |b|)` (ε = 1e-6, the f32 float-GCD tolerance) rather than
 * exact zero, so it handles non-integer reals (e.g. Desmos-style
 * `gcd(θ², θ+a)`) as well as integer-valued inputs.
 *
 * Integer inputs within the f32 exact-integer range (< 2^24) take a plain
 * Euclid path with no tolerance — mirrors the JS realGcd so integer inputs
 * never regress (e.g. `_gpu_gcd(4000000.0, 2.0) == 2.0`). The final
 * scale-mismatch guard keeps the result <= min(|a|, |b|).
 */
export const GPU_GCD_PREAMBLE_GLSL = `
float _gpu_gcd(float a, float b) {
  a = abs(a); b = abs(b);
  if (a == 0.0) return b;
  if (b == 0.0) return a;
  if (floor(a) == a && floor(b) == b && a < 16777216.0 && b < 16777216.0) {
    for (int i = 0; i < 64; i++) {
      if (b == 0.0) break;
      float t = mod(a, b);
      a = b;
      b = t;
    }
    return a;
  }
  float mn = min(a, b);
  float tol = 1e-6 * max(a, b);
  for (int i = 0; i < 64; i++) {
    if (b <= tol) break;
    float t = mod(a, b);
    a = b;
    b = t;
  }
  return a > mn ? mn : a;
}
`;

/**
 * GPU GCD preamble (WGSL syntax). See GPU_GCD_PREAMBLE_GLSL for the
 * algorithm notes (integer fast path, tolerance, scale-mismatch guard).
 */
export const GPU_GCD_PREAMBLE_WGSL = `
fn _gpu_gcd(a_in: f32, b_in: f32) -> f32 {
  var a = abs(a_in); var b = abs(b_in);
  if (a == 0.0) { return b; }
  if (b == 0.0) { return a; }
  if (floor(a) == a && floor(b) == b && a < 16777216.0 && b < 16777216.0) {
    for (var i: i32 = 0; i < 64; i++) {
      if (b == 0.0) { break; }
      let t = a % b;
      a = b;
      b = t;
    }
    return a;
  }
  let mn = min(a, b);
  let tol = 1e-6 * max(a, b);
  for (var i: i32 = 0; i < 64; i++) {
    if (b <= tol) { break; }
    let t = a % b;
    a = b;
    b = t;
  }
  if (a > mn) { return mn; }
  return a;
}
`;

/**
 * GPU Random preamble (GLSL syntax) — PCG3D.
 *
 * `_gpu_pcg3d` is transcribed VERBATIM from Jarzynski & Olano, *Hash Functions
 * for GPU Rendering*, JCGT 2020, §6 — the same listing `pcg3d()` in
 * `numerics/random.ts` transcribes. Pure u32 arithmetic (exact on ES 3.00+),
 * so the shader computes the identical integer words as the host for identical
 * inputs; changing a constant or the operation order is a BREAKING change to
 * the seed→stream mapping, pinned by `test/compute-engine/random-vectors.test.ts`.
 *
 * The cross-multiply-adds are SEQUENTIAL — `v.y += v.z*v.x` reads the `v.x`
 * just updated.
 *
 * `_gpu_rnd_draw` presents `w0` as `(w0 >> 8) * 2⁻²⁴`: the top 24 bits scaled
 * by an exact power of two, never implementation-rounded float math. It
 * advances the caller's invocation-local counter, taken by `inout`, so
 * repeated draws in one frame decorrelate.
 */
export const GPU_PCG3D_PREAMBLE_GLSL = `
uvec3 _gpu_pcg3d(uvec3 v) {
  v = v * 1664525u + 1013904223u;
  v.x += v.y*v.z; v.y += v.z*v.x; v.z += v.x*v.y;
  v ^= v >> 16u;
  v.x += v.y*v.z; v.y += v.z*v.x; v.z += v.x*v.y;
  return v;
}
float _gpu_rnd_draw(uvec2 seed, inout uint n) {
  uvec3 w = _gpu_pcg3d(uvec3(seed.x, seed.y, n));
  n = n + 1u;
  return float(w.x >> 8u) * (1.0 / 16777216.0);
}
`;

/**
 * GPU Random preamble (WGSL syntax) — PCG3D. See
 * `GPU_PCG3D_PREAMBLE_GLSL` for the algorithm notes; this is the same
 * transcription with WGSL's `var<private>` counters passed by pointer.
 */
export const GPU_PCG3D_PREAMBLE_WGSL = `
fn _gpu_pcg3d(v_in: vec3<u32>) -> vec3<u32> {
  var v = v_in * 1664525u + 1013904223u;
  v.x += v.y*v.z; v.y += v.z*v.x; v.z += v.x*v.y;
  v = v ^ (v >> vec3<u32>(16u));
  v.x += v.y*v.z; v.y += v.z*v.x; v.z += v.x*v.y;
  return v;
}
fn _gpu_rnd_draw(seed: vec2<u32>, n: ptr<private, u32>) -> f32 {
  let w = _gpu_pcg3d(vec3<u32>(seed.x, seed.y, *n));
  *n = *n + 1u;
  return f32(w.x >> 8u) * (1.0 / 16777216.0);
}
`;

/**
 * GPU Median preamble (GLSL syntax).
 *
 * One function per supported list size (2..8) using sorting networks
 * encoded entirely as min/max calls (e.g. the 9-comparator Bose-Nelson
 * network for N=5, where v2 holds the median).
 */
export const GPU_MEDIAN_PREAMBLE_GLSL = `
float _gpu_median_2(float a, float b) {
  return (a + b) * 0.5;
}
float _gpu_median_3(float a, float b, float c) {
  return max(min(a, b), min(max(a, b), c));
}
float _gpu_median_4(float a, float b, float c, float d) {
  float lo = max(min(a, b), min(c, d));
  float hi = min(max(a, b), max(c, d));
  return (lo + hi) * 0.5;
}
float _gpu_median_5(float a, float b, float c, float d, float e) {
  float t; float v0=a,v1=b,v2=c,v3=d,v4=e;
  t=min(v0,v1); v1=max(v0,v1); v0=t;
  t=min(v3,v4); v4=max(v3,v4); v3=t;
  t=min(v2,v4); v4=max(v2,v4); v2=t;
  t=min(v2,v3); v3=max(v2,v3); v2=t;
  t=min(v0,v3); v3=max(v0,v3); v0=t;
  t=min(v0,v2); v2=max(v0,v2); v0=t;
  t=min(v1,v4); v4=max(v1,v4); v1=t;
  t=min(v1,v3); v3=max(v1,v3); v1=t;
  t=min(v1,v2); v2=max(v1,v2); v1=t;
  return v2;
}
float _gpu_median_6(float a, float b, float c, float d, float e, float f) {
  float t; float v0=a,v1=b,v2=c,v3=d,v4=e,v5=f;
  t=min(v0,v1); v1=max(v0,v1); v0=t;
  t=min(v2,v3); v3=max(v2,v3); v2=t;
  t=min(v4,v5); v5=max(v4,v5); v4=t;
  t=min(v0,v2); v2=max(v0,v2); v0=t;
  t=min(v1,v3); v3=max(v1,v3); v1=t;
  t=min(v0,v4); v4=max(v0,v4); v0=t;
  t=min(v1,v5); v5=max(v1,v5); v1=t;
  t=min(v2,v4); v4=max(v2,v4); v2=t;
  t=min(v1,v2); v2=max(v1,v2); v1=t;
  t=min(v3,v5); v5=max(v3,v5); v3=t;
  t=min(v3,v4); v4=max(v3,v4); v3=t;
  return (v2 + v3) * 0.5;
}
float _gpu_median_7(float a, float b, float c, float d, float e, float f, float g) {
  float t; float v0=a,v1=b,v2=c,v3=d,v4=e,v5=f,v6=g;
  t=min(v0,v1); v1=max(v0,v1); v0=t;
  t=min(v2,v3); v3=max(v2,v3); v2=t;
  t=min(v4,v5); v5=max(v4,v5); v4=t;
  t=min(v0,v2); v2=max(v0,v2); v0=t;
  t=min(v1,v3); v3=max(v1,v3); v1=t;
  t=min(v4,v6); v6=max(v4,v6); v4=t;
  t=min(v0,v4); v4=max(v0,v4); v0=t;
  t=min(v1,v5); v5=max(v1,v5); v1=t;
  t=min(v2,v6); v6=max(v2,v6); v2=t;
  t=min(v1,v2); v2=max(v1,v2); v1=t;
  t=min(v3,v5); v5=max(v3,v5); v3=t;
  t=min(v2,v4); v4=max(v2,v4); v2=t;
  t=min(v3,v4); v4=max(v3,v4); v3=t;
  return v3;
}
float _gpu_median_8(float a, float b, float c, float d, float e, float f, float g, float h) {
  float t; float v0=a,v1=b,v2=c,v3=d,v4=e,v5=f,v6=g,v7=h;
  t=min(v0,v1); v1=max(v0,v1); v0=t;
  t=min(v2,v3); v3=max(v2,v3); v2=t;
  t=min(v4,v5); v5=max(v4,v5); v4=t;
  t=min(v6,v7); v7=max(v6,v7); v6=t;
  t=min(v0,v2); v2=max(v0,v2); v0=t;
  t=min(v1,v3); v3=max(v1,v3); v1=t;
  t=min(v4,v6); v6=max(v4,v6); v4=t;
  t=min(v5,v7); v7=max(v5,v7); v5=t;
  t=min(v0,v4); v4=max(v0,v4); v0=t;
  t=min(v1,v5); v5=max(v1,v5); v1=t;
  t=min(v2,v6); v6=max(v2,v6); v2=t;
  t=min(v3,v7); v7=max(v3,v7); v3=t;
  t=min(v1,v2); v2=max(v1,v2); v1=t;
  t=min(v3,v4); v4=max(v3,v4); v3=t;
  t=min(v5,v6); v6=max(v5,v6); v5=t;
  t=min(v3,v5); v5=max(v3,v5); v3=t;
  t=min(v2,v4); v4=max(v2,v4); v2=t;
  t=min(v3,v4); v4=max(v3,v4); v3=t;
  return (v3 + v4) * 0.5;
}
`;

/**
 * GPU Median preamble (WGSL syntax).
 *
 * Same sorting-network logic as the GLSL version with WGSL syntax.
 */
export const GPU_MEDIAN_PREAMBLE_WGSL = `
fn _gpu_median_2(a: f32, b: f32) -> f32 {
  return (a + b) * 0.5;
}
fn _gpu_median_3(a: f32, b: f32, c: f32) -> f32 {
  return max(min(a, b), min(max(a, b), c));
}
fn _gpu_median_4(a: f32, b: f32, c: f32, d: f32) -> f32 {
  let lo = max(min(a, b), min(c, d));
  let hi = min(max(a, b), max(c, d));
  return (lo + hi) * 0.5;
}
fn _gpu_median_5(a: f32, b: f32, c: f32, d: f32, e: f32) -> f32 {
  var v0=a; var v1=b; var v2=c; var v3=d; var v4=e; var t: f32;
  t=min(v0,v1); v1=max(v0,v1); v0=t;
  t=min(v3,v4); v4=max(v3,v4); v3=t;
  t=min(v2,v4); v4=max(v2,v4); v2=t;
  t=min(v2,v3); v3=max(v2,v3); v2=t;
  t=min(v0,v3); v3=max(v0,v3); v0=t;
  t=min(v0,v2); v2=max(v0,v2); v0=t;
  t=min(v1,v4); v4=max(v1,v4); v1=t;
  t=min(v1,v3); v3=max(v1,v3); v1=t;
  t=min(v1,v2); v2=max(v1,v2); v1=t;
  return v2;
}
fn _gpu_median_6(a: f32, b: f32, c: f32, d: f32, e: f32, f: f32) -> f32 {
  var v0=a; var v1=b; var v2=c; var v3=d; var v4=e; var v5=f; var t: f32;
  t=min(v0,v1); v1=max(v0,v1); v0=t;
  t=min(v2,v3); v3=max(v2,v3); v2=t;
  t=min(v4,v5); v5=max(v4,v5); v4=t;
  t=min(v0,v2); v2=max(v0,v2); v0=t;
  t=min(v1,v3); v3=max(v1,v3); v1=t;
  t=min(v0,v4); v4=max(v0,v4); v0=t;
  t=min(v1,v5); v5=max(v1,v5); v1=t;
  t=min(v2,v4); v4=max(v2,v4); v2=t;
  t=min(v1,v2); v2=max(v1,v2); v1=t;
  t=min(v3,v5); v5=max(v3,v5); v3=t;
  t=min(v3,v4); v4=max(v3,v4); v3=t;
  return (v2 + v3) * 0.5;
}
fn _gpu_median_7(a: f32, b: f32, c: f32, d: f32, e: f32, f: f32, g: f32) -> f32 {
  var v0=a; var v1=b; var v2=c; var v3=d; var v4=e; var v5=f; var v6=g; var t: f32;
  t=min(v0,v1); v1=max(v0,v1); v0=t;
  t=min(v2,v3); v3=max(v2,v3); v2=t;
  t=min(v4,v5); v5=max(v4,v5); v4=t;
  t=min(v0,v2); v2=max(v0,v2); v0=t;
  t=min(v1,v3); v3=max(v1,v3); v1=t;
  t=min(v4,v6); v6=max(v4,v6); v4=t;
  t=min(v0,v4); v4=max(v0,v4); v0=t;
  t=min(v1,v5); v5=max(v1,v5); v1=t;
  t=min(v2,v6); v6=max(v2,v6); v2=t;
  t=min(v1,v2); v2=max(v1,v2); v1=t;
  t=min(v3,v5); v5=max(v3,v5); v3=t;
  t=min(v2,v4); v4=max(v2,v4); v2=t;
  t=min(v3,v4); v4=max(v3,v4); v3=t;
  return v3;
}
fn _gpu_median_8(a: f32, b: f32, c: f32, d: f32, e: f32, f: f32, g: f32, h: f32) -> f32 {
  var v0=a; var v1=b; var v2=c; var v3=d; var v4=e; var v5=f; var v6=g; var v7=h; var t: f32;
  t=min(v0,v1); v1=max(v0,v1); v0=t;
  t=min(v2,v3); v3=max(v2,v3); v2=t;
  t=min(v4,v5); v5=max(v4,v5); v4=t;
  t=min(v6,v7); v7=max(v6,v7); v6=t;
  t=min(v0,v2); v2=max(v0,v2); v0=t;
  t=min(v1,v3); v3=max(v1,v3); v1=t;
  t=min(v4,v6); v6=max(v4,v6); v4=t;
  t=min(v5,v7); v7=max(v5,v7); v5=t;
  t=min(v0,v4); v4=max(v0,v4); v0=t;
  t=min(v1,v5); v5=max(v1,v5); v1=t;
  t=min(v2,v6); v6=max(v2,v6); v2=t;
  t=min(v3,v7); v7=max(v3,v7); v3=t;
  t=min(v1,v2); v2=max(v1,v2); v1=t;
  t=min(v3,v4); v4=max(v3,v4); v3=t;
  t=min(v5,v6); v6=max(v5,v6); v5=t;
  t=min(v3,v5); v5=max(v3,v5); v3=t;
  t=min(v2,v4); v4=max(v2,v4); v2=t;
  t=min(v3,v4); v4=max(v3,v4); v3=t;
  return (v3 + v4) * 0.5;
}
`;

// ─── Color preamble ────────────────────────────────────────────────────────────

/**
 * GPU color space conversion preamble (GLSL syntax).
 *
 * Canonical color value: vec3 OKLCh `(L, C, H_deg)` — same convention as the
 * interpreted/JS-runtime layer. Shaders that write to a sRGB framebuffer must
 * wrap the final color in `_gpu_oklch_to_srgb()` at the boundary.
 *
 * Hue is in degrees throughout (matching the boxed-expression convention);
 * HSL/HSV saturation, lightness and value are in 0-1.
 * `_gpu_color_mix` interpolates directly in OKLCh — no sRGB pinch — and
 * special-cases achromatic endpoints (C ≈ 0) so e.g. mixing red with white
 * preserves red's hue rather than drifting through arbitrary hues.
 *
 * WGSL targets must adapt syntax (vec3f, atan2→atan2, etc.).
 */
export const GPU_COLOR_PREAMBLE_GLSL = `
float _gpu_srgb_to_linear(float c) {
  if (c <= 0.04045) return c / 12.92;
  return pow((c + 0.055) / 1.055, 2.4);
}

float _gpu_linear_to_srgb(float c) {
  if (c <= 0.0031308) return 12.92 * c;
  return 1.055 * pow(c, 1.0 / 2.4) - 0.055;
}

vec3 _gpu_srgb_to_oklab(vec3 rgb) {
  float r = _gpu_srgb_to_linear(rgb.x);
  float g = _gpu_srgb_to_linear(rgb.y);
  float b = _gpu_srgb_to_linear(rgb.z);
  float l_ = pow(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b, 1.0 / 3.0);
  float m_ = pow(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b, 1.0 / 3.0);
  float s_ = pow(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b, 1.0 / 3.0);
  return vec3(
    0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_,
    1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_,
    0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_
  );
}

vec3 _gpu_oklab_to_srgb(vec3 lab) {
  float l_ = lab.x + 0.3963377774 * lab.y + 0.2158037573 * lab.z;
  float m_ = lab.x - 0.1055613458 * lab.y - 0.0638541728 * lab.z;
  float s_ = lab.x - 0.0894841775 * lab.y - 1.291485548 * lab.z;
  float l = l_ * l_ * l_;
  float m = m_ * m_ * m_;
  float s = s_ * s_ * s_;
  float r = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  float g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  float b = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;
  return clamp(vec3(_gpu_linear_to_srgb(r), _gpu_linear_to_srgb(g), _gpu_linear_to_srgb(b)), 0.0, 1.0);
}

vec3 _gpu_oklab_to_oklch(vec3 lab) {
  float C = length(lab.yz);
  float H = atan(lab.z, lab.y) * (180.0 / 3.14159265359);
  if (H < 0.0) H += 360.0;
  return vec3(lab.x, C, H);
}

vec3 _gpu_oklch_to_oklab(vec3 lch) {
  float h_rad = lch.z * (3.14159265359 / 180.0);
  return vec3(lch.x, lch.y * cos(h_rad), lch.y * sin(h_rad));
}

vec3 _gpu_srgb_to_oklch(vec3 rgb) {
  return _gpu_oklab_to_oklch(_gpu_srgb_to_oklab(rgb));
}

vec3 _gpu_oklch_to_srgb(vec3 lch) {
  return _gpu_oklab_to_srgb(_gpu_oklch_to_oklab(lch));
}

vec3 _gpu_hsl_to_rgb(vec3 hsl) {
  float h = hsl.x;
  float s = hsl.y;
  float l = hsl.z;
  float c = (1.0 - abs(2.0 * l - 1.0)) * s;
  float h6 = h / 60.0;
  float x = c * (1.0 - abs(mod(h6, 2.0) - 1.0));
  float r = 0.0;
  float g = 0.0;
  float b = 0.0;
  if (h6 < 1.0)      { r = c; g = x; b = 0.0; }
  else if (h6 < 2.0) { r = x; g = c; b = 0.0; }
  else if (h6 < 3.0) { r = 0.0; g = c; b = x; }
  else if (h6 < 4.0) { r = 0.0; g = x; b = c; }
  else if (h6 < 5.0) { r = x; g = 0.0; b = c; }
  else               { r = c; g = 0.0; b = x; }
  float m = l - c / 2.0;
  return vec3(r + m, g + m, b + m);
}

vec3 _gpu_rgb_to_hsl(vec3 rgb) {
  float maxc = max(max(rgb.x, rgb.y), rgb.z);
  float minc = min(min(rgb.x, rgb.y), rgb.z);
  float l = (maxc + minc) / 2.0;
  float d = maxc - minc;
  if (d < 1e-6) return vec3(0.0, 0.0, l);
  float s = d / (1.0 - abs(2.0 * l - 1.0));
  float h;
  if (maxc == rgb.x)      h = mod((rgb.y - rgb.z) / d, 6.0);
  else if (maxc == rgb.y) h = (rgb.z - rgb.x) / d + 2.0;
  else                    h = (rgb.x - rgb.y) / d + 4.0;
  h *= 60.0;
  if (h < 0.0) h += 360.0;
  return vec3(h, s, l);
}

vec3 _gpu_hsv_to_rgb(vec3 hsv) {
  float h = hsv.x;
  float s = hsv.y;
  float v = hsv.z;
  float c = v * s;
  float h6 = h / 60.0;
  float x = c * (1.0 - abs(mod(h6, 2.0) - 1.0));
  float r = 0.0;
  float g = 0.0;
  float b = 0.0;
  if (h6 < 1.0)      { r = c; g = x; b = 0.0; }
  else if (h6 < 2.0) { r = x; g = c; b = 0.0; }
  else if (h6 < 3.0) { r = 0.0; g = c; b = x; }
  else if (h6 < 4.0) { r = 0.0; g = x; b = c; }
  else if (h6 < 5.0) { r = x; g = 0.0; b = c; }
  else               { r = c; g = 0.0; b = x; }
  float m = v - c;
  return vec3(r + m, g + m, b + m);
}

vec3 _gpu_rgb_to_hsv(vec3 rgb) {
  float maxc = max(max(rgb.x, rgb.y), rgb.z);
  float minc = min(min(rgb.x, rgb.y), rgb.z);
  float v = maxc;
  float d = maxc - minc;
  if (d < 1e-6) return vec3(0.0, 0.0, v);
  float s = (maxc < 1e-6) ? 0.0 : d / maxc;
  float h;
  if (maxc == rgb.x)      h = mod((rgb.y - rgb.z) / d, 6.0);
  else if (maxc == rgb.y) h = (rgb.z - rgb.x) / d + 2.0;
  else                    h = (rgb.x - rgb.y) / d + 4.0;
  h *= 60.0;
  if (h < 0.0) h += 360.0;
  return vec3(h, s, v);
}

vec3 _gpu_color_mix(vec3 lch1, vec3 lch2, float t) {
  float L = mix(lch1.x, lch2.x, t);
  float C = mix(lch1.y, lch2.y, t);
  bool a1 = lch1.y < 1e-6;
  bool a2 = lch2.y < 1e-6;
  float H;
  if (a1 && a2) {
    H = lch1.z;
  } else if (a1) {
    H = lch2.z;
  } else if (a2) {
    H = lch1.z;
  } else {
    float dh = lch2.z - lch1.z;
    if (dh > 180.0) dh -= 360.0;
    if (dh < -180.0) dh += 360.0;
    H = lch1.z + dh * t;
    if (H < 0.0) H += 360.0;
    if (H >= 360.0) H -= 360.0;
  }
  return vec3(L, C, H);
}

float _gpu_apca(vec3 lch_bg, vec3 lch_fg) {
  vec3 bg = _gpu_oklch_to_srgb(lch_bg);
  vec3 fg = _gpu_oklch_to_srgb(lch_fg);
  float bgR = _gpu_srgb_to_linear(bg.x);
  float bgG = _gpu_srgb_to_linear(bg.y);
  float bgB = _gpu_srgb_to_linear(bg.z);
  float fgR = _gpu_srgb_to_linear(fg.x);
  float fgG = _gpu_srgb_to_linear(fg.y);
  float fgB = _gpu_srgb_to_linear(fg.z);
  float bgY = 0.2126729 * bgR + 0.7151522 * bgG + 0.0721750 * bgB;
  float fgY = 0.2126729 * fgR + 0.7151522 * fgG + 0.0721750 * fgB;
  float bgC = pow(bgY, 0.56);
  float fgC = pow(fgY, 0.57);
  float contrast = (bgC - fgC) * 1.14;
  return contrast * 100.0;
}
`;

/**
 * GPU color space conversion preamble (WGSL syntax).
 *
 * Same convention as the GLSL preamble: canonical color value is `vec3f`
 * OKLCh `(L, C, H_deg)`. Shaders writing to a sRGB framebuffer must wrap
 * their final color in `_gpu_oklch_to_srgb()`.
 */
export const GPU_COLOR_PREAMBLE_WGSL = `
fn _gpu_srgb_to_linear(c: f32) -> f32 {
  if (c <= 0.04045) { return c / 12.92; }
  return pow((c + 0.055) / 1.055, 2.4);
}

fn _gpu_linear_to_srgb(c: f32) -> f32 {
  if (c <= 0.0031308) { return 12.92 * c; }
  return 1.055 * pow(c, 1.0 / 2.4) - 0.055;
}

fn _gpu_srgb_to_oklab(rgb: vec3f) -> vec3f {
  let r = _gpu_srgb_to_linear(rgb.x);
  let g = _gpu_srgb_to_linear(rgb.y);
  let b = _gpu_srgb_to_linear(rgb.z);
  let l_ = pow(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b, 1.0 / 3.0);
  let m_ = pow(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b, 1.0 / 3.0);
  let s_ = pow(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b, 1.0 / 3.0);
  return vec3f(
    0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_,
    1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_,
    0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_
  );
}

fn _gpu_oklab_to_srgb(lab: vec3f) -> vec3f {
  let l_ = lab.x + 0.3963377774 * lab.y + 0.2158037573 * lab.z;
  let m_ = lab.x - 0.1055613458 * lab.y - 0.0638541728 * lab.z;
  let s_ = lab.x - 0.0894841775 * lab.y - 1.291485548 * lab.z;
  let l = l_ * l_ * l_;
  let m = m_ * m_ * m_;
  let s = s_ * s_ * s_;
  let r = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  let g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  let b = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;
  return clamp(vec3f(_gpu_linear_to_srgb(r), _gpu_linear_to_srgb(g), _gpu_linear_to_srgb(b)), vec3f(0.0), vec3f(1.0));
}

fn _gpu_oklab_to_oklch(lab: vec3f) -> vec3f {
  let C = length(lab.yz);
  var H = atan2(lab.z, lab.y) * (180.0 / 3.14159265359);
  if (H < 0.0) { H = H + 360.0; }
  return vec3f(lab.x, C, H);
}

fn _gpu_oklch_to_oklab(lch: vec3f) -> vec3f {
  let h_rad = lch.z * (3.14159265359 / 180.0);
  return vec3f(lch.x, lch.y * cos(h_rad), lch.y * sin(h_rad));
}

fn _gpu_srgb_to_oklch(rgb: vec3f) -> vec3f {
  return _gpu_oklab_to_oklch(_gpu_srgb_to_oklab(rgb));
}

fn _gpu_oklch_to_srgb(lch: vec3f) -> vec3f {
  return _gpu_oklab_to_srgb(_gpu_oklch_to_oklab(lch));
}

fn _gpu_hsl_to_rgb(hsl: vec3f) -> vec3f {
  let h = hsl.x;
  let s = hsl.y;
  let l = hsl.z;
  let c = (1.0 - abs(2.0 * l - 1.0)) * s;
  let h6 = h / 60.0;
  let x = c * (1.0 - abs((h6 - 2.0 * floor(h6 / 2.0)) - 1.0));
  var r: f32 = 0.0;
  var g: f32 = 0.0;
  var b: f32 = 0.0;
  if (h6 < 1.0)      { r = c; g = x; b = 0.0; }
  else if (h6 < 2.0) { r = x; g = c; b = 0.0; }
  else if (h6 < 3.0) { r = 0.0; g = c; b = x; }
  else if (h6 < 4.0) { r = 0.0; g = x; b = c; }
  else if (h6 < 5.0) { r = x; g = 0.0; b = c; }
  else               { r = c; g = 0.0; b = x; }
  let m = l - c / 2.0;
  return vec3f(r + m, g + m, b + m);
}

fn _gpu_rgb_to_hsl(rgb: vec3f) -> vec3f {
  let maxc = max(max(rgb.x, rgb.y), rgb.z);
  let minc = min(min(rgb.x, rgb.y), rgb.z);
  let l = (maxc + minc) / 2.0;
  let d = maxc - minc;
  if (d < 1e-6) { return vec3f(0.0, 0.0, l); }
  let s = d / (1.0 - abs(2.0 * l - 1.0));
  var h: f32;
  if (maxc == rgb.x) {
    let v = (rgb.y - rgb.z) / d;
    h = v - 6.0 * floor(v / 6.0);
  } else if (maxc == rgb.y) {
    h = (rgb.z - rgb.x) / d + 2.0;
  } else {
    h = (rgb.x - rgb.y) / d + 4.0;
  }
  h = h * 60.0;
  if (h < 0.0) { h = h + 360.0; }
  return vec3f(h, s, l);
}

fn _gpu_hsv_to_rgb(hsv: vec3f) -> vec3f {
  let h = hsv.x;
  let s = hsv.y;
  let v = hsv.z;
  let c = v * s;
  let h6 = h / 60.0;
  let x = c * (1.0 - abs((h6 - 2.0 * floor(h6 / 2.0)) - 1.0));
  var r: f32 = 0.0;
  var g: f32 = 0.0;
  var b: f32 = 0.0;
  if (h6 < 1.0)      { r = c; g = x; b = 0.0; }
  else if (h6 < 2.0) { r = x; g = c; b = 0.0; }
  else if (h6 < 3.0) { r = 0.0; g = c; b = x; }
  else if (h6 < 4.0) { r = 0.0; g = x; b = c; }
  else if (h6 < 5.0) { r = x; g = 0.0; b = c; }
  else               { r = c; g = 0.0; b = x; }
  let m = v - c;
  return vec3f(r + m, g + m, b + m);
}

fn _gpu_rgb_to_hsv(rgb: vec3f) -> vec3f {
  let maxc = max(max(rgb.x, rgb.y), rgb.z);
  let minc = min(min(rgb.x, rgb.y), rgb.z);
  let v = maxc;
  let d = maxc - minc;
  if (d < 1e-6) { return vec3f(0.0, 0.0, v); }
  var s: f32 = 0.0;
  if (maxc >= 1e-6) { s = d / maxc; }
  var h: f32;
  if (maxc == rgb.x) {
    let q = (rgb.y - rgb.z) / d;
    h = q - 6.0 * floor(q / 6.0);
  } else if (maxc == rgb.y) {
    h = (rgb.z - rgb.x) / d + 2.0;
  } else {
    h = (rgb.x - rgb.y) / d + 4.0;
  }
  h = h * 60.0;
  if (h < 0.0) { h = h + 360.0; }
  return vec3f(h, s, v);
}

fn _gpu_color_mix(lch1: vec3f, lch2: vec3f, t: f32) -> vec3f {
  let L = mix(lch1.x, lch2.x, t);
  let C = mix(lch1.y, lch2.y, t);
  let a1 = lch1.y < 1e-6;
  let a2 = lch2.y < 1e-6;
  var H: f32;
  if (a1 && a2) {
    H = lch1.z;
  } else if (a1) {
    H = lch2.z;
  } else if (a2) {
    H = lch1.z;
  } else {
    var dh = lch2.z - lch1.z;
    if (dh > 180.0) { dh = dh - 360.0; }
    if (dh < -180.0) { dh = dh + 360.0; }
    H = lch1.z + dh * t;
    if (H < 0.0) { H = H + 360.0; }
    if (H >= 360.0) { H = H - 360.0; }
  }
  return vec3f(L, C, H);
}

fn _gpu_apca(lch_bg: vec3f, lch_fg: vec3f) -> f32 {
  let bg = _gpu_oklch_to_srgb(lch_bg);
  let fg = _gpu_oklch_to_srgb(lch_fg);
  let bgR = _gpu_srgb_to_linear(bg.x);
  let bgG = _gpu_srgb_to_linear(bg.y);
  let bgB = _gpu_srgb_to_linear(bg.z);
  let fgR = _gpu_srgb_to_linear(fg.x);
  let fgG = _gpu_srgb_to_linear(fg.y);
  let fgB = _gpu_srgb_to_linear(fg.z);
  let bgY = 0.2126729 * bgR + 0.7151522 * bgG + 0.0721750 * bgB;
  let fgY = 0.2126729 * fgR + 0.7151522 * fgG + 0.0721750 * fgB;
  let bgC = pow(bgY, 0.56);
  let fgC = pow(fgY, 0.57);
  let contrast = (bgC - fgC) * 1.14;
  return contrast * 100.0;
}
`;

/**
 * Per-function complex arithmetic definitions with dependency metadata.
 *
 * Each entry maps a helper function name to its GLSL source, WGSL source,
 * and the list of other helper functions it calls. The preamble builder
 * uses this to emit only the functions actually referenced by compiled code,
 * in topological (dependency) order.
 *
 * Addition, subtraction, negation, and scalar multiplication use native
 * vec2 operators and do not need helper functions.
 */
interface ComplexFunctionDef {
  glsl: string;
  wgsl: string;
  deps: string[];
}

const GPU_COMPLEX_FUNCTIONS: Record<string, ComplexFunctionDef> = {
  _gpu_cmul: {
    deps: [],
    glsl: `vec2 _gpu_cmul(vec2 a, vec2 b) {
  return vec2(a.x * b.x - a.y * b.y, a.x * b.y + a.y * b.x);
}`,
    wgsl: `fn _gpu_cmul(a: vec2f, b: vec2f) -> vec2f {
  return vec2f(a.x * b.x - a.y * b.y, a.x * b.y + a.y * b.x);
}`,
  },
  _gpu_cdiv: {
    deps: [],
    glsl: `vec2 _gpu_cdiv(vec2 a, vec2 b) {
  float d = b.x * b.x + b.y * b.y;
  return vec2((a.x * b.x + a.y * b.y) / d, (a.y * b.x - a.x * b.y) / d);
}`,
    wgsl: `fn _gpu_cdiv(a: vec2f, b: vec2f) -> vec2f {
  let d = b.x * b.x + b.y * b.y;
  return vec2f((a.x * b.x + a.y * b.y) / d, (a.y * b.x - a.x * b.y) / d);
}`,
  },
  _gpu_cexp: {
    deps: [],
    glsl: `vec2 _gpu_cexp(vec2 z) {
  float e = exp(z.x);
  return vec2(e * cos(z.y), e * sin(z.y));
}`,
    wgsl: `fn _gpu_cexp(z: vec2f) -> vec2f {
  let e = exp(z.x);
  return vec2f(e * cos(z.y), e * sin(z.y));
}`,
  },
  _gpu_cln: {
    deps: [],
    glsl: `vec2 _gpu_cln(vec2 z) {
  return vec2(log(length(z)), atan(z.y, z.x));
}`,
    wgsl: `fn _gpu_cln(z: vec2f) -> vec2f {
  return vec2f(log(length(z)), atan2(z.y, z.x));
}`,
  },
  _gpu_cpow: {
    deps: ['_gpu_cexp', '_gpu_cmul', '_gpu_cln'],
    glsl: `vec2 _gpu_cpow(vec2 z, vec2 w) {
  return _gpu_cexp(_gpu_cmul(w, _gpu_cln(z)));
}`,
    wgsl: `fn _gpu_cpow(z: vec2f, w: vec2f) -> vec2f {
  return _gpu_cexp(_gpu_cmul(w, _gpu_cln(z)));
}`,
  },
  _gpu_csqrt: {
    deps: [],
    glsl: `vec2 _gpu_csqrt(vec2 z) {
  float r = length(z);
  float theta = atan(z.y, z.x);
  return sqrt(r) * vec2(cos(theta * 0.5), sin(theta * 0.5));
}`,
    wgsl: `fn _gpu_csqrt(z: vec2f) -> vec2f {
  let r = length(z);
  let theta = atan2(z.y, z.x);
  return sqrt(r) * vec2f(cos(theta * 0.5), sin(theta * 0.5));
}`,
  },
  _gpu_csin: {
    deps: [],
    glsl: `vec2 _gpu_csin(vec2 z) {
  return vec2(sin(z.x) * cosh(z.y), cos(z.x) * sinh(z.y));
}`,
    wgsl: `fn _gpu_csin(z: vec2f) -> vec2f {
  return vec2f(sin(z.x) * cosh(z.y), cos(z.x) * sinh(z.y));
}`,
  },
  _gpu_ccos: {
    deps: [],
    glsl: `vec2 _gpu_ccos(vec2 z) {
  return vec2(cos(z.x) * cosh(z.y), -sin(z.x) * sinh(z.y));
}`,
    wgsl: `fn _gpu_ccos(z: vec2f) -> vec2f {
  return vec2f(cos(z.x) * cosh(z.y), -sin(z.x) * sinh(z.y));
}`,
  },
  _gpu_ctan: {
    deps: ['_gpu_cdiv', '_gpu_csin', '_gpu_ccos'],
    glsl: `vec2 _gpu_ctan(vec2 z) {
  return _gpu_cdiv(_gpu_csin(z), _gpu_ccos(z));
}`,
    wgsl: `fn _gpu_ctan(z: vec2f) -> vec2f {
  return _gpu_cdiv(_gpu_csin(z), _gpu_ccos(z));
}`,
  },
  _gpu_csinh: {
    deps: [],
    glsl: `vec2 _gpu_csinh(vec2 z) {
  return vec2(sinh(z.x) * cos(z.y), cosh(z.x) * sin(z.y));
}`,
    wgsl: `fn _gpu_csinh(z: vec2f) -> vec2f {
  return vec2f(sinh(z.x) * cos(z.y), cosh(z.x) * sin(z.y));
}`,
  },
  _gpu_ccosh: {
    deps: [],
    glsl: `vec2 _gpu_ccosh(vec2 z) {
  return vec2(cosh(z.x) * cos(z.y), sinh(z.x) * sin(z.y));
}`,
    wgsl: `fn _gpu_ccosh(z: vec2f) -> vec2f {
  return vec2f(cosh(z.x) * cos(z.y), sinh(z.x) * sin(z.y));
}`,
  },
  _gpu_ctanh: {
    deps: ['_gpu_cdiv', '_gpu_csinh', '_gpu_ccosh'],
    glsl: `vec2 _gpu_ctanh(vec2 z) {
  return _gpu_cdiv(_gpu_csinh(z), _gpu_ccosh(z));
}`,
    wgsl: `fn _gpu_ctanh(z: vec2f) -> vec2f {
  return _gpu_cdiv(_gpu_csinh(z), _gpu_ccosh(z));
}`,
  },
  _gpu_casin: {
    deps: ['_gpu_csqrt', '_gpu_cln'],
    glsl: `vec2 _gpu_casin(vec2 z) {
  vec2 iz = vec2(-z.y, z.x);
  vec2 s = _gpu_csqrt(vec2(1.0 - z.x * z.x + z.y * z.y, -2.0 * z.x * z.y));
  vec2 l = _gpu_cln(iz + s);
  return vec2(l.y, -l.x);
}`,
    wgsl: `fn _gpu_casin(z: vec2f) -> vec2f {
  let iz = vec2f(-z.y, z.x);
  let s = _gpu_csqrt(vec2f(1.0 - z.x * z.x + z.y * z.y, -2.0 * z.x * z.y));
  let l = _gpu_cln(iz + s);
  return vec2f(l.y, -l.x);
}`,
  },
  _gpu_cacos: {
    deps: ['_gpu_casin'],
    glsl: `vec2 _gpu_cacos(vec2 z) {
  vec2 s = _gpu_casin(z);
  return vec2(1.5707963268 - s.x, -s.y);
}`,
    wgsl: `fn _gpu_cacos(z: vec2f) -> vec2f {
  let s = _gpu_casin(z);
  return vec2f(1.5707963268 - s.x, -s.y);
}`,
  },
  _gpu_catan: {
    deps: ['_gpu_cln'],
    glsl: `vec2 _gpu_catan(vec2 z) {
  vec2 iz = vec2(-z.y, z.x);
  vec2 a = _gpu_cln(vec2(1.0 - iz.x, -iz.y));
  vec2 b = _gpu_cln(vec2(1.0 + iz.x, iz.y));
  vec2 d = vec2(a.x - b.x, a.y - b.y);
  return vec2(-0.5 * d.y, 0.5 * d.x);
}`,
    wgsl: `fn _gpu_catan(z: vec2f) -> vec2f {
  let iz = vec2f(-z.y, z.x);
  let a = _gpu_cln(vec2f(1.0 - iz.x, -iz.y));
  let b = _gpu_cln(vec2f(1.0 + iz.x, iz.y));
  let d = vec2f(a.x - b.x, a.y - b.y);
  return vec2f(-0.5 * d.y, 0.5 * d.x);
}`,
  },
  _gpu_casinh: {
    deps: ['_gpu_csqrt', '_gpu_cln'],
    glsl: `vec2 _gpu_casinh(vec2 z) {
  vec2 z2 = vec2(z.x * z.x - z.y * z.y, 2.0 * z.x * z.y);
  vec2 s = _gpu_csqrt(vec2(1.0 + z2.x, z2.y));
  return _gpu_cln(z + s);
}`,
    wgsl: `fn _gpu_casinh(z: vec2f) -> vec2f {
  let z2 = vec2f(z.x * z.x - z.y * z.y, 2.0 * z.x * z.y);
  let s = _gpu_csqrt(vec2f(1.0 + z2.x, z2.y));
  return _gpu_cln(z + s);
}`,
  },
  _gpu_cacosh: {
    deps: ['_gpu_csqrt', '_gpu_cln'],
    glsl: `vec2 _gpu_cacosh(vec2 z) {
  vec2 z2 = vec2(z.x * z.x - z.y * z.y, 2.0 * z.x * z.y);
  vec2 s = _gpu_csqrt(vec2(z2.x - 1.0, z2.y));
  return _gpu_cln(z + s);
}`,
    wgsl: `fn _gpu_cacosh(z: vec2f) -> vec2f {
  let z2 = vec2f(z.x * z.x - z.y * z.y, 2.0 * z.x * z.y);
  let s = _gpu_csqrt(vec2f(z2.x - 1.0, z2.y));
  return _gpu_cln(z + s);
}`,
  },
  _gpu_catanh: {
    deps: ['_gpu_cln'],
    glsl: `vec2 _gpu_catanh(vec2 z) {
  vec2 a = _gpu_cln(vec2(1.0 + z.x, z.y));
  vec2 b = _gpu_cln(vec2(1.0 - z.x, -z.y));
  return vec2(0.5 * (a.x - b.x), 0.5 * (a.y - b.y));
}`,
    wgsl: `fn _gpu_catanh(z: vec2f) -> vec2f {
  let a = _gpu_cln(vec2f(1.0 + z.x, z.y));
  let b = _gpu_cln(vec2f(1.0 - z.x, -z.y));
  return vec2f(0.5 * (a.x - b.x), 0.5 * (a.y - b.y));
}`,
  },
};

/**
 * Build a minimal complex preamble containing only the helper functions
 * actually referenced by `code`, plus their transitive dependencies,
 * emitted in topological (dependency-first) order.
 */
function buildComplexPreamble(code: string, language: string): string {
  // 1. Find all _gpu_c* calls in the compiled code
  const needed = new Set<string>();
  for (const name of Object.keys(GPU_COMPLEX_FUNCTIONS)) {
    if (code.includes(name)) needed.add(name);
  }
  if (needed.size === 0) return '';

  // 2. Resolve transitive dependencies
  const resolved = new Set<string>();
  function resolve(name: string): void {
    if (resolved.has(name)) return;
    const def = GPU_COMPLEX_FUNCTIONS[name];
    if (!def) return;
    for (const dep of def.deps) resolve(dep);
    resolved.add(name);
  }
  for (const name of needed) resolve(name);

  // 3. `resolved` is already in topological order (deps before dependents)
  const lang = language === 'wgsl' ? 'wgsl' : 'glsl';
  const parts: string[] = [];
  for (const name of resolved) {
    parts.push(GPU_COMPLEX_FUNCTIONS[name][lang]);
  }
  return '\n' + parts.join('\n\n') + '\n';
}

/**
 * GLSL NaN helper preamble. Centralizes the masked/else-branch NaN (`When` /
 * `Which` fall-through) into a single overridable symbol.
 *
 * GLSL has no `NaN` literal. The target assumes GLSL ES 3.00 (`#version
 * 300 es`), where `intBitsToFloat(0x7FC00000)` yields a guaranteed NaN bit
 * pattern. Routing every masked NaN through one helper lets a host redefine
 * what a masked branch produces (e.g. a sentinel value) without touching the
 * generated code. The current body is pinned by `compile-glsl.test.ts`.
 */
const GPU_NAN_PREAMBLE_GLSL = `
float _gpu_nan() {
  return intBitsToFloat(0x7FC00000);
}
`;

/**
 * GLSL infinity helper preamble — the `+∞` counterpart of
 * `GPU_NAN_PREAMBLE_GLSL`, structured identically so a host can redefine it in
 * the same way.
 *
 * `intBitsToFloat(0x7F800000)` is the IEEE-754 `+∞` bit pattern (same
 * GLSL ES 3.00 builtin the NaN helper uses, so no extra version requirement).
 * Deliberately NOT `1.0 / 0.0`: fast-math is licensed to fold a division by a
 * constant zero, and this project has already been bitten by ANGLE→Metal
 * fast-math. A bit pattern is not foldable.
 */
const GPU_INF_PREAMBLE_GLSL = `
float _gpu_inf() {
  return intBitsToFloat(0x7F800000);
}
`;

/**
 * Sign-preserving integer power (GLSL syntax). GLSL `pow(x, n)` is
 * `exp2(n·log2(x))`, undefined for a negative base — it returns `+8` for
 * `pow(-2.0, 3.0)` (wrong sign) and NaN for even powers of a negative. Compute
 * the magnitude from `abs(x)` and restore the sign for odd exponents. `n` is a
 * non-negative integer value; matches JS `Math.pow` for integer exponents
 * (including `0^0 = 1`).
 */
export const GPU_POWI_PREAMBLE_GLSL = `
float _gpu_powi(float x, float n) {
  if (n == 0.0) return 1.0;
  float r = pow(abs(x), n);
  if (x < 0.0 && mod(n, 2.0) == 1.0) return -r;
  return r;
}
`;

/**
 * Sign-preserving integer power (WGSL syntax). See GPU_POWI_PREAMBLE_GLSL.
 */
export const GPU_POWI_PREAMBLE_WGSL = `
fn _gpu_powi(x: f32, n: f32) -> f32 {
  if (n == 0.0) { return 1.0; }
  let r = pow(abs(x), n);
  if (x < 0.0 && (n % 2.0) == 1.0) { return -r; }
  return r;
}
`;

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
 *
 * A NON-FINITE value has no literal spelling in either language, but both can
 * MAKE the value from a bit pattern — which is what the masked-branch NaN
 * already does (`gpuNaN`). A `NaN` / `±∞` constant therefore routes through the
 * same `gpuNonFiniteLiteral` symbols instead of failing the compilation, which
 * is why this formatter needs to know the language.
 */
export function formatGPUNumber(n: number, language?: string): string {
  if (!Number.isFinite(n)) return gpuNonFiniteLiteral(n, language);
  const str = n.toString();
  if (!str.includes('.') && !str.includes('e') && !str.includes('E')) {
    return `${str}.0`;
  }
  return str;
}

// ---------------------------------------------------------------------------
// User-defined function emission (Phase 2 of the compile-CSE design, §9.1 of
// `docs/plans/2026-07-28-compile-cse-design.md`).
//
// A user-defined function literal (`f(x) := …`) called from a shader-compiled
// expression used to fail as an unknown operator, forcing consumers to inline
// the body at every call site. The GPU targets now host the same
// `userFunctions` registry the JS targets do (`base-compiler.ts`), with a
// `lowering` hook supplying what the shader languages need and the JS form
// cannot express: STATIC parameter/return types, a statement-position body,
// declaration-before-use ordering, and fail-closed recursion.
// ---------------------------------------------------------------------------

/** The shader scalar type. Always float: see `gpuTypeOfDeclaredType`. */
function gpuScalarType(isWGSL: boolean): string {
  return isWGSL ? 'f32' : 'float';
}

/** The `vecN` type of the language (`vec2` / `vec2f`). */
function gpuVecType(n: number, isWGSL: boolean): string {
  return isWGSL ? `vec${n}f` : `vec${n}`;
}

/**
 * A caller-declared shader name: its declared type, plus the identifier the
 * emitted body must REFERENCE it by when that is not the bare name.
 *
 * `ref` exists for the WGSL shader inputs, which are FIELDS of the entry
 * point's `input: VertexInput` struct — a body referencing a bare `v` names
 * nothing at all. Uniforms (both languages) and the GLSL `in` varyings are
 * bare globals and leave it unset.
 */
export type GPUShaderDeclaration = {
  name: string;
  type: string;
  ref?: string;
};

/**
 * The ELEMENT kind of a shader value type — float, signed integer, unsigned
 * integer, boolean — the axis a component count cannot express.
 */
type GPUElementKind = 'f' | 'i' | 'u' | 'b';

/**
 * A shader value type normalized into ONE comparison space: an element kind ×
 * a component count (`1` for a scalar).
 *
 * Both languages' spellings collapse into it — `vec2`, `vec2f` and `vec2<f32>`
 * are all `{f, 2}`; `bvec3` and `vec3<bool>` are both `{b, 3}` — which is what
 * lets a caller's GLSL-flavored declaration on the WGSL route (`toWGSLType`
 * maps it) be compared against a WGSL-spelled synthesized parameter.
 *
 * The element axis is load-bearing: `vec2<bool>`, `vec2<i32>` and `vec2<f32>`
 * are all two components, and neither language converts between them — a
 * width-only frame reported all three as `vec2f` and let a `vec2<bool>`
 * argument "match" a `vec2<f32>` parameter.
 */
type GPUValueType = { element: GPUElementKind; width: number };

/** A caller-declared name's type, as written and as normalized. */
type GPUDeclaredType = {
  /** The spelling the caller wrote, for diagnostics. */
  spelling: string;
  /**
   * The normalized type, or `undefined` when the spelling names no static
   * shader VALUE type here (a matrix, an array, a struct, a `#define` alias).
   * Such a name classifies as nothing — in particular not as a float — and
   * fails closed when it reaches a user-function call boundary.
   */
  value?: GPUValueType;
};

/**
 * Normalize a shader type SPELLING of EITHER language, or `undefined` for one
 * that names no scalar/vector value type here.
 *
 * Both languages' spellings are accepted whatever the target: `compileFunction`
 * takes GLSL-flavored names on the WGSL route too (`toWGSLType` maps them).
 */
function gpuNormalizeShaderType(type: string): GPUValueType | undefined {
  const t = type.trim();
  // Every float width collapses to the ONE float element: the emission has a
  // single float precision, so `double`/`f16`/`f64` are the same value type
  // here as `float`/`f32`.
  if (/^(float|double|half|f16|f32|f64)$/.test(t))
    return { element: 'f', width: 1 };
  if (/^(int|i32)$/.test(t)) return { element: 'i', width: 1 };
  if (/^(uint|u32)$/.test(t)) return { element: 'u', width: 1 };
  // Both languages spell it `bool`.
  if (t === 'bool') return { element: 'b', width: 1 };
  // GLSL: `vecN` (float), plus the `ivecN`/`uvecN`/`bvecN` element prefixes.
  const glsl = /^([ibu]?)vec([234])$/.exec(t);
  if (glsl)
    return {
      element: (glsl[1] || 'f') as GPUElementKind,
      width: Number(glsl[2]),
    };
  // WGSL: the `vecNf`/`vecNh`/`vecNi`/`vecNu` aliases…
  const alias = /^vec([234])([fhiu])$/.exec(t);
  if (alias)
    return {
      element: (alias[2] === 'h' ? 'f' : alias[2]) as GPUElementKind,
      width: Number(alias[1]),
    };
  // …and the explicit `vecN<T>` form, whose element is a scalar spelling.
  const wgsl = /^vec([234])<\s*([a-z0-9]+)\s*>$/.exec(t);
  if (wgsl) {
    const element = gpuNormalizeShaderType(wgsl[2]);
    if (element === undefined || element.width !== 1) return undefined;
    return { element: element.element, width: Number(wgsl[1]) };
  }
  return undefined;
}

/** The target language's spelling of a normalized shader value type. */
function gpuSpellValueType(t: GPUValueType, isWGSL: boolean): string {
  if (t.width === 1) {
    if (t.element === 'b') return 'bool';
    if (t.element === 'i') return isWGSL ? 'i32' : 'int';
    if (t.element === 'u') return isWGSL ? 'u32' : 'uint';
    return gpuScalarType(isWGSL);
  }
  if (t.element === 'f') return gpuVecType(t.width, isWGSL);
  if (!isWGSL) return `${t.element}vec${t.width}`;
  return `vec${t.width}<${
    t.element === 'b' ? 'bool' : t.element === 'i' ? 'i32' : 'u32'
  }>`;
}

/**
 * The declared TYPES of the names in a local shape frame, keyed by the frame
 * itself — the GPU-local companion channel of `BaseCompiler`'s shape frames.
 *
 * A shape frame records a WIDTH (plus the scalar/boolean sentinels), which
 * cannot express an element type: `ivec2` and `vec2` are both "2 components",
 * and a shader converts between them no more than between `vec2` and `float`.
 * This channel carries the complete normalized type, so `gpuTypeOfValue`
 * answers with the type the caller actually declared.
 *
 * Keyed by the FRAME rather than kept as a stack of its own so that
 * `withLocalShapeFrame`'s lifetime, isolation and innermost-wins shadowing all
 * apply to it unchanged (see `BaseCompiler.localShapeFrameOf`).
 */
const gpuDeclaredTypes = new WeakMap<
  ReadonlyMap<string, number>,
  Map<string, GPUDeclaredType>
>();

/**
 * The local shape frame for a set of caller-declared shader declarations — a
 * `compileFunction` parameter list, or a shader's `in`/`uniform` declarations
 * — with their complete declared types registered alongside it.
 *
 * Those declarations ARE the shader types of those names in the source about
 * to be emitted, and nothing else carries them, so they must be framed for the
 * shape analysis to agree with the emission (see `compileDeclaredFunctionBody`).
 * A spelling with no static value type here is entered as `LOCAL_UNSHAPED`:
 * shape-wise that is what an unframed name already answered, but the entry
 * records that the name is declared, so a call site fails closed on it rather
 * than taking it for a float.
 */
function gpuDeclaredShapeFrame(
  declarations: ReadonlyArray<GPUShaderDeclaration>
): Map<string, number> {
  const frame = new Map<string, number>();
  const types = new Map<string, GPUDeclaredType>();
  for (const { name, type } of declarations) {
    const value = gpuNormalizeShaderType(type);
    types.set(name, { spelling: type.trim(), value });
    frame.set(
      name,
      value === undefined
        ? BaseCompiler.LOCAL_UNSHAPED
        : value.width >= 2
          ? value.width
          : value.element === 'b'
            ? BaseCompiler.LOCAL_BOOLEAN
            : BaseCompiler.LOCAL_SCALAR
    );
  }
  gpuDeclaredTypes.set(frame, types);
  return frame;
}

/**
 * The caller-declared type of the name `expr`, when the shape frame that
 * decides its shape carries one.
 */
function gpuDeclaredTypeOf(expr: Expression): GPUDeclaredType | undefined {
  if (!isSymbol(expr)) return undefined;
  const frame = BaseCompiler.localShapeFrameOf(expr.symbol);
  if (frame === undefined) return undefined;
  return gpuDeclaredTypes.get(frame)?.get(expr.symbol);
}

/**
 * `target`, with the caller-declared names BOUND: each resolves to the
 * identifier the emitted source references it by — its own name, or a WGSL
 * input's field of the entry point's `input` struct — and joins `boundVars`.
 *
 * Framing the declared SHAPES is only half the job: without the binding the
 * declared name is still a free engine symbol, so a same-named assigned value
 * or user-function literal folds over the declaration the emitter is about to
 * write, and the analysis then describes a parameter the emission ignores.
 * `boundVars` carries the binding for the resolutions that are NOT the bare
 * identifier (finding A2) — `input.v` would otherwise read as a free
 * user-function reference.
 */
function gpuDeclaredBodyTarget(
  target: CompileTarget<Expression>,
  declarations: ReadonlyArray<GPUShaderDeclaration>
): CompileTarget<Expression> {
  if (declarations.length === 0) return target;
  const refs = new Map(declarations.map((d) => [d.name, d.ref ?? d.name]));
  return {
    ...target,
    var: (id) => refs.get(id) ?? target.var(id),
    boundVars: BaseCompiler.withBoundNames(target, [...refs.keys()]),
  };
}

/**
 * Is `t` a component a shader `vecN` can hold? A `vecN` is N REAL floats: a
 * boolean, a string, a complex value (itself a `vec2`) and a nested aggregate
 * all have a lowering of their own that does not fit a component slot.
 *
 * Without this, a `tuple<boolean, boolean>` declared `vec2f` and emitted
 * `vec2f(true, false)` — source no driver accepts, behind a reported success.
 */
function gpuIsVectorComponentType(t: Type): boolean {
  // Exactly the types `gpuTypeOfDeclaredType` lowers to the shader SCALAR —
  // including the untyped (`unknown`) case, which is a float by that same
  // convention. The language is irrelevant to the predicate, so it asks in
  // GLSL spelling.
  return gpuTypeOfDeclaredType(t, false) === gpuScalarType(false);
}

/**
 * Static component count of a declared aggregate type, if it has one — and
 * only when every component fits a `vecN` slot (`gpuIsVectorComponentType`),
 * so a heterogeneous or non-numeric aggregate answers `undefined` and its
 * caller fails closed (D6).
 */
function gpuDeclaredComponentCount(t: Type): number | undefined {
  if (typeof t === 'string') return undefined;
  if (t.kind === 'tuple')
    return t.elements.every((e) => gpuIsVectorComponentType(e.type))
      ? t.elements.length
      : undefined;
  if (t.kind === 'list' && t.dimensions?.length === 1)
    return gpuIsVectorComponentType(t.elements) ? t.dimensions[0] : undefined;
  return undefined;
}

/**
 * The shader type a value of DECLARED type `t` lowers to, or `undefined` when
 * it has no single static shader type (a matrix/tensor, an unsized or
 * over-wide list, a function value).
 *
 * No declared type — the common `x ↦ …` case, whose parameters type as
 * `unknown` — is a shader scalar. Deliberately never `int`/`i32`: GPU number
 * literals are always emitted with a decimal point (`formatGPUNumber`) and
 * scalar shader arithmetic is float, so an integer-typed parameter would
 * disagree with its own call sites and poison every downstream use in float
 * math. This is the same rule `compileBlock` applies to block locals.
 */
function gpuTypeOfDeclaredType(
  t: Type | undefined,
  isWGSL: boolean
): string | undefined {
  if (t === undefined || t === 'unknown' || t === 'any')
    return gpuScalarType(isWGSL);
  // Complex lowers to `vec2(re, im)` — the target's existing convention.
  if (isNonRealNumber(t)) return gpuVecType(2, isWGSL);
  if (isSubtype(t, 'boolean')) return 'bool';
  if (isSubtype(t, 'number')) return gpuScalarType(isWGSL);
  const n = gpuDeclaredComponentCount(t);
  if (n !== undefined && n >= 2 && n <= 4) return gpuVecType(n, isWGSL);
  return undefined;
}

/**
 * The shader type the VALUE `expr` lowers to, or `undefined` when it has no
 * single static shader type.
 *
 * The value-side mirror of `gpuTypeOfDeclaredType`, built on the same
 * shape/complex-ness inference `compileBlock` uses for block locals — so a
 * function's return type and its call sites' argument types are decided by one
 * analysis. Widths outside 2–4 answer `undefined`: the list compilers lower
 * those to an array constructor, which is not a value a shader function
 * parameter or return slot accepts here.
 */
function gpuTypeOfValue(expr: Expression, isWGSL: boolean): string | undefined {
  // A name whose shader type the CALLER declared (a `compileFunction`
  // parameter, a shader input/uniform). Asked FIRST and answered in full:
  // nothing else carries that type — `expr.type` for such a name is the
  // undeclared engine symbol's `unknown`, i.e. a float — and the shape frame
  // alone carries a width, which cannot tell `ivec2`/`bvec2` from `vec2`. A
  // declared spelling with no static value type here answers `undefined`: it
  // is not a float, and its call sites fail closed naming it.
  const declared = gpuDeclaredTypeOf(expr);
  if (declared !== undefined)
    return declared.value && gpuSpellValueType(declared.value, isWGSL);
  // A name framed `bool` by a synthesized user-function signature.
  if (isSymbol(expr) && BaseCompiler.isLocalBoolean(expr.symbol)) return 'bool';
  if (BaseCompiler.isComplexValued(expr)) return gpuVecType(2, isWGSL);
  const n = BaseCompiler.aggregateComponentCount(expr);
  if (n !== undefined) {
    if (n < 2 || n > 4) return undefined;
    // Width alone is not enough: every component must also fit a `vecN` slot,
    // or the emission is `vec2f(true, false)` — see `gpuIsVectorComponentType`.
    return gpuValueHasVectorComponents(expr)
      ? gpuVecType(n, isWGSL)
      : undefined;
  }
  if (BaseCompiler.isNonScalarShape(expr)) return undefined;
  if (expr.type.matches('boolean')) return 'bool';
  return gpuScalarType(isWGSL);
}

/**
 * Do the components of the AGGREGATE value `expr` each fit a `vecN` slot?
 *
 * The value-side mirror of the component check `gpuDeclaredComponentCount`
 * performs: structural for a `Tuple`/`List` literal (whose element types the
 * declared type may not carry), type-based otherwise. A width that came from a
 * local shape frame was validated when the frame was built, so an expression
 * with no aggregate type of its own answers `true`.
 */
function gpuValueHasVectorComponents(expr: Expression): boolean {
  if (isFunction(expr, 'Tuple') || isFunction(expr, 'List'))
    return expr.ops.every((op) => gpuIsVectorComponentType(op.type.type));
  const t = expr.type.type;
  if (typeof t !== 'string' && (t.kind === 'tuple' || t.kind === 'list'))
    return gpuDeclaredComponentCount(t) !== undefined;
  return true;
}

/** The synthesized signature of an emitted user-function definition. */
type GPUUserFunctionSignature = {
  /** Formal parameter names, for diagnostics. */
  names: ReadonlyArray<string>;
  /** Shader type of each parameter, in order. */
  params: ReadonlyArray<string>;
  /** Shader return type. */
  ret: string;
};

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

  /**
   * Where this shader language admits a SCALAR among otherwise-`vecN`
   * operands — the one place GLSL and WGSL genuinely differ, so each target
   * overrides it (`GLSL_SHAPE_RULES`, `WGSL_SHAPE_RULES`).
   *
   * The default is the INTERSECTION of the two, so a further subclass that
   * forgets to override it fails closed rather than open: only the builtins
   * whose scalar argument is admitted in BOTH languages (`mix`'s blend
   * factor, `refract`'s index) — and, within those, only the SLOT both
   * languages declare scalar (the third) — and only the matrix arithmetic both
   * define (no unary matrix negation: GLSL has it, WGSL does not).
   *
   * `mandatoryScalarSlots` and `vectorOnlySlots` are OBLIGATIONS, so their
   * fail-closed default is the UNION rather than the intersection — more
   * obligations is stricter, where more permissions is laxer. Both languages
   * oblige `refract`'s third argument and nothing else, so the two coincide
   * for `mandatoryScalarSlots`; the vector-only table is WGSL's plus `cross`,
   * which both languages declare over `vec3` alone.
   */
  protected getShapeRules(): GPUShapeRules {
    return {
      scalarGenTypeSlots: new Map([
        ['mix', new Set([2])],
        ['refract', new Set([2])],
      ]),
      mandatoryScalarSlots: new Map([['refract', new Set([2])]]),
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
  }

  createTarget(
    options: Partial<CompileTarget<Expression>> = {}
  ): CompileTarget<Expression> {
    const functions = this.getFunctions();
    const constants = this.getConstants();
    const v2 = this.languageId === 'wgsl' ? 'vec2f' : 'vec2';
    const rules = this.getShapeRules();
    const target: GPURandomTarget & GPUShapeRulesTarget = {
      language: this.languageId,
      // Carried on the target so a LOWERING can validate the calls it
      // generates against the same table the generic gate uses — the variadic
      // `min`/`max` fold, whose nested calls no longer line up with the CE
      // operand positions (`foldNaryBuiltin`).
      gpuShapeRules: rules,
      // Restart the random-counter numbering at each compilation boundary, so
      // a target the CALLER reuses across two `compile()` calls emits the same
      // source both times (§7). Target-specific: only the GPU languages number
      // anything per compilation.
      beginCompilation: resetGPURandomNumbering,
      // A shader has no expression-level loop or IIFE, so the multi-statement
      // block forms (loop-form Sum/Product, Loop, Block) are only valid at
      // statement position. Flag it so the base compiler fails closed (D6)
      // rather than splice a bare block into a sub-expression. Gated to the pure
      // GPU languages by language id.
      bareStatementBlocks:
        this.languageId === 'glsl' || this.languageId === 'wgsl',
      // A free symbol emitted as a bare identifier must not be a reserved word
      // of the shader language, or the generated shader fails to compile. Fail
      // closed (D6) with a clear diagnostic naming the offending identifier.
      mangleId: (id) => gpuCheckIdentifier(id, this.languageId),
      // A `Which`/`If` with a statically-shaped (vec2–vec4) collection
      // condition selects ELEMENT-WISE: lower it to boolean-vector masks
      // combined with `mix`/`select`. Returns `null` — leaving the scalar
      // emission below byte-identical — when every condition is a scalar.
      selection: (args, compile, selTarget) =>
        compileGPUSelection(args, compile, selTarget),
      // A `broadcastable` unary head over a statically shaped (vec2–vec4)
      // collection needs NO fan-out: the shader builtins and operators are
      // already componentwise on a vector, so the scalar form applies directly
      // to the vector operand. Fails closed (D6) on anything with no static
      // vector shape.
      broadcastUnary: (head, operand, lowering) =>
        compileGPUBroadcastUnary(head, operand, lowering),
      // The same defect class on every emission that does NOT go through the
      // fan-out hook (the generic function-codegen and string-helper paths):
      // a collection, matrix or array operand reaching a lowering the shader
      // type system cannot give it to. Fails closed (D6) instead of emitting
      // source no driver accepts.
      checkOperandShapes: (h, opArgs, emitted) =>
        gpuCheckOperandShapes(
          h,
          opArgs,
          emitted,
          rules,
          (c) => this.preambleFor(c),
          // The head's own lowering, so a DECLARED aggregate-consuming one
          // (`Max`/`Min`) can step the gate aside — see
          // `GPU_AGGREGATE_CONSUMING`.
          functions[h]
        ),
      operators: (op) => GPU_OPERATORS[op],
      functions: (id) => functions[id],
      var: (id) => {
        if (id === 'ImaginaryUnit') return `${v2}(0.0, 1.0)`;
        if (id in constants) return constants[id];
        // Returning `undefined` (rather than a bare `id`) lets BaseCompiler
        // fold an assigned value / declared constant — including on the
        // direct-target `compile(expr, { target })` path, which uses this raw
        // target — and fall back to a bare (declarable) identifier only for a
        // genuinely free symbol.
        return undefined;
      },
      string: (str) => JSON.stringify(str),
      // Bound to the language so a NON-FINITE literal (`NaN`, `±∞`,
      // `ComplexInfinity`) reaches the right `gpuNonFiniteLiteral` spelling
      // rather than the GLSL default.
      number: (n) => formatGPUNumber(n, this.languageId),
      complex: (re, im) =>
        `${v2}(${formatGPUNumber(re, this.languageId)}, ${formatGPUNumber(
          im,
          this.languageId
        )})`,
      // Absence capability (§3.F): a shader can MAKE `NaN` (propagation is free
      // — IEEE hardware is the gate), but `isnan` is not reliable under
      // fast-math, so `isAbsent`/`coalesce` are DELIBERATELY omitted and no
      // object axis is declared. Discharge (`IsMissing`/`Coalesce`) and Kleene
      // `Equal` over possibly-absent operands are therefore a compile error on
      // this target — fail closed (§3.F). Propagation still works natively.
      absence: {
        numeric: {
          make: () =>
            gpuNaN({ language: this.languageId } as CompileTarget<Expression>),
        },
      },
      indent: 0,
      ws: (s?: string) => s ?? '',
      preamble: '',
      declare: (name, typeHint) => {
        const type = typeHint ?? (this.languageId === 'wgsl' ? 'f32' : 'float');
        return this.languageId === 'wgsl'
          ? `var ${name}: ${type}`
          : `${type} ${name}`;
      },
      block: (stmts) => {
        if (stmts.length === 0) return '';
        const last = stmts.length - 1;
        // A statement-form construct as the block's LAST element — a `Loop`
        // emits a `for (…) { … }` statement — has no value to return.
        // Return-prefixing it would produce `return for (…) { … }` (invalid
        // GLSL/WGSL), and a shader block must evaluate to a typed value, so
        // there is no `return None` analog either. Fail closed (D6). A Loop in
        // a non-final position is fine (it stays a bare statement).
        if (/^\s*(for|while)\b/.test(stmts[last]))
          throw new Error(
            `${this.languageId.toUpperCase()}: a Loop (or other statement-form ` +
              `construct) cannot be the final statement of a block — a shader ` +
              `block must evaluate to a typed value.`
          );
        stmts[last] = `return ${stmts[last]}`;
        return stmts.join(';\n') + ';';
      },
      // Per-compilation naming state for generated temporaries (the loop
      // accumulator of `compileGPUSumProduct`). Numbered per compilation like
      // the random counters below, and reset alongside them at each
      // compilation boundary (`resetGPURandomNumbering`).
      naming: { counter: 0, usedNames: new Set<string>() },
      ...options,
    };
    // Per-compilation random state (§7 of the Random family redesign),
    // installed EAGERLY: the base compiler recurses through `{ ...target }`
    // spreads, which copy the identity token by reference, so a
    // `WithRandomSeed` frame pushed here is visible to the `Random` draws
    // nested in its body. The state itself is held off the target.
    installGPURandomState(target);
    return target;
  }

  /**
   * A target for compiling `expr`, with the random-draw context (§7) stamped
   * on it: the shader stage when the caller knows it, and whether a HOST
   * `WithRandomSeed` frame is active — the cross-domain case an unframed
   * shader draw must fail closed on.
   */
  protected createTargetFor(
    expr: Expression | undefined,
    stage?: string,
    options: Partial<CompileTarget<Expression>> = {}
  ): CompileTarget<Expression> {
    const target = this.createTarget(options);
    const state = gpuRandomState(target);
    state.stage = stage;
    state.hostFrame = expr?.engine?._randomFrame !== undefined;
    // Seed the generated-temporary collision inventory from the expression,
    // unless the caller supplied a context of its own (a root that knows more
    // than one expression, or the caller's `vars` source).
    if (options.naming === undefined)
      target.naming = BaseCompiler.newNamingContext(expr, [target.preamble]);
    // User-defined function support is opt-in per target (see
    // `CompileTarget.userFunctions`), and opting in is only sound where the
    // emitted DEFINITIONS have a delivery channel. Every route that reaches
    // `createTargetFor` has one (`preambleFor` — the expression, shader, AND
    // `compileFunction` routes, so helpers referenced only inside a
    // definition body are declared too); a caller that has
    // none opts out by passing `userFunctions: undefined` explicitly, which
    // restores the historic `Unknown operator` throw. The raw `createTarget()`
    // route (direct custom targets, the interpreter fallback) never gets a
    // registry at all.
    this.currentUserFunctions = undefined;
    if (!('userFunctions' in options)) {
      const registry = this.newUserFunctions()!;
      // The compilation root: every definition body is compiled against THIS
      // target, never against whichever nested target requested the emission
      // (see `CompileTarget.userFunctions.root`).
      registry.root = target;
      target.userFunctions = registry;
      this.currentUserFunctions = registry;
    }
    return target;
  }

  /**
   * The user-defined function registry of the compilation currently in
   * flight, i.e. the one the most recent `createTargetFor` created.
   *
   * This is how the emitted definitions reach `preambleFor` — the single
   * channel that delivers the `_gpu_*` helpers today — which is called with
   * the emitted code but not with the target that produced it. Safe as
   * instance state because GPU compilation is synchronous and non-reentrant:
   * every route creates its target, compiles, and reads the definitions back
   * within one call, before any other route can run.
   */
  private currentUserFunctions?: CompileTarget<Expression>['userFunctions'];

  /**
   * The user-defined function definitions emitted during the current
   * compilation, in dependency order (a callee precedes its caller — which is
   * also what GLSL's declaration-before-use rule requires), or `''`.
   */
  protected userFunctionDefs(): string {
    const defs = this.currentUserFunctions?.defs;
    if (!defs || defs.size === 0) return '';
    return [...defs.values()].join('\n\n') + '\n';
  }

  /**
   * A fresh user-defined function registry for one compilation, with the
   * shader-language lowering hooks installed (§9.1).
   *
   * The synthesized signatures live in this closure, so `call` can check a
   * call site's argument shapes against the declaration `define` wrote, and
   * both die with the registry.
   */
  private newUserFunctions(): CompileTarget<Expression>['userFunctions'] {
    const language = this.languageId;
    const isWGSL = language === 'wgsl';
    const signatures = new Map<string, GPUUserFunctionSignature>();
    const declareFn = (
      name: string,
      ret: string,
      params: ReadonlyArray<[name: string, type: string]>,
      body: string
    ) => this.declareGPUFunction(name, ret, params, body);

    return {
      defs: new Map<string, string>(),
      compiling: new Set<string>(),
      lowering: {
        // GLSL and WGSL both forbid recursion outright.
        noRecursion: true,

        define: ({ id, name, params, body, literal, target }) => {
          // The generated name is emitted bare; a shader reserved word here
          // would be source no driver accepts (D6).
          gpuCheckIdentifier(name, language);
          // The formal parameters are spliced verbatim into the signature and
          // referenced bare in the body, so they need the same check — the
          // convention the loop indices of `Sum`/`Product`/`Loop` follow.
          // `f(discard) := discard + 1` would otherwise emit
          // `float _fn_f(float discard)` behind a reported success.
          for (const p of params) gpuCheckIdentifier(p, language);

          // PARAMETER TYPES. The declared signature is authoritative — a
          // parameter symbol's own type does not carry it (`f: (complex) ->
          // complex` leaves `z` typed `number`) — with the parameter symbol's
          // type as the fallback for an undeclared/`unknown` slot.
          const engine = literal.engine;
          const paramSymbols = isFunction(literal)
            ? literal.ops.slice(1)
            : ([] as ReadonlyArray<Expression>);
          const complexFrame = new Map<string, boolean>();
          const vectorFrame = new Map<string, number>();
          const paramTypes = params.map((p, i) => {
            const declared = BaseCompiler.userFunctionParamType(engine, id, i);
            const own = paramSymbols[i]?.type?.type;
            const t =
              declared === undefined || declared === 'unknown' ? own : declared;
            const shader = gpuTypeOfDeclaredType(t, isWGSL);
            if (shader === undefined)
              throw new Error(
                `${id}: parameter "${p}" has no static ${language.toUpperCase()} ` +
                  `type — only scalars, booleans, complex values and 2–4 ` +
                  `component vectors have one, and a shader function ` +
                  `signature must be fully typed. Declare a narrower ` +
                  `signature for "${id}". Fail closed (D6).`
              );
            // Record the parameter's inferred shape so the body analysis
            // agrees with the declaration just synthesized (and so a
            // parameter is never resolved against a same-named engine
            // symbol). Scalars use the `LOCAL_SCALAR` sentinel, booleans the
            // `LOCAL_BOOLEAN` one — a `(boolean) -> …` parameter is `bool` in
            // the emitted signature, so the body must classify it `bool` too
            // (a body that RETURNS it would otherwise synthesize a `float`
            // return type for a `bool` value).
            const complex = t !== undefined && isNonRealNumber(t);
            const n = complex
              ? 2
              : (gpuDeclaredComponentCount(t ?? 'unknown') ?? 0);
            complexFrame.set(p, complex);
            vectorFrame.set(
              p,
              shader === 'bool'
                ? BaseCompiler.LOCAL_BOOLEAN
                : n >= 2
                  ? n
                  : BaseCompiler.LOCAL_SCALAR
            );
            return shader;
          });

          // RETURN TYPE and BODY, both under the parameter shape frame — and
          // under that frame ONLY (`isolate`): an emitted definition is a
          // module-level function, so when this emission was triggered from
          // inside ANOTHER definition's body, that caller's parameter shapes
          // must not reach here (they would give a same-named global the
          // caller's width). A shader function body is a STATEMENT position: a
          // loop-form `Sum`/`Product` inside it hoists its loop ahead of the
          // `return`.
          const { ret, code } = BaseCompiler.withLocalShapeFrame(
            complexFrame,
            vectorFrame,
            () => {
              const ret = gpuTypeOfValue(body, isWGSL);
              if (ret === undefined)
                throw new Error(
                  `${id}: the return value has no static ` +
                    `${language.toUpperCase()} type — only scalars, booleans, ` +
                    `complex values and 2–4 component vectors have one. Fail ` +
                    `closed (D6).`
                );
              return {
                ret,
                code: BaseCompiler.compileFunctionBody(body, target),
              };
            },
            true
          );

          signatures.set(name, { names: params, params: paramTypes, ret });
          return declareFn(
            name,
            ret,
            params.map((p, i): [string, string] => [p, paramTypes[i]]),
            code
          );
        },

        call: ({ id, name, args, target }) => {
          const sig = signatures.get(name);
          // `define` always runs before the first `call`
          // (`ensureUserFunctionEmitted`), so this cannot be reached.
          if (sig === undefined)
            throw new Error(`Internal: no synthesized signature for "${id}"`);
          if (args.length !== sig.params.length)
            throw new Error(
              `${id}: called with ${args.length} argument(s) but declared ` +
                `with ${sig.params.length} — a ${language.toUpperCase()} call ` +
                `must match its declaration exactly (there are no optional or ` +
                `variadic parameters). Fail closed (D6).`
            );
          const code = args.map((arg, i) => {
            const t = gpuTypeOfValue(arg, isWGSL);
            // A name the CALLER declared with a spelling this analysis has no
            // value type for (a matrix, an array, a struct, an alias). It is
            // NOT a float — classifying it as one is how a `mat4` uniform
            // reached a synthesized `float` parameter behind a reported
            // success — and the declared spelling is the only thing that
            // points at the fix, so it is named.
            const badDecl =
              t === undefined ? gpuDeclaredTypeOf(arg) : undefined;
            if (badDecl !== undefined)
              throw new Error(
                `${id}: argument ${i + 1} \`${arg.toString()}\` is declared ` +
                  `"${badDecl.spelling}" by the caller — a type with no ` +
                  `static ${language.toUpperCase()} value shape here (only ` +
                  `scalars, booleans and 2–4 component vectors have one), so ` +
                  `it cannot be matched against parameter "${sig.names[i]}" ` +
                  `(declared "${sig.params[i]}"). Fail closed (D6).`
              );
            // A collection argument beyond the static vec2–vec4 shapes: the
            // JS target answers this with the `_SYS.bcastFn` runtime
            // broadcast dispatch, which a shader has no analog for. Scalar
            // applying it silently would compute a different value.
            if (t === undefined)
              throw new Error(
                `${id}: argument ${i + 1} is a collection with no static ` +
                  `${language.toUpperCase()} shape (only 2–4 component ` +
                  `vectors have one), and a shader has no runtime broadcast ` +
                  `dispatch to apply "${id}" element-wise. Fail closed (D6).`
              );
            if (t !== sig.params[i])
              throw new Error(
                // The argument is named as well as numbered: the mismatch is
                // often between a `compileFunction` parameter the CALLER
                // declared and a callee signature it never saw, and the
                // position alone does not point at either.
                `${id}: argument ${i + 1} \`${arg.toString()}\` lowers to "${t}" but parameter ` +
                  `"${sig.names[i]}" is declared "${sig.params[i]}" — ` +
                  `${language.toUpperCase()} has no implicit conversion ` +
                  `between them. Declare a matching signature for "${id}". ` +
                  `Fail closed (D6).`
              );
            return BaseCompiler.compileValueOperand(arg, target);
          });
          return `${name}(${code.join(', ')})`;
        },

        value: ({ id }) => {
          throw new Error(
            `${id}: a user-defined function cannot be used as a VALUE on ` +
              `target '${language}' — the shader languages have no function ` +
              `values (no higher-order operands, no function pointers). Call ` +
              `it instead. Fail closed (D6).`
          );
        },
      },
    };
  }

  /**
   * Assemble a function declaration in the target language from an
   * ALREADY-COMPILED body.
   *
   * The declaration-syntax half of `compileFunction`, split out because the
   * user-function emission must compile the body itself (parameters shadowed,
   * shapes framed, same registry and naming context) rather than against a
   * fresh target of its own. `params`/`ret` are already language-specific
   * types (`float`/`vec2` vs `f32`/`vec2f`).
   */
  protected declareGPUFunction(
    name: string,
    returnType: string,
    params: ReadonlyArray<[name: string, type: string]>,
    body: string
  ): string {
    const signature =
      this.languageId === 'wgsl'
        ? `fn ${name}(${params
            .map(([n, t]) => `${n}: ${t}`)
            .join(', ')}) -> ${returnType}`
        : `${returnType} ${name}(${params
            .map(([n, t]) => `${t} ${n}`)
            .join(', ')})`;
    // A multi-line body already carries its own `return` on the last line (the
    // block convention, and what `compileFunctionBody` emits once anything
    // hoisted); a single-line one is an expression.
    if (body.includes('\n')) {
      const indented = body
        .split('\n')
        .map((l) => `  ${l}`)
        .join('\n');
      return `${signature} {\n${indented}\n}`;
    }
    return `${signature} {\n  return ${body};\n}`;
  }

  /**
   * Compile the body of a `compileFunction` declaration with the CALLER's
   * parameter list visible to the shape analysis.
   *
   * The `[name, type]` pairs a `compileFunction` caller supplies ARE the
   * shader types of those names in the source about to be emitted — nothing
   * else carries them (a bare `v` is an undeclared engine symbol, which the
   * analysis reads as a scalar). Without the frame the analysis and the
   * emitted signature can disagree: `compileFunction(h(v), …, [['v','vec2']])`
   * against an undeclared `h` synthesized `float _fn_h(float w)` and passed
   * the `vec2 v` into it behind a reported success. Framing the declared
   * shapes lets the existing call-site check see the mismatch and fail closed
   * (D6).
   *
   * The complete declared TYPE is carried (element × width, both languages'
   * spellings normalized), not just a width: `ivec2` and `bvec2` are two
   * components each and convert to `vec2` in neither language. A spelling with
   * no static value type here (a matrix, an array, a struct, a `#define`
   * alias) is recorded as such and fails closed if it reaches a user-function
   * call. Complex-ness is deliberately NOT framed: a `vec2` parameter may be a
   * point or a complex number, the caller's type does not say which, and the
   * existing inference already answers `vec2` either way.
   *
   * The parameters are also BOUND (`gpuDeclaredBodyTarget`), so a same-named
   * engine symbol cannot fold over the parameter the signature declares.
   */
  protected compileDeclaredFunctionBody(
    expr: Expression,
    parameters: ReadonlyArray<[name: string, type: string]>
  ): string {
    const declarations = parameters.map(([name, type]) => ({ name, type }));
    const target = gpuDeclaredBodyTarget(
      this.createTargetFor(expr),
      declarations
    );
    return BaseCompiler.withLocalShapeFrame(
      new Map(),
      gpuDeclaredShapeFrame(declarations),
      () =>
        // A function body is a statement position: a nested loop-form
        // `Sum`/`Product` hoists its loop ahead of the `return` (Tycho item
        // 110).
        BaseCompiler.compileFunctionBody(expr, target)
    );
  }

  compile(
    expr: Expression,
    options: CompilationOptions<Expression> = {}
  ): CompilationResult {
    try {
      return this.compileOrThrow(expr, options);
    } catch (e) {
      // Default: throw. With `fallback: true`, return the documented
      // `success: false` shape with an interpreter-backed `run`.
      if (options.fallback !== true) throw e;
      const error = (e as Error).message;
      console.warn(
        `Compilation fallback for "${expr.operator}" (target: ${this.languageId}): ${error}`
      );
      return BaseCompiler.buildInterpreterFallback(
        expr,
        error,
        this.languageId,
        this.createTarget(),
        options.vars ? new Set(Object.keys(options.vars)) : undefined
      );
    }
  }

  private compileOrThrow(
    expr: Expression,
    options: CompilationOptions<Expression> = {}
  ): CompilationResult {
    // Reproduce the engine's `angularUnit` semantics in radian-based code.
    expr = rewriteAngularUnit(expr);
    const { functions: userFunctions, vars } = options;
    const allFunctions = this.getFunctions();
    const constants = this.getConstants();

    const v2 = this.languageId === 'wgsl' ? 'vec2f' : 'vec2';
    const target = this.createTargetFor(expr, undefined, {
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
        if (id === 'ImaginaryUnit') return `${v2}(0.0, 1.0)`;
        if (id in constants) return constants[id];
        // Returning `undefined` lets BaseCompiler fold an assigned value /
        // declared constant the way evaluate() does — otherwise a symbol
        // omitted from `expr.unknowns` (because the engine considers it known)
        // would be emitted as a bare, undeclared identifier, i.e. a shader
        // that fails to compile on the GPU. A genuinely free symbol has no
        // value and falls back to the bare (vars-mappable, unknowns-listed)
        // identifier.
        return undefined;
      },
      // Root compilation boundary: fresh, deterministic numbering for the
      // generated temporaries, seeded with the expression's own symbols and any
      // `_tv`/`_cse` token in the source the caller splices in.
      naming: BaseCompiler.newNamingContext(expr, [
        options.preamble,
        ...(vars ? Object.values(vars) : []),
      ]),
    });
    // The `vars` names, for the seed ABI check (§7): a seed that resolves to a
    // HOST-supplied uniform is the deferred ABI row, and must fail loudly
    // rather than silently draw a different stream than the host.
    if (vars) gpuRandomState(target).varNames = new Set(Object.keys(vars));

    // A statement position: the emitted `code` is a function body, so a
    // loop-form `Sum`/`Product` nested anywhere inside may hoist its loop ahead
    // of the value (Tycho item 110). With nothing hoisted this is byte-identical
    // to a plain `compile()`.
    const code = BaseCompiler.compileFunctionBody(expr, target);
    const result: CompilationResult = {
      target: this.languageId,
      success: true,
      code,
    };
    const preamble = this.preambleFor(code);
    if (preamble) result.preamble = preamble;

    return BaseCompiler.withReferences(
      result,
      expr,
      target,
      vars ? new Set(Object.keys(vars)) : undefined
    );
  }

  /**
   * The helper-function preamble required by `code` — every `_gpu_*` (and
   * complex/fractal) helper the emission references, in dependency order.
   * Used by `compileOrThrow` (which returns it as `CompilationResult.preamble`
   * for the caller to splice) and by `compileShader` (which splices it into
   * the emitted shader ahead of `main()`, since that route returns a complete
   * shader with no separate preamble channel).
   */
  protected preambleFor(code: string): string {
    // The user-defined function definitions this compilation emitted travel to
    // the consumer on the SAME channel as the `_gpu_*` helpers — the returned
    // preamble — so every route that delivers helpers delivers definitions
    // too, with no second channel to wire up. They are folded into `code`
    // first so the helper scans below see what the DEFINITION BODIES
    // reference (a `_gpu_powi` used only inside `f` is still a helper the
    // shader must declare), and appended AFTER the helpers so a definition
    // that calls one is declared second (GLSL: declaration before use).
    const userDefs = this.userFunctionDefs();
    if (userDefs) code = `${code}\n${userDefs}`;
    let preamble = '';
    preamble += buildComplexPreamble(code, this.languageId);
    // Only GLSL emits `_gpu_nan()` / `_gpu_inf()` (WGSL uses an inline bit
    // pattern); both helpers are built the same way, from the ES 3.00
    // `intBitsToFloat` this target already assumes.
    if (code.includes('_gpu_nan')) preamble += GPU_NAN_PREAMBLE_GLSL;
    if (code.includes('_gpu_inf')) preamble += GPU_INF_PREAMBLE_GLSL;
    if (code.includes('_gpu_powi'))
      preamble +=
        this.languageId === 'wgsl'
          ? GPU_POWI_PREAMBLE_WGSL
          : GPU_POWI_PREAMBLE_GLSL;
    if (code.includes('_gpu_gamma'))
      preamble +=
        this.languageId === 'wgsl'
          ? GPU_GAMMA_PREAMBLE_WGSL
          : GPU_GAMMA_PREAMBLE_GLSL;
    if (code.includes('_gpu_erf'))
      preamble +=
        this.languageId === 'wgsl'
          ? GPU_ERF_PREAMBLE_WGSL
          : GPU_ERF_PREAMBLE_GLSL;
    if (code.includes('_gpu_heaviside'))
      preamble +=
        this.languageId === 'wgsl'
          ? GPU_HEAVISIDE_PREAMBLE_WGSL
          : GPU_HEAVISIDE_PREAMBLE_GLSL;
    if (code.includes('_gpu_sinc'))
      preamble +=
        this.languageId === 'wgsl'
          ? GPU_SINC_PREAMBLE_WGSL
          : GPU_SINC_PREAMBLE_GLSL;
    if (code.includes('_gpu_fresnel'))
      preamble +=
        this.languageId === 'wgsl'
          ? GPU_POLEVL_PREAMBLE_WGSL
          : GPU_POLEVL_PREAMBLE_GLSL;
    if (code.includes('_gpu_fresnelC'))
      preamble +=
        this.languageId === 'wgsl'
          ? GPU_FRESNELC_PREAMBLE_WGSL
          : GPU_FRESNELC_PREAMBLE_GLSL;
    if (code.includes('_gpu_fresnelS'))
      preamble +=
        this.languageId === 'wgsl'
          ? GPU_FRESNELS_PREAMBLE_WGSL
          : GPU_FRESNELS_PREAMBLE_GLSL;
    if (code.includes('_gpu_besselJ'))
      preamble +=
        this.languageId === 'wgsl'
          ? GPU_BESSELJ_PREAMBLE_WGSL
          : GPU_BESSELJ_PREAMBLE_GLSL;
    if (code.includes('_fractal_')) {
      preamble +=
        this.languageId === 'wgsl'
          ? GPU_FRACTAL_PREAMBLE_WGSL
          : GPU_FRACTAL_PREAMBLE_GLSL;
    }
    if (code.includes('_gpu_rnd_draw')) {
      // One invocation-local u32 counter per frame (plus one shared by the
      // unframed spatial-noise draws). A shader global / WGSL `var<private>`
      // is per-invocation and initialized before the entry point runs, so
      // every invocation runs each of its frames from `n = 0`.
      const counters = [
        ...new Set(
          code.match(new RegExp(`${GPU_RANDOM_COUNTER_PREFIX}\\d+`, 'g')) ?? []
        ),
      ].sort(
        (a, b) =>
          Number(a.slice(GPU_RANDOM_COUNTER_PREFIX.length)) -
          Number(b.slice(GPU_RANDOM_COUNTER_PREFIX.length))
      );
      preamble +=
        '\n' +
        counters
          .map((n) =>
            this.languageId === 'wgsl'
              ? `var<private> ${n}: u32 = 0u;\n`
              : `uint ${n} = 0u;\n`
          )
          .join('');
      preamble +=
        this.languageId === 'wgsl'
          ? GPU_PCG3D_PREAMBLE_WGSL
          : GPU_PCG3D_PREAMBLE_GLSL;
    }
    if (code.includes('_gpu_gcd'))
      preamble +=
        this.languageId === 'wgsl'
          ? GPU_GCD_PREAMBLE_WGSL
          : GPU_GCD_PREAMBLE_GLSL;
    if (code.includes('_gpu_median_'))
      preamble +=
        this.languageId === 'wgsl'
          ? GPU_MEDIAN_PREAMBLE_WGSL
          : GPU_MEDIAN_PREAMBLE_GLSL;
    if (
      code.includes('_gpu_srgb_to') ||
      code.includes('_gpu_oklab') ||
      code.includes('_gpu_oklch') ||
      code.includes('_gpu_color_mix') ||
      code.includes('_gpu_apca')
    ) {
      preamble +=
        this.languageId === 'wgsl'
          ? GPU_COLOR_PREAMBLE_WGSL
          : GPU_COLOR_PREAMBLE_GLSL;
    }
    if (!userDefs) return preamble;
    return preamble ? `${preamble}\n${userDefs}` : userDefs;
  }

  compileToSource(
    expr: Expression,
    _options: CompilationOptions<Expression> = {}
  ): string {
    // This route answers with a bare EXPRESSION string and has no preamble
    // channel — neither for the `_gpu_*` helpers nor for a user-function
    // definition, and a function declaration is not an expression. Opt out of
    // the registry explicitly, so a user-function head keeps failing closed
    // here instead of compiling to a call whose definition is dropped.
    //
    // Deliberately NOT `compileFunctionBody`: this is not a statement position,
    // so there is nowhere to put a hoisted loop (Tycho item 110). With no sink
    // installed, a loop-form `Sum` falls back to the legacy block exactly as it
    // did before hoisting existed.
    return BaseCompiler.compile(
      expr,
      this.createTargetFor(expr, undefined, { userFunctions: undefined })
    );
  }

  /**
   * Compile the statements of a shader body, for a KNOWN stage.
   *
   * ONE target — and therefore ONE random state — for the WHOLE body. The
   * random counters are numbered per compilation and `preambleFor` declares
   * each allocated name once over the JOINED emission, so compiling each
   * statement against a fresh target would restart the numbering and let two
   * independent frames in different statements ALIAS one counter (the second
   * frame's first draw would then be `hash(seed, 1)`).
   *
   * The stage is what makes the §7 check possible: an unframed `Random()`
   * lowers to `gl_FragCoord`-derived spatial noise, which exists only in a
   * fragment shader, so a non-fragment stage throws at CE compile time rather
   * than emitting code that fails later at GPU shader-compile time. It is a
   * property of the SHADER, not of the statement.
   *
   * `declarations` are the shader's own typed names — its `in`/varying inputs
   * and its uniforms. They are the exact analog of a `compileFunction`
   * parameter list (see `compileDeclaredFunctionBody`) and are both framed and
   * BOUND the same way: without the frame a `uniform vec2 v` fed to an
   * undeclared user function classified as a scalar, agreed with the
   * synthesized `float` parameter, and passed a `vec2` into a `float` slot
   * behind a reported success; without the binding a same-named engine symbol
   * folded over the declaration, and a WGSL input — a FIELD of the entry
   * point's `input` struct — emitted a bare identifier that names nothing
   * (each declaration's `ref` supplies the identifier to emit).
   */
  protected compileShaderBody(
    body: ReadonlyArray<{ variable: string; expression: Expression }>,
    stage: string,
    declarations: ReadonlyArray<GPUShaderDeclaration> = []
  ): Array<{ variable: string; code: string; stmts: string[] }> {
    // One name, two declarations (an input AND a uniform) is a redeclaration
    // neither language accepts — and on WGSL the two do not even resolve to
    // the same identifier (`input.v` vs the global `v`), so there is no
    // reading of the body to pick. Fail closed naming the collision (D6).
    const seen = new Set<string>();
    for (const d of declarations) {
      if (seen.has(d.name))
        throw new Error(
          `Shader declaration "${d.name}" is declared more than once (as an ` +
            `input and as a uniform): two storage classes cannot share one ` +
            `name, and a body referencing it names neither unambiguously. ` +
            `Rename one of them. Fail closed (D6).`
        );
      seen.add(d.name);
    }
    // ONE naming context for the whole body too, seeded from EVERY statement:
    // the counter must stay distinct across statements (same reason as the
    // random counters), and a `_tv`-named symbol in any statement is a
    // collision for all of them. The caller-supplied assignment TARGETS are
    // seeded as source text as well: a hoisted loop declares its accumulator
    // ahead of the assignment, so a shader output spelled `_tv1` would
    // otherwise be shadowed and left unwritten (`_tv1 = _tv1`).
    const target = gpuDeclaredBodyTarget(
      this.createTargetFor(body[0]?.expression, stage, {
        naming: BaseCompiler.newNamingContext(
          body.map((a) => a.expression),
          body.map((a) => a.variable)
        ),
      }),
      declarations
    );
    // Each assignment is a statement position of its own, so a loop-form
    // `Sum`/`Product` inside it hoists its loop into `stmts`, which the shader
    // assembly emits ahead of the assignment (Tycho item 110). The whole body
    // compiles under the shader's declared shapes: the declarations are in
    // scope for every statement.
    return BaseCompiler.withLocalShapeFrame(
      new Map(),
      gpuDeclaredShapeFrame(declarations),
      () =>
        body.map((assignment) => {
          const { stmts, code } = BaseCompiler.compileStatementBody(
            assignment.expression,
            target
          );
          return { variable: assignment.variable, code, stmts };
        })
    );
  }
}
