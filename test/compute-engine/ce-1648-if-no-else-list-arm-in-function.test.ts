/**
 * CE-1648: an `If` with no else whose arm is a list, as the body of a user
 * function, and whose value a call reads.
 *
 * The rule of CE-1606 holds through the call: where each reader of the call
 * reads a list of NaN as an absent list (`At`, `First`, `Last`, `Max`,
 * `Min`, `Sum`, `Product`, arithmetic read in the same way, the result of
 * the program), the call compiles, and its value where the condition is
 * false is the list of NaN. Where a reader of a call tells the two apart
 * (`Length`, `Rest`, a discharge, an argument of another function), the
 * `If` declines.
 */

import { compile } from '../../src/compile';
import { ComputeEngine } from '../../src/compute-engine';

const ce = new ComputeEngine();
ce.declare('x', 'real');

const fn = (name: string, body: unknown, ...params: string[]) => {
  ce.declare(name, 'function');
  ce.assign(name, ce.box(['Function', body, ...params] as never));
};

const inside = ['LessEqual', 0, 'w', 6];
// `C(w) = If(0 ≤ w ≤ 6, w + [0, 4, 2])`: at `w = 1.5`, `[1.5, 5.5, 3.5]`.
fn('C', ['If', inside, ['Add', 'w', ['List', 0, 4, 2]]], 'w');
// A function whose body is a call of `C`.
fn('D', ['C', 'w'], 'w');
// A function whose body reads the length of a call of `C`.
fn('L', ['Length', ['C', 'w']], 'w');
// The document: the smooth step `s`, the curves `K`, and the line readers
// `M`, `m`, `V` and `S`.
fn(
  's',
  [
    'If',
    ['LessEqual', 0, 'w', 1],
    [
      'Subtract',
      ['Multiply', 3, ['Square', 'w']],
      ['Multiply', 2, ['Power', 'w', 3]],
    ],
  ],
  'w'
);
fn(
  'K',
  [
    'If',
    inside,
    [
      's',
      [
        'ElementMin',
        1,
        [
          'ElementMax',
          0,
          [
            'Subtract',
            [
              'Abs',
              ['Subtract', ['Mod', ['Add', 'w', ['List', 0, 4, 2]], 6], 3],
            ],
            1,
          ],
        ],
      ],
    ],
  ],
  'w'
);
const elements = (k: string) => [1, 2, 3].map((i) => ['At', [k, 'w'], i]);
fn('M', ['Max', ...elements('K')], 'w');
fn('m', ['Min', ...elements('K')], 'w');
fn('V', ['M', 'w'], 'w');
fn('S', ['Divide', ['Subtract', ['M', 'w'], ['m', 'w']], ['V', 'w']], 'w');

const box = (json: unknown) => ce.box(json as never);

const JS = {
  to: 'javascript',
  mode: 'strict',
  inputs: { x: 'real' },
  iterationBudget: 1000000,
  fallback: false,
} as const;
const INTERVAL = {
  to: 'interval-js',
  symbolic: ['x'],
  iterationBudget: 1000000,
  fallback: false,
};

/** The values of `e` compiled to JavaScript at each `x`. */
const js = (e: unknown, xs: number[]) => {
  const r = compile(box(e), JS as never);
  expect(r.success).toBe(true);
  return xs.map((x) => r.run!({ x } as never));
};

/** The values of `e` compiled to `interval-js` at each `x`. */
const intervals = (e: unknown, xs: number[]) => {
  const r = compile(box(e), INTERVAL as never);
  expect(r.success).toBe(true);
  return xs.map((x) => r.run!({ x } as never));
};

/** The interpreter's value of `e` at `x`. */
const interpreted = (e: unknown, x: number) =>
  ce.withValues({ x } as never, () => box(e).evaluate().toString());

/** The message of a compilation that throws, or `undefined`. */
function failure(f: () => unknown): string | undefined {
  try {
    f();
  } catch (x) {
    return (x as { diagnostic?: { message: string } }).diagnostic?.message;
  }
  return undefined;
}

