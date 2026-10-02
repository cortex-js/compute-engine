/**
 * `LogGamma`, `BarnesG`, `LogBarnesG` and `PolyGamma(-1, z)`
 * (cortex-js/compute-engine#395).
 *
 * `LogGamma` is the analytic continuation of ln Γ (Wolfram's, mpmath's
 * `loggamma`), not `GammaLn`, the principal logarithm of Γ(z).
 * Reference values: mpmath 1.3 `loggamma` / `barnesg` at 30 digits, and a
 * Wolfram kernel for `LogBarnesG`'s branch.
 */

import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine';
import { BigDecimal } from '../../src/big-decimal';

const ce = new ComputeEngine();

type C = { re: number; im: number };

const value = (json: unknown, numeric = true): C => {
  const e = ce.expr(json as never);
  const v = (numeric ? e.N() : e.evaluate()) as unknown as C;
  return { re: v.re, im: v.im ?? 0 };
};

function expectClose(got: C, want: [number, number], tol: number) {
  const scale = Math.max(1, Math.hypot(want[0], want[1]));
  expect(Math.abs(got.re - want[0]) / scale).toBeLessThan(tol);
  expect(Math.abs(got.im - want[1]) / scale).toBeLessThan(tol);
}

const withPrecision = <T>(digits: number, f: () => T): T => {
  const saved = ce.precision;
  ce.precision = digits;
  try {
    return f();
  } finally {
    ce.precision = saved;
  }
};

const cx = (re: number, im: number) => ['Complex', re, im];

