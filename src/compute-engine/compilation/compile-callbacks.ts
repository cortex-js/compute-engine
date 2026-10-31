// Callback literals: combiners, derivative literals, value references and
// wrappers.

import type {
  Expression,
  FunctionInterface,
  IComputeEngine as ComputeEngine,
} from '../global-types.js';
import type { MathJsonExpression } from '../../math-json/types.js';
import { INDEXED_COLLECTION_SHAPE_TYPE } from '../../common/type/primitive.js';
import { isDeclaredScalarType } from '../boxed-expression/boxed-function.js';
import {
  isTuple,
  isTupleShapedType,
  isPointListArgumentType,
  isPointTensorArgumentType,
  isPointOrPointListArgumentType,
} from '../collection-utils.js';
import {
  collectionElementType,
  functionResult,
  isNonRealNumber,
  resolveTypeAlias,
  stripMissingFromType,
} from '../../common/type/utils.js';
import {
  cannotHoldAList as typeCannotHoldAList,
  couldMatch,
  isSubtype,
} from '../../common/type/subtype.js';
import {
  typeToIdentityKey,
  typeToString,
} from '../../common/type/serialize.js';
import { parseType } from '../../common/type/parse.js';
import type { Type } from '../../common/type/types.js';
import {
  isSymbol,
  isString,
  isFunction,
} from '../boxed-expression/type-guards.js';
import {
  functionLiteralParameterName,
  functionLiteralParameterType,
  functionLiteralReturnMarker,
  functionLiteralReturnType,
} from '../boxed-expression/function-literal.js';
import { multiClauseState, type FunctionClause } from '../multi-clause.js';
import {
  jetDerivativeTarget,
  multiIndexDerivativeTooLarge,
} from './jet-derivative.js';
import { derivativeClosedForm } from './derivative-closed-form.js';
import type { CompileTarget } from './types.js';
import { builtinCallbackArity } from './builtin-callback.js';
import { core } from './compiler-core-hooks.js';
import {
  LOCAL_SCALAR,
  callbackLiteral,
  collectionElementTypeOf,
  declareValueOperand,
} from './compile-declarations.js';
import {
  paramElementTypeIsOpen,
  provablyScalarOrFramedScalar,
  signatureParamsLowerToScalars,
  userFunctionParamType,
} from './compile-user-calls.js';
import {
  userFunctionLiteral,
  userFunctionParamsAreScalar,
} from './compile-assignment-checks.js';
import { userFunctionSignature } from './compile-absence.js';
import type {
  DeclineNote,
  ReboundFunctionLocals,
  UserFunctionRegistry,
} from './compiler-types.js';
import { foldValueImpure, parametersCanBeTyped } from './compile-folding.js';
import { tempVar } from './compiler-naming.js';
import { isEmissionSkippable } from './compile-cse.js';
import { jsComplexObjectTest } from './compiler-type-facts.js';

/**
 * The complex-ness every element of `collection` shares, or `undefined` when
 * they do not all share one (or cannot be identified).
 *
 * This is the answer for an indexed read whose index is only known at RUN
 * time: no single element can be named, but when they all agree the verdict
 * holds whichever one the index selects.
 *
 * When the elements disagree, no static answer exists and this declines. The
 * read is then refused outright rather than lowered on a guess — see
 * {@link assertNoAmbiguousComplexElementRead}.
 */
export function uniformElementComplexness(
  collection: Expression
): boolean | undefined {
  const elements = core.elementComplexness(collection);
  if (elements === undefined || elements.length === 0) return undefined;
  return elements.every((e) => e === elements[0]) ? elements[0] : undefined;
}

/**
 * Is every element of the collection `a` a complex SCALAR? Answered from
 * the element TYPE when it is a non-real number type (`list<complex>`), or
 * from the identifiable elements when they all agree
 * (`uniformElementComplexness`, e.g. the literal `[w, 2w]`) and the element
 * type is at least numeric (so a nested list is never mistaken for a
 * scalar). `false` whenever it cannot be established.
 */
export function hasUniformComplexScalarElements(a: Expression): boolean {
  const elt = collectionElementTypeOf(a);
  if (elt === undefined) return false;
  if (isNonRealNumber(elt)) return true;
  if (!isSubtype(elt, 'number')) return false;
  return uniformElementComplexness(a) === true;
}

/**
 * Enter every parameter of `h` whose DECLARED type is a non-real number into
 * the body's complex shape frame.
 *
 * A declared-complex parameter is a property of the FUNCTION, not of any one
 * call: the one emission is the complex-lane one for that parameter and
 * every call site coerces its argument to match. Silent
 * on a generic or multi-clause signature, where `userFunctionParamType`
 * declines — those keep the previous emission exactly.
 */
/**
 * The parameter type that requests the complex `{ re, im }` LANE for
 * position `i` of `h` — a USER declaration only. An engine-authored
 * built-in's declared parameter is a DOMAIN statement, not a lane
 * request: a Contract B carrier such as `Sin: (complex)` spells "the
 * finite complex numbers, reals included", and reading it as a lane
 * request flipped every synthesized builtin-callback wrapper
 * (`Map(Sin, xs)` → `_fn_Sin`) to the complex kernel inside real-lane
 * surroundings — `_SYS.csin` cells under a scalar `reduce`. A built-in
 * used as a callback keeps the real-default-plus-runtime-rule
 * discipline its direct applications use. The builtin test is the same
 * one the wrapper synthesis performs (`builtinCallbackArity`: the name
 * resolves to the engine-authored system-scope definition).
 */
export function laneRequestParamType(
  engine: ComputeEngine,
  h: string,
  i: number
): Type | undefined {
  if (builtinCallbackArity(engine, h) !== undefined) return undefined;
  return userFunctionParamType(engine, h, i);
}

/**
 * The declared type of parameter `i` of the user function `h` that a
 * compiled call or a function value must test at run time, or `undefined`
 * when there is nothing to test: no declared type; `number`, which every
 * number a compiled value holds satisfies (a plain number or a `{re, im}`
 * object); a complex type, whose argument is coerced instead
 * (`coerceToComplex`); or a type with no faithful JavaScript test
 * (`jsClauseParamGuard`). Only on the JavaScript target, for a function
 * with a single literal: a multi-clause function guards each clause in
 * its dispatcher.
 */
export function checkedParameterType(
  engine: ComputeEngine,
  h: string,
  i: number,
  target: CompileTarget<Expression>
): Type | undefined {
  if (target.language !== 'javascript') return undefined;
  if (userFunctionLiteral(engine, h) === undefined) return undefined;
  let declared = userFunctionParamType(engine, h, i);
  if (declared === undefined) return undefined;
  // A parameter declared `broadcastable<T>` whose `T` cannot hold a list
  // maps to the cells (ROADMAP CE-405): each cell reaches the body, so it
  // is checked against `T`, as the interpreter checks it.
  if (
    typeof declared === 'object' &&
    declared.kind === 'broadcastable' &&
    typeCannotHoldAList(declared.elements)
  )
    declared = declared.elements;
  if (declared === 'number' || isNonRealNumber(declared)) return undefined;
  // The shape test of a `list` or `tuple` parameter applies to a DECLARED
  // signature only. A signature inferred from the body is not a contract:
  // `h := v ↦ v[1] + 1` is inferred `(tuple<number>) -> number`, and the
  // interpreter applies it to the list `[1, 2, 3]` (the answer is 2), while
  // the same parameter declared `tuple<number>` refuses that list.
  if (
    jsClauseParamGuard(declared, '_$v') === undefined &&
    userFunctionSignatureIsInferred(engine, h)
  )
    return undefined;
  const test = jsParameterGuard(declared, '_$v');
  return test === null || test === undefined ? undefined : declared;
}

/**
 * Whether the signature of the user function `h` was inferred from its
 * value, not declared: `inferredSignature` of an operator definition (a
 * function assigned with no declaration), or `inferredType` of a value
 * definition.
 */
export function userFunctionSignatureIsInferred(
  engine: ComputeEngine,
  h: string
): boolean {
  const def = engine.lookupDefinition(h);
  if (def === undefined) return false;
  if ('operator' in def) return def.operator.inferredSignature === true;
  return 'value' in def && def.value.inferredType === true;
}

