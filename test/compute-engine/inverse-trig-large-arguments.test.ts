/**
 * Inverse trigonometric and inverse hyperbolic functions at arguments with a
 * very large or a very small modulus, where the textbook logarithm formulas
 * of the `complex-esm` library lose digits or overflow.
 *
 * Before the fix, `arcsin(−10⁶)` was `−π/2 + 14.50865012405984i` (six
 * correct digits in the imaginary part), and `arcsin(10³⁰⁰)` was `~oo`
 * because `z²` overflowed. The kernels are now the formulas of W. Kahan
 * ("Branch Cuts for Complex Elementary Functions", 1987), in
 * `src/compute-engine/numerics/numeric-complex.ts` (`complexAsin()` and the
 * others).
 *
 * Every expected value below was computed with mpmath at 800 digits and
 * rounded to 17 significant digits.
 */
import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

const ce = new ComputeEngine();

function value(
  engine: ComputeEngine,
  name: string,
  re: number,
  im = 0
): { re: number; im: number } {
  const arg =
    im === 0 ? engine.number(re) : engine.number(engine.complex(re, im));
  const result = engine.function(name, [arg]).N();
  return { re: result.re, im: result.im };
}

/**
 * Each part within a relative error of 4e-16 (two units in the last place),
 * or within 1e-322 of a subnormal expected value (a subnormal double keeps
 * fewer digits).
 */
function expectClose(
  actual: { re: number; im: number },
  expected: [number, number]
): void {
  const close = (a: number, b: number) =>
    a === b ||
    Math.abs(a - b) <= 4e-16 * Math.abs(b) ||
    Math.abs(a - b) <= 1e-322;
  if (!close(actual.re, expected[0]) || !close(actual.im, expected[1]))
    throw new Error(
      `expected ${expected[0]} + ${expected[1]}i, got ${actual.re} + ${actual.im}i`
    );
}

