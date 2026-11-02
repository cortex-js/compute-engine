// Calls over points and point lists, and the checks on their arguments.

import { targetCoalesce } from './compile-parameter-defaults.js';
import { isIndexReadTuple } from '../boxed-expression/index-read-tuple.js';
import type {
  Expression,
  IComputeEngine as ComputeEngine,
} from '../global-types.js';
import { INDEXED_COLLECTION_SHAPE_TYPE } from '../../common/type/primitive.js';
import {
  isTuple,
  isTupleShapedType,
  isTupleWithListCoordinate,
  isPointListArgumentType,
  isPointTensorArgumentType,
  isBroadcastablePointArgumentType,
  isPointOrPointListArgumentType,
  isPointParameterType,
  pointArgumentMayMixDepths,
  isEmptyListArgumentType,
} from '../collection-utils.js';
import {
  collectionElementType,
  isNonRealNumber,
  resolveTypeForCompiledLanes as resolveTypeForCompilation,
  stripMissingFromType,
  typeContainsMissing,
} from '../../common/type/utils.js';
import {
  cannotHoldAList as typeCannotHoldAList,
  isSubtype,
} from '../../common/type/subtype.js';
import { typeToString } from '../../common/type/serialize.js';
import type { Type } from '../../common/type/types.js';
import { isScalarType } from '../boxed-expression/function-literal.js';
import type { CompileTarget, TargetSource } from './types.js';
import {
  absentArgumentChecks,
  callArgumentMapRank,
  emitUserFunctionCall,
  isScalarShapedArg,
  presentCheckedCode,
  unsettledArgumentDecline,
  userFunctionParamType,
} from './compile-user-calls.js';
import {
  signatureParamType,
  userFunctionLiteral,
  userFunctionParamsAreScalar,
} from './compile-assignment-checks.js';
import { core } from './compiler-core-hooks.js';
import { compileValueOperand } from './compile-statements.js';
import { tempVar } from './compiler-naming.js';
import { isSinglePointArg } from './compile-cse.js';
import {
  absentArgumentFork,
  userFunctionSignatureIsInferred,
} from './compile-callbacks.js';
import { hasBroadcastableCoordinate } from './compiler-type-facts.js';
import {
  isScalarShaped,
  isUndeclaredParameterType,
  pointsBelowLists,
} from './static-shape.js';

/**
 * Compile a call of user function `h` in which an argument is a LIST OF
 * POINTS at a parameter declared as a point (`tuple<real, real>`, see
 * `isPointListArgumentType`). The interpreter maps such a call over the
 * points and answers the list of the function's values at each point (user
 * decision 2026-09-25, `pointListParamSlots`); the compiled call does the
 * same. Returns `undefined` when no argument is such a list.
 *
 * On JavaScript a list of points is an array of `[x, y]` arrays, so the
 * call is `list.map((p) => _fn_h(p, …))`, with every other argument
 * evaluated once, before the map, and passed whole. The emitted definition
 * receives one point at a time, which is what it is compiled for.
 *
 * Every other target fails closed: on the shader targets (GLSL, WGSL) a
 * list of points is not a value, and the interval target has no lowering
 * for a call that maps over points. The call also fails closed when more
 * than one argument is a list of points (the interpreter pairs the lists
 * and reports a length mismatch, which this lowering does not reproduce),
 * or when another argument is bound to a complex-typed parameter (that
 * argument would need the `{ re, im }` coercion of the ordinary call).
 *
 * A parameter with NO declared type (`unknown`, `any` or `value`: the
 * function has no signature, or declares `(unknown) -> number`) is mapped
 * too, when its argument is typed as a list of points
 * (`list<tuple<real, real>>`, see `untypedPointListElement`). The
 * interpreter broadcasts a list at such a parameter element by element, and
 * each element is one point. The generic definition cannot be used there:
 * its body was compiled with the parameter a scalar. The map calls the
 * call-shape specialization of the function for ONE point instead
 * (`ensureSpecializedUserCallEmitted`, the same definition the call
 * `k((1, 3))` uses), with the parameter typed as the list's element type.
 */
