import { ComputeEngine } from '../../src/compute-engine';
import type { MathJsonExpression } from '../../src/math-json/types';
import { executeEpsil } from '../../src/epsil/execute-epsil';

//
// A list literal is a value: it holds the values of its elements when it is
// evaluated. A list literal with a spread is canonically a `ListJoin`
// (`[...a, 9, ...b]` is `ListJoin(a, [9], b)`). When a spread operand is a
// finite LAZY collection (`take`, `drop`, `map`, a range), the evaluation of
// the literal lists the elements of that operand, so the literal is a plain
// `List`. Before, it stayed a `ListJoin(Take(…), …)` view: it printed as the
// view, it did not compare equal to the list of its elements, and a loop
// that rebuilt a list from parts of itself added one level of `ListJoin` per
// turn. An infinite spread stays a lazy list, and an explicit `join` stays a
// lazy `Join`. The implementation is `snapshotListJoin`
// (`src/compute-engine/library/collections.ts`). Corpus reproduction:
// `test/epsil/corpus/language/spread-of-lazy-collection.epsil`.
//

function run(source: string): ReturnType<typeof executeEpsil> {
  const ce = new ComputeEngine();
  const parseLatex = (latex: string): MathJsonExpression =>
    ce.parse(latex).json;
  return executeEpsil(ce, source, { parseLatex });
}

describe('a list literal snapshots a spread lazy collection', () => {
  test('a literal with `take` and `drop` spreads is a plain list', () => {
    const { value, diagnostics } = run(
      [
        'let ys = [1, 2, 3, 4]',
        'let zs = [...take(ys, 1), 9, ...drop(ys, 2)]',
        '(zs, zs == [1, 9, 3, 4])',
      ].join('\n')
    );
    expect(diagnostics).toEqual([]);
    expect(value.json).toEqual(['Tuple', ['List', 1, 9, 3, 4], 'True']);
  });

  test('the literal is a `List` without an assignment', () => {
    const { value } = run(
      'let ys = [1, 2, 3, 4]\n[...take(ys, 1), 9, ...drop(ys, 2)]'
    );
    expect(value.operator).toBe('List');
    expect(value.json).toEqual(['List', 1, 9, 3, 4]);
  });

  test('a literal is equal to the list of its elements', () => {
    const { value } = run(
      'let ys = [1, 2, 3, 4]\n[...take(ys, 2), ...drop(ys, 2)] == ys'
    );
    expect(value.json).toBe('True');
  });

  test('map, filter and range spreads are listed', () => {
    const { value } = run(
      [
        'let ys = [1, 2, 3, 4]',
        '([...map(x => x^2, ys)], [...filter(ys, x => x > 2)], [...1..3, 9])',
      ].join('\n')
    );
    expect(value.json).toEqual([
      'Tuple',
      ['List', 1, 4, 9, 16],
      ['List', 3, 4],
      ['List', 1, 2, 3, 9],
    ]);
  });

  test('a lazy element of a spread operand is listed too', () => {
    // The rows that `iterate` yields are lazy `map` views. The literal holds
    // them as lists, so they do not print as their recipes.
    const { value } = run(
      '[[1], ...take(iterate(r => map(x => x + 1, r), [1]), 2)]'
    );
    expect(value.json).toEqual(['List', ['List', 1], ['List', 2], ['List', 3]]);
    expect(value.toString()).toBe('[[1],[2],[3]]');
  });

  test('a loop that rebuilds a list from its parts does not nest', () => {
    // Fifty turns. Before, each turn added one level of `ListJoin`, and
    // this program did not end within the evaluation time limit.
    const { value, diagnostics } = run(
      [
        'let xs = [1, 2, 3, 4, 5]',
        'for k in 1..50 {',
        '  xs = [...take(xs, 2), ...drop(xs, 2)]',
        '}',
        'xs',
      ].join('\n')
    );
    expect(diagnostics).toEqual([]);
    expect(value.json).toEqual(['List', 1, 2, 3, 4, 5]);
  });

  test('a swap loop that moves elements keeps a plain list', () => {
    // A bubble sort that swaps two neighbours with `take` and `drop`.
    const { value, diagnostics } = run(
      [
        'let xs = [5, 3, 8, 1, 9, 2]',
        'for i in 1..6 {',
        '  for j in 1..(6 - i) {',
        '    if xs[j] > xs[j + 1] {',
        '      xs = [...take(xs, j - 1), xs[j + 1], xs[j], ...drop(xs, j + 1)]',
        '    }',
        '  }',
        '}',
        'xs',
      ].join('\n')
    );
    expect(diagnostics).toEqual([]);
    expect(value.json).toEqual(['List', 1, 2, 3, 5, 8, 9]);
  });

  test('an infinite spread stays a lazy list and does not hang', () => {
    const { value } = run('[...1..oo]');
    expect(value.operator).toBe('ListJoin');
    expect(value.isFiniteCollection).toBe(false);
    expect(run('let zs = [...1..oo, 5]\nzs[3]').value.json).toBe(3);
    expect(run('[...take(1..oo, 3), 9]').value.json).toEqual([
      'List',
      1,
      2,
      3,
      9,
    ]);
  });

  test('an explicit `join` stays a lazy `Join`', () => {
    const { value } = run('join(take([1, 2, 3], 2), [9])');
    expect(value.operator).toBe('Join');
  });

  test('a predicate that fails keeps the view, and the read reports it', () => {
    // The predicate does not answer a boolean for the string element. The
    // failure must not escape from the evaluation of the literal: the
    // literal stays a view, and the error is reported when it is read.
    const kept = run('let zs = [...filter([1, "a", 2], x => x > 0)]\nzs');
    expect(kept.diagnostics).toEqual([]);
    expect(kept.value.operator).toBe('ListJoin');
    const read = run('let zs = [...filter([1, "a", 2], x => x > 0)]\nzs[1]');
    expect(read.value.operator).toBe('Error');
  });

  test('the predicate of a spread filter is called once per element', () => {
    const { value, diagnostics } = run(
      [
        'let n = 0',
        'let zs = [...filter([1, 2, 3, 4], x => do {',
        '  n = n + 1',
        '  x > 2',
        '})]',
        '(zs, n)',
      ].join('\n')
    );
    expect(diagnostics).toEqual([]);
    expect(value.json).toEqual(['Tuple', ['List', 3, 4], 4]);
  });

  test('an element that is not spread is kept as it is', () => {
    // `[...xs, 1..3]` is `ListJoin(xs, [Range(1, 3)])`. The range is an
    // element of the literal, not a spread, so it stays a range, as it does
    // in `[1..3]`, also when another operand is spread.
    const { value } = run('let xs = [1, 2]\n[...xs, 1..3]');
    expect(value.operator).toBe('List');
    expect(value.nops).toBe(3);
    expect(value.ops![2].operator).toBe('Range');
    expect(value.ops![2].json).toEqual(run('[1..3]').value.ops![0].json);
  });

  test('nested lazy elements share one bound on the number of elements', () => {
    // 10,000 rows of 10,000 elements would be 10^8 elements. The rows use
    // the rest of the bound of the whole literal, so they stay lazy ranges.
    const { value, diagnostics } = run('[...map(i => 1..10000, 1..10000)]');
    expect(diagnostics).toEqual([]);
    expect(value.nops).toBe(10000);
    expect(value.ops![0].operator).toBe('Range');
    expect(value.ops![9999].operator).toBe('Range');
  }, 60_000);

  test('small nested lazy elements are listed', () => {
    const { value } = run('[...map(i => 1..3, 1..2)]');
    expect(value.json).toEqual(['List', ['List', 1, 2, 3], ['List', 1, 2, 3]]);
  });
});

