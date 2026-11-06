import { engine as ce } from '../utils';
import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { GLSLTarget } from '../../src/compute-engine/compilation/glsl-target';
import { WGSLTarget } from '../../src/compute-engine/compilation/wgsl-target';

describe('FRACTAL FUNCTIONS', () => {
  describe('Mandelbrot JS evaluate', () => {
    it('returns 1 for origin (inside set)', () => {
      const result = ce.expr(['Mandelbrot', ['Complex', 0, 0], 100]).evaluate();
      expect(result.re).toBeCloseTo(1.0, 5);
    });

    it('returns 1 for c=-0.5 (inside set)', () => {
      const result = ce
        .expr(['Mandelbrot', ['Complex', -0.5, 0], 100])
        .evaluate();
      expect(result.re).toBeCloseTo(1.0, 5);
    });

    it('returns <1 for c=2 (escapes fast)', () => {
      const result = ce.expr(['Mandelbrot', ['Complex', 2, 0], 100]).evaluate();
      expect(result.re).toBeGreaterThanOrEqual(0);
      expect(result.re).toBeLessThan(1);
    });

    it('returns value in [0,1] for c=0.3+0.5i', () => {
      const result = ce
        .expr(['Mandelbrot', ['Complex', 0.3, 0.5], 100])
        .evaluate();
      expect(result.re).toBeGreaterThanOrEqual(0);
      expect(result.re).toBeLessThanOrEqual(1);
    });
  });

  describe('Julia JS evaluate', () => {
    it('returns 1 for z=0, c=-0.5 (inside set)', () => {
      const result = ce
        .expr(['Julia', ['Complex', 0, 0], ['Complex', -0.5, 0], 100])
        .evaluate();
      expect(result.re).toBeCloseTo(1.0, 5);
    });

    it('returns <1 for z=0, c=2 (escapes fast)', () => {
      const result = ce
        .expr(['Julia', ['Complex', 0, 0], ['Complex', 2, 0], 100])
        .evaluate();
      expect(result.re).toBeGreaterThanOrEqual(0);
      expect(result.re).toBeLessThan(1);
    });

    it('returns value in [0,1] for z=0.3+0.5i, c=-0.4+0.6i', () => {
      const result = ce
        .expr(['Julia', ['Complex', 0.3, 0.5], ['Complex', -0.4, 0.6], 100])
        .evaluate();
      expect(result.re).toBeGreaterThanOrEqual(0);
      expect(result.re).toBeLessThanOrEqual(1);
    });
  });
});

// The largest jump of the smooth count across the iteration boundaries on the
// line y = cy. Bisection finds two points 1e-13 apart whose integer escape
// counts differ by one, so the slope of the field between two samples does not
// count as a jump. Each boundary is measured for the engine and for the formula
// without the further iterations, which shows that the test can fail.
function largestJumps(cy: number): { engine: number; escapeTestOnly: number } {
  const MAX = 256;
  const engine = (cx: number): number =>
    ce.expr(['Mandelbrot', ['Complex', cx, cy], MAX]).evaluate().re * MAX;
  const scan = (cx: number): { i: number; escapeTestOnly: number } => {
    let zx = 0;
    let zy = 0;
    for (let i = 0; i < MAX; i++) {
      const t = zx * zx - zy * zy + cx;
      zy = 2 * zx * zy + cy;
      zx = t;
      const m = zx * zx + zy * zy;
      if (m > 4) return { i, escapeTestOnly: i - Math.log2(Math.log2(m)) + 4 };
    }
    return { i: MAX, escapeTestOnly: MAX };
  };
  let largest = { engine: 0, escapeTestOnly: 0 };
  for (let x = -2.5; x < 1; x += 0.01) {
    let lo = x;
    let hi = x + 0.01;
    let a = scan(lo);
    let b = scan(hi);
    if (a.i === MAX || b.i === MAX || Math.abs(a.i - b.i) !== 1) continue;
    while (hi - lo > 1e-13) {
      const mid = (lo + hi) / 2;
      const m = scan(mid);
      if (m.i === a.i) {
        lo = mid;
        a = m;
      } else {
        hi = mid;
        b = m;
      }
    }
    largest = {
      engine: Math.max(largest.engine, Math.abs(engine(lo) - engine(hi))),
      escapeTestOnly: Math.max(
        largest.escapeTestOnly,
        Math.abs(a.escapeTestOnly - b.escapeTestOnly)
      ),
    };
  }
  return largest;
}

