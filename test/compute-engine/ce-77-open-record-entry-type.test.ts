import { ComputeEngine } from '../../src/compute-engine';
import { collectionElementType } from '../../src/common/type/utils';
import { parseType } from '../../src/common/type/parse';
import { typeToString } from '../../src/common/type/serialize';

/**
 * CE-77. A record type is open: `record{a: integer}` matches
 * `{a: 1, b: Missing}`, a value with a field it does not declare. The entry
 * type read from the record type was `tuple<string, integer>` (the join of the
 * declared fields), so the entry `("b", Missing)` did not match it:
 * `FlatMap(ra, x ↦ [At(x, 2)])` was an `incompatible-type` error for that
 * entry, and `Map(x ↦ At(x, 2), ra)` was typed `collection<integer>` while
 * it holds `Missing`. The entry type is now `tuple<string, any>`.
 */

const ce = new ComputeEngine();
ce.declare('ra', 'record{a: integer}');
ce.assign(
  'ra',
  ce.box([
    'Dictionary',
    ['KeyValuePair', { str: 'a' }, 1],
    ['KeyValuePair', { str: 'b' }, 'Missing'],
  ])
);

const AT2 = ['Function', ['At', 'x', 2], 'x'];

describe('CE-77: the entry type of an open record', () => {
  test('collectionElementType', () => {
    expect(
      typeToString(collectionElementType(parseType('record{a: integer}'))!)
    ).toBe('tuple<string, any>');
  });

  test('FlatMap reads the undeclared field', () => {
    const e = ce.box(['FlatMap', 'ra', ['Function', ['List', ['At', 'x', 2]], 'x']]);
    expect(e.evaluate().toString()).toBe('[1,"Missing"]');
    expect(e.type.toString()).toBe('list<any>');
  });

  test('Map is typed by the open entries', () => {
    const e = ce.box(['Map', AT2, 'ra']);
    expect(e.evaluate().toString()).toBe('Set(1, "Missing")');
    expect(e.type.toString()).toBe('collection<any>');
  });

  test('Map over Dedup of the record', () => {
    const e = ce.box(['Map', AT2, ['Dedup', 'ra']]);
    expect(e.evaluate().toString()).toBe('Set(1, "Missing")');
    expect(e.type.toString()).toBe('collection<any>');
  });

  test('Values of the record', () => {
    const e = ce.box(['Values', 'ra']);
    expect(e.evaluate().toString()).toBe('[1,"Missing"]');
    expect(e.type.toString()).toBe('list<any>');
  });

  test('At with a key the record type does not declare', () => {
    const b = ce.box(['At', 'ra', { str: 'b' }]);
    expect(b.evaluate().toString()).toBe('"Missing"');
    expect(b.type.toString()).toBe('any');
    // A declared key keeps its type.
    expect(ce.box(['At', 'ra', { str: 'a' }]).type.toString()).toBe(
      'integer'
    );
  });
});

