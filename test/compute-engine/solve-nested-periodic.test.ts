import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine/global-types';

// A trig function whose argument is itself a periodic function of the
// unknown (`sin(sin(x))`) makes a periodic equation, with the period of the
// inner trig function. `expr.solve()` gives one root of each family of
// roots in one period, `Solve` gives the families with a fresh integer
// parameter, and `Solve` over a bounded domain gives the roots in the
// domain. Each list is checked by a scan of one period with an interval
// proof, because the root finder solves the outer function for one period
// of its argument only. A trig function of an argument that is not
// periodic (`sin(x^2)`) gives no answer.

const ce = new ComputeEngine();

function solveLatex(latex: string): Expression {
  return ce.function('Solve', [ce.parse(latex), ce.symbol('x')]).evaluate();
}

function solveOver(latex: string, lo: number, hi: number): Expression {
  return ce
    .function('Solve', [
      ce.parse(latex),
      ce.function('Element', [
        ce.symbol('x'),
        ce.function('Interval', [ce.number(lo), ce.number(hi)]),
      ]),
    ])
    .evaluate();
}

function sortedValues(roots: ReadonlyArray<Expression>): number[] {
  return roots.map((r) => r.N().re).sort((a, b) => a - b);
}

/**
 * The real roots of `f` in `[lo, hi]`, found by a dense scan independently
 * of the solver: a sign change (refined by bisection), or a local minimum
 * of `|f|` that is close to zero, where `f` touches zero without a sign
 * change (refined by a ternary search).
 */
function scanRoots(f: (x: number) => number, lo: number, hi: number): number[] {
  const n = 200_000;
  const h = (hi - lo) / n;
  const xs = Array.from({ length: n + 1 }, (_, i) => lo + i * h);
  const ys = xs.map(f);
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    if (ys[i] === 0) out.push(xs[i]);
    else if (ys[i] * ys[i + 1] < 0) {
      let a = xs[i];
      let b = xs[i + 1];
      for (let k = 0; k < 60; k++) {
        const m = (a + b) / 2;
        if (f(m) * f(a) <= 0) b = m;
        else a = m;
      }
      out.push((a + b) / 2);
    } else if (
      i > 0 &&
      ys[i - 1] * ys[i] > 0 &&
      ys[i] * ys[i + 1] > 0 &&
      Math.abs(ys[i]) <= Math.abs(ys[i - 1]) &&
      Math.abs(ys[i]) < Math.abs(ys[i + 1]) &&
      Math.abs(ys[i]) < 1e-6
    ) {
      let a = xs[i - 1];
      let b = xs[i + 1];
      for (let k = 0; k < 100; k++) {
        const m1 = a + (b - a) / 3;
        const m2 = b - (b - a) / 3;
        if (Math.abs(f(m1)) < Math.abs(f(m2))) b = m2;
        else a = m1;
      }
      const x = (a + b) / 2;
      if (Math.abs(f(x)) < 1e-12) out.push(x);
    }
  }
  return out;
}

/** Check that `values` are the roots of `f` in `[lo, hi]`. */
function expectRootsOf(
  values: number[],
  f: (x: number) => number,
  lo: number,
  hi: number
): void {
  for (const v of values) expect(Math.abs(f(v))).toBeLessThan(1e-9);
  const scanned = scanRoots(f, lo, hi);
  expect(values.length).toBe(scanned.length);
  values.forEach((v, i) => expect(v).toBeCloseTo(scanned[i], 6));
}

/**
 * Check the families of `result` (each `root + spacing·t`) against `f`:
 * the members in `[lo, hi]` are the roots of `f` there.
 */
function expectFamiliesOf(
  result: Expression,
  f: (x: number) => number,
  lo = -9,
  hi = 9
): void {
  expect(result.operator).toBe('List');
  const members: number[] = [];
  for (const family of result.ops!) {
    const at = (k: number) => family.subs({ t: k }).N().re;
    const step = Math.abs(at(1) - at(0));
    expect(step).toBeGreaterThan(0);
    const kmax = Math.ceil((Math.max(-lo, hi) + Math.abs(at(0))) / step);
    for (let k = -kmax; k <= kmax; k++) {
      const v = at(k);
      if (v >= lo && v <= hi) members.push(v);
    }
  }
  members.sort((a, b) => a - b);
  expectRootsOf(members, f, lo, hi);
}

