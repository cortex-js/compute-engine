import { ComputeEngine, compile } from '../../src/compute-engine';
import type { MathJsonExpression } from '../../src/math-json/types';

// `Reduce` and `Fold` by a function literal whose accumulator is a list, a
// tuple or a Boolean: a loop whose carried value is that accumulator
// (`lower-lists.ts`, `reduceBy()`). Each compiled result must equal
// `evaluate()`.

const ce = new ComputeEngine();
ce.declare('n', 'integer');
ce.declare('P', 'list<real>');
ce.declare('Q', 'list<integer>');

const fold = (
  body: MathJsonExpression,
  init: MathJsonExpression,
  range: MathJsonExpression = ['Range', 1, 'n']
): MathJsonExpression => [
  'Fold',
  ['Function', body, 'acc', ['Typed', 'k', "'integer'"]],
  init,
  range,
];

/** The compiled result and the interpreter's, at `scope`, as plain values. */
function both(expr: MathJsonExpression, scope: Record<string, unknown>) {
  const box = ce.box(expr);
  const c = compile(box, { fallback: false }) as any;
  expect(c.success).toBe(true);
  const r = box
    .subs(
      Object.fromEntries(
        Object.entries(scope).map(([k, v]) => [
          k,
          Array.isArray(v) ? ['List', ...v] : v,
        ])
      ) as any
    )
    .evaluate();
  const plain = (x: any): unknown =>
    x.symbol === 'True' ? true : x.symbol === 'False' ? false : x.re;
  const run = c.run(scope);
  return {
    compiled: Array.isArray(run) ? run : run,
    expected: r.ops ? r.ops.map(plain) : plain(r),
  };
}

const fibonacci = fold(
  [
    'Block',
    ['List', ['At', 'acc', 2], ['Add', ['At', 'acc', 1], ['At', 'acc', 2]]],
  ],
  ['List', 0, 1]
);

const cases: [string, MathJsonExpression][] = [
  ['a Fibonacci pair', fibonacci],
  [
    'a tuple',
    fold(
      ['Tuple', ['At', 'acc', 2], ['Add', ['At', 'acc', 1], 'k']],
      ['Tuple', 0, 1]
    ),
  ],
  [
    'a constant array of reals',
    fold(
      [
        'List',
        ['Add', ['At', 'acc', 1], 0.5],
        ['Multiply', ['At', 'acc', 2], 'k'],
        'k',
      ],
      ['List', 0, 1, 2]
    ),
  ],
  [
    'a pair of Booleans',
    fold(
      ['List', ['Not', ['At', 'acc', 1]], ['At', 'acc', 1]],
      ['List', 'True', 'False']
    ),
  ],
];

describe('a list or tuple accumulator of a length fixed at compile time', () => {
  it.each(cases)('%s agrees with evaluate()', (_, expr) => {
    for (const n of [0, 1, 2, 7]) {
      const { compiled, expected } = both(expr, { n });
      expect(Array.from(compiled as unknown[])).toEqual(expected);
    }
  });

  // `Range(1, 0)` counts down in the interpreter, so the empty collection
  // is an empty list input.
  it('an empty collection gives the initial value', () => {
    const expr = fold(
      ['List', ['At', 'acc', 2], ['Add', ['At', 'acc', 1], 'k']],
      ['List', 0, 1],
      'Q'
    );
    expect(both(expr, { Q: [] })).toEqual({
      compiled: [0, 1],
      expected: [0, 1],
    });
    expect(both(expr, { Q: [4, 5] })).toEqual({
      compiled: [4, 6],
      expected: [4, 6],
    });
  });
});

