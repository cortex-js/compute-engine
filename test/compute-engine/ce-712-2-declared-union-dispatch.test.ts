/**
 * CE-712.2, phase A: an input or a parameter DECLARED with a union of
 * shapes (`U: real | list<real>`,
 * `P: tuple<real, real> | list<tuple<real, real>>`,
 * `k: (number | list<number>) -> unknown`) is compiled once per member,
 * and the code tests the shape of the value once, at the input or at the
 * entry of the function, to select the body for that member.
 *
 * Before, one body read both shapes, and two values were wrong:
 * - `f(U)` with `f := t ↦ 2t + 1`, `U = [1, 2]`: interval-js gave the empty
 *   interval, the interpreter gives `[3, 5]`.
 * - `w(P)` with `w := p ↦ p[1] + p[2]` (declared `function`),
 *   `P = [(1, 2), (3, 4)]`: javascript threw ("the element read is a list
 *   at run time") and interval-js gave the whole real line, the interpreter
 *   gives `[3, 7]`.
 *
 * The compilation declines, with the names of the inputs in `unsupported`,
 * when no run-time test tells the members apart (a point of two reals and
 * a list of two reals are both `[a, b]`), or when the inputs need more than
 * four bodies.
 *
 * Design: rules R2 and R4 of
 * `docs/plans/2026-10-31-static-shape-compilation.md`.
 */

import { execFileSync } from 'node:child_process';
import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { PythonTarget } from '../../src/compute-engine/compilation/python-target';
import { TEST_PYTHON } from './test-python';

type Value = number | Value[];

function engine(): ComputeEngine {
  const ce = new ComputeEngine();
  ce.declare('x', 'real');
  ce.declare('L', 'list<real>');
  ce.declare('Q', 'list<tuple<real, real>>');
  ce.declare('pt', 'tuple<real, real>');
  ce.declare('U', 'real | list<real>');
  ce.declare('V', 'real | list<real>');
  ce.declare('W', 'real | list<real>');
  ce.declare('P', 'tuple<real, real> | list<tuple<real, real>>');
  ce.declare('T', 'tuple<real, real> | list<real>');
  ce.parse('f(t) := 2t + 1').evaluate();
  ce.declare('w', 'function');
  ce.assign('w', ce.box(['Function', ['Add', ['At', 'p', 1], ['At', 'p', 2]], 'p']));
  return ce;
}

/** The MathJSON of a value: a nested array is a list, a point a tuple. */
function boxed(v: Value, point: boolean): unknown {
  if (!Array.isArray(v)) return v;
  if (point && v.length > 0 && v.every((e) => !Array.isArray(e)))
    return ['Tuple', ...v];
  return ['List', ...v.map((e) => boxed(e, point))];
}

/** The JavaScript value of a number, a list or a tuple of the engine. */
function plain(e: Expression): Value {
  if (e.operator === 'List' || e.operator === 'Tuple')
    return e.ops!.map(plain);
  return e.re;
}

/**
 * The value that the interpreter gives for `expr` with the inputs `vars`.
 * An input in `points` holds points: its innermost arrays are tuples.
 */
function interpreted(
  ce: ComputeEngine,
  expr: Expression,
  vars: Record<string, Value>,
  points: ReadonlyArray<string> = []
): Value {
  const subs: Record<string, Expression> = {};
  for (const [name, v] of Object.entries(vars))
    subs[name] = ce.box(boxed(v, points.includes(name)) as any);
  return plain(expr.subs(subs).evaluate());
}

/**
 * The diagnostic code of the decline of `expr` on `to`, with no fallback:
 * a target throws the decline or returns it. `undefined` when the
 * compilation succeeds.
 */
function declineCode(
  expr: Expression,
  to: 'javascript' | 'interval-js' | 'python'
): string | undefined {
  try {
    const r = compile(expr, { to, fallback: false });
    return r.success ? undefined : (r.diagnostic?.code ?? '');
  } catch (e) {
    return (e as { diagnostic?: { code?: string } }).diagnostic?.code ?? '';
  }
}

/** The number of each point interval of an interval-js result. */
function fromIntervals(r: any): Value {
  if (Array.isArray(r)) return r.map(fromIntervals);
  expect(r.kind).toBe('interval');
  expect(r.value.lo).toBe(r.value.hi);
  return r.value.lo;
}

