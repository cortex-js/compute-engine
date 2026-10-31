/**
 * A collection input that the caller leaves out, on the JavaScript target.
 *
 * With `L` declared `list<number>` and no value, the interpreter has no
 * value for an operator over `L`: `Sum(L)`, `Map(x ↦ 2x, L)` and
 * `Comprehension(2k, Element(k, L))` stay unevaluated. The compiled code
 * read `_.L` as an array (`.reduce`, `.map`, `for … of`) and threw a
 * `TypeError` when `run()` had no `L`. Now the runner tests each such input
 * once, at entry, before any code runs (`checkEntry` and `entryNoValue` in
 * `compilation/javascript-runtime.ts`, the list of inputs from
 * `BaseCompiler.collectionReadInputs`): the run gives the absence marker of
 * its result, `NaN` for a number, `undefined` otherwise. The emitted code
 * does not change, and with `L` supplied it gives the same values as before.
 *
 * A `Loop` inside a `Block` is pinned on the compiled side only: the value
 * the interpreter gives for it is the subject of
 * `docs/plans/2026-10-30-loop-domain-no-value.md`.
 */
import { execFileSync } from 'child_process';
import { ComputeEngine } from '../../src/compute-engine';
import { BaseCompiler } from '../../src/compute-engine/compilation/base-compiler';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { PythonTarget } from '../../src/compute-engine/compilation/python-target';
import { createJavaScriptRuntime } from '../../src/runtime';
import { TEST_PYTHON } from './test-python';

const ce = new ComputeEngine();
ce.declare('L', 'list<number>');
ce.declare('s', 'string');
ce.declare('c', 'boolean');
ce.declare('x', 'real');

const SUPPLIED = [3, 1, 2];

function compiled(json: unknown): any {
  return compile(ce.box(json as any), {
    to: 'javascript',
    fallback: false,
  }) as any;
}

/** True when `v` is the absence marker of a compiled run. */
function noValue(v: unknown): boolean {
  return v === undefined || (typeof v === 'number' && Number.isNaN(v));
}

/** The interpreter has no value: the result is not a number literal, a
 * string or a list. */
function interpreterHasNoValue(json: unknown): boolean {
  const r = ce.box(json as any).evaluate();
  return !r.isNumberLiteral && r.string === undefined && r.operator !== 'List';
}

const map2 = ['Function', ['Multiply', 2, 'x'], 'x'];
const positive = ['Function', ['Greater', 'x', 0], 'x'];

// [name, expression, value with L = [3, 1, 2]]
const CASES: Array<[string, unknown, unknown]> = [
  [
    'Comprehension',
    ['Comprehension', ['Multiply', 2, 'k'], ['Element', 'k', 'L']],
    [6, 2, 4],
  ],
  ['Map', ['Map', map2, 'L'], [6, 2, 4]],
  ['Sum', ['Sum', 'L'], 6],
  ['Product', ['Product', 'L'], 6],
  ['Max', ['Max', 'L'], 3],
  ['Mean', ['Mean', 'L'], 2],
  ['Length', ['Length', 'L'], 3],
  ['Count', ['Count', 'L'], 3],
  ['Reverse', ['Reverse', 'L'], [2, 1, 3]],
  ['Sort', ['Sort', 'L'], [1, 2, 3]],
  ['Join', ['Join', ['List', 9], 'L'], [9, 3, 1, 2]],
  ['Filter', ['Filter', 'L', positive], [3, 1, 2]],
  ['Reduce', ['Reduce', 'L', 'Add'], 6],
  ['First', ['First', 'L'], 3],
  ['At', ['At', 'L', 1], 3],
  ['Take', ['Take', 'L', 2], [3, 1]],
  ['Dot', ['Dot', 'L', 'L'], 14],
];

const LOOP_IN_BLOCK = [
  'Block',
  ['Declare', 'a', { str: 'number' }, 5],
  ['Loop', ['Assign', 'a', ['Add', 'a', 'k']], ['Element', 'k', 'L']],
  'a',
];

