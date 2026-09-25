/**
 * The `threadsConditionals` operator-definition flag.
 *
 * A conditional value whose condition is not decided — a restriction
 * `When(v, c)` or a piecewise `Which(…)` — moves out of an application of an
 * operator that sets the flag: `f(When(v, c))` is `When(f(v), c)`. With its
 * condition undecided, a restricted LIST evaluates to the list of its
 * restricted cells, and a list whose every cell has the same condition is
 * read back as one restricted list first. The values below are checked with
 * `t` free, with `t = 2` (the condition holds) and with `t = -1` (it does
 * not).
 */

import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

const c = ['Less', 0, 't'];
const W = (x: unknown) => ['When', x, c];
const RP = W(['Tuple', 3, 4]);
const RL = W(['List', ['Tuple', 3, 4], ['Tuple', 6, 8]]);
/** A list of points restricted element by element (a list condition). */
const LE = [
  'When',
  ['List', ['Tuple', 3, 4], ['Tuple', 6, 8]],
  ['List', c, ['Less', 't', 0]],
];
const O = ['Tuple', 0, 0];

function value(json: unknown, t?: number): string {
  const ce = new ComputeEngine();
  if (t !== undefined) ce.assign('t', t);
  return ce
    .box(json as never)
    .evaluate()
    .toString();
}

function type(json: unknown): string {
  return new ComputeEngine().box(json as never).type.toString();
}

describe('Distance of a restricted point or list of points', () => {
  test.each([
    ['a restricted point', ['Distance', RP, O], '5 {0 < t}', '5', 'NaN'],
    [
      'a restricted list of points',
      ['Distance', RL, O],
      '[5 {0 < t},10 {0 < t}]',
      '[5,10]',
      '"Missing"',
    ],
    [
      'a list that holds an absent point',
      ['Distance', ['List', ['Tuple', 3, 4], 'Missing'], O],
      '[5,NaN]',
      '[5,NaN]',
      '[5,NaN]',
    ],
    [
      'a list that holds a restricted point',
      ['Distance', ['List', RP, ['Tuple', 6, 8]], O],
      '[5 {0 < t},10]',
      '[5,10]',
      '[NaN,10]',
    ],
    [
      'an element-wise restriction',
      ['Distance', LE, O],
      '[5 {0 < t},10 {t < 0}]',
      '[5,NaN]',
      '[NaN,10]',
    ],
    [
      'a piecewise point',
      ['Distance', ['Which', c, ['Tuple', 3, 4]], O],
      'Which(0 < t, 5)',
      '5',
      'NaN',
    ],
  ])('%s', (_l, json, free, present, absent) => {
    expect(value(json)).toBe(free);
    expect(value(json, 2)).toBe(present);
    expect(value(json, -1)).toBe(absent);
  });

  test('the types admit the values', () => {
    expect(type(['Distance', RP, O])).toBe('number');
    expect(type(['Distance', RL, O])).toBe('list<number> | missing');
  });
});

describe('Norm of a restricted point or list of points', () => {
  test.each([
    ['a restricted point', ['Norm', RP], '5 {0 < t}', '5', 'NaN'],
    ['a restricted point, order 1', ['Norm', RP, 1], '7 {0 < t}', '7', 'NaN'],
    [
      'a restricted list of points',
      ['Norm', RL],
      '[5 {0 < t},10 {0 < t}]',
      '[5,10]',
      '"Missing"',
    ],
    [
      'a list that holds an absent point',
      ['Norm', ['List', ['Tuple', 3, 4], 'Missing']],
      '[5,NaN]',
      '[5,NaN]',
      '[5,NaN]',
    ],
    [
      'a list whose first point is restricted',
      ['Norm', ['List', RP, ['Tuple', 6, 8]]],
      '[5 {0 < t},10]',
      '[5,10]',
      '[NaN,10]',
    ],
    [
      'an element-wise restriction',
      ['Norm', LE],
      '[5 {0 < t},10 {t < 0}]',
      '[5,NaN]',
      '[NaN,10]',
    ],
  ])('%s', (_l, json, free, present, absent) => {
    expect(value(json)).toBe(free);
    expect(value(json, 2)).toBe(present);
    expect(value(json, -1)).toBe(absent);
  });

  test('a list whose first point is restricted is typed as a list', () => {
    // It was typed `number`, the norm of a vector, while its value is one
    // norm per point.
    expect(type(['Norm', ['List', RP, ['Tuple', 6, 8]]])).toBe('list<number>');
    expect(type(['Norm', RL])).toBe('list<number> | missing');
  });
});

