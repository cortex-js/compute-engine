/**
 * The facets of the combinatorial generators, and two fixes of 2026-10-18.
 *
 * 1. `Permutations`, `Combinations`, `PowerSet` and `CartesianProduct` can have
 *    more elements than a walk can visit: `Permutations(Range(1, 25))` has 25!
 *    elements. `Permutations` and `Combinations` compute an element from its
 *    position (`at`, and `atBigint` for a position that is not a safe
 *    integer) and a position from an element (`indexOf`, by the rank of the
 *    arrangement), and all four count the elements that are the same as a
 *    value (`countOf`). So `Element`, `At`, `IndexOf`, `First`, `Last` and
 *    `Count(S, v)` answer at once. Each facet gives the answer of the walk, in
 *    the order of the walk: the tests compare them for each element of small
 *    sources.
 * 2. A predicate whose verdict is not decided (`y > 0` for a `y` with no value)
 *    leaves `Filter`, `Count`, `CountIf`, `Find`, `IndexWhere` and `Position`
 *    unevaluated. They threw `Filter predicate must return "True" or
 *    "False"`.
 * 3. A `Tabulate` with a dimension that is not positive is empty, so
 *    `Table(k, {k, 1, n})` (which is `Tabulate(k ↦ k, n)`) is `[]` when `n`
 *    is `0`. The compilation still declines a constant dimension that is not
 *    positive (`compile.test.ts`, "Tabulate with a statically non-positive
 *    dimension fails closed").
 */

import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine';
import { JavaScriptTarget } from '../../src/compute-engine/compilation/javascript-target';

const ce = new ComputeEngine();

function evaluate(expr: unknown): string {
  return ce
    .box(expr as any)
    .evaluate()
    .toString();
}

/** The value of `f()` and the time it took, in milliseconds. */
function timed<T>(f: () => T): [T, number] {
  const start = Date.now();
  const value = f();
  return [value, Date.now() - start];
}

// A generous bound: a walk of 25! elements does not end, and each of these
// reads takes a few milliseconds.
const FAST_MS = 2000;

const ONE_TO_25 = ['Range', 1, 25];
const PERMS_25 = ['Permutations', ONE_TO_25];
const DESCENDING_25 = ['List', ...Array.from({ length: 25 }, (_, i) => 25 - i)];
const ASCENDING_25 = ['List', ...Array.from({ length: 25 }, (_, i) => i + 1)];
const FACTORIAL_25 = 15511210043330985984000000n;

/**
 * The permutation of `1..n` at the 0-based position `rank` of the
 * lexicographic order, by the factorial number system (the Lehmer code): digit
 * `p` of `rank` in radix `(n − p)` is the index of the chosen value among the
 * values that are not used yet. This is computed here independently of the
 * engine.
 */
function lehmerPermutation(n: number, rank: bigint): number[] {
  const factorials: bigint[] = [1n];
  for (let i = 1; i <= n; i++) factorials.push(factorials[i - 1] * BigInt(i));
  const values = Array.from({ length: n }, (_, i) => i + 1);
  const result: number[] = [];
  let r = rank;
  for (let p = 0; p < n; p++) {
    const f = factorials[n - 1 - p];
    const d = Number(r / f);
    r %= f;
    result.push(values.splice(d, 1)[0]);
  }
  return result;
}