describe('a list accumulator of a run-time length', () => {
  it('a zero array of the length of an input', () => {
    const expr: MathJsonExpression = [
      'Fold',
      ['Function', ['Add', 'acc', 'k'], 'acc', ['Typed', 'k', "'integer'"]],
      ['Map', ['Function', ['Multiply', 0, 'z'], 'z'], ['Range', 1, 'n']],
      ['Range', 1, 3],
    ];
    const { compiled, expected } = both(expr, { n: 4 });
    expect(Array.from(compiled as number[])).toEqual(expected);
  });

  it('appends to List()', () => {
    const expr = fold(['Append', 'acc', ['Multiply', 'k', 'k']], ['List']);
    for (const n of [0, 1, 5]) {
      const { compiled, expected } = both(expr, { n });
      expect(Array.from(compiled as number[])).toEqual(expected);
    }
  });

  it('a fixed-length seed that grows by Join', () => {
    const expr = fold(
      ['Join', 'acc', ['List', ['Add', ['At', 'acc', 1], 'k']]],
      ['List', 1, 2],
      ['Range', 2, 'n']
    );
    for (const n of [3, 6]) {
      const { compiled, expected } = both(expr, { n });
      expect(Array.from(compiled as number[])).toEqual(expected);
    }
  });

  it('an array grown by Join and read at a run-time index', () => {
    const expr = fold(
      [
        'Join',
        'acc',
        [
          'List',
          ['Add', ['At', 'acc', 'k'], ['At', 'acc', ['Subtract', 'k', 1]]],
        ],
      ],
      ['List', 1, 2],
      ['Range', 2, 'n', 1]
    );
    for (const n of [2, 6]) {
      const { compiled, expected } = both(expr, { n });
      expect(Array.from(compiled as number[])).toEqual(expected);
    }
  });

  it('appends conditionally to List()', () => {
    const expr = fold(
      ['If', ['Equal', ['Mod', 'k', 2], 0], ['Append', 'acc', 'k'], 'acc'],
      ['List']
    );
    const { compiled, expected } = both(expr, { n: 9 });
    expect(Array.from(compiled as number[])).toEqual(expected);
  });
});

describe('a Boolean accumulator', () => {
  const reduce = (op: string, cmp: MathJsonExpression, init: string) =>
    [
      'Reduce',
      ['Range', 1, ['Length', 'P']],
      ['Function', ['Block', [op, 'a', cmp]], 'a', ['Typed', 'i', "'integer'"]],
      init,
    ] as MathJsonExpression;
  const all = reduce('And', ['Less', 0, ['At', 'P', 'i']], 'True');
  const some = reduce('Or', ['Less', ['At', 'P', 'i'], 0], 'False');

  it.each([
    ['And', all],
    ['Or', some],
  ])('%s agrees with evaluate()', (_, expr) => {
    for (const P of [[1, 2, 3], [1, -2, 3], [-1]]) {
      const { compiled, expected } = both(expr, { P });
      expect(compiled).toBe(expected);
    }
  });

  it('an empty collection is the initial value', () => {
    const over = (body: MathJsonExpression, init: string) =>
      ['Reduce', 'Q', ['Function', body, 'a', 'q'], init] as MathJsonExpression;
    const and = over(['And', 'a', ['Less', 0, 'q']], 'True');
    const or = over(['Or', 'a', ['Less', 'q', 0]], 'False');
    expect(both(and, { Q: [] })).toEqual({ compiled: true, expected: true });
    expect(both(or, { Q: [] })).toEqual({ compiled: false, expected: false });
  });
});

describe('a list accumulator in the bigint mode', () => {
  it('a Fibonacci pair past 2^53 agrees with evaluate()', () => {
    const c = compile(ce.box(fibonacci), {
      mode: 'bigint',
      fallback: false,
    } as any) as any;
    expect(c.success).toBe(true);
    for (const n of [5, 100]) {
      const expected = ce
        .box(fibonacci)
        .subs({ n } as any)
        .evaluate()
        .ops!.map((x) => BigInt(x.toString()));
      expect(Array.from(c.run({ n: BigInt(n) }) as bigint[])).toEqual(expected);
    }
    expect(c.run({ n: 100n })[0]).toBe(354224848179261915075n);
  });
});

describe('what still declines', () => {
  it('a tuple whose length changes', () => {
    expect(() =>
      compile(ce.box(fold(['Tuple', 'k', 'k', 'k'], ['Tuple', 0, 1])), {
        fallback: false,
      })
    ).toThrow(/changes the length of a tuple/);
  });

  it('a list of a run-time length on GLSL and in the bigint mode', () => {
    const expr = ce.box(fold(['Append', 'acc', 'k'], ['List']));
    for (const o of [{ to: 'glsl' }, { mode: 'bigint' }] as any[])
      expect(() => compile(expr, { ...o, fallback: false })).toThrow(
        /run-time length/
      );
  });

  it('Join of an input typed indexed_collection<integer>', () => {
    const ce2 = new ComputeEngine();
    ce2.declare('X', 'indexed_collection<integer>');
    expect(() =>
      compile(ce2.box(['Join', 'X', ['List', 1]]), { fallback: false })
    ).toThrow(/Join of other than lists/);
  });
});
