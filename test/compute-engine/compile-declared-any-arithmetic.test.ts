import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

/**
 * A symbol declared `any` or `value` can hold a number or a list, and the
 * interpreter maps an element-wise operator over a list. The JavaScript
 * operators give a wrong value for a list: `p + q` gave the string
 * `"1,23,4"` for `[1, 2]` and `[3, 4]`, and `p·q` gave `NaN` (ROADMAP
 * CE-366). Compiled code does not test the shape of a value at run time, so
 * an arithmetic site, a comparison, an element-wise function (`Sin`,
 * `Abs`, …), `Max`, `Min`, `Sum` and `Product` over such a symbol decline,
 * and the interpreter fallback computes the value.
 *
 * `PointX` of a number is the `incompatible-type` error in the interpreter.
 * Compiled code throws a `RangeError` for it (ROADMAP CE-214.2, user
 * decision 2026-10-25); it answered `NaN` before.
 */

type Value = number | boolean | Value[];

/** The JavaScript value of an evaluated expression: a number, a boolean, or
 * an array of those. */
function toValue(e: Expression): Value {
  const json = e.N().json;
  const convert = (x: unknown): Value => {
    if (typeof x === 'number') return x;
    if (x === 'True') return true;
    if (x === 'False') return false;
    if (Array.isArray(x) && x[0] === 'List') return x.slice(1).map(convert);
    if (typeof x === 'string' && /^-?[\d.]+(e[-+]?\d+)?$/.test(x))
      return Number(x);
    if (typeof x === 'object' && x !== null && 'num' in x)
      return Number((x as { num: string }).num);
    throw new Error(`unexpected value ${JSON.stringify(x)}`);
  };
  return convert(json);
}

function toMathJson(v: unknown): unknown {
  return Array.isArray(v) ? ['List', ...v.map(toMathJson)] : v;
}

/** The function literal of `body` whose parameters `names` are declared
 * `any`. An INPUT declared `any` is refused (ROADMAP CE-712.1); a parameter
 * of the root function declared `any` is not an input, and the arithmetic
 * over it declines. */
function anyFunction(ce: ComputeEngine, body: unknown, names = ['p', 'q']) {
  return ce.box([
    'Function',
    body,
    ...names.map((n) => ['Typed', n, { str: 'any' }]),
  ] as any);
}

/** The compiled result and the interpreted result of `expr` for the values
 * `p` and `q`. Without the fallback, the compilation of the function whose
 * parameters `p` and `q` are declared `any` throws the decline. With the
 * fallback, the result has `success: false`, and its `run` is called with
 * `p` and `q`. The interpreted route evaluates `expr` in a fresh engine
 * where `p` and `q` are declared `any` and hold the values. */
function bothRoutes(
  expr: unknown,
  p: unknown,
  q: unknown
): { compiled: unknown; evaluated: Value } {
  const ce = new ComputeEngine();
  expect(() => compile(anyFunction(ce, expr), { fallback: false })).toThrow(
    /declared `any` or `value`/
  );
  const result = compile(anyFunction(ce, expr));
  expect(result.success).toBe(false);
  expect(result.diagnostic?.code).toBe('unsettled-shape');
  expect(result.unsupported).toEqual(
    expect.arrayContaining([expect.stringMatching(/^[pq]$/)])
  );
  const compiled = (result.run as unknown as (...args: unknown[]) => unknown)(
    p,
    q
  );

  const ce2 = new ComputeEngine();
  ce2.declare('p', 'any');
  ce2.declare('q', 'any');
  ce2.assign('p', ce2.box(toMathJson(p) as any));
  ce2.assign('q', ce2.box(toMathJson(q) as any));
  const evaluated = toValue(ce2.box(expr as any).evaluate());
  return { compiled, evaluated };
}

/** Compare two values with a tolerance for the float cells. */
function expectClose(actual: unknown, expected: Value): void {
  if (typeof expected === 'number') {
    expect(typeof actual).toBe('number');
    expect(actual as number).toBeCloseTo(expected, 12);
    return;
  }
  if (Array.isArray(expected)) {
    expect(Array.isArray(actual)).toBe(true);
    expect((actual as unknown[]).length).toBe(expected.length);
    expected.forEach((x, i) => expectClose((actual as unknown[])[i], x));
    return;
  }
  expect(actual).toBe(expected);
}

const VALUES: Array<[unknown, unknown]> = [
  [2, 3],
  [[1, 2], [3, 4]],
  [[1, 2], 3],
  [2, [3, 4]],
];