describe('COMPILE: a collection input that the caller leaves out', () => {
  test.each(CASES)(
    '%s: no value when absent, the value when supplied',
    (_name, json, value) => {
      const c = compiled(json);
      expect(interpreterHasNoValue(json)).toBe(true);
      let absent: unknown;
      expect(() => {
        absent = c.run({});
      }).not.toThrow();
      expect(noValue(absent)).toBe(true);
      expect(c.run({ L: SUPPLIED })).toEqual(value);
    }
  );

  test('the emitted code does not change', () => {
    expect(compiled(['Sum', 'L']).code).toBe(
      '(_.L).reduce((_a, _b) => _a + _b, 0)'
    );
    expect(
      compiled(['Comprehension', ['Multiply', 2, 'k'], ['Element', 'k', 'L']])
        .code
    ).toContain('for (const k of _.L)');
  });

  test('a string input: no value when absent', () => {
    const c = compiled(['Length', 's']);
    expect(noValue(c.run({}))).toBe(true);
    expect(c.run({ s: 'ab' })).toBe(2);
    const chars = compiled(['Comprehension', 'x', ['Element', 'x', 's']]);
    expect(noValue(chars.run({}))).toBe(true);
    expect(chars.run({ s: 'ab' })).toEqual(['a', 'b']);
  });

  test('a Loop in a Block: no value when absent, and no throw', () => {
    const c = compiled(LOOP_IN_BLOCK);
    let absent: unknown;
    expect(() => {
      absent = c.run({});
    }).not.toThrow();
    expect(noValue(absent)).toBe(true);
    expect(c.run({ L: SUPPLIED })).toBe(11);
    expect(c.run({ L: [] })).toBe(5);
  });

  test('an effect: the run has no value before the effect runs', () => {
    // The entry test runs before any code, so the draw is not made, as the
    // interpreter makes no draw for an operator it leaves unevaluated.
    const c = compiled(['Add', ['Length', 'L'], ['Random']]);
    expect(noValue(c.run({}))).toBe(true);
    expect(typeof c.run({ L: SUPPLIED })).toBe('number');
    const loop = compiled([
      'Block',
      ['Declare', 'a', { str: 'number' }, 5],
      [
        'Loop',
        ['Assign', 'a', ['Add', 'a', ['Random']]],
        ['Element', 'k', 'L'],
      ],
      'a',
    ]);
    expect(noValue(loop.run({}))).toBe(true);
  });

  test('an input that the code does not iterate is not required', () => {
    // An element-wise operator gives `undefined` for an absent operand.
    expect(compiled(['Add', 'L', 1]).entryPlan?.required).toBeUndefined();
    // An input tested for an absent value: the code decides what it gives.
    const m = compiled(['IsMissing', 'L']);
    expect(m.entryPlan?.required).toBeUndefined();
    expect(m.run({})).toBe(true);
    // A literal list is not an input.
    expect(compiled(['Sum', ['List', 1, 2, 3]]).run({})).toBe(6);
  });

  test('stricter than the interpreter in a branch that is not taken', () => {
    // The interpreter gives 0 at c = false with no L. The entry test does
    // not know which branch the run takes, and the run has no value. A
    // compiled result is never a definite value that the interpreter does
    // not give (user decision 2026-10-30).
    const json = ['If', 'c', ['Sum', 'L'], 0];
    expect(
      ce
        .box(json as any)
        .subs({ c: false })
        .evaluate().re
    ).toBe(0);
    const r = compiled(json);
    expect(noValue(r.run({ c: false }))).toBe(true);
    expect(r.run({ c: false, L: SUPPLIED })).toBe(0);
    expect(r.run({ c: true, L: SUPPLIED })).toBe(6);
  });

  test('stored code loaded by a runtime applies the same test', () => {
    const r = compiled(['Sum', 'L']);
    const stored = JSON.parse(JSON.stringify(r));
    const fn = createJavaScriptRuntime({}).load(stored);
    expect(noValue(fn({}))).toBe(true);
    expect(fn({ L: SUPPLIED })).toBe(6);
  });

  test('broadcast: with no value for the input, every cell is NaN', () => {
    // The batch tests the required inputs once, before the cell loop: no
    // cell is evaluated, so none is counted as a failure.
    const r = compiled(['Add', 'x', ['Sum', 'L']]);
    const out = r.broadcast({ x: new Float64Array([1, 2]) });
    expect(Array.from(out).every((v: number) => Number.isNaN(v))).toBe(true);
    expect(
      Array.from(r.broadcast({ x: new Float64Array([1, 2]), L: SUPPLIED }))
    ).toEqual([7, 8]);
    const slice = createJavaScriptRuntime({}).loadBroadcastSlice(
      JSON.parse(JSON.stringify(r))
    );
    const failures = { count: 0 };
    const cells = new Float64Array(3);
    expect(
      slice({ x: new Float64Array([1, 2, 3]) }, undefined, cells, {
        from: 0,
        to: 3,
        failures,
      })
    ).toBe(3);
    expect(Array.from(cells).every((v) => Number.isNaN(v))).toBe(true);
    expect(failures.count).toBe(0);
    // A slice that is stopped at once writes no cell and reports none.
    const untouched = new Float64Array([7, 7, 7]);
    expect(
      slice({ x: new Float64Array([1, 2, 3]) }, undefined, untouched, {
        from: 0,
        to: 3,
        stop: () => true,
      })
    ).toBe(0);
    expect(Array.from(untouched)).toEqual([7, 7, 7]);
  });

  test('a test for an absent value does not exempt an iterated input', () => {
    // The simple rule: an input that the code iterates is required, also
    // when the code tests it. Stricter than the interpreter, which gives 0
    // for `L` = `Missing`, the value an absent input stands for.
    const json = ['If', ['IsMissing', 'L'], 0, ['Sum', 'L']];
    expect(
      ce
        .box(json as any)
        .subs({ L: ce.Missing })
        .evaluate().re
    ).toBe(0);
    const r = compiled(json);
    expect(noValue(r.run({}))).toBe(true);
    expect(r.run({ L: SUPPLIED })).toBe(6);
    expect(
      noValue(compiled(['List', ['IsMissing', 'L'], ['Sum', 'L']]).run({}))
    ).toBe(true);
  });
});

