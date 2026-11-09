// GPU_FUNCTIONS, the table of built-in lowerings, together with the large
// entries (At, Sum and Product, broadcast) that recurse through the table.

import type { Expression } from '../global-types.js';
import type { Type } from '../../common/type/types.js';
import { isCallerMapped } from './cse.js';
import {
  clearGPUCounters,
  gpuIntegerFact,
  recordGPUCounter,
} from './gpu-value-facts.js';
import {
  COLLECTION_SHAPE_TYPE,
  INDEXED_COLLECTION_SHAPE_TYPE,
} from '../../common/type/primitive.js';
import {
  isFunction,
  isNumber,
  isString,
  isSymbol,
} from '../boxed-expression/type-guards.js';
import { rgbToOklch } from '@arnog/colors';
import { gpuAmplifiedTrigMod } from './gpu-exact-trig.js';
import { parseColorString } from '../library/colors.js';
import {
  tryGetConstant,
  foldTerms,
  tryGetComplexParts,
  assertScalarComplexOperand,
  isOpaqueComplexOperand,
  formatFloat,
  gpuNonFiniteLiteral,
  negativeBaseRealPow,
} from './constant-folding.js';
import type { CompileTarget, CompiledFunctions } from './types.js';
import { CompileDeclineError } from './diagnostics.js';
import {
  BaseCompiler,
  explicitBroadcastPointNorm,
  pointHasBroadcastComponent,
  type LoopInvariantBinding,
} from './base-compiler.js';
import {
  resolveTypeAlias,
  resolveTypeForCompiledLanes as resolveTypeForCompilation,
  stripMissingFromType,
} from '../../common/type/utils.js';
import { couldMatch, isSubtype } from '../../common/type/subtype.js';
import { collectBinderNames } from '../boxed-expression/utils.js';
import {
  functionLiteralParameterName,
  isRestParameter,
} from '../boxed-expression/function-literal.js';
import { isBroadcastableCollection } from '../collection-utils.js';
import { literalParamsMap } from '../library/core.js';
import {
  assertNoCurriedApplication,
  isPartialApplication,
  partialApplicationDecline,
} from './partial-application.js';
import { completedLiteralArguments } from './compile-parameter-defaults.js';
import { unrollFits, unrolledTermSize } from './unroll-budget.js';
import { rangeCount } from '../numerics/range-count.js';
import {
  assertGPUScalarComponents,
  declineComplexContinuation,
  gpuAbsorbedConstant,
  gpuBinaryVectorWidth,
  gpuComplexOperand,
  gpuComplexPowLiteral,
  gpuComponentCount,
  gpuDestructuresListOperand,
  gpuImaginaryPiMultiple,
  gpuIsCollectionReduceForm,
  gpuIsComponentwise,
  gpuNaNFor,
  gpuOperandShape,
  gpuPiMultiple,
  gpuReduceTrigOffset,
  gpuResultIsComplexValued,
  gpuRgbBoundary,
  gpuTopLevelCall,
  gpuTupleWithoutShaderType,
  gpuWidenToVector,
  isBroadcastPointNormOperand,
  markAggregateConsuming,
  markOperandConsuming,
} from './gpu-shapes.js';
import {
  GPU_POWI_INLINE_LIMIT,
  GPU_UNROLL_LIMIT,
  assertFiniteGPUBound,
  compileGPUCollectionReduce,
  compileIntArg,
  gpuBinomial,
  gpuBoundConstant,
  gpuBoundIsOneRead,
  gpuFixedPower,
  gpuInvariantDeclaration,
  gpuMultiplicativeFactor,
  gpuReadInvariants,
  readStringLiteral,
} from './gpu-reduce.js';
import { gpuProvablyFinite } from './gpu-finite-proof.js';
import {
  GPU_NAN_SAFE_UNARY,
  GPU_OPERATORS,
  formatGPUNumber,
  gpuAtan2,
  gpuFVec,
  gpuGroup,
  gpuIdentityPassthrough,
  gpuIsAtomicEmission,
  gpuNaN,
  gpuParenthesizeIdentity,
  gpuType,
  gpuVec2,
  gpuVec3,
  gpuVecType,
} from './gpu-emit.js';
import {
  compileGPUPointListAt,
  gpuAtBaseRefs,
  gpuAtBaseShape,
  gpuAtElement,
  gpuAtEntryKind,
  gpuAtFramedIndex,
  gpuAtGather,
  gpuAtSlot,
  gpuIsBoundName,
  gpuPointListAtBase,
  gpuStorageOperandSource,
} from './gpu-at.js';
import { numericLiteralSource } from './compiler-type-facts.js';
import { targetFoldValueImpure } from './compile-folding.js';
import {
  gpuArmDrawsWhileBinding,
  gpuAssertBindingKeepsDrawOrder,
  gpuAssertCallerCodeNotRepeated,
  gpuAssertHoistKeepsCallerOrder,
  gpuOperandOnce,
  gpuReachesCallerCode,
  gpuRecordBoundDraws,
} from './gpu-draw-order.js';
import { gpuDeclaredTypeOf, gpuTypeOfValue } from './gpu-declared-types.js';
import { gpuCheckIdentifier } from './gpu-reserved.js';
import { gpuRoundToInteger, gpuRoundToStep } from './gpu-library.js';
import {
  gpuNaNSafeTernaryCall,
  gpuNaNSafeUnary,
  gpuRealTanh,
  gpuReciprocalComplex,
} from './gpu-nan-safe.js';
import { compilePointSwizzle, gpuSwizzle } from './gpu-points.js';
import { fragmentFactsUnder, fragmentReplaceOperands } from './fragment.js';
import type {
  FragmentLoweringContract,
  FragmentTargetFields,
} from './fragment.js';
import {
  compileGPUElementExtremum,
  compileGPUExtremum,
  compileGPUGcdLcm,
} from './gpu-extrema.js';
import {
  compileGPUConditionalArm,
  compileGPUStatementSelection,
  gpuArmSharesWork,
  gpuAssertSelectableArms,
  gpuCanPlaceStatement,
  gpuConditional,
  gpuNeedsStatements,
  gpuSelectionArm,
  gpuSelectionIsComplex,
  gpuShaderLoopJumps,
} from './gpu-statements.js';
import {
  GPU_COLOR_HEADS,
  GPU_COLOR_SPACES,
  GPU_GAMUT_HELPERS,
  assertNoGPUAlpha,
  gpuColorEntryOperand,
  gpuColorOperand,
  gpuFiniteColorChannels,
} from './gpu-color.js';
import {
  allocGPURandomCounter,
  gpuFoldSeedSource,
  gpuNoIndexingMessage,
  gpuRandomDomainDraw,
  gpuRandomDraw,
  gpuRandomState,
} from './gpu-random.js';

/** The contract of the lowering of the exponent of `e` into a real part and
 *  an angle in half-turns (`Power`). The angle is made as in
 *  `gpuPiMultiple()`, with the canonical constructors, which can join the
 *  powers of one base into a `Power`, a `Sqrt` or a `Root` (`(x/y)/√y`
 *  gives `x / y^{3/2}`, `x·y / y^{3/2}` gives `x / √y`). */
const GPU_EULER_SPLIT: FragmentLoweringContract = {
  name: 'the exponent of e in half-turns',
  operators: ['Add', 'Multiply', 'Divide', 'Negate', 'Power', 'Sqrt', 'Root'],
};

/**
 * GLSL reserved keywords (ES 3.x + desktop) and reserved-for-future-use words.
 * A user variable carrying one of these names cannot be emitted as a bare
 * identifier — the shader would fail to compile — so the target fails closed
 * (D6) rather than silently emit invalid source. Includes type/qualifier
 * keywords, control-flow keywords, and common built-in function names that a
 * bare reference would shadow/collide with (`texture`, `sample`, …).
 */
/**
 * The most elements a shader target inlines into a fixed-size array
 * constructor (`float[n](…)`).
 *
 * Shared by the `Range` handler, which materializes a constant range as such
 * a literal, by the `List`/`Tuple`/`PointList` compilers of the GLSL
 * target (`assertGPUInlineElementCount`), and by
 * `CompileTarget.maxInlineElements`, which bounds constant-collection
 * FOLDING. They must agree: a fold cap below this would refuse a constant
 * collection that the handlers compile happily, and one above it would emit
 * an array the handlers consider too large. Unlike the JavaScript default,
 * this is a capability limit rather than a source-size preference — a
 * dynamic collection has no shader lowering at all, so for a constant one
 * the literal is the only emission that can compile.
 *
 * The shading languages set no bound on a constant array, so the number is
 * this target's own: the driver's compile time grows with the constructor,
 * and whether a constructor of thousands of elements compiles at all is up
 * to the driver. A longer collection is declined, and the decline tells the
 * host to ship it as a texture (`storage: sampler2D`, read with `At`).
 */
export const GPU_MAX_INLINE_ELEMENTS = 256;

/**
 * Decline a constant collection of `count` elements that a shader array
 * constructor would have to hold when `count` is above
 * `GPU_MAX_INLINE_ELEMENTS`. The decline is a `capability` diagnostic with
 * the code `inline-collection-too-large`; its message names the operator
 * (`head`), the element count and the limit, so a host can tell this decline
 * from one it cannot act on and ship the collection as a texture.
 */
export function assertGPUInlineElementCount(head: string, count: number): void {
  if (count <= GPU_MAX_INLINE_ELEMENTS) return;
  throw new CompileDeclineError({
    code: 'inline-collection-too-large',
    kind: 'capability',
    message:
      `Could not compile \`${head}\`: a constant collection of ${count} elements ` +
      `is above the ${GPU_MAX_INLINE_ELEMENTS} elements a shader array constructor ` +
      `takes on this target. Ship the collection as a texture (a \`storage: sampler2D\` ` +
      `input, read with \`At\`) instead.`,
  });
}

/**
 * Lower a `broadcastable` unary head applied to a collection operand
 * (`Sin([1,2,3,4])`, `-[1,2,3,4]`) on a shader target — WITHOUT fanning out.
 *
 * GLSL builtins and operators are already componentwise on a vector
 * (`sin(vec4)` is a `vec4`, `-vec4` is a `vec4`), so the faithful lowering is
 * the head's OWN scalar form applied directly to the vector operand. There is
 * no element loop, no callback and no temporary — the base compiler's former
 * default emitted a JavaScript `.map((v) => …)` arrow here, which no shader
 * compiler accepts.
 *
 * Gated on the operand having a static `vec2`–`vec4` shape
 * (`gpuComponentCount`). Anything else (an unknown-length list, a matrix, a
 * 5+-element list, or a fixed-length list whose elements are not shader
 * floats) has no shader vector value at all, so it fails closed rather
 * than emitting source a driver would reject.
 *
 * The EMITTED lowering is then checked for componentwise safety: most scalar
 * lowerings are built from genType-polymorphic pieces (`sin(v)`, `-v`,
 * `1.0 / sin(v)`, `log(v) / log(10.0)`) and stay valid verbatim on a `vecN`,
 * but three constructs do not — see `gpuIsComponentwise`.
 */
