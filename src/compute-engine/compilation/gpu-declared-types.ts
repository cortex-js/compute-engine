// Declared shader types: how a declaration is read and spelled, component
// counts, the type of a value, the scalar arithmetic and predicate tables, and
// the assignment target of a shader statement.

import type { Expression } from '../global-types.js';
import { isFunction, isSymbol } from '../boxed-expression/type-guards.js';
import type { CompileMode, CompileTarget } from './types.js';
import { colorSpaceOf } from './color-space-fact.js';
import { BaseCompiler } from './base-compiler.js';
import {
  isNonRealNumber,
  resolveTypeForCompiledLanes as resolveTypeForCompilation,
} from '../../common/type/utils.js';
import { isSubtype } from '../../common/type/subtype.js';
import type { Type } from '../../common/type/types.js';
import { gpuScalarType, gpuType, gpuVecType } from './gpu-emit.js';

/**
 * The first symbol in `expr` whose type admits a point and a list of points
 * (`gpuPointOrPointListUnion`) and that no local shape frame of the
 * compilation describes (a parameter or a local of the compiled code has an
 * entry there), or `undefined` when there is none. A `Function` literal is
 * not entered: its body is compiled with its own frames.
 */
export function gpuReadsPointOrPointListSymbol(
  expr: Expression
): Expression | undefined {
  const visited = new Set<Expression>();
  const walk = (e: Expression): Expression | undefined => {
    if (visited.has(e)) return undefined;
    visited.add(e);
    if (isSymbol(e))
      return gpuPointOrPointListUnion(e.type.type) !== undefined &&
        BaseCompiler.localShapeFrameOf(e.symbol) === undefined
        ? e
        : undefined;
    if (!isFunction(e) || e.operator === 'Function') return undefined;
    for (const op of e.ops) {
      const found = walk(op);
      if (found !== undefined) return found;
    }
    return undefined;
  };
  return walk(expr);
}

/**
 * When `type` is a union that admits a single point (a `tuple` option) and
 * an ordered collection of points, the arity of the point options (when
 * they all have the same arity) in `arity`. `undefined` for any other type.
 *
 * A shader has no value that can be either one: a point is a `vec2`,
 * `vec3` or `vec4`, and a list of points is an array. So a symbol of such a
 * type can be compiled only when the shader computes its value. The rule is
 * `BaseCompiler.pointOrPointListUnion()`, which the Block locals also read.
 */
export function gpuPointOrPointListUnion(
  type: Type
): { arity: number | undefined } | undefined {
  return BaseCompiler.pointOrPointListUnion(type);
}

/**
 * A caller-declared shader name: its declared type, plus the identifier the
 * emitted body must REFERENCE it by when that is not the bare name.
 *
 * `ref` exists for the WGSL shader inputs, which are FIELDS of the entry
 * point's `input` struct (`VertexInput`, `FragmentInput` or `ComputeInput`,
 * by stage) — a body referencing a bare `v` names
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
export type GPUValueType = { element: GPUElementKind; width: number };

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
  /**
   * The identifier the emitted source references the name by — its own name,
   * or a WGSL input's field of the entry point's `input` struct. This is the
   * RAW slot, before the float conversion `gpuDeclaredBodyTarget` wraps around
   * an integer-declared scalar (see `gpuDeclaredIsIntegerScalar`), for the
   * few positions that consume the integer itself (a loop bound).
   */
  ref: string;
};

/**
 * Is `v` a caller-declared scalar INTEGER (`int`/`i32`/`uint`/`u32`)?
 *
 * Shader scalar math on these targets is float: every number literal is
 * emitted with a decimal point (`formatGPUNumber`) and no synthesized
 * user-function parameter is ever an integer (`gpuTypeOfDeclaredType`). Neither
 * GLSL ES nor WGSL promotes an integer to a float, so an integer-declared
 * name reaching float arithmetic bare (`float f(int K) { return K + 1.0; }`)
 * is a driver-side type error behind a reported success. Such a name is
 * therefore converted where it is referenced (`gpuDeclaredBodyTarget` binds it
 * to `float(K)` / `f32(K)`), and every reading of it downstream is a float
 * (`gpuTypeOfValue`, `gpuAtFramedIndex`).
 *
 * The conversion is LOSSY above 2^24 (≈16.7M): a shader float has a 24-bit
 * significand, so an integer uniform carrying a larger count or identifier
 * reads rounded in float arithmetic. Loop bounds and plot parameters never
 * approach that; it is a known limit of the float lowering, not a defect to
 * rediscover.
 */
