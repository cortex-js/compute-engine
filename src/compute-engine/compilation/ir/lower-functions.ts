/**
 * The lowering of user functions: a call of a user function is a call of
 * an IR function, which is lowered once per binding (the definition that
 * the call's head resolves to, not its name), with its parameters and the
 * inputs that its body reads (`capture()`) as its only names. The
 * parameter and result types come from the binding's signature; the
 * effects of the functions are their least fixed point
 * (`functionEffects()`), computed when a function is lowered: a call of a
 * function still being lowered is effectful until then, so an effect is
 * never below the final one.
 */

import type { ListType, TupleType, Type } from '../../../common/type/types.js';
import { typeToString as engineTypeToString } from '../../../common/type/serialize.js';
import { isSubtype } from '../../../common/type/subtype.js';
import type { Expression } from '../../global-types.js';
import {
  freeBinding,
  isFreeCallHead,
  isFunction,
} from '../../boxed-expression/type-guards.js';
import {
  isSubLane,
  isSubType,
  sameShape,
  typeToString,
  type IRFunction,
  type IRType,
  type Lane,
  type V,
} from './ir.js';
import { functionEffects, type Effect } from './effects.js';
import {
  decline,
  hasUnsettledShape,
  isUntyped,
  LANE_MISMATCH,
  UNSETTLED_SHAPE,
  type Binding,
  type Fn,
  type Lowering,
} from './lower-context.js';
import {
  broadcastableParamSlots,
  paramsAreScalar,
  pointListParamSlots,
} from '../../boxed-expression/boxed-function.js';
import { isIndexReadTuple } from '../../boxed-expression/index-read-tuple.js';
import { isPointParameterType } from '../../collection-utils.js';
import { parameterName, type listLowering } from './lower-lists.js';

/**
 * The IR type of an input of the engine type `t`: a real, an integer, a
 * boolean, a complex (a scalar), or a list of reals, integers or booleans
 * of stated lengths, or of a run-time length (the outer list). A scalar
 * with no declared type (`unknown`) or of type `number` is `wide`: a real,
 * or a complex in `mode: 'complex'`. `any`, a list element of type
 * `unknown` or `any`, and an inner list of run-time length have no IR
 * type.
 */
export function inputType(
  t: Type,
  wide: 'real' | 'complex' = 'real'
): { lane: Lane; shape: (number | 'run-time')[] } | undefined {
  const lane = (t: Type, element: boolean): Lane | undefined => {
    t = present(t);
    // A complex list entry declines (below).
    if (t === 'number' || (t === 'unknown' && !element))
      return !element ? wide : wide === 'complex' ? undefined : 'real';
    if (t === 'unknown' || t === 'any') return undefined;
    if (isSubtype(t, 'integer')) return 'integer';
    if (isSubtype(t, 'real') || extendedReal(t)) return 'real';
    // A list entry of a complex list can be a number or a `{re, im}`
    // object (docs/COMPILATION-MODEL.md, the ABI): only a run-time test
    // tells them apart, so such a list declines.
    if (isSubtype(t, 'complex')) return element ? undefined : 'complex';
    return isSubtype(t, 'boolean') ? 'boolean' : undefined;
  };
  const shape: (number | 'run-time')[] = [];
  while (typeof t === 'object' && t.kind === 'list') {
    // A length of -1 is a stated rank of no stated length (`vector`).
    const free = t.dimensions === undefined || t.dimensions?.join() === '-1';
    if (free && shape.length === 0) shape.push('run-time');
    else if (!t.dimensions?.every((n) => Number.isInteger(n) && n > 0))
      return undefined;
    else shape.push(...t.dimensions);
    t = t.elements;
  }
  const l = lane(t, shape.length > 0);
  return l === undefined ? undefined : { lane: l, shape };
}

/** The tuple types of `t`: a tuple, or a union of tuples. */
const tupleMembers = (t: Type): TupleType[] | undefined =>
  typeof t !== 'object'
    ? undefined
    : t.kind === 'tuple'
      ? [t]
      : t.kind === 'union' &&
          t.types.every((u) => typeof u === 'object' && u.kind === 'tuple')
        ? (t.types as TupleType[])
        : undefined;

/** The axis of the tuple mark of a value of the type `t`: 0 for a tuple (or
 *  a union of tuples), 1 for a list of them, or `undefined`. */
export function tupleAxis(t: Type): 0 | 1 | undefined {
  if (tupleMembers(t)) return 0;
  return typeof t === 'object' && t.kind === 'list' && tupleMembers(t.elements)
    ? 1
    : undefined;
}

