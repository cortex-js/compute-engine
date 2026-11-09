/**
 * The GLSL fragment: what the `glsl` target compiles, as one table of rules
 * (the positive list of `docs/plans/2026-11-08-glsl-fragment-spec.md`,
 * section 2, in code), and the GLSL representation of each type.
 *
 * The pass that reads this definition is `typeFragment()` in
 * `fragment.ts`. A head that is not in `GLSL_FRAGMENT_RULES` is outside the
 * fragment. A head that binds no name has a list of signatures; a head that
 * binds a name or restricts a place has a rule that walks.
 *
 * The emitter does not read this table yet: a head here also has an emitter
 * in `gpu-functions.ts` or `glsl-target.ts`, and the two lists must agree.
 */

import type { Expression, FunctionInterface } from '../global-types.js';
import type { Type } from '../../common/type/types.js';
import type { CompileTarget } from './types.js';
import {
  isFunction,
  isNumber,
  isSymbol,
} from '../boxed-expression/type-guards.js';
import { isValueDef } from '../boxed-expression/definition-guards.js';
import { isSubtype } from '../../common/type/subtype.js';
import {
  isNonRealNumber,
  resolveTypeAlias,
  resolveTypeForCompilation,
} from '../../common/type/utils.js';
import {
  declaredParamType,
  functionLiteralParameterName,
} from '../boxed-expression/function-literal.js';
import { collectBinderNames } from '../boxed-expression/utils.js';
import { userFunctionLiteral } from './compile-assignment-checks.js';
import {
  inlinedUserFunctionCall,
  userFunctionParamType,
} from './compile-user-calls.js';
import { definitionBodyExpr, userFunctionIsGeneric } from './compile-cse.js';
import { constantFoldValue } from './compiler-core.js';
import { core } from './compiler-core-hooks.js';
import {
  inlinePointCalls,
  inlinePointValues,
  reachableSymbolNames,
} from './point-value-inlining.js';
import { gpuPointCallsOverBudget } from './gpu-points.js';
import {
  bodyWithParallelHeadsLowered,
  sumAssignedNames,
} from './parallel-lowering.js';
import { gpuCheckIdentifier } from './gpu-reserved.js';
import { GPU_BINOMIAL_UNROLL_LIMIT, GPU_UNROLL_LIMIT } from './gpu-reduce.js';
import { unrollFits, unrolledTermSize } from './unroll-budget.js';
import { derivativeClosedForm } from './derivative-closed-form.js';
import { appliedDerivativeLiteral } from './compile-callbacks.js';
import { parseColorString } from '../library/colors.js';
import { GPU_MAX_INLINE_ELEMENTS } from './gpu-functions.js';
import { gpuStorageAtBaseShape } from './gpu-at.js';
import { BaseCompiler } from './base-compiler.js';
import {
  gpuImaginaryPiMultiple,
  gpuOperandShape,
  gpuResultIsComplexValued,
} from './gpu-shapes.js';
import { GPU_COLOR_SPACES, GPU_GAMUT_HELPERS } from './gpu-color.js';
import { colorSpaceIsUnsettled } from './color-space-fact.js';
import {
  arraysArePoints,
  isRuntimePointShaped,
  typeHasPointArm,
} from './compiler-type-facts.js';
import { gpuNormalizeShaderType } from './gpu-declared-types.js';
import { tryGetConstant } from './constant-folding.js';
import {
  assertSafeBigOpBounds,
  isShaderVariableRead,
  reachesCallerCodeOn,
} from './compile-folding.js';
import { complexContinuation } from './complex-continuation.js';
import { gpuShaderLoopJumps } from './gpu-statements.js';
import { shadowedLibraryLoweringError } from './compile-definitions.js';
import {
  fragmentScopeBinds,
  fragmentTypeToString,
  walkAggregate,
  walkAssign,
  walkAt,
  walkBlock,
  walkBreak,
  walkCountedLoop,
  walkDeclareOutsideBlock,
  walkElement,
  walkIf,
  walkList,
  walkParallelLoop,
  walkPoint,
  walkRange,
  walkTyped,
  walkWhich,
} from './fragment.js';
import type {
  FragmentContext,
  FragmentDefinition,
  FragmentFacts,
  FragmentFunction,
  FragmentListType,
  FragmentPattern,
  FragmentResultPattern,
  FragmentRule,
  FragmentScope,
  FragmentSignature,
  FragmentValueType,
  FragmentWalker,
} from './fragment.js';

/**
 * How the GLSL target holds a value: `float`, `int` (the index of a loop),
 * `uint` (an input that the caller declares so), `bool`, `vec2` to `vec4`
 * (a complex number, a point, a colour, a list of 2 to 4 reals), an array
 * (`float[n]`, `vecM[n]`) or `sampler2D` (a list input in a texture).
 */
export type GlslRepresentation = string;

/** The largest constant list that the GLSL target writes as an array: the
 * shader array limit. A list input in a texture has no limit. */
export const GLSL_FRAGMENT_ARRAY_LIMIT = GPU_MAX_INLINE_ELEMENTS;

//
// Types and representations (the design note, section 2)
//

/**
 * The fragment type of a value of the engine type `t`, or `undefined` when
 * the GLSL fragment has no type for it (`unknown`, `any`, `string`,
 * `expression`, a function, a matrix, a tuple of other than 2 to 4 real
 * components, a union of a point and a list).
 *
 * The engine type `number` (a symbol with no declaration has it) is a real:
 * the GLSL target reads it as a `float`, as it does today. A non-real
 * number type (`complex`, `imaginary`) is a complex number.
 */
export function glslFragmentTypeOf(
  t: Type | undefined
): FragmentValueType | FragmentListType | undefined {
  if (t === undefined || t === 'unknown' || t === 'any') return undefined;
  t = resolveTypeForCompilation(t);
  if (t === 'nothing' || t === 'never') return undefined;
  if (isSubtype(t, 'boolean')) return { kind: 'boolean' };
  if (isSubtype(t, 'color')) return { kind: 'color' };
  if (isNonRealNumber(t)) return { kind: 'complex' };
  if (isSubtype(t, 'integer')) return { kind: 'integer' };
  if (isSubtype(t, 'number')) return { kind: 'real' };
  if (typeof t === 'string') return undefined;
  if (t.kind === 'tuple') {
    const n = t.elements.length;
    if (n < 2 || n > 4) return undefined;
    if (
      !t.elements.every((e) => isRealType(resolveTypeForCompilation(e.type)))
    )
      return undefined;
    return { kind: 'point', size: n };
  }
  if (t.kind === 'list') {
    // A matrix (two dimensions or more) is outside the fragment.
    const dimensions = t.dimensions ?? undefined;
    if (dimensions !== undefined && dimensions.length !== 1) return undefined;
    const count =
      dimensions !== undefined && dimensions[0] >= 0
        ? dimensions[0]
        : undefined;
    // An element type with a non-real member (`complex | +oo | -oo`,
    // whose finite part is complex) is not a real: such a list is outside.
    const elements = t.elements;
    if (
      typeof elements !== 'string' &&
      elements.kind === 'union' &&
      elements.types.some((m) =>
        isNonRealNumber(resolveTypeForCompilation(m))
      )
    )
      return undefined;
    const element = glslFragmentTypeOf(t.elements);
    if (element === undefined) {
      // A list of reals that can be NaN or infinite
      // (`list<(real | signed_infinity | nan)^n>`): a list of reals.
      if (isSubtype(t.elements, 'number') && !isNonRealNumber(t.elements))
        return { kind: 'list', element: { kind: 'real' }, count };
      return undefined;
    }
    if (element.kind === 'real' || element.kind === 'integer')
      return { kind: 'list', element: { kind: 'real' }, count };
    if (element.kind === 'point') return { kind: 'list', element, count };
    return undefined;
  }
  return undefined;
}

/**
 * The fragment type of a name that the caller of `compileFunction()` or
 * `compileShader()` declares with the GLSL type spelling `spelling`, or
 * `undefined` when the spelling has no fragment type (`ivec2`, `bvec3`, a
 * matrix, an array, a struct): `float` is a real, `int` and `uint` are
 * integers, `bool` is a boolean, `vec2` to `vec4` are points.
 */
export function glslFragmentTypeOfSpelling(
  spelling: string
): FragmentValueType | undefined {
  const t = gpuNormalizeShaderType(spelling);
  if (t === undefined) return undefined;
  if (t.width === 1) {
    if (t.element === 'f') return { kind: 'real' };
    if (t.element === 'i' || t.element === 'u') return { kind: 'integer' };
    if (t.element === 'b') return { kind: 'boolean' };
    return undefined;
  }
  if (t.element === 'f' && t.width >= 2 && t.width <= 4)
    return { kind: 'point', size: t.width };
  return undefined;
}

/** Whether `t` is a real type: a component of a point. */
function isRealType(t: Type): boolean {
  return isSubtype(t, 'number') && !isNonRealNumber(t);
}

function vec(n: number): GlslRepresentation | undefined {
  return n >= 2 && n <= 4 ? `vec${n}` : undefined;
}

/** The GLSL representation of a computed value of the type `t`. */
export function glslRepresentationOfValue(
  t: FragmentValueType | FragmentListType
): GlslRepresentation | undefined {
  switch (t.kind) {
    case 'real':
    case 'integer':
      return 'float';
    case 'boolean':
      return 'bool';
    case 'complex':
      return 'vec2';
    case 'color':
      return 'vec3';
    case 'point':
      return vec(t.size);
    case 'list': {
      if (t.count === undefined || t.count < 1) return undefined;
      if (t.count > GLSL_FRAGMENT_ARRAY_LIMIT) return undefined;
      if (t.element.kind === 'point') {
        const v = vec(t.element.size);
        return v === undefined ? undefined : `${v}[${t.count}]`;
      }
      return vec(t.count) ?? `float[${t.count}]`;
    }
  }
}