export function gpuDeclaredIsIntegerScalar(
  v: GPUValueType | undefined
): boolean {
  return (
    v !== undefined && v.width === 1 && (v.element === 'i' || v.element === 'u')
  );
}

/**
 * Normalize a shader type SPELLING of EITHER language, or `undefined` for one
 * that names no scalar/vector value type here.
 *
 * Both languages' spellings are accepted whatever the target: `compileFunction`
 * takes GLSL-flavored names on the WGSL route too (`toWGSLType` maps them).
 * A leading GLSL precision, interpolation or storage qualifier is ignored
 * (`gpuWithoutQualifiers`).
 */
export function gpuNormalizeShaderType(type: string): GPUValueType | undefined {
  // A GLSL qualifier before the type (`highp vec2`) does not change it.
  const t = gpuWithoutQualifiers(type);
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
export function gpuSpellValueType(t: GPUValueType, isWGSL: boolean): string {
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
export function gpuDeclaredShapeFrame(
  declarations: ReadonlyArray<GPUShaderDeclaration>
): Map<string, number> {
  const frame = new Map<string, number>();
  const types = new Map<string, GPUDeclaredType>();
  for (const { name, type, ref } of declarations) {
    const value = gpuNormalizeShaderType(type);
    types.set(name, { spelling: type.trim(), value, ref: ref ?? name });
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
export function gpuDeclaredTypeOf(
  expr: Expression
): GPUDeclaredType | undefined {
  if (!isSymbol(expr)) return undefined;
  const frame = BaseCompiler.localShapeFrameOf(expr.symbol);
  if (frame === undefined) return undefined;
  return gpuDeclaredTypes.get(frame)?.get(expr.symbol);
}

/**
 * The first name of `names` that an `Assign` anywhere in `expr` writes. Each
 * node is visited once, so a subtree shared by several operands is not
 * walked once per path.
 */
export function gpuAssignedName(
  expr: Expression,
  names: ReadonlySet<string>,
  seen: Set<Expression> = new Set()
): string | undefined {
  if (!isFunction(expr) || seen.has(expr)) return undefined;
  seen.add(expr);
  if (
    expr.operator === 'Assign' &&
    isSymbol(expr.ops[0]) &&
    names.has(expr.ops[0].symbol)
  )
    return expr.ops[0].symbol;
  for (const op of expr.ops) {
    const found = gpuAssignedName(op, names, seen);
    if (found !== undefined) return found;
  }
  return undefined;
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
export function gpuDeclaredBodyTarget(
  target: CompileTarget<Expression>,
  declarations: ReadonlyArray<GPUShaderDeclaration>
): CompileTarget<Expression> {
  if (declarations.length === 0) return target;
  const isWGSL = target.language === 'wgsl';
  // An integer-declared scalar is referenced through a float conversion; see
  // `gpuDeclaredIsIntegerScalar` for why. Positions that need the raw integer
  // read `GPUDeclaredType.ref` instead of `var()`.
  const refs = new Map(
    declarations.map((d) => {
      const ref = d.ref ?? d.name;
      return [
        d.name,
        gpuDeclaredIsIntegerScalar(gpuNormalizeShaderType(d.type))
          ? `${isWGSL ? 'f32' : 'float'}(${ref})`
          : ref,
      ];
    })
  );
  return {
    ...target,
    var: (id) => refs.get(id) ?? target.var(id),
    ...BaseCompiler.withBoundScope(target, [...refs.keys()]),
  };
}

/**
 * Whether the first line of the shader statement list `body` that names
 * `name` is an assignment of `name` at the top level of the list (not in a
 * loop or a branch, whose lines are indented or start with a keyword), whose
 * value does not read `name`. Then no statement reads `name` before it has a
 * value. Any other first occurrence gives `false`.
 */
export function gpuWrittenFirst(body: string, name: string): boolean {
  const word = new RegExp(`(?<![\\w.])${name}(?!\\w)`);
  for (const line of body.split('\n')) {
    if (!word.test(line)) continue;
    if (!line.startsWith(`${name} = `)) return false;
    return !word.test(line.slice(name.length + 3));
  }
  return false;
}

/**
 * Is `t` a component a shader `vecN` can hold? A `vecN` is N REAL floats: a
 * boolean, a string, a complex value (itself a `vec2`) and a nested aggregate
 * all have a lowering of their own that does not fit a component slot.
 *
 * Without this, a `tuple<boolean, boolean>` declared `vec2f` and emitted
 * `vec2f(true, false)` — source no driver accepts, behind a reported success.
 */
export function gpuIsVectorComponentType(t: Type): boolean {
  // Exactly the types `gpuTypeOfDeclaredType` lowers to the shader SCALAR —
  // including the untyped (`unknown`) case, which is a float by that same
  // convention. The language is irrelevant to the predicate, so it asks in
  // GLSL spelling.
  return gpuTypeOfDeclaredType(t, false) === gpuScalarType(false);
}

/**
 * The component count a SHADER TYPE spelling denotes — `vec2`/`vec3`/`vec4`
 * and the WGSL `vec2f`/`vec3<f32>` spellings — or `1` for a scalar and
 * `bool`. The inverse reading of `gpuTypeOfValue`, for a value whose shader
 * type is already known.
 */
export function gpuComponentCountOfShaderType(shader: string): number {
  const m = /^vec([234])/.exec(shader);
  return m === null ? 1 : Number(m[1]);
}

/**
 * Static component count of a declared aggregate type, if it has one — and
 * only when every component fits a `vecN` slot (`gpuIsVectorComponentType`),
 * so a heterogeneous or non-numeric aggregate answers `undefined` and its
 * caller fails closed.
 */
export function gpuDeclaredComponentCount(t: Type): number | undefined {
  // A `type alias` / nominal `type` reference answers layout questions as its
  // definition (§4.6 step 1).
  t = resolveTypeForCompilation(t);
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
export function gpuTypeOfDeclaredType(
  t: Type | undefined,
  isWGSL: boolean
): string | undefined {
  if (t === undefined || t === 'unknown' || t === 'any')
    return gpuScalarType(isWGSL);
  // A `type alias` / nominal `type` reference lowers to its DEFINITION's
  // shader type: compilation is type erasure (§4.6 step 1). Covers both a
  // nominal-typed value and a nominal declared parameter type.
  t = resolveTypeForCompilation(t);
  if (isSubtype(t, 'color')) return gpuVecType(3, isWGSL);
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
export function gpuTypeOfValue(
  expr: Expression,
  isWGSL: boolean
): string | undefined {
  // A name whose shader type the CALLER declared (a `compileFunction`
  // parameter, a shader input/uniform). Asked FIRST and answered in full:
  // nothing else carries that type — `expr.type` for such a name is the
  // undeclared engine symbol's `unknown`, i.e. a float — and the shape frame
  // alone carries a width, which cannot tell `ivec2`/`bvec2` from `vec2`. A
  // declared spelling with no static value type here answers `undefined`: it
  // is not a float, and its call sites fail closed naming it.
  const declared = gpuDeclaredTypeOf(expr);
  if (declared !== undefined) {
    // An integer-declared scalar is referenced through a float conversion
    // (`gpuDeclaredBodyTarget`), so what a call site or return slot receives
    // IS a float.
    if (gpuDeclaredIsIntegerScalar(declared.value))
      return gpuScalarType(isWGSL);
    return declared.value && gpuSpellValueType(declared.value, isWGSL);
  }
  // A name framed `bool` by a synthesized user-function signature.
  if (isSymbol(expr) && BaseCompiler.isLocalBoolean(expr.symbol)) return 'bool';
  // A value computed from a symbol whose type admits a point and a list of
  // points, and that no local shape frame describes, has no static shader
  // type. The compile entries write the point value of such a symbol in
  // place of it (`inlinePointValues`), so this is a symbol that they did
  // not replace (its value reads a name that the compiled code binds): its
  // declared type has no width, and the types read below could disagree
  // with the code (a `float` declaration for a `vec2` value).
  if (gpuReadsPointOrPointListSymbol(expr) !== undefined) return undefined;
  if (
    (!isSymbol(expr) || !BaseCompiler.localShapeFrameOf(expr.symbol)) &&
    (isSubtype(gpuType(expr), 'color') || colorSpaceOf(expr) !== undefined)
  )
    // A visible color constructor or conversion emits three channels even
    // when its cached type still permits broadcasting through a local.
    return gpuVecType(3, isWGSL);
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
    return expr.ops.every((op) => gpuIsVectorComponentType(gpuType(op)));
  const t = gpuType(expr);
  if (typeof t !== 'string' && (t.kind === 'tuple' || t.kind === 'list'))
    return gpuDeclaredComponentCount(t) !== undefined;
  return true;
}

/**
 * The names of the symbols read as a COLOUR operand during a compilation,
 * keyed by the `loweredSymbolType` hook of the target that compiled it.
 *
 * A symbol used as a colour operand (`a` in `ColorMix(a, b, 0.5)`) has the
 * engine type `color | string | tuple`, from which no shader type follows,
 * but the emitted code reads it as a `vec3` of colour channels. Only the
 * emission knows this, so `gpuColorOperand` records the name here while it
 * compiles, and the hook reads it back when the result reports its free
 * symbols. The key is the hook function because it is the one value every
 * copy of the target (`{ ...target }`, made for nested compilations)
 * shares with the target that reports the result.
 */
export const gpuColorSymbolReads = new WeakMap<object, Set<string>>();

/** The synthesized signature of an emitted user-function definition. */
export type GPUUserFunctionSignature = {
  /** Formal parameter names, for diagnostics. */
  names: ReadonlyArray<string>;
  /** Shader type of each parameter, in order. */
  params: ReadonlyArray<string>;
  /** Color parameters receive canonical OKLCh channels. */
  colors: ReadonlyArray<boolean>;
  /**
   * Complex parameters hold a `vec2(re, im)`. A real argument is lifted to
   * `vec2(x, 0.0)` at the call. The shader type alone cannot tell this: a
   * 2-component vector parameter is also a `vec2`, and a scalar passed to
   * one must still be refused.
   */
  complex: ReadonlyArray<boolean>;
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
/**
 * The compile modes the shader targets offer (`CompileMode`): `'strict'`
 * only. See `createTarget`.
 */
export const GPU_SUPPORTED_MODES: readonly CompileMode[] = ['strict'];

/**
 * The target fields that `GPUShaderTarget.withTargetExtension` adds to each
 * target of one compilation.
 */
export type GPUTargetExtension = Pick<
  CompileTarget<Expression>,
  'storage' | 'storageRead' | 'hostInputVars' | 'onReturn'
>;

/**
 * A GLSL type spelling without its leading precision, interpolation and
 * storage qualifiers (`highp vec4` is `vec4`). The GLSL `compileShader()`
 * writes an output as `out ${type} ${name};`, so a caller can put such a
 * qualifier in the type.
 */
function gpuWithoutQualifiers(type: string): string {
  return type
    .trim()
    .replace(
      /^((lowp|mediump|highp|flat|smooth|noperspective|centroid)\s+)+/,
      ''
    );
}

/**
 * The value type of a matrix or array spelling of either language (`mat2`,
 * `mat3x2f`, `mat2x2<f32>`, `float[5]`, `array<f32, 5>`), or `undefined` for
 * another spelling. No scalar or vector target accepts such a value.
 */
export function gpuMatrixOrArraySpelling(
  type: string
): { kind: 'matrix' | 'array'; spelling: string } | undefined {
  const t = gpuWithoutQualifiers(type);
  if (/^d?mat[234](x[234])?([fh]|<\s*\w+\s*>)?$/.test(t))
    return { kind: 'matrix', spelling: t };
  if (/^array\s*<.*>$/.test(t) || /\[\s*\d*\s*\]$/.test(t))
    return { kind: 'array', spelling: t };
  return undefined;
}

/**
 * The operators that `gpuCertainValueType` reads as element-wise: each gives a
 * float scalar when all its operands are float scalars. An operator that can
 * give a vector from scalars (`Tuple`, a color function, a user function) is
 * not here.
 */
export const GPU_SCALAR_ARITHMETIC = new Set([
  'Add',
  'Subtract',
  'Multiply',
  'Divide',
  'Negate',
  'Power',
  'Square',
  'Sqrt',
  'Root',
  'Exp',
  'Ln',
  'Log',
  'Abs',
  'Sign',
  'Floor',
  'Ceil',
  'Round',
  'Truncate',
  'Fract',
  'Mod',
  'Sin',
  'Cos',
  'Tan',
  'Arcsin',
  'Arccos',
  'Arctan',
  'Sinh',
  'Cosh',
  'Tanh',
]);

/** The operators that give a `bool` from scalar operands. */
export const GPU_SCALAR_PREDICATES = new Set([
  'Less',
  'LessEqual',
  'Greater',
  'GreaterEqual',
  'Equal',
  'NotEqual',
  'And',
  'Or',
  'Not',
]);

/**
 * The type that a `compileShader()` body statement assigns, from its target
 * `variable`, or the reason why the target is not valid.
 *
 * `outputs` are the names that the body can assign, in the spelling of the
 * emitted source (a WGSL output is a field of the `output` struct, so it is
 * `output.c`), with the type the caller declared. A target is one of these
 * names, or a component selection of one with a vector type (`c.x`,
 * `output.c.rg`). The selection letters come from one set (`xyzw` or `rgba`,
 * and also `stpq` in GLSL), each letter selects a component that the vector
 * has, and no letter is repeated: GLSL ES 3.00 §5.5 refuses a repeated
 * component in an assignment target.
 *
 * The type is `undefined` when the declared type of the output is not a
 * scalar or vector type that `gpuNormalizeShaderType` reads (a matrix, an
 * array, a struct). The value of such a target is not checked. A GLSL
 * qualifier before the type (`highp vec4`) is ignored.
 *
 * For a component selection, `base` is the output and `letters` are the
 * selection letters. `compileShaderBody()` uses them to write a WGSL target of
 * two or more components as one assignment per component.
 */
export function gpuShaderAssignmentTarget(
  variable: string,
  outputs: ReadonlyArray<{ name: string; type: string }>,
  isWGSL: boolean
):
  | { type: GPUValueType | undefined; base?: string; letters?: string }
  | { error: string } {
  const whole = outputs.find((d) => d.name === variable);
  if (whole !== undefined) return { type: gpuNormalizeShaderType(whole.type) };
  const selection = /^(.+)\.([a-z]{1,4})$/.exec(variable);
  const base =
    selection === null
      ? undefined
      : outputs.find((d) => d.name === selection[1]);
  if (selection === null || base === undefined) {
    const declared =
      outputs.length === 0
        ? 'This shader declares no outputs.'
        : `The outputs are ${outputs
            .map((d) => `"${d.name}" (\`${d.type}\`)`)
            .join(', ')}.`;
    const vector = outputs.find(
      (d) => (gpuNormalizeShaderType(d.type)?.width ?? 1) >= 2
    );
    return {
      error:
        `"${variable}" is not an output of the shader. A body statement ` +
        `must assign a declared output, or components of a vector output` +
        `${vector === undefined ? '' : ` (\`${vector.name}.x\`)`}. ${declared}`,
    };
  }
  const letters = selection[2];
  const t = gpuNormalizeShaderType(base.type);
  const invalid = (reason: string) => ({
    error:
      `"${variable}" selects the components "${letters}" of the output ` +
      `"${base.name}" (\`${base.type}\`), but ${reason}.`,
  });
  if (t === undefined || t.width < 2)
    return invalid('the output is not a vector');
  const sets = isWGSL ? ['xyzw', 'rgba'] : ['xyzw', 'rgba', 'stpq'];
  const set = sets.find((s) => [...letters].every((c) => s.includes(c)));
  if (set === undefined)
    return invalid(
      `these letters are not all from one of the sets ${sets
        .map((s) => `"${s}"`)
        .join(', ')}`
    );
  if ([...letters].some((c) => set.indexOf(c) >= t.width))
    return invalid(`the vector has only ${t.width} components`);
  if (new Set(letters).size !== letters.length)
    return invalid('an assignment cannot write a component more than once');
  return {
    type: { element: t.element, width: letters.length },
    base: base.name,
    letters,
  };
}

/**
 * Can a value of type `from` be assigned to a target of type `to`?
 *
 * WGSL converts only abstract types (the types of literals) implicitly, and
 * the emitted values are concrete, so the two types must be the same. GLSL
 * ES 3.00 has no implicit conversions (§4.1.10 says so). Desktop GLSL 3.30
 * converts an `int` or a `uint` to a `float`, and an `ivecN` or a `uvecN` to a
 * `vecN`; desktop GLSL 4.00 and later also convert an `int` to a `uint`
 * (§4.1.10 "Implicit Conversions" of each version). A scalar is never
 * converted to a vector. `desktopGLSLVersion` is the version number of a
 * desktop GLSL shader, and `undefined` for WGSL and GLSL ES.
 */
export function gpuAssignmentConverts(
  from: GPUValueType,
  to: GPUValueType,
  desktopGLSLVersion: number | undefined
): boolean {
  if (from.width !== to.width) return false;
  if (from.element === to.element) return true;
  if (desktopGLSLVersion === undefined) return false;
  if (to.element === 'f') return from.element === 'i' || from.element === 'u';
  return (
    desktopGLSLVersion >= 400 && from.element === 'i' && to.element === 'u'
  );
}
