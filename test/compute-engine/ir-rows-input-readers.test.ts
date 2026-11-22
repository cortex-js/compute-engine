import { ComputeEngine, compile } from '../../src/compute-engine';
import type { MathJsonExpression } from '../../src/math-json/types';

// An input or a parameter of type `list<list<integer>>` or `list<list<real>>`
// (the lane `rows`, whose rows can have different lengths) is read row by
// row by the readers of a list on JavaScript (#638, `chunks()` of
// `lower-lists.ts`): `Map`, `Length`, `Count`, `IsEmpty`, `Reduce`, `Fold`,
// `IndexWhere`. Each compiled result must equal `evaluate()`. A row is also
// read at an index known at run time, a user function reads a free input
// of the lane, and a part of a tuple input or a typed parameter of `Apply`
// can be of the lane.

const ce = new ComputeEngine();
ce.declare('L', 'list<list<integer>>');
ce.declare('R', 'list<list<real>>');
ce.declare('n', 'integer');
ce.declare('m', 'integer');
ce.declare('c', 'boolean');
ce.declare('fr', '(list<list<integer>>, integer) -> list<integer>');
ce.assign('fr', ce.box(['Function', ['At', 'g', 'k'], 'g', 'k']));
ce.declare('f', '(list<list<integer>>) -> list<integer>');
ce.assign(
  'f',
  ce.box(['Function', ['Map', ['Function', ['Length', 'r'], 'r'], 'g'], 'g'])
);

const row = (body: MathJsonExpression): MathJsonExpression => [
  'Function',
  body,
  'r',
];
const map = (body: MathJsonExpression, l = 'L'): MathJsonExpression => [
  'Map',
  row(body),
  l,
];

const GRAPHS: number[][][] = [[[1, 2], [3], [4, 5, 6]], [], [[], [7]]];

/** The interpreter's value, a number, a Boolean or a list of numbers. */
function expected(
  expr: MathJsonExpression,
  name: string,
  g: number[][],
  n?: number
) {
  const r = ce
    .box(expr)
    .subs({
      [name]: ce.box(['List', ...g.map((x) => ['List', ...x])]),
      ...(n === undefined ? {} : { n }),
    })
    .evaluate();
  if (r.symbol === 'True') return true;
  if (r.symbol === 'False') return false;
  return r.isCollection ? [...(r as any).each()].map((x) => x.re) : r.re;
}

const plain = (x: unknown) =>
  x !== null && typeof x === 'object' ? Array.from(x as number[]) : x;

describe('the rows of a list<list<…>> input, read one by one', () => {
  it.each([
    ['Map of Length', map(['Length', 'r'])],
    ['Map of Reduce by Add', map(['Reduce', 'r', 'Add', 0])],
    [
      'Map of Reduce by a function',
      map([
        'Reduce',
        'r',
        ['Function', ['Add', 'a', ['Multiply', 'b', 'b']], 'a', 'b'],
        0,
      ]),
    ],
    ['Map of Sum', map(['Sum', 'r'])],
    [
      'Map of Count by a predicate',
      map(['Count', 'r', ['Function', ['Greater', 'x', 1], 'x']]),
    ],
    ['Count', ['Count', 'L']],
    ['Length', ['Length', 'L']],
    ['IsEmpty', ['IsEmpty', 'L']],
    ['Sum of a Map', ['Sum', map(['Length', 'r'])]],
    [
      'Fold of the lengths',
      ['Fold', ['Function', ['Add', 'a', ['Length', 'b']], 'a', 'b'], 0, 'L'],
    ],
    ['IndexWhere', ['IndexWhere', 'L', row(['Greater', ['Length', 'r'], 1])]],
    [
      'Map of two lists',
      [
        'Map',
        ['Function', ['Add', ['Length', 'r'], ['Length', 's']], 'r', 's'],
        'L',
        'L',
      ],
    ],
    ['a user function of that parameter type', ['f', 'L']],
  ] as [string, MathJsonExpression][])(
    '%s agrees with evaluate()',
    (_, expr) => {
      const c = compile(ce.box(expr), { fallback: false }) as any;
      for (const L of GRAPHS)
        expect(plain(c.run({ L }))).toEqual(expected(expr, 'L', L));
    }
  );

  it('rows of reals', () => {
    const expr = map(['Sum', 'r'], 'R');
    const c = compile(ce.box(expr), { fallback: false }) as any;
    const R = [[1.5, 2], [3], []];
    expect(plain(c.run({ R }))).toEqual(expected(expr, 'R', R));
  });

  it('a row read past its end is NaN, where the interpreter has no value', () => {
    const expr = map(['At', 'r', 2]);
    const c = compile(ce.box(expr), { fallback: false }) as any;
    expect(plain(c.run({ L: GRAPHS[0] }))).toEqual([2, NaN, 5]);
  });

  it('reads the host rows in place', () => {
    const c = compile(ce.box(map(['Length', 'r'])), { fallback: false });
    expect(c.code).toContain('_.L[');
    expect(c.code).toContain('.length');
  });
});

