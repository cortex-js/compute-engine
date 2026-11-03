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
import { compile } from '../../src/compute-engine/compilation/compile-expression';

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
      ).toBe('(NaN, NaN)');
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

// `First`, `Second`, `Third` and `Last` read one element at a fixed position,
// as `At` with a constant index does. A declared list of points is an array
// of vectors in a shader (`vec2[3]`, `array<vec2f, 3>`), so its element is a
// subscript. A swizzle (`P.x`) reads the array as one vector, which is not a
// valid shader. A position past the end is an absent point (`Missing` in the
// interpreter), a vector of NaN components in a shader.
describe('GPU: First, Second, Third and Last of a list of points', () => {
  const compileTo = (to: 'glsl' | 'wgsl', json: unknown) =>
    compile(ce.box(json as any), { to, fallback: false });

  for (const to of ['glsl', 'wgsl'] as const)
    test(`a declared list of 3 points (${to})`, () => {
      const r = compileTo(to, ['First', 'P']);
      expect(r.code).toBe('P[0]');
      expect(r.freeSymbolTypes?.P?.lowered).toBe(
        to === 'glsl' ? 'vec2[3]' : 'array<vec2f, 3>'
      );
      expect(compileTo(to, ['Second', 'P']).code).toBe('P[1]');
      expect(compileTo(to, ['Third', 'P']).code).toBe('P[2]');
      expect(compileTo(to, ['Last', 'P']).code).toBe('P[2]');
      // The element is a point: a sum with a point is a vector sum.
      expect(compileTo(to, ['Add', ['First', 'P'], ['Tuple', 1, 2]]).code).toBe(
        to === 'glsl' ? 'P[0] + vec2(1.0, 2.0)' : 'P[0] + vec2f(1.0, 2.0)'
      );
    });

  test('the interpreter reads the same elements', () => {
    const points = ['List', ['Tuple', 1, 2], ['Tuple', 3, 4]];
    expect(ce.box(['First', points] as any).evaluate().toString()).toBe(
      '(1, 2)'
    );
    expect(ce.box(['Last', points] as any).evaluate().toString()).toBe(
      '(3, 4)'
    );
    // A point position past the end is the NaN point.
    expect(ce.box(['Third', points] as any).evaluate().toString()).toBe(
      '(NaN, NaN)'
    );
  });

  test('a position past the end is an absent point', () => {
    ce.declare('Q', 'list<tuple<real, real, real>^2>');
    expect(compileTo('glsl', ['Last', 'Q']).code).toBe('Q[1]');
    expect(compileTo('glsl', ['Third', 'Q']).code).toBe('vec3(_gpu_nan())');
    expect(compileTo('wgsl', ['Third', 'Q']).code).toBe('vec3f(_gpu_nan())');
  });

  test('a literal list of points selects the element', () => {
    expect(compileTo('glsl', ['Second', PL]).code).toBe('vec2(2.0, 5.0)');
    expect(compileTo('wgsl', ['Last', PL]).code).toBe('vec2f(3.0, 6.0)');
  });
});

