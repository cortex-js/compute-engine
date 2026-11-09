import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import type { MathJsonExpression } from '../../src/math-json/types';

/**
 * The canonical form of `D(x ↦ sin(n·x), x)` is `D(sin(n·x), x)`: the
 * derivative of the body, a number, not a function. An `Apply` of it was
 * compiled as the call `(_.n * Math.cos(_.n * _.x))(1)`, which throws
 * "is not a function" when it runs. The interpreter reads such a callee as a
 * function of its free variables, which compiled code does not do, so the
 * application declines on every target, and the fallback runs the
 * interpreter.
 */
const WITNESS: MathJsonExpression = [
  'Apply',
  ['D', ['Function', ['Sin', ['Multiply', 'n', 'x']], 'x'], 'x'],
  1,
];

describe('an Apply whose callee is not a function value declines', () => {
  test.each(['javascript', 'python', 'interval-js', 'glsl'])(
    'the witness on %s',
    (to) => {
      const ce = new ComputeEngine();
      const r = compile(ce.box(WITNESS), { to } as never);
      expect(r.success).toBe(false);
    }
  );

  test('the JavaScript reason names the type of the callee', () => {
    const ce = new ComputeEngine();
    const r = compile(ce.box(WITNESS));
    expect(r.success).toBe(false);
    expect(r.diagnostic?.message).toContain(
      'the callee has the type `number`, which is not a function type'
    );
    expect(r.diagnostic?.message).toContain(
      'The interpreter reads such a callee as a function of its free variables'
    );
  });

  test('the JavaScript fallback runs the interpreter', () => {
    const ce = new ComputeEngine();
    const e = ce.box(['Apply', ['D', ['Sin', 'x'], 'x'], 1]);
    expect(e.evaluate().json).toEqual(['Cos', 1]);
    const r = compile(e);
    expect(r.success).toBe(false);
    expect(r.run!({})).toBeCloseTo(Math.cos(1), 12);
  });

  test('the derivative of a function literal still compiles', () => {
    const ce = new ComputeEngine();
    const r = compile(
      ce.box([
        'Apply',
        ['Derivative', ['Function', ['Sin', ['Multiply', 'n', 'x']], 'x']],
        1,
      ])
    );
    expect(r.success).toBe(true);
    expect(r.run!({ n: 2 })).toBeCloseTo(2 * Math.cos(2), 12);
  });

  test('a function literal still compiles', () => {
    const ce = new ComputeEngine();
    const r = compile(
      ce.box(['Apply', ['Function', ['Sin', ['Multiply', 'n', 'x']], 'x'], 1])
    );
    expect(r.success).toBe(true);
    expect(r.run!({ n: 2 })).toBeCloseTo(Math.sin(2), 12);
  });
});

/**
 * The cases below reach the final call of the `Apply` lowerings, where
 * `assertCalleeIsFunction()` runs. The inputs are declared, not literal, so
 * that constant folding does not replace the application by its value.
 */
describe('a callee of a function type reaches the call', () => {
  function engine(): ComputeEngine {
    const ce = new ComputeEngine();
    ce.declare('L', 'list<real>');
    ce.declare('c', 'boolean');
    return ce;
  }
  const LIST_PARAMETER: MathJsonExpression = [
    'Apply',
    ['Function', ['Length', 'l'], ['Typed', 'l', "'list<real>'"]],
    'L',
  ];
  const CHOSEN_LITERAL: MathJsonExpression = [
    'Apply',
    [
      'If',
      'c',
      ['Function', ['Multiply', 2, 'x'], 'x'],
      ['Function', ['Add', 'x', 1], 'x'],
    ],
    3,
  ];

  test('a function literal with a list parameter', () => {
    const r = compile(engine().box(LIST_PARAMETER));
    expect(r.success).toBe(true);
    expect(r.code).toBe('(((l) => (l).length))(_.L)');
    expect(r.run!({ L: [1, 2, 3] })).toBe(3);
  });

  test('an If that chooses between two function literals', () => {
    const r = compile(engine().box(CHOSEN_LITERAL));
    expect(r.success).toBe(true);
    expect(r.run!({ c: true })).toBe(6);
    expect(r.run!({ c: false })).toBe(4);
  });

  test.each([
    ['a list parameter', LIST_PARAMETER],
    ['an If between two literals', CHOSEN_LITERAL],
  ])('on Python, %s', (_, json) => {
    const r = compile(engine().box(json), { to: 'python' } as never);
    expect(r.success).toBe(true);
  });

  test.each(['javascript', 'python'])(
    'on %s, an If between a literal and a number declines',
    (to) => {
      const ce = engine();
      const r = compile(
        ce.box([
          'Apply',
          ['If', 'c', ['Function', ['Multiply', 2, 'x'], 'x'], 5],
          3,
        ]),
        { to } as never
      );
      expect(r.success).toBe(false);
      expect(r.diagnostic?.message).toContain(
        'compiled code settles the shape of a value at compile time'
      );
    }
  );
});
