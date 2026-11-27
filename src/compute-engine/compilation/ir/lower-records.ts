/**
 * The lowering of records (README, "Records"; CE-1652, step 2): a value
 * whose fields each have a settled shape, made by the constructor of a
 * named tuple type, or by a `Tuple` or a `List` literal whose elements are
 * not of one lane. A record is read at a constant position only (`Field`,
 * `At` of a constant index). No run-time test of a type is emitted
 * (`docs/COMPILATION-MODEL.md`, "Shapes are settled at compile time").
 */

import type { Type, TypeReference } from '../../../common/type/types.js';
import { sumVariantInfo } from '../../sum-representation.js';
import { isSubtype } from '../../../common/type/subtype.js';
import { typeToString as engineTypeToString } from '../../../common/type/serialize.js';
import { unfoldAliasOnDescent } from '../../../common/type/utils.js';
import { isFunction, isSymbol } from '../../boxed-expression/type-guards.js';
import type { DictionaryInterface, Expression } from '../../global-types.js';
import {
  decline,
  hasUnsettledShape,
  isUntyped,
  listedOf,
  recordNames,
  tupleBody,
  type Fn,
  type Lowering,
} from './lower-context.js';
import { arrayCells } from './lower-arrays.js';
import { inputType, tupleAxis, tupleOrInputType } from './lower-functions.js';
import {
  elementIndex,
  isSubType,
  joinType,
  lengthValues,
  typeToString,
  type IRType,
  type V,
} from './ir.js';

/** The constructor of a nominal tuple type that the engine minted for
 *  `type P = tuple<…>` (`mintTypeConstructor()`): the declared type of
 *  each field, and their names when each has one. `undefined` for any
 *  other call. */
export function recordConstructor(
  e: Fn
): { nominal: string; types: Type[]; names?: string[] } | undefined {
  // The marker that `mintTypeConstructor()` sets on the definition.
  const od = e.operatorDefinition as
    { _mintedTypeConstructor?: string } | undefined;
  if (od?._mintedTypeConstructor !== 'nominal') return undefined;
  // A variant of a sum declared with `|`: its tag is a value at run time
  // (`sum-representation.ts`), which a record does not hold.
  if (sumVariantInfo(e.engine, e.operator) !== undefined) return undefined;
  const t = e.type.type;
  const body = tupleBody(t);
  if (body === undefined || body.length !== e.nops) return undefined;
  const names = recordNames(t);
  return {
    nominal: (t as TypeReference).name,
    types: body.map((x) => x.type),
    ...(names === undefined ? {} : { names }),
  };
}

/** The fixed numeric fields of a named tuple that a host can supply. */
export function numericRecordInput(
  engine: Expression['engine'],
  t: Type
): IRType | undefined {
  const nominal = unfoldAliasOnDescent(t, undefined)?.type;
  if (typeof nominal !== 'object' || nominal.kind !== 'reference')
    return undefined;
  const body = tupleBody(nominal);
  if (
    body === undefined ||
    body.length < 2 ||
    body.length > 4 ||
    body.some((x) => x.name === undefined || !isSubtype(x.type, 'real')) ||
    sumVariantInfo(engine, nominal.name) !== undefined
  )
    return undefined;
  return {
    lane: 'record',
    shape: [],
    nominal: nominal.name,
    names: body.map((x) => x.name!),
    fields: body.map((x) => ({
      lane: isSubtype(x.type, 'integer') ? 'integer' : 'real',
      shape: [],
    })),
  };
}

/** On GLSL, a named tuple input whose fields are each a real or an integer
 *  number or a mutable array of machine cells, one of them at least an
 *  array (`type Raster = tuple<width: integer, height: integer, pixels:
 *  array<Pixel>>`): the record of those fields, which
 *  `splitRecords()` of `index.ts` gives one uniform, or one sampler and
 *  its count, per field. `cells` gives the cells of an array field (it
 *  declines a cell type that the target does not read). */
export function fieldRecordInput(
  engine: Expression['engine'],
  t: Type,
  cells: (t: Type) => IRType['array']
): IRType | undefined {
  const nominal = unfoldAliasOnDescent(t, undefined)?.type;
  if (typeof nominal !== 'object' || nominal.kind !== 'reference')
    return undefined;
  const body = tupleBody(nominal);
  if (
    body === undefined ||
    body.length === 0 ||
    body.some(
      (x) =>
        x.name === undefined ||
        (!isSubtype(x.type, 'real') && arrayCells(x.type) === undefined)
    ) ||
    body.every((x) => arrayCells(x.type) === undefined) ||
    sumVariantInfo(engine, nominal.name) !== undefined
  )
    return undefined;
  return {
    lane: 'record',
    shape: [],
    nominal: nominal.name,
    names: body.map((x) => x.name!),
    fields: body.map((x): IRType =>
      isSubtype(x.type, 'real')
        ? { lane: isSubtype(x.type, 'integer') ? 'integer' : 'real', shape: [] }
        : { lane: 'array', shape: [], array: cells(x.type) }
    ),
  };
}

