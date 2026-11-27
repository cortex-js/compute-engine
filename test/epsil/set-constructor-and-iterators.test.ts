import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { executeEpsil } from '../../src/epsil/execute-epsil';
import { serializeEpsil } from '../../src/epsil/serialize-epsil';

/** The value of an Epsil program in the Epsil spelling, or its diagnostic
 * codes when it has an error. */
function run(source: string): string {
  const ce = new ComputeEngine();
  const result = executeEpsil(ce, source);
  const errors = result.diagnostics.filter((d) => d.severity === 'error');
  if (errors.length > 0)
    return `diagnostics: ${errors.map((d) => d.message[0]).join(', ')}`;
  return serializeEpsil(result.value.json);
}

describe('A SET IS WRITTEN WITH ITS CONSTRUCTOR', () => {
  test('set(…) builds a set', () => {
    expect(run('set(3, 1, 3)')).toBe('set(1, 3)');
    expect(run('set()')).toBe('set()');
    expect(run('3 in set(1, 2, 3)')).toBe('True');
  });

  test('a spread into set(…) is the union of the elements', () => {
    expect(
      run('let a = set(1, 2)\nlet b = set(2, 3)\nset(...a, ...b)')
    ).toBe('set(1, 2, 3)');
    expect(run('let xs = [1, 2, 2]\nset(...xs)')).toBe('set(1, 2)');
  });

  test('a set comprehension is setFrom of a list comprehension', () => {
    expect(run('setFrom([x % 3 for x in 1..10])')).toBe('set(0, 1, 2)');
  });

  test('a set pattern is the operator pattern Set(…)', () => {
    expect(run('match set(1, 2) {\n  Set(a, b) => a + b\n  _ => 0\n}')).toBe(
      '3'
    );
  });

  test('braces make a dictionary: {} is the empty dictionary', () => {
    expect(run('{}')).toBe('{}');
    expect(run('let d = {a -> 1}\n{...d, b -> 2}')).toBe(
      '{"a" -> 1, "b" -> 2}'
    );
    expect(run('let d = {a -> 1}\nlet e = {b -> 2}\n{...d, ...e}')).toBe(
      '{"a" -> 1, "b" -> 2}'
    );
    expect(run('function f(o = {}) { o }\nf()')).toBe('{}');
  });

  test('a set written with braces is an error', () => {
    expect(run('{1, 2}')).toBe('diagnostics: brace-set-literal');
    expect(run('{x for x in [1, 2]}')).toBe('diagnostics: brace-set-literal');
    expect(run('match set(1) {\n  {a} => a\n  _ => 0\n}')).toBe(
      'diagnostics: brace-set-literal'
    );
  });
});

describe('AN INDEXING SET IS AN `in` CLAUSE OR A TUPLE', () => {
  test('table takes an index over a collection', () => {
    expect(run('table(k^2, k in 1..5)')).toBe('[1, 4, 9, 16, 25]');
    // The order and the repetitions of a list are kept.
    expect(run('table(k^2, k in [3, 1, 3])')).toBe('[9, 1, 9]');
    // Over a set, the table is still a list: equal values are not merged.
    expect(run('table(k % 2, k in set(1, 2, 3))')).toBe('[1, 0, 1]');
  });

  test('several iterators give a nested list, the first outermost', () => {
    expect(run('table(i * j, i in 1..3, j in 1..i)')).toBe(
      '[[1], [2, 4], [3, 6, 9]]'
    );
    // An `in` iterator and an iterator tuple in one table.
    expect(run('table(i * j, i in 1..2, (j, 3))')).toBe('[[1, 2, 3], [2, 4, 6]]');
    expect(run('table(i * j, (i, 2), j in [10, 20])')).toBe(
      '[[10, 20], [20, 40]]'
    );
  });

  test('a condition on the index filters the table', () => {
    const ce = new ComputeEngine();
    const t = ce.box([
      'Table',
      ['Power', 'k', 2],
      ['Element', 'k', ['Range', 1, 'n'], ['Greater', 'k', 2]],
    ]);
    expect(t.subs({ n: 5 }).evaluate().toString()).toBe('[9,16,25]');
  });

  test('a table over an `in` iterator compiles', () => {
    const ce = new ComputeEngine();
    const result = compile(
      ce.box([
        'Table',
        ['Multiply', 'i', 'j'],
        ['Element', 'i', ['Range', 1, 'n']],
        ['Element', 'j', ['Range', 1, 'i']],
      ]),
      { to: 'javascript', fallback: false } as any
    );
    expect(result.success).toBe(true);
    expect(result.run!({ n: 3 })).toEqual([[1], [2, 4], [3, 6, 9]]);
  });

  test('sum and product take the same iterators', () => {
    expect(run('sum(k, k in 1..4)')).toBe('10');
    expect(run('product(k, k in [2, 3], j in 1..2)')).toBe('36');
    expect(run('sum(k, (k, 1, 9, 2))')).toBe('25');
  });

  test('a set is not an iterator: its elements have no order', () => {
    const ce = new ComputeEngine();
    const value = (json: any) => ce.box(json).evaluate().toString();
    expect(value(['Sum', 'k', ['Set', 'k', 1, 4]])).toContain('Error');
    expect(value(['Product', 'k', ['Set', 'k', 1, 4]])).toContain('Error');
    // Not an indefinite integral: the bounds are not dropped.
    expect(value(['Integrate', 'x', ['Set', 'x', 0, 1]])).toContain('Error');
    expect(ce.box(['Table', 'k', ['Set', 'k', 1, 4]]).isValid).toBe(false);
  });
});