describe('a row at an index known at run time', () => {
  const at: MathJsonExpression = ['At', 'L', 'n'];
  const boxedL = ce.box(['List', ...GRAPHS[0].map((x) => ['List', ...x])]);
  // In range, the row; out of range (0, 5) the interpreter gives `Missing`:
  // `Length` of the row is NaN, and `At`, `First` and `Last` of an element
  // of it are NaN. A reducer of an absent row is unspecified.
  it.each([
    ['Length', ['Length', at], [2, -1, 0, 5]],
    ['Sum', ['Sum', at], [2, -1]],
    ['Reduce by Add', ['Reduce', at, 'Add', 0], [2, -1]],
    ['First', ['First', at], [2, -1, 0, 5]],
    ['Last', ['Last', at], [2, -1, 0, 5]],
    ['an element', ['At', at, 2], [2, -1, 0, 5]],
    ['Length of Rest', ['Length', ['Rest', at]], [2, -1, 0, 5]],
    ['Length of Reverse', ['Length', ['Reverse', at]], [2, -1, 0, 5]],
    ['IsMissing', ['IsMissing', at], [2, -1, 0, 5]],
    ['IsMissing of Rest', ['IsMissing', ['Rest', at]], [2, -1, 0, 5]],
    ['Coalesce of Length', ['Coalesce', ['Length', at], -7], [2, -1, 0, 5]],
    [
      'Coalesce of two rows',
      ['Length', ['Coalesce', at, ['At', 'L', 1]]],
      [2, -1, 0, 5],
    ],
    [
      'a local that holds it',
      [
        'Block',
        ['Declare', 'r', "'unknown'", at],
        ['Coalesce', ['Length', 'r'], -7],
      ],
      [2, -1, 0, 5],
    ],
  ] as [string, MathJsonExpression, number[]][])(
    '%s agrees with evaluate()',
    (_, expr, indices) => {
      const c = compile(ce.box(expr), { fallback: false }) as any;
      const L = GRAPHS[0];
      for (const n of indices) {
        const got = c.run({ L, n });
        if (ce.box(expr).subs({ L: boxedL, n }).evaluate().symbol === 'Missing')
          expect(got).toBeNaN();
        else expect(plain(got)).toEqual(expected(expr, 'L', L, n));
      }
    }
  );

  it('the size of a tree, a recursive function of the adjacency list', () => {
    const local = new ComputeEngine();
    local.declare('sz', '(list<list<integer>>, integer) -> integer');
    local.assign(
      'sz',
      local.box([
        'Function',
        [
          'Add',
          1,
          [
            'Reduce',
            ['Map', ['Function', ['sz', 'g', 'c'], 'c'], ['At', 'g', 'v']],
            'Add',
            0,
          ],
        ],
        'g',
        'v',
      ])
    );
    local.declare('A', 'list<list<integer>>');
    const c = compile(local.box(['sz', 'A', 1]), { fallback: false }) as any;
    const A = [[2, 3], [4], [], []];
    local.assign('A', local.box(['List', ...A.map((r) => ['List', ...r])]));
    expect(local.box(['sz', 'A', 1]).evaluate().re).toBe(4);
    expect(c.run({ A })).toBe(4);
    expect(c.run({ A: [[2], [3], []] })).toBe(3);
  });

  // A conditional or a `Coalesce` of a row keeps its absent value: the
  // `Length` of the operand taken, NaN where that row is absent.
  const other: MathJsonExpression = ['At', 'L', 'm'];
  const either: MathJsonExpression = ['If', 'c', at, other];
  const IF = [
    { c: true, n: 5, m: 1 },
    { c: false, n: 5, m: 1 },
    { c: true, n: 1, m: 5 },
    { c: false, n: 2, m: 0 },
    { c: true, n: 3, m: 2 },
  ];
  const COALESCE = [
    { n: 5, m: 9 },
    { n: 5, m: 2 },
    { n: 1, m: 9 },
    { n: 0, m: -1 },
  ];
  it.each([
    ['IsMissing of an If of two rows', ['IsMissing', either], IF],
    ['Length of an If of two rows', ['Length', either], IF],
    [
      'Coalesce of Length of an If of two rows',
      ['Coalesce', ['Length', either], -7],
      IF,
    ],
    [
      'Length of an If of a row and a list',
      ['Length', ['If', 'c', at, ['List', 9, 9]]],
      IF,
    ],
    [
      'IsMissing of an If of a row and a list',
      ['IsMissing', ['If', 'c', ['List', 9, 9], at]],
      IF,
    ],
    [
      'IsMissing of a Coalesce of two rows',
      ['IsMissing', ['Coalesce', at, other]],
      COALESCE,
    ],
    [
      'Length of a Coalesce of two rows',
      ['Length', ['Coalesce', at, other]],
      COALESCE,
    ],
    [
      'Length of a Coalesce of a row and a list',
      ['Length', ['Coalesce', at, ['List', 9]]],
      COALESCE,
    ],
    [
      'Coalesce of Length of a Coalesce of two rows, of no row',
      ['Coalesce', ['Length', ['Coalesce', at, ['At', 'L', 1]]], -7],
      [
        { n: 5, L: [] },
        { n: 1, L: [] },
        { n: 5, L: GRAPHS[0] },
        { n: 2, L: GRAPHS[0] },
      ],
    ],
  ] as [string, MathJsonExpression, Record<string, unknown>[]][])(
    '%s agrees with evaluate()',
    (_, expr, inputs) => {
      const compiled = compile(ce.box(expr), { fallback: false }) as any;
      for (const input of inputs) {
        const L = (input.L as number[][] | undefined) ?? GRAPHS[0];
        const args = { m: 1, c: true, ...input, L };
        const value = ce
          .box(expr)
          .subs({
            L: ce.box(['List', ...L.map((x) => ['List', ...x])]),
            n: args.n as number,
            m: args.m,
            c: args.c ? ce.True : ce.False,
          })
          .evaluate();
        const got = compiled.run(args);
        if (value.symbol === 'Missing') expect(got).toBeNaN();
        else if (value.symbol === 'True' || value.symbol === 'False')
          expect(got).toBe(value.symbol === 'True');
        else expect(got).toBe(value.re);
      }
    }
  );

  it.each([
    [
      'the row as the result',
      at,
      'a row at an index known at run time as the result',
    ],
    ['the row in a Tuple as the result', ['Tuple', at, 1], 'as the result'],
    [
      'AssertPresent of the row',
      ['Length', ['AssertPresent', at]],
      'AssertPresent of a row',
    ],
    ['an If of two rows as the result', either, 'as the result'],
    [
      'a Coalesce of two rows as the result',
      ['Coalesce', at, other],
      'as the result',
    ],
    [
      'a user function that returns the row',
      ['fr', 'L', 'n'],
      'a row at an index known at run time as the result of fr',
    ],
    [
      'IsMissing of a user function that returns the row',
      ['IsMissing', ['fr', 'L', 'n']],
      'as the result of fr',
    ],
    [
      'Length of a Coalesce of a user function that returns the row',
      ['Length', ['Coalesce', ['fr', 'L', 'n'], ['List', 9]]],
      'as the result of fr',
    ],
    [
      'IsMissing of a local that a Loop assigns the row',
      [
        'Block',
        ['Declare', 'q', "'unknown'", ['List', 1, 2]],
        ['Loop', ['Assign', 'q', at], ['Element', 'j', ['Range', 1, 2]]],
        ['IsMissing', 'q'],
      ],
      'a row at an index known at run time carried by a loop',
    ],
    [
      'IsMissing of a Reduce whose accumulator is the row',
      [
        'IsMissing',
        ['Reduce', ['Range', 1, 2], ['Function', at, 'acc', 'j'], ['List', 1, 2]],
      ],
      'carried by a loop',
    ],
    [
      'a Reduce whose initial value is the row',
      [
        'IsMissing',
        ['Reduce', ['Range', 1, 0], ['Function', at, 'acc', 'j'], at],
      ],
      'carried by a loop',
    ],
    [
      'a row of a Chunk at a run-time index',
      ['Length', ['At', ['Chunk', ['List', 1, 2, 3], 2], 'n']],
      'At of a Chunk or a Partition',
    ],
  ] as [string, MathJsonExpression, string][])(
    '%s declines',
    (_, expr, why) => {
      expect(() => compile(ce.box(expr), { fallback: false })).toThrow(why);
    }
  );
});

