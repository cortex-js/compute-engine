import { ComputeEngine } from '../../src/compute-engine';
import { BigDecimal } from '../../src/big-decimal';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

// AiryAi, AiryBi, ExpIntegralEi and LogIntegral of a real argument above
// machine precision. The golden rows are mpmath 1.3.0 at 140 digits (airyai,
// airybi, ei, li), rounded to 100: `.N()` at 30, 50 and 100 digits must agree
// with each to a relative 10^-(p-1), where p is the precision asked for.
// Measured over a grid of 525 cases, arguments 10^-30 to 10^4 (both signs for
// the Airy functions and Ei, next to their zeros too), the largest error is
// 0.46 of that bound.

const ce = new ComputeEngine();

function operand(s: string): unknown {
  return /^-?\d+$/.test(s) ? Number(s) : { num: s };
}

function relativeError(actual: string, expected: string, digits: number) {
  BigDecimal.precision = digits + 30;
  const e = new BigDecimal(expected);
  return new BigDecimal(actual).sub(e).abs().div(e.abs());
}

const GOLDEN: [string, string, string][] = [
  [
    'AiryAi',
    '0',
    '0.3550280538878172392600631860041831763979791741991772405833265103008100424501267129571742460540402717',
  ],
  [
    'AiryAi',
    '0.5',
    '0.2316936064808334897691252545099217396183864753577499817922638265232339844931838503861302580597311124',
  ],
  [
    'AiryAi',
    '1',
    '0.1352924163128814155241474235154663061749441429883307060091020547576335348022657236634871099087486832',
  ],
  [
    'AiryAi',
    '-2.5',
    '-0.1123250676929660891874631001401957860150955656417713048617075969792819045798362105153320893796889516',
  ],
  [
    'AiryAi',
    '10',
    '0.0000000001104753255289868593355020565799224106876541668522205287525715187800942427004343983421671401420256268',
  ],
  [
    'AiryAi',
    '199',
    '1.248259650958874373158443466375870864964559433307437366047719132405707427274064451112324034369849805e-814',
  ],
  [
    'AiryAi',
    '-7.5',
    '0.3217757163806478752673285436797523699195244820031479539944778684979888175016649738468943408642791876',
  ],
  [
    'AiryAi',
    '-100',
    '0.1767533932395528780908310879654717000698993679103734768463025339116133129222639950367483145712741477',
  ],
  [
    'AiryAi',
    '-5000',
    '0.06315013109567222635692435033627698460435030543189442787830183956030720335553196768329538390759352932',
  ],
  [
    'AiryAi',
    '5000',
    '2.16068045310764117910447041863323984100830840287027141841129595598615966484905393730681846290893409e-102366',
  ],
  [
    'AiryAi',
    '-2.338107410459767038489197252446735',
    '3.089805132579913246922369848942454206150421378599502648540361842376548787554555671192671420735106417e-34',
  ],
  [
    'AiryAi',
    '-7.944133587120853123138280555798269',
    '-4.432198461389977764502333482150696830846482024691955594353779224749800739873562923592831142712703632e-34',
  ],
  [
    'AiryAi',
    '0.00001',
    '0.3550254656937793703632057659682957944098129132609346011109979833240966765174341699529720300025801299',
  ],
  [
    'AiryBi',
    '0',
    '0.6149266274460007351509223690936135535947281886485965050408787530142965193055206405293873433452675692',
  ],
  [
    'AiryBi',
    '0.5',
    '0.8542770431031554933000487987952431808567874005047396269340087415514085646293252655590229480643045376',
  ],
  [
    'AiryBi',
    '-2.5',
    '-0.4324224718407052930284195036923072291236576121023132100526877461239426111357906831894358778866411208',
  ],
  [
    'AiryBi',
    '10',
    '455641153.5482251409997873081064939952506193457960162913392138873489804872824053332686729551178338507',
  ],
  [
    'AiryBi',
    '60',
    '7.382584191543098789454986264253278094970845676267189271872062503891390449644376859215855247942883555e+133',
  ],
  [
    'AiryBi',
    '-1000',
    '-0.08326457411708063301147756319017714765486368705859595857575709393775678275639506331136956868800122105',
  ],
  [
    'AiryBi',
    '-4.830737841662015932667709339905178',
    '1.481190709085977622437012916760410399648521807886321666877515556884570492928740600305753789153581708e-34',
  ],
  [
    'AiryBi',
    '-5000',
    '-0.02266368291737499372492235708910127181976656148372316742960361278881930985574836904199669919561982981',
  ],
  [
    'ExpIntegralEi',
    '0.5',
    '0.454219904863173579920523812662802365281405554352642045162817786688152896926662256136179658571437314',
  ],
  [
    'ExpIntegralEi',
    '1',
    '1.895117816355936755466520934331634269017060581732707591646228431882513834533804153548900710126138957',
  ],
  [
    'ExpIntegralEi',
    '-1',
    '-0.21938393439552027367716377546012164903104729340690820757797861307356869855914154472221025103513725',
  ],
  [
    'ExpIntegralEi',
    '0.3725074107813666',
    '-0.0000000000000001342713549323502934346691279781348536192395182444932090447575532001608252088977591582693801299071865',
  ],
  [
    'ExpIntegralEi',
    '40',
    '6039718263611241.578359231418510691293702888585230048137415396016992413269418521392371551794662975992',
  ],
  [
    'ExpIntegralEi',
    '-40',
    '-0.0000000000000000001036773261451656972150641889145259771281024613424501804264575577024473348072537678706255766031744505',
  ],
  [
    'ExpIntegralEi',
    '-41',
    '-0.00000000000000000003723166776459977716235516016523522486013235576332889592183586438799505273563158952876477336239390128',
  ],
  [
    'ExpIntegralEi',
    '-1000',
    '-5.070893060235166549927200999685925144667228537492169335568595889541647077372102147748982895321089425e-438',
  ],
  [
    'ExpIntegralEi',
    '300',
    '6.496482508088665789025691894934247269238089700566375975103097903566612356623933462818335162331672651e+127',
  ],
  [
    'ExpIntegralEi',
    '0.00001',
    '-10.93569980004369550392778546095052948659269428981153262293838007325818451583643051164806565518827775',
  ],
  [
    'LogIntegral',
    '0.5',
    '-0.3786710430610879767272071846365609805512340409782139969444209417345547567266746909858299806907975589',
  ],
  [
    'LogIntegral',
    '2',
    '1.045163780117492784844588889194613136522615578151201575832909144075013205210359530172717405626383356',
  ],
  [
    'LogIntegral',
    '10',
    '6.165599504787297937522981752669522749130602806376581578932338490205589934760180157228276724309143254',
  ],
  [
    'LogIntegral',
    '1.4513692348833810502839684858920274',
    '-1.328645574589565446821747550854790116495092234138310041021893098040062394497826625031668023345661328e-34',
  ],
  [
    'LogIntegral',
    '0.9999999999999999999999',
    '-50.07965638096747218778934991297361013618207341430974854059411325306841024167964544981054700489469359',
  ],
  [
    'LogIntegral',
    '1.0000000000000000000001',
    '-50.07965638096747218778924991297361013618207341430974854059411325306838246390186767203276922711691581',
  ],
  [
    'LogIntegral',
    '1e20',
    '2220819602783663483.54830553206777882394775178178859597768167614636055815907113975766098412384160235',
  ],
  [
    'LogIntegral',
    '1e-100',
    '-4.324245377202094772118703727924900862833977371556509025942495456785404613175862436343676776707559382e-103',
  ],
];