export function tryCompilePointListCall(
  engine: ComputeEngine,
  h: string,
  args: ReadonlyArray<Expression>,
  target: CompileTarget<Expression>,
  /** The compiled defaults for a call that maps over a list argument
   * (`emitUserFunctionCall`, `mapDefaults`). */
  mapDefaults?: () => ReadonlyArray<string | undefined>
): TargetSource | undefined {
  // A parameter declared `broadcastable<P>`, with `P` a point type, maps
  // to the cells of its argument, and a point is a cell: a tuple is not a
  // list (user decision 2026-10-24, ROADMAP CE-405). So over a list of
  // points such a call is the same one-call-per-point map as for a
  // parameter declared `P`, and it is compiled here with the parameter
  // read as `P`. `cells[i]` marks such a parameter: the interpreter maps
  // it at every depth (`[[(1, 2)], [(3, 4)]]` gives a list of lists), so
  // an argument whose rank the type does not give is mapped recursively
  // (see `dispatch` below). ROADMAP CE-412.
  const cells: boolean[] = [];
  // A parameter of a function with no signature of its own (`w` declared
  // `function`, then assigned `p ↦ p[1] + p[2]`) has no declared type. The
  // interpreter reads its slot from the signature that the body of the
  // assigned literal infers (`pointListParamSlots()` in
  // `boxed-function.ts`): when that type is a point, it maps a list of
  // points one point at a time, so `w([(1, 2), (3, 4)])` is `[3, 7]`. The
  // inferred point is read here the same way. Without it, the call was
  // inlined with the list in place of `p`, and `p[1] + p[2]` added the two
  // points: `[4, 6]`.
  const literal = userFunctionLiteral(engine, h);
  const params = args.map((_a, i) => {
    let pt = userFunctionParamType(engine, h, i);
    if (pt === undefined && literal !== undefined) {
      const inferred = signatureParamType(literal.type.type, i);
      if (inferred !== undefined && isPointParameterType(inferred))
        pt = inferred;
    }
    const r = pt === undefined ? undefined : resolveTypeForCompilation(pt);
    cells[i] =
      r !== undefined &&
      typeof r !== 'string' &&
      r.kind === 'broadcastable' &&
      isPointParameterType(r.elements);
    return cells[i] && typeof r !== 'string' && r?.kind === 'broadcastable'
      ? r.elements
      : pt;
  });
  // An argument typed as ONE point or a list of points
  // (`tuple<…> | list<tuple<…>>`, `broadcastable<tuple<…>>`): the
  // interpreter maps the call only when the value is a list, so the
  // compiled call tests the value at run time (`dispatch` below).
  // `isPointListArgumentType` also accepts `broadcastable<…>`, so this
  // test is asked first.
  const maybe = args.map((a, i) => {
    const pt = params[i];
    return (
      pt !== undefined &&
      !isTuple(a) &&
      isPointOrPointListArgumentType(a.type.type, pt)
    );
  });
  const mapped = args.map((a, i) => {
    const pt = params[i];
    return (
      pt !== undefined &&
      !maybe[i] &&
      !isTuple(a) &&
      (isPointListArgumentType(a.type.type, pt) ||
        isPointTensorArgumentType(a.type.type, pt) ||
        // The empty list (`list<never>`): the interpreter maps it to `[]`
        // without a call of the function, as the compiled map does.
        isEmptyListArgumentType(a.type.type, pt))
    );
  });
  let at = mapped.indexOf(true);
  const dispatch = at < 0 && maybe.includes(true);
  if (dispatch) at = maybe.indexOf(true);
  // A list at a SCALAR parameter of a function that has a point
  // parameter: the interpreter maps the call over the list
  // (`pointListParamSlots`, ROADMAP CE-414). `scalarLists[i]` is `'list'`
  // when argument `i` is surely such a list, `'maybe'` when its type has a
  // list arm and another arm.
  const scalarLists = scalarSlotListArgs(args, params, cells);
  // The type of one point of the list, when the list is at a parameter
  // with no declared type.
  let untypedElement: Type | undefined;
  let scalarList = false;
  // The index of an argument the interpreter pairs with the list of points
  // only when its value is a list (see the `'untyped'` case below), or -1.
  let untypedSlot = -1;
  // True when the list of points at `at` is paired with other arguments at
  // scalar parameters that may be lists (`scalarLists`). The call is then
  // a static map whose ranks the static types give (see `pairedRanks`
  // below).
  let paired = false;
  if (at < 0) {
    at = args.findIndex(
      (a, i) => untypedPointListElement(engine, h, a, params[i]) !== undefined
    );
    if (at >= 0) {
      // Only the plain form is handled: every other argument is a
      // scalar. Other calls keep their ordinary route (another list
      // argument is paired with this one by the interpreter's broadcast).
      if (args.some((a, i) => i !== at && !isScalarShaped(a.type.type)))
        return undefined;
      untypedElement = untypedPointListElement(engine, h, args[at], params[at]);
    } else {
      if (!scalarLists.some((s) => s !== false)) return undefined;
      if (!scalarLists.some((s) => s === 'list' || s === 'maybe'))
        return compileUntypedScalarSlotCall(
          engine,
          h,
          args,
          params,
          scalarLists,
          target,
          mapDefaults
        );
      at = scalarLists.indexOf('list');
      scalarList = true;
    }
  }
  const reason = scalarList
    ? `Could not compile a call of \`${h}\`: ` +
      (at < 0 ? `an argument may be a list` : `argument ${at + 1} is a list`) +
      ` at a scalar parameter of a function with a point parameter, and ` +
      `the call maps over the list.`
    : `Could not compile a call of \`${h}\`: argument ${at + 1} is a list ` +
      `of points at a parameter ` +
      (untypedElement === undefined
        ? `declared as a point`
        : `with no declared type`) +
      `, and the call maps over the points.`;
  if (target.language !== 'javascript' || target.userFunctions?.lowering)
    throw new Error(
      `${reason} A list ${scalarList ? '' : 'of points '}is not a value ` +
        `the '${target.language ?? 'unknown'}' target can map a function ` +
        `over.`
    );
  if (scalarList) {
    if (at < 0 || scalarLists.filter((s) => s !== false).length > 1)
      throw new Error(
        `${reason} The type does not say whether the argument is a list, ` +
          `or more than one argument is a list, and the compiled call ` +
          `maps over one list only.`
      );
    // The compiled map goes down as many ranks as the static type gives
    // (`callArgumentMapRank()`: 2 for `list<list<real>>`), so each
    // innermost element must be a number, a boolean or a string. The
    // interpreter maps a nested list to the cells, and binds an absent
    // element to the parameter. It also checks each element against the
    // parameter's type (an `incompatible-type` error for `0` at a
    // `boolean` parameter, or for `0.5` at an `integer` one), and the
    // compiled map does not, so the element type must be a subtype of the
    // parameter's type. A rank above 1 is emitted as the static map of the
    // paired case (`paired` below).
    const scalarRank = callArgumentMapRank(args[at], target) ?? 1;
    let element: Type | undefined = args[at].type.type;
    for (let k = 0; k < scalarRank && element !== undefined; k++) {
      const listType = resolveTypeForCompilation(element);
      element =
        typeof listType === 'string'
          ? undefined
          : collectionElementType(listType);
    }
    if (scalarRank > 1) paired = true;
    const slotType = scalarSlotElementType(params, cells, at);
    if (
      element === undefined ||
      typeContainsMissing(args[at].type.type) ||
      !(
        isSubtype(element, 'real') ||
        isSubtype(element, 'boolean') ||
        isSubtype(element, 'string')
      )
    )
      throw new Error(
        `${reason} The elements of the list, typed ` +
          `\`${typeToString(element ?? 'unknown')}\`, are not all ` +
          `present real numbers, booleans or strings.`
      );
    if (
      slotType === undefined ||
      !isSubtype(element, resolveTypeForCompilation(slotType))
    )
      throw new Error(
        `${reason} The elements of the list, typed ` +
          `\`${typeToString(element)}\`, may not fit the parameter type ` +
          `\`${typeToString(slotType ?? 'unknown')}\`, and the compiled ` +
          `map does not check them.`
      );
  } else if (scalarLists.some((s) => s !== false)) {
    // One other argument at a parameter typed `unknown`, whose own type
    // does not say whether its value is a list (`'untyped'`): the
    // interpreter pairs it with the list of points when its value is a
    // list, and passes it whole to each call otherwise (user decision
    // 2026-10-24, ROADMAP CE-414.2). The compiled call tests the value at
    // run time (see `untypedSlot` below). This is not done when a
    // parameter is declared `broadcastable<…>` (the interpreter then uses
    // another slot plan), or when the list argument may also be one point.
    const declaredPlan = args.some((_a, i) => {
      const pt = userFunctionParamType(engine, h, i);
      const r = pt === undefined ? undefined : resolveTypeForCompilation(pt);
      return (
        r !== undefined && typeof r !== 'string' && r.kind === 'broadcastable'
      );
    });
    // A tensor of points of rank 2 or more, or of a rank the type does not
    // give (`matrix<tuple<…>^(2x2)>`, `tensor<tuple<…>>`): the interpreter
    // maps the call to the points at every depth, and pairs the `unknown`
    // argument with the rows (ROADMAP CE-448). The compiled pairing below
    // maps over one level only, and would give each row whole to the
    // function, so the call is not compiled.
    if (
      params[at] !== undefined &&
      isPointTensorArgumentType(args[at].type.type, params[at]!)
    )
      throw new Error(
        `Could not compile a call of \`${h}\`: argument ${at + 1} is a ` +
          `tensor of points of rank 2 or more, and another argument, at a ` +
          `parameter with no declared type, may be a list. The interpreter ` +
          `maps the call to the points at every depth and pairs the list ` +
          `with the rows, and the compiled call pairs one level only.`
      );
    if (
      !dispatch &&
      !declaredPlan &&
      untypedElement === undefined &&
      scalarLists.filter((s) => s !== false).length === 1 &&
      scalarLists.indexOf('untyped') >= 0
    )
      untypedSlot = scalarLists.indexOf('untyped');
    else if (
      !dispatch &&
      !declaredPlan &&
      untypedElement === undefined &&
      !typeContainsMissing(args[at].type.type)
    )
      paired = true;
    else
      throw new Error(
        `Could not compile a call of \`${h}\`: argument ${at + 1} is a ` +
          `list of points, and another argument is or may be a list at a ` +
          `scalar parameter. The interpreter pairs the two lists, and the ` +
          `compiled call maps over one list only.`
      );
  }
  // An argument at another `broadcastable<P>` parameter (`cells[i]`) is
  // passed whole to each call of the map, so it must be one point. The
  // interpreter maps a list there too, of any rank (`[[(1, 2)], [(3, 4)]]`
  // gives a list of lists), and pairs it with the mapped list, so such an
  // argument that may be a list counts as another list of points.
  const anotherCellsList = args.some(
    (a, i) =>
      i !== at &&
      cells[i] &&
      !isTuple(a) &&
      !typeCannotHoldAList(resolveTypeForCompilation(a.type.type))
  );
  if (
    untypedElement === undefined &&
    (anotherCellsList ||
      args.filter((_a, i) => mapped[i] || maybe[i]).length > 1)
  )
    throw new Error(
      `${reason} More than one argument is a list of points, and the ` +
        `compiled call maps over one list only.`
    );
  // The run-time test reads a value as a list of points when it is an
  // array whose first present element is an array. A point whose
  // coordinates are numbers, booleans or strings (`tuple<number, number>`)
  // is an array of coordinates that are not arrays, so the test tells the
  // two apart. Any other coordinate can be an array on JavaScript: a list
  // (`tuple<list<real>, real>`, `tuple<any, any>`), and also a tuple
  // (`tuple<tuple<number, number>, number>`), which is not a list but
  // compiles to an array. Then a point and a list of points look the same.
  //
  // A `broadcastable<tuple<…>>` value can also be a tensor of points of
  // rank 2 or more (`[[(1, 2)], [(3, 4)]]`), and a tensor of points
  // (`tensor<tuple<…>>`, `list<list<tuple<…>>>`) is one. The interpreter
  // maps the call to the points at every depth (user decision 2026-10-25,
  // ROADMAP CE-448), as for a parameter declared `broadcastable<P>`, so
  // the compiled call maps recursively too (`deep`, see below).
  const deep =
    untypedSlot < 0 &&
    untypedElement === undefined &&
    params[at] !== undefined &&
    ((dispatch && cells[at]) ||
      isPointTensorArgumentType(args[at].type.type, params[at]!) ||
      isBroadcastablePointArgumentType(args[at].type.type, params[at]!));
  if (dispatch || deep) {
    const pt = resolveTypeForCompilation(params[at]!);
    if (
      typeof pt === 'string' ||
      pt.kind !== 'tuple' ||
      pt.elements.length === 0 ||
      !pt.elements.every(
        (e) =>
          isSubtype(e.type, 'number') ||
          isSubtype(e.type, 'boolean') ||
          isSubtype(e.type, 'string')
      )
    )
      throw new Error(
        `${reason} The argument may also be one point, and a coordinate ` +
          `of the parameter type \`${typeToString(params[at]!)}\` is not ` +
          `a number, a boolean or a string, so the compiled call cannot ` +
          `tell one point from a list of points at run time.`
      );
  }
  if (
    params.some((pt, i) => i !== at && pt !== undefined && isNonRealNumber(pt))
  )
    throw new Error(
      `${reason} Another argument is bound to a complex-typed parameter, ` +
        `which the compiled map does not convert.`
    );
  // The definition of `h` for one call of the map: the call-shape
  // specialization (`ensureSpecializedUserCallEmitted`) for the arguments
  // of one call, where the list argument is replaced by its first point,
  // ascribed the type `element` (`At` alone is typed `missing | tuple<…>`).
  // The replacement is only read for its type and shape, never compiled.
  const onePointDefinition = (element: Type) => {
    const onePoint = engine.function('Typed', [
      engine.function('At', [args[at], engine.number(1)]),
      engine.box({ str: typeToString(element) }),
    ]);
    return literal === undefined || !isTupleShapedType(onePoint.type.type)
      ? undefined
      : core.ensureSpecializedUserCallEmitted(
          engine,
          h,
          literal,
          args.map((a, i) => (i === at ? onePoint : a)),
          target
        );
  };
  let name: string | undefined;
  if (untypedElement === undefined) {
    // A list of points at a parameter declared as a point, mapped one
    // point per call, with every other argument one scalar or one point:
    // each call of the map receives the same values as the call on one
    // point. That call takes the specialization typed by its arguments, so
    // the map takes it too. The generic definition types a parameter
    // declared `unknown` as `unknown`, and a call in the body that maps
    // over a list argument then declines (rule R3 of
    // `docs/plans/2026-10-31-static-shape-compilation.md`): with
    // `C := (D, d) ↦ ((D − d)/2, 0)` and `n := (q, D2, d2) ↦ q + C(D2, d2)`
    // declared `(tuple<number, number>, unknown, unknown) -> …`, the map of
    // `n([(1, 2), (3, 4)], 4, 2)` compiled `C(D2, d2)` with `D2: unknown`.
    // When no specialization applies, or the call maps in another form
    // (at run time, recursively, or paired with another list), the call
    // keeps the generic definition.
    const element =
      !scalarList && !dispatch && !deep && !paired && untypedSlot < 0
        ? collectionElementType(resolveTypeForCompilation(args[at].type.type))
        : undefined;
    if (
      element !== undefined &&
      args.every(
        (a, i) =>
          i === at || isSinglePointArg(a) || isScalarShapedArg(a, target)
      )
    )
      name = onePointDefinition(element)?.name;
    name ??= core.ensureUserFunctionEmitted(engine, h, target);
  } else {
    const emitted = onePointDefinition(untypedElement);
    if (emitted === undefined)
      throw new Error(
        `${reason} No definition of \`${h}\` for one point of type ` +
          `\`${typeToString(untypedElement)}\` could be compiled.`
      );
    name = emitted.name;
  }
  if (name === undefined) return undefined;
  // The mapped list is exempt from the absent-argument check (an absent
  // point is an absent cell); every other argument is checked inside the
  // map, when a point is given to the function. So an empty list, and an
  // absent list, answer as the interpreter does (the empty list, and an
  // absent value), without a check.
  const checks = absentArgumentChecks(
    h,
    userFunctionLiteral(engine, h),
    args,
    target
  );
  const codes = args.map((a) => compileValueOperand(a, target));
  const temps = args.map(() => tempVar(target));
  const point = tempVar(target);
  const callArgs = temps.map((t, i) =>
    i === at ? point : presentCheckedCode(t, checks[i])
  );
  // A list that may be absent (`(A, B)\{0 < t\}`), or whose points may be
  // absent (`[(3, 4)\{0 < t\}, (6, 8)]`): `Missing` lowers to
  // `undefined`, and the interpreter answers `Missing` for an absent list
  // and for the cell of an absent point, so the map does the same.
  const absent = typeContainsMissing(args[at].type.type);
  // At a `broadcastable<P>` parameter (`cells[at]`) too, the interpreter
  // answers `Missing` for an absent point, at any depth, and for a list of
  // points that is absent as a whole, as for a parameter declared `P`
  // (user decision 2026-10-24, ROADMAP CE-420): the map gives `undefined`
  // for each.
  //
  // An argument at ANOTHER `broadcastable<P>` parameter is passed whole to
  // each call. When it may be absent (`P | missing`), the interpreter binds
  // the absent value to the parameter, which is an `incompatible-type`
  // error, as for a parameter declared `P`, so the call fails closed, as
  // the check of an absent argument does for a parameter declared `P`.
  const mayBeAbsentWhole = (t: Type): boolean => {
    const r = resolveTypeForCompilation(t);
    return (
      r === 'missing' ||
      (typeof r !== 'string' &&
        r.kind === 'union' &&
        r.types.some((x) => resolveTypeForCompilation(x) === 'missing'))
    );
  };
  const absentPoint = args.findIndex(
    (a, i) => i !== at && cells[i] && mayBeAbsentWhole(a.type.type)
  );
  if (absentPoint >= 0)
    throw new Error(
      `${reason} Argument ${absentPoint + 1} may be absent, and the ` +
        `parameter, declared \`broadcastable<…>\`, refuses an absent point ` +
        `passed whole.`
    );
  // At a parameter with no declared type, the interpreter binds an absent
  // list whole to the parameter and evaluates the body: with
  // `f7 := t ↦ 7`, `f7(LP)` is `7` when `LP` is `Missing`. The absent list
  // is then given to the definition of `h` compiled for any argument, as
  // for a call `f7(Missing)`. An absent point of a present list, and an
  // absent list level, go there too: the interpreter binds `Missing` to
  // the parameter and runs the body, so `f2([(1, 2), Missing])` is
  // `[(2, 4), NaN]` with `f2 := t ↦ 2t`. At a parameter declared as a
  // point, the interpreter gives `Missing` for an absent point and for an
  // absent list (see above), and the map gives `undefined`.
  let wholeDef: string | undefined;
  if (untypedElement !== undefined && absent) {
    wholeDef = core.ensureUserFunctionEmitted(engine, h, target);
    if (wholeDef === undefined)
      throw new Error(
        `${reason} The points may be absent, and no definition of \`${h}\` ` +
          `for an absent argument could be compiled.`
      );
  }
  const absentListCall =
    wholeDef !== undefined && mayBeAbsentWhole(args[at].type.type)
      ? `${wholeDef}(${temps
          .map((t, i) => (i === at ? t : presentCheckedCode(t, checks[i])))
          .join(', ')})`
      : undefined;
  const listGuard = absent
    ? `${temps[at]} === undefined ? ${absentListCall ?? 'undefined'} : `
    : '';
  const pointGuard = absent
    ? `${point} === undefined ? ${
        wholeDef === undefined
          ? 'undefined'
          : `${wholeDef}(${callArgs.join(', ')})`
      } : `
    : '';
  const map =
    `${temps[at]}.map((${point}) => ` +
    `${pointGuard}${name}(${callArgs.join(', ')}))`;
  const head = `(${temps.join(', ')}) => ${listGuard}`;
  // A list of points paired with lists at scalar parameters
  // (`f(Ps, t)` with `Ps: list<tuple<real, real>>` and `t: list<real>`):
  // the interpreter gives point `i` and element `i` of `t` to one call,
  // and maps the call again over an element that is a list. The static
  // map `_SYS.mapFn` does the same, with the ranks that the static types
  // give: 1 for the list of points (a point is given whole), and the rank
  // of each other argument at a scalar parameter (`callArgumentMapRank()`).
  // A length mismatch gives `NaN`, the compiled value of the interpreter's
  // `incompatible-dimensions` error. An argument whose type settles no
  // rank declines (rule R3).
  if (paired) {
    const ranks = args.map((a, i) =>
      i === at && !scalarList
        ? 1
        : scalarLists[i] === false
          ? 0
          : callArgumentMapRank(a, target)
    );
    const unsettled = ranks.findIndex((r) => r === undefined);
    if (unsettled >= 0) throw unsettledArgumentDecline(h, args[unsettled]);
    // The compiled map does not check an element against the parameter
    // type, which the interpreter does, so the innermost element type of
    // each mapped list must fit its parameter.
    args.forEach((a, i) => {
      if (i === at || ranks[i] === 0) return;
      let element: Type | undefined = a.type.type;
      for (let k = 0; k < ranks[i]! && element !== undefined; k++)
        element = collectionElementType(resolveTypeForCompilation(element));
      const slotType = scalarSlotElementType(params, cells, i);
      if (
        element === undefined ||
        slotType === undefined ||
        !isSubtype(element, resolveTypeForCompilation(slotType))
      )
        throw new Error(
          `${reason} The elements of argument ${i + 1}, typed ` +
            `\`${typeToString(element ?? 'unknown')}\`, may not fit the ` +
            `parameter type \`${typeToString(slotType ?? 'unknown')}\`, ` +
            `and the compiled map does not check them.`
        );
    });
    // An element that is absent at a parameter with a default takes the
    // default (`mapDefaults`, filled with the target's `Coalesce`), as the
    // interpreter fills each cell of a broadcast. With no absent-argument
    // check and no default to fill, the mapped function is the callee
    // itself, not an arrow that only calls it.
    const coalesce = targetCoalesce(target);
    const fills =
      target.language === 'javascript' && coalesce !== undefined
        ? (mapDefaults?.() ?? [])
        : [];
    const cellArgs = temps.map((t, i) =>
      i === at
        ? t
        : presentCheckedCode(
            fills[i] === undefined ? t : coalesce!(t, fills[i]!),
            checks[i]
          )
    );
    const fn =
      checks.every((c, i) => i === at || c === undefined) &&
      fills.every((f, i) => i === at || f === undefined)
        ? name
        : `((${temps.join(', ')}) => ${name}(${cellArgs.join(', ')}))`;
    return `_SYS.mapFn(${fn}, [${ranks.join(', ')}], ${codes.join(', ')})`;
  }
  // The argument at the parameter typed `unknown` is passed whole to each
  // call of the map when its static type settles a value that is not a
  // list. The interpreter pairs it with the points when its value is a
  // list, which only a run-time test of the value would know, so the call
  // declines then (rule R3 of
  // `docs/plans/2026-10-31-static-shape-compilation.md`).
  if (untypedSlot >= 0 && callArgumentMapRank(args[untypedSlot], target) !== 0)
    throw unsettledArgumentDecline(h, args[untypedSlot]);
  // A tensor of points (`list<list<P>>`) at a parameter with no declared
  // type: the interpreter maps the call over every list level above the
  // points and binds each point whole (`untypedPointListElement()`), so
  // the call is the static map over those levels of the definition for
  // one point, with every other argument given whole to each call.
  const untypedRank =
    untypedElement === undefined
      ? undefined
      : pointsBelowLists(args[at].type.type)?.rank;
  if (untypedRank !== undefined && untypedRank > 1) {
    const checked = checks.every((c, i) => i === at || c === undefined)
      ? name
      : `((${temps.join(', ')}) => ${name}(${temps
          .map((t, i) => (i === at ? t : presentCheckedCode(t, checks[i])))
          .join(', ')}))`;
    // An argument that may be absent or hold an absent value, as a point
    // or as a list level: `_SYS.mapFn` passes the absent value to the
    // function as it is, and the interpreter binds `Missing` to the
    // parameter and runs the body, so the absent value goes to the
    // definition for any argument (`absentArgumentFork()`).
    const checkedWhole =
      wholeDef === undefined
        ? undefined
        : checks.every((c, i) => i === at || c === undefined)
          ? wholeDef
          : `((${temps.join(', ')}) => ${wholeDef}(${temps
              .map((t, i) => (i === at ? t : presentCheckedCode(t, checks[i])))
              .join(', ')}))`;
    const fn =
      checkedWhole !== undefined
        ? absentArgumentFork(
            checked,
            checkedWhole,
            args.map((_a, i) => i === at),
            target
          )
        : checked;
    const ranksCode = `[${args.map((_a, i) => (i === at ? untypedRank : 0)).join(', ')}]`;
    // A list that may be absent as a whole is bound whole to the
    // parameter (`absentListCall` above), not given `Missing`.
    if (absentListCall !== undefined)
      return (
        `((${temps.join(', ')}) => ${temps[at]} === undefined ? ` +
        `${absentListCall} : _SYS.mapFn(${fn}, ${ranksCode}, ` +
        `${temps.join(', ')}))(${codes.join(', ')})`
      );
    return `_SYS.mapFn(${fn}, ${ranksCode}, ${codes.join(', ')})`;
  }
  if (!dispatch && !deep) return `(${head}${map})(${codes.join(', ')})`;
  // An argument whose type is one point or a list of points, which the
  // compiler infers (`If(c, (1, 2), [(1, 2)])`): only a run-time test of
  // the value would select the map or the call. An input declared with
  // such a union is narrowed before (`compileDeclaredUnionDispatch()`).
  if (!deep) throw unsettledArgumentDecline(h, args[at]);
  // A tensor of points whose static type gives its rank
  // (`list<list<P>>`, `matrix<P^(2x2)>`) at a parameter declared or
  // inferred as the point `P`: the interpreter maps the call to the points
  // at every depth, so the call is the static map over that rank, with
  // every other argument given whole to each call. No value is tested at
  // run time. A parameter declared `broadcastable<P>` keeps its run-time
  // walk below (a host declaration), as does an argument whose type does
  // not give the rank (`tensor<P>`, `broadcastable<P>`) or may be absent.
  const rank =
    cells[at] || absent
      ? undefined
      : pointTensorRank(args[at].type.type, params[at]!);
  if (rank !== undefined) {
    const fn = checks.every((c, i) => i === at || c === undefined)
      ? name
      : `((${temps.join(', ')}) => ${name}(${temps
          .map((t, i) => (i === at ? t : presentCheckedCode(t, checks[i])))
          .join(', ')}))`;
    return (
      `_SYS.mapFn(${fn}, [${args.map((_a, i) => (i === at ? rank : 0)).join(', ')}], ` +
      `${codes.join(', ')})`
    );
  }
  // A parameter declared `broadcastable<P>`: an empty array, or an array
  // whose first element is an array, is a list of points (see the
  // coordinate check above); any other value is one point, given whole to
  // the function.
  const onePointArgs = temps.map((t, i) => presentCheckedCode(t, checks[i]));
  const v = temps[at];
  // An absent point lowers to `undefined` (`[undefined, [3, 4]]`), so the
  // test reads the first PRESENT element. A list whose points are all
  // absent is a list too: a point has at least one coordinate, and its
  // coordinates are typed as present values.
  const e = tempVar(target);
  const isListOf = (x: string) =>
    `Array.isArray(${x}) && ((${e}) => ${e} === undefined || ` +
    `Array.isArray(${e}))(${x}.find((${e}) => ${e} !== undefined))`;
  // A `broadcastable<P>` parameter maps to the cells at every depth: a
  // named function expression applies the same test to each element,
  // maps again over a list, and calls the function on a point.
  const go = tempVar(target);
  const p = tempVar(target);
  const pointArgs = onePointArgs.map((c, i) =>
    i === at ? presentCheckedCode(p, checks[at]) : c
  );
  const walk =
    `(function ${go}(${p}) { return (${isListOf(p)}) ? ` +
    `${p}.map((${point}) => ${pointGuard}${go}(${point})) : ` +
    `${name}(${pointArgs.join(', ')}); })(${v})`;
  // A recursive alias whose lists can hold both points and lists
  // (`type B = list<B> | P`): the interpreter refuses a value where one
  // list holds a point and a list with an `incompatible-type` error.
  // The compiled call gives `NaN` for such a value, as the compiled
  // broadcast does for an error of the interpreter (ROADMAP CE-505).
  if (pointArgumentMayMixDepths(args[at].type.type, params[at]!)) {
    const ok = tempVar(target);
    const q = tempVar(target);
    const kind = tempVar(target);
    const el = tempVar(target);
    const l = tempVar(target);
    const uniform =
      `(function ${ok}(${q}) { if (!(${isListOf(q)})) return true; ` +
      `let ${kind}; for (const ${el} of ${q}) { ` +
      `if (${el} === undefined) continue; ` +
      `const ${l} = ${isListOf(el)}; ` +
      `if (${kind} === undefined) ${kind} = ${l}; ` +
      `else if (${kind} !== ${l}) return false; ` +
      `if (${l} && !${ok}(${el})) return false; } return true; })(${v})`;
    return `(${head}(${uniform} ? ${walk} : NaN))(${codes.join(', ')})`;
  }
  return `(${head}${walk})(${codes.join(', ')})`;
}

