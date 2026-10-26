import { ComputeEngine } from '../../src/compute-engine';
import type { MathJsonExpression } from '../../src/math-json/types';
import { executeEpsil, executeEpsilAsync } from '../../src/epsil/execute-epsil';
import { parseEpsil } from '../../src/epsil/parse-epsil';
import { serializeEpsil } from '../../src/epsil/serialize-epsil';
import { invalidEpsil, validEpsil } from '../utils';

//
// Comprehensions: a trailing `for` clause inside a list or brace literal.
//
//   [body for x in xs if cond, y in ys]   → Comprehension(body, Element(x, xs, cond), Element(y, ys))
//   {body for …}                          → SetFrom(Comprehension(…))
//   {k -> v for …}                        → DictionaryFrom(Comprehension(Tuple(k, v), …))
//
// The bracket picks the collection kind, the clause makes it a comprehension,
// and a literal with no clause is the degenerate case. A guard is the third
// operand of its `Element` clause, the form `Sum` and `Product` take.
//

/** Run an Epsil program against a fresh engine. */
function run(source: string): string {
  const ce = new ComputeEngine();
  const parseLatex = (latex: string): MathJsonExpression =>
    ce.parse(latex).json;
  const result = executeEpsil(ce, source, { parseLatex });
  if (result.diagnostics.length > 0)
    return `diagnostics: ${result.diagnostics.map((d) => d.message).join(' ')}`;
  return result.value?.toString() ?? 'Nothing';
}

/** Parse, serialize, and assert the spelling comes back unchanged. */
function roundTrip(source: string): void {
  const [expr, errors] = parseEpsil(source);
  expect(errors).toHaveLength(0);
  expect(serializeEpsil(expr!)).toBe(source);
}

describe('EPSIL COMPREHENSIONS — parse', () => {
  test('list comprehension, one clause', () => {
    expect(validEpsil('[x^2 for x in xs]')).toStrictEqual([
      'Comprehension',
      ['Power', 'x', 2],
      ['Element', 'x', 'xs'],
    ]);
  });

  test('a guard is the third operand of its clause', () => {
    expect(validEpsil('[x for x in xs if x > 0]')).toStrictEqual([
      'Comprehension',
      'x',
      ['Element', 'x', 'xs', ['Greater', 'x', 0]],
    ]);
  });

  test('several clauses, comma-separated, each with its own guard', () => {
    expect(
      validEpsil('[(x, y) for x in 1..3 if x > 1, y in 1..x if y < x]')
    ).toStrictEqual([
      'Comprehension',
      ['Tuple', 'x', 'y'],
      ['Element', 'x', ['Range', 1, 3], ['Greater', 'x', 1]],
      ['Element', 'y', ['Range', 1, 'x'], ['Less', 'y', 'x']],
    ]);
  });

  test('a tuple destructuring binding', () => {
    expect(validEpsil('[p + q for (p, q) in pairs]')).toStrictEqual([
      'Comprehension',
      ['Add', 'p', 'q'],
      ['Element', ['Tuple', 'p', 'q'], 'pairs'],
    ]);
  });

  test('set comprehension is SetFrom of the comprehension', () => {
    expect(validEpsil('{x % 3 for x in xs}')).toStrictEqual([
      'SetFrom',
      ['Comprehension', ['Mod', 'x', 3], ['Element', 'x', 'xs']],
    ]);
  });

  test('dictionary comprehension is DictionaryFrom of (key, value) pairs', () => {
    expect(validEpsil('{k -> v for (k, v) in pairs}')).toStrictEqual([
      'DictionaryFrom',
      [
        'Comprehension',
        ['Tuple', 'k', 'v'],
        ['Element', ['Tuple', 'k', 'v'], 'pairs'],
      ],
    ]);
  });

  test('the dictionary key is an expression, not a literal name', () => {
    // In a literal `{one -> 1}` the unquoted key becomes the string "one";
    // in a comprehension the key is evaluated, so the bound name stays a
    // symbol.
    expect(validEpsil('{name -> 1 for name in names}')).toStrictEqual([
      'DictionaryFrom',
      ['Comprehension', ['Tuple', 'name', 1], ['Element', 'name', 'names']],
    ]);
  });

  test('a conditional body reads before the clause', () => {
    expect(validEpsil('[x if x > 0 else 0 for x in xs]')).toStrictEqual([
      'Comprehension',
      ['If', ['Greater', 'x', 0], 'x', 0],
      ['Element', 'x', 'xs'],
    ]);
  });

  test('a second `in` in the collection is the membership operator', () => {
    expect(validEpsil('[x for x in a in b]')).toStrictEqual([
      'Comprehension',
      'x',
      ['Element', 'x', ['Element', 'a', 'b']],
    ]);
  });

  test('the literals are unchanged', () => {
    expect(validEpsil('[1, 2, 3]')).toStrictEqual(['List', 1, 2, 3]);
    expect(validEpsil('{1, 2}')).toStrictEqual(['Set', 1, 2]);
    expect(validEpsil('{}')).toStrictEqual(['Set']);
    expect(validEpsil('{->}')).toStrictEqual(['Dictionary']);
    expect(validEpsil('{...a, ...b}')).toStrictEqual([
      'Set',
      ['Spread', 'a'],
      ['Spread', 'b'],
    ]);
  });
});

