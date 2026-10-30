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