describe('A TRIG FUNCTION OF A PERIODIC ARGUMENT: expr.solve()', () => {
  test('sin(sin(x)) = 0 gives 0 and π', () => {
    const roots = ce.parse('\\sin(\\sin(x))=0').solve('x');
    expect(roots).not.toBeNull();
    expect(sortedValues(roots as Expression[])).toEqual([0, Math.PI]);
  });

  test('sin(cos(x)) = 0 gives -π/2 and π/2', () => {
    const roots = ce.parse('\\sin(\\cos(x))=0').solve('x');
    expect(roots).not.toBeNull();
    const values = sortedValues(roots as Expression[]);
    expect(values.length).toBe(2);
    expect(values[0]).toBeCloseTo(-Math.PI / 2, 12);
    expect(values[1]).toBeCloseTo(Math.PI / 2, 12);
  });

  test('sin(2·sin(x)) = 0 gives 0 and π (|2·sin(x)| < π)', () => {
    const roots = ce.parse('\\sin(2\\sin(x))=0').solve('x');
    expect(roots).not.toBeNull();
    expect(sortedValues(roots as Expression[])).toEqual([0, Math.PI]);
  });

  test('cos(sin(x)) = 0 has no real root (|sin(x)| ≤ 1 < π/2)', () => {
    expect(ce.parse('\\cos(\\sin(x))=0').solve('x')).toEqual([]);
  });

  test('sin(sin(x)) = -1/2 gives one root of each family', () => {
    const roots = ce.parse('\\sin(\\sin(x))=-\\frac12').solve('x');
    expect(roots).not.toBeNull();
    const values = sortedValues(roots as Expression[]);
    expect(values.length).toBe(2);
    // One period `[-π, π)` holds one root of each family.
    const f = (x: number) => Math.sin(Math.sin(x)) + 0.5;
    const inPeriod = values
      .map((v) => v - 2 * Math.PI * Math.round(v / (2 * Math.PI)))
      .sort((a, b) => a - b);
    expectRootsOf(inPeriod, f, -Math.PI, Math.PI);
  });

  test('x·sin(sin(x)) = 0 gives 0 and π, as x·sin(x) = 0 does', () => {
    const roots = ce.parse('x\\sin(\\sin(x))=0').solve('x');
    expect(roots).not.toBeNull();
    expect(sortedValues(roots as Expression[])).toEqual([0, Math.PI]);
  });
});

describe('A TRIG FUNCTION OF A PERIODIC ARGUMENT: Solve with no domain', () => {
  test('sin(sin(x)) = 0', () => {
    const result = solveLatex('\\sin(\\sin(x))=0');
    expect(result.toString()).toBe('[pi * t]');
    expectFamiliesOf(result, (x) => Math.sin(Math.sin(x)));
  });

  test('sin(cos(x)) = 0', () => {
    const result = solveLatex('\\sin(\\cos(x))=0');
    expect(result.toString()).toBe('[pi * t + 1/2 * pi]');
    expectFamiliesOf(result, (x) => Math.sin(Math.cos(x)));
  });

  test('sin(2·sin(x)) = 0', () => {
    const result = solveLatex('\\sin(2\\sin(x))=0');
    expect(result.toString()).toBe('[pi * t]');
    expectFamiliesOf(result, (x) => Math.sin(2 * Math.sin(x)));
  });

  test('cos(sin(x)) = 0 gives the empty list', () => {
    expect(solveLatex('\\cos(\\sin(x))=0').toString()).toBe('[]');
  });

  test('sin(sin(x)) = -1/2', () => {
    const result = solveLatex('\\sin(\\sin(x))=-\\frac12');
    expectFamiliesOf(result, (x) => Math.sin(Math.sin(x)) + 0.5);
  });

  test('cos(sin(x)) = 9/10', () => {
    const result = solveLatex('\\cos(\\sin(x))=\\frac{9}{10}');
    expectFamiliesOf(result, (x) => Math.cos(Math.sin(x)) - 0.9);
  });

  test('sin(sin(2x + 1)) = 0', () => {
    const result = solveLatex('\\sin(\\sin(2x+1))=0');
    expectFamiliesOf(result, (x) => Math.sin(Math.sin(2 * x + 1)));
  });
});