describe('CE-712.2: an input declared with a union of shapes', () => {
  // name, expression, the inputs for each member, the inputs that hold
  // points
  const CASES: [string, unknown, Record<string, Value>[], string[]][] = [
    ['f(U)', ['f', 'U'], [{ U: [1, 2] }, { U: 3 }, { U: [] }], []],
    ['U + 1', ['Add', 'U', 1], [{ U: [1, 2] }, { U: -0.5 }], []],
    ['2U', ['Multiply', 2, 'U'], [{ U: [4, 5, 6] }, { U: 7 }], []],
    [
      'U + V',
      ['Add', 'U', 'V'],
      [
        { U: [1, 2], V: [10, 20] },
        { U: [1, 2], V: 5 },
        { U: 5, V: [1, 2] },
        { U: 2, V: 3 },
      ],
      [],
    ],
  ];

  test.each(CASES)('javascript: %s', (_name, json, inputs, points) => {
    const ce = engine();
    const expr = ce.box(json as any);
    const r = compile(expr, { fallback: false });
    expect(r.success).toBe(true);
    for (const vars of inputs)
      expect(r.run!(vars as any)).toEqual(interpreted(ce, expr, vars, points));
  });

  test.each(CASES)('interval-js: %s', (_name, json, inputs, points) => {
    const ce = engine();
    const expr = ce.box(json as any);
    const r = compile(expr, { to: 'interval-js', fallback: false });
    expect(r.success).toBe(true);
    for (const vars of inputs)
      expect(fromIntervals(r.run!(vars as any))).toEqual(
        interpreted(ce, expr, vars, points)
      );
  });

  test('the code tests the shape of the input once, at the entry', () => {
    const ce = engine();
    const r = compile(ce.box(['Add', 'U', 1]), { fallback: false });
    expect(r.code).toBe(
      '(Array.isArray(_.U) ? _SYS.bcast((_tv1, _tv2) => (_tv1 + _tv2), _.U, 1) : _.U + 1)'
    );
    const i = compile(ce.box(['Add', 'U', 1]), {
      to: 'interval-js',
      fallback: false,
    });
    expect(i.code).toBe(
      '(Array.isArray(_.U) ? _IA.bcast((_tv1) => _IA.add(_tv1, _k1), _.U) : _IA.add(_.U, _k1))'
    );
  });

  test('w(P): a point or a list of points at a function declared `function`', () => {
    const ce = engine();
    const expr = ce.box(['w', 'P']);
    const r = compile(expr, { fallback: false });
    expect(r.success).toBe(true);
    // The member `list<tuple<…>>` maps `w` over the points; the empty
    // list is a list of points, since a point is never empty.
    expect(r.code).toBe(
      '((_.P.length === 0 || Array.isArray(_.P[0])) ? ' +
        '((_tv1) => _tv1.map((_tv2) => _fn_w(_tv2)))(_.P) : ' +
        '_SYS.at(_.P, 1) + _SYS.at(_.P, 2))'
    );
    for (const P of [[[1, 2], [3, 4]], [1, 2], []] as Value[])
      expect(r.run!({ P } as any)).toEqual(
        interpreted(ce, expr, { P }, ['P'])
      );
    expect(interpreted(ce, expr, { P: [[1, 2], [3, 4]] }, ['P'])).toEqual([
      3, 7,
    ]);
  });

  test('w(P) on interval-js: the map over a list of points declines', () => {
    // interval-js does not map a function over a list of points, so the
    // member `list<tuple<…>>` declines. Before, the code gave the whole
    // real line for `P = [(1, 2), (3, 4)]`.
    const ce = engine();
    expect(declineCode(ce.box(['w', 'P']), 'interval-js')).toBeDefined();
  });

  test('a list of points at a parameter that the body infers as a point', () => {
    // The same call with an input declared `list<tuple<real, real>>`: the
    // interpreter maps `w` over the points. Before, the call was inlined
    // with the list in place of `p`, and the code added the two points:
    // `[4, 6]`.
    const ce = engine();
    const expr = ce.box(['w', 'Q']);
    const r = compile(expr, { fallback: false });
    expect(r.success).toBe(true);
    expect(r.run!({ Q: [[1, 2], [3, 4]] } as any)).toEqual([3, 7]);
    expect(interpreted(ce, expr, { Q: [[1, 2], [3, 4]] }, ['Q'])).toEqual([
      3, 7,
    ]);
  });

  test('python: the code tests the shape of the input once', () => {
    const ce = engine();
    const r = compile(ce.box(['Add', 'U', 1]), {
      to: 'python',
      fallback: false,
    });
    expect(r.success).toBe(true);
    expect(r.code).toBe(
      "([_tv1 + 1 for _tv1 in U] if hasattr(U, '__len__') else U + 1)"
    );
  });

  const runPython = TEST_PYTHON === undefined ? test.skip : test;
  runPython('python: the run gives the interpreter values', () => {
    const ce = engine();
    const expr = ce.box(['Multiply', 2, ['Add', 'U', 1]]);
    const code = new PythonTarget().compileFunction(expr, 'g', ['U']);
    const inputs: Value[] = [[1, 2, 3], 4, []];
    const script =
      `import math\n${code}\n` +
      inputs
        .map((U) => `print(repr(g(${JSON.stringify(U)})).replace(' ', ''))`)
        .join('\n');
    const lines = execFileSync(TEST_PYTHON!, ['-c', script], {
      encoding: 'utf-8',
    })
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    expect(lines).toEqual(inputs.map((U) => interpreted(ce, expr, { U })));
  });

  test('an input declared `broadcastable<real>` is not dispatched', () => {
    // `broadcastable<T>` asks for the element-wise map of the operators,
    // not for one body per shape.
    const ce = engine();
    ce.declare('B', 'broadcastable<real>');
    const r = compile(ce.box(['Add', 'B', 1]), { fallback: false });
    expect(r.success).toBe(true);
    expect(r.code).not.toContain('Array.isArray(_.B)');
  });
});