describe('a function that reads a free input of the lane', () => {
  it('the size of a tree, with the adjacency list a free input', () => {
    const local = new ComputeEngine();
    local.declare('A', 'list<list<integer>>');
    local.declare('size', '(integer) -> integer');
    local.assign(
      'size',
      local.box([
        'Function',
        [
          'Add',
          1,
          [
            'Reduce',
            ['Map', ['Function', ['size', 'c'], 'c'], ['At', 'A', 'v']],
            'Add',
            0,
          ],
        ],
        'v',
      ])
    );
    const c = compile(local.box(['size', 1]), { fallback: false }) as any;
    for (const o of [{ to: 'glsl' }, { to: 'interval-js' }, { mode: 'bigint' }])
      expect(() =>
        compile(local.box(['size', 1]), { fallback: false, ...o } as any)
      ).toThrow(/input A of type list<list<integer>>/);
    const A = [[2, 3], [4], [], []];
    local.assign('A', local.box(['List', ...A.map((r) => ['List', ...r])]));
    expect(local.box(['size', 1]).evaluate().re).toBe(4);
    expect(c.run({ A })).toBe(4);
  });
});

describe('a tuple input and a typed parameter of the lane', () => {
  const local = new ComputeEngine();
  local.declare('G', 'tuple<integer, list<list<integer>>>');
  local.declare('T', 'tuple<list<integer>, list<integer>>');
  local.declare('L', 'list<list<integer>>');
  local.declare('n', 'integer');
  const inputs = { G: [7, [[1, 2], [3]]], T: [[1, 2], [3]], L: GRAPHS[0] };
  const boxed = {
    G: local.box(['Tuple', 7, ['List', ['List', 1, 2], ['List', 3]]]),
    T: local.box(['Tuple', ['List', 1, 2], ['List', 3]]),
    L: local.box(['List', ...GRAPHS[0].map((x) => ['List', ...x])]),
  };
  const typedApply = (body: MathJsonExpression): MathJsonExpression => [
    'Apply',
    ['Function', body, ['Typed', 'm', "'list<list<integer>>'"]],
    'L',
  ];
  it.each([
    [
      'a part of the lane',
      ['Add', ['At', 'G', 1], ['Length', ['At', 'G', 2]]],
    ],
    ['a row of the part', ['Length', ['At', ['At', 'G', 2], 'n']]],
    ['an element of the part', ['At', ['At', ['At', 'G', 2], 'n'], 1]],
    [
      'two lists of run-time lengths',
      ['Add', ['Length', ['At', 'T', 1]], ['Sum', ['At', 'T', 2]]],
    ],
    ['a typed parameter of Apply', typedApply(['Length', 'm'])],
    [
      'a row of a typed parameter of Apply',
      typedApply(['Sum', ['At', 'm', 'n']]),
    ],
  ] as [string, MathJsonExpression][])(
    '%s agrees with evaluate()',
    (_, expr) => {
      const c = compile(local.box(expr), { fallback: false }) as any;
      for (const n of [1, 2, -1])
        expect(c.run({ ...inputs, n })).toBe(
          local
            .box(expr)
            .subs({ ...boxed, n })
            .evaluate().re
        );
    }
  );

  it.each([{ to: 'glsl' }, { to: 'interval-js' }, { mode: 'bigint' }])(
    'declines on %o',
    (options) => {
      for (const expr of [
        ['Length', ['At', 'G', 2]],
        typedApply(['Length', 'm']),
      ] as MathJsonExpression[])
        expect(() =>
          compile(local.box(expr), { fallback: false, ...options } as any)
        ).toThrow();
    }
  );
});