/**
 * For each argument of a call of a user function whose declared parameter
 * types are `params`: whether it is a LIST at a SCALAR parameter of a
 * function that also has a parameter declared as a point. The interpreter
 * maps such a call over the list (`pointListParamSlots`, ROADMAP CE-414):
 * `h := (P, t) ↦ P.x + t` declared `(tuple<number, number>, real)` gives
 * `[1, 2, 3]` for `h((1, 2), [0, 1, 2])`.
 *
 * `'list'`: the argument is not a tuple and its type is surely a list (not
 * a string). `'maybe'`: its type is a union with a list arm and an arm
 * that is not a list (`real | list<real>`). `'untyped'`: the parameter's
 * type can hold a list (`unknown`), and the argument's type can hold one
 * but has no list arm (`unknown`, `any`), so only the value says whether
 * the interpreter maps the call (see `compileUntypedScalarSlotCall`).
 * `false` otherwise, and for every argument when no parameter is declared
 * as a point.
 *
 * Which parameters take part follows the interpreter's slot plan (see
 * `scalarSlotElementType`). `cells[i]` marks a parameter declared
 * `broadcastable<P>` and read as the point `P`: it counts as a point
 * parameter.
 */
/**
 * The number of list levels above the points in an argument of type `t`
 * at a point parameter of type `param`: 1 for `list<P>`, 2 for
 * `list<list<P>>` and `matrix<P^(2x2)>`. `undefined` when the type does
 * not give one rank (`tensor<P>`, a union, `broadcastable<P>`), or when a
 * point is not a subtype of `param`.
 */
