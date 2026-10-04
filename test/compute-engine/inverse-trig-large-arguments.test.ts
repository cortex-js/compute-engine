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
import { BigDecimal } from '../../src/big-decimal';

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
    // Above machine precision (this engine has 21 digits), a real argument
    // with a complex value is read as its shortest decimal, as for a real
    // value, and computed with big decimals.
    ['Arcoth', 0.999999, 0, 7.2543286192620472, -1.5707963267948966],
    ['Arcoth', 1e-8, 2, 2e-9, -0.46364760900080611],
    // Arccsc, Arcsec, Arccot: a subnormal argument, where 1/z overflows,
    // and arguments near a branch point. A real argument is read as the
    // decimal 1e-320 (above machine precision, see `Arcoth` above).
    ['Arccsc', 1e-320, 0, 1.5707963267948966, -737.52037693865456],
    ['Arcsec', 1e-320, 0, 0, 737.52037693865456],
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
    // A small result is kept: the compiled inverse kernels remove no part
    // (`kernelResult()` in `javascript-target.ts`). An absolute test of
    // 1e-14 gave 0 here.
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
    // much larger than its own rounding error: `Exp` compiles to the
    // exponential `_SYS.cexp`, which removes no part.
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

describe('COMPILE: a small part is kept, as the interpreter keeps it', () => {
  // The compiled complex kernels remove no part of their result. They used
  // to set to 0 a part below 1e-14 and below 1e-14 times the modulus, so
  // `arcoth(10⁻¹⁰⁰)` was `−(π/2)i` compiled and `10⁻¹⁰⁰ − (π/2)i` in the
  // interpreter.
  const ce2 = new ComputeEngine();
  ce2.declare('z', 'complex');

  function compiled(name: string, re: number, im: number) {
    const result = compile(ce2.box([name, 'z']), { fallback: false });
    expect(result.success).toBe(true);
    return result.run!({ z: { re, im } }) as
      number | { re: number; im: number };
  }

  function interpreted(name: string, re: number, im: number) {
    const arg = im === 0 ? ce2.number(re) : ce2.number(ce2.complex(re, im));
    const result = ce2.function(name, [arg]).N();
    return { re: result.re, im: result.im };
  }

  /** Same value, and a part is 0 in one exactly when it is 0 in the other. */
  function expectParity(name: string, re: number, im: number) {
    const out = compiled(name, re, im);
    const c = typeof out === 'number' ? { re: out, im: 0 } : out;
    const i = interpreted(name, re, im);
    expect([c.re === 0, c.im === 0]).toEqual([i.re === 0, i.im === 0]);
    expectClose(c, [i.re, i.im]);
    return out;
  }

  // [operator, re, im, expected re, expected im]
  const CASES: [string, number, number, number, number][] = [
    ['Arcoth', 1e-100, 0, 1e-100, -1.5707963267948966],
    ['Artanh', 1e-300, 0, 1e-300, 0],
    ['Arcsin', 0, 1e-200, 0, 1e-200],
    ['Arccsc', 1e300, 0, 1e-300, 0],
    ['Arccos', 0, 1e-100, 1.5707963267948966, -1e-100],
    ['Arcosh', 0, 1e-100, 1e-100, 1.5707963267948966],
    // `sin` at the double nearest to π: sin(π + i) is −i·sinh(1), and the
    // real part 1.9·10⁻¹⁶ is the value at that double, not roundoff.
    ['Sin', Math.PI, 1, 1.889728760252754e-16, -1.1752011936438014],
    ['Tan', Math.PI, 1, -5.1432023318163406e-17, 0.761594155955765],
  ];

  test.each(CASES)('%s(%p + %pi)', (name, re, im, expRe, expIm) => {
    const out = expectParity(name, re, im);
    expectClose(typeof out === 'number' ? { re: out, im: 0 } : out, [
      expRe,
      expIm,
    ]);
  });

  test('arctan and arccot at ±i: a constant argument gives the run-time value', () => {
    // The interpreter's value is `~oo`, which the complex lane spells
    // `{re: ∞, im: ∞}`. The run-time helpers answered `0 ± ∞i`, and a
    // constant argument folded to the real `Infinity`.
    for (const [name, im] of [
      ['Arctan', 1],
      ['Arctan', -1],
      ['Arccot', 1],
      ['Arccot', -1],
    ] as const) {
      const folded = compile(ce2.box([name, ['Complex', 0, im]]), {
        fallback: false,
      });
      expect(folded.success).toBe(true);
      const runtime = compiled(name, 0, im);
      expect(runtime).toEqual({ re: Infinity, im: Infinity });
      expect(folded.run!({})).toEqual(runtime);
      expect(ce2.box([name, ['Complex', 0, im]]).N().json).toEqual(
        'ComplexInfinity'
      );
    }
  });

  test('a constant argument folds to the same value', () => {
    const result = compile(ce2.box(['Arcoth', ['Complex', 1e-100, 0]]), {
      fallback: false,
    });
    expect(result.success).toBe(true);
    expect(result.run!({})).toEqual({ re: 1e-100, im: -1.5707963267948966 });
  });

  test('the square root of a small complex value', () => {
    // The `complex-esm` square root gave 0 for √(10⁻³⁰⁰·i), and
    // 7.07·10⁻¹⁵¹·(1 + i) for √(10⁻³⁰⁰ + 10⁻³⁰⁰·i).
    expectClose(
      compiled('Sqrt', 0, 1e-300) as { re: number; im: number },
      [7.0710678118654752e-151, 7.0710678118654752e-151]
    );
    expectClose(
      compiled('Sqrt', 1e-300, 1e-300) as { re: number; im: number },
      [1.09868411346781e-150, 4.5508986056222734e-151]
    );
    expectParity('Sqrt', -1e-300, 1e-305);
  });

  // Each inverse function on its real domain: the value is a plain real
  // number, as in the interpreter (the result convention tests `im === 0`
  // exactly, so a residual imaginary part would make it complex).
  const REAL_DOMAIN: [string, number[]][] = [
    ['Arcsin', [-1, -0.5, -1e-300, 0, 1e-100, 0.3, 0.5, 1]],
    ['Arccos', [-1, -0.5, 0, 1e-100, 0.5, 0.9, 1]],
    ['Arctan', [-1e300, -2, -1, 0, 1e-300, 0.5, 1, 1e10]],
    ['Arccot', [-1e300, -2, -1, 0.5, 1, 1e10, 1e300]],
    ['Arcsec', [-1e300, -2, -1, 1, 1.5, 2, 1e300]],
    ['Arccsc', [-1e300, -2, -1, 1, 1.5, 2, 1e300]],
    ['Arsinh', [-1e300, -2, -1e-300, 0, 0.5, 1, 1e10]],
    ['Arcosh', [1, 1.5, 2, 10, 1e10, 1e300]],
    ['Artanh', [-0.9, -0.5, -1e-300, 0, 1e-100, 0.5, 0.99]],
    ['Arcoth', [-1e300, -2, -1.5, 1.5, 2, 10, 1e300]],
    ['Arsech', [1e-300, 0.1, 0.5, 0.9, 1]],
    ['Arcsch', [-1e300, -2, -1e-300, 1e-300, 0.5, 2, 1e300]],
  ];

  test.each(REAL_DOMAIN)('%s on its real domain is real', (name, xs) => {
    for (const x of xs) {
      const out = compiled(name, x, 0);
      if (typeof out !== 'number')
        throw new Error(`${name}(${x}) is ${out.re} + ${out.im}i`);
      expectParity(name, x, 0);
    }
  });

  // Each inverse function on the imaginary axis, and outside its real
  // domain on the real axis: a part that is 0 in the interpreter is 0
  // compiled, and a small part is kept in both. The branch points `±i`,
  // where the value is `~oo`, are tested separately (`arctan and arccot at
  // ±i`).
  const AXES: [number, number][] = [
    [0, 1e-300],
    [0, -1e-100],
    [0, 0.5],
    [0, -0.5],
    [0, 0.999],
    [0, -2],
    [0, 1e300],
    [-2, 0],
    [2, 0],
    [-0.5, 0],
    [0.5, 0],
    [1e-100, 0],
    [-1e300, 0],
  ];
  test.each(REAL_DOMAIN.map(([name]) => [name]))(
    '%s on the axes agrees with the interpreter',
    (name) => {
      for (const [re, im] of AXES) expectParity(name, re, im);
    }
  );
});