describe('EPSIL COMPREHENSIONS — diagnostics', () => {
  test('a `for` after a second element is not a comprehension', () => {
    expect(invalidEpsil('[a, b for x in xs]')).toMatchInlineSnapshot(`
      [
        Error,
        [
          String,
          [
            closing-bracket-expected,
            ],
          ],
          [
            unexpected-symbol,
            for,
          ],
        ],
      ]
    `);
  });

  test('a pipeline in the collection must be parenthesized', () => {
    expect(invalidEpsil('[x for x in xs |> sort]')).toMatchInlineSnapshot(`
      [
        Error,
        [
          String,
          [
            unexpected-symbol,
            |>,
          ],
        ],
      ]
    `);
    expect(validEpsil('[x for x in (xs |> sort)]')).toStrictEqual([
      'Comprehension',
      'x',
      ['Element', 'x', ['Pipe', 'xs', 'sort']],
    ]);
  });

  test('a missing guard expression', () => {
    expect(invalidEpsil('[x for x in xs if]')).toMatchInlineSnapshot(`
      [
        Error,
        [
          String,
          [
            expression-expected,
          ],
        ],
      ]
    `);
  });

  test('a missing binding', () => {
    expect(invalidEpsil('[x for in xs]')).toMatchInlineSnapshot(`
      [
        Error,
        [
          String,
          [
            unexpected-symbol,
            xs,
          ],
        ],
      ]
    `);
  });

  test('a literal word cannot be the binding', () => {
    expect(invalidEpsil('[x for oo in xs]')).toMatchInlineSnapshot(`
      [
        Error,
        [
          String,
          [
            reserved-word,
            oo,
          ],
        ],
      ]
    `);
  });
});

