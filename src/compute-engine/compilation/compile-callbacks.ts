// Callback literals: combiners, derivative literals, value references and
// wrappers.

import type {
  Expression,
  FunctionInterface,
  IComputeEngine as ComputeEngine,
} from '../global-types.js';
import type { MathJsonExpression } from '../../math-json/types.js';
import { INDEXED_COLLECTION_SHAPE_TYPE } from '../../common/type/primitive.js';
import {
  isDeclaredScalarType,
  paramsAreScalar,
} from '../boxed-expression/boxed-function.js';
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
  resolveTypeForCompiledLanes as resolveTypeForCompilation,
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
  isNumber,
} from '../boxed-expression/type-guards.js';
import {
  functionLiteralDeclaredSignature,
  functionLiteralParameterName,
  functionLiteralParameterType,
  functionLiteralReturnMarker,
  functionLiteralReturnType,
  optionalParameterDefault,
  optionalParameterTarget,
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
  collectionAtExpressionParameter,
  expressionParameterDecline,
  expressionParameterReadAt,
  isNominalAtomicArg,
  paramElementTypeIsOpen,
  admitsAbsentAtMappedLevel,
  provablyScalarOrFramedScalar,
  pythonMapCall,
  signatureParamsLowerToScalars,
  userFunctionParamType,
} from './compile-user-calls.js';
import {
  groundSignature,
  signatureParamType,
  userFunctionLiteral,
  userFunctionParamsAreScalar,
} from './compile-assignment-checks.js';
import { isPolymorphicType } from '../../common/type/instantiate.js';
import { strictLanes, typeHasComplexLeaf } from './compiler-mode.js';
import { compileValueOperand } from './compile-statements.js';
import {
  defaultFillingWrapper,
  literalDefaultFills,
  literalHasParameterDefaults,
  literalTakesArgumentCount,
} from './compile-parameter-defaults.js';
import { blockLocalOf, userFunctionSignature } from './compile-absence.js';
import { isIndexReadTuple } from '../boxed-expression/index-read-tuple.js';
import type {
  DeclineNote,
  ReboundFunctionLocals,
  UserFunctionRegistry,
} from './compiler-types.js';
import { foldValueImpure, parametersCanBeTyped } from './compile-folding.js';
import { tempVar } from './compiler-naming.js';
import { isEmissionSkippable } from './compile-cse.js';
import { jsComplexObjectTest } from './compiler-type-facts.js';
import {
  bindsOnePointAsUndeclared,
  isScalarShaped,
  isNominalWithUnsettledRank,
  isUndeclaredParameterType,
  mapRankOfType,
  pointOfType,
  pointsBelowLists,
} from './static-shape.js';
import {
  CompileDeclineError,
  LaneMismatchError,
  localLaneMismatch,
  UNSETTLED_SHAPE_CODE,
} from './diagnostics.js';

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
 * Are the scalars that a call with scalar parameters reaches in the
 * collection `a` complex? The call maps over every list level of its
 * argument (`_SYS.mapFn`), so for `list<list<complex>>` it hands the body
 * one complex number per call, although the elements of the outer list are
 * lists. `type` is the static type of `a` at the call site
 * (`staticTypeOf()`), which can be more precise than the type of `a`.
 * The element type is read at each depth of nesting until it is a number
 * type: a non-real number type (`complex`) answers `true`, and a real one
 * answers `false`. Failing that, the identifiable elements of a collection
 * of numbers answer (`hasUniformComplexScalarElements`, e.g. the literal
 * `[w, 2w]`). A type with no known element type answers `false`. The depth
 * is bounded, so a type alias that refers to itself cannot make the walk
 * loop.
 */
function hasComplexBroadcastLeaves(a: Expression, type: Type): boolean {
  if (hasUniformComplexScalarElements(a)) return true;
  let t: Type | undefined = collectionElementType(
    resolveTypeForCompilation(type)
  );
  if (t === 'any' || t === 'unknown') return false;
  for (let depth = 0; depth < 32 && t !== undefined; depth++) {
    if (isNonRealNumber(t)) return true;
    if (isSubtype(t, 'number')) return false;
    t = collectionElementType(t);
    if (t === 'any' || t === 'unknown') return false;
  }
  return false;
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
 * value route (`ensureUserFunctionValueRef`, whose static map over list
 * elements wraps the shim, so an element of a collection is checked after
 * the descent to it).
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
 * SCALAR, or, to scalar parameters that the call maps over, a collection
 * whose scalar leaves, at any depth of nesting, are all complex
 * (`hasComplexBroadcastLeaves`: the static map hands the body one complex
 * leaf per call) — and the parameter is NOT
 * declared a non-real number type. An argument that is neither provably a
 * scalar nor a uniformly-complex collection is not a mismatch (a mixed list
 * has no one shape; its elements are handled per element).
 *
 * At a parameter whose type admits no number (a point or a list, often
 * only inferred from the body: `(p) => p[1] + 1` gives `p: tuple<number>`),
 * or that has no type, the test is `pointLaneMismatch()`: a complex value
 * of the argument at a position that the parameter type reads as real is
 * a mismatch. With `P: list<tuple<complex, real>>`, the call `h(P[1])`
 * added `1` to a `{re, im}` object and gave the string "[object
 * Object]1". The block-local route applies the same test
 * (`localLaneMismatchAt()` in `compile-user-functions.ts`).
 *
 * When `inlined` is true, the position-by-position test is not applied.
 * The caller sets it when the call is compiled with the body of `h` at the
 * call site, or else declines: a call with a point argument that has a
 * complex coordinate (`complexCoordinateArgumentAt()`), written out or
 * not. The inlined body reads each coordinate of the point in its own
 * lane, so a complex coordinate at a position typed `number` or `real`
 * gives the value of the interpreter: `a((x, i·x))` with
 * `a: (tuple<real, number>) -> unknown`, or `h(P)` with
 * `P: tuple<complex, real>` and `h = (p) ↦ p[1] + 1`.
 */
export function laneMismatchAt(
  engine: ComputeEngine,
  h: string,
  literal: Expression & FunctionInterface,
  args: ReadonlyArray<Expression>,
  target: CompileTarget<Expression>,
  inlined = false
): number {
  return complexShapedArgumentMismatchAt(
    args,
    target,
    literal.ops.length - 1,
    userFunctionParamsAreScalar(engine, h),
    (i) => {
      const pt = userFunctionParamType(engine, h, i);
      return pt !== undefined && isNonRealNumber(pt);
    },
    inlined
      ? undefined
      : (i, a) => pointLaneMismatch(a, userFunctionParamType(engine, h, i))
  );
}

/**
 * The first argument position at which an `Apply` of the function literal
 * `literal` to `args` is a strict-mode lane mismatch, or `-1`. This is the
 * rule of `laneMismatchAt` for a literal that is applied in place:
 * `complexParam[i]` tells whether the lowering of the literal puts
 * parameter `i` in the complex lane. When it does not, the body of the
 * literal is compiled in the real lane, and a complex-shaped argument
 * (a `{ re, im }` object) would reach a body that reads it as a number:
 * `Apply(x ↦ 2x, √y)` with `y = -4` would give `NaN`, where the
 * interpreter gives `4i`.
 *
 * An argument that is a collection is complex-shaped only
 * when every parameter of the literal is a scalar (the emitted call then
 * maps over the collection, at every depth of nesting, and hands the body
 * one scalar at a time) and every such scalar is complex.
 *
 * `paramType[i]` is the declared type of parameter `i` (its annotation, or
 * else the declared signature of the literal), or `undefined` when it has
 * none. A parameter declared with a type that is not a scalar number type
 * gets the position-by-position test of `pointLaneMismatch()`, as for a
 * named function: with `P: tuple<complex, real>`, the literal
 * `(p: tuple<number, real>) ↦ p[1] + 1` reads `p[1]` in the real lane, and
 * `Apply` of it to `P` gave the string "[object Object]1", where the
 * interpreter gives `2 + i`. A parameter declared
 * `tuple<complex, real>` takes the same `P` with no mismatch.
 */
export function appliedLiteralLaneMismatchAt(
  literal: Expression & FunctionInterface,
  args: ReadonlyArray<Expression>,
  complexParam: ReadonlyArray<boolean>,
  paramType: ReadonlyArray<Type | undefined>,
  target: CompileTarget<Expression>
): number {
  return complexShapedArgumentMismatchAt(
    args,
    target,
    literal.ops.length - 1,
    paramsAreScalar(literal.type.type),
    (i) => complexParam[i] === true,
    (i, a) => pointLaneMismatch(a, paramType[i])
  );
}

/**
 * The first position `i` (below `nParams`) at which argument `args[i]` is
 * complex-shaped and parameter `i` is not in the complex lane
 * (`paramIsComplex(i)` is false), or `-1`. An argument is complex-shaped
 * when it is a scalar that can be complex-valued, or, when every parameter
 * is a scalar (`scalarParams`), a collection whose scalar leaves are all
 * complex (`hasComplexBroadcastLeaves`: the static map of the call hands
 * the body one complex leaf per call). Any other argument is not a
 * mismatch: a mixed list has no one shape, and its elements are handled one
 * at a time.
 *
 * A point (`isTuple()`) and a value of a nominal type
 * (`isNominalAtomicArg()`) are passed whole, as the emitted call passes
 * them (`callArgumentMapRank()` is 0 for them), and are not read as a
 * collection that the call maps over. A point is complex-shaped when one
 * of its coordinates can be complex (`pointMayHoldComplex()`): no lane of
 * a parameter holds such a point, since the real lane reads its
 * coordinates as real numbers and the complex lane holds one `{ re, im }`
 * value. With `y: real`, `Apply(t ↦ 2t, (y + i, 1))` is such a case. A
 * parameter that binds a collection whole (`scalarParams` is false) is
 * compiled for the type of its value, and is not checked here.
 *
 * The shape of an argument is read from its static type at the call site
 * (`staticTypeOf()`), the type that selects the form of the emitted call
 * (`callArgumentMapRank()`), and a symbol that a frame records as a scalar
 * is a scalar (`provablyScalarOrFramedScalar()`). The type of the argument
 * alone is not enough: with `g: (real) -> any` assigned
 * `u ↦ Block(w ≔ u + i, w)`, the call `g(y)` has the type `any`, but the
 * variant of `g` for a real argument gives a number, so the call is
 * emitted as a direct call and its `{ re, im }` value reaches the body.
 *
 * The named-function rule (`laneMismatchAt`) and the function-literal
 * rule (`appliedLiteralLaneMismatchAt`) both use this function, so that
 * they decide in the same way.
 *
 * `positionTest`, when given, runs first for each argument: `true` is a
 * mismatch, `false` is no mismatch, and `undefined` leaves the argument
 * to the tests above. Both rules pass the position-by-position test of a
 * parameter that is not a scalar number type (`pointLaneMismatch()`).
 */
function complexShapedArgumentMismatchAt(
  args: ReadonlyArray<Expression>,
  target: CompileTarget<Expression>,
  nParams: number,
  scalarParams: boolean,
  paramIsComplex: (i: number) => boolean,
  positionTest?: (i: number, a: Expression) => boolean | undefined
): number {
  for (let i = 0; i < nParams; i++) {
    const a = args[i];
    if (a === undefined) continue;
    const position = positionTest?.(i, a);
    if (position === true) return i;
    if (position === false) continue;
    const type = core.staticTypeOf(a, target);
    let complex: boolean;
    if (isTuple(a)) {
      if (scalarParams && pointMayHoldComplex(a, type)) return i;
      continue;
    }
    if (isNominalAtomicArg(a)) complex = false;
    else if (provablyScalarOrFramedScalar(a) || isScalarShaped(type))
      complex = core.isComplexValued(a);
    else if (scalarParams) complex = hasComplexBroadcastLeaves(a, type);
    else complex = false;
    if (complex && !paramIsComplex(i)) return i;
  }
  return -1;
}

/**
 * Can a coordinate of the point `a` be complex? For a point written out
 * (`Tuple` or `PointList`), each coordinate is read on its own lane
 * (`isComplexValued`). For any other point, a coordinate type that is a
 * non-real number type (`complex`) answers `true`. `type` is the static
 * type of `a` at the call site (`staticTypeOf()`).
 */
function pointMayHoldComplex(a: Expression, type: Type): boolean {
  if (isFunction(a, 'Tuple') || isFunction(a, 'PointList'))
    return a.ops.some((c) => core.isComplexValued(c));
  const t = resolveTypeForCompilation(type);
  if (typeof t !== 'object' || t.kind !== 'tuple') return false;
  return t.elements.some((e) => isNonRealNumber(e.type));
}

/**
 * The description of an element of the collection `coll` for a lane
 * mismatch message: "an element of `L`", with `coll` written in LaTeX.
 */
export function elementOf(coll: Expression): string {
  let source: string;
  try {
    source = coll.latex;
  } catch {
    source = coll.toString();
  }
  return `an element of \`${source}\``;
}

