import { Complex } from 'complex.js';
import { ComputeEngine } from '../../src/compute-engine';
import {
  installComplexScaling,
  originalComplexMethods,
} from '../../src/compute-engine/numerics/complex-scaling';

// `installComplexScaling()` replaces the `complex.js` methods that square
// the parts of a value (`|z|`, `ln|z|`, `1/z`), so that a value whose
// largest part is very small or very large gets a correct result. In
// `[2⁻⁵⁰⁰, 2⁵⁰⁰]`, each replacement returns the result of the original
// method, bit for bit.

// Loading the engine installs the replacements (from
// `numerics/numeric-complex.ts`). The call here checks that a second call
// does nothing.
installComplexScaling();
const ORIGINAL = originalComplexMethods()!;

// A `complex.js` class without the replacements, from a separate module
// registry. Its methods that call other methods (`asin()` calls `sqrt()` and
// `log()`, `acot()` calls `atan()`, ...) call the original ones. (Under
// jest, `complex.js` resolves to its CommonJS build, which is the same code
// as the ES module build that the bundles contain.)
let Pristine!: typeof Complex;
jest.isolateModules(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  Pristine = require('complex.js').Complex;
});

const EPS = Number.EPSILON; // 2⁻⁵²

/** `|x − ref|` in units of `ref·2⁻⁵²`. An exact match is 0. */
function relativeError(x: number, ref: number): number {
  if (Object.is(x, ref) || x === ref) return 0;
  if (ref === 0) return Infinity;
  return Math.abs(x - ref) / (Math.abs(ref) * EPS);
}

/** Call a method by name, with the result as `[re, im]`. */
function call(name: string, a: number, b: number): [number, number] {
  const r = (new Complex(a, b) as any)[name]();
  return typeof r === 'number' ? [r, 0] : [r.re, r.im];
}

describe('installComplexScaling()', () => {
  test('the engine installs the replacements once', () => {
    expect(ORIGINAL).toBeDefined();
    expect(Pristine).not.toBe(Complex);
    expect(
      (Pristine.prototype as any)[Symbol.for('cortex-js.complex-scaling')]
    ).toBeUndefined();
    installComplexScaling();
    expect(originalComplexMethods()).toBe(ORIGINAL);
    expect(Complex.prototype.abs).not.toBe(ORIGINAL.abs);
    // The replacements keep the enumerable properties of the prototype (the
    // methods of `complex.js` are the properties of an object literal), and
    // the record is not enumerable
    expect(Object.keys(Complex.prototype)).toEqual(
      Object.keys(Pristine.prototype)
    );
    expect(
      Object.getOwnPropertyDescriptor(
        Complex.prototype,
        Symbol.for('cortex-js.complex-scaling')
      )?.enumerable
    ).toBe(false);
  });

  // Each sub-path that bundles `complex.js` must install the replacements
  // on its own, without the engine.
  test.each(['runtime', 'numerics', 'interval'])(
    'the `%s` entry point installs the replacements',
    (entry) => {
      jest.isolateModules(() => {
        // A fresh module registry: a separate `complex.js` class
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { Complex: FreshComplex } = require('complex.js');
        expect(
          FreshComplex.prototype[Symbol.for('cortex-js.complex-scaling')]
        ).toBeUndefined();
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require(`../../src/${entry}`);
        expect(
          FreshComplex.prototype[Symbol.for('cortex-js.complex-scaling')]
        ).toBeDefined();
        expect(new FreshComplex(3e-200, 4e-200).abs()).toBe(5e-200);
      });
    }
  );
});

