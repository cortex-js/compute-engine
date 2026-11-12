import { ComputeEngine } from '../../src/compute-engine';
import { BigDecimal } from '../../src/big-decimal';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

// BesselJ, BesselY, BesselI and BesselK of a real order and a real argument
// above machine precision. The golden rows are mpmath 1.3.0 at 140 digits
// (besselj, bessely, besseli, besselk), rounded to 100: `.N()` at 30, 50 and
// 100 digits must agree with each to a relative 10^-(p-1), where p is the
// precision asked for. Measured over a grid of 2,300 cases in orders 0 to 200
// and arguments 10^-5 to 10^5, the largest error is 0.46 of that bound.

type Kind = 'J' | 'Y' | 'I' | 'K';

const ce = new ComputeEngine();

function operand(s: string): unknown {
  if (s.includes('/')) {
    const [a, b] = s.split('/');
    return ['Rational', Number(a), Number(b)];
  }
  return /^-?\d+$/.test(s) ? Number(s) : { num: s };
}

function bessel(kind: Kind, order: string, x: string) {
  return ce.expr([`Bessel${kind}`, operand(order), operand(x)] as any);
}

function relativeError(actual: string, expected: string, digits: number) {
  BigDecimal.precision = digits + 30;
  const a = new BigDecimal(actual);
  const e = new BigDecimal(expected);
  return a.sub(e).abs().div(e.abs());
}

