/**
 * A destructuring declaration, `let (a, b) = p`, and a `for` loop whose index
 * is a pattern, `for (p, q) in L`, compile (CE-1478; README of
 * `src/compute-engine/compilation/ir/`, "Tuples"). Every element of the value
 * is evaluated before a name is bound. A `Tuple` value binds each element; a
 * point (a tuple value) of the length of the pattern binds a name to each of
 * its elements. The interpreter refuses a value of another length, a list and
 * a scalar (an `incompatible-type` error): those decline, and so does a nested
 * pattern over a point, a stated type and the interval mode.
 */

import { compile } from '../../src/compile';
import { ComputeEngine } from '../../src/compute-engine';
import { executeEpsil } from '../../src/epsil/execute-epsil';
import type { Expression } from '../../src/compute-engine/global-types';
import {
  isFunction,
  isNumber,
} from '../../src/compute-engine/boxed-expression/type-guards';

type Json = unknown;
type Result = {
  success: boolean;
  code: string;
  run: (inputs: object) => unknown;
};

/** The interpreter's value: a number, or `'error'`. */
function read(e: Expression): unknown {
  if (isNumber(e)) return e.re;
  if (isFunction(e, 'Error')) return 'error';
  throw new Error(`no value: ${e.toString()}`);
}

/** The MathJSON of a point or a list of points, as the interpreter reads an
 *  input value. */
function boxed(v: number[] | number[][]): Json {
  return Array.isArray(v[0])
    ? ['List', ...(v as number[][]).map((p) => ['Tuple', ...p])]
    : ['Tuple', ...v];
}

/** `json` with each input of `types` declared on an engine of its own: its
 *  compilation to `to` with no fallback, or the message of its decline, and
 *  the interpreter's value at `values`. */
function program(
  json: Json,
  types: Record<string, string> = {},
  values: Record<string, number[] | number[][]> = {},
  to = 'javascript'
) {
  const ce = new ComputeEngine();
  for (const [name, t] of Object.entries(types)) ce.declare(name, t as never);
  const e = ce.box(json as never);
  let compiled: Result | undefined;
  let declined: string | undefined;
  try {
    compiled = compile(e, {
      to,
      fallback: false,
      inputs: types,
    } as never) as unknown as Result;
  } catch (x) {
    declined = (x as { diagnostic?: { message: string } }).diagnostic?.message;
  }
  for (const [name, v] of Object.entries(values))
    ce.assign(name, ce.box(boxed(v) as never));
  return { compiled, declined, interpreted: read(e.evaluate()) };
}

const declare = (pattern: Json, value: Json): Json => [
  'Declare',
  pattern,
  ['Dictionary', ['KeyValuePair', { str: 'value' }, value]],
];
const sum = (body: Json, index: Json, list: Json): Json => [
  'Block',
  ['Declare', 's', "'real'", 0],
  ['Loop', ['Assign', 's', ['Add', 's', body]], ['Element', index, list]],
  's',
];

const P1 = [
  [1, 0.5],
  [2, 1.5],
];

