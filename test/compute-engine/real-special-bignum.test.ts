import { ComputeEngine } from '../../src/compute-engine';
import { BigDecimal } from '../../src/big-decimal';

// SinIntegral, CosIntegral, SinhIntegral, CoshIntegral, AiryAiPrime and
// AiryBiPrime of a real argument above machine precision:
// the digits asked for, or the call stays unevaluated, never a double.
//
// The golden rows are mpmath 1.3.0 at 140 digits, rounded to 100 (`si`, `shi`,
// `ci`, `chi`, `airyai` and `airybi` with `derivative=1`). `.N()` at 30, 50
// and 100 digits must agree with each to a relative 10^-(p-1). Measured over
// a grid of 390 values (x from ±1e-10 to ±100 for the integrals, −30 to 10 for
// the Airy derivatives, at 30, 50 and 100 digits, for
// a float and an exact operand), the largest error is 0.45 of that bound.

const ce = new ComputeEngine();

const operand = (s: string): unknown =>
  /^-?\d+$/.test(s) ? Number(s) : { num: s };

function relativeError(actual: string, expected: string) {
  BigDecimal.precision = 200;
  const e = new BigDecimal(expected);
  return new BigDecimal(actual).sub(e).abs().div(e.abs());
}

const agrees = (value: any, expected: string, digits: number) =>
  relativeError((value.bignumRe ?? value.re).toString(), expected).lte(
    new BigDecimal(`1e-${digits - 1}`)
  );

