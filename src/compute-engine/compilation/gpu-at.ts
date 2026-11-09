// At (indexing) over lists, points and textures, with the
// preambles it needs.

import type { Expression } from '../global-types.js';
import { COLLECTION_SHAPE_TYPE } from '../../common/type/primitive.js';
import {
  isFunction,
  isNumber,
  isString,
  isSymbol,
} from '../boxed-expression/type-guards.js';
import { formatFloat, gpuNonFiniteLiteral } from './constant-folding.js';
import type { CompileTarget, StorageKind } from './types.js';
import { BaseCompiler } from './base-compiler.js';
import { resolveTypeAlias } from '../../common/type/utils.js';
import { couldMatch, isSubtype } from '../../common/type/subtype.js';
import { typeToString } from '../../common/type/serialize.js';
import type { Type } from '../../common/type/types.js';
import { gpuIsAtomicEmission, gpuNaN, gpuType } from './gpu-emit.js';
import {
  gpuDeclaredComponentCount,
  gpuDeclaredIsIntegerScalar,
  gpuDeclaredTypeOf,
  gpuIsVectorComponentType,
  gpuPointListArity,
} from './gpu-declared-types.js';
import { isPointListSource } from './gpu-points.js';

// ---------------------------------------------------------------------------
// `At` — positional access on a shader target.
//
// CE's `At` is 1-based, counts a negative index from the end, and yields the
// position-preserving absence marker for `0`, an out-of-range index or a
// non-integer one; a non-numeric index leaves `At` unevaluated (no value at
// all). The NUMERIC-TARGET PROJECTION of both outcomes is `NaN` (`_SYS.at`,
// the parity oracle), and the shader lowering targets that projection — never
// the raw interpreter output.
//
// Admissible only against a base whose element COUNT is static and whose
// elements are provably scalar numeric: a shader value has a shape, and a
// runtime-length list has none. Every other shape returns a specific reason.
//
// A list of points of 2 to 4 real coordinates with a static count is
// admissible too: the result is a point, a `vecM`, and an absent point (an
// index of `0`, out of range or not an integer) is a vector of `NaN`
// components (`gpuPointListAtBase`, `compileGPUPointListAt`).
// ---------------------------------------------------------------------------

/** The static element count of an `At` base, or why it has no shader shape. */
type GPUAtBase =
  | {
      count: number;
      /**
       * Set when the base is a free symbol the caller's `storage` hint places
       * in shader storage of this kind: the read then lowers to a fetch from
       * that storage rather than to a subscript of a shader value.
       */
      storage?: StorageKind;
    }
  | { decline: string };

/**
 * Is every element of `base` provably a SCALAR NUMERIC value? Returns the
 * decline reason when not.
 *
 * Structural for a literal `List`/`Tuple` (the element expressions are right
 * there), type-based otherwise. A non-numeric element has no `float` reading,
 * and an aggregate one (a complex value, a nested tuple) is not a component of
 * the `vecN`/`float[N]` the base lowers to — indexing either would emit source
 * a driver rejects.
 *
 * The type-based readings ask `gpuIsVectorComponentType`, the same predicate
 * `gpuDeclaredComponentCount` uses, NOT "is it a number?": `complex` is a
 * number and lowers to a `vec2`, so a `tuple<complex, complex, complex>` base
 * emitted `tc.x` — a driver-rejected component of a component — behind a
 * reported success.
 */
function gpuAtNonScalarElement(base: Expression): string | undefined {
  if (isFunction(base, 'List') || isFunction(base, 'Tuple')) {
    const ops = base.ops!;
    for (let i = 0; i < ops.length; i++) {
      if (BaseCompiler.isNonScalarShape(ops[i]))
        return (
          `element ${i + 1} of the base is itself an aggregate ` +
          `(type \`${ops[i].type.toString()}\`), so it is not one component ` +
          `of a shader vector`
        );
      if (!isSubtype(gpuType(ops[i]), 'number'))
        return (
          `element ${i + 1} of the base (type \`${ops[i].type.toString()}\`) ` +
          `is not provably scalar numeric, and a shader value has no other ` +
          `element domain here`
        );
    }
    return undefined;
  }
  const t = gpuType(base);
  if (typeof t !== 'string') {
    if (t.kind === 'tuple') {
      for (let i = 0; i < t.elements.length; i++)
        if (!gpuIsVectorComponentType(t.elements[i].type))
          return (
            `slot ${i + 1} of the base tuple (type ` +
            `\`${typeToString(t.elements[i].type)}\`) is not a REAL scalar — ` +
            `a shader vector's components are single floats, and a shader ` +
            `value has no other element domain here`
          );
      return undefined;
    }
    if (t.kind === 'list') {
      if (!gpuIsVectorComponentType(t.elements))
        return (
          `the base's element type \`${typeToString(t.elements)}\` is not a ` +
          `REAL scalar — a shader vector's components are single floats, and ` +
          `a shader value has no other element domain here`
        );
      return undefined;
    }
  }
  return (
    `the base (type \`${base.type.toString()}\`) states no element type, so ` +
    `its elements are not provably scalar numeric`
  );
}

