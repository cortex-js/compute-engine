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
        ["LessEqual", 2, "n"],
        ["Add", ["Square", "n"], 1]
      ]
    `);
  });

  test('\\keyword{otherwise} / \\keyword{else} act as the default branch', () => {
    const withText = ce.parse(
      '\\begin{cases} x & x > 0 \\\\ -x & \\text{otherwise} \\end{cases}'
    ).json;
    const withKeywordOtherwise = ce.parse(
      '\\begin{cases} x & x > 0 \\\\ -x & \\keyword{otherwise} \\end{cases}'
    ).json;
    const withKeywordElse = ce.parse(
      '\\begin{cases} x & x > 0 \\\\ -x & \\keyword{else} \\end{cases}'
    ).json;

    // The default branch is marked by a `True` condition.
    expect(withKeywordOtherwise).toEqual([
      'Which',
      ['Less', 0, 'x'],
      'x',
      'True',
      ['Negate', 'x'],
    ]);
    // All spellings produce the same expression.
    expect(withKeywordOtherwise).toEqual(withText);
    expect(withKeywordElse).toEqual(withText);
  });
});
