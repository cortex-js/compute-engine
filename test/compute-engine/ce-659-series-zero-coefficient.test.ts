import { ComputeEngine } from '../../src/compute-engine';
import { exactZeroVerdict } from '../../src/compute-engine/symbolic/contour';

// CE-659: `Series` drops a term whose coefficient is proved 0. The
// coefficient of x² below is `sin(1)² + cos(1)² − 1`, an unfolded 0. Before
// the fix, the term was dropped only when the engine had tested that
// constant before (a memo of the zero tests), so the same input gave two
// results. Now each constant coefficient is tested at each call.

const zero = [
  'Subtract',
  ['Add', ['Power', ['Sin', 1], 2], ['Power', ['Cos', 1], 2]],
  1,
];
const series = (ce: ComputeEngine) =>
  ce
    .box([
      'Series',
      ['Add', ['Sin', 'x'], ['Multiply', zero, ['Power', 'x', 2]]],
      'x',
      0,
      5,
    ])
    .evaluate()
    .toString();

describe('CE-659: a Series result does not depend on earlier zero tests', () => {
  test('a new engine drops the unfolded zero term', () => {
    expect(series(new ComputeEngine())).toBe(
      'x - 1/6 * x^3 + 1/120 * x^5 + BigO(x^7)'
    );
  });

  test('an earlier zero test of the coefficient gives the same result', () => {
    const ce = new ComputeEngine();
    expect(exactZeroVerdict(ce.box(zero))).toBe(true);
    expect(series(ce)).toBe(series(new ComputeEngine()));
  });
});

describe('CE-659: a coefficient that is not pure is not tested', () => {
  test('a host call with no purity statement runs as often as before', () => {
    const ce = new ComputeEngine();
    let calls = 0;
    ce.declare('h', {
      signature: '(number) -> number',
      evaluate: ([x], { engine }) => {
        calls += 1;
        return engine.number(x.re + 1);
      },
    });
    const before = calls;
    const s = ce
      .box(['Series', ['Multiply', ['h', 2], 'x'], 'x', 0, 3])
      .evaluate();
    expect(s.toString()).toContain('h(2)');
    expect(calls - before).toBe(0);
  });
});

describe('CE-659: a coefficient that reads a symbol value is not tested', () => {
  test('a symbol whose value calls host code does not run it', () => {
    const ce = new ComputeEngine();
    let calls = 0;
    ce.declare('h', {
      signature: '(number) -> number',
      evaluate: ([x], { engine }) => {
        calls += 1;
        return engine.number(x.re + 1);
      },
    });
    ce.declare('a', { value: ce.box(['Hold', ['h', 2]]).ops![0] });
    const before = calls;
    ce.box(['Series', ['Multiply', ['Sin', 'a'], 'x'], 'x', 0, 3]).evaluate();
    expect(calls - before).toBe(0);
  });
});

describe('CE-659: a constant whose value calls host code is not tested', () => {
  test('a host constant with a host call value does not run it', () => {
    const ce = new ComputeEngine();
    let calls = 0;
    ce.declare('h', {
      signature: '(number) -> number',
      evaluate: ([x], { engine }) => {
        calls += 1;
        return engine.number(x.re + 1);
      },
    });
    ce.declare('k', {
      isConstant: true,
      value: ce.box(['Hold', ['h', 2]]).ops![0],
    });
    const before = calls;
    ce.box(['Series', ['Multiply', ['Sin', 'k'], 'x'], 'x', 0, 3]).evaluate();
    expect(calls - before).toBe(0);
  });
});

describe('CE-659: the zero tests of one Series call', () => {
  // In one call, each constant is tested once, and a coefficient that the
  // enclosures of its parts prove not 0 is not evaluated. A call does not
  // keep its tests for the next call.
  const zero2 = [
    'Subtract',
    ['Subtract', ['Power', ['Add', 1, ['Sqrt', 2]], 2], 3],
    ['Multiply', 2, ['Sqrt', 2]],
  ];
  const run = (ce: ComputeEngine, expr: unknown) =>
    ce
      .box(expr as any)
      .evaluate()
      .toString();

  test('each call of the same series in one engine drops the zero term', () => {
    const ce = new ComputeEngine();
    expect(series(ce)).toBe('x - 1/6 * x^3 + 1/120 * x^5 + BigO(x^7)');
    expect(series(ce)).toBe('x - 1/6 * x^3 + 1/120 * x^5 + BigO(x^7)');
  });

  test('an unfolded zero in a power of a sum is dropped', () => {
    const expr = [
      'Series',
      ['Add', ['Sin', 'x'], ['Multiply', zero2, ['Power', 'x', 2]]],
      'x',
      0,
      5,
    ];
    expect(run(new ComputeEngine(), expr)).toBe(
      'x - 1/6 * x^3 + 1/120 * x^5 + BigO(x^7)'
    );
  });

  test('unfolded zeros past the cut of a Laurent series give an exact sum', () => {
    const expr = [
      'Series',
      [
        'Add',
        ['Divide', 1, 'x'],
        ['Multiply', zero, 'x'],
        ['Multiply', zero, ['Power', 'x', 3]],
      ],
      'x',
      0,
      2,
    ];
    const ce = new ComputeEngine();
    expect(run(ce, expr)).toBe('1 / x');
    expect(run(ce, expr)).toBe('1 / x');
  });

  test('coefficients built from shared constants keep their values', () => {
    const expr = [
      'Series',
      ['Multiply', ['Exp', 'x'], ['Sin', ['Add', 'x', 1]]],
      'x',
      0,
      3,
    ];
    expect(run(new ComputeEngine(), expr)).toBe(
      'sin(1) + x * (sin(1) + cos(1)) + (-1/2 * sin(1) + 1/2 * sin(1) + cos(1)) * x^2 + (-1/2 * sin(1) - 1/6 * cos(1) + 1/6 * sin(1) + 1/2 * cos(1)) * x^3 + BigO(x^4)'
    );
  });

  test('a coefficient whose symbol holds a draw is not tested, and draws nothing', () => {
    // `sin(r)` with `r := Random()` is pure by `isPure`, which does not
    // follow the value of `r`. The coefficient is not tested for 0 (its
    // value changes at each draw) and stays in the result. Before, each test
    // of `sin(r)` drew once, and a verdict kept for the call made two
    // coefficients share one draw. The number of draws is read from the
    // seeded stream: the draw that follows the series is the first draw of
    // the seed when the series drew nothing.
    const ce = new ComputeEngine();
    ce.assign('r', ce.box(['Random']));
    const seriesExpr = [
      'Series',
      [
        'Add',
        ['Multiply', ['Sin', 'r'], 'x'],
        ['Multiply', ['Sin', 'r'], ['Power', 'x', 2]],
      ],
      'x',
      0,
      2,
    ];
    expect(run(ce, seriesExpr)).toBe('sin(r) * x^2 + x * sin(r)');
    const firstDraw = run(ce, ['WithRandomSeed', 7, ['Random']]);
    const afterSeries = run(ce, [
      'WithRandomSeed',
      7,
      ['Block', seriesExpr, ['Random']],
    ]);
    expect(afterSeries).toBe(firstDraw);
  });
});