/**
 * The GPU DECLARATION FRAME's reading of the elements of a base whose
 * component count that frame supplied: `undefined` when they are shader
 * floats, the decline reason when they are not, and `'unframed'` when no frame
 * decides the name — in which case the boxed type is the only reading there
 * is (`gpuAtNonScalarElement`).
 *
 * A `compileShader` input and a `compileFunction` parameter are undeclared
 * ENGINE symbols: nothing but the caller's declaration carries their shader
 * type (`gpuTypeOfValue` asks the frame FIRST for exactly this reason), and
 * `aggregateComponentCount` already reads their WIDTH off the frame. Judging
 * their elements by the boxed type instead declined every such base — the
 * census witness's own shape.
 */
function gpuAtFramedBaseElements(
  base: Expression
): string | undefined | 'unframed' {
  if (!isSymbol(base)) return 'unframed';
  if (BaseCompiler.localShapeFrameOf(base.symbol) === undefined)
    return 'unframed';
  const declared = gpuDeclaredTypeOf(base);
  // A `Block` local's width was inferred from the value bound to it, whose
  // components are already shader floats; only a CALLER-declared spelling can
  // name a non-float component type (`ivec3`, `bvec2`).
  if (declared?.value !== undefined && declared.value.element !== 'f')
    return (
      `the base is declared "${declared.spelling}" by the caller, whose ` +
      `components are not floats — a positional shader access reads one ` +
      `float component, and GLSL does not convert between the component ` +
      `types`
    );
  return undefined;
}

/**
 * How the GPU DECLARATION FRAME reads a scalar index: `undefined` when it is
 * (or passes for) a shader float, `{ cast: true }` when it is an INTEGER that
 * must be converted before it reaches the helper's `float` parameter, and a
 * decline reason when it is no index at all.
 *
 * The same blind spot as `gpuAtFramedBaseElements`, on the other operand: a
 * caller-declared name's boxed type is `unknown`, which the
 * unknown-as-numeric-parameter rule reads as a float — so a `bool` or `i32`
 * shader input sailed into `_gpu_atN(v, i)` as a shader type error behind a
 * reported success.
 */
export function gpuAtFramedIndex(
  index: Expression
): { decline: string } | { cast: true } | undefined {
  const declared = gpuDeclaredTypeOf(index);
  if (declared === undefined) {
    // A name framed `bool` by a synthesized user-function signature carries
    // its boolean-ness nowhere else either (`BaseCompiler.LOCAL_BOOLEAN`).
    if (isSymbol(index) && BaseCompiler.isLocalBoolean(index.symbol))
      return {
        decline:
          'the index is a shader `bool`, and a positional access indexes by ' +
          'a number — GLSL does not convert a boolean to one',
      };
    // A name whose WIDTH lives in the shape frame and nowhere else: a `Block`
    // local bound to a vector, or a parameter of a SYNTHESIZED user-function
    // signature (only a caller-declared frame registers a type alongside the
    // width). Its boxed type is `unknown`, which the
    // unknown-as-numeric-parameter rule reads as a float — so an
    // aggregate-valued one sailed into `_gpu_atN(v, p)` as a shader type error
    // behind a reported success, the same fail-open the `bool` channel closes.
    if (isSymbol(index) && BaseCompiler.localShapeFrameOf(index.symbol)) {
      const width = BaseCompiler.aggregateComponentCount(index);
      if (width !== undefined)
        return {
          decline:
            `the index is the local name "${index.symbol}", which holds an ` +
            `aggregate of ${width} components, not a scalar number — a ` +
            `positional shader access indexes by a float, and neither ` +
            `language converts an aggregate to one`,
        };
    }
    return undefined;
  }
  const v = declared.value;
  if (v === undefined || v.width > 1 || v.element === 'b')
    return {
      decline:
        `the index is declared "${declared.spelling}" by the caller, which ` +
        `is not a scalar number — a positional shader access indexes by a ` +
        `float, and GLSL does not convert to one implicitly`,
    };
  // An integer-declared scalar is already referenced through a float
  // conversion (`gpuDeclaredBodyTarget`), so it passes for a float here; the
  // `cast` arm is kept for any future declared spelling that binds bare.
  return v.element === 'f' || gpuDeclaredIsIntegerScalar(v)
    ? undefined
    : { cast: true };
}

/**
 * The static element count of a sampler-backed `At` base (a free symbol the
 * caller's `storage` hint places in a texture), or a DISCRIMINATED decline
 * reason naming the storage kind — a consumer that picks a fallback lane by
 * reading decline reasons must be able to tell a texture that could not be
 * read from an array that could not.
 *
 * Only the LENGTH is needed from the type, and it must be static: the
 * generated helper bounds the index by the list's declared length, which is
 * what makes an out-of-range fetch unreachable (design ruling, section 3 of
 * the plan). An open-length list would need the bound to come from the
 * texture's own dimensions instead — a different guard, admitting a partly
 * filled last row — and is declined rather than guessed at.
 *
 * The type question is a LATTICE one ("is this a fixed-length list of
 * numbers?"), so a TRANSPARENT alias is unfolded to the list it names and a
 * NOMINAL reference is left folded (and so declines as "not a list"):
 * `resolveTypeAlias`, never `resolveTypeForCompilation`, which erases both
 * because compilation asks about layout, not admissibility.
 *
 * Unlike the value-shape reading, a ONE-element list is admissible here:
 * there is no `vec1`, but a one-texel texture reads like any other.
 */
