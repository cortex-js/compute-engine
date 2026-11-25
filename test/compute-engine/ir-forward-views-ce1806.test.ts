/**
 * CE-1806: a `Map` or a `Filter` that one reader reads becomes no list in
 * compiled JavaScript (the pass `forward` of `compilation/ir/passes.ts`;
 * `compilation/ir/README.md`, "Lists", where a view is a list).
 *
 * - CE-1806.2: a read of one position of a `Map` (`First`, `Last`, `At`) is
 *   the callback at that element of the source, with the range check of
 *   `At` and NaN out of range.
 * - CE-1806.1: a reducer over a `Map` reads the callback in its loop; a
 *   `Length` of a `Filter` counts; a reducer over a `Filter` runs its body
 *   where an element is kept, over the source.
 * - CE-1806.3: `First` of a `Filter`, `Find` and `Any` stop at the first
 *   element kept.
 *
 * A view stays a list as the result of the program, as an argument of a
 * function of the host, where it is read twice, and where its callback has
 * an effect.
 */
import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compile';
import { parseEpsil, resolveLibraryNames } from '../../src/epsil';

type Inputs = Record<string, number | number[]>;

/** The compilation of the Epsil program `src` on JavaScript, with `L` and
 *  `M` lists of reals, `k` an integer and `r` a real. */
function compiled(src: string) {
  const ce = new ComputeEngine();
  ce.declare('L', 'list<real>');
  ce.declare('M', 'list<real>');
  ce.declare('k', 'integer');
  ce.declare('r', 'real');
  const [program] = parseEpsil(src);
  const expr = ce.box(resolveLibraryNames(program, src, ce));
  const result = compile(expr, { to: 'javascript', fallback: false } as any);
  if (!result.success) throw new Error(`declined: ${result.error}`);
  return { ce, expr, code: result.code as string, run: result.run! };
}

/** The interpreter's value of `expr` at `inputs`, as a number or a
 *  boolean (NaN for a value that is not a number: `Missing`, `Nothing`). */
function interpreted(
  ce: ComputeEngine,
  expr: ReturnType<ComputeEngine['box']>,
  inputs: Inputs
): number | boolean {
  for (const [name, v] of Object.entries(inputs))
    ce.assign(name, Array.isArray(v) ? ce.box(['List', ...v]) : v);
  const value = expr.evaluate();
  if (value.symbol === 'True') return true;
  if (value.symbol === 'False') return false;
  return value.re;
}

/** The number of loops (each charges its passes with `_SYS.tick`) and of
 *  arrays in `code`. */
const loops = (code: string) => code.split('_SYS.tick(').length - 1;
const arrays = (code: string) =>
  code.split('new Array(').length - 1 + (code.split('= [];').length - 1);

const LISTS = [[], [1], [3, -1, 4, 1.5, 5], [0.5, 0.25, 9, 2.5, -3, 7]];

/** The value of `src` equals the interpreter's at each list of `LISTS`
 *  given to `L`, with the other `inputs`. */
function agrees(src: string, inputs: Inputs = {}) {
  const { ce, expr, code, run } = compiled(src);
  for (const L of LISTS) {
    const at = { ...inputs, L };
    const value = run(at);
    const expected = interpreted(ce, expr, at);
    if (typeof expected === 'number' && typeof value === 'number')
      expect([src, L, value]).toEqual([src, L, expected]);
    else expect([src, L, value]).toEqual([src, L, expected]);
  }
  return code;
}

