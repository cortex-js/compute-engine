/**
 * A `Range` of constants read as a list value is the literal list of the
 * engine's elements, in the profile `ir` (batch G25; README of
 * `src/compute-engine/compilation/ir/`, the paragraph after the one on
 * `closedValue()`). A `Range` that a consumer iterates keeps its counted
 * loop, with no list.
 *
 * JavaScript agrees with the interpreter within 1e-12; the shape of the code
 * is read in its text.
 */

import { compile } from '../../src/compile';
import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine/global-types';
import {
  isFunction,
  isNumber,
} from '../../src/compute-engine/boxed-expression/type-guards';

type Json = unknown;
type Point = Record<string, number>;

const ce = new ComputeEngine();
ce.precision = 'machine';
ce.declare('x', 'real');
ce.declare('m', 'integer');
ce.assign('N', 5);
ce.declare('K', { type: 'integer', value: ce.number(5) });
ce.assign('h', ce.box(['Function', ['Multiply', 'u', ['Range', 1, 'u']], 'u']));
// A function with a draw, called in a bound.
// prettier-ignore
ce.assign('dr', ce.box(['Function', ['Add', 't', ['Floor', ['Multiply', 10, ['Random']]]], 't']));

const IR = { profile: 'ir', fallback: false } as const;
const box = (json: Json): Expression => ce.box(json as never);
const js = (json: Json, options: object = {}) =>
  compile(box(json), { ...IR, ...options });

/** The interpreter's value: a list is an array. */
function read(e: Expression): unknown {
  if (isNumber(e)) return e.re;
  if (isFunction(e) && e.isCollection && e.isFiniteCollection) {
    const l = isFunction(e, 'List')
      ? e
      : ce.function('ListFrom', [e]).evaluate();
    return (l as Expression & { ops: Expression[] }).ops.map((x) =>
      read(x.N())
    );
  }
  throw new Error(`no value: ${e.toString()}`);
}

function interpreted(json: Json, point: Point): unknown {
  const values = Object.fromEntries(
    Object.entries(point).map(([k, v]) => [k, ce.number(v)])
  );
  return ce.withValues(values as never, () => read(box(json).evaluate().N()));
}

const agree = (a: unknown, b: unknown): boolean =>
  Array.isArray(a)
    ? Array.isArray(b) &&
      a.length === b.length &&
      a.every((x, k) => agree(x, b[k]))
    : typeof a === 'number' &&
      typeof b === 'number' &&
      Math.abs(a - b) <= 1e-12 * Math.max(1, Math.abs(b));

function check(json: Json, points: Point[] = [{ x: 0.3, m: 4 }], options = {}) {
  const r = js(json, options);
  for (const p of points) {
    const got = r.run!(p as never);
    if (!agree(got, interpreted(json, p)))
      throw new Error(
        `${JSON.stringify(json)} at ${JSON.stringify(p)}: ${JSON.stringify(got)} vs ${JSON.stringify(interpreted(json, p))}`
      );
  }
  return r;
}

/** The code of the program and the code it computes once. */
const text = (r: ReturnType<typeof js>) => `${r.preambleOnce ?? ''}\n${r.code}`;

