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
  // No constant folding: an input-free case must run the lowering.
  const c = compile(box, { fallback: false, constantFold: false }) as any;
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

describe('an accumulator read inside a typed let', () => {
  const letZ = (body: MathJsonExpression): MathJsonExpression => [
    'Apply',
    ['Function', body, ['Typed', 'z', "'integer'"]],
    ['At', 'acc', 1],
  ];
  const join: MathJsonExpression = [
    'Join',
    ['List', ['At', 'acc', 1], ['At', 'acc', 2]],
    ['Drop', 'acc', 2],
    ['List', 0],
  ];
  const three = (step: MathJsonExpression, seed: MathJsonExpression) =>
    [
      'Fold',
      ['Function', step, 'acc', 'k'],
      seed,
      ['Range', 1, 3, 1],
    ] as MathJsonExpression;
  const run = (expr: MathJsonExpression) =>
    Array.from(
      (
        compile(ce.box(expr), { fallback: false, constantFold: false }) as any
      ).run({}) as number[]
    );

  // The interpreter leaves `Drop` of a fold held, so the plain `Join` is the
  // reference: the hand-computed value is `[1, 2, 3, 4, 0, 0, 0]` less two.
  it('Join of a slice of the accumulator, as without the let', () => {
    const drop = (step: MathJsonExpression) =>
      ['Drop', three(step, ['List', 1, 2, 3, 4]), 2] as MathJsonExpression;
    expect(run(drop(join))).toEqual([3, 4, 0, 0, 0]);
    expect(run(drop(letZ(join)))).toEqual([3, 4, 0, 0, 0]);
    expect(
      run(drop(letZ(['If', ['Less', ['At', 'acc', 1], 'z'], join, join])))
    ).toEqual([3, 4, 0, 0, 0]);
  });

  it('Join of the accumulator grows a list, and agrees with evaluate()', () => {
    const expr = three(letZ(['Join', 'acc', ['List', 'k']]), ['List', 0]);
    const { compiled, expected } = both(expr, {});
    expect(Array.from(compiled as number[])).toEqual(expected);
    expect(expected).toEqual([0, 1, 2, 3]);
  });

  it('a tuple that grows through Join still declines', () => {
    for (const step of [join, letZ(join), letZ(['Join', 'acc', ['List', 'k']])])
      expect(() =>
        compile(ce.box(three(step, ['Tuple', 1, 2, 3, 4])), {
          fallback: false,
        })
      ).toThrow();
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

  // CE-1740: a list of a run-time length, carried with its length.
  it.each([
    // The interpreter leaves `Drop` of a fold held, so the fold is bare.
    ['Join', fold(['Join', 'acc', ['List', 'k']], ['List', 0])],
    [
      'Append from List()',
      fold(['Append', 'acc', ['Power', 'k', 20]], ['List']),
    ],
    ['a prefix', fold(['Join', ['List', 'k'], 'acc'], ['List', 7])],
    ['Booleans', fold(['Append', 'acc', ['Less', 'k', 3]], ['List'])],
    [
      'a condition',
      fold(
        ['If', ['Equal', ['Mod', 'k', 2], 0], ['Append', 'acc', 'k'], 'acc'],
        ['List']
      ),
    ],
    [
      'Last of a factorial list',
      [
        'Last',
        fold(
          ['Append', 'acc', ['Multiply', 'k', ['Last', 'acc']]],
          ['List', 1]
        ),
      ],
    ],
  ] as [string, MathJsonExpression][])(
    'a list of a run-time length: %s agrees with evaluate()',
    (_, expr) => {
      const box = ce.box(expr);
      const c = compile(box, { mode: 'bigint', fallback: false } as any) as any;
      expect(c.success).toBe(true);
      const big = (x: any): unknown =>
        x.symbol === 'True'
          ? true
          : x.symbol === 'False'
            ? false
            : exact(x.toString());
      // An exact integer prints as its digits, or as digits then `e+k`.
      const exact = (s: string): bigint => {
        const [m, k] = s.split('e+');
        return BigInt(m) * 10n ** BigInt(k ?? 0);
      };
      for (const n of [-2, 0, 1, 5, 30]) {
        const r = box.subs({ n } as any).evaluate();
        const expected = r.ops ? r.ops.map(big) : big(r);
        const run = c.run({ n: BigInt(n) });
        expect(Array.isArray(run) ? Array.from(run) : run).toEqual(expected);
      }
    }
  );
});

describe('what still declines', () => {
  it('a tuple whose length changes', () => {
    expect(() =>
      compile(ce.box(fold(['Tuple', 'k', 'k', 'k'], ['Tuple', 0, 1])), {
        fallback: false,
      })
    ).toThrow(/changes the length of a tuple/);
  });

  it('a list of a run-time length on GLSL', () => {
    const expr = ce.box(fold(['Append', 'acc', 'k'], ['List']));
    expect(() => compile(expr, { to: 'glsl', fallback: false })).toThrow(
      /run-time length/
    );
  });

  // The interpreter's `Join` keeps a tuple as one element
  // (`Join(Tuple(1, 2), List(3))` is `[(1, 2), 3]`), so a tuple accumulator
  // is not a list operand of `Join`.
  it('Join of a tuple accumulator', () => {
    const step: MathJsonExpression = [
      'Tuple',
      ['Length', ['Join', 'acc', ['List', 'k']]],
      ['At', 'acc', 2],
    ];
    expect(() =>
      compile(ce.box(fold(step, ['Tuple', 0, 1])), { fallback: false })
    ).toThrow(/Join of other than lists/);
  });

  it('Join of an input typed indexed_collection<integer>', () => {
    const ce2 = new ComputeEngine();
    ce2.declare('X', 'indexed_collection<integer>');
    expect(() =>
      compile(ce2.box(['Join', 'X', ['List', 1]]), { fallback: false })
    ).toThrow(/Join of other than lists/);
  });
});

// With no initial value the first element seeds the accumulator
// (`Reduce(L, f)`), so its kind is the element's.
describe('an accumulator seeded from the first element', () => {
  const ce3 = new ComputeEngine();
  ce3.declare('B', 'list<boolean>');
  ce3.declare('T', 'list<tuple<real, real>>');
  ce3.declare('M', 'list<list<real>>');
  const f = (body: MathJsonExpression): MathJsonExpression => [
    'Function',
    body,
    'a',
    'x',
  ];
  const expected = (expr: MathJsonExpression, name: string, v: unknown) =>
    ce3
      .box(expr)
      .subs({ [name]: ce3.box(v as MathJsonExpression) })
      .evaluate();

  it('a Boolean accumulator agrees with evaluate()', () => {
    const expr: MathJsonExpression = ['Reduce', 'B', f(['And', 'a', 'x'])];
    const c = compile(ce3.box(expr), { fallback: false }) as any;
    for (const B of [[true], [true, true], [true, false, true]]) {
      const r = expected(expr, 'B', [
        'List',
        ...B.map((x) => (x ? 'True' : 'False')),
      ]);
      expect(c.run({ B })).toBe(r.symbol === 'True');
    }
  });

  it('a tuple accumulator agrees with evaluate()', () => {
    const expr: MathJsonExpression = [
      'Reduce',
      'T',
      f([
        'Tuple',
        ['Add', ['At', 'a', 1], ['At', 'x', 1]],
        ['Max', ['At', 'a', 2], ['At', 'x', 2]],
      ]),
    ];
    const c = compile(ce3.box(expr), { fallback: false }) as any;
    for (const T of [
      [[1, 5]],
      [
        [1, 2],
        [3, 7],
        [-2, 4],
      ],
    ]) {
      const r = expected(expr, 'T', ['List', ...T.map((p) => ['Tuple', ...p])]);
      expect(Array.from(c.run({ T }))).toEqual(r.ops!.map((x) => x.re));
    }
    expect(() => c.run({ T: [] })).toThrow(/out-of-range/);
  });

  // The rows of `M: list<list<real>>` are read one by one (#638): the
  // first row seeds a list accumulator of a run-time length. Rows of two
  // lengths under `Add` give an unspecified value (the interpreter gives an
  // error), as two lists of run-time lengths that differ do.
  it('a row accumulator agrees with evaluate()', () => {
    const expr: MathJsonExpression = ['Reduce', 'M', f(['Add', 'a', 'x'])];
    const c = compile(ce3.box(expr), { fallback: false }) as any;
    for (const M of [
      [
        [1, -2],
        [3, 4],
      ],
      [[1, 2, 3]],
    ]) {
      const r = expected(expr, 'M', [
        'List',
        ...M.map((row) => ['List', ...row]),
      ]);
      expect(Array.from(c.run({ M }))).toEqual(r.ops!.map((x) => x.re));
    }
  });
});