export function compileGPUBroadcastUnary(
  head: string,
  operand: Expression,
  lowering: {
    collection: () => string;
    element: (code: string) => string;
  },
  target: CompileTarget<Expression>
): string {
  const decline = (reason: string): never => {
    throw new Error(`Could not compile \`${head}\`: ${reason}`);
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
  if (gpuComponentCount(operand) === undefined)
    decline(
      `the operand \`${operand.toString()}\` has no static vec2–vec4 shape ` +
        `(an unknown-length list, a matrix, or a 5+-element list), so it is ` +
        `not a shader vector and the componentwise builtins do not apply to it.`
    );
  const vector = lowering.collection();
  // An impure operand (one that draws a random value with `_gpu_rnd_draw`)
  // must be computed once. An element lowering can use its operand twice
  // (`Cot` is `cos(u) / sin(u)`), and on this route it receives a pure
  // placeholder, so its own guard does not apply. Such a lowering declines
  // below. The vector is not bound to a temporary: a hoisted statement runs
  // before the rest of the expression, so its draw would come before the
  // draws written before it, and the random stream would change. Code that
  // the caller supplied (`gpuReachesCallerCode`: `List(W, x, 1)` with
  // `vars: { W: 'nextValue()' }`) can count its calls, so it must run once
  // too, and it declines in the same way. The value of a symbol that reads
  // an input is not emitted, so it is not read (`targetFoldValueImpure`).
  const impure =
    (targetFoldValueImpure(operand, target) ||
      gpuReachesCallerCode(operand, target)) &&
    !/^[A-Za-z_]\w*$/.test(vector);
  // The scalar lowering of `Square` reads the shape of its operand to choose
  // between `_gpu_pow2` and the `vecN` overload `_gpu_pow2_vN`. Here its
  // operand is a placeholder for the vector code, which has no shape, so the
  // scalar helper is chosen and the check below declines it. A `vecN`
  // operand is lowered here as `Power(c, 2)` lowers it: a bare name is
  // multiplied by itself (`*` is componentwise), and any other code goes
  // through the `vecN` overload, which evaluates it once.
  if (head === 'Square')
    return /^[A-Za-z_]\w*$/.test(vector)
      ? `(${vector} * ${vector})`
      : gpuFixedPower(vector, 2, gpuOperandShape(operand));
  const code = lowering.element(vector);
  // The NaN-safe helpers of one operand (`_gpu_sin`, `_gpu_cos`, `_gpu_sign`,
  // `gpuNaNSafeLibrary`) have the same problem, and also a `vecN` form of
  // each width. Each call on the vector code takes the form of its width,
  // which is componentwise, so the check below reads it as the operand.
  // The element lowering sees a placeholder, not the operand, so it cannot
  // prove the operand finite; a vector whose components are all finite for
  // certain (`gpuProvablyFinite`) takes the built-in, which is componentwise.
  const width = gpuComponentCount(operand);
  const finiteOperand = gpuProvablyFinite(operand, target, true);
  let emitted = code;
  let judged = code;
  for (const name of GPU_NAN_SAFE_UNARY) {
    const scalarCall = `_gpu_${name}(${vector})`;
    emitted = emitted
      .split(scalarCall)
      .join(
        finiteOperand ? `${name}(${vector})` : `_gpu_${name}${width}(${vector})`
      );
    judged = judged.split(scalarCall).join(vector);
  }
  // The check reads only the text that the element lowering adds around the
  // operand. The operand's own source is already valid vector code, and it
  // can call scalar helpers on its elements (`vec3(_gpu_max(x, 0.0), …)`,
  // `vec3(_gpu_fmod(x, 2.0), …)`), so each copy of it is replaced by a name
  // that the check accepts. The original code is emitted.
  if (impure && emitted.split(vector).length > 2)
    decline(
      `the operand \`${operand.toString()}\` draws a random value or contains ` +
        `code supplied by the caller, and the lowering \`${code}\` uses it ` +
        `more than once, so each use would run that code again.`
    );
  const unsafe = gpuIsComponentwise(
    judged.split(vector).join('_operand'),
    '_operand'
  );
  if (unsafe !== undefined)
    decline(
      `the scalar shader lowering \`${code}\` is not componentwise — ` +
        `${unsafe} A shader has no element loop, so a non-componentwise ` +
        `lowering cannot be broadcast over a \`vecN\` at all.`
    );
  return emitted;
}

/**
 * `First`, `Second`, `Third` and `Last` on a shader target. Each one reads
 * one element at a fixed position (1, 2, 3 or -1), so it compiles as `At`
 * with that constant index (`compileGPUAt`). `At` knows the shader shape of
 * the operand: a `vecN` element is a swizzle (`p.x`), an element of an array
 * is a subscript (`P[0]` for a list of points `vec2[3]`, `L[6]` for a
 * `float[7]`), and a position past the end is the NaN of an absent value, as
 * in the interpreter (`Third` of a list of 2 points is `Missing`). A swizzle
 * on the compiled operand is not correct for these shapes: `P.x` reads an
 * array of `vec2` as one vector, and `p.z` reads a component that a `vec2`
 * does not have, so the shader is not valid. An operand that `At` cannot
 * index (a list of unknown length, a matrix) declines with the reason of
 * `At`. An operand that is always absent (`Missing`) goes to
 * `At` too, which declines an absent base.
 */
function compileGPUPositional(
  head: 'First' | 'Second' | 'Third' | 'Last',
  arg: Expression,
  compile: (e: Expression) => string,
  target: CompileTarget<Expression>
): string {
  const index = { First: 1, Second: 2, Third: 3, Last: -1 }[head];
  // An operand that can be absent, of type `missing | tuple<real, real>`
  // (`At(P, k)` with `P` a list of points and `k` an integer input). `At`
  // reads the type with the `missing` arm and declines. The shader value of
  // such an operand is a `vecN`: the guarded element helper gives a vector
  // of NaN components for an absent point, and each element of an absent
  // point is NaN in the interpreter (`First(Missing)` is NaN when the
  // element domain is numeric). So an element at a position in the vector
  // is a swizzle of it.
  //
  // A boolean vector (`bvec2`, `vec2<bool>`) is also read with a swizzle,
  // because `At` reads only float components. An operand is a boolean
  // vector when the caller declares it so (a uniform `bvec3 B` for
  // `B: list<boolean^3>`), or when its type is a tuple of 2 to 4 booleans
  // (`b: tuple<boolean, boolean>`): `If(First(b), 1, 0)` is `float(b.x)`.
  // A boolean tuple that can be absent has no NaN to stand for the absent
  // value, so it goes to `At`, which declines.
  //
  // For both, a position past the end (`Third` of a pair) has no component
  // to read, and the operand can have a draw that a constant would drop, so
  // it declines.
  const t = gpuType(arg);
  // The width of a tuple of 2 to 4 booleans, else `undefined`.
  const booleanVectorWidth = (u: Type): number | undefined =>
    typeof u !== 'string' &&
    u.kind === 'tuple' &&
    u.elements.length >= 2 &&
    u.elements.length <= 4 &&
    u.elements.every((el) => isSubtype(el.type, 'boolean'))
      ? u.elements.length
      : undefined;
  let width: number | undefined;
  // A name that the caller declared with a spelling this target does not
  // read (`bool[2]`) has an entry with no `value`. It is not undeclared:
  // the engine type does not tell its shader shape, so it goes to `At`,
  // which declines with the reason of the declaration.
  const declaredEntry = gpuDeclaredTypeOf(arg);
  const declared = declaredEntry?.value;
  if (
    declared !== undefined &&
    declared.element === 'b' &&
    declared.width >= 2 &&
    declared.width <= 4
  )
    width = declared.width;
  // Only a symbol: a constructed boolean tuple (`Tuple(B, C)`) is emitted
  // as a float vector (`vec2(B, C)`), not as a boolean vector.
  else if (
    declaredEntry === undefined &&
    isSymbol(arg) &&
    booleanVectorWidth(t) !== undefined
  )
    width = booleanVectorWidth(t);
  // Only an `At` call (the guarded element helper) or a conditional with no
  // arm for the absent case (`If` with no else branch, `Which`): their
  // shader value is a `vecN` with NaN components when the point is absent.
  // A free symbol or a function call of this type has no such value.
  else if (
    declaredEntry === undefined &&
    (isFunction(arg, 'At') ||
      isFunction(arg, 'If') ||
      isFunction(arg, 'Which')) &&
    typeof t !== 'string' &&
    t.kind === 'union' &&
    t.types.includes('missing')
  ) {
    const present = resolveTypeForCompilation(
      stripMissingFromType({
        kind: 'union',
        types: t.types.filter((arm) => arm !== 'missing'),
      })
    );
    if (
      typeof present !== 'string' &&
      present.kind === 'tuple' &&
      present.elements.length >= 2 &&
      present.elements.length <= 4 &&
      gpuTupleWithoutShaderType(present) === undefined &&
      booleanVectorWidth(present) === undefined
    )
      width = present.elements.length;
  }
  if (width !== undefined) {
    const position = index === -1 ? width : index;
    if (position > width)
      throw new Error(
        `Could not compile \`${head}\`: the operand (type ` +
          `\`${arg.type.toString()}\`) is a vector of ${width} ` +
          `components, which has no element at the position ${position}.`
      );
    return gpuSwizzle(compile(arg), 'xyzw'[position - 1]);
  }
  // A trusted lowering (`fragmentReplaceOperands()`). Input: `First(xs)`,
  // `Last(xs)` (and the other heads that read one fixed position) of a
  // collection that the shader does not hold as a vector. Output:
  // `At(xs, n)` with the number literal `n` (`-1` for the last element).
  // The value is the interpreter's: `At` reads the element at that
  // position, and `xs` is evaluated once. The call documents the lowering
  // and cannot fail: the node is built from the operand and a finite
  // literal, which the contract allows. The value tests "the position of
  // First" and "the position of Last" in the GLSL lane cover it.
  const position = arg.engine.number(index);
  fragmentReplaceOperands(
    arg,
    arg.engine._fn('At', [arg, position]),
    { name: `the position of \`${head}\``, operators: ['At'], nops: 2 },
    target
  );
  try {
    return compileGPUAt([arg, position], compile, target);
  } catch (err) {
    // The decline of `At` names `At`. Give the name of the operator that
    // the source has, and keep the reason.
    if (
      err instanceof Error &&
      !(err instanceof CompileDeclineError) &&
      err.message.startsWith('Could not compile `At`: ')
    )
      throw new Error(
        `Could not compile \`${head}\` (read as \`At\` with the index ` +
          `${index}): ` +
          err.message.slice('Could not compile `At`: '.length)
      );
    throw err;
  }
}

/**
 * `At` on a shader target. Returns the emitted source or throws the
 * fail-closed decline, which names the shape that has no lowering.
 */
function compileGPUAt(
  args: ReadonlyArray<Expression>,
  compile: (e: Expression) => string,
  target: CompileTarget<Expression>
): string {
  // Annotated (rather than inferred) so a `decline(…)` call narrows what
  // follows it — the `gpuCheckOperandShapes` convention.
  const decline: (reason: string) => never = (reason) => {
    throw new Error(`Could not compile \`At\`: ${reason}.`);
  };

  if (args.length < 2) decline('it has no index operand');
  if (args.length > 2)
    decline(
      `this lowering reads one index, and it was given ` +
        `${args.length - 1}. The compiler rewrites a chained access ` +
        `\`At(x, i, j)\` to the nested access \`At(At(x, i), j)\` before it ` +
        `calls this lowering`
    );

  const base = args[0];
  const index = args[1];

  // A list of points: the result is a point, a `vecM`, and an absent point is
  // a vector of NaN components (`compileGPUPointListAt`).
  const points =
    isSymbol(base) && target.storage?.get(base.symbol) !== undefined
      ? undefined
      : gpuPointListAtBase(base, compile);
  if (points !== undefined) {
    if ('decline' in points) decline(points.decline);
    if (!base.isPure && !index.isPure)
      decline(
        'both the base and the index are impure, and GLSL does not ' +
          'specify the order in which a call evaluates its ' +
          'arguments'
      );
    return compileGPUPointListAt(points, base, index, compile, target, decline);
  }

  const shape = gpuAtBaseShape(base, target);
  if ('decline' in shape) decline(shape.decline);
  const n = shape.count;
  // The storage kind of a sampler-backed base (`storage` compile option).
  // Such a base has no shader VALUE, so every tier reads it through the
  // texel-fetch helper: the dynamic index as one guarded call, a static index
  // as the same call with a literal index (the coordinate is computed at run
  // time from the texture's width, so nothing folds to a constant), and a
  // gather or mask as a vector constructor of one call per selected slot —
  // where the array form folds to subscripts and swizzles.
  const storage = shape.storage;
  // The emitted source of the sampler-backed base, computed once on first
  // use (a gather reads it once per slot) and never on a path that folds
  // the access to NaN without emitting the base.
  let texAtSource: string | undefined;
  const texAtCall = (floatIndex: string): string => {
    texAtSource ??= gpuStorageOperandSource(
      base as Expression & { symbol: string },
      compile
    );
    const src = texAtSource;
    return `_gpu_texat${n}(${src}, ${floatIndex})`;
  };

  // Evaluate-once. GLSL does not specify the evaluation ORDER of a call's
  // arguments, so two impure operands could commute between drivers.
  if (!base.isPure && !index.isPure)
    decline(
      'both the base and the index are impure, and GLSL does not ' +
        'specify the order in which a call evaluates its arguments'
    );
  // An emission that DISCARDS the base entirely (an all-out-of-range gather)
  // or references the base source MORE THAN ONCE (a mixed gather constructor)
  // needs the base to be pure.
  const literalOps =
    isFunction(base, 'List') || isFunction(base, 'Tuple')
      ? base.ops!
      : undefined;
  const isLiteralBase = literalOps !== undefined;
  const requirePureBase = (why: string): void => {
    if (!base.isPure) decline(why);
  };
  // A LITERAL base folds PER ELEMENT — the selected element is emitted, the
  // siblings are dropped — so the purity question is per element too. Asking
  // it of the whole literal over-declined `At([Random(), 1, 2], 1)`, whose
  // emission evaluates the draw exactly once, which is what the source says.
  // An element the emission omits must be pure (a dropped draw shifts the
  // shader's random stream), and an impure one may not be selected twice (that
  // would evaluate it twice, where the source has one element).
  const requireLiteralBaseElements = (
    selected: ReadonlyArray<number>,
    what: 'access' | 'gather'
  ): void => {
    const ops = literalOps!;
    for (let i = 0; i < ops.length; i++) {
      if (ops[i].isPure) continue;
      const refs = selected.filter((s) => s === i).length;
      if (refs === 0)
        decline(
          `element ${i + 1} of the literal base is impure and the ${what} ` +
            `does not select it, so folding would discard it unevaluated`
        );
      if (refs > 1)
        decline(
          `element ${i + 1} of the literal base is impure and the ${what} ` +
            `selects it ${refs} times, which would evaluate it more than once`
        );
    }
  };
  // A fold to the NaN spelling omits an operand from the OUTPUT ENTIRELY, so
  // it must not omit an impure one: the dropped draw never happens, which
  // shifts the shader's random stream (the `gpuConditionalOperand` rationale).
  const requirePureFold = (what: 'base' | 'index'): void => {
    if ((what === 'base' ? base : index).isPure) return;
    decline(
      `the access folds to the NaN spelling, which would DISCARD the impure ` +
        `${what} unevaluated`
    );
  };

  // ---- Collection index: the gather / mask tiers (design § D2) ------------
  if (isFunction(index, 'List')) {
    const entries = index.ops!;
    const kinds = entries.map(gpuAtEntryKind);

    const bad = kinds.indexOf('other-literal');
    if (bad >= 0)
      decline(
        `entry ${bad + 1} of the index list ` +
          `(\`${entries[bad].toString()}\`) is a literal that is not an ` +
          `integer, so it selects no element and the list is not an index ` +
          `gather at all`
      );

    const set = new Set(kinds);
    const numeric = set.has('int') || set.has('dyn');
    const boolean = set.has('bool') || set.has('dyn-bool');
    if (numeric && boolean)
      decline(
        'the index list mixes integer entries with boolean ones, so it is ' +
          'neither a gather nor a mask'
      );
    if (set.has('dyn-bool'))
      decline(
        'the index is a boolean mask with runtime-valued entries: its ' +
          'result LENGTH depends on how many of them are true at run time, ' +
          'so it has no static shader value shape. This shape has no shader ' +
          'lowering at all — it is not a missing tier'
      );

    // Resolve the selected 0-based slots. A literal mask is statically a
    // gather (its length must EQUAL the base's, as the interpreter requires);
    // a literal integer list gathers position-preservingly.
    let slots: (number | null)[];
    if (set.has('bool')) {
      if (entries.length !== n)
        decline(
          `the index is a boolean mask of length ${entries.length}, but the ` +
            `base has ${n} elements — a mask's length must equal the ` +
            `collection's`
        );
      slots = [];
      entries.forEach((e, i) => {
        if (isSymbol(e, 'True')) slots.push(i);
      });
    } else if (set.has('dyn')) {
      // The count is of the RUNTIME-VALUED entries, not of the list: a mixed
      // `[1, k]` has one, and reporting the list's length described a shape
      // the caller did not write.
      const dyn = kinds.filter((k) => k === 'dyn').length;
      decline(
        `the index list has ${dyn} runtime-valued integer ` +
          `${dyn === 1 ? 'entry' : 'entries'}; a static-count DYNAMIC gather ` +
          `is not lowered in this version (no witness requested it yet) — the ` +
          `helpers it needs are the same ones the scalar form already emits`
      );
      slots = [];
    } else {
      slots = entries.map((e) => gpuAtSlot((e as any).re as number, n));
    }

    const w = slots.length;
    if (w === 0)
      decline(
        'the index selects 0 elements, and GLSL has no ' +
          'zero-length value type'
      );
    if (w === 1)
      decline(
        'the index selects exactly 1 element, which CE types as a 1-element ' +
          'LIST (pinned: `At(L, [2])` → `[20]`), and no shader value has ' +
          'that shape — there is no `vec1`'
      );
    if (w > 4)
      decline(
        `the index selects ${w} elements, so the RESULT would be a ` +
          `\`vec${w}\`, and a shader vector holds 2 to 4`
      );

    // A sampler-backed base: one guarded texel read per selected slot (the
    // base is a symbol, so pure; an out-of-range slot is the NaN spelling,
    // as in the array form). The helper takes the 1-based index.
    if (storage !== undefined) {
      const ctor = `vec${w}`;
      const parts = slots.map((slot) =>
        slot === null
          ? gpuNaN(target)
          : texAtCall(formatFloat(slot + 1, target.language))
      );
      return `${ctor}(${parts.join(', ')})`;
    }
    if (isLiteralBase)
      requireLiteralBaseElements(
        slots.filter((s): s is number => s !== null),
        'gather'
      );
    else {
      // Judged on the emission `gpuAtGather` will actually take: a swizzle
      // references the base once whatever it selects, a constructor once per
      // in-range slot — and an ALL-out-of-range gather not at all.
      const refs = gpuAtBaseRefs(base, slots, n);
      if (refs === 0)
        requirePureBase(
          'the gather selects no element of the base, so its emission would ' +
            'DISCARD the impure base unevaluated'
        );
      else if (refs > 1)
        requirePureBase(
          'the gather emits a constructor that references the impure base ' +
            'more than once, which would evaluate it more than once'
        );
    }

    return gpuAtGather(base, slots, n, compile, target);
  }

  // ---- Scalar index (design § D1) ----------------------------------------
  const it = gpuType(index);

  // The absence marker itself: the interpreter has no value to index with, and
  // the numeric projection of "no value" is NaN. The fold emits neither
  // operand, so neither may be impure. Both symbols that name an absent datum
  // are read alike (user ruling of 2026-09-22).
  if (isSymbol(index, 'Missing') || isSubtype(it, 'missing')) {
    requirePureFold('base');
    requirePureFold('index');
    return gpuNaN(target);
  }

  // A string KEY. Only a dictionary base takes one (and that base has already
  // declined above), so on a positional base it is the wrong index domain
  // outright — named separately from the type-based decline below, which
  // covers a symbol merely DECLARED `string`.
  if (isString(index))
    decline(
      'the index is a string key, and only a dictionary base takes one — a ' +
        'positional shader access indexes by number'
    );

  if (BaseCompiler.isComplexValued(index))
    decline(
      'the index is a complex value, which lowers to a `vec2(re, im)`; the ' +
        'interpreter reads its real part, and a shader has no such reading ' +
        'of a vector in an index position'
    );

  // A CALLER-DECLARED name, whose declared shader type is the only reading of
  // it there is — asked ahead of the type-based readings below, which see the
  // undeclared engine symbol's type.
  const framedIndex = gpuAtFramedIndex(index);
  if (framedIndex !== undefined && 'decline' in framedIndex)
    decline(framedIndex.decline);

  // A literal real index resolves against N at compile time — zero runtime
  // cost, and `0` / out of range / non-integer / non-finite fold straight to
  // the NaN spelling. Over a texture an in-range index cannot fold to a
  // constant texel coordinate, because the texture width is not known at
  // compile time (it is read at run time inside the helper): its texel form
  // is the guarded read with the literal index.
  if (isNumber(index)) {
    const j = gpuAtSlot(index.re, n);
    if (j === null) {
      // The fold emits neither operand (the index is a literal, so pure).
      requirePureFold('base');
      return gpuNaN(target);
    }
    if (storage !== undefined)
      return texAtCall(formatFloat(index.re, target.language));
    if (isLiteralBase) requireLiteralBaseElements([j], 'access');
    return gpuAtElement(base, j, n, compile);
  }

  // A collection-typed index that is NOT a literal list: there is no tier for
  // it (its entries are not readable at compile time). A STRING is excluded:
  // it matches `collection` in the lattice (its elements are its grapheme
  // clusters) but this target has no strings at all, so the honest diagnostic
  // is the "provably not a number" one below, which names the type — the
  // diagnostic a string index has always received.
  if (isSubtype(it, COLLECTION_SHAPE_TYPE) && !isSubtype(it, 'string')) {
    const k = BaseCompiler.aggregateComponentCount(index);
    // A NEGATIVE count is the type builder's encoding of an UNKNOWN extent
    // (`list<number^?>` → `dimensions: [-1]`), not a width — the same reading
    // the base side already takes. Without this it flowed on as a count and
    // described "a collection of -1 runtime-valued entries" in a
    // demand-gated text, when the shape is the PERMANENT no-static-count
    // decline (design § D4).
    if (k === undefined || k < 0)
      decline(
        `the index is a collection (type \`${index.type.toString()}\`) with ` +
          `no statically known length, so there is no static count to emit ` +
          `a result shape against`
      );
    decline(
      `the index is a collection of ${k} runtime-valued entries; a ` +
        `static-count DYNAMIC gather is not lowered in this version (no ` +
        `witness requested it yet)`
    );
  }

  // `unknown`/`value`-typed parameters are numeric on this target (the
  // compile model's unknown-as-numeric-parameter rule — the witness's loop
  // variable routinely types as a wide union). Only a PROVABLY non-numeric
  // index declines, and it names the type.
  if (!couldMatch(it, 'number'))
    decline(
      `the index (type \`${index.type.toString()}\`) is provably not a ` +
        `number, so it selects no element and \`At\` has no value to project`
    );

  let baseCode: string | undefined;
  const compileBase = (): string => (baseCode ??= compile(base));

  // A proven positive, in-range integer needs neither a guard nor a float
  // conversion. Textures retain their storage helper.
  const fact = gpuIntegerFact(
    index,
    target,
    (op) =>
      !target.foldExcludedOps?.has(op) &&
      target.operators?.(op) === GPU_OPERATORS[op] &&
      target.functions?.(op) === GPU_FUNCTIONS[op]
  );
  if (storage === undefined && fact && fact.min >= 1 && fact.max <= n) {
    const code = compileBase();
    return `${gpuIsAtomicEmission(code) ? code : `(${code})`}[${fact.code} - 1]`;
  }

  // Dynamic index: one call, so the base and the index are each evaluated
  // exactly once. The guard inside the helper is what makes the GLSL
  // out-of-bounds rules unreachable. A caller-declared INTEGER index is
  // converted at the call site — the guard runs entirely in float space.
  const idx = compile(index);
  const floatIdx = framedIndex === undefined ? idx : `float(${idx})`;
  if (storage === undefined || !isSymbol(base))
    return `_gpu_at${n}(${compileBase()}, ${floatIdx})`;

  // A sampler-backed base: the same call shape and the same index contract,
  // through the texel-fetch helper (`texAtCall`).
  return texAtCall(floatIdx);
}

/** Opaque source or effects in the body may change a compiler-owned counter. */
function gpuCounterIsStable(
  expr: Expression,
  index: string,
  target: CompileTarget<Expression>,
  depth = 0
): boolean {
  if (depth > 64) return false;
  if (isNumber(expr)) return true;
  if (isSymbol(expr)) {
    if (expr.symbol === index) return true;
    // A symbol in shader storage (`storage` hint) is read only through a
    // helper that writes no variable, and its own emission is refused
    // outside such a read (`gpuRefuseStorageReference`).
    if (
      target.storage?.get(expr.symbol) !== undefined &&
      !gpuIsBoundName(expr.symbol, target)
    )
      return true;
    const ref = target.var(expr.symbol);
    return (
      !target.varsKeys?.has(expr.symbol) &&
      (ref === undefined || gpuIsAtomicEmission(ref))
    );
  }
  if (
    !isFunction(expr) ||
    !expr.isPure ||
    isCallerMapped(expr) ||
    target.foldExcludedOps?.has(expr.operator)
  )
    return false;
  const fn = GPU_FUNCTIONS[expr.operator];
  const op = GPU_OPERATORS[expr.operator];
  if (
    (fn === undefined && op === undefined) ||
    target.functions?.(expr.operator) !== fn ||
    (op !== undefined && target.operators?.(expr.operator) !== op)
  )
    return false;
  return expr.ops.every((x) => gpuCounterIsStable(x, index, target, depth + 1));
}

/**
 * Compile a Sum or Product expression for GPU targets.
 *
 * Two compilation strategies:
 * - **Unrolled** (constant bounds, range ≤ GPU_UNROLL_LIMIT): pure inline
 *   expression with no statements, usable as a subexpression.
 * - **For-loop** (large or symbolic bounds): multi-line statement block
 *   ending with `return <acc>`, suitable for `compileFunction`.
 *
 * A complex-valued body accumulates in a `vec2(re, im)` on both strategies.
 * A complex sum adds the terms component-wise (`+` on two `vec2`). A complex
 * product multiplies them with the `_gpu_cmul` helper of the complex
 * preamble, because `*` on two `vec2` is the component-wise product, not the
 * complex one. The empty range answers the complex identity, `vec2(0.0, 0.0)`
 * or `vec2(1.0, 0.0)`.
 */
function compileGPUSumProduct(
  kind: 'Sum' | 'Product',
  args: ReadonlyArray<Expression>,
  _compile: (expr: Expression) => string,
  target: CompileTarget<Expression>
): string {
  if (!args[0]) throw new Error(`Could not compile \`${kind}\`: no body`);
  // No indexing set: the operand IS the collection to reduce
  // (`Sum([3, 4, 5])`), not a body indexed by one.
  if (!args[1])
    return compileGPUCollectionReduce(kind, args[0], _compile, target);

  // Reject a collection-valued body for the indexed form (see
  // `BaseCompiler.assertScalarBigOpBody`): scalar accumulation over arrays
  // would silently produce a wrong value. Reached only for the indexed form
  // (the `!args[1]` guard above returns for the reduce form).
  BaseCompiler.assertScalarBigOpBody(kind, args[0]);

  // A multi-index Sum/Product (more than one indexing set) is the nest of
  // one aggregate per index, the first index outermost: the body of the
  // outer aggregate is the aggregate over the other indexes, whose bounds
  // can read the outer index. The value is the sum (or product) of the same
  // terms, which the interpreter visits with the first index outermost too.
  //
  // A trusted lowering (`fragmentReplaceOperands()`). Input:
  // `Sum(body, L1, L2, …)`. Output: `Sum(Sum(body, L2, …), L1)` (the same for
  // `Product`). Condition: more than one index set. The value is the
  // interpreter's, as said above; the body and each bound are evaluated as
  // many times as in the interpreter.
  if (args.length > 2)
    return compileGPUSumProduct(
      kind,
      [
        fragmentReplaceOperands(
          args,
          args[0].engine._fn(kind, [args[0], ...args.slice(2)]),
          { name: `the nest of a multi-index \`${kind}\``, operators: [kind] },
          target
        ),
        args[1],
      ],
      _compile,
      target
    );

  // A `Range` index set with a step of 1 (`Element(k, Range(a, b))`) is the
  // `Limits(k, a, b)` of the interpreter: the same integers, in the same
  // order.
  //
  // A trusted lowering (`fragmentReplaceOperands()`). Input:
  // `Element(k, Range(a, b))` or `Element(k, Range(a, b, 1))`. Output:
  // `Limits(k, a, b)`. The bounds `a` and `b` are the operands of the
  // `Range`, evaluated once each, as before.
  const limitsExpr =
    isFunction(args[1], 'Element') &&
    isSymbol(args[1].op1) &&
    isFunction(args[1].op2, 'Range') &&
    (args[1].op2.nops === 2 ||
      (args[1].op2.nops === 3 && args[1].op2.op3.re === 1))
      ? fragmentReplaceOperands(
          args[1],
          args[1].engine._fn('Limits', [
            args[1].op1,
            args[1].op2.op1,
            args[1].op2.op2,
          ]),
          { name: 'a `Range` index set', operators: ['Limits'], nops: 3 },
          target
        )
      : args[1];
  if (!isFunction(limitsExpr, 'Limits'))
    throw new Error(
      `Could not compile \`${kind}\`: expected Limits indexing set`
    );

  const limitsOps = limitsExpr.ops;
  const index = isSymbol(limitsOps[0]) ? limitsOps[0].symbol : '_';
  // The index is an integer loop counter, so the body is analyzed with the
  // index read as a real scalar. The plain `isComplexValued` reads the index
  // through the enclosing scope instead: in a `Block` with a complex local
  // `n`, the body `n` of `Product(n, Limits(n, 1, m))` would then be complex,
  // the accumulator a `vec2`, and the loop would pass the scalar `float(n)`
  // to `_gpu_cmul`, which the shader compiler rejects.
  const complex = BaseCompiler.isComplexValuedUnderIndices(args[0], [index]);
  // The body is emitted under the same reading of the index, so each term
  // has the type of the accumulator: without this frame the emission of `n²`
  // reads the outer complex `n` and calls `_gpu_cpow` on a `float`.
  const underRealIndex = <T>(fn: () => T): T =>
    BaseCompiler.withRealLoopIndices([index], fn);
  assertFiniteGPUBound(kind, limitsOps[1], 'lower');
  assertFiniteGPUBound(kind, limitsOps[2], 'upper');
  // A bound mentioning a compile-bound name (a user function's parameter, an
  // enclosing binder's index) is NOT a compile-time constant — see
  // `BaseCompiler.bigOpBoundConstant`. Reading one folded
  // `F(i) = Σ_{m=1..i} m` to `float _fn_F(float i) { return 0.0; }`.
  const lowerNum = gpuBoundConstant(limitsOps[1], target);
  const upperNum = gpuBoundConstant(limitsOps[2], target);
  BaseCompiler.assertSafeBigOpBounds(
    kind,
    [limitsOps[1], limitsOps[2]],
    target
  );

  const isSum = kind === 'Sum';
  const op = isSum ? '+' : '*';
  const v2 = gpuVec2();
  // A body that is a vector (`k·uv` with `vec2 uv`) gives a vector sum, so
  // the accumulator is a vector of the same width: a `float` accumulator
  // would not accept the terms. The `+` and `*` of two vectors are component
  // by component in GLSL, as the sum and the product of the
  // engine are for a point. A body of another width (an array) has no
  // accumulator, and the compilation fails.
  const width = complex
    ? undefined
    : underRealIndex(() => BaseCompiler.aggregateComponentCount(args[0]));
  if (width !== undefined && (width < 2 || width > 4))
    throw new Error(
      `Could not compile \`${kind}\`: each term is a list of ${width} ` +
        `elements, and a shader has no accumulator for a list of that length ` +
        `(only a vector of 2 to 4 components).`
    );
  const identity = complex
    ? `${v2}(${isSum ? '0.0' : '1.0'}, 0.0)`
    : width !== undefined
      ? `${gpuVecType(width)}(${isSum ? '0.0' : '1.0'})`
      : isSum
        ? '0.0'
        : '1.0';
  // The shader type of the accumulator and of a term bound to a temporary.
  const valueType = complex
    ? gpuVecType(2)
    : width !== undefined
      ? gpuVecType(width)
      : 'float';
  // Combine two values of the body's type: the complex product is not the
  // component-wise `*` of two `vec2`.
  const combine = (a: string, b: string): string =>
    complex && !isSum ? `_gpu_cmul(${a}, ${b})` : `${a} ${op} ${b}`;
  const bothConstant = lowerNum !== undefined && upperNum !== undefined;

  if (bothConstant && lowerNum > upperNum) return identity;

  const canProveCounter = gpuCounterIsStable(args[0], index, target);

  // Unroll small constant ranges — pure inline expression
  // A clause whose terms would hold too many nodes in all is a loop
  // (`unroll-budget.ts`).
  if (
    bothConstant &&
    unrollFits(
      upperNum - lowerNum + 1,
      unrolledTermSize(args[0]),
      GPU_UNROLL_LIMIT
    )
  ) {
    const emitTerms = (
      invariants: ReadonlyArray<LoopInvariantBinding>
    ): string => {
      // A subexpression the terms all share because it mentions no index is
      // declared once, ahead of them. Every unrolled term runs, so the local is
      // evaluated exactly when the terms are. The declarations are inserted
      // at this position of the sink once the terms are compiled, so that a
      // binding no term reads is left out (`gpuReadInvariants`).
      const sink = target.hoist?.stmts;
      const declarationsAt = sink?.length ?? 0;
      const terms: string[] = [];
      // How many terms stay in the expression and how many are computed in
      // hoisted statements (checked after the loop).
      let inlineTerms = 0;
      let hoistedTerms = 0;
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
        const termScope = BaseCompiler.withBoundScope(target, [index]);
        const termBoundVars = termScope.boundVars;
        const termSink = {
          stmts: [] as string[],
          boundVars: termBoundVars,
          unit: args[0],
        };
        const innerTarget: CompileTarget<Expression> = {
          ...target,
          var: (id) => (id === index ? kStr : target.var(id)),
          ...termScope,
          hoist: BaseCompiler.canHoist(target) ? termSink : undefined,
        };
        if (canProveCounter)
          recordGPUCounter(innerTarget, index, k, k, String(k));
        let code: string;
        try {
          // Each term must leave a value after any nested loops are hoisted.
          code = underRealIndex(() =>
            BaseCompiler.compileValueOperand(args[0], innerTarget)
          );
        } finally {
          clearGPUCounters(innerTarget);
        }
        if (termSink.stmts.length === 0) {
          inlineTerms += 1;
          terms.push(`(${code})`);
          continue;
        }
        hoistedTerms += 1;
        // The sink is non-empty only when `canHoist(target)` held above.
        //
        // A term whose value is already a bare name — a block term stores its
        // value in a temporary the hoisted statements declare (`valueBlock`)
        // — is read through that name; binding it again would only copy it.
        // The term's statements run ahead of the enclosing statement, so a
        // draw among them must not come before a draw written before the
        // `Sum`.
        if (BaseCompiler.foldValueImpure(args[0]))
          gpuAssertBindingKeepsDrawOrder(kind, [args[0]], target);
        gpuAssertHoistKeepsCallerOrder(kind, [args[0]], target);
        if (/^[A-Za-z_$][\w$]*$/.test(code)) {
          BaseCompiler.hoistStatement(target, ...termSink.stmts);
          if (BaseCompiler.foldValueImpure(args[0]))
            gpuRecordBoundDraws([args[0]], target);
          terms.push(`(${code})`);
          continue;
        }
        const tv = BaseCompiler.tempVar(target);
        const decl = `${valueType} ${tv}`;
        BaseCompiler.hoistStatement(
          target,
          ...termSink.stmts,
          `${decl} = ${code};`
        );
        if (BaseCompiler.foldValueImpure(args[0]))
          gpuRecordBoundDraws([args[0]], target);
        terms.push(`(${tv})`);
      }
      // The statements of a hoisted term run ahead of the whole expression,
      // so with some terms hoisted and others inline, the caller code of a
      // later hoisted term would run before that of an earlier inline term.
      // When every term hoists, the terms run in order.
      if (
        inlineTerms > 0 &&
        hoistedTerms > 0 &&
        gpuReachesCallerCode(args[0], target)
      )
        throw new Error(
          `Could not compile \`${kind}\`: some unrolled terms are computed in ` +
            'statements ahead of the expression and others stay in it, and ' +
            'code supplied by the caller (a `vars` source, a `functions` or ' +
            '`operators` entry, or a `compile` handler) in the terms would ' +
            'then run out of the order of the interpreter.'
        );
      const result = `(${terms.reduce((a, b) => combine(a, b))})`;
      if (sink !== undefined && invariants.length > 0)
        sink.splice(
          declarationsAt,
          0,
          ...gpuReadInvariants(invariants, [
            result,
            ...sink.slice(declarationsAt),
          ]).map(([name, code, node]) =>
            gpuInvariantDeclaration(name, code, node)
          )
        );
      return result;
    };
    // The bindings are STATEMENTS, so they can only be emitted where the
    // enclosing position accepts hoisted statements. Without a sink the
    // unrolled expression stands alone and every term keeps its own copy of
    // the shared subexpression, exactly as before.
    if (!BaseCompiler.canHoist(target)) return emitTerms([]);
    return BaseCompiler.hoistLoopInvariants(
      args[0],
      [index],
      target,
      emitTerms,
      (node) => gpuTypeOfValue(node) !== undefined
    ).result;
  }

  // For-loop form. A shader has no expression-level loop, so this emits
  // STATEMENTS. When the enclosing position accepts hoisted statements (Tycho
  // item 110) they go to the sink and the loop's accumulator is returned as an
  // ordinary expression — so `1 + \sum…` and `0.03\sum…` compose. Otherwise the
  // legacy bare block is returned, valid only as a top-level function body.
  const acc = BaseCompiler.tempVar(target);
  const intType = 'int';

  // The loop counter is a signed 32-bit integer (`int`). A constant bound is written into the loop header as an integer
  // literal, so it must fit that type, and the last increment, `upper + 1`,
  // must fit too: at an upper bound of 2147483647 the counter overflows and
  // the condition `index <= upper` stays true, so the loop does not end. A
  // bound out of range fails the compilation, and the caller can use the
  // interpreter. A literal bound reaches this point without the range check
  // of `gpuBoundConstant`, which applies only to a folded bound.
  const I32_MIN = -(2 ** 31);
  const I32_MAX = 2 ** 31 - 1;
  for (const [which, bound, max] of [
    ['lower', lowerNum, I32_MAX],
    ['upper', upperNum, I32_MAX - 1],
  ] as const) {
    if (bound !== undefined && (bound < I32_MIN || bound > max))
      throw new Error(
        `Could not compile \`${kind}\`: the ${which} bound ${bound} is outside ` +
          `the range of the 32-bit loop counter (${I32_MIN} to ${max}).`
      );
  }

  // The body binds `index`, so it gets its OWN sink: a statement it hoists
  // belongs inside this loop (a nested Sum), not ahead of it.
  const bodyScope = BaseCompiler.withBoundScope(target, [index]);
  const bodyBoundVars = bodyScope.boundVars;
  const bodySink = {
    stmts: [] as string[],
    boundVars: bodyBoundVars,
    unit: args[0],
  };
  const bodyTarget: CompileTarget<Expression> = {
    ...target,
    var: (id) => (id === index ? `float(${index})` : target.var(id)),
    ...bodyScope,
    hoist: bodySink,
  };
  if (canProveCounter && bothConstant)
    recordGPUCounter(bodyTarget, index, lowerNum, upperNum, index);
  // A subexpression of the body that mentions the index nowhere has the same
  // value in every iteration, so it is computed ONCE, in a local declared
  // ahead of the loop, and the body reads that local. Without this the body's
  // own temporaries are all declared INSIDE the loop and re-evaluated per
  // iteration — the Tycho code-generation audit of 2026-09-08 measured a
  // heat-map body whose fifteen locals were index-free to the last one.
  //
  // Unlike the JavaScript and interval targets this needs no empty-range
  // exit. Those guard against an error a binding raises when the loop body
  // never ran; shader arithmetic raises nothing (a division by zero answers an
  // infinity, an out-of-domain call a NaN), so evaluating an invariant whose
  // loop turns out to run zero times computes a value nobody reads.
  const { bindings: invariants, result: body } =
    BaseCompiler.hoistLoopInvariants(
      args[0],
      [index],
      target,
      () =>
        underRealIndex(() => {
          try {
            if (target.cse?.enabled) {
              BaseCompiler.openCseSession(
                args[0],
                bodyTarget,
                target.cse.harvestOptions
              );
              return BaseCompiler.compileCseRoot(args[0], bodyTarget, 0, () =>
                BaseCompiler.compileValueOperand(args[0], bodyTarget)
              );
            }
            return BaseCompiler.compileValueOperand(args[0], bodyTarget);
          } finally {
            clearGPUCounters(bodyTarget);
          }
        }),
      (node) => gpuTypeOfValue(node) !== undefined
    );

  // Compiled BEFORE the loop statements are pushed, so anything the bounds
  // themselves hoist lands ahead of the loop that consumes them.
  //
  // The counter is declared as an integer, but a non-literal bound normally
  // compiles to a FLOAT expression (shader scalar math is float, and a
  // constant-folded `Length(L)` is spelled `3.0`). GLSL ES does not
  // promote int to float, so `int j = K; j <= K + -1.0` is a driver-side
  // type error that rejects the whole shader behind `success: true` (Tycho
  // item 191). Convert such a bound to the counter's type in the header —
  // `int(floor(x))` — flooring first so a non-integer bound
  // reads the way the JavaScript target's `Math.floor(bound)` and the
  // constant arm's `Math.floor` (`BaseCompiler.bigOpBoundConstant`) do
  // (`int(x)` alone truncates toward zero, disagreeing for a negative bound).
  //
  // The exception is a bound that is ALREADY a shader integer: a name the
  // caller declared `int` (a `compileFunction` parameter, a shader
  // uniform). Ordinary references to it go through a float conversion
  // (`gpuDeclaredBodyTarget`), which the header does not want — `floor()`
  // takes only a float, and `int(floor(float(K)))` is a needless round trip
  // — so such a bound is used bare (a `uint` is converted with
  // `int(K)`, no flooring needed). A declared bound with any other
  // type (`bool`, a vector) is no loop bound at all and fails closed.
  const boundCode = (bound: Expression, which: 'lower' | 'upper'): string => {
    const declared = gpuDeclaredTypeOf(bound);
    const value = declared?.value;
    if (
      declared === undefined ||
      (value !== undefined && value.width === 1 && value.element === 'f')
    ) {
      const code = BaseCompiler.compile(bound, target);
      return `int(floor(${code}))`;
    }
    // `var()` binds an integer-declared scalar to `float(K)`; the header wants
    // the integer itself, so it reads the raw slot.
    if (value !== undefined && value.width === 1 && value.element === 'i')
      return declared.ref;
    if (value !== undefined && value.width === 1 && value.element === 'u')
      return `int(${declared.ref})`;
    throw new Error(
      `Could not compile \`${kind}\`: the ${which} bound \`${bound.toString()}\` is declared ` +
        `"${declared.spelling}" by the caller, which is not ` +
        `a scalar number — a loop bound must be one.`
    );
  };
  const lowerStr =
    lowerNum !== undefined
      ? String(lowerNum)
      : boundCode(limitsOps[1], 'lower');
  const upperStr =
    upperNum !== undefined
      ? String(upperNum)
      : boundCode(limitsOps[2], 'upper');

  // The loop index is declared and referenced bare — reject a reserved name
  // (fail closed, D6) rather than emit a shader that fails to compile.
  gpuCheckIdentifier(index, target.language);
  const accDecl = `${valueType} ${acc}`;
  const indexDecl = `${intType} ${index}`;
  const passCount = gpuPassCountStatement(target);

  // A COMPUTED upper bound is bound to a local first. GLSL evaluates
  // the loop condition on every iteration, so leaving the expression there
  // recomputes it once per step — `n <= int(floor(K + -1.0))` runs the
  // addition and the `floor` as many times as the loop runs. A bound that is
  // already ONE READ (a literal, a bare name, a conversion around one of
  // those) is left in place: a local would only add a line and hide which
  // name the header tests.
  //
  // The exception is a one read of a name equal to the name of the index.
  // The loop condition is in the scope of the counter, so there the name
  // reads the counter, not the outer variable that the bound reads
  // (`Sum(j, Limits(j, 1, j))` with an outer `j` gave
  // `for (int j = 1; j <= int(floor(j)); j++)`). The code of a one read
  // holds exactly one name that is not a conversion or a rounding, its last
  // identifier, so this test is exact; any other bound gets a local anyway.
  // The lower bound needs no local: it is the initializer of the counter,
  // and in GLSL the scope of a declared name starts after its
  // initializer.
  const readsIndex = (code: string): boolean =>
    /([A-Za-z_]\w*)\)*$/.exec(code.trim())?.[1] === index;
  const boundVar =
    upperNum === undefined &&
    (!gpuBoundIsOneRead(upperStr) || readsIndex(upperStr))
      ? BaseCompiler.tempVar(target)
      : '';
  const boundDecl =
    boundVar === '' ? [] : [`${intType} ${boundVar} = ${upperStr};`];
  const upperRef = boundVar === '' ? upperStr : boundVar;

  const loop = [
    ...boundDecl,
    ...gpuReadInvariants(invariants, [body, ...bodySink.stmts]).map(
      ([name, code, node]) => gpuInvariantDeclaration(name, code, node)
    ),
    `${accDecl} = ${identity};`,
    `for (${indexDecl} = ${lowerStr}; ${index} <= ${upperRef}; ${index}++) {`,
    // The pass cap of the evaluation (`gpuPassCountStatement`).
    ...(passCount === undefined ? [] : [`  ${passCount}`]),
    ...bodySink.stmts.map((s) =>
      s
        .split('\n')
        .map((l) => `  ${l}`)
        .join('\n')
    ),
    complex && !isSum
      ? `  ${acc} = ${combine(acc, body)};`
      : `  ${acc} ${op}= ${body};`,
    `}`,
  ];

  if (BaseCompiler.canHoist(target)) {
    // The loop runs ahead of the enclosing statement, so a draw in its body
    // must not come before a draw written before the `Sum`.
    if (BaseCompiler.foldValueImpure(args[0]))
      gpuAssertBindingKeepsDrawOrder(kind, [args[0]], target);
    // The bounds and the body run in the loop statement, so caller code in
    // any of them must not move ahead of earlier code with an effect.
    gpuAssertHoistKeepsCallerOrder(kind, args, target);
    BaseCompiler.hoistStatement(target, loop.join('\n'));
    if (BaseCompiler.foldValueImpure(args[0]))
      gpuRecordBoundDraws([args[0]], target);
    return acc;
  }
  return [...loop, `return ${acc};`].join('\n');
}

