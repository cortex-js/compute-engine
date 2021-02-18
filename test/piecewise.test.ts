import { expression, printExpression } from './utils';

beforeEach(() => {
  jest.spyOn(console, 'assert').mockImplementation((assertion) => {
    if (!assertion) debugger;
  });
  jest.spyOn(console, 'log').mockImplementation(() => {
    debugger;
  });
  jest.spyOn(console, 'warn').mockImplementation(() => {
    debugger;
  });
  jest.spyOn(console, 'info').mockImplementation(() => {
    debugger;
  });
});
expect.addSnapshotSerializer({
  // test: (val): boolean => Array.isArray(val) || typeof val === 'object',
  test: (_val): boolean => true,

  serialize: (val, _config, _indentation, _depth, _refs, _printer): string => {
    return printExpression(val);
  },
});

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
