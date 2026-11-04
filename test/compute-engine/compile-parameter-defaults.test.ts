// Compilation of function literals and user functions with a parameter with
// a default value, `(x, k = 2) => x * k`, spelled
// `["Function", body, "x", ["Optional", "k", 2]]` (GitHub issue #490).
//
// A default fills ONLY an argument that the call leaves out. The engine
// completes such a call when it canonicalizes it (`f(3)` becomes `f(3, 2)`),
// so compiled code sees every argument. A callback that its consumer calls
// with fewer arguments than the literal has parameters (`Map`, `Fold`,
// `Sort`) and a literal that the host calls without the defaulted argument
// (the root compiled literal) get the default from a native default
// parameter (`undefined` selects it), not from a test of absence. An absent
// value that the call supplies at a defaulted position (`f(Missing)`,
// `f(At(L, 100))`, `g(NaN)`) is not replaced: the interpreter passes it to the
// body, which gives `Missing` or `NaN` as for any other argument. Compiled
// code gives an unspecified value for such an argument, so the tests below
// check only that the call compiles.
//
// A default is a constant: a number, a string, a boolean, `[]` or `{}`. A
// symbol default (`k = d`, `mode = Auto`) and a default of a rest parameter
// are static errors: a declaration throws, and a function literal has an
// `Error` in place of the parameter, so that it does not compile.

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

  test('a parameter with a declared type takes the default when the argument is left out', () => {
    const lit = [
      'Function',
      ['Multiply', 'x', 'k'],
      'x',
      ['Optional', ['Typed', 'k', "'number'"], 2],
    ];
    const fn: any = jsFunction(ce, lit);
    expect(fn.run(3)).toBe(6);
    expect(fn.run(3, 5)).toBe(15);
    // `undefined` is the way that JavaScript leaves out an argument.
    expect(fn.run(3, undefined)).toBe(6);
  });

  test('`(x, k: number = 2) => k` takes the default only for a left-out argument', () => {
    const fn: any = jsFunction(ce, MAYBE_MISSING);
    expect(fn.success).toBe(true);
    expect(fn.run(3)).toBe(2);
    expect(interpreted(ce, ['Apply', MAYBE_MISSING, 3])).toBe(2);
    // The interpreter passes a supplied `Missing` to the body. Compiled code
    // gives an unspecified value for it, so only the compilation is checked.
    expect(interpreted(ce, ['Apply', MAYBE_MISSING, 3, 'Missing'])).toBe(
      'Missing'
    );
    const written = ['Apply', MAYBE_MISSING, 'y', 'Missing'];
    expect(
      compile(ce.box(written) as any, { to: 'javascript', fallback: false })
        .success
    ).toBe(true);
  });

  test('a function value with a default gets the default from a default parameter', () => {
    // `Map` calls the value with one argument.
    const expr = ['Map', defaulted(2), ['List', 'y', 2]];
    const { value } = run(ce, expr, 'javascript', { y: 1 });
    expect(value).toEqual([2, 4]);
    expect(interpreted(ce, expr, { y: 1 })).toEqual(['List', 2, 4]);
  });

  test('a symbol default is a static error', () => {
    const lit = defaulted('d');
    const json = JSON.stringify(ce.box(lit).json);
    expect(json).toContain('expected-a-literal-default');
    expect(() =>
      compile(ce.box(lit) as any, { to: 'javascript', fallback: false })
    ).toThrow();
    expect(() =>
      compile(ce.box(['Map', lit, ['List', 'y', 2]]) as any, {
        to: 'javascript',
        fallback: false,
      })
    ).toThrow();
  });

  test('a default of a rest parameter is a static error', () => {
    const lit = ['Function', 'r', ['Optional', ['Spread', 'r'], 2]];
    expect(JSON.stringify(ce.box(lit).json)).toContain('Error');
    expect(() =>
      compile(ce.box(lit) as any, { to: 'javascript', fallback: false })
    ).toThrow();
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

  test('a call that supplies every argument, and a call that leaves out the defaulted one', () => {
    for (const expr of [
      ['Apply', defaulted(2), 'y', 5],
      ['Apply', defaulted(2), 'y'],
    ]) {
      const expected = interpreted(ce, expr, { y: 3 });
      expect(run(ce, expr, 'javascript', { y: 3 }).value).toBe(expected);
    }
    expect(interpreted(ce, ['Apply', defaulted(2), 'y'], { y: 3 })).toBe(6);
  });

  test('a call of a block-local function is completed with the default', () => {
    // The interpreter writes an assigned name into the engine, and compiled
    // code declines a write to a symbol of the engine. A `Declare` makes `g`
    // a local of the block in both.
    const expr = [
      'Block',
      ['Declare', 'g', "'unknown'", defaulted(2)],
      ['g', 'y'],
    ];
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

  test('a default that names a variable throws in a declared function, and is a static error in an Epsil function', () => {
    const ce = new ComputeEngine();
    expect(() =>
      ce.declare('F5', {
        signature: '(k: real = d) -> real',
        evaluate: ([k]) => k,
      })
    ).toThrow(/a default value is a constant/);
    const r = executeEpsil(
      new ComputeEngine(),
      'function f(x, k = d) { x * k }'
    );
    expect(r.diagnostics.map((d: any) => d.message[0])).toContain(
      'static-type-error'
    );
  });
});

describe('COMPILED PARAMETER DEFAULTS: PYTHON', () => {
  const ce = new ComputeEngine();

  test('a value default fills `None`, the omission of an argument', () => {
    expect(run(ce, defaulted(2), 'python').code).toBe(
      '(lambda x, k=None: (lambda k: k * x)(2 if k is None else k))'
    );
  });

  test('a collection default is evaluated at each call', () => {
    const lit = [
      'Function',
      'xs',
      ['Optional', ['Typed', 'xs', "'list<number>'"], ['List']],
    ];
    expect(run(ce, lit, 'python').code).toContain('[] if xs is None');
  });

  const python = TEST_PYTHON ?? '';
  const pythonTest = fs.existsSync(python) ? test : test.skip;

  pythonTest('the emitted Python agrees with the interpreter', () => {
    const value = run(ce, defaulted(2), 'python').code;
    const list = run(
      ce,
      [
        'Function',
        'xs',
        ['Optional', ['Typed', 'xs', "'list<number>'"], ['List']],
      ],
      'python'
    ).code;
    const program = [
      'import json',
      'import cmath',
      'import numpy as np',
      `f = ${value}`,
      `h = ${list}`,
      'a = h()',
      'b = h()',
      'print(json.dumps([f(3), f(3, 5), a, b, a is not b]))',
    ].join('\n');
    const file = path.join(os.tmpdir(), `ce-py-defaults-${process.pid}.py`);
    fs.writeFileSync(file, program);
    let out = '';
    try {
      out = execFileSync(python, [file], { encoding: 'utf8' });
    } finally {
      fs.unlinkSync(file);
    }
    expect(JSON.parse(out)).toEqual([6, 15, [], [], true]);
    expect(interpreted(ce, ['Apply', defaulted(2), 3])).toBe(6);
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
  // The call leaves out `k`: the engine completes it with the default when it
  // canonicalizes the call.
  const completed = ['Apply', defaulted(2), 'y'];

  test('interval: a saturated call and a completed call agree with the interpreter', () => {
    expect(interpreted(ce, saturated, { y: 3 })).toBe(15);
    expect(interpreted(ce, completed, { y: 3 })).toBe(6);
    expect(point(run(ce, saturated, 'interval-js', { y: 3 }).value)).toBe(15);
    expect(point(run(ce, completed, 'interval-js', { y: 3 }).value)).toBe(6);
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
    const expected = interpretedValues(valued, [
      'Map',
      expr[1],
      ['List', 1, 2],
    ]);
    expect(expected).toEqual([2 + Math.sin(1), 4 + Math.sin(1)]);
    const { value } = run(ce, expr, 'javascript', { a: 1, L: [1, 2] });
    expect(Array.from(value as number[])).toEqual(expected);
  });

  test('a default that names a constant list of the engine is a static error', () => {
    const ce = new ComputeEngine();
    ce.assign('D', ce.box(['List', 1, 2, 3]));
    const lit = [
      'Function',
      'xs',
      ['Optional', ['Typed', 'xs', "'list<number>'"], 'D'],
    ];
    expect(JSON.stringify(ce.box(lit).json)).toContain(
      'expected-a-literal-default'
    );
    expect(() =>
      compile(ce.box(lit) as any, { to: 'javascript', fallback: false })
    ).toThrow();
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

  pythonTest(
    'Python: `Reduce` and `Scan` with a combiner with a default',
    () => {
      const ce = new ComputeEngine();
      const reduce = run(
        ce,
        ['Reduce', ['List', 1, 2, 3], combiner, 0],
        'python'
      );
      const scan = run(ce, ['Scan', ['List', 1, 2, 3], combiner, 0], 'python');
      const out = runPython(python, [
        `print(json.dumps([float(${reduce.code}), [float(v) for v in ${scan.code}]]))`,
      ]);
      expect(out).toEqual([12, [2, 6, 12]]);
      expect(interpreted(ce, ['Reduce', ['List', 1, 2, 3], combiner, 0])).toBe(
        12
      );
    }
  );

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

  test('the default is in effect after the definitions that the body reads', () => {
    // The user function `g` is a per-call definition. Its own parameter has
    // the name of the defaulted parameter `k`.
    const ce = new ComputeEngine();
    ce.assign('g', ce.box(['Function', ['Multiply', 10, 'k'], 'k']));
    const lit = [
      'Function',
      ['Add', ['Multiply', 'x', 'k'], ['g', 'x']],
      'x',
      ['Optional', 'k', 2],
    ];
    expect(interpreted(ce, ['Apply', lit, 1])).toBe(12);
    expect(interpreted(ce, ['Apply', lit, 1, 5])).toBe(15);
    const fn: any = jsFunction(ce, lit);
    const sys = fn.run.SYS;
    expect(fn.run(1)).toBe(12);
    expect(fn.run(1, 5)).toBe(15);
    expect(evaluated(fn.code, sys)(1)).toBe(12);
    expect(evaluated(fn.run.toString(), sys)(1)).toBe(12);
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

describe('COMPILED PARAMETER DEFAULTS: A DEFAULT FILLS ONLY A LEFT-OUT ARGUMENT', () => {
  const ce = new ComputeEngine();
  ce.declare('L', 'list<real>');

  /** `(k: real = 2) ↦ k` */
  const K: Json = ['Function', 'k', ['Optional', ['Typed', 'k', "'real'"], 2]];

  const values = { L: ['List', 1, 2] };

  /** The interpreter's value of `expr`, with `L` = [1, 2]. */
  function interpreterValue(expr: Json): Json {
    const sub = Object.fromEntries(
      Object.entries(values).map(([k, v]) => [k, ce.box(v)])
    );
    return ce.box(expr).subs(sub).evaluate();
  }

  // The calls that leave out the argument, and a call that supplies it.
  const programs: [string, Json, number][] = [
    ['f()', ['Apply', K], 2],
    ['g(5) with k: real', ['Apply', K, 5], 5],
    [
      'a block-local function',
      ['Block', ['Declare', 'h', "'unknown'", K], ['h']],
      2,
    ],
  ];

  test('a parameter declared with `missing` is a static error', () => {
    // A declared type cannot name `missing` (`docs/ERROR-MODEL.md`,
    // "`Missing` is a result only"): a default handles an argument that the
    // call leaves out.
    const r = executeEpsil(
      new ComputeEngine(),
      'function f(k: real | missing = 2) { k }'
    );
    expect(r.diagnostics.map((d: any) => d.message[0])).toContain(
      'type-annotation-error'
    );
  });

  test.each(programs)('interpreter: %s', (_, expr, expected) => {
    expect(interpreterValue(expr).re).toBe(expected);
  });

  test.each(programs)('JavaScript: %s', (_, expr, expected) => {
    expect(run(ce, expr, 'javascript', { L: [1, 2] }).value).toBe(expected);
  });

  test.each([
    ['f(Missing)', ['Apply', K, 'Missing'], 'Missing'],
    ['f(At(L, 100))', ['Apply', K, ['At', 'L', 100]], 'NaN'],
    ['g(0/0) with k: real', ['Apply', K, ['Divide', 0, 0]], 'NaN'],
    ['g(NaN) with k: real', ['Apply', K, 'NaN'], 'NaN'],
  ] as [string, Json, string][])(
    'a supplied absent value is passed through: %s',
    (_, expr, expected) => {
      // The interpreter does not fill the default. Compiled code gives an
      // unspecified value for such an argument, so only the compilation is
      // checked.
      expect(interpreterValue(expr).json).toBe(expected);
      const result: any = compile(
        ce.box(expr) as any,
        {
          to: 'javascript',
          fallback: false,
        } as any
      );
      expect(result.success).toBe(true);
    }
  );

  test('a call of a user function with a left-out argument', () => {
    const ce2 = new ComputeEngine();
    const r = executeEpsil(ce2, 'function f(x, k: real = 2) { k }');
    expect(r.diagnostics).toEqual([]);
    ce2.declare('L', 'list<real>');
    for (const [expr, expected] of [
      [['f', 1, ['At', 'L', 1]], 1],
      [['f', 1], 2],
      [['f', 1, 7], 7],
      [
        ['Map', 'f', 'L'],
        [2, 2],
      ],
    ] as [Json, unknown][]) {
      const v = ce2
        .box(expr)
        .subs({ L: ce2.box(['List', 1, 2]) })
        .evaluate();
      expect(
        v.isCollection ? [...(v.each() as any)].map((x: any) => x.re) : v.re
      ).toEqual(expected);
      expect(run(ce2, expr, 'javascript', { L: [1, 2] }).value).toEqual(
        expected
      );
    }
    // The interpreter passes a supplied `Missing` to the body.
    expect(ce2.box(['f', 1, 'Missing']).evaluate().json).toBe('Missing');
  });

  test('the root function literal takes the default when the host leaves out the argument', () => {
    const fn: any = jsFunction(ce, K);
    expect([fn.run(), fn.run(undefined)]).toEqual([2, 2]);
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
    lines.push('print(json.dumps(out))');
    const file = path.join(
      os.tmpdir(),
      `ce-py-absent-default-${process.pid}.py`
    );
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

describe('COMPILED PARAMETER DEFAULTS: DECLARED DEFAULTS AND OTHER ROUTES', () => {
  test('a present list argument of a user function is passed whole', () => {
    // A list is present, and keeps its shape.
    const ce = new ComputeEngine();
    const r = executeEpsil(
      ce,
      'function hu(x, k = 2) { k }\nfunction hr(x, k: real = 2) { k + x }'
    );
    expect(r.diagnostics).toEqual([]);
    ce.declare('L', 'list<real>');
    const vals = { L: ce.box(['List', 1, 2]) };
    for (const [expr, expected] of [
      [
        ['hu', 1, 'L'],
        [1, 2],
      ],
      [
        ['hr', 1, 'L'],
        [2, 3],
      ],
    ] as [Json, unknown][]) {
      const v = ce.box(expr).subs(vals).evaluate();
      expect([...(v.each() as any)].map((x: any) => x.re)).toEqual(expected);
      expect(run(ce, expr, 'javascript', { L: [1, 2] }).value).toEqual(
        expected
      );
    }
  });

  describe('interval-js: a supplied value at a defaulted position compiles', () => {
    // The interval target no longer declines an argument that can be absent
    // (a pole, a domain error, a user function call): the call is not
    // filled at run time. The value of such a call is unspecified, so only
    // the compilation is checked.
    const ce = new ComputeEngine();
    const r = executeEpsil(ce, 'function hr(x, k: real = 2) { k + x }');
    expect(r.diagnostics).toEqual([]);
    ce.declare('y', 'real');
    ce.declare('L', 'list<real>');
    const K = ['Function', 'k', ['Optional', 'k', 2]];
    const compiles = (expr: Json) => {
      const result: any = compile(
        ce.box(expr) as any,
        {
          to: 'interval-js',
          fallback: false,
        } as any
      );
      return result.success === true;
    };

    test.each([
      ['a pole', ['Apply', K, ['Divide', 1, ['Subtract', 'y', 3]]]],
      ['a domain error', ['Apply', K, ['Sqrt', ['Subtract', 'y', 5]]]],
      ['a user function call', ['hr', 1, ['At', 'L', 9]]],
    ])('%s', (_, expr) => {
      expect(compiles(expr)).toBe(true);
    });

    test('a present argument and a left-out argument compile', () => {
      expect(point(run(ce, ['Apply', K, 5], 'interval-js').value)).toBe(5);
      expect(point(run(ce, ['Apply', K], 'interval-js').value)).toBe(2);
      const mapped = [
        'Map',
        ['Function', ['Multiply', 'x', 'k'], 'x', ['Optional', 'k', 2]],
        ['List', 'y', 2],
      ];
      const values = run(ce, mapped, 'interval-js', { y: 3 })
        .value as unknown[];
      expect(values.map(point)).toEqual([6, 4]);
    });
  });

  test('evaluateAsync: a left-out argument takes the default', async () => {
    const ce = new ComputeEngine();
    ce.declare('F5', {
      signature: '(k: real = 2) -> real',
      evaluate: ([k]) => k,
    });
    const expr = ce.box(['F5']);
    expect(expr.evaluate().toString()).toBe('2');
    expect((await expr.evaluateAsync()).toString()).toBe('2');
  });

  test('a default of the signature declared for a variable fills a left-out argument', () => {
    const ce = new ComputeEngine();
    ce.declare('fv', '(real, real = 2) -> real');
    ce.assign('fv', ce.box(['Function', ['Add', 'x', 'k'], 'x', 'k']));
    ce.declare('fl', '(list<real> = []) -> list<real>');
    ce.assign('fl', ce.box(['Function', 'v', 'v']));
    const call = ['fv', 1];
    expect(ce.box(call).evaluate().re).toBe(3);
    expect(run(ce, call, 'javascript').value).toBe(3);
    expect(ce.box(['fl']).evaluate().toString()).toBe('[]');
  });

  test('the default of the declared signature comes before the default of the literal', () => {
    const ce = new ComputeEngine();
    ce.declare('g', '(number, number = 2) -> number');
    ce.assign(
      'g',
      ce.box(['Function', ['Multiply', 'x', 'k'], 'x', ['Optional', 'k', 3]])
    );
    const expr = ['g', 3];
    expect(ce.box(expr).evaluate().re).toBe(6);
    expect(run(ce, expr, 'javascript').value).toBe(6);
  });

  test('a supplied absent cell of a broadcast is passed through', () => {
    const ce = new ComputeEngine();
    ce.declare('g', '(real = 2) -> real');
    ce.assign('g', ce.box(['Function', ['Coalesce', 'k', 0], 'k']));
    expect(ce.box(['g']).evaluate().toString()).toBe('2');
    // The cell `Missing` is not filled with the default 2: it stays `Missing`.
    expect(
      ce
        .box(['g', ['List', 'Missing', 3]])
        .evaluate()
        .toString()
    ).toBe('["Missing",3]');
  });
});

describe('COMPILED PARAMETER DEFAULTS: A CALL THAT MAPS OVER A LIST', () => {
  // A call of a user function with scalar parameters maps it over a list
  // argument. A cell that is absent is passed to the function, which does
  // not fill it with the default.
  const ce = new ComputeEngine();
  const r = executeEpsil(
    ce,
    [
      'function hr(a, k: real = 2) { a + k }',
      'function hp(p: tuple<real, real>, k = 2) { p[1] * k }',
    ].join('\n')
  );
  expect(r.diagnostics).toEqual([]);
  ce.declare('N', 'list<real>');
  ce.declare('L', 'list<real>');
  ce.declare('P', 'list<tuple<real, real>>');
  const vals: Record<string, Json> = {
    N: ['List', 'NaN', 3],
    L: ['List', 1, 2],
    P: ['List', ['Tuple', 1, 2], ['Tuple', 3, 4]],
  };
  const vars = {
    L: [1, 2],
    P: [
      [1, 2],
      [3, 4],
    ],
  };

  function interpretedList(expr: Json): number[] {
    const sub = Object.fromEntries(
      Object.entries(vals).map(([k, v]) => [k, ce.box(v)])
    );
    const v = ce.box(expr).subs(sub).evaluate();
    return [...(v.each() as any)].map((x: any) => x.re);
  }

  test.each([
    ['hr(1, L), present cells', ['hr', 1, 'L'], [2, 3]],
    ['hp(P), left out', ['hp', 'P'], [2, 6]],
    ['hp(P, [5, 3]), present', ['hp', 'P', ['List', 5, 3]], [5, 9]],
  ] as [string, Json, number[]][])('%s', (_, expr, expected) => {
    expect(interpretedList(expr)).toEqual(expected);
    expect(run(ce, expr, 'javascript', vars).value).toEqual(expected);
  });

  test('an absent cell is passed to the function', () => {
    // The cell is `NaN`, and `NaN + 1` is `NaN`: the default 2 is not used.
    expect(interpretedList(['hr', 1, 'N'])).toEqual([NaN, 4]);
  });
});