/**
 * GPU shader functions of the GLSL target.
 *
 * GLSL-specific functions (inversesqrt naming, mod, vector constructors) are
 * provided by subclass overrides.
 *
 * Complex numbers are represented as vec2(re, im). Functions that can
 * operate on complex values check `BaseCompiler.isComplexValued()` and
 * dispatch to `_gpu_c*` helper functions from the complex preamble.
 */
// Null-prototype: this table is indexed by an OPERATOR or SYMBOL NAME, and a
// name is arbitrary user text. A plain object literal inherits
// `Object.prototype`, so a name such as `toString`, `constructor` or
// `valueOf` reads the inherited member instead of missing — and because that
// value is a truthy function, the caller treats the symbol as though the
// target defined it. That made `Add(toString, 1)` refuse to compile as a
// bogus "built-in operator with no fixed arity" instead of compiling
// `toString` as an ordinary free symbol.
/** The shader-global counter of the passes of one evaluation (the pass cap
 * of the GLSL fragment, `CompilationOptions.iterationBudget`). */
export const GPU_PASS_COUNTER = '_gpu_passes';

/**
 * The statement at the start of each pass of a loop that the emitter writes,
 * or `undefined` when the target counts no pass (`fragmentPassBudget` is not
 * set: `compileFunction()`, `compileShader()`). It adds one to the counter of
 * the evaluation and leaves the loop when the counter is over the cap; the
 * root of the evaluation then gives NaN (`GPUShaderTarget.emitPreparedRoot`).
 */
export function gpuPassCountStatement(
  target: CompileTarget<Expression>
): string | undefined {
  const budget = (target as FragmentTargetFields<string>).fragmentPassBudget;
  if (budget === undefined) return undefined;
  return `if (++${GPU_PASS_COUNTER} > ${budget}) break;`;
}

