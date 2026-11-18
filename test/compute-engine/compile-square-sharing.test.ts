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
  test.each(['interval-js'])(
    '%s shares repeated symbol squares',
    (to) => {
      for (const square of forms) {
        const ce = engine();
        const expr = ce.expr(['Add', ['Sin', square], ['Cos', square]]);
        const options = { to, mode: 'strict' as const, fallback: false };
        const shared = compile(expr, options);
        const inline = compile(expr, { ...options, cse: false });
        if (to !== 'interval-js') {
          expect(shared.code).toMatch(/(?:const|float|let) _cse\d/);
          expect(inline.code).not.toMatch(/_cse\d/);
        }
        if (to === 'javascript' || to === 'interval-js')
          for (const x of [-2, -0, 0.25, 3])
            expect(shared.run!({ x })).toEqual(inline.run!({ x }));
      }
    }
  );

  test.each(['glsl'])(
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
});
