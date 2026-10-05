import { ComputeEngine } from '../../src/compute-engine';

/**
 * Limits at infinity of a function that takes complex values for a real
 * argument (GitHub issue 396).
 *
 * The strategies at infinity choose between `+∞` and `−∞` from the sign of a
 * term. A complex value has no sign, and `i·t` was read as `+∞`: `e^{it}`
 * gave `+∞` and `Erf(it)` gave `1`. Such a limit is now taken through the
 * real part and the imaginary part, and it is declined when one of them has
 * no finite limit (the engine has no directed complex infinity).
 */

const ce = new ComputeEngine();
const I = 'ImaginaryUnit';

function lim(body: unknown, point: unknown = 'PositiveInfinity') {
  return ce.box(['Limit', ['Function', body, 't'], point] as any);
}

const isUnevaluated = (e: { operator: string }) => e.operator === 'Limit';

describe('LIMIT OF A COMPLEX-VALUED FUNCTION AT INFINITY', () => {
  test('Gamma goes to 0 along the imaginary axis (DLMF 5.11.9)', () => {
    expect(lim(['Gamma', ['Multiply', I, 't']]).evaluate().json).toBe(0);
    expect(lim(['Gamma', ['Multiply', -1, I, 't']]).evaluate().json).toBe(0);
    expect(
      lim(['Gamma', ['Multiply', I, 't']], 'NegativeInfinity').evaluate().json
    ).toBe(0);
    // A fixed real part does not change the limit.
    expect(
      lim(['Gamma', ['Add', 1, ['Multiply', I, 't']]]).evaluate().json
    ).toBe(0);
    expect(lim(['Gamma', ['Multiply', I, 't']]).N().json).toBe(0);
    // The numeric value agrees: |Γ(40i)| is about 1e-28.
    const sample = ce.box(['Abs', ['Gamma', ['Complex', 0, 40]]]).N().re;
    expect(sample).toBeLessThan(1e-25);
  });

  test('continuous heads carry the limit', () => {
    expect(lim(['Abs', ['Gamma', ['Multiply', I, 't']]]).evaluate().json).toBe(
      0
    );
    expect(lim(['Real', ['Gamma', ['Multiply', I, 't']]]).evaluate().json).toBe(
      0
    );
  });

  test('a rational function with complex coefficients', () => {
    expect(
      lim(['Divide', ['Add', 1, ['Multiply', I, 't']], 't']).evaluate().json
    ).toEqual(['Complex', 0, 1]);
    expect(lim(['Divide', 1, ['Add', 't', I]]).evaluate().json).toBe(0);
    expect(
      lim([
        'Divide',
        ['Add', ['Multiply', 2, 't'], I],
        ['Subtract', 't', ['Multiply', 3, I]],
      ]).evaluate().json
    ).toBe(2);
  });

  test('a decaying oscillation', () => {
    expect(
      lim(['Divide', ['Exp', ['Multiply', I, 't']], 't']).evaluate().json
    ).toBe(0);
    expect(
      lim(['Exp', ['Multiply', ['Complex', -1, 1], 't']]).evaluate().json
    ).toBe(0);
  });

  test('a limit that does not exist is not answered', () => {
    // `e^{it}` turns on the unit circle. It was `+∞`.
    const circle = lim(['Exp', ['Multiply', I, 't']]);
    expect(isUnevaluated(circle.evaluate())).toBe(true);
    expect(circle.N().isNaN).toBe(true);
    // `Erf(it) = i·Erfi(t)` is not bounded. It was `1`.
    expect(isUnevaluated(lim(['Erf', ['Multiply', I, 't']]).evaluate())).toBe(
      true
    );
    // `i·t` is not bounded, and has no real sign. It was `+∞`.
    expect(isUnevaluated(lim(['Multiply', I, 't']).evaluate())).toBe(true);
  });

  test('the numeric route extrapolates both parts', () => {
    const v = ce
      .box([
        'NLimit',
        ['Function', ['Add', I, ['Divide', 1, 't']], 't'],
        'PositiveInfinity',
      ])
      .evaluate();
    expect(v.re).toBeCloseTo(0, 10);
    expect(v.im).toBeCloseTo(1, 10);
  });
});

