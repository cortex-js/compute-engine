import { ComputeEngine } from '../../src/compute-engine';
import { engine as ce } from '../utils';

describe('A5 — where+for composition (Order 1: where before for)', () => {
  test('Parse: the for applies to the whole where clause', () => {
    // Surface: `i \operatorname{where} n \coloneq 3 \operatorname{for} i = \operatorname{Range}(n)`
    // `where` binds tighter than `for`, so the clause is the body of the
    // comprehension and the `n` of `Range(n)` is free
    // (`docs/plans/2026-11-02-where-binding.md`, "The `for` order"). Tycho's
    // 24 comprehension rows with a binding that reads the index need this
    // order. `Range(n)` canonicalizes to `Range(1, n)`. The free `n` is
    // declared in the engine that parses it, so this test has its own
    // engine: the scope tests below check that the shared engine has no `n`.
    expect(
      new ComputeEngine().parse(
        'i \\operatorname{where} n \\coloneq 3 \\operatorname{for} i = \\operatorname{Range}(n)'
      )
    ).toMatchInlineSnapshot(`
      [
        "Comprehension",
        ["Block", ["Declare", "n", "'unknown'", 3], "i"],
        ["Element", "i", ["Range", 1, "n"]]
      ]
    `);
  });
});

describe('A5 — where+for composition (Order 2: for before where)', () => {
  test('Parse: iter before bindings produces Block-outermost shape', () => {
    // Surface: `i \operatorname{for} i = \operatorname{Range}(n) \operatorname{where} n \coloneq 3`
    // The clause covers the whole comprehension, so `Range(n)` reads the
    // binding.
    expect(
      ce.parse(
        'i \\operatorname{for} i = \\operatorname{Range}(n) \\operatorname{where} n \\coloneq 3'
      )
    ).toMatchInlineSnapshot(`
      [
        "Block",
        ["Declare", "n", "'unknown'", 3],
        ["Comprehension", "i", ["Element", "i", ["Range", 1, "n"]]]
      ]
    `);
  });
});

describe('A5 — where+for composition (evaluation)', () => {
  test('A parenthesized comprehension before where — iter range can reference binding', () => {
    // n is bound to 3; for-iter ranges over Range(n) = [1,2,3]
    // body is i; result is the list [1, 2, 3]
    const result = ce
      .parse(
        '(i \\operatorname{for} i = \\operatorname{Range}(n)) \\operatorname{where} n \\coloneq 3'
      )
      .evaluate();
    // The comprehension is a lazy collection; materialize to read its
    // elements. The where-binding is captured through the loop scope's parent
    // chain, so it materializes correctly after the transient `where` scope.
    expect([...result.each()].map((x) => x.json)).toEqual([1, 2, 3]);
  });

  test('Order 2: for before where — iter range can reference binding', () => {
    const result = ce
      .parse(
        'i \\operatorname{for} i = \\operatorname{Range}(n) \\operatorname{where} n \\coloneq 3'
      )
      .evaluate();
    // The comprehension is a lazy collection; materialize to read its
    // elements. The where-binding is captured through the loop scope's parent
    // chain, so it materializes correctly after the transient `where` scope.
    expect([...result.each()].map((x) => x.json)).toEqual([1, 2, 3]);
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
          'i \\operatorname{for} i = \\operatorname{Range}(n) \\operatorname{where} n \\coloneq 3'
        )
        .evaluate();
      // The comprehension is a lazy collection; materialize to read its
      // elements. The where-binding (`n`) is captured through the loop scope's
      // parent chain, so it materializes correctly even after the transient
      // `where` scope is discarded.
      expect([...result.each()].map((x) => x.json)).toEqual([1, 2, 3]);
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
          'i \\operatorname{for} i = \\operatorname{Range}(n) \\operatorname{where} n \\coloneq 3'
        )
        .evaluate();
      // The comprehension is a lazy collection; materialize to read its
      // elements. The where-binding (`n`) is captured through the loop scope's
      // parent chain, so it materializes correctly even after the transient
      // `where` scope is discarded.
      expect([...result.each()].map((x) => x.json)).toEqual([1, 2, 3]);
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
    // A plain `where` (no for clause) is a Block of one declaration with
    // its value, then the body.
    expect(
      ce.parse('x^2 \\operatorname{where} x \\coloneq 5')
    ).toMatchInlineSnapshot(
      `["Block", ["Declare", "x", "'unknown'", 5], ["Square", "x"]]`
    );
  });
});