/**
 * The name of the CHECKING SHIM of the user function `h` emitted as
 * `name`, emitted once next to it, or `undefined` when no parameter needs
 * a test (`checkedParameterType`). The shim tests each such parameter and
 * calls the function when every test passes:
 *
 *     const _fn_h$t = (_$0) =>
 *       Number.isInteger(_SYS.creal(_$0)) ? _fn_h(_$0) : NaN;
 *
 * `NaN` is the value compiled code has for an element the interpreter
 * answers with an error (the convention of the lowered `Map`,
 * `library/map-lowering.ts`). The test reads the REAL PROJECTION of the
 * argument (`_SYS.creal`), and the function receives that projection: a
 * value the complex lane carries is a `{re, im}` object, with `im: 0`
 * when it is real (`h(√y)` at `y = 4` hands the shim `{re: 2, im: 0}`),
 * and the body of a function whose parameter is declared `real` or
 * `integer` is compiled for a plain number (`2 * x` over the object is
 * `NaN`, `x + 1` is a string), so the projected `2` is what it must
 * receive, and `h(√y)` answers `4` as the interpreter does. A genuinely
 * complex value projects to itself, so it fails a `real` or `integer`
 * test as the interpreter's check does. A parameter with no test receives
 * its argument as it was handed in.
 *
 * Shared by the call route (`tryCompileUserFunction`, which emits a
 * checked call through the shim in every form the call takes) and the
 * value route (`ensureUserFunctionValueRef`, whose broadcasting wrapper
 * wraps the shim, so an element of a collection is checked after the
 * descent to it).
 */
export function checkingShimName(
  engine: ComputeEngine,
  h: string,
  name: string,
  target: CompileTarget<Expression>
): string | undefined {
  const registry = target.userFunctions;
  if (!registry || target.language !== 'javascript') return undefined;
  const literal = userFunctionLiteral(engine, h);
  if (literal === undefined) return undefined;
  const { params, passed, tests } = checkingShimTests(
    engine,
    h,
    literal.ops.length - 1,
    target
  );
  if (tests.length === 0) return undefined;
  const shim = `${name}$t`;
  const marker = failedCheckMarker(
    userFunctionSignature(engine, h),
    literal.type.type
  );
  if (!registry.defs.has(shim))
    registry.defs.set(
      shim,
      `const ${shim} = (${params.join(', ')}) => ` +
        `(${tests.join(' && ')}) ? ${name}(${passed.join(', ')}) : ${marker};`
    );
  return shim;
}

/**
 * The value that a checking shim (`checkingShimName`,
 * `localCheckingCallee`) gives when an argument fails the test of its
 * declared parameter type, where the interpreter answers an
 * `incompatible-type` error: the absence marker of the declared result
 * type of the function, chosen as `absentCollectionOperandGuard` chooses
 * it, after the `missing` arm of the result is removed (a result typed
 * `list<real> | missing` is a collection). `undefined`, the value
 * compiled code has for an absent collection or an absent boolean, when
 * the result is a collection (`list`, `list<real>`, …) or a boolean, and
 * `NaN`, the numeric marker, when the result is a number.
 *
 * A declared result that does not decide it (`unknown`, `any`, a union of
 * a collection and a number such as `list | number`, no declared
 * signature) is decided by the result type of the literal itself,
 * `literal`. That is the type a call of the function carries: the type
 * of the call is narrowed to the type of the body, so with
 * `f: (real) -> list | number` and `f := x ↦ [x, 1]`, `f(w)` is typed
 * `vector<2>`, and a `Join` reads it as a collection. The marker must be
 * the one that consumer tests (`absentCollectionOperandGuard`), or the
 * consumer spreads a `NaN`. When neither type decides it, the marker is
 * `NaN`.
 */
export function failedCheckMarker(
  signature: Type | undefined,
  literal?: Type
): 'undefined' | 'NaN' {
  const markerOf = (t: Type | undefined): 'undefined' | 'NaN' | undefined => {
    const declared = functionResult(t);
    if (declared === undefined) return undefined;
    const result = stripMissingFromType(declared);
    if (result === 'unknown' || result === 'any' || result === 'never')
      return undefined;
    if (isSubtype(result, 'collection') || isSubtype(result, 'boolean'))
      return 'undefined';
    if (isSubtype(result, 'number')) return 'NaN';
    return undefined;
  };
  return markerOf(signature) ?? markerOf(literal) ?? 'NaN';
}

/**
 * The parameter tests of the checking shim of `h` (`checkingShimName`):
 * the shim's parameter names (`_$0`, `_$1`, …), the value it passes for
 * each one (the real projection `_SYS.creal(_$i)` of a tested parameter,
 * the parameter itself otherwise), and one JavaScript test for each tested
 * parameter. `tests` is empty when no parameter needs a test.
 */
export function checkingShimTests(
  engine: ComputeEngine,
  h: string,
  nParams: number,
  target: CompileTarget<Expression>
): { params: string[]; passed: string[]; tests: string[] } {
  const params = Array.from({ length: nParams }, (_, i) => `_$${i}`);
  const passed = [...params];
  const tests: string[] = [];
  for (let i = 0; i < nParams; i++) {
    const pt = checkedParameterType(engine, h, i, target);
    if (pt === undefined) continue;
    const projected = `_SYS.creal(${params[i]})`;
    const test = jsParameterGuard(pt, projected);
    if (test === null || test === undefined) continue;
    tests.push(test);
    passed[i] = projected;
  }
  return { params, passed, tests };
}

/**
 * The first argument position at which a call of the single-literal user
 * function `h` (literal `literal`) with `args` is a strict-mode lane
 * mismatch, or `-1`: the argument is complex-shaped — a complex-valued
 * SCALAR (`provablyScalarOrFramedScalar`), or, to scalar parameters that
 * the call broadcasts over, a collection whose elements are all complex
 * scalars (`hasUniformComplexScalarElements`: the runtime broadcast hands
 * the body one complex element per call) — and the parameter is NOT
 * declared a non-real number type. An argument that is neither provably a
 * scalar nor a uniformly-complex collection is not a mismatch (a mixed list
 * has no one shape; its elements are handled per element).
 */
export function laneMismatchAt(
  engine: ComputeEngine,
  h: string,
  literal: Expression & FunctionInterface,
  args: ReadonlyArray<Expression>
): number {
  const nParams = literal.ops.length - 1;
  for (let i = 0; i < nParams; i++) {
    const a = args[i];
    if (a === undefined) continue;
    let complex: boolean;
    if (provablyScalarOrFramedScalar(a)) complex = core.isComplexValued(a);
    else if (userFunctionParamsAreScalar(engine, h))
      complex = hasUniformComplexScalarElements(a);
    else complex = false;
    if (!complex) continue;
    const pt = userFunctionParamType(engine, h, i);
    if (pt === undefined || !isNonRealNumber(pt)) return i;
  }
  return -1;
}

/**
 * `literal` rebuilt with parameter `i` typed `types[i]` (a `Typed`
 * parameter), or `undefined` when the rebuilt literal is not valid. A
 * parameter whose entry is `undefined` is kept as it is written.
 *
 * The body is boxed again from its MathJSON, so each reference to a
 * parameter in the body is bound to the new, typed parameter, and the
 * types of the body nodes follow from it. The rebuilt literal is used for
 * an emission only. It is never stored on the definition of the function.
 */
export function literalWithParameterTypes(
  engine: ComputeEngine,
  literal: Expression & FunctionInterface,
  types: ReadonlyArray<Type | undefined>
): (Expression & FunctionInterface) | undefined {
  const params = literal.ops.slice(1);
  let specialized: Expression;
  // Rebuild under the definition's lexical parent, never under a caller's
  // local scope. Parameter bindings are fresh and cannot narrow the source.
  engine.pushScope({
    parent: literal.op1.localScope?.parent ?? null,
    bindings: new Map(),
  });
  try {
    const body = literal.op1;
    const marker = functionLiteralReturnMarker(literal);
    const resultType = functionLiteralReturnType(literal);
    // A broad result ascription hides the representation derived from
    // the narrower parameters. Scalar promises remain authoritative.
    const scalarResult =
      resultType !== undefined &&
      (isSubtype(resultType, 'number') ||
        isSubtype(resultType, 'boolean') ||
        isSubtype(resultType, 'string'));
    const bodyJson =
      marker && !scalarResult && isFunction(body, 'Block')
        ? ([
            'Block',
            ...body.ops.slice(0, -1).map((x) => x.json),
            marker.op1.json,
          ] as MathJsonExpression)
        : body.json;
    specialized = engine.box([
      'Function',
      bodyJson,
      ...params.map((p, i) => {
        const t = types[i];
        if (t === undefined) return p.json;
        return [
          'Typed',
          functionLiteralParameterName(p)!,
          `'${typeToString(t)}'`,
        ] as MathJsonExpression;
      }),
    ]);
  } finally {
    engine.popScope();
  }
  if (!isFunction(specialized, 'Function') || !specialized.isValid)
    return undefined;
  return specialized;
}

/** A key for the definition of `h` with the parameter types `types`. */
export function parameterTypesKey(
  h: string,
  types: ReadonlyArray<Type | undefined>
): string {
  return `${h}#${types.map((t) => (t === undefined ? '' : typeToIdentityKey(t))).join(';')}`;
}

/** `literalWithParameterTypes`, kept in the specialization cache of the
 * compilation (`registry.specializations`). */