describe('INVERSE TRIG: arguments beyond the double range', () => {
  // An exact argument outside the range of a normal double: `10⁴⁰⁰` was the
  // double `+∞` and `10⁻⁴⁰⁰` the double `0` (`arcsin(10⁴⁰⁰)` was `NaN`), and
  // `10⁻³²⁰` the subnormal double, which keeps 5 digits.
  //
  // Every expected value was computed with mpmath at 1700 digits. `Arccot`
  // of a negative real is the engine's value, atan2(1, x), in (0, π) (the
  // mpmath value plus π), as the real kernel gives it at ±10³⁰⁰.
  const REAL: [string, number, number, string, string][] = [
    [
      'Arcsin',
      1,
      400,
      '1.5707963267948966192313216916397514420985846996876',
      '-9.2172718437817821891661381399520385960851609558587e+2',
    ],
    [
      'Arccos',
      1,
      400,
      '0',
      '9.2172718437817821891661381399520385960851609558587e+2',
    ],
    [
      'Arctan',
      1,
      400,
      '1.5707963267948966192313216916397514420985846996876',
      '0',
    ],
    [
      'Arsinh',
      1,
      400,
      '9.2172718437817821891661381399520385960851609558587e+2',
      '0',
    ],
    [
      'Arcosh',
      1,
      400,
      '9.2172718437817821891661381399520385960851609558587e+2',
      '0',
    ],
    [
      'Artanh',
      1,
      400,
      '1.0e-400',
      '-1.5707963267948966192313216916397514420985846996876',
    ],
    ['Arccsc', 1, 400, '1.0e-400', '0'],
    [
      'Arcsec',
      1,
      400,
      '1.5707963267948966192313216916397514420985846996876',
      '0',
    ],
    ['Arccot', 1, 400, '1.0e-400', '0'],
    ['Arcsch', 1, 400, '1.0e-400', '0'],
    [
      'Arsech',
      1,
      400,
      '0',
      '1.5707963267948966192313216916397514420985846996876',
    ],
    ['Arcoth', 1, 400, '1.0e-400', '0'],
    [
      'Arcsin',
      -1,
      400,
      '-1.5707963267948966192313216916397514420985846996876',
      '9.2172718437817821891661381399520385960851609558587e+2',
    ],
    [
      'Arccos',
      -1,
      400,
      '3.1415926535897932384626433832795028841971693993751',
      '-9.2172718437817821891661381399520385960851609558587e+2',
    ],
    [
      'Arctan',
      -1,
      400,
      '-1.5707963267948966192313216916397514420985846996876',
      '0',
    ],
    [
      'Arsinh',
      -1,
      400,
      '-9.2172718437817821891661381399520385960851609558587e+2',
      '0',
    ],
    [
      'Arcosh',
      -1,
      400,
      '9.2172718437817821891661381399520385960851609558587e+2',
      '3.1415926535897932384626433832795028841971693993751',
    ],
    [
      'Artanh',
      -1,
      400,
      '-1.0e-400',
      '1.5707963267948966192313216916397514420985846996876',
    ],
    ['Arccsc', -1, 400, '-1.0e-400', '0'],
    [
      'Arcsec',
      -1,
      400,
      '1.5707963267948966192313216916397514420985846996876',
      '0',
    ],
    [
      'Arccot',
      -1,
      400,
      '3.1415926535897932384626433832795028841971693993751',
      '0',
    ],
    ['Arcsch', -1, 400, '-1.0e-400', '0'],
    [
      'Arsech',
      -1,
      400,
      '0',
      '1.5707963267948966192313216916397514420985846996876',
    ],
    ['Arcoth', -1, 400, '-1.0e-400', '0'],
    [
      'Arcsin',
      3,
      400,
      '1.5707963267948966192313216916397514420985846996876',
      '-9.2282579666684632860800905923212638531316358614369e+2',
    ],
    [
      'Arccos',
      3,
      400,
      '0',
      '9.2282579666684632860800905923212638531316358614369e+2',
    ],
    [
      'Arctan',
      3,
      400,
      '1.5707963267948966192313216916397514420985846996876',
      '0',
    ],
    [
      'Arsinh',
      3,
      400,
      '9.2282579666684632860800905923212638531316358614369e+2',
      '0',
    ],
    [
      'Arcosh',
      3,
      400,
      '9.2282579666684632860800905923212638531316358614369e+2',
      '0',
    ],
    [
      'Artanh',
      3,
      400,
      '3.3333333333333333333333333333333333333333333333333e-401',
      '-1.5707963267948966192313216916397514420985846996876',
    ],
    [
      'Arccsc',
      3,
      400,
      '3.3333333333333333333333333333333333333333333333333e-401',
      '0',
    ],
    [
      'Arcsec',
      3,
      400,
      '1.5707963267948966192313216916397514420985846996876',
      '0',
    ],
    [
      'Arccot',
      3,
      400,
      '3.3333333333333333333333333333333333333333333333333e-401',
      '0',
    ],
    [
      'Arcsch',
      3,
      400,
      '3.3333333333333333333333333333333333333333333333333e-401',
      '0',
    ],
    [
      'Arsech',
      3,
      400,
      '0',
      '1.5707963267948966192313216916397514420985846996876',
    ],
    [
      'Arcoth',
      3,
      400,
      '3.3333333333333333333333333333333333333333333333333e-401',
      '0',
    ],
    ['Arcsin', 1, -400, '1.0e-400', '0'],
    [
      'Arccos',
      1,
      -400,
      '1.5707963267948966192313216916397514420985846996876',
      '0',
    ],
    ['Arctan', 1, -400, '1.0e-400', '0'],
    ['Arsinh', 1, -400, '1.0e-400', '0'],
    [
      'Arcosh',
      1,
      -400,
      '0',
      '1.5707963267948966192313216916397514420985846996876',
    ],
    ['Artanh', 1, -400, '1.0e-400', '0'],
    [
      'Arccsc',
      1,
      -400,
      '1.5707963267948966192313216916397514420985846996876',
      '-9.2172718437817821891661381399520385960851609558587e+2',
    ],
    [
      'Arcsec',
      1,
      -400,
      '0',
      '9.2172718437817821891661381399520385960851609558587e+2',
    ],
    [
      'Arccot',
      1,
      -400,
      '1.5707963267948966192313216916397514420985846996876',
      '0',
    ],
    [
      'Arcsch',
      1,
      -400,
      '9.2172718437817821891661381399520385960851609558587e+2',
      '0',
    ],
    [
      'Arsech',
      1,
      -400,
      '9.2172718437817821891661381399520385960851609558587e+2',
      '0',
    ],
    [
      'Arcoth',
      1,
      -400,
      '1.0e-400',
      '-1.5707963267948966192313216916397514420985846996876',
    ],
    ['Arcsin', -1, -400, '-1.0e-400', '0'],
    [
      'Arccos',
      -1,
      -400,
      '1.5707963267948966192313216916397514420985846996876',
      '0',
    ],
    ['Arctan', -1, -400, '-1.0e-400', '0'],
    ['Arsinh', -1, -400, '-1.0e-400', '0'],
    [
      'Arcosh',
      -1,
      -400,
      '0',
      '1.5707963267948966192313216916397514420985846996876',
    ],
    ['Artanh', -1, -400, '-1.0e-400', '0'],
    [
      'Arccsc',
      -1,
      -400,
      '-1.5707963267948966192313216916397514420985846996876',
      '9.2172718437817821891661381399520385960851609558587e+2',
    ],
    [
      'Arcsec',
      -1,
      -400,
      '3.1415926535897932384626433832795028841971693993751',
      '-9.2172718437817821891661381399520385960851609558587e+2',
    ],
    [
      'Arccot',
      -1,
      -400,
      '1.5707963267948966192313216916397514420985846996876',
      '0',
    ],
    [
      'Arcsch',
      -1,
      -400,
      '-9.2172718437817821891661381399520385960851609558587e+2',
      '0',
    ],
    [
      'Arsech',
      -1,
      -400,
      '9.2172718437817821891661381399520385960851609558587e+2',
      '3.1415926535897932384626433832795028841971693993751',
    ],
    [
      'Arcoth',
      -1,
      -400,
      '-1.0e-400',
      '1.5707963267948966192313216916397514420985846996876',
    ],
    ['Arcsin', -7, -350, '-7.0e-350', '0'],
    [
      'Arccos',
      -7,
      -350,
      '1.5707963267948966192313216916397514420985846996876',
      '0',
    ],
    ['Arctan', -7, -350, '-7.0e-350', '0'],
    ['Arsinh', -7, -350, '-7.0e-350', '0'],
    [
      'Arcosh',
      -7,
      -350,
      '0',
      '1.5707963267948966192313216916397514420985846996876',
    ],
    ['Artanh', -7, -350, '-7.0e-350', '0'],
    [
      'Arccsc',
      -7,
      -350,
      '-1.5707963267948966192313216916397514420985846996876',
      '8.0465201957942062141060888851754246949882393642485e+2',
    ],
    [
      'Arcsec',
      -7,
      -350,
      '3.1415926535897932384626433832795028841971693993751',
      '-8.0465201957942062141060888851754246949882393642485e+2',
    ],
    [
      'Arccot',
      -7,
      -350,
      '1.5707963267948966192313216916397514420985846996876',
      '0',
    ],
    [
      'Arcsch',
      -7,
      -350,
      '-8.0465201957942062141060888851754246949882393642485e+2',
      '0',
    ],
    [
      'Arsech',
      -7,
      -350,
      '8.0465201957942062141060888851754246949882393642485e+2',
      '3.1415926535897932384626433832795028841971693993751',
    ],
    [
      'Arcoth',
      -7,
      -350,
      '-7.0e-350',
      '1.5707963267948966192313216916397514420985846996876',
    ],
    ['Arcsin', 1, -320, '1.0e-320', '0'],
    [
      'Arccos',
      1,
      -320,
      '1.5707963267948966192313216916397514420985846996876',
      '0',
    ],
    ['Arctan', 1, -320, '1.0e-320', '0'],
    ['Arsinh', 1, -320, '1.0e-320', '0'],
    [
      'Arcosh',
      1,
      -320,
      '0',
      '1.5707963267948966192313216916397514420985846996876',
    ],
    ['Artanh', 1, -320, '1.0e-320', '0'],
    [
      'Arccsc',
      1,
      -320,
      '1.5707963267948966192313216916397514420985846996876',
      '-7.3752037693865456419517449762045472300042797649557e+2',
    ],
    [
      'Arcsec',
      1,
      -320,
      '0',
      '7.3752037693865456419517449762045472300042797649557e+2',
    ],
    [
      'Arccot',
      1,
      -320,
      '1.5707963267948966192313216916397514420985846996876',
      '0',
    ],
    [
      'Arcsch',
      1,
      -320,
      '7.3752037693865456419517449762045472300042797649557e+2',
      '0',
    ],
    [
      'Arsech',
      1,
      -320,
      '7.3752037693865456419517449762045472300042797649557e+2',
      '0',
    ],
    [
      'Arcoth',
      1,
      -320,
      '1.0e-320',
      '-1.5707963267948966192313216916397514420985846996876',
    ],
  ];
  const COMPLEX: [
    string,
    [number, number],
    [number, number],
    string,
    string,
  ][] = [
    [
      'Arcsin',
      [1, 400],
      [1, 400],
      '7.8539816339744831e-1',
      '9.2207375796845819e+2',
    ],
    [
      'Arccos',
      [1, 400],
      [1, 400],
      '7.8539816339744831e-1',
      '-9.2207375796845819e+2',
    ],
    ['Arctan', [1, 400], [1, 400], '1.5707963267948966', '5.0e-401'],
    [
      'Arsinh',
      [1, 400],
      [1, 400],
      '9.2207375796845819e+2',
      '7.8539816339744831e-1',
    ],
    [
      'Arcosh',
      [1, 400],
      [1, 400],
      '9.2207375796845819e+2',
      '7.8539816339744831e-1',
    ],
    ['Artanh', [1, 400], [1, 400], '5.0e-401', '1.5707963267948966'],
    ['Arccsc', [1, 400], [1, 400], '5.0e-401', '-5.0e-401'],
    ['Arcsec', [1, 400], [1, 400], '1.5707963267948966', '5.0e-401'],
    ['Arccot', [1, 400], [1, 400], '5.0e-401', '-5.0e-401'],
    ['Arcsch', [1, 400], [1, 400], '5.0e-401', '-5.0e-401'],
    ['Arsech', [1, 400], [1, 400], '5.0e-401', '-1.5707963267948966'],
    ['Arcoth', [1, 400], [1, 400], '5.0e-401', '-5.0e-401'],
    ['Arcsin', [0, 0], [1, 400], '0', '9.2172718437817822e+2'],
    [
      'Arccos',
      [0, 0],
      [1, 400],
      '1.5707963267948966',
      '-9.2172718437817822e+2',
    ],
    ['Arctan', [0, 0], [1, 400], '1.5707963267948966', '1.0e-400'],
    ['Arsinh', [0, 0], [1, 400], '9.2172718437817822e+2', '1.5707963267948966'],
    ['Arcosh', [0, 0], [1, 400], '9.2172718437817822e+2', '1.5707963267948966'],
    ['Artanh', [0, 0], [1, 400], '0', '1.5707963267948966'],
    ['Arccsc', [0, 0], [1, 400], '0', '-1.0e-400'],
    ['Arcsec', [0, 0], [1, 400], '1.5707963267948966', '1.0e-400'],
    ['Arccot', [0, 0], [1, 400], '0', '-1.0e-400'],
    ['Arcsch', [0, 0], [1, 400], '0', '-1.0e-400'],
    ['Arsech', [0, 0], [1, 400], '1.0e-400', '-1.5707963267948966'],
    ['Arcoth', [0, 0], [1, 400], '0', '-1.0e-400'],
    [
      'Arcsin',
      [-3, 400],
      [2, 399],
      '-1.5042281630190728',
      '9.2282801396538026e+2',
    ],
    [
      'Arccos',
      [-3, 400],
      [2, 399],
      '3.0750244898139694',
      '-9.2282801396538026e+2',
    ],
    [
      'Arctan',
      [-3, 400],
      [2, 399],
      '-1.5707963267948966',
      '2.2123893805309735e-402',
    ],
    [
      'Arsinh',
      [-3, 400],
      [2, 399],
      '-9.2282801396538026e+2',
      '6.6568163775823804e-2',
    ],
    [
      'Arcosh',
      [-3, 400],
      [2, 399],
      '9.2282801396538026e+2',
      '3.0750244898139694',
    ],
    [
      'Artanh',
      [-3, 400],
      [2, 399],
      '-3.3185840707964602e-401',
      '1.5707963267948966',
    ],
    [
      'Arccsc',
      [-3, 400],
      [2, 399],
      '-3.3185840707964602e-401',
      '-2.2123893805309735e-402',
    ],
    [
      'Arcsec',
      [-3, 400],
      [2, 399],
      '1.5707963267948966',
      '2.2123893805309735e-402',
    ],
    [
      'Arccot',
      [-3, 400],
      [2, 399],
      '-3.3185840707964602e-401',
      '-2.2123893805309735e-402',
    ],
    [
      'Arcsch',
      [-3, 400],
      [2, 399],
      '-3.3185840707964602e-401',
      '-2.2123893805309735e-402',
    ],
    [
      'Arsech',
      [-3, 400],
      [2, 399],
      '2.2123893805309735e-402',
      '-1.5707963267948966',
    ],
    [
      'Arcoth',
      [-3, 400],
      [2, 399],
      '-3.3185840707964602e-401',
      '-2.2123893805309735e-402',
    ],
    [
      'Arcsin',
      [1, 400],
      [1, 399],
      '1.4711276743037346',
      '9.217321595436048e+2',
    ],
    [
      'Arccos',
      [1, 400],
      [1, 399],
      '9.9668652491162027e-2',
      '-9.217321595436048e+2',
    ],
    [
      'Arctan',
      [1, 400],
      [1, 399],
      '1.5707963267948966',
      '9.900990099009901e-402',
    ],
    [
      'Arsinh',
      [1, 400],
      [1, 399],
      '9.217321595436048e+2',
      '9.9668652491162027e-2',
    ],
    [
      'Arcosh',
      [1, 400],
      [1, 399],
      '9.217321595436048e+2',
      '9.9668652491162027e-2',
    ],
    [
      'Artanh',
      [1, 400],
      [1, 399],
      '9.900990099009901e-401',
      '1.5707963267948966',
    ],
    [
      'Arccsc',
      [1, 400],
      [1, 399],
      '9.900990099009901e-401',
      '-9.900990099009901e-402',
    ],
    [
      'Arcsec',
      [1, 400],
      [1, 399],
      '1.5707963267948966',
      '9.900990099009901e-402',
    ],
    [
      'Arccot',
      [1, 400],
      [1, 399],
      '9.900990099009901e-401',
      '-9.900990099009901e-402',
    ],
    [
      'Arcsch',
      [1, 400],
      [1, 399],
      '9.900990099009901e-401',
      '-9.900990099009901e-402',
    ],
    [
      'Arsech',
      [1, 400],
      [1, 399],
      '9.900990099009901e-402',
      '-1.5707963267948966',
    ],
    [
      'Arcoth',
      [1, 400],
      [1, 399],
      '9.900990099009901e-401',
      '-9.900990099009901e-402',
    ],
    ['Arcsin', [1, -400], [1, -400], '1.0e-400', '1.0e-400'],
    ['Arccos', [1, -400], [1, -400], '1.5707963267948966', '-1.0e-400'],
    ['Arctan', [1, -400], [1, -400], '1.0e-400', '1.0e-400'],
    ['Arsinh', [1, -400], [1, -400], '1.0e-400', '1.0e-400'],
    ['Arcosh', [1, -400], [1, -400], '1.0e-400', '1.5707963267948966'],
    ['Artanh', [1, -400], [1, -400], '1.0e-400', '1.0e-400'],
    [
      'Arccsc',
      [1, -400],
      [1, -400],
      '7.8539816339744831e-1',
      '-9.2138061078789825e+2',
    ],
    [
      'Arcsec',
      [1, -400],
      [1, -400],
      '7.8539816339744831e-1',
      '9.2138061078789825e+2',
    ],
    ['Arccot', [1, -400], [1, -400], '1.5707963267948966', '-1.0e-400'],
    [
      'Arcsch',
      [1, -400],
      [1, -400],
      '9.2138061078789825e+2',
      '-7.8539816339744831e-1',
    ],
    [
      'Arsech',
      [1, -400],
      [1, -400],
      '9.2138061078789825e+2',
      '-7.8539816339744831e-1',
    ],
    ['Arcoth', [1, -400], [1, -400], '1.0e-400', '-1.5707963267948966'],
    ['Arcsin', [0, 0], [-1, -400], '0', '-1.0e-400'],
    ['Arccos', [0, 0], [-1, -400], '1.5707963267948966', '1.0e-400'],
    ['Arctan', [0, 0], [-1, -400], '0', '-1.0e-400'],
    ['Arsinh', [0, 0], [-1, -400], '0', '-1.0e-400'],
    ['Arcosh', [0, 0], [-1, -400], '1.0e-400', '-1.5707963267948966'],
    ['Artanh', [0, 0], [-1, -400], '0', '-1.0e-400'],
    ['Arccsc', [0, 0], [-1, -400], '0', '9.2172718437817822e+2'],
    [
      'Arcsec',
      [0, 0],
      [-1, -400],
      '1.5707963267948966',
      '-9.2172718437817822e+2',
    ],
    ['Arccot', [0, 0], [-1, -400], '1.5707963267948966', '1.0e-400'],
    [
      'Arcsch',
      [0, 0],
      [-1, -400],
      '9.2172718437817822e+2',
      '1.5707963267948966',
    ],
    [
      'Arsech',
      [0, 0],
      [-1, -400],
      '9.2172718437817822e+2',
      '1.5707963267948966',
    ],
    ['Arcoth', [0, 0], [-1, -400], '0', '1.5707963267948966'],
    ['Arcsin', [-2, -330], [5, -331], '-2.0e-330', '5.0e-331'],
    ['Arccos', [-2, -330], [5, -331], '1.5707963267948966', '-5.0e-331'],
    ['Arctan', [-2, -330], [5, -331], '-2.0e-330', '5.0e-331'],
    ['Arsinh', [-2, -330], [5, -331], '-2.0e-330', '5.0e-331'],
    ['Arcosh', [-2, -330], [5, -331], '5.0e-331', '1.5707963267948966'],
    ['Artanh', [-2, -330], [5, -331], '-2.0e-330', '5.0e-331'],
    [
      'Arccsc',
      [-2, -330],
      [5, -331],
      '-1.3258176636680325',
      '-7.5982276837712686e+2',
    ],
    [
      'Arcsec',
      [-2, -330],
      [5, -331],
      '2.8966139904629291',
      '7.5982276837712686e+2',
    ],
    ['Arccot', [-2, -330], [5, -331], '-1.5707963267948966', '-5.0e-331'],
    [
      'Arcsch',
      [-2, -330],
      [5, -331],
      '-7.5982276837712686e+2',
      '-2.4497866312686415e-1',
    ],
    [
      'Arsech',
      [-2, -330],
      [5, -331],
      '7.5982276837712686e+2',
      '-2.8966139904629291',
    ],
    ['Arcoth', [-2, -330], [5, -331], '-2.0e-330', '-1.5707963267948966'],
  ];

  const power = (c: number, k: number) =>
    c === 0
      ? 0
      : c === 1
        ? ['Power', 10, k]
        : c === -1
          ? ['Negate', ['Power', 10, k]]
          : ['Multiply', c, ['Power', 10, k]];

  const parts = (v: any): [BigDecimal, BigDecimal] => [
    v.bignumRe ?? new BigDecimal(v.re),
    v.bignumIm ?? new BigDecimal(v.im),
  ];

  /** A relative error below 10⁻⁴⁷, or both zero. */
  const closeTo50 = (actual: BigDecimal, expected: string): boolean => {
    const target = new BigDecimal(expected);
    if (target.isZero()) return actual.isZero();
    return actual.sub(target).div(target).abs().lt(new BigDecimal('1e-47'));
  };

  test.each(REAL)('%s(%p·10^%p) at 50 digits', (name, c, k, expRe, expIm) => {
    const big = new ComputeEngine();
    big.precision = 50;
    const v = big.function(name, [big.box(power(c, k) as any)]).N();
    const [re, im] = parts(v);
    if (!closeTo50(re, expRe) || !closeTo50(im, expIm))
      throw new Error(`expected ${expRe} + ${expIm}i, got ${v.toString()}`);
  });

  test.each(REAL)(
    '%s(%p·10^%p) at machine precision',
    (name, c, k, expRe, expIm) => {
      const machine = new ComputeEngine();
      machine.precision = 'machine';
      const v = machine.function(name, [machine.box(power(c, k) as any)]).N();
      expectClose({ re: v.re, im: v.im }, [Number(expRe), Number(expIm)]);
    }
  );

  // A complex argument has the digits of a double, as the complex kernels
  // give at every precision; a part too small for a double is kept.
  test.each(COMPLEX)(
    '%s(%p + %p·i) at 30 digits',
    (name, a, b, expRe, expIm) => {
      const big = new ComputeEngine();
      big.precision = 30;
      const arg = big.box([
        'Add',
        power(...a),
        ['Multiply', ['Complex', 0, 1], power(...b)],
      ] as any);
      const v = big.function(name, [arg]).N();
      const [re, im] = parts(v);
      const close = (x: BigDecimal, e: string) => {
        const target = new BigDecimal(e);
        if (target.isZero()) return x.isZero();
        return x.sub(target).div(target).abs().lt(new BigDecimal('4e-16'));
      };
      if (!close(re, expRe) || !close(im, expIm))
        throw new Error(`expected ${expRe} + ${expIm}i, got ${v.toString()}`);
    }
  );

  test.each(COMPLEX)(
    '%s(%p + %p·i) at machine precision',
    (name, a, b, expRe, expIm) => {
      const machine = new ComputeEngine();
      machine.precision = 'machine';
      const arg = machine.box([
        'Add',
        power(...a),
        ['Multiply', ['Complex', 0, 1], power(...b)],
      ] as any);
      const v = machine.function(name, [arg]).N();
      expectClose({ re: v.re, im: v.im }, [Number(expRe), Number(expIm)]);
    }
  );

  test('the LaTeX inputs of the report', () => {
    const machine = new ComputeEngine();
    machine.precision = 'machine';
    let v = machine.parse('\\arcsin(10^{400})').N();
    expectClose(
      { re: v.re, im: v.im },
      [1.5707963267948966, -921.72718437817822]
    );
    v = machine.parse('\\operatorname{arcsec}(10^{-320})').N();
    expectClose({ re: v.re, im: v.im }, [0, 737.52037693865456]);
    v = machine.parse('\\arcsin(10^{400}+10^{400}i)').N();
    expectClose(
      { re: v.re, im: v.im },
      [0.78539816339744831, 922.07375796845819]
    );
    const big = new ComputeEngine();
    big.precision = 30;
    expect(big.parse('\\arcsin(10^{400})').N().toString()).toBe(
      '(1.57079632679489661923132169164 - 921.727184378178218916613813995i)'
    );
  });

  test('an exact argument stays symbolic under evaluate()', () => {
    expect(ce.parse('\\arcsin(10^{400})').evaluate().operator).toBe('Arcsin');
  });

  test('a float argument at a precision above machine', () => {
    const big = new ComputeEngine();
    big.precision = 30;
    const v = big.parse('\\arcsin(1.5\\times10^{400})').evaluate();
    // π/2 − i·ln(3·10⁴⁰⁰), mpmath
    expect(v.toString()).toBe(
      '(1.57079632679489661923132169164 - 922.132649486286383298591827111i)'
    );
  });

  test('an angle in degrees is converted before the rounding', () => {
    const deg = new ComputeEngine();
    deg.precision = 21;
    deg.angularUnit = 'deg';
    expect(deg.parse('\\arctan(10^{400})').N().toString()).toBe('90');
    expect(deg.parse('\\arcsin(-10^{-400})').N().toString()).toBe(
      '-5.72957795130823208768e-399'
    );
  });

  test('a subnormal float stays on the double kernels at machine precision', () => {
    // `ce.number(1e-320)` is the double nearest 10⁻³²⁰: at machine precision
    // the complex kernel reads that double, as before.
    const machine = new ComputeEngine();
    machine.precision = 'machine';
    expectClose(value(machine, 'Arcsec', 1e-320), [0, 737.52038807153385]);
  });
});