describe('The types of element access of a restricted operand', () => {
  test.each([
    [['At', W(['List', ['List', 1, 2], ['List', 3, 4]]), 2, 1]],
    [['At', W(['Tuple', 1, 2]), 2]],
    [['First', W(['Tuple', 1, 2])]],
    [['Last', W(['Tuple', 1, 2])]],
  ])('%j admits Missing and an integer', (json) => {
    const t = type(json);
    // Before: `missing | vector<integer^2>`, `unknown` and `integer`.
    expect(t).toContain('missing');
    expect(t).toContain('integer');
    expect(t).not.toContain('vector');
    expect(value(json, -1)).toBe('"Missing"');
  });

  test('the coordinate of an absent point is typed as a number', () => {
    // It was typed `missing` while its value is `NaN`.
    expect(type(['PointX', 'Missing'])).toBe('number');
    expect(value(['PointX', 'Missing'])).toBe('NaN');
  });

  test('a symbol declared as a restricted point stays symbolic', () => {
    const ce = new ComputeEngine();
    ce.declare('q', 'missing | tuple<integer, integer>');
    for (const op of ['First', 'Last', 'PointX']) {
      const e = ce.box([op, 'q'] as never);
      expect(e.evaluate().toString()).toBe(e.toString());
    }
  });
});

describe('Point accessors over a list whose cells can be absent', () => {
  // A masked cell of a list is `Missing`, and the list is typed
  // `list<T | missing>` (user decision of 2026-09-09, `docs/ERROR-MODEL.md`).
  // The coordinate of an absent point of a list is `Missing` too, so the
  // type of the coordinate list must admit it. It was `list<number>`.
  const P3 = (a: number, b: number, z: number) => ['Tuple', a, b, z];
  const lists: [string, unknown][] = [
    ['a restricted first point', ['List', RP, ['Tuple', 6, 8]]],
    ['a restricted last point', ['List', ['Tuple', 6, 8], RP]],
    ['an absent first point', ['List', 'Missing', ['Tuple', 6, 8]]],
    ['an element-wise restriction', LE],
  ];
  const cases: [string, unknown][] = [
    ...lists.flatMap(([l, L]): [string, unknown][] => [
      [`PointX of ${l}`, ['PointX', L]],
      [`PointY of ${l}`, ['PointY', L]],
      [`First of ${l}`, ['First', L]],
      [`Last of ${l}`, ['Last', L]],
    ]),
    [
      'PointZ of a list with a restricted 3-D point',
      ['PointZ', ['List', W(P3(1, 2, 3)), P3(3, 4, 5)]],
    ],
  ];
  test.each(cases)('%s: the type admits the value', (_l, json) => {
    for (const t of [2, -1]) {
      const ce = new ComputeEngine();
      ce.assign('t', t);
      const e = ce.box(json as never);
      const v = e.evaluate();
      expect(v.type.matches(e.type)).toBe(true);
    }
  });

  test('the coordinate list is typed with a missing cell', () => {
    expect(type(['PointY', ['List', RP, ['Tuple', 6, 8]]])).toBe(
      'list<missing | number>'
    );
    expect(value(['PointY', ['List', RP, ['Tuple', 6, 8]]], -1)).toBe(
      '["Missing",8]'
    );
  });

  test('Distance and Norm keep the numeric marker in the cell', () => {
    expect(type(['Distance', ['List', RP, ['Tuple', 6, 8]], O])).toBe(
      'list<number>'
    );
    expect(type(['Norm', ['List', RP, ['Tuple', 6, 8]]])).toBe('list<number>');
  });
});

describe('A custom operator that sets the flag', () => {
  function engine(threads: boolean): ComputeEngine {
    const ce = new ComputeEngine();
    ce.declare('Midpoint', {
      signature: '(tuple, tuple) -> tuple',
      missingBehavior: 'handle',
      ...(threads ? { threadsConditionals: true } : {}),
      evaluate: ([a, b], { engine: e }) => {
        if (a.symbol === 'Missing' || b.symbol === 'Missing') return e.Missing;
        if (a.operator !== 'Tuple' || b.operator !== 'Tuple') return undefined;
        return e.function(
          'Tuple',
          a.ops!.map((x, i) => x.add(b.ops![i]).div(2))
        );
      },
    } as never);
    return ce;
  }
  const json = ['Midpoint', W(['Tuple', 0, 0]), ['Tuple', 2, 4]];

  test('the restriction moves out of the application', () => {
    const ce = engine(true);
    const e = ce.box(json as never);
    expect(e.evaluate().toString()).toBe('(1, 2) {0 < t}');
    expect(e.type.toString()).toBe('missing | tuple');
    ce.assign('t', 2);
    expect(e.evaluate().toString()).toBe('(1, 2)');
    ce.assign('t', -1);
    expect(e.evaluate().json).toBe('Missing');
  });

  test('without the flag, the handler receives the restriction', () => {
    const e = engine(false).box(json as never);
    expect(e.evaluate().toString()).toBe('Midpoint((0, 0) {0 < t}, (2, 4))');
  });
});