function gpuStorageAtBaseShape(
  base: Expression & { symbol: string },
  kind: StorageKind
): GPUAtBase {
  const name = base.symbol;
  const hinted = `the base "${name}" is ${kind}-backed (storage hint)`;
  // A name the current shape frame binds — a caller-declared parameter or
  // shader input, a `Block` local, a lambda parameter — is not the free
  // symbol the hint was validated against: a declared name's shape comes from
  // its declaration, and a texture is not a shape this target's declaration
  // frame reads. Declined rather than read through the frame.
  if (BaseCompiler.localShapeFrameOf(name) !== undefined)
    return {
      decline:
        `${hinted}, but here "${name}" is a declared or local name whose ` +
        `shape comes from its declaration, not from the engine type the ` +
        `hint applies to — a name with a storage hint must be a free ` +
        `symbol of the expression`,
    };
  const t = resolveTypeAlias(base.type.type);
  const spelled = base.type.toString();
  if (typeof t === 'string' || t.kind !== 'list')
    return {
      decline:
        `${hinted}, which requires a one-dimensional fixed-length list of ` +
        `numbers, but its type is \`${spelled}\``,
    };
  const dims = t.dimensions ?? [];
  // Belt over suspenders, like the multi-axis arm of `gpuAtBaseShape`: a
  // multi-axis base makes `At` answer a COLLECTION element, which the §3.F
  // object-domain-absence gate intercepts ahead of any target function table.
  // Kept because that gate's typing is not this entry's to depend on.
  if (dims.length > 1)
    return {
      decline:
        `${hinted}, which requires a ONE-dimensional list laid out in the ` +
        `texture, but its type \`${spelled}\` is ${dims.length}-dimensional`,
    };
  // An unsized list has no `dimensions`; a NEGATIVE extent is the type
  // builder's encoding of an UNKNOWN one (`list<number^?>` →
  // `dimensions: [-1]`), the same reading the value-shape arm takes.
  const n = dims[0] ?? -1;
  if (n < 0)
    return {
      decline:
        `${hinted}, but its type \`${spelled}\` states no static length, and ` +
        `the texture read bounds the index by the list's declared length`,
    };
  if (n === 0)
    return {
      decline: `${hinted}, but its type \`${spelled}\` is an empty list, which has no element to read`,
    };
  const bad = gpuAtNonScalarElement(base);
  if (bad !== undefined) return { decline: `${hinted}, and ${bad}` };
  return { count: n, storage: kind };
}

/**
 * The static element count of an admissible `At` base — a declared
 * `vector<N>`, a parameterized `tuple<…>`, or a literal `List`/`Tuple` — or a
 * DISCRIMINATED decline reason.
 *
 * Bases whose elements are object-domain (`list<string>`) never reach here:
 * the §3.F absence gate in `BaseCompiler.compile` pre-empts them with its own
 * diagnostic, so no reason is owed for them.
 */
