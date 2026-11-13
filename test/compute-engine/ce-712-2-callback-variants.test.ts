/**
 * The value of a callback is the variant for the shape of the values that
 * its consumer passes (ROADMAP CE-712.2, phase C; rule R2 of
 * `docs/plans/2026-10-31-static-shape-compilation.md`).
 *
 * A callback consumer (`Map`, `Filter`, `Reduce`, `Fold`, the sum of a
 * `Map`) passes the elements of its source to the callback. The interpreter
 * applies a callback whose parameters are scalar to each element of a list
 * element: with `f := t ↦ 2t + 1`, `Map(f, [[1, 2], [3, 4]])` is
 * `[[3, 5], [7, 9]]`. The static element type of the source selects the
 * compiled value of the callback:
 *
 * - scalar elements: the function itself (`_fn_f`, the bare arrow of a
 *   literal, `_fn_Sin`);
 * - list elements at scalar parameters: a static map of it
 *   (`const _fn_f$m1 = (_tv1) => _SYS.mapFn(_fn_f, [1], _tv1)`);
 * - point elements: the literal typed by the element, or the function
 *   bound whole;
 * - elements with no settled shape: a decline (rule R3), with the code
 *   `'unsettled-shape'` and the source in `unsupported`.
 *
 * No compiled code of a settled case tests the shape of a value at run
 * time: it has no `Array.isArray` and no `bcastFn`.
 *
 * The cases below compare each compiled value with `evaluate()`.
 */

import { execFileSync } from 'node:child_process';
import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { TEST_PYTHON } from './test-python';

type Json = unknown;

const VALUES: Record<string, unknown> = {
  L: [1, -2, 3],
  M: [
    [1, -2],
    [3, 4],
  ],
  P: [
    [1, -2],
    [3, 4],
  ],
  x: 0.5,
};

/** The MathJSON of the value of each input, for the interpreter. */
const INPUTS: Record<string, Json> = {
  L: ['List', 1, -2, 3],
  M: ['List', ['List', 1, -2], ['List', 3, 4]],
  P: ['List', ['Tuple', 1, -2], ['Tuple', 3, 4]],
  x: 0.5,
};

function makeEngine(): ComputeEngine {
  const ce = new ComputeEngine();
  ce.declare('L', 'list<real>');
  ce.declare('M', 'list<list<real>>');
  ce.declare('P', 'list<tuple<real, real>>');
  ce.declare('x', 'real');
  const define = (name: string, fn: Json) =>
    ce.box(['DefineFunction', name, fn] as never).evaluate();
  define('f', ['Function', ['Add', ['Multiply', 2, 't'], 1], 't']);
  define('g', ['Function', ['Add', 'a', 'b'], 'a', 'b']);
  // A multi-clause function: one clause for each number of arguments.
  define('mc', ['Function', ['Add', ['Multiply', 3, 'x'], 1], 'x']);
  define('mc', ['Function', ['Add', 'x', 'y'], 'x', 'y']);
  return ce;
}

const LIT = ['Function', ['Multiply', 2, 't'], 't'];
const POINT_LIT = ['Function', ['Add', ['At', 'p', 1], ['At', 'p', 2]], 'p'];
const SUM_LIT = ['Function', ['Add', 'a', 'b'], 'a', 'b'];

/** A JavaScript value of the interpreter result `json`. */
function toJs(json: Json): unknown {
  if (typeof json === 'number') return json;
  if (typeof json === 'string') {
    if (json === 'NaN') return NaN;
    return json;
  }
  if (Array.isArray(json)) {
    const [head, ...rest] = json;
    if (head === 'List' || head === 'Tuple') return rest.map(toJs);
    if (head === 'Negate' && typeof rest[0] === 'number') return -rest[0];
  }
  if (typeof json === 'object' && json !== null && 'num' in json)
    return Number((json as { num: string }).num);
  return json;
}

/** The value of `expr` by the interpreter, with the inputs of `INPUTS`. */
function interpreted(ce: ComputeEngine, expr: Json): unknown {
  const e = ce.box(expr as never);
  const bound = e.subs(
    Object.fromEntries(
      Object.entries(INPUTS).map(([k, v]) => [k, ce.box(v as never)])
    ) as never
  );
  const r = bound.evaluate();
  if (r.isCollection && r.operator !== 'List' && r.operator !== 'Tuple')
    return [...r.each()].map((x) => toJs(x.N().json));
  return toJs(r.N().json);
}

