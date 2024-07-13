/* eslint-disable no-restricted-globals */
/**
 * This file contains a series of lightweight tests. More exhaustive tests
 * are included in the `./test/compute-engine` and
 * `./test/latex-syntax` directories.
 *
 * They are divided in:
 * - boxing (MathJSON to boxed expressions)
 * - parsing (LaTeX to boxed expressions)
 * - serializing (boxed expressions to Latex)
 * - canonicalization
 * - simplification
 * - symbolic evaluation
 * - numerical evaluation
 */

import { Expression } from '../../src/math-json/math-json-format';
import { engine, simplify } from '../utils';

const ce = engine;

function parseToJson(latex: string): Expression {
  return engine.parse(latex, { canonical: false }).json;
}

function canonicalToJson(latex: string): Expression {
  return engine.parse(latex).json;
}

function evaluateToJson(latex: string): Expression {
  return engine.parse(latex).evaluate()?.toMathJson() ?? 'NULL';
}

function NToJson(latex: string): Expression {
  // toMathJson() produces a sugared expression, unlike .json
  return engine.parse(latex).N().toMathJson({ fractionalDigits: 'max' });
}

function customCanonical(expr) {
  if (typeof expr.value === 'number') {
    if (expr.head === 'Divide' || expr.head === 'Rational') {
      if (expr.engine.box(['GCD', expr.op1, expr.op2]).value !== 1) return expr;
    }
    return expr.engine.number(expr.value);
  }

  if (expr.ops)
    return expr.engine.box([expr.head, ...expr.ops.map(customCanonical)], {
      canonical: ['InvisibleOperator', 'Order', 'Flatten'],
    });

  return expr.canonical;
}

//
// BOXING
//

// describe('BOXING', () => {});

//
// PARSING
//

describe('PARSING numbers', () => {
  test(`{ num: '-12n' }`, () => {
    // The `n` prefix is not necessary, but is supported for legacy reasons
    // (an earlier version of the MathJSON spec included it)
    expect(ce.box({ num: '-12n' }).numericValue).toEqual(-12);
  });
  test(`-2+3-4`, () => {
    expect(ce.parse('-2+3-4')).toMatchInlineSnapshot(`["Add", -4, -2, 3]`);
  });
  test(`-i`, () => {
    expect(ce.parse('-i')).toMatchInlineSnapshot(`["Negate", "ImaginaryUnit"]`);
  });

  test(`3.424242334e4`, () =>
    expect(parseToJson('3.424242334e4')).toEqual(34242.42334));

  // Should not sum, loss of precision (very big intger + small integer)
  test(`1 + 1e199`, () =>
    expect(ce.parse('1 + 1e199')).toMatchInlineSnapshot(`["Add", 1, 1e+199]`));

  test(`421.35e+1000`, () =>
    expect(ce.parse('421.35e+1000')).toMatchInlineSnapshot(`4.2135e+1002`));

  test(`\\frac34 + 1e199`, () =>
    expect(ce.parse('\\frac34 + 1e199')).toMatchInlineSnapshot(
      '["Add", ["Rational", 3, 4], 1e+199]'
    ));

  test(`-5-2-3 (non-canonical)`, () =>
    expect(ce.parse('-5-2-3')).toMatchInlineSnapshot(`["Add", -5, -3, -2]`));

  test(`5+3+2 (non-canonical)`, () =>
    expect(parseToJson('5+3+2')).toMatchInlineSnapshot(`
      [
        Add,
        5,
        3,
        2,
      ]
    `));

  // From https://github.com/uellenberg/Logimat/tree/master/examples/nth-prime

  test('nth prime', () =>
    expect(
      ce.parse(
        'p(n):=(\\sum_{v_{1}=2}^{\\operatorname{floor}\\left(1.5*n*\\ln(n)\\right)}(\\operatorname{floor}(\\frac{1}{0^{n-(\\sum_{v_{2}=2}^{v_{1}}((\\prod_{v_{3}=2}^{\\operatorname{floor}(\\sqrt{v_{2}})}(1-0^{\\operatorname{abs}(\\operatorname{floor}(\\frac{v_{2}}{v_{3}})-\\frac{v_{2}}{v_{3}})}))))}+1})))+2'
      )
    ).toMatchInlineSnapshot(`
      [
        "Assign",
        "p",
        [
          "Function",
          [
            "Add",
            [
              "Delimiter",
              [
                "Sum",
                [
                  "Delimiter",
                  [
                    "Floor",
                    [
                      "Divide",
                      1,
                      [
                        "Add",
                        [
                          "Power",
                          0,
                          [
                            "Add",
                            "n",
                            [
                              "Negate",
                              [
                                "Delimiter",
                                [
                                  "Sum",
                                  [
                                    "Delimiter",
                                    [
                                      "Delimiter",
                                      [
                                        "Product",
                                        [
                                          "Delimiter",
                                          [
                                            "Add",
                                            1,
                                            [
                                              "Power",
                                              0,
                                              [
                                                "Abs",
                                                [
                                                  "Add",
                                                  [
                                                    "Floor",
                                                    [
                                                      "Divide",
                                                      ["At", "v", 2],
                                                      ["At", "v", 3]
                                                    ]
                                                  ],
                                                  [
                                                    "Negate",
                                                    [
                                                      "Divide",
                                                      ["At", "v", 2],
                                                      ["At", "v", 3]
                                                    ]
                                                  ]
                                                ]
                                              ]
                                            ]
                                          ]
                                        ],
                                        [
                                          "Tuple",
                                          ["At", "v", 3],
                                          2,
                                          ["Floor", ["Sqrt", ["At", "v", 2]]]
                                        ]
                                      ]
                                    ]
                                  ],
                                  [
                                    "Tuple",
                                    ["At", "v", 2],
                                    2,
                                    ["At", "v", 1]
                                  ]
                                ]
                              ]
                            ]
                          ]
                        ],
                        1
                      ]
                    ]
                  ]
                ],
                [
                  "Tuple",
                  ["At", "v", 1],
                  2,
                  ["Floor", ["Multiply", 1.5, "n", ["Ln", "n"]]]
                ]
              ]
            ],
            2
          ],
          "n"
        ]
      ]
    `));
});

