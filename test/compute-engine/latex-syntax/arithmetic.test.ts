import { Expression } from '../../../src/math-json/types.ts';
import { ComputeEngine } from '../../../src/compute-engine';
import { engine as ce, evaluate, latex } from '../../utils';

describe('SUM parsing', () => {
  test('constant body (number literal)', () => {
    expect(ce.parse(`\\sum 3`)).toMatchInlineSnapshot(`["Reduce", 3, "Add"]`);
  });

  test('constant body (symbol)', () => {
    expect(ce.parse(`\\sum \\pi`)).toMatchInlineSnapshot(
      `["Reduce", "Pi", "Add"]`
    );
  });

  test('constant body (expression)', () => {
    expect(ce.parse(`\\sum (1+\\pi)`)).toMatchInlineSnapshot(
      `["Reduce", ["Delimiter", ["Add", 1, "Pi"]], "Add"]`
    );
  });

  test('index with no lower or upper bounds', () => {
    expect(ce.parse(`\\sum_{k} (1+k)`)).toMatchInlineSnapshot(
      `["Sum", ["Add", "k", 1], ["Limits", "k", "Nothing", "Nothing"]]`
    );
  });

  test('indexes with no lower or upper bounds', () => {
    expect(ce.parse(`\\sum_{k,j} (j+k)`)).toMatchInlineSnapshot(`
      [
        "Sum",
        ["Add", "j", "k"],
        ["Limits", "k", "Nothing", "Nothing"],
        ["Limits", "j", "Nothing", "Nothing"]
      ]
    `);
  });

  test('indexes with no upper bounds', () => {
    expect(ce.parse(`\\sum_{k=1,j=2} (j+k)`)).toMatchInlineSnapshot(`
      [
        "Sum",
        ["Add", "j", "k"],
        ["Limits", "k", "Nothing", 1],
        ["Limits", "j", "Nothing", 2]
      ]
    `);
  });

  test('indexes with lower and upper bounds', () => {
    expect(ce.parse(`\\sum_{k = 1, j = 2}^{3 , 4} (j+k)`))
      .toMatchInlineSnapshot(`
      [
        "Sum",
        ["Add", "j", "k"],
        ["Limits", "k", 1, 3],
        ["Limits", "j", 2, 4]
      ]
    `);
  });

  test('indexes with lower and upper bounds as expressions', () => {
    expect(ce.parse(`\\sum_{k = a + 2^3, j = 2 + 3^2}^{3^2 , b} (j+k)`))
      .toMatchInlineSnapshot(`
      [
        "Sum",
        ["Add", "j", "k"],
        ["Limits", "k", ["Add", "a", 8], 9],
        ["Limits", "j", 11, "b"]
      ]
    `);
  });

  test('indexes with lower and missing upper bounds', () => {
    expect(ce.parse(`\\sum_{k = 1, j = 2}^{3} (j+k)`)).toMatchInlineSnapshot(`
      [
        "Sum",
        ["Add", "j", "k"],
        ["Limits", "k", 1, 3],
        ["Limits", "j", "Nothing", 2]
      ]
    `);
  });

  test('INVALID indexes with lower and extra upper bounds', () => {
    expect(ce.parse(`\\sum_{k = 1, j = 2}^{3 , 4, 7} (j+k)`))
      .toMatchInlineSnapshot(`
      [
        "Sum",
        ["Add", "j", "k"],
        ["Limits", "k", 1, 3],
        ["Limits", "j", 2, 4]
      ]
    `);
  });

  test('i is a valid index (not imaginary unit)', () => {
    expect(ce.parse(`\\sum_{i=0}^{10}\\frac{i}{2}`)).toMatchInlineSnapshot(
      `["Sum", ["Multiply", ["Rational", 1, 2], "i"], ["Limits", "i", 0, 10]]`
    );
  });

  test('sum of a collection', () => {
    expect(
      ce.parse(`\\sum \\lbrack 1, 2, 3, 4, 5\\rbrack`)
    ).toMatchInlineSnapshot(`["Reduce", ["List", 1, 2, 3, 4, 5], "Add"]`);
  });

  test('single range index', () => {
    expect(ce.parse(`\\sum_{n=0..10}n`)).toMatchInlineSnapshot(
      `["Sum", "n", ["Limits", "n", 0, 10]]`
    );
  });

  test('double range index', () => {
    expect(ce.parse(`\\sum_{n=0..10, m=1..7}(n+m)`)).toMatchInlineSnapshot(`
      [
        "Sum",
        ["Add", "m", "n"],
        ["Limits", "n", 0, 10],
        ["Limits", "m", 1, 7]
      ]
    `);
  });

  test('single range index with step', () => {
    expect(ce.parse(`\\sum_{n=0..2..10}n`)).toMatchInlineSnapshot(
      `["Sum", "n", ["Limits", "n", 0, 10]]`
    );
  });

  test('INVALID mix of range and equation', () => {
    expect(ce.parse(`\\sum_{n=0..10, m=1}^{2}(n+m)`)).toMatchInlineSnapshot(`
      [
        "Sum",
        ["Add", "m", "n"],
        ["Limits", "n", 0, 10],
        ["Limits", "m", "Nothing", 1]
      ]
    `);
  });

  test('double indexed collection index', () => {
    // Delimiter is stripped from subscript expressions
    expect(ce.parse(`\\sum_{n,m} k_{n,m}`)).toMatchInlineSnapshot(`
      [
        "Sum",
        ["Subscript", "k", ["Sequence", "n", "m"]],
        ["Limits", "n", "Nothing", "Nothing"],
        ["Limits", "m", "Nothing", "Nothing"]
      ]
    `);
  });

  test('parsing of summation with element in set', () => {
    expect(ce.parse(`\\sum_{n \\in \\{1,2,3\\}}n`)).toMatchInlineSnapshot(
      `["Sum", "n", ["Element", "n", ["Set", 1, 2, 3]]]`
    );
  });

  test('parsing of summation with element in symbol', () => {
    expect(ce.parse(`\\sum_{n \\in S}K_n`)).toMatchInlineSnapshot(
      `["Sum", "K_n", ["Element", "n", "S"]]`
    );
  });

  test('parsing of summation with element in List', () => {
    // [1,5] is now transformed to Interval in Element context (contextual parsing)
    // See contextual interval parsing: 2-element List/Tuple in set context becomes Interval
    expect(ce.parse(`\\sum_{n \\in [1,5]}n`)).toMatchInlineSnapshot(
      `["Sum", "n", ["Element", "n", ["Interval", 1, 5]]]`
    );
  });

  test('multi indexed summation with semicolon separator parses Element', () => {
    // Semicolon separated Element expressions are now parsed
    // N and D are treated as symbols (possibly sets)
    expect(ce.parse(`\\sum_{n \\in N; d \\in D} K`)).toMatchInlineSnapshot(
      `["Sum", "K", ["Element", "n", "N"], ["Element", "d", "D"]]`
    );
  });

  test('multi indexed summation with mixed syntax parses Element', () => {
    // Mixed syntax now parses the Element expression
    // D is treated as a symbol (possibly a set)
    expect(ce.parse(`\\sum_{n = 6; d \\in D} K`)).toMatchInlineSnapshot(
      `["Sum", "K", ["Limits", "n", "Nothing", 6], ["Element", "d", "D"]]`
    );
  });

  test('UNSUPPORTED summation with inequality constraint', () => {
    // Inequality constraints like d != V are not currently applied during
    // evaluation. `!=` now parses as `NotEqual` (previously the `!` was eaten
    // as a factorial), so the constraint is carried on the `Element` but still
    // ignored by the summation.
    expect(ce.parse(`\\sum_{d \\in D, d != V} K`)).toMatchInlineSnapshot(
      `["Sum", "K", ["Element", "d", "D", ["NotEqual", "d", "V"]]]`
    );
  });

  // A chained `\le` range as the index set. Previously the index was not
  // recognized, so `i` fell through to the imaginary unit and no Limits were
  // built (`["Sum", ["Power", ["Complex", 0, 1], 2]]`).
  test('parsing of summation with `\\le` range', () => {
    expect(ce.parse(`\\sum_{1 \\le i \\le 10} i^2`)).toMatchInlineSnapshot(
      `["Sum", ["Square", "i"], ["Limits", "i", 1, 10]]`
    );
  });

  test('parsing of summation with one-sided `i \\le upper` range', () => {
    // Implied lower bound of 1.
    expect(ce.parse(`\\sum_{i \\le 10} i`)).toMatchInlineSnapshot(
      `["Sum", "i", ["Limits", "i", 1, 10]]`
    );
  });
});

