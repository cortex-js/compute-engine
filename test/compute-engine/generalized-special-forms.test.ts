import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { PythonTarget } from '../../src/compute-engine/compilation/python-target';
import { GLSLTarget } from '../../src/compute-engine/compilation/glsl-target';
import type { MathJsonExpression } from '../../src/math-json/types';
import type { Expression } from '../../src/compute-engine/global-types';

//
// The incomplete and generalized call forms Wolfram gives Beta,
// BetaRegularized, Erf, ErfInv, Gamma and GammaRegularized, and the
// one-operand PolyGamma. The reference values are Wolfram Language's, at 30
// digits; each is also an identity of DLMF 7.2, 8.2, 8.17 and 5.15.
//

const ce = new ComputeEngine();
ce.precision = 30;

const R = (p: number, q: number): MathJsonExpression => ['Rational', p, q];

/** Is `actual` within `tolerance` of the reference `expected`, relative to it? */
const near = (actual: Expression, expected: string, tolerance = 1e-27) => {
  const want = ce.number(expected);
  if (want.isSame(0)) return expect(actual.toString()).toBe('0');
  const error = actual.sub(want).abs().div(want.abs());
  return expect(error.re).toBeLessThan(tolerance);
};

describe('Beta(z, a, b) and Beta(z0, z1, a, b): exact', () => {
  const cases: [MathJsonExpression, string][] = [
    [['Beta', R(1, 2), 2, 3], '11/192'],
    [['Beta', R(1, 4), R(1, 2), 2, 3], '109/3072'],
    [['Beta', R(1, 2), 1, 3], '7/24'],
    [['Beta', 1, 2, 3], '1/12'],
    [['Beta', 0, 2, 3], '0'],
    // The polynomial is the value past the unit interval too.
    [['Beta', 2, 3, 4], '-4/5'],
    [
      ['Beta', R(999999, 1000000), R(9999991, 10000000), 2, 3],
      '10839989683/12e+28',
    ],
  ];
  for (const [json, expected] of cases) {
    test(`${JSON.stringify(json)} = ${expected} (evaluate)`, () => {
      expect(ce.expr(json).evaluate().toString()).toBe(expected);
    });
    test(`${JSON.stringify(json)} agrees with N()`, () => {
      const exact = ce.expr(json).evaluate().N();
      expect(ce.expr(json).N().toString()).toBe(exact.toString());
    });
  }

  test('the parse route reads \\mathrm{B}(z, a, b) and \\mathrm{B}(z0, z1, a, b)', () => {
    expect(ce.parse('\\mathrm{B}(\\frac12, 2, 3)').evaluate().toString()).toBe(
      '11/192'
    );
    expect(
      ce.parse('\\mathrm{B}(\\frac14, \\frac12, 2, 3)').evaluate().toString()
    ).toBe('109/3072');
    // Two operands stay the complete beta, and `\mathrm{B}(x+1)` a symbol applied.
    expect(ce.parse('\\mathrm{B}(2, 3)').evaluate().toString()).toBe('1/12');
  });

  test('a compound endpoint that reduces to a literal', () => {
    const half = ['Subtract', 1, R(1, 2)] as MathJsonExpression;
    expect(ce.expr(['Beta', half, 2, 3]).evaluate().toString()).toBe('11/192');
  });
});

