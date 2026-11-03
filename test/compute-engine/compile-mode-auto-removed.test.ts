import { ComputeEngine, compile } from '../../src/compute-engine';
import { stochasticEqual } from '../../src/compute-engine/boxed-expression/stochastic-equal';

/**
 * The compile modes after the removal of `'auto'`
 * (`docs/COMPILATION-MODEL.md`, "Compile modes"):
 *
 * - `'strict'` is the default of every target. The lane of a value follows
 *   its static type: an operation whose exact value is complex on a real
 *   lane gives `NaN` (`Sqrt(x)` with `x: real` at `x = -4`).
 * - `'complex'` is the mode a host asks for to get complex intermediate
 *   values. It returns a JavaScript number when the value is real.
 * - A request for `'auto'` declines with `unsupported-mode` on every target.
 * - The result has no `promoted` and no `escalation` field.
 *
 * The engine's own compilations keep the values of the interpreter: the
 * `Map` drain, the `Reduce` fast path and the stochastic-equality probes
 * compile in `'strict'` and compute a `NaN` element again with the
 * interpreter.
 */

function engine(): ComputeEngine {
  const ce = new ComputeEngine();
  ce.declare('x', 'real');
  return ce;
}

describe('COMPILE MODES: auto is removed', () => {
  for (const to of ['javascript', 'python'] as const) {
    test(`${to}: mode 'auto' declines with unsupported-mode`, () => {
      const ce = engine();
      const r = compile(ce.parse('\\sqrt{x}'), {
        to,
        mode: 'auto',
      } as any) as any;
      expect(r.success).toBe(false);
      expect(r.diagnostic?.code).toBe('unsupported-mode');
      expect(r.error).toContain("'complex'");
    });

    test(`${to}: the default mode is strict`, () => {
      const ce = engine();
      const r = compile(ce.parse('\\sqrt{x}'), { to }) as any;
      expect(r.success).toBe(true);
      expect(r.mode).toBe('strict');
      expect('promoted' in r).toBe(false);
      expect('escalation' in r).toBe(false);
    });
  }

  test('a direct target: mode auto declines with unsupported-mode', () => {
    const ce = engine();
    const target = ce._getCompilationTarget('javascript')!.createTarget();
    const r = compile(ce.parse('\\sqrt{x}'), {
      target,
      mode: 'auto',
    } as any) as any;
    expect(r.success).toBe(false);
    expect(r.diagnostic?.code).toBe('unsupported-mode');
  });

  test('Sqrt(x), x: real, at -4 is NaN by default', () => {
    const ce = engine();
    const r = compile(ce.parse('\\sqrt{x}'));
    expect(r.success).toBe(true);
    expect(r.code).toBe('Math.sqrt(_.x)');
    expect(r.run!({ x: -4 })).toBeNaN();
    expect(r.run!({ x: 4 })).toBe(2);
  });

  test("Sqrt(x), x: real, at -4 is 2i with mode: 'complex'", () => {
    const ce = engine();
    const r = compile(ce.parse('\\sqrt{x}'), { mode: 'complex' });
    expect(r.success).toBe(true);
    expect(r.mode).toBe('complex');
    expect(r.run!({ x: -4 })).toEqual({ re: 0, im: 2 });
    // A real value is a JavaScript number.
    expect(r.run!({ x: 4 })).toBe(2);
  });

  test("Sqrt(x)^2 at -4 is the number -4 with mode: 'complex'", () => {
    const ce = engine();
    const r = compile(ce.parse('\\sqrt{x}^2'), { mode: 'complex' });
    expect(r.success).toBe(true);
    expect(r.run!({ x: -4 })).toBe(-4);
  });

  test('x + 2i, x: real, is complex under the default', () => {
    const ce = engine();
    const r = compile(ce.parse('x + 2i'));
    expect(r.success).toBe(true);
    expect(r.mode).toBe('strict');
    expect(r.run!({ x: 1 })).toEqual({ re: 1, im: 2 });
  });

  test("the negation of a real keeps a +0 imaginary part in mode: 'complex'", () => {
    // `Ln(-x)` at `x = 2` is `ln 2 + iπ`, as in the interpreter: the
    // negation of the lifted real `{re: 2, im: 0}` must not give `im: -0`,
    // which puts `_SYS.cln` on the lower side of its branch cut.
    const ce = new ComputeEngine();
    const r = compile(ce.parse('\\ln(-x)'), { mode: 'complex' });
    expect(r.success).toBe(true);
    const v = r.run!({ x: 2 }) as unknown as { re: number; im: number };
    expect(v.re).toBeCloseTo(Math.LN2, 14);
    expect(v.im).toBeCloseTo(Math.PI, 14);
    const s = compile(ce.parse('\\sqrt{-x}'), { mode: 'complex' });
    expect(s.run!({ x: 2 })).toEqual({ re: 0, im: Math.SQRT2 });
  });
});

describe('ENGINE COMPILATIONS keep the interpreter value', () => {
  // Each engine-internal compilation compiled in the removed default `'auto'`
  // mode. It now compiles in `'strict'` and computes a `NaN` element again
  // with the interpreter; the evaluated value is the same, and equal to the
  // value with the compiler turned off.
  function both<T>(f: (ce: ComputeEngine) => T): [T, T] {
    const on = new ComputeEngine();
    const off = new ComputeEngine();
    off.jit = 'off';
    return [f(on), f(off)];
  }

  test('Map(x ↦ N(√x), [4, -4]) is [2, 2i]', () => {
    const [on, off] = both((ce) =>
      [
        ...ce
          .box(['Map', ['Function', ['N', ['Sqrt', 'y']], 'y'], ['List', 4, -4]])
          .evaluate()
          .each(),
      ].map((e) => e.toString())
    );
    expect(on).toEqual(['2', '2i']);
    expect(on).toEqual(off);
  });

  test('Reduce([-4, 4], (a, x) ↦ a + √x, 0) is 2 + 2i', () => {
    const [on, off] = both((ce) =>
      ce
        .box([
          'Reduce',
          ['List', -4, 4],
          ['Function', ['Add', 'a', ['Sqrt', 'x']], 'a', 'x'],
          0,
        ])
        .N()
        .toString()
    );
    expect(on).toBe('(2 + 2i)');
    expect(on).toBe(off);
  });

  test('the stochastic probes compare complex values', () => {
    // `√x` and `i·√(−x)` agree for `x < 0` and differ for `x > 0`;
    // `ln(x)` and `ln(−x) + iπ` agree for `x < 0` and differ by `2πi` for
    // `x > 0`. Both differences are in the imaginary part.
    const [on, off] = both((ce) => [
      stochasticEqual(ce.parse('\\sqrt{x}'), ce.parse('i\\sqrt{-x}')),
      stochasticEqual(ce.parse('\\ln(x)'), ce.parse('\\ln(-x) + i\\pi')),
      stochasticEqual(ce.parse('\\sqrt{x}^2'), ce.parse('x')),
    ]);
    expect(on).toEqual([false, false, true]);
    expect(on).toEqual(off);
  });
});
