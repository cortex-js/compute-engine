/**
 * `LogGamma` at a negative real and `HurwitzZeta(s, a)` at a negative `a`
 * with a non-integer `s` have complex values, computed in big decimals at
 * the engine precision. Reference values: mpmath 1.3, 30 digits.
 */

import { ComputeEngine } from '../../src/compute-engine';

const ce = new ComputeEngine();

/** [re, im] strings of a complex result, or undefined. */
function parts(s: string): [string, string] | undefined {
  const m = /^\((\S+) ([+-]) (\S+)i\)$/.exec(s);
  return m ? [m[1], (m[2] === '-' ? '-' : '') + m[3]] : undefined;
}

/** The first `n` characters agree (a digit prefix, sign included). */
function expectDigits(actual: string, expected: string, n = 26) {
  expect(actual.slice(0, n)).toEqual(expected.slice(0, n));
}

describe('LogGamma at a negative real', () => {
  const cases: [any, string, string][] = [
    [
      -0.1,
      '2.36896133272878865520670819455',
      '-3.14159265358979323846264338328',
    ],
    [
      ['Rational', -7, 3],
      '0.26678263097664871892178154178',
      '-9.42477796076937971538793014984',
    ],
    [
      -3.5,
      '-1.30900668499304204636071515208',
      '-12.5663706143591729538505735331',
    ],
    [
      -5.2,
      '-3.45617528700667198813181836392',
      '-18.8495559215387594307758602997',
    ],
    [
      -20.7,
      '-43.1051331895362244991125294461',
      '-65.9734457253856580077155110489',
    ],
  ];
  test.each(cases)('LogGamma(%j) at 30 digits', (x, re, im) => {
    ce.precision = 30;
    const v = parts(ce.expr(['LogGamma', x]).N().toString());
    expect(v).toBeDefined();
    expectDigits(v![0], re);
    expectDigits(v![1], im);
  });

  test('every route agrees', () => {
    ce.precision = 30;
    const n = ce.expr(['LogGamma', -0.1]).N().toString();
    expect(ce.expr(['LogGamma', -0.1]).evaluate().toString()).toEqual(n);
    expect(ce.parse('\\operatorname{LogGamma}(-0.1)').N().toString()).toEqual(
      n
    );
  });

  test('digits beyond a double at a higher precision', () => {
    ce.precision = 50;
    const v = parts(ce.expr(['LogGamma', -0.1]).N().toString())!;
    expectDigits(v[0], '2.368961332728788655206708194551472791843', 40);
    expectDigits(v[1], '-3.141592653589793238462643383279502884197', 40);
  });

  test('the machine precision stays in doubles', () => {
    ce.precision = 'machine';
    expect(ce.expr(['LogGamma', -3.5]).N().im).toBeCloseTo(
      -12.566370614359172,
      12
    );
  });
});

describe('HurwitzZeta at a negative a, non-integer s', () => {
  const cases: [any, any, string, string][] = [
    [
      ['Rational', 17, 2],
      ['Rational', -94, 9],
      '147.872040443593197639131958697',
      '-985.305694059840643360265157955',
    ],
    [
      -3.5,
      -2.5,
      '-0.00404847768164895297173744011175',
      '-28.9271965086603950124993782372',
    ],
    [
      0.3,
      -0.1,
      '0.389164735477451096018799164931',
      '-1.61420112104572264404004204666',
    ],
  ];
  test.each(cases)('HurwitzZeta(%j, %j) at 30 digits', (s, a, re, im) => {
    ce.precision = 30;
    const v = parts(ce.expr(['HurwitzZeta', s, a]).N().toString());
    expect(v).toBeDefined();
    expectDigits(v![0], re, 24);
    expectDigits(v![1], im, 24);
  });

  test('every route agrees', () => {
    ce.precision = 30;
    const n = ce.expr(['HurwitzZeta', 0.3, -0.1]).N().toString();
    expect(ce.expr(['HurwitzZeta', 0.3, -0.1]).evaluate().toString()).toEqual(
      n
    );
    expect(
      ce.parse('\\operatorname{HurwitzZeta}(0.3, -0.1)').N().toString()
    ).toEqual(n);
  });
});

describe('GammaUpper at a negative z', () => {
  test('is computed in big decimals above machine precision', () => {
    ce.precision = 30;
    const e = ce.expr(['Gamma', 2.5, -1.5]);
    // mpmath 1.3
    expect(e.N().toString()).toEqual(
      '(1.32934038817913702047362561251 - 3.37301032391024194767565314917i)'
    );
  });
});

describe('LogGamma near a zero of ln|Γ| on the negative axis', () => {
  // ln|Γ(x)| = 0 at x ≈ −2.45702473822080062303945414765…; the real part
  // must be relatively accurate there, not only in absolute terms.
  // mpmath at 150 digits, x a 45-digit decimal.
  test.each([
    [
      '-2.45702473822079962303945414765117954323659791',
      '1.51560344802166217995800963871e-15',
    ],
    [
      '-2.45702473822080062302945414765117954323659791',
      '1.51560344802165732168564106779e-20',
    ],
  ])('LogGamma(%s)', (x, re) => {
    ce.precision = 30;
    const v = parts(
      ce
        .expr(['LogGamma', ce.parse(x)])
        .N()
        .toString()
    )!;
    expect(v[0]).toEqual(re);
    expectDigits(v[1], '-9.42477796076937971538793014984');
  });

  test('the guard grows with the digits lost', () => {
    ce.precision = 30;
    // 1e-57 from the zero (mpmath, 150 digits: 1.2041397867334426774e-57)
    const x = '-2.457024738220800623039454147651179543236597909033784420964';
    const v = parts(
      ce
        .expr(['LogGamma', ce.parse(x)])
        .N()
        .toString()
    )!;
    expect(v[0].slice(0, 21)).toEqual('1.2041397867334426774');
  });
});
