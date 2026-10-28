import { ComputeEngine } from '../../src/compute-engine';

// A `Range` that is an element of a `List`, `Tuple` or `Set` literal stays a
// range when the literal is evaluated. Before, it was replaced by the list of
// its elements, so the value of `Tuple(Range(1, 3))` was `([1, 2, 3])`, typed
// `tuple<vector<integer^3>>`, which is not in the static type `tuple<range>`
// (user decision 2026-10-25, ROADMAP CE-39.3).

const ce = new ComputeEngine();

describe('A Range element of a collection literal stays a range', () => {
  test.each([
    ['Tuple', ['Tuple', ['Range', 1, 3]]],
    ['List', ['List', ['Range', 1, 3]]],
    ['Set', ['Set', ['Range', 1, 3]]],
    ['List, two ranges', ['List', ['Range', 1, 3], ['Range', 4, 5]]],
    ['List, range and number', ['List', ['Range', 1, 3], 4]],
  ])('box route: %s', (_label, json) => {
    const expr = ce.box(json as any);
    const value = expr.evaluate();
    expect(value.json).toEqual(json);
    expect(value.type.matches(expr.type)).toBe(true);
  });

  test('the static type and the value type agree', () => {
    const expr = ce.box(['Tuple', ['Range', 1, 3]]);
    expect(expr.type.toString()).toBe('tuple<range>');
    expect(expr.evaluate().type.toString()).toBe('tuple<range>');
  });

  test('parse route', () => {
    expect(ce.parse('[1..3, 4]').evaluate().json).toEqual([
      'List',
      ['Range', 1, 3],
      4,
    ]);
    expect(ce.parse('\\{1..3\\}').evaluate().json).toEqual([
      'Set',
      ['Range', 1, 3],
    ]);
  });

  test('under N', () => {
    expect(ce.box(['List', ['Range', 1, 3]]).N().json).toEqual([
      'List',
      ['Range', 1, 3],
    ]);
  });

  test('a variable declared list<range> holds the range', () => {
    const ce2 = new ComputeEngine();
    ce2.declare('L', 'list<range>');
    ce2.assign('L', ce2.box(['List', ['Range', 1, 3]]));
    expect(ce2.symbol('L').evaluate().json).toEqual(['List', ['Range', 1, 3]]);
  });

  test('a top-level Range is unchanged', () => {
    expect(ce.box(['Range', 1, 3]).evaluate().json).toEqual(['Range', 1, 3]);
  });

  test('collection operators read the range element', () => {
    const xs = ['List', ['Range', 1, 3], 4];
    expect(ce.box(['Length', xs]).evaluate().json).toBe(2);
    expect(ce.box(['At', xs, 1]).evaluate().json).toEqual(['Range', 1, 3]);
    expect(ce.box(['Flatten', xs]).evaluate().json).toEqual([
      'List',
      1,
      2,
      3,
      4,
    ]);
    expect(
      ce.box(['Sum', ['At', ['List', ['Range', 1, 3]], 1]]).evaluate().json
    ).toBe(6);
    expect(
      ce
        .box([
          'Map',
          ['Function', ['Length', 'x'], 'x'],
          ['List', ['Range', 1, 3], ['Range', 1, 2]],
        ])
        .evaluate()
        .toString()
    ).toBe('[3,2]');
  });
});

