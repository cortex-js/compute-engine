import { expressionError } from '../../utils';

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
