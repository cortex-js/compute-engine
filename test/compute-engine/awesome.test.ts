import { check } from '../utils';

//
// Some real math expressions that are awesome...
//

// C.P. Willans Formula: A function that returns the nth prime number.
//
// Not very efficient, but it works
//
//  p(n)=(\sum_{v_{1}=2}^{\operatorname{floor}\left(1.5*n*\ln(n)\right)}(\operatorname{floor}(\frac{1}{0^{n-(\sum_{v_{2}=2}^{v_{1}}((\prod_{v_{3}=2}^{\operatorname{floor}(\sqrt{v_{2}})}(1-0^{\operatorname{abs}(\operatorname{floor}(\frac{v_{2}}{v_{3}})-\frac{v_{2}}{v_{3}})}))))}+1})))+2
// https://github.com/uellenberg/Logimat/tree/master/examples/nth-prime

// See https://en.wikipedia.org/wiki/Formula_for_primes
// Explanation at https://www.youtube.com/watch?v=j5s0h42GfvM&t=1s

describe('Nth PRIME NUMBER', () =>
  test('', () => {
    expect(
      check(
        'p(n):=(\\sum_{v_{1}=2}^{\\operatorname{floor}\\left(1.5*n*\\ln(n)\\right)}(\\operatorname{floor}(\\frac{1}{0^{n-(\\sum_{v_{2}=2}^{v_{1}}((\\prod_{v_{3}=2}^{\\operatorname{floor}(\\sqrt{v_{2}})}(1-0^{\\operatorname{abs}(\\operatorname{floor}(\\frac{v_{2}}{v_{3}})-\\frac{v_{2}}{v_{3}})}))))}+1})))+2'
      )
    ).toMatchInlineSnapshot(`
      latex     = [
        "Assign",
        ["Multiply", "p", ["Delimiter", "n"]],
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
                          "Subtract",
                          "n",
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
                                        "Subtract",
                                        1,
                                        [
                                          "Power",
                                          0,
                                          [
                                            "Abs",
                                            [
                                              "Subtract",
                                              [
                                                "Floor",
                                                [
                                                  "Divide",
                                                  ["Subscript", "v", 2],
                                                  ["Subscript", "v", 3]
                                                ]
                                              ],
                                              [
                                                "Divide",
                                                ["Subscript", "v", 2],
                                                ["Subscript", "v", 3]
                                              ]
                                            ]
                                          ]
                                        ]
                                      ]
                                    ],
                                    [
                                      "Triple",
                                      ["Subscript", "v", 3],
                                      2,
                                      [
                                        "Floor",
                                        ["Sqrt", ["Subscript", "v", 2]]
                                      ]
                                    ]
                                  ]
                                ]
                              ],
                              [
                                "Triple",
                                ["Subscript", "v", 2],
                                2,
                                ["Subscript", "v", 1]
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
                "Triple",
                ["Subscript", "v", 1],
                2,
                ["Floor", ["Multiply", 1.5, "n", ["Ln", "n"]]]
              ]
            ]
          ],
          2
        ]
      ]
      [
        "Assign",
        ["Multiply", "p", ["Delimiter", "n"]],
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
                          "Subtract",
                          "n",
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
                                        "Subtract",
                                        1,
                                        [
                                          "Power",
                                          0,
                                          [
                                            "Abs",
                                            [
                                              "Subtract",
                                              [
                                                "Floor",
                                                [
                                                  "Divide",
                                                  ["Subscript", "v", 2],
                                                  ["Subscript", "v", 3]
                                                ]
                                              ],
                                              [
                                                "Divide",
                                                ["Subscript", "v", 2],
                                                ["Subscript", "v", 3]
                                              ]
                                            ]
                                          ]
                                        ]
                                      ]
                                    ],
                                    [
                                      "Triple",
                                      ["Subscript", "v", 3],
                                      2,
                                      [
                                        "Floor",
                                        ["Sqrt", ["Subscript", "v", 2]]
                                      ]
                                    ]
                                  ]
                                ]
                              ],
                              [
                                "Triple",
                                ["Subscript", "v", 2],
                                2,
                                ["Subscript", "v", 1]
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
                "Triple",
                ["Subscript", "v", 1],
                2,
                ["Floor", ["Multiply", 1.5, "n", ["Ln", "n"]]]
              ]
            ]
          ],
          2
        ]
      ]
    `);
  }));

