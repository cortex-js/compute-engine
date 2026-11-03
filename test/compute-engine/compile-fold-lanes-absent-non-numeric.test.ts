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
  // The interpreter gives `Missing` from the step that reads an absent
  // element on. A declared type cannot name `missing` (`docs/ERROR-MODEL.md`,
  // "`Missing` is a result only"), so `L` is declared `list<number>` and
  // holds the marker: a store accepts it where the declared type accepts a
  // present value. Each `NaN` of the expected values below stands for
  // `Missing`.
  // The compiled value of a fold over an absent element is not specified
  // (`docs/COMPILATION-MODEL.md`, "Caveats of compiled code", the bullet
  // "Everything computed from an absent value, except at a discharge"; R4 of
  // `docs/plans/2026-11-01-absent-value-contract.md`): only the
  // interpreter's value is checked for it.
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
    expect(evaluate('list<number>', expr, SCALARS)).toBe(
      JSON.stringify(expected).replace(/null/g, '"Missing"')
    );
  });

  test('a complex seed over an absent element', () => {
    expect(
      evaluate(
        'list<number>',
        ['Reduce', 'L', 'Multiply', 'ImaginaryUnit'],
        SCALARS
      )
    ).toBe('"Missing"');
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
    expect(evaluate('list<list<number>>', expr, NESTED)).toBe(
      JSON.stringify(expected).replace(/null/g, '"Missing"')
    );
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