/** The IR type that the declared type `d` of a field settles (a scalar, a
 *  colour, a string, a tuple or a list of stated lengths), or `undefined`
 *  when the operand decides it (`any`, `list`, `string | color |
 *  nothing`). */
function settledType(d: Type, wide: 'real' | 'complex'): IRType | undefined {
  if (d === 'color') return { lane: 'color', shape: [] };
  if (hasUnsettledShape(d)) return undefined;
  const t = tupleOrInputType(d, wide) ?? inputType(d, wide, true);
  if (t === undefined || t.shape.some((n) => n === 'run-time'))
    return undefined;
  return { lane: t.lane, shape: t.shape as number[] };
}

/** The scalar of the IR type `t` (no tuple mark when `!marked`) is of the
 *  engine type `d`: its lane names an engine type that is a subtype of
 *  `d`. A list, a tuple and a record do not prove a type here. */
export function laneProves(t: IRType, marked: boolean, d: Type): boolean {
  if (t.shape.length > 0 || marked) return false;
  // An array: its type, of its cells (`lower-arrays.ts`).
  if (t.array !== undefined)
    return isSubtype({ kind: 'array', elements: t.array.type }, d);
  const lanes: Partial<Record<IRType['lane'], Type>> = {
    string: 'string',
    color: 'color',
    boolean: 'boolean',
    integer: 'integer',
    real: 'real',
    complex: 'complex',
    nothing: 'nothing',
  };
  const e = lanes[t.lane];
  return e !== undefined && isSubtype(e, d);
}

/** `javascript`: the target holds records (JavaScript, not the interval
 *  or the `bigint` mode). Elsewhere a constructor declines and a `Tuple`
 *  or a `List` of several lanes is lowered as before (user decision Q3 of
 *  the plan of CE-1652). `vectors`: the target holds the records of a
 *  nominal tuple type of two to four real or integer numbers
 *  (`type P2 = tuple<x: real, y: real>`, a pixel) and no other (GLSL in
 *  the default mode, where such a record is a `vec2` to a `vec4`). */
