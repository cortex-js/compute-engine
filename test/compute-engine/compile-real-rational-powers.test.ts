import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { shaderFunctions } from './gpu-shader-f32-eval';

function realEngine() {
  const ce = new ComputeEngine();
  ce.declare('x', 'real');
  return ce;
}

function close(actual: unknown, re: number, im = 0) {
  const value =
    typeof actual === 'number'
      ? { re: actual, im: 0 }
      : (actual as { re: number; im: number });
  expect(value.re).toBeCloseTo(re, 11);
  expect(value.im).toBeCloseTo(im, 11);
}

describe('real branches of exact rational powers', () => {
  test.each([
    [5, 3],
    [-5, 3],
    [2, 3],
    [-2, 3],
    [4, 5],
    [-7, 5],
  ])(
    'Power(x, %i/%i) agrees with interpretation on both sides of zero',
    (p, q) => {
      const ce = realEngine();
      const expr = ce.box(['Add', 1, ['Power', 'x', ['Rational', p, q]]]);
      for (const mode of ['strict', 'auto', 'complex'] as const) {
        const result = compile(expr, { mode, constantFold: false });
        expect(result.success).toBe(true);
        for (const x of [-8, -1.2, -0.3, 0.3, 2]) {
          const want = expr.subs({ x: ce.number(x) }).N();
          const actual = result.run!({ x });
          expect(typeof actual).toBe('number');
          close(actual, want.re);
        }
      }
    }
  );

  test.each([3, 5])(
    'derivatives of the %ith root retain the real branch',
    (degree) => {
      const ce = realEngine();
      ce.parse(`f(x):=\\sqrt[${degree}]{x}`).evaluate();
      for (const order of [1, 2, 3]) {
        const expr = ce.box([
          'Add',
          1,
          ['Apply', ['Derivative', 'f', order], 'x'],
        ]);
        const result = compile(expr, { constantFold: false });
        expect(result.success).toBe(true);
        for (const x of [-8, -1.2, -0.3, 0.3, 2]) {
          const want = expr.subs({ x: ce.number(x) }).N();
          close(result.run!({ x }), want.re);
        }
      }
    }
  );

  test('broadcast powers retain their exact exponent inside the scalar callback', () => {
    const ce = realEngine();
    ce.declare('L', 'list<real>');
    const expr = ce.box(['Add', 1, ['Power', 'L', ['Rational', 5, 3]]]);
    const result = compile(expr, { constantFold: false });
    expect(result.success).toBe(true);
    const xs = [-8, -1.2, 0, 2];
    const actual = result.run!({ L: xs }) as number[];
    xs.forEach((x, i) =>
      close(
        actual[i],
        ce.box(['Add', 1, ['Power', x, ['Rational', 5, 3]]]).N().re
      )
    );
  });

  test('an operand supplied by a caller is evaluated once', () => {
    const ce = realEngine();
    const expr = ce.box(['Power', ['Sin', 'x'], ['Rational', 5, 3]]);
    const result = compile(expr, {
      constantFold: false,
      functions: { Sin: '(() => ++globalThis.__cePowerReads)' },
    });
    const state = globalThis as typeof globalThis & { __cePowerReads?: number };
    state.__cePowerReads = 0;
    try {
      expect(result.success).toBe(true);
      expect(result.run!({ x: 1 })).toBe(1);
      expect(state.__cePowerReads).toBe(1);
    } finally {
      delete state.__cePowerReads;
    }
  });

  test('zero and NaN preserve the real numeric convention', () => {
    const ce = realEngine();
    for (const p of [5, -5, 2, -2]) {
      const result = compile(ce.box(['Power', 'x', ['Rational', p, 3]]), {
        constantFold: false,
      });
      expect(result.run!({ x: 0 })).toBe(p > 0 ? 0 : Infinity);
      expect(result.run!({ x: NaN })).toBeNaN();
    }
  });

  test('complex inputs and even denominators keep complex arithmetic', () => {
    const ce = realEngine();
    ce.declare('z', 'complex');
    const expr = ce.box(['Add', 1, ['Power', 'z', ['Rational', 5, 3]]]);
    const result = compile(expr, { constantFold: false });
    for (const [re, im] of [
      [-1.2, 0.3],
      [1, -2],
    ]) {
      const want = expr.subs({ z: ce.box(['Complex', re, im]) }).N();
      close(result.run!({ z: { re, im } }), want.re, want.im);
    }
    const even = ce.box(['Power', 'x', ['Rational', 3, 2]]);
    const want = even.subs({ x: ce.number(-2) }).N();
    close(
      compile(even, { constantFold: false }).run!({ x: -2 }),
      want.re,
      want.im
    );
  });

  test('an inexact exponent gets the real root of the interpreter', () => {
    // The compiler reads `5/3` from the double `1.6666666666666667` with the
    // recognizer of the interpreter (`realPowerBranchTerms()`), so the node
    // takes the real lane with the sign of the odd numerator, and at
    // `x = -2` both give the real root.
    const ce = realEngine();
    const expr = ce.box(['Power', 'x', 5 / 3]);
    const result = compile(expr, { constantFold: false });
    expect(result.success).toBe(true);
    expect(result.code).not.toContain('_SYS.cpow(');
    expect(result.code).toContain('Math.pow(Math.abs(');
    const want = expr.subs({ x: ce.number(-2) }).N();
    expect(want.im).toBe(0);
    const out = result.run!({ x: -2 });
    expect(typeof out).toBe('number');
    close(out, want.re);
  });

  test.each(['glsl', 'wgsl'] as const)(
    '%s uses the real magnitude and a nonzero sign at zero',
    (to) => {
      const ce = realEngine();
      const result = compile(ce.box(['Power', 'x', ['Rational', -5, 3]]), {
        to,
        constantFold: false,
      });
      expect(result.success).toBe(true);
      expect(result.code).toContain('pow(abs(x),');
      expect(result.code).not.toContain('_gpu_cpow');
      expect(result.code).not.toContain('sign(x)');
    }
  );

  test('Python binds the base once and selects the real sign', () => {
    const ce = realEngine();
    const result = compile(
      ce.box(['Power', ['Sin', 'x'], ['Rational', -5, 3]]),
      { to: 'python', constantFold: false }
    );
    expect(result.success).toBe(true);
    expect(result.code).toContain('np.where');
    expect((result.code!.match(/np.power/g) ?? []).length).toBe(1);
    expect((result.code!.match(/np.sin\(x\)/g) ?? []).length).toBe(1);
  });
});