export const GPU_FUNCTIONS: CompiledFunctions<Expression> = {
  __proto__: null as never,
  // Variadic arithmetic (for function-call form, e.g., with vectors)
  Add: (args, compile, target) => {
    if (args.length === 0) return '0.0';
    if (args.length === 1) return gpuGroup(compile(args[0]));
    const anyComplex = args.some((a) => BaseCompiler.isComplexValued(a));
    if (!anyComplex) {
      return foldTerms(
        args.map((x) => compile(x)),
        '0.0',
        '+',
        target.language
      );
    }
    // Opaque complex operand — fall back to promote-and-add. Tested BEFORE
    // decomposing: `tryGetComplexParts` compiles each operand it decomposes,
    // and the whole decomposition is discarded here, so testing after would
    // compile every other operand TWICE. For an impure (Random-family) operand
    // that is an extra draw, and the discarded compile's hoisted statement
    // stays in the shader as an orphan feeding nothing.
    // A real operand of a complex sum must be a scalar.
    for (const a of args) assertScalarComplexOperand('Add', a);
    if (args.some((a) => isOpaqueComplexOperand(a))) {
      const v2 = gpuVec2();
      return args
        .map((a) => {
          const code = compile(a);
          return BaseCompiler.isComplexValued(a) ? code : `${v2}(${code}, 0.0)`;
        })
        .join(' + ');
    }
    // Every operand decomposes — collect re and im parts, fold each
    const parts = args.map((a) =>
      tryGetComplexParts(a, compile, target.language)!
    );
    const reParts: string[] = [];
    const imParts: string[] = [];
    for (const p of parts) {
      if (p.re !== null) reParts.push(p.re);
      if (p.im !== null) imParts.push(p.im);
    }
    const reSum = foldTerms(reParts, '0.0', '+', target.language);
    const imSum = foldTerms(imParts, '0.0', '+', target.language);
    return `${gpuVec2()}(${reSum}, ${imSum})`;
  },
  Multiply: (args, compile, target) => {
    if (args.length === 0) return '1.0';
    if (args.length === 1) return gpuGroup(compile(args[0]));
    const anyComplex = args.some((a) => BaseCompiler.isComplexValued(a));
    if (!anyComplex) {
      return foldTerms(
        args.map((x) => gpuMultiplicativeFactor(x, target)),
        '1.0',
        '*',
        target.language
      );
    }
    // A real factor of a complex product must be a scalar.
    for (const a of args) assertScalarComplexOperand('Multiply', a);
    // Special case: scalars * imaginary_factor → vec2(0.0, product)
    // Recognizes both ImaginaryUnit symbol and Complex(0, k) literals
    const iIndex = args.findIndex(
      (op) =>
        isSymbol(op, 'ImaginaryUnit') ||
        (isNumber(op) && op.re === 0 && op.isComplex)
    );
    if (iIndex >= 0) {
      const iFactor = args[iIndex];
      const iScale = isSymbol(iFactor, 'ImaginaryUnit')
        ? 1
        : (iFactor as any).im;
      const realFactors = args.filter((_, i) => i !== iIndex);
      const v2 = gpuVec2();
      if (realFactors.length === 0)
        return `${v2}(0.0, ${formatFloat(iScale, target.language)})`;
      // The `vec2(0.0, product)` shortcut is correct only when every other
      // factor is real (a `float`). When one of them is complex, the product
      // is a `vec2`, and a vec2 constructor reads only the first component of
      // a vec2 argument in its second slot: `i·z` emitted as `vec2(0.0, z)`
      // computed `(0, Re z)` where `i·z` is `(−Im z, Re z)`. Such a product
      // goes to the general complex multiply below, which multiplies the
      // imaginary factor and the other complex factors with `_gpu_cmul`
      // (`i·tanh(z)` is `_gpu_cmul(vec2(0.0, 1.0), _gpu_ctanh(z))`). The
      // exception is a single complex factor that is a symbol `w`: the
      // product with `i` is then the quarter-turn swizzle `vec2(-w.y, w.x)`,
      // which costs less than `_gpu_cmul`. It reads `w` twice, which is
      // correct because reading a symbol has no side effect.
      const complexFactors = realFactors.filter((f) =>
        BaseCompiler.isComplexValued(f)
      );
      if (complexFactors.length === 0) {
        const factors = realFactors.map((f) =>
          gpuMultiplicativeFactor(f, target)
        );
        if (iScale !== 1) factors.unshift(formatFloat(iScale, target.language));
        const imCode = foldTerms(factors, '1.0', '*', target.language);
        return `${v2}(0.0, ${imCode})`;
      }
      if (complexFactors.length === 1 && isSymbol(complexFactors[0])) {
        const code = compile(complexFactors[0]);
        const w = /^[A-Za-z_][A-Za-z0-9_]*$/.test(code) ? code : `(${code})`;
        const scalarCodes = realFactors
          .filter((f) => f !== complexFactors[0])
          .map((f) => gpuMultiplicativeFactor(f, target));
        if (iScale !== 1)
          scalarCodes.unshift(formatFloat(iScale, target.language));
        const rotated = `${v2}(-${w}.y, ${w}.x)`;
        const scalarCode = foldTerms(scalarCodes, '1.0', '*', target.language);
        return scalarCode === '1.0' ? rotated : `(${scalarCode} * ${rotated})`;
      }
    }
    // General complex multiply: separate real scalars and complex operands
    const realCodes: string[] = [];
    const complexCodes: string[] = [];
    for (const a of args) {
      if (BaseCompiler.isComplexValued(a)) complexCodes.push(compile(a));
      else realCodes.push(gpuMultiplicativeFactor(a, target));
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
    // Complex division. A real operand must be a scalar.
    for (const a of args) assertScalarComplexOperand('Divide', a);
    if (ac && bc) return `_gpu_cdiv(${compile(args[0])}, ${compile(args[1])})`;
    if (ac && !bc) return `((${compile(args[0])}) / (${compile(args[1])}))`;
    const v2 = gpuVec2();
    return `_gpu_cdiv(${v2}(${compile(args[0])}, 0.0), ${compile(args[1])})`;
  },
  Negate: ([x], compile, target) => {
    if (x === null) throw new Error('Could not compile `Negate`: no argument');
    const c = tryGetConstant(x);
    if (c !== undefined) return formatFloat(-c, target.language);
    if (isNumber(x) && x.isComplex) {
      return `${gpuVec2()}(${formatFloat(
        -x.re,
        target.language
      )}, ${formatFloat(-x.im, target.language)})`;
    }
    if (isSymbol(x, 'ImaginaryUnit')) return `${gpuVec2()}(0.0, -1.0)`;
    return `(-(${compile(x)}))`;
  },

  // Standard math functions with complex dispatch
  // Note: `Abs` of a fixed-arity point never reaches this handler — the
  // shared compiler rewrites `Abs(Tuple)` → `Norm` (base-compiler.ts) so the
  // point compiles through the `Norm` codegen below (Tycho item 74).
  Abs: (args, compile, target) => {
    if (BaseCompiler.isComplexValued(args[0]))
      return `length(${compile(args[0])})`;
    if (BaseCompiler.isNonNegative(args[0]))
      return gpuIdentityPassthrough(args[0], compile, target);
    return `abs(${compile(args[0])})`;
  },
  Arccos: (args, compile) => {
    if (BaseCompiler.isComplexValued(args[0]))
      return `_gpu_cacos(${compile(args[0])})`;
    // Real operand, complex RESULT (`Arccos(2)`, or a real symbol of unknown
    // magnitude): outside `[−1, 1]` the value is complex, so the node is typed
    // `complex` and the parent emits the `vec2` convention — a scalar
    // `acos` there is broadcast against a `vec2` and yields garbage. See
    // `gpuResultIsComplexValued`.
    if (gpuResultIsComplexValued('Arccos', args))
      return `_gpu_cacos(${gpuComplexOperand(args[0], compile)})`;
    return `acos(${compile(args[0])})`;
  },
  Arcsin: (args, compile) => {
    if (BaseCompiler.isComplexValued(args[0]))
      return `_gpu_casin(${compile(args[0])})`;
    if (gpuResultIsComplexValued('Arcsin', args))
      return `_gpu_casin(${gpuComplexOperand(args[0], compile)})`;
    return `asin(${compile(args[0])})`;
  },
  Arctan: (args, compile) => {
    if (BaseCompiler.isComplexValued(args[0]))
      return `_gpu_catan(${compile(args[0])})`;
    return `atan(${compile(args[0])})`;
  },
  // Positional access. The lowering CONSUMES its aggregate base — it indexes
  // INTO it — so the operand shapes it was handed are no longer in the
  // emission (a `vec3` base becomes a scalar `v.y`, a `float[7]` base a
  // `_gpu_at7(…)` call), and it declares that with `markAggregateConsuming`
  // rather than letting the gate infer it. See `compileGPUAt`.
  At: markAggregateConsuming((args, compile, target) =>
    compileGPUAt(args, compile, target)
  ),
  Ceil: (args, compile, target) => {
    if (args.length > 1 && args[1] !== null)
      return gpuRoundToStep('ceil', args[0], args[1], compile, target);
    if (BaseCompiler.isIntegerValued(args[0]))
      return gpuIdentityPassthrough(args[0], compile, target);
    return `ceil(${compile(args[0])})`;
  },
  // A scalar or `vecN` operand calls a `_gpu_clamp` helper, which gives NaN
  // for a NaN operand and computes CE's `min(max(x, lo), hi)` (see
  // `gpuNaNSafeLibrary`), or the built-ins `min(max(x, lo), hi)` when every
  // operand is finite for certain (`gpuNaNSafeTernaryCall`). Other shapes
  // keep the built-in `clamp`, so that the shape gate gives its reason for a
  // decline.
  Clamp: (args, compile, target) =>
    gpuNaNSafeTernaryCall('clamp', 0, args, compile, target) ??
    `clamp(${args.map((a) => compile(a)).join(', ')})`,
  Cos: (args, compile, target) => {
    if (BaseCompiler.isComplexValued(args[0]))
      return `_gpu_ccos(${compile(args[0])})`;
    const u = gpuPiMultiple(args[0], 2, target);
    if (u !== undefined) return `_gpu_cospi(${compile(u)})`;
    // NaN-safe: the built-in `cos` of a NaN is 0 on Apple GPUs (CE-520).
    return gpuNaNSafeUnary(
      'cos',
      args[0],
      compile(gpuReduceTrigOffset(args[0], 2, true, target)),
      target
    );
  },
  // In radian mode CE's `Degrees` converts degrees→radians (Degrees(180) =
  // π), which is GLSL's `radians()`. GLSL's `degrees()` is the inverse
  // (rad→deg). In the other angular units `rewriteAngularUnit` replaces the
  // `Degrees` node before codegen, so this lowering is not reached.
  Degrees: 'radians',
  Exp: (args, compile) => {
    if (BaseCompiler.isComplexValued(args[0]))
      return `_gpu_cexp(${compile(args[0])})`;
    return `exp(${compile(args[0])})`;
  },
  Exp2: 'exp2',
  // Positional access at a fixed position: `At` with a constant index, which
  // reads a `vecN` with a swizzle and an array (a list of points, a list of
  // 5 or more numbers) with a subscript. See `compileGPUPositional`. Like
  // `At`, these lowerings index INTO their operand, so they are declared
  // aggregate-consuming.
  First: markAggregateConsuming((args, compile, target) =>
    compileGPUPositional('First', args[0], compile, target)
  ),
  Second: markAggregateConsuming((args, compile, target) =>
    compileGPUPositional('Second', args[0], compile, target)
  ),
  Third: markAggregateConsuming((args, compile, target) =>
    compileGPUPositional('Third', args[0], compile, target)
  ),
  Last: markAggregateConsuming((args, compile, target) =>
    compileGPUPositional('Last', args[0], compile, target)
  ),
  // Point-coordinate accessors. On the GPU a point is a `vec2`/`vec3`/`vec4`,
  // so a single point maps to the same swizzle as First/Second/Third. A list of
  // points is not a GPU value: emitting a swizzle on it produces invalid shader
  // source, so a list-of-points operand fails closed rather than compiling
  // to garbage behind `success: true`.
  PointX: (args, compile, target) =>
    compilePointSwizzle(args[0], 'x', compile, target),
  PointY: (args, compile, target) =>
    compilePointSwizzle(args[0], 'y', compile, target),
  PointZ: (args, compile, target) =>
    compilePointSwizzle(args[0], 'z', compile, target),
  Floor: (args, compile, target) => {
    if (args.length > 1 && args[1] !== null)
      return gpuRoundToStep('floor', args[0], args[1], compile, target);
    if (BaseCompiler.isIntegerValued(args[0]))
      return gpuIdentityPassthrough(args[0], compile, target);
    return `floor(${compile(args[0])})`;
  },
  // A sine hash written with `Fract` has the exact form, or the built-in
  // with a warning on the result, as with `Mod(u, 1)`
  // (`gpuAmplifiedTrigMod`). Every other operand keeps the built-in, a
  // scalar, a `vecN` or a list alike.
  Fract: (args, compile, target) => {
    const a = args[0];
    if (a === null || a === undefined)
      throw new Error('Could not compile `Fract`: missing argument');
    const plain = (): string => `fract(${compile(a)})`;
    return (
      gpuAmplifiedTrigMod(
        'Fract',
        a,
        true,
        compile,
        target,
        gpuOperandShape,
        plain
      ) ?? plain()
    );
  },
  Ln: (args, compile) => {
    if (BaseCompiler.isComplexValued(args[0]))
      return `_gpu_cln(${compile(args[0])})`;
    // PROVABLY negative real operand, complex result (`a := -2` → `Ln(a)` is
    // `complex`): the parent emits the `vec2` convention. An operand of
    // merely UNKNOWN sign keeps the scalar `log` (pinned; the
    // `isComplexValued` Sqrt/Ln/Log carve-out makes the parent agree). See
    // `gpuResultIsComplexValued`.
    if (args[0]?.isNegative === true && gpuResultIsComplexValued('Ln', args))
      return `_gpu_cln(${gpuComplexOperand(args[0], compile)})`;
    return `log(${compile(args[0])})`;
  },
  Log2: 'log2',
  // GLSL `min`/`max` are strictly 2-argument builtins; a variadic
  // `max(a, b, c)` is invalid shader source. Fold 3+ arguments into a nest of
  // 2-argument calls of the NaN-safe helpers, `_gpu_max(_gpu_max(a, b), c)`
  // (`gpuNaNSafeLibrary`). A COLLECTION operand makes these a
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
  // `Mean` has no lowering: the entry gives the message of an operator with
  // no lowering.
  Mean: markAggregateConsuming((_args, _compile, target) => {
    throw new Error(
      `Could not compile \`Mean\`: the operator is known to the engine but ` +
        `target '${target.language ?? 'unknown'}' has no lowering for it.`
    );
  }),
  // Element-wise max/min — genuinely COMPONENTWISE, unlike `Max`/`Min` above,
  // so a `vecN` operand stays a vector. Both require at least two operands (a
  // lone collection is a `Max`/`Min`, and CE rejects `ElementMax([1,2,3])` as
  // missing an argument), so the reduction case does not arise. They call the
  // NaN-safe helpers, as `Max`, `Min` and `Clamp` do
  // (`compileGPUElementExtremum`).
  ElementMax: (args, compile, target) =>
    compileGPUElementExtremum('max', 'ElementMax', args, compile, target),
  ElementMin: (args, compile, target) =>
    compileGPUElementExtremum('min', 'ElementMin', args, compile, target),
  Mix: 'mix',
  // Control-flow forms — the base compiler's default emits a bare `NaN`,
  // which is not valid GPU code (no shader language has a `NaN` identifier).
  // Emit a language-appropriate NaN.
  //
  // DIVERGENCE (documented, CO-P2-24): a shader cannot throw. Where the
  // interpreter throws on a non-boolean/NaN `Which` or restriction condition, the GPU
  // target instead falls through to the documented fail-closed value (the else
  // branch / NaN) — the JS target aligns via a runtime throw, which is not
  // expressible here.
  If: (args, compile, target) => {
    if (args.length !== 3)
      throw new Error('Could not compile `If`: wrong number of arguments');
    gpuAssertSelectableArms('If', [args[1], args[2]]);
    // With one complex arm, a real arm is lifted to `vec2(v, 0.0)`.
    const complex = gpuSelectionIsComplex('If', args);
    // A written `Missing` (or `NaN`) arm takes the NaN of the shape of the
    // other arm (`gpuAbsentArm`).
    const values = [args[1], args[2]];
    const arm = (i: 1 | 2): string =>
      gpuSelectionArm(
        'If',
        args[i],
        compile(args[i], i),
        complex,
        target,
        values
      );
    // An arm that needs statements, or that repeats a subexpression a
    // ternary would expand once per occurrence, takes the statement form;
    // the clause list is in `Which` shape, so its position 3 is the `If`
    // node's operand 2.
    if (
      gpuNeedsStatements(args[1]) ||
      gpuNeedsStatements(args[2]) ||
      (gpuCanPlaceStatement(target) &&
        (gpuArmSharesWork(args[1]) ||
          gpuArmSharesWork(args[2]) ||
          gpuArmDrawsWhileBinding(args[1]) ||
          gpuArmDrawsWhileBinding(args[2])))
    ) {
      const statement = compileGPUStatementSelection(
        [args[0], args[1], args[0].engine.True, args[2]],
        (e, i) =>
          i === 1 || i === 3
            ? gpuSelectionArm(
                'If',
                e,
                compile(e, i === 3 ? 2 : i),
                complex,
                target,
                values
              )
            : compile(e, i),
        target
      );
      if (statement !== undefined) return statement;
    }
    // The condition is evaluated unconditionally, so it may hoist; the two arms
    // are selected and must not (see `compileGPUConditionalArm`). Operand
    // indices preserve their CSE regions, allowing reuse of outer bindings.
    const cond = compile(args[0], 0);
    const whenTrue = compileGPUConditionalArm('If', () => arm(1), target);
    const whenFalse = compileGPUConditionalArm('If', () => arm(2), target);
    return gpuConditional(cond, whenTrue, whenFalse);
  },
  Which: (args, compile, target) => {
    if (args.length < 2 || args.length % 2 !== 0)
      throw new Error(
        'Could not compile `Which`: expected condition/value pairs'
      );
    gpuAssertSelectableArms(
      'Which',
      args.filter((_, i) => i % 2 === 1)
    );
    // With one complex value, a real value is lifted to `vec2(v, 0.0)`, and
    // the fall-through NaN is a `vec2` too.
    const complex = gpuSelectionIsComplex('Which', args);
    // A written `Missing` (or `NaN`) value takes the NaN of the shape of the
    // other values (`gpuAbsentArm`).
    const values = args.filter((_, i) => i % 2 === 1);
    const value = (i: number): string =>
      gpuSelectionArm(
        'Which',
        args[i],
        compile(args[i], i),
        complex,
        target,
        values
      );
    // An arm, or a condition past the first, that needs statements takes the
    // statement form (`compileGPUStatementSelection`); the ternary chain
    // below cannot hold them.
    const canPlace = gpuCanPlaceStatement(target);
    if (
      args.some(
        (a, i) =>
          i > 0 &&
          (gpuNeedsStatements(a) ||
            (canPlace && (gpuArmSharesWork(a) || gpuArmDrawsWhileBinding(a))))
      )
    ) {
      const statement = compileGPUStatementSelection(
        args,
        (e, i) =>
          i % 2 === 1
            ? gpuSelectionArm(
                'Which',
                e,
                compile(e, i),
                complex,
                target,
                values
              )
            : compile(e, i),
        target
      );
      if (statement !== undefined) return statement;
    }
    // The fall-through NaN must match the branch values' shape (see
    // `gpuNaNFor`); every branch of a well-typed `Which` shares one shape,
    // so the first determinable value decides.
    const shapeRef =
      args.filter((_, i) => i % 2 === 1).find((v) => gpuComponentCount(v)) ??
      null;
    const build = (i: number): string => {
      if (i >= args.length)
        return complex
          ? `${gpuVec2()}(${gpuNaN(target)})`
          : gpuNaNFor(shapeRef, target);
      const cond = args[i];
      // Only the FIRST condition is evaluated unconditionally. Every value, and
      // every LATER condition, sits behind a branch and must not hoist out of
      // it. (`build(i + 2)` needs no wrapper of its own: it guards its own
      // pieces on the next turn of the recursion.)
      const armed = (f: () => string): string =>
        i === 0 ? f() : compileGPUConditionalArm('Which', f, target);
      // `True` marks the default branch.
      if (isSymbol(cond, 'True')) return `(${armed(() => value(i + 1))})`;
      // CONSECUTIVE clauses that answer the same value collapse into one
      // clause whose condition is their disjunction: `c1 ? v : (c2 ? v : e)`
      // is `(c1 || c2) ? v : e`. GLSL short-circuits `||`, so a
      // later condition is still evaluated only when every earlier one is
      // false — the evaluation order and count of the nested form, kept
      // exactly. The clauses must be PURE: merging writes the value once
      // where the nested form wrote it twice, so an impure value would lose
      // one of two distinct draws from the shader's random stream, and a pure
      // condition is required for the same conservative reason.
      let last = i;
      while (
        last + 3 < args.length &&
        !isSymbol(args[last + 2], 'True') &&
        args[i + 1].isPure &&
        args[last + 2].isPure &&
        args[last + 3].isPure &&
        args[last + 3].isSame(args[i + 1])
      )
        last += 2;
      const first = armed(() => compile(cond, i));
      const merged: string[] = [];
      for (let k = i + 2; k <= last; k += 2)
        merged.push(
          compileGPUConditionalArm('Which', () => compile(args[k], k), target)
        );
      const condCode =
        merged.length === 0
          ? first
          : [first, ...merged].map((c) => `(${c})`).join(' || ');
      return gpuConditional(
        condCode,
        compileGPUConditionalArm('Which', () => value(i + 1), target),
        build(last + 2)
      );
    };
    return build(0);
  },
  // No `Match` entry: `Match` is not in the GLSL fragment (the rule table of
  // `glsl-fragment.ts` has no rule for it), so the typing pass refuses it on
  // every route before emission.
  Power: (args, compile, target) => {
    const base = args[0];
    const exp = args[1];
    if (base === null)
      throw new Error('Could not compile `Power`: no argument');
    // Only non-canonical input has one operand; the interpreter answers an
    // error for it. Without this check the lowering read a property of the
    // absent exponent and failed with a `TypeError`.
    if (exp === undefined || exp === null)
      throw new Error(
        'Could not compile `Power`: expected two operands, got one'
      );
    // A base that may be negative under an exponent that may be a float:
    // the interpreter gives the real root when the rational recovered from
    // the exponent has an odd denominator (`BaseCompiler.negativeBaseFloatPower`).
    // A constant exponent is decided now. A variable one cannot be decided
    // in the shader (the recovery reads the exponent to 15 to 17 digits,
    // and a shader holds an f32), and keeps the lowering below: `pow`, with
    // no value for a negative base. This is a user decision: a run-time
    // helper on an f32 cannot recover the same `p/q` as the interpreter, and
    // a refusal of every shader power of an undeclared base would break
    // ordinary plot expressions.
    const negativeBase = BaseCompiler.negativeBaseFloatPower(args);
    if (
      BaseCompiler.isComplexValued(base) ||
      BaseCompiler.isComplexValued(exp)
    ) {
      if (isSymbol(base, 'ExponentialE')) {
        // `e^{a + iπu}` with real scalar `a` and `u`: the angle in
        // half-turns, reduced exactly (`_gpu_cossinpi`), so `e^{iπx}` at
        // `x = 1` is `−1` and `e^{x + iπ}` is `−e^x`.
        const split = exp !== null ? BaseCompiler.eulerPiSplit(exp) : undefined;
        if (
          split !== undefined &&
          gpuOperandShape(split.u) === 'scalar' &&
          (split.a === undefined || gpuOperandShape(split.a) === 'scalar')
        ) {
          // The angle in half-turns has the period 2: a large constant term
          // is reduced (`gpuReduceTrigOffset`).
          //
          // A trusted lowering (`fragmentReplaceOperands()`). Input: the
          // exponent `Add(a…, i·π·u)` of `e`. Output: `u` (as in
          // `gpuImaginaryPiMultiple()`) and `a`, the sum of the real terms
          // (`Add(a…)`, or the one term). Condition: one term is `i·π·u`
          // with a real `u`, and the other terms are real. The value is the
          // interpreter's: `e^{a + iπu} = e^a·(cos πu + i·sin πu)`, and each
          // term of the exponent is evaluated once.
          const u = gpuReduceTrigOffset(
            fragmentReplaceOperands(exp!, split.u, GPU_EULER_SPLIT, target),
            2,
            false,
            undefined,
            target
          );
          const a =
            split.a === undefined
              ? undefined
              : fragmentReplaceOperands(exp!, split.a, GPU_EULER_SPLIT, target);
          return a === undefined
            ? `_gpu_cossinpi(${compile(u)})`
            : `(exp(${compile(a)}) * _gpu_cossinpi(${compile(u)}))`;
        }
        return `_gpu_cexp(${compile(exp)})`;
      }
      assertScalarComplexOperand('Power', base);
      assertScalarComplexOperand('Power', exp);
      const v2 = gpuVec2();
      const bCode = BaseCompiler.isComplexValued(base)
        ? compile(base)
        : `${v2}(${compile(base)}, 0.0)`;
      if (typeof negativeBase === 'object')
        return `_gpu_cpowrr(${bCode}, ${formatFloat(negativeBase.value, target.language)}, ${negativeBase.oddNumerator ? '-1.0' : '1.0'})`;
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
      // The node's type selects which value to fold:
      // - An EVEN reduced-rational denominator is the complex branch and the
      //   node is typed `complex`, so the enclosing emission is the
      //   `vec2(re, im)` convention. Fold the principal complex value; a
      //   scalar NaN there would be silently scalar-broadcast into a
      //   `vec2(NaN, NaN)` (valid shader source, wrong value).
      // - An ODD denominator has a real root (`(−8)^(2/3) = 4`) that `pow`
      //   misses; the node stays `number` and folds to that real value.
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
    const realPower =
      BaseCompiler.realPowerExponent(args) ??
      (typeof negativeBase === 'object' ? negativeBase : undefined);
    if (realPower !== undefined) {
      const code = gpuOperandOnce('Power', base, compile, target);
      const width = gpuBinaryVectorWidth(base, exp);
      const shape = (n: number): string =>
        width === undefined
          ? formatFloat(n, target.language)
          : `${gpuFVec(width)}(${formatFloat(n, target.language)})`;
      const magnitude = `pow(abs(${code}), ${shape(realPower.value)})`;
      if (!realPower.oddNumerator) return magnitude;
      const negative =
        width === undefined
          ? `${code} < ${shape(0)}`
          : `lessThan(${code}, ${shape(0)})`;
      const sign =
        width === undefined
          ? `(${negative} ? -1.0 : 1.0)`
          : `mix(${shape(1)}, ${shape(-1)}, ${negative})`;
      return `(${sign} * ${magnitude})`;
    }
    // Real-emitted operands but a complex RESULT type (a negative base on the
    // even-denominator branch, e.g. `a^{0.3}` with `a ⩴ -2`). The enclosing
    // emission is `vec2(re, im)`; a scalar `pow` here would scalar-broadcast
    // into a silent `vec2(NaN, NaN)`. See `gpuResultIsComplexValued`.
    if (gpuResultIsComplexValued('Power', args))
      return `_gpu_cpow(${gpuComplexOperand(base, compile)}, ${gpuComplexOperand(exp, compile)})`;
    // The width of the `vecN` this power lowers to, when one of the two
    // operands is a shader vector. Every piece of the lowering below is
    // componentwise in GLSL (`pow`, `sqrt`, `*`, `/` all take the
    // genType), so the vector case needs only two adjustments: a piece that
    // would emit a bare scalar has to be widened to the same `vecN`, and the
    // scalar-declared `_gpu_powi` helper has to be swapped for its `vecN`
    // overload. A width MISMATCH between the two operands is left to the
    // operand-shape gate, which declines it with a width diagnostic.
    const powWidth = gpuBinaryVectorWidth(base, exp);
    if (eConst === 0) {
      // `x⁰` is ONE for every component, so the emission must have the shape
      // of the base. The bare literal is correct only for a scalar base; a
      // `vecN` takes the broadcast constructor.
      const zeroShape = gpuOperandShape(base);
      if (zeroShape === 'scalar') return '1.0';
      if (typeof zeroShape === 'number') return `${gpuFVec(zeroShape)}(1.0)`;
      // A `matN` or an ARRAY base has no constructor this lowering can use,
      // and a bare `1.0` there is a silent scalar where the caller is owed an
      // aggregate — which the operand-shape gate cannot catch, because it
      // reads a lone literal as an emission that combines nothing
      // (`gpuIsAtomicEmission`) and steps aside. Route through the scalar
      // helper, whose declaration makes the gate decline with the shape
      // diagnostic it owns.
      return `_gpu_powi(${compile(base)}, 0.0)`;
    }
    if (eConst === 1) return gpuGroup(compile(base));
    if (
      isSymbol(base, 'ExponentialE') &&
      gpuOperandShape(exp) === 'scalar' &&
      compile(base) === '2.71828182846'
    )
      return `exp(${compile(exp)})`;
    if (eConst === 0.5) return `sqrt(${compile(base)})`;
    // Base two is the hardware's own exponential: GLSL declares
    // `exp2` over the genType, and `pow(2.0, y)` is itself specified as
    // `exp2(y * log2(2.0))`, so this drops a logarithm the compiler would
    // otherwise have to fold.
    //
    // The base is left out of the emitted call, which is declared after this
    // table (`markOperandConsuming`). So the operand-shape check judges
    // `exp2(v)` against the exponent alone, and a `vecN` exponent compiles
    // too.
    if (bConst === 2) return `exp2(${compile(exp)})`;
    // Literal integer exponent: emit sign-preserving code. GLSL `pow(x, y)`
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
        // A `vecN` base needs no widening here: `*` is componentwise.
        const code = compile(base);
        pos = /^[A-Za-z_]\w*$|^-?[0-9]+(?:\.[0-9]*)?$/.test(code)
          ? `(${Array(absN).fill(code).join(' * ')})`
          : gpuFixedPower(code, absN, gpuOperandShape(base));
      } else {
        // Compound or large: route through the helper so the base subexpression
        // is evaluated once (not duplicated) and the sign stays correct. The
        // exponent stays a scalar in the `vecN` overloads too.
        pos = gpuFixedPower(compile(base), absN, gpuOperandShape(base));
      }
      // `float / vecN` is a componentwise division in GLSL, so the
      // reciprocal of a vector power needs no widening either.
      return n < 0 ? `(1.0 / ${pos})` : pos;
    }
    // A run-time exponent that is integer by TYPE (a `Sum` index, an
    // integer-declared parameter) over a base that may be negative: `pow` is
    // undefined for a negative base whatever the exponent's value, so
    // `(-1)^n` and `x^k` answered NaN on most drivers where the interpreter
    // answers `±x`. The sign-preserving helper computes `pow(abs(x), n)` and
    // negates for an odd `n`, which is right ONLY because `n` is an integer:
    // the gate is the exponent's type, never the sign of the base alone — a
    // fractional exponent over a negative base is NaN over the reals and
    // keeps the plain `pow` below. A provably non-negative base keeps `pow`
    // too, since it has no sign to preserve. The exponent stays a scalar in
    // the `vecN` overloads of the helper.
    if (
      BaseCompiler.isIntegerValued(exp) &&
      !BaseCompiler.isNonNegative(base) &&
      gpuOperandShape(exp) === 'scalar'
    ) {
      const shape = gpuOperandShape(base);
      const width = typeof shape === 'number' ? shape : undefined;
      if (shape === 'scalar' || width !== undefined)
        return `_gpu_powi${width ?? ''}(${compile(base)}, ${compile(exp)})`;
    }
    // DIVERGENCE (documented, CO-P2-24): a literal `0^0` folds to NaN at
    // canonicalization and then fails closed here (no GPU NaN literal); `x^0`
    // folds to 1. A *runtime* dynamic `0^0` reaches `pow(0.0, 0.0)`, which is
    // undefined in GLSL and cannot be made to yield NaN (no NaN literal),
    // so it is left to the hardware — the JS target aligns this via `_SYS.pow`.
    // A genuinely fractional exponent (e.g. `x^2.5`) stays `pow`: it is
    // mathematically undefined for a negative base over the reals too.
    //
    // `pow` is declared over ONE genType, so a scalar standing beside a `vecN`
    // is written as an explicit constructor: GLSL does not promote it.
    return `pow(${gpuWidenToVector(base, powWidth, compile)}, ${gpuWidenToVector(exp, powWidth, compile)})`;
  },
  Radians: 'radians',
  Round: (args, compile, target) => {
    // A value halfway between two integers is rounded with the rule of
    // `ce.roundingTies` at compile time, as the interpreter does
    // (`gpuRoundToInteger()`). A SCALAR operand goes through a preamble
    // helper, which writes the operand once. A `vecN` operand uses an inline
    // form that is componentwise; it splices its operand more than once, so
    // it goes through `gpuOperandOnce`: an impure (Random-family) operand is
    // bound to a hoisted temporary instead of re-drawn, a pure one compiles
    // directly.
    const isScalar = gpuOperandShape(args[0]) === 'scalar';
    const ties = args[0].engine.roundingTies;
    const roundTie = (c: string): string =>
      gpuRoundToInteger(c, ties, isScalar);
    if (args.length < 2) {
      if (BaseCompiler.isIntegerValued(args[0]))
        return gpuIdentityPassthrough(args[0], compile, target);
      return roundTie(
        isScalar
          ? compile(args[0])
          : gpuOperandOnce('Round', args[0], compile, target)
      );
    }
    // `Round(x, step)`: the multiple of the step nearest to `x`
    // (`gpuRoundToStep()`), with the tie of the quotient rounded with the
    // same rule.
    return gpuRoundToStep(
      (q, scalar) => gpuRoundToInteger(q, ties, scalar),
      args[0],
      args[1]!,
      compile,
      target,
      0.5
    );
  },
  // NaN-safe: the built-in `sign` of a NaN is 0 on Apple GPUs (CE-520).
  Sign: (args, compile, target) =>
    gpuNaNSafeUnary('sign', args[0], compile(args[0]), target),
  Sin: (args, compile, target) => {
    if (BaseCompiler.isComplexValued(args[0]))
      return `_gpu_csin(${compile(args[0])})`;
    const u = gpuPiMultiple(args[0], 2, target);
    if (u !== undefined) return `_gpu_sinpi(${compile(u)})`;
    // NaN-safe: the built-in `sin` of a NaN is 0 on Apple GPUs (CE-520).
    return gpuNaNSafeUnary(
      'sin',
      args[0],
      compile(gpuReduceTrigOffset(args[0], 2, true, target)),
      target
    );
  },
  // A scalar or `vecN` `x` calls a `_gpu_smoothstep` helper, which gives NaN
  // for a NaN operand; the built-in gives 0 on Apple GPUs (CE-520). Other
  // shapes keep the built-in, so that the shape gate gives its reason for a
  // decline.
  Smoothstep: (args, compile, target) =>
    gpuNaNSafeTernaryCall('smoothstep', 2, args, compile, target) ??
    `smoothstep(${args.map((a) => compile(a)).join(', ')})`,
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
        return `${gpuVec2()}(0.0, ${formatFloat(
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
      return `_gpu_csqrt(${gpuComplexOperand(args[0], compile)})`;
    return `sqrt(${compile(args[0])})`;
  },
  Step: 'step',
  Tan: (args, compile, target) => {
    if (BaseCompiler.isComplexValued(args[0]))
      return `_gpu_ctan(${compile(args[0])})`;
    const u = gpuPiMultiple(args[0], 1, target);
    if (u !== undefined) return `_gpu_tanpi(${compile(u)})`;
    // The built-in `tan` of a NaN is NaN on WebGL2 over ANGLE Metal and on
    // WebGPU over Metal (Apple M5 Max, 2026-10-26), unlike `sin` and `cos`,
    // so it needs no NaN-safe helper (CE-520).
    return `tan(${compile(gpuReduceTrigOffset(args[0], 1, true, target))})`;
  },
  Truncate: (args, compile, target) => {
    if (args.length > 1 && args[1] !== null)
      return gpuRoundToStep('trunc', args[0], args[1], compile, target);
    if (BaseCompiler.isIntegerValued(args[0]))
      return gpuIdentityPassthrough(args[0], compile, target);
    return `trunc(${compile(args[0])})`;
  },

  // Complex-specific functions
  Real: (args, compile, target) => {
    if (BaseCompiler.isComplexValued(args[0])) return `(${compile(args[0])}).x`;
    return gpuIdentityPassthrough(args[0], compile, target);
  },
  Imaginary: (args, compile) => {
    if (BaseCompiler.isComplexValued(args[0])) return `(${compile(args[0])}).y`;
    return '0.0';
  },
  Argument: (args, compile, target) => {
    if (BaseCompiler.isComplexValued(args[0])) {
      // The `vec2` operand is spliced TWICE (`.y` and `.x`) — bind an impure
      // (Random-family) one to a hoisted `vec2` temporary; a pure one compiles
      // directly (byte-identical).
      const code = gpuOperandOnce('Argument', args[0], compile, target, true);
      // An operand that lowers to a `vec2` CONSTRUCTOR carries its two
      // components in the source already, so the vector is read back apart
      // instead of being built twice: `atan(vec2(a, b).y, vec2(a, b).x)`
      // becomes `atan(b, a)`. The constructor's arguments are the components
      // in order, so no swizzle is needed.
      const built = gpuTopLevelCall(code);
      if (
        built !== undefined &&
        built.callee === 'vec2' &&
        built.operands.length === 2
      )
        return `${gpuAtan2()}(${built.operands[1]}, ${built.operands[0]})`;
      // `gpuSwizzle`, not a bare `${code}.y`: a postfix swizzle binds tighter
      // than every infix operator, so an operand that lowered to an infix
      // expression — the promote-and-add form of a complex `Add`, which joins
      // its operands with ` + ` — would take the suffix on its LAST term
      // alone.
      return `${gpuAtan2()}(${gpuSwizzle(code, 'y')}, ${gpuSwizzle(code, 'x')})`;
    }
    // A real value's argument is 0 (x ≥ 0), π (x < 0), and NaN for NaN, as
    // `evaluate()` gives, as nested conditionals. The operand is spliced
    // twice, so an impure one is bound to a temporary (`gpuOperandOnce`).
    const x = gpuOperandOnce('Argument', args[0], compile, target);
    return gpuConditional(
      `${x} >= 0.0`,
      '0.0',
      gpuConditional(`${x} < 0.0`, '3.14159265359', gpuNonFiniteLiteral(NaN))
    );
  },
  Conjugate: (args, compile, target) => {
    if (BaseCompiler.isComplexValued(args[0])) {
      const v2 = gpuVec2();
      // Spliced TWICE (`.x` and `.y`) — see `Argument`.
      const code = gpuOperandOnce('Conjugate', args[0], compile, target, true);
      // `gpuSwizzle` for the same reason as `Argument` above: a bare
      // `${code}.x` binds the suffix to the last term of an infix emission.
      return `${v2}(${gpuSwizzle(code, 'x')}, -${gpuSwizzle(code, 'y')})`;
    }
    return gpuIdentityPassthrough(args[0], compile, target);
  },

  Remainder: ([a, b], compile, target) => {
    if (a === null || b === null)
      throw new Error('Could not compile `Remainder`: missing argument');
    // The interpreter rounds the quotient with a tie toward `+∞`
    // (JavaScript `Math.round`: `Remainder(5, 2)` is `-1`), whatever the
    // tie rule of `Round`. The GLSL `round()` rounds a tie as the
    // implementation chooses, so it is not used.
    const remainderQuotient = (q: string): string =>
      gpuRoundToInteger(
        q,
        'toward-positive-infinity',
        gpuOperandShape(a) === 'scalar' && gpuOperandShape(b) === 'scalar'
      );
    // An IMPURE operand (the Random family) must be evaluated exactly once:
    // both operands are spliced twice, and `_gpu_rnd_draw` advances a runtime
    // counter, so a repeated draw returns a different value AND shifts every
    // later draw in the shader. Bind scalars to hoisted temporaries; where
    // there is no statement sink (a conditional arm), or the operand is not
    // a scalar, there is no safe reading — decline.
    // Read through the value of a symbol, as the shader inlines it. Caller
    // code would run once per copy (`gpuAssertCallerCodeNotRepeated`).
    gpuAssertCallerCodeNotRepeated('Remainder', [a, b], target);
    if (BaseCompiler.foldValueImpure(a) || BaseCompiler.foldValueImpure(b)) {
      if (
        !BaseCompiler.canHoist(target) ||
        gpuOperandShape(a) !== 'scalar' ||
        gpuOperandShape(b) !== 'scalar'
      )
        throw new Error(
          'Could not compile `Remainder`: an impure (Random) operand cannot be bound to a ' +
            'temporary at this position — a repeated draw would shift every ' +
            'later value in the shader.'
        );
      gpuAssertBindingKeepsDrawOrder('Remainder', [a, b], target);
      gpuAssertHoistKeepsCallerOrder('Remainder', [a, b], target);
      const ta = BaseCompiler.tempVar(target);
      const tb = BaseCompiler.tempVar(target);
      const decl = (n: string) => `float ${n}`;
      BaseCompiler.hoistStatement(
        target,
        `${decl(ta)} = ${compile(a)};`,
        `${decl(tb)} = ${compile(b)};`
      );
      gpuRecordBoundDraws([a, b], target);
      return `(${ta} - ${tb} * ${remainderQuotient(`${ta} / ${tb}`)})`;
    }
    // `compile()` emits sub-expressions without outer parentheses, and
    // `*`/`/` bind tighter than `+` — wrap before splicing.
    const ca = `(${compile(a)})`;
    const cb = `(${compile(b)})`;
    return `(${ca} - ${cb} * ${remainderQuotient(`${ca} / ${cb}`)})`;
  },

  // Reciprocal trigonometric functions (no GPU built-ins)
  Cot: ([x], compile, target) => {
    if (x === null) throw new Error('Could not compile `Cot`: no argument');
    // The operand is written twice below, so caller code in it would run
    // twice (`gpuAssertCallerCodeNotRepeated`).
    gpuAssertCallerCodeNotRepeated('Cot', [x], target);
    if (BaseCompiler.isComplexValued(x)) {
      // The operand is spliced TWICE below, so an IMPURE one must first be
      // bound to a hoisted temporary — compiling it once is not enough, since
      // `_gpu_rnd_draw` advances its counter on every evaluation of the
      // spliced text (see the real branch and `Remainder`).
      if (BaseCompiler.foldValueImpure(x)) {
        if (!BaseCompiler.canHoist(target))
          throw new Error(
            'Could not compile `Cot`: an impure (Random) complex operand cannot be bound to a ' +
              'temporary at this position — a repeated draw would shift ' +
              'every later value in the shader.'
          );
        gpuAssertBindingKeepsDrawOrder('Cot', [x], target);
        gpuAssertHoistKeepsCallerOrder('Cot', [x], target);
        const t = BaseCompiler.tempVar(target);
        const decl = `${gpuVec2()} ${t}`;
        BaseCompiler.hoistStatement(target, `${decl} = ${compile(x)};`);
        gpuRecordBoundDraws([x], target);
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
    if (BaseCompiler.foldValueImpure(x)) {
      if (!BaseCompiler.canHoist(target) || gpuOperandShape(x) !== 'scalar')
        throw new Error(
          'Could not compile `Cot`: an impure (Random) operand cannot be bound to a temporary ' +
            'at this position — a repeated draw would shift every later ' +
            'value in the shader.'
        );
      gpuAssertBindingKeepsDrawOrder('Cot', [x], target);
      gpuAssertHoistKeepsCallerOrder('Cot', [x], target);
      const t = BaseCompiler.tempVar(target);
      const decl = `float ${t}`;
      BaseCompiler.hoistStatement(
        target,
        `${decl} = ${compile(gpuReduceTrigOffset(x, 1, true, target))};`
      );
      gpuRecordBoundDraws([x], target);
      return `(_gpu_cos(${t}) / _gpu_sin(${t}))`;
    }
    // The NaN-safe `_gpu_cos`/`_gpu_sin` (CE-520).
    const arg = compile(gpuReduceTrigOffset(x, 1, true, target));
    return `(${gpuNaNSafeUnary('cos', x, arg, target)} / ${gpuNaNSafeUnary('sin', x, arg, target)})`;
  },
  Csc: ([x], compile, target) => {
    if (x === null) throw new Error('Could not compile `Csc`: no argument');
    if (BaseCompiler.isComplexValued(x)) {
      const v2 = gpuVec2();
      return `_gpu_cdiv(${v2}(1.0, 0.0), _gpu_csin(${compile(x)}))`;
    }
    // The NaN-safe `_gpu_sin`: `1 / sin(NaN)` was +∞ on Apple GPUs (CE-520).
    return `(1.0 / ${gpuNaNSafeUnary('sin', x, compile(gpuReduceTrigOffset(x, 2, true, target)), target)})`;
  },
  Sec: ([x], compile, target) => {
    if (x === null) throw new Error('Could not compile `Sec`: no argument');
    if (BaseCompiler.isComplexValued(x)) {
      const v2 = gpuVec2();
      return `_gpu_cdiv(${v2}(1.0, 0.0), _gpu_ccos(${compile(x)}))`;
    }
    // The NaN-safe `_gpu_cos`: `1 / cos(NaN)` was +∞ on Apple GPUs (CE-520).
    return `(1.0 / ${gpuNaNSafeUnary('cos', x, compile(gpuReduceTrigOffset(x, 2, true, target)), target)})`;
  },

  // Inverse trigonometric (reciprocal)
  Arccot: ([x], compile) => {
    if (x === null) throw new Error('Could not compile `Arccot`: no argument');
    // `atan(1/x)` returns the wrong branch for x < 0. `π/2 - atan(x)` is
    // branch-free and matches the interpreter's (0, π) range for all real x.
    return `(1.5707963267948966 - atan(${compile(x)}))`;
  },
  Arccsc: ([x], compile) => {
    if (x === null) throw new Error('Could not compile `Arccsc`: no argument');
    if (
      BaseCompiler.isComplexValued(x) ||
      gpuResultIsComplexValued('Arccsc', [x])
    )
      return gpuReciprocalComplex('_gpu_cacsc', x, compile);
    return `asin(1.0 / (${compile(x)}))`;
  },
  Arcsec: ([x], compile) => {
    if (x === null) throw new Error('Could not compile `Arcsec`: no argument');
    if (
      BaseCompiler.isComplexValued(x) ||
      gpuResultIsComplexValued('Arcsec', [x])
    )
      return gpuReciprocalComplex('_gpu_casec', x, compile);
    return `acos(1.0 / (${compile(x)}))`;
  },

  // Hyperbolic functions with complex dispatch
  Sinh: (args, compile, target) => {
    if (BaseCompiler.isComplexValued(args[0])) {
      const u = gpuImaginaryPiMultiple(args[0], 2, target);
      if (u !== undefined) return `_gpu_ipi_sinh(${compile(u)})`;
      return `_gpu_csinh(${compile(args[0])})`;
    }
    return `sinh(${compile(args[0])})`;
  },
  Cosh: (args, compile, target) => {
    if (BaseCompiler.isComplexValued(args[0])) {
      const u = gpuImaginaryPiMultiple(args[0], 2, target);
      if (u !== undefined) return `_gpu_ipi_cosh(${compile(u)})`;
      return `_gpu_ccosh(${compile(args[0])})`;
    }
    return `cosh(${compile(args[0])})`;
  },
  Tanh: (args, compile, target) => {
    if (BaseCompiler.isComplexValued(args[0])) {
      const u = gpuImaginaryPiMultiple(args[0], 1, target);
      if (u !== undefined) return `_gpu_ipi_tanh(${compile(u)})`;
      return `_gpu_ctanh(${compile(args[0])})`;
    }
    return gpuRealTanh(args[0], compile);
  },

  // Reciprocal hyperbolic functions
  Coth: ([x], compile, target) => {
    if (x === null) throw new Error('Could not compile `Coth`: no argument');
    if (BaseCompiler.isComplexValued(x)) {
      const u = gpuImaginaryPiMultiple(x, 1, target);
      if (u !== undefined) return `_gpu_ipi_coth(${compile(u)})`;
      // The complex quotient splices the operand twice: an impure one is
      // bound to a hoisted temporary (see `gpuOperandOnce` and the `Cot`
      // handler).
      const z = gpuOperandOnce('Coth', x, compile, target, true);
      return `_gpu_cdiv(_gpu_ccosh(${z}), _gpu_csinh(${z}))`;
    }
    // `1 / tanh(x)`, not `cosh(x) / sinh(x)`: in f32 `cosh` and `sinh`
    // overflow to infinity above about 89, and their quotient is then NaN,
    // where the true value is ±1. The real operand is spliced once.
    return `(1.0 / ${gpuRealTanh(x, compile)})`;
  },
  Csch: ([x], compile, target) => {
    if (x === null) throw new Error('Could not compile `Csch`: no argument');
    if (BaseCompiler.isComplexValued(x)) {
      const u = gpuImaginaryPiMultiple(x, 2, target);
      if (u !== undefined) return `_gpu_ipi_csch(${compile(u)})`;
      const v2 = gpuVec2();
      return `_gpu_cdiv(${v2}(1.0, 0.0), _gpu_csinh(${compile(x)}))`;
    }
    return `(1.0 / sinh(${compile(x)}))`;
  },
  Sech: ([x], compile, target) => {
    if (x === null) throw new Error('Could not compile `Sech`: no argument');
    if (BaseCompiler.isComplexValued(x)) {
      const u = gpuImaginaryPiMultiple(x, 2, target);
      if (u !== undefined) return `_gpu_ipi_sech(${compile(u)})`;
      const v2 = gpuVec2();
      return `_gpu_cdiv(${v2}(1.0, 0.0), _gpu_ccosh(${compile(x)}))`;
    }
    return `(1.0 / cosh(${compile(x)}))`;
  },

  // Inverse hyperbolic functions with complex dispatch
  Arcosh: (args, compile) => {
    if (BaseCompiler.isComplexValued(args[0]))
      return `_gpu_cacosh(${compile(args[0])})`;
    if (gpuResultIsComplexValued('Arcosh', args))
      return `_gpu_cacosh(${gpuComplexOperand(args[0], compile)})`;
    return `acosh(${compile(args[0])})`;
  },
  Arsinh: (args, compile) => {
    if (BaseCompiler.isComplexValued(args[0]))
      return `_gpu_casinh(${compile(args[0])})`;
    return `asinh(${compile(args[0])})`;
  },
  Artanh: (args, compile) => {
    if (BaseCompiler.isComplexValued(args[0]))
      return `_gpu_catanh(${compile(args[0])})`;
    if (gpuResultIsComplexValued('Artanh', args))
      return `_gpu_catanh(${gpuComplexOperand(args[0], compile)})`;
    return `atanh(${compile(args[0])})`;
  },

  // Inverse hyperbolic (reciprocal)
  Arcoth: ([x], compile) => {
    if (x === null) throw new Error('Could not compile `Arcoth`: no argument');
    if (
      BaseCompiler.isComplexValued(x) ||
      gpuResultIsComplexValued('Arcoth', [x])
    )
      return gpuReciprocalComplex('_gpu_cacoth', x, compile);
    return `atanh(1.0 / (${compile(x)}))`;
  },
  Arcsch: ([x], compile) => {
    if (x === null) throw new Error('Could not compile `Arcsch`: no argument');
    return `asinh(1.0 / (${compile(x)}))`;
  },
  Arsech: ([x], compile) => {
    if (x === null) throw new Error('Could not compile `Arsech`: no argument');
    if (
      BaseCompiler.isComplexValued(x) ||
      gpuResultIsComplexValued('Arsech', [x])
    )
      return gpuReciprocalComplex('_gpu_casech', x, compile);
    return `acosh(1.0 / (${compile(x)}))`;
  },

  // Trigonometric (additional)
  Arctan2: (args, compile) => {
    if (args.length < 2)
      throw new Error('Could not compile `Arctan2`: need two arguments');
    return `${gpuAtan2()}(${compile(args[0])}, ${compile(args[1])})`;
  },
  Hypot: ([x, y], compile) => {
    if (x === null || y === null)
      throw new Error('Could not compile `Hypot`: need two arguments');
    return `length(vec2(${compile(x)}, ${compile(y)}))`;
  },
  Haversine: ([x], compile, target) => {
    if (x === null)
      throw new Error('Could not compile `Haversine`: no argument');
    // The NaN-safe `_gpu_cos`: `1 - cos(NaN)` was 1 on Apple GPUs (CE-520).
    return `((1.0 - ${gpuNaNSafeUnary('cos', x, compile(x), target)}) * 0.5)`;
  },
  InverseHaversine: ([x], compile) => {
    if (x === null)
      throw new Error('Could not compile `InverseHaversine`: no argument');
    return `(2.0 * asin(sqrt(${compile(x)})))`;
  },

  // Special functions
  Gamma: (args, compile, target) => {
    const x = args[0];
    if (!x) throw new Error('Could not compile `Gamma`: no argument');
    // The TWO-operand form is the upper incomplete gamma
    // `Γ(s, z) = ∫_z^∞ tˢ⁻¹e⁻ᵗ dt` (the signature is `(number, number?)`) — a
    // different function from `Γ(z)`, not a variant of it: `Γ(5, 2)` is
    // 22.736…, `Γ(5)` is 24. `_gpu_gamma` is the COMPLETE Γ, so consuming
    // only the first operand reported success on a shader computing the wrong
    // value. There is no shader builtin for the incomplete form and no
    // preamble helper for it, so it fails closed.
    if (args.length > 1)
      throw new Error(
        `Could not compile \`Gamma\`: the two-operand form is the upper incomplete gamma Γ(s, z), ` +
          `which has no ${target.language ?? 'GPU'} lowering ` +
          `(\`_gpu_gamma\` is the COMPLETE Γ).`
      );
    return `_gpu_gamma(${compile(x)})`;
  },
  GammaLn: ([x], compile) => {
    if (x === null) throw new Error('Could not compile `GammaLn`: no argument');
    return `_gpu_gammaln(${compile(x)})`;
  },
  Factorial: ([x], compile) => {
    if (x === null)
      throw new Error('Could not compile `Factorial`: no argument');
    return `_gpu_gamma(${compile(x)} + 1.0)`;
  },
  Beta: ([a, b], compile, target) => {
    if (a === null || b === null)
      throw new Error('Could not compile `Beta`: need two arguments');
    // Each operand is spliced twice — an impure one is bound to a hoisted
    // temporary (see `gpuOperandOnce`).
    const ca = gpuOperandOnce('Beta', a, compile, target);
    const cb = gpuOperandOnce('Beta', b, compile, target);
    return `(_gpu_gamma(${ca}) * _gpu_gamma(${cb}) / _gpu_gamma(${ca} + ${cb}))`;
  },
  Erf: ([x], compile) => {
    if (x === null) throw new Error('Could not compile `Erf`: no argument');
    return `_gpu_erf(${compile(x)})`;
  },
  // ψ, ψ₁ and ψ⁽ⁿ⁾ of a real argument (`GPU_POLYGAMMA_PREAMBLE_GLSL`). The
  // interpreter has a complex value for a complex argument, so the three
  // heads are real-only lowerings (`GPU_REAL_ONLY_LOWERINGS`).
  Digamma: ([x], compile) => {
    if (x === null) throw new Error('Could not compile `Digamma`: no argument');
    return `_gpu_digamma(${compile(x)})`;
  },
  Trigamma: ([x], compile) => {
    if (x === null)
      throw new Error('Could not compile `Trigamma`: no argument');
    return `_gpu_trigamma(${compile(x)})`;
  },
  PolyGamma: (args, compile) => {
    if (args.length !== 2 || args[0] === null || args[1] === null)
      throw new Error('Could not compile `PolyGamma`: need two arguments');
    return `_gpu_polygamma(${compile(args[0])}, ${compile(args[1])})`;
  },
  // The two-argument form is Wolfram's generalized `Zeta[s, a]`: the Hurwitz
  // zeta for a > 0, but real |k + a|^(−s) terms and no pole for a ≤ 0, as the
  // interpreter's `evaluateGeneralizedZeta` computes it — so it lowers to
  // `_gpu_zeta_generalized`, not to `_gpu_hurwitz_zeta`. `_gpu_zeta` is the
  // one-argument Riemann ζ only.
  Zeta: (args, compile) => {
    if (args.length === 1) return `_gpu_zeta(${compile(args[0])})`;
    if (args.length === 2)
      return `_gpu_zeta_generalized(${compile(args[0])}, ${compile(args[1])})`;
    throw new Error('Could not compile `Zeta`: it takes one or two operands');
  },
  // The three-operand form `HurwitzZeta(s, a, n)` is a derivative the
  // interpreter leaves symbolic, so it declines here.
  HurwitzZeta: (args, compile) => {
    if (args.length !== 2)
      throw new Error(
        'Could not compile `HurwitzZeta`: only the two-operand form `HurwitzZeta(s, a)` compiles'
      );
    declineComplexContinuation('HurwitzZeta', args);
    return `_gpu_hurwitz_zeta(${compile(args[0])}, ${compile(args[1])})`;
  },
  // Real-only (`GPU_REAL_ONLY_LOWERINGS`): `_gpu_lerch_phi` takes real
  // operands and is NaN where Φ is complex (real z > 1 with s not a
  // non-positive integer, or a < 0 with a non-integer s), and where none of
  // its methods can vouch for the value — see `GPU_LERCH_PREAMBLE_GLSL`.
  LerchPhi: (args, compile) => {
    if (args.length !== 3)
      throw new Error(
        'Could not compile `LerchPhi`: it takes exactly three operands'
      );
    declineComplexContinuation('LerchPhi', args);
    return `_gpu_lerch_phi(${compile(args[0])}, ${compile(args[1])}, ${compile(args[2])})`;
  },
  // Real-only (`GPU_REAL_ONLY_LOWERINGS`): `_gpu_poly_log` answers the
  // orders 1, 0, −1 and −2 … −12 in closed form and every other order as
  // z · Φ(z, s, 1), and below z = −1 with a negative non-integer order,
  // where Φ declines, by Jonquière's inversion formula. It is NaN on the
  // cut z > 1 (a complex value) and where both decline.
  PolyLog: (args, compile) => {
    if (args.length !== 2)
      throw new Error(
        'Could not compile `PolyLog`: it takes exactly two operands'
      );
    declineComplexContinuation('PolyLog', args);
    return `_gpu_poly_log(${compile(args[0])}, ${compile(args[1])})`;
  },
  Binomial: gpuBinomial,
  // `Choose(n, k)` is the binomial coefficient — same lowering (the two heads
  // share `evaluateBinomial` in the interpreter, so they must agree here too).
  Choose: gpuBinomial,
  Erfc: ([x], compile) => {
    if (x === null) throw new Error('Could not compile `Erfc`: no argument');
    return `(1.0 - _gpu_erf(${compile(x)}))`;
  },
  ErfInv: ([x], compile) => {
    if (x === null) throw new Error('Could not compile `ErfInv`: no argument');
    return `_gpu_erfinv(${compile(x)})`;
  },
  Heaviside: ([x], compile) => {
    if (x === null)
      throw new Error('Could not compile `Heaviside`: no argument');
    return `_gpu_heaviside(${compile(x)})`;
  },
  Sinc: ([x], compile) => {
    if (x === null) throw new Error('Could not compile `Sinc`: no argument');
    return `_gpu_sinc(${compile(x)})`;
  },
  FresnelC: ([x], compile) => {
    if (x === null)
      throw new Error('Could not compile `FresnelC`: no argument');
    return `_gpu_fresnelC(${compile(x)})`;
  },
  FresnelS: ([x], compile) => {
    if (x === null)
      throw new Error('Could not compile `FresnelS`: no argument');
    return `_gpu_fresnelS(${compile(x)})`;
  },
  BesselJ: ([n, x], compile) => {
    if (n === null || x === null)
      throw new Error('Could not compile `BesselJ`: need two arguments');
    const intCast = 'int';
    return `_gpu_besselJ(${intCast}(${compile(n)}), ${compile(x)})`;
  },

  // Additional math functions
  Lb: 'log2',
  Log: (args, compile) => {
    if (args.length === 0)
      throw new Error('Could not compile `Log`: no argument');
    // Complex either because an operand is, or because the RESULT is complex
    // from a PROVABLY negative argument (`a := -2` makes `Log(a)`
    // `complex`). Either way the enclosing emission is the `vec2`
    // convention. An operand of merely UNKNOWN sign keeps the scalar kernel
    // (pinned; the `isComplexValued` Sqrt/Ln/Log carve-out makes the parent
    // agree). See `gpuResultIsComplexValued`.
    if (
      args.some((a) => BaseCompiler.isComplexValued(a)) ||
      (args.some((a) => a.isNegative === true) &&
        gpuResultIsComplexValued('Log', args))
    ) {
      const num = `_gpu_cln(${gpuComplexOperand(args[0], compile)})`;
      // `ln(x) / ln(b)`: the base may itself be complex, or real-but-negative
      // (whose own `ln` is complex). Base 10 divides by a real, so it stays a
      // componentwise scalar multiply.
      if (args.length === 1) return `(${num} * 0.4342944819032518)`;
      return `_gpu_cdiv(${num}, _gpu_cln(${gpuComplexOperand(args[1], compile)}))`;
    }
    if (args.length === 1) return `(log(${compile(args[0])}) / log(10.0))`;
    // Base 2 has a shader builtin, exact at the powers of two like the
    // interpreter's fold (`Log(8, 2)` is `3`); `log(x) / log(2.0)` is not
    // (Tycho item 240). Shaders have no `log10`, so base 10 keeps the
    // quotient.
    if (BaseCompiler.fixedLogBase(args) === 2)
      return `log2(${compile(args[0])})`;
    return `(log(${compile(args[0])}) / log(${compile(args[1])}))`;
  },
  Log10: ([x], compile) => {
    if (x === null) throw new Error('Could not compile `Log10`: no argument');
    return `(log(${compile(x)}) * 0.4342944819032518)`;
  },
  Lg: ([x], compile) => {
    if (x === null) throw new Error('Could not compile `Lg`: no argument');
    return `(log(${compile(x)}) * 0.4342944819032518)`;
  },
  Square: ([x], compile) => {
    if (x === null) throw new Error('Could not compile `Square`: no argument');
    if (isSymbol(x) || isNumber(x)) {
      const arg = compile(x);
      if (/^[A-Za-z_]\w*$|^-?[0-9]+(?:\.[0-9]*)?$/.test(arg))
        return `(${arg} * ${arg})`;
      const width = gpuOperandShape(x);
      return gpuFixedPower(arg, 2, width);
    }
    // Compound base: `pow(x, 2.0)` is NaN for x < 0 on a real GPU (log2 of a
    // negative). Route through the sign-preserving helper, which also evaluates
    // the base subexpression once instead of duplicating it. A `vecN` base
    // takes the componentwise overload of that helper (`_gpu_powi3`); the
    // scalar one is declared with `float` parameters and has no vector
    // reading.
    const width = gpuOperandShape(x);
    return gpuFixedPower(compile(x), 2, width);
  },
  Root: ([x, n], compile, target) => {
    if (x === null) throw new Error('Could not compile `Root`: no argument');
    // A COMPLEX radicand is a `vec2`, which the real lowerings below would
    // read componentwise. It takes the principal root through `_gpu_cpow`,
    // with the one exception the interpreter and the JavaScript `_SYS.croot`
    // make: a radicand whose imaginary part is exactly zero, under an odd
    // integer degree, has the REAL root (`Root(-8, 3)` is `-2`, not the
    // principal `1 + 1.732i`). The radicand is complex-shaped but may be real
    // when the code runs, so the test is emitted. A complex DEGREE has no
    // shader lowering.
    if (
      BaseCompiler.isComplexValued(x) ||
      (n != null && BaseCompiler.isComplexValued(n))
    ) {
      if (n != null && BaseCompiler.isComplexValued(n))
        throw new Error(
          'Could not compile `Root`: a complex degree has no shader lowering.'
        );
      const v2 = gpuVec2();
      const z = gpuOperandOnce('Root', x, compile, target, true);
      if (n == null) return `_gpu_csqrt(${z})`;
      const degreeConst = tryGetConstant(n);
      if (degreeConst !== undefined) {
        const inverse = formatFloat(1 / degreeConst, target.language);
        const principal = `_gpu_cpow(${z}, ${v2}(${inverse}, 0.0))`;
        if (!Number.isInteger(degreeConst) || degreeConst % 2 === 0)
          return principal;
        return gpuConditional(
          `(${z}).y == 0.0`,
          `${v2}(sign((${z}).x) * pow(abs((${z}).x), ${inverse}), 0.0)`,
          principal
        );
      }
      const d = gpuOperandOnce('Root', n, compile, target);
      const odd = `mod(abs(${d}), 2.0) == 1.0`;
      return gpuConditional(
        `(${z}).y == 0.0 && fract(${d}) == 0.0 && ${odd}`,
        `${v2}(sign((${z}).x) * pow(abs((${z}).x), 1.0 / (${d})), 0.0)`,
        `_gpu_cpow(${z}, ${v2}(1.0 / (${d}), 0.0))`
      );
    }
    if (n === null || n === undefined) return `sqrt(${compile(x)})`;
    const nConst = tryGetConstant(n);
    if (nConst === 2) return `sqrt(${compile(x)})`;
    const xConst = tryGetConstant(x);
    if (xConst !== undefined && nConst !== undefined) {
      const r = Math.pow(xConst, 1 / nConst);
      // For a negative base, the node's type selects which value to fold. An odd
      // integer degree has a real root (interpreter convention, e.g.
      // Root(-8, 3) = -2) and stays `number`. An EVEN degree is the complex
      // branch: the node is typed `complex`, so the enclosing emission is
      // `vec2(re, im)` and the
      // fold must be the principal complex value — a scalar NaN there would be
      // silently scalar-broadcast into `vec2(NaN, NaN)`. (A canonical even root
      // of a negative already folds to an exact complex literal before
      // compile: `√-4` → `2i`.)
      if (Number.isNaN(r)) {
        // A noninteger degree read as a rational exponent with an odd
        // denominator (`BaseCompiler.realRootDegreeTerms`) has a real root
        // too: negative when the numerator is odd, positive when it is even.
        const realRoot =
          xConst < 0 ? BaseCompiler.realRootDegreeTerms(n) : undefined;
        if (
          xConst < 0 &&
          ((Number.isInteger(nConst) && nConst % 2 !== 0) ||
            realRoot?.oddNumerator === true)
        )
          return formatFloat(-Math.pow(-xConst, 1 / nConst), target.language);
        if (realRoot !== undefined)
          return formatFloat(Math.pow(-xConst, 1 / nConst), target.language);
        if (gpuResultIsComplexValued('Root', [x, n]))
          return gpuComplexPowLiteral(xConst, 1 / nConst, target);
      }
      return formatFloat(r, target.language);
    }
    // Real-emitted operands but a complex RESULT type (an even degree over a
    // negative base, e.g. `\sqrt[4]{a}` with `a ⩴ -2`). See
    // `gpuResultIsComplexValued`.
    if (gpuResultIsComplexValued('Root', [x, n]))
      return `_gpu_cpow(${gpuComplexOperand(x, compile)}, ${gpuVec2()}(1.0 / (${compile(n)}), 0.0))`;
    // Odd integer degree: GPU has no `cbrt`, and `pow` is NaN for a negative
    // base. Emit the sign-corrected form `sign(x)·|x|^(1/n)`. A noninteger
    // degree that the interpreter reads as a rational exponent with an odd
    // denominator (`BaseCompiler.realRootDegreeTerms`) has a real root too:
    // with an odd numerator (`\sqrt[2.2]{x}`, read as `x^{5/11}`) it is the
    // same signed form, with an even numerator (`\sqrt[2.5]{x}`, read as
    // `x^{2/5}`) it is the magnitude `|x|^(1/n)`.
    const realRoot = BaseCompiler.realRootDegreeTerms(n);
    if (
      nConst !== undefined &&
      ((Number.isInteger(nConst) && nConst % 2 !== 0) ||
        realRoot?.oddNumerator === true)
    ) {
      // The operand is spliced TWICE — bind an impure (Random-family) one to a
      // hoisted temporary; a pure one compiles directly (byte-identical).
      const c = gpuOperandOnce('Root', x, compile, target);
      return `(sign(${c}) * pow(abs(${c}), ${formatFloat(
        1 / nConst,
        target.language
      )}))`;
    }
    if (nConst !== undefined && realRoot !== undefined)
      return `pow(abs(${compile(x)}), ${formatFloat(
        1 / nConst,
        target.language
      )})`;
    // The degree is parenthesized unless it is a single name or number:
    // `Root(x, u + 1)` is `pow(x, 1.0 / (u + 1.0))`, not `pow(x, 1.0 / u + 1.0)`.
    const degree = compile(n);
    return `pow(${compile(x)}, 1.0 / ${
      /^[\w.]+$/.test(degree) ? degree : `(${degree})`
    })`;
  },

  // Color functions (pure-math, GPU-compilable)
  // `GamutMap(c, gamut?)` answers the mapped color in sRGB channels, as the
  // interpreter answers an `Rgb` head, and `colorSpaceOf` reports `rgb` for it,
  // so a consumer converts the channels back to OKLCh (`gpuColorOperand`). For
  // "display-p3" the channels are extended sRGB: a color inside the
  // Display-P3 gamut but outside the sRGB gamut has a channel outside [0, 1].
  // The gamut must be a string literal, because a shader has no run-time
  // string; an unknown gamut answers `expected-value` in the interpreter, and
  // fails closed here.
  GamutMap: (args, compile, target) => {
    if (args.length === 0)
      throw new Error('Could not compile `GamutMap`: no argument');
    const c = gpuColorOperand('GamutMap', args[0], compile, target);
    const gamut = args.length >= 2 && args[1] !== null ? args[1] : undefined;
    let name = 'srgb';
    if (gamut !== undefined) {
      const literal = readStringLiteral(gamut);
      if (literal === null)
        throw new Error(
          'Could not compile `GamutMap`: the gamut must be a string literal on a shader target'
        );
      name = literal;
    }
    const helper = GPU_GAMUT_HELPERS.get(name);
    if (helper !== undefined) return `${helper}(${c})`;
    throw new Error(
      `Could not compile \`GamutMap\`: unknown gamut "${name}" — the gamut is ` +
        `${[...GPU_GAMUT_HELPERS.keys()].map((g) => `"${g}"`).join(' or ')}.`
    );
  },
  ColorMix: (args, compile, target) => {
    if (args.length < 2)
      throw new Error('Could not compile `ColorMix`: need two colors');
    const c1 = gpuColorOperand('ColorMix', args[0], compile, target);
    const c2 = gpuColorOperand('ColorMix', args[1], compile, target);
    const ratio = args.length >= 3 ? compile(args[2]) : '0.5';
    return `_gpu_color_mix(${c1}, ${c2}, ${ratio})`;
  },
  ColorContrast: ([bg, fg], compile, target) => {
    if (bg === null || fg === null)
      throw new Error('Could not compile `ColorContrast`: need two colors');
    return `_gpu_apca(${gpuColorOperand(
      'ColorContrast',
      bg,
      compile,
      target
    )}, ${gpuColorOperand('ColorContrast', fg, compile, target)})`;
  },
  // `markAggregateConsuming`: every colour operand goes through
  // `gpuColorOperand`, which checks its shape and converts it to an OKLCh
  // `vec3` itself. The emitted `(cond ? fg1 : fg2)` has the converted
  // colours and a boolean condition as its operands, not the operands of the
  // head. Judged against the
  // operand shapes, a colour literal such as `Rgb(1, 0, 0)` (a scalar shape)
  // beside a tuple background (a `vec3` shape) made the shape check refuse
  // valid source. CE-241.2.
  ContrastingColor: markAggregateConsuming((args, compile, target) => {
    if (args.length === 0)
      throw new Error('Could not compile `ContrastingColor`: no argument');
    // GLSL keeps the EXACT `?:` text it has always emitted (pinned).
    const pick = (cond: string, whenTrue: string, whenFalse: string): string =>
      `(${cond} ? ${whenTrue} : ${whenFalse})`;
    // Every operand is spliced TWICE by the comparison below (the background
    // in both arms of the comparison, each foreground in its arm and in the
    // result). A color operand is `vec3`-shaped, so there is no scalar (or
    // `vec2`) temporary to bind it to — an impure (Random-family) operand
    // would be re-drawn, and `_gpu_rnd_draw` advances a runtime counter, so
    // the two splices compare DIFFERENT colors and every later draw in the
    // shader shifts. No safe reading — decline (the `gpuOperandOnce` rule for
    // a non-scalar operand).
    if (args.slice(0, 3).some((a) => a.isPure === false))
      throw new Error(
        `Could not compile \`ContrastingColor\`: an impure (Random) operand cannot be bound to a ` +
          `temporary at this position — a repeated draw would shift every ` +
          `later value in the shader.`
      );
    // Caller code in a color operand would run once per copy, or ahead of
    // earlier code when the operand is bound to a temporary below.
    if (target !== undefined)
      gpuAssertCallerCodeNotRepeated(
        'ContrastingColor',
        args.slice(0, 3),
        target
      );
    // Every color operand is spliced twice, and `select` evaluates both arms,
    // so an operand written inline runs its `_gpu_srgb_to_oklch` conversion up
    // to four times per fragment. Bind each converted operand to a `vec3`
    // local once where the target has a statement sink.
    //
    // Only an operand that VARIES is bound. An operand with no unknowns is
    // the same value in every fragment, so the repeated splice costs nothing
    // measurable and the shorter inline form is kept. A bare name is already
    // a single evaluation, and where there is no statement sink the code is
    // spliced as before.
    const bindColor = (x: Expression, code: string): string => {
      if (target === undefined || x.unknowns.length === 0) return code;
      if (/^[A-Za-z_]\w*$/.test(code)) return code;
      if (!BaseCompiler.canHoist(target)) return code;
      const t = BaseCompiler.tempVar(target);
      const type = gpuVec3();
      const decl = `${type} ${t}`;
      BaseCompiler.hoistStatement(target, `${decl} = ${code};`);
      return t;
    };
    const bg = bindColor(
      args[0],
      gpuColorOperand('ContrastingColor', args[0], compile, target)
    );
    // The comparison is the one the interpreter makes through the
    // `contrastingColor()` routine of `@arnog/colors`: the candidate with the
    // larger ABSOLUTE APCA contrast wins, and the candidate is the FIRST
    // argument of the contrast. That order matters — APCA is not symmetric,
    // and the reversed order picked the other candidate for some
    // backgrounds.
    if (args.length >= 3) {
      const fg1 = bindColor(
        args[1],
        gpuColorOperand('ContrastingColor', args[1], compile, target)
      );
      const fg2 = bindColor(
        args[2],
        gpuColorOperand('ContrastingColor', args[2], compile, target)
      );
      return pick(
        `abs(_gpu_apca(${fg1}, ${bg})) >= abs(_gpu_apca(${fg2}, ${bg}))`,
        fg1,
        fg2
      );
    }
    // Default: choose between white and black in OKLCh. Black is vec3(0);
    // white is L=1 achromatic — vec3(1.0, 0.0, 0.0).
    const v3 = 'vec3';
    const black = `${v3}(0.0)`;
    const white = `${v3}(1.0, 0.0, 0.0)`;
    return pick(
      `abs(_gpu_apca(${white}, ${bg})) >= abs(_gpu_apca(${black}, ${bg}))`,
      white,
      black
    );
  }),
  ColorToColorspace: ([color, space], compile, target) => {
    if (color === null || space === null)
      throw new Error(
        'Could not compile `ColorToColorspace`: need color and space'
      );
    // The input color is canonical OKLCh; route to the requested space.
    // The space arg must be a string literal so we can pick the helper
    // at compile time (no runtime branching in shader code).
    const spaceName = readStringLiteral(space);
    if (spaceName === null)
      throw new Error(
        'Could not compile `ColorToColorspace`: space must be a string literal'
      );
    const c = gpuColorEntryOperand('ColorToColorspace', color, compile, target);
    switch (spaceName) {
      case 'oklch':
        return c;
      case 'oklab':
      case 'lab':
        return `_gpu_oklch_to_oklab(${c})`;
      case 'rgb':
        return gpuRgbBoundary(color, c, target);
      case 'hsl':
        return `_gpu_rgb_to_hsl(_gpu_oklch_to_srgb(${c}))`;
      case 'hsv':
        return `_gpu_rgb_to_hsv(_gpu_oklch_to_srgb(${c}))`;
      default:
        throw new Error(
          `Could not compile \`ColorToColorspace\`: unsupported space "${spaceName}" on GPU target`
        );
    }
  },
  ColorFromColorspace: ([components, space], compile) => {
    if (components === null || space === null)
      throw new Error(
        'Could not compile `ColorFromColorspace`: need components and space'
      );
    // Components are in the named space, and the color this builds keeps them
    // there. The space operand must be a string literal so that the space is
    // a compile-time fact (`colorSpaceOf`): a shader color is a bare vector
    // with no run-time tag, and shader code carries no runtime branching.
    const spaceName = readStringLiteral(space);
    if (spaceName === null)
      throw new Error(
        'Could not compile `ColorFromColorspace`: space must be a string literal'
      );
    // A 4-component tuple carries alpha. Same fail-closed policy as the typed
    // color heads: the `_gpu_*` chain is `vec3` end to end, so a `vec4` here
    // would either not type-check or silently drop the alpha downstream.
    const typedHead =
      isFunction(components) && GPU_COLOR_HEADS.has(components.operator)
        ? components
        : null;
    // A `List` is refused here, not read as components: the interpreter's
    // signature is `(color | tuple, string)` and it answers
    // `incompatible-type` for a list, so a shader must not quietly accept
    // what the engine calls an error.
    if (isFunction(components) && components.operator === 'List')
      throw new Error(
        `Could not compile \`ColorFromColorspace\`: a list is not a color component vector — the ` +
          `operand must be a tuple or a color.`
      );
    if (typedHead) assertNoGPUAlpha('ColorFromColorspace', typedHead.ops);
    else if (isFunction(components) && components.operator === 'Tuple')
      assertNoGPUAlpha('ColorFromColorspace', components.ops);
    // This operand is read as raw COMPONENTS in the named space — that is how
    // the interpreter reads a typed color head here. The head's own lowering
    // turns it into a canonical OKLCh color value instead, so compiling it
    // the ordinary way applied the space conversion a second time and
    // `ColorFromColorspace(Rgb(1, 0, 0), 'rgb')` answered a color that was
    // not red.
    // The `vec3` constructor is built here rather than by the head's own
    // lowering, so the shape gate that lowering applies has to be applied
    // here too: a vector-valued component emitted
    // `vec3(1.0, vec2(0.0, 1.0), 0.0)`, which no driver accepts.
    if (typedHead)
      assertGPUScalarComponents(typedHead.ops.slice(0, 3), gpuVec3());
    const c = typedHead
      ? `${gpuVec3()}(${typedHead.ops
          .slice(0, 3)
          .map((op) => compile(op))
          .join(', ')})`
      : compile(components);
    // The value is the channels themselves, in the space they were given in.
    // That is the color this operator builds — the interpreter answers the
    // color head of the named space — and `colorSpaceOf` reports the space,
    // so a consumer converts the channels back to OKLCh where it reads them
    // (`gpuColorOperand`), exactly as it does for an `As*` conversion. The
    // space name is still checked here, so a space no shader helper covers
    // fails closed at the operator rather than at its consumer.
    if (!GPU_COLOR_SPACES.has(spaceName))
      throw new Error(
        `Could not compile \`ColorFromColorspace\`: unsupported space "${spaceName}" on GPU target`
      );
    return c;
  },

  // ---------------------------------------------------------------------------
  // Color literals. Each typed head compiles to a canonical OKLCh vec3.
  // An alpha (4th) argument is DECLINED (`assertNoGPUAlpha`) — GPU color
  // values are vec3 only, so there is nowhere to carry it. Pass alpha as a
  // separate uniform if it's needed at the framebuffer boundary.
  // ---------------------------------------------------------------------------

  Color: ([s]) => {
    // Compile-time CSS-color-string parsing. Runtime parsing is impractical
    // in shader code, so the string must be a literal at compile time.
    if (s === null) throw new Error('Could not compile `Color`: no argument');
    const str = readStringLiteral(s);
    if (str === null)
      throw new Error(
        'Could not compile `Color`: argument must be a string literal on GPU target'
      );
    // The predicate is the interpreter's own (`parseColorString`,
    // `library/colors.ts`), so a string is a color on every route or on none
    // of them. Reading the parser's zero sentinel as "not a color" here made
    // `Color("#gg0000")` compile to opaque black — a wrong value behind a
    // reported success — while refusing the genuinely transparent spellings
    // `#00000000` and `rgba(0, 0, 0, 0)`.
    const packed = parseColorString(str);
    if (packed === null)
      throw new Error(
        `Could not compile \`Color\`: invalid color string "${str}"`
      );
    // The packing is 0xrrggbbaa. Only the RGB is lowered below, so a literal
    // carrying a non-opaque alpha would silently become opaque. Decline
    // instead, matching `assertNoGPUAlpha`.
    if ((packed & 0xff) !== 0xff)
      throw new Error(
        `Could not compile \`Color\`: the color string "${str}" carries an alpha channel, which is ` +
          `not representable on the GPU target — color values are \`vec3\` ` +
          `(OKLCh) end to end, with no alpha channel. Use a fully opaque ` +
          `color and pass the alpha separately (e.g. as a uniform) at the ` +
          `framebuffer boundary.`
      );
    const r = (packed >>> 24) & 0xff;
    const g = (packed >>> 16) & 0xff;
    const b = (packed >>> 8) & 0xff;
    const oklch = rgbToOklch({ r, g, b });
    return `${gpuVec3()}(${formatFloat(oklch.L)}, ${formatFloat(oklch.C)}, ${formatFloat(oklch.H)})`;
  },

  Rgb: (args, compile) => {
    if (args.length < 3)
      throw new Error('Could not compile `Rgb`: need 3 components');
    assertNoGPUAlpha('Rgb', args);
    const v3 = gpuVec3();
    // Channels are 0-1 sRGB — no scaling needed.
    return `_gpu_srgb_to_oklch(${v3}(${compile(args[0])}, ${compile(args[1])}, ${compile(args[2])}))`;
  },

  Hsv: (args, compile) => {
    if (args.length < 3)
      throw new Error('Could not compile `Hsv`: need 3 components');
    assertNoGPUAlpha('Hsv', args);
    const v3 = gpuVec3();
    return `_gpu_srgb_to_oklch(_gpu_hsv_to_rgb(${v3}(${compile(args[0])}, ${compile(args[1])}, ${compile(args[2])})))`;
  },

  Hsl: (args, compile) => {
    if (args.length < 3)
      throw new Error('Could not compile `Hsl`: need 3 components');
    assertNoGPUAlpha('Hsl', args);
    const v3 = gpuVec3();
    return `_gpu_srgb_to_oklch(_gpu_hsl_to_rgb(${v3}(${compile(args[0])}, ${compile(args[1])}, ${compile(args[2])})))`;
  },

  Oklab: (args, compile) => {
    if (args.length < 3)
      throw new Error('Could not compile `Oklab`: need 3 components');
    assertNoGPUAlpha('Oklab', args);
    return `_gpu_oklab_to_oklch(${gpuFiniteColorChannels(args, compile)})`;
  },

  Oklch: (args, compile) => {
    if (args.length < 3)
      throw new Error('Could not compile `Oklch`: need 3 components');
    assertNoGPUAlpha('Oklch', args);
    // Already in canonical form — no conversion needed, only the channel
    // check of `gpuFiniteColorChannels`.
    return gpuFiniteColorChannels(args, compile);
  },

  // ---------------------------------------------------------------------------
  // As* operators. AsOklch is identity (canonical). The other As* return
  // components in the named space, equivalent to ColorToColorspace(c, 'x').
  // ---------------------------------------------------------------------------

  AsOklch: ([c], compile, target) => {
    if (c === null) throw new Error('Could not compile `AsOklch`: no argument');
    // Identity for a color value — it is already in the canonical form. A
    // tuple at this position is sRGB components and still has to be
    // converted.
    return gpuParenthesizeIdentity(
      c,
      gpuColorEntryOperand('AsOklch', c, compile, target),
      target
    );
  },

  AsOklab: ([c], compile, target) => {
    if (c === null) throw new Error('Could not compile `AsOklab`: no argument');
    return `_gpu_oklch_to_oklab(${gpuColorEntryOperand(
      'AsOklab',
      c,
      compile,
      target
    )})`;
  },

  AsRgb: ([c], compile, target) => {
    if (c === null) throw new Error('Could not compile `AsRgb`: no argument');
    return gpuRgbBoundary(
      c,
      gpuColorEntryOperand('AsRgb', c, compile, target),
      target
    );
  },

  AsHsv: ([c], compile, target) => {
    if (c === null) throw new Error('Could not compile `AsHsv`: no argument');
    return `_gpu_rgb_to_hsv(_gpu_oklch_to_srgb(${gpuColorEntryOperand(
      'AsHsv',
      c,
      compile,
      target
    )}))`;
  },

  AsHsl: ([c], compile, target) => {
    if (c === null) throw new Error('Could not compile `AsHsl`: no argument');
    return `_gpu_rgb_to_hsl(_gpu_oklch_to_srgb(${gpuColorEntryOperand(
      'AsHsl',
      c,
      compile,
      target
    )}))`;
  },

  // Fractal functions
  Mandelbrot: ([c, maxIter], compile) => {
    if (c === null || maxIter === null)
      throw new Error('Could not compile `Mandelbrot`: missing arguments');
    const iterCode = compileIntArg('Mandelbrot', maxIter, compile);
    return `_fractal_mandelbrot(${gpuComplexOperand(c, compile)}, ${iterCode})`;
  },
  Julia: ([z, c, maxIter], compile) => {
    if (z === null || c === null || maxIter === null)
      throw new Error('Could not compile `Julia`: missing arguments');
    const iterCode = compileIntArg('Julia', maxIter, compile);
    return `_fractal_julia(${gpuComplexOperand(z, compile)}, ${gpuComplexOperand(c, compile)}, ${iterCode})`;
  },

  // Vector/Matrix operations
  Cross: 'cross',
  Distance: 'distance',
  Dot: 'dot',
  // The GLSL `length()` builtin is the Euclidean NORM of a vector, which
  // is CE `Norm` — NOT CE `Length` (element count; fails closed below).
  // `length()` only accepts scalars and vec2/3/4: a fixed-arity point or list
  // literal outside that range compiles to an ARRAY constructor
  // (`float[5](...)`), which `length()` rejects — so emit `abs` for arity 1
  // and fail closed for arity ≥ 5 or a norm-type argument rather than
  // reporting success on invalid shader source.
  //
  // `markAggregateConsuming` for a point with a broadcasting component only:
  // that form compiles the explicit norm, whose own nodes pass the shape
  // gates, and the emission no longer contains the point operand, which has
  // no shader shape of its own (it reads as an array).
  Norm: markAggregateConsuming((args, compile, target) => {
    if (args.length > 1)
      throw new Error(
        `Could not compile \`Norm\`: only the default L2 norm compiles on the ` +
          `${target.language ?? 'GPU'} target.`
      );
    const arg = args[0];
    // A point with a broadcasting component is one point per element of its
    // list components, so its norm is one number per element, as on the
    // JavaScript target. It compiles as the explicit
    // `Sqrt(Square(c1) + … + Square(cn))`, which the shader target lowers
    // element-wise to the same vector as the norm written by hand. This
    // requires that the list components have one length that the static
    // types give (`explicitBroadcastPointNorm`): a shader vector has a
    // static width, and the run-time zip of a `PointList` to its shortest
    // list has no shader form. Other cases fail closed.
    if (
      (isFunction(arg, 'Tuple') || isFunction(arg, 'PointList')) &&
      pointHasBroadcastComponent(arg)
    ) {
      const explicit = explicitBroadcastPointNorm(arg, target);
      if (typeof explicit === 'string')
        throw new Error(
          `Could not compile \`Norm\`: a point with a broadcasting component, and ${explicit}.`
        );
      return compile(explicit);
    }
    if (isFunction(arg, 'Tuple') || isFunction(arg, 'List')) {
      // A broadcasting component of a `List` is not a matrix row: it means
      // one norm per zipped element, not a scalar. Fail closed.
      if (pointHasBroadcastComponent(arg))
        throw new Error(
          'Could not compile `Norm`: a point with a broadcasting component.'
        );
      const n = arg.nops;
      if (n === 0 || n > 4)
        throw new Error(
          `Could not compile \`Norm\`: the ${target.language ?? 'GPU'} 'length()' builtin only ` +
            `accepts 2-4 component vectors (got ${n}).`
        );
      // A complex entry lowers to a `vec2` of (re, im), and an array of
      // them is not a `length()` operand. The 2-norm is the length of the
      // vector of the entries' moduli: `length(z)` for a complex entry, the
      // value itself for a real one (only its square is used).
      if (arg.ops.some((x) => BaseCompiler.isComplexValued(x))) {
        const moduli = arg.ops.map((x) => {
          if (BaseCompiler.isComplexValued(x)) return `length(${compile(x)})`;
          // A real entry must be a scalar: a point beside a complex entry
          // would put a `vec2` inside the vector of moduli.
          if (gpuOperandShape(x) !== 'scalar')
            throw new Error(
              `Could not compile \`Norm\`: the entry \`${x.toString()}\` is not a scalar, so it ` +
                `has no modulus beside a complex entry.`
            );
          return compile(x);
        });
        if (n === 1) return moduli[0];
        return `length(${gpuFVec(n)}(${moduli.join(', ')}))`;
      }
      if (n === 1) return `abs(${compile(arg.op1)})`;
      return `length(${compile(arg)})`;
    }
    // Non-literal operand (e.g. a vec-typed symbol): `length()` applies.
    return `length(${compile(arg)})`;
  }, isBroadcastPointNormOperand),
  // `markAggregateConsuming`: the operand is not written. The count of a
  // point or a list with a static count is a constant: the fragment pass
  // recorded the type of the operand (`fragmentFactsUnder()`). Any other
  // operand declines.
  Length: markAggregateConsuming((args, _compile, target) => {
    const facts = fragmentFactsUnder(
      (target as FragmentTargetFields<string>).fragmentScope,
      args[0]
    );
    const t = facts?.type;
    const count =
      t?.kind === 'point' ? t.size : t?.kind === 'list' ? t.count : undefined;
    if (args.length === 1 && count !== undefined) return formatGPUNumber(count);
    throw new Error(
      `Could not compile \`Length\`: the collection element count is not supported on the ` +
        `${target.language ?? 'GPU'} target: the '${target.language ?? 'GPU'}' ` +
        `'length()' builtin is the Euclidean norm (CE 'Norm'), not a count.`
    );
  }),
  Normalize: 'normalize',
  Reflect: 'reflect',
  Refract: 'refract',

  // Sum/Product — unrolled or for-loop (indexed form), or a fold over the
  // operand's components (collection form).
  //
  // `markAggregateConsuming` for the COLLECTION form only: there the reduction
  // DESTRUCTURES its operand into scalars, so the emission carries none of the
  // operand's `vecN`/array shape and must not be judged against it. The
  // indexed form's operands (a scalar body and a `Limits`) stay gated.
  Sum: markAggregateConsuming(
    (args, compile, target) =>
      compileGPUSumProduct('Sum', args, compile, target),
    gpuIsCollectionReduceForm
  ),
  Product: markAggregateConsuming(
    (args, compile, target) =>
      compileGPUSumProduct('Product', args, compile, target),
    gpuIsCollectionReduceForm
  ),

  // Range — inline constant array literal (bounds must be compile-time constants)
  Range: (args, _compile, target) => {
    if (args.length < 2 || args.length > 3) {
      throw new Error(
        'Could not compile `Range`: GPU compile expects 2 or 3 arguments (lo, hi, step?)'
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
        'Could not compile `Range`: GPU compile requires constant numeric bounds' +
          ' (non-constant ranges must be materialized at JS host then uploaded as a uniform)'
      );
    }
    if (step === 0)
      throw new Error('Could not compile `Range`: step cannot be zero');
    const count = rangeCount(lo, hi, step);
    if (count === 0) {
      throw new Error(
        'Could not compile `Range`: empty range (lo > hi for positive step, or lo < hi for negative step)'
      );
    }
    assertGPUInlineElementCount('Range', count);
    const values: number[] = [];
    for (let i = 0; i < count; i++) values.push(lo + i * step);
    const arrayType = `float[${count}]`;
    return `${arrayType}(${values
      .map((v) => formatGPUNumber(v, target.language))
      .join(', ')})`;
  },

  // Loop — GPU for-loop (no IIFE, no let)
  //
  // A `Loop` over several `Element` clauses visits every combination of
  // the indices, with the first clause as the outermost loop, as the
  // interpreter does: `Loop(s := s + j, Element(i, Range(1, 3)),
  // Element(j, Range(1, 3)))` adds 1 + 2 + 3 three times. Each clause
  // emits one nested `for` statement.
  Loop: (args, _compile, target) => {
    if (!args[0]) throw new Error('Could not compile `Loop`: no body');
    if (!args[1]) throw new Error('Could not compile `Loop`: no indexing set');

    const clauses = args.slice(1);
    // A `Break` stops the whole loop in the interpreter, but in nested
    // `for` statements it leaves only the innermost one. A `Continue`
    // goes to the next turn of the innermost loop on both, so it is
    // accepted.
    BaseCompiler.assertBreakLeavesWholeLoop(clauses, args[0]);

    const intType = 'int';

    // The counter is declared as an integer (for `i++`), but shader scalar math
    // is float. Consume the index as a float (`float(i)`) so it is
    // type-consistent wherever the body uses it in float arithmetic — mirroring
    // the Sum/Product for-loop path.
    const indexAsFloat = (index: string) => `float(${index})`;

    const indices: string[] = [];
    const headers: string[] = [];
    // The compiled guard of each clause, or `undefined` for a clause with
    // no guard.
    const tests: (string | undefined)[] = [];
    // For each clause, the statements that read a bound at run time, placed
    // before the `for` statement of the clause: inside the loops of the
    // clauses before it, so that a bound is read each time the loop of its
    // clause starts, as the interpreter evaluates the `Range` of an inner
    // clause each time the outer loop enters it (a body that writes the
    // bound changes the next inner loop).
    const prologues: string[][] = [];
    for (const indexing of clauses) {
      if (!isFunction(indexing, 'Element'))
        throw new Error(
          'Could not compile `Loop`: expected Element(index, Range(lo, hi))'
        );

      const indexExpr = indexing.ops[0];
      // The domain of a lowered `parallel for` (`lowerParallelHeads()`) is
      // marked `ParallelDomain(Range(…))`. The shader runs its passes in
      // order, as a counted loop over the range.
      const domain = indexing.ops[1];
      const rangeExpr =
        isFunction(domain, 'ParallelDomain') && domain.nops === 1
          ? domain.op1
          : domain;

      if (!isSymbol(indexExpr))
        throw new Error('Could not compile `Loop`: index must be a symbol');
      if (!isFunction(rangeExpr, 'Range'))
        throw new Error('Could not compile `Loop`: expected Range(lo, hi)');

      const index = indexExpr.symbol;
      // The loop index is declared and referenced bare — reject a reserved
      // name.
      gpuCheckIdentifier(index, target.language);
      // Two clauses with the same index would declare the same counter
      // twice, and the inner one would hide the outer one.
      if (indices.includes(index))
        throw new Error(
          `Could not compile \`Loop\` on this target: two Element clauses use the same index \`${index}\``
        );
      // A bound or a step that reads an outer index (`Element(j, Range(1,
      // i))`) is compiled outside the scope that declares the index, where
      // the name is an input of the shader. Decline it.
      const outer = indices.find((name) => rangeExpr.has(name));
      if (outer !== undefined)
        throw new Error(
          `Could not compile \`Loop\` on this target: the \`Range\` of the index \`${index}\` reads the outer index \`${outer}\`, and the bounds of a shader loop do not read an index`
        );

      // A number literal, or a symbol of the engine whose value is known
      // when the shader is compiled (`Range(1, N)` with `N := 4`), gives a
      // finite value through `.re`, which is written in the `for`
      // statement; the JavaScript target folds such a value the same way.
      // Any other bound (`Range(1, e)` with `e` a local of the function, or
      // `Range(1, n)` with `n` an input of the shader) is compiled as code
      // and read into an integer temporary before the `for` statement of
      // its clause, so that the number of turns follows its value at run
      // time, as on the JavaScript target. The value of a local is never
      // read from the expression: a local declared with a value and
      // assigned later (`let e = 0; …; e = m`) would give the value of its
      // declaration, and the loop would run the wrong number of turns. A
      // run-time bound must have the static type `integer`: the counter is
      // a shader integer, and the integer conversion of a run-time value
      // rounds toward zero, so a non-integer bound would not follow the
      // rounding of the `Range` of the interpreter. A number literal that is
      // not finite (`Range(1, +oo)`) is declined with its own message.
      const prologue: string[] = [];
      prologues.push(prologue);
      const bound = (which: 0 | 1): string => {
        const b = rangeExpr.ops[which];
        // A symbol that `vars` maps to an input of the shader is read from
        // that input, as everywhere else in the code, never from a value
        // stored in the engine.
        if (
          isNumber(b) ||
          (isSymbol(b) &&
            !gpuIsBoundName(b.symbol, target) &&
            target.varsKeys?.has(b.symbol) !== true)
        ) {
          const value = b.re;
          if (Number.isFinite(value)) return `${Math.floor(value)}`;
          if (isNumber(b))
            throw new Error(
              'Could not compile `Loop`: bounds must be finite numbers'
            );
        }
        // The bound compiles with a statement sink of its own, so that a
        // statement it hoists (a loop-form `Sum`, a temporary) goes into
        // the prologue of its clause, and runs each time the loop of the
        // clause starts, not once ahead of the whole loop.
        const lines = BaseCompiler.compileListStatement(target, b, (t) => [
          BaseCompiler.compile(b, t),
        ]);
        const code = lines.pop()!;
        const folded = numericLiteralSource(code);
        if (
          folded !== undefined &&
          Number.isFinite(folded) &&
          lines.length === 0
        )
          return `${Math.floor(folded)}`;
        if (!b.type.matches('integer'))
          throw new Error(
            `Could not compile \`Loop\` on this target: the ${which === 0 ? 'lower' : 'upper'} bound \`${b.toString()}\` of the \`Range\` of the index \`${index}\` is read at run time, so it must have the static type \`integer\` (it has the type \`${b.type.toString()}\`)`
          );
        if (code.includes('\n'))
          throw new Error(
            `Could not compile \`Loop\` on this target: the ${which === 0 ? 'lower' : 'upper'} bound \`${b.toString()}\` of the \`Range\` of the index \`${index}\` compiles to statements, which the read of a bound cannot hold`
          );
        const name = BaseCompiler.tempVar(target);
        prologue.push(
          ...lines.map((line) => (/[;}]\s*$/.test(line) ? line : `${line};`)),
          `int ${name} = int(${code});`
        );
        return name;
      };
      const lower = bound(0);
      const upper = bound(1);

      // The step of the range. The JavaScript target advances the counter by
      // it (`Range(1, 10, 3)` visits 1, 4, 7 and 10); the shader loop visited
      // every integer of the range instead. The counter is a shader integer,
      // so the step must be a non-zero integer known at compile time; a
      // negative step counts down.
      let step = 1;
      if (rangeExpr.ops.length >= 3) {
        const stepValue = rangeExpr.ops[2].re;
        if (!Number.isInteger(stepValue) || stepValue === 0)
          throw new Error(
            'Could not compile `Loop` on this target: the step of the `Range` must be a non-zero integer known at compile time'
          );
        step = stepValue;
      }

      const indexDecl = `${intType} ${index}`;
      const condition =
        step > 0 ? `${index} <= ${upper}` : `${index} >= ${upper}`;
      const advance = step === 1 ? `${index}++` : `${index} += ${step}`;
      indices.push(index);
      headers.push(`for (${indexDecl} = ${lower}; ${condition}; ${advance}) {`);

      // A guarded clause, `Element(i, Range(1, 5), Greater(i, 2))`: the
      // interpreter visits an element (and runs the later clauses and the
      // body for it) only when the guard evaluates to `True` (`runNested`).
      // A guard that is `False` or undecided skips the element. The guard
      // compiles to an `if` statement inside the `for` statement of its
      // clause, around the code of the later clauses and the body. A shader
      // comparison with a NaN operand is `false`, and the interpreter gives
      // `False` for it too (`Greater(1, NaN)`), so `!(i > x)` with `x` NaN
      // is `true` on both. The guard reads the indices of its clause and of
      // the clauses before it. A guard that is not a boolean has no shader
      // test, and a guard that needs statements (a loop-form `Sum`, a
      // `Block`) has no place before the test, so both decline.
      const guard = indexing.ops[2];
      if (guard === undefined || isSymbol(guard, 'Nothing')) {
        tests.push(undefined);
        continue;
      }
      if (!isSubtype(guard.type.type, 'boolean'))
        throw new Error(
          `Could not compile \`Loop\` on this target: the guard of the index \`${index}\` is not a boolean (type \`${guard.type.toString()}\`)`
        );
      if (gpuNeedsStatements(guard))
        throw new Error(
          `Could not compile \`Loop\` on this target: the guard of the index \`${index}\` needs statements, which a shader \`if\` condition cannot hold`
        );
      const visible = [...indices];
      tests.push(
        BaseCompiler.compile(guard, {
          ...target,
          var: (id) =>
            visible.includes(id) ? indexAsFloat(id) : target.var(id),
          ...BaseCompiler.withBoundScope(target, visible),
        })
      );
    }

    // The body is a STATEMENT LIST, not a value: compiled for a value, a
    // multi-statement body emitted `return <last statement>` inside the loop
    // — returning from the shader on the first iteration. It is also the
    // position where a destructuring assign (`(a, b) := (b, a + b)`) lowers.
    const bodyCode = BaseCompiler.compileStatementList(args[0], {
      ...target,
      shaderLoopJumps: gpuShaderLoopJumps(args[0]),
      var: (id) => (indices.includes(id) ? indexAsFloat(id) : target.var(id)),
      // The counters shadow any same-named engine symbol (an index named `i`
      // must not resolve to the imaginary unit in the operand analysis).
      ...BaseCompiler.withBoundScope(target, indices),
    });

    // Every line of the body arrives terminated by the statement-list
    // joiner (`compileStatementList`), so the body is only indented here.
    // Each `for` statement, from the innermost one, then encloses the code
    // inside it and indents it once more. The `if` statement of a guard is
    // directly inside the `for` statement of its clause.
    const indent = (code: string) =>
      code
        .split('\n')
        .map((line) => `  ${line}`)
        .join('\n');
    let code = bodyCode;
    // Each pass of each `for` statement counts against the pass cap of the
    // evaluation (`gpuPassCountStatement`), before the guard of its clause.
    const passCount = gpuPassCountStatement(target);
    for (let k = headers.length - 1; k >= 0; k--) {
      const test = tests[k];
      if (test !== undefined) code = `if (${test}) {\n${indent(code)}\n}`;
      if (passCount !== undefined) code = `${passCount}\n${code}`;
      code = `${headers[k]}\n${indent(code)}\n}`;
      const prologue = prologues[k];
      if (prologue.length > 0) code = `${prologue.join('\n')}\n${code}`;
    }
    return code;
  },

  // Statistical functions

  /**
   * GCD and LCM of any number of scalar, vector or literal-list operands: a
   * fold of the two-argument preamble helpers `_gpu_gcd` (Euclidean algorithm
   * via `mod`) and `_gpu_lcm` over the components (`compileGPUGcdLcm`).
   *
   * `markAggregateConsuming`: the fold DESTRUCTURES its collection operands
   * into scalar components, as the `Max`/`Min` reduction does.
   */
  GCD: markAggregateConsuming((args, compile, target) =>
    compileGPUGcdLcm('GCD', args, compile, target)
  ),
  LCM: markAggregateConsuming((args, compile, target) =>
    compileGPUGcdLcm('LCM', args, compile, target)
  ),

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
  Variance: markAggregateConsuming((args, compile, target) => {
    // Normalise: if single List arg, use its elements; else use args directly.
    let elems: ReadonlyArray<Expression>;
    if (args.length === 1 && isFunction(args[0], 'List')) {
      elems = args[0].ops;
    } else if (args.length >= 2) {
      elems = args;
    } else {
      throw new Error(
        'Could not compile `Variance`: GPU target requires a List argument or at least 2 scalar arguments'
      );
    }
    const n = elems.length;
    if (n < 2)
      throw new Error('Could not compile `Variance`: need at least 2 elements');
    // Every element is spliced 2 + 2·N times (once per mean term, plus twice
    // per squared deviation), so an IMPURE (Random-family) element was drawn
    // once per splice — `Variance(Random(), Random())` consumed TWELVE draws
    // where the interpreter draws two. Bind impure elements to a hoisted
    // temporary each; pure elements compile directly (byte-identical).
    const compiled = elems.map((e) =>
      gpuOperandOnce('Variance', e, compile, target)
    );
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
  Median: markAggregateConsuming((args, compile, target) => {
    // Normalise to element list
    let elems: ReadonlyArray<Expression>;
    if (args.length === 1 && isFunction(args[0], 'List')) {
      elems = args[0].ops;
    } else if (args.length >= 1) {
      elems = args;
    } else {
      throw new Error(
        'Could not compile `Median`: GPU target requires a List argument or at least 1 scalar argument'
      );
    }
    const n = elems.length;
    if (n === 0) throw new Error('Could not compile `Median`: empty list');
    if (n > 8) {
      throw new Error(
        `Could not compile \`Median\`: GPU target supports up to 8 elements via inline sorting network (got ${n}). ` +
          'For larger lists, compute on the CPU and pass the result as a uniform.'
      );
    }

    // Compile each element. We'll refer to them by variable names v0..vN-1.
    // Build a sequence of min/max comparators that sort the array in place.
    // Then return the middle element (or average of two middles for even N).
    const compiled = elems.map((e) => compile(e));

    // For N=1, median is the single element. That is an identity lowering, so
    // the element keeps its grouping in an infix parent
    // (`gpuParenthesizeIdentity`). CE-251.1.
    if (n === 1) return gpuParenthesizeIdentity(elems[0], compiled[0], target);

    // Build a small inline sort using a Batcher odd-even sort network.
    // We represent the "array" as a mutable JS array of code strings.
    // Each "comparator" sorts a pair: (v[i], v[j]) → min then max.
    // We inline this as: new_i = min(a, b); new_j = max(a, b)
    // But since GLSL has no statements in expressions, we encode
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
    // We emit a per-size preamble (GPU_MEDIAN_PREAMBLE_N_GLSL)
    // and return a call to `_gpu_median_N(v0, v1, ..., vN-1)`.
    return `_gpu_median_${n}(${compiled.join(', ')})`;
  }, gpuDestructuresListOperand),

  /**
   * One draw from the counter-based PCG3D stream — the GPU tier of the
   * random family redesign
   * (`docs/RANDOMNESS-MODEL.md` §2, §4, §7).
   *
   * Every form returns a GLSL `float`, so it composes with the
   * surrounding float arithmetic without a cast. The domain forms return an
   * integer-valued float (the result of `floor`) for a `Range`, matching the
   * convention `Floor` and the other ostensibly integer-returning operators
   * of this target use.
   *
   * | Form | GLSL |
   * |---|---|
   * | `Random()` inside `WithRandomSeed` | `hash(seed, n)` |
   * | `Random(Interval/Range)` inside a frame | arithmetic on the draw |
   * | `Random()` unframed | fragment stage: spatial noise; any other stage **throws** |
   * | `Random(collection)` | **throws** — no general indexing |
   *
   * The presented value is `(w0 >> 8) * 2⁻²⁴` — an EXACT power-of-two
   * conversion of the top 24 bits of the same `w0` the f64 tier is built
   * from, so the two tiers agree to within 2⁻²⁴ by construction rather than
   * by tuning. See `gpuRandomDraw`.
   *
   * `markAggregateConsuming` for the one-operand form: the DOMAIN is a
   * collection (an `Interval` is `set<real>`, a `Range` is `range`), and
   * `gpuRandomDomainDraw` DESTRUCTURES it into scalar endpoints — the draw
   * arithmetic contains the endpoints, never the collection. Without the
   * declaration the generic shape gate judges the emission against an array
   * operand shape that the emission does not contain. A domain this head
   * cannot destructure still fails closed, through the head's own diagnostic.
   */
  Random: markAggregateConsuming(
    (args, compile, target) => {
      if (args.length === 0) return gpuRandomDraw(target);
      if (args.length === 1)
        return gpuRandomDomainDraw(args[0], compile, target);
      throw new Error(
        'Could not compile `Random`: expects at most one operand, the DOMAIN to draw from ' +
          '(`Random()`, `Random(Interval(a, b))`, `Random(Range(…))`). The ' +
          'seed argument was removed by the Random family redesign — seed ' +
          'with `WithRandomSeed(seed, body)`.'
      );
    },
    (args) => args.length === 1
  ),

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
        'Could not compile `WithRandomSeed(seed, body)`: expects exactly two operands'
      );
    const state = gpuRandomState(target);
    // The seed is folded ONCE per frame, before the body is compiled.
    const seed = gpuFoldSeedSource(args[0], compile, target);
    const counter = allocGPURandomCounter(state);
    state.frames.push({ seed, counter });
    try {
      return gpuIdentityPassthrough(args[1], compile, target);
    } finally {
      state.frames.pop();
    }
  },

  // The multi-draw members of the family need general collection indexing (or
  // a mutable permutation buffer), which a shader expression has no way to
  // express. Fail closed with the reason rather than let them fall
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

  // `Apply(callee, args…)`: the parse of `f'(x)` is
  // `Apply(Derivative(f, 1), x)`. A shader has no function values, so the
  // callee cannot be emitted as a lambda. Instead, the arguments are
  // substituted into the body of the callee's function literal, and the
  // substituted body is compiled (`gpuAppliedBody`). The `Apply` node is a
  // function call to its parent, so its code is spliced into an infix
  // parent as one operand: a body with an infix head (`9x² + cos x`, the
  // derivative of `x³ + sin x`) is parenthesized, or `3·h'(x)` compiled to
  // `9.0 * (x * x) + cos(x)`.
  //
  // A trusted lowering (`fragmentReplaceOperands()`). Input:
  // `Apply(callee, x…)`, where the callee is a function literal or the
  // derivative of a function with a closed form. Output: the body of the
  // literal with each parameter replaced by its argument, or, for a
  // collection argument, a `List` of such bodies. Condition: the body is
  // one expression, each argument is pure, and the body binds no name that
  // an argument reads (`gpuAppliedBody()`). The value is the interpreter's:
  // the call evaluates the body with the parameters bound to the values of
  // the arguments, and a pure argument read twice has one value. The check
  // accepts any head, since the heads are those of the body.
  Apply: (args, compile, target) => {
    const body = gpuAppliedBody(args, target);
    if (typeof body === 'string')
      throw new Error(`Could not compile \`Apply\`: ${body}`);
    return gpuIdentityPassthrough(
      fragmentReplaceOperands(
        args,
        body,
        {
          name: 'the body of an applied function',
          operators: 'any',
          symbolLeaves: true,
        },
        target
      ),
      compile,
      target
    );
  },

  // Function (lambda) — not supported in GPU
  Function: () => {
    throw new Error(
      'Anonymous functions (Function) are not supported in GPU targets'
    );
  },
};

