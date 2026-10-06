import { ComputeEngine } from '../../src/compute-engine';
import { isNumber } from '../../src/compute-engine/boxed-expression/type-guards';
import { executeEpsil } from '../../src/epsil/execute-epsil';
import type { MathJsonExpression } from '../../src/math-json/types';

// Complex values of `LambertW` (every integer branch), `Sinc`, `FresnelS` and
// `FresnelC`. Every reference value comes from mpmath (`lambertw(z, k)`,
// `sinc`, `fresnels`, `fresnelc`) at 30 digits, rounded to a double. The
// complex kernels compute in doubles at every engine precision.

// The machine engine is built first: building an engine sets the precision
// of `BigDecimal`, which is global to the module, so the engine built last
// decides the precision of the big-decimal kernels of both.
const machine = new ComputeEngine();
machine.precision = 'machine';
const ce = new ComputeEngine();

type Z = [re: number, im: number];

/** The value of `.N()`, as [re, im]. */
function numeric(engine: ComputeEngine, expr: any): Z {
  const v = engine.box(expr).N();
  if (!isNumber(v)) throw new Error(`not a number: ${v.toString()}`);
  return [v.re, v.im];
}

/** The relative error of `actual` against `expected`, in the modulus. */
function relativeError(actual: Z, expected: Z): number {
  return (
    Math.hypot(actual[0] - expected[0], actual[1] - expected[1]) /
    Math.hypot(expected[0], expected[1])
  );
}

function complex([re, im]: Z): any {
  return ['Complex', { num: re.toString() }, { num: im.toString() }];
}

describe('SINC OF A COMPLEX ARGUMENT', () => {
  const cases: [Z, Z][] = [
    [
      [0.3, 0.4],
      [1.0112251726220998, -0.04027794738733693],
    ],
    [
      [-1.5, 2.5],
      [1.2053327476258056, 1.7235715563722418],
    ],
    [
      [-3, -4],
      [-3.8602415567303043, -3.8586156770275726],
    ],
    [
      [7, -0.5],
      [0.10928474102183242, -0.04831607928979042],
    ],
    [
      [1e-6, 2e-6],
      [1.0000000000005, -6.666666666668666e-13],
    ],
    [
      [40, 25],
      [212472297.70168966, -733080285.9828357],
    ],
    [
      [-150, 300],
      [8.852610670314299e126, -2.7569552772615776e127],
    ],
  ];
  test.each(cases)('Sinc(%p)', (z, expected) => {
    for (const engine of [ce, machine])
      expect(
        relativeError(numeric(engine, ['Sinc', complex(z)]), expected)
      ).toBeLessThan(1e-15);
  });

  test('on the imaginary axis sinc(iy) = sinh(y)/y, a real value', () => {
    for (const [y, expected] of [
      [0.7, 1.083691002627905],
      [-2.5, 2.420081792415915],
      [6, 33.61885956171321],
    ]) {
      for (const engine of [ce, machine]) {
        const [re, im] = numeric(engine, ['Sinc', complex([0, y])]);
        expect(im).toBe(0);
        expect(Math.abs(re - expected) / expected).toBeLessThan(1e-15);
      }
    }
  });

  test('a real value past the range of doubles is +oo, a complex one stays unevaluated', () => {
    expect(
      machine
        .box(['Sinc', complex([0, 800])])
        .N()
        .toString()
    ).toBe('+oo');
    expect(
      machine
        .box(['Sinc', complex([0, -800])])
        .N()
        .toString()
    ).toBe('+oo');
    // Above machine precision the value is a big decimal, and finite.
    expect(ce.box(['Sinc', complex([0, 800])]).N().isFinite).toBe(true);
    expect(machine.box(['Sinc', complex([800, 800])]).N().operator).toBe(
      'Sinc'
    );
  });

  test('an exact argument stays symbolic under evaluate(), a float argument numericizes', () => {
    expect(ce.box(['Sinc', ['Complex', 1, 2]]).evaluate().operator).toBe(
      'Sinc'
    );
    expect(ce.box(['Sinc', 'ImaginaryUnit']).evaluate().operator).toBe('Sinc');
    const v = ce.box(['Sinc', complex([-1.5, 2.5])]).evaluate();
    expect(isNumber(v)).toBe(true);
    // `.N()` of the exact argument numericizes.
    expect(
      relativeError(
        numeric(ce, ['Sinc', ['Complex', -3, -4]]),
        [-3.8602415567303043, -3.8586156770275726]
      )
    ).toBeLessThan(1e-15);
  });
});