function pointTensorRank(t: Type, param: Type, depth = 0): number | undefined {
  if (depth > 16) return undefined;
  const r = resolveTypeForCompilation(t);
  if (typeof r === 'string') return undefined;
  if (r.kind === 'tuple')
    return depth > 0 && isSubtype(r, param) ? 0 : undefined;
  if (r.kind !== 'list') return undefined;
  const element = collectionElementType(r);
  if (element === undefined) return undefined;
  const inner = pointTensorRank(element, param, depth + 1);
  return inner === undefined ? undefined : inner + 1;
}

export function scalarSlotListArgs(
  args: ReadonlyArray<Expression>,
  params: ReadonlyArray<Type | undefined>,
  cells: ReadonlyArray<boolean>
): Array<'list' | 'maybe' | 'untyped' | false> {
  const none = args.map((): false => false);
  if (!params.some((pt) => pt !== undefined && isPointParameterType(pt)))
    return none;
  const isList = (t: Type): boolean => {
    const r = resolveTypeForCompilation(t);
    return (
      isSubtype(r, INDEXED_COLLECTION_SHAPE_TYPE) &&
      !isTupleShapedType(r) &&
      !isSubtype(r, 'string')
    );
  };
  return args.map((a, i) => {
    const slotType = scalarSlotElementType(params, cells, i);
    if (isTuple(a) || slotType === undefined) return false;
    const t = stripMissingFromType(a.type.type);
    if (isList(t)) return 'list';
    const r = resolveTypeForCompilation(t);
    if (
      typeof r !== 'string' &&
      r.kind === 'union' &&
      r.types.some((arm) => isList(arm))
    )
      return 'maybe';
    if (
      !typeCannotHoldAList(resolveTypeForCompilation(slotType)) &&
      !typeCannotHoldAList(r)
    )
      return 'untyped';
    return false;
  });
}