describe('SUM evaluation', () => {
  test('testing evaluating layers of summations', () => {
    expect(evaluate(`\\sum_{n=0,m=4}^{4,8}{n+m}`)).toMatchInlineSnapshot(`200`);
  });

  test('two levels of summations', () => {
    expect(
      evaluate(`\\sum_{n=0}^{4}\\sum_{m=4}^{8}{n+m}`)
    ).toMatchInlineSnapshot(`200`);
  });

  test('more than two levels of summations', () => {
    expect(
      evaluate(`\\sum_{n=0}^{4}(\\sum_{m=4}^{8}(\\sum_{l=0}^{2}{n+m})+n)`)
    ).toMatchInlineSnapshot(`610`);
  });

  test('summation over a `\\le` range evaluates (1^2+…+10^2 = 385)', () => {
    expect(evaluate(`\\sum_{1 \\le i \\le 10} i^2`)).toMatchInlineSnapshot(`385`);
  });
});

describe('SUM with Element indexing set', () => {
  test('sum over finite set', () => {
    expect(evaluate(`\\sum_{n \\in \\{1,2,3\\}}n`)).toMatchInlineSnapshot(`6`);
  });

  test('sum of squares over finite set', () => {
    expect(
      evaluate(`\\sum_{n \\in \\{1,2,3\\}}n^2`)
    ).toMatchInlineSnapshot(`14`);
  });

  test('sum over List bracket notation', () => {
    // EL-1: [1,5] is now treated as Range(1,5) in Element context
    // so \sum_{n \in [1,5]}n = 1+2+3+4+5 = 15
    expect(evaluate(`\\sum_{n \\in [1,5]}n`)).toMatchInlineSnapshot(`15`);
  });

  test('sum over List bracket notation with formula', () => {
    // [1,4] treated as Range(1,4), sum of squares: 1+4+9+16 = 30
    expect(evaluate(`\\sum_{n \\in [1,4]}n^2`)).toMatchInlineSnapshot(`30`);
  });

  test('sum over Range via box', () => {
    // Use box() to create a proper Range-based Sum
    const expr = ce.expr(['Sum', 'n', ['Element', 'n', ['Range', 1, 5]]]);
    expect(expr.evaluate().json).toBe(15);
  });

  test('product over finite set', () => {
    expect(
      evaluate(`\\prod_{k \\in \\{1,2,3,4\\}}k`)
    ).toMatchInlineSnapshot(`24`);
  });

  test('serialization of Sum with Element', () => {
    const expr = ce.expr(['Sum', 'n', ['Element', 'n', ['Set', 1, 2, 3]]]);
    expect(expr.latex).toMatchInlineSnapshot(
      `\\sum_{n\\in \\lbrace1, 2, 3\\rbrace}n`
    );
  });

  test('serialization of Product with Element', () => {
    const expr = ce.expr([
      'Product',
      'k',
      ['Element', 'k', ['Set', 1, 2, 3, 4]],
    ]);
    expect(expr.latex).toMatchInlineSnapshot(
      `\\prod_{k\\in \\lbrace1, 2, 3, 4\\rbrace}k`
    );
  });

  test.skip('round-trip parse -> latex -> parse', () => {
    // KNOWN ISSUE: Set serialization uses \lbrace/\rbrace but parser expects \{/\}
    // This causes round-trip to fail for Set expressions
    const original = `\\sum_{n \\in \\{1,2,3\\}} n`;
    const parsed = ce.parse(original);
    const latex = parsed.latex;
    const reparsed = ce.parse(latex);
    expect(reparsed.json).toEqual(parsed.json);
  });

  // EL-6: Interval support with Open/Closed boundaries
  test('sum over closed Interval via box', () => {
    // Closed interval [1, 5] → iterates 1, 2, 3, 4, 5
    const expr = ce.expr(['Sum', 'n', ['Element', 'n', ['Interval', 1, 5]]]);
    expect(expr.evaluate().json).toBe(15);
  });

  test('sum over half-open Interval (open start) via box', () => {
    // Interval (0, 5] → iterates 1, 2, 3, 4, 5
    const expr = ce.expr([
      'Sum',
      'n',
      ['Element', 'n', ['Interval', ['Open', 0], 5]],
    ]);
    expect(expr.evaluate().json).toBe(15);
  });

  test('sum over half-open Interval (open end) via box', () => {
    // Interval [1, 6) → iterates 1, 2, 3, 4, 5
    const expr = ce.expr([
      'Sum',
      'n',
      ['Element', 'n', ['Interval', 1, ['Open', 6]]],
    ]);
    expect(expr.evaluate().json).toBe(15);
  });

  test('sum over open Interval via box', () => {
    // Interval (0, 6) → iterates 1, 2, 3, 4, 5
    const expr = ce.expr([
      'Sum',
      'n',
      ['Element', 'n', ['Interval', ['Open', 0], ['Open', 6]]],
    ]);
    expect(expr.evaluate().json).toBe(15);
  });

  test('product over Interval via box', () => {
    // Interval [1, 4] → iterates 1, 2, 3, 4
    const expr = ce.expr([
      'Product',
      'k',
      ['Element', 'k', ['Interval', 1, 4]],
    ]);
    expect(expr.evaluate().json).toBe(24); // 1*2*3*4 = 24
  });
});