describe('LIMIT AT INFINITY: A POWER OF A BASE THAT GOES TO −∞', () => {
  // `(−t)^{3/2} = −i·t^{3/2}` is not real. It was read as `+∞`.
  const negPower = ['Power', ['Negate', 't'], ['Rational', 3, 2]];

  test('a non-integer power has no signed limit', () => {
    expect(isUnevaluated(lim(negPower).evaluate())).toBe(true);
    expect(
      isUnevaluated(
        lim(['Power', 't', ['Rational', 3, 2]], 'NegativeInfinity').evaluate()
      )
    ).toBe(true);
  });

  test('an integer power takes its sign from the parity', () => {
    expect(lim(['Power', ['Negate', 't'], 3]).evaluate().json).toBe(
      'NegativeInfinity'
    );
    expect(lim(['Power', ['Negate', 't'], 4]).evaluate().json).toBe(
      'PositiveInfinity'
    );
  });

  test('Gamma of such a power is not answered +∞ or 0', () => {
    // Γ(−i·t^{3/2}) goes to 0; `+∞` was the wrong answer.
    expect(lim(['Gamma', negPower]).evaluate().json).not.toBe(
      'PositiveInfinity'
    );
    // i·(−t)^{3/2} = t^{3/2}, so this limit is +∞; `0` is the wrong answer.
    expect(lim(['Gamma', ['Multiply', I, negPower]]).evaluate().json).not.toBe(
      0
    );
  });
});

describe('NUMERIC LIMIT AT −∞', () => {
  const nlim = (body: unknown) =>
    ce
      .box(['NLimit', ['Function', body, 't'], 'NegativeInfinity'] as any)
      .evaluate();

  test('a real function is sampled at negative arguments', () => {
    expect(nlim(['Arctan', 't']).re).toBeCloseTo(-Math.PI / 2, 8);
  });

  test('a complex-valued function is sampled at negative arguments', () => {
    const v = nlim(['Multiply', I, ['Arctan', 't']]);
    expect(v.re).toBeCloseTo(0, 8);
    expect(v.im).toBeCloseTo(-Math.PI / 2, 8);
  });

  test('a complex numeric limit is a float', () => {
    const v = ce
      .box([
        'NLimit',
        ['Function', ['Add', I, ['Divide', 1, 't']], 't'],
        'PositiveInfinity',
      ] as any)
      .evaluate();
    expect((v as any).isExact).toBe(false);
  });
});

describe('LIMIT AT INFINITY: A SIGN THAT IS NOT DECIDED', () => {
  test('a coefficient with no known sign gives no answer', () => {
    // `a·t` goes to `+∞`, to `−∞` or stays at 0, depending on `a`. It was `+∞`.
    expect(isUnevaluated(lim(['Multiply', 'a', 't']).evaluate())).toBe(true);
    // The same for a quotient whose numerator grows faster.
    expect(
      isUnevaluated(
        lim(['Divide', ['Multiply', 'a', ['Exp', 't']], 't']).evaluate()
      )
    ).toBe(true);
    expect(lim(['Divide', ['Exp', 't'], 't']).evaluate().json).toBe(
      'PositiveInfinity'
    );
    expect(
      lim(['Divide', ['Multiply', -3, ['Exp', 't']], 't']).evaluate().json
    ).toBe('NegativeInfinity');
  });

  test('a decided sign still answers', () => {
    expect(lim(['Multiply', -2, 't']).evaluate().json).toBe('NegativeInfinity');
    expect(lim(['Multiply', 'Pi', 't']).evaluate().json).toBe(
      'PositiveInfinity'
    );
  });

  test('Gamma at +∞', () => {
    expect(lim(['Gamma', 't']).evaluate().json).toBe('PositiveInfinity');
    expect(lim(['Divide', 1, ['Gamma', 't']]).evaluate().json).toBe(0);
  });
});
