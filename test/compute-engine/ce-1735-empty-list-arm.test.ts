/**
 * CE-1735: `List()` has no element type of its own. As an arm of an `If` or
 * a `Which` whose type is a flat list of integers or reals, or as the
 * argument of an `Apply` parameter declared such a list, it is the empty
 * list of that lane, on JavaScript. A combinatorics corpus (GitHub #638)
 * writes the base case of a map as `[]`.
 */

import { compile } from '../../src/compile';
import { ComputeEngine } from '../../src/compute-engine';

const ce = new ComputeEngine();
ce.declare('n', 'integer');
ce.declare('x', 'real');

const strict = { fallback: false } as const;

// The interpreter's value, as JSON: a list of numbers (a `Range` made a
// list by `ListFrom`) or a number.
const interpreted = (json: unknown, n: number) => {
  const list = ce.box(json as never).type.matches('list');
  const v = ce
    .box((list ? ['ListFrom', json] : json) as never)
    .subs({ n, x: 0.5 })
    .evaluate();
  return JSON.stringify(list ? v.ops!.map((op) => op.re) : v.re);
};

const RANGE = ['Range', 1, 'n'];
const BASE = ['If', ['Less', 'n', 1], ['List'], RANGE];

describe('CE-1735: an empty list arm takes the element type of the other arms', () => {
  test.each([
    ['the then arm', BASE],
    ['the else arm', ['If', ['Less', 'n', 1], RANGE, ['List']]],
    ['an arm of reals', ['If', ['Less', 'n', 1], ['List'], ['List', 'x', 2]]],
    [
      'a Which',
      [
        'Which',
        ['Less', 'n', 1],
        ['List'],
        ['Less', 'n', 3],
        ['List', 0.5],
        'True',
        RANGE,
      ],
    ],
    ['two empty arms', ['If', ['Less', 'n', 1], ['List'], ['List']]],
    ['Length of it', ['Length', BASE]],
    ['Sum of it', ['Sum', BASE]],
  ])('%s', (_, json) => {
    const f = compile(ce.box(json as never), strict);
    expect(f.success).toBe(true);
    for (const n of [0, 2, 3])
      expect(JSON.stringify(f.run!({ n, x: 0.5 }))).toBe(interpreted(json, n));
  });

  test('a parameter of Apply declared a list of integers', () => {
    const json = [
      'Apply',
      [
        'Function',
        ['Add', ['Length', 'xs'], ['Sum', 'xs'], 'n'],
        ['Typed', 'xs', "'list<integer>'"],
      ],
      ['List'],
    ];
    // No fold: the call is lowered, not replaced by its value.
    const f = compile(ce.box(json as never), {
      ...strict,
      constantFold: false,
    });
    expect(f.success).toBe(true);
    for (const n of [0, 5]) expect(f.run!({ n, x: 0 })).toBe(n);
  });

  // No element type to take: the arm of booleans, of points or of lists
  // (the join of two lengths takes flat lists of numbers only), an
  // argument of `Apply` with no declared type, and every target with no
  // run-time length (GLSL, the interval mode).
  test.each([
    [
      'an arm of booleans',
      ['If', ['Less', 'n', 1], ['List'], ['List', 'True']],
    ],
    [
      'an arm of points',
      ['If', ['Less', 'n', 1], ['List'], ['List', ['Tuple', 1, 2]]],
    ],
    [
      'an arm of lists',
      ['If', ['Less', 'n', 1], ['List'], ['List', ['List', 1, 2]]],
    ],
    [
      'an Apply parameter with no type',
      ['Apply', ['Function', ['Length', 'xs'], 'xs'], ['List']],
    ],
  ])('%s declines', (_, json) => {
    expect(() => compile(ce.box(json as never), strict)).toThrow(
      /an empty list/
    );
  });

  test.each(['glsl', 'interval-js'] as const)('%s declines', (to) => {
    expect(() =>
      compile(ce.box(['If', ['Less', 'n', 1], ['List'], ['List', 1, 2]]), {
        to,
        ...strict,
      })
    ).toThrow(/an empty list/);
  });
});
