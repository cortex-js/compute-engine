/**
 * CE-1486: a `Loop` with no `Element` clause, ended by a `Break` or by the
 * `iterationBudget` (README of `src/compute-engine/compilation/ir/`, "Loops
 * and the runtime"; `docs/COMPILATION-MODEL.md`, "A limit on `Loop`
 * passes").
 *
 * The witness is Tycho's compiled actions and its iteration-budget test
 * (`tests/node/graph-paper/actions/compiled-step.test.ts`,
 * `tests/node/plot/compiled-iteration-budget.test.ts`). On JavaScript the
 * loop is a counted loop of 2^53 passes whose exit is the flag of the
 * `Break`; GLSL and the interval mode decline it.
 */

import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine/global-types';

type Json = unknown;

const ce = new ComputeEngine();
ce.declare('x', 'real');
ce.declare('m', 'integer');

const box = (json: Json): Expression => ce.box(json as never);
const js = (json: Json, options: object = {}): any =>
  compile(box(json), { to: 'javascript', fallback: false, ...options } as any);

function interpreted(json: Json, point: Record<string, number>): number {
  const values = Object.fromEntries(
    Object.entries(point).map(([k, v]) => [k, ce.number(v)])
  );
  return ce.withValues(values as never, () => box(json).evaluate().N().re);
}

function check(json: Json, points: Record<string, number>[], options = {}) {
  const r = js(json, options);
  expect(r.success).toBe(true);
  for (const p of points) expect(Number(r.run(p))).toBe(interpreted(json, p));
  return r;
}

/** The error that `f` throws. */
function thrownBy(f: () => unknown): any {
  try {
    f();
  } catch (e) {
    return e;
  }
  throw new Error('It did not throw');
}

const add = (name: string, v: Json) => ['Assign', name, ['Add', name, v]];
const declare = (name: string, type = "'integer'") => [
  'Declare',
  name,
  type,
  0,
];

/** Tycho's two forms (the instrument of CE-1486). */
const BREAK = [
  'Block',
  declare('k'),
  ['Loop', ['Block', add('k', 1), ['If', ['Less', 3, 'k'], ['Break']]]],
  ['Add', 'k', 'x'],
];
const NO_BREAK = [
  'Block',
  declare('k', "'unknown'"),
  ['Loop', add('k', 1)],
  ['Add', 'k', 'x'],
];

/** `s` counts the passes until it is more than `m`. */
const UNTIL_M = [
  'Block',
  declare('s'),
  ['Loop', ['Block', add('s', 1), ['If', ['Less', 'm', 's'], ['Break']]]],
  's',
];

describe('COMPILE Loop with no Element clause', () => {
  test('a Break ends it (Tycho)', () => {
    check(BREAK, [{ x: 1 }, { x: -2.5 }]);
  });

  test('a Break that reads an input', () => {
    check(UNTIL_M, [{ m: 0 }, { m: 7 }, { m: 1000 }]);
  });

  test('a Continue skips the rest of the pass', () => {
    check(
      [
        'Block',
        declare('s'),
        declare('t'),
        [
          'Loop',
          [
            'Block',
            add('s', 1),
            ['If', ['Less', 'm', 's'], ['Break']],
            ['If', ['Equal', ['Mod', 's', 2], 0], ['Continue']],
            add('t', 's'),
          ],
        ],
        't',
      ],
      [{ m: 0 }, { m: 7 }, { m: 20 }]
    );
  });

  test('a Break ends its own Loop only', () => {
    check(
      [
        'Block',
        declare('s'),
        declare('n'),
        [
          'Loop',
          [
            'Block',
            add('n', 1),
            ['If', ['Less', 'm', 'n'], ['Break']],
            declare('j'),
            [
              'Loop',
              [
                'Block',
                add('j', 1),
                ['If', ['Less', 'n', 'j'], ['Break']],
                add('s', 'j'),
              ],
            ],
          ],
        ],
        's',
      ],
      [{ m: 0 }, { m: 7 }]
    );
  });

  test('the bigint mode', () => {
    const r = js(UNTIL_M, { mode: 'bigint' });
    expect(r.success).toBe(true);
    expect(r.run({ m: 7 })).toBe(8n);
  });

  test('within the iterationBudget: the value', () => {
    check(UNTIL_M, [{ m: 7 }], { iterationBudget: 8 });
  });

  test('past the iterationBudget: a CancellationError', () => {
    const r = js(UNTIL_M, { iterationBudget: 8 });
    const e = thrownBy(() => r.run({ m: 8 }));
    expect(e.name).toBe('CancellationError');
    expect(e.cause).toBe('iteration-limit-exceeded');
  });

  test('with no Break, the iterationBudget ends it (Tycho)', () => {
    const r = js(NO_BREAK, { iterationBudget: 1_000_000 });
    expect(r.success).toBe(true);
    const e = thrownBy(() => r.run({ x: 1 }));
    expect(e.name).toBe('CancellationError');
    expect(e.cause).toBe('iteration-limit-exceeded');
    // The interpreter stops at `ce.iterationLimit`, with the same cause.
    const i = thrownBy(() =>
      ce.withValues({ x: ce.number(1) } as never, () =>
        box(NO_BREAK).evaluate()
      )
    );
    expect(i.cause).toBe('iteration-limit-exceeded');
  });

  test('with no Break and no iterationBudget, it compiles with no count', () => {
    const r = js(NO_BREAK);
    expect(r.success).toBe(true);
    expect(r.code).not.toContain('countLoopPass');
  });

  test('GLSL and the interval mode decline it', () => {
    for (const to of ['glsl', 'interval-js'])
      expect(() => js(UNTIL_M, { to })).toThrow(
        /a Loop with no Element clause \(JavaScript only\)/
      );
  });
});
