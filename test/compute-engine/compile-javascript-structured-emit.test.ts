import { ComputeEngine, compile } from '../../src/compute-engine';
import {
  ScalarFragmentJavaScriptTarget,
  type StructuredPhase,
  type StructuredRouteHooks,
} from '../../src/compute-engine/compilation/javascript-fragment-target';
import { core } from '../../src/compute-engine/compilation/compiler-core-hooks';
import { BaseCompiler } from '../../src/compute-engine/compilation/base-compiler';
import {
  createSysRuntime,
  normalizeRunResult,
} from '../../src/compute-engine/compilation/javascript-runtime';
import { emitStructuredProgram } from '../../src/compute-engine/compilation/javascript-structured-emit';
import { verifyJavaScriptProgram as verifyProgram } from '../../src/compute-engine/compilation/javascript-structured-policy';
import {
  type IROperation,
  type IRProgram,
  type IRValue,
  type ScalarKind,
} from '../../src/compute-engine/compilation/structured-ir';
import type { CompilationResult } from '../../src/compute-engine/compilation/types';
import type { Expression } from '../../src/compute-engine/global-types';
import type { MathJsonExpression } from '../../src/math-json/types';

// The emitter of the structured representation of the internal scalar
// JavaScript fragment target, and the structured route of `compile()` (step 3
// of docs/plans/2026-11-09-js-compiler-status-and-plan.md).

const typed = (name: string, type: string): MathJsonExpression => [
  'Typed',
  name,
  `'${type}'`,
];

const OPTIONS = { cse: false, constantFold: false } as const;

const HEATWALL_BODY: MathJsonExpression = [
  'And',
  ['Greater', 'obstacle', 0.5],
  ['Equal', 'c', 16],
  ['Or', ['Less', 'r', 13], ['Greater', 'r', 18]],
];

const HEATCELL: MathJsonExpression = [
  'Function',
  [
    'Block',
    ['Declare', 'a', "'real'", ['Min', 0.25, ['Max', 0, 'd']]],
    [
      'If',
      ['heatwall', 'c', 'r', 'obstacle'],
      'v',
      ['Add', 'v', ['Multiply', 'a', ['Subtract', 's', ['Multiply', 4, 'v']]]],
    ],
  ],
  typed('v', 'real'),
  typed('s', 'real'),
  typed('d', 'real'),
  typed('c', 'integer'),
  typed('r', 'integer'),
  typed('obstacle', 'real'),
];

/** `a` is read three times; its initializer is evaluated once. */
const LOCAL_READ_THRICE: MathJsonExpression = [
  'Function',
  [
    'Block',
    ['Declare', 'a', "'real'", ['Max', 0, 'd']],
    ['Add', 'a', ['Multiply', 'a', 'v'], ['Negate', 'a']],
  ],
  typed('d', 'real'),
  typed('v', 'real'),
];

/** An engine with the helpers `heatwall`, `g` (one real parameter) and `h`
 *  (two), the test heads, and the free symbols of the fixtures. */
function engine(): ComputeEngine {
  const ce = new ComputeEngine();
  ce.declare('heatwall', '(integer, integer, real) -> boolean');
  ce.assign(
    'heatwall',
    ce.expr([
      'Function',
      HEATWALL_BODY,
      typed('c', 'integer'),
      typed('r', 'integer'),
      typed('obstacle', 'real'),
    ])
  );
  ce.declare('g', '(real) -> real');
  ce.assign('g', ce.expr(['Function', ['Add', ['Max', 0, 't'], 1], typed('t', 'real')]));
  ce.declare('h', '(real, real) -> real');
  ce.assign(
    'h',
    ce.expr(['Function', ['Add', 'p', ['Multiply', 2, 'q']], typed('p', 'real'), typed('q', 'real')])
  );
  for (const [name, type] of [
    ['x', 'real'],
    ['y', 'real'],
    ['z', 'complex'],
    ['C', 'boolean'],
    ['D', 'boolean'],
    ['c', 'integer'],
    ['r', 'integer'],
    ['obstacle', 'real'],
  ])
    ce.declare(name, type);
  // `console` is an impurity label: the definition states an effect.
  ce.declare('Trace', {
    signature: '(real) -> real',
    effects: ['console'],
    evaluate: (ops) => ops[0],
  } as never);
  return ce;
}

const TESTS = new Map([['Trace', 'trace']]);

/** The source of the test operation: a call of the global `__ceTrace`. */
const TRACE_SOURCE = (id: string, operands: readonly string[]) =>
  `globalThis.__ceTrace(${JSON.stringify(id)}, ${operands.join(', ')})`;

const structured = (hooks: StructuredRouteHooks = {}) =>
  new ScalarFragmentJavaScriptTarget('structured', TESTS, {
    trace: TRACE_SOURCE,
    ...hooks,
  });

type Value = number | boolean | { re: number; im: number };
type Inputs = Record<string, Value> | Value[];

/** Run `result` on `inputs`: the arguments of a lambda, or the vars. */
function run(result: CompilationResult<'javascript'>, inputs: Inputs): unknown {
  return Array.isArray(inputs)
    ? (result.run as unknown as (...a: unknown[]) => unknown)(...inputs)
    : result.run!(inputs as never);
}

function boxValue(ce: ComputeEngine, v: Value): Expression {
  if (typeof v === 'boolean') return v ? ce.True : ce.False;
  if (typeof v === 'number') return ce.number(v);
  return ce.expr(['Complex', v.re, v.im]);
}

/** The value of `json` on `inputs` by the interpreter. */
function interpret(ce: ComputeEngine, json: MathJsonExpression, inputs: Inputs): unknown {
  const value = Array.isArray(inputs)
    ? ce.function('Apply', [ce.expr(json), ...inputs.map((v) => boxValue(ce, v))]).evaluate()
    : ce
        .expr(json)
        .subs(Object.fromEntries(Object.entries(inputs).map(([k, v]) => [k, boxValue(ce, v)])))
        .evaluate();
  if (value.symbol === 'True') return true;
  if (value.symbol === 'False') return false;
  const n = value.N();
  if (n.im === 0) return n.re;
  return { re: n.re, im: n.im };
}

/** Equal values, with `0` equal to `-0`: the interpreter does not keep the
 *  sign of a zero (a boxed `-0` is `0`). */
function sameValue(a: unknown, b: unknown): boolean {
  if (typeof a === 'number' && typeof b === 'number')
    return a === b || (Number.isNaN(a) && Number.isNaN(b));
  if (typeof a === 'object' && typeof b === 'object' && a !== null && b !== null)
    return (
      sameValue((a as { re: number }).re, (b as { re: number }).re) &&
      sameValue((a as { im: number }).im, (b as { im: number }).im)
    );
  return a === b;
}

//
// The fixtures
//

type Fixture = {
  name: string;
  json: MathJsonExpression;
  inputs: Inputs[];
};