export function gpuAtBaseShape(
  base: Expression | null,
  target: CompileTarget<Expression>
): GPUAtBase {
  if (base === null) return { decline: 'it has no base operand' };

  // A base the caller's `storage` hint places in shader storage: the values
  // are not a shader VALUE at all, so none of the value-shape questions below
  // apply to it — its admissibility is decided from the engine type alone.
  if (isSymbol(base)) {
    const kind = target.storage?.get(base.symbol);
    if (kind !== undefined) return gpuStorageAtBaseShape(base, kind);
  }

  const t = gpuType(base);

  // Both symbols that name an absent datum are read alike (user ruling of
  // 2026-09-22); `isAbsentScalarSymbol` (`boxed-expression/validate.ts`)
  // tests the same two names.
  if (isSymbol(base, 'Missing') || t === 'missing')
    return {
      decline:
        'the base is the absence marker (`Missing`), which ' +
        'has no shader value to index into',
    };

  // A complex value lowers to `vec2(re, im)` — a NUMBER in the shader's
  // complex convention, not an indexable collection. Asked only of a
  // NON-literal base: `isComplexValued` reads a literal `List` with a complex
  // ELEMENT as complex-valued, and that shape's honest fault is the element
  // one (reported below), not "the base is a complex number".
  if (
    !isFunction(base, 'List') &&
    !isFunction(base, 'Tuple') &&
    BaseCompiler.isComplexValued(base)
  )
    return {
      decline:
        'the base is a complex value (lowered as `vec2(re, im)` by the ' +
        'complex convention), not an indexable collection',
    };

  if (
    isFunction(base, 'Dictionary') ||
    (typeof t !== 'string' &&
      // A dictionary literal synthesizes the narrower `record{…}` (its keys
      // are statically known), so both kinds land here.
      (t.kind === 'dictionary' || t.kind === 'record'))
  )
    return {
      decline:
        `the base is a dictionary (type \`${base.type.toString()}\`) and a ` +
        `shader has no keyed lookup — only positional access into a value ` +
        `of static shape`,
    };

  if (t === 'tuple')
    return {
      decline:
        'the base is an unparameterized `tuple`, which states no arity, so ' +
        'there is no static element count to index against',
    };

  let n = BaseCompiler.aggregateComponentCount(base);
  // A call of a user function over an untyped free input: the engine types
  // the call from the signature of the function, `list<unknown>` for
  // `v := s ↦ [s, 2s]` and `v(x)` with `x` free, which states no length. The
  // shader reads such an input as a float (`gpuTypeOfDeclaredType`), so the
  // value of the call is the body at a number, `vector<2>`, which has one
  // (`BaseCompiler.typeWithFreeInputsAsNumbers`). `gpuDeclaredComponentCount`
  // gives a count only when the elements of that type are shader scalars, so
  // the element test below is already made. ROADMAP CE-377.
  let elementsRead = false;
  if (
    n === undefined &&
    isFunction(base) &&
    base.operator !== 'List' &&
    base.operator !== 'Tuple'
  ) {
    const own: Type = base.type.type;
    const read = BaseCompiler.typeWithFreeInputsAsNumbers(base, target);
    if (read !== own) {
      n = gpuDeclaredComponentCount(read);
      elementsRead = n !== undefined;
    }
  }
  if (n === undefined) {
    // A CALLER-DECLARED name whose spelling this target's declaration frame
    // does not parse. `gpuDeclaredShapeFrame` enters such a name as
    // `LOCAL_UNSHAPED`, and a frame entry OVERRIDES the boxed type, so the
    // count is gone even when the engine type states one — a `float[1600]`
    // parameter over a symbol typed `list<number^1600>` arrives here with the
    // length written twice and readable neither time.
    //
    // Reported separately because the honest cause is the DECLARATION, not
    // the type: saying "no statically known length" of a type that states
    // 1600 is false, and it collided with the message the genuinely unsized
    // `list<number>` below is owed. The two declines must stay
    // distinguishable — a consumer that falls back to another lane reads
    // them to tell an open type from an unparsed declaration.
    // The message names the symbol as the caller wrote it, so that the caller
    // can search their declaration list for it.
    if (isSymbol(base)) {
      const declared = gpuDeclaredTypeOf(base);
      if (declared !== undefined && declared.value === undefined)
        return {
          decline:
            `the base is the caller-declared name "${base.symbol}", whose ` +
            `declared shader type \`${declared.spelling}\` is not one this ` +
            `target reads — it parses the scalar spellings and the ` +
            `two-to-four component vector spellings that GLSL reads ` +
            `(\`vec3\`, \`ivec3\`), and no array, ` +
            `matrix or struct type. The declaration decides the shape of a ` +
            `declared name, so no static element count reaches the analysis ` +
            `(the engine type \`${base.type.toString()}\` is not consulted ` +
            `for a declared name)`,
        };
    }
    if (typeof t !== 'string' && t.kind === 'list') {
      // Belt over suspenders: no spelling reaches this arm today. A multi-axis
      // base makes `At` answer a COLLECTION element (`missing | vector<3>`),
      // which the §3.F object-domain-absence gate intercepts ahead of any
      // target function table — the same pre-emption the header describes for
      // `list<string>`. Kept because the gate's typing is not this entry's to
      // depend on.
      if ((t.dimensions?.length ?? 0) >= 2)
        return {
          decline:
            `the base (type \`${base.type.toString()}\`) is multi-axis; only ` +
            `a one-dimensional base has a positional shader lowering`,
        };
      return {
        decline:
          `the base (type \`${base.type.toString()}\`) has no statically ` +
          `known length, and a shader value must have one`,
      };
    }
    return {
      decline:
        `the base (type \`${base.type.toString()}\`) is not a statically ` +
        `counted collection`,
    };
  }
  // A NEGATIVE count is the type builder's encoding of an UNKNOWN extent
  // (`list<number^?>` → `dimensions: [-1]`), not a width: without this the
  // count flowed on and emitted `_gpu_at-1(…)`, a call to a helper no
  // preamble generates. Same reading as the unsized `list` above.
  if (n < 0)
    return {
      decline:
        `the base (type \`${base.type.toString()}\`) has no statically ` +
        `known length, and a shader value must have one`,
    };
  if (n === 0)
    return {
      decline:
        'the base is empty, and GLSL has no zero-length ' +
        'value type',
    };
  if (n === 1)
    return {
      decline:
        'the base has 1 element: there is no `vec1`, and a 1-element ' +
        'aggregate has no shader value shape of its own',
    };

  if (elementsRead) return { count: n };

  // The elements. A name whose COUNT came from the GPU declaration frame is
  // judged against the shape the CALLER declared — its boxed type states no
  // element type at all.
  const framed = gpuAtFramedBaseElements(base);
  if (framed !== 'unframed')
    return framed === undefined ? { count: n } : { decline: framed };

  const bad = gpuAtNonScalarElement(base);
  if (bad !== undefined) return { decline: bad };
  return { count: n };
}

/**
 * The 0-based slot a 1-based CE index `i` selects in a base of `n` elements,
 * or `null` when it selects nothing — `0`, out of range, or not an integer.
 * `null` is the absence marker, which projects to the target's NaN spelling.
 */
