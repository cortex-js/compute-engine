import { canonical, parse } from '../../utils';

describe('ROOT FUNCTION', () => {
  test('Valid forms', () => {
    expect(parse('\\sqrt{1}')).toMatch('["Sqrt", 1]');
    expect(parse('\\sqrt[3]{1}')).toMatch('["Root", 1, 3]');
    expect(parse('\\frac{1}{\\sqrt[3]{1}}')).toMatch(
      '["Divide", 1, ["Root", 1, 3]]'
    );
    expect(canonical('\\frac{1}{\\sqrt[3]{1}}')).toMatchInlineSnapshot(`'1'`);
    expect(parse('\\frac{1}{\\sqrt[3]{\\sqrt{x}}}')).toMatch(
      '["Divide", 1, ["Root", ["Sqrt", "x"], 3]]'
    );
  });
  test('Invalid forms', () => {
    expect(parse('\\sqrt')).toMatchInlineSnapshot(`'["Sqrt", "Nothing"]'`);
    expect(parse('\\sqrt{}')).toMatchInlineSnapshot(`'["Sqrt", "Nothing"]'`);
    expect(parse('\\sqrt{1}[3]')).toMatchInlineSnapshot(
      `'["Error", ["Sqrt", 1], "'syntax-error'", ["LatexForm", "'[3]'"]]'`
    );
  });
});
