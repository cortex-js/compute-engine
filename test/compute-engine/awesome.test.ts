import { check } from '../utils';

//
// Some real math expressions that are awesome...
//

// A function that returns the nth prime number.
// Not very efficient, but it works
//  p(n)=(\sum_{v_{1}=2}^{\operatorname{floor}\left(1.5*n*\ln(n)\right)}(\operatorname{floor}(\frac{1}{0^{n-(\sum_{v_{2}=2}^{v_{1}}((\prod_{v_{3}=2}^{\operatorname{floor}(\sqrt{v_{2}})}(1-0^{\operatorname{abs}(\operatorname{floor}(\frac{v_{2}}{v_{3}})-\frac{v_{2}}{v_{3}})}))))}+1})))+2
// https://github.com/uellenberg/Logimat/tree/master/examples/nth-prime

describe('Nth PRIME NUMBER', () =>
  test('', () => {
    expect(
      check(
        'p(n)=(\\sum_{v_{1}=2}^{\\operatorname{floor}\\left(1.5*n*\\ln(n)\\right)}(\\operatorname{floor}(\\frac{1}{0^{n-(\\sum_{v_{2}=2}^{v_{1}}((\\prod_{v_{3}=2}^{\\operatorname{floor}(\\sqrt{v_{2}})}(1-0^{\\operatorname{abs}(\\operatorname{floor}(\\frac{v_{2}}{v_{3}})-\\frac{v_{2}}{v_{3}})}))))}+1})))+2'
      )
    ).toMatchInlineSnapshot(`
      latex     = [
        "Equal",
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
                                      ["Hold", ["Subscript", "v", 3]],
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
                                ["Hold", ["Subscript", "v", 2]],
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
                ["Hold", ["Subscript", "v", 1]],
                2,
                ["Floor", ["Multiply", 1.5, "n", ["Ln", "n"]]]
              ]
            ]
          ],
          2
        ]
      ]
      [
        "Equal",
        ["Multiply", "n", "p"],
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
                                  "Add",
                                  ["Divide", ["Negate", "v_2"], "v_3"],
                                  ["Floor", ["Divide", "v_2", "v_3"]]
                                ]
                              ]
                            ]
                          ],
                          [
                            "Triple",
                            [
                              "Error",
                              [
                                "ErrorCode",
                                "'incompatible-domain'",
                                ["Domain", "Symbols"],
                                ["Domain", "ExtendedRealNumbers"]
                              ]
                            ],
                            2,
                            ["Floor", ["Sqrt", "v_2"]]
                          ]
                        ],
                        [
                          "Triple",
                          [
                            "Error",
                            [
                              "ErrorCode",
                              "'incompatible-domain'",
                              ["Domain", "Symbols"],
                              ["Domain", "ExtendedRealNumbers"]
                            ]
                          ],
                          2,
                          "v_1"
                        ]
                      ]
                    ]
                  ],
                  1
                ]
              ]
            ],
            [
              "Triple",
              [
                "Error",
                [
                  "ErrorCode",
                  "'incompatible-domain'",
                  ["Domain", "Symbols"],
                  ["Domain", "ExtendedRealNumbers"]
                ]
              ],
              2,
              ["Floor", ["Multiply", 1.5, "n", ["Ln", "n"]]]
            ]
          ],
          2
        ]
      ]
    `);
  }));

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
            ["Rational", 1, 30]
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