function product<T>(...lists: T[][]): T[][] {
  return lists.reduce<T[][]>((acc, list) => acc.flatMap((a) => list.map((x) => [...a, x])), [[]]);
}

const FIXTURES: Fixture[] = [
  {
    // Both outcomes of each condition: `obstacle > 0.5` (0.5 is false),
    // `c == 16`, `r < 13` and `r > 18` (13 and 18 are false).
    name: 'heatwall',
    json: HEATWALL_BODY,
    inputs: product<number>([0, 0.5, 1], [15, 16], [12, 13, 15, 18, 19]).map(
      ([obstacle, c, r]) => ({ obstacle, c, r })
    ),
  },
  {
    // Interior (not the wall column), boundary (the wall column, rows 13
    // and 18, not a wall), wall (rows 12 and 19 with an obstacle), and the
    // clamps of `d` at both ends.
    name: 'heatcell',
    json: HEATCELL,
    inputs: [
      [1, 2, 0.1, 3, 15, 0],
      [1, 2, 0.1, 16, 13, 1],
      [1, 2, 0.1, 16, 18, 1],
      [1, 2, 0.1, 16, 12, 1],
      [1, 2, 0.1, 16, 19, 1],
      [1, 2, 0.1, 16, 19, 0.5],
      [1, 2, -1, 3, 15, 0],
      [1, 2, 1, 3, 15, 0],
      [-3, 0.5, 0.25, 16, 15, 1],
    ],
  },
  {
    name: 'If(C, x, z) + y',
    json: ['Add', ['If', 'C', 'x', 'z'], 'y'],
    inputs: [true, false].map((C) => ({ C, x: 1, y: 2, z: { re: 3, im: 4 } })),
  },
  {
    name: 'nested If',
    json: ['If', 'C', ['If', 'D', 'x', 'y'], ['Negate', 'x']],
    inputs: product<boolean>([true, false], [true, false]).map(([C, D]) => ({ C, D, x: 1, y: 2 })),
  },
  {
    name: 'Max(x, y)',
    json: ['Max', 'x', 'y'],
    inputs: [
      { x: 2, y: 2 },
      { x: -0, y: 0 },
      { x: 0, y: -0 },
      { x: NaN, y: 1 },
      { x: -1, y: 3 },
    ],
  },
  {
    name: 'Min(x, y)',
    json: ['Min', 'x', 'y'],
    inputs: [
      { x: 2, y: 2 },
      { x: -0, y: 0 },
      { x: 0, y: -0 },
      { x: NaN, y: 1 },
      { x: -1, y: 3 },
    ],
  },
  {
    name: 'Equal(c, x), an integer and a real',
    json: ['Equal', 'c', 'x'],
    inputs: [
      { c: 1, x: 1 },
      { c: 1, x: 1.5 },
      { c: -2, x: -2 },
    ],
  },
  {
    name: '0·x',
    json: ['Multiply', 0, 'x'],
    inputs: [{ x: Infinity }, { x: -Infinity }, { x: NaN }, { x: 2 }],
  },
  { name: 'x + z', json: ['Add', 'x', 'z'], inputs: [{ x: 2, z: { re: 3, im: 4 } }] },
  { name: '-z', json: ['Negate', 'z'], inputs: [{ z: { re: 3, im: 4 } }] },
  {
    name: 'x - z',
    json: ['Add', 'x', ['Negate', 'z']],
    inputs: [{ x: 1, z: { re: 3, im: 4 } }],
  },
  {
    name: '-If(C, x, z)',
    json: ['Negate', ['If', 'C', 'x', 'z']],
    inputs: [true, false].map((C) => ({ C, x: 5, z: { re: 3, im: 4 } })),
  },
  {
    name: 'x + (1+2i)',
    json: ['Add', 'x', ['Complex', 1, 2]],
    inputs: [{ x: 1 }],
  },
  {
    name: 'a helper called twice',
    json: ['Add', ['g', 'x'], ['g', 'y']],
    inputs: [
      { x: -1, y: 2 },
      { x: 3, y: -4 },
    ],
  },
  {
    name: 'heatwall called twice, the second call in a region of Or',
    json: ['Or', ['heatwall', 'c', 'r', 'x'], ['heatwall', 'r', 'c', 'y']],
    inputs: [
      { c: 16, r: 12, x: 1, y: 0 },
      { c: 12, r: 16, x: 1, y: 1 },
      { c: 3, r: 3, x: 1, y: 1 },
    ],
  },
  {
    name: 'a local read several times',
    json: LOCAL_READ_THRICE,
    inputs: [
      [-2, 3],
      [2, 3],
    ],
  },
  // Negative and non-finite literals. The canonical form writes
  // `Negate(-3)` as the literal `3` and `Negate(Complex(1, -2))` as the
  // literal `Complex(-1, 2)`; it keeps `Negate(If(C, x, -2))`. An infinite
  // literal is the symbol `PositiveInfinity` or `NegativeInfinity` and NaN
  // the symbol `NaN`: admission accepts them as number literals.
  { name: 'Negate(-3), the literal 3', json: ['Negate', -3], inputs: [{}] },
  {
    name: 'Negate(Complex(1, -2)), the literal -1+2i',
    json: ['Negate', ['Complex', 1, -2]],
    inputs: [{}],
  },
  {
    name: '-If(C, x, -2)',
    json: ['Negate', ['If', 'C', 'x', -2]],
    inputs: [true, false].map((C) => ({ C, x: 5 })),
  },
  { name: 'x + -2', json: ['Add', 'x', -2], inputs: [{ x: 1 }] },
  { name: 'x + (-1-2i)', json: ['Add', 'x', ['Complex', -1, -2]], inputs: [{ x: 1 }] },
  {
    name: 'z + (1-2i)',
    json: ['Add', 'z', ['Complex', 1, -2]],
    inputs: [{ z: { re: 3, im: 4 } }],
  },
  { name: 'x·-4', json: ['Multiply', 'x', -4], inputs: [{ x: 1.5 }, { x: -0 }] },
  {
    name: 'x + Infinity',
    json: ['Add', 'x', { num: 'Infinity' }],
    inputs: [{ x: 1 }, { x: -Infinity }],
  },
  { name: 'x + -Infinity', json: ['Add', 'x', { num: '-Infinity' }], inputs: [{ x: 1 }] },
  { name: 'x + NaN', json: ['Add', 'x', { num: 'NaN' }], inputs: [{ x: 1 }] },
  {
    name: 'Max(x, -Infinity)',
    json: ['Max', 'x', { num: '-Infinity' }],
    inputs: [{ x: 1 }, { x: -Infinity }],
  },
];

