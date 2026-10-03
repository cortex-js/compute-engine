import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import {
  airyAiComplex,
  besselJComplex,
} from '../../src/compute-engine/numerics/bessel-complex';

// The Bessel functions of integer order and the Airy functions at a complex
// argument (and `Y`/`K` on the negative real axis, their branch cut). Every
// reference value is from mpmath 1.4 at 25 digits (`besselj`, `bessely`,
// `besseli`, `besselk`, `airyai`, `airybi`, `airyai(z, 1)`, `airybi(z, 1)`).
// The kernels compute in doubles; the tests ask for a relative error below
// 1e-13.

const ce = new ComputeEngine();

function relErr(got: { re: number; im: number }, want: [number, number]) {
  return Math.hypot(got.re - want[0], got.im - want[1]) / Math.hypot(...want);
}

function complexArg([x, y]: [number, number]): any {
  // A float argument: `{ num: '…' }` keeps the decimal point, so the
  // argument is inexact.
  return y === 0
    ? { num: x.toFixed(1) }
    : ['Complex', { num: x.toFixed(2) }, { num: y.toFixed(2) }];
}

describe('Bessel functions of a complex argument (mpmath references)', () => {
  // [head, order, argument, value]
  const cases: [string, number, [number, number], [number, number]][] = [
    // J: all four quadrants, small, medium and large |z|, negative orders
    ['BesselJ', 0, [1, 2], [1.5862594502023713, -1.3916024523273359]],
    ['BesselJ', 3, [-2.5, 0.5], [-0.21378661182087633, 0.096150985532323984]],
    ['BesselJ', -2, [-1, -3], [-1.1253940761391281, 2.0831382267066091]],
    ['BesselJ', 1, [4, -1.5], [-0.28075557416765997, 0.75352280833003295]],
    ['BesselJ', 5, [20, 15], [172262.82362282021, 89428.04400096005]],
    ['BesselJ', 0, [0.1, 0.1], [0.99999375000108507, -0.0049999965277779953]],
    [
      'BesselJ',
      2,
      [-12, -0.25],
      [-0.088073812138982739, -0.052829882372457759],
    ],
    // Y
    ['BesselY', 0, [1, 2], [1.3674187168117979, 1.5215065769454478]],
    ['BesselY', 1, [-3, 1], [0.33415052132152653, -0.57725619205556033]],
    ['BesselY', 2, [-0.5, -0.5], [-0.22773578574884534, 2.4943876920822323]],
    ['BesselY', -3, [25, -10], [-1340.8465419246547, 868.75762832411594]],
    ['BesselY', 4, [0.3, 6], [5.6163342708604191, 15.704888548090037]],
    ['BesselY', -1, [0, -3], [3.9533702174026094, 0.025564378043925439]],
    // I
    ['BesselI', 0, [1, 2], [0.18785372808246172, 0.64616943515398072]],
    ['BesselI', 2, [-3, 4], [-2.1661684556487819, 1.9383611827951789]],
    ['BesselI', -1, [-0.5, -2], [0.034096823134403173, -0.62760413969645035]],
    ['BesselI', 4, [30, 5], [146925156734.36497, -578158949759.73488]],
    ['BesselI', 10, [7, -7], [-2.4145900180378353, 1.7005724814067937]],
    // K
    ['BesselK', 0, [1, 2], [-0.24234510449187199, -0.17626718909269974]],
    ['BesselK', 1, [-3, 1], [-9.7080872437676813, -7.7742944873786118]],
    ['BesselK', 2, [-2, -0.5], [-1.184930654303754, 1.6390628318247617]],
    [
      'BesselK',
      0,
      [40, -30],
      [3.4378693620749236e-19, -6.6825587488985487e-19],
    ],
    ['BesselK', -3, [0.5, 8], [-0.28544191321925429, -0.036992324044146131]],
    ['BesselK', 2, [0, 3], [-0.25195634890257426, 0.76355036661541861]],
  ];
  for (const [head, n, z, want] of cases) {
    test(`${head}(${n}, ${z[0]} + ${z[1]}i)`, () => {
      const v = ce.box([head, n, ['Complex', z[0], z[1]]]).N();
      expect(relErr(v, want)).toBeLessThan(1e-13);
    });
  }
});

