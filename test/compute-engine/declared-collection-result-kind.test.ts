import { ComputeEngine } from '../../src/compute-engine';
import { isSubtype } from '../../src/common/type/subtype';

// A symbol DECLARED with an abstract collection type (`collection<number>`,
// `collection<any>`, bare `collection`) may hold a list, a set or a range. At
// evaluation, the kind of the result of a collection operator over such a
// symbol must follow the value the symbol holds, not its declared type: a
// list maps to a list (order and duplicates kept), a set to a set, a range to
// a list. Before the fix, `Map`, `Filter` and `Scan` over such a symbol
// holding a list materialized as a `Set`, because the result kind was read
// from the static type `collection<T>`, which is not indexed.
//
// Each row compares the operator applied to the symbol with the SAME operator
// applied to the literal value the symbol holds (the expected answer), and
// checks that the static type of the unevaluated expression is a supertype of
// the type of the materialized value.

const ce = new ComputeEngine();

type MathJson = any;

const DECLARATIONS = [
  'collection<number>',
  'collection<any>',
  'collection',
  'indexed_collection<number>',
];

const VALUES: [string, MathJson][] = [
  ['list', ['List', 3, 1, 1]],
  ['set', ['Set', 3, 1]],
  ['range', ['Range', 1, 3]],
];

const DOUBLE = ['Function', ['Multiply', 2, 'x'], 'x'];
const GREATER_THAN_ONE = ['Function', ['Greater', 'x', 1], 'x'];
const ADD = ['Function', ['Add', 'a', 'b'], 'a', 'b'];

// `acceptsSet` is false for an operator that requires an indexed source: the
// literal over a set is then a type error, and the row only checks that the
// symbol route gives the same error.
const OPERATORS: [string, (s: MathJson) => MathJson, boolean][] = [
  ['Map', (s) => ['Map', DOUBLE, s], true],
  ['Filter', (s) => ['Filter', s, GREATER_THAN_ONE], true],
  ['Scan', (s) => ['Scan', s, ADD], true],
  ['Take', (s) => ['Take', s, 2], false],
  ['Drop', (s) => ['Drop', s, 1], false],
  ['Reverse', (s) => ['Reverse', s], false],
  ['Sort', (s) => ['Sort', s], false],
  ['Unique', (s) => ['Unique', s], true],
  ['Join', (s) => ['Join', s, ['List', 5]], true],
  ['Append', (s) => ['Append', s, 5], true],
  ['Zip', (s) => ['Zip', s, ['List', 7, 8, 9]], false],
  ['Flatten', (s) => ['Flatten', s], false],
  [
    'Comprehension',
    (s) => ['Comprehension', ['Multiply', 2, 'x'], ['Element', 'x', s]],
    true,
  ],
  ['Add', (s) => ['Add', s, 1], false],
  ['Sin', (s) => ['Sin', s], false],
];

let counter = 0;
function declared(declaration: string, value: MathJson): string {
  const name = `P${++counter}`;
  ce.declare(name, declaration);
  ce.assign(name, ce.box(value));
  return name;
}

function materialized(json: MathJson) {
  return ce.box(json).evaluate({ materialization: true });
}

describe('Collection operators over a symbol declared with an abstract collection type', () => {
  for (const [op, make, acceptsSet] of OPERATORS) {
    for (const declaration of DECLARATIONS) {
      for (const [valueName, value] of VALUES) {
        // A symbol declared `indexed_collection<number>` cannot hold a set:
        // the assignment is refused.
        if (declaration.startsWith('indexed_collection') && valueName === 'set')
          continue;
        test(`${op} over ${declaration} holding a ${valueName}`, () => {
          const name = declared(declaration, value);
          if (valueName === 'set' && !acceptsSet) {
            // The operator requires an indexed source: both routes answer
            // the same type error about the set.
            expect(ce.box(make(name)).evaluate().toString()).toEqual(
              ce.box(make(value)).evaluate().toString()
            );
            return;
          }
          const expr = ce.box(make(name));
          const result = materialized(make(name));
          const expected = materialized(make(value));
          expect(result.toString()).toEqual(expected.toString());
          expect(result.operator).toEqual(expected.operator);
          expect(isSubtype(result.type.type, expr.type.type)).toBe(true);
        });
      }
    }
  }
});

