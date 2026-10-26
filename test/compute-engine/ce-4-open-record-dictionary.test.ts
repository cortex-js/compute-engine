/**
 * CE-4 and CE-10. A record type is open: `record{a: integer}` also holds
 * values with other fields, of any type. So it is a `dictionary<T>` (and a
 * `collection<tuple<string, T>>`) only when `T` holds every value. The type
 * of a dictionary VALUE is a closed record: the value has exactly the listed
 * fields, so `{a: 1}` is still a `dictionary<integer>`.
 *
 * Before the change, `record{a: integer} <: dictionary<integer>` was true,
 * and the relation was not transitive:
 * `record{a: integer, b: string} <: record{a: integer} <: dictionary<integer>`
 * but `record{a: integer, b: string}` is not a `dictionary<integer>`.
 */
import { ComputeEngine } from '../../src/compute-engine';
import { couldMatch, isSubtype } from '../../src/common/type/subtype';
import { parseType } from '../../src/common/type/parse';
import { reduceType, typesOverlap } from '../../src/common/type/reduce';
import { typeToIdentityKey } from '../../src/common/type/serialize';
import type { Type } from '../../src/common/type/types';

const ce = new ComputeEngine();

const closed = (elements: Record<string, Type>): Type => ({
  kind: 'record',
  elements,
  closed: true,
});

describe('CE-4: an open record is not a dictionary of its listed fields', () => {
  test('the relation reads the record as open', () => {
    const r = parseType('record{a: integer}');
    expect(isSubtype(r, parseType('dictionary<integer>'))).toBe(false);
    expect(isSubtype(r, parseType('dictionary<any>'))).toBe(true);
    expect(isSubtype(r, parseType('dictionary'))).toBe(true);
    expect(isSubtype(r, parseType('collection<tuple<string, integer>>'))).toBe(
      false
    );
    expect(isSubtype(r, parseType('collection<tuple<string, any>>'))).toBe(
      true
    );
  });

  test('a closed record is a dictionary of its field types', () => {
    const c = closed({ a: 'integer', b: 'integer' });
    expect(isSubtype(c, parseType('dictionary<integer>'))).toBe(true);
    expect(isSubtype(c, parseType('collection<tuple<string, integer>>'))).toBe(
      true
    );
    expect(isSubtype(c, parseType('record{a: integer}'))).toBe(true);
    expect(
      isSubtype(
        closed({ a: 'integer', b: 'string' }),
        parseType('dictionary<integer>')
      )
    ).toBe(false);
  });

  test('only a closed record with the same keys is below a closed record', () => {
    const c = closed({ a: 'integer' });
    expect(isSubtype(parseType('record{a: integer}'), c)).toBe(false);
    expect(isSubtype(closed({ a: 'integer', b: 'integer' }), c)).toBe(false);
    expect(isSubtype(closed({ a: 'integer' }), closed({ a: 'number' }))).toBe(
      true
    );
  });

  test('the relation is transitive over records and dictionaries', () => {
    const types: Type[] = [
      'any',
      'unknown',
      'record',
      'dictionary',
      'collection',
      ...[
        'dictionary<integer>',
        'dictionary<number>',
        'dictionary<any>',
        'record{a: integer}',
        'record{a: number}',
        'record{a: integer, b: any}',
        'record{a: integer, b: string}',
        'record{a: integer, b: integer}',
        'collection<tuple<string, integer>>',
        'collection<tuple<string, any>>',
      ].map((s) => parseType(s)),
      closed({ a: 'integer' }),
      closed({ a: 'integer', b: 'integer' }),
      closed({ a: 'integer', b: 'string' }),
      closed({ a: 'integer', b: 'any' }),
    ];
    const violations: string[] = [];
    for (const a of types)
      for (const b of types)
        if (isSubtype(a, b))
          for (const c of types)
            if (isSubtype(b, c) && !isSubtype(a, c))
              violations.push(
                `${JSON.stringify(a)} <: ${JSON.stringify(b)} <: ${JSON.stringify(c)}`
              );
    expect(violations).toEqual([]);
  });
});

describe('CE-4: a dictionary value is checked by its own fields', () => {
  test('a literal matches a dictionary of its field types', () => {
    const d = ce.box(['Dictionary', ['Tuple', "'a'", 1], ['Tuple', "'b'", 2]]);
    expect(d.type.toString()).toBe('record{a: integer, b: integer}');
    expect(d.type.matches('dictionary<integer>')).toBe(true);
    expect(d.type.matches('record{a: integer}')).toBe(true);
    const v = d.evaluate();
    expect(v.type.matches(d.type)).toBe(true);
  });

  test('a literal with a field of another type is not a dictionary<integer>', () => {
    const d = ce.box([
      'Dictionary',
      ['Tuple', "'a'", 1],
      ['Tuple', "'b'", "'x'"],
    ]);
    expect(d.type.matches('dictionary<integer>')).toBe(false);
    expect(d.type.matches('dictionary<integer | string>')).toBe(true);
  });

  test('a declared dictionary<integer> takes a literal value', () => {
    const ce = new ComputeEngine();
    ce.declare('d', 'dictionary<integer>');
    ce.box(['Assign', 'd', ['Dictionary', ['Tuple', "'a'", 1]]]).evaluate();
    expect(ce.box('d').evaluate().toString()).toBe('{"a" -> 1}');
    const refused = ce
      .box(['Assign', 'd', ['Dictionary', ['Tuple', "'a'", "'x'"]]])
      .evaluate();
    expect(refused.toString()).toMatch(/incompatible-type/);
  });

  test('a nested literal matches nested dictionary types', () => {
    const l = ce.box([
      'List',
      ['Dictionary', ['Tuple', "'a'", 1]],
      ['Dictionary', ['Tuple', "'a'", 2]],
    ]);
    expect(l.type.matches('list<dictionary<integer>>')).toBe(true);
    const n = ce.box([
      'Dictionary',
      ['Tuple', "'p'", ['Dictionary', ['Tuple', "'a'", 1]]],
    ]);
    expect(n.type.matches('dictionary<dictionary<integer>>')).toBe(true);
    expect(n.evaluate().type.matches(n.type)).toBe(true);
  });

  test('a symbol declared with an open record type is not a dictionary<integer>', () => {
    const ce = new ComputeEngine();
    ce.declare('r', 'record{a: integer}');
    expect(ce.box('r').type.matches('dictionary<integer>')).toBe(false);
    // It can hold a value with another field, of another type.
    ce.box([
      'Assign',
      'r',
      ['Dictionary', ['Tuple', "'a'", 1], ['Tuple', "'b'", "'x'"]],
    ]).evaluate();
    expect(ce.box('r').evaluate().type.matches('dictionary<integer>')).toBe(
      false
    );
  });

  test('the union of a literal type and an open record type is the open record', () => {
    const ce = new ComputeEngine();
    const literal = ce.box(['Dictionary', ['Tuple', "'a'", 1]]).type.type;
    const open = parseType('record{a: integer}');
    for (const types of [
      [literal, open],
      [open, literal],
    ]) {
      const u = reduceType({ kind: 'union', types });
      expect(isSubtype(u, open)).toBe(true);
      expect(isSubtype(u, parseType('dictionary<integer>'))).toBe(false);
    }
  });
});

