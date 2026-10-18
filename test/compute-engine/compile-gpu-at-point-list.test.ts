/**
 * `At` over a list of points on the shader targets (GLSL and WGSL).
 *
 * The result of `At` on a list of points is a point, a `vecM` in a shader.
 * An index of `0`, out of range or not an integer gives an absent point in
 * the interpreter (`Missing`), and a vector of `NaN` components in a shader,
 * which is how the shader targets write an absent number. A dynamic index is
 * one call of the guarded helper `_gpu_atpM_N(points, i)`, whose index guard
 * is the one of `_gpu_atN`.
 */
import { ComputeEngine } from '../../src/compute-engine';
import { GLSLTarget } from '../../src/compute-engine/compilation/glsl-target';
import { WGSLTarget } from '../../src/compute-engine/compilation/wgsl-target';

const ce = new ComputeEngine();
ce.declare('k', 'integer');
ce.declare('x', 'real');
ce.declare('xs', 'list<real^3>');
ce.declare('ys', 'list<real^4>');
ce.declare('P', 'list<tuple<real, real>^3>');

const glsl = new GLSLTarget();
const wgsl = new WGSLTarget();

const PL = ['PointList', ['List', 'x', 2, 3], ['List', 4, 5, 6]];
const GUARD = '!(i >= -3.0 && i <= 3.0) || i != floor(i) || i == 0.0';

describe('GPU: At over a list of points', () => {
  test('the reported shape compiles with a dynamic index', () => {
    const json = ['At', PL, 'k'];
    const g = glsl.compile(ce.box(json as any));
    expect(g.code).toBe(
      '_gpu_atp2_3(vec2[3](vec2(x, 4.0), vec2(2.0, 5.0), vec2(3.0, 6.0)), k)'
    );
    expect(g.preamble).toContain('vec2 _gpu_atp2_3(vec2 v[3], float i) {');
    expect(g.preamble).toContain(`  if (${GUARD})\n    return vec2(_gpu_nan());`);
    expect(g.preamble).toContain('  return v[(k > 0) ? k - 1 : 3 + k];');
    // The NaN helper is declared before the helper that calls it.
    expect(g.preamble!.indexOf('float _gpu_nan()')).toBeLessThan(
      g.preamble!.indexOf('_gpu_atp2_3')
    );

    const w = wgsl.compile(ce.box(json as any));
    expect(w.code).toBe(
      '_gpu_atp2_3(array<vec2f, 3>(vec2f(x, 4.0), vec2f(2.0, 5.0), vec2f(3.0, 6.0)), k)'
    );
    expect(w.preamble).toContain(
      'fn _gpu_atp2_3(v: array<vec2f, 3>, i: f32) -> vec2f {'
    );
    expect(w.preamble).toContain(
      `  if (${GUARD}) {\n    return vec2f(_gpu_nan());\n  }`
    );
    expect(w.preamble).toContain('  var a = v;\n  return a[select(3 + k, k - 1, k > 0)];');
    expect(w.preamble).toContain('fn _gpu_nan() -> f32');
  });

  test('a literal index folds to the point, or to a vector of NaN', () => {
    for (const k of [1, 2, 3, -1, -3]) {
      const point = ce
        .box(['At', PL, k] as any)
        .subs({ x: 1 })
        .evaluate();
      const [a, b] = point.ops!.map((op) => op.re);
      const code = glsl.compile(ce.box(['At', PL, k] as any)).code;
      expect(code).toBe(
        k === 1 || k === -3
          ? 'vec2(x, 4.0)'
          : `vec2(${a.toFixed(1)}, ${b.toFixed(1)})`
      );
    }
    for (const k of [0, 4, -4]) {
      expect(
        ce
          .box(['At', PL, k] as any)
          .evaluate()
          .toString()
      ).toBe('"Missing"');
      expect(glsl.compile(ce.box(['At', PL, k] as any)).code).toBe(
        'vec2(_gpu_nan())'
      );
      expect(wgsl.compile(ce.box(['At', PL, k] as any)).code).toBe(
        'vec2f(_gpu_nan())'
      );
    }
  });

  test('the absence marker as the index is a vector of NaN', () => {
    expect(glsl.compile(ce.box(['At', PL, 'Missing'] as any)).code).toBe(
      'vec2(_gpu_nan())'
    );
  });

  test('symbol sources zip to the shortest, and a scalar is repeated', () => {
    expect(glsl.compile(ce.box(['At', ['PointList', 'xs', 'ys'], 'k'])).code).toBe(
      '_gpu_atp2_3(vec2[3](vec2(xs.x, ys.x), vec2(xs.y, ys.y), vec2(xs.z, ys.z)), k)'
    );
    expect(glsl.compile(ce.box(['At', ['PointList', 'xs', 7], 'k'])).code).toBe(
      '_gpu_atp2_3(vec2[3](vec2(xs.x, 7.0), vec2(xs.y, 7.0), vec2(xs.z, 7.0)), k)'
    );
  });

  test('three coordinates, a literal list of points and a declared symbol', () => {
    expect(
      glsl.compile(
        ce.box([
          'At',
          ['PointList', ['List', 'x', 2, 3], ['List', 4, 5, 6], ['List', 7, 8, 9]],
          'k',
        ])
      ).code
    ).toBe(
      '_gpu_atp3_3(vec3[3](vec3(x, 4.0, 7.0), vec3(2.0, 5.0, 8.0), vec3(3.0, 6.0, 9.0)), k)'
    );
    expect(
      glsl.compile(
        ce.box([
          'At',
          ['List', ['Tuple', 'x', 4], ['Tuple', 2, 5], ['Tuple', 3, 6]],
          'k',
        ])
      ).code
    ).toBe(
      '_gpu_atp2_3(vec2[3](vec2(x, 4.0), vec2(2.0, 5.0), vec2(3.0, 6.0)), k)'
    );
    expect(glsl.compile(ce.box(['At', 'P', 'k'])).code).toBe(
      '_gpu_atp2_3(P, k)'
    );
    expect(glsl.compile(ce.box(['At', 'P', 2])).code).toBe('P[1]');
  });

  test('a coordinate of the point', () => {
    expect(glsl.compile(ce.box(['PointX', ['At', PL, 'k']] as any)).code).toBe(
      '_gpu_atp2_3(vec2[3](vec2(x, 4.0), vec2(2.0, 5.0), vec2(3.0, 6.0)), k).x'
    );
  });

  test('a gather of points declines', () => {
    // The result is a list of points that may be absent, which has no
    // shader value.
    expect(() =>
      glsl.compile(ce.box(['At', PL, ['List', 1, 2]] as any))
    ).toThrow(/Could not compile/);
  });
});