export function recordLowering(
  cx: Lowering,
  javascript: boolean,
  vectors = false
) {
  const { b, type, tuples } = cx;
  /** The values of the fields of each record made in this lowering: a
   *  read of a field of one is that value (a constant stays a constant). */
  const parts = new Map<V, V[]>();

  /** The record of the values `values`, of the field types `fields` (the
   *  types of the values when absent), of a nominal type and its field
   *  names. A field of a
   *  run-time length declines: the length is a value of the function that
   *  makes the record, which a reader in another function cannot name. */
  const make = (
    e: Expression,
    values: V[],
    nominal?: { nominal?: string; names?: readonly string[] },
    fields: (IRType | undefined)[] = [],
    head?: IRType['head'],
    resultRecord = false
  ): V => {
    const types = values.map((v, k): IRType => {
      const place = `${nominal?.nominal ?? 'record'}.${k}`;
      const t = fields[k] ?? type(v);
      if (t.lane === 'rows')
        decline(e, 'a record with a field of lists of rows of two lengths');
      // An output object keeps the rank of each field. Its source value
      // holds the lengths, which can be local to a comprehension.
      const shape = resultRecord
        ? t.shape.map(() => 0)
        : t.shape.map((n) =>
            typeof n === 'number' ? n : (cx.constant(n.v) ?? n)
          );
      if (!resultRecord && shape.some((n) => typeof n !== 'number'))
        decline(e, 'a record with a field of a run-time length');
      // A string of a known value: the field's type holds it (CE-1652,
      // step 4c).
      const known =
        t.lane === 'string' && shape.length === 0 && !tuples.has(v)
          ? cx.keepKnown(v, place)
          : undefined;
      return {
        ...t,
        shape,
        ...(known === undefined ? {} : { constant: known }),
      };
    });
    const v = b.list(values, {
      lane: 'record',
      shape: [],
      fields: types,
      marks: values.map((x) => tuples.get(x)),
      ...(nominal?.nominal === undefined ? {} : { nominal: nominal.nominal }),
      ...(nominal?.names === undefined ? {} : { names: nominal.names }),
      ...(head === undefined ? {} : { head }),
      ...(resultRecord ? { resultRecord: true } : {}),
    });
    parts.set(v, values);
    cx.listed.set(
      v,
      values.map((x) => listedOf(cx, x))
    );
    return v;
  };

  /** The elements of a `Tuple` (`tuple`) or of a `List` make a list: one
   *  lane, one shape, one tuple mark (a `Tuple` of tuples does not). */
  const fitsList = (elements: V[], tuple: boolean): boolean => {
    if (elements.length === 0) return true;
    if (tuple && elements.some((v) => tuples.has(v))) return false;
    if (elements.some((v) => tuples.get(v) !== tuples.get(elements[0])))
      return false;
    let t: IRType | undefined = type(elements[0]);
    for (const v of elements) {
      t = joinType(t, type(v));
      if (t === undefined) return false;
    }
    return (
      t.lane !== 'record' && t.lane !== 'nothing' && !lengthValues(t).length
    );
  };

  /** A `Tuple` (`tuple`) or `List` literal of the values `elements`: a
   *  record when they do not make a list (`fitsList()`), else
   *  `undefined`, the list of today. With `known`, in a lowering that
   *  tracks the `Listed` of its values (`Lowering.trackListed`), the
   *  record's type holds the head of the literal (`IRType.head`), so that
   *  a function of the host takes it (CE-1652, step 5). */
  const literal = (
    e: Fn,
    elements: V[],
    tuple: boolean,
    known = false
  ): V | undefined =>
    !javascript || fitsList(elements, tuple)
      ? undefined
      : make(
          e,
          elements,
          undefined,
          [],
          known && cx.trackListed ? (tuple ? 'Tuple' : 'List') : undefined
        );

  /** Why a value of the nominal tuple type of the constructor `c` is not
   *  a vector on GLSL (`vectorRecord()` of `ir.ts`): it has two to four
   *  fields, each declared a real or an integer number (of one lane or
   *  both, as an unnamed tuple of numbers is one vector); else
   *  `undefined`. */
  const notVector = (
    c: NonNullable<ReturnType<typeof recordConstructor>>
  ): string | undefined => {
    const n = c.types.length;
    if (n < 2 || n > 4)
      return `of ${n} field${n === 1 ? '' : 's'}, not two to four`;
    const k = c.types.findIndex((d) => {
      const t = settledType(d, cx.wide);
      return (
        t === undefined ||
        t.shape.length > 0 ||
        (t.lane !== 'real' && t.lane !== 'integer')
      );
    });
    return k < 0
      ? undefined
      : `whose field ${c.names?.[k] ?? k + 1} is of type ${engineTypeToString(c.types[k])}, not a real or an integer number`;
  };

  /** `P(a, b, …)`, the constructor of the named tuple type `P`: each
   *  operand is lowered for the declared type of its field. An operand
   *  whose static type does not prove that type declines (R5); where the
   *  declared type settles an IR type the field has it, else the operand
   *  decides (`settledType()`). `Nothing` is a field of the lane
   *  `nothing`. */
  const construct = (e: Fn): V => {
    const c = recordConstructor(e)!;
    if (!javascript && !vectors)
      decline(
        e,
        `a value of the type ${c.nominal}, a record: records compile on javascript only`
      );
    if (!javascript) {
      const why = notVector(c);
      if (why !== undefined)
        decline(
          e,
          `a value of the type ${c.nominal}, a record ${why}: on glsl a record is a value of a nominal tuple type of two to four real or integer numbers (a vec2 to a vec4)`
        );
    }
    const fields: (IRType | undefined)[] = [];
    const values = e.ops.map((op, k) => {
      const d = c.types[k];
      const what = `the field ${c.names?.[k] ?? k + 1} of ${e.operator}`;
      if (isSymbol(op, 'Nothing')) {
        if (!isSubtype('nothing', d))
          decline(op, `${what}: Nothing, not ${engineTypeToString(d)}`);
        const t: IRType = { lane: 'nothing', shape: [] };
        fields.push(t);
        return b.op('nothing', [], t);
      }
      // A value of no stated type or of type `any` (a parameter that holds
      // the type of its argument, `held()` of `lower-functions.ts`): its
      // lane proves the field's type, in the function lowered for it.
      const open = !isSubtype(op.type.type, d) && isUntyped(op.type.type);
      if (!open && !isSubtype(op.type.type, d))
        decline(
          op,
          `${what}: a value of type ${engineTypeToString(op.type.type)}, which does not prove ${engineTypeToString(d)}`
        );
      const v = cx.value(op)!;
      if (open && !laneProves(type(v), tuples.has(v), d))
        decline(
          op,
          `${what}: a value of type ${engineTypeToString(op.type.type)}, here ${typeToString(type(v))}, which does not prove ${engineTypeToString(d)}`
        );
      const settled = settledType(d, cx.wide);
      fields.push(settled);
      if (settled === undefined) return v;
      const w = cx.widen(v, settled.lane);
      if (
        !isSubType(type(w), settled, cx.constant) ||
        tuples.get(w) !== tupleAxis(d)
      )
        decline(
          op,
          `${what}: a value of ${typeToString(type(w))}, not ${engineTypeToString(d)}`
        );
      return w;
    });
    return make(e, values, c, fields);
  };

  /** A dictionary literal `{k1 -> a, k2 -> b, …}` (CE-1771): the record of
   *  its values, in the order of its keys, whose field names are the keys
   *  and whose head is `Dictionary` (`IRType.head`). The keys of a
   *  dictionary are strings, so each one is known when the code is emitted.
   *  A read of a key (`d.k`, `d["k"]`) is the field of that name; a key
   *  that the literal does not have declines. */
  const dictionary = (
    e: Expression & DictionaryInterface,
    resultRecord = false
  ): V => {
    if (!javascript)
      decline(e, 'a dictionary, a record: records compile on javascript only');
    // The result of the code is an object literal of the keys, where
    // `"__proto__"` sets the prototype instead of a key.
    if (e.keys.includes('__proto__'))
      decline(e, 'a dictionary with the key __proto__');
    if (resultRecord && e.hasKey('re') && e.hasKey('im'))
      decline(
        e,
        'a tagged result with fields re and im, reserved for complex results'
      );
    const values = e.values.map((x) => {
      if (resultRecord && isFunction(x, 'List') && x.nops === 0 && cx.isLibrary(x))
        return cx.emptyList(x, 'real');
      const v = cx.value(x)!;
      if (resultRecord && (type(v).lane === 'record' || type(v).lane === 'array'))
        decline(x, 'a record or engine array in a tagged result field');
      return v;
    });
    return make(e, values, { names: e.keys }, [], 'Dictionary', resultRecord);
  };

  /** The field `k` (from 0) of the record `r`: the value it was made of,
   *  or its read. The read of a string field of a known value is that
   *  value (`Lowering.known()`); its type does not hold it. A field whose
   *  length is the constant 0 (the empty list of an outer variable,
   *  `Figure("circle", [])`) is read as the empty list of its lane, a build
   *  of no element: no value has a stated length of 0. `e` is the read. */
  const field = (e: Expression, r: V, k: number): V => {
    const known = parts.get(r)?.[k];
    if (known !== undefined) return known;
    const t = type(r);
    const { constant, ...f } = t.fields![k];
    if (f.shape.includes(0)) {
      if (f.shape.length !== 1 || t.marks?.[k] !== undefined)
        decline(
          e,
          'a read of a field that is an empty list of lists or points'
        );
      return cx.emptyList(e, f.lane);
    }
    const v = b.op('field', [r, b.constant(k, 'integer')], f);
    const listed = listedOf(cx, r);
    if (Array.isArray(listed)) cx.listed.set(v, listed[k] ?? false);
    if (constant !== undefined)
      cx.holdKnown(v, constant, `${t.nominal ?? 'record'}.${k}`);
    if (f.lane === 'string' && f.shape.length === 0) cx.mayHoldKnown(v);
    const mark = t.marks?.[k];
    if (mark !== undefined) tuples.set(v, mark);
    return v;
  };

  /** `At(r, i)` of a record: the field at the constant index `i` (from 1,
   *  or from the end when negative); another index declines. */
  const at = (e: Expression, r: V, i: V): V => {
    const t = type(r);
    // A dictionary is read by its keys only: `d["k"]` is the field `k`. Of
    // another index the interpreter's value is not the field at that
    // position.
    if (t.head === 'Dictionary') {
      const key = b.constants.get(i);
      if (typeof key !== 'string')
        decline(e, 'At of a dictionary at an index that is not a constant key');
      return named(e, r, key);
    }
    const k = elementIndex(t.fields!.length, cx.constant(i));
    if (k === undefined)
      decline(
        e,
        'At of a record at an index that is not a constant in range (a record is read at a constant position)'
      );
    return field(e, r, k);
  };

  /** `Field(r, name)`: the field of that name of a record of a named tuple
   *  type or of a dictionary. */
  const named = (e: Expression, r: V, name: string | undefined): V => {
    const t = type(r);
    if (t.lane !== 'record')
      decline(e, 'Field of a value that is not a record');
    const k = name === undefined ? -1 : (t.names?.indexOf(name) ?? -1);
    if (k < 0)
      decline(
        e,
        `Field of a record with no field ${name ?? ''} (${typeToString(t)})`
      );
    return field(e, r, k);
  };

  return { construct, literal, dictionary, at, named, make, field };
}
