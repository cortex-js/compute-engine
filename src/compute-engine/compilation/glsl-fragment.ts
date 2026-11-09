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
import { GPU_COLOR_SPACES, GPU_GAMUT_HELPERS } from './gpu-color.js';
import { gpuNormalizeShaderType } from './gpu-declared-types.js';
import { tryGetConstant } from './constant-folding.js';
import { assertSafeBigOpBounds } from './compile-folding.js';
import { complexContinuation } from './complex-continuation.js';
import { shadowedLibraryLoweringError } from './compile-definitions.js';
import {
  fragmentScopeBinds,
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
const ARITHMETIC_2: FragmentRule<GlslRepresentation> = {
  signatures: [
    sig(['real', 'real'], 'real'),
    sig(['complex', 'complex'], 'complex'),
    sig(['point', 'point'], 'point', { broadcast: true }),
  ],
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
const POINT_COMPONENT = (sizes: readonly number[]) => ({
  signatures: [sig(['point'], 'real', { sizes })],
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
 * The positive list of the GLSL fragment (the spec, section 2), one rule per
 * head. The elementary functions with a complex helper in the GLSL tables
 * (`_gpu_c…`) take a complex operand; the others take reals only.
 */
export const GLSL_FRAGMENT_RULES: Readonly<
  Record<string, FragmentRule<GlslRepresentation>>
> = {
  // Arithmetic
  Add: ARITHMETIC_N,
  Multiply: ARITHMETIC_N,
  // A `Subtract` of one operand occurs only in a non-canonical tree. It
  // evaluates to its operand, and the emitter writes it as its operand.
  Subtract: {
    signatures: [...ARITHMETIC_2.signatures, ...ELEMENTARY.signatures],
  },
  Divide: ARITHMETIC_2,
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
  Sqrt: ELEMENTARY,
  Square: ELEMENTARY,
  Abs: {
    signatures: [
      sig(['real'], 'real'),
      sig(['complex'], 'real'),
      // The absolute value of a point is its Euclidean norm, as in the
      // interpreter: `|(3, 4)|` is 5. The compiler writes `Abs` of a point
      // as `Norm`.
      sig(['tuple'], 'real'),
      // The absolute value of a list of reals is the list of the absolute
      // values of its elements, as in the interpreter: `|[-1, 5, -3]|` is
      // `[1, 5, 3]`. The compiler writes the componentwise `abs`.
      sig(['point'], 'point'),
    ],
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
      sig(['point'], 'color', { sizes: [3] }),
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
  And: { signatures: [sig(['boolean'], 'boolean', { rest: 'boolean' })] },
  Or: { signatures: [sig(['boolean'], 'boolean', { rest: 'boolean' })] },
  Not: { signatures: [sig(['boolean'], 'boolean')] },

  // Selection, aggregates, indexing
  If: walk(walkIf),
  Which: walk(walkWhich),
  Sum: walk(walkSafeAggregate),
  Product: walk(walkSafeAggregate),
  At: walk(walkAt),
  Range: walk(walkRange),

  // The body of a user function (the spec, decisions 6, 7 and 8)
  Block: walk(walkBlock),
  Loop: walk(walkCountedLoop),
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
};

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
  const prepared = shaderFunctionBody(
    registry === undefined
      ? bodyWithParallelHeadsLowered(body, target)
      : definitionBodyExpr(emitted, target, registry, h),
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
  const inlined =
    reservedParameter &&
    key === h &&
    inlinedUserFunctionCall(engine, h, args, target) !== undefined;
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
    // Read on the body before its preparation, where a `+=` is an `AddTo`.
    sumAssigned: sumAssignedNames(body),
  };
}
