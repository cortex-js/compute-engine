import { parse } from '../../utils';

describe('ROOT FUNCTION', () => {
  test('Valid forms', () => {
    expect(parse('\\sqrt{x}')).toMatch('["Sqrt", "x"]');
    expect(parse('\\sqrt[3]{x}')).toMatch('["Root", "x", 3]');
    expect(parse('\\sqrt[n]{x}')).toMatchInlineSnapshot(
      `["Power", "x", ["Divide", 1, "n"]]`
    );
    expect(parse('\\frac{1}{\\sqrt[3]{x}}')).toMatch(
      '["Divide", 1, ["Root", "x", 3]]'
    );
    expect(parse('\\frac{1}{\\sqrt[3]{\\sqrt{x}}}')).toMatch(
      '["Divide", 1, ["Root", ["Sqrt", "x"], 3]]'
    );
  });
});

describe('ROOT FUNCTION (INVALID FORMS)', () => {
  test('Invalid forms', () => {
    expect(parse('\\sqrt')).toMatchInlineSnapshot(
      `["Sqrt", ["Error", "'missing'"]]`
    );
    expect(parse('\\sqrt{}')).toMatchInlineSnapshot(
      `["Sqrt", ["Error", "'missing'"]]`
    );
    expect(parse('\\sqrt{5}[3]')).toMatchInlineSnapshot(`
      [
        "Sequence",
        ["Sqrt", 5],
        ["Error", ["ErrorCode", "'unexpected-token'", "'['"]]
      ]
    `);
  });
});