describe('differential: the interpreter decides, the existing emitter checks', () => {
  for (const fixture of FIXTURES) {
    test(fixture.name, () => {
      const ce = engine();
      const expr = ce.expr(fixture.json);
      const result = structured().compile(expr, OPTIONS);
      expect(result.success).toBe(true);
      const existing = compile(expr, { ...OPTIONS, fallback: false });
      for (const inputs of fixture.inputs) {
        const value = run(result, inputs);
        expect([inputs, sameValue(value, interpret(ce, fixture.json, inputs))]).toEqual([
          inputs,
          true,
        ]);
        // The two compilers agree, with the sign of a zero.
        expect([inputs, value]).toEqual([inputs, run(existing, inputs)]);
      }
    });
  }

  test('the differences of both compilers from the interpreter', () => {
    const ce = engine();
    const s = (json: MathJsonExpression) => structured().compile(ce.expr(json), OPTIONS);
    // `Equal` of two numbers is the exact comparison `===`; the interpreter
    // compares with a tolerance. Both compilers give `false`.
    const equal = s(['Equal', 'c', 'x']);
    const inputs = { c: 1, x: 1 + 1e-12 };
    expect(interpret(ce, ['Equal', 'c', 'x'], inputs)).toBe(true);
    expect(run(equal, inputs)).toBe(false);
    expect(compile(ce.expr(['Equal', 'c', 'x']), OPTIONS).run!(inputs)).toBe(false);
    // The sign of a zero: both compilers give `-0` for `Min(-0, 0)` and
    // `-x` at `x = 0`; the interpreter gives `0`.
    expect(Object.is(run(s(['Min', 'x', 'y']), { x: -0, y: 0 }), -0)).toBe(true);
    expect(Object.is(interpret(ce, ['Min', 'x', 'y'], { x: -0, y: 0 }), 0)).toBe(true);
    expect(Object.is(run(s(['Negate', 'x']), { x: 0 }), -0)).toBe(true);
    expect(Object.is(interpret(ce, ['Negate', 'x'], { x: 0 }), 0)).toBe(true);
  });
});

//
// Laziness and order
//

