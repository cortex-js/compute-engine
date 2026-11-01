// The shapes of compiled values, read from static types: the shape of the
// values of a type (`shapeOfType()`), and, for a type declared as a union of
// shapes, its members and the run-time test that tells them apart.
//
// Design: rules R1, R3 and R4 of
// `docs/plans/2026-10-31-static-shape-compilation.md`.

import type { Type } from '../../common/type/types.js';
import {
  couldMatch,
  isSubtype,
  listElementType,
} from '../../common/type/subtype.js';
import { declarationOf } from '../../common/type/reference.js';
import { typeToString } from '../../common/type/serialize.js';
import {
  collectionElementType,
  isNonRealNumber,
  resolveTypeForCompiledLanes as resolveTypeForCompilation,
  stripMissingFromType,
} from '../../common/type/utils.js';

/**
 * The shape of the values of a type, as the compiled code represents them:
 * a scalar (a number or a boolean), a tuple (a point) of `arity` elements,
 * or a list whose elements have the shape `element`. An `arity` or an
 * `element` that is `undefined` is not known.
 */
export type ValueShape =
  | { kind: 'scalar' }
  | { kind: 'tuple'; arity?: number }
  | { kind: 'list'; element?: ValueShape };

/**
 * The shape of the values of `t`, or `undefined` when `t` does not settle
 * one: `unknown`, `any`, a string, a record, a function, or a union whose
 * members have different shapes (`real | list<real>`, `broadcastable<real>`).
 */
export function shapeOfType(
  t: Readonly<Type>,
  depth = 0
): ValueShape | undefined {
  if (depth > 16) return undefined;
  const r = resolveTypeForCompilation(t);
  if (r === 'unknown' || r === 'any' || r === 'never' || r === 'error')
    return undefined;
  if (typeof r !== 'string' && r.kind === 'union') {
    const shapes = r.types.map((m) => shapeOfType(m, depth + 1));
    const first = shapes[0];
    if (first === undefined) return undefined;
    for (const s of shapes)
      if (s === undefined || shapesConflict(first, s)) return undefined;
    return first;
  }
  if (isSubtype(r, 'number') || isSubtype(r, 'boolean'))
    return { kind: 'scalar' };
  if (typeof r !== 'string' && r.kind === 'tuple')
    return { kind: 'tuple', arity: r.elements.length };
  if (typeof r !== 'string' && r.kind === 'list')
    return {
      kind: 'list',
      element: shapeOfType(listElementType(r), depth + 1),
    };
  if (isSubtype(r, 'tuple')) return { kind: 'tuple' };
  if (isSubtype(r, 'list')) return { kind: 'list' };
  return undefined;
}

/**
 * True when each value of `t` is one number, one boolean or one string, so
 * a call never maps over it. A type that only admits such values among
 * others (`unknown`, `real | list<real>`) is not.
 */
export function isScalarShaped(t: Readonly<Type>): boolean {
  return (
    isSubtype(t, 'number') || isSubtype(t, 'boolean') || isSubtype(t, 'string')
  );
}

/**
 * True when the type of a parameter of a function definition does not
 * declare a type: `unknown` (the parameter has no annotation), `any` or
 * `value`. The interpreter then binds a point at that parameter whole, and
 * maps a call over the list levels above the points.
 */
export function isUndeclaredParameterType(t: Readonly<Type>): boolean {
  return t === 'unknown' || t === 'any' || t === 'value';
}

/**
 * True when the interpreter binds ONE point whole at a parameter of type
 * `t`, and the generic definition of the function reads that parameter as
 * a scalar. This is the case when `t` declares no type
 * (`isUndeclaredParameterType()`), and when `t` is a union with such a
 * member. The second case is the type `collection<any> | value` that is
 * inferred for a parameter that the body uses whole (`p ↦ Max(p) + 1`):
 * it admits a point, and the generic definition compiles the body against
 * its scalar member, so `Max(p)` becomes `Math.max(p)`, which gives `NaN`
 * for the array of a point.
 *
 * Only one point is bound the same way. A LIST of points at the second
 * kind of parameter is bound whole, not mapped over, so this test does not
 * replace `isUndeclaredParameterType()` for a list argument.
 */
export function bindsOnePointAsUndeclared(t: Readonly<Type>): boolean {
  if (isUndeclaredParameterType(t)) return true;
  return (
    typeof t !== 'string' &&
    t.kind === 'union' &&
    t.types.some((m) => isUndeclaredParameterType(m))
  );
}

/**
 * True when no value can have both shapes: a scalar and a list, a point and
 * a list of points, two lists whose elements conflict, and, when `arity` is
 * true, two points of different arities. A part that is not known does not
 * conflict.
 */
export function shapesConflict(
  a: ValueShape,
  b: ValueShape,
  arity = true
): boolean {
  if (a.kind !== b.kind) return true;
  if (a.kind === 'tuple' && b.kind === 'tuple')
    return (
      arity &&
      a.arity !== undefined &&
      b.arity !== undefined &&
      a.arity !== b.arity
    );
  if (a.kind === 'list' && b.kind === 'list')
    return (
      a.element !== undefined &&
      b.element !== undefined &&
      shapesConflict(a.element, b.element, arity)
    );
  return false;
}