/** `inputType()`, and a tuple of scalars of one lane (an integer among
 *  reals is a real) as the list of its elements (`shape: [n]`): a union of
 *  tuples of one length is the tuple of the lanes at each position. A list
 *  of tuples of real or integer numbers (a list of points) is a list of
 *  rank 2 of such a tuple; `tupleAxis()` gives the mark. */
export function tupleOrInputType(
  t: Type,
  wide: 'real' | 'complex' = 'real'
): ReturnType<typeof inputType> {
  if (tupleAxis(t) === 1) {
    const list = t as ListType;
    const point = tupleOrInputType(list.elements, wide);
    const outer = inputType({ ...list, elements: 'real' }, wide)?.shape;
    return point === undefined ||
      point.lane === 'boolean' ||
      outer?.length !== 1
      ? undefined
      : { lane: point.lane, shape: [...outer, ...point.shape] };
  }
  const members = tupleMembers(t);
  if (members === undefined) return inputType(t, wide);
  const n = members[0].elements.length;
  if (members.some((m) => m.elements.length !== n)) return undefined;
  const lanes = new Set(
    members.flatMap((m) =>
      m.elements.map((x) => {
        // An element of type `unknown` declines, as in a list.
        const ir = x.type === 'unknown' ? undefined : inputType(x.type, wide);
        return ir?.shape.length === 0 ? ir.lane : 'none';
      })
    )
  );
  const lane =
    lanes.size === 1
      ? [...lanes][0]
      : lanes.size === 2 && lanes.has('real') && lanes.has('integer')
        ? 'real'
        : 'none';
  return lane === 'none' || lane === 'complex'
    ? undefined
    : { lane, shape: [n] };
}

/** A union of one type and `nan` or `missing` members is that type
 *  (`missing | rational`, `integer | nan` is an integer, `nan | number`,
 *  `complex | nan`): the compiled
 *  code gives NaN where the interpreter gives `Missing` (the caveats of
 *  compiled code). */
function present(t: Type): Type {
  if (typeof t !== 'object' || t.kind !== 'union') return t;
  const rest = t.types.filter((u) => u !== 'nan' && u !== 'missing');
  return rest.length === 1 ? rest[0] : t;
}

/** `t` is a union whose every member is a real type, `nan` or an infinity
 *  (`nan | real | signed_infinity`): a double holds each of its values, so
 *  it is on the real lane, also when the finite members are integers. */
function extendedReal(t: Type): boolean {
  const member = (u: Type): boolean =>
    typeof u === 'object' && u.kind === 'union'
      ? u.types.every(member)
      : u === 'nan' || isSubtype(u, 'real') || isSubtype(u, 'infinity');
  return typeof t === 'object' && t.kind === 'union' && member(t);
}

/** The scalar IR type of `t`, or a decline that names `what`. */
export function scalarOf(node: Expression, t: Type, what: string): IRType {
  const ir = inputType(t);
  if (ir === undefined || ir.shape.length > 0)
    decline(
      node,
      `${what} is not a scalar (${engineTypeToString(t)})`,
      hasUnsettledShape(t) ? UNSETTLED_SHAPE : undefined
    );
  return { lane: ir.lane, shape: [] };
}

/** `t` settles no IR type: `unknown`, a `broadcastable` type, or a union
 *  that is none (an inferred `collection<any> | number | tuple`); the body
 *  or the argument decides. */
const loose = (t: Type) =>
  t === 'unknown' ||
  (typeof t === 'object' &&
    (t.kind === 'broadcastable' || (t.kind === 'union' && !inputType(t))));

/** The number of elements of the tuple type `t` when each is loose or a
 *  real or integer scalar (a point), or `undefined`. */
function pointLength(t: Type): number | undefined {
  t = present(t);
  if (typeof t !== 'object' || t.kind !== 'tuple' || !t.elements.length)
    return undefined;
  const scalar = (x: Type) => {
    const ir = inputType(x);
    return (
      ir?.shape.length === 0 && (ir.lane === 'real' || ir.lane === 'integer')
    );
  };
  return t.elements.every(
    (x) => loose(x.type) || x.type === 'any' || scalar(x.type)
  )
    ? t.elements.length
    : undefined;
}

/** The shape that a list type `t` of elements of no stated type states
 *  (`list<unknown>`, `list<unknown^3>`, `list<tuple<unknown, unknown>^9>`,
 *  as the engine infers a result for parameters of no stated type): its
 *  length when stated, and the length of a tuple element (a list of
 *  points). Otherwise `undefined`. */
