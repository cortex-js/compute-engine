/**
 * #395: `Composition(f, g, h)`, applied right to left as in Wolfram:
 * `Composition(f, g, h)(x)` is `f(g(h(x)))`, the rightmost function takes all
 * the arguments and each other one the single result of the next.
 */
import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { effectsOf } from '../../src/compute-engine/boxed-expression/effects-of';

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

  test('a composition callback of Map and Filter compiles to JavaScript', () => {
    const local = new ComputeEngine();
    local.declare('L', 'list<real>');
    local.declare('M', 'list<real>');
    const L = [0, 0.5, 1];
    const M = [1, 2, 3];
    const cases: [unknown, number[]][] = [
      [
        ['Map', ['Composition', 'Sin', 'Exp'], 'L'],
        L.map((x) => Math.sin(Math.exp(x))),
      ],
      [
        [
          'Map',
          ['Composition', 'Sin', ['Function', ['Add', 'y', 1], 'y']],
          'L',
        ],
        L.map((x) => Math.sin(x + 1)),
      ],
      [
        [
          'Map',
          ['Composition', 'Sqrt', ['Function', ['Add', 'a', 'b'], 'a', 'b']],
          'L',
          'M',
        ],
        L.map((x, i) => Math.sqrt(x + M[i])),
      ],
      [
        [
          'Filter',
          'L',
          ['Composition', 'Not', ['Function', ['Less', 'y', 0.6], 'y']],
        ],
        [1],
      ],
    ];
    for (const [json, expected] of cases) {
      const r = compile(local.box(json as any));
      expect(r.success).toBe(true);
      const run = r.run as (v: Record<string, number[]>) => number[];
      expect(run({ L, M })).toEqual(expected);
    }
  });

  test('a callback whose last step has no fixed parameter count declines', () => {
    // `Add` takes any number of arguments, so the compiler cannot tell how
    // many parameters the literal of `Composition(Sqrt, Add)` needs: the
    // interpreter evaluates the `Map`.
    const local = new ComputeEngine();
    local.declare('L', 'list<real>');
    local.declare('M', 'list<real>');
    const expr = local.box(['Map', ['Composition', 'Sqrt', 'Add'], 'L', 'M']);
    expect(compile(expr).success).toBe(false);
    expect(
      expr
        .subs({ L: local.box(['List', 0, 2]), M: local.box(['List', 1, 2]) })
        .evaluate()
        .toString()
    ).toBe('[1,2]');
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

describe('Composition review fixes', () => {
  test('the callback arity of a composition is the arity of its last step', () => {
    const local = new ComputeEngine();
    local.declare('L', 'list<real>');
    local.declare('M', 'list<real>');
    // An error node renders the expression it replaces, so the message is
    // compared without the name of the callback.
    const arityError = (json: unknown): string | undefined => {
      const e = local.box(json as never);
      expect(e.isValid).toBe(false);
      const err = e.ops![0];
      expect(err.operator).toBe('Error');
      expect(err.ops![0].operator).toBe('ErrorCode');
      expect(err.ops![0].ops![0].string).toBe('callback-arity');
      expect(compile(e).success).toBe(false);
      return err.ops![0].ops![1].string?.replace(/;.*declares/, '; declares');
    };
    // `Sin`, the last step, takes one argument and `Map` passes two.
    expect(arityError(['Map', ['Composition', 'Sin', 'Exp'], 'L', 'M'])).toBe(
      arityError(['Map', 'Sin', 'L', 'M'])
    );
    // The last step takes two arguments and `Map` passes one.
    const pair = ['Function', ['Add', 'a', 'b'], 'a', 'b'];
    expect(arityError(['Map', ['Composition', 'Sqrt', pair], 'L'])).toBe(
      arityError(['Map', pair, 'L'])
    );
  });

  test('a middle step that takes two arguments declines to compile', () => {
    // The interpreter applies `(a, b) => a + b` to the single result of
    // `Sin` and answers a curried function; the compiled code cannot express
    // that, so it declines.
    const local = new ComputeEngine();
    local.declare('L', 'list<real>');
    const pair = ['Function', ['Add', 'a', 'b'], 'a', 'b'];
    const expr = local.box(['Apply', ['Composition', pair, 'Sin'], 'x']);
    expect(expr.subs({ x: 1 }).evaluate().operator).toBe('Function');
    expect(compile(expr).success).toBe(false);
    expect(
      compile(local.box(['Map', ['Composition', pair, 'Sin'], 'L'])).success
    ).toBe(false);
  });

  test('N() of an application reads the exact argument, as the nested call does', () => {
    const arg = ['Divide', ['Subtract', ['Factorial', 25], 1], ['Factorial', 24]];
    // (25! - 1)/24! is a little less than 25, but its float is 25.
    expect(
      ce
        .box(['Apply', ['Composition', 'Negate', 'Floor'], arg] as never)
        .N()
        .toString()
    ).toBe('-24');
    expect(
      ce
        .box([['Composition', 'Negate', 'Floor'], arg] as never)
        .N()
        .toString()
    ).toBe('-24');
    expect(
      ce
        .box(['Negate', ['Floor', arg]] as never)
        .N()
        .toString()
    ).toBe('-24');
  });

  test('the type carries the effects of every step', () => {
    const t = ce.box(['Composition', 'Random', 'Sin']).type;
    expect(t.toString()).toContain(' random -> ');
    expect(ce.box(['Composition', 'Sin', 'Exp']).type.toString()).toBe(
      '(number) -> number'
    );
  });

  test('a single step that is not a function is an incompatible-type error', () => {
    for (const json of [
      ['Composition', 3],
      ['Composition', 'Identity', 3],
    ]) {
      const e = ce.box(json as never);
      expect(e.isValid).toBe(false);
      expect(e.toString()).toBe(
        'Error(ErrorCode("incompatible-type", "function", "3"), 3)'
      );
    }
  });

  test('a call of a symbol whose value is a composition declines to compile', () => {
    // The compiler does not read the value of `h` at the call site; the
    // interpreter evaluates the call.
    const local = new ComputeEngine();
    local.assign('h', local.box(['Composition', 'Sin', 'Exp']));
    expect(compile(local.box(['h', 'x'])).success).toBe(false);
    expect(local.box(['h', 0.5]).N().re).toBeCloseTo(
      Math.sin(Math.exp(0.5)),
      14
    );
  });

  test('N() reads the exact argument when it is the result of a call', () => {
    const local = new ComputeEngine();
    local.assign(
      'r',
      local.box([
        'Function',
        ['Divide', ['Subtract', ['Factorial', 25], 1], ['Factorial', 24]],
      ])
    );
    expect(
      local
        .box(['Apply', ['Composition', 'Negate', 'Floor'], ['r']])
        .N()
        .toString()
    ).toBe('-24');
    expect(local.box(['Negate', ['Floor', ['r']]]).N().toString()).toBe('-24');
  });

  test('a callback literal is not changed by a declaration of its parameter name', () => {
    const local = new ComputeEngine();
    local.declare('_x', 'string');
    local.declare('L', 'list<real>');
    const expr = local.box(['Map', ['Composition', 'Sin', 'Exp'], 'L']);
    const r = compile(expr);
    expect(r.success).toBe(true);
    const L = [0, 0.5, 1];
    const values = (r.run as (v: { L: number[] }) => number[])({ L });
    // The result of the interpreter's `Map` is lazy, so each element is
    // read from the application of the composition.
    const expected = L.map(
      (x) =>
        local
          .box([['Composition', 'Sin', 'Exp'], x])
          .N().re
    );
    values.forEach((v, i) => expect(v).toBeCloseTo(expected[i], 14));
    // The parameter of the literal is not declared in the enclosing scope.
    const fresh = new ComputeEngine();
    fresh.declare('L', 'list<real>');
    compile(fresh.box(['Map', ['Composition', 'Sin', 'Exp'], 'L']));
    expect(fresh.lookupDefinition('_x')).toBeUndefined();
  });

  test('a step before the last that takes two arguments makes the type generic', () => {
    const pair = ['Function', ['Add', 'a', 'b'], 'a', 'b'];
    expect(ce.box(['Composition', pair, 'Sin']).type.toString()).toBe(
      'function'
    );
    expect(ce.box(['Composition', 'Sin', 'Exp']).type.toString()).toBe(
      '(number) -> number'
    );
  });

  test('a symbol step calls the function it named, not a local of the same name', () => {
    // A block local `f` does not replace the global `f` that the step named,
    // as for a function literal that calls `f`.
    const local = new ComputeEngine();
    local.assign('f', local.box(['Function', ['Multiply', 2, 'y'], 'y']));
    local.assign('C', local.box(['Composition', 'f', 'Negate']));
    local.assign('G', local.box(['Function', ['f', ['Negate', 'y']], 'y']));
    const inBlock = (callee: string) =>
      local
        .box([
          'Block',
          ['Declare', 'f', 'function'],
          ['Assign', 'f', ['Function', 100, 'y']],
          [callee, 3],
        ])
        .evaluate()
        .toString();
    expect(inBlock('G')).toBe('-6');
    expect(inBlock('C')).toBe('-6');
  });

  test('evaluateAsync() evaluates a step that has only an asynchronous handler', async () => {
    const local = new ComputeEngine();
    local.declare('AsyncOnly', {
      signature: '(number) -> number',
      evaluateAsync: async ([x]) => local.number(x.re + 5),
    } as never);
    local.assign('h', local.box(['Composition', 'Negate', 'AsyncOnly']));
    expect((await local.box(['h', 1]).evaluateAsync()).toString()).toBe('-6');
  });

  test('a step that broadcasts over the result of the next one makes the type generic', () => {
    expect(ce.box(['Composition', 'Sin', 'Range']).type.toString()).toBe(
      'function'
    );
    expect(
      ce
        .box([['Composition', 'Sin', 'Range'], 1, 3])
        .evaluate()
        .toString()
    ).toBe('[sin(1),sin(2),sin(3)]');
    expect(ce.box(['Composition', 'Sin', 'Exp']).type.toString()).toBe(
      '(number) -> number'
    );
  });

  test('building a composition does not apply its steps', () => {
    const local = new ComputeEngine();
    local.declare('noisy', '(number) random -> number');
    const composition = ['Composition', 'noisy', 'Sin'];
    // The factory returns the composition: it is pure, and its result
    // carries the effect.
    expect(
      local.box(['Function', composition] as never).type.toString()
    ).toBe('() -> (complex | quantity) random -> number');
    expect(effectsOf(local.box(composition as never))).toBeUndefined();
    expect(effectsOf(local.box(['Apply', composition, 'x'] as never))).toEqual([
      'random',
    ]);
    // A composition whose type is not precise keeps the effects of its
    // steps in its type.
    expect(
      effectsOf(local.box(['Apply', ['Composition', 'Random', 'Sin'], 'x']))
    ).toEqual(['random']);
  });

  test('a composition callback is typed by its consumer, as a written literal is', () => {
    // `Rank` and `Length` read a whole row: the callback is not broadcast
    // over the elements of a row.
    const local = new ComputeEngine();
    local.declare('L', 'list<list<real>>');
    const rows = [
      [0, 1],
      [2, 3],
    ];
    const value = local.box(['List', ...rows.map((r) => ['List', ...r])]);
    for (const [head, expected] of [
      ['Rank', [1, 1]],
      ['Length', [2, 2]],
    ] as const) {
      for (const callback of [
        ['Composition', head, 'Exp'],
        ['Function', [head, ['Exp', 'y']], 'y'],
      ]) {
        const expr = local.box(['Map', callback, 'L'] as never);
        expect(expr.subs({ L: value }).N().toString()).toBe(
          `[${expected.join(',')}]`
        );
        const r = compile(expr);
        expect(r.success).toBe(true);
        expect(
          (r.run as (v: { L: number[][] }) => number[])({ L: rows })
        ).toEqual(expected);
      }
    }
  });

  test('a composition whose step name is hidden where it is compiled declines', () => {
    // The composition is made with the global `f`; it is compiled in a scope
    // that declares another `f`, which the compiled call would call.
    const local = new ComputeEngine();
    local.declare('L', 'list<real>');
    local.assign('f', local.box(['Function', ['Multiply', 2, 'y'], 'y']));
    const map = local.box(['Map', ['Composition', 'f', 'Negate'], 'L']);
    const call = local.box(['Apply', ['Composition', 'f', 'Negate'], 'x']);
    const run = (r: ReturnType<typeof compile>, v: object) =>
      (r.run as (v: object) => unknown)(v);
    expect(run(compile(map), { L: [1, 2] })).toEqual([-2, -4]);
    expect(run(compile(call), { x: 3 })).toBe(-6);
    local.pushScope();
    try {
      local.declare('f', {
        signature: '(number) -> number',
        evaluate: () => local.number(100),
      } as never);
      expect(compile(map).success).toBe(false);
      expect(compile(call).success).toBe(false);
    } finally {
      local.popScope();
    }
  });

  test('a composition with an anonymous slot is the shorthand of a function of the slot', () => {
    // `Composition(Sin, _)` is `_ ↦ Composition(Sin, _)`, as for any other
    // expression with a free slot (`Apply(Tuple(Sin, _), Exp)` is
    // `(Sin, Exp)`).
    const made = ce
      .box(['Apply', ['Composition', 'Sin', '_'], 'Exp'])
      .evaluate();
    expect(made.toString()).toBe('Composition(sin, exp)');
    expect(ce.box(['Apply', made, 0]).evaluate().toString()).toBe('sin(1)');
  });

  test('a composition callback of Map lowers to Python as its function literal', () => {
    const local = new ComputeEngine();
    local.declare('L', 'list<real>');
    const composed = compile(
      local.box(['Map', ['Composition', 'Sin', 'Exp'], 'L']),
      { to: 'python' }
    );
    const literal = compile(
      local.box(['Map', ['Function', ['Sin', ['Exp', 'y']], 'y'], 'L']),
      { to: 'python' }
    );
    expect(composed.success).toBe(true);
    expect(literal.success).toBe(true);
    expect(composed.code).toBe(literal.code.replace(/\by\b/g, '_x'));
  });
});
