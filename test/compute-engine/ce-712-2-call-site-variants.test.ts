/**
 * CE-712.2, phase B: at a direct call of a user function, of a block-local
 * function or of an applied function literal, the static type of each
 * argument selects the call at compile time. The code tests no shape of a
 * value at run time:
 *
 * - a scalar argument: the direct call, `_fn_f(_.x)`;
 * - a list argument at a scalar parameter: a static map whose depth is the
 *   list rank of the argument, `_SYS.mapFn(_fn_f, [1], _.L)` on
 *   JavaScript, `_IA.mapFn(…)` on interval-js, a comprehension on Python;
 * - an argument with no settled shape (a parameter declared `any`): the
 *   call declines, and the interpreter fallback names the argument in
 *   `unsupported` (rule R3).
 *
 * Before, the JavaScript call tested the value with `Array.isArray` or
 * `_SYS.bcastFn` when a scalar proof failed, for example at every call
 * whose argument was mapped through `vars`.
 *
 * Design: `docs/scratch/2026-10-31-ce712-2-design.md` §3.1 and §4, rules R2
 * and R3 of `docs/plans/2026-10-31-static-shape-compilation.md`.
 */

import { execFileSync } from 'node:child_process';
import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { TEST_PYTHON } from './test-python';

type Value = number | Value[];

/** `f := t ↦ 2t + 1`, `x, y: real`, `L: list<real>`,
 * `M: list<list<real>>`, `n: integer`. */
function engine(): ComputeEngine {
  const ce = new ComputeEngine();
  ce.declare('x', 'real');
  ce.declare('y', 'real');
  ce.declare('L', 'list<real>');
  ce.declare('M', 'list<list<real>>');
  ce.declare('n', 'integer');
  ce.declare('f', 'function');
  ce.assign('f', ce.box(['Function', ['Add', ['Multiply', 2, 't'], 1], 't']));
  ce.declare('gd', {
    signature: '(x: T) -> T where T: number',
  } as any);
  ce.assign('gd', ce.box(['Function', ['Multiply', 2, 'x'], 'x']));
  return ce;
}

const VARS: Record<string, Value> = {
  x: 2,
  y: -0.5,
  L: [1, 2, 3],
  M: [[1, 2], [3]],
  n: 2,
};

/** The MathJSON of a value: a nested array is a list. */
function boxed(v: Value): unknown {
  return Array.isArray(v) ? ['List', ...v.map(boxed)] : v;
}

/** The JavaScript value of a number or a list of the engine. */
function plain(e: Expression): Value {
  if (e.operator === 'List') return e.ops!.map(plain);
  return e.re;
}

function interpreted(ce: ComputeEngine, expr: Expression): Value {
  const subs: Record<string, Expression> = {};
  for (const [name, v] of Object.entries(VARS))
    subs[name] = ce.box(boxed(v) as any);
  return plain(expr.subs(subs).evaluate());
}

function fromIntervals(r: any): Value {
  if (Array.isArray(r)) return r.map(fromIntervals);
  expect(r.kind).toBe('interval');
  expect(r.value.lo).toBeCloseTo(r.value.hi, 12);
  return r.value.lo;
}

function expectClose(actual: Value, expected: Value): void {
  if (Array.isArray(expected)) {
    expect(Array.isArray(actual)).toBe(true);
    expect((actual as Value[]).length).toBe(expected.length);
    expected.forEach((e, i) => expectClose((actual as Value[])[i], e));
  } else expect(actual).toBeCloseTo(expected, 12);
}

/** The value of the Python code of `expr` with the inputs of `VARS`. */
function pythonValue(code: string, names: string[]): Value {
  const assign = names.map((k) => `${k} = ${JSON.stringify(VARS[k])}`);
  const script = [
    'import json, math',
    ...assign,
    `print(json.dumps(${code}))`,
  ].join('\n');
  return JSON.parse(
    execFileSync(TEST_PYTHON!, ['-c', script], { encoding: 'utf8' })
  );
}

const Q = ['Assign', 'q', ['Function', ['Multiply', 3, 's'], 's']];