/**
 * Compile a call of user function `h`, which has a point parameter, when
 * the only arguments that may be lists are the ones `scalarLists` marks
 * `'untyped'` (see `scalarSlotListArgs`): each is at a parameter typed
 * `unknown`, and its own type does not say whether its value is a list.
 *
 * The interpreter maps the call over such an argument when its value is a
 * list, at every depth, and binds the value whole otherwise, as for the
 * parameter of a one-parameter function (user decision 2026-10-24,
 * ROADMAP CE-414.2). The compiled call reads the static type of the
 * argument instead (`emitUserFunctionCall`): a direct call for a scalar, a
 * static map for a list, and a decline when the type settles no shape.
 * Every other argument is passed whole to each call, so it must be a tuple
 * (one point) or provably not a list.
 *
 * The call fails closed on a target other than JavaScript, when another
 * argument may be a list, when a parameter is declared `broadcastable<…>`
 * (the interpreter then maps an `unknown` slot one rank down, not to the
 * cells), and when another argument is bound to a complex-typed parameter.
 */
export function compileUntypedScalarSlotCall(
  engine: ComputeEngine,
  h: string,
  args: ReadonlyArray<Expression>,
  params: ReadonlyArray<Type | undefined>,
  scalarLists: ReadonlyArray<'list' | 'maybe' | 'untyped' | false>,
  target: CompileTarget<Expression>,
  mapDefaults?: () => ReadonlyArray<string | undefined>
): TargetSource | undefined {
  const at = scalarLists.indexOf('untyped');
  const reason =
    `Could not compile a call of \`${h}\`: argument ${at + 1} may be a ` +
    `list at a parameter typed \`unknown\` of a function with a point ` +
    `parameter, and the call maps over it when it is a list.`;
  if (target.language !== 'javascript' || target.userFunctions?.lowering)
    throw new Error(
      `${reason} A list is not a value the ` +
        `'${target.language ?? 'unknown'}' target can map a function over.`
    );
  const declaredPlan = args.some((_a, i) => {
    const pt = userFunctionParamType(engine, h, i);
    const r = pt === undefined ? undefined : resolveTypeForCompilation(pt);
    return (
      r !== undefined && typeof r !== 'string' && r.kind === 'broadcastable'
    );
  });
  if (declaredPlan)
    throw new Error(
      `${reason} A parameter is declared \`broadcastable<…>\`, and the ` +
        `interpreter then maps the list one rank down, which the compiled ` +
        `call does not do.`
    );
  if (
    args.some(
      (a, i) =>
        scalarLists[i] !== 'untyped' &&
        !isTuple(a) &&
        !isScalarShaped(a.type.type)
    )
  )
    throw new Error(
      `${reason} Another argument may be a list, and the compiled call ` +
        `maps over the arguments typed \`unknown\` only.`
    );
  if (params.some((pt) => pt !== undefined && isNonRealNumber(pt)))
    throw new Error(
      `${reason} An argument is bound to a complex-typed parameter, which ` +
        `the compiled call does not convert.`
    );
  const name = core.ensureUserFunctionEmitted(engine, h, target);
  if (name === undefined) return undefined;
  const checks = absentArgumentChecks(
    h,
    userFunctionLiteral(engine, h),
    args,
    target
  );
  // The static type of each argument typed `unknown` there selects the
  // direct call or the static map (`emitUserFunctionCall`), or declines
  // when it does not settle a shape.
  return emitUserFunctionCall(
    name,
    args,
    target,
    args.map(() => false),
    true,
    [],
    checks,
    mapDefaults
  );
}

