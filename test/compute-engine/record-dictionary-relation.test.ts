/**
 * Record types are closed, and dictionaries are open.
 *
 * A value of `record{a: integer, b: string}` has exactly the keys `a` and
 * `b`. A field can be optional (`b: string?`): a value can leave its key
 * out. There is no width subtyping: `record{a: integer, b: string}` is not a
 * `record{a: integer}`. Depth subtyping stays. A record type is a subtype of
 * `dictionary<V>` (and of `collection<tuple<string, V>>`) when every field
 * type, optional fields too, is a subtype of `V`.
 *
 * Design: `docs/plans/2026-11-07-ce71-record-fields.md` (CE-71), which
 * replaced the open records of CE-4 and CE-10.
 */
import { ComputeEngine } from '../../src/compute-engine';
import { couldMatch, isSubtype, widen } from '../../src/common/type/subtype';
import { parseType } from '../../src/common/type/parse';
import { reduceType, typesOverlap } from '../../src/common/type/reduce';
import { typeToString } from '../../src/common/type/serialize';
import type { Type } from '../../src/common/type/types';

const ce = new ComputeEngine();

const meet = (a: string, b: string): string =>
  typeToString(
    reduceType({ kind: 'intersection', types: [parseType(a), parseType(b)] })
  );

describe('RECORD TYPES ARE CLOSED', () => {
  test('the spelling of an optional field round-trips', () => {
    for (const s of [
      'record{a: integer, b: string?}',
      'record{a: integer, b: (integer | string)?}',
      'record{`a b`: integer?}',
    ])
      expect(typeToString(parseType(s))).toBe(s);
    // The marker applies to the whole field type.
    expect(typeToString(parseType('record{b: integer | string?}'))).toBe(
      'record{b: (integer | string)?}'
    );
    // An object field cannot be optional.
    expect(() => ce.declareType('Obj', 'object{a: integer?}')).toThrow(
      /cannot be optional/
    );
  });

  test('no width subtyping, depth subtyping stays', () => {
    const S = (a: string, b: string) => isSubtype(parseType(a), parseType(b));
    expect(S('record{a: integer, b: string}', 'record{a: integer}')).toBe(
      false
    );
    expect(S('record{a: integer}', 'record{a: integer, b: string}')).toBe(
      false
    );
    expect(S('record{a: integer}', 'record{a: real}')).toBe(true);
    expect(S('record{a: integer}', 'record')).toBe(true);
  });

  test('a record with or without an optional field is below the record with it optional', () => {
    const S = (a: string, b: string) => isSubtype(parseType(a), parseType(b));
    const opt = 'record{a: integer, b: string?}';
    expect(S('record{a: integer}', opt)).toBe(true);
    expect(S('record{a: integer, b: string}', opt)).toBe(true);
    expect(S(opt, 'record{a: integer}')).toBe(false);
    expect(S(opt, 'record{a: integer, b: string}')).toBe(false);
    expect(S('record{a: integer, b: string, c: string}', opt)).toBe(false);
  });

  test('a record is a dictionary of its field types', () => {
    const S = (a: string, b: string) => isSubtype(parseType(a), parseType(b));
    expect(S('record{a: integer}', 'dictionary<integer>')).toBe(true);
    expect(S('record{a: integer, b: integer?}', 'dictionary<integer>')).toBe(
      true
    );
    expect(S('record{a: integer, b: string?}', 'dictionary<integer>')).toBe(
      false
    );
    expect(
      S('record{a: integer}', 'collection<tuple<string, integer>>')
    ).toBe(true);
    expect(
      S('record{a: integer, b: string}', 'collection<tuple<string, integer>>')
    ).toBe(false);
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
        'record{a: integer, b: string?}',
        'record{a: integer, b: integer?}',
        'record{a: integer?, b: integer?}',
        'collection<tuple<string, integer>>',
        'collection<tuple<string, any>>',
      ].map((s) => parseType(s)),
    ];
    const violations: string[] = [];
    for (const a of types)
      for (const b of types)
        if (isSubtype(a, b))
          for (const c of types)
            if (isSubtype(b, c) && !isSubtype(a, c))
              violations.push(
                `${typeToString(a)} <: ${typeToString(b)} <: ${typeToString(c)}`
              );
    expect(violations).toEqual([]);
  });
});

