/**
 * A fold whose accumulator becomes a list, with a combiner that does
 * arithmetic on the accumulator.
 *
 * With `M` declared `list<vector<2>>`, `Reduce(M, (a, t) ↦ a + t, 0)` is
 * `[4, 6]` in the interpreter at `M = [[1, 2], [3, 4]]`. The accumulator
 * parameter `a` is not declared, so the literal types it `unknown`, and the
 * JavaScript target read it as a number: the step was `[a + t[0], a + t[1]]`,
 * and from the second step on JavaScript added a list to a number, which
 * gave the strings `["1,23", "1,24"]`. The JavaScript target now compiles
 * the step with the accumulator typed by the values the fold passes there
 * (`listAccumulatorStep`, `compilation/javascript-target.ts`), so the step
 * maps over a list accumulator. A scalar fold keeps its code.
 */
import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

type Json = any;

const ROWS = [
  [1, 2],
  [3, 4],
];
const ROWS_JSON = ['List', ['List', 1, 2], ['List', 3, 4]];
const ADD = ['Function', ['Add', 'a', 't'], 'a', 't'];
const MULTIPLY = ['Function', ['Multiply', 'a', 't'], 'a', 't'];

function engine(): ComputeEngine {
  const ce = new ComputeEngine();
  ce.declare('M', 'list<vector<2>>');
  ce.declare('L', 'list<real>');
  ce.declare('n', 'integer');
  return ce;
}

function compiled(ce: ComputeEngine, json: Json) {
  return compile(ce.box(json), { to: 'javascript', fallback: false } as any)!;
}

/** The interpreter's value with the inputs substituted, as JSON. */
function interpreted(ce: ComputeEngine, json: Json, subs: Record<string, Json>) {
  const values = Object.fromEntries(
    Object.entries(subs).map(([k, v]) => [k, ce.box(v)])
  );
  return ce.box(json).subs(values).evaluate().json;
}

describe('a fold whose accumulator becomes a list maps over it', () => {
  test.each([
    ['Reduce with the seed 0', ['Reduce', 'M', ADD, 0], [4, 6]],
    ['Reduce with the seed [0, 0]', ['Reduce', 'M', ADD, ['List', 0, 0]], [4, 6]],
    ['Reduce of a product with the seed 1', ['Reduce', 'M', MULTIPLY, 1], [3, 8]],
    ['Fold with the seed 0', ['Fold', ADD, 0, 'M'], [4, 6]],
  ])('%s', (_name, json, expected) => {
    const ce = engine();
    expect(compiled(ce, json).run!({ M: ROWS })).toEqual(expected);
    expect(interpreted(ce, json, { M: ROWS_JSON })).toEqual([
      'List',
      ...expected,
    ]);
  });

  // The interpreter does not evaluate `Scan` with a function literal (the
  // expression stays as it is), so the expected value is the list of the
  // partial sums of the rows.
  test.each([
    ['Scan with the seed 0', ['Scan', 'M', ADD, 0]],
    ['Scan with no seed', ['Scan', 'M', ADD]],
  ])('%s', (_name, json) => {
    expect(compiled(engine(), json).run!({ M: ROWS })).toEqual([
      [1, 2],
      [4, 6],
    ]);
  });

  test('a step that makes a list from a scalar seed, over a range', () => {
    const ce = engine();
    const json = [
      'Reduce',
      ['Range', 1, 'n'],
      ['Function', ['Add', 'a', ['List', 'k', ['Multiply', 2, 'k']]], 'a', 'k'],
      0,
    ];
    expect(compiled(ce, json).run!({ n: 3 })).toEqual([6, 12]);
    expect(interpreted(ce, json, { n: 3 })).toEqual(['List', 6, 12]);
  });

  test('a step that nests its accumulator in a list', () => {
    const ce = engine();
    const json = ['Reduce', 'L', ['Function', ['List', 'a', 't'], 'a', 't'], 0];
    expect(compiled(ce, json).run!({ L: [1, 2] })).toEqual([[0, 1], 2]);
    expect(interpreted(ce, json, { L: ['List', 1, 2] })).toEqual([
      'List',
      ['List', 0, 1],
      2,
    ]);
  });

  test('a tuple seed over a list of tuples', () => {
    const ce = engine();
    ce.declare('P', 'list<tuple<real, real>>');
    const json = ['Reduce', 'P', ADD, ['Tuple', 0, 0]];
    expect(compiled(ce, json).run!({ P: ROWS })).toEqual([4, 6]);
    expect(
      interpreted(ce, json, {
        P: ['List', ['Tuple', 1, 2], ['Tuple', 3, 4]],
      })
    ).toEqual(['Tuple', 4, 6]);
  });

  test('a user function as the step', () => {
    const ce = engine();
    ce.declare('f', 'function');
    ce.assign('f', ce.box(ADD));
    const json = ['Reduce', 'M', 'f', 0];
    expect(compiled(ce, json).run!({ M: ROWS })).toEqual([4, 6]);
    expect(interpreted(ce, json, { M: ROWS_JSON })).toEqual(['List', 4, 6]);
  });
});

describe('a scalar fold keeps its code', () => {
  test('the step reads the accumulator as a number', () => {
    const ce = engine();
    const result = compiled(ce, ['Reduce', 'L', ADD, 0]);
    expect(result.run!({ L: [1, 2, 3] })).toBe(6);
    expect(result.code).toContain('(a, t = NaN) => a + t');
  });
});

describe('a list accumulator in the complex lane declines', () => {
  test('the step multiplies the element by i', () => {
    const ce = engine();
    const json = [
      'Reduce',
      'M',
      ['Function', ['Add', 'a', ['Multiply', 'ImaginaryUnit', 't']], 'a', 't'],
      0,
    ];
    // The interpreter gives `[4i, 6i]`. The compiled step would lift the
    // list accumulator to a complex scalar.
    expect(() => compiled(ce, json)).toThrow(
      /the accumulator can be a collection/
    );
  });
});
