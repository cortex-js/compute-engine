/**
 * The slice compiler (`src/compute-engine/compilation/ir/`), JavaScript
 * printer, against the interpreter: hand-chosen programs that cover each
 * row of the operator table and each construct, at several input points,
 * with the passes off and on. Also the integer-exactness cases, the
 * determinism of the output, the declines, the effect classes, the memo of
 * the lowering, the "one row" claim, lists of run-time length, draws in
 * random frames, and user functions.
 */

import { ComputeEngine } from '../../src/compute-engine';
import {
  admits,
  compileSlice,
  Decline,
  OPERATORS,
  sliceProgram,
  TARGETS,
  verify,
  type Extension,
} from '../../src/compute-engine/compilation/ir';
import {
  JS,
  printJavaScript,
} from '../../src/compute-engine/compilation/ir/print-js';
import { GLSL } from '../../src/compute-engine/compilation/ir/print-glsl';
import {
  effectTrace,
  sameTrace,
} from '../../src/compute-engine/compilation/ir/effects';
import {
  CONSTANTS,
  REDUCTIONS,
} from '../../src/compute-engine/compilation/ir/operators';
import { ALL_PASSES } from '../../src/compute-engine/compilation/ir/passes';
import type { Program } from '../../src/compute-engine/compilation/ir/ir';
import { foldSeed } from '../../src/compute-engine/numerics/random';
import type { Expression } from '../../src/compute-engine/global-types';
import {
  agrees,
  interpret,
  makeEngine,
  makeMachineEngine,
  pointsFor,
  PROGRAMS,
  DECLINES,
  runSlice,
  sameBits,
  type Point,
} from './ir-slice-oracle';

const ce = makeEngine();

type Json = unknown;

// The points of each program: the shared points, and -0 for a scalar real
// input. (NaN is not a value of the type `real`: the interpreter refuses
// it as the value of `x`, and the compiled result is unspecified.)
function points(expr: Expression): Point[] {
  const base = pointsFor(expr);
  if (
    !expr.unknowns.includes('x') ||
    expr.unknowns.some((s) => /^[LMIDEJ]$/.test(s))
  )
    return base;
  return [...base, { ...base[0], x: -0 }];
}

const js = (json: Json, engine = ce, extend?: Extension) =>
  compileSlice(engine.box(json as never), { target: 'javascript', extend });

function declineOf(f: () => unknown): Decline {
  try {
    f();
  } catch (e) {
    if (e instanceof Decline) return e;
    throw e;
  }
  throw new Error('no decline');
}

describe('IR slice: JavaScript against the interpreter', () => {
  test('the hand-chosen set has at least 150 programs', () =>
    expect(PROGRAMS.length).toBeGreaterThanOrEqual(150));

  test.each(PROGRAMS.map((p) => [JSON.stringify(p), p]))('%s', (_, json) => {
    const expr = ce.box(json as never);
    for (const point of points(expr)) {
      const expected = interpret(ce, expr, point);
      for (const passes of [false, true]) {
        const v = runSlice(expr, point, passes);
        if (!agrees(v, expected))
          throw new Error(
            `at ${JSON.stringify(point)} passes=${passes}: ${String(v)}, interpreter ${JSON.stringify(expected)}`
          );
      }
    }
  });

  test('passes on and off give the same bits', () => {
    for (const json of PROGRAMS) {
      const expr = ce.box(json as never);
      for (const point of points(expr))
        expect([
          json,
          sameBits(runSlice(expr, point, true), runSlice(expr, point, false)),
        ]).toEqual([json, true]);
    }
  });
});

describe('IR slice: exact integers', () => {
  const exact = (json: Json, point: Point, value: number | boolean) => {
    const expr = ce.box(json as never);
    for (const passes of [false, true])
      expect(runSlice(expr, point, passes)).toBe(value);
    expect(interpret(ce, expr, point)).toBe(value);
  };
  test('a product just below 2^53', () =>
    exact(
      ['Multiply', 'n', 'm'],
      { n: 441650591, m: 20394401 },
      9007199254740991
    ));
  test('a sum that reaches 2^53 - 1', () =>
    exact(['Add', 'n', 'm'], { n: 9007199254740990, m: 1 }, 9007199254740991));
  test('Equal on integers that differ by one near 2^53', () =>
    exact(
      ['Equal', 'n', 'm'],
      { n: 9007199254740991, m: 9007199254740990 },
      false
    ));
  test('Mod of a large integer, and the sign of the divisor', () => {
    exact(['Mod', 'n', 7], { n: 9007199254740991 }, 9007199254740991 % 7);
    exact(['Mod', 'n', 3], { n: -7 }, 2);
    exact(['Mod', 'n', -3], { n: 7 }, -2);
  });
  test('Floor of a quotient of large integers', () =>
    exact(
      ['Floor', ['Divide', 'n', 'm']],
      { n: 9007199254740991, m: 7 },
      1286742750677284
    ));
  test('Round is half away from zero', () => {
    exact(['Round', 'x'], { x: 2.5 }, 3);
    exact(['Round', 'x'], { x: -2.5 }, -3);
    exact(['Round', 'x'], { x: -0.5 }, -1);
  });
  test('an empty and a reversed range', () => {
    exact(['Sum', 'k', ['Limits', 'k', 1, 'n']], { n: 0 }, 0);
    exact(['Sum', 'k', ['Limits', 'k', 1, 'n']], { n: -5 }, 0);
    exact(['Product', 'k', ['Limits', 'k', 1, 'n']], { n: 0 }, 1);
  });
  test('Power is on the real lane, and a small integer exponent is a product', () => {
    const p = sliceProgram(ce.box(['Power', 'n', 16] as never), {
      target: 'javascript',
    });
    expect(p.types[p.functions[0].body.yields[0]].lane).toBe('real');
    expect(js(['Power', 'n', 3]).code).not.toMatch(/pow/);
    // x^(1+1): the closed exponent is 2, then strength reduction.
    expect(js(['Power', 'x', ['Add', 1, 1]]).code).not.toMatch(/pow/);
  });
  test('a large loop bound', () =>
    expect(
      js(['Sum', 'k', ['Limits', 'k', 1, 'n']]).run({ n: 1_000_000 })
    ).toBe(500000500000));
  test('a loop of more than 2^32 iterations throws', () =>
    expect(() =>
      js(['Sum', 'k', ['Limits', 'k', 1, 'n']]).run({ n: 2 ** 40 })
    ).toThrow(RangeError));
});

