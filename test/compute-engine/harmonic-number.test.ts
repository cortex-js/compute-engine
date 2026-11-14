import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { GLSLTarget } from '../../src/compute-engine/compilation/glsl-target';

//
// `HarmonicNumber(n)` and `HarmonicNumber(n, r)`, Wolfram's harmonic number
// (cortex-js/compute-engine#515). Reference values are mpmath's at 30 digits:
// `harmonic(n)` and `zeta(r) - zeta(r, n + 1)`.
//

const ce = new ComputeEngine();
ce.declare('hn_x', 'real');
ce.declare('hn_r', 'real');

const evaluate = (...expr: any[]) =>
  ce.box(['HarmonicNumber', ...expr]).evaluate();
const N = (...expr: any[]) => ce.box(['HarmonicNumber', ...expr]).N();
const re = (x: any) => x.re as number;

function expectClose(actual: number, expected: number, tol = 1e-14) {
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(
    tol * Math.max(1, Math.abs(expected))
  );
}

describe('HARMONIC NUMBER: exact values', () => {
  test.each([
    [[0], '0'],
    [[1], '1'],
    [[2], '3/2'],
    [[10], '7381/2520'],
    [[10, 1], '7381/2520'],
    [[10, 2], '1968329/1270080'],
    [[10, 3], '19164113947/16003008000'],
    [[5, 0], '5'],
    [[5, -1], '15'],
    [[0, 3], '0'],
  ])('HarmonicNumber(%j) = %s', (args, expected) => {
    expect(evaluate(...args).toString()).toBe(expected);
  });

  test('a negative integer is a pole, in both arities', () => {
    expect(evaluate(-1).toString()).toBe('~oo');
    expect(evaluate(-3).toString()).toBe('~oo');
    expect(evaluate(-2, 3).toString()).toBe('~oo');
    expect(N(-3).toString()).toBe('~oo');
  });

  test('H_n at a negative integer with r <= 0 is not claimed to be a pole', () => {
    expect(evaluate(-2, -1).operator).toBe('HarmonicNumber');
  });

  test('the harmonic series diverges and H_inf^(r) = zeta(r)', () => {
    expect(evaluate('PositiveInfinity').toString()).toBe('+oo');
    expect(evaluate('PositiveInfinity', 2).N().re).toBeCloseTo(
      Math.PI ** 2 / 6,
      12
    );
    expect(evaluate('NegativeInfinity').isNaN).toBe(true);
  });

  test('a symbolic argument stays symbolic', () => {
    expect(evaluate('n').toString()).toBe('HarmonicNumber(n)');
    expect(evaluate('n', 2).toString()).toBe('HarmonicNumber(n, 2)');
  });

  test('a non-integer or exact non-integer argument stays symbolic under evaluate()', () => {
    expect(evaluate(['Rational', 1, 2]).operator).toBe('HarmonicNumber');
    expect(evaluate(5, ['Rational', 1, 2]).operator).toBe('HarmonicNumber');
  });

  test('threads over a list', () => {
    expect(evaluate(['List', 2, 3, 5]).toString()).toBe('[3/2,11/6,137/60]');
  });
});

describe('HARMONIC NUMBER: numeric continuation (mpmath references)', () => {
  test.each([
    // [n, r, expected]
    [[2.5], 1.68037230554677604783220242375],
    [[0.5], 0.613705638880109381165535757084],
    [[['Rational', 1, 2]], 0.613705638880109381165535757084],
    [[['Rational', 7, 3]], 1.62375331345215510903866444437],
    [[-0.5], -1.38629436111989061883446424292],
    [[-2.5], 1.28037230554677604783220242375],
    [[10.5], 2.97545479443731447397434373617],
    [[0.33], 0.441523646937363545197516675785],
    [[2.5, 1], 1.68037230554677604783220242375],
    [['ExponentialE', 1], 1.75002138053654173357307165671],
    [[2.5, 2], 1.31457631074799157149961411115],
    [[0.5, 3], 0.787658581042434287601571030931],
    [[0.8, 3], 0.940124048948776996526100912956],
    [[['Rational', 1, 2], 2], 0.710131866303547127055169666708],
    [[5, ['Rational', 1, 2]], 3.23167064587613122819182787635],
    [[0.5, 0], 0.5],
  ] as [any[], number][])('N(HarmonicNumber(%j))', (args, expected) => {
    expectClose(re(N(...args)), expected);
  });

  test('an exact integer under N() is the exact sum, to the digits asked for', () => {
    expect(N(10).toString()).toBe('2.92896825396825396825');
    expectClose(re(N(10, 2)), 1.54976773116654069035021415974);
  });

  test('a float operand gives a float, also at an integer', () => {
    const v = evaluate(3.0);
    expect(v.isInteger).not.toBe(true);
    expectClose(re(v), 11 / 6);
    expect(evaluate(2.5).toString()).not.toContain('/');
  });

  test('complex n', () => {
    let v = N(['Complex', 3, 2]);
    expectClose(v.re, 1.97257641104474115649415119131);
    expectClose(v.im, 0.516961128796076382232241496007);
    v = N(['Complex', -1.5, 4]);
    expectClose(v.re, 1.99164559645282876021036214497);
    expectClose(v.im, 1.81695017291053611586344424707);
    v = N(['Complex', 0.2, -3]);
    expectClose(v.re, 1.69834790334515745997040590773);
    expectClose(v.im, -1.33955200399877045369109788629);
    v = N(['Complex', 3, 2], 2);
    expectClose(v.re, 1.42958870352384990109492545724);
    expectClose(v.im, 0.121819632987466434489258083636);
  });

  test('bignum precision', () => {
    const big = new ComputeEngine();
    big.precision = 30;
    expect(
      big
        .box(['HarmonicNumber', ['Rational', 1, 2]])
        .N()
        .toString()
    ).toBe('0.613705638880109381165535757084');
    expect(big.box(['HarmonicNumber', 2.5]).N().toString()).toMatch(
      /^1\.680372305546776047832202423/
    );
    expect(big.box(['HarmonicNumber', 10]).N().toString()).toBe(
      '2.92896825396825396825396825397'
    );
  });

  test('machine precision', () => {
    const machine = new ComputeEngine();
    machine.precision = 'machine';
    expectClose(
      re(machine.box(['HarmonicNumber', 2.5]).N()),
      1.680372305546776
    );
    expectClose(
      re(machine.box(['HarmonicNumber', 2.5, 2]).N()),
      1.3145763107479916
    );
    expectClose(
      re(machine.box(['HarmonicNumber', 10]).N()),
      2.9289682539682538
    );
  });

  test('the routes agree: evaluate() with a float, N() and the digamma identity', () => {
    for (const x of [0.25, 1.5, 7.75, -0.5, -3.25]) {
      const viaDigamma = ce.box(['Add', ['Digamma', x + 1], 'EulerGamma']).N();
      expectClose(re(evaluate(x)), re(viaDigamma));
      expectClose(re(N(x)), re(viaDigamma));
    }
  });

  test('a huge integer under N() still has a value', () => {
    expectClose(re(N(100_000_000)), 18.997896413853898, 1e-12);
  });
});