export function gpuAtSlot(i: number, n: number): number | null {
  if (!Number.isInteger(i) || i === 0) return null;
  const j = i > 0 ? i - 1 : n + i;
  return j >= 0 && j < n ? j : null;
}

/**
 * The emitted source for element `j` (0-based) of an admissible base of `n`
 * elements.
 *
 * A literal base folds to the element's own compiled source (`At([10,20,30],
 * 2)` → `20.0`, not `vec3(…).y`) — zero runtime cost. Otherwise a base of
 * width 2–4 is a `vecN` and takes a component swizzle; a wider one is a
 * `float[N]` / `array<f32, N>` and takes a direct subscript. The
 * atomic-emission rule (the sibling point-list as-built note) keeps a bare
 * identifier unparenthesized so the emission stays atomic for the operand-
 * shape gate; anything else is parenthesized and judged as the compound it is.
 */
export function gpuAtElement(
  base: Expression,
  j: number,
  n: number,
  compile: (e: Expression) => string
): string {
  if (isFunction(base, 'List') || isFunction(base, 'Tuple'))
    return compile(base.ops![j]);
  const code = compile(base);
  const access = n <= 4 ? `.${'xyzw'[j]}` : `[${j}]`;
  return gpuIsAtomicEmission(code) ? `${code}${access}` : `(${code})${access}`;
}

/**
 * Does `gpuAtGather` fold `slots` to a SINGLE swizzle of the base? Stated once
 * so the emission and the reference count below cannot drift apart.
 */
function gpuAtIsSwizzleGather(
  base: Expression,
  slots: ReadonlyArray<number | null>,
  n: number
): boolean {
  const isLiteral = isFunction(base, 'List') || isFunction(base, 'Tuple');
  return !isLiteral && n <= 4 && slots.every((s) => s !== null);
}

/**
 * How many times the emission `gpuAtGather` will actually CHOOSE references
 * the base source — one for a swizzle however many components it selects, one
 * per in-range slot for a constructor.
 *
 * Counting the non-null slots instead described a constructor that a
 * swizzling gather never emits, and so declined `At(impure, [1, 3])`, whose
 * emission evaluates its base exactly once.
 */
export function gpuAtBaseRefs(
  base: Expression,
  slots: ReadonlyArray<number | null>,
  n: number
): number {
  if (gpuAtIsSwizzleGather(base, slots, n)) return 1;
  return slots.filter((s) => s !== null).length;
}

/**
 * The `vecK` gather of `slots` (0-based positions, `null` = out of range) out
 * of `base`. All-in-range over a `vecN` base folds to a single swizzle
 * (`v.xz`) — one reference to the base; anything else is a constructor whose
 * slots are the folded components (`vec2(v.x, _gpu_nan())`).
 */
export function gpuAtGather(
  base: Expression,
  slots: ReadonlyArray<number | null>,
  n: number,
  compile: (e: Expression) => string,
  target: CompileTarget<Expression>
): string {
  if (gpuAtIsSwizzleGather(base, slots, n)) {
    const code = compile(base);
    const sw = slots.map((s) => 'xyzw'[s!]).join('');
    return gpuIsAtomicEmission(code) ? `${code}.${sw}` : `(${code}).${sw}`;
  }
  const ctor = `vec${slots.length}`;
  const parts = slots.map((s) =>
    s === null ? gpuNaN(target) : gpuAtElement(base, s, n, compile)
  );
  return `${ctor}(${parts.join(', ')})`;
}

/**
 * How a literal index-list entry classifies. The tiers are decided from the
 * ENTRIES, not from the list's type: a literal integer gather folds at compile
 * time, a literal boolean mask is statically a gather, and a runtime-valued
 * mask has no static result length at all (design ruling 2).
 */
type GPUAtEntry = 'int' | 'bool' | 'other-literal' | 'dyn-bool' | 'dyn';

export function gpuAtEntryKind(e: Expression): GPUAtEntry {
  if (isSymbol(e, 'True') || isSymbol(e, 'False')) return 'bool';
  if (isNumber(e))
    return !e.isComplex && Number.isInteger(e.re) ? 'int' : 'other-literal';
  // Every OTHER literal is likewise an entry that selects no element — a
  // string, a nested collection, the absence marker. Classifying them 'dyn'
  // handed them the demand-gated dynamic-gather text, which describes a
  // runtime-valued integer they are not: D2 requires a literal non-integer to
  // carry its own reason.
  if (
    isString(e) ||
    isSymbol(e, 'Missing') ||
    isFunction(e, 'List') ||
    isFunction(e, 'Tuple') ||
    isFunction(e, 'Dictionary')
  )
    return 'other-literal';
  if (isSubtype(gpuType(e), 'boolean')) return 'dyn-bool';
  return 'dyn';
}

/**
 * The shader shape of an `At` base that is a list of points: `m` (2 to 4) is
 * the arity of a point, which lowers to a `vecM`, `n` the static number of
 * points, `source()` the emission of the base as a shader ARRAY of `n`
 * `vecM` values (`vec2[3](…)`, `array<vec2f, 3>(…)`), and `point(j)` the
 * emission of the point at the 0-based position `j`. `undefined` when the
 * base is not a list of points, and the decline reason when it is one with
 * no such shape.
 *
 * Three spellings are read:
 *  - a `PointList` application whose components are sources (lists of
 *    numbers with a static length) or scalar numbers, each repeated at every
 *    point. The points are zipped to the shortest source, as the interpreter
 *    does. The array is built point by point, so each source is referenced
 *    once per point and must be pure;
 *  - a literal `List` of points, which compiles to an array as it is;
 *  - any other base whose type is a list of a static length whose element
 *    type is a tuple of 2 to 4 real numbers (an engine-declared symbol).
 */