export function cachedLiteralWithParameterTypes(
  engine: ComputeEngine,
  h: string,
  literal: Expression & FunctionInterface,
  types: ReadonlyArray<Type | undefined>,
  registry: UserFunctionRegistry
): (Expression & FunctionInterface) | undefined {
  const cache = (registry.specializations ??= new Map());
  const key = parameterTypesKey(h, types);
  const hit = cache.get(key);
  if (hit !== undefined) return isFunction(hit, 'Function') ? hit : undefined;
  const rebuilt = literalWithParameterTypes(engine, literal, types);
  if (rebuilt !== undefined) cache.set(key, rebuilt);
  return rebuilt;
}

/** Whether a BUILTIN fold over `coll` seeded with `init` runs in the complex
 * lane: its elements are complex scalars, or its seed is complex-shaped. */
export function foldLaneIsComplex(
  coll: Expression,
  init: Expression | undefined | null
): boolean {
  return (
    hasUniformComplexScalarElements(coll) ||
    (init !== undefined && init !== null && core.isComplexValued(init))
  );
}

export function combinerPlan(
  coll: Expression,
  op: Expression,
  init: Expression | undefined | null,
  target?: CompileTarget<Expression>
):
  | {
      op: Expression;
      accComplex: boolean;
      eltComplex: boolean;
      coerceSeed: boolean;
    }
  | undefined {
  // A block-local combiner is resolved through the compiler's own registry
  // (`callbackLiteral`); the engine's definitions cannot see it.
  const literal = callbackLiteral(op, target);
  if (literal === undefined) return undefined;
  if (!isFunction(literal, 'Function') || literal.nops !== 3) return undefined;
  // A parameter spelled `_` (or a destructuring pattern) has no name to
  // enter in a frame — `functionLiteralParameterName` answers `''` — but the
  // OTHER lane still needs planning: `(a, _) ↦ a + i` widens its accumulator
  // without ever naming the element. So an unnamed parameter is simply not
  // framed; it is never a reason to abandon the plan.
  const accName = functionLiteralParameterName(literal.ops[1]);
  const eltName = functionLiteralParameterName(literal.ops[2]);

  const eltComplex = hasUniformComplexScalarElements(coll);
  const seedless = init === undefined || init === null;
  const seedComplex = !seedless && core.isComplexValued(init);
  const declared = accName
    ? literalDeclaredParamTypes(literal)[accName]
    : undefined;
  const accTyped = declared !== undefined && isNonRealNumber(declared);

  let accComplex = accTyped || seedComplex || (seedless && eltComplex);
  if (!accComplex) {
    // First-step state: element in its lane, accumulator real. A complex
    // RESULT widens the accumulator from the second step on.
    const complex = new Map<string, boolean>();
    const vector = new Map<string, number>();
    if (eltName) vector.set(eltName, LOCAL_SCALAR);
    if (accName) vector.set(accName, LOCAL_SCALAR);
    // Both lanes are entered explicitly, real ones too. A name left out is
    // answered by an enclosing rule, and for a parameter named `i` that
    // rule is the imaginary unit: `Reduce(L, (acc, i) => acc + i, [0, 0])`
    // over a list of rows was put in the complex lane and answered
    // `[{re: null}, {re: null}]` where `(acc, x)` answered `[4, 7]`.
    if (eltName) complex.set(eltName, eltComplex);
    if (accName) complex.set(accName, false);
    accComplex = core.withLocalShapeFrame(
      complex,
      vector,
      () => core.isComplexValued(literal.op1),
      true
    );
  }
  const coerceSeed = accComplex && !seedless && !seedComplex;

  if (isSymbol(op)) {
    if (!accComplex && !eltComplex)
      return { op, accComplex, eltComplex, coerceSeed };
    const engine = op.engine;
    const eltType = collectionElementTypeOf(coll);
    const eltTypeText =
      eltType !== undefined && isNonRealNumber(eltType)
        ? typeToString(eltType)
        : 'complex';
    const a = engine.symbol('_a');
    const x = engine.symbol('_x');
    const eta = engine.function('Function', [
      engine.function(op.symbol, [a, x]),
      accComplex
        ? engine.function('Typed', [a, engine.box({ str: 'complex' })])
        : a,
      eltComplex
        ? engine.function('Typed', [x, engine.box({ str: eltTypeText })])
        : x,
    ]);
    return { op: eta, accComplex, eltComplex, coerceSeed };
  }
  return { op, accComplex, eltComplex, coerceSeed };
}

/**
 * The closed form of the derivative callee of
 * `Apply(Derivative(f, n), x)` or `Apply(Derivative(f, k₁, …, kₙ), x₁, …,
 * xₙ)` as a function literal, or `undefined`. The `Derivative` evaluate
 * handler computes the closed form (library/calculus.ts), so the literal
 * has one parameter for each argument of `f`; the caller checks that this
 * count is the count of the arguments. A derivative of a large body or of
 * a high order (`appliedDerivativeTooLarge`) is not resolved, because its
 * closed form grows past a useful size. The interval target and the shader
 * targets read the literal: they have no other lowering for a derivative.
 * `options.exactFactors` is the option of the angular-unit rewrite of the
 * closed form (`rewriteAngularUnit()`): the interval target asks for exact
 * factors.
 */
export function appliedDerivativeLiteral(
  args: ReadonlyArray<Expression>,
  options?: { exactFactors?: boolean }
): Expression | undefined {
  if (!isFunction(args[0], 'Derivative')) return undefined;
  if (appliedDerivativeTooLarge(args)) return undefined;
  return derivativeClosedForm('Derivative', args[0].ops, options);
}

/**
 * Why `appliedDerivativeLiteral(args)` has no literal for a `Derivative`
 * callee, as a phrase for a decline message: the closed form is too large
 * to write out (`appliedDerivativeTooLarge`), or there is no closed form.
 */
export function appliedDerivativeDeclineReason(
  args: ReadonlyArray<Expression>
): string {
  return appliedDerivativeTooLarge(args)
    ? 'the closed form of the derivative is too large to write out'
    : 'the derivative has no closed form';
}

/**
 * Whether the closed form of the derivative callee of `args` is too large
 * to write out: a large body or a high order. For a function of one
 * argument, this is when `jetDerivativeTarget` claims the application, and
 * the JavaScript target then lowers it through forward-mode
 * differentiation. For a multi-index derivative, the same measure is
 * applied to the total order (`multiIndexDerivativeTooLarge`), and no
 * target has another lowering.
 */
export function appliedDerivativeTooLarge(
  args: ReadonlyArray<Expression>
): boolean {
  if (!isFunction(args[0], 'Derivative')) return false;
  const literalOf = (id: string) => userFunctionLiteral(args[0].engine, id);
  return (
    jetDerivativeTarget(args, literalOf, false) !== undefined ||
    multiIndexDerivativeTooLarge(args[0], literalOf)
  );
}

/**
 * The reason why an argument of `Apply(literal, …actuals)` cannot be
 * bound to its parameter, or `undefined` when all the arguments can be
 * bound.
 *
 * In a strict engine, the interpreter checks each argument against the
 * declared type of its parameter (`u: real`) and gives an
 * `incompatible-type` error when they do not match: `Apply(u: real ↦ 2u,
 * (a, b))` is that error under `evaluate()`. Compiled code with no check
 * gives a value for the same application (`2.0 * vec2(a, b)` on a
 * shader, `[2a, 2b]` in JavaScript, where a point is an array that the
 * run-time broadcast maps over). Thus the compiled application is
 * declined when the static type of an argument cannot be a value of the
 * declared type (`couldMatch`). An argument of unknown type, or a
 * parameter with no declared type, is not checked, because the
 * interpreter accepts all values there.
 *
 * When `mapsElements` is true, the interpreter applies the function to
 * each element of a list argument (the parameters are scalar), so the
 * type that is checked is the element type at the deepest list rank. The
 * descent stops at a tuple (a point is bound whole), at a string, and at
 * a collection that is not indexed, as the run-time broadcast does. When
 * it is false, each argument is bound whole and its own type is checked.
 *
 * The shader targets (`gpuAppliedBody`, `gpu-functions.ts`) and the
 * JavaScript target (`Apply`, `javascript-target.ts`) use this check.
 */