describe('Compiled Distance and Norm of a restricted operand', () => {
  const ce = new ComputeEngine();
  function run(json: unknown, t: number): unknown {
    const r = compile(ce.box(json as never), { to: 'javascript' } as never);
    expect(r.success).toBe(true);
    return r.run!({ t } as never);
  }

  test('Distance of a restricted point', () => {
    expect(run(['Distance', RP, O], 2)).toBe(5);
    expect(run(['Distance', RP, O], -1)).toBeNaN();
  });

  test('Distance of a restricted list of points', () => {
    expect(run(['Distance', RL, O], 2)).toEqual([5, 10]);
    // `undefined` is the run-time spelling of `Missing`.
    expect(run(['Distance', RL, O], -1)).toBeUndefined();
  });

  test('Distance of a list that holds an absent point', () => {
    const r = run(['Distance', ['List', RP, ['Tuple', 6, 8]], O], -1);
    expect((r as number[])[0]).toBeNaN();
    expect((r as number[])[1]).toBe(10);
  });

  test('Norm of a restricted list of points is one norm per point', () => {
    // Read as a matrix, it compiled to the Frobenius norm 11.18.
    expect(run(['Norm', RL], 2)).toEqual([5, 10]);
    expect(run(['Norm', RL], -1)).toBeUndefined();
    const r = run(['Norm', ['List', RP, ['Tuple', 6, 8]]], -1) as number[];
    expect(r[0]).toBeNaN();
    expect(r[1]).toBe(10);
  });

  test('PointX of the absent point is NaN, not a TypeError', () => {
    expect(run(['PointX', 'Missing'], 2)).toBeNaN();
  });

  test.each([RL, ['List', RP, ['Tuple', 6, 8]]])(
    'Norm of the list of points %j fails closed on Python',
    (operand) => {
      const r = compile(ce.box(['Norm', operand] as never), {
        to: 'python',
      } as never);
      expect(r.success).toBe(false);
    }
  );
});

describe('A threaded operand whose present result type is unknown', () => {
  // The absent case of a `handle` operator is added to the result type.
  // When the present result is `unknown`, the result must stay `unknown`:
  // `missing` alone would claim the application is always absent.
  test('At of a possibly absent collection of unknown elements is unknown', () => {
    const ce = new ComputeEngine();
    ce.declare('r', 'dictionary<any> | indexed_collection<any> | missing');
    expect(ce.box(['At', 'r', 2]).type.toString()).toBe('unknown');
  });

  test('a chained access still infers number elements', () => {
    const ce = new ComputeEngine();
    ce.box(['Add', ['At', ['At', 'm', 1], 2], 1]);
    expect(ce.box('m').type.toString()).toBe(
      'indexed_collection<indexed_collection<number>>'
    );
  });
});

describe('Distance of two lists of points with a restricted cell on one side', () => {
  // The pair at position `i` is the two points at `i`. A restricted cell on
  // one side is paired with the point at the same position on the other
  // side, not with the whole other list.
  const P = (a: number, b: number) => ['Tuple', a, b];
  const restricted = ['When', P(0, 0), ['Less', 0, 't']];

  test('the restricted cell is on the right', () => {
    const ce = new ComputeEngine();
    const e = ce.box([
      'Distance',
      ['List', P(3, 4), P(6, 8)],
      ['List', restricted, P(0, 0)],
    ]);
    expect(e.evaluate().toString()).toBe('[5 {0 < t},10]');
    ce.assign('t', 1);
    expect(e.evaluate().toString()).toBe('[5,10]');
  });

  test('the restricted cell is on the left', () => {
    const ce = new ComputeEngine();
    const e = ce.box([
      'Distance',
      ['List', ['When', P(3, 4), ['Less', 0, 't']], P(6, 8)],
      ['List', P(0, 0), P(0, 0)],
    ]);
    expect(e.evaluate().toString()).toBe('[5 {0 < t},10]');
    ce.assign('t', -1);
    expect(e.evaluate().toString()).toBe('[NaN,10]');
  });
});