const DECLINED =
  /an If with no else of a list arm whose value is read by other than At, First, Last, an arithmetic operator or a reduction/;

const point = (x: number) => ({ kind: 'interval', value: { lo: x, hi: x } });
const EMPTY = { kind: 'empty' };

describe('CE-1648: a call of a restricted list read by At', () => {
  test('At of the call on JavaScript and interval-js', () => {
    const e = ['At', ['C', 'x'], 1];
    expect(js(e, [1.5, 7])).toEqual([1.5, NaN]);
    expect(intervals(e, [1.5, 7])).toEqual([point(1.5), EMPTY]);
    expect(interpreted(e, 1.5)).toBe('1.5');
    expect(interpreted(e, 7)).toBe('NaN');
  });

  test('Max of the elements of the call', () => {
    const e = ['Max', ...[1, 2, 3].map((k) => ['At', ['C', 'x'], k])];
    expect(js(e, [1.5, 7])).toEqual([5.5, NaN]);
    expect(intervals(e, [1.5, 7])).toEqual([point(5.5), EMPTY]);
  });

  test('the call is the result of the program', () => {
    expect(js(['C', 'x'], [1.5, 7])).toEqual([
      [1.5, 5.5, 3.5],
      [NaN, NaN, NaN],
    ]);
  });

  test('a function whose body is the call', () => {
    expect(js(['At', ['D', 'x'], 2], [1.5, 7])).toEqual([5.5, NaN]);
  });

  test('the line readers of the document', () => {
    for (const k of ['M', 'm', 'V', 'S']) {
      const e = [k, 'x'];
      const expected = interpreted(e, 1.5);
      expect(String(js(e, [1.5])[0])).toBe(expected);
      expect(js(e, [7])[0]).toBeNaN();
      expect(intervals(e, [7])[0]).toEqual(EMPTY);
    }
    expect(js(['M', 'x'], [1.5])[0]).toBe(1);
  });

  test('a function of a declared result (a Typed body)', () => {
    ce.declare('C2', '(real) -> list<real^3>');
    ce.assign(
      'C2',
      box(['Function', ['If', inside, ['Add', 'w', ['List', 0, 4, 2]]], 'w'])
    );
    expect(js(['At', ['C2', 'x'], 1], [1.5, 7])).toEqual([1.5, NaN]);
    expect(interpreted(['C2', 'x'], 7)).toBe('"Missing"');
    expect(
      failure(() => compile(box(['Length', ['C2', 'x']]), JS as never))
    ).toMatch(DECLINED);
  });

  test('a call read by Length beside a call read by At declines', () => {
    // `Length` of the call, read by an arithmetic operator, declines; the
    // `At` alone compiles.
    const e = ['Add', ['At', ['C', 'x'], 1], ['Length', ['C', 'x']]];
    expect(failure(() => compile(box(e), JS as never))).toMatch(DECLINED);
  });
});

describe('CE-1648: the readers of an absent list of a call still decline', () => {
  test.each([
    ['Length', ['Length', ['C', 'x']]],
    ['Rest', ['Rest', ['C', 'x']]],
    ['IsMissing', ['IsMissing', ['C', 'x']]],
    ['Coalesce', ['Coalesce', ['C', 'x'], ['List', 7, 8, 9]]],
    ['Length of a forwarding call', ['Length', ['D', 'x']]],
    ['Length in a function body', ['L', 'x']],
    [
      'Length of arithmetic of the call',
      ['Length', ['Multiply', 2, ['C', 'x']]],
    ],
  ])('%s declines on JavaScript and interval-js', (_, json) => {
    expect(failure(() => compile(box(json), JS as never))).toMatch(DECLINED);
    expect(failure(() => compile(box(json), INTERVAL as never))).toMatch(
      DECLINED
    );
  });

  test('the interpreter gives Missing where Length would give 3', () => {
    expect(interpreted(['Length', ['C', 'x']], 1.5)).toBe('3');
    expect(interpreted(['Length', ['C', 'x']], 7)).toBe('"Missing"');
  });
});

