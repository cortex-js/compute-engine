import { engine as ce } from '../utils';
import { GLSLTarget } from '../../src/compute-engine/compilation/glsl-target';
import { WGSLTarget } from '../../src/compute-engine/compilation/wgsl-target';

describe('FRACTAL FUNCTIONS', () => {
  describe('Mandelbrot JS evaluate', () => {
    it('returns 1 for origin (inside set)', () => {
      const result = ce
        .expr(['Mandelbrot', ['Complex', 0, 0], 100])
        .evaluate();
      expect(result.re).toBeCloseTo(1.0, 5);
    });

    it('returns 1 for c=-0.5 (inside set)', () => {
      const result = ce
        .expr(['Mandelbrot', ['Complex', -0.5, 0], 100])
        .evaluate();
      expect(result.re).toBeCloseTo(1.0, 5);
    });

    it('returns <1 for c=2 (escapes fast)', () => {
      const result = ce
        .expr(['Mandelbrot', ['Complex', 2, 0], 100])
        .evaluate();
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

const glsl = new GLSLTarget();

describe('FRACTAL GLSL COMPILATION', () => {
  it('compiles Mandelbrot call site', () => {
    const expr = ce.expr(['Mandelbrot', 'c', 100]);
    const result = glsl.compile(expr);
    expect(result.code).toMatchInlineSnapshot(
      `_fractal_mandelbrot(c, 100)`
    );
  });

  it('injects Mandelbrot preamble', () => {
    const expr = ce.expr(['Mandelbrot', 'c', 100]);
    const result = glsl.compile(expr);
    expect(result.preamble).toContain('_fractal_mandelbrot');
    expect(result.preamble).toContain('log2(log2(dot(z, z)))');
  });

  it('compiles Julia call site', () => {
    const expr = ce.expr(['Julia', 'z', 'c', 100]);
    const result = glsl.compile(expr);
    expect(result.code).toMatchInlineSnapshot(
      `_fractal_julia(z, c, 100)`
    );
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
    expect(result.code).toMatchInlineSnapshot(
      `_fractal_mandelbrot(c, 100)`
    );
  });

  it('injects Mandelbrot preamble with WGSL syntax', () => {
    const expr = ce.expr(['Mandelbrot', 'c', 100]);
    const result = wgsl.compile(expr);
    expect(result.preamble).toContain('fn _fractal_mandelbrot');
    expect(result.preamble).toContain('vec2f');
  });

  it('compiles Julia call site', () => {
    const expr = ce.expr(['Julia', 'z', 'c', 100]);
    const result = wgsl.compile(expr);
    expect(result.code).toMatchInlineSnapshot(
      `_fractal_julia(z, c, 100)`
    );
  });
});

describe('DOUBLE-SINGLE ARITHMETIC PREAMBLE', () => {
  it('ds preamble contains core functions (GLSL)', () => {
    const { GPU_DS_ARITHMETIC_PREAMBLE_GLSL } = require(
      '../../src/compute-engine/compilation/gpu-target'
    );
    expect(GPU_DS_ARITHMETIC_PREAMBLE_GLSL).toContain('vec2 ds_add(');
    expect(GPU_DS_ARITHMETIC_PREAMBLE_GLSL).toContain('vec2 ds_mul(');
    expect(GPU_DS_ARITHMETIC_PREAMBLE_GLSL).toContain('vec2 ds_sqr(');
    expect(GPU_DS_ARITHMETIC_PREAMBLE_GLSL).toContain('vec2 ds_sub(');
    expect(GPU_DS_ARITHMETIC_PREAMBLE_GLSL).toContain('vec2 ds_split(');
  });

  it('ds preamble contains core functions (WGSL)', () => {
    const { GPU_DS_ARITHMETIC_PREAMBLE_WGSL } = require(
      '../../src/compute-engine/compilation/gpu-target'
    );
    expect(GPU_DS_ARITHMETIC_PREAMBLE_WGSL).toContain('fn ds_add(');
    expect(GPU_DS_ARITHMETIC_PREAMBLE_WGSL).toContain('fn ds_mul(');
    expect(GPU_DS_ARITHMETIC_PREAMBLE_WGSL).toContain('fn ds_sqr(');
  });
});

describe('EMULATED DOUBLE FRACTAL PREAMBLE', () => {
  it('dp preamble contains Mandelbrot and Julia (GLSL)', () => {
    const { GPU_FRACTAL_DP_PREAMBLE_GLSL } = require(
      '../../src/compute-engine/compilation/gpu-target'
    );
    expect(GPU_FRACTAL_DP_PREAMBLE_GLSL).toContain('_fractal_mandelbrot_dp');
    expect(GPU_FRACTAL_DP_PREAMBLE_GLSL).toContain('_fractal_julia_dp');
    expect(GPU_FRACTAL_DP_PREAMBLE_GLSL).toContain('ds_add');
    expect(GPU_FRACTAL_DP_PREAMBLE_GLSL).toContain('ds_mul');
    expect(GPU_FRACTAL_DP_PREAMBLE_GLSL).toContain('ds_sqr');
  });

  it('dp preamble contains Mandelbrot and Julia (WGSL)', () => {
    const { GPU_FRACTAL_DP_PREAMBLE_WGSL } = require(
      '../../src/compute-engine/compilation/gpu-target'
    );
    expect(GPU_FRACTAL_DP_PREAMBLE_WGSL).toContain('fn _fractal_mandelbrot_dp');
    expect(GPU_FRACTAL_DP_PREAMBLE_WGSL).toContain('fn _fractal_julia_dp');
  });
});

describe('FRACTAL PRECISION STRATEGY', () => {
  it('returns no staleWhen without hints', () => {
    const expr = ce.expr(['Mandelbrot', 'c', 100]);
    const result = glsl.compile(expr);
    expect(result.staleWhen).toBeUndefined();
    expect(result.uniforms).toBeUndefined();
    expect(result.textures).toBeUndefined();
  });

  it('selects single-float with no hints', () => {
    const expr = ce.expr(['Mandelbrot', 'c', 100]);
    const result = glsl.compile(expr);
    expect(result.code).toContain('_fractal_mandelbrot(');
    expect(result.code).not.toContain('_fractal_mandelbrot_dp(');
    expect(result.staleWhen).toBeUndefined();
  });

  it('selects single-float for large radius', () => {
    const expr = ce.expr(['Mandelbrot', 'c', 100]);
    const result = glsl.compile(expr, {
      hints: { viewport: { center: [0, 0], radius: 1.0 } },
    });
    expect(result.code).toContain('_fractal_mandelbrot(');
    expect(result.staleWhen).toEqual({ radiusBelow: 1e-6 });
  });

  it('selects emulated double for medium radius', () => {
    const expr = ce.expr(['Mandelbrot', 'c', 100]);
    const result = glsl.compile(expr, {
      hints: { viewport: { center: [0.3, 0.1], radius: 1e-8 } },
    });
    expect(result.code).toContain('_fractal_mandelbrot_dp(');
    expect(result.preamble).toContain('ds_add');
    expect(result.staleWhen).toEqual({
      radiusBelow: 1e-14,
      radiusAbove: 1e-5,
    });
  });

  it('selects emulated double for Julia too', () => {
    const expr = ce.expr(['Julia', 'z', 'c', 100]);
    const result = glsl.compile(expr, {
      hints: { viewport: { center: [0, 0], radius: 1e-10 } },
    });
    expect(result.code).toContain('_fractal_julia_dp(');
  });

  it('selects perturbation for very small radius', () => {
    const expr = ce.expr(['Mandelbrot', 'c', 256]);
    const result = glsl.compile(expr, {
      hints: { viewport: { center: [0.3, 0.1], radius: 1e-16 } },
    });
    expect(result.code).toContain('_fractal_mandelbrot_pt(');
    expect(result.preamble).toContain('_refOrbit');
    expect(result.preamble).toContain('ds_add');
    expect(result.staleWhen).toBeDefined();
    expect(result.staleWhen!.radiusAbove).toBe(1e-5);
    expect(result.staleWhen!.centerDistance).toBeCloseTo(1e-16 * 2.0);
    expect(result.staleWhen!.radiusBelow).toBeCloseTo(1e-16 * 0.01);
  });

  it('perturbation includes orbit texture data', () => {
    const expr = ce.expr(['Mandelbrot', 'c', 50]);
    const result = glsl.compile(expr, {
      hints: { viewport: { center: [-0.5, 0], radius: 1e-16 } },
    });
    expect(result.textures).toBeDefined();
    expect(result.textures!._refOrbit).toBeDefined();
    expect(result.textures!._refOrbit.format).toBe('rg32f');
    expect(result.textures!._refOrbit.data).toBeInstanceOf(Float32Array);
    expect(result.textures!._refOrbit.data.length).toBeGreaterThan(0);
    expect(result.uniforms).toBeDefined();
    expect(result.uniforms!._refOrbitLen).toBeGreaterThan(0);
  });

  it('perturbation for Julia includes orbit data', () => {
    const expr = ce.expr(['Julia', 'z', 'c', 50]);
    const result = glsl.compile(expr, {
      hints: { viewport: { center: [0, 0], radius: 1e-16 } },
    });
    expect(result.code).toContain('_fractal_julia_pt(');
    expect(result.textures).toBeDefined();
    expect(result.textures!._refOrbit).toBeDefined();
  });

  it('non-fractal function ignores hints', () => {
    const expr = ce.expr(['Sin', 'x']);
    const result = glsl.compile(expr, {
      hints: { viewport: { center: [0, 0], radius: 1e-16 } },
    });
    expect(result.staleWhen).toBeUndefined();
    expect(result.textures).toBeUndefined();
    expect(result.code).toBe('sin(x)');
  });
});

describe('FRACTAL WGSL STRATEGY SELECTION', () => {
  it('selects emulated double for medium radius (WGSL)', () => {
    const expr = ce.expr(['Mandelbrot', 'c', 100]);
    const result = wgsl.compile(expr, {
      hints: { viewport: { center: [0, 0], radius: 1e-8 } },
    });
    expect(result.code).toContain('_fractal_mandelbrot_dp(');
    expect(result.preamble).toContain('fn ds_add(');
    expect(result.preamble).toContain('fn _fractal_mandelbrot_dp(');
  });

  it('selects perturbation for small radius (WGSL)', () => {
    const expr = ce.expr(['Mandelbrot', 'c', 100]);
    const result = wgsl.compile(expr, {
      hints: { viewport: { center: [0, 0], radius: 1e-16 } },
    });
    expect(result.code).toContain('_fractal_mandelbrot_pt(');
    expect(result.preamble).toContain('fn _fractal_mandelbrot_pt(');
    expect(result.preamble).toContain('texture_2d');
  });

  it('non-fractal function ignores hints (WGSL)', () => {
    const expr = ce.expr(['Sin', 'x']);
    const result = wgsl.compile(expr, {
      hints: { viewport: { center: [0, 0], radius: 1e-16 } },
    });
    expect(result.staleWhen).toBeUndefined();
    expect(result.textures).toBeUndefined();
    expect(result.code).toBe('sin(x)');
  });
});

describe('PERTURBATION FRACTAL PREAMBLE', () => {
  it('pt preamble contains Mandelbrot and Julia (GLSL)', () => {
    const { GPU_FRACTAL_PT_PREAMBLE_GLSL } = require(
      '../../src/compute-engine/compilation/gpu-target'
    );
    expect(GPU_FRACTAL_PT_PREAMBLE_GLSL).toContain('_fractal_mandelbrot_pt');
    expect(GPU_FRACTAL_PT_PREAMBLE_GLSL).toContain('_fractal_julia_pt');
    expect(GPU_FRACTAL_PT_PREAMBLE_GLSL).toContain('_refOrbit');
    expect(GPU_FRACTAL_PT_PREAMBLE_GLSL).toContain('texelFetch');
  });

  it('pt preamble contains Mandelbrot and Julia (WGSL)', () => {
    const { GPU_FRACTAL_PT_PREAMBLE_WGSL } = require(
      '../../src/compute-engine/compilation/gpu-target'
    );
    expect(GPU_FRACTAL_PT_PREAMBLE_WGSL).toContain('fn _fractal_mandelbrot_pt');
    expect(GPU_FRACTAL_PT_PREAMBLE_WGSL).toContain('fn _fractal_julia_pt');
    expect(GPU_FRACTAL_PT_PREAMBLE_WGSL).toContain('texture_2d');
  });
});

describe('REFERENCE ORBIT COMPUTATION', () => {
  it('computes orbit for origin (all zeros)', () => {
    const { computeReferenceOrbit } = require(
      '../../src/compute-engine/compilation/fractal-orbit'
    );
    // Mandelbrot at c=0: z stays 0 forever
    const orbit = computeReferenceOrbit([0, 0], 10, 50);
    expect(orbit).toBeInstanceOf(Float32Array);
    expect(orbit.length).toBe(20); // 10 points * 2 floats (re, im)
    // All values should be 0
    for (let i = 0; i < orbit.length; i++) {
      expect(orbit[i]).toBeCloseTo(0, 5);
    }
  });

  it('computes orbit for c=-1 (period-2)', () => {
    const { computeReferenceOrbit } = require(
      '../../src/compute-engine/compilation/fractal-orbit'
    );
    const orbit = computeReferenceOrbit([-1, 0], 4, 50);
    // z0=0, z1=-1, z2=0, z3=-1
    expect(orbit[0]).toBeCloseTo(0, 5);   // re0
    expect(orbit[1]).toBeCloseTo(0, 5);   // im0
    expect(orbit[2]).toBeCloseTo(-1, 5);  // re1
    expect(orbit[3]).toBeCloseTo(0, 5);   // im1
    expect(orbit[4]).toBeCloseTo(0, 5);   // re2
    expect(orbit[5]).toBeCloseTo(0, 5);   // im2
    expect(orbit[6]).toBeCloseTo(-1, 5);  // re3
    expect(orbit[7]).toBeCloseTo(0, 5);   // im3
  });

  it('escapes for c=2 (orbit diverges)', () => {
    const { computeReferenceOrbit } = require(
      '../../src/compute-engine/compilation/fractal-orbit'
    );
    const orbit = computeReferenceOrbit([2, 0], 100, 50);
    // Should return fewer than 100 points (escape detected)
    expect(orbit.length).toBeLessThan(200);
    expect(orbit.length).toBeGreaterThan(0);
  });
});
