import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { isNumber } from '../../src/compute-engine/boxed-expression/type-guards';

// `EulerE(n)` is the Euler number Eₙ (OEIS A122045), `EulerE(n, x)` the
// Euler polynomial Eₙ(x) (DLMF 24.2.6, 24.2.8). Mathematica's `EulerE`.

const ce = new ComputeEngine();

const ev = (json: unknown) =>
  ce
    .box(json as any)
    .evaluate()
    .toString();
const num = (json: unknown) =>
  ce
    .box(json as any)
    .N()
    .toString();

// A122045: E_0 … E_20.
const E = [
  1, 0, -1, 0, 5, 0, -61, 0, 1385, 0, -50521, 0, 2702765, 0, -199360981, 0,
  19391512145, 0, -2404879675441, 0, 370371188237525,
];

describe('EulerE(n)', () => {
  test.each(E.map((v, n) => [n, v]))('E_%i', (n, v) => {
    expect(ev(['EulerE', n])).toBe(String(v));
  });

  test('odd n is 0', () => {
    for (const n of [1, 3, 99, 201]) expect(ev(['EulerE', n])).toBe('0');
  });

  test('E_200 is exact', () => {
    // From the secant recurrence Σ_k C(n,2k)·E_2k = 0, in Python integers.
    expect(ev(['EulerE', 200])).toBe(
      '599547163501087372474968414188065044926728618369425054868091366455415875680150799832459576446626662489154039676247901501453585520247873369633664981039166488273449468831053594931966683906734130221865944184112020908528590877181590543768716367090579274260976307066311777407073312889369750169548196419149504941815733845016897635621925859625'
    );
  });

  test('threads over a list', () => {
    expect(ev(['EulerE', ['List', 0, 1, 2, 3, 4]])).toBe('[1,0,-1,0,5]');
    expect(ev(['EulerE', ['List', 2, 4, 6]])).toBe('[-1,5,-61]');
  });

  test('.N()', () => {
    expect(num(['EulerE', 10])).toBe('-50521');
    const prev = ce.precision;
    ce.precision = 50;
    try {
      expect(ce.box(['EulerE', 30]).N().toString()).toBe(
        '-441543893249023104553682821'
      );
    } finally {
      ce.precision = prev;
    }
  });

  test('a float operand gives a float', () => {
    const r = ce.box(['EulerE', 4.0]).evaluate();
    expect(r.isNumberLiteral && r.numericValue !== undefined).toBe(true);
    expect(r.re).toBe(5);
    expect(r.toString()).not.toBe('EulerE(4)');
  });

  test('a negative n stays unevaluated', () => {
    expect(ev(['EulerE', -2])).toBe('EulerE(-2)');
    expect(num(['EulerE', -2])).toBe('EulerE(-2)');
  });

  test('a non-integer n is not evaluated', () => {
    expect(ev(['EulerE', 2.5])).not.toMatch(/^-?[\d.]+$/);
    expect(ev(['EulerE', ['Rational', 5, 2]])).not.toMatch(/^-?[\d./]+$/);
  });

  test('a symbolic n stays unevaluated', () => {
    expect(ev(['EulerE', 'n'])).toBe('EulerE(n)');
  });

  test('past the work cap it stays unevaluated', () => {
    expect(ce.box(['EulerE', 100000]).evaluate().operator).toBe('EulerE');
    expect(ce.box(['EulerE', 100000, 'x']).evaluate().operator).toBe('EulerE');
    // just under the cap is computed
    expect(ce.box(['EulerE', 400]).evaluate().operator).toBe('Integer');
  });
});