/**
 * One member of a type declared as a union of shapes: the union of the
 * declared members that have the same shape (`integer | real` in
 * `integer | real | list<real>`). Points of different lengths have the same
 * shape here.
 *
 * `depth` is the depth of array nesting of a value of the member in the
 * compiled code: 0 for a scalar, 1 for a point of scalars or a list of
 * scalars, 2 for a list of points or a list of lists, 3 for a list of lists
 * of points. It is `undefined` when the member has another form (a point
 * whose coordinates are lists, a list whose element shape is not known, a
 * list whose elements can be absent below the first level): no run-time
 * test then tells the member apart from the others.
 *
 * `absentElements` is true when an element of a value of the member can be
 * absent (`list<missing | tuple<real, real>>`). The test of the nesting then
 * reads an absent first element as an element of this member.
 *
 * `label` names the member in the key of a variant of a function
 * (`unionMemberVariantKey()` in `compiler-core.ts`): the kind of its shape
 * (`scalar`, `tuple`, `list`), followed by its depth when another member of
 * the union has the same kind (`list2` and `list3` for a list of points and
 * a list of lists of points).
 *
 * When the declared union has a `missing` member (`real | list<real> |
 * missing`), one member receives an absent value: its `types` hold
 * `missing`, and its body reads the absent value as any body reads an
 * argument that can be absent. It is the scalar member when there is one,
 * else the member of the greatest depth. The interpreter maps a call over
 * a value whose type has a list member, and the map of an absent value is
 * the function applied to it: `f(L)` with `f: (tuple<real, real>) ->
 * tuple<real, real>` and `L: tuple<real, real> | list<tuple<real, real>> |
 * missing` is `Missing` for an absent `L`, where `f(Missing)` alone is an
 * `incompatible-type` error. The body of the deepest member maps too, and
 * gives that value; the body of a point member would bind the absent value
 * whole and stop the run.
 */
export interface UnionShapeMember {
  readonly shape: ValueShape;
  readonly types: ReadonlyArray<Type>;
  readonly depth: number | undefined;
  readonly absentElements: boolean;
  readonly label: string;
}

/**
 * The members of `t`, grouped by shape, when `t` is a union whose members
 * have different shapes (`real | list<real>`,
 * `tuple<real, real> | list<tuple<real, real>>`). `undefined` when `t`
 * settles one shape (`shapeOfType()`), is not a union, or has a member with
 * no shape (`real | string`): such a type asks for no dispatch.
 *
 * A `missing` member is not a shape: the members are read from the other
 * members, and one of them receives the absent value (`UnionShapeMember`).
 *
 * A `broadcastable<T>` type is not a union here: it is a request for the
 * element-wise map of the operators, not for one body per shape. Neither is
 * a union with a member that holds non-real numbers
 * (`complex | vector<complex^2>`): the compile mode decides how a complex
 * value is represented, and a body compiled for the scalar member read the
 * value on the real lane (`2 * zc` threw for `1 + 2i` and gave `NaN` parts
 * for `3`).
 */
export function unionShapeMembers(
  t: Readonly<Type>
): UnionShapeMember[] | undefined {
  const r = resolveTypeForCompilation(t);
  if (typeof r === 'string' || r.kind !== 'union') return undefined;
  // The members are grouped by the shape of their present values, so a
  // union that `shapeOfType()` reads as one list of elements of no known
  // shape (`list<missing | real> | list<list<real>>`) has two members here.
  // A `nothing` member is not a shape either, and no member receives it:
  // `Nothing` has no compiled value, so the host cannot supply it.
  const present = r.types.filter(
    (m) => !isMissingType(m) && resolveTypeForCompilation(m) !== 'nothing'
  );
  const absent = r.types.some((m) => isMissingType(m));
  const groups: {
    shape: ValueShape;
    types: Type[];
    present: Type[];
  }[] = [];
  for (const m of present) {
    const shape = shapeOfType(withoutAbsentElements(m).type);
    if (shape === undefined || holdsNonRealNumbers(m)) return undefined;
    // Points of different lengths are one member: their array depth is
    // the same, so no test of the nesting tells them apart, and one body
    // reads a point of either length, as it does for any input whose type
    // is a union of points.
    const group = groups.find((g) => !shapesConflict(g.shape, shape, false));
    if (group !== undefined) group.types.push(m);
    else groups.push({ shape, types: [m], present: [] });
  }
  if (groups.length < 2) return undefined;
  const members = groups.map((g) => {
    const elements = g.types.map(withoutAbsentElements);
    return {
      shape: g.shape,
      types: g.types,
      depth: arrayDepth(elements.map((e) => e.type)),
      absentElements: elements.some((e) => e.absent),
    };
  });
  // The member that receives the absent value: the scalar member, which
  // the test of depth 1 selects for a value that is not an array, else the
  // deepest member, which the other tests select for an absent value
  // (`ShapeTest.absentValue`).
  let receiver = members.find((m) => m.depth === 0);
  if (receiver === undefined)
    for (const m of members)
      if (
        m.depth !== undefined &&
        (receiver === undefined || m.depth > receiver.depth!)
      )
        receiver = m;
  return members.map((m) => ({
    ...m,
    types: absent && m === receiver ? [...m.types, 'missing'] : m.types,
    label: members.some(
      (o) => o !== m && o.shape.kind === m.shape.kind && m.depth !== undefined
    )
      ? `${m.shape.kind}${m.depth}`
      : m.shape.kind,
  }));
}