describe('LogGamma(z), the continuation of ln Γ', () => {
  // [re, im, expected re, expected im]: mpmath.loggamma
  const cases: [number, number, number, number][] = [
    [0.001, 0, 6.907178885383853, 0],
    [0.5, 0, 0.5723649429247001, 0],
    [1.5, 0, -0.12078223763524522, 0],
    [18.5, 0, 34.943315776876815, 0],
    [30, 0, 71.25703896716801, 0],
    // the real part of the continuation, and Im = π⌊x⌋ on the cut
    [-0.5, 0, 1.2655121234846454, -Math.PI],
    [-1.5, 0, 0.860047015376481, -2 * Math.PI],
    [-2.5, 0, -0.056243716497674054, -3 * Math.PI],
    [-10.1, 0, -13.0209732710115, -34.55751918948773],
    [0.5, 1.5, -1.437296305118442, -0.8631510011310997],
    [0.5, -1.5, -1.437296305118442, 0.8631510011310997],
    [2.5, 1.5, -0.2271122407932273, 1.171292934664603],
    [-1.3, 1, -1.1985801490251644, -5.012021386669986],
    [-1.3, -1, -1.1985801490251644, 5.012021386669986],
    [-5, 3, -11.59432786717592, -12.024250555568349],
    // across the odd half-integers, where ln sin(πz) jumps by 2πi
    [-2.5, 1.5, -3.7175134511917918, -7.7130655258341925],
    [-2.5, -1.5, -3.7175134511917918, 7.7130655258341925],
    [-4.5, 2, -8.014299703267405, -12.43527598220705],
    [-0.5, 3, -4.90576222619839, -1.4261257331230843],
    [-6.5, 1, -8.768876181147071, -20.0410271679503],
    // near a pole, off the axis
    [-2.0001, 0.001, 6.209539221562538, -7.952727791599035],
    [-0.9999, -0.0005, 7.581334064011877, 4.514781896113194],
    // large |Im z|
    [0.5, 20, -30.49698800269326, 39.91672910847333],
    [4, -300, -450.35664306921433, -1416.6122522071835],
    [-3, -50, -91.31575441398624, -139.98179226251608],
    [50, 5, 144.31365487215507, 19.518424142532368],
  ];
  for (const [re, im, wre, wim] of cases) {
    test(`LogGamma(${re}${im === 0 ? '' : ` + ${im}i`}) = ${wre.toFixed(6)}${wim === 0 ? '' : ` + ${wim.toFixed(6)}i`}`, () => {
      expectClose(
        value(['LogGamma', im === 0 ? re : cx(re, im)]),
        [wre, wim],
        1e-14
      );
    });
  }

  test('it is not GammaLn: GammaLn(-2.5 + 1.5i) = -3.7175 - 1.4299i, LogGamma gives -3.7175 - 7.7131i', () => {
    const gammaLn = value(['GammaLn', cx(-2.5, 1.5)]);
    expect(gammaLn.im).toBeCloseTo(-1.4299, 3);
    expect(value(['LogGamma', cx(-2.5, 1.5)]).im).toBeCloseTo(-7.7131, 3);
  });

  test('the poles, the non-positive integers, are +Infinity (Wolfram)', () => {
    for (const n of [0, -1, -3]) {
      expect(ce.expr(['LogGamma', n]).evaluate().toString()).toBe('+oo');
      expect(ce.expr(['LogGamma', n]).N().toString()).toBe('+oo');
    }
  });

  test('exact arguments evaluate exactly, floats and N() numerically', () => {
    expect(ce.expr(['LogGamma', 3]).evaluate().toString()).toBe('ln(2)');
    expect(ce.expr(['LogGamma', 1]).evaluate().toString()).toBe('0');
    expect(
      ce
        .expr(['LogGamma', ['Rational', 1, 2]])
        .evaluate()
        .toString()
    ).toBe('1/2 * ln(pi)');
    expect(ce.expr(['LogGamma', ['Rational', 1, 3]]).evaluate().operator).toBe(
      'LogGamma'
    );
    expect(value(['LogGamma', 5]).re).toBeCloseTo(Math.log(24), 14);
    expect(value(['LogGamma', 2.5], false).re).toBeCloseTo(
      0.2846828704729192,
      14
    );
  });

  test('real arguments follow ce.precision', () => {
    withPrecision(40, () => {
      expect(
        ce
          .expr(['LogGamma', ['Rational', 5, 2]])
          .N()
          .toString()
          .slice(0, 42)
      ).toBe('0.2846828704729191596324946696827019243201'.slice(0, 42));
    });
    withPrecision(30, () => {
      expect(
        ce
          .expr(['LogGamma', ['Rational', 1, 3]])
          .N()
          .toString()
          .slice(0, 30)
      ).toBe('0.985420646927767069187174036978'.slice(0, 30));
    });
  });

  test('infinities: +Infinity at +Infinity, Indeterminate at -Infinity (no limit)', () => {
    expect(
      ce.expr(['LogGamma', 'PositiveInfinity']).evaluate().toString()
    ).toBe('+oo');
    expect(
      ce.expr(['LogGamma', 'NegativeInfinity']).evaluate().toString()
    ).toBe('Indeterminate');
  });

  test('a symbol stays symbolic; a list threads', () => {
    expect(ce.expr(['LogGamma', 'z']).evaluate().json).toEqual([
      'LogGamma',
      'z',
    ]);
    expect(
      ce
        .expr(['LogGamma', ['List', 1, 2, 0]])
        .evaluate()
        .toString()
    ).toBe('[0,0,+oo]');
  });

  test('a compound argument that reduces to a literal, and simplify()', () => {
    const arg = ['Subtract', ['Add', 'x', 3], 'x'];
    expect(ce.expr(['LogGamma', arg]).evaluate().toString()).toBe('ln(2)');
    expect(ce.expr(['LogGamma', 3]).simplify().evaluate().toString()).toBe(
      'ln(2)'
    );
  });
});

