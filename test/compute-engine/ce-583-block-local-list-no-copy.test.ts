/**
 * CE-583. On WGSL, a read with a proven index of a list that a `Block` local
 * holds indexes the local, with no second copy.
 *
 * A `Block` local is a function-scope `var` (`var U: array<f32, 10>;`), and
 * WGSL can index a `var` with a run-time index. Before the fix, each read
 * copied the local to a new `var` first (`var _tv1 = U; … _tv1[1 - 1]`),
 * because the compiler could not tell a block local from a value of the
 * same name, which must be copied before a run-time index. The `Block` now
 * records its locals as variables on its scope. The search for this record
 * stops at a scope that binds the name without recording it, so a free
 * input of the same name still gets its copy. The GLSL output of these
 * reads does not change.
 *
 * The file also tests the defects found with this fix:
 *  - On a shader target, a `Block` local with the name of a parameter of
 *    the function gets a fresh name. GLSL emitted a redeclaration of the
 *    parameter (`float f(float U) { float[10] U;`), and WGSL refused the
 *    function because it took the write of the local for a write of the
 *    parameter.
 *  - A nested `Block` in statement position compiles as a statement: a
 *    compound statement (`{ … }`) on the shader targets, and statements in
 *    the enclosing list with fresh local names on Python. A block with one
 *    statement that is itself a block does the same. Before, the nested
 *    block was a value, and its last statement became a `return`.
 *  - A block that uses a local before its `Declare` declines, in a block
 *    and in a loop body.
 *  - A local of a nested block in a loop body or a branch no longer writes
 *    an outer variable of the same name (JavaScript and Python).
 *  - On Python, a `Declare` with a value assigns the value, and a `Declare`
 *    with no value sets the start value `_ce_unset(name)`: a local of a loop
 *    body no longer keeps the value of the previous pass, and each use of
 *    the start value raises, also as the result of the function. A
 *    `Declare` or an `Assign` whose value compiles to several statements
 *    declines. The names of the helpers are protected.
 *  - On Python, a `Loop` index with the name of another variable of the
 *    function (a parameter, a local, a free symbol, a name that a `vars`
 *    entry reads) gets a fresh name, and the body can still assign it.
 *  - Programs whose branch conditions read a local declared with no value
 *    compile as before (ROADMAP CE-636 covers the case where the local may
 *    have no value).
 *  - The WGSL copy before an index declines with a diagnostic, not an
 *    internal error, at a position with no place for the copy statement.
 *    No input is known to reach this, so it has no test.
 */

import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { BaseCompiler } from '../../src/compute-engine/compilation/base-compiler';
import { GLSLTarget } from '../../src/compute-engine/compilation/glsl-target';
import {
  isVariableLocal,
  recordVariableLocals,
} from '../../src/compute-engine/compilation/javascript-value-facts';
import type { CompileTarget } from '../../src/compute-engine/compilation/types';
import type { Expression } from '../../src/compute-engine/global-types';
import { WGSLTarget } from '../../src/compute-engine/compilation/wgsl-target';
import { PythonTarget } from '../../src/compute-engine/compilation/python-target';
import { execFileSync } from 'child_process';
import { TEST_PYTHON } from './test-python';

const wgsl = new WGSLTarget();
const glsl = new GLSLTarget();
const NO_FOLD = { constantFold: false };

function engine(): ComputeEngine {
  const ce = new ComputeEngine();
  ce.declare('B', 'list<real^10>');
  ce.declare('C', 'list<real^10>');
  ce.declare('x', 'real');
  return ce;
}

const SUM_U = ['Sum', ['At', 'U', 'k'], ['Limits', 'k', 1, 10]];
const UNROLLED =
  '((U[1 - 1]) + (U[2 - 1]) + (U[3 - 1]) + (U[4 - 1]) + (U[5 - 1]) + ' +
  '(U[6 - 1]) + (U[7 - 1]) + (U[8 - 1]) + (U[9 - 1]) + (U[10 - 1]))';

function blockLocal(body: unknown): unknown {
  return [
    'Block',
    ['Declare', 'U', "'list<real^10>'"],
    ['Assign', 'U', 'B'],
    body,
  ];
}

/** Define `f: (real) -> real` as `U ↦ body`. */
function defineF(ce: ComputeEngine, body: unknown): void {
  ce.declare('f', '(real) -> real');
  ce.assign('f', ce.box(['Function', body, 'U'] as any));
}

/** `Block(Declare(U, list<real^10>); U ≔ C; value)`. */
function innerU(value: unknown): unknown {
  return [
    'Block',
    ['Declare', 'U', "'list<real^10>'"],
    ['Assign', 'U', 'C'],
    value,
  ];
}

/** The text of the shader function whose header starts with `head`. */
function fnText(preamble: string, head: string): string {
  const start = preamble.indexOf(head);
  expect(start).toBeGreaterThanOrEqual(0);
  const end = preamble.indexOf('\n}', start);
  return preamble.slice(start, end + 2);
}

/**
 * Run the emitted function `_fn_f` in JavaScript. The bodies these tests
 * emit use declarations, assignments, compound statements, array indexes,
 * `+` and `return`, so a text translation is enough: a declaration
 * (`var a: T;`, `float[10] a;`, `float a;`) becomes `let a;`, and a WGSL
 * phony assignment `_ = e;` becomes `e;`.
 */
function runF(
  preamble: string,
  head: string,
  lists: { B: number[]; C: number[] },
  x: number
): number {
  const text = fnText(preamble, head);
  const body = text
    .slice(text.indexOf('{\n') + 2, -2)
    .replace(/\bvar (\w+): [^;]+;/g, 'let $1;')
    .replace(/^(\s*)float(?:\[\d+\])? (\w+);/gm, '$1let $2;')
    .replace(/^(\s*)_ = /gm, '$1');
  return new Function('B', 'C', 'U', body)(lists.B, lists.C, x) as number;
}

/** The two shader functions and the JavaScript target agree at x = 2.5. */
function expectSameValues(
  ce: ComputeEngine,
  wgslPreamble: string,
  glslPreamble: string,
  expected: number
): void {
  const C = Array.from({ length: 10 }, (_, k) => k + 1);
  const B = C.map((c) => 100 * c);
  const js = compile(ce.box(['f', 'x']), { to: 'javascript' });
  expect(js.success).toBe(true);
  const want = (js.run as (v: Record<string, unknown>) => number)({
    x: 2.5,
    B,
    C,
  });
  expect(want).toBe(expected);
  expect(runF(wgslPreamble, 'fn _fn_f(', { B, C }, 2.5)).toBe(want);
  expect(runF(glslPreamble, 'float _fn_f(', { B, C }, 2.5)).toBe(want);
}

