import { ComputeEngine } from '../../src/compute-engine';
import { isDictionary } from '../../src/compute-engine/boxed-expression/type-guards';

/**
 * `has()` is the symbol-occurrence test on every expression, dictionaries
 * included; `hasKey()` is the key test of a dictionary (user decision
 * 2026-10-22).
 *
 * `Expression.has(v)` answers "does the symbol `v` (or a function expression
 * with the operator `v`) occur in this expression?". Before this decision, a
 * dictionary overrode `has()` with a KEY test: for `{"a" -> u}`, `has("u")`
 * was `false` and `has("a")` was `true`. Every walk in the engine that asks
 * whether an expression mentions a symbol (free-variable screens,
 * simplification and compilation guards) calls `has()` on each node it
 * reaches, so a walk that reached a dictionary silently asked for a key and
 * missed a symbol in a value.
 *
 * Now `has()` on a dictionary looks in the VALUES of the entries. A key is a
 * string, not a symbol, so a key never matches. The key test is the new
 * method `hasKey(key)` of `DictionaryInterface`.
 */
describe('dictionary: has() is the symbol test, hasKey() is the key test', () => {
  const ce = new ComputeEngine();

  test('has() finds a symbol in a value', () => {
    const d = ce.box({ dict: { a: { sym: 'x' }, b: 2 } });
    expect(isDictionary(d)).toBe(true);
    expect(d.has('x')).toBe(true);
    expect(d.has('y')).toBe(false);
    // An array asks for any of the names.
    expect(d.has(['y', 'x'])).toBe(true);
    expect(d.has(['y', 'z'])).toBe(false);
  });

  test('has() finds a symbol or an operator inside a value expression', () => {
    const d = ce.box({ dict: { a: { fn: ['Sin', ['Add', 'y', 1]] } } });
    expect(d.has('y')).toBe(true);
    expect(d.has('Sin')).toBe(true);
    expect(d.has('Cos')).toBe(false);
  });

  test('has() finds a symbol in a nested dictionary', () => {
    const d = ce.box({
      dict: { outer: { dict: { inner: { sym: 'z' } } } },
    });
    expect(d.has('z')).toBe(true);
    // Neither key is a symbol.
    expect(d.has('outer')).toBe(false);
    expect(d.has('inner')).toBe(false);
  });

  test('has() finds a symbol in a list of dictionaries', () => {
    const l = ce.box([
      'List',
      { dict: { a: 1 } },
      { dict: { b: { sym: 'w' } } },
    ]);
    expect(l.has('w')).toBe(true);
    expect(l.has('b')).toBe(false);
  });

  test('a string value is not a symbol', () => {
    // In the `{dict: …}` shorthand, a plain string value is a string.
    const d = ce.box({ dict: { a: 'u' } });
    expect(d.has('u')).toBe(false);
  });

  test('has() of a key name is false unless the name is also a symbol in a value', () => {
    const d = ce.box({ dict: { a: 1, k: { sym: 'k' } } });
    expect(d.has('a')).toBe(false);
    // `k` is a key AND a symbol in the value of that key.
    expect(d.has('k')).toBe(true);
  });

  test("has('Dictionary') matches the operator of a dictionary", () => {
    // `has()` matches a symbol or an operator name, and the operator of a
    // dictionary is `Dictionary`, as the operator of a list is `List`.
    const d = ce.box({ dict: { a: 1 } });
    expect(d.operator).toBe('Dictionary');
    expect(d.has('Dictionary')).toBe(true);
    expect(ce.box(['List', 1, { dict: { a: 1 } }]).has('Dictionary')).toBe(
      true
    );
    expect(ce.box(['List', 1, 2]).has('Dictionary')).toBe(false);
  });

  test('unknowns, symbols and freeVariables include the symbols of the values', () => {
    const d = ce.box({ dict: { v: { sym: 'k' } } });
    expect(d.unknowns).toEqual(['k']);
    expect(d.symbols).toEqual(['k']);
    expect(d.freeVariables).toEqual(['k']);
    // Before: `['z']` for each of the three.
    const l = ce.box(['List', { dict: { a: { fn: ['Add', 'x', 1] } } }, 'z']);
    expect(l.unknowns).toEqual(['x', 'z']);
    expect(l.symbols).toEqual(['x', 'z']);
    expect(l.freeVariables).toEqual(['x', 'z']);
    // The keys are not symbols.
    expect(ce.box({ dict: { a: 1 } }).symbols).toEqual([]);
  });

  test('getSubexpressions() and subexpressions walk the values of a dictionary', () => {
    // Before: the walk stopped at the dictionary, `getSubexpressions('Sin')`
    // was `[]` and `subexpressions` did not list the value.
    const l = ce.box([
      'List',
      { dict: { a: { fn: ['Sin', ['Add', 'x', 1]] } } },
      'z',
    ]);
    expect(l.getSubexpressions('Sin').map((e) => e.toString())).toEqual([
      'sin(x + 1)',
    ]);
    expect(l.subexpressions.map((e) => e.toString())).toEqual([
      '[{"a" -> sin(x + 1)},z]',
      '{"a" -> sin(x + 1)}',
      'sin(x + 1)',
      'x + 1',
      'x',
      '1',
      'z',
    ]);
    // The dictionary itself is listed under its operator.
    expect(l.getSubexpressions('Dictionary').length).toBe(1);
  });

  test('hasKey() tests the keys', () => {
    const d = ce.box({ dict: { a: { sym: 'x' }, b: 2 } });
    expect(isDictionary(d)).toBe(true);
    if (!isDictionary(d)) return;
    expect(d.hasKey('a')).toBe(true);
    expect(d.hasKey('b')).toBe(true);
    expect(d.hasKey('x')).toBe(false);
    // The backing map has no prototype: an inherited member is not a key.
    expect(d.hasKey('toString')).toBe(false);
    expect(d.hasKey('__proto__')).toBe(false);
  });

  test('an empty dictionary has no key and mentions no symbol', () => {
    const d = ce.box(['Dictionary']);
    expect(isDictionary(d)).toBe(true);
    if (!isDictionary(d)) return;
    expect(d.hasKey('a')).toBe(false);
    expect(d.has('a')).toBe(false);
  });

  // A consequence through an engine call site. The per-term step of an
  // indexed `Sum` (`evaluateBigOpTerm`, `library/utils.ts`) asks
  // `term.has(index)` to find a term that still mentions the index after a
  // lazy operator (here an undecided `If`) held its arms, and then
  // substitutes the current index value. When the index occurred only in a
  // dictionary value, the key test answered `false`, the index was not
  // substituted, and every term was the same expression with the bound `k`
  // left in it. Before: `2·If(x < 1, {"v" -> k}, 0)`.
  test('Sum: an index that occurs only in a dictionary value is substituted', () => {
    const r = ce
      .box([
        'Sum',
        [
          'If',
          ['Less', 'x', 1],
          ['Dictionary', ['KeyValuePair', { str: 'v' }, 'k']],
          0,
        ],
        ['Limits', 'k', 1, 2],
      ])
      .evaluate();
    expect(r.has('k')).toBe(false);
    expect(r.json).toEqual([
      'Add',
      ['If', ['Less', 'x', 1], { dict: { v: 1 } }, 0],
      ['If', ['Less', 'x', 1], { dict: { v: 2 } }, 0],
    ]);
  });

  // The same sums under `simplify()`. The free-variable walk did not look in
  // the values of a dictionary, so the body looked constant in `k` and the
  // simplification took it out of the sum: the results were
  // `3If(x < 1, {"v" -> k}, 0)` and `If(x < 1, {"v" -> k}, 1)^3`, with the
  // bound `k` left in them. The sum now stays a sum, as it does when `k` is
  // a list element (`If(x < 1, [k], 0)`) instead of a dictionary value.
  test('Sum and Product: simplify() does not take a body that depends on the index out of the sum', () => {
    const body = (z: number) => [
      'If',
      ['Less', 'x', 1],
      ['Dictionary', ['KeyValuePair', { str: 'v' }, 'k']],
      z,
    ];
    const sum = ce.box(['Sum', body(0), ['Limits', 'k', 1, 3]]).simplify();
    expect(sum.toString()).toMatchInlineSnapshot(
      `"sum_(k=1)^(3)(If(x < 1, {"v" -> k}, 0))"`
    );
    const product = ce
      .box(['Product', body(1), ['Limits', 'k', 1, 3]])
      .simplify();
    expect(product.toString()).toMatchInlineSnapshot(
      `"prod_(k=1)^(3)(If(x < 1, {"v" -> k}, 1))"`
    );
  });
});