/** True when `t` is the type `missing`, the type of an absent value. */
function isMissingType(t: Readonly<Type>): boolean {
  return resolveTypeForCompilation(t) === 'missing';
}

/**
 * `t` without the `missing` member of the type of its elements, when `t` is
 * a list whose elements can be absent (`list<missing | tuple<real, real>>`
 * gives `list<tuple<real, real>>`), and whether it had one. Only the
 * elements of the outer list are read: an absent element at a deeper level
 * keeps the type as it is, and no shape is read from it.
 */
function withoutAbsentElements(t: Readonly<Type>): {
  type: Type;
  absent: boolean;
} {
  const r = resolveTypeForCompilation(t);
  if (typeof r === 'string' || r.kind !== 'list')
    return { type: t as Type, absent: false };
  const element = resolveTypeForCompilation(listElementType(r));
  if (typeof element === 'string' || element.kind !== 'union')
    return { type: t as Type, absent: false };
  const rest = element.types.filter((m) => !isMissingType(m));
  if (rest.length === element.types.length || rest.length === 0)
    return { type: t as Type, absent: false };
  return {
    type: {
      ...r,
      elements: rest.length === 1 ? rest[0] : { kind: 'union', types: rest },
    } as Type,
    absent: true,
  };
}

/**
 * True when `t` is, or has elements of, a type of non-real numbers
 * (`isNonRealNumber()`: `complex`, `imaginary`). The wide type `number` is
 * not one: a compilation reads it on the real lane unless its compile mode
 * says otherwise.
 */
function holdsNonRealNumbers(t: Readonly<Type>, depth = 0): boolean {
  if (depth > 16) return true;
  const r = resolveTypeForCompilation(t);
  if (typeof r !== 'string' && r.kind === 'union')
    return r.types.some((m) => holdsNonRealNumbers(m, depth + 1));
  if (typeof r !== 'string' && r.kind === 'tuple')
    return r.elements.some((e) => holdsNonRealNumbers(e.type, depth + 1));
  if (typeof r !== 'string' && r.kind === 'list')
    return holdsNonRealNumbers(listElementType(r), depth + 1);
  return isNonRealNumber(r);
}

/** The array depth that every type of `types` has, or `undefined`. */
function arrayDepth(types: ReadonlyArray<Type>): number | undefined {
  let depth: number | undefined;
  for (const t of types) {
    const d = arrayDepthOf(t);
    if (d === undefined || (depth !== undefined && d !== depth))
      return undefined;
    depth = d;
  }
  return depth;
}

function arrayDepthOf(t: Readonly<Type>, level = 0): number | undefined {
  if (level > 16) return undefined;
  const shape = shapeOfType(t);
  if (shape === undefined) return undefined;
  if (shape.kind === 'scalar') return 0;
  const r = resolveTypeForCompilation(t);
  if (shape.kind === 'tuple') {
    if (typeof r === 'string' || r.kind !== 'tuple') return undefined;
    return r.elements.every((e) => shapeOfType(e.type)?.kind === 'scalar')
      ? 1
      : undefined;
  }
  if (typeof r === 'string' || r.kind !== 'list') return undefined;
  const d = arrayDepthOf(withoutNothing(listElementType(r)), level + 1);
  return d === undefined ? undefined : d + 1;
}

/**
 * The type of the elements of a list `t` without its `nothing` members:
 * `integer | nothing` gives `integer`. A list never holds `Nothing`
 * (`[1, Nothing, 2]` is `[1, 2]`), so a `nothing` member of the type of the
 * elements adds no element to the value and does not change its array
 * nesting. `t` is returned as it is when it has no `nothing` member, or
 * when every member is `nothing`.
 */
function withoutNothing(t: Readonly<Type>): Type {
  const r = resolveTypeForCompilation(t);
  if (typeof r === 'string' || r.kind !== 'union') return t as Type;
  const rest = r.types.filter(
    (m) => resolveTypeForCompilation(m) !== 'nothing'
  );
  if (rest.length === r.types.length || rest.length === 0) return t as Type;
  return rest.length === 1 ? rest[0] : { kind: 'union', types: rest };
}

/**
 * A run-time test of a compiled value that tells the members of a union of
 * shapes apart. The test holds when the array nesting of the value is at
 * least `depth`:
 * - `depth` 1: the value is an array (a point or a list), not a scalar.
 * - `depth` n > 1: the value, an array of depth n - 1 or more, is empty, or
 *   the first element at each of the levels 1 to n - 2 is empty, or that
 *   element at level n - 1 is an array. An empty array goes to the member
 *   of the greater depth (`shapeDiscriminator()` says when that is sound).
 *
 * `absentValue`: the value can be absent, and the test holds for an absent
 * value, which goes to the deepest member (`UnionShapeMember`). It is not
 * used with `depth` 1, where an absent value is not an array and goes to
 * the scalar member.
 *
 * `absentFirst` (only with `depth` 2): an absent first element goes to the
 * member of the greater depth, whose elements can be absent
 * (`list<missing | tuple<real, real>>`).
 */
