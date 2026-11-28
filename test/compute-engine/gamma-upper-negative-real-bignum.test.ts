/**
 * `Gamma(s, z)` at a real `z < 0` is computed in big decimals at the engine
 * precision, on the principal branch (arg z = π). Reference values: mpmath 1.3.
 */

import { ComputeEngine } from '../../src/compute-engine';
import { BigDecimal } from '../../src/big-decimal';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

/** The number of correct digits of `actual` against `expected` (relative). */
function digits(actual: BigDecimal | undefined, expected: string): number {
  const want = new BigDecimal(expected);
  const got = actual ?? BigDecimal.ZERO;
  if (want.isZero()) return got.isZero() ? Infinity : 0;
  const error = got.sub(want).abs().div(want.abs(), 80);
  return error.isZero() ? Infinity : -Math.log10(error.toNumber());
}

const parts = (v: any): [BigDecimal | undefined, BigDecimal | undefined] => [
  v.bignumRe ?? (v.re === 0 ? BigDecimal.ZERO : new BigDecimal(String(v.re))),
  v.bignumIm ??
    ((v.im ?? 0) === 0 ? BigDecimal.ZERO : new BigDecimal(String(v.im))),
];

const at30: [string, string, string, string][] = [
  ['1', '-2.5', '1.218249396070347343807017595116797e+1', '0'],
  ['2', '-10', '-1.982381921532604486526211058075582e+5', '0'],
  ['5', '-40', '5.466267313060053793932912783356966e+23', '0'],
  [
    '0.5',
    '-2.5',
    '1.772453850905516027298167483341145',
    '-9.873508238877278041372552934387261',
  ],
  [
    '2.5',
    '-1',
    '1.329340388179137020473625612505859',
    '-8.34836704631249795525929144609151e-1',
  ],
  [
    '-0.5',
    '-10',
    '-3.54490770181103205459633496668229',
    '8.463162445455918592633303024100716e+2',
  ],
  [
    '-2',
    '-2.5',
    '-1.257846382923277933021267148984757e-1',
    '-1.570796326794896619231321691639751',
  ],
  [
    '0',
    '-0.1',
    '1.622812813969276674965682999227475',
    '-3.141592653589793238462643383279503',
  ],
  [
    '-1',
    '-40',
    '1.550865926857419431617336497848212e+14',
    '3.141592653589793238462643383279503',
  ],
  [
    '0.001',
    '-1',
    '-1.888042940081095798669709478806882',
    '-3.145724192315409983779846808198304',
  ],
  [
    '-3.7',
    '-40',
    '-4.649015122218881779336943296525706e+9',
    '-6.398820362565510314366708362193336e+9',
  ],
  ['100', '-1', '9.33262154439441526816992388562667e+155', '0'],
  [
    '0.3',
    '-120',
    '-2.702042489765086161537204345038349e+50',
    '-3.719042431257580560270840998072227e+50',
  ],
  [
    '1000.5',
    '-50',
    '1.272301195695055464182244180377445e+2566',
    '-3.257144584207062233788537255103795e+1718',
  ],
  [
    '-2.0000000000000000001',
    '-1.5',
    '8.391845367340259820015658694494031e-1',
    '-1.570796326794896619350008664801074',
  ],
  ['2', '-1.0000000000000001', '-2.7182818284590455071884703172572e-16', '0'],
  [
    '1.5',
    '-0.000000000000000000000000000001',
    '8.862269254527580136490837416705726e-1',
    '6.666666666666666666666666666670667e-46',
  ],
];

const at50: [string, string, string, string][] = [
  [
    '2',
    '-10',
    '-1.9823819215326044865262110580755819929718161356701103e+5',
    '0',
  ],
  [
    '0.5',
    '-2.5',
    '1.77245385090551602729816748334114518279754945612238713',
    '-9.87350823887727804137255293438726081519384591448253066',
  ],
  [
    '-0.5',
    '-10',
    '-3.54490770181103205459633496668229036559509891224477426',
    '8.46316244545591859263330302410071568187721387332128749e+2',
  ],
  [
    '-2',
    '-2.5',
    '-1.25784638292327793302126714898475742206985071627502756e-1',
    '-1.57079632679489661923132169163975144209858469968755291',
  ],
  [
    '-3.7',
    '-40',
    '-4.64901512221888177933694329652570605407690205533971322e+9',
    '-6.39882036256551031436670836219333557645468608100174466e+9',
  ],
  [
    '5',
    '-40',
    '5.46626731306005379393291278335696561257990237372032998e+23',
    '0',
  ],
];

