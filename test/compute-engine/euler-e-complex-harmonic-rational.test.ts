import { ComputeEngine } from '../../src/compute-engine';

//
// `EulerE(n, z)` at a complex `z`, and `HarmonicNumber(r)` at a rational `r`
// whose ψ(r + 1) has an exact value. Reference values are mpmath's:
// `eulerpoly(n, z)` and `harmonic(r)`.
//

const ce = new ComputeEngine();
const evaluate = (json: unknown) => ce.expr(json as never).evaluate();
const N = (json: unknown) => ce.expr(json as never).N();

describe('EulerE AT A COMPLEX z', () => {
  test('an exact Gaussian integer gives an exact value', () => {
    // E₃(x) = x³ − 3x²/2 + 1/4
    const v = evaluate(['EulerE', 3, ['Complex', 1, 2]]);
    expect(v.re).toBe(-6.25);
    expect(v.im).toBe(-8);
    expect(v.isExact).toBe(true);
    expect(evaluate(['EulerE', 3, 'ImaginaryUnit']).json).toEqual([
      'Complex',
      ['Rational', 7, 4],
      -1,
    ]);
  });

  test('a float gives a float, from the exact value of the decimal', () => {
    // mpmath: eulerpoly(3, 1.5 + 2j) = −11.75 − 3.5j
    const v = evaluate(['EulerE', 3, ['Complex', 1.5, 2]]);
    expect(v.isExact).toBe(false);
    expect(v.re).toBe(-11.75);
    expect(v.im).toBe(-3.5);
    // eulerpoly(10, 0.1 + 0.2j) = −18.3565669813 − 31.4612827216j
    const w = evaluate(['EulerE', 10, ['Complex', 0.1, 0.2]]);
    expect(w.re).toBeCloseTo(-18.3565669813, 10);
    expect(w.im).toBeCloseTo(-31.4612827216, 10);
  });

  test('evaluate() and N() agree', () => {
    for (const z of [
      ['Complex', 1, 2],
      ['Complex', 0, 0.5],
      ['Complex', -3, 4],
    ]) {
      const e = evaluate(['EulerE', 6, z]);
      const n = N(['EulerE', 6, z]);
      expect(n.re).toBeCloseTo(e.re, 9);
      expect(n.im).toBeCloseTo(e.im, 9);
    }
  });

  test('the Euler numbers are E_n = 2ⁿ E_n(1/2); a pure imaginary z', () => {
    // mpmath: eulerpoly(4, 0.5j) = 0.0625 + 0.75j
    const v = evaluate(['EulerE', 4, ['Complex', 0, 0.5]]);
    expect(v.re).toBeCloseTo(0.0625, 14);
    expect(v.im).toBeCloseTo(0.75, 14);
  });

  test('n = 0 and n = 1', () => {
    expect(evaluate(['EulerE', 0, ['Complex', 3, 1]]).json).toBe(1);
    const v = evaluate(['EulerE', 1, ['Complex', 3, 1]]);
    expect([v.re, v.im]).toEqual([2.5, 1]);
  });

  test('an exact irrational stays exact (not a rational approximation)', () => {
    expect(evaluate(['EulerE', 2, ['Sqrt', 2]]).toString()).toBe('2 - sqrt(2)');
  });

  test('a non-finite z stays unevaluated', () => {
    for (const z of ['PositiveInfinity', 'ComplexInfinity'])
      expect(evaluate(['EulerE', 3, z]).operator).toBe('EulerE');
  });
});

describe('HarmonicNumber AT A RATIONAL', () => {
  test('H(1/2) = 2 − 2 ln 2', () => {
    expect(evaluate(['HarmonicNumber', ['Rational', 1, 2]]).json).toEqual([
      'Add',
      2,
      ['Multiply', -2, ['Ln', 2]],
    ]);
    expect(N(['HarmonicNumber', ['Rational', 1, 2]]).re).toBeCloseTo(
      0.6137056388801094,
      14
    );
  });

  test.each([
    // [r, mpmath harmonic(r)]
    [['Rational', 3, 2], 1.2803723055467760478],
    [['Rational', -1, 2], -1.3862943611198906188],
    [['Rational', -5, 2], 1.2803723055467760478],
    [['Rational', 1, 3], 0.44518188488072653761],
    [['Rational', 2, 3], 0.7589812491149443882],
    [['Rational', 1, 4], 0.34976213152526745252],
    [['Rational', 3, 4], 0.82468811844839402431],
  ])('H(%j) is closed form and agrees with the numeric value', (r, mp) => {
    const exact = evaluate(['HarmonicNumber', r]);
    expect(exact.operator).not.toBe('HarmonicNumber');
    expect(exact.has('EulerGamma')).toBe(false);
    expect(exact.N().re).toBeCloseTo(mp, 12);
    expect(N(['HarmonicNumber', r]).re).toBeCloseTo(mp, 12);
  });

  test('H(1/3) in closed form', () => {
    expect(
      evaluate(['HarmonicNumber', ['Rational', 1, 3]]).isSame(
        ce
          .expr([
            'Subtract',
            3,
            [
              'Add',
              ['Multiply', ['Rational', 3, 2], ['Ln', 3]],
              ['Divide', ['Multiply', 'Pi', ['Sqrt', 3]], 6],
            ],
          ] as never)
          .evaluate()
      )
    ).toBe(true);
  });

  test('a rational with no exact ψ stays unevaluated', () => {
    expect(evaluate(['HarmonicNumber', ['Rational', 1, 5]]).operator).toBe(
      'HarmonicNumber'
    );
    expect(N(['HarmonicNumber', ['Rational', 1, 5]]).re).toBeCloseTo(
      0.2881757683093446,
      13
    );
  });

  test('the second operand: only r = 1 is the digamma form', () => {
    expect(
      evaluate(['HarmonicNumber', ['Rational', 1, 2], 1]).operator
    ).not.toBe('HarmonicNumber');
    expect(evaluate(['HarmonicNumber', ['Rational', 1, 2], 2]).operator).toBe(
      'HarmonicNumber'
    );
  });

  test('a float or irrational operand is not turned into a closed form', () => {
    expect(evaluate(['HarmonicNumber', 0.5]).isExact).toBe(false);
    expect(evaluate(['HarmonicNumber', ['Sqrt', 2]]).operator).toBe(
      'HarmonicNumber'
    );
  });
});
