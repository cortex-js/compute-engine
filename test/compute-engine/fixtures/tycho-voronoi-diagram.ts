import type { MathJsonExpression } from '../../../src/math-json';

/**
 * The `voronoi-diagram` row of Tycho's showcase as Tycho's document manager
 * stores it, captured on 2026-10-27 from Tycho's codegen audit
 * (`scripts/audit-ce-codegen.mts --shadow-wgsl`) at the entry of the shader
 * targets' root inlining (`compilation/gpu-shared-calls.ts`).
 *
 * Tycho rewrites a document before it stores it: the squared distance `D`
 * is written out in the bodies of `F`, `n` and `B`, the parameters are named
 * `ceArg_0`, `ceArg_1`, …, and each function is declared with the type
 * given here (a bare `function`, or a derived signature) and then assigned
 * its function literal. `T` is declared `real<-10..10>`, `x` and `y` `real`.
 * The definitions in the document are:
 *
 *   p(k) = 1.45 √((k − 0.5)/16) cos(2.4k) + 0.14 cos(T + 1.9k)
 *   q(k) = 0.95 √((k − 0.5)/16) sin(2.4k) + 0.1 sin(2T + 2.7k)
 *   D(x, y, k) = (x − p(k))² + (y − q(k))²
 *   F(x, y) = min over k = 1…16 of D(x, y, k)
 *   n(x, y, k) = e^{−5000(D(x, y, k) − F(x, y))}
 *   Z(x, y) = Σ_{k=1}^{16} n(x, y, k)
 *   u(x, y) = (1/Z) Σ p(k) n(x, y, k),  v(x, y) = (1/Z) Σ q(k) n(x, y, k)
 *   H(x, y) = (1/Z) Σ mod(0.567k, 1) n(x, y, k)
 *   B(x, y) = Σ exp(−(D(x, y, k) − F(x, y)) /
 *               (0.015 √((p(k) − u)² + (q(k) − v)² + 0.0004)))
 *
 * and the row is `{F(x, y) < 0.0008: 0, B(x, y) > 1.3: 0, 0.12 + 0.8H(x, y)}`.
 */
