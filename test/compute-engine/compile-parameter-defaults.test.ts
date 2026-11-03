// Compilation of function literals and user functions with a parameter with
// a default value, `(x, k = 2) => x * k`, spelled
// `["Function", body, "x", ["Optional", "k", 2]]` (GitHub issue #490).
//
// Spec: docs/plans/2026-10-31-parameter-default-values.md, R8 and §7 item 9.
//
// A default fills an absent argument as it fills an argument that the call
// leaves out: `(k: real = 2) ↦ k` gives 2 for `f()`, `f(Missing)`
// and `f(At(L, 100))`. The test of absence is the one of `Coalesce`:
// `Missing`, `Undefined`, `NaN` and `Indeterminate` in the interpreter;
// `undefined`, `null` and `NaN` in compiled JavaScript; `None` and a float or
// complex `NaN` in compiled Python. So the compiled code fills a default in
// the body, not with a native default parameter, which fills only an
// argument that is left out (R6 of
// docs/plans/2026-11-01-absent-value-contract.md).

import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { executeEpsil } from '../../src/epsil/execute-epsil';
import { TEST_PYTHON } from './test-python';

type Json = any;

/** `(x, k = d) => body`, with `x * k` as the default body. */
function defaulted(d: Json, body: Json = ['Multiply', 'x', 'k']): Json {
  return ['Function', body, 'x', ['Optional', 'k', d]];
}

/** `(x, k: number = 2) => k`. A declared type cannot name `missing`
 * (`docs/ERROR-MODEL.md`, "`Missing` is a result only"): the default
 * handles an absent argument. */
const MAYBE_MISSING: Json = [
  'Function',
  'k',
  'x',
  ['Optional', ['Typed', 'k', "'number'"], 2],
];

function run(
  ce: ComputeEngine,
  expr: Json,
  to: string,
  vars: Record<string, unknown> = {}
): { code: string; value: unknown } {
  const options = { to, fallback: false } as any;
  const result: any = compile(ce.box(expr) as any, options);
  expect(result.success).toBe(true);
  return { code: result.code, value: result.run?.(vars) };
}

/** The compiled JavaScript function of the function literal `lit`. */
function jsFunction(ce: ComputeEngine, lit: Json): any {
  const options = { to: 'javascript', fallback: false } as any;
  return compile(ce.box(lit) as any, options);
}

/** The interpreter's value of `expr` with `values` substituted, as JSON. A
 * `Map` evaluates to a lazy view, whose elements are read here. */
function interpreted(
  ce: ComputeEngine,
  expr: Json,
  values: Record<string, number> = {}
): Json {
  const value = ce.box(expr).subs(values).evaluate();
  if (value.operator !== 'Map') return value.json;
  return ['List', ...JSON.parse(value.toString())];
}

/** The point interval `{ lo: v, hi: v }` of an interval-JavaScript result. */
function point(r: unknown): number | undefined {
  const v = (r as any)?.value;
  return v !== undefined && v.lo === v.hi ? v.lo : undefined;
}

describe('COMPILED PARAMETER DEFAULTS: JAVASCRIPT', () => {
  const ce = new ComputeEngine();
  ce.declare('y', 'real');
  ce.declare('d', 'real');

  test('a literal compiled as a function takes one or two arguments', () => {
    const fn: any = jsFunction(ce, defaulted(2));
    expect(fn.success).toBe(true);
    expect(fn.run(3)).toBe(6);
    expect(fn.run(3, 5)).toBe(15);
    expect(interpreted(ce, ['Apply', defaulted(2), 3])).toBe(6);
    expect(interpreted(ce, ['Apply', defaulted(2), 3, 5])).toBe(15);
  });

  test('a parameter whose type cannot hold `Missing` is filled in the body', () => {
    const lit = [
      'Function',
      ['Multiply', 'x', 'k'],
      'x',
      ['Optional', ['Typed', 'k', "'number'"], 2],
    ];
    const fn: any = jsFunction(ce, lit);
    expect(fn.code).toBe(
      '(x, k) => { if (Number.isNaN((k) ?? Number.NaN)) k = 2; return k * x; }'
    );
    expect(fn.run(3)).toBe(6);
    expect(fn.run(3, 5)).toBe(15);
    // `NaN` is absent for the default as for `Coalesce`.
    expect(fn.run(3, NaN)).toBe(6);
  });

  test('`(x, k: number = 2) => k` fills a supplied `Missing`', () => {
    // A default fills an absent argument as it fills an argument that the
    // call leaves out (R6 of docs/plans/2026-11-01-absent-value-contract.md).
    // Before R6, a supplied `Missing` was kept.
    const fn: any = jsFunction(ce, MAYBE_MISSING);
    expect(fn.success).toBe(true);
    // An omitted argument: the default.
    expect(fn.run(3)).toBe(2);
    expect(interpreted(ce, ['Apply', MAYBE_MISSING, 3])).toBe(2);
    // An explicit `Missing` (`undefined` at run time): the default.
    expect(fn.run(3, undefined)).toBe(2);
    expect(interpreted(ce, ['Apply', MAYBE_MISSING, 3, 'Missing'])).toBe(2);
    // An expression that evaluates to `Missing`.
    const firstOfEmpty = ['Apply', MAYBE_MISSING, 'y', ['First', ['List']]];
    expect(interpreted(ce, firstOfEmpty, { y: 1 })).toBe(2);
    expect(run(ce, firstOfEmpty, 'javascript', { y: 1 }).value).toBe(2);
    const written = ['Apply', MAYBE_MISSING, 'y', 'Missing'];
    expect(run(ce, written, 'javascript', { y: 1 }).value).toBe(2);
  });

  test('a function value with a default is filled by a wrapper that tests the absence of the argument', () => {
    // `Map` calls the value with one argument.
    const expr = ['Map', defaulted(2), ['List', 'y', 2]];
    const { code, value } = run(ce, expr, 'javascript', { y: 1 });
    expect(code).toMatch(
      /\(\(_c\) => Number\.isNaN\(_c \?\? Number\.NaN\) \? 2 : _c\)\(_tv\d+\)/
    );
    expect(value).toEqual([2, 4]);
    expect(interpreted(ce, expr, { y: 1 })).toEqual(['List', 2, 4]);
  });

  test('a symbol default is read at each call', () => {
    const expr = ['Map', defaulted('d'), ['List', 'y', 2]];
    expect(run(ce, expr, 'javascript', { y: 1, d: 10 }).value).toEqual([
      10, 20,
    ]);
    expect(run(ce, expr, 'javascript', { y: 1, d: 3 }).value).toEqual([3, 6]);
    expect(interpreted(ce, expr, { y: 1, d: 10 })).toEqual(['List', 10, 20]);
  });

  test('a symbol default inside a function with a parameter of that name reads that parameter', () => {
    // The default behaves as the symbol written in the call that `Map`
    // makes, inside `(d) => …`: it reads the parameter `d`.
    const outer = ['Function', ['Map', defaulted('d'), ['List', 1, 2]], 'd'];
    expect(interpreted(ce, ['Apply', outer, 10])).toEqual(['List', 10, 20]);
    const fn: any = jsFunction(ce, outer);
    expect(fn.run(10)).toEqual([10, 20]);
    const applied = ['Apply', outer, 'y'];
    const { value } = run(ce, applied, 'interval-js', { y: 10 });
    const values = value as unknown[];
    expect(values.map(point)).toEqual([10, 20]);
  });

  test('a collection default is a fresh empty list at each call', () => {
    const lit = [
      'Function',
      'xs',
      ['Optional', ['Typed', 'xs', "'list<number>'"], ['List']],
    ];
    const fn: any = jsFunction(ce, lit);
    expect(fn.success).toBe(true);
    const a = fn.run();
    const b = fn.run();
    expect(a).toEqual([]);
    expect(b).toEqual([]);
    expect(a).not.toBe(b);
    expect(interpreted(ce, ['Apply', lit])).toEqual(['List']);
  });

  test('a dictionary default is a fresh empty object at each call', () => {
    const lit = [
      'Function',
      'm',
      ['Optional', ['Typed', 'm', "'dictionary<integer>'"], ['Dictionary']],
    ];
    const fn: any = jsFunction(ce, lit);
    expect(fn.success).toBe(true);
    expect(fn.code).toBe(
      '(m) => { if (Number.isNaN((m) ?? Number.NaN)) m = ({}); return m; }'
    );
    const a = fn.run();
    const b = fn.run();
    expect(a).toEqual({});
    expect(b).toEqual({});
    expect(a).not.toBe(b);
    expect(interpreted(ce, ['Apply', lit])).toEqual({ dict: {} });
  });

  test('`Map((x, k = 2) => x * k, [1, 2])` is `[2, 4]`', () => {
    const expr = ['Map', defaulted(2), ['List', 1, 2]];
    expect(run(ce, expr, 'javascript').value).toEqual([2, 4]);
    expect(interpreted(ce, expr)).toEqual(['List', 2, 4]);
  });

  test('a saturated application and a partial application completed by a later call', () => {
    for (const expr of [
      ['Apply', defaulted(2), 'y', 5],
      ['Apply', ['Apply', defaulted(2)], 'y'],
    ]) {
      const expected = interpreted(ce, expr, { y: 3 });
      expect(run(ce, expr, 'javascript', { y: 3 }).value).toBe(expected);
    }
  });

  test('a call of a block-local function is completed with the default', () => {
    const expr = ['Block', ['Assign', 'g', defaulted(2)], ['g', 'y']];
    expect(interpreted(ce, expr, { y: 3 })).toBe(6);
    const { code, value } = run(ce, expr, 'javascript', { y: 3 });
    expect(code).toContain('g(_.y, 2)');
    expect(value).toBe(6);
  });
});

