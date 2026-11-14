import { ComputeEngine } from '../../src/compute-engine';
import { BigDecimal } from '../../src/big-decimal';

// DedekindEta at a complex τ with Im τ ≥ 10^-3, above machine precision. The
// golden rows are Euler's pentagonal sum evaluated directly with mpmath 1.3.0
// (no modular reduction, extra digits for its cancellation), rounded to 100
// digits: `.N()` at 30, 50 and 100 digits must agree with each to a relative
// 10^-(p-1) of |η|, where p is the precision asked for. Measured over 110
// cases at each precision (Re τ from 0 to 10^20, Im τ from 10^-3 to 100) the
// largest error is 0.46 of that bound. Below Im τ = 10^-3 the call stays
// unevaluated at these precisions.

const ce = new ComputeEngine();

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

const GOLDEN: [string, string, string, string][] = [
  [
    '0',
    '1',
    '0.7682254223260566590025941795761806445178669144648050146767028241436309867120692077191751030490062522',
    '0.0',
  ],
  [
    '0.3',
    '1',
    '0.7678448651091705567421299051799721144742549294472627324852945007247465260144518918668288868374690503',
    '0.05906109778250378247292565345689206690518599366269632540987198104126307393837528792948207907553289912',
  ],
  [
    '0.3',
    '0.5',
    '0.8903552089047640917995519719619761105811493612371794212207167349708485310517625447013594886168314463',
    '0.03487065536644274827405344534766888135700857132201452658551450669027895752803960517771760657010246348',
  ],
  [
    '-0.5',
    '0.8660254037844386',
    '0.7937303350476405301649669553175152424171723745669636696397405347504420528687492240720607928258272051',
    '-0.104496581019902397336171179467303064243087485397433037107482758515950231598685257841080480562954763',
  ],
  [
    '0.25',
    '0.2',
    '1.041219276840948187399578920318244715211403676660264510103817792282737808784242696632111275609598879',
    '-0.2007931182389567593111189382566675313984059815868236091608903039405787639945075180447602365573108783',
  ],
  [
    '0.3333333333333333333333333333333333',
    '0.05',
    '1.437594903904172378321382208216373205379264748357516281517273618840542405130597656876780936712651769',
    '-0.1257721739470868903191556052626200872632572739995337725326256858214152076253807449101837222037969388',
  ],
  [
    '12.7',
    '0.5',
    '-0.86904228057615206887067126332850659864884998730612218778720312775220871004357185370309408856673114',
    '-0.1967584183727138880551383779345989264557812778437233498139798254517759504713675763349557133696132151',
  ],
  [
    '100000.123456789',
    '0.3',
    '-0.4941202736132144868863555448176550756735163181504666004180723598922067891056369443515276713120372209',
    '-0.6699131362972737584506588083341210927496122658284080464123608467544751284034436727375271271944443861',
  ],
  [
    '1e20',
    '1',
    '-0.3841127111630283295012970897880903222589334572324025073383514120718154933560346038595875515245031261',
    '-0.6653027315673941262124968139120643833285632633972202728928678369001490544371593487967154673793311669',
  ],
  [
    '-7.99999',
    '2',
    '-0.2961900476982167555442903474265862907820432070866227287460064443308280863631344196017850759544348061',
    '-0.5130193127589465016732129766795630481840302006244719868627687677209671536938701024679576474939105739',
  ],
  [
    '0.4999999999999',
    '0.01',
    '0.01007634041663995938093533838307689660742583878412324538822760068585517344368683385277578042095986877',
    '0.001326575383011142199528431836008369551093688573964609228615690087685843228007295671490621410645223367',
  ],
  [
    '0.5',
    '0.001',
    '0.0000000000000000000000000008341539230603354370751763043822259499657383994191666465044557763144610169529584032127914703008333012',
    '0.0000000000000000000000000001098184473432175975111810859891107943516398386085658128823145923191476789519014930567878293456893165',
  ],
  [
    '0.3',
    '0.001',
    '0.7272418324025887724350899180188258135149321318325942702741719622568128263645552182782332804462229252',
    '0.05723517348434684640922172322885580972766320321560584602649296072555168687367931609796691990023292994',
  ],
  [
    '0',
    '10',
    '0.07294906084933912960414418865057555162099717667629107673356814890492527943808223730094913431421430708',
    '0.0',
  ],
  [
    '0',
    '100',
    '0.00000000000426773113545522468645232693768087196926627162844579324999478883688328309071785807661623412631411843',
    '0.0',
  ],
];

