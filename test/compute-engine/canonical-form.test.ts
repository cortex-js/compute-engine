import { check } from '../utils';

describe('CANONICAL FORMS', () => {
  test('-0', () => {
    expect(check('-0')).toMatchInlineSnapshot(`0`);
  });

  // Addition/substraction of 0 gets simplified in canonical  form
  test('a-0', () => {
    expect(check('a-0')).toMatchInlineSnapshot(`
      box       = ["Add", "a", 0]
      canonical = a
    `);
  });

  test('0-a', () => {
    expect(check('0-a')).toMatchInlineSnapshot(`
      box       = ["Add", 0, ["Negate", "a"]]
      canonical = ["Negate", "a"]
    `);
  });

  // Small integers are *not* coalesced in canonical form
  test('7 + 2 + 5"', () => {
    expect(check('7 + 2 + 5')).toMatchInlineSnapshot(`
      box       = ["Add", 7, 2, 5]
      canonical = ["Add", 2, 5, 7]
      simplify  = 14
    `);
  });

  // This one is tricky:
  // the simplifications of POWER and MULTIPLY
  // have to be done in the right order to get the correct result
  test('2^3x"', () => {
    expect(check('2^3x')).toMatchInlineSnapshot(`
      box       = ["InvisibleOperator", ["Power", 2, 3], "x"]
      canonical = ["Multiply", "x", ["Power", 2, 3]]
      simplify  = 8x
    `);
  });

  // Negative sign on denom, numer or both
  test('\\frac{-x}{-n}"', () => {
    expect(check('\\frac{-x}{-n}')).toMatchInlineSnapshot(`
      box       = ["Divide", ["Negate", "x"], ["Negate", "n"]]
      canonical = ["Divide", "x", "n"]
    `);
  });

  test('\\frac{x}{-n}"', () => {
    expect(check('\\frac{x}{-n}')).toMatchInlineSnapshot(`
      box       = ["Divide", "x", ["Negate", "n"]]
      canonical = ["Divide", ["Negate", "x"], "n"]
    `);
  });

  test('\\frac{-x}{n}"', () => {
    expect(check('\\frac{-x}{n}')).toMatchInlineSnapshot(
      `["Divide", ["Negate", "x"], "n"]`
    );
  });

  test('\\frac{-101}{10^{\\frac{2}{3}}}', () => {
    expect(check('\\frac{-101}{10^{\\frac{2}{3}}}')).toMatchInlineSnapshot(`
      box       = ["Divide", -101, ["Power", 10, ["Divide", 2, 3]]]
      canonical = ["Divide", -101, ["Power", 10, ["Rational", 2, 3]]]
      simplify  = -21.75979036932202893
      eval-auto = -21.75979036932202893
      eval-mach = -21.759790369322026
      N-auto    = -21.7597903693220255898
      N-mach    = -21.75979036932202
    `);
  });

  test('Prefer (numeric value) x (term) over (term / numeric value)', () => {
    expect(check('\\frac{x}{3}')).toMatchInlineSnapshot(`
      box       = ["Divide", "x", 3]
      canonical = ["Multiply", ["Rational", 1, 3], "x"]
      eval-auto = 1/3 * x
      eval-mach = 1/3 * x
      N-auto    = 0.333333333333333333333 * x
      N-mach    = 0.333333333333333 * x
    `);
  });

  test('Prefer (numeric value) x (term) over (integer x √(integer) x term)', () => {
    expect(check('3 \\sqrt{5} x')).toMatchInlineSnapshot(`
      box       = ["InvisibleOperator", 3, ["Sqrt", 5], "x"]
      canonical = ["Multiply", 3, ["Sqrt", 5], "x"]
      eval-auto = 3sqrt(5) * x
      eval-mach = 3sqrt(5) * x
      N-auto    = 6.70820393249936908923 * x
      N-mach    = 6.70820393249937 * x
    `);
  });

  test('Prefer (numeric value) x (term) over (integer x √(integer) x (term/integer))', () => {
    expect(check('3 \\sqrt{5} \\frac{x}{7}')).toMatchInlineSnapshot(`
      box       = ["InvisibleOperator", 3, ["Sqrt", 5], ["Divide", "x", 7]]
      canonical = ["Multiply", 3, ["Rational", 1, 7], ["Sqrt", 5], "x"]
      simplify  = 3/7sqrt(5) * x
      eval-auto = 3/7sqrt(5) * x
      eval-mach = 3/7sqrt(5) * x
      N-auto    = 0.958314847499909869891 * x
      N-mach    = 0.958314847499911 * x
    `);
  });

  test('Prefer (numeric value) x (term) over (integer x √(integer) x (term/integer))', () => {
    expect(check('3 \\sqrt{5} \\frac{x}{3}')).toMatchInlineSnapshot(`
      box       = ["InvisibleOperator", 3, ["Sqrt", 5], ["Divide", "x", 3]]
      canonical = ["Multiply", 3, ["Rational", 1, 3], ["Sqrt", 5], "x"]
      simplify  = sqrt(5) * x
      eval-auto = sqrt(5) * x
      eval-mach = sqrt(5) * x
      N-auto    = 2.23606797749978969641 * x
      N-mach    = 2.23606797749979 * x
    `);
  });

  test('Prefer (numeric value) x (term) over ((numeric value) x negate(term))', () => {
    expect(check('3 \\sqrt{5} (-x)')).toMatchInlineSnapshot(`
      box       = ["InvisibleOperator", 3, ["Sqrt", 5], ["Delimiter", ["Negate", "x"]]]
      canonical = ["Multiply", -3, ["Sqrt", 5], "x"]
      eval-auto = -3sqrt(5) * x
      eval-mach = -3sqrt(5) * x
      N-auto    = -6.70820393249936908923 * x
      N-mach    = -6.70820393249937 * x
    `);
  });

  test('Convert numbers followed by imaginary unit or radical to complex', () => {
    expect(check('3i+1.5i')).toMatchInlineSnapshot(`
      box       = ["Add", ["InvisibleOperator", 3, "i"], ["InvisibleOperator", 1.5, "i"]]
      canonical = ["Add", ["Complex", 0, 1.5], ["Complex", 0, 3]]
      simplify  = 4.5i
    `);
  });

  test('Convert numbers followed by radical to numeric value', () => {
    expect(check('5\\sqrt3\\frac17\\frac27\\sqrt5')).toMatchInlineSnapshot(`
      box       = [
        "InvisibleOperator",
        5,
        ["Sqrt", 3],
        ["Divide", 1, 7],
        ["Divide", 2, 7],
        ["Sqrt", 5]
      ]
      canonical = [
        "Multiply",
        5,
        ["Rational", 1, 7],
        ["Rational", 2, 7],
        ["Sqrt", 3],
        ["Sqrt", 5]
      ]
      simplify  = 10/49sqrt(15)
      eval-auto = 10/49sqrt(15)
      eval-mach = 10/49sqrt(15)
      N-auto    = 0.790404764532125894938
      N-mach    = 0.790404764532129
    `);
  });

  // Flatten, to multiple levels
  test('(1+(2+(3+4)))(((5+6)+7)((8+(9+10)))(11+(12+13)+14))', () => {
    expect(check('(1+(2+(3+4)))(((5+6)+7)((8+(9+10)))(11+(12+13)+14))'))
      .toMatchInlineSnapshot(`
      box       = [
        "InvisibleOperator",
        [
          "Delimiter",
          ["Add", 1, ["Delimiter", ["Add", 2, ["Delimiter", ["Add", 3, 4]]]]]
        ],
        [
          "Delimiter",
          [
            "InvisibleOperator",
            ["Delimiter", ["Add", ["Delimiter", ["Add", 5, 6]], 7]],
            [
              "Delimiter",
              ["Delimiter", ["Add", 8, ["Delimiter", ["Add", 9, 10]]]]
            ],
            ["Delimiter", ["Add", 11, ["Delimiter", ["Add", 12, 13]], 14]]
          ]
        ]
      ]
      canonical = [
        "Multiply",
        ["Add", 1, 2, 3, 4],
        ["Add", 11, 12, 13, 14],
        ["Add", 5, 6, 7],
        ["Add", 8, 9, 10]
      ]
      simplify  = 243000
    `);
  });

  // \frac should get hoisted with multiply, but not cancel
  // (multiplication by 0 does not always = 0)
  test('2x\\frac{0}{5}"', () => {
    expect(check('2x\\frac{0}{5}')).toMatchInlineSnapshot(`
      box       = ["InvisibleOperator", 2, "x", ["Divide", 0, 5]]
      canonical = ["Multiply", 0, 2, "x"]
      simplify  = 0
    `);
  });

  // Negative exponents become fractions
  test('(2xy)^{-n}"', () => {
    expect(check('(2xy)^{-n}')).toMatchInlineSnapshot(`
      box       = [
        "Power",
        ["Delimiter", ["InvisibleOperator", 2, "x", "y"]],
        ["Negate", "n"]
      ]
      canonical = ["Power", ["Multiply", 2, "x", "y"], ["Negate", "n"]]
      eval-auto = 1 / (2^n * x^n * y^n)
    `);
  });

  test('"2\\times0\\times5\\times4"', () => {
    expect(check('2\\times0\\times5\\times4')).toMatchInlineSnapshot(`
      box       = ["Multiply", 2, 0, 5, 4]
      canonical = ["Multiply", 0, 2, 4, 5]
      simplify  = 0
    `);
  });

  test('"2\\times(5-5)\\times5\\times4"', () => {
    expect(check('2\\times(5-5)\\times5\\times4')).toMatchInlineSnapshot(`
      box       = ["Multiply", 2, ["Delimiter", ["Subtract", 5, 5]], 5, 4]
      canonical = ["Multiply", 2, 4, 5, ["Subtract", 5, 5]]
      simplify  = 0
    `);
  });

  test('"2\\frac{x}{a}\\frac{y}{b}"', () => {
    expect(check('2\\frac{x}{a}\\frac{y}{b}')).toMatchInlineSnapshot(`
      box       = ["InvisibleOperator", 2, ["Divide", "x", "a"], ["Divide", "y", "b"]]
      canonical = ["Divide", ["Multiply", 2, "x", "y"], ["Multiply", "a", "b"]]
      eval-auto = (2x * y) / (a * b)
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
      box       = ["InvisibleOperator", "y", "x", 5, "z"]
      canonical = ["Multiply", 5, "x", "y", "z"]
    `);
  });

  // The arguments of commutative functions are sorted lexicographically
  // numerical constants (by value), then constants (lexicographically),
  // then free variables (lex),
  test(`Canonical form '-2x5z\\sqrt{y}\\frac{3}{4}3\\pi y'`, () => {
    expect(check('-2x5z\\sqrt{y}\\frac{3}{4}3\\pi y')).toMatchInlineSnapshot(`
      box       = [
        "InvisibleOperator",
        -2,
        "x",
        5,
        "z",
        ["Sqrt", "y"],
        ["Divide", 3, 4],
        3,
        "Pi",
        "y"
      ]
      canonical = [
        "Multiply",
        -2,
        3,
        5,
        ["Rational", 3, 4],
        "Pi",
        "x",
        "y",
        "z",
        ["Sqrt", "y"]
      ]
      simplify  = -45/2 * pi * x * z * y^(3/2)
      eval-auto = -45/2 * pi * x * z * y^(3/2)
      eval-mach = -45/2 * pi * x * z * y^(3/2)
      N-auto    = -70.6858347057703478658 * x * z * y^2
      N-mach    = -70.6858347057702 * x * z * y^2
    `);
  });

  test(`Canonical form '(b^3c^2d)(x^7y)(a^5g)(b^2x^5b3)'`, () => {
    expect(check('(b^3c^2d)(x^7y)(a^5g)(b^2x^5b3)')).toMatchInlineSnapshot(`
      box       = [
        "InvisibleOperator",
        [
          "Delimiter",
          ["InvisibleOperator", ["Power", "b", 3], ["Square", "c"], "d"]
        ],
        ["Delimiter", ["InvisibleOperator", ["Power", "x", 7], "y"]],
        ["Delimiter", ["InvisibleOperator", ["Power", "a", 5], "g"]],
        [
          "Delimiter",
          ["InvisibleOperator", ["Square", "b"], ["Power", "x", 5], "b", 3]
        ]
      ]
      canonical = [
        "Multiply",
        3,
        "b",
        "d",
        "g",
        "y",
        ["Power", "x", 7],
        ["Power", "a", 5],
        ["Power", "x", 5],
        ["Power", "b", 3],
        ["Square", "b"],
        ["Square", "c"]
      ]
      simplify  = 3d * g * y * x^(12) * b^6 * a^5 * c^2
    `);
  });
});

