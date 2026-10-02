/**
 * #395: the five analytic families together. Cross-wiring between them, and
 * one precision rule: a real result carries `ce.precision` digits or the head
 * stays unevaluated; a complex result is a machine number, as for the native
 * complex special functions. Reference values are mpmath's.
 */
import { ComputeEngine } from '../../src/compute-engine';

const ce = new ComputeEngine();

const withPrecision = <T>(digits: number, f: () => T): T => {
  const saved = ce.precision;
  ce.precision = digits;
  try {
    return f();
  } finally {
    ce.precision = saved;
  }
};

/** Significant digits of a printed real. */
const digitsOf = (s: string): number =>
  s
    .replace(/e.*$/, '')
    .replace(/[^0-9]/g, '')
    .replace(/^0+/, '').length;

describe('cross-wiring', () => {
  const exact: [string, unknown, string][] = [
    [
      'ClausenCl(2, π/2) = Catalan',
      ['ClausenCl', 2, ['Divide', 'Pi', 2]],
      '"CatalanConstant"',
    ],
    [
      'ClausenCl(4, π/2) = β(4)',
      ['ClausenCl', 4, ['Divide', 'Pi', 2]],
      'DirichletBeta(4)',
    ],
    [
      'ClausenCl(6, π/2) = β(6)',
      ['ClausenCl', 6, ['Divide', 'Pi', 2]],
      'DirichletBeta(6)',
    ],
    ['DirichletL(4, 2, 1) = π/4', ['DirichletL', 4, 2, 1], '1/4 * pi'],
    ['DirichletL(4, 2, 3) = π³/32', ['DirichletL', 4, 2, 3], '1/32 * pi^3'],
    [
      'DirichletL(4, 2, 2) = Catalan',
      ['DirichletL', 4, 2, 2],
      '"CatalanConstant"',
    ],
    ['DirichletL(4, 2, -1) = 0', ['DirichletL', 4, 2, -1], '0'],
  ];
  for (const [name, input, expected] of exact)
    test(`${name} (exact, evaluate)`, () => {
      expect(
        ce
          .expr(input as any)
          .evaluate()
          .toString()
      ).toBe(expected);
    });

  test('ClausenCl(4, π/2) = β(4) numerically', () => {
    withPrecision(30, () => {
      const cl = ce
        .expr(['ClausenCl', 4, ['Divide', 'Pi', 2]])
        .N()
        .toString();
      const beta = ce.expr(['DirichletBeta', 4]).N().toString();
      expect(cl).toBe('0.988944551741105336108422633228');
      expect(beta).toBe(cl);
    });
  });

  test('DirichletL(4, 2, s) is DirichletBeta(s) at a float s, near the pole too', () => {
    withPrecision(30, () => {
      for (const s of [1.01, 1.5, -2.5]) {
        expect(ce.expr(['DirichletL', 4, 2, s]).N().toString()).toBe(
          ce.expr(['DirichletBeta', s]).N().toString()
        );
      }
    });
  });

  test('DirichletL near 1 for a complex character uses the Stieltjes kernel', () => {
    // mpmath.dirichlet(1.01, chi_5 with chi(2) = i)
    const v = ce.expr(['DirichletL', 5, 2, 1.01]).N();
    expect(v.re).toBeCloseTo(0.866343690333, 11);
    expect(v.im).toBeCloseTo(0.2037086607522, 11);
  });

  test('StieltjesGamma(n, 1) is StieltjesGamma(n) under N()', () => {
    withPrecision(30, () => {
      const want = '-0.00969036319287231848453038603521';
      expect(ce.expr(['StieltjesGamma', 2]).N().toString()).toBe(want);
      expect(ce.expr(['StieltjesGamma', 2, 1]).N().toString()).toBe(want);
    });
  });
});

describe('DirichletEta and DirichletBeta at +∞', () => {
  for (const head of ['DirichletEta', 'DirichletBeta']) {
    test(`${head}(+∞) = 1 (evaluate, N)`, () => {
      expect(ce.expr([head, 'PositiveInfinity']).evaluate().toString()).toBe(
        '1'
      );
      expect(ce.expr([head, 'PositiveInfinity']).N().toString()).toBe('1');
    });
    test(`${head}(−∞) is Indeterminate`, () => {
      expect(ce.expr([head, 'NegativeInfinity']).evaluate().toString()).toBe(
        'Indeterminate'
      );
    });
  }
});

