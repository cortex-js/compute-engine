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