describe('THE JOIN AND THE MEET OF RECORD TYPES', () => {
  test('the join has the keys of both; a key of one side is optional', () => {
    const join = (a: string, b: string) =>
      typeToString(widen(parseType(a), parseType(b)));
    expect(join('record{a: integer}', 'record{a: integer, b: string}')).toBe(
      'record{a: integer, b: string?}'
    );
    expect(join('record{a: integer}', 'record{b: string}')).toBe(
      'record{a: integer?, b: string?}'
    );
    expect(join('record{a: integer, b: string?}', 'record{a: real}')).toBe(
      'record{a: real, b: string?}'
    );
  });

  test('the type of a conditional is the join of its branches', () => {
    const ce = new ComputeEngine();
    ce.declare('c', 'boolean');
    const e = ce.box([
      'If',
      'c',
      ['Dictionary', ['Tuple', "'a'", 1]],
      ['Dictionary', ['Tuple', "'a'", 2], ['Tuple', "'b'", "'x'"]],
    ]);
    expect(e.type.toString()).toBe('record{a: integer, b: string?}');
  });

  test('the meet: a key required by one side must be a key of the other', () => {
    expect(meet('record{a: integer}', 'record{b: string}')).toBe('never');
    expect(meet('record{a: integer, b: string?}', 'record{a: real}')).toBe(
      'record{a: integer}'
    );
    expect(
      meet('record{a: integer, b: string?}', 'record{a: real, b: string}')
    ).toBe('record{a: integer, b: string}');
    expect(
      meet('record{a: integer, b: string?}', 'record{a: real, b: string?}')
    ).toBe('record{a: integer, b: string?}');
    expect(meet('record{a: integer}', 'record{a: string}')).toBe('never');
    // No field left: the only value of both is the empty dictionary `{->}`.
    expect(meet('record{a: integer?}', 'record{b: string?}')).toBe(
      'dictionary<never>'
    );
    expect(meet('record{a: string?}', 'dictionary<integer>')).toBe(
      'dictionary<never>'
    );
    expect(typeToString(reduceType(parseType('record{a: never?}')))).toBe(
      'dictionary<never>'
    );
  });

  test('the empty dictionary is a value of a record whose fields are all optional', () => {
    const S = (a: string, b: string) => isSubtype(parseType(a), parseType(b));
    expect(S('dictionary<never>', 'record{a: integer?}')).toBe(true);
    expect(S('dictionary<never>', 'record{a: integer?, b: string}')).toBe(
      false
    );
    expect(S('dictionary<integer>', 'record{a: integer?}')).toBe(false);
    expect(
      typeToString(
        widen(parseType('dictionary<never>'), parseType('record{a: integer}'))
      )
    ).toBe('record{a: integer?}');
    const ce = new ComputeEngine();
    ce.declare('h', '(record{a: integer?}) -> integer');
    expect(ce.box(['h', ['Dictionary']]).isValid).toBe(true);
  });

  test('the meet with a dictionary keeps the fields, met with the values', () => {
    expect(meet('record{a: integer}', 'dictionary<number>')).toBe(
      'record{a: integer}'
    );
    expect(meet('record{a: integer, b: number}', 'dictionary<real>')).toBe(
      'record{a: integer, b: real}'
    );
    // An optional field that cannot hold a value of the dictionary is left
    // out; a required one empties the meet.
    expect(meet('record{a: integer, b: string?}', 'dictionary<number>')).toBe(
      'record{a: integer}'
    );
    expect(meet('record{a: string}', 'dictionary<integer>')).toBe('never');
  });

  test('typesOverlap and couldMatch agree with the meet', () => {
    const pairs: [string, string, boolean][] = [
      ['record{a: integer}', 'dictionary<integer>', true],
      ['record{a: integer}', 'dictionary<number>', true],
      ['record{a: number}', 'dictionary<integer>', true],
      ['record{a: integer, b: string}', 'dictionary<integer | string>', true],
      ['record{a: string}', 'dictionary<integer>', false],
      ['record{a: integer, b: string}', 'dictionary<integer>', false],
      ['record{a: integer, b: string?}', 'dictionary<integer>', true],
      ['record{a: integer}', 'record{b: integer}', false],
      ['record{a: integer?}', 'record{b: integer?}', true],
      ['record{a: integer, b: string?}', 'record{a: real}', true],
    ];
    for (const [x, y, expected] of pairs) {
      const a = parseType(x);
      const b = parseType(y);
      expect([x, y, typesOverlap(a, b)]).toEqual([x, y, expected]);
      expect([x, y, typesOverlap(b, a)]).toEqual([x, y, expected]);
      expect([x, y, couldMatch(a, b)]).toEqual([x, y, expected]);
    }
  });
});