describe('PolyGamma(-1, z) = LogGamma(z), the Wolfram convention', () => {
  const zs: unknown[] = [2.5, -0.5, cx(-2.5, 1.5), cx(1.3, -1), 30];
  for (const z of zs) {
    test(`PolyGamma(-1, ${JSON.stringify(z)}) equals LogGamma`, () => {
      const a = value(['PolyGamma', -1, z]);
      const b = value(['LogGamma', z]);
      expectClose(a, [b.re, b.im], 1e-15);
    });
  }

  test('PolyGamma(-1, -5/2 + 3/2 i) = -3.7175 - 7.7131i', () => {
    const v = value(['PolyGamma', -1, cx(-2.5, 1.5)]);
    expectClose(v, [-3.7175134511917918, -7.7130655258341925], 1e-14);
  });

  test('PolyGamma(-1, 3) evaluates exactly to ln 2; the pole is +Infinity', () => {
    expect(ce.expr(['PolyGamma', -1, 3]).evaluate().toString()).toBe('ln(2)');
    expect(ce.expr(['PolyGamma', -1, 0]).evaluate().toString()).toBe('+oo');
  });

  test('other orders are unchanged', () => {
    expect(ce.expr(['PolyGamma', -2, 3]).evaluate().operator).toBe('PolyGamma');
    expect(value(['PolyGamma', 0, 1]).re).toBeCloseTo(-0.5772156649015329, 14);
    expect(value(['PolyGamma', 1, 1]).re).toBeCloseTo(Math.PI ** 2 / 6, 14);
  });
});

describe('BarnesG(z)', () => {
  const superfactorials: [number, string][] = [
    [1, '1'],
    [2, '1'],
    [3, '1'],
    [4, '2'],
    [5, '12'],
    [6, '288'],
    [7, '34560'],
    [10, '5056584744960000'],
  ];
  for (const [n, g] of superfactorials) {
    test(`BarnesG(${n}) = ${g} (exact, evaluate and N)`, () => {
      expect(ce.expr(['BarnesG', n]).evaluate().toString()).toBe(g);
      expect(ce.expr(['BarnesG', n]).N().toString()).toBe(g);
    });
  }

  test('a large superfactorial is an exact integer: G(30)', () => {
    // G(30) = Π_{k=0}^{28} k!
    let g = 1n;
    let f = 1n;
    for (let k = 1; k <= 28; k++) {
      f *= BigInt(k);
      g *= f;
    }
    expect(ce.expr(['BarnesG', 30]).evaluate().isSame(ce.number(g))).toBe(true);
  });

  test('zeros at the non-positive integers', () => {
    for (const n of [0, -1, -3, -10])
      expect(ce.expr(['BarnesG', n]).evaluate().toString()).toBe('0');
  });

  const reals: [number, number][] = [
    [0.5, 0.6032442812094462],
    [2.5, 0.9475739010838258],
    [-2.5, 0.07617297965686111],
    [-0.5, -0.17017206989656152],
    [10.5, Math.exp(42.2788836367952)],
  ];
  for (const [x, want] of reals) {
    test(`BarnesG(${x}) = ${want.toPrecision(10)}`, () => {
      const v = value(['BarnesG', x]);
      expect(Math.abs(v.re - want) / Math.abs(want)).toBeLessThan(1e-12);
      expect(v.im).toBe(0);
    });
  }

  test('complex arguments, double precision', () => {
    expectClose(
      value(['BarnesG', cx(1.3, 1)]),
      [1.4446139350503153, -0.2985488252115687],
      1e-12
    );
  });

  test('real arguments follow ce.precision', () => {
    withPrecision(30, () => {
      expect(
        ce
          .expr(['BarnesG', ['Rational', 1, 2]])
          .N()
          .toString()
          .slice(0, 30)
      ).toBe('0.603244281209446206191429224535'.slice(0, 30));
    });
    withPrecision(25, () => {
      // mpmath.barnesg(mpf(-5)/2) = 0.0761729796568611111946819385757...
      const v = ce
        .expr(['BarnesG', ['Rational', -5, 2]])
        .N()
        .toString();
      expect(v.slice(0, 26)).toBe(
        '0.0761729796568611111946819385757'.slice(0, 26)
      );
    });
  });

  test('the bignum kernel matches mpmath near a zero, to 50 digits', () => {
    withPrecision(50, () => {
      // mpmath.barnesg(mpf('-0.999')) at 60 digits
      const v = ce
        .expr(['BarnesG', { num: '-0.999' }])
        .N()
        .toString();
      expect(v.slice(0, 46)).toBe(
        '-0.00000100057060006668485785397781844802368604'.slice(0, 46)
      );
    });
  });

  test('+Infinity; a symbol stays symbolic; past the recurrence cap the value is left unevaluated', () => {
    expect(ce.expr(['BarnesG', 'PositiveInfinity']).evaluate().toString()).toBe(
      '+oo'
    );
    expect(ce.expr(['BarnesG', 'z']).evaluate().json).toEqual(['BarnesG', 'z']);
    // Past a double the bignum kernel still answers; past its cap there is no
    // double fallback at ce.precision, so the head stays unevaluated.
    expect(ce.expr(['BarnesG', 100.5]).N().toString()).toMatch(
      /^1\.68709971029012541584e\+6704$/
    );
    expect(ce.expr(['BarnesG', 5000.5]).N().operator).toBe('BarnesG');
    expect(ce.expr(['LogBarnesG', 5000.5]).N().operator).toBe('LogBarnesG');
  });

  test('a list threads; the hyperfactorial identity H(5) = Γ(6)^5 / G(6)', () => {
    expect(
      ce
        .expr(['BarnesG', ['List', 1, 4, 5]])
        .evaluate()
        .toString()
    ).toBe('[1,2,12]');
    expect(
      value(['Divide', ['Power', ['Gamma', 6], 5], ['BarnesG', 6]]).re
    ).toBeCloseTo(86400000, 3);
  });

  test('G(z+1) = Γ(z)·G(z) at a complex z', () => {
    const z = cx(0.7, 1.9);
    const g1 = value(['BarnesG', ['Add', z, 1]]);
    const g = value(['Multiply', ['Gamma', z], ['BarnesG', z]]);
    expectClose(g1, [g.re, g.im], 1e-12);
  });
});