//
// Signatures
//

const sig = (
  operands: readonly FragmentPattern[],
  result: FragmentResultPattern,
  extra: Partial<FragmentSignature> = {}
): FragmentSignature => ({ operands, result, ...extra });

/** A real function of one real operand. */
const REAL_1: FragmentRule<GlslRepresentation> = {
  signatures: [sig(['real'], 'real')],
};
/** A real function of one operand that also acts on each component of a
 * point (the GLSL `genType` functions). */
const REAL_OR_POINT_1: FragmentRule<GlslRepresentation> = {
  signatures: [sig(['real'], 'real'), sig(['point'], 'point')],
};
/** A function of one operand with a complex helper too, and that acts on
 * each component of a point. */
const ELEMENTARY: FragmentRule<GlslRepresentation> = {
  signatures: [
    sig(['real'], 'real'),
    sig(['complex'], 'complex'),
    sig(['point'], 'point'),
  ],
};
/** `Sqrt`: as `ELEMENTARY`, but a square root that the compiler reads as
 * complex (`isComplexValued()`, as for `Sqrt(-2)`) is a complex number:
 * the GLSL code writes it as a `vec2`, and a head that takes reals only
 * refuses it
 * (`Mod(Sqrt(-2), 1)`). */
const SQRT: FragmentRule<GlslRepresentation> = {
  walk: (node, scope, context, w) =>
    w.signatures(
      node,
      scope,
      context,
      core.isComplexValued(node)
        ? [sig(['complex'], 'complex')]
        : ELEMENTARY.signatures!
    ),
};
/** A real function of a fixed number of real operands. */
const real = (n: number): FragmentRule<GlslRepresentation> => ({
  signatures: [sig(Array(n).fill('real'), 'real')],
});
/** An arithmetic operation of two or more operands: reals, complex numbers,
 * or points with a scalar broadcast. */
const ARITHMETIC_N: FragmentRule<GlslRepresentation> = {
  signatures: [
    sig(['real'], 'real', { rest: 'real' }),
    sig(['complex'], 'complex', { rest: 'complex' }),
    sig(['point'], 'point', { rest: 'point', broadcast: true }),
  ],
};
/**
 * `And` and `Or`: booleans. GLSL evaluates an operand after the first only
 * when the operands before it do not decide the value, so the operand has
 * no place for the declarations of a block: an operand after the first
 * that holds a block (outside a function literal) is refused.
 */
const SHORT_CIRCUIT: FragmentRule<GlslRepresentation> = {
  walk: (node, scope, context, w) => {
    const ops = isFunction(node) ? node.ops : [];
    const block = ops.slice(1).find((x) => holdsBlock(x));
    if (block !== undefined)
      return w.refuse(
        block,
        'place',
        `An operand of \`${node.operator}\` after the first holds a block, ` +
          `which GLSL cannot evaluate there`
      );
    return w.signatures(node, scope, context, [
      sig(['boolean'], 'boolean', { rest: 'boolean' }),
    ]);
  },
};
/** Whether `node` is a `Block` or holds one, outside a function literal.
 * A node that several paths reach is searched once (`seen`): the search
 * of a shared graph is linear in its number of distinct nodes, not in its
 * number of paths. A node already searched holds no block, or the search
 * would have stopped there. */
function holdsBlock(
  node: Expression,
  seen: Set<Expression> = new Set()
): boolean {
  if (!isFunction(node) || node.operator === 'Function') return false;
  if (node.operator === 'Block') return true;
  if (seen.has(node)) return false;
  seen.add(node);
  return node.ops.some((x) => holdsBlock(x, seen));
}
/** `Add` and `Subtract`: as `ARITHMETIC_N`, but a real is broadcast to a
 * list only, not to a point: the interpreter refuses `(1, 2) + 3` (an
 * `incompatible-type` error) and takes `[1, 2] + 3`. */
const SUM_N: FragmentRule<GlslRepresentation> = {
  signatures: [
    sig(['real'], 'real', { rest: 'real' }),
    sig(['complex'], 'complex', { rest: 'complex' }),
    sig(['point'], 'point', {
      rest: 'point',
      broadcast: true,
      pointScalarSlots: [],
    }),
  ],
};
/**
 * `rule`, for `Add` or `Subtract`, with one more refusal: an operand
 * whose engine type may hold a point (a tuple arm, every array of the type
 * a point or a collection of points) beside an operand that is a number.
 * The sum of a point and a number is an `incompatible-type` error in the
 * interpreter, and the compiler declines it by the same test
 * (`assertNoListCoordinateOrPointNumberMix()` in `compiler-core.ts`):
 * `At(P, 1) + x` with `P: list<tuple<number, number>> | tuple<number,
 * number>` is refused, also when the value of `P` is a point.
 *
 * A name that `compileShader()` or `compileFunction()` declares with a
 * GLSL vector type (`vec2`, `vec3`, `vec4`; a built-in variable such as
 * `gl_FragCoord`), in `declaredVectors`, is a GLSL vector, not a point of
 * the user's expression, where the name is the declared input: no scope
 * of the expression or of a user function binds it again. An operand that
 * is a vector of the caller (`callerVector()`) is such a name, or an
 * arithmetic expression of such names and numbers (`2 * gl_FragCoord`,
 * `Sin(v)`). When every operand is a vector of the caller or a number,
 * and at least one is a vector, `broadcast` applies: a number is added to
 * each component, as GLSL does (`gl_FragCoord + 1`). A point of the
 * user's expression beside a number is still refused.
 */
function pointNumberSumRefused(
  rule: FragmentRule<GlslRepresentation>,
  declaredVectors?: ReadonlySet<string>,
  broadcast?: FragmentRule<GlslRepresentation>
): FragmentRule<GlslRepresentation> {
  return {
    walk: (node, scope, context, w) => {
      const ops = isFunction(node) ? node.ops : [];
      const number = (x: Expression): boolean =>
        isSubtype(x.type.type, 'number');
      const vector = (x: Expression): boolean =>
        declaredVectors !== undefined &&
        callerVector(x, (name) =>
          declaredVectors.has(name) && !fragmentScopeBinds(scope, name)
        );
      if (
        broadcast !== undefined &&
        ops.some(vector) &&
        ops.every((x) => number(x) || vector(x))
      )
        return 'walk' in broadcast
          ? broadcast.walk(node, scope, context, w)
          : w.signatures(node, scope, context, broadcast.signatures);
      const point = ops.find(
        (x) => typeHasPointArm(x.type.type) && arraysArePoints(x.type.type)
      );
      if (
        point !== undefined &&
        ops.some((x) => isSubtype(x.type.type, 'number'))
      )
        return w.refuse(
          node,
          'signature',
          `The operand \`${point.toString()}\` of \`${node.operator}\` ` +
            `may be a point by its type \`${point.type.toString()}\`, and ` +
            `another operand is a number`
        );
      return 'walk' in rule
        ? rule.walk(node, scope, context, w)
        : w.signatures(node, scope, context, rule.signatures);
    },
  };
}
/**
 * Whether `x` is a vector of the caller: an expression whose leaves are
 * numbers, names of a numeric type and at least one name for which
 * `declared` is true, and that holds no `Tuple` or `List` (a point of
 * the user's expression), no call of a user function (its value can be
 * such a point) and no form that binds a name (a name of its body can be
 * another value than the declared input).
 */
function callerVector(
  x: Expression,
  declared: (name: string) => boolean
): boolean {
  let vector = false;
  const visit = (node: Expression): boolean => {
    if (isSymbol(node)) {
      if (declared(node.symbol)) {
        vector = true;
        return true;
      }
      return isSubtype(node.type.type, 'number');
    }
    if (!isFunction(node)) return isSubtype(node.type.type, 'number');
    if (
      node.operator === 'Tuple' ||
      node.operator === 'List' ||
      node.operator === 'Function' ||
      node.operatorDefinition?.scoped === true ||
      userFunctionLiteral(node.engine, node.operator) !== undefined
    )
      return false;
    return node.ops.every(visit);
  };
  return visit(x) && vector;
}
const SUM_2: FragmentRule<GlslRepresentation> = {
  signatures: [
    sig(['real', 'real'], 'real'),
    sig(['complex', 'complex'], 'complex'),
    sig(['point', 'point'], 'point', { broadcast: true, pointScalarSlots: [] }),
  ],
};
/** `Subtract`: the two-operand signatures of `SUM_2`, and the one-operand
 * signatures of `ELEMENTARY`. */
const SUBTRACT: FragmentRule<GlslRepresentation> = {
  signatures: [...SUM_2.signatures, ...ELEMENTARY.signatures],
};
/** A componentwise function of `n` operands on reals or on points. A
 * scalar is broadcast only at the positions where the GLSL builtin has a
 * `float` overload (`mod(vec3, float)`, `step(float, vec3)`). */
const componentwise = (
  n: number,
  scalarSlots: readonly number[]
): FragmentRule<GlslRepresentation> => ({
  signatures: [
    sig(Array(n).fill('real'), 'real'),
    sig(Array(n).fill('point'), 'point', { broadcast: true, scalarSlots }),
  ],
});
/** A colour from three channels. A fourth operand, an alpha channel, has
 * no representation: a colour is a `vec3` on the shader. */
