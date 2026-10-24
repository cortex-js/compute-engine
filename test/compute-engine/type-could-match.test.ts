import { ComputeEngine } from '../../src/compute-engine';

/**
 * `BoxedType.couldMatch()` — "could a value of this type be a `target`?".
 *
 * The predicate for classifying a value by shape. `matches()` answers the
 * other question ("is EVERY value of this type a `target`"), which reports
 * `false` for a union whose members include exactly the shape asked about.
 */

const ce = new ComputeEngine();

const POINT = 'tuple<number, number>';
const POINT_LIST = 'list<tuple<number, number>>';

describe('BoxedType.couldMatch', () => {
  it('sees through a union that `matches()` rejects wholesale', () => {
    const t = ce.type(`${POINT} | ${POINT_LIST}`);
    expect(t.matches(POINT_LIST)).toBe(false); // all-branch
    expect(t.couldMatch(POINT_LIST)).toBe(true);
    expect(t.couldMatch(POINT)).toBe(true);
  });

  it('distributes over a union nested inside a parameter', () => {
    // A heterogeneous list literal produces exactly this type.
    const t = ce.type('list<integer | tuple<integer, integer>>');
    expect(t.couldMatch(POINT_LIST)).toBe(true);

    // The witness: a value that inhabits both.
    const witness = ce.parse('[(1,2),(3,4)]').type;
    expect(witness.matches(t)).toBe(true);
    expect(witness.matches(POINT_LIST)).toBe(true);
  });

  it('is decisive for shapes that cannot coincide', () => {
    // A bare point is not a list of points, either way round.
    expect(ce.type('tuple<integer, integer>').couldMatch(POINT_LIST)).toBe(
      false
    );
    // Element types that cannot coincide: two lists with no dimensions
    // still share the empty list, a fixed-length list does not.
    expect(ce.type('list<integer>').couldMatch('list<string>')).toBe(true);
    expect(ce.type('list<integer^2>').couldMatch('list<string^2>')).toBe(false);
    // A set and a list are different runtime shapes.
    expect(ce.type('set<integer>').couldMatch('list<integer>')).toBe(false);
  });

  it('accepts an arm narrower OR wider than the target', () => {
    // Narrower: forward assignability carries it.
    expect(
      ce.type('list<tuple<integer, integer>>').couldMatch(POINT_LIST)
    ).toBe(true);
    // Wider: the evaluated type widens the element to a bare `tuple`.
    expect(ce.type('list<tuple>').couldMatch(POINT_LIST)).toBe(true);
  });

  it('compares list dimensions', () => {
    expect(ce.type('list<integer^2>').couldMatch('list<integer^3>')).toBe(
      false
    );
    expect(ce.type('list<integer^2>').couldMatch('list<integer^2>')).toBe(true);
    // A wildcard dimension admits any size.
    expect(ce.type('matrix<number^2x2>').couldMatch('list<vector<2>>')).toBe(
      true
    );
  });

  it('compares tuple element names', () => {
    // Two different names cannot describe the same element.
    expect(
      ce
        .type('tuple<x: number, y: number>')
        .couldMatch('tuple<a: number, b: number>')
    ).toBe(false);
    // A name is erasable, so named and unnamed can coincide.
    expect(ce.type('tuple<x: number, y: number>').couldMatch(POINT)).toBe(true);
    // Arity is load-bearing.
    expect(ce.type(POINT).couldMatch('tuple<number, number, number>')).toBe(
      false
    );
  });

  it('treats `never` as uninhabited — unlike `matches()`', () => {
    expect(ce.type('never').matches(POINT_LIST)).toBe(true); // vacuous subtype
    expect(ce.type('never').couldMatch(POINT_LIST)).toBe(false);
  });

  it('lets `unknown` be anything (consumers guard with isUnknown)', () => {
    expect(ce.type('unknown').couldMatch(POINT_LIST)).toBe(true);
    expect(ce.type('unknown').isUnknown).toBe(true);
  });

  it('distributes `broadcastable<T>` as the union `T | indexed_collection<T>`', () => {
    // The same expansion `isSubtype` and `provablyDisjoint` use. Before
    // 2026-08-18 a broadcastable subject fell to the containment fallback,
    // which answered `broadcastable<number>` vs `collection<any>` with
    // `false` even though the collection arm inhabits it.
    expect(ce.type('broadcastable<number>').couldMatch('collection<any>')).toBe(
      true
    );
    expect(
      ce.type('collection<number>').couldMatch('broadcastable<number>')
    ).toBe(true);
    // The scalar arm is visible too, and disjoint types stay refused.
    expect(ce.type('broadcastable<number>').couldMatch('integer')).toBe(true);
    expect(ce.type('broadcastable<number>').couldMatch('string')).toBe(false);
  });

  it('accepts a Type, a TypeString or a BoxedType, and throws on a bad string', () => {
    const t = ce.type(POINT_LIST);
    expect(t.couldMatch(POINT_LIST)).toBe(true);
    expect(t.couldMatch(ce.type(POINT_LIST))).toBe(true);
    expect(t.couldMatch(ce.type(POINT_LIST).type)).toBe(true);
    expect(() => t.couldMatch('bogus~~')).toThrow();
  });

  describe('invariants over a type corpus', () => {
    const CORPUS = [
      'integer',
      'number',
      'real',
      'complex',
      'string',
      'boolean',
      'nothing',
      'unknown',
      'any',
      'value',
      'scalar',
      'collection',
      'expression',
      'list',
      'tuple',
      'set<integer>',
      'set<string>',
      'list<integer>',
      'list<number>',
      'list<string>',
      'list<unknown>',
      'vector',
      'matrix',
      'matrix<number^2x2>',
      'list<vector<2>>',
      'list<integer^2>',
      POINT,
      'tuple<integer, integer>',
      'tuple<x: number, y: number>',
      'tuple<number, number, number>',
      'list<tuple>',
      POINT_LIST,
      'integer | string',
      'integer | boolean',
      'boolean | nothing',
      `${POINT} | ${POINT_LIST}`,
      'broadcastable<number>',
      'collection<integer>',
      'integer<0..10>',
      '(number)->number',
    ];

    it('is symmetric', () => {
      const asymmetric = CORPUS.flatMap((a) =>
        CORPUS.filter(
          (b) => ce.type(a).couldMatch(b) !== ce.type(b).couldMatch(a)
        ).map((b) => `${a} | ${b}`)
      );
      expect(asymmetric).toEqual([]);
    });

    it('is never narrower than assignability in either direction', () => {
      // The structural probe only ever ADDS answers; anything it does not
      // model falls back to `matches()`. (`never` is the one deliberate
      // exception, and is excluded from the corpus above.)
      const narrower = CORPUS.flatMap((a) =>
        CORPUS.filter((b) => {
          const [A, B] = [ce.type(a), ce.type(b)];
          return (A.matches(B) || B.matches(A)) && !A.couldMatch(B);
        }).map((b) => `${a} | ${b}`)
      );
      expect(narrower).toEqual([]);
    });
  });
});