export function gpuPointListAtBase(
  base: Expression,
  compile: (e: Expression) => string
): GPUPointListAtBase | { decline: string } | undefined {
  const vec = (m: number): string => `vec${m}`;
  const array = (m: number, n: number, items: string[]): string =>
    `vec${m}[${n}](${items.join(', ')})`;

  if (isFunction(base, 'PointList')) {
    const ops = base.ops;
    if (ops.length < 2 || ops.length > 4)
      return {
        decline:
          `the points of the base have ${ops.length} coordinates, and a ` +
          `shader vector holds 2 to 4`,
      };
    let n: number | undefined = undefined;
    const counts: (number | undefined)[] = [];
    for (let i = 0; i < ops.length; i++) {
      const op = ops[i];
      if (isPointListSource(op)) {
        const c = BaseCompiler.aggregateComponentCount(op);
        if (c === undefined || c < 1)
          return {
            decline:
              `source component ${i + 1} of the point list (type ` +
              `\`${op.type.toString()}\`) has no statically known length, ` +
              `and a shader array must have one`,
          };
        const bad = gpuAtNonScalarElement(op);
        if (bad !== undefined)
          return { decline: `in source component ${i + 1}, ${bad}` };
        if (!op.isPure)
          return {
            decline:
              `source component ${i + 1} of the point list is impure, and ` +
              `the array of points references it once per point`,
          };
        counts.push(c);
        n = n === undefined ? c : Math.min(n, c);
      } else {
        if (
          !isSubtype(gpuType(op), 'number') ||
          BaseCompiler.isComplexValued(op)
        )
          return {
            decline:
              `component ${i + 1} of the point list (type ` +
              `\`${op.type.toString()}\`) is neither a list source nor a ` +
              `provably real scalar`,
          };
        if (!op.isPure)
          return {
            decline:
              `component ${i + 1} of the point list is impure, and the ` +
              `array of points references it once per point`,
          };
        counts.push(undefined);
      }
    }
    if (n === undefined)
      return {
        decline: 'no component is a list source, so this is not a point LIST',
      };
    const count = n;
    const point = (j: number): string =>
      `${vec(ops.length)}(${ops
        .map((op, i) =>
          counts[i] === undefined
            ? compile(op)
            : gpuAtElement(op, j, counts[i]!, compile)
        )
        .join(', ')})`;
    return {
      m: ops.length,
      n: count,
      point,
      source: () =>
        array(
          ops.length,
          count,
          Array.from({ length: count }, (_, j) => point(j))
        ),
    };
  }

  const m = gpuPointListArity(gpuType(base));
  if (typeof m !== 'number') return m;
  const n = isFunction(base, 'List')
    ? base.nops
    : BaseCompiler.aggregateComponentCount(base);
  if (n === undefined || n < 1)
    return {
      decline:
        `the base (type \`${base.type.toString()}\`) has no statically ` +
        `known number of points, and a shader array must have one`,
    };
  return {
    m,
    n,
    point: (j) => {
      if (isFunction(base, 'List')) return compile(base.ops[j]);
      const code = compile(base);
      return gpuIsAtomicEmission(code) ? `${code}[${j}]` : `(${code})[${j}]`;
    },
    source: () => compile(base),
  };
}

/** See `gpuPointListAtBase`. */
interface GPUPointListAtBase {
  m: number;
  n: number;
  point: (j: number) => string;
  source: () => string;
}

/**
 * `At` over a list of points with a scalar index: the point, a `vecM`. An
 * absent point — an index of `0`, out of range, not an integer, or the
 * absence marker — is a vector of `NaN` components, which is how the shader
 * targets write an absent number: nothing is drawn there. A literal index
 * folds at compile time; any other index is one call of the guarded helper
 * `_gpu_atpM_N` (`gpuAtPointPreamble`), so the base and the index are each
 * evaluated once.
 */
