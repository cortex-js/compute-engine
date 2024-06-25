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
        ["Equal", "n", 0],
        0,
        ["Equal", "n", 1],
        1,
        ["GreaterEqual", "n", 2],
        ["Add", ["Power", "n", 2], 1]
      ]
    `);
  });
});
