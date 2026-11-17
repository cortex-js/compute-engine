import { ComputeEngine } from '../../src/compute-engine';

// A finite value whose decimal exponent is past BigDecimal's range (a JS
// number, saturating at 2^53 - 1) stays unevaluated: never ±Infinity, ~oo or
// NaN. Reference values from mpmath at 80 digits.
const ce = new ComputeEngine();
const big = (n: string, d: number) => ['Divide', { num: n }, d];

const run = (json: any, precision: number, N: boolean) => {
  ce.precision = precision;
  const x = ce.box(json);
  return N ? x.N() : x.evaluate({ numericApproximation: true });
};

describe.each([30, 50])('precision %i', (p) => {
  describe.each([true, false])('N %s', (N) => {
    test.each([
      ['Gamma', ['Gamma', big('3000000000000001', 3)]],
      ['Factorial', ['Factorial', big('3000000000000001', 3)]],
      ['Zeta', ['Zeta', ['Negate', big('3000000000000001', 3)]]],
      [
        'DirichletEta',
        ['DirichletEta', ['Negate', big('3000000000000001', 3)]],
      ],
      [
        'Beta',
        ['Beta', big('1000000000000000001', 3), big('1000000000000000002', 3)],
      ],
    ])('%s past the exponent range is unevaluated', (head, json) => {
      const r = run(json, p, N);
      expect(r.operator).toBe(head);
    });
  });

  test('Gamma just inside the range is still a value', () => {
    const r = run(['Gamma', big('6000000000000001', 10)], p, true);
    expect(r.toString().slice(0, 15)).toBe('3.7217227461564');
    expect(r.toString()).toMatch(/e\+8606314061088229$/);
  });

  test('Zeta and DirichletEta just inside the range are values', () => {
    expect(
      run(['Zeta', big('-6000000000000001', 10)], p, true).toString()
    ).toMatch(/^-8\.64014129420588.*e\+8127406140073373$/);
    expect(
      run(['DirichletEta', big('-300000000000001', 3)], p, true).toString()
    ).toMatch(/^6\.834234306926.*e\+13068\d+$/);
  });
});

describe('Beta with a Gamma past the range, by the log-gamma ratio', () => {
  // mpmath beta(a, b), 80 digits
  test('one large operand', () => {
    ce.precision = 30;
    const a = ce
      .box(['Beta', big('3000000000000001', 3), ['Divide', 2, 7]])
      .N();
    expect(a.toString()).toBe('0.000163107620144218053643847989698');
  });

  test('a large and a negative operand', () => {
    ce.precision = 30;
    const r = ce
      .box(['Beta', big('3000000000000001', 3), ['Divide', -1, 3]])
      .N();
    expect(r.toString()).toBe('-406235.3818279200799463217609');
  });

  test('both operands large', () => {
    ce.precision = 30;
    const r = ce
      .box(['Beta', big('3000000000000001', 3), big('3000000000000002', 3)])
      .N();
    expect(r.toString()).toBe(
      '2.28111646140384773033333879142e-602059991327970'
    );
  });

  test('a = 10^100 + 1/3, b = 2/7', () => {
    ce.precision = 30;
    const r = ce
      .box(['Beta', big('3' + '0'.repeat(99) + '1', 3), ['Divide', 2, 7]])
      .N();
    expect(r.toString()).toBe('8.44811788526640029296716021439e-29');
  });
});

describe('machine precision keeps the double convention', () => {
  test('Gamma(200) overflows a double', () => {
    ce.precision = 'machine';
    expect(ce.box(['Gamma', 200]).N().toString()).toBe('+oo');
    ce.precision = 30;
  });
});

describe('Binomial past the range', () => {
  test('a coefficient with an exponent beyond 2^53 is unevaluated', () => {
    ce.precision = 30;
    const r = ce
      .box([
        'Binomial',
        big('600000000000000001', 3),
        big('200000000000000000', 3),
      ])
      .N();
    expect(r.operator).toBe('Binomial');
  });

  // k = -200000000000000001/3 is the integer -66666666666666667, so Γ(k+1) is
  // a pole in the denominator: the coefficient is exactly 0 (mpmath agrees).
  test('a negative integer k written as a rational is an exact 0', () => {
    ce.precision = 30;
    const r = ce
      .box([
        'Binomial',
        ['Negate', big('600000000000000001', 3)],
        ['Negate', big('200000000000000001', 3)],
      ])
      .N();
    expect(r.isSame(0)).toBe(true);
  });
});