describe('PARSING symbols', () => {
  test('x', () => expect(ce.parse('x')).toMatchInlineSnapshot('x'));
  test('\\pi', () => expect(ce.parse('\\pi')).toMatchInlineSnapshot('Pi'));
  test('3\\pi', () => {
    expect(ce.parse('3\\pi')).toMatchInlineSnapshot(`["Multiply", 3, "Pi"]`);
  });
});

describe('PARSING functions', () => {
  test(`\\frac{-x}{-n}`, () => {
    expect(ce.parse('\\frac{-x}{-n}')).toMatchInlineSnapshot(
      `["Divide", "x", "n"]`
    );
  });
});

//
// SERIALIZING
//

describe('SERIALIZING Incomplete expressions', () => {
  test(`['Multiply', 2, ['Rational', 1, 3]]`, () => {
    expect(
      engine.box(['Multiply', 2, ['Rational', 1, 3]]).latex
    ).toMatchInlineSnapshot(`\\frac{2}{3}`);
  });
  test(`['Divide']`, () =>
    expect(ce.box(['Divide'], { canonical: false })).toMatchInlineSnapshot(
      `["Divide"]`
    ));
  test(`['Power', undefined]`, () =>
    expect(
      ce.box(['Power', undefined as unknown as Expression], {
        canonical: false,
      })
    ).toMatchInlineSnapshot(`["Power", ["Sequence"]]`));
});

describe('SERIALIZING Negative factors', () => {
  test(`(-2)\\times(-x)\\times y\\times\\frac{3}{-5}`, () => {
    expect(
      engine.parse('(-2)\\times(-x)\\times y\\times\\frac{3}{-5}').latex
    ).toMatchInlineSnapshot(`\\frac{-2\\times3xy}{5}`);
  });
});

//
// CANONICALIZATION
//