describe('laziness and order, with the test operation', () => {
  let traces: string[] = [];
  beforeEach(() => {
    traces = [];
    (globalThis as Record<string, unknown>).__ceTrace = (id: string, ...args: number[]) => {
      traces.push(`${id}(${args.join(',')})`);
      return args[0] ?? 0;
    };
  });
  afterEach(() => {
    delete (globalThis as Record<string, unknown>).__ceTrace;
  });

  const compileTrace = (json: MathJsonExpression) => {
    const ce = engine();
    return structured().compile(ce.expr(json), OPTIONS);
  };

  test('an untaken If branch leaves no trace', () => {
    const result = compileTrace(['If', 'C', ['Trace', 'x'], 'y']);
    expect(result.run!({ C: false, x: 1, y: 2 })).toBe(2);
    expect(traces).toEqual([]);
    expect(result.run!({ C: true, x: 1, y: 2 })).toBe(1);
    expect(traces).toEqual(['trace(1)']);
  });

  test('an operand of And or Or after the deciding one leaves no trace', () => {
    const and = compileTrace(['And', 'C', ['Less', ['Trace', 'x'], 'y']]);
    expect(and.run!({ C: false, x: 1, y: 2 })).toBe(false);
    expect(traces).toEqual([]);
    expect(and.run!({ C: true, x: 1, y: 2 })).toBe(true);
    expect(traces).toEqual(['trace(1)']);
    traces.length = 0;
    const or = compileTrace(['Or', 'C', ['Less', ['Trace', 'x'], 'y']]);
    expect(or.run!({ C: true, x: 1, y: 2 })).toBe(true);
    expect(traces).toEqual([]);
    expect(or.run!({ C: false, x: 3, y: 2 })).toBe(false);
    expect(traces).toEqual(['trace(3)']);
  });

  test('two occurrences of one node trace twice, in order', () => {
    const ce = engine();
    const trace = ce.expr(['Trace', 'x']);
    const other = ce.expr(['Trace', 'y']);
    // Made nodes: the canonical form would write `2·Trace(x)`.
    const made = (ce as unknown as { _fn(h: string, ops: Expression[]): Expression })._fn(
      'Add',
      [trace, other, trace]
    );
    const result = structured().compile(made, OPTIONS);
    expect(result.run!({ x: 1, y: 2 })).toBe(4);
    expect(traces).toEqual(['trace(1)', 'trace(2)', 'trace(1)']);
  });

  test('the arguments of a call trace in order, once each', () => {
    const ce = engine();
    const expr = ce.expr(['h', ['Trace', 'x'], ['Trace', 'y']]);
    const result = structured().compile(expr, OPTIONS);
    expect(result.run!({ x: 1, y: 2 })).toBe(5);
    expect(traces).toEqual(['trace(1)', 'trace(2)']);
  });

  // The order of the reads is not asserted: compiled code treats an input as
  // a value, and the order and the number of the reads of a getter are
  // unspecified (neither the entry check nor `rawCall` makes a snapshot of
  // the vars object). The emitter may write a read at its use, after other
  // pure operations.
  test('only the inputs of the selected branch are read', () => {
    const result = compileTrace(['If', 'C', 'x', ['Add', 'x', 'y']]);
    const reads: string[] = [];
    const vars = (C: boolean) => ({
      get C() {
        reads.push('C');
        return C;
      },
      get x() {
        reads.push('x');
        return 1;
      },
      get y() {
        reads.push('y');
        return 2;
      },
    });
    const raw = (result.run as unknown as { rawCall(v: unknown): unknown }).rawCall;
    expect(raw(vars(true))).toBe(1);
    expect([...reads].sort()).toEqual(['C', 'x']);
    reads.length = 0;
    expect(raw(vars(false))).toBe(3);
    expect([...reads].sort()).toEqual(['C', 'x', 'y']);
  });

  /** A vars object whose getters write each read in the trace. */
  const tracedVars = (values: Record<string, number | boolean>) =>
    Object.defineProperties(
      {},
      Object.fromEntries(
        Object.entries(values).map(([name, v]) => [
          name,
          {
            get: () => {
              traces.push(`get ${name}`);
              return v;
            },
            enumerable: true,
          },
        ])
      )
    );

  test('a pure value between two effectful operations is not moved across them', () => {
    // A made program (the structured route admits no top-level `Block`, and
    // a `Function` literal has no getters): `t1 = Trace(x); v = y;
    // t2 = Trace(x); t1 + t2 + v`. The read `v` is pure and has one use,
    // after `t2`. Written at its use, it would run after the second trace.
    const owner = {};
    let id = 0;
    const origin = engine().expr('x');
    const value = (): IRValue => ({ owner, revision: 1, id: id++, type: 'real', representation: 'number' });
    const [x1, t1, v, x2, t2, sum] = [value(), value(), value(), value(), value(), value()];
    const read = (input: number, result: IRValue): IROperation => ({ kind: 'input', input, result, operands: [], effect: 'pure', origin });
    const trace = (result: IRValue, x: IRValue): IROperation => ({ kind: 'trace', trace: 'trace', result, operands: [x], effect: 'effectful', origin });
    const program: IRProgram = {
      owner,
      revision: 1,
      inputs: [
        { name: 'x', type: 'real', representation: 'number' },
        { name: 'y', type: 'real', representation: 'number' },
      ],
      numericPolicy: 'strict',
      captures: [],
      functions: [],
      root: {
        operations: [
          read(0, x1),
          trace(t1, x1),
          read(1, v),
          read(0, x2),
          trace(t2, x2),
          { kind: 'add', result: sum, operands: [t1, t2, v], effect: 'pure', origin },
          { kind: 'yield', operands: [sum], effect: 'pure', origin },
        ],
        effect: 'effectful',
      },
    };
    verifyProgram(program, new Set([origin]));
    let n = 0;
    const e = emitStructuredProgram(
      program,
      { input: (name) => `_.${name}`, fresh: () => `_v${++n}` },
      { trace: TRACE_SOURCE }
    );
    expect(e.statements).toEqual([
      'const _v1 = globalThis.__ceTrace("trace", _.x);',
      'const _v2 = _.y;',
      'const _v3 = globalThis.__ceTrace("trace", _.x);',
    ]);
    const result = new Function('_SYS', '_', `${e.statements.join(' ')} return ${e.value};`)(
      createSysRuntime(),
      tracedVars({ x: 1, y: 2 })
    );
    expect(result).toBe(4);
    // The order of the getter reads is unspecified; the statements above
    // show where the read of `y` is.
    expect(traces.filter((t) => !t.startsWith('get '))).toEqual(['trace(1)', 'trace(1)']);
  });

  test('an effectful operation is a statement even with only pure operations before its use', () => {
    // A made program `t = Trace(x); -t`: `t` has one use, and no operation
    // lies between its definition and that use. Only its effect keeps it a
    // statement.
    const owner = {};
    let id = 0;
    const origin = engine().expr('x');
    const value = (): IRValue => ({ owner, revision: 1, id: id++, type: 'real', representation: 'number' });
    const [x, t, negated] = [value(), value(), value()];
    const program: IRProgram = {
      owner,
      revision: 1,
      inputs: [{ name: 'x', type: 'real', representation: 'number' }],
      numericPolicy: 'strict',
      captures: [],
      functions: [],
      root: {
        operations: [
          { kind: 'input', input: 0, result: x, operands: [], effect: 'pure', origin },
          { kind: 'trace', trace: 'trace', result: t, operands: [x], effect: 'effectful', origin },
          { kind: 'negate', result: negated, operands: [t], effect: 'pure', origin },
          { kind: 'yield', operands: [negated], effect: 'pure', origin },
        ],
        effect: 'effectful',
      },
    };
    verifyProgram(program, new Set([origin]));
    let n = 0;
    const e = emitStructuredProgram(
      program,
      { input: (name) => `_.${name}`, fresh: () => `_v${++n}` },
      { trace: TRACE_SOURCE }
    );
    expect(e.statements).toEqual(['const _v1 = globalThis.__ceTrace("trace", _.x);']);
    expect(e.value).toBe('-_v1');
  });

  test('an effectful local whose use comes after another effectful operation keeps its order', () => {
    // `a = Trace(x)` has one use, the second argument of `h`, after
    // `Trace(y)`. Written at its use, it would run after `Trace(y)`.
    const ce = engine();
    const json: MathJsonExpression = [
      'Function',
      ['Block', ['Declare', 'a', "'real'", ['Trace', 'x']], ['h', ['Trace', 'y'], 'a']],
      typed('x', 'real'),
      typed('y', 'real'),
    ];
    const result = structured().compile(ce.expr(json), OPTIONS);
    expect(run(result, [1, 2])).toBe(4);
    expect(traces).toEqual(['trace(1)', 'trace(2)']);
  });

  test('a value used in a nested region keeps its binding', () => {
    // `a` has one use, in a branch of the If: it is computed before the If,
    // as the program says, and not moved into the branch.
    const ce = engine();
    const json: MathJsonExpression = [
      'Function',
      ['Block', ['Declare', 'a', "'real'", ['Max', 0, 'x']], ['If', 'C', 'a', 'y']],
      typed('x', 'real'),
      typed('y', 'real'),
      typed('C', 'boolean'),
    ];
    const result = structured().compile(ce.expr(json), OPTIONS);
    expect(result.code).toBe(
      '(x, y, C) => { const _tv1 = Math.max(0, x); return C ? _tv1 : y; }'
    );
    expect(run(result, [-1, 2, true])).toBe(0);
    expect(run(result, [-1, 2, false])).toBe(2);
  });

  test('control: the instrument detects an eager branch', () => {
    // A made program `If(C, Trace(x), 1)`, once lazy (the test operation in
    // the then region) and once eager (the same operation before the If).
    const owner = {};
    let id = 0;
    const value = (type: ScalarKind): IRValue => ({
      owner,
      revision: 1,
      id: id++,
      type,
      representation: type === 'boolean' ? 'boolean' : 'number',
    });
    const origin = engine().expr('x');
    const yieldOf = (v: IRValue): IROperation => ({ kind: 'yield', operands: [v], effect: 'pure', origin });
    const region = (operations: IROperation[]) => ({
      operations,
      effect: operations.some((op) => op.effect === 'effectful') ? ('effectful' as const) : ('pure' as const),
    });
    const program = (eager: boolean): IRProgram => {
      const c = value('boolean');
      const x = value('real');
      const t = value('real');
      const one = value('real');
      const result = value('real');
      const read: IROperation = { kind: 'input', input: 1, result: x, operands: [], effect: 'pure', origin };
      const trace: IROperation = { kind: 'trace', trace: 'trace', result: t, operands: [x], effect: 'effectful', origin };
      const then = region([...(eager ? [] : [read, trace]), yieldOf(t)]);
      const otherwise = region([
        { kind: 'literal', value: 1, result: one, operands: [], effect: 'pure', origin },
        yieldOf(one),
      ]);
      return {
        owner,
        revision: 1,
        inputs: [
          { name: 'C', type: 'boolean', representation: 'boolean' },
          { name: 'x', type: 'real', representation: 'number' },
        ],
        numericPolicy: 'strict',
        captures: [],
        functions: [],
        root: region([
          { kind: 'input', input: 0, result: c, operands: [], effect: 'pure', origin },
          ...(eager ? [read, trace] : []),
          {
            kind: 'if',
            results: [result],
            operands: [c],
            then,
            else: otherwise,
            effect: 'effectful',
            origin,
          },
          yieldOf(result),
        ]),
      };
    };
    const runMade = (p: IRProgram, vars: unknown) => {
      verifyProgram(p, new Set([origin]));
      let n = 0;
      const emitted = emitStructuredProgram(
        p,
        { input: (name) => `_.${name}`, fresh: () => `_v${++n}` },
        { trace: TRACE_SOURCE }
      );
      return new Function(
        '_SYS',
        '_',
        `${emitted.definitions.join('\n')}\n${emitted.statements.join(' ')} return ${emitted.value};`
      )(createSysRuntime(), vars);
    };
    expect(runMade(program(false), { C: false, x: 7 })).toBe(1);
    expect(traces).toEqual([]);
    expect(runMade(program(true), { C: false, x: 7 })).toBe(1);
    expect(traces).toEqual(['trace(7)']);
  });
});