export interface ShapeTest {
  readonly depth: number;
  readonly absentValue?: boolean;
  readonly absentFirst?: boolean;
}

/**
 * How the code selects the member of a union of shapes for a value: a
 * member, or a test whose result selects one of two decisions.
 */
export type ShapeDecision<M extends UnionShapeMember = UnionShapeMember> =
  | { readonly member: M }
  | {
      readonly test: ShapeTest;
      readonly ifTrue: ShapeDecision<M>;
      readonly ifFalse: ShapeDecision<M>;
    };

/**
 * The run-time tests that tell the `members` of a union of shapes apart
 * (`unionShapeMembers()`), or `undefined` when no test can.
 *
 * The test reads the array nesting of the value only. Two members with the
 * same depth have no test: a point of two reals and a list of two reals are
 * both `[a, b]` (`tuple<real, real> | list<real>`), and the interpreter
 * gives them different values (`f(t) := 2t + 1` maps over the list, and
 * binds the point whole), so the value does not say which body is right.
 *
 * The members are sorted by depth, and each test tells the members of a
 * depth less than n from those of depth n or more. A value that is a value
 * of two members can go to the body of either: each body gives the
 * interpreter value for every value of its member. The empty array is the
 * one such value here. A test sends it to the member of the greater depth,
 * which is sound when that member admits the empty list
 * (`list<list<real>>`, `list<tuple<real, real>>`), or when the member of
 * the lesser depth does not admit it either (a point is never empty).
 * Otherwise (`list<real> | matrix<2x2>`, where the member of depth 2
 * excludes the empty list) there is no test.
 *
 * At depth 3 or more, the test also sends to the member of the greater
 * depth an array whose first element is empty. That array is not a value
 * of both members in general: `[[], [1, 2]]` is a value of
 * `list<list<real>>` and not of `list<list<list<real>>>`. So there is no
 * test when the member of the lesser depth admits an empty list below its
 * top level (`list<list<real>> | list<list<list<real>>>`).
 *
 * Absent elements: the test of depth 2 reads an absent first element as an
 * element of the member of depth 2 or more when its elements can be absent.
 * There is no test when the member of depth 1 can also have absent
 * elements (`list<missing | real> | list<missing | list<real>>`: the first
 * element does not say), or when a member of depth 3 or more, or a member
 * of depth 2 below a member of depth 3, can have them (the probe of the
 * test reads the first element of the first element).
 */
export function shapeDiscriminator<M extends UnionShapeMember>(
  members: ReadonlyArray<M>
): ShapeDecision<M> | undefined {
  const r = discriminate(members);
  return 'reason' in r ? undefined : r;
}

/**
 * Why no run-time test tells the `members` of a union of shapes apart, as
 * a phrase for a diagnostic (`the values of tuple<real, real> and of
 * list<real> are arrays of the same nesting`), or `undefined` when a test
 * does (`shapeDiscriminator()`).
 */
export function noShapeDiscriminatorReason(
  members: ReadonlyArray<UnionShapeMember>
): string | undefined {
  const r = discriminate(members);
  return 'reason' in r ? r.reason : undefined;
}

/** The types of `member` other than `missing`, for a diagnostic. */
function memberTypeString(member: UnionShapeMember): string {
  return member.types
    .filter((t) => !isMissingType(t))
    .map((t) => typeToString(t))
    .join(' | ');
}

/**
 * The decision of `shapeDiscriminator()`, or the reason why there is none
 * (`noShapeDiscriminatorReason()`).
 */
function discriminate<M extends UnionShapeMember>(
  members: ReadonlyArray<M>
): ShapeDecision<M> | { readonly reason: string } {
  const byDepth = new Map<number, M>();
  for (const m of members) {
    if (m.depth === undefined)
      return {
        reason: `the values of \`${memberTypeString(m)}\` do not all have the same array nesting`,
      };
    const other = byDepth.get(m.depth);
    if (other !== undefined)
      return {
        reason: `the values of \`${memberTypeString(other)}\` and of \`${memberTypeString(m)}\` are arrays of the same nesting`,
      };
    byDepth.set(m.depth, m);
  }
  const sorted = [...byDepth.keys()].sort((a, b) => a - b);
  const deepest = sorted[sorted.length - 1];
  // An absent value goes to the deepest member when there is no scalar
  // member (`unionShapeMembers()`).
  const absentValue =
    !byDepth.has(0) &&
    members.some((m) => m.types.some((t) => isMissingType(t)));
  for (const m of members) {
    if (!m.absentElements) continue;
    if (m.depth! >= 3 || (m.depth === 2 && deepest >= 3))
      return {
        reason: `the elements of \`${memberTypeString(m)}\` can be absent, and the test reads the first element of the first element`,
      };
  }
  for (let k = 1; k < sorted.length; k++) {
    const lesser = byDepth.get(sorted[k - 1])!;
    const greater = byDepth.get(sorted[k])!;
    // The test of depth n = sorted[k - 1] + 1 sends to the greater member
    // an array that is empty, or whose first element at a level from 1 to
    // n - 2 is empty. The empty array is a value of both members when both
    // admit it. An empty first element at level 1 or more is not: the
    // other elements of `[[], [1, 2]]` (a value of `list<list<real>>`) are
    // not lists of lists, and the test cannot read them. So the lesser
    // member must exclude the empty list at those levels.
    if (admitsEmptyListAt(lesser, 0) && !admitsEmptyListAt(greater, 0))
      return {
        reason: `the empty list is a value of \`${memberTypeString(lesser)}\` and not of \`${memberTypeString(greater)}\``,
      };
    for (let level = 1; level < sorted[k - 1]; level++)
      if (admitsEmptyListAt(lesser, level))
        return {
          reason: `a value of \`${memberTypeString(lesser)}\` whose first element is an empty list looks like a value of \`${memberTypeString(greater)}\``,
        };
    if (sorted[k - 1] === 1 && greater.absentElements && lesser.absentElements)
      return {
        reason: `the first element of a value of \`${memberTypeString(lesser)}\` and of \`${memberTypeString(greater)}\` can be absent`,
      };
  }
  // The decision for the members of depth `sorted[k]` and more. The test
  // between the member of depth `sorted[k]` and the deeper ones reads the
  // nesting one level below that depth: no member has a depth in between.
  const from = (k: number): ShapeDecision<M> => {
    const member = byDepth.get(sorted[k])!;
    if (k === sorted.length - 1) return { member };
    const depth = sorted[k] + 1;
    const absentFirst =
      depth === 2 &&
      sorted.slice(k + 1).some((d) => byDepth.get(d)!.absentElements);
    return {
      test: {
        depth,
        ...(absentValue ? { absentValue } : {}),
        ...(absentFirst ? { absentFirst } : {}),
      },
      ifTrue: from(k + 1),
      ifFalse: { member },
    };
  };
  return from(0);
}