// A `Range` row of a `List` is a row of its integers for the shape and the
// linear-algebra operators: `[1..3, 4..6]` is the matrix
// `[[1, 2, 3], [4, 5, 6]]`. Before, `Shape` read the type `list<range>`,
// which has no dimensions, and gave `()`, and `Transpose` read the list as a
// vector of two cells and returned it unchanged.
describe('A Range row is a row of its integers', () => {
  const ROWS = ['List', ['Range', 1, 3], ['Range', 4, 6]];
  const LITERAL = ['List', ['List', 1, 2, 3], ['List', 4, 5, 6]];
  const SQUARE_ROWS = ['List', ['Range', 1, 2], ['Range', 3, 4]];
  const SQUARE_LITERAL = ['List', ['List', 1, 2], ['List', 3, 4]];

  /** The value, after a check that it is a member of the static type. */
  function value(json: unknown) {
    const expr = ce.box(json as any);
    const result = expr.evaluate();
    expect(result.type.matches(expr.type)).toBe(true);
    return result;
  }

  test.each([
    ['Shape', ROWS, LITERAL, ['Tuple', 2, 3]],
    ['Rank', ROWS, LITERAL, 2],
    [
      'Transpose',
      ROWS,
      LITERAL,
      ['List', ['List', 1, 4], ['List', 2, 5], ['List', 3, 6]],
    ],
    [
      'ConjugateTranspose',
      ROWS,
      LITERAL,
      ['List', ['List', 1, 4], ['List', 2, 5], ['List', 3, 6]],
    ],
    ['Flatten', ROWS, LITERAL, ['List', 1, 2, 3, 4, 5, 6]],
    ['Trace', SQUARE_ROWS, SQUARE_LITERAL, 5],
    ['Diagonal', SQUARE_ROWS, SQUARE_LITERAL, ['List', 1, 4]],
    ['IsSquareMatrix', SQUARE_ROWS, SQUARE_LITERAL, 'True'],
    ['MatrixRank', SQUARE_ROWS, SQUARE_LITERAL, 2],
    ['Dimension', SQUARE_ROWS, SQUARE_LITERAL, 4],
    ['Norm', SQUARE_ROWS, SQUARE_LITERAL, ['Sqrt', 30]],
  ])('%s', (op, rows, literal, expected) => {
    expect(value([op, rows]).json).toEqual(expected);
    expect(value([op, literal]).json).toEqual(expected);
  });

  test('Reshape', () => {
    const expected = ['List', ['List', 1, 2], ['List', 3, 4], ['List', 5, 6]];
    expect(value(['Reshape', ROWS, ['Tuple', 3, 2]]).json).toEqual(expected);
    expect(value(['Reshape', LITERAL, ['Tuple', 3, 2]]).json).toEqual(expected);
  });

  test('a list and a range row', () => {
    const mixed = ['List', ['List', 1, 2, 3], ['Range', 1, 3]];
    expect(value(['Shape', mixed]).json).toEqual(['Tuple', 2, 3]);
    expect(value(['Transpose', mixed]).json).toEqual([
      'List',
      ['List', 1, 1],
      ['List', 2, 2],
      ['List', 3, 3],
    ]);
  });

  // A `Range` element at a deeper level is listed too. The static type of
  // the transpose must hold the listed value (a rank-3 tensor here).
  test.each([
    [
      'Transpose',
      [
        'List',
        ['List', ['Range', 1, 2], ['Range', 3, 4]],
        ['List', ['Range', 5, 6], ['Range', 7, 8]],
      ],
    ],
    ['Transpose', ['List', ['List', ['Range', 1, 2]]]],
    [
      'ConjugateTranspose',
      [
        'List',
        ['List', ['Range', 1, 2], ['Range', 3, 4]],
        ['List', ['Range', 5, 6], ['Range', 7, 8]],
      ],
    ],
    ['ConjugateTranspose', ['List', ['List', ['Range', 1, 2]]]],
  ])('%s of nested range rows: the value fits the type', (op, rows) => {
    const result = value([op, rows]);
    expect(result.operator).toBe('List');
  });

  test('nested range rows: the transposed values', () => {
    expect(
      value([
        'Transpose',
        [
          'List',
          ['List', ['Range', 1, 2], ['Range', 3, 4]],
          ['List', ['Range', 5, 6], ['Range', 7, 8]],
        ],
      ]).json
    ).toEqual([
      'List',
      ['List', ['List', 1, 3], ['List', 2, 4]],
      ['List', ['List', 5, 7], ['List', 6, 8]],
    ]);
    expect(
      value(['Transpose', ['List', ['List', ['Range', 1, 2]]]]).json
    ).toEqual(['List', ['List', ['List', 1], ['List', 2]]]);
  });

  test('Shape and Rank of many long range rows do not list the rows', () => {
    const rows: unknown[] = ['List'];
    for (let i = 0; i < 10_000; i++) rows.push(['Range', 1, 10_000]);
    const definition = ce.lookupDefinition('Range');
    if (
      !definition ||
      !('operator' in definition) ||
      !definition.operator.collection
    )
      throw new Error('Range collection handlers are required');
    const collection = definition.operator.collection;
    const iterator = jest.spyOn(collection, 'iterator');
    const at = jest.spyOn(collection, 'at');
    try {
      expect(value(['Shape', rows]).json).toEqual(['Tuple', 10_000, 10_000]);
      expect(value(['Rank', rows]).json).toBe(2);
      // Reading dimensions may inspect row metadata, but must not traverse the
      // 100 million scalar entries. Counts guard the algorithm independently
      // of machine speed and concurrent CI workers.
      expect(iterator).not.toHaveBeenCalled();
      expect(at.mock.calls.length).toBeLessThanOrEqual(2 * 10_000);
    } finally {
      iterator.mockRestore();
      at.mockRestore();
    }
  });

  test('range rows with too many elements in total are not listed', () => {
    // Each row has 400 elements, but the 400 rows have 160,000 elements
    // together, which is more than the engine lists.
    const rows: unknown[] = ['List'];
    for (let i = 0; i < 400; i++) rows.push(['Range', 1, 400]);
    expect(value(['Transpose', rows]).operator).toBe('Transpose');
  });

  test('a row that cannot be listed leaves the call unevaluated', () => {
    const infinite = ['List', ['Range', 1, 'PositiveInfinity']];
    for (const op of ['Shape', 'Rank', 'Transpose'])
      expect(value([op, infinite]).operator).toBe(op);
  });

  // `Determinant` takes a `matrix`. The operand keeps its type
  // `list<range>`, and the argument check admits it because a list of
  // finite ranges of the same length is a matrix of integers (ROADMAP
  // CE-495, user decision 2026-10-26).
  test('Determinant', () => {
    const det = value(['Determinant', SQUARE_ROWS]);
    expect(det.re).toBeCloseTo(-2);
    expect(value(['Determinant', SQUARE_LITERAL]).re).toBeCloseTo(-2);
  });
});