describe('CE-1806.2: one position of a Map', () => {
  test.each([
    'first(map(x => x * 2, L))',
    'last(map(x => x * 2, L))',
    'map(x => x * 2, L)[3]',
    'map(x => x * 2, L)[-2]',
    'map(x => x * 2, L)[0]',
    'map(x => x * 2, L)[7]',
    'map(x => x * 2, L)[-9]',
    'first(map(x => x * x + 1, L))',
  ])('%s is the callback at that element', (src) => {
    const code = agrees(src);
    expect(arrays(code)).toBe(0);
    expect(loops(code)).toBe(0);
  });

  test.each([-7, -2, -1, 0, 1, 2, 5, 9])(
    'an index k = %d known at run time',
    (k) => {
      const code = agrees('map(x => x * 2, L)[k]', { k });
      expect(arrays(code)).toBe(0);
    }
  );

  test.each([1, 1.5, -1, 2, 6, -6])(
    'a real index r = %d known at run time',
    (r) => {
      const code = agrees('map(x => x * 2, L)[r]', { r });
      expect(arrays(code)).toBe(0);
    }
  );

  test('a Map of a Map', () => {
    const code = agrees('first(map(y => y + 1, map(x => x * 2, L)))');
    expect(arrays(code)).toBe(0);
  });

  test('a Map of a Range of a constant count', () => {
    const code = agrees('first(map(x => x * 0.5, 1..30))');
    expect(arrays(code)).toBe(0);
    expect(arrays(agrees('sum(map(x => x * 0.5, 1..30))'))).toBe(0);
    // Of integers, `At` keeps the list: its NaN out of range is no
    // integer.
    expect(arrays(agrees('first(map(x => x * 2, 1..30))'))).toBe(1);
  });
});

describe('CE-1806.1: a reducer over a Map or a Filter', () => {
  test.each([
    'sum(map(x => x * 2, L))',
    'product(map(x => x * 2, L))',
    'min(map(x => x * 2, L))',
    'max(map(x => x * 2, L))',
    'mean(map(x => x * 2, L))',
    'reduce(map(x => x * 2, L), (a, b) => a + b, 0)',
    'all(map(x => x * 2, L), c => c > 3)',
    'sum(map(y => y + 1, map(x => x * 2, L)))',
  ])('%s: one loop, no array', (src) => {
    const code = agrees(src);
    expect(arrays(code)).toBe(0);
    expect(loops(code)).toBe(1);
  });

  test.each([
    'length(filter(L, c => c > 2))',
    'sum(filter(L, c => c > 2))',
    'sum(filter(map(x => x * 2, L), c => c > 2))',
    'mean(filter(L, c => c > 2))',
    'max(filter(L, c => c > 2))',
    'min(filter(map(x => x - 1, L), c => c > 100))',
    'length(filter(L, c => c > 100))',
    'all(filter(L, c => c > 2), c => c > 4)',
    'product(filter(L, c => c > 2))',
    'reduce(filter(L, c => c > 2), (a, b) => a + b, 0)',
  ])('%s: one loop over the source, no array', (src) => {
    const code = agrees(src);
    expect(arrays(code)).toBe(0);
    expect(loops(code)).toBe(1);
  });
});

describe('CE-1806.3: the first element that a Filter keeps', () => {
  test.each([
    'first(filter(L, c => c > 2))',
    'first(filter(map(x => x * 2, L), c => c > 2))',
    'first(filter(L, c => c > 100))',
    'find(L, c => c > 2)',
    'find(L, c => c > 100)',
    'any(map(x => x * 2, L), c => c > 3)',
    'any(L, c => c > 100)',
  ])('%s: a loop that stops, no array', (src) => {
    const code = agrees(src);
    expect(arrays(code)).toBe(0);
    expect(loops(code)).toBe(1);
    // The loop stops at the first element kept.
    expect(code).toMatch(/&& !v\d+;/);
  });
});