/**
 * True when the empty list is a value of a type of `member` at `level`:
 * the value itself at level 0, its elements at level 1, the elements of
 * its elements at level 2.
 */
function admitsEmptyListAt(member: UnionShapeMember, level: number): boolean {
  return member.types.some((t) => {
    let at: Type | undefined = withoutAbsentElements(t).type;
    for (let j = 0; j < level && at !== undefined; j++) {
      const r = resolveTypeForCompilation(at);
      at =
        typeof r !== 'string' && r.kind === 'list'
          ? listElementType(r)
          : undefined;
    }
    return (
      at !== undefined && isSubtype({ kind: 'list', elements: 'never' }, at)
    );
  });
}

/**
 * The `CompileTarget.shapeDispatch` of the JavaScript target. A point and a
 * list are both JavaScript arrays there, and a scalar is not an array (a
 * number or a boolean). An absent value is `undefined` (or `null`).
 */
export function javascriptShapeDispatch(
  value: string,
  test: ShapeTest,
  ifTrue: string,
  ifFalse: string
): string {
  const cond = shapeTestCode(value, test, {
    isArray: (v) => `Array.isArray(${v})`,
    isEmpty: (v) => `${v}.length === 0`,
    isAbsent: (v) => `${v} == null`,
    or: (terms) => `(${terms.join(' || ')})`,
  });
  return `(${cond} ? ${ifTrue} : ${ifFalse})`;
}

/**
 * The `CompileTarget.shapeDispatch` of the interval-js target. As on
 * JavaScript, a point and a list are arrays, and a scalar (an interval
 * object) is not. An absent value is `undefined`, or one of the absence
 * markers of the target, which are interval objects: the whole-NaN
 * interval `{ lo: NaN, hi: NaN }` (a numeric absence handed in by the
 * caller, an out-of-band read) and the `empty` result (`_IA.isAbsent`,
 * `interval/comparison.ts`). Without the markers, an element
 * `{ lo: NaN, hi: NaN }` first in a value of type `list<real> |
 * list<list<real> | missing>` sent the value to the member `list<real>`,
 * and `f(U)` with `f := t ↦ 2t + 1` gave `[empty, empty]` for
 * `[absent, [1, 2]]`, where the interpreter gives `[NaN, [3, 5]]`.
 */
export function intervalShapeDispatch(
  value: string,
  test: ShapeTest,
  ifTrue: string,
  ifFalse: string
): string {
  const cond = shapeTestCode(value, test, {
    isArray: (v) => `Array.isArray(${v})`,
    isEmpty: (v) => `${v}.length === 0`,
    isAbsent: (v) =>
      `(${v} == null || (!Array.isArray(${v}) && _IA.isAbsent(${v}) === 'true'))`,
    or: (terms) => `(${terms.join(' || ')})`,
  });
  return `(${cond} ? ${ifTrue} : ${ifFalse})`;
}

/**
 * The code of the condition of `test` (`ShapeTest`) on the compiled value
 * `value`, from the spellings of a target: for the test of depth n > 1,
 * the value is empty, or the first element at a level from 1 to n - 2 is
 * empty, or the first element at level n - 1 is an array (or, with
 * `absentFirst`, is absent). With `absentValue`, the test also holds for
 * an absent value. The test of depth 2 is `(v.length === 0 || Array.isArray(v[0]))`
 * on JavaScript.
 */
