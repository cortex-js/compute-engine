import { ComputeEngine } from '../../src/compute-engine';
import { BigDecimal } from '../../src/big-decimal';

// JacobiTheta above machine precision (CE-1395). The golden rows are
// `mpmath.jtheta(j, π·z, e^{iπτ})` of mpmath 1.4.1 at 140 digits, rounded to
// 100 digits; three of them (the large Im z, the τ with Im τ = 0.05 and the
// negative Re τ) were checked against the series summed directly at 400
// digits. `.N()` at 30, 50 and 100 digits must agree with each to a relative
// 10^-(p-1) of |θⱼ|, where p is the precision asked for.

const ce = new ComputeEngine();

// The helpers below set the global `BigDecimal.precision`: restore it
const savedBigDecimalPrecision = BigDecimal.precision;
afterEach(() => {
  BigDecimal.precision = savedBigDecimalPrecision;
});

const operand = (s: string) => ({ num: s });

function parts(value: any): [BigDecimal, BigDecimal] {
  return [
    value.bignumRe ?? new BigDecimal(value.re),
    value.bignumIm ?? new BigDecimal(value.im),
  ];
}

function modulusRelativeError(
  value: any,
  re: string,
  im: string,
  digits: number
): BigDecimal {
  BigDecimal.precision = digits + 30;
  const [a, b] = parts(value);
  const gr = new BigDecimal(re);
  const gi = new BigDecimal(im);
  const modulus = gr.mul(gr).add(gi.mul(gi)).sqrt();
  return a.sub(gr).abs().add(b.sub(gi).abs()).div(modulus);
}

const theta = (j: number, x: string, y: string, a: string, b: string) =>
  ce.expr([
    'JacobiTheta',
    j,
    ['Complex', operand(x), operand(y)],
    ['Complex', operand(a), operand(b)],
  ] as any);

// [j, Re z, Im z, Re τ, Im τ, Re θ, Im θ]
const GOLDEN: [number, string, string, string, string, string, string][] = [
  [
    3,
    '0',
    '0',
    '0',
    '1',
    '1.086434811213308014575316121510223457070205707245218885920790315981856732267109795960561618489679764',
    '0.0',
  ],
  [
    3,
    '0.5',
    '0',
    '0',
    '0.5',
    '0.587974282891712058733172458782209941559121258914910727751165723036471068810808539316074360451040298',
    '0.0',
  ],
  [
    1,
    '0.3',
    '0.7',
    '0.25',
    '0.9',
    '1.963823824413496011874695679504453777495635122373548798602652256944925578517134059671756655273466547',
    '2.625513081721062458770722120888804771034082954454589388638193362830748900281231098674040509823570508',
  ],
  [
    2,
    '0.3',
    '0.1',
    '0.1',
    '0.01',
    '20.38400414290554429321539559495905857267508792396221915239637808984494877436240844116198302213745078',
    '33.39699282729399716014302064562765799925085540147910017946573266430279578164025583206489001919341056',
  ],
  [
    4,
    '1000.3',
    '2',
    '17.5',
    '0.5',
    '15285529953.16097669188232028607563899047741705110680313831764789323669371746529264664952458783829775',
    '-81230055070.81926445952129537373617493813528220383054553417242304121691644398206512082932124791074987',
  ],
  [
    3,
    '0.2',
    '5',
    '0',
    '0.3',
    '-3.001455494598926231288822532409256051539660275414009176227836140307311739173131188650716372093027728e+113',
    '-5.179297595247922521038223998805681225996942756864723010484914364388503420774921665135650347455071595e+113',
  ],
  [
    1,
    '1e-25',
    '0',
    '0',
    '1',
    '0.0000000000000000000000002848694603987787316079985057120911720742964530321089881905022818754579803256699367314136952364898266',
    '0.0',
  ],
  [
    4,
    '0.125',
    '-0.4',
    '-3.75',
    '2',
    '0.9998487322980251425715252275655912223458984111372628693864042631477682766561761559292258207391837952',
    '-0.02305411261652166742586714927411108892914416525564264631757863969261075326723794667403567054400772105',
  ],
  [
    2,
    '0.7',
    '0',
    '0.5',
    '0.05',
    '-2.496864740608496296692388352138508971005228730195723052956012571287896502934384344330640360665152483',
    '-1.03423523897121917076530578107147510993279850191464842639701638277731633423108214432668812752073603',
  ],
];