describe('real results carry ce.precision digits or stay unevaluated', () => {
  // [expression, value at 30 digits]
  const real: [string, unknown, string][] = [
    [
      'ClausenCl(1, 3/2)',
      ['ClausenCl', 1, 1.5],
      '-0.309891741707508888274235907425',
    ],
    [
      'ClausenCl(2, 3/2)',
      ['ClausenCl', 2, 1.5],
      '0.93921859275409211003215550014',
    ],
    [
      'ClausenCl(3, 3/2)',
      ['ClausenCl', 3, 1.5],
      '-0.047007401865106889578934669694',
    ],
    [
      'ClausenCl(2, 1e-10)',
      ['ClausenCl', 2, 1e-10],
      '2.40258509299404568401800534357e-9',
    ],
    [
      'ClausenCl(2, 3.1)',
      ['ClausenCl', 2, 3.1],
      '0.0288268323896607254136190335585',
    ],
    [
      'LogBarnesG(120.5)',
      ['LogBarnesG', 120.5],
      '23552.5384297242683358859497789',
    ],
    [
      'BarnesG(500.5)',
      ['BarnesG', 500.5],
      '1.78797051399844089349226829464e+255574',
    ],
    [
      'DirichletL(5, 3, 1.01)',
      ['DirichletL', 5, 3, 1.01],
      '0.433962893520138419534133750540',
    ],
    [
      'DirichletL(5, 3, 1)',
      ['DirichletL', 5, 3, 1],
      '0.430408940964004038889433232951',
    ],
    [
      'DirichletL(8, 3, 1.0000001)',
      ['DirichletL', 8, 3, 1.0000001],
      '0.785398182687579218598297449269',
    ],
    [
      'DirichletEta(3/2)',
      ['DirichletEta', 1.5],
      '0.765147024625407945367268758603',
    ],
    // Closer to s = 1 than the Hurwitz terms reach: the Laurent series in
    // the Stieltjes constants (mpmath at 140 digits).
    [
      'DirichletL(5, 3, 1 + 1e-20)',
      ['DirichletL', 5, 3, { num: '1.00000000000000000001' }],
      '0.430408940964004038892995639421',
    ],
    [
      'DirichletBeta(1 + 1e-20)',
      ['DirichletBeta', { num: '1.00000000000000000001' }],
      '0.785398163397448309617589858988',
    ],
  ];
  for (const [name, input, expected] of real) {
    test(`${name} = ${expected} at 30 digits`, () => {
      withPrecision(30, () => {
        const got = ce
          .expr(input as any)
          .N()
          .toString();
        expect(got.slice(0, 27)).toBe(expected.slice(0, 27));
        expect(digitsOf(got)).toBeGreaterThanOrEqual(29);
      });
    });
  }

  const declined: [string, unknown][] = [
    ['BarnesG(5000.5)', ['BarnesG', 5000.5]],
    ['LogBarnesG(1e6)', ['LogBarnesG', 1e6]],
    ['ClausenCl(2, 1e300)', ['ClausenCl', 2, 1e300]],
    ['ClausenCl(50, 1)', ['ClausenCl', 50, 1]],
  ];
  for (const [name, input] of declined)
    test(`${name} stays unevaluated at 30 digits, not a double`, () => {
      withPrecision(30, () => {
        const r = ce.expr(input as any).N();
        expect(r.operator).toBe((input as any)[0]);
      });
    });

  test('a double precision engine still answers in doubles', () => {
    withPrecision(15, () => {
      expect(ce.expr(['ClausenCl', 2, 1.5]).N().re).toBeCloseTo(
        0.9392185927540921,
        12
      );
      expect(ce.expr(['DirichletL', 5, 3, 1.01]).N().re).toBeCloseTo(
        0.4339628935201384,
        12
      );
    });
  });
});

describe('complex results are machine numbers, as for the native special functions', () => {
  const complex: [string, unknown][] = [
    ['DirichletEta(2.5 + i)', ['DirichletEta', ['Complex', 2.5, 1]]],
    ['DirichletBeta(2.5 + i)', ['DirichletBeta', ['Complex', 2.5, 1]]],
    ['DirichletL(5, 2, 1.5)', ['DirichletL', 5, 2, 1.5]],
    ['DirichletL(5, 2, 1.5 + i)', ['DirichletL', 5, 2, ['Complex', 1.5, 1]]],
    ['LogGamma(1/2 + 3i/10)', ['LogGamma', ['Complex', 0.5, 0.3]]],
    ['LogGamma(-5/2)', ['LogGamma', -2.5]],
    ['LogBarnesG(-5/2)', ['LogBarnesG', -2.5]],
    ['BarnesG(1/2 + 3i/10)', ['BarnesG', ['Complex', 0.5, 0.3]]],
    ['StieltjesGamma(3, -3/2)', ['StieltjesGamma', 3, -1.5]],
    ['StieltjesGamma(3, 5/2 + i)', ['StieltjesGamma', 3, ['Complex', 2.5, 1]]],
  ];
  for (const [name, input] of complex)
    test(`${name} has at most double digits at 30`, () => {
      withPrecision(30, () => {
        const r = ce.expr(input as any).N();
        expect(r.isNumberLiteral).toBe(true);
        for (const part of [r.re, r.im]) {
          // A double prints in at most 17 significant digits.
          expect(digitsOf(String(part))).toBeLessThanOrEqual(17);
        }
        expect(
          digitsOf(
            r
              .toString()
              .replace(/[()ij]/g, '')
              .split(/[+ -]/)[0]
          )
        ).toBeLessThanOrEqual(17);
      });
    });

  test('Gamma and Zeta, for reference, answer a complex operand in doubles', () => {
    withPrecision(30, () => {
      for (const input of [
        ['Gamma', ['Complex', 0.5, 0.3]],
        ['Zeta', ['Complex', 2.5, 1]],
      ]) {
        const r = ce.expr(input as any).N();
        expect(digitsOf(String(r.re))).toBeLessThanOrEqual(17);
      }
    });
  });
});