// A list of finite `Range` rows of the same length is a matrix of integers
// at a parameter that accepts a matrix: the operator reads each range as a
// row. The list keeps its value and its type `list<range>` (ROADMAP CE-495,
// user decision 2026-10-26).
describe('A list of Range rows at a matrix parameter', () => {
  const ROWS = ['List', ['Range', 1, 2], ['Range', 3, 4]];
  const LITERAL = ['List', ['List', 1, 2], ['List', 3, 4]];
  const RAGGED = ['List', ['Range', 1, 2], ['Range', 1, 3]];

  /** The value, after a check that it is a member of the static type. */
  function value(json: unknown) {
    const expr = ce.box(json as any);
    expect(expr.isValid).toBe(true);
    const result = expr.evaluate();
    expect(result.type.matches(expr.type)).toBe(true);
    return result;
  }

  /** `json` with each list of range rows replaced by the literal matrix. */
  function withLiteral(json: unknown[]): unknown[] {
    return json.map((x) => (x === ROWS ? LITERAL : x));
  }

  test('the list keeps its value and its type', () => {
    const rows = ce.box(ROWS as any);
    expect(rows.type.toString()).toBe('list<range>');
    expect(rows.evaluate().json).toEqual(ROWS);
  });

  test.each([
    ['Determinant', [ROWS]],
    ['Inverse', [ROWS]],
    ['PseudoInverse', [ROWS]],
    ['AdjugateMatrix', [ROWS]],
    ['MatrixMultiply', [ROWS, ROWS]],
    ['MatrixMultiply', [ROWS, LITERAL]],
    ['MatrixMultiply', [LITERAL, ROWS]],
    ['Dot', [ROWS, ROWS]],
    ['HadamardProduct', [ROWS, ROWS]],
    ['LinearSolve', [ROWS, ['List', 1, 2]]],
    ['LinearSolve', [LITERAL, ROWS]],
    ['MatrixPower', [ROWS, 2]],
    ['MatrixPower', [ROWS, -1]],
    ['CharacteristicPolynomial', [ROWS]],
    ['RowReduce', [ROWS]],
    ['Eigenvalues', [ROWS]],
    ['Eigenvectors', [ROWS]],
    ['LUDecomposition', [ROWS]],
    ['QRDecomposition', [ROWS]],
    ['SingularValues', [ROWS]],
    ['Trace', [ROWS]],
    ['Norm', [ROWS]],
    ['Norm', [ROWS, 1]],
  ])('box route: %s', (op, args) => {
    const result = value([op, ...args]);
    expect(result.operator).not.toBe(op);
    expect(result.json).toEqual(value([op, ...withLiteral(args)]).json);
  });

  test('the values', () => {
    expect(value(['Determinant', ROWS]).json).toBe(-2);
    expect(value(['Inverse', ROWS]).json).toEqual([
      'List',
      ['List', -2, 1],
      ['List', ['Rational', 3, 2], ['Rational', -1, 2]],
    ]);
    expect(value(['MatrixMultiply', ROWS, ROWS]).json).toEqual([
      'List',
      ['List', 7, 10],
      ['List', 15, 22],
    ]);
  });

  test('under N', () => {
    const expr = ce.box(['Determinant', ROWS]);
    const result = expr.N();
    expect(result.type.matches(expr.type)).toBe(true);
    expect(result.re).toBeCloseTo(-2);
  });

  test('parse route', () => {
    expect(ce.parse('\\det([1..2, 3..4])').evaluate().json).toBe(-2);
    expect(
      ce.parse('\\operatorname{Inverse}([1..2, 3..4])').evaluate().json
    ).toEqual(
      ce.parse('\\operatorname{Inverse}([[1, 2], [3, 4]])').evaluate().json
    );
  });

  test('a symbol that holds a list of range rows', () => {
    const ce2 = new ComputeEngine();
    ce2.declare('L', 'list<range>');
    expect(ce2.box(['Determinant', 'L']).isValid).toBe(true);
    ce2.assign('L', ce2.box(ROWS as any));
    expect(ce2.box(['Determinant', 'L']).evaluate().json).toBe(-2);
  });

  test('rows of different lengths are not a matrix', () => {
    for (const json of [
      ['Determinant', RAGGED],
      ['Inverse', RAGGED],
      ['MatrixMultiply', RAGGED, LITERAL],
    ]) {
      const result = ce.box(json as any).evaluate();
      expect(result.operator).toBe('Error');
      expect(result.toString()).toContain('incompatible-type');
    }
    expect(ce.parse('\\det([1..2, 1..3])').evaluate().toString()).toContain(
      'incompatible-type'
    );
  });

  test('Trace and Norm refuse ragged range rows, as they refuse the literal', () => {
    const raggedLiteral = ['List', ['List', 1, 2], ['List', 1, 2, 3]];
    for (const op of ['Trace', 'Norm']) {
      for (const rows of [RAGGED, raggedLiteral]) {
        const result = ce.box([op, rows] as any).evaluate();
        expect(result.toString()).toContain('incompatible-type');
      }
    }
  });

  test('CharacteristicPolynomial does not convert its variable argument', () => {
    // The second parameter is typed `any`: a list there is not read as a
    // matrix, and the handler uses its default variable, as it did before
    // range rows were admitted.
    expect(value(['CharacteristicPolynomial', ROWS, 't']).toString()).toBe(
      't^2 - 5t - 2'
    );
    const infiniteRows = [
      'List',
      ['Range', 1, 2],
      ['Range', 3, 'PositiveInfinity'],
    ];
    for (const second of [ROWS, infiniteRows, ['List', 1, 2]]) {
      const result = ce
        .box(['CharacteristicPolynomial', LITERAL, second] as any)
        .evaluate();
      expect(result.toString()).toBe('x^2 - 5x - 2');
    }
  });

  test('an infinite range row is not a matrix row', () => {
    const infinite = [
      'List',
      ['Range', 1, 'PositiveInfinity'],
      ['Range', 1, 'PositiveInfinity'],
    ];
    const result = ce.box(['Determinant', infinite] as any).evaluate();
    expect(result.operator).toBe('Error');
    expect(result.toString()).toContain('incompatible-type');
  });

  test('range rows with too many elements in total stay unevaluated', () => {
    // The 400 rows have 160,000 elements together, which is more than the
    // engine lists.
    const rows: unknown[] = ['List'];
    for (let i = 0; i < 400; i++) rows.push(['Range', 1, 400]);
    expect(value(['Determinant', rows]).operator).toBe('Determinant');
  });

  test('a list of ranges and numbers is still refused', () => {
    const expr = ce.box(['Determinant', ['List', ['Range', 1, 2], 3]]);
    expect(expr.isValid).toBe(false);
  });

  test('a parameter of a user function declared matrix still refuses it', () => {
    const ce2 = new ComputeEngine();
    ce2.declare('h', '(matrix) -> number');
    expect(ce2.box(['h', ROWS] as any).isValid).toBe(false);
  });
});
