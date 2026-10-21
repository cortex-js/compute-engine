/**
 * Complex `GammaLn` is the principal logarithm of Γ(z), `LogGamma` the
 * continuous one. Reference values: mpmath 1.3 `log(gamma(z))` and
 * `loggamma(z)`.
 */

import { ComputeEngine, compile } from '../../src/compute-engine';

const ce = new ComputeEngine();

// [re, im, GammaLn (re, im), LogGamma (re, im)]
const cases: [number, number, [number, number], [number, number]][] = [
  [
    0.5,
    -11,
    [-16.35982106153919, -2.814267096127763],
    [-16.35982106153919, -15.38063771048694],
  ],
  [
    0.5,
    11,
    [-16.35982106153919, 2.814267096127763],
    [-16.35982106153919, 15.38063771048694],
  ],
  [
    -2.5,
    0.1,
    [-0.1031492440428192, -3.031258961180252],
    [-0.1031492440428192, -9.314444268359838],
  ],
  [
    -2.5,
    -0.1,
    [-0.1031492440428192, 3.031258961180252],
    [-0.1031492440428192, 9.314444268359838],
  ],
  [
    -2.5,
    1.5,
    [-3.717513451191792, -1.429880218654606],
    [-3.717513451191792, -7.713065525834193],
  ],
  [
    -7.3,
    2,
    [-13.32773204758136, -1.523844387634771],
    [-13.32773204758136, -20.37340030917353],
  ],
  [
    3,
    -2,
    [-0.03163905937396119, -2.022193197501327],
    [-0.03163905937396119, -2.022193197501327],
  ],
  [
    0.5,
    1,
    [-0.6527906442043729, -0.9550077243425691],
    [-0.6527906442043729, -0.9550077243425691],
  ],
  [
    25.5,
    -40,
    [31.77449231982947, -1.225841481579366],
    [31.77449231982947, -139.4559182395303],
  ],
  [
    300.5,
    200,
    [1349.611781085493, -2.176278410488487],
    [1349.611781085493, 1153.929818110555],
  ],
];

const fmt = (re: number, im: number) =>
  `${re}${im < 0 ? '-' : '+'}${Math.abs(im)}i`;

function expectClose(
  got: { re: number; im: number },
  want: [number, number],
  tol = 1e-10
) {
  const scale = Math.max(1, Math.hypot(want[0], want[1]));
  expect(Math.abs(got.re - want[0]) / scale).toBeLessThan(tol);
  expect(Math.abs(got.im - want[1]) / scale).toBeLessThan(tol);
}

describe('GammaLn is the principal log of Γ(z), LogGamma the continuation', () => {
  for (const [re, im, principal, continuous] of cases) {
    const arg = ['Complex', re, im];
    test(`GammaLn(${fmt(re, im)}) = ${fmt(...principal)} (N)`, () => {
      expectClose(ce.expr(['GammaLn', arg]).N() as any, principal);
    });
    test(`GammaLn(${fmt(re, im)}) = ${fmt(...principal)} (evaluate)`, () => {
      expectClose(
        ce.expr(['N', ['GammaLn', arg]]).evaluate() as any,
        principal
      );
    });
    test(`GammaLn(${fmt(re, im)}) = ${fmt(...principal)} (parse)`, () => {
      const sign = im < 0 ? '-' : '+';
      expectClose(
        ce
          .parse(`\\operatorname{GammaLn}(${re}${sign}${Math.abs(im)}i)`)
          .N() as any,
        principal
      );
    });
    test(`LogGamma(${fmt(re, im)}) = ${fmt(...continuous)} (N)`, () => {
      expectClose(ce.expr(['LogGamma', arg]).N() as any, continuous);
    });
  }

  test('Im GammaLn stays in (−π, π]', () => {
    for (let a = -12; a <= 12; a += 0.7)
      for (let b = -15; b <= 15; b += 1.3) {
        const v = ce.expr(['GammaLn', ['Complex', a, b]]).N() as any;
        expect(v.im).toBeGreaterThan(-Math.PI);
        expect(v.im).toBeLessThanOrEqual(Math.PI);
      }
  });

  test('GammaLn(−2.5) = ln|Γ(−2.5)| = -0.0562437164976741 (real axis)', () => {
    expect((ce.expr(['GammaLn', -2.5]).N() as any).re).toBeCloseTo(
      -0.0562437164976741,
      12
    );
    expect((ce.expr(['GammaLn', -2.5]).N() as any).im ?? 0).toBe(0);
  });

  test('compiled GammaLn is real-only: a complex operand declines', () => {
    // The JavaScript lowering is `_SYS.lngamma` on real numbers, so the
    // compiled lane cannot return a value on the other branch.
    expect(() =>
      compile(ce.expr(['GammaLn', ['Complex', 0.5, -11]]), {
        to: 'javascript',
        fallback: false,
      } as any)
    ).toThrow(/real-only/);
  });

  test('compiled GammaLn(x) agrees with N() for real x > 0', () => {
    const r = compile(ce.expr(['GammaLn', 'x']), { to: 'javascript' });
    const f = r.run as (v: { x: number }) => number;
    for (const x of [0.3, 7.25, 120.5])
      expect(f({ x })).toBeCloseTo((ce.expr(['GammaLn', x]).N() as any).re, 10);
  });
});
