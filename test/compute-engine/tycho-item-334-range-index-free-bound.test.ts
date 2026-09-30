/**
 * Tycho item 334: a literal index over a range whose bound is a free symbol.
 *
 * With `n` declared `integer` and no value, `At(Range(0, n), 1)` evaluated to
 * `NaN`. The `collection.at` handlers answer `undefined` both for an index
 * past the end of the collection and for an element they cannot compute, and
 * `At` (and `First`/`Last`) read every `undefined` as "out of range", which
 * gives the absence marker `NaN`. For `Range(0, n)` the length is not known,
 * so whether position 1 exists is not decided (it exists only when `n ≥ 0`).
 *
 * The read now gives the absence marker only when the index is provably
 * outside the collection (index 0, an empty collection, or an index past a
 * KNOWN length). Otherwise the read stays unevaluated, as it does for a
 * symbolic index, and evaluates to the element once the bound has a value.
 * The static type `integer | nan` does not change: the read may be absent.
 */

import { ComputeEngine } from '../../src/compute-engine';
import type { MathJsonExpression } from '../../src/math-json';

function engine(): ComputeEngine {
  const ce = new ComputeEngine();
  ce.declare('n', 'integer');
  ce.declare('k', 'integer');
  return ce;
}

// Each case: the MathJSON form, its LaTeX spelling, and the element it must
// give once `n` is assigned 5.
const CASES: [MathJsonExpression, string, string][] = [
  [['At', ['Range', 0, 'n'], 1], '[0...n][1]', '0'],
  [['At', ['Range', 0, 'n'], 3], '[0...n][3]', '2'],
  [['At', ['Range', 1, 'n'], -1], '[1...n][-1]', '5'],
  [['First', ['Range', 0, 'n']], '\\operatorname{First}([0...n])', '0'],
  [['Last', ['Range', 0, 'n']], '\\operatorname{Last}([0...n])', '5'],
];

describe('A literal index over a range with a free bound stays symbolic', () => {
  for (const [json, latex, value] of CASES) {
    const label = JSON.stringify(json);

    test(`box route: ${label}`, () => {
      const ce = engine();
      const e = ce.box(json);
      expect(e.type.toString()).toBe('integer | nan');
      expect(e.evaluate().json).toEqual(json);
      expect(e.N().json).toEqual(json);
    });

    test(`parse route: ${latex}`, () => {
      const ce = engine();
      const e = ce.parse(latex);
      expect(e.json).toEqual(json);
      expect(e.evaluate().json).toEqual(json);
      expect(e.N().json).toEqual(json);
    });

    test(`later-assigned bound: ${label}`, () => {
      const ce = engine();
      const held = ce.box(json);
      const evaluated = held.evaluate();
      const parsed = ce.parse(latex);
      ce.assign('n', 5);
      expect(held.evaluate().toString()).toBe(value);
      expect(evaluated.evaluate().toString()).toBe(value);
      expect(parsed.evaluate().toString()).toBe(value);
      expect(held.N().toString()).toBe(value);
    });
  }

  test('a symbolic index and Length stay symbolic (unchanged)', () => {
    const ce = engine();
    expect(
      ce
        .box(['At', ['Range', 0, 'n'], 'k'])
        .evaluate()
        .toString()
    ).toBe('At(Range(0, n), k)');
    expect(ce.parse('[0...n][k]').evaluate().toString()).toBe(
      'At(Range(0, n), k)'
    );
    expect(
      ce
        .box(['Length', ['Range', 0, 'n']])
        .evaluate()
        .toString()
    ).toBe('Length(Range(0, n))');
  });
});

describe('The length of a range with bounds typed finite', () => {
  // A range whose bounds and step are typed finite cannot be unbounded, so
  // its length is typed `integer`, not `integer | signed_infinity`.
  test('static type', () => {
    const ce = engine();
    ce.declare('x', 'real');
    ce.declare('z', 'number');
    const type = (json: MathJsonExpression) =>
      ce.box(['Length', json]).type.toString();
    expect(type(['Range', 0, 'n'])).toBe('integer');
    expect(type(['Range', 'k', 'n', 2])).toBe('integer');
    expect(type(['Range', 'n'])).toBe('integer');
    expect(type(['Range', 0, 'x'])).toBe('integer');
    expect(ce.parse('\\operatorname{Length}([0...n])').type.toString()).toBe(
      'integer'
    );
    // A bound that may be infinite keeps the wide claim.
    expect(type(['Range', 0, 'z'])).toBe('integer | signed_infinity');
    expect(type(['Range', 0, 'PositiveInfinity'])).toBe(
      'integer | signed_infinity'
    );
  });
});

describe('Provably out-of-range reads keep the absence marker', () => {
  test('known bounds', () => {
    const ce = engine();
    expect(
      ce
        .box(['At', ['Range', 0, 5], 7])
        .evaluate()
        .toString()
    ).toBe('NaN');
    expect(
      ce
        .box(['At', ['Range', 0, 5], -7])
        .evaluate()
        .toString()
    ).toBe('NaN');
    expect(ce.parse('[0...5][7]').evaluate().toString()).toBe('NaN');
    expect(
      ce
        .box(['At', ['Range', 0, 5], 0])
        .evaluate()
        .toString()
    ).toBe('NaN');
    expect(
      ce
        .box(['At', ['Range', 0, 5], 1])
        .evaluate()
        .toString()
    ).toBe('0');
    expect(
      ce
        .box(['At', ['Range', 0, 5], -1])
        .evaluate()
        .toString()
    ).toBe('5');
    expect(
      ce
        .box(['At', ['Range', 0, 3], ['List', 1, 9]])
        .evaluate()
        .toString()
    ).toBe('[0,NaN]');
  });

  test('index 0 is outside every collection, even of unknown length', () => {
    const ce = engine();
    expect(
      ce
        .box(['At', ['Range', 0, 'n'], 0])
        .evaluate()
        .toString()
    ).toBe('NaN');
  });
});

