/**
 * DirichletEta(n) and DirichletBeta(n) at an integer n, under `.N()`: the
 * kernel's guard digits give every digit asked for. The closed forms
 * ((1 − 2^{1−n}) ζ(n), a rational times π^n) were rounded twice, so the last
 * one to three digits were wrong at 30 to 100 digits.
 *
 * Reference values are mpmath's: `mp.dps = d + 40; altzeta(n)` and
 * `dirichlet(n, [0, 1, 0, -1])`, rounded to d digits.
 */

import { ComputeEngine } from '../../src/compute-engine';

const ce = new ComputeEngine();

const cases: [string, number, number, string][] = [
  ['DirichletEta', 3, 30, '0.901542677369695714049803621134'],
  ['DirichletEta', 5, 30, '0.972119770446909305935655143553'],
  ['DirichletEta', 11, 30, '0.999517143498060754144094174829'],
  ['DirichletEta', 13, 30, '0.999878542763265115492174992816'],
  ['DirichletEta', 17, 30, '0.999992378292041011976937872242'],
  ['DirichletEta', 31, 30, '0.999999999534340331454217514686'],
  [
    'DirichletEta',
    5,
    50,
    '0.97211977044690930593565514355346953255351336203304',
  ],
  [
    'DirichletEta',
    7,
    50,
    '0.99259381992283028267042571313339368523111569243141',
  ],
  [
    'DirichletEta',
    15,
    50,
    '0.99996955121309923808263293262877795778644462180569',
  ],
  ['DirichletBeta', 5, 30, '0.996157828077088064006319368631'],
  ['DirichletBeta', 15, 30, '0.999999930340842624387160697581'],
  [
    'DirichletBeta',
    5,
    50,
    '0.99615782807708806400631936863097528151139552938826',
  ],
  [
    'DirichletBeta',
    9,
    50,
    '0.99994968418722008982135887329384752737274799691796',
  ],
  [
    'DirichletBeta',
    31,
    50,
    '0.99999999999999838102163153574224553314712519014426',
  ],
];

describe('DirichletEta and DirichletBeta at an integer, under .N()', () => {
  afterEach(() => {
    ce.precision = 'machine';
  });

  test.each(cases)('%s(%i) at %i digits', (head, n, digits, expected) => {
    ce.precision = digits;
    const value = ce.box([head, n]).N();
    expect(String(value.bignumRe)).toEqual(expected);
  });

  test('an integer-valued rational is the integer', () => {
    ce.precision = 30;
    expect(
      String(ce.box(['DirichletEta', ['Rational', 44, 4]]).N().bignumRe)
    ).toEqual('0.999517143498060754144094174829');
  });

  test('a float operand gives a float', () => {
    ce.precision = 30;
    expect(ce.box(['DirichletEta', { num: '3.0' }]).evaluate().isInteger).toBe(
      false
    );
  });

  test('the exact forms stay exact under evaluate()', () => {
    ce.precision = 30;
    expect(ce.box(['DirichletEta', 3]).evaluate().json).toEqual([
      'Multiply',
      ['Rational', 3, 4],
      ['Zeta', 3],
    ]);
    expect(ce.box(['DirichletBeta', 5]).evaluate().json).toEqual([
      'Multiply',
      ['Rational', 5, 1536],
      ['Power', 'Pi', 5],
    ]);
  });

  test('machine precision is unchanged', () => {
    ce.precision = 'machine';
    expect(ce.box(['DirichletEta', 3]).N().re).toBeCloseTo(
      0.9015426773696957,
      14
    );
  });
});
