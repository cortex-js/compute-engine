/**
 * Closed forms of PolyLog, HurwitzZeta, Zeta, LerchPhi, the incomplete gamma
 * and beta functions, the Airy functions at 0 and two hypergeometric
 * reductions: `evaluate()` gives the closed form at exact operands, and `.N()`
 * of it agrees with `.N()` of the call and with mpmath.
 */

import { ComputeEngine } from '../../src/compute-engine';

const ce = new ComputeEngine();

type Json = any;

/** `evaluate()` of `json` is not the call itself, and its `.N()` is `value`. */
function expectClosedForm(json: Json, value: number | [number, number]) {
  const call = ce.expr(json);
  const exact = call.evaluate();
  expect(exact.isSame(call)).toBe(false);
  const [re, im] = Array.isArray(value) ? value : [value, 0];
  for (const n of [exact.N(), call.N()]) {
    expect(n.re).toBeCloseTo(re, 11);
    expect(n.im).toBeCloseTo(im, 11);
  }
}

const q = (a: number, b: number) => ['Rational', a, b];

describe('PolyLog at 1/2 and 2', () => {
  const cases: [Json, number | [number, number]][] = [
    [['PolyLog', 2, q(1, 2)], 0.5822405264650125],
    [['PolyLog', 3, q(1, 2)], 0.5372131936080402],
    [
      ['PolyLog', 2, 2],
      [2.4674011002723397, -2.177586090303602],
    ],
  ];
  for (const [json, value] of cases)
    test(`${JSON.stringify(json)} (evaluate, N)`, () =>
      expectClosedForm(json, value));

  test('PolyLog(3, 1/2) = 7 Zeta(3)/8 - Pi^2 Ln(2)/12 + Ln(2)^3/6', () => {
    expect(
      ce
        .expr(['PolyLog', 3, q(1, 2)])
        .evaluate()
        .isSame(
          ce.expr([
            'Add',
            ['Multiply', q(7, 8), ['Zeta', 3]],
            [
              'Negate',
              ['Divide', ['Multiply', ['Square', 'Pi'], ['Ln', 2]], 12],
            ],
            ['Divide', ['Power', ['Ln', 2], 3], 6],
          ])
        )
    ).toBe(true);
  });

  test('another argument or order is left alone', () => {
    expect(ce.expr(['PolyLog', 2, q(1, 3)]).evaluate().operator).toBe(
      'PolyLog'
    );
    expect(ce.expr(['PolyLog', 4, q(1, 2)]).evaluate().operator).toBe(
      'PolyLog'
    );
  });
});

describe('HurwitzZeta and Zeta at a base point of 1/2, 1/4 and 3/4', () => {
  const cases: [Json, number][] = [
    [['HurwitzZeta', q(3, 2), q(1, 2)], 4.776537947554833],
    [['HurwitzZeta', q(7, 3), q(1, 2)], 5.716781755425225],
    [['HurwitzZeta', 2, q(1, 4)], 17.19732915450711],
    [['HurwitzZeta', 2, q(3, 4)], 2.5418796476716065],
    [['Zeta', q(3, 2), q(1, 2)], 4.776537947554833],
    [['Zeta', 2, q(1, 4)], 17.19732915450711],
  ];
  for (const [json, value] of cases)
    test(`${JSON.stringify(json)} (evaluate, N)`, () =>
      expectClosedForm(json, value));

  test('a symbolic order: HurwitzZeta(s, 1/2) = (2^s - 1) Zeta(s)', () => {
    expect(
      ce
        .expr(['HurwitzZeta', 's', q(1, 2)])
        .evaluate()
        .isSame(
          ce.expr([
            'Multiply',
            ['Subtract', ['Power', 2, 's'], 1],
            ['Zeta', 's'],
          ])
        )
    ).toBe(true);
  });

  test('the pole at s = 1 and a float base are unchanged', () => {
    expect(
      ce
        .expr(['HurwitzZeta', 1, q(1, 2)])
        .evaluate()
        .toString()
    ).toBe('~oo');
    expect(ce.expr(['HurwitzZeta', 2, 0.25]).evaluate().isExact).not.toBe(true);
  });
});

describe('LerchPhi', () => {
  test('LerchPhi(1/2, 1, 1) = 2 Ln(2)', () => {});
  test('LerchPhi(1/3, 3, 1), whose PolyLog has no closed form, is left', () => {
    expect(ce.expr(['LerchPhi', q(1, 3), 3, 1]).evaluate().operator).toBe(
      'LerchPhi'
    );
  });
  test('LerchPhi(-1, 3, 1/2) = Pi^3/4 and LerchPhi(-1, 2, 1/2) = 4 Catalan', () => {
    expectClosedForm(['LerchPhi', -1, 3, q(1, 2)], 7.751569170074955);
    expectClosedForm(['LerchPhi', -1, 2, q(1, 2)], 3.663862376708876);
  });
  test('LerchPhi(z, s, 1) at z = 0 is still 1', () => {
    expect(ce.expr(['LerchPhi', 0, 'x', 1]).evaluate().toString()).toBe('1');
  });
});