export function compileGPUPointListAt(
  shape: GPUPointListAtBase,
  base: Expression,
  index: Expression,
  compile: (e: Expression) => string,
  target: CompileTarget<Expression>,
  decline: (reason: string) => never
): string {
  const { m, n } = shape;
  const absent = `vec${m}(${gpuNaN(target)})`;
  if (
    isFunction(index, 'List') ||
    isSubtype(gpuType(index), COLLECTION_SHAPE_TYPE)
  )
    decline(
      'the index is a collection, so the result is a list of points, which ' +
        'has no shader value shape here'
    );
  if (isSymbol(index, 'Missing') || isSubtype(gpuType(index), 'missing')) {
    if (!base.isPure)
      decline(
        'the access folds to a vector of NaN components, which would ' +
          'DISCARD the impure base unevaluated'
      );
    return absent;
  }
  if (
    BaseCompiler.isComplexValued(index) ||
    !couldMatch(gpuType(index), 'number')
  )
    decline(
      `the index (type \`${index.type.toString()}\`) is not a real number, ` +
        `so it selects no point`
    );
  // A literal index folds when the base is pure: the other points are not
  // emitted. An impure base takes the helper, which evaluates it once.
  if (isNumber(index) && base.isPure) {
    const j = gpuAtSlot(index.re, n);
    return j === null ? absent : shape.point(j);
  }
  // A caller-declared index is read as `compileGPUAt` reads it: an integer
  // one is converted to a float at the call site.
  const framed = gpuAtFramedIndex(index);
  if (framed !== undefined && 'decline' in framed) decline(framed.decline);
  const idx = compile(index);
  const floatIdx = framed === undefined ? idx : `float(${idx})`;
  return `_gpu_atp${m}_${n}(${shape.source()}, ${floatIdx})`;
}

/**
 * The `_gpu_atpM_N` helper: the point at a 1-based index of an array of `N`
 * points of arity `M`, a negative index counting from the end, and a vector
 * of `NaN` components for any other index. The index guard is the one of
 * `_gpu_atN` (`gpuAtIndexGuard`).
 */
export function gpuAtPointPreamble(m: number, n: number): string {
  const nan = gpuNonFiniteLiteral(NaN, 'glsl');
  const { guard, doc } = gpuAtIndexGuard(n);
  return `
vec${m} _gpu_atp${m}_${n}(vec${m} v[${n}], float i) {
${doc}
  if (${guard})
    return vec${m}(${nan});
  int k = int(i);
  return v[(k > 0) ? k - 1 : ${n} + k];
}
`;
}

/** The `[M, N]` pairs of the `_gpu_atpM_N` helpers `code` calls, each once. */
export function gpuAtPointHelperShapes(code: string): [number, number][] {
  const shapes = new Map<string, [number, number]>();
  const re = /(?<![\w$])_gpu_atp([234])_(\d+)\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code)) !== null)
    shapes.set(`${m[1]}_${m[2]}`, [Number(m[1]), Number(m[2])]);
  return [...shapes.values()];
}

/**
 * Does a binding form of the expression bind `name` here (a `Block` local, a
 * loop index, a parameter)? Such a name is not the free symbol that a
 * `storage` hint of the same name applies to.
 */
export function gpuIsBoundName(
  name: string,
  target: CompileTarget<Expression>
): boolean {
  return (
    target.boundVars?.has(name) === true ||
    BaseCompiler.localShapeFrameOf(name) !== undefined
  );
}

/**
 * The name of the sampler-backed symbol whose read is being emitted, while
 * `gpuStorageOperandSource` compiles it, else `undefined`.
 *
 * A sampler-backed symbol has no shader value, so every reference to it
 * outside a positional read must fail closed — and the gate that refuses it
 * (`gpuRefuseStorageReference`, installed on the target's `var` and
 * `mangleId` hooks by `createTargetFor`) sees only an identifier, not where
 * it is being emitted. This is how the ONE legitimate emission announces
 * itself. Module state is safe here for the reason `currentUserFunctions` is:
 * GPU compilation is synchronous and non-reentrant, and the window is a
 * single `compile(base)` of a bare symbol, closed in a `finally`.
 */
let gpuOpenStorageOperand: string | undefined;

/**
 * The emitted source of the sampler-backed symbol `base` as the operand of a
 * texel read: its ordinary free-symbol emission — the `vars` mapping when the
 * caller gave one, else the bare identifier after the reserved-word check —
 * with the storage-reference gate stood aside for exactly this emission.
 */
export function gpuStorageOperandSource(
  base: Expression & { symbol: string },
  compile: (e: Expression) => string
): string {
  const saved = gpuOpenStorageOperand;
  gpuOpenStorageOperand = base.symbol;
  try {
    return compile(base);
  } finally {
    gpuOpenStorageOperand = saved;
  }
}

/**
 * Fail closed when the free symbol `id` is one the caller's `storage`
 * hint places in shader storage and it is being referenced anywhere but as
 * the operand of a positional read. A texture has no shader value of its own:
 * as an operand of arithmetic, a reduction, a user-function argument, an
 * assignment target or a bare value it would emit an identifier the shader
 * cannot use as a value, behind a reported success. The reason names the
 * storage kind, so a consumer reading decline reasons can tell it apart.
 */
export function gpuRefuseStorageReference(
  id: string,
  storage: ReadonlyMap<string, StorageKind>,
  language: string
): void {
  const kind = storage.get(id);
  if (kind === undefined || gpuOpenStorageOperand === id) return;
  throw new Error(
    `Could not compile \`${id}\`: the symbol is ${kind}-backed (compile option ` +
      `\`storage: { ${id}: '${kind}' }\`), and a texture has no shader value ` +
      `of its own on the ${language} target: it can be read only through a ` +
      `positional access (\`At(${id}, i)\`). Here it is referenced as a whole ` +
      `— as an operand, in a reduction, or as a bare value — which has no ` +
      `lowering.`
  );
}