describe('FRESNEL INTEGRALS OF A COMPLEX ARGUMENT', () => {
  // [z, S(z), C(z), tolerance]. The tolerance is wider where the value is
  // large: there the relative condition number π|z|² of S and C is large.
  const cases: [Z, Z, Z, number][] = [
    [
      [0.3, 0.4],
      [-0.06196900546543961, 0.022887067189849987],
      [0.30055861361495256, 0.40773704648580733],
      1e-15,
    ],
    [
      [-1.2, 0.9],
      [-0.29395064467166715, 3.667402578202366],
      [-4.16942294537244, 0.19997158049112368],
      1e-15,
    ],
    [
      [-2.5, -1.5],
      [6416.736429694621, -3666.1960768401536],
      [-3666.6960764131813, -6417.236429006955],
      1e-13,
    ],
    [
      [3, -2],
      [3788100.700182895, -5815898.602940469],
      [5815899.102940469, 3788100.2001828956],
      1e-13,
    ],
    [
      [1e-5, -2e-5],
      [-5.759586531581289e-15, 1.047197551196598e-15],
      [1e-5, -2e-5],
      1e-15,
    ],
    [
      [0.8, 1.7],
      [4.411894877756889, -5.228428565954401],
      [-4.7262215662673475, -3.911694732515587],
      1e-14,
    ],
    [
      [12, 0.5],
      [-1909473.6020077658, -704069.5674386465],
      [-704069.0674386465, 1909474.1020077656],
      1e-12,
    ],
    [
      [-50, 0.001],
      [-0.49355510114569506, -5.274802561563667e-10],
      [-0.49999918936887366, 0.0010041174115385486],
      1e-12,
    ],
  ];
  test.each(cases)('FresnelS and FresnelC at %p', (z, s, c, tolerance) => {
    for (const engine of [ce, machine]) {
      expect(
        relativeError(numeric(engine, ['FresnelS', complex(z)]), s)
      ).toBeLessThan(tolerance);
      expect(
        relativeError(numeric(engine, ['FresnelC', complex(z)]), c)
      ).toBeLessThan(tolerance);
    }
  });

  test('on the imaginary axis S(iy) = −i·S(y) and C(iy) = i·C(y)', () => {
    for (const [y, s, c] of [
      [0.7, 0.17213645786347742, 0.6596523519045103],
      [-2.5, -0.6191817558195929, -0.45741300964177706],
      [6, 0.4469607612369303, 0.4995314678555011],
    ]) {
      for (const engine of [ce, machine]) {
        const [sRe, sIm] = numeric(engine, ['FresnelS', complex([0, y])]);
        expect(sRe).toBe(0);
        expect(Math.abs(sIm + s) / Math.abs(s)).toBeLessThan(1e-15);
        const [cRe, cIm] = numeric(engine, ['FresnelC', complex([0, y])]);
        expect(cRe).toBe(0);
        expect(Math.abs(cIm - c) / Math.abs(c)).toBeLessThan(1e-15);
      }
    }
  });

  test('a value past the range of doubles stays unevaluated', () => {
    expect(machine.box(['FresnelS', complex([30, 30])]).N().operator).toBe(
      'FresnelS'
    );
    expect(machine.box(['FresnelC', complex([30, -30])]).N().operator).toBe(
      'FresnelC'
    );
  });

  test('an exact argument stays symbolic under evaluate(), a float argument numericizes', () => {
    expect(ce.box(['FresnelS', ['Complex', 1, 1]]).evaluate().operator).toBe(
      'FresnelS'
    );
    expect(ce.box(['FresnelC', 'ImaginaryUnit']).evaluate().operator).toBe(
      'FresnelC'
    );
    expect(isNumber(ce.box(['FresnelC', complex([0.3, 0.4])]).evaluate())).toBe(
      true
    );
  });

  test('the real kernels are accurate between 1.6 and 4.5', () => {
    // The coefficient gd[6] of the auxiliary function g had a wrong value,
    // which gave a relative error up to 4.5e-12 here.
    for (const [op, x, expected] of [
      ['FresnelC', 2, 0.48825340607534073],
      ['FresnelS', 2.2, 0.45570461212465707],
      ['FresnelS', 2.5, 0.6191817558195929],
      ['FresnelC', 1.9, 0.3944705348915229],
    ] as const) {
      const [re] = numeric(machine, [op, { num: x.toString() }]);
      expect(Math.abs(re - expected) / expected).toBeLessThan(1e-15);
    }
  });
});

