/**
 * A whole read of a list local written in place (CE-1485) and `ReplaceAt`
 * as a value (CE-1487), against the interpreter (README of
 * `src/compute-engine/compilation/ir/`, "Lists";
 * `docs/COMPILATION-MODEL.md`, "List updates").
 *
 * - A read of the local that is not `At` or `Length` (`let M = L`, an
 *   argument, a reduction, a `Map`, a `Tuple`) is a copy of its array at the
 *   read, so a later write does not change what was read. The witnesses are
 *   Tycho's: the Othello action body (`Apply(Function(…), R)` of the local
 *   `R = B`), and the statement block of its prelude runner
 *   (`Block(Declare(LLocal, {value: L}), …, Tuple(LLocal, …))`). A read in a
 *   function literal (a capture) still declines.
 * - The full Othello body still declines at its next rule: the local `p`
 *   of no stated type is a `number` (`docs/TYPE-SYSTEM.md`), passed to a
 *   parameter declared `integer`, which R5 of `docs/COMPILATION-MODEL.md`
 *   declines.
 * - `ReplaceAt(H, i, v)` as a value: a copy of `H` with one element replaced.
 */

import { compile } from '../../src/compile';
import { ComputeEngine } from '../../src/compute-engine';
import { executeEpsil } from '../../src/epsil/execute-epsil';
import type { Expression } from '../../src/compute-engine/global-types';
import {
  isFunction,
  isNumber,
  isSymbol,
} from '../../src/compute-engine/boxed-expression/type-guards';

type Json = unknown;
type Inputs = Record<string, number | number[]>;
type Result = {
  success: boolean;
  run: (inputs: object) => unknown;
  code?: string;
};

/** The message of a compilation that throws, or `undefined`. */
function failure(f: () => unknown): string | undefined {
  try {
    f();
  } catch (x) {
    return (x as { diagnostic?: { message: string } }).diagnostic?.message;
  }
  return undefined;
}

/** The interpreter's value: a list is an array, an error `'error'`, an
 *  unevaluated form `'unevaluated'`. */
function read(e: Expression): unknown {
  if (isNumber(e)) return e.re;
  if (isSymbol(e, 'True')) return true;
  if (isSymbol(e, 'False')) return false;
  if (isFunction(e, 'Error')) return 'error';
  if (isFunction(e, 'List') || isFunction(e, 'Tuple')) return e.ops.map(read);
  if (isFunction(e) && e.ops.some((x) => isFunction(x, 'Error')))
    return 'error';
  return 'unevaluated';
}

/** The type of an input of the value `v`. */
const typeOf = (v: number | number[]) =>
  Array.isArray(v)
    ? v.every(Number.isInteger)
      ? 'list<integer>'
      : 'list<real>'
    : Number.isInteger(v)
      ? 'integer'
      : 'real';

/** The Epsil function `f` of `source`, called with `inputs`, compiled to
 *  `to`, and its value in the interpreter at `values`. */
function program(source: string, inputs: Inputs, to = 'javascript') {
  const ce = new ComputeEngine();
  const r = executeEpsil(ce, source);
  expect(
    r.diagnostics.filter((d) => d.severity === 'error').map((d) => d.message)
  ).toEqual([]);
  const names = Object.keys(inputs);
  for (const name of names) ce.declare(name, typeOf(inputs[name]));
  const call = ce.box(['f', ...names] as never);
  const compiled = () =>
    compile(call, { to, fallback: false } as never) as unknown as Result;
  const interpreted = (values: Inputs) =>
    read(
      executeEpsil(
        ce,
        `f(${names.map((n) => JSON.stringify(values[n])).join(', ')})`
      ).value.N()
    );
  return { compiled, interpreted };
}

/** The compiled and the interpreter's value of `f` of `source` at each of
 *  `points` are equal, and no input is changed. */
function agrees(source: string, points: Inputs[]) {
  const p = program(source, points[0]);
  const code = p.compiled();
  expect(code.success).toBe(true);
  for (const point of points) {
    const copy = structuredClone(point);
    expect([point, code.run(copy)]).toEqual([point, p.interpreted(point)]);
    expect(copy).toEqual(point);
  }
}

const declines = (source: string, inputs: Inputs, to = 'javascript') =>
  failure(() => program(source, inputs, to).compiled());

/** The MathJSON `json` with the inputs `declare` (name to type): its
 *  compiled value equals the interpreter's at each of `points`. */
function agreesJson(
  json: Json,
  declare: Record<string, string>,
  points: Inputs[],
  to = 'javascript'
) {
  const ce = new ComputeEngine();
  for (const [n, t] of Object.entries(declare)) ce.declare(n, t);
  const code = compile(ce.box(json as never), {
    to,
    fallback: false,
  } as never) as unknown as Result;
  expect(code.success).toBe(true);
  for (const point of points) {
    for (const [n, v] of Object.entries(point))
      ce.assign(n, ce.box((Array.isArray(v) ? ['List', ...v] : v) as never));
    const expected = read(
      ce
        .box(json as never)
        .evaluate()
        .N()
    );
    const copy = structuredClone(point);
    let got: unknown;
    try {
      got = code.run(copy);
    } catch {
      got = 'error';
    }
    expect([point, got]).toEqual([point, expected]);
    expect(copy).toEqual(point);
  }
  return code;
}

