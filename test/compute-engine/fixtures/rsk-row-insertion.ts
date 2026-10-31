/**
 * The combinator of GitHub issue #487: RSK row insertion written as nested
 * `Fold`s (8 folds, 4 deep). `_raw` stands for the permutation the map is
 * applied to.
 */
export const RSK_ROW_INSERTION: unknown = [
  'Fold',
  [
    'Function',
    [
      'At',
      [
        'Fold',
        [
          'Function',
          [
            'If',
            ['Equal', ['At', 'st', 2], 0],
            'st',
            [
              'If',
              ['Greater', 'r', ['Count', ['At', 'st', 1]]],
              [
                'List',
                [
                  'Fold',
                  [
                    'Function',
                    [
                      'If',
                      ['Greater', 'm', ['Count', ['At', 'st', 1]]],
                      ['Join', 'tacc', ['List', ['List', ['At', 'st', 2]]]],
                      ['Join', 'tacc', ['List', ['At', ['At', 'st', 1], 'm']]],
                    ],
                    'tacc',
                    'm',
                  ],
                  ['List'],
                  ['Range', 1, ['Add', ['Count', ['At', 'st', 1]], 1], 1],
                ],
                0,
              ],
              [
                'List',
                [
                  'Fold',
                  [
                    'Function',
                    [
                      'Join',
                      'tacc',
                      [
                        'List',
                        [
                          'If',
                          ['Equal', 'm', 'r'],
                          [
                            'Apply',
                            [
                              'Function',
                              [
                                'If',
                                ['Equal', 'bumped', 0],
                                [
                                  'Fold',
                                  [
                                    'Function',
                                    [
                                      'If',
                                      [
                                        'Greater',
                                        'n',
                                        ['Count', ['At', ['At', 'st', 1], 'r']],
                                      ],
                                      [
                                        'Join',
                                        'nacc',
                                        ['List', ['At', 'st', 2]],
                                      ],
                                      [
                                        'Join',
                                        'nacc',
                                        [
                                          'List',
                                          [
                                            'At',
                                            ['At', ['At', 'st', 1], 'r'],
                                            'n',
                                          ],
                                        ],
                                      ],
                                    ],
                                    'nacc',
                                    'n',
                                  ],
                                  ['List'],
                                  [
                                    'Range',
                                    1,
                                    [
                                      'Add',
                                      ['Count', ['At', ['At', 'st', 1], 'r']],
                                      1,
                                    ],
                                    1,
                                  ],
                                ],
                                [
                                  'Fold',
                                  [
                                    'Function',
                                    [
                                      'Join',
                                      'nacc',
                                      [
                                        'List',
                                        [
                                          'If',
                                          [
                                            'Equal',
                                            [
                                              'At',
                                              ['At', ['At', 'st', 1], 'r'],
                                              'n',
                                            ],
                                            'bumped',
                                          ],
                                          ['At', 'st', 2],
                                          [
                                            'At',
                                            ['At', ['At', 'st', 1], 'r'],
                                            'n',
                                          ],
                                        ],
                                      ],
                                    ],
                                    'nacc',
                                    'n',
                                  ],
                                  ['List'],
                                  [
                                    'Range',
                                    1,
                                    ['Count', ['At', ['At', 'st', 1], 'r']],
                                    1,
                                  ],
                                ],
                              ],
                              'bumped',
                            ],
                            [
                              'Apply',
                              [
                                'Function',
                                [
                                  'If',
                                  ['Equal', ['Count', 'larger'], 0],
                                  0,
                                  ['Min', 'larger'],
                                ],
                                'larger',
                              ],
                              [
                                'Fold',
                                [
                                  'Function',
                                  [
                                    'If',
                                    [
                                      'Greater',
                                      ['At', ['At', ['At', 'st', 1], 'r'], 'g'],
                                      ['At', 'st', 2],
                                    ],
                                    [
                                      'Join',
                                      'bacc',
                                      [
                                        'List',
                                        [
                                          'At',
                                          ['At', ['At', 'st', 1], 'r'],
                                          'g',
                                        ],
                                      ],
                                    ],
                                    'bacc',
                                  ],
                                  'bacc',
                                  'g',
                                ],
                                ['List'],
                                [
                                  'Range',
                                  1,
                                  ['Count', ['At', ['At', 'st', 1], 'r']],
                                  1,
                                ],
                              ],
                            ],
                          ],
                          ['At', ['At', 'st', 1], 'm'],
                        ],
                      ],
                    ],
                    'tacc',
                    'm',
                  ],
                  ['List'],
                  ['Range', 1, ['Count', ['At', 'st', 1]], 1],
                ],
                [
                  'Apply',
                  [
                    'Function',
                    [
                      'If',
                      ['Equal', ['Count', 'larger'], 0],
                      0,
                      ['Min', 'larger'],
                    ],
                    'larger',
                  ],
                  [
                    'Fold',
                    [
                      'Function',
                      [
                        'If',
                        [
                          'Greater',
                          ['At', ['At', ['At', 'st', 1], 'r'], 'g'],
                          ['At', 'st', 2],
                        ],
                        [
                          'Join',
                          'bacc',
                          ['List', ['At', ['At', ['At', 'st', 1], 'r'], 'g']],
                        ],
                        'bacc',
                      ],
                      'bacc',
                      'g',
                    ],
                    ['List'],
                    ['Range', 1, ['Count', ['At', ['At', 'st', 1], 'r']], 1],
                  ],
                ],
              ],
            ],
          ],
          'st',
          'r',
        ],
        ['List', 'a', 'b'],
        ['Range', 1, ['Add', ['Count', 'a'], 1], 1],
      ],
      1,
    ],
    'a',
    'b',
  ],
  ['List'],
  '_raw',
];
