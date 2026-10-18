import { ComputeEngine } from '../../src/compute-engine';
import { BigDecimal } from '../../src/big-decimal';
import { bigGammaP } from '../../src/compute-engine/numerics/special-functions';

//
// The upper incomplete gamma Γ(s, z) and the regularized Q(a, z) at a
// precision above the machine precision are computed at that precision
// (`bigIncompleteGammaUpper`, `src/compute-engine/numerics/special-functions.ts`).
//
// Before, `Gamma(s, z)` had no bignum kernel and gave a machine float (about
// 15 correct digits) at any precision. `GammaRegularized(a, z)` had one, but
// at a small z its continued fraction reached its iteration cap: first it
// answered with the unconverged value (Q(−1.5, 0.5) had 136 correct digits
// at precision 500), then with NaN, so that the machine kernel answered
// (Q(−1.5, 0.1) at precision 50, Q(0.5, 3) at precision 300). An older
// version also computed Q as 1 − P where Q is small (Q(1000, 1500) had 28
// correct digits at precision 50, and Q(10⁴, 1.5·10⁴) was negative); the
// tests of that case are also in `gamma-regularized-upper-tail.test.ts`.
//
// The reference values are from mpmath `gammainc` at 160 digits. For
// Γ(−1000, 1500), mpmath `gammainc` gives a wrong value; the reference is
// 1500⁻¹⁰⁰¹ e⁻¹⁵⁰⁰ ∫₀^∞ e^(−u − 1001 ln(1 + u/1500)) du, by mpmath `quad`
// at 60 digits.
//

function value(
  precision: number,
  head: string,
  s: string,
  z: string
): BigDecimal | undefined {
  const ce = new ComputeEngine();
  ce.precision = precision;
  const result = ce.box([head, { num: s }, { num: z }]).N();
  return (result as unknown as { bignumRe?: BigDecimal }).bignumRe;
}

/** The number of correct significant digits of `x` against `reference`. */
function correctDigits(x: BigDecimal | undefined, reference: string): number {
  if (x === undefined) return 0;
  const ref = new BigDecimal(reference);
  const err = x.sub(ref).abs().div(ref.abs());
  if (err.isZero()) return Infinity;
  return -(err.exponent + err._digitCount() - 1);
}

const GAMMA: [string, string, string][] = [
  [
    '2',
    '3',
    '1.991482734714557719173696626002471065267983687536928622705109104242426709207982006162169769465333781056053146035747278034585735469e-1',
  ],
  [
    '0.5',
    '1.5',
    '1.475825132040964187808791180451100799459977255827793348728247303092903697252139544250347184756546960013833079476912504212415340933e-1',
  ],
  [
    '3.5',
    '0.25',
    '3.321511433839550419769149548346097017371022165996385461322040390125689044244579201432796863839964507538395330928940080980307286789',
  ],
  [
    '-1.5',
    '2',
    '1.183299410334599709071346549039487733911640085717866855069441446044180825848550617273370234731257457859497366851605386802823885163e-2',
  ],
  [
    '-1.5',
    '0.001',
    '2.102093716712354850456646078746770137900540952010079938414254149275923424073941173163150414359248162812680371704568344994610466943e+4',
  ],
  [
    '0',
    '2',
    '4.890051070806111956723983522804952231449218496302311632732287371169292871415219127926896100745164176733973344049633912609347491139e-2',
  ],
  [
    '-3',
    '0.25',
    '1.488276803363987108698388546804215213908900955244793471555961233653142044167933822982078862203198514646740763194166616320724975972e+1',
  ],
  [
    '-7',
    '10',
    '2.582216508310008819520402666212516994253002077153832835839940592215865676759018366267032930895351977835725920841465529077947671625e-13',
  ],
  [
    '2.5',
    '30',
    '1.615756050575090795764009597448749481049949163019803523418471562105836812427522357448987425000741283590910559118570177754568057728e-11',
  ],
  [
    '100',
    '150',
    '5.529149277557090970025085604262919244065787468424943473079568606987918134479674672047099144264186707916499142756814506395703839788e+150',
  ],
  [
    '40.5',
    '60',
    '4.109114047144243732358827367057537080535789169154058085928518717692681112333400842470716873666138548719530578356548929417950487441e+44',
  ],
  [
    '-50.5',
    '1',
    '7.140546739883879837245708271243382062294898167027907909609985201380210589450798714325921391644711381857429204222235963480006567579e-3',
  ],
  [
    '-2.999',
    '0.5',
    '1.321368550454366481687336987191152805502356914288190341421117489675439966922644788334048253941521683226466008492642191725895840128',
  ],
  [
    '1e4',
    '1.5e4',
    '6.253623988484637149000444456268377425162774870981787098345922379653295102013292236146560536948011854731524548441922954076415552226e+35242',
  ],
];

