import { ComputeEngine } from '../../src/compute-engine';

//
// d/dz ₂F₁(a, b; c; z) = (ab/c)·₂F₁(a + 1, b + 1; c + 1; z) (DLMF 15.5.1), and
// the expansions it gives: `Series` of ₂F₁ about 0 has the coefficients
// (a)ₖ(b)ₖ/((c)ₖ k!), a terminating ₂F₁ is its polynomial about any point, and
// the branch point z = 1 and the cut past it still decline.
//

const ce = new ComputeEngine();
const F = (...args: unknown[]) => ['Hypergeometric2F1', ...args];
const series = (f: unknown, point: unknown, n: number) =>
  ce.expr(['Series', f, 'x', point, n] as never).evaluate();
const polynomial = (f: unknown, point: unknown, n: number) =>
  ce.expr(['Normal', series(f, point, n)] as never).evaluate();

describe('DERIVATIVE OF Hypergeometric2F1 IN z', () => {
  test('closed form', () => {
    expect(
      ce.expr(['D', F('a', 'b', 'c', 'x'), 'x'] as never).evaluate().json
    ).toEqual(
      ce
        .expr([
          'Divide',
          [
            'Multiply',
            'a',
            'b',
            F(['Add', 'a', 1], ['Add', 'b', 1], ['Add', 'c', 1], 'x'),
          ],
          'c',
        ] as never)
        .evaluate().json
    );
  });

  test('chain rule', () => {
    const d = ce.expr(['D', F(1, 2, 3, ['Sin', 'x']), 'x'] as never).evaluate();
    expect(d.has('Derivative')).toBe(false);
    expect(d.subs({ x: 0.5 }).N().re).toBeCloseTo(
      (2 / 3) * Math.cos(0.5) * 2.57911741191532, // ₂F₁(2, 3; 4; sin 0.5), mpmath
      8
    );
  });

  test('a terminating series differentiates to a polynomial', () => {
    expect(
      ce.expr(['D', F(-2, 3, 4, 'x'), 'x'] as never).evaluate().json
    ).toEqual(
      ce.expr(['Multiply', ['Rational', -3, 2], F(-1, 4, 5, 'x')] as never).json
    );
  });

  test('the parameters keep the inert partial', () => {
    expect(
      ce.expr(['D', F('a', 2, 3, 'x'), 'a'] as never).evaluate().operator
    ).not.toBe('Series');
  });
});

describe('SERIES OF Hypergeometric2F1', () => {
  test('a terminating series expands exactly about 0', () => {
    const s = series(F(-2, 3, 4, 'x'), 0, 5);
    expect(s.has('BigO')).toBe(false);
    expect(
      s.isSame(
        ce
          .expr([
            'Add',
            1,
            ['Multiply', ['Rational', -3, 2], 'x'],
            ['Multiply', ['Rational', 3, 5], ['Square', 'x']],
          ] as never)
          .evaluate()
      )
    ).toBe(true);
  });

  test('a terminating series expands exactly about another point', () => {
    const s = series(F(-2, 3, 4, 'x'), 1, 2);
    expect(s.has('BigO')).toBe(false);
    expect(s.has('Hypergeometric2F1')).toBe(false);
    const p = polynomial(F(-2, 3, 4, 'x'), 1, 2);
    // mpmath: ₂F₁(−2, 3; 4; z) = 1/10 − 3/10 (z − 1) + 3/5 (z − 1)²
    expect(p.subs({ x: 3 }).evaluate().json).toEqual(
      ce
        .expr(['Rational', 1, 10] as never)
        .add(ce.expr(['Rational', -3, 5] as never))
        .add(ce.expr(['Rational', 12, 5] as never)).json
    );
  });

  test('a terminating series with a composite argument and a symbolic parameter', () => {
    expect(
      series(F(-2, 3, 4, ['Multiply', 2, 'x']), 0, 4).isSame(
        ce
          .expr([
            'Add',
            1,
            ['Multiply', -3, 'x'],
            ['Multiply', ['Rational', 12, 5], ['Square', 'x']],
          ] as never)
          .evaluate()
      )
    ).toBe(true);
    expect(series(F(-1, 'b', 3, 'x'), 0, 3).has('BigO')).toBe(false);
  });

  test('₂F₁(1, 1; 2; x) is −ln(1 − x)/x: coefficients 1/(k + 1)', () => {
    const p = polynomial(F(1, 1, 2, 'x'), 0, 3);
    expect(p.subs({ x: 2 }).evaluate().json).toEqual(
      ce.expr(['Add', 1, 1, ['Rational', 4, 3], 2] as never).evaluate().json
    );
  });

  test('₂F₁(1, 1; 3; x) about 0: 1, 1/3, 1/6, 1/10 (mpmath)', () => {
    const p = polynomial(F(1, 1, 3, 'x'), 0, 3);
    expect(p.subs({ x: 6 }).evaluate().json).toEqual(
      ce.expr(['Add', 1, 2, 6, ['Rational', 216, 10]] as never).evaluate().json
    );
  });

  test('symbolic parameters give the Pochhammer coefficients', () => {
    const p = polynomial(F('a', 'b', 'c', 'x'), 0, 2);
    expect(p.has('Derivative')).toBe(false);
    // 1 + (ab/c)x + (a)₂(b)₂/(2 (c)₂)x² at a = b = 1, c = 2, x = 6
    expect(p.subs({ a: 1, b: 1, c: 2, x: 6 }).evaluate().json).toEqual(16);
  });

  test('about another regular point, the coefficients are the derivatives', () => {
    const f = F(1, 1, 3, 'x');
    expect(series(f, -1, 2).operator).not.toBe('Series');
    // mpmath: f(−1) = 0.7725887222, f′(−1) = 0.1588830834,
    // f″(−1)/2 = 0.04517744448
    const p = polynomial(f, -1, 2);
    const at = (x: number) => p.subs({ x }).N().re;
    expect(at(-1)).toBeCloseTo(0.7725887222, 8);
    expect(at(-0.9)).toBeCloseTo(
      0.7725887222 + 0.01588830834 + 0.0004517744448,
      8
    );
  });

  test.each([
    ['at 1', F(1, 1, 3, 'x'), 1],
    ['at 1, c = a + b', F(1, 1, 2, 'x'), 1],
    ['on the cut', F(1, 2, 3, 'x'), 2],
    [
      'at an argument of 1',
      F(1, 1, 3, ['Multiply', 2, 'x']),
      ['Rational', 1, 2],
    ],
    ['c = 0', F(1, 2, 0, 'x'), 0],
    ['c = −1', F(1, 2, -1, 'x'), 0],
    ['terminating, c = −1', F(-3, 2, -1, 'x'), 0],
    ['at +∞', F(1, 1, 2, 'x'), 'PositiveInfinity'],
  ])('declines %s', (_name, f, point) => {
    for (const e of [
      series(f, point, 2),
      ce.expr(['Series', f, 'x', point, 2] as never).N(),
    ])
      expect(e.operator).toBe('Series');
  });
});