describe('CE-712.2: the declines of a declared union', () => {
  test.each(['javascript', 'interval-js', 'python'] as const)(
    '%s: no run-time test tells the members apart',
    (to) => {
      // A point of two reals and a list of two reals are both `[a, b]`.
      const ce = engine();
      const expr = ce.box(['Add', ['At', 'T', 1], 1]);
      expect(declineCode(expr, to)).toBe('union-dispatch');
      expect(compile(expr, { to }).unsupported).toContain('T');
    }
  );

  test.each(['javascript', 'interval-js', 'python'] as const)(
    '%s: more than four bodies',
    (to) => {
      // Three inputs of two members each need eight bodies.
      const ce = engine();
      const expr = ce.box(['Add', 'U', 'V', 'W']);
      expect(declineCode(expr, to)).toBe('union-dispatch');
      const { unsupported } = compile(expr, { to });
      expect(unsupported).toEqual(expect.arrayContaining(['U', 'V', 'W']));
    }
  );
});

describe('CE-712.2: a parameter declared with a union of shapes', () => {
  function withFunctions(): ComputeEngine {
    const ce = engine();
    const def = (name: string, signature: string, body: unknown) => {
      ce.declare(name, signature);
      ce.assign(name, ce.box(['Function', body as any, 'z']));
    };
    def('kk', '(number | list<number>) -> unknown', [
      'Add',
      ['Multiply', 2, 'z'],
      1,
    ]);
    def('kp', '(tuple<real, real> | list<tuple<real, real>>) -> unknown', [
      'Add',
      ['At', 'z', 1],
      ['At', 'z', 2],
    ]);
    def('k', '(number | list<number>) -> number', ['Length', 'z']);
    def('kn', '(tuple<real, real> | list<real>) -> unknown', [
      'Multiply',
      2,
      'z',
    ]);
    return ce;
  }

  test.each(['javascript', 'interval-js'] as const)(
    '%s: one variant per member, and a dispatcher',
    (to) => {
      const ce = withFunctions();
      const expr = ce.box(['kk', 'L']);
      const r = compile(expr, { to, fallback: false });
      expect(r.success).toBe(true);
      expect(r.preamble).toContain('const _fn_kk$list = ');
      expect(r.preamble).toContain('const _fn_kk$scalar = ');
      expect(r.preamble).toContain(
        'const _fn_kk = (_tv1) => (Array.isArray(_tv1) ? _fn_kk$list(_tv1) : _fn_kk$scalar(_tv1));'
      );
      const value = r.run!({ L: [1, 2, 5] } as any);
      expect(to === 'javascript' ? value : fromIntervals(value)).toEqual(
        interpreted(ce, expr, { L: [1, 2, 5] })
      );
    }
  );

  test.each(['javascript', 'interval-js'] as const)(
    '%s: each member gives the interpreter value',
    (to) => {
      const ce = withFunctions();
      for (const [json, vars, points] of [
        [['kk', 'x'], { x: 3 }, []],
        [['kk', 'L'], { L: [] }, []],
        [['kp', 'pt'], { pt: [1, 2] }, ['pt']],
      ] as [unknown, Record<string, Value>, string[]][]) {
        const expr = ce.box(json as any);
        const r = compile(expr, { to, fallback: false });
        expect(r.success).toBe(true);
        const value = r.run!(vars as any);
        expect(to === 'javascript' ? value : fromIntervals(value)).toEqual(
          interpreted(ce, expr, vars, points)
        );
      }
    }
  );

  test('javascript: a list of points binds whole at a declared union', () => {
    // The parameter admits the list, so the interpreter binds it whole,
    // and `z[1] + z[2]` adds the first two points.
    const ce = withFunctions();
    const expr = ce.box(['kp', 'Q']);
    const r = compile(expr, { fallback: false });
    expect(r.success).toBe(true);
    expect(r.preamble).toContain(
      'const _fn_kp = (_tv1) => ((_tv1.length === 0 || Array.isArray(_tv1[0])) ? _fn_kp$list(_tv1) : _fn_kp$tuple(_tv1));'
    );
    const Q = [
      [1, 2],
      [3, 4],
    ];
    expect(r.run!({ Q } as any)).toEqual(interpreted(ce, expr, { Q }, ['Q']));
    expect(interpreted(ce, expr, { Q }, ['Q'])).toEqual([4, 6]);
  });

  test('a variant that the target cannot compile: the fallback value', () => {
    // `Length` of a number is an error in the interpreter, and its variant
    // for the member `number` does not compile, so the definition of `k`
    // declines. The fallback gives the interpreter value.
    const ce = withFunctions();
    const expr = ce.box(['k', 'L']);
    expect(compile(expr).run!({ L: [1, 2, 5] } as any)).toBe(3);
  });

  test('no run-time test tells the members of a parameter apart', () => {
    // A point of two reals and a list of two reals are both `[a, b]`, so
    // the function keeps one definition for both members, and a call with
    // a settled argument gives the interpreter value.
    const ce = withFunctions();
    const expr = ce.box(['kn', 'L']);
    const r = compile(expr, { fallback: false });
    expect(r.success).toBe(true);
    expect(r.preamble).not.toContain('_fn_kn$');
    expect(r.run!({ L: [1, 2, 5] } as any)).toEqual(
      interpreted(ce, expr, { L: [1, 2, 5] })
    );
  });
});

