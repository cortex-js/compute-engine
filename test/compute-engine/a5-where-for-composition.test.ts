import { engine as ce } from '../utils';

describe('A5 — where+for composition (Order 1: where before for)', () => {
  test('Parse: bindings before iter produces Block-outermost shape', () => {
    // Surface: `i \operatorname{where} n \coloneq 3 \operatorname{for} i = \operatorname{Range}(n)`
    // Target canonical shape (Block outermost, Comprehension inside).
    // Note: `Range(n)` canonicalizes to `Range(1, n)` (1-arg Range
    // means upper bound with default start of 1).
    expect(
      ce.parse(
        'i \\operatorname{where} n \\coloneq 3 \\operatorname{for} i = \\operatorname{Range}(n)'
      )
    ).toMatchInlineSnapshot(`
      [
        "Block",
        ["Declare", "n"],
        ["Assign", "n", 3],
        ["Comprehension", "i", ["Element", "i", ["Range", 1, "n"]]]
      ]
    `);
  });
});

describe('A5 — where+for composition (Order 2: for before where)', () => {
  test('Parse: iter before bindings produces Block-outermost shape', () => {
    // Surface: `i \operatorname{for} i = \operatorname{Range}(n) \operatorname{where} n \coloneq 3`
    // Same target canonical shape as Order 1.
    expect(
      ce.parse(
        'i \\operatorname{for} i = \\operatorname{Range}(n) \\operatorname{where} n \\coloneq 3'
      )
    ).toMatchInlineSnapshot(`
      [
        "Block",
        ["Declare", "n"],
        ["Assign", "n", 3],
        ["Comprehension", "i", ["Element", "i", ["Range", 1, "n"]]]
      ]
    `);
  });
});

describe('A5 — where+for composition (evaluation)', () => {
  test('Order 1: where before for — iter range can reference binding', () => {
    // n is bound to 3; for-iter ranges over Range(n) = [1,2,3]
    // body is i; result is the list [1, 2, 3]
    const result = ce
      .parse(
        'i \\operatorname{where} n \\coloneq 3 \\operatorname{for} i = \\operatorname{Range}(n)'
      )
      .evaluate();
    expect(result.json).toEqual(['List', 1, 2, 3]);
  });

  test('Order 2: for before where — iter range can reference binding', () => {
    const result = ce
      .parse(
        'i \\operatorname{for} i = \\operatorname{Range}(n) \\operatorname{where} n \\coloneq 3'
      )
      .evaluate();
    expect(result.json).toEqual(['List', 1, 2, 3]);
  });
});

describe('A5 — where+for composition (scope hygiene)', () => {
  test('Bindings do not leak when outer scope already has the symbol (shadowing)', () => {
    ce.pushScope();
    try {
      ce.assign('n', 100);
      // Inside the where-clause, n is shadowed to 3.
      const result = ce
        .parse(
          'i \\operatorname{where} n \\coloneq 3 \\operatorname{for} i = \\operatorname{Range}(n)'
        )
        .evaluate();
      expect(result.json).toEqual(['List', 1, 2, 3]);
      // After the clause, outer n is unchanged.
      expect(ce.expr('n').evaluate().re).toEqual(100);
    } finally {
      ce.popScope();
    }
  });

  test('Bindings do not leak when outer scope has no prior binding (fresh scope)', () => {
    ce.pushScope();
    try {
      // Outer scope has no `n` at all.
      const result = ce
        .parse(
          'i \\operatorname{where} n \\coloneq 3 \\operatorname{for} i = \\operatorname{Range}(n)'
        )
        .evaluate();
      expect(result.json).toEqual(['List', 1, 2, 3]);
      // After the clause, `n` is still undefined in the outer scope —
      // it was created inside the Block's local scope and discarded.
      // A bare `n` reference would auto-declare as an unknown symbol,
      // so check the value definition directly.
      expect(ce.lookupDefinition('n')).toBeUndefined();
    } finally {
      ce.popScope();
    }
  });
});

describe('A5 — where+for composition (edge cases)', () => {
  test('where without trailing for falls back to plain Block', () => {
    // Regression: plain `where` (no for clause) must still produce
    // the original Block(Declare, Assign, body) shape from A4.
    expect(
      ce.parse('x^2 \\operatorname{where} x \\coloneq 5')
    ).toMatchInlineSnapshot(
      `["Block", ["Declare", "x"], ["Assign", "x", 5], ["Square", "x"]]`
    );
  });
});
