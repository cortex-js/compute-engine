import Complex from 'complex.js';
import { ComputeEngine } from '../../src/compute-engine';
import { carlsonRFComplex } from '../../src/compute-engine/numerics/numeric-complex';

const ce = new ComputeEngine();

type Json = Parameters<typeof ce.expr>[0];

const complex = (re: number, im: number): Json => ['Complex', re, im];

const value = (head: string, phi: Json, m: Json) => {
  const v = ce.expr([head, phi, m]).N();
  return { re: v.re, im: v.im };
};

const close = (
  got: { re: number; im: number },
  want: [number, number],
  tol = 1e-13
) => {
  const scale = Math.hypot(...want);
  expect(Math.hypot(got.re - want[0], got.im - want[1])).toBeLessThan(
    tol * scale
  );
};

// mpmath 1.3.0: ellipf(phi, m), ellipe(phi, m)
const F: [string, Json, Json, [number, number]][] = [
  ['F(0.3 + 400i | 0.5)', complex(0.3, 400), 0.5, [0, 1.8540746773013719]],
  ['F(355i | 2)', complex(0, 355), 2, [0, 1.3110287771460599]],
  [
    'F(2 - 400i | -2)',
    complex(2, -400),
    -2,
    [1.1714200841467699, -1.0010773804561062],
  ],
  [
    'F(1.5 + 1e4 i | 1.5 + 0.5i)',
    complex(1.5, 1e4),
    complex(1.5, 0.5),
    [0.11877921074584749, 1.393413574626058],
  ],
  [
    'F(0.3 - 50i | -1 + i)',
    complex(0.3, -50),
    complex(-1, 1),
    [-0.90936706093798039, -1.2829845888842129],
  ],
  // A parameter below 1e-15: the rescaled arguments λ and λ − m·ŝ² differ by
  // about |m|/4, and are not equal (mpmath 1.4.1)
  [
    'F(0.3 + 100i | 1e-16)',
    complex(0.3, 100),
    1e-16,
    [2.1987152945435725e-36, 19.806975105072257],
  ],
  [
    'F(0.3 + 400i | 3e-15)',
    complex(0.3, 400),
    3e-15,
    [6.9866889436655844e-44, 18.106376414241191],
  ],
  // Each side of |Im φ| = 20, where the rescaled form starts
  [
    'F(0.3 + 19.9i | 1e-16)',
    complex(0.3, 19.9),
    1e-16,
    [0.12361199451148395, 19.381358199407936],
  ],
  [
    'F(0.3 + 20.1i | 1e-16)',
    complex(0.3, 20.1),
    1e-16,
    [0.10395763586318132, 19.455951883341037],
  ],
];

const E: [string, Json, Json, [number, number]][] = [
  [
    'E(0.3 + 300i | 0.5)',
    complex(0.3, 300),
    0.5,
    [2.0294892688728802e129, 6.5607870769560926e129],
  ],
  [
    'E(2 + 400i | -2)',
    complex(2, 400),
    -2,
    [1.5364709767568243e173, 3.357250332958024e173],
  ],
  [
    'E(-3 - 300i | 3 - 2i)',
    complex(-3, -300),
    complex(3, -2),
    [-2.7998024763517175e129, -1.8227906079762742e130],
  ],
  [
    'E(1 - 30i | 0.3 - 0.7i)',
    complex(1, -30),
    complex(0.3, -0.7),
    [1888791540571.3797, -4263289742840.8662],
  ],
  // mpmath 1.4.1
  [
    'E(0.3 + 30i | 1e-15)',
    complex(0.3, 30),
    1e-15,
    [49933.458036389086, 161438.95078668957],
  ],
  [
    'E(0.3 + 19.9i | 1e-15)',
    complex(0.3, 19.9),
    1e-15,
    [2.0724350308497942, 24.218057886367729],
  ],
  [
    'E(0.3 + 20.1i | 1e-15)',
    complex(0.3, 20.1),
    1e-15,
    [2.522770925559785, 25.698644550222259],
  ],
  // Near the top of the double range: E(708i | 1) = i·sinh(708)
  ['E(708i | 1)', complex(0, 708), 1, [0, 1.5116915721380275e307]],
  // Past Im φ = 709 E is finite for a small m
  [
    'E(0.3 + 715i | 1e-8)',
    complex(0.3, 715),
    1e-8,
    [4.899048590513302e305, 1.5837292256228661e306],
  ],
];

describe('INCOMPLETE ELLIPTIC INTEGRALS FAR FROM THE REAL AXIS', () => {
  test.each(F)('%s', (_, phi, m, want) => {
    close(value('EllipticF', phi, m), want);
  });

  test.each(E)('%s', (_, phi, m, want) => {
    close(value('EllipticE', phi, m), want);
  });

  test('F and E at m = 0 are φ', () => {
    for (const phi of [complex(0.3, -50), complex(2, 400), 0.7]) {
      const f = value('EllipticF', phi, 0);
      const e = value('EllipticE', phi, 0);
      const want = ce.expr(phi).N();
      expect(f).toEqual({ re: want.re, im: want.im });
      expect(e).toEqual({ re: want.re, im: want.im });
    }
  });

  test('F and E at a tiny m are φ on both sides of the real axis', () => {
    // F(φ|m) = φ + O(m) and E(φ|m) = φ + O(m); 1 − m·sin²φ rounds to 1, so
    // R_F reduces to R_C(cos²φ, 1), whose arccos takes a large argument
    // below the real axis when Im φ < 0
    for (const [re, im] of [
      [0.3, -10],
      [0.3, 10],
      [-2, -15],
    ]) {
      close(value('EllipticF', complex(re, im), 1e-30), [re, im], 1e-15);
      close(value('EllipticE', complex(re, im), 1e-30), [re, im], 1e-15);
    }
  });

  test('both are odd in φ', () => {
    for (const m of [0.5, -2, complex(1.5, 0.5)]) {
      for (const head of ['EllipticF', 'EllipticE']) {
        const up = value(head, complex(0.3, 80), m);
        const down = value(head, complex(-0.3, -80), m);
        expect(down.re).toBeCloseTo(-up.re, 8);
        expect(down.im).toBeCloseTo(-up.im, 8);
      }
    }
  });

  test('E past the double range stays unevaluated', () => {
    expect(ce.expr(['EllipticE', complex(0.3, 1000), 0.5]).N().operator).toBe(
      'EllipticE'
    );
  });

  test('R_F of conjugate arguments near the cut is real', () => {
    // mpmath: elliprf(1, -1e16 + i, -1e16 - i) = 3.89208030295846e-7
    const r = carlsonRFComplex(
      new Complex(1, 0),
      new Complex(-1e16, 1),
      new Complex(-1e16, -1)
    );
    expect(
      Math.abs(r.re - 3.89208030295846e-7) / 3.89208030295846e-7
    ).toBeLessThan(1e-14);
    expect(Math.abs(r.im)).toBeLessThan(1e-20);
  });
});