/**
 * The element type of SCALAR parameter `i` of a user function whose
 * declared parameter types are `params` (see `scalarSlotListArgs`): the
 * type each element of a list argument at that parameter is bound to when
 * the interpreter maps the call over the list. `undefined` when the
 * parameter is a point parameter, or when the interpreter binds a list
 * argument whole there.
 *
 * The interpreter has two slot plans, and this follows the one it uses.
 * When a parameter is declared `broadcastable<…>` (`cells[i]` marks one
 * read as a point), it uses the `broadcastable<T>` plan
 * (`broadcastableParamSlots`): another `broadcastable<U>` parameter maps
 * with `U` as the element type, and a parameter that `isScalarType`
 * accepts maps with its own type. Otherwise it uses the point-list plan
 * (`pointListParamSlots`): a parameter maps when `isScalarType` accepts
 * its type, refined from the body of the assigned function (`real`,
 * `boolean`, and also `unknown`, as for a one-parameter function: user
 * decision 2026-10-24, ROADMAP CE-414.2). A parameter declared `any`,
 * `expression` or `value` does not map: `isScalarType` refuses these types
 * (user decision 2026-10-30, GitHub issue #488).
 */
export function scalarSlotElementType(
  params: ReadonlyArray<Type | undefined>,
  cells: ReadonlyArray<boolean>,
  i: number
): Type | undefined {
  const pt = params[i];
  if (pt === undefined || cells[i] || isPointParameterType(pt))
    return undefined;
  const broadcastableOf = (t: Type | undefined): Type | undefined => {
    if (t === undefined) return undefined;
    const r = resolveTypeForCompilation(t);
    return typeof r !== 'string' && r.kind === 'broadcastable'
      ? r.elements
      : undefined;
  };
  const declaredPlan =
    cells.some((c) => c) ||
    params.some((t) => broadcastableOf(t) !== undefined);
  if (declaredPlan) {
    const elements = broadcastableOf(pt);
    if (elements !== undefined) return elements;
    if (isSubtype(pt, 'function')) return undefined;
    return isScalarType(pt) ? pt : undefined;
  }
  return isScalarType(pt) ? pt : undefined;
}