describe('CE-583: WGSL reads a Block local list with a proven index in place', () => {
  test('a Sum over the local: no second copy', () => {
    const ce = engine();
    const r = wgsl.compile(ce.box(blockLocal(SUM_U) as any), NO_FOLD);
    expect(r.success).toBe(true);
    expect(r.code).toBe(`var U: array<f32, 10>;\nU = B;\nreturn ${UNROLLED};`);
  });

  test('a read with a dynamic index calls the helper, as before', () => {
    const ce = engine();
    const r = wgsl.compile(
      ce.box(blockLocal(['At', 'U', 'x']) as any),
      NO_FOLD
    );
    expect(r.code).toBe(
      'var U: array<f32, 10>;\nU = B;\nreturn _gpu_at10(U, x);'
    );
  });

  test('a read inside a conditional branch indexes the local', () => {
    const ce = engine();
    const r = wgsl.compile(
      ce.box(blockLocal(['If', ['Greater', 'x', 0], ['At', 'U', 3], 0]) as any)
    );
    expect(r.success).toBe(true);
    expect(r.code).toContain('U[2]');
    expect(r.code).not.toMatch(/var _tv\d+ = U;/);
  });

  test('a local of a nested Block is indexed in place too', () => {
    const ce = engine();
    const r = wgsl.compile(
      ce.box(
        blockLocal([
          'Block',
          ['Declare', 'V', "'list<real^10>'"],
          ['Assign', 'V', 'U'],
          ['Sum', ['At', 'V', 'k'], ['Limits', 'k', 1, 10]],
        ]) as any
      ),
      NO_FOLD
    );
    expect(r.success).toBe(true);
    expect(r.code).toContain('(V[1 - 1]) + (V[2 - 1])');
    expect(r.code).not.toMatch(/var _tv\d+ = [UV];/);
  });
});