describe('Y and K on the negative real axis: the value from above', () => {
  // The cut is the negative real axis; the value on it is the limit as
  // Im z → 0⁺, as for `Ln(−2) = ln 2 + iπ`:
  // Y_n(−x) = (−1)ⁿ(Y_n(x) + 2i·J_n(x)), K_n(−x) = (−1)ⁿK_n(x) − iπ·I_n(x).
  const cases: [string, number, number, [number, number]][] = [
    ['BesselY', 0, -2, [0.51037567264974512, 0.44778155828247134]],
    ['BesselY', 1, -2.5, [-0.1459181379667858, -0.99418820492854808]],
    ['BesselK', 1, -2, [-0.13986588181652243, -4.9971330570578088]],
    ['BesselK', 0, -0.5, [0.92441907122766586, -3.3410315447358524]],
  ];
  for (const [head, n, x, want] of cases) {
    test(`${head}(${n}, ${x})`, () => {
      // `.N()` of an exact argument
      const v = ce.box([head, n, ce.number(x)]).N();
      expect(relErr(v, want)).toBeLessThan(1e-13);
      // `evaluate()` of a float argument
      const w = ce.box([head, n, { num: x.toFixed(1) }]).evaluate();
      expect(relErr(w, want)).toBeLessThan(1e-13);
    });
  }
  test('the result type admits a complex value', () => {
    expect(ce.box(['BesselY', 0, -2]).type.toString()).toBe('number');
    expect(ce.box(['BesselK', 1, -2]).type.toString()).toBe('number');
    expect(ce.box(['BesselY', 0, 2]).type.toString()).toBe('real');
    expect(ce.box(['BesselJ', 0, -2]).type.toString()).toBe('real');
  });
});

describe('Airy functions of a complex argument (mpmath references)', () => {
  const cases: [string, [number, number], [number, number]][] = [
    ['AiryAi', [0.5, 0.5], [0.21618634477812599, -0.11483063987764813]],
    ['AiryAi', [-3, 2], [-4.4196895542641673, 5.4546225177826674]],
    ['AiryAi', [-6, -6], [571985.54098144059, 365041.17725298604]],
    ['AiryAi', [12, -5], [2.1001897847642027e-13, -7.8727254711601254e-13]],
    ['AiryAi', [-20, 1], [-7.3369480297204289, 9.0881869071777518]],
    ['AiryAi', [0, 4], [-4.6362304618889686, 7.411093864660436]],
    ['AiryAi', [3, 9.5], [33.034591108526594, -128.21915885592898]],
    ['AiryBi', [0.5, 0.5], [0.80416659049623265, 0.2492852888831791]],
    ['AiryBi', [-3, 2], [-5.4656670776237691, -4.4151556707835897]],
    ['AiryBi', [-6, -6], [365041.17725305204, -571985.54098139444]],
    ['AiryBi', [12, -5], [3423551952.9596193, 54067696242.636289]],
    ['AiryBi', [-20, 1], [-9.0906033187979382, -7.3350954693975029]],
    ['AiryBi', [0, 4], [-7.4199585975483962, -4.6382948850324979]],
    ['AiryBi', [3, 9.5], [128.21945343185109, 33.034832393739328]],
    ['AiryAiPrime', [0.5, 0.5], [-0.23871680908176862, 0.066157041221093555]],
    ['AiryAiPrime', [-3, 2], [11.878523564741867, 5.2093518478839737]],
    ['AiryAiPrime', [-6, -6], [-1599971.7399748244, 1128207.1787681939]],
    ['AiryAiPrime', [12, -5], [-1.952027428958897e-13, 2.9442885933880372e-12]],
    ['AiryAiPrime', [-20, 1], [41.3905107317888, 31.907210209537611]],
    ['AiryAiPrime', [0, 4], [16.571752887310269, -4.2619428475123498]],
    ['AiryAiPrime', [3, 9.5], [-320.53147881927409, 266.61106393676052]],
    ['AiryBiPrime', [0.5, 0.5], [0.4083984976406324, 0.18775170288237832]],
    ['AiryBiPrime', [-3, 2], [-5.2244204544055436, 11.860758877193861]],
    ['AiryBiPrime', [-6, -6], [1128207.178768394, 1599971.7399746978]],
    ['AiryBiPrime', [12, -5], [50686401806.062511, 187743866270.53037]],
    ['AiryBiPrime', [-20, 1], [-31.915799191476849, 41.379929256044255]],
    ['AiryBiPrime', [0, 4], [4.2524238977323905, 16.555766687819313]],
    ['AiryBiPrime', [3, 9.5], [-266.61077203696234, -320.53030959515947]],
  ];
  for (const [head, z, want] of cases) {
    test(`${head}(${z[0]} + ${z[1]}i)`, () => {
      const v = ce.box([head, ['Complex', z[0], z[1]]]).N();
      expect(relErr(v, want)).toBeLessThan(1e-13);
    });
  }
});