/**
 * The type of one point of argument `a` of a call of user function `h`,
 * when `a` is a LIST OF POINTS at a parameter with no declared type
 * (`param` is `unknown`, `any` or `value`), and the interpreter maps the
 * call over the points. Otherwise `undefined`.
 *
 * `a` is a list of points when it is not a tuple and its type is an
 * indexed collection whose element type is a tuple type
 * (`list<tuple<real, real>>`, the type of `PointList(x, y)`). A list of
 * lists of points (`list<list<tuple<real, real>>>`) counts too: the
 * interpreter maps the call over both list levels and binds each point
 * whole, so `f := t ↦ 7` gives `[[7], [7, 7]]` for
 * `[[(1, 2)], [(3, 4), (5, 6)]]` (`pointsBelowLists()`). The
 * interpreter maps such an argument only when it broadcasts the call, that
 * is when every parameter of `h` is a scalar or has no type
 * (`userFunctionParamsAreScalar`); otherwise it binds the list whole.
 */
export function untypedPointListElement(
  engine: ComputeEngine,
  h: string,
  a: Expression,
  param: Type | undefined
): Type | undefined {
  if (param === undefined || !isUndeclaredParameterType(param))
    return undefined;
  if (isTuple(a)) return undefined;
  // The `missing` arms are removed before the alias is resolved: the
  // resolved type of `list<tuple<real, real>> | missing` is a union, which
  // has no element type, and the call would then map over the coordinates
  // of each point. An absent list takes the guard of the list level, which
  // gives the value of the call with `Missing`.
  const t = resolveTypeForCompilation(stripMissingFromType(a.type.type));
  if (typeof t === 'string' || t.kind === 'tuple') return undefined;
  const element = collectionElementType(t);
  if (element === undefined) return undefined;
  if (isPointParameterType(element)) {
    if (!isPointListArgumentType(t, element)) return undefined;
  } else {
    // A list of lists of points, or a list of points whose element type
    // also admits an absent value (`list<tuple<real, real> | missing>`):
    // the element type is then not a point type, and `pointsBelowLists()`
    // removes `missing` from each list level. A list of points (rank 1)
    // takes the same route as the plain list of points, which gives
    // `Missing` for an absent element.
    const below = pointsBelowLists(t);
    if (!below || !isPointParameterType(below.point)) return undefined;
    if (!userFunctionParamsAreScalar(engine, h)) return undefined;
    return below.point;
  }
  if (!userFunctionParamsAreScalar(engine, h)) return undefined;
  return element;
}

/**
 * Fail closed for a call of user function `h` with an argument typed as a
 * LIST OF POINTS (`list<tuple<real, real>>`, such as `PointList(x, y)`) at
 * a parameter whose type is a union that admits both a list of points and
 * a MATRIX. `k := P ↦ Dot(P, P)` has such a parameter: its inferred type
 * is `list<tuple> | matrix | tuple | vector`.
 *
 * The interpreter binds the list whole (the parameter is not a point, so
 * the call is not mapped over the points), and the body reads its value:
 * `Dot` of a list of points pairs the points, `[10, 13]` for the points
 * `(1, 3), (2, 3)`. The compiled definition is compiled once for the
 * whole union, and on JavaScript a list of points and a matrix are both
 * arrays of arrays, so its body cannot tell them apart at run time: `Dot`
 * lowered to the matrix product and answered `[[7, 12], [8, 15]]`. The
 * call is declined rather than compiled to a different value.
 */
export function checkPointListAtMatrixUnionArgs(
  engine: ComputeEngine,
  h: string,
  args: ReadonlyArray<Expression>
): void {
  const isListOfPoints = (t: Type): boolean => {
    const stripped = stripMissingFromType(t);
    const r = resolveTypeForCompilation(stripped);
    if (typeof r === 'string' || r.kind === 'tuple' || r.kind === 'union')
      return false;
    if (!isSubtype(r, INDEXED_COLLECTION_SHAPE_TYPE)) return false;
    const e = collectionElementType(r);
    if (e === undefined) return false;
    const re = resolveTypeForCompilation(e);
    return re === 'tuple' || (typeof re !== 'string' && re.kind === 'tuple');
  };
  args.forEach((a, i) => {
    if (isTuple(a) || !isListOfPoints(a.type.type)) return;
    const pt = userFunctionParamType(engine, h, i);
    if (pt === undefined) return;
    const r = resolveTypeForCompilation(pt);
    if (typeof r === 'string' || r.kind !== 'union') return;
    if (!r.types.some((arm) => isSubtype(arm, 'matrix'))) return;
    if (!r.types.some(isListOfPoints)) return;
    throw new Error(
      `Could not compile a call of \`${h}\`: argument ${i + 1} is a list ` +
        `of points at a parameter of type \`${typeToString(pt)}\`, which ` +
        `also admits a matrix. The compiled definition cannot tell a list ` +
        `of points from a matrix at run time.`
    );
  });
}

/**
 * Fail closed for a call of user function `h` with an argument whose
 * static type is a LIST of scalars (`vector<real^2>`, `list<number>`) at a
 * parameter typed as a point, when that point type is a contract.
 *
 * The point type is a contract when it is declared (`p: tuple<real,
 * real>`), or when the engine inferred it from a call in the body that
 * requires a point: with `h2(q: tuple<real, real>) := q[1] + q[2]` and
 * `rc(p) := h2(p) + f(p[1])`, the parameter `p` is inferred as
 * `tuple<real, real>` from the call of `h2` (`contractTupleOfNarrow()`,
 * `boxed-expression/index-read-tuple.ts`). The interpreter refuses the
 * list at that contract: `rc([0.3, 0.4])` is an `incompatible-type`
 * error raised by `h2`. The compiled call cannot test the argument at run
 * time, because a point and a list are both arrays on JavaScript, so it
 * computed `0.5`. The call is declined instead.
 *
 * A point type that index reads alone made (`p[1] + p[2]`) is not a
 * contract (`isIndexReadTuple()`): the interpreter binds a list whole and
 * reads it by index, so such a parameter keeps accepting a list. A list
 * whose elements may be points is left to the point-list route
 * (`tryCompilePointListCall`) and to the union check below.
 */
