import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { betaRegularized } from '../../src/compute-engine/numerics/special-functions';

// BetaRegularized(x, a, b) = I_x(a, b) against mpmath
// `betainc(a, b, 0, x, regularized=True)` (60 digits). Past
// x = (a+1)/(a+b+2) the kernels returned 1 − I_(1−x)(b, a), which keeps no
// digits when I_x is small: I_0.9003(3, 1e-100) = 1e-100 was 1.4e-14 at machine
// precision and 3.3e-43 at the default one. A small I_x now comes from its own
// continued fraction. Worst relative error over the tables below:
//   machine kernel and `precision = 'machine'`: WORST_MACHINE
//   bignum kernel at precision 21, read as a double: WORST_BIG
// The bounds leave room for platform `Math.exp`/`Math.log` differences.
const MACHINE_TOLERANCE = 1e-11;
const BIGNUM_TOLERANCE = 1e-15;

// `exact` is I at the doubles (what the machine kernels receive); `decimal` is
// I at the decimal literals, which is what the bignum kernels receive.
type Case = [x: number, a: number, b: number, exact: number, decimal: number];

// [x, a, b, exact, decimal]; `reported` is the reported value, `tails` the
// small I_x past the boundary, `bulk` values that stay as they were
const reported: Case[] = [
  [0.9003, 3, 1e-100, 1.0000195570143443377e-100, 1.0000195570143444058e-100],
];

const tails: Case[] = [
  [0.99, 3, 1e-5, 0.00003125077406631223436, 0.000031250774066312240508],
  [0.9, 50, 0.001, 8.9398101894814054834e-7, 8.939810189481392554e-7],
  [0.6, 500, 0.001, 5.9683310018810735838e-117, 5.9683310018811842244e-117],
  [0.95, 2, 1e-8, 2.045732257141387539e-8, 2.0457322571413883399e-8],
  [0.97, 0.5, 1e-20, 4.8776806393446820852e-20, 4.8776806393446832545e-20],
  [0.8, 3, 0.01, 0.0049128817686840429166, 0.0049128817686840413945],
  [0.85, 20, 0.05, 0.00057539237520832968054, 0.00057539237520833001161],
];

const bulk: Case[] = [
  [0.3, 2, 5, 0.57982499999999997601, 0.579825],
  [0.5, 5, 5, 0.5, 0.5],
  [0.9, 2, 5, 0.99994500000000000006, 0.999945],
  [0.7, 10, 3, 0.25281534785499989355, 0.252815347855],
  [0.95, 3, 0.5, 0.59450304770527234421, 0.59450304770527251224],
  [0.2, 0.5, 0.5, 0.29516723530086655719, 0.29516723530086654835],
  [0.5, 100, 100, 0.5, 0.5],
  [0.99, 1, 1, 0.98999999999999999112, 0.99],
  [0.1, 30, 2, 2.8000000000000046463e-29, 2.8e-29],
];

const tables: [string, Case[]][] = [
  ['reported', reported],
  ['tails', tails],
  ['bulk', bulk],
];

const relErr = (got: number, expected: number) =>
  Math.abs(got - expected) / expected;

const machine = new ComputeEngine();
machine.precision = 'machine';
const big = new ComputeEngine(); // the default precision, bignum kernels

describe('BetaRegularized small values past the boundary', () => {
  for (const [name, cases] of tables) {
    for (const [x, a, b, exact, decimal] of cases) {
      const label = `${name}: I_${x}(${a}, ${b}) = ${exact}`;

      test(`${label} (machine kernel)`, () => {
        expect(relErr(betaRegularized(x, a, b), exact)).toBeLessThan(
          MACHINE_TOLERANCE
        );
      });

      test(`${label} (N, machine precision)`, () => {
        const v = machine.box(['BetaRegularized', x, a, b]).N().re;
        expect(relErr(v, exact)).toBeLessThan(MACHINE_TOLERANCE);
      });

      test(`${label} (N, default precision)`, () => {
        const v = big.box(['BetaRegularized', x, a, b]).N().re;
        expect(relErr(v, decimal)).toBeLessThan(BIGNUM_TOLERANCE);
      });

      test(`${label} (compiled JavaScript)`, () => {
        const f = compile(machine.box(['BetaRegularized', 'x', 'a', 'b']));
        const v = f.run!({ x, a, b }) as number;
        expect(relErr(v, exact)).toBeLessThan(MACHINE_TOLERANCE);
      });
    }
  }

  test('evaluate() of a float operand agrees with N()', () => {
    for (const [x, a, b] of [...reported, ...tails]) {
      const e = big.box(['BetaRegularized', x, a, b]);
      expect(e.evaluate().re).toBe(e.N().re);
    }
  });

  test('a small value is positive', () => {
    for (const [x, a, b] of [...reported, ...tails]) {
      expect(betaRegularized(x, a, b)).toBeGreaterThan(0);
      expect(big.box(['BetaRegularized', x, a, b]).N().re).toBeGreaterThan(0);
    }
  });
});

// Close to x = 1 the direct fraction converges too slowly to end within its
// cap, and the symmetric value 1 − I_{1−x}(b, a) is kept while it still carries
// enough digits. With a = 1, I_x(1, b) = 1 − (1 − x)^b exactly, so these
// reference values are closed forms (mpmath at 40 digits, at the double inputs
// and at the decimal literals). The bignum kernel keeps the symmetric value
// down to 1e-20 (its 24 guard digits less four); the machine kernel down to
// 1e-6, where the value's relative error (about 4e-16 / value) is still near
// the engine's default tolerance. Before the fallback, the first case was NaN
// on both kernels.
const keptSymmetric: Case[] = [
  [0.9999999999, 1, 1e-6, 0.000023025585754331136327, 0.0000230255858370695998],
  [0.9999999999, 1, 4.3e-8, 9.9011109626928884677e-7, 9.9011109982712110155e-7],
];

describe('BetaRegularized keeps the symmetric value where the direct fraction declines', () => {
  for (const [x, a, b, , decimal] of keptSymmetric) {
    test(`I_${x}(${a}, ${b}) = ${decimal} (N, default precision)`, () => {
      const v = big.box(['BetaRegularized', x, a, b]).N().re;
      expect(relErr(v, decimal)).toBeLessThan(BIGNUM_TOLERANCE);
    });
  }

  test('the machine kernel keeps a value above its floor of 1e-6', () => {
    const [x, a, b, exact] = keptSymmetric[0];
    expect(relErr(betaRegularized(x, a, b), exact)).toBeLessThan(1e-10);
    const v = machine.box(['BetaRegularized', x, a, b]).N().re;
    expect(relErr(v, exact)).toBeLessThan(1e-10);
  });

  test('the machine kernel declines below its floor of 1e-6', () => {
    const [x, a, b] = keptSymmetric[1];
    expect(betaRegularized(x, a, b)).toBeNaN();
  });
});
