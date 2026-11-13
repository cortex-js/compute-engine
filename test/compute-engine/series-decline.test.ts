import { ComputeEngine } from '../../src/compute-engine';

//
// `Series` declines where a Taylor expansion is not the answer: at an
// infinity written as a call or as `ComplexInfinity`, and where a library
// function has a derivative the engine cannot evaluate (a pole of ₂F₁ at
// x = 1). It used to expand with `f(∞)` and `Apply(Derivative(…), …)` terms.
//

const ce = new ComputeEngine();

const series = (f: unknown, point: unknown, n = 3) =>
  ce.expr(['Series', f, 'x', point, n] as never);

describe('SERIES AT A POINT AT INFINITY', () => {
  const airy = ['AiryAi', 'x'];
  const declined: [string, unknown, unknown][] = [
    ['AiryAi at DirectedInfinity(1)', airy, ['DirectedInfinity', 1]],
    ['AiryAi at DirectedInfinity(-1)', airy, ['DirectedInfinity', -1]],
    ['AiryAi at ComplexInfinity', airy, 'ComplexInfinity'],
    ['exp(x) at ComplexInfinity', ['Exp', 'x'], 'ComplexInfinity'],
    [
      'exp(x) at DirectedInfinity(i)',
      ['Exp', 'x'],
      ['DirectedInfinity', ['Complex', 0, 1]],
    ],
    ['sqrt(x) at ComplexInfinity', ['Sqrt', 'x'], 'ComplexInfinity'],
    [
      'AiryAi at DirectedInfinity(i)',
      airy,
      ['DirectedInfinity', ['Complex', 0, 1]],
    ],
  ];
  for (const [name, f, point] of declined) {
    test(`${name} stays Series (evaluate)`, () => {
      const e = series(f, point);
      expect(e.evaluate().operator).toBe('Series');
    });
    test(`${name} stays Series (N)`, () => {
      expect(series(f, point).N().operator).toBe('Series');
    });
  }

  test('AiryAi at PositiveInfinity stays Series', () => {
    expect(series(airy, 'PositiveInfinity').evaluate().operator).toBe('Series');
  });

  // DirectedInfinity(±1) is ±∞ written as a call: the same expansion.
  const f = ['Divide', 1, ['Add', 'x', 1]];
  for (const [call, symbol] of [
    [['DirectedInfinity', 1], 'PositiveInfinity'],
    [['DirectedInfinity', -1], 'NegativeInfinity'],
  ] as const) {
    test(`1/(x+1) at ${JSON.stringify(call)} is the expansion at ${symbol}`, () => {
      const expected = series(f, symbol).evaluate();
      expect(expected.operator).not.toBe('Series');
      expect(series(f, call).evaluate().isSame(expected)).toBe(true);
    });
  }

  // The expansion in 1/x is the same at +∞ and at −∞: it is the one at ~∞.
  const rational = [
    'Divide',
    ['Add', ['Square', 'x'], 1],
    ['Add', ['Square', 'x'], ['Negate', 'x'], 2],
  ];
  for (const [name, g] of [
    ['1/(x+1)', f],
    ['(x²+1)/(x²−x+2)', rational],
  ] as const)
    for (const point of [
      'ComplexInfinity',
      ['DirectedInfinity', ['Complex', 0, 1]],
    ]) {
      test(`${name} at ${JSON.stringify(point)} is its expansion at ±∞`, () => {
        const expected = series(g, 'PositiveInfinity').evaluate();
        expect(expected.operator).not.toBe('Series');
        expect(series(g, 'NegativeInfinity').evaluate().isSame(expected)).toBe(
          true
        );
        expect(series(g, point).evaluate().isSame(expected)).toBe(true);
      });
    }

  test('(x²+1)/(x²−x+2) at ~∞ is 1 + 1/x − 2/x³ + O(x⁻⁴), as Wolfram gives', () => {
    const polynomial = ce.expr(['Normal', series(rational, 'ComplexInfinity')]);
    const x = 10;
    expect(polynomial.evaluate().subs({ x }).N().re).toBeCloseTo(
      1 + 1 / x - 2 / x ** 3,
      12
    );
  });

  test('1/(x+1) at PositiveInfinity is 1/x − 1/x² + 1/x³ + O(x⁻⁴)', () => {
    const s = series(f, 'PositiveInfinity').evaluate();
    expect(s.has('BigO')).toBe(true);
    const polynomial = ce.expr(['Normal', series(f, 'PositiveInfinity')]);
    expect(polynomial.evaluate().subs({ x: 10 }).N().re).toBeCloseTo(
      0.1 - 0.01 + 0.001,
      12
    );
  });
});

describe('SERIES WITH A DERIVATIVE THE ENGINE CANNOT EVALUATE', () => {
  // ₂F₁(1, 1; 3; x) about x = 1 runs in (1 − x)·ln(1 − x): its first
  // derivative is a pole there, not a coefficient.
  const cases: [string, unknown, number][] = [
    ['2F1(1,1;3;x) at 1', ['Hypergeometric2F1', 1, 1, 3, 'x'], 1],
    ['2F1(1,2;5;x) at 1', ['Hypergeometric2F1', 1, 2, 5, 'x'], 1],
    ['2F1(1,1;1;x) at 1', ['Hypergeometric2F1', 1, 1, 1, 'x'], 1],
    ['2F1(1,1;3;x) at 0', ['Hypergeometric2F1', 1, 1, 3, 'x'], 0],
    ['1F1(1;2;x) at 0', ['Hypergeometric1F1', 1, 2, 'x'], 0],
  ];
  for (const [name, f, point] of cases) {
    test(`${name} stays Series (evaluate)`, () => {
      expect(series(f, point).evaluate().operator).toBe('Series');
    });
    test(`${name} holds no Apply(Derivative) after N()`, () => {
      expect(series(f, point).N().has('Derivative')).toBe(false);
    });
  }

  test('a function the engine does not define keeps its symbolic Taylor form', () => {
    const e = ce.expr(['Series', ['f', 'x'], 'x', 0, 2] as never).evaluate();
    expect(e.operator).not.toBe('Series');
    expect(e.has('Derivative')).toBe(true);
  });

  test('a function with a known derivative still expands: AiryAi at 0', () => {
    const e = series(['AiryAi', 'x'], 0).evaluate();
    expect(e.operator).not.toBe('Series');
    expect(e.has('Derivative')).toBe(false);
  });
});
