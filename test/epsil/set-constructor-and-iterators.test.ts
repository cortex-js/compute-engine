import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { executeEpsil } from '../../src/epsil/execute-epsil';
import { parseEpsil } from '../../src/epsil/parse-epsil';
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

  test('a library spelling at a pattern head names the library operator', () => {
    expect(run('match set(1, 2) {\n  set(a, b) => a + b\n  _ => 0\n}')).toBe(
      '3'
    );
    expect(run('match Sin(1) {\n  sin(a) => a\n  _ => 0\n}')).toBe('1');
    // The MathJSON name still matches.
    expect(run('match set(1, 2) {\n  Set(a, b) => a + b\n  _ => 0\n}')).toBe(
      '3'
    );
    // A name of the program shadows the spelling, as in an expression, and
    // the verbatim form names the raw symbol.
    expect(
      run('function sin(x) { x }\nmatch Sin(1) {\n  sin(a) => a\n  _ => 0\n}')
    ).toBe('0');
    expect(run('match Set(1, 2) {\n  `set`(a, b) => a + b\n  _ => 0\n}')).toBe(
      '0'
    );
    // A set pattern prints with the spelling, and reads back the same.
    const source = 'match s {\n  set(a, b) => a + b\n  _ => 0\n}';
    expect(run(`let s = set(1, 2)\n${source}`)).toBe('3');
    expect(
      serializeEpsil([
        'Match',
        's',
        ['MatchCase', ['Set', '_a', '_b'], ['Add', 'a', 'b']],
      ])
    ).toContain('set(a, b) =>');
    // With `set` bound by the program, or MathJSON names asked for, the
    // pattern keeps the MathJSON name, so it still matches a set.
    const bound = serializeEpsil([
      'Block',
      ['Declare', 'set', "'integer'"],
      ['Match', 's', ['MatchCase', ['Set', '_a', '_b'], ['Add', 'a', 'b']]],
    ]);
    expect(bound).toContain('Set(a, b) =>');
    expect(
      serializeEpsil(
        ['Match', 's', ['MatchCase', ['Set', '_a', '_b'], ['Add', 'a', 'b']]],
        { libraryNames: 'mathjson' }
      )
    ).toContain('Set(a, b) =>');
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

  test('`key: value` in braces is an error, read as `key -> value`', () => {
    expect(run('{a: 1}')).toBe('diagnostics: dictionary-arrow-expected');
    const [, diagnostics] = parseEpsil('{"a": 1, b:-2}');
    expect(diagnostics.map((d) => [d.message, d.fixits])).toEqual([
      [['dictionary-arrow-expected'], [[4, 5, ' ->']]],
      [['dictionary-arrow-expected'], [[10, 11, ' -> ']]],
    ]);
    // On compact JSON, the fixit spaces the arrow on both sides, and the
    // fixed text parses.
    const compact = '{"a":1}';
    const [, compactErrors] = parseEpsil(compact);
    const [[start, end, text]] = compactErrors[0].fixits!;
    const fixed = compact.slice(0, start) + text + compact.slice(end);
    expect(fixed).toBe('{"a" -> 1}');
    expect(parseEpsil(fixed)[1]).toEqual([]);
    // A value that binds more loosely than `->` gets parentheses.
    const lambda = '{"f": x => x + 1}';
    const edits = [...parseEpsil(lambda)[1][0].fixits!].sort(
      (a, b) => b[0] - a[0]
    );
    const fixedLambda = edits.reduce(
      (t, [a, b, x]) => t.slice(0, a) + x + t.slice(b),
      lambda
    );
    expect(fixedLambda).toBe('{"f" -> (x => x + 1)}');
    expect(parseEpsil(fixedLambda)[1]).toEqual([]);
    // A Python dictionary comprehension gets the one error.
    const [comprehension, errors] = parseEpsil('{k: 2 * k for k in ks}');
    expect(errors.map((d) => d.message[0])).toEqual([
      'dictionary-arrow-expected',
    ]);
    expect(serializeEpsil(comprehension!)).toBe('{k -> 2k for k in ks}');
    // The entries are read as written with `->`.
    const ce = new ComputeEngine();
    expect(String(executeEpsil(ce, '{"a": 1, b: 2}').value)).toBe(
      String(executeEpsil(ce, '{"a" -> 1, b -> 2}').value)
    );
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

  test('an `in` iterator of a call takes a condition', () => {
    expect(run('sum(k, k in 1..10 if isPrime(k))')).toBe('17');
    expect(run('product(k, k in 1..6 if k % 2 == 0)')).toBe('48');
    expect(run('table(k^2, k in 1..10 if k > 7)')).toBe('[64, 81, 100]');
    expect(run('table(i * j, i in 1..3, j in 1..3 if j != i)')).toBe(
      '[[2, 3], [2, 6], [3, 6]]'
    );
    // The guarded clause prints as written, and reads back the same.
    const [program] = parseEpsil('sum(k, k in 1..10 if isPrime(k))');
    expect(serializeEpsil(program!)).toBe('sum(k, k in 1 .. 10 if isPrime(k))');
    // Outside a whole argument of a call, a conditional still needs its
    // `else`: at the top level, in a lambda body, in a named argument.
    for (const source of [
      'let x = 1 in [1] if true',
      'map([1], x => x in [1] if true)',
      'f(n: k in [1] if true)',
    ]) {
      const [, diagnostics] = parseEpsil(source);
      expect(diagnostics.map((d) => d.message[0])).toContain(
        'conditional-else-expected'
      );
    }
    // A guarded clause that is not a call argument prints as a call, which
    // reads back the same.
    expect(serializeEpsil(['List', ['Element', 'k', 'xs', 'p']])).toBe(
      '[Element(k, xs, p)]'
    );
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