describe('COMPILED PARAMETER DEFAULTS: USER FUNCTIONS', () => {
  test('a one-clause user function with a default compiles on the JavaScript target', () => {
    const ce = new ComputeEngine();
    const r = executeEpsil(ce, 'function f(x, k: number = 2) { x * k }');
    expect(r.diagnostics).toEqual([]);
    ce.declare('y', 'real');
    for (const expr of [
      ['f', 'y'],
      ['f', 'y', 5],
      ['Map', 'f', ['List', 'y', 3]],
    ]) {
      const expected = interpreted(ce, expr, { y: 1 });
      const { value } = run(ce, expr, 'javascript', { y: 1 });
      expect(value).toEqual(
        Array.isArray(expected) ? expected.slice(1) : expected
      );
    }
  });

  test('a function assigned from a literal with a default, as a `Map` callback', () => {
    const ce = new ComputeEngine();
    ce.declare('y', 'real');
    ce.assign('f', ce.box(defaulted(2)));
    const expr = ['Map', 'f', ['List', 'y', 2]];
    expect(interpreted(ce, expr, { y: 1 })).toEqual(['List', 2, 4]);
    expect(run(ce, expr, 'javascript', { y: 1 }).value).toEqual([2, 4]);
  });

  test('a default in a clause of a two-clause function is a declaration error', () => {
    const ce = new ComputeEngine();
    const r = executeEpsil(
      ce,
      'function f(n, k = 2) { n }\nfunction f(0, k) { k }\nf(1)'
    );
    expect(
      r.diagnostics.some((d) =>
        String(d.message[1] ?? '').includes(
          'a default value in an overloaded signature is not supported yet'
        )
      )
    ).toBe(true);
  });
});

