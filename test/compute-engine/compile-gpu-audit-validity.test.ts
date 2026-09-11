import { ComputeEngine, compile } from '../../src/compute-engine';
import type { MathJsonExpression } from '../../src/math-json/types';

const source = (r: { code?: string; preamble?: string }) =>
  (r.preamble ?? '') + (r.code ?? '');

describe.each(['glsl', 'wgsl'] as const)('%s emitted shader validity', (to) => {
  test.each(['Sum', 'Product'])(
    '%s rejects statement bodies and keeps scalar-only blocks',
    (head) => {
      for (const upper of [3, 153, 'N']) {
        for (const cse of [false, true]) {
          for (const body of [
            ['Block', 'j'],
            ['Block', ['Declare', 'a'], ['Assign', 'a', ['Square', 'j']], 'a'],
            ['Return', 'j'],
          ] as MathJsonExpression[]) {
            const ce = new ComputeEngine();
            ce.declare('N', 'real');
            const expr = ce.expr([head, body, ['Limits', 'j', 1, upper]]);
            expect(expr.isValid).toBe(true);
            const r = compile(expr, { to, constantFold: false, cse });
            if (
              Array.isArray(body) &&
              body.length === 2 &&
              body[0] === 'Block'
            ) {
              expect(r.success).toBe(true);
            } else {
              expect(r.success).toBe(false);
              expect(r.error).toMatch(/cannot be used as a sub-expression/);
            }
          }
        }
      }
    }
  );

  test('ordinary and nested loop reductions remain supported', () => {
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    ce.assign(
      'nested',
      ce.expr([
        'Function',
        [
          'Sum',
          ['Sum', ['Multiply', 'j', 'k'], ['Limits', 'k', 1, 't']],
          ['Limits', 'j', 1, 't'],
        ],
        ['Typed', 't', 'real'],
      ])
    );
    const r = compile(ce.expr(['nested', 'x']), { to, constantFold: false });
    expect(r.success).toBe(true);
    expect(source(r).match(/for \(/g)).toHaveLength(2);
    expect(source(r)).not.toMatch(/[+*]=\s*(?:return|float|var)\s/);
    const js = compile(ce.expr(['nested', 'x']));
    expect(js.run!({ x: 3 })).toBe(36);
    expect(js.run!({ x: 0 })).toBe(0);
  });

  test('generated names are legal and remain distinct after normalization', () => {
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    const names = ['a__b', 'a_b', 'α', 'β', 'tail_', 'tail__'];
    names.forEach((name, i) => {
      ce.declare(name, 'function');
      ce.assign(name, ce.expr(['Function', ['Add', 't', i + 1], 't']));
    });
    const expr = ce.expr(['Add', ...names.map((name) => [name, 'x'])]);
    const r = compile(expr, { to, constantFold: false });
    expect(r.success).toBe(true);
    const declarations = [
      ...(r.preamble ?? '').matchAll(
        to === 'glsl' ? /float (_fn_?\w*)\(/g : /fn (_fn_?\w*)\(/g
      ),
    ].map((m) => m[1]);
    expect(declarations).toHaveLength(names.length);
    expect(new Set(declarations).size).toBe(names.length);
    expect(
      declarations.every((name) => !name.includes('__') && !name.includes('$'))
    ).toBe(true);
    for (const name of declarations) expect(r.code).toContain(`${name}(`);
  });

  test('point-specialized helper names contain no reserved underscores', () => {
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    ce.declare('hash', 'function');
    ce.assign(
      'hash',
      ce.expr(['Function', ['Dot', 'p', ['Tuple', 1, 2, 3]], 'p'])
    );
    const r = compile(ce.expr(['hash', ['Tuple', 'x', 2, 3]]), {
      to,
      constantFold: false,
    });
    expect(r.success).toBe(true);
    expect(source(r)).toContain('_fn_hash');
    expect(source(r)).not.toMatch(/\b\w*__\w*\b/);
  });

  test.each(['Hsv', 'AsRgb'])(
    'a visible %s result keeps vector storage through a broadcastable local',
    (head) => {
      const ce = new ComputeEngine();
      ce.declare('x', 'real');
      const color: MathJsonExpression = ['Hsv', 'a', 0.5, 0.7];
      ce.declare('shade', 'function');
      ce.assign(
        'shade',
        ce.expr([
          'Function',
          [
            'Block',
            ['Declare', 'a', 'broadcastable<number>'],
            ['Assign', 'a', 't'],
            head === 'Hsv' ? color : ['AsRgb', color],
          ],
          ['Typed', 't', 'real'],
        ])
      );
      const r = compile(ce.expr(['AsOklab', ['shade', 'x']]), {
        to,
        constantFold: false,
      });
      expect(r.success).toBe(true);
      expect(r.preamble).toContain(
        to === 'glsl' ? 'vec3 _fn_shade(' : 'fn _fn_shade(t: f32) -> vec3f'
      );
      expect(r.code).toContain('_fn_shade(x)');
    }
  );
});
