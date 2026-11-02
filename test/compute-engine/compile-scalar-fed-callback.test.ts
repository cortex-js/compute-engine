/**
 * A `Function` literal whose arguments are run-time scalars by construction
 * compiles to a bare arrow (issue #388).
 *
 * The static type of the values that a consumer passes to a literal selects
 * its variant: the bare arrow over scalars, a static map of it over lists
 * (rule R2 of `docs/plans/2026-10-31-static-shape-compilation.md`), with no
 * run-time test of the shape of a value. Two consumers also know that every
 * argument is a scalar by construction, and record it for the body:
 *
 * - a callback fed the elements of a `Range` whose start and step are finite
 *   literals. Every element is also a finite number, so a comparison against
 *   the parameter needs no NaN (`q === q`) or absence (`typeof q`) test, as
 *   for an emitted loop index;
 * - an `Apply` of a literal to arguments that are constructed scalars (a
 *   literal, a declared scalar input, a loop index).
 *
 * A list of lists maps the literal over each row with a static map.
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
    // A NaN `m` decides `q = m` false (user decision 2026-10-20), and the
    // host supplies every input, so `m` has no test either.
    expect(code).not.toContain('_.m !== undefined');
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

  test('a range with a symbolic start', () => {
    // A relation with a NaN operand is decided (user decisions 2026-10-20
    // and 2026-10-23), so the parameter takes no NaN test.
    const r = js([
      'Map',
      ['Function', ['If', ['NotEqual', 'q', 'm'], 0, 1], 'q'],
      ['Range', 'm', 5],
    ]);
    expect(r.code).not.toContain('bcastFn');
    expect(r.code).not.toContain('Array.isArray');
    expect(r.run!({ m: 2 })).toEqual([1, 0, 0, 0]);
  });

  test('a list of lists maps the callback over each row', () => {
    const r = js([
      'Map',
      ['Function', ['Multiply', 2, 'x'], 'x'],
      ['List', ['List', 1, 2], ['List', 3]],
    ]);
    expect(r.code).not.toContain('Array.isArray');
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
    expect(r.code).toBe('_SYS.mapFn((((y) => 2 * y)), [1], _.L)');
    expect(r.run!({ L: [1, 2, 3] })).toEqual([2, 4, 6]);
  });
});

// The consumer's claim is about the ARGUMENTS. A parameter is a binding of its
// own, and a body that reassigns it reads the assigned value afterwards, so
// such a parameter is neither a decided value nor a scalar in the body.
describe('a parameter the body reassigns', () => {
  test('a range-fed parameter assigned NaN compares as NaN', () => {
    // The body reads the assigned NaN, not the range value. `q > 0` tells
    // them apart: it is `True` for the range values `1, 2, 3` and `False` for
    // NaN (user decision 2026-10-20), so the branch gives `2`. `q ≠ 0` is
    // `True` for NaN (user decision 2026-10-23) and gives `1`. Until
    // 2026-10-23 a NaN operand left a `NotEqual` branch undecided and this
    // case pinned the NaN test on `q`.
    const body = (rel: string): unknown => [
      'Map',
      [
        'Function',
        [
          'Block',
          ['Assign', 'q', ['Divide', 0, 0]],
          ['If', [rel, 'q', 0], 1, 2],
        ],
        ['Typed', 'q', "'number'"],
      ],
      ['Range', 1, 3],
    ];
    const r = js(body('NotEqual'));
    expect(r.code).not.toContain('bcastFn');
    expect(r.run!({})).toEqual([1, 1, 1]);
    expect(js(body('Greater')).run!({})).toEqual([2, 2, 2]);
  });

  test('a parameter assigned a list is refused', () => {
    // The interpreter refuses this write, because it types `q` from the range
    // elements, and the compilation fails closed (CE-228). Until 2026-10-24
    // the compiled code answered `[[2, 4], [2, 4]]`, and this case pinned
    // that the body did not read `q` as a scalar after the write.
    expect(() =>
      js([
        'Map',
        [
          'Function',
          [
            'Block',
            ['Assign', 'q', ['List', 1, 2]],
            ['Apply', ['Function', ['Multiply', 2, 'z'], 'z'], 'q'],
          ],
          'q',
        ],
        ['Range', 1, 2],
      ])
    ).toThrow(/assigns `\[1,2\]`.*parameter `q` of type `integer`/);
  });
});
