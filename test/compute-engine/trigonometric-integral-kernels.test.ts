import {
  sinIntegral,
  cosIntegral,
  sinhIntegral,
  coshIntegral,
  expIntegralEi,
} from '../../src/compute-engine/numerics/special-functions';

// Machine kernels of Si, Ci, Shi, Chi and Ei
// (`numerics/exponential-integrals.ts`).
//
// The reference values are mpmath at 50 digits, rounded to the nearest
// double. The tolerances are the largest errors measured against mpmath on
// a dense grid and random points, rounded up: Si 0.75 ulp; Ci 1.5 ulps away
// from its zeros; Shi, Chi and Ei 0.97 ulp for 2 ≤ x < 50 and 2 ulps for
// x ≥ 50 (computed with `Math.exp`); Shi below 2 0.65 ulp; Chi below 2
// 1.6 ulps where |Chi(x)| ≥ 0.1 (part of that band uses `Math.log`).

/** Distance from `actual` to `expected`, in units in the last place of
 *  `expected` (the subnormal unit below the normal range). */
function ulps(actual: number, expected: number): number {
  if (actual === expected) return 0;
  const e = Math.max(Math.floor(Math.log2(Math.abs(expected))), -1022);
  return Math.abs(actual - expected) / 2 ** (e - 52);
}

// [x, Si(x), Ci(x)]
const TRIG_ROWS: [number, number, number][] = [
  [0.125, 0.12489154390467225, -1.5061295845296396],
  [0.6, 0.58812880960808, -0.022270706959279792],
  [1.0, 0.946083070367183, 0.33740392290096816],
  [1.5, 1.3246835311721197, 0.4703563171953999],
  [1.95, 1.5821367567268867, 0.4329344940691715],
  [2.0, 1.6054129768026948, 0.422980828774865],
  [2.03, 1.6188564305701125, 0.4165833520813637],
  [2.5, 1.7785201734438267, 0.2858711963653835],
  [3.0, 1.8486525279994683, 0.11962978600800032],
  [3.87, 1.7817273371456483, -0.11781474796243334],
  [4.5, 1.654140414379244, -0.19349112210173874],
  [5.5, 1.4687240726650987, -0.14205294755151926],
  [6.84, 1.4408675474443875, 0.05812058288415143],
  [7.9, 1.5616710702145502, 0.12363800705971784],
  [12.0, 1.5049712415263734, -0.04978000688411367],
  [22.76, 1.603582104945307, -0.029062368545834754],
  [25.94, 1.5431529788814446, 0.026748574190034728],
  [51.2, 1.558893420676467, 0.015471140532383298],
  [100.0, 1.5622254668890563, -0.005148825142610492],
  [211.28, 1.5741323931046673, -0.0033572268898197978],
  [1000.0, 1.5702331219687713, 0.0008263155110906822],
  [7911.3, 1.5707055441636821, 8.795366014147217e-5],
  [1000000.0, 1.570795390043119, -3.499944389227205e-7],
  [162377673918.87225, 1.570796326789011, -1.8126548502760319e-12],
  [1000000000000000.0, 1.5707963267948972, 8.582727931702364e-16],
  [2.682695795279713e51, 1.5707963267948966, -2.7967511483005913e-52],
  [1e100, 1.5707963267948966, -3.806377310050287e-101],
  [1e200, 1.5707963267948966, -6.4396871853950575e-201],
  [1e300, 1.5707963267948966, -8.178819121159085e-301],
];
// [x, Si(x), Ci(x), amplitude]
const TRIG_NEAR_ZERO_ROWS: [number, number, number, number][] = [
  [9.7, 1.6708445697273635, -0.017804097705837404, 0.10162006105584123],
  [15.9, 1.632804028182416, -0.008115782282273788, 0.06253655693605976],
  [16.0, 1.6313022682700329, -0.014200190120190023, 0.06214993445887258],
  [100000.0, 1.570806320399394, 3.5758791572935135e-7, 9.9999999985e-6],
  [
    1.7976931348623157e308, 1.5707963267948966, 2.760178972127e-311,
    5.562684646268003e-309,
  ],
];
// [x, Shi(x), Chi(x), Ei(x)]
const HYPERBOLIC_ROWS: [number, number, number, number][] = [
  [0.125, 0.12510855782059271, -1.4983170827635761, -1.3732085249429833],
  [1.0, 1.0572508753757286, 0.8378669409802082, 1.8951178163559368],
  [1.65, 1.9209175976837392, 1.8406699710103958, 3.761587568694135],
  [2.0, 2.5015674333549756, 2.4526669226469147, 4.95423435600189],
  [2.19, 2.8647009588159795, 2.8270024885481697, 5.691703447364149],
  [3.43, 6.643444657531507, 6.635842514828989, 13.279287172360496],
  [5.0, 20.093211825697228, 20.09206353010595, 40.18527535580318],
  [7.32, 124.60350845747624, 124.60342790014059, 249.20693635761683],
  [7.93, 207.53948996885222, 207.5394492492195, 415.0789392180717],
  [13.08, 20011.648034590813, 20011.648034441954, 40023.29606903277],
  [15.8, 247137.0289983782, 247137.02899837, 494274.0579967482],
  [16.77, 611389.324328819, 611389.324328816, 1222778.648657635],
  [20.0, 12807826.332028294, 12807826.332028294, 25615652.664056588],
  [24.9, 1365661776.2068908, 1365661776.2068908, 2731323552.4137816],
  [25.1, 1654124745.6241305, 1654124745.6241305, 3308249491.248261],
  [28.72, 53669552181.56481, 53669552181.56481, 107339104363.12962],
  [31.9, 1157429774608.91, 1157429774608.91, 2314859549217.82],
  [32.0, 1275021783178.8936, 1275021783178.8936, 2550043566357.787],
  [43.0, 5.631741450834834e16, 5.631741450834834e16, 1.1263482901669667e17],
  [51.5, 2.3015590102256042e20, 2.3015590102256042e20, 4.6031180204512084e20],
  [100.0, 1.35777637242694e41, 1.35777637242694e41, 2.71555274485388e41],
  [190.9, 2.124583516371012e80, 2.124583516371012e80, 4.249167032742024e80],
  [
    439.8, 1.1466180982482199e188, 1.1466180982482199e188,
    2.2932361964964397e188,
  ],
  [700.0, 7.254893680262804e300, 7.254893680262804e300, 1.4509787360525608e301],
  [
    716.35, 8.939317969625643e307, 8.939317969625643e307,
    1.7878635939251287e308,
  ],
  [717.04, 1.7805282711893576e308, 1.7805282711893576e308, Infinity],
];

