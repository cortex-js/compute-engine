import { engine as ce } from '../../utils';

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
        ["Equal", 0, "n"],
        0,
        ["Equal", 1, "n"],
        1,
        ["LessEqual", 2, "n"],
        ["Add", ["Square", "n"], 1]
      ]
    `);
  });
});