describe('a ListJoin snapshots a finite lazy operand (MathJSON)', () => {
  const ce = new ComputeEngine();

  test('a list literal with a spread of a lazy collection', () => {
    const literal = ce.box([
      'List',
      ['Spread', ['Take', ['List', 1, 2, 3, 4], 1]],
      9,
      ['Spread', ['Drop', ['List', 1, 2, 3, 4], 2]],
    ]);
    // The canonical form is the `ListJoin` view; evaluation lists it.
    expect(literal.operator).toBe('ListJoin');
    expect(literal.evaluate().json).toEqual(['List', 1, 9, 3, 4]);
  });

  test('a numeric approximation approximates the listed elements', () => {
    const e = ce.box([
      'ListJoin',
      ['Map', ['Function', ['Sqrt', 'x'], 'x'], ['List', 1, 4]],
      ['List', 0],
    ]);
    expect(e.evaluate().json).toEqual(['List', 1, 2, 0]);
    const n = ce
      .box([
        'ListJoin',
        ['Map', ['Function', ['Sqrt', 'x'], 'x'], ['List', 2]],
        ['List', 0],
      ])
      .N();
    expect(n.operator).toBe('List');
    expect(n.ops![0].re).toBeCloseTo(Math.SQRT2, 12);
  });

  test('a view larger than the collection size bound stays lazy', () => {
    const e = ce.box(['ListJoin', ['Range', 1, 20000], ['List', 0]]);
    expect(e.evaluate().operator).toBe('ListJoin');
  });

  test('operands that are together over the size bound run no callback', () => {
    // Each `Map` has two elements, in the bound of three, but together they
    // have four. The view is kept before any walk, so the callback does not
    // run for a snapshot that would be abandoned.
    const small = new ComputeEngine();
    small.maxCollectionSize = 3;
    let calls = 0;
    small.declare('Tick', {
      signature: '(number) -> number',
      pure: false,
      evaluate: ([x]) => {
        calls += 1;
        return x;
      },
    });
    const value = small
      .box([
        'ListJoin',
        ['Map', 'Tick', ['List', 1, 2]],
        ['Map', 'Tick', ['List', 3, 4]],
      ])
      .evaluate();
    expect(value.operator).toBe('ListJoin');
    expect(calls).toBe(0);
  });

  test('an operand that is not a collection now stays a view', () => {
    const e = ce.box(['ListJoin', 'q', ['List', 0]]);
    expect(e.evaluate().json).toEqual(['ListJoin', 'q', ['List', 0]]);
  });

  test('an absent operand still makes the literal absent', () => {
    const e = ce.box(['ListJoin', 'Missing', ['List', 0]]);
    expect(e.evaluate().json).toBe('Missing');
  });

  test('the async route lists the operands too', async () => {
    const e = ce.box(['ListJoin', ['Take', ['List', 1, 2, 3], 2], ['List', 0]]);
    expect((await e.evaluateAsync()).json).toEqual(['List', 1, 2, 0]);
  });

  test('an explicit Join stays lazy', () => {
    const e = ce.box(['Join', ['Take', ['List', 1, 2, 3], 2], ['List', 9]]);
    expect(e.evaluate().operator).toBe('Join');
  });
});