describe('SINE AND COSINE INTEGRAL KERNELS', () => {
  test.each(TRIG_ROWS)('Si(%p) and Ci(%p)', (x, si, ci) => {
    expect(ulps(sinIntegral(x), si)).toBeLessThanOrEqual(1);
    expect(ulps(sinIntegral(-x), -si)).toBeLessThanOrEqual(1);
    expect(ulps(cosIntegral(x), ci)).toBeLessThanOrEqual(1.5);
    // Ci(−x) = Ci(x) + iπ: the kernel returns the real part
    expect(cosIntegral(-x)).toBe(cosIntegral(x));
  });

  // Next to a zero of Ci the relative error of any kernel is large: the
  // error is measured in ulps of the amplitude √(f² + g²) of the
  // oscillation, f and g the auxiliary functions of DLMF 6.2.17–6.2.18.
  test.each(TRIG_NEAR_ZERO_ROWS)(
    'Si(%p) and Ci(%p) next to a zero of Ci',
    (x, si, ci, amplitude) => {
      expect(ulps(sinIntegral(x), si)).toBeLessThanOrEqual(1);
      const unit = Math.max(
        2 ** (Math.floor(Math.log2(amplitude)) - 52),
        2 ** -1074
      );
      expect(Math.abs(cosIntegral(x) - ci) / unit).toBeLessThanOrEqual(1);
    }
  );

  test('limits, signed zeros and special values', () => {
    expect(Object.is(sinIntegral(-0), -0)).toBe(true);
    expect(sinIntegral(Infinity)).toBe(Math.PI / 2);
    expect(sinIntegral(-Infinity)).toBe(-Math.PI / 2);
    expect(cosIntegral(0)).toBe(-Infinity);
    expect(cosIntegral(Infinity)).toBe(0);
    expect(cosIntegral(-Infinity)).toBe(0);
    expect(sinIntegral(5e-324)).toBe(5e-324);
    expect(sinIntegral(NaN)).toBeNaN();
    expect(cosIntegral(NaN)).toBeNaN();
  });
});

describe('HYPERBOLIC SINE AND COSINE INTEGRAL KERNELS AND Ei', () => {
  test.each(HYPERBOLIC_ROWS)('Shi, Chi and Ei of %p', (x, shi, chi, ei) => {
    const max = x >= 50 ? 2 : 1;
    expect(ulps(sinhIntegral(x), shi)).toBeLessThanOrEqual(max);
    expect(ulps(sinhIntegral(-x), -shi)).toBeLessThanOrEqual(max);
    expect(ulps(coshIntegral(x), chi)).toBeLessThanOrEqual(x < 2 ? 2 : max);
    // Chi(−x) = Chi(x) + iπ: the kernel returns the real part
    expect(coshIntegral(-x)).toBe(coshIntegral(x));
    if (x >= 2) {
      if (ei === Infinity) expect(expIntegralEi(x)).toBe(Infinity);
      else expect(ulps(expIntegralEi(x), ei)).toBeLessThanOrEqual(max);
    }
  });

  test('overflow', () => {
    // Ei(x) is larger than the largest double past x = 716.355, Shi(x) and
    // Chi(x) past x = 717.049.
    expect(expIntegralEi(716.35)).toBeLessThan(Infinity);
    expect(expIntegralEi(716.36)).toBe(Infinity);
    expect(sinhIntegral(717.04)).toBeLessThan(Infinity);
    expect(sinhIntegral(717.05)).toBe(Infinity);
    expect(sinhIntegral(-717.05)).toBe(-Infinity);
    expect(coshIntegral(717.04)).toBeLessThan(Infinity);
    expect(coshIntegral(717.05)).toBe(Infinity);
    expect(sinhIntegral(1e300)).toBe(Infinity);
    expect(coshIntegral(-1e300)).toBe(Infinity);
    expect(expIntegralEi(1e300)).toBe(Infinity);
  });

  test('limits and signed zeros', () => {
    expect(Object.is(sinhIntegral(-0), -0)).toBe(true);
    expect(coshIntegral(0)).toBe(-Infinity);
    expect(sinhIntegral(Infinity)).toBe(Infinity);
    expect(sinhIntegral(-Infinity)).toBe(-Infinity);
    expect(coshIntegral(-Infinity)).toBe(Infinity);
    expect(expIntegralEi(Infinity)).toBe(Infinity);
    expect(expIntegralEi(-Infinity)).toBe(0);
    expect(sinhIntegral(5e-324)).toBe(5e-324);
    for (const f of [sinhIntegral, coshIntegral, expIntegralEi])
      expect(f(NaN)).toBeNaN();
  });
});
