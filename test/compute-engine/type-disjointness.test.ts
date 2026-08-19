import { ComputeEngine } from '../../src/compute-engine';
import { isSubtype } from '../../src/common/type/subtype';

/**
 * `BoxedType.isDisjointFrom()` — the "do these two types share any value"
 * predicate. Consumers reach for `matches()` for this and get the wrong
 * answer, because `matches()` is subtyping (`this <: other`), not overlap.
 */

const ce = new ComputeEngine();

describe('BoxedType.isDisjointFrom', () => {
  it('reports overlap that subtyping misses in both directions', () => {
    const a = ce.type('integer | string');
    const b = ce.type('integer | boolean');
    // Neither contains the other...
    expect(a.matches(b)).toBe(false);
    expect(b.matches(a)).toBe(false);
    // ...yet they share `integer`.
    expect(a.isDisjointFrom(b)).toBe(false);
  });

  it('is symmetric', () => {
    const pairs: [string, string][] = [
      ['integer | string', 'integer | boolean'],
      ['integer', 'string'],
      ['integer', 'number'],
      ['integer<0..10>', 'integer<20..30>'],
      ['nothing', 'integer'],
    ];
    for (const [a, b] of pairs)
      expect(ce.type(a).isDisjointFrom(ce.type(b))).toBe(
        ce.type(b).isDisjointFrom(ce.type(a))
      );
  });

  it('proves disjointness for unrelated primitives', () => {
    expect(ce.type('integer').isDisjointFrom('string')).toBe(true);
    expect(ce.type('boolean').isDisjointFrom('real')).toBe(true);
  });

  it('does not claim disjointness when one type contains the other', () => {
    expect(ce.type('integer').isDisjointFrom('number')).toBe(false);
    expect(ce.type('real').isDisjointFrom('complex')).toBe(false);
    expect(ce.type('list<integer>').isDisjointFrom('list<number>')).toBe(false);
  });

  it('distributes over unions (disjoint iff every member is)', () => {
    // No member of the union meets `boolean`.
    expect(ce.type('integer | string').isDisjointFrom('boolean')).toBe(true);
    expect(
      ce.type('integer | string').isDisjointFrom('boolean | nothing')
    ).toBe(true);
    // One member does.
    expect(ce.type('integer | string').isDisjointFrom('boolean | real')).toBe(
      false
    );
  });

  it('compares numeric ranges by their intervals', () => {
    expect(ce.type('integer<0..10>').isDisjointFrom('integer<20..30>')).toBe(
      true
    );
    expect(ce.type('integer<0..10>').isDisjointFrom('integer<5..30>')).toBe(
      false
    );
  });

  it('treats `never` as disjoint from everything and `unknown` from nothing', () => {
    expect(ce.type('never').isDisjointFrom('integer')).toBe(true);
    expect(ce.type('never').isDisjointFrom('unknown')).toBe(true);
    // An undeclared symbol is `unknown`: it may hold any value, so it is never
    // provably disjoint. Consumers dispatching on overlap must special-case it.
    expect(ce.type('unknown').isDisjointFrom('integer')).toBe(false);
    expect(ce.type('any').isDisjointFrom('integer')).toBe(false);
  });

  it('accepts a Type, a TypeString or a BoxedType', () => {
    const t = ce.type('integer');
    expect(t.isDisjointFrom('string')).toBe(true);
    expect(t.isDisjointFrom(ce.type('string'))).toBe(true);
    expect(t.isDisjointFrom(ce.type('string').type)).toBe(true);
  });

  it('throws on a target that is not a valid type', () => {
    expect(() => ce.type('integer').isDisjointFrom('bogus~~')).toThrow();
  });

  it('separates types by their primitive category', () => {
    // Composite vs. primitive.
    expect(ce.type('list<integer>').isDisjointFrom('string')).toBe(true);
    expect(ce.type('(number)->number').isDisjointFrom('integer')).toBe(true);
    // Sibling composite categories: no value is both.
    expect(
      ce
        .type('tuple<number, number>')
        .isDisjointFrom('list<tuple<number, number>>')
    ).toBe(true);
    expect(ce.type('set<integer>').isDisjointFrom('list<integer>')).toBe(true);
    // `record` is NOT a sibling of `dictionary` — it is its named-shape
    // SUBTYPE (the documented hierarchy nests record under dictionary, and a
    // record value IS a dictionary value): not disjoint. An earlier pin here
    // claimed disjointness; it was added in a batch of sibling-composite
    // examples and contradicted both the type-hierarchy doc and the runtime,
    // which handles record in every dictionary-kind branch.
    expect(
      ce.type('record{red: integer}').isDisjointFrom('dictionary<integer>')
    ).toBe(false);
    // The unit types are distinct from each other and from everything else.
    expect(ce.type('nothing').isDisjointFrom('missing')).toBe(true);
    expect(ce.type('nothing').isDisjointFrom('boolean')).toBe(true);
  });

  it('does not separate a narrow category from a broad one that contains it', () => {
    // The lattice places the broad buckets above the narrow ones, so these
    // meet rather than answering "disjoint".
    expect(ce.type('list<integer>').isDisjointFrom('collection')).toBe(false);
    expect(ce.type('integer').isDisjointFrom('value')).toBe(false);
    expect(ce.type('integer').isDisjointFrom('scalar')).toBe(false);
    expect(ce.type('list<integer>').isDisjointFrom('expression')).toBe(false);
    // `broadcastable<T>` is `T | indexed_collection<T>` — it spans two
    // categories, so no category conclusion is drawn about it.
    expect(
      ce.type('broadcastable<number>').isDisjointFrom('list<number>')
    ).toBe(false);
    expect(ce.type('broadcastable<number>').isDisjointFrom('number')).toBe(
      false
    );
  });

  it('reaches a unit type nested inside a union', () => {
    // Regression: the `nothing`/`missing` short-circuit compared a string
    // against a composite `Type` object and claimed disjointness here. The
    // value `Nothing` inhabits both sides.
    expect(ce.type('nothing').isDisjointFrom('boolean | nothing')).toBe(false);
    expect(ce.type('missing').isDisjointFrom('boolean | missing')).toBe(false);
    expect(ce.type('nothing').isDisjointFrom('boolean | missing')).toBe(true);
    expect(isSubtype('nothing', '!(boolean | nothing)')).toBe(false);
  });

  // Characterization, not a guarantee: the predicate errs toward "may
  // overlap". Two same-category composites whose parameters cannot coincide
  // are NOT claimed disjoint — `list<never>` is a subtype of both, so the
  // claim would rest on how the empty list is typed rather than on the
  // lattice. `couldMatch()` answers this question decisively.
  it('is conservative for same-category composites with disjoint parameters', () => {
    expect(ce.type('list<integer>').isDisjointFrom('list<string>')).toBe(false);
    expect(ce.type('list<integer>').couldMatch('list<string>')).toBe(false);
    expect(isSubtype('list<never>', 'list<integer>')).toBe(true);
    expect(isSubtype('list<never>', 'list<string>')).toBe(true);
  });
});