describe('made programs with helpers', () => {
  // Made programs over one real input `x`, with pure operations only. The
  // verifier accepts each of them, so the emitter must write valid code.
  function maker() {
    const owner = {};
    let id = 0;
    const origin = engine().expr('x');
    const value = (type: ScalarKind): IRValue => ({
      owner,
      revision: 1,
      id: id++,
      type,
      representation: type === 'boolean' ? 'boolean' : 'number',
    });
    const op = (o: Omit<IROperation, 'effect' | 'origin'>): IROperation =>
      ({ ...o, effect: 'pure', origin }) as IROperation;
    const region = (operations: IROperation[]) => ({ operations, effect: 'pure' as const });
    const yieldOf = (v: IRValue) => op({ kind: 'yield', operands: [v] } as never);
    const literal = (n: number) => {
      const v = value('real');
      return [v, op({ kind: 'literal', value: n, result: v, operands: [] } as never)] as const;
    };
    const program = (functions: IRProgram['functions']): IRProgram => {
      const x = value('real');
      const r = value('real');
      return {
        owner,
        revision: 1,
        inputs: [{ name: 'x', type: 'real', representation: 'number' }],
        numericPolicy: 'strict',
        captures: [],
        functions,
        root: region([
          op({ kind: 'input', input: 0, result: x, operands: [] } as never),
          op({ kind: 'call', function: 0, result: r, operands: [x] } as never),
          yieldOf(r),
        ]),
      };
    };
    const runMade = (p: IRProgram, x: number) => {
      verifyProgram(p, new Set([origin]));
      let n = 0;
      const e = emitStructuredProgram(p, { input: (name) => `_.${name}`, fresh: () => `_v${++n}` });
      return new Function(
        '_SYS',
        '_',
        `${e.definitions.join('\n')}\n${e.statements.join(' ')} return ${e.value};`
      )(createSysRuntime(), { x });
    };
    return { value, op, region, yieldOf, literal, program, runMade };
  }

  test('helper 0 calls helper 1, which is defined after it', () => {
    const m = maker();
    // f1(q) = 2·q
    const q = m.value('real');
    const [two, twoOp] = m.literal(2);
    const doubled = m.value('real');
    const f1 = {
      name: 'f1',
      parameters: [q],
      result: { type: 'real' as const, representation: 'number' as const },
      body: m.region([
        twoOp,
        m.op({ kind: 'multiply', result: doubled, operands: [two, q] } as never),
        m.yieldOf(doubled),
      ]),
      origin: engine().expr('x'),
    };
    // f0(p) = f1(p) + 1
    const p = m.value('real');
    const called = m.value('real');
    const [one, oneOp] = m.literal(1);
    const sum = m.value('real');
    const f0 = {
      ...f1,
      name: 'f0',
      parameters: [p],
      body: m.region([
        m.op({ kind: 'call', function: 1, result: called, operands: [p] } as never),
        oneOp,
        m.op({ kind: 'add', result: sum, operands: [called, one] } as never),
        m.yieldOf(sum),
      ]),
    };
    expect(m.runMade(m.program([f0, f1]), 3)).toBe(7);
  });

  test('a helper that calls itself', () => {
    // The verifier accepts a recursive call: a call is checked against the
    // signature of its function, and a function body may call any function
    // of the program. f0(p) = If(p < 1, p, f0(p + -1)).
    const m = maker();
    const p = m.value('real');
    const [one, oneOp] = m.literal(1);
    const less = m.value('boolean');
    const [minusOne, minusOneOp] = m.literal(-1);
    const next = m.value('real');
    const recursive = m.value('real');
    const result = m.value('real');
    const f0 = {
      name: 'f0',
      parameters: [p],
      result: { type: 'real' as const, representation: 'number' as const },
      body: m.region([
        oneOp,
        m.op({ kind: 'less', result: less, operands: [p, one] } as never),
        m.op({
          kind: 'if',
          results: [result],
          operands: [less],
          then: m.region([m.yieldOf(p)]),
          else: m.region([
            minusOneOp,
            m.op({ kind: 'add', result: next, operands: [p, minusOne] } as never),
            m.op({ kind: 'call', function: 0, result: recursive, operands: [next] } as never),
            m.yieldOf(recursive),
          ]),
        } as never),
        m.yieldOf(result),
      ]),
      origin: engine().expr('x'),
    };
    expect(m.runMade(m.program([f0]), 3.5)).toBe(0.5);
  });
});

//
// The emitted code
//

describe('the emitted code', () => {
  // The exact code, so that a change of its size shows here. The existing
  // emitter writes 62 bytes for `heatwall` with the same options.
  test('heatwall', () => {
    const result = structured().compile(engine().expr(HEATWALL_BODY), OPTIONS);
    expect(result.code).toBe('0.5 < _.obstacle && _.c === 16 && (_.r < 13 || 18 < _.r)');
  });

  test('heatcell', () => {
    // `a` is read twice, in the else branch: it keeps its `const`.
    const result = structured().compile(engine().expr(HEATCELL), OPTIONS);
    expect(result.code).toBe(
      '(v, s, d, c, r, obstacle) => { function _tv1(_tv2, _tv3, _tv4) { return 0.5 < _tv4 && _tv2 === 16 && (_tv3 < 13 || 18 < _tv3); }\n' +
        'const _tv5 = Math.min(0.25, Math.max(0, d)); return _tv1(c, r, obstacle) ? v : _tv5 * (s + -4 * v) + v; }'
    );
  });

  test('a complex sum: each operand is written twice, so it binds a const', () => {
    // A made program `convert(max(x, y)) + z`, with `z` a complex input. The
    // `max` has one use, in the conversion, and is written there; the
    // conversion and the read of `z` are each read twice by the sum.
    const owner = {};
    let id = 0;
    const origin = engine().expr('x');
    const value = (type: ScalarKind): IRValue => ({
      owner,
      revision: 1,
      id: id++,
      type,
      representation: type === 'complex' ? 'complex' : 'number',
    });
    const [x, y, m, c, z, sum] = [
      value('real'),
      value('real'),
      value('real'),
      value('complex'),
      value('complex'),
      value('complex'),
    ];
    const program: IRProgram = {
      owner,
      revision: 1,
      inputs: [
        { name: 'x', type: 'real', representation: 'number' },
        { name: 'y', type: 'real', representation: 'number' },
        { name: 'z', type: 'complex', representation: 'complex' },
      ],
      numericPolicy: 'complex',
      captures: [],
      functions: [],
      root: {
        operations: [
          { kind: 'input', input: 0, result: x, operands: [], effect: 'pure', origin },
          { kind: 'input', input: 1, result: y, operands: [], effect: 'pure', origin },
          { kind: 'max', result: m, operands: [x, y], effect: 'pure', origin },
          { kind: 'convert', conversion: 'real-to-complex', result: c, operands: [m], effect: 'pure', origin },
          { kind: 'input', input: 2, result: z, operands: [], effect: 'pure', origin },
          { kind: 'add', result: sum, operands: [c, z], effect: 'pure', origin },
          { kind: 'yield', operands: [sum], effect: 'pure', origin },
        ],
        effect: 'pure',
      },
    };
    verifyProgram(program, new Set([origin]));
    let n = 0;
    const e = emitStructuredProgram(program, { input: (name) => `_.${name}`, fresh: () => `_v${++n}` });
    expect(e.statements).toEqual([
      'const _v1 = ({ re: Math.max(_.x, _.y), im: 0 });',
      'const _v2 = _.z;',
    ]);
    expect(e.value).toBe('({ re: _v1.re + _v2.re, im: _v1.im + _v2.im })');
    const result = new Function('_SYS', '_', `${e.statements.join(' ')} return ${e.value};`)(
      createSysRuntime(),
      { x: 1, y: 2, z: { re: 3, im: 4 } }
    );
    expect(result).toEqual({ re: 5, im: 4 });
  });
});

