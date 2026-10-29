/**
 * #395: `Composition(f, g, h)`, applied right to left as in Wolfram:
 * `Composition(f, g, h)(x)` is `f(g(h(x)))`, the rightmost function takes all
 * the arguments and each other one the single result of the next.
 */
import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

const ce = new ComputeEngine();

describe('Composition canonical form', () => {
  // [input, canonical form]
  const forms: [unknown, string][] = [
    [['Composition'], '"Identity"'],
    [['Composition', 'Sin'], 'sin'],
    [['Composition', 'Sin', 'Exp'], 'Composition(sin, exp)'],
    [
      ['Composition', 'Sin', ['Composition', 'Cos', 'Exp']],
      'Composition(sin, cos, exp)',
    ],
    [
      ['Composition', ['Composition', 'Sin', 'Cos'], ['Composition', 'Exp']],
      'Composition(sin, cos, exp)',
    ],
    [['Composition', 'Sin', 'Identity', 'Exp'], 'Composition(sin, exp)'],
    [['Composition', 'Sin', 'Identity'], 'sin'],
    [['Composition', 'Identity', 'Identity'], '"Identity"'],
  ];
  for (const [input, expected] of forms)
    test(`${JSON.stringify(input)} is ${expected}`, () => {
      expect(ce.box(input as never).toString()).toBe(expected);
    });

  test('a step that is not a function is an incompatible-type error', () => {
    const e = ce.box(['Composition', 'Sin', 3]);
    expect(e.isValid).toBe(false);
  });

  test('the type is a function type', () => {
    expect(ce.box(['Composition', 'Sin', 'Exp']).type.matches('function')).toBe(
      true
    );
    expect(ce.box(['Composition', 'f', 'g']).type.matches('function')).toBe(
      true
    );
  });

  test('the type takes the parameters of the last step and the result of the first', () => {
    const local = new ComputeEngine();
    local.declare('size', '(list) -> integer');
    local.declare('half', '(integer) -> rational');
    expect(local.box(['Composition', 'half', 'size']).type.toString()).toBe(
      '(list) -> rational'
    );
  });
});

