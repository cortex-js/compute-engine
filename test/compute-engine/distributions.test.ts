import { ComputeEngine } from '../../src/compute-engine';
import { BigDecimal } from '../../src/big-decimal';
import {
  gammaP,
  gammaQ,
  betaRegularized,
  bigGammaP,
  bigGammaQ,
  bigBetaRegularized,
} from '../../src/compute-engine/numerics/special-functions';

// Golden reference values below were generated with the repo's mpmath venv:
//   ./venv/bin/python3 -c "import mpmath; mpmath.mp.dps=D; \
//     P=lambda a,x: mpmath.gammainc(a,0,x,regularized=True); \
//     Q=lambda a,x: mpmath.gammainc(a,x,mpmath.inf,regularized=True); \
//     I=lambda a,b,x: mpmath.betainc(a,b,0,x,regularized=True); print(...)"

function relErr(got: number, want: number): number {
  return Math.abs(got - want) / Math.abs(want);
}

describe('regularized incomplete gamma/beta kernels', () => {
  describe('machine gammaP / gammaQ', () => {
    // P via series (x < a+1) and Q via 1−series
    test('a=3, x=1 (series branch)', () => {
      expect(relErr(gammaP(3, 1), 0.08030139707139419601119057)).toBeLessThan(
        1e-13
      );
      expect(relErr(gammaQ(3, 1), 0.9196986029286058039888094)).toBeLessThan(
        1e-13
      );
    });

    // Q via continued fraction (x ≥ a+1) and P via 1−CF
    test('a=3, x=10 (continued-fraction branch)', () => {
      expect(relErr(gammaP(3, 10), 0.9972306042844884240563289)).toBeLessThan(
        1e-13
      );
      expect(
        relErr(gammaQ(3, 10), 0.002769395715511575943671082)
      ).toBeLessThan(1e-13);
    });

    test('a=0.5 (half-integer), both branches', () => {
      expect(relErr(gammaP(0.5, 0.5), 0.6826894921370858971704651)).toBeLessThan(
        1e-13
      );
      expect(relErr(gammaQ(0.5, 2), 0.04550026389635841440056527)).toBeLessThan(
        1e-13
      );
    });

    test('a=100, x=100 (large argument, near boundary)', () => {
      expect(
        relErr(gammaP(100, 100), 0.5132987982791486648573143)
      ).toBeLessThan(1e-13);
      expect(
        relErr(gammaQ(100, 100), 0.4867012017208513351426857)
      ).toBeLessThan(1e-13);
    });

    test('a=2, x=0.1 (small x)', () => {
      expect(
        relErr(gammaP(2, 0.1), 0.004678840160444470021611702)
      ).toBeLessThan(1e-13);
    });

    test('x=0 endpoints', () => {
      expect(gammaP(3, 0)).toBe(0);
      expect(gammaQ(3, 0)).toBe(1);
    });

    test('large-x underflow is clean (a=3, x=1000)', () => {
      // Q(3,1000) ≈ 2.5e−429 underflows to 0 in double; P must round to 1.
      expect(gammaP(3, 1000)).toBe(1);
      expect(gammaQ(3, 1000)).toBe(0);
    });

    test('domain errors → NaN', () => {
      expect(gammaP(0, 1)).toBeNaN();
      expect(gammaP(-1, 1)).toBeNaN();
      expect(gammaP(3, -1)).toBeNaN();
      expect(gammaQ(0, 1)).toBeNaN();
      expect(gammaP(NaN, 1)).toBeNaN();
      expect(gammaP(3, NaN)).toBeNaN();
    });

    test('P + Q = 1 identity at assorted points', () => {
      for (const [a, x] of [
        [3, 1],
        [3, 10],
        [0.5, 0.5],
        [0.5, 2],
        [100, 100],
        [2, 0.1],
      ] as [number, number][]) {
        expect(relErr(gammaP(a, x) + gammaQ(a, x), 1)).toBeLessThan(1e-14);
      }
    });
  });

  describe('machine betaRegularized', () => {
    // x < (a+1)/(a+b+2): direct continued fraction. Boundary for a=2,b=3 is
    // 3/7 ≈ 0.4286, so x=0.3 is below and x=0.6 above (symmetry branch).
    test('a=2, b=3, x=0.3 (direct branch)', () => {
      expect(
        relErr(betaRegularized(0.3, 2, 3), 0.3482999999999999804156658)
      ).toBeLessThan(1e-13);
    });

    test('a=2, b=3, x=0.6 (symmetry branch)', () => {
      expect(
        relErr(betaRegularized(0.6, 2, 3), 0.8207999999999999744204615)
      ).toBeLessThan(1e-13);
    });

    test('a=2, b=3, x at the reflection boundary 3/7', () => {
      expect(
        relErr(
          betaRegularized(0.42857142857142855, 2, 3),
          0.5735110370678883398903501
        )
      ).toBeLessThan(1e-13);
    });

    test('a=0.5, b=0.5 (arcsine distribution)', () => {
      expect(
        relErr(betaRegularized(0.3, 0.5, 0.5), 0.3690101195655453750437202)
      ).toBeLessThan(1e-13);
    });

    test('a=5, b=2, x=0.9', () => {
      expect(
        relErr(betaRegularized(0.9, 5, 2), 0.8857350000000000437050396)
      ).toBeLessThan(1e-13);
    });

    test('a=100, b=100, x=0.5 = 1/2 by symmetry', () => {
      // Large equal parameters at the reflection midpoint are near the
      // double-precision floor for the continued fraction (~13 good digits).
      expect(relErr(betaRegularized(0.5, 100, 100), 0.5)).toBeLessThan(1e-12);
    });

    test('endpoints x=0 → 0, x=1 → 1', () => {
      expect(betaRegularized(0, 2, 3)).toBe(0);
      expect(betaRegularized(1, 2, 3)).toBe(1);
    });

    test('domain errors → NaN', () => {
      expect(betaRegularized(0.5, 0, 3)).toBeNaN();
      expect(betaRegularized(0.5, 2, -1)).toBeNaN();
      expect(betaRegularized(-0.1, 2, 3)).toBeNaN();
      expect(betaRegularized(1.1, 2, 3)).toBeNaN();
      expect(betaRegularized(NaN, 2, 3)).toBeNaN();
    });

    test('I_x(a,b) + I_{1−x}(b,a) = 1 identity', () => {
      for (const [x, a, b] of [
        [0.3, 2, 3],
        [0.6, 2, 3],
        [0.3, 0.5, 0.5],
        [0.9, 5, 2],
      ] as [number, number, number][]) {
        expect(
          relErr(
            betaRegularized(x, a, b) + betaRegularized(1 - x, b, a),
            1
          )
        ).toBeLessThan(1e-14);
      }
    });
  });

  describe('bignum kernels', () => {
    // BigDecimal.precision is process-global: save and restore it.
    let savedPrecision: number;
    let ce: InstanceType<typeof ComputeEngine>;
    const B = (s: string) => new BigDecimal(s);

    beforeAll(() => {
      savedPrecision = BigDecimal.precision;
      ce = new ComputeEngine();
    });
    afterAll(() => {
      BigDecimal.precision = savedPrecision;
    });

    // Relative error |got − want|/|want| as a plain number, computed with a
    // little headroom so the near-cancellation of the subtraction does not
    // itself lose the digits we are trying to measure.
    function bigRelErr(got: BigDecimal, wantStr: string): number {
      const saved = BigDecimal.precision;
      BigDecimal.precision = saved + 30;
      try {
        const want = B(wantStr);
        return got.sub(want).abs().div(want.abs()).toNumber();
      } finally {
        BigDecimal.precision = saved;
      }
    }

    describe('50-digit precision', () => {
      beforeEach(() => {
        BigDecimal.precision = 50;
      });

      // 60-digit mpmath goldens; assert agreement to ~48 digits (a few ulps
      // of the 50-digit working precision).
      test('P(3,1) series branch', () => {
        expect(
          bigRelErr(
            bigGammaP(ce, B('3'), B('1')),
            '0.080301397071394196011190574596347831385472172420580413730407995'
          )
        ).toBeLessThan(1e-48);
      });

      test('Q(3,10) continued-fraction branch', () => {
        expect(
          bigRelErr(
            bigGammaQ(ce, B('3'), B('10')),
            '0.0027693957155115759436710824491935872245130034208604631248033496'
          )
        ).toBeLessThan(1e-48);
      });

      test('P(0.5, 2) half-integer', () => {
        expect(
          bigRelErr(
            bigGammaP(ce, B('0.5'), B('2')),
            '0.954499736103641585599434725666933125056447552596643132032668'
          )
        ).toBeLessThan(1e-48);
      });

      test('P(100,100) large argument', () => {
        expect(
          bigRelErr(
            bigGammaP(ce, B('100'), B('100')),
            '0.51329879827914866485731425656402916347092514992794507395962821'
          )
        ).toBeLessThan(1e-48);
      });

      test('I_0.3(2,3) direct branch', () => {
        expect(
          bigRelErr(
            bigBetaRegularized(ce, B('0.3'), B('2'), B('3')),
            '0.34830000000000000000000000000000000000000000000000000000000003'
          )
        ).toBeLessThan(1e-48);
      });

      test('I_0.6(2,3) symmetry branch', () => {
        expect(
          bigRelErr(
            bigBetaRegularized(ce, B('0.6'), B('2'), B('3')),
            '0.82080000000000000000000000000000000000000000000000000000000005'
          )
        ).toBeLessThan(1e-48);
      });

      test('I_0.3(0.5,0.5) arcsine', () => {
        expect(
          bigRelErr(
            bigBetaRegularized(ce, B('0.3'), B('0.5'), B('0.5')),
            '0.36901011956554538275543055877873651465472430538798006067044338'
          )
        ).toBeLessThan(1e-48);
      });

      test('I_0.4(100,100) large parameters', () => {
        expect(
          bigRelErr(
            bigBetaRegularized(ce, B('0.4'), B('100'), B('100')),
            '0.002160094938055144472032463246962837390046068972996652296746663'
          )
        ).toBeLessThan(1e-48);
      });
    });

    describe('200-digit precision', () => {
      beforeEach(() => {
        BigDecimal.precision = 200;
      });

      // 210-digit mpmath goldens; assert agreement to ~198 digits.
      test('P(3,1)', () => {
        expect(
          bigRelErr(
            bigGammaP(ce, B('3'), B('1')),
            '0.080301397071394196011190574596347831385472172420580413730407995756346260637750491607131814135200890633431686807890011979382560518024677478433366026264753042269514081556654712378402522187135959137530700053288810105'
          )
        ).toBeLessThan(1e-197);
      });

      test('Q(3,10)', () => {
        expect(
          bigRelErr(
            bigGammaQ(ce, B('3'), B('10')),
            '0.0027693957155115759436710824491935872245130034208604631248033496447109647184724391808040252773028147216241913604708477380696571461519157437190681842102742886212204454622374492021810446296088179465410795850088854383'
          )
        ).toBeLessThan(1e-197);
      });

      test('P(0.5, 2)', () => {
        expect(
          bigRelErr(
            bigGammaP(ce, B('0.5'), B('2')),
            '0.954499736103641585599434725666933125056447552596643132032667999739047419294448503303461695848420770154976925636115409175104155957095571425952408638944835043393175406461528619918753177595069872605295863277453195'
          )
        ).toBeLessThan(1e-197);
      });

      test('P(100,100)', () => {
        expect(
          bigRelErr(
            bigGammaP(ce, B('100'), B('100')),
            '0.51329879827914866485731425656402916347092514992794507395962820895714163586078377811246212485160014343612125460624022991523405575984575952899146058562603507420250386181639273709723365110122853180385214908074836176'
          )
        ).toBeLessThan(1e-197);
      });

      test('I_0.3(0.5,0.5)', () => {
        expect(
          bigRelErr(
            bigBetaRegularized(ce, B('0.3'), B('0.5'), B('0.5')),
            '0.36901011956554538275543055877873651465472430538798006067044339803172287280223375502188522835979933952187592862577019687251436662736618937727918664151552636372196514003902602192104321574552112810557277164979750014'
          )
        ).toBeLessThan(1e-197);
      });

      test('I_0.4(100,100)', () => {
        expect(
          bigRelErr(
            bigBetaRegularized(ce, B('0.4'), B('100'), B('100')),
            '0.0021600949380551444720324632469628373900460689729966522967466661985293896437484794778819431104526698065556954104911455611308078470609185901775744602142472385544426326124861159877637580945499357184000000000000000037'
          )
        ).toBeLessThan(1e-197);
      });
    });

    describe('identities and domain', () => {
      test('P + Q = 1 (50 digits)', () => {
        BigDecimal.precision = 50;
        for (const [a, x] of [
          ['3', '1'],
          ['3', '10'],
          ['0.5', '2'],
          ['100', '100'],
        ] as [string, string][]) {
          const sum = bigGammaP(ce, B(a), B(x)).add(bigGammaQ(ce, B(a), B(x)));
          expect(bigRelErr(sum, '1')).toBeLessThan(1e-48);
        }
      });

      test('I_x(a,b) + I_{1−x}(b,a) = 1 (50 digits)', () => {
        BigDecimal.precision = 50;
        for (const [x, a, b] of [
          ['0.3', '2', '3'],
          ['0.6', '2', '3'],
          ['0.3', '0.5', '0.5'],
        ] as [string, string, string][]) {
          const sum = bigBetaRegularized(ce, B(x), B(a), B(b)).add(
            bigBetaRegularized(ce, B('1').sub(B(x)), B(b), B(a))
          );
          expect(bigRelErr(sum, '1')).toBeLessThan(1e-48);
        }
      });

      test('domain errors → NaN BigNum', () => {
        BigDecimal.precision = 50;
        expect(bigGammaP(ce, B('0'), B('1')).isNaN()).toBe(true);
        expect(bigGammaP(ce, B('3'), B('-1')).isNaN()).toBe(true);
        expect(bigGammaQ(ce, B('-2'), B('1')).isNaN()).toBe(true);
        expect(bigBetaRegularized(ce, B('0.5'), B('0'), B('3')).isNaN()).toBe(
          true
        );
        expect(bigBetaRegularized(ce, B('1.5'), B('2'), B('3')).isNaN()).toBe(
          true
        );
      });

      test('endpoints', () => {
        BigDecimal.precision = 50;
        expect(bigGammaP(ce, B('3'), B('0')).isZero()).toBe(true);
        expect(bigGammaQ(ce, B('3'), B('0')).eq(BigDecimal.ONE)).toBe(true);
        expect(bigBetaRegularized(ce, B('0'), B('2'), B('3')).isZero()).toBe(
          true
        );
        expect(
          bigBetaRegularized(ce, B('1'), B('2'), B('3')).eq(BigDecimal.ONE)
        ).toBe(true);
      });
    });
  });
});

