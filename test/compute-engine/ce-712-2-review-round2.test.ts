/**
 * Compiled values of calls and callbacks over lists of points, and of
 * callbacks with a parameter that has a default value, compared with
 * `evaluate()` (ROADMAP CE-712.2, second review of the static-shape
 * variants).
 *
 * A point (a tuple) at a parameter with no declared type is bound whole:
 * with `f7 := t ↦ 7` and `rows = [[(1, 2)], [(3, 4), (5, 6)]]`, the
 * interpreter gives `[[7], [7, 7]]` for `f7(rows)` and for `Map(f7, rows)`.
 * Only a parameter declared as a scalar maps over the coordinates of a
 * point: with `g7 := (t: real) ↦ 7`, `g7(rows)` is
 * `[[(7, 7)], [(7, 7), (7, 7)]]`.
 *
 * A callback with a parameter that has a default value receives only the
 * values that its consumer passes, so it fills the parameter: with
 * `q := (x, k = 2) ↦ x·k` local to a block, `Map(q, R)` doubles the
 * elements.
 *
 * Each case is compiled with `fallback: false` on each target. A target
 * that compiles the case must give the interpreter's value; the cases
 * listed as compiled on a target must compile there.
 */

import { execFileSync } from 'node:child_process';
import { ComputeEngine, PythonTarget } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { TEST_PYTHON } from './test-python';
import { variantResultType } from '../../src/compute-engine/compilation/compiler-core';
import { typeToString } from '../../src/common/type/serialize';

type Json = unknown;

const VALUES: Record<string, unknown> = {
  P: [
    [1, 2],
    [3, 4],
  ],
  rows: [[[1, 2]], [[3, 4], [5, 6]]],
  R: [[1, 2], [3]],
  NU: [[[1, 2]], [[1, 2, 3]]],
  G: [
    [1, 2],
    [3, 4],
  ],
  W: [
    [1, 2],
    [3, 4],
  ],
  C: [1, [3, 4]],
  CS: [1, [3, 4]],
  PC: [[1, 2], [3]],
};

/** The MathJSON of the value of each input, for the interpreter. */
const INPUTS: Record<string, Json> = {
  P: ['List', ['Tuple', 1, 2], ['Tuple', 3, 4]],
  rows: [
    'List',
    ['List', ['Tuple', 1, 2]],
    ['List', ['Tuple', 3, 4], ['Tuple', 5, 6]],
  ],
  R: ['List', ['List', 1, 2], ['List', 3]],
  NU: ['List', ['List', ['Tuple', 1, 2]], ['List', ['Tuple', 1, 2, 3]]],
  G: ['List', ['Tuple', 1, 2], ['Tuple', 3, 4]],
  W: ['List', ['Tuple', 1, 2], ['Tuple', 3, 4]],
  C: ['List', 1, ['Tuple', 3, 4]],
  CS: ['List', 1, ['Tuple', 3, 4]],
  PC: ['List', ['Tuple', 1, 2], ['Tuple', 3]],
};

/** `ce` with the Python target, which an engine does not register by
 * default: without it, a compilation to `python` gives no code. */
function withPython(ce: ComputeEngine): ComputeEngine {
  ce.registerCompilationTarget('python', new PythonTarget());
  return ce;
}

function makeEngine(): ComputeEngine {
  const ce = withPython(new ComputeEngine());
  ce.declare('P', 'list<tuple<real, real>>');
  ce.declare('rows', 'list<list<tuple<real, real>>>');
  ce.declare('R', 'list<list<real>>');
  ce.declare(
    'NU',
    'list<list<tuple<real, real>> | list<tuple<real, real, real>>>'
  );
  // A point named through a nominal type (`Row`) or an alias (`mpt`). The
  // compiled code holds a value of a nominal type as a value of its
  // definition.
  ce.declareType('mpt', 'tuple<real, real>', { alias: true });
  ce.declareType('Row', 'tuple<real, real>');
  ce.declare('G', 'list<mpt>');
  ce.declare('W', 'list<Row>');
  ce.declareType('rpt', 'real | tuple<real, real>');
  ce.declare('C', 'list<rpt>');
  ce.declare('CS', 'list<real | tuple<real, real>>');
  ce.declare('PC', 'list<tuple<real> | tuple<real, real>>');
  const define = (name: string, fn: Json) =>
    ce.box(['DefineFunction', name, fn] as never).evaluate();
  define('f7', ['Function', 7, 't']);
  define('f2', ['Function', ['Multiply', 2, 't'], 't']);
  define('h7', ['Function', 7, ['Typed', 't', "'unknown'"]]);
  define('g7', ['Function', 7, ['Typed', 't', "'real'"]]);
  define('fl', ['Function', ['Length', 't'], 't']);
  return ce;
}

