import { ComputeEngine, compile } from '../../src/compute-engine';
import { BaseCompiler } from '../../src/compute-engine/compilation/base-compiler';
import { GLSLTarget } from '../../src/compute-engine/compilation/glsl-target';
import { WGSLTarget } from '../../src/compute-engine/compilation/wgsl-target';
import type { MathJsonExpression } from '../../src/math-json/types';

const color: MathJsonExpression = ['Hsv', ['Add', 'x', 1], 1, 1];
const converted: MathJsonExpression = ['AsRgb', color];
const source = (r: { code?: string; preamble?: string }) =>
  (r.preamble ?? '') + (r.code ?? '');

function engine() {
  const ce = new ComputeEngine();
  ce.declare('x', 'real');
  ce.declare('maker', { signature: '() -> color' });
  ce.assign('maker', ce.expr(['Function', color]));
  ce.declare('identityColor', { signature: '(color) -> color' });
  ce.assign('identityColor', ce.expr(['Function', 'c', 'c']));
  return ce;
}

describe.each(['glsl', 'wgsl'] as const)('%s color bindings', (to) => {
  const vec = to === 'glsl' ? 'vec3' : 'vec3f';
  const declaration = (name: string) =>
    to === 'glsl' ? `vec3 ${name};` : `var ${name}: vec3f;`;

  test.each([true, false])(
    'local and alias retain color storage (typed=%s)',
    (typed) => {
      const ce = engine();
      const expr = ce.expr([
        'Block',
        typed ? ['Declare', 'c', 'color'] : ['Declare', 'c'],
        ['Assign', 'c', color],
        ['Declare', 'd'],
        ['Assign', 'd', 'c'],
        ['AsRgb', 'd'],
      ]);
      const r = compile(expr, { to, constantFold: false });
      expect(r.success).toBe(true);
      expect(r.code).toContain(declaration('c'));
      expect(r.code).toContain(declaration('d'));
      expect(r.code).toContain('d = c;');
      expect(r.code).toContain('return _gpu_oklch_to_srgb(d);');
    }
  );

  test.each(['initializer', 'assignment'] as const)(
    'converted color %s stores canonical channels',
    (kind) => {
      const ce = engine();
      const bindings: MathJsonExpression[] =
        kind === 'initializer'
          ? [['Declare', 'c', 'color', converted]]
          : [
              ['Declare', 'c', 'color'],
              ['Assign', 'c', color],
              ['Assign', 'c', converted],
            ];
      const expr = ce.expr(['Block', ...bindings, ['AsRgb', 'c']]);
      const r = compile(expr, { to, constantFold: false });
      expect(r.success).toBe(true);
      expect(r.code).toContain(declaration('c'));
      expect(r.code).toContain('c = _gpu_srgb_to_oklch(_gpu_srgb_roundtrip(');
      expect(r.code).toContain('return _gpu_oklch_to_srgb(c);');
      const js = compile(expr);
      expect(js.success).toBe(true);
      expect(js.run!({ x: 119 })).toMatchObject({
        space: 'rgb',
        c0: 0,
        c1: 1,
        c2: 0,
      });
    }
  );

  test('helper return and shared temporary use vector storage', () => {
    const ce = engine();
    const r = compile(ce.expr(['ColorMix', ['maker'], ['maker'], 0.5]), {
      to,
      constantFold: false,
    });
    expect(r.success).toBe(true);
    expect(r.preamble).toContain(
      to === 'glsl' ? 'vec3 _fn_maker()' : 'fn _fn_maker() -> vec3f'
    );
    expect(r.preamble?.match(/_fn_maker\(/g)).toHaveLength(1);
    expect(r.code?.match(/_fn_maker\(/g)).toHaveLength(1);
    expect(r.code).toMatch(
      to === 'glsl'
        ? /vec3 _cse\d+ = _fn_maker\(\)/
        : /let _cse\d+: vec3f = _fn_maker\(\)/
    );
    expect(r.code).not.toContain('_gpu_hsv_to_rgb');
  });

  test('a declared color first assigned inside a loop has vector storage', () => {
    const ce = engine();
    const r = compile(
      ce.expr([
        'Block',
        ['Declare', 'c', 'color'],
        [
          'Loop',
          ['Block', ['Assign', 'c', color]],
          ['Element', 'i', ['Range', 1, 2]],
        ],
        ['AsRgb', 'c'],
      ]),
      { to, constantFold: false }
    );
    expect(r.success).toBe(true);
    expect(r.code).toContain(declaration('c'));
    expect(r.code).toContain('for (');
    expect(r.code).toContain('return _gpu_oklch_to_srgb(c);');
  });

  test('color parameter receives canonical channels and returns a vector', () => {
    const ce = engine();
    const r = compile(ce.expr(['AsRgb', ['identityColor', converted]]), {
      to,
      constantFold: false,
    });
    expect(r.success).toBe(true);
    expect(r.preamble).toContain(
      to === 'glsl'
        ? 'vec3 _fn_identityColor(vec3 c)'
        : 'fn _fn_identityColor(c: vec3f) -> vec3f'
    );
    expect(r.preamble).toContain('return c;');
    expect(r.code).toContain('_fn_identityColor(_gpu_srgb_to_oklch(');
  });

  test('helper returning a converted local keeps its reference and canonical channels', () => {
    const ce = engine();
    ce.declare('localHelper', { signature: '() -> color' });
    ce.assign(
      'localHelper',
      ce.expr([
        'Function',
        ['Block', ['Declare', 'c', 'color'], ['Assign', 'c', converted], 'c'],
      ])
    );
    const r = compile(ce.expr(['AsRgb', ['localHelper']]), {
      to,
      constantFold: false,
    });
    expect(r.success).toBe(true);
    expect(r.preamble).toContain(declaration('c'));
    expect(r.preamble).toContain('c = _gpu_srgb_to_oklch(');
    expect(r.preamble).toContain('return c;');
    expect(r.code).toBe('_gpu_oklch_to_srgb(_fn_localHelper())');
  });

  test('a scalar local frame overrides an ambient color type', () => {
    const ce = engine();
    ce.declare('c', 'color');
    const target = to === 'glsl' ? new GLSLTarget() : new WGSLTarget();
    const r = BaseCompiler.withLocalShapeFrame(
      new Map([['c', false]]),
      new Map([['c', BaseCompiler.LOCAL_SCALAR]]),
      () =>
        target.compileFunction(ce.symbol('c'), 'scalar', 'float', [
          ['c', 'float'],
        ])
    );
    expect(r).toContain(
      to === 'glsl' ? 'float scalar(float c)' : 'fn scalar(c: f32) -> f32'
    );
    expect(r).not.toContain(vec);
  });

  test('colors with alpha still decline instead of losing the fourth channel', () => {
    const ce = engine();
    const r = compile(
      ce.expr([
        'Block',
        ['Declare', 'c', 'color'],
        ['Assign', 'c', ['Rgb', 'x', 0, 0, 0.5]],
        ['AsRgb', 'c'],
      ]),
      { to, constantFold: false }
    );
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/alpha|4th/);
  });
});
