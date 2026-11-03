/**
 * A `Power` with an infinite base or exponent whose value is 0 keeps the
 * float character of a float operand: `0.5^∞`, `2.5^{-∞}` and `∞^{-2.5}`
 * are the float `0`, as `Divide(2.5, ∞)` is. With exact operands the result
 * stays the exact `0` (`(1/2)^∞`, `3^{-∞}`, `∞^{-2}`).
 */
import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine';
import type { MathJsonExpression } from '../../src/math-json/types';

const ce = new ComputeEngine();

/** `exact` or `float` for a number literal, the MathJSON otherwise. */
function kind(x: Expression): string {
  if (!x.isNumberLiteral) return JSON.stringify(x.json);
  return `${x.toString()} ${x.isExact ? 'exact' : 'float'}`;
}

describe('POWER — a float operand with an infinity gives the float 0', () => {
  const floatCases: MathJsonExpression[] = [
    ['Power', { num: '0.5' }, 'PositiveInfinity'],
    ['Power', { num: '-0.5' }, 'PositiveInfinity'],
    ['Power', { num: '0.0' }, 'PositiveInfinity'],
    ['Power', { num: '2.5' }, 'NegativeInfinity'],
    ['Power', { num: '-2.5' }, 'NegativeInfinity'],
    ['Power', 'PositiveInfinity', { num: '-2.5' }],
    ['Power', 'NegativeInfinity', { num: '-2.5' }],
    ['Power', ['Complex', { num: '0.5' }, { num: '0.5' }], 'PositiveInfinity'],
    ['Power', ['Complex', { num: '2.5' }, { num: '0.5' }], 'NegativeInfinity'],
    ['Power', 'PositiveInfinity', ['Complex', { num: '-2.5' }, 1]],
  ];
  test.each(floatCases.map((x) => [x]))('%j', (json) => {
    expect(kind(ce.box(json))).toBe('0 float');
    expect(kind(ce.box(json).evaluate())).toBe('0 float');
    expect(kind(ce.box(json).N())).toBe('0 float');
  });

  test('the fractional part of the float 0 is the float 0', () => {
    expect(
      kind(
        ce
          .box(['Fract', ['Power', { num: '0.5' }, 'PositiveInfinity']])
          .evaluate()
      )
    ).toBe('0 float');
  });

  test('the folds agree with Divide(2.5, ∞)', () => {
    expect(kind(ce.box(['Divide', { num: '2.5' }, 'PositiveInfinity']))).toBe(
      '0 float'
    );
  });
});

describe('POWER — exact operands with an infinity keep the exact 0', () => {
  const exactCases: MathJsonExpression[] = [
    ['Power', ['Rational', 1, 2], 'PositiveInfinity'],
    ['Power', 0, 'PositiveInfinity'],
    ['Power', 3, 'NegativeInfinity'],
    ['Power', 'PositiveInfinity', -2],
    ['Power', 'NegativeInfinity', -3],
    ['Power', 'PositiveInfinity', 'NegativeInfinity'],
    ['Power', 'ExponentialE', 'NegativeInfinity'],
    [
      'Power',
      ['Complex', ['Rational', 1, 2], ['Rational', 1, 2]],
      'PositiveInfinity',
    ],
  ];
  test.each(exactCases.map((x) => [x]))('%j', (json) => {
    expect(kind(ce.box(json))).toBe('0 exact');
    expect(kind(ce.box(json).evaluate())).toBe('0 exact');
  });

  test('the infinite results are unchanged', () => {
    expect(
      ce.box(['Power', { num: '2.5' }, 'PositiveInfinity']).toString()
    ).toBe('+oo');
    expect(ce.box(['Power', 3, 'PositiveInfinity']).toString()).toBe('+oo');
    expect(
      ce.box(['Power', { num: '-2.5' }, 'PositiveInfinity']).toString()
    ).toBe('~oo');
    expect(
      ce.box(['Power', { num: '0.5' }, 'NegativeInfinity']).toString()
    ).toBe('+oo');
  });
});

