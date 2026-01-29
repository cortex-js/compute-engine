import { Expression } from '../../../src/math-json/types.ts';
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
        ["Limits", "k", ["Add", "a", ["Power", 2, 3]], ["Square", 3]],
        ["Limits", "j", ["Add", 2, ["Square", 3]], "b"]
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
    // [1,5] is parsed as a List, not a Range
    expect(ce.parse(`\\sum_{n \\in [1,5]}n`)).toMatchInlineSnapshot(
      `["Sum", "n", ["Element", "n", ["List", 1, 5]]]`
    );
  });

  test('multi indexed summation with semicolon separator parses Element', () => {
    // Semicolon separated Element expressions are now parsed
    // (though N and D are not recognized as sets, they show errors)
    expect(ce.parse(`\\sum_{n \\in N; d \\in D} K`)).toMatchInlineSnapshot(`
      [
        "Sum",
        "K",
        [
          "Element",
          "n",
          [
            "Error",
            [
              "ErrorCode",
              "incompatible-type",
              "'collection'",
              "(any) -> unknown"
            ]
          ]
        ],
        [
          "Element",
          "d",
          [
            "Error",
            [
              "ErrorCode",
              "incompatible-type",
              "'collection'",
              "(expression, variable: symbol, variables: symbol+) -> expression"
            ]
          ]
        ]
      ]
    `);
  });

  test('multi indexed summation with mixed syntax parses Element', () => {
    // Mixed syntax now parses the Element expression
    expect(ce.parse(`\\sum_{n = 6; d \\in D} K`)).toMatchInlineSnapshot(`
      [
        "Sum",
        "K",
        ["Limits", "n", "Nothing", 6],
        [
          "Element",
          "d",
          [
            "Error",
            [
              "ErrorCode",
              "incompatible-type",
              "'collection'",
              "(expression, variable: symbol, variables: symbol+) -> expression"
            ]
          ]
        ]
      ]
    `);
  });

  test('UNSUPPORTED summation with inequality constraint', () => {
    // Inequality constraints like d != V are not currently supported
    expect(ce.parse(`\\sum_{d \\in D, d != V} K`)).toMatchInlineSnapshot(`
      [
        "Sum",
        "K",
        [
          "Element",
          "d",
          [
            "Error",
            [
              "ErrorCode",
              "incompatible-type",
              "'collection'",
              "(expression, variable: symbol, variables: symbol+) -> expression"
            ]
          ]
        ]
      ]
    `);
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

  test('sum over List', () => {
    // [1,5] parses as a List, not Range - evaluates to 1+5=6
    expect(evaluate(`\\sum_{n \\in [1,5]}n`)).toMatchInlineSnapshot(`6`);
  });

  test('sum over Range via box', () => {
    // Use box() to create a proper Range-based Sum
    const expr = ce.box(['Sum', 'n', ['Element', 'n', ['Range', 1, 5]]]);
    expect(expr.evaluate().json).toBe(15);
  });

  test('product over finite set', () => {
    expect(
      evaluate(`\\prod_{k \\in \\{1,2,3,4\\}}k`)
    ).toMatchInlineSnapshot(`24`);
  });

  test('serialization of Sum with Element', () => {
    const expr = ce.box(['Sum', 'n', ['Element', 'n', ['Set', 1, 2, 3]]]);
    expect(expr.latex).toMatchInlineSnapshot(
      `\\sum_{n\\in \\lbrace1, 2, 3\\rbrace}n`
    );
  });

  test('serialization of Product with Element', () => {
    const expr = ce.box([
      'Product',
      'k',
      ['Element', 'k', ['Set', 1, 2, 3, 4]],
    ]);
    expect(expr.latex).toMatchInlineSnapshot(
      `\\prod_{k\\in \\lbrace1, 2, 3, 4\\rbrace}k`
    );
  });

  test('round-trip parse -> latex -> parse', () => {
    const original = `\\sum_{n \\in \\{1,2,3\\}} n`;
    const parsed = ce.parse(original);
    const latex = parsed.latex;
    const reparsed = ce.parse(latex);
    expect(reparsed.json).toEqual(parsed.json);
  });
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
