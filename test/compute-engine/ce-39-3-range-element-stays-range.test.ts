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
    const start = performance.now();
    expect(value(['Shape', rows]).json).toEqual(['Tuple', 10_000, 10_000]);
    expect(value(['Rank', rows]).json).toBe(2);
    expect(performance.now() - start).toBeLessThan(1000);
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

  // `Determinant` takes a `matrix`, and the type `list<range>` of the
  // operand is not a matrix type: the operand is refused when it is boxed.
  // When the type of a list of finite ranges is a matrix type, this test
  // fails, and must become an ordinary test.
  test.failing('Determinant', () => {
    const det = value(['Determinant', SQUARE_ROWS]);
    expect(det.re).toBeCloseTo(-2);
    expect(value(['Determinant', SQUARE_LITERAL]).re).toBeCloseTo(-2);
  });
});
