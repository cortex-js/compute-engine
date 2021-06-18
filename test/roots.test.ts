import { expression } from './utils';

describe('ROOT FUNCTION', () => {
  test('Valid forms', () => {
    expect(expression('\\sqrt{1}')).toMatchInlineSnapshot(`['Sqrt', 1]`);
    expect(expression('\\sqrt[3]{1}')).toMatchInlineSnapshot(`['Root', 1, 3]`);
    expect(expression('\\frac{1}{\\sqrt[3]{1}}')).toMatchInlineSnapshot(
      `['Divide', 1, ['Root', 1, 3]]`
    );
    expect(expression('\\frac{1}{\\sqrt[3]{\\sqrt{x}}}')).toMatchInlineSnapshot(
      `['Divide', 1, ['Root', ['Sqrt', 'x'], 3]]`
    );
  });
  test('Invalid forms', () => {
    expect(expression('\\sqrt')).toMatchInlineSnapshot(`['Sqrt']`);
    expect(expression('\\sqrt{}')).toMatchInlineSnapshot(`['Sqrt']`);
    expect(expression('\\sqrt{1}[3]')).toMatchInlineSnapshot(
      `[['Sqrt', 1], 'syntax-error']`
    );
  });
});