describe('CE-77: a dictionary literal keeps the types of its fields', () => {
  const LITERAL = [
    'Dictionary',
    ['KeyValuePair', { str: 'a' }, 1],
    ['KeyValuePair', { str: 'b' }, 2],
  ];

  test('Map and FlatMap', () => {
    expect(ce.box(['Map', AT2, LITERAL]).type.toString()).toBe(
      'collection<integer>'
    );
    expect(
      ce
        .box(['FlatMap', LITERAL, ['Function', ['List', ['At', 'x', 2]], 'x']])
        .type.toString()
    ).toBe('list<integer>');
  });

  test('Values', () => {
    expect(ce.box(['Values', LITERAL]).type.toString()).toBe('list<integer>');
  });

  test('At with a key the literal does not have is the absence marker', () => {
    const e = ce.box(['At', LITERAL, { str: 'zz' }]);
    expect(e.type.toString()).toBe('nan');
    expect(e.evaluate().toString()).toBe('NaN');
  });

  test('a generic function solves from the fields of the literal', () => {
    const ce2 = new ComputeEngine();
    ce2.declare('entryOf', { signature: '(collection<T>) -> T where T' });
    expect(ce2.box(['entryOf', LITERAL]).type.toString()).toBe(
      'tuple<string, integer>'
    );
    ce2.declare('rb', 'record{a: integer}');
    expect(ce2.box(['entryOf', 'rb']).type.toString()).toBe(
      'tuple<string, any>'
    );
  });

  // The literal is solved as `dictionary<V>` only at a collection parameter
  // whose element type mentions a type variable. At any other parameter the
  // record type of the literal is kept.
  test('a record parameter in a union keeps the record type', () => {
    const ce2 = new ComputeEngine();
    ce2.declare('pickM', '(record{a: T} | missing) -> T where T');
    expect(ce2.box(['pickM', LITERAL]).type.toString()).toBe('integer');
  });

  test('a bare type variable keeps the field types', () => {
    const ce2 = new ComputeEngine();
    ce2.declare('id', '(T) -> T where T');
    const mixed = [
      'Dictionary',
      ['KeyValuePair', { str: 'a' }, 1],
      ['KeyValuePair', { str: 'b' }, { str: 'x' }],
    ];
    expect(ce2.box(['id', mixed]).type.toString()).toBe(
      'record{a: integer, b: string}'
    );
    expect(
      ce2.box(['At', ['id', mixed], { str: 'a' }]).type.toString()
    ).toBe('integer');
  });

  test('a type variable bounded by a record type', () => {
    const ce2 = new ComputeEngine();
    ce2.declare('idr', '(T) -> T where T: record{a: integer}');
    const e = ce2.box([
      'idr',
      ['Dictionary', ['KeyValuePair', { str: 'a' }, 1]],
    ]);
    expect(e.isValid).toBe(true);
    expect(e.type.toString()).toBe('record{a: integer}');
  });

  test('a callback literal is stamped as for a symbol', () => {
    const ce2 = new ComputeEngine();
    ce2.declare('app', '(record{a: T}, (T) -> U) -> U where T, U');
    const F = ['Function', ['Add', 'x', 1], 'x'];
    ce2.assign('ds', ce2.box(LITERAL));
    for (const d of [LITERAL, 'ds']) {
      const e = ce2.box(['app', d, F]);
      expect(e.ops[1].type.toString()).toBe('(x: integer) -> integer');
      expect(e.type.toString()).toBe('integer');
    }
  });

  test('a symbol with an inferred type reads the dictionary it holds', () => {
    const ce2 = new ComputeEngine();
    ce2.assign('dd', ce2.box(LITERAL));
    expect(ce2.box(['Values', 'dd']).type.toString()).toBe('list<integer>');
  });
});