describe('1. the facets of a generator give the answers of its walk', () => {
  const SOURCES: unknown[] = [
    ['List'],
    ['List', 1],
    ['List', 1, 2, 3],
    ['List', 1, 1, 2],
    ['List', 'a', 'b', 'a', 'c'],
    ['List', 2, 2, 2],
    ['Range', 1, 5],
  ];
  const GENERATORS: unknown[] = [];
  for (const s of SOURCES) {
    GENERATORS.push(['Permutations', s]);
    const n = (s as unknown[])[0] === 'Range' ? 5 : (s as unknown[]).length - 1;
    for (let k = 0; k <= n; k++) {
      GENERATORS.push(['Permutations', s, k]);
      GENERATORS.push(['Combinations', s, k]);
    }
  }

  test.each(GENERATORS.map((g) => [JSON.stringify(g), g]))(
    '%s',
    (_label, generator) => {
      const S = ce.box(generator as any);
      const walk = [...S.each()] as Expression[];
      expect(S.count).toBe(walk.length);
      for (let i = 1; i <= walk.length; i++) {
        const element = walk[i - 1];
        // `at`, from the start and from the end.
        expect(S.at(i)?.isSame(element)).toBe(true);
        expect(S.at(i - walk.length - 1)?.isSame(element)).toBe(true);
        // `IndexOf` is the position of the FIRST element that is the same,
        // and `Count` the number of elements that are the same (a source
        // with elements that are the same has arrangements that are the
        // same).
        const first = walk.findIndex((w) => w.isSame(element)) + 1;
        const same = walk.filter((w) => w.isSame(element)).length;
        expect(ce.function('IndexOf', [S, element]).evaluate().re).toBe(first);
        expect(ce.function('Count', [S, element]).evaluate().re).toBe(same);
        expect(S.contains(element)).toBe(true);
      }
      expect(S.at(walk.length + 1)).toBeUndefined();
      expect(S.at(-walk.length - 1)).toBeUndefined();
      // A value that is not an element.
      const absent = ce.box(['List', 99, 98]);
      expect(ce.function('IndexOf', [S, absent]).evaluate().re).toBe(0);
      expect(ce.function('Count', [S, absent]).evaluate().re).toBe(0);
      expect(S.contains(absent)).toBe(false);
      expect(ce.function('IndexOf', [S, ce.number(5)]).evaluate().re).toBe(0);
    }
  );

  test('a string source: the elements by position are those of the walk', () => {
    for (const generator of [
      ['Permutations', "'abc'"],
      ['Permutations', "'aab'"],
      ['Combinations', "'abcd'", 2],
    ]) {
      const S = ce.box(generator as any);
      const walk = [...S.each()] as Expression[];
      for (let i = 1; i <= walk.length; i++) {
        expect(S.at(i)?.isSame(walk[i - 1])).toBe(true);
        expect(S.at(-i)?.isSame(walk[walk.length - i])).toBe(true);
      }
    }
    // A search over a string source walks (the characters of a target do
    // not tell which characters of the source make it).
    expect(evaluate(['IndexOf', ['Permutations', "'abc'"], "'bca'"])).toBe('4');
    expect(evaluate(['Count', ['Permutations', "'aab'"], "'aba'"])).toBe('2');
    expect(evaluate(['Element', "'bca'", ['Permutations', "'abc'"]])).toBe(
      '"True"'
    );
  });
});