describe('BarnesG at a complex z where G is not a double', () => {
  // mpmath.barnesg(mpc(re, im)) at 40 digits. |G| is below 1e-308 or above
  // 1e308, so exp(ln G) in doubles underflowed to 0 or overflowed; the value
  // is boxed from ln G with a big-decimal modulus.
  // The last column is the tolerance: the value keeps 12 digits at
  // 0.5 + 30i, 11 at 60 + 10i and 10 at 0.5 + 300i (the size of ln G limits
  // the digits a double ln G gives), so it is off by the rounding to them.
  const cases: [number, number, string, string, number][] = [
    [
      0.5,
      30,
      '1.4850192495074601647301534796e-362',
      '2.52832839715190303669643502983e-362',
      1e-11,
    ],
    [
      1,
      40,
      '9.53734929937039202020594549553e-762',
      '-1.75276703928727967400820730856e-761',
      1e-11,
    ],
    [
      -3.5,
      36,
      '1.07762365722462009816709450667e-463',
      '8.44790313732267234958573074383e-463',
      1e-11,
    ],
    [
      30,
      0.5,
      '-1.55976735404335879590232997265e+352',
      '-3.57952350318069342512740097284e+351',
      1e-11,
    ],
    [
      60,
      10,
      '1.16313082923549317293551718185e+1883',
      '-2.10110905278928676262001922649e+1881',
      1e-10,
    ],
    [
      0.5,
      300,
      '-3.19301622777783256370524666005e-82054',
      '-2.08176829617599889110268297049e-82054',
      1e-9,
    ],
  ];

  // The relative error of each part, against the modulus of the reference.
  const relativeErrors = (v: Expression, re: string, im: string) => {
    const wantRe = new BigDecimal(re);
    const wantIm = new BigDecimal(im);
    const modulus = wantRe.mul(wantRe).add(wantIm.mul(wantIm)).sqrt();
    return [
      v.bignumRe!.sub(wantRe).abs().div(modulus).toNumber(),
      v.bignumIm!.sub(wantIm).abs().div(modulus).toNumber(),
    ];
  };

  for (const digits of [21, 30]) {
    test.each(cases)(
      `BarnesG(%p + %pi) at precision ${digits}`,
      (re, im, wantRe, wantIm, tolerance) => {
        const engine = new ComputeEngine();
        engine.precision = digits;
        const v = engine.box(['BarnesG', cx(re, im)]).N();
        expect(v.isExact).toBe(false);
        expect(v.bignumRe!.isZero() || v.bignumIm!.isZero()).toBe(false);
        for (const e of relativeErrors(v, wantRe, wantIm))
          expect(e).toBeLessThan(tolerance);
      }
    );
  }

  test('only the digits of the double ln G are kept', () => {
    const engine = new ComputeEngine();
    expect(
      engine.parse('\\operatorname{BarnesG}(0.5+30i)').N().toString()
    ).toBe('(1.48501924951e-362 + 2.52832839715e-362i)');
  });

  // Γ shares the route, from ln Γ: mpmath.gamma(mpc(re, im)) at 40 digits.
  // `Factorial(z)` is Γ(z + 1). The double kernel gave 0 for the first two
  // and `~oo`, which reads as a pole, for the others.
  const gammaCases: [string, number, number, string, string, number][] = [
    [
      'Gamma',
      0.5,
      1000,
      '1.57066061457641173483029610551e-684',
      '1.6251473018203136842063038684e-682',
      1e-10,
    ],
    [
      'Gamma',
      -200.5,
      0.5,
      '9.89278019221151949555281168196e-377',
      '-5.27591870915292749281773404407e-377',
      1e-11,
    ],
    [
      'Gamma',
      200.5,
      0.5,
      '-4.9079258626343367844561471102e+373',
      '2.6331872181699454993025330951e+373',
      1e-11,
    ],
    [
      'Factorial',
      300,
      2,
      '1.22674475486466102643391562544e+614',
      '-2.78179033693280020814050811286e+614',
      1e-11,
    ],
    [
      'Factorial',
      -300.5,
      1,
      '1.28609375285617192321839099662e-614',
      '-8.41506546785366682694213200956e-615',
      1e-11,
    ],
  ];
  for (const digits of [21, 30]) {
    test.each(gammaCases)(
      `%s(%p + %pi) at precision ${digits}`,
      (head, re, im, wantRe, wantIm, tolerance) => {
        const engine = new ComputeEngine();
        engine.precision = digits;
        const v = engine.box([head, cx(re, im)]).N();
        expect(v.isExact).toBe(false);
        expect(v.bignumRe!.isZero() || v.bignumIm!.isZero()).toBe(false);
        for (const e of relativeErrors(v, wantRe, wantIm))
          expect(e).toBeLessThan(tolerance);
      }
    );
  }

  // A part much smaller than the modulus has fewer correct digits than the
  // modulus: each part is checked against its OWN mpmath value
  // (mpmath.gamma(mpc(re, im)) at 40 digits). A part with d significant
  // digits is good to 10^(1−d) of itself; a part below the error of the
  // modulus is dropped (printed as 0).
  const smallPartCases: [number, number, string, string][] = [
    [
      -200,
      1e-12,
      '6.72131161378250851497151486335e-375',
      '-1.26797695348096244725626373763e-363',
    ],
    [
      -200.5,
      1e-9,
      '-2.81146892278232750603892500342e-376',
      '-1.49100798365800391667758311968e-384',
    ],
    [
      -300.5,
      1e-6,
      '-5.91893997697040637819897081808e-616',
      '-3.37800458214343657492472376704e-621',
    ],
    [
      0.5,
      1000,
      '1.57066061457641173483029610551e-684',
      '1.6251473018203136842063038684e-682',
    ],
  ];
  test.each(smallPartCases)(
    'Gamma(%p + %pi): each part keeps only its correct digits',
    (re, im, wantRe, wantIm) => {
      const engine = new ComputeEngine();
      const v = engine.box(['Gamma', cx(re, im)]).N();
      const want = [new BigDecimal(wantRe), new BigDecimal(wantIm)];
      const modulus = want[0].mul(want[0]).add(want[1].mul(want[1])).sqrt();
      const got = [v.bignumRe!, v.bignumIm!];
      for (let k = 0; k < 2; k++) {
        if (got[k].isZero()) {
          expect(want[k].abs().div(modulus).toNumber()).toBeLessThan(1e-10);
          continue;
        }
        const digits = got[k].significand.toString().replace('-', '').length;
        const error = got[k].sub(want[k]).abs().div(want[k].abs()).toNumber();
        expect(error).toBeLessThan(10 ** (1 - digits));
      }
    }
  );

  test('a real Γ and the poles of Γ do not take this route', () => {
    const engine = new ComputeEngine();
    // mpmath.gamma(200.5) at 30 digits: the bignum kernel, all 21 digits.
    expect(engine.box(['Gamma', 200.5]).N().toString()).toBe(
      '5.57316894480137913364e+373'
    );
    expect(engine.box(['Gamma', -3]).N().toString()).toBe('~oo');
    expect(engine.box(['Gamma', 0]).N().toString()).toBe('~oo');
    expect(engine.box(['Factorial', -3]).N().toString()).toBe('~oo');
  });

  // mpmath.gamma(x + 1) at 32 digits. The double kernel gave `+oo` for
  // 200.5!, `0` for (-200.5)! and a 17-digit double for 2.5!.
  test.each([
    [200.5, 21, '1.1174203734326765163e+376'],
    [-200.5, 21, '5.63699519017856675668e-374'],
    [2.5, 21, '3.32335097044784255118'],
    [-2.5, 30, '2.36327180120735470306422331112'],
    [2.5, 30, '3.32335097044784255118406403126'],
  ])(
    'Factorial(%p) at precision %p is Γ(x + 1) at that precision',
    (x, digits, want) => {
      const engine = new ComputeEngine();
      engine.precision = digits;
      expect(engine.box(['Factorial', x]).N().toString()).toBe(want);
    }
  );

  test('an exact non-integer factorial stays symbolic under evaluate(), as Gamma does', () => {
    const engine = new ComputeEngine();
    for (const x of [
      ['Rational', 5, 2],
      ['Rational', -1, 2],
      ['Rational', 1, 3],
      ['Complex', 1, 1],
    ]) {
      expect(engine.box(['Factorial', x]).evaluate().operator).toBe(
        'Factorial'
      );
    }
    // Gamma of the same arguments has no closed form here either.
    expect(engine.box(['Gamma', ['Rational', 7, 2]]).evaluate().operator).toBe(
      'Gamma'
    );
    // .N() and a float operand give the float; integers stay exact.
    expect(
      engine
        .box(['Factorial', ['Rational', -1, 2]])
        .N()
        .toString()
    ).toBe('1.7724538509055160273');
    expect(engine.box(['Factorial', 2.5]).evaluate().isExact).toBe(false);
    expect(engine.box(['Factorial', 5]).evaluate().toString()).toBe('120');
  });

  // mpmath.factorial(n) at 32 digits. Past the exact digit cap the double
  // overflowed to +oo; above machine precision the value is a big decimal.
  test.each([
    [1e6, '8.26393168833124006238e+5565708'],
    [1e7, '1.20242340051590345614e+65657059'],
  ])('Factorial(%p).N() past the exact cap', (n, want) => {
    const engine = new ComputeEngine();
    expect(engine.box(['Factorial', n]).N().toString()).toBe(want);
    expect(engine.box(['Factorial', n]).evaluate().operator).toBe('Factorial');
    const machine = new ComputeEngine();
    machine.precision = 'machine';
    expect(machine.box(['Factorial', n]).N().toString()).toBe('+oo');
  });

  // mpmath.fac2(n) at 32 digits, for an odd and an even n past the cap.
  test.each([
    [1000001, '8.12014473058435753146378456013e+2782858'],
    [1000000, '1.01770845550781491955086629766e+2782856'],
  ])('Factorial2(%p).N() past the exact cap at precision 30', (n, want) => {
    const engine = new ComputeEngine();
    engine.precision = 30;
    expect(engine.box(['Factorial2', n]).N().toString()).toBe(want);
  });

  // Past the exponent range of a big decimal (about ±9·10¹⁵ in the decimal
  // exponent) the big-decimal Γ saturates to 0 or infinity. Γ has no zeros,
  // so an underflow to 0 gives no value: the expression stays unevaluated.
  // An overflow is `+oo`, as a double overflow is ("too large" is true).
  test.each([
    ['Gamma', -1e15 - 0.5],
    ['Factorial', -1e15 - 0.5],
  ])(
    '%s(%p).N() underflows past the big-decimal range: unevaluated',
    (head, x) => {
      const engine = new ComputeEngine();
      expect(engine.box([head, x]).N().operator).toBe(head);
    }
  );
  test.each([
    ['Gamma', 1e15 + 0.5],
    ['Factorial', 1e15],
  ])('%s(%p).N() overflows past the big-decimal range: +oo', (head, x) => {
    const engine = new ComputeEngine();
    expect(engine.box([head, x]).N().toString()).toBe('+oo');
  });
  test('a complex value past the big-decimal range stays unevaluated', () => {
    const engine = new ComputeEngine();
    expect(engine.box(['Gamma', ['Complex', 1e15, 1]]).N().operator).toBe(
      'Gamma'
    );
  });

  test('Γ at a large argument and a high precision stops at the time limit', () => {
    // The Bernoulli table for precision 3000 takes about 30 s to build.
    const engine = new ComputeEngine();
    engine.precision = 3000;
    const started = Date.now();
    expect(() =>
      engine.withTimeLimit({ ms: 200, label: 'test:gamma' }, () =>
        engine.box(['Factorial', 1e7]).N()
      )
    ).toThrow(/Timeout|exceeded|time/i);
    expect(Date.now() - started).toBeLessThan(5000);
  }, 30_000);
});