describe('HARMONIC NUMBER: work cap', () => {
  test('a count past the cap stays unevaluated, and N() continues through digamma', () => {
    const e = ce.box(['HarmonicNumber', 1_000_000]);
    expect(e.evaluate().operator).toBe('HarmonicNumber');
    expectClose(re(e.N()), 14.392726722865724, 1e-12);
  });

  test('a large order past the cap stays unevaluated; a small one is exact', () => {
    expect(evaluate(100_000, 50).operator).toBe('HarmonicNumber');
    expect(evaluate(1000).operator).toBe('Rational');
  });
});

describe('HARMONIC NUMBER: derivative', () => {
  test('d/dx H_x = Trigamma(x + 1)', () => {
    expect(
      ce
        .box(['D', ['HarmonicNumber', 'x'], 'x'])
        .evaluate()
        .toString()
    ).toBe('Trigamma(x + 1)');
  });
});

describe('HARMONIC NUMBER: LaTeX', () => {
  // `H_n` is an ordinary subscripted symbol, so the head keeps its
  // `\operatorname{HarmonicNumber}` spelling.
  test('H_n is a plain symbol, not the head', () => {
    expect(ce.parse('H_n').operator).not.toBe('HarmonicNumber');
  });

  test.each([
    [['HarmonicNumber', 'x']],
    [['HarmonicNumber', 'x', 2]],
    [['HarmonicNumber', 10]],
  ])('round trip %j', (expr) => {
    const e = ce.box(expr as any, { canonical: false });
    const back = ce.parse(e.latex, { canonical: false });
    expect(back.json).toEqual(e.json);
    expect(ce.parse('\\operatorname{HarmonicNumber}(x,2)').json).toEqual([
      'HarmonicNumber',
      'x',
      2,
    ]);
  });
});

describe('HARMONIC NUMBER: compiled', () => {
  const run = (expr: any, env: Record<string, number>) =>
    compile(ce.box(expr)).run!(env) as number;

  test('matches N() on the JavaScript target', () => {
    for (const x of [0.5, 2.5, 7.25, 10]) {
      expectClose(
        run(['HarmonicNumber', 'hn_x'], { hn_x: x }),
        re(N(x)),
        1e-13
      );
      expectClose(
        run(['HarmonicNumber', 'hn_x', 2], { hn_x: x }),
        re(N(x, 2)),
        1e-13
      );
      expectClose(
        run(['HarmonicNumber', 'hn_x', 'hn_r'], { hn_x: x, hn_r: 3 }),
        re(N(x, 3)),
        1e-13
      );
    }
  });

  test('a run-time order of 1 is the plain harmonic number', () => {
    expectClose(
      run(['HarmonicNumber', 'hn_x', 'hn_r'], { hn_x: 2.5, hn_r: 1 }),
      1.68037230554677604783,
      1e-14
    );
  });

  test('a pole compiles to Infinity, as Digamma does', () => {
    expect(run(['HarmonicNumber', 'hn_x'], { hn_x: -3 })).toBe(Infinity);
  });

  test('an exact integer folds at compile time', () => {
    expectClose(run(['HarmonicNumber', 10], {}), 7381 / 2520);
  });

  test('GLSL lowers through the digamma and Hurwitz helpers', () => {
    const target = new GLSLTarget();
    const one = target.compile(ce.box(['HarmonicNumber', 'hn_x']));
    expect(one.code).toContain('_gpu_digamma(hn_x + 1.0)');
    const two = target.compile(ce.box(['HarmonicNumber', 'hn_x', 2]));
    expect(two.code).toContain('_gpu_hurwitz_zeta(2.0, hn_x + 1.0)');
  });
});