describe('CE-4: a read by a key known only at evaluation', () => {
  test('a Field read with a dynamic name on an open record can be any value', () => {
    const ce = new ComputeEngine();
    ce.declare('r', 'record{a: integer}');
    ce.declare('k', 'string');
    const e = ce.box(['Field', 'r', 'k']);
    expect(e.type.matches('integer')).toBe(false);
  });

  test('an At read on a union with an open record arm can be any value', () => {
    const ce = new ComputeEngine();
    ce.declare('x', 'record{a: integer} | list<string>');
    ce.declare('k', 'string');
    const e = ce.box(['At', 'x', 'k']);
    expect(e.type.matches('integer | string')).toBe(false);
  });
});

describe('CE-4: a record type and a dictionary type share the values with the listed fields', () => {
  const meet = (a: Type, b: Type): Type =>
    reduceType({ kind: 'intersection', types: [a, b] });

  test('the meet is the closed record of the fields met with the values', () => {
    const r = parseType('record{a: integer}');
    const d = parseType('dictionary<integer>');
    for (const m of [meet(r, d), meet(d, r)])
      expect(typeToIdentityKey(m)).toBe(
        typeToIdentityKey(closed({ a: 'integer' }))
      );
    expect(
      typeToIdentityKey(
        meet(
          parseType('record{a: integer, b: number}'),
          parseType('dictionary<real>')
        )
      )
    ).toBe(typeToIdentityKey(closed({ a: 'integer', b: 'real' })));
    // A field that cannot hold a value of the dictionary empties the meet.
    expect(meet(parseType('record{a: string}'), d)).toBe('never');
  });

  test('typesOverlap and couldMatch agree with the meet', () => {
    const pairs: [string, string, boolean][] = [
      ['record{a: integer}', 'dictionary<integer>', true],
      ['record{a: integer}', 'dictionary<number>', true],
      ['record{a: number}', 'dictionary<integer>', true],
      ['record{a: integer, b: string}', 'dictionary<integer | string>', true],
      ['record{a: string}', 'dictionary<integer>', false],
      ['record{a: integer, b: string}', 'dictionary<integer>', false],
    ];
    for (const [x, y, expected] of pairs) {
      const a = parseType(x);
      const b = parseType(y);
      expect([x, y, typesOverlap(a, b)]).toEqual([x, y, expected]);
      expect([x, y, typesOverlap(b, a)]).toEqual([x, y, expected]);
      expect([x, y, couldMatch(a, b)]).toEqual([x, y, expected]);
    }
  });

  test('a symbol typed with an open record is an argument at a dictionary parameter', () => {
    const ce = new ComputeEngine();
    ce.declare('r', 'record{a: integer}');
    ce.declare('s', 'record{a: string}');
    ce.declare('f', '(dictionary<integer>) -> integer');
    const call = ce.box(['f', 'r']);
    expect(call.isValid).toBe(true);
    expect(call.type.toString()).toBe('integer');
    // A field that cannot hold an integer is refused.
    expect(ce.box(['f', 's']).isValid).toBe(false);
    // The symbol holds a value with the listed fields only, which is a
    // `dictionary<integer>`.
    ce.assign('r', ce.box(['Dictionary', ['Tuple', "'a'", 1]]));
    expect(ce.box('r').evaluate().type.matches('dictionary<integer>')).toBe(
      true
    );
    const after = ce.box(['f', 'r']);
    expect(after.isValid).toBe(true);
    expect(after.type.toString()).toBe('integer');
  });

  test('an open record value does not refine the values of a dictionary placeholder', () => {
    const ce = new ComputeEngine();
    ce.declare('r', 'record{a: integer}');
    ce.declare('t', 'tuple<dictionary<unknown>>');
    ce.assign('t', ce.box(['Tuple', 'r']));
    expect(ce.box('t').type.toString()).toBe('tuple<dictionary<unknown>>');
    // A dictionary value lists all its fields, so it refines the values.
    ce.declare('u', 'tuple<dictionary<unknown>>');
    ce.assign('u', ce.box(['Tuple', ['Dictionary', ['Tuple', "'a'", 1]]]));
    expect(ce.box('u').type.toString()).toBe('tuple<dictionary<integer>>');
  });
});
