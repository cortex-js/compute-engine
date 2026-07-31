/**
 * Two more GPU lowering defects of the "invalid or WRONG shader source behind
 * `success: true`" class.
 *
 *  1. A lowering that consumes FEWER OPERANDS than its head accepts. The
 *     worst kind: no shape is wrong, so no shape gate can catch it, and the
 *     emitted shader is perfectly valid source computing a different number.
 *
 *       Round(3.14159, 2)  interpreter → 157/50   (round to 2 decimal places)
 *                          shader      → `(sign(3.14159) * floor(…))` → 3
 *       Gamma(5, 2)        interpreter → 22.736…  (upper incomplete Γ(s, z))
 *                          shader      → `_gpu_gamma(5.0)`            → 24
 *
 *     `Round(x, n)` now lowers correctly for a compile-time integer precision
 *     (`Round(x·10ⁿ)/10ⁿ`, which is what the interpreter, the JavaScript
 *     target and the interval target all compute) and fails closed (D6) for a
 *     runtime one. `Gamma(s, z)` is a different function from `Γ(z)`, with no
 *     shader builtin and no preamble helper, so it fails closed.
 *
 *  2. A WGSL builtin with no ALL-SCALAR overload. GLSL declares its geometric
 *     functions over the genType, which INCLUDES `float`, so
 *     `refract(1.0, 2.0, 0.5)` is valid GLSL; WGSL §17.5 declares
 *     `refract(e1: vecN<T>, e2: vecN<T>, e3: T)` and nothing else. The gate
 *     never saw it, because a call whose operands are ALL scalars returns
 *     early. `GPUShapeRules.vectorOnlySlots` is that obligation, the mirror of
 *     `mandatoryScalarSlots`.
 */

import { ComputeEngine } from '../../src/compute-engine';
import { GLSLTarget } from '../../src/compute-engine/compilation/glsl-target';
import { WGSLTarget } from '../../src/compute-engine/compilation/wgsl-target';

const ce = new ComputeEngine();
const glsl = new GLSLTarget();
const wgsl = new WGSLTarget();

const g = (expr: any, engine = ce): string =>
  glsl.compile(engine.box(expr)).code!;
const w = (expr: any, engine = ce): string =>
  wgsl.compile(engine.box(expr)).code!;

const V3 = ['List', 1, 2, 3];
const W3 = ['List', 4, 5, 6];
const U3 = ['List', 7, 8, 9];

/** An engine with a declared INTEGER symbol — a runtime rounding precision. */
const cen = new ComputeEngine();
cen.declare('n', 'integer');
cen.declare('x', 'finite_real');
cen.declare('k', 'integer');

/** Evaluate emitted shader source as f64 arithmetic. The four builtins the
 *  `Round` lowering uses have exact `Math` counterparts. */
