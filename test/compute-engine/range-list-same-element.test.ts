import { ComputeEngine } from '../../src/compute-engine';

// A finite `Range` of integers and the `List` literal of its integers are the
// same element for `isSame`, and they have the same hash. So a set does not
// hold both, and membership, `IndexOf`, `Unique` and `Tally` treat them as one
// element. The rule is the same as for a character and a one-cluster string
// with the same content. A range with more than `MAX_RANGE_IDENTITY_COUNT`
// elements, or with operands that are not integer literals, is compared by its
// operands only (user decision 2026-10-25, option A; it follows the decision
// that a `Range` element of a collection literal stays a `Range`, ROADMAP
// CE-39.3).

const ce = new ComputeEngine();

describe('isSame and hash of a finite Range and the List of its integers', () => {
  test.each([
    [
      ['Range', 1, 3],
      ['List', 1, 2, 3],
    ],
    [
      ['Range', 1, 3, 1],
      ['List', 1, 2, 3],
    ],
    [
      ['Range', 1, 3],
      ['Range', 1, 3, 1],
    ],
    [['Range', 3], ['List', 1, 2, 3]],
    [
      ['Range', 3, 1],
      ['List', 3, 2, 1],
    ],
    [
      ['Range', 1, 6, 2],
      ['List', 1, 3, 5],
    ],
    [['Range', 5, 1, 1], ['List']],
    [
      ['Range', 5, 1, 1],
      ['Range', 7, 1, 1],
    ],
    [
      ['Range', 1, 1],
      ['Range', 1, 1, 5],
    ],
    [
      ['List', ['Range', 1, 3]],
      ['List', ['List', 1, 2, 3]],
    ],
    [
      ['Set', ['Range', 1, 3], 4],
      ['Set', 4, ['List', 1, 2, 3]],
    ],
  ])('%j and %j are the same', (x, y) => {
    const a = ce.box(x as any);
    const b = ce.box(y as any);
    expect(a.isSame(b)).toBe(true);
    expect(b.isSame(a)).toBe(true);
    expect(a.hash).toBe(b.hash);
  });

  test.each([
    [
      ['Range', 1, 3],
      ['List', 1, 2, 4],
    ],
    [
      ['Range', 1, 3],
      ['List', 3, 2, 1],
    ],
    [
      ['Range', 1, 3],
      ['List', 1, 2],
    ],
    [
      ['Range', 1, 3],
      ['List', 1, 2.5, 3],
    ],
    [
      ['Range', 1, 3],
      ['Range', 1, 4],
    ],
    [['Range', 1, 3], 'x'],
  ])('%j and %j are not the same', (x, y) => {
    const a = ce.box(x as any);
    const b = ce.box(y as any);
    expect(a.isSame(b)).toBe(false);
    expect(b.isSame(a)).toBe(false);
  });

  test('a store-backed list is the same as the range', () => {
    const list = ce.list([1, 2, 3] as any);
    const range = ce.box(['Range', 1, 3]);
    expect(list.isSame(range)).toBe(true);
    expect(range.isSame(list)).toBe(true);
    expect(list.hash).toBe(range.hash);
  });

  test('the element count is exact when the span is not a safe integer', () => {
    // The span 4 - (-9007199254740991) is 2^53 + 3, which a float rounds to
    // 2^53 + 4: the float count is 3, the exact count is 2.
    const range = ce.box(['Range', -9007199254740991, 4, 4503599627370498]);
    const two = ce.box(['List', -9007199254740991, -4503599627370493]);
    const three = ce.box([
      'List',
      -9007199254740991,
      -4503599627370493,
      5,
    ]);
    expect(range.isSame(two)).toBe(true);
    expect(two.isSame(range)).toBe(true);
    expect(range.hash).toBe(two.hash);
    expect(range.isSame(three)).toBe(false);
    expect(three.isSame(range)).toBe(false);
  });

  test('a range that is too large is compared by its operands', () => {
    const a = ce.box(['Range', 1, 20000]);
    const b = ce.box(['Range', 1, 20000, 1]);
    expect(a.isSame(b)).toBe(false);
    expect(a.isSame(ce.box(['Range', 1, 20000]))).toBe(true);
  });
});

describe('Set merging and membership of a Range and a List', () => {
  const R = ['Range', 1, 3];
  const L = ['List', 1, 2, 3];

  test('box route', () => {
    expect(ce.box(['Length', ['Set', R, L]]).evaluate().json).toBe(1);
    expect(ce.box(['Element', L, ['List', R]]).evaluate().json).toBe('True');
    expect(ce.box(['Element', L, ['Set', R, 4]]).evaluate().json).toBe('True');
    expect(ce.box(['IndexOf', ['List', R], L]).evaluate().json).toBe(1);
    expect(ce.box(['IndexOf', ['List', 4, L], R]).evaluate().json).toBe(2);
    expect(ce.box(['Length', ['Unique', ['List', R, L]]]).evaluate().json).toBe(
      1
    );
    expect(ce.box(['Tally', ['List', R, L, 4]]).evaluate().json).toEqual([
      'Tuple',
      ['List', R, 4],
      ['List', 2, 1],
    ]);
  });

  test('parse route', () => {
    expect(ce.parse('\\{1..3, [1,2,3]\\}').evaluate().json).toEqual([
      'Set',
      R,
    ]);
    expect(ce.parse('[1,2,3] \\in \\{1..3, 4\\}').evaluate().json).toBe(
      'True'
    );
    expect(
      ce.parse('\\operatorname{IndexOf}([1..3, 4], [1,2,3])').evaluate().json
    ).toBe(1);
    expect(
      ce.parse('\\operatorname{Unique}([1..3, [1,2,3]])').evaluate().json
    ).toEqual(['List', R]);
    expect(
      ce.parse('\\operatorname{Tally}([1..3, [1,2,3]])').evaluate().json
    ).toEqual(['Tuple', ['List', R], ['List', 2]]);
  });

  test('Equal is unchanged', () => {
    expect(ce.box(['Equal', R, L]).evaluate().json).toBe('True');
  });
});