describe('POWER — a variable base to an infinity is not folded at canonicalization', () => {
  test('a base whose comparisons are not known stays unfolded', () => {
    const ce = new ComputeEngine();
    ce.declare('z', 'real');
    ce.declare('p', 'real');
    ce.assume(ce.box(['Greater', 'p', 0]));
    ce.declare('w', 'finite_real');
    for (const v of ['z', 'p', 'w']) {
      for (const inf of ['PositiveInfinity', 'NegativeInfinity']) {
        const e = ce.box(['Power', v, inf]);
        expect(e.operator).toBe('Power');
        expect(e.evaluate().operator).toBe('Power');
      }
      const up = ce.box(['Power', v, 'PositiveInfinity']);
      const down = ce.box(['Power', v, 'NegativeInfinity']);
      expect(
        up
          .subs({ [v]: 2 })
          .evaluate()
          .toString()
      ).toBe('+oo');
      expect(kind(up.subs({ [v]: { num: '0.5' } }).evaluate())).toBe('0 float');
      expect(kind(down.subs({ [v]: 2 }).evaluate())).toBe('0 exact');
      expect(
        down
          .subs({ [v]: { num: '0.5' } })
          .evaluate()
          .toString()
      ).toBe('+oo');
    }
    // A float base that is computed when the power is evaluated (`2 + 0.5`)
    // takes the same folds: the numeric kernel would give `NaN`.
    expect(
      ce
        .box(['Power', ['Add', 'z', { num: '0.5' }], 'PositiveInfinity'])
        .subs({ z: 2 })
        .evaluate()
        .toString()
    ).toBe('+oo');
  });

  test('a symbol with a value folds with its value when it is evaluated', () => {
    const ce = new ComputeEngine();
    ce.assign('x', ce.box({ num: '0.5' }));
    const e = ce.box(['Power', 'x', 'PositiveInfinity']);
    expect(e.operator).toBe('Power');
    expect(kind(e.evaluate())).toBe('0 float');
    expect(kind(e.N())).toBe('0 float');
    ce.assign('x', ce.box({ num: '2.5' }));
    expect(e.evaluate().toString()).toBe('+oo');
    ce.assign('x', ce.box(['Rational', 1, 2]));
    expect(kind(e.evaluate())).toBe('0 exact');
    expect(
      ce.box(['Power', 'x', 'NegativeInfinity']).evaluate().toString()
    ).toBe('+oo');
  });

  test('a constant base still folds at canonicalization', () => {
    const ce = new ComputeEngine();
    expect(ce.box(['Power', 'Pi', 'PositiveInfinity']).toString()).toBe('+oo');
    expect(kind(ce.box(['Power', 'Pi', 'NegativeInfinity']))).toBe('0 exact');
    expect(
      ce.box(['Power', ['Negate', 'Pi'], 'PositiveInfinity']).toString()
    ).toBe('~oo');
  });
});

describe('POWER — a literal base near 1 to an infinity is compared exactly', () => {
  // The comparison with 1, −1 and 0 reads the exact value of the literal,
  // with no tolerance and with all the digits of a big float.
  const cases: [MathJsonExpression, string, string][] = [
    [{ num: '0.99999999999' }, '0 float', '+oo'],
    [{ num: '1.00000000001' }, '+oo', '0 float'],
    [{ num: '0.999999999999999999999' }, '0 float', '+oo'],
    [{ num: '1.000000000000000000001' }, '+oo', '0 float'],
    [{ num: '-0.999999999999999999999' }, '0 float', '~oo'],
    [{ num: '-1.000000000000000000001' }, '~oo', '0 float'],
  ];
  const show = (x: Expression) =>
    x.isNumberLiteral && x.isFinite ? kind(x) : x.toString();
  test.each(cases)('%j', (base, up, down) => {
    for (const [inf, expected] of [
      ['PositiveInfinity', up],
      ['NegativeInfinity', down],
    ] as const) {
      const e = ce.box(['Power', base, inf]);
      expect(show(e)).toBe(expected);
      expect(show(e.evaluate())).toBe(expected);
      expect(show(e.N())).toBe(expected);
    }
  });

  test('a base computed under N() takes the same folds', () => {
    expect(
      ce
        .box(['Power', ['Add', 1, ['Power', 10, -30]], 'PositiveInfinity'])
        .N()
        .toString()
    ).toBe('+oo');
    expect(
      kind(ce.box(['Power', ['Divide', 'Pi', 4], 'PositiveInfinity']).N())
    ).toBe('0 float');
    expect(
      ce
        .box(['Power', ['Add', 'Pi', 1], 'PositiveInfinity'])
        .N()
        .toString()
    ).toBe('+oo');
  });

  test('an exact 1 or −1 to an infinity stays NaN', () => {
    for (const base of [1, -1])
      for (const inf of ['PositiveInfinity', 'NegativeInfinity'])
        expect(ce.box(['Power', base, inf]).evaluate().toString()).toBe(
          'NaN'
        );
  });
});