describe('A destructuring declaration (JavaScript)', () => {
  test.each<[string, Json, Record<string, string>, Record<string, number[]>]>([
    [
      'of a Tuple (the witness)',
      [
        'Block',
        declare(['Tuple', 'a', 'b'], ['Tuple', 1, 2]),
        ['Add', 'a', 'b'],
      ],
      {},
      {},
    ],
    [
      'of a point input',
      [
        'Block',
        declare(['Tuple', 'a', 'b'], 'P'),
        ['Add', 'a', ['Multiply', 10, 'b']],
      ],
      { P: 'tuple<real, real>' },
      { P: [1.5, 2] },
    ],
    [
      'of a point of three integers',
      [
        'Block',
        declare(['Tuple', 'a', 'b', 'c'], 'P'),
        ['Add', 'a', ['Multiply', 10, 'b'], ['Multiply', 100, 'c']],
      ],
      { P: 'tuple<integer, integer, integer>' },
      { P: [1, 2, 3] },
    ],
    [
      'of a nested Tuple',
      [
        'Block',
        declare(
          ['Tuple', ['Tuple', 'a', 'b'], 'c'],
          ['Tuple', ['Tuple', 1, 2], 3]
        ),
        ['Add', 'a', ['Multiply', 10, 'b'], ['Multiply', 100, 'c']],
      ],
      {},
      {},
    ],
    [
      'of a Tuple holding a point',
      [
        'Block',
        declare(['Tuple', ['Tuple', 'a', 'b'], 'c'], ['Tuple', 'P', 3]),
        ['Add', 'a', ['Multiply', 10, 'b'], ['Multiply', 100, 'c']],
      ],
      { P: 'tuple<real, real>' },
      { P: [1.5, 2] },
    ],
    [
      'with a wildcard',
      ['Block', declare(['Tuple', '_', 'b'], 'P'), ['Multiply', 2, 'b']],
      { P: 'tuple<real, real>' },
      { P: [1.5, 2] },
    ],
    [
      'whose names are written later',
      [
        'Block',
        declare(['Tuple', 'a', 'b'], ['Tuple', 1, 2]),
        ['Assign', 'a', ['Add', 'a', 0.5]],
        ['Add', 'a', 'b'],
      ],
      {},
      {},
    ],
    [
      'whose elements are computed',
      [
        'Block',
        declare(
          ['Tuple', 'rx', 'ry'],
          ['Tuple', ['Cos', ['At', 'P', 1]], ['Sin', ['At', 'P', 2]]]
        ),
        ['Add', ['Square', 'rx'], 'ry'],
      ],
      { P: 'tuple<real, real>' },
      { P: [0.25, 2] },
    ],
  ])('%s', (_, json, types, values) => {
    const r = program(json, types, values);
    expect(r.declined).toBeUndefined();
    expect(r.compiled!.run(values)).toBeCloseTo(r.interpreted as number, 12);
  });

  test('an element of the value reads the binding from before the statement', () => {
    // The value is evaluated before `a` is bound: `b` is the outer `a`.
    const loop = [
      'Loop',
      [
        'Block',
        declare(['Tuple', 'a', 'b'], ['Tuple', 'k', 'a']),
        ['Assign', 's', ['Add', 's', 'b']],
      ],
      ['Element', 'k', ['Range', 1, 3]],
    ];
    const r = program([
      'Block',
      ['Declare', 'a', "'integer'", 100],
      ['Declare', 's', "'real'", 0],
      loop,
      's',
    ]);
    expect(r.interpreted).toBe(300);
    expect(r.compiled!.run({})).toBe(300);
  });

  test('the value of the witness is 3', () => {
    const r = program([
      'Block',
      declare(['Tuple', 'a', 'b'], ['Tuple', 1, 2]),
      ['Add', 'a', 'b'],
    ]);
    expect(r.interpreted).toBe(3);
    expect(r.compiled!.run({})).toBe(3);
  });
});

describe('A Loop whose index is a pattern (JavaScript)', () => {
  test('over a list of points (the witness)', () => {
    const r = program(
      sum(['Multiply', 'p', 'q'], ['Tuple', 'p', 'q'], 'P1'),
      { P1: 'list<tuple<real, real>>' },
      { P1 }
    );
    expect(r.interpreted).toBe(3.5);
    expect(r.compiled!.run({ P1 })).toBe(3.5);
  });

  test('over a literal list of points', () => {
    const r = program(
      sum(
        ['Multiply', 'p', 'q'],
        ['Tuple', 'p', 'q'],
        ['List', ['Tuple', 1, 0.5], ['Tuple', 2, 1.5]]
      )
    );
    expect(r.interpreted).toBe(3.5);
    expect(r.compiled!.run({})).toBe(3.5);
  });

  test('over a list of points of three numbers, with a wildcard', () => {
    const P3 = [
      [1, 2, 3],
      [4, 5, 6],
    ];
    const r = program(
      sum(['Multiply', 'x', 'z'], ['Tuple', 'x', '_', 'z'], 'P3'),
      { P3: 'list<tuple<real, real, real>>' },
      { P3 }
    );
    expect(r.interpreted).toBe(27);
    expect(r.compiled!.run({ P3 })).toBe(27);
  });

  test('over a list of points in a function of Epsil', () => {
    const ce = new ComputeEngine();
    executeEpsil(
      ce,
      'function f(n) {\n' +
        '  let s = 0\n' +
        '  for (zx, zy) in [(1, 2), (3, 4), (n, 0.5)] {\n' +
        '    let (rx, ry) = (zx * n, zy - 1)\n' +
        '    s = s + rx * ry\n' +
        '  }\n' +
        '  s\n' +
        '}'
    );
    ce.declare('n', 'real');
    const call = ce.box(['f', 'n']);
    const r = compile(call, {
      to: 'javascript',
      fallback: false,
    } as never) as unknown as Result;
    for (const n of [0.5, 2, -3]) {
      const value = ce.box(['f', n]).evaluate().re;
      expect(r.run({ n })).toBeCloseTo(value, 12);
    }
  });
});

