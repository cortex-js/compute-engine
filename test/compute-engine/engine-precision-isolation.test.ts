import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine';
import type { MathJsonExpression } from '../../src/math-json/types';
import { BigDecimal } from '../../src/big-decimal';

// Each engine computes and displays a number at its own precision, whatever
// the value of `BigDecimal.precision` (CE-1362, GitHub #556). `.N()`, the arithmetic methods of `Expression` and `toString()` of a
// number pass the precision of their engine to the numeric values.

const savedPrecision = BigDecimal.precision;
afterAll(() => {
  BigDecimal.precision = savedPrecision;
});

const SQRT2_100 =
  '1.414213562373095048801688724209698078569671875376948073176679737990732478462107038850387534327641573';
const THIRD_100 = '0.' + '3'.repeat(100);
const CBRT2_100 =
  '1.259921049894873164767210607278228350570251464701507980081975112155299676513959483729396562436255094';
const INV_SQRT2_100 =
  '0.7071067811865475244008443621048490392848359376884740365883398689953662392310535194251937671638207864';

describe('ENGINE PRECISION ISOLATION', () => {
  test('the witness of GitHub #556', () => {
    const f = (e: ComputeEngine) => e.expr(['Sqrt', 2]).N().toString();
    const a = new ComputeEngine();
    a.precision = 30;
    expect(f(a)).toBe('1.41421356237309504880168872421');
    const b = new ComputeEngine();
    b.precision = 'machine';
    a.precision = 30;
    expect(f(a)).toBe('1.41421356237309504880168872421');
    expect(f(b)).toBe('1.4142135623730951');
  });

  test('valueOf() of a complex number has the digits of its engine', () => {
    const a = new ComputeEngine({ precision: 40 });
    const z = a.expr(['Sqrt', ['Complex', 1, 1]]).N();
    const b = new ComputeEngine();
    b.precision = 3;
    expect(z.valueOf()).toBe(
      '(1.098684113467809966039801195240678378544 + 0.4550898605622273413043577578224685696202i)'
    );
  });

  // The regression of PR #607: an engine with precision 100, made after a
  // default engine, kept about 21 digits in the arithmetic methods.
  describe('an engine at precision 100 made after a default engine', () => {
    const b = new ComputeEngine();
    const a = new ComputeEngine({ precision: 100 });
    // Before stage 3 the last engine made or configured wrote
    // `BigDecimal.precision`; the test writes the precision of `b` there.
    beforeEach(() => {
      b.precision = 50;
      b.precision = 'auto';
      BigDecimal.precision = b.precision;
    });

    test.each<[string, (ce: ComputeEngine) => Expression, string]>([
      ['1/3 with div', (ce) => ce.expr(1).div(ce.expr(3)).N(), THIRD_100],
      ['√2 with sqrt', (ce) => ce.number(2).sqrt().N(), SQRT2_100],
      [
        '2^(-1/2) with pow',
        (ce) =>
          ce
            .number(2)
            .pow(ce.expr(['Rational', -1, 2]))
            .N(),
        INV_SQRT2_100,
      ],
      [
        '2^(1/3) with pow',
        (ce) =>
          ce
            .number(2)
            .pow(ce.expr(['Rational', 1, 3]))
            .N(),
        CBRT2_100,
      ],
      ['2^(-0.5) with pow', (ce) => ce.number(2).pow(-0.5).N(), INV_SQRT2_100],
      ['2^(0.5) with pow', (ce) => ce.number(2).pow(0.5).N(), SQRT2_100],
      ['3^(-1) with pow', (ce) => ce.number(3).pow(-1).N(), THIRD_100],
      ['1/3 with inv', (ce) => ce.number(3).inv().N(), THIRD_100],
      ['∛2 with root', (ce) => ce.number(2).root(3).N(), CBRT2_100],
      ['Sqrt(2)', (ce) => ce.expr(['Sqrt', 2]).N(), SQRT2_100],
      ['Divide(1, 3)', (ce) => ce.expr(['Divide', 1, 3]).N(), THIRD_100],
      [
        'Power(2, 1/3)',
        (ce) => ce.expr(['Power', 2, ['Rational', 1, 3]]).N(),
        CBRT2_100,
      ],
    ])('%s', (_, f, expected) => {
      expect(BigDecimal.precision).toBe(21);
      expect(f(a).toString()).toBe(expected);
    });

    test('a float divided by an exact integer', () => {
      expect(a.number(1.1).div(a.number(3)).toString()).toBe(
        '0.' + '3'.repeat(1) + '6'.repeat(98) + '7'
      );
    });

    test('add, sub and mul of floats', () => {
      const third = a.number(1).div(3).N();
      const sqrt2 = a.number(2).sqrt().N();
      expect(third.add(sqrt2).toString()).toBe(
        '1.747546895706428382135022057543031411903005208710281406510013071324065811795440372183720867660974906'
      );
      expect(third.sub(sqrt2).toString()).toBe(
        '-1.08088022903976171546835539087636474523633854204361473984334640465739914512877370551705420099430824'
      );
      expect(sqrt2.mul(a.number(3).sqrt().N()).toString()).toBe(
        '2.449489742783178098197284074705891391965947480656670128432692567250960377457315026539859433104640236'
      );
    });

    test('Ln, Exp and the square root of a complex number', () => {
      expect(a.number(2).ln().N().toString()).toBe(
        '0.6931471805599453094172321214581765680755001343602552541206800094933936219696947156058633269964186875'
      );
      expect(a.expr(['Exp', 2]).N().toString()).toBe(
        '7.389056098930650227230427460575007813180315570551847324087127822522573796079057763384312485079121795'
      );
      expect(
        a
          .expr(['Sqrt', ['Complex', 1, 1]])
          .N()
          .toString()
      ).toBe(
        '(1.098684113467809966039801195240678378544393120927157743744411578842875053555284811136536066356415925 + 0.455089860562227341304357757822468569620190378483150092588259569490800203233448291591401819761020849i)'
      );
    });
  });

  test('a value of engine A computed while engine B evaluates', () => {
    const a = new ComputeEngine({ precision: 40 });
    const b = new ComputeEngine({ precision: 'machine' });
    let inside = '';
    b.declare('ProbeA', {
      signature: '(number) -> number',
      evaluate: ([x]) => {
        inside = a.number(1).div(a.number(7)).N().toString();
        return x;
      },
    });
    b.expr(['ProbeA', 1]).N();
    expect(inside).toBe('0.1428571428571428571428571428571428571429');
    // The other order: B at machine precision inside A at 40 digits.
    a.declare('ProbeB', {
      signature: '(number) -> number',
      evaluate: ([x]) => {
        inside = b.number(1).div(b.number(7)).N().toString();
        return x;
      },
    });
    a.expr(['ProbeB', 1]).N();
    expect(inside).toBe('0.14285714285714285');
  });

  test('interleaved engines', () => {
    const a = new ComputeEngine({ precision: 50 });
    const b = new ComputeEngine({ precision: 21 });
    const sqrt2 = (ce: ComputeEngine) => ce.expr(['Sqrt', 2]).N().toString();
    expect(sqrt2(a)).toBe(
      '1.4142135623730950488016887242096980785696718753769'
    );
    expect(sqrt2(b)).toBe('1.4142135623730950488');
    expect(sqrt2(a)).toBe(
      '1.4142135623730950488016887242096980785696718753769'
    );
  });

  // At a single engine the strings are those of the engine before the change.
  describe('a single engine', () => {
    const CASES: [string, Record<string, string>][] = [
      [
        'machine',
        {
          '1/3': '0.3333333333333333',
          '√2': '1.4142135623730951',
          '2^(1/3)': '1.2599210498948732',
          '2^-0.5': '0.7071067811865476',
          'e': '2.718281828459045',
          'π': '3.141592653589793',
        },
      ],
      [
        '21',
        {
          '1/3': '0.333333333333333333333',
          '√2': '1.4142135623730950488',
          '2^(1/3)': '1.25992104989487316477',
          '2^-0.5': '0.707106781186547524401',
          'e': '2.71828182845904523536',
          'π': '3.14159265358979323846',
        },
      ],
      [
        '50',
        {
          '1/3': '0.33333333333333333333333333333333333333333333333333',
          '√2': '1.4142135623730950488016887242096980785696718753769',
          '2^(1/3)': '1.2599210498948731647672106072782283505702514647015',
          '2^-0.5': '0.70710678118654752440084436210484903928483593768847',
          'e': '2.7182818284590452353602874713526624977572470937',
          'π': '3.1415926535897932384626433832795028841971693993751',
        },
      ],
    ];
    test.each(CASES)('precision %s', (precision, expected) => {
      const ce = new ComputeEngine({
        precision: precision === 'machine' ? 'machine' : Number(precision),
      });
      const actual = {
        '1/3': ce.expr(['Divide', 1, 3]).N().toString(),
        '√2': ce.expr(['Sqrt', 2]).N().toString(),
        '2^(1/3)': ce
          .expr(['Power', 2, ['Rational', 1, 3]])
          .N()
          .toString(),
        '2^-0.5': ce.expr(['Power', 2, -0.5]).N().toString(),
        'e': ce.expr('ExponentialE').N().toString(),
        'π': ce.expr('Pi').N().toString(),
      };
      expect(actual).toEqual(expected);
    });
  });
});

