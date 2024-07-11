import { engine, evaluate } from '../../utils';

describe('SUM', () => {
  test('k is an Integer (as the index) and used a a Number (in the fraction)', () => {
    expect(evaluate(`\\sum_{k=0}^{10}\\frac{k}{2}`)).toMatchInlineSnapshot(
      `["Rational", 55, 2]`
    );
  });

  test('i is a valid index', () => {
    expect(evaluate(`\\sum_{i=0}^{10}\\frac{i}{2}`)).toMatchInlineSnapshot(
      `["Rational", 55, 2]`
    );
  });

  test('sum of a collection', () => {
    expect(
      evaluate(`\\sum \\lbrack 1, 2, 3, 4, 5\\rbrack`)
    ).toMatchInlineSnapshot(`15`);
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

  test('testing parsing of double indexed summation', () => {
    expect(engine.parse(`\\sum_{n,m} k_{n,m}`)).toMatchInlineSnapshot(
      `["Sum", ["At", "k", "n", "m"], "n", "m"]`
    );
  });

  test('testing parsing of double indexed summation with upper and lower bounds', () => {
    expect(engine.parse(`\\sum_{n=0,m=4}^{4,8}{n+m}`)).toMatchInlineSnapshot(`
      [
        "Sum",
        ["Add", "m", "n"],
        ["Triple", "n", 0, 4],
        ["Triple", "m", 4, 8]
      ]
    `);
  });

  test('testing parsing of summation with element boxed expression', () => {
    expect(engine.parse(`\\sum_{n \\in \\N}K_n`)).toMatchInlineSnapshot(
      `["Sum", ["At", "K", "n"], ["Element", "n", "NonNegativeIntegers"]]`
    );
  });

  test('testing parsing of multi indexed summation with different index variables', () => {
    expect(engine.parse(`\\sum_{n \\in N; d \\in D} K`)).toMatchInlineSnapshot(
      `["Sum", "K", ["Element", "n", "N"], ["Element", "d", "D"]]`
    );
  });

  test('testing parsing of multi indexed summation with and equal and non-equal boxed expression', () => {
    expect(engine.parse(`\\sum_{n = 6; d \\in D} K`)).toMatchInlineSnapshot(
      `["Sum", "K", ["Pair", "n", 6], ["Element", "d", "D"]]`
    );
  });

  test('testing parsing of multi indexed summation with non-equal boxed expressions', () => {
    expect(engine.parse(`\\sum_{d \\in D, d != V} K`)).toMatchInlineSnapshot(
      `["Sum", "K", ["Element", "d", "D"], ["Unequal", "d", "V"]]`
    );
  });

  test('testing parsing of summation with a subscripted subscript index', () => {
    expect(engine.parse(`\\sum_{d_1} K`)).toMatchInlineSnapshot(
      `["Sum", "K", ["At", "d", 1]]`
    );
  });

  test('testing parsing of summation with a subscripted subscript index and value', () => {
    expect(engine.parse(`\\sum_{d_{1} = 2} K`)).toMatchInlineSnapshot(
      `["Sum", "K", ["Pair", ["At", "d", 1], 2]]`
    );
  });

  test('testing evaluating layers of summaitons', () => {
    expect(evaluate(`\\sum_{n=0,m=4}^{4,8}{n+m}`)).toMatchInlineSnapshot(`200`);
  });

  test('testing two levels of summations', () => {
    expect(
      evaluate(`\\sum_{n=0}^{4}\\sum_{m=4}^{8}{n+m}`)
    ).toMatchInlineSnapshot(`200`);
  });

  test('testing more than two levels of summations', () => {
    expect(
      evaluate(`\\sum_{n=0}^{4}(\\sum_{m=4}^{8}(\\sum_{l=0}^{2}{n+m})+n)`)
    ).toMatchInlineSnapshot(`610`);
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