describe('The declines', () => {
  test.each<[string, Json, Record<string, string>, RegExp]>([
    [
      'a pattern of 2 over a point of 3',
      ['Block', declare(['Tuple', 'a', 'b'], 'P'), ['Add', 'a', 'b']],
      { P: 'tuple<real, real, real>' },
      /a pattern of 2 names for a value that is not a point of 2 elements/,
    ],
    [
      'a pattern over a list of numbers',
      ['Block', declare(['Tuple', 'a', 'b'], 'L'), ['Add', 'a', 'b']],
      { L: 'list<real^2>' },
      /not a point/,
    ],
    [
      'a pattern over a number',
      ['Block', declare(['Tuple', 'a', 'b'], 'x'), ['Add', 'a', 'b']],
      { x: 'real' },
      /not a point/,
    ],
    [
      'a nested pattern over a point',
      [
        'Block',
        declare(['Tuple', ['Tuple', 'a', 'b'], 'c'], 'P'),
        ['Add', 'a', 'c'],
      ],
      { P: 'tuple<real, real>' },
      /not a point/,
    ],
    [
      'a Loop pattern over a list of numbers',
      sum('p', ['Tuple', 'p', 'q'], 'L'),
      { L: 'list<real>' },
      /not a point/,
    ],
    [
      // An `incompatible-type` error of the canonical form.
      'a Loop pattern of 2 over points of 3',
      sum('p', ['Tuple', 'p', 'q'], 'P3'),
      { P3: 'list<tuple<real, real, real>>' },
      /Could not compile/,
    ],
  ])('%s', (_, json, types, message) => {
    const r = program(json, types);
    expect(r.compiled).toBeUndefined();
    expect(r.declined).toMatch(message);
  });

  test('a pattern of 2 over a point of 3: the interpreter gives an error', () => {
    const r = program(
      ['Block', declare(['Tuple', 'a', 'b'], 'P'), ['Add', 'a', 'b']],
      { P: 'tuple<real, real, real>' },
      { P: [1, 2, 3] }
    );
    expect(r.interpreted).toBe('error');
  });
});

describe('GLSL', () => {
  test('a declaration of a point input reads it at each index', () => {
    const r = program(
      [
        'Block',
        declare(['Tuple', 'a', 'b'], 'P'),
        ['Add', 'a', ['Multiply', 10, 'b']],
      ],
      { P: 'tuple<real, real>' },
      {},
      'glsl'
    );
    expect(r.declined).toBeUndefined();
    expect(r.compiled!.code).toMatchInlineSnapshot(
      `"(P[int(0.0)] + (10.0 * P[int(1.0)]))"`
    );
  });

  test('a Loop over a list of points declines (a list of rank 2)', () => {
    const r = program(
      sum(['Multiply', 'p', 'q'], ['Tuple', 'p', 'q'], 'P1'),
      { P1: 'list<tuple<real, real>>' },
      {},
      'glsl'
    );
    expect(r.declined).toMatch(/rank 2/);
  });
});
