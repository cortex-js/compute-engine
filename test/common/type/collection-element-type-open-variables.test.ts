/**
 * `collectionElementType()` of a type that holds an open type variable.
 *
 * A generic signature has parameter types such as `dictionary<T>` or
 * `tuple<T, U>`. `collectionElementType()` threw on `dictionary<T>`: it
 * parsed the string `tuple<string, T>`, and the parser does not know `T`.
 * On a closed record and on a tuple whose field or slot types hold a type
 * variable, it joined them with `widen()`, which requires ground types
 * (`docs/TYPE-SYSTEM.md` §4.2) and fails an assertion in a development
 * build. Now the dictionary entry type is built directly, and only the
 * ground members are joined; each open member is added to the union as it
 * is. A ground type gives an equivalent result (the entry type of a
 * dictionary of closed records keeps `closed`, and a union keeps the order
 * of its members).
 */
import { collectionElementType } from '../../../src/common/type/utils';
import type { Type } from '../../../src/common/type/types';

/** The messages of the `console.assert` calls that fail while `f` runs. */
function assertFailures(f: () => void): string[] {
  const messages: string[] = [];
  const saved = console.assert;
  console.assert = ((condition: unknown, ...rest: unknown[]) => {
    if (!condition) messages.push(rest.map((x) => String(x)).join(' '));
  }) as typeof console.assert;
  try {
    f();
  } finally {
    console.assert = saved;
  }
  return messages;
}

const T: Type = { kind: 'variable', name: 'T' };
const U: Type = { kind: 'variable', name: 'U' };

function elementOf(t: Type): { result: Type | undefined; failures: string[] } {
  let result: Type | undefined;
  const failures = assertFailures(() => {
    result = collectionElementType(t);
  });
  return { result, failures };
}

describe('collectionElementType of a type with open type variables', () => {
  test('dictionary<T> is the entry tuple<string, T>', () => {
    const { result, failures } = elementOf({ kind: 'dictionary', values: T });
    expect(result).toEqual({
      kind: 'tuple',
      elements: [{ type: 'string' }, { type: T }],
    });
    expect(failures).toEqual([]);
  });

  test('a closed record with open fields lists them as a union', () => {
    const { result, failures } = elementOf({
      kind: 'record',
      elements: { a: T, b: U },
      closed: true,
    });
    expect(result).toEqual({
      kind: 'tuple',
      elements: [
        { type: 'string' },
        { type: { kind: 'union', types: [T, U] } },
      ],
    });
    expect(failures).toEqual([]);
  });

  test('tuple<T, U> is T | U, and tuple<T, T> is T', () => {
    const tu = elementOf({
      kind: 'tuple',
      elements: [{ type: T }, { type: U }],
    });
    expect(tu.result).toEqual({ kind: 'union', types: [T, U] });
    expect(tu.failures).toEqual([]);
    const tt = elementOf({
      kind: 'tuple',
      elements: [{ type: T }, { type: T }],
    });
    expect(tt.result).toEqual(T);
    expect(tt.failures).toEqual([]);
  });

  test('the ground members are joined, and any absorbs the open ones', () => {
    const r = elementOf({
      kind: 'tuple',
      elements: [{ type: T }, { type: 'integer' }, { type: 'real' }],
    });
    expect(r.result).toEqual({ kind: 'union', types: ['real', T] });
    expect(r.failures).toEqual([]);
    expect(
      elementOf({ kind: 'tuple', elements: [{ type: 'any' }, { type: T }] })
        .result
    ).toEqual('any');
  });

  test('a nothing slot is kept beside the open members', () => {
    // `widen()` drops `nothing`; a `nothing` slot is a value of the tuple.
    const r = elementOf({
      kind: 'tuple',
      elements: [{ type: T }, { type: 'integer' }, { type: 'nothing' }],
    });
    expect(r.result).toEqual({
      kind: 'union',
      types: ['integer', 'nothing', T],
    });
    expect(r.failures).toEqual([]);
  });

  test('a variable named like a type is kept apart from that type', () => {
    // A quantified name can shadow a type name.
    const integerVar: Type = { kind: 'variable', name: 'integer' };
    const r = elementOf({
      kind: 'tuple',
      elements: [{ type: integerVar }, { type: 'integer' }],
    });
    expect(r.result).toEqual({ kind: 'union', types: ['integer', integerVar] });
    expect(r.failures).toEqual([]);
  });

  test('control: ground types are joined as before', () => {
    expect(elementOf({ kind: 'dictionary', values: 'number' }).result).toEqual({
      kind: 'tuple',
      elements: [{ type: 'string' }, { type: 'number' }],
    });
    expect(
      elementOf({
        kind: 'record',
        elements: { a: 'integer', b: 'real' },
        closed: true,
      }).result
    ).toEqual({
      kind: 'tuple',
      elements: [{ type: 'string' }, { type: 'real' }],
    });
    expect(
      elementOf({
        kind: 'tuple',
        elements: [{ type: 'integer' }, { type: 'real' }],
      }).result
    ).toEqual('real');
    // An open record has entries of any type.
    expect(elementOf({ kind: 'record', elements: { a: T } }).result).toEqual({
      kind: 'tuple',
      elements: [{ type: 'string' }, { type: 'any' }],
    });
  });
});

describe('collectionElementType of a tuple of a recursive named type', () => {
  test('does not throw on tuple<tree<T>, tree<T>>', () => {
    // A structural comparison of the members would follow the recursive
    // definition of `tree` without end.
    const { ComputeEngine } = require('../../../src/compute-engine');
    const ce = new ComputeEngine();
    ce.declareType('tree', 'tuple<value: T, children: list<tree<T>>>', {
      typeParams: [{ name: 'T', variance: 'out' }],
    });
    ce.declare('first', {
      signature: '(tuple<tree<T>, tree<T>>) -> T where T',
    });
    const param = ce.lookupDefinition('first').operator.signature.type.args[0]
      .type as Type;
    const { result, failures } = elementOf(param);
    expect(result).toBeDefined();
    expect(failures).toEqual([]);
  });
});