describe('INVERSE TRIG: a part too small next to the other', () => {
  // A complex argument whose smaller part is too small for a double next to
  // the larger one (less than 10⁻²⁸⁰ times it). The sign of the smaller part
  // selects the side of a branch cut on the axis (`arcsin(2 + 10⁻⁴⁰⁰i)` is
  // above the cut), and a part of the value that the smaller part makes
  // nonzero keeps its size (`arccos(1 + 10⁻⁴⁰⁰i)`, at the branch point 1, is
  // `(1 − i)·10⁻²⁰⁰`). Expected values: mpmath at 1700 digits.
  const NEAR_AXIS: [string, unknown, unknown, string, string][] = [
    [
      'Arcsin',
      ['Power', 10, 400],
      1,
      '1.5707963267948966',
      '9.2172718437817822e+2',
    ],
    [
      'Arcsin',
      2,
      ['Power', 10, -400],
      '1.5707963267948966',
      '1.3169578969248167',
    ],
    [
      'Arcsin',
      2,
      ['Negate', ['Power', 10, -400]],
      '1.5707963267948966',
      '-1.3169578969248167',
    ],
    ['Arccos', 1, ['Power', 10, -400], '1.0e-200', '-1.0e-200'],
    [
      'Arsinh',
      ['Power', 10, -400],
      2,
      '1.3169578969248167',
      '1.5707963267948966',
    ],
    ['Arccos', ['Power', 10, 400], 1, '1.0e-400', '-9.2172718437817822e+2'],
    [
      'Artanh',
      2,
      ['Power', 10, -400],
      '5.4930614433405485e-1',
      '1.5707963267948966',
    ],
    [
      'Arcoth',
      ['Rational', 1, 2],
      ['Negate', ['Power', 10, -400]],
      '5.4930614433405485e-1',
      '1.5707963267948966',
    ],
    [
      'Arcsec',
      ['Rational', 1, 2],
      ['Power', 10, -400],
      '2.3094010767585031e-400',
      '1.3169578969248167',
    ],
    [
      'Arcsin',
      ['Power', 10, -400],
      ['Power', 10, -800],
      '1.0e-400',
      '1.0e-800',
    ],
    [
      'Arccos',
      ['Negate', ['Power', 10, 400]],
      ['Negate', ['Power', 10, -400]],
      '3.1415926535897932',
      '9.2172718437817822e+2',
    ],
    [
      'Arctan',
      ['Power', 10, -400],
      2,
      '1.5707963267948966',
      '5.4930614433405485e-1',
    ],
    [
      'Arctan',
      ['Negate', ['Power', 10, -400]],
      2,
      '-1.5707963267948966',
      '5.4930614433405485e-1',
    ],
    [
      'Arcosh',
      -3,
      ['Negate', ['Power', 10, -400]],
      '1.7627471740390861',
      '-3.1415926535897932',
    ],
    [
      'Arccsc',
      ['Rational', 1, 3],
      ['Negate', ['Power', 10, -400]],
      '1.5707963267948966',
      '1.7627471740390861',
    ],
    [
      'Arsech',
      -2,
      ['Power', 10, -400],
      '2.8867513459481288e-401',
      '-2.0943951023931955',
    ],
    [
      'Arsinh',
      ['Negate', ['Power', 10, 500]],
      3,
      '-1.1519856936775828e+3',
      '3.0e-500',
    ],
    // At a logarithmic branch point (±1 for artanh and arcoth, ±i for
    // arctan and arccot) a part grows as ln(1/δ).
    [
      'Artanh',
      1,
      ['Power', 10, -400],
      '460.86359218908911',
      '0.78539816339744831',
    ],
    [
      'Arcoth',
      1,
      ['Power', 10, -400],
      '460.86359218908911',
      '-0.78539816339744831',
    ],
    [
      'Artanh',
      -1,
      ['Negate', ['Power', 10, -400]],
      '-460.86359218908911',
      '-0.78539816339744831',
    ],
    [
      'Arctan',
      ['Power', 10, -400],
      1,
      '0.78539816339744831',
      '460.86359218908911',
    ],
    [
      'Arctan',
      ['Power', 10, -400],
      -1,
      '0.78539816339744831',
      '-460.86359218908911',
    ],
    [
      'Arccot',
      ['Power', 10, -400],
      1,
      '0.78539816339744831',
      '-460.86359218908911',
    ],
  ];

  const box = (engine: ComputeEngine, name: string, re: unknown, im: unknown) =>
    engine
      .function(name, [
        engine.box(['Add', re, ['Multiply', ['Complex', 0, 1], im]] as any),
      ])
      .N();

  test.each(NEAR_AXIS)(
    '%s(%j + %j·i) at 30 digits',
    (name, re, im, eRe, eIm) => {
      const big = new ComputeEngine();
      big.precision = 30;
      const v = box(big, name, re, im) as any;
      const close = (x: BigDecimal, e: string) => {
        const target = new BigDecimal(e);
        if (target.isZero()) return x.isZero();
        return x.sub(target).div(target).abs().lt(new BigDecimal('4e-16'));
      };
      const vr = v.bignumRe ?? new BigDecimal(v.re);
      const vi = v.bignumIm ?? new BigDecimal(v.im);
      if (!close(vr, eRe) || !close(vi, eIm))
        throw new Error(`expected ${eRe} + ${eIm}i, got ${v.toString()}`);
    }
  );

  test.each(NEAR_AXIS)(
    '%s(%j + %j·i) at machine precision',
    (name, re, im, eRe, eIm) => {
      const machine = new ComputeEngine();
      machine.precision = 'machine';
      const v = box(machine, name, re, im);
      expectClose({ re: v.re, im: v.im }, [Number(eRe), Number(eIm)]);
    }
  );
});

