import { ComputeEngine, compile } from '../../src/compute-engine';

describe('code generation for document samples', () => {
  test('small powers preserve non-finite values and signed zero', () => {
    const ce = new ComputeEngine();
    for (const n of [2, 3, 4, 5]) {
      const fn = compile(ce.expr(['Power', 'x', n]), {
        to: 'javascript',
        vars: { x: '_.draw()' },
      });
      for (const x of [
        -Infinity,
        -2,
        -0,
        0,
        Number.MIN_VALUE,
        0.125,
        1e-64,
        Number.MAX_VALUE,
        Infinity,
        NaN,
      ]) {
        let calls = 0;
        const actual = fn.run!({
          draw: () => {
            calls++;
            return x;
          },
        }) as number;
        const expected = Math.pow(x, n);
        expect(calls).toBe(1);
        if (!Number.isFinite(expected) || expected === 0)
          expect(actual).toBe(expected);
        else
          expect(Math.abs((actual - expected) / expected)).toBeLessThan(1e-14);
      }
    }
  });

  test.each(['javascript', 'glsl'] as const)(
    '%s uses native exp',
    (to) => {
      const ce = new ComputeEngine();
      const expr = ce.expr(['Power', 'ExponentialE', 'x']);
      const fn = compile(expr, { to });
      expect(fn.code).toContain(to === 'javascript' ? 'Math.exp(' : 'exp(');
      if (to === 'javascript') {
        for (const x of [-Infinity, -4, 0, 3, Infinity, NaN])
          expect(fn.run!({ x })).toBe(Math.exp(x));
      }
      const mapped = compile(expr, { to, vars: { ExponentialE: 'otherBase' } });
      expect(mapped.code).not.toContain('exp(');
    }
  );

  test('counted ranges match materialized ranges, including fractional steps', () => {
    const ce = new ComputeEngine();
    const expr = ce.expr([
      'Comprehension',
      ['Multiply', 'k', 'x'],
      ['Element', 'k', ['Range', 'lo', 'hi', 'step']],
    ]);
    const fn = compile(expr, { to: 'javascript', constantFold: false });
    expect(fn.success).toBe(true);
    expect(fn.code).not.toContain('Array.from');
    for (const [lo, hi, step] of [
      [1, 5, 1],
      [5, 1, -1],
      [0, 1, 0.1],
      [1, 5, -1],
      [1, 5, 0],
      [NaN, 5, 1],
    ]) {
      const length =
        step === 0 ? 0 : Math.max(0, Math.floor((hi - lo) / step) + 1);
      const expected = Array.from({ length }, (_, k) => 2 * (lo + step * k));
      expect(fn.run!({ lo, hi, step, x: 2 })).toEqual(expected);
    }
    expect(() => fn.run!({ lo: 0, hi: Infinity, step: 1, x: 2 })).toThrow(
      RangeError
    );
  });

});
