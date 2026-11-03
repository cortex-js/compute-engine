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
    ['a number literal', ['If', C, 1], 'integer', 'NaN'],
    ['a real symbol', ['If', C, 'x'], 'real', 'NaN'],
    [
      'a point',
      ['If', C, ['Tuple', 1, 2]],
      'tuple<integer, integer>',
      '(NaN, NaN)',
    ],
    ['a list', ['If', C, ['List', 1, 2]], 'vector<integer^2>', '"Missing"'],
    ['a string', ['If', C, { str: 'ab' }], 'string', '"Missing"'],
  ])('%s', (_label, json, type, absent) => {
    const r = probe(json);
    expect(r.type).toBe(type);
    expect(r.twoStep).toBe(absent);
    expect(r.fresh).toBe(absent);
  });

  test('a value not provably numeric masks to Missing', () => {
    const ce = engine();
    const e = ce.box(['If', 'False', 'q']);
    expect(e.evaluate().toString()).toBe('"Missing"');
  });

  test('an Undefined condition is held', () => {
    // `Undefined` is an ordinary symbol with no value, not an absent value
    // (`docs/ERROR-MODEL.md`, "`Missing` is a result only"): the condition
    // is not decided. It masked to `NaN` while `Undefined` was absent.
    expect(engine().box(['If', 'Undefined', 1]).evaluate().operator).toBe(
      'If'
    );
  });

  test('a masked numeric cell of a list mask is NaN', () => {
    const r = probe([
      'If',
      ['Greater', ['List', 1, 2, 3], 2],
      ['List', 10, 20, 30],
    ]);
    expect(r.type).toBe('list<number>');
    expect(r.free).toBe('[NaN,NaN,30]');
  });
});

describe('the two evaluation routes agree', () => {
  test.each([
    ['2·x{c}', ['Multiply', 2, ['If', C, 'x']], 'real', 'NaN'],
    ['sin(x{c})', ['Sin', ['If', C, 'x']], 'real', 'NaN'],
    // An operator over an absent collection is `Missing` (`docs/ERROR-MODEL.md`,
    // "`Missing` is a result only", rule 3), `Length` and `Sum` included
    // (`Length(Missing)` is `Missing`, `absent-collection-operand.test.ts`).
    [
      'Length([1,2]{c})',
      ['Length', ['If', C, ['List', 1, 2]]],
      'integer',
      '"Missing"',
    ],
    [
      'Sum([1,2]{c})',
      ['Sum', ['If', C, ['List', 1, 2]]],
      'integer',
      '"Missing"',
    ],
    [
      '[1,2,3] + 2{c}',
      ['Add', ['List', 1, 2, 3], ['If', C, 2]],
      'vector<integer^3>',
      '[NaN,NaN,NaN]',
    ],
    [
      '2{c}·(1,2)',
      ['Multiply', ['If', C, 2], ['Tuple', 1, 2]],
      'tuple<integer, integer>',
      '(NaN, NaN)',
    ],
    [
      '2{c}·[(1,2),(3,4)]',
      ['Multiply', ['If', C, 2], ['List', ['Tuple', 1, 2], ['Tuple', 3, 4]]],
      'list<tuple<integer, integer>^2>',
      '[(NaN, NaN),(NaN, NaN)]',
    ],
    // A scalar condition selects the list whole: the sum is the absent list
    // (selection rule of 2026-11-02; it was `[NaN,NaN]`).
    [
      '[1,2]{c} + 1',
      ['Add', ['If', C, ['List', 1, 2]], 1],
      'vector<integer^2>',
      '"Missing"',
    ],
    [
      '(1,2){c} + (1,1)',
      ['Add', ['If', C, ['Tuple', 1, 2]], ['Tuple', 1, 1]],
      'tuple<integer, integer>',
      '(NaN, NaN)',
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
    const r = probe(['Add', ['List', 1, 2, 3], ['If', C, 2]]);
    expect(r.free).toBe('[If(0 < t, 3),If(0 < t, 4),If(0 < t, 5)]');
    const p = probe(['Multiply', ['If', C, 2], ['Tuple', 1, 2]]);
    expect(p.free).toBe('(If(0 < t, 2), If(0 < t, 4))');
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
      ['If', ['Greater', 'a', 0], ['List', 1, 2]],
      ['If', ['Greater', 'b', 0], 2],
    ]);
    const held = e.evaluate();
    expect(held.toString()).toBe('If(0 < a, [If(0 < b, 3),If(0 < b, 4)])');
    ce.assign('a', -1);
    expect(held.evaluate().toString()).toBe('"Missing"');
    ce.assign('a', ce.symbol('a'));
    ce.assign('b', -1);
    expect(held.evaluate().toString()).toBe('If(0 < a, [NaN,NaN])');
    expect(e.evaluate().toString()).toBe('If(0 < a, [NaN,NaN])');
    // One condition restricting a scalar and a point is one restriction.
    expect(
      ce
        .box(['Multiply', ['If', C, 2], ['If', C, ['Tuple', 1, 2]]])
        .evaluate()
        .toString()
    ).toBe('If(0 < t, (2, 4))');
  });

  test('a gated numeric value still binds to a declared range and an assumption', () => {
    const ce = new ComputeEngine();
    ce.declare('e', 'integer<3<..>');
    ce.assign('e', ce.parse('5\\{a>0\\}'));
    expect(ce.box('e').evaluate().toString()).toBe('If(0 < a, 5)');
    const ce2 = new ComputeEngine();
    ce2.assume(ce2.parse('v > 3'));
    ce2.assign('v', ce2.parse('5\\{a>0\\}'));
    expect(ce2.box('v').evaluate().toString()).toBe('If(0 < a, 5)');
  });

  test('a selection with no selected clause: Missing, and NaN for an else-less If of a number', () => {
    const ce = engine();
    expect(ce.box(['Which', 'False', 5]).evaluate().toString()).toBe(
      '"Missing"'
    );
    // An else-less `If` is a restriction (decision of 2026-11-02,
    // `docs/plans/2026-11-02-restriction-binding.md`): a numeric arm masks to
    // `NaN`.
    expect(ce.box(['If', 'False', 5]).evaluate().toString()).toBe('NaN');
  });
});