describe('COMPILE: a binder named like a collection input', () => {
  // A parameter or an index named `L` binds `L` only in its own scope: a
  // free `L` elsewhere in the expression is still the input.
  test('a parameter of a user function', () => {
    const e = new ComputeEngine();
    e.declare('L', 'list<number>');
    e.assign('f', e.box(['Function', ['Length', 'L'], 'L'] as any));
    const r = compile(e.box(['Add', ['f', ['List', 1]], ['Sum', 'L']] as any), {
      fallback: false,
    }) as any;
    expect(noValue(r.run({}))).toBe(true);
    expect(r.run({ L: SUPPLIED })).toBe(7);
  });

  test('an index of a Loop', () => {
    const c = compiled([
      'Block',
      ['Declare', 'a', { str: 'number' }, 0],
      [
        'Loop',
        ['Assign', 'a', ['Add', 'a', 'L']],
        ['Element', 'L', ['List', 1, 2]],
      ],
      ['Add', 'a', ['Length', 'L']],
    ]);
    expect(noValue(c.run({}))).toBe(true);
    expect(c.run({ L: SUPPLIED })).toBe(6);
  });

  test('a parameter of a function literal', () => {
    const c = compiled([
      'List',
      ['Length', 'L'],
      ['Apply', ['Function', 1, 'L'], ['List', 1]],
    ]);
    expect(noValue(c.run({}))).toBe(true);
  });

  test('a parameter that the body assigns a copy of the input', () => {
    // `f(M) := (M ≔ L; Length(M))`: the parameter holds `L` when it is
    // read.
    const e = new ComputeEngine();
    e.declare('L', 'list<number>');
    e.declare('f', '(list<number>) -> integer');
    e.assign(
      'f',
      e.box([
        'Function',
        ['Block', ['Assign', 'M', 'L'], ['Length', 'M']],
        'M',
      ] as any)
    );
    const r = compile(e.box(['f', ['List', 1]] as any), {
      fallback: false,
    }) as any;
    expect(r.entryPlan?.required?.names).toEqual(['L']);
    expect(noValue(r.run({}))).toBe(true);
    expect(r.run({ L: SUPPLIED })).toBe(3);
  });

  // At each level of the DAG, `x` is shared by two function literals, so
  // there are 2^24 paths to the innermost `Sum(L)`. The walk keys its memo
  // by the bound names that occur in the subtree of each node, so a shared
  // subtree is walked once for each such set, and the time grows with the
  // depth, not with the count of paths. An exponential walk takes minutes at
  // this depth (about 7 s at depth 20 with one parameter name, 0.5 s at
  // depth 16 with a name per level), so it fails the Jest time limit of the
  // test; the wall-clock bound is checked under `CE_PERF` only. The DAG is
  // built in the raw form: canonicalization does not share subtrees, so with
  // a name per level it takes about 20 s at depth 19 and runs out of memory
  // at depth 24.
  const sharedDag = (distinctNames: boolean): any => {
    const e = new ComputeEngine();
    e.declare('L', 'list<number>');
    const raw = { form: 'raw' as const };
    let x: any = e.function('Sum', [e.symbol('L')], raw);
    for (let k = 0; k < 24; k++) {
      const a = e.symbol(distinctNames ? `a${k}` : 'a');
      const b = e.symbol(distinctNames ? `b${k}` : 'a');
      const fa = e.function(
        'Function',
        [e.function('Add', [x, a], raw), a],
        raw
      );
      const fb = e.function(
        'Function',
        [e.function('Multiply', [x, b], raw), b],
        raw
      );
      x = e.function(
        'Add',
        [
          e.function('Apply', [fa, e.number(1)], raw),
          e.function('Apply', [fb, e.number(2)], raw),
        ],
        raw
      );
    }
    return x;
  };

  test('a shared subtree under binders of one name is walked once', () => {
    const start = Date.now();
    expect(
      BaseCompiler.collectionReadInputs(sharedDag(false), new Set(['L']))
    ).toEqual(['L']);
    if (process.env.CE_PERF === '1')
      expect(Date.now() - start).toBeLessThan(200);
  });

  test('a shared subtree under binders of different names is walked once', () => {
    // Each path binds another set of names ({a0, b1, a2, …}), none of which
    // occurs in `Sum(L)`: the key of that subtree is the same on every path.
    const start = Date.now();
    expect(
      BaseCompiler.collectionReadInputs(sharedDag(true), new Set(['L']))
    ).toEqual(['L']);
    if (process.env.CE_PERF === '1')
      expect(Date.now() - start).toBeLessThan(200);
  });
});