describe('CE-712.2: absent values and deeper lists at a declared union', () => {
  // `f: (real) -> real`, so the interpreter maps the call over a list.
  function absentEngine(type: string): ComputeEngine {
    const ce = new ComputeEngine();
    ce.declare('f', { signature: '(real) -> real' });
    ce.assign('f', ce.parse('t \\mapsto 2t+1'));
    ce.declare('L', type);
    return ce;
  }

  /** The interpreter value of `f(L)` for the MathJSON value `value` of `L`. */
  function interpretedWith(type: string, value: unknown): unknown {
    const ce = absentEngine(type);
    ce.assign('L', ce.box(value as any));
    const r = ce.parse('f(L)').evaluate();
    return r.isNaN ? NaN : plain(r);
  }

  // A declared type cannot name `missing` (`docs/ERROR-MODEL.md`, "`Missing`
  // is a result only"), so a declared union has no absent member.
  test('a union with a `missing` member cannot be declared', () => {
    expect(() => absentEngine('list<real> | list<list<real>> | missing')).toThrow(
      /cannot be declared/
    );
  });

  test('three depths: a scalar, a list and a list of lists', () => {
    const type = 'real | list<real> | list<list<real>>';
    const r = compile(absentEngine(type).parse('f(L)'), { fallback: false });
    expect(r.success).toBe(true);
    for (const v of [3, [1, 2], [[1], [2, 3]], []] as Value[])
      expect(r.run!({ L: v } as any)).toEqual(
        interpretedWith(type, boxed(v, false))
      );
  });

  test.each(['javascript', 'interval-js', 'python'] as const)(
    '%s: a list of lists with an empty first row and a list of depth 3 decline',
    (to) => {
      // `[[], [1, 2]]` is a value of `list<list<real>>`, and the test of
      // the first element reads its empty first row as a value of depth 3:
      // the rank-3 map read 1 and 2 as lists.
      const type = 'list<list<real>> | list<list<list<real>>>';
      const ce = absentEngine(type);
      expect(declineCode(ce.parse('f(L)'), to)).toBe('union-dispatch');
      if (to !== 'javascript') return;
      const r = compile(ce.parse('f(L)'));
      const v: Value = [[], [1, 2]];
      expect(interpretedWith(type, boxed(v, false))).toEqual([[], [3, 5]]);
      // The fallback evaluates with the interpreter, and can return an
      // expression.
      const out: any = r.run!({ L: v } as any);
      expect(out?.operator ? plain(out) : out).toEqual([[], [3, 5]]);
    }
  );
});

