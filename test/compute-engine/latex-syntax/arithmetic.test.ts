import { Expression } from '../../../src/math-json';
import { engine } from '../../utils';

function evaluate(s: string): Expression {
  return engine.parse(s).evaluate()?.json ?? 'ERROR';
}

describe('SUM', () => {
  test('k is an Integer (as the index) and used a a Number (in the fraction)', () => {
    expect(evaluate(`\\sum_{k=0}^{10}\\frac{k}{2}`)).toMatchInlineSnapshot(
      `27.5`
    );
  });

  test('i is a valid index', () => {
    expect(evaluate(`\\sum_{i=0}^{10}\\frac{i}{2}`)).toMatchInlineSnapshot(
      `27.5`
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
      `3543.75`
    );
  });

  test('i is a valid index', () => {
    expect(evaluate(`\\prod_{i=1}^{10}\\frac{i}{2}`)).toMatchInlineSnapshot(
      `3543.75`
    );
  });

  test('product of a collection', () => {
    expect(
      evaluate(`\\prod \\lbrack 1, 2, 3, 4, 5\\rbrack`)
    ).toMatchInlineSnapshot(`120`);
  });

  test('parsing many indices with non symbol index', () => {
    expect(engine.parse(`\\sum_{n,m} k_{n,m}`)).toMatchInlineSnapshot(`
      [
        "Sum",
        ["Subscript", "k", ["Delimiter", ["Sequence", "n", "m"], "','"]],
        "n",
        "m"
      ]
    `);
  });

  test('sum but not actually of multiple indices', () => {
    expect(engine.parse(`\\sum_{n=0,m=4}^{4,8}{n+m}`)).toMatchInlineSnapshot(`
      [
        "Sum",
        ["Add", "m", "n"],
        ["Triple", "n", 0, 4],
        ["Triple", "m", 4, 8]
      ]
    `);
  });

  test('parsing indices with element', () => {
    expect(engine.parse(`\\sum_{n \\in N}K_n`)).toMatchInlineSnapshot(
      `["Sum", "K_n", ["Element", "n", "N"]]`
    );
  });

  test('parsing indices with element', () => {
    expect(engine.parse(`\\sum_{n \\in N; d \\in D} K`)).toMatchInlineSnapshot(
      `["Sum", "K", ["Element", "n", "N"], ["Element", "d", "D"]]`
    );
  });

  test('parsing indices with element', () => {
    expect(engine.parse(`\\sum_{n = 6; d \\in D} K`)).toMatchInlineSnapshot(
      `["Sum", "K", ["Pair", "n", 6], ["Element", "d", "D"]]`
    );
  });

  test('parsing indices with element', () => {
    expect(engine.parse(`\\sum_{d \\in D, d != V} K`)).toMatchInlineSnapshot(
      `["Sum", "K", ["Element", "d", "D"], ["Unequal", "d", "V"]]`
    );
  });

  test('parsing indices with element', () => {
    expect(engine.parse(`\\sum_{d_1} K`)).toMatchInlineSnapshot(
      `["Sum", "K", ["Subscript", "d", 1]]`
    );
  });

  test('parsing indices with element', () => {
    expect(engine.parse(`\\sum_{d_{1} = 2} K`)).toMatchInlineSnapshot(
      `["Sum", "K", ["Pair", "d_1", 2]]`
    );
  });
});