// Area B of CE-1362 stage 2: the big-decimal kernels of the special functions
// take the precision as an argument, so an engine made later at another
// precision does not change their value.
describe('ENGINE PRECISION ISOLATION: big-decimal special-function kernels', () => {
  test.each<[string, unknown]>([
    ['BesselJ (series, cancellation)', ['BesselJ', 2, 3.5]],
    ['BesselY (Hankel)', ['BesselY', 0, 30.5]],
    ['AiryAi', ['AiryAi', 1.5]],
    ['EllipticF', ['EllipticF', 1.2, 0.3]],
    ['EllipticPi (incomplete)', ['EllipticPi', 0.4, 2.5, 0.3]],
    ['BarnesG', ['BarnesG', 2.5]],
    ['LogBarnesG', ['LogBarnesG', 3.5]],
    ['DedekindEta', ['DedekindEta', ['Complex', 0.1, 1.1]]],
    ['ExpIntegralEi (series)', ['ExpIntegralEi', 2.5]],
    ['ExpIntegralEi (continued fraction)', ['ExpIntegralEi', -45.5]],
    ['LogIntegral', ['LogIntegral', 10.5]],
    ['ClausenCl', ['ClausenCl', 2, 2.5]],
    ['StieltjesGamma (ball arithmetic)', ['StieltjesGamma', 1, 2.5]],
    ['Arcsin outside the range of a double', ['Arcsin', ['Power', 10, 400]]],
  ])('%s', (_, json) => {
    const a = new ComputeEngine({ precision: 60 });
    const value = () =>
      a
        .expr(json as any)
        .N()
        .toString();
    const alone = value();
    expect(alone.length).toBeGreaterThan(40);
    const b = new ComputeEngine();
    b.precision = 'machine';
    expect(value()).toBe(alone);
  });
});