/**
 * Throw the strict-mode `LaneMismatch` decline for a value that has no
 * name the user wrote, such as an element of a collection or the
 * accumulator of a fold. `value` describes it ("an element of `L`"),
 * and `binding` names the parameter that receives it. For a block-local
 * function (`local`), the message is the one of `localLaneMismatch()`.
 */
export function describedLaneMismatch(
  boundary: string,
  binding: string,
  value: string,
  local: boolean
): never {
  if (local) localLaneMismatch(boundary, binding, value);
  throw new LaneMismatchError({
    boundary,
    binding,
    value,
    message:
      `Lane mismatch at ${boundary}: ${value} reaches ${binding}, which ` +
      `this compilation shaped real. Declare it complex, or compile with ` +
      `\`mode: 'complex'\`.`,
  });
}

/**
 * Whether the parameter type `pt` has no type: `unknown` or `any`, the
 * type that an unannotated parameter keeps when no use in the body
 * narrows it. A transparent alias of these types (`type alias U = any`)
 * is read through; a nominal type is not.
 */
function isUntypedParam(pt: Type): boolean {
  const t = resolveTypeAlias(pt);
  return t === 'unknown' || t === 'any';
}

/**
 * Whether the point test of `pointLaneMismatch` applies at a parameter of
 * type `pt`: `'non-scalar'` for a type that admits no number (a point or
 * a list), `'wide'` for a type that admits a number and also a point or a
 * collection (no type, or a union such as `collection<any> | value`),
 * `undefined` otherwise. At a `'wide'` parameter only an argument that
 * is a point or a collection is tested; a scalar argument is left to the
 * scalar test of the caller.
 */
function pointTestKind(
  pt: Type | undefined
): 'non-scalar' | 'wide' | undefined {
  if (pt === undefined) return undefined;
  if (!couldMatch(pt, 'number')) return 'non-scalar';
  if (isUntypedParam(pt)) return 'wide';
  const r = resolveTypeAlias(pt);
  if (
    typeof r === 'object' &&
    r.kind === 'union' &&
    r.types.some((m) => !couldMatch(m, 'number'))
  )
    return 'wide';
  return undefined;
}

/**
 * The lane test of the argument `a` at a parameter of type `pt` that is
 * not a scalar number type: `true` for a mismatch, `false` for no
 * mismatch, `undefined` when the caller must apply its scalar test.
 *
 * - A parameter type that admits no number (a point or a list: `(p) =>
 *   p[1] + 1` gives `p: tuple<number>`) is compared with the argument
 *   position by position (`complexReachesRealPosition`). The emitted body
 *   reads a coordinate of such a parameter in the lane of its type at that
 *   position, so a complex value at a position typed `number` or `real`
 *   is a mismatch: with `P: list<tuple<complex, real>>`, the call
 *   `h(P[1])` added `1` to a `{re, im}` object and gave the string
 *   "[object Object]1".
 * - A parameter with no type (`unknown`), or with a union type that
 *   admits a number and a collection, is a mismatch when the argument is a
 *   point or a collection that holds a complex number. The body is
 *   compiled for a real value: `g = (p) => 2p` with `g(P[1])` gave
 *   `[null, 4]`. For any other argument the caller applies its scalar
 *   test, which also handles a complex scalar at such a parameter.
 */
export function pointLaneMismatch(
  a: Expression,
  pt: Type | undefined
): boolean | undefined {
  const kind = pointTestKind(pt);
  if (pt === undefined || kind === undefined) return undefined;
  const nonScalar = kind === 'non-scalar';
  if (complexReachesRealPosition(a, a.type.type, pt)) return true;
  return nonScalar ? false : undefined;
}

/**
 * The lane test of the elements of the collection `source`, each given to
 * a callback parameter of type `pt`, as `pointLaneMismatch` makes it for
 * one argument. The elements of a written list are tested one by one; the
 * elements of any other collection are tested by its element type.
 */
export function elementLaneMismatch(
  source: Expression,
  pt: Type | undefined
): boolean | undefined {
  const kind = pointTestKind(pt);
  if (pt === undefined || kind === undefined) return undefined;
  const nonScalar = kind === 'non-scalar';
  let found: boolean;
  if (isFunction(source, 'List'))
    found = source.ops.some((e) =>
      complexReachesRealPosition(e, e.type.type, pt)
    );
  else {
    const elt = collectionElementTypeOf(source);
    found = elt !== undefined && complexReachesRealPosition(undefined, elt, pt);
  }
  if (found) return true;
  return nonScalar ? false : undefined;
}

/**
 * Whether a complex value of the argument reaches a position of the
 * parameter type `pt` that the emitted body reads as a real number. The
 * argument is the expression `a` when it is known, and its type `at`.
 * `top` is set when `pt` is the type of the parameter itself, and not the
 * type of a position inside it.
 *
 * The two types are compared position by position: a tuple component with
 * the component at the same index, the element of a collection with the
 * element (or each component) on the other side. A position of `pt` that
 * is a number type with no non-real number type (`number`, `real`) is
 * read as real, and it is a mismatch when the argument at that position
 * can be complex: its type holds a non-real number type, or the compiler
 * reads the written expression there as complex-valued (`Typed(z,
 * 'number')` with `z` complex). A position with no type (`any` or
 * `unknown`, at the top level or inside a type such as
 * `indexed_collection<any>`) is read as real too: this simple test does
 * not look at what the body does with the value. So `len = (L) =>
 * Length(L)` (`L: collection`, with `any` elements) is a mismatch for a
 * point with complex coordinates, although `Length` reads no coordinate:
 * `mode: 'auto'` then compiles it in `mode: 'complex'` with the same
 * value, and `mode: 'strict'` declines. A position with another type
 * (`string`) is never a mismatch. At the top level, a parameter type that
 * admits a number (see `pointTestKind`) is tested only for an argument
 * that is a point or a collection.
 */
function complexReachesRealPosition(
  a: Expression | undefined,
  at: Type,
  pt: Type,
  depth = 0,
  top = true
): boolean {
  // An alias that refers to itself can make the walk endless. Past this
  // depth the comparison stops. It then reports a mismatch when the
  // argument can hold a complex value at all, which is the safe answer:
  // the compilation then declines in `mode: 'strict'`.
  if (depth > 8)
    return (
      typeHasComplexLeaf(at) ||
      (a !== undefined &&
        (core.elementComplexness(a)?.some((c) => c) === true ||
          core.isComplexValued(a)))
    );
  const p = resolveTypeAlias(pt);
  // An element read (`P[1]`) has the type `missing | T`: the missing
  // value holds no number, so only `T` is compared.
  const t = resolveTypeAlias(stripMissingFromType(at));
  // A union of argument types: a mismatch when one member is. The written
  // expression `a` stays with each member.
  if (typeof t === 'object' && t.kind === 'union')
    return t.types.some((m) =>
      complexReachesRealPosition(a, m, p, depth + 1, top)
    );
  if (
    top &&
    couldMatch(p, 'number') &&
    !isSubtype(t, INDEXED_COLLECTION_SHAPE_TYPE) &&
    !isTupleType(t)
  )
    return false;
  // A position with no type is read as real.
  if (isUntypedParam(p))
    return (
      typeHasComplexLeaf(t) ||
      (a !== undefined &&
        (core.elementComplexness(a)?.some((c) => c) === true ||
          core.isComplexValued(a)))
    );
  if (isSubtype(p, 'number')) {
    if (isNonRealNumber(p)) return false;
    if (typeHasComplexLeaf(t)) return true;
    return a !== undefined && core.isComplexValued(a);
  }
  // A union of parameter types: compared as whole types.
  if (typeof p === 'object' && p.kind === 'union')
    return (
      (typeHasComplexLeaf(t) ||
        (a !== undefined &&
          core.elementComplexness(a)?.some((c) => c) === true)) &&
      !typeHasComplexLeaf(p)
    );
  // The parameter positions: `at(i)` is the type of position `i`.
  let pAt: ((i: number) => Type | undefined) | undefined;
  if (typeof p === 'object' && p.kind === 'tuple')
    pAt = (i) => p.elements[i]?.type;
  else {
    const elt = collectionElementType(p);
    if (elt !== undefined) pAt = () => elt;
  }
  if (pAt === undefined) return false;
  // The argument positions: the operands of a written tuple or list, the
  // components of a tuple type, or the element type of a collection.
  if (a !== undefined && (isFunction(a, 'Tuple') || isFunction(a, 'List')))
    return a.ops.some((e, i) => {
      const q = pAt(i);
      return (
        q !== undefined &&
        complexReachesRealPosition(e, e.type.type, q, depth + 1, false)
      );
    });
  if (typeof t === 'object' && t.kind === 'tuple')
    return t.elements.some((e, i) => {
      const q = pAt(i);
      return (
        q !== undefined &&
        complexReachesRealPosition(undefined, e.type, q, depth + 1, false)
      );
    });
  const elt = collectionElementType(t);
  if (elt === undefined) return false;
  // Every position of a tuple parameter receives an element.
  if (typeof p === 'object' && p.kind === 'tuple')
    return p.elements.some((q) =>
      complexReachesRealPosition(undefined, elt, q.type, depth + 1, false)
    );
  return complexReachesRealPosition(undefined, elt, pAt(0)!, depth + 1, false);
}