describe('CE-366: arithmetic over symbols declared any declines', () => {
  const heads: Array<[string, unknown]> = [
    ['Add', ['Add', 'p', 'q']],
    ['Subtract', ['Subtract', 'p', 'q']],
    ['Multiply', ['Multiply', 'p', 'q']],
    ['Divide', ['Divide', 'p', 'q']],
    ['Power', ['Power', 'p', 'q']],
    ['Negate', ['Negate', 'p']],
    ['nested sum and product', ['Add', ['Multiply', 2, 'p'], 'q', 1]],
    ['a sum with a library function', ['Add', ['Sin', 'p'], 'q']],
    ['Sin of a sum', ['Sin', ['Add', ['Multiply', 2, 'p'], 1]]],
    ['Abs', ['Abs', 'p']],
    ['Sqrt', ['Sqrt', ['Abs', 'p']]],
    ['Sin(p) + Cos(Sin(p))', ['Add', ['Sin', 'p'], ['Cos', ['Sin', 'p']]]],
  ];
  for (const [name, expr] of heads) {
    for (const [p, q] of VALUES) {
      test(`${name} at p = ${JSON.stringify(p)}, q = ${JSON.stringify(q)}`, () => {
        const { compiled, evaluated } = bothRoutes(expr, p, q);
        expectClose(compiled, evaluated);
      });
    }
  }

  test('two matrices take the matrix product of the interpreter', () => {
    const { compiled, evaluated } = bothRoutes(
      ['Multiply', 'p', 'q'],
      [
        [1, 2],
        [3, 4],
      ],
      [
        [5, 6],
        [7, 8],
      ]
    );
    expectClose(compiled, evaluated);
  });

  test('the message names each symbol and says to declare its shape', () => {
    const ce = new ComputeEngine();
    expect(() =>
      compile(anyFunction(ce, ['Add', 'p', 'q']), { fallback: false })
    ).toThrow(/`Add` over "p", "q".*Declare the shape/);
  });

  test('a parameter declared value declines too', () => {
    const ce = new ComputeEngine();
    const result = compile(
      ce.box([
        'Function',
        ['Multiply', 2, 'p'],
        ['Typed', 'p', { str: 'value' }],
      ] as any)
    );
    expect(result.success).toBe(false);
    expect(result.unsupported).toContain('p');
    const run = result.run as unknown as (p: unknown) => unknown;
    expect(run([1, 2])).toEqual([2, 4]);
    expect(run(3)).toBe(6);
  });

  test('a declared number keeps the scalar code with no check', () => {
    const ce = new ComputeEngine();
    ce.declare('a', 'real');
    ce.declare('b', 'real');
    expect(compile(ce.box(['Add', 'a', 'b'])).code).toBe('_.a + _.b');
  });

  test('a parameter declared any that is only returned compiles', () => {
    const ce = new ComputeEngine();
    const result = compile(anyFunction(ce, 'p', ['p']), { fallback: false });
    expect(result.success).toBe(true);
    const run = result.run as unknown as (p: unknown) => unknown;
    expect(run([1, 2])).toEqual([1, 2]);
  });
});

