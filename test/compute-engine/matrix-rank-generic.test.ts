import { engine as ce } from '../utils';

/**
 * `MatrixRank` of a matrix of free symbols is its rank over the field of
 * functions of the symbols (Wolfram's "generic rank"): full when the matrix
 * has full rank at some integer point.
 */
const matrix = (rows: any[][]) => ['List', ...rows.map((r) => ['List', ...r])];
const rank = (rows: any[][]) => ce.expr(['MatrixRank', matrix(rows)]);

const full: [string, any[][], number][] = [
  [
    '2×2 of four symbols',
    [
      ['a', 'b'],
      ['c', 'd'],
    ],
    2,
  ],
  [
    '3×3 of nine symbols',
    [
      ['a', 'b', 'c'],
      ['d', 'p', 'q'],
      ['r', 's', 't'],
    ],
    3,
  ],
  [
    '2×3',
    [
      ['a', 'b', 'c'],
      ['d', 'p', 'q'],
    ],
    2,
  ],
  [
    '3×2',
    [
      ['a', 'b'],
      ['c', 'd'],
      ['p', 'q'],
    ],
    2,
  ],
  ['a single row', [['a', 'b']], 1],
  [
    'a repeated symbol, [[x, 1], [1, x]]',
    [
      ['x', 1],
      [1, 'x'],
    ],
    2,
  ],
  [
    'a symbol and a number in each row',
    [
      ['a', 1],
      [2, 'b'],
    ],
    2,
  ],
  [
    'an entry with a pole at the first point',
    [
      [['Divide', 1, ['Subtract', 'x', 2]], 1],
      [1, 'x'],
    ],
    2,
  ],
  [
    'polynomial entries',
    [
      [['Power', 'x', 2], 'y'],
      ['y', ['Add', 'x', 1]],
    ],
    2,
  ],
];

describe('MatrixRank of a matrix of symbols', () => {
  for (const [name, rows, expected] of full) {
    test(`${name} has rank ${expected} (evaluate)`, () => {
      expect(rank(rows).evaluate().json).toBe(expected);
    });
    test(`${name} has rank ${expected} (.N())`, () => {
      expect(rank(rows).N().json).toBe(expected);
    });
  }

  test('the parse route: [[a, b], [c, d]] has rank 2', () => {
    expect(
      ce.parse('\\operatorname{MatrixRank}([[a, b], [c, d]])').evaluate().json
    ).toBe(2);
  });
});

describe('MatrixRank of a matrix of symbols that is not decided', () => {
  const stays: [string, any[][]][] = [
    // Rank-deficient generically: no point shows it.
    [
      'rows that are multiples',
      [
        ['a', 'b', 'c'],
        [
          ['Multiply', 2, 'a'],
          ['Multiply', 2, 'b'],
          ['Multiply', 2, 'c'],
        ],
        ['d', 'p', 'q'],
      ],
    ],
    // The entries are never rational at an integer point.
    [
      'trig entries',
      [
        [
          ['Sin', 't'],
          ['Cos', 't'],
        ],
        [
          ['Cos', 't'],
          ['Sin', 't'],
        ],
      ],
    ],
  ];
  for (const [name, rows] of stays) {
    test(`${name} stays MatrixRank`, () => {
      expect(rank(rows).evaluate().operator).toBe('MatrixRank');
    });
  }

  test('a numeric matrix is unchanged: [[1, 2], [2, 4]] has rank 1', () => {
    expect(
      rank([
        [1, 2],
        [2, 4],
      ]).evaluate().json
    ).toBe(1);
  });

  test('the zero determinant of a 2×2 is still rank 1: [[a, b], [a, b]]', () => {
    expect(
      rank([
        ['a', 'b'],
        ['a', 'b'],
      ]).evaluate().json
    ).toBe(1);
  });
});