/** Deep comparison with a tolerance for numbers. */
function expectClose(actual: unknown, expected: unknown): void {
  if (typeof expected === 'number') {
    expect(typeof actual).toBe('number');
    if (Number.isNaN(expected)) expect(Number.isNaN(actual)).toBe(true);
    else expect(actual as number).toBeCloseTo(expected, 12);
    return;
  }
  if (Array.isArray(expected)) {
    expect(Array.isArray(actual)).toBe(true);
    expect((actual as unknown[]).length).toBe(expected.length);
    expected.forEach((e, i) => expectClose((actual as unknown[])[i], e));
    return;
  }
  expect(actual).toEqual(expected);
}

/** The midpoint value of an interval-js result, for a point input. */
function intervalValue(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(intervalValue);
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (typeof v === 'object' && v !== null && 'kind' in v) {
    const r = v as { kind: string; value?: { lo: number; hi: number } };
    if (r.kind === 'empty') return NaN;
    if (r.value !== undefined) return (r.value.lo + r.value.hi) / 2;
  }
  if (typeof v === 'object' && v !== null && 'lo' in v) {
    const r = v as { lo: number; hi: number };
    return (r.lo + r.hi) / 2;
  }
  return v;
}

/** The interval inputs of `VALUES`: each number is a point interval. */
function intervalInputs(): Record<string, unknown> {
  const conv = (v: unknown): unknown =>
    Array.isArray(v) ? v.map(conv) : typeof v === 'number' ? { lo: v, hi: v } : v;
  return Object.fromEntries(
    Object.entries(VALUES).map(([k, v]) => [k, conv(v)])
  );
}

function compileTo(ce: ComputeEngine, expr: Json, to: string) {
  return compile(ce.box(expr as never), {
    to,
    fallback: false,
    constantFold: false,
  } as never)!;
}

/** Assert that `code` tests the shape of no value at run time. */
function expectNoShapeTest(code: string): void {
  expect(code).not.toContain('Array.isArray');
  expect(code).not.toContain('bcastFn');
}

// The settled cases, on JavaScript: a consumer, a callback and a source.
const JS_CASES: [string, Json][] = [
  // Map: a user function, a literal, a multi-clause function, built-ins.
  ['Map(f, L)', ['Map', 'f', 'L']],
  ['Map(f, M)', ['Map', 'f', 'M']],
  ['Map(t ↦ 2t, L)', ['Map', LIT, 'L']],
  ['Map(t ↦ 2t, M)', ['Map', LIT, 'M']],
  ['Map(t ↦ 2t, P)', ['Map', LIT, 'P']],
  ['Map(p ↦ p₁ + p₂, P)', ['Map', POINT_LIT, 'P']],
  ['Map(mc, L)', ['Map', 'mc', 'L']],
  ['Map(mc, M)', ['Map', 'mc', 'M']],
  ['Map(Sin, L)', ['Map', 'Sin', 'L']],
  ['Map(Sin, M)', ['Map', 'Sin', 'M']],
  ['Map(Abs, L)', ['Map', 'Abs', 'L']],
  ['Map(Abs, M)', ['Map', 'Abs', 'M']],
  // A function local to a block, used as a value.
  [
    'Block(q ≔ s ↦ 3s, Map(q, M))',
    [
      'Block',
      ['Declare', 'q', "'unknown'", ['Function', ['Multiply', 3, 's'], 's']],
      ['Map', 'q', 'M'],
    ],
  ],
  // Filter.
  ['Filter(L, t ↦ t > 0)', ['Filter', 'L', ['Function', ['Greater', 't', 0], 't']]],
  [
    'Filter(M, r ↦ r₁ > 0)',
    ['Filter', 'M', ['Function', ['Greater', ['At', 'r', 1], 0], 'r']],
  ],
  [
    'Filter(P, p ↦ p₁ > 0)',
    ['Filter', 'P', ['Function', ['Greater', ['At', 'p', 1], 0], 'p']],
  ],
  // Reduce and Fold.
  ['Reduce(L, (a, b) ↦ a + b, 0)', ['Reduce', 'L', SUM_LIT, 0]],
  ['Fold(g, 0, L)', ['Fold', 'g', 0, 'L']],
  ['Reduce(M, (a, b) ↦ a + b, [0, 0])', ['Reduce', 'M', SUM_LIT, ['List', 0, 0]]],
  // Apply of a literal.
  ['Apply(t ↦ 2t, x)', ['Apply', LIT, 'x']],
  ['Apply(t ↦ 2t, L)', ['Apply', LIT, 'L']],
  ['Apply(t ↦ 2t, M)', ['Apply', LIT, 'M']],
  // The sum of a map, which the compiled code fuses into one loop.
  ['Sum(Map(f, L))', ['Sum', ['Map', 'f', 'L']]],
  ['Sum(Map(t ↦ 2t, L))', ['Sum', ['Map', LIT, 'L']]],
  ['Sum(Map(Sin, L))', ['Sum', ['Map', 'Sin', 'L']]],
];

