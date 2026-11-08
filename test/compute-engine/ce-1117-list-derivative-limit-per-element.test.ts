/**
 * The size limit of the differentiator (`MAX_DERIVATIVE_NODES`,
 * symbolic/derivative.ts) applies to each element of a list. The derivative
 * of a list is the list of the derivatives of its elements, so its size
 * grows with the number of elements. With one limit for the whole list, a
 * curve made of 14 or more small cubic Bezier pieces was refused (the
 * derivative stayed `D(…)`), although each piece alone was differentiated.
 *
 * One element whose derivative passes the limit still makes the whole
 * derivative decline.
 *
 * Corpus: the "Sorry" text of the Desmos document `art/2ki2hjsouf` (Tycho)
 * is a list of 29 such pieces, offset along its normal.
 */

import { ComputeEngine } from '../../src/compute-engine';

/** A literal list of 31 points, different for each `seed`. */
function points(seed: number): unknown {
  return [
    'List',
    ...Array.from({ length: 31 }, (_, i) => [
      'Tuple',
      +(Math.sin(seed * 31 + i) * 4).toFixed(3),
      +(Math.cos(seed * 17 + i) * 4).toFixed(3),
    ]),
  ];
}

/** One cubic Bezier piece, read from `points(seed)` by `At(P, 3⌈u⌉ + j)`. */
function piece(seed: number): unknown {
  const list = points(seed);
  const frac = ['Add', 'u', ['Negate', ['Floor', 'u']]];
  const s = ['Add', 1, ['Negate', frac]];
  const at = (j: number) => [
    'At',
    list,
    ['Add', ['Multiply', 3, ['Ceil', 'u']], j],
  ];
  return [
    'Add',
    ['Multiply', at(1), ['Power', frac, 3]],
    ['Multiply', 3, frac, at(0), ['Power', s, 2]],
    ['Multiply', 3, s, at(-1), ['Power', frac, 2]],
    ['Multiply', at(-2), ['Power', s, 3]],
  ];
}

/** `(x + e) / (1 + x·e)`, nested `depth` times, starting from `x`. At depth
 * 6 its first derivative passes the size limit. */
function nestedQuotient(depth: number): unknown {
  let e: unknown = 'x';
  for (let i = 0; i < depth; i++)
    e = ['Divide', ['Add', 'x', e], ['Add', 1, ['Multiply', 'x', e]]];
  return e;
}

function hasD(json: unknown): boolean {
  return JSON.stringify(json).includes('"D"');
}

const PIECE_COUNT = 16;
const pieces = Array.from({ length: PIECE_COUNT }, (_, k) => piece(k + 1));

describe('CE-1117: the derivative size limit applies to each list element', () => {
  test('a list of 16 Bezier pieces is differentiated, each as the piece alone', () => {
    const ce = new ComputeEngine();
    const d = (body: unknown) =>
      ce
        .box(['D', ['Multiply', 'v', ['PointX', body]], 'u'] as never)
        .evaluate();
    const list = d(['List', ...pieces]);
    expect(hasD(list.json)).toBe(false);
    expect(list.operator).toBe('List');
    expect(list.nops).toBe(PIECE_COUNT);
    for (let k = 0; k < PIECE_COUNT; k++) {
      const alone = d(pieces[k]);
      expect(hasD(alone.json)).toBe(false);
      expect(list.ops![k].isSame(alone)).toBe(true);
    }
  });

  test('a Join of 16 Bezier pieces is differentiated', () => {
    const ce = new ComputeEngine();
    const result = ce
      .box(['D', ['PointX', ['Join', ...pieces]], 'u'] as never)
      .evaluate();
    expect(hasD(result.json)).toBe(false);
    expect(result.operator).toBe('List');
    expect(result.nops).toBe(PIECE_COUNT);
  });

  test('one element over the limit still makes the list decline', () => {
    const ce = new ComputeEngine();
    const alone = ce.box(['D', nestedQuotient(6), 'x'] as never).evaluate();
    expect(alone.operator).toBe('D');
    const inList = ce
      .box(['D', ['List', 'x', nestedQuotient(6)], 'x'] as never)
      .evaluate();
    expect(inList.operator).toBe('D');
    const inJoin = ce
      .box([
        'D',
        ['Join', ['List', 'x'], ['List', nestedQuotient(6)]],
        'x',
      ] as never)
      .evaluate();
    expect(inJoin.operator).toBe('D');
  });

  test('an element kept as a D placeholder over the limit makes the list decline', () => {
    // `D(Hold(e), x)` is not computed and stays as a placeholder that holds
    // `e`. Here `e` has more than 25 000 nodes.
    const ce = new ComputeEngine();
    const big = [
      'Add',
      ...Array.from({ length: 9000 }, (_, i) => ['Multiply', 'x', `a${i}`]),
    ];
    const result = ce
      .box(['D', ['List', 'x', ['Hold', big]], 'x'] as never)
      .evaluate();
    expect(result.operator).toBe('D');
  });

  test('a list does not raise the limit of an operand after it', () => {
    // The list of 8 elements comes before the operand over the limit, and
    // then after it: both orders decline, as the operand alone does. The
    // operand passes the limit of its footprint (the nodes it builds), so
    // this test covers that limit, not the limit of the size of a result.
    const ce = new ComputeEngine();
    const list = ['List', 'x', 'x', 'x', 'x', 'x', 'x', 'x', 'x'];
    for (const ops of [
      [list, nestedQuotient(6)],
      [nestedQuotient(6), list],
    ]) {
      const result = ce.box(['D', ['Tuple', ...ops], 'x'] as never).evaluate();
      expect(result.operator).toBe('D');
    }
  });

  test('a list of small elements, and a nested list, are unchanged', () => {
    const ce = new ComputeEngine();
    const result = ce
      .box([
        'D',
        [
          'List',
          ['Power', 'x', 2],
          ['Sin', 'x'],
          ['List', 'x', ['Power', 'x', 3]],
        ],
        'x',
      ] as never)
      .evaluate();
    expect(result.json).toEqual([
      'List',
      ['Multiply', 2, 'x'],
      ['Cos', 'x'],
      ['List', 1, ['Multiply', 3, ['Power', 'x', 2]]],
    ]);
  });
});