describe('values outside [2⁻⁵⁰⁰, 2⁵⁰⁰]', () => {
  // [method, re, im, reference re, reference im]. The references are the
  // values of the exact inputs (the doubles written here), computed with
  // mpmath 1.4.1 at 1500 digits and rounded to the nearest double. The
  // reciprocal functions are defined as in `complex.js`: `acot z` is
  // `atan(1/z)`, `asec z` is `acos(1/z)`, and so on.
  const CASES: [string, number, number, number, number][] = [
    ['abs', 3e-200, 4e-200, 5e-200, 0],
    ['abs', 1e-160, 0, 1e-160, 0],
    ['abs', -1e-160, 1e-170, 1e-160, 0],
    ['abs', 2e-155, -3e-152, 3.0000006666665926e-152, 0],
    ['sign', 3e-200, 4e-200, 0.6, 0.8],
    ['sign', -1e-300, 0, -1, 0],
    ['sqrt', 3e-200, 4e-200, 2e-100, 1e-100],
    ['sqrt', -3e-200, 4e-200, 1e-100, 2e-100],
    ['sqrt', 1e-300, -1e-305, 1.0000000000125e-150, -4.999999999937499e-156],
    ['sqrt', 1.5e308, 1.5e308, 1.345607733249115e154, 5.5736897274590134e153],
    ['sqrt', -1e300, 1e-300, 0, 1e150],
    ['log', 1e-200, 1e-200, -460.17044500852916, 0.7853981633974483],
    ['log', 1e200, 1e200, 460.8635921890891, 0.7853981633974483],
    ['log', 3e154, 4e154, 356.20754223351713, 0.9272952180016122],
    ['log', -1e-300, 2e-305, -690.7755278980137, 3.141572653589796],
    ['log', 1e300, -1e-300, 690.7755278982137, -0],
    ['inverse', 1e-200, 1e-200, 5e199, -5e199],
    ['inverse', 1e200, 1e200, 5e-201, -5e-201],
    ['inverse', 1e-160, 2e-160, 2e159, -4e159],
    [
      'inverse',
      -3e250,
      4e250,
      -1.2000000000000002e-251,
      -1.6000000000000001e-251,
    ],
    ['asin', 1e-200, 2e-200, 1e-200, 2e-200],
    ['asin', 1e200, 2e200, 0.4636476090008061, 462.0148847355861],
    ['asin', -3e200, 1e199, -1.5374753309166493, 462.30933331517923],
    ['asin', 2e200, -1e180, 1.5707963267948966, -461.90331295992905],
    ['asin', 1e300, 0, 1.5707963267948966, -691.4686750787737],
    ['asin', -1e300, 0, -1.5707963267948966, 691.4686750787737],
    ['acos', 1e-200, 2e-200, 1.5707963267948966, -2e-200],
    ['acos', 1e200, 2e200, 1.1071487177940904, -462.0148847355861],
    ['acos', -3e200, 1e199, 3.108271657711546, -462.30933331517923],
    ['acos', 2e200, -1e180, 5.0000000000000005e-21, 461.90331295992905],
    ['atan', 1e-200, 2e-200, 1e-200, 2e-200],
    ['atan', 1e200, 2e200, 1.5707963267948966, 4e-201],
    ['atan', -3e200, 1e199, -1.5707963267948966, 1.109877913429523e-202],
    ['atan', 0, 1e300, 1.5707963267948966, 1e-300],
    ['atanh', 1e-200, 2e-200, 1e-200, 2e-200],
    ['atanh', 1e200, 2e200, 2e-201, 1.5707963267948966],
    ['atanh', -3e200, 1e199, -3.329633740288568e-201, 1.5707963267948966],
    // Near ±1: the internal `(1 + z)/(1 − z)` has a squared denominator
    // that underflows (`z = 1 + εi`), or a value near 0 whose `ln|x|`
    // underflows (`z = −1 + εi`).
    ['atanh', 1, 1e-200, 230.60508288968455, 0.7853981633974483],
    ['atanh', -1, 1e-160, -184.55338102980363, 0.7853981633974483],
    ['atanh', 1, -1e-170, 196.06630649477387, -0.7853981633974483],
    ['atanh', 1, 1e-300, 345.73433753938684, 0.7853981633974483],
    // Nearer to ±1: `(1 + z)/(1 − z)` overflows (`z = 1 + εi`), or its parts
    // are subnormal or 0 (`z = −1 + εi`)
    ['atanh', 1, 1e-320, 368.7601940357669, 0.7853981633974483],
    ['atanh', 1, -1e-320, 368.7601940357669, -0.7853981633974483],
    ['atanh', -1, 1e-320, -368.7601940357669, 0.7853981633974483],
    ['atanh', -1, -1e-320, -368.7601940357669, -0.7853981633974483],
    ['atanh', -1, 5e-324, -372.5666095509706, 0.7853981633974483],
    ['asinh', 1e200, 2e200, 462.0148847355861, 1.1071487177940904],
    ['asinh', -1e200, 0, -461.2101657793691, 0],
    ['asinh', 0, -1e300, -691.4686750787737, -1.5707963267948966],
    ['asinh', -3e200, 1e199, -462.30933331517923, 0.0333209958782472],
    ['asinh', 1e-200, -2e-200, 1e-200, -2e-200],
    ['acosh', -3e200, 1e199, 462.30933331517923, 3.108271657711546],
    ['acosh', -1e300, 0, 691.4686750787737, 3.141592653589793],
    ['acosh', 1e300, -1e300, 691.8152486690536, -0.7853981633974483],
    ['acosh', 1e-200, 2e-200, 2e-200, 1.5707963267948966],
    ['acosh', 1e-200, -2e-200, 2e-200, -1.5707963267948966],
    ['acot', 1e-200, 2e-200, 1.5707963267948966, -2e-200],
    ['acot', 1e200, -2e200, 2e-201, 4e-201],
    ['asec', 1e-200, 2e-200, 1.1071487177940904, 460.40544682315203],
    ['asec', 1e200, -2e200, 1.5707963267948966, -4e-201],
    ['acsc', 1e-200, 2e-200, 0.4636476090008061, -460.40544682315203],
    ['acsc', 1e200, -2e200, 2e-201, 4e-201],
    ['acoth', 1e-200, 2e-200, 1e-200, -1.5707963267948966],
    ['acoth', 1e200, -2e200, 2e-201, 4e-201],
    ['acsch', 1e-200, 2e-200, 460.40544682315203, -1.1071487177940904],
    ['acsch', 1e200, -2e200, 2e-201, 4e-201],
    ['acsch', 1e-200, 0, 461.2101657793691, 0],
    ['acsch', -1e-200, 0, -461.2101657793691, 0],
    ['acsch', 1e200, 0, 1e-200, 0],
    ['asech', 1e-200, 2e-200, 460.40544682315203, -1.1071487177940904],
    ['asech', 1e200, -2e200, 4e-201, 1.5707963267948966],
    // A subnormal value: a part of `1/z` overflows, so the reciprocal
    // functions do not form `1/z`
    ['acot', 1e-310, 1e-310, 1.5707963267948966, -1e-310],
    ['acot', -1e-310, -2e-315, -1.5707963267948966, 2e-315],
    ['asec', 3e-323, 0, 0, 743.3414596327132],
    ['asec', -3e-323, 0, 3.141592653589793, -743.3414596327132],
    ['asec', 1e-310, -1e-310, 0.7853981633974483, -714.1479524184341],
    ['acsc', 3e-323, 0, 1.5707963267948966, -743.3414596327132],
    ['acsc', -1e-310, 1e-310, -0.7853981633974483, -714.1479524184341],
    ['acoth', 1e-310, 1e-310, 1e-310, -1.5707963267948966],
    ['acoth', -3e-323, 0, -3e-323, 1.5707963267948966],
    ['acsch', 1e-310, 1e-310, 714.1479524184341, -0.7853981633974483],
    ['acsch', 3e-323, 0, 743.3414596327132, 0],
    ['acsch', -3e-323, 0, -743.3414596327132, 0],
    ['asech', 1e-310, 1e-310, 714.1479524184341, -0.7853981633974483],
    ['asech', -3e-323, 0, 743.3414596327132, 3.141592653589793],
  ];

  test.each(CASES)('%s(%p + %pi)', (name, a, b, refRe, refIm) => {
    const [re, im] = call(name, a, b);
    // The measured error is at most 0.9 units in the last place.
    expect(relativeError(re, refRe)).toBeLessThanOrEqual(2);
    expect(relativeError(im, refIm)).toBeLessThanOrEqual(2);
  });

  // [re, im, exponent re, exponent im, reference re, reference im]. The
  // power uses the formula of the original method,
  // `exp(c·ln|z| − d·arg z)·cis(d·ln|z| + c·arg z)`. Its error grows with
  // the size of the arguments of `exp` and `cis` (here up to about 400):
  // the measured error is at most 260 units in the last place, the same as
  // for a value in the range with arguments of that size.
  const POWER_CASES: [number, number, number, number, number, number][] = [
    [
      1e-200, 1e-200, 0.5, 0.5, -7.525691077266133e-101,
      2.8006003282374676e-101,
    ],
    [1e200, -1e200, 0.5, 0, 1.09868411346781e100, -4.550898605622274e99],
    [3e154, 4e154, -0.25, 2, -1.902995693763943e-40, 2.708183706327869e-40],
    [
      -1e-250, 3e-251, 0.5, -1, 9.173834287022793e-125,
      -1.5098088836132056e-124,
    ],
  ];

  test.each(POWER_CASES)(
    '(%p + %pi)^(%p + %pi)',
    (a, b, c, d, refRe, refIm) => {
      const r = new Complex(a, b).pow(c, d);
      expect(relativeError(r.re, refRe)).toBeLessThanOrEqual(400);
      expect(relativeError(r.im, refIm)).toBeLessThanOrEqual(400);
    }
  );

  test('the original methods are wrong for these values', () => {
    // Guards against a test that passes without the replacements
    expect(new Pristine(3e-200, 4e-200).abs()).toBe(0);
    expect(new Pristine(1e-200, 1e-200).log().re).toBe(-Infinity);
    expect(new Pristine(3e154, 4e154).log().re).toBe(Infinity);
    expect(new Pristine(1e200, 1e200).inverse().re).toBe(0);
    expect(new Pristine(1e-200, 2e-200).acot().re).toBeNaN();
    expect(new Pristine(1e200, 2e200).atanh().re).toBeNaN();
    expect(new Pristine(1e200, 2e200).asin().re).toBeNaN();
    expect(new Pristine(1e-200, 1e-200).pow(0.5, 0.5).re).toBeNaN();
    expect(new Pristine(1.5e308, 1.5e308).sqrt().re).toBe(Infinity);
    expect(new Pristine(3e-200, 4e-200).sign().re).toBe(Infinity);
    expect(new Pristine(1e200, 2e200).asinh().re).toBeNaN();
    expect(new Pristine(-1e300, 0).acosh().re).toBe(Infinity);
    expect(new Pristine(1e-200, 2e-200).acosh().re).toBe(0);
    expect(new Pristine(1e-200, 0).acsch().re).toBe(Infinity);
  });

  test('the square root of a large value keeps the side of the cut', () => {
    // Scaling `-1.5e308 - 5e-324i` down makes the imaginary part −0. The
    // result is still on the side of the cut below the negative real axis.
    const w = new Complex(-1.5e308, -5e-324).sqrt();
    expect(w.re).toBe(0);
    expect(relativeError(w.im, -1.224744871391589e154)).toBeLessThanOrEqual(2);
    expect(new Complex(-1.5e308, 0).sqrt().im).toBeGreaterThan(0);
  });

  test('a subnormal value', () => {
    // The references are the nearest doubles to the exact values (mpmath).
    // A subnormal |z| keeps the digits that a subnormal can hold.
    expect(new Complex(3e-310, 4e-310).abs()).toBe(5e-310);
    const [re, im] = call('sqrt', 5e-324, 5e-324);
    expect(relativeError(re, 2.4421097261308304e-162)).toBeLessThanOrEqual(2);
    expect(relativeError(im, 1.0115549693666347e-162)).toBeLessThanOrEqual(2);
    const w = new Complex(3e-300, -4e-300).inverse();
    expect(relativeError(w.re, 1.2e299)).toBeLessThanOrEqual(2);
    expect(relativeError(w.im, 1.6e299)).toBeLessThanOrEqual(2);
  });

  test('the side of a cut and the sign of a zero part', () => {
    // `acot z` of an imaginary `z` with `|z| < 1` is on the cut of
    // `atan(1/z)`. As the original method (here at `10⁻¹⁰⁰i`), the result
    // takes the side of the sign of the zero real part: +π/2 for +0 and
    // −π/2 for −0. (mpmath puts this cut on the other side.)
    expect(ORIGINAL.acot.call(new Complex(0, 1e-100)).re).toBe(Math.PI / 2);
    expect(call('acot', 0, 3e-323)).toEqual([Math.PI / 2, -3e-323]);
    expect(call('acot', -0, 3e-323)).toEqual([-Math.PI / 2, -3e-323]);
    // A real `z` gets an imaginary part +0, as from the original methods
    expect(Object.is(new Pristine(2 ** -600, -0).atanh().im, 0)).toBe(true);
    expect(Object.is(new Complex(2 ** -600, -0).atanh().im, 0)).toBe(true);
    for (const a of [2 ** 600, -(2 ** 600)]) {
      const [re, im] = call('acoth', a, 0);
      expect(re).toBe(1 / a);
      expect(Object.is(im, 0)).toBe(true);
    }
  });

  test('a value with an infinite or NaN part uses the original method', () => {
    for (const [a, b] of [
      [Infinity, 1],
      [1e-200, NaN],
      [NaN, NaN],
      [-Infinity, Infinity],
    ]) {
      const z = new Complex(a, b);
      for (const name of [
        'abs',
        'sign',
        'sqrt',
        'log',
        'inverse',
        'asin',
        'atan',
        'atanh',
        'asinh',
        'acosh',
        'acot',
      ] as const) {
        const expected = (ORIGINAL[name] as () => unknown).call(z);
        expect((z[name] as () => unknown).call(z)).toEqual(expected);
      }
    }
  });
});