const COLOR_CONSTRUCTOR: FragmentRule<GlslRepresentation> = {
  signatures: [sig(['real', 'real', 'real'], 'color')],
};
/** A conversion of a colour. The operand can also be the components of a
 * colour, a point of 3 components. */
const COLOR_CONVERSION: FragmentRule<GlslRepresentation> = {
  signatures: [
    sig(['color'], 'color'),
    sig(['point'], 'color', { sizes: [3] }),
  ],
};
const COMPARISON: FragmentRule<GlslRepresentation> = {
  signatures: [sig(['real', 'real'], 'boolean', { rest: 'real' })],
};
/** An equality of two reals, two booleans or two points: GLSL `==` on two
 * vectors is `true` when every component is equal, as the interpreter
 * compares two tuples. A list is not a point here: a comparison with a list
 * operand is the comparison of each element. */
const EQUALITY: FragmentRule<GlslRepresentation> = {
  signatures: [
    sig(['real', 'real'], 'boolean'),
    sig(['boolean', 'boolean'], 'boolean'),
    sig(['tuple', 'tuple'], 'boolean'),
  ],
};
const COMPLEX_PART: FragmentRule<GlslRepresentation> = {
  signatures: [sig(['real'], 'real'), sig(['complex'], 'real')],
};
/** `PointX`, `PointY`, `PointZ`: a component of a point. A symbol
 * declared as a list with no stated length (`P: list<real>`) is read by its
 * declared type, not by its value, so it is not a point, also when its
 * value is `[x, y]`: the emitter declines `PointX(P)`. */
const POINT_COMPONENT = (
  sizes: readonly number[]
): FragmentRule<GlslRepresentation> => ({
  walk: (node, scope, context, w) => {
    const operand = isFunction(node) ? node.ops[0] : undefined;
    const t =
      operand !== undefined && isSymbol(operand)
        ? resolveTypeForCompilation(operand.type.type)
        : undefined;
    if (
      t !== undefined &&
      typeof t !== 'string' &&
      t.kind === 'list' &&
      (t.dimensions == null || t.dimensions.some((d) => d < 0))
    )
      return w.refuse(
        node,
        'signature',
        `The operand \`${operand!.toString()}\` of \`${node.operator}\` ` +
          `is a list with no stated length, not a point`
      );
    return w.signatures(node, scope, context, [
      sig(['point'], 'real', { sizes }),
    ]);
  },
});

/** A rounding function, with an optional step. A constant step of 0, or a
 * constant step that is not finite, gives `NaN` in the interpreter, and
 * the emitter declines it (`gpuRoundToStep()`). */
const ROUNDING: FragmentRule<GlslRepresentation> = {
  walk: (node, scope, context, w) => {
    if (roundingStepIsInvalid(node))
      return w.refuse(
        node,
        'limit',
        `The step of \`${node.operator}\` is 0 or not finite, so the value ` +
          `is NaN, and the GLSL fragment has no NaN literal`
      );
    return w.signatures(node, scope, context, [
      sig(['real'], 'real'),
      sig(['real', 'real'], 'real'),
      sig(['point'], 'point'),
    ]);
  },
};
/** Whether `node` is a rounding function with a constant step that is 0 or
 * not finite. */
function roundingStepIsInvalid(node: Expression): boolean {
  if (
    !isFunction(node) ||
    node.nops !== 2 ||
    !['Floor', 'Ceil', 'Round', 'Truncate'].includes(node.operator)
  )
    return false;
  const c = tryGetConstant(node.op2);
  return c !== undefined && (c === 0 || !Number.isFinite(c));
}
/** A real function of `n` real operands whose shader helper is real only:
 * when the value is provably not real for the operands
 * (`complexContinuation()`), the emitter declines it, since there is no
 * complex helper. */
const realValued = (n: number): FragmentRule<GlslRepresentation> => ({
  walk: (node, scope, context, w) => {
    const ops = isFunction(node) ? node.ops : [];
    if (complexContinuation(node.operator, ops) === 'complex')
      return w.refuse(
        node,
        'signature',
        `The value of \`${node.toString()}\` is not real, and the GLSL ` +
          `fragment has no complex lane for \`${node.operator}\``
      );
    return w.signatures(node, scope, context, [
      sig(Array(n).fill('real'), 'real'),
    ]);
  },
});
/** `Sum` and `Product`: a bound whose constant value is not a safe
 * integer (more than 2^53 - 1 in magnitude) is refused, as the emitter
 * refuses it (`assertSafeBigOpBounds()`): the index could not count
 * through it. */
function walkSafeAggregate(
  node: Expression,
  scope: FragmentScope<GlslRepresentation>,
  context: FragmentContext<GlslRepresentation>,
  w: FragmentWalker<GlslRepresentation>
): FragmentFacts<GlslRepresentation> {
  const ops = isFunction(node) ? node.ops : [];
  for (const spec of ops.slice(1)) {
    const bounds = isFunction(spec, 'Limits')
      ? [spec.op2, spec.op3]
      : isFunction(spec, 'Element') && isFunction(spec.op2, 'Range')
        ? [spec.op2.op1, spec.op2.op2]
        : [];
    try {
      // A bound that the compiler folds (`2^53`) is checked by its value.
      assertSafeBigOpBounds(
        node.operator,
        bounds.map((x) => (x === undefined ? x : (w.constant(x, scope) ?? x)))
      );
    } catch (e) {
      // A bound with an effect is refused by the rule of its own head.
      if (!String((e as Error)?.message).includes('out-of-range')) continue;
      return w.refuse(
        node,
        'limit',
        `A bound of \`${node.operator}\` is out-of-range: more than ` +
          `${Number.MAX_SAFE_INTEGER} in magnitude`
      );
    }
  }
  return walkAggregate(node, scope, context, w);
}

/** `Binomial(n, k)`, `Choose(n, k)`: the shader unrolls the product
 * `n(n-1)…(n-k+1)/k!`, so `k` is a literal non-negative integer of at most
 * `GPU_BINOMIAL_UNROLL_LIMIT`, and `n` is real. */
function walkBinomial(
  node: Expression,
  scope: FragmentScope<GlslRepresentation>,
  context: FragmentContext<GlslRepresentation>,
  w: FragmentWalker<GlslRepresentation>
): FragmentFacts<GlslRepresentation> {
  const ops = isFunction(node) ? node.ops : [];
  if (ops.length !== 2)
    return w.refuse(node, 'signature', `\`${node.operator}\` takes two operands`);
  const n = w.value(ops[0], scope, context);
  // A first operand that is a non-finite constant: the interpreter gives
  // NaN, and the shader unrolling would give another value, so the emitter
  // declines it.
  const nValue = isNumber(ops[0]) ? ops[0] : w.constant(ops[0], scope);
  if (isNumber(nValue) && !Number.isFinite(nValue.re))
    return w.refuse(
      node,
      'limit',
      `The first operand of \`${node.operator}\` is the non-finite constant ` +
        `\`${nValue.toString()}\`, which the GLSL fragment does not take`
    );
  const k = ops[1];
  const kValue = k.re;
  if (
    !isNumber(k) ||
    !Number.isInteger(kValue) ||
    kValue < 0 ||
    k.im !== 0
  )
    return w.refuse(
      node,
      'signature',
      `The second operand of \`${node.operator}\` is a literal non-negative ` +
        `integer in the GLSL fragment`
    );
  if (kValue > GPU_BINOMIAL_UNROLL_LIMIT)
    return w.refuse(
      node,
      'limit',
      `The second operand of \`${node.operator}\` is at most ` +
        `${GPU_BINOMIAL_UNROLL_LIMIT} in the GLSL fragment`
    );
  const conversion = w.convert(n, { kind: 'real' });
  if (conversion === undefined)
    return w.refuse(
      node,
      'signature',
      `The first operand of \`${node.operator}\` is a real in the GLSL fragment`
    );
  return w.valueFacts(node, { kind: 'real' }, [conversion]);
}

/** `D(f, x)`: the closed-form derivative that the engine computes at compile
 * time (`derivativeClosedForm()`), typed in place of the node. */
function walkDerivative(
  node: Expression,
  scope: FragmentScope<GlslRepresentation>,
  context: FragmentContext<GlslRepresentation>,
  w: FragmentWalker<GlslRepresentation>
): FragmentFacts<GlslRepresentation> {
  const ops = isFunction(node) ? node.ops : [];
  const closed = derivativeClosedForm('D', ops);
  if (closed === undefined)
    return w.refuse(
      node,
      'head',
      `\`D\` is in the GLSL fragment only when the engine finds a closed form ` +
        `of the derivative at compile time`
    );
  return w.type(closed, scope, context);
}

/** `Apply(Derivative(f, …), x…)`: the body of the closed form
 * (`appliedDerivativeLiteral()`), with the arguments in place of its
 * parameters, typed in place of the node. */
function walkAppliedDerivative(
  node: Expression,
  scope: FragmentScope<GlslRepresentation>,
  context: FragmentContext<GlslRepresentation>,
  w: FragmentWalker<GlslRepresentation>
): FragmentFacts<GlslRepresentation> {
  const ops = isFunction(node) ? node.ops : [];
  const literal = appliedDerivativeLiteral(ops);
  const args = ops.slice(1);
  if (
    literal === undefined ||
    !isFunction(literal, 'Function') ||
    literal.nops - 1 !== args.length
  )
    return w.refuse(
      node,
      'head',
      `\`Apply\` is in the GLSL fragment only as the application of a ` +
        `derivative whose closed form the engine finds at compile time`
    );
  const names = literal.ops.slice(1).map((p) => functionLiteralParameterName(p));
  if (names.some((n) => n === ''))
    return w.refuse(node, 'head', `\`Apply\` of this derivative is outside the GLSL fragment`);
  const body = literal.ops[0].subs(
    Object.fromEntries(names.map((n, i) => [n, args[i]]))
  );
  return w.type(body, scope, context);
}

