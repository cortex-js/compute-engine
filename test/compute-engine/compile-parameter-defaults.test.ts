// Compilation of function literals and user functions with a parameter with
// a default value, `(x, k = 2) => x * k`, spelled
// `["Function", body, "x", ["Optional", "k", 2]]` (GitHub issue #490).
//
// Spec: docs/plans/2026-10-31-parameter-default-values.md, R8 and §7 item 9.

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

/** `(x, k: number | missing = 2) => k`: `k` can hold `Missing`. */
const KEEPS_MISSING: Json = [
  'Function',
  'k',
  'x',
  ['Optional', ['Typed', 'k', "'number | missing'"], 2],
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

  test('a parameter whose type cannot hold `Missing` takes a JavaScript default parameter', () => {
    const lit = [
      'Function',
      ['Multiply', 'x', 'k'],
      'x',
      ['Optional', ['Typed', 'k', "'number'"], 2],
    ];
    const fn: any = jsFunction(ce, lit);
    expect(fn.code).toBe('(x, k = 2) => { return k * x; }');
    expect(fn.run(3)).toBe(6);
    expect(fn.run(3, 5)).toBe(15);
  });

  test('`(x, k: number | missing = 2) => k` keeps a supplied `Missing`', () => {
    const fn: any = jsFunction(ce, KEEPS_MISSING);
    expect(fn.success).toBe(true);
    // An omitted argument: the default.
    expect(fn.run(3)).toBe(2);
    expect(interpreted(ce, ['Apply', KEEPS_MISSING, 3])).toBe(2);
    // An explicit `Missing` (`undefined` at run time) is kept.
    expect(fn.run(3, undefined)).toBeUndefined();
    expect(interpreted(ce, ['Apply', KEEPS_MISSING, 3, 'Missing'])).toBe(
      'Missing'
    );
    // An expression that evaluates to `Missing`.
    const firstOfEmpty = ['Apply', KEEPS_MISSING, 'y', ['First', ['List']]];
    expect(interpreted(ce, firstOfEmpty, { y: 1 })).toBe('Missing');
    expect(run(ce, firstOfEmpty, 'javascript', { y: 1 }).value).toBeUndefined();
    const written = ['Apply', KEEPS_MISSING, 'y', 'Missing'];
    expect(run(ce, written, 'javascript', { y: 1 }).value).toBeUndefined();
  });

  test('a function value with a default whose type can hold `Missing` is filled from the argument count', () => {
    // `Map` calls the value with one argument; a bare `k` has the type
    // `unknown`, which can hold `Missing`.
    const expr = ['Map', defaulted(2), ['List', 'y', 2]];
    const { code, value } = run(ce, expr, 'javascript', { y: 1 });
    expect(code).toMatch(/\.length < 2\) _tv\d+ = 2;/);
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
    expect(fn.code).toBe('(m = ({})) => { return m; }');
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

  test('a value default is a Python default parameter', () => {
    expect(run(ce, defaulted(2), 'python').code).toBe('(lambda x, k=2: k * x)');
  });

  test('a symbol default and a collection default take the omission marker', () => {
    expect(run(ce, defaulted('d'), 'python').code).toBe(
      '((lambda _tv1: (lambda x, k=_tv1: (lambda k: k * x)(d if k is _tv1 else k)))(object()))'
    );
    const lit = [
      'Function',
      'xs',
      ['Optional', ['Typed', 'xs', "'list<number>'"], ['List']],
    ];
    expect(run(ce, lit, 'python').code).toContain('[] if xs is _tv1');
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
    // The default is an interval constant, passed at the call site.
    expect(code).toBe('(((x, k) => _IA.mul(k, x)))(_.y, _k1)');
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
