import { parse } from '../../utils';

describe.skip('CASES/PIECEWISE', () => {
  test('Valid forms', () => {
    expect(
      parse(`\\begin{cases}
0 & n =  0\\\\
1 & n =  1\\\\
x f(n - 1)(x) + f(n - 2)(x)& n \\geq 2\\end{cases}`)
    ).toMatchInlineSnapshot(
      `['Piecewise', ['List', ['List', 0, ['Equal', ['Error', ['Sequence', 0, ['Error', ['Sequence', ['Error', ['LatexString', {str: '\\\\'}], 'unknown-command'], 1], 'unexpected-sequence']], 'unexpected-sequence'], 'n'], ['Equal', ['Error', ['Sequence', 1, ['Error', ['Sequence', ['Error', ['LatexString', {str: '\\\\'}], 'unknown-command'], ['Error', ['Sequence', 'x', ['Error', ['Sequence', ['f', ['Add', 'n', -1]], ['Add', 'x', ['Error', ['Sequence', ['f', ['Add', 'n', -2]], 'x'], 'unexpected-sequence']]], 'unexpected-sequence']], 'unexpected-sequence']], 'unexpected-sequence']], 'unexpected-sequence'], 'n']]]]`
    );
  });
});
