import { ComputeEngine } from '../../src/compute-engine';
import { BigDecimal } from '../../src/big-decimal';
import {
  gammaln,
  gamma,
  beta,
  fresnelS,
  fresnelC,
} from '../../src/compute-engine/numerics/special-functions';

/**
 * Regression tests for the CORRECTNESS_FINDINGS.md P2 "Numerics" cluster
 * (#17–#22).
 *
 * All reference values are mpmath (./venv/bin/python3, mpmath 1.x), pinned
 * as static strings — the dps used for each is stated in a comment next to
 * the value. No runtime python.
 *
 * BigDecimal.precision is process-GLOBAL state: every block that changes an
 * engine's precision saves and restores it (see memory note
 * bigdecimal-precision-global).
 */

let savedPrecision: number;
beforeAll(() => {
  savedPrecision = BigDecimal.precision;
});
afterAll(() => {
  BigDecimal.precision = savedPrecision;
});

/** Number of leading significant digits on which two numeric strings agree. */
function digitsAgree(got: string, ref: string): number {
  const norm = (s: string) => {
    // strip sign, decimal point, exponent, leading zeros
    let t = s.replace(/^-/, '').replace(/[eE][+-]?\d+$/, '').replace('.', '');
    t = t.replace(/^0+/, '');
    return t;
  };
  const g = norm(got);
  const r = norm(ref);
  let i = 0;
  while (i < g.length && i < r.length && g[i] === r[i]) i++;
  return i;
}

/** |got − ref| in units of ulp(ref) for doubles. */
function ulpsOf(got: number, ref: number): number {
  if (got === ref) return 0;
  return Math.abs(got - ref) / (Math.abs(ref) * (Number.EPSILON / 2));
}

// -------------------------------------------------------------------------
// #17 — log/log10/log2 guard digits
// -------------------------------------------------------------------------
describe('P2 #17 — logarithm guard digits (bignum lane)', () => {
  let ce: ComputeEngine;
  beforeAll(() => {
    ce = new ComputeEngine();
    ce.precision = 50;
  });
  afterAll(() => {
    BigDecimal.precision = savedPrecision;
  });

  test('log10 of an exact power of ten is exact: Log(1e-7) = -7', () => {
    // Was -6.999…97 (3 ulp short) before guard digits were added to
    // BigDecimal.prototype.log.
    const v = ce.box(['Log', ['Rational', 1, 10000000]]).N();
    expect(v.toString()).toEqual('-7');
  });

  test('log2 of an exact power of two is exact: Log(8, 2) = 3', () => {
    expect(ce.box(['Log', 8, 2]).N().toString()).toEqual('3');
  });

  test('Power(2, -1/2) at precision 50 is correctly rounded', () => {
    // mpmath dps=60: sqrt(2)/2 =
    // 0.70710678118654752440084436210484903928483593768847403658834
    // Rounded to 50 significant digits the tail is …8847 (next digits 40…).
    // Was …8845 (2.35 ulp) before ExactNumericValue.bignumRe guard digits.
    const v = ce.box(['Power', 2, ['Rational', -1, 2]]).N();
    expect(v.toString()).toEqual(
      '0.70710678118654752440084436210484903928483593768847'
    );
  });

  test('BigDecimal.log accuracy: log10(3) to ≥ P−1 digits at P = 120', () => {
    // mpmath dps=120: log(3, 10)
    const REF =
      '0.477121254719662437295027903255115309200128864190695864829865640305229152783661123042968355647616301510464692768252045894';
    const saved = BigDecimal.precision;
    BigDecimal.precision = 120;
    try {
      const got = new BigDecimal(3).log(10).toString();
      expect(digitsAgree(got, REF)).toBeGreaterThanOrEqual(119);
    } finally {
      BigDecimal.precision = saved;
    }
  });

  test('BigDecimal.log accuracy: log2(10) to ≥ P−1 digits at P = 60', () => {
    // mpmath dps=60: log(10, 2)
    const REF =
      '3.32192809488736234787031942948939017586483139302458061205476';
    const saved = BigDecimal.precision;
    BigDecimal.precision = 60;
    try {
      const got = new BigDecimal(10).log(2).toString();
      expect(digitsAgree(got, REF)).toBeGreaterThanOrEqual(59);
    } finally {
      BigDecimal.precision = saved;
    }
  });

  test('BigDecimal.log special values are preserved', () => {
    const saved = BigDecimal.precision;
    BigDecimal.precision = 50;
    try {
      expect(new BigDecimal(0).log(10).isFinite()).toBe(false); // -Infinity
      expect(new BigDecimal(-3).log(10).isNaN()).toBe(true);
      expect(new BigDecimal(1).log(10).isZero()).toBe(true);
    } finally {
      BigDecimal.precision = saved;
    }
  });
});