function isTupleType(t: Type): boolean {
  return typeof t === 'object' && t.kind === 'tuple';
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
        const typed = [
          'Typed',
          functionLiteralParameterName(p)!,
          `'${typeToString(t)}'`,
        ] as MathJsonExpression;
        // A parameter with a default value keeps its default: a call of
        // the rebuilt literal that leaves the parameter out still reads it.
        const d = optionalParameterDefault(p);
        return d === undefined
          ? typed
          : (['Optional', typed, d.json] as MathJsonExpression);
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

/**
 * Enter in the shape frame `complex` and `vector` each named parameter of
 * the combiner `literal` after the first two. A fold calls the combiner
 * with two arguments, so such a parameter has a default value, which the
 * compiled literal fills. A name left out of the frame is answered by an
 * enclosing rule, and for a parameter named `i` that rule is the imaginary
 * unit: `Reduce(L, (a, x, i = 1) ↦ a + x·i, 0)` put the fold in the
 * complex lane, where the interpreter gives a real value.
 *
 * The lane of the parameter is complex when its annotation is a non-real
 * number type, or, without an annotation, when its default is
 * complex-valued. The parameter is a scalar (`LOCAL_SCALAR`) when its
 * annotation is a subtype of `number`, or, without an annotation, when its
 * default is a number. Otherwise (a default `[]`, `{}`, a string or a
 * symbol) its shape is not entered.
 */
function frameDefaultedCombinerParams(
  literal: Expression,
  complex: Map<string, boolean>,
  vector: Map<string, number>
): void {
  if (!isFunction(literal, 'Function')) return;
  for (const param of literal.ops.slice(3)) {
    const name = functionLiteralParameterName(param);
    if (!name) continue;
    const t = functionLiteralParameterType(param);
    const d = optionalParameterDefault(param);
    complex.set(
      name,
      t !== undefined
        ? isNonRealNumber(t)
        : d !== undefined && core.isComplexValued(d)
    );
    if (t !== undefined ? isSubtype(t, 'number') : isNumber(d))
      vector.set(name, LOCAL_SCALAR);
  }
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
  // Two parameters, or two required parameters and parameters with a
  // default value, which the compiled literal fills.
  if (
    !isFunction(literal, 'Function') ||
    !literalTakesArgumentCount(literal, 2)
  )
    return undefined;
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
    frameDefaultedCombinerParams(literal, complex, vector);
    accComplex = core.withLocalShapeFrame(
      complex,
      vector,
      () => core.isComplexValued(literal.op1),
      true
    );
  }
  const coerceSeed = accComplex && !seedless && !seedComplex;

  if (isSymbol(op)) {
    // A combiner, block-local or engine-level, whose parameter in a
    // complex lane is not typed as a non-real number is a lane mismatch.
    // The call of the combiner in the eta expansion below finds the same
    // mismatch, but its arguments are the generated parameters of the
    // expansion (`_a`, `_x`), and a message that names them does not help
    // the user. So the test is made here, and the message names the
    // accumulator or the elements of the collection.
    //
    // An element parameter that is not a scalar (a point, read with
    // `v[1]`) is a mismatch too when an element of the collection holds a
    // complex number at any depth and the parameter type holds none
    // (`typeHasComplexLeaf`): the body reads the coordinates of such a
    // parameter as real numbers. No eta expansion is made for it, so no
    // other test sees it.
    //
    // The parameter types of a block-local combiner come from the type of
    // its literal. Those of an engine-level combiner come from its
    // definition (`userFunctionParamType`), as in `laneMismatchAt`.
    //
    // The test needs the target: without it (the shape analysis of
    // `isComplexValued`), a block-local combiner is not known, and the
    // name would resolve to an engine-level function that the local
    // hides.
    const local = target?.localFunctions?.get(op.symbol);
    const isLocal = local !== undefined;
    if (
      target !== undefined &&
      strictLanes() &&
      !target.userFunctions?.lowering
    ) {
      let paramType: (i: number) => Type | undefined;
      if (isLocal) {
        const declaredType = local.type?.type;
        const signature =
          declaredType !== undefined && isPolymorphicType(declaredType)
            ? groundSignature(declaredType)
            : declaredType;
        paramType = (i) => signatureParamType(signature, i);
      } else paramType = (i) => userFunctionParamType(op.engine, op.symbol, i);
      // The name of parameter `i` of the combiner, as `userParamBinding()`
      // writes it (`compile-lanes.ts` imports this file, so it is not
      // called here).
      const binding = (i: number) => {
        const name = functionLiteralParameterName(literal.ops[i + 1]);
        return name
          ? `the parameter \`${name}\` of \`${op.symbol}\``
          : `parameter ${i + 1} of \`${op.symbol}\` (unnamed)`;
      };
      // `value` describes the value, as the generated parameter of the
      // eta expansion has no name that the user wrote.
      const mismatch = (i: number, value: string): never =>
        describedLaneMismatch(
          isLocal
            ? 'block-local function parameter'
            : 'user-function parameter',
          binding(i),
          value,
          isLocal
        );
      const realAt = (i: number) => {
        const pt = paramType(i);
        return pt === undefined || !isNonRealNumber(pt);
      };
      const eltParam = paramType(1);
      const complexPoint = elementLaneMismatch(coll, eltParam) === true;
      if (accComplex && realAt(0))
        mismatch(0, 'the complex accumulator of the fold');
      if ((eltComplex && realAt(1)) || complexPoint)
        mismatch(1, elementOf(coll));
    }
    if (!accComplex && !eltComplex)
      return { op, accComplex, eltComplex, coerceSeed };
    const engine = op.engine;
    const eltType = collectionElementTypeOf(coll);
    const eltTypeText =
      eltType !== undefined && isNonRealNumber(eltType)
        ? typeToString(eltType)
        : 'complex';
    // An element that is not a scalar (a point of a list of points) is
    // passed whole. Its parameter in the expansion is typed with the
    // element type: an untyped parameter is read as a scalar, and the
    // call of the combiner is then wrapped in the run-time broadcast,
    // which maps over the coordinates of the point (a fold of `(a, v) =>
    // a + v[1]` over `[(1 + i, 2), (2, 3)]` in complex mode gave
    // `[null, null]` where the interpreter gives `3 + i`).
    const pointElementType =
      !eltComplex &&
      eltType !== undefined &&
      !isSubtype(eltType, 'number') &&
      isSubtype(eltType, INDEXED_COLLECTION_SHAPE_TYPE)
        ? eltType
        : undefined;
    // The parameters of the eta expansion must not have the name of the
    // combiner: a parameter `_x` would hide a user function `_x`, and the
    // body `_x(_a, _x)` would call the parameter.
    let aName = '_a';
    while (aName === op.symbol) aName = `_${aName}`;
    let xName = '_x';
    while (xName === op.symbol) xName = `_${xName}`;
    const a = engine.symbol(aName);
    const x = engine.symbol(xName);
    const eta = engine.function('Function', [
      engine.function(op.symbol, [a, x]),
      accComplex
        ? engine.function('Typed', [a, engine.box({ str: 'complex' })])
        : a,
      eltComplex
        ? engine.function('Typed', [x, engine.box({ str: eltTypeText })])
        : pointElementType !== undefined
          ? engine.function('Typed', [
              x,
              engine.box({ str: typeToString(pointElementType) }),
            ])
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
  if (
    !isFunction(literal, 'Function') ||
    !literalTakesArgumentCount(literal, 2)
  )
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
  frameDefaultedCombinerParams(literal, complex, vector);
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
 * called — `Map(Q, xs)`, `CountIf`, `Find`, `_SYS.mapFn`.
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
 * The second coercion a raw element needs is the MAP over a list element.
 * A user function whose parameters are all scalar is applied element-wise
 * by the interpreter when an argument is a collection, whether those
 * parameters are DECLARED scalars (`(number) -> number`) or left open (user
 * decision of 2026-09-22); the body itself is emitted for scalars only. The
 * consumer of the value passes whatever element its source holds: for
 * `f(x) := 2x`, `Map(f, [[1, 2], [3, 4]])` handed a whole ROW to a body that
 * multiplies, and answered `[NaN, NaN]` where the interpreter answers
 * `[[2, 4], [6, 8]]`. The consumer records the static types of the values
 * it passes (`withCallbackArgumentTypes`), and they select the value: the
 * function itself over scalar elements, a static map of it over list
 * elements (`const _fn_f$m1 = (_tv1) => _SYS.mapFn(_fn_f, [1], _tv1)`),
 * emitted ONCE next to the function itself, and a decline over elements
 * whose shape is not settled (`callbackArgumentRanks()`). No code tests
 * the shape of an element at run time. A value with no consumer (the root
 * `compile(f)`, an argument of a call) is the scalar variant. A function
 * with a parameter that is NOT scalar binds its arguments whole and keeps
 * the plain reference, because the interpreter does not map it either.
 *
 * The map takes the complex-coercing shim as its callee where both apply,
 * so an element reaches the body coerced, the same order the call route
 * uses.
 *
 * Returns the plain name unchanged when there is nothing to coerce and no
 * argument that is a list.
 */
export function ensureUserFunctionValueRef(
  engine: ComputeEngine,
  h: string,
  target: CompileTarget<Expression>,
  decline?: DeclineNote
): string | undefined {
  // The value of a function with a parameter declared `expression` that
  // the body reads is declined on every target, unless the consumer of the
  // value has checked the arguments it passes (`withCheckedCallback`): the
  // interpreter binds a collection whole to such a parameter and the body
  // maps over it, while the emitted definition reads the parameter as a
  // scalar. With `h := (t: expression) ↦ 2t`, `Map(h, rows)` over
  // `[[1, 2], [3, 4]]` gave `[null, null]` where the interpreter gives
  // `[[2, 4], [6, 8]]`.
  // What the consumer of this value passes to it (`callbackArguments`).
  // The entry covers this value only: the definition of `h`, emitted
  // below, can read `h` as a value again, and that value has no consumer.
  const passed = callbackArgumentsOf(h);
  const marks = checkedFunctionValues.get(h);
  if (marks === undefined) {
    const literal = userFunctionLiteral(engine, h);
    const at =
      literal === undefined
        ? -1
        : expressionParameterReadAt(literal, (i) =>
            userFunctionParamType(engine, h, i)
          );
    if (at >= 0)
      throw expressionParameterDecline(`the function value \`${h}\``, at);
    return withoutCallbackArguments(h, () =>
      userFunctionValueRef(engine, h, target, decline, passed)
    );
  }
  // The mark covers this value only, as the consumer entry does.
  checkedFunctionValues.delete(h);
  try {
    return withoutCallbackArguments(h, () =>
      userFunctionValueRef(engine, h, target, decline, passed)
    );
  } finally {
    checkedFunctionValues.set(h, marks);
  }
}

/** `ensureUserFunctionValueRef` after the check of a parameter declared
 * `expression`.
 *
 * A function with a parameter with a default value (`f := (x, k = 2) => x
 * * k`) is handed out behind one more wrapper, `$d`, that fills each
 * parameter that the consumer leaves out with its default
 * (`defaultFillingWrapper()`): `Map(f, [1, 2])` calls the value with one
 * argument, and the interpreter fills `k` with 2. A call written in the
 * expression needs no wrapper, because canonicalization already wrote the
 * default into it (`f(3)` is `f(3, 2)`). The wrapper is the outermost one,
 * so the checking and complex-coercing wrappers and the static map inside
 * it see every argument, as for a call that supplies them all. */
function userFunctionValueRef(
  engine: ComputeEngine,
  h: string,
  target: CompileTarget<Expression>,
  decline?: DeclineNote,
  passed?: CallbackArguments
): string | undefined {
  const ref = userFunctionValueRefWithoutDefaults(
    engine,
    h,
    target,
    decline,
    passed
  );
  if (ref === undefined) return undefined;
  if (
    target.language !== 'javascript' &&
    target.language !== 'interval-javascript'
  )
    return ref;
  const registry = target.userFunctions;
  const literal = userFunctionLiteral(engine, h);
  if (!registry || literal === undefined) return ref;
  if (!literalHasParameterDefaults(literal)) return ref;
  const signature = userFunctionSignature(engine, h);
  // A symbol default is read where the consumer calls the value, as if the
  // call were written there (`callSiteDefault()`): with `f := (x, k = d) =>
  // x * k`, `(d, xs) => Map(f, xs)` reads its own parameter `d`. Such a
  // wrapper is compiled in the scope of the reference, and is not shared
  // with another reference, which can see another binding of `d`.
  const readsBinding = literal.ops.slice(1).some((p) => {
    const d = optionalParameterDefault(p);
    return isSymbol(d) && d.symbol !== 'True' && d.symbol !== 'False';
  });
  if (readsBinding) {
    const fills = literalDefaultFills(
      literal.ops.slice(1),
      (e) => compileValueOperand(e, target),
      (i) => signatureParamType(signature, i)
    );
    return `(${defaultFillingWrapper(ref, fills, () => tempVar(target))})`;
  }
  const wrapperName = `${ref}$d`;
  if (!registry.defs.has(wrapperName)) {
    const root = registry.root ?? target;
    const fills = literalDefaultFills(
      literal.ops.slice(1),
      (e) => compileValueOperand(e, root),
      (i) => signatureParamType(signature, i)
    );
    registry.defs.set(
      wrapperName,
      `const ${wrapperName} = ${defaultFillingWrapper(ref, fills, () =>
        tempVar(target)
      )};`
    );
  }
  return wrapperName;
}

/** `userFunctionValueRef` without the wrapper that fills the parameters
 * with a default value. `passed` is what the consumer of the value passes
 * to it (`callbackArguments`), `undefined` for a value with no consumer. */
function userFunctionValueRefWithoutDefaults(
  engine: ComputeEngine,
  h: string,
  target: CompileTarget<Expression>,
  decline?: DeclineNote,
  passed?: CallbackArguments
): string | undefined {
  // A parameter declared `expression` that receives a collection takes the
  // variant typed by the values the consumer passes
  // (`expressionParameterVariantRef`).
  const variant = expressionParameterVariantRef(engine, h, target, passed);
  if (variant !== undefined) return variant;
  const name = core.ensureUserFunctionEmitted(engine, h, target, decline);
  if (name === undefined) return undefined;
  if (target.language !== 'javascript') {
    // A target with its own definition lowering (the shader targets)
    // decides what the value means. Elsewhere, a value with scalar
    // parameters fed list values is a static map of it, as on JavaScript.
    if (passed === undefined || target.userFunctions?.lowering) return name;
    if (!userFunctionParamsAreScalar(engine, h)) {
      const at = onePointAtUndeclaredSlot(passed, (i) =>
        userFunctionParamType(engine, h, i)
      );
      if (at >= 0)
        throw new Error(
          `Could not compile the function value \`${h}\`: its consumer ` +
            `passes it one point at parameter ${at + 1}, which the ` +
            `interpreter binds whole, and the target has no definition of ` +
            `the function for one point.`
        );
      return absentGuardedValueRef(engine, h, name, passed);
    }
    // The interpreter binds a point whole at a parameter with no declared
    // type, and this target has no definition compiled for one point.
    if (
      passed.types.some(
        (t) => t !== undefined && pointsBelowLists(t) !== undefined
      )
    )
      throw new Error(
        `Could not compile the function value \`${h}\`: its consumer ` +
          `passes it lists of points, and the target has no definition of ` +
          `the function for one point.`
      );
    const literal = userFunctionLiteral(engine, h);
    const ranks = callbackArgumentRanks(
      h,
      passed,
      literal === undefined ? 0 : literal.ops.length - 1
    );
    const mapped = staticMapCallback(name, ranks, target, passed.types);
    if (mapped === undefined)
      throw new Error(
        `Could not compile the function value \`${h}\`: its consumer ` +
          `passes it list values, and the target has no map of a function ` +
          `over a list.`
      );
    return mapped;
  }
  const registry = target.userFunctions;
  if (!registry) return name;

  const literal = userFunctionLiteral(engine, h);
  // A MULTI-CLAUSE function has no single literal to read a parameter list
  // from, and takes its own wrapper.
  if (literal === undefined)
    return multiClauseValueRef(engine, h, name, target, passed) ?? name;
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
  // annotation. The static map below wraps the shim, so an element of a
  // collection argument is checked after the descent to it.
  callee = checkingShimName(engine, h, callee, target) ?? callee;

  // A parameterless function has no argument that could be a collection.
  if (nParams === 0) return callee;
  if (!userFunctionParamsAreScalar(engine, h)) {
    // One point that the consumer passes is bound whole, and takes the
    // definition compiled for one point (`onePointValueRef()`). A list is
    // bound whole too, and takes the definition for a list.
    const pointRef = onePointValueRef(
      engine,
      h,
      literal,
      name,
      callee,
      target,
      passed
    );
    return absentGuardedValueRef(
      engine,
      h,
      pointRef ??
        listSpecializedValueRef(engine, h, literal, target, passed) ??
        callee,
      passed
    );
  }
  // A parameter that lowers to an array or object (a tuple, a record, a
  // nominal value) must reach the body whole — see
  // `signatureParamsLowerToScalars`.
  if (!signatureParamsLowerToScalars(userFunctionSignature(engine, h)))
    return absentGuardedValueRef(engine, h, callee, passed);

  // A value with no consumer is the scalar variant.
  if (passed === undefined) return callee;
  // The interpreter applies a function with scalar parameters to each
  // element of a list value at a callback position, whether the parameters
  // are declared scalars (`(number) -> number`) or left open (user decision
  // of 2026-09-22). The static types of the values select the variant: the
  // function itself over scalar values, a static map over list values
  // (`const _fn_f$m1 = (_tv1) => _SYS.mapFn(_fn_f, [1], _tv1)`).
  const pointRef = pointListValueRef(
    engine,
    h,
    literal,
    name,
    callee,
    target,
    passed
  );
  if (pointRef !== undefined) return pointRef;
  const ranks = callbackArgumentRanks(h, passed, nParams);
  return mappedValueRef(name, callee, ranks, registry, target, passed.types);
}

/**
 * The function value `ref` of the user function `h`, whose parameters are
 * not all scalars. Throws (the consumer declines) when the consumer passes
 * a value that may be absent at a parameter of `h` with no declared type.
 *
 * The interpreter binds `Missing` to the parameter and runs the body: with
 * `fl := t ↦ Length(t)`, `Map(fl, [(1, 2), Missing])` is `[2, NaN]`. The
 * compiled definition is compiled for a collection, and its body can fail
 * on an absent value (the compiled `Length` of `undefined` throws), so the
 * value is not compiled.
 */
function absentGuardedValueRef(
  engine: ComputeEngine,
  h: string,
  ref: string,
  passed: CallbackArguments | undefined
): string {
  if (passed === undefined) return ref;
  const literal = userFunctionLiteral(engine, h);
  if (literal === undefined) return ref;
  const params = literal.ops.slice(1);
  // A consumer that fills fewer parameters than the function has (a
  // trailing parameter with a default value, `fl := (t, k = 0) ↦
  // Length(t)`): the parameters that receive the values are not known
  // here, so a value that may be absent declines as well.
  if (passed.types.length !== params.length) {
    if (passed.types.some((t) => t !== undefined && isSubtype('missing', t)))
      throw new Error(
        `Could not compile the function value \`${h}\`: its consumer ` +
          `passes it a value that may be absent, and fills ` +
          `${passed.types.length} of its ${params.length} parameters.`
      );
    return ref;
  }
  const absent = passed.types.map((t, i) => {
    if (t === undefined) return false;
    const declared = declaredParamType(params[i]);
    if (declared !== undefined && declared !== 'unknown') return false;
    return isSubtype('missing', t);
  });
  if (!absent.some((a) => a)) return ref;
  throw new Error(
    `Could not compile the function value \`${h}\`: its consumer passes ` +
      `it a value that may be absent, at a parameter with no declared ` +
      `type, and the definition of \`${h}\`, compiled for a collection, ` +
      `may fail on an absent value where the interpreter runs the body ` +
      `with \`Missing\`.`
  );
}

/**
 * The position of the first value that a consumer passes (`passed`) that
 * is one point (not a list of points) at a parameter whose type
 * `paramType(i)` is open (`bindsOnePointAsUndeclared()`), or -1. A
 * parameter with no type counts as open.
 */
function onePointAtUndeclaredSlot(
  passed: CallbackArguments,
  paramType: (i: number) => Type | undefined
): number {
  return passed.types.findIndex(
    (t, i) =>
      t !== undefined &&
      !isScalarShaped(t) &&
      pointOfType(t) !== undefined &&
      bindsOnePointAsUndeclared(paramType(i) ?? 'unknown')
  );
}

/**
 * The value of the user function `h`, emitted as `name` and called through
 * `callee`, whose parameters are not all scalars, for a consumer that
 * passes it one point (not a list of points) at a parameter where the
 * interpreter binds the point whole and the generic definition reads it as
 * a scalar (`bindsOnePointAsUndeclared()`), and a scalar at each other
 * parameter: the definition of `h` with these parameters typed as the
 * points. `undefined` when the consumer passes no such point, or passes a
 * value that is not a scalar or a point.
 *
 * With `gm := p ↦ Max(p) + 1`, the parameter type is inferred as
 * `collection<any> | value`, and the generic definition is
 * `(p) => Math.max(p) + 1`. `Map(gm, P)` with `P = [(1, 2), (3, 4)]` gave
 * `NaN` for each point, where the interpreter gives `[3, 5]`.
 *
 * Throws (the consumer declines) when a point may be absent, when the
 * function is called through a wrapper, or when the definition for one
 * point cannot be emitted. An absent value does not go to the generic
 * definition, as it does for a function with scalar parameters
 * (`absentArgumentFork()`): that definition is compiled for a collection,
 * and can fail on an absent value (`absentGuardedValueRef()`).
 */
function onePointValueRef(
  engine: ComputeEngine,
  h: string,
  literal: Expression & FunctionInterface,
  name: string,
  callee: string,
  target: CompileTarget<Expression>,
  passed: CallbackArguments | undefined
): string | undefined {
  if (passed === undefined) return undefined;
  // A consumer can fill fewer parameters than the function has: the
  // parameters that it does not fill have a default value, and keep their
  // type. The wrapper that fills them (`userFunctionValueRef()`) calls the
  // definition returned here.
  const nParams = literal.ops.length - 1;
  if (passed.types.length > nParams) return undefined;
  const types: (Type | undefined)[] = [];
  let absent = false;
  for (const [i, t] of passed.types.entries()) {
    if (t === undefined) return undefined;
    if (isScalarShaped(t)) {
      types.push(undefined);
      continue;
    }
    const found = pointOfType(t);
    if (found === undefined) return undefined;
    const pt = userFunctionParamType(engine, h, i);
    if (pt !== undefined && !bindsOnePointAsUndeclared(pt)) {
      // A parameter whose type admits the point (`a: tuple<real, real>`,
      // or a tuple that index reads in the body infer) keeps its type: the
      // generic definition is compiled for a point there.
      if (!isSubtype(found.point, pt) && !isIndexReadTuple(pt))
        return undefined;
      types.push(undefined);
      continue;
    }
    absent ||= found.absent;
    types.push(found.point);
  }
  if (types.every((t) => t === undefined)) return undefined;
  while (types.length < nParams) types.push(undefined);
  const fail = (why: string): Error =>
    new Error(
      `Could not compile the function value \`${h}\`: its consumer passes ` +
        `it one point, which the interpreter binds whole, and ${why}`
    );
  if (absent)
    throw fail(
      `the point may be absent, and the definition for one point reads ` +
        `its coordinates.`
    );
  if (callee !== name)
    throw fail(
      `the function is called through a wrapper that the definition for ` +
        `one point does not have.`
    );
  const point = listSpecializedDefinition(engine, h, literal, target, types);
  if (point === undefined)
    throw fail(
      `the definition of the function for one point could not be emitted.`
    );
  return point;
}

/**
 * The value of the user function `h`, emitted as `name` and called through
 * `callee`, for a consumer that passes it values that hold points below a
 * list level (`pointsBelowLists()`): a static map over the list levels
 * above the points, of the definition of `h` compiled for one point.
 * `undefined` when no value holds such points.
 *
 * At a parameter with no declared type, the interpreter maps the function
 * over the list levels of the value and binds each point whole: with
 * `f := t ↦ 7` and `rows = [[(1, 2)], [(3, 4), (5, 6)]]`, `Map(f, rows)` is
 * `[[7], [7, 7]]`. The definition of `f` is compiled for a scalar
 * parameter, so a static map over the coordinates gave
 * `[[[7, 7]], [[7, 7], [7, 7]]]`. The value is
 * `(_tv1) => _SYS.mapFn(_fn_f_point, [1], _tv1)`, where `_fn_f_point` is the
 * definition with the parameter typed as the point.
 *
 * The value declines when the list levels do not lead to one point type,
 * when a parameter that receives points has a declared type, when the
 * consumer does not fill every parameter, when the function is called
 * through a wrapper (a test of a declared type, a complex lane), or when
 * the definition for one point cannot be emitted.
 */
function pointListValueRef(
  engine: ComputeEngine,
  h: string,
  literal: Expression & FunctionInterface,
  name: string,
  callee: string,
  target: CompileTarget<Expression>,
  passed: CallbackArguments
): string | undefined {
  // `pointsBelowLists()` gives `null` for points whose list levels do not
  // lead to one point type (a union of point lists, a matrix of points):
  // that value must reach the decline below, so `absentPointType()` is
  // read only when it gives `undefined` (no points below list levels).
  const found = passed.types.map((t) => {
    if (t === undefined) return undefined;
    const below = pointsBelowLists(t);
    return below !== undefined ? below : absentPointType(t);
  });
  if (found.every((x) => x === undefined)) return undefined;
  const fail = (why: string): Error =>
    new Error(
      `Could not compile the function value \`${h}\`: its consumer passes ` +
        `it lists of points, which the interpreter maps over, binding each ` +
        `point whole, and ${why}`
    );
  const nParams = literal.ops.length - 1;
  if (passed.types.length !== nParams)
    throw fail(`the consumer does not fill every parameter.`);
  const types = found.map((x, i) => {
    if (x === null)
      throw fail(`the list levels do not lead to one point type.`);
    if (x === undefined) return undefined;
    const pt = userFunctionParamType(engine, h, i);
    if (pt !== undefined && !isUndeclaredParameterType(pt))
      throw fail(`parameter ${i + 1} has a declared type.`);
    return x.point;
  });
  if (callee !== name)
    throw fail(
      `the function is called through a wrapper that the definition for ` +
        `one point does not have.`
    );
  const registry = target.userFunctions;
  const point = registry
    ? listSpecializedDefinition(engine, h, literal, target, types)
    : undefined;
  if (point === undefined || !registry)
    throw fail(
      `the definition of the function for one point could not be emitted.`
    );
  const ranks = callbackArgumentRanks(h, passed, nParams).map(
    (r, i) => found[i]?.rank ?? r
  );
  // A value that holds points may also hold an absent value, as a point
  // (`list<tuple<real, real> | missing>`) or as a list level above the
  // points. The interpreter binds `Missing` to the parameter and runs the
  // body: with `f := t ↦ 2t`, `Map(f, [(1, 2), Missing])` is
  // `[(2, 4), NaN]`. The definition for one point reads its coordinates,
  // so an absent argument at a position that receives points goes to the
  // definition compiled for any argument (`absentArgumentFork()`), as a
  // call `f(Missing)` does. `_SYS.mapFn` passes an absent value at any
  // list level to the function as it is, so an absent list level goes
  // there too. A `missing` inside a coordinate
  // (`list<tuple<real | missing, real>>`) does not make the point absent,
  // so it needs no guard: `stripMissingFromType(t, 'keep')` keeps the
  // coordinates and removes only a `missing` at a point or list level.
  const absent = found.map((x, i) => {
    if (x === undefined || x === null) return false;
    const t = passed.types[i]!;
    return typeToString(stripMissingFromType(t, 'keep')) !== typeToString(t);
  });
  let fn = point;
  if (absent.some((a) => a)) {
    // The generic definition receives every argument of the call, so the
    // fork is sound only when no other argument may hold a point: with
    // `f := (a, x) ↦ 2a`, `Reduce([Missing], f, (1, 2))` passes the point
    // `(1, 2)` to `a` and `Missing` to `x`, and the definition for any
    // argument gave `NaN` where the interpreter gives `(2, 4)`.
    if (
      passed.types.some(
        (t, i) => !absent[i] && (t === undefined || !isScalarShaped(t))
      )
    )
      throw fail(
        `a value may be absent beside an argument that is not a scalar, ` +
          `and the definition for any argument would receive that argument.`
      );
    fn = `${point}$a${absent.map((a) => (a ? '1' : '0')).join('')}`;
    if (!registry.defs.has(fn))
      registry.defs.set(
        fn,
        `const ${fn} = ${absentArgumentFork(point, name, absent, target)};`
      );
  }
  return mappedValueRef(fn, fn, ranks, registry, target, passed.types);
}

/**
 * The function value that calls `point`, the definition compiled for one
 * point, with its arguments, or `generic`, the definition compiled for any
 * argument, when one of the arguments at a position where `absent` is true
 * is absent (`undefined` on JavaScript, `None` on Python):
 * `((_p, _g) => (_t) => _t === undefined ? _g(_t) : _p(_t))(point, generic)`.
 * `point` and `generic` are expressions of functions; each is evaluated
 * once.
 *
 * At a parameter with no declared type, the interpreter binds `Missing` to
 * the parameter and runs the body: with `f2 := t ↦ 2t`,
 * `f2([(1, 2), Missing])` is `[(2, 4), NaN]`. The definition for one point
 * reads the coordinates of its argument, so an absent argument goes to the
 * definition for any argument, as the call `f2(Missing)` does.
 *
 * Throws on another target, which has no test of an absent value.
 */
export function absentArgumentFork(
  point: string,
  generic: string,
  absent: ReadonlyArray<boolean>,
  target: CompileTarget<Expression>
): string {
  const p = tempVar(target);
  const g = tempVar(target);
  const params = absent.map(() => tempVar(target));
  const tested = params.filter((_x, i) => absent[i]);
  const list = params.join(', ');
  if (target.language === 'javascript') {
    const test = tested.map((x) => `${x} === undefined`).join(' || ');
    return `((${p}, ${g}) => (${list}) => ${test} ? ${g}(${list}) : ${p}(${list}))(${point}, ${generic})`;
  }
  if (target.language === 'python') {
    const test = tested.map((x) => `${x} is None`).join(' or ');
    return `(lambda ${p}, ${g}: lambda ${list}: ${g}(${list}) if ${test} else ${p}(${list}))(${point}, ${generic})`;
  }
  throw new Error(
    `Could not compile the call: an argument is a point that may be ` +
      `absent, at a parameter with no declared type, and the ` +
      `'${target.language ?? 'unknown'}' target has no test of an absent ` +
      `value.`
  );
}

/**
 * For the type `t` of a value that a consumer passes to a function, or of
 * an argument of a call: when `t` is one point that the canonical form
 * does not type as a point, the point type with rank 0, as
 * `pointsBelowLists()` gives it for a point below list levels, and whether
 * the value may be absent. The point is read through `pointOfType()`,
 * which reads the definitions of aliases and nominal types:
 * `tuple<real, real> | missing`, `mpt`, an alias of that union, or `Row`, a
 * nominal type declared `tuple<real, real>`. `undefined` for any other
 * type, and for a tuple type that `isTupleShapedType()` reads as a point
 * (`tuple<real, real>`, or an alias of it), which takes the route of a
 * point.
 *
 * At a parameter with no declared type, the interpreter binds the point
 * whole. For the absent value, it gives `Missing` at a callback, and it
 * runs the body with `Missing` at a call.
 */
export function absentPointType(
  t: Readonly<Type>
): { rank: number; point: Type; absent: boolean } | undefined {
  const p = pointOfType(t);
  if (p === undefined) return undefined;
  if (
    !p.absent &&
    (typeof t === 'string' || t.kind !== 'reference' || isTupleShapedType(t))
  )
    return undefined;
  return { rank: 0, point: p.point, absent: p.absent };
}

/**
 * The 0-based position of the first argument of the call `h(args)` of a
 * function defined on the engine that is one point named through an alias,
 * a union with `missing` or a nominal type (`absentPointType()`), at a
 * parameter with no declared type, or `-1` when there is none.
 *
 * The interpreter binds such a point whole: with `f2 := t ↦ 2t` and `r`
 * of the nominal type `Row`, declared `tuple<real, real>`, `f2(r)` is
 * `(2, 4)`. The generic definition of `f2` reads the parameter as a
 * scalar, so only the copy of the definition for one point can receive
 * the point.
 */
export function namedPointArgumentAtUntypedParameter(
  engine: ComputeEngine,
  h: string,
  args: ReadonlyArray<Expression>
): number {
  return args.findIndex((a, i) => {
    const declared = userFunctionParamType(engine, h, i);
    if (declared !== undefined && !bindsOnePointAsUndeclared(declared))
      return false;
    return absentPointType(a.type.type) !== undefined;
  });
}

/**
 * The call `point(args)`, where `point` is a definition compiled for a
 * point at position `at`, when the argument at `at` may be absent: the
 * absent value goes to `scalar`, the definition compiled for a scalar
 * parameter, and a present value goes to `point`. Each argument is
 * evaluated once, in order.
 *
 * The interpreter binds the absent value to a parameter with no declared
 * type and runs the body with it: with `f2 := t ↦ 2t`, `f2(Missing)` is
 * `NaN`, and with `f7 := t ↦ 7`, `f7(Missing)` is 7. The definition for a
 * scalar parameter gives these values for the compiled absent value. The
 * definition for one point reads the coordinates of its argument, so it
 * cannot receive the absent value.
 *
 * On JavaScript:
 * `((_tv1) => _tv1 === undefined ? _fn_f2(_tv1) : _fn_f2_point(_tv1))(_.e)`.
 * Throws on a target other than JavaScript and Python.
 */
export function absentPointFork(
  point: string,
  scalar: string,
  args: ReadonlyArray<string>,
  at: number,
  target: CompileTarget<Expression>
): string {
  const params = args.map(() => tempVar(target));
  const list = params.join(', ');
  if (target.language === 'javascript')
    return `((${list}) => ${params[at]} === undefined ? ${scalar}(${list}) : ${point}(${list}))(${args.join(', ')})`;
  if (target.language === 'python')
    return `(lambda ${list}: ${scalar}(${list}) if ${params[at]} is None else ${point}(${list}))(${args.join(', ')})`;
  throw new Error(
    `Could not compile the call: an argument is one point that may be ` +
      `absent, at a parameter with no declared type, and the ` +
      `'${target.language ?? 'unknown'}' target has no test of an absent ` +
      `value.`
  );
}

/**
 * The `Apply` of the `Function` literal `literal` to `args`, when an
 * argument at a parameter with no declared type is one point named through
 * an alias, a union with `missing` or a nominal type (`absentPointType()`):
 * `npt`, a nominal type declared `missing | tuple<real, real>`, `Row`, a
 * nominal type declared `tuple<real, real>`, or `tuple<real, real> |
 * missing`. `undefined` when no argument is such a point.
 *
 * The interpreter binds the point whole: `Apply(t ↦ 2t, r)` is `(2, 4)`
 * for `r = (1, 2)`. The literal is compiled for a scalar parameter, so
 * the call gave `NaN` for each coordinate. The call uses the literal with
 * the parameter typed as the point, as a callback over such points does.
 * When the point may be absent, the absent value goes to the literal
 * compiled for a scalar (`absentPointFork()`), which `scalarCallee`
 * compiles: `Apply(t ↦ 2t, Missing)` is `NaN`.
 *
 * `codes` are the compiled arguments. When `wholePointAt(i)` is true, a
 * point of a tuple type at position `i` is typed as the point too: the
 * caller knows that the literal reads the parameter there as a scalar
 * (`bindsOnePointAsUndeclared()`). Throws (the `Apply` declines) when
 * the typed literal is not valid, when the target is not JavaScript or
 * Python, or when a point that may be absent is beside another point or
 * an argument that is not a scalar: the definition for a scalar would
 * receive that argument.
 */
export function appliedLiteralNamedPointCall(
  literal: Expression,
  args: ReadonlyArray<Expression>,
  codes: ReadonlyArray<string>,
  compile: (e: Expression) => string,
  scalarCallee: () => string,
  target: CompileTarget<Expression>,
  wholePointAt?: (i: number) => boolean
): string | undefined {
  if (!isFunction(literal, 'Function')) return undefined;
  const params = literal.ops.slice(1);
  if (params.length !== args.length) return undefined;
  const found = args.map((a, i) => {
    const declared = declaredParamType(params[i]);
    if (declared !== undefined && declared !== 'unknown') return undefined;
    const named = absentPointType(a.type.type);
    if (named !== undefined || wholePointAt?.(i) !== true) return named;
    const p = pointOfType(a.type.type);
    return p === undefined ? undefined : { rank: 0, ...p };
  });
  if (found.every((x) => x === undefined)) return undefined;
  const decline = (why: string): Error =>
    new Error(
      `Could not compile \`Apply\`: an argument is one point at a ` +
        `parameter with no declared type, which the interpreter binds ` +
        `whole, and ${why}`
    );
  if (target.language !== 'javascript' && target.language !== 'python')
    throw decline(
      `the '${target.language ?? 'unknown'}' target does not compile the ` +
        `literal for one point.`
    );
  const typed = literalWithParameterTypes(
    literal.engine,
    literal,
    found.map((x) => x?.point)
  );
  if (typed === undefined)
    throw decline(
      `the literal with the parameter typed as the point is not valid.`
    );
  const point = `(${compile(typed)})`;
  const at = found.findIndex((x) => x?.absent === true);
  if (at < 0) return `${point}(${codes.join(', ')})`;
  if (
    found.some((x, i) => x !== undefined && i !== at) ||
    args.some((a, i) => found[i] === undefined && !isScalarShaped(a.type.type))
  )
    throw decline(
      `the point may be absent beside an argument that is not a scalar.`
    );
  return absentPointFork(point, `(${scalarCallee()})`, codes, at, target);
}

/**
 * The `Apply` of the `Function` literal `literal` with scalar parameters
 * to `args`, when an argument at a parameter with no declared type is a
 * list of points, or a list of lists of points (`pointsBelowLists()`).
 * `undefined` when no argument is such a list.
 *
 * The interpreter maps the literal over the list levels and binds each
 * point whole: `Apply(t ↦ 7, L)` is `[7, 7]` for `L = [(1, 2), (3, 4)]`,
 * and `[7, 7]` for `L = [(1, 2), Missing]`. An absent list is bound
 * whole, and the body runs with `Missing`: `Apply(t ↦ 7, L)` is `7` for
 * an absent `L` of type `list<tuple<real, real>> | missing`. The static
 * map of a literal with scalar parameters (`emitUserFunctionCall()`) reads
 * the coordinates of each point as one more list level, and gave
 * `[[7, 7], [7, 7]]`.
 *
 * The call is the static map over the list levels (`staticMapCallback()`)
 * of the literal with the parameter typed as the point. When a point or a
 * list level may be absent, the absent value goes to the literal compiled
 * for any argument, which `scalarCallee` compiles (`absentArgumentFork()`):
 * the interpreter binds `Missing` to the parameter and runs the body. When
 * the list may be absent as a whole, a test gives the absent list to that
 * literal too, as a call of a user function does
 * (`untypedPointListElement()`).
 *
 * `codes` are the compiled arguments. Throws (the `Apply` declines) when
 * the list levels do not lead to one point type, when another argument is
 * not a scalar, when the typed literal is not valid, or when the target is
 * not JavaScript or Python.
 */
export function appliedLiteralPointListCall(
  literal: Expression,
  args: ReadonlyArray<Expression>,
  codes: ReadonlyArray<string>,
  compile: (e: Expression) => string,
  scalarCallee: () => string,
  target: CompileTarget<Expression>
): string | undefined {
  if (!isFunction(literal, 'Function')) return undefined;
  if (!paramsAreScalar(literal.type.type)) return undefined;
  const params = literal.ops.slice(1);
  if (params.length !== args.length) return undefined;
  const at = args.findIndex((a, i) => {
    const declared = declaredParamType(params[i]);
    if (declared !== undefined && declared !== 'unknown') return false;
    return !isTuple(a) && pointsBelowLists(a.type.type) !== undefined;
  });
  if (at < 0) return undefined;
  const decline = (why: string): Error =>
    new Error(
      `Could not compile \`Apply\`: argument ${at + 1}, of type ` +
        `\`${typeToString(args[at].type.type)}\`, is a list of points at a ` +
        `parameter with no declared type, which the interpreter maps over ` +
        `binding each point whole, and ${why}`
    );
  const below = pointsBelowLists(args[at].type.type);
  if (!below) throw decline(`the list levels do not lead to one point type.`);
  if (target.language !== 'javascript' && target.language !== 'python')
    throw decline(
      `the '${target.language ?? 'unknown'}' target does not compile the ` +
        `literal for one point.`
    );
  if (args.some((a, i) => i !== at && !isScalarShaped(a.type.type)))
    throw decline(`another argument is not a scalar.`);
  const typed = literalWithParameterTypes(
    literal.engine,
    literal,
    params.map((_p, i) => (i === at ? below.point : undefined))
  );
  if (typed === undefined)
    throw decline(
      `the literal with the parameter typed as the point is not valid.`
    );
  const t = args[at].type.type;
  // A `missing` at a point or at a list level below the top (a `missing`
  // inside a coordinate does not make the point absent).
  const absentInside =
    typeToString(stripMissingFromType(t, 'keep')) !== typeToString(t);
  // On Python, the literal compiled for any argument raises a `TypeError`
  // for `None` when its body reads the parameter (`max(None, 0)`,
  // `abs(None)`, `np.sin(None)`), where the interpreter runs the body with
  // `Missing`: `Apply(t ↦ Max(t, 0), [(1, 2), Missing])` is `[2, NaN]`. So
  // a point or a list that may be absent declines there, unless the body
  // does not read the parameter (`t ↦ 7`).
  if (
    target.language === 'python' &&
    (absentInside || isSubtype('missing', t))
  ) {
    const name = functionLiteralParameterName(params[at]);
    if (name === '' || literal.ops[0].symbols.includes(name))
      throw decline(
        `the list may hold an absent point, and on Python the body, which ` +
          `reads the parameter, fails on \`None\`.`
      );
  }
  const point = `(${compile(typed)})`;
  const scalar = `(${scalarCallee()})`;
  const fn = absentInside
    ? absentArgumentFork(
        point,
        scalar,
        args.map((_a, i) => i === at),
        target
      )
    : point;
  const mapped = staticMapCallback(
    fn,
    args.map((_a, i) => (i === at ? below.rank : 0)),
    target,
    args.map((a) => a.type.type)
  );
  if (mapped === undefined)
    throw decline(`the target has no map of a function over a list.`);
  if (!isSubtype('missing', t)) return `(${mapped})(${codes.join(', ')})`;
  const temps = args.map(() => tempVar(target));
  const list = temps.join(', ');
  if (target.language === 'javascript')
    return `((${list}) => ${temps[at]} === undefined ? ${scalar}(${list}) : (${mapped})(${list}))(${codes.join(', ')})`;
  return `(lambda ${list}: ${scalar}(${list}) if ${temps[at]} is None else (${mapped})(${list}))(${codes.join(', ')})`;
}

/**
 * The value `callee` of the function emitted as `name`, mapped over its
 * list values with the ranks `ranks` (`staticMapCallback()`): `callee`
 * itself when every rank is 0, else a wrapper defined once under the name
 * `${name}$m<ranks>` (`_fn_f$m1`).
 */
function mappedValueRef(
  name: string,
  callee: string,
  ranks: ReadonlyArray<number>,
  registry: UserFunctionRegistry,
  target: CompileTarget<Expression>,
  types?: ReadonlyArray<Type | undefined>
): string {
  if (!ranks.some((r) => r > 0)) return callee;
  const wrapperName = `${name}$m${mapWrapperSuffix(ranks, types, target)}`;
  if (!registry.defs.has(wrapperName))
    registry.defs.set(
      wrapperName,
      `const ${wrapperName} = ${staticMapCallback(callee, ranks, target, types)};`
    );
  return wrapperName;
}

/**
 * The value of the function `h` with a parameter declared `expression`
 * that the body reads, for a consumer that passes it values that can be
 * collections at such a parameter (`expressionParameterVariantTypes()`):
 * the definition of `h` with these parameters typed by the values. The
 * interpreter binds a collection whole to such a parameter, and the body
 * maps over it: with `h := (t: expression) ↦ 2t` and
 * `rows: list<list<real>>`, `Map(h, rows)` gives `[[2, 4], [6, 8]]` for
 * `[[1, 2], [3, 4]]`, and the variant `t: list<real>` computes it.
 * `undefined` when `h` has no such parameter, when the consumer passes
 * scalars there, or on a target other than JavaScript, where the
 * consumer has declined first. Throws when the variant cannot be emitted.
 */
function expressionParameterVariantRef(
  engine: ComputeEngine,
  h: string,
  target: CompileTarget<Expression>,
  passed: CallbackArguments | undefined
): string | undefined {
  if (passed === undefined) return undefined;
  const literal = userFunctionLiteral(engine, h);
  if (literal === undefined) return undefined;
  const declared = (i: number) => userFunctionParamType(engine, h, i);
  if (expressionParameterReadAt(literal, declared) < 0) return undefined;
  const variant = expressionParameterVariantTypes(
    literal,
    passed.types,
    declared
  );
  if (variant === undefined || variant.every((t) => t === undefined))
    return undefined;
  const registry = target.userFunctions;
  const at = variant.findIndex((t) => t !== undefined);
  const fail = () =>
    expressionParameterDecline(
      `the function value \`${h}\``,
      at,
      variant[at] ?? null
    );
  if (!registry || registry.lowering || target.language !== 'javascript')
    throw fail();
  if (!isFunction(literal, 'Function') || !parametersCanBeTyped(literal))
    throw fail();
  const specialized = cachedLiteralWithParameterTypes(
    engine,
    h,
    literal,
    variant,
    registry
  );
  // The types of the specialized definition, for its key and its record.
  const types: Type[] = literal.ops
    .slice(1)
    .map(
      (p, i) =>
        variant[i] ??
        functionLiteralParameterType(p) ??
        declared(i) ??
        'unknown'
    );
  if (specialized === undefined) throw fail();
  const name = core.emitFunctionLiteralDefinition(
    h,
    specialized,
    target,
    registry,
    { key: parameterTypesKey(h, variant), types }
  );
  if (name === undefined) throw fail();
  return name;
}

/**
 * The value reference of a ONE-parameter user function `h` whose parameter
 * binds a collection whole and has an open element type (a lifted slot
 * such as `collection<any> | value`, see `wholeCollectionParameterType`,
 * or a declared `collection<any> | number`), for a consumer that passes it
 * the values `passed`: over list values, the definition SPECIALIZED to
 * `list<number>` (`_fn_h_list_number_`); over other values, the generic
 * definition. The static type of the values selects the
 * definition, and no code tests the shape of a value at run time.
 *
 * The generic definition is compiled against the scalar arm of the slot
 * (`_SYS.mean(xs * xs)` for `h(xs) := mean(xs^2)`), so a row of
 * `Map(h, rows)` handed to it computed `NaN` where the interpreter binds
 * the row whole and answers its mean of squares; the specialization maps
 * the element-wise operators over the array
 * (`ensureSpecializedUserCallEmitted` does the same for a direct call with
 * a list argument). `undefined` (the caller takes the generic definition) when the
 * function has not exactly one parameter, when its slot's element type is
 * not open, when the value has no consumer, or when the values are not
 * lists. A value whose shape is not settled declines
 * (`callbackArgumentRanks()`), and so do list values when the
 * specialization cannot be emitted (the parameters cannot be typed again,
 * a target with its own definition lowering).
 */
export function listSpecializedValueRef(
  engine: ComputeEngine,
  h: string,
  literal: Expression & FunctionInterface,
  target: CompileTarget<Expression>,
  passed?: CallbackArguments
): string | undefined {
  if (literal.ops.length !== 2) return undefined;
  if (!paramElementTypeIsOpen(engine, h, 0)) return undefined;
  if (passed === undefined) return undefined;
  if (callbackArgumentRanks(h, passed, 1)[0] === 0) return undefined;
  const registry = target.userFunctions;
  const name = listSpecializedDefinition(engine, h, literal, target);
  if (name === undefined || !registry)
    throw new Error(
      `Could not compile the function value \`${h}\`: its consumer ` +
        `passes it lists, and the definition for a list argument could ` +
        `not be emitted.`
    );
  return name;
}

/** The definition of `h` with its parameters typed `types`, by default
 * one `list<number>` argument (`listSpecializedValueRef`), or `undefined`
 * when it cannot be emitted. A parameter whose entry is `undefined` keeps
 * its type. */
function listSpecializedDefinition(
  engine: ComputeEngine,
  h: string,
  literal: Expression & FunctionInterface,
  target: CompileTarget<Expression>,
  types: ReadonlyArray<Type | undefined> = [
    { kind: 'list', elements: 'number' },
  ]
): string | undefined {
  const registry = target.userFunctions;
  if (!registry || registry.lowering || target.language !== 'javascript')
    return undefined;
  if (!parametersCanBeTyped(literal)) return undefined;
  if (registry.specializing?.has(h)) return undefined;
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
      {
        key: parameterTypesKey(h, types),
        // Read only by a target with its own definition lowering, which
        // this function refuses above.
        types: types.map((t) => t ?? 'unknown'),
      }
    );
  } catch (e) {
    if (e instanceof Error && e.name === 'CancellationError') throw e;
    name = undefined;
  } finally {
    active.delete(h);
  }
  return name;
}

/**
 * The value reference of a MULTI-CLAUSE user function `h`, emitted under
 * `name`, for a consumer that passes it the values `passed`: the variant
 * for the shapes of these values that `ensureUserFunctionValueRef`
 * describes, which is the dispatcher `name` itself over scalar values and
 * a static map of it over list values (`_fn_mc$m1`). `undefined` (the
 * caller takes `name`) when `h` is not a multi-clause function, when one
 * of its clauses binds an argument whole, when every clause is
 * parameterless, or when the value has no consumer.
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
 * The dispatcher selects a clause on the NUMBER of arguments, so the map
 * takes the number of values that the consumer passes, not the arity of
 * one clause.
 *
 * The complex `{ re, im }` coercion needs no shim on this route: the
 * dispatcher lifts a declared-complex parameter itself, per clause, after
 * it has chosen one (`tryEmitMultiClauseFunction`).
 */
export function multiClauseValueRef(
  engine: ComputeEngine,
  h: string,
  name: string,
  target: CompileTarget<Expression>,
  passed?: CallbackArguments
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

  // A value with no consumer is the scalar variant, the dispatcher.
  if (passed === undefined) return undefined;
  // The interpreter applies the clause set to each element of a list value
  // at a callback position (user decision of 2026-09-22), whether its
  // parameters are declared scalars or left open.
  const ranks = callbackArgumentRanks(h, passed, passed.types.length);
  return mappedValueRef(name, name, ranks, registry, target, passed.types);
}

/**
 * What a callback consumer (`Map`, `Filter`, `Reduce`, `Fold`, …) passes
 * to the callback that it compiles: `types[i]` is the static type of the
 * value at parameter `i` (an element of the source, or the accumulator),
 * `undefined` when no type is provable, and `sources[i]`, when given, is
 * the collection whose elements reach parameter `i`.
 */
export interface CallbackArguments {
  readonly types: ReadonlyArray<Type | undefined>;
  readonly sources?: ReadonlyArray<Expression | undefined>;
}

/**
 * The callbacks that are being compiled for a consumer, with what the
 * consumer passes to them (`CallbackArguments`). A `Function` literal is
 * keyed by its node, a function defined on the engine and a built-in
 * operator by their name. The value of a callback whose parameters are
 * scalar is the variant for the shape of these values
 * (`callbackArgumentRanks()`): the function itself for scalar values, a
 * static map of it for list values. A function value with no entry (the
 * root `compile(f)`, a local that a block returns or stores, an argument
 * of a user function) is the scalar variant.
 *
 * An entry exists only while `withCallbackArgumentTypes` runs, so the same
 * callback in another position is not affected. A reader that emits a
 * definition removes the entry for that time (`withoutCallbackArguments`),
 * so a reference to the same function inside its own body is not read as
 * the callback.
 */
const callbackArguments = new Map<Expression | string, CallbackArguments>();

function callbackKey(
  callback: Expression | undefined
): Expression | string | undefined {
  if (callback === undefined) return undefined;
  if (isSymbol(callback)) return callback.symbol;
  if (isFunction(callback, 'Function')) return callback;
  return undefined;
}

/**
 * Run `compile` with `callback` marked as fed values of the types
 * `args.types` (see `callbackArguments`).
 */
export function withCallbackArgumentTypes<T>(
  callback: Expression | undefined,
  args: CallbackArguments,
  compile: () => T
): T {
  const key = callbackKey(callback);
  if (key === undefined) return compile();
  const previous = callbackArguments.get(key);
  callbackArguments.set(key, args);
  try {
    return compile();
  } finally {
    if (previous === undefined) callbackArguments.delete(key);
    else callbackArguments.set(key, previous);
  }
}

/**
 * What the consumer that compiles the callback `key` (a `Function` node or
 * the name of a function) passes to it, or `undefined` when the callback is
 * not compiled for a consumer.
 */
export function callbackArgumentsOf(
  key: Expression | string
): CallbackArguments | undefined {
  return callbackArguments.get(key);
}

/** Run `compile` with no consumer entry for `key` (see `callbackArguments`). */
export function withoutCallbackArguments<T>(
  key: Expression | string,
  compile: () => T
): T {
  const previous = callbackArguments.get(key);
  if (previous === undefined) return compile();
  callbackArguments.delete(key);
  try {
    return compile();
  } finally {
    callbackArguments.set(key, previous);
  }
}

/**
 * For a callback `name` whose parameters are scalar, the number of list
 * levels that the value of the callback maps over at each parameter
 * (`mapRankOfType()`), for the values `args` that its consumer passes. The
 * array has `arity` entries, or more when the consumer passes more values;
 * a parameter that the consumer does not fill (one with a default value)
 * has the rank 0.
 *
 * The interpreter applies a callback with scalar parameters to each
 * element of a list value: with `f := t ↦ 2t`, `Map(f, [[1, 2], [3]])` is
 * `[[2, 4], [6]]`. The static type of the value selects the code: the
 * function itself where every rank is 0, else a static map of depth rank
 * (`_SYS.mapFn(f, [1], x)`). No code tests the shape of a value at run
 * time. A value whose type does not settle a shape (`list<unknown>` for a
 * source, `real | list<real>`, a source with no provable element type)
 * declines (rule R3 of `docs/plans/2026-10-31-static-shape-compilation.md`),
 * with code `'unsettled-shape'` and the source in `unsupported`.
 */
export function callbackArgumentRanks(
  name: string,
  args: CallbackArguments,
  arity: number
): number[] {
  const n = Math.max(arity, args.types.length);
  const ranks: number[] = [];
  for (let i = 0; i < n; i++) {
    if (i >= args.types.length) {
      ranks.push(0);
      continue;
    }
    const t = args.types[i];
    // A value of a nominal type has the rank 0, unless its definition has
    // no settled rank (`isNominalWithUnsettledRank()`).
    const rank =
      t === undefined || isNominalWithUnsettledRank(t)
        ? undefined
        : mapRankOfType(t);
    if (rank === undefined) {
      const source = args.sources?.[i];
      // `toString()` quotes a symbol of more than one letter (`"xs"`), so a
      // symbol is named by its plain name, in the message and in
      // `unsupported`.
      const sourceName =
        source === undefined
          ? undefined
          : isSymbol(source)
            ? source.symbol
            : source.toString();
      throw new CompileDeclineError({
        code: UNSETTLED_SHAPE_CODE,
        kind: 'capability',
        message:
          `Could not compile the callback \`${name}\`: the value that its ` +
          `consumer passes to parameter ${i + 1}` +
          (sourceName !== undefined ? ` (an element of "${sourceName}")` : '') +
          ` has the type \`${t === undefined ? 'unknown' : typeToString(t)}\`, ` +
          `which does not settle one shape (a scalar, a point, or a list ` +
          `of known depth). The interpreter maps the callback over a list ` +
          `value and applies it to a scalar, so the shape of the value ` +
          `would be known only at run time.`,
        value: sourceName ?? name,
      });
    }
    ranks.push(rank);
  }
  return ranks;
}

/**
 * For each value that a consumer passes to a callback mapped with `ranks`,
 * true when its static type (`types[i]`) admits an absent value at a
 * mapped level, so the Python comprehension must test it with `is None`
 * (`pythonMapCall()`). A value with no known type is not flagged: its rank
 * was settled from a type, so `types[i]` is known when `ranks[i] > 0`.
 */
export function pythonCallbackAbsentFlags(
  ranks: ReadonlyArray<number>,
  types: ReadonlyArray<Type | undefined> | undefined
): boolean[] {
  return ranks.map((r, i) => {
    const t = types?.[i];
    return t !== undefined && admitsAbsentAtMappedLevel(t, r);
  });
}

/**
 * The name suffix of a static-map wrapper for the ranks `ranks`: the ranks
 * (`1_0`), and on Python the indices of the values tested for absence
 * (`pythonCallbackAbsentFlags()`), so two wrappers whose code differs never
 * share one name.
 */
export function mapWrapperSuffix(
  ranks: ReadonlyArray<number>,
  types: ReadonlyArray<Type | undefined> | undefined,
  target: CompileTarget<Expression>
): string {
  const base = ranks.join('_');
  if (target.language !== 'python') return base;
  const flagged = pythonCallbackAbsentFlags(ranks, types)
    .map((f, i) => (f ? i : -1))
    .filter((i) => i >= 0);
  return flagged.length === 0 ? base : `${base}$a${flagged.join('_')}`;
}

/**
 * The value of the callback `callee` (compiled code) for the map ranks
 * `ranks` (`callbackArgumentRanks()`): `callee` itself when every rank is
 * 0, else an arrow of `ranks.length` parameters that maps `callee` over the
 * list values, `(_tv1) => _SYS.mapFn(callee, [1], _tv1)` on JavaScript and
 * `_IA.mapFn` on interval-js, and a nested comprehension on Python
 * (`pythonMapCall()`). The callee is bound once, so the arrow is not built
 * again at each element. `undefined` on a target with no map.
 *
 * `types` are the static types of the values that the consumer passes
 * (`CallbackArguments.types`). On Python, a value whose type admits an
 * absent value at a mapped level (`list<real> | missing`) is tested with
 * `is None` at that level, and an absent value goes to the callee
 * unchanged (`pythonCallbackAbsentFlags()`). The JavaScript and interval
 * helpers do this at run time for every value, so they need no flag.
 */
export function staticMapCallback(
  callee: string,
  ranks: ReadonlyArray<number>,
  target: CompileTarget<Expression>,
  types?: ReadonlyArray<Type | undefined>
): string | undefined {
  if (!ranks.some((r) => r > 0)) return callee;
  if (target.language === 'python') {
    const params = ranks.map(() => tempVar(target));
    const named = /^[A-Za-z_][A-Za-z0-9_]*$/.test(callee);
    const fn = named ? callee : tempVar(target);
    const absent = pythonCallbackAbsentFlags(ranks, types);
    const inner = `(lambda ${params.join(', ')}: ${pythonMapCall(fn, ranks, params, [], target, absent)})`;
    return named ? inner : `((lambda ${fn}: ${inner})(${callee}))`;
  }
  const helper =
    target.language === 'javascript'
      ? '_SYS.mapFn'
      : target.language === 'interval-javascript'
        ? '_IA.mapFn'
        : undefined;
  if (helper === undefined) return undefined;
  const params = ranks.map(() => tempVar(target));
  const body = (fn: string) =>
    `(${params.join(', ')}) => ${helper}(${fn}, [${ranks.join(', ')}], ${params.join(', ')})`;
  if (/^[A-Za-z_$][\w$]*$/.test(callee)) return `(${body(callee)})`;
  const bound = tempVar(target);
  return `((${bound}) => ${body(bound)})(${callee})`;
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
 * then emits the bare arrow with no static map, and records its
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
 * The `Function` literals whose every call has its arguments checked at the
 * call site, with the number of nested marks of each. A literal with a
 * parameter declared `expression` that the body reads is declined when it
 * is compiled as a function value, because an argument can then be a
 * collection (`compileExprFunctionLiteral`); a literal in this map is
 * compiled, because each call site declines a collection argument at such
 * a parameter (`collectionAtExpressionParameter`). An entry exists only
 * while the literal is compiled at the position that checks its calls, so
 * the same node compiled in another position is not affected.
 */
export const checkedLiteralApplications = new Map<Expression, number>();

/**
 * Mark each of `literals` in `checkedLiteralApplications` for the time of
 * a compilation. The caller runs the returned function when that
 * compilation is done; it removes the marks.
 */
export function markCheckedLiteralApplications(
  literals: ReadonlyArray<Expression>
): () => void {
  const map = checkedLiteralApplications;
  for (const literal of literals) map.set(literal, (map.get(literal) ?? 0) + 1);
  return () => {
    for (const literal of literals) {
      const n = map.get(literal) ?? 1;
      if (n <= 1) map.delete(literal);
      else map.set(literal, n - 1);
    }
  };
}

/**
 * The names of the functions defined on the engine whose value is being
 * compiled for a callback consumer that has checked the arguments it
 * passes (`withCheckedCallback`), with the number of nested marks of each.
 * The value of a function with a parameter declared `expression` that the
 * body reads is declined (`ensureUserFunctionValueRef`), unless its name is
 * in this map. An entry exists only while the consumer compiles the
 * callback, so a value of the same function in another position is not
 * affected.
 */
const checkedFunctionValues = new Map<string, number>();

/**
 * Compile the callback `callback` of the consumer `kind` (`Map`, `Filter`,
 * `Reduce`, …) with `compile`, after a check of the parameters of the
 * callback that are declared `expression` and that the body reads.
 * `argTypes[i]` is the provable type of the value that the consumer passes
 * to parameter `i`, `undefined` when it is not provable (as for
 * `assertCallbackAnnotations`).
 *
 * The interpreter binds a collection whole to a parameter declared
 * `expression`, and the body maps over it, while compiled code reads the
 * parameter as a scalar. So:
 * - when the value at such a parameter can be a collection (a source of
 *   type `list<list<real>>` or `list<any>`, or a type that is not
 *   provable), the consumer is declined (`expressionParameterDecline`);
 * - else the callback is compiled marked as checked: a `Function` literal
 *   in `checkedLiteralApplications`, a function defined on the engine in
 *   `checkedFunctionValues`. Without the mark, the compilation of the
 *   callback as a function value declines (`compileExprFunctionLiteral`,
 *   `ensureUserFunctionValueRef`). With `L` declared `list<real>`,
 *   `Map((t: expression) ↦ 2t, L)` compiles, and `Map((t: expression) ↦
 *   2t, rows)` with `rows` declared `list<list<real>>` declines.
 *
 * A function local to the enclosing block is compiled where it is
 * defined, not here, so it is not marked; the check still declines a
 * possible collection.
 *
 * `sources[i]`, when given, is the collection whose elements the consumer
 * passes to parameter `i`, and `argTypes[i]` its element type. The element
 * type of a block local is not provable when the local is not assigned
 * exactly once (`untrustedCallbackSource`): with `L := [1, 2]` then
 * `L := [[1, 2]]` in the same block, the static type of `L` is still
 * `list<integer>`.
 */
export function withCheckedCallback<T>(
  kind: string,
  callback: Expression | undefined,
  argTypes: ReadonlyArray<Type | undefined>,
  target: CompileTarget<Expression> | undefined,
  compile: () => T,
  sources?: ReadonlyArray<Expression | undefined>
): T {
  if (callback === undefined) return compile();
  // The value of the callback is the variant for the shapes of the values
  // that the consumer passes (`callbackArguments`).
  const types = argTypes.map((t, i) =>
    callbackSourceElementType(sources?.[i], t)
  );
  if ((kind === 'Reduce' || kind === 'Scan') && types.length === 2)
    types[0] = foldAccumulatorShapeType(
      types[0] ?? declaredScalarAccumulatorType(callback, target),
      types[1]
    );
  const passed: CallbackArguments = { types, sources };
  const code = withCallbackArgumentTypes(callback, passed, () =>
    checkedCallbackCompile(kind, callback, passed.types, target, compile)
  );
  return localFunctionCallback(callback, passed, target, code);
}

/**
 * The value `code` of the callback `callback`, mapped over the list values
 * that its consumer passes (`passed`) when `callback` names a function
 * local to the enclosing block with scalar parameters. Such a function is
 * compiled where the block defines it, with no consumer, so its value
 * there is the scalar variant; the map is added where the consumer reads
 * it. With `q := s ↦ 3s` and `M: list<list<real>>`, `Map(q, M)` reads
 * `((_tv1) => _SYS.mapFn(q, [1], _tv1))`. Any other callback is mapped by
 * its own lowering (`callbackArgumentsOf()`), and `code` is returned as it
 * is.
 */
function localFunctionCallback<T>(
  callback: Expression,
  passed: CallbackArguments,
  target: CompileTarget<Expression> | undefined,
  code: T
): T {
  if (typeof code !== 'string' || target === undefined || !isSymbol(callback))
    return code;
  const local = target.localFunctions?.get(callback.symbol);
  if (!isFunction(local, 'Function') || local.nops < 2) return code;
  // The local is compiled where the block defines it, for a scalar at a
  // parameter whose type is open, and has no definition for one point.
  // The interpreter binds a point whole there: with `g := p ↦ Max(p) + 1`,
  // `Map(g, P)` is `[3, 5]` for `P = [(1, 2), (3, 4)]`, and the local
  // gave `NaN` for each point. The consumer declines.
  if (!paramsAreScalar(local.type.type)) {
    const at = onePointAtUndeclaredSlot(passed, (i) =>
      signatureParamType(local.type.type, i)
    );
    if (at >= 0)
      throw new Error(
        `Could not compile the callback \`${callback.symbol}\`: its ` +
          `consumer passes it one point at parameter ${at + 1}, which the ` +
          `interpreter binds whole, and the function local to the block is ` +
          `compiled for a scalar there.`
      );
  }
  if (
    !paramsAreScalar(local.type.type) ||
    !signatureParamsLowerToScalars(local.type.type)
  )
    return code;
  // The map takes as many values as the consumer passes, not one per
  // parameter: a parameter with a default value that the consumer does not
  // fill must reach the local as omitted, so that the local fills it. With
  // `q := (x, k = 2) ↦ x·k`, `Map(q, M)` reads
  // `((_tv1) => _SYS.mapFn(q, [1], _tv1))`, and `q` receives one argument.
  const ranks = callbackArgumentRanks(
    callback.symbol,
    passed,
    passed.types.length
  );
  const mapped = staticMapCallback(code, ranks, target, passed.types);
  if (mapped === undefined)
    throw new Error(
      `Could not compile the callback \`${callback.symbol}\`: its consumer ` +
        `passes it list values, and the target has no map of a function ` +
        `over a list.`
    );
  return mapped as T;
}

/**
 * The declared type of the accumulator parameter of the fold combiner
 * `callback`, read at the bounds of its declared signature, when this type
 * and the declared result type are scalar types: a well-typed fold passes a
 * scalar there at every step. `(a: T, x: T) -> T where T: complex` gives
 * `complex`. `undefined` otherwise.
 */
function declaredScalarAccumulatorType(
  callback: Expression,
  target: CompileTarget<Expression> | undefined
): Type | undefined {
  const literal = callbackLiteral(callback, target);
  if (!isFunction(literal, 'Function')) return undefined;
  const ground = groundSignature(functionLiteralDeclaredSignature(literal));
  const param = signatureParamType(ground, 0);
  const result = functionResult(ground);
  if (param === undefined || result === undefined) return undefined;
  return mapRankOfType(param) === 0 && mapRankOfType(result) === 0
    ? param
    : undefined;
}

/**
 * The type of the accumulator of a fold (`Reduce`, `Scan`) for the map
 * rank of its combiner (`callbackArgumentRanks()`), from `acc`, the join of
 * the seed type and the result type of the combiner
 * (`foldAccumulatorArgType`), and `element`, the element type of the
 * source. A combiner with scalar parameters is mapped over a list element,
 * so its result has the rank of the element when the element has the
 * greater rank, and the accumulator then holds the seed at the first step
 * and a list after it: its shape is not settled, and the type is
 * `undefined`, so the fold declines (rule R3). With `g := (a, x) ↦ a + x`,
 * `Reduce(rows, g, 0)` over `[[1, 2], [3, 4]]` gives `[4, 6]` in the
 * interpreter, where the accumulator is `0`, then `[1, 2]`. Otherwise
 * `acc`.
 */
function foldAccumulatorShapeType(
  acc: Type | undefined,
  element: Type | undefined
): Type | undefined {
  if (acc === undefined || element === undefined) return acc;
  const accRank = mapRankOfType(acc);
  const elementRank = mapRankOfType(element);
  if (accRank === undefined || elementRank === undefined) return acc;
  return elementRank > accRank ? undefined : acc;
}

/**
 * The element type that a consumer passes from `source` to a callback,
 * where `elementType` is the static element type of `source`. A local of
 * a block whose element type the block does not prove
 * (`untrustedCallbackSource`) has the element type of its values when
 * they all have one and the same map rank (`L := [1, 2]` then
 * `L := [3, 4]`), else none (`L := [1, 2]` then `L := [[1, 2]]`).
 */
function callbackSourceElementType(
  source: Expression | undefined,
  elementType: Type | undefined
): Type | undefined {
  if (!untrustedCallbackSource(source)) return elementType;
  const entry = blockLocalOf(source!);
  if (entry === undefined || entry.values.length === 0) return undefined;
  const types = entry.values.map((v) => collectionElementTypeOf(v));
  if (types.some((t) => t === undefined)) return undefined;
  const ranks = types.map((t) => mapRankOfType(t!));
  if (ranks[0] === undefined || ranks.some((r) => r !== ranks[0]))
    return undefined;
  return types[0];
}

/**
 * The parameter types of the variant of the callback `literal` for the
 * values of the types `types` that its consumer passes, where a parameter
 * declared `expression` that the body reads can receive a collection
 * (`collectionAtExpressionParameter`): `result[i]` is `types[i]` for such
 * a parameter, `undefined` for a parameter that keeps its type. The
 * interpreter binds a collection whole to a parameter declared
 * `expression`, and the body maps over it; the variant typed by the value
 * does the same in compiled code. With `h := (t: expression) ↦ 2t` and
 * `rows: list<list<real>>`, `Map(h, rows)` is the variant `t: list<real>`.
 *
 * `undefined` when such a value has no provable type or no settled shape
 * (`mapRankOfType()`): the consumer then declines.
 */
export function expressionParameterVariantTypes(
  literal: Expression,
  types: ReadonlyArray<Type | undefined>,
  declaredType?: (i: number) => Type | undefined
): (Type | undefined)[] | undefined {
  if (!isFunction(literal, 'Function')) return undefined;
  const result: (Type | undefined)[] = [];
  for (let i = 0; i < literal.ops.length - 1; i++) {
    const at = collectionAtExpressionParameter(
      literal,
      types.map((t, j) => (j === i ? t : 'number')),
      declaredType
    );
    if (at !== i) {
      result.push(undefined);
      continue;
    }
    const t = types[i];
    if (t === undefined || mapRankOfType(t) === undefined) return undefined;
    result.push(t);
  }
  return result;
}

/** `withCheckedCallback` once the consumer entry of the callback is set. */
function checkedCallbackCompile<T>(
  kind: string,
  callback: Expression,
  argTypes: ReadonlyArray<Type | undefined>,
  target: CompileTarget<Expression> | undefined,
  compile: () => T
): T {
  const literal = callbackLiteral(callback, target);
  if (literal === undefined) return compile();
  const named =
    isSymbol(callback) &&
    target?.localFunctions?.get(callback.symbol) === undefined
      ? callback.symbol
      : undefined;
  const declaredType =
    named === undefined
      ? undefined
      : (i: number) => userFunctionParamType(callback.engine, named, i);
  if (expressionParameterReadAt(literal, declaredType) < 0) return compile();
  const types = literal.ops.slice(1).map((_, i) => argTypes[i]);
  // A collection at such a parameter is bound whole by the variant typed by
  // the value (`expressionParameterVariantTypes()`), which the lowering of
  // the callback emits. A value with no settled shape declines.
  const at = collectionAtExpressionParameter(literal, types, declaredType);
  if (
    at >= 0 &&
    expressionParameterVariantTypes(literal, types, declaredType) === undefined
  )
    throw expressionParameterDecline(`\`${kind}\``, at, types[at] ?? null);
  let unmark: () => void;
  if (named !== undefined) {
    checkedFunctionValues.set(
      named,
      (checkedFunctionValues.get(named) ?? 0) + 1
    );
    unmark = () => {
      const n = checkedFunctionValues.get(named) ?? 1;
      if (n <= 1) checkedFunctionValues.delete(named);
      else checkedFunctionValues.set(named, n - 1);
    };
  } else if (isFunction(callback, 'Function'))
    unmark = markCheckedLiteralApplications([literal]);
  else unmark = () => {};
  try {
    return compile();
  } finally {
    unmark();
  }
}

/**
 * True when `source` is a local of a block being compiled whose static
 * element type the block does not prove: the local is assigned more than
 * once, or not at all, or its one value has no provable element type
 * (`collectionElementTypeOf`). The static type of a block local is the
 * type of its first value, and a later assignment does not change it:
 * with `L := [1, 2]` then `L := [[1, 2]]`, `L` is still typed
 * `list<integer>` where `Map` reads it. The read `At(L, 1)` is checked at
 * run time for the same reason (`_SYS.atNumeric`).
 */
export function untrustedCallbackSource(
  source: Expression | undefined
): boolean {
  if (source === undefined || !isSymbol(source)) return false;
  const entry = blockLocalOf(source);
  if (entry === undefined) return false;
  return (
    entry.values.length !== 1 ||
    collectionElementTypeOf(entry.values[0]) === undefined
  );
}

/**
 * The function literals of the statement list `stmts` that are bound to a
 * local function which the list only ever calls, so that the literal is
 * never handed out as a value.
 *
 * A call of a block-local function maps over a list argument at the call
 * site (`tryCompileLocalFunctionCall`, a static map selected by the static
 * type of the argument), and a consumer that reads the local as a value
 * maps it there (`localFunctionCallback`). So when every mention of the
 * local in the list is the head of a call, the literal is only ever given
 * scalars, and its body can read each parameter as a scalar
 * (`markScalarFedLiterals`).
 *
 * A literal is accepted when it is the value of a top-level `Assign` or
 * `Declare` of a local of the list that is bound once
 * (`reboundLocalNames`), and the name of that local appears nowhere in
 * the list as a symbol, except as the target of its own `Assign` or
 * `Declare`. Any other mention, such as `Map(L, g)`, `h = g` or a
 * function literal that returns `g`, hands the value out, and the literal
 * is not accepted. A nested scope that binds the same name is counted as a
 * mention too, which can only leave out a literal that could be accepted.
 *
 * With `checkedCallbacks`, a mention of the local as the callback of a
 * consumer of `CHECKED_CALLBACK_CONSUMERS` is not counted either, when no
 * value that the consumer passes can be a collection at a parameter
 * declared `expression` that the body reads
 * (`collectionAtExpressionParameter`). This is the list that
 * `markCheckedLiteralApplications` marks: such a literal is compiled as a
 * value at its definition, and each of its uses is checked. With
 * `g := (t: expression) ↦ 2t`, `Map(g, L)` is accepted when `L` is
 * declared `list<real>`, and `Map(g, rows)` is a mention when `rows` is
 * declared `list<list<real>>`. Such a literal can receive a list, so it is
 * not for `markScalarFedLiterals`.
 */
export function callOnlyLocalFunctionLiterals(
  stmts: ReadonlyArray<Expression>,
  locals: ReadonlyArray<string>,
  rebound: ReboundFunctionLocals,
  checkedCallbacks = false
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
    const checked = checkedCallbacks
      ? checkedCallbackOperand(e, candidates, stmts, locals)
      : -1;
    e.ops.forEach((op, i) => {
      if (!(skipTarget && i === 0) && i !== checked) walk(op, false);
    });
  };
  for (const stmt of stmts) walk(stmt, true);
  return [...candidates]
    .filter(([name]) => !mentioned.has(name))
    .map(([, literal]) => literal);
}

/**
 * The consumers whose callback operand is compiled through
 * `withCheckedCallback` on the targets that compile them, with the
 * position of the callback operand and the types of the values that the
 * consumer passes to the parameters of the callback. A type is
 * `undefined` when it is not provable (the accumulator of `Reduce` and
 * `Scan`), and is then counted as a possible collection.
 */
const CHECKED_CALLBACK_CONSUMERS: Readonly<
  Record<
    string,
    {
      callback: number;
      argTypes: (ops: ReadonlyArray<Expression>) => (Type | undefined)[];
      /** The collection whose elements each parameter receives. */
      sources?: (ops: ReadonlyArray<Expression>) => (Expression | undefined)[];
    }
  >
> = {
  // `Map(f, xs, ys, …)` passes one element of each source.
  Map: {
    callback: 0,
    argTypes: (ops) => ops.slice(1).map((x) => collectionElementTypeOf(x)),
    sources: (ops) => ops.slice(1),
  },
  Filter: {
    callback: 1,
    argTypes: (ops) => [collectionElementTypeOf(ops[0])],
    sources: (ops) => [ops[0]],
  },
  Reduce: {
    callback: 1,
    argTypes: (ops) => [undefined, collectionElementTypeOf(ops[0])],
    sources: (ops) => [undefined, ops[0]],
  },
  Scan: {
    callback: 1,
    argTypes: (ops) => [undefined, collectionElementTypeOf(ops[0])],
    sources: (ops) => [undefined, ops[0]],
  },
  Tabulate: { callback: 0, argTypes: () => ['integer', 'integer'] },
  Fill: { callback: 0, argTypes: () => ['integer', 'integer'] },
};

/**
 * The position of the operand of `e` that is a candidate local of
 * `candidates` used as the callback of a consumer of
 * `CHECKED_CALLBACK_CONSUMERS`, when no value that the consumer passes can
 * be a collection at a parameter of the literal declared `expression` that
 * the body reads. `-1` otherwise.
 */
function checkedCallbackOperand(
  e: Expression,
  candidates: ReadonlyMap<string, Expression>,
  stmts: ReadonlyArray<Expression>,
  locals: ReadonlyArray<string>
): number {
  if (!isFunction(e)) return -1;
  const consumer = CHECKED_CALLBACK_CONSUMERS[e.operator];
  if (consumer === undefined) return -1;
  const callback = e.ops[consumer.callback];
  if (!isSymbol(callback)) return -1;
  const literal = candidates.get(callback.symbol);
  if (literal === undefined) return -1;
  const sources = consumer.sources?.(e.ops) ?? [];
  const argTypes = consumer
    .argTypes(e.ops)
    .map((t, i) =>
      untrustedListSource(sources[i], stmts, locals) ? undefined : t
    );
  return collectionAtExpressionParameter(literal, argTypes) < 0
    ? consumer.callback
    : -1;
}

/**
 * `untrustedCallbackSource` for a source read in the statement list
 * `stmts`, whose own locals are `locals`. The frame of that list is not
 * known yet when its literals are marked, so the assignments of an own
 * local are counted in `stmts`: the local must be assigned exactly once,
 * by a `Assign` or a `Declare` anywhere in the list, from a value with a
 * provable element type. A local of an enclosing block is read from its
 * frame (`untrustedCallbackSource`).
 */
function untrustedListSource(
  source: Expression | undefined,
  stmts: ReadonlyArray<Expression>,
  locals: ReadonlyArray<string>
): boolean {
  if (source === undefined || !isSymbol(source)) return false;
  const name = source.symbol;
  if (!locals.includes(name)) return untrustedCallbackSource(source);
  const values: (Expression | undefined)[] = [];
  const visit = (x: Expression): void => {
    if (!isFunction(x)) return;
    if (
      (x.operator === 'Assign' || x.operator === 'Declare') &&
      isSymbol(x.ops[0], name)
    )
      values.push(
        x.operator === 'Assign' ? x.ops[1] : declareValueOperand(x.ops)
      );
    for (const op of x.ops) visit(op);
  };
  for (const stmt of stmts) visit(stmt);
  return (
    values.length !== 1 || collectionElementTypeOf(values[0]) === undefined
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
  for (const param of literal.ops.slice(1)) {
    // A parameter with a default value, `["Optional", param, default]`, is
    // read through the parameter it wraps.
    const p = optionalParameterTarget(param);
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
  // A parameter with a default value, `["Optional", param, default]`, has
  // the declared type of the parameter it wraps.
  p = optionalParameterTarget(p);
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