describe('CANONICALIZATION negate', () => {
  test('Negate', () => {
    expect(canonicalToJson('-(5)')).toEqual(-5);
  });
  test(`-(-x)`, () => {
    expect(canonicalToJson('-(-x)')).toEqual('x');
  });
  test(`2-q`, () => {
    expect(canonicalToJson('2-q')).toMatchInlineSnapshot(`
      [
        Add,
        [
          Negate,
          q,
        ],
        2,
      ]
    `);
  });
});
describe('CANONICALIZATION Add', () => {
  test('7 + 2 + 5', () =>
    expect(canonicalToJson('7 + 2 + 5')).toMatchObject(['Add', 2, 5, 7]));

  test(`7 + \\frac12`, () =>
    expect(canonicalToJson('7 + \\frac12')).toMatchInlineSnapshot(`
      [
        Add,
        [
          Rational,
          1,
          2,
        ],
        7,
      ]
    `));

  test(`1 + 2 + x`, () =>
    expect(canonicalToJson('1 + 2 + x')).toMatchObject(['Add', 'x', 1, 2]));

  test(`1 + \\infty`, () =>
    expect(canonicalToJson('1 + \\infty')).toMatchInlineSnapshot(`
      [
        Add,
        1,
        PositiveInfinity,
      ]
    `));

  test(`7 + (2 + 5) // Associative`, () =>
    expect(canonicalToJson('7 + (2 + 5)')).toMatchInlineSnapshot(`
      [
        Add,
        2,
        5,
        7,
      ]
    `));

  test(`-2+a+b`, () =>
    expect(canonicalToJson('-2+a+b')).toMatchInlineSnapshot(`
      [
        Add,
        a,
        b,
        -2,
      ]
    `));

  test(`-2+a^2+a+a^2`, () =>
    expect(canonicalToJson('-2+a^2+a+a^2')).toMatchInlineSnapshot(`
      [
        Add,
        [
          Power,
          a,
          2,
        ],
        [
          Power,
          a,
          2,
        ],
        a,
        -2,
      ]
    `));
});
describe('CANONICALIZATION multiply', () => {
  test('2\\times3', () =>
    expect(canonicalToJson('2\\times3')).toMatchInlineSnapshot(`
      [
        Multiply,
        2,
        3,
      ]
    `));

  test(`-2\\times-3`, () =>
    expect(canonicalToJson('-2\\times-3')).toMatchInlineSnapshot(`
      [
        Multiply,
        2,
        3,
      ]
    `));

  test(`x\\times(-y)`, () =>
    expect(canonicalToJson('x\\times(-y)')).toMatchObject([
      'Negate',
      ['Multiply', 'x', 'y'],
    ]));

  test(`2\\times\\frac12`, () =>
    expect(canonicalToJson('2\\times\\frac12')).toMatchInlineSnapshot(`
      [
        Multiply,
        [
          Rational,
          1,
          2,
        ],
        2,
      ]
    `));

  test(`2\\times(5-5)\\times5\\times4`, () =>
    expect(canonicalToJson('2\\times(5-5)\\times5\\times4'))
      .toMatchInlineSnapshot(`
      [
        Multiply,
        2,
        4,
        5,
        [
          Add,
          -5,
          5,
        ],
      ]
    `));

  test(`(-2)\\times(-x)\\times y\\times\\frac{3}{-5}`, () =>
    expect(canonicalToJson('(-2)\\times(-x)\\times y\\times\\frac{3}{-5}'))
      .toMatchInlineSnapshot(`
      [
        Multiply,
        -2,
        [
          Rational,
          3,
          5,
        ],
        x,
        y,
      ]
    `));

  test(`'1\\times x\\times 2\\times -5.23 \\times 3.2 \\times \\frac23\\times \\frac1x  // Commutative order'`, () => {
    expect(
      canonicalToJson(
        '1\\times x\\times 2\\times -5.23 \\times 3.2 \\times \\frac23\\times \\frac1x'
      )
    ).toMatchInlineSnapshot(`
      [
        Multiply,
        -2,
        [
          Rational,
          2,
          3,
        ],
        3.2,
        5.23,
        x,
        [
          Divide,
          1,
          x,
        ],
      ]
    `);
  });
});
describe('CANONICALIZATION divide', () => {
  test(`\\frac{-x}{-n}`, () => {
    expect(canonicalToJson('\\frac{-x}{-n}')).toMatchObject([
      'Divide',
      'x',
      'n',
    ]);
  });
  test(`\\frac{-x}{2}`, () => {
    expect(canonicalToJson('\\frac{-x}{2}')).toMatchInlineSnapshot(`
      [
        Divide,
        [
          Negate,
          x,
        ],
        2,
      ]
    `);
  });
  test(`\\frac{-x}{\\frac{1}{n}}`, () => {
    expect(canonicalToJson('\\frac{-x}{\\frac{1}{n}}')).toMatchInlineSnapshot(`
      [
        Negate,
        [
          Multiply,
          n,
          x,
        ],
      ]
    `);
  });
});
describe('CANONICALIZATION sqrt', () => {
  test('\\sqrt{3^2}', () => {
    expect(canonicalToJson('\\sqrt{3^2}')).toMatchInlineSnapshot(`3`);
    // Canonical of Sqrt should not transform to Power
    expect(canonicalToJson('\\sqrt{12}')).toMatchInlineSnapshot(`
      [
        Sqrt,
        12,
      ]
    `);
  });
  test(`\\sqrt[3]{x}`, () =>
    expect(canonicalToJson('\\sqrt[3]{x}')).toMatchInlineSnapshot(`
      [
        Power,
        x,
        [
          Rational,
          1,
          3,
        ],
      ]
    `));
  test(`\\sqrt{x}`, () =>
    expect(canonicalToJson('\\sqrt{x}')).toMatchInlineSnapshot(`
      [
        Power,
        x,
        [
          Rational,
          1,
          2,
        ],
      ]
    `));
});
describe('CANONICALIZATION invisible operators', () => {
  test('2x // invisible multiply', () => {
    expect(canonicalToJson('2x')).toMatchObject(['Multiply', 2, 'x']);
  });
  test(`'3\\frac18 // invisible add`, () =>
    expect(canonicalToJson('3\\frac18')).toMatchInlineSnapshot(`
      [
        Add,
        3,
        [
          Rational,
          1,
          8,
        ],
      ]
    `));
  test(`2(x)`, () =>
    expect(canonicalToJson('2(x)')).toMatchObject(['Multiply', 2, 'x']));
  test(`(2)(x)`, () =>
    expect(canonicalToJson('(2)(x)')).toMatchObject(['Multiply', 2, 'x']));
  test(`2x+x`, () =>
    expect(canonicalToJson('2x+x')).toMatchInlineSnapshot(`
      [
        Add,
        [
          Multiply,
          2,
          x,
        ],
        x,
      ]
    `));
});