// -------------------------------------------------------------------------
// #18 — bigZeta trivial zeros
// -------------------------------------------------------------------------
describe('P2 #18 — zeta trivial zeros are exactly 0', () => {
  let ce: ComputeEngine;
  beforeAll(() => {
    ce = new ComputeEngine();
    ce.precision = 50;
  });
  afterAll(() => {
    BigDecimal.precision = savedPrecision;
  });

  test('Zeta(-2).N() is exactly 0 (was ~2.7e-76 residue)', () => {
    expect(ce.box(['Zeta', -2]).N().toString()).toEqual('0');
  });

  test('Zeta(-4).N() is exactly 0', () => {
    expect(ce.box(['Zeta', -4]).N().toString()).toEqual('0');
  });

  test('Zeta(-1000000).N() is exactly 0 (huge trivial zero)', () => {
    expect(ce.box(['Zeta', -1000000]).N().toString()).toEqual('0');
  });

  test('Zeta(-3).N() still uses the functional equation: 1/120', () => {
    // mpmath dps=60: zeta(-3) = 0.008333… = 1/120 exactly
    const got = ce.box(['Zeta', -3]).N().toString();
    expect(digitsAgree(got, '0.0083333333333333333333333333333333')).toBeGreaterThanOrEqual(
      30
    );
  });
});

// -------------------------------------------------------------------------
// #19 — machine gammaln + Fresnel asymptotic cutoff
// -------------------------------------------------------------------------
describe('P2 #19 — machine gammaln to full double precision', () => {
  // mpmath dps=25: loggamma(z)
  const REFS: [number, number][] = [
    [1.5, -0.1207822376352452223455184],
    [10, 12.80182748008146961120772],
    [50, 144.5657439463448860089184],
    [100, 359.134205369575398776044],
    [170, 701.4372638087370853464547],
    [300, 1409.202067470411787487377],
  ];

  test.each(REFS)('gammaln(%p) within 4 ulp or 3e-16 absolute', (z, ref) => {
    // 4 ulp matches the nightly MACHINE_ULP bar for the Wave-3 kernels
    // (observed: ≤3.75 ulp ≈ 15.7 digits; was ~10.5 digits). The
    // absolute-error alternative covers small z where ln Γ ≈ 0 and the
    // relative ulp metric inflates (ln Γ has zeros at z = 1, 2); an absolute
    // error ≤ 3e-16 in ln Γ means exp(gammaln) — the downstream consumer —
    // is correct to ~2.7 ulp.
    const got = gammaln(z);
    const okUlp = ulpsOf(got, ref) <= 4;
    const okAbs = Math.abs(got - ref) <= 3e-16;
    expect(okUlp || okAbs).toBe(true);
  });

  test('gammaln(1) and gammaln(2) are exactly 0', () => {
    expect(gammaln(1)).toBe(0);
    expect(gammaln(2)).toBe(0);
  });

  test('gamma(150.5) via exp(gammaln) to ≥ 12.5 digits', () => {
    // mpmath dps=25: gamma(150.5) = 4.661072627097377918444637e+261
    // (was ~10.5 digits with the 3-term Stirling gammaln)
    const REF = 4.661072627097377918444637e261;
    expect(Math.abs(gamma(150.5) / REF - 1)).toBeLessThan(3e-13);
  });

  test('beta(150, 200) to ≥ 12.5 digits', () => {
    // mpmath dps=25: beta(150, 200) = 4.253580186797090752440168e-105
    const REF = 4.253580186797090752440168e-105;
    expect(Math.abs(beta(150, 200) / REF - 1)).toBeLessThan(3e-13);
  });
});

