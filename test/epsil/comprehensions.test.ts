import { ComputeEngine } from '../../src/compute-engine';
import type { MathJsonExpression } from '../../src/math-json/types';
import { executeEpsil } from '../../src/epsil/execute-epsil';
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
    expect(run('{x % 3 for x in 1..10}')).toBe('Set(1, 2, 0)');
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