describe('INVERSE TRIG: large and small arguments', () => {
  // [operator, re, im, expected re, expected im]
  const CASES: [string, number, number, number, number][] = [
    // Cancellation in the logarithm for a large negative argument
    ['Arcsin', -1e6, 0, -1.5707963267948966, 14.508657738523969],
    ['Arcsin', 1e6, 0, 1.5707963267948966, -14.508657738523969],
    ['Arcsin', -10, 0, -1.5707963267948966, 2.9932228461263809],
    ['Arccos', -1e15, 0, 3.1415926535897932, -35.231923575470631],
    ['Arcosh', -1e6, 0, 14.508657738523969, 3.1415926535897932],
    ['Arcosh', -1e15, 0, 35.231923575470631, 3.1415926535897932],
    // Overflow of z²
    ['Arcsin', 1e300, 0, 1.5707963267948966, -691.46867507877365],
    ['Arcsin', -1e300, 0, -1.5707963267948966, 691.46867507877365],
    ['Arccos', 1e300, 0, 0, 691.46867507877365],
    ['Arcosh', -1e300, 0, 691.46867507877365, 3.1415926535897932],
    ['Artanh', 1e300, 0, 1e-300, -1.5707963267948966],
    ['Artanh', -1e300, 0, -1e-300, 1.5707963267948966],
    ['Arsinh', 0, 1e300, 691.46867507877365, 1.5707963267948966],
    ['Arsinh', 1e300, 1e300, 691.81524866905362, 0.78539816339744831],
    ['Arctan', 1e300, 1e300, 1.5707963267948966, 5e-301],
    // General complex arguments
    ['Arcsin', 1e6, 1e6, 0.78539816339732331, 14.855231328804192],
    ['Arcsin', 1e-8, 2, 4.4721359549995795e-9, 1.4436354751788104],
    ['Arccos', 3, -1e-10, 3.5355339059327378e-11, 1.7627471740390861],
    ['Artanh', -1, 1e-8, -9.5569139622561554, 0.78539816589744831],
    ['Arctan', 1e-8, 1, 0.78539816589744831, 9.5569139622561554],
    // A tiny argument is kept
    ['Arcsin', 0, 1e-300, 0, 1e-300],
    ['Arcosh', 0.3, -1e-300, 1.0482848367219183e-300, -1.2661036727794991],
    // The reciprocal functions use the same kernels
    ['Arccsc', -1e-6, 0, -1.5707963267948966, 14.508657738523969],
    // Arcsch, Arsech, Arcoth: cancellation, overflow and lost small parts.
    // A real argument with a real result is read as its shortest decimal
    // (`0.999999`), as the big-decimal kernels of the engine read it.
    ['Arcsch', -1e-100, 0, -230.95165647996451, 0],
    ['Arcsch', 1e100, 0, 1e-100, 0],
    ['Arcsch', -1e6, 0, -9.9999999999983333e-7, 0],
    ['Arcsch', 1e6, 1e6, 5.0000000000004167e-7, -4.9999999999995833e-7],
    ['Arcsch', 0, 1e-300, -691.46867507877365, -1.5707963267948966],
    ['Arsech', -1e-8, 0, 19.113827924512311, 3.1415926535897932],
    ['Arsech', 0.999999, 0, 0.0014142141516291261, 0],
    ['Arsech', 3, -1e-10, 1.1785113019775793e-11, 1.2309594173407747],
    ['Arsech', 1e-300, 1e-300, 691.12210148849368, -0.78539816339744831],
    ['Arsech', 1e300, 1e300, 4.9999999999999997e-301, -1.5707963267948966],
    ['Arcoth', 1e100, 0, 1e-100, 0],
    ['Arcoth', 1e15, 0, 1e-15, 0],
    // A complex result is computed in doubles: the argument is the double.
    ['Arcoth', 0.999999, 0, 7.2543286192476694, -1.5707963267948966],
    ['Arcoth', 1e-8, 2, 2e-9, -0.46364760900080611],
    // Arccsc, Arcsec, Arccot: a subnormal argument, where 1/z overflows,
    // and arguments near a branch point. A complex result is computed in
    // doubles, so the argument is the double nearest 1e-320.
    ['Arccsc', 1e-320, 0, 1.5707963267948966, -737.52038807153385],
    ['Arcsec', 1e-320, 0, 0, 737.52038807153385],
    ['Arccot', 1e-320, 1e-320, 1.5707963267948966, -1e-320],
    ['Arcsec', 0.999999, 1e-12, 7.0710766506071913e-10, 0.0014142141516496362],
    ['Arccot', 1e-12, 0.999999, 1.5707958267946466, -7.2543286192474194],
    // A real result is computed with big decimals, from the decimal 1e-320.
    ['Arcsch', 1e-320, 0, 737.52037693865456, 0],
    ['Arsech', 1e-320, 0, 737.52037693865456, 0],
    // At ±1 and ±i (branch points)
    ['Arsinh', 0, 1, 0, 1.5707963267948966],
    ['Arcosh', -1, 0, 0, 3.1415926535897932],
    ['Artanh', 0, -1, 0, -0.78539816339744831],
    ['Arccsc', 0, 1, 0, -0.88137358701954305],
    ['Arcsec', 0, -1, 1.5707963267948966, -0.88137358701954305],
    ['Arcsch', 0, 1, 0, -1.5707963267948966],
    ['Arcsch', 0, -1, 0, 1.5707963267948966],
    ['Arsech', -1, 0, 0, 3.1415926535897932],
    ['Arsech', 0, 1, 0.88137358701954305, -1.5707963267948966],
    ['Arcoth', 0, 1, 0, -0.78539816339744831],
    // |z| near the largest double: the product of two square roots would
    // overflow.
    ['Arcsin', 1.7e308, 1.7e308, 0.78539816339744831, 710.76655766406816],
    ['Arccos', 1.7e308, -1.7e308, 0.78539816339744831, 710.76655766406816],
    ['Arcosh', 1.7e308, 1.7e308, 710.76655766406816, 0.78539816339744831],
    ['Arsinh', -1.7e308, 1.7e308, -710.76655766406816, 0.78539816339744831],
    ['Artanh', 1.7e308, 1.7e308, 2.9411764705882354e-309, 1.5707963267948966],
  ];

  test('the poles at ±1 and ±i', () => {
    for (const [name, re, im, expected] of [
      ['Artanh', 1, 0, '+oo'],
      ['Artanh', -1, 0, '-oo'],
      ['Arcoth', 1, 0, '+oo'],
      ['Arcoth', -1, 0, '-oo'],
      ['Arctan', 0, 1, '~oo'],
      ['Arccot', 0, -1, '~oo'],
    ] as const) {
      const arg = im === 0 ? ce.number(re) : ce.number(ce.complex(re, im));
      expect(ce.function(name, [arg]).N().toString()).toBe(expected);
    }
  });

  test.each(CASES)('%s(%p + %pi)', (name, re, im, expRe, expIm) =>
    expectClose(value(ce, name, re, im), [expRe, expIm])
  );

  test('the LaTeX inputs of the reports', () => {
    for (const latex of ['\\arcsin(10^{300})', '\\arcsin(1e300)']) {
      const v = ce.parse(latex).N();
      expectClose(
        { re: v.re, im: v.im },
        [1.5707963267948966, -691.46867507877365]
      );
    }
    const v = ce.parse('\\operatorname{arccosh}(-1000000)').N();
    expectClose(
      { re: v.re, im: v.im },
      [14.508657738523969, 3.1415926535897932]
    );
  });

  test('an engine above machine precision gets the same values', () => {
    const big = new ComputeEngine();
    big.precision = 30;
    expectClose(
      value(big, 'Arcsin', -1e6),
      [-1.5707963267948966, 14.508657738523969]
    );
    expectClose(
      value(big, 'Arcsin', 1e300),
      [1.5707963267948966, -691.46867507877365]
    );
    // The real reciprocal functions are computed with big decimals.
    for (const [name, x, expected] of [
      ['Arcsch', -1e-8, '-19.1138279245123108065611637589'],
      ['Arcoth', 1e15, '1.00000000000000000000000000000e-15'],
      ['Arsech', 0.999999, '0.00141421415162912610776555069395'],
    ] as const) {
      const actual = big.bignum(
        big
          .function(name, [big.number(x)])
          .N()
          .toString()
      );
      const target = big.bignum(expected);
      expect(actual.sub(target).div(target).abs().lt(big.bignum('1e-28'))).toBe(
        true
      );
    }
  });
});