export const TYCHO_VORONOI_DEFINITIONS: [
  name: string,
  type: string,
  value: MathJsonExpression,
][] = [
  [
    'H',
    'function',
    [
      'Function',
      [
        'Block',
        [
          'Multiply',
          ['Divide', 1, ['Z', 'ceArg_0', 'ceArg_1']],
          [
            'Sum',
            [
              'Multiply',
              ['Mod', ['Multiply', 0.567, 'ceArg_2'], 1],
              ['n', 'ceArg_0', 'ceArg_1', 'ceArg_2'],
            ],
            ['Limits', 'ceArg_2', 1, 16],
          ],
        ],
      ],
      'ceArg_0',
      'ceArg_1',
    ],
  ],
  [
    'n',
    '(unknown, unknown, nan | real | signed_infinity) -> number',
    [
      'Function',
      [
        'Block',
        [
          'Power',
          'ExponentialE',
          [
            'Multiply',
            -5000,
            [
              'Add',
              [
                'Power',
                [
                  'Add',
                  'ceArg_0',
                  [
                    'Multiply',
                    -0.14,
                    ['Cos', ['Add', 'T', ['Multiply', 1.9, 'ceArg_2']]],
                  ],
                  [
                    'Multiply',
                    -0.3625,
                    ['Cos', ['Multiply', 2.4, 'ceArg_2']],
                    ['Sqrt', ['Add', 'ceArg_2', -0.5]],
                  ],
                ],
                2,
              ],
              [
                'Power',
                [
                  'Add',
                  'ceArg_1',
                  [
                    'Multiply',
                    -0.1,
                    [
                      'Sin',
                      [
                        'Add',
                        ['Multiply', 2, 'T'],
                        ['Multiply', 2.7, 'ceArg_2'],
                      ],
                    ],
                  ],
                  [
                    'Multiply',
                    -0.2375,
                    ['Sin', ['Multiply', 2.4, 'ceArg_2']],
                    ['Sqrt', ['Add', 'ceArg_2', -0.5]],
                  ],
                ],
                2,
              ],
              ['Negate', ['F', 'ceArg_0', 'ceArg_1']],
            ],
          ],
        ],
      ],
      'ceArg_0',
      'ceArg_1',
      'ceArg_2',
    ],
  ],
  [
    'F',
    'function',
    [
      'Function',
      [
        'Block',
        [
          'Min',
          [
            'Add',
            [
              'Power',
              [
                'Add',
                'ceArg_0',
                ['Multiply', -0.14, ['Cos', ['Add', 'T', 1.9]]],
                0.18901333504054005,
              ],
              2,
            ],
            [
              'Power',
              [
                'Add',
                'ceArg_1',
                ['Multiply', -0.1, ['Sin', ['Add', ['Multiply', 2, 'T'], 2.7]]],
                -0.11343584140976863,
              ],
              2,
            ],
          ],
          [
            'Add',
            [
              'Power',
              [
                'Add',
                'ceArg_0',
                ['Multiply', -0.14, ['Cos', ['Add', 'T', 3.8]]],
                -0.03884692506704684,
              ],
              2,
            ],
            [
              'Power',
              [
                'Add',
                'ceArg_1',
                ['Multiply', -0.1, ['Sin', ['Add', ['Multiply', 2, 'T'], 5.4]]],
                0.2897612802367072,
              ],
              2,
            ],
          ],
          [
            'Add',
            [
              'Power',
              [
                'Add',
                'ceArg_0',
                ['Multiply', -0.14, ['Cos', ['Add', 'T', 5.699999999999999]]],
                -0.3486843585806445,
              ],
              2,
            ],
            [
              'Power',
              [
                'Add',
                'ceArg_1',
                [
                  'Multiply',
                  -0.1,
                  ['Sin', ['Add', ['Multiply', 2, 'T'], 8.100000000000001]],
                ],
                -0.2980385309589435,
              ],
              2,
            ],
          ],
          [
            'Add',
            [
              'Power',
              [
                'Add',
                'ceArg_0',
                ['Multiply', -0.14, ['Cos', ['Add', 'T', 7.6]]],
                0.6677910818103873,
              ],
              2,
            ],
            [
              'Power',
              [
                'Add',
                'ceArg_1',
                [
                  'Multiply',
                  -0.1,
                  ['Sin', ['Add', ['Multiply', 2, 'T'], 10.8]],
                ],
                0.07745719178021403,
              ],
              2,
            ],
          ],
          [
            'Add',
            [
              'Power',
              [
                'Add',
                'ceArg_0',
                ['Multiply', -0.14, ['Cos', ['Add', 'T', 9.5]]],
                -0.6489056564990583,
              ],
              2,
            ],
            [
              'Power',
              [
                'Add',
                'ceArg_1',
                [
                  'Multiply',
                  -0.1,
                  ['Sin', ['Add', ['Multiply', 2, 'T'], 13.5]],
                ],
                0.27033272360490207,
              ],
              2,
            ],
          ],
          [
            'Add',
            [
              'Power',
              [
                'Add',
                'ceArg_0',
                ['Multiply', -0.14, ['Cos', ['Add', 'T', 11.399999999999999]]],
                0.22088057028474287,
              ],
              2,
            ],
            [
              'Power',
              [
                'Add',
                'ceArg_1',
                [
                  'Multiply',
                  -0.1,
                  ['Sin', ['Add', ['Multiply', 2, 'T'], 16.200000000000003]],
                ],
                -0.5378587038795808,
              ],
              2,
            ],
          ],
          [
            'Add',
            [
              'Power',
              [
                'Add',
                'ceArg_0',
                ['Multiply', -0.14, ['Cos', ['Add', 'T', 13.299999999999999]]],
                0.42575790059026253,
              ],
              2,
            ],
            [
              'Power',
              [
                'Add',
                'ceArg_1',
                [
                  'Multiply',
                  -0.1,
                  ['Sin', ['Add', ['Multiply', 2, 'T'], 18.900000000000002]],
                ],
                0.5374294428326333,
              ],
              2,
            ],
          ],
          [
            'Add',
            [
              'Power',
              [
                'Add',
                'ceArg_0',
                ['Multiply', -0.14, ['Cos', ['Add', 'T', 15.2]]],
                -0.9324083087660792,
              ],
              2,
            ],
            [
              'Power',
              [
                'Add',
                'ceArg_1',
                [
                  'Multiply',
                  -0.1,
                  ['Sin', ['Add', ['Multiply', 2, 'T'], 21.6]],
                ],
                -0.2232990803759879,
              ],
              2,
            ],
          ],
          [
            'Add',
            [
              'Power',
              [
                'Add',
                'ceArg_0',
                ['Multiply', -0.14, ['Cos', ['Add', 'T', 17.099999999999998]]],
                0.977037268639551,
              ],
              2,
            ],
            [
              'Power',
              [
                'Add',
                'ceArg_1',
                [
                  'Multiply',
                  -0.1,
                  ['Sin', ['Add', ['Multiply', 2, 'T'], 24.3]],
                ],
                -0.26398757661122374,
              ],
              2,
            ],
          ],
          [
            'Add',
            [
              'Power',
              [
                'Add',
                'ceArg_0',
                [
                  'Multiply',
                  -0.14,
                  [
                    'Cos',
                    [
                      'Add',
                      'T',
                      {
                        num: '19.0',
                      },
                    ],
                  ],
                ],
                -0.47393522103260166,
              ],
              2,
            ],
            [
              'Power',
              [
                'Add',
                'ceArg_1',
                [
                  'Multiply',
                  -0.1,
                  [
                    'Sin',
                    [
                      'Add',
                      ['Multiply', 2, 'T'],
                      {
                        num: '27.0',
                      },
                    ],
                  ],
                ],
                0.6629052423452966,
              ],
              2,
            ],
          ],
          [
            'Add',
            [
              'Power',
              [
                'Add',
                'ceArg_0',
                ['Multiply', -0.14, ['Cos', ['Add', 'T', 20.9]]],
                -0.35109571854318034,
              ],
              2,
            ],
            [
              'Power',
              [
                'Add',
                'ceArg_1',
                [
                  'Multiply',
                  -0.1,
                  ['Sin', ['Add', ['Multiply', 2, 'T'], 29.700000000000003]],
                ],
                -0.7344063171593339,
              ],
              2,
            ],
          ],
          [
            'Add',
            [
              'Power',
              [
                'Add',
                'ceArg_0',
                ['Multiply', -0.14, ['Cos', ['Add', 'T', 22.799999999999997]]],
                1.0633297356449394,
              ],
              2,
            ],
            [
              'Power',
              [
                'Add',
                'ceArg_1',
                [
                  'Multiply',
                  -0.1,
                  ['Sin', ['Add', ['Multiply', 2, 'T'], 32.400000000000006]],
                ],
                0.4041419488058906,
              ],
              2,
            ],
          ],
          [
            'Add',
            [
              'Power',
              [
                'Add',
                'ceArg_0',
                ['Multiply', -0.14, ['Cos', ['Add', 'T', 24.7]]],
                -1.251869390424787,
              ],
              2,
            ],
            [
              'Power',
              [
                'Add',
                'ceArg_1',
                [
                  'Multiply',
                  -0.1,
                  ['Sin', ['Add', ['Multiply', 2, 'T'], 35.1]],
                ],
                0.17990556615397862,
              ],
              2,
            ],
          ],
          [
            'Add',
            [
              'Power',
              [
                'Add',
                'ceArg_0',
                ['Multiply', -0.14, ['Cos', ['Add', 'T', 26.599999999999998]]],
                0.7665814648394279,
              ],
              2,
            ],
            [
              'Power',
              [
                'Add',
                'ceArg_1',
                [
                  'Multiply',
                  -0.1,
                  ['Sin', ['Add', ['Multiply', 2, 'T'], 37.800000000000004]],
                ],
                -0.7136079561877126,
              ],
              2,
            ],
          ],
          [
            'Add',
            [
              'Power',
              [
                'Add',
                'ceArg_0',
                ['Multiply', -0.14, ['Cos', ['Add', 'T', 28.5]]],
                0.17663581471096026,
              ],
              2,
            ],
            [
              'Power',
              [
                'Add',
                'ceArg_1',
                [
                  'Multiply',
                  -0.1,
                  ['Sin', ['Add', ['Multiply', 2, 'T'], 40.5]],
                ],
                0.896938072883224,
              ],
              2,
            ],
          ],
          [
            'Add',
            [
              'Power',
              [
                'Add',
                'ceArg_0',
                ['Multiply', -0.14, ['Cos', ['Add', 'T', 30.4]]],
                -1.090738174007465,
              ],
              2,
            ],
            [
              'Power',
              [
                'Add',
                'ceArg_1',
                [
                  'Multiply',
                  -0.1,
                  ['Sin', ['Add', ['Multiply', 2, 'T'], 43.2]],
                ],
                -0.6030032319344698,
              ],
              2,
            ],
          ],
        ],
      ],
      'ceArg_0',
      'ceArg_1',
    ],
  ],
  [
    'Z',
    'function',
    [
      'Function',
      [
        'Block',
        [
          'Sum',
          ['n', 'ceArg_0', 'ceArg_1', 'ceArg_2'],
          ['Limits', 'ceArg_2', 1, 16],
        ],
      ],
      'ceArg_0',
      'ceArg_1',
    ],
  ],
  [
    'B',
    'function',
    [
      'Function',
      [
        'Block',
        [
          'Sum',
          [
            'Power',
            'ExponentialE',
            [
              'Negate',
              [
                'Divide',
                [
                  'Add',
                  [
                    'Power',
                    [
                      'Add',
                      'ceArg_0',
                      [
                        'Multiply',
                        -0.14,
                        ['Cos', ['Add', 'T', ['Multiply', 1.9, 'ceArg_2']]],
                      ],
                      [
                        'Multiply',
                        -0.3625,
                        ['Cos', ['Multiply', 2.4, 'ceArg_2']],
                        ['Sqrt', ['Add', 'ceArg_2', -0.5]],
                      ],
                    ],
                    2,
                  ],
                  [
                    'Power',
                    [
                      'Add',
                      'ceArg_1',
                      [
                        'Multiply',
                        -0.1,
                        [
                          'Sin',
                          [
                            'Add',
                            ['Multiply', 2, 'T'],
                            ['Multiply', 2.7, 'ceArg_2'],
                          ],
                        ],
                      ],
                      [
                        'Multiply',
                        -0.2375,
                        ['Sin', ['Multiply', 2.4, 'ceArg_2']],
                        ['Sqrt', ['Add', 'ceArg_2', -0.5]],
                      ],
                    ],
                    2,
                  ],
                  ['Negate', ['F', 'ceArg_0', 'ceArg_1']],
                ],
                [
                  'Multiply',
                  0.015,
                  [
                    'Sqrt',
                    [
                      'Add',
                      [
                        'Power',
                        [
                          'Add',
                          ['Negate', ['v', 'ceArg_0', 'ceArg_1']],
                          ['q', 'ceArg_2'],
                        ],
                        2,
                      ],
                      [
                        'Power',
                        [
                          'Add',
                          ['Negate', ['u', 'ceArg_0', 'ceArg_1']],
                          ['p', 'ceArg_2'],
                        ],
                        2,
                      ],
                      0.0004,
                    ],
                  ],
                ],
              ],
            ],
          ],
          ['Limits', 'ceArg_2', 1, 16],
        ],
      ],
      'ceArg_0',
      'ceArg_1',
    ],
  ],
  [
    'p',
    '(nan | real | signed_infinity) -> number',
    [
      'Function',
      [
        'Block',
        [
          'Add',
          [
            'Multiply',
            0.14,
            ['Cos', ['Add', 'T', ['Multiply', 1.9, 'ceArg_0']]],
          ],
          [
            'Multiply',
            1.45,
            ['Cos', ['Multiply', 2.4, 'ceArg_0']],
            [
              'Sqrt',
              ['Multiply', ['Rational', 1, 16], ['Add', 'ceArg_0', -0.5]],
            ],
          ],
        ],
      ],
      'ceArg_0',
    ],
  ],
  [
    'u',
    'function',
    [
      'Function',
      [
        'Block',
        [
          'Multiply',
          ['Divide', 1, ['Z', 'ceArg_0', 'ceArg_1']],
          [
            'Sum',
            [
              'Multiply',
              ['p', 'ceArg_2'],
              ['n', 'ceArg_0', 'ceArg_1', 'ceArg_2'],
            ],
            ['Limits', 'ceArg_2', 1, 16],
          ],
        ],
      ],
      'ceArg_0',
      'ceArg_1',
    ],
  ],
  [
    'q',
    '(nan | real | signed_infinity) -> number',
    [
      'Function',
      [
        'Block',
        [
          'Add',
          [
            'Multiply',
            0.1,
            [
              'Sin',
              ['Add', ['Multiply', 2, 'T'], ['Multiply', 2.7, 'ceArg_0']],
            ],
          ],
          [
            'Multiply',
            0.95,
            ['Sin', ['Multiply', 2.4, 'ceArg_0']],
            [
              'Sqrt',
              ['Multiply', ['Rational', 1, 16], ['Add', 'ceArg_0', -0.5]],
            ],
          ],
        ],
      ],
      'ceArg_0',
    ],
  ],
  [
    'v',
    'function',
    [
      'Function',
      [
        'Block',
        [
          'Multiply',
          ['Divide', 1, ['Z', 'ceArg_0', 'ceArg_1']],
          [
            'Sum',
            [
              'Multiply',
              ['q', 'ceArg_2'],
              ['n', 'ceArg_0', 'ceArg_1', 'ceArg_2'],
            ],
            ['Limits', 'ceArg_2', 1, 16],
          ],
        ],
      ],
      'ceArg_0',
      'ceArg_1',
    ],
  ],
];

export const TYCHO_VORONOI_ROW: MathJsonExpression = [
  'Which',
  ['Less', ['F', 'x', 'y'], 0.0008],
  0,
  ['Less', 1.3, ['B', 'x', 'y']],
  0,
  'True',
  ['Add', ['Multiply', 0.8, ['H', 'x', 'y']], 0.12],
];
