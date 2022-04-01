import { check } from '../utils';

describe('CANONICAL FORMS', () => {
  test('-0', () => {
    expect(check('-0')).toMatchInlineSnapshot(`'0'`);
  });

  // Addition/substraction of 0 gets simplified in canonical  form
  test('a-0', () => {
    expect(check('a-0')).toMatchInlineSnapshot(`
      'box      = ["Subtract", "a", 0]
      canonical = "a"'
    `);
  });

  test('0-a', () => {
    expect(check('0-a')).toMatchInlineSnapshot(`
      'box      = ["Subtract", 0, "a"]
      canonical = ["Negate", "a"]'
    `);
  });

  // Small integers are *not* coalesced in canonical form
  test('7 + 2 + 5"', () => {
    expect(check('7 + 2 + 5')).toMatchInlineSnapshot(`
      'box      = ["Add", 7, 2, 5]
      canonical = 14'
    `);
  });

  // This one is tricky:
  // the simplifications of POWER and MULTIPLY
  // have to be done in the right order to get the correct result
  test('2^3x"', () => {
    expect(check('2^3x')).toMatchInlineSnapshot(`
      'box      = ["Multiply", ["Power", 2, 3], "x"]
      canonical = ["Multiply", 8, "x"]'
    `);
  });

  // Negative sign on denom, numer or both
  test('\\frac{-x}{-n}"', () => {
    expect(check('\\frac{-x}{-n}')).toMatchInlineSnapshot(`
      'box      = ["Divide", ["Negate", "x"], ["Negate", "n"]]
      canonical = ["Divide", "x", "n"]'
    `);
  });

  test('\\frac{x}{-n}"', () => {
    expect(check('\\frac{x}{-n}')).toMatchInlineSnapshot(`
      'box      = ["Divide", "x", ["Negate", "n"]]
      canonical = ["Negate", ["Divide", "x", "n"]]'
    `);
  });

  test('\\frac{-x}{n}"', () => {
    expect(check('\\frac{-x}{n}')).toMatchInlineSnapshot(`
      'box      = ["Divide", ["Negate", "x"], "n"]
      canonical = ["Negate", ["Divide", "x", "n"]]'
    `);
  });

  test('\\frac{-101}{10^{\\frac{2}{3}}}"', () => {
    expect(check('\\frac{-101}{10^{\\frac{2}{3}}}')).toMatchInlineSnapshot(`
      'box      = ["Divide", -101, ["Power", 10, ["Rational", 2, 3]]]
      canonical = ["Negate", ["Divide", 101, ["Power", 10, ["Rational", 2, 3]]]]
      simplify  = ["Divide", -101, ["Power", 10, ["Rational", 2, 3]]]
      N         = ["num": "-21.75979036932202558976886502184544000211938391614029668314127861409875217714824208187295918578675709"]'
    `);
  });

  // Flatten, to multiple levels
  test('(1+(2+(3+4)))(((5+6)+7)((8+(9+10)))(11+(12+13)+14))"', () => {
    expect(check('(1+(2+(3+4)))(((5+6)+7)((8+(9+10)))(11+(12+13)+14))'))
      .toMatchInlineSnapshot(`
      'box      = ["Multiply", ["Delimiter", ["Add", 1, ["Delimiter", ["Add", 2, ["Delimiter", ["Add", 3, 4]]]]]], ["Delimiter", ["Multiply", ["Delimiter", ["Add", ["Delimiter", ["Add", 5, 6]], 7]], ["Delimiter", ["Delimiter", ["Add", 8, ["Delimiter", ["Add", 9, 10]]]]], ["Delimiter", ["Add", 11, ["Delimiter", ["Add", 12, 13]], 14]]]]]
      canonical = 243000'
    `);
  });

  // \frac should get hoisted with multiply, but not cancel
  // (multiplication by 0 does not always = 0)
  test('2x\\frac{0}{5}"', () => {
    expect(check('2x\\frac{0}{5}')).toMatchInlineSnapshot(`
      'box      = ["Multiply", 2, "x", 0]
      canonical = 0'
    `);
  });

  // Negative exponents become fractions
  test('2xy^{-n}"', () => {
    expect(check('2xy^{-n}')).toMatchInlineSnapshot(
      `'["Multiply", 2, "x", ["Power", "y", ["Negate", "n"]]]'`
    );
  });

  test('2\\times0\\times5\\times4"', () => {
    expect(check('2\\times0\\times5\\times4')).toMatchInlineSnapshot(`
      'box      = ["Multiply", 2, 0, 5, 4]
      canonical = 0'
    `);
  });

  test('2\\times(5-5)\\times5\\times4"', () => {
    expect(check('2\\times(5-5)\\times5\\times4')).toMatchInlineSnapshot(`
      'box      = ["Multiply", 2, ["Delimiter", ["Subtract", 5, 5]], 5, 4]
      canonical = 0'
    `);
  });

  test('2\\frac{x}{a}\\frac{y}{b}"', () => {
    expect(check('2\\frac{x}{a}\\frac{y}{b}')).toMatchInlineSnapshot(`
      'box      = ["Multiply", 2, ["Divide", "x", "a"], ["Divide", "y", "b"]]
      canonical = ["Divide", ["Multiply", 2, "x", "y"], ["Multiply", "a", "b"]]'
    `);
  });
});