// Area A of CE-1362, stage 2: the special-function kernels
// (`numerics/special-functions.ts`, `stieltjes.ts`, `beta-continuation.ts`)
// take the precision as an argument. A value of an engine at precision 60
// is the same before and after another engine is set to machine precision.
describe('ENGINE PRECISION ISOLATION: special functions', () => {
  const cases: [string, MathJsonExpression][] = [
    ['Gamma', ['Gamma', 1.3]],
    ['LogGamma', ['LogGamma', 7.25]],
    ['Digamma', ['Digamma', 2.5]],
    ['Zeta', ['Zeta', 3.5]],
    ['HurwitzZeta', ['HurwitzZeta', 2.5, ['Rational', 1, 3]]],
    ['DirichletEta', ['DirichletEta', 0.5]],
    ['GammaRegularized', ['GammaRegularized', 2.5, 1.5]],
    ['BetaRegularized', ['BetaRegularized', 0.3, 2.5, 1.5]],
    ['PolyLog', ['PolyLog', 2.5, 0.5]],
    ['Erf', ['Erf', 0.7]],
    ['FresnelS', ['FresnelS', 1.2]],
    ['LambertW', ['LambertW', 2.5]],
    ['EllipticK', ['EllipticK', 0.3]],
    ['Hypergeometric2F1', ['Hypergeometric2F1', 0.5, 1.5, 2.5, 0.3]],
  ];
  test.each(cases)('%s', (_, json) => {
    const a = new ComputeEngine({ precision: 60 });
    const f = () => a.expr(json).N().toString();
    const alone = f();
    const b = new ComputeEngine();
    b.precision = 'machine';
    expect(f()).toBe(alone);
    // The value has the digits of engine `a`, not of a double.
    expect(alone.replace(/[^0-9]/g, '').length).toBeGreaterThan(40);
  });
});