describe('J and I on the imaginary axis', () => {
  // J_n(iy) = iⁿ·I_n(y) and I_n(iy) = iⁿ·J_n(y): one part is exactly 0.
  test('J_3(0.7i) is pure imaginary', () => {
    const v = ce.box(['BesselJ', 3, ['Complex', 0, 0.7]]).N();
    expect(v.re).toBe(0);
    expect(v.im).toBeCloseTo(-0.007367373607628007, 17);
  });
  test('J_{−3}(0.7i) = −J_3(0.7i)', () => {
    const v = ce.box(['BesselJ', -3, ['Complex', 0, 0.7]]).N();
    expect(v.re).toBe(0);
    expect(v.im).toBeCloseTo(0.007367373607628007, 17);
  });
  test('I_3(0.7i) is pure imaginary', () => {
    const v = ce.box(['BesselI', 3, ['Complex', 0, 0.7]]).N();
    expect(v.re).toBe(0);
    expect(v.im).toBeCloseTo(-0.00692965482675084, 17);
  });
  test('J_2(−1.5i) and I_2(−1.5i) are real', () => {
    const j = ce.box(['BesselJ', 2, ['Complex', 0, -1.5]]).N();
    expect(j.im).toBe(0);
    expect(j.re).toBeCloseTo(-0.3378346183356807, 15);
    const i = ce.box(['BesselI', 2, ['Complex', 0, -1.5]]).N();
    expect(i.im).toBe(0);
    expect(i.re).toBeCloseTo(-0.2320876721442147, 15);
  });
  test('I_0(2.5i) = J_0(2.5)', () => {
    const v = ce.box(['BesselI', 0, ['Complex', 0, 2.5]]).N();
    expect(v.im).toBe(0);
    // 2.5 is next to the first zero of J_0 (2.405): only the absolute error
    // is meaningful there.
    expect(v.re).toBeCloseTo(-0.048383776468197996, 15);
  });
});

describe('Exactness and range', () => {
  test('an exact argument stays symbolic under evaluate()', () => {
    for (const expr of [
      ['BesselJ', 0, ['Complex', 1, 2]],
      ['BesselY', 0, -2],
      ['BesselK', 1, ['Complex', 0, 1]],
      ['AiryAi', ['Complex', 0, 1]],
    ]) {
      const v = ce.box(expr).evaluate();
      expect(v.operator).toBe(expr[0]);
    }
  });
  test('a float argument numericizes under evaluate()', () => {
    const v = ce.box(['BesselJ', 0, complexArg([1, 2])]).evaluate();
    expect(relErr(v, [1.5862594502023713, -1.3916024523273359])).toBeLessThan(
      1e-13
    );
    const a = ce.box(['AiryAi', complexArg([0.5, 0.5])]).evaluate();
    expect(relErr(a, [0.21618634477812599, -0.11483063987764813])).toBeLessThan(
      1e-13
    );
  });
  test('a complex value past the range stays unevaluated', () => {
    expect(ce.box(['BesselI', 0, ['Complex', 1000.5, 1]]).N().operator).toBe(
      'BesselI'
    );
    expect(ce.box(['AiryBi', ['Complex', 150, 1]]).N().operator).toBe('AiryBi');
    // K_0(−1000) = K_0(1000) − iπ·I_0(1000): the imaginary part overflows
    expect(ce.box(['BesselK', 0, -1000]).N().operator).toBe('BesselK');
  });
  test('a real value past the range is +∞', () => {
    expect(ce.box(['BesselI', 0, 1000]).N().isSame(ce.PositiveInfinity)).toBe(
      true
    );
  });
  test('a non-integer order stays symbolic', () => {
    const v = ce.box(['BesselJ', ['Rational', 1, 2], ['Complex', 1, 2]]).N();
    expect(v.operator).toBe('BesselJ');
  });
});

describe('The kernels directly', () => {
  test('conjugate symmetry', () => {
    const a = besselJComplex(2, [3, 4]);
    const b = besselJComplex(2, [3, -4]);
    expect(b[0]).toBe(a[0]);
    expect(b[1]).toBe(-a[1]);
  });
  test('Ai(0.5 + 0.5i) at the double-double series', () => {
    const [re, im] = airyAiComplex([0.5, 0.5]);
    expect(
      relErr({ re, im }, [0.21618634477812599, -0.11483063987764813])
    ).toBeLessThan(1e-15);
  });
});

describe('BESSEL J ON THE IMAGINARY AXIS PAST THE DOUBLE RANGE', () => {
  test('an even order is real: a signed infinity', () => {
    const ce = new ComputeEngine();
    ce.precision = 'machine';
    const J = (n: number, y: number) =>
      ce
        .box(['BesselJ', n, ['Complex', 0, y]])
        .N()
        .toString();
    // J_n(iy) = iⁿ·I_n(y), and I_n(1000) overflows.
    expect(J(0, 1000)).toBe('+oo');
    expect(J(2, -1000)).toBe('-oo');
    expect(J(-2, 1000)).toBe('-oo');
    // An odd order is imaginary: it stays unevaluated.
    expect(J(1, 1000)).toBe('BesselJ(1, 1000i)');
  });
});

describe('COMPILED BESSEL FUNCTIONS ARE REAL-ONLY', () => {
  test('a complex operand is refused, not computed by the real kernel', () => {
    const ce = new ComputeEngine();
    ce.declare('z', 'complex');
    for (const h of ['BesselJ', 'BesselY', 'BesselI', 'BesselK']) {
      const f = compile(ce.box([h, 0, 'z'])) as any;
      // The real kernel of `BesselI` gave 1 at 1 + i (the value is
      // 0.9376 + 0.4965i).
      const value = f.success ? f.run({ z: { re: 1, im: 1 } }) : null;
      expect(value === null || Number.isNaN(value)).toBe(true);
    }
  });
});