describe('P2 #19 — machine Fresnel asymptotic cutoff and exact phase', () => {
  // mpmath dps=45 (the phase x²·π/2 needs ~2·log10(x) extra digits, so
  // dps=25 references are themselves phase-corrupted for x ≳ 1e12).
  // [x, S(x), C(x)]
  const REFS: [number, number, number][] = [
    [36973, 0.4999999999999979953148, 0.5000086092523242309434],
    [36974, 0.4999913909805218859017, 0.4999999999999979954775], // old cutoff
    [36975, 0.4999999999999979956401, 0.5000086087866445920398],
    [50000, 0.4999936338022763241866, 0.4999999999999991894305],
    // non-integer x — mpmath evaluated at the exact double mp.mpf(123456.789)
    [123456.789, 0.500002463708250178695, 0.4999992398522263644764],
    [1e6, 0.4999996816901138162093, 0.4999999999999999998987],
    [1e10, 0.4999999999681690113816, 0.5],
    [33554432.5, 0.4999999912357334953824, 0.5000000036302780504648],
    [1e15, 0.4999999999999996816901, 0.5],
  ];

  test.each(REFS)('fresnelS/C(%p) within 2 ulp of 1/2', (x, s, c) => {
    // Was a hard 0.5 for every x ≥ 36974 (8.6e-6 cliff), and the naive
    // phase πx²/2 lost accuracy from x ≈ 1e5 up.
    expect(Math.abs(fresnelS(x) - s)).toBeLessThanOrEqual(2.3e-16);
    expect(Math.abs(fresnelC(x) - c)).toBeLessThanOrEqual(2.3e-16);
  });

  test('oddness and limits preserved', () => {
    expect(fresnelS(-50000)).toBe(-fresnelS(50000));
    expect(fresnelC(-50000)).toBe(-fresnelC(50000));
    expect(fresnelS(Infinity)).toBe(0.5);
    expect(fresnelC(-Infinity)).toBe(-0.5);
    expect(fresnelS(NaN)).toBeNaN();
    // Beyond the cutoff, the correction is below half an ulp of 1/2.
    expect(fresnelS(7e15)).toBe(0.5);
    expect(fresnelC(1e300)).toBe(0.5);
  });
});