// `Power(2, y)` emits `exp2(y)` and leaves the base out of the emitted call;
// the operand-shape check reads that declaration (`GPU_OPERAND_CONSUMING`).
markOperandConsuming(GPU_FUNCTIONS.Power, gpuAbsorbedConstant('exp2', 0, 2));

// `Clamp`, `ElementMax` and `ElementMin` of finite operands emit the built-in
// `min`/`max` with each scalar operand broadcast to the vector width
// (`Clamp(v, 0, 1)` → `min(max(v, vec3(0.0)), vec3(1.0))`). The scalar
// operands do not reach the emitted calls, so the operand-shape check judges
// the vector operands only (`GPU_OPERAND_CONSUMING`, `gpuBroadcastScalars`).
markOperandConsuming(GPU_FUNCTIONS.Clamp, gpuBroadcastScalars('min', 0));
markOperandConsuming(GPU_FUNCTIONS.ElementMax, gpuBroadcastScalars('max'));
markOperandConsuming(GPU_FUNCTIONS.ElementMin, gpuBroadcastScalars('min'));

/**
 * The `consumed` predicate (`GPU_OPERAND_CONSUMING`) of a lowering that
 * broadcasts its scalar operands itself, with the vector constructor, before
 * it calls the built-in `callee`: the 0-based positions of the scalar
 * operands, or `undefined` for every other form. That form is a call of
 * `callee` (not of a `_gpu_` helper) on non-complex operands that are scalars
 * and `vecN` values of ONE width, with at least one of each, and a vector at
 * position `main` when it is given (`Clamp` broadcasts only its bounds).
 *
 * Without it the check reads the nested call `max(v, vec3(0.0))` of a
 * three-operand `Clamp` as a scalar `v` (a bare identifier has no shape in the
 * source, `gpuSourceIsVector`) beside a vector, and declines valid source.
 */