//
// SIMPLIFICATION
//

describe('SIMPLIFICATION add', () => {
  test('7 + 2 + 5', () => expect(simplify('7 + 2 + 5')).toEqual('14'));
  test(`2-q`, () =>
    expect(simplify('2-q')).toMatchInlineSnapshot(`["Subtract", 2, "q"]`));

  test(`-i`, () =>
    expect(simplify('-i')).toMatchInlineSnapshot(
      `["Negate", "ImaginaryUnit"]`
    )); // @fixme ['Complex', 0, -1]?
  test(`3-i`, () =>
    expect(simplify('3-i')).toMatchInlineSnapshot(`["Complex", 3, -1]`));

  test(`2\\sqrt{3}+\\sqrt{1+2}`, () =>
    expect(simplify('2\\sqrt{3}+\\sqrt{1+2}')).toMatchInlineSnapshot(
      `["Multiply", 3, ["Sqrt", 3]]`
    ));

  test(`2x+x`, () =>
    expect(simplify('2x+x')).toMatchInlineSnapshot(`["Multiply", 3, "x"]`));
});

describe('SIMPLIFICATION divide', () => {
  test(`simplify('\\frac{\\sqrt{5040}}{3}')`, () =>
    expect(simplify('\\frac{\\sqrt{5040}}{3}')).toMatchInlineSnapshot(
      `["Multiply", 4, ["Sqrt", 35]]`
    ));

  test(`'\\frac{-x}{-n}'`, () =>
    expect(simplify('\\frac{-x}{-n}')).toMatchInlineSnapshot(
      `["Divide", "x", "n"]`
    ));

  test(`\\frac{5}{\\frac{7}{x}}`, () =>
    expect(simplify('\\frac{5}{\\frac{7}{x}}')).toMatchInlineSnapshot(
      `["Divide", ["Multiply", 5, "x"], 7]`
    ));

  test(`simplify('\\frac{\\sqrt{15}}{\\sqrt{3}}')`, () =>
    expect(simplify('\\frac{\\sqrt{15}}{\\sqrt{3}}')).toMatchInlineSnapshot(
      `["Sqrt", 5]`
    ));
});

