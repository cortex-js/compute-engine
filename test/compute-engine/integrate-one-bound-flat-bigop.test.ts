/**
 * Two readings of indexing sets (user decisions of 2026-10-01):
 *
 * 1. A definite integral with only ONE bound (`\int^2 f\,dy`, `\int_0 f\,dy`,
 *    `Limits(y, Nothing, 2)`, the flat `["Integrate", f, "x", 10]`) stays
 *    unevaluated under `evaluate()` and `N()`: no default is chosen for the
 *    missing bound. Before, `\int^2 y^2\,dy` evaluated to 7/3, as if the lower
 *    bound were 1.
 *
 * 2. The flat spelling of `Sum` and `Product` (`["Sum", body, index, lower,
 *    upper]`) is read like the flat spelling of `Integrate`:
 *    `Sum(body, Limits(index, lower, upper))`. Before, it gave
 *    `Error("missing")`.
 */
import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { parseEpsil } from '../../src/epsil/parse-epsil';

const ce = new ComputeEngine();

describe('A DEFINITE INTEGRAL WITH ONLY ONE BOUND', () => {
  const ONE_BOUND: [string, () => ReturnType<typeof ce.parse>][] = [
    ['\\int^2 y^2 dy', () => ce.parse('\\int^2 y^2 dy')],
    ['\\int_0 y^2 dy', () => ce.parse('\\int_0 y^2 dy')],
    [
      'Limits(y, Nothing, 2)',
      () =>
        ce.box(['Integrate', ['Power', 'y', 2], ['Limits', 'y', 'Nothing', 2]]),
    ],
    [
      'Limits(y, 0, Nothing)',
      () =>
        ce.box(['Integrate', ['Power', 'y', 2], ['Limits', 'y', 0, 'Nothing']]),
    ],
    ['flat "x", 10', () => ce.box(['Integrate', ['Power', 'x', 2], 'x', 10])],
    ['\\int^2\\int^3 xy dx dy', () => ce.parse('\\int^2\\int^3 xy\\,dx\\,dy')],
    [
      'an inner integral with one bound: \\int_0^1\\int^2 xy dx dy',
      () => ce.parse('\\int_0^1\\int^2 xy\\,dx\\,dy'),
    ],
    [
      // Was `1 - "Nothing"^2`.
      'a first limit with one bound',
      () =>
        ce.box([
          'Integrate',
          ['Multiply', 'x', 'y'],
          ['Limits', 'x', 'Nothing', 1],
          ['Limits', 'y', 0, 2],
        ]),
    ],
    [
      'a second limit with one bound',
      () =>
        ce.box([
          'Integrate',
          ['Multiply', 'x', 'y'],
          ['Limits', 'x', 0, 1],
          ['Limits', 'y', 'Nothing', 2],
        ]),
    ],
  ];

  test.each(ONE_BOUND)('%s stays unevaluated', (_, make) => {
    const expr = make();
    expect(expr.operator).toBe('Integrate');
    const value = expr.evaluate();
    expect(value.operator).toBe('Integrate');
    expect(value.isSame(expr)).toBe(true);
    expect(value.toString()).not.toContain('Nothing');
    const n = expr.N();
    expect(n.operator).toBe('Integrate');
    expect(n.isSame(expr)).toBe(true);
  });

  test('the flat form with one bound reads it as the upper bound', () => {
    expect(ce.box(['Integrate', ['Power', 'x', 2], 'x', 10]).json).toEqual([
      'Integrate',
      ['Function', ['Block', ['Power', 'x', 2]], 'x'],
      ['Limits', 'x', 'Nothing', 10],
    ]);
  });

  test.each([
    '\\int^{2}\\!y^2\\, \\mathrm{d}y',
    '\\int_{0}\\!y^2\\, \\mathrm{d}y',
  ])('%s round-trips', (latex) => {
    const expr = ce.parse(latex);
    expect(expr.latex).toBe(latex);
    expect(ce.parse(expr.latex).isSame(expr)).toBe(true);
    expect(ce.box(expr.json).isSame(expr)).toBe(true);
  });

  test('the indefinite integral is unchanged', () => {
    expect(ce.parse('\\int y^2 dy').evaluate().toString()).toBe('1/3 * y^3');
  });

  test('two bounds are unchanged', () => {
    const value = ce.parse('\\int_0^2 y^2 dy').evaluate();
    expect(value.toString()).toBe('8/3');
    expect(ce.parse('\\int_0^2 y^2 dy').N().re).toBeCloseTo(8 / 3, 12);
    expect(
      ce
        .box(['Integrate', ['Power', 'x', 2], 'x', 0, 2])
        .evaluate()
        .toString()
    ).toBe('8/3');
  });

  test('compiling an integral with one bound falls back to the interpreter', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const result = compile(ce.parse('\\int^2 y^2 dy'));
      expect(result.success).toBe(false);
    } finally {
      warn.mockRestore();
    }
  });
});

