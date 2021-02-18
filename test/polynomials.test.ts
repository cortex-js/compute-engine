import { expressionError, printExpression } from './utils';

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

describe('POLYNOMIALS', () => {
  test('Univariate', () => {
    expect(expressionError('6x+2+3x^5')).toMatchInlineSnapshot(`[]`);
    expect(expressionError('6x+2+q+\\sqrt{2}x^3+c+3x^5')).toMatchInlineSnapshot(
      `[]`
    );
  });
  test('Multivariate', () => {
    expect(expressionError('y^4x^2+ 6x+2+3y^7x^5')).toMatchInlineSnapshot(`[]`);
  });
});