describe('IR profile, batch G25: a Range of constants as a list value', () => {
  // A list of at most 16 elements is written out ("Lists", the short
  // lists): the product of each element is in the text (`x * 1` is `x`).
  const three = '[_.x, (_.x * 2), (_.x * 3)]';
  test.each([
    ['one operand', ['Multiply', 'x', ['Range', 3]], three],
    ['two operands', ['Multiply', 'x', ['Range', 1, 3]], three],
    ['three operands', ['Multiply', 'x', ['Range', 1, 3, 1]], three],
    [
      'descending',
      ['Multiply', 'x', ['Range', 5, 1]],
      '[(_.x * 5), (_.x * 4), (_.x * 3), (_.x * 2), _.x]',
    ],
    [
      'a negative step',
      ['Multiply', 'x', ['Range', 1, 0, ['Divide', -1, 4]]],
      '[1, 0.75, 0.5, 0.25, 0]',
    ],
    [
      'a real step: the engine’s count and doubles',
      ['Multiply', 'x', ['Range', 0, 1, 0.1]],
      '0.30000000000000004',
    ],
    [
      'a step whose count depends on rounding',
      ['Multiply', 'x', ['Range', 0, 0.3, 0.1]],
      '[0, 0.1, 0.2, 0.30000000000000004]',
    ],
    [
      'a bound that is a name with a value',
      ['Multiply', 'x', ['Range', 1, 'N']],
      '(_.x * 4), (_.x * 5)]',
    ],
    ['the result of the program', ['Range', 2, 4], '[2, 3, 4]'],
  ] as [string, Json, string][])('%s is a literal list', (_, json, literal) => {
    const r = check(json);
    expect(text(r)).toContain(literal);
    expect(text(r)).not.toMatch(/rangeCount|v\d+_n = /);
  });

  test('integers stay on the integer lane, reals on the real lane', () => {
    expect(js(['Range', 1, 3]).code).toContain('[1, 2, 3]');
    expect(js(['Range', 0.5, 2.5]).code).toContain('[0.5, 1.5, 2.5]');
    check(['Range', 0.5, 2.5]);
  });

  test('a name with a value is captured', () => {
    const deps = new Set<string>();
    js(['Multiply', 'x', ['Range', 1, 'N']], { symbolDeps: deps });
    expect([...deps]).toContain('N');
  });

  test('16 elements or more: computed once', () => {
    const r = check(['Multiply', 'x', ['Range', 1, 20]]);
    expect(r.preambleOnce).toMatch(/= \[1, 2, 3, .*, 20\];/);
  });

  test('the colour programs of the corpus', () => {
    // `art/njncrg9fkv` #1: the list of the Range is a constant, of 10
    // elements: each colour is computed once.
    const r = js([
      'Hsv',
      210,
      ['Multiply', ['Rational', 1, 40], ['Range', 1, 10]],
      1,
    ]);
    expect(r.preambleOnce?.match(/_SYS\.hsv\(/g)).toHaveLength(10);
    expect(r.preambleOnce).toContain('_SYS.hsv(210, 0.25, 1)');
    expect(r.code).not.toMatch(/_SYS\.hsv/);
  });
});

describe('IR profile, batch G25: a Range that is not closed, or not a list value, keeps its code', () => {
  /** No literal list of the elements: the count and the arithmetic. */
  const counted = (json: Json, options = {}, points?: Point[]) => {
    const r = check(json, points, options);
    expect(text(r)).not.toMatch(/\[1, 2, 3/);
    return r;
  };

  test('a bound that is an input, a name of vars or of symbolic', () => {
    counted(['Multiply', 'x', ['Range', 1, 'm']]);
    expect(
      text(js(['Multiply', 'x', ['Range', 1, 'K']], { symbolic: ['K'] }))
    ).not.toContain('[1, 2, 3, 4, 5]');
    expect(
      text(js(['Multiply', 'x', ['Range', 1, 'K']], { vars: { K: 'K' } }))
    ).not.toContain('[1, 2, 3, 4, 5]');
  });

  test('a parameter of a user function, an index of a Sum, a draw', () => {
    counted(['h', 'm']);
    counted([
      'Sum',
      ['Sum', ['Multiply', 'x', ['Range', 1, 'k']]],
      ['Limits', 'k', 1, 3],
    ]);
    const draw = [
      'WithRandomSeed',
      3,
      ['Multiply', 'x', ['Range', 1, ['Floor', ['Multiply', 10, ['Random']]]]],
    ];
    expect(text(js(draw))).not.toMatch(/\[1, 2, 3/);
    // The existing compiler's value (the interpreter draws when the Range is
    // made: CE-1328).
    expect(js(draw).run!({ x: 0.3 } as never)).toEqual(
      compile(box(draw), { fallback: false }).run!({ x: 0.3 } as never)
    );
  });

  test('a consumer that iterates the Range: Length, Sum, Max, Map, Comprehension, Loop', () => {
    expect(js(['Length', ['Range', 1, 1e6]]).code).not.toMatch(/\[1, 2/);
    for (const json of [
      ['Sum', ['Range', 1, 100]],
      ['Max', ['Range', 1, 100]],
      ['Product', ['Range', 1, 10]],
      [
        'Sum',
        ['Map', ['Function', ['Multiply', 'x', 'k'], 'k'], ['Range', 1, 100]],
      ],
      [
        'Sum',
        [
          'Comprehension',
          ['Multiply', 'x', 'k'],
          ['Element', 'k', ['Range', 1, 100]],
        ],
      ],
      // prettier-ignore
      ['Block', ['Declare', 's', { str: 'real' }, 0], ['Loop', ['Assign', 's', ['Add', 's', ['Multiply', 'x', 'k']]], ['Element', 'k', ['Range', 1, 100]]], 's'],
    ])
      counted(json);
  });

  test('a Range above the cap, an empty Range, and without the fold', () => {
    const big = js(['Multiply', 'x', ['Range', 1, 5000]]);
    expect(text(big)).not.toContain('[1, 2, 3');
    expect(big.run!({ x: 1 } as never)).toHaveLength(5000);
    for (const json of [
      ['Multiply', 'x', ['Range', 0, 1, -1]],
      ['Multiply', 'x', ['Range', 1, 5, 0]],
    ])
      check(json);
    counted(['Multiply', 'x', ['Range', 1, 3]], { constantFold: false });
  });
});

describe('IR profile, batch G25: GLSL and the interval mode', () => {
  test('a constant array on GLSL', () => {
    const r = compile(box(['At', ['Multiply', 'x', ['Range', 0, 1, 0.1]], 4]), {
      ...IR,
      to: 'glsl',
    });
    expect(r.success).toBe(true);
  });

  test('neyret/rwhqbsp4wq: a Range of a real step in the interval mode', () => {
    ce.assign(
      'P',
      ce.box([
        'Function',
        ['Multiply', 'a', ['Exp', ['Negate', 'b']]],
        'a',
        'b',
      ])
    );
    // prettier-ignore
    const json = ['Multiply', ['P', ['Multiply', 0.1, 'x'], ['Multiply', 6000, ['Range', 0, 1, 0.1]]], ['Power', 10, -12]];
    expect(compile(box(json), { ...IR, to: 'interval-js' }).success).toBe(true);
  });
});

// The values, the draws and the warnings of these programs on the tree with
// G24 only (the batch before this one).
const R = ['Random'];
const FLOOR10 = ['Floor', ['Multiply', 10, R]];

describe('IR profile, batch G25: an operand of a Range is lowered once', () => {
  /** The number of `needle` in the code of `r`. */
  const count = (r: ReturnType<typeof js>, needle: string) =>
    text(r).split(needle).length - 1;
  const codes = (r: ReturnType<typeof js>) =>
    (r.warnings ?? []).map((w) => w.code);

  test('a draw in a bound: its draws and warnings are those of G24', () => {
    // prettier-ignore
    const w1 = js(['WithRandomSeed', 3, ['List', ['At', ['Range', 1, ['Add', 3, FLOOR10]], 2], R]]);
    expect(w1.run!({} as never)).toEqual([2, 0.36381368962238325]);
    expect(count(w1, 'drawNextRandomNumber')).toBe(2);
    expect(codes(w1)).toEqual(['seeded-draw-order']);
    // prettier-ignore
    const w2 = js(['WithRandomSeed', 3, ['Multiply', 'x', ['Range', 1, FLOOR10]]]);
    expect(w2.run!({ x: 1 } as never)).toEqual([1, 2, 3, 4]);
    expect(count(w2, 'drawNextRandomNumber')).toBe(1);
    expect(codes(w2)).toEqual([]);
  });

  test('a user function with a draw in a bound is called once', () => {
    const r = js([
      'WithRandomSeed',
      3,
      ['Multiply', 'x', ['Range', 1, ['dr', 2]]],
    ]);
    expect(r.run!({ x: 1 } as never)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(count(r, '_dr(')).toBe(1);
    expect(codes(r)).toEqual(['seeded-draw-order']);
  });

  test('a write in a bound runs once', () => {
    // prettier-ignore
    const json = ['Block', ['Declare', 'c', { str: 'unknown' }, 0], ['Declare', 'r', { str: 'unknown' }, ['Add', 'x', ['Range', 1, ['Block', ['Assign', 'c', ['Add', 'c', 1]], 3]]]], 'c'];
    expect(js(json).run!({ x: 1 } as never)).toBe(1);
  });
});

describe('IR profile, batch G25: the bigint mode computes no operation once', () => {
  // prettier-ignore
  test.each([
    ['Mod of two lists', ['Mod', ['List', 5, 7], ['List', 0, 2]], NaN],
    ['Mod of a list by 0', ['Mod', ['List', 5, 7], 0], NaN],
    ['Factorial of a list', ['Factorial', ['List', -1, 3]], Infinity],
    ['inside Add', ['Add', 'm', ['Mod', ['List', 5, 7], 0]], NaN],
    ['inside Sum', ['Sum', ['Factorial', ['List', -1, 3]]], Infinity],
    ['in a dead If arm', ['If', ['Greater', 'm', 100], ['Sum', ['Mod', ['List', 5, 7], ['List', 0, 2]]], 'm'], BigInt(1)],
  ] as [string, Json, unknown][])('%s: the value of a pole', (_, json, value) => {
    const r = js(json, { mode: 'bigint' });
    expect(r.preambleOnce ?? '').not.toMatch(/_r\[/);
    expect(r.run!({ m: 1 } as never)).toBe(value);
  });
});

describe('IR profile, batch G25: the literal elements of a compilation are capped', () => {
  test('past 4,096 elements in all, a Range keeps its build', () => {
    // prettier-ignore
    const a = ['List', ...Array.from({ length: 13 }, (_, k) => ['Sum', ['Multiply', 'x', ['Range', k + 1, 4096]]])];
    const ra = js(a);
    expect(ra.run!({ x: 0.5 } as never)).toEqual(
      Array.from(
        { length: 13 },
        (_, k) => (0.5 * (4096 + k + 1) * (4096 - k)) / 2
      )
    );
    // The first Range is a literal list; the others are builds.
    expect(text(ra).match(/\[1, 2, 3, /g)).toHaveLength(1);
    // prettier-ignore
    const b = ['Add', ...Array.from({ length: 60 }, (_, k) => ['Sum', ['Multiply', 'x', ['Range', k + 1, 1000]]])];
    expect(js(b).run!({ x: 0.5 } as never)).toBe(14997005);
  });
});
