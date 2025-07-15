import { engine as ce } from '../../utils';

function parse(s) {
  return ce.parse(s);
}

describe('ROOT FUNCTION', () => {
  test('Valid forms', () => {
    expect(parse('\\sqrt{x}')).toMatchInlineSnapshot(`["Sqrt", "x"]`);
    expect(parse('\\sqrt[3]{x}')).toMatchInlineSnapshot(`["Root", "x", 3]`);
    expect(parse('\\sqrt[n]{x}')).toMatchInlineSnapshot(`["Root", "x", "n"]`);
    expect(parse('\\frac{1}{\\sqrt[3]{x}}')).toMatchInlineSnapshot(
      `["Root", "x", -3]`
    );
    //↓Because as part of canonicalization of 'Divide' which simplifies '1/x', the denominator is
    //simplified as part of the call to BoxedFunction.inv(): which in-turn calls .root()
    expect(parse('\\frac{1}{\\sqrt[3]{\\sqrt{x}}}')).toMatchInlineSnapshot(
      `["Root", "x", -6]`
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
        ["Error", "unexpected-operator", ["LatexString", "["]]
      ]
    `);
  });
});