describe('COMPILED PARAMETER DEFAULTS: PYTHON', () => {
  const ce = new ComputeEngine();
  ce.declare('d', 'real');

  // The absence test of the discharges on the Python target
  // (`PY_ABSENT_TEST`, `python-target.ts`), applied to `k`.
  const absent = (k: string) =>
    `(lambda _c: _c is None or (isinstance(_c, (float, complex, np.floating, np.complexfloating)) and cmath.isnan(_c)))(${k})`;

  test('a value default fills `None` and an absent argument', () => {
    expect(run(ce, defaulted(2), 'python').code).toBe(
      `(lambda x, k=None: (lambda k: k * x)(2 if ${absent('k')} else k))`
    );
  });

  test('a symbol default and a collection default are evaluated at each call', () => {
    expect(run(ce, defaulted('d'), 'python').code).toBe(
      `(lambda x, k=None: (lambda k: k * x)(d if ${absent('k')} else k))`
    );
    const lit = [
      'Function',
      'xs',
      ['Optional', ['Typed', 'xs', "'list<number>'"], ['List']],
    ];
    expect(run(ce, lit, 'python').code).toContain(`[] if ${absent('xs')}`);
  });

  const python = TEST_PYTHON ?? '';
  const pythonTest = fs.existsSync(python) ? test : test.skip;

  pythonTest('the emitted Python agrees with the interpreter', () => {
    const value = run(ce, defaulted(2), 'python').code;
    const symbol = run(ce, defaulted('d'), 'python').code;
    const list = run(
      ce,
      [
        'Function',
        'xs',
        ['Optional', ['Typed', 'xs', "'list<number>'"], ['List']],
      ],
      'python'
    ).code;
    // The binding of `d` changes between the definition of the function and
    // a call that leaves out `k`: the call reads the new value.
    const program = [
      'import json',
      'import cmath',
      'import numpy as np',
      `f = ${value}`,
      'd = 1',
      `g = ${symbol}`,
      'd = 10',
      `h = ${list}`,
      'a = h()',
      'b = h()',
      'print(json.dumps([f(3), f(3, 5), g(3), g(3, 5), a, b, a is not b]))',
    ].join('\n');
    const file = path.join(os.tmpdir(), `ce-py-defaults-${process.pid}.py`);
    fs.writeFileSync(file, program);
    let out = '';
    try {
      out = execFileSync(python, [file], { encoding: 'utf8' });
    } finally {
      fs.unlinkSync(file);
    }
    expect(JSON.parse(out)).toEqual([6, 15, 30, 15, [], [], true]);
    expect(interpreted(ce, ['Apply', defaulted('d'), 3], { d: 10 })).toBe(30);
  });

  pythonTest('a dictionary default is a new empty `dict` at each call', () => {
    const lit = [
      'Function',
      'm',
      ['Optional', ['Typed', 'm', "'dictionary<integer>'"], ['Dictionary']],
    ];
    const program = [
      'import json',
      'import cmath',
      'import numpy as np',
      `h = ${run(ce, lit, 'python').code}`,
      'a = h()',
      'b = h()',
      'print(json.dumps([a, b, a is not b]))',
    ].join('\n');
    const file = path.join(os.tmpdir(), `ce-py-dict-default-${process.pid}.py`);
    fs.writeFileSync(file, program);
    let out = '';
    try {
      out = execFileSync(python, [file], { encoding: 'utf8' });
    } finally {
      fs.unlinkSync(file);
    }
    expect(JSON.parse(out)).toEqual([{}, {}, true]);
    expect(interpreted(ce, ['Apply', lit])).toEqual({ dict: {} });
  });
});

describe('COMPILED PARAMETER DEFAULTS: INTERVAL, GLSL AND WGSL', () => {
  const ce = new ComputeEngine();
  ce.declare('y', 'real');

  const saturated = ['Apply', defaulted(2), 'y', 5];
  // `Apply(lit)` is a partial application (no argument for `x`); the later
  // call supplies `x` only, and the compiler completes it with `k`'s default.
  const completed = ['Apply', ['Apply', defaulted(2)], 'y'];

  test('interval: a saturated call and a completed call agree with the interpreter', () => {
    expect(interpreted(ce, saturated, { y: 3 })).toBe(15);
    expect(interpreted(ce, completed, { y: 3 })).toBe(6);
    expect(point(run(ce, saturated, 'interval-js', { y: 3 }).value)).toBe(15);
    const { code, value } = run(ce, completed, 'interval-js', { y: 3 });
    expect(point(value)).toBe(6);
    // The default is an interval constant, passed at the call site. The
    // literal also fills an argument that a consumer leaves out, with a
    // JavaScript default parameter (`defaultFillingWrapper()`): the interval
    // target does not fill a supplied absent argument.
    expect(code).toBe(
      '(((_tv1) => ((_tv2, _tv3 = _k1) => _tv1(_tv2, _tv3)))(((x, k) => _IA.mul(k, x))))(_.y, _k1)'
    );
  });

  test('interval: a `Map` callback and a block-local call', () => {
    const map = ['Map', defaulted(2), ['List', 'y', 2]];
    const values = run(ce, map, 'interval-js', { y: 3 }).value as unknown[];
    expect(values.map(point)).toEqual([6, 4]);
    expect(interpreted(ce, map, { y: 3 })).toEqual(['List', 6, 4]);
    const local = ['Block', ['Assign', 'g', defaulted(2)], ['g', 'y']];
    expect(point(run(ce, local, 'interval-js', { y: 3 }).value)).toBe(6);
  });

  test('GLSL and WGSL: a saturated call, a completed call and a `Map` callback', () => {
    expect(run(ce, saturated, 'glsl').code).toBe('(5.0 * y)');
    expect(run(ce, completed, 'glsl').code).toBe('(2.0 * y)');
    expect(run(ce, completed, 'wgsl').code).toBe('(2.0 * y)');
    const map = ['Map', defaulted(2), ['List', 'y', 2]];
    expect(run(ce, map, 'glsl').code).toBe('vec2(2.0 * y, 4.0)');
    expect(run(ce, map, 'wgsl').code).toBe('vec2f(2.0 * y, 4.0)');
    const symbol = ['Map', defaulted('y'), ['List', 3, 2]];
    expect(interpreted(ce, symbol, { y: 5 })).toEqual(['List', 15, 10]);
    expect(run(ce, symbol, 'glsl').code).toBe('vec2(3.0 * y, 2.0 * y)');
  });
});

/** The numeric elements of the interpreter's value of `expr`. */
function interpretedValues(
  ce: ComputeEngine,
  expr: Json,
  values: Record<string, number> = {}
): number[] {
  const value = ce.box(expr).subs(values).evaluate();
  return Array.from(value.each(), (e) => e.N().re);
}