describe('values in [2⁻⁵⁰⁰, 2⁵⁰⁰] give the original results', () => {
  // A small seeded generator (mulberry32), so a failure is reproducible
  let seed = 0x5eed1234;
  function random(): number {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  const signed = (x: number) => (random() < 0.5 ? -x : x);

  /** A value whose largest part is in `[2⁻⁵⁰⁰, 2⁵⁰⁰]`. */
  function sample(i: number): [number, number] {
    switch (i % 6) {
      case 0: // the usual range
        return [signed(10 * random()), signed(10 * random())];
      case 1: // magnitudes from 1e-100 to 1e100
        return [
          signed(10 ** (200 * random() - 100)),
          signed(10 ** (200 * random() - 100)),
        ];
      case 2: // the whole range, near both ends
        return [
          signed(2 ** (1000 * random() - 500)),
          signed(2 ** (1000 * random() - 500)),
        ];
      case 3: {
        // one part in the range, the other one anywhere (even subnormal)
        const big = signed(2 ** (1000 * random() - 500));
        const small = signed(2 ** (-1074 * random()) * Math.abs(big));
        return random() < 0.5 ? [big, small] : [small, big];
      }
      case 4: // real or imaginary
        return random() < 0.5
          ? [signed(10 ** (200 * random() - 100)), random() < 0.5 ? 0 : -0]
          : [random() < 0.5 ? 0 : -0, signed(10 ** (200 * random() - 100))];
      default: // near ±1 and ±i
        return [
          signed(1 + signed(10 ** (-16 * random()))),
          signed(10 ** (-100 * random())),
        ];
    }
  }

  const POINTS: [number, number][] = [];
  for (let i = 0; i < 3000; i++) POINTS.push(sample(i));
  // Within a factor of 2 of the ends of the range, where `1/z`, `z²` and
  // `2z` of a composite method are near the ends of the inner method's range
  for (let i = 0; i < 400; i++) {
    const m = i % 2 === 0 ? 2 ** (500 - random()) : 2 ** (-500 + random());
    const other = signed(m * random());
    POINTS.push(random() < 0.5 ? [signed(m), other] : [other, signed(m)]);
  }
  // The ends of the range
  for (const m of [2 ** -500, 2 ** 500])
    for (const [p, q] of [
      [1, 1],
      [1, 0],
      [-1, 0.5],
      [0, -1],
      [-1, 0],
      [0, 1],
    ])
      POINTS.push([p * m, q * m]);

  const UNARY = [
    'abs',
    'sign',
    'sqrt',
    'log',
    'inverse',
    'asin',
    'acos',
    'atan',
    'atanh',
    'asinh',
    'acosh',
    'acot',
    'asec',
    'acsc',
    'acoth',
    'acsch',
    'asech',
  ] as const;

  /** True when two results are the same, bit for bit. */
  function same(r1: Complex | number, r2: Complex | number): boolean {
    if (typeof r1 === 'number') return Object.is(r1, r2);
    return (
      typeof r2 !== 'number' &&
      Object.is(r1.re, r2.re) &&
      Object.is(r1.im, r2.im)
    );
  }

  test.each(UNARY)('%s', (name) => {
    const mismatches: string[] = [];
    for (const [a, b] of POINTS) {
      const r1 = (new Pristine(a, b)[name] as () => Complex | number)();
      const r2 = (new Complex(a, b)[name] as () => Complex | number)();
      if (!same(r1, r2)) mismatches.push(`${a} + ${b}i`);
    }
    expect(mismatches).toEqual([]);
  });

  test('pow', () => {
    const mismatches: string[] = [];
    for (const [i, [a, b]] of POINTS.entries()) {
      // Real, integer and complex exponents
      const c = i % 3 === 0 ? Math.round(8 * random() - 4) : 6 * random() - 3;
      const d = i % 3 === 2 ? 6 * random() - 3 : 0;
      const r1 = new Pristine(a, b).pow(c, d);
      const r2 = new Complex(a, b).pow(c, d);
      if (!same(r1, r2)) mismatches.push(`(${a} + ${b}i)^(${c} + ${d}i)`);
    }
    expect(mismatches).toEqual([]);
  });
});

describe('engine', () => {
  // At machine precision, the engine computes `ln z` of a complex value with
  // `Complex.log()`.
  const ce = new ComputeEngine();
  ce.precision = 'machine';

  test('ln of a complex value with tiny parts', () => {
    const r = ce.box(['Ln', ['Complex', 1e-200, 1e-200]]).N();
    expect(relativeError(r.re, -460.17044500852916)).toBeLessThanOrEqual(2);
    expect(relativeError(r.im, 0.7853981633974483)).toBeLessThanOrEqual(2);
  });

  test('ln of a complex value with large parts', () => {
    const r = ce.box(['Ln', ['Complex', 3e154, 4e154]]).N();
    expect(relativeError(r.re, 356.20754223351713)).toBeLessThanOrEqual(2);
    expect(relativeError(r.im, 0.9272952180016122)).toBeLessThanOrEqual(2);
  });

  // `|z|` of a complex machine number is computed by the numeric value of
  // the number (`MachineNumericValue.abs()`), not by `complex.js`. It
  // squares the parts too, and scales them outside [2⁻⁵⁰⁰, 2⁵⁰⁰]. The
  // references are from mpmath 1.4.1, rounded to the nearest double.
  test.each([
    [3e-200, 4e-200, 5e-200],
    [-2e-300, 1e-310, 2e-300],
    [1e200, 1e200, 1.414213562373095e200],
    [1e300, -3e300, 3.1622776601683795e300],
  ])('the modulus of %p + %pi', (a, b, ref) => {
    const z = ['Complex', a, b];
    expect(relativeError(ce.box(['Abs', z]).N().re, ref)).toBeLessThanOrEqual(
      2
    );
    expect(relativeError(ce.box(['Norm', z]).N().re, ref)).toBeLessThanOrEqual(
      2
    );
    // `Sign` divides by the modulus: before the scaling, it was `~oo` for a
    // small value and 0 for a large one.
    const s = ce.box(['Sign', z]).N();
    expect(relativeError(s.re, a / ref)).toBeLessThanOrEqual(4);
    expect(relativeError(s.im, b / ref)).toBeLessThanOrEqual(4);
  });
});