describe('A DICTIONARY VALUE IS CHECKED BY ITS OWN FIELDS', () => {
  test('a literal matches a dictionary of its field types', () => {
    const d = ce.box(['Dictionary', ['Tuple', "'a'", 1], ['Tuple', "'b'", 2]]);
    expect(d.type.toString()).toBe('record{a: integer, b: integer}');
    expect(d.type.matches('dictionary<integer>')).toBe(true);
    expect(d.type.matches('record{a: integer, b: number}')).toBe(true);
    expect(d.type.matches('record{a: integer}')).toBe(false);
    expect(d.type.matches('record{a: integer, b: integer, c: string?}')).toBe(
      true
    );
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

  test('a declared record type refuses a value with another key', () => {
    const ce = new ComputeEngine();
    ce.declare('r', 'record{a: integer}');
    const refused = ce
      .box([
        'Assign',
        'r',
        ['Dictionary', ['Tuple', "'a'", 1], ['Tuple', "'b'", "'x'"]],
      ])
      .evaluate();
    expect(refused.toString()).toMatch(/incompatible-type/);
    expect(ce.box('r').type.matches('dictionary<integer>')).toBe(true);
  });

  test('a declared record type takes a value that leaves an optional field out', () => {
    const ce = new ComputeEngine();
    ce.declare('r', 'record{a: integer, b: string?}');
    ce.box(['Assign', 'r', ['Dictionary', ['Tuple', "'a'", 1]]]).evaluate();
    expect(ce.box('r').evaluate().toString()).toBe('{"a" -> 1}');
    ce.box([
      'Assign',
      'r',
      ['Dictionary', ['Tuple', "'a'", 1], ['Tuple', "'b'", "'x'"]],
    ]).evaluate();
    expect(ce.box('r').evaluate().toString()).toBe('{"a" -> 1, "b" -> "x"}');
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
});

describe('READS OF A RECORD', () => {
  test('a listed field gives its type; an unlisted one is refused', () => {
    const ce = new ComputeEngine();
    ce.declare('r', 'record{a: integer, b: string?}');
    expect(ce.box(['Field', 'r', "'a'"]).type.toString()).toBe('integer');
    expect(ce.box(['Field', 'r', "'b'"]).type.toString()).toBe('string');
    expect(ce.box(['At', 'r', "'b'"]).type.toString()).toBe('string');
    for (const read of [
      ['Field', 'r', "'zz'"],
      ['At', 'r', "'zz'"],
    ]) {
      const e = ce.box(read);
      expect(e.isValid).toBe(false);
      expect(e.toString()).toContain('unknown-field');
    }
  });

  test('a read with a key known only at evaluation is one of the field values', () => {
    const ce = new ComputeEngine();
    ce.declare('r', 'record{a: integer}');
    ce.declare('x', 'record{a: integer} | list<string>');
    ce.declare('k', 'string');
    expect(ce.box(['Field', 'r', 'k']).type.matches('integer | nan')).toBe(
      true
    );
    expect(
      ce.box(['At', 'x', 'k']).type.matches('integer | string | nan | missing')
    ).toBe(true);
  });

  test('a variable declared with the bare record type is not refused', () => {
    // Its type is refined from the value it holds, but its contract admits
    // a record with other keys.
    const ce = new ComputeEngine();
    ce.declare('r', 'record');
    ce.assign('r', ce.box({ dict: { a: 1 } } as any));
    expect(ce.box(['Field', 'r', "'b'"]).isValid).toBe(true);
    expect(ce.box(['Field', 'r', "'b'"]).evaluate().toString()).toBe('NaN');
  });

  test('an optional field read through a chain of keys is absent in its own domain', () => {
    const ce = new ComputeEngine();
    ce.declare('n', 'record{p: record{a: integer, b: string?}}');
    ce.assign('n', ce.box({ dict: { p: { dict: { a: 1 } } } } as any));
    expect(ce.box(['At', 'n', "'p'", "'b'"]).evaluate().toString()).toBe(
      '"Missing"'
    );
    expect(
      ce.box(['At', ['At', 'n', "'p'"], "'b'"]).evaluate().toString()
    ).toBe('"Missing"');
  });

  test('Values gives the join of the field types', () => {
    const ce = new ComputeEngine();
    ce.declare('r', 'record{a: integer, b: string}');
    expect(ce.box(['Values', 'r']).type.toString()).toBe(
      'list<integer | string>'
    );
  });
});

describe('A RECORD AT A DICTIONARY PARAMETER', () => {
  test('a symbol of a record type is an argument at a dictionary parameter', () => {
    const ce = new ComputeEngine();
    ce.declare('r', 'record{a: integer}');
    ce.declare('s', 'record{a: string}');
    ce.declare('f', '(dictionary<integer>) -> integer');
    const call = ce.box(['f', 'r']);
    expect(call.isValid).toBe(true);
    expect(call.type.toString()).toBe('integer');
    // A field that cannot hold an integer is refused.
    expect(ce.box(['f', 's']).isValid).toBe(false);
  });

  test('a record value refines the values of a dictionary placeholder', () => {
    const ce = new ComputeEngine();
    ce.declare('r', 'record{a: integer}');
    ce.declare('t', 'tuple<dictionary<unknown>>');
    ce.assign('t', ce.box(['Tuple', 'r']));
    expect(ce.box('t').type.toString()).toBe('tuple<dictionary<integer>>');
    ce.declare('u', 'tuple<dictionary<unknown>>');
    ce.assign('u', ce.box(['Tuple', ['Dictionary', ['Tuple', "'a'", 1]]]));
    expect(ce.box('u').type.toString()).toBe('tuple<dictionary<integer>>');
  });
});

describe('DeleteAt WITH A KEY', () => {
  test('removes the key from a copy, and from the record type', () => {
    const ce = new ComputeEngine();
    ce.declare('r', 'record{a: integer, b: string?}');
    ce.declare('s', 'record{a: integer, b: string}');
    ce.declare('d', 'dictionary<integer>');
    ce.declare('k', 'string');
    const T = (e: unknown) => ce.box(e as any).type.toString();
    expect(T(['DeleteAt', 'r', "'b'"])).toBe('record{a: integer}');
    expect(T(['DeleteAt', 's', "'b'"])).toBe('record{a: integer}');
    expect(T(['DeleteAt', 's', "'zz'"])).toBe('record{a: integer, b: string}');
    expect(T(['DeleteAt', 's', 'k'])).toBe('record{a: integer?, b: string?}');
    expect(T(['DeleteAt', 'd', "'a'"])).toBe('dictionary<integer>');
    expect(T(['DeleteAt', ['Dictionary', ['Tuple', "'a'", 1]], "'a'"])).toBe(
      'dictionary<never>'
    );
  });

  test('the value is a copy; a key that is not there gives the value', () => {
    const ce = new ComputeEngine();
    const lit = ['Dictionary', ['Tuple', "'a'", 1], ['Tuple', "'b'", "'x'"]];
    ce.assign('v', ce.box(lit as any));
    expect(ce.box(['DeleteAt', 'v', "'b'"]).evaluate().toString()).toBe(
      '{"a" -> 1}'
    );
    expect(ce.box(['DeleteAt', 'v', "'zz'"]).evaluate().toString()).toBe(
      '{"a" -> 1, "b" -> "x"}'
    );
    expect(ce.box('v').evaluate().toString()).toBe('{"a" -> 1, "b" -> "x"}');
  });

  test('a key that is a symbol with no value leaves the call unevaluated', () => {
    const ce = new ComputeEngine();
    const e = ce.box([
      'DeleteAt',
      ['Dictionary', ['Tuple', "'a'", 1], ['Tuple', "'b'", "'x'"]],
      'k',
    ]);
    expect(e.isValid).toBe(true);
    expect(e.evaluate().operator).toBe('DeleteAt');
  });

  test('a key that is not a string is refused', () => {
    const ce = new ComputeEngine();
    ce.declare('d', 'dictionary<integer>');
    expect(ce.box(['DeleteAt', 'd', 1]).isValid).toBe(false);
  });
});

describe('THE SECOND REVIEW OF CE-71', () => {
  test('a placeholder record type still lists its keys', () => {
    const ce = new ComputeEngine();
    ce.declare('r', 'record{a: unknown}');
    ce.assign('r', ce.box(['Dictionary', ['Tuple', "'a'", 1]]));
    expect(ce.box(['Field', 'r', "'zz'"]).isValid).toBe(false);
    expect(ce.box(['At', 'r', "'zz'"]).isValid).toBe(false);
    expect(ce.box(['Field', 'r', "'a'"]).isValid).toBe(true);
    // The bare `record` lists no field: every name is accepted.
    ce.declare('q', 'record');
    ce.assign('q', ce.box(['Dictionary', ['Tuple', "'a'", 1]]));
    expect(ce.box(['Field', 'q', "'zz'"]).isValid).toBe(true);
  });

  test('the empty dictionary is a value of the bare record', () => {
    expect(isSubtype(parseType('dictionary<never>'), 'record')).toBe(true);
    expect(couldMatch(parseType('dictionary<integer>'), 'record')).toBe(true);
    expect(meet('dictionary<integer>', 'record')).not.toBe('never');
  });

  test('an optional field of an empty type is a key every value leaves out', () => {
    const lhs: Type = {
      kind: 'record',
      elements: { a: 'integer', b: 'never' },
      optional: ['b'],
    };
    expect(isSubtype(lhs, parseType('record{a: integer}'))).toBe(true);
  });

  test('an optional field read through a list index gives its absence value', () => {
    const ce = new ComputeEngine();
    ce.declare('L', 'list<record{a: integer, b: string?}>');
    ce.assign('L', ce.box(['List', ['Dictionary', ['Tuple', "'a'", 1]]]));
    const chained = ce.box(['At', 'L', 1, "'b'"]).evaluate().toString();
    const nested = ce
      .box(['At', ['At', 'L', 1], "'b'"])
      .evaluate()
      .toString();
    expect(chained).toBe(nested);
    expect(chained).not.toBe('NaN');
  });

  test('a dictionary with a key deleted is a finite collection', () => {
    const ce = new ComputeEngine();
    const e = ce.box([
      'DeleteAt',
      ['Dictionary', ['Tuple', "'a'", 1], ['Tuple', "'b'", 2]],
      "'b'",
    ]);
    expect(e.isFiniteCollection).toBe(true);
    expect(e.isEnumerableCollection).toBe(true);
    expect(e.count).toBe(1);
  });
});
