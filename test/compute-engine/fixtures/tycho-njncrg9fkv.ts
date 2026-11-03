/**
 * The program of the Tycho document art/njncrg9fkv (the corpus row
 * `p\{…\}(1 \text{ where } \{…\} < 2)(1 \text{ where } \{…\} < 2) \text{ where }
 * p := PointList(…)`), as MathJSON for the plain engine, with every function
 * of the document written inline. `u` and `v` are free inputs, declared
 * `real` by the test. The value is a list of four points: `p`, multiplied by
 * three selections over list conditions, one of them a comparison whose
 * operand is a `Which` over a list condition.
 *
 * Used by `test/compute-engine/ce-792-comparison-over-selection.test.ts`.
 */
export const TYCHO_NJNCRG9FKV_PROGRAM = [
  'Block',
  [
    'Declare',
    'p',
    "'unknown'",
    [
      'Add',
      [
        'PointList',
        [
          'Multiply',
          [
            'PointX',
            [
              'Add',
              [
                'Multiply',
                0.5,
                [
                  'At',
                  [
                    'List',
                    ['PointList', 1, 0, 0],
                    ['PointList', -1, 0, 0],
                    ['PointList', 0, 1, 0],
                    ['PointList', 0, -1, 0],
                    ['PointList', 0, 0, 1],
                    ['PointList', 0, 0, -1],
                  ],
                  ['Add', ['Multiply', 6, 'u'], 1],
                ],
              ],
              [
                'PointList',
                [
                  'Add',
                  [
                    'Multiply',
                    [
                      'Add',
                      ['Multiply', 6, 'u'],
                      ['Negate', ['Floor', ['Multiply', 6, 'u']]],
                      -0.5,
                    ],
                    [
                      'At',
                      ['List', 0, 0, 0, 0, 1, 1],
                      ['Add', ['Multiply', 6, 'u'], 1],
                    ],
                  ],
                  [
                    'Multiply',
                    ['Add', 'v', -0.5],
                    [
                      'At',
                      ['List', 0, 0, 1, 1, 0, 0],
                      ['Add', ['Multiply', 6, 'u'], 1],
                    ],
                  ],
                ],
                [
                  'Multiply',
                  ['Add', 'v', -0.5],
                  [
                    'At',
                    ['List', 1, 1, 0, 0, 1, 1],
                    ['Add', ['Multiply', 6, 'u'], 1],
                  ],
                ],
                [
                  'Multiply',
                  [
                    'Add',
                    ['Multiply', 6, 'u'],
                    ['Negate', ['Floor', ['Multiply', 6, 'u']]],
                    -0.5,
                  ],
                  [
                    'At',
                    ['List', 1, 1, 1, 1, 0, 0],
                    ['Add', ['Multiply', 6, 'u'], 1],
                  ],
                ],
              ],
            ],
          ],
          ['List', 0.8, 0.2, 0.8, 0.2],
        ],
        [
          'Multiply',
          [
            'PointY',
            [
              'Add',
              [
                'Multiply',
                0.5,
                [
                  'At',
                  [
                    'List',
                    ['PointList', 1, 0, 0],
                    ['PointList', -1, 0, 0],
                    ['PointList', 0, 1, 0],
                    ['PointList', 0, -1, 0],
                    ['PointList', 0, 0, 1],
                    ['PointList', 0, 0, -1],
                  ],
                  ['Add', ['Multiply', 6, 'u'], 1],
                ],
              ],
              [
                'PointList',
                [
                  'Add',
                  [
                    'Multiply',
                    [
                      'Add',
                      ['Multiply', 6, 'u'],
                      ['Negate', ['Floor', ['Multiply', 6, 'u']]],
                      -0.5,
                    ],
                    [
                      'At',
                      ['List', 0, 0, 0, 0, 1, 1],
                      ['Add', ['Multiply', 6, 'u'], 1],
                    ],
                  ],
                  [
                    'Multiply',
                    ['Add', 'v', -0.5],
                    [
                      'At',
                      ['List', 0, 0, 1, 1, 0, 0],
                      ['Add', ['Multiply', 6, 'u'], 1],
                    ],
                  ],
                ],
                [
                  'Multiply',
                  ['Add', 'v', -0.5],
                  [
                    'At',
                    ['List', 1, 1, 0, 0, 1, 1],
                    ['Add', ['Multiply', 6, 'u'], 1],
                  ],
                ],
                [
                  'Multiply',
                  [
                    'Add',
                    ['Multiply', 6, 'u'],
                    ['Negate', ['Floor', ['Multiply', 6, 'u']]],
                    -0.5,
                  ],
                  [
                    'At',
                    ['List', 1, 1, 1, 1, 0, 0],
                    ['Add', ['Multiply', 6, 'u'], 1],
                  ],
                ],
              ],
            ],
          ],
          ['List', 0.2, 0.8, 0.2, 0.8],
        ],
        [
          'Multiply',
          0.6,
          [
            'PointZ',
            [
              'Add',
              [
                'Multiply',
                0.5,
                [
                  'At',
                  [
                    'List',
                    ['PointList', 1, 0, 0],
                    ['PointList', -1, 0, 0],
                    ['PointList', 0, 1, 0],
                    ['PointList', 0, -1, 0],
                    ['PointList', 0, 0, 1],
                    ['PointList', 0, 0, -1],
                  ],
                  ['Add', ['Multiply', 6, 'u'], 1],
                ],
              ],
              [
                'PointList',
                [
                  'Add',
                  [
                    'Multiply',
                    [
                      'Add',
                      ['Multiply', 6, 'u'],
                      ['Negate', ['Floor', ['Multiply', 6, 'u']]],
                      -0.5,
                    ],
                    [
                      'At',
                      ['List', 0, 0, 0, 0, 1, 1],
                      ['Add', ['Multiply', 6, 'u'], 1],
                    ],
                  ],
                  [
                    'Multiply',
                    ['Add', 'v', -0.5],
                    [
                      'At',
                      ['List', 0, 0, 1, 1, 0, 0],
                      ['Add', ['Multiply', 6, 'u'], 1],
                    ],
                  ],
                ],
                [
                  'Multiply',
                  ['Add', 'v', -0.5],
                  [
                    'At',
                    ['List', 1, 1, 0, 0, 1, 1],
                    ['Add', ['Multiply', 6, 'u'], 1],
                  ],
                ],
                [
                  'Multiply',
                  [
                    'Add',
                    ['Multiply', 6, 'u'],
                    ['Negate', ['Floor', ['Multiply', 6, 'u']]],
                    -0.5,
                  ],
                  [
                    'At',
                    ['List', 1, 1, 1, 1, 0, 0],
                    ['Add', ['Multiply', 6, 'u'], 1],
                  ],
                ],
              ],
            ],
          ],
        ],
      ],
      ['PointList', ['List', 0, 0.3, 0, -0.3], ['List', 0.3, 0, -0.3, 0], 0.3],
    ],
  ],
  [
    'Multiply',
    'p',
    [
      'Which',
      ['Less', ['PointZ', 'p'], 0.3],
      [
        'Which',
        ['Less', 0, ['PointX', 'p']],
        ['If', ['Less', 0.1, ['Abs', ['PointY', 'p']]], 1],
        'True',
        1,
      ],
      'True',
      1,
    ],
    [
      'If',
      [
        'Less',
        [
          'Which',
          ['Less', ['Abs', ['Add', ['PointZ', 'p'], -0.35]], 0.1],
          [
            'Which',
            ['Less', ['Abs', ['PointY', 'p']], 0.8],
            ['Which', ['Less', ['Abs', ['PointX', 'p']], 0.1], 2, 'True', 1],
            'True',
            1,
          ],
          'True',
          1,
        ],
        2,
      ],
      1,
    ],
    [
      'If',
      [
        'Less',
        [
          'Which',
          ['Less', ['Abs', ['Add', ['PointZ', 'p'], -0.35]], 0.1],
          [
            'Which',
            ['Less', ['Abs', ['PointY', 'p']], 0.1],
            [
              'Which',
              ['Less', ['Abs', ['Add', ['PointX', 'p'], 0.3]], 0.3],
              2,
              'True',
              1,
            ],
            'True',
            1,
          ],
          'True',
          1,
        ],
        2,
      ],
      1,
    ],
  ],
] as const;