/** A JavaScript value of the interpreter result `json`. An absent value
 * (`Missing`) is `undefined`, as in the compiled code. */
function toJs(json: Json): unknown {
  if (typeof json === 'number') return json;
  if (json === 'Missing') return undefined;
  if (json === 'NaN') return NaN;
  if (Array.isArray(json)) {
    const [head, ...rest] = json;
    if (head === 'List' || head === 'Tuple') return rest.map(toJs);
    if (head === 'Negate' && typeof rest[0] === 'number') return -rest[0];
  }
  if (typeof json === 'object' && json !== null && 'num' in json)
    return Number((json as { num: string }).num);
  return json;
}

/** The value of `expr` by the interpreter, with the inputs of `INPUTS`. A
 * lazy collection (the value of `Map`) is read element by element. */
function interpreted(ce: ComputeEngine, expr: Json): unknown {
  const bound = ce
    .box(expr as never)
    .subs(
      Object.fromEntries(
        Object.entries(INPUTS).map(([k, v]) => [k, ce.box(v as never)])
      ) as never
    );
  const read = (x: ReturnType<typeof ce.box>): unknown =>
    x.isCollection && x.operator !== 'List' && x.operator !== 'Tuple'
      ? [...x.each()].map(read)
      : toJs(x.N().json);
  return read(bound.evaluate());
}