describe('LAMBERTW OF A COMPLEX ARGUMENT, EVERY BRANCH', () => {
  // [branch, z, W_k(z)]. The points on the negative real axis are on the
  // branch cuts: there the value is the limit from above, as in mpmath.
  const cases: [number, Z, Z][] = [
    [-2, [0.5, 0], [-3.1049770718920247, -10.713483311301252]],
    [-2, [-1, 0], [-2.062277729598284, -7.588631178472513]],
    [-2, [-2, 0], [-1.3607494244085734, -7.678589079816594]],
    [-2, [-0.1, 0], [-4.44909817870089, -7.3070607892176085]],
    [-2, [-0.3678, 0], [-3.0890664968283827, -7.461462445178356]],
    [-2, [1, 2], [-1.482707341515352, -9.73731568541379]],
    [-2, [-3, 4], [-0.5579227387467911, -8.717362702415933]],
    [-2, [-2, -5], [-0.8742565402389041, -12.879099160952482]],
    [-2, [0.25, -0.75], [-2.747024619671494, -12.019939740968754]],
    [-2, [1e6, 1e6], [11.398925031481978, -11.012801233678395]],
    [-2, [-1e-8, 1e-8], [-21.18503543282576, -7.404841017113903]],
    [-2, [-0.36, 0.01], [-3.114293108982258, -7.487591372169911]],
    [-2, [-0.37, -0.001], [-3.658052273931149, -13.876717018802298]],
    [-1, [0.5, 0], [-2.2591588985336064, -4.220960969266197]],
    [-1, [-1, 0], [-0.31813150520476413, -1.3372357014306895]],
    [-1, [-2, 0], [0.17281600283999998, -1.6736864137408427]],
    [-1, [-0.1, 0], [-3.577152063957297, 0]],
    [-1, [-0.3678, 0], [-1.0209272394094255, 0]],
    [-1, [1, 2], [-0.4496365364717197, -3.4766227907402576]],
    [-1, [-3, 4], [0.5887666813694674, -2.7118802109452247]],
    [-1, [-2, -5], [-0.20878715111792945, -6.632221350417463]],
    [-1, [0.25, -0.75], [-2.02152596741522, -5.615911014679849]],
    [-1, [1e6, 1e6], [11.6216225838635, -5.0853149485753235]],
    [-1, [-1e-8, 1e-8], [-21.125341356409283, -0.8244027217398997]],
    [-1, [-0.36, 0.01], [-1.2514376073860296, -0.13609907407909003]],
    [-1, [-0.37, -0.001], [-3.082555729161146, -7.459407683165403]],
    [0, [0.5, 0], [0.35173371124919584, 0]],
    [0, [-1, 0], [-0.31813150520476413, 1.3372357014306895]],
    [0, [-2, 0], [0.17281600283999998, 1.6736864137408427]],
    [0, [-0.1, 0], [-0.11183255915896297, 0]],
    [0, [-0.3678, 0], [-0.9793607149578305, 0]],
    [0, [1, 2], [0.8237712167092305, 0.5329289867954417]],
    [0, [-3, 4], [1.075073066569255, 1.3251023817343588]],
    [0, [-2, -5], [1.1772640538999972, -1.169298913456067]],
    [0, [0.25, -0.75], [0.3658047761629618, -0.4085285649656156]],
    [0, [1e6, 1e6], [11.700540314897427, 0.7236308963832878]],
    [0, [-1e-8, 1e-8], [-9.999999999999997e-9, 1.0000000200000004e-8]],
    [0, [-0.36, 0.01], [-0.7769259316258934, 0.09910653953880101]],
    [0, [-0.37, -0.001], [-0.9716259928428328, -0.10819415921585274]],
    [1, [0.5, 0], [-2.2591588985336064, 4.220960969266197]],
    [1, [-1, 0], [-2.062277729598284, 7.588631178472513]],
    [1, [-2, 0], [-1.3607494244085734, 7.678589079816594]],
    [1, [-0.1, 0], [-4.44909817870089, 7.3070607892176085]],
    [1, [-0.3678, 0], [-3.0890664968283827, 7.461462445178356]],
    [1, [1, 2], [-0.9414143828655581, 5.65456330283261]],
    [1, [-3, 4], [-0.3202875020431077, 6.880167719209197]],
    [1, [-2, -5], [0.5810992183555639, 2.9552425773209343]],
    [1, [0.25, -0.75], [-1.4423026119675175, 3.017461906481781]],
    [1, [1e6, 1e6], [11.574262426532067, 6.553385291860546]],
    [1, [-1e-8, 1e-8], [-21.162097512897954, 5.763696782812038]],
    [1, [-0.36, 0.01], [-3.107398868264103, 7.43009902160445]],
    [1, [-0.37, -0.001], [-1.0207047381704424, 0.11179867541818427]],
    [2, [0.5, 0], [-3.1049770718920247, 10.713483311301252]],
    [2, [-1, 0], [-2.6531919740386973, 13.949208334533214]],
    [2, [-2, 0], [-1.9554568662865854, 13.998373365367803]],
    [2, [-0.1, 0], [-4.9880136260605825, 13.790098563656866]],
    [2, [-0.3678, 0], [-3.664286990059844, 13.87904099510425]],
    [2, [1, 2], [-1.6869138779375397, 11.962631435322812]],
    [2, [-3, 4], [-0.9686502413356645, 13.136266310279492]],
    [2, [-2, -5], [-0.5137810248929793, 8.98716543512234]],
    [2, [0.25, -0.75], [-2.5189872535780404, 9.486996986471457]],
    [2, [1e6, 1e6], [11.335546650684941, 12.516884128046716]],
    [2, [-1e-8, 1e-8], [-21.2759671133726, 12.30533402915643]],
    [2, [-0.36, 0.01], [-3.683687740429316, 13.84943407172144]],
    [2, [-0.37, -0.001], [-3.083227741382957, 7.465000651193416]],
  ];
  test.each(cases)('W_%p(%p)', (k, z, expected) => {
    const arg = z[1] === 0 ? { num: z[0].toString() } : complex(z);
    // A real argument in the real domain of the branch (W₀(0.5), W₋₁(−0.1))
    // uses the real kernels. Near the branch point −1/e they are less
    // accurate (3e-15 at −0.3678), and a decimal argument such as −0.3678
    // is not the double of the reference there, where W changes 130 times
    // faster than its argument.
    const tolerance = z[1] === 0 && Math.abs(expected[1]) === 0 ? 5e-15 : 1e-15;
    for (const engine of [ce, machine])
      expect(
        relativeError(numeric(engine, ['LambertW', arg, k]), expected)
      ).toBeLessThan(tolerance);
  });

  test('a real argument outside the real domain of the branch has a complex value', () => {
    expect(
      relativeError(
        numeric(ce, ['LambertW', -1]),
        [-0.31813150520476413, 1.3372357014306895]
      )
    ).toBeLessThan(1e-15);
    expect(
      relativeError(
        numeric(ce, ['LambertW', { num: '0.5' }, -1]),
        [-2.2591588985336064, -4.220960969266197]
      )
    ).toBeLessThan(1e-15);
  });

  test('the result type admits a complex value off the real domain', () => {
    expect(ce.box(['LambertW', -1]).type.toString()).toBe('number');
    expect(ce.box(['LambertW', 0.5, -1]).type.toString()).toBe('number');
    expect(ce.box(['LambertW', 0.5, 1]).type.toString()).toBe('number');
    expect(ce.box(['LambertW', 0.5]).type.toString()).toBe('real');
    expect(ce.box(['LambertW', -0.2, -1]).type.toString()).toBe('real');
    ce.declare('rLw', 'real');
    expect(ce.box(['LambertW', 'rLw']).type.toString()).toBe('number');
  });

  test('an exact argument stays symbolic under evaluate(), a float argument numericizes', () => {
    expect(ce.box(['LambertW', -1]).evaluate().operator).toBe('LambertW');
    expect(ce.box(['LambertW', 1, 1]).evaluate().operator).toBe('LambertW');
    expect(ce.box(['LambertW', ['Complex', 1, 2]]).evaluate().operator).toBe(
      'LambertW'
    );
    const v = ce.box(['LambertW', complex([1.5, 2]), 2]).evaluate();
    expect(isNumber(v)).toBe(true);
    // mpmath: lambertw(1.5+2j, 2)
    expect(
      isNumber(v) &&
        relativeError([v.re, v.im], [-1.559749029582521, 11.791353990096525])
    ).toBeLessThan(1e-15);
  });

  test('a non-integer branch is a type error, a symbolic branch stays unevaluated', () => {
    expect(ce.box(['LambertW', 1, 0.5]).toString()).toBe(
      'LambertW(1, Error(ErrorCode("incompatible-type", "integer", "0.5"), 0.5))'
    );
    const symbolic = ce.box(['LambertW', 1.5, 'k']);
    expect(symbolic.isValid).toBe(true);
    expect(symbolic.N().toString()).toBe('LambertW(1.5, k)');
    // A symbol declared `real` may hold an integer, so the `integer` slot
    // accepts it, and the expression stays unevaluated.
    const engine = new ComputeEngine();
    engine.declare('r', 'real');
    const real = engine.box(['LambertW', 1.5, 'r']);
    expect(real.isValid).toBe(true);
    expect(real.N().toString()).toBe('LambertW(1.5, r)');
  });

  test('W_k(0) = −∞ on a branch k ≠ 0, as Ln(0)', () => {
    expect(ce.box(['LambertW', 0, 1]).evaluate().toString()).toBe('-oo');
    expect(ce.box(['LambertW', 0, -1]).N().toString()).toBe('-oo');
    expect(ce.box(['LambertW', 0]).N().toString()).toBe('0');
  });

  test('the real infinities on a branch k ≠ 0', () => {
    // W_k(x) ≈ ln x + 2πik for x → +∞ and W_k(−x) ≈ ln x + (2k + 1)πi:
    // mpmath's lambertw(+inf, k) and lambertw(-inf, k).
    expect(
      ce.box(['LambertW', 'PositiveInfinity', 1]).evaluate().operator
    ).toBe('LambertW');
    const a = ce.box(['LambertW', 'PositiveInfinity', 1]).N();
    expect(isNumber(a) && a.re).toBe(Infinity);
    expect(isNumber(a) && a.im).toBeCloseTo(2 * Math.PI, 15);
    const b = ce.box(['LambertW', 'NegativeInfinity', -1]).N();
    expect(isNumber(b) && b.re).toBe(Infinity);
    expect(isNumber(b) && b.im).toBeCloseTo(-Math.PI, 15);
  });
});