describe('javascript: the callback is the variant for the element shape', () => {
  test.each(JS_CASES)('%s', (_label, expr) => {
    const ce = makeEngine();
    const r = compileTo(ce, expr, 'javascript');
    expect(r.success).toBe(true);
    expectNoShapeTest(`${r.preamble ?? ''}\n${r.code}`);
    expectClose(r.run!(VALUES as never), interpreted(ce, expr));
  });

  test('a scalar element takes the function itself', () => {
    const r = compileTo(makeEngine(), ['Map', 'f', 'L'], 'javascript');
    expect(r.code).toContain('(_fn_f)');
  });

  test('a list element takes the static map of the function', () => {
    const r = compileTo(makeEngine(), ['Map', 'f', 'M'], 'javascript');
    expect(r.code).toContain('(_fn_f$m1)');
    expect(r.preamble).toContain(
      'const _fn_f$m1 = ((_tv1) => _SYS.mapFn(_fn_f, [1], _tv1));'
    );
  });

  test('a built-in over list elements takes the static map of its value', () => {
    const r = compileTo(makeEngine(), ['Map', 'Sin', 'M'], 'javascript');
    expect(r.preamble).toContain('_SYS.mapFn(_fn_Sin, [1], ');
  });
});

describe('interval-js: the callback is the variant for the element shape', () => {
  // The consumers of a function value that compile on interval-js: a
  // literal (`Map` over a list of numbers, the sum of such a map) and the
  // application of a literal to a scalar. A named function as a `Map`
  // callback has no interval-js lowering (it declines at HEAD too).
  const CASES: [string, Json][] = [
    ['Map(t ↦ 2t, L)', ['Map', LIT, 'L']],
    ['Apply(t ↦ 2t, x)', ['Apply', LIT, 'x']],
    ['Sum(Map(t ↦ 2t, L))', ['Sum', ['Map', LIT, 'L']]],
  ];
  test.each(CASES)('%s', (_label, expr) => {
    const ce = makeEngine();
    const r = compileTo(ce, expr, 'interval-js');
    expect(r.success).toBe(true);
    // The `Array.isArray` of the interval-js `Sum` tests its own operand,
    // not the value of a callback: the callback is the bare arrow.
    expect(r.code).not.toContain('bcastFn');
    expect(r.code).not.toContain('Array.isArray(_tv');
    expectClose(
      intervalValue(r.run!(intervalInputs() as never)),
      interpreted(ce, expr)
    );
  });
});

describe('python: the callback is the variant for the element shape', () => {
  // The consumers of a callback that compile on Python: a literal, as the
  // callback of `Map`, `Filter` and `Reduce`, and as the head of `Apply`.
  // A named function has no Python lambda form (it declines at HEAD too).
  const CASES: [string, Json][] = [
    ['Map(t ↦ 2t, L)', ['Map', LIT, 'L']],
    ['Map(t ↦ 2t, M)', ['Map', LIT, 'M']],
    ['Map(p ↦ p₁ + p₂, P)', ['Map', POINT_LIT, 'P']],
    ['Filter(L, t ↦ t > 0)', ['Filter', 'L', ['Function', ['Greater', 't', 0], 't']]],
    [
      'Filter(M, r ↦ r₁ > 0)',
      ['Filter', 'M', ['Function', ['Greater', ['At', 'r', 1], 0], 'r']],
    ],
    ['Reduce(L, (a, b) ↦ a + b, 0)', ['Reduce', 'L', SUM_LIT, 0]],
    ['Apply(t ↦ 2t, x)', ['Apply', LIT, 'x']],
    ['Apply(t ↦ 2t, L)', ['Apply', LIT, 'L']],
    ['Apply(t ↦ 2t, M)', ['Apply', LIT, 'M']],
  ];
  // The `isinstance` tests in the code of `At` are the bound checks of an
  // index read, not a test of the value of a callback.
  test.each(CASES)('%s compiles', (_label, expr) => {
    const r = compileTo(makeEngine(), expr, 'python');
    expect(r.success).toBe(true);
  });

  const runPython = TEST_PYTHON === undefined ? test.skip : test;
  runPython.each(CASES)('%s gives the interpreter value', (_label, expr) => {
    const ce = makeEngine();
    const r = compileTo(ce, expr, 'python');
    const src = [
      'import json, math',
      'import numpy as np',
      `L = ${JSON.stringify(VALUES.L)}`,
      `M = ${JSON.stringify(VALUES.M)}`,
      `P = [tuple(p) for p in ${JSON.stringify(VALUES.P)}]`,
      `x = ${VALUES.x}`,
      r.preamble ?? '',
      `v = ${r.code}`,
      'def plain(v):',
      '    if isinstance(v, (list, tuple)): return [plain(e) for e in v]',
      '    return float(v)',
      'print(json.dumps(plain(v)))',
    ].join('\n');
    const out = execFileSync(TEST_PYTHON!, ['-c', src], {
      stdio: ['ignore', 'pipe', 'pipe'],
    }).toString();
    expectClose(JSON.parse(out), interpreted(ce, expr));
  });
});