export function appliedArgumentTypeMismatch(
  literal: Expression,
  actuals: ReadonlyArray<Expression>,
  mapsElements: boolean
): string | undefined {
  if (!isFunction(literal, 'Function') || !literal.engine.strict)
    return undefined;
  const boundType = (t: Type): Type => {
    if (!mapsElements) return t;
    // The bound keeps a recursive type alias from looping.
    for (let rank = 0; rank < 8; rank++) {
      if (isTupleShapedType(t) || isSubtype(t, 'string')) break;
      if (!isSubtype(t, INDEXED_COLLECTION_SHAPE_TYPE)) break;
      const element = collectionElementType(t);
      if (element === undefined) break;
      t = element;
    }
    return t;
  };
  // A tuple at a parameter declared as a scalar maps over its components
  // (`declaredScalarTupleCells`, user decision 2026-10-03), so each
  // component is checked, and a component that is a tuple is checked in
  // the same way. A list component is a mismatch, as it is an error in the
  // interpreter (`([1, 2], [3, 4])` is data, not a point).
  const componentMismatch = (t: Type, declared: Type): Type | undefined => {
    for (let depth = 0; depth < 8; depth++) {
      const r = resolveTypeAlias(t);
      if (typeof r !== 'object' || r.kind !== 'tuple')
        return couldMatch(r, declared) ? undefined : r;
      for (const e of r.elements) {
        const bad = componentMismatch(e.type, declared);
        if (bad !== undefined) return bad;
      }
      return undefined;
    }
    return undefined;
  };
  for (const [i, p] of literal.ops.slice(1).entries()) {
    const declared = functionLiteralParameterType(p);
    const actual = actuals[i];
    if (declared === undefined || actual === undefined) continue;
    // At a parameter declared as a point (`p: tuple<real, real>`), the
    // interpreter maps the call over a list of points, and over a tensor of
    // points at every depth (user decisions 2026-09-25 and 2026-10-25,
    // ROADMAP CE-448). A value that may be one point or a collection of
    // points (`broadcastable<tuple<…>>`) is mapped when it is a list. The
    // application compiled here binds the argument whole, so it would give
    // a different value: it is declined. A call of a user function whose
    // signature declares the point parameter is mapped before this check
    // (`tryCompilePointListCall`); this check is reached for a function
    // literal, and for a user function declared with the bare type
    // `function`.
    if (
      !isTuple(actual) &&
      (isPointListArgumentType(actual.type.type, declared) ||
        isPointTensorArgumentType(actual.type.type, declared) ||
        isPointOrPointListArgumentType(actual.type.type, declared))
    )
      return (
        `the argument \`${actual.toString()}\` has the type ` +
        `\`${typeToString(actual.type.type)}\`, a collection of points or ` +
        `a value that may be one, at the parameter ` +
        `\`${functionLiteralParameterName(p)}\` declared as the point ` +
        `\`${typeToString(declared)}\`. The interpreter maps the call over ` +
        `the points, and the compiled application binds the argument whole.`
      );
    let type = boundType(actual.type.type);
    if (isDeclaredScalarType(declared) && isTupleShapedType(type)) {
      const bad = componentMismatch(type, declared);
      if (bad === undefined) continue;
      type = bad;
    }
    if (couldMatch(type, declared)) continue;
    return (
      `the argument \`${actual.toString()}\` ` +
      (type === actual.type.type
        ? `has the type \`${typeToString(type)}\``
        : `has elements of the type \`${typeToString(type)}\``) +
      `, which does not match the type \`${typeToString(declared)}\` of ` +
      `the parameter \`${functionLiteralParameterName(p)}\`. The ` +
      `interpreter gives an \`incompatible-type\` error for this ` +
      `application.`
    );
  }
  return undefined;
}

export function withDerivativeArgument<T>(
  literal: Expression,
  arg: Expression,
  fn: () => T
): T {
  if (!isFunction(literal, 'Function') || literal.nops !== 2) return fn();
  const name = functionLiteralParameterName(literal.ops[1]);
  if (!name) return fn();
  const type = declaredParamType(literal.ops[1]);
  const complex =
    core.isComplexValued(arg) || (type !== undefined && isNonRealNumber(type));
  // Analyze and emit the closed form with the same argument representation.
  // Owning the frame prevents the literal from masking this information.
  return core.withLocalShapeFrame(
    new Map([[name, complex]]),
    new Map([[name, LOCAL_SCALAR]]),
    fn,
    false,
    literal
  );
}

/**
 * Compile an INLINE combiner lambda under the lanes `combinerPlan` chose:
 * its accumulator and element parameters are entered in a local shape
 * frame (complex where the lane is complex, scalar in either case), so the
 * body's operand analysis — and therefore its emitted arithmetic — treats
 * them as the values the fold actually passes. The frame STACKS on the
 * enclosing ones (the lambda is lexically inside the fold's expression).
 *
 * The frame is pushed as the literal's OWNER, so the literal's own emission
 * recognizes it as its own description and does not shadow it with a frame
 * built from the declaration alone (`isFramedByForeignScope`). A REAL lane is
 * entered explicitly rather than left out, so that the frame answers for both
 * parameters in both stacks: a name left unmentioned would be answered by an
 * enclosing frame, which is neither this plan's lane nor a description of
 * this lambda.
 *
 * The JavaScript target calls this from inside `hoistedCallbackLambda`
 * (`compilation/javascript-target.ts`), which gives a fold's combiner the
 * same loop-invariant hoist the element-consuming callbacks get. The hoist
 * compiles and declares its bindings AROUND this call, so a binding is
 * emitted outside the frame this function pushes. That is what the hoist
 * needs: a binding mentions neither parameter, so the frame has nothing to
 * say about it, and the names the frame describes do not exist where the
 * bindings are declared.
 */
export function compileCombinerLiteral(
  plan: { op: Expression; accComplex: boolean; eltComplex: boolean },
  compile: (e: Expression) => string
): string {
  const literal = plan.op;
  if (!isFunction(literal, 'Function') || literal.nops !== 3)
    return compile(literal);
  const accName = functionLiteralParameterName(literal.ops[1]);
  const eltName = functionLiteralParameterName(literal.ops[2]);
  const complex = new Map<string, boolean>();
  const vector = new Map<string, number>();
  if (accName) {
    vector.set(accName, LOCAL_SCALAR);
    complex.set(accName, plan.accComplex);
  }
  if (eltName) {
    vector.set(eltName, LOCAL_SCALAR);
    complex.set(eltName, plan.eltComplex);
  }
  return core.withLocalShapeFrame(
    complex,
    vector,
    () => compile(literal),
    false,
    literal
  );
}

/**
 * The name to use where a user function is referenced as a VALUE rather than
 * called — `Map(Q, xs)`, `CountIf`, `Find`, `_SYS.bcastFn`.
 *
 * The consumers of a function value hand the callee a RAW element: the
 * argument coercion lives in `emitUserFunctionCall`, which only the call
 * route reaches. So a function with a declared-complex parameter, whose body
 * `addDeclaredComplexParams` puts in the complex lane, cannot be passed by
 * name — `Map(Q, [1, 2, 3])` fed plain numbers to a body reading `.re`/`.im`
 * and answered `[{re: null, im: null}, …]` behind `success: true`, where the
 * previous real-lane emission computed correctly.
 *
 * The fix is a coercing shim under its OWN name, so the two routes do not
 * share a cache entry: `const _fn_Q$v = (x) => _fn_Q(_SYS.cplx(x));`. The
 * runtime helper is used rather than a static wrap because an element's
 * realness is a property of the source, not of the reference, and the
 * reference is compiled without one — `_SYS.cplx` is idempotent, so a
 * complex element passes through and a real one is wrapped.
 *
 * The second coercion a raw element needs is the BROADCAST one. A user
 * function whose parameters are all scalar is applied element-wise by the
 * interpreter when an argument is a collection, and the emitted CALL sites
 * reproduce that (`_SYS.bcastFn`, or an `Array.isArray` guard); the body
 * itself is emitted for scalars only. A value reference had no such
 * dispatch, and the consumer of the value passes whatever element it holds:
 * for `f(x) := 2x`, `Map(f, [[1, 2], [3, 4]])` handed a whole ROW to a body
 * that multiplies, and answered `[NaN, NaN]` where the interpreter answers
 * `[[2, 4], [6, 8]]`. So a scalar-parameter function is handed out as a
 * shape-aware wrapper under its own name, emitted ONCE next to the
 * function itself — a consumer that maps over a million elements pays one
 * closure, not one per element. The wrapper always BROADCASTS (`$b`),
 * because the interpreter always does at a callback position: a callback
 * whose parameters are all scalar is applied element-wise to a collection
 * element, whether those parameters are DECLARED scalars
 * (`(number) -> number`) or left open, which is the user ruling of
 * 2026-09-22. Before that ruling a declared-scalar callback was refused
 * there, and the reference took a second, guarding form that projected an
 * array element to NaN. A function with a parameter that is NOT scalar
 * binds its arguments whole and keeps the plain reference, because the
 * interpreter does not broadcast it either.
 *
 * The wrapper takes the complex-coercing shim as its callee where both
 * apply, so an element reaches the body coerced, the same order the
 * call route dispatches in (`dispatchCall`).
 *
 * Returns the plain name unchanged when there is nothing to coerce and no
 * argument that could be a collection.
 */
