/**
 * A `Range` (and a `Repeat`) whose run-time count is NaN, in the profile
 * `ir` on JavaScript: an empty list, where the interpreter leaves the
 * `Range` unevaluated (README of
 * `src/compute-engine/compilation/ir/`, "Lists"). Tycho's documents take
 * the digits of a number with `Range(1, Ceil(Log(a)))`, whose bound has no
 * value for `a ≤ 0`: the build threw "a list of more than 2^32 iterations".
 */

import { compile } from '../../src/compile';
import { ComputeEngine } from '../../src/compute-engine';

const ce = new ComputeEngine();
ce.declare('a', 'real');
ce.declare('x', 'real');

const IR = { profile: 'ir', fallback: false } as const;
const js = (json: unknown) => compile(ce.box(json as never), IR);
// The interpreter's value, as a list of numbers.
const interpreted = (json: unknown, vars: Record<string, number>) =>
  ce
    .box(['ListFrom', json] as never)
    .subs(vars)
    .evaluate()
    .ops!.map((op) => op.re);

const DIGITS = ['Range', 1, ['Ceil', ['Log', 'a']]];

describe('IR profile: a run-time count that is NaN', () => {
  test.each([
    ['a Range', DIGITS],
    [
      'a Comprehension over it (art/epq7yidtim)',
      [
        'Comprehension',
        [
          'Floor',
          [
            'Mod',
            ['Floor', ['Divide', 'a', ['Power', 10, ['Add', 'n', -1]]]],
            10,
          ],
        ],
        ['Element', 'n', DIGITS],
      ],
    ],
    [
      'a Map over it',
      ['Map', ['Function', ['Multiply', 'k', 'x'], 'k'], DIGITS],
    ],
  ])('%s is the empty list', (_, json) => {
    const f = js(json);
    for (const a of [-2.5, -1, NaN])
      expect(f.run!({ a, x: 0.5 } as never)).toEqual([]);
    // A count with a value gives the interpreter's value.
    for (const a of [5, 1234.5])
      expect(f.run!({ a, x: 0.5 } as never)).toEqual(
        interpreted(json, { a, x: 0.5 })
      );
  });

  test('a Repeat of a NaN count is the empty list', () => {
    const json = ['Repeat', 'x', ['Ceil', ['Log', 'a']]];
    expect(js(json).run!({ a: -2.5, x: 0.5 } as never)).toEqual([]);
    expect(js(json).run!({ a: 500, x: 0.5 } as never)).toEqual([0.5, 0.5, 0.5]);
  });

  test('its Sum is 0 and its Length is 0', () => {
    expect(js(['Sum', DIGITS]).run!({ a: -1 } as never)).toBe(0);
    expect(js(['Length', DIGITS]).run!({ a: -1 } as never)).toBe(0);
  });

  test('a count that folds to NaN: the same with and without the passes', () => {
    // `h` holds 2.5, so `Ceil(Log(h - 5))` is a constant NaN after `fold`.
    const d = new ComputeEngine();
    d.declare('x', 'real');
    d.declare('h', 'real');
    d.assign('h', 2.5);
    const c = ['Ceil', ['Log', ['Subtract', 'h', 5]]];
    for (const [json, want] of [
      [['Sum', ['Range', 1, c, 1]], 0],
      [['Range', 1, c], []],
      [['Repeat', 'x', c], []],
      [['Map', ['Function', ['Multiply', 'k', 'x'], 'k'], ['Range', 1, c]], []],
      [['Length', ['Repeat', 'x', c]], 0],
    ] as const)
      for (const passes of [undefined, false])
        expect(
          compile(d.box(json as never), { ...IR, passes } as never).run!({
            x: 0.5,
          } as never)
        ).toEqual(want);
  });

  test('an infinite count still throws at once', () => {
    const f = js(['Sum', ['Range', 1, ['Divide', 1, 'x']]]);
    expect(() => f.run!({ x: 0 } as never)).toThrow(RangeError);
    expect(f.run!({ x: 0.25 } as never)).toBe(10);
  });
});