describe('CE-712.2: `nothing` in a declared union of a list and a number', () => {
  // A list never holds `Nothing` (`[1, Nothing, 2]` is `[1, 2]`), so a
  // `nothing` element does not change the array nesting of the list
  // member, and a number and a list are told apart at run time. A
  // `nothing` member of the union has no compiled value, and asks for no
  // body.
  function nothingEngine(type: string): ComputeEngine {
    const ce = new ComputeEngine();
    ce.parse('f(t) := 2t + 1').evaluate();
    ce.declare('x', type);
    return ce;
  }

  // type, the values of `x`: one for each member
  const CASES: [string, Value[]][] = [
    ['list<integer | nothing> | integer', [[1, 2], 3, []]],
    ['list<real | nothing> | real', [[1.5, 2], -0.5]],
    ['list<integer> | integer | nothing', [[1, 2], 3]],
  ];

  test.each(CASES)('javascript: x: %s', (type, values) => {
    for (const src of ['f(x)', 'x + 1']) {
      const ce = nothingEngine(type);
      const expr = ce.parse(src);
      const r = compile(expr, { fallback: false });
      expect(r.success).toBe(true);
      for (const v of values)
        expect(r.run!({ x: v } as any)).toEqual(
          interpreted(ce, expr, { x: v })
        );
    }
  });

  test.each(CASES)('interval-js: f(x) with x: %s', (type, values) => {
    const ce = nothingEngine(type);
    const expr = ce.parse('f(x)');
    const r = compile(expr, { to: 'interval-js', fallback: false });
    expect(r.success).toBe(true);
    for (const v of values)
      expect(fromIntervals(r.run!({ x: v } as any))).toEqual(
        interpreted(ce, expr, { x: v })
      );
  });

  const runPython = TEST_PYTHON === undefined ? test.skip : test;
  runPython('python: x + 1 with x: list<integer> | integer | nothing', () => {
    const ce = nothingEngine('list<integer> | integer | nothing');
    const expr = ce.parse('x + 1');
    const code = new PythonTarget().compileFunction(expr, 'g', ['x']);
    const inputs: Value[] = [[1, 2], 3];
    const script =
      `import math\n${code}\n` +
      inputs
        .map((x) => `print(repr(g(${JSON.stringify(x)})).replace(' ', ''))`)
        .join('\n');
    const lines = execFileSync(TEST_PYTHON!, ['-c', script], {
      encoding: 'utf-8',
    })
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    expect(lines).toEqual(inputs.map((x) => interpreted(ce, expr, { x })));
  });

  test.each(['javascript', 'interval-js', 'python'] as const)(
    '%s: the decline names the members that are the same array',
    (to) => {
      const ce = engine();
      const r = compile(ce.box(['Add', ['At', 'T', 1], 1]), { to });
      expect(r.success).toBe(false);
      expect(r.error).toContain(
        'the values of `tuple<real, real>` and of `list<real>` are arrays of the same nesting'
      );
    }
  );
});
