import { ComputeEngine } from '../../src/compute-engine';
import { BigDecimal } from '../../src/big-decimal';
import {
  dawson,
  erf,
  erfc,
  erfi,
  sinhIntegral,
  coshIntegral,
} from '../../src/compute-engine/numerics/special-functions';
import {
  erfComplex,
  sinIntegralComplex,
} from '../../src/compute-engine/numerics/numeric-complex';

// The reference values are mpmath at 40 digits, rounded to the nearest
// double.

/** Distance from `actual` to `expected`, in units in the last place of
 *  `expected` (the subnormal unit below the normal range). */
function ulps(actual: number, expected: number): number {
  if (actual === expected) return 0;
  const e = Math.max(Math.floor(Math.log2(Math.abs(expected))), -1022);
  return Math.abs(actual - expected) / 2 ** (e - 52);
}

describe('ERROR FUNCTION KERNELS (Cody rational approximations)', () => {
  // [x, erf(x), erfc(x)]
  const rows: [number, number, number][] = [
    [1e-300, 1.1283791670955126e-300, 1.0],
    [1e-20, 1.1283791670955125e-20, 1.0],
    [1e-8, 1.1283791670955126e-8, 0.9999999887162083],
    [0.01, 0.011283415555849618, 0.9887165844441503],
    [0.3, 0.3286267594591274, 0.6713732405408726],
    [0.46875, 0.49261347321793797, 0.507386526782062],
    [0.5, 0.5204998778130465, 0.4795001221869535],
    [1, 0.8427007929497149, 0.15729920705028513],
    [1.5, 0.9661051464753108, 0.033894853524689274],
    [2, 0.9953222650189527, 0.004677734981047266],
    [2.47544431064598, 0.9995361482199188, 0.0004638517800812282],
    [3, 0.9999779095030014, 2.209049699858544e-5],
    [4, 0.9999999845827421, 1.541725790028002e-8],
    [4.5, 0.9999999998033839, 1.9661604415428876e-10],
    [6, 1.0, 2.1519736712498913e-17],
    [10, 1.0, 2.088487583762545e-45],
    [20, 1.0, 5.395865611607901e-176],
    [26.5, 1.0, 2.2109076642637343e-307],
    [27.2, 1.0, 1e-323],
  ];

  test.each(rows)('erf(%p) is within 1 ulp', (x, expected) => {
    expect(ulps(erf(x), expected)).toBeLessThanOrEqual(1);
    expect(ulps(erf(-x), -expected)).toBeLessThanOrEqual(1);
  });

  test.each(rows)('erfc(%p) is within 2 ulps', (x, _, expected) => {
    expect(ulps(erfc(x), expected)).toBeLessThanOrEqual(2);
  });

  test.each([
    [-0.3, 1.3286267594591274],
    [-1, 1.8427007929497148],
    [-3, 1.9999779095030015],
  ])('erfc(%p) is within 1 ulp', (x, expected) => {
    expect(ulps(erfc(x), expected)).toBeLessThanOrEqual(1);
  });

  test.each([
    [1e-300, 1.1283791670955126e-300],
    [1e-8, 1.1283791670955126e-8],
    [0.01, 0.011284167808628218],
    [0.3, 0.3489493387589362],
    [0.5, 0.614952094696511],
    [1, 1.6504257587975428],
    [1.5, 4.584733257284427],
    [2.5, 130.39575501324694],
    [3.5, 35282.28771517168],
    [5, 8298273880.676804],
    [10, 1.5243074227086696e42],
    [20, 1.4747975396287862e172],
  ])('erfi(%p) is within 2 ulps', (x, expected) => {
    expect(ulps(erfi(x), expected)).toBeLessThanOrEqual(2);
    expect(ulps(erfi(-x), -expected)).toBeLessThanOrEqual(2);
  });

  // Past 26.46, e^{x²} is out of the double range and is scaled: one more
  // rounding.
  test.each([
    [26.5, 2.0501652832248794e303],
    [26.7, 8.499867261268985e307],
  ])('erfi(%p) is within 3 ulps', (x, expected) => {
    expect(ulps(erfi(x), expected)).toBeLessThanOrEqual(3);
  });

  test.each([
    [1e-9, 1e-9],
    [0.1, 0.09933599239785286],
    [1, 0.5380795069127684],
    [2, 0.30134038892379195],
    [2.6, 0.212165124242499],
    [3.6, 0.14504177305408886],
    [6, 0.08454268897454385],
    [100, 0.005000250037509378],
    [1e9, 5e-10],
    [1e301, 5e-302],
  ])('dawson(%p) is within 2 ulps', (x, expected) => {
    expect(ulps(dawson(x), expected)).toBeLessThanOrEqual(2);
  });

  test('limits, signed zeros, overflow and underflow', () => {
    expect(Object.is(erf(-0), -0)).toBe(true);
    expect(Object.is(erfi(-0), -0)).toBe(true);
    expect(Object.is(dawson(-0), -0)).toBe(true);
    expect(erf(Infinity)).toBe(1);
    expect(erf(-Infinity)).toBe(-1);
    expect(erfc(Infinity)).toBe(0);
    expect(erfc(-Infinity)).toBe(2);
    expect(erfc(30)).toBe(0);
    expect(erfc(-30)).toBe(2);
    // erfi(x) > the largest double past x = 26.71
    expect(erfi(26.712)).toBeLessThan(Infinity);
    expect(erfi(26.72)).toBe(Infinity);
    expect(erfi(-1e300)).toBe(-Infinity);
    expect(dawson(Infinity)).toBe(0);
    for (const f of [erf, erfc, erfi, dawson]) expect(f(NaN)).toBeNaN();
  });
});