export function ensureUserFunctionValueRef(
  engine: ComputeEngine,
  h: string,
  target: CompileTarget<Expression>,
  decline?: DeclineNote
): string | undefined {
  const name = core.ensureUserFunctionEmitted(engine, h, target, decline);
  if (name === undefined) return undefined;
  if (target.language !== 'javascript') return name;
  const registry = target.userFunctions;
  if (!registry) return name;

  const literal = userFunctionLiteral(engine, h);
  // A MULTI-CLAUSE function has no single literal to read a parameter list
  // from, and takes its own wrapper.
  if (literal === undefined)
    return multiClauseValueRef(engine, h, name, target) ?? name;
  const nParams = literal.ops.length - 1;
  const complexParam: boolean[] = [];
  for (let i = 0; i < nParams; i++) {
    // `laneRequestParamType`, not the raw param type: a built-in's
    // Contract B carrier is a domain statement, never a lane request.
    const pt = laneRequestParamType(engine, h, i);
    complexParam.push(pt !== undefined && isNonRealNumber(pt));
  }

  let callee = name;
  if (complexParam.some((c) => c)) {
    callee = `${name}$v`;
    if (!registry.defs.has(callee))
      registry.defs.set(
        callee,
        `const ${callee} = ${complexCoercingWrapper(
          name,
          complexParam,
          target
        )};`
      );
  }

  // A parameter with a DECLARED type takes the checking shim
  // (`checkingShimName`): the consumer of a value reference hands the body
  // a raw element, which the interpreter would have checked against the
  // annotation. The broadcasting wrapper below wraps the shim, so an
  // element of a collection argument is checked after the descent to it.
  callee = checkingShimName(engine, h, callee, target) ?? callee;

  // A parameterless function has no argument that could be a collection.
  if (nParams === 0) return callee;
  if (!userFunctionParamsAreScalar(engine, h))
    return (
      listSpecializedValueRef(engine, h, literal, callee, target) ?? callee
    );
  // A parameter that lowers to an array or object (a tuple, a record, a
  // nominal value) must reach the body whole — see
  // `signatureParamsLowerToScalars`.
  if (!signatureParamsLowerToScalars(userFunctionSignature(engine, h)))
    return callee;

  // Every scalar-parameter function takes the BROADCASTING wrapper, whatever
  // its parameter types say. Until the user ruling of 2026-09-22 a function
  // whose parameters were DECLARED scalars — `(number) -> number` — was
  // refused by the interpreter at a callback position, and took a guarding
  // wrapper that projected an array element to NaN. The interpreter now
  // broadcasts there, exactly as a direct application of the same function
  // always has, so the guarding form has no behavior left to reproduce.
  const wrapperName = `${name}$b`;
  if (!registry.defs.has(wrapperName))
    registry.defs.set(
      wrapperName,
      `const ${wrapperName} = ${broadcastingWrapper(
        callee,
        nParams,
        target,
        'bcastFn'
      )};`
    );
  return wrapperName;
}

/**
 * The value reference of a ONE-parameter user function `h` whose parameter
 * binds a collection whole and has an open element type (a lifted slot
 * such as `collection<any> | value`, see `wholeCollectionParameterType`,
 * or a declared `collection<any> | number`): a dispatcher that hands an
 * array element to the definition SPECIALIZED to `list<number>` and any
 * other element to `callee`:
 *
 *     const _fn_h$l = (_$0) =>
 *       Array.isArray(_$0) ? _fn_h_list_number_(_$0) : _fn_h(_$0);
 *
 * The generic definition is compiled against the scalar arm of the slot
 * (`_SYS.mean(xs * xs)` for `h(xs) := mean(xs^2)`), so a row of
 * `Map(h, rows)` handed to it computed `NaN` where the interpreter binds
 * the row whole and answers its mean of squares; the specialization maps
 * the element-wise operators over the array
 * (`ensureSpecializedUserCallEmitted` does the same for a direct call with
 * a list argument). `undefined` when the specialization cannot be emitted
 * (the parameters cannot be typed again, a target with its own definition
 * lowering), or when the function has not exactly one parameter or its
 * slot's element type is not open.
 */
export function listSpecializedValueRef(
  engine: ComputeEngine,
  h: string,
  literal: Expression & FunctionInterface,
  callee: string,
  target: CompileTarget<Expression>
): string | undefined {
  const registry = target.userFunctions;
  if (!registry || registry.lowering || target.language !== 'javascript')
    return undefined;
  if (literal.ops.length !== 2) return undefined;
  if (!paramElementTypeIsOpen(engine, h, 0)) return undefined;
  if (!parametersCanBeTyped(literal)) return undefined;
  if (registry.specializing?.has(h)) return undefined;
  const types: Type[] = [{ kind: 'list', elements: 'number' }];
  const specialized = cachedLiteralWithParameterTypes(
    engine,
    h,
    literal,
    types,
    registry
  );
  if (specialized === undefined) return undefined;
  const active = (registry.specializing ??= new Set());
  active.add(h);
  let name: string | undefined;
  try {
    name = core.emitFunctionLiteralDefinition(
      h,
      specialized,
      target,
      registry,
      { key: parameterTypesKey(h, types), types }
    );
  } catch (e) {
    if (e instanceof Error && e.name === 'CancellationError') throw e;
    name = undefined;
  } finally {
    active.delete(h);
  }
  if (name === undefined) return undefined;
  const dispatcher = `${callee}$l`;
  if (!registry.defs.has(dispatcher))
    registry.defs.set(
      dispatcher,
      `const ${dispatcher} = (_$0) => Array.isArray(_$0) ? ${name}(_$0) : ${callee}(_$0);`
    );
  return dispatcher;
}

/**
 * The value reference of a MULTI-CLAUSE user function `h`, emitted under
 * `name`: the shape-aware wrapper `ensureUserFunctionValueRef` describes,
 * or `undefined` when `h` is not a multi-clause function, when one of its
 * clauses binds an argument whole, or when every clause is parameterless.
 *
 * A clause set has no single function literal, so the single-clause route
 * cannot read a parameter list from it and the bare DISPATCHER used to be
 * handed out. The consumer of a function value passes whatever element the
 * source holds, and an element can itself be a collection — a row of a
 * matrix. With `h(x) := 3x`, `mc(x) := h(x) + 1` and
 * `mc(x, y) := h(x) + h(y)`, `Map(mc, [[1, 2], [3]])` handed a whole row to
 * clause bodies that are scalar code, and answered `["3,61", "91"]` (the
 * row's string coercion) where the interpreter answers `[[4, 7], [10]]`.
 *
 * The wrapper takes a REST parameter where a single-clause function's takes
 * a fixed one: the dispatcher selects a clause on the NUMBER of arguments,
 * so any fixed arity would answer `no-matching-clause` for every other
 * overload. What makes the rest form safe here is that every emitted
 * consumer applies a function value through an arrow of the arity it means
 * to pass — `(_x) => _f(_x)` for `Map`, `(_a, _b) => _f(_a, _b)` for a
 * `Reduce` combiner — so none of them supplies the extra index and source
 * arguments `Array.prototype.map` would.
 *
 * The complex `{ re, im }` coercion needs no shim on this route: the
 * dispatcher lifts a declared-complex parameter itself, per clause, after
 * it has chosen one (`tryEmitMultiClauseFunction`).
 */
export function multiClauseValueRef(
  engine: ComputeEngine,
  h: string,
  name: string,
  target: CompileTarget<Expression>
): string | undefined {
  const registry = target.userFunctions;
  if (!registry) return undefined;
  const clauses = multiClauseState(engine.lookupDefinition(h))?.clauses;
  if (clauses === undefined || clauses.length === 0) return undefined;

  // The same two gates the single-clause route applies, read over the
  // clause set: a clause that binds a collection whole is not broadcast by
  // the interpreter either (`paramsAreScalar` reads the clause
  // intersection arm by arm), and a clause parameter that lowers to an
  // array or an object — a tuple, a record, a nominal value — must reach
  // the body whole (`signatureParamsLowerToScalars`, which reads one
  // signature, so each clause is asked separately).
  if (!userFunctionParamsAreScalar(engine, h)) return undefined;
  if (!clauses.every((c) => signatureParamsLowerToScalars(c.signature)))
    return undefined;
  // A clause set whose every clause is parameterless has no argument that
  // could be a collection, so it needs no wrapper.
  const clauseParams = (c: FunctionClause) => [
    ...(c.signature.args ?? []),
    ...(c.signature.optArgs ?? []),
    ...(c.signature.variadicArg ? [c.signature.variadicArg] : []),
  ];
  if (clauses.every((c) => clauseParams(c).length === 0)) return undefined;

  // Every clause set that reaches here takes the BROADCASTING wrapper. A
  // clause set whose every parameter was a DECLARED scalar used to take a
  // guarding wrapper instead, because the interpreter refused a collection
  // argument at a callback position; since the user ruling of 2026-09-22 it
  // broadcasts there, so there is one form left.
  const wrapperName = `${name}$b`;
  if (!registry.defs.has(wrapperName))
    registry.defs.set(
      wrapperName,
      `const ${wrapperName} = ${broadcastingWrapper(
        name,
        'rest',
        target,
        'bcastFn'
      )};`
    );
  return wrapperName;
}

/**
 * The `Function` literals that are being compiled for a consumer which
 * passes them run-time scalars only, and what the consumer proved about
 * those scalars. `'scalar'`: no argument is an array. `'finite'`: every
 * argument is also a finite number, never NaN and never `undefined`.
 * An entry exists only while `withScalarFedLiteral` runs, so the same
 * node compiled in another position is not affected.
 */