describe('COMPILE: a collection input read through another name', () => {
  test('the value of a folded symbol', () => {
    // `S := Sum(L)`: the compiled code of `S + 1` reads `L`.
    const e = new ComputeEngine();
    e.declare('L', 'list<number>');
    e.declare('S', 'number');
    e.assign('S', e.box(['Sum', 'L'] as any));
    const r = compile(e.box(['Add', 'S', 1] as any), {
      fallback: false,
    }) as any;
    expect(noValue(r.run({}))).toBe(true);
    expect(r.run({ L: SUPPLIED })).toBe(7);
  });

  test('the body of an engine-assigned user function', () => {
    // `k := t ↦ Sum(y)`, then `f(k(1))`: the call reads `y` in the body
    // of `k`, which the expression does not hold.
    const e = new ComputeEngine();
    e.declare('y', 'list<real>');
    e.assign('f', e.box(['Function', ['Add', 'x', 1], 'x'] as any));
    e.assign('k', e.box(['Function', ['Sum', 'y'], 't'] as any));
    const r = compile(e.box(['f', ['k', 1]] as any), {
      fallback: false,
    }) as any;
    expect(r.entryPlan?.required?.names).toEqual(['y']);
    expect(noValue(r.run({}))).toBe(true);
    expect(r.run({ y: [1, 2, 3] })).toBe(7);
  });

  test('a user function passed as a callback', () => {
    const e = new ComputeEngine();
    e.declare('L', 'list<number>');
    e.assign('g', e.box(['Function', ['Length', 'L'], 't'] as any));
    const r = compile(e.box(['Map', 'g', ['List', 1, 2]] as any), {
      fallback: false,
    }) as any;
    expect(noValue(r.run({}))).toBe(true);
    expect(r.run({ L: SUPPLIED })).toEqual([3, 3]);
  });

  test('a block-local function', () => {
    const c = compiled([
      'Block',
      ['Assign', 'h', ['Function', ['Sum', 'L'], 'u']],
      ['h', 2],
    ]);
    expect(noValue(c.run({}))).toBe(true);
    expect(c.run({ L: SUPPLIED })).toBe(6);
  });

  test('a block local that holds a copy of the input', () => {
    // `M ≔ L`, then `Length(M)`: the local is the absent input.
    const c = compiled([
      'Block',
      ['Declare', 'M', { str: 'list<number>' }],
      ['Assign', 'M', 'L'],
      ['Length', 'M'],
    ]);
    expect(noValue(c.run({}))).toBe(true);
    expect(c.run({ L: SUPPLIED })).toBe(3);
    const loop = compiled([
      'Block',
      ['Declare', 'M', { str: 'list<number>' }],
      ['Assign', 'M', 'L'],
      ['Declare', 'a', { str: 'number' }, 0],
      ['Loop', ['Assign', 'a', ['Add', 'a', 'k']], ['Element', 'k', 'M']],
      'a',
    ]);
    expect(noValue(loop.run({}))).toBe(true);
    expect(loop.run({ L: SUPPLIED })).toBe(6);
  });
});