/** Deep comparison with a tolerance for numbers. */
function expectClose(actual: unknown, expected: unknown): void {
  if (typeof expected === 'number' && Number.isNaN(expected)) {
    expect(actual).toBeNaN();
    return;
  }
  if (typeof expected === 'number') {
    expect(typeof actual).toBe('number');
    expect(actual as number).toBeCloseTo(expected, 12);
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

/** The midpoint value of an interval-js result. */
function intervalValue(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(intervalValue);
  if (typeof v === 'object' && v !== null && 'kind' in v) {
    const r = v as { kind: string; value?: { lo: number; hi: number } };
    if (r.value !== undefined) return (r.value.lo + r.value.hi) / 2;
    // An `empty` result is the interval form of `NaN` (`docs/ERROR-MODEL.md`).
    if (r.kind === 'empty') return NaN;
  }
  if (typeof v === 'object' && v !== null && 'lo' in v) {
    const r = v as { lo: number; hi: number };
    return (r.lo + r.hi) / 2;
  }
  return v;
}

function intervalInputs(): Record<string, unknown> {
  const conv = (v: unknown): unknown =>
    Array.isArray(v) ? v.map(conv) : typeof v === 'number' ? { lo: v, hi: v } : v;
  return Object.fromEntries(
    Object.entries(VALUES).map(([k, v]) => [k, conv(v)])
  );
}

/** The compilation of `expr` to `to`, or `undefined` when it declines. */
function compiled(ce: ComputeEngine, expr: Json, to: string) {
  try {
    const r = compile(ce.box(expr as never), {
      to,
      fallback: false,
      constantFold: false,
    } as never) as
      | {
          success: boolean;
          code: string;
          preamble?: string;
          run?: (vars: Record<string, unknown>) => unknown;
        }
      | undefined;
    return r?.success ? r : undefined;
  } catch {
    return undefined;
  }
}

function runPython(code: string, preamble: string | undefined): unknown {
  const src = [
    'import json, math',
    'import numpy as np',
    `P = [tuple(p) for p in ${JSON.stringify(VALUES.P)}]`,
    `rows = [[tuple(p) for p in r] for r in ${JSON.stringify(VALUES.rows)}]`,
    `R = ${JSON.stringify(VALUES.R)}`,
    ...['G', 'W'].map(
      (n) =>
        `${n} = [None if p is None else tuple(p) for p in json.loads('${JSON.stringify(VALUES[n])}')]`
    ),
    'C = [1, (3, 4)]',
    'CS = [1, (3, 4)]',
    'PC = [(1, 2), (3,)]',
    preamble ?? '',
    `v = ${code}`,
    'def plain(v):',
    '    if v is None: return None',
    '    if isinstance(v, (list, tuple)): return [plain(e) for e in v]',
    '    return float(v)',
    'print(json.dumps(plain(v)))',
  ].join('\n');
  const out = execFileSync(TEST_PYTHON!, ['-c', src], {
    stdio: ['ignore', 'pipe', 'pipe'],
  }).toString();
  // `None`, the compiled `Missing`, is `null` in JSON.
  const absent = (v: unknown): unknown =>
    v === null ? undefined : Array.isArray(v) ? v.map(absent) : v;
  return absent(JSON.parse(out));
}

const SEVEN = ['Function', 7, 't'];
const TWO_T = ['Function', ['Multiply', 2, 't'], 't'];
/** The call `call` in a block that binds the local `g` to `fn`. */
const LOCAL = (fn: Json, call: Json): Json => [
  'Block',
  ['Assign', 'g', fn],
  call,
];
const UNKNOWN_SEVEN = ['Function', 7, ['Typed', 't', "'unknown'"]];
const Q_BLOCK = (body: Json): Json => [
  'Block',
  [
    'Assign',
    'q',
    ['Function', ['Multiply', 'x', 'k'], 'x', ['Optional', 'k', 2]],
  ],
  body,
];
const UNKNOWN_DEFAULT = [
  'Function',
  'k',
  ['Typed', 'x', "'unknown'"],
  ['Optional', ['Typed', 'k', "'real'"], 2],
];

// [label, expression, the targets that must compile it]
const CASES: [string, Json, string[]][] = [
  // A direct call over a list of lists of points, at a parameter with no
  // declared type: each point is bound whole.
  ['f7(rows)', ['f7', 'rows'], ['javascript']],
  ['h7(rows)', ['h7', 'rows'], ['javascript']],
  ['f2(rows)', ['f2', 'rows'], ['javascript']],
  ['f7(P)', ['f7', 'P'], ['javascript']],
  // At a parameter declared as a scalar, the call maps over the
  // coordinates.
  ['g7(rows)', ['g7', 'rows'], ['javascript', 'interval-js']],
  ['g7(P)', ['g7', 'P'], ['javascript']],
  // A list whose rows hold points of two widths: the list levels do not
  // lead to one point type, so no definition for one point exists, and
  // the callback must not be mapped over the coordinates (that gave
  // `[[[7, 7]], [[7, 7, 7]]]` where the interpreter gives `[[7], [7]]`).
  // No target must compile it; a target that does must give the
  // interpreter's value.
  ['Map(f7, NU)', ['Map', 'f7', 'NU'], []],
  ['Map(f2, NU)', ['Map', 'f2', 'NU'], []],
  // A user function as the callback of `Map`.
  ['Map(f7, rows)', ['Map', 'f7', 'rows'], ['javascript']],
  ['Map(h7, rows)', ['Map', 'h7', 'rows'], ['javascript']],
  ['Map(f2, rows)', ['Map', 'f2', 'rows'], ['javascript']],
  ['Map(f7, P)', ['Map', 'f7', 'P'], ['javascript']],
  ['Map(f7, R)', ['Map', 'f7', 'R'], ['javascript']],
  // A point named through an alias: the definition for one point is read
  // from the definition of the alias. Before, the definition compiled for
  // a scalar received each point, and `Map(f2, G)` gave `[NaN, NaN]`,
  // where the interpreter gives `[(2, 4), (6, 8)]`.
  ['Map(f2, G)', ['Map', 'f2', 'G'], ['javascript']],
  ['f2(G)', ['f2', 'G'], ['javascript']],
  // A list whose elements are a scalar or a point: at a parameter with no
  // declared type, the interpreter runs the body with the scalar and binds
  // the point whole, so the call needs two definitions and a run-time test
  // to choose between them (rule R3). Before, the definition for a scalar
  // received the point, and `Map(f2, CS)` gave `[2, NaN]` where the
  // interpreter gives `[2, (6, 8)]`. No target must compile it, and a
  // target that does must give the interpreter's value.
  ['Map(f2, CS)', ['Map', 'f2', 'CS'], []],
  ['Map(f7, CS)', ['Map', 'f7', 'CS'], []],
  ['f2(CS)', ['f2', 'CS'], []],
  ['f7(CS)', ['f7', 'CS'], []],
  ['Map(t ↦ 2t, CS)', ['Map', TWO_T, 'CS'], []],
  // Consumers of the value of a call over a list of lists of points. The
  // value of `f7(rows)` has two list levels, `[[7], [7, 7]]`; the value of
  // `g7(rows)` has the points, `[[(7, 7)], [(7, 7), (7, 7)]]`.
  ['f7(rows)[2][1]', ['At', ['At', ['f7', 'rows'], 2], 1], ['javascript']],
  // A third index reads into the number 7: the interpreter gives an error.
  [
    'f7(rows)[2][1][1]',
    ['At', ['At', ['At', ['f7', 'rows'], 2], 1], 1],
    [],
  ],
  ['Length(f7(rows))', ['Length', ['f7', 'rows']], ['javascript']],
  [
    'Length(f7(rows)[2])',
    ['Length', ['At', ['f7', 'rows'], 2]],
    ['javascript'],
  ],
  ['f7(rows) + 1', ['Add', ['f7', 'rows'], 1], ['javascript']],
  ['Map(f7, f7(rows))', ['Map', 'f7', ['f7', 'rows']], ['javascript']],
  ['g7(f7(rows))', ['g7', ['f7', 'rows']], ['javascript']],
  ['f7(P)[2]', ['At', ['f7', 'P'], 2], ['javascript']],
  ['f7(P)[2][1]', ['At', ['At', ['f7', 'P'], 2], 1], []],
  ['Length(g7(rows))', ['Length', ['g7', 'rows']], ['javascript']],
  [
    'Length(g7(rows)[2][1])',
    ['Length', ['At', ['At', ['g7', 'rows'], 2], 1]],
    ['javascript'],
  ],
  // A literal: the interpreter binds each element of the source whole.
  ['Map(t ↦ 7, P)', ['Map', SEVEN, 'P'], ['javascript', 'python']],
  ['Map(t ↦ 7, rows)', ['Map', SEVEN, 'rows'], ['javascript', 'python']],
  [
    'Map((t: unknown) ↦ 7, rows)',
    ['Map', UNKNOWN_SEVEN, 'rows'],
    ['javascript', 'python'],
  ],
  // A literal, and a named function whose body reads its parameter, bind
  // each point whole: `Apply(t ↦ 7, P)` is `[7, 7]` and `Map(fl, P)` is
  // `[2, 2]`.
  ['Apply(t ↦ 7, P)', ['Apply', SEVEN, 'P'], ['javascript', 'python']],
  ['Map(fl, P)', ['Map', 'fl', 'P'], ['javascript']],
  // Points of two widths: the list levels do not settle one shape, so the
  // call declines with `unsettled-shape` (rule R3).
  ['f2(PC)', ['f2', 'PC'], []],
  ['f7(PC)', ['f7', 'PC'], []],
  ['Map(f2, PC)', ['Map', 'f2', 'PC'], []],
  ['Apply(t ↦ 7, PC)', ['Apply', SEVEN, 'PC'], []],
  // A callback with a parameter that has a default value.
  ['Block(q ≔ (x, k = 2) ↦ x·k, Map(q, R))', Q_BLOCK(['Map', 'q', 'R']), ['javascript']],
  [
    'Map((x: unknown, k: real = 2) ↦ k, R)',
    ['Map', UNKNOWN_DEFAULT, 'R'],
    ['javascript', 'python'],
  ],
];

// A list of values of a nominal type: `W` of `Row` (declared `tuple<real,
// real>`), `C` of `rpt` (declared `real | tuple<real, real>`). A value of a
// nominal type cannot be built from a plain value (`ce.assign` of `(1, 2)`
// to a symbol of type `Row` is refused), so the plain arrays that the
// compiled code receives are outside the declared type, and its value is
// unspecified (rule R5 of `docs/plans/2026-10-31-static-shape-compilation.md`).
// The interpreter value, read through `subs` of a plain value, is not a
// reference either. Each target must decline or compile.
const NOMINAL_CASES: [string, Json][] = [
  ['Map(f2, W)', ['Map', 'f2', 'W']],
  ['Map(f2, C)', ['Map', 'f2', 'C']],
  ['f2(C)', ['f2', 'C']],
];

describe('a list of values of a nominal type', () => {
  test.each(NOMINAL_CASES)('%s declines or compiles', (_label, expr) => {
    for (const to of ['javascript', 'interval-js', 'python']) {
      const r = compiled(makeEngine(), expr, to);
      expect(r === undefined || typeof r.code === 'string').toBe(true);
    }
  });
});

describe('a compiled value equals the interpreter value', () => {
  test.each(CASES)('%s on javascript', (_label, expr, required) => {
    const ce = makeEngine();
    const r = compiled(ce, expr, 'javascript');
    if (required.includes('javascript')) expect(r).toBeDefined();
    if (r === undefined) return;
    expectClose(r.run!(VALUES), interpreted(ce, expr));
  });

  test.each(CASES)('%s on interval-js', (_label, expr, required) => {
    const ce = makeEngine();
    const r = compiled(ce, expr, 'interval-js');
    if (required.includes('interval-js')) expect(r).toBeDefined();
    if (r === undefined) return;
    const actual = r.run!(intervalInputs());
    const expected = interpreted(ce, expr);
    // `g7(rows)[2][1]` is typed `list<unknown> | unknown`, and its length
    // is the interval `entire`, which contains the interpreter's value 2: an
    // interval result is correct when it contains the value.
    if (_label === 'Length(g7(rows)[2][1])') {
      expect(actual).toMatchObject({ kind: 'entire' });
      expect(typeof expected).toBe('number');
      return;
    }
    expectClose(intervalValue(actual), expected);
  });

  const py = TEST_PYTHON === undefined ? test.skip : test;
  py.each(CASES)('%s on python', (_label, expr, required) => {
    const ce = makeEngine();
    const r = compiled(ce, expr, 'python');
    if (required.includes('python')) expect(r).toBeDefined();
    if (r === undefined) return;
    expectClose(runPython(r.code, r.preamble), interpreted(ce, expr));
  });
});

// A list of points of two widths does not settle one shape (rule R3): the
// call would need a definition for each width and a run-time test.
describe('a list of points of two widths', () => {
  test.each([
    ['f2(PC)', ['f2', 'PC']],
    ['Map(f2, PC)', ['Map', 'f2', 'PC']],
    ['Apply(t ↦ 7, PC)', ['Apply', SEVEN, 'PC']],
  ] as [string, Json][])('%s declines with unsettled-shape', (_l, expr) => {
    const r = compile(makeEngine().box(expr as never), {
      to: 'javascript',
    } as never) as { success: boolean; diagnostic?: { code?: string } };
    expect(r.success).toBe(false);
    expect(r.diagnostic?.code).toBe('unsettled-shape');
  });
});

describe('the code over a list of lists of points', () => {
  test('a direct call maps over the list levels, not the coordinates', () => {
    const r = compiled(makeEngine(), ['f7', 'rows'], 'javascript')!;
    expect(r.code).toBe('_SYS.mapFn(_fn_f7_tuple_real__real_, [2], _.rows)');
  });

  test('a callback maps the definition for one point over each row', () => {
    const r = compiled(makeEngine(), ['Map', 'f7', 'rows'], 'javascript')!;
    expect(r.code).toContain('(_fn_f7_tuple_real__real_$m1)');
    expect(r.code).not.toContain('Array.isArray');
  });

  test('a parameter declared as a scalar maps over the coordinates', () => {
    const r = compiled(makeEngine(), ['g7', 'rows'], 'javascript')!;
    expect(r.code).toContain(', [3], _.rows)');
  });
});

describe('the result type of the variant of a call over a list of points', () => {
  // A consumer of a call whose own type does not settle a rank (an `At`,
  // the rank of an argument of another call, the accumulator of a fold)
  // reads this type. It must have one list level per level that the
  // emitted call maps over.
  const typeOf = (expr: Json): string | undefined => {
    const t = variantResultType(makeEngine().box(expr as never), {} as never);
    return t === undefined ? undefined : typeToString(t);
  };

  test('a parameter with no declared type binds each point whole', () => {
    expect(typeOf(['f7', 'rows'])).toBe('list<list<integer>>');
    expect(typeOf(['h7', 'rows'])).toBe('list<list<integer>>');
    expect(typeOf(['f7', 'P'])).toBe('list<integer>');
  });

  test('a parameter declared as a scalar maps into the coordinates', () => {
    // The compiled code holds a point as an array, so the map over the
    // coordinates gives one more list level.
    expect(typeOf(['g7', 'rows'])).toBe('list<list<list<integer>>>');
  });
});

// An argument declared `broadcastable<real>` has no settled rank: its value
// is a number, or a list of any depth whose leaves are numbers. The host
// that declares this type asks for an open rank, so a call of a function
// with scalar parameters maps the function over every list level at run
// time, with the broadcast helper of the operators, as `b + 1` does. The
// Python target has no such map, and the call declines there.
describe('a call over an argument declared broadcastable<real>', () => {
  const BVALUES: [string, unknown, Json][] = [
    ['a number', 2, 2],
    ['a list', [1, 2], ['List', 1, 2]],
    ['a list of lists', [[1, 2], [3]], ['List', ['List', 1, 2], ['List', 3]]],
  ];
  const engine = (): ComputeEngine => {
    const ce = withPython(new ComputeEngine());
    ce.declare('b', 'broadcastable<real>');
    ce.declare('L', 'list<real>');
    ce.box(['DefineFunction', 'g', ['Function', ['Add', 't', 1], 't']] as never).evaluate();
    ce.box(
      ['DefineFunction', 'h', ['Function', ['Add', 's', 't'], 's', 't']] as never
    ).evaluate();
    return ce;
  };
  const interpretedB = (ce: ComputeEngine, expr: Json, b: Json): unknown =>
    toJs(
      ce
        .box(expr as never)
        .subs({ b: ce.box(b as never) } as never)
        .evaluate()
        .N().json
    );
  const toInterval = (v: unknown): unknown =>
    Array.isArray(v) ? v.map(toInterval) : { lo: v, hi: v };
  const EXPRS: [string, Json][] = [
    ['g(b)', ['g', 'b']],
    ['Apply(t ↦ t + 1, b)', ['Apply', ['Function', ['Add', 't', 1], 't'], 'b']],
    ['g(g(b))', ['g', ['g', 'b']]],
    ['h(b, 3)', ['h', 'b', 3]],
  ];
  for (const [label, expr] of EXPRS)
    for (const [what, js, mj] of BVALUES) {
      test(`${label} for ${what} on javascript`, () => {
        const ce = engine();
        const r = compiled(ce, expr, 'javascript');
        expect(r).toBeDefined();
        expect(r!.code).toContain('_SYS.bcast(');
        expectClose(r!.run!({ b: js }), interpretedB(ce, expr, mj));
      });
      test(`${label} for ${what} on interval-js`, () => {
        const ce = engine();
        const r = compiled(ce, expr, 'interval-js');
        expect(r).toBeDefined();
        expectClose(
          intervalValue(r!.run!({ b: toInterval(js) })),
          interpretedB(ce, expr, mj)
        );
      });
    }

  test('the values of the interpreter', () => {
    const ce = engine();
    expect(interpretedB(ce, ['g', 'b'], 2)).toBe(3);
    expect(interpretedB(ce, ['g', 'b'], ['List', 1, 2])).toEqual([2, 3]);
    expect(
      interpretedB(ce, ['g', ['g', 'b']], ['List', ['List', 1, 2], ['List', 3]])
    ).toEqual([[3, 4], [5]]);
  });

  test('the call declines beside a list of known rank', () => {
    // `_SYS.bcast` maps over every array it receives; the simple version
    // admits only scalars beside the value of open rank.
    expect(compiled(engine(), ['h', 'b', 'L'], 'javascript')).toBeUndefined();
  });

  test('an Apply over the value declines on python', () => {
    const expr = ['Apply', ['Function', ['Add', 't', 1], 't'], 'b'];
    expect(compiled(engine(), expr, 'python')).toBeUndefined();
  });
});

// One point named through a nominal type (`Row`, declared `tuple<real,
// real>`) or an alias (`mpt`, of `tuple<real, real>`), at a parameter with
// no declared type. The interpreter binds the point whole: with
// `f2 := t ↦ 2t`, `f2(r)` is `(2, 4)` for `r = (1, 2)`. The generic
// definition reads the parameter as a scalar, and gave `NaN` for each
// coordinate.
describe('one point named through an alias or a nominal type', () => {
  const engine = (): ComputeEngine => {
    const ce = withPython(new ComputeEngine());
    ce.declareType('Row', 'tuple<real, real>');
    ce.declareType('mpt', 'tuple<real, real>', { alias: true });
    ce.declare('r', 'Row');
    ce.declare('m', 'mpt');
    ce.declare('x', 'real');
    const define = (name: string, fn: Json) =>
      ce.box(['DefineFunction', name, fn] as never).evaluate();
    define('f2', ['Function', ['Multiply', 2, 't'], 't']);
    define('f7', ['Function', 7, 't']);
    return ce;
  };
  /** The value of a point. */
  const POINT: [string, unknown, Json][] = [
    ['a point', [1, 2], ['Tuple', 1, 2]],
  ];
  // [label, expression, the symbol that holds the point]
  const EXPRS: [string, Json, string][] = [
    ['f2(r)', ['f2', 'r'], 'r'],
    ['f2(m)', ['f2', 'm'], 'm'],
    ['Apply(t ↦ 2t, r)', ['Apply', TWO_T, 'r'], 'r'],
    ['Apply(t ↦ 2t, m)', ['Apply', TWO_T, 'm'], 'm'],
    // The same calls of a function local to a block.
    ['Block(g ≔ t ↦ 2t, g(r))', LOCAL(TWO_T, ['g', 'r']), 'r'],
    ['Block(g ≔ t ↦ 2t, g(m))', LOCAL(TWO_T, ['g', 'm']), 'm'],
  ];
  /** The interpreter value; `NaN` is the number `NaN`. */
  const interpretedP = (ce: ComputeEngine, expr: Json, s: string, v: Json) => {
    const read = (j: Json): unknown =>
      j === 'NaN' ? NaN : Array.isArray(j) ? j.map(read) : j;
    return read(
      toJs(
        ce
          .box(expr as never)
          .subs({ [s]: ce.box(v as never), x: ce.box(3) } as never)
          .evaluate()
          .N().json
      )
    );
  };
  const expectSame = (actual: unknown, expected: unknown) => {
    if (typeof expected === 'number' && Number.isNaN(expected))
      expect(actual).toBeNaN();
    else expectClose(actual, expected);
  };
  for (const [label, expr, s] of EXPRS)
    for (const [what, js, mj] of POINT) {
      // `r` (of `Row`) is of a nominal type. A value of
      // a nominal type cannot be built from a plain value, so the plain
      // array that the compiled code receives is outside the declared
      // type, and its value is unspecified (rule R5 of
      // `docs/plans/2026-10-31-static-shape-compilation.md`). Each target
      // must decline or compile.
      if (s === 'r') {
        test(`${label} for ${what} declines or compiles`, () => {
          for (const to of ['javascript', 'interval-js', 'python']) {
            const r = compiled(engine(), expr, to);
            expect(r === undefined || typeof r.code === 'string').toBe(true);
          }
        });
        continue;
      }
      test(`${label} for ${what} on javascript`, () => {
        const ce = engine();
        const r = compiled(ce, expr, 'javascript');
        expect(r).toBeDefined();
        expectSame(r!.run!({ [s]: js, x: 3 }), interpretedP(ce, expr, s, mj));
      });
      test(`${label} for ${what} on interval-js`, () => {
        const ce = engine();
        const r = compiled(ce, expr, 'interval-js');
        if (r === undefined) return;
        const iv = (v: unknown): unknown =>
          Array.isArray(v) ? v.map(iv) : v === undefined ? v : { lo: v, hi: v };
        expectSame(
          intervalValue(r.run!({ [s]: iv(js), x: { lo: 3, hi: 3 } })),
          interpretedP(ce, expr, s, mj)
        );
      });
      const py = TEST_PYTHON === undefined ? test.skip : test;
      py(`${label} for ${what} on python`, () => {
        const ce = engine();
        const r = compiled(ce, expr, 'python');
        if (r === undefined) return;
        const src = [
          'import json, math',
          'import numpy as np',
          `${s} = ${js === undefined ? 'None' : `(${(js as number[]).join(', ')})`}`,
          'x = 3',
          r.preamble ?? '',
          // The code of a block is a list of statements that ends with a
          // `return`.
          ...(r.code.includes('\n')
            ? ['def _f():', ...r.code.split('\n').map((l) => `    ${l}`), 'v = _f()']
            : [`v = ${r.code}`]),
          'def plain(v):',
          '    if v is None: return None',
          '    if isinstance(v, (list, tuple)): return [plain(e) for e in v]',
          '    f = float(v)',
          '    return "NaN" if f != f else f',
          'print(json.dumps(plain(v)))',
        ].join('\n');
        const out = JSON.parse(
          execFileSync(TEST_PYTHON!, ['-c', src], {
            stdio: ['ignore', 'pipe', 'pipe'],
          }).toString()
        );
        const back = (v: unknown): unknown =>
          v === null
            ? undefined
            : v === 'NaN'
              ? NaN
              : Array.isArray(v)
                ? v.map(back)
                : v;
        expectSame(back(out), interpretedP(ce, expr, s, mj));
      });
    }

  test('the values of the interpreter', () => {
    const ce = engine();
    expect(interpretedP(ce, ['f2', 'm'], 'm', ['Tuple', 1, 2])).toEqual([2, 4]);
    // The written symbol `Missing` runs the body: `2·Missing` is `Missing`
    // (an absent value, `undefined` here), and `f7(Missing)` is 7.
    expect(interpretedP(ce, ['f2', 'm'], 'm', 'Missing')).toBeUndefined();
    expect(interpretedP(ce, ['f7', 'm'], 'm', 'Missing')).toBe(7);
  });

  // A function local to a block is bound as the literal compiled for a
  // scalar parameter. On JavaScript the call applies the literal compiled
  // for one point; another target declines, also for a plain tuple: the
  // Python product `2 * y` repeats the tuple `y`.
  test('the call of a block-local function', () => {
    const ce = engine();
    ce.declare('y', 'tuple<real, real>');
    expect(compiled(ce, LOCAL(TWO_T, ['g', 'r']), 'javascript')!.code).toBe(
      '(() => {\nlet g;\ng = ((t) => 2 * t);\nreturn (((t) => [(2 * t[0]), (2 * t[1])]))(_.r)\n})()'
    );
    for (const to of ['interval-js', 'python']) {
      for (const s of ['r', 'm', 'y'])
        expect(compiled(ce, LOCAL(TWO_T, ['g', s]), to)).toBeUndefined();
    }
  });

  test('the direct call takes the definition for one point', () => {
    // A value of a nominal type is bound whole, and the definition of the
    // type (`tuple<real, real>`) is the type of the parameter of the
    // definition that the call selects.
    expect(compiled(engine(), ['f2', 'r'], 'javascript')!.code).toBe(
      '_fn_f2_tuple_real__real_(_.r)'
    );
  });

  // `Missing` is a result only: a declared type cannot name `missing`, so
  // an input cannot be declared as a point that may be absent.
  test('a point declared with missing is a static error', () => {
    expect(() =>
      engine().declare('pm', 'tuple<real, real> | missing')
    ).toThrow();
  });
});

// A value of a nominal type is bound whole (user decision 2026-08-12,
// `type-constructors-compile.test.ts`), also when its definition is
// `broadcastable<real>` or a list of points.
describe('a value of a nominal type whose definition is a list', () => {
  const engine = (): ComputeEngine => {
    const ce = withPython(new ComputeEngine());
    ce.declareType('bn', 'broadcastable<real>');
    ce.declareType('Rows', 'list<tuple<real, real>>');
    ce.declare('b', 'broadcastable<real>');
    ce.declare('n', 'bn');
    ce.declare('L', 'list<Rows>');
    const define = (name: string, fn: Json) =>
      ce.box(['DefineFunction', name, fn] as never).evaluate();
    define('f', ['Function', 7, 's', 't']);
    define('f7', ['Function', 7, 't']);
    return ce;
  };

  // The interpreter binds `n` whole: `f(b, n)` is 7 for `b = 2`. For a list
  // `b` it does not evaluate the call. A broadcast over both arguments gave
  // `[7, 7]` for `b = 2` and `n = [1, 2]`. The call declines on every
  // target: the run-time broadcast maps over every array it receives, and
  // there is no value for a list `b` to match.
  test('a call beside an argument of open rank declines', () => {
    const ce = engine();
    for (const to of ['javascript', 'interval-js', 'python'])
      expect(compiled(ce, ['f', 'b', 'n'], to)).toBeUndefined();
    expect(
      ce
        .box(['f', 'b', 'n'] as never)
        .subs({
          b: ce.box(2),
          n: ce.box(['bn', ['List', 1, 2]] as never),
        } as never)
        .evaluate().json
    ).toBe(7);
  });

  // `Map` gives each value of `Rows` whole to `f7`: `[7, 7]` for two rows.
  test('Map over a list of nominal lists of points', () => {
    const ce = engine();
    const value = ce
      .box(['Map', 'f7', 'L'] as never)
      .subs({
        L: ce.box([
          'List',
          ['Rows', ['List', ['Tuple', 1, 2], ['Tuple', 3, 4]]],
          ['Rows', ['List', ['Tuple', 5, 6]]],
        ] as never),
      } as never)
      .evaluate();
    const expected = [...value.each()].map((x) => x.json);
    expect(expected).toEqual([7, 7]);
    const r = compiled(ce, ['Map', 'f7', 'L'], 'javascript');
    expect(r).toBeDefined();
    expect(r!.run!({ L: [[[1, 2], [3, 4]], [[5, 6]]] })).toEqual(expected);
    const ri = compiled(ce, ['Map', 'f7', 'L'], 'interval-js');
    if (ri !== undefined)
      expect(
        intervalValue(
          ri.run!({
            L: [
              [
                [{ lo: 1, hi: 1 }, { lo: 2, hi: 2 }],
                [{ lo: 3, hi: 3 }, { lo: 4, hi: 4 }],
              ],
              [[{ lo: 5, hi: 5 }, { lo: 6, hi: 6 }]],
            ],
          })
        )
      ).toEqual(expected);
  });
});