//
// Phase 1 distributions: constructors, PDF/CDF/Quantile closed forms,
// GammaRegularized/BetaRegularized operators, Mean/Variance/StandardDeviation
// overloads, LaTeX round-trip and parameter validation.
//

describe('distribution operators', () => {
  const ce = new ComputeEngine();
  const ev = (e: any) => ce.box(e).evaluate().toString();
  const napp = (e: any) => ce.box(e).N().re;

  describe('GammaRegularized / BetaRegularized operators', () => {
    test('special values fold on the evaluate path', () => {
      expect(ev(['GammaRegularized', 3, 0])).toBe('1'); // Q(a,0)=1
      expect(ev(['GammaRegularized', 1, 'z'])).toBe('e^(-z)'); // Q(1,z)=e^{-z}
      expect(ev(['BetaRegularized', 0, 'a', 'b'])).toBe('0'); // I_0=0
      expect(ev(['BetaRegularized', 1, 'a', 'b'])).toBe('1'); // I_1=1
    });

    test('exact args stay symbolic', () => {
      expect(ev(['GammaRegularized', 3, 10])).toBe('GammaRegularized(3, 10)');
      expect(ev(['BetaRegularized', ['Rational', 3, 10], 2, 3])).toBe(
        'BetaRegularized(3/10, 2, 3)'
      );
    });

    test('inexact args numericize on the evaluate path', () => {
      expect(napp(['GammaRegularized', 3.0, 10.0])).toBeCloseTo(
        0.002769395715511576,
        12
      );
    });

    test('.N() matches the kernels', () => {
      expect(napp(['GammaRegularized', 3, 10])).toBeCloseTo(
        0.002769395715511576,
        12
      );
      expect(napp(['BetaRegularized', 0.3, 2, 3])).toBeCloseTo(0.3483, 12);
    });

    test('complex args stay symbolic', () => {
      expect(ev(['GammaRegularized', ['Complex', 1, 1], 2])).toContain(
        'GammaRegularized'
      );
    });

    test('high-precision (50-digit) .N()', () => {
      const saved = BigDecimal.precision;
      const hce = new ComputeEngine();
      hce.precision = 50;
      try {
        const s = hce.box(['GammaRegularized', 3, 10]).N().toString();
        // 50-digit mpmath golden for Q(3,10)
        expect(s.startsWith('0.00276939571551157594367108244919')).toBe(true);
      } finally {
        BigDecimal.precision = saved;
      }
    });
  });

  describe('distribution constructors validate parameters', () => {
    test('out-of-range literal parameters produce an error node', () => {
      expect(ce.box(['NormalDistribution', 0, -1]).isValid).toBe(false);
      expect(ce.box(['NormalDistribution', 0, 0]).isValid).toBe(false);
      expect(ce.box(['BinomialDistribution', 4, 2]).isValid).toBe(false);
      expect(ce.box(['BinomialDistribution', -1, 0.5]).isValid).toBe(false);
      expect(ce.box(['BinomialDistribution', 2.5, 0.5]).isValid).toBe(false);
      expect(ce.box(['PoissonDistribution', -1]).isValid).toBe(false);
      expect(ce.box(['ExponentialDistribution', 0]).isValid).toBe(false);
      expect(ce.box(['UniformDistribution', 1, 0]).isValid).toBe(false);
    });

    test('valid and symbolic parameters pass through', () => {
      expect(ce.box(['NormalDistribution', 0, 1]).isValid).toBe(true);
      expect(ce.box(['NormalDistribution', 'mu', 'sigma']).isValid).toBe(true);
      expect(ce.box(['BinomialDistribution', 'n', 'p']).isValid).toBe(true);
      expect(ce.box(['UniformDistribution', 'a', 'b']).isValid).toBe(true);
    });
  });

  describe('PDF / CDF closed forms (§3.2)', () => {
    test('Normal PDF/CDF/Quantile lower to elementary + Erf forms', () => {
      expect(ev(['PDF', ['NormalDistribution', 'mu', 'sigma'], 'x'])).toContain(
        'e^'
      );
      expect(ev(['CDF', ['NormalDistribution', 0, 1], 'x'])).toContain('Erf');
      expect(
        ev(['Quantile', ['NormalDistribution', 0, 1], 'p'])
      ).toContain('ErfInv');
    });

    test('Binomial PMF is the exact rational Binomial(n,k)p^k(1-p)^{n-k}', () => {
      // PDF(Binomial(4, 1/2), 2) = C(4,2)(1/2)^2(1/2)^2 = 6/16 = 3/8
      expect(ev(['PDF', ['BinomialDistribution', 4, ['Rational', 1, 2]], 2])).toBe(
        '3/8'
      );
      // Binomial CDF lowers to BetaRegularized
      expect(ev(['CDF', ['BinomialDistribution', 'n', 'p'], 'k'])).toContain(
        'BetaRegularized'
      );
    });

    test('Poisson PMF/CDF', () => {
      // PMF(Poisson(3), 2) = 3^2 e^{-3}/2! = 9/(2 e^3)
      expect(ev(['PDF', ['PoissonDistribution', 3], 2])).toBe('9 / (2e^3)');
      expect(ev(['CDF', ['PoissonDistribution', 'l'], 'k'])).toContain(
        'GammaRegularized'
      );
    });

    test('Uniform / Exponential elementary forms', () => {
      expect(ev(['PDF', ['UniformDistribution', 'a', 'b'], 'x'])).toContain(
        '/'
      );
      expect(ev(['CDF', ['ExponentialDistribution', 'l'], 'x'])).toContain('e^');
    });

    test('discrete PMF at a numeric non-integer point is 0', () => {
      expect(ev(['PDF', ['BinomialDistribution', 4, ['Rational', 1, 2]], 2.5])).toBe(
        '0'
      );
      expect(ev(['PDF', ['PoissonDistribution', 3], 1.5])).toBe('0');
    });

    test('continuous CDF clamps outside numeric support', () => {
      expect(ev(['CDF', ['UniformDistribution', 0, 1], -1])).toBe('0');
      expect(ev(['CDF', ['UniformDistribution', 0, 1], 2])).toBe('1');
      expect(ev(['CDF', ['ExponentialDistribution', 2], -1])).toBe('0');
      expect(ev(['CDF', ['BinomialDistribution', 4, ['Rational', 1, 2]], 4])).toBe(
        '1'
      );
    });
  });

  describe('exactness contract', () => {
    test('Normal CDF stays exact (no floats), .N() numericizes', () => {
      const s = ev(['CDF', ['NormalDistribution', 0, 1], 1]);
      expect(s).toContain('Erf');
      expect(s).not.toMatch(/\d\.\d/); // no decimal float
      expect(napp(['CDF', ['NormalDistribution', 0, 1], 1])).toBeCloseTo(
        0.8413447460685429,
        12
      );
    });

    test('Binomial PMF at exact rationals is an exact rational', () => {
      expect(ev(['PDF', ['BinomialDistribution', 4, ['Rational', 1, 2]], 2])).toBe(
        '3/8'
      );
    });

    test('Poisson CDF .N() matches golden', () => {
      // P(X<=2) for Poisson(3) = e^{-3}(1+3+9/2) = 8.5 e^{-3}
      expect(napp(['CDF', ['PoissonDistribution', 3], 2])).toBeCloseTo(
        0.42319008112684353,
        12
      );
    });
  });

  describe('quantiles', () => {
    test('Normal quantile exact form and endpoints', () => {
      expect(ev(['Quantile', ['NormalDistribution', 0, 1], 'p'])).toContain(
        'ErfInv'
      );
      expect(ev(['Quantile', ['NormalDistribution', 0, 1], 0])).toBe('-oo');
      expect(ev(['Quantile', ['NormalDistribution', 0, 1], 1])).toBe('+oo');
    });

    test('continuous CDF(Quantile(p)) = p', () => {
      for (const p of [0.1, 0.3, 0.5, 0.9, 0.975]) {
        const q = ce.box(['Quantile', ['NormalDistribution', 2, 3], p]);
        expect(
          ce.box(['CDF', ['NormalDistribution', 2, 3], q]).N().re
        ).toBeCloseTo(p, 10);
        const qe = ce.box(['Quantile', ['ExponentialDistribution', 2], p]);
        expect(
          ce.box(['CDF', ['ExponentialDistribution', 2], qe]).N().re
        ).toBeCloseTo(p, 10);
      }
    });

    test('discrete Quantile stays symbolic under evaluate, searches under .N()', () => {
      const q = ce.box(['Quantile', ['BinomialDistribution', 10, ['Rational', 1, 2]], ['Rational', 1, 2]]);
      expect(q.evaluate().operator).toBe('Quantile'); // symbolic
      expect(q.N().re).toBe(5);
    });

    test('discrete Quantile(CDF(k)) = k at integer k', () => {
      for (const k of [0, 2, 3, 5, 7]) {
        const p = ce.box(['CDF', ['BinomialDistribution', 10, ['Rational', 1, 2]], k]);
        expect(
          ce.box(['Quantile', ['BinomialDistribution', 10, ['Rational', 1, 2]], p]).N().re
        ).toBe(k);
      }
      for (const k of [0, 1, 3, 4, 6]) {
        const p = ce.box(['CDF', ['PoissonDistribution', 3], k]);
        expect(
          ce.box(['Quantile', ['PoissonDistribution', 3], p]).N().re
        ).toBe(k);
      }
    });

    test('Uniform / Exponential / Binomial / Poisson endpoints', () => {
      expect(ev(['Quantile', ['UniformDistribution', 'a', 'b'], 0])).toBe('a');
      expect(ev(['Quantile', ['UniformDistribution', 'a', 'b'], 1])).toBe('b');
      expect(ev(['Quantile', ['ExponentialDistribution', 'l'], 0])).toBe('0');
      expect(ev(['Quantile', ['ExponentialDistribution', 'l'], 1])).toBe('+oo');
      expect(ce.box(['Quantile', ['BinomialDistribution', 4, ['Rational', 1, 2]], 1]).N().re).toBe(4);
      expect(ce.box(['Quantile', ['PoissonDistribution', 3], 0]).N().re).toBe(0);
    });

    test('p out of range produces an error node', () => {
      expect(ce.box(['Quantile', ['NormalDistribution', 0, 1], 2]).evaluate().isValid).toBe(false);
      expect(ce.box(['Quantile', ['NormalDistribution', 0, 1], -0.5]).evaluate().isValid).toBe(false);
    });
  });

  describe('Mean / Variance / StandardDeviation on distributions', () => {
    test('exact closed forms', () => {
      expect(ev(['Mean', ['NormalDistribution', 'mu', 'sigma']])).toBe('mu');
      expect(ev(['StandardDeviation', ['NormalDistribution', 'mu', 'sigma']])).toBe(
        'sigma'
      );
      expect(ev(['Variance', ['BinomialDistribution', 10, ['Rational', 1, 2]]])).toBe(
        '5/2'
      );
      expect(ev(['Mean', ['PoissonDistribution', 'lambda']])).toBe('lambda');
      expect(ev(['Variance', ['PoissonDistribution', 'lambda']])).toBe('lambda');
      expect(ev(['StandardDeviation', ['UniformDistribution', 0, 1]])).toBe(
        'sqrt(3)/6'
      );
      expect(ev(['Mean', ['ExponentialDistribution', 'l']])).toBe('1 / l');
      // Numeric moment checks
      expect(napp(['Mean', ['BinomialDistribution', 10, ['Rational', 1, 4]]])).toBeCloseTo(2.5, 12);
      expect(napp(['Variance', ['ExponentialDistribution', 2]])).toBeCloseTo(0.25, 12);
    });

    test('data path is untouched', () => {
      expect(ce.box(['Mean', ['List', 1, 2, 3, 4]]).evaluate().toString()).toBe('5/2');
      expect(ce.box(['Variance', ['List', 1, 2, 3, 4]]).evaluate().toString()).toBe('5/3');
      expect(ce.box(['StandardDeviation', ['List', 2, 4, 4, 4, 5, 5, 7, 9]]).N().re).toBeCloseTo(2.138089935, 6);
    });
  });

  describe('LaTeX round-trip', () => {
    const cases: any[] = [
      ['NormalDistribution', 0, 1],
      ['BinomialDistribution', 4, ['Rational', 1, 2]],
      ['PoissonDistribution', 3],
      ['UniformDistribution', 0, 1],
      ['ExponentialDistribution', 2],
      ['PDF', ['NormalDistribution', 0, 1], 'x'],
      ['CDF', ['NormalDistribution', 0, 1], 'x'],
      ['Quantile', ['NormalDistribution', 0, 1], 'p'],
      ['GammaRegularized', 3, 'z'],
      ['BetaRegularized', 'x', 2, 3],
    ];
    for (const c of cases) {
      test(`round-trips ${c[0]}`, () => {
        const e = ce.box(c);
        expect(e.latex).toContain(`\\operatorname{${c[0]}}`);
        expect(ce.parse(e.latex).operator).toBe(c[0]);
      });
    }
  });
});