describe('REAL Shi AND Chi KERNELS NEAR 0', () => {
  test('Shi is accurate near 0 (Ei(x) − Ei(−x) cancels there)', () => {
    expect(sinhIntegral(1e-10)).toBe(1e-10);
    expect(ulps(sinhIntegral(1.5), 1.7006525157682153)).toBeLessThanOrEqual(1);
    expect(Object.is(sinhIntegral(-0), -0)).toBe(true);
  });
  test('Chi', () => {
    expect(ulps(coshIntegral(1), 0.8378669409802082)).toBeLessThanOrEqual(1);
    expect(ulps(coshIntegral(-0.1), -1.7228683861943337)).toBeLessThanOrEqual(
      1
    );
    expect(coshIntegral(0)).toBe(-Infinity);
  });
});

describe('COMPLEX erf AND Si NEAR 0', () => {
  const ce = new ComputeEngine();
  // [re, im, erf re, erf im, Si re, Si im]
  test.each([
    [1e-8, 1e-8, 1.1283791670955126e-8, 1.1283791670955125e-8, 1e-8, 1e-8],
    [
      -3e-5, 2e-5, -3.3851375016250514e-5, 2.256758332460844e-5,
      -3.00000000005e-5, 1.9999999997444446e-5,
    ],
    [
      0.4, -0.7, 0.6647932844796217, -0.7544497636553148, 0.429402833303174,
      -0.699898140497642,
    ],
  ])('erf and Si of %p + %pi', (re, im, er, ei, sr, si) => {
    const z = ce.complex(re, im);
    const relative = (v: { re: number; im: number }, r: number, i: number) =>
      Math.hypot(v.re - r, v.im - i) / Math.hypot(r, i);
    expect(relative(erfComplex(z), er, ei)).toBeLessThan(4e-16);
    expect(relative(sinIntegralComplex(z), sr, si)).toBeLessThan(4e-16);
  });
});

