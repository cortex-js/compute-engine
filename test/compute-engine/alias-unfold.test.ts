import { ComputeEngine } from '../../src/compute-engine';
import { isSubtype } from '../../src/common/type/subtype';
import { resolveTypeForCompilation } from '../../src/common/type/utils';
import type { Type, TypeReference } from '../../src/common/type/types';

//
// A STRUCTURAL alias (`{alias: true}`) IS its definition, so an alias
// reference must behave like the definition in OPERAND position too: the
// subtype relation unfolds an alias reference on the LHS as well as on the
// RHS (nominal-types design §6).
//
// Before the fix, `subtype.ts` unfolded only the rhs: alias-typed symbols
// could be declared and assigned but not USED — `m + 1` with `m: meters` (an
// alias of `number`) errored `incompatible-type("number", "meters")` at
// canonicalization, and `First(p)` with `p: pt` (an alias of a tuple) errored
// `incompatible-type("indexed_collection", "pt")`.
//
// A NOMINAL type stays OPAQUE at every one of those sites: it is deliberately
// not a subtype of its definition (D3). Each regression below is therefore
// pinned in BOTH kinds — the alias half must pass, the nominal half must keep
// rejecting.
//

describe('alias LHS-unfold: alias-typed operands are usable', () => {
  const ce = new ComputeEngine();
  ce.declareType('meters', 'number', { alias: true });
  ce.declareType('nmeters', 'number'); // nominal counterpart
  ce.declareType('pt', 'tuple<number, number>', { alias: true });
  ce.declareType('npt', 'tuple<number, number>'); // nominal counterpart
  ce.declare('m', 'meters');
  ce.declare('q', 'nmeters');
  ce.declare('p', 'pt');
  ce.declare('n', 'npt');

  test('arithmetic on an alias of a number', () => {
    expect(ce.box(['Add', 'm', 1]).errors).toHaveLength(0);
    expect(ce.box(['Add', 'm', 1]).toString()).toBe('m + 1');
  });

  test('arithmetic on a NOMINAL number type still rejects', () => {
    const errors = ce.box(['Add', 'q', 1]).errors;
    expect(errors).toHaveLength(1);
    expect(errors[0].toString()).toContain('incompatible-type');
  });

  test('collection access on an alias of a tuple', () => {
    expect(ce.box(['First', 'p']).errors).toHaveLength(0);
  });

  test('collection access on a NOMINAL tuple type still rejects', () => {
    const errors = ce.box(['First', 'n']).errors;
    expect(errors).toHaveLength(1);
    expect(errors[0].toString()).toContain('incompatible-type');
  });

  test('an alias-typed symbol keeps its declared type', () => {
    // Unfolding is a SUBTYPE rule, not a normalization: the symbol still
    // reports the alias name.
    expect(ce.box('m').type.toString()).toBe('meters');
  });
});

describe('alias LHS-unfold: matches() in both directions', () => {
  const ce = new ComputeEngine();
  ce.declareType('pt', 'tuple<number, number>', { alias: true });
  ce.declareType('npt', 'tuple<number, number>');
  ce.declareType('id', 'integer', { alias: true });
  ce.declareType('nid', 'integer');

  test('an alias reference on the LHS unfolds', () => {
    expect(ce.type('pt').matches('tuple<number, number>')).toBe(true);
  });

  test('a nominal reference on the LHS stays opaque', () => {
    expect(ce.type('npt').matches('tuple<number, number>')).toBe(false);
  });

  test('the RHS unfold is unchanged', () => {
    expect(ce.type('tuple<number, number>').matches('pt')).toBe(true);
    expect(ce.type('tuple<number, number>').matches('npt')).toBe(false);
  });

  test('a primitive-body alias matches in BOTH directions', () => {
    expect(ce.type('id').matches('integer')).toBe(true);
    expect(ce.type('integer').matches('id')).toBe(true);
  });

  test('a primitive-body NOMINAL type matches in neither', () => {
    expect(ce.type('nid').matches('integer')).toBe(false);
    expect(ce.type('integer').matches('nid')).toBe(false);
  });

  test('reference-vs-reference reflexivity is unchanged', () => {
    expect(ce.type('pt').matches('pt')).toBe(true);
    expect(ce.type('npt').matches('npt')).toBe(true);
    expect(ce.type('pt').matches('npt')).toBe(false);
    expect(ce.type('npt').matches('pt')).toBe(false);
  });

  test('isDisjointFrom respects the unfold', () => {
    // `provablyDisjoint` starts with a subtype probe in both directions, so
    // the LHS unfold reaches it with no rule of its own.
    expect(ce.type('pt').isDisjointFrom('tuple<number, number>')).toBe(false);
    expect(ce.type('id').isDisjointFrom('string')).toBe(true);
    // A NOMINAL reference stays conservative ("may overlap"), never
    // "provably disjoint" — its meaning is resolver-dependent.
    expect(ce.type('nid').isDisjointFrom('string')).toBe(false);
  });

  test('couldMatch respects the unfold', () => {
    expect(ce.type('id').couldMatch('integer')).toBe(true);
    expect(ce.type('pt').couldMatch('tuple<number, number>')).toBe(true);
  });
});