const walk = (
  fn: (
    node: Expression,
    scope: FragmentScope<GlslRepresentation>,
    context: FragmentContext<GlslRepresentation>,
    walker: FragmentWalker<GlslRepresentation>
  ) => FragmentFacts<GlslRepresentation>
): FragmentRule<GlslRepresentation> => ({ walk: fn });

/**
 * `Loop`: as `walkCountedLoop()`, and each `Break` of its body must be
 * one that the GLSL code writes as a `break` statement
 * (`gpuShaderLoopJumps()`): a statement of the body, or of a block of the
 * body, or the branch of an `If` with no else branch or of a `Which` with
 * one clause. A ternary cannot hold a jump, so `If(c, Break(), s ≔ 1)` and
 * `s ≔ s + Block(If(c, Break()), k)` are refused. A `Break` in a nested
 * `Loop` belongs to that loop, and one in a function literal is not a
 * statement of this loop.
 */
function walkGlslLoop(
  node: Expression,
  scope: FragmentScope<GlslRepresentation>,
  context: FragmentContext<GlslRepresentation>,
  w: FragmentWalker<GlslRepresentation>
): FragmentFacts<GlslRepresentation> {
  const body = isFunction(node) ? node.ops[0] : undefined;
  if (body !== undefined) {
    const written = gpuShaderLoopJumps(body);
    const visited = new Set<Expression>();
    const misplaced = (e: Expression): Expression | undefined => {
      if (!isFunction(e) || visited.has(e)) return undefined;
      visited.add(e);
      if (e.operator === 'Loop' || e.operator === 'Function') return undefined;
      if (e.operator === 'Break' && !written.has(e)) return e;
      for (const op of e.ops) {
        const found = misplaced(op);
        if (found !== undefined) return found;
      }
      return undefined;
    };
    const jump = misplaced(body);
    if (jump !== undefined)
      return w.refuse(
        jump,
        'place',
        `A \`Break\` of a \`Loop\` is in the GLSL fragment as a statement ` +
          `of the loop body, or as the branch of an \`If\` with no else ` +
          `branch there`
      );
  }
  return walkCountedLoop(node, scope, context, w);
}

/**
 * `Which`: as `walkWhich()`. A `Which` with no default clause has the
 * value `Missing` when no condition holds, and its type has a `missing`
 * arm. The shader code writes that value as `NaN` in each lane of a
 * number, a complex number or a point. A boolean or a shader array has no
 * such lane, so `Which(c, [1, 2, 3, 4, 5])` and `Which(x > 0, True, y > 3,
 * False)` are refused (the absence check of `compileExpression()` in
 * `compiler-core.ts`, `assertObjectAbsenceRepresentable()`).
 */
function walkGlslWhich(
  node: Expression,
  scope: FragmentScope<GlslRepresentation>,
  context: FragmentContext<GlslRepresentation>,
  w: FragmentWalker<GlslRepresentation>
): FragmentFacts<GlslRepresentation> {
  const facts = walkWhich(node, scope, context, w);
  const t = facts.type;
  // A list of 2 to 4 reals is a `vecN`, with a NaN in each lane.
  const vector =
    t.kind === 'list' &&
    t.element.kind !== 'point' &&
    t.count !== undefined &&
    t.count >= 2 &&
    t.count <= 4;
  if (
    (t.kind === 'boolean' || (t.kind === 'list' && !vector)) &&
    isSubtype('missing', node.type.type)
  )
    return w.refuse(
      node,
      'signature',
      `The \`Which\` has no default clause, and its value has the type ` +
        `\`${fragmentTypeToString(t)}\`, which has no ` +
        `representation of \`Missing\` in GLSL: add a last clause with ` +
        `the condition \`True\``
    );
  return facts;
}

/**
 * The positive list of the GLSL fragment (the spec, section 2), one rule per
 * head. The elementary functions with a complex helper in the GLSL tables
 * (`_gpu_c…`) take a complex operand; the others take reals only.
 */
export const GLSL_FRAGMENT_RULES: Readonly<
  Record<string, FragmentRule<GlslRepresentation>>