function gpuBroadcastScalars(
  callee: 'min' | 'max',
  main?: number
): (
  args: ReadonlyArray<Expression>,
  code: string
) => ReadonlySet<number> | undefined {
  return (args, code) => {
    if (gpuTopLevelCall(code)?.callee !== callee) return undefined;
    if (args.some((a) => a === null || a === undefined)) return undefined;
    if (args.some((a) => BaseCompiler.isComplexValued(a))) return undefined;
    const shapes = args.map(gpuOperandShape);
    if (main !== undefined && typeof shapes[main] !== 'number')
      return undefined;
    const widths = new Set(shapes.filter((s) => typeof s === 'number'));
    if (widths.size !== 1) return undefined;
    if (!shapes.every((s) => s === 'scalar' || typeof s === 'number'))
      return undefined;
    const scalars = new Set<number>();
    shapes.forEach((s, i) => {
      if (s === 'scalar') scalars.add(i);
    });
    return scalars.size > 0 ? scalars : undefined;
  };
}

/**
 * The body of the callee of `Apply(callee, args…)` with the arguments
 * substituted for its parameters, or the reason why there is none.
 *
 * Two callees have a function literal. A `Function` literal is its own
 * literal. A `Derivative(f, n)` or a `Derivative(f, k₁, …, kₙ)` has the
 * closed form of the derivative when the engine can differentiate `f`, and
 * the interval target reads the same closed form
 * (`BaseCompiler.appliedDerivativeLiteral`). That closed form is
 * already rewritten for the engine's angular unit. It is not used when the
 * body of `f` is large or the order is high (`prefersJetDerivative`,
 * jet-derivative.ts), because the closed form then grows past a useful size.
 * A derivative with no closed form of a useful size, or any other callee, has
 * no literal, and the application is declined.
 *
 * The substitution is sound only under these conditions:
 *  - the literal takes exactly one argument per parameter, and each
 *    parameter is a plain name (not a rest parameter and not a
 *    destructuring pattern). The interpreter curries an under-applied call
 *    and rejects an over-applied one. Partial applications and calls of
 *    their results decline on every compile target;
 *  - the body is a single statement;
 *  - every argument is pure. The body can read a parameter more than once,
 *    and the substitution then repeats the argument, while the interpreter
 *    evaluates it once;
 *  - no binder in the body rebinds a parameter or binds a symbol of an
 *    argument. This condition is stricter than the substitution needs:
 *    `subs` replaces only the free occurrences of a parameter, and renames
 *    an inner binder that would capture a symbol of an argument, except in
 *    the cases that `subsIfCaptureFree()`
 *    (`boxed-expression/subs-capture-mode.ts`) lists.
 *
 * When the parameters of the literal are scalar and an argument is a
 * collection, the interpreter applies the function to each element, not to
 * the whole collection. The substitution then follows the same rule
 * (`gpuMappedAppliedBody`).
 *
 * An argument that is bound whole must match the declared type of its
 * parameter (`BaseCompiler.appliedArgumentTypeMismatch`), or the
 * application is declined.
 */
