import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine/global-types';

//
// CE-1609: in a walk (`Map`, `Filter`, an eager `Apply`), a sub-expression of
// the callback that does not depend on the element and that reduces a list
// to one value (`Min(d)`) was evaluated at each element, and its value was
// evaluated once more at each element by a branch condition that compares
// with it (`Which(k = Min(d), …)`). With symbolic elements, each of these
// evaluations reads every element of the list, so the walk took a time that
// grows with the square of the length. The walk now keeps the value of such
// a sub-expression, and a kept value is its own value
// (`boxed-expression/walk-invariant-values.ts`).
//
// The tests count evaluations with pure host functions and check each
// value.
//

const list = (ce: ComputeEngine, xs: number[]): Expression =>
  ce.expr(['List', ...xs]);

/** `Size(xs)` is the number of elements of `xs`. `sizes()` is the number of
 * times it was evaluated. */
function engine(): { ce: ComputeEngine; sizes: () => number } {
  const ce = new ComputeEngine();
  let sizes = 0;
  ce.declare('Size', {
    signature: '(list) -> integer',
    pure: true,
    evaluate: ([xs], { engine }) => {
      sizes += 1;
      return engine.number(xs.count ?? 0);
    },
  });
  return { ce, sizes: () => sizes };
}

describe('CE-1609 A REDUCTION OF A LIST IS EVALUATED ONCE PER WALK', () => {
  test('Map: a number computed from a list that a symbol holds', () => {
    const { ce, sizes } = engine();
    ce.assign('L', list(ce, [7, 8, 9]));
    const r = ce
      .expr([
        'ListFrom',
        [
          'Map',
          ['Function', ['Add', 'j', ['Size', 'L']], 'j'],
          ['Range', 1, 5],
        ],
      ])
      .evaluate();
    expect(r.json).toEqual(['List', 4, 5, 6, 7, 8]);
    expect(sizes()).toBe(1);
  });

  test('Apply: a number computed from a list expression', () => {
    const { ce, sizes } = engine();
    ce.assign('L', list(ce, [-7, 8, -9]));
    const expr = ce.expr([
      'Apply',
      ['Function', ['Add', 'j', ['Size', ['Abs', 'L']]], 'j'],
      ['Range', 1, 5],
    ]);
    expect(expr.evaluate().json).toEqual(['List', 4, 5, 6, 7, 8]);
    expect(sizes()).toBe(1);

    // A write between two evaluations is seen by the second.
    ce.assign('L', list(ce, [1, 2]));
    expect(expr.evaluate().json).toEqual(['List', 3, 4, 5, 6, 7]);
    expect(sizes()).toBe(2);
  });

  test('a write between two elements of a walk is seen by the next element', () => {
    const { ce, sizes } = engine();
    ce.assign('L', list(ce, [7, 8, 9]));
    const m = ce
      .expr([
        'Map',
        ['Function', ['Add', 'j', ['Size', 'L']], 'j'],
        ['Range', 1, 3],
      ])
      .evaluate();
    const it = m.each();
    expect(it.next().value?.json).toBe(4);
    expect(it.next().value?.json).toBe(5);
    expect(sizes()).toBe(1);
    ce.assign('L', list(ce, [7, 8, 9, 10, 11]));
    expect(it.next().value?.json).toBe(8);
    expect(sizes()).toBe(2);
  });

  test('a number that reads the parameter is evaluated at each element', () => {
    const { ce, sizes } = engine();
    const r = ce
      .expr([
        'ListFrom',
        [
          'Map',
          ['Function', ['Size', ['List', 'j', 'j']], 'j'],
          ['Range', 1, 4],
        ],
      ])
      .evaluate();
    expect(r.json).toEqual(['List', 2, 2, 2, 2]);
    expect(sizes()).toBe(4);
  });
});

describe('CE-1609 A KEPT VALUE IS NOT EVALUATED AGAIN IN A BRANCH CONDITION', () => {
  // `Probe(u)` has no value: it stays as written, and each evaluation of an
  // expression that holds it calls the handler again.
  function probing(): { ce: ComputeEngine; probes: () => number } {
    const ce = new ComputeEngine();
    ce.declare('u', 'real');
    let probes = 0;
    ce.declare('Probe', {
      signature: '(real) -> real',
      pure: true,
      evaluate: () => {
        probes += 1;
        return undefined;
      },
    });
    return { ce, probes: () => probes };
  }

  // The smallest of three symbolic elements, compared with each element of
  // a source of `n` numbers.
  const selection = (head: 'Map' | 'Apply', n: number) => [
    head,
    [
      'Function',
      [
        'Which',
        [
          'Equal',
          'k',
          [
            'Min',
            [
              'List',
              ['Probe', 'u'],
              ['Add', ['Probe', 'u'], 1],
              ['Add', ['Probe', 'u'], 2],
            ],
          ],
        ],
        0,
        'True',
        'k',
      ],
      'k',
    ],
    ['Range', 1, n],
  ];

  test.each(['Map', 'Apply'] as const)(
    '%s: the evaluations do not grow with the number of elements',
    (head) => {
      const count = (n: number): number => {
        const { ce, probes } = probing();
        const value = ce.expr(selection(head, n) as never).evaluate();
        const cells = [...value.each()];
        expect(cells).toHaveLength(n);
        // Each cell keeps its symbolic condition and its element.
        expect(cells[n - 1].operator).toBe('Which');
        expect(JSON.stringify(cells[n - 1].json)).toContain('"Probe"');
        return probes();
      };
      expect(count(12)).toBe(count(3));
    }
  );

  test('the cells are the cells of the selection written for one element', () => {
    const { ce } = probing();
    const walked = [
      ...ce
        .expr(selection('Map', 4) as never)
        .evaluate()
        .each(),
    ].map((cell) => cell.json);
    const body = (selection('Map', 4)[1] as unknown[])[1];
    const alone = [1, 2, 3, 4].map(
      (k) =>
        ce.expr(['Apply', ['Function', body, 'k'], k] as never).evaluate().json
    );
    expect(walked).toEqual(alone);
  });
  test('a kept value that evaluates further is evaluated in the condition', () => {
    // `Length(d)` evaluates to `Length([3, x, 1])`, which evaluates to `3`:
    // the condition reads the second value.
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    ce.assign('d', ce.expr(['Sort', ['List', 3, 'x', 1]]));
    for (const head of ['Map', 'Apply']) {
      const value = ce
        .expr([
          head,
          ['Function', ['If', ['Equal', 'k', ['Length', 'd']], 1, 0], 'k'],
          ['List', 1, 2, 3],
        ] as never)
        .evaluate();
      expect([...value.each()].map((cell) => cell.json)).toEqual([0, 0, 1]);
    }
  });
});