describe('Evaluated value of a kind-preserving operator over a declared collection', () => {
  test('Map over a list keeps order and duplicates', () => {
    const name = declared('collection<number>', ['List', 3, 1, 1]);
    const r = ce.box(['Map', DOUBLE, name]).evaluate();
    expect(r.isIndexedCollection).toBe(true);
    expect(r.toString()).toBe('[6,2,2]');
    // The static type stays the declared, wider kind.
    expect(r.type.toString()).toBe('collection<number>');
  });

  test('Filter over a list keeps order and duplicates', () => {
    const name = declared('collection<number>', ['List', 3, 1, 1]);
    const r = ce.box(['Filter', name, ['Function', ['Greater', 'x', 0], 'x']]);
    expect(r.evaluate().toString()).toBe('[3,1,1]');
  });

  test('Map over a set is a set', () => {
    const name = declared('collection<number>', ['Set', 3, 1]);
    const r = ce.box(['Map', DOUBLE, name]).evaluate();
    expect(r.isIndexedCollection).toBe(false);
    expect(r.toString()).toBe('Set(6, 2)');
  });

  test('the result kind follows a later assignment', () => {
    const name = declared('collection<number>', ['List', 3, 1, 1]);
    const expr = ce.box(['Map', DOUBLE, name]);
    expect(expr.evaluate({ materialization: true }).operator).toBe('List');
    ce.assign(name, ce.box(['Set', 3, 1]));
    expect(expr.evaluate({ materialization: true }).operator).toBe('Set');
  });

  test('a nested Map over a list is a list', () => {
    const name = declared('collection<number>', ['List', 3, 1, 1]);
    const r = ce.box(['Map', DOUBLE, ['Map', DOUBLE, name]]).evaluate();
    expect(r.toString()).toBe('[12,4,4]');
  });

  test('a Map over a list takes part in an arithmetic broadcast', () => {
    const name = declared('collection<number>', ['List', 3, 1, 1]);
    const r = ce.box(['Add', ['Map', DOUBLE, name], 1]).evaluate();
    expect(r.toString()).toBe('[7,3,3]');
  });

  // `Join` and `Append` adopt the kind of an operand, and an operand declared
  // with an abstract collection type may hold a set: their static type is
  // then `collection<T>`, and the value is a set with or without a
  // materializing evaluation (user decision 2026-09-29).
  test('Join and Append over a declared collection holding a set are sets', () => {
    const name = declared('collection<number>', ['Set', 3, 1]);
    expect(
      ce
        .box(['Join', name, ['List', 5]])
        .evaluate()
        .toString()
    ).toBe('Set(3, 1, 5)');
    expect(ce.box(['Append', name, 5]).evaluate().toString()).toBe(
      'Set(3, 1, 5)'
    );
    for (const json of [
      ['Join', name, ['List', 5]],
      ['Append', name, 5],
    ]) {
      const expr = ce.box(json);
      expect(expr.type.toString()).toBe('collection<number>');
      const r = expr.evaluate({ materialization: true });
      expect(r.operator).toBe('Set');
      expect(r.toString()).toBe('Set(3, 1, 5)');
    }
  });
});

describe('LaTeX route over a symbol declared collection<number> holding a list', () => {
  const name = 'Q';
  beforeAll(() => {
    ce.declare(name, 'collection<number>');
    ce.assign(name, ce.box(['List', 3, 1, 1]));
  });

  const CASES: [string, string][] = [
    ['\\operatorname{Map}(x\\mapsto 2x, Q)', '[6,2,2]'],
    ['\\operatorname{Filter}(Q, x\\mapsto x>0)', '[3,1,1]'],
    ['\\operatorname{Scan}(Q, (a,b)\\mapsto a+b)', '[3,4,5]'],
    ['\\operatorname{Take}(Q, 2)', '[3,1]'],
    ['\\operatorname{Drop}(Q, 1)', '[1,1]'],
    ['\\operatorname{Reverse}(Q)', '[1,1,3]'],
    ['\\operatorname{Sort}(Q)', '[1,1,3]'],
    ['\\operatorname{Unique}(Q)', '[3,1]'],
    ['\\operatorname{Join}(Q, [5])', '[3,1,1,5]'],
    ['\\operatorname{Append}(Q, 5)', '[3,1,1,5]'],
    ['\\operatorname{Zip}(Q, [7,8,9])', '[(3, 7),(1, 8),(1, 9)]'],
    ['\\operatorname{Flatten}(Q)', '[3,1,1]'],
    ['2x \\operatorname{for} x = Q', '[6,2,2]'],
    ['Q+1', '[4,2,2]'],
    ['\\sin(Q)', '[sin(3),sin(1),sin(1)]'],
  ];

  for (const [latex, expected] of CASES) {
    test(latex, () => {
      const expr = ce.parse(latex);
      const result = expr.evaluate({ materialization: true });
      expect(result.toString()).toEqual(expected);
      expect(isSubtype(result.type.type, expr.type.type)).toBe(true);
    });
  }
});

describe('Only the abstract sources decide the kind of a lazy node', () => {
  const double = ['Function', ['Multiply', 2, 'x'], 'x'];

  test('a Scan over a list keeps its order and duplicates when its seed is a collection', () => {
    // The seed of a `Scan` is a collection operand that is not a source: a
    // list seed must not be read as a second source, and the result is the
    // list of the running values.
    const engine = new ComputeEngine();
    engine.declare('P', 'collection<number>');
    engine.assign('P', engine.box(['List', 3, 1, 1]));
    const r = engine
      .box(['Scan', 'P', ['Function', ['Add', 'a', 'x'], 'a', 'x'], 0])
      .evaluate({ materialization: true });
    expect(r.json).toEqual(['List', 3, 4, 5]);
  });

  test('a source declared collection<T> that holds no value is not read as a list', () => {
    const engine = new ComputeEngine();
    engine.declare('P', 'collection<number>');
    const node = engine.box(['Map', double, 'P']);
    expect(node.isIndexedCollection).toBe(false);
    engine.assign('P', engine.box(['List', 3, 1, 1]));
    expect(engine.box(['Map', double, 'P']).isIndexedCollection).toBe(true);
  });

  test('the kind follows a later assignment of the source', () => {
    const engine = new ComputeEngine();
    engine.declare('P', 'collection<number>');
    engine.assign('P', engine.box(['List', 3, 1, 1]));
    const node = ['Map', double, 'P'];
    expect(
      engine.box(node).evaluate({ materialization: true }).json
    ).toEqual(['List', 6, 2, 2]);
    engine.assign('P', engine.box(['Set', 3, 1]));
    expect(
      engine.box(node).evaluate({ materialization: true }).operator
    ).toBe('Set');
  });

  test('Sort over a source that holds a set is the type error of the literal', () => {
    const engine = new ComputeEngine();
    engine.declare('P', 'collection<number>');
    engine.assign('P', engine.box(['Set', 3, 1]));
    const r = engine.box(['Sort', 'P']).evaluate();
    expect(r.toString()).toContain('incompatible-type');
    expect(r.toString()).not.toContain('internal-error');
  });
});
