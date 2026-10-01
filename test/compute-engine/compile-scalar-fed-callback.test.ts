/**
 * A `Function` literal whose arguments are run-time scalars by construction
 * compiles to a bare arrow (issue #388).
 *
 * A literal in value position is normally wrapped in a broadcast dispatch,
 * `(_tv1) => (_tv2) => Array.isArray(_tv2) ? _SYS.bcastFn(_tv1, _tv2) :
 * _tv1(_tv2)`, because the interpreter maps a scalar-parameter function over
 * a collection argument. Two consumers know that no argument can be a
 * collection, and skip the wrapper:
 *
 * - a callback fed the elements of a `Range` whose start and step are finite
 *   literals. Every element is also a finite number, so a comparison against
 *   the parameter needs no NaN (`q === q`) or absence (`typeof q`) test, as
 *   for an emitted loop index;
 * - an `Apply` of a literal to arguments that are constructed scalars (a
 *   literal, a declared scalar input, a loop index). The closure that bound
 *   the wrapper was otherwise built again at every evaluation.
 *
 * Every other source keeps the wrapper, so a list argument still broadcasts.
 */

import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

const ce = new ComputeEngine();
ce.declare('s', 'list<integer>');
ce.declare('m', 'integer');
ce.declare('N', 'integer');
ce.declare('L', 'list<number>');

function js(json: unknown) {
  const r = compile(ce.box(json as never), {
    to: 'javascript',
    fallback: false,
  } as never);
  expect(r.success).toBe(true);
  return r;
}

describe('a callback fed a literal-start range', () => {
  const replaceAt = [
    'Map',
    ['Function', ['If', ['Equal', 'q', 'm'], 1, ['At', 's', 'q']], 'q'],
    ['Range', 1, ['Length', 's'], 1],
  ];

  test('has no broadcast wrapper and no test on its parameter', () => {
    const code = js(replaceAt).code!;
    expect(code).not.toContain('bcastFn');
    expect(code).not.toContain('Array.isArray');
    expect(code).not.toContain('q === q');
    expect(code).not.toContain('typeof (q)');
    // The free input `m` keeps its tests: the caller may leave it out.
    expect(code).toContain('_.m === _.m');
  });

  test('computes what the interpreter computes', () => {
    const r = js(replaceAt);
    expect(r.run!({ s: [5, 6, 7, 8], m: 2 })).toEqual([5, 1, 7, 8]);
    expect(r.run!({ s: [5, 6, 7, 8], m: 9 })).toEqual([5, 6, 7, 8]);
  });

  test('a one- and a two-operand range qualify', () => {
    for (const range of [
      ['Range', 'N'],
      ['Range', 1, 'N'],
    ]) {
      const r = js([
        'Map',
        ['Function', ['If', ['Equal', 'q', 'm'], 1, 0], 'q'],
        range,
      ]);
      expect(r.code).not.toContain('bcastFn');
      expect(r.run!({ N: 4, m: 2 })).toEqual([0, 1, 0, 0]);
    }
  });

  test('a range with a symbolic start keeps the wrapper and its tests', () => {
    const r = js([
      'Map',
      ['Function', ['If', ['Equal', 'q', 'm'], 1, 0], 'q'],
      ['Range', 'm', 5],
    ]);
    expect(r.code).toContain('bcastFn');
    expect(r.code).toContain('q === q');
    expect(r.run!({ m: 2 })).toEqual([1, 0, 0, 0]);
  });

  test('a list of lists still broadcasts the callback', () => {
    const r = js([
      'Map',
      ['Function', ['Multiply', 2, 'x'], 'x'],
      ['List', ['List', 1, 2], ['List', 3]],
    ]);
    expect(r.run!({})).toEqual([[2, 4], [6]]);
  });
});

describe('an Apply of a literal to scalar arguments', () => {
  test('a declared integer input applies the bare arrow', () => {
    const r = js([
      'Apply',
      ['Function', ['Add', 'y', 1], ['Typed', 'y', "'integer'"]],
      'm',
    ]);
    expect(r.code).not.toContain('bcastFn');
    expect(r.run!({ m: 4 })).toBe(5);
  });

  test('inside a fold, the loop index applies the bare arrow', () => {
    const r = js([
      'Sum',
      [
        'Apply',
        [
          'Function',
          ['Add', ['Multiply', 'y', 'y'], 'm'],
          ['Typed', 'y', "'integer'"],
        ],
        'k',
      ],
      ['Limits', 'k', 1, 'N'],
    ]);
    expect(r.code).not.toContain('bcastFn');
    // 1² + … + 10² = 385, plus 1 per term.
    expect(r.run!({ N: 10, m: 1 })).toBe(395);
  });

  test('a list argument still broadcasts', () => {
    const r = js(['Apply', ['Function', ['Multiply', 2, 'y'], 'y'], 'L']);
    expect(r.code).toContain('bcastFn');
    expect(r.run!({ L: [1, 2, 3] })).toEqual([2, 4, 6]);
  });
});