describe('EL-2: Multiple Element indexing sets', () => {
  // EL-2: Support comma-separated Element expressions like `\sum_{n \in S, m \in T}`

  test('parsing multiple Element indexing sets', () => {
    const expr = ce.parse('\\sum_{n \\in \\{1,2\\}, m \\in \\{3,4\\}} (n+m)');
    // Should parse both Element expressions
    expect(expr.json).toMatchObject([
      'Sum',
      expect.anything(), // body
      ['Element', 'n', expect.anything()],
      ['Element', 'm', expect.anything()],
    ]);
  });

  test('evaluating sum with two Element indexing sets', () => {
    // Sum of (n+m) for n in {1,2} and m in {3,4}
    // = (1+3) + (1+4) + (2+3) + (2+4) = 4 + 5 + 5 + 6 = 20
    const expr = ce.expr([
      'Sum',
      ['Add', 'n', 'm'],
      ['Element', 'n', ['Set', 1, 2]],
      ['Element', 'm', ['Set', 3, 4]],
    ]);
    expect(expr.evaluate().json).toBe(20);
  });

  test('evaluating product with two Element indexing sets', () => {
    // Product of (n*m) for n in {1,2} and m in {3,4}
    // = (1*3) * (1*4) * (2*3) * (2*4) = 3 * 4 * 6 * 8 = 576
    const expr = ce.expr([
      'Product',
      ['Multiply', 'n', 'm'],
      ['Element', 'n', ['Set', 1, 2]],
      ['Element', 'm', ['Set', 3, 4]],
    ]);
    expect(expr.evaluate().json).toBe(576);
  });

  test('mixing Element and Range indexing sets', () => {
    // Sum for n in {1,2} and m from 1 to 2
    // = (1+1) + (1+2) + (2+1) + (2+2) = 2 + 3 + 3 + 4 = 12
    const expr = ce.expr([
      'Sum',
      ['Add', 'n', 'm'],
      ['Element', 'n', ['Set', 1, 2]],
      ['Limits', 'm', 1, 2],
    ]);
    expect(expr.evaluate().json).toBe(12);
  });

  test('serialization of multiple Element indexing sets', () => {
    const expr = ce.expr([
      'Sum',
      ['Add', 'n', 'm'],
      ['Element', 'n', 'S'],
      ['Element', 'm', 'T'],
    ]);
    const latex = expr.latex;
    // Should serialize with both \in expressions
    expect(latex).toContain('n\\in S');
    expect(latex).toContain('m\\in T');
  });
});