describe('1. Permutations(Range(1, 25)) answers at once', () => {
  test('Element', () => {
    const [yes, t1] = timed(() =>
      evaluate(['Element', DESCENDING_25, PERMS_25])
    );
    const [no, t2] = timed(() =>
      evaluate(['Element', ['List', 1, 2], PERMS_25])
    );
    expect(yes).toBe('"True"');
    expect(no).toBe('"False"');
    expect(t1 + t2).toBeLessThan(FAST_MS);
  });

  test('At, with a position that is not a safe integer', () => {
    const [value, ms] = timed(() =>
      ce.box(['At', PERMS_25, ['Power', 10, 20]]).evaluate()
    );
    expect(ms).toBeLessThan(FAST_MS);
    expect(value.json).toEqual([
      'List',
      ...lehmerPermutation(25, 10n ** 20n - 1n),
    ]);
    // `10^20 + 1` is not a safe integer either, and as a double it is
    // `10^20`: the position is read exactly.
    expect(
      ce.box(['At', PERMS_25, ['Add', ['Power', 10, 20], 1]]).evaluate().json
    ).toEqual(['List', ...lehmerPermutation(25, 10n ** 20n)]);
    expect(ce.box(['At', PERMS_25, ['Factorial', 25]]).evaluate().json).toEqual(
      DESCENDING_25
    );
    expect(
      ce.box(['At', PERMS_25, ['Negate', ['Factorial', 25]]]).evaluate().json
    ).toEqual(ASCENDING_25);
    // Past the last element: the absence marker.
    expect(
      ce.box(['At', PERMS_25, ['Add', ['Factorial', 25], 1]]).evaluate().symbol
    ).toBe('Missing');
    // A gather.
    expect(
      ce.box(['At', PERMS_25, ['List', ['Power', 10, 20], -1]]).evaluate().json
    ).toEqual([
      'List',
      ['List', ...lehmerPermutation(25, 10n ** 20n - 1n)],
      DESCENDING_25,
    ]);
  });

  test('At, parse route', () => {
    expect(
      ce
        .parse(
          '\\operatorname{At}(\\operatorname{Permutations}(\\operatorname{Range}(1, 25)), 10^{20})'
        )
        .evaluate().json
    ).toEqual(['List', ...lehmerPermutation(25, 10n ** 20n - 1n)]);
  });

  test('IndexOf', () => {
    const [last, ms] = timed(() =>
      ce.box(['IndexOf', PERMS_25, DESCENDING_25]).evaluate()
    );
    expect(ms).toBeLessThan(FAST_MS);
    expect(last.isSame(ce.number(FACTORIAL_25))).toBe(true);
    const element = ['List', ...lehmerPermutation(25, 10n ** 20n - 1n)];
    expect(
      ce
        .box(['IndexOf', PERMS_25, element])
        .evaluate()
        .isSame(ce.number(10n ** 20n))
    ).toBe(true);
    expect(evaluate(['IndexOf', PERMS_25, ['List', 1]])).toBe('0');
  });

  test('First and Last', () => {
    const [first, t1] = timed(() => ce.box(['First', PERMS_25]).evaluate());
    const [last, t2] = timed(() => ce.box(['Last', PERMS_25]).evaluate());
    expect(t1 + t2).toBeLessThan(FAST_MS);
    expect(first.json).toEqual(ASCENDING_25);
    expect(last.json).toEqual(DESCENDING_25);
  });

  test('Count of a value, and Contains', () => {
    const [count, ms] = timed(() =>
      evaluate(['Count', PERMS_25, DESCENDING_25])
    );
    expect(ms).toBeLessThan(FAST_MS);
    expect(count).toBe('1');
    expect(evaluate(['Count', PERMS_25, 5])).toBe('0');
    expect(evaluate(['Contains', PERMS_25, DESCENDING_25])).toBe('"True"');
  });

  test('a symbol that holds the source', () => {
    const ce = new ComputeEngine();
    ce.assign('xs', ce.box(ONE_TO_25));
    expect(
      ce
        .box(['IndexOf', ['Permutations', 'xs'], DESCENDING_25])
        .evaluate()
        .isSame(ce.number(FACTORIAL_25))
    ).toBe(true);
  });

  test('Permutations with a length, and Combinations', () => {
    const P = ['Permutations', ['Range', 1, 30], 20];
    const element = ce.box(['At', P, ['Power', 10, 25]]).evaluate();
    expect(element.nops).toBe(20);
    expect(
      ce
        .function('IndexOf', [ce.box(P), element])
        .evaluate()
        .isSame(ce.number(10n ** 25n))
    ).toBe(true);
    const C = ['Combinations', ['Range', 1, 100], 50];
    const c = ce.box(['At', C, ['Power', 10, 25]]).evaluate();
    expect(c.nops).toBe(50);
    expect(
      ce
        .function('IndexOf', [ce.box(C), c])
        .evaluate()
        .isSame(ce.number(10n ** 25n))
    ).toBe(true);
    expect(ce.box(['Last', C]).evaluate().json).toEqual([
      'List',
      ...Array.from({ length: 50 }, (_, i) => i + 51),
    ]);
    expect(
      evaluate([
        'Count',
        C,
        ['List', ...Array.from({ length: 50 }, (_, i) => i + 1)],
      ])
    ).toBe('1');
  });
});

