/**
 * CE-1606: an `If` with no else whose arm is a list (a Desmos restriction of
 * a list of curves) and whose value an operator reads.
 *
 * Where the condition is false, the interpreter's value is `Missing` and the
 * compiled value is the list of NaN of the length of the arm. That list
 * stands for the absent list where no operator can tell the two apart: `At`,
 * `First` and `Last` (an element is NaN, the absent number), `Max`, `Min`,
 * `Sum` and `Product` (NaN), and arithmetic whose own value is read in the
 * same way. A discharge, `Length`, `Rest` and every other reader decline:
 * they would read a present list of NaN (`Length` 3 where the interpreter
 * gives `Missing`).
 */

import { compile } from '../../src/compile';
import { ComputeEngine } from '../../src/compute-engine';

const ce = new ComputeEngine();
ce.declare('x', 'real');
ce.declare('V', 'list<real^3>');
ce.declare('P', 'list<tuple<real, real>>');
// The smooth step of the document: `s ≔ w ↦ If(0 ≤ w ≤ 1, 3w² − 2w³)`.
ce.declare('s', 'function');
ce.assign(
  's',
  ce.box([
    'Function',
    [
      'If',
      ['LessEqual', 0, 'w', 1],
      [
        'Subtract',
        ['Multiply', 3, ['Square', 'w']],
        ['Multiply', 2, ['Power', 'w', 3]],
      ],
    ],
    'w',
  ])
);

const box = (json: unknown) => ce.box(json as never);

const JS = {
  to: 'javascript',
  mode: 'strict',
  inputs: { x: 'real' },
  fallback: false,
} as const;
const INTERVAL = { to: 'interval-js', symbolic: ['x'], fallback: false };

/** The values of `e` (MathJSON, or a boxed expression) compiled to
 *  JavaScript at each `x`. */
const js = (e: unknown, xs: number[]) => {
  const r = compile(Array.isArray(e) ? box(e) : (e as never), JS);
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

const inside = ['LessEqual', 0, 'x', 6];
// `If(0 ≤ x ≤ 6, x + [0, 4, 2])`: at `x = 1.5`, `[1.5, 5.5, 3.5]`.
const C = ['If', inside, ['Add', 'x', ['List', 0, 4, 2]]];
const point = (x: number) => ({ kind: 'interval', value: { lo: x, hi: x } });
const EMPTY = { kind: 'empty' };

describe('CE-1606: a restricted list read by At', () => {
  test('At of the restricted list on JavaScript', () => {
    expect(js(['At', C, 1], [1.5, 7])).toEqual([1.5, NaN]);
    expect(interpreted(['At', C, 1], 1.5)).toBe('1.5');
    expect(interpreted(['At', C, 1], 7)).toBe('NaN');
  });

  test('At of the restricted list on interval-js', () => {
    expect(intervals(['At', C, 1], [1.5, 7])).toEqual([point(1.5), EMPTY]);
  });

  test('Max of the elements read by At', () => {
    const max = ['Max', ['At', C, 1], ['At', C, 2]];
    expect(js(max, [1.5, 7])).toEqual([5.5, NaN]);
    expect(intervals(max, [1.5, 7])).toEqual([point(5.5), EMPTY]);
  });

  test('the value is the value with an else of a list of NaN', () => {
    const withElse = [...C, ['List', 'NaN', 'NaN', 'NaN']];
    for (const k of [1, 2, 3, 4])
      expect(js(['At', C, k], [0, 1.5, 6, 7])).toEqual(
        js(['At', withElse, k], [0, 1.5, 6, 7])
      );
  });

  test('the line readers of the document', () => {
    // `If(0 ≤ x ≤ 6, s(ElementMin(1, ElementMax(0, |Mod(x + [0, 4, 2], 6) − 3| − 1))))`
    const curves = [
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
                [
                  'Subtract',
                  ['Mod', ['Add', 'x', ['List', 0, 4, 2]], 6],
                  3,
                ],
              ],
              1,
            ],
          ],
        ],
      ],
    ];
    const reader = ['Max', ...[1, 2, 3].map((k) => ['At', curves, k])];
    const onJs = compile(box(reader), {
      ...JS,
      iterationBudget: 1000000,
      symbolic: ['y', 't', 'u', 'v'],
    } as never);
    expect(onJs.success).toBe(true);
    expect(onJs.run!({ x: 1.5 } as never)).toBe(1);
    expect(onJs.run!({ x: 7 } as never)).toBeNaN();
    expect(interpreted(reader, 1.5)).toBe('1');
    const onIntervals = compile(box(reader), {
      to: 'interval-js',
      iterationBudget: 1000000,
      symbolic: ['x', 'y', 't', 'u', 'v'],
      fallback: false,
    } as never);
    expect(onIntervals.success).toBe(true);
    expect(onIntervals.run!({ x: 1.5 } as never)).toEqual(point(1));
    expect(onIntervals.run!({ x: 7 } as never)).toEqual(EMPTY);
  });

  test('one boxed restricted list read by three At', () => {
    const c = box(C);
    const reader = ce.function(
      'Max',
      [1, 2, 3].map((k) => ce.function('At', [c, ce.number(k)]))
    );
    expect(js(reader, [1.5, 7])).toEqual([5.5, NaN]);
  });

  test('At of a restricted list of points is the point of NaN', () => {
    const r = compile(box(['At', ['If', inside, 'P'], 2]), {
      fallback: false,
    });
    const P = [
      [1, 2],
      [3, 4],
    ];
    expect(r.run!({ x: 1, P } as never)).toEqual([3, 4]);
    expect(r.run!({ x: 7, P } as never)).toEqual([NaN, NaN]);
  });

  test('At of a restricted list of stated length compiles to GLSL', () => {
    const r = compile(box(['At', ['If', inside, 'V'], 1]), {
      to: 'glsl',
      fallback: false,
    });
    expect(r.success).toBe(true);
  });
});