// The branch is the SECOND argument (mpmath, SciPy, SymPy, Julia, Fungrim).
// Wolfram, Maple, Sage and MATLAB put it first, so input copied from them has
// the two arguments swapped. The integer type of the branch slot reports a
// swap whose new branch is not an integer, and the named parameter `branch`
// lets a call state the order. GitHub issue #418.
describe('LAMBERTW ARGUMENT ORDER AND THE NAMED BRANCH', () => {
  // mpmath: lambertw(-0.1, -1)
  const wm1 = -3.577152063957297;

  test('the branch is the second argument', () => {
    expect(ce.box(['LambertW', -0.1, -1]).N().re).toBeCloseTo(wm1, 14);
  });

  test('the branch first, with a non-integer argument, is a type error', () => {
    const swapped = ce.box(['LambertW', -1, -0.1]);
    expect(swapped.isValid).toBe(false);
    expect(swapped.toString()).toBe(
      'LambertW(-1, Error(ErrorCode("incompatible-type", "integer", "-0.1"), -0.1))'
    );
  });

  test('a named branch, in either position', () => {
    const named: MathJsonExpression = ['NamedArgument', "'branch'", -1];
    const z: MathJsonExpression = ['NamedArgument', "'z'", -0.1];
    const cases: MathJsonExpression[] = [
      ['LambertW', -0.1, named],
      ['LambertW', named, z],
      ['LambertW', z, named],
    ];
    for (const expr of cases) {
      const v = ce.box(expr);
      expect(v.toString()).toBe('LambertW(-0.1, -1)');
      expect(v.N().re).toBeCloseTo(wm1, 14);
    }
  });

  test('an unknown argument name is reported', () => {
    expect(
      ce.box(['LambertW', -0.1, ['NamedArgument', "'k'", -1]]).toString()
    ).toBe(
      'LambertW(-0.1, Error(ErrorCode("argument-name-unknown", "k", "declared parameter names: `z`, `branch`")))'
    );
  });

  test('a named branch in Epsil', () => {
    for (const source of [
      'N(lambertW(-0.1, branch: -1))',
      'N(lambertW(branch: -1, z: -0.1))',
    ]) {
      const result = executeEpsil(new ComputeEngine(), source);
      expect(result.diagnostics).toEqual([]);
      expect(isNumber(result.value) && result.value.re).toBeCloseTo(wm1, 14);
    }
  });
});

