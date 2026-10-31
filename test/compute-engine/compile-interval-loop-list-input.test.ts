/**
 * On `interval-js`, a `Loop` or a `Comprehension` over a collection input
 * `L` declared `list<number>` gave a wrong value. `run()` converts each
 * element of a list input to a `{lo, hi}` interval, and the loop body wrapped
 * the loop variable again as `_IA.point(k)`: an interval whose bounds are
 * objects. With `L = [1, 2, 3]`, the `Loop` row gave the bounds
 * `"5[object Object][object Object][object Object]"` and the
 * `Comprehension` row gave `empty` for each element. Now only a loop
 * variable over a `Range` is wrapped, because the iterable of a `Range` is
 * the one source that emits plain numbers (`compileElementLoops` in
 * `base-compiler.ts`).
 *
 * When `L` is absent, the run has no value, as on the JavaScript target:
 * the code answers `empty` before it runs (the `collectionReadInputs` test
 * in `compileToIntervalTarget`, `interval-javascript-target.ts`). Before,
 * the `Loop` answered `entire` and `Sum(L)` answered `undefined`.
 */

import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

const LOOP = [
  'Block',
  ['Assign', 'c', 5],
  ['Loop', ['Assign', 'c', ['Add', 'c', 'k']], ['Element', 'k', 'L']],
  'c',
];
const COMPREHENSION = [
  'Comprehension',
  ['Multiply', 2, 'k'],
  ['Element', 'k', 'L'],
];

function compiled(json: unknown) {
  const ce = new ComputeEngine();
  ce.declare('L', 'list<number>');
  const result = compile(ce.box(json as any), { to: 'interval-js' });
  expect(result.success).toBe(true);
  return result;
}

/** The value of the interpreter with `L = [1, 2, 3]`. A `Comprehension`
 * stays a lazy collection, so a collection value is read element by
 * element. */
function interpret(json: unknown): unknown {
  const ce = new ComputeEngine();
  ce.declare('L', 'list<number>');
  ce.assign('L', ce.box(['List', 1, 2, 3]));
  const value = ce.box(json as any).evaluate();
  return value.isCollection ? [...value.each()].map((x) => x.json) : value.json;
}

const point = (v: number) => ({ kind: 'interval', value: { lo: v, hi: v } });

describe('interval-js: a loop over a list input', () => {
  test('Loop: the elements are the point intervals of L', () => {
    expect(interpret(LOOP)).toBe(11);
    expect(compiled(LOOP).run!({ L: [1, 2, 3] })).toEqual(point(11));
  });

  test('Comprehension: each element is a point interval', () => {
    expect(interpret(COMPREHENSION)).toEqual([2, 4, 6]);
    expect(compiled(COMPREHENSION).run!({ L: [1, 2, 3] })).toEqual([
      point(2),
      point(4),
      point(6),
    ]);
  });

  test('an element given as an interval is not wrapped again', () => {
    expect(compiled(LOOP).run!({ L: [{ lo: 1, hi: 2 }, 3] as any })).toEqual({
      kind: 'interval',
      value: { lo: 9, hi: 10 },
    });
  });

  test('a caller-mapped source of plain numbers is wrapped at its use', () => {
    const ce = new ComputeEngine();
    ce.declare('L', 'list<number>');
    const fn = compile(ce.box(LOOP as any), {
      to: 'interval-js',
      vars: { L: '[1, 2, 3]' },
    });
    expect(fn.success).toBe(true);
    expect(fn.run!({})).toEqual(point(11));
  });

  test('a mapping to the vars-object spelling is still tested', () => {
    const ce = new ComputeEngine();
    ce.declare('L', 'list<number>');
    const fn = compile(ce.box(['Sum', 'L']), {
      to: 'interval-js',
      vars: { L: '_.L' },
    });
    expect(fn.success).toBe(true);
    expect(fn.run!({})).toEqual({ kind: 'empty' });
    expect(fn.run!({ L: [1, 2, 3] })).toEqual(point(6));
  });

  test('a loop over a Range still wraps its plain-number counter', () => {
    const json = [
      'Block',
      ['Assign', 'c', 0],
      [
        'Loop',
        ['Assign', 'c', ['Add', 'c', 'k']],
        ['Element', 'k', ['Range', 1, 3]],
      ],
      'c',
    ];
    expect(compiled(json).run!({})).toEqual(point(6));
  });

  test.each([
    ['Loop', LOOP],
    ['Comprehension', COMPREHENSION],
    ['Sum', ['Sum', 'L']],
  ])('%s with L absent has no value', (_name, json) => {
    expect(compiled(json).run!({})).toEqual({ kind: 'empty' });
  });
});
