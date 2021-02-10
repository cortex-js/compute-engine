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
describe('ROOT FUNCTION', () => {
  test('Valid forms', () => {
    expect(expression('\\sqrt{1}')).toMatchInlineSnapshot(`1`);
    expect(expression('\\sqrt[3]{1}')).toMatchInlineSnapshot(`1`);
    expect(expression('\\frac{1}{\\sqrt[3]{1}}')).toMatchInlineSnapshot(`1`);
    expect(expression('\\frac{1}{\\sqrt[3]{\\sqrt{x}}}')).toMatchInlineSnapshot(
      `['Power', ['Power', 'x', ['Power', 2, -1]], ['Multiply', -1, ['Power', 3, -1]]]`
    );
  });
  test('Invalid forms', () => {
    expect(expression('\\sqrt')).toMatchInlineSnapshot(`['Sqrt']`);
    expect(expression('\\sqrt{}')).toMatchInlineSnapshot(`['Sqrt']`);
    expect(expression('1-')).toMatchInlineSnapshot(`[1, 'syntax-error']`);
    expect(expression('\\sqrt{1}[3]')).toMatchInlineSnapshot(
      `[1, 'syntax-error']`
    );
  });
});