export const scalarFedLiterals = new Map<Expression, 'scalar' | 'finite'>();

/**
 * Run `compile` with `literal` (a `Function` expression) marked as fed
 * run-time scalars only — see `scalarFedLiterals`. The `Function` lowering
 * then emits the bare arrow without the broadcast wrapper, and records its
 * parameters as scalars (and, for `'finite'`, as decided values) for the
 * body. The caller is responsible for the claim: it must pass the
 * resulting function only arguments of the stated kind.
 */
export function withScalarFedLiteral<T>(
  literal: Expression,
  kind: 'scalar' | 'finite',
  compile: () => T
): T {
  const map = scalarFedLiterals;
  const previous = map.get(literal);
  map.set(literal, kind);
  try {
    return compile();
  } finally {
    if (previous === undefined) map.delete(literal);
    else map.set(literal, previous);
  }
}

/**
 * Mark each of `literals` as fed run-time scalars only (`'scalar'`), as
 * `withScalarFedLiteral` marks one literal for the time of a callback. The
 * caller runs the returned function when the compilation that needs the
 * marks is done; it restores the marks that were there before.
 */
export function markScalarFedLiterals(
  literals: ReadonlyArray<Expression>
): () => void {
  const map = scalarFedLiterals;
  const previous = literals.map((literal) => map.get(literal));
  for (const literal of literals) map.set(literal, 'scalar');
  return () =>
    literals.forEach((literal, i) => {
      const kind = previous[i];
      if (kind === undefined) map.delete(literal);
      else map.set(literal, kind);
    });
}

/**
 * The function literals of the statement list `stmts` that are bound to a
 * local function which the list only ever calls, so that the literal is
 * never handed out as a value.
 *
 * A function literal is compiled with a broadcast wrapper, because a
 * consumer of a function value (`Map`, `Filter`, …) gives it the elements
 * as they are, and an element can be a list. A call of a block-local
 * function does not need that wrapper: the call site broadcasts by itself
 * (`tryCompileLocalFunctionCall`, which calls the function directly only
 * when every argument is a scalar, and through `_SYS.bcastFn` otherwise).
 * So when every mention of the local in the list is the head of a call,
 * the literal is only ever given scalars, and the wrapper costs one extra
 * call and one `Array.isArray` test per call for nothing (CE-338).
 *
 * A literal is accepted when it is the value of a top-level `Assign` or
 * `Declare` of a local of the list that is bound once
 * (`reboundLocalNames`), and the name of that local appears nowhere in
 * the list as a symbol, except as the target of its own `Assign` or
 * `Declare`. Any other mention, such as `Map(L, g)`, `h = g` or a
 * function literal that returns `g`, hands the value out, and the literal
 * keeps the wrapper. A nested scope that binds the same name is counted
 * as a mention too, which can only keep a wrapper that is not needed.
 */
export function callOnlyLocalFunctionLiterals(
  stmts: ReadonlyArray<Expression>,
  locals: ReadonlyArray<string>,
  rebound: ReboundFunctionLocals
): Expression[] {
  const candidates = new Map<string, Expression>();
  for (const stmt of stmts) {
    if (!isFunction(stmt)) continue;
    const assign = stmt.operator === 'Assign';
    if (!(assign || stmt.operator === 'Declare') || !isSymbol(stmt.ops[0]))
      continue;
    const name = stmt.ops[0].symbol;
    const value = assign ? stmt.ops[1] : declareValueOperand(stmt.ops);
    if (
      isFunction(value, 'Function') &&
      locals.includes(name) &&
      !rebound.rebound.has(name)
    )
      candidates.set(name, value);
  }
  if (candidates.size === 0) return [];
  const mentioned = new Set<string>();
  // The value of the last statement is the value of the block. When that
  // statement is the `Assign` or `Declare` of a candidate, the block
  // returns the literal, and the caller can give it a list. So the target
  // of that statement counts as a mention, and the literal keeps the
  // wrapper. A `Nothing` statement is skipped, as `compileBlock` does.
  for (let i = stmts.length - 1; i >= 0; i--) {
    const stmt = stmts[i];
    if (isSymbol(stmt, 'Nothing')) continue;
    if (
      isFunction(stmt) &&
      (stmt.operator === 'Assign' || stmt.operator === 'Declare') &&
      isSymbol(stmt.ops[0])
    )
      mentioned.add(stmt.ops[0].symbol);
    break;
  }
  const walk = (e: Expression, top: boolean): void => {
    if (isSymbol(e)) {
      mentioned.add(e.symbol);
      return;
    }
    if (!isFunction(e)) return;
    // The target of a top-level `Assign` or `Declare` names the local; it
    // does not read its value.
    const skipTarget =
      top && (e.operator === 'Assign' || e.operator === 'Declare');
    e.ops.forEach((op, i) => {
      if (!(skipTarget && i === 0)) walk(op, false);
    });
  };
  for (const stmt of stmts) walk(stmt, true);
  return [...candidates]
    .filter(([name]) => !mentioned.has(name))
    .map(([, literal]) => literal);
}

/**
 * A wrapper around `callee` that calls it directly when none of its
 * `nParams` arguments is an array, and takes the `helper` route otherwise:
 * `(_tv1) => Array.isArray(_tv1) ? _SYS.<helper>(callee, _tv1) : callee(_tv1)`.
 *
 * `helper` selects what the wrapper does with an array argument. `bcastFn`
 * is the user-function form and `bcast` the OPERATOR form; both follow the
 * same element-wise rule, empty position included — an empty operand
 * answers the empty list, as it does in the interpreter (`Sin([])` is
 * `[]`). Both recurse into nested arrays.
 *
 * The wrapper takes a FIXED number of parameters wherever the function has
 * one, read from the function literal, rather than a rest argument: a
 * consumer that hands the value straight to `Array.prototype.map` would
 * supply the index and the source array as extra arguments, and a rest form
 * would see that array and broadcast over it. `nParams` is `'rest'` for the
 * one function that has no single parameter list — a MULTI-CLAUSE
 * dispatcher, which selects its clause on the number of arguments, so a
 * fixed arity would answer `no-matching-clause` for every other overload
 * (`multiClauseValueRef`, which also records why the rest form is safe for
 * the consumers this compiler emits).
 *
 * The `Array.isArray` test is done here rather than left to the runtime
 * helper so the scalar case — every element of an ordinary flat list — costs
 * one type test instead of the broadcast's operand-shape analysis.
 */
export function broadcastingWrapper(
  callee: string,
  nParams: number | 'rest',
  target: CompileTarget<Expression>,
  helper: 'bcast' | 'bcastFn'
): string {
  if (nParams === 'rest') {
    const rest = tempVar(target);
    // `Array.isArray` reads only its first argument, so it serves as the
    // `some` predicate unchanged.
    return (
      `(...${rest}) => ${rest}.some(Array.isArray) ? ` +
      `_SYS.${helper}(${callee}, ...${rest}) : ${callee}(...${rest})`
    );
  }
  const params: string[] = [];
  for (let i = 0; i < nParams; i++) params.push(tempVar(target));
  const args = params.join(', ');
  const test = params.map((p) => `Array.isArray(${p})`).join(' || ');
  return (
    `(${args}) => ${test} ? _SYS.${helper}(${callee}, ${args}) : ` +
    `${callee}(${args})`
  );
}

/**
 * A wrapper around `callee` that lifts a plain number into the `{ re, im }`
 * convention at each parameter position `complexParam` marks:
 * `(_tv1) => callee(_SYS.cplx(_tv1))`.
 *
 * `_SYS.cplx` is used rather than a static `{ re: …, im: 0 }` wrap because
 * the value's realness is a property of whatever calls the wrapper, which is
 * unknown here; the helper is idempotent, so an already-complex value passes
 * through instead of nesting.
 *
 * Shared by the two places a function whose body computes in the complex
 * lane is handed to a consumer that supplies RAW elements — a named function
 * referenced as a value (`ensureUserFunctionValueRef`, which binds the
 * wrapper under its own `$v` name) and a function LITERAL spliced in value
 * position, which has no name to bind and takes the wrapper inline. Both
 * therefore coerce at the same positions and in the same way.
 *
 * An absent argument (`undefined`) is read as `NaN` before the lift, as the
 * interpreter reads an absent value at a numeric parameter (`makeLambda`,
 * `function-utils.ts`). A real-lane parameter of a function literal gets
 * this from its `= NaN` default value; a complex-lane parameter has no
 * default, and `_SYS.cplx(undefined)` is `undefined`, so without the test
 * the body read `.re` off `undefined` and threw.
 */