describe('EPSIL COMPREHENSIONS — evaluation', () => {
  test('a list comprehension with a guard', () => {
    expect(run('[x^2 for x in 1..10 if x % 2 == 1]')).toBe('[1,9,25,49,81]');
  });

  test('a comprehension is lazy: indexing materializes one element', () => {
    expect(run('[x for x in 1..5 if x > 2][1]')).toBe('3');
    expect(run('length([x for x in 1..100 if x % 7 == 0])')).toBe('14');
  });

  test('a later clause sees an earlier binding', () => {
    expect(run('[(x, y) for x in 1..3, y in 1..x]')).toBe(
      '[(1, 1),(2, 1),(2, 2),(3, 1),(3, 2),(3, 3)]'
    );
  });

  test('a guard on each clause', () => {
    expect(
      run('[(x, y) for x in 1..4 if x > 2, y in 1..x if y % 2 == 0]')
    ).toBe('[(3, 2),(4, 2),(4, 4)]');
  });

  test('a destructuring binding with a guard', () => {
    expect(run('[p + q for (p, q) in [(1, 2), (-3, 4)] if p > 0]')).toBe('[3]');
  });

  test('a set comprehension deduplicates', () => {
    expect(run('{x % 3 for x in 1..10}')).toBe('Set(0, 1, 2)');
  });

  test('a dictionary comprehension over (key, value) pairs', () => {
    expect(run('{k -> v for (k, v) in [("a", 1), ("b", 2)]}')).toBe(
      '{"a" -> 1, "b" -> 2}'
    );
    expect(run('{s -> length(s) for s in ["ab", "cde"]}')).toBe(
      '{"ab" -> 2, "cde" -> 3}'
    );
  });

  test('a dictionary comprehension needs string keys', () => {
    expect(run('{n -> n^2 for n in 1..3}')).toMatch(/incompatible-type/);
  });

  test('the bound names do not leak', () => {
    expect(run('let x = 100\n[x for x in 1..3]\nx')).toBe('100');
  });

  test('a conditional body', () => {
    expect(run('[x if x > 0 else 0 for x in [-1, 2]]')).toBe('[0,2]');
  });

  test('an undecided guard excludes the element', () => {
    // `a` has no value: `x > a` cannot decide, and an element the guard cannot
    // keep is not in the comprehension.
    expect(run('[x for x in 1..3 if x > a]')).toBe('[]');
  });
});

//
// The result of a program is a value: a finite comprehension is a `List`
// (user decision 2026-10-25). These tests read the MathJSON
// of the value, because `toString()` prints the elements of a lazy
// comprehension too and cannot show the difference.
//

/** The MathJSON of the value of `source`, on the synchronous route and on
 * the asynchronous route, each with a fresh engine. */
async function resultJson(source: string): Promise<[string, string]> {
  const ce = new ComputeEngine();
  const parseLatex = (latex: string): MathJsonExpression =>
    ce.parse(latex).json;
  const sync = executeEpsil(ce, source, { parseLatex });
  expect(sync.diagnostics).toEqual([]);
  const ce2 = new ComputeEngine();
  const async = await executeEpsilAsync(ce2, source, {
    parseLatex: (latex) => ce2.parse(latex).json,
  });
  expect(async.diagnostics).toEqual([]);
  return [JSON.stringify(sync.value.json), JSON.stringify(async.value.json)];
}