function shapeTestCode(
  value: string,
  test: ShapeTest,
  spell: {
    isArray: (v: string) => string;
    isEmpty: (v: string) => string;
    isAbsent: (v: string) => string;
    or: (terms: string[]) => string;
  }
): string {
  if (test.depth <= 1) return spell.isArray(value);
  const terms = [spell.isEmpty(value)];
  let probe = `${value}[0]`;
  for (let level = 1; level < test.depth - 1; level++) {
    terms.push(spell.isEmpty(probe));
    probe = `${probe}[0]`;
  }
  if (test.absentFirst) terms.push(spell.isAbsent(probe));
  terms.push(spell.isArray(probe));
  return spell.or(test.absentValue ? [spell.isAbsent(value), ...terms] : terms);
}

/**
 * The `CompileTarget.shapeDispatch` of the Python target. A point or a list
 * can be a Python list, a tuple or a NumPy array, and each has a length; a
 * scalar (an `int`, a `float`, a `bool`, a NumPy scalar) has none.
 *
 * The join is a conditional expression, so each body must be one Python
 * expression. A body that lowers to statements (a `Block` of several
 * statements at the root gives `k = (lambda u: 2 * u)\nreturn k(x)`) has
 * no place in it, and the dispatch throws: the caller then compiles the
 * root with one body, which declines on the union input. The signals of a
 * statement are those of `pythonAssertExpressionOnly()` in
 * `python-target.ts`: a line break, or the word `return` outside a string
 * literal.
 */
export function pythonShapeDispatch(
  value: string,
  test: ShapeTest,
  ifTrue: string,
  ifFalse: string
): string {
  const isStatement = (code: string): boolean =>
    code.includes('\n') ||
    /\breturn\b/.test(code.replace(/"(?:[^"\\]|\\.)*"/g, '""'));
  if (isStatement(ifTrue) || isStatement(ifFalse))
    throw new Error(
      `Could not compile: a body of the dispatch on the shape of ` +
        `\`${value}\` lowers to Python statements, and the dispatch joins ` +
        `the bodies in one conditional expression.`
    );
  const cond = shapeTestCode(value, test, {
    isArray: (v) => `hasattr(${v}, '__len__')`,
    isEmpty: (v) => `len(${v}) == 0`,
    isAbsent: (v) => `${v} is None`,
    or: (terms) => `(${terms.join(' or ')})`,
  });
  return `(${ifTrue} if ${cond} else ${ifFalse})`;
}

/**
 * True when `t` is a reference to an opaque nominal type, or to a
 * transparent alias that is a sum declared with the sum sugar (its
 * declaration record carries `_sumVariants`). The interpreter binds a
 * value of such a type whole. The same test as `isNominalAtomicType` in
 * `compiler-type-facts.ts`.
 */
function isNominalAtomicReference(t: Readonly<Type>): boolean {
  if (typeof t === 'string' || t.kind !== 'reference') return false;
  if (t.alias !== true) return true;
  return declarationOf(t)._sumVariants !== undefined;
}

/**
 * The point that a value of type `t` is, and whether the value may be
 * absent, with `t` read through `resolveTypeForCompilation()`: each alias
 * and each nominal type is replaced by its definition, at every union arm.
 * After `missing` arms are removed, every arm must be the same tuple type:
 *
 * - `tuple<real, real>`, or `Row`, a nominal type declared
 *   `tuple<real, real>`: the point, not absent.
 * - `tuple<real, real> | missing`, `mpt`, an alias of that union, or
 *   `mpt | tuple<real, real>`: the point, absent.
 *
 * `undefined` for any other type: a scalar or a list arm, points of
 * different types, a reference whose definition is not known or is a
 * cycle, and a sum declared with the sum sugar, whose values the
 * interpreter binds whole whatever their definition.
 *
 * A value of a nominal type is held by the compiled code as a value of its
 * definition, so a nominal point is an array of coordinates, as a point of
 * a tuple type is.
 */
export function pointOfType(
  t: Readonly<Type>
): { point: Type; absent: boolean } | undefined {
  const arms: Type[] = [];
  const visit = (x: Readonly<Type>, depth: number): boolean => {
    if (depth > 16) return false;
    if (typeof x !== 'string' && x.kind === 'reference') {
      if (x.def === undefined) return false;
      if (x.alias === true && isNominalAtomicReference(x)) return false;
    }
    const r = resolveTypeForCompilation(x);
    // A reference that is still there is a cycle of definitions.
    if (typeof r !== 'string' && r.kind === 'reference') return false;
    if (typeof r !== 'string' && r.kind === 'union')
      return r.types.every((a) => visit(a, depth + 1));
    arms.push(r);
    return true;
  };
  if (!visit(t, 0)) return undefined;
  const present = arms.filter((a) => a !== 'missing');
  const point = present[0];
  if (point === undefined || typeof point === 'string') return undefined;
  if (point.kind !== 'tuple') return undefined;
  const key = typeToString(point);
  if (!present.every((a) => typeToString(a) === key)) return undefined;
  return { point, absent: present.length < arms.length };
}

/**
 * True when `t` is a reference to a nominal type whose definition, read
 * through `resolveTypeForCompilation()`, has no settled list rank and
 * admits a list (`broadcastable<real>`, `real | list<real>`).
 *
 * The interpreter binds a value of a nominal type whole at a call, and the
 * call never maps over it. The definition is the type of the parameter in
 * the variant that the call selects, and no variant has such a parameter
 * type: a call over such a value declines (rule R3 of
 * `docs/plans/2026-10-31-static-shape-compilation.md`).
 */
