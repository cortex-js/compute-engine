import { expression } from './utils';

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