// -------------------------------------------------------------------------
// #20 — ExactNumericValue.root
// -------------------------------------------------------------------------
describe('P2 #20 — ExactNumericValue.root exactness and correctness', () => {
  let ce: ComputeEngine;
  beforeAll(() => {
    ce = new ComputeEngine();
    ce.precision = 21;
  });
  afterAll(() => {
    BigDecimal.precision = savedPrecision;
  });

  const nv = (data: any) => (ce as any)._numericValue(data);

  test('64^(1/3) stays exact (was a float-lane leak)', () => {
    const r = nv({ rational: [64, 1], radical: 1 }).root(3);
    expect(r.isExact).toBe(true);
    expect(r.toString()).toEqual('4');
  });

  test('(1/64)^(1/3) stays exact: 1/4', () => {
    const r = nv({ rational: [1, 64], radical: 1 }).root(3);
    expect(r.isExact).toBe(true);
    expect(r.toString()).toEqual('1/4');
  });

  test('(27/8)^(1/3) stays exact: 3/2', () => {
    const r = nv({ rational: [27, 8], radical: 1 }).root(3);
    expect(r.isExact).toBe(true);
    expect(r.toString()).toEqual('3/2');
  });

  test('(-32)^(1/5) stays exact: -2 (real-root convention)', () => {
    const r = nv({ rational: [-32, 1], radical: 1 }).root(5);
    expect(r.isExact).toBe(true);
    expect(r.toString()).toEqual('-2');
  });

  test('non-perfect power does not falsely snap: 65^(1/3)', () => {
    // mpmath dps=25: 65**(1/3) = 4.020725758589058
    const r = nv({ rational: [65, 1], radical: 1 }).root(3);
    expect(r.re).toBeCloseTo(4.020725758589058, 13);
    expect(Number.isInteger(r.re)).toBe(false);
  });

  test('root of a radical value keeps the radical: (8√3)^(1/3)', () => {
    // Was 2 — the numerator snap dropped the √3 entirely.
    // mpmath dps=30: (8·sqrt(3))^(1/3) = 2.4018739103520054533509307747
    const r = nv({ rational: [8, 1], radical: 3 }).root(3);
    expect(r.re).toBeCloseTo(2.401873910352005, 14);
  });

  test('half-integer root exponent: root(2, 2.5) = 2^(2/5)', () => {
    // Was 2^(1/4) = 1.189… — the old decomposition root(⌊e⌋).sqrt()
    // computed x^(1/(2n)) instead of x^(2/(2n+1)).
    // mpmath dps=30: 2^(1/2.5) = 1.31950791077289425937400197123
    const r = nv({ rational: [2, 1], radical: 1 }).root(2.5);
    expect(r.re).toBeCloseTo(1.3195079107728942, 14);
  });

  test('half-integer root exponent stays exact when possible: root(32, 2.5)', () => {
    // 32^(1/2.5) = 32^(2/5) = (32²)^(1/5) = 1024^(1/5) = 4
    const r = nv({ rational: [32, 1], radical: 1 }).root(2.5);
    expect(r.isExact).toBe(true);
    expect(r.toString()).toEqual('4');
  });

  test('root(x, 0.5) = x²', () => {
    const r = nv({ rational: [4, 1], radical: 1 }).root(0.5);
    expect(r.toString()).toEqual('16');
  });

  test('negative root exponent: root(64, -3) = 1/4', () => {
    const r = nv({ rational: [64, 1], radical: 1 }).root(-3);
    expect(r.isExact).toBe(true);
    expect(r.toString()).toEqual('1/4');
  });
});

// -------------------------------------------------------------------------
// #21 — unrounded exact-mul tails in ExactNumericValue.bignumRe
// -------------------------------------------------------------------------
describe('P2 #21 — rational×radical materialization is rounded to precision', () => {
  afterAll(() => {
    BigDecimal.precision = savedPrecision;
  });

  // mpmath dps=110: 7/3*sqrt(3)
  const REF110 =
    '4.0414518843273803515640414635137021895332122588908881321302162853878437061205334198560077691002466765764609966';

  test('(7/3)√3 at precision 100: exactly ~100 digits, all correct', () => {
    const ce = new ComputeEngine();
    ce.precision = 100;
    try {
      const inner = (ce as any)._numericValue({
        rational: [7, 3],
        radical: 3,
      });
      const s = inner.bignumRe.toString();
      const sigDigits = s.replace(/[^0-9]/g, '').replace(/^0+/, '').length;
      // Was ~199 digits with only ~103 correct.
      expect(sigDigits).toBeLessThanOrEqual(100);
      expect(digitsAgree(s, REF110)).toBeGreaterThanOrEqual(99);
    } finally {
      BigDecimal.precision = savedPrecision;
    }
  });

  test('(7/3)√3 through the public .N() surface at precision 100', () => {
    const ce = new ComputeEngine();
    ce.precision = 100;
    try {
      const s = ce
        .box(['Multiply', ['Rational', 7, 3], ['Sqrt', 3]])
        .N()
        .toString();
      expect(digitsAgree(s, REF110)).toBeGreaterThanOrEqual(99);
    } finally {
      BigDecimal.precision = savedPrecision;
    }
  });

  test('(7/3)√3 at precision 60 (second precision point)', () => {
    // mpmath dps=60: 4.04145188432738035156404146351370218953321225889088813213022
    const ce = new ComputeEngine();
    ce.precision = 60;
    try {
      const s = ce
        .box(['Multiply', ['Rational', 7, 3], ['Sqrt', 3]])
        .N()
        .toString();
      expect(digitsAgree(s, REF110)).toBeGreaterThanOrEqual(59);
    } finally {
      BigDecimal.precision = savedPrecision;
    }
  });
});

