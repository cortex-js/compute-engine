import { ComputeEngine } from '../../src/compute-engine';

// CE-1368: `R(p, q)` passes a lazy comprehension that reads its parameters
// to `clean(l) := Map(i ↦ l[i], Range(1, Length(l)))`. The value of the call
// is a `Map` whose bound `Length(Comprehension(…p…q…))` names `p` and `q`.
// The comprehension keeps the activation of the call of `R`, where they have
// their values; the count reader of `Range` called them unknown, so the
// `Map` had no count and `ListFrom`, `Sum`, `Length` and `At` stayed
// unevaluated.

function engine() {
  const ce = new ComputeEngine();
  ce.assign(
    'clean',
    ce.box([
      'Function',
      [
        'Map',
        ['Function', ['At', 'l', 'i'], 'i'],
        ['Range', 1, ['Length', 'l']],
      ],
      'l',
    ])
  );
  ce.assign(
    'R',
    ce.box([
      'Function',
      [
        'clean',
        [
          'Comprehension',
          ['Add', ['At', 'p', 'k'], 'q'],
          ['Element', 'k', ['Range', 1, ['Length', 'p']]],
        ],
      ],
      'p',
      'q',
    ])
  );
  return ce;
}

const CALL = ['R', ['List', 10, 20, 30], 1];

describe('CE-1368 a lazy list returned by a call has a count', () => {
  test('ListFrom lists the elements', () => {
    const ce = engine();
    expect(ce.box(['ListFrom', CALL]).evaluate().json).toEqual([
      'List',
      11,
      21,
      31,
    ]);
  });

  test('Sum, Length and At give values', () => {
    const ce = engine();
    expect(ce.box(['Sum', CALL]).evaluate().json).toEqual(63);
    expect(ce.box(['Length', CALL]).evaluate().json).toEqual(3);
    expect(ce.box(['At', CALL, 2]).evaluate().json).toEqual(21);
  });

  test('the value of the call has a count and the same elements', () => {
    const ce = engine();
    const v = ce.box(CALL).evaluate();
    expect(v.count).toBe(3);
    expect([...v.each()].map((x) => x.json)).toEqual([11, 21, 31]);
  });

  test('a free name in the bound stays unknown', () => {
    const ce = engine();
    expect(ce.box(['Length', ['Range', 1, 'n']]).evaluate().json).toEqual([
      'Length',
      ['Range', 1, 'n'],
    ]);
    // `w` has no value in the activation of the call either.
    ce.assign(
      'R2',
      ce.box([
        'Function',
        [
          'clean',
          [
            'Comprehension',
            ['Add', ['At', 'p', 'k'], 'w'],
            ['Element', 'k', ['Range', 1, ['Length', 'p']]],
          ],
        ],
        'p',
      ])
    );
    const v = ce.box(['R2', ['List', 10, 20, 30]]).evaluate();
    expect(v.count).toBeUndefined();
  });

  test('a bound that shares a sub-expression is read once per node', () => {
    // `Add(t, t)` nested 40 times over `t = Length(view)`, where `view`
    // keeps the activation of the call of `R`: 41 nodes, 2^40 paths. The
    // free `w` last makes the bound unknown, so no `.N()` runs.
    const ce = engine();
    const v = ce.box(CALL).evaluate();
    const range = v.ops![1];
    const t = range.ops![1];
    expect(t.operator).toBe('Length');
    let dag = t;
    for (let i = 0; i < 40; i++) dag = ce._fn('Add', [dag, dag]);
    const bound = ce._fn('Add', [dag, ce.symbol('w')]);
    const start = Date.now();
    expect(ce._fn('Range', [ce.One, bound]).count).toBeUndefined();
    expect(Date.now() - start).toBeLessThan(2000);
  });

  test('an endless lazy list returned by a call is not walked', () => {
    const ce = engine();
    ce.assign(
      'E',
      ce.box([
        'Function',
        [
          'Map',
          ['Function', ['Add', 'i', 'q'], 'i'],
          ['Range', 1, 'PositiveInfinity'],
        ],
        'q',
      ])
    );
    expect(ce.box(['Length', ['E', 1]]).evaluate().json).toEqual(
      'PositiveInfinity'
    );
    expect(ce.box(['ListFrom', ['E', 1]]).evaluate().operator).toBe(
      'ListFrom'
    );
  });
});
