import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

/**
 * A symbol declared `any` is read as a number by the compiled code, so that a
 * host that declares every parameter `any` does not pay for a broadcast at
 * every arithmetic site. But the host can pass a list, and the JavaScript
 * operators give a wrong value for one: `p + q` gave the string `"1,23,4"`
 * for `[1, 2]` and `[3, 4]`, and `p·q` gave `NaN`. The arithmetic sites, the
 * comparisons and the other element-wise functions (`Sin`, `Abs`, …) over
 * such a symbol now check the value at run time, and
 * take the list code for an array (ROADMAP CE-366, user decision
 * 2026-10-25). A value that is not an array takes the code compiled before.
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
 * of the root function declared `any` compiles, with the run-time check of
 * its value that these tests read. */
function anyFunction(ce: ComputeEngine, body: unknown, names = ['p', 'q']) {
  return ce.box([
    'Function',
    body,
    ...names.map((n) => ['Typed', n, { str: 'any' }]),
  ] as any);
}

/** The compiled result and the interpreted result of `expr` for the values
 * `p` and `q`. The compiled route compiles `expr` as the body of a
 * function whose parameters `p` and `q` are declared `any`, and calls it
 * with `p` and `q`. The interpreted route evaluates `expr` in a fresh
 * engine where `p` and `q` are declared `any` and hold the values. */