function check(precision: number, cases: [string, string, string, string][]) {
  const ce = new ComputeEngine();
  ce.precision = precision;
  for (const [s, z, re, im] of cases) {
    test(`Gamma(${s}, ${z}) at ${precision} digits is ${re} + ${im}i`, () => {
      const v = ce.expr(['Gamma', { num: s }, { num: z }]).N();
      const [gotRe, gotIm] = parts(v);
      // within one unit of the last digit, allowing the rounding of the reference
      expect(digits(gotRe, re)).toBeGreaterThan(precision - 1.5);
      expect(digits(gotIm, im)).toBeGreaterThan(precision - 1.5);
    });
  }
}

describe('Gamma(s, z) at a negative real z, big decimals', () => {
  check(30, at30);
  check(50, at50);
});

describe('Gamma(s, z) at z < 0, every route', () => {
  const ce = new ComputeEngine();
  ce.precision = 30;

  test('the positive integer orders are real', () => {
    const v = ce.expr(['Gamma', 3, -2]).N();
    expect(v.type.toString()).toMatch(/^real/);
    expect(v.im).toBe(0);
    // Γ(3, −2) = 2 e² (1 − 2 + 2) = 2e²
    expect(
      digits(parts(v)[0], '14.77811219786130045446085492115')
    ).toBeGreaterThan(28);
  });

  test('Gamma(2, -1) is exactly 0', () => {
    expect(ce.expr(['Gamma', 2, -1]).N().toString()).toBe('0');
  });

  test('a non-integer order is complex, on the principal branch', () => {
    const v = ce.expr(['Gamma', 0.5, -2.5]).N();
    expect(v.type.toString()).toBe('complex');
    expect(v.im).toBeLessThan(0);
  });

  test('evaluate of a float operand, and the exact operand through N()', () => {
    const a = ce.expr(['Gamma', 0.5, -2.5]).evaluate();
    const b = ce.expr(['Gamma', ['Rational', 1, 2], ['Rational', -5, 2]]).N();
    expect(
      digits(parts(a)[1], '-9.873508238877278041372552934387261')
    ).toBeGreaterThan(28);
    expect(
      digits(parts(b)[1], '-9.873508238877278041372552934387261')
    ).toBeGreaterThan(28);
  });

  test('a symbolic operand substituted afterwards', () => {
    const v = ce.expr(['Gamma', 0.5, 'x']).subs({ x: -3 }).N();
    expect(
      digits(parts(v)[1], '-14.62617138401909168508292906474')
    ).toBeGreaterThan(28);
  });

  test('Gamma(a, z0, z1) is the difference of two values', () => {
    const v = ce.expr(['Gamma', 2.5, -1, 2]).N();
    expect(
      digits(parts(v)[0], '0.5989795741360222846566403013071')
    ).toBeGreaterThan(28);
    expect(
      digits(parts(v)[1], '-0.8348367046312497955259291446092')
    ).toBeGreaterThan(28);
  });

  test('an unprovable symbolic operand stays unevaluated', () => {
    expect(ce.expr(['Gamma', 's', -2]).N().toString()).toBe('Gamma(s, -2)');
  });

  test('past the budget it stays unevaluated, not a double', () => {
    // order past the cap
    expect(ce.expr(['Gamma', 20000.5, -1]).N().toString()).toBe(
      'Gamma(20000.5, -1)'
    );
    const fifty = new ComputeEngine();
    fifty.precision = 50;
    expect(fifty.expr(['Gamma', 0.5, -100000]).N().operator).toBe('Gamma');
  });

  test('machine precision is unchanged', () => {
    const machine = new ComputeEngine();
    machine.precision = 'machine';
    const v = machine.expr(['Gamma', 0.5, -2.5]).N();
    expect(v.re).toBeCloseTo(1.7724538509055154, 12);
    expect(v.im).toBeCloseTo(-9.87350823887728, 12);
  });

  test('the compiled form of a symbolic z still declines', () => {
    expect(() =>
      compile(ce.expr(['Gamma', 's', 'z']), {
        to: 'interval-js',
        fallback: false,
      } as never)
    ).toThrow();
  });
});