// Rows of design §4 for phase B: label, MathJSON, the code expected on
// javascript, the targets that compile it.
const ROWS: [string, unknown, string | undefined, string[]][] = [
  ['row 2: f(x)', ['f', 'x'], '_fn_f(_.x)', ['javascript', 'interval-js']],
  [
    'row 3: f(L[n])',
    ['f', ['At', 'L', 'n']],
    '_fn_f(_SYS.atNumeric(_.L, _.n, "real"))',
    ['javascript', 'interval-js'],
  ],
  ['row 5: gd(x), a generic callee', ['gd', 'x'], '_fn_gd(_.x)', ['javascript']],
  [
    'row 6: f(L)',
    ['f', 'L'],
    '_SYS.mapFn(_fn_f, [1], _.L)',
    ['javascript', 'interval-js'],
  ],
  [
    'row 7: f(M)',
    ['f', 'M'],
    '_SYS.mapFn(_fn_f, [2], _.M)',
    ['javascript', 'interval-js'],
  ],
  [
    'f(L) + f(x)',
    ['Add', ['f', 'L'], ['f', 'x']],
    undefined,
    ['javascript', 'interval-js'],
  ],
  [
    'row 12: Apply(t ↦ 2t, L)',
    ['Apply', ['Function', ['Multiply', 2, 't'], 't'], 'L'],
    '_SYS.mapFn((((t) => 2 * t)), [1], _.L)',
    ['javascript', 'python'],
  ],
  [
    'Apply((t, s) ↦ t + s, M, x)',
    ['Apply', ['Function', ['Add', 't', 's'], 't', 's'], 'M', 'x'],
    '_SYS.mapFn((((t, s) => s + t)), [2, 0], _.M, _.x)',
    ['javascript', 'python'],
  ],
  [
    'row 14: Block(q ≔ s ↦ 3s, q(L))',
    ['Block', Q, ['q', 'L']],
    undefined,
    ['javascript', 'interval-js', 'python'],
  ],
  [
    'row 15: Block(q ≔ s ↦ 3s, q(x) + q(y))',
    ['Block', Q, ['Add', ['q', 'x'], ['q', 'y']]],
    undefined,
    ['javascript', 'interval-js', 'python'],
  ],
];

describe('CE-712.2: the static type of an argument selects the call', () => {
  test.each(ROWS)('%s', (_label, json, code, targets) => {
    const ce = engine();
    const expr = ce.box(json as any);
    const expected = interpreted(ce, expr);
    for (const to of targets) {
      const r = compile(expr, { to: to as any, fallback: false });
      expect(r.success).toBe(true);
      expect(r.code).not.toContain('Array.isArray');
      expect(r.code).not.toContain('bcastFn');
      if (to === 'javascript') {
        if (code !== undefined) expect(r.code).toBe(code);
        expectClose(r.run!(VARS as any) as Value, expected);
      } else if (to === 'interval-js')
        expectClose(fromIntervals(r.run!(VARS as any)), expected);
      else if (TEST_PYTHON !== undefined) {
        // The root of a Python compilation can be a block of statements;
        // only an expression is evaluated here.
        if (!r.code.includes('\n'))
          expectClose(pythonValue(r.code, Object.keys(VARS)), expected);
      }
    }
  });

  test('row 15: the block-local call has the result type of its body', () => {
    const ce = engine();
    const r = compile(ce.box(['Block', Q, ['Add', ['q', 'x'], ['q', 'y']]]), {
      fallback: false,
    });
    expect(r.code).toContain('return q(_.x) + q(_.y)');
  });

  test('python: the block-local call over a list is a comprehension', () => {
    const ce = engine();
    const r = compile(ce.box(['Block', Q, ['q', 'L']]), {
      to: 'python',
      fallback: false,
    });
    expect(r.success).toBe(true);
    expect(r.code).toContain('[q(');
    expect(r.code).toContain(' for ');
  });
});

describe('CE-712.2: an argument with no settled shape declines (R3)', () => {
  test('a parameter of the root function declared `any`', () => {
    const ce = engine();
    const expr = ce.box(['Function', ['f', 'a'], ['Typed', 'a', "'any'"]]);
    expect(() => compile(expr, { fallback: false })).toThrow(
      /does not settle one shape/
    );
    const r = compile(expr);
    expect(r.success).toBe(false);
    expect(r.unsupported).toContain('a');
  });

  test('a block-local call over a parameter declared `any`', () => {
    const ce = engine();
    const expr = ce.box([
      'Function',
      ['Block', Q, ['q', 'a']],
      ['Typed', 'a', "'any'"],
    ]);
    const r = compile(expr);
    expect(r.success).toBe(false);
    expect(r.unsupported).toContain('a');
  });
});

