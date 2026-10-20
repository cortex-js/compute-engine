import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

// Compiled two-operand `GammaRegularized(a, z)` at a non-positive order `a`,
// against mpmath `gammainc(a, z, inf, regularized=True)` (50 digits). The
// compiled kernel returned `NaN` for every a ≤ 0 while `.N()` was correct
// (`Q(−1.5, 10⁻³)` is 8894.845339…). Both lanes now call the same `gammaQ`.
const TOLERANCE = 1e-11;

const ce = new ComputeEngine();
ce.declare('a', 'real');
ce.declare('z', 'real');

const cases: [number, number, number][] = [
  [-0.5, 0.001, -16.85907942974364694],
  [-0.5, 0.1, -0.9596214126967847763],
  [-0.5, 1, -0.050254541660012221011],
  [-0.5, 5, -0.00013467106250151868507],
  [-1.5, 0.001, 8894.8453395772396951],
  [-1.5, 0.1, 7.1120898808800237594],
  [-1.5, 1, 0.053522332695136454824],
  [-1.5, 5, 0.000035336269548888151189],
  [-2.5, 0.001, -13358661.783170897495],
  [-2.5, 0.1, -113.96357952277209755],
  [-2.5, 1, -0.10214297883758655893],
  [-2.5, 5, -0.000015665930066233899688],
  [0.5, 0.001, 0.96432940827032011458],
  [0.5, 0.1, 0.65472084601857702044],
  [0.5, 1, 0.15729920705028513066],
  [0.5, 5, 0.0015654022580025496775],
  [2, 0.001, 0.99999950033320836666],
  [2, 0.1, 0.99532115983955552998],
  [2, 1, 0.73575888234288464319],
  [2, 5, 0.04042768199451280258],
];

const rel = (x: number, ref: number) => Math.abs((x - ref) / ref);