describe('alias LHS-unfold: recursion is bounded', () => {
  test('a self-referential alias terminates', () => {
    const ce = new ComputeEngine();
    ce.declareType('json', 'list<json> | integer', { alias: true });
    // The reference-vs-reference short-circuit (`lhs.name === rhs.name`) is
    // what stops the walk — the LHS unfold must not preempt it.
    expect(ce.type('json').matches('json')).toBe(true);
    expect(ce.type('json').matches('list<json> | integer')).toBe(true);
    expect(ce.type('integer').matches('json')).toBe(true);
  });

  test('MUTUALLY recursive aliases terminate (conservative cutoff)', () => {
    // Not reachable through `ce.declareType` (a forward reference to an
    // undeclared name throws), so the references are built by hand — this is
    // the shape the depth cutoff exists for: no same-name short-circuit ever
    // fires, and lhs/rhs unfolds alternate forever.
    const a: TypeReference = {
      kind: 'reference',
      name: 'a',
      alias: true,
      def: undefined,
    };
    const b: TypeReference = {
      kind: 'reference',
      name: 'b',
      alias: true,
      def: undefined,
    };
    a.def = { kind: 'list', elements: b } as Type;
    b.def = { kind: 'list', elements: a } as Type;

    // Answers `false` (not provably a subtype) instead of looping.
    expect(isSubtype(a, b)).toBe(false);
    // …and reflexivity still short-circuits.
    expect(isSubtype(a, a)).toBe(true);
    // The unfold set is restored: an ordinary question still answers.
    expect(isSubtype('integer', 'number')).toBe(true);
  });

  test('a LONG acyclic alias chain resolves exactly (no depth cap)', () => {
    // The guard is cycle detection, not a depth cutoff: a chain far longer
    // than the old bound of 24 must still unfold all the way to its body.
    const ce = new ComputeEngine();
    ce.declareType('a0', 'integer', { alias: true });
    for (let i = 1; i <= 60; i++)
      ce.declareType(`a${i}`, `a${i - 1}` as Type, { alias: true });

    expect(ce.type('a60').matches('integer')).toBe(true);
    expect(ce.type('integer').matches('a60')).toBe(true);
    // Two structural aliases of the same body: the LHS unfold walks the whole
    // chain down to `a0` and the same-name reflexivity check answers.
    expect(ce.type('a60').matches('a0')).toBe(true);
    expect(ce.type('a60').matches('string')).toBe(false);
    // …and the disjointness predicate unfolds the same chain.
    expect(ce.type('a60').isDisjointFrom('string')).toBe(true);
    expect(ce.type('a60').isDisjointFrom('integer')).toBe(false);
  });

  test('a long chain nested inside a union body resolves', () => {
    // Each union arm asks its own subtype question WHILE an outer unfold is in
    // flight: the guard must restore per-frame, not wholesale.
    const ce = new ComputeEngine();
    ce.declareType('b0', 'integer', { alias: true });
    for (let i = 1; i <= 40; i++)
      ce.declareType(`b${i}`, `b${i - 1}` as Type, { alias: true });
    ce.declareType('pair', 'b40 | string', { alias: true });

    expect(ce.type('pair').matches('integer | string')).toBe(true);
    expect(ce.type('b40').matches('pair')).toBe(true);
    expect(ce.type('pair').matches('integer')).toBe(false);
    // The set is empty again afterwards: an ordinary question still answers.
    expect(isSubtype('integer', 'number')).toBe(true);
  });

  test('a deep alias chain resolves for compilation', () => {
    const ce = new ComputeEngine();
    ce.declareType('c0', 'integer', { alias: true });
    for (let i = 1; i <= 40; i++)
      ce.declareType(`c${i}`, `c${i - 1}` as Type, { alias: true });

    expect(resolveTypeForCompilation(ce.type('c40').type)).toBe('integer');
  });

  test('resolveTypeForCompilation stops on a cyclic reference', () => {
    const a: TypeReference = {
      kind: 'reference',
      name: 'a',
      alias: true,
      def: undefined,
    };
    const b: TypeReference = {
      kind: 'reference',
      name: 'b',
      alias: true,
      def: undefined,
    };
    a.def = b;
    b.def = a;

    // Terminates, answering with an unresolved reference.
    const resolved = resolveTypeForCompilation(a);
    expect(typeof resolved === 'object' && resolved.kind).toBe('reference');
  });
});