describe('Composition application', () => {
  // [callee, arguments, value]: through Apply, a call of the composition and Pipe
  const cases: [unknown, unknown[], string][] = [
    [['Composition', 'Sin', 'Exp'], [0], 'sin(1)'],
    [['Composition', 'Exp', 'Sin'], [0], '1'],
    [['Composition', 'f', 'g', 'h'], ['x'], 'f(g(h(x)))'],
    [['Composition', 'f', 'g'], [['List', 1, 2]], 'f(g([1,2]))'],
    // the rightmost step takes every argument
    [['Composition', 'Sqrt', 'Add'], [3, 6], '3'],
    [['Composition', 'Sqrt', 'Add'], [3, 6, 7], '4'],
    // a function literal is a step
    [['Composition', 'Sqrt', ['Function', ['Add', 'y', 1], 'y']], [8], '3'],
    // a step that is itself a composition, written separately
    [
      ['Composition', ['Function', ['Multiply', 2, 'y'], 'y'], 'Sqrt', 'Abs'],
      [-16],
      '8',
    ],
    // a list is threaded by the library head, as in a direct call
    [['Composition', 'Sin', 'Exp'], [['List', 0, 1]], '[sin(1),sin(e)]'],
    // the identity is neutral
    [['Composition', 'Identity', 'Sin'], [0], '0'],
  ];
  for (const [callee, args, expected] of cases) {
    const label = `${JSON.stringify(callee)}(${args.map((a) => JSON.stringify(a)).join(', ')})`;
    test(`Apply: ${label} = ${expected}`, () => {
      expect(
        ce
          .box(['Apply', callee, ...args] as never)
          .evaluate()
          .toString()
      ).toBe(expected);
    });
    test(`call: ${label} = ${expected}`, () => {
      expect(
        ce
          .box([callee, ...args] as never)
          .evaluate()
          .toString()
      ).toBe(expected);
    });
    if (args.length === 1)
      test(`Pipe: ${label} = ${expected}`, () => {
        expect(
          ce
            .box(['Pipe', args[0], callee] as never)
            .evaluate()
            .toString()
        ).toBe(expected);
      });
  }

  test('Map applies the composition to each element', () => {
    expect(
      ce
        .box(['Map', ['Composition', 'Sqrt', 'Abs'], ['List', -4, 9]])
        .evaluate()
        .toString()
    ).toBe('[2,3]');
  });

  test('a composition is a function value for Apply with no arguments to evaluate', () => {
    const c = ce.box(['Composition', 'Sin', 'Exp']);
    expect(c.evaluate().toString()).toBe('Composition(sin, exp)');
  });

  test('an unknown step stays a symbolic call, a user function is called', () => {
    const local = new ComputeEngine();
    local
      .box(['Assign', 'dbl', ['Function', ['Multiply', 2, 'x'], 'x']])
      .evaluate();
    expect(
      local
        .box([['Composition', 'dbl', 'h'], 4])
        .evaluate()
        .toString()
    ).toBe('2h(4)');
    expect(
      local
        .box([['Composition', 'dbl', 'Sqrt'], 16])
        .evaluate()
        .toString()
    ).toBe('8');
  });

  test('N() and a float argument agree with the nested call', () => {
    const composed = ce.box([['Composition', 'Sin', 'Exp'], 0.5]);
    const nested = ce.box(['Sin', ['Exp', 0.5]]);
    expect(composed.evaluate().re).toBeCloseTo(nested.evaluate().re, 14);
    expect(composed.N().re).toBeCloseTo(nested.N().re, 14);
    expect(ce.box([['Composition', 'Sin', 'Exp'], 0]).N().re).toBeCloseTo(
      Math.sin(1),
      14
    );
  });

  test('the combinatorial-map use case: Inverse after Complement after Reverse', () => {
    const local = new ComputeEngine();
    local
      .box(['Assign', 'rev', ['Function', ['Reverse', 'p'], 'p']])
      .evaluate();
    local
      .box(['Assign', 'comp', ['Function', ['Subtract', 5, 'p'], 'p']])
      .evaluate();
    // Reverse of [1,2,3,4] then 5 - p
    expect(
      local
        .box([
          ['Composition', 'comp', 'rev'],
          ['List', 1, 2, 3, 4],
        ])
        .evaluate()
        .toString()
    ).toBe('[1,2,3,4]');
  });
});

describe('Composition compiled', () => {
  test('JavaScript agrees with the nested call', () => {
    const composed = compile(
      ce.box(['Apply', ['Composition', 'Sin', 'Exp', 'Abs'], 'x'])
    );
    const nested = compile(ce.box(['Sin', ['Exp', ['Abs', 'x']]]));
    expect(composed.success).toBe(true);
    for (const x of [-1.5, 0, 0.5, 2]) {
      const a = (composed.run as (v: { x: number }) => number)({ x });
      const b = (nested.run as (v: { x: number }) => number)({ x });
      expect(a).toBe(b);
      expect(a).toBeCloseTo(
        ce.box([['Composition', 'Sin', 'Exp', 'Abs'], x]).N().re,
        13
      );
    }
  });

  test('a function literal step compiles', () => {
    const fn = compile(
      ce.box([
        'Apply',
        ['Composition', 'Sqrt', ['Function', ['Add', 'y', 1], 'y']],
        'x',
      ])
    );
    expect(fn.success).toBe(true);
    expect((fn.run as (v: { x: number }) => number)({ x: 8 })).toBe(3);
  });

  test('WGSL lowers to the nested call', () => {
    const r = compile(ce.box(['Apply', ['Composition', 'Sin', 'Exp'], 'x']), {
      to: 'wgsl',
    });
    const nested = compile(ce.box(['Sin', ['Exp', 'x']]), { to: 'wgsl' });
    expect(r.success).toBe(true);
    expect(r.code).toBe(nested.code);
    expect(r.code).toContain('exp(x)');
  });
});
