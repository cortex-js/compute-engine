import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

// Compiled folds (`Sum`, `Product`, `Reduce`, `Scan`, the statistics) over
// three kinds of elements: elements of unknown type whose values may be
// complex (ROADMAP CE-380), elements that may be absent (CE-381), and
// elements that are not numbers (CE-382).

type C = { re: number; im: number };
const c = (re: number, im: number): C => ({ re, im });

/** The MathJSON of a run-time value. */
function toJson(v: unknown): unknown {
  if (Array.isArray(v)) return ['List', ...v.map(toJson)];
  if (v === null) return 'Missing';
  if (typeof v === 'object') return ['Complex', (v as C).re, (v as C).im];
  return v;
}

/** Compile `expr` with `L` declared `type` and run it with `L = value`. */
function run(
  type: string,
  expr: unknown,
  value: unknown,
  mode?: 'complex'
): unknown {
  const ce = new ComputeEngine();
  ce.declare('L', type);
  const r = compile(ce.box(expr as any), {
    to: 'javascript',
    fallback: false,
    ...(mode ? { mode } : {}),
  } as any);
  expect(r.success).toBe(true);
  return r.run!({ L: value } as never);
}

/** The interpreter's value of `expr` with `L` declared `type` and assigned
 * `value`, as a string. */
function evaluate(type: string, expr: unknown, value: unknown): string {
  const ce = new ComputeEngine();
  ce.declare('L', type);
  ce.assign('L', ce.box(toJson(value) as any));
  return ce
    .box(expr as any)
    .evaluate()
    .toString();
}

function refuses(type: string, expr: unknown): void {
  const ce = new ComputeEngine();
  ce.declare('L', type);
  expect(() =>
    compile(ce.box(expr as any), { to: 'javascript', fallback: false } as any)
  ).toThrow(/Could not compile/);
}

const ROWS = [
  [1, 2],
  [c(0, 1), 3],
];

describe('A PARENT OF A FOLD OVER ELEMENTS OF UNKNOWN TYPE (CE-380)', () => {
  // The fold uses `_SYS.sadd`/`_SYS.smul`, which give a complex entry where
  // an element is complex; the parent reads its entries with the same
  // helpers, never with the JavaScript `+`.
  test.each([
    ['Sum + 1', ['Add', ['Sum', 'L'], 1], [c(2, 1), 6], '[(2 + i),6]'],
    [
      'Product · 2',
      ['Multiply', ['Product', 'L'], 2],
      [c(0, 2), 12],
      '[2i,12]',
    ],
    [
      'Reduce(Add) + 1',
      ['Add', ['Reduce', 'L', 'Add', 0], 1],
      [c(2, 1), 6],
      '[(2 + i),6]',
    ],
    [
      'Reduce(Multiply) + 1',
      ['Add', ['Reduce', 'L', 'Multiply', 1], 1],
      [c(1, 1), 7],
      '[(1 + i),7]',
    ],
    [
      'Scan(Add) + 1',
      ['Add', ['Scan', 'L', 'Add', 0], 1],
      [
        [2, 3],
        [c(2, 1), 6],
      ],
      '[[2,3],[(2 + i),6]]',
    ],
  ])('%s over list<unknown>', (_, expr, compiled, evaluated) => {
    expect(run('list<unknown>', expr, ROWS)).toEqual(compiled);
    expect(evaluate('list<unknown>', expr, ROWS)).toBe(evaluated);
  });

  test('Sum + 1 over list<unknown> with real entries', () => {
    const expr = ['Add', ['Sum', 'L'], 1];
    const value = [
      [1, 2],
      [3, 4],
    ];
    expect(run('list<unknown>', expr, value)).toEqual([5, 7]);
    expect(evaluate('list<unknown>', expr, value)).toBe('[5,7]');
  });

  // In the complex mode, a bare `list` has `any` cells, which may be
  // complex: the same as a `list<unknown>`.
  test('L + 1 over a bare list in the complex mode', () => {
    const value = [c(0, 1), 2];
    expect(run('list', ['Add', 'L', 1], value, 'complex')).toEqual([
      c(1, 1),
      3,
    ]);
    expect(evaluate('list', ['Add', 'L', 1], value)).toBe('[(1 + i),3]');
  });

  // Rows of real numbers keep the real lane, so a real-only parent such as
  // `Floor` still compiles in the strict mode.
  test('Floor of a Scan over rows of real numbers', () => {
    const ce = new ComputeEngine();
    ce.declare('L', 'list<list<real>>');
    const r = compile(ce.box(['Floor', ['Scan', 'L', 'Add', 0]]), {
      to: 'javascript',
      fallback: false,
      mode: 'strict',
    } as any);
    expect(
      r.run!({
        L: [
          [1.5, 2],
          [3, 4],
        ],
      } as never)
    ).toEqual([
      [1, 2],
      [4, 6],
    ]);
  });

  test('a fold of rows in the complex mode', () => {
    for (const type of ['list<list<number>>', 'list<unknown>'])
      expect(
        run(type, ['Add', ['Reduce', 'L', 'Add', 0], 1], ROWS, 'complex')
      ).toEqual([c(2, 1), 6]);
  });
});

