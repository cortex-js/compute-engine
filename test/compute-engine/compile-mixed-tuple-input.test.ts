import { ComputeEngine, compile } from '../../src/compute-engine';
import type { MathJsonExpression } from '../../src/math-json/types';

// An input that is a tuple whose parts are strings and numbers
// (`tuple<string, integer>`, #640) is read part by part on JavaScript: `At`
// of a constant index reads one part. Each compiled result must equal
// `evaluate()`; every other read of the tuple declines.

const ce = new ComputeEngine();
ce.declare('T', 'tuple<string, integer>');
ce.declare('U', 'tuple<string, real, boolean>');
ce.declare('W', 'tuple<string, string>');
ce.declare('n', 'integer');

const literal = (x: unknown): MathJsonExpression =>
  typeof x === 'string'
    ? `'${x}'`
    : typeof x === 'boolean'
      ? x
        ? 'True'
        : 'False'
      : (x as number);

/** The compiled result and the interpreter's at `scope`, where an array is
 *  a tuple. */
function both(expr: MathJsonExpression, scope: Record<string, unknown>) {
  const box = ce.box(expr);
  const c = compile(box, { fallback: false }) as any;
  expect(c.success).toBe(true);
  const subs = Object.fromEntries(
    Object.entries(scope).map(([k, v]) => [
      k,
      ce.box(Array.isArray(v) ? ['Tuple', ...v.map(literal)] : literal(v)),
    ])
  );
  const r = box.subs(subs).evaluate();
  const expected =
    r.symbol === 'True'
      ? true
      : r.symbol === 'False'
        ? false
        : r.string !== undefined
          ? r.string
          : r.re;
  return { compiled: c.run(scope), expected };
}

const cartan: MathJsonExpression = [
  'Which',
  ['Equal', ['At', 'T', 1], "'A'"],
  ['Multiply', ['At', 'T', 2], ['Add', ['At', 'T', 2], 1]],
  ['Equal', ['At', 'T', 1], "'B'"],
  ['Multiply', 2, ['Power', ['At', 'T', 2], 2]],
  'True',
  0,
];

describe('a tuple input of strings and numbers', () => {
  it.each([
    ['a part in arithmetic', ['Multiply', ['At', 'T', 2], 2], { T: ['A', 3] }],
    ['a branch on the letter', cartan, { T: ['A', 3] }],
    ['the other letter', cartan, { T: ['B', 4] }],
    ['no letter', cartan, { T: ['G', 2] }],
    [
      'a part from the end',
      ['Add', ['At', 'T', -1], 'n'],
      { T: ['A', 3], n: 2 },
    ],
    ['a string part as the result', ['At', 'T', 1], { T: ['E', 8] }],
    [
      'a Boolean part',
      ['If', ['At', 'U', 3], ['At', 'U', 2], 0],
      { U: ['x', 1.5, true] },
    ],
    [
      'a false Boolean part',
      ['If', ['At', 'U', 3], ['At', 'U', 2], 0],
      { U: ['x', 1.5, false] },
    ],
    [
      'two string parts',
      ['If', ['Equal', ['At', 'W', 1], ['At', 'W', 2]], 1, 0],
      { W: ['a', 'a'] },
    ],
    [
      'two different string parts',
      ['If', ['Equal', ['At', 'W', 1], ['At', 'W', 2]], 1, 0],
      { W: ['a', 'b'] },
    ],
    // `First`, `Second` and `Last` are `At` of the index 1, 2 and -1.
    ['the first part', ['First', 'T'], { T: ['E', 8] }],
    ['the last part', ['Multiply', ['Last', 'T'], 2], { T: ['E', 8] }],
    ['the second part', ['Second', 'U'], { U: ['x', 1.5, true] }],
    [
      'the first and the last part',
      ['If', ['Equal', ['First', 'T'], "'A'"], ['Last', 'T'], 0],
      { T: ['A', 3] },
    ],
  ] as [string, MathJsonExpression, Record<string, unknown>][])(
    '%s agrees with evaluate()',
    (_, expr, scope) => {
      const { compiled, expected } = both(expr, scope);
      expect(compiled).toEqual(expected);
    }
  );

  it('the guide example', () => {
    const f = compile(
      ce.box([
        'If',
        ['Equal', ['At', 'T', 1], "'A'"],
        ['Multiply', 2, ['At', 'T', 2]],
        ['Add', ['At', 'T', 2], 1],
      ])
    ) as any;
    expect(f.run({ T: ['A', 3] })).toBe(6);
    expect(f.run({ T: ['B', 3] })).toBe(4);
  });

  it('reads each part at its index, and refuses a string', () => {
    const c = compile(ce.box(cartan), { fallback: false }) as any;
    expect(c.code).toContain('_SYS.ct(_.T[0])');
    expect(c.code).toContain('_.T[1]');
    expect(c.freeSymbolTypes.T.lowered).toBe('point');
    expect(() => c.run({ T: 'A3' })).toThrow(/JavaScript array/);
  });
});