describe('EPSIL COMPREHENSIONS — the result is a list', () => {
  test.each([
    ['[k * 2 for k in 1..3]', '["List",2,4,6]'],
    ['[do { k * 2 } for k in 1..3]', '["List",2,4,6]'],
    ['let xs = [do { k * 2 } for k in 1..3]', '["List",2,4,6]'],
    ['let xs = [do { k * 2 } for k in 1..3]; xs', '["List",2,4,6]'],
    [
      'let xs = [if k > 1 { k } else { 0 } for k in 1..3]; xs',
      '["List",0,2,3]',
    ],
    ['let xs = [do { let y = k * 2; y } for k in 1..3]; xs', '["List",2,4,6]'],
    ['[k for k in 1..4 if k % 2 == 0]', '["List",2,4]'],
    ['[do { t = i; t } for i in 1..3, j in 1..i]', '["List",1,2,2,3,3,3]'],
    // A dependent clause with a guard: the bound of the listing is the count
    // of the domains without the guard.
    ['[do { t = i; t } for i in 1..3, j in 1..i if j > 1]', '["List",2,3,3]'],
  ])('%s', async (source, expected) => {
    expect(await resultJson(source)).toEqual([expected, expected]);
  });

  test('an infinite comprehension stays as it is', async () => {
    const [sync, async] = await resultJson('[k for k in 1..oo]');
    expect(sync).toMatch(/^\["Comprehension"/);
    expect(async).toBe(sync);
  });

  test('a list literal lists a comprehension whose body assigns a local', async () => {
    const source =
      'function g() { let xs = [do { t = k * 2; t } for k in 1..3]; xs }\n[g(), g()]';
    const expected = '["List",["List",2,4,6],["List",2,4,6]]';
    expect(await resultJson(source)).toEqual([expected, expected]);
  });

  test('the body is evaluated once for each element', () => {
    const ce = new ComputeEngine();
    const parseLatex = (latex: string): MathJsonExpression =>
      ce.parse(latex).json;
    const value = (source: string): string =>
      JSON.stringify(executeEpsil(ce, source, { parseLatex }).value.json);
    expect(value('let c = 0')).toBe('0');
    expect(value('[do { c = c + 1; c } for i in 1..3, j in 1..i]')).toBe(
      '["List",1,2,3,4,5,6]'
    );
    expect(value('c')).toBe('6');
  });

  test('a guard that reads a value the body changes does not lower the bound', () => {
    // The guard keeps one element for `i = 1` before the body sets `c`, and
    // every element after. The comprehension has 6 elements, more than the
    // budget of 3 elements, so it stays as it is. A bound computed with the
    // guards (3 elements) let the listing emit 6 elements.
    const ce = new ComputeEngine();
    ce.maxCollectionSize = 3;
    const parseLatex = (latex: string): MathJsonExpression =>
      ce.parse(latex).json;
    const source =
      'let c = 0; [do { c = 1; j } for i in 1..3, j in 1..i if j == 1 || c == 1]';
    const result = executeEpsil(ce, source, { parseLatex });
    expect(result.diagnostics).toEqual([]);
    expect(result.value.operator).toBe('Comprehension');
  });

  test('the same comprehension within the budget is listed', async () => {
    const source =
      'let c = 0; [do { c = 1; j } for i in 1..3, j in 1..i if j == 1 || c == 1]';
    const expected = '["List",1,1,2,1,2,3]';
    expect(await resultJson(source)).toEqual([expected, expected]);
  });

  test('a dependent comprehension with an impure guard is listed, and the guard runs once for each combination', () => {
    const ce = new ComputeEngine();
    const parseLatex = (latex: string): MathJsonExpression =>
      ce.parse(latex).json;
    const value = (source: string): string =>
      JSON.stringify(executeEpsil(ce, source, { parseLatex }).value.json);
    expect(value('let calls = 0')).toBe('0');
    value('function keep(j) scope { calls = calls + 1; j > 1 }');
    expect(value('[do { t = i; t } for i in 1..3, j in 1..i if keep(j)]')).toBe(
      '["List",2,3,3]'
    );
    expect(value('calls')).toBe('6');
  });

  test('an impure body and a later domain that reads another symbol: no listing', () => {
    // The body changes `n`, which the domain of the second clause reads, so
    // the domains of the later iterations are not known before the walk.
    const ce = new ComputeEngine();
    const parseLatex = (latex: string): MathJsonExpression =>
      ce.parse(latex).json;
    const result = executeEpsil(
      ce,
      'let n = 1; [do { n = n + 1; j } for i in 1..3, j in 1..n]',
      { parseLatex }
    );
    expect(result.value.operator).toBe('Comprehension');
  });

  test('the bound of the listing does not call the callback of a domain', () => {
    // The domain `filter(1..i, keep)` reads `i` and calls `keep`, which is
    // impure. The comprehension has no bound that is found without a walk,
    // so it stays as it is, and `keep` is not called before the walk.
    const ce = new ComputeEngine();
    const parseLatex = (latex: string): MathJsonExpression =>
      ce.parse(latex).json;
    const run = (source: string) => executeEpsil(ce, source, { parseLatex });
    run('let calls = 0');
    run('function keep(j) scope { calls = calls + 1; j > 0 }');
    const result = run('[i for i in 1..3, j in filter(1..i, keep)]');
    expect(result.value.operator).toBe('Comprehension');
    expect(JSON.stringify(run('calls').value.json)).toBe('0');
  });

  test('a `let` of a comprehension does not call the callback of a domain', () => {
    // The assignment asks whether the value is a finite collection that can
    // be walked. That test is read from the form of the domains: `1..i` is
    // finite for each `i` of `1..3`, and so is a filter of it. It does not
    // walk the domains, so `keep` is not called.
    const ce = new ComputeEngine();
    const parseLatex = (latex: string): MathJsonExpression =>
      ce.parse(latex).json;
    const run = (source: string) => executeEpsil(ce, source, { parseLatex });
    run('let calls = 0');
    run('function keep(j) scope { calls = calls + 1; j > 0 }');
    run('let r = [i for i in 1..3, j in filter(1..i, keep)]');
    expect(JSON.stringify(run('calls').value.json)).toBe('0');
    const r = run('r').value;
    expect(r.operator).toBe('Comprehension');
    expect(r.isFiniteCollection).toBe(true);
    expect(JSON.stringify(run('calls').value.json)).toBe('0');
    // The walk calls `keep` once for each element of each domain, and the
    // count agrees with the walk.
    expect([...r.each()].map((x) => x.toString())).toEqual([
      '1',
      '2',
      '2',
      '3',
      '3',
      '3',
    ]);
    expect(JSON.stringify(run('calls').value.json)).toBe('6');
    expect(r.count).toBe(6);
  });

  test('a guard that gives an error before an empty clause gives error cells', () => {
    // A failed guard gives an error cell at that prefix, and the walk does
    // not visit the later clauses. So the empty last clause does not make
    // the count 0.
    const ce = new ComputeEngine();
    const parseLatex = (latex: string): MathJsonExpression =>
      ce.parse(latex).json;
    const run = (source: string) => executeEpsil(ce, source, { parseLatex });
    run('function g(x) { 1/x }');
    run('function bad(i) { g("a") > i }');
    const c = run('[j for i in 1..3 if bad(i), j in []]').value;
    const cells = [...c.each()];
    expect(cells.length).toBe(3);
    expect(cells.every((cell) => cell.operator === 'Error')).toBe(true);
    expect(c.count).toBe(3);
    expect(c.isEmptyCollection).toBe(false);
    expect(c.isFiniteCollection).toBe(true);
  });

  test('an impure guard and a later domain that reads another symbol: no listing', () => {
    // The guard appends to `xs`, which the domain of the second clause
    // reads, so the comprehension has 2 + 3 + 4 = 9 elements, not the
    // 3 × 1 that the domains give before the walk.
    const ce = new ComputeEngine();
    ce.maxCollectionSize = 5;
    const parseLatex = (latex: string): MathJsonExpression =>
      ce.parse(latex).json;
    const run = (source: string) => executeEpsil(ce, source, { parseLatex });
    run('let xs = [1]');
    run('function grow() scope { xs = [...xs, 0]; true }');
    const result = run('[j for i in 1..3 if grow(), j in xs]');
    expect(result.value.operator).toBe('Comprehension');
  });

  test('the bound of the listing counts the error cells of a destructuring index', () => {
    // The elements `5` and `6` do not match the pattern `(p, q)`: each one
    // gives an error cell, and the walk does not read the empty domain of
    // the second clause for them. The comprehension has 2 elements, not the
    // 4 × 0 that the domains give.
    const source = '[j for (p, q) in [(1, 2), 5, (3, 4), 6], j in take(1..3, 0)]';
    const value = (max: number) => {
      const ce = new ComputeEngine();
      ce.maxCollectionSize = max;
      return executeEpsil(ce, source, {
        parseLatex: (latex) => ce.parse(latex).json,
      }).value;
    };
    // Over the budget of 1 element: the comprehension stays as it is.
    expect(value(1).operator).toBe('Comprehension');
    const listed = value(2);
    expect(listed.operator).toBe('List');
    expect(listed.nops).toBe(2);
    expect(listed.ops!.every((cell) => cell.operator === 'Error')).toBe(true);
  });

  test('a failure in a body statement whose value is discarded is reported', async () => {
    // As for the same statement in a `do` block that is not listed.
    const ce = new ComputeEngine();
    const parseLatex = (latex: string): MathJsonExpression =>
      ce.parse(latex).json;
    const listed = executeEpsil(
      ce,
      '[do { let ignored = [RuntimeError("bad")]; k } for k in 1..3]',
      { parseLatex }
    );
    expect(JSON.stringify(listed.value.json)).toBe('["List",1,2,3]');
    const ce2 = new ComputeEngine();
    const single = executeEpsil(
      ce2,
      'do { let ignored = [RuntimeError("bad")]; 3 }',
      { parseLatex: (latex) => ce2.parse(latex).json }
    );
    expect(listed.diagnostics.map((d) => d.message)).toEqual(
      single.diagnostics.map((d) => d.message)
    );
    expect(listed.diagnostics.map((d) => d.message)).toEqual([
      ['runtime-error', 'bad', '', 'bad'],
    ]);
    // The asynchronous route reports it too.
    const ce3 = new ComputeEngine();
    const async = await executeEpsilAsync(
      ce3,
      '[do { let ignored = [RuntimeError("bad")]; k } for k in 1..3]',
      { parseLatex: (latex) => ce3.parse(latex).json }
    );
    expect(async.diagnostics.map((d) => d.message)).toEqual([
      ['runtime-error', 'bad', '', 'bad'],
    ]);
  });
});

describe('EPSIL COMPREHENSIONS — serialization', () => {
  test('the bracket forms round-trip', () => {
    roundTrip('[x ^ 2 for x in xs if x % 2 == 1]');
    roundTrip('[(x, y) for x in xs, y in ys]');
    roundTrip('[p + q for (p, q) in pairs if p > 0]');
    roundTrip('{x % 3 for x in xs}');
    roundTrip('{k -> v for (k, v) in pairs}');
    roundTrip('[x if x > 0 else 0 for x in xs]');
  });

  test('a loose operator in a clause is parenthesized', () => {
    roundTrip('[x for x in (xs |> sort)]');
    roundTrip('[x for x in (xs ?? []) if (x > 0 if flag else y > 0)]');
  });

  test('other SetFrom and DictionaryFrom shapes keep the call form', () => {
    expect(serializeEpsil(['SetFrom', 'xs'])).toBe('setFrom(xs)');
    expect(serializeEpsil(['SetFrom', 'xs', 'ys'])).toBe('setFrom(xs, ys)');
    expect(serializeEpsil(['DictionaryFrom', 'pairs'])).toBe(
      'dictionaryFrom(pairs)'
    );
    // A dictionary comprehension whose body is not a pair.
    expect(
      serializeEpsil([
        'DictionaryFrom',
        ['Comprehension', 'p', ['Element', 'p', 'pairs']],
      ])
    ).toBe('dictionaryFrom([p for p in pairs])');
  });

  test("the engine's set-builder prints as a set comprehension", () => {
    // `["Set", body, ["Element", v, domain, cond?]]` with `v` in the body is
    // the engine's set-builder (form A of `parseSetComprehension`); its
    // literal spelling `{body, v in domain}` reads as a two-element set.
    expect(
      serializeEpsil(['Set', ['Power', 'x', 2], ['Element', 'x', 'xs']])
    ).toBe('{x ^ 2 for x in xs}');
    expect(
      serializeEpsil([
        'Set',
        ['Multiply', 2, 'k'],
        ['Element', 'k', 'S', ['Greater', 'k', 2]],
      ])
    ).toBe('{2k for k in S if k > 2}');
    // The reprint re-parses to the same set, as `SetFrom(Comprehension(…))`.
    expect(validEpsil('{x^2, x in xs}')).toStrictEqual([
      'Set',
      ['Power', 'x', 2],
      ['Element', 'x', 'xs'],
    ]);
    expect(serializeEpsil(parseEpsil('{x^2, x in xs}')[0]!)).toBe(
      '{x ^ 2 for x in xs}'
    );
    // A domain that names the index reads the ENCLOSING variable in the
    // set-builder; a comprehension would capture it, so the literal stays.
    expect(
      serializeEpsil(['Set', 'n', ['Element', 'n', ['Range', 1, 'n']]])
    ).toBe('{n, n in Range(1, n)}');
    // A two-element set whose membership does not bind a name of the body
    // stays a literal.
    expect(serializeEpsil(['Set', 'a', ['Element', 'b', 'c']])).toBe(
      '{a, b in c}'
    );
    expect(serializeEpsil(['Set', 1, 2])).toBe('{1, 2}');
  });

  test('a comprehension whose clause is not an Element keeps the call form', () => {
    expect(serializeEpsil(['Comprehension', 'x', 'xs'])).toBe(
      'Comprehension(x, xs)'
    );
  });
});