function evalShader(code: string): number {
  const js = code.replace(/\b(sign|floor|abs)\(/g, 'Math.$1(');
  // eslint-disable-next-line no-new-func
  return Function(`"use strict"; return (${js});`)() as number;
}

describe('GPU ARITY — `Round(x, n)` rounds to `n` decimal places', () => {
  it('lowers the two-operand form to a value matching the interpreter', () => {
    const code = g(['Round', 3.14159, 2]);
    expect(code).toBe(
      '((sign((3.14159 * 100.0)) * floor(abs((3.14159 * 100.0)) + 0.5)) / 100.0)'
    );
    // The emitted source, EVALUATED — not merely inspected. Before the fix it
    // computed 3, where the interpreter answers 157/50.
    expect(evalShader(code)).toBeCloseTo(
      ce.box(['Round', 3.14159, 2]).N().re,
      12
    );
    expect(evalShader(code)).not.toBe(3);
    expect(w(['Round', 3.14159, 2])).toBe(code);
  });

  it('matches the interpreter on the half-away-from-zero ties and on `n < 0`', () => {
    for (const [x, n] of [
      [-2.5, 0],
      [2.5, 0],
      [0.125, 2],
      [-0.125, 2],
      [-3.14159, 2],
      [1234.5678, -2],
      [12345, -3],
    ] as const)
      expect(evalShader(g(['Round', x, n]))).toBeCloseTo(
        ce.box(['Round', x, n]).N().re,
        9
      );
  });

  it('the unary form is unchanged', () => {
    expect(g(['Round', 3.14159])).toBe(
      '(sign(3.14159) * floor(abs(3.14159) + 0.5))'
    );
    expect(w(['Round', 'x'], cen)).toBe('(sign(x) * floor(abs(x) + 0.5))');
    // An integer-valued operand still short-circuits.
    expect(g(['Round', ['Multiply', 2, 'k']], cen)).toBe('2.0 * k');
  });

  it('an integer-valued operand short-circuits only for `n >= 0`', () => {
    expect(g(['Round', ['Multiply', 2, 'k'], 2], cen)).toBe('2.0 * k');
    expect(g(['Round', ['Multiply', 2, 'k'], -2], cen)).toContain('* 0.01');
  });

  it('a RUNTIME precision fails closed (D6)', () => {
    // A shader `pow(10.0, n)` is `exp2(n·log2(10.0))`, not exactly a power of
    // ten, so it moves the tie boundary of the rounding it is scaling for.
    for (const emit of [g, w])
      expect(() => emit(['Round', 'x', 'n'], cen)).toThrow(
        /^Round: rounding to `n` decimal places compiles on the \w+ target only for a compile-time INTEGER precision .* Fail closed \(D6\)\.$/s
      );
  });

  it('a factor outside the shader float range fails closed (D6)', () => {
    for (const emit of [g, w]) {
      expect(() => emit(['Round', 3.14, 40])).toThrow(
        /^Round: the rounding factor 10\^40 is outside the shader float range\. Fail closed \(D6\)\.$/
      );
      expect(() => emit(['Round', 3.14, -40])).toThrow(
        /rounding factor 10\^-40 is outside/
      );
    }
    // The largest representable factors still compile.
    expect(g(['Round', 3.14, 37])).toContain('1e+37');
  });

  it('reports `success: false` (no source) through the fallback route', () => {
    for (const target of [glsl, wgsl]) {
      const r = target.compile(cen.box(['Round', 'x', 'n'] as any), {
        fallback: true,
      });
      expect(r.success).toBe(false);
      expect(r.code ?? '').toBe('');
    }
  });
});

describe('GPU ARITY — `Gamma(s, z)` is the upper INCOMPLETE gamma', () => {
  it('the two-operand form fails closed (D6)', () => {
    // Γ(5, 2) = 22.736…, Γ(5) = 24 — a different function, not a variant.
    expect(ce.box(['Gamma', 5, 2]).N().re).toBeCloseTo(22.73632758375093, 9);
    expect(ce.box(['Gamma', 5]).N().re).toBe(24);
    for (const emit of [g, w])
      expect(() => emit(['Gamma', 5, 2])).toThrow(
        /^Gamma: the two-operand form is the upper incomplete gamma .* Fail closed \(D6\)\.$/s
      );
  });

  it('the one-operand complete Γ is unchanged', () => {
    expect(g(['Gamma', 5])).toBe('_gpu_gamma(5.0)');
    expect(w(['Gamma', 'x'], cen)).toBe('_gpu_gamma(x)');
  });
});

describe('GPU SHAPE GATE — WGSL builtins with no ALL-SCALAR overload', () => {
  let warn: jest.SpyInstance;
  beforeAll(() => {
    warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterAll(() => warn.mockRestore());

  it('`refract(1.0, 2.0, 0.5)` is valid GLSL and not valid WGSL', () => {
    // GLSL ES 3.00 §8.4: `genType refract(genType I, genType N, float eta)`,
    // and the genType includes `float`. WGSL §17.5: `refract(e1: vecN<T>,
    // e2: vecN<T>, e3: T)` — no all-scalar form at all.
    expect(g(['Refract', 1, 2, 0.5])).toBe('refract(1.0, 2.0, 0.5)');
    expect(() => w(['Refract', 1, 2, 0.5])).toThrow(
      /^Refract: the shader builtin `refract` is declared over the `vecN` genType in arguments 1 and 2 in this language — it has no scalar overload there — but argument 1 lowers to a scalar.* Fail closed \(D6\)\.$/s
    );
  });

  it('the same split for `normalize` and `reflect`', () => {
    expect(g(['Normalize', 2])).toBe('normalize(2.0)');
    expect(() => w(['Normalize', 2])).toThrow(
      /`normalize` is declared over the `vecN` genType in argument 1/
    );
    expect(g(['Reflect', 1, 2])).toBe('reflect(1.0, 2.0)');
    expect(() => w(['Reflect', 1, 2])).toThrow(
      /`reflect` is declared over the `vecN` genType in arguments 1 and 2/
    );
  });

  it('the valid vector forms still compile in BOTH languages', () => {
    expect(g(['Refract', V3, W3, 0.5])).toBe(
      'refract(vec3(1.0, 2.0, 3.0), vec3(4.0, 5.0, 6.0), 0.5)'
    );
    expect(w(['Refract', V3, W3, 0.5])).toBe(
      'refract(vec3f(1.0, 2.0, 3.0), vec3f(4.0, 5.0, 6.0), 0.5)'
    );
    expect(w(['Normalize', V3])).toBe('normalize(vec3f(1.0, 2.0, 3.0))');
    expect(w(['Reflect', V3, W3])).toBe(
      'reflect(vec3f(1.0, 2.0, 3.0), vec3f(4.0, 5.0, 6.0))'
    );
    expect(w(['Dot', V3, W3])).toBe(
      'dot(vec3f(1.0, 2.0, 3.0), vec3f(4.0, 5.0, 6.0))'
    );
    expect(w(['Cross', V3, W3])).toBe(
      'cross(vec3f(1.0, 2.0, 3.0), vec3f(4.0, 5.0, 6.0))'
    );
    // A DECLARED vector symbol has no constructor in its source; the operand
    // SHAPE is what places it, so this stays valid too.
    const cev = new ComputeEngine();
    cev.declare('v', 'vector<real^3>');
    cev.declare('u', 'vector<real^3>');
    expect(w(['Refract', 'v', 'u', 0.5], cev)).toBe('refract(v, u, 0.5)');
  });

  it('the existing obligations keep their (more specific) verdicts', () => {
    // Nothing above changes what a MIXED scalar/vector call reports: the
    // permission and mandatory-scalar checks still name the more specific
    // fault, in both languages.
    for (const emit of [g, w]) {
      expect(() => emit(['Refract', V3, W3, U3])).toThrow(
        /requires a SCALAR in argument 3/
      );
      expect(() => emit(['Refract', 0.5, V3, W3])).toThrow(
        /takes a scalar only in argument 3, but here the scalar stands in argument 1/
      );
    }
  });

  it('a scalar `length`/`distance` is untouched — both languages declare one', () => {
    // WGSL §17.5 gives `length(e: T)` and `distance(e1: T, e2: T)` alongside
    // the `vecN` forms, so they are deliberately absent from the table.
    expect(w(['Norm', 3])).toBe('length(3.0)');
    expect(g(['Norm', 3])).toBe('length(3.0)');
  });

  it('reports `success: false` (no source) through the fallback route', () => {
    const r = wgsl.compile(ce.box(['Refract', 1, 2, 0.5] as any), {
      fallback: true,
    });
    expect(r.success).toBe(false);
    expect(r.code ?? '').toBe('');
  });
});
