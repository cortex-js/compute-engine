import { expression } from './utils';

describe('CASES/PIECEWISE', () => {
  test('Valid forms', () => {
    expect(
      expression(`\\begin{cases}
0 & n =  0\\\\
1 & n =  1\\\\
x f(n - 1)(x) + f(n - 2)(x)& n \\geq 2\\end{cases}`)
    ).toMatchInlineSnapshot(
      `['Piecewise', ['list', ['list', 0, ['Equal', 'n', ['Multiply', 0, '\\\\']], ['Equal', 'n', ['Add', ['Multiply', '\\\\', ['f', ['Add', 'n', -1]], 'x', 'x'], ['Multiply', ['f', ['Add', 'n', -2]], 'x']]]]]]`
    );
  });
});