describe('JACOBI THETA AT ARBITRARY PRECISION (mpmath golden table)', () => {
  afterEach(() => {
    ce.precision = 'machine';
  });
  for (const digits of [30, 50, 100]) {
    for (const [j, x, y, a, b, vre, vim] of GOLDEN) {
      test(`N(JacobiTheta(${j}, ${x} + ${y}i, ${a} + ${b}i), ${digits}) = ${vre.slice(0, 10)}…`, () => {
        ce.precision = digits;
        const value = theta(j, x, y, a, b).N();
        const bound = new BigDecimal(`1e-${digits - 1}`);
        expect(modulusRelativeError(value, vre, vim, digits).lte(bound)).toBe(
          true
        );
      });
    }
  }
});

describe('JACOBI THETA ABOVE MACHINE PRECISION: RESULTS AND OPERANDS', () => {
  afterEach(() => {
    ce.precision = 'machine';
  });

  test('the witness: N(JacobiTheta(3, 0, i)) at 30 digits', () => {
    ce.precision = 30;
    const v = ce.expr(['JacobiTheta', 3, 0, ['Complex', 0, 1]] as any).N();
    expect(v.toString()).toBe('1.08643481121330801457531612151');
  });

  test('a zero whose terms are all exactly 0 is 0', () => {
    ce.precision = 30;
    expect(
      ce
        .expr(['JacobiTheta', 1, 0, ['Complex', 0, 1]] as any)
        .N()
        .isSame(0)
    ).toBe(true);
    expect(
      ce
        .expr(['JacobiTheta', 2, ['Rational', 1, 2], ['Complex', 0, 1]] as any)
        .N()
        .isSame(0)
    ).toBe(true);
  });

  test('a zero that the terms do not give exactly stays unevaluated', () => {
    ce.precision = 30;
    const v = ce
      .expr([
        'JacobiTheta',
        3,
        ['Complex', operand('0.5'), operand('0.5')],
        ['Complex', 0, 1],
      ] as any)
      .N();
    expect(v.operator).toBe('JacobiTheta');
  });

  test('an exact odd integer z longer than the precision keeps its parity', () => {
    // θ₂(z + 1, τ) = −θ₂(z, τ): θ₂(10⁴⁰ + 1, i) = −θ₂(0, i)
    ce.precision = 30;
    const odd = ce
      .expr([
        'JacobiTheta',
        2,
        { num: '10000000000000000000000000000000000000001' },
        ['Complex', 0, 1],
      ] as any)
      .N();
    const zero = ce.expr(['JacobiTheta', 2, 0, ['Complex', 0, 1]] as any).N();
    expect(odd.isSame(zero.neg())).toBe(true);
  });

  test('an exact operand stays exact under evaluate()', () => {
    ce.precision = 30;
    const e = ce.expr(['JacobiTheta', 3, 0, ['Complex', 0, 1]] as any);
    expect(e.evaluate().isSame(e)).toBe(true);
  });

  test('a τ off the upper half-plane stays unevaluated, as at machine precision', () => {
    ce.precision = 30;
    const v = ce.expr(['JacobiTheta', 3, 0, ['Complex', 0, -1]] as any).N();
    expect(v.operator).toBe('JacobiTheta');
  });

  test('θ₃(z, τ + 2) = θ₃(z, τ): a large Re τ costs no digits', () => {
    ce.precision = 30;
    const a = theta(3, '0.3', '0.2', '0.25', '0.7').N();
    const b = theta(3, '0.3', '0.2', '2000000000000.25', '0.7').N();
    const [ar, ai] = parts(a);
    const [br, bi] = parts(b);
    BigDecimal.precision = 40;
    expect(ar.sub(br).abs().lte(new BigDecimal('1e-28'))).toBe(true);
    expect(ai.sub(bi).abs().lte(new BigDecimal('1e-28'))).toBe(true);
  });
});