describe('CE-583: a value of the same name is still copied', () => {
  test('a free input U, with no Block local', () => {
    const ce = engine();
    ce.declare('U', 'list<real^10>');
    const r = wgsl.compile(ce.box(SUM_U as any), NO_FOLD);
    expect(r.code).toMatch(/^var _tv1 = U;\nvar _tv2: f32 = _tv1\[1 - 1\];/);
    expect(r.code.match(/var _tv\d+ = U;/g)).toHaveLength(10);
  });

  test('a scope that rebinds the name stops the search', () => {
    // A `Block` frame records `U` as a variable. A binder inside it that
    // binds `U` again (a parameter, a loop index) makes a different
    // variable, which is not a `var`. A binder that binds another name
    // keeps the record visible.
    const root = { boundVars: undefined } as CompileTarget<Expression>;
    const block = BaseCompiler.withBoundNames(root, ['U'])!;
    recordVariableLocals({ boundVars: block } as CompileTarget<Expression>, [
      'U',
    ]);
    expect(isVariableLocal('U', block)).toBe(true);
    const loop = BaseCompiler.withBoundNames(
      { boundVars: block } as CompileTarget<Expression>,
      ['k']
    );
    expect(isVariableLocal('U', loop)).toBe(true);
    const parameter = BaseCompiler.withBoundNames(
      { boundVars: loop } as CompileTarget<Expression>,
      ['U']
    );
    expect(isVariableLocal('U', parameter)).toBe(false);
    const inner = BaseCompiler.withBoundNames(
      { boundVars: parameter } as CompileTarget<Expression>,
      ['j']
    );
    expect(isVariableLocal('U', inner)).toBe(false);
    expect(isVariableLocal('U', undefined)).toBe(false);
  });

  test('a Block local inside a user function whose parameter is U', () => {
    // The local of the inner `Block` hides the parameter `U` of `f`. It is
    // spelled with a fresh name (`_tv1`), so its declaration and its write
    // are not taken for the parameter, and the list local is indexed in
    // place.
    const ce = engine();
    defineF(ce, ['Add', ['Block', innerU(SUM_U)], 'U']);
    const unrolled = UNROLLED.replace(/\bU\[/g, '_tv1[');
    const w = wgsl.compile(ce.box(['f', 'x']), NO_FOLD);
    expect(w.code).toBe('_fn_f(x)');
    expect(fnText(w.preamble!, 'fn _fn_f(')).toBe(
      'fn _fn_f(U: f32) -> f32 {\n' +
        '  var _tv2: f32;\n' +
        '  {\n' +
        '    var _tv1: array<f32, 10>;\n' +
        '    _tv1 = C;\n' +
        `    _tv2 = ${unrolled};\n` +
        '  }\n' +
        '  return U + _tv2;\n' +
        '}'
    );
    const g = glsl.compile(ce.box(['f', 'x']), NO_FOLD);
    expect(fnText(g.preamble!, 'float _fn_f(')).toBe(
      'float _fn_f(float U) {\n' +
        '  float _tv2;\n' +
        '  {\n' +
        '    float[10] _tv1;\n' +
        '    _tv1 = C;\n' +
        `    _tv2 = ${unrolled};\n` +
        '  }\n' +
        '  return U + _tv2;\n' +
        '}'
    );
    expectSameValues(ce, w.preamble!, g.preamble!, 55 + 2.5);
  });

  test('compileFunction(): a Block local with the name of a parameter', () => {
    // The `Assign` writes the local, not the parameter, so WGSL compiles it.
    const ce = engine();
    ce.declare('U', 'real');
    const body = ce.box([
      'Block',
      ['Declare', 'U', "'list<real^10>'"],
      ['Assign', 'U', 'C'],
      SUM_U,
    ] as any);
    const unrolled = UNROLLED.replace(/\bU\[/g, '_tv1[');
    expect(
      wgsl.compileFunction(body, 'g', 'f32', [['U', 'f32']], NO_FOLD)
    ).toBe(
      'fn g(U: f32) -> f32 {\n' +
        '  var _tv1: array<f32, 10>;\n' +
        '  _tv1 = C;\n' +
        `  return ${unrolled};\n` +
        '}'
    );
    expect(
      glsl.compileFunction(body, 'g', 'float', [['U', 'float']], NO_FOLD)
    ).toBe(
      'float g(float U) {\n' +
        '  float[10] _tv1;\n' +
        '  _tv1 = C;\n' +
        `  return ${unrolled};\n` +
        '}'
    );
  });
});

describe('CE-583: a local that hides an outer local and a parameter', () => {
  // `f := U ↦ Block(U ≔ C; Block(U ≔ B; Σ U_k) + Σ U_k) + U`, with
  // `k = 1..3`. The local of the inner block hides the local of the outer
  // block, which hides the parameter. Both locals get a fresh name, so WGSL
  // does not take a write of either for a write of the parameter.
  test('both locals get a fresh name', () => {
    const ce = engine();
    const sum3 = ['Sum', ['At', 'U', 'k'], ['Limits', 'k', 1, 3]];
    defineF(ce, [
      'Add',
      [
        'Block',
        ['Declare', 'U', "'list<real^10>'"],
        ['Assign', 'U', 'C'],
        [
          'Add',
          [
            'Block',
            ['Declare', 'U', "'list<real^10>'"],
            ['Assign', 'U', 'B'],
            sum3,
          ],
          sum3,
        ],
      ],
      'U',
    ]);
    const inner = '((_tv2[1 - 1]) + (_tv2[2 - 1]) + (_tv2[3 - 1]))';
    const outer = '((_tv1[1 - 1]) + (_tv1[2 - 1]) + (_tv1[3 - 1]))';
    const w = wgsl.compile(ce.box(['f', 'x']), NO_FOLD);
    expect(fnText(w.preamble!, 'fn _fn_f(')).toBe(
      'fn _fn_f(U: f32) -> f32 {\n' +
        '  var _tv4: f32;\n' +
        '  {\n' +
        '    var _tv1: array<f32, 10>;\n' +
        '    _tv1 = C;\n' +
        '    var _tv3: f32;\n' +
        '    {\n' +
        '      var _tv2: array<f32, 10>;\n' +
        '      _tv2 = B;\n' +
        `      _tv3 = ${inner};\n` +
        '    }\n' +
        `    _tv4 = ${outer} + _tv3;\n` +
        '  }\n' +
        '  return U + _tv4;\n' +
        '}'
    );
    const g = glsl.compile(ce.box(['f', 'x']), NO_FOLD);
    expect(fnText(g.preamble!, 'float _fn_f(')).toBe(
      'float _fn_f(float U) {\n' +
        '  float _tv4;\n' +
        '  {\n' +
        '    float[10] _tv1;\n' +
        '    _tv1 = C;\n' +
        '    float _tv3;\n' +
        '    {\n' +
        '      float[10] _tv2;\n' +
        '      _tv2 = B;\n' +
        `      _tv3 = ${inner};\n` +
        '    }\n' +
        `    _tv4 = ${outer} + _tv3;\n` +
        '  }\n' +
        '  return U + _tv4;\n' +
        '}'
    );
    // B = 100·C, so the sums are 600 and 6.
    expectSameValues(ce, w.preamble!, g.preamble!, 600 + 6 + 2.5);
  });

  test('compileFunction(): an assignment before the declaration writes the parameter', () => {
    // The interpreter refuses this order (`read-before-declaration`). The
    // check of the writes of a parameter reads the statements in order, so
    // the first `Assign` is a write of the parameter `U`, and WGSL declines.
    const ce = engine();
    ce.declare('U', 'real');
    const body = ce.box([
      'Block',
      ['Assign', 'U', 2],
      ['Declare', 'U', "'real'"],
      ['Assign', 'U', 3],
      ['Add', 'U', 1],
    ] as any);
    expect(() =>
      wgsl.compileFunction(body, 'g', 'f32', [['U', 'f32']], NO_FOLD)
    ).toThrow(/the body assigns the parameter "U"/);
  });
});

describe('CE-583: a nested Block in statement position', () => {
  // `f := U ↦ Block(Block(Declare(U, list<real^10>); U ≔ C; U), U + 1)`.
  // The inner block is a statement: nothing reads its value. It compiled as
  // a value before: its statements were put in the scope of the parameter
  // (`float[10] U;`, a redeclaration) with a `return` of its value, so the
  // function returned the list instead of `U + 1`.
  test('it is a compound statement, with no return', () => {
    const ce = engine();
    defineF(ce, ['Block', innerU('U'), ['Add', 'U', 1]]);
    const w = wgsl.compile(ce.box(['f', 'x']), NO_FOLD);
    expect(fnText(w.preamble!, 'fn _fn_f(')).toBe(
      'fn _fn_f(U: f32) -> f32 {\n' +
        '  {\n' +
        '    var _tv1: array<f32, 10>;\n' +
        '    _tv1 = C;\n' +
        '    _ = _tv1;\n' +
        '  }\n' +
        '  return U + 1.0;\n' +
        '}'
    );
    const g = glsl.compile(ce.box(['f', 'x']), NO_FOLD);
    expect(fnText(g.preamble!, 'float _fn_f(')).toBe(
      'float _fn_f(float U) {\n' +
        '  {\n' +
        '    float[10] _tv1;\n' +
        '    _tv1 = C;\n' +
        '    _tv1;\n' +
        '  }\n' +
        '  return U + 1.0;\n' +
        '}'
    );
    expectSameValues(ce, w.preamble!, g.preamble!, 2.5 + 1);
  });

  test('a scalar block statement is not stored in a temporary', () => {
    // Before, the value was stored in `_tv1`, and `_tv1;` was then written
    // as a statement, which is not valid WGSL.
    const ce = engine();
    const expr = ce.box([
      'Block',
      ['Block', ['Declare', 'V', "'real'"], ['Assign', 'V', 'x'], 'V'],
      ['Add', 'x', 1],
    ] as any);
    expect(wgsl.compile(expr, NO_FOLD).code).toBe(
      '{\n  var V: f32;\n  V = x;\n  _ = V;\n}\nreturn x + 1.0;'
    );
    expect(glsl.compile(expr, NO_FOLD).code).toBe(
      '{\n  float V;\n  V = x;\n  V;\n}\nreturn x + 1.0;'
    );
  });
});

describe('CE-583: the GLSL output does not change', () => {
  test('a Sum over a Block local', () => {
    const ce = engine();
    const r = glsl.compile(ce.box(blockLocal(SUM_U) as any), NO_FOLD);
    expect(r.code).toBe(`float[10] U;\nU = B;\nreturn ${UNROLLED};`);
  });

  test('a read with a dynamic index', () => {
    const ce = engine();
    const r = glsl.compile(
      ce.box(blockLocal(['At', 'U', 'x']) as any),
      NO_FOLD
    );
    expect(r.code).toBe('float[10] U;\nU = B;\nreturn _gpu_at10(U, x);');
  });
});

describe('CE-583: a nested Block in statement position on Python', () => {
  // Python has no block scope and no compound statement: the statements of
  // the nested block are put in the enclosing list, with no `return`, and
  // each of its locals gets a fresh name.
  const python = new PythonTarget();
  const shapes: Array<[string, unknown, string, string, number]> = [
    [
      'a block that assigns an outer local',
      [
        'Block',
        ['Declare', 'W', "'real'"],
        ['Block', ['Assign', 'W', ['Multiply', 2, 'x']]],
        ['Add', 'W', 1],
      ],
      // The nested block assigns `W` on every path before the read, so
      // `W` gets no start value (CE-636).
      'W = 2 * x\nreturn W + 1',
      'def f(x):\n    W = 2 * x\n    return W + 1\n',
      6,
    ],
    [
      'a block with a value that nothing reads',
      [
        'Block',
        ['Block', ['Declare', 'V', "'real'"], ['Assign', 'V', 'x'], 'V'],
        ['Add', 'x', 1],
      ],
      '_tv1 = x\n_tv1\nreturn x + 1',
      'def f(x):\n    _tv1 = x\n    _tv1\n    return x + 1\n',
      3.5,
    ],
    [
      'a block local that hides an outer local',
      [
        'Block',
        ['Declare', 'V', "'real'"],
        ['Assign', 'V', 3],
        [
          'Block',
          ['Declare', 'V', "'real'"],
          ['Assign', 'V', 'x'],
          ['Assign', 'V', ['Add', 'V', 1]],
        ],
        ['Add', 'V', 'x'],
      ],
      'V = 3\n_tv1 = x\n_tv1 = _tv1 + 1\nreturn V + x',
      'def f(x):\n    V = 3\n    _tv1 = x\n    _tv1 = _tv1 + 1\n    return V + x\n',
      5.5,
    ],
  ];
  // The definition of the start-value helper (`_ce_unset`) is left out of
  // the comparison.
  const withoutHelper = (s: string) =>
    s.replace(
      /^class _ce_unset_type:[\s\S]*?def _ce_checked\(_v\):\n(?: {4}.*\n)*\n*/,
      ''
    );
  for (const [label, json, code, def, value] of shapes) {
    test(label, () => {
      const ce = engine();
      const expr = ce.box(json as any);
      expect(withoutHelper(python.compile(expr, NO_FOLD).code)).toBe(code);
      const fn = python.compileFunction(expr, 'f', ['x']);
      expect(withoutHelper(fn).trimEnd()).toBe(def.trimEnd());
      // The interpreter gives the same value.
      ce.assign('x', 2.5);
      expect(expr.evaluate().re).toBe(value);
      if (TEST_PYTHON === undefined) return;
      const out = execFileSync(TEST_PYTHON, [
        '-c',
        `${fn}\nprint(repr(float(f(2.5))))`,
      ]).toString();
      expect(Number(out.trim())).toBe(value);
    });
  }
});

describe('CE-583: a use of a block local before its Declare declines', () => {
  // The local exists from the start of the block, so a statement before
  // the `Declare` uses the local. The interpreter answers
  // `read-before-declaration`, and every target declines.
  const shapes: Array<[string, unknown]> = [
    [
      'an assignment',
      [
        'Block',
        ['Assign', 'U', 2],
        ['Declare', 'U', "'real'"],
        ['Assign', 'U', 3],
        ['Add', 'U', 1],
      ],
    ],
    [
      'a read',
      [
        'Block',
        ['Assign', 'y', ['Add', 'U', 1]],
        ['Declare', 'U', "'real'"],
        ['Assign', 'U', 3],
        ['Add', 'U', 'y'],
      ],
    ],
  ];
  for (const [label, json] of shapes) {
    test(label, () => {
      const ce = new ComputeEngine();
      ce.declare('U', 'real');
      ce.assign('U', 10);
      const expr = ce.box(json as any);
      expect(expr.evaluate().toString()).toBe(
        'Error(ErrorCode("read-before-declaration", "U"))'
      );
      const decline =
        /a statement uses the block local "U" before the `Declare` of "U"/;
      for (const to of ['javascript', 'glsl', 'wgsl', 'python'])
        expect(() => compile(expr, { to, fallback: false })).toThrow(decline);
      // The interval target gives its decline in the result.
      const interval = compile(expr, { to: 'interval-js', fallback: false });
      expect(interval.success).toBe(false);
      expect(interval.error).toMatch(decline);
    });
  }

  test('a use in a nested scope that declares the name again compiles', () => {
    const ce = new ComputeEngine();
    const expr = ce.box([
      'Block',
      [
        'Assign',
        'y',
        ['Block', ['Declare', 'U', "'real'"], ['Assign', 'U', 5], 'U'],
      ],
      ['Declare', 'U', "'real'"],
      ['Assign', 'U', 3],
      ['Add', 'U', 'y'],
    ] as any);
    expect(expr.evaluate().re).toBe(8);
    const js = compile(expr, { to: 'javascript', fallback: false });
    expect((js.run as () => number)()).toBe(8);
  });
});

describe('CE-583: a block local in a loop body or a branch', () => {
  // A local of a nested block must not write a variable of the same name of
  // the enclosing code. Python has no block scope, so the local gets a fresh
  // name. A JavaScript loop body puts the nested block in braces.
  const python = new PythonTarget();
  const D = (n: string) => ['Declare', n, "'real'"];
  const shapes: Array<[string, unknown, number, string | undefined]> = [
    [
      'a block in a loop body',
      [
        'Block',
        D('V'),
        ['Assign', 'V', 1],
        [
          'Loop',
          [
            'Block',
            ['Block', D('V'), ['Assign', 'V', 100]],
            ['Assign', 'V', ['Multiply', 2, 'V']],
          ],
          ['Element', 'k', ['Range', 1, 3]],
        ],
        'V',
      ],
      8,
      'def f(x):\n    V = 1\n    for k in range(1, 4):\n        _tv1 = 100\n' +
        '        V = 2 * V\n    return V',
    ],
    [
      'a block in a branch',
      [
        'Block',
        D('V'),
        ['Assign', 'V', 1],
        [
          'If',
          ['Greater', 'x', 0],
          ['Block', D('V'), ['Assign', 'V', 7]],
          ['Assign', 'V', 5],
        ],
        'V',
      ],
      1,
      'def f(x):\n    V = 1\n    if 0 < x:\n        _tv1 = 7\n    else:\n' +
        '        V = 5\n    return V',
    ],
    [
      'a block nested in a block of a branch',
      [
        'Block',
        D('V'),
        ['Assign', 'V', 1],
        [
          'If',
          ['Greater', 'x', 0],
          [
            'Block',
            ['Assign', 'V', 2],
            ['Block', D('V'), ['Assign', 'V', 7]],
            ['Assign', 'V', ['Add', 'V', 1]],
          ],
          ['Assign', 'V', 5],
        ],
        'V',
      ],
      3,
      undefined,
    ],
  ];
  for (const [label, json, value, def] of shapes) {
    test(label, () => {
      const ce = new ComputeEngine();
      ce.declare('x', 'real');
      const expr = ce.box(json as any);
      // Compiled while `x` has no value, so the condition stays in the code.
      const js = compile(expr, { to: 'javascript', fallback: false });
      expect((js.run as (v: Record<string, unknown>) => number)({ x: 3 })).toBe(
        value
      );
      const fn = python.compileFunction(expr, 'f', ['x']);
      if (def !== undefined) expect(fn.trimEnd()).toBe(def);
      ce.assign('x', 3);
      expect(expr.evaluate().re).toBe(value);
      if (TEST_PYTHON === undefined) return;
      const out = execFileSync(TEST_PYTHON, [
        '-c',
        `${fn}\nprint(repr(float(f(3))))`,
      ]).toString();
      expect(Number(out.trim())).toBe(value);
    });
  }
});

describe('CE-583: the order checks also run on a loop body', () => {
  // `U` is a local of the loop body, and the first statement of the body
  // reads it before its `Declare`. The interpreter answers an error; the
  // compiled code read the input `U` (Python gave 100).
  test('a read before the Declare in a loop body declines', () => {
    const ce = new ComputeEngine();
    ce.declare('U', 'real');
    const D = (n: string) => ['Declare', n, "'real'"];
    const expr = ce.box([
      'Block',
      D('s'),
      ['Assign', 's', 0],
      [
        'Loop',
        [
          'Block',
          [
            'If',
            ['Greater', 'k', 1],
            ['Assign', 's', ['Add', 's', 'U']],
            'Nothing',
          ],
          D('U'),
          ['Assign', 'U', 100],
        ],
        ['Element', 'k', ['Range', 1, 2]],
      ],
      's',
    ] as any);
    const decline =
      /a statement uses the block local "U" before the `Declare` of "U"/;
    for (const to of ['javascript', 'python'])
      expect(() => compile(expr, { to, fallback: false })).toThrow(decline);
    expect(() => new PythonTarget().compileFunction(expr, 'f', ['U'])).toThrow(
      decline
    );
    const interval = compile(expr, { to: 'interval-js', fallback: false });
    expect(interval.success).toBe(false);
    expect(interval.error).toMatch(decline);
    ce.assign('U', 1);
    expect(expr.evaluate().toString()).toMatch(/^Error\(/);
  });
});

describe('CE-583: a Python block local has no value from a previous pass', () => {
  // `t` is a local of the loop body: each pass has a new `t`, which has a
  // value only in the pass where `k = 1`. Python kept the value 5 of the
  // first pass and gave 5. The `Declare` now sets the local to a start value
  // whose use in arithmetic raises `UnboundLocalError` (`_ce_unset`). The
  // interpreter has no number for the read in the pass where `k = 2`: its
  // result is the symbol `t`, which compiled code cannot represent, so
  // Python raises, and JavaScript throws `read-before-declaration` (CE-636;
  // it gave NaN before).
  test('a local declared in a loop body', () => {
    const ce = new ComputeEngine();
    const D = (n: string) => ['Declare', n, "'real'"];
    const expr = ce.box([
      'Block',
      D('s'),
      ['Assign', 's', 0],
      [
        'Loop',
        [
          'Block',
          D('t'),
          ['If', ['Equal', 'k', 1], ['Assign', 't', 5], 'Nothing'],
          ['Assign', 's', ['Add', 's', ['If', ['Equal', 'k', 2], 't', 0]]],
        ],
        ['Element', 'k', ['Range', 1, 3]],
      ],
      's',
    ] as any);
    const js = compile(expr, { to: 'javascript', fallback: false });
    expect(() => (js.run as () => number)()).toThrow(
      /read-before-declaration: "t"/
    );
    const fn = new PythonTarget().compileFunction(expr, 'f', []);
    expect(fn).toContain(
      '        _tv1 = _ce_unset("t")\n        if ((k) == (1)):\n            _tv1 = 5'
    );
    if (TEST_PYTHON === undefined) return;
    expect(runPythonError(fn)).toMatch(
      /UnboundLocalError: read-before-declaration: "t"/
    );
  });

  test('an implicit local of a nested block does not reach the outer read', () => {
    // `W` is a local of the nested block (a bare assignment of a name that
    // nothing outside binds), so the read after the block is not that
    // local. Python wrote `W` in the scope of the function and gave 9.
    const ce = new ComputeEngine();
    const D = (n: string) => ['Declare', n, "'real'"];
    const expr = ce.box([
      'Block',
      D('s'),
      ['Assign', 's', 0],
      [
        'Loop',
        [
          'Block',
          ['Block', ['Assign', 'W', ['Add', 'k', 1]]],
          ['Assign', 's', ['Add', 's', 'W']],
        ],
        ['Element', 'k', ['Range', 1, 3]],
      ],
      's',
    ] as any);
    expect(expr.evaluate().toString()).toMatch(/^Error\(/);
    const fn = new PythonTarget().compileFunction(expr, 'f', []);
    expect(fn).toContain('    for k in range(1, 4):\n        _tv1 = k + 1');
    expect(fn).not.toMatch(/^\s*W = /m);
  });
});

/** The last line of the error that `f()` of the Python code `fn` raises. */
function runPythonError(fn: string): string {
  try {
    execFileSync(TEST_PYTHON!, ['-c', `${fn}\nprint(f())`], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (e) {
    const lines = String((e as { stderr?: Buffer }).stderr ?? '')
      .trim()
      .split('\n');
    return lines[lines.length - 1];
  }
  return 'no error';
}

describe('CE-583: a Python result that is the start value raises', () => {
  // `t` has a value only when `x > 0`. The interpreter has no number for
  // the result at x = 0. Python returned the `_ce_unset_type` object; it
  // now raises, as at HEAD, where the read of `t` raised.
  const D = (n: string) => ['Declare', n, "'real'"];
  const cases: Array<[string, unknown]> = [
    [
      'the local is the result',
      [
        'Block',
        D('t'),
        ['If', ['Greater', 'x', 0], ['Assign', 't', 1], 'Nothing'],
        't',
      ],
    ],
    [
      'a copy of the local is the result',
      [
        'Block',
        D('t'),
        D('s'),
        ['If', ['Greater', 'x', 0], ['Assign', 't', 1], 'Nothing'],
        ['Assign', 's', 't'],
        's',
      ],
    ],
  ];
  for (const [label, json] of cases) {
    test(label, () => {
      const ce = new ComputeEngine();
      ce.declare('x', 'real');
      const expr = ce.box(json as any);
      const fn = new PythonTarget().compileFunction(expr, 'f', ['x']);
      expect(fn).toMatch(/return _ce_checked\((t|s|_tv\d+)\)/);
      const code = new PythonTarget().compile(expr, {}).code;
      expect(code).toMatch(/return _ce_checked\(/);
      if (TEST_PYTHON === undefined) return;
      expect(runPython(fn, 'f(1)')).toBe(1);
      const error = (() => {
        try {
          execFileSync(TEST_PYTHON, ['-c', `${fn}\nprint(f(0))`], {
            stdio: ['ignore', 'pipe', 'pipe'],
          });
        } catch (e) {
          return String((e as { stderr?: Buffer }).stderr ?? '');
        }
        return 'no error';
      })();
      expect(error).toMatch(/UnboundLocalError: read-before-declaration: "t"/);
    });
  }
});

describe('CE-583: a Python result that holds the start value raises', () => {
  // The result is a collection that holds `t`, which has a value only when
  // `x > 0`. Python returned the collection with the `_ce_unset_type`
  // object in it; `_ce_checked` now walks the collection and raises.
  const D = (n: string) => ['Declare', n, "'real'"];
  const cases: Array<[string, unknown, string]> = [
    ['a list', ['List', 't'], '[1]'],
    ['a tuple', ['Tuple', 't', 1], '(1, 1)'],
    ['a nested list', ['List', ['List', 1, 't']], '[[1, 1]]'],
  ];
  for (const [label, value, printed] of cases) {
    test(label, () => {
      const ce = new ComputeEngine();
      ce.declare('x', 'real');
      const expr = ce.box([
        'Block',
        D('t'),
        ['If', ['Greater', 'x', 0], ['Assign', 't', 1], 'Nothing'],
        value,
      ] as any);
      const fn = new PythonTarget().compileFunction(expr, 'f', ['x']);
      expect(fn).toMatch(/return _ce_checked\(/);
      if (TEST_PYTHON === undefined) return;
      const run = (call: string): string => {
        try {
          return execFileSync(
            TEST_PYTHON!,
            ['-c', `import numpy as np\n${fn}\nprint(repr(${call}))`],
            { stdio: ['ignore', 'pipe', 'pipe'] }
          )
            .toString()
            .trim();
        } catch (e) {
          return String((e as { stderr?: Buffer }).stderr ?? '');
        }
      };
      expect(run('f(1)')).toBe(printed);
      expect(run('f(0)')).toMatch(
        /UnboundLocalError: read-before-declaration: "t"/
      );
    });
  }
});

describe('CE-583: a Python lambda that returns the start value raises', () => {
  // The result is a function literal that reads `t`, which has a value only
  // when `x > 0`. Calling the lambda returned the `_ce_unset_type` object;
  // the body of each lambda now passes through `_ce_checked`.
  test('Function(t)', () => {
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    const expr = ce.box([
      'Block',
      ['Declare', 't', "'real'"],
      ['If', ['Greater', 'x', 0], ['Assign', 't', 1], 'Nothing'],
      ['Function', 't'],
    ] as any);
    const fn = new PythonTarget().compileFunction(expr, 'f', ['x']);
    expect(fn).toContain('(lambda : _ce_checked(t))');
    if (TEST_PYTHON === undefined) return;
    const run = (call: string): string => {
      try {
        return execFileSync(
          TEST_PYTHON!,
          ['-c', `import numpy as np\n${fn}\nprint(repr(${call}))`],
          { stdio: ['ignore', 'pipe', 'pipe'] }
        )
          .toString()
          .trim();
      } catch (e) {
        return String((e as { stderr?: Buffer }).stderr ?? '');
      }
    };
    expect(run('f(1)()')).toBe('1');
    expect(run('f(0)()')).toMatch(
      /UnboundLocalError: read-before-declaration: "t"/
    );
  });
});

describe('CE-583: a Python Declare in a nested block', () => {
  const D = (n: string, t = "'real'") => ['Declare', n, t];

  // `Declare(m, real, i)` gives the local `m` the value `i`. The `declare`
  // hook of the Python target emits nothing, and the value was lost: the
  // code read `_tv1`, which nothing assigned, and raised `NameError`.
  test('a Declare with a value assigns the value', () => {
    const ce = new ComputeEngine();
    const expr = ce.box([
      'Block',
      D('s'),
      ['Assign', 's', 0],
      [
        'Loop',
        [
          'Block',
          ['Declare', 'm', "'real'", 'i'],
          ['Assign', 's', ['Add', 's', 'm']],
        ],
        ['Element', 'i', ['Range', 1, 5]],
      ],
      's',
    ] as any);
    expect(expr.evaluate().re).toBe(15);
    const js = compile(expr, { to: 'javascript', fallback: false });
    expect((js.run as () => number)()).toBe(15);
    const fn = new PythonTarget().compileFunction(expr, 'f', []);
    expect(fn).toContain('        _tv1 = i\n        s = _tv1 + s');
    if (TEST_PYTHON === undefined) return;
    const out = execFileSync(TEST_PYTHON, ['-c', `${fn}\nprint(f())`])
      .toString()
      .trim();
    expect(Number(out)).toBe(15);
  });
});

describe('CE-583: a branch on a block local that the compiled code reads', () => {
  const D = (n: string, t = "'integer'") => ['Declare', n, t];
  // Each of these programs reads a local declared with no value in a branch
  // condition, and has a value on every run. They compile and give the value
  // of the interpreter, as before CE-583. The Python start value of a local
  // (`_ce_unset`) does not change them. A read of a local that may have no
  // value is tested in `ce-636-block-local-without-value.test.ts`.
  const cases: Array<[string, unknown, number, boolean]> = [
    [
      'both arms of an If assign',
      [
        'Block',
        D('n'),
        ['If', ['Greater', 'x', 0], ['Assign', 'n', 1], ['Assign', 'n', 2]],
        ['If', ['Greater', 'n', 1], 10, 20],
      ],
      20,
      true,
    ],
    [
      'an assignment whose value reads the local',
      [
        'Block',
        D('n'),
        ['If', ['Greater', 'x', 3], ['Assign', 'n', 1]],
        ['Assign', 'n', ['If', ['Greater', 'x', 5], 1, 'n']],
        ['If', ['NotEqual', 'n', 1], 10, 20],
      ],
      10,
      false,
    ],
    [
      'a first value in the first pass of a loop',
      [
        'Block',
        D('m'),
        [
          'Loop',
          [
            'If',
            ['Equal', 'i', 1],
            ['Assign', 'm', 'i'],
            [
              'If',
              ['Greater', ['Multiply', 'i', 'x'], 'm'],
              ['Assign', 'm', ['Multiply', 'i', 'x']],
            ],
          ],
          ['Element', 'i', ['Range', 1, 5]],
        ],
        'm',
      ],
      5,
      true,
    ],
    [
      'a function literal called after the write',
      [
        'Block',
        D('n'),
        D('f', "'any'"),
        ['Assign', 'f', ['Function', ['If', ['Greater', 'n', 1], 10, 20]]],
        ['Assign', 'n', 2],
        ['Apply', 'f'],
      ],
      10,
      true,
    ],
    [
      'a loop over a list literal',
      [
        'Block',
        D('n'),
        ['Loop', ['Assign', 'n', 'i'], ['Element', 'i', ['List', 1, 2]]],
        ['If', ['NotEqual', 'n', 1], 10, 20],
      ],
      10,
      true,
    ],
  ];
  for (const [label, json, expected, python] of cases) {
    test(label, () => {
      const ce = new ComputeEngine();
      ce.declare('x', 'real');
      const expr = ce.box(json as any);
      expect(expr.subs({ x: 1 }).evaluate().re).toBe(expected);
      const js = compile(expr, { to: 'javascript', fallback: false });
      expect((js.run as (v: object) => number)({ x: 1 })).toBe(expected);
      if (!python) return;
      const fn = new PythonTarget().compileFunction(expr, 'f', ['x']);
      if (TEST_PYTHON === undefined) return;
      expect(runPython(fn, 'f(1)')).toBe(expected);
    });
  }
});

/**
 * Run the Python function `fn` with the argument list `call` (`f()`, `g(1)`)
 * and give the printed value as a number. `preamble` is Python code that
 * runs first (a module global).
 */
function runPython(fn: string, call: string, preamble = ''): number {
  const out = execFileSync(TEST_PYTHON!, [
    '-c',
    `import numpy as np\nimport math\n${preamble}${fn}\nprint(${call})`,
  ])
    .toString()
    .trim();
  return Number(out);
}

describe('CE-583: a Python loop index does not overwrite another variable', () => {
  const D = (n: string, t = "'integer'") => ['Declare', n, t];
  const loop = (body: unknown, index: string, lo: number, hi: number) => [
    'Loop',
    body,
    ['Element', index, ['Range', lo, hi]],
  ];
  const add = (v: unknown) => ['Assign', 's', ['Add', 's', v]];

  // Python has no block scope: a `for` statement assigns its index in the
  // scope of the whole function. Before the fix, an inner loop over `i`
  // changed the `i` of the outer loop: `Range(1, 0)` is 1, 0, so the inner
  // loop left `i = 0` and the outer body added 0 (Python gave 0 where the
  // interpreter gives 15).
  const cases: Array<[string, unknown, number]> = [
    [
      'an inner loop over the index of the outer loop',
      [
        'Block',
        D('s'),
        ['Assign', 's', 0],
        loop(['Block', loop(add(0), 'i', 1, 0), add('i')], 'i', 1, 5),
        's',
      ],
      15,
    ],
    [
      'an inner loop that is a statement of the outer body',
      [
        'Block',
        D('s'),
        ['Assign', 's', 0],
        loop(
          ['Block', loop(add(['Multiply', 10, 'i']), 'i', 1, 2), add('i')],
          'i',
          1,
          5
        ),
        's',
      ],
      165,
    ],
    [
      'a loop over the name of a block local',
      [
        'Block',
        D('s'),
        ['Assign', 's', 0],
        D('k'),
        ['Assign', 'k', 100],
        loop(add('k'), 'k', 1, 3),
        ['Add', 's', 'k'],
      ],
      106,
    ],
  ];

  for (const [label, json, expected] of cases) {
    test(label, () => {
      const ce = new ComputeEngine();
      const expr = ce.box(json as any);
      expect(expr.evaluate().re).toBe(expected);
      const js = compile(expr, { to: 'javascript', fallback: false });
      expect((js.run as () => number)()).toBe(expected);
      const fn = new PythonTarget().compileFunction(expr, 'f', []);
      if (TEST_PYTHON === undefined) return;
      expect(runPython(fn, 'f()')).toBe(expected);
    });
  }

  test('a loop over the name of a parameter', () => {
    const ce = new ComputeEngine();
    const expr = ce.box([
      'Block',
      D('s'),
      ['Assign', 's', 0],
      loop(add('x'), 'x', 1, 3),
      ['Add', 's', 'x'],
    ] as any);
    expect(expr.subs({ x: 1 }).evaluate().re).toBe(7);
    const fn = new PythonTarget().compileFunction(expr, 'f', ['x']);
    expect(fn).not.toMatch(/for x in/);
    if (TEST_PYTHON === undefined) return;
    expect(runPython(fn, 'f(1)')).toBe(7);
  });

  // A loop index with the name of a free symbol made the name a local of
  // the function: a read of the module global before the loop raised
  // `UnboundLocalError`, and a read after the loop gave the last index.
  test('a loop over the name of a free symbol', () => {
    const ce = new ComputeEngine();
    const after = ce.box([
      'Block',
      D('s'),
      ['Assign', 's', 0],
      loop(add('y'), 'y', 1, 3),
      ['Add', 's', 'y'],
    ] as any);
    const before = ce.box([
      'Block',
      D('s'),
      ['Assign', 's', 'y'],
      loop(add('y'), 'y', 1, 3),
      's',
    ] as any);
    for (const expr of [after, before]) {
      expect(expr.subs({ y: 10 }).evaluate().re).toBe(16);
      const fn = new PythonTarget().compileFunction(expr, 'f', []);
      expect(fn).not.toMatch(/for y in/);
      if (TEST_PYTHON === undefined) continue;
      expect(runPython(fn, 'f()', 'y = 10\n')).toBe(16);
    }
  });

  // An index with no other variable of that name keeps its name, and a
  // comprehension has its own scope in Python 3, so its variable keeps its
  // name too.
  test('other indices keep their names', () => {
    const ce = new ComputeEngine();
    const expr = ce.box([
      'Block',
      D('s'),
      ['Assign', 's', 0],
      loop(
        add([
          'Add',
          ['Length', ['Comprehension', 'i', ['Element', 'i', ['Range', 1, 2]]]],
          'i',
        ]),
        'i',
        1,
        3
      ),
      's',
    ] as any);
    expect(expr.evaluate().re).toBe(12);
    const fn = new PythonTarget().compileFunction(expr, 'f', []);
    expect(fn).toContain('for i in range(1, 4):');
    expect(fn).toContain('for i in range(1, 3)]');
    if (TEST_PYTHON === undefined) return;
    expect(runPython(fn, 'f()')).toBe(12);
  });
});

describe('CE-583: the names of the Python start-value helper are protected', () => {
  const D = (n: string, t = "'integer'") => ['Declare', n, t];
  const json = (x: string) => [
    'Block',
    D('n'),
    D('y'),
    ['Assign', 'y', 0],
    ['If', ['Greater', x, 3], ['Assign', 'n', 1], ['Assign', 'y', 1]],
    ['Assign', 'y', ['Add', 'y', 'n']],
    'y',
  ];

  // A function or a parameter named like the class of the start value
  // replaced the class (`_ce_unset_type`, formerly `_CeUnset`, which the
  // check did not protect).
  test('a function, a parameter or a symbol named like the helper declines', () => {
    const ce = new ComputeEngine();
    const py = new PythonTarget();
    const expr = ce.box(json('x') as any);
    expect(() => py.compileFunction(expr, '_ce_unset_type', ['x'])).toThrow(
      /"_ce_unset_type" is the name of a Python builtin/
    );
    expect(() => py.compileFunction(expr, 'g', ['_ce_unset_type'])).toThrow(
      /"_ce_unset_type" is the name of a Python builtin/
    );
    expect(() => py.compileFunction(expr, '_ce_unset', ['x'])).toThrow(
      /"_ce_unset" is the name of a Python builtin/
    );
    expect(() =>
      py.compileFunction(ce.box(json('_ce_unset_type') as any), 'g', [])
    ).toThrow(/"_ce_unset_type" is the name of a Python builtin/);
    expect(() => py.compileFunction(expr, 'g', ['x'])).not.toThrow();
  });
});

describe('CE-583: a Python loop index with a fresh name can be assigned', () => {
  const D = (n: string, t = "'integer'") => ['Declare', n, t];
  // The index `x` has the name of the parameter, so Python spells it with
  // a fresh name (`pythonLoopIndexCollides`). Before the fix the fresh
  // name was not a target that an `Assign` accepts, and the compiler
  // refused the program.
  test('a body that doubles its index', () => {
    const ce = new ComputeEngine();
    const expr = ce.box([
      'Block',
      D('s'),
      ['Assign', 's', 0],
      [
        'Loop',
        [
          'Block',
          ['Assign', 'x', ['Multiply', 2, 'x']],
          ['Assign', 's', ['Add', 's', 'x']],
        ],
        ['Element', 'x', ['Range', 1, 3]],
      ],
      ['Add', 's', 'x'],
    ] as any);
    // 2 + 4 + 6, then the parameter x = 1.
    expect(expr.subs({ x: 1 }).evaluate().re).toBe(13);
    const fn = new PythonTarget().compileFunction(expr, 'f', ['x']);
    expect(fn).not.toMatch(/for x in/);
    if (TEST_PYTHON === undefined) return;
    expect(runPython(fn, 'f(1)')).toBe(13);
  });
});

describe('CE-583: a Python Declare whose value is a block', () => {
  // A top-level block of `compileFunction` compiles through
  // `BaseCompiler.compileBlock`, which has its own `Declare` lowering.
  // Python returned 2 for x = 1, the value of the inner block.
  test('a block that is the body of the function', () => {
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    const expr = ce.box([
      'Block',
      [
        'Declare',
        'n',
        "'real'",
        [
          'Block',
          ['Declare', 'a', "'real'"],
          ['Assign', 'a', 'x'],
          ['Multiply', 'a', 2],
        ],
      ],
      ['Add', 'n', 1],
    ] as any);
    expect(expr.subs({ x: 1 }).evaluate().re).toBe(3);
    expect(() => new PythonTarget().compileFunction(expr, 'f', ['x'])).toThrow(
      /Could not compile `Declare`: the value of "n" lowers to a statement sequence/
    );
  });

  // The value of `t` compiles to several statements. Put after `t = `, the
  // `return` of the inner block left the function at the first pass of the
  // loop. The compilation now declines, as for an `Assign` of such a value.
  test('the compilation declines', () => {
    const ce = new ComputeEngine();
    const expr = ce.box([
      'Block',
      ['Declare', 's', "'real'"],
      ['Assign', 's', 0],
      [
        'Loop',
        [
          'Block',
          [
            'Declare',
            't',
            "'real'",
            ['Block', ['Declare', 'u', "'real'", 'i'], ['Add', 'u', 1]],
          ],
          ['Assign', 's', ['Add', 's', 't']],
        ],
        ['Element', 'i', ['Range', 1, 3]],
      ],
      's',
    ] as any);
    expect(expr.evaluate().re).toBe(9);
    expect(() => new PythonTarget().compileFunction(expr, 'f', [])).toThrow(
      /Could not compile `Declare`: the value of "t" lowers to a statement sequence/
    );
  });
});

describe('CE-583: a nested block with one statement, in statement position', () => {
  // The lone statement of the middle block is a block. It was compiled as
  // a value, so its last statement became a `return`: Python returned `t`
  // (2 for x = 2) before `return x + 1`, and GLSL stored it in a temporary
  // that it then wrote as a statement (`_tv1;`).
  const json = [
    'Block',
    ['Block', ['Block', ['Declare', 't', "'real'", 'x'], 't']],
    ['Add', 'x', 1],
  ];

  test('Python', () => {
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    const expr = ce.box(json as any);
    expect(expr.subs({ x: 2 }).evaluate().re).toBe(3);
    const fn = new PythonTarget().compileFunction(expr, 'f', ['x']);
    expect(fn).not.toMatch(/return _tv1|return t\b/);
    if (TEST_PYTHON === undefined) return;
    expect(runPython(fn, 'f(2)')).toBe(3);
  });

  test('GLSL', () => {
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    const expr = ce.box(json as any);
    const code = glsl.compileFunction(expr, 'g', 'float', [['x', 'float']]);
    expect(code).not.toContain('_tv1');
    expect(code).toContain('      float t;\n      t = x;');
    expect(code).toContain('return x + 1.0;');
  });

  test('a loop body', () => {
    const ce = new ComputeEngine();
    const expr = ce.box([
      'Block',
      ['Declare', 's', "'real'"],
      ['Assign', 's', 0],
      [
        'Loop',
        [
          'Block',
          [
            'Block',
            [
              'Block',
              ['Declare', 't', "'real'", 'i'],
              ['Assign', 's', ['Add', 's', 't']],
            ],
          ],
        ],
        ['Element', 'i', ['Range', 1, 3]],
      ],
      's',
    ] as any);
    expect(expr.evaluate().re).toBe(6);
    const code = glsl.compileFunction(expr, 'g', 'float', []);
    expect(code).not.toContain('_tv1');
    const fn = new PythonTarget().compileFunction(expr, 'f', []);
    // One `return`: the one of the function.
    expect(fn.match(/\breturn\b/g)).toHaveLength(1);
    if (TEST_PYTHON === undefined) return;
    expect(runPython(fn, 'f()')).toBe(6);
  });
});

describe('CE-583: a Python loop index and the code of a vars entry', () => {
  // `vars: { y: 'k' }` compiles a read of `y` to the Python variable `k`.
  // A loop over `k` overwrote it, and the read after the loop gave the last
  // index (3) instead of 10.
  test('a loop over the name that a vars entry reads', () => {
    const ce = new ComputeEngine();
    ce.declare('y', 'real');
    const expr = ce.box([
      'Block',
      ['Declare', 's', "'real'"],
      ['Assign', 's', 0],
      [
        'Loop',
        ['Assign', 's', ['Add', 's', 'k']],
        ['Element', 'k', ['Range', 1, 3]],
      ],
      ['Add', 's', 'y'],
    ] as any);
    expect(expr.subs({ y: 10 }).evaluate().re).toBe(16);
    const result = compile(expr, {
      to: 'python',
      fallback: false,
      vars: { y: 'k' },
    });
    expect(result.success).toBe(true);
    expect(result.code).not.toMatch(/for k in/);
    if (TEST_PYTHON === undefined) return;
    const fn =
      'def f():\n    k = 10\n' +
      result.code
        .split('\n')
        .map((line) => `    ${line}`)
        .join('\n');
    expect(runPython(fn, 'f()')).toBe(16);
  });
});

describe('CE-583: a Python loop index and a name read through a value', () => {
  // `a` holds `k + 1`, so the compiled code reads the Python variable `k`
  // where it reads `a`. The loop over `k` overwrote it.
  test('a symbol whose value reads the name of the index', () => {
    const ce = new ComputeEngine();
    ce.assign('a', ce.box(['Add', 'k', 1]));
    const expr = ce.box([
      'Block',
      ['Declare', 's', "'real'"],
      ['Assign', 's', 0],
      [
        'Loop',
        ['Assign', 's', ['Add', 's', 'k']],
        ['Element', 'k', ['Range', 1, 3]],
      ],
      ['Add', 's', 'a'],
    ] as any);
    const fn = new PythonTarget().compileFunction(expr, 'f', []);
    expect(fn).not.toMatch(/for k in/);
    if (TEST_PYTHON === undefined) return;
    // 1 + 2 + 3, then a = k + 1 with the module global k = 10.
    expect(runPython(fn, 'f()', 'k = 10\n')).toBe(17);
  });

  // The scan of the code of a `vars` entry follows the Unicode rule of
  // Python identifiers.
  test('a vars entry with a name that is not ASCII', () => {
    const ce = new ComputeEngine();
    ce.declare('y', 'real');
    const alpha = { sym: 'α' };
    const expr = ce.box([
      'Block',
      ['Declare', 's', "'real'"],
      ['Assign', 's', 0],
      [
        'Loop',
        ['Assign', 's', ['Add', 's', alpha]],
        ['Element', alpha, ['Range', 1, 3]],
      ],
      ['Add', 's', 'y'],
    ] as any);
    const result = new PythonTarget().compile(expr, { vars: { y: 'α' } });
    expect(result.success).toBe(true);
    expect(result.code).not.toMatch(/for α in/);
    if (TEST_PYTHON === undefined) return;
    const fn =
      'def f():\n' +
      result.code
        .split('\n')
        .map((line) => `    ${line}`)
        .join('\n');
    expect(runPython(fn, 'f()', 'α = 10\n')).toBe(16);
  });
});