describe('SIMPLIFICATION sqrt', () => {
  test(`\\sqrt{5040}`, () =>
    expect(evaluateToJson('\\sqrt{5040}')).toMatchInlineSnapshot(`
      [
        Multiply,
        12,
        [
          Sqrt,
          35,
        ],
      ]
    `));

  test(`simplify('\\sqrt{3^2}')`, () =>
    expect(simplify('\\sqrt{3^2}')).toMatchInlineSnapshot(`3`));

  test(`evaluate('\\sqrt{12}')`, () =>
    expect(evaluateToJson('\\sqrt{12}')).toMatchInlineSnapshot(`
      [
        Multiply,
        2,
        [
          Sqrt,
          3,
        ],
      ]
    `));

  // A math olympiad problem
  // Simplify[ToExpression["\\frac{\\sqrt{4+2\\sqrt{3}}-\\sqrt{28+10\\sqrt{3}}}{15}", TeXForm]]
  // Result is \frac{-4}{15}
  test(`simplify('\\frac{\\sqrt{4+2\\sqrt{3}}-\\sqrt{28+10\\sqrt{3}}}{15}')`, () =>
    expect(
      evaluateToJson('\\frac{\\sqrt{4+2\\sqrt{3}}-\\sqrt{28+10\\sqrt{3}}}{15}')
    ).toMatchInlineSnapshot(`
      [
        Divide,
        [
          Multiply,
          [
            Sqrt,
            2,
          ],
          [
            Subtract,
            [
              Sqrt,
              [
                Add,
                [
                  Sqrt,
                  3,
                ],
                2,
              ],
            ],
            [
              Sqrt,
              [
                Add,
                [
                  Multiply,
                  5,
                  [
                    Sqrt,
                    3,
                  ],
                ],
                14,
              ],
            ],
          ],
        ],
        15,
      ]
    `));
});

describe('SIMPLIFICATION negate', () => {
  test(`simplify('-(-x)')`, () =>
    expect(simplify('-(-x)')).toMatchInlineSnapshot(`x`));

  test(`simplify('-(x+1)')`, () =>
    expect(simplify('-(x+1)')).toMatchInlineSnapshot(`["Subtract", -1, "x"]`));
});

describe('SIMPLIFICATION trigonometry', () => {
  test(`simplify('\\sin\\pi')`, () =>
    expect(simplify('\\sin\\pi')).toMatchInlineSnapshot(`0`));

  test(`simplify('1+4\\times\\sin\\frac{\\pi}{10}')`, () =>
    expect(simplify('1+4\\times\\sin\\frac{\\pi}{10}')).toMatchInlineSnapshot(
      `["Add", ["Sqrt", 5], -1, 1]`
    ));
});

describe('SIMPLIFICATION power', () => {
  test(`simplify('a^3a\\times a^2')`, () =>
    expect(simplify('a^3a\\times a^2')).toMatchInlineSnapshot(
      `["Power", "a", 6]`
    ));

  test(`simplify('\\frac{a^4}{a^2}')`, () =>
    expect(simplify('\\frac{a^4}{a^2}')).toMatchInlineSnapshot(
      `["Square", "a"]`
    ));

  test(`simplify('(a+b)^6')`, () =>
    expect(simplify('(a+b)^6')).toMatchInlineSnapshot(
      `["Power", ["Add", "a", "b"], 6]`
    ));
});

describe('EXPAND', () => {
  test(`Expand('(a+b)^6')`, () =>
    expect(ce.box(['Expand', ce.parse('(a+b)^6')]).evaluate())
      .toMatchInlineSnapshot(`
      [
        "Add",
        ["Multiply", 20, ["Power", ["Multiply", "a", "b"], 3]],
        ["Multiply", 15, ["Square", "a"], ["Power", "b", 4]],
        ["Multiply", 15, ["Square", "b"], ["Power", "a", 4]],
        ["Multiply", 6, "a", ["Power", "b", 5]],
        ["Multiply", 6, "b", ["Power", "a", 5]],
        ["Power", "a", 6],
        ["Power", "b", 6]
      ]
    `));
});