describe('VALUES ON THE IMAGINARY AXIS', () => {
  const ce = new ComputeEngine();
  const iy = (y: number) => ['Multiply', y, 'ImaginaryUnit'];
  const N = (expr: unknown) => ce.box(expr as any).N();

  beforeAll(() => {
    ce.precision = 'machine';
  });

  // [y, erfi(y), erf(y), Shi(y), Si(y), Chi(|y|), Ci(|y|)]
  const rows: [number, number, number, number, number, number, number][] = [
    [
      1, 1.6504257587975428, 0.8427007929497149, 1.0572508753757286,
      0.946083070367183, 0.8378669409802082, 0.33740392290096816,
    ],
    [
      -1, -1.6504257587975428, -0.8427007929497149, -1.0572508753757286,
      -0.946083070367183, 0.8378669409802082, 0.33740392290096816,
    ],
    [
      0.25, 0.288083619794972, 0.27632639016823696, 0.2508696848909122,
      0.24913357031975716, -0.7934129495528259, -0.8246630625809457,
    ],
    [
      2.5, 130.39575501324694, 0.999593047982555, 3.5493404062244354,
      1.7785201734438267, 3.5244254883541655, 0.2858711963653835,
    ],
    [
      -3, -1629.9946226015657, -0.9999779095030014, -4.973440475859807,
      -1.8486525279994683, 4.96039209476561, 0.11962978600800032,
    ],
  ];

  test.each(rows)(
    'f(%p·i): the constant part is exact',
    (y, erfiY, erfY, shiY, siY, chiY, ciY) => {
      // The real kernels of the four integrals are a few ulps off past
      // |y| = 2: Shi and Chi are built on Ei, Si and Ci on a continued
      // fraction (3 ulps at 2.5 and 3).
      const close = (actual: number, expected: number, max = 2) =>
        expect(ulps(actual, expected)).toBeLessThanOrEqual(max);
      const s = Math.sign(y);

      // erf(iy) = i·erfi(y), erfc(iy) = 1 − i·erfi(y), erfi(iy) = i·erf(y)
      let v = N(['Erf', iy(y)]);
      expect(v.re).toBe(0);
      close(v.im, erfiY);
      v = N(['Erfc', iy(y)]);
      expect(v.re).toBe(1);
      close(v.im, -erfiY);
      v = N(['Erfi', iy(y)]);
      expect(v.re).toBe(0);
      close(v.im, erfY);

      // Si(iy) = i·Shi(y), Shi(iy) = i·Si(y)
      v = N(['SinIntegral', iy(y)]);
      expect(v.re).toBe(0);
      close(v.im, shiY, 4);
      v = N(['SinhIntegral', iy(y)]);
      expect(v.re).toBe(0);
      close(v.im, siY, 4);

      // Ci(iy) = Chi(|y|) + sign(y)·iπ/2, Chi(iy) = Ci(|y|) + sign(y)·iπ/2
      v = N(['CosIntegral', iy(y)]);
      close(v.re, chiY, 4);
      expect(v.im).toBe((s * Math.PI) / 2);
      v = N(['CoshIntegral', iy(y)]);
      close(v.re, ciY, 4);
      expect(v.im).toBe((s * Math.PI) / 2);
    }
  );

  test('a float argument on the axis', () => {
    const v = ce.box(['Erf', ['Complex', 0, 0.5]]).evaluate();
    expect(v.re).toBe(0);
    expect(ulps(v.im, 0.614952094696511)).toBeLessThanOrEqual(1);
    expect(v.isExact).toBe(false);
  });

  test('an exact argument stays symbolic under evaluate()', () => {
    expect(ce.box(['Erf', 'ImaginaryUnit']).evaluate().toString()).toBe(
      'Erf(i)'
    );
    expect(
      ce
        .box(['SinIntegral', iy(2)])
        .evaluate()
        .toString()
    ).toBe('SinIntegral(2i)');
  });

  test('a value past the number range stays unevaluated', () => {
    // A complex value that is too large has a direction that no infinity
    // of the engine holds.
    expect(N(['Erf', iy(27)]).operator).toBe('Erf');
    expect(N(['Erfc', iy(-27)]).operator).toBe('Erfc');
    expect(N(['Erf', iy(['Power', 10, 10])]).operator).toBe('Erf');
    expect(N(['SinIntegral', iy(1000)]).operator).toBe('SinIntegral');
    expect(N(['CosIntegral', iy(1000)]).operator).toBe('CosIntegral');
    // A real overflow is +∞.
    expect(N(['Erfi', 27]).toString()).toBe('+oo');
    expect(N(['SinhIntegral', 1000]).toString()).toBe('+oo');
    // erf(i·27) = i·erfi(27) overflows, but erfi(i·27) = i·erf(27) is i.
    expect(N(['Erfi', iy(27)]).toString()).toBe('i');
  });

  test('at the default precision, erf(27i) is in the big-decimal range', () => {
    // Constructing an engine writes the precision of the big decimals, a
    // global: save it and put it back.
    const saved = BigDecimal.precision;
    try {
      const ce21 = new ComputeEngine();
      expect(
        ce21
          .box(['Erf', iy(27)])
          .N()
          .toString()
      ).toBe('8.33752193433931888195e+314i');
    } finally {
      BigDecimal.precision = saved;
    }
  });
});

describe('VALUES ON THE IMAGINARY AXIS ABOVE MACHINE PRECISION', () => {
  const ce = new ComputeEngine();
  const iy = (y: unknown) => ['Multiply', y, 'ImaginaryUnit'];
  const N = (expr: unknown) => ce.box(expr as any).N();

  beforeAll(() => {
    ce.precision = 50;
  });

  test('the other part has the working precision', () => {
    let v = N(['Erf', 'ImaginaryUnit']);
    expect(v.re).toBe(0);
    expect(v.toString()).toBe(
      '1.650425758797542876025337729561362443895679874874i'
    );
    v = N(['Erfc', iy(2)]);
    expect(v.re).toBe(1);
    expect(v.bignumIm?.toString()).toBe(
      '-18.564802414575552598704291913241017198858001726083'
    );
    v = N(['Erfi', ['Complex', 0, 0.5]]);
    expect(v.re).toBe(0);
    expect(v.bignumIm?.toString()).toBe(
      '0.52049987781304653768274665389196452873645157575796'
    );
  });

  test('erf(27i) is in the big-decimal range', () => {
    expect(N(['Erf', iy(27)]).bignumIm?.toString()).toBe(
      '8.3375219343393188819479542863263787401657901280469e+314'
    );
  });

  test('erf(10¹⁰·i) is past the big-decimal range: unevaluated', () => {
    expect(N(['Erf', iy(['Power', 10, 10])]).operator).toBe('Erf');
  });

  test('erfi of a large argument uses the asymptotic series', () => {
    // The Maclaurin series would need about e·x² terms, a million here.
    expect(N(['Erfi', 1000]).toString()).toBe(
      '1.7113093871879613596712663288878159964001638091941e+434291'
    );
  });
});