function gpuAppliedBody(
  args: ReadonlyArray<Expression>,
  target: CompileTarget<Expression>
): Expression | string {
  // Diagnose currying before inspecting the literal's parameters.
  try {
    assertNoCurriedApplication(args);
  } catch (e) {
    return (e as Error).message.replace(/^Could not compile `Apply`: /, '');
  }
  if (isPartialApplication(args)) return partialApplicationDecline();
  const [callee, ...written] = args;
  if (callee === undefined) return 'missing function';
  let actuals: ReadonlyArray<Expression> = written;
  const literal = isFunction(callee, 'Derivative')
    ? BaseCompiler.appliedDerivativeLiteral(args)
    : callee;
  if (!isFunction(literal, 'Function')) {
    if (isFunction(callee, 'Derivative'))
      return (
        `${BaseCompiler.appliedDerivativeDeclineReason(args)}, and ` +
        `target '${target.language}' has no numerical derivative.`
      );
    return (
      `only a function literal or the derivative of a function compiles as ` +
      `the callee on target '${target.language}'.`
    );
  }
  // A call that leaves out parameters with a default value is completed with
  // the default operands, as operands written at this call site
  // (`completedLiteralArguments`): a shader function has no default
  // parameters.
  const completed = completedLiteralArguments(literal, actuals);
  if (completed !== undefined) actuals = completed;
  const params = literal.ops.slice(1);
  if (params.length !== actuals.length)
    return (
      `the function takes ${params.length} parameter(s) but ` +
      `${actuals.length} argument(s) are supplied.`
    );
  const substitution: Record<string, Expression> = {};
  for (const [i, p] of params.entries()) {
    const name = isRestParameter(p) ? '' : functionLiteralParameterName(p);
    if (!name) return 'a parameter of the function is not a plain name.';
    substitution[name] = actuals[i];
  }
  const inner = literal.ops[0];
  const body =
    isFunction(inner, 'Block') && inner.nops === 1 ? inner.op1 : inner;
  if (isFunction(body, 'Block'))
    return 'the body of the function has more than one statement.';
  if (!actuals.every((a) => a.isPure === true))
    return 'an argument has an effect, which the substitution would repeat.';
  const binders = collectBinderNames(body);
  for (const [name, arg] of Object.entries(substitution)) {
    if (binders.has(name))
      return `the body of the function rebinds \`${name}\`.`;
    for (const s of arg.symbols)
      if (binders.has(s))
        return `the body of the function binds \`${s}\`, which an argument reads.`;
  }
  if (literalParamsMap(literal.type.type) && actuals.some(gpuMapsOverArgument))
    return gpuMappedAppliedBody(
      literal,
      body,
      Object.keys(substitution),
      actuals,
      target
    );
  const mismatch = BaseCompiler.appliedArgumentTypeMismatch(
    literal,
    actuals,
    false
  );
  if (mismatch !== undefined) return mismatch;
  return body.subs(substitution);
}