describe('LogBarnesG(z)', () => {
  test('exact at the integers: ln G(4) = ln 2, ln G(3) = 0, -Infinity at the zeros', () => {
    expect(ce.expr(['LogBarnesG', 4]).evaluate().toString()).toBe('ln(2)');
    expect(ce.expr(['LogBarnesG', 3]).evaluate().toString()).toBe('0');
    for (const n of [0, -1, -4])
      expect(ce.expr(['LogBarnesG', n]).evaluate().toString()).toBe('-oo');
  });

  const reals: [number, number][] = [
    [0.5, -0.5054330544894583],
    [0.7, -0.21458989707508636],
    [10.5, 42.2788836367952],
    [100.5, 15437.05347433899],
    [1000.5, 2701842.3633383457],
  ];
  for (const [x, want] of reals) {
    test(`LogBarnesG(${x}) = ${want}`, () => {
      const v = value(['LogBarnesG', x]);
      expect(Math.abs(v.re - want) / Math.abs(want)).toBeLessThan(1e-11);
      expect(v.im).toBe(0);
    });
  }

  // Wolfram LogBarnesG: the imaginary part is the LogGamma continuation's, not principal
  const complexCases: [number, number, number, number][] = [
    [-0.5, 0, -1.7709451779743404, Math.PI],
    [-2.5, 0, -2.5747484768531463, 18.84955592153876],
    [-7.3, 0, 17.37686079473098, 113.09733552923255],
    [-0.5, 2, 5.533620186358623, 1.4663109578067253],
    [-3.2, -1.5, 13.443648852790258, -22.711229551004415],
    [2.5, 4, -5.850569278201129, -5.045275983478572],
    [-10.5, -30, -98.94517136000673, 1395.66572449799],
    [0.3, -40, -1707.3335793168346, 1294.9142285694595],
  ];
  for (const [re, im, wre, wim] of complexCases) {
    test(`LogBarnesG(${re}${im === 0 ? '' : ` + ${im}i`}) = ${wre.toFixed(4)} + ${wim.toFixed(4)}i`, () => {
      expectClose(
        value(['LogBarnesG', im === 0 ? re : cx(re, im)]),
        [wre, wim],
        1e-9
      );
    });
  }

  test('real arguments follow ce.precision', () => {
    withPrecision(30, () => {
      // ln of mpmath.barnesg(1/2) at 30 digits
      const v = ce
        .expr(['LogBarnesG', ['Rational', 1, 2]])
        .N()
        .toString();
      expect(v.slice(0, 20)).toBe('-0.505433054489695382'.slice(0, 20));
    });
  });

  // mpmath log(barnesg(x)) at 80 digits. ln G is 0 at x = 1 and x = 2, so the
  // value must be formed in the log domain: the logarithm of a G rounded to
  // 30 digits has only about 18 correct digits here.
  test.each([
    ['1.0000000001', '4.18938533125811958540736206931e-11'],
    ['0.9999999999', '-4.18938533283533525030889492992e-11'],
    ['2.0000000001', '-1.58277131693474198727371417671e-11'],
    ['3.0000000001', '2.64507203437239644007854291059e-11'],
  ])('LogBarnesG(%s) next to a zero of ln G, at 30 digits', (x, expected) => {
    withPrecision(30, () => {
      expect(ce.parse(x).evaluate().isExact).toBe(false);
      const v = ce.function('LogBarnesG', [ce.parse(x)]).N();
      expect(v.toString()).toBe(expected);
    });
  });

  test('ln G(z+1) = lnΓ(z) + ln G(z), with the LogGamma continuation', () => {
    for (const z of [cx(-2.5, 1.5), cx(-4.5, -2), -3.5, 0.5]) {
      const lhs = value(['LogBarnesG', ['Add', z, 1]]);
      const a = value(['LogGamma', z]);
      const b = value(['LogBarnesG', z]);
      expectClose(lhs, [a.re + b.re, a.im + b.im], 1e-11);
    }
  });

  test('+Infinity; a symbol stays symbolic', () => {
    expect(
      ce.expr(['LogBarnesG', 'PositiveInfinity']).evaluate().toString()
    ).toBe('+oo');
    expect(ce.expr(['LogBarnesG', 'z']).evaluate().json).toEqual([
      'LogBarnesG',
      'z',
    ]);
  });
});