describe('FRACTAL SMOOTH VALUE', () => {
  it('is continuous across an iteration boundary', () => {
    for (const cy of [1.2, 0.9, 0.4]) {
      const { engine, escapeTestOnly } = largestJumps(cy);
      expect(escapeTestOnly).toBeGreaterThan(0.1);
      expect(engine).toBeLessThan(0.05);
    }
  });

  it('a point past the escape radius is outside when the orbit grows slowly', () => {
    // c = -2.0001 passes |z| = 2 on the first iterate, and its orbit needs 10
    // further iterations to reach the radius of the smoothing.
    const v = ce
      .expr(['Mandelbrot', ['Complex', -2.0001, 0], 64])
      .evaluate().re;
    expect(v).toBeGreaterThan(0);
    expect(v).toBeLessThan(1);
  });

  it('a slower orbit takes the value of the first iterate at the bound', () => {
    // c = -2.0000000001 does not reach the radius of the smoothing in 16 further
    // iterations. Its first iterate has |z|^2 of about 4, so the count is
    // 0 - log2(log2(4)) + 4 = 3.
    const v = ce
      .expr(['Mandelbrot', ['Complex', -2.0000000001, 0], 64])
      .evaluate().re;
    expect(v).toBeCloseTo(3 / 64, 6);
  });

  it('ends on an orbit that stays past the escape radius', () => {
    // z = 3 is a fixed point of z^2 - 6, so the further iteration must stop
    // at its bound and the value must come from the first iterate.
    const v = ce.expr(['Julia', 3, -6, 10]).evaluate().re;
    expect(v).toBeCloseTo((0 - Math.log2(Math.log2(9)) + 4) / 10, 10);
  });

  it('the compiled JavaScript agrees with evaluate', () => {
    const fn = compile(ce.expr(['Mandelbrot', ['Complex', 'x', 'y'], 256]));
    for (const [x, y] of [
      [0.5, 0.5],
      [-0.75, 0.2],
      [-1.3, 0.1],
      [1, 1],
      // This point reaches the bound of the further iterations.
      [-2.0000000001, 0],
    ]) {
      const direct = ce
        .expr(['Mandelbrot', ['Complex', x, y], 256])
        .evaluate().re;
      expect(fn.run!({ x, y })).toBeCloseTo(direct, 10);
    }
  });
});

const glsl = new GLSLTarget();

describe('FRACTAL GLSL COMPILATION', () => {
  it('compiles Mandelbrot call site', () => {
    const expr = ce.expr(['Mandelbrot', 'c', 100]);
    const result = glsl.compile(expr);
    expect(result.code).toMatchInlineSnapshot(`_fractal_mandelbrot(c, 100)`);
  });

  it('injects Mandelbrot preamble', () => {
    const expr = ce.expr(['Mandelbrot', 'c', 100]);
    const result = glsl.compile(expr);
    expect(result.preamble).toContain('_fractal_mandelbrot');
    expect(result.preamble).toContain('log2(log2(dot(w, w)))');
    expect(result.preamble).toContain('dot(z, z) > 4.0');
  });

  it('compiles Julia call site', () => {
    const expr = ce.expr(['Julia', 'z', 'c', 100]);
    const result = glsl.compile(expr);
    expect(result.code).toMatchInlineSnapshot(`_fractal_julia(z, c, 100)`);
  });

  it('injects Julia preamble', () => {
    const expr = ce.expr(['Julia', 'z', 'c', 100]);
    const result = glsl.compile(expr);
    expect(result.preamble).toContain('_fractal_julia');
  });

  it('preamble contains both functions when both are used', () => {
    const expr = ce.expr([
      'Add',
      ['Mandelbrot', 'c', 50],
      ['Julia', 'z', 'c', 50],
    ]);
    const result = glsl.compile(expr);
    expect(result.preamble).toContain('_fractal_mandelbrot');
    expect(result.preamble).toContain('_fractal_julia');
  });
});

const wgsl = new WGSLTarget();

describe('FRACTAL WGSL COMPILATION', () => {
  it('compiles Mandelbrot call site', () => {
    const expr = ce.expr(['Mandelbrot', 'c', 100]);
    const result = wgsl.compile(expr);
    expect(result.code).toMatchInlineSnapshot(`_fractal_mandelbrot(c, 100)`);
  });

  it('injects Mandelbrot preamble with WGSL syntax', () => {
    const expr = ce.expr(['Mandelbrot', 'c', 100]);
    const result = wgsl.compile(expr);
    expect(result.preamble).toContain('fn _fractal_mandelbrot');
    expect(result.preamble).toContain('vec2f');
    expect(result.preamble).toContain('fn _fractal_smooth');
    expect(result.preamble).toContain('log2(log2(dot(w, w)))');
    expect(result.preamble).toContain('dot(z, z) > 4.0');
  });

  it('compiles Julia call site', () => {
    const expr = ce.expr(['Julia', 'z', 'c', 100]);
    const result = wgsl.compile(expr);
    expect(result.code).toMatchInlineSnapshot(`_fractal_julia(z, c, 100)`);
  });
});