describe('INVERSE TRIG: a real argument with a complex value, above machine precision', () => {
  // The complex kernels compute in doubles. A real argument on a branch cut
  // on the real axis now gives both parts at the working precision, on the
  // side of the cut that the kernels take. Expected values: mpmath.
  const CUTS: [string, string, string, string][] = [
    [
      'Arcsin',
      '2',
      '1.5707963267948966192313216916397514420985846996876',
      '-1.3169578969248167086250463473079684440269819714675',
    ],
    [
      'Arcsin',
      '-3/2',
      '-1.5707963267948966192313216916397514420985846996876',
      '9.6242365011920689499551782684873684627036866877132e-1',
    ],
    [
      'Arccos',
      '5/2',
      '0',
      '1.5667992369724110786640568625804834938620823510927',
    ],
    [
      'Arccos',
      '-2',
      '3.1415926535897932384626433832795028841971693993751',
      '-1.3169578969248167086250463473079684440269819714675',
    ],
    [
      'Artanh',
      '2',
      '5.4930614433405484569762261846126285232374527891137e-1',
      '-1.5707963267948966192313216916397514420985846996876',
    ],
    [
      'Artanh',
      '-7/2',
      '-2.9389333245105950409486557030943188488468988068849e-1',
      '1.5707963267948966192313216916397514420985846996876',
    ],
    [
      'Arcosh',
      '1/2',
      '0',
      '1.047197551196597746154214461093167628065723133125',
    ],
    [
      'Arcosh',
      '-1/3',
      '0',
      '1.91063323624901855632771420503151550848682939002',
    ],
    [
      'Arcosh',
      '-4',
      '2.0634370688955605467272811726201318714565914498834',
      '3.1415926535897932384626433832795028841971693993751',
    ],
    [
      'Arccsc',
      '1/2',
      '1.5707963267948966192313216916397514420985846996876',
      '-1.3169578969248167086250463473079684440269819714675',
    ],
    [
      'Arccsc',
      '-1/3',
      '-1.5707963267948966192313216916397514420985846996876',
      '1.7627471740390860504652186499595846180563206565233',
    ],
    [
      'Arcsec',
      '1/2',
      '0',
      '1.3169578969248167086250463473079684440269819714675',
    ],
    [
      'Arcsec',
      '-2/3',
      '3.1415926535897932384626433832795028841971693993751',
      '-9.6242365011920689499551782684873684627036866877132e-1',
    ],
    [
      'Arcoth',
      '1/2',
      '5.4930614433405484569762261846126285232374527891137e-1',
      '-1.5707963267948966192313216916397514420985846996876',
    ],
    [
      'Arcoth',
      '-1/4',
      '-2.5541281188299534160275704815183096743905539822288e-1',
      '1.5707963267948966192313216916397514420985846996876',
    ],
    [
      'Arsech',
      '-1/2',
      '1.3169578969248167086250463473079684440269819714675',
      '3.1415926535897932384626433832795028841971693993751',
    ],
    ['Arsech', '2', '0', '1.047197551196597746154214461093167628065723133125'],
    ['Arsech', '-3', '0', '1.91063323624901855632771420503151550848682939002'],
  ];

  test.each(CUTS)('%s(%s) at 50 digits', (name, x, eRe, eIm) => {
    const big = new ComputeEngine();
    big.precision = 50;
    const v = big.function(name, [big.parse(x)]).N() as any;
    const close = (a: BigDecimal, e: string) => {
      const target = new BigDecimal(e);
      if (target.isZero()) return a.isZero();
      return a.sub(target).div(target).abs().lt(new BigDecimal('1e-47'));
    };
    const vr = v.bignumRe ?? new BigDecimal(v.re);
    const vi = v.bignumIm ?? new BigDecimal(v.im);
    if (!close(vr, eRe) || !close(vi, eIm))
      throw new Error(`expected ${eRe} + ${eIm}i, got ${v.toString()}`);
  });
});