describe('A whole read of a list local written in place (CE-1485)', () => {
  test('a second local keeps the value read: let M = L', () =>
    agrees(
      'function f(n: integer) -> real { let L = [0, n, 2]; let M = L; L[1] += 5; L[2] += 1; M[1] + 10 * M[2] + 100 * L[1] + 1000 * L[2] }',
      [{ n: 0 }, { n: 3 }]
    ));

  test('a copy returned after later writes: the value read', () =>
    agrees(
      'function f(H: list<integer>) -> list<integer> { let L = H; L[1] += 1; let M = L; L[1] += 10; M }',
      [{ H: [1, 2] }, { H: [5, 0, 3] }]
    ));

  test('a reduction in a loop reads the array of each pass', () =>
    agrees(
      'function f(n: integer) -> real { let L = [1, 2, 3]; let s = 0; for k in 1..n { s += sum(L); L[1] += k }; s + sum(L) }',
      [{ n: 0 }, { n: 1 }, { n: 4 }]
    ));

  test('a Map and a Max of the local before a write', () =>
    agrees(
      'function f(H: list<integer>) -> real { let L = H; let M = map(x => 2 * x, L); let m = max(L); L[-1] += 100; M[-1] + m + L[-1] + length(L) }',
      [{ H: [1, 2] }, { H: [7, 0, 3] }]
    ));

  test('a capture in a function literal still declines', () =>
    expect(
      declines(
        'function f(n: integer) -> list<integer> { let L = [0, n]; L[1] += 1; map(x => L[x], [1, 2]) }',
        { n: 0 }
      )
    ).toMatch(
      /the list local L, written in place, read in a function literal/
    ));

  // The Othello action body of Tycho, reduced: the local `R` of the board
  // `B`, an argument of a function literal before its writes, its value.
  // `q`: the second parameter of the function literal.
  const othello = (write: Json, q: Json = 'q') => [
    'Apply',
    [
      'Function',
      [
        'Block',
        [
          'Declare',
          'p',
          ['Dictionary', ['KeyValuePair', { str: 'value' }, ['At', 'B', 4]]],
        ],
        [
          'Declare',
          'R',
          ['Dictionary', ['KeyValuePair', { str: 'value' }, 'B']],
        ],
        [
          'Declare',
          'count',
          "'integer'",
          [
            'Dictionary',
            [
              'KeyValuePair',
              { str: 'value' },
              [
                'Apply',
                [
                  'Function',
                  [
                    'Add',
                    ['If', ['Equal', ['At', 'S', 1], 'q'], 1, 0],
                    ['If', ['Equal', ['At', 'S', 2], 'q'], 2, 0],
                  ],
                  ['Typed', 'S', "'list<integer>'"],
                  q,
                ],
                'R',
                'p',
              ],
            ],
          ],
        ],
        [
          'If',
          ['Less', 0, 'count'],
          ['Block', write, ['Assign', 'R', ['ReplaceAt', 'R', 4, 'count']]],
        ],
        ['Typed', 'R', "'list<integer>'"],
      ],
      ['Typed', 'B', "'list<integer>'"],
    ],
    'B',
  ];

  test('the Othello action body: an argument, then writes, then the value', () => {
    agreesJson(
      othello(['Assign', 'R', ['ReplaceAt', 'R', 'p', 9]]),
      { B: 'list<nan | real | signed_infinity>' },
      [{ B: [0, 0, 0, 1] }, { B: [1, 2, 0, 2] }, { B: [0, 0, 3, 0] }]
    );
  });

  test('a local of type number at an integer parameter declines (R5)', () => {
    // As in Tycho's body: `p` of no stated type is a `number`; the
    // interpreter tests it at the call, compiled code does not.
    const ce = new ComputeEngine();
    ce.declare('B', 'list<nan | real | signed_infinity>');
    expect(
      failure(() =>
        compile(
          ce.box(
            othello(
              ['Assign', 'R', ['ReplaceAt', 'R', 1, 9]],
              ['Typed', 'q', "'integer'"]
            ) as never
          ),
          { to: 'javascript', fallback: false }
        )
      )
    ).toMatch(/an argument of Apply that is not integer/);
  });

  test('the prelude block: the local in the Tuple of its block', () => {
    // `runPrelude` of Tycho: `Block(Declare(LLocal, {value: L}), statement,
    // Tuple(LLocal, s))`.
    agreesJson(
      [
        'Block',
        [
          'Declare',
          'LLocal',
          ['Dictionary', ['KeyValuePair', { str: 'value' }, 'L']],
        ],
        ['Declare', 's', "'real'", 0],
        [
          'Loop',
          [
            'Block',
            ['AddTo', ['At', 'LLocal', 'k'], 'k'],
            ['Assign', 's', ['Add', 's', ['Sum', 'LLocal']]],
          ],
          ['Element', 'k', ['Range', 1, ['Length', 'L']]],
        ],
        ['Tuple', 'LLocal', 's'],
      ],
      { L: 'list<real>' },
      [{ L: [1, 2, 3] }, { L: [0.5] }]
    );
  });
});

