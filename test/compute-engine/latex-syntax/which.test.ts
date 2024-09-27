import { engine as ce } from '../../utils.ts';

describe('WHICH', () => {
  test('Valid forms', () => {
    expect(
      ce.parse(`\\begin{cases}
      0 & n =  0\\\\
      1 & n =  1\\\\
      n^2+1 & n \\geq 2   \\end{cases}`)
    ).toMatchInlineSnapshot(`
      [
        "Which",
        ["Equal", "n", 0],
        0,
        ["Equal", "n", 1],
        1,
        ["LessEqual", 2, "n"],
        ["Add", ["Square", "n"], 1]
      ]
    `);
  });
});