describe('Beta(z, a, b) and Beta(z0, z1, a, b): N() against Wolfram', () => {
  const cases: [MathJsonExpression, string][] = [
    [['Beta', R(3, 10), R(5, 2), R(3, 2)], '0.0174640592059929574113549208'],
    [
      ['Beta', R(3, 10), R(7, 10), R(5, 2), R(3, 2)],
      '0.0972653627079944024889727091',
    ],
    [['Beta', R(1, 2), R(3, 4), R(1, 2), 3], '0.0473613999352192239776839652'],
    // z0 and z1 close: the difference cancels, and the result keeps its digits.
    [
      ['Beta', R(2, 10), R(2000001, 10000000), 2, 3],
      '1.28000015999995333333583333333e-8',
    ],
  ];
  for (const [json, expected] of cases) {
    test(`N(${JSON.stringify(json)}) = ${expected}`, () => {
      near(ce.expr(json).N(), expected);
    });
  }

  test('a float operand evaluates numerically under evaluate()', () => {
    expect(ce.expr(['Beta', 0.2, 0.5, 2, 3]).evaluate().toString()).toBe(
      '0.042225'
    );
    expect(ce.expr(['Beta', 0.5, 0.5, 0.5]).evaluate().toString()).toBe(
      '1.57079632679489661923132169164'
    );
  });

  test('stays unevaluated where there is no value to give', () => {
    const stays: MathJsonExpression[] = [
      ['Beta', 'x', 2, 3],
      ['Beta', R(1, 2), 0, 3], // B_z(0, b) is a pole of the integral
      ['Beta', R(1, 2), -1, 3],
      ['Beta', 2.5, 1, 3], // outside [0, 1], with a float
      ['Beta', ['Complex', 1, 1], 1, 2, 3],
    ];
    for (const json of stays) {
      for (const route of ['evaluate', 'N'] as const) {
        expect(ce.expr(json)[route]().operator).toBe('Beta');
      }
    }
  });

  test('the type of a call over reals in the unit interval is real', () => {
    expect(ce.expr(['Beta', 0.3, 2.5, 1.5]).type.toString()).toBe('real');
    expect(ce.expr(['Beta', 'x', 2, 3]).type.toString()).toBe('number');
  });
});

describe('BetaRegularized(z0, z1, a, b)', () => {
  const cases: [MathJsonExpression, string][] = [
    [['BetaRegularized', R(1, 5), R(1, 2), 2, 3], '0.5067'],
    [
      ['BetaRegularized', R(3, 10), R(7, 10), R(5, 2), R(3, 2)],
      '0.4953684245313090539899174583',
    ],
    [['BetaRegularized', R(1, 2), R(1, 2), 2, 3], '0'],
    // Both endpoints near 1: the complement keeps the digits.
    [
      ['BetaRegularized', R(99999, 100000), R(999991, 1000000), 2, 3],
      '1.083989683e-15',
    ],
  ];
  for (const [json, expected] of cases) {
    test(`N(${JSON.stringify(json)}) = ${expected}`, () => {
      near(ce.expr(json).N(), expected);
    });
  }

  test('is the difference of the three-operand calls', () => {
    const [z0, z1] = [0.2, 0.5];
    const four = ce.expr(['BetaRegularized', z0, z1, 2, 3]).N();
    const diff = ce
      .expr([
        'Subtract',
        ['BetaRegularized', z1, 2, 3],
        ['BetaRegularized', z0, 2, 3],
      ])
      .N();
    expect(four.toString()).toBe(diff.toString());
    expect(four.toString()).toBe('0.5067');
  });

  test('the reverse order is the negative', () => {
    expect(
      ce.expr(['BetaRegularized', 0.5, 0.2, 2, 3]).evaluate().toString()
    ).toBe('-0.5067');
  });

  test('exact operands stay exact under evaluate() and number under N()', () => {
    // I_{1/2}(2, 3) - I_{1/5}(2, 3) = 11/16 - 113/625
    const e = ce.expr(['BetaRegularized', R(1, 5), R(1, 2), 2, 3]);
    expect(e.evaluate().toString()).toBe('5067/10000');
    expect(e.N().toString()).toBe('0.5067');
  });

  test('an endpoint outside the unit interval takes the continuation', () => {
    // I_{1.5}(2, 3) - I_{0.5}(2, 3) = 1.6875 - 0.6875
    const v = ce.expr(['BetaRegularized', 0.5, 1.5, 2, 3]).evaluate();
    expect(v.re).toBe(1);
    expect(v.isExact).toBe(false);
  });
});