// The same rule applies to the other operands that a shader holds as an
// array, and to a point read past its last component.
describe('GPU: First, Second, Third and Last of other operands', () => {
  const code = (to: 'glsl' | 'wgsl', json: unknown) =>
    compile(ce.box(json as any), { to, fallback: false }).code;

  test('a list of 7 numbers is an array', () => {
    ce.declare('L7', 'list<real^7>');
    for (const to of ['glsl', 'wgsl'] as const) {
      expect(code(to, ['First', 'L7'])).toBe('L7[0]');
      expect(code(to, ['Last', 'L7'])).toBe('L7[6]');
    }
  });

  test('a vector keeps the swizzle', () => {
    for (const to of ['glsl', 'wgsl'] as const) {
      expect(code(to, ['First', 'xs'])).toBe('xs.x');
      expect(code(to, ['Last', 'ys'])).toBe('ys.w');
    }
  });

  test('a component past the end of a point is NaN', () => {
    // A `vec2` has no `.z`. The interpreter gives `NaN` for the third
    // element of a pair of numbers.
    ce.declare('p', 'tuple<real, real>');
    expect(ce.box(['Third', ['Tuple', 1, 2]]).evaluate().isNaN).toBe(true);
    expect(code('glsl', ['Third', 'p'])).toBe('_gpu_nan()');
    expect(code('wgsl', ['Third', 'p'])).toBe('_gpu_nan()');
  });

  test('a matrix declines', () => {
    // A `mat2` is indexed by column in a shader, and `First` of a matrix
    // is its first row, so the compile declines.
    ce.declare('M', 'matrix<real^2x2>');
    for (const to of ['glsl', 'wgsl'] as const)
      expect(() => code(to, ['First', 'M'])).toThrow(
        /Could not compile `First` \(read as `At` with the index 1\): .*multi-axis/
      );
  });

  test('a list of strings declines', () => {
    // A shader has no text type, and a list of unknown length has no
    // shader value.
    ce.declare('Ls', 'list<string>');
    ce.declare('Ls3', 'list<string^3>');
    for (const to of ['glsl', 'wgsl'] as const) {
      expect(() => code(to, ['First', 'Ls'])).toThrow(
        /Could not compile `First` \(read as `At` with the index 1\): the base \(type `list<string>`\) has no statically known length/
      );
      expect(() => code(to, ['First', 'Ls3'])).toThrow(
        /Could not compile `First` \(read as `At` with the index 1\): the base's element type `string` is not a REAL scalar/
      );
    }
  });

  // `At(P, k)` with an integer input `k` can be past the end of `P`; its
  // type is `tuple<real, real>`, the absence marker implicit. Its shader
  // value is a `vec2` (a vector of NaN for an absent point), and an element
  // of an absent point is NaN in the interpreter, so the element is a
  // swizzle.
  test('a conditional point with no absent arm is read with a swizzle', () => {
    // A restriction, `If` with no else branch and `Which` give a vector of NaN
    // when the point is absent, and the interpreter gives NaN.
    for (const to of ['glsl', 'wgsl'] as const) {
      expect(
        code(to, ['First', ['If', ['Less', 0, 'x'], ['Tuple', 'x', 2]]])
      ).toMatch(/\)\.x$/);
      expect(
        code(to, ['Second', ['If', ['Less', 0, 'x'], ['Tuple', 'x', 2]]])
      ).toMatch(/\)\.y$/);
    }
  });

  test('only an At call and a boolean-tuple symbol take the swizzle', () => {
    // A constructed boolean tuple is emitted as a float vector: it goes to
    // `At`, which declines. (A declared type cannot name `missing`, so no
    // free symbol is a point that can be absent.)
    ce.declare('Bq', 'boolean');
    ce.declare('Cq', 'boolean');
    for (const to of ['glsl', 'wgsl'] as const) {
      expect(() =>
        code(to, ['Not', ['First', ['Tuple', 'Bq', 'Cq']]])
      ).toThrow(/Could not compile `First`/);
    }
  });

  test('an element of a point that can be absent is a swizzle', () => {
    ce.declare('P3', 'list<tuple<real, real, real>^3>');
    // The absence marker of an accessor is implicit in its type.
    expect(ce.box(['At', 'P', 'k']).type.toString()).toBe('tuple<real, real>');
    expect(ce.box(['First', ['At', 'P', 'k']]).type.toString()).toBe('real');
    for (const to of ['glsl', 'wgsl'] as const) {
      expect(code(to, ['First', ['At', 'P', 'k']])).toBe(
        '(_gpu_atp2_3(P, k)).x'
      );
      expect(code(to, ['Second', ['At', 'P', 'k']])).toBe(
        '(_gpu_atp2_3(P, k)).y'
      );
      expect(code(to, ['Last', ['At', 'P', 'k']])).toBe(
        '(_gpu_atp2_3(P, k)).y'
      );
      expect(code(to, ['Third', ['At', 'P3', 'k']])).toBe(
        '(_gpu_atp3_3(P3, k)).z'
      );
      expect(code(to, ['Last', ['At', 'P3', 'k']])).toBe(
        '(_gpu_atp3_3(P3, k)).z'
      );
      // A 2-D point has no third component: the read is proved to find
      // nothing, typed `nan`, and compiles to NaN, as the interpreter gives.
      expect(code(to, ['Third', ['At', 'P', 'k']])).toContain('_gpu_nan()');
    }
    // The interpreter: an element of an absent point is NaN.
    expect(
      ce
        .box(['First', ['At', ['List', ['Tuple', 1, 2]], 5]])
        .evaluate().isNaN
    ).toBe(true);
  });

  test('a boolean vector declared by the caller is read with a swizzle', () => {
    // A list of 3 booleans that the caller declares as a `bvec3` uniform.
    ce.declare('B3', 'list<boolean^3>');
    const shader = new GLSLTarget().compileShader({
      type: 'fragment',
      uniforms: [{ name: 'B3', type: 'bvec3' }],
      outputs: [{ name: 'o', type: 'float' }],
      body: [
        { variable: 'o', expression: ce.box(['If', ['First', 'B3'], 1, 0]) },
      ],
    });
    expect(shader).toContain('o = float(B3.x);');
  });
});

// The interpreter evaluates every element of the operand, so each random
// draw in it happens. A compiled element read must keep each draw once, or
// decline: a draw that is left out changes the random stream of the shader.
// Only GLSL is tested: WGSL has no form of a draw outside `WithRandomSeed`.
describe('GPU: First, Second, Third and Last of an operand with a draw', () => {
  const draws = (s: string) => s.split('_gpu_rnd_draw(').length - 1;
  const R = ['Random'];
  const code = (to: 'glsl', json: unknown) =>
    compile(ce.box(json as any), { to, fallback: false }).code!;

  for (const to of ['glsl'] as const)
    test(`each draw is kept once, or the compile declines (${to})`, () => {
      // The selected element is the draw: the other elements are pure.
      expect(draws(code(to, ['Second', ['Tuple', 'x', R]]))).toBe(1);
      expect(draws(code(to, ['First', ['List', R, 2, 3]]))).toBe(1);
      // A draw that is not selected would be left out, so these decline.
      expect(() => code(to, ['First', ['Tuple', 'x', R]])).toThrow(
        /Could not compile `First`.*impure/
      );
      expect(() => code(to, ['Last', ['List', R, 2]])).toThrow(
        /Could not compile `Last`/
      );
      // A compound vector keeps its draw: the element is a swizzle of it.
      const sum = code(to, ['First', ['Add', ['Tuple', 'x', 'y'], ['Tuple', R, 1]]]);
      expect(draws(sum)).toBe(1);
      expect(sum).toMatch(/\)\.x$/);
      // A position past the end of a vector with a draw would drop the draw.
      expect(() =>
        code(to, ['Third', ['Multiply', R, ['Tuple', 'x', 'y']]])
      ).toThrow(/Could not compile `Third`/);
      // A list of points with a draw reads its element with the guarded
      // helper, which evaluates the whole list once.
      const points = ['List', ['Tuple', R, 2], ['Tuple', 'x', 4]];
      const third = code(to, ['Third', points]);
      expect(third).toMatch(/^_gpu_atp2_2\(/);
      expect(draws(third)).toBe(1);
    });
});