describe('COMPILED PARAMETER DEFAULTS: CALLBACKS AND FOLDS', () => {
  test('a hoisted `Map` callback receives only the element', () => {
    const ce = new ComputeEngine();
    ce.declare('a', 'real');
    ce.declare('L', 'list<real>');
    // `Sin(a)` does not depend on the element: the callback is hoisted and
    // bound at its first call. The omitted `k` must receive its default.
    const expr = [
      'Map',
      defaulted(2, ['Add', ['Multiply', 'x', 'k'], ['Sin', 'a']]),
      'L',
    ];
    // The interpreter reads `a` from an engine where it has the value 1
    // (a substitution does not enter the body of a function literal).
    const valued = new ComputeEngine();
    valued.assign('a', 1);
    const expected = interpretedValues(valued, ['Map', expr[1], ['List', 1, 2]]);
    expect(expected).toEqual([2 + Math.sin(1), 4 + Math.sin(1)]);
    const { value } = run(ce, expr, 'javascript', { a: 1, L: [1, 2] });
    expect(Array.from(value as number[])).toEqual(expected);
  });

  test('a default that is a constant list declared in the engine', () => {
    const ce = new ComputeEngine();
    ce.assign('D', ce.box(['List', 1, 2, 3]));
    const lit = [
      'Function',
      'xs',
      ['Optional', ['Typed', 'xs', "'list<number>'"], 'D'],
    ];
    expect(interpreted(ce, ['Apply', lit])).toEqual(['List', 1, 2, 3]);
    const fn: any = jsFunction(ce, lit);
    expect(fn.success).toBe(true);
    expect(fn.run()).toEqual([1, 2, 3]);
    expect(fn.run([4])).toEqual([4]);
    // The `code` field is self-contained: the default reads the definition
    // of `D` that the function body declares first.
    const code = new Function('_SYS', `return ${fn.code}`)(undefined);
    expect(code()).toEqual([1, 2, 3]);
    expect(run(ce, ['Apply', lit], 'javascript').value).toEqual([1, 2, 3]);
  });

  test('a named callback reads a symbol default at the call site', () => {
    const ce = new ComputeEngine();
    ce.declare('d', 'real');
    ce.assign('f', ce.box(defaulted('d')));
    // `ListFrom` reads the elements inside the call, where `d` is the
    // parameter.
    const inner = [
      'Function',
      ['ListFrom', ['Map', 'f', 'xs']],
      'd',
      ['Typed', 'xs', "'list<real>'"],
    ];
    expect(
      interpretedValues(ce, ['Apply', inner, 10, ['List', 1, 2]], { d: 1 })
    ).toEqual([10, 20]);
    const fn: any = jsFunction(ce, inner);
    expect(fn.success).toBe(true);
    expect(Array.from(fn.run(10, [1, 2]))).toEqual([10, 20]);
    expect(Array.from(fn.run(3, [1, 2]))).toEqual([3, 6]);
  });

  test('a callback whose only parameter has a default takes the element', () => {
    const ce = new ComputeEngine();
    ce.declare('y', 'real');
    const lit = ['Function', ['Multiply', 2, 'x'], ['Optional', 'x', 1]];
    const map = ['Map', lit, ['List', 'y', 2]];
    expect(interpreted(ce, map, { y: 3 })).toEqual(['List', 6, 4]);
    expect(run(ce, map, 'javascript', { y: 3 }).value).toEqual([6, 4]);
    const values = run(ce, map, 'interval-js', { y: 3 }).value as unknown[];
    expect(values.map(point)).toEqual([6, 4]);
    expect(run(ce, map, 'glsl').code).toBe('vec2(2.0 * y, 4.0)');
  });

  const combiner = [
    'Function',
    ['Add', 'a', ['Multiply', 'k', 'x']],
    'a',
    'x',
    ['Optional', 'k', 2],
  ];

  test('`Reduce`, `Fold` and `Scan` with a combiner with a default', () => {
    const ce = new ComputeEngine();
    ce.declare('y', 'real');
    for (const expr of [
      ['Reduce', ['List', 'y', 2, 3], combiner, 0],
      ['Fold', combiner, 0, ['List', 'y', 2, 3]],
    ]) {
      expect(interpreted(ce, expr, { y: 1 })).toBe(12);
      expect(run(ce, expr, 'javascript', { y: 1 }).value).toBe(12);
    }
    // `Scan` is a lazy view in the interpreter: its elements are read.
    const scan = ['Scan', ['List', 'y', 2, 3], combiner, 0];
    expect(interpretedValues(ce, scan, { y: 1 })).toEqual([2, 6, 12]);
    expect(run(ce, scan, 'javascript', { y: 1 }).value).toEqual([2, 6, 12]);
  });

  const python = TEST_PYTHON ?? '';
  const pythonTest = fs.existsSync(python) ? test : test.skip;

  pythonTest('Python: `Reduce` and `Scan` with a combiner with a default', () => {
    const ce = new ComputeEngine();
    const reduce = run(ce, ['Reduce', ['List', 1, 2, 3], combiner, 0], 'python');
    const scan = run(ce, ['Scan', ['List', 1, 2, 3], combiner, 0], 'python');
    const out = runPython(python, [
      `print(json.dumps([float(${reduce.code}), [float(v) for v in ${scan.code}]]))`,
    ]);
    expect(out).toEqual([12, [2, 6, 12]]);
    expect(interpreted(ce, ['Reduce', ['List', 1, 2, 3], combiner, 0])).toBe(
      12
    );
  });

  test('Python: the omission marker does not take the name of a parameter', () => {
    const ce = new ComputeEngine();
    const lit = [
      'Function',
      'xs',
      ['Typed', '_ce_omitted', "'number'"],
      ['Optional', ['Typed', 'xs', "'list<number>'"], ['List']],
    ];
    expect(interpreted(ce, ['Apply', lit, 1])).toEqual(['List']);
    const { code } = run(ce, lit, 'python');
    expect(code).not.toContain('xs is _ce_omitted');
    if (fs.existsSync(python))
      expect(runPython(python, [`print(json.dumps((${code})(1)))`])).toEqual(
        []
      );
  });
});