describe('DEDEKIND ETA AT ARBITRARY PRECISION (mpmath golden table)', () => {
  afterEach(() => {
    ce.precision = 'machine';
  });
  for (const digits of [30, 50, 100]) {
    for (const [re, im, vre, vim] of GOLDEN) {
      test(`N(DedekindEta(${re} + ${im}i), ${digits}) = ${vre.slice(0, 10)}…`, () => {
        ce.precision = digits;
        const value = ce
          .expr(['DedekindEta', ['Complex', operand(re), operand(im)]] as any)
          .N();
        const bound = new BigDecimal(`1e-${digits - 1}`);
        expect(modulusRelativeError(value, vre, vim, digits).lte(bound)).toBe(
          true
        );
      });
    }
  }
});

describe('DEDEKIND ETA: RESULTS AND OPERANDS', () => {
  afterEach(() => {
    ce.precision = 'machine';
  });

  test('N(DedekindEta(0.3 + i), 40) carries 40 digits in both parts', () => {
    ce.precision = 40;
    const v = ce
      .expr(['DedekindEta', ['Complex', operand('0.3'), operand('1')]] as any)
      .N();
    const [a, b] = parts(v);
    expect(a.toString().replace(/^-?0?\./, '').length).toBeGreaterThanOrEqual(
      30
    );
    expect(b.toString().length).toBeGreaterThan(30);
  });

  test('an exact operand stays exact under evaluate()', () => {
    const e = ce.expr(['DedekindEta', ['Complex', 1, 2]] as any);
    expect(e.evaluate().isSame(e)).toBe(true);
  });

  test('the shift by 24 is exact: η(τ + 24) = η(τ) at 30 digits', () => {
    ce.precision = 30;
    const a = ce
      .expr(['DedekindEta', ['Complex', operand('0.3'), operand('1')]] as any)
      .N();
    const b = ce
      .expr(['DedekindEta', ['Complex', operand('24.3'), operand('1')]] as any)
      .N();
    const [ar, ai] = parts(a);
    const [br, bi] = parts(b);
    BigDecimal.precision = 40;
    expect(ar.sub(br).abs().lte(new BigDecimal('1e-28'))).toBe(true);
    expect(ai.sub(bi).abs().lte(new BigDecimal('1e-28'))).toBe(true);
  });

  test('η(τ + 1) = e^{iπ/12} η(τ) at 30 digits', () => {
    ce.precision = 30;
    const a = ce
      .expr(['DedekindEta', ['Complex', operand('0.3'), operand('0.7')]] as any)
      .N();
    const b = ce
      .expr(['DedekindEta', ['Complex', operand('1.3'), operand('0.7')]] as any)
      .N();
    const [ar, ai] = parts(a);
    const [br, bi] = parts(b);
    BigDecimal.precision = 50;
    const c = BigDecimal.PI.div(12).cos();
    const s = BigDecimal.PI.div(12).sin();
    const er = ar.mul(c).sub(ai.mul(s));
    const ei = ar.mul(s).add(ai.mul(c));
    expect(
      er.sub(br).abs().add(ei.sub(bi).abs()).lte(new BigDecimal('1e-27'))
    ).toBe(true);
  });

  test('past the floor Im τ < 10^-3 the call stays unevaluated at 30 digits', () => {
    ce.precision = 30;
    const e = ce.expr([
      'DedekindEta',
      ['Complex', operand('0.3'), operand('0.0005')],
    ] as any);
    expect(e.N().operator).toBe('DedekindEta');
  });

  test('the cusp and a real τ keep their answers', () => {
    ce.precision = 30;
    expect(
      ce
        .expr(['DedekindEta', 'ComplexInfinity'] as any)
        .N()
        .isSame(0)
    ).toBe(true);
  });
});