describe('A FOLD OVER ELEMENTS THAT MAY BE ABSENT (CE-381)', () => {
  // JavaScript reads `null` as 0 in `+`, `*` and `Math.min`. The
  // interpreter reads an absent element as `NaN`, from that step on.
  const SCALARS = [2, null, 3];
  test.each([
    ['Scan(Multiply)', ['Scan', 'L', 'Multiply', 1], [2, NaN, NaN]],
    ['Scan(Add)', ['Scan', 'L', 'Add', 0], [2, NaN, NaN]],
    ['Reduce(Multiply)', ['Reduce', 'L', 'Multiply', 1], NaN],
    ['Reduce(Add)', ['Reduce', 'L', 'Add', 0], NaN],
    ['Reduce(Min)', ['Reduce', 'L', 'Min'], NaN],
    ['Reduce(Max)', ['Reduce', 'L', 'Max', 0], NaN],
    ['Product', ['Product', 'L'], NaN],
    ['Sum', ['Sum', 'L'], NaN],
  ])('%s over [2, absent, 3]', (_, expr, expected) => {
    expect(run('list<number | missing>', expr, SCALARS)).toEqual(expected);
    expect(evaluate('list<number | missing>', expr, SCALARS)).toBe(
      JSON.stringify(expected).replace(/null/g, 'NaN')
    );
  });

  test('a complex seed over an absent element', () => {
    const r = run(
      'list<number | missing>',
      ['Reduce', 'L', 'Multiply', 'ImaginaryUnit'],
      SCALARS
    ) as C;
    expect(r.re).toBeNaN();
    expect(r.im).toBeNaN();
    expect(
      evaluate(
        'list<number | missing>',
        ['Reduce', 'L', 'Multiply', 'ImaginaryUnit'],
        SCALARS
      )
    ).toBe('NaN');
  });

  const NESTED = [
    [2, null],
    [3, 4],
  ];
  test.each([
    ['Product', ['Product', 'L'], [6, NaN]],
    ['Sum', ['Sum', 'L'], [5, NaN]],
    ['Reduce(Multiply)', ['Reduce', 'L', 'Multiply', 1], [6, NaN]],
  ])('%s over rows with an absent entry', (_, expr, expected) => {
    expect(run('list<list<number | missing>>', expr, NESTED)).toEqual(expected);
    expect(evaluate('list<list<number | missing>>', expr, NESTED)).toBe(
      JSON.stringify(expected).replace(/null/g, 'NaN')
    );
  });

  // In the complex lane, an absent element is `{re: NaN, im: NaN}`: a sum
  // does not keep the finite imaginary part of the seed.
  test('a complex seed of an Add fold over an absent element', () => {
    const r = run(
      'list<number | missing>',
      ['Reduce', 'L', 'Add', 'ImaginaryUnit'],
      SCALARS
    ) as C;
    expect(r.re).toBeNaN();
    expect(r.im).toBeNaN();
  });

  // The matrix product reads an absent cell as `NaN`, not as 0, so the
  // row that holds it is `NaN`. (The interpreter types a literal with an
  // absent cell as a plain list of lists, not as a matrix, and multiplies
  // it element-wise: ROADMAP CE-389.)
  test('the product of matrices with an absent cell', () => {
    const value = [
      [
        [2, null],
        [3, 4],
      ],
      [
        [1, 0],
        [0, 1],
      ],
    ];
    expect(
      run('list<matrix<(number | missing)^(2x2)>>', ['Product', 'L'], value)
    ).toEqual([
      [NaN, NaN],
      [3, 4],
    ]);
  });

  test('a list without absent elements keeps the plain operators', () => {
    const ce = new ComputeEngine();
    ce.declare('L', 'list<number>');
    const r = compile(ce.box(['Scan', 'L', 'Multiply', 1]), {
      to: 'javascript',
      fallback: false,
    });
    expect(r.code).toContain('(_a, _b) => _a * _b');
  });
});

describe('A FOLD OVER ELEMENTS THAT ARE NOT NUMBERS (CE-382)', () => {
  // The interpreter gives an `incompatible-type` error, or leaves `Max`
  // unevaluated. The compiled code read `true` as 1 and a string with `+`.
  test.each([
    ['list<list<string>>', ['Product', 'L']],
    ['list<list<string>>', ['Sum', 'L']],
    ['list<list<boolean>>', ['Product', 'L']],
    ['list<list<boolean>>', ['Sum', 'L']],
    ['list<string>', ['Product', 'L']],
    ['list<boolean>', ['Sum', 'L']],
    ['list<boolean | missing>', ['Sum', 'L']],
    ['list<boolean>', ['Reduce', 'L', 'Add', 0]],
    ['list<boolean>', ['Reduce', 'L', 'Max']],
    ['list<boolean>', ['Scan', 'L', 'Add', 0]],
    ['list<boolean>', ['Scan', 'L', 'Min']],
    ['list<boolean>', ['Max', 'L']],
    ['list<boolean>', ['Mean', 'L']],
  ])('%s: %j is refused', (type, expr) => {
    refuses(type, expr);
  });

  test('the interpreter gives an error for the sum of booleans', () => {
    expect(
      evaluate('list<list<boolean>>', ['Sum', 'L'], [['True'], ['False']])
    ).toMatch(/incompatible-type/);
  });

  // Elements that may be numbers, points and empty lists still compile.
  test.each([
    ['list<string | number>', ['Sum', 'L'], [1, 2], 3],
    [
      'list<tuple<number, number>>',
      ['Sum', 'L'],
      [
        [1, 2],
        [3, 4],
      ],
      [4, 6],
    ],
    ['list<number>', ['Sum', 'L'], [], 0],
    [
      'list<boolean>',
      ['Reduce', 'L', ['Function', ['Add', 'a', 1], 'a', 'x'], 0],
      [true, false],
      2,
    ],
  ])('%s: %j compiles', (type, expr, value, expected) => {
    expect(run(type, expr, value)).toEqual(expected);
  });
});