describe('COMPILED PARAMETER DEFAULTS: ARGUMENT COUNT AND DEFINITIONS', () => {
  /** The function that the source `code` evaluates to, given `_SYS`. The
   * code is evaluated in sloppy mode, as a consumer that splices it into a
   * script does. */
  function evaluated(code: string, sys: unknown, preamble = ''): any {
    return new Function('_SYS', `${preamble}return ${code};`)(sys);
  }

  test('a parameter named `arguments` does not hide the argument count', () => {
    const ce = new ComputeEngine();
    const lit = ['Function', 'k', 'arguments', ['Optional', 'k', 2]];
    expect(interpreted(ce, ['Apply', lit, 1])).toBe(2);
    const fn: any = jsFunction(ce, lit);
    expect(fn.run(1)).toBe(2);
    expect(fn.run(1, 5)).toBe(5);
    expect(evaluated(fn.code, fn.run.SYS)(1)).toBe(2);
    expect(evaluated(fn.run.toString(), fn.run.SYS)(1)).toBe(2);
  });

  test('a default of a callback reads an outer parameter named `arguments`', () => {
    const ce = new ComputeEngine();
    const lit = [
      'Function',
      [
        'Map',
        ['Function', ['Multiply', 'x', 'k'], 'x', ['Optional', 'k', 'arguments']],
        ['List', 1, 2],
      ],
      'arguments',
    ];
    expect(interpretedValues(ce, ['Apply', lit, 3])).toEqual([3, 6]);
    expect(jsFunction(ce, lit).run(3)).toEqual([3, 6]);
  });

  test('the fill runs after the definitions that a default reads', () => {
    // The default `D` is a definition (`_val_D`) that the fill reads. The
    // user function `g` is a per-call definition that comes after the fill;
    // its own parameter has the name of the defaulted parameter `k`.
    const ce = new ComputeEngine();
    ce.assign('D', ce.box(['List', 4, 5, 6]));
    ce.assign('g', ce.box(['Function', ['Multiply', 10, 'k'], 'k']));
    const lit = [
      'Function',
      ['Add', ['Multiply', 'x', ['At', 'k', 2]], ['g', 'x'], ['At', 'D', 3]],
      'x',
      ['Optional', 'k', 'D'],
    ];
    expect(interpreted(ce, ['Apply', lit, 1])).toBe(21);
    expect(interpreted(ce, ['Apply', lit, 1, ['List', 1, 2]])).toBe(18);
    const fn: any = jsFunction(ce, lit);
    const sys = fn.run.SYS;
    expect(fn.run(1)).toBe(21);
    expect(fn.run(1, [1, 2])).toBe(18);
    expect(evaluated(fn.code, sys)(1)).toBe(21);
    expect(evaluated(fn.run.toString(), sys)(1)).toBe(21);
    expect(fn.preambleOnce).toBeDefined();
    expect(evaluated(fn.callCode, sys, fn.preambleOnce)(1)).toBe(21);
    expect(evaluated(fn.callCode, sys, fn.preambleOnce)(1, [1, 2])).toBe(18);
  });

  test('a combiner parameter `i` with a default is not the imaginary unit', () => {
    const ce = new ComputeEngine();
    ce.declare('L', 'list<real>');
    ce.declare('M', 'list<list<real>>');
    const combiner = [
      'Function',
      ['Add', 'a', ['Multiply', 'x', 'i']],
      'a',
      'x',
      ['Optional', 'i', 1],
    ];
    const L = ['List', 1, 2, 3];
    const M = ['List', ['List', 1, 2], ['List', 3, 4]];
    const reduce = ['Reduce', 'L', combiner, 0];
    expect(ce.box(reduce).subs({ L }).evaluate().json).toBe(6);
    const r = run(ce, reduce, 'javascript', { L: [1, 2, 3] });
    expect(r.value).toBe(6);
    expect(r.code).not.toContain('_SYS.cplx');
    const scan = ['Scan', 'L', combiner, 0];
    expect(
      Array.from(ce.box(scan).subs({ L }).evaluate().each(), (e) => e.re)
    ).toEqual([1, 3, 6]);
    expect(run(ce, scan, 'javascript', { L: [1, 2, 3] }).value).toEqual([
      1, 3, 6,
    ]);
    // Over rows, a complex accumulator lane declined the fold.
    const rows = ['Reduce', 'M', combiner, ['List', 0, 0]];
    expect(ce.box(rows).subs({ M }).evaluate().json).toEqual(['List', 4, 6]);
    expect(
      run(ce, rows, 'javascript', {
        M: [
          [1, 2],
          [3, 4],
        ],
      }).value
    ).toEqual([4, 6]);
  });

  test('a combiner with a rest parameter declines, as it did before defaults', () => {
    // The compiled literal does not take a rest parameter, so such a
    // combiner declined before parameter defaults too, while the
    // interpreter gives `3`.
    const ce = new ComputeEngine();
    ce.declare('L', 'list<real>');
    const combiner = [
      'Function',
      ['Add', 'a', ['Length', 'r']],
      'a',
      ['Spread', 'r'],
    ];
    const reduce = ['Reduce', 'L', combiner, 0];
    expect(
      ce
        .box(reduce)
        .subs({ L: ['List', 1, 2, 3] })
        .evaluate().json
    ).toBe(3);
    for (const to of ['javascript', 'python'])
      for (const expr of [reduce, ['Scan', 'L', combiner, 0]])
        expect(() =>
          compile(ce.box(expr) as any, { to, fallback: false } as any)
        ).toThrow();
  });
});

describe('COMPILED PARAMETER DEFAULTS: SORT, ITERATE AND PIPE', () => {
  const ce = new ComputeEngine();
  ce.declare('y', 'real');

  test('`Sort` reads a literal with a default as a unary key', () => {
    // `k` is not supplied: the key is `-x`, and the sort is descending.
    const sort = ['Sort', ['List', 3, 'y', 2], defaulted(-1)];
    expect(interpretedValues(ce, sort, { y: 5 })).toEqual([5, 3, 2]);
    expect(run(ce, sort, 'javascript', { y: 5 }).value).toEqual([5, 3, 2]);
    expect(run(ce, sort, 'javascript', { y: 0 }).value).toEqual([3, 2, 0]);
  });

  test('`Iterate` calls a literal with a default with the previous value only', () => {
    const take = ['Take', ['Iterate', defaulted(2, ['Add', 'x', 'k']), 'y'], 3];
    expect(interpretedValues(ce, take, { y: 1 })).toEqual([3, 5, 7]);
    expect(run(ce, take, 'javascript', { y: 1 }).value).toEqual([3, 5, 7]);
  });

  test('a `Pipe` stage with a callback with a default', () => {
    const pipe = ['Pipe', ['List', 1, 'y'], ['Map', defaulted(2)]];
    expect(interpretedValues(ce, pipe, { y: 5 })).toEqual([2, 10]);
    expect(run(ce, pipe, 'javascript', { y: 5 }).value).toEqual([2, 10]);
  });
});

/** The JSON value that the Python program `lines` prints (`json` is
 * imported). */
function runPython(python: string, lines: string[]): unknown {
  const file = path.join(
    os.tmpdir(),
    `ce-py-defaults-${process.pid}-${Math.random().toString(36).slice(2)}.py`
  );
  fs.writeFileSync(file, ['import json', ...lines].join('\n'));
  try {
    return JSON.parse(execFileSync(python, [file], { encoding: 'utf8' }));
  } finally {
    fs.unlinkSync(file);
  }
}