function openList(t: Type): { length?: number; point?: number } | undefined {
  if (typeof t !== 'object' || t.kind !== 'list') return undefined;
  const x = present(t.elements);
  const point = pointLength(x);
  const d = t.dimensions ?? [-1];
  // A union (`number | list<number^2>`) declines: a declaration settles it.
  if ((point === undefined && x !== 'any' && x !== 'unknown') || d.length !== 1)
    return undefined;
  return { length: d[0] > 0 ? d[0] : undefined, point };
}

/** The definition that the head of the call `e` resolves to, when it is a
 *  user function with a function literal, and the literal. */
export function userBinding(e: Fn): { key: object; literal: Fn } | undefined {
  const od = e.operatorDefinition as
    { _isLambda?: boolean; _lambdaLiteral?: Expression } | undefined;
  const key = od?._isLambda ? od : (e.valueDefinition as object | undefined);
  const value = od?._isLambda
    ? od._lambdaLiteral
    : (e.valueDefinition?.value as Expression | undefined);
  if (key === undefined || !isFunction(value, 'Function')) return undefined;
  return { key, literal: value as Fn };
}

/** The parameter names of a function literal, and its signature's types. */
function signatureTypes(e: Fn, literal: Fn) {
  const od = e.operatorDefinition as
    { _isLambda?: boolean; signature?: { type: Type } } | undefined;
  const declared = od?._isLambda
    ? od.signature?.type
    : e.valueDefinition?.type.type;
  const signature =
    typeof declared === 'object' && declared.kind === 'signature'
      ? declared
      : undefined;
  const names = literal.ops.slice(1).map((p) => {
    const n = parameterName(p);
    if (n === undefined)
      decline(literal, `a parameter of ${e.operator} that is not a name`);
    return n;
  });
  // A list of reals or integers, of a stated or a run-time length (`'run-time'`,
  // a hidden length parameter before it), a tuple of them, or a list of such
  // tuples (`tuple`, the axis of the mark). A
  // parameter of no stated type, or of a type that is not a scalar, is a
  // point when the argument of the first call is one (`point`, `define()`).
  // With no signature (a name declared `function`), a parameter annotated
  // in the literal (`Typed(p, 'real')`) has the type of its annotation, as
  // for the interpreter.
  const own = literal.type.type;
  const annotated = (i: number) =>
    typeof own === 'object' &&
    own.kind === 'signature' &&
    literal.ops[i + 1]?.operator === 'Typed'
      ? own.args?.[i]?.type
      : undefined;
  const params = names.map((p, i) => {
    const d = signature?.args?.[i]?.type ?? annotated(i) ?? 'unknown';
    // A parameter `broadcastable<T>` takes a `T`: a list there is mapped
    // (`listMapsAt()`).
    const t =
      typeof d === 'object' && d.kind === 'broadcastable' ? d.elements : d;
    const list = tupleOrInputType(t);
    const s = inputType(t);
    const scalar = s?.shape.length === 0;
    return list !== undefined &&
      (list.shape.length === 1 || tupleAxis(t) === 1) &&
      (list.lane === 'real' || list.lane === 'integer')
      ? { ...list, tuple: tupleAxis(t) }
      : {
          lane: scalar ? s!.lane : 'real',
          shape: [],
          point: t === 'unknown' || !scalar ? t : undefined,
        };
  });
  const r = signature?.result && present(signature.result);
  // A list of reals, integers or booleans: the type of the body, whose
  // length can be a value of the body; or a tuple of them (a point), whose
  // body is a tuple; or a list of points (`tuple` is the axis of the mark).
  const ir = r === undefined ? undefined : tupleOrInputType(r);
  const tuple = r === undefined ? undefined : tupleAxis(r);
  const list = ir?.shape.length === 1 || tuple === 1 ? ir : undefined;
  // No stated result, or a tuple of elements of no stated type
  // (`tuple<unknown, unknown>`): the type of the body, a scalar or a point
  // of that many numbers (`points`).
  const open = r === undefined || r === 'number' || r === 'any' || loose(r);
  const points = list === undefined && r ? pointLength(r) : undefined;
  // A list of elements of no stated type: the shape of the body.
  const shaped = list === undefined && r ? openList(r) : undefined;
  // Where the interpreter maps a call over a list argument: the signature
  // of the binding, or of the literal for a name declared `function`.
  const mapsAt = listMapsAt(signature ?? literal.type.type);
  // A colour result is on the colour lane; a colour parameter declines.
  const result: IRType | undefined =
    open || list !== undefined || points !== undefined || shaped
      ? undefined
      : r === 'color'
        ? { lane: 'color', shape: [] }
        : scalarOf(literal, r, `the result of ${e.operator}`);
  return {
    names,
    params,
    result,
    list,
    tuple,
    r,
    open,
    points,
    shaped,
    mapsAt,
  };
}