describe('Erf(z0, z1)', () => {
  const cases: [MathJsonExpression, string][] = [
    [['Erf', R(1, 2), R(3, 2)], '0.445605268662264189384229607754'],
    [['Erf', R(-1, 10), R(1, 2)], '0.632962793831331429886021725636'],
    [['Erf', 5, R(51, 10)], '9.88077772672504890487691189637e-13'],
    [['Erf', -3, R(-5, 2)], '0.000384861520446373498191439610393'],
    // Both operands far into the tail: erf(30) is 1 − 1e-393.
    [
      ['Erf', 30, ['Add', 30, R(1, 10000000)]],
      '1.53964304147624745459047371679e-398',
    ],
    [
      ['Erf', -30, ['Subtract', -30, R(1, 10000000)]],
      '-1.53964304147624745459047371679e-398',
    ],
  ];
  for (const [json, expected] of cases) {
    test(`N(${JSON.stringify(json)}) = ${expected}`, () => {
      near(ce.expr(json).N(), expected);
    });
  }

  test('is erf(z1) − erf(z0), by the float route', () => {
    near(
      ce.expr(['Erf', 0.1, 0.5]).evaluate(),
      '0.408036961794761645479471582148'
    );
  });

  test('the same endpoint twice is 0', () => {
    expect(ce.expr(['Erf', 1, 1]).evaluate().toString()).toBe('0');
    expect(ce.expr(['Erf', 0.5, 0.5]).N().toString()).toBe('0');
  });

  test('the infinities, exactly', () => {
    expect(
      ce
        .expr(['Erf', 'NegativeInfinity', 'PositiveInfinity'])
        .evaluate()
        .toString()
    ).toBe('2');
    expect(ce.expr(['Erf', 0, 'PositiveInfinity']).evaluate().toString()).toBe(
      '1'
    );
  });

  test('endpoints that differ below the working precision keep their digits', () => {
    const tiny = [
      'Add',
      1,
      ['Divide', 1, ['Power', 10, 100]],
    ] as MathJsonExpression;
    // d/dz erf(z) at 1 is 2 exp(−1)/√π
    near(ce.expr(['Erf', 1, tiny]).N(), '4.1510749742059470334e-101', 1e-18);
  });

  test('a call whose cancellation exceeds the guard digits stays unevaluated', () => {
    const tiny = [
      'Add',
      1,
      ['Divide', 1, ['Power', 10, 600]],
    ] as MathJsonExpression;
    expect(ce.expr(['Erf', 1, tiny]).N().operator).toBe('Erf');
  });

  test('a complex endpoint', () => {
    const [z0, z1] = [
      ['Complex', 1, 1],
      ['Complex', 1, 2],
    ] as MathJsonExpression[];
    const n = ce.expr(['Erf', z0, z1]).N();
    const d = ce.expr(['Subtract', ['Erf', z1], ['Erf', z0]]).N();
    expect(Math.abs(n.re - d.re)).toBeLessThan(1e-12);
    expect(Math.abs(n.im - d.im)).toBeLessThan(1e-12);
  });

  test('a symbolic endpoint stays unevaluated', () => {
    expect(ce.expr(['Erf', 'x', 3]).evaluate().toString()).toBe('Erf(x, 3)');
  });

  test('at machine precision', () => {
    // The precision is the engine class's, so it is restored.
    ce.precision = 'machine';
    try {
      expect(ce.expr(['Erf', 0.1, 0.5]).N().re).toBeCloseTo(
        0.4080369617947618,
        14
      );
      const tiny = [
        'Add',
        1,
        ['Divide', 1, ['Power', 10, 10]],
      ] as MathJsonExpression;
      expect(
        ce.expr(['Erf', 1, tiny]).N().re / 4.151074973790839e-11
      ).toBeCloseTo(1, 12);
    } finally {
      ce.precision = 30;
    }
  });
});

