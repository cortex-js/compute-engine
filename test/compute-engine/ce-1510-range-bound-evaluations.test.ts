/**
 * CE-1510. The `Range` handlers read the bounds of the range for each facet
 * (`count`, `isFinite`, `isEnumerable`, the elements), and a broadcast reads
 * several facets of the `Range` before it evaluates it. A bound that is not a
 * number literal was evaluated at each read, so one evaluation of
 * `1 + Range(1, Length(C))` evaluated `C` 54 times. The value of a pure bound
 * is now kept for the evaluations in progress (`evaluateRangeBound()`,
 * `eager-source-values.ts`).
 *
 * `Spy` counts the evaluations of `C`. A bound is read once by `evaluate()`
 * and once by `N()`, so `C` is evaluated twice. The `Map` forms also evaluate
 * `At(C, j)` once for each element.
 */
import { ComputeEngine } from '../../src/compute-engine';

function engine(n: number) {
  const ce = new ComputeEngine();
  const counter = { calls: 0 };
  ce.declare('Spy', {
    signature: '(list<number>) -> list<number>',
    evaluate: (ops) => {
      counter.calls += 1;
      return ops[0].evaluate();
    },
  });
  const items = Array.from({ length: n }, (_, i) => 7 + i);
  ce.declare('C', {
    type: 'list<number>',
    value: ce.box(['Spy', ['List', ...items]]),
  });
  return { ce, counter };
}

const range = ['Range', 1, ['Length', 'C']];
const map = [
  'Map',
  ['Function', ['At', 'C', 'j'], 'j'],
  ['Range', 1, ['Length', 'C'], 1],
];

describe('CE-1510: A RANGE BOUND IS EVALUATED ONCE PER EVALUATION', () => {
  test.each([
    ['Add', ['Add', 1, range], '[2,3,4]'],
    ['Multiply', ['Multiply', 2, range], '[2,4,6]'],
    ['Negate', ['Negate', range], '[-1,-2,-3]'],
    ['Divide', ['Divide', 1, range], '[1,1/2,1/3]'],
    ['Less', ['Less', range, 2], '["True","False","False"]'],
  ] as const)('%s', (_name, json, value) => {
    const { ce, counter } = engine(3);
    expect(ce.box(json as any).evaluate().toString()).toBe(value);
    expect(counter.calls).toBe(2);
  });

  test('the count does not depend on the length of the list', () => {
    const { ce, counter } = engine(6);
    expect(ce.box(['Add', 1, range] as any).evaluate().toString()).toBe(
      '[2,3,4,5,6,7]'
    );
    expect(counter.calls).toBe(2);
  });

  test.each([
    ['Sin of a Map', ['Sin', map], 3, '[sin(7),sin(8),sin(9)]'],
    ['Divide of a Map', ['Divide', 1, map], 3, '[1/7,1/8,1/9]'],
    [
      'Divide of a Map of 6',
      ['Divide', 1, map],
      6,
      '[1/7,1/8,1/9,1/10,1/11,1/12]',
    ],
  ] as const)('%s', (_name, json, n, value) => {
    const { ce, counter } = engine(n);
    expect(ce.box(json as any).evaluate().toString()).toBe(value);
    expect(counter.calls).toBe(2 + n);
  });

  test('a bound that reads an impure value is read again', () => {
    const ce = new ComputeEngine();
    let draws = 0;
    ce.declare('Draw', {
      signature: '() -> integer',
      pure: false,
      evaluate: () => {
        draws += 1;
        return ce.number(3);
      },
    });
    // `n` holds `Draw()`: the bound is pure as written, but not transitively.
    ce.declare('n', { type: 'integer', value: ce.box(['Draw']) });
    const expr = ce.box(['Add', 1, ['Range', 1, ['Multiply', 1, 'n']]]);
    expect(expr.evaluate().toString()).toBe('[2,3,4]');
    expect(draws).toBeGreaterThan(2);
  });

  test('each evaluation reads the bound again', () => {
    const { ce, counter } = engine(3);
    const expr = ce.box(['Add', 1, range] as any);
    expr.evaluate();
    expr.evaluate();
    expect(counter.calls).toBe(4);
  });

  test('a value written between two evaluations is read', () => {
    const ce = new ComputeEngine();
    ce.declare('D', { type: 'list<number>', value: ce.box(['List', 1, 2]) });
    const expr = ce.box(['Add', 1, ['Range', 1, ['Length', 'D']]]);
    expect(expr.evaluate().toString()).toBe('[2,3]');
    ce.assign('D', ce.box(['List', 1, 2, 3, 4]));
    expect(expr.evaluate().toString()).toBe('[2,3,4,5]');
  });

  test('a value written during the evaluation is read', () => {
    const ce = new ComputeEngine();
    const bound = ['Multiply', 1, 'm'];
    const expr = ce.box([
      'Block',
      ['Declare', 'm', "'integer'"],
      ['Declare', 'q', "'list<integer>'"],
      ['Assign', 'm', 2],
      ['Assign', 'q', ['ListFrom', ['Add', 1, ['Range', 1, bound]]]],
      ['Assign', 'm', 4],
      ['List', 'q', ['Add', 1, ['Range', 1, bound]]],
    ]);
    expect(expr.evaluate().toString()).toBe('[[2,3],[2,3,4,5]]');
  });

  test('two calls of a function read the bound of each call', () => {
    const ce = new ComputeEngine();
    ce.parse(
      'f(L) \\coloneq 1 + \\operatorname{Range}(1, \\operatorname{Length}(L))'
    ).evaluate();
    expect(ce.parse('[f([5,6]), f([5,6,7])]').evaluate().toString()).toBe(
      '[[2,3],[2,3,4]]'
    );
  });

  test('a bound that depends on the parameter of a Map', () => {
    const ce = new ComputeEngine();
    const expr = ce.box([
      'Map',
      ['Function', ['Add', 1, ['Range', 1, ['Multiply', 2, 'k']]], 'k'],
      ['Range', 1, 3],
    ]);
    expect(expr.evaluate().toString()).toBe(
      '[[2,3],[2,3,4,5],[2,3,4,5,6,7]]'
    );
  });
});