const GOLDEN: [string, string[], string][] = [
  [
    'SinIntegral',
    ['1e-10'],
    '0.00000000009999999999999999999994444444444444444444446111111111111111111110827664399092970521541980732622267014',
  ],
  [
    'SinIntegral',
    ['0.7'],
    '0.6812222391166113108895068114539425159765428992140869854478526648069727568399794244293947676141967375',
  ],
  [
    'SinIntegral',
    ['-3'],
    '-1.848652527999468256397730251111973245164512730309465694979723072435605912718515020049181788126173506',
  ],
  [
    'SinIntegral',
    ['30'],
    '1.56675654003035111098373130900679816652349501145615463736473190466250565538924227446507601919134754',
  ],
  [
    'SinIntegral',
    ['100'],
    '1.56222546688905629335234513880450267722782498054108345638431169270916087090904049018240735245593476',
  ],
  [
    'SinIntegral',
    ['-100'],
    '-1.56222546688905629335234513880450267722782498054108345638431169270916087090904049018240735245593476',
  ],
  [
    'SinhIntegral',
    ['1e-10'],
    '0.0000000001000000000000000000000555555555555555555555722222222222222222222250566893424036281179141383919823073',
  ],
  [
    'SinhIntegral',
    ['0.7'],
    '0.7193380189288998424191212591275057531383901546946966263077691949752453104240619166442751193582453266',
  ],
  [
    'SinhIntegral',
    ['-3'],
    '-4.973440475859806797710418382522705142969565328533902860435016548191677696883496353124500238952201689',
  ],
  [
    'SinhIntegral',
    ['30'],
    '184486604703.6370985320031659661988788428243358565487784960208485190783366713905904066883014034437535',
  ],
  [
    'SinhIntegral',
    ['100'],
    '135777637242693991095700732115541270514789.6967095810493124872466827279952622652450656077778705762361',
  ],
  [
    'CosIntegral',
    ['1e-10'],
    '-22.44863526503892397957590245676123964496885450868113949486084510835567318481067494623780880043492406',
  ],
  [
    'CosIntegral',
    ['0.6165054856207162'],
    '-0.00000000000000004472822297326092890197457033173811568678687538186180661939902114449517843105594577425043507255273586',
  ],
  [
    'CosIntegral',
    ['0.7'],
    '0.1005147070088978326891358928102861564556872335539467447913939329000999204371869870863057916207460102',
  ],
  [
    'CosIntegral',
    ['3'],
    '0.1196297860080003276264722811766778505468365249870718971038261126757762890096713114279671247503315067',
  ],
  [
    'CosIntegral',
    ['30'],
    '-0.03303241728207114377922644096300371415468212987200434447920906863141017648789853844831636535915030604',
  ],
  [
    'CosIntegral',
    ['100'],
    '-0.005148825142610492144443553905344497850326337919323245803644176679551342795676441252863637110864097696',
  ],
  [
    'CoshIntegral',
    ['1e-10'],
    '-22.4486352650389239795709024567612396449688545086811394948608451078927102218477119832748458374719611',
  ],
  [
    'CoshIntegral',
    ['0.7'],
    '0.3455691756953906981525023336192535593755269567773728021741266479566792297617210081686494692953556094',
  ],
  [
    'CoshIntegral',
    ['3'],
    '4.960392094765609760297917636694060120021087694453679259258017517050818531449201090062687159949886161',
  ],
  [
    'CoshIntegral',
    ['30'],
    '184486604703.6370985320031629446468681540117910407237333423229273517207815715166748440440958425882304',
  ],
  [
    'CoshIntegral',
    ['100'],
    '135777637242693991095700732115541270514789.6967095810493124872466827279952622652450656074095108000679',
  ],
  [
    'AiryAiPrime',
    ['-30'],
    '1.228620602637485134704127610858150079455556553150309107574290033704738261588943817431562756726367009',
  ],
  [
    'AiryAiPrime',
    ['-10'],
    '0.9962650441327900559045725412889096589048403914374213126400586914124602958750581318099440450280772629',
  ],
  [
    'AiryAiPrime',
    ['-3'],
    '0.3145837692165988136507872660658502917019396081972015056106707639489412122295335704615966897690660662',
  ],
  [
    'AiryAiPrime',
    ['-0.7'],
    '-0.1446412856433210274017203575399281413003965007610960798608861144759727028565553361808343742367501246',
  ],
  [
    'AiryAiPrime',
    ['0.7'],
    '-0.1998511915822804751715693872186328803271933190538871207262758688296653731431213053361815429125628883',
  ],
  [
    'AiryAiPrime',
    ['3'],
    '-0.01191297670595131847376323259302228726038687543148317450136221470093939984267220723478333269235850781',
  ],
  [
    'AiryAiPrime',
    ['10'],
    '-0.0000000003520633676738923636620644825279347270308147398059718113475900639379316408816359364012197026072226707',
  ],
  [
    'AiryBiPrime',
    ['-30'],
    '-0.4836947258276814927724987693162813207070335533541248864955200071073948660814108507674857358904524153',
  ],
  [
    'AiryBiPrime',
    ['-10'],
    '0.1194141133999092382775253366815218245364202395163026324357855886370670958905417240109543305945099007',
  ],
  [
    'AiryBiPrime',
    ['-3'],
    '-0.6756112226852585376680320451823026140880841533497405059709487493750455629446238134221016752237605554',
  ],
  [
    'AiryBiPrime',
    ['-0.7'],
    '0.5449991200691819066568710101304835640831693284760526837908166322873477801254791906321357138508441193',
  ],
  [
    'AiryBiPrime',
    ['0.7'],
    '0.6544059191721400302853950059549742185201381249619728538188620464202714021551158863649012427609300088',
  ],
  [
    'AiryBiPrime',
    ['3'],
    '22.92221496638217018510473104330786656904612035685250362444284025278107981767992155163700477723192633',
  ],
  [
    'AiryBiPrime',
    ['10'],
    '1429236134.48286577611883144781389316048552735369949925806664268285095234265670600907662813198281086',
  ],
];

afterEach(() => {
  ce.precision = 'machine';
});

describe('REAL SPECIAL FUNCTIONS AT ARBITRARY PRECISION (mpmath golden table)', () => {
  for (const digits of [30, 50, 100]) {
    for (const [head, args, expected] of GOLDEN) {
      test(`N(${head}(${args.join(', ')}), ${digits}) = ${expected.slice(0, 12)}…`, () => {
        ce.precision = digits;
        const value = ce.expr([head, ...args.map(operand)] as any).N();
        expect(value.isNumberLiteral).toBe(true);
        expect(agrees(value, expected, digits)).toBe(true);
      });
    }
  }
});

