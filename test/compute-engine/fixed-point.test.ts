/**
 * `FixedPoint(f, x, maxIterations?)`: apply `f` from `x` until two successive
 * values are the same (`library/control-structures.ts`). It was declared but
 * had no evaluate handler until 2026-10-22, so a call stayed unevaluated.
 *
 * A float start is written through LaTeX or as `{ num: '1.0' }`: in a
 * MathJSON array, the JavaScript number `1.0` is the exact integer `1`.
 */

import { ComputeEngine } from '../../src/compute-engine';
import { isSubtype } from '../../src/common/type/subtype';
import { executeEpsil } from '../../src/epsil/execute-epsil';

const ce = new ComputeEngine();

/** Newton's iteration for √2. */
const NEWTON = [
  'Function',
  ['Divide', ['Add', 'x', ['Divide', 2, 'x']], 2],
  'x',
];
const FLOAT_ONE = { num: '1.0' };

function value(json: any): string {
  return ce.box(json).evaluate().toString();
}

describe('FixedPoint evaluation', () => {
  test("Newton's iteration converges to √2 from a float", () => {
    const v = ce.box(['FixedPoint', NEWTON, FLOAT_ONE]).evaluate();
    expect(v.re).toBeCloseTo(Math.SQRT2, 15);
  });

  test('the fixed point of cos from a float', () => {
    const v = ce.box(['FixedPoint', 'Cos', FLOAT_ONE]).evaluate();
    expect(v.re).toBeCloseTo(0.7390851332151607, 9);
    // The value is a fixed point within the engine tolerance.
    expect(Math.abs(Math.cos(v.re) - v.re)).toBeLessThan(1e-9);
  });

  test('an exact iteration that reaches an exact fixed point', () => {
    // ⌊x/2⌋ from 100 reaches 0, and ⌊0/2⌋ is 0.
    expect(
      value([
        'FixedPoint',
        ['Function', ['Floor', ['Divide', 'x', 2]], 'x'],
        100,
      ])
    ).toBe('0');
    // x/2 + 1 from 2 is 2 at once.
    expect(
      value([
        'FixedPoint',
        ['Function', ['Add', ['Divide', 'x', 2], 1], 'x'],
        2,
      ])
    ).toBe('2');
  });

  test('an exact iteration whose values only grow stays unevaluated', () => {
    // `Cos(1)` is exact, so the values nest; the exact Newton terms double
    // their digits at each step. Both stop at once instead of running to the
    // iteration limit.
    expect(value(['FixedPoint', 'Cos', 1])).toBe('FixedPoint(cos, 1)');
    expect(ce.box(['FixedPoint', NEWTON, 1]).evaluate().operator).toBe(
      'FixedPoint'
    );
  });

  test('N gives the numeric fixed point of an exact start', () => {
    const v = ce.box(['FixedPoint', 'Cos', 1]).N();
    expect(v.re).toBeCloseTo(0.7390851332151607, 9);
    expect(ce.box(['FixedPoint', NEWTON, 1]).N().re).toBeCloseTo(
      Math.SQRT2,
      15
    );
  });

  test('the maximum number of applications', () => {
    // The last value is returned when the maximum is reached.
    expect(value(['FixedPoint', 'Cos', 1, 3])).toBe('cos(cos(cos(1)))');
    expect(value(['FixedPoint', NEWTON, 1, 3])).toBe('577/408');
  });

  test('a shorthand function and the LaTeX route', () => {
    const shorthand = ce
      .box([
        'FixedPoint',
        ['Divide', ['Add', '_', ['Divide', 2, '_']], 2],
        FLOAT_ONE,
      ])
      .evaluate();
    expect(shorthand.re).toBeCloseTo(Math.SQRT2, 15);
    const latex = ce
      .parse('\\operatorname{FixedPoint}(x\\mapsto \\cos x, 1.0)')
      .evaluate();
    expect(latex.re).toBeCloseTo(0.7390851332151607, 9);
  });
});