describe('ErfInv(z0, z)', () => {
  const cases: [MathJsonExpression, string][] = [
    [['ErfInv', R(1, 10), R(1, 2)], '0.611005659544653217158543263557'],
    [['ErfInv', R(-1, 10), R(3, 10)], '0.167761022727888387840507600379'],
    // erf(x) = 0.99999209...: x² costs about 4 digits of the sum.
    [['ErfInv', -3, R(199997, 100000)], '3.15908366012927703817357538365'],
  ];
  for (const [json, expected] of cases) {
    test(`N(${JSON.stringify(json)}) = ${expected}`, () => {
      near(ce.expr(json).N(), expected);
    });
  }

  test('solves Erf(z0, x) = z', () => {
    const [z0, z] = [R(1, 10), R(1, 2)];
    const x = ce.expr(['ErfInv', z0, z]).N();
    const back = ce.expr(['Erf', z0, x.json as MathJsonExpression]).N();
    expect(Math.abs(back.re - 0.5)).toBeLessThan(1e-25);
  });

  test('ErfInv(0, z) is ErfInv(z)', () => {
    expect(ce.expr(['ErfInv', 0, 0.5]).evaluate().toString()).toBe(
      ce.expr(['ErfInv', 0.5]).evaluate().toString()
    );
  });

  test('a sum outside (−1, 1) stays unevaluated', () => {
    expect(ce.expr(['ErfInv', 0.1, 0.9]).evaluate().operator).toBe('ErfInv');
    expect(ce.expr(['ErfInv', 3, 0.5]).N().operator).toBe('ErfInv');
  });

  test('exact operands stay unevaluated under evaluate()', () => {
    expect(ce.expr(['ErfInv', R(1, 10), R(1, 2)]).evaluate().operator).toBe(
      'ErfInv'
    );
  });
});

describe('Gamma(a, z0, z1) and GammaRegularized(a, z0, z1)', () => {
  const gamma: [MathJsonExpression, string][] = [
    [['Gamma', 2, 1, 3], '0.536610608871428871273677877723'],
    [['Gamma', R(1, 2), 1, 3], '0.253449075957198533309670721079'],
    [['Gamma', -2, 1, 3], '0.108699673135979834018925116555'],
    [['Gamma', 3, 1, R(10001, 10000)], '0.0000367897834530353164981925669392'],
    // z0 = 0: the lower incomplete gamma, 1 − 2/e.
    [['Gamma', 2, 0, 1], '0.264241117657115356808952459677'],
    [['Gamma', R(1, 2), R(1, 3), R(2, 3)], '0.294232832532524176955786883441'],
  ];
  for (const [json, expected] of gamma) {
    test(`N(${JSON.stringify(json)}) = ${expected}`, () => {
      near(ce.expr(json).N(), expected);
    });
  }

  const regularized: [MathJsonExpression, string][] = [
    [['GammaRegularized', R(5, 2), 1, 3], '0.542926117671331235346502822890'],
    [['GammaRegularized', 2, 0, 3], '0.800851726528544228082630337400'],
    [['GammaRegularized', 2, 1, 3], '0.536610608871428871273677877723'],
    [
      ['GammaRegularized', R(1, 2), 30, 31],
      '6.05116443910284255354970685282e-15',
    ],
  ];
  for (const [json, expected] of regularized) {
    test(`N(${JSON.stringify(json)}) = ${expected}`, () => {
      near(ce.expr(json).N(), expected);
    });
  }

  test('Γ(2, 1, 3) = 2/e − 4/e³ (DLMF 8.4.7 at a = 2)', () => {
    const e = Math.E;
    expect(ce.expr(['Gamma', 2, 1, 3]).N().re).toBeCloseTo(
      2 / e - 4 / e ** 3,
      14
    );
  });

  test('the infinite upper endpoint, exactly', () => {
    expect(
      ce.expr(['Gamma', 2, 0, 'PositiveInfinity']).evaluate().toString()
    ).toBe('1');
  });

  test('exact operands under evaluate(): only where both terms fold', () => {
    expect(ce.expr(['Gamma', 2, 1, 3]).evaluate().operator).toBe('Gamma');
    expect(ce.expr(['Gamma', 'a', 1, 2]).evaluate().operator).toBe('Gamma');
  });

  test('the same endpoint twice is 0', () => {
    expect(ce.expr(['Gamma', 3, 1, 1]).N().toString()).toBe('0');
    expect(ce.expr(['GammaRegularized', 2, 1, 1]).N().toString()).toBe('0');
  });

  test('a term with no finite value stays unevaluated', () => {
    // Q(−1/2, 0) is infinite: no difference to give.
    expect(ce.expr(['GammaRegularized', -0.5, 0, 1]).N().operator).toBe(
      'GammaRegularized'
    );
  });

  test('endpoints that differ below the working precision keep their digits', () => {
    const tiny = [
      'Add',
      1,
      ['Divide', 1, ['Power', 10, 100]],
    ] as MathJsonExpression;
    // −d/dz Γ(2, z) at 1 is e⁻¹
    near(
      ce.expr(['Gamma', 2, 1, tiny]).N(),
      '3.67879441171442321596e-101',
      1e-18
    );
  });

  test('the type of a call over non-negative reals is real', () => {
    expect(ce.expr(['GammaRegularized', 2, 1, 3]).type.toString()).toBe('real');
  });
});