describe('A complex kernel value with a NaN part', () => {
  test('is NaN, and no assertion fails', () => {
    // At machine precision `sin(10⁴⁰⁰ + i)` reaches the complex kernel with
    // an infinite real part, which gives a NaN part.
    const machine = new ComputeEngine();
    machine.precision = 'machine';
    const spy = jest.spyOn(console, 'assert');
    try {
      expect(machine.parse('\\sin(10^{400}+i)').N().isNaN).toBe(true);
      expect(spy.mock.calls.filter(([condition]) => !condition)).toEqual([]);
    } finally {
      spy.mockRestore();
    }
  });
});

describe('INVERSE TRIG: an exact real argument next to ±1', () => {
  // ±(1 ± 10⁻⁴⁰⁰): a big decimal at the working precision, and a double, read
  // it as ±1, so `arcsin(1 + 10⁻⁴⁰⁰)` was the real π/2. The exact rational is
  // read again with the digits that tell it from ±1. Expected values: mpmath
  // at 1700 digits, on the side of each cut that the engine takes at ±1/2
  // and ±3/2.
  const NEAR_ONE: [string, unknown, string, string][] = [
    [
      'Arcsin',
      ['Add', 1, ['Power', 10, -400]],
      '1.57079632679489661923132169164',
      '-1.41421356237309504880168872421e-200',
    ],
    [
      'Arcsin',
      ['Subtract', 1, ['Power', 10, -400]],
      '1.57079632679489661923132169164',
      '0',
    ],
    [
      'Arcsin',
      ['Negate', ['Add', 1, ['Power', 10, -400]]],
      '-1.57079632679489661923132169164',
      '1.41421356237309504880168872421e-200',
    ],
    [
      'Arcsin',
      ['Add', -1, ['Power', 10, -400]],
      '-1.57079632679489661923132169164',
      '0',
    ],
    [
      'Arccos',
      ['Add', 1, ['Power', 10, -400]],
      '0',
      '1.41421356237309504880168872421e-200',
    ],
    [
      'Arccos',
      ['Subtract', 1, ['Power', 10, -400]],
      '1.41421356237309504880168872421e-200',
      '0',
    ],
    [
      'Arccos',
      ['Negate', ['Add', 1, ['Power', 10, -400]]],
      '3.14159265358979323846264338328',
      '-1.41421356237309504880168872421e-200',
    ],
    [
      'Arccos',
      ['Add', -1, ['Power', 10, -400]],
      '3.14159265358979323846264338328',
      '0',
    ],
    [
      'Arcosh',
      ['Add', 1, ['Power', 10, -400]],
      '1.41421356237309504880168872421e-200',
      '0',
    ],
    [
      'Arcosh',
      ['Subtract', 1, ['Power', 10, -400]],
      '0',
      '1.41421356237309504880168872421e-200',
    ],
    [
      'Arcosh',
      ['Negate', ['Add', 1, ['Power', 10, -400]]],
      '1.41421356237309504880168872421e-200',
      '3.14159265358979323846264338328',
    ],
    [
      'Arcosh',
      ['Add', -1, ['Power', 10, -400]],
      '0',
      '3.14159265358979323846264338328',
    ],
    [
      'Artanh',
      ['Add', 1, ['Power', 10, -400]],
      '4.60863592189089109458306906998e+2',
      '-1.57079632679489661923132169164',
    ],
    [
      'Artanh',
      ['Subtract', 1, ['Power', 10, -400]],
      '4.60863592189089109458306906998e+2',
      '0',
    ],
    [
      'Artanh',
      ['Negate', ['Add', 1, ['Power', 10, -400]]],
      '-4.60863592189089109458306906998e+2',
      '1.57079632679489661923132169164',
    ],
    [
      'Artanh',
      ['Add', -1, ['Power', 10, -400]],
      '-4.60863592189089109458306906998e+2',
      '0',
    ],
    [
      'Arccsc',
      ['Add', 1, ['Power', 10, -400]],
      '1.57079632679489661923132169164',
      '0',
    ],
    [
      'Arccsc',
      ['Subtract', 1, ['Power', 10, -400]],
      '1.57079632679489661923132169164',
      '-1.41421356237309504880168872421e-200',
    ],
    [
      'Arccsc',
      ['Negate', ['Add', 1, ['Power', 10, -400]]],
      '-1.57079632679489661923132169164',
      '0',
    ],
    [
      'Arccsc',
      ['Add', -1, ['Power', 10, -400]],
      '-1.57079632679489661923132169164',
      '1.41421356237309504880168872421e-200',
    ],
    [
      'Arcsec',
      ['Add', 1, ['Power', 10, -400]],
      '1.41421356237309504880168872421e-200',
      '0',
    ],
    [
      'Arcsec',
      ['Subtract', 1, ['Power', 10, -400]],
      '0',
      '1.41421356237309504880168872421e-200',
    ],
    [
      'Arcsec',
      ['Negate', ['Add', 1, ['Power', 10, -400]]],
      '3.14159265358979323846264338328',
      '0',
    ],
    [
      'Arcsec',
      ['Add', -1, ['Power', 10, -400]],
      '3.14159265358979323846264338328',
      '-1.41421356237309504880168872421e-200',
    ],
    [
      'Arcoth',
      ['Add', 1, ['Power', 10, -400]],
      '4.60863592189089109458306906998e+2',
      '0',
    ],
    [
      'Arcoth',
      ['Subtract', 1, ['Power', 10, -400]],
      '4.60863592189089109458306906998e+2',
      '-1.57079632679489661923132169164',
    ],
    [
      'Arcoth',
      ['Negate', ['Add', 1, ['Power', 10, -400]]],
      '-4.60863592189089109458306906998e+2',
      '0',
    ],
    [
      'Arcoth',
      ['Add', -1, ['Power', 10, -400]],
      '-4.60863592189089109458306906998e+2',
      '1.57079632679489661923132169164',
    ],
    [
      'Arsech',
      ['Add', 1, ['Power', 10, -400]],
      '0',
      '1.41421356237309504880168872421e-200',
    ],
    [
      'Arsech',
      ['Subtract', 1, ['Power', 10, -400]],
      '1.41421356237309504880168872421e-200',
      '0',
    ],
    [
      'Arsech',
      ['Negate', ['Add', 1, ['Power', 10, -400]]],
      '0',
      '3.14159265358979323846264338328',
    ],
    [
      'Arsech',
      ['Add', -1, ['Power', 10, -400]],
      '1.41421356237309504880168872421e-200',
      '3.14159265358979323846264338328',
    ],
  ];

  const closeTo = (a: BigDecimal, e: string, tolerance: string): boolean => {
    const target = new BigDecimal(e);
    if (target.isZero()) return a.isZero();
    return a.sub(target).div(target).abs().lt(new BigDecimal(tolerance));
  };

  test.each(NEAR_ONE)('%s(%j) at 30 digits', (name, x, eRe, eIm) => {
    const big = new ComputeEngine();
    big.precision = 30;
    const v = big.function(name, [big.box(x as any)]).N() as any;
    const vr = v.bignumRe ?? new BigDecimal(v.re);
    const vi = v.bignumIm ?? new BigDecimal(v.im);
    if (!closeTo(vr, eRe, '1e-27') || !closeTo(vi, eIm, '1e-27'))
      throw new Error(`expected ${eRe} + ${eIm}i, got ${v.toString()}`);
  });

  // At 50 digits the value next to ±1 keeps all its digits: the argument
  // is read with the digits that hold |x| ∓ 1 (mpmath at 400 digits).
  const NEAR_ONE_50: [string, unknown, string, string][] = [
    [
      'Arcsin',
      ['Add', 1, ['Power', 10, -10]],
      '1.5707963267948966192313216916397514420985846996876',
      '-1.4142135623613099357821780971792877360394873290858e-5',
    ],
    [
      'Arcsin',
      ['Subtract', 1, ['Power', 10, -10]],
      '1.5707821846592727704297034743429381821152672681116',
      '0',
    ],
    [
      'Arcsin',
      ['Negate', ['Add', 1, ['Power', 10, -10]]],
      '-1.5707963267948966192313216916397514420985846996876',
      '1.4142135623613099357821780971792877360394873290858e-5',
    ],
    [
      'Arcsin',
      ['Add', 1, ['Power', 10, -40]],
      '1.5707963267948966192313216916397514420985846996876',
      '-1.4142135623730950488016887242096980785696600902639e-20',
    ],
    [
      'Arcsin',
      ['Subtract', 1, ['Power', 10, -40]],
      '1.5707963267948966192171795560160204916105678124455',
      '0',
    ],
    [
      'Arcsin',
      ['Negate', ['Add', 1, ['Power', 10, -40]]],
      '-1.5707963267948966192313216916397514420985846996876',
      '1.4142135623730950488016887242096980785696600902639e-20',
    ],
    [
      'Arcsin',
      ['Add', 1, ['Power', 10, -45]],
      '1.5707963267948966192313216916397514420985846996876',
      '-4.4721359549995793928183473374625524708812367188504e-23',
    ],
    [
      'Arcsin',
      ['Subtract', 1, ['Power', 10, -45]],
      '1.5707963267948966192312769702802014463046565162142',
      '0',
    ],
    [
      'Arccos',
      ['Add', 1, ['Power', 10, -10]],
      '0',
      '1.4142135623613099357821780971792877360394873290858e-5',
    ],
    [
      'Arccos',
      ['Subtract', 1, ['Power', 10, -10]],
      '1.4142135623848801618217296813259983317431575920216e-5',
      '0',
    ],
    [
      'Arccos',
      ['Negate', ['Add', 1, ['Power', 10, -10]]],
      '3.1415926535897932384626433832795028841971693993751',
      '-1.4142135623613099357821780971792877360394873290858e-5',
    ],
    [
      'Arccos',
      ['Add', 1, ['Power', 10, -40]],
      '0',
      '1.4142135623730950488016887242096980785696600902639e-20',
    ],
    [
      'Arccos',
      ['Subtract', 1, ['Power', 10, -40]],
      '1.41421356237309504880168872420969807856968366049e-20',
      '0',
    ],
    [
      'Arccos',
      ['Negate', ['Add', 1, ['Power', 10, -40]]],
      '3.1415926535897932384626433832795028841971693993751',
      '-1.4142135623730950488016887242096980785696600902639e-20',
    ],
    [
      'Arccos',
      ['Add', 1, ['Power', 10, -45]],
      '0',
      '4.4721359549995793928183473374625524708812367188504e-23',
    ],
    [
      'Arccos',
      ['Subtract', 1, ['Power', 10, -45]],
      '4.4721359549995793928183473374625524708812367195957e-23',
      '0',
    ],
    [
      'Arcosh',
      ['Add', 1, ['Power', 10, -10]],
      '1.4142135623613099357821780971792877360394873290858e-5',
      '0',
    ],
    [
      'Arcosh',
      ['Subtract', 1, ['Power', 10, -10]],
      '0',
      '1.4142135623848801618217296813259983317431575920216e-5',
    ],
    [
      'Arcosh',
      ['Negate', ['Add', 1, ['Power', 10, -10]]],
      '1.4142135623613099357821780971792877360394873290858e-5',
      '3.1415926535897932384626433832795028841971693993751',
    ],
    [
      'Arcosh',
      ['Add', 1, ['Power', 10, -40]],
      '1.4142135623730950488016887242096980785696600902639e-20',
      '0',
    ],
    [
      'Arcosh',
      ['Subtract', 1, ['Power', 10, -40]],
      '0',
      '1.41421356237309504880168872420969807856968366049e-20',
    ],
    [
      'Arcosh',
      ['Negate', ['Add', 1, ['Power', 10, -40]]],
      '1.4142135623730950488016887242096980785696600902639e-20',
      '3.1415926535897932384626433832795028841971693993751',
    ],
    [
      'Arcosh',
      ['Add', 1, ['Power', 10, -45]],
      '4.4721359549995793928183473374625524708812367188504e-23',
      '0',
    ],
    [
      'Arcosh',
      ['Subtract', 1, ['Power', 10, -45]],
      '0',
      '4.4721359549995793928183473374625524708812367195957e-23',
    ],
    [
      'Artanh',
      ['Add', 1, ['Power', 10, -10]],
      '1.1859499055275201074797948334150930155376590062407e+1',
      '-1.5707963267948966192313216916397514420985846996876',
    ],
    [
      'Artanh',
      ['Subtract', 1, ['Power', 10, -10]],
      '1.1859499055225201074797948334150888488709923395741e+1',
      '0',
    ],
    [
      'Artanh',
      ['Negate', ['Add', 1, ['Power', 10, -10]]],
      '-1.1859499055275201074797948334150930155376590062407e+1',
      '1.5707963267948966192313216916397514420985846996876',
    ],
    [
      'Artanh',
      ['Add', 1, ['Power', 10, -40]],
      '4.6398275450160886335068445154416372436059804839756e+1',
      '-1.5707963267948966192313216916397514420985846996876',
    ],
    [
      'Artanh',
      ['Subtract', 1, ['Power', 10, -40]],
      '4.6398275450160886335068445154416372436059754839756e+1',
      '0',
    ],
    [
      'Artanh',
      ['Negate', ['Add', 1, ['Power', 10, -40]]],
      '-4.6398275450160886335068445154416372436059804839756e+1',
      '1.5707963267948966192313216916397514420985846996876',
    ],
    [
      'Artanh',
      ['Add', 1, ['Power', 10, -45]],
      '5.2154738182646000545113423791127282955062533561578e+1',
      '-1.5707963267948966192313216916397514420985846996876',
    ],
    [
      'Artanh',
      ['Subtract', 1, ['Power', 10, -45]],
      '5.2154738182646000545113423791127282955062533561078e+1',
      '0',
    ],
    [
      'Arccsc',
      ['Add', 1, ['Power', 10, -10]],
      '1.5707821846592734775364846255351235265048744512715',
      '0',
    ],
    [
      'Arccsc',
      ['Subtract', 1, ['Power', 10, -10]],
      '1.5707963267948966192313216916397514420985846996876',
      '-1.4142135624320206139043683835255921720018552185588e-5',
    ],
    [
      'Arccsc',
      ['Negate', ['Add', 1, ['Power', 10, -10]]],
      '-1.5707821846592734775364846255351235265048744512715',
      '0',
    ],
    [
      'Arccsc',
      ['Add', 1, ['Power', 10, -40]],
      '1.5707963267948966192171795560160204916105678124455',
      '0',
    ],
    [
      'Arccsc',
      ['Subtract', 1, ['Power', 10, -40]],
      '1.5707963267948966192313216916397514420985846996876',
      '-1.414213562373095048801688724209698078569730800942e-20',
    ],
    [
      'Arccsc',
      ['Negate', ['Add', 1, ['Power', 10, -40]]],
      '-1.5707963267948966192171795560160204916105678124455',
      '0',
    ],
    [
      'Arccsc',
      ['Add', 1, ['Power', 10, -45]],
      '1.5707963267948966192312769702802014463046565162142',
      '0',
    ],
    [
      'Arccsc',
      ['Subtract', 1, ['Power', 10, -45]],
      '1.5707963267948966192313216916397514420985846996876',
      '-4.4721359549995793928183473374625524708812367210864e-23',
    ],
    [
      'Arcsec',
      ['Add', 1, ['Power', 10, -10]],
      '1.414213562314169483706610462791559371024841603774e-5',
      '0',
    ],
    [
      'Arcsec',
      ['Subtract', 1, ['Power', 10, -10]],
      '0',
      '1.4142135624320206139043683835255921720018552185588e-5',
    ],
    [
      'Arcsec',
      ['Negate', ['Add', 1, ['Power', 10, -10]]],
      '3.1415785114541700967678063171748749686034591509591',
      '0',
    ],
    [
      'Arcsec',
      ['Add', 1, ['Power', 10, -40]],
      '1.4142135623730950488016887242096980785696129498118e-20',
      '0',
    ],
    [
      'Arcsec',
      ['Subtract', 1, ['Power', 10, -40]],
      '0',
      '1.414213562373095048801688724209698078569730800942e-20',
    ],
    [
      'Arcsec',
      ['Negate', ['Add', 1, ['Power', 10, -40]]],
      '3.141592653589793238448501247655771933709152512133',
      '0',
    ],
    [
      'Arcsec',
      ['Add', 1, ['Power', 10, -45]],
      '4.4721359549995793928183473374625524708812367173597e-23',
      '0',
    ],
    [
      'Arcsec',
      ['Subtract', 1, ['Power', 10, -45]],
      '0',
      '4.4721359549995793928183473374625524708812367210864e-23',
    ],
    [
      'Arcoth',
      ['Add', 1, ['Power', 10, -10]],
      '1.1859499055275201074797948334150930155376590062407e+1',
      '0',
    ],
    [
      'Arcoth',
      ['Subtract', 1, ['Power', 10, -10]],
      '1.1859499055225201074797948334150888488709923395741e+1',
      '-1.5707963267948966192313216916397514420985846996876',
    ],
    [
      'Arcoth',
      ['Negate', ['Add', 1, ['Power', 10, -10]]],
      '-1.1859499055275201074797948334150930155376590062407e+1',
      '0',
    ],
    [
      'Arcoth',
      ['Add', 1, ['Power', 10, -40]],
      '4.6398275450160886335068445154416372436059804839756e+1',
      '0',
    ],
    [
      'Arcoth',
      ['Subtract', 1, ['Power', 10, -40]],
      '4.6398275450160886335068445154416372436059754839756e+1',
      '-1.5707963267948966192313216916397514420985846996876',
    ],
    [
      'Arcoth',
      ['Negate', ['Add', 1, ['Power', 10, -40]]],
      '-4.6398275450160886335068445154416372436059804839756e+1',
      '0',
    ],
    [
      'Arcoth',
      ['Add', 1, ['Power', 10, -45]],
      '5.2154738182646000545113423791127282955062533561578e+1',
      '0',
    ],
    [
      'Arcoth',
      ['Subtract', 1, ['Power', 10, -45]],
      '5.2154738182646000545113423791127282955062533561078e+1',
      '-1.5707963267948966192313216916397514420985846996876',
    ],
    [
      'Arsech',
      ['Add', 1, ['Power', 10, -10]],
      '0',
      '1.414213562314169483706610462791559371024841603774e-5',
    ],
    [
      'Arsech',
      ['Subtract', 1, ['Power', 10, -10]],
      '1.4142135624320206139043683835255921720018552185588e-5',
      '0',
    ],
    [
      'Arsech',
      ['Negate', ['Add', 1, ['Power', 10, -10]]],
      '0',
      '3.1415785114541700967678063171748749686034591509591',
    ],
    [
      'Arsech',
      ['Add', 1, ['Power', 10, -40]],
      '0',
      '1.4142135623730950488016887242096980785696129498118e-20',
    ],
    [
      'Arsech',
      ['Subtract', 1, ['Power', 10, -40]],
      '1.414213562373095048801688724209698078569730800942e-20',
      '0',
    ],
    [
      'Arsech',
      ['Negate', ['Add', 1, ['Power', 10, -40]]],
      '0',
      '3.141592653589793238448501247655771933709152512133',
    ],
    [
      'Arsech',
      ['Add', 1, ['Power', 10, -45]],
      '0',
      '4.4721359549995793928183473374625524708812367173597e-23',
    ],
    [
      'Arsech',
      ['Subtract', 1, ['Power', 10, -45]],
      '4.4721359549995793928183473374625524708812367210864e-23',
      '0',
    ],
  ];

  test.each(NEAR_ONE_50)('%s(%j) at 50 digits', (name, x, eRe, eIm) => {
    const big = new ComputeEngine();
    big.precision = 50;
    const v = big.function(name, [big.box(x as any)]).N() as any;
    const vr = v.bignumRe ?? new BigDecimal(v.re);
    const vi = v.bignumIm ?? new BigDecimal(v.im);
    if (!closeTo(vr, eRe, '1e-47') || !closeTo(vi, eIm, '1e-47'))
      throw new Error(`expected ${eRe} + ${eIm}i, got ${v.toString()}`);
  });

  test.each(NEAR_ONE)('%s(%j) at machine precision', (name, x, eRe, eIm) => {
    const machine = new ComputeEngine();
    machine.precision = 'machine';
    const v = machine.function(name, [machine.box(x as any)]).N();
    expectClose({ re: v.re, im: v.im }, [Number(eRe), Number(eIm)]);
  });
});

