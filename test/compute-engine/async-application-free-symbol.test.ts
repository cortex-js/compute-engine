import { ComputeEngine } from '../../src/compute-engine';

// The asynchronous route (`evaluateAsync()`) of the application of a user
// function.
//
// 1. An application whose argument has a free symbol awaits its body, as an
//    application with ground arguments does. With `f := x ↦ AsyncOnly(x)`,
//    where `AsyncOnly` has only an `evaluateAsync` handler, `f(1 {0<t})`
//    gives `6 {0 < t}`, as `AsyncOnly(1 {0<t})` does. Before, the body ran
//    synchronously and `f(1 {0<t})` gave `AsyncOnly(1) {0 < t}`.
//
// 2. A recursive function is not unrolled over a free symbol on the
//    asynchronous route either: `g(y)` with `g(x) := AsyncOnly(x) + g(x-1)`
//    stays `g(y)`, also when the recursive application starts after an
//    `await` of the body.
//
// 3. The shortcuts of an application that evaluate the body synchronously
//    are not used on the asynchronous route when the body applies an
//    asynchronous-only operator: the application memo keeps the answers of
//    the two routes apart, the list-recursion plan is not used, and the
//    numeric evaluation with the written arguments is not used.

/** An engine with `AsyncOnly(x) = x + 5` (only an `evaluateAsync` handler,
 * which answers after an `await`), and `t` assigned when given. */
function engine(t?: number): ComputeEngine {
  const ce = new ComputeEngine();
  ce.declare('AsyncOnly', {
    broadcastable: true,
    signature: '(number) -> number',
    evaluateAsync: async ([x]) => {
      await Promise.resolve();
      if (x.symbols.length > 0) return undefined;
      return ce.number(x.N().re + 5);
    },
  });
  if (t !== undefined) ce.assign('t', t);
  return ce;
}

const POSITIVE = ['Less', 0, 't'];

async function both(
  ce: ComputeEngine,
  json: unknown
): Promise<[string, string]> {
  const sync = ce
    .box(json as any)
    .evaluate()
    .toString();
  const async_ = (await ce.box(json as any).evaluateAsync()).toString();
  return [sync, async_];
}

describe('an argument with a free symbol, asynchronous route', () => {
  test.each([
    [undefined, '6 {0 < t}'],
    [1, '6'],
    [-1, 'NaN'],
  ] as const)('f(1 {0<t}) with t = %s', async (t, expected) => {
    // A function literal held as a value.
    const ce = engine(t);
    ce.assign('f', ce.box(['Function', ['AsyncOnly', 'x'], 'x']));
    const direct = await ce
      .box(['AsyncOnly', ['When', 1, POSITIVE]])
      .evaluateAsync();
    expect(direct.toString()).toBe(expected);
    const applied = await ce.box(['f', ['When', 1, POSITIVE]]).evaluateAsync();
    expect(applied.toString()).toBe(expected);

    // A function defined with `:=`, parse route.
    ce.parse('h(x) := \\operatorname{AsyncOnly}(x)').evaluate();
    const parsed = await ce.parse('h(1\\{0<t\\})').evaluateAsync();
    expect(parsed.toString()).toBe(expected);
  });

  test('the synchronous route keeps the async-only application', () => {
    const ce = engine();
    ce.assign('f', ce.box(['Function', ['AsyncOnly', 'x'], 'x']));
    expect(
      ce
        .box(['f', ['When', 1, POSITIVE]])
        .evaluate()
        .toString()
    ).toBe('AsyncOnly(1) {0 < t}');
  });

  test('an argument that is a free symbol', async () => {
    const ce = engine();
    ce.parse('h(x) := \\operatorname{AsyncOnly}(x) + 1').evaluate();
    expect(await both(ce, ['h', 'y'])).toEqual([
      'AsyncOnly(y) + 1',
      'AsyncOnly(y) + 1',
    ]);
  });
});