describe('INVERSE TRIG: the side of each branch cut does not change', () => {
  // Values the engine gave before the fix, at moderate arguments where the
  // old kernels were accurate.
  const CASES: [string, number, number, number, number][] = [
    ['Arcsin', 2, 0, 1.5707963267948966, -1.3169578969248166],
    ['Arcsin', -2, 0, -1.5707963267948966, 1.3169578969248166],
    ['Arccos', 2, 0, 0, 1.3169578969248166],
    ['Arccos', -2, 0, 3.141592653589793, -1.3169578969248166],
    ['Arcosh', -2, 0, 1.3169578969248166, 3.141592653589793],
    ['Artanh', 2, 0, 0.5493061443340549, -1.5707963267948966],
    ['Artanh', -2, 0, -0.5493061443340549, 1.5707963267948966],
    ['Arsinh', 0, 2, 1.3169578969248166, 1.5707963267948966],
    ['Arsinh', 0, -2, -1.3169578969248166, -1.5707963267948966],
    ['Arctan', 0, 2, 1.5707963267948966, 0.5493061443340549],
  ];

  test.each(CASES)('%s(%p + %pi)', (name, re, im, expRe, expIm) =>
    expectClose(value(ce, name, re, im), [expRe, expIm])
  );
});

describe('INVERSE TRIG: arctan and arccot are odd on their branch cuts', () => {
  // The cut of `arctan` is the imaginary axis outside [−i, i], the cut of
  // `arccot` the imaginary axis inside it. Each half of a cut takes the side
  // it is continuous with (the values of mpmath and Mathematica), so
  // `arctan(−z) = −arctan(z)` and `arccot(−z) = −arccot(z)` there. Before,
  // both halves took the side right of the axis: `arctan(−2i)` was
  // `π/2 − 0.549i` and `arccot(0.5i)` was `π/2 − 0.549i`.
  // Values of `mpmath.atan(mpc(0, y))` and `mpmath.acot(mpc(0, y))`.
  const CASES: [string, number, number, number][] = [
    ['Arctan', 1.5, 1.5707963267948966, 0.80471895621705019],
    ['Arctan', -1.5, -1.5707963267948966, -0.80471895621705019],
    ['Arctan', 2, 1.5707963267948966, 0.54930614433405485],
    ['Arctan', -2, -1.5707963267948966, -0.54930614433405485],
    ['Arctan', 10, 1.5707963267948966, 0.10033534773107558],
    ['Arctan', -10, -1.5707963267948966, -0.10033534773107558],
    ['Arctan', 1e10, 1.5707963267948966, 1e-10],
    ['Arctan', -1e10, -1.5707963267948966, -1e-10],
    // Next to the branch points ±i.
    ['Arctan', 1.0000001, 1.5707963267948966, 8.4056214404671984],
    ['Arctan', -1.0000001, -1.5707963267948966, -8.4056214404671984],
    ['Arccot', 0.5, -1.5707963267948966, -0.54930614433405485],
    ['Arccot', -0.5, 1.5707963267948966, 0.54930614433405485],
    ['Arccot', 0.2, -1.5707963267948966, -0.2027325540540822],
    ['Arccot', -0.2, 1.5707963267948966, 0.2027325540540822],
  ];

  test.each(CASES)('%s(%pi)', (name, y, expRe, expIm) =>
    expectClose(value(ce, name, 0, y), [expRe, expIm])
  );

  test.each(CASES)('compiled JavaScript: %s(%pi)', (name, y, expRe, expIm) => {
    const engine = new ComputeEngine();
    engine.declare('z', 'complex');
    const result = compile(engine.function(name, ['z']), { fallback: false });
    expect(result.success).toBe(true);
    const out = result.run!({ z: { re: 0, im: y } }) as {
      re: number;
      im: number;
    };
    expectClose(out, [expRe, expIm]);
  });

  test('compiled JavaScript: a constant argument (constant folding)', () => {
    // `_SYS.catan` and `_SYS.cacot` of a constant are folded at compile time.
    for (const [name, im, expected] of [
      ['Arctan', -2, [-1.5707963267948966, -0.54930614433405485]],
      ['Arccot', 0.5, [-1.5707963267948966, -0.54930614433405485]],
    ] as const) {
      const result = compile(ce.box([name, ['Complex', 0, im]]), {
        fallback: false,
      });
      expect(result.success).toBe(true);
      expectClose(
        result.run!({}) as { re: number; im: number },
        expected as unknown as [number, number]
      );
    }
  });

  test('the value on the cut is the limit from its own side', () => {
    // `arctan(−2i)` is the limit from the left of the imaginary axis, and
    // `arccot(0.5i)` too. Values of mpmath at ±10⁻⁹ + iy.
    expectClose(
      value(ce, 'Arctan', -1e-9, -2),
      [-1.5707963264615633, -0.54930614433405485]
    );
    expectClose(
      value(ce, 'Arctan', 1e-9, -2),
      [1.5707963264615633, -0.54930614433405485]
    );
    expectClose(
      value(ce, 'Arccot', -1e-9, 0.5),
      [-1.5707963254615633, -0.54930614433405484]
    );
    expectClose(
      value(ce, 'Arccot', 1e-9, 0.5),
      [1.5707963254615633, -0.54930614433405484]
    );
    const onCut = (name: string, y: number) => value(ce, name, 0, y);
    expect(onCut('Arctan', -2).re).toBeCloseTo(
      value(ce, 'Arctan', -1e-9, -2).re,
      8
    );
    expect(onCut('Arccot', 0.5).re).toBeCloseTo(
      value(ce, 'Arccot', -1e-9, 0.5).re,
      8
    );
  });
});