//
// POLYNOMIAL ORDER
// (for addition)
// Arguments of addition use the deglex sorting order:
// - by total degree (sum of the degrees of the factors),
// - by max degree (largest degree of the factors),
// - by lexicographic order of the factors.
// - by rank (constants, non-algebraic functions, numbers, etc...)
//

describe('POLYNOMIAL ORDER', () => {
  // -> a+b+c+5+7
  test(`Canonical form c+7+a+5+b`, () => {
    expect(check('c+7+a+5+b')).toMatchInlineSnapshot(`
      box       = ["Add", "c", 7, "a", 5, "b"]
      canonical = ["Add", "a", "b", "c", 5, 7]
      simplify  = a + b + c + 12
    `);
  });

  // 7a -> degree 1 > degree 0
  // 2b -> degree 1, b > a
  // 5c -> degree 1, c > b
  // 6 -> degree 0
  test(`Canonical form 6+5c+2b+3+7a'`, () => {
    expect(check('6+5c+2b+3+7a')).toMatchInlineSnapshot(`
      box       = [
        "Add",
        6,
        ["InvisibleOperator", 5, "c"],
        ["InvisibleOperator", 2, "b"],
        3,
        ["InvisibleOperator", 7, "a"]
      ]
      canonical = [
        "Add",
        ["Multiply", 7, "a"],
        ["Multiply", 2, "b"],
        ["Multiply", 5, "c"],
        3,
        6
      ]
      simplify  = 7a + 2b + 5c + 9
    `);
  });

  // Arguments sorted by value
  test(`Canonical form 5a+3a+7a`, () => {
    expect(check('5a+3a+7a')).toMatchInlineSnapshot(`
      box       = [
        "Add",
        ["InvisibleOperator", 5, "a"],
        ["InvisibleOperator", 3, "a"],
        ["InvisibleOperator", 7, "a"]
      ]
      canonical = [
        "Add",
        ["Multiply", 3, "a"],
        ["Multiply", 5, "a"],
        ["Multiply", 7, "a"]
      ]
      simplify  = 15a
    `);
  });

  test(`Canonical form x^{3}2\\pi+3x^{3}4\\pi+x^3`, () => {
    expect(check('x^{3}2\\pi+3x^{3}4\\pi+x^3')).toMatchInlineSnapshot(`
      box       = [
        "Add",
        ["InvisibleOperator", ["Power", "x", 3], 2, "Pi"],
        ["InvisibleOperator", 3, ["Power", "x", 3], 4, "Pi"],
        ["Power", "x", 3]
      ]
      canonical = [
        "Add",
        ["Multiply", 3, 4, "Pi", ["Power", "x", 3]],
        ["Multiply", 2, "Pi", ["Power", "x", 3]],
        ["Power", "x", 3]
      ]
      simplify  = 14pi * x^3 + x^3
      eval-auto = 14pi * x^3 + x^3
      eval-mach = 14pi * x^3 + x^3
      N-auto    = 44.9822971502571053383 * x^3
      N-mach    = 44.982297150257104 * x^3
    `);
  });

  test(`Canonical form 'x^2y^3+x^3y^2+xy^4+x^4y+x^2y^2'`, () => {
    expect(check('x^2y^3+x^3y^2+xy^4+x^4y+x^2y^2')).toMatchInlineSnapshot(`
      box       = [
        "Add",
        ["InvisibleOperator", ["Square", "x"], ["Power", "y", 3]],
        ["InvisibleOperator", ["Power", "x", 3], ["Square", "y"]],
        ["InvisibleOperator", "x", ["Power", "y", 4]],
        ["InvisibleOperator", ["Power", "x", 4], "y"],
        ["InvisibleOperator", ["Square", "x"], ["Square", "y"]]
      ]
      canonical = [
        "Add",
        ["Multiply", "y", ["Power", "x", 4]],
        ["Multiply", "x", ["Power", "y", 4]],
        ["Multiply", ["Power", "y", 3], ["Square", "x"]],
        ["Multiply", ["Power", "x", 3], ["Square", "y"]],
        ["Multiply", ["Square", "x"], ["Square", "y"]]
      ]
    `);
  });

  test(`Canonical form '(b^3b^2)+(a^3a^2)+(b^6)+(a^5b)+(a^5)'`, () => {
    expect(check('(b^3b^2)+(a^3a^2)+(b^6)+(a^5b)+(a^5)'))
      .toMatchInlineSnapshot(`
      box       = [
        "Add",
        [
          "Delimiter",
          ["InvisibleOperator", ["Power", "b", 3], ["Square", "b"]]
        ],
        [
          "Delimiter",
          ["InvisibleOperator", ["Power", "a", 3], ["Square", "a"]]
        ],
        ["Delimiter", ["Power", "b", 6]],
        ["Delimiter", ["InvisibleOperator", ["Power", "a", 5], "b"]],
        ["Delimiter", ["Power", "a", 5]]
      ]
      canonical = [
        "Add",
        ["Power", "b", 6],
        ["Multiply", "b", ["Power", "a", 5]],
        ["Power", "a", 5],
        ["Multiply", ["Power", "a", 3], ["Square", "a"]],
        ["Multiply", ["Power", "b", 3], ["Square", "b"]]
      ]
      simplify  = b^6 + b * a^5 + 2a^5 + b^5
    `);
  });

  test(`Canonical form '5c^2a^4+2b^8+7b^3a'`, () => {
    expect(check('5c^2a^4+2b^8+7b^3a')).toMatchInlineSnapshot(`
      box       = [
        "Add",
        ["InvisibleOperator", 5, ["Square", "c"], ["Power", "a", 4]],
        ["InvisibleOperator", 2, ["Power", "b", 8]],
        ["InvisibleOperator", 7, ["Power", "b", 3], "a"]
      ]
      canonical = [
        "Add",
        ["Multiply", 2, ["Power", "b", 8]],
        ["Multiply", 5, ["Power", "a", 4], ["Square", "c"]],
        ["Multiply", 7, "a", ["Power", "b", 3]]
      ]
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