describe('a recursion over a free symbol is not unrolled, asynchronous route', () => {
  test('the recursive application starts after an await', async () => {
    const ce = engine();
    ce.parse('g(x) := \\operatorname{AsyncOnly}(x) + g(x - 1)').evaluate();
    expect(await both(ce, ['g', 'y'])).toEqual(['g(y)', 'g(y)']);
  });

  test('a function literal held as a value', async () => {
    const ce = engine();
    ce.declare('m', 'function');
    ce.assign(
      'm',
      ce.box([
        'Function',
        ['Add', ['AsyncOnly', 'x'], ['m', ['Subtract', 'x', 1]]],
        'x',
      ])
    );
    expect(await both(ce, ['m', 'y'])).toEqual(['m(y)', 'm(y)']);
  });

  test('a body with no async-only operator', async () => {
    const ce = engine();
    ce.parse('g(x) := g(x - 1)').evaluate();
    ce.parse('k(x) := 1 + k(x - 1)').evaluate();
    expect(await both(ce, ['g', 'y'])).toEqual(['g(y)', 'g(y)']);
    expect(await both(ce, ['k', 'y'])).toEqual(['k(y)', 'k(y)']);
  });

  test('a mutual recursion', async () => {
    const ce = engine();
    ce.parse('a(x) := \\operatorname{AsyncOnly}(x) + b(x - 1)').evaluate();
    ce.parse('b(x) := a(x + 1)').evaluate();
    expect(await both(ce, ['a', 'y'])).toEqual(['a(y)', 'a(y)']);
  });

  test('a ground application whose body recurses over a free symbol', async () => {
    const ce = engine();
    ce.parse(
      'p(n) := \\operatorname{AsyncOnly}(n) + \\operatorname{If}(n > 0, p(y), 0)'
    ).evaluate();
    expect(await both(ce, ['p', 3])).toEqual(['p(3)', 'p(3)']);
  });

  test('two concurrent evaluations', async () => {
    const ce = engine();
    ce.parse('g(x) := \\operatorname{AsyncOnly}(x) + g(x - 1)').evaluate();
    ce.parse('h(x) := \\operatorname{AsyncOnly}(x)').evaluate();
    const [a, b, c] = await Promise.all([
      ce.box(['g', 'y']).evaluateAsync(),
      ce.box(['h', ['When', 1, POSITIVE]]).evaluateAsync(),
      ce.box(['h', 2]).evaluateAsync(),
    ]);
    expect([a.toString(), b.toString(), c.toString()]).toEqual([
      'g(y)',
      '6 {0 < t}',
      '7',
    ]);
  });

  test('a recursion with a number argument', async () => {
    const ce = engine();
    ce.parse(
      'r(n) := \\operatorname{If}(n \\le 0, 0, \\operatorname{AsyncOnly}(n) + r(n-1))'
    ).evaluate();
    expect((await ce.box(['r', 4]).evaluateAsync()).toString()).toBe('30');
    ce.parse('F(n) := \\operatorname{If}(n \\le 1, 1, n F(n-1))').evaluate();
    expect(await both(ce, ['F', 10])).toEqual(['3628800', '3628800']);
  });
});

describe('evaluate() and evaluateAsync() agree with no async-only operator', () => {
  test.each([
    ['u(x) := x^2 + 1', ['u', 'y'], 'y^2 + 1'],
    ['u(x) := x^2 + 1', ['u', ['When', 2, POSITIVE]], '5 {0 < t}'],
    ['u(x) := \\sin(x)', ['u', 'y'], 'sin(y)'],
    ['u(n) := \\operatorname{If}(n \\le 1, 1, n u(n-1))', ['u', 'y'], ''],
    ['u(x) := u(x)', ['u', 'y'], 'u(y)'],
    ['u(x) := u(x - 1)', ['u', 'y'], 'u(y)'],
  ] as const)('%s, %j', async (def, json, expected) => {
    const ce = engine();
    ce.parse(def).evaluate();
    const [sync, async_] = await both(ce, json);
    expect(async_).toBe(sync);
    if (expected !== '') expect(sync).toBe(expected);
  });
});

describe('no synchronous shortcut on the asynchronous route', () => {
  test('the application memo keeps the two routes apart', async () => {
    const ce = engine();
    ce.parse('q(x) := \\operatorname{AsyncOnly}(x)').evaluate();
    expect(ce.box(['q', 2]).evaluate().toString()).toBe('AsyncOnly(2)');
    expect((await ce.box(['q', 2]).evaluateAsync()).toString()).toBe('7');
    expect(ce.box(['q', 2]).evaluate().toString()).toBe('AsyncOnly(2)');
    expect((await ce.box(['q', 2]).evaluateAsync()).toString()).toBe('7');
  });

  test('a list-producing recursion', async () => {
    const ce = engine();
    ce.declare('L', 'function');
    ce.assign(
      'L',
      ce.box([
        'Function',
        [
          'Which',
          ['LessEqual', 'n', 0],
          ['List'],
          'True',
          ['Join', ['List', ['AsyncOnly', 'n']], ['L', ['Subtract', 'n', 1]]],
        ],
        'n',
      ])
    );
    expect((await ce.box(['L', 3]).evaluateAsync()).toString()).toBe('[8,7,6]');
  });

  test('a numeric evaluation with an exact argument', async () => {
    const ce = engine();
    ce.parse('q(x) := \\operatorname{AsyncOnly}(x)').evaluate();
    const result = await ce
      .box(['q', ['Rational', 1, 3]])
      .evaluateAsync({ numericApproximation: true });
    expect(result.re).toBeCloseTo(16 / 3, 12);
  });
});