describe('COMPILE Python: a collection input that the caller leaves out', () => {
  const python = new PythonTarget();

  test('the function routes start with the test', () => {
    const fn = python.compileFunction(
      ce.box(['Add', 'x', ['Length', 'L']] as any),
      'f',
      ['L', 'x']
    );
    expect(fn).toContain("    if L is None:\n        return float('nan')\n");
    expect(
      python.compileLambda(ce.box(['Reverse', 'L'] as any), ['L'])
    ).toMatch(/^lambda L: None if \(L is None\) else /);
    // An input that is not a parameter is a module global: `None`, or not
    // defined.
    expect(
      python.compileFunction(ce.box(['Length', 'L'] as any), 'f', ['x'])
    ).toContain(
      `if __import__("builtins").globals().get("L") is None:\n        return float('nan')`
    );
    // An expression that iterates no collection input has no test.
    expect(
      python.compileFunction(ce.box(['Add', 'x', 1] as any), 'f', ['L', 'x'])
    ).not.toContain('is None');
  });

  test('a parameter that the engine assigns a value is still tested', () => {
    // The function reads the argument `L`, not the value of `L`.
    const e = new ComputeEngine();
    e.declare('L', 'list<number>');
    e.assign('L', e.box(['List', 1, 2] as any));
    const fn = python.compileFunction(
      e.box(['Length', 'L'] as any),
      'f',
      ['L'],
      undefined,
      { constantFold: false }
    );
    expect(fn).toContain('return len(L)');
    expect(fn).toContain("    if L is None:\n        return float('nan')\n");
    expect(
      python.compileLambda(e.box(['Length', 'L'] as any), ['L'], {
        constantFold: false,
      })
    ).toMatch(/^lambda L: float\('nan'\) if \(L is None\) else /);
  });

  const run = TEST_PYTHON === undefined ? test.skip : test;
  run('the run gives NaN or None, and the value when supplied', () => {
    const loop = python.compileFunction(ce.box(LOOP_IN_BLOCK as any), 'loop', [
      'L',
    ]);
    const len = python.compileFunction(
      ce.box(['Add', 'x', ['Length', 'L']] as any),
      'length',
      ['L', 'x']
    );
    const rev = python.compileLambda(ce.box(['Reverse', 'L'] as any), ['L']);
    const glob = python.compileFunction(
      ce.box(['Length', 'L'] as any),
      'glob',
      ['x']
    );
    const script =
      `import numpy as np\nimport math\n${loop}\n${len}\n${glob}\n` +
      `rev = ${rev}\n` +
      `print(repr(loop(None)), repr(loop([3, 1, 2])))\n` +
      `print(repr(length(None, 1)), repr(length([3, 1, 2], 1)))\n` +
      `print(repr(rev(None)), repr(rev([3, 1, 2])))\n` +
      `print(repr(glob(1)))\n` +
      `L = [3, 1, 2]\nprint(repr(glob(1)))\n`;
    const lines = execFileSync(TEST_PYTHON!, ['-c', script], {
      encoding: 'utf-8',
    })
      .trim()
      .split('\n');
    expect(lines).toEqual(['nan 11', 'nan 4', 'None [2, 1, 3]', 'nan', '3']);
  });
});