describe('CE-366: a symbol declared any or value with a value declines', () => {
  // The compiled code reads the value of such a symbol where the symbol
  // occurs. The value can be a list, and the scalar code gave a wrong
  // value for one: with `p` declared `any` and assigned `2L`, `p + 1` gave
  // the string "2,41" at `L = [1, 2]`, where the interpreter gives `[3, 5]`.
  const engine = (type: string): ComputeEngine => {
    const ce = new ComputeEngine();
    ce.declare('k', type as never);
    ce.assign('k', ce.box(['List', 1, 2]));
    ce.declare('x', 'real');
    return ce;
  };

  for (const type of ['any', 'value'])
    test(`k + x with k: ${type} holding [1, 2]`, () => {
      const ce = engine(type);
      const expr = ce.box(['Add', 'k', 'x']);
      expect(() =>
        compile(expr, { to: 'javascript', fallback: false })
      ).toThrow(/`Add` over "k": it is declared `any` or `value`/);
      const result = compile(expr, { to: 'javascript' });
      expect(result.success).toBe(false);
      expect(result.diagnostic?.code).toBe('unsettled-shape');
      expect(result.unsupported).toContain('k');
      expect(result.run!({ x: 10 })).toEqual([11, 12]);
    });

  test.each([
    ['Max(k, 1)', ['Max', 'k', 1], 2],
    ['Sum(k)', ['Sum', 'k'], 3],
  ])('%s with k: any holding [1, 2]', (_name, json, expected) => {
    const ce = engine('any');
    const expr = ce.box(json as any);
    const options = { to: 'javascript', constantFold: false } as const;
    expect(() => compile(expr, { ...options, fallback: false })).toThrow(
      /over "k": it is declared `any` or `value`/
    );
    const result = compile(expr, options);
    expect(result.success).toBe(false);
    expect(result.run!({})).toBe(expected);
    expect(toValue(expr.evaluate())).toBe(expected);
  });

  test('p + 1 with p: any assigned 2L', () => {
    const ce = new ComputeEngine();
    ce.declare('p', 'any');
    ce.declare('L', 'list<real>');
    ce.assign('p', ce.box(['Multiply', 2, 'L']));
    const expr = ce.box(['Add', 'p', 1]);
    const options = { to: 'javascript', constantFold: false } as const;
    expect(() => compile(expr, { ...options, fallback: false })).toThrow(
      /`Add` over "p": it is declared `any` or `value`/
    );
    const result = compile(expr, options);
    expect(result.success).toBe(false);
    expect(result.diagnostic?.code).toBe('unsettled-shape');
    expect(result.unsupported).toContain('p');
    // The interpreter's value.
    ce.assign('L', ce.box(['List', 1, 2]));
    expect(toValue(expr.evaluate())).toEqual([3, 5]);
  });
});

describe('CE-366: an input declared any is refused before the decline', () => {
  // An input declared `any` is refused (ROADMAP CE-712.1), with the code
  // `untyped-input`, as on every other target, and the interpreter reads the
  // source of a `vars` mapping once.
  test('an input declared any mapped through vars is refused', () => {
    const ce = new ComputeEngine();
    ce.declare('p', 'any');
    const expr = ce.box(['Add', 'p', 1]);
    const result = compile(expr, { vars: { p: '_.values.shift()' } });
    expect(result.success).toBe(false);
    expect(result.diagnostic?.code).toBe('untyped-input');
    expect(result.unsupported).toContain('p');
    ce.assign('p', ce.box(['List', 1, 2]));
    expect(toValue(expr.evaluate())).toEqual([2, 3]);
  });
});

describe('CE-366: a shared expression is walked once', () => {
  // `t0 = p`, `tn = Beta(tn-1, tn-1)`: the expression has n + 1 nodes but
  // 2^n positions. The walk that collects the symbols declared `any` visited
  // every position, and at depth 40 it did not end.
  test('a tower of depth 40 declines quickly', () => {
    const ce = new ComputeEngine();
    let t: Expression = ce.symbol('p');
    for (let i = 0; i < 40; i++) t = ce.function('Beta', [t, t]);
    const start = Date.now();
    expect(() =>
      compile(
        ce.function('Function', [
          ce.function('Add', [t, 1]),
          ce.box(['Typed', 'p', { str: 'any' }]),
        ]),
        { fallback: false }
      )
    ).toThrow(/declared `any` or `value`/);
    expect(Date.now() - start).toBeLessThan(5000);
  });
});

describe('CE-366: comparisons over symbols declared any decline', () => {
  const heads: Array<[string, unknown]> = [
    ['Less', ['Less', 'p', 'q']],
    ['GreaterEqual', ['GreaterEqual', 'p', 'q']],
    ['Equal', ['Equal', 'p', 'q']],
    ['NotEqual', ['NotEqual', 'p', 'q']],
  ];
  const values: Array<[unknown, unknown]> = [
    ...VALUES,
    [[1, 2], [1, 2]],
    [[3, 3], 3],
  ];
  for (const [name, expr] of heads) {
    for (const [p, q] of values) {
      test(`${name} at p = ${JSON.stringify(p)}, q = ${JSON.stringify(q)}`, () => {
        const { compiled, evaluated } = bothRoutes(expr, p, q);
        expectClose(compiled, evaluated);
      });
    }
  }
});

