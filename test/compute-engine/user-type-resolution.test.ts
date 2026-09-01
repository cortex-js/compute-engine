import { ComputeEngine } from '../../src/compute-engine';

//
// User-declared type names must survive every hop that goes through a type
// STRING. `parseType()` without a resolver throws `Unknown type "point"` on a
// user name, so any site that parses a type string on behalf of the engine has
// to reach for `ce._typeResolver` (or, better, skip the string entirely and
// build the `Type` node structurally).
//
// These are regressions for the two families of resolver-blind sites:
//   1. `BoxedType`'s string-pattern predicates (`matches`, `is`,
//      `isDisjointFrom`, `couldMatch`) forwarded the raw string to the
//      engine-independent predicates in `common/type/subtype.ts`.
//   2. Type handlers that re-serialized their operand types into a template
//      (`tuple<${a.type}, ${b.type}>`) and reparsed it without a resolver.
//

describe('BoxedType string predicates with a user-declared type', () => {
  const ce = new ComputeEngine();
  ce.declareType('point', 'tuple<number, number>', { alias: true });

  test('matches() accepts a user type name as the string pattern', () => {
    // Used to throw `Failed to parse type "point"`.
    expect(ce.type('tuple<number, number>').matches('point')).toBe(true);
  });

  test('matches() on a user-typed receiver, ground string pattern', () => {
    // The reverse direction: the receiver is the reference, the pattern is a
    // ground type string. It must not throw. (Whether an ALIAS reference on
    // the left unfolds structurally is decided by `subtype.ts`, not here.)
    expect(() =>
      ce.type('point').matches('tuple<number, number>')
    ).not.toThrow();
    expect(ce.type('point').matches('point')).toBe(true);
  });

  test('is() accepts a user type name', () => {
    expect(() => ce.type('point').is('point')).not.toThrow();
    expect(ce.type('point').is('point')).toBe(true);
  });

  test('isDisjointFrom() accepts a user type name', () => {
    // `point` is an alias of the very tuple it is compared against, so the
    // answer is `false` either way; what matters is that the name resolves
    // instead of throwing `Failed to parse type "point"`.
    expect(() => ce.type('string').isDisjointFrom('point')).not.toThrow();
    expect(ce.type('tuple<number, number>').isDisjointFrom('point')).toBe(
      false
    );
  });

  test('couldMatch() accepts a user type name', () => {
    expect(ce.type('tuple<number, number>').couldMatch('point')).toBe(true);
    expect(ce.type('string').couldMatch('point')).toBe(false);
  });

  test('an unknown (undeclared) name still throws', () => {
    expect(() => ce.type('number').matches('nosuchtype')).toThrow();
  });

  test('ground type strings still resolve (cached, resolver-less path)', () => {
    expect(ce.type('integer').matches('number')).toBe(true);
    expect(ce.type('number').matches('integer')).toBe(false);
    expect(ce.type('list<integer>').matches('list<number>')).toBe(true);
    expect(ce.type('integer').isDisjointFrom('string')).toBe(true);
    expect(ce.type('integer | string').couldMatch('string')).toBe(true);
    // On an engine with NO user types at all — the resolver never enters.
    const bare = new ComputeEngine();
    expect(bare.type('integer').matches('integer')).toBe(true);
    expect(() => bare.type('integer').matches('point')).toThrow();
  });
});

describe('type handlers over user-typed operands', () => {
  const ce = new ComputeEngine();
  ce.declareType('point', 'tuple<number, number>', { alias: true });
  ce.declare('p', 'point');
  ce.declare('q', 'point');

  test('Sequence of user-typed symbols', () => {
    // Used to throw `Failed to parse type "tuple<point, point>"`.
    expect(ce.box(['Sequence', 'p', 'q']).type.toString()).toBe(
      'tuple<point, point>'
    );
  });

  test('Sequence arity edge cases are unchanged', () => {
    expect(ce.box(['Sequence']).type.toString()).toBe('nothing');
    expect(ce.box(['Sequence', 'p']).type.toString()).toBe('point');
  });

  test('Tuple / Pair of user-typed symbols', () => {
    expect(ce.box(['Tuple', 'p', 'q']).type.toString()).toBe(
      'tuple<point, point>'
    );
    expect(ce.box(['Pair', 'p', 'q']).type.toString()).toBe(
      'tuple<point, point>'
    );
    expect(ce.box(['Single', 'p']).type.toString()).toBe('tuple<point>');
  });

  test('List of user-typed symbols', () => {
    expect(ce.box(['List', 'p', 'q']).type.toString()).toContain('point');
  });

  test('ground-typed operands are typed exactly as before', () => {
    const bare = new ComputeEngine();
    expect(bare.box(['Sequence', 1, 'x']).type.toString()).toBe(
      'tuple<integer, unknown>'
    );
    expect(bare.box(['Pair', 1, 2]).type.toString()).toBe(
      'tuple<integer, integer>'
    );
  });
});