> = {
  // Arithmetic
  Add: pointNumberSumRefused(SUM_N),
  Multiply: ARITHMETIC_N,
  // A `Subtract` of one operand occurs only in a non-canonical tree. It
  // evaluates to its operand, and the emitter writes it as its operand.
  Subtract: pointNumberSumRefused(SUBTRACT),
  Divide: {
    signatures: [
      sig(['real', 'real'], 'real'),
      sig(['complex', 'complex'], 'complex'),
      sig(['point', 'point'], 'point', {
        broadcast: true,
        pointScalarSlots: [1],
      }),
    ],
  },
  Negate: ELEMENTARY,
  Power: {
    signatures: [
      sig(['real', 'real'], 'real'),
      sig(['complex', 'complex'], 'complex'),
      sig(['point', 'point'], 'point', { broadcast: true }),
    ],
  },
  Root: {
    signatures: [
      sig(['real', 'real'], 'real'),
      sig(['complex', 'real'], 'complex'),
    ],
  },
  Sqrt: SQRT,
  Square: ELEMENTARY,
  // An operand whose static type admits a point and another shape
  // (`isRuntimePointShaped()`: `H(t)` with `H: (real) -> list<number> |
  // tuple<number, number>`) is refused: its absolute value is the norm of a
  // point or a list of absolute values, and only the value tells which. The
  // compiler declines it too (rule R3).
  Abs: {
    walk: (node, scope, context, w) => {
      const operand = isFunction(node) ? node.ops[0] : undefined;
      if (operand !== undefined && isRuntimePointShaped(operand))
        return w.refuse(
          node,
          'signature',
          `The operand \`${operand.toString()}\` of \`Abs\` has the ` +
            `type \`${operand.type.toString()}\`, which admits a point and ` +
            `another shape`
        );
      return w.signatures(node, scope, context, [
        sig(['real'], 'real'),
        sig(['complex'], 'real'),
        // The absolute value of a point is its Euclidean norm, as in the
        // interpreter: `|(3, 4)|` is 5. The compiler writes `Abs` of a
        // point as `Norm`.
        sig(['tuple'], 'real'),
        // The absolute value of a list of reals is the list of the absolute
        // values of its elements, as in the interpreter: `|[-1, 5, -3]|` is
        // `[1, 5, 3]`. The compiler writes the componentwise `abs`.
        sig(['point'], 'point'),
      ]);
    },
  },
  Sign: REAL_OR_POINT_1,
  Floor: ROUNDING,
  Ceil: ROUNDING,
  Round: ROUNDING,
  Truncate: ROUNDING,
  Fract: REAL_OR_POINT_1,
  Mod: componentwise(2, [1]),
  Remainder: real(2),
  Hypot: real(2),
  Clamp: componentwise(3, [1, 2]),
  Mix: componentwise(3, [2]),
  Step: componentwise(2, [0]),
  Smoothstep: componentwise(3, [0, 1]),
  Max: {
    signatures: [
      sig(['real'], 'real', { rest: 'real' }),
      sig(['real-list'], 'real'),
      // Lists and reals together: the extremum of all their elements.
      sig(['real-or-list'], 'real', { rest: 'real-or-list' }),
      // Points, and points with reals: the extremum of all their components,
      // as in the interpreter (`Max((1, 5, 3), 2)` is 5). The compiler
      // writes a fold over the components, not the componentwise `max`.
      sig(['point'], 'real', { rest: 'point', broadcast: true }),
    ],
  },
  Min: {
    signatures: [
      sig(['real'], 'real', { rest: 'real' }),
      sig(['real-list'], 'real'),
      // Lists and reals together: the extremum of all their elements.
      sig(['real-or-list'], 'real', { rest: 'real-or-list' }),
      // Points, and points with reals: the extremum of all their components,
      // as in the interpreter (`Min((1, 5, 3), 2)` is 1). The compiler
      // writes a fold over the components, not the componentwise `min`.
      sig(['point'], 'real', { rest: 'point', broadcast: true }),
    ],
  },
  ElementMax: {
    signatures: [
      sig(['real'], 'real', { rest: 'real' }),
      sig(['point', 'point'], 'point', { rest: 'point', broadcast: true }),
    ],
  },
  ElementMin: {
    signatures: [
      sig(['real'], 'real', { rest: 'real' }),
      sig(['point', 'point'], 'point', { rest: 'point', broadcast: true }),
    ],
  },
  GCD: {
    signatures: [
      sig(['real'], 'real', { rest: 'real' }),
      sig(['real-list'], 'real'),
      // Lists and reals together: a fold over all their elements.
      sig(['real-or-list'], 'real', { rest: 'real-or-list' }),
    ],
  },
  LCM: {
    signatures: [
      sig(['real'], 'real', { rest: 'real' }),
      sig(['real-list'], 'real'),
      // Lists and reals together: a fold over all their elements.
      sig(['real-or-list'], 'real', { rest: 'real-or-list' }),
    ],
  },
  Factorial: REAL_1,
  Binomial: walk(walkBinomial),
  Choose: walk(walkBinomial),
  // The closed-form derivative is compile-time work: a `D` that the engine
  // differentiates has the type of its derivative.
  D: walk(walkDerivative),
  // `Apply(Derivative(f, …), x…)`: the closed form of the derivative, a
  // function literal that the engine computes at compile time, applied to
  // the arguments. Any other `Apply` is outside.
  Apply: walk(walkAppliedDerivative),

  // Elementary and special functions of the shared GPU table
  Sin: ELEMENTARY,
  Cos: ELEMENTARY,
  Tan: ELEMENTARY,
  Cot: REAL_OR_POINT_1,
  Sec: REAL_OR_POINT_1,
  Csc: REAL_OR_POINT_1,
  Sinh: ELEMENTARY,
  Cosh: ELEMENTARY,
  Tanh: ELEMENTARY,
  Coth: ELEMENTARY,
  Sech: ELEMENTARY,
  Csch: ELEMENTARY,
  Arcsin: ELEMENTARY,
  Arccos: ELEMENTARY,
  Arctan: ELEMENTARY,
  Arccot: REAL_OR_POINT_1,
  Arcsec: ELEMENTARY,
  Arccsc: ELEMENTARY,
  Arsinh: ELEMENTARY,
  Arcosh: ELEMENTARY,
  Artanh: ELEMENTARY,
  Arcoth: ELEMENTARY,
  Arsech: ELEMENTARY,
  Arcsch: REAL_OR_POINT_1,
  Exp: ELEMENTARY,
  Exp2: REAL_OR_POINT_1,
  Ln: ELEMENTARY,
  Log: { signatures: [sig(['real'], 'real'), sig(['real', 'real'], 'real')] },
  Log2: REAL_OR_POINT_1,
  Log10: REAL_1,
  Lb: REAL_1,
  Lg: REAL_1,
  // `atan(vecN, vecN)` acts on each component.
  Arctan2: {
    signatures: [sig(['real', 'real'], 'real'), sig(['point', 'point'], 'point')],
  },
  Sinc: REAL_1,
  Erf: REAL_1,
  Erfc: REAL_1,
  ErfInv: REAL_1,
  Gamma: REAL_1,
  GammaLn: REAL_1,
  Digamma: REAL_1,
  Trigamma: REAL_1,
  PolyGamma: real(2),
  Beta: real(2),
  Zeta: { signatures: [sig(['real'], 'real'), sig(['real', 'real'], 'real')] },
  HurwitzZeta: realValued(2),
  PolyLog: realValued(2),
  LerchPhi: realValued(3),
  BesselJ: real(2),
  FresnelC: REAL_1,
  FresnelS: REAL_1,
  Heaviside: REAL_1,
  Haversine: REAL_1,
  InverseHaversine: REAL_1,
  Degrees: REAL_1,
  Radians: REAL_1,
  Mandelbrot: { signatures: [sig(['complex', 'index'], 'real')] },
  Julia: { signatures: [sig(['complex', 'complex', 'index'], 'real')] },

  // Complex
  Real: COMPLEX_PART,
  Imaginary: COMPLEX_PART,
  Argument: COMPLEX_PART,
  Conjugate: {
    signatures: [sig(['real'], 'real'), sig(['complex'], 'complex')],
  },

  // Points and vectors
  Tuple: walk(walkPoint),
  PointList: walk(walkPoint),
  List: walk(walkList),
  PointX: POINT_COMPONENT([2, 3, 4]),
  PointY: POINT_COMPONENT([2, 3, 4]),
  PointZ: POINT_COMPONENT([3, 4]),
  // The geometric functions of GLSL are declared over the `genType`, which
  // includes `float`: `dot(float, float)` is valid.
  Dot: {
    signatures: [sig(['real', 'real'], 'real'), sig(['point', 'point'], 'real')],
  },
  Cross: { signatures: [sig(['point', 'point'], 'point', { sizes: [3] })] },
  Norm: {
    signatures: [
      sig(['real'], 'real'),
      sig(['complex'], 'real'),
      sig(['point'], 'real'),
    ],
  },
  Normalize: { signatures: [sig(['real'], 'real'), sig(['point'], 'point')] },
  Distance: { signatures: [sig(['point', 'point'], 'real')] },
  Reflect: {
    signatures: [
      sig(['real', 'real'], 'real'),
      sig(['point', 'point'], 'point'),
    ],
  },
  Refract: {
    signatures: [
      sig(['real', 'real', 'real'], 'real'),
      sig(['point', 'point', 'real'], 'point'),
    ],
  },
  Length: walk(walkElement),
  First: walk(walkElement),
  Second: walk(walkElement),
  Third: walk(walkElement),
  Last: walk(walkElement),

  // Colours. A string literal at a colour place names a colour at compile
  // time; at a `name` place it names a colour space.
  Rgb: COLOR_CONSTRUCTOR,
  Hsl: COLOR_CONSTRUCTOR,
  Hsv: COLOR_CONSTRUCTOR,
  Oklab: COLOR_CONSTRUCTOR,
  Oklch: COLOR_CONSTRUCTOR,
  Color: { signatures: [sig(['color'], 'color')] },
  ColorMix: {
    signatures: [
      sig(['color', 'color'], 'color'),
      sig(['color', 'color', 'real'], 'color'),
    ],
  },
  AsRgb: COLOR_CONVERSION,
  AsHsl: COLOR_CONVERSION,
  AsHsv: COLOR_CONVERSION,
  AsOklab: COLOR_CONVERSION,
  AsOklch: COLOR_CONVERSION,
  ColorToColorspace: {
    signatures: [
      sig(['color', 'name'], { kind: 'point', size: 3 }),
      sig(['point', 'name'], { kind: 'point', size: 3 }, { sizes: [3] }),
    ],
  },
  // The first operand is the components of a colour in the named space.
  ColorFromColorspace: {
    signatures: [
      sig(['point', 'name'], 'color', { sizes: [3] }),
      sig(['color', 'name'], 'color'),
    ],
  },
  GamutMap: {
    signatures: [sig(['color'], 'color'), sig(['color', 'name'], 'color')],
  },
  ContrastingColor: {
    signatures: [
      sig(['color'], 'color'),
      sig(['color', 'color'], 'color'),
      sig(['color', 'color', 'color'], 'color'),
      // A tuple alone is colour components, not a colour: the interpreter
      // and the emitter refuse `ContrastingColor((0.2, 0.4, 0.6))`.
      sig(['point', 'point', 'point'], 'color', { sizes: [3] }),
    ],
  },
  ColorContrast: { signatures: [sig(['color', 'color'], 'real')] },

  // Comparison and logic
  Less: COMPARISON,
  LessEqual: COMPARISON,
  Greater: COMPARISON,
  GreaterEqual: COMPARISON,
  Equal: EQUALITY,
  NotEqual: EQUALITY,
  And: SHORT_CIRCUIT,
  Or: SHORT_CIRCUIT,
  Not: { signatures: [sig(['boolean'], 'boolean')] },

  // Selection, aggregates, indexing
  If: walk(walkIf),
  Which: walk(walkGlslWhich),
  Sum: walk(walkSafeAggregate),
  Product: walk(walkSafeAggregate),
  At: walk(walkAt),
  Range: walk(walkRange),

  // The body of a user function (the spec, decisions 6, 7 and 8)
  Block: walk(walkBlock),
  Loop: walk(walkGlslLoop),
  ParallelLoop: walk(walkParallelLoop),
  Break: walk(walkBreak),
  Assign: walk(walkAssign),
  AddTo: walk(walkAssign),
  Declare: walk(walkDeclareOutsideBlock),
  Typed: walk(walkTyped),
};

//
// The definition
//

/** The options of `compile()` that the GLSL definition reads. */
export type GlslFragmentOptions = {
  /** The caller's implementations of functions (`functions` option): a
   *  call of such a head is the caller's code. */
  readonly functions?: Readonly<Record<string, unknown>>;
  /** The `vars` option: an input that it maps is written with the
   *  caller's spelling. */
  readonly vars?: Readonly<Record<string, unknown>>;
  /** The names `s` of the statements `s = s + e` of the root as the
   *  program wrote it (`sumAssignedNames()`). */
  readonly sumAssigned?: ReadonlySet<string>;
  /** The names that `compileShader()` or `compileFunction()` declares
   *  with a GLSL vector type (`vec2`, `vec3`, `vec4`), built-in variables
   *  included: `Add` and `Subtract` add a number to such a vector
   *  (`pointNumberSumRefused()`). */
  readonly declaredVectors?: ReadonlySet<string>;
};

/**
 * The operands of `node` that its GLSL code writes more than once, or
 * `undefined`. Each case copies the condition of the emitter, where it
 * calls `gpuOperandOnce()` or `gpuAssertCallerCodeNotRepeated()`
 * (`gpu-draw-order.ts`):
 * - `Argument`, `Beta`, `Cot`, `Remainder`, `ContrastingColor`,
 *   `Variance`: every operand;
 * - `Binomial`, `Choose`: the first operand, with a constant second
 *   operand of 2 or more (`gpuBinomial()`);
 * - `Conjugate`: a complex operand; `Coth`: a complex operand that is not
 *   an imaginary multiple of π (`gpuImaginaryPiMultiple()`);
 * - `Power`: the base, when the exponent is a constant non-integer with a
 *   real branch for a negative base (`realPowerExponent()`,
 *   `negativeBaseFloatPower()`) and the operands are real and not both
 *   constants: `Power(F(x), 2)` writes the base once;
 * - `Round` with no step: an operand that is not a scalar;
 *   `Round`, `Floor`, `Ceil`, `Truncate` with a step
 *   (`gpuRoundToStep()`): the operand, and a step that is not a constant;
 * - `Root`: a complex radicand, and its degree when it is not a constant;
 *   a real radicand under a constant odd degree (or a degree read as a
 *   rational with an odd numerator, `realRootDegreeTerms()`), when the
 *   radicand is not a constant either;
 * - a comparison with more than two operands: each middle operand, which
 *   two comparisons read.
 *
 * These operands are a subset of the operands that the emitter declines.
 * The emitter declines more operands than these: the subject of
 * `Match`, the squared term of a `Sum` (`gpu-reduce.ts`), the bound of
 * `Random` (`gpu-random.ts`) and the middle operand of a chained
 * comparison of vectors (`gpu-statements.ts`) are not in this list.
 */