describe('THE FLAT FORM OF SUM AND PRODUCT', () => {
  test('Sum(k, k, 1, 10) is 55', () => {
    const expr = ce.box(['Sum', 'k', 'k', 1, 10]);
    expect(expr.json).toEqual(['Sum', 'k', ['Limits', 'k', 1, 10]]);
    expect(expr.evaluate().toString()).toBe('55');
    expect(expr.N().re).toBe(55);
  });

  test('Product(k, k, 1, 5) is 120', () => {
    const expr = ce.box(['Product', 'k', 'k', 1, 5]);
    expect(expr.json).toEqual(['Product', 'k', ['Limits', 'k', 1, 5]]);
    expect(expr.evaluate().toString()).toBe('120');
    expect(expr.N().re).toBe(120);
  });

  test('the flat form and the Limits form are the same expression', () => {
    const flat = ce.box(['Sum', ['Power', 'k', 2], 'k', 1, 10]);
    const limits = ce.box(['Sum', ['Power', 'k', 2], ['Limits', 'k', 1, 10]]);
    expect(flat.isSame(limits)).toBe(true);
    expect(flat.evaluate().toString()).toBe('385');
  });

  test('the index takes the ranged type its Limits spelling takes', () => {
    // `√(1 − ((k − 0.5)/40)²)` is real for `k` in 1..40.
    const body = [
      'Sqrt',
      ['Subtract', 1, ['Power', ['Divide', ['Subtract', 'k', 0.5], 40], 2]],
    ] as const;
    const flat = ce.box(['Sum', body as any, 'k', 1, 40]);
    const limits = ce.box(['Sum', body as any, ['Limits', 'k', 1, 40]]);
    expect(flat.type.toString()).toBe(limits.type.toString());
  });

  test('a symbolic upper bound stays free', () => {
    const expr = ce.box(['Sum', 'k', 'k', 1, 'n']);
    expect(expr.json).toEqual(['Sum', 'k', ['Limits', 'k', 1, 'n']]);
    expect(expr.freeVariables).toEqual(['n']);
    const closed = expr.simplify();
    // n(n + 1)/2, checked at several values of n.
    for (const n of [1, 4, 10, 37]) {
      expect(closed.subs({ n }).N().re).toBe((n * (n + 1)) / 2);
      expect(expr.subs({ n }).evaluate().re).toBe((n * (n + 1)) / 2);
    }
  });

  test('a symbolic upper bound reads an assigned value', () => {
    const ce2 = new ComputeEngine();
    ce2.assign('n', 4);
    expect(ce2.box(['Sum', 'k', 'k', 1, 'n']).evaluate().toString()).toBe('10');
  });

  test('several flat indexes', () => {
    const expr = ce.box(['Sum', ['Multiply', 'i', 'j'], 'i', 1, 3, 'j', 1, 2]);
    expect(expr.json).toEqual([
      'Sum',
      ['Multiply', 'i', 'j'],
      ['Limits', 'i', 1, 3],
      ['Limits', 'j', 1, 2],
    ]);
    expect(expr.evaluate().toString()).toBe('18');
  });

  test('one bound after the index is the upper bound, as for Integrate', () => {
    expect(ce.box(['Sum', 'k', 'k', 10]).json).toEqual([
      'Sum',
      'k',
      ['Limits', 'k', 'Nothing', 10],
    ]);
  });

  test('the documented forms are unchanged', () => {
    expect(ce.box(['Sum', 'k', ['Limits', 'k', 1, 10]]).evaluate().re).toBe(55);
    expect(ce.box(['Sum', 'k', ['Tuple', 'k', 1, 10]]).evaluate().re).toBe(55);
    expect(
      ce.box(['Sum', 'k', ['Element', 'k', ['List', 1, 2, 3]]]).evaluate().re
    ).toBe(6);
    expect(ce.box(['Sum', ['List', 1, 2, 3]]).evaluate().re).toBe(6);
    expect(ce.box(['Sum', 'k', 'k']).json).toEqual([
      'Sum',
      'k',
      ['Limits', 'k', 'Nothing', 'Nothing'],
    ]);
    expect(ce.parse('\\sum_{k=1}^{10} k').evaluate().re).toBe(55);
  });

  test('the Epsil call form ∑(k, k, 1, 10) evaluates', () => {
    const [sum] = parseEpsil('∑(k, k, 1, 10)');
    expect(ce.box(sum).evaluate().re).toBe(55);
    const [product] = parseEpsil('∏(k, k, 1, 5)');
    expect(ce.box(product).evaluate().re).toBe(120);
  });

  test('the flat form compiles', () => {
    const sum = compile(ce.box(['Sum', 'k', 'k', 1, 10]));
    expect(sum.success).toBe(true);
    expect(sum.run!()).toBe(55);
    const product = compile(ce.box(['Product', 'k', 'k', 1, 5]));
    expect(product.success).toBe(true);
    expect(product.run!()).toBe(120);
  });
});