// A `Tuple` literal whose parts have different shapes (a number and a list
// of a run-time length) read at a constant index is the part at that index.
describe('a part of a tuple literal of a number and a list', () => {
  const ce2 = new ComputeEngine();
  ce2.declare('P', 'list<integer>');
  ce2.declare('n', 'integer');
  const pair: MathJsonExpression = ['Tuple', 3, 'P'];

  it.each([
    ['At 1', ['At', pair, 1], 3],
    ['At -2', ['At', pair, -2], 3],
    ['First', ['First', pair], 3],
    ['the length of At 2', ['Length', ['At', pair, 2]], 3],
    ['the sum of Last', ['Sum', ['Last', pair]], 12],
  ] as [string, MathJsonExpression, number][])(
    '%s agrees with evaluate()',
    (_, expr, value) => {
      const box = ce2.box(expr);
      const c = compile(box, { fallback: false }) as any;
      expect(c.run({ P: [1, 4, 7] })).toBe(value);
      const r = box.subs({ P: ce2.box(['List', 1, 4, 7]) }).evaluate();
      expect(r.re).toBe(value);
    }
  );

  it.each([
    ['at a run-time index', ['At', pair, 'n']],
    ['out of range', ['At', pair, 3]],
  ] as [string, MathJsonExpression][])('declines %s', (_, expr) =>
    // A record is read at a constant index in range (its list field has a
    // carried length).
    expect(() => compile(ce2.box(expr), { fallback: false })).toThrow(
      /At of a record at an index that is not a constant in range/
    )
  );
});

describe('what declines', () => {
  const declines = (
    expr: MathJsonExpression,
    options: object = {},
    why: RegExp = /./
  ) =>
    expect(() =>
      compile(ce.box(expr), { fallback: false, ...options } as any)
    ).toThrow(why);

  it.each([
    ['the whole tuple', 'T'],
    ['the length', ['Length', 'T']],
    ['a part at a run-time index', ['At', 'T', 'n']],
    ['a part out of range', ['At', 'T', 3]],
    ['a third part of a pair', ['Third', 'T']],
    ['a part, then the whole tuple', ['Block', ['At', 'T', 2], 'T']],
  ] as [string, MathJsonExpression][])('%s', (_, expr) =>
    declines(expr, {}, /a tuple whose parts have different lanes/)
  );

  it.each([{ to: 'glsl' }, { to: 'interval-js' }, { mode: 'bigint' }])(
    'on %o',
    (options) =>
      declines(
        ['Multiply', ['At', 'T', 2], 2],
        options,
        /the input T of type tuple<string, integer>/
      )
  );

  it('a user function that reads it or takes it', () => {
    const ce2 = new ComputeEngine();
    ce2.declare('T', 'tuple<string, integer>');
    ce2.declare('g', '(integer) -> integer');
    ce2
      .box([
        'Assign',
        'g',
        ['Function', ['Multiply', ['At', 'T', 2], 'k'], 'k'],
      ])
      .evaluate();
    ce2.declare('h', '(tuple<string, integer>) -> integer');
    ce2
      .box(['Assign', 'h', ['Function', ['Multiply', ['At', 'p', 2], 2], 'p']])
      .evaluate();
    for (const expr of [
      ['g', 3],
      ['h', 'T'],
    ] as MathJsonExpression[])
      expect(() => compile(ce2.box(expr), { fallback: false })).toThrow();
  });

  // A list of `any` is an input typed `any` at its elements: refused by
  // rule, as before.
  it('list<any> stays refused', () => {
    const ce2 = new ComputeEngine();
    ce2.declare('L', 'list<any>');
    expect(() =>
      compile(ce2.box(['At', 'L', 1]), { fallback: false })
    ).toThrow();
  });
});