describe('a view that stays a list', () => {
  test('the result of the program', () => {
    const { code, run } = compiled('map(x => x * 2, L)');
    expect(arrays(code)).toBe(1);
    expect(run({ L: [1, 2] })).toEqual([2, 4]);
    const filtered = compiled('filter(L, c => c > 1)');
    expect(arrays(filtered.code)).toBe(1);
    expect(filtered.run({ L: [1, 2, 3] })).toEqual([2, 3]);
  });

  test('a view read twice', () => {
    const code = agrees('do { let m = map(x => x * 2, L); sum(m) + first(m) }');
    expect(arrays(code)).toBe(1);
    const filtered = agrees(
      'do { let m = filter(L, c => c > 2); sum(m) + length(m) + first(m) }'
    );
    expect(arrays(filtered)).toBe(1);
  });

  test('a view of a length known at run time only, not as the length of a list', () => {
    // A build refuses 2^32 elements, and a loop of 2^32 passes runs: the
    // list stays, so that the program refuses what it refused.
    const { code, run } = compiled('first(map(x => x * 0.5, 1..k))');
    expect(arrays(code)).toBe(1);
    expect(run({ k: 5 })).toBe(0.5);
    expect(arrays(compiled('sum(filter(1..k, c => c > 2))').code)).toBe(1);
  });

  test('a view that a loop reads at an index other than its own', () => {
    // The loop of `Sum` reads the element `n - 1 - i` of the `Map`.
    const code = agrees('sum(reverse(map(x => x * 2, L)))');
    expect(arrays(code)).toBe(1);
  });

  test('a callback with a draw', () => {
    const { code } = compiled('first(map(x => x + random(), L))');
    expect(arrays(code)).toBe(1);
    const filtered = compiled('sum(filter(L, c => c > random()))');
    expect(arrays(filtered.code)).toBe(1);
  });

  test('a loop over the length of another list (Dot)', () => {
    // `Dot` reads its second list over the length of the first: a read past
    // the end of the array is NaN, which the callback must not replace.
    const ce = new ComputeEngine();
    ce.declare('A', 'list<real>');
    ce.declare('B', 'list<real>');
    for (const body of [['If', ['Greater', 'x', 0], 'x', 0], 1]) {
      const dot = compile(
        ce.box(['Dot', 'A', ['Map', ['Function', body, 'x'], 'B']]),
        { to: 'javascript', fallback: false } as any
      );
      expect(arrays(dot.code)).toBe(1);
      expect(dot.run!({ A: [1, 2, 3], B: [5] })).toBeNaN();
      expect(dot.run!({ A: [1, 2], B: [5, -1] })).toBe(body === 1 ? 3 : 5);
    }
  });

  test('a reduction whose initial value or step reads the count', () => {
    // The loop over the source gives the count after it: a loop whose
    // initial value reads it keeps the list. A step that reads the count and
    // not the element reads no list: the filter is a loop that counts.
    for (const [src, expected, lists] of [
      [
        'do { let m = filter(L, c => c > 2); reduce(m, (a, b) => a + b, length(m)) }',
        9,
        1,
      ],
      [
        'do { let m = filter(L, c => c > 2); reduce(m, (a, b) => length(m), 0) }',
        2,
        0,
      ],
    ] as const) {
      const { code, run } = compiled(src);
      expect(arrays(code)).toBe(lists);
      expect(run({ L: [1, 3, 4] })).toBe(expected);
    }
  });

  test('a callback that can fail', () => {
    // `docs/COMPILATION-MODEL.md`, "Known limitations": the code tests every
    // element, and fails where the interpreter stops before.
    const ce = new ComputeEngine();
    ce.declare('L', 'list<real>');
    ce.declare('M', 'list<real>');
    const present = ['AssertPresent', ['At', 'M', 'a']];
    const any = compile(
      ce.box(['Any', 'L', ['Function', ['Greater', present, 0], 'a']]),
      { to: 'javascript', fallback: false } as any
    );
    expect(arrays(any.code)).toBe(1);
    expect(() => any.run!({ L: [1, 5], M: [1] })).toThrow();
    const first = compile(
      ce.box(['First', ['Map', ['Function', present, 'a'], 'L']]),
      { to: 'javascript', fallback: false } as any
    );
    expect(arrays(first.code)).toBe(1);
  });

  test('an argument of a function of the host', () => {
    const ce = new ComputeEngine();
    const seen: string[] = [];
    ce.declare('hostSum', {
      signature: '(indexed_collection<real>) -> real',
      evaluate: (ops) => {
        seen.push(JSON.stringify(ops[0].json));
        return ce.number(0);
      },
    });
    ce.declare('t', 'real');
    const src = 'hostSum(map(x => x * t, 1..20))';
    const [program] = parseEpsil(src);
    const result = compile(ce.box(resolveLibraryNames(program, src, ce)), {
      to: 'javascript',
      fallback: false,
    } as any);
    expect(result.success).toBe(true);
    expect(arrays(result.code)).toBe(1);
    result.run!({ t: 2 });
    expect(seen).toEqual([
      JSON.stringify([
        'List',
        ...Array.from({ length: 20 }, (_, j) => 2 * (j + 1)),
      ]),
    ]);
  });
});