// A default fills an absent argument, supplied or left out: the default is a
// discharge of absence, with the absence test of `Coalesce` (`Missing`,
// `Undefined`, `NaN`, `Indeterminate` in the interpreter; `undefined`, `null`,
// `NaN` in JavaScript; `None` and a float `NaN` in Python). A read past the
// end of a list of numbers gives `NaN` in compiled code. `Nothing` is not an
// argument: it is removed from the call, so the parameter is left out (R6 of
// docs/plans/2026-11-01-absent-value-contract.md).
describe('COMPILED PARAMETER DEFAULTS: A DEFAULT FILLS AN ABSENT ARGUMENT', () => {
  const ce = new ComputeEngine();
  ce.declare('L', 'list<real>');
  ce.declare('P', 'list<tuple<real, real>>');
  // A default value is a number, a string, a boolean, a symbol, `[]` or
  // `{}`: a point default is a symbol whose value is the point.
  ce.declare('O', {
    type: 'tuple<real, real>',
    value: ['Tuple', 0, 0],
    constant: true,
  } as any);

  /** `(k: real = 2) ↦ k`, called with absent arguments */
  const K: Json = [
    'Function',
    'k',
    ['Optional', ['Typed', 'k', "'real'"], 2],
  ];
  /** `(k: real = 2) ↦ k` */
  const KR: Json = ['Function', 'k', ['Optional', ['Typed', 'k', "'real'"], 2]];
  /** `(q: tuple<real, real> = O) ↦ q`, with `O` = (0, 0) */
  const Q: Json = [
    'Function',
    'q',
    ['Optional', ['Typed', 'q', "'tuple<real, real>'"], 'O'],
  ];

  // Each program, and its value on every route.
  const programs: [string, Json, unknown][] = [
    ['f()', ['Apply', K], 2],
    ['f(Missing)', ['Apply', K, 'Missing'], 2],
    ['f(At(L, 100))', ['Apply', K, ['At', 'L', 100]], 2],
    ['f(Nothing)', ['Apply', K, 'Nothing'], 2],
    ['g(0/0) with k: real', ['Apply', KR, ['Divide', 0, 0]], 2],
    ['g(NaN) with k: real', ['Apply', KR, 'NaN'], 2],
    ['g(5) with k: real', ['Apply', KR, 5], 5],
    ['q()', ['Apply', Q], [0, 0]],
    ['q(Missing)', ['Apply', Q, 'Missing'], [0, 0]],
    ['q(At(P, 1))', ['Apply', Q, ['At', 'P', 1]], [1, 2]],
    // A read out of range of a list of points is the `NaN` point, which a
    // default reads as absent, as `Coalesce` does (`docs/ERROR-MODEL.md`,
    // "`Missing` is a result only").
    ['q(At(P, 5))', ['Apply', Q, ['At', 'P', 5]], [0, 0]],
    [
      'a block-local function',
      ['Block', ['Assign', 'h', K], ['h', ['At', 'L', 100]]],
      2,
    ],
  ];

  const values = {
    L: ['List', 1, 2],
    P: ['List', ['Tuple', 1, 2], ['Tuple', 3, 4]],
  };

  /** The interpreter's value as a number or a list of numbers. */
  function interpreterValue(expr: Json): unknown {
    const sub = Object.fromEntries(
      Object.entries(values).map(([k, v]) => [k, ce.box(v)])
    );
    const v = ce.box(expr).subs(sub).evaluate();
    if (v.isCollection || v.operator === 'Tuple')
      return [...(v.each() as any)].map((x: any) => x.re);
    return v.re;
  }

  test('a parameter declared with `missing` is a static error', () => {
    // A declared type cannot name `missing` (`docs/ERROR-MODEL.md`,
    // "`Missing` is a result only"): a default handles an absent argument.
    const r = executeEpsil(
      new ComputeEngine(),
      'function f(k: real | missing = 2) { k }'
    );
    expect(r.diagnostics.map((d: any) => d.message[0])).toContain(
      'type-annotation-error'
    );
  });

  test.each(programs)('interpreter: %s', (_, expr, expected) => {
    expect(interpreterValue(expr)).toEqual(expected);
  });

  test.each(programs)('JavaScript: %s', (_, expr, expected) => {
    const vars = { L: [1, 2], P: [[1, 2], [3, 4]] };
    expect(run(ce, expr, 'javascript', vars).value).toEqual(expected);
  });

  test('a call of a user function fills an argument that is absent at run time', () => {
    // The emitted definition takes every argument from the call, so the
    // call site fills the argument (`absentFilledArguments()`).
    const ce2 = new ComputeEngine();
    const r = executeEpsil(ce2, 'function f(x, k: real = 2) { k }');
    expect(r.diagnostics).toEqual([]);
    ce2.declare('L', 'list<real>');
    for (const [expr, expected] of [
      [['f', 1, ['At', 'L', 100]], 2],
      [['f', 1, ['At', 'L', 1]], 1],
      [['f', 1, 'Missing'], 2],
      [['f', 1], 2],
      [['Map', 'f', 'L'], [2, 2]],
    ] as [Json, unknown][]) {
      const v = ce2.box(expr).subs({ L: ce2.box(['List', 1, 2]) }).evaluate();
      expect(
        v.isCollection ? [...(v.each() as any)].map((x: any) => x.re) : v.re
      ).toEqual(expected);
      expect(run(ce2, expr, 'javascript', { L: [1, 2] }).value).toEqual(
        expected
      );
    }
  });

  test('the root function literal fills a supplied absent argument', () => {
    const fn: any = jsFunction(ce, K);
    expect([fn.run(), fn.run(undefined), fn.run(null), fn.run(NaN)]).toEqual(
      [2, 2, 2, 2]
    );
    expect(fn.run(5)).toBe(5);
  });

  const python = TEST_PYTHON ?? '';
  const pythonTest = fs.existsSync(python) ? test : test.skip;

  pythonTest('Python', () => {
    const lines = [
      'import json',
      'import cmath',
      'import numpy as np',
      'L = [1.0, 2.0]',
      'P = [(1.0, 2.0), (3.0, 4.0)]',
      'out = []',
    ];
    for (const [, expr] of programs) {
      const { code } = run(ce, expr, 'python');
      // A block compiles to statements that end with a `return`.
      if (code.includes('\n')) {
        lines.push(
          `def _block():\n${code
            .split('\n')
            .map((l) => `    ${l}`)
            .join('\n')}`
        );
        lines.push('out.append(_block())');
      } else lines.push(`out.append(${code})`);
    }
    lines.push(
      'print(json.dumps([list(v) if isinstance(v, (list, tuple)) else v for v in out]))'
    );
    const file = path.join(os.tmpdir(), `ce-py-absent-default-${process.pid}.py`);
    fs.writeFileSync(file, lines.join('\n'));
    let out = '';
    try {
      out = execFileSync(python, [file], { encoding: 'utf8' });
    } finally {
      fs.unlinkSync(file);
    }
    expect(JSON.parse(out)).toEqual(programs.map(([, , expected]) => expected));
  });
});

