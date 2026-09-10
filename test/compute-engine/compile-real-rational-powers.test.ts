import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

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

  test('an inexact exponent does not acquire an exact rational branch', () => {
    const ce = realEngine();
    const expr = ce.box(['Power', 'x', 5 / 3]);
    const result = compile(expr, { constantFold: false });
    expect(result.success).toBe(true);
    expect(typeof result.run!({ x: -2 })).toBe('object');
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