describe('AIRY, EI AND LI AT ARBITRARY PRECISION (mpmath golden table)', () => {
  afterEach(() => {
    ce.precision = 'machine';
  });
  for (const digits of [30, 50, 100]) {
    for (const [head, x, expected] of GOLDEN) {
      test(`N(${head}(${x}), ${digits}) = ${expected.slice(0, 12)}…`, () => {
        ce.precision = digits;
        const value = ce.expr([head, operand(x)] as any).N();
        const got = (value.bignumRe ?? value.re).toString();
        const bound = new BigDecimal(`1e-${digits - 1}`);
        expect(relativeError(got, expected, digits).lte(bound)).toBe(true);
      });
    }
  }
});

describe('AIRY, EI AND LI: RESULTS AND OPERANDS', () => {
  afterEach(() => {
    ce.precision = 'machine';
  });

  test('N(AiryAi(1/3), 30) carries 30 digits', () => {
    ce.precision = 30;
    expect(
      ce
        .expr(['AiryAi', ['Rational', 1, 3]])
        .N()
        .toString()
    ).toBe('0.270682647459345282887346318096');
  });

  test('N(ExpIntegralEi(2), 30) carries 30 digits', () => {
    ce.precision = 30;
    expect(ce.expr(['ExpIntegralEi', 2]).N().toString()).toBe(
      '4.95423435600189016337950513023'
    );
  });

  test('exact operands stay exact under evaluate()', () => {
    for (const call of [
      ['AiryAi', ['Rational', 1, 3]],
      ['AiryBi', 2],
      ['ExpIntegralEi', 2],
      ['LogIntegral', 10],
    ]) {
      const e = ce.expr(call as any);
      expect(e.evaluate().isSame(e)).toBe(true);
    }
  });

  test('a float operand gives a float at 30 digits', () => {
    ce.precision = 30;
    for (const head of ['AiryAi', 'AiryBi', 'ExpIntegralEi', 'LogIntegral']) {
      const v = ce.expr([head, { num: '2.5' }] as any).N();
      expect(v.isExact).toBe(false);
      expect(v.toString().length).toBeGreaterThan(25);
    }
  });

  test('li(x) = Ei(ln x) at 40 digits', () => {
    ce.precision = 40;
    const a = ce.expr(['LogIntegral', 7]).N();
    const b = ce.expr(['ExpIntegralEi', ['Ln', 7]]).N();
    const err = relativeError(
      (a.bignumRe ?? a.re).toString(),
      (b.bignumRe ?? b.re).toString(),
      40
    );
    expect(err.lte(new BigDecimal('1e-37'))).toBe(true);
  });

  test('a call the kernel cannot vouch for stays unevaluated', () => {
    ce.precision = 30;
    // Ei(5000) and Bi(300) are past what the series and the Bessel kernel carry
    expect(ce.expr(['ExpIntegralEi', 5000]).N().toString()).toBe(
      'ExpIntegralEi(5000)'
    );
    expect(ce.expr(['AiryBi', 300]).N().toString()).toBe('AiryBi(300)');
  });

  test('the exceptional points keep their answers', () => {
    ce.precision = 30;
    expect(ce.expr(['ExpIntegralEi', 0]).N().isSame(ce.NegativeInfinity)).toBe(
      true
    );
    expect(ce.expr(['LogIntegral', 1]).N().isSame(ce.NegativeInfinity)).toBe(
      true
    );
    expect(ce.expr(['LogIntegral', 0]).N().isSame(0)).toBe(true);
  });
});

describe('AIRY, EI AND LI: THE COMPILED DOUBLE ROUTE AGREES AT DOUBLE PRECISION', () => {
  for (const head of ['AiryAi', 'AiryBi', 'ExpIntegralEi', 'LogIntegral']) {
    for (const x of [0.75, 3, head === 'LogIntegral' ? 50 : -6.5]) {
      test(`compiled ${head}(${x}) matches the 30-digit value`, () => {
        const f = compile(ce.expr([head, 'x'] as any)) as any;
        expect(f.success).toBe(true);
        const compiled = f.run({ x }) as number;
        ce.precision = 30;
        const exact = ce.expr([head, x] as any).N();
        ce.precision = 'machine';
        const want = exact.bignumRe!.toNumber();
        expect(Math.abs(compiled - want) / Math.abs(want)).toBeLessThan(1e-12);
      });
    }
  }
});
