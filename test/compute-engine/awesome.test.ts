import { check } from '../utils';

//
// Some real math expressions that are awesome...
//

describe('Primality Test', () => {
  test('Primality Test', () =>
    expect(
      check(
        '-\\left\\lfloor\\cos\\left(\\pi\\cdot\\frac{\\left( n-1\\right)!+1}{ n}\\right)\\right\\rfloor'
      )
    ).toMatchInlineSnapshot(`
      box       = [
        "Negate",
        [
          "Floor",
          [
            "Cos",
            [
              "Divide",
              [
                "Multiply",
                "Pi",
                ["Add", ["Factorial", ["Subtract", "n", 1]], 1]
              ],
              "n"
            ]
          ]
        ]
      ]
      simplify  = -floor(cos((pi * (n - 1)! + pi) / n))
      eval-auto = NaN
    `));
  // 	https://en.wikipedia.org/wiki/Wilson%27s_theorem
  // 	https://en.wikipedia.org/wiki/Primality_test#Wilson's_theorem
});

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
      box       = [
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
                                                    ["At", "v", 2],
                                                    ["At", "v", 3]
                                                  ]
                                                ],
                                                [
                                                  "Divide",
                                                  ["At", "v", 2],
                                                  ["At", "v", 3]
                                                ]
                                              ]
                                            ]
                                          ]
                                        ]
                                      ],
                                      [
                                        "Triple",
                                        "Nothing",
                                        2,
                                        ["Floor", ["Sqrt", ["At", "v", 2]]]
                                      ]
                                    ]
                                  ]
                                ],
                                ["Triple", "Nothing", 2, ["At", "v", 1]]
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
                  "Nothing",
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
      canonical = [
        "Assign",
        "p",
        [
          "Function",
          [
            "Add",
            [
              "Sum",
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
                          "Sum",
                          [
                            "Product",
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
                                        ["At", "v", 2],
                                        ["At", "v", 3]
                                      ]
                                    ],
                                    [
                                      "Divide",
                                      ["At", "v", 2],
                                      ["At", "v", 3]
                                    ]
                                  ]
                                ]
                              ]
                            ],
                            [
                              "Triple",
                              "Nothing",
                              2,
                              ["Floor", ["Sqrt", ["At", "v", 2]]]
                            ]
                          ],
                          ["Triple", "Nothing", 2, ["At", "v", 1]]
                        ]
                      ]
                    ],
                    1
                  ]
                ]
              ],
              [
                "Triple",
                "Nothing",
                2,
                ["Floor", ["Multiply", 1.5, "n", ["Ln", "n"]]]
              ]
            ],
            2
          ],
          "n"
        ]
      ]
      eval-auto = (n) |-> {sum^(floor(1.5 * n * ln(n)))(floor(1 / (0^(n - sum^(At(v, 1))(prod^(floor(sqrt(At(v, 2))))(-0^(|-At(v, 2) / At(v, 3) + floor(At(v, 2) / At(v, 3))|) + 1))) + 1))) + 2}
    `);
  }));

// The value of these polynomials for x in 0..n are all prime numbers
describe('Euler Prime Generating Polynomial', () => {
  test('x in 0..39', () =>
    expect(check('n^2 + n + 41')).toMatchInlineSnapshot(
      `["Add", ["Square", "n"], "n", 41]`
    ));
  test('x in 0..61', () =>
    expect(check('8x^2 - 488 x + 7243')).toMatchInlineSnapshot(`
      box       = [
        "Add",
        ["InvisibleOperator", 8, ["Square", "x"]],
        ["Negate", ["InvisibleOperator", 488, "x"]],
        7243
      ]
      canonical = [
        "Add",
        ["Multiply", 8, ["Square", "x"]],
        ["Negate", ["Multiply", 488, "x"]],
        7243
      ]
    `));
  test('x in ', () =>
    expect(check('43 x^2 - 537x + 2971')).toMatchInlineSnapshot(`
      box       = [
        "Add",
        ["InvisibleOperator", 43, ["Square", "x"]],
        ["Negate", ["InvisibleOperator", 537, "x"]],
        2971
      ]
      canonical = [
        "Add",
        ["Multiply", 43, ["Square", "x"]],
        ["Negate", ["Multiply", 537, "x"]],
        2971
      ]
    `));
  test('x in 0..45', () =>
    expect(check('36 x^2 - 810 x + 2763')).toMatchInlineSnapshot(`
      box       = [
        "Add",
        ["InvisibleOperator", 36, ["Square", "x"]],
        ["Negate", ["InvisibleOperator", 810, "x"]],
        2763
      ]
      canonical = [
        "Add",
        ["Multiply", 36, ["Square", "x"]],
        ["Negate", ["Multiply", 810, "x"]],
        2763
      ]
    `));
  test('x in', () =>
    expect(check('x^2 - 79x + 1601')).toMatchInlineSnapshot(`
      box       = [
        "Add",
        ["Square", "x"],
        ["Negate", ["InvisibleOperator", 79, "x"]],
        1601
      ]
      canonical = ["Add", ["Square", "x"], ["Negate", ["Multiply", 79, "x"]], 1601]
    `));
  test('x in 0..10', () =>
    expect(check('2x^2 + 11')).toMatchInlineSnapshot(`
      box       = ["Add", ["InvisibleOperator", 2, ["Square", "x"]], 11]
      canonical = ["Add", ["Multiply", 2, ["Square", "x"]], 11]
    `));
  test('x in 0..10', () =>
    expect(check('x^3 + x^2 + 17')).toMatchInlineSnapshot(
      `["Add", ["Power", "x", 3], ["Square", "x"], 17]`
    ));
});

describe("Mill's formula https://en.wikipedia.org/wiki/Mills%27_constant", () =>
  test('Sequence https://oeis.org/A051254', () =>
    expect(check('\\lfloor (\\frac{3540326840}{2710032743})^{3^{n}} \\rfloor'))
      .toMatchInlineSnapshot(`
      box       = [
        "Floor",
        [
          "Power",
          ["Delimiter", ["Divide", 3540326840, 2710032743]],
          ["Power", 3, "n"]
        ]
      ]
      canonical = [
        "Floor",
        ["Power", ["Rational", 3540326840, 2710032743], ["Power", 3, "n"]]
      ]
      eval-auto = floor(3540326840/2710032743^(3^n))
      eval-mach = floor(3540326840/2710032743^(3^n))
      N-auto    = floor(1.30637788386308069046^(3^n))
      N-mach    = floor(1.30637788386308^(3^n))
    `)));

// A meaningless, but amusing, coincidence
describe('⌈e⌉ = ⌊π⌋', () =>
  test('', () =>
    expect(check('⌈e⌉ = ⌊π⌋')).toMatchInlineSnapshot(`
      box       = ["Equal", ["Ceil", "e"], ["Floor", "Pi"]]
      canonical = ["Equal", ["Ceil", "ExponentialE"], ["Floor", "Pi"]]
      eval-auto = "True"
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
      box       = [
        "InvisibleOperator",
        ["Sqrt", "Pi"],
        ["Power", ["Delimiter", ["Divide", "n", "e"]], "n"],
        [
          "Root",
          [
            "Add",
            ["InvisibleOperator", 8, ["Power", "n", 3]],
            ["InvisibleOperator", 4, ["Square", "n"]],
            "n",
            ["Divide", 1, 30]
          ],
          6
        ]
      ]
      canonical = [
        "Multiply",
        ["Sqrt", "Pi"],
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
        ]
      ]
      eval-auto = (sqrt(pi) * n^n * root(6)(8n^3 + 4n^2 + n + 1/30)) / e^n
      eval-mach = (sqrt(pi) * n^n * root(6)(8n^3 + 4n^2 + n + 1/30)) / e^n
      N-auto    = 1.7724538509055160273 * 0.367879441171442321596^n * n^n * root(6)(8n^3 + 4n^2 + n + 0.0333333333333333333333)
      N-mach    = 1.7724538509055159 * 0.36787944117144233^n * n^n * root(6)(8n^3 + 4n^2 + n + 0.0333333333333333)
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
