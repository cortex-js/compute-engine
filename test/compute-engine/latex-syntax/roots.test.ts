import { engine as ce } from '../../utils';

function parse(s) {
  return ce.parse(s);
}

describe('ROOT FUNCTION', () => {
  test('Valid forms', () => {
    expect(parse('\\sqrt{x}')).toMatchInlineSnapshot(`["Sqrt", "x"]`);
    expect(parse('\\sqrt[3]{x}')).toMatchInlineSnapshot(`["Root", "x", 3]`);
    expect(parse('\\sqrt[n]{x}')).toMatchInlineSnapshot(`["Root", "x", "n"]`);
    // Negative fractional exponents canonicalize to the reciprocal-of-root
    // form `1/Root(a, n)`, never the nonstandard, unparseable `Root(a, -n)`
    // (`\sqrt[-n]{a}`) — uniform with `x^{-1/2} → 1/√x` (#13).
    expect(parse('\\frac{1}{\\sqrt[3]{x}}')).toMatchInlineSnapshot(
      `["Divide", 1, ["Root", "x", 3]]`
    );
    // Nested radicals still combine first (∛√x → Root(x, 6)) before the
    // reciprocal is formed.
    expect(parse('\\frac{1}{\\sqrt[3]{\\sqrt{x}}}')).toMatchInlineSnapshot(
      `["Divide", 1, ["Root", "x", 6]]`
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