describe('CE-366: Max and Min over symbols declared any decline', () => {
  const heads: Array<[string, unknown]> = [
    ['Max(p, q)', ['Max', 'p', 'q']],
    ['Min(p, q)', ['Min', 'p', 'q']],
    ['Max(p)', ['Max', 'p']],
    ['Min(p)', ['Min', 'p']],
    ['Max(p, 1)', ['Max', 'p', 1]],
    ['Max(2p, q)', ['Max', ['Multiply', 2, 'p'], 'q']],
  ];
  const values: Array<[unknown, unknown]> = [
    ...VALUES,
    [
      [
        [1, 5],
        [3, 4],
      ],
      [2],
    ],
  ];
  for (const [name, expr] of heads) {
    for (const [p, q] of values) {
      test(`${name} at p = ${JSON.stringify(p)}, q = ${JSON.stringify(q)}`, () => {
        const { compiled, evaluated } = bothRoutes(expr, p, q);
        expectClose(compiled, evaluated);
      });
    }
  }

  test('a declared number keeps Math.max', () => {
    const ce = new ComputeEngine();
    ce.declare('a', 'real');
    ce.declare('b', 'real');
    expect(compile(ce.box(['Max', 'a', 'b'])).code).toBe('Math.max(_.a, _.b)');
  });
});

describe('CE-214.2: the coordinate of a number', () => {
  function setup(): ComputeEngine {
    const ce = new ComputeEngine();
    ce.declare('x', 'any');
    ce.assign(
      'g',
      ce.box(['Function', ['List', 't', ['Multiply', 2, 't']], 't'])
    );
    return ce;
  }

  // The compiled route compiles the expression as the body of a function
  // whose parameter `x` is declared `type`: an input declared `any` is
  // refused (ROADMAP CE-712.1).
  const compiledWith = (ce: ComputeEngine, body: unknown, type: string) =>
    compile(
      ce.box(['Function', body, ['Typed', 'x', { str: type }]] as any)
    );

  // `g` maps over a list and binds a number, so a call of `g` with a
  // parameter declared `any` has no settled shape, and the compilation
  // declines (rule R3 of `docs/plans/2026-10-31-static-shape-compilation.md`).
  for (const head of ['PointX', 'PointY', 'PointZ']) {
    test(`${head}(g(x)[1]) with x declared any declines`, () => {
      const ce = setup();
      const result = compiledWith(ce, [head, ['At', ['g', 'x'], 1]], 'any');
      expect(result.success).toBe(false);
      expect(result.unsupported).toContain('x');
    });
  }

  // With `x: real`, `g(x)[1]` is the number `x`, and `PointX` of a number
  // has the static type `error`: the compilation declines, and the
  // interpreter gives the `incompatible-type` error.
  test('PointX(g(x)[1]) with x declared real declines', () => {
    const ce = setup();
    const json = ['PointX', ['At', ['g', 'x'], 1]];
    expect(compiledWith(ce, json, 'real').success).toBe(false);
    ce.declare('y', 'real');
    ce.assign('y', 3);
    expect(
      ce.box(['PointX', ['At', ['g', 'y'], 1]] as any).evaluate().toString()
    ).toMatch(/incompatible-type/);
  });

  test('a list and a list of points give the interpreter value', () => {
    for (const [type, value, json] of [
      ['list<real>', [1, 2], ['List', 1, 2]],
      [
        'list<tuple<real, real>>',
        [
          [1, 2],
          [3, 4],
        ],
        ['List', ['Tuple', 1, 2], ['Tuple', 3, 4]],
      ],
    ] as const) {
      const ce = setup();
      const body = ['PointX', ['At', ['g', 'x'], 1]];
      const result = compiledWith(ce, body, type);
      expect(result.success).toBe(true);
      const run = result.run as unknown as (x: unknown) => unknown;
      ce.declare('y', type);
      ce.assign('y', ce.box(json as any));
      const e = ce.box(['PointX', ['At', ['g', 'y'], 1]] as any);
      expect(run(value)).toEqual(toValue(e.evaluate()));
    }
  });

  // An input declared `any` is refused (ROADMAP CE-712.1); the
  // interpreter fallback reads the absent operand.
  test('an input declared any is refused', () => {
    const ce = new ComputeEngine();
    ce.declare('x', 'any');
    const result = compile(ce.box(['PointX', 'x']));
    expect(result.success).toBe(false);
    expect(result.diagnostic?.code).toBe('untyped-input');
    expect(result.unsupported).toContain('x');
  });

  test('an absent parameter declared any is still absent, not an error', () => {
    const ce = new ComputeEngine();
    const result = compile(anyFunction(ce, ['PointX', 'x'], ['x']));
    expect(result.success).toBe(true);
    expect(
      (result.run as unknown as (x: unknown) => unknown)(undefined)
    ).toBeUndefined();
  });
});