describe('CE-1648: a recursive function', () => {
  ce.declare('R', '(real) -> list<real^2>');
  ce.assign(
    'R',
    box([
      'Function',
      [
        'If',
        ['Less', 0, 'w'],
        ['Add', ['R', ['Subtract', 'w', 1]], ['List', 1, 1]],
      ],
      'w',
    ])
  );
  ce.declare('U', '(real) -> list<real^2>');
  ce.assign(
    'U',
    box([
      'Function',
      [
        'If',
        ['Less', 0, 'w'],
        [
          'Add',
          ['Coalesce', ['U', ['Subtract', 'w', 1]], ['List', 0, 0]],
          ['List', 1, 1],
        ],
      ],
      'w',
    ])
  );

  test('a recursive call read by arithmetic compiles', () => {
    // The recursion ends in `Missing`: NaN, as `At` of it.
    expect(js(['At', ['R', 'x'], 1], [2.5])).toEqual([NaN]);
  });

  test('a recursive call read by Coalesce declines', () => {
    // The interpreter gives 3: `Coalesce` reads the absent list of `U(-0.5)`.
    expect(interpreted(['At', ['U', 'x'], 1], 2.5)).toBe('3');
    expect(
      failure(() => compile(box(['At', ['U', 'x'], 1]), JS as never))
    ).toMatch(/a recursive call of U whose value can be an absent list/);
  });

  test('a recursive call on another lane declines, with no deep recursion', () => {
    // The call `F(i·w)` takes the complex lane: the IR function of that
    // lane is lowered inside the body of the real one.
    ce.declare('F', '(number) -> list<real^2>');
    ce.assign(
      'F',
      box([
        'Function',
        [
          'If',
          ['Less', 0, ['Re', 'w']],
          ['Add', ['F', ['Multiply', 'w', 'ImaginaryUnit']], ['List', 1, 1]],
        ],
        'w',
      ])
    );
    expect(
      failure(() =>
        compile(box(['At', ['F', 'x'], 1]), {
          ...JS,
          mode: 'complex',
        } as never)
      )
    ).toMatch(DECLINED);
  });
});

describe('CE-1648: a function that does not rely on the reader', () => {
  test('one IR function serves a call read by At and one read by Rest', () => {
    fn('q', ['Add', ['Sin', 'w'], ['List', 1, 2]], 'w');
    const e = [
      'Add',
      ['At', ['q', 'x'], 1],
      ['At', ['Rest', ['q', ['Multiply', 2, 'x']]], 1],
    ];
    const r = compile(box(e), { to: 'glsl', fallback: false });
    expect(r.success).toBe(true);
    expect(r.code).toMatch(/_fn_ir_u0_q\(x\)/);
    expect(r.code).toMatch(/_fn_ir_u0_q\(\(2\.0 \* x\)\)/);
    expect(r.code).not.toMatch(/u1_q/);
    expect(js(e, [0])[0]).toBe(3);
  });

  test('a function that calls a function serves both kinds of calls', () => {
    fn('f', ['Add', ['Sin', 'w'], ['List', 1, 2]], 'w');
    fn('g', ['Multiply', 2, ['f', 'w']], 'w');
    fn('h', ['Rest', 'w'], 'w');
    const e = [
      'Add',
      ['At', ['g', 'x'], 1],
      ['At', ['h', ['g', ['Multiply', 3, 'x']]], 1],
    ];
    const r = compile(box(e), { to: 'glsl', fallback: false });
    expect(r.success).toBe(true);
    expect(r.code).toMatch(/_fn_ir_u0_g\(x\)/);
    expect(r.code).toMatch(/_fn_ir_u0_g\(\(3\.0 \* x\)\)/);
  });

  test('the calls of C read by At in GLSL call one IR function', () => {
    const e = [
      'Add',
      ['At', ['C', 'x'], 1],
      ['At', ['C', ['Multiply', 2, 'x']], 2],
    ];
    const r = compile(box(e), { to: 'glsl', fallback: false });
    expect(r.success).toBe(true);
    expect(r.code).not.toMatch(/u1_C/);
  });
});
