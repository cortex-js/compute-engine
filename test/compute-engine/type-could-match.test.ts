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
    const t = ce.type(
      'list<finite_integer | tuple<finite_integer, finite_integer>>'
    );
    expect(t.couldMatch(POINT_LIST)).toBe(true);

    // The witness: a value that inhabits both.
    const witness = ce.parse('[(1,2),(3,4)]').type;
    expect(witness.matches(t)).toBe(true);
    expect(witness.matches(POINT_LIST)).toBe(true);
  });

  it('is decisive for shapes that cannot coincide', () => {
    // A bare point is not a list of points, either way round.
    expect(
      ce.type('tuple<finite_integer, finite_integer>').couldMatch(POINT_LIST)
    ).toBe(false);
    // Element types that cannot coincide.
    expect(ce.type('list<integer>').couldMatch('list<string>')).toBe(false);
    // A set and a list are different runtime shapes.
    expect(ce.type('set<integer>').couldMatch('list<integer>')).toBe(false);
  });

  it('accepts an arm narrower OR wider than the target', () => {
    // Narrower: forward assignability carries it.
    expect(
      ce
        .type('list<tuple<finite_integer, finite_integer>>')
        .couldMatch(POINT_LIST)
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
    expect(ce.type('collection<number>').couldMatch('broadcastable<number>')).toBe(
      true
    );
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
      'tuple<finite_integer, finite_integer>',
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