describe('INVERSE TRIG: the operand is evaluated once', () => {
  // The exact operand is evaluated again only when it is built from number
  // literals with arithmetic (`isLiteralArithmetic`): a `Random()` operand
  // must not draw twice. The draw after the expression is the second draw
  // of the frame, as after `Random()` alone.
  const tail = (engine: ComputeEngine, body: unknown) =>
    engine
      .box(['WithRandomSeed', 7, ['Block', ['List', body], ['Random']]] as any)
      .evaluate().re;
  test.each([
    ['Arcsin', ['Add', 1, ['Random']]],
    ['Arccos', ['Multiply', 0, ['Random']]],
    ['Arsinh', ['Multiply', ['Complex', 0, 1], ['Add', 1, ['Random']]]],
    ['Arctan', ['Add', 1, ['Random']]],
    ['Arcosh', ['Multiply', -1, ['Random']]],
  ])('%s(%j) draws once', (name, operand) => {
    for (const precision of ['machine', 30] as const) {
      const engine = new ComputeEngine();
      engine.precision = precision;
      expect(tail(engine, [name, operand])).toBe(tail(engine, ['Random']));
      expect(tail(engine, ['N', [name, operand]])).toBe(
        tail(engine, ['N', ['Sin', operand]])
      );
    }
  });
});

