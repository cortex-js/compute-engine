import { ComputeEngine } from '../../src/compute-engine';

// `.N()` promises a correct result (ARCHITECTURE.md, "What `.N()`
// promises"): a function whose result jumps at a point uses the exact value
// of an exact operand, so `Floor((25! − 1)/24!).N()` is 24 where the float
// of the operand is 25. A user function whose body applies such a function
// received its arguments approximated, on every route (a literal held as a
// value, a one-step definition, `Apply`), and `f((25! − 1)/24!).N()` for
// `f := x ↦ Floor(x)` was 25. The parameter is still bound to the
// approximation, and the activation records the written argument when it
// is pure and ground (`exact-argument-source.ts`, `exactArgumentSources` in
// `function-utils.ts`); the handler of the jump re-reads it exactly only
// when the float is near the jump (`exactRealValueOf`). Nothing is
// evaluated twice, and nothing is evaluated exactly far from a jump.

const Q = ['Divide', ['Subtract', ['Factorial', 25], 1], ['Factorial', 24]];

describe('a user function with a jump body under .N()', () => {
  test('a literal held as a value', () => {
    const ce = new ComputeEngine();
    ce.assign('f', ce.box(['Function', ['Floor', 'x'], 'x']));
    expect(ce.box(['f', Q]).N().toString()).toBe('24');
    expect(ce.box(['f', Q]).evaluate().toString()).toBe('24');
    // A float argument stays a float.
    expect(ce.box(['f', 1.7]).N().toString()).toBe('1');
    // Through an exact global.
    ce.assign('y', ce.box(Q).evaluate());
    expect(ce.box(['f', 'y']).N().toString()).toBe('24');
  });

  test('a one-step definition and a declared function', () => {
    const ce = new ComputeEngine();
    ce.parse('k(x) := \\lfloor x \\rfloor').evaluate();
    expect(ce.box(['k', Q]).N().toString()).toBe('24');
    ce.declare('h', {
      type: '(real) -> real',
      value: ce.box(['Function', ['Floor', 'x'], 'x']),
    });
    expect(ce.box(['h', Q]).N().toString()).toBe('24');
  });

  test('a bare function as a value, and a call through another function', () => {
    const ce = new ComputeEngine();
    ce.assign('g', ce.box('Floor'));
    expect(ce.box(['g', Q]).N().toString()).toBe('24');
    ce.assign('f', ce.box(['Function', ['Floor', 'x'], 'x']));
    ce.assign('f2', ce.box(['Function', ['Add', ['f', 'x'], 1], 'x']));
    expect(ce.box(['f2', Q]).N().toString()).toBe('25');
  });

  test('Apply of a literal and of a name', () => {
    const ce = new ComputeEngine();
    ce.assign('f', ce.box(['Function', ['Floor', 'x'], 'x']));
    expect(ce.box(['Apply', 'f', Q]).N().toString()).toBe('24');
    expect(
      ce
        .box(['Apply', ['Function', ['Floor', 'x'], 'x'], Q])
        .N()
        .toString()
    ).toBe('24');
  });

  test('the asynchronous routes', async () => {
    const ce = new ComputeEngine();
    ce.assign('f', ce.box(['Function', ['Floor', 'x'], 'x']));
    ce.parse('k(x) := \\lfloor x \\rfloor').evaluate();
    const n = { numericApproximation: true } as const;
    expect((await ce.box(['f', Q]).evaluateAsync(n)).toString()).toBe('24');
    expect((await ce.box(['k', Q]).evaluateAsync(n)).toString()).toBe('24');
    expect((await ce.box(['Apply', 'f', Q]).evaluateAsync(n)).toString()).toBe(
      '24'
    );
  });

  // The exact value of the sum is a rational with thousands of digits:
  // evaluating it exactly takes about 30 s (measured 2026-10-20 on an M5),
  // while the numeric route takes about 0.1 s locally and up to 4 s on a
  // loaded continuous-integration runner. A limit of 15 s separates the two
  // routes on any of these machines; a limit of 2 s failed on the Node 26
  // runner. The jest timeout is set above the limit, so a regression fails on
  // the assertion and not on the default 5 s jest timeout. The time is checked
  // only in a `CE_PERF=1` run (CODING-STYLEGUIDE.md): in a full suite on the
  // shared machine this test once took 44 s (2026-10-30) and 155 ms when run
  // alone. The value check above does not depend on time.
  test(
    'an argument far from a jump is not evaluated exactly',
    () => {
      const ce = new ComputeEngine();
      ce.assign('f', ce.box(['Function', ['Floor', 'x'], 'x']));
      const sum = ['Sum', ['Divide', 1, 'k'], ['Tuple', 'k', 1, 10000]];
      const start = Date.now();
      const viaFunction = ce.box(['f', sum]).N().toString();
      const elapsed = Date.now() - start;
      expect(viaFunction).toBe(ce.box(['Floor', sum]).N().toString());
      if (process.env.CE_PERF === '1') expect(elapsed).toBeLessThan(15_000);
    },
    20_000
  );

  test('a body with no jump is unchanged', () => {
    const ce = new ComputeEngine();
    ce.assign('s', ce.box(['Function', ['Sin', 'x'], 'x']));
    expect(ce.box(['s', 2]).N().toString()).toBe(
      ce.box(['Sin', 2]).N().toString()
    );
  });

  test('a Map over a bare jump function auto-compiles with exact inputs served by the interpreter', () => {
    const ce = new ComputeEngine();
    ce.precision = 'machine';
    ce.assign('g', ce.box('Floor'));
    const list = ['List', ...Array(70).fill(Q)];
    const values = new Set<string>();
    const mapped = ce.box(['Map', ['Function', ['g', 'x'], 'x'], list]).N();
    for (const x of (mapped as any).each()) values.add(x.toString());
    expect([...values]).toEqual(['24']);
  });
});