function bothRoutes(
  expr: unknown,
  p: unknown,
  q: unknown
): { code: string; compiled: unknown; evaluated: Value } {
  const ce = new ComputeEngine();
  const result = compile(anyFunction(ce, expr));
  expect(result.success).toBe(true);
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
  return { code: result.code!, compiled, evaluated };
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

describe('CE-366: arithmetic over symbols declared any that hold lists', () => {
  const heads: Array<[string, unknown]> = [
    ['Add', ['Add', 'p', 'q']],
    ['Subtract', ['Subtract', 'p', 'q']],
    ['Multiply', ['Multiply', 'p', 'q']],
    ['Divide', ['Divide', 'p', 'q']],
    ['Power', ['Power', 'p', 'q']],
    ['Negate', ['Negate', 'p']],
    ['nested sum and product', ['Add', ['Multiply', 2, 'p'], 'q', 1]],
    ['a sum with a library function', ['Add', ['Sin', 'p'], 'q']],
    // An element-wise library function is checked too: its scalar kernel
    // gives `NaN` for an array (`Math.sin([1, 2])`).
    ['Sin of a sum', ['Sin', ['Add', ['Multiply', 2, 'p'], 1]]],
    ['Abs', ['Abs', 'p']],
    ['Sqrt', ['Sqrt', ['Abs', 'p']]],
  ];
  for (const [name, expr] of heads) {
    for (const [p, q] of VALUES) {
      test(`${name} at p = ${JSON.stringify(p)}, q = ${JSON.stringify(q)}`, () => {
        const { compiled, evaluated } = bothRoutes(expr, p, q);
        expectClose(compiled, evaluated);
      });
    }
  }

  test('the sum of two lists is not a string', () => {
    const { code, compiled } = bothRoutes(['Add', 'p', 'q'], [1, 2], [3, 4]);
    expect(code).toBe(
      '(p, q) => (!(Array.isArray(p) || ArrayBuffer.isView(p)) && ' +
        '!(Array.isArray(q) || ArrayBuffer.isView(q)) ? p + q : ' +
        '((_tv1, _tv2) => _SYS.bcast((_tv3, _tv4) => (_tv3 + _tv4), _tv1, _tv2))' +
        '(_SYS.plainList(p), _SYS.plainList(q)))'
    );
    expect(compiled).toEqual([4, 6]);
  });

  test('a symbol used twice is tested once', () => {
    const { code } = bothRoutes(
      ['Add', ['Multiply', 'p', 'p'], ['Negate', 'p']],
      2,
      3
    );
    expect(code.match(/Array\.isArray\(p\)/g)?.length).toBe(1);
  });

  test('two matrices take the entry-wise product, as a bare list does', () => {
    // An `any` value may hold a list of points, and compiled code holds a
    // list of points and a matrix as the same array, so it cannot choose the
    // matrix product the interpreter computes for two matrices (ROADMAP
    // CE-216.1).
    const { compiled } = bothRoutes(
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
    expect(compiled).toEqual([
      [5, 12],
      [21, 32],
    ]);
  });

  test('a declared number keeps the scalar code with no check', () => {
    const ce = new ComputeEngine();
    ce.declare('a', 'real');
    ce.declare('b', 'real');
    expect(compile(ce.box(['Add', 'a', 'b'])).code).toBe('_.a + _.b');
  });
});

describe('CE-366: the run-time check and the shared subexpressions', () => {
  // The scalar code and the list code are compiled in separate regions of
  // common subexpressions. When they shared one region, the temporary that
  // the scalar code bound for `Sin(p)` (`Math.sin(_.p)`) was bound before the
  // check and read by the list code too, and a list `p` gave `NaN` cells.
  const exprs: Array<[string, unknown]> = [
    ['Sin(p) + Cos(Sin(p))', ['Add', ['Sin', 'p'], ['Cos', ['Sin', 'p']]]],
    [
      '(p + 1)^2 + (p + 1)',
      ['Add', ['Power', ['Add', 'p', 1], 2], ['Add', 'p', 1]],
    ],
    [
      'Sin(p q) + Sin(p q)^2',
      [
        'Add',
        ['Sin', ['Multiply', 'p', 'q']],
        ['Power', ['Sin', ['Multiply', 'p', 'q']], 2],
      ],
    ],
  ];
  for (const [name, expr] of exprs) {
    for (const [p, q] of VALUES) {
      test(`${name} at p = ${JSON.stringify(p)}, q = ${JSON.stringify(q)}`, () => {
        const { compiled, evaluated } = bothRoutes(expr, p, q);
        expectClose(compiled, evaluated);
      });
    }
  }
});

describe('CE-366: the run-time check reads each input once', () => {
  // A `vars` mapping can be any source. The check evaluated it once in the
  // test and once more in the branch, so the value it tested was not the
  // value it used. An input declared `any` is now refused (ROADMAP
  // CE-712.1), so the interpreter reads the source once.
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

describe('CE-366: a numeric typed array is a list', () => {
  // A host can pass a `Float64Array` for a symbol declared `any`. The check
  // tested `Array.isArray` only, and `p + q` concatenated two typed arrays as
  // strings.
  const exprs: Array<[string, unknown]> = [
    ['Add', ['Add', 'p', 'q']],
    ['Multiply', ['Multiply', 'p', 'q']],
    ['Sin', ['Sin', 'p']],
    ['Less', ['Less', 'p', 'q']],
  ];
  for (const [name, expr] of exprs) {
    test(name, () => {
      const p = [1, 2];
      const q = [3, 4];
      const { evaluated } = bothRoutes(expr, p, q);
      const ce = new ComputeEngine();
      const result = compile(anyFunction(ce, expr));
      const compiled = (
        result.run as unknown as (...args: unknown[]) => unknown
      )(Float64Array.from(p), Float64Array.from(q));
      expectClose(compiled, evaluated);
    });
  }
});

describe('CE-366: a shared expression is walked once', () => {
  // `t0 = p`, `tn = Beta(tn-1, tn-1)`: the expression has n + 1 nodes but
  // 2^n positions. The walk that collects the symbols to test visited every
  // position, and at depth 40 it did not end.
  test('a tower of depth 40 compiles quickly', () => {
    const ce = new ComputeEngine();
    let t: Expression = ce.symbol('p');
    for (let i = 0; i < 40; i++) t = ce.function('Beta', [t, t]);
    const start = Date.now();
    const result = compile(
      ce.function('Function', [
        ce.function('Add', [t, 1]),
        ce.box(['Typed', 'p', { str: 'any' }]),
      ])
    );
    expect(result.success).toBe(true);
    expect(Date.now() - start).toBeLessThan(5000);
  });
});

describe('CE-366: comparisons over symbols declared any that hold lists', () => {
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

describe('CE-366: Max and Min over symbols declared any that hold lists', () => {
  // The interpreter flattens every level of a list operand and reduces;
  // `Math.max(<array>, <array>)` was `NaN`.
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