describe('GammaRegularized compiled, against mpmath', () => {
  const fn = compile(ce.box(['GammaRegularized', 'a', 'z']));

  for (const [a, z, ref] of cases) {
    test(`Q(${a}, ${z}) = ${ref} (compiled and N())`, () => {
      const compiled = fn.run!({ a, z }) as number;
      const interpreted = ce.box(['GammaRegularized', a, z]).N().re;
      expect(rel(compiled, ref)).toBeLessThan(TOLERANCE);
      expect(rel(interpreted, ref)).toBeLessThan(TOLERANCE);
    });
  }

  test('the reported repro: Q(−1.5, 0.001) = 8894.8453…, not NaN', () => {
    expect(fn.run!({ a: -1.5, z: 0.001 })).toBeCloseTo(8894.845339577239, 6);
  });

  // 1/Γ(a) = 0 at a pole, so Q vanishes for z ≠ 0 on both lanes; at z = 0 it
  // is ∞/∞ and both are NaN.
  for (const a of [0, -1, -2, -7]) {
    for (const z of [0.001, 1, 5]) {
      test(`Q(${a}, ${z}) = 0 (compiled and N())`, () => {
        expect(fn.run!({ a, z })).toBe(0);
        expect(ce.box(['GammaRegularized', a, z]).N().re).toBe(0);
      });
    }
    test(`Q(${a}, 0) is NaN (compiled and N())`, () => {
      expect(fn.run!({ a, z: 0 })).toBeNaN();
      expect(ce.box(['GammaRegularized', a, 0]).N().re).toBeNaN();
    });
  }

  // At z = 0 the integral diverges: sign(Γ(a))·∞, as the interpreter folds.
  for (const [a, sign] of [
    [-0.5, -1],
    [-1.5, 1],
    [-2.5, -1],
  ] as const) {
    test(`Q(${a}, 0) = ${sign < 0 ? '-' : '+'}∞ (compiled and evaluate())`, () => {
      expect(fn.run!({ a, z: 0 })).toBe(sign * Infinity);
      expect(ce.box(['GammaRegularized', a, 0]).evaluate().re).toBe(
        sign * Infinity
      );
    });
  }

  // Compiled lane only, against mpmath (40 digits) at the exact double
  // operands. The interpreter's `.N()` reads the operand as its shortest
  // decimal, and near a pole of Γ the 1e-17 difference moves Q by 1e-11.
  const compiledCases: [string, [number, number, number][]][] = [
    [
      // x^a·e^{−x} underflowed to 0 in Γ(a,x), and 0/Γ(a) answered 0. Γ(a)
      // is subnormal or 0 past a ≈ −170.6.
      'a large negative order',
      [
        [-150.5, 120, -7.6538141806818747109e-105],
        [-170.5, 120, -2.513673213331222504e-102],
        [-150.5, 300, -3.9759715639112199173e-243],
        [-100.5, 300, -4.2858136226303948426e-224],
        [-171.5, 2, 9.5392695139833848982e254],
        [-171.5, 0.99, 6.2504454438765827405e307],
        [-200.5, 30, -9.9198204695551225985e63],
        [-300.5, 120, -4.9475804196220313199e-65],
        [-60.3, 9.9, -4811693868012665.716],
      ],
    ],
    [
      // Γ(a) by reflection lost relative precision in `Math.sin(Math.PI·a)`
      // (1e-10 at a = −1.000001).
      'an order near a pole of Γ',
      [
        [-1.000001, 1e-8, 100.00176551047695517],
        [-1.000001, 0.3, 1.5637191268542545028e-6],
        [-1.000001, 2, 1.8767121332449326887e-8],
        [-1.000001, 30, 9.7655351752592789654e-23],
        [-0.999999, 1e-8, -99.998196828915809016],
        [-0.999999, 0.3, -1.5637157075865508775e-6],
        [-0.999999, 2, -1.8767140486992965377e-8],
        [-0.999999, 30, -9.7655939425298825918e-23],
        [-3.0001, 1e-8, 2.0038723780671767675e20],
        [-3.0001, 0.3, 0.0048218330652496276644],
        [-3.0001, 2, 1.8767864712997862529e-6],
        [-3.0001, 30, 6.1349622943564012053e-23],
      ],
    ],
    [
      // 1 − P(a,x) and Γ(a) − γ(a,x) cancel as a → 0 (5 correct digits at
      // a = ±10⁻⁹); the continued fraction did not converge for −1 < a < −½
      // below x ≈ 0.01 (NaN at (−0.9999, 0.001)).
      'an order near 0 or in (−1, −½)',
      [
        [-1e-9, 0.5, -5.5977359448278105441e-10],
        [-1e-6, 0.3, -9.0567648966497985433e-7],
        [-0.0001, 0.8, -0.000031056991643300889421],
        [1e-9, 0.99, 2.2309982601677846147e-10],
        [1e-6, 0.5, 5.5977388815563453362e-7],
        [0.3, 1.2, 0.063394719569259104781],
        [-0.9999, 0.001, -0.099203865307634876211],
        [-0.9999, 0.01, -0.0094927916175652696138],
        [-0.75, 0.3, -0.27539931438203028365],
        [-0.6, 0.99, -0.047383229539246468296],
        // −½ ≤ a < 0 with a + 1 ≤ x < 1: the recurrence from a + 1 cancels
        // there (6 correct digits at (−1e-10, 0.99999999995)); the
        // continued fraction answers.
        [-1e-8, 0.999999995, -2.1938393399016705857e-9],
        [-1e-10, 0.99999999995, -2.1938393439146675117e-11],
        [-0.25, 0.9, -0.048623800949348455184],
        [-0.001, 0.9995, -0.00021934333301562113128],
        // A tiny order: Q = a·E₁(x). Γ(a) ≈ 1/a overflows for a subnormal a.
        [1e-300, 0.5, 5.5977359477616082577e-301],
        [-1e-300, 0.99, -2.2309982579017724582e-301],
        [-1e-309, 1e-300, -6.9019831223331347375e-307],
        [1e-20, 0.99, 2.23099825790177228e-21],
        [-1e-20, 0.5, -5.5977359477616078104e-21],
      ],
    ],
  ];
  for (const [label, rows] of compiledCases) {
    for (const [a, z, ref] of rows) {
      test(`${label}: Q(${a}, ${z}) = ${ref} (compiled)`, () => {
        expect(rel(fn.run!({ a, z }) as number, ref)).toBeLessThan(1e-12);
      });
    }
  }

  // |Q| outside the double range is the IEEE result of the exact value, as
  // for a > 0: ±∞ with the sign of Q when it overflows, a signed 0 when it
  // underflows. mpmath gives −2.6e-331, −7.0e-331, −5.4e339, −6.5e372 and
  // 3.0e1679.
  for (const [a, z, ieee] of [
    [-0.5, 750, -0],
    [-10.5, 700, -0],
    [-150.5, 0.3, -Infinity],
    [-200.5, 1, -Infinity],
    [-171.5, 1e-8, Infinity],
    // Within 0.05 of a pole of Γ after the shift of Γ(a, z) (NaN before):
    // mpmath gives 5.1e397, −1.7e890 and −2.5e1604.
    [-57.00707326638518, 1.9909707833817464e-6, Infinity],
    [-86.00605661033102, 1.309130303625191e-9, -Infinity],
    [-212.9944237232914, 2.2248478364088193e-6, -Infinity],
  ]) {
    test(`Q(${a}, ${z}) outside the double range is ${ieee} (compiled)`, () => {
      expect(Object.is(fn.run!({ a, z }), ieee)).toBe(true);
    });
  }

  // Q(a, +∞) = 0 for a finite a, with the sign of Γ(a) at a negative
  // non-integer a; `.N()` answers 0. The continued fraction formed 0·∞.
  for (const [a, negative] of [
    [-0.5, true],
    [-1.5, false],
    [-2.5, true],
    [-2, false],
    [0, false],
    [0.5, false],
    [3, false],
  ] as const) {
    test(`Q(${a}, +∞) is ${negative ? '-' : ''}0 (compiled and N())`, () => {
      expect(Object.is(fn.run!({ a, z: Infinity }), negative ? -0 : 0)).toBe(
        true
      );
      expect(ce.box(['GammaRegularized', a, 'PositiveInfinity']).N().re).toBe(
        0
      );
    });
  }

  // A subnormal Q is the subnormal value (mpmath: −1.4985883786714537e-309).
  test('Q(-0.5, 700) is subnormal (compiled)', () => {
    const v = fn.run!({ a: -0.5, z: 700 }) as number;
    expect(Math.abs(v - -1.4985883786714537084e-309)).toBeLessThan(1e-320);
  });

  // No kernel on these targets: the compile declines (`success: false`, no
  // code) and `run` falls back to the interpreter.
  for (const to of ['glsl', 'wgsl', 'interval-js'] as const) {
    test(`${to} declines rather than answer`, () => {
      const r = compile(ce.box(['GammaRegularized', 'a', 'z']), { to });
      expect(r.success).toBe(false);
      expect(r.code).toBe('');
    });
  }
});