export function checkScalarListAtContractPointParam(
  engine: ComputeEngine,
  h: string,
  args: ReadonlyArray<Expression>
): void {
  args.forEach((a, i) => {
    if (isTuple(a) || isSinglePointArg(a)) return;
    const pt = userFunctionParamType(engine, h, i);
    if (pt === undefined || !isPointParameterType(pt)) return;
    if (isIndexReadTuple(pt)) return;
    const r = resolveTypeForCompilation(stripMissingFromType(a.type.type));
    if (typeof r === 'string' || r.kind === 'union' || r.kind === 'tuple')
      return;
    if (!isSubtype(r, INDEXED_COLLECTION_SHAPE_TYPE)) return;
    const e = collectionElementType(r);
    if (
      e === undefined ||
      !(
        isSubtype(e, 'number') ||
        isSubtype(e, 'boolean') ||
        isSubtype(e, 'string')
      )
    )
      return;
    const inferred = userFunctionSignatureIsInferred(engine, h);
    throw new Error(
      `Could not compile a call of \`${h}\`: argument ${i + 1} has the ` +
        `type \`${typeToString(a.type.type)}\`, a list, at a parameter ` +
        `${inferred ? 'that a call in the body requires to be' : 'declared as'} ` +
        `the point \`${typeToString(pt)}\`. The interpreter refuses a list ` +
        `there (incompatible-type), and the compiled call cannot tell a ` +
        `list from a point at run time.`
    );
  });
}

/**
 * Fail closed for a call of user function `h` with an argument whose type
 * is a UNION with a collection arm (a list, not a tuple) at a parameter
 * declared as a point (`isPointParameterType`), when the point-list route
 * (`tryCompilePointListCall`) did not take the call. Example: the
 * parameter is `tuple<number, number>` and the argument is
 * `tuple<number, number> | list<list<tuple<number, number>>>`.
 *
 * The interpreter decides at the value: it binds a point whole, maps the
 * call over a list of points, and answers an `incompatible-type` error for
 * any other collection. The ordinary compiled call gives the whole value
 * to a definition compiled for one point, which computes with an array as
 * if it were a coordinate: `x + 1` of an array is a string on JavaScript.
 * The call is declined rather than compiled to a different value.
 *
 * A parameter whose point type was INFERRED from the body (the index reads
 * of `d(a) := a[1] + a[2]` give `tuple<number, number>`) is not a
 * contract: the interpreter does not check an argument against it, and
 * binds a collection that is not a list of points whole. A list of
 * numbers is then read by index as a point is, and is one array at run
 * time as a point is, so the compiled call gives the interpreter's value:
 * such an arm does not decline the call (`d(S(x), [1, 1])` with `S(x)`
 * typed `integer | vector<2>`). Any other collection arm still declines.
 */
export function checkPointParamCollectionUnionArgs(
  engine: ComputeEngine,
  h: string,
  args: ReadonlyArray<Expression>
): void {
  args.forEach((a, i) => {
    if (isTuple(a)) return;
    const pt = userFunctionParamType(engine, h, i);
    if (pt === undefined || !isPointParameterType(pt)) return;
    const r = resolveTypeForCompilation(stripMissingFromType(a.type.type));
    if (typeof r === 'string' || r.kind !== 'union') return;
    const inferred = userFunctionSignatureIsInferred(engine, h);
    // Only a point type that index reads alone made is exempt
    // (`isIndexReadTuple()`, index-read-tuple.ts). An inferred signature
    // can also hold a point type that a CALL in the body proves: with
    // `h2(q: tuple<real, real>)` and `rc(p) := h2(p) + …`, the parameter
    // `p` is inferred as `tuple<real, real>` from the call, and a list
    // that reaches it is refused by `h2` in the interpreter.
    const indexReadOnly = inferred && isIndexReadTuple(pt);
    // A bare name counts too (`list`, `range`, `matrix`), except `string`
    // and `tuple`: neither is a collection the call maps over.
    const collectionArm = r.types.some((arm) => {
      const x = resolveTypeForCompilation(arm);
      if (typeof x === 'string')
        return (
          x !== 'string' &&
          x !== 'tuple' &&
          isSubtype(x, INDEXED_COLLECTION_SHAPE_TYPE)
        );
      if (indexReadOnly && isSubtype(x, 'list<number>')) return false;
      return x.kind !== 'tuple' && isSubtype(x, INDEXED_COLLECTION_SHAPE_TYPE);
    });
    if (!collectionArm) return;
    throw new Error(
      `Could not compile a call of \`${h}\`: argument ${i + 1} has the ` +
        `type \`${typeToString(a.type.type)}\`, which admits a collection ` +
        `that is not a list of points, at a parameter ` +
        `${inferred ? 'inferred' : 'declared'} as the ` +
        `point \`${typeToString(pt)}\`. The compiled call cannot tell its ` +
        `values apart at run time.`
    );
  });
}

/**
 * Fail closed for a call of user function `h` with an argument that is a
 * `Tuple` with a LIST coordinate (`isTupleWithListCoordinate`), such as the
 * MathJSON `["Tuple", "x", "y"]` with `x` a declared list. Such a tuple is
 * data, not a point and not a list of points (the LaTeX `(x, y)` is a
 * `PointList`), and the interpreter answers an `incompatible-type` error
 * for it: at the call when the parameter is declared as a point it does
 * not conform to, or in the body's arithmetic otherwise. The emitted
 * definition cannot see either: it read the nested array as a point
 * (`tuple<real, real>`: one number, where the interpreter errors) or
 * dispatched on its shape at run time (one value per element).
 *
 * The call is accepted when the parameter is declared with a type the
 * tuple conforms to and whose coordinates are not `broadcastable`, such as
 * `tuple<list<real>, real>`: that declaration asks for the data tuple, and
 * the definition is compiled for it.
 */
export function checkListCoordinateTupleArgs(
  engine: ComputeEngine,
  h: string,
  args: ReadonlyArray<Expression>
): void {
  args.forEach((a, i) => {
    if (!isTupleWithListCoordinate(a)) return;
    const pt = userFunctionParamType(engine, h, i);
    if (
      pt !== undefined &&
      pt !== 'unknown' &&
      pt !== 'any' &&
      isSubtype(a.type.type, pt) &&
      !hasBroadcastableCoordinate(pt)
    )
      return;
    throw new Error(
      `Could not compile a call of \`${h}\`: argument ${i + 1} is a tuple ` +
        `with a list coordinate, which is not a point. Write ` +
        `\`PointList(…)\` for a list of points.`
    );
  });
}