describe('INVERSE TRIG: an operand too large to evaluate again', () => {
  test('is not evaluated exactly again', () => {
    // The exact value of `(10^{1000}+1)^{10000}` has 10⁷ digits: the hook
    // that reads the exact operand bounds the digits before it evaluates.
    const machine = new ComputeEngine();
    machine.precision = 'machine';
    for (const latex of [
      '\\arcsin((10^{1000}+1)^{10000})',
      '\\arcsin(((10^{10}+1)^{1000}+1)^{10000})',
    ]) {
      const expr = machine.parse(latex);
      const start = Date.now();
      expr.N();
      // The time depends on the load of the machine, so the limit is asserted
      // only in a `CE_PERF=1` run. The test then still checks that `.N()` does
      // not throw or hang.
      if (process.env.CE_PERF === '1')
        expect(Date.now() - start).toBeLessThan(200);
    }
  });
});

describe('Arctan: the type of a symbol operand', () => {
  test('a valueless symbol is typed from the signature', () => {
    // The `canonical` handler of `Arctan` runs the validation that a head
    // without one runs, so the operand is typed as before.
    const engine = new ComputeEngine();
    engine.box(['Arctan', 'y']).evaluate();
    expect(engine.box('y').type.toString()).toBe('complex | signed_infinity');
  });
});