describe('CE-712.2: the Tycho nested call of design §7', () => {
  test('no run-time shape test with `vars`', () => {
    // `f`, `g`, `I` declared `(unknown, …) -> unknown`, then assigned a
    // literal whose body was canonicalized with each parameter declared
    // `broadcastable<number | tuple>`, as Tycho does
    // (`declareDefinitionHead()`). Every input is declared `real`.
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    ce.declare('y', 'real');
    const register = (name: string, params: string[], body: unknown) => {
      ce.declare(name, {
        signature: `(${params.map(() => 'unknown').join(', ')}) -> unknown`,
      });
      ce.pushScope();
      for (const p of params)
        ce.declare(p, { type: 'broadcastable<number | tuple>' });
      const json = ce.expr(body as any, { form: 'structural' }).canonical.json;
      ce.popScope();
      ce.assign(name, ce.box(['Function', json, ...params]));
    };
    register('f', ['u'], ['Add', 'u', 1]);
    register('g', ['a', 'b'], ['Add', ['f', 'a'], ['f', 'b']]);
    register('I', ['u'], ['Multiply', 2, 'u']);
    const expr = ce.box(['I', ['Sqrt', ['g', 'x', 'y']]]);
    const r = compile(expr, {
      fallback: false,
      vars: { x: '_.x', y: '_.y' },
      broadcast: true,
      mode: 'strict',
    } as any);
    expect(r.success).toBe(true);
    const text = `${r.preamble ?? ''}\n${r.code}`;
    expect(text).not.toContain('Array.isArray');
    expect(text).not.toContain('bcastFn');
    expect(r.run!({ x: 1, y: 2 })).toBeCloseTo(
      expr.subs({ x: ce.number(1), y: ce.number(2) }).N().re,
      12
    );
  });
});

describe('CE-712.2: a parameter declared with a union of shapes', () => {
  function unionEngine(signature: string, body: unknown): ComputeEngine {
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    ce.declare('L', 'list<real>');
    ce.declare('U', 'real | list<real>');
    ce.declare('Q', 'matrix<2x2>');
    ce.declare('k', signature);
    ce.assign('k', ce.box(['Function', body, 'z'] as any));
    return ce;
  }

  test('a settled argument calls the member variant, with no test (D8)', () => {
    const ce = unionEngine('(number | list<number>) -> number', [
      'Add',
      ['Multiply', 2, 'z'],
      1,
    ]);
    expect(compile(ce.box(['k', 'x']), { fallback: false }).code).toBe(
      '_fn_k$scalar(_.x)'
    );
    expect(compile(ce.box(['k', 'L']), { fallback: false }).code).toBe(
      '_fn_k$list(_.L)'
    );
  });

  test('a body of the input dispatch calls the member variant, once', () => {
    // The input `U` is narrowed in each body: the scalar body calls
    // `_fn_k$scalar` and the list body `_fn_k$list`, not the dispatcher
    // `_fn_k`, so the shape is tested once. No copy `_fn_k_number` repeats
    // the scalar variant.
    const ce = unionEngine('(number | list<number>) -> number', [
      'Add',
      ['Multiply', 2, 'z'],
      1,
    ]);
    const expr = ce.box(['k', 'U']);
    const r = compile(expr, { fallback: false });
    expect(r.code).toBe(
      '(Array.isArray(_.U) ? _fn_k$list(_.U) : _fn_k$scalar(_.U))'
    );
    expect(r.preamble ?? '').not.toContain('_fn_k_number');
    for (const U of [3, [1, 2]] as Value[]) {
      const value = r.run!({ U } as any) as Value;
      const expected = plain(expr.subs({ U: ce.box(boxed(U) as any) }).evaluate());
      expectClose(value, expected);
    }
  });

  test('a member whose copy cannot be built is left out', () => {
    // With `z: number`, the copy of `z ↦ MatrixMultiply(z, z)` cannot be
    // built. Before, the compilation declined with "its variant for the
    // parameter types (number) could not be built", before the fallback to
    // the ordinary definition could run. Now the member is left out, and
    // with fewer than two members the ordinary definition is compiled: it
    // declines for its own reason, and the interpreter gives the value.
    const ce = unionEngine('(matrix<2x2> | number) -> any', [
      'MatrixMultiply',
      'z',
      'z',
    ]);
    const expr = ce.box(['k', 'Q']);
    let message = '';
    try {
      compile(expr, { fallback: false });
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).not.toMatch(/could not be built/);
    const r = compile(expr);
    expect(r.run!({ Q: [[1, 2], [3, 4]] } as any)).toBeDefined();
  });
});