describe('what still declines', () => {
  it.each([
    ['a Map whose value is a row', map('r')],
    [
      'a Filter of the rows',
      ['Filter', 'L', row(['Greater', ['Length', 'r'], 1])],
    ],
    ['the rows as a value', ['Add', 'L', 1]],
    [
      'the rows held by a local',
      ['Block', ['Declare', 'h', "'unknown'", 'L'], ['Length', 'h']],
    ],
    [
      'a list of lists of run-time length that the program makes',
      ['Map', ['Function', ['Range', 1, 'i'], 'i'], ['Range', 1, 'n']],
    ],
  ] as [string, MathJsonExpression][])('%s', (_, expr) => {
    expect(() => compile(ce.box(expr), { fallback: false })).toThrow();
  });

  it.each([{ to: 'glsl' }, { to: 'interval-js' }, { mode: 'bigint' }])(
    'on %o',
    (options) =>
      expect(() =>
        compile(ce.box(['Count', 'L']), { fallback: false, ...options } as any)
      ).toThrow(/the input L of type list<list<integer>>/)
  );
});

describe('a row at a run-time index as the value of an entry that assigns', () => {
  it('declines, as the entry without the assignment does', () => {
    const e = new ComputeEngine();
    e.declare('s', 'integer');
    e.assign('s', 0);
    const f: MathJsonExpression = [
      'Function',
      ['Block', ['Assign', 's', ['Add', 's', 1]], ['At', 'g', 'k']],
      ['Typed', 'g', "'list<list<integer>>'"],
      ['Typed', 'k', "'integer'"],
    ];
    expect(() => compile(e.box(f), { fallback: false })).toThrow(
      /a row at an index known at run time as the result/
    );
  });
});