describe('union distribution reaches negation subtyping', () => {
  it('a union is a subtype of !B when no member meets B', () => {
    expect(isSubtype('integer | boolean', '!string')).toBe(true);
    expect(isSubtype('integer | string', '!string')).toBe(false);
  });
});

describe('negations and intersections in disjointness', () => {
  it('a negation is disjoint from the very type it excludes', () => {
    // `!T` excludes `T` by construction, but neither side is a subtype of the
    // other, so the subtype-based overlap test cannot see it; the negation
    // rule answers by containment instead (`other <: T`).
    expect(ce.type('!integer').isDisjointFrom('integer')).toBe(true);
    expect(ce.type('integer').isDisjointFrom('!integer')).toBe(true);
    // Containment, not overlap: every `integer` is a `number`, so `!number`
    // has no integers either.
    expect(ce.type('!number').isDisjointFrom('integer')).toBe(true);
  });

  it('stays conservative on a partial overlap and on two negations', () => {
    // `imaginary` is a `number` outside `integer`, so the pair shares values.
    expect(ce.type('!integer').isDisjointFrom('number')).toBe(false);
    // `boolean` is outside both `integer` and `string`.
    expect(ce.type('!integer').isDisjointFrom('!string')).toBe(false);
  });

  it('an intersection is disjoint as soon as any member is', () => {
    // The intersection's inhabitants live inside every member, so one
    // disjoint member leaves them nowhere to overlap the other side.
    expect(ce.type('!integer & number').isDisjointFrom('integer')).toBe(true);
    expect(ce.type('integer & finite_real').isDisjointFrom('string')).toBe(
      true
    );
    // ...but a shared inhabitant keeps the conservative answer.
    expect(ce.type('!integer & number').isDisjointFrom('number')).toBe(false);
  });

  it('makes an intersection a subtype of its own negation member', () => {
    // `X <: !B` is decided by disjointness, so before the two rules above an
    // intersection carrying a negation was not a subtype of that member.
    expect(isSubtype('!integer & number', '!integer')).toBe(true);
    expect(isSubtype('!integer & number', 'number')).toBe(true);
    expect(isSubtype('imaginary', '!integer & number')).toBe(true);
    expect(isSubtype('integer', '!integer & number')).toBe(false);
  });
});