describe('COMPILE: complex inverse trig at large arguments', () => {
  const HEADS: [string, string, number, [number, number]][] = [
    ['Arcsin', '\\arcsin(u)', -1e6, [-1.5707963267948966, 14.508657738523969]],
    ['Arcsin', '\\arcsin(u)', 1e300, [1.5707963267948966, -691.46867507877365]],
    ['Arccos', '\\arccos(u)', -1e15, [3.1415926535897932, -35.231923575470631]],
    [
      'Arcosh',
      '\\operatorname{arcosh}(u)',
      -1e6,
      [14.508657738523969, 3.1415926535897932],
    ],
    [
      'Artanh',
      '\\operatorname{artanh}(u)',
      -1e6,
      [-1.0000000000003333e-6, 1.5707963267948966],
    ],
    // A small result is kept: the compiled kernels remove only a part below
    // 1e-14 times the modulus of the result (`toRI()` in
    // `javascript-target.ts`). An absolute test of 1e-14 gave 0 here.
    ['Arcoth', '\\operatorname{arcoth}(u)', 1e20, [1e-20, 0]],
    ['Arcsch', '\\operatorname{arcsch}(u)', -1e20, [-1e-20, 0]],
  ];

  test.each(HEADS)('%s: %s at u = %p', (_name, latex, u, expected) => {
    const engine = new ComputeEngine();
    engine.declare('u', 'real');
    const result = compile(engine.parse(latex), { fallback: false });
    expect(result.success).toBe(true);
    const out = result.run!({ u }) as number | { re: number; im: number };
    expectClose(typeof out === 'number' ? { re: out, im: 0 } : out, expected);
  });
});

