import { parse } from '../../utils';

describe('CASES/PIECEWISE', () => {
  test('Valid forms', () => {
    expect(
      parse(`\\begin{cases}
      0 & n =  0\\\\
      1 & n =  1\\\\
      n \\geq 2  & n^2+1 \\end{cases}`)
    ).toMatchInlineSnapshot(`
      '[
        "Piecewise",
        [
          "List",
          ["List", 0, ["Equal", "n", 0]],
          ["List", 1, ["Equal", "n", 1]],
          ["List", ["GreaterEqual", "n", 2], ["Add", ["Power", "n", 2], 1]]
        ]
      ]'
    `);
  });
});