/** Whether the interpreter maps a call of a user function of the signature
 *  `sig` over a list argument (not a tuple) at the parameter `i`, a list of
 *  points when `points`. Every parameter scalar (`paramsAreScalar()`): any
 *  list, to its leaves. Otherwise, with a parameter declared as a point
 *  (`pointListParamSlots()`): a list of points at a point parameter that
 *  is not an indexed one (`isIndexReadTuple()`), and any list at a
 *  parameter of a scalar type or of no stated type (user decision
 *  2026-10-24). Every other list binds whole. */
function listMapsAt(sig: Type): (i: number, points: boolean) => boolean {
  // A parameter declared `broadcastable<T>` (and a scalar beside it) maps.
  const declared = broadcastableParamSlots(sig);
  if (declared !== undefined) return (i) => declared.at(i).mappable;
  if (paramsAreScalar(sig)) return () => true;
  const plan = pointListParamSlots(sig);
  if (plan === undefined) return () => false;
  return (i, points) => {
    const slot = plan.at(i);
    if (!slot.mappable || slot.elements === undefined) return false;
    if (!isPointParameterType(slot.elements)) return true;
    return points && !isIndexReadTuple(slot.elements);
  };
}

/** A user function: the IR function, its parameter types and its result
 *  type (absent while its body is lowered, when it is not declared). The
 *  inputs of the compilation that its body reads are parameters after
 *  `params` (`capture()`), in the order of their first read; `called` when
 *  a call of it was made in another body while its body is lowered;
 *  `self`, the arguments of each call of it in its own body, which take the
 *  inputs when the body is lowered. */
type UserFunction = {
  key: object;
  params: {
    lane: Lane;
    shape: readonly (number | 'run-time')[];
    /** The axis of the tuple mark: a point (0) or a list of points (1). */
    tuple?: 0 | 1;
    /** The name of a list parameter of a run-time length that took the
     *  stated length of its first argument, or of a parameter that took
     *  the point of its first argument. */
    taken?: string;
  }[];
  /** The number of parameters of `ir` for `params` (with the lengths). */
  own: number;
  result?: IRType;
  /** The result is a list or a tuple (declared, or a list of elements of no
   *  stated type, `openList()`): its type is the body's. */
  list: boolean;
  /** The interpreter maps a call over a list at a parameter
   *  (`listMapsAt()`). */
  mapsAt: (i: number, points: boolean) => boolean;
  ir: IRFunction;
  inputs: Type[];
  called: boolean;
  self: V[][];
  /** The first call of the function made while its body is lowered, when
   *  it has no declared result: the call assumed a real scalar. */
  guess?: Fn;
};