describe('A TRIG FUNCTION OF A PERIODIC ARGUMENT: Solve over a bounded domain', () => {
  test('sin(sin(x)) = 0 over [-7, 7]', () => {
    const result = solveOver('\\sin(\\sin(x))=0', -7, 7);
    expect(result.toString()).toBe('[-2pi,-pi,0,pi,2pi]');
  });

  test('sin(cos(x)) = 0 over [-7, 7]', () => {
    const result = solveOver('\\sin(\\cos(x))=0', -7, 7);
    expectRootsOf(
      sortedValues(result.ops!),
      (x) => Math.sin(Math.cos(x)),
      -7,
      7
    );
  });

  test('cos(sin(x)) = 0 over [-7, 7] gives the empty list', () => {
    expect(solveOver('\\cos(\\sin(x))=0', -7, 7).toString()).toBe('[]');
  });

  test('sin(4·sin(x)) = 0 over [-7, 7]', () => {
    const result = solveOver('\\sin(4\\sin(x))=0', -7, 7);
    expect(result.operator).toBe('List');
    expectRootsOf(
      sortedValues(result.ops!),
      (x) => Math.sin(4 * Math.sin(x)),
      -7,
      7
    );
  });
});

describe('A TRIG FUNCTION OF AN ARGUMENT THAT IS NOT PERIODIC GIVES NO ANSWER', () => {
  for (const latex of [
    '\\sin(x^2)=0',
    '\\sin(e^x)=0',
    '\\sin(x+\\sin(x))=0',
    '\\sin(\\sin(x^2))=0',
  ]) {
    test(latex, () => {
      expect(ce.parse(latex).solve('x')).toBeNull();
      expect(solveLatex(latex).operator).toBe('Solve');
    });
  }

  // The argument `1/sin(x)` is periodic, but it is not bounded: the roots
  // accumulate at each multiple of π, and no finite list holds them.
  test('sin(1/sin(x)) = 0', () => {
    const latex = '\\sin(\\frac{1}{\\sin(x)})=0';
    expect(ce.parse(latex).solve('x')).toBeNull();
    expect(solveLatex(latex).operator).toBe('Solve');
    expect(solveOver(latex, -7, 7).operator).toBe('Solve');
  });

  // `1000·sin(x)` reaches more periods of `sin` than the root finder
  // expands (`rootsInUnitRange()`): it gives only a part of the roots, and
  // they are not one root of each family.
  test('sin(1000·sin(x)) = 0', () => {
    const latex = '\\sin(1000\\sin(x))=0';
    expect(ce.parse(latex).solve('x')).toBeNull();
    expect(solveLatex(latex).operator).toBe('Solve');
  });

  // `200·sin(x)` reaches about 64 periods of `sin`: about 125 roots of `u`
  // would be added, and each one costs an inversion and its checks. The
  // root finder does not add them, and gives no answer quickly.
  test(
    'sin(200·sin(x)) = 1/3 gives no answer within a few seconds',
    () => {
      const latex = '\\sin(200\\sin(x))=\\frac13';
      const start = Date.now();
      expect(ce.parse(latex).solve('x')).toBeNull();
      expect(solveLatex(latex).operator).toBe('Solve');
      expect(solveOver(latex, -7, 7).operator).toBe('Solve');
      expect(Date.now() - start).toBeLessThan(5000);
    },
    60_000
  );

  // The roots of `sin(u + 10^18) = 0` are near `-10^18`, and the index of
  // their shift into `[-1, 1]` is larger than 2^53, where `k + 1` is not
  // always a different float. The root finder does not shift them.
  test(
    'sin(sin(x) + 10^18) = 0 finishes',
    () => {
      const latex = '\\sin(\\sin(x)+10^{18})=0';
      const start = Date.now();
      const roots = ce.parse(latex).solve('x');
      if (roots !== null) {
        for (const r of roots)
          expect(
            Math.abs(Math.sin(Math.sin(r.N().re) + 1e18))
          ).toBeLessThan(1e-6);
      }
      solveLatex(latex);
      expect(Date.now() - start).toBeLessThan(5000);
    },
    60_000
  );
});