// Review fixes of the fill of an absent argument (R6 of
// docs/plans/2026-11-01-absent-value-contract.md).
describe('COMPILED PARAMETER DEFAULTS: THE FILL OF AN ABSENT ARGUMENT, ON EVERY ROUTE', () => {
  /** The interpreter's value: a number, or a list of numbers. */
  function value(ce: ComputeEngine, expr: Json, vals: Record<string, Json> = {}) {
    const sub = Object.fromEntries(
      Object.entries(vals).map(([k, v]) => [k, ce.box(v)])
    );
    const v = ce.box(expr).subs(sub).evaluate();
    if (v.isCollection || v.operator === 'Tuple')
      return [...(v.each() as any)].map((x: any) => x.re);
    return v.re;
  }

  test('a present list argument of a user function is passed whole', () => {
    // Only an argument whose type can hold an absent value is filled at the
    // call: a list is present, and keeps its shape. A point can be a `NaN`
    // point, which takes the default: the value at `k` is then a point or
    // the number 2, a shape that compiled code does not settle, so the call
    // declines.
    const ce = new ComputeEngine();
    const r = executeEpsil(
      ce,
      'function hu(x, k = 2) { k }\nfunction hr(x, k: real = 2) { k + x }'
    );
    expect(r.diagnostics).toEqual([]);
    ce.declare('L', 'list<real>');
    ce.declare('T', 'tuple<real, real>');
    const vals = { L: ['List', 1, 2], T: ['Tuple', 1, 2] };
    const vars = { L: [1, 2], T: [1, 2] };
    for (const [expr, expected] of [
      [['hu', 1, 'L'], [1, 2]],
      [['hr', 1, 'L'], [2, 3]],
    ] as [Json, unknown][]) {
      expect(value(ce, expr, vals)).toEqual(expected);
      expect(run(ce, expr, 'javascript', vars).value).toEqual(expected);
    }
    expect(value(ce, ['hu', 1, 'T'], vals)).toEqual([1, 2]);
    expect(() =>
      compile(ce.box(['hu', 1, 'T']) as any, {
        to: 'javascript',
        fallback: false,
      } as any)
    ).toThrow(/does not settle one shape/);
  });

  test('an absent argument at a typed parameter is filled before its type is tested', () => {
    // The absent argument is a read out of range: `Missing` in the
    // interpreter, `NaN` in compiled code.
    const ce = new ComputeEngine();
    ce.declare('M', 'list<real>');
    const KR = ['Function', 'k', ['Optional', ['Typed', 'k', "'real'"], 2]];
    for (const expr of [
      ['Apply', KR, ['At', 'M', 5]],
      ['Block', ['Assign', 'g', KR], ['g', ['At', 'M', 5]]],
    ]) {
      expect(value(ce, expr, { M: ['List', 1, 3] })).toBe(2);
      expect(run(ce, expr, 'javascript', { M: [1, 3] }).value).toBe(2);
    }
  });

  test('a call of a user function fills an argument whose `real` value is NaN at run time', () => {
    // A `real` value can be `NaN` in compiled code (`0/0`), so an argument
    // of a numeric type is filled at the call site.
    const ce = new ComputeEngine();
    const r = executeEpsil(
      ce,
      'function h(x, k: real = 2) { x + k }\nfunction hu(x, k = 2) { k }'
    );
    expect(r.diagnostics).toEqual([]);
    ce.declare('M', 'list<real>');
    ce.declare('x', 'real');
    ce.declare('y', 'real');
    const vals = { M: ['List', 'NaN', 3], x: 0, y: 0 };
    const vars = { M: [NaN, 3], x: 0, y: 0 };
    const overM = ['Map', ['Function', ['h', 1, 'z'], 'z'], 'M'];
    expect(value(ce, overM, vals)).toEqual([3, 4]);
    expect(run(ce, overM, 'javascript', vars).value).toEqual([3, 4]);
    const quotient = [
      'Map',
      ['Function', ['h', 1, 'z'], 'z'],
      ['List', ['Divide', 'x', 'y'], 1],
    ];
    expect(value(ce, quotient, vals)).toEqual([3, 2]);
    expect(run(ce, quotient, 'javascript', vars).value).toEqual([3, 2]);
    // An untyped parameter is filled too.
    const untyped = ['Map', ['Function', ['hu', 1, 'z'], 'z'], 'M'];
    expect(value(ce, untyped, vals)).toEqual([2, 3]);
    expect(run(ce, untyped, 'javascript', vars).value).toEqual([2, 3]);
  });

  describe('interval-js: a supplied argument that can be absent declines', () => {
    // On the interval target, the absent value (`empty`) is also the value
    // of a pole or a domain error, so a run-time fill would replace a
    // present value by the default. The compilation declines, and the
    // interpreter fills the argument.
    const ce = new ComputeEngine();
    const r = executeEpsil(ce, 'function hr(x, k: real = 2) { k + x }');
    expect(r.diagnostics).toEqual([]);
    ce.declare('y', 'real');
    ce.declare('L', 'list<real>');
    const K = ['Function', 'k', ['Optional', 'k', 2]];
    const declines = (expr: Json) => {
      const result: any = compile(ce.box(expr) as any, {
        to: 'interval-js',
        fallback: false,
      } as any);
      return result.success !== true;
    };

    test.each([
      ['a pole', ['Apply', K, ['Divide', 1, ['Subtract', 'y', 3]]]],
      ['a domain error', ['Sqrt', ['Subtract', 'y', 5]]],
      ['a user function call', ['hr', 1, ['At', 'L', 9]]],
    ])('%s', (_, expr) => {
      const e = expr[0] === 'Sqrt' ? ['Apply', K, expr] : expr;
      expect(declines(e)).toBe(true);
    });

    test('a present argument and a left-out argument compile', () => {
      expect(point(run(ce, ['Apply', K, 5], 'interval-js').value)).toBe(5);
      expect(point(run(ce, ['Apply', K], 'interval-js').value)).toBe(2);
      const mapped = [
        'Map',
        ['Function', ['Multiply', 'x', 'k'], 'x', ['Optional', 'k', 2]],
        ['List', 'y', 2],
      ];
      const values = run(ce, mapped, 'interval-js', { y: 3 }).value as unknown[];
      expect(values.map(point)).toEqual([6, 4]);
    });
  });

  test('evaluateAsync: a symbol default reads the scope of the call', async () => {
    const ce = new ComputeEngine();
    ce.declare('d', 'real');
    ce.assign('d', 1);
    ce.declare('F5', {
      signature: '(k: real = d) -> real',
      evaluate: ([k]) => k,
    });
    const expr = ce.box([
      'Block',
      ['Declare', 'd', "'real'"],
      ['Assign', 'd', 7],
      ['F5', ['First', ['List']]],
    ]);
    expect(expr.evaluate().toString()).toBe('7');
    expect((await expr.evaluateAsync()).toString()).toBe('7');
  });

  test('under `.N()`, a default filled at run time is read exactly at an integer parameter', () => {
    const ce = new ComputeEngine();
    ce.declare('Big', 'integer');
    ce.assign('Big', ce.parse('10^{30}+1'));
    ce.declare('F6', {
      signature: '(n: integer = Big) -> integer',
      evaluate: ([n]) => n,
    });
    const leftOut = ce.box(['F6']).N().toString();
    const absent = ce.box(['F6', ['First', ['List']]]).N().toString();
    expect(leftOut).toBe('1000000000000000000000000000001');
    expect(absent).toBe(leftOut);
  });

  test('a default of the signature declared for a variable fills an absent argument', () => {
    const ce = new ComputeEngine();
    ce.declare('L', 'list<real>');
    ce.declare('fv', '(real, real = 2) -> real');
    ce.assign('fv', ce.box(['Function', ['Add', 'x', 'k'], 'x', 'k']));
    ce.declare('fl', '(list<real> = []) -> list<real>');
    ce.assign('fl', ce.box(['Function', 'v', 'v']));
    const vals = { L: ['List', 1, 2] };
    const call = ['fv', 1, ['At', 'L', 9]];
    expect(value(ce, call, vals)).toBe(3);
    expect(run(ce, call, 'javascript', { L: [1, 2] }).value).toBe(3);
    expect(value(ce, ['fl', ['At', ['List', 'L'], 5]], vals)).toEqual([]);
  });
});

