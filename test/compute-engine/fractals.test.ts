import { engine as ce } from '../utils';

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