describe('CE-1606: the other readers that cannot tell an absent list', () => {
  test('First and Last', () => {
    expect(js(['First', C], [1.5, 7])).toEqual([1.5, NaN]);
    expect(js(['Last', C], [1.5, 7])).toEqual([3.5, NaN]);
  });

  test('Max, Min and Sum are NaN where the interpreter gives Missing', () => {
    expect(js(['Max', C], [1.5, 7])).toEqual([5.5, NaN]);
    expect(js(['Min', C], [1.5, 7])).toEqual([1.5, NaN]);
    expect(js(['Sum', C], [1.5, 7])).toEqual([10.5, NaN]);
    expect(interpreted(['Max', C], 7)).toBe('"Missing"');
  });

  test('arithmetic whose value is the result or is read by At', () => {
    expect(js(['Multiply', 2, C], [1.5, 7])).toEqual([
      [3, 11, 7],
      [NaN, NaN, NaN],
    ]);
    expect(js(['At', ['Multiply', 2, C], 2], [1.5, 7])).toEqual([11, NaN]);
  });

  test('At with a list index whose value is the result or is read by At', () => {
    const some = ['At', C, ['List', 1, 2]];
    expect(js(some, [1.5, 7])).toEqual([
      [1.5, 5.5],
      [NaN, NaN],
    ]);
    expect(js(['At', some, 2], [1.5, 7])).toEqual([5.5, NaN]);
  });

  test('an arm or the last expression of a Block that At reads', () => {
    expect(js(['At', ['If', ['Less', 1, 'x'], C], 1], [0.5, 1.5, 7])).toEqual([
      NaN,
      1.5,
      NaN,
    ]);
    expect(js(['At', ['Block', C], 2], [1.5, 7])).toEqual([5.5, NaN]);
    const which = ['Which', ['Less', 3, 'x'], C, 'True', ['List', 7, 8, 9]];
    expect(js(['At', which, 1], [1.5, 4, 7])).toEqual([7, 4, NaN]);
  });

  test('a discharge of the element agrees with the interpreter', () => {
    expect(js(['IsMissing', ['At', C, 1]], [1.5, 7])).toEqual([false, true]);
    expect(interpreted(['IsMissing', ['At', C, 1]], 7)).toBe('"True"');
    expect(js(['Coalesce', ['At', C, 1], 99], [1.5, 7])).toEqual([1.5, 99]);
    expect(interpreted(['Coalesce', ['At', C, 1], 99], 7)).toBe('99');
  });
});

describe('CE-1606: the readers of an absent list still decline', () => {
  // The interpreter's value at `x = 7` is `Missing` (`[7, 8, 9]` for
  // `Coalesce`): the list of NaN would give 3, a list of two NaN, `False`.
  test.each([
    ['Length', ['Length', C]],
    ['Rest', ['Rest', C]],
    ['IsMissing', ['IsMissing', C]],
    ['Coalesce', ['Coalesce', C, ['List', 7, 8, 9]]],
    ['AssertPresent', ['AssertPresent', C]],
    ['Count', ['Count', C]],
    ['Reverse', ['Reverse', C]],
    ['an element of a list', ['At', ['List', C, C], 1]],
    ['the index of At', ['At', ['List', 7, 8, 9], C]],
    ['an argument of Apply', ['Apply', ['Function', ['Length', 'q'], 'q'], C]],
    // An `At` with a list or a `Range` as index gives a list of NaN.
    ['IsMissing of At with a list index', ['IsMissing', ['At', C, ['List', 1, 2]]]],
    ['Length of At with a Range index', ['Length', ['At', C, ['Range', 1, 2]]]],
    ['Length of arithmetic', ['Length', ['Multiply', 2, C]]],
    ['IsMissing of arithmetic', ['IsMissing', ['Add', C, 1]]],
    [
      'Length of a Which',
      ['Length', ['Which', ['Less', 3, 'x'], C, 'True', ['List', 7, 8, 9]]],
    ],
  ])('%s declines on JavaScript and interval-js', (_, json) => {
    expect(failure(() => compile(box(json), JS))).toMatch(DECLINED);
    expect(failure(() => compile(box(json), INTERVAL as never))).toMatch(
      DECLINED
    );
  });

  test('the interpreter gives Missing where Length would give 3', () => {
    expect(interpreted(['Length', C], 1.5)).toBe('3');
    expect(interpreted(['Length', C], 7)).toBe('"Missing"');
    expect(interpreted(['Length', ['Multiply', 2, C]], 7)).toBe('"Missing"');
  });

  test('one boxed restricted list read by At and by Length declines', () => {
    const c = box(C);
    const e = ce.function('Add', [
      ce.function('At', [c, ce.number(1)]),
      ce.function('Length', [c]),
    ]);
    expect(failure(() => compile(e, JS))).toMatch(DECLINED);
  });

  test('Length of a restricted list declines on GLSL', () => {
    expect(
      failure(() =>
        compile(box(['Length', ['If', inside, 'V']]), {
          to: 'glsl',
          fallback: false,
        })
      )
    ).toMatch(DECLINED);
  });
});