//
// COMMUTATIVE ORDER
// (for multiplication, and other commutative functios, except addition)
//
describe('COMMUTATIVE ORDER', () => {
  // multiply is commutative and regular canonical sort order applies
  // (numbers before symbols)
  test(`Canonical form yx5z`, () => {
    expect(check('yx5z')).toMatchInlineSnapshot(`
      'box      = ["Multiply", "y", "x", 5, "z"]
      canonical = ["Multiply", 5, "x", "y", "z"]'
    `);
  });

  // The arguments of commutative functions are sorted lexicographically
  // numerical constants (by value), then constants (lexicographically),
  // then free variables (lex),
  test(`Canonical form '-2x5z\\sqrt{y}\\frac{3}{4}3\\pi y'`, () => {
    expect(check('-2x5z\\sqrt{y}\\frac{3}{4}3\\pi y')).toMatchInlineSnapshot(`
      'box      = ["Negate", ["Multiply", 2, "x", 5, "z", ["Sqrt", "y"], ["Rational", 3, 4], 3, "Pi", "y"]]
      canonical = ["Negate", ["Multiply", ["Rational", 45, 2], "Pi", "x", "z", ["Power", "y", ["Rational", 3, 2]]]]
      simplify  = ["Multiply", ["Rational", -45, 2], "Pi", "x", "z", ["Power", "y", ["Rational", 3, 2]]]
      N         = ["Multiply", -1, ["num": "70.68583470577034786540947612378881489443631148593988097193625332692586914143970246913078357019763403"], "x", "z", ["Power", "y", 1.5]]'
    `);
  });

  test(`Canonical form '(b^3c^2d)(x^7y)(a^5f)(b^2x^5b3)'`, () => {
    expect(check('(b^3c^2d)(x^7y)(a^5f)(b^2x^5b3)')).toMatchInlineSnapshot(`
      'box      = ["Multiply", ["Delimiter", ["Multiply", ["Power", "b", 3], ["Power", "c", 2], "d"]], ["Delimiter", ["Multiply", ["Power", "x", 7], "y"]], ["Delimiter", ["Multiply", ["Power", "a", 5], "f"]], ["Delimiter", ["Multiply", ["Power", "b", 2], ["Power", "x", 5], "b", 3]]]
      canonical = ["Multiply", 3, "d", "f", "y", ["Square", "c"], ["Power", "a", 5], ["Power", "b", 6], ["Power", "x", 12]]'
    `);
  });
});

//
// POLYNOMIAL ORDER
// (for addition)
//

