import { ComputeEngine } from '../../src/compute-engine';
import { parseType } from '../../src/common/type/parse';
import type {
  Type,
  TypeReference,
  TypeResolver,
} from '../../src/common/type/types';

// `parseType` memoizes a string that names a declared type
// (`(integer_partition) -> number`) in a cache whose entries record the value
// each name resolved to. These tests check that an entry is served only while
// the resolver still answers the same, and never leaks one resolver's records
// into another's parse. GitHub issue #453.

function record(name: string): TypeReference {
  return { kind: 'reference', name, alias: false, def: 'integer' };
}

function resolverOf(records: Record<string, TypeReference>): TypeResolver {
  return {
    get names() {
      return Object.keys(records);
    },
    resolve: (name) => records[name],
    forward: () => undefined,
  };
}

function argOf(type: Type): unknown {
  return (type as { args: { type: Type }[] }).args[0].type;
}

describe('PARSE CACHE FOR STRINGS THAT NAME A DECLARED TYPE', () => {
  test('a second parse with the same resolver returns the cached result', () => {
    const r = record('i453_a');
    const resolver = resolverOf({ i453_a: r });
    const first = parseType('(i453_a) -> number', resolver);
    expect(argOf(first)).toBe(r);
    expect(parseType('(i453_a) -> number', resolver)).toBe(first);
  });

  test('another resolver object with the same answers shares the entry', () => {
    const r = record('i453_b');
    const first = parseType('(i453_b) -> real', resolverOf({ i453_b: r }));
    expect(parseType('(i453_b) -> real', resolverOf({ i453_b: r }))).toBe(
      first
    );
  });

  test('a resolver with a different record gets its own record', () => {
    const r1 = record('i453_c');
    const r2 = record('i453_c');
    expect(
      argOf(parseType('(i453_c) -> string', resolverOf({ i453_c: r1 })))
    ).toBe(r1);
    expect(
      argOf(parseType('(i453_c) -> string', resolverOf({ i453_c: r2 })))
    ).toBe(r2);
    expect(
      argOf(parseType('(i453_c) -> string', resolverOf({ i453_c: r1 })))
    ).toBe(r1);
  });

  test('two resolvers with different records each keep their entry', () => {
    const a = resolverOf({ i453_g: record('i453_g') });
    const b = resolverOf({ i453_g: record('i453_g') });
    const ta = parseType('set<i453_g>', a);
    const tb = parseType('set<i453_g>', b);
    expect(tb).not.toBe(ta);
    expect(parseType('set<i453_g>', a)).toBe(ta);
    expect(parseType('set<i453_g>', b)).toBe(tb);
  });

  test('a resolver that returns new objects does not replace an entry', () => {
    const stable = resolverOf({ i453_h: record('i453_h') });
    const fresh: TypeResolver = {
      names: ['i453_h'],
      resolve: (name) => (name === 'i453_h' ? record('i453_h') : undefined),
      forward: () => undefined,
    };
    const first = parseType('tuple<i453_h>', stable);
    parseType('tuple<i453_h>', fresh);
    expect(parseType('tuple<i453_h>', stable)).toBe(first);
  });

  test('a name that no longer resolves is an error again', () => {
    const records: Record<string, TypeReference> = { i453_d: record('i453_d') };
    const resolver = resolverOf(records);
    parseType('(i453_d) -> integer', resolver);
    delete records.i453_d;
    expect(() => parseType('(i453_d) -> integer', resolver)).toThrow(
      /Unknown type "i453_d"/
    );
  });

  test('a record that became generic makes a bare use an arity error', () => {
    const r = record('i453_e');
    const resolver = resolverOf({ i453_e: r });
    parseType('(i453_e) -> boolean', resolver);
    r.typeParams = [{ name: 'T' }];
    expect(() => parseType('(i453_e) -> boolean', resolver)).toThrow(
      /is generic/
    );
  });

  test('the cached result does not freeze the registry record', () => {
    const r = record('i453_f');
    const resolver = resolverOf({ i453_f: r });
    const type = parseType('list<i453_f>', resolver);
    parseType('list<i453_f>', resolver);
    expect(Object.isFrozen(type)).toBe(true);
    expect(Object.isFrozen(r)).toBe(false);
  });

  test('each engine resolves a shared type name to its own record', () => {
    const ce1 = new ComputeEngine();
    const ce2 = new ComputeEngine();
    ce1.declareType('i453_p', 'list<integer>', { alias: true });
    ce2.declareType('i453_p', 'list<string>', { alias: true });
    ce1.declare('i453F', { signature: '(i453_p) -> number' });
    ce2.declare('i453F', { signature: '(i453_p) -> number' });
    const ints = ['List', 1, 2];
    const strs = ['List', { str: 'a' }];
    expect(ce1.box(['i453F', ints]).isValid).toBe(true);
    expect(ce1.box(['i453F', strs]).isValid).toBe(false);
    expect(ce2.box(['i453F', ints]).isValid).toBe(false);
    expect(ce2.box(['i453F', strs]).isValid).toBe(true);
  });
});