/**
 * The `_gpu_atN` positional-access helper preamble. Generated per N on demand (`preambleFor` scans the emitted code
 * for `_gpu_at(\d+)`), so a `vector<7>` base gets a `_gpu_at7` over a
 * `float[7]` with the same body shape as the `vecN` forms.
 *
 * The guard runs ENTIRELY IN FLOAT SPACE and is the load-bearing part: `int()`
 * is undefined outside the int range, so nothing may be cast before the range
 * test, and the negated compound (`!(i >= -N && i <= N)`) swallows `NaN` and
 * `±∞` — which `floor` alone would not.
 */
export function gpuAtPreamble(n: number): string {
  const nan = gpuNonFiniteLiteral(NaN, 'glsl');
  const { guard, doc } = gpuAtIndexGuard(n);
  const param = n <= 4 ? `vec${n} v` : `float v[${n}]`;
  return `
float _gpu_at${n}(${param}, float i) {
${doc}
  if (${guard})
    return ${nan};
  int k = int(i);
  return v[(k > 0) ? k - 1 : ${n} + k];
}
`;
}

/**
 * The index guard every positional-access helper opens with, over a base of
 * `n` elements, plus the comment that documents it. Written ONCE and shared
 * by the array helper (`gpuAtPreamble`) and the texture helper
 * (`gpuTexAtPreamble`): the two storage kinds are interchangeable only while
 * they answer every index identically, so the guard text has one source.
 *
 * The guard runs ENTIRELY IN FLOAT SPACE and is the load-bearing part: `int()`
 * is undefined outside the int range, so nothing may be cast before the range
 * test, and the negated compound (`!(i >= -N && i <= N)`) swallows `NaN` and
 * `±∞` — which `floor` alone would not.
 */
export function gpuAtIndexGuard(
  n: number,
  i = 'i'
): { guard: string; doc: string } {
  const b = formatFloat(n, 'glsl');
  return {
    guard: `!(${i} >= -${b} && ${i} <= ${b}) || ${i} != floor(${i}) || ${i} == 0.0`,
    doc:
      `  // 1-based; negative counts from the end; anything else → NaN.\n` +
      `  // The guard runs entirely in float space: it rejects NaN, ±∞, huge\n` +
      `  // finite values, non-integers and 0 BEFORE the int cast (undefined\n` +
      `  // outside int range), and makes the out-of-bounds index (undefined\n` +
      `  // behavior in GLSL) unreachable.`,
  };
}

/**
 * The `_gpu_texatN` positional-access helper for a SAMPLER-BACKED list of N
 * elements. Generated per N on demand like `_gpu_atN`, and named apart from
 * it so one shader can carry both lowerings for different lists.
 *
 * The storage contract it reads (plan section 3): a single-channel 32-bit
 * float texture, one value per texel, holding the list ROW-MAJOR from texel
 * (0, 0) in a texture of any width, with at least N texels. The read is a
 * bare `texelFetch` — integer coordinates, mip level 0, no filtering, no
 * normalization — which is core in GLSL ES 3.00 / WebGL 2.
 *
 * Two different numbers meet here and must not be confused. N, the list's
 * LENGTH, is baked into the name and the guard: it bounds the index, and it
 * is what makes an out-of-range fetch unreachable — PROVIDED the texture
 * holds at least N texels, a host precondition the shader cannot check. The
 * texture's WIDTH is read at run time (`textureSize`) and only unflattens the
 * 0-based slot into a coordinate; it is deliberately not baked in, so the
 * host may pick any width and resize the texture without recompiling.
 */
export function gpuTexAtPreamble(n: number): string {
  const nan = gpuNonFiniteLiteral(NaN, 'glsl');
  const { guard, doc } = gpuAtIndexGuard(n);
  return `
float _gpu_texat${n}(sampler2D v, float i) {
${doc}
  if (${guard})
    return ${nan};
  int k = int(i);
  k = (k > 0) ? k - 1 : ${n} + k;
  // Row-major in a texture of run-time width; the host guarantees at least
  // ${n} texels, so the coordinate is in range whenever the guard passed.
  int w = textureSize(v, 0).x;
  return texelFetch(v, ivec2(k % w, k / w), 0).r;
}
`;
}

/**
 * The widths of the `_gpu_atN` helpers `code` calls — ascending and
 * deduplicated, so a helper used many times is declared once. Read off the
 * EMITTED source rather than kept in a per-compilation table, like every other
 * `preambleFor` scan.
 *
 * Anchored on a CALL SITE with a name boundary on both ends: a bare
 * `/_gpu_at(\d+)/` matched a user symbol spelled `_gpu_at5`, and the
 * "helper" it then generated redeclared that name.
 */
export function gpuAtHelperWidths(code: string): number[] {
  return gpuHelperWidths(code, /(?<![\w$])_gpu_at(\d+)\s*\(/g);
}

/**
 * The widths of the `_gpu_texatN` texture helpers `code` calls, read the
 * same way.
 */
export function gpuTexAtHelperWidths(code: string): number[] {
  return gpuHelperWidths(code, /(?<![\w$])_gpu_texat(\d+)\s*\(/g);
}

function gpuHelperWidths(code: string, re: RegExp): number[] {
  const widths = new Set<number>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(code)) !== null) widths.add(Number(m[1]));
  return [...widths].sort((a, b) => a - b);
}