describe('EL-3: Condition/Filter Support in Element Expressions', () => {
  // EL-3: Support conditions like `\sum_{n \in S, n > 0}` where the condition
  // filters the values from the set

  test('parsing Element with Greater condition', () => {
    const ce2 = new ComputeEngine();
    const expr = ce2.parse('\\sum_{n \\in S, n > 0} n');
    // Should parse with condition attached to Element
    expect(expr.json).toMatchObject([
      'Sum',
      'n',
      ['Element', 'n', 'S', expect.anything()], // condition is 4th element
    ]);
  });

  test('parsing Element with GreaterEqual condition', () => {
    const ce2 = new ComputeEngine();
    const expr = ce2.parse('\\sum_{n \\in S, n \\ge 2} n');
    expect(expr.json).toMatchObject([
      'Sum',
      'n',
      ['Element', 'n', 'S', expect.anything()],
    ]);
  });

  test('parsing Element with Less condition', () => {
    const ce2 = new ComputeEngine();
    const expr = ce2.parse('\\sum_{n \\in S, n < 0} n');
    expect(expr.json).toMatchObject([
      'Sum',
      'n',
      ['Element', 'n', 'S', expect.anything()],
    ]);
  });

  test('sum with condition n > 0 filters positive values', () => {
    const ce2 = new ComputeEngine();
    ce2.assign('S', ce2.expr(['Set', 1, 2, 3, -1, -2]));
    const expr = ce2.parse('\\sum_{n \\in S, n > 0} n');
    // Should sum only 1+2+3 = 6
    expect(expr.evaluate().json).toBe(6);
  });

  test('sum with condition n >= 2 filters values >= 2', () => {
    const ce2 = new ComputeEngine();
    ce2.assign('S', ce2.expr(['Set', 1, 2, 3, 4, 5, -1, -2]));
    const expr = ce2.parse('\\sum_{n \\in S, n \\ge 2} n');
    // Should sum only 2+3+4+5 = 14
    expect(expr.evaluate().json).toBe(14);
  });

  test('sum with condition n < 0 filters negative values', () => {
    const ce2 = new ComputeEngine();
    ce2.assign('S', ce2.expr(['Set', 1, 2, 3, -1, -2, -3]));
    const expr = ce2.parse('\\sum_{n \\in S, n < 0} n');
    // Should sum only -1-2-3 = -6
    expect(expr.evaluate().json).toBe(-6);
  });

  test('product with condition n > 0', () => {
    const ce2 = new ComputeEngine();
    ce2.assign('S', ce2.expr(['Set', 1, 2, 3, 4, -1, -2]));
    const expr = ce2.parse('\\prod_{n \\in S, n > 0} n');
    // Should multiply only 1*2*3*4 = 24
    expect(expr.evaluate().json).toBe(24);
  });

  test('condition with explicit inline set', () => {
    const ce2 = new ComputeEngine();
    const expr = ce2.expr([
      'Sum',
      'n',
      ['Element', 'n', ['Set', 1, 2, 3, -1, -2], ['Greater', 'n', 0]],
    ]);
    // Should sum only 1+2+3 = 6
    expect(expr.evaluate().json).toBe(6);
  });
});

