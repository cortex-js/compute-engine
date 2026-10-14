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

describe('LIMIT AT INFINITY: THE GROWTH OF AN EXPONENTIAL', () => {
  // The growth rank of `e^g` and `b^g` (constant `b > 1`) depends on the
  // sign of `g` as `t → +∞`. That sign is read from numeric probes. A probe
  // with no value (a symbolic parameter) was read as `+`, and a `g` whose
  // growth was not classified (`√t`) was read as bounded.
  const pos = new ComputeEngine();
  pos.declare('p', 'real');
  pos.assume(pos.parse('p > 0'));
  pos.declare('q', 'real');
  pos.assume(pos.parse('q < 0'));
  const limIn = (engine: ComputeEngine, body: unknown) =>
    engine.box(['Limit', ['Function', body, 't'], 'PositiveInfinity'] as any);

  test('a constant exponent sign still answers', () => {
    expect(lim(['Exp', 't']).evaluate().json).toBe('PositiveInfinity');
    expect(lim(['Power', 2, 't']).evaluate().json).toBe('PositiveInfinity');
    expect(lim(['Negate', ['Exp', 't']]).evaluate().json).toBe(
      'NegativeInfinity'
    );
    expect(lim(['Power', ['Rational', 1, 2], 't']).evaluate().json).toBe(0);
    expect(lim(['Exp', ['Negate', 't']]).evaluate().json).toBe(0);
    expect(lim(['Divide', 't', ['Exp', 't']]).evaluate().json).toBe(0);
    expect(lim(['Divide', ['Power', 2, 't'], 't']).evaluate().json).toBe(
      'PositiveInfinity'
    );
  });

  test('an unknown coefficient gives no answer', () => {
    for (const body of [
      ['Multiply', 'a', ['Exp', 't']],
      ['Multiply', 'a', ['Power', 2, 't']],
      ['Exp', ['Multiply', 'a', 't']],
      ['Power', 'a', 't'],
    ])
      expect(isUnevaluated(lim(body).evaluate())).toBe(true);
  });

  test('an exponent with an unknown sign gives no answer', () => {
    // `t/e^{a·t}` is `0` for `a > 0` and `+∞` for `a ≤ 0`. It was `0`.
    for (const body of [
      ['Divide', 't', ['Exp', ['Multiply', 'a', 't']]],
      ['Divide', ['Power', 't', 2], ['Exp', ['Multiply', 'a', 't']]],
      ['Divide', 't', ['Power', 2, ['Multiply', 'a', 't']]],
      ['Divide', ['Exp', ['Exp', ['Multiply', 'a', 't']]], 't'],
    ])
      expect(isUnevaluated(lim(body).evaluate())).toBe(true);
  });

  test('an exponent with an assumed sign answers', () => {
    // `p > 0`: `t/e^{p·t}` → 0. `q < 0`: `e^{q·t}/t` → 0.
    expect(
      limIn(pos, ['Divide', 't', ['Exp', ['Multiply', 'p', 't']]]).evaluate()
        .json
    ).toBe(0);
    expect(
      limIn(pos, [
        'Divide',
        't',
        ['Power', 2, ['Multiply', 'p', 't']],
      ]).evaluate().json
    ).toBe(0);
    expect(
      limIn(pos, ['Divide', ['Exp', ['Multiply', 'q', 't']], 't']).evaluate()
        .json
    ).toBe(0);
    // `t/e^{q·t} = t·e^{|q|·t}` → `+∞`. It was `0`. The probes cannot read
    // the sign of `e^{q·t}`, so the quotient rule uses the proved sign.
    const eq = ['Exp', ['Multiply', 'q', 't']];
    expect(limIn(pos, ['Divide', 't', eq]).evaluate().json).toBe(
      'PositiveInfinity'
    );
    expect(limIn(pos, ['Divide', ['Negate', 't'], eq]).evaluate().json).toBe(
      'NegativeInfinity'
    );
    // The sign of the numerator must still be known.
    expect(
      isUnevaluated(
        limIn(pos, ['Divide', ['Multiply', 'a', 't'], eq]).evaluate()
      )
    ).toBe(true);
  });

  test('an exponent that goes to −∞ makes the exponential decay', () => {
    // `t/e^{t − t²} = t·e^{t² − t}` → `+∞`. It was `0`. The probes of
    // `e^{t − t²}` underflow to 0, so the quotient rule uses the proved sign.
    const d = ['Exp', ['Subtract', 't', ['Power', 't', 2]]];
    expect(lim(['Divide', 't', d]).evaluate().json).toBe('PositiveInfinity');
    expect(lim(['Divide', ['Negate', 't'], d]).evaluate().json).toBe(
      'NegativeInfinity'
    );
    expect(
      lim([
        'Multiply',
        ['Power', 't', 5],
        ['Exp', ['Subtract', 't', ['Power', 't', 2]]],
      ]).evaluate().json
    ).toBe(0);
  });

  test('an exponent that is not a polynomial', () => {
    // `e^{√t}` grows faster than any power of `t`. It was ranked as bounded:
    // `t/e^{√t}` gave `+∞` and `e^{√t}/t` gave `0`.
    expect(lim(['Divide', 't', ['Exp', ['Sqrt', 't']]]).evaluate().json).toBe(
      0
    );
    expect(lim(['Divide', ['Exp', ['Sqrt', 't']], 't']).evaluate().json).toBe(
      'PositiveInfinity'
    );
    // `√t − 50` is negative at small `t` and goes to `+∞`.
    const g = ['Add', ['Sqrt', 't'], -50];
    expect(lim(['Divide', ['Exp', g], 't']).evaluate().json).toBe(
      'PositiveInfinity'
    );
    expect(lim(['Divide', 't', ['Exp', g]]).evaluate().json).toBe(0);
  });

  test('a root has the growth class of its radicand', () => {
    // `(√t − 50)/ln t` → `+∞`. It was `0`: the probes at small `t`, where
    // `−50` dominates, ranked `√t − 50` below `ln t`.
    const r = lim([
      'Divide',
      ['Add', ['Sqrt', 't'], -50],
      ['Ln', 't'],
    ]).evaluate();
    expect(r.json === 'PositiveInfinity' || isUnevaluated(r)).toBe(true);
    expect(lim(['Divide', ['Root', 't', 3], ['Ln', 't']]).evaluate().json).toBe(
      'PositiveInfinity'
    );
    expect(lim(['Divide', 't', ['Sqrt', ['Exp', 't']]]).evaluate().json).toBe(
      0
    );
  });

  test('a root with a degree that is not a positive constant', () => {
    // `Root(t, t) = t^{1/t}` → 1. It was ranked polynomial, and
    // `Root(t, t)/ln t` gave `+∞`. `Root(t, t)` alone also gave `+∞`: the
    // rule for a root used the limit of the radicand and ignored the degree.
    expect(lim(['Root', 't', 't']).evaluate().json).toBe(1);
    expect(
      lim(['Divide', ['Root', 't', 't'], ['Ln', 't']]).evaluate().json
    ).toBe(0);
    // `Root(t, a)` tends to `+∞` for `a > 0` and to 0 for `a < 0`.
    expect(isUnevaluated(lim(['Root', 't', 'a']).evaluate())).toBe(true);
  });

  test('an exponent that is real at the first probe only', () => {
    // `√(200 − t)` is real at `t = 120` and imaginary for `t > 200`, so
    // `e^{√(200−t)}` is not positive for large `t`: `t/e^{√(200−t)}` has
    // modulus `t` and a phase that does not settle, so it has no limit. It
    // was `+∞`.
    const d = ['Exp', ['Sqrt', ['Subtract', 200, 't']]];
    expect(isUnevaluated(lim(['Divide', 't', d]).evaluate())).toBe(true);
  });
});