describe('CE-464: a callback stamped from the current value of a symbol', () => {
  // A callback literal over a symbol is stamped with the element type of the
  // value the symbol holds when the expression is boxed. After the symbol is
  // reassigned to a value of another element type, the call is boxed again,
  // so the old boxed expression has the type and the value of a fresh box.
  // Before, the old expression kept the outdated parameter type and its
  // evaluation was an `incompatible-type` error.
  test.each([
    [
      'a list symbol',
      ['List', 1, 2],
      ['List', { str: 'a' }],
      ['Function', 'x', 'x'],
      '["a"]',
    ],
    [
      'a list symbol, numbers of another type',
      ['List', 1, 2],
      ['List', 1.5, 2.5],
      ['Function', ['Add', 'x', 1], 'x'],
      '[2.5,3.5]',
    ],
    [
      'a dictionary symbol',
      ['Dictionary', ['KeyValuePair', { str: 'a' }, 1]],
      ['Dictionary', ['KeyValuePair', { str: 'c' }, { str: 'x' }]],
      AT2,
      'Set("x")',
    ],
  ])('%s', (_name, first, second, fn, fresh) => {
    const ce2 = new ComputeEngine();
    ce2.assign('s', ce2.box(first as any));
    const old = ce2.box(['Map', fn, 's'] as any);
    expect(old.evaluate().type.matches(old.type)).toBe(true);
    ce2.assign('s', ce2.box(second as any));
    const value = old.evaluate();
    expect(value.toString()).toBe(fresh);
    expect(value.type.matches(old.type)).toBe(true);
    const box = ce2.box(['Map', fn, 's'] as any);
    expect(box.evaluate().toString()).toBe(fresh);
    expect(old.type.toString()).toBe(box.type.toString());
  });

  test('the parse route', () => {
    const ce2 = new ComputeEngine();
    ce2.assign('L', ce2.box(['List', 1, 2]));
    const exprs = [
      '\\operatorname{Map}(x\\mapsto x+1, L)',
      '\\operatorname{Filter}(L, x\\mapsto x>1)',
      '\\operatorname{Reduce}(L, (a,b)\\mapsto a+b)',
    ].map((x) => ce2.parse(x));
    expect(exprs.map((x) => x.evaluate().toString())).toEqual([
      '[2,3]',
      '[2]',
      '3',
    ]);
    ce2.assign('L', ce2.box(['List', 1.5, 2.5]));
    const values = exprs.map((x) => x.evaluate());
    expect(values.map((x) => x.toString())).toEqual([
      '[2.5,3.5]',
      '[1.5,2.5]',
      '4',
    ]);
    for (let i = 0; i < exprs.length; i++)
      expect(values[i].type.matches(exprs[i].type)).toBe(true);
  });

  test('a declared symbol keeps its stamp', () => {
    const ce2 = new ComputeEngine();
    ce2.declare('d', 'list<integer>');
    ce2.assign('d', ce2.box(['List', 1, 2]));
    const old = ce2.box(['Map', ['Function', ['Add', 'x', 1], 'x'], 'd']);
    ce2.assign('d', ce2.box(['List', 3, 4]));
    expect(old.evaluate().toString()).toBe('[4,5]');
    expect(old.evaluate().type.matches(old.type)).toBe(true);
  });

  // The element type of a symbol declared with a bare constructor follows
  // each assignment, so the stamp follows it too.
  test('a symbol declared with a bare constructor', () => {
    const ce2 = new ComputeEngine();
    ce2.declare('d', 'list');
    ce2.assign('d', ce2.box(['List', 1, 2]));
    const fn = ['Function', ['Add', 'x', 1], 'x'];
    const old = ce2.box(['Map', fn, 'd'] as any);
    expect(old.evaluate().toString()).toBe('[2,3]');
    ce2.assign('d', ce2.box(['List', 1.5, 2.5]));
    const value = old.evaluate();
    expect(value.toString()).toBe('[2.5,3.5]');
    expect(value.type.matches(old.type)).toBe(true);
    expect(ce2.box(['Map', fn, 'd'] as any).evaluate().toString()).toBe(
      '[2.5,3.5]'
    );
  });

  // The type of `s` comes from the value of `L`: an assignment to `L`
  // changes it, and the counter of `s` does not move.
  test('a symbol whose value reads another symbol', () => {
    const ce2 = new ComputeEngine();
    ce2.assign('L', ce2.box(['List', 1, 2]));
    ce2.assign('s', ce2.box(['Reverse', 'L'], { form: 'raw' }) as any);
    const fn = ['Function', ['Add', 'x', 1], 'x'];
    const old = ce2.box(['Map', fn, 's'] as any);
    expect(old.evaluate().toString()).toBe('[3,2]');
    ce2.assign('L', ce2.box(['List', 1.5, 2.5]));
    const value = old.evaluate();
    expect(value.toString()).toBe('[3.5,2.5]');
    expect(value.type.matches(old.type)).toBe(true);
    expect(ce2.box(['Map', fn, 's'] as any).evaluate().toString()).toBe(
      '[3.5,2.5]'
    );
  });

  // The callback is boxed again in the scope where the call was boxed: its
  // `offset` is the local one, not the global one.
  test('the callback keeps its lexical scope', () => {
    const ce2 = new ComputeEngine();
    ce2.assign('L', ce2.box(['List', 1, 2]));
    ce2.assign('offset', 100);
    ce2.pushScope();
    ce2.declare('offset', 'integer');
    ce2.assign('offset', 10);
    const old = ce2.box([
      'Map',
      ['Function', ['Add', 'x', 'offset'], 'x'],
      'L',
    ] as any);
    expect(old.evaluate().toString()).toBe('[11,12]');
    ce2.popScope();
    ce2.assign('L', ce2.box(['List', 1.5, 2.5]));
    const value = old.evaluate();
    expect(value.toString()).toBe('[11.5,12.5]');
    expect(value.type.matches(old.type)).toBe(true);
  });

  // The canonical handler of `Fold` gives a `Reduce`: the record is kept on
  // the `Reduce`.
  test('Fold', () => {
    const ce2 = new ComputeEngine();
    ce2.assign('L', ce2.box(['List', 1, 2]));
    const fold = ['Fold', ['Function', ['Add', 'a', 'x'], 'a', 'x'], 0, 'L'];
    const old = ce2.box(fold as any);
    expect(old.evaluate().toString()).toBe('3');
    ce2.assign('L', ce2.box(['List', 1.5, 2.5]));
    const value = old.evaluate();
    expect(value.toString()).toBe('4');
    expect(value.type.matches(old.type)).toBe(true);
    expect(ce2.box(fold as any).evaluate().toString()).toBe('4');
  });
});
