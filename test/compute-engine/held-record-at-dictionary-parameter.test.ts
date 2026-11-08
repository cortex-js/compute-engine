/**
 * A symbol declared with a record type, at a `dictionary<V>` parameter.
 *
 * Record types are closed: a value has only the fields its type lists. So
 * `record{a: integer}` is a `dictionary<integer>`, and a value with another
 * field cannot be assigned to a symbol of that type.
 *
 * A record type with an optional field of another type,
 * `record{a: integer, b: string?}`, is not a `dictionary<integer>`, but the
 * two types overlap: a value can leave `b` out. A dictionary parameter has
 * no runtime conformance check, so a symbol that holds a value is judged by
 * the type of that value. A symbol with no value is admitted on the overlap
 * of its type.
 */
import { ComputeEngine } from '../../src/compute-engine';

const D = (...entries: [string, unknown][]) => [
  'Dictionary',
  ...entries.map(([k, v]) => ['Tuple', { str: k }, v]),
];

function engine(): ComputeEngine {
  const ce = new ComputeEngine();
  ce.declare('f', '(dictionary<integer>) -> integer');
  ce.assign('f', ce.box(['Function', ['Length', 'd'], 'd'] as any));
  ce.declare('r', 'record{a: integer}');
  ce.declare('s', 'record{a: integer, b: string?}');
  return ce;
}

describe('A HELD RECORD AT A DICTIONARY PARAMETER', () => {
  test('a record of integer fields is a dictionary of integers', () => {
    const ce = engine();
    const call = ce.box(['f', 'r']);
    expect(call.isValid).toBe(true);
    expect(call.type.toString()).toBe('integer');
  });

  test('a value with a field that the record type does not list is not assigned', () => {
    const ce = engine();
    expect(() =>
      ce.assign('r', ce.box(D(['a', 1], ['b', { str: 'x' }]) as any))
    ).toThrow(/not compatible/);
  });

  test('a held value with an optional field of another type is refused', () => {
    const ce = engine();
    ce.assign('s', ce.box(D(['a', 1], ['b', { str: 'x' }]) as any));
    const call = ce.box(['f', 's']);
    expect(call.isValid).toBe(false);
    expect(call.type.toString()).toBe('error');
  });

  test('a held value that leaves the optional field out is admitted', () => {
    const ce = engine();
    ce.assign('s', ce.box(D(['a', 1]) as any));
    const call = ce.box(['f', 's']);
    expect(call.isValid).toBe(true);
    expect(call.type.toString()).toBe('integer');
    expect(call.evaluate().toString()).toBe('1');
  });

  test('a symbol with no value is admitted on the overlap of its type', () => {
    const ce = engine();
    const call = ce.box(['f', 's']);
    expect(call.isValid).toBe(true);
    expect(call.type.toString()).toBe('integer');
  });
});