// The outer equation has roots in more than one period of its argument that
// the inner `sin` or `cos` can reach: `sin(4u) = 0` with `u = sin(x)` holds
// for `4u = 0`, `π` and `-π`. The root finder gave only `4u = 0` and
// `4u = π`.
describe('THE ARGUMENT REACHES MORE THAN ONE PERIOD OF THE OUTER FUNCTION', () => {
  const cases: Array<[string, (x: number) => number]> = [
    ['\\sin(4\\sin(x))=0', (x) => Math.sin(4 * Math.sin(x))],
    ['\\sin(10\\sin(x))=0', (x) => Math.sin(10 * Math.sin(x))],
    ['\\cos(4\\sin(x))=0', (x) => Math.cos(4 * Math.sin(x))],
    ['\\sin(\\pi\\sin(x))=0', (x) => Math.sin(Math.PI * Math.sin(x))],
    ['\\cos(3\\cos(x))=\\frac12', (x) => Math.cos(3 * Math.cos(x)) - 0.5],
    // `tan` and `cot` have the period of one half turn. The scan uses a
    // function with the same roots and no poles: `tan(v) = 1` and
    // `cot(v) = 1` hold when `sin(v) = cos(v)`, and `tan(v) = 0` holds when
    // `sin(v) = 0`.
    [
      '\\tan(4\\sin(x))=1',
      (x) => Math.sin(4 * Math.sin(x)) - Math.cos(4 * Math.sin(x)),
    ],
    ['\\tan(4\\sin(x))=0', (x) => Math.sin(4 * Math.sin(x))],
    [
      '\\cot(4\\sin(x))=1',
      (x) => Math.sin(4 * Math.sin(x)) - Math.cos(4 * Math.sin(x)),
    ],
  ];
  for (const [latex, f] of cases) {
    test(`${latex}: expr.solve()`, () => {
      const roots = ce.parse(latex).solve('x');
      expect(roots).not.toBeNull();
      // One root of each family in one period: reduced to `[-π, π)`, the
      // distinct values are the roots of `f` there.
      const inPeriod = sortedValues(roots as Expression[])
        .map((v) => v - 2 * Math.PI * Math.round(v / (2 * Math.PI)))
        .map((v) => (v >= Math.PI - 1e-12 ? v - 2 * Math.PI : v))
        .sort((a, b) => a - b)
        .filter((v, i, all) => i === 0 || Math.abs(v - all[i - 1]) > 1e-9);
      expectRootsOf(inPeriod, f, -Math.PI - 1e-9, Math.PI - 1e-9);
    });
    test(`${latex}: Solve with no domain`, () => {
      expectFamiliesOf(solveLatex(latex), f);
    });
    test(`${latex}: Solve over [-7, 7]`, () => {
      const result = solveOver(latex, -7, 7);
      expect(result.operator).toBe('List');
      expectRootsOf(sortedValues(result.ops!), f, -7, 7);
    });
  }
});