describe('BoxedType.unionMembers', () => {
  it('returns the boxed arms of a union', () => {
    expect(
      ce.type(`${POINT} | ${POINT_LIST}`).unionMembers.map((t) => t.toString())
    ).toEqual([POINT, POINT_LIST]);
  });

  it('returns the type itself for a non-union', () => {
    expect(ce.type('integer').unionMembers.map((t) => t.toString())).toEqual([
      'integer',
    ]);
    expect(ce.type(POINT_LIST).unionMembers.map((t) => t.toString())).toEqual([
      POINT_LIST,
    ]);
  });

  it('yields usable BoxedTypes', () => {
    const arms = ce.type(`${POINT} | ${POINT_LIST}`).unionMembers;
    expect(arms.some((a) => a.matches(POINT_LIST))).toBe(true);
  });

  // A union nested inside a parameter is not reached by an arm walk — that is
  // what `couldMatch()` is for.
  it('does not reach a union nested inside a parameter', () => {
    const t = ce.type('list<integer | string>');
    expect(t.unionMembers.map((x) => x.toString())).toEqual([
      'list<integer | string>',
    ]);
  });
});

/**
 * `couldMatch(other, { nonEmpty: true })` (ROADMAP CE-397, Tycho row 429):
 * could a value that is not an empty collection have both types? Without the
 * option, two list types with no dimensions always overlap through the empty
 * list, so the answer cannot tell a list of numbers from a list of points.
 */
describe('BoxedType.couldMatch with nonEmpty', () => {
  const nonEmpty = { nonEmpty: true };
  test.each([
    ['list<number>', POINT_LIST],
    ['list<number>', 'collection<color>'],
    ['list<number>', 'list<string>'],
    ['list<string>', 'list<tuple>'],
    ['indexed_collection<number>', POINT_LIST],
    ['list<number>', 'indexed_collection<boolean>'],
    ['tensor<number>', POINT_LIST],
    ['broadcastable<number>', POINT_LIST],
    ['number | list<number>', 'list<string>'],
    // `list<never>` holds only the empty list.
    ['list<never>', POINT_LIST],
  ])('%s and %s: no non-empty value has both types', (a, b) => {
    expect(ce.type(a).couldMatch(b)).toBe(true);
    expect(ce.type(a).couldMatch(b, nonEmpty)).toBe(false);
    expect(ce.type(b).couldMatch(a, nonEmpty)).toBe(false);
  });

  test.each([
    ['list<integer | tuple<number, number>>', POINT_LIST],
    ['list<boolean>', 'indexed_collection<boolean>'],
    ['list<integer>', 'list<number>'],
    ['matrix<integer>', 'list<list<integer>>'],
    // Only the outer list must be non-empty: `[[]]` has both types.
    ['list<list<number>>', 'list<list<string>>'],
    // A type that is not a collection: the option changes nothing.
    ['number', 'integer'],
    ['broadcastable<number>', 'number'],
  ])('%s and %s: a non-empty value has both types', (a, b) => {
    expect(ce.type(a).couldMatch(b, nonEmpty)).toBe(true);
    expect(ce.type(b).couldMatch(a, nonEmpty)).toBe(true);
  });

  test('a tensor whose first axis has the length 0 holds only the empty value', () => {
    expect(
      ce.type('vector<integer^0>').couldMatch('vector<integer^0>', nonEmpty)
    ).toBe(false);
    expect(
      ce.type('vector<integer^0>').couldMatch('list<integer>', nonEmpty)
    ).toBe(false);
    // Two empty rows: the outer list is not empty.
    expect(
      ce
        .type('matrix<integer^(2x0)>')
        .couldMatch('list<list<integer>>', nonEmpty)
    ).toBe(true);
  });

  test('a dictionary is read by its values', () => {
    expect(
      ce.type('dictionary<number>').couldMatch('dictionary<integer>', nonEmpty)
    ).toBe(true);
    expect(
      ce.type('dictionary<number>').couldMatch('dictionary<string>', nonEmpty)
    ).toBe(false);
  });

  test('a pair that does not overlap at all stays false', () => {
    expect(ce.type('set<number>').couldMatch('list<number>', nonEmpty)).toBe(
      false
    );
    expect(ce.type('list<number>').couldMatch(POINT, nonEmpty)).toBe(false);
  });
});