describe('1. PowerSet and CartesianProduct count a value at once', () => {
  const SIXTY = ['Set', ...Array.from({ length: 60 }, (_, i) => i + 1)];
  const TEN = ['Set', ...Array.from({ length: 10 }, (_, i) => i + 1)];

  test('PowerSet', () => {
    const [count, ms] = timed(() =>
      evaluate(['Count', ['PowerSet', SIXTY], ['Set', 1, 2]])
    );
    expect(ms).toBeLessThan(FAST_MS);
    expect(count).toBe('1');
    // The walk gives each subset with its elements in the order of the base,
    // and `isSame` compares two sets without regard to the order of their
    // elements, so `{2, 1}` is the subset `{1, 2}`.
    expect(evaluate(['Count', ['PowerSet', SIXTY], ['Set', 2, 1]])).toBe('1');
    expect(evaluate(['Count', ['PowerSet', SIXTY], ['Set', 61, 1]])).toBe('0');
    expect(evaluate(['Count', ['PowerSet', SIXTY], 'EmptySet'])).toBe('1');
    expect(evaluate(['Count', ['PowerSet', SIXTY], 5])).toBe('0');
  });

  test('CartesianProduct', () => {
    const product = ['CartesianProduct', ...Array(17).fill(TEN)];
    const [count, ms] = timed(() =>
      evaluate(['Count', product, ['Tuple', ...Array(17).fill(3)]])
    );
    expect(ms).toBeLessThan(FAST_MS);
    expect(count).toBe('1');
    expect(evaluate(['Count', product, ['Tuple', 3]])).toBe('0');
  });

  test('small sources agree with the walk', () => {
    for (const S of [
      ['PowerSet', ['Set', 3, 1, 2]],
      ['CartesianProduct', ['Set', 1, 2], ['Set', 'a', 'b']],
    ]) {
      const boxed = ce.box(S as any);
      const walk = [...boxed.each()] as Expression[];
      for (const element of walk) {
        const same = walk.filter((w) => w.isSame(element)).length;
        expect(ce.function('Count', [boxed, element]).evaluate().re).toBe(same);
      }
    }
  });
});

describe('2. a predicate whose verdict is not decided', () => {
  const P = ['Function', ['Greater', 'y', 0], 'y'];

  test('box route', () => {
    const filter = ['Filter', ['List', 'z'], P];
    expect(evaluate(filter)).toBe('Filter([z], (y) => 0 < y)');
    expect(evaluate(['Count', filter])).toBe(
      'Count(Filter([z], (y) => 0 < y))'
    );
    expect(evaluate(['Count', ['List', 'z'], P])).toBe(
      'Count([z], (y) => 0 < y)'
    );
    expect(evaluate(['CountIf', ['List', 'z'], P])).toBe(
      'CountIf([z], (y) => 0 < y)'
    );
    expect(evaluate(['Find', ['List', 'z', 5], P])).toBe(
      'Find([z,5], (y) => 0 < y)'
    );
    expect(evaluate(['IndexWhere', ['List', 'z', 5], P])).toBe(
      'IndexWhere([z,5], (y) => 0 < y)'
    );
    expect(evaluate(['Position', ['List', 'z', 5], P])).toBe(
      'Position([z,5], (y) => 0 < y)'
    );
    expect(evaluate(['Last', ['Filter', ['List', 'z', 5], P]])).toBe(
      'Last(Filter([z,5], (y) => 0 < y))'
    );
  });

  test('a decided verdict before the undecided one still answers', () => {
    expect(evaluate(['First', ['Filter', ['List', 5, 'z'], P]])).toBe('5');
    expect(evaluate(['Find', ['List', 5, 'z'], P])).toBe('5');
    expect(evaluate(['IndexWhere', ['List', 5, 'z'], P])).toBe('1');
  });

  test('parse route', () => {
    const ce = new ComputeEngine();
    expect(
      ce
        .parse('\\operatorname{Filter}([z], y \\mapsto y > 0)')
        .evaluate()
        .toString()
    ).toBe('Filter([z], (y) => 0 < y)');
    expect(
      ce
        .parse('\\operatorname{CountIf}([z], y \\mapsto y > 0)')
        .evaluate()
        .toString()
    ).toBe('CountIf([z], (y) => 0 < y)');
  });

  test('the expression evaluates once the verdict is decided', () => {
    const ce = new ComputeEngine();
    const filter = ce.box(['Filter', ['List', 'w', 5], P]);
    expect(filter.evaluate().toString()).toBe('Filter([w,5], (y) => 0 < y)');
    ce.assign('w', 3);
    expect(filter.evaluate().toString()).toBe('[3,5]');
  });

  test('a predicate that is not a boolean still throws (the walk of Filter is pinned in compile-range-predicate-loop.test.ts)', () => {
    const notBoolean = [
      'Function',
      ['If', ['Greater', 'x', 1], 'True', 1],
      'x',
    ];
    expect(() => evaluate(['CountIf', ['List', 1, 2], notBoolean])).toThrow(
      /CountIf predicate must return "True" or "False"/
    );
  });
});

