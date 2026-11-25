/**
 * CE-1612: a list operator whose predicate, function or list reads a `vars`
 * name compiles (README of `src/compute-engine/compilation/ir/`, "Lists").
 * The read of the host's text is an effectful operation, but a list operator
 * that declines an effect in an element (the interpreter evaluates fewer
 * elements) does not count it: it gives the same value at each element, as
 * the interpreter's one value of the name. A draw still declines.
 */

import { compile } from '../../src/compile';
import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine/global-types';
import {
  isNumber,
  isSymbol,
} from '../../src/compute-engine/boxed-expression/type-guards';

const ce = new ComputeEngine();
ce.declare('L', 'list<real>');
ce.declare('T', 'real');

const P = ['Function', ['Greater', 't', 'T'], 't'];
const K = ['Function', ['Abs', ['Subtract', 't', 'T']], 't'];
const OPTIONS = {
  profile: 'ir',
  fallback: false,
  vars: { T: '_.T' },
  hideValues: ['T'],
} as const;

/** The diagnostic message of a compilation that throws, or `undefined`. */
function failure(f: () => unknown): string | undefined {
  try {
    f();
  } catch (x) {
    return (x as { diagnostic?: { message: string } }).diagnostic?.message;
  }
  return undefined;
}

/** The interpreter's value of `json` with the values `t` of `T` and `l` of
 *  `L`, as a number, a boolean or nested arrays of them. */
function interpreted(json: unknown, t: number, l: number[]): unknown {
  const values = {
    T: ce.number(t),
    L: ce.function(
      'List',
      l.map((x) => ce.number(x))
    ),
  };
  const read = (e: Expression): unknown =>
    isSymbol(e, 'True')
      ? true
      : isSymbol(e, 'False')
        ? false
        : isNumber(e)
          ? e.re
          : e.isFiniteCollection
            ? [...e.each()].map(read)
            : e.json;
  return ce.withValues(values as never, () =>
    read(ce.box(json as never).evaluate().N())
  );
}

describe('CE-1612: a vars name in the element of a list operator', () => {
  const cases: [string, unknown][] = [
    ['CountIf', ['CountIf', 'L', P]],
    ['Find', ['Find', 'L', P]],
    ['IndexWhere', ['IndexWhere', 'L', P]],
    ['Position', ['Position', 'L', P]],
    ['Any', ['Any', 'L', P]],
    ['All', ['All', 'L', P]],
    ['TakeWhile', ['TakeWhile', 'L', P]],
    ['ArgMin of a Map', ['ArgMin', ['Map', K, 'L']]],
    ['Zip with a Map', ['Zip', 'L', ['Map', K, 'L']]],
    ['Reduce', ['Reduce', 'L', ['Function', ['Add', 'a', 'b', 'T'], 'a', 'b']]],
    [
      'Comprehension with a condition',
      ['Comprehension', 't', ['Element', 't', 'L', ['Greater', 't', 'T']]],
    ],
  ];
  const lists = [
    [1, 3, 5, 0],
    [4, 1],
    [0, 1, 2],
  ];
  test.each(cases)('%s compiles and agrees with the interpreter', (_, json) => {
    const r = compile(ce.box(json as never), OPTIONS as never);
    expect(r).toMatchObject({ success: true });
    for (const l of lists) {
      const v = r.run!({ L: l, T: 2 } as never);
      expect(v).toEqual(interpreted(json, 2, l));
    }
  });

  test('Iterate compiles', () => {
    const json = [
      'Take',
      ['Iterate', ['Function', ['Add', 'x', 'T'], 'x'], 1],
      3,
    ];
    const r = compile(ce.box(json as never), OPTIONS as never);
    expect(r).toMatchObject({ success: true });
    expect(r.run!({ L: [], T: 2 } as never)).toEqual([3, 5, 7]);
  });

  test('a predicate that draws still declines', () => {
    const json = [
      'CountIf',
      'L',
      ['Function', ['Greater', 't', ['Add', 'T', ['Random']]], 't'],
    ];
    expect(failure(() => compile(ce.box(json as never), OPTIONS as never)))
      .toMatch(/CountIf with an effect/);
  });
});