describe('SIMPLIFICATION multiply', () => {
  test(`3(2+5)`, () => {
    expect(simplify('3(2+5)')).toMatchInlineSnapshot(`21`);
  });

  test('2x', () =>
    expect(simplify('2x')).toMatchInlineSnapshot(`["Multiply", 2, "x"]`));

  test(`-\\frac{-x+2\\times x}{-2\\times x + 1}`, () => {
    expect(
      simplify('-\\frac{-x+2\\times x}{-2\\times x + 1}')
    ).toMatchInlineSnapshot(
      `["Divide", ["Negate", "x"], ["Add", ["Multiply", -2, "x"], 1]]`
    );
  });
});

//
// SYMBOLIC EVALUATION
//

describe('SYMBOLIC EVALUATION trigonometric functions', () => {
  test(`\\sin\\frac\\pi3 // constructible values`, () =>
    expect(evaluateToJson('\\sin\\frac\\pi3')).toMatchInlineSnapshot(`
      [
        Divide,
        [
          Sqrt,
          3,
        ],
        2,
      ]
    `));
  test(`\\sin(\\frac13\\pi) // constructible values`, () =>
    expect(evaluateToJson('\\sin(\\frac13\\pi)')).toMatchInlineSnapshot(`
      [
        Divide,
        [
          Sqrt,
          3,
        ],
        2,
      ]
    `));
});

describe('SYMBOLIC EVALUATION Other functions', () => {
  test('-(-x)', () => expect(NToJson('-(-x)')).toMatch('x'));

  test('50!', () =>
    expect(evaluateToJson('50!')).toMatchInlineSnapshot(
      `3.0414093201713378043612608166064768844377641568960512e+64`
    ));

  test(`eval('8844418+\\frac{85}{7}')`, () =>
    expect(evaluateToJson('8844418+\\frac{85}{7}')).toMatchObject([
      'Rational',
      61911011,
      7,
    ]));
});

//
// NUMERIC EVALUATION
//

describe('NUMERIC EVALUATION arithmetic', () => {
  test(`N('88444111111113418+8')`, () => {
    expect(NToJson('88444111111113418+8')).toEqual('88444111111113426');
  });

  test(`N('1 + \\frac{1}{3}')`, () => {
    expect(NToJson('1 + \\frac{1}{3}')).toMatch('1.(3)');
  });

  test(`N('8844418+\\frac{85}{7}')`, () =>
    expect(NToJson('8844418+\\frac{85}{7}')).toMatch('8844430.(142857)'));

  test(`N('\\frac34 + 1e30')`, () =>
    expect(NToJson('\\frac34 + 1e30')).toMatch(
      '1.00000000000000000000000000000075e+30'
    ));

  test(`N('\\frac34 + 1e99') // Precision is at 100 digits, so loss of 3/4 is expected`, () =>
    expect(NToJson('\\frac34 + 1e199')).toEqual(1e199));

  test(`NToJson('12345678^3 + \\frac{1}{3}')`, () =>
    expect(NToJson('12345678^3 + \\frac{1}{3}')).toMatch(
      '1.881675960266558605752(3)e+21'
    ));

  test(`NToJson('50!')`, () =>
    expect(NToJson('50!')).toMatch(
      '3.0414093201713378043612608166064768844377641568960512e+64'
    ));

  test(`Wester-3`, () =>
    expect(
      NToJson(
        '\\frac12+\\frac13+\\frac14+\\frac15+\\frac16+\\frac17+\\frac18+\\frac19+\\frac{1}{10}'
      )
    ).toMatch('1.928(968253)'));
});

describe('NUMERIC EVALUATION trigonometry', () => {
  test(`N('\\sin\\pi')`, () => expect(NToJson('\\sin\\pi')).toEqual(0));

  test(`N('\\cos\\frac{\\pi}{7}')`, () => {
    expect(NToJson('\\cos\\frac{\\pi}{7}')).toMatch(
      '0.9009688679024191262361023195074450511659191621318571500535624231994324204279399655013614547185124153'
    );
  });
});