describe('parentheses, on made programs', () => {
  // Made programs over the inputs x, y (real) and C, D (boolean), with pure
  // operations only, so that the canonical form does not rewrite them. Each
  // is checked for its exact code and for its value against a JavaScript
  // function written by hand.
  type Builder = {
    input(name: 'x' | 'y' | 'C' | 'D'): IRValue;
    literal(n: number): IRValue;
    op(kind: 'add' | 'negate' | 'multiply' | 'less', ...operands: IRValue[]): IRValue;
    if(c: IRValue, a: () => IRValue, b: () => IRValue, type?: ScalarKind): IRValue;
    logic(kind: 'and' | 'or', first: IRValue, ...rest: (() => IRValue)[]): IRValue;
  };
  const INPUTS = [
    { name: 'x', type: 'real', representation: 'number' },
    { name: 'y', type: 'real', representation: 'number' },
    { name: 'C', type: 'boolean', representation: 'boolean' },
    { name: 'D', type: 'boolean', representation: 'boolean' },
  ] as const;

  function emit(body: (b: Builder) => IRValue) {
    const owner = {};
    let id = 0;
    const origin = engine().expr('x');
    let ops: IROperation[] = [];
    const push = (kind: string, operands: IRValue[], type: ScalarKind, extra = {}) => {
      const result: IRValue = {
        owner,
        revision: 1,
        id: id++,
        type,
        representation: type === 'boolean' ? 'boolean' : 'number',
      };
      // An `if` has a list of results.
      ops.push({
        kind,
        ...(kind === 'if' ? { results: [result] } : { result }),
        operands,
        effect: 'pure',
        origin,
        ...extra,
      } as IROperation);
      return result;
    };
    const region = (f: () => IRValue) => {
      const saved = ops;
      ops = [];
      const v = f();
      ops.push({ kind: 'yield', operands: [v], effect: 'pure', origin });
      const r = { operations: ops, effect: 'pure' as const };
      ops = saved;
      return r;
    };
    const b: Builder = {
      input: (name) => {
        const input = INPUTS.findIndex((i) => i.name === name);
        return push('input', [], INPUTS[input].type, { input });
      },
      literal: (n) => push('literal', [], 'real', { value: n }),
      op: (kind, ...operands) => push(kind, operands, kind === 'less' ? 'boolean' : 'real'),
      if: (c, a, e, type = 'real') => push('if', [c], type, { then: region(a), else: region(e) }),
      logic: (kind, first, ...rest) => push(kind, [first], 'boolean', { rest: rest.map(region) }),
    };
    const root = region(() => body(b));
    const program: IRProgram = {
      owner,
      revision: 1,
      inputs: INPUTS,
      numericPolicy: 'strict',
      captures: [],
      functions: [],
      root,
    };
    verifyProgram(program, new Set([origin]));
    let n = 0;
    const e = emitStructuredProgram(program, { input: (name) => `_.${name}`, fresh: () => `_v${++n}` });
    const code = [...e.statements, `return ${e.value};`].join(' ');
    const fn = new Function('_SYS', '_', code) as (sys: unknown, vars: unknown) => unknown;
    return { code, run: (vars: Record<string, number | boolean>) => fn(createSysRuntime(), vars) };
  }

  const VARS = product<number | boolean>([2, -0.5, 0], [3, -0.5], [true, false], [true, false]).map(
    ([x, y, C, D]) => ({ x, y, C, D }) as { x: number; y: number; C: boolean; D: boolean }
  );

  const CASES: [
    string,
    (b: Builder) => IRValue,
    string,
    (v: { x: number; y: number; C: boolean; D: boolean }) => unknown,
  ][] = [
    ['-(-x)', (b) => b.op('negate', b.op('negate', b.input('x'))), 'return -(-_.x);', ({ x }) => -(-x)],
    ['-(-0)', (b) => b.op('negate', b.literal(-0)), 'return -(-0);', () => 0],
    ['-(-3)', (b) => b.op('negate', b.literal(-3)), 'return -(-3);', () => 3],
    ['-(-Infinity)', (b) => b.op('negate', b.literal(-Infinity)), 'return -(-Infinity);', () => Infinity],
    ['-1 · x', (b) => b.op('multiply', b.literal(-1), b.input('x')), 'return -1 * _.x;', ({ x }) => -1 * x],
    ['x · -0.5', (b) => b.op('multiply', b.input('x'), b.literal(-0.5)), 'return _.x * -0.5;', ({ x }) => x * -0.5],
    ['x + -y', (b) => b.op('add', b.input('x'), b.op('negate', b.input('y'))), 'return _.x + -_.y;', ({ x, y }) => x + -y],
    ['-x · y', (b) => b.op('multiply', b.op('negate', b.input('x')), b.input('y')), 'return -_.x * _.y;', ({ x, y }) => -x * y],
    ['-(x + y)', (b) => b.op('negate', b.op('add', b.input('x'), b.input('y'))), 'return -(_.x + _.y);', ({ x, y }) => -(x + y)],
    [
      'x + (y + -3)',
      (b) => b.op('add', b.input('x'), b.op('add', b.input('y'), b.literal(-3))),
      'return _.x + (_.y + -3);',
      ({ x, y }) => x + (y + -3),
    ],
    [
      '(x + y) + -0',
      (b) => b.op('add', b.op('add', b.input('x'), b.input('y')), b.literal(-0)),
      'return _.x + _.y + -0;',
      ({ x, y }) => x + y + -0,
    ],
    [
      'x · (y + 1)',
      (b) => b.op('multiply', b.input('x'), b.op('add', b.input('y'), b.literal(1))),
      'return _.x * (_.y + 1);',
      ({ x, y }) => x * (y + 1),
    ],
    [
      '-x < -0',
      (b) => b.op('less', b.op('negate', b.input('x')), b.literal(-0)),
      'return -_.x < -0;',
      ({ x }) => -x < -0,
    ],
    [
      'nested conditionals in both branches',
      (b) =>
        b.if(
          b.input('C'),
          () => b.if(b.input('D'), () => b.input('x'), () => b.input('y')),
          () => b.if(b.input('D'), () => b.input('y'), () => b.op('negate', b.input('x')))
        ),
      'return _.C ? _.D ? _.x : _.y : _.D ? _.y : -_.x;',
      ({ x, y, C, D }) => (C ? (D ? x : y) : D ? y : -x),
    ],
    [
      'a conditional as a condition',
      (b) =>
        b.if(
          b.if(b.input('C'), () => b.input('D'), () => b.input('C'), 'boolean'),
          () => b.input('x'),
          () => b.input('y')
        ),
      'return (_.C ? _.D : _.C) ? _.x : _.y;',
      ({ x, y, C, D }) => ((C ? D : C) ? x : y),
    ],
    [
      'a conditional as an operand of a sum',
      (b) => b.op('add', b.input('x'), b.if(b.input('C'), () => b.input('x'), () => b.input('y'))),
      'return _.x + (_.C ? _.x : _.y);',
      ({ x, y, C }) => x + (C ? x : y),
    ],
    [
      '&& inside ||',
      (b) =>
        b.logic('or', b.input('C'), () =>
          b.logic('and', b.input('D'), () => b.op('less', b.input('x'), b.input('y')))
        ),
      'return _.C || _.D && _.x < _.y;',
      ({ x, y, C, D }) => C || (D && x < y),
    ],
    [
      '|| inside &&',
      (b) =>
        b.logic('and', b.input('C'), () =>
          b.logic('or', b.input('D'), () => b.op('less', b.input('x'), b.input('y')))
        ),
      'return _.C && (_.D || _.x < _.y);',
      ({ x, y, C, D }) => C && (D || x < y),
    ],
    [
      '|| as the first operand of &&',
      (b) =>
        b.logic('and', b.logic('or', b.input('C'), () => b.input('D')), () =>
          b.op('less', b.input('x'), b.input('y'))
        ),
      'return (_.C || _.D) && _.x < _.y;',
      ({ x, y, C, D }) => (C || D) && x < y,
    ],
  ];

  test.each(CASES)('%s', (_name, body, code, reference) => {
    const e = emit(body);
    expect(e.code).toBe(code);
    for (const vars of VARS)
      expect([vars, Object.is(e.run(vars), reference(vars))]).toEqual([vars, true]);
  });
});

