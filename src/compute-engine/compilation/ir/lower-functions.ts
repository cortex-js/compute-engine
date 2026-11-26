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

import type {
  ListType,
  TupleType,
  Type,
  TypeReference,
} from '../../../common/type/types.js';
import { typeToString as engineTypeToString } from '../../../common/type/serialize.js';
import { isSubtype } from '../../../common/type/subtype.js';
import type { BoxedValueDefinition, Expression } from '../../global-types.js';
import {
  freeBinding,
  isFreeCallHead,
  isFunction,
  isSymbol,
} from '../../boxed-expression/type-guards.js';
import {
  isSubLane,
  isSubType,
  sameShape,
  scalarType,
  typeToString,
  type IRFunction,
  type IRType,
  type Lane,
  type Length,
  type V,
} from './ir.js';
import { functionEffects, type Effect } from './effects.js';
import { arrayCells } from './lower-arrays.js';
import {
  coversListed,
  decline,
  hasUnsettledShape,
  isUntyped,
  LANE_MISMATCH,
  listedOf,
  tupleBody,
  UNSETTLED_SHAPE,
  type Binding,
  type Fn,
  type Listed,
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
 * type. With `strings`, a `string` or `character` scalar, or the element of
 * a list of rank 1, is a string (CE-1548).
 */
export function inputType(
  t: Type,
  wide: 'real' | 'complex' = 'real',
  strings = false
): { lane: Lane; shape: (number | 'run-time')[] } | undefined {
  const lane = (t: Type, element: boolean, rank: number): Lane | undefined => {
    t = present(t);
    if (
      strings &&
      rank <= 1 &&
      t !== 'never' &&
      (isSubtype(t, 'string') || isSubtype(t, 'character'))
    )
      return 'string';
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
  const l = lane(t, shape.length > 0, shape.length);
  return l === undefined ? undefined : { lane: l, shape };
}

/** The lane of the elements of a list of lists of integers or reals whose
 *  two lengths are not stated (`list<list<integer>>`), or `undefined`. On
 *  JavaScript such an input or parameter is the host's array of arrays,
 *  held whole on the lane `rows`: its rows can have different lengths, so
 *  the only reader of an element is `At(At(g, i), j)` (`rows.at`), and a
 *  call passes it whole to a parameter of such a type (README.md, "The
 *  rows lane"). An element of type `number` is a real, as the element of a
 *  list input is (`inputType()`), except where `wide` is `complex`: the
 *  host could pass a complex element there (CE-1721). */
export function rowsElementLane(
  t: Type,
  wide: 'real' | 'complex' = 'real'
): 'integer' | 'real' | undefined {
  const x = rowsElement(t);
  if (x === undefined || x === 'never' || x === 'unknown' || x === 'any')
    return undefined;
  if (x === 'number') return wide === 'real' ? 'real' : undefined;
  if (isSubtype(x, 'integer')) return 'integer';
  return isSubtype(x, 'real') ? 'real' : undefined;
}

/** `t` is a matrix type whose two dimensions are not stated (`matrix`,
 *  `matrix<real>`): a list of lists whose rows have one length, which the
 *  compiled code does not test (R5 of `docs/COMPILATION-MODEL.md`). On
 *  JavaScript it is read on the lane `rows` (`rowsElementLane()`), with the
 *  length of its first row as the length of every row (`rowWidths`): the
 *  operation `rows.width`, or for an input of the entry a parameter before
 *  it (`input()` of `lower.ts`). */
export function isFreeMatrix(t: Type): boolean {
  t = present(t);
  return (
    typeof t === 'object' &&
    t.kind === 'list' &&
    t.dimensions?.join() === '-1,-1'
  );
}

/** The type of the elements of a list of lists of two lengths not stated
 *  (also a matrix type of no stated dimensions, `isFreeMatrix()`), or
 *  `undefined`. */
function rowsElement(t: Type): Type | undefined {
  const free = (x: Type): x is ListType =>
    typeof x === 'object' &&
    x.kind === 'list' &&
    (x.dimensions === undefined || x.dimensions?.join() === '-1');
  t = present(t);
  if (isFreeMatrix(t)) return present((t as ListType).elements);
  if (!free(t)) return undefined;
  const inner = present(t.elements);
  return free(inner) ? present(inner.elements) : undefined;
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

/** The lane of each part of a tuple whose parts are not all scalars of
 *  one lane, a string or a list among them (`tuple<string, integer>`,
 *  `tuple<integer, list<list<integer>>>`), or `undefined`: a scalar of the
 *  lane `string`, `integer`, `real` or `boolean`, an integer among reals at
 *  one position of a union of tuples being a real; a list of reals or
 *  integers of a run-time length (`list`); a list of lists of two lengths
 *  not stated, of the lane `rows` (`rowsElementLane()`). On JavaScript such
 *  an input is read part by part (`partOf`), each part on its lane: the
 *  compiled code reads a part at a constant index only. */
export function tupleParts(
  t: Type,
  wide: 'real' | 'complex' = 'real'
): { lane: Lane; list: boolean }[] | undefined {
  const members = tupleMembers(present(t));
  if (members === undefined) return undefined;
  const n = members[0].elements.length;
  if (n === 0 || members.some((m) => m.elements.length !== n)) return undefined;
  const parts: { lane: Lane; list: boolean }[] = [];
  for (let j = 0; j < n; j++) {
    const at = new Set(
      members.map((m) => {
        const x = m.elements[j].type;
        if (x === 'unknown') return undefined;
        const rows = rowsElementLane(x, wide);
        if (rows !== undefined) return `rows ${rows}`;
        const ir = inputType(x, wide, true);
        if (ir?.shape.length === 0) return ir.lane;
        return ir?.shape.length === 1 &&
          ir.shape[0] === 'run-time' &&
          (ir.lane === 'integer' || ir.lane === 'real')
          ? `list ${ir.lane}`
          : undefined;
      })
    );
    const lane =
      at.size === 1
        ? [...at][0]
        : at.size === 2 && at.has('real') && at.has('integer')
          ? 'real'
          : at.size === 2 && at.has('list real') && at.has('list integer')
            ? 'list real'
            : undefined;
    if (lane === 'rows integer' || lane === 'rows real')
      parts.push({ lane: 'rows', list: false });
    else if (lane === 'list integer' || lane === 'list real')
      parts.push({ lane: lane.slice(5) as Lane, list: true });
    else if (
      lane === 'string' ||
      lane === 'integer' ||
      lane === 'real' ||
      lane === 'boolean'
    )
      parts.push({ lane, list: false });
    else return undefined;
  }
  return parts.some((p) => p.lane === 'string' || p.lane === 'rows' || p.list)
    ? parts
    : undefined;
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
  const ir = inputType(t, 'real', true);
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

/** The parameter names of a function literal, and its signature's types.
 *  `wide` is `cx.wide`: in `'real'` (`mode: 'strict'`), a result written
 *  `unknown` that the engine refined to a complex scalar is open.
 *  `implementation`: `literal` is the implementation of a protocol member
 *  (`lower-protocols.ts`), whose head `e` is the dispatcher: its result is
 *  the one that its body declares (`Typed(body, "boolean")`), in its own
 *  signature. */
function signatureTypes(
  e: Fn,
  literal: Fn,
  wide: 'real' | 'complex',
  implementation = false
) {
  const od = e.operatorDefinition as
    | {
        _isLambda?: boolean;
        inferredSignature?: boolean;
        _signatureSkeleton?: Type;
        signature?: { type: Type };
      }
    | undefined;
  const vd = od?._isLambda ? undefined : e.valueDefinition;
  const declared = od?._isLambda ? od.signature?.type : vd?.type.type;
  const signature =
    typeof declared === 'object' && declared.kind === 'signature'
      ? declared
      : undefined;
  // The signature as written, when its `unknown` slots are refined from the
  // body (`(real) -> unknown` reports `(real) -> complex`), on the value
  // definition or on the operator definition of a lambda.
  const written = od?._isLambda
    ? od.inferredSignature
      ? undefined
      : od._signatureSkeleton
    : vd !== undefined && !vd.inferredType
      ? vd._signatureSkeleton
      : undefined;
  // A rest parameter (`...args`, `Spread(args)`), the only parameter: it
  // holds the record of the arguments of each call (`call()`; CE-1652,
  // step 5).
  const spread = literal.ops.slice(1).findIndex((p) => isFunction(p, 'Spread'));
  const rest =
    spread === 0 && literal.nops === 2
      ? parameterName((literal.ops[1] as Fn).ops[0])
      : undefined;
  if (spread >= 0 && rest === undefined)
    decline(
      literal,
      `a rest parameter of ${e.operator} beside other parameters (only a function whose one parameter is the rest parameter compiles)`
    );
  const names =
    rest !== undefined
      ? [rest]
      : literal.ops.slice(1).map((p) => {
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
  // A parameter with a default (`Optional(k, 2)`) is the next one after
  // the required ones in the signature (`optArgs`); a call has its
  // argument, which the canonical form supplies.
  const slot = (s: Type, i: number) => {
    if (typeof s !== 'object' || s.kind !== 'signature') return undefined;
    const n = s.args?.length ?? 0;
    return (i < n ? s.args?.[i] : s.optArgs?.[i - n])?.type;
  };
  const own = literal.type.type;
  const annotated = (i: number) => {
    const p = literal.ops[i + 1];
    return (isFunction(p, 'Optional') ? p.ops[0] : p)?.operator === 'Typed'
      ? slot(own, i)
      : undefined;
  };
  const params = names.map((p, i) => {
    const d =
      rest !== undefined
        ? 'unknown'
        : ((signature && slot(signature, i)) ?? annotated(i) ?? 'unknown');
    // A parameter `broadcastable<T>` takes a `T`: a list there is mapped
    // (`listMapsAt()`).
    const t =
      typeof d === 'object' && d.kind === 'broadcastable' ? d.elements : d;
    // A list of lists of two lengths not stated: the host's rows, whole; a
    // matrix type states that they have one length (`width`).
    const element = rowsElementLane(t, wide);
    if (element !== undefined)
      return {
        lane: 'rows' as const,
        shape: [],
        element,
        ...(isFreeMatrix(t) ? { width: true } : {}),
      };
    // An array type: the parameter takes an array of those cells
    // (`held()`; `lower-arrays.ts`).
    if (arrayCells(t) !== undefined)
      return { lane: 'real' as const, shape: [], array: t };
    const list = tupleOrInputType(t);
    const s = inputType(t, 'real', true);
    const scalar = s?.shape.length === 0;
    return list !== undefined &&
      (list.shape.length === 1 || tupleAxis(t) === 1) &&
      (list.lane === 'real' || list.lane === 'integer')
      ? {
          ...list,
          tuple: tupleAxis(t),
          // A list of integers (not of tuples): the lane of a list of
          // reals that it binds whole (`laneKey()`, CE-1483).
          whole: list.lane === 'integer' && tupleAxis(t) === undefined,
        }
      : {
          lane: scalar ? s!.lane : 'real',
          shape: [],
          point: t === 'unknown' || !scalar ? t : undefined,
          // No stated type, or `number`: the lane of a scalar argument,
          // a real or a complex (`laneKey()`).
          open: present(t) === 'unknown' || present(t) === 'number',
          // No stated type, `any`, or a nominal tuple type: the type of a
          // record argument (`held()`); `true` for any record, else the
          // nominal type that the record must have.
          record: isUntyped(t)
            ? (true as const)
            : tupleBody(t) !== undefined
              ? (t as TypeReference)
              : undefined,
          // Of type `any`: also the lane of a number (`held()`).
          any: isUntyped(t) && present(t) !== 'unknown',
        };
  });
  // A user function declares its result as the type of its body
  // (`Typed(body, "boolean")`, also as the last statement of a `Block`).
  const typedBody =
    isFunction(literal.ops[0], 'Typed') ||
    (isFunction(literal.ops[0], 'Block') &&
      isFunction(literal.ops[0].ops.at(-1), 'Typed'));
  const r = implementation
    ? typedBody && typeof own === 'object' && own.kind === 'signature'
      ? present(own.result)
      : undefined
    : signature?.result && present(signature.result);
  // A list of reals, integers or booleans: the type of the body, whose
  // length can be a value of the body; or a tuple of them (a point), whose
  // body is a tuple; or a list of points (`tuple` is the axis of the mark).
  const ir = r === undefined ? undefined : tupleOrInputType(r);
  const tuple = r === undefined ? undefined : tupleAxis(r);
  const list = ir?.shape.length === 1 || tuple === 1 ? ir : undefined;
  // No stated result, or a tuple of elements of no stated type
  // (`tuple<unknown, unknown>`): the type of the body, a scalar or a point
  // of that many numbers (`points`). A `value` result (declared, or a
  // declared `unknown` that the engine narrowed to the type of a `Dot` of
  // open parameters) states no shape either: the body decides, as for `any`
  // (CE-1497). In `strict`, a result written `unknown` that the engine
  // refined to a complex scalar states no lane either: the body decides, so
  // a real body stays real, as it is in place (CE-1588).
  const refined = r === undefined ? undefined : inputType(r);
  const refinedComplex =
    wide === 'real' &&
    typeof written === 'object' &&
    written.kind === 'signature' &&
    loose(present(written.result)) &&
    refined?.lane === 'complex' &&
    refined.shape.length === 0;
  // A declared result `nothing` (`draw(...args) -> nothing`): the value is
  // the `Nothing` of the target, NaN on the real lane, which the code reads
  // only as the value of a call of the function in the places where a call
  // of a function of the host of result `nothing` is (`nothingPlace()` of
  // `lower.ts`; `define()`; CE-1652, step 5).
  const nothing = r === 'nothing';
  const open =
    r === undefined ||
    r === 'number' ||
    r === 'any' ||
    r === 'value' ||
    loose(r) ||
    refinedComplex;
  const points = list === undefined && r ? pointLength(r) : undefined;
  // A list of elements of no stated type: the shape of the body.
  const shaped = list === undefined && r ? openList(r) : undefined;
  // A list of lists of two lengths not stated (`list<list<integer>>`): the
  // body settles both lengths (a list of rank 2, not of the lane `rows`).
  // Of elements of type `any` (`list<list<any>>`, the type that the engine
  // gives a body whose elements read a parameter `g: list`), the body
  // settles their lane too: a real or an integer (CE-1721). An element of
  // no stated type (`unknown`, a body over an untyped parameter) is not
  // such a list: its shape is not settled.
  const grid =
    r === undefined
      ? undefined
      : (rowsElementLane(r, wide) ??
        (rowsElement(r) === 'any' ? 'real' : undefined));
  // Where the interpreter maps a call over a list argument: the signature
  // of the binding, or of the literal for a name declared `function`.
  const mapsAt = listMapsAt(signature ?? literal.type.type);
  const pointsAt = pointsMapAt(signature ?? literal.type.type);
  // A colour result is on the colour lane; a colour parameter declines.
  // Another result that is not a scalar (a named tuple type, a list of
  // several lanes) is the type of the body when the body is a record
  // (`record`), and declines otherwise (`define()`).
  const scalarResult = r === undefined ? undefined : inputType(r, 'real', true);
  const record =
    !nothing &&
    !open &&
    list === undefined &&
    points === undefined &&
    !shaped &&
    grid === undefined &&
    r !== 'color' &&
    (scalarResult === undefined || scalarResult.shape.length > 0);
  const result: IRType | undefined =
    open ||
    list !== undefined ||
    points !== undefined ||
    shaped ||
    grid !== undefined ||
    record
      ? undefined
      : r === 'color'
        ? { lane: 'color', shape: [] }
        : nothing
          ? { lane: 'real', shape: [] }
          : scalarOf(literal, r!, `the result of ${e.operator}`);
  return {
    names,
    rest: rest !== undefined,
    nothing,
    params,
    result,
    record,
    list,
    tuple,
    r,
    open,
    points,
    shaped,
    grid,
    mapsAt,
    pointsAt,
  };
}

/** Whether the interpreter maps a call of a user function of the signature
 *  `sig` over a list argument (not a tuple) at the parameter `i`, a list of
 *  points when `points`. Every parameter scalar (`paramsAreScalar()`): any
 *  list, to its leaves. Otherwise, with a parameter declared as a point
 *  (`pointListParamSlots()`): a list of points at a point parameter that
 *  is not an indexed one (`isIndexReadTuple()`), and any list at a
 *  parameter of a scalar type or of no stated type (user decision
 *  2026-10-24). The same plan holds a signature with a parameter of no
 *  stated type beside one that binds whole (`unknownBesideWholeParameters()`,
 *  CE-1697): a list maps at the first. Every other list binds whole. */
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

/** Whether the interpreter maps a call of a user function of the signature
 *  `sig` over a list of points at the parameter `i`, one point per call
 *  (`pointListParamSlots()`): a parameter declared as a point, not an
 *  indexed one, in a signature with no parameter `broadcastable<T>` and
 *  not all scalar (`listMapsAt()`). */
function pointsMapAt(sig: Type): (i: number) => boolean {
  if (broadcastableParamSlots(sig) !== undefined || paramsAreScalar(sig))
    return () => false;
  const plan = pointListParamSlots(sig);
  if (plan === undefined) return () => false;
  return (i) => {
    const slot = plan.at(i);
    return (
      slot.mappable &&
      slot.elements !== undefined &&
      isPointParameterType(slot.elements) &&
      !isIndexReadTuple(slot.elements)
    );
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
    /** Of the lane `rows`: the lane of the elements. */
    element?: 'integer' | 'real';
    /** Of the lane `rows` and of a matrix type (`isFreeMatrix()`): its rows
     *  have one length (`rowWidths`), and an argument must have the fact. */
    width?: boolean;
    /** The type of the argument that the parameter holds (`held()`): a
     *  record, with its fields. */
    type?: IRType;
  }[];
  /** The `Listed` of the argument of the first call at each parameter
   *  (CE-1652, step 5). */
  paramsListed: Listed[];
  /** A parameter or the declared result is a record: a recursive call
   *  declines (`call()`). */
  record: boolean;
  /** The declared result is `nothing` (CE-1652, step 5): a recursive call
   *  is read only where a call of such a function is (`nothingPlace()`). */
  nothing: boolean;
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
  /** The binding that the body reads for each of `inputs`: the
   *  definition of the occurrence, or none for a `vars` name. */
  defs: (BoxedValueDefinition | undefined)[];
  /** Each input of `inputs` that a parameter of the same name hides, by
   *  its name: a call in the body of a function that reads the input
   *  passes it (`free()` of `lower.ts`, CE-1502). */
  hidden: Map<string, V>;
  called: boolean;
  self: V[][];
  /** The first call of the function made while its body is lowered, when
   *  it has no declared result: the call assumed a real scalar. */
  guess?: Fn;
  /** The declared list or tuple result (`signatureTypes()`, `list`), of a
   *  stated or a run-time length, and the axis of its tuple mark: a call
   *  made while the body is lowered (a recursive call) has that type. */
  declared?: {
    lane: Lane;
    shape: readonly (number | 'run-time')[];
    tuple?: 0 | 1;
  };
  /** The first call that took `declared` while the body is lowered. */
  assumed?: Fn;
  /** The `Listed` of the value of the body, once it is lowered. */
  listed?: Listed;
  /** The calls made while the body is lowered (recursive calls), and
   *  whether every reader of each reads a list of NaN as an absent list
   *  (`call()`). */
  recursive: [call: Fn, nanForAbsent: () => boolean][];
  /** The variables of the engine that the root function literal assigns
   *  and that the body writes, itself or through its calls
   *  (`Lowering.stateOf()`, CE-1776): the IR function returns the record
   *  of the value of the body and of the value of each after the body,
   *  which a call reads (`call()`). */
  writes: readonly string[];
  /** The value of the body, before it is put in that record. */
  value?: V;
};

export function functionLowering(
  cx: Lowering,
  lists: ReturnType<typeof listLowering>,
  /** The target holds records and text (JavaScript, not the interval or
   *  the `bigint` mode). */
  javascript = false
) {
  const { b, type } = cx;
  /** The IR functions of each binding, one per lane key (`laneKey()`). */
  const functions = new Map<object, Map<string, UserFunction>>();
  const signatures = new Map<object, ReturnType<typeof signatureTypes>>();
  let count = 0;
  /** A parameter of no stated type, or of type `number`, that takes the
   *  complex lane of the scalar argument `v`; with any other argument the
   *  parameter is a real (an integer is widened). */
  const complexAt = (
    p: ReturnType<typeof signatureTypes>['params'][number],
    v: V | undefined
  ) =>
    // Only in `mode: 'complex'`: the strict mode declines a complex value
    // at a parameter of no stated type (a `LaneMismatch`).
    cx.wide === 'complex' &&
    'open' in p &&
    p.open &&
    v !== undefined &&
    type(v).shape.length === 0 &&
    type(v).lane === 'complex';
  /** A list parameter of integers (not of tuples) that takes the real lane
   *  of the list of reals `v`, which the interpreter binds whole with no
   *  check of its elements (CE-1483). */
  const realListAt = (
    p: ReturnType<typeof signatureTypes>['params'][number],
    v: V | undefined
  ) =>
    'whole' in p &&
    p.whole &&
    v !== undefined &&
    !cx.tuples.has(v) &&
    type(v).shape.length === 1 &&
    type(v).lane === 'real';
  /** The lanes of the open parameters at a call of the arguments `args`:
   *  one IR function per key, so that a call with a real and a call with a
   *  complex argument each call a function of the lane of its argument,
   *  and so do a call with a list of reals and a call with a list of
   *  integers at a list parameter of integers. */
  const laneKey = (
    sig: ReturnType<typeof signatureTypes>,
    args?: V[],
    ops?: readonly Expression[],
    name?: string
  ) =>
    sig.params
      .map((p, i) => {
        // A parameter that holds the type of its argument: one function
        // per type, a record by its nominal type and each field.
        const h = held(p, args?.[i], ops?.[i], name && `${name}#${i}`);
        if (h !== undefined) return `{${typeToString(h)}}`;
        // A point, or a flat list that binds whole, at a parameter that
        // takes the shape of its argument (`define()`): one function per
        // shape, beside the one of a scalar (CE-1652, step 4b).
        const v = args?.[i];
        const s = v === undefined ? undefined : type(v);
        const whole =
          v !== undefined && !cx.tuples.has(v) && !sig.mapsAt(i, false);
        const point =
          'point' in p &&
          p.point !== undefined &&
          s?.shape.length === 1 &&
          (cx.tuples.get(v!) === 0 || whole)
            ? `${cx.tuples.get(v!) === 0 ? 'p' : 'w'}${String(s.shape[0])}${s.lane === 'string' ? 's' : ''}`
            : '';
        return (
          (complexAt(p, args?.[i])
            ? 'c'
            : realListAt(p, args?.[i])
              ? 'l'
              : 'r') + point
        );
      })
      .join('');
  /** The type of the argument `v` that a parameter of no stated type, of
   *  type `any` or of a nominal tuple type holds (README, "Records"): a
   *  record; at a parameter of no stated type or `any`, also a string or
   *  a colour (JavaScript only); at a parameter of type `any`, also a real
   *  or an integer whose static type (of the argument `op`) proves its
   *  lane (CE-1652, step 4b). A string of a known value (`cx.known()`),
   *  there or at a parameter of type `string`, is a type of its own, which
   *  holds the value (`IRType.constant`; CE-1652, step 4c): one function
   *  per value, where the lowering keeps the constant at the parameter
   *  `place` (`cx.keepKnown()`). Otherwise `undefined`, the rules of
   *  today. */
  const held = (
    p: ReturnType<typeof signatureTypes>['params'][number],
    v: V | undefined,
    op?: Expression,
    place?: string
  ): IRType | undefined => {
    if (v === undefined) return undefined;
    const t = type(v);
    // A parameter of an array type takes an array of its cells only; one of
    // no stated type or of type `any` takes any array (`lower-arrays.ts`).
    if ('array' in p && p.array !== undefined) {
      const cells = arrayCells(p.array);
      if (typeof cells === 'string') decline(op ?? cx.root, cells);
      if (t.lane !== 'array' || t.array?.cell !== cells?.cell)
        decline(
          op ?? cx.root,
          `an argument of type ${typeToString(t)} for a parameter of type ${engineTypeToString(p.array)}`,
          LANE_MISMATCH
        );
      return t;
    }
    if (t.lane === 'array')
      return 'record' in p && p.record === true ? t : undefined;
    const text =
      javascript &&
      t.lane === 'string' &&
      t.shape.length === 0 &&
      !cx.tuples.has(v);
    if (!('record' in p) || p.record === undefined) {
      // A parameter of type `string`.
      const known =
        text && p.lane === 'string' && p.shape.length === 0 && place
          ? cx.keepKnown(v, place)
          : undefined;
      return known === undefined
        ? undefined
        : { lane: 'string', shape: [], constant: known };
    }
    if (t.lane === 'record') return t;
    if (
      !javascript ||
      p.record !== true ||
      t.shape.length > 0 ||
      cx.tuples.has(v)
    )
      return undefined;
    if (text) {
      const known = place ? cx.keepKnown(v, place) : undefined;
      return known === undefined
        ? { lane: 'string', shape: [] }
        : { lane: 'string', shape: [], constant: known };
    }
    if (t.lane === 'color' || t.lane === 'nothing')
      return { lane: t.lane, shape: [] };
    // A number at `any`: the lane that its static type proves, or that a
    // parameter of this kind holds, so that a test of its type in the body
    // is decided by the lane (`matchesType()` of `lower-match.ts`). A
    // parameter of no stated type keeps the real lane of today.
    return 'any' in p &&
      p.any &&
      (t.lane === 'real' || t.lane === 'integer') &&
      (cx.heldParams.has(v) ||
        (op !== undefined && isSubtype(op.type.type, t.lane)))
      ? { lane: t.lane, shape: [] }
      : undefined;
  };
  /** A call `e` of a function of the binding `key` (or of the function
   *  `fn` when it has none) while a function of it is being lowered: a
   *  recursive call. It declines when a function on the cycle of calls
   *  has a record parameter or result, or when the arguments `args` hold
   *  a record: the type of a record on a cycle is a fixed point that the
   *  lowering does not compute (and a record that grows at each call
   *  would lower a new function at each). */
  const recordCycle = (
    e: Fn,
    on: UserFunction[],
    sig?: ReturnType<typeof signatureTypes>,
    args?: V[]
  ) => {
    if (on.length === 0) return;
    const stack = [...lowering];
    const from = Math.min(...on.map((f) => stack.indexOf(f)));
    const cycle = stack.slice(from);
    if (
      cycle.some((f) => f.record) ||
      (sig !== undefined &&
        sig.params.some((p, i) => held(p, args?.[i])?.lane === 'record'))
    )
      decline(
        e,
        `a recursive call of ${e.operator}, on a cycle of calls with a record parameter or result (the type of a record on a cycle of calls is not computed)`
      );
  };
  /** The functions being lowered, by the name of their head: a call of
   *  that name in the body is the recursive call (its node can be bound
   *  before the definition is). */
  const pending = new Map<string, UserFunction>();
  /** Every function being lowered, also a lane of a binding that another
   *  lane of it hides in `pending` (`laneKey()`). */
  const lowering = new Set<UserFunction>();
  let settled = new Map<string, Effect>();
  // The lowerings of a function begun (`cx.attempt()`).
  let begun = 0;
  // The depth of the calls of `mapOver()` (CE-1776).
  let mapping = 0;
  const noResult = (call: Fn): never =>
    decline(
      call,
      `a recursive call of ${call.operator}, which has no declared result type (declare it, as (real) -> real or (real) -> complex)`
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
    args: V[] | undefined,
    nanForAbsent: () => boolean
  ): UserFunction => {
    begun += 1;
    const {
      names,
      result,
      record,
      list,
      tuple,
      r,
      open,
      points,
      shaped,
      grid,
    } = sig;
    const params = sig.params.map((declared, i) => {
      // A record (or, at a parameter of no stated type or `any`, a string
      // or a colour): the parameter has the type of the argument, and the
      // function is lowered once per such type (`laneKey()`).
      const h = held(declared, args?.[i], e.ops[i], `${e.operator}#${i}`);
      if (h === undefined && 'array' in declared && declared.array)
        decline(e, `the parameter ${names[i]} of an array type, with no array`);
      if (h !== undefined) {
        // A parameter of a nominal tuple type takes a record of that type
        // only, or of a type that the static type of the argument proves
        // a subtype of it (R5).
        const nominal = (declared as { record?: true | TypeReference }).record;
        const s = e.ops[i]?.type.type;
        if (
          typeof nominal === 'object' &&
          h.nominal !== nominal.name &&
          !(
            typeof s === 'object' &&
            s.kind === 'reference' &&
            s.name === h.nominal &&
            isSubtype(s, nominal)
          )
        )
          decline(
            e.ops[i] ?? e,
            `an argument of ${e.operator} for the parameter ${names[i]} of type ${nominal.name} that is ${h.nominal === undefined ? 'a record of no named type' : `a record of the type ${h.nominal}`}`
          );
        return { lane: h.lane, shape: [], type: h };
      }
      if (complexAt(declared, args?.[i]))
        return { ...declared, lane: 'complex' as const };
      // A list of reals at a list parameter of integers: on the real lane.
      const p = realListAt(declared, args?.[i])
        ? { ...declared, lane: 'real' as const }
        : declared;
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
      // A list of lists of two lengths not stated, bound whole (`rowsAt()`):
      // the parameter is of the lane `rows`, of the lane of the elements of
      // the argument of the first call.
      if (t?.lane === 'rows' && rowsAt(sig, i, e.ops[i]))
        return {
          lane: 'rows' as const,
          shape: [],
          element: cx.rowsElements.get(v!) ?? cx.rowsLaneOf(e.ops[i])!,
        };
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
        (t.lane === 'real' ||
          t.lane === 'integer' ||
          // A list of strings (JavaScript only; CE-1652, step 4b).
          (javascript && t.lane === 'string'))
      )
        return {
          lane: t.lane === 'string' ? t.lane : p.lane,
          shape: [n],
          taken: names[i],
        };
      if (p.point !== 'unknown')
        scalarOf(
          literal,
          p.point,
          `the parameter ${names[i]} of ${e.operator}`
        );
      return p;
    });
    // The variables of the engine that the body reads or writes (CE-1776).
    const state = cx.stateOf(key);
    const ir: IRFunction = {
      name: `u${count++}_${e.operator.replace(/[^A-Za-z0-9]/g, '')}`,
      source: e.operator,
      paramNames: [],
      lengthOf: [],
      body: { params: [], body: [], yields: [] },
      results: [],
    };
    const paramsListed: Listed[] = params.map(() => true);
    const values = params.map((t, i) => {
      const shape = t.shape.map((n) =>
        n === 'run-time'
          ? { v: param(ir, names[i], { lane: 'integer', shape: [] }, true) }
          : n
      );
      // A string of a known value: the parameter is that value
      // (`cx.holdKnown()`); its type does not hold it.
      const { constant, ...paramType } =
        'type' in t && t.type !== undefined ? t.type : { lane: t.lane, shape };
      const v = param(ir, names[i], paramType);
      if (constant !== undefined)
        cx.holdKnown(v, constant, `${e.operator}#${i}`);
      if (paramType.lane === 'string' && paramType.shape.length === 0)
        cx.mayHoldKnown(v);
      if ('tuple' in t && t.tuple !== undefined) cx.tuples.set(v, t.tuple);
      if (t.lane === 'rows') cx.rowsParams.add(v);
      // A list, a tuple or a record: the `Listed` of the argument of the
      // first call, which a later call must cover (`call()`).
      if (paramType.shape.length > 0 || paramType.lane === 'record') {
        const listed = args?.[i] === undefined ? false : listedOf(cx, args[i]);
        cx.listed.set(v, listed);
        paramsListed[i] = listed;
      }
      // Of the type of its argument: `x is T` reads its IR type. So does a
      // point, a list of points or a flat list at a parameter that takes
      // the shape of its argument: each call gives that shape (`laneKey()`,
      // `call()`).
      const declared = sig.params[i];
      if (
        ('type' in t && t.type !== undefined) ||
        ('taken' in t &&
          t.taken !== undefined &&
          'point' in declared &&
          declared.point !== undefined)
      )
        cx.heldParams.add(v);
      if ('element' in t && t.element !== undefined)
        cx.rowsElements.set(v, t.element);
      return v;
    });
    const fn: UserFunction = {
      key,
      params,
      own: (ir.lifted = ir.body.params.length),
      paramsListed,
      result,
      record: record || params.some((p) => p.lane === 'record'),
      nothing: sig.nothing,
      list:
        list !== undefined ||
        points !== undefined ||
        shaped !== undefined ||
        grid !== undefined,
      mapsAt: sig.mapsAt,
      ir,
      inputs: [],
      defs: [],
      hidden: new Map(),
      called: false,
      self: [],
      declared: list && { lane: list.lane, shape: list.shape, tuple },
      recursive: [],
      writes: state.writes,
    };
    let variants = functions.get(key);
    if (variants === undefined) functions.set(key, (variants = new Map()));
    // While the body is lowered, the function is the one of the lane
    // (`call()`); after, the one of its kind of call, or of both kinds.
    const lane = laneKey(sig, args, e.ops, e.operator);
    variants.set(lane + '?', fn);
    // The function of this name being lowered, if any (another lane of
    // the same binding, `laneKey()`): restored after this one.
    const before = pending.get(e.operator);
    pending.set(e.operator, fn);
    lowering.add(fn);
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
    const callerWrites = cx.stateWrites;
    cx.stateWrites = fn.writes;
    // The kind of the call is found only where the body relies on it. A
    // kind that depends on itself (a call of another lane in the body, whose
    // readers lead back to the body) is `false`.
    const prior = cx.bodies.get(literal.ops[0]);
    let nan: boolean | undefined;
    const reads = {
      nan: () => {
        if (nan === undefined) {
          nan = false;
          nan = nanForAbsent();
        }
        return nan;
      },
      read: false,
    };
    cx.bodies.set(literal.ops[0], reads);
    const scope = literal.localScope;
    if (scope !== undefined) cx.scopes.push(scope);
    try {
      b.define(ir, () => {
        // A parameter of a matrix type: the length of its rows, made at the
        // start of the body so that every region of it reads one value.
        params.forEach((t, i) => {
          if ('width' in t && t.width === true)
            cx.rowWidths.set(
              values[i],
              b.op('rows.width', [values[i]], scalarType('integer'))
            );
        });
        // Each variable of the engine that the body reads or writes is an
        // input from the start of the body, so that a write in an arm
        // rebinds a binding of the frame (`arm()` of `lower.ts`).
        for (const s of state.uses) {
          cx.free(e, s.name, s.definition.type.type, s.definition);
          cx.frames[0].names.get(s.name)!.lane = s.lane;
        }
        // The value of the body, and of each variable that it writes.
        const out = (v: V): V[] => {
          fn.value = v;
          if (fn.writes.length === 0) return [v];
          if (fn.self.length > 0 || fn.called || fn.recursive.length > 0)
            decline(
              literal,
              state.host === undefined
                ? `a recursive function ${e.operator} that assigns the variable ${fn.writes[0]} of the engine`
                : `a recursive function ${e.operator}, or one on a cycle of calls, that calls the function ${state.host} of the host, in a function that assigns the variable ${fn.writes[0]} of the engine`
            );
          return [
            cx.pack(literal, [
              v,
              ...fn.writes.map((n) => cx.frames[0].names.get(n)!.v),
            ]),
          ];
        };
        // A declared result `nothing`: the body is lowered for its effects
        // and the value is the `Nothing` of the target, NaN, whatever the
        // body computes. The interpreter gives `Nothing` only where the
        // last statement is an `Assign` or a `Declare`, or of the static
        // type `nothing` (a call of a function of result `nothing`, a loop,
        // an `If` of such branches); for another value it gives an
        // `incompatible-type` error, and the function declines.
        if (sig.nothing) {
          const x = literal.ops[0];
          const last =
            isFunction(x, 'Block') && x.nops > 0 ? x.ops[x.nops - 1] : x;
          const v = isFunction(last, 'Typed') ? last.ops[0] : last;
          if (
            !isFunction(v, 'Assign') &&
            !isFunction(v, 'Declare') &&
            !isSubtype(v.type.type, 'nothing')
          )
            decline(
              literal,
              `a body of ${e.operator} whose value is not Nothing, its declared result`
            );
          cx.value(x, false);
          return out(b.constant(NaN, 'real'));
        }
        // A list of lists of two lengths not stated is read whole: a body of
        // run-time inner lengths is of the lane `rows` (CE-1736).
        const body =
          grid !== undefined
            ? cx.wholeRows(literal.ops[0])
            : list || open || points !== undefined || shaped || record
              ? cx.value(literal.ops[0])!
              : cx.scalar(literal.ops[0]);
        const t = type(body);
        // A result that is not a scalar: a record, of the nominal type of
        // the result type when it is one.
        if (record) {
          if (t.lane !== 'record')
            scalarOf(literal, r!, `the result of ${e.operator}`);
          const nominal = tupleBody(r!) && (r as TypeReference).name;
          if (nominal !== undefined && t.nominal !== nominal)
            decline(
              literal,
              `a body of ${e.operator} that is not ${engineTypeToString(r!)}`
            );
          // A structural result type with field names: a record of those
          // names, in that order.
          const elements =
            typeof r === 'object' && r.kind === 'tuple' ? r.elements : [];
          if (
            elements.some((x) => x.name !== undefined) &&
            (t.names?.length !== elements.length ||
              elements.some((x, k) => x.name !== t.names![k]))
          )
            decline(
              literal,
              `a body of ${e.operator} that is not a record of the field names of ${engineTypeToString(r!)}`
            );
        }
        // A list of lists of two lengths not stated: a list of rank 2 of
        // the lengths that the body settles, or of the lane `rows` whose
        // elements are of the lane of the result (CE-1736).
        const rows = t.lane === 'rows' ? cx.rowsElements.get(body) : undefined;
        if (
          grid !== undefined &&
          (rows !== undefined
            ? !isSubLane(rows, grid)
            : t.shape.length !== 2 ||
              cx.tuples.has(body) ||
              !isSubLane(t.lane, grid))
        )
          decline(
            literal,
            `a body of ${e.operator} that is not ${engineTypeToString(r!)} of lengths that the body settles`
          );
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
        // A recursive call took the declared result (`call()`): of a
        // run-time length, it has a length result, so the body's length is
        // a run-time value too.
        const m = t.shape[0];
        if (
          fn.assumed &&
          list?.shape[0] === 'run-time' &&
          (typeof m === 'number' ||
            (m !== undefined && cx.constant(m.v) !== undefined))
        )
          decline(
            literal,
            `a body of ${e.operator} of a constant length, where its recursive call takes a list of a run-time length (declare the length in the result type)`
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
        // A row at an index known at run time (`cx.rowLengths`): out of
        // range, a list of no element where the interpreter gives
        // `Missing`, which a call would not tell apart.
        const n = type(v).shape[0];
        if (n !== undefined && typeof n !== 'number' && cx.rowLengths.has(n.v))
          decline(
            literal,
            `a row at an index known at run time as the result of ${e.operator}`
          );
        return out(v);
      });
      // A body that relies on a list of NaN for its absent value cannot
      // serve its recursive call whose reader tells the two apart.
      if (reads.read && reads.nan())
        for (const [c, alike] of fn.recursive)
          if (!alike())
            decline(
              c,
              `a recursive call of ${e.operator} whose value can be an absent list, read by other than At, First, Last, an arithmetic operator or a reduction`
            );
    } finally {
      if (scope !== undefined) cx.scopes.pop();
      cx.frames.splice(0, cx.frames.length, ...outer);
      cx.inFunction = caller;
      cx.stateWrites = callerWrites;
      if (prior === undefined) cx.bodies.delete(literal.ops[0]);
      else cx.bodies.set(literal.ops[0], prior);
    }
    // A body whose lowering did not rely on the kind of its call serves
    // both kinds.
    variants.delete(lane + '?');
    for (const k of reads.read
      ? [lane + (reads.nan() ? 'n' : '')]
      : [lane, lane + 'n'])
      if (!variants.has(k)) variants.set(k, fn);
    // A length value of the body that is a constant is its number: a call
    // then has one result of that length. The constant 0 (the empty list
    // of an outer variable) stays a length value: a stated length is at
    // least 1.
    if (fn.result === undefined) {
      const t = type(fn.value!);
      fn.result = {
        ...t,
        // On the declared lane where a recursive call took it.
        lane: fn.assumed ? fn.declared!.lane : t.lane,
        shape: t.shape.map((n) => {
          if (typeof n === 'number') return n;
          const c = cx.constant(n.v);
          return c !== undefined && c > 0 ? c : n;
        }),
      };
    }
    ir.results.push(
      fn.writes.length > 0 ? type(ir.body.yields[0]) : fn.result
    );
    if (!fn.guess && !fn.assumed) fn.listed = listedOf(cx, fn.value!);
    // A call in the body passes the inputs, parameters of the body.
    for (const a of fn.self) a.push(...ir.body.params.slice(fn.own));
    if (before === undefined) pending.delete(e.operator);
    else pending.set(e.operator, before);
    lowering.delete(fn);
    // A `Comprehension` in the body of a function being lowered reads the
    // effect of a function it calls (`flips` in `moves`).
    settled = functionEffects(cx.rows, b.functions);
    return fn;
  };

  /** The argument `op` of a call, for a parameter of the lane `lane`: at a
   *  parameter of the lane `rows`, a read that may take a value of that
   *  lane whole (`Lowering.wholeRows()`). */
  const argument = (op: Expression, lane: Lane | undefined): V =>
    lane === 'rows' ? cx.wholeRows(op) : cx.value(op)!;

  /** Whether the parameter `i` of `sig`, of a type that states no lane
   *  (`list`, no stated type: `point`), takes the argument `op` of a list
   *  of lists of two lengths not stated whole, as a parameter of the lane
   *  `rows` does (CE-1721): the type of `op` is within the declared type
   *  and the interpreter binds it whole (`listMapsAt()`). */
  const rowsAt = (
    sig: ReturnType<typeof signatureTypes>,
    i: number,
    op: Expression
  ): boolean => {
    const p = sig.params[i];
    if (p === undefined || !('point' in p) || p.point === undefined)
      return false;
    const t = op.type.type;
    return (
      !sig.mapsAt(i, false) &&
      cx.rowsLaneOf(op) !== undefined &&
      (p.point === 'unknown' || isSubtype(t, p.point))
    );
  };

  /** The signature of the user function of `binding` (`signatureTypes()`),
   *  computed once per binding. */
  const signatureOf = (
    e: Fn,
    binding: { key: object; literal: Fn; implementation?: boolean }
  ) => {
    let sig = signatures.get(binding.key);
    if (sig === undefined) {
      sig = signatureTypes(e, binding.literal, cx.wide, binding.implementation);
      signatures.set(binding.key, sig);
    }
    return sig;
  };

  /** The record of the values `values` of the arguments of the call `e` of
   *  a function with a rest parameter, the `Tuple` to which the interpreter
   *  binds the parameter (`IRType.head`; CE-1652, step 5). As
   *  for a record that a constructor makes (`make()` of
   *  `lower-records.ts`), a field of a run-time length or of the lane
   *  `rows` declines. */
  const restRecord = (e: Fn, values: V[]): V => {
    const fields = values.map((v): IRType => {
      const t = type(v);
      const shape = t.shape.map((n) =>
        typeof n === 'number' ? n : (cx.constant(n.v) ?? n)
      );
      if (t.lane === 'rows' || shape.some((n) => typeof n !== 'number'))
        decline(
          e,
          `an argument of ${e.operator} for its rest parameter that is a list of a run-time length`
        );
      return { ...t, shape };
    });
    const v = b.list(values, {
      lane: 'record',
      shape: [],
      fields,
      marks: values.map((v) => cx.tuples.get(v)),
      head: 'Tuple',
    });
    cx.listed.set(
      v,
      values.map((x) => listedOf(cx, x))
    );
    return v;
  };

  /** A call of the user function that the head of `e` resolves to, or of
   *  the function of that name being lowered; with `given`, of the values
   *  of its arguments, already lowered. `nanForAbsent`: every reader of
   *  the value of `e` reads a list of NaN as an absent list. A body that
   *  holds an `If` with no else has one IR function for such calls and one
   *  for the others, where the `If` declines (`conditional()` of
   *  `lower.ts`). */
  const call = (
    e: Fn,
    binding?: { key: object; literal: Fn; implementation?: boolean },
    given?: V[],
    nanForAbsent: () => boolean = () => false
  ): number => {
    let fn = (binding ? undefined : pending.get(e.operator)) as UserFunction;
    // Without run-time lengths, the arguments of the first call are lowered
    // before the function, which takes their stated lengths; so are they
    // for a parameter that can take the point of its argument, and at each
    // call for a parameter that takes the lane of its argument
    // (`laneKey()`).
    let early = given;
    // The arguments, one per parameter: for a rest parameter, the call
    // itself stands for the record of its arguments.
    let ops: readonly Expression[] = e.ops;
    if (binding !== undefined) {
      const sig = signatureOf(e, binding);
      // A rest parameter: the record of the arguments of this call, each
      // lowered in order, its length and the IR type of each element known
      // here; the function is lowered once per such record type
      // (`laneKey()`; CE-1652, step 5).
      if (sig.rest) {
        if (!javascript || given !== undefined)
          decline(
            e,
            `a call of ${e.operator}, a function with a rest parameter: records compile on javascript only`
          );
        early = [
          restRecord(
            e,
            e.ops.map((op) =>
              isSymbol(op, 'Nothing')
                ? b.op('nothing', [], { lane: 'nothing', shape: [] })
                : cx.value(op)!
            )
          ),
        ];
        ops = [e];
      }
      // A parameter declared as a point maps a list of points
      // (`pointsMapAt()`): its arguments are lowered first to tell.
      const pointsAt = sig.params.some((_, i) => sig.pointsAt(i));
      if (
        early === undefined &&
        (pointsAt ||
          sig.params.some(
            (p) =>
              ('open' in p && p.open) ||
              ('whole' in p && p.whole) ||
              // A parameter that can hold a record (`held()`).
              ('record' in p && p.record !== undefined) ||
              // A parameter of an array type, which takes the IR type of
              // its argument, an array of its cells (`held()`).
              ('array' in p && p.array !== undefined) ||
              // A parameter that takes the shape of its argument, one
              // function per shape (`laneKey()`; CE-1652, step 4b).
              ('point' in p && p.point !== undefined) ||
              // A parameter of type `string`, one function per known
              // value (`held()`; CE-1652, step 4c), where the lowering
              // keeps the constants.
              (cx.keepsStrings &&
                p.lane === 'string' &&
                p.shape.length === 0) ||
              (!functions.has(binding.key) &&
                !cx.runtimeLengths &&
                p.shape[0] === 'run-time')
          ))
      )
        early = e.ops.map((op, i) => {
          // `Nothing` at a parameter of no stated type or of type `any`: a
          // value of the type `nothing`, which the parameter holds
          // (`held()`; CE-1652, step 4b).
          const p = sig.params[i];
          return javascript &&
            isSymbol(op, 'Nothing') &&
            p !== undefined &&
            'record' in p &&
            p.record === true
            ? b.op('nothing', [], { lane: 'nothing', shape: [] })
            : argument(op, rowsAt(sig, i, op) ? 'rows' : p?.lane);
        });
      // A list of points there: the call maps, one point per call, each
      // other argument as at any mapped call (`mapOver()`).
      const lowered = early;
      if (
        given === undefined &&
        pointsAt &&
        lowered !== undefined &&
        lowered.some((v, i) => sig.pointsAt(i) && cx.tuples.get(v) === 1)
      ) {
        // An argument whose static type settles no shape (`unknown`) where
        // the call maps: the interpreter pairs it with the points when it
        // is a list and binds it whole otherwise (R3).
        e.ops.forEach((op, i) => {
          if (
            (sig.pointsAt(i) || sig.mapsAt(i, false)) &&
            hasUnsettledShape(op.type.type)
          )
            decline(
              op,
              `an argument of ${e.operator} of type ${engineTypeToString(op.type.type)} beside a list of points (the interpreter pairs it with the points when it is a list)`,
              UNSETTLED_SHAPE
            );
        });
        return mapOver(
          e,
          binding,
          [...(functions.get(binding.key)?.values() ?? [])].some((f) =>
            lowering.has(f)
          ),
          lowered,
          (i) => {
            const v = lowered[i];
            const t = type(v);
            if (sig.pointsAt(i) && cx.tuples.get(v) === 1) return 'points';
            return t.shape.length > 0 &&
              !cx.tuples.has(v) &&
              sig.mapsAt(i, false)
              ? 'list'
              : undefined;
          }
        );
      }
      // A list of elements of two lanes (a record, `lower.ts`) at a
      // parameter that the interpreter maps over a list: the interpreter
      // maps the function over the elements, the parameter would hold the
      // record whole. A tuple binds whole.
      if (lowered !== undefined && !sig.rest)
        e.ops.forEach((op, i) => {
          const s = op.type.type;
          if (
            type(lowered[i]).lane === 'record' &&
            sig.mapsAt(i, false) &&
            (s === 'list' || (typeof s === 'object' && s.kind === 'list'))
          )
            decline(
              op,
              `a list of elements of two types given to the parameter ${sig.names[i]} of ${e.operator}, which maps over a list (the interpreter maps the function over the list)`
            );
        });
      // A call in the body being lowered (a recursive call) calls that IR
      // function, whatever its reader (`tells`); another call calls the one
      // for its kind of reader (`define()`). An argument can hold the first
      // call of the same function.
      const variants = functions.get(binding.key);
      // A call while a function of the binding is being lowered, before a
      // function of another record type would be lowered for it.
      recordCycle(
        e,
        [...(variants?.values() ?? [])].filter((f) => lowering.has(f)),
        sig,
        early
      );
      const lane = laneKey(sig, early, e.ops, e.operator);
      const both = variants?.get(lane);
      fn = variants?.get(lane + '?') as UserFunction;
      if (fn === undefined)
        if (variants?.get(lane + 'n') === both)
          fn =
            both ??
            define(e, binding.key, binding.literal, sig, early, nanForAbsent);
        else {
          const nan = nanForAbsent();
          fn =
            variants?.get(lane + (nan ? 'n' : '')) ??
            define(e, binding.key, binding.literal, sig, early, () => nan);
        }
    }
    if (lowering.has(fn)) {
      recordCycle(e, [fn]);
      fn.recursive.push([e, nanForAbsent]);
    }
    if (ops.length !== fn.params.length)
      decline(e, `${e.operator} with ${e.nops} arguments`);
    // A call back to a lane of the function that another lane of it hides
    // (a body of the complex lane that calls the real one, still being
    // lowered): its inputs are not settled yet.
    if (lowering.has(fn) && pending.get(e.operator) !== fn)
      decline(
        e,
        `a recursive call of ${e.operator} between the lanes of its parameters`
      );
    // Each argument is lowered once, in order; `mapped`, a list for a
    // scalar parameter, which the call maps over (`mapOver()`).
    const values: V[] = [];
    let mapped = false;
    const args = ops.flatMap((op, i) => {
      const p = fn.params[i];
      values.push(early?.[i] ?? argument(op, p?.lane));
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
      // A parameter of a matrix type takes a list of rank 2 as its rows
      // (`matrixRows()`), whose rows have its stated length.
      if (p.width === true && type(values[i]).lane !== 'rows')
        values[i] = lists.matrixRows(e, values[i]) ?? values[i];
      // A parameter of the lane `rows` takes a list of lists of run-time
      // length only.
      if (p.lane === 'rows' && type(values[i]).lane !== 'rows')
        decline(
          op,
          `an argument of ${e.operator} for the parameter ${i + 1}, a list of lists of two lengths not stated, that is not a list of lists of run-time length`
        );
      // A parameter of a matrix type takes a value whose rows have one
      // length only: the interpreter gives `incompatible-type` for rows of
      // different lengths.
      if (p.width === true && !cx.rowWidths.has(values[i]))
        decline(
          op,
          `an argument of ${e.operator} for the parameter ${i + 1}, a matrix, whose rows can have different lengths`
        );
      // The lane does not hold the lane of the elements: a list of lists of
      // reals at a parameter of lists of integers would put a real on the
      // integer lane (`rows.at.int`).
      if (
        p.lane === 'rows' &&
        p.element === 'integer' &&
        (cx.rowsElements.get(values[i]) ?? cx.rowsLaneOf(op)) !== 'integer'
      )
        decline(
          op,
          `an argument of ${e.operator} of type ${engineTypeToString(op.type.type)} for the parameter ${i + 1} of lists of integers`
        );
      const v = cx.widen(values[i], p.lane);
      const t = type(v);
      if (
        p.tuple === 0 &&
        p.taken !== undefined &&
        (cx.tuples.get(v) !== 0 || t.shape[0] !== p.shape[0])
      )
        decline(
          op,
          `an argument of ${e.operator} of another shape than at its first call: the parameter ${p.taken} is a point of ${p.shape[0]} numbers (${typeToString(t, cx.tuples.get(v) ?? -1)} here)`
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
          `an argument of ${e.operator} of another shape than at its first call: the parameter ${p.taken} is a list of points of ${p.shape[1]} numbers (${typeToString(t, cx.tuples.get(v) ?? -1)} here)`
        );
      if (
        p.taken !== undefined &&
        typeof p.shape[0] === 'number' &&
        t.shape.length > 0 &&
        t.shape[0] !== p.shape[0]
      )
        decline(
          op,
          `an argument of ${e.operator} of another length than at its first call: the list parameter ${p.taken} has the length ${p.shape[0]} of that call (${typeof t.shape[0] === 'number' ? typeToString(t, -1) : 'a list of no stated length'} here${cx.runtimeLengths ? '' : '; a target without run-time lengths'})`
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
      const declared = (p.type ?? {
        lane: p.lane,
        shape: p.shape.map((m) => (m === 'run-time' ? n : m)),
      }) as IRType;
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
          `an argument of ${e.operator} that is not ${typeToString(declared, p.tuple ?? -1)}`,
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
      // A function lowered for a listed argument (`Listed`) takes a
      // listed argument only, in a lowering that tracks it.
      if (
        cx.trackListed &&
        !coversListed(listedOf(cx, values[i]), fn.paramsListed[i] ?? false)
      )
        decline(
          op,
          `an argument of ${e.operator} that the interpreter can hold as a lazy collection where the argument of its first call is a List or a Tuple literal`
        );
      // The function lowered for a known string (`held()`) takes that
      // string only: a recursive call, which takes the function being
      // lowered, with another string declines (`isSubType()` does not
      // compare the constant of a string).
      if (declared.constant !== undefined && cx.known(v) !== declared.constant)
        decline(
          op,
          `an argument of ${e.operator} that is not the string "${declared.constant}" of the function being lowered`
        );
      return [...length, v];
    });
    if (mapped) {
      // An argument whose static type settles no shape (`unknown`) at a
      // slot where the call maps: the interpreter zips it with the list
      // when it is a list and binds it whole otherwise (R3), as beside a
      // list of points above.
      e.ops.forEach((op, i) => {
        if (
          fn.params[i].shape.length === 0 &&
          fn.mapsAt(i, false) &&
          hasUnsettledShape(op.type.type)
        )
          decline(
            op,
            `an argument of ${e.operator} of type ${engineTypeToString(op.type.type)} beside a list that the call maps over (the interpreter zips it with the list when it is a list)`,
            UNSETTLED_SHAPE
          );
      });
    }
    if (mapped)
      return mapOver(e, binding, lowering.has(fn), values, (i) =>
        type(values[i]).shape.length > 0 && fn.params[i].shape.length === 0
          ? 'list'
          : undefined
      );
    // A call of a function whose body is being lowered (on a cycle of
    // calls) with no declared result assumes a real scalar, which
    // `define()` checks against the body; a declared list or tuple result
    // is the type of the call, which `define()` checks against the body;
    // a list or tuple result of no stated type declines.
    let result:
      | {
          lane: Lane;
          shape: readonly (Length | 'run-time')[];
        }
      | undefined = fn.result;
    if (result === undefined && fn.list) {
      if (fn.declared === undefined)
        decline(
          e,
          `a recursive call of ${e.operator}, a function with a list or tuple result of no stated type`
        );
      fn.assumed ??= e;
      result = fn.declared;
    }
    if (result === undefined) {
      fn.guess = e;
      result = fn.result = { lane: 'real', shape: [] };
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
      const v = cx.widen(
        cx.free(e, fn.ir.paramNames[k], t, fn.defs[j]),
        p.lane
      );
      if (!isSubType(type(v), p))
        decline(
          e,
          `the input ${fn.ir.paramNames[k]} that ${e.operator} reads is not ${typeToString(p, -1)} here`
        );
      return v;
    });
    // A list result of a run-time length: its length is a result of the
    // call before it, the length of the returned list.
    const n = result.shape[0];
    const outs =
      typeof n === 'object' || n === 'run-time'
        ? [b.newValue({ lane: 'integer', shape: [] })]
        : [];
    const out = b.newValue(
      outs.length > 0
        ? {
            lane: result.lane,
            shape: [{ v: outs[0] }, ...(result.shape.slice(1) as Length[])],
          }
        : (result as IRType)
    );
    const all = [...args, ...inputs];
    if (self) fn.self.push(all);
    // A function that writes a variable of the engine (CE-1776): the
    // record of its value and of the new value of each variable, which
    // rebinds the variable here, in the order of the program.
    if (fn.writes.length > 0) {
      const host = cx.stateOf(fn.key).host;
      const writes =
        host === undefined
          ? `which assigns the variable ${fn.writes[0]} of the engine`
          : `which calls the function ${host} of the host, in a function that assigns the variable ${fn.writes[0]} of the engine`;
      if (lowering.has(fn))
        decline(e, `a recursive call of ${e.operator}, ${writes}`);
      if (mapping > 0)
        decline(e, `a call of ${e.operator} that maps over a list, ${writes}`);
      const r = b.newValue(type(fn.ir.body.yields[0]));
      b.emit({ k: 'call', outs: [r], fn: fn.ir.name, args: all });
      fn.writes.forEach(
        (n, k) => (cx.stateWrite(e, n).v = cx.field(e, r, k + 1))
      );
      const v = cx.field(e, r, 0);
      if (fn.listed !== undefined) cx.listed.set(v, fn.listed);
      return v;
    }
    b.emit({ k: 'call', outs: [...outs, out], fn: fn.ir.name, args: all });
    // A list of lists of run-time length (CE-1736): read row by row, of the
    // lane of the elements of the body.
    const rows =
      result.lane === 'rows' && fn.value !== undefined
        ? cx.rowsElements.get(fn.value)
        : undefined;
    if (rows !== undefined) {
      cx.rowsParams.add(out);
      cx.rowsElements.set(out, rows);
    }
    const axis =
      fn.ir.body.yields.length > 0
        ? cx.tuples.get(fn.value!)
        : fn.declared?.tuple;
    if (axis !== undefined) cx.tuples.set(out, axis);
    if (fn.listed !== undefined) cx.listed.set(out, fn.listed);
    return out;
  };

  /** The call `e` of the arguments `args`, some of them lists that the
   *  call maps over (`maps`): a flat list for a scalar parameter
   *  (`'list'`), a list of points for a point parameter (`'points'`). As
   *  the interpreter maps it, a build of the calls of the elements at each
   *  index, zipped, and of the other arguments, bound whole. The lists
   *  are of one length (lists of different lengths give
   *  `incompatible-dimensions`), and the result of the function is a
   *  scalar or a point. `recursive`: a call of a function being lowered. */
  const mapOver = (
    e: Fn,
    binding: { key: object; literal: Fn } | undefined,
    recursive: boolean,
    args: V[],
    maps: (i: number) => 'list' | 'points' | undefined
  ): V => {
    if (recursive)
      decline(e, `a list argument of a recursive call of ${e.operator}`);
    const sources = args.map((v, i) => {
      const t = type(v);
      const how = maps(i);
      if (how === undefined) return undefined;
      if (how === 'list' && (t.shape.length > 1 || cx.tuples.has(v)))
        decline(
          e,
          `a list argument of ${e.operator} that is not a flat list (the interpreter maps the function to the leaves of a nested list)`
        );
      return lists.listSource(v);
    });
    // Lengths that are not one value are compared at run time
    // (`agree()`); two constants that differ, and other targets, decline.
    const length = sources
      .filter((s) => s !== undefined)
      .map((s) => s.length)
      .reduce(
        (n, m) =>
          (lists.knownLength(n) !== undefined &&
          lists.knownLength(m) !== undefined &&
          lists.knownLength(n) !== lists.knownLength(m)
            ? undefined
            : lists.agreedLength(e, n, m)) ??
          decline(
            e,
            `list arguments of ${e.operator} whose lengths are not one value (lists of different lengths give incompatible-dimensions)`
          )
      );
    const index = { length, at: (k: V) => k };
    return lists.over(
      e,
      index,
      '',
      (k) => {
        mapping += 1;
        let out: V;
        try {
          out = call(
            e,
            binding,
            args.map((v, i) => sources[i]?.at(k) ?? v)
          );
        } finally {
          mapping -= 1;
        }
        if (type(out).shape.length > 0 && cx.tuples.get(out) !== 0)
          decline(
            e,
            `a list argument of ${e.operator}, whose result is not a scalar or a point (the interpreter gives a list of lists)`
          );
        return out;
      },
      false,
      e
    );
  };

  /** The input `name` of the engine type `t` that the body of the function
   *  being lowered reads, as the type `read` (`readAs()` of `lower.ts`), in
   *  the binding `def`: a parameter after its own, which each call passes.
   *  `hidden`: a parameter of the function has the name, so the input is
   *  not a name of the body's frame (`UserFunction.hidden`). `given`: the
   *  IR type of the input, an array that a name holds (`lower-arrays.ts`). */
  const capture = (
    e: Expression,
    name: string,
    t: Type,
    read = t,
    def?: BoxedValueDefinition,
    hidden = false,
    given?: IRType
  ): V => {
    const fn = pending.get(cx.inFunction!)!;
    const known = hidden ? fn.hidden.get(name) : undefined;
    if (known !== undefined) return known;
    if (fn.called)
      decline(
        e,
        `a recursive call of ${fn.ir.source}, which reads the input ${name} (a function on a cycle of calls through another function reads no input)`
      );
    // A scalar, or a list or a tuple (a point) of reals or integers of a
    // stated length, or a list of lists of two lengths not stated (the lane
    // `rows`, as a parameter of that type; the entry's input, which each
    // call passes, declines it on a target or in a mode without the lane).
    const ir =
      given ??
      (!cx.interval && !cx.bigint && cx.rowsElementLane(read) !== undefined
        ? { lane: 'rows' as const, shape: [] }
        : tupleOrInputType(isUntyped(read) ? 'unknown' : read, cx.wide));
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
    if (ir.lane === 'rows') {
      cx.rowsParams.add(v);
      cx.rowsElements.set(v, cx.rowsElementLane(read)!);
      // A matrix input: the length of its rows, at the start of the body.
      if (isFreeMatrix(read))
        cx.rowWidths.set(
          v,
          b.entryOp('rows.width', [v], scalarType('integer'))
        );
    }
    if (tupleAxis(t) === 0) cx.tuples.set(v, 0);
    fn.inputs.push(t);
    fn.defs.push(def);
    if (hidden) fn.hidden.set(name, v);
    else cx.frames[0].names.set(name, { v, role: 'input' });
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
    /** The user function of `binding`, called by `e`, declares the result
     *  `nothing` (CE-1652, step 5). */
    declaresNothing: (
      e: Fn,
      binding: { key: object; literal: Fn; implementation?: boolean }
    ): boolean => signatureOf(e, binding).nothing,
    /** The function being lowered that the recursive call `e` reaches
     *  (`recursive()`) declares the result `nothing`. */
    recursiveNothing: (e: Fn): boolean =>
      pending.get(e.operator)?.nothing === true,
  };
}