describe('CE-712.2: a bound variable holds one scalar', () => {
  // The engine types an integration variable, and the index of a `Sum`
  // or a `Product`, `unknown`. Each holds one number at each sample or
  // turn of the loop, so a call `w(t)` of a function with scalar
  // parameters on it is the direct call. Before, the call declined: "the
  // argument t has the type unknown".
  function boundEngine(): ComputeEngine {
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    ce.declare('n', 'integer');
    // `Γ(t + 1)` has no antiderivative, so the integral compiles by
    // quadrature, with the call in its integrand.
    ce.assign('w', ce.parse('t \\mapsto \\Gamma(t + 1)'));
    return ce;
  }

  test.each([
    ['\\int_0^x w(t)\\,dt'],
    ['\\int_0^x\\int_0^{w(t)} w(t u)\\,du\\,dt'],
    ['\\sum_{i=1}^{n} w(i)'],
    ['\\prod_{i=1}^{n} w(0.5 i)'],
  ])('%s', (latex) => {
    const ce = boundEngine();
    const expr = ce.parse(latex);
    const expected = expr
      .subs({ x: ce.number(1.5), n: ce.number(4) })
      .N().re;
    expect(Number.isFinite(expected)).toBe(true);
    const js = compile(expr, { to: 'javascript', fallback: false });
    expect(js.success).toBe(true);
    expect(js.code).toContain('_fn_w(');
    expect(js.code).not.toContain('mapFn');
    expect(js.code).not.toContain('Array.isArray');
    expect(js.run!({ x: 1.5, n: 4 }) as number).toBeCloseTo(expected, 6);
    const ia = compile(expr, { to: 'interval-js', fallback: false });
    expect(ia.success).toBe(true);
    expect(ia.code).not.toContain('mapFn');
    const v = ia.run!({ x: 1.5, n: 4 }) as any;
    expect(v.kind).toBe('interval');
    expect(v.value.lo).toBeLessThanOrEqual(expected + 1e-9);
    expect(v.value.hi).toBeGreaterThanOrEqual(expected - 1e-9);
  });
});

describe('CE-712.2: an absent value at a mapped level', () => {
  // An input whose declared type admits an absent value or an absent
  // element (`list<real> | missing`, `list<list<real> | missing>`) is
  // refused at its declaration: `Missing` is a result only
  // (`docs/ERROR-MODEL.md`, user decision of 2026-11-02). The compiled map
  // over such an input is not reached.
  test('a declared input cannot name missing', () => {
    const ce = new ComputeEngine();
    expect(() => ce.declare('L', 'list<real> | missing')).toThrow(
      /cannot be declared/
    );
    expect(() => ce.declare('LL', 'list<list<real> | missing>')).toThrow(
      /cannot be declared/
    );
  });
});

describe('CE-712.2: a map over the NaN of a length mismatch', () => {
  // `h(L, M)` with lists of different lengths is the `incompatible-
  // dimensions` error of the interpreter, which the JavaScript map spells
  // `NaN`. The map of `f` over that value gives `NaN` too. Before, the map
  // read the length of `NaN` and gave `[undefined]`.
  test('f(h(L, M)) with L = [1, 2] and M = [1, 2, 3]', () => {
    const ce = new ComputeEngine();
    ce.declare('L', 'list<real>');
    ce.declare('M', 'list<real>');
    ce.assign('f', ce.box(['Function', ['Multiply', 2, 't'], 't']));
    ce.assign('h', ce.box(['Function', ['Add', 'a', 'b'], 'a', 'b']));
    const vars = { L: [1, 2], M: [1, 2, 3] };
    const inner = compile(ce.box(['h', 'L', 'M']), { fallback: false });
    expect(inner.success).toBe(true);
    expect(inner.run!(vars as any)).toBeNaN();
    const r = compile(ce.box(['f', ['h', 'L', 'M']]), { fallback: false });
    expect(r.success).toBe(true);
    expect(r.code).toContain('_SYS.mapFn(_fn_f, [1], ');
    expect(r.run!(vars as any)).toBeNaN();
  });
});