// `expr.solve()` gives one root of each family in one period: the root
// template gives `arcsin(c)` and `π - arcsin(c)`, which are one root
// modulo `2π` when `c = ±1`.
describe('EXPR.SOLVE() GIVES EACH FAMILY ONCE', () => {
  test('sin(x) = -1 gives -π/2 only', () => {
    expect(
      ce
        .parse('\\sin(x)=-1')
        .solve('x')!
        .map((r) => r.toString())
    ).toEqual(['-1/2 * pi']);
  });

  test('cos(x) = -1 gives π only', () => {
    expect(
      ce
        .parse('\\cos(x)=-1')
        .solve('x')!
        .map((r) => r.toString())
    ).toEqual(['pi']);
  });

  test('sin(π·sin(x)) = 0 gives 0, π, π/2 and -π/2', () => {
    const roots = ce.parse('\\sin(\\pi\\sin(x))=0').solve('x');
    expect(sortedValues(roots as Expression[])).toEqual([
      -Math.PI / 2,
      0,
      Math.PI / 2,
      Math.PI,
    ]);
  });

  test('explain("solve") gives the same list', () => {
    expect(ce.parse('\\sin(x)=-1').explain('solve').result.toString()).toBe(
      '[-1/2 * pi]'
    );
  });

  test('explain("solve") has a step that names the removed root', () => {
    const steps = ce
      .parse('\\sin(x)=-1')
      .explain('solve')
      .steps.map((s) => `${s.id}: ${s.value.toString()}`);
    expect(steps.slice(-2)).toEqual([
      'solve.periodic-duplicate: x == 3/2 * pi',
      'solve.roots: x == -1/2 * pi',
    ]);
  });

  // `x·sin(x)` is not periodic: the list is not changed.
  test('x·sin(x) = 0 gives 0 and π', () => {
    expect(
      sortedValues(ce.parse('x\\sin(x)=0').solve('x') as Expression[])
    ).toEqual([0, Math.PI]);
  });
});

// The roots `-arccos(-1/3)` and `arccos(1/3) - π` are in the same family
// of spacing `π`, but their difference does not evaluate to 0.
describe('ROOTS WRITTEN WITH THE ARCCOS OF A NEGATIVE CONSTANT', () => {
  test('cos(x)^2 = 1/9', () => {
    const f = (x: number) => Math.cos(x) ** 2 - 1 / 9;
    expectFamiliesOf(solveLatex('\\cos(x)^2=\\frac19'), f);
    expectRootsOf(
      sortedValues(solveOver('\\cos(x)^2=\\frac19', -7, 7).ops!),
      f,
      -7,
      7
    );
  });
});

// The type of `arcsin(c)` for a real `c` is `complex` (the type does not use
// the value of `c`), so a root `arcsin(arccos(9/10))` was removed for an
// unknown declared `real`. Its structure shows that it is real.
describe('A ROOT ARCSIN(C) FOR AN UNKNOWN DECLARED REAL', () => {
  const ceReal = new ComputeEngine();
  ceReal.declare('x', 'real');

  test('sin(x) = arccos(9/10)', () => {
    const roots = ceReal.parse('\\sin(x)=\\arccos(\\frac{9}{10})').solve('x');
    expect(roots).not.toBeNull();
    const f = (x: number) => Math.sin(x) - Math.acos(0.9);
    expectRootsOf(sortedValues(roots as Expression[]), f, -Math.PI / 2, 4);
  });

  test('cos(sin(x)) = 9/10', () => {
    const roots = ceReal.parse('\\cos(\\sin(x))=\\frac{9}{10}').solve('x');
    expect(roots).not.toBeNull();
    const f = (x: number) => Math.cos(Math.sin(x)) - 0.9;
    expectRootsOf(sortedValues(roots as Expression[]), f, -2, 4);
  });

  test('cos(cos(x)) = 9/10 over [-7, 7]', () => {
    const result = ceReal
      .function('Solve', [
        ceReal.parse('\\cos(\\cos(x))=\\frac{9}{10}'),
        ceReal.function('Element', [
          ceReal.symbol('x'),
          ceReal.function('Interval', [ceReal.number(-7), ceReal.number(7)]),
        ]),
      ])
      .evaluate();
    expect(result.operator).toBe('List');
    const f = (x: number) => Math.cos(Math.cos(x)) - 0.9;
    expectRootsOf(sortedValues(result.ops!), f, -7, 7);
  });

  test('sin(x) = 2 still has no root', () => {
    expect(ceReal.parse('\\sin(x)=2').solve('x')).toEqual([]);
  });
});
