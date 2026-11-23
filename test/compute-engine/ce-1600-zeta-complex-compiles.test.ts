/**
 * CE-1600: `Zeta` of a complex argument compiles on JavaScript, with the
 * interpreter's kernel (the Hurwitz kernel at `a = 1`). It declined with
 * "Zeta of complex", so a plot of zeta on the critical strip ran in the
 * interpreter at every sample.
 */
import { ComputeEngine, compile } from '../../src/compute-engine';

type Cx = { re: number; im: number };

const ce = new ComputeEngine();
ce.declare('z', 'complex');
ce.declare('t', 'real');

function interpreter(re: number, im: number): Cx {
  const v = ce.box(['Zeta', ['Complex', re, im]]).N();
  return { re: v.re, im: v.im };
}

// `run()` gives a number when the value is real.
function expectClose(value: Cx | number, want: Cx): void {
  const got = typeof value === 'number' ? { re: value, im: 0 } : value;
  const scale = Math.max(1, Math.hypot(want.re, want.im));
  expect(Math.hypot(got.re - want.re, got.im - want.im) / scale).toBeLessThan(
    1e-12
  );
}

describe('Zeta of a complex argument on JavaScript', () => {
  const f = compile(ce.box(['Zeta', 'z']), {
    fallback: false,
  } as never) as unknown as {
    run: (v: object) => Cx | number;
  };

  test.each([
    [2, 3],
    [0.5, 14.134725141734693],
    [0.5, 34],
    [-2.5, 3],
    [3, -20],
    [0.25, 0.5],
    // On the real axis, given as a complex input.
    [-2.5, 0],
    [0, 0],
    [2, 0],
  ])('ζ(%d + %di)', (re, im) => {
    expectClose(f.run({ z: ce.complex(re, im) }), interpreter(re, im));
  });

  test('|ζ(1/2 + it)| with t real', () => {
    const g = compile(
      ce.box([
        'Abs',
        [
          'Zeta',
          ['Add', ['Rational', 1, 2], ['Multiply', 'ImaginaryUnit', 't']],
        ],
      ]),
      { fallback: false } as never
    ) as unknown as { run: (v: object) => number };
    for (const t of [0, 5, 21.022039638771555, 30]) {
      const want = interpreter(0.5, t);
      expect(g.run({ t })).toBeCloseTo(Math.hypot(want.re, want.im), 12);
    }
  });

  test('at the pole, a complex input gives a non-finite value', () => {
    const v = f.run({ z: ce.complex(1, 0) });
    if (typeof v === 'number') expect(Number.isFinite(v)).toBe(false);
    else expect(Number.isFinite(v.re) && Number.isFinite(v.im)).toBe(false);
  });

  test('a real input stays on the real kernel in the complex mode', () => {
    ce.declare('x', 'real');
    const r = compile(ce.box(['Zeta', 'x']), {
      mode: 'complex',
      fallback: false,
    } as never) as unknown as { code: string };
    expect(r.code).toContain('ir.zeta(');
    expect(r.code).not.toContain('czeta');
  });

  test('GLSL compiles it too (`ce-1600-glsl-complex-zeta.test.ts`)', () => {
    const r = compile(ce.box(['Zeta', 'z']), {
      to: 'glsl',
      fallback: false,
    } as never) as unknown as { code: string };
    expect(r.code).toContain('_gpu_ir_czeta(');
  });
});