const REGULARIZED: [string, string, string][] = [
  [
    '1000',
    '1500',
    '2.204698611388996142152511795229012364404925047999794252031839330701715575649313575045264432187513011137310537526987976806180284881e-43',
  ],
  [
    '1e4',
    '1.5e4',
    '2.197137538226920405558545134445047244681651996617094938978544420229189605627355648611838671091073982219177185381146998201212762879e-413',
  ],
  [
    '-1.5',
    '0.5',
    '3.173105078629141028295349087359241550441740665467912180252110995140171160255903409982301631887213449434546248267661569905456558577e-1',
  ],
  [
    '0.5',
    '3',
    '1.430587843542963952584780642225069357366252284955995429948134050553501431370759423343965102705568961041649040949708026883799969075e-2',
  ],
  [
    '2.5',
    '3.6',
    '2.061859197095558879150050296354316727183102576857096388111569221724628349661389539377127338932547413185205643583470736005460537707e-1',
  ],
  [
    '-1.5',
    '0.1',
    '7.112089880880024431456505341362514174327236803267142195866453274421678939682870657135457421835214261874447338483125432390691610639',
  ],
];

describe('Gamma(s, z) at a high precision', () => {
  for (const precision of [50, 120]) {
    for (const [s, z, ref] of GAMMA) {
      test(`Gamma(${s}, ${z}) at precision ${precision}`, () => {
        expect(
          correctDigits(value(precision, 'Gamma', s, z), ref)
        ).toBeGreaterThanOrEqual(precision - 1);
      });
    }
  }

  test('Gamma(-1000, 1500) at precision 50 (below the double range)', () => {
    expect(
      correctDigits(
        value(50, 'Gamma', '-1000', '1500'),
        '1.17212484325417333040372454038764267314457513831181e-3831'
      )
    ).toBeGreaterThanOrEqual(49);
  });

  test('a negative z keeps the machine kernel (the value is complex)', () => {
    const ce = new ComputeEngine();
    ce.precision = 50;
    const result = ce.box(['Gamma', 0.5, -1]).N();
    expect(result.im).not.toBe(0);
  });
});

describe('GammaRegularized(a, z) at a high precision', () => {
  for (const precision of [50, 120]) {
    for (const [a, z, ref] of REGULARIZED) {
      test(`GammaRegularized(${a}, ${z}) at precision ${precision}`, () => {
        expect(
          correctDigits(value(precision, 'GammaRegularized', a, z), ref)
        ).toBeGreaterThanOrEqual(precision - 1);
      });
    }
  }

  test('GammaRegularized(0.5, 3) at precision 300 (small z)', () => {
    expect(
      correctDigits(
        value(300, 'GammaRegularized', '0.5', '3'),
        '0.01430587843542963952584780642225069357366252284955995429948134050553501431370759423343965102705568961041649040949708026883799969074993435636060110368333932032128802188341225045033450953483975004581184423167192977556890518230474056412678070095404862640826170851031199129321665232484007416163675473753200355964532'
      )
    ).toBeGreaterThanOrEqual(299);
  });
});

/** The value of `[head, ...args]` under `.N()` at `precision`, and the time
 *  it took, in milliseconds. */
function timed(
  precision: number,
  head: string,
  ...args: string[]
): { result: string; bignum: BigDecimal | undefined; ms: number } {
  const ce = new ComputeEngine();
  ce.precision = precision;
  const expr = ce.box([head, ...args.map((num) => ({ num }))]);
  const start = performance.now();
  const result = expr.N();
  const ms = performance.now() - start;
  return {
    result: result.toString(),
    bignum: (result as unknown as { bignumRe?: BigDecimal }).bignumRe,
    ms,
  };
}

//
// The bignum kernel answers NaN where it cannot be fast and correct, and the
// machine kernel then answers, as at a precision of 15 digits (and as before
// the bignum kernel existed). Each case below took seconds, or did not end.
//
// The reference values of this test and of the tests after it are from
// mpmath (`gammainc`, `gamma`, `digamma`, `psi(1, ·)`) at 240 digits, the
// same as at 120 digits.
//
describe('Gamma(s, z) where the bignum kernel declines', () => {
  test(
    'Gamma(1e17, 1e17 + 1000) at precision 50 ends (the series loop in doubles did not)',
    () => {
      const r = timed(50, 'Gamma', '1e17', '100000000000001000');
      expect(r.ms).toBeLessThan(2000);
      expect(r.result).toBe(
        timed(15, 'Gamma', '1e17', '100000000000001000').result
      );
    },
    30000
  );

  test(
    'Gamma(1e12, 1e12 + 1) at precision 50 (the series needed 1.8e7 terms, 14 s)',
    () => {
      const r = timed(50, 'Gamma', '1e12', '1000000000001');
      expect(r.ms).toBeLessThan(2000);
      expect(r.result).toBe(timed(15, 'Gamma', '1e12', '1000000000001').result);
    },
    30000
  );

  test(
    'Gamma(5.5, 1e-1000000000) at precision 50 (BigInt overflow after 8 s)',
    () => {
      const r = timed(50, 'Gamma', '5.5', '1e-1000000000');
      expect(r.ms).toBeLessThan(2000);
      expect(r.result).toBe(timed(15, 'Gamma', '5.5', '1e-1000000000').result);
    },
    30000
  );
});