describe('LAMBERTW AT AND NEXT TO THE BRANCH POINT −1/e', () => {
  test('W₀(−1/e) = W₋₁(−1/e) = −1 exactly, for each spelling', () => {
    const ce = new ComputeEngine();
    for (const x of [
      ['Negate', ['Power', 'ExponentialE', -1]],
      ['Divide', -1, 'ExponentialE'],
      ['Negate', ['Exp', -1]],
    ]) {
      for (const k of [0, -1]) {
        const w = ce.box(['LambertW', x, k] as any);
        expect(w.evaluate().toString()).toBe('-1');
        expect(w.N().toString()).toBe('-1');
      }
    }
    // −1/e rounded to a double is just below −1/e: its W is complex. The
    // exact branch point does not go through that double.
    ce.precision = 'machine';
    const w = ce.box(['LambertW', ['Divide', -1, 'ExponentialE']]).N();
    expect(w.toString()).toBe('-1');
  });

  test('a double next to −1/e', () => {
    const ce = new ComputeEngine();
    ce.precision = 'machine';
    const x = -0.3678794411704423; // −1/e + 10⁻¹²
    expect(ce.box(['LambertW', x]).N().re).toBeCloseTo(-0.9999976683333943, 15);
    expect(ce.box(['LambertW', x, -1]).N().re).toBeCloseTo(
      -1.00000233167023,
      14
    );
  });

  test('50 digits at −1/e + 10⁻²⁰', () => {
    const ce = new ComputeEngine();
    ce.precision = 50;
    // The sum −1/e + 10⁻²⁰ is rounded at 50 digits (an error of 10⁻⁵¹), and
    // next to −1/e, dW/dx ≈ 1/√(2e(x + 1/e)) ≈ 4·10⁹: the value of W is
    // determined to about 10⁻⁴¹. The first 38 digits are compared.
    const x = ['Add', ['Divide', -1, 'ExponentialE'], ['Power', 10, -20]];
    expect(ce.box(['LambertW', x]).N().toString().slice(0, 41)).toBe(
      '-0.9999999997668356018584094585181033975713048242025'.slice(0, 41)
    );
    expect(ce.box(['LambertW', x, -1]).N().toString().slice(0, 40)).toBe(
      '-1.0000000002331643981778342991946838722339697189893'.slice(0, 40)
    );
  });
});