//
// No reader of the existing compiler during the emission
//

describe('the existing readers are not called from preparation to emission', () => {
  const READERS: [object, string][] = [
    [core, 'isComplexValued'],
    [core, 'staticTypeOf'],
    [core, 'userFunctionParamLanes'],
    [core, 'compile'],
    [BaseCompiler, 'compileCseRoot'],
  ];
  const PROGRAMS: [MathJsonExpression, Inputs][] = [
    [HEATCELL, [1, 2, 0.1, 16, 12, 1]],
    [HEATWALL_BODY, { obstacle: 1, c: 16, r: 19 }],
    [['Add', ['If', 'C', 'x', 'z'], 'y'], { C: false, x: 1, y: 2, z: { re: 3, im: 4 } }],
    [['Add', ['g', 'x'], ['g', 'y']], { x: -1, y: 2 }],
    [LOCAL_READ_THRICE, [2, 3]],
  ];

  test('structured route: the readers throw, and the fixtures compile and run', () => {
    for (const [json, inputs] of PROGRAMS) {
      const ce = engine();
      const phases: StructuredPhase[] = [];
      const onPhase = (phase: StructuredPhase) => {
        phases.push(phase);
        if (phase === 'preparation')
          for (const [object, name] of READERS)
            jest.spyOn(object as never, name as never).mockImplementation((() => {
              throw new Error(`${name} called from preparation to emission`);
            }) as never);
        if (phase === 'emission') jest.restoreAllMocks();
      };
      let result: CompilationResult<'javascript'>;
      try {
        result = structured({ onPhase }).compile(ce.expr(json), OPTIONS);
      } finally {
        jest.restoreAllMocks();
      }
      expect(phases).toEqual([
        'preparation',
        'annotation',
        'lowering',
        'verification',
        'emission',
        'assembly',
      ]);
      expect(sameValue(run(result, inputs), interpret(ce, json, inputs))).toBe(true);
    }
  });

  test('control: the ordinary target reaches each reader on the same programs', () => {
    const calls = new Map<string, number>();
    for (const [object, name] of READERS) {
      const original = (object as Record<string, (...a: unknown[]) => unknown>)[name];
      jest.spyOn(object as never, name as never).mockImplementation(((...args: unknown[]) => {
        calls.set(name, (calls.get(name) ?? 0) + 1);
        return original.apply(object, args);
      }) as never);
    }
    try {
      for (const [json] of PROGRAMS) compile(engine().expr(json), { ...OPTIONS, fallback: false });
    } finally {
      jest.restoreAllMocks();
    }
    for (const [, name] of READERS) expect([name, (calls.get(name) ?? 0) > 0]).toEqual([name, true]);
  });

  test('the phases are reported only when an observer is given', () => {
    const now = jest.spyOn(globalThis.performance, 'now');
    try {
      structured().compile(engine().expr(HEATCELL), OPTIONS);
      expect(now).not.toHaveBeenCalled();
    } finally {
      now.mockRestore();
    }
    const times: [StructuredPhase, number][] = [];
    structured({ onPhase: (p, ms) => times.push([p, ms]) }).compile(engine().expr(HEATCELL), OPTIONS);
    expect(times.map(([p]) => p)).toEqual([
      'preparation',
      'annotation',
      'lowering',
      'verification',
      'emission',
      'assembly',
    ]);
    for (const [, ms] of times) expect(ms).toBeGreaterThanOrEqual(0);
  });
});

//
// The result
//