describe('EL-5: Non-enumerable domains stay symbolic', () => {
  // EL-5: When the domain cannot be enumerated, the expression should
  // remain symbolic instead of returning NaN

  test('sum over unknown symbol stays symbolic', () => {
    // S is an unknown symbol, could be a finite set but we can't determine
    const expr = ce.expr(['Sum', 'n', ['Element', 'n', 'S']]);
    const result = expr.evaluate();
    // Should stay symbolic, not become NaN
    expect(result.operator).toBe('Sum');
    expect(result.isNaN).not.toBe(true);
  });

  test('product over unknown symbol stays symbolic', () => {
    const expr = ce.expr(['Product', 'k', ['Element', 'k', 'T']]);
    const result = expr.evaluate();
    expect(result.operator).toBe('Product');
    expect(result.isNaN).not.toBe(true);
  });

  // EL-4: NonNegativeIntegers and PositiveIntegers can be converted to Limits
  // and will iterate (capped at MAX_ITERATION), so they evaluate to numbers
  // Other infinite sets (Integers, Reals) that can't be iterated stay symbolic

  test('sum over Integers (infinite set) stays symbolic', () => {
    // Integers is bidirectional, cannot be converted to forward iteration
    const expr = ce.expr(['Sum', 'n', ['Element', 'n', 'Integers']]);
    const result = expr.evaluate();
    expect(result.operator).toBe('Sum');
    expect(result.isNaN).not.toBe(true);
  });

  test('sum over Reals (infinite set) stays symbolic', () => {
    // Reals is non-countable, cannot be iterated
    const expr = ce.expr(['Sum', 'x', ['Element', 'x', 'Reals']]);
    const result = expr.evaluate();
    expect(result.operator).toBe('Sum');
    expect(result.isNaN).not.toBe(true);
  });

  test('sum over NegativeIntegers (infinite set) stays symbolic', () => {
    // NegativeIntegers goes in the negative direction, can't be forward iterated
    const expr = ce.expr(['Sum', 'n', ['Element', 'n', 'NegativeIntegers']]);
    const result = expr.evaluate();
    expect(result.operator).toBe('Sum');
    expect(result.isNaN).not.toBe(true);
  });

  test('sum over symbolic Range stays symbolic', () => {
    // Range with symbolic bounds cannot be enumerated
    const expr = ce.expr(['Sum', 'n', ['Element', 'n', ['Range', 1, 'a']]]);
    const result = expr.evaluate();
    expect(result.operator).toBe('Sum');
    expect(result.isNaN).not.toBe(true);
  });

  test('sum over symbolic Interval stays symbolic', () => {
    // Interval with symbolic bounds cannot be enumerated
    const expr = ce.expr(['Sum', 'n', ['Element', 'n', ['Interval', 0, 'b']]]);
    const result = expr.evaluate();
    expect(result.operator).toBe('Sum');
    expect(result.isNaN).not.toBe(true);
  });
});