describe('COMPILED PARAMETER DEFAULTS: DECLARED DEFAULTS AND BROADCASTS', () => {
  test('the default of the declared signature comes before the default of the literal', () => {
    const ce = new ComputeEngine();
    ce.declare('L', 'list<real>');
    ce.declare('g', '(number, number = 2) -> number');
    ce.assign(
      'g',
      ce.box(['Function', ['Multiply', 'x', 'k'], 'x', ['Optional', 'k', 3]])
    );
    const expr = ['g', 3, ['At', 'L', 9]];
    expect(
      ce.box(expr).subs({ L: ce.box(['List', 1, 2]) }).evaluate().re
    ).toBe(6);
    expect(run(ce, expr, 'javascript', { L: [1, 2] }).value).toBe(6);
  });

  test('an absent cell of a broadcast takes the declared default', async () => {
    const ce = new ComputeEngine();
    ce.declare('g', '(real = 2) -> real');
    ce.assign('g', ce.box(['Function', ['Coalesce', 'k', 0], 'k']));
    const expr = ce.box(['g', ['List', 'Missing', 3]]);
    expect(expr.evaluate().toString()).toBe('[2,3]');
    expect((await expr.evaluateAsync()).toString()).toBe('[2,3]');
  });

  test('a named callback mapped over rows fills each absent element', () => {
    const ce = new ComputeEngine();
    ce.declare('rows', 'list<list<number>>');
    ce.assign(
      'f',
      ce.box(['Function', ['Coalesce', 'k', 0], ['Optional', 'k', 2]])
    );
    const expr = ['Map', 'f', 'rows'];
    const v = ce
      .box(expr)
      .subs({ rows: ce.box(['List', ['List', 'NaN', 3]]) })
      .evaluate();
    expect(v.toString()).toBe('[[2,3]]');
    expect(run(ce, expr, 'javascript', { rows: [[NaN, 3]] }).value).toEqual([
      [2, 3],
    ]);
  });
});

describe('COMPILED PARAMETER DEFAULTS: A CALL THAT MAPS OVER A LIST', () => {
  // A call of a user function with scalar parameters maps it over a list
  // argument. The list is present, but each absent cell takes the default,
  // as in the interpreter: the mapped function fills it.
  const ce = new ComputeEngine();
  const r = executeEpsil(
    ce,
    [
      'function hu(a, k = 2) { a + k }',
      'function hr(a, k: real = 2) { a + k }',
      'function f(k: real = 2) { k ?? 0 }',
    ].join('\n')
  );
  expect(r.diagnostics).toEqual([]);
  ce.declare('fv', '(real, real = 2) -> real');
  ce.assign('fv', ce.box(['Function', ['Add', 'a', 'k'], 'a', 'k']));
  // A declared type cannot name `missing`: the absent cells are `NaN`
  // values of `N`, and a written `Missing` in a list literal.
  ce.declare('N', 'list<real>');
  ce.declare('L', 'list<real>');
  const vals: Record<string, Json> = {
    N: ['List', 'NaN', 'NaN', 0, 4],
    L: ['List', 1, 2],
  };
  const vars = { N: [NaN, NaN, 0, 4], L: [1, 2] };

  test.each([
    ['fv(1, N)', ['fv', 1, 'N'], [3, 3, 1, 5]],
    ['hu(1, N)', ['hu', 1, 'N'], [3, 3, 1, 5]],
    ['hr(1, N)', ['hr', 1, 'N'], [3, 3, 1, 5]],
    ['f([Missing, 3])', ['f', ['List', 'Missing', 3]], [2, 3]],
    ['hr(1, L), present cells', ['hr', 1, 'L'], [2, 3]],
  ] as [string, Json, number[]][])('%s', (_, expr, expected) => {
    const sub = Object.fromEntries(
      Object.entries(vals).map(([k, v]) => [k, ce.box(v)])
    );
    const v = ce.box(expr).subs(sub).evaluate();
    expect([...(v.each() as any)].map((x: any) => x.re)).toEqual(expected);
    expect(run(ce, expr, 'javascript', vars).value).toEqual(expected);
  });
});

describe('COMPILED PARAMETER DEFAULTS: A CALL THAT MAPS OVER A LIST OF POINTS', () => {
  // A list of points paired with a list at a scalar parameter with a
  // default: each absent element takes the default.
  const ce = new ComputeEngine();
  const r = executeEpsil(
    ce,
    'function hp(p: tuple<real, real>, k = 2) { p[1] * k }'
  );
  expect(r.diagnostics).toEqual([]);
  ce.declare('P', 'list<tuple<real, real>>');
  ce.declare('V', 'list<real>');
  ce.declare('N2', 'list<real>');
  const vals: Record<string, Json> = {
    P: ['List', ['Tuple', 1, 2], ['Tuple', 3, 4]],
    V: ['List', 'NaN', 3],
    N2: ['List', 1, 'NaN', 7],
  };
  const vars = { P: [[1, 2], [3, 4]], V: [NaN, 3], N2: [1, NaN, 7] };

  test.each([
    ['hp(P, [NaN, 3])', ['hp', 'P', 'V'], [2, 9]],
    ['hp(P, Take(N2, 2))', ['hp', 'P', ['Take', 'N2', 2]], [1, 6]],
    ['hp(P), left out', ['hp', 'P'], [2, 6]],
    ['hp(P, [5, 3]), present', ['hp', 'P', ['List', 5, 3]], [5, 9]],
  ] as [string, Json, number[]][])('%s', (_, expr, expected) => {
    const sub = Object.fromEntries(
      Object.entries(vals).map(([k, v]) => [k, ce.box(v)])
    );
    const v = ce.box(expr).subs(sub).evaluate();
    expect([...(v.each() as any)].map((x: any) => x.re)).toEqual(expected);
    expect(run(ce, expr, 'javascript', vars).value).toEqual(expected);
  });
});