describe('Lazy collections built on a range with a free bound', () => {
  // Each case: the expression, and the element it must give once `n` is 5.
  const SIBLINGS: [MathJsonExpression, string][] = [
    [['At', ['Linspace', 0, 1, 'n'], 1], '0'],
    [['At', ['Take', ['Range', 0, 'n'], 3], 1], '0'],
    [['At', ['Drop', ['Range', 0, 'n'], 1], 1], '1'],
    [['At', ['Reverse', ['Range', 0, 'n']], 1], '5'],
    [
      [
        'At',
        ['Map', ['Function', ['Multiply', 'x', 2], 'x'], ['Range', 0, 'n']],
        2,
      ],
      '2',
    ],
    [['At', ['Power', ['Range', 0, 'n'], 2], 3], '4'],
    [
      [
        'At',
        [
          'At',
          ['Tuple', ['Range', 0, 'n'], ['Power', ['Range', 0, 'n'], 2]],
          2,
        ],
        3,
      ],
      '4',
    ],
    [
      [
        'At',
        ['Tuple', ['Range', 0, 'n'], ['Power', ['Range', 0, 'n'], 2]],
        1,
        2,
      ],
      '1',
    ],
    [['At', ['Range', 0, 'n'], ['List', 1, 2]], '[0,1]'],
    [
      [
        'At',
        ['PointList', ['Range', 0, 'n'], ['Power', ['Range', 0, 'n'], 2]],
        3,
      ],
      '(2, 4)',
    ],
  ];

  for (const [json, value] of SIBLINGS) {
    test(JSON.stringify(json), () => {
      const ce = engine();
      const held = ce.box(json);
      const ev = held.evaluate();
      // The read is not decided: it stays an `At` application, and in
      // particular is not an absence marker.
      expect(ev.operator).toBe('At');
      expect(held.N().operator).toBe('At');
      ce.assign('n', 5);
      expect(held.evaluate().toString()).toBe(value);
      expect(ev.evaluate().toString()).toBe(value);
    });
  }

  test('a point list parsed from LaTeX, read by a literal index', () => {
    const ce = engine();
    const e = ce.parse('(0...n, (0...n)^2)[3]');
    expect(e.evaluate().operator).toBe('At');
    ce.assign('n', 5);
    expect(e.evaluate().toString()).toBe('(2, 4)');
  });
});

describe('A Filter walk that stops at the iteration limit decides nothing', () => {
  // `Filter.at` walks the source only up to `ce.iterationLimit` and answers
  // `undefined` when it reaches the limit. For a source that is not known to
  // be finite, that miss is not a proof that the position is absent: the
  // element can exist past the limit. The read stays unevaluated.
  const CASES: MathJsonExpression[] = [
    [
      'At',
      [
        'Filter',
        ['Range', 1, 'PositiveInfinity'],
        ['Function', ['Greater', 'x', ['Power', 10, 6]], 'x'],
      ],
      1,
    ],
    [
      'Last',
      [
        'Filter',
        ['Range', 1, 'PositiveInfinity'],
        ['Function', ['Less', 'x', 5], 'x'],
      ],
    ],
  ];
  for (const json of CASES) {
    test(JSON.stringify(json), () => {
      const ce = new ComputeEngine();
      const e = ce.box(json);
      expect(e.evaluate().isSame(e)).toBe(true);
    });
  }

  test('the source is walked at most once per evaluation', () => {
    const ce = new ComputeEngine();
    let calls = 0;
    ce.declare('p', {
      signature: '(integer) -> boolean',
      evaluate: ([x]) => {
        calls += 1;
        return ce.symbol(x.re > 1e6 ? 'True' : 'False');
      },
    });
    const e = ce.box([
      'At',
      ['Filter', ['Range', 1, 'PositiveInfinity'], 'p'],
      1,
    ]);
    const v = e.evaluate();
    expect(v.operator).toBe('At');
    expect(calls).toBeGreaterThan(0);
    expect(calls).toBeLessThanOrEqual(ce.iterationLimit + 1);
  });

  test('a finite Filter that runs out is out of range', () => {
    const ce = new ComputeEngine();
    expect(
      ce
        .box([
          'At',
          ['Filter', ['Range', 1, 10], ['Function', ['Greater', 'x', 20], 'x']],
          1,
        ])
        .evaluate()
        .toString()
    ).toBe('NaN');
    expect(
      ce
        .box([
          'At',
          [
            'Filter',
            ['Range', 1, 'PositiveInfinity'],
            ['Function', ['Greater', 'x', 3], 'x'],
          ],
          1,
        ])
        .evaluate()
        .toString()
    ).toBe('4');
  });
});