describe('3. a Tabulate with a dimension that is not positive is empty', () => {
  const f = ['Function', ['Multiply', 'x', 2], 'x'];
  const f2 = ['Function', ['Multiply', 'x', 'y'], 'x', 'y'];

  test('a literal dimension', () => {
    expect(evaluate(['Tabulate', f, 0])).toBe('[]');
    expect(evaluate(['Tabulate', f, -2])).toBe('[]');
    expect(evaluate(['Tabulate', f2, 2, 0])).toBe('[[],[]]');
    expect(evaluate(['Tabulate', f2, 0, 3])).toBe('[]');
    expect(ce.box(['Tabulate', f, 0]).N().toString()).toBe('[]');
    expect(evaluate(['Tabulate', f, 3])).toBe('[2,4,6]');
  });

  test('Table with an upper bound assigned later', () => {
    const ce = new ComputeEngine();
    const table = ce.parse('\\operatorname{Table}(k, \\{k, 1, n\\})');
    expect(table.operator).toBe('Tabulate');
    ce.assign('n', 0);
    expect(table.evaluate().toString()).toBe('[]');
    ce.assign('n', -3);
    expect(table.evaluate().toString()).toBe('[]');
    ce.assign('n', 3);
    expect(table.evaluate().toString()).toBe('[1,2,3]');
  });

  test('Table with a negative upper bound, parse route', () => {
    expect(
      ce
        .parse('\\operatorname{Table}(k^2, \\{k, 1, -2\\})')
        .evaluate()
        .toString()
    ).toBe('[]');
  });

  test('the compilation still declines a constant dimension that is not positive', () => {
    const js = new JavaScriptTarget();
    expect(() => js.compile(ce.box(['Tabulate', f, 0] as any))).toThrow(
      /Could not compile/
    );
    expect(() => js.compile(ce.box(['Tabulate', f2, 3, 0] as any))).toThrow(
      /Could not compile/
    );
  });
});

describe('an undecided verdict needs an unknown', () => {
  // `0 < z` for a `z` with no value is undecided: the read stays
  // unevaluated. `0 < "a"` for the string element `"a"` has no unknown, so no
  // later value can decide it: the predicate is malformed and the read
  // reports it, as before.
  test('a string element is a malformed predicate, a symbol is undecided', () => {
    const engine = new ComputeEngine();
    const pred = ['Function', ['Greater', 'x', 0], 'x'];
    expect(() =>
      engine
        .box(['Count', ['Filter', ['List', 1, { str: 'a' }, 2], pred]] as any)
        .evaluate()
    ).toThrow(/predicate must return/);
    expect(
      engine
        .box(['Count', ['Filter', ['List', 1, 'z', 2], pred]] as any)
        .evaluate().operator
    ).toBe('Count');
  });
});