describe('BarnesG at high precision, and float operands', () => {
  // mpmath (150 digits): barnesg(999.5), log(barnesg(1/3)), barnesg(-20.3).
  test.each([
    [
      999.5,
      'BarnesG',
      '1.3321807301319757668573393898293890882275019991132579e+1170832',
    ],
    [
      ['Rational', 1, 3],
      'LogBarnesG',
      '-0.91609444341307506948956991736128110462324466486453037',
    ],
    [
      -20.3,
      'BarnesG',
      '-2.4126673083887645806276529473860405235431149285645886e+149',
    ],
  ])('%j: %s at 54 digits', (x, head, expected) => {
    const ce54 = new ComputeEngine();
    ce54.precision = 54;
    const v = ce54.box([head, x as never]).N();
    const got = String(v.bignumRe);
    const [m1, e1 = '0'] = got.split('e');
    const [m2, e2 = '0'] = expected.split('e');
    expect(e1).toBe(e2);
    // Agreement to 52 significant digits.
    expect(m1.replace(/[-.]/g, '').slice(0, 52)).toBe(
      m2.replace(/[-.]/g, '').slice(0, 52)
    );
  });

  test('a float operand at a zero of G gives the float 0', () => {
    const ce = new ComputeEngine();
    for (const x of ['-2.0', '0.0']) {
      const v = ce.function('BarnesG', [ce.parse(x)]).evaluate();
      expect(v.isExact).toBe(false); // not the exact 0
      expect(v.re).toBe(0);
    }
    expect(ce.box(['BarnesG', -2]).evaluate().isSame(0)).toBe(true);
  });
});

describe('the double ln Γ kernel next to 0, 1 and 2', () => {
  // mpmath loggamma at the double values of the arguments.
  test.each([
    [1e-10, 23.025850929882735237],
    [1 + 2 ** -33, -6.719674738191360331e-11],
    [2 - 2 ** -33, -4.9218574429504461111e-11],
    [0.3, 1.0957979948180755217],
  ])('GammaLn(%p) at machine precision', (x, expected) => {
    const ce = new ComputeEngine();
    ce.precision = 'machine';
    const v = ce.box(['GammaLn', x]).N().re;
    expect(Math.abs(v - expected)).toBeLessThan(4e-16 * Math.abs(expected));
    const w = ce.box(['LogGamma', x]).N().re;
    expect(Math.abs(w - expected)).toBeLessThan(4e-16 * Math.abs(expected));
  });
});