// CE-1362 stage 2, area C: the trigonometric functions, the comparisons and
// the values of the constants compute at the precision of their engine. The
// operands are floats: an exact operand is read with guard digits inside a
// window that set `BigDecimal.precision` too (`guardDigitsN`).
describe('AREA C: TRIGONOMETRY, COMPARISON AND CONSTANTS', () => {
  const n = (ce: ComputeEngine, x: unknown) =>
    ce
      .expr(x as Parameters<ComputeEngine['expr']>[0])
      .N()
      .toString();
  const CASES: [string, (ce: ComputeEngine) => string][] = [
    ['Sin(0.3)', (ce) => n(ce, ['Sin', 0.3])],
    ['Csc(2.5)', (ce) => n(ce, ['Csc', 2.5])],
    ['Cosh(0.3)', (ce) => n(ce, ['Cosh', 0.3])],
    ['Arctan(0.3)', (ce) => n(ce, ['Arctan', 0.3])],
    ['Arsech(0.3)', (ce) => n(ce, ['Arsech', 0.3])],
    ['Arcoth(1.5)', (ce) => n(ce, ['Arcoth', 1.5])],
    ['Arctan2(0.3, 0.7)', (ce) => n(ce, ['Arctan2', 0.3, 0.7])],
    [
      'Sin(10^30·π + 1/3)',
      (ce) =>
        n(ce, [
          'Sin',
          ['Add', ['Multiply', ['Power', 10, 30], 'Pi'], ['Rational', 1, 3]],
        ]),
    ],
    [
      'Arccos(0.3) in degrees',
      (ce) => {
        ce.angularUnit = 'deg';
        return n(ce, ['Arccos', 0.3]);
      },
    ],
    [
      'Tanh(iπ/3)',
      (ce) =>
        n(ce, ['Tanh', ['Multiply', 'ImaginaryUnit', ['Divide', 'Pi', 3]]]),
    ],
    ['Pi', (ce) => n(ce, 'Pi')],
    ['ExponentialE', (ce) => n(ce, 'ExponentialE')],
    ['EulerGamma', (ce) => n(ce, 'EulerGamma')],
    [
      'Less(π + 10^-55, π to 60 digits)',
      (ce) =>
        ce
          .expr([
            'Less',
            ['Add', 'Pi', ['Power', 10, -55]],
            ce.number(BigDecimal.pi(70).toPrecision(60)),
          ])
          .evaluate()
          .toString(),
    ],
  ];
  test.each(CASES)('%s', (_, f) => {
    // The value of an engine at precision 60 that is alone.
    const expected = f(new ComputeEngine({ precision: 60 }));
    // The value of an engine at precision 60 made before an engine at
    // machine precision, with `BigDecimal.precision` at the precision of the
    // second engine (which the second engine wrote before stage 3).
    const a = new ComputeEngine({ precision: 60 });
    const b = new ComputeEngine({ precision: 'machine' });
    BigDecimal.precision = b.precision;
    expect(f(a)).toBe(expected);
  });

  // Area D of stage 2: the numeric values, the library (statistics, `Abs`,
  // number theory) and the comparisons of an exact value with a big decimal.
  describe('area D: an engine at precision 60, then an engine at machine precision', () => {
    // The value at precision 60 with no other engine, then the value of a
    // second engine at precision 60 after an engine at machine precision
    // was made.
    const isolated = (f: (ce: ComputeEngine) => string): [string, string] => {
      const expected = f(new ComputeEngine({ precision: 60 }));
      const a = new ComputeEngine({ precision: 60 });
      const b = new ComputeEngine();
      b.precision = 'machine';
      return [f(a), expected];
    };

    test.each<[string, (ce: ComputeEngine) => string, string]>([
      [
        'Mean',
        (ce) =>
          ce
            .expr(['Mean', ['List', 1, 2, ['Rational', 1, 3]]])
            .N()
            .toString(),
        '1.11111111111111111111111111111111111111111111111111111111111',
      ],
      [
        'Variance',
        (ce) =>
          ce
            .expr(['Variance', ['List', 1, 2, ['Rational', 1, 3]]])
            .N()
            .toString(),
        '0.703703703703703703703703703703703703703703703703703703703704',
      ],
      [
        'Kurtosis',
        (ce) =>
          ce
            .expr(['Kurtosis', ['List', 1, 2, 4, ['Rational', 1, 3]]])
            .N()
            .toString(),
        '1.87712665406427221172022684310018903591682419659735349716445',
      ],
      [
        'Correlation',
        (ce) =>
          ce
            .expr([
              'Correlation',
              ['List', 1, 2, 4],
              ['List', 1, ['Rational', 1, 3], 7],
            ])
            .N()
            .toString(),
        '0.911293179512876414744418562107927546854723309872974317498248',
      ],
      [
        'Abs of an exact complex value',
        (ce) =>
          ce
            .expr(['Abs', ['Multiply', ['Sqrt', 1000003], ['Complex', 1, 2]]])
            .N()
            .toString(),
        '2236.07133159924037339238865607023665686384055824037392404469',
      ],
      [
        'IsSquare of a 81-digit square',
        (ce) =>
          ce
            .expr(['IsSquare', ['Power', ['Add', ['Power', 10, 40], 1], 2]])
            .evaluate()
            .toString(),
        '"True"',
      ],
    ])('%s', (_, f, value) => {
      const [actual, expected] = isolated(f);
      expect(actual).toBe(expected);
      expect(actual).toBe(value);
    });

    test('an exact value compared with a big decimal at the given precision', () => {
      const ce = new ComputeEngine({ precision: 60 });
      const third = ce._numericValue({ rational: [1, 3] });
      const decimal = ce._numericValue(new BigDecimal('0.' + '3'.repeat(60)));
      const b = new ComputeEngine();
      b.precision = 'machine';
      expect(third.eq(decimal, 60)).toBe(true);
      expect(decimal.eq(third, 60)).toBe(true);
      expect(third.eq(decimal, 70)).toBe(false);
      expect(decimal.lt(third, 70)).toBe(true);
      expect(third.gt(decimal, 70)).toBe(true);
    });
  });
});