export function complexCoercingWrapper(
  callee: string,
  complexParam: ReadonlyArray<boolean>,
  target: CompileTarget<Expression>
): string {
  const params = complexParam.map(() => tempVar(target));
  const args = params.map((p, i) =>
    complexParam[i] ? `_SYS.cplx(${p} === undefined ? NaN : ${p})` : p
  );
  return `(${params.join(', ')}) => ${callee}(${args.join(', ')})`;
}

/**
 * May the emitted JavaScript definition of user function `h` be wrapped in
 * a LAST-CALL MEMO — a closure that remembers the arguments and the result
 * of its most recent call and answers a repeated call with the same
 * arguments from that record instead of running the body again?
 *
 * The memo exists because common-subexpression elimination never crosses a
 * definition boundary: each call of an emitted definition is a fresh
 * evaluation of its body. On the Voronoi row of Desmos state 62urmx2dcm,
 * `m(x, y)` is called twice per sample with the same `(x, y)` — once from
 * inside `m2` and once from the row — so its nine-distance block ran twice
 * per sample. The memo costs a type test and a comparison per argument on
 * every call (measured at 5 to 7 ns per call on `f(x) := 2x + 1`,
 * 2026-09-09) and no code growth, whichever way the artifact is spliced.
 *
 * A memo answer is only the answer the body would have computed when:
 *
 *  - running the body has no observable effect other than its value — the
 *    skippability oracle (`isEmissionSkippable`), which refuses a draw
 *    (`Random()`), a write, a caller-supplied implementation nothing
 *    vouches for, and a symbol spliced from string-valued `vars` — and
 *    none through an assigned symbol value either (`foldValueImpure`):
 *    the oracle stops at a symbol, while the emission folds the symbol's
 *    value into the body, so `f(x) := x + r` with `r := Random()` draws
 *    inline and a memo would answer the second call with the first draw;
 *  - every parameter is scalar (`userFunctionParamsAreScalar`), so every
 *    call site is broadcast-aware and the body only ever sees one element
 *    at a time. A collection-typed parameter binds its argument whole, and
 *    an array compares by identity and may be rebuilt by the runtime
 *    helpers, so such a definition would gain nothing from a memo. (The
 *    wrapper itself still bypasses the memo at run time for any argument
 *    that is not a plain number — a broadcast element that is an array, a
 *    point, a `{re, im}` record — with one `typeof` test per argument.)
 *  - the body is compiled in the real lane: a complex-shaped body returns
 *    a `{re, im}` object, which the wrapper never records (an object may
 *    be mutated by its consumer), so the memo would be dead weight;
 *  - the definition takes at least one parameter (a nullary pure body is
 *    a constant, which the fold already handles).
 *
 * Whether the memo is worth emitting — whether the artifact references
 * the definition from two or more places, and whether the body reads a
 * per-call binding that could change between two calls with the same
 * arguments — is decided when the preamble is assembled, on the JavaScript
 * target (`memoizeSharedDefinitions`). This predicate answers only the
 * properties of the definition itself.
 */
export function lastCallMemoEligible(
  h: string,
  bodyExpr: Expression,
  params: ReadonlyArray<string>,
  bodyTarget: CompileTarget<Expression>,
  complexShaped: boolean
): boolean {
  if (bodyTarget.language !== 'javascript') return false;
  if (params.length === 0 || complexShaped) return false;
  const engine = bodyExpr.engine as unknown as ComputeEngine;
  if (!userFunctionParamsAreScalar(engine, h)) return false;
  if (foldValueImpure(bodyExpr)) return false;
  return isEmissionSkippable([bodyExpr], params, bodyTarget);
}

/**
 * The DECLARED types of a function literal's annotated parameters, by
 * name. An unannotated or unparseable parameter contributes nothing (it
 * then reads as undeclared, the safe direction). Shared by the emitted
 * definition compile (`prepareUserFunctionBody`) and the reference
 * analysis, so the two agree on what a raw body symbol's static type is.
 */
export function literalDeclaredParamTypes(
  literal: Expression & FunctionInterface
): Record<string, Type> {
  const out: Record<string, Type> = {};
  for (const p of literal.ops.slice(1)) {
    if (!isFunction(p, 'Typed') || !isSymbol(p.ops[0])) continue;
    const t = declaredParamType(p);
    if (t !== undefined) out[p.ops[0].symbol] = t;
  }
  return out;
}

/**
 * The DECLARED type carried by the function-literal parameter operand `p`
 * (`Typed(x, "complex")` — the E1 annotation spelling), or `undefined` when
 * `p` carries no annotation or the annotation does not parse. An
 * unannotated or unparseable parameter therefore reads as undeclared, the
 * safe direction.
 *
 * Positional, so the callers that need the parameters BY POSITION — the
 * value-position coercion of an inline literal — and the one that needs
 * them by name agree on what a parameter is declared as.
 */
export function declaredParamType(p: Expression): Type | undefined {
  if (!isFunction(p, 'Typed') || !isSymbol(p.ops[0])) return undefined;
  const src = p.ops[1];
  const text = isString(src)
    ? src.string
    : isSymbol(src)
      ? src.symbol
      : undefined;
  if (text === undefined) return undefined;
  try {
    return parseType(text, p.engine._typeResolver);
  } catch {
    // Unparseable annotation: read as undeclared.
    return undefined;
  }
}

/**
 * The JavaScript guard testing that `a` satisfies parameter type `t`:
 * a source string, `null` when no test is needed (the parameter admits
 * anything), or `undefined` when the type has **no faithful JS test** —
 * the §8 whole-function decline. Guard kinds mirror the runtime admission
 * (`typeAcceptsValue`/`admissionOf`) on the target's value model:
 * value types → `===` (faithful for the FINITE machine numbers, strings
 * and booleans compiled code traffics in); numeric ranges → base guard
 * plus inclusive bound checks (a NaN argument fails `>=`, as it should);
 * primitives → `typeof`/`Number.isInteger`/`Number.isFinite` where JS can
 * express them. Every bare numeric name denotes a FINITE value, so its
 * guard rejects `Infinity` and `NaN` at run time. This is the test of the
 * DISPATCH of a multi-clause function, where the interpreter also refuses
 * `NaN` at a numeric parameter: no clause is the correct one for it (user
 * decision 2026-10-17, which amends the ruling "A user function accepts
 * `NaN` at a numeric parameter — RULED 2026-09-30" in
 * `docs/ERROR-MODEL.md`). The parameter check of a function with ONE
 * clause accepts `NaN` (`jsParameterGuard`). The `+oo | -oo`, `infinity`
 * and `nan` primitives, and the NON-FINITE numeric value types `NaN`,
 * `oo` and `-oo`, have no faithful JS test and therefore decline; see the
 * comment on those cases below.
 * The JS calling convention represents a complex value as a `{re, im}`
 * object and a real one as a plain number, and BOTH inhabit `complex` (and
 * `number`): those two guards accept either shape, so a complex-valued
 * clause set dispatches as the interpreter does.
 */
/**
 * The JavaScript test of a call argument `a` against the declared type `t`
 * of a parameter: the test of `jsClauseParamGuard`, or, for a type it has
 * no test for, the SHAPE test of `jsCollectionShapeGuard`. `null` when no
 * test is needed, `undefined` when the type has no test.
 *
 * The shape test is used for parameter checks only, not for the dispatch
 * of a multi-clause function: there a test that does not tell a tuple
 * from a list would select a clause that the interpreter does not select.
 *
 * At a parameter whose type is numeric (a subtype of `number`: `real`,
 * `integer`, `real<0..>`, …) the test also accepts `NaN`. A user function
 * with one clause accepts `NaN` at every parameter typed with a numeric
 * type, and its body runs with `NaN`: `f := x ↦ 7` declared
 * `(real) -> number` gives `f(NaN) = 7`. `NaN` is what a numeric
 * computation gives when it has no value, so `f(n: integer)` must not
 * refuse an argument that `f(n: number)` accepts. `Indeterminate` is
 * accepted in the same way, and compiled code holds it as `NaN` too. A
 * number that is not `NaN` is still tested (`1.5` at `integer` is
 * refused). The ruling is "A user function accepts `NaN` at a numeric
 * parameter — RULED 2026-09-30" in `docs/ERROR-MODEL.md`, and the
 * interpreter applies it in `acceptNaNAtNumericParams`
 * (`function-utils.ts`) and `declaredScalarConformance`
 * (`boxed-expression/boxed-function.ts`). The dispatch of a multi-clause
 * function keeps refusing `NaN` (`jsClauseParamGuard`).
 */
export function jsParameterGuard(
  t: Type,
  a: string
): string | null | undefined {
  const test = jsClauseParamGuard(t, a);
  if (typeof test === 'string' && isSubtype(t, 'number'))
    return `(Number.isNaN(${a}) || ${test})`;
  return test !== undefined ? test : jsCollectionShapeGuard(t, a);
}

