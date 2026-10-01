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
    expect(ce.expr(['LogGamma', ['Rational', 1, 2]]).evaluate().toString()).toBe(
      '1/2 * ln(pi)'
    );
    expect(ce.expr(['LogGamma', ['Rational', 1, 3]]).evaluate().operator).toBe(
      'LogGamma'
    );
    expect(value(['LogGamma', 5]).re).toBeCloseTo(Math.log(24), 14);
    expect(value(['LogGamma', 2.5], false).re).toBeCloseTo(0.2846828704729192, 14);
  });

  test('real arguments follow ce.precision', () => {
    withPrecision(40, () => {
      expect(
        ce.expr(['LogGamma', ['Rational', 5, 2]]).N().toString().slice(0, 42)
      ).toBe('0.2846828704729191596324946696827019243201'.slice(0, 42));
    });
    withPrecision(30, () => {
      expect(
        ce.expr(['LogGamma', ['Rational', 1, 3]]).N().toString().slice(0, 30)
      ).toBe('0.985420646927767069187174036978'.slice(0, 30));
    });
  });

  test('infinities: +Infinity at +Infinity, Indeterminate at -Infinity (no limit)', () => {
    expect(ce.expr(['LogGamma', 'PositiveInfinity']).evaluate().toString()).toBe(
      '+oo'
    );
    expect(ce.expr(['LogGamma', 'NegativeInfinity']).evaluate().toString()).toBe(
      'Indeterminate'
    );
  });

  test('a symbol stays symbolic; a list threads', () => {
    expect(ce.expr(['LogGamma', 'z']).evaluate().json).toEqual(['LogGamma', 'z']);
    expect(
      ce.expr(['LogGamma', ['List', 1, 2, 0]]).evaluate().toString()
    ).toBe('[0,0,+oo]');
  });

  test('a compound argument that reduces to a literal, and simplify()', () => {
    const arg = ['Subtract', ['Add', 'x', 3], 'x'];
    expect(ce.expr(['LogGamma', arg]).evaluate().toString()).toBe('ln(2)');
    expect(
      ce.expr(['LogGamma', 3]).simplify().evaluate().toString()
    ).toBe('ln(2)');
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
        ce.expr(['BarnesG', ['Rational', 1, 2]]).N().toString().slice(0, 30)
      ).toBe('0.603244281209446206191429224535'.slice(0, 30));
    });
    withPrecision(25, () => {
      // mpmath.barnesg(mpf(-5)/2) = 0.0761729796568611111946819385757...
      const v = ce.expr(['BarnesG', ['Rational', -5, 2]]).N().toString();
      expect(v.slice(0, 26)).toBe('0.0761729796568611111946819385757'.slice(0, 26));
    });
  });

  test('the bignum kernel matches mpmath near a zero, to 50 digits', () => {
    withPrecision(50, () => {
      // mpmath.barnesg(mpf('-0.999')) at 60 digits
      const v = ce.expr(['BarnesG', { num: '-0.999' }]).N().toString();
      expect(v.slice(0, 46)).toBe(
        '-0.00000100057060006668485785397781844802368604'.slice(0, 46)
      );
    });
  });

  test('+Infinity; a symbol stays symbolic; past a double the value is left unevaluated', () => {
    expect(ce.expr(['BarnesG', 'PositiveInfinity']).evaluate().toString()).toBe(
      '+oo'
    );
    expect(ce.expr(['BarnesG', 'z']).evaluate().json).toEqual(['BarnesG', 'z']);
    expect(ce.expr(['BarnesG', 100.5]).N().operator).toBe('BarnesG');
  });

  test('a list threads; the hyperfactorial identity H(5) = Γ(6)^5 / G(6)', () => {
    expect(ce.expr(['BarnesG', ['List', 1, 4, 5]]).evaluate().toString()).toBe(
      '[1,2,12]'
    );
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
      const v = ce.expr(['LogBarnesG', ['Rational', 1, 2]]).N().toString();
      expect(v.slice(0, 20)).toBe('-0.505433054489695382'.slice(0, 20));
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