describe('REAL SPECIAL FUNCTIONS: ROUTES AND OPERANDS', () => {
  const SI_07 = '0.681222239116611310889506811454';
  const AI_PRIME_07 = '-0.199851191582280475171569387219';

  test('evaluate() of a float operand has the digits asked for', () => {
    ce.precision = 30;
    expect(
      ce
        .expr(['SinIntegral', { num: '0.7' }])
        .evaluate()
        .toString()
    ).toBe(SI_07);
    expect(
      ce
        .expr(['AiryAiPrime', { num: '0.7' }])
        .evaluate()
        .toString()
    ).toBe(AI_PRIME_07);
    expect(
      ce
        .expr(['CosIntegral', { num: '0.7' }])
        .evaluate()
        .toString()
    ).toBe('0.10051470700889783268913589281');
  });

  test('an exact operand: evaluate() leaves it, N() has the digits', () => {
    ce.precision = 30;
    for (const head of [
      'SinIntegral',
      'SinhIntegral',
      'CosIntegral',
      'CoshIntegral',
      'AiryAiPrime',
      'AiryBiPrime',
    ]) {
      const e = ce.expr([head, ['Rational', 7, 10]] as any);
      expect(e.evaluate().isSame(e)).toBe(true);
      expect(e.N().toString()).toBe(
        ce
          .expr([head, { num: '0.7' }] as any)
          .N()
          .toString()
      );
    }
    expect(
      ce
        .expr(['SinIntegral', ['Rational', 7, 10]])
        .N()
        .toString()
    ).toBe(SI_07);
  });

  test('a float operand gives a float', () => {
    ce.precision = 30;
    for (const head of [
      'SinIntegral',
      'SinhIntegral',
      'CosIntegral',
      'CoshIntegral',
      'AiryAiPrime',
      'AiryBiPrime',
    ])
      expect(ce.expr([head, { num: '0.7' }] as any).N().isExact).toBe(false);
  });

  test('parsed from LaTeX', () => {
    ce.precision = 30;
    expect(ce.parse('\\operatorname{SinIntegral}(0.7)').N().toString()).toBe(
      SI_07
    );
    expect(ce.parse("\\operatorname{Ai}'(0.7)").N().toString()).toBe(
      AI_PRIME_07
    );
    expect(ce.parse("\\operatorname{Bi}'(0.7)").N().toString()).toBe(
      '0.654405919172140030285395005955'
    );
  });

  test('Ai′(0) and Bi′(0) at 30 digits', () => {
    ce.precision = 30;
    expect(ce.expr(['AiryAiPrime', 0]).N().toString()).toBe(
      '-0.258819403792806798405183560189'
    );
    expect(ce.expr(['AiryBiPrime', 0]).N().toString()).toBe(
      '0.448288357353826357914823710399'
    );
  });

  test('a negative argument of Ci and Chi is the principal value f(−x) = f(x) + iπ', () => {
    ce.precision = 30;
    const ci: any = ce.expr(['CosIntegral', { num: '-3' }]).N();
    expect(String(ci.bignumRe)).toBe('0.119629786008000327626472281177');
    expect(String(ci.bignumIm)).toBe('3.14159265358979323846264338328');
    const chi: any = ce.expr(['CoshIntegral', { num: '-3' }]).N();
    expect(String(chi.bignumRe)).toBe('4.96039209476560976029791763669');
    expect(String(chi.bignumIm)).toBe('3.14159265358979323846264338328');
  });
});

describe('REAL SPECIAL FUNCTIONS: DECLINES', () => {
  test('past the argument cap the call stays unevaluated, not a double', () => {
    ce.precision = 30;
    for (const [head, x] of [
      ['SinIntegral', '1001.5'],
      ['SinhIntegral', '1001.5'],
      ['CosIntegral', '1001.5'],
      ['CoshIntegral', '1001.5'],
      ['SinIntegral', '-1001.5'],
      ['AiryAiPrime', '10001.5'],
      ['AiryBiPrime', '200.5'],
    ])
      expect(ce.expr([head, { num: x }] as any).N().isNumberLiteral).toBe(
        false
      );
  });

  test('just inside the cap the value has the digits', () => {
    ce.precision = 30;
    expect(
      ce
        .expr(['SinIntegral', { num: '700.5' }])
        .N()
        .toString()
    ).toBe('1.57221968928735344545503371732');
  });
});

describe('REAL SPECIAL FUNCTIONS: MACHINE PRECISION IS UNCHANGED', () => {
  test('the double kernels answer', () => {
    ce.precision = 'machine';
    expect(ce.expr(['SinIntegral', 0.7]).N().re).toBe(0.6812222391166113);
    expect(ce.expr(['CosIntegral', 0.7]).N().re).toBeCloseTo(
      0.10051470700889783,
      15
    );
    expect(ce.expr(['AiryAiPrime', 0.7]).N().re).toBeCloseTo(
      -0.19985119158228048,
      15
    );
    expect(ce.expr(['SinIntegral', 2000]).N().isNumberLiteral).toBe(true);
  });
});