describe('COMPILE: a complex argument', () => {
  // [operator, re, im, expected]
  const CASES: [string, number, number, [number, number]][] = [
    ['Arccsc', -1e-6, 0, [-1.5707963267948966, 14.508657738523969]],
    ['Arcsec', -1e-6, 0, [3.1415926535897932, -14.508657738523969]],
    ['Arccsc', 1e-300, 0, [1.5707963267948966, -691.46867507877365]],
    ['Arccot', 1e-12, 0.999999, [1.5707958267946466, -7.2543286192474194]],
    ['Arsinh', 0, 2, [1.3169578969248167, 1.5707963267948966]],
    ['Arsinh', 1, 1, [1.0612750619050357, 0.66623943249251526]],
  ];

  test.each(CASES)('%s(%p + %pi)', (name, re, im, expected) => {
    const engine = new ComputeEngine();
    engine.declare('z', 'complex');
    const result = compile(engine.box([name, 'z']), { fallback: false });
    expect(result.success).toBe(true);
    const out = result.run!({ z: { re, im } }) as
      number | { re: number; im: number };
    expectClose(typeof out === 'number' ? { re: out, im: 0 } : out, expected);
  });

  test('exp(40 + 10⁻¹⁸i) keeps its imaginary part, as the interpreter does', () => {
    // The imaginary part 0.235 is small next to the real part 2.35·10¹⁷, but
    // much larger than its own rounding error: the compiled kernels remove a
    // part only when it is also below 1e-14 (`chopKernelDust()`).
    const engine = new ComputeEngine();
    engine.declare('z', 'complex');
    const result = compile(engine.box(['Exp', 'z']), { fallback: false });
    expect(result.success).toBe(true);
    const out = result.run!({ z: { re: 40, im: 1e-18 } }) as {
      re: number;
      im: number;
    };
    const interpreted = engine
      .function('Exp', [engine.number(engine.complex(40, 1e-18))])
      .N();
    expectClose(out, [interpreted.re, interpreted.im]);
    expectClose(out, [2.3538526683701999e17, 0.23538526683702]);
  });
});