// CE-965. The numeric request applies to the value of the function, not to
// its last statement. Only the last statement takes the request, so a jump
// in another statement (an early `Return`, a local that holds the
// parameter) ran exactly on the float of the argument: the floor of the
// float of `(25! − 1)/24!` is 25. Under `.N()`, the parameters of a body
// that applies a jump function are bound to the exact value of a written
// argument that costs little (`exactBoundArguments` in `function-utils.ts`).
describe('a jump in a statement before the last one under .N()', () => {
  test('an early Return', () => {
    const ce = new ComputeEngine();
    ce.assign(
      'f',
      ce.box([
        'Function',
        ['Block', ['If', ['Greater', 'x', 1], ['Return', ['Floor', 'x']]], 0],
        'x',
      ])
    );
    expect(ce.box(['f', Q]).N().toString()).toBe('24');
    expect(ce.box(['f', Q]).evaluate().toString()).toBe('24');
    expect(
      ce
        .box(['N', ['f', Q]])
        .evaluate()
        .toString()
    ).toBe('24');
    expect(ce.box(['Apply', 'f', Q]).N().toString()).toBe('24');
    // A float argument is bound as it is.
    expect(
      ce
        .box(['f', { num: '25.0' }])
        .N()
        .toString()
    ).toBe('25');
    expect(ce.box(['f', 0.5]).N().toString()).toBe('0');
  });

  test('a local that holds the parameter', () => {
    const ce = new ComputeEngine();
    ce.assign(
      'g',
      ce.box([
        'Function',
        ['Block', ['Declare', 'y', "'real'", 'x'], ['Floor', 'y']],
        'x',
      ])
    );
    expect(ce.box(['g', Q]).N().toString()).toBe('24');
  });

  test('a one-step definition', () => {
    const ce = new ComputeEngine();
    ce.declare('k', {
      type: '(real) -> real',
      value: ce.box([
        'Function',
        ['Block', ['If', ['Greater', 'x', 1], ['Return', ['Floor', 'x']]], 0],
        'x',
      ]),
    });
    expect(ce.box(['k', Q]).N().toString()).toBe('24');
  });

  // An exact rational that goes through a loop or a recursion can double
  // in size at each step: such a body keeps the float of the argument.
  // With the exact value bound, each of these took about a minute.
  test('a loop or a recursion keeps the approximated argument', () => {
    const ce = new ComputeEngine();
    const step = ['Multiply', 4, 'z', ['Subtract', 1, 'z']];
    ce.assign(
      'h',
      ce.box([
        'Function',
        [
          'Block',
          ['Declare', 'z', "'real'", 'y'],
          ['Loop', ['Assign', 'z', step], ['Element', 'k', ['Range', 1, 18]]],
          ['Floor', ['Multiply', 10, 'z']],
        ],
        'y',
      ])
    );
    ce.assign(
      'g',
      ce.box([
        'Function',
        [
          'Block',
          [
            'If',
            ['Equal', 'n', 0],
            ['Return', ['Floor', ['Multiply', 10, 'z']]],
          ],
          ['g', step, ['Subtract', 'n', 1]],
        ],
        'z',
        'n',
      ])
    );
    // A function held in a list, applied from the body.
    ce.assign('L', ce.box(['List', 'h']));
    ce.assign(
      'u',
      ce.box([
        'Function',
        [
          'Block',
          ['If', ['Less', 'y', 0], ['Return', 0]],
          ['Apply', ['At', 'L', 1], 'y'],
        ],
        'y',
      ])
    );
    const start = Date.now();
    const loop = ce.box(['h', ['Rational', 1, 3]]).N();
    const recursion = ce.box(['g', ['Rational', 1, 3], 18]).N();
    const throughList = ce.box(['u', ['Rational', 1, 3]]).N();
    const elapsed = Date.now() - start;
    expect(loop.isInteger).toBe(true);
    expect(recursion.isInteger).toBe(true);
    expect(throughList.isInteger).toBe(true);
    if (process.env.CE_PERF === '1') expect(elapsed).toBeLessThan(5_000);
  });

  test('the asynchronous route', async () => {
    const ce = new ComputeEngine();
    ce.assign(
      'f',
      ce.box([
        'Function',
        ['Block', ['If', ['Greater', 'x', 1], ['Return', ['Floor', 'x']]], 0],
        'x',
      ])
    );
    const n = { numericApproximation: true } as const;
    expect((await ce.box(['f', Q]).evaluateAsync(n)).toString()).toBe('24');
  });

  test('a body with no jump keeps the approximated argument', () => {
    const ce = new ComputeEngine();
    ce.assign(
      's',
      ce.box([
        'Function',
        ['Block', ['Declare', 'y', "'real'", 'x'], ['Sin', 'y']],
        'x',
      ])
    );
    expect(
      ce
        .box(['s', ['Rational', 1, 3]])
        .N()
        .toString()
    ).toBe(
      ce
        .box(['Sin', ['Rational', 1, 3]])
        .N()
        .toString()
    );
  });
});