export function isNominalWithUnsettledRank(t: Readonly<Type>): boolean {
  const n = stripMissingFromType(t);
  if (!isNominalAtomicReference(n)) return false;
  const r = resolveTypeForCompilation(n);
  return (
    mapRankOfType(r) === undefined &&
    couldMatch(r, { kind: 'list', elements: 'any' })
  );
}

/**
 * The number of list levels that a call of a function with scalar
 * parameters maps over, for an argument of static type `t`, or `undefined`
 * when `t` does not settle it.
 *
 * - 0: the argument reaches the function whole. A scalar, a string, a
 *   point (`tuple<…>`), a record, a value of a nominal type, and any other
 *   value that is not a collection.
 * - n > 0: a list (or another indexed collection, which the compiled code
 *   holds as an array) whose elements have the rank n - 1. With `tuples`
 *   set to `'coordinates'` (the default), a list of points of scalars has
 *   the rank 2: the call maps over each coordinate. The interpreter does
 *   this only at a parameter declared as a scalar (`(t: real) ↦ 7` gives
 *   `[(7, 7)]` for `[(1, 2)]`). With `tuples` set to `'whole'`, a point is
 *   one element and a list of points has the rank 1: the interpreter binds
 *   each point whole at a parameter with no declared type (`t ↦ 7` gives
 *   `[7]` for `[(1, 2)]`).
 * - `undefined`: `unknown`, `any`, a type that admits both a scalar and
 *   a list (`expression`, `value`), a union whose members have different
 *   shapes (`real | list<real>`, `broadcastable<real>`), a list whose
 *   element type does not settle a shape, a collection that is not
 *   indexed (a set, a lazy collection), or a point with a list coordinate.
 *   The compiled code would need a run-time test of the value to choose
 *   the call, so the call declines (rule R3 of
 *   `docs/plans/2026-10-31-static-shape-compilation.md`).
 *
 * A `missing` member (an absent value, `number | missing`) is not a shape:
 * the rank is read from the other members, and the call passes an absent
 * value as it is, where the absent-argument checks of the call read it.
 */
export function mapRankOfType(
  t: Readonly<Type>,
  depth = 0,
  tuples: 'coordinates' | 'whole' = 'coordinates'
): number | undefined {
  if (depth > 16) return undefined;
  const present = stripMissingFromType(t);
  // Only an absent value (`Missing`): passed as it is.
  if (present === 'never' && t !== 'never') return 0;
  // A value of a nominal type reaches the function whole, as the
  // interpreter binds it (`isNominalAtomicType` in `compiler-type-facts.ts`,
  // user decision 2026-08-12): the call does not map over it. The
  // definition of the type is the type of the parameter in the variant
  // that the call selects (a point takes the definition for one point), and
  // a definition with no settled rank declines at the call
  // (`isNominalWithUnsettledRank()`).
  if (isNominalAtomicReference(t) || isNominalAtomicReference(present))
    return 0;
  const r = resolveTypeForCompilation(present);
  if (r === 'unknown' || r === 'any' || r === 'never' || r === 'error')
    return undefined;
  if (isSubtype(r, 'string') || isSubtype(r, 'boolean')) return 0;
  // A record reaches the function whole: the interpreter does not map a
  // function over the fields of a record (ROADMAP CE-256).
  if (typeof r !== 'string' && r.kind === 'record') return 0;
  const shape = shapeOfType(r);
  if (shape?.kind === 'scalar') return 0;
  if (shape?.kind === 'tuple') {
    if (typeof r !== 'string' && r.kind === 'tuple')
      return r.elements.every(
        (e) => mapRankOfType(e.type, depth + 1, tuples) === 0
      )
        ? 0
        : undefined;
    return 0;
  }
  // A union whose members all have one rank (`vector<integer^1> |
  // vector<integer^2>`, the type of `[[1, 2], [3]]`'s elements) has that
  // rank; a union of members of different ranks (`real | list<real>`) has
  // none. A union of a point and a value that is not a point (`real |
  // tuple<real, real>`) has none either, although both have the rank 0: at
  // a parameter with no declared type, the interpreter binds the point
  // whole and runs the body with the scalar, so the call would need the
  // definition for one point and the definition for a scalar, and a
  // run-time test to choose between them.
  if (typeof r !== 'string' && r.kind === 'union') {
    const points = r.types
      .filter((m) => resolveTypeForCompilation(m) !== 'missing')
      .map((m) => pointOfType(m) !== undefined);
    if (points.some((p) => p) && !points.every((p) => p)) return undefined;
    // A union of points of different widths (`tuple<real> | tuple<real,
    // real>`) has no rank either: at a parameter with no declared type,
    // the call would need a definition for each width, and a run-time test
    // to choose between them (rule R3). With `f2 := t ↦ 2t`, the
    // definition compiled for a scalar gave `NaN` for the point `(1, 2)`.
    const widths = new Set(
      r.types
        .filter((m) => resolveTypeForCompilation(m) !== 'missing')
        .map((m) => {
          const p = pointOfType(m)?.point;
          const pr = p === undefined ? undefined : resolveTypeForCompilation(p);
          return typeof pr === 'object' && pr.kind === 'tuple'
            ? pr.elements.length
            : -1;
        })
    );
    if (points.length > 0 && points.every((p) => p) && widths.size > 1)
      return undefined;
    const ranks = r.types.map((m) => mapRankOfType(m, depth + 1, tuples));
    const first = ranks[0];
    return first !== undefined && ranks.every((k) => k === first)
      ? first
      : undefined;
  }
  if (shape?.kind === 'list' || isSubtype(r, 'indexed_collection')) {
    // The element type as written, before the resolution that replaces a
    // nominal reference by its definition. A list with several dimensions
    // (`matrix<number>`) writes its innermost type there, not its element.
    const element =
      (typeof present !== 'string' &&
      present.kind === 'list' &&
      (present.dimensions === undefined || present.dimensions?.length === 1)
        ? present.elements
        : undefined) ?? collectionElementType(r);
    if (element === undefined) return undefined;
    // An element that is a point, also through an alias (`list<mpt |
    // tuple<real, real>>`, with `mpt` an alias of `missing | tuple<real,
    // real>`). A point of a nominal type is not mapped into: the
    // interpreter binds it whole, and the call below gives it the rank 0.
    const elementPoint = isNominalAtomicReference(stripMissingFromType(element))
      ? undefined
      : pointOfType(element)?.point;
    if (tuples === 'coordinates' && elementPoint !== undefined) {
      const inner = mapRankOfType(elementPoint, depth + 1, tuples);
      return inner === 0 ? 2 : undefined;
    }
    const inner = mapRankOfType(element, depth + 1, tuples);
    return inner === undefined ? undefined : inner + 1;
  }
  if (isSubtype(r, 'collection')) return undefined;
  // A type that admits both a scalar and a list (`expression`, `value`)
  // does not settle the rank.
  if (couldMatch(r, { kind: 'list', elements: 'any' })) return undefined;
  return 0;
}

