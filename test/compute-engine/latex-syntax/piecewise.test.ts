import { parse } from '../../utils';

describe('CASES/PIECEWISE', () => {
  test('Valid forms', () => {
    expect(
      parse(`\\begin{cases}
      0 & n =  0\\\\
      1 & n =  1\\\\
      n \\geq 2  & n^2+1 \\end{cases}`)
    ).toMatchInlineSnapshot(`
      [
        "Piecewise",
        [
          "List",
          ["Pair", ["Equal", 0, "n"], 0],
          ["Pair", ["Equal", 1, "n"], 1],
          ["Pair", ["Add", 1, ["Square", "n"]], ["LessEqual", 2, "n"]]
        ]
      ]
    `);
  });
});