describe('EL-4 (revised): Infinite series with Element notation', () => {
  // EL-4 (revised 2026-07-05): an infinite domain has no exact value by
  // truncation, so exact `evaluate()` stays SYMBOLIC and `.N()` owns the
  // (capped, truncated) numeric path. NonNegativeIntegers/PositiveIntegers
  // are converted to Limits form and iterated under `.N()` only.

  test('sum over NonNegativeIntegers stays symbolic under evaluate()', () => {
    const expr = ce.expr(['Sum', 'n', ['Element', 'n', 'NonNegativeIntegers']]);
    const result = expr.evaluate();
    expect(result.operator).toBe('Sum');
    expect(result.isNaN).not.toBe(true);
  }, 15000);

  test('sum over NonNegativeIntegers numericizes under N()', () => {
    // Truncated partial sum (triangular number at the iteration cap) — this
    // verifies the numeric path terminates, not the exact value.
    const expr = ce.expr(['Sum', 'n', ['Element', 'n', 'NonNegativeIntegers']]);
    const result = expr.N();
    expect(result.isNumber).toBe(true);
    expect(result.operator).not.toBe('Sum');
    expect(result.isNaN).not.toBe(true);
  }, 15000);

  test('product over PositiveIntegers stays symbolic under evaluate(), numericizes under N()', () => {
    const expr = ce.expr([
      'Product',
      'k',
      ['Element', 'k', 'PositiveIntegers'],
    ]);
    expect(expr.evaluate().operator).toBe('Product');
    const result = expr.N();
    expect(result.isNumber).toBe(true);
    expect(result.operator).not.toBe('Product');
    expect(result.isNaN).not.toBe(true);
  }, 15000);

  test('convergent series over PositiveIntegers gives reasonable approximation under N()', () => {
    // Sum 1/n^2 from 1 to infinity approaches π²/6 ≈ 1.6449
    const expr = ce.expr([
      'Sum',
      ['Power', 'n', -2],
      ['Element', 'n', 'PositiveIntegers'],
    ]);
    const result = expr.N();
    expect(result.isNumber).toBe(true);
    const value = result.re;
    expect(typeof value).toBe('number');
    expect(value).toBeGreaterThan(1.6);
    expect(value).toBeLessThan(1.7);
  }, 30000);

  // Regression: an infinite (capped) domain must be accumulated *numerically*
  // under `.N()`. Accumulating Σ 1/n² exactly builds a rational whose
  // denominator is the LCM of 10⁴ squares — an intractable bigint that hung
  // the thread (the Element iteration also bypassed the engine deadline, so
  // `run()` never cancelled).
  test('divergent series over PositiveIntegers terminates under N() (does not hang)', () => {
    const start = Date.now();
    const expr = ce.expr([
      'Sum',
      ['Power', 'n', -1], // harmonic series — diverges
      ['Element', 'n', 'PositiveIntegers'],
    ]);
    const result = expr.N();
    // Returns the truncated numeric partial sum, quickly, without hanging.
    expect(result.isNumber).toBe(true);
    expect(Number.isFinite(result.re)).toBe(true);
    expect(Date.now() - start).toBeLessThan(5000);
  }, 10000);

  test('infinite series with a symbolic body stays symbolic under both modes', () => {
    // Σ xⁿ has a free variable beyond the index, so a truncated partial value
    // is meaningless: keep it symbolic instead of building a 10⁴-term polynomial.
    const expr = ce.expr([
      'Sum',
      ['Power', 'x', 'n'],
      ['Element', 'n', 'NonNegativeIntegers'],
    ]);
    expect(expr.evaluate().operator).toBe('Sum');
    expect(expr.N().operator).toBe('Sum');
  }, 10000);

  test('convergent series with traditional infinite bounds: symbolic evaluate, numeric N()', () => {
    // Σ_{n=1}^{∞} 1/n² — `.evaluate()` stays symbolic (no closed form yet);
    // `.N()` gives the truncated approximation (the exact accumulation used
    // to exceed the deadline and throw).
    const expr = ce.parse('\\sum_{n=1}^{\\infty} \\frac{1}{n^2}');
    expect(expr.evaluate().operator).toBe('Sum');
    const result = expr.N();
    expect(result.isNumber).toBe(true);
    expect(result.re).toBeGreaterThan(1.6);
    expect(result.re).toBeLessThan(1.7);
  }, 30000);
});

