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
      for (const mode of ['strict', 'complex'] as const) {
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
      compile(even, { constantFold: false, mode: 'complex' }).run!({ x: -2 }),
      want.re,
      want.im
    );
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
      for (const mode of ['strict', 'complex'] as const) {
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
    ['x^{\\frac{1}{2.2}}'],
    ['\\sqrt[2.2]{x}'],
    ['\\sqrt[2.5]{x}'],
    ['x^{0.6}'],
    ['x^{0.4}'],
  ])('interval-js: %s encloses the real root', (latex) => {
    const ce = realEngine();
    const expr = ce.parse(latex);
    const result = compile(expr, { to: 'interval-js' });
    expect(result.success).toBe(true);
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
    ['x^{0.4545454545454545}'],
    ['x^{0.6000000000000001}'],
    ['x^{-0.4545454545454545}'],
    ['x^{0.4000000000000001}'],
    ['\\sqrt[2.2000000000000006]{x}'],
  ])(
    'interval-js: %s, an exponent that is not the double of its rational, encloses the real root',
    (latex) => {
      const ce = realEngine();
      const expr = ce.parse(latex);
      const result = compile(expr, { to: 'interval-js' });
      expect(result.success).toBe(true);
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

  test('interval-js: an exponent that is the double of its rational encloses the real root', () => {
    const ce = realEngine();
    for (const exp of [0.6, 0.45454545454545453]) {
      const expr = ce.box(['Power', 'x', exp]);
      const result = compile(expr, { to: 'interval-js' });
      expect(result.success).toBe(true);
      for (const [lo, hi] of [
        [-32, -32],
        [-1, -1],
        [2, 2],
        [-1.1, -0.9],
      ]) {
        const out = result.run!({ x: { lo, hi } }) as {
          kind: string;
          value: { lo: number; hi: number };
        };
        expect(out.kind).toBe('interval');
        for (const x of [lo, (lo + hi) / 2, hi]) {
          const want = expr.subs({ x: ce.number(x) }).N().re;
          expect(out.value.lo).toBeLessThanOrEqual(want);
          expect(out.value.hi).toBeGreaterThanOrEqual(want);
        }
      }
    }
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

});
