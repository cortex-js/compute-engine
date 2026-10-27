/**
 * A symbol declared with an open record type, at a `dictionary<V>`
 * parameter. The overlap deferral admits `record{a: integer}` at
 * `dictionary<integer>`, because the value `{a: 1}` is a dictionary of
 * integers. An open record also holds values with other fields, and a
 * dictionary parameter has no runtime conformance check, so a symbol that
 * holds a value is judged by the type of that value, which lists every
 * field. A symbol with no value is admitted on the overlap of its type.
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
  return ce;
}

describe('A HELD RECORD AT A DICTIONARY PARAMETER', () => {
  test('a held value with a field of another type is refused', () => {
    const ce = engine();
    ce.assign('r', ce.box(D(['a', 1], ['b', { str: 'x' }]) as any));
    const call = ce.box(['f', 'r']);
    expect(call.isValid).toBe(false);
    expect(call.type.toString()).toBe('error');
  });

  test('a held value with only integer fields is admitted', () => {
    const ce = engine();
    ce.assign('r', ce.box(D(['a', 1]) as any));
    const call = ce.box(['f', 'r']);
    expect(call.isValid).toBe(true);
    expect(call.type.toString()).toBe('integer');
    expect(call.evaluate().toString()).toBe('1');
  });

  test('a symbol with no value is admitted on the overlap of its type', () => {
    const ce = engine();
    const call = ce.box(['f', 'r']);
    expect(call.isValid).toBe(true);
    expect(call.type.toString()).toBe('integer');
  });
});