describe('PolyGamma(z)', () => {
  test('is PolyGamma(0, z) (DLMF 5.15.1)', () => {
    // PolyGamma(0, 1) has the closed form -EulerGamma.
    expect(
      ce
        .expr(['PolyGamma', 1])
        .evaluate()
        .isSame(ce.expr(['PolyGamma', 0, 1]).evaluate())
    ).toBe(true);
    expect(ce.expr(['PolyGamma', 'x']).evaluate().toString()).toBe(
      'PolyGamma(0, x)'
    );
  });

  test('counts the operands of a spliced Sequence', () => {
    expect(ce.expr(['PolyGamma', ['Sequence', 1, 'x']]).toString()).toBe(
      'PolyGamma(1, x)'
    );
    expect(ce.expr(['PolyGamma', ['Sequence', 'x']]).toString()).toBe(
      'PolyGamma(0, x)'
    );
  });

  const cases: [MathJsonExpression, string][] = [
    [['PolyGamma', 1], '-0.577215664901532860606512090082'],
    [['PolyGamma', R(1, 3)], '-3.13203378002080632299641907429'],
  ];
  for (const [json, expected] of cases) {
    test(`N(${JSON.stringify(json)}) = ${expected}`, () => {
      near(ce.expr(json).N(), expected);
      expect(ce.expr(json).N().toString()).toBe(
        ce
          .expr(['PolyGamma', 0, (json as unknown[])[1] as MathJsonExpression])
          .N()
          .toString()
      );
    });
  }

  test('a complex operand', () => {
    const n = ce.expr(['PolyGamma', ['Complex', 1, 1]]).N();
    expect(n.re).toBeCloseTo(0.09465032062247698, 12);
    expect(n.im).toBeCloseTo(1.0766740474685812, 12);
  });

  test('the parse route', () => {
    expect(ce.parse('\\operatorname{PolyGamma}(1)').N().toString()).toBe(
      ce.expr(['PolyGamma', 0, 1]).N().toString()
    );
  });

  test('two operands are as before', () => {
    expect(ce.expr(['PolyGamma', 1, 1]).N().toString()).toBe(
      ce.expr(['Trigamma', 1]).N().toString()
    );
    expect(ce.expr(['PolyGamma', 1.5, 2]).evaluate().operator).toBe('Error');
  });

  test('broadcasts over a list', () => {
    expect(
      ce
        .expr(['PolyGamma', ['List', 1, 2]])
        .N()
        .toString()
    ).toBe(
      ce
        .expr(['List', ['PolyGamma', 0, 1], ['PolyGamma', 0, 2]])
        .N()
        .toString()
    );
  });
});