describe('FixedPoint stop test', () => {
  test('the stop test is relative: a fixed point of small magnitude', () => {
    // √(1e-24) = 1e-12. An absolute tolerance of 1e-10 stopped at once, at
    // five times the root.
    const v = ce
      .parse(
        '\\operatorname{FixedPoint}(x \\mapsto (x + 10^{-24}/x)/2, 1.0\\times 10^{-11})'
      )
      .evaluate();
    expect(v.re / 1e-12).toBeCloseTo(1, 12);
  });

  test('the result is correct to the working precision', () => {
    // The fixed point of cos is 0.739085133215160641655312087673873404…
    const v = ce.box(['FixedPoint', 'Cos', 1]).N();
    expect(v.toString().slice(0, 20)).toBe('0.739085133215160641');
  });

  test('a vector iteration converges element by element', () => {
    const v = ce
      .box([
        'FixedPoint',
        NEWTON,
        ['List', ...Array.from({ length: 30 }, () => FLOAT_ONE)],
      ])
      .evaluate();
    expect(v.operator).toBe('List');
    expect(v.nops).toBe(30);
    for (const x of v.ops!) expect(x.re).toBeCloseTo(Math.SQRT2, 15);
  });

  test('a large value of fixed size is not cut short', () => {
    // A constant string longer than the size bound: the fixed point is the
    // string itself.
    const long = 'a'.repeat(600);
    expect(
      ce.box(['FixedPoint', ['Function', `'${long}'`, 'x'], 0]).evaluate()
        .string
    ).toBe(long);
  });

  test('with a maximum, the last value is returned', () => {
    // The guard that leaves an exact nesting unevaluated applies only when
    // no maximum is given.
    expect(value(['FixedPoint', 'Cos', 1, 1])).toBe('cos(1)');
  });

  test('the default limit reached without converging stays unevaluated', () => {
    // A 2-cycle and a slow drift: neither grows, so the divergence guard
    // does not catch them, and neither is a fixed point.
    const cycle = ['FixedPoint', ['Function', ['Subtract', 1, 'x'], 'x'], 0.3];
    for (const mode of ['evaluate', 'N'] as const) {
      const r = ce.box(cycle)[mode]();
      expect(r.operator).toBe('FixedPoint');
    }
    const drift = [
      'FixedPoint',
      ['Function', ['Add', 'x', { num: '0.001' }], 'x'],
      FLOAT_ONE,
    ];
    expect(ce.box(drift).evaluate().operator).toBe('FixedPoint');
  });

  test('an explicit maximum reached returns the last iterate', () => {
    const f = ['Function', ['Subtract', 1, 'x'], 'x'];
    expect(
      ce.box(['FixedPoint', f, { num: '0.3' }, 3]).evaluate().re
    ).toBeCloseTo(0.7, 12);
    expect(
      ce.box(['FixedPoint', f, { num: '0.3' }, 4]).evaluate().re
    ).toBeCloseTo(0.3, 12);
  });

  test('a raised ce.iterationLimit lets a slow iteration converge', () => {
    // x ↦ 0.99x + 0.01 from 2.0 closes on 1 by 1% a step: about 3700 steps to
    // the working precision, more than the default limit.
    const slow = [
      'FixedPoint',
      ['Function', ['Add', ['Multiply', 0.99, 'x'], 0.01], 'x'],
      { num: '2.0' },
    ];
    const saved = ce.iterationLimit;
    try {
      expect(ce.box(slow).evaluate().operator).toBe('FixedPoint');
      ce.iterationLimit = 100_000;
      expect(ce.box(slow).evaluate().re).toBeCloseTo(1, 12);
    } finally {
      ce.iterationLimit = saved;
    }
  });

  test('an explicit function of no parameter is accepted', () => {
    // A function of no parameter ignores its arguments.
    expect(value(['FixedPoint', ['Function', 42], 0])).toBe('42');
  });
});

describe('FixedPoint errors', () => {
  test('a maximum that is not a positive integer', () => {
    expect(value(['FixedPoint', 'Cos', FLOAT_ONE, 0])).toBe(
      'Error("expected-positive-integer", "0")'
    );
    expect(ce.box(['FixedPoint', 'Cos', FLOAT_ONE, 2.5]).type.toString()).toBe(
      'error'
    );
  });

  test('a maximum that is not a number yet leaves the call unevaluated', () => {
    expect(value(['FixedPoint', 'Cos', FLOAT_ONE, 'n'])).toMatch(
      /^FixedPoint\(cos, 1, n\)$/
    );
  });

  test('a function that cannot take one argument', () => {
    const e = ce.box([
      'FixedPoint',
      ['Function', ['Add', 'x', 'y'], 'x', 'y'],
      1,
    ]);
    expect(e.evaluate().toString()).toMatch(/callback-arity/);
  });

  test('a value that is not a function', () => {
    expect(value(['FixedPoint', 3, 1])).toMatch(/incompatible-type.*function/);
    expect(value(['FixedPoint', "'abc'", 1])).toMatch(
      /incompatible-type.*function/
    );
  });

  test('a missing or extra argument', () => {
    expect(value(['FixedPoint', 'Cos'])).toBe('Error("missing")');
    expect(value(['FixedPoint', 'Cos', 1, 2, 3])).toBe(
      'Error("unexpected-argument", "3")'
    );
  });
});

describe('FixedPoint type', () => {
  test("the result type is the function's result type", () => {
    const e = ce.box(['FixedPoint', NEWTON, FLOAT_ONE]);
    expect(e.type.toString()).toBe('number');
    expect(isSubtype(e.evaluate().type.type, e.type.type)).toBe(true);
  });

  test('a function with no known result type gives the declared unknown', () => {
    expect(
      ce.box(['FixedPoint', 'undefinedFunctionName', 1]).type.toString()
    ).toBe('unknown');
  });
});

describe('FixedPoint on the Epsil route', () => {
  test('fixedPoint', () => {
    const r = executeEpsil(
      new ComputeEngine(),
      'fixedPoint(x => (x + 2 / x) / 2, 1.0)'
    );
    expect(r.diagnostics).toEqual([]);
    expect(Number(r.value.re)).toBeCloseTo(Math.SQRT2, 15);
  });
});

describe('FixedPoint LaTeX round trip', () => {
  test('serializes and parses back', () => {
    const e = ce.box(['FixedPoint', 'Cos', 1]);
    expect(ce.parse(e.latex).isSame(e)).toBe(true);
  });
});