export function functionLowering(
  cx: Lowering,
  lists: ReturnType<typeof listLowering>
) {
  const { b, type } = cx;
  const functions = new Map<object, UserFunction>();
  /** The functions being lowered, by the name of their head: a call of
   *  that name in the body is the recursive call (its node can be bound
   *  before the definition is). */
  const pending = new Map<string, UserFunction>();
  let settled = new Map<string, Effect>();
  // The lowerings of a function begun (`cx.attempt()`).
  let begun = 0;
  const noResult = (call: Fn): never =>
    decline(
      call,
      `a recursive call of ${call.operator}, which has no declared result type (declare it, as (real) -> real)`
    );

  /** A parameter `name` of the type `t` of the IR function `ir`. */
  const param = (ir: IRFunction, name: string, t: IRType, length = false) => {
    const v = b.newValue(t);
    ir.body.params.push(v);
    ir.paramNames.push(name);
    ir.lengthOf.push(length);
    return v;
  };

  /** The IR function of the user function of `key`, lowered once. `args`:
   *  the arguments of the first call, whose stated lengths a list parameter
   *  of a run-time length takes (a target without run-time lengths). */
  const define = (
    e: Fn,
    key: object,
    literal: Fn,
    sig: ReturnType<typeof signatureTypes>,
    args?: V[]
  ): UserFunction => {
    begun += 1;
    const { names, result, list, tuple, r, open, points, shaped } = sig;
    const params = sig.params.map((p, i) => {
      const n = args?.[i] === undefined ? undefined : type(args[i]).shape[0];
      if (
        !cx.runtimeLengths &&
        p.shape[0] === 'run-time' &&
        typeof n === 'number'
      )
        return { ...p, shape: [n, ...p.shape.slice(1)], taken: names[i] };
      if (!('point' in p) || p.point === undefined) return p;
      // The argument of the first call: a point of real or integer numbers,
      // or a scalar for a parameter of no stated type.
      const v = args?.[i];
      const t = v === undefined ? undefined : type(v);
      if (
        cx.tuples.get(v!) === 0 &&
        t?.shape.length === 1 &&
        typeof n === 'number' &&
        (t.lane === 'real' || t.lane === 'integer')
      )
        return { lane: p.lane, shape: [n], tuple: 0 as const, taken: names[i] };
      // A list of points, of a run-time length where the target has them.
      if (
        cx.tuples.get(v!) === 1 &&
        t?.shape.length === 2 &&
        (t.lane === 'real' || t.lane === 'integer')
      )
        return {
          lane: p.lane,
          shape: [
            cx.runtimeLengths || typeof t.shape[0] !== 'number'
              ? 'run-time'
              : t.shape[0],
            t.shape[1],
          ],
          tuple: 1 as const,
          taken: names[i],
        } as UserFunction['params'][number];
      // A flat list of a stated length, bound whole when the interpreter
      // does not map the call over it (`listMapsAt()`).
      if (
        !sig.mapsAt(i, false) &&
        !cx.tuples.has(v!) &&
        t?.shape.length === 1 &&
        typeof n === 'number' &&
        (t.lane === 'real' || t.lane === 'integer')
      )
        return { lane: p.lane, shape: [n], taken: names[i] };
      if (p.point !== 'unknown')
        scalarOf(
          literal,
          p.point,
          `the parameter ${names[i]} of ${e.operator}`
        );
      return p;
    });
    const ir: IRFunction = {
      name: `u${functions.size}_${e.operator.replace(/[^A-Za-z0-9]/g, '')}`,
      source: e.operator,
      paramNames: [],
      lengthOf: [],
      body: { params: [], body: [], yields: [] },
      results: [],
    };
    const values = params.map((t, i) => {
      const shape = t.shape.map((n) =>
        n === 'run-time'
          ? { v: param(ir, names[i], { lane: 'integer', shape: [] }, true) }
          : n
      );
      const v = param(ir, names[i], { lane: t.lane, shape });
      if ('tuple' in t && t.tuple !== undefined) cx.tuples.set(v, t.tuple);
      return v;
    });
    const fn: UserFunction = {
      key,
      params,
      own: (ir.lifted = ir.body.params.length),
      result,
      list: list !== undefined || points !== undefined || shaped !== undefined,
      mapsAt: sig.mapsAt,
      ir,
      inputs: [],
      called: false,
      self: [],
    };
    functions.set(key, fn);
    pending.set(e.operator, fn);
    const own = names.map((p, i): [string, Binding] => [
      p,
      { v: values[i], role: 'index' },
    ]);
    const outer = cx.frames.splice(0, cx.frames.length, {
      names: new Map(own),
      loop: false,
    });
    const caller = cx.inFunction;
    cx.inFunction = e.operator;
    try {
      b.define(ir, () => {
        const body =
          list || open || points !== undefined || shaped
            ? cx.value(literal.ops[0])!
            : cx.scalar(literal.ops[0]);
        const t = type(body);
        // A recursive call assumed a real scalar (`call()`): the body must
        // be one, an integer widened.
        if (fn.guess && (t.shape.length > 0 || !isSubLane(t.lane, 'real')))
          noResult(fn.guess);
        // A list of elements of no stated type: a flat list of numbers or
        // booleans, or a list of points, of the lengths that it states.
        const axis = cx.tuples.get(body);
        // No stated result and a body that is a list: the same.
        const listed: typeof shaped =
          shaped ??
          (r === undefined && t.shape.length > 0 && axis !== 0
            ? {}
            : undefined);
        if (
          listed &&
          (axis === 0 ||
            t.shape.length !== (axis === 1 ? 2 : 1) ||
            t.shape[1] !== (listed.point ?? t.shape[1]) ||
            !['real', 'integer', axis ? '' : 'boolean'].includes(t.lane) ||
            (listed.length !== undefined &&
              !sameShape([t.shape[0]], [listed.length], cx.constant)))
        )
          decline(
            literal,
            `a body of ${e.operator} that is not ${r ? engineTypeToString(r) : 'a scalar, a point, or a list of numbers, booleans or points (a result of no stated type)'}`
          );
        if (
          (points !== undefined || (open && !listed && t.shape.length > 0)) &&
          (cx.tuples.get(body) !== 0 ||
            t.shape.length !== 1 ||
            (t.lane !== 'real' && t.lane !== 'integer') ||
            (points !== undefined && t.shape[0] !== points))
        )
          decline(
            literal,
            points === undefined
              ? `a body of ${e.operator} that is not a scalar or a point of numbers (a result of no stated type)`
              : `a body of ${e.operator} that is not ${engineTypeToString(r!)}`
          );
        // The shape of the body, past a run-time length.
        const fixed = list?.shape[0] === 'run-time' ? 1 : 0;
        if (
          list !== undefined &&
          (cx.tuples.get(body) !== tuple ||
            t.shape.length !== list.shape.length ||
            !isSubLane(t.lane, list.lane) ||
            !sameShape(
              t.shape.slice(fixed),
              list.shape.slice(fixed) as number[],
              cx.constant
            ))
        )
          decline(
            literal,
            `a body of ${e.operator} that is not ${engineTypeToString(r!)}`
          );
        // A real body of a complex result is converted.
        const v = fn.guess
          ? cx.widen(body, 'real')
          : fn.result?.lane === 'complex' && type(body).lane !== 'boolean'
            ? cx.widen(body, 'complex')
            : body;
        if (fn.result !== undefined && !isSubType(type(v), fn.result))
          decline(
            literal,
            `a body of ${e.operator} that is not ${typeToString(fn.result)}`
          );
        return [v];
      });
    } finally {
      cx.frames.splice(0, cx.frames.length, ...outer);
      cx.inFunction = caller;
    }
    // A length value of the body that is a constant is its number: a call
    // then has one result of that length.
    if (fn.result === undefined) {
      const t = type(ir.body.yields[0]);
      fn.result = {
        ...t,
        shape: t.shape.map((n) =>
          typeof n === 'number' ? n : (cx.constant(n.v) ?? n)
        ),
      };
    }
    ir.results.push(fn.result);
    // A call in the body passes the inputs, parameters of the body.
    for (const a of fn.self) a.push(...ir.body.params.slice(fn.own));
    pending.delete(e.operator);
    // A `Comprehension` in the body of a function being lowered reads the
    // effect of a function it calls (`flips` in `moves`).
    settled = functionEffects(cx.rows, b.functions);
    return fn;
  };

  /** A call of the user function that the head of `e` resolves to, or of
   *  the function of that name being lowered; with `given`, of the values
   *  of its arguments, already lowered. */
  const call = (
    e: Fn,
    binding?: { key: object; literal: Fn },
    given?: V[]
  ): number => {
    let fn = binding ? functions.get(binding.key) : pending.get(e.operator)!;
    // Without run-time lengths, the arguments of the first call are lowered
    // before the function, which takes their stated lengths; so are they
    // for a parameter that can take the point of its argument.
    let early = given;
    if (fn === undefined) {
      const sig = signatureTypes(e, binding!.literal);
      if (
        sig.params.some(
          (p) =>
            (!cx.runtimeLengths && p.shape[0] === 'run-time') ||
            ('point' in p && p.point !== undefined)
        )
      )
        early = e.ops.map((op) => cx.value(op)!);
      // An argument can hold the first call of the same function.
      fn =
        functions.get(binding!.key) ??
        define(e, binding!.key, binding!.literal, sig, early);
    }
    if (e.nops !== fn.params.length)
      decline(e, `${e.operator} with ${e.nops} arguments`);
    // Each argument is lowered once, in order; `mapped`, a list for a
    // scalar parameter, which the call maps over (`mapOver()`).
    const values: V[] = [];
    let mapped = false;
    const args = e.ops.flatMap((op, i) => {
      const p = fn.params[i];
      values.push(early?.[i] ?? cx.value(op)!);
      // A list (not a point) that the parameter would take whole, where
      // the interpreter maps the function over it (`listMapsAt()`).
      const axis = cx.tuples.get(values[i]);
      if (
        p.shape.length > 0 &&
        axis !== 0 &&
        type(values[i]).shape.length > 0 &&
        fn.mapsAt(i, axis === 1)
      )
        decline(
          op,
          `a list argument of ${e.operator} that the parameter ${i + 1}, a list or a point, would take whole (the interpreter maps the function over the list)`
        );
      if (mapped) return [];
      const v = cx.widen(values[i], p.lane);
      const t = type(v);
      if (
        p.tuple === 0 &&
        p.taken !== undefined &&
        (cx.tuples.get(v) !== 0 || t.shape[0] !== p.shape[0])
      )
        decline(
          op,
          `an argument of ${e.operator} of another shape than at its first call: the parameter ${p.taken} is a point of ${p.shape[0]} numbers (${typeToString(t, cx.tuples.get(v))} here)`
        );
      if (
        p.tuple === 1 &&
        p.taken !== undefined &&
        (cx.tuples.get(v) !== 1 ||
          t.shape.length !== 2 ||
          t.shape[1] !== p.shape[1])
      )
        decline(
          op,
          `an argument of ${e.operator} of another shape than at its first call: the parameter ${p.taken} is a list of points of ${p.shape[1]} numbers (${typeToString(t, cx.tuples.get(v))} here)`
        );
      if (
        p.taken !== undefined &&
        typeof p.shape[0] === 'number' &&
        t.shape.length > 0 &&
        t.shape[0] !== p.shape[0]
      )
        decline(
          op,
          `an argument of ${e.operator} of another length than at its first call: the list parameter ${p.taken} has the length ${p.shape[0]} of that call (${typeof t.shape[0] === 'number' ? typeToString(t) : 'a list of no stated length'} here${cx.runtimeLengths ? '' : '; a target without run-time lengths'})`
        );
      if (p.shape.length > 0 && t.shape.length === 0)
        decline(
          op,
          `a scalar argument of ${e.operator} for the parameter ${i + 1}, a list or a point`
        );
      // A list parameter of a run-time length reads the argument's length.
      const n = t.shape[0];
      const length =
        p.shape[0] !== 'run-time' || n === undefined
          ? []
          : [typeof n === 'number' ? b.constant(n, 'integer') : n.v];
      const declared = {
        lane: p.lane,
        shape: p.shape.map((m) => (m === 'run-time' ? n : m)),
      } as IRType;
      if (p.shape.length === 0 && t.shape.length > 0) {
        // A list that the interpreter binds whole at a scalar parameter.
        if (!fn.mapsAt(i, false))
          decline(
            op,
            `a list argument of ${e.operator} that the scalar parameter ${i + 1} would take (the interpreter binds the list whole)`
          );
        // A tuple binds whole.
        if (cx.tuples.has(v))
          decline(
            op,
            `a list argument of ${e.operator} (the interpreter maps the function over the list)`
          );
        mapped = true;
        return [];
      }
      // A tuple argument for a tuple parameter only.
      if (cx.tuples.get(v) !== p.tuple || !isSubType(t, declared, cx.constant))
        decline(
          op,
          `an argument of ${e.operator} that is not ${typeToString(declared, p.tuple)}`,
          // A complex value at a real parameter of the same shape (not an
          // input with no type, which the complex mode reads as complex).
          t.lane === 'complex' &&
            !isUntyped(op.type.type) &&
            isSubLane(declared.lane, 'real') &&
            cx.tuples.get(v) === p.tuple &&
            sameShape(t.shape, declared.shape)
            ? LANE_MISMATCH
            : undefined
        );
      return [...length, v];
    });
    if (mapped) return mapOver(e, binding, fn, values);
    // A call of a function whose body is being lowered (on a cycle of
    // calls) with no declared result assumes a real scalar, which
    // `define()` checks against the body; a list or tuple result declines.
    if (fn.result === undefined) {
      if (fn.list)
        decline(
          e,
          `a recursive call of ${e.operator}, a function with a list or tuple result`
        );
      fn.guess = e;
      fn.result = { lane: 'real', shape: [] };
    }
    // A call of a function being lowered, in its own body, passes the
    // inputs when the body is lowered (`define()`); in another body (a
    // cycle of calls), none: it declines when the function reads one
    // (`capture()`).
    const cyclic = pending.get(e.operator) === fn;
    const self = cyclic && cx.inFunction === e.operator;
    if (cyclic && !self) {
      if (fn.inputs.length > 0)
        decline(
          e,
          `a recursive call of ${e.operator}, which reads the input ${fn.ir.paramNames[fn.own]} (a function on a cycle of calls through another function reads no input)`
        );
      fn.called = true;
    }
    // The inputs that the body reads, read here (`free()`).
    const inputs = (self ? [] : fn.inputs).map((t, j) => {
      const k = fn.own + j;
      const p = type(fn.ir.body.params[k]);
      const v = cx.widen(cx.free(e, fn.ir.paramNames[k], t), p.lane);
      if (!isSubType(type(v), p))
        decline(
          e,
          `the input ${fn.ir.paramNames[k]} that ${e.operator} reads is not ${typeToString(p)} here`
        );
      return v;
    });
    // A list result of a run-time length: its length is a result of the
    // call before it, the length of the returned list.
    const n = fn.result.shape[0];
    const outs =
      typeof n === 'object' ? [b.newValue({ lane: 'integer', shape: [] })] : [];
    const out = b.newValue(
      outs.length > 0
        ? {
            lane: fn.result.lane,
            shape: [{ v: outs[0] }, ...fn.result.shape.slice(1)],
          }
        : fn.result
    );
    const all = [...args, ...inputs];
    if (self) fn.self.push(all);
    b.emit({ k: 'call', outs: [...outs, out], fn: fn.ir.name, args: all });
    const axis = cx.tuples.get(fn.ir.body.yields[0]);
    if (axis !== undefined) cx.tuples.set(out, axis);
    return out;
  };

  /** The call `e` of `fn` of the arguments `args`, some of them lists for
   *  its scalar parameters: as the interpreter maps it, a build of the
   *  calls of the elements at each index, zipped, and of the scalars and
   *  of the arguments of a list or point parameter, bound whole. The
   *  lists are flat and of one length (lists of different lengths give
   *  `incompatible-dimensions`), and the result of `fn` is a scalar. */
  const mapOver = (
    e: Fn,
    binding: { key: object; literal: Fn } | undefined,
    fn: UserFunction,
    args: V[]
  ): V => {
    if (pending.get(e.operator) === fn)
      decline(e, `a list argument of a recursive call of ${e.operator}`);
    const lengths = new Set<string | number>();
    const sources = args.map((v, i) => {
      const t = type(v);
      if (t.shape.length === 0 || fn.params[i].shape.length > 0)
        return undefined;
      if (t.shape.length > 1 || cx.tuples.has(v))
        decline(
          e,
          `a list argument of ${e.operator} that is not a flat list (the interpreter maps the function to the leaves of a nested list)`
        );
      lengths.add(
        typeof t.shape[0] === 'number' ? t.shape[0] : `${t.shape[0].v}`
      );
      return lists.listSource(v);
    });
    if (lengths.size > 1)
      decline(
        e,
        `list arguments of ${e.operator} whose lengths are not one value (lists of different lengths give incompatible-dimensions)`
      );
    const index = { length: sources.find((s) => s)!.length, at: (k: V) => k };
    return lists.over(
      e,
      index,
      '',
      (k) => {
        const out = call(
          e,
          binding,
          args.map((v, i) => sources[i]?.at(k) ?? v)
        );
        if (type(out).shape.length > 0)
          decline(
            e,
            `a list argument of ${e.operator}, whose result is not a scalar (the interpreter gives a list of lists)`
          );
        return out;
      },
      false,
      e
    );
  };

  /** The input `name` of the engine type `t` that the body of the function
   *  being lowered reads: a parameter after its own, which each call
   *  passes. */
  const capture = (e: Expression, name: string, t: Type): V => {
    const fn = pending.get(cx.inFunction!)!;
    if (fn.called)
      decline(
        e,
        `a recursive call of ${fn.ir.source}, which reads the input ${name} (a function on a cycle of calls through another function reads no input)`
      );
    // A scalar, or a list or a tuple (a point) of reals or integers of a
    // stated length.
    const ir = tupleOrInputType(isUntyped(t) ? 'unknown' : t, cx.wide);
    if (
      ir === undefined ||
      ir.shape.length > 1 ||
      (ir.shape.length === 1 &&
        (ir.shape[0] === 'run-time' || ir.lane === 'boolean'))
    )
      decline(
        e,
        `the function ${fn.ir.source} reads the input ${name} of type ${engineTypeToString(t)}, which is not a scalar or a list of numbers of a stated length`,
        hasUnsettledShape(t) ? UNSETTLED_SHAPE : undefined
      );
    const v = param(fn.ir, name, ir as IRType);
    if (tupleAxis(t) === 0) cx.tuples.set(v, 0);
    fn.inputs.push(t);
    cx.frames[0].names.set(name, { v, role: 'input' });
    return v;
  };

  return {
    call,
    capture,
    /** Whether `e`, which has no user binding of its own, is a recursive
     *  call of a function being lowered: its head is bound to the
     *  definition of that function, or it is a free call head
     *  (`isFreeCallHead()`) whose name resolves to it. A call bound to the
     *  library is not one; a call of that name with another binding
     *  declines. */
    recursive: (e: Fn): boolean => {
      const fn = pending.get(e.operator);
      if (fn === undefined || cx.isLibrary(e)) return false;
      if (e.valueDefinition === fn.key || e.operatorDefinition === fn.key)
        return true;
      // A free call head (`isFreeCallHead()`) reads its home chain.
      const resolved = isFreeCallHead(e) ? freeBinding(e) : undefined;
      if (
        resolved !== undefined &&
        ('operator' in resolved
          ? resolved.operator === fn.key
          : resolved.value === fn.key)
      )
        return true;
      decline(
        e,
        `a call of ${e.operator} whose binding is not the function ${e.operator} being compiled`
      );
    },
    /** The effect of the IR function `name`: effectful while it is not
     *  lowered (a function being lowered). */
    effect: (name: string): Effect => settled.get(name) ?? 'effectful',
    /** The count of the lowerings of a function begun. */
    begun: () => begun,
  };
}