describe('OVERFLOW AND UNDERFLOW OF THE INTERMEDIATE VALUES', () => {
  const ce = new ComputeEngine();
  beforeAll(() => {
    ce.precision = 'machine';
  });
  const close = (actual: number, expected: number) =>
    expect(Math.abs(actual / expected - 1)).toBeLessThan(1e-13);

  test('Sinc(iy) past |y| = 709 is finite until the value overflows', () => {
    // sinh(711) overflows, sinh(711)/711 does not.
    close(ce.box(['Sinc', ['Complex', 0, 711]]).N().re, 4.27048338799578e305);
    close(ce.box(['Sinc', ['Complex', 0, 716]]).N().re, 6.2936998127214e307);
    expect(
      ce
        .box(['Sinc', ['Complex', 0, 800]])
        .N()
        .toString()
    ).toBe('+oo');
  });

  test('Sinc of a large z with a tiny quotient sin(z)/z', () => {
    const v = ce.box(['Sinc', ['Complex', 1e200, 710]]).N();
    close(v.re, -7.1931137339456e107);
    close(v.im, 8.54560882509088e107);
  });

  test('W_k of a tiny argument on a branch k ≠ 0', () => {
    // e^−w overflows in the Halley residual: the log form is used.
    const v = ce.box(['LambertW', 1e-310, 1]).N();
    close(v.re, -720.381168836831);
    close(v.im, 3.1459597023682);
    const w = ce.box(['LambertW', 1e-300, 2]).N();
    close(w.re, -697.322868017634);
    close(w.im, 9.43831220199112);
  });

  test('W at 77 digits of −1/e rounded below −1/e', () => {
    const ce77 = new ComputeEngine();
    ce77.precision = 77;
    const x = ce77
      .box(['Multiply', 3, ['Divide', -1, ['Multiply', 3, 'ExponentialE']]])
      .N();
    expect(ce77.box(['LambertW', x]).N().toString()).toBe('-1');
    // Building `ce77` wrote the global precision of the big decimals: the
    // machine engine above does not use them.
  });
});
