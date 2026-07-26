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

  // Characterization, not a guarantee: the predicate errs toward "may
  // overlap". These two are in fact disjoint, but composite-vs-primitive
  // disjointness is not proven, so the answer is the safe `false`.
  it('is conservative when disjointness cannot be established', () => {
    expect(ce.type('list<integer>').isDisjointFrom('string')).toBe(false);
  });
});

describe('union distribution reaches negation subtyping', () => {
  it('a union is a subtype of !B when no member meets B', () => {
    expect(isSubtype('integer | boolean', '!string')).toBe(true);
    expect(isSubtype('integer | string', '!string')).toBe(false);
  });
});
