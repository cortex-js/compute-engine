import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { gammaQ } from '../../src/compute-engine/numerics/special-functions';

// GammaRegularized(a, z) = Q(a, z), the regularized upper incomplete gamma,
// against mpmath `gammainc(a, z, inf, regularized=True)` (60 digits). Past
// z ≈ a the value is a tail: the bignum kernel took it from 1 − P(a, z) for
// z < 2a + 2 and lost it to rounding (Q(500, 911.575…) = 1e-50 was −6.9e-43 at
// the default precision). Worst relative error over the tables below:
//   machine kernel and `precision = 'machine'`: WORST_MACHINE
//   bignum kernel at precision 21, read as a double: WORST_BIG
// The bounds leave room for platform `Math.exp`/`Math.log` differences.
const MACHINE_TOLERANCE = 1e-11;
const BIGNUM_TOLERANCE = 1e-15;

// `exact` is Q at the double `z` (what the machine kernels receive); `decimal`
// is Q at the decimal literal `z`, which is what the bignum kernels receive.
type Case = [a: number, z: number, exact: number, decimal: number];

// [a, z, exact, decimal] — the three reported values
const reported: Case[] = [
  [
    500, 911.5750573285014, 1.0000000000000192462e-50,
    1.0000000000000327569e-50,
  ],
  [
    1000, 1830.846962046636, 1.0000000000002500403e-100,
    1.0000000000002538537e-100,
  ],
  [
    1000, 1548.889079637603, 1.0000000000003470129e-50,
    1.0000000000003079097e-50,
  ],
];

// z/a in {1.2, 1.5, 2} for a in {10, 100, 500, 1000}
const sweep: Case[] = [
  [10, 12.0, 0.24239216167051234868, 0.24239216167051234868],
  [10, 15.0, 0.069853660699409767692, 0.069853660699409767692],
  [10, 20.0, 0.0049954123083075871662, 0.0049954123083075871662],
  [100, 120.0, 0.027863739890520661484, 0.027863739890520661484],
  [100, 150.0, 5.9245403354839158294e-6, 5.9245403354839158294e-6],
  [100, 200.0, 1.8438936497115741514e-15, 1.8438936497115741514e-15],
  [500, 600.0, 0.000012255942330622904168, 0.000012255942330622904168],
  [500, 750.0, 1.0454640385979657294e-22, 1.0454640385979657294e-22],
  [500, 1000.0, 4.1436785914549917407e-69, 4.1436785914549917407e-69],
  [1000, 1200.0, 1.2881606086281432952e-9, 1.2881606086281432952e-9],
  [1000, 1500.0, 2.2046986113889961422e-43, 2.2046986113889961422e-43],
  [1000, 2000.0, 6.84734945961475318e-136, 6.84734945961475318e-136],
];

// Far in the tail, still inside the double range
const far: Case[] = [
  [10, 50.0, 1.2596084591660907506e-12, 1.2596084591660907506e-12],
  [10, 100.0, 1.1253473960842733885e-31, 1.1253473960842733885e-31],
  [100, 300.0, 1.4110215102111521394e-41, 1.4110215102111521394e-41],
  [100, 500.0, 1.5008794119250894345e-106, 1.5008794119250894345e-106],
  [500, 1500.0, 1.6436845843569543369e-198, 1.6436845843569543369e-198],
  [1000, 2500.0, 2.645982074544255554e-256, 2.645982074544255554e-256],
];

// Below and around z = a + 1, where Q is not small: unchanged
const bulk: Case[] = [
  [10, 5.0, 0.96817194269379518826, 0.96817194269379518826],
  [10, 10.0, 0.45792971447185220831, 0.45792971447185220831],
  [10, 11.0, 0.34051064246566104728, 0.34051064246566104728],
  [100, 90.0, 0.8417790108135698319, 0.8417790108135698319],
  [100, 100.0, 0.48670120172085133514, 0.48670120172085133514],
  [100, 101.0, 0.44710370656548875421, 0.44710370656548875421],
  [500, 450.0, 0.98928276190871025844, 0.98928276190871025844],
  [1000, 1001.0, 0.48318854707021377925, 0.48318854707021377925],
  [1000, 950.0, 0.94494531376926196551, 0.94494531376926196551],
];

const tables: [string, Case[]][] = [
  ['reported', reported],
  ['sweep', sweep],
  ['far', far],
  ['bulk', bulk],
];

const relErr = (got: number, expected: number) =>
  Math.abs(got - expected) / expected;

const machine = new ComputeEngine();
machine.precision = 'machine';
const big = new ComputeEngine(); // the default precision, bignum kernels

describe('GammaRegularized upper tail', () => {
  for (const [name, cases] of tables) {
    for (const [a, z, exact, decimal] of cases) {
      const label = `${name}: Q(${a}, ${z}) = ${exact}`;

      test(`${label} (machine kernel)`, () => {
        expect(relErr(gammaQ(a, z), exact)).toBeLessThan(MACHINE_TOLERANCE);
      });

      test(`${label} (N, machine precision)`, () => {
        const v = machine.box(['GammaRegularized', a, z]).N().re;
        expect(relErr(v, exact)).toBeLessThan(MACHINE_TOLERANCE);
      });

      test(`${label} (N, default precision)`, () => {
        const v = big.box(['GammaRegularized', a, z]).N().re;
        expect(relErr(v, decimal)).toBeLessThan(BIGNUM_TOLERANCE);
      });

      test(`${label} (compiled JavaScript)`, () => {
        const f = compile(machine.box(['GammaRegularized', 'a', 'z']));
        const v = f.run!({ a, z }) as number;
        expect(relErr(v, exact)).toBeLessThan(MACHINE_TOLERANCE);
      });
    }
  }

  test('evaluate() of a float operand agrees with N()', () => {
    for (const [a, z] of reported) {
      const e = big.box(['GammaRegularized', a, z]);
      expect(e.evaluate().re).toBe(e.N().re);
    }
  });

  test('a tail probability is positive', () => {
    for (const [a, z] of [...reported, ...sweep, ...far]) {
      expect(gammaQ(a, z)).toBeGreaterThan(0);
      expect(big.box(['GammaRegularized', a, z]).N().re).toBeGreaterThan(0);
    }
  });
});