describe('an element with no settled shape declines (rule R3)', () => {
  test.each([
    ['a user function', 'f'],
    ['a literal', LIT],
    ['a built-in', 'Sin'],
  ])('%s over list<real | list<real>>', (_label, callback) => {
    const ce = makeEngine();
    ce.declare('U', 'list<real | list<real>>');
    const r = compile(ce.box(['Map', callback, 'U'] as never), {
      constantFold: false,
    } as never)!;
    expect(r.success).toBe(false);
    expect(r.diagnostic?.code).toBe('unsettled-shape');
    expect(r.unsupported).toContain('U');
  });

  test('a literal list of elements of two shapes (decision D7)', () => {
    // `[1, [2, 3]]` has the element type `number | vector<2>`. The
    // interpreter gives `[3, [5, 7]]`; the compiled code would need a
    // run-time test of each element to choose the map.
    const ce = makeEngine();
    const expr = ['Map', 'f', ['List', 1, ['List', 2, 3]]];
    expect(ce.box(expr as never).evaluate().toString()).toBe('[3,[5,7]]');
    const r = compile(ce.box(expr as never), { constantFold: false } as never)!;
    expect(r.success).toBe(false);
    expect(r.diagnostic?.code).toBe('unsettled-shape');
  });

  test('a fold whose accumulator is a scalar, then a list', () => {
    // The accumulator of `Fold(g, 0, M)` is `0` at the first step and a row
    // after it (`g` maps over the row), so its shape is not settled.
    const ce = makeEngine();
    const expr = ['Fold', 'g', 0, 'M'];
    expect(ce.box(expr as never).subs({ M: ce.box(INPUTS.M as never) } as never).evaluate().toString()).toBe('[4,2]');
    const r = compile(ce.box(expr as never), { constantFold: false } as never)!;
    expect(r.success).toBe(false);
    expect(r.diagnostic?.code).toBe('unsettled-shape');
  });

  test('a ragged literal list has elements of one shape', () => {
    // `[[1, 2], [3]]`: both rows are lists of numbers, so the map is
    // static.
    const ce = makeEngine();
    const expr = ['Map', LIT, ['List', ['List', 1, 2], ['List', 3]]];
    const r = compileTo(ce, expr, 'javascript');
    expect(r.success).toBe(true);
    expectNoShapeTest(r.code);
    expect(r.run!({})).toEqual([[2, 4], [6]]);
  });
});

describe('a function value with no consumer is the scalar variant', () => {
  test('the root value of a named function', () => {
    const r = compileTo(makeEngine(), 'f', 'javascript');
    expect(r.success).toBe(true);
    expectNoShapeTest(`${r.preamble ?? ''}\n${r.code}`);
  });
});