// CE-1439. The caller records the written arguments after it evaluated all
// of them, and a recorded argument is evaluated again later. An argument
// that is not pure can assign a variable that another argument reads, so
// then only an argument whose symbols are constants is recorded
// (`exactArgumentSources` in `function-utils.ts`). The other arguments read
// their approximation, as an operand that is not pure does under `.N()`
// (ARCHITECTURE.md, "What `.N()` promises"): `Floor(3·(x/3))` with the float
// of `1/3` at the working precision is 0. With `x/3` read again after the
// second argument assigned 5 to `x`, the value was 5.
describe('an argument that assigns a variable that another argument reads', () => {
  const assigns = ['Block', ['Assign', 'x', 5], 1];
  const floor3 = ['Floor', ['Multiply', 3, 'y']];
  const third = ['Divide', 'x', 3];

  const engine = (): ComputeEngine => {
    const ce = new ComputeEngine();
    ce.assign('g', ce.box(['Function', floor3, 'y', 'w']));
    ce.declare('k', {
      type: '(real, real) -> integer',
      value: ce.box(['Function', floor3, 'y', 'w']),
    });
    // A straight-line body with a jump binds the exact value of a cheap
    // argument (`exactBoundArguments`).
    ce.assign(
      'r',
      ce.box([
        'Function',
        ['Block', ['If', ['Greater', 'y', 0], ['Return', floor3]], 7],
        'y',
        'w',
      ])
    );
    ce.declare('x', 'integer');
    ce.assign('x', 1);
    return ce;
  };

  test.each([
    ['a literal held as a value', ['g', third, assigns]],
    ['a declared function', ['k', third, assigns]],
    ['Apply', ['Apply', 'g', third, assigns]],
    ['a body with an early Return', ['r', third, assigns]],
  ])('%s', (_, call) => {
    const ce = engine();
    expect(
      ce
        .box(call as any)
        .N()
        .toString()
    ).toBe('0');
    // The exact evaluation reads `x` before the assignment.
    ce.assign('x', 1);
    expect(
      ce
        .box(call as any)
        .evaluate()
        .toString()
    ).toBe('1');
  });

  // A symbol argument records the value of the symbol, read after every
  // argument was evaluated: 5 where the argument was 1/3.
  test.each([['g'], ['r']])('a symbol argument of %s', (f) => {
    const ce = engine();
    ce.declare('a', 'real');
    ce.assign('a', ce.box(['Rational', 1, 3]));
    const call = [f, 'a', ['Block', ['Assign', 'a', 5], 1]];
    expect(ce.box(call as any).N().toString()).toBe('0');
  });

  // With every argument pure, an argument that reads a variable is still
  // recorded: no argument can have changed the variable. The body with an
  // early Return gave 0, the floor of the float.
  test('pure arguments that read a variable', () => {
    const ce = engine();
    expect(ce.box(['g', third, 1]).N().toString()).toBe('1');
    expect(ce.box(['k', third, 1]).N().toString()).toBe('1');
    expect(ce.box(['r', third, 1]).N().toString()).toBe('1');
  });
});