// The value of these polynomials for x in 0..n are all prime numbers
describe('Euler Prime Generating Polynomial', () => {
  test('x in 0..39', () =>
    expect(check('n^2 + n + 41')).toMatchInlineSnapshot(`
      latex     = ["Add", ["Power", "n", 2], "n", 41]
      ["Add", ["Square", "n"], "n", 41]
    `));
  test('x in 0..61', () =>
    expect(check('8x^2 - 488 x + 7243')).toMatchInlineSnapshot(`
      latex     = [
        "Add",
        [
          "Subtract",
          ["Multiply", 8, ["Power", "x", 2]],
          ["Multiply", 488, "x"]
        ],
        7243
      ]
      [
        "Add",
        ["Multiply", 8, ["Square", "x"]],
        ["Multiply", -488, "x"],
        7243
      ]
    `));
  test('x in ', () =>
    expect(check('43 x^2 - 537x + 2971')).toMatchInlineSnapshot(`
      latex     = [
        "Add",
        [
          "Subtract",
          ["Multiply", 43, ["Power", "x", 2]],
          ["Multiply", 537, "x"]
        ],
        2971
      ]
      [
        "Add",
        ["Multiply", 43, ["Square", "x"]],
        ["Multiply", -537, "x"],
        2971
      ]
    `));
  test('x in 0..45', () =>
    expect(check('36 x^2 - 810 x + 2763')).toMatchInlineSnapshot(`
      latex     = [
        "Add",
        [
          "Subtract",
          ["Multiply", 36, ["Power", "x", 2]],
          ["Multiply", 810, "x"]
        ],
        2763
      ]
      [
        "Add",
        ["Multiply", 36, ["Square", "x"]],
        ["Multiply", -810, "x"],
        2763
      ]
    `));
  test('x in', () =>
    expect(check('x^2 - 79x + 1601')).toMatchInlineSnapshot(`
      latex     = ["Add", ["Subtract", ["Power", "x", 2], ["Multiply", 79, "x"]], 1601]
      ["Add", ["Multiply", -79, "x"], ["Square", "x"], 1601]
    `));
  test('x in 0..10', () =>
    expect(check('2x^2 + 11')).toMatchInlineSnapshot(`
      latex     = ["Add", ["Multiply", 2, ["Power", "x", 2]], 11]
      ["Add", ["Multiply", 2, ["Square", "x"]], 11]
    `));
  test('x in 0..10', () =>
    expect(check('x^3 + x^2 + 17')).toMatchInlineSnapshot(`
      latex     = ["Add", ["Power", "x", 3], ["Power", "x", 2], 17]
      ["Add", ["Power", "x", 3], ["Square", "x"], 17]
    `));
});

describe("Mill's formula https://en.wikipedia.org/wiki/Mills%27_constant", () =>
  test('Sequence https://oeis.org/A051254', () =>
    expect(check('\\lfloor (\\frac{3540326840}{2710032743})^{3^{n}} \\rfloor'))
      .toMatchInlineSnapshot(`
      latex     = [
        "Floor",
        [
          "Power",
          ["Delimiter", ["Divide", 3540326840, 2710032743]],
          ["Power", 3, "n"]
        ]
      ]
      box       = [
        "Floor",
        ["Power", ["Rational", 3540326840, 2710032743], ["Power", 3, "n"]]
      ]
      N-auto    = [
        "Floor",
        [
          "Power",
          "1.306377883863080690460867985165889931094459842841832409550337303802827152778795780033127075763896038",
          ["Power", 3, "n"]
        ]
      ]
      N-mach    = ["Floor", ["Power", 1.3063778838630806, ["Power", 3, "n"]]]
    `)));

