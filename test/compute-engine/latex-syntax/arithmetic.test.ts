import { Expression } from '../../../src/math-json/types.ts';
import { engine as ce, evaluate, latex } from '../../utils';

describe('SUM parsing', () => {
  test('constant body (number literal)', () => {
    expect(ce.parse(`\\sum 3`)).toMatchInlineSnapshot(`["Sum", 3]`);
  });

  test('constant body (symbol)', () => {
    expect(ce.parse(`\\sum \\pi`)).toMatchInlineSnapshot(`["Sum", "Pi"]`);
  });

  test('constant body (expression)', () => {
    expect(ce.parse(`\\sum (1+\\pi)`)).toMatchInlineSnapshot(
      `["Sum", ["Add", 1, "Pi"]]`
    );
  });

  test('index with no lower or upper bounds', () => {
    expect(ce.parse(`\\sum_{k} (1+k)`)).toMatchInlineSnapshot(
      `["Sum", ["Add", "k", 1], ["Single", "k"]]`
    );
  });

  test('indexes with no lower or upper bounds', () => {
    expect(ce.parse(`\\sum_{k,j} (j+k)`)).toMatchInlineSnapshot(
      `["Sum", ["Add", "j", "k"], ["Single", "k"], ["Single", "j"]]`
    );
  });

  test('indexes with no upper bounds', () => {
    expect(ce.parse(`\\sum_{k=1,j=2} (j+k)`)).toMatchInlineSnapshot(
      `["Sum", ["Add", "j", "k"], ["Pair", "k", 1], ["Pair", "j", 2]]`
    );
  });

  test('indexes with lower and upper bounds', () => {
    expect(ce.parse(`\\sum_{k = 1, j = 2}^{3 , 4} (j+k)`))
      .toMatchInlineSnapshot(`
      [
        "Sum",
        ["Add", "j", "k"],
        ["Triple", "k", 1, 3],
        ["Triple", "j", 2, 4]
      ]
    `);
  });

  test('indexes with lower and upper bounds as expressions', () => {
    expect(ce.parse(`\\sum_{k = a + 2^3, j = 2 + 3^2}^{3^2 , b} (j+k)`))
      .toMatchInlineSnapshot(`
      [
        "Sum",
        ["Add", "j", "k"],
        ["Triple", "k", ["Add", "a", ["Power", 2, 3]], ["Square", 3]],
        ["Triple", "j", ["Add", 2, ["Square", 3]], "b"]
      ]
    `);
  });

  test('indexes with lower and missing upper bounds', () => {
    expect(ce.parse(`\\sum_{k = 1, j = 2}^{3} (j+k)`)).toMatchInlineSnapshot(
      `["Sum", ["Add", "j", "k"], ["Triple", "k", 1, 3], ["Pair", "j", 2]]`
    );
  });

  test('INVALID indexes with lower and extra upper bounds', () => {
    expect(ce.parse(`\\sum_{k = 1, j = 2}^{3 , 4, 7} (j+k)`))
      .toMatchInlineSnapshot(`
      [
        "Sum",
        ["Add", "j", "k"],
        ["Triple", "k", 1, 3],
        ["Triple", "j", 2, 4]
      ]
    `);
  });

  test('i is a valid index (not imaginary unit)', () => {
    expect(ce.parse(`\\sum_{i=0}^{10}\\frac{i}{2}`)).toMatchInlineSnapshot(
      `["Sum", ["Multiply", ["Rational", 1, 2], "i"], ["Triple", "i", 0, 10]]`
    );
  });

  test('sum of a collection', () => {
    expect(
      ce.parse(`\\sum \\lbrack 1, 2, 3, 4, 5\\rbrack`)
    ).toMatchInlineSnapshot(`["Sum", ["List", 1, 2, 3, 4, 5]]`);
  });

  test('single range index', () => {
    expect(ce.parse(`\\sum_{n=0..10}n`)).toMatchInlineSnapshot(
      `["Sum", "n", ["Triple", "n", 0, 10]]`
    );
  });

  test('double range index', () => {
    expect(ce.parse(`\\sum_{n=0..10, m=1..7}(n+m)`)).toMatchInlineSnapshot(`
      [
        "Sum",
        ["Add", "m", "n"],
        ["Triple", "n", 0, 10],
        ["Triple", "m", 1, 7]
      ]
    `);
  });

  test('single range index with step', () => {
    expect(ce.parse(`\\sum_{n=0..2..10}n`)).toMatchInlineSnapshot(
      `["Sum", "n", ["Triple", "n", 0, ["Range", 2, 10]]]`
    );
  });

  test('INVALID mix of range and equation', () => {
    expect(ce.parse(`\\sum_{n=0..10, m=1}^{2}(n+m)`)).toMatchInlineSnapshot(
      `["Sum", ["Add", "m", "n"], ["Triple", "n", 0, 10], ["Pair", "m", 1]]`
    );
  });

  test('double indexed collection index', () => {
    expect(ce.parse(`\\sum_{n,m} k_{n,m}`)).toMatchInlineSnapshot(`
      [
        "Sum",
        ["Subscript", "k", ["Delimiter", ["Sequence", "n", "m"], "','"]],
        ["Single", "n"],
        ["Single", "m"]
      ]
    `);
  }); // @fixme

  test('INVALID parsing of summation with element in', () => {
    expect(ce.parse(`\\sum_{n \\in \\N}K_n`)).toMatchInlineSnapshot(
      `["Sum", "K_n"]`
    );
  });

  test('INVALID parsing of multi indexed summation with different index variables', () => {
    expect(ce.parse(`\\sum_{n \\in N; d \\in D} K`)).toMatchInlineSnapshot(
      `["Sum", "K"]`
    );
  });

  test('INVALID parsing of multi indexed summation with and equal and non-equal boxed expression', () => {
    expect(ce.parse(`\\sum_{n = 6; d \\in D} K`)).toMatchInlineSnapshot(
      `["Sum", "K", ["Pair", "n", 6]]`
    );
  });

  test('INVALID testing parsing of multi indexed summation with non-equal boxed expressions', () => {
    expect(ce.parse(`\\sum_{d \\in D, d != V} K`)).toMatchInlineSnapshot(
      `["Sum", "K"]`
    );
  });
});

describe('SUM evaluation', () => {
  test('testing evaluating layers of summaitons', () => {
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
