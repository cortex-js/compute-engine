import { engine as ce } from '../utils';
import { GLSLTarget } from '../../src/compute-engine/compilation/glsl-target';
import { WGSLTarget } from '../../src/compute-engine/compilation/wgsl-target';

describe('FRACTAL FUNCTIONS', () => {
  describe('Mandelbrot JS evaluate', () => {
    it('returns 1 for origin (inside set)', () => {
      const result = ce
        .box(['Mandelbrot', ['Complex', 0, 0], 100])
        .evaluate();
      expect(result.re).toBeCloseTo(1.0, 5);
    });

    it('returns 1 for c=-0.5 (inside set)', () => {
      const result = ce
        .box(['Mandelbrot', ['Complex', -0.5, 0], 100])
        .evaluate();
      expect(result.re).toBeCloseTo(1.0, 5);
    });

    it('returns <1 for c=2 (escapes fast)', () => {
      const result = ce
        .box(['Mandelbrot', ['Complex', 2, 0], 100])
        .evaluate();
      expect(result.re).toBeGreaterThanOrEqual(0);
      expect(result.re).toBeLessThan(1);
    });

    it('returns value in [0,1] for c=0.3+0.5i', () => {
      const result = ce
        .box(['Mandelbrot', ['Complex', 0.3, 0.5], 100])
        .evaluate();
      expect(result.re).toBeGreaterThanOrEqual(0);
      expect(result.re).toBeLessThanOrEqual(1);
    });
  });

  describe('Julia JS evaluate', () => {
    it('returns 1 for z=0, c=-0.5 (inside set)', () => {
      const result = ce
        .box(['Julia', ['Complex', 0, 0], ['Complex', -0.5, 0], 100])
        .evaluate();
      expect(result.re).toBeCloseTo(1.0, 5);
    });

    it('returns <1 for z=0, c=2 (escapes fast)', () => {
      const result = ce
        .box(['Julia', ['Complex', 0, 0], ['Complex', 2, 0], 100])
        .evaluate();
      expect(result.re).toBeGreaterThanOrEqual(0);
      expect(result.re).toBeLessThan(1);
    });

    it('returns value in [0,1] for z=0.3+0.5i, c=-0.4+0.6i', () => {
      const result = ce
        .box(['Julia', ['Complex', 0.3, 0.5], ['Complex', -0.4, 0.6], 100])
        .evaluate();
      expect(result.re).toBeGreaterThanOrEqual(0);
      expect(result.re).toBeLessThanOrEqual(1);
    });
  });
});

const glsl = new GLSLTarget();

describe('FRACTAL GLSL COMPILATION', () => {
  it('compiles Mandelbrot call site', () => {
    const expr = ce.box(['Mandelbrot', 'c', 100]);
    const result = glsl.compile(expr);
    expect(result.code).toMatchInlineSnapshot(
      `_fractal_mandelbrot(c, int(100.0))`
    );
  });

  it('injects Mandelbrot preamble', () => {
    const expr = ce.box(['Mandelbrot', 'c', 100]);
    const result = glsl.compile(expr);
    expect(result.preamble).toContain('_fractal_mandelbrot');
    expect(result.preamble).toContain('log2(log2(dot(z, z)))');
  });

  it('compiles Julia call site', () => {
    const expr = ce.box(['Julia', 'z', 'c', 100]);
    const result = glsl.compile(expr);
    expect(result.code).toMatchInlineSnapshot(
      `_fractal_julia(z, c, int(100.0))`
    );
  });

  it('injects Julia preamble', () => {
    const expr = ce.box(['Julia', 'z', 'c', 100]);
    const result = glsl.compile(expr);
    expect(result.preamble).toContain('_fractal_julia');
  });

  it('preamble contains both functions when both are used', () => {
    const expr = ce.box([
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
    const expr = ce.box(['Mandelbrot', 'c', 100]);
    const result = wgsl.compile(expr);
    expect(result.code).toMatchInlineSnapshot(
      `_fractal_mandelbrot(c, i32(100.0))`
    );
  });

  it('injects Mandelbrot preamble with WGSL syntax', () => {
    const expr = ce.box(['Mandelbrot', 'c', 100]);
    const result = wgsl.compile(expr);
    expect(result.preamble).toContain('fn _fractal_mandelbrot');
    expect(result.preamble).toContain('vec2f');
  });

  it('compiles Julia call site', () => {
    const expr = ce.box(['Julia', 'z', 'c', 100]);
    const result = wgsl.compile(expr);
    expect(result.code).toMatchInlineSnapshot(
      `_fractal_julia(z, c, i32(100.0))`
    );
  });
});