/**
 * The JavaScript test that the argument `a` has the shape of the
 * collection type `t`, for a parameter check (`jsParameterGuard`): an
 * array (or a typed array) for a `list` with no dimensions, an array of
 * the right length for a `tuple` and for a `list` with one known
 * dimension. `undefined` for any other type.
 *
 * The interpreter checks an argument against such a parameter at each
 * application, and gives an `incompatible-type` error for a number at a
 * `list<number>` parameter or for a tuple of three numbers at a
 * `tuple<number, number>` parameter. It does not check the elements
 * (`[1.5, 2]` at a `list<integer>` parameter is accepted, measured
 * 2026-10-24), so the test does not read them. A JavaScript array stands
 * for a list and for a tuple alike, so the test cannot refuse a tuple at
 * a list parameter. CE-226.2.
 */
export function jsCollectionShapeGuard(t: Type, a: string): string | undefined {
  const r = resolveTypeAlias(t);
  if (typeof r !== 'object') return undefined;
  if (r.kind === 'tuple')
    return `(Array.isArray(${a}) && ${a}.length === ${r.elements.length})`;
  if (r.kind !== 'list') return undefined;
  const dims = r.dimensions;
  if (dims === undefined)
    return `(Array.isArray(${a}) || ArrayBuffer.isView(${a}))`;
  if (Array.isArray(dims) && dims.length === 1 && dims[0] > 0)
    return (
      `((Array.isArray(${a}) || ArrayBuffer.isView(${a})) && ` +
      `${a}.length === ${dims[0]})`
    );
  return undefined;
}

export function jsClauseParamGuard(
  t: Type,
  a: string
): string | null | undefined {
  if (typeof t === 'string') {
    switch (t) {
      case 'unknown':
      case 'any':
        return null;
      case 'integer':
        return `Number.isInteger(${a})`;
      // `real` denotes the FINITE reals since the finite-by-default flip,
      // so `Number.isFinite` is the exact guard for it. It already implies
      // `typeof … === "number"`.
      case 'real':
        return `Number.isFinite(${a})`;
      // `complex` is finite too, so an infinite or NaN argument — a plain
      // `Infinity`, or a `{re, im}` object with a non-finite component —
      // must not satisfy it. Every complex value the JS target emits
      // carries both parts, so both are tested.
      case 'complex':
        return `(Number.isFinite(${a}) || (${jsComplexObjectTest(a)} && Number.isFinite(${a}.re) && Number.isFinite(${a}.im)))`;
      // `+oo | -oo` (the SIGNED pair `+∞ | −∞`), `infinity` and
      // `nan` have NO faithful JS test, so a clause set that uses any of
      // the three declines as a whole and runs interpreted.
      //
      // The reason is a representation collision. Compiled JavaScript has
      // no value for the unsigned pole `~oo`, so it lowers `~oo` to the
      // IEEE `Infinity`, which keeps the magnitude and drops the direction
      // it cannot express. That holds on every route — an embedded `~oo`
      // literal, a constant-folded pole (`Gamma(-2)`), a pole computed at
      // run time (`Gamma(x)` at `x = -2`, `1 / x` at `x = 0`), and a `~oo`
      // handed in as an ARGUMENT, which the entry check projects to
      // `Infinity` (`isUnsignedPole` in javascript-target.ts).
      //
      // The collision that no guard can undo is the one float ARITHMETIC
      // creates downstream of that lowering: compiled `1 / x - 1 / x` at
      // `x = 0` is `Infinity - Infinity`, that is NaN, where the
      // interpreter's answer for the same expression is `~oo`. So a pole
      // can change its non-finite CLASS between the two engines before any
      // guard sees it, and the guard is then asked about two different
      // values.
      //
      // The interpreter meanwhile types `~oo` as `infinity`, which is
      // disjoint there from both `nan` and `+oo | -oo`. So none of
      // the three tiers has a JS test that agrees with the interpreter:
      //
      //  - "a number that is neither finite nor NaN" — the only candidate
      //    test for `+oo | -oo` — accepts a `~oo` that compiled
      //    code produced, because that value is the JS `Infinity`, while
      //    the SIGNED pair excludes `~oo`. Measured on the clause set
      //    `g(a: +oo | -oo) = 1; g(x: number) = 0`: with such a
      //    guard in place, compiled `g(1 / w)` at `w = 0` answered 1 where
      //    the interpreter answers 0, since the interpreter's `1 / 0` is
      //    `~oo`, which is not below `+oo | -oo`.
      //  - `Number.isNaN(a)` accepts the NaN that compiled arithmetic over
      //    a produced `~oo` yields. Measured on
      //    `g(a: nan) = 1; g(x: number) = 0`: compiled `g(1 / w - 1 / w)`
      //    at `w = 0` answered 1 where the interpreter answers 0, the
      //    interpreter's `~oo - ~oo` being `~oo` rather than NaN.
      //  - "a number that is neither finite nor NaN" is also the only
      //    candidate test for `infinity`, and it FAILS on the same
      //    expression from the other side. Measured on
      //    `g(a: infinity) = 1; g(x: number) = 0`: compiled
      //    `g(1 / w - 1 / w)` at `w = 0` answered 0 where the interpreter
      //    answers 1, because `~oo` IS an `infinity` there while the
      //    compiled NaN is not. Every OTHER route agrees for this tier —
      //    a produced `~oo`, a produced `-(1 / w)`, a folded `Gamma(-2)`,
      //    an embedded `~oo` literal, a projected `~oo` argument, and a
      //    boundary `Infinity`/`-Infinity`/`NaN`/finite argument — so the
      //    degradation route is the single row that keeps this tier
      //    declined.
      //
      // Every direction above was measured on the clause set
      // `g(a: T) = 1; g(x: number) = 0`. The guard decides whatever value
      // reaches the parameter — an argument that crossed the
      // interpreter→JS boundary and a value the compiled body itself
      // produced alike — so a disagreement on EITHER route is enough to
      // make the decline necessary.
      //
      // Declining rather than diverging is the compilation model's posture
      // for a construct the target cannot represent (D6 fail-closed, and the
      // §8 whole-function decline this return value expresses): the
      // interpreted fallback still dispatches such a clause set correctly.
      case 'infinity':
      case 'nan':
        return undefined;
      case 'number':
        return `(typeof ${a} === "number" || ${jsComplexObjectTest(a)})`;
      case 'string':
        return `typeof ${a} === "string"`;
      case 'boolean':
        return `typeof ${a} === "boolean"`;
      default:
        return undefined;
    }
  }
  switch (t.kind) {
    case 'value': {
      const v = t.value;
      if (typeof v === 'number') {
        // A NON-FINITE numeric value type — `NaN`, `oo` or `-oo` — declines
        // the whole function, for the same representation collision that
        // makes the `nan`, `infinity` and `+oo | -oo` PRIMITIVES
        // decline just above: compiled JavaScript lowers the interpreter's
        // unsigned pole `~oo` to the IEEE `Infinity`, so a guard over JS
        // numbers cannot tell a `~oo` from a signed infinity, nor from the
        // NaN that arithmetic over a produced `~oo` yields. Measured on
        // the clause set `g(a: oo) = 1; g(b: -oo) = 2; g(c: NaN) = 3;
        // g(x: number) = 0`, with the guards emitted, all three value
        // clauses answered where the interpreter sends the call to the
        // `number` clause instead: compiled `g(1 / w)` at `w = 0` answered
        // 1, `g(-(1 / w))` answered 2, and `g(1 / w - 1 / w)` answered 3,
        // while the interpreter answers 0 for each, its `1 / 0` being `~oo`
        // and `~oo` inhabiting none of the three value types.
        if (!Number.isFinite(v)) return undefined;
        return `${a} === ${String(v)}`;
      }
      if (typeof v === 'string') return `${a} === ${JSON.stringify(v)}`;
      if (typeof v === 'boolean') return `${a} === ${v}`;
      return undefined;
    }
    case 'numeric': {
      let base: string;
      if (t.type === 'integer') base = `Number.isInteger(${a})`;
      else if (t.type === 'real')
        // Finite: an inclusive bound on one side only (`real<0..>`) would
        // otherwise admit `Infinity`, which the type does not contain.
        base = `Number.isFinite(${a})`;
      else return undefined; // rational &c.: no faithful JS test
      // A bound the type excludes (`real<0<..>`, x > 0) is a strict test.
      const parts = [base];
      if (typeof t.lower === 'number' && t.lower !== -Infinity)
        parts.push(
          `${a} ${t.lowerOpen === true ? '>' : '>='} ${String(t.lower)}`
        );
      if (typeof t.upper === 'number' && t.upper !== Infinity)
        parts.push(
          `${a} ${t.upperOpen === true ? '<' : '<='} ${String(t.upper)}`
        );
      return `(${parts.join(' && ')})`;
    }
    case 'union': {
      const parts: string[] = [];
      for (const branch of t.types) {
        const g = jsClauseParamGuard(branch, a);
        if (g === undefined) return undefined;
        if (g === null) return null; // a branch admits everything
        parts.push(g);
      }
      return `(${parts.join(' || ')})`;
    }
    default:
      return undefined;
  }
}
