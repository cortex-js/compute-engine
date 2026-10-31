// Small text helpers that spell GPU scalars, vectors, NaN and operators. Every
// GPU module uses them; this one imports no other GPU module.

import type { Expression } from '../global-types.js';
import { isFunction } from '../boxed-expression/type-guards.js';
import { formatFloat, gpuNonFiniteLiteral } from './constant-folding.js';
import type { CompileTarget, CompiledOperators } from './types.js';
import { BaseCompiler } from './base-compiler.js';
import { resolveTypeForCompiledLanes as resolveTypeForCompilation } from '../../common/type/utils.js';
import type { Type } from '../../common/type/types.js';

/**
 * GPU shader operators shared by GLSL and WGSL.
 *
 * Both languages use identical C-style operators for arithmetic,
 * comparison, and logical operations.
 */
// Null-prototype: this table is indexed by an OPERATOR or SYMBOL NAME, and a
// name is arbitrary user text. A plain object literal inherits
// `Object.prototype`, so a name such as `toString`, `constructor` or
// `valueOf` reads the inherited member instead of missing — and because that
// value is a truthy function, the caller treats the symbol as though the
// target defined it. That made `Add(toString, 1)` refuse to compile as a
// bogus "built-in operator with no fixed arity" instead of compiling
// `toString` as an ordinary free symbol.
export const GPU_OPERATORS: CompiledOperators = {
  __proto__: null as never,
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

/** Return the vec2 constructor name for the target language. */
export function gpuVec2(target?: CompileTarget<Expression>): string {
  return target?.language === 'wgsl' ? 'vec2f' : 'vec2';
}

/** Return the vec3 constructor name for the target language. */
export function gpuVec3(target?: CompileTarget<Expression>): string {
  return target?.language === 'wgsl' ? 'vec3f' : 'vec3';
}

/**
 * The part of the current statement that is evaluated: the statement itself,
 * or the right side of a statement that stores it (`q := …`,
 * `Declare(q, real, …)`), which is evaluated before the store. `undefined`
 * when no statement position was recorded for the sink.
 */
export function gpuEvaluatedUnit(
  target: CompileTarget<Expression>
): Expression | undefined {
  const unit = target.hoist?.unit;
  if (unit === undefined) return undefined;
  if (isFunction(unit, 'Assign')) return unit.ops[1];
  if (isFunction(unit, 'Declare'))
    return BaseCompiler.declareValueOperand(unit.ops);
  return unit;
}

/** The helpers of `gpuNaNSafeLibrary` that take one operand and have a
 * vector form of each width: a broadcast over a `vecN` calls the vector
 * form (`compileGPUBroadcastUnary`). */
export const GPU_NAN_SAFE_UNARY = ['sin', 'cos', 'sign'] as const;

/**
 * Compile an operand whose code IS the whole lowering of its parent head — an
 * IDENTITY passthrough, such as `Floor` of an integer-valued operand, `Abs` of
 * a non-negative one, or `Real` of a real one.
 *
 * The shared compiler splices the emission of a function head into its parent
 * WITHOUT parentheses of its own, because a head normally emits a CALL, and a
 * call binds tighter than every infix operator. An identity lowering breaks
 * that assumption: it hands the parent the OPERAND's code, so when the operand
 * is itself an infix expression the parent's operator captures only its last
 * term. `3·⌊n + 1⌋` over an integer `n` emitted `3.0 * n + 1.0`, which is
 * `3n + 1` — a wrong value behind a reported success.
 *
 * The operand is therefore parenthesized whenever its head has an infix
 * spelling on this target. A symbol, a number literal or a call is a primary
 * already and stays bare, so those emissions are unchanged.
 */
export function gpuIdentityPassthrough(
  x: Expression,
  compile: (expr: Expression) => string,
  target: CompileTarget<Expression> | undefined
): string {
  return gpuParenthesizeIdentity(x, compile(x), target);
}

/**
 * The already-compiled form of `gpuIdentityPassthrough`, for a caller that
 * must compile its operand exactly once for its own reasons (a `Random`
 * operand redraws on a second `compile()`) and so cannot hand the operand
 * over. Same rule: parenthesize `code` when the head of `x` has an infix
 * spelling on this target.
 */
export function gpuParenthesizeIdentity(
  x: Expression,
  code: string,
  target: CompileTarget<Expression> | undefined
): string {
  if (!isFunction(x)) return code;
  const op = target?.operators?.(x.operator) ?? GPU_OPERATORS[x.operator];
  return op === undefined ? code : `(${code})`;
}

/**
 * Emit a NaN value valid for the target shader language.
 *
 * Neither GLSL nor WGSL has a `NaN` identifier (the base compiler's default
 * `If`/`Which`/`When` emit a bare `NaN`, which fails to compile on GPU). WGSL
 * rejects a NaN or an infinity produced by any constant expression, `0.0 / 0.0`
 * and a bitcast of a constant bit pattern alike. Both targets therefore route
 * through the `_gpu_nan()` preamble helper (see `GPU_NAN_PREAMBLE_GLSL` and
 * `GPU_NAN_PREAMBLE_WGSL`): a masked (`When`/`Which` else) branch's NaN is thus
 * centralized in one overridable symbol, so a host can redefine what a masked
 * branch produces without touching the generated code.
 *
 * The spelling itself lives in `gpuNonFiniteLiteral` (`constant-folding.ts`),
 * shared with the non-finite LITERAL path (`formatGPUNumber`/`formatFloat`) so
 * a `NaN` constant and a masked branch produce the same symbol.
 */
export function gpuNaN(target?: CompileTarget<Expression>): string {
  return gpuNonFiniteLiteral(NaN, target?.language);
}

// A conditional arm may use its sink to detect forbidden statement emission,
// but optional array-index specialization must not add such statements.
export const conditionalGPUSinks = new WeakSet<object>();

// Sinks whose NEXT conditional-arm compile is a CAPTURE by the statement form
// of a conditional (`compileGPUStatementSelection`): the arm's statements are
// wanted, and land inside the arm's own branch, so the guard of
// `compileGPUConditionalArm` is skipped once and re-armed for any ternary arm
// nested inside.
export const statementCaptureSinks = new WeakSet<object>();

/**
 * The two-argument arc tangent of the target language.
 *
 * GLSL overloads `atan` on arity (`atan(y_over_x)` and `atan(y, x)`); WGSL
 * declares the two-argument form under its own name, `atan2`, and has no
 * two-argument `atan` at all, so the GLSL spelling is a compile error there.
 */
export function gpuAtan2(target?: CompileTarget<Expression>): string {
  return target?.language === 'wgsl' ? 'atan2' : 'atan';
}

/** Componentwise comparison builtins (GLSL) / operators (WGSL). */
export const GPU_COMPARE_GLSL: Readonly<Record<string, string>> = {
  Less: 'lessThan',
  LessEqual: 'lessThanEqual',
  Greater: 'greaterThan',
  GreaterEqual: 'greaterThanEqual',
  Equal: 'equal',
  NotEqual: 'notEqual',
};
export const GPU_COMPARE_WGSL: Readonly<Record<string, string>> = {
  Less: '<',
  LessEqual: '<=',
  Greater: '>',
  GreaterEqual: '>=',
  Equal: '==',
  NotEqual: '!=',
};

/** The boolean-vector (`bvecN` / `vecN<bool>`) type name for the target. */
export function gpuBVec(n: number, target?: CompileTarget<Expression>): string {
  return target?.language === 'wgsl' ? `vec${n}<bool>` : `bvec${n}`;
}

/** The float-vector (`vecN` / `vecNf`) type name for the target. */
export function gpuFVec(n: number, target?: CompileTarget<Expression>): string {
  return target?.language === 'wgsl' ? `vec${n}f` : `vec${n}`;
}

/**
 * The type a shader **representation** question about `expr` is answered from:
 * a `type alias` / nominal `type` reference unfolds to its definition, because
 * compilation is type erasure (nominal-types design §4.6 step 1). Identity for
 * every other type.
 */
export function gpuType(expr: Expression): Type {
  return resolveTypeForCompilation(expr.type.type);
}

/**
 * An aggregate CONSTRUCTOR of either shader language (`vec3`, `bvec2`,
 * `mat2x2f`, `float[5]`, `array<f32, 5>`). Such a lowering BUILDS a shape from
 * its operands instead of acting on them, so the componentwise gate does not
 * apply to it; the constructors have their own guards
 * (`assertGPUScalarComponents`, `gpuValueHasVectorComponents`). The spellings
 * of the two languages are disjoint, so one predicate serves both.
 */
export const GPU_AGGREGATE_CONSTRUCTOR =
  /^(?:[iub]?vec[234]|mat[234]|array\s*<|(?:float|f32|int|i32|uint|u32|bool)\s*\[)/;

/** The callee of an array-of-vectors constructor: `vec3[12]` (GLSL) or
 * `array<vec3f, 12>` (WGSL) — the lowering of a written list of points. */
export const GPU_VECTOR_ARRAY_CONSTRUCTOR =
  /^(?:[iub]?vec[234]\s*\[|array\s*<\s*vec)/;

/**
 * `GPU_AGGREGATE_CONSTRUCTOR` unanchored: does an aggregate constructor appear
 * ANYWHERE in this source? Used to tell a scalar component apart from a nested
 * aggregate one when a reduction reads an operand's components back out.
 */
export const GPU_AGGREGATE_CONSTRUCTOR_ANYWHERE =
  /\b(?:[iub]?vec[234]|mat[234]|array\s*<|(?:float|f32|int|i32|uint|u32|bool)\s*\[)/;

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
/**
 * `code` wrapped in parentheses when it has an operator at its top level (a
 * space outside any brackets, as in `x + 1.0`), so that an emission which
 * passes one operand through can be spliced into an infix parent without
 * changing the grouping (CE-251.1).
 */
export function gpuGroup(code: string): string {
  let depth = 0;
  for (const c of code) {
    if (c === '(' || c === '[') depth++;
    else if (c === ')' || c === ']') depth--;
    else if (c === ' ' && depth === 0) return `(${code})`;
  }
  return code;
}

export function gpuIsAtomicEmission(code: string): boolean {
  const s = code.trim();
  return (
    /^[A-Za-z_]\w*(?:\.\w+|\[\d+\])*$/.test(s) ||
    /^[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?$/.test(s)
  );
}

/**
 * Constants shared by both GLSL and WGSL.
 *
 * Null-prototype so a lookup answers only for a key the table actually
 * declares. A plain object literal inherits `Object.prototype`, so indexing it
 * with an ordinary symbol named `toString`, `constructor` or `valueOf` returns
 * an inherited function rather than `undefined` — which the reference analysis
 * would read as "the target inlines this" and drop a genuine input from
 * `freeSymbols`.
 */
export const GPU_CONSTANTS: Record<string, string> = {
  __proto__: null as never,
  // The boolean literals are constants, not free symbols. Both shader
  // languages spell them lowercase, so without these a bare `True` was
  // emitted verbatim — an undeclared identifier that makes the shader fail to
  // compile, behind a `success: true` result — and was also reported in
  // `freeSymbols` as an input the caller must supply.
  True: 'true',
  False: 'false',
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
 * MAKE the value from a bit pattern, in the `_gpu_nan()` / `_gpu_inf()`
 * preamble helpers — which is what the masked-branch NaN already does
 * (`gpuNaN`). A `NaN` / `±∞` constant therefore routes through the
 * same `gpuNonFiniteLiteral` symbols instead of failing the compilation, which
 * is why this formatter needs to know the language.
 *
 * One spelling for the whole compiler: this is `formatFloat`, which the
 * emitted-code constant fold prints its shader literals with. The two must not
 * drift, or one constant would reach the shader in two spellings depending on
 * which stage produced it.
 */
export function formatGPUNumber(n: number, language?: string): string {
  return formatFloat(n, language);
}

// ---------------------------------------------------------------------------
// User-defined function emission.
//
// GPU targets use the shared `userFunctions` registry with a lowering hook for
// shader-specific requirements: static parameter and return types, a
// statement-position body, declaration-before-use ordering, and recursion
// rejection.
// ---------------------------------------------------------------------------

/** The shader scalar type. Always float: see `gpuTypeOfDeclaredType`. */
export function gpuScalarType(isWGSL: boolean): string {
  return isWGSL ? 'f32' : 'float';
}

/** The `vecN` type of the language (`vec2` / `vec2f`). */
export function gpuVecType(n: number, isWGSL: boolean): string {
  return isWGSL ? `vec${n}f` : `vec${n}`;
}
