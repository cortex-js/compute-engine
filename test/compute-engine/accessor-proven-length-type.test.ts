/**
 * The result type of `First`, `Second`, `Third`, `Last` and of `At` with a
 * literal index has an absent member (`missing` for a point, a string or a
 * row, `nan` for a number) only when the access can find nothing (user
 * decision 2026-09-30). When the operand is PROVED to hold the position, the
 * result is the element type. The proof is read from pure sources
 * (`provenLengthD`, `library/collections.ts`): a list type with a length,
 * a list literal, a string literal, a `Range` with literal bounds.
 */
import { ComputeEngine } from '../../src/compute-engine';

const POINTS = ['List', ['Tuple', 1, 2], ['Tuple', 3, 4]];

function engine(): ComputeEngine {
  const ce = new ComputeEngine();
  ce.declare('n', 'integer');
  ce.declare('pts', 'list<tuple<number, number>>');
  ce.declare('pts2', 'list<tuple<number, number>^2>');
  ce.declare('v3', 'list<number^3>');
  ce.declare('m23', 'matrix<2x3>');
  ce.declare('held', 'list<tuple<number, number>>');
  ce.assign('held', ce.box(POINTS as any));
  return ce;
}

function typeOf(ce: ComputeEngine, json: unknown): string {
  return ce.box(json as any).type.toString();
}

describe('an access into an operand proved to hold the position', () => {
  const ce = engine();

  test.each([
    ['First', [POINTS], 'tuple<integer, integer>'],
    ['Second', [POINTS], 'tuple<integer, integer>'],
    ['Last', [POINTS], 'tuple<integer, integer>'],
    ['At', [POINTS, 1], 'tuple<integer, integer>'],
    ['At', [POINTS, -1], 'tuple<integer, integer>'],
    ['First', [['List', 7, 8, 9]], 'integer'],
    ['Third', [['List', 7, 8, 9]], 'integer'],
    ['At', [['List', 7, 8, 9], 2], 'integer'],
    ['First', [['List', { str: 'a' }, { str: 'b' }]], 'string'],
    ['First', ['pts2'], 'tuple<number, number>'],
    ['Last', ['pts2'], 'tuple<number, number>'],
    ['First', [['Reverse', POINTS]], 'tuple<integer, integer>'],
    ['First', [['Range', 1, 5]], 'integer'],
    ['Third', [['Range', 1, 5]], 'integer'],
    ['Last', [['Range', 2, 10, 2]], 'integer'],
    ['First', [{ str: 'abc' }], 'character'],
    ['Third', [{ str: 'abc' }], 'character'],
    // A range with no step counts towards its upper bound: 5, 4, 3, 2, 1.
    ['Third', [['Range', 5, 1]], 'integer'],
    // A step that is not an integer: 0, 0.5, 1.
    ['Third', [['Range', 0, 1, 0.5]], 'real'],
    // A matrix type states its rows.
    ['First', ['m23'], 'vector<3>'],
    ['Last', ['m23'], 'vector<3>'],
  ])('%s%j is typed %s', (head, args, expected) => {
    expect(typeOf(ce, [head, ...(args as unknown[])])).toBe(expected);
  });
});

describe('an access into an operand proved NOT to hold the position', () => {
  const ce = engine();

  // The value is always the marker, but the type keeps `T | marker(T)`: a
  // chained read chooses its marker from the element type the inner access
  // states (`M[7][1]` over a matrix answers `NaN` because `M[7]` is typed
  // `missing | vector<…>`, a row of numbers).
  test.each([
    ['Third', [POINTS], 'missing | tuple<integer, integer>'],
    ['At', [POINTS, 9], 'missing | tuple<integer, integer>'],
    ['At', [POINTS, 0], 'missing | tuple<integer, integer>'],
    ['At', [['List', 7, 8, 9], 9], 'integer | nan'],
    ['At', ['v3', 4], 'number'],
    ['At', [{ str: 'abc' }, 9], 'character | missing'],
  ])('%s%j is typed %s', (head, args, expected) => {
    expect(typeOf(ce, [head, ...(args as unknown[])])).toBe(expected);
  });

  test('the value is the marker', () => {
    expect(ce.box(['Third', POINTS] as any).evaluate().toString()).toBe(
      '"Missing"'
    );
    expect(ce.box(['At', ['List', 7, 8, 9], 9]).evaluate().isNaN).toBe(true);
  });

  test('a chained read past the end of a matrix answers the numeric marker', () => {
    const rows = ['List', ['List', 1, 2], ['List', 3, 4]];
    expect(ce.box(['At', ['At', rows, 7], 1] as any).evaluate().isNaN).toBe(
      true
    );
  });
});

describe('an access that can find nothing keeps its absent member', () => {
  const ce = engine();
  const filter = [
    'Filter',
    POINTS,
    ['Function', ['Greater', ['At', 'c', 1], 0], 'c'],
  ];

  test.each([
    // A filter can select nothing.
    ['First', [filter], 'missing | tuple<integer, integer>'],
    // The type of `Rest` has no length, so an empty result is possible.
    ['First', [['Rest', POINTS]], 'missing | tuple<integer, integer>'],
    // A declaration with no length: the value can be replaced by `[]`.
    ['First', ['pts'], 'missing | tuple<number, number>'],
    ['First', ['held'], 'missing | tuple<number, number>'],
    // A range with a symbolic bound.
    ['First', [['Range', 1, 'n']], 'integer | nan'],
    // A range that holds fewer elements than the position.
    ['Third', [['Range', 1, 2]], 'integer | nan'],
    ['First', [['Range', 1, 5, -1]], 'integer | nan'],
    // A variable index.
    ['At', [POINTS, 'n'], 'missing | tuple<integer, integer>'],
  ])('%s%j is typed %s', (head, args, expected) => {
    expect(typeOf(ce, [head, ...(args as unknown[])])).toBe(expected);
  });

  test('an operand that may be absent as a whole keeps the member', () => {
    // `At(rows, n)` is typed `missing | vector<integer^2>`: the row has a
    // length, but there may be no row.
    const rows = ['List', ['List', 1, 2], ['List', 3, 4]];
    const t = typeOf(ce, ['First', ['At', rows, 'n']]);
    expect(t).toContain('nan');
  });
});