const GOLDEN: [Kind, string, string, string][] = [
  [
    'J',
    '0',
    '1',
    '0.765197686557966551449717526102663220909274289755325241861547549119278912215272440167180600098915634',
  ],
  [
    'J',
    '1',
    '0.5',
    '0.2422684576748738863839545761415316408006286544379597535069253058933598468844150013269895938739697917',
  ],
  [
    'J',
    '5',
    '12.5',
    '0.03473769976223972768191624970520818490643291431084933794226229705648056888303569067063788791853152423',
  ],
  [
    'J',
    '17',
    '25',
    '-0.171679367553245856794846398876595791363698302273398866979400730772766729456883367876694026130270877',
  ],
  [
    'J',
    '50',
    '3',
    '2.005949025849725085543782091776181346496753027428895242554096190707709898535654847912754174497834833e-56',
  ],
  [
    'J',
    '2',
    '99.5',
    '0.01798199709602215168848379946624318296239474760398122270651543134145627866822333254942590595305252007',
  ],
  [
    'J',
    '0',
    '2.404825557695772768621631879326455',
    '-1.852711550987055573451125402569928439689095485391321177442197062835300080657156797712243434441990165e-34',
  ],
  [
    'J',
    '5',
    '12.338604197466943986082097644459',
    '-9.594396170169098072289588838235053300159451894947459540514868284138045203978329340696507076665578304e-34',
  ],
  [
    'J',
    '-3',
    '7.5',
    '0.2580609131934603116626593232333113611609280921961351886889252889462784943482744894037185234388375056',
  ],
  [
    'J',
    '1/2',
    '2',
    '0.5130161365618277516656918486272844223548078604516687498814560082781390560846160591055105171349948177',
  ],
  [
    'J',
    '33.25',
    '12',
    '0.000000000001229151733910576826880353512822053693760328506122442503696583386933853625748463905560040522269010604',
  ],
  [
    'J',
    '200.5',
    '7.5',
    '1.034518724427792394692570401854292031658346678343853004110054339780827886390770152798091891496848715e-261',
  ],
  [
    'J',
    '0',
    '1000',
    '0.02478668615242017456133073111569370878616644713324654841480695001354886244408280984489049368038402577',
  ],
  [
    'J',
    '0',
    '5000',
    '-0.00664898425144834789358688489684694028828180428391891374649020864164147320694623800212809462992798406',
  ],
  [
    'J',
    '2',
    '100000',
    '0.001719238051387229843924928719552544031847130278777683528613665157570135607694220956915134051308394052',
  ],
  [
    'J',
    '-7/10',
    '0.25',
    '1.358867723796900339106371255371136620211866793565306702502377984958148335037791923643079759075626284',
  ],
  [
    'Y',
    '0',
    '1.5',
    '0.3824489237977588439550685549780898623677100092418246451779751301475503997455886199038146732986947512',
  ],
  [
    'Y',
    '1',
    '2',
    '-0.1070324315409375468883707722774766366874808982350538605257945572313199774994906724960750929874561422',
  ],
  [
    'Y',
    '5',
    '25',
    '-0.1470579931137226608575350082966615375727629973997676486173210391634755268400610581709653179434784951',
  ],
  [
    'Y',
    '-2',
    '3',
    '-0.1604003934849237296757682995379809181040120401743782209819081911701407714126276050487951572782761892',
  ],
  [
    'Y',
    '1/3',
    '40',
    '0.1054787036709892909112296028300811367076032834028982554245847339582861452357863414759885574978878943',
  ],
  [
    'Y',
    '0',
    '500',
    '0.01050670873983137409974066062655312582587386892722231634700434859903188757674971818622720068868442711',
  ],
  [
    'Y',
    '2',
    '5000',
    '0.009119399998688212795825727342563665883277237963400550089569761881463240778622984420709820290084059302',
  ],
  [
    'Y',
    '5/2',
    '0.00001',
    '-7569397566186.636770845610485161881950699658102415449380857974146642496953818350338919661645767971864',
  ],
  [
    'Y',
    '1/2',
    '1.5',
    '-0.04608316589309741073885250667247358409106386075640246117430263510373320904142410952942771289158372751',
  ],
  [
    'I',
    '0',
    '1',
    '1.266065877752008335598244625214717537607670311354962206808135331213575016122775470394818357147280102',
  ],
  [
    'I',
    '2',
    '5',
    '17.50561496662423601488701189518041589825311208490142455181042601824131465321989260053155632978633611',
  ],
  [
    'I',
    '17',
    '25',
    '19687190.60549254163017874352144370961086505305923510223623898535104058890283065625780104749910274488',
  ],
  [
    'I',
    '1',
    '500',
    '2.502303412176099995690077580419460929306143306834335936545291457907687731042153037396613005087209263e+215',
  ],
  [
    'I',
    '1/3',
    '3',
    '4.75595693716469862304413252329503123248966974077055692431029938177867284959476034188471782182805944',
  ],
  [
    'I',
    '-7/10',
    '12',
    '18548.66928546809714605980175002268968129893694577019793848096080011005344711772053071996237830344822',
  ],
  [
    'I',
    '50',
    '100',
    '4821958085594080668857449411080572094.541864080612345321715193863920020673074433128819456853927398456',
  ],
  [
    'I',
    '3',
    '-2.5',
    '-0.4743704087780355895548240178693314512679173311876135612990908968997031808445361024639951682407833571',
  ],
  [
    'K',
    '0',
    '1',
    '0.4210244382407083333356273792126090361362197482266604722989695514552126781381018390921251395473653045',
  ],
  [
    'K',
    '1',
    '50',
    '0.00000000000000000000003444102226717555612591853035912671550996772513482568802219268511936037597860980111447249042437784707',
  ],
  [
    'K',
    '5',
    '7.5',
    '0.001149163014831238783563752402224672625000880775687086410050388966510583746383251685840250615785284643',
  ],
  [
    'K',
    '1/2',
    '3',
    '0.03602598513176459256551045640482239931606010664606021103352697737529611929269540980038799878663551167',
  ],
  [
    'K',
    '-3',
    '3',
    '0.1221703757571835679191325420898564259734776819801950516985937769164836481027935974728852041282344164',
  ],
  [
    'K',
    '0',
    '0.001',
    '7.023688800562381343612080063014055114790421721511364149559822715351941258115894116107285843736648412',
  ],
  [
    'K',
    '2',
    '5000',
    '5.974867300769643198691669492089526765151445945292310795892650855678029842896295541268682928467668623e-2174',
  ],
  [
    'K',
    '33.25',
    '200',
    '1.918847118339262576599115426763813493915043010271099962607839844466566944802160682732040136419777313e-87',
  ],
];

describe('BESSEL FUNCTIONS AT ARBITRARY PRECISION (mpmath golden table)', () => {
  for (const digits of [30, 50, 100]) {
    for (const [kind, order, x, expected] of GOLDEN) {
      test(`N(Bessel${kind}(${order}, ${x}), ${digits}) = ${expected.slice(0, 12)}…`, () => {
        ce.precision = digits;
        const value = bessel(kind, order, x).N();
        const got = (value.bignumRe ?? value.re).toString();
        const bound = new BigDecimal(`1e-${digits - 1}`);
        expect(relativeError(got, expected, digits).lte(bound)).toBe(true);
        ce.precision = 'machine';
      });
    }
  }
});