describe('PRODUCT', () => {
  test('k is an Integer (as the index) and used a a Number (in the fraction)', () => {
    expect(evaluate(`\\prod_{k=1}^{10}\\frac{k}{2}`)).toMatchInlineSnapshot(
      `["Rational", 14175, 4]`
    );
  });

  test('i is a valid index', () => {
    expect(evaluate(`\\prod_{i=1}^{10}\\frac{i}{2}`)).toMatchInlineSnapshot(
      `["Rational", 14175, 4]`
    );
  });

  test('product of a collection', () => {
    expect(
      evaluate(`\\prod \\lbrack 1, 2, 3, 4, 5\\rbrack`)
    ).toMatchInlineSnapshot(`120`);
  });

  test('testing the evaluation of products (pis)', () => {
    expect(evaluate(`\\prod_{n=1}^{4}n`)).toMatchInlineSnapshot(`24`);
  });

  test('testing the evaluation of more than two levels of products (pis)', () => {
    expect(
      evaluate(`\\prod_{n=1}^{2}\\prod_{m=1}^{3}nm`)
    ).toMatchInlineSnapshot(`288`);
  });
});

describe('GCD/LCM parsing', () => {
  test('\\gcd with \\left( \\right) delimiters', () => {
    expect(ce.parse('\\gcd\\left(24,37\\right)')).toMatchInlineSnapshot(
      `["GCD", 24, 37]`
    );
  });

  test('\\gcd with regular parentheses', () => {
    expect(ce.parse('\\gcd(24,37)')).toMatchInlineSnapshot(`["GCD", 24, 37]`);
  });

  test('\\operatorname{gcd}', () => {
    expect(ce.parse('\\operatorname{gcd}(24,37)')).toMatchInlineSnapshot(
      `["GCD", 24, 37]`
    );
  });

  test('\\lcm with \\left( \\right) delimiters', () => {
    expect(ce.parse('\\lcm\\left(24,37\\right)')).toMatchInlineSnapshot(
      `["LCM", 24, 37]`
    );
  });

  test('\\lcm with regular parentheses', () => {
    expect(ce.parse('\\lcm(24,37)')).toMatchInlineSnapshot(`["LCM", 24, 37]`);
  });

  test('\\operatorname{lcm}', () => {
    expect(ce.parse('\\operatorname{lcm}(24,37)')).toMatchInlineSnapshot(
      `["LCM", 24, 37]`
    );
  });
});

