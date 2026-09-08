import { ComputeEngine, compile } from '../../src/compute-engine';

function engine() {
  const ce = new ComputeEngine();
  ce.declare('x', 'real');
  ce.declare('y', 'real');
  return ce;
}

const forms = [
  ['Square', 'x'],
  ['Power', 'x', 2],
  ['Multiply', 'x', 'x'],
];

describe('small powers and conditional CSE', () => {
  test.each(['javascript', 'glsl', 'wgsl', 'interval-js'])(
    '%s shares repeated symbol squares',
    (to) => {
      for (const square of forms) {
        const ce = engine();
        const expr = ce.expr(['Add', ['Sin', square], ['Cos', square]]);
        const options = { to, mode: 'strict' as const, fallback: false };
        const shared = compile(expr, options);
        const inline = compile(expr, { ...options, cse: false });
        expect(shared.code).toMatch(/(?:const|float|let) _cse\d/);
        expect(inline.code).not.toMatch(/_cse\d/);
        if (to === 'javascript' || to === 'interval-js')
          for (const x of [-2, -0, 0.25, 3])
            expect(shared.run!({ x })).toEqual(inline.run!({ x }));
      }
    }
  );

  test('caller mappings and impure bases retain evaluation count', () => {
    const ce = engine();
    let calls = 0;
    const square = ['Square', ['Random']];
    const expr = ce.expr(['Add', ['Sin', square], ['Cos', square]]);
    const mapped = compile(expr, {
      mode: 'strict',
      functions: { Random: '(() => ++_.calls)' },
    });
    expect(mapped.code).not.toMatch(/_cse\d/);
    const state = { calls: 0 };
    expect(mapped.run!(state)).toBe(Math.sin(1) + Math.cos(4));
    expect(state.calls).toBe(2);
    for (const head of ['Square', 'Power']) {
      calls = 0;
      const r = compile(
        ce.expr(head === 'Square' ? [head, 'x'] : [head, 'x', 2]),
        {
          vars: { x: '_.draw()' },
          mode: 'strict',
        }
      );
      expect(r.code).toBe('_SYS.pow2(_.draw())');
      expect(r.run!({ draw: () => ++calls } as any)).toBe(1);
      expect(calls).toBe(1);
    }
  });

  test('compound squares preserve exceptional numeric values', () => {
    const ce = engine();
    for (const head of ['Square', 'Power']) {
      const base = ['Sin', 'x'];
      const r = compile(
        ce.expr(head === 'Square' ? [head, base] : [head, base, 2]),
        {
          mode: 'strict',
        }
      );
      expect(r.code).toBe('_SYS.pow2(Math.sin(_.x))');
      for (const x of [
        -Infinity,
        -3,
        -0,
        0,
        Number.MIN_VALUE,
        4,
        Infinity,
        NaN,
      ])
        expect(r.run!({ x })).toBe(Math.pow(Math.sin(x), 2));
    }
  });

  test.each(['glsl', 'wgsl'])(
    '%s reuses outer bindings inside conditional operands',
    (to) => {
      const ce = engine();
      const value = ['Floor', ['Multiply', 3, 'x']];
      const condition = ['Greater', 'y', 0];
      for (const branch of [
        ['If', condition, value, 0],
        ['When', value, condition],
        ['Which', condition, value, 'True', 0],
        ['Which', condition, 0, ['Greater', value, 0], value, 'True', 0],
      ]) {
        const expr = ce.expr(['List', ['Sin', value], ['Cos', value], branch]);
        const result = compile(expr, { to, fallback: false });
        expect(result.code?.match(/floor\(/g)).toHaveLength(1);
        expect(
          compile(expr, { to, cse: false }).code?.match(/floor\(/g)!.length
        ).toBeGreaterThan(1);
      }
    }
  );

  test.each(['glsl', 'wgsl'])(
    '%s does not hoist new work from conditional arms',
    (to) => {
      const ce = engine();
      const square = ['Square', 'x'];
      const result = compile(
        ce.expr([
          'If',
          ['Greater', 'y', 0],
          ['Add', ['Sin', square], ['Cos', square]],
          0,
        ]),
        { to, fallback: false }
      );
      expect(result.code).not.toMatch(/_cse\d/);
    }
  );

  test.each(['real<0..>', 'real<0<..>', 'real<1..>'])(
    'declared %s retains scalar shape and the real radical path',
    (type) => {
      const ce = new ComputeEngine();
      ce.declare('x', type);
      const result = compile(ce.expr(['Sqrt', 'x']), { fallback: false });
      expect(result.code).toBe('Math.sqrt(_.x)');
      expect(result.promoted).not.toBe(true);
      expect(result.run!({ x: 4 })).toBe(2);
    }
  );
});