describe('IR slice: the fold is the double arithmetic of the row', () => {
  test('a local with a constant value is folded, integer or real, on both targets', () => {
    const ops = (json: unknown, target: 'javascript' | 'glsl') =>
      JSON.stringify(
        sliceProgram(ce.box(json as never), { target }).functions[0].body.body
      );
    const integer = [
      'Block',
      ['Declare', 't', 'integer', 3],
      ['Equal', ['Add', 't', 4], 7],
    ];
    const real = [
      'Block',
      ['Declare', 't', 'real', 0.1],
      ['Equal', ['Add', 't', 0.2], 0.3],
    ];
    for (const target of ['javascript', 'glsl'] as const) {
      expect(ops(integer, target)).not.toMatch(/"add/);
      expect(ops(real, target)).not.toMatch(/"add/);
    }
    // The double arithmetic, as the code without the passes computes.
    expect(js(real).run({})).toBe(false);
    expect(js(integer).run({})).toBe(true);
  });
});

describe('IR slice: closed sub-expressions take the interpreter value', () => {
  test('Mod(1, 1/10) is 0', () =>
    expect(js(['Mod', 1, ['Rational', 1, 10]]).run({})).toBe(0));
  test('Equal(0.1 + 0.2, 0.3) is the interpreter value', () =>
    expect(js(['Equal', ['Add', 0.1, 0.2], 0.3]).run({})).toBe(
      interpret(ce, ce.box(['Equal', ['Add', 0.1, 0.2], 0.3] as never), {})
    ));
  test('Sin(Pi) is 0', () => expect(js(['Sin', 'Pi']).run({})).toBe(0));
  test('a pole that the canonical form makes declines', () =>
    expect(declineOf(() => js(['Divide', 1, 0])).message).toMatch(/complex/));
  test('a real literal at or above 2^53 is a real', () =>
    expect(js(['Add', 'x', 6.02e23]).run({ x: 1 })).toBe(6.02e23 + 1));
});

describe('IR slice: determinism and inputs', () => {
  const programs = PROGRAMS.map((j) => ce.box(j as never));
  test('two compilations give the same code', () => {
    for (const e of programs) {
      expect(compileSlice(e, { target: 'javascript' }).code).toBe(
        compileSlice(e, { target: 'javascript' }).code
      );
      const glsl = () => {
        try {
          return compileSlice(e, { target: 'glsl' }).code;
        } catch (d) {
          if (d instanceof Decline) return d.message;
          throw d;
        }
      };
      expect(glsl()).toBe(glsl());
    }
  });
  test('two calls give the same bits, and inputs are unchanged', () => {
    for (const e of programs) {
      const { run } = compileSlice(e, { target: 'javascript' });
      for (const point of pointsFor(e)) {
        const copy = structuredClone(point);
        expect(sameBits(run(point), run(point))).toBe(true);
        expect(point).toEqual(copy);
      }
    }
  });
  test('a list result that is an input is a copy', () => {
    const L = [1, 2, 3];
    const r = js(['If', 'p', 'L', 'M']).run({
      p: true,
      L,
      M: [4, 5, 6],
    }) as number[];
    r[0] = 99;
    expect(L).toEqual([1, 2, 3]);
  });
  test('input names that are not identifiers, or Object properties', () => {
    const engine = new ComputeEngine();
    engine.declare('α', 'real');
    engine.declare('constructor', 'real');
    const program = ['Add', { sym: 'α' }, 'constructor'];
    const r = js(program, engine);
    expect(r.run({ α: 1, constructor: 2 })).toBe(3);
    const g = compileSlice(engine.box(program as never), { target: 'glsl' });
    expect(g.parameters.map((p) => [p.input, p.name])).toEqual([
      ['constructor', 'in0_constructor'],
      ['α', 'in1_'],
    ]);
  });
  test('a list of lists', () => {
    const engine = new ComputeEngine();
    engine.declare('Q', 'matrix<real^(2x2)>');
    const r = js(['Add', ['Sin', 'Q'], 1], engine).run({
      Q: [
        [0, 1],
        [2, 3],
      ],
    }) as number[][];
    expect(r).toEqual([
      [1, Math.sin(1) + 1],
      [Math.sin(2) + 1, Math.sin(3) + 1],
    ]);
    expect(() =>
      compileSlice(engine.box(['Sin', 'Q'] as never), { target: 'glsl' })
    ).toThrow(Decline);
  });
  test('Sin(2B + B) for a list of 2,000 is small', () => {
    const engine = new ComputeEngine();
    engine.declare('B', 'list<real^2000>');
    const r = js(['Sin', ['Add', ['Multiply', 2, 'B'], 'B']], engine);
    expect(r.code.length).toBeLessThan(400);
    const B = Array.from({ length: 2000 }, (_, i) => i / 100);
    expect((r.run({ B }) as number[])[1999]).toBe(
      Math.sin(B[1999] + 2 * B[1999])
    );
  });
});

describe('IR slice: declines', () => {
  test.each(Object.entries(DECLINES))('%s', (cause, json) => {
    const d = declineOf(() =>
      sliceProgram(ce.box(json as never), { target: 'javascript' })
    );
    expect(d.message).toMatch(cause);
    expect(d.node.length).toBeGreaterThan(0);
  });
  test('a user Sin is the user function, a declared Sin with no value declines', () => {
    const engine = new ComputeEngine();
    engine.declare('x', 'real');
    engine.declare('Sin', 'function');
    expect(declineOf(() => js(['Sin', 'x'], engine)).message).toMatch(
      /not the library operator/
    );
    engine.assign('Sin', engine.parse('t \\mapsto t + 100'));
    const expr = engine.box(['Sin', 'x'] as never);
    expect(js(['Sin', 'x'], engine).run({ x: 1 })).toBe(101);
    expect(interpret(engine, expr, { x: 1 })).toBe(101);
  });
  test('a shadowed Pi is not the library constant', () => {
    const engine = new ComputeEngine();
    engine.pushScope();
    engine.declare('Pi', 'real');
    expect(declineOf(() => js(['Add', 'Pi', 1], engine)).message).toMatch(
      /not the library constant/
    );
  });
  test('engine settings that change values', () => {
    const engine = new ComputeEngine();
    engine.declare('x', 'real');
    engine.angularUnit = 'deg';
    expect(declineOf(() => js(['Sin', 'x'], engine)).message).toMatch(
      /angularUnit/
    );
    engine.angularUnit = 'rad';
    engine.roundingTies = 'to-even';
    expect(declineOf(() => js(['Round', 'x'], engine)).message).toMatch(
      /roundingTies/
    );
  });
  test('inputs of unsettled type', () => {
    const engine = new ComputeEngine();
    engine.declare('U', 'list<unknown>');
    expect(declineOf(() => js(['At', 'U', 1], engine)).message).toMatch(
      /the input U/
    );
    // An undeclared scalar is a real.
    expect(js(['Add', 'zz', 1], engine).run({ zz: 2 })).toBe(3);
  });
});

describe('IR slice: effects', () => {
  // A test row, for these compilations only: `Sinh` as an effectful
  // operation that records its operand.
  const log: number[] = [];
  const TICK: Extension = {
    rows: [
      {
        head: 'Sinh',
        arity: 1,
        signatures: [[['real'], 'real', 'tick']],
        threads: false,
        effect: 'effectful',
        fold: (x: number) => x,
      },
    ],
    spellings: { tick: { text: '_tick($0)', helpers: ['_tick'] } },
    helpers: {
      _tick: 'const _tick = (x) => (globalThis.__sliceTicks.push(x), x);',
    },
  };
  const tick = (json: Json) => js(json, ce, TICK);
  beforeAll(() => {
    (globalThis as { __sliceTicks?: number[] }).__sliceTicks = log;
  });
  beforeEach(() => (log.length = 0));

  test('not merged', () => {
    tick(['List', ['Sinh', 'x'], ['Sinh', 'x']]).run({ x: 1 });
    expect(log).toEqual([1, 1]);
  });
  test('not removed', () => {
    expect(tick(['Block', ['Sinh', 'x'], 7]).run({ x: 2 })).toBe(7);
    expect(log).toEqual([2]);
  });
  test('not reordered', () => {
    tick(['List', ['Sinh', 'x'], ['Sinh', 'y'], ['Sinh', 'x']]).run({
      x: 1,
      y: 2,
    });
    expect(log).toEqual([1, 2, 1]);
  });
  test('not folded, closed or not', () => {
    expect(tick(['Add', ['Sinh', 2], 1]).run({})).toBe(3);
    expect(log).toEqual([2]);
  });
  test('the table is not changed by a compilation', () => {
    expect(OPERATORS.some((r) => r.head === 'Sinh')).toBe(false);
    expect(Object.isFrozen(OPERATORS) && Object.isFrozen(JS.ops)).toBe(true);
  });
  test('a shared node with an effect is evaluated at each occurrence', () => {
    const e = ce.box(['Sinh', 'x'] as never);
    const program = ce.function('Add', [e, e]);
    expect(
      compileSlice(program, { target: 'javascript', extend: TICK }).run({
        x: 3,
      })
    ).toBe(6);
    expect(log).toEqual([3, 3]);
  });
  test('the right operand of Or is evaluated only when needed', () => {
    const r = tick(['Or', 'p', ['Greater', ['Sinh', 'x'], 0]]);
    expect(r.run({ p: true, x: 5 })).toBe(true);
    expect(log).toEqual([]);
    expect(r.run({ p: false, x: 5 })).toBe(true);
    expect(log).toEqual([5]);
  });
});

describe('IR slice: the memo of the lowering', () => {
  test('a tower of shared nodes of depth 40 is linear', () => {
    const engine = new ComputeEngine();
    engine.declare('x', 'real');
    let e = engine.box('x');
    for (let i = 0; i < 40; i++)
      e = engine.function('Add', [
        engine.function('Sin', [e]),
        engine.function('Cos', [e]),
      ]);
    const start = Date.now();
    const r = compileSlice(e, { target: 'javascript' });
    expect(Date.now() - start).toBeLessThan(2000);
    let v = 0.3;
    for (let i = 0; i < 40; i++) v = Math.sin(v) + Math.cos(v);
    expect(r.run({ x: 0.3 })).toBe(v);
  });
  test('a tower of depth 40 over an If, a Sum and a Block is linear', () => {
    const engine = new ComputeEngine();
    engine.declare('x', 'real');
    const k = engine.box('k');
    const t = engine.box('t');
    let e = engine.function('If', [
      engine.function('Less', [engine.box('x'), 0]),
      engine.function('Sum', [
        engine.function('Multiply', [k, engine.box('x')]),
        engine.function('Limits', [k, 1, 3]),
      ]),
      engine.function('Block', [
        engine.function('Declare', [t, engine.box('real'), engine.box('x')]),
        engine.function('Assign', [t, engine.function('Add', [t, 1])]),
        t,
      ]),
    ]);
    for (let i = 0; i < 40; i++)
      e = engine.function('Add', [
        engine.function('Sin', [e]),
        engine.function('Cos', [e]),
      ]);
    const start = Date.now();
    const r = compileSlice(e, { target: 'javascript' });
    expect(Date.now() - start).toBeLessThan(2000);
    for (const x of [0.3, -0.5]) {
      let v = x < 0 ? 6 * x : x + 1;
      for (let i = 0; i < 40; i++) v = Math.sin(v) + Math.cos(v);
      expect(r.run({ x })).toBe(v);
    }
  });
  test('a shared node is lowered again after an Assign', () => {
    const engine = new ComputeEngine();
    engine.declare('x', 'real');
    const t = engine.box('t');
    const A = engine.function('Add', [t, 1]);
    const program = engine.function('Block', [
      engine.function('Declare', [t, engine.box('real'), engine.box('x')]),
      engine.function('Declare', [engine.box('u'), engine.box('real'), A]),
      engine.function('Assign', [t, 5]),
      engine.function('Add', [engine.box('u'), A]),
    ]);
    expect(compileSlice(program, { target: 'javascript' }).run({ x: 1 })).toBe(
      2 + 6
    );
  });
  test('a shared node in both arms, and in two loops', () => {
    const engine = new ComputeEngine();
    engine.declare('x', 'real');
    const A = engine.function('Sin', [engine.box('x')]);
    const arms = engine.function('If', [
      engine.function('Less', [engine.box('x'), 0]),
      A,
      engine.function('Add', [A, 1]),
    ]);
    expect(compileSlice(arms, { target: 'javascript' }).run({ x: 1 })).toBe(
      Math.sin(1) + 1
    );
    const k = engine.box('k');
    const term = engine.function('Multiply', [k, 2]);
    const sum = () =>
      engine.function('Sum', [term, engine.function('Limits', [k, 1, 3])]);
    const two = engine.function('Add', [sum(), sum()]);
    expect(compileSlice(two, { target: 'javascript' }).run({})).toBe(24);
  });
});

describe('IR slice: an operator is one row', () => {
  test('Tanh: one row and one spelling per printer', () => {
    const rows: Extension['rows'] = [
      {
        head: 'Tanh',
        arity: 1,
        signatures: [[['real'], 'real', 'tanh']],
        threads: true,
        effect: 'pure',
        fold: Math.tanh,
      },
    ];
    const expr = ce.box(['Add', ['Tanh', 'x'], ['Tanh', 'L']] as never);
    const point = { x: 0.3, L: [1, -2, 0.5] };
    for (const passes of [false, true])
      expect(
        agrees(
          runSlice(expr, point, passes, {
            rows,
            spellings: { tanh: 'Math.tanh($0)' },
          }),
          interpret(ce, expr, point)
        )
      ).toBe(true);
    const glsl = { rows, spellings: { tanh: 'tanh($0)' } };
    expect(compileSlice(expr, { target: 'glsl', extend: glsl }).code).toMatch(
      /tanh\(in\d_x\)/
    );
    expect(GLSL.ops.tanh).toBeUndefined();
  });
});

describe('IR slice: functions and calls', () => {
  // main(x) = sq(x) + 1, sq(a) = a * a: built by hand (no lowering makes a
  // call yet).
  const program = (recursive: boolean): Program => ({
    types: [
      { lane: 'real', shape: [] },
      { lane: 'real', shape: [] },
      { lane: 'integer', shape: [] },
      { lane: 'real', shape: [] },
      { lane: 'real', shape: [] },
      { lane: 'real', shape: [] },
    ],
    functions: [
      {
        name: 'main',
        paramNames: ['x'],
        lengthOf: [false],
        body: {
          params: [0],
          body: [
            { k: 'call', outs: [1], fn: 'sq', args: [0] },
            { k: 'const', out: 2, value: { lane: 'integer', value: 1 } },
            { k: 'op', out: 3, op: 'add', args: [1, 2] },
          ],
          yields: [3],
        },
        results: [{ lane: 'real', shape: [] }],
      },
      {
        name: 'sq',
        paramNames: ['a'],
        lengthOf: [false],
        body: {
          params: [4],
          body: recursive
            ? [{ k: 'call', outs: [5], fn: 'sq', args: [4] }]
            : [{ k: 'op', out: 5, op: 'mul', args: [4, 4] }],
          yields: [5],
        },
        results: [{ lane: 'real', shape: [] }],
      },
    ],
    entry: 'main',
  });
  test('a call verifies and prints', () => {
    verify(program(false), OPERATORS);
    expect(printJavaScript(program(false), OPERATORS).run({ x: 3 })).toBe(10);
  });
  test('recursion is in the profile of a target', () => {
    verify(program(true), OPERATORS);
    expect(admits(program(true), TARGETS.glsl)?.cause).toMatch(/recursive/);
    expect(admits(program(true), TARGETS.javascript)).toBeUndefined();
  });
});

describe('IR slice: lists of run-time length', () => {
  test('inputs are not changed, and a list result is not an input', () => {
    for (const json of [
      ['Map', ['Function', ['Multiply', 'z', 2], 'z'], 'D'],
      ['Filter', 'D', ['Function', ['Greater', 'z', 0], 'z']],
      ['If', 'p', 'D', ['Add', 'D', 1]],
      ['Add', 'D', 0],
    ]) {
      const D = [1, -2, 3];
      const r = js(json).run({ D, p: true }) as number[];
      expect(D).toEqual([1, -2, 3]);
      expect(r).not.toBe(D);
    }
  });
  test('At follows the interpreter: from 1, from the end, NaN outside', () => {
    const expr = ce.box(['At', 'D', 'x'] as never);
    for (const x of [1, 3, -1, -3, 0, 4, -4, 1.5])
      for (const passes of [true, false]) {
        const point = { D: [10, 20, 30], x };
        expect([x, runSlice(expr, point, passes)]).toEqual([
          x,
          interpret(ce, expr, point),
        ]);
      }
  });
  test('the empty list: Sum 0, Product 1, Max NaN, Max with a scalar', () => {
    const point = { D: [], x: 2 };
    for (const [json, value] of [
      [['Sum', 'D'], 0],
      [['Product', 'D'], 1],
      [['Max', 'D'], NaN],
      [['Max', 'D', 'x'], 2],
      [['Length', 'D'], 0],
    ] as [unknown, number][]) {
      expect(js(json).run(point)).toBe(value);
      expect(interpret(ce, ce.box(json as never), point)).toBe(value);
    }
  });
  test('a Map over a list of 2,000 is one loop', () => {
    const r = js(['Map', ['Function', ['Sin', 'z'], 'z'], 'D']);
    expect(r.code.length).toBeLessThan(600);
    const D = Array.from({ length: 2000 }, (_, i) => i / 100);
    expect((r.run({ D }) as number[])[1999]).toBe(Math.sin(D[1999]));
  });
  test('GLSL declines a list of run-time length, naming it', () => {
    for (const [json, name] of [
      [['Sum', 'D'], 'the list D has a run-time length'],
      // The count of a Range has no GLSL spelling.
      [['Range', 1, 'n'], 'rangecount'],
      [
        ['Filter', 'L', ['Function', ['Less', 'z', 0], 'z']],
        'the region filter',
      ],
    ] as [unknown, string][]) {
      const d = declineOf(() =>
        compileSlice(ce.box(json as never), { target: 'glsl' })
      );
      expect(d.message).toMatch(new RegExp(name));
      expect(d.message).toMatch(/on glsl/);
    }
    expect(
      declineOf(() =>
        compileSlice(
          ce.box(['Map', ['Function', ['Sin', 'z'], 'z'], 'L'] as never),
          { target: 'glsl' }
        )
      ).message
    ).toMatch(/region build \(a Map, a Filter or a Range\) on glsl/);
  });
});

describe('IR slice: draws', () => {
  // The machine engine: its values of a program with draws are doubles,
  // the bits of the compiled code.
  const machine = makeMachineEngine();
  // prettier-ignore
  const SEEDED: unknown[] = [
    ['WithRandomSeed', 42, ['Random']],
    ['WithRandomSeed', 42, ['List', ['Random'], ['Random'], ['Random']]],
    ['WithRandomSeed', 'n', ['Add', ['Random'], 'x']],
    ['WithRandomSeed', 42, ['Subtract', ['Random'], ['Multiply', 2, ['Random']]]],
    ['WithRandomSeed', 3, ['Sum', ['Multiply', 'k', ['Random']], ['Limits', 'k', 1, 'n']]],
    ['WithRandomSeed', 3, ['Sum', ['Sum', ['Random'], ['Limits', 'j', 1, 'k']], ['Limits', 'k', 1, 4]]],
    ['WithRandomSeed', 5, ['If', ['Less', ['Random'], 0.5], ['Random'], ['Add', ['Random'], 10]]],
    ['WithRandomSeed', 5, ['If', 'p', ['Random'], ['Multiply', ['Random'], ['Random']]]],
    ['WithRandomSeed', 9, ['Sum', ['Map', ['Function', ['Multiply', 'z', ['Random']], 'z'], 'D']]],
    ['WithRandomSeed', 9, ['Max', ['Map', ['Function', ['Add', 'z', ['Random']], 'z'], 'J']]],
    ['WithRandomSeed', 9, ['Sum', ['Filter', 'D', ['Function', ['Less', ['Random'], 0.5], 'z']]]],
    ['WithRandomSeed', 9, ['Add', 'D', ['Random']]],
    ['WithRandomSeed', 1, ['List', ['Random'], ['WithRandomSeed', 2, ['Random']], ['Random']]],
    ['List', ['WithRandomSeed', 1, ['Random']], ['WithRandomSeed', 1, ['Random']]],
    ['WithRandomSeed', 1, ['Add', ['WithRandomSeed', 1, ['Random']], ['Random']]],
    ['WithRandomSeed', 4, ['Block', ['Declare', 't', 'real', ['Random']], ['If', ['Less', 't', 0.5], ['Assign', 't', ['Random']]], ['Add', 't', ['Random']]]],
    ['WithRandomSeed', 6, ['Or', ['Less', 'x', 0], ['Less', ['Random'], 0.5]]],
    // A chain stops at its first false pair: the draw after it is not made.
    ['WithRandomSeed', 7, ['List', ['If', ['LessEqual', 'Pi', -1.25, ['Random']], 1, 2], ['Random']]],
    ['WithRandomSeed', 7, ['List', ['If', ['Less', ['Random'], 0.5, ['Random'], 0.7], 1, 2], ['Random']]],
    ['WithRandomSeed', 6, ['Add', ['g', ['Random']], ['f', ['Random'], ['Random']]]],
  ];
  const POINTS = [
    { x: 0.5, n: 3, p: true, D: [1.5, -2, 3], J: [4, 5, 6, 7] },
    { x: -1, n: 0, p: false, D: [], J: [2] },
  ];
  // The frames of one draw site evaluated once (a nested frame has its
  // own count; a site in an arm of `Or` is evaluated at most once).
  const ONE_SITE = new Set([0, 2, 11, 13, 14, 16]);
  test.each(SEEDED.map((p, i) => [JSON.stringify(p), p, i]))(
    '%s: one site gives the interpreter bits, another frame a warning',
    (_, json, i) => {
      const expr = machine.box(json as never);
      for (const point of POINTS) {
        const [on, off] = [true, false].map((passes) =>
          compileSlice(expr, {
            target: 'javascript',
            passes: passes ? undefined : false,
          })
        );
        expect(sameBits(on.run(point), off.run(point))).toBe(true);
        const warned = on.warnings.length > 0;
        expect([i, warned]).toEqual([i, !ONE_SITE.has(i as number)]);
        if (!warned)
          expect(sameBits(on.run(point), interpret(machine, expr, point))).toBe(
            true
          );
      }
    }
  );
  // The shapes whose order the compiler does not reproduce: a warning, the
  // same bits with the passes on and off, and deterministic.
  test.each([
    [
      'a reduce with a drawing initial value',
      () =>
        machine.box([
          'WithRandomSeed',
          1,
          [
            'Reduce',
            ['Map', ['Function', ['Multiply', 'z', ['Random']], 'z'], 'D'],
            'Add',
            ['Random'],
          ],
        ] as never),
    ],
    [
      'a shared drawing Map built twice',
      () => {
        const m = machine.box([
          'Map',
          ['Function', ['Add', 'z', ['Random']], 'z'],
          'D',
        ] as never);
        return machine.function('WithRandomSeed', [
          machine.number(1),
          machine.function('Add', [
            machine.function('Sum', [m]),
            machine.function('Max', [m]),
          ]),
        ]);
      },
    ],
    [
      'a function checked only at its first call',
      () =>
        machine.box([
          'WithRandomSeed',
          1,
          ['Add', ['rnd', 'x'], ['rnd', 2]],
        ] as never),
    ],
    [
      'Max of a drawing list and a drawing scalar',
      () =>
        machine.box([
          'WithRandomSeed',
          1,
          ['Max', ['Map', ['Function', ['Random'], 'z'], 'D'], ['Random']],
        ] as never),
    ],
  ] as [string, () => Expression][])('%s: a warning', (_, make) => {
    const expr = make();
    const [on, off] = [true, false].map((passes) =>
      compileSlice(expr, {
        target: 'javascript',
        passes: passes ? undefined : false,
      })
    );
    expect(on.warnings.map((w) => w.code)).toEqual(['seeded-draw-order']);
    expect(on.warnings[0].message).toMatch(/WithRandomSeed/);
    for (const point of POINTS) {
      expect(sameBits(on.run(point), off.run(point))).toBe(true);
      expect(sameBits(on.run(point), on.run(point))).toBe(true);
    }
  });
  test('a draw outside a frame is live: in [0, 1), and two calls differ', () => {
    const r = js(['Random']);
    const values = Array.from({ length: 20 }, () => r.run({}) as number);
    expect(values.every((v) => v >= 0 && v < 1)).toBe(true);
    expect(new Set(values).size).toBeGreaterThan(1);
  });
  test('a compiled draw reads the frame of the engine it runs in', () => {
    const r = compileSlice(machine.box(['Random'] as never), {
      target: 'javascript',
    });
    const [seedLo, seedHi] = foldSeed(42);
    const frame = { seedLo, seedHi, next: 0 };
    const prev = machine._randomFrame;
    machine._randomFrame = frame;
    let v: unknown;
    try {
      v = r.run({});
    } finally {
      machine._randomFrame = prev;
    }
    expect(v).toBe(
      machine.box(['WithRandomSeed', 42, ['Random']] as never).evaluate().re
    );
    expect(frame.next).toBe(1);
  });
  test('GLSL declines a draw and a frame', () => {
    expect(
      declineOf(() =>
        compileSlice(ce.box(['Random'] as never), { target: 'glsl' })
      ).message
    ).toMatch(/Random on glsl/);
    expect(
      declineOf(() =>
        compileSlice(
          ce.box(['Add', 'x', ['WithRandomSeed', 1, ['Random']]] as never),
          { target: 'glsl' }
        )
      ).message
    ).toMatch(/WithRandomSeed on glsl/);
  });
});

describe('IR slice: user functions', () => {
  test('a function is lowered once, and called', () => {
    const p = sliceProgram(
      ce.box(['Add', ['g', 'x'], ['g', 'y'], ['h2', 'x']] as never),
      {
        target: 'javascript',
        passes: false,
      }
    );
    expect(p.functions.map((f) => f.name.replace(/^u\d+_/, '')).sort()).toEqual(
      ['f', 'g', 'h2', 'main']
    );
  });
  test('recursion on JavaScript, a decline on GLSL', () => {
    expect(js(['fact', 'n']).run({ n: 10 })).toBe(3628800);
    expect(
      declineOf(() =>
        compileSlice(ce.box(['fact', 'n'] as never), { target: 'glsl' })
      ).message
    ).toMatch(/a recursive function .* on glsl/);
  });
  test('a function with no declaration: real parameters, the result of its body', () => {
    const p = sliceProgram(ce.box(['g', 'n'] as never), {
      target: 'javascript',
    });
    const g = p.functions.find((f) => f.name !== 'main')!;
    expect(p.types[g.body.params[0]].lane).toBe('real');
    expect(g.results[0].lane).toBe('real');
    const f = sliceProgram(ce.box(['f', 'x', 'y'] as never), {
      target: 'javascript',
    });
    expect(f.functions.find((q) => q.name !== 'main')!.results[0].lane).toBe(
      'real'
    );
  });
  test('a function value is not compiled', () => {
    expect(declineOf(() => js(['Map', 'g', 'D'])).message).toMatch(
      /not a literal/
    );
  });
});

describe('IR slice: a closed value with a loop is computed by the code', () => {
  test('a closed Sum of 10^12 terms compiles at once', () => {
    const start = Date.now();
    const r = js(['Sum', 'k', ['Limits', 'k', 1, 1e12]]);
    expect(Date.now() - start).toBeLessThan(1000);
    expect(r.code).toMatch(/for \(/);
  });
});

describe('IR slice: bindings before heads', () => {
  test('a user function named List is a call', () => {
    const engine = new ComputeEngine();
    engine.declare('x', 'real');
    engine.assign('List', engine.parse('t \\mapsto 2t'));
    const expr = engine.box(['List', 'x'] as never);
    expect(js(['List', 'x'], engine).run({ x: 3 })).toBe(6);
    expect(interpret(engine, expr, { x: 3 })).toBe(6);
  });
  test('a user Sin that draws is not folded as pure', () => {
    const engine = new ComputeEngine();
    engine.assign('Sin', engine.box(['Function', ['Random'], 't'] as never));
    const p = sliceProgram(
      engine.box(['Add', ['Sin', 1], ['Sin', 1]] as never),
      {
        target: 'javascript',
      }
    );
    const r = compileSlice(
      engine.box(['Add', ['Sin', 1], ['Sin', 1]] as never),
      {
        target: 'javascript',
      }
    );
    expect(p.functions.length).toBe(2);
    const v = r.run({}) as number;
    expect(v >= 0 && v < 2).toBe(true);
  });
  test('a parameter named Pi is the parameter', () => {
    const engine = new ComputeEngine();
    engine.assign(
      'ppi',
      engine.box(['Function', ['Multiply', 3, 'Pi'], 'Pi'] as never)
    );
    expect(js(['ppi', 2], engine).run({})).toBe(6);
  });
});

describe('IR slice: a result does not alias an input', () => {
  test.each([
    [['Map', ['Function', 'r', 'r'], 'Q']],
    [['Filter', 'Q', ['Function', 'True', 'r']]],
  ] as unknown[][])('%j', (json) => {
    const Q = [
      [1, 2],
      [3, 4],
    ];
    const r = js(json).run({ Q }) as number[][];
    expect(r).toEqual([
      [1, 2],
      [3, 4],
    ]);
    r[0][0] = 99;
    r[1] = [0, 0];
    expect(Q).toEqual([
      [1, 2],
      [3, 4],
    ]);
  });
});

describe('IR slice: real powers', () => {
  // The interpreter's real root of a negative base, through the engine's
  // own function, for a constant, a run-time and a local exponent.
  test('a constant, a run-time and a local exponent', () => {
    const cases: [unknown, Point][] = [
      [['Power', 'x', ['Rational', 2, 3]], { x: -8 }],
      [['Power', 'x', ['Divide', 1, 'n']], { x: -8, n: 3 }],
      [['Power', 'x', 'y'], { x: -8, y: 1 / 3 }],
      [['Power', 'x', 'y'], { x: -8, y: 0.5 }],
      [
        [
          'Block',
          ['Declare', 'p', 'real', ['Rational', 1, 3]],
          ['Power', 'x', ['Multiply', 2, 'p']],
        ],
        { x: -8 },
      ],
      [['Power', ['Abs', 'x'], ['Rational', 2, 3]], { x: -8 }],
    ];
    for (const [json, point] of cases) {
      const expr = ce.box(json as never);
      const expected = interpret(ce, expr, point);
      for (const passes of [true, false])
        expect([
          json,
          passes,
          agrees(runSlice(expr, point, passes), expected),
        ]).toEqual([json, passes, true]);
    }
  });
});

describe('IR slice: lists', () => {
  test('Max and Min of lists: from the identity, NaN when no element at all', () => {
    for (const [json, point] of [
      [['Max', 'D', 'L'], { D: [], L: [1, 5, -2] }],
      [['Min', 'D', 'E'], { D: [], E: [3, -1] }],
      [['Max', 'D', 'E'], { D: [], E: [] }],
      [['Max', 'D', 'E', 'x'], { D: [], E: [], x: 2 }],
      [['Min', 'J'], { J: [4, -5] }],
    ] as [unknown, Point][]) {
      const v = js(json).run(point);
      expect([
        json,
        agrees(v, interpret(ce, ce.box(json as never), point)),
      ]).toEqual([json, true]);
    }
  });
  test('Length and Sum of a Range do not make the list', () => {
    const start = Date.now();
    expect(js(['Length', ['Range', 1, 'n']]).run({ n: 2 ** 40 })).toBe(2 ** 40);
    expect(js(['Sum', ['Range', 1, 'n']]).run({ n: 1e6 })).toBe(500000500000);
    expect(js(['Length', ['Range', 'n', 1, -3]]).run({ n: 10 })).toBe(4);
    expect(js(['Length', ['Range', 'n', 1]]).run({ n: 10 })).toBe(10);
    expect(Date.now() - start).toBeLessThan(2000);
  });
  test('At of a constant index is an element after the fold; out of range NaN', () => {
    expect(js(['At', 'L', 2]).code).toMatch(/_\.L\[1\]/);
    expect(js(['At', 'L', 4]).run({ L: [1, 2, 3] })).toBeNaN();
    expect(
      interpret(ce, ce.box(['At', 'L', 4] as never), { L: [1, 2, 3] })
    ).toBeNaN();
  });
});

describe('IR slice: nothing survives a compilation', () => {
  test('a redefined function is lowered again: its draw is not shared', () => {
    const engine = makeEngine();
    engine.assign(
      'gg',
      engine.box(['Function', ['Multiply', 'a', 2], 'a'] as never)
    );
    const e = engine.box(['gg', 'x'] as never);
    const twice = engine.function('Add', [e, e]);
    const lazy = engine.box([
      'And',
      ['Less', 'x', 0],
      ['Greater', ['gg', 'x'], 0.5],
    ] as never);
    expect(compileSlice(twice, { target: 'javascript' }).run({ x: 1 })).toBe(4);
    engine.assign(
      'gg',
      engine.box(['Function', ['Multiply', 'a', ['Random']], 'a'] as never)
    );
    const e2 = engine.box(['gg', 'x'] as never);
    const p = sliceProgram(engine.function('Add', [e2, e2]), {
      target: 'javascript',
    });
    const calls = JSON.stringify(p.functions[0].body).match(/"call"/g) ?? [];
    expect(calls.length).toBe(2);
    // The draw is in the arm of `And`: not made when `x < 0` is false.
    const code = compileSlice(
      engine.box([
        'And',
        ['Less', 'x', 0],
        ['Greater', ['gg', 'x'], 0.5],
      ] as never),
      { target: 'javascript' }
    ).code;
    expect(code).toMatch(/if \(/);
    void lazy;
  });
});

describe('IR slice: decisions by binding', () => {
  test('a user At and If are calls, not the constructs', () => {
    for (const [head, json, params] of [
      ['At', ['At', 'L', 1], ['a', 'b']],
      ['If', ['If', 'p', 1, 2], ['a', 'b', 'c']],
    ] as [string, unknown, string[]][]) {
      const engine = makeEngine();
      engine.assign(head, engine.box(['Function', 99, ...params] as never));
      const expr = engine.box(json as never);
      let v: unknown;
      try {
        v = compileSlice(expr, { target: 'javascript' }).run({
          L: [1, 2, 3],
          p: true,
        });
      } catch (d) {
        if (!(d instanceof Decline)) throw d;
        v = 'declined';
      }
      expect([head, v === 99 || v === 'declined']).toEqual([head, true]);
    }
  });
  test('a library Sin after a user Sin is the library Sin', () => {
    const engine = new ComputeEngine();
    engine.declare('x', 'real');
    const library = engine.box(['Sin', 'x'] as never);
    engine.assign('Sin', engine.parse('t \\mapsto t + 100'));
    const user = engine.box(['Sin', 'x'] as never);
    const both = engine.function('Add', [user, library]);
    expect(compileSlice(both, { target: 'javascript' }).run({ x: 1 })).toBe(
      101 + Math.sin(1)
    );
  });
  test('a Reduce by a user Add declines', () => {
    const engine = makeEngine();
    engine.assign('Add', engine.box(['Function', 99, 'a', 'b'] as never));
    const expr = engine.box(
      ['Reduce', 'D', 'Add', 0] as never,
      { canonical: false } as never
    );
    expect(() => compileSlice(expr, { target: 'javascript' })).toThrow();
  });
});

describe('IR slice: one effect model', () => {
  test('a tower of depth 40 over a recursive call is linear', () => {
    // Two distinct heads over each level (`Add(e, e)` would make the
    // engine's canonical form compare the two operands, which is
    // exponential in the engine).
    let e = ce.box(['fact', 'n'] as never);
    for (let i = 0; i < 40; i++)
      e = ce.function('Add', [
        ce.function('Sin', [e]),
        ce.function('Cos', [e]),
      ]);
    const start = Date.now();
    const r = compileSlice(e, { target: 'javascript' });
    expect(Date.now() - start).toBeLessThan(2000);
    expect(r.code.length).toBeLessThan(20000);
  });
  test('a frame that calls a pure recursive function has no warning', () => {
    expect(
      js(['WithRandomSeed', 1, ['Add', ['fact', 'n'], ['Random']]]).warnings
    ).toEqual([]);
    expect(
      js(['WithRandomSeed', 1, ['Add', ['rnd', 'x'], ['Random']]]).warnings
        .length
    ).toBe(1);
  });
  test('a dead pure call is removed', () => {
    const p = sliceProgram(ce.box(['Block', ['fact', 'n'], 'x'] as never), {
      target: 'javascript',
    });
    expect(JSON.stringify(p.functions[0].body)).not.toMatch(/"call"/);
  });
});

describe('IR slice: a root function literal', () => {
  test('positional parameters, then the inputs object', () => {
    const cases: [unknown, number[]][] = [
      [
        ['Function', ['Add', ['Multiply', 'a', 2], 'b'], 'a', 'b'],
        [3, 4],
      ],
      [['Function', ['Sin', 'a'], 'a'], [0.5]],
      [['Function', ['Add', 'a', 'x'], 'a'], [2]],
      [
        [
          'Function',
          ['If', ['Less', 'a', 0], ['Negate', 'a'], 'a'],
          ['Typed', 'a', "'integer'"],
        ],
        [-3],
      ],
    ];
    for (const [json, args] of cases) {
      const lit = ce.box(json as never);
      const r = compileSlice(lit, { target: 'javascript' });
      const expected = ce.withValues(
        { x: ce.number(1.5) },
        () =>
          ce
            .function('Apply', [lit, ...args.map((a) => ce.number(a))])
            .evaluate()
            .N().re
      );
      expect([json, r.run(...args, { x: 1.5 })]).toEqual([json, expected]);
      expect(compileSlice(lit, { target: 'glsl' }).code).toMatch(
        /float f\(float in0_a/
      );
    }
  });
});

describe('IR slice: runtime', () => {
  test('a loop honours the engine deadline', () => {
    const engine = makeEngine();
    const r = compileSlice(
      engine.box(['Sum', ['Sin', 'k'], ['Limits', 'k', 1, 'n']] as never),
      { target: 'javascript' }
    );
    expect(() => engine.withTimeLimit(20, () => r.run({ n: 1e9 }))).toThrow(
      /Timeout/
    );
  });
  test('a NaN seed is a range error that names the seed', () => {
    expect(() =>
      js(['WithRandomSeed', 'x', ['Random']]).run({ x: NaN })
    ).toThrow(/WithRandomSeed: the seed is NaN/);
  });
  test('a decline keeps its node and head; a target refusal its head', () => {
    const d = declineOf(() => js(['Integrate', 'x', 'x']));
    expect([d.head, d.cause]).toEqual([
      'Integrate',
      'the operator Integrate is not in the slice',
    ]);
    const g = declineOf(() =>
      compileSlice(ce.box(['Random'] as never), { target: 'glsl' })
    );
    expect(g.head).toBe('Random');
  });
  test('a closed sub-expression of a head out of the slice is not evaluated', () => {
    expect(declineOf(() => js(['Add', 'x', ['Zeta', 3]])).cause).toMatch(
      /Zeta/
    );
  });
});

describe('IR slice: a local declared out of its type', () => {
  test('the interpreter errors, the compiled code returns the later value', () => {
    // A `real` local declared with a complex value, then overwritten: not
    // in the written contract (README, Limits).
    const json = [
      'Block',
      ['Declare', 't', 'real', ['Sqrt', 'x']],
      ['Assign', 't', 2],
      't',
    ];
    expect(js(json).run({ x: -1 })).toBe(2);
    expect(interpret(ce, ce.box(json as never), { x: -1 })).not.toBe(2);
  });
});

describe('IR slice: the iteration budget', () => {
  const budget = (json: Json, iterationBudget: number) =>
    compileSlice(ce.box(json as never), {
      target: 'javascript',
      iterationBudget,
    });
  test('one count of the passes of all the loops of a call, nested ones included', () => {
    const nested = [
      'Sum',
      ['Sum', ['Multiply', 'j', 'k'], ['Limits', 'j', 1, 3]],
      ['Limits', 'k', 1, 3],
    ];
    // 3 passes of the outer loop and 9 of the inner one.
    expect(budget(nested, 12).run({})).toBe(36);
    expect(() => budget(nested, 11).run({})).toThrow(/more than 11/);
    const r = budget(['Sum', 'k', ['Limits', 'k', 1, 'n']], 10);
    expect(r.run({ n: 10 })).toBe(55);
    // Each call starts at 0.
    expect(r.run({ n: 10 })).toBe(55);
    let error: unknown;
    try {
      r.run({ n: 11 });
    } catch (e) {
      error = e;
    }
    expect((error as { cause?: string }).cause).toBe(
      'iteration-limit-exceeded'
    );
  });
  test('a build counts its passes', () => {
    const r = budget(['Map', ['Function', ['Sin', 'z'], 'z'], 'D'], 3);
    expect(() => r.run({ D: [1, 2, 3, 4] })).toThrow(/more than 3/);
    expect((r.run({ D: [1, 2, 3] }) as number[]).length).toBe(3);
  });
  test('the budget counts the passes that run: a shared Sum runs once', () => {
    // The two operands of the List are one node: the lowering shares a
    // `may-fail` value with the evaluation that dominates it.
    const sum = ce.box(['Sum', 'k', ['Limits', 'k', 1, 3]] as never);
    const r = compileSlice(ce.function('List', [sum, sum]), {
      target: 'javascript',
      iterationBudget: 3,
    });
    expect(r.run({})).toEqual([6, 6]);
  });
});

describe('IR slice: the fixes of the review of 2026-11-12', () => {
  test('a guarded recursive call is not evaluated before its guard', () => {
    // `ev` and `od` call each other: at n = 1e6 the call overflows the
    // stack, so it must not run when `n < 20` is false.
    const r = js(['And', ['Less', 'n', 20], ['Greater', ['ev', 'n'], 0]]);
    expect(r.run({ n: 1000000 })).toBe(false);
    expect(r.run({ n: 4 })).toBe(true);
  });
  test('a call bound to the library in a user function of the same name is the library call', () => {
    const engine = new ComputeEngine();
    engine.declare('x', 'real');
    engine.declare('Sin', 'function');
    engine.assign(
      'Sin',
      engine.box([
        'Function',
        ['Multiply', 2, ['Apply', ['Module', 'Sin'], 't']],
        't',
      ] as never)
    );
    const r = js(['Sin', 'x'], engine);
    expect(r.run({ x: 2 })).toBeCloseTo(2 * Math.sin(2), 14);
  });
  test('the effect trace tells apart two draws of one region', () => {
    const p = sliceProgram(
      makeMachineEngine().box(['List', ['Random'], ['Random']] as never),
      { target: 'javascript' }
    );
    const trace = effectTrace(p, OPERATORS, new Map());
    expect(trace.length).toBe(2);
    expect(sameTrace(trace, [trace[1], trace[0]])).toBe(false);
  });
  test('the tables are frozen deeply', () => {
    expect(() =>
      (REDUCTIONS as Map<string, never>).set('Mean', {} as never)
    ).toThrow();
    expect(() => (CONSTANTS as Map<string, number>).set('Pi', 3)).toThrow();
    expect(Object.isFrozen(REDUCTIONS.get('Sum'))).toBe(true);
    expect(Object.isFrozen(TARGETS.javascript.lanes)).toBe(true);
    expect(Object.isFrozen(ALL_PASSES)).toBe(true);
    expect(Object.isFrozen(OPERATORS[0].signatures)).toBe(true);
    // A child of a container that was frozen before.
    expect(Object.isFrozen(JS.ops.round)).toBe(true);
  });
  test('a closed tower of shared nodes of depth 40 is not evaluated on every path', () => {
    // `N()` walks every path of a shared node: the walk evaluates only a
    // closed node of at most 10,000 nodes counted on every path.
    let e: Expression = ce.box(['Add', 2, ['Sqrt', 3]] as never);
    for (let k = 0; k < 40; k++) e = ce._fn('Add', [e, e]);
    const shared = compileSlice(e, { target: 'javascript' });
    expect(shared.run({}) as number).toBeCloseTo(
      2 ** 40 * (2 + Math.sqrt(3)),
      0
    );
  });
  test('a refusal of the target names the node of the region', () => {
    const d = declineOf(() =>
      sliceProgram(ce.box(['WithRandomSeed', 1, ['Random']] as never), {
        target: 'glsl',
      })
    );
    expect([d.node, d.head]).toEqual([
      'WithRandomSeed(1, Random())',
      'WithRandomSeed',
    ]);
  });
});