describe('Airy functions at 0', () => {
  const cases: [string, number][] = [
    ['AiryAi', 0.3550280538878172],
    ['AiryAiPrime', -0.2588194037928068],
    ['AiryBi', 0.6149266274460007],
    ['AiryBiPrime', 0.4482883573538264],
  ];
  for (const [head, value] of cases)
    test(`${head}(0) (evaluate, N)`, () => expectClosedForm([head, 0], value));

  test('AiryAi(0) = 1/(3^(2/3) Gamma(2/3))', () => {
    expect(
      ce
        .expr(['AiryAi', 0])
        .evaluate()
        .isSame(
          ce.expr([
            'Divide',
            1,
            ['Multiply', ['Power', 3, q(2, 3)], ['Gamma', q(2, 3)]],
          ])
        )
    ).toBe(true);
  });
  test('a float 0 stays a float', () => {
    expect(ce.expr(['AiryAi', 0.0]).evaluate().isExact).not.toBe(true);
  });
});

describe('Gamma(s, z) with s a positive integer or 1/2', () => {
  test('Gamma(3, 5) = 37/e^5, Gamma(4, 1/3)', () => {
    expectClosedForm(['Gamma', 3, 5], 0.24930403896616228);
    expectClosedForm(['Gamma', 4, q(1, 3)], 5.997632451469495);
    expect(ce.expr(['Gamma', 3, 5]).evaluate().toString()).toBe('37 / e^5');
  });
  test('a symbolic z: Gamma(2, x) = (x + 1) e^-x, Gamma(1, x) = e^-x', () => {
    const atTwo = (json: Json) =>
      ce.expr(json).evaluate().subs({ x: 2 }).N().re;
    expect(ce.expr(['Gamma', 2, 'x']).evaluate().operator).not.toBe('Gamma');
    expect(atTwo(['Gamma', 2, 'x'])).toBeCloseTo(3 * Math.exp(-2), 12);
    expect(atTwo(['Gamma', 1, 'x'])).toBeCloseTo(Math.exp(-2), 12);
    expect(atTwo(['Gamma', 4, 'x'])).toBeCloseTo(
      6 * Math.exp(-2) * (1 + 2 + 2 + 4 / 3),
      12
    );
  });
  test('Gamma(1/2, 2) = Sqrt(Pi) Erfc(Sqrt(2))', () => {
    expectClosedForm(['Gamma', q(1, 2), 2], 0.08064711796031769);
  });
  test('past the order cap, and for a float, the call is numeric or left', () => {
    expect(ce.expr(['Gamma', 40, 'x']).evaluate().operator).toBe('Gamma');
    expect(ce.expr(['Gamma', 3, 5.0]).evaluate().isExact).not.toBe(true);
  });
});

describe('BetaRegularized at positive integers a and b', () => {
  test('exact rational x', () => {
    expectClosedForm(['BetaRegularized', q(1, 2), 2, 3], 0.6875);
    expectClosedForm(['BetaRegularized', q(1, 3), 3, 2], 1 / 9);
    expect(
      ce
        .expr(['BetaRegularized', q(1, 2), 2, 3])
        .evaluate()
        .toString()
    ).toBe('11/16');
  });
  test('a symbolic x at a = 1 or b = 1', () => {
    expect(
      ce
        .expr(['BetaRegularized', 'x', 3, 1])
        .evaluate()
        .isSame(ce.expr(['Power', 'x', 3]))
    ).toBe(true);
    expect(
      ce
        .expr(['BetaRegularized', 'x', 1, 3])
        .evaluate()
        .isSame(ce.expr(['Subtract', 1, ['Power', ['Subtract', 1, 'x'], 3]]))
    ).toBe(true);
    expect(ce.expr(['BetaRegularized', 'x', 2, 3]).evaluate().operator).toBe(
      'BetaRegularized'
    );
  });
  test('the cap and non-integer parameters', () => {
    expect(
      ce.expr(['BetaRegularized', q(1, 2), 40, 40]).evaluate().operator
    ).toBe('BetaRegularized');
    expect(
      ce.expr(['BetaRegularized', q(1, 2), q(1, 2), 3]).evaluate().operator
    ).toBe('BetaRegularized');
  });
});

describe('Hypergeometric reductions', () => {
  test('1F1(a; a; z) = e^z', () => {
    expect(
      ce
        .expr(['Hypergeometric1F1', 'a', 'a', 'z'])
        .evaluate()
        .isSame(ce.expr(['Exp', 'z']))
    ).toBe(true);
    expectClosedForm(
      ['Hypergeometric1F1', q(3, 2), q(3, 2), 2],
      7.38905609893065
    );
  });
  test('2F1(a, b; b; z) = (1 - z)^-a and 2F1(a, b; a; z) = (1 - z)^-b', () => {
    expect(
      ce
        .expr(['Hypergeometric2F1', 'a', 'b', 'b', 'z'])
        .evaluate()
        .isSame(ce.expr(['Power', ['Subtract', 1, 'z'], ['Negate', 'a']]))
    ).toBe(true);
    expectClosedForm(
      ['Hypergeometric2F1', q(3, 2), 2, 2, q(1, 4)],
      1.539600717839002
    );
    expectClosedForm(
      ['Hypergeometric2F1', 2, q(3, 2), 2, q(3, 10)],
      1.7074694419062766
    );
  });
  test('a non-positive integer parameter and the cut z > 1 are left to the kernel', () => {
    expect(ce.expr(['Hypergeometric1F1', 0, 0, 'z']).evaluate().operator).toBe(
      'Hypergeometric1F1'
    );
    expect(
      ce.expr(['Hypergeometric2F1', 'a', -2, -2, 'z']).evaluate().operator
    ).toBe('Hypergeometric2F1');
    expect(
      ce.expr(['Hypergeometric2F1', q(3, 2), 2, 2, 2]).evaluate().operator
    ).toBe('Hypergeometric2F1');
  });
});