// A meaningless, but amusing, coincidence
describe('⌈e⌉ = ⌊π⌋', () =>
  test('', () =>
    expect(check('⌈e⌉ = ⌊π⌋')).toMatchInlineSnapshot(`
      latex     = ["Equal", ["Ceil", "e"], ["Floor", "Pi"]]
      box       = ["Equal", ["Ceil", "ExponentialE"], ["Floor", "Pi"]]
      evaluate  = True
    `)));

//  Ramanujan factorial approximation
// https://www.johndcook.com/blog/2012/09/25/ramanujans-factorial-approximation/
describe('RAMANUJAN FACTORIAL APPROXIMATION', () =>
  test('', () =>
    expect(
      check(
        '\\sqrt{\\pi}\\left(\\frac{n}{e}\\right)^n\\sqrt[6]{8n^3+4n^2+n+\\frac{1}{30}}'
      )
    ).toMatchInlineSnapshot(`
      latex     = [
        "Multiply",
        ["Sqrt", "Pi"],
        ["Power", ["Delimiter", ["Divide", "n", "e"]], "n"],
        [
          "Root",
          [
            "Add",
            ["Multiply", 8, ["Power", "n", 3]],
            ["Multiply", 4, ["Power", "n", 2]],
            "n",
            ["Divide", 1, 30]
          ],
          6
        ]
      ]
      box       = [
        "Multiply",
        ["Power", ["Divide", "n", "ExponentialE"], "n"],
        [
          "Root",
          [
            "Add",
            ["Multiply", 8, ["Power", "n", 3]],
            ["Multiply", 4, ["Square", "n"]],
            "n",
            ["Rational", 1, 30]
          ],
          6
        ],
        ["Sqrt", "Pi"]
      ]
      N-auto    = [
        "Multiply",
        "1.772453850905516027298167483341145182797549456122387128213807789852911284591032181374950656738544665",
        [
          "Power",
          [
            "Divide",
            "n",
            "2.718281828459045235360287471352662497757247093699959574966967627724076630353547594571382178525166427"
          ],
          "n"
        ],
        [
          "Power",
          [
            "Add",
            ["Multiply", 8, ["Power", "n", 3]],
            ["Multiply", 4, ["Square", "n"]],
            "n",
            "0.0(3)"
          ],
          "0.1(6)"
        ]
      ]
      N-mach    = [
        "Multiply",
        1.7724538509055159,
        ["Power", ["Divide", "n", 2.718281828459045], "n"],
        [
          "Power",
          [
            "Add",
            ["Multiply", 8, ["Power", "n", 3]],
            ["Multiply", 4, ["Square", "n"]],
            "n",
            0.03333333333333333
          ],
          0.16666666666666666
        ]
      ]
    `)));

/*

	⁃	https://www.reddit.com/r/math/comments/rxv4qw/what_is_your_all_time_favorite_math_equation/
	⁃	Curves for  the Mathematically Curious
  	⁃	sin(sin x + cos y) = cos(sin xy + cos x)
	  ⁃	x^2 + (\frac54y − \sqrt{|x|})^2  = 1
	  ⁃	catenary
	  ⁃	Weierestrass function (continuous, but not differentiable anywhere)
	  ⁃	 \int_a^b \frac{f(x)}{f(a+b-x)+f(x)}dx = \frac{b-a}{2}
	⁃	see https://www.youtube.com/watch?v=BfZObnTIsYk
	⁃	x+y+z = 1, x^2+y^2+z^2 = 2, x^3+y^3+z^3=3, x^4+y^4+z^4=? (x, y, z integers). Try out all integers from 0 to 1 million
	⁃	615+x^2 = 2^y
	⁃	https://www.youtube.com/watch?v=DOISjFviqkM
	⁃	f(2a) + f(2b) = f(f(a + b))
	⁃	https://www.youtube.com/watch?v=uJqbHaFqjmI

*/