describe('EulerE(n, x)', () => {
  test('integer and rational x', () => {
    expect(ev(['EulerE', 1, 0])).toBe('-1/2');
    expect(ev(['EulerE', 2, 0])).toBe('0');
    expect(ev(['EulerE', 1, 1])).toBe('1/2');
    expect(ev(['EulerE', 2, 1])).toBe('0');
    expect(ev(['EulerE', 0, 1])).toBe('1');
    expect(ev(['EulerE', 3, ['Rational', 1, 2]])).toBe('0');
    expect(ev(['EulerE', 4, ['Rational', -2, 3]])).toBe('10/81');
    expect(
      ev([
        'Add',
        ['EulerE', 2, ['Rational', 1, 2]],
        ['EulerE', 2, ['Rational', 3, 2]],
      ])
    ).toBe('1/2');
    expect(ev(['Add', ['EulerE', 2, 2], ['EulerE', 2, 3]])).toBe('8');
  });

  test('Eₙ = 2ⁿ·Eₙ(1/2)', () => {
    for (let n = 0; n <= 24; n++)
      expect(
        ev(['Multiply', ['Power', 2, n], ['EulerE', n, ['Rational', 1, 2]]])
      ).toBe(String(ev(['EulerE', n])));
  });

  test('Eₙ(x+1) + Eₙ(x) = 2xⁿ at rational x', () => {
    for (const n of [0, 1, 5, 12])
      expect(
        ev([
          'Add',
          ['EulerE', n, ['Rational', 7, 3]],
          ['EulerE', n, ['Rational', 4, 3]],
        ])
      ).toBe(ev(['Multiply', 2, ['Power', ['Rational', 4, 3], n]]));
  });

  test('a symbolic x gives the expanded polynomial', () => {
    expect(ev(['EulerE', 0, 'x'])).toBe('1');
    expect(ev(['EulerE', 1, 'x'])).toBe('x - 1/2');
    expect(ev(['EulerE', 2, 'x'])).toBe('x^2 - x');
    expect(ev(['EulerE', 4, 'x'])).toBe('x^4 - 2x^3 + x');
    // the polynomial agrees with the value at a rational point
    const n = 9;
    const poly = ce.box(['EulerE', n, 'x']).evaluate();
    const at = poly.subs({ x: ce.number([5, 7]) }).evaluate();
    expect(at.toString()).toBe(ev(['EulerE', n, ['Rational', 5, 7]]));
  });

  test('a float x gives a float', () => {
    expect(ce.box(['EulerE', 4, 0.5]).evaluate().re).toBeCloseTo(0.3125, 14);
    expect(num(['EulerE', 3, 0.5])).toBe('0');
    expect(num(['EulerE', 1, 0])).toBe('-0.5');
  });

  test('a bignum x at precision', () => {
    const prev = ce.precision;
    ce.precision = 40;
    try {
      const r = ce
        .box(['EulerE', 2, ce.parse('0.1234567890123456789012345')])
        .N();
      // x² - x
      expect(r.toString()).toMatch(/^-0\.1082152102591068/);
    } finally {
      ce.precision = prev;
    }
  });

  test('an exact irrational x stays exact', () => {
    // E₂(x) = x² − x, so E₂(√2) = 2 − √2: the radical is not replaced by a
    // rational approximation.
    expect(ev(['EulerE', 2, ['Sqrt', 2]])).toBe('2 - sqrt(2)');
    expect(Number(num(['EulerE', 2, ['Sqrt', 2]]))).toBeCloseTo(
      2 - Math.SQRT2,
      14
    );
  });

  test('the type is integer without x', () => {
    expect(ce.box(['EulerE', 4]).type.toString()).toBe('integer');
    expect(ce.box(['EulerE', 'n']).type.toString()).toBe('integer');
    expect(ce.box(['EulerE', 4, 'x']).type.toString()).toBe('number');
  });

  test('an exact complex x gives an exact value', () => {
    // E₃(x) = x³ − (3/2)x² + 1/4
    expect(ev(['EulerE', 3, ['Complex', 1, 2]])).toBe('(-25/4 - 8i)');
    expect(num(['EulerE', 3, ['Complex', 1, 2]])).toBe('(-6.25 - 8i)');
    expect(
      ev(['EulerE', 4, ['Complex', ['Rational', 1, 3], ['Rational', -2, 5]]])
    ).toBe('(25846/50625 - 794/3375i)');
    expect(ev(['EulerE', 0, ['Complex', 1, 2]])).toBe('1');
  });

  test('Eₙ(z+1) + Eₙ(z) = 2zⁿ at a Gaussian rational z', () => {
    const z = ['Complex', ['Rational', 1, 3], ['Rational', 2, 7]];
    const z1 = ['Complex', ['Rational', 4, 3], ['Rational', 2, 7]];
    for (const n of [1, 5, 12])
      expect(ev(['Add', ['EulerE', n, z1], ['EulerE', n, z]])).toBe(
        ev(['Multiply', 2, ['Power', z, n]])
      );
  });

  test('a float complex x gives a float', () => {
    const r = ce.box(['EulerE', 3, ['Complex', 0.1, 0.3]]).evaluate();
    expect(r.isExact).toBe(false);
    expect(r.re).toBeCloseTo(0.344, 14);
    expect(r.im).toBeCloseTo(-0.108, 14);
    // the value agrees with the expanded polynomial at the same point
    const z = ce.box(['Complex', 0.25, 1.75]);
    const at = ce.box(['EulerE', 30, 'x']).evaluate().subs({ x: z }).N();
    const v = ce.box(['EulerE', 30, z]).N();
    expect(v.re / at.re).toBeCloseTo(1, 12);
    expect(v.im / at.im).toBeCloseTo(1, 12);
  });

  test('a bignum imaginary part keeps its digits at precision', () => {
    const prev = ce.precision;
    ce.precision = 50;
    try {
      // E₁(z) = z − 1/2
      const z = ce.parse('0.75+1.2345678901234567890123456789\\cdot i');
      const r = ce.box(['EulerE', 1, z]).N();
      expect(r.re).toBe(0.25);
      expect(isNumber(r) && r.bignumIm?.toString()).toBe(
        '1.2345678901234567890123456789'
      );
    } finally {
      ce.precision = prev;
    }
  });

  test('an exact complex x with a radical gives the polynomial at x', () => {
    // E₂(x) = x² − x
    expect(
      ev(['EulerE', 2, ['Multiply', ['Sqrt', 2], 'ImaginaryUnit']])
    ).toBe('-2 - sqrt(2)i');
  });

  test('an infinite or NaN x stays unevaluated', () => {
    expect(ev(['EulerE', 3, 'PositiveInfinity'])).toMatch(/^EulerE\(3/);
    expect(ev(['EulerE', 3, 'ComplexInfinity'])).toMatch(/^EulerE\(3/);
    expect(ev(['EulerE', 3, 'NaN'])).toMatch(/^EulerE\(3/);
  });

  test('threads over lists', () => {
    expect(ev(['EulerE', ['List', 1, 2], 1])).toBe('[1/2,0]');
  });
});

describe('EulerE compilation and LaTeX', () => {
  test('JavaScript: no lowering (as BernoulliB); the fallback agrees with .N()', () => {
    expect(() =>
      compile(ce.box(['EulerE', 6]), { fallback: false, constantFold: false })
    ).toThrow(/Could not compile/);
    const c = compile(ce.box(['EulerE', 6]), { constantFold: false }) as any;
    expect(c.run()).toBe(ce.box(['EulerE', 6]).N().re);
  });

  test('GLSL declines', () => {
    expect(() =>
      compile(ce.box(['EulerE', 4]), {
        to: 'glsl',
        fallback: false,
        constantFold: false,
      } as any)
    ).toThrow(/outside the GLSL fragment/);
  });

  test('LaTeX round trip', () => {
    for (const json of [
      ['EulerE', 4],
      ['EulerE', 4, 'x'],
      ['EulerE', 'n', ['Add', 'x', 1]],
    ]) {
      const latex = ce.box(json as any, { canonical: false }).latex;
      expect(latex).toMatch(/EulerE/);
      expect(ce.parse(latex).json).toEqual(json);
    }
  });
});