describe('POLYNOMIAL ORDER', () => {
  // addition is deglex ordered, numbers after symbols
  test(`Canonical form c+7+a+5+b`, () => {
    expect(check('c+7+a+5+b')).toMatchInlineSnapshot(`
      'box      = ["Add", "c", 7, "a", 5, "b"]
      canonical = ["Add", 12, "a", "b", "c"]'
    `);
  });

  // 7a -> degree 1 > degree 0
  // 2b -> degree 1, b > a
  // 5c -> degree 1, c > b
  // 6 -> degree 0
  test(`Canonical form 6+5c+2b+3+7a'`, () => {
    expect(check('6+5c+2b+3+7a')).toMatchInlineSnapshot(`
      'box      = ["Add", 6, ["Multiply", 5, "c"], ["Multiply", 2, "b"], 3, ["Multiply", 7, "a"]]
      canonical = ["Add", 9, ["Multiply", 7, "a"], ["Multiply", 2, "b"], ["Multiply", 5, "c"]]'
    `);
  });

  // Arguments sorted by value
  test(`Canonical form 5a+3a+7a`, () => {
    expect(check('5a+3a+7a')).toMatchInlineSnapshot(`
      'box      = ["Add", ["Multiply", 5, "a"], ["Multiply", 3, "a"], ["Multiply", 7, "a"]]
      canonical = ["Multiply", 15, "a"]'
    `);
  });

  // deglex sorting order
  // by total degree, then lexicographically
  // If degree is the same, longest factor
  test(`Canonical form x^{3}2\\pi+3x^{3}4\\pi+x^3`, () => {
    expect(check('x^{3}2\\pi+3x^{3}4\\pi+x^3')).toMatchInlineSnapshot(`
      'box      = ["Add", ["Multiply", ["Power", "x", 3], 2, "Pi"], ["Multiply", 3, ["Power", "x", 3], 4, "Pi"], ["Power", "x", 3]]
      canonical = ["Add", ["Multiply", 14, "Pi", ["Power", "x", 3]], ["Power", "x", 3]]
      N         = ["Add", ["Multiply", ["num": "43.98229715025710533847700736591304037876037159125148149364922429230942968800692598079248755478963895"], ["Power", "x", 3]], ["Power", "x", 3]]'
    `);
  });

  test(`Canonical form 'x^2y^3+x^3y^2+xy^4+x^4y+x^2y^2'`, () => {
    expect(check('x^2y^3+x^3y^2+xy^4+x^4y+x^2y^2')).toMatchInlineSnapshot(`
      'box      = ["Add", ["Multiply", ["Power", "x", 2], ["Power", "y", 3]], ["Multiply", ["Power", "x", 3], ["Power", "y", 2]], ["Multiply", "x", ["Power", "y", 4]], ["Multiply", ["Power", "x", 4], "y"], ["Multiply", ["Power", "x", 2], ["Power", "y", 2]]]
      canonical = ["Add", ["Multiply", ["Square", "x"], ["Power", "y", 3]], ["Multiply", ["Square", "x"], ["Square", "y"]], ["Multiply", "x", ["Power", "y", 4]], ["Multiply", ["Square", "y"], ["Power", "x", 3]], ["Multiply", "y", ["Power", "x", 4]]]'
    `);
  });

  test(`Canonical form '(b^3b^2)+(a^3a^2)+(b^6)+(a^5b)+(a^5)'`, () => {
    expect(check('(b^3b^2)+(a^3a^2)+(b^6)+(a^5b)+(a^5)'))
      .toMatchInlineSnapshot(`
      'box      = ["Add", ["Delimiter", ["Multiply", ["Power", "b", 3], ["Power", "b", 2]]], ["Delimiter", ["Multiply", ["Power", "a", 3], ["Power", "a", 2]]], ["Delimiter", ["Power", "b", 6]], ["Delimiter", ["Multiply", ["Power", "a", 5], "b"]], ["Delimiter", ["Power", "a", 5]]]
      canonical = ["Add", ["Multiply", 2, ["Power", "a", 5]], ["Power", "b", 6], ["Power", "b", 5], ["Multiply", "b", ["Power", "a", 5]]]'
    `);
  });

  test(`Canonical form '5c^2a^4+2b^8+7b^3a'`, () => {
    expect(check('5c^2a^4+2b^8+7b^3a')).toMatchInlineSnapshot(`
      'box      = ["Add", ["Multiply", 5, ["Power", "c", 2], ["Power", "a", 4]], ["Multiply", 2, ["Power", "b", 8]], ["Multiply", 7, ["Power", "b", 3], "a"]]
      canonical = ["Add", ["Multiply", 7, "a", ["Power", "b", 3]], ["Multiply", 2, ["Power", "b", 8]], ["Multiply", 5, ["Square", "c"], ["Power", "a", 4]]]'
    `);
  });
});

// describe('OBJECT LITERAL FORM', () => {
//   test('Shorthand parse', () => {
//     expect(
//       engine.format(['Add', 'x', ['Sin', 'Pi'], 2], ['object-literal'])
//     ).toMatchInlineSnapshot(
//       `{fn: [{sym: 'Add'}, {sym: 'x'}, {fn: [{sym: 'Sin'}, {sym: 'Pi'}]}, {num: '2'}]}`
//     );
//   });
//   test('Expression with metadata', () => {
//     expect(
//       engine.format(
//         [
//           { sym: 'Add', metadata: 'add' },
//           { sym: 'x', metadata: 'ecks' },
//           { fn: ['Sin', 'Pi'], metadata: 'fn-md' },
//           { num: '1', metadata: 'one' },
//         ] as any,
//         ['object-literal']
//       )
//     ).toMatchInlineSnapshot(
//       `{fn: [{sym: 'Add', metadata: 'add'}, {sym: 'x', metadata: 'ecks'}, {fn: [{sym: 'Sin'}, {sym: 'Pi'}], metadata: 'fn-md'}, {num: '1', metadata: 'one'}]}`
//     );
//   });
// });
