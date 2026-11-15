import { ComputeEngine } from '../../src/compute-engine';

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
});