// Stage 3: no engine writes `BigDecimal.precision`, and none reads it. It is
// the default precision of a `BigDecimal` operation called by a host with no
// precision argument.
describe('STAGE 3: the engine does not use BigDecimal.precision', () => {
  const EXPRESSIONS: MathJsonExpression[] = [
    ['Sqrt', 2],
    ['Divide', 1, 7],
    ['Sin', 1],
    ['Gamma', ['Rational', 1, 3]],
    ['Zeta', 3],
    ['BesselJ', 0, ['Rational', 5, 2]],
    ['Mean', ['List', 1, 2, ['Rational', 1, 3], 7]],
    ['Log', 3],
    ['Log', 7, 2],
  ];

  const values = (ce: ComputeEngine) =>
    EXPRESSIONS.map((x) => ce.expr(x).N().toString());

  afterEach(() => {
    BigDecimal.precision = savedPrecision;
  });

  test('making or configuring an engine does not write it', () => {
    const before = BigDecimal.precision;
    const a = new ComputeEngine({ precision: 80 });
    expect(BigDecimal.precision).toBe(before);
    a.precision = 'machine';
    expect(BigDecimal.precision).toBe(before);
    const b = new ComputeEngine({ precision: 'machine' });
    b.precision = 120;
    expect(BigDecimal.precision).toBe(before);
  });

  test.each<[string, number | 'machine']>([
    ['30', 30],
    ['machine', 'machine'],
  ])(
    'a host that sets BigDecimal.precision does not change the values at precision %s',
    (_, precision) => {
      const expected = values(new ComputeEngine({ precision }));
      expect(expected.every((v) => /\d/.test(v))).toBe(true);
      const ce = new ComputeEngine({ precision });
      BigDecimal.precision = 7;
      expect(values(ce)).toEqual(expected);
      expect(values(new ComputeEngine({ precision }))).toEqual(expected);
      expect(BigDecimal.precision).toBe(7);
    }
  );
});

describe('isSame OF NUMBERS OF TWO ENGINES', () => {
  // An exact number is rounded at the higher precision of the pair, in both
  // orders: rounding it at the precision of the left operand made
  // `x.isSame(y)` true and `y.isSame(x)` false.
  const a = new ComputeEngine({ precision: 21 });
  const b = new ComputeEngine({ precision: 50 });
  const third = a.number([1, 3]);
  test.each([
    ['21 digits of 1/3', '0.' + '3'.repeat(21), false],
    ['50 digits of 1/3', '0.' + '3'.repeat(50), true],
  ])('1/3 at precision 21 and %s at precision 50', (_, digits, same) => {
    const x = b.number(digits);
    expect(third.isSame(x)).toBe(same);
    expect(x.isSame(third)).toBe(same);
  });
});