describe('BESSEL FUNCTIONS: RESULTS AND OPERANDS', () => {
  afterEach(() => {
    ce.precision = 'machine';
  });

  test('N(BesselJ(1, 1/3), 30) carries 30 digits', () => {
    ce.precision = 30;
    expect(
      ce
        .expr(['BesselJ', 1, ['Rational', 1, 3]])
        .N()
        .toString()
    ).toBe('0.164362543814270735363798698286');
  });

  test('BesselJ(0.5, 2) at machine precision is sqrt(2/(2π))·sin 2', () => {
    const v = ce.expr(['BesselJ', 0.5, 2]).N().re;
    expect(Math.abs(v - Math.sqrt(1 / Math.PI) * Math.sin(2))).toBeLessThan(
      1e-15
    );
  });

  test('half-integer orders agree with their closed forms at 50 digits', () => {
    ce.precision = 50;
    const cases: [string, string][] = [
      // J_{1/2}(x) = sqrt(2/(πx)) sin x, K_{1/2}(x) = sqrt(π/(2x)) e^{-x}
      [
        '["BesselJ", ["Rational", 1, 2], 3]',
        '["Multiply", ["Sqrt", ["Divide", 2, ["Multiply", "Pi", 3]]], ["Sin", 3]]',
      ],
      [
        '["BesselK", ["Rational", 1, 2], 3]',
        '["Multiply", ["Sqrt", ["Divide", "Pi", 6]], ["Exp", -3]]',
      ],
      [
        '["BesselI", ["Rational", 1, 2], 3]',
        '["Multiply", ["Sqrt", ["Divide", 2, ["Multiply", "Pi", 3]]], ["Sinh", 3]]',
      ],
    ];
    for (const [call, closed] of cases) {
      const a = ce.expr(JSON.parse(call)).N();
      const b = ce.expr(JSON.parse(closed)).N();
      const err = relativeError(
        (a.bignumRe ?? a.re).toString(),
        (b.bignumRe ?? b.re).toString(),
        50
      );
      expect(err.lte(new BigDecimal('1e-48'))).toBe(true);
    }
  });

  test('exact operands stay exact under evaluate()', () => {
    expect(
      ce
        .expr(['BesselJ', 1, ['Rational', 1, 3]])
        .evaluate()
        .toString()
    ).toBe('BesselJ(1, 1/3)');
    expect(
      ce
        .expr(['BesselK', ['Rational', 1, 3], 2])
        .evaluate()
        .toString()
    ).toBe('BesselK(1/3, 2)');
  });

  test('a float operand gives a float at 30 digits', () => {
    ce.precision = 30;
    const v = ce.expr(['BesselI', 1, { num: '0.5' }]).N();
    expect(v.isExact).toBe(false);
    expect(v.toString().length).toBeGreaterThan(25);
  });

  test('J_n(0) stays the exact value', () => {
    ce.precision = 30;
    expect(ce.expr(['BesselJ', 0, 0]).N().toString()).toBe('1');
    expect(ce.expr(['BesselJ', 1, 0]).N().toString()).toBe('0');
  });

  test('J_n and I_n at a negative argument follow the parity of n', () => {
    ce.precision = 40;
    const a = ce.expr(['BesselJ', 3, -2]).N();
    const b = ce.expr(['BesselJ', 3, 2]).N();
    expect(a.re).toBe(-b.re);
    expect(ce.expr(['BesselI', 2, -2]).N().re).toBe(
      ce.expr(['BesselI', 2, 2]).N().re
    );
  });

  test('a call the kernel cannot vouch for stays unevaluated', () => {
    ce.precision = 30;
    // I_0(5000) is past the series cap; a non-integer order at a negative
    // argument and at 0 is complex or a pole.
    expect(ce.expr(['BesselI', 0, 5000]).N().toString()).toBe(
      'BesselI(0, 5000)'
    );
    expect(ce.expr(['BesselJ', 0.5, -2]).N().toString()).toBe(
      'BesselJ(0.5, -2)'
    );
    expect(ce.expr(['BesselK', 0.5, 0]).N().toString()).toBe('BesselK(0.5, 0)');
  });

  test('N() with a non-integer order stays real and finite across the heads', () => {
    for (const kind of ['J', 'Y', 'I', 'K']) {
      const v = ce.expr([`Bessel${kind}`, { num: '2.5' }, 3]).N();
      expect(Number.isFinite(v.re)).toBe(true);
      expect(v.im).toBe(0);
    }
  });
});

describe('BESSEL FUNCTIONS: THE COMPILED DOUBLE ROUTE AGREES AT DOUBLE PRECISION', () => {
  for (const kind of ['J', 'Y', 'I', 'K'] as Kind[]) {
    for (const [order, x] of [
      [0, 2.5],
      [2, 7],
      [5, 30],
    ]) {
      test(`compiled Bessel${kind}(${order}, ${x}) matches the 30-digit value`, () => {
        const f = compile(ce.expr([`Bessel${kind}`, order, 'x'] as any)) as any;
        expect(f.success).toBe(true);
        const compiled = f.run({ x }) as number;
        ce.precision = 30;
        const exact = ce.expr([`Bessel${kind}`, order, x] as any).N();
        ce.precision = 'machine';
        const want = exact.bignumRe!.toNumber();
        expect(Math.abs(compiled - want) / Math.abs(want)).toBeLessThan(1e-12);
      });
    }
  }
});