describe('ReplaceAt as a value (CE-1487)', () => {
  const H = { H: 'list<real>', i: 'integer', v: 'real' };

  test('a constant index, from the start and from the end', () => {
    agreesJson(['ReplaceAt', 'H', 1, 5], H, [{ H: [1, 2, 3] }]);
    agreesJson(['ReplaceAt', 'H', -1, 'v'], H, [{ H: [1, 2, 3], v: 0.5 }]);
  });

  test('an index known at run time, from the start and from the end', () => {
    agreesJson(['ReplaceAt', 'H', 'i', 'v'], H, [
      { H: [1, 2, 3], i: 2, v: 7 },
      { H: [1, 2, 3], i: -3, v: 7 },
      { H: [4], i: 1, v: -1 },
    ]);
  });

  test('a constant index 0 or not an integer declines', () => {
    const ce = new ComputeEngine();
    for (const [n, t] of Object.entries(H)) ce.declare(n, t);
    // (A non-integer constant index is an error of the canonical form,
    // which declines as a sub-expression of the static type error.)
    for (const i of [0])
      expect(() =>
        compile(ce.box(['ReplaceAt', 'H', i, 'v'] as never), {
          fallback: false,
        } as never)
      ).toThrow(/of ReplaceAt \(the interpreter gives no list\)/);
  });

  test('a run-time index out of range throws', () => {
    const ce = new ComputeEngine();
    for (const [n, t] of Object.entries(H)) ce.declare(n, t);
    const code = compile(ce.box(['ReplaceAt', 'H', 'i', 'v']), {
      to: 'javascript',
      fallback: false,
    }) as unknown as Result;
    for (const i of [0, 4, -4])
      expect(() => code.run({ H: [1, 2, 3], i, v: 7 })).toThrow(/out-of-range/);
  });

  test('a constant index out of a stated length declines', () => {
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    expect(
      failure(() =>
        compile(ce.box(['ReplaceAt', ['List', 'x', 2], 3, 1]), {
          to: 'javascript',
          fallback: false,
        })
      )
    ).toMatch(/the index 3 of ReplaceAt of a list of 2 elements/);
  });

  test('a real in a list of integers is a list of reals; booleans', () => {
    agreesJson(['ReplaceAt', 'H', 'i', 'v'], { ...H, H: 'list<integer>' }, [
      { H: [1, 2, 3], i: 2, v: 0.5 },
    ]);
    agreesJson(
      ['ReplaceAt', ['List', ['Less', 'v', 0], 'True'], 'i', ['Less', 0, 'v']],
      H,
      [
        { i: 1, v: 1 },
        { i: -1, v: -1 },
      ]
    );
  });

  test('in a program: the value of a ReplaceAt of a list local', () =>
    agrees(
      'function f(H: list<integer>, n: integer) -> real { let L = H; L[1] += n; let M = replaceAt(L, -1, 10 * n); L[1] += 1; M[1] + M[-1] + L[1] }',
      [
        { H: [1, 2], n: 3 },
        { H: [5, 0, 7], n: -1 },
      ]
    ));

  test('the copying form of the buddhabrot step: a ReplaceAt as the value', () =>
    // Tycho's `buddhabrotPrelude({ copying: true })`, reduced: the writes in
    // place, then `replaceAt(L, N, r + n)` as the value of the function.
    agrees(
      'function f(H: list<integer>, n: integer) -> list<number> { let L = H; const r = L[3]; for k in 1..n { const c = 1 + (k - 2 * floor(k / 2)); L = replaceAt(L, c, L[c] + 1) }; replaceAt(L, 3, r + n) }',
      [
        { H: [0, 0, 0], n: 0 },
        { H: [1, 2, 5], n: 5 },
      ]
    ));

  test('the interval mode', () => {
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    const code = compile(
      ce.box(['At', ['ReplaceAt', ['List', 'x', 2, 3], 2, ['Add', 'x', 1]], 2]),
      { to: 'interval-js', fallback: false }
    ) as unknown as Result;
    expect(code.success).toBe(true);
    expect(code.run({ x: { lo: 1, hi: 2 } })).toMatchObject({
      kind: 'interval',
      value: { lo: 2, hi: 3 },
    });
  });

  test('GLSL: a constant index of a list of a constant length', () => {
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    const list = ['List', 'x', 2, 3];
    expect(
      compile(ce.box(['Sum', ['ReplaceAt', list, -1, 'x']]), {
        to: 'glsl',
        fallback: false,
      }).success
    ).toBe(true);
    ce.declare('i', 'integer');
    expect(
      failure(() =>
        compile(ce.box(['Sum', ['ReplaceAt', list, 'i', 'x']]), {
          to: 'glsl',
          fallback: false,
        })
      )
    ).toMatch(/ReplaceAt at an index known at run time \(JavaScript only\)/);
  });
});
