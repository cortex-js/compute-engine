import { ComputeEngine } from '../../src/compute-engine';
import { executeEpsil } from '../../src/epsil/execute-epsil';
import type { Expression, MathJsonExpression } from '../../src/compute-engine';
import { isFunction } from '../../src/compute-engine/boxed-expression/type-guards';

// CE-1827: a loop reads the collection of a clause once, before the first
// pass, so the collection is outside the scope of the index of its own
// clause. In `Loop(body, Element(n, Range(1, n)))`, the `n` of the range is
// the `n` of the enclosing scope, as the bound of `Sum(n, Limits(n, 1, n))`
// is. The same holds for `Comprehension`, for the parallel forms, and for
// the leaves of a destructuring pattern.

function epsil(source: string): unknown {
  return executeEpsil(new ComputeEngine(), source).value?.json;
}

/** The elements of the list that `expr` evaluates to. */
function elements(expr: Expression): unknown[] {
  return [...expr.evaluate().each()].map((x) => x.json);
}

const SQUARES: MathJsonExpression = [
  'Comprehension',
  ['Multiply', 2, 'n'],
  ['Element', 'n', ['Range', 1, 'n']],
];

describe('CE-1827 the collection of a loop clause is outside the scope of its index', () => {
  test('a `for` loop over a range that names the loop variable', () => {
    expect(epsil('let n = 3\nlet s = 0\nfor n in 1..n { s += n }\n[s, n]')).toEqual(
      ['List', 6, 3]
    );
    // The loop in the body reads the `n` of the outer loop.
    expect(
      epsil('let n = 3\nlet t = 0\nfor n in 1..n { for n in 1..n { t += n } }\nt')
    ).toBe(10);
    expect(
      epsil('let n = 3\nlet s = 0\nparallel for n in 1..n { s += n }\ns')
    ).toBe(6);
  });

  test('a loop over the variable of its own name', () => {
    expect(
      epsil('let xs = [1, 2, 3]\nlet s = 0\nfor xs in xs { s += xs }\ns')
    ).toBe(6);
    expect(epsil('let xs = [[1, 2], [3]]\n[xs for xs in xs]')).toEqual([
      'List',
      ['List', 1, 2],
      ['List', 3],
    ]);
  });

  test('a comprehension, with a guard, nested and in a function', () => {
    expect(epsil('let n = 3\n[n for n in 1..n]')).toEqual(['List', 1, 2, 3]);
    // The guard reads the index.
    expect(epsil('let n = 3\n[n for n in 1..n if n > 1]')).toEqual([
      'List',
      2,
      3,
    ]);
    expect(epsil('let n = 3\n[[n for n in 1..n] for n in 1..n]')).toEqual([
      'List',
      ['List', 1],
      ['List', 1, 2],
      ['List', 1, 2, 3],
    ]);
    // The collection reads the variable at the time of the call.
    expect(
      epsil('let n = 3\nlet g = () => [n for n in 1..n]\nn = 2\ng()')
    ).toEqual(['List', 1, 2]);
  });

  test('the name is a parameter of the enclosing function', () => {
    expect(
      epsil('function f(n) { let s = 0; for n in 1..n { s += n }; s }\nf(4)')
    ).toBe(10);
    // The use as a collection types the parameter, so the call does not
    // map over the list.
    expect(
      epsil(
        'function f(ys) { let s = 0; for ys in ys { s += ys }; s }\nf([1, 2, 3])'
      )
    ).toBe(6);
  });

  test('a later clause reads the index of an earlier clause', () => {
    // The first `n` is the outer one; `1..n` of the second clause reads the
    // index of the first clause.
    expect(epsil('let n = 2\n[[a, n] for n in 1..n, a in 1..n]')).toEqual([
      'List',
      ['List', 1, 1],
      ['List', 1, 2],
      ['List', 2, 2],
    ]);
    // A clause that binds a name again reads the earlier binding.
    expect(epsil('[n for n in 1..2, n in 1..n]')).toEqual(['List', 1, 1, 2]);
    // The collection of a later clause is outside the scope of its index.
    expect(epsil('let n = 2\n[[a, n] for a in 1..2, n in 1..n]')).toEqual([
      'List',
      ['List', 1, 1],
      ['List', 1, 2],
      ['List', 2, 1],
      ['List', 2, 2],
    ]);
  });

  test('the leaves of a destructuring pattern', () => {
    expect(
      epsil('let p = 10\nlet q = 20\n[p + q for (p, q) in [(1, p), (q, 5)]]')
    ).toEqual(['List', 11, 25]);
  });

  test('the routes ce.box() and ce.function() agree', () => {
    const boxed = new ComputeEngine();
    boxed.assign('n', 3);
    expect(elements(boxed.box(SQUARES))).toEqual([2, 4, 6]);

    const built = new ComputeEngine();
    built.assign('n', 3);
    const raw = (x: MathJsonExpression) => built.box(x, { form: 'raw' });
    expect(
      elements(
        built.function('Comprehension', [
          raw(['Multiply', 2, 'n']),
          raw(['Element', 'n', ['Range', 1, 'n']]),
        ])
      )
    ).toEqual([2, 4, 6]);

    // Canonical operands: the `n` of the range is already the outer one.
    const canonical = new ComputeEngine();
    canonical.assign('n', 3);
    const first = canonical.box(SQUARES);
    if (!isFunction(first)) throw new Error('expected a function expression');
    expect(
      elements(canonical.function('Comprehension', [...first.ops]))
    ).toEqual([2, 4, 6]);
  });

  test('the name in the collection is free in every form', () => {
    for (const form of ['canonical', 'structural', 'raw'] as const) {
      const ce = new ComputeEngine();
      const expr = ce.box(SQUARES, { form });
      expect([form, expr.freeVariables]).toEqual([form, ['n']]);
      // A substitution replaces the name in the collection, not the index.
      expect([form, expr.subs({ n: 3 }).json]).toEqual([
        form,
        [
          'Comprehension',
          ['Multiply', 2, 'n'],
          ['Element', 'n', ['Range', 1, 3]],
        ],
      ]);
    }
    const ce = new ComputeEngine();
    expect(elements(ce.box(SQUARES).subs({ n: 3 }))).toEqual([2, 4, 6]);
    const pattern = ce.box([
      'Comprehension',
      ['Add', 'p', 'q'],
      [
        'Element',
        ['Tuple', 'p', 'q'],
        ['List', ['Tuple', 1, 'p'], ['Tuple', 'q', 5]],
      ],
    ]);
    expect(pattern.freeVariables).toEqual(['p', 'q']);
    expect(elements(pattern.subs({ p: 10, q: 20 }))).toEqual([11, 25]);
  });

  test('a function literal over the name', () => {
    const ce = new ComputeEngine();
    const f = ce.box(['Function', SQUARES, 'n']);
    expect(elements(ce.function('Apply', [f, ce.number(3)]))).toEqual([
      2, 4, 6,
    ]);
  });

  test('a quantifier keeps its variable in scope in its whole clause', () => {
    const ce = new ComputeEngine();
    const forAll = ce.box([
      'ForAll',
      ['Element', 'n', ['Range', 1, 'n']],
      ['Greater', 'n', 0],
    ]);
    expect(forAll.freeVariables).toEqual([]);
  });
});