// The interpreter reads a DECIMAL exponent as the nearest small rational
// (`realPowerBranchTerms()`) and takes the real root of a negative base when
// the denominator of that rational is odd: `x^{1/2.2}` is `x^{0.4545…}`,
// read as `x^{5/11}`, which is `−1` at `x = −1`. `\sqrt[2.2]{x}` gives the
// same value. The compiled targets use the same reading. A decimal that does
// not read as a rational with an odd denominator (`0.5`, `0.3`) keeps the
// lowering it had. (Tycho ledger row 400.)
describe('a decimal exponent or root index read as an odd-denominator rational', () => {
  const SHAPES: [string, string][] = [
    ['x^{\\frac{1}{2.2}}', 'x^(1/2.2)'],
    ['\\sqrt[2.2]{x}', 'Root(x, 2.2)'],
    // `1/2.5` is read as `2/5`: an even numerator, so the real root of a
    // negative radicand is positive.
    ['\\sqrt[2.5]{x}', 'Root(x, 2.5)'],
    ['x^{0.6}', 'x^0.6'],
    ['x^{0.4}', 'x^0.4'],
  ];

  test.each(SHAPES)(
    'javascript: %s agrees with the interpreter in every mode',
    (latex) => {
      const ce = realEngine();
      const expr = ce.parse(latex);
      for (const mode of ['strict', 'auto', 'complex'] as const) {
        const result = compile(expr, { mode, constantFold: false });
        expect(result.success).toBe(true);
        expect(result.code).not.toContain('_SYS.cpow(');
        for (const x of [-8, -1, -0.3, 0.3, 2]) {
          const want = expr.subs({ x: ce.number(x) }).N();
          expect(want.im).toBe(0);
          const actual = result.run!({ x });
          expect(typeof actual).toBe('number');
          close(actual, want.re);
        }
      }
    }
  );

  test('the value at x = -1 is -1 for both shapes', () => {
    const ce = realEngine();
    for (const latex of ['x^{\\frac{1}{2.2}}', '\\sqrt[2.2]{x}']) {
      const expr = ce.parse(latex);
      expect(expr.subs({ x: -1 }).evaluate().re).toBe(-1);
      expect(compile(expr).run!({ x: -1 })).toBe(-1);
    }
  });

  test.each([
    ['x^{\\frac{1}{2.2}}', '_IA.powRational(_.x, 5, 11)'],
    ['\\sqrt[2.2]{x}', '_IA.powRational(_.x, 5, 11)'],
    ['\\sqrt[2.5]{x}', '_IA.powRational(_.x, 2, 5)'],
    ['x^{0.6}', '_IA.powRational(_.x, 3, 5)'],
    ['x^{0.4}', '_IA.powRational(_.x, 2, 5)'],
  ])('interval-js: %s encloses the real root', (latex, code) => {
    const ce = realEngine();
    const expr = ce.parse(latex);
    const result = compile(expr, { to: 'interval-js' });
    expect(result.success).toBe(true);
    expect(result.code).toContain(code);
    const out = result.run!({ x: { lo: -1.1, hi: -0.9 } }) as {
      kind: string;
      value: { lo: number; hi: number };
    };
    expect(out.kind).toBe('interval');
    for (const x of [-1.1, -1, -0.9]) {
      const want = expr.subs({ x: ce.number(x) }).N().re;
      expect(out.value.lo).toBeLessThanOrEqual(want);
      expect(out.value.hi).toBeGreaterThanOrEqual(want);
    }
  });

  for (const language of ['glsl', 'wgsl'] as const) {
    test.each(SHAPES)(`${language}: %s agrees with the interpreter`, (latex) => {
      const ce = realEngine();
      const expr = ce.parse(latex);
      const result = compile(expr, { to: language });
      expect(result.success).toBe(true);
      expect(result.code).toContain('pow(abs(x)');
      const main =
        language === 'glsl'
          ? `float _main(float x) { return ${result.code}; }`
          : `fn _main(x: f32) -> f32 { return ${result.code}; }`;
      const run = shaderFunctions(`${result.preamble ?? ''}\n${main}`, language);
      for (const x of [-8, -1, 2]) {
        const want = expr.subs({ x: ce.number(x) }).N().re;
        const v = run('_main', Math.fround(x)) as number;
        expect(Math.abs(v - want)).toBeLessThanOrEqual(1e-6 * Math.abs(want));
      }
    });
  }

  test('a root index read with an even numerator gives the positive real root', () => {
    // `\sqrt[2.5]{x}` is `x^{2/5}`: at `x = -8` the interpreter gives
    // `+8^0.4 = 2.2973967…`, and every target gives the magnitude form.
    const ce = realEngine();
    const expr = ce.parse('\\sqrt[2.5]{x}');
    const want = expr.subs({ x: -8 }).N().re;
    expect(want).toBeCloseTo(2.2973967, 7);
    const js = compile(expr, { constantFold: false });
    expect(js.code).toBe('Math.pow(Math.abs(_.x), 0.4)');
    close(js.run!({ x: -8 }), want);
    const ia = compile(expr, { to: 'interval-js' });
    expect(ia.code).toContain('_IA.powRational(_.x, 2, 5)');
    const out = ia.run!({ x: { lo: -8.1, hi: -7.9 } }) as {
      kind: string;
      value: { lo: number; hi: number };
    };
    expect(out.kind).toBe('interval');
    expect(out.value.lo).toBeLessThanOrEqual(want);
    expect(out.value.hi).toBeGreaterThanOrEqual(want);
    const glsl = compile(expr, { to: 'glsl' });
    expect(glsl.code).toContain('pow(abs(x), ');
    expect(glsl.code).not.toContain('sign');
    const py = compile(expr, { to: 'python' });
    expect(py.code).toBe('np.power(np.abs(x), 1.0 / 2.5)');
    // A constant radicand folds to the positive value.
    expect(Number(compile(ce.parse('\\sqrt[2.5]{-8}')).code)).toBeCloseTo(
      want,
      12
    );
  });

  // The interpreter takes the sign of `x^0.6000000000000001` from the
  // rational `3/5` and the magnitude from the float. `powRational(x, 3, 5)`
  // encloses the value of `x^(3/5)`, which at `x = -32` is exactly `-8` and
  // excludes `-(32^0.6000000000000001)`, so such an exponent uses
  // `powRealBranch`, which encloses `±|x|^e` with the float `e`. `_IA.pow`
  // was used before, and it is `empty` for a negative base, where the
  // interpreter and the `javascript` target give the real root.
  // `0.4545454545454545` is the 16-digit spelling of `5/11` (its double is
  // `0.45454545454545453`), and `1/2.2000000000000006` is not the double of
  // `5/11` either. (Tycho ledger row 406.)
  test.each([
    [
      'x^{0.4545454545454545}',
      '_IA.powRealBranch(_.x, 0.4545454545454545, true)',
    ],
    [
      'x^{0.6000000000000001}',
      '_IA.powRealBranch(_.x, 0.6000000000000001, true)',
    ],
    [
      'x^{-0.4545454545454545}',
      '_IA.powRealBranch(_.x, -0.4545454545454545, true)',
    ],
    [
      'x^{0.4000000000000001}',
      '_IA.powRealBranch(_.x, 0.4000000000000001, false)',
    ],
    [
      '\\sqrt[2.2000000000000006]{x}',
      '_IA.powRealBranch(_.x, 0.4545454545454544, true)',
    ],
  ])(
    'interval-js: %s, an exponent that is not the double of its rational, encloses the real root',
    (latex, code) => {
      const ce = realEngine();
      const expr = ce.parse(latex);
      const result = compile(expr, { to: 'interval-js' });
      expect(result.success).toBe(true);
      expect(result.code).toBe(code);
      const js = compile(expr, { constantFold: false });
      for (const [lo, hi] of [
        [-1.1, -0.9],
        [-32, -32],
        [-2, 3],
        [0.5, 4],
      ]) {
        const out = result.run!({ x: { lo, hi } }) as {
          kind: string;
          value?: { lo: number; hi: number };
        };
        // A negative exponent has a pole at 0.
        if (lo < 0 && hi > 0 && latex.includes('{-')) {
          expect(out.kind).toBe('singular');
          continue;
        }
        expect(out.kind).toBe('interval');
        for (const x of [lo, (lo + hi) / 2, hi]) {
          for (const want of [
            expr.subs({ x: ce.number(x) }).N().re,
            js.run!({ x }) as number,
          ]) {
            expect(out.value!.lo).toBeLessThanOrEqual(want);
            expect(out.value!.hi).toBeGreaterThanOrEqual(want);
          }
        }
      }
    }
  );

  test('interval-js: an exponent that is the double of its rational keeps `powRational`', () => {
    const ce = realEngine();
    const code = (exp: number) =>
      compile(ce.box(['Power', 'x', exp]), { to: 'interval-js' }).code;
    expect(code(0.6)).toBe('_IA.powRational(_.x, 3, 5)');
    expect(code(0.45454545454545453)).toBe('_IA.powRational(_.x, 5, 11)');
  });

  // The constant fold reads the emitted code and accepts it only when what
  // is left after it removes the routine names and the known identifiers is
  // digits and punctuation. The sign flag `true`/`false` of `powRealBranch`
  // must be one of the removed identifiers, or a constant base is never
  // folded.
  test('interval-js: `powRealBranch` over a constant base folds', () => {
    const ce = realEngine();
    const result = compile(ce.box(['Power', -32, 0.4545454545454545]), {
      to: 'interval-js',
    });
    expect(result.success).toBe(true);
    expect(result.code).not.toContain('powRealBranch');
    const out = result.run!({}) as {
      kind: string;
      value: { lo: number; hi: number };
    };
    expect(out.kind).toBe('interval');
    const want = -(32 ** 0.4545454545454545);
    expect(out.value.lo).toBeLessThanOrEqual(want);
    expect(out.value.hi).toBeGreaterThanOrEqual(want);
  });

  test('python: Root(x, 2.2) takes the signed real root', () => {
    const ce = realEngine();
    const result = compile(ce.parse('\\sqrt[2.2]{x}'), { to: 'python' });
    expect(result.success).toBe(true);
    expect(result.code).toContain('np.sign(x)');
  });

  test('a decimal that does not read as an odd-denominator rational keeps its lowering', () => {
    const ce = realEngine();
    const code = (latex: string, options: object = {}) =>
      compile(ce.parse(latex), { constantFold: false, ...options }).code;
    // `0.5` and `0.3` read as `1/2` and `3/10`: an even denominator, the
    // principal complex value.
    expect(code('x^{0.5}')).toContain('_SYS.cpow(');
    expect(code('x^{0.3}')).toContain('_SYS.cpow(');
    expect(code('x^{0.3}', { mode: 'strict' })).toBe('Math.pow(_.x, 0.3)');
    expect(code('x^{0.5}', { to: 'interval-js' })).toBe('_IA.sqrt(_.x)');
    expect(code('x^{0.3}', { to: 'interval-js' })).toBe('_IA.pow(_.x, 0.3)');
    expect(code('x^{0.3}', { to: 'glsl' })).toBe('pow(x, 0.3)');
    // `2.4` reads as `12/5`, so `1/2.4` is `5/12`: an even denominator, the
    // principal complex value for a negative radicand.
    expect(code('\\sqrt[2.4]{x}')).toBe('Math.pow(_.x, 0.4166666666666667)');
    expect(code('\\sqrt[2.4]{x}', { to: 'interval-js' })).toBe(
      '_IA.pow(_.x, 0.4166666666666667)'
    );
    // `1.5` reads as `3/2`, so `1/1.5` is `2/3`: an odd denominator and an
    // even numerator, the positive real root.
    expect(code('\\sqrt[1.5]{x}', { to: 'interval-js' })).toBe(
      '_IA.powRational(_.x, 2, 3)'
    );
    // A provably non-negative base keeps the plain power.
    ce.declare('t', 'real');
    ce.assume(ce.parse('t \\ge 0'));
    expect(code('t^{0.6}')).toBe('Math.pow(_.t, 0.6)');
    expect(code('t^{0.6}', { to: 'interval-js' })).toBe('_IA.pow(_.t, 0.6)');
  });
});