/**
 * True when `t` is `broadcastable<T>` with `T` a scalar type (a number, a
 * boolean or a string): a value of `t` is one scalar or a list of any depth
 * whose leaves are scalars. The host that declares such a type asks for an
 * open rank, so a call of a function with scalar parameters over such a
 * value maps the function over every list level at run time, as an
 * operator does (`b + 1` is `_SYS.bcast(…, b, 1)`). `mapRankOfType()` gives
 * `undefined` for `t`, because no rank is settled.
 *
 * `t` is read through `resolveTypeForCompilation()`. A call never reaches
 * this test for a value of a nominal type whose definition is
 * `broadcastable<real>`: `mapRankOfType()` gives it the rank 0, and the
 * call declines (`isNominalWithUnsettledRank()`).
 */
export function isOpenScalarRankType(t: Readonly<Type>): boolean {
  const r = resolveTypeForCompilation(t);
  return (
    typeof r !== 'string' &&
    r.kind === 'broadcastable' &&
    isScalarShaped(r.elements)
  );
}

/**
 * For a value of static type `t` that holds points below one or more list
 * levels (`list<list<tuple<real, real>>>`): the number of list levels above
 * the points (`mapRankOfType()` with `tuples` set to `'whole'`) and the
 * type of one point.
 *
 * - `undefined`: no point is below a list level.
 * - `null`: the two readings of `mapRankOfType()` differ, but the list
 *   levels do not lead to one point type (a union of points, a `matrix`
 *   of points). The caller declines.
 *
 * At a parameter with no declared type, the interpreter maps a call over
 * these list levels and binds each point whole: with `f := t ↦ 7`,
 * `f([[(1, 2)], [(3, 4), (5, 6)]])` is `[[7], [7, 7]]`. The compiled call
 * maps over `rank` levels and calls a definition compiled for one point.
 *
 * The point is read through `pointOfType()`, which reads the definitions
 * of aliases and nominal types: for `list<mpt>`, with `mpt` an alias of
 * `missing | tuple<real, real>`, the point is `tuple<real, real>`. For
 * `list<Row>`, with `Row` a nominal type declared `tuple<real, real>`, the
 * two readings of `mapRankOfType()` give the same rank, because neither
 * maps into a nominal value, and the point is read from the definition. A
 * nominal type whose definition is not a point (`list<Rows>`, with `Rows`
 * declared `list<tuple<real, real>>`) is bound whole: no point is below
 * the list levels.
 */
export function pointsBelowLists(
  t: Readonly<Type>
): { rank: number; point: Type } | null | undefined {
  const whole = mapRankOfType(t, 0, 'whole');
  const same = whole === mapRankOfType(t);
  if (same && (whole === undefined || whole === 0)) return undefined;
  if (whole === undefined) return null;
  const fail = same ? undefined : null;
  let leaf: Type | undefined = stripMissingFromType(t);
  for (let k = 0; k < whole && leaf !== undefined; k++) {
    const r = resolveTypeForCompilation(leaf);
    if (typeof r === 'string' || r.kind !== 'list') return fail;
    if (r.dimensions !== undefined && r.dimensions?.length !== 1) return fail;
    leaf = stripMissingFromType(r.elements);
  }
  if (leaf === undefined) return fail;
  const point = pointOfType(leaf)?.point;
  return point === undefined ? fail : { rank: whole, point };
}