function operandsWrittenTwice(
  node: Expression
): ReadonlyArray<Expression> | undefined {
  if (!isFunction(node)) return undefined;
  const ops = node.ops;
  const [a, b] = ops;
  switch (node.operator) {
    case 'Argument':
    case 'Beta':
    case 'Cot':
    case 'Remainder':
    case 'ContrastingColor':
    case 'Variance':
      return ops;
    case 'Binomial':
    case 'Choose': {
      const k = b === undefined ? undefined : tryGetConstant(b);
      return k !== undefined && Number.isInteger(k) && k >= 2 ? [a] : undefined;
    }
    case 'Conjugate':
      return a !== undefined && BaseCompiler.isComplexValued(a) ? [a] : undefined;
    case 'Coth':
      return a !== undefined &&
        BaseCompiler.isComplexValued(a) &&
        gpuImaginaryPiMultiple(a, 1) === undefined
        ? [a]
        : undefined;
    case 'Power': {
      if (a === undefined || b === undefined) return undefined;
      if (BaseCompiler.isComplexValued(a) || BaseCompiler.isComplexValued(b))
        return undefined;
      if (tryGetConstant(a) !== undefined && tryGetConstant(b) !== undefined)
        return undefined;
      const negativeBase = BaseCompiler.negativeBaseFloatPower(ops);
      return BaseCompiler.realPowerExponent(ops) !== undefined ||
        typeof negativeBase === 'object'
        ? [a]
        : undefined;
    }
    case 'Round':
    case 'Floor':
    case 'Ceil':
    case 'Truncate': {
      if (a === undefined) return undefined;
      if (b === undefined)
        return node.operator === 'Round' &&
          !BaseCompiler.isIntegerValued(a) &&
          gpuOperandShape(a) !== 'scalar'
          ? [a]
          : undefined;
      return tryGetConstant(b) === undefined ? [a, b] : [a];
    }
    case 'Root': {
      if (a === undefined) return undefined;
      if (
        BaseCompiler.isComplexValued(a) ||
        (b !== undefined && BaseCompiler.isComplexValued(b))
      )
        return b !== undefined && tryGetConstant(b) === undefined ? [a, b] : [a];
      if (b === undefined) return undefined;
      const n = tryGetConstant(b);
      if (n === undefined || n === 2 || tryGetConstant(a) !== undefined)
        return undefined;
      if (gpuResultIsComplexValued('Root', [a, b])) return undefined;
      return (Number.isInteger(n) && n % 2 !== 0) ||
        BaseCompiler.realRootDegreeTerms(b)?.oddNumerator === true
        ? [a]
        : undefined;
    }
  }
  return CHAINED_COMPARISONS.has(node.operator) && node.nops > 2
    ? ops.slice(1, -1)
    : undefined;
}
const CHAINED_COMPARISONS = new Set([
  'Less',
  'LessEqual',
  'Greater',
  'GreaterEqual',
  'Equal',
  'NotEqual',
]);

/**
 * The heads whose GLSL code reads an operand as a color and converts it to
 * OKLCh (`gpuColorOperand()`, `gpuColorEntryOperand()` in
 * `gpu-color.ts`).
 */
const COLOR_OPERAND_HEADS = new Set([
  'AsHsl',
  'AsHsv',
  'AsOklab',
  'AsOklch',
  'AsRgb',
  'ColorContrast',
  'ColorMix',
  'ColorToColorspace',
  'ContrastingColor',
  'GamutMap',
]);

/**
 * The operand of `node`, a head that reads a color operand, whose color
 * space is not known at compile time although one of the positions its
 * value comes from holds a color in a named space
 * (`colorSpaceIsUnsettled()`): `Which(c, AsRgb(a), True, AsHsv(b))`. The
 * GLSL code cannot convert such a color to OKLCh, and the emitter declines
 * it. A literal tuple is components, not such a color.
 */
function colorOperandOfUnsettledSpace(
  node: Expression
): Expression | undefined {
  if (!isFunction(node) || !COLOR_OPERAND_HEADS.has(node.operator))
    return undefined;
  return node.ops.find(
    (x) => !isFunction(x, 'Tuple') && colorSpaceIsUnsettled(x)
  );
}

/**
 * The operand of `node` that holds code that the caller supplies
 * (`reachesCallerCodeOn()`: a call of a `functions` entry, or a `compile`
 * handler) when the GLSL code of `node` can write that operand more than
 * once, or `undefined`. The code would then run once per copy, where the
 * interpreter evaluates the operand once. These operands
 * (`operandsWrittenTwice()`) are a subset of the operands that the emitter
 * declines (`gpuOperandOnce()`).
 * The emitter declines more operands than these: the subject of
 * `Match`, the squared term of a `Sum` (`gpu-reduce.ts`), the bound of
 * `Random` (`gpu-random.ts`) and the middle operand of a chained
 * comparison of vectors (`gpu-statements.ts`) are not in this list.
 * An operand that is the read of one variable (`isShaderVariableRead()`)
 * runs no code.
 */
function callerCodeOperandWrittenTwice(
  node: Expression,
  target: CompileTarget<Expression>
): Expression | undefined {
  return operandsWrittenTwice(node)?.find(
    (x) => !isShaderVariableRead(x, target) && reachesCallerCodeOn(x, target)
  );
}

/**
 * The definition of the GLSL fragment for one compilation: `target` is the
 * compile target that the prepare stage made for the root (it holds the
 * `storage` hints and the `constantFold` option, and the user functions
 * are prepared with it).
 */
