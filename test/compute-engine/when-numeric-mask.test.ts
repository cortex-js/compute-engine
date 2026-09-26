import { ComputeEngine } from '../../src/compute-engine';

// A restriction masks to the absence marker of its VALUE'S type (user
// decision 2026-09-25): `NaN` for a number, `Missing` for a point, a list, a
// string or a value that is not provably numeric. Before, every value masked
// to `Missing` (the 2026-09-09 rule), the one place the engine spelled an
// absent number as `Missing`; the two evaluation routes then disagreed on
// every numeric operator over a restriction (`2·x{c}` re-evaluated from the
// held `2x{c}` was `Missing`, evaluated fresh it was `NaN`).

const engine = () => {
  const ce = new ComputeEngine();
  ce.declare('t', 'real');
  ce.declare('x', 'real');
  return ce;
};

/** The static type, the value with `t` free, and the value once `t = -1`
 * on both routes: the held result re-evaluated, and the expression fresh. */
function probe(json: unknown) {
  const ce = engine();
  const e = ce.box(json as never);
  const held = e.evaluate();
  const r = { type: e.type.toString(), free: held.toString() };
  ce.assign('t', -1);
  return {
    ...r,
    twoStep: held.evaluate().toString(),
    fresh: e.evaluate().toString(),
  };
}
const C = ['Less', 0, 't'];

describe('a false restriction answers the marker of the value type', () => {
  test.each([
    ['a number literal', ['When', 1, C], 'integer | nan', 'NaN'],
    ['a real symbol', ['When', 'x', C], 'nan | real', 'NaN'],
    [
      'a point',
      ['When', ['Tuple', 1, 2], C],
      'missing | tuple<integer, integer>',
      '"Missing"',
    ],
    [
      'a list',
      ['When', ['List', 1, 2], C],
      'missing | vector<integer^2>',
      '"Missing"',
    ],
    ['a string', ['When', { str: 'ab' }, C], 'missing | string', '"Missing"'],
  ])('%s', (_label, json, type, absent) => {
    const r = probe(json);
    expect(r.type).toBe(type);
    expect(r.twoStep).toBe(absent);
    expect(r.fresh).toBe(absent);
  });

  test('a value not provably numeric masks to Missing', () => {
    const ce = engine();
    const e = ce.box(['When', 'q', 'False']);
    expect(e.evaluate().toString()).toBe('"Missing"');
  });

  test('an Undefined condition masks the same way', () => {
    expect(engine().box(['When', 1, 'Undefined']).evaluate().isNaN).toBe(true);
  });

  test('a masked numeric cell of a list mask is NaN', () => {
    const r = probe([
      'When',
      ['List', 10, 20, 30],
      ['Greater', ['List', 1, 2, 3], 2],
    ]);
    expect(r.type).toBe('list<number>');
    expect(r.free).toBe('[NaN,NaN,30]');
  });
});

describe('the two evaluation routes agree', () => {
  test.each([
    ['2·x{c}', ['Multiply', 2, ['When', 'x', C]], 'nan | real', 'NaN'],
    ['sin(x{c})', ['Sin', ['When', 'x', C]], 'number', 'NaN'],
    [
      'Length([1,2]{c})',
      ['Length', ['When', ['List', 1, 2], C]],
      'number',
      'NaN',
    ],
    ['Sum([1,2]{c})', ['Sum', ['When', ['List', 1, 2], C]], 'number', 'NaN'],
    [
      '[1,2,3] + 2{c}',
      ['Add', ['List', 1, 2, 3], ['When', 2, C]],
      'list<integer | nan^3>',
      '[NaN,NaN,NaN]',
    ],
    [
      '2{c}·(1,2)',
      ['Multiply', ['When', 2, C], ['Tuple', 1, 2]],
      'tuple<integer | nan, integer | nan>',
      '(NaN, NaN)',
    ],
    [
      '2{c}·[(1,2),(3,4)]',
      ['Multiply', ['When', 2, C], ['List', ['Tuple', 1, 2], ['Tuple', 3, 4]]],
      'list<tuple<integer | nan, integer | nan>^2>',
      '[(NaN, NaN),(NaN, NaN)]',
    ],
    [
      '[1,2]{c} + 1',
      ['Add', ['When', ['List', 1, 2], C], 1],
      'missing | vector<integer^2>',
      '"Missing"',
    ],
    [
      '(1,2){c} + (1,1)',
      ['Add', ['When', ['Tuple', 1, 2], C], ['Tuple', 1, 1]],
      'missing | tuple<integer, integer>',
      '"Missing"',
    ],
  ])('%s', (_label, json, type, absent) => {
    const r = probe(json);
    expect(r.type).toBe(type);
    expect(r.twoStep).toBe(absent);
    expect(r.fresh).toBe(absent);
  });

  test('a scalar restriction beside a list lands in each cell of the held result', () => {
    // It was the whole-list restriction `[3,4,5]{0 < t}`, `Missing` once
    // `t = -1`, where the fresh route answered `[NaN, NaN, NaN]`.
    const r = probe(['Add', ['List', 1, 2, 3], ['When', 2, C]]);
    expect(r.free).toBe('[3 {0 < t},4 {0 < t},5 {0 < t}]');
    const p = probe(['Multiply', ['When', 2, C], ['Tuple', 1, 2]]);
    expect(p.free).toBe('(2 {0 < t}, 4 {0 < t})');
  });

  test('a list restriction and a scalar restriction with different conditions stay apart', () => {
    // The scalar guard lands in the cells, the list guard stays around the
    // whole result, so the list is still one restriction: `Missing` once
    // its own condition fails, whatever the scalar's condition. (Folded
    // into one cell-wise conjunction the held value answered `[NaN, NaN]`.)
    const ce = new ComputeEngine();
    ce.declare('a', 'real');
    ce.declare('b', 'real');
    const e = ce.box([
      'Add',
      ['When', ['List', 1, 2], ['Greater', 'a', 0]],
      ['When', 2, ['Greater', 'b', 0]],
    ]);
    const held = e.evaluate();
    expect(held.toString()).toBe('[3 {0 < b},4 {0 < b}] {0 < a}');
    ce.assign('a', -1);
    expect(held.evaluate().toString()).toBe('"Missing"');
    ce.assign('a', ce.symbol('a'));
    ce.assign('b', -1);
    expect(held.evaluate().toString()).toBe('[NaN,NaN] {0 < a}');
    expect(e.evaluate().toString()).toBe('[NaN,NaN] {0 < a}');
    // One condition restricting a scalar and a point is one restriction.
    expect(
      ce
        .box(['Multiply', ['When', 2, C], ['When', ['Tuple', 1, 2], C]])
        .evaluate()
        .toString()
    ).toBe('(2, 4) {0 < t}');
  });

  test('a gated numeric value still binds to a declared range and an assumption', () => {
    const ce = new ComputeEngine();
    ce.declare('e', 'integer<3<..>');
    ce.assign('e', ce.parse('5\\{a>0\\}'));
    expect(ce.box('e').evaluate().toString()).toBe('5 {0 < a}');
    const ce2 = new ComputeEngine();
    ce2.assume(ce2.parse('v > 3'));
    ce2.assign('v', ce2.parse('5\\{a>0\\}'));
    expect(ce2.box('v').evaluate().toString()).toBe('5 {0 < a}');
  });

  test('a selection with no selected clause is unchanged: Missing', () => {
    const ce = engine();
    expect(ce.box(['Which', 'False', 5]).evaluate().toString()).toBe(
      '"Missing"'
    );
    expect(ce.box(['If', 'False', 5]).evaluate().toString()).toBe('"Missing"');
  });
});