// -------------------------------------------------------------------------
// #22 — warm-process precision leak (probe: CURED by the round-8
// Bernoulli-cache fix; locked here)
// -------------------------------------------------------------------------
describe('P2 #22 — no warm-process precision leak for Γ(1/3)/ψ(1/3) @ 200', () => {
  afterAll(() => {
    BigDecimal.precision = savedPrecision;
  });

  // mpmath dps=210
  const GAMMA_13 =
    '2.678938534707747633655692940974677644128689377957301100950428327590417610167743819540982889041188789419159049200072263335719084569504472259977713367708469768167289823050003218342550322247156941817555449952728784394779441305765828401';
  const PSI_13 =
    '-3.132033780020806322996419074287268854155428296720418064192751203035170757168755063089433189618374967124697698089277143879910536600399526642702502819527370587967316191020396257504281401746843866444715419366942833388893790384357034';

  test('engine A @30 warms caches, engine B @200 still gets 200 digits', () => {
    const a = new ComputeEngine();
    a.precision = 30;
    a.box(['Gamma', ['Rational', 1, 3]]).N();
    a.box(['Digamma', ['Rational', 1, 3]]).N();

    const b = new ComputeEngine();
    b.precision = 200;
    try {
      const g = b.box(['Gamma', ['Rational', 1, 3]]).N().toString();
      const p = b.box(['Digamma', ['Rational', 1, 3]]).N().toString();
      // Was ~181 correct digits before the round-8 Bernoulli-cache fix.
      expect(digitsAgree(g, GAMMA_13)).toBeGreaterThanOrEqual(199);
      expect(digitsAgree(p, PSI_13)).toBeGreaterThanOrEqual(199);
    } finally {
      BigDecimal.precision = savedPrecision;
    }
  });

  test('same engine, precision churn 500 → 30 → 200 still gets 200 digits', () => {
    const e = new ComputeEngine();
    try {
      e.precision = 500;
      e.box(['Gamma', ['Rational', 1, 3]]).N();
      e.precision = 30;
      e.box(['Gamma', ['Rational', 1, 3]]).N();
      e.precision = 200;
      const g = e.box(['Gamma', ['Rational', 1, 3]]).N().toString();
      const p = e.box(['Digamma', ['Rational', 1, 3]]).N().toString();
      expect(digitsAgree(g, GAMMA_13)).toBeGreaterThanOrEqual(199);
      expect(digitsAgree(p, PSI_13)).toBeGreaterThanOrEqual(199);
    } finally {
      BigDecimal.precision = savedPrecision;
    }
  });
});

describe('RT P2-5 — large integer powers evaluate exactly', () => {
  // Was: 2^100.evaluate() returned a *rounded* 21-digit BigNumericValue.
  // Fixed by the exact-integer-power work (WP-2.16); locked here since the
  // round-trip review filed it. 2^100 is a power of two, so its float .json
  // is exactly representable (lossless per the serialization contract).
  test('2^100 evaluates to the exact 31-digit integer', () => {
    const ce = new ComputeEngine();
    const exact = (2n ** 100n).toString();
    expect(ce.parse('2^{100}').evaluate().toString()).toBe(exact);
    expect(ce.box(['Power', 2, 100]).evaluate().toString()).toBe(exact);
  });
});