describe('the result agrees with the existing route', () => {
  const sys = createSysRuntime();
  /** The value of `result.code` with its preamble, called on `inputs`. */
  function evaluateCode(result: CompilationResult<'javascript'>, inputs: Inputs): unknown {
    if (Array.isArray(inputs))
      return normalizeRunResult(
        new Function('_SYS', `return ${result.code};`)(sys)(...inputs)
      );
    return normalizeRunResult(
      new Function('_SYS', '_', `${result.preamble ?? ''}\nreturn ${result.code};`)(sys, inputs)
    );
  }
  /** The value of the result rebuilt from its stored fields by the
   *  runtime. */
  function reconstruct(result: CompilationResult<'javascript'>, inputs: Inputs): unknown {
    const loaded = createSysRuntime().load(result as never) as (...a: unknown[]) => unknown;
    return Array.isArray(inputs) ? loaded(...inputs) : loaded(inputs);
  }
  const METADATA = [
    'target',
    'success',
    'runtimeVersion',
    'calling',
    'reconstructionDigits',
    'entryPlan',
    'shippable',
    'freeSymbols',
    'unsupported',
    'freeSymbolTypes',
    'mode',
    'valueKinds',
    'broadcastOutputs',
    'preambleOnce',
    'preamblePerCall',
  ] as const;

  for (const fixture of FIXTURES) {
    test(fixture.name, () => {
      const ce = engine();
      const expr = ce.expr(fixture.json);
      const result = structured().compile(expr, OPTIONS);
      const existing = compile(expr, { ...OPTIONS, fallback: false });
      for (const key of METADATA)
        expect([key, (result as Record<string, unknown>)[key]]).toEqual([
          key,
          (existing as Record<string, unknown>)[key],
        ]);
      // A preamble holds the definition of a helper on both routes.
      expect(result.preamble === undefined).toBe(existing.preamble === undefined);
      for (const inputs of fixture.inputs) {
        const value = run(result, inputs);
        expect([inputs, evaluateCode(result, inputs)]).toEqual([inputs, value]);
        expect([inputs, reconstruct(result, inputs)]).toEqual([inputs, value]);
        expect([inputs, reconstruct(existing, inputs)]).toEqual([inputs, value]);
      }
    });
  }

  test('a compilation reports its own mode and value kinds, not those of the previous one', () => {
    const ce = engine();
    // A previous compilation in the bigint mode leaves its report.
    compile(ce.expr(['Add', 'c', 1]), { mode: 'bigint', fallback: false });
    const strict = structured().compile(ce.expr(['Add', 'x', 'y']), OPTIONS);
    expect(strict.mode).toBe('strict');
    const complex = structured().compile(ce.expr(['Add', 'x', 'y']), {
      ...OPTIONS,
      mode: 'complex',
    });
    expect(complex.mode).toBe('complex');
    // A previous compilation whose result reads a value kind leaves its
    // kind lowering.
    const kinds = new ComputeEngine();
    kinds.declare('x', 'enclosure');
    const enclosure = compile(kinds.parse('x + 1'), { to: 'interval-js', fallback: false });
    expect(enclosure.valueKinds).toEqual(['enclosure']);
    const after = structured().compile(ce.expr(['Add', 'x', 'y']), OPTIONS);
    expect(after.valueKinds).toBeUndefined();
    expect(after.run!({ x: 1, y: 2 })).toBe(3);
  });
});

//
// Declines, and the count of the results over the test programs
//

const INTENDED_DECLINES: [string, () => Expression, Record<string, unknown>, RegExp][] = [
  ['a head outside the vocabulary', () => engine().expr(['Sech', 'x']), {}, /unsupported head Sech/],
  ['Power with the exponent 0.5', () => engine().expr(['Power', 'x', 0.5]), {}, /Power with the exponent 0\.5 is not in the structured route/],
  ['a list', () => engine().expr(['List', 'x', 'y']), {}, /a list literal is not in the structured route/],
  [
    'a free symbol declared with a type that is not scalar',
    () => {
      const ce = engine();
      ce.declare('u', 'number');
      return ce.expr('u');
    },
    {},
    /unsupported binding u/,
  ],
  ['cse not false', () => engine().expr(['Add', 'x', 'y']), { cse: undefined }, /requires cse: false/],
  ['cse true', () => engine().expr(['Add', 'x', 'y']), { cse: true }, /requires cse: false/],
  ['constantFold not false', () => engine().expr(['Add', 'x', 'y']), { constantFold: undefined }, /requires constantFold: false/],
  ['broadcast', () => engine().expr(['Add', 'x', 'y']), { broadcast: true }, /unsupported compile options/],
  ['functions', () => engine().expr(['Add', 'x', 'y']), { functions: { Foo: 'Math.sin' } }, /unsupported compile options/],
  ['operators', () => engine().expr(['Add', 'x', 'y']), { operators: { Add: ['+', 11] } }, /unsupported compile options/],
  ['vars', () => engine().expr(['Add', 'x', 'y']), { vars: { x: 1 } }, /unsupported compile options/],
  ['preamble', () => engine().expr(['Add', 'x', 'y']), { preamble: 'const k = 1;' }, /unsupported compile options/],
  ['imports', () => engine().expr(['Add', 'x', 'y']), { imports: [Math.sin] }, /unsupported compile options/],
  ['the bigint mode', () => engine().expr(['Add', 'x', 'y']), { mode: 'bigint' }, /unsupported compile options/],
];

describe('declines', () => {
  test.each(INTENDED_DECLINES)('%s', (_name, make, options, reason) => {
    const expr = make();
    expect(() =>
      structured().compile(expr, { ...OPTIONS, fallback: false, ...options } as never)
    ).toThrow(reason);
  });

  test('a failure does not fall back to the existing emitter', () => {
    const ce = engine();
    const target = new ScalarFragmentJavaScriptTarget('structured', TESTS);
    // No trace source: the emission of the test operation fails.
    expect(() => target.compile(ce.expr(['Trace', 'x']), OPTIONS)).toThrow(
      /JS structured emission: a trace operation, and no trace source/
    );
  });

  test('the count of accepted programs, declines and failures', () => {
    const counts = {
      accepted: 0,
      intendedDeclines: 0,
      unexpectedDeclines: 0,
      emitterFailures: 0,
    };
    const unexpected: string[] = [];
    const classify = (name: string, compileIt: () => unknown, reason?: RegExp) => {
      try {
        compileIt();
        if (reason) {
          counts.unexpectedDeclines++;
          unexpected.push(`${name}: compiled`);
        } else counts.accepted++;
      } catch (e) {
        const message = (e as Error).message;
        if (/^JS structured (emission|representation|lowering)/.test(message)) {
          counts.emitterFailures++;
          unexpected.push(`${name}: ${message}`);
        } else if (reason?.test(message)) counts.intendedDeclines++;
        else {
          counts.unexpectedDeclines++;
          unexpected.push(`${name}: ${message}`);
        }
      }
    };
    for (const fixture of FIXTURES)
      classify(fixture.name, () => structured().compile(engine().expr(fixture.json), OPTIONS));
    for (const [name, make, options, reason] of INTENDED_DECLINES)
      classify(
        name,
        () => structured().compile(make(), { ...OPTIONS, fallback: false, ...options } as never),
        reason
      );
    expect(unexpected).toEqual([]);
    expect(counts).toEqual({
      accepted: FIXTURES.length,
      intendedDeclines: INTENDED_DECLINES.length,
      unexpectedDeclines: 0,
      emitterFailures: 0,
    });
  });
});