describe('POWER', () => {
  test('Power Invalid forms', () => {
    expect(latex(['Power'])).toMatchInlineSnapshot(
      `\\error{\\blacksquare}^{\\error{\\blacksquare}}`
    );
    expect(
      latex(['Power', null as unknown as Expression])
    ).toMatchInlineSnapshot(`\\error{\\blacksquare}^{\\error{\\blacksquare}}`);
    expect(
      latex(['Power', undefined as unknown as Expression])
    ).toMatchInlineSnapshot(`\\error{\\blacksquare}^{\\error{\\blacksquare}}`);
    expect(latex(['Power', 1])).toMatchInlineSnapshot(
      `1^{\\error{\\blacksquare}}`
    );
    expect(latex(['Power', NaN])).toMatchInlineSnapshot(
      `\\operatorname{NaN}^{\\error{\\blacksquare}}`
    );
    expect(latex(['Power', Infinity])).toMatchInlineSnapshot(
      `\\infty^{\\error{\\blacksquare}}`
    );
  });
});

describe('FRACTION mixed braced/unbraced arguments', () => {
  test('unbraced numerator, braced denominator', () => {
    expect(ce.parse('\\frac1{-1}')).toMatchInlineSnapshot(`-1`);
  });

  test('braced numerator, unbraced denominator', () => {
    expect(ce.parse('\\frac{900}7')).toMatchInlineSnapshot(
      `["Rational", 900, 7]`
    );
  });

  test('both unbraced', () => {
    expect(ce.parse('\\frac12')).toMatchInlineSnapshot(`["Rational", 1, 2]`);
  });

  test('both braced', () => {
    expect(ce.parse('\\frac{1}{2}')).toMatchInlineSnapshot(
      `["Rational", 1, 2]`
    );
  });

  test('space after command, both unbraced', () => {
    expect(ce.parse('\\frac 12')).toMatchInlineSnapshot(`["Rational", 1, 2]`);
  });

  test('empty groups report missing at each group', () => {
    expect(ce.parse('\\frac{}{}')).toMatchInlineSnapshot(
      `["Divide", ["Error", "'missing'"], ["Error", "'missing'"]]`
    );
  });

  test('Leibniz derivative notation is untouched', () => {
    expect(ce.parse('\\frac{d}{dx}f')).toMatchInlineSnapshot(
      `["D", ["Function", "f", "x"], "x"]`
    );
    expect(ce.parse('\\frac{\\partial f}{\\partial x}')).toMatchInlineSnapshot(
      `["D", ["Function", "f", "x"], "x"]`
    );
    expect(ce.parse('\\frac{d^2}{dx^2}f')).toMatchInlineSnapshot(
      `["D", ["D", ["Function", "f", "x"], "x"], "x"]`
    );
  });
});

describe('BINOMIAL parsing', () => {
  test('braced top, unbraced bottom', () => {
    expect(ce.parse('\\binom{n}k')).toMatchInlineSnapshot(
      `["Binomial", "n", "k"]`
    );
  });

  test('unbraced top, braced bottom', () => {
    expect(ce.parse('\\binom n{k+1}')).toMatchInlineSnapshot(
      `["Binomial", "n", ["Add", "k", 1]]`
    );
  });

  test('infix \\choose primitive', () => {
    expect(ce.parse('{4028 \\choose 2014}')).toMatchInlineSnapshot(
      `["Binomial", 4028, 2014]`
    );
  });
});