describe('the parse route reads the widened operand counts', () => {
  const cases: [string, MathJsonExpression][] = [
    ['\\mathrm{Erf}(0.1, 0.5)', ['Erf', 0.1, 0.5]],
    ['\\mathrm{ErfInv}(0.1, 0.5)', ['ErfInv', 0.1, 0.5]],
    ['\\mathrm{GammaRegularized}(2, 1, 3)', ['GammaRegularized', 2, 1, 3]],
    [
      '\\mathrm{BetaRegularized}(0.2, 0.5, 2, 3)',
      ['BetaRegularized', 0.2, 0.5, 2, 3],
    ],
    ['\\Gamma(2, 1, 3)', ['Gamma', 2, 1, 3]],
  ];
  for (const [latex, json] of cases) {
    test(`${latex} = ${JSON.stringify(json)}`, () => {
      expect(ce.parse(latex).N().toString()).toBe(ce.expr(json).N().toString());
      expect(ce.expr(json).N().isNumberLiteral).toBe(true);
    });
  }
});

describe('simplify()', () => {
  test('folds the exact and the float calls as evaluate() does', () => {
    expect(
      ce
        .expr(['Beta', R(1, 2), 2, 3])
        .simplify()
        .toString()
    ).toBe('11/192');
    near(
      ce.expr(['Erf', 0.1, 0.5]).simplify(),
      '0.408036961794761645479471582148'
    );
    expect(ce.expr(['Erf', 'x', 'y']).simplify().toString()).toBe('Erf(x, y)');
  });
});

describe('the widened shapes do not compile to the narrower lowerings', () => {
  const widened: MathJsonExpression[] = [
    ['Beta', 'x', 'a', 'b'],
    ['Beta', 'x', 'y', 'a', 'b'],
    ['BetaRegularized', 'x', 'y', 'a', 'b'],
    ['Erf', 'x', 'y'],
    ['ErfInv', 'x', 'y'],
    ['Gamma', 'a', 'x', 'y'],
    ['GammaRegularized', 'a', 'x', 'y'],
  ];
  for (const json of widened) {
    test(`${JSON.stringify(json)} declines on every target`, () => {
      const e = ce.expr(json);
      for (const to of ['javascript', 'interval-js'] as const)
        expect(compile(e, { to }).success).toBe(false);
      expect(() => compile(e, { to: 'javascript', fallback: false })).toThrow(
        /Could not compile/
      );
      expect(() =>
        new PythonTarget().compile(e, { constantFold: false })
      ).toThrow(/Could not compile/);
      expect(() => new GLSLTarget().compile(e)).toThrow();
    });
  }

  test('the native shapes still compile', () => {
    for (const json of [
      ['Beta', 'x', 'y'],
      ['BetaRegularized', 'x', 'a', 'b'],
      ['Erf', 'x'],
      ['ErfInv', 'x'],
      ['Gamma', 'a', 'x'],
      ['GammaRegularized', 'a', 'x'],
    ] as MathJsonExpression[]) {
      expect(
        compile(ce.expr(json), { to: 'javascript', fallback: false }).success
      ).toBe(true);
    }
  });

  test('PolyGamma(z) compiles as PolyGamma(0, z)', () => {
    const one = compile(ce.expr(['PolyGamma', 'x']), {
      to: 'javascript',
      fallback: false,
    });
    const two = compile(ce.expr(['PolyGamma', 0, 'x']), {
      to: 'javascript',
      fallback: false,
    });
    expect(one.code).toBe(two.code);
    expect(one.run?.({ x: 1 })).toBeCloseTo(-0.5772156649015329, 10);
  });
});