// ROADMAP CE-256: a record element reached a callback parameter with no
// type through the broadcast wrapper, which tested `Array.isArray` and
// would map over the fields of a record held as an array. The static type
// of the element now selects the variant, and a record reaches the
// function whole, as in the interpreter.
describe('a record element reaches the callback whole (CE-256)', () => {
  test('Map(k, persons)', () => {
    const ce = new ComputeEngine();
    ce.declare('persons', 'list<record{age: real, h: real}>');
    ce.box(['DefineFunction', 'k', ['Function', 'p', 'p']] as never).evaluate();
    const expr = ce.box(['Map', 'k', 'persons'] as never);
    const value = ce.box([
      'List',
      ['Dictionary', ['Tuple', "'age'", 3], ['Tuple', "'h'", 1]],
      ['Dictionary', ['Tuple', "'age'", 5], ['Tuple', "'h'", 2]],
    ] as never);
    const interp = expr.subs({ persons: value } as never).evaluate();
    expect([...interp.each()].map((x) => x.json)).toEqual([
      { dict: { age: 3, h: 1 } },
      { dict: { age: 5, h: 2 } },
    ]);
    const r = compile(expr, { fallback: false } as never)!;
    expect(r.success).toBe(true);
    expectNoShapeTest(`${r.preamble ?? ''}\n${r.code}`);
    expect(
      r.run!({
        persons: [
          { age: 3, h: 1 },
          { age: 5, h: 2 },
        ],
      } as never)
    ).toEqual([
      { age: 3, h: 1 },
      { age: 5, h: 2 },
    ]);
  });
});

// ROADMAP CE-338: the application of a literal to a list built the
// broadcast wrapper around the literal at each evaluation. It is now a
// static map of the bare literal.
describe('the application of a literal to a list is a static map (CE-338)', () => {
  test('Apply(t ↦ 2t, L)', () => {
    const ce = makeEngine();
    const r = compileTo(ce, ['Apply', LIT, 'L'], 'javascript');
    expect(r.code).toBe('_SYS.mapFn((((t) => 2 * t)), [1], _.L)');
    expectClose(r.run!(VALUES as never), interpreted(ce, ['Apply', LIT, 'L']));
  });
});

// ROADMAP CE-693: a parameter declared `expression` that receives a
// collection. The interpreter binds the collection whole, and the body maps
// over it. The callback is the variant with the parameter typed by the
// element.
describe('a parameter declared `expression` takes the variant typed by the element (CE-693)', () => {
  const setup = () => {
    const ce = new ComputeEngine();
    ce.declare('h', 'function');
    ce.assign(
      'h',
      ce.box(['Function', ['Multiply', 2, 't'], ['Typed', 't', "'expression'"]] as never)
    );
    ce.declare('rows', 'list<list<real>>');
    ce.declare('L', 'list<real>');
    return ce;
  };
  const rows = [
    [1, 2],
    [3, 4],
  ];

  test('Map(h, rows)', () => {
    const ce = setup();
    const e = ce.box(['Map', 'h', 'rows'] as never);
    expect(
      e
        .subs({ rows: ce.box(['List', ['List', 1, 2], ['List', 3, 4]] as never) } as never)
        .evaluate()
        .toString()
    ).toBe('[[2,4],[6,8]]');
    const r = compile(e, { fallback: false } as never)!;
    expect(r.success).toBe(true);
    expectNoShapeTest(`${r.preamble ?? ''}\n${r.code}`);
    expect(r.run!({ rows } as never)).toEqual([
      [2, 4],
      [6, 8],
    ]);
  });

  test('Map(h, L)', () => {
    const ce = setup();
    const r = compile(ce.box(['Map', 'h', 'L'] as never), {
      fallback: false,
    } as never)!;
    expect(r.success).toBe(true);
    expect(r.run!({ L: [1, 2] } as never)).toEqual([2, 4]);
  });
});

// A union of shapes declared at an input cannot have a `missing` member or
// element (`docs/ERROR-MODEL.md`, "`Missing` is a result only").
describe('interval-js: the shape dispatch of a declared union', () => {
  test('a union with an absent member cannot be declared', () => {
    const ce = makeEngine();
    expect(() =>
      ce.declare('U', 'list<real> | list<list<real> | missing>')
    ).toThrow(/cannot be declared/);
  });
});

// `Max` over a list of values of a nominal type. The compiled code
// flattened the list and compared the components of each value; the
// interpreter binds a nominal value whole, and no value of such a list can
// be built from a list of tuples (`ce.assign` refuses it as incompatible).
// The compiled code declines.
describe('Max over a list of nominal values declines', () => {
  test('Max(R), R: list<Row>, Row declared tuple<real, real>', () => {
    const ce = new ComputeEngine();
    ce.declareType('Row', 'tuple<real, real>');
    ce.declare('R', 'list<Row>');
    expect(() =>
      ce.assign('R', ce.box(['List', ['Tuple', 1, 5], ['Tuple', 3, 2]] as never))
    ).toThrow(/not compatible/);
    const r = compile(ce.box(['Max', 'R'] as never), {} as never)!;
    expect(r.success).toBe(false);
  });
});