/**
 * The application of a function literal with scalar parameters to arguments
 * of which at least one is a collection, written element by element:
 * `Apply(u ↦ body, [a, b])` becomes `[body[u := a], body[u := b]]`, or the
 * reason why it cannot be written.
 *
 * The interpreter applies such a function to each element of the collection
 * arguments (`applyLiteralMapped` in `library/core.ts`). It zips the
 * collection arguments, and it gives each cell the same value of an argument
 * that is not a collection (a scalar, a point or a string). Substituting the
 * whole collection for the parameter is wrong: a body that does not read
 * the parameter (`u ↦ 7`) gives one number instead of one number per
 * element, and a body with an operation that does not apply element by
 * element gives a different value.
 *
 * Each collection argument must have a length known at compile time
 * (`gpuMappedArgumentElements`), and all of them must have the same length.
 * The interpreter gives an `incompatible-dimensions` error for different
 * lengths, and a shader has no form of that error, so the application is
 * declined. A cell whose element is itself a collection maps again, as in
 * the interpreter, so a nested list gives a nested result. The shape of the
 * result is decided when the `List` is compiled.
 *
 * `names` are the parameter names of the literal, in order. The checks of
 * `gpuAppliedBody` (purity, binders) apply to the whole arguments, so they
 * also apply to their elements.
 */
function gpuMappedAppliedBody(
  literal: Expression,
  body: Expression,
  names: ReadonlyArray<string>,
  actuals: ReadonlyArray<Expression>,
  target: CompileTarget<Expression>
): Expression | string {
  let width: number | undefined;
  const columns: Array<ReadonlyArray<Expression> | undefined> = [];
  for (const actual of actuals) {
    if (!gpuMapsOverArgument(actual)) {
      columns.push(undefined);
      continue;
    }
    const elements = gpuMappedArgumentElements(actual);
    if (elements === undefined)
      return (
        `the function applies to each element of the argument ` +
        `\`${actual.toString()}\`, but target '${target.language}' cannot ` +
        `write out its elements: its length is not known at compile time, ` +
        `or it has more than ${GPU_MAX_INLINE_ELEMENTS} elements.`
      );
    if (width !== undefined && elements.length !== width)
      return (
        `the function applies to each element of collection arguments of ` +
        `different lengths (${width} and ${elements.length}).`
      );
    width = elements.length;
    columns.push(elements);
  }
  const cells: Expression[] = [];
  for (let k = 0; k < (width ?? 0); k++) {
    const row = actuals.map((actual, i) => columns[i]?.[k] ?? actual);
    if (
      row.some((e, i) => columns[i] !== undefined && gpuMapsOverArgument(e))
    ) {
      const cell = gpuAppliedBody([literal, ...row], target);
      if (typeof cell === 'string') return cell;
      cells.push(cell);
    } else {
      const mismatch = BaseCompiler.appliedArgumentTypeMismatch(
        literal,
        row,
        false
      );
      if (mismatch !== undefined) return mismatch;
      const substitution: Record<string, Expression> = {};
      for (const [i, name] of names.entries()) substitution[name] = row[i];
      cells.push(body.subs(substitution));
    }
  }
  return literal.engine.function('List', cells);
}

/**
 * Does a function literal with scalar parameters apply to each element of
 * the argument `arg`, not to `arg` as a whole?
 *
 * The interpreter evaluates the argument first and then asks whether the
 * value is an indexed collection that is not a tuple (a point) and not a
 * string (`applyLiteralMaps` in `library/core.ts`). Compiled code reads the
 * argument before it is evaluated, so the static type gives the answer
 * instead, as in the type handler of `Apply` (`applyLiteralMapType`):
 * `[a, b] + c` has the type `vector<2>` and is a list when evaluated, and a
 * symbol declared `list<real^2>` holds a list when the shader runs.
 */
function gpuMapsOverArgument(arg: Expression): boolean {
  if (isBroadcastableCollection(arg)) return true;
  const t = resolveTypeAlias(arg.type.type);
  return (
    isSubtype(t, INDEXED_COLLECTION_SHAPE_TYPE) &&
    !isSubtype(t, 'string') &&
    !(typeof t === 'object' && t.kind === 'tuple')
  );
}

/**
 * The elements of a collection argument that `gpuMappedAppliedBody` writes
 * out, or `undefined` when the length is not known at compile time.
 *
 * A literal `List` gives its operands. A `Range` with number-literal bounds
 * gives its values, as the `Range` entry of the function table does. Another
 * expression that the shader holds as a `vec2`, `vec3` or `vec4`
 * (`gpuOperandShape`) gives its components, read with `At`. Any other
 * collection (a shader array, a matrix, a list of unknown length) gives
 * `undefined`. A list with more elements than a shader array constructor
 * takes (`GPU_MAX_INLINE_ELEMENTS`) also gives `undefined`.
 */
function gpuMappedArgumentElements(
  arg: Expression
): ReadonlyArray<Expression> | undefined {
  const ce = arg.engine;
  if (isFunction(arg, 'List'))
    return arg.nops <= GPU_MAX_INLINE_ELEMENTS ? arg.ops : undefined;
  if (isFunction(arg, 'Range') && (arg.nops === 2 || arg.nops === 3)) {
    const lo = arg.ops[0].re;
    const hi = arg.ops[1].re;
    const step = arg.nops === 3 ? arg.ops[2].re : 1;
    if (![lo, hi, step].every(Number.isFinite) || step === 0) return undefined;
    const count = rangeCount(lo, hi, step);
    if (count > GPU_MAX_INLINE_ELEMENTS) return undefined;
    return Array.from({ length: count }, (_, k) => ce.number(lo + k * step));
  }
  const shape = gpuOperandShape(arg);
  if (typeof shape !== 'number') return undefined;
  return Array.from({ length: shape }, (_, k) =>
    ce.function('At', [arg, ce.number(k + 1)])
  );
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

  // Column vector (Nx1): flatten to vecN or float[N]
  if (numCols === 1 && rows.every((row) => isFunction(row) && row.nops === 1)) {
    const elements = rows.map((row) =>
      compile(isFunction(row) ? row.ops[0] : row)
    );
    if (numRows >= 2 && numRows <= 4)
      return `${vecFn(numRows)}(${elements.join(', ')})`;
    // The array form is bounded as every shader array constructor is.
    assertGPUInlineElementCount('Matrix', numRows);
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