export function glslFragmentDefinition(
  target: CompileTarget<Expression>,
  options: GlslFragmentOptions = {}
): FragmentDefinition<GlslRepresentation> {
  const storage = target.storage;
  const vars = options.vars;
  /** The `vars` replacement of an input, or `undefined`. */
  const varsReplacement = (binding: {
    role: string;
    symbol?: Expression;
  }): unknown =>
    binding.role === 'input' &&
    isSymbol(binding.symbol) &&
    vars !== undefined &&
    Object.hasOwn(vars, binding.symbol.symbol)
      ? vars[binding.symbol.symbol]
      : undefined;
  // A name that GLSL reserves cannot be a variable of the shader, unless
  // the `vars` option writes the input with another spelling that is not
  // reserved.
  const reservedName = (binding: {
    role: string;
    symbol?: Expression;
  }): boolean => {
    if (!isSymbol(binding.symbol)) return false;
    const name = binding.symbol.symbol;
    try {
      // A `vars` replacement that is a bare identifier is checked as the
      // name of the variable, as the emitter checks it
      // (`GPUShaderTarget`, the `var` hook); other replacements (`u.a`,
      // `v[0]`) are the caller's code.
      const replacement = varsReplacement(binding);
      if (replacement !== undefined) {
        if (typeof replacement === 'string' && /^[A-Za-z_]\w*$/.test(replacement))
          gpuCheckIdentifier(replacement, 'glsl');
        return false;
      }
      gpuCheckIdentifier(name, 'glsl');
      return false;
    } catch {
      return true;
    }
  };
  const overridden = (name: string): boolean =>
    options.functions !== undefined && Object.hasOwn(options.functions, name);

  // A call of a head that the caller implements (`functions` option) is the
  // caller's code: its operands are values of the fragment, and its result
  // is read as a real, the type of a call of a shader function that the
  // caller declares.
  const callerRule = walk((node, scope, context, w) => {
    const ops = isFunction(node) ? node.ops : [];
    const conversions = ops.map((op) => {
      const f = w.value(op, scope, context);
      return { kind: 'none' as const, type: f.type, representation: f.representation };
    });
    return w.valueFacts(node, { kind: 'real' }, conversions);
  });
  // A user definition that shadows a library operator which the emitter
  // lowers by name (`If`, a head of the GPU table) replaces that lowering,
  // and the emitter declines the call (`shadowedLibraryLoweringError()`).
  // Each rule checks it first.
  const shadowChecked = (
    rule: FragmentRule<GlslRepresentation>
  ): FragmentRule<GlslRepresentation> => ({
    walk: (node, scope, context, w) => {
      const repeated = callerCodeOperandWrittenTwice(node, target);
      if (repeated !== undefined)
        return w.refuse(
          node,
          'head',
          `The operand \`${repeated.toString()}\` of \`${node.operator}\` ` +
            `contains code that the caller supplies (a \`vars\` entry ` +
            `that is code, a \`functions\` entry or a \`compile\` handler), ` +
            `and the GLSL code writes that operand more than once, so the ` +
            `code would run more than once`
        );
      // A base of `At` that is a list of one scalar has no value in GLSL
      // (there is no `vec1`; `gpuAtBaseShape()` declines it), unless the
      // list is in a texture (the `storage` option): `At(v, 1)` with
      // `v: vector<1>` is refused. A list of one point is a `vec2[1]`
      // array, which the emitter reads (`gpuPointListAtBase()`).
      const base = isFunction(node, 'At') ? node.ops[0] : undefined;
      const baseType =
        base === undefined ? undefined : glslFragmentTypeOf(base.type.type);
      if (
        baseType?.kind === 'list' &&
        baseType.count === 1 &&
        isScalarElement(baseType) &&
        !(isSymbol(base) && storage?.get(base.symbol) === 'sampler2D')
      )
        return w.refuse(
          node,
          'signature',
          `The base of \`At\` is a list of one element, which has no ` +
            `value in GLSL (there is no \`vec1\`)`
        );
      // A base of `At` that the `storage` option places in a texture is
      // read with the index bounded by the length of its engine type, so
      // that type must be a list with a stated length of at least 1:
      // `At(S, k)` with `S: list<number>`, `S: vector<0>` or
      // `S: tuple<number, number>` is refused, with the message of the
      // emitter (`gpuStorageAtBaseShape()`). The other declines of the
      // emitter there (a list of two dimensions, an element that is not a
      // real) are refused where the pass types the base.
      const kind =
        base !== undefined && isSymbol(base) ? storage?.get(base.symbol) : undefined;
      const carrier =
        kind !== undefined && base !== undefined
          ? resolveTypeAlias(base.type.type)
          : undefined;
      const stored =
        kind !== undefined &&
        isSymbol(base) &&
        carrier !== undefined &&
        (typeof carrier === 'string' ||
          carrier.kind !== 'list' ||
          ((carrier.dimensions ?? []).length <= 1 &&
            (carrier.dimensions?.[0] ?? -1) <= 0))
          ? gpuStorageAtBaseShape(base, kind)
          : undefined;
      if (stored !== undefined && 'decline' in stored)
        return w.refuse(
          node,
          'signature',
          `Could not compile \`At\`: ${stored.decline}.`
        );
      const unsettledColor = colorOperandOfUnsettledSpace(node);
      if (unsettledColor !== undefined)
        return w.refuse(
          node,
          'signature',
          `The color operand \`${unsettledColor.toString()}\` of ` +
            `\`${node.operator}\` holds colors in different color spaces ` +
            `at the positions its value comes from, and a GLSL color is a ` +
            `\`vec3\` with no color space`
        );
      if (
        isFunction(node) &&
        shadowedLibraryLoweringError(node.engine, node.operator, target, node) !==
          undefined
      )
        return w.refuse(
          node,
          'head',
          `A user definition shadows the library operator ` +
            `\`${node.operator}\`, which the GLSL fragment then does not take`
        );
      return 'walk' in rule
        ? rule.walk(node, scope, context, w)
        : w.signatures(node, scope, context, rule.signatures);
    },
  });
  const rules: Record<string, FragmentRule<GlslRepresentation>> = {};
  for (const [name, rule] of Object.entries(GLSL_FRAGMENT_RULES))
    rules[name] = shadowChecked(rule);
  const declaredVectors = options.declaredVectors;
  if (declaredVectors !== undefined && declaredVectors.size > 0) {
    rules.Add = shadowChecked(
      pointNumberSumRefused(SUM_N, declaredVectors, ARITHMETIC_N)
    );
    rules.Subtract = shadowChecked(
      pointNumberSumRefused(
        SUBTRACT,
        declaredVectors,
        {
          signatures: [
            sig(['real', 'real'], 'real'),
            sig(['complex', 'complex'], 'complex'),
            sig(['point', 'point'], 'point', { broadcast: true }),
          ],
        }
      )
    );
  }
  for (const name of Object.keys(options.functions ?? {}))
    rules[name] = callerRule;

  return {
    name: 'GLSL',
    rules,

    typeOfSymbol: (symbol) => {
      if (!isSymbol(symbol)) return undefined;
      return glslFragmentTypeOf(symbol.type.type);
    },

    // A node of an input boxed before the symbol was declared, or boxed with
    // no canonical form, keeps the type `unknown`. The compiler reads the
    // declaration of the name, so the type of the declaration is read.
    typeOfInput: (symbol) => {
      if (!isSymbol(symbol)) return undefined;
      const t = glslFragmentTypeOf(symbol.type.type);
      if (t !== undefined) return t;
      return symbol.engine.lookupDefinition(symbol.symbol) === undefined
        ? undefined
        : glslFragmentTypeOf(symbol.engine.symbol(symbol.symbol).type.type);
    },

    typeOfType: glslFragmentTypeOf,

    // The compiler writes the stored value of a free symbol in place of the
    // symbol (`tryFoldKnownSymbol()`), unless the `vars` option maps the
    // symbol: the caller then gives its value.
    storedValue: (symbol) => {
      if (!isSymbol(symbol)) return undefined;
      const name = symbol.symbol;
      if (vars !== undefined && Object.hasOwn(vars, name)) return undefined;
      return symbol.engine._getSymbolValue(name);
    },

    representationOfBinding: (type, binding) => {
      // A name that the caller declares (a parameter of
      // `compileFunction()`, a declaration or a built-in variable of
      // `compileShader()`) is the caller's spelling, as written in the
      // shader: it is not checked as a name of the emitter.
      if (binding.declared === undefined && reservedName(binding))
        return undefined;
      // A name declared `int` or `uint` by the caller is held in that type.
      const declared =
        binding.declared === undefined
          ? undefined
          : gpuNormalizeShaderType(binding.declared);
      if (declared?.width === 1 && (declared.element === 'i' || declared.element === 'u'))
        return type.kind === 'integer'
          ? declared.element === 'i'
            ? 'int'
            : 'uint'
          : undefined;
      if (binding.role === 'index')
        return type.kind === 'integer' ? 'int' : undefined;
      if (type.kind === 'list') {
        if (binding.role !== 'input') return undefined;
        if (
          isSymbol(binding.symbol) &&
          storage?.get(binding.symbol.symbol) === 'sampler2D'
        )
          return isScalarElement(type) ? 'sampler2D' : undefined;
      }
      return glslRepresentationOfValue(type);
    },

    representationOfValue: glslRepresentationOfValue,

    bindingLimit: (type, binding) => {
      const symbol = binding.symbol;
      const name = isSymbol(symbol) ? symbol.symbol : symbol.toString();
      if (reservedName(binding)) {
        const replacement = varsReplacement(binding);
        return replacement === undefined
          ? `\`${name}\` is a reserved word of GLSL, and the shader cannot ` +
              `name a variable so: rename it, or map it with the \`vars\` option`
          : `The \`vars\` option maps \`${name}\` to \`${String(replacement)}\`, ` +
              `a reserved word of GLSL, and the shader cannot name a ` +
              `variable so`;
      }
      if (type.kind !== 'list') return undefined;
      if (type.count === undefined)
        return (
          `The list \`${name}\` has no static count: name it in the ` +
          `\`storage\` option (\`storage: { ${name}: 'sampler2D' }\`) to ` +
          `read it from a texture`
        );
      if (type.count > GLSL_FRAGMENT_ARRAY_LIMIT)
        return (
          `The list \`${name}\` has ${type.count} elements, more than the ` +
          `limit of ${GLSL_FRAGMENT_ARRAY_LIMIT} elements of a shader ` +
          `array: name it in the \`storage\` option ` +
          `(\`storage: { ${name}: 'sampler2D' }\`) to read it from a texture`
        );
      return undefined;
    },

    constantValue: (node) => {
      if (target.constantFold === false) return undefined;
      // A rounding function with a step of 0 folds to `NaN`, but the
      // emitter does not fold it: it declines it. The rule of the head
      // decides.
      if (roundingStepIsInvalid(node)) return undefined;
      // A node of a function body that reads a local, a parameter or an
      // index is not constant: `constantFoldValue()` reads the free names
      // of the node.
      const value = constantFoldValue(node, target)?.value;
      // A value that is not real is not written in place of the node: the
      // rule of the head decides (`Mod(Sqrt(-2), 1)` takes a real only).
      if (isNumber(value) && value.im !== 0) return undefined;
      // A fold that keeps a free name is not a constant: `g(2)` with
      // `g := t ↦ t + a` and `a := 3t + 1` folds to `3t + 3`, but the code
      // calls `g`, and the rule of the head decides.
      if (value !== undefined && value.unknowns.length > 0) return undefined;
      return value;
    },

    // A colour literal is valid when the interpreter reads it as a colour,
    // with no alpha channel: a colour is a `vec3` on the shader. A colour
    // space is valid when the emitter has a helper for it
    // (`GPU_COLOR_SPACES`), and so is a gamut of `GamutMap`
    // (`GPU_GAMUT_HELPERS`).
    literal: (pattern, text, operator) => {
      if (pattern === 'name') {
        if (operator === 'GamutMap') return GPU_GAMUT_HELPERS.has(text);
        return operator === 'ColorToColorspace' ||
          operator === 'ColorFromColorspace'
          ? GPU_COLOR_SPACES.has(text)
          : true;
      }
      const packed = parseColorString(text);
      return packed !== null && (packed & 0xff) === 0xff;
    },

    // The loop counter is a signed 32-bit `int`.
    counterRange: [-(2 ** 31), 2 ** 31 - 1],

    // The emitter writes an empty range as the identity and a small
    // constant range term by term (`compileGPUSumProduct()`, the limit
    // `GPU_UNROLL_LIMIT`), with no loop.
    aggregateHasNoLoop: (node, lower, upper) =>
      lower > upper ||
      (isFunction(node) &&
        unrollFits(upper - lower + 1, unrolledTermSize(node.op1), GPU_UNROLL_LIMIT)),

    sumAssigned: options.sumAssigned,

    functionOf: (call, scope) =>
      glslFunctionOf(call, scope, target, overridden),
  };
}