// The point operands of `Mandelbrot` and `Julia` are complex: the signatures
// are `(complex, integer) -> real` and `(complex, complex, integer) -> real`.
// A use of an undeclared symbol in a point position infers it `complex`, so
// the shader reads it as a `vec2` and the host declares it as one. A
// real point is lifted to `vec2(x, 0.0)`: the helpers take a `vec2`, and a
// `float` argument is not valid shader source. Each test builds its own
// engine, because a use changes the type of an undeclared symbol for the
// lifetime of the engine.
describe('FRACTAL POINT OPERANDS ARE COMPLEX', () => {
  it('a real point is valid and evaluates like the same complex point', () => {
    const ce = new ComputeEngine();
    const real = ce.expr(['Mandelbrot', 0.25, 100]);
    expect(real.isValid).toBe(true);
    expect(real.evaluate().re).toBeCloseTo(
      ce.expr(['Mandelbrot', ['Complex', 0.25, 0], 100]).evaluate().re,
      10
    );
    const julia = ce.expr(['Julia', 0, -0.5, 100]);
    expect(julia.isValid).toBe(true);
    expect(julia.evaluate().re).toBeCloseTo(1, 5);
  });

  it('an undeclared point symbol infers complex', () => {
    const ce = new ComputeEngine();
    ce.expr(['Mandelbrot', 'c', 100]);
    ce.expr(['Julia', 'z', 'w', 100]);
    expect(ce.symbol('c').type.toString()).toBe('complex');
    expect(ce.symbol('z').type.toString()).toBe('complex');
    expect(ce.symbol('w').type.toString()).toBe('complex');
  });

  it('GLSL: a point symbol is read as a complex vec2', () => {
    const ce = new ComputeEngine();
    const m = glsl.compile(ce.expr(['Mandelbrot', 'c', 100]));
    expect(m.code).toBe('_fractal_mandelbrot(c, 100)');
    expect(ce.box('c').type.toString()).toBe('complex');
    const j = glsl.compile(ce.expr(['Julia', 'z', 'c', 'n']));
    expect(j.code).toBe('_fractal_julia(z, c, int(n))');
    expect(ce.box('z').type.toString()).toBe('complex');
    expect(ce.box('n').type.toString()).toBe('integer');
  });

  it('WGSL: a point symbol is read as a complex vec2f', () => {
    const ce = new ComputeEngine();
    const m = wgsl.compile(ce.expr(['Mandelbrot', 'c', 100]));
    expect(m.code).toBe('_fractal_mandelbrot(c, 100)');
    expect(ce.box('c').type.toString()).toBe('complex');
    const j = wgsl.compile(ce.expr(['Julia', 'z', 'c', 'n']));
    expect(j.code).toBe('_fractal_julia(z, c, i32(n))');
    expect(ce.box('z').type.toString()).toBe('complex');
    expect(ce.box('n').type.toString()).toBe('integer');
  });

  it('a real point is lifted to a vec2', () => {
    const ce = new ComputeEngine();
    ce.declare('r', 'real');
    const g = glsl.compile(ce.expr(['Mandelbrot', 'r', 100]));
    expect(g.code).toBe('_fractal_mandelbrot(vec2(r, 0.0), 100)');
    expect(glsl.compile(ce.expr(['Mandelbrot', 0.25, 'm'])).code).toBe(
      '_fractal_mandelbrot(vec2(0.25, 0.0), int(m))'
    );
    expect(
      wgsl.compile(ce.expr(['Julia', 'r', ['Complex', 0.2, 0.3], 10])).code
    ).toBe('_fractal_julia(vec2f(r, 0.0), vec2f(0.2, 0.3), 10)');
  });

  it('a point symbol used again as a scalar operand stays complex', () => {
    // `c` is complex, so `c + …` is a complex sum and `Sin(c)` is the complex
    // sine: one `vec2` declaration serves every use.
    for (const [target, expected] of [
      [glsl, 'c + vec2(_fractal_mandelbrot(c, 100), 0.0)'],
      [wgsl, 'c + vec2f(_fractal_mandelbrot(c, 100), 0.0)'],
    ] as const) {
      const ce = new ComputeEngine();
      const r = target.compile(ce.expr(['Add', ['Mandelbrot', 'c', 100], 'c']));
      expect(r.code).toBe(expected);
      expect(ce.box('c').type.toString()).toBe('complex');
      const s = target.compile(
        new ComputeEngine().expr(['Add', ['Mandelbrot', 'u', 50], ['Sin', 'u']])
      );
      expect(s.code).toContain('_gpu_csin(u)');
    }
  });
});
