import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine';
import { BigDecimal } from '../../src/big-decimal';

// Each engine computes and displays a number at its own precision, whatever
// precision another engine wrote to `BigDecimal.precision` (CE-1362, GitHub
// #556). `.N()`, the arithmetic methods of `Expression` and `toString()` of a
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
    // The last engine made or configured writes `BigDecimal.precision`.
    beforeEach(() => {
      b.precision = 50;
      b.precision = 'auto';
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