describe('Gamma(s, z) for an order far below zero', () => {
  // The continued fraction converges in few terms for s ≤ −D (D digits).
  // A loop over s + n in doubles lost the fraction of s = −10²⁰ − 0.5 and
  // ran the series for about 10²⁰ terms; the recurrence for an integer s
  // took |s| steps (Γ(−10⁶, 1) took 870 ms).
  test(
    'Gamma(-100000000000000000000.5, 1) at precision 50',
    () => {
      const r = timed(50, 'Gamma', '-100000000000000000000.5', '1');
      expect(r.ms).toBeLessThan(2000);
      expect(
        correctDigits(
          r.bignum,
          '3.678794411714423215900055785438892326219242594094923517863491211881853e-21'
        )
      ).toBeGreaterThanOrEqual(49);
    },
    30000
  );

  test(
    'Gamma(-10000000, 1) at precision 50',
    () => {
      const r = timed(50, 'Gamma', '-10000000', '1');
      expect(r.ms).toBeLessThan(2000);
      expect(
        correctDigits(
          r.bignum,
          '3.678794043834982044516594900870432303808720080362205030101610065663566e-8'
        )
      ).toBeGreaterThanOrEqual(49);
    },
    30000
  );
});

describe('GammaRegularized(a, z) where Γ(a, z) and Γ(a) are out of range', () => {
  // Γ(10¹⁵) is about 10^(1.4·10¹⁶), above the BigDecimal exponent range,
  // while Q is not: Q is the fraction times exp(a ln z − z − ln Γ(a)).
  test('GammaRegularized(1e15, 2.1e15) at precision 50', () => {
    expect(
      correctDigits(
        value(50, 'GammaRegularized', '1e15', '2.1e15'),
        '2.075431399798191514672266263768771330443639791252327223715869666966358e-155504635359666'
      )
    ).toBeGreaterThanOrEqual(49);
  });

  test('bigGammaP(1e15, 2.1e15) is 1 (1 − Q, Q tiny)', () => {
    const ce = new ComputeEngine();
    ce.precision = 50;
    const p = bigGammaP(ce, new BigDecimal('1e15'), new BigDecimal('2.1e15'));
    expect(p.toString()).toBe('1');
  });
});

describe('Gamma near a negative integer', () => {
  // The reflection formula uses sin(π·(s − round(s))) with the sign of
  // (−1)^round(s). The sine of the product π·s lost about
  // −log10|s − round(s)| digits.
  const nines60 = '-1.' + '9'.repeat(60);
  const nines45 = '-1.' + '9'.repeat(45);

  test('Gamma(-1.(60 nines), 1) at precision 100', () => {
    expect(
      correctDigits(
        value(100, 'Gamma', nines60, '1'),
        '0.10969196719776013683858188773006082451552364670345410378898933605661316853370489524094616251841306014841842174555827157127'
      )
    ).toBeGreaterThanOrEqual(99);
  });

  test('Gamma(-1.(45 nines)) at precision 50', () => {
    const ce = new ComputeEngine();
    ce.precision = 50;
    const result = ce.box(['Gamma', { num: nines45 }]).N();
    expect(
      correctDigits(
        (result as unknown as { bignumRe?: BigDecimal }).bignumRe,
        '500000000000000000000000000000000000000000000.461392167549233569696744'
      )
    ).toBeGreaterThanOrEqual(49);
  });

  test('Digamma and Trigamma at -1.(45 nines), precision 50', () => {
    const ce = new ComputeEngine();
    ce.precision = 50;
    const digamma = ce.box(['Digamma', { num: nines45 }]).N();
    const trigamma = ce.box(['Trigamma', { num: nines45 }]).N();
    expect(
      correctDigits(
        (digamma as unknown as { bignumRe?: BigDecimal }).bignumRe,
        '-999999999999999999999999999999999999999999999.0772156649015328606065121'
      )
    ).toBeGreaterThanOrEqual(49);
    expect(
      correctDigits(
        (trigamma as unknown as { bignumRe?: BigDecimal }).bignumRe,
        '1000000000000000000000000000000000000000000000000000000000000000000000000000000000000000002.8949340668482264364724151666460251892189499010527'
      )
    ).toBeGreaterThanOrEqual(49);
  });
});