/**
 * `body`, the body of a user function as `definitionBodyExpr()` gives it,
 * with the point values and the point-valued calls written in place, as a
 * shader target compiles it. `params` are the names of its parameters.
 *
 * A symbol of the body whose type admits a point and a list of points is
 * replaced by its point value, as at the root (`inlinePointValues()`). A
 * call of a user function whose stored signature returns that union, and
 * whose body is a point, is replaced by that body (`inlinePointCalls()`).
 * The parameters are local names there, so a callee body cannot capture
 * them, and the parameters and the names that the body binds are not
 * replaced. The stored definition does not change.
 *
 * The `define` hook of the shader targets (`gpu-shader-target.ts`) and the
 * fragment pass (`glslFunctionOf()`) both call this function, so that the
 * pass types the body that the emitter compiles.
 */
export function shaderFunctionBody(
  body: Expression,
  target: CompileTarget<Expression>,
  params: readonly string[]
): Expression {
  const pointCalls = inlinePointCalls(
    body,
    target,
    { scalarNames: new Set<string>(), localNames: new Set(params) },
    gpuPointCallsOverBudget
  );
  return inlinePointValues(
    pointCalls,
    target,
    new Set([...params, ...reachableSymbolNames(pointCalls).written])
  );
}

function isScalarElement(type: FragmentListType): boolean {
  return type.element.kind === 'real' || type.element.kind === 'integer';
}

/**
 * The user function that the call `call` reaches, prepared as the `define`
 * hook of the GLSL target prepares its body (`inlinePointCalls()`,
 * `inlinePointValues()`). A call with an argument that is a list input of
 * the expression in a texture (`storage` option) or held as a uniform array
 * reaches the variant of the function with no parameter for
 * that list: its body reads the input by name (`compile-user-calls.ts`,
 * `ensureBoundListVariantEmitted()`, the key `<name>#bind<positions>`).
 */
function glslFunctionOf(
  call: Expression,
  scope: FragmentScope<GlslRepresentation>,
  target: CompileTarget<Expression>,
  overridden: (name: string) => boolean
): FragmentFunction | undefined {
  if (!isFunction(call)) return undefined;
  const h = call.operator;
  if (overridden(h)) return undefined;
  const engine = call.engine;
  const literal = userFunctionLiteral(engine, h);
  if (literal === undefined) return undefined;
  const params = literal.ops.slice(1);
  const names = params.map((p) => functionLiteralParameterName(p));
  const args = call.ops;
  let body = literal.ops[0];
  // The literal whose body the emitter compiles: `literal`, or the variant
  // below.
  let emitted: Expression & FunctionInterface = literal;
  let kept = names.map((_, i) => i);

  // The arguments that are list inputs of the expression that the shader
  // can read by name: a symbol of a list type that names a value and that
  // no enclosing form binds, and that is either in a texture (the `storage`
  // option names it `'sampler2D'`) or a uniform array (it is not in the
  // `storage` option and has a static count of at most
  // `GLSL_FRAGMENT_ARRAY_LIMIT` elements). Another list argument (a
  // computed list, a list input of more elements and not in a texture) is
  // not bound, and the list parameter then has no fragment type.
  const heldByName = (a: Expression & { symbol: string }): boolean => {
    const kind = target.storage?.get(a.symbol);
    if (kind === 'sampler2D') return true;
    if (kind !== undefined) return false;
    const t = glslFragmentTypeOf(a.type.type);
    return (
      t?.kind === 'list' &&
      t.count !== undefined &&
      t.count <= GLSL_FRAGMENT_ARRAY_LIMIT &&
      glslRepresentationOfValue(t) !== undefined
    );
  };
  const bound = args.map(
    (a) =>
      isSymbol(a) &&
      !fragmentScopeBinds(scope, a.symbol) &&
      isValueDef(engine.lookupDefinition(a.symbol)) &&
      isSubtype(a.type.type, 'list<any>') &&
      heldByName(a)
  );
  let key = h;
  // The conditions of `ensureBoundListVariantEmitted()`: the compiler makes
  // no variant of a generic function, nor of a body that the substitution
  // makes invalid, and it then compiles the call with all its parameters.
  if (
    bound.includes(true) &&
    !userFunctionIsGeneric(engine, h, literal) &&
    args.length === params.length &&
    names.every((n) => n !== '')
  ) {
    // The names that the body binds. The scope of the top `Block` of a body
    // also holds the parameters, so that block is read by its statements:
    // its own locals are the names of its `Declare` statements.
    const binders = new Set<string>();
    if (isFunction(body, 'Block'))
      for (const statement of body.ops) {
        if (isFunction(statement, 'Declare') && isSymbol(statement.op1))
          binders.add(statement.op1.symbol);
        collectBinderNames(statement, binders);
      }
    else collectBinderNames(body, binders);
    const keptNames = new Set(names.filter((_, i) => !bound[i]));
    const substitution: Record<string, Expression> = {};
    const parts: string[] = [];
    let ok = true;
    for (const [i, a] of args.entries()) {
      if (!bound[i] || !isSymbol(a)) continue;
      const name = names[i];
      if (binders.has(name) || binders.has(a.symbol) || keptNames.has(a.symbol))
        ok = false;
      substitution[name] = a;
      parts.push(`${i}=${JSON.stringify(a.symbol)}`);
    }
    if (ok) {
      const variantBody = body.subs(substitution);
      const variant = engine.box([
        'Function',
        variantBody.json,
        ...params.filter((_, i) => !bound[i]).map((p) => p.json),
      ]);
      if (
        variantBody.isValid &&
        variant.isValid &&
        isFunction(variant, 'Function')
      ) {
        body = variant.ops[0];
        emitted = variant;
        kept = kept.filter((i) => !bound[i]);
        key = `${h}#bind${parts.join(',')}`;
      }
    }
  }

  const parameterNames = kept.map((i) => names[i]);
  // The declared type of each parameter. A parameter with no declared type
  // (the slot of the signature is `unknown`, as in `f(x) := x^2`) has no
  // type here: the pass gives it the type of its argument at the first call
  // (the spec, decision 11). The type of the parameter symbol is not read
  // for it: the engine infers it from the uses in the body (`number`), not
  // from the argument. When the signature of the function gives no type (the
  // function is declared `function`), the type of the parameter in the
  // literal, `Typed(u, 'real')`, is the declared type, as the emitter reads
  // it.
  const parameterTypes = kept.map((i) => {
    let declared = userFunctionParamType(engine, h, i);
    if (declared === undefined || declared === 'unknown' || declared === 'any')
      declared = declaredParamType(params[i]);
    if (declared === undefined || declared === 'unknown' || declared === 'any')
      return undefined;
    const fragment = glslFragmentTypeOf(declared);
    return fragment === undefined || fragment.kind === 'list'
      ? undefined
      : fragment;
  });

  // The body that the emitter compiles, prepared by the same two functions
  // as the emission: `definitionBodyExpr()` (the angular unit, the `parallel
  // for` heads and `+=` lowered, the collection-valued calls inlined, the
  // collections of fixed width unrolled), which `prepareUserFunctionBody()`
  // calls, then `shaderFunctionBody()`, which the `define` hook of the
  // shader targets calls. With no registry of user functions, the compiler
  // emits no definition, and the body has the lowering only.
  const registry = target.userFunctions;
  const definitionBody =
    registry === undefined
      ? undefined
      : definitionBodyExpr(emitted, target, registry, h);
  const prepared = shaderFunctionBody(
    definitionBody ?? bodyWithParallelHeadsLowered(body, target),
    target,
    parameterNames
  );

  // The emitter writes each parameter name unchanged into the shader
  // function, and refuses a name that GLSL reserves (the `define` hook of
  // `gpu-shader-target.ts`, `gpuCheckIdentifier()`). When it refuses, it
  // writes the body at the call site with the arguments in place of the
  // parameters, if the call allows it (`tryInlineUserFunctionCall()`: pure
  // scalar or literal-point arguments, no recursion, no captured name), and
  // the parameter names are then never written. For such a call, the
  // parameters are bound with no symbol, so the pass does not check their
  // names. The entry has its own key, because another call of the same
  // function may not allow the substitution.
  const reservedParameter = parameterNames.some((name) => {
    try {
      gpuCheckIdentifier(name, 'glsl');
      return false;
    } catch {
      return true;
    }
  });
  const substituted =
    reservedParameter && key === h
      ? inlinedUserFunctionCall(engine, h, args, target)
      : undefined;
  const inlined = substituted !== undefined;
  if (inlined) key = `${h}#inlined`;

  return {
    key,
    name: h,
    parameters: parameterNames,
    parameterTypes,
    // The symbol of a parameter: `u`, or the `u` of `Typed(u, 'real')`.
    parameterSymbols: kept.map((i) => {
      if (inlined) return undefined;
      const p = params[i];
      if (isSymbol(p)) return p;
      return isFunction(p) && isSymbol(p.op1) ? p.op1 : undefined;
    }),
    // A call with another number of arguments than the function has
    // parameters keeps all its arguments: the pass refuses it by its count.
    arguments: args.length === params.length ? kept.map((i) => args[i]) : args,
    body: prepared,
    // The tree whose size `compile()` checks (`checkDefinitionBody`): the
    // body written at the call site, with no node shared, or the body of
    // the definition before `shaderFunctionBody()`, which the common-
    // subexpression pass of the definition can share. With no registry of
    // user functions, `compile()` writes no definition and checks nothing.
    sizeCheck: inlined
      ? { body: substituted, shared: false }
      : definitionBody === undefined
        ? undefined
        : { body: definitionBody, shared: true },
    // Read on the body before its preparation, where a `+=` is an `AddTo`.
    sumAssigned: sumAssignedNames(body),
  };
}
