import { isSubtype } from '../../src/common/type/subtype';
import type { PrimitiveType, Type } from '../../src/common/type/types';
import { PRIMITIVE_TYPES } from '../../src/common/type/primitive';
import { parseType } from '../../src/common/type/parse';
import { reduceType } from '../../src/common/type/reduce';
import { typeToString } from '../../src/common/type/serialize';
import { ComputeEngine } from '../../src/compute-engine';

describe('isSubtype with an intersection on the right', () => {
  test.each(PRIMITIVE_TYPES)(
    'a bare `%s` obeys the conjunction rule',
    (name: PrimitiveType) => {
      const intersection: Type = {
        kind: 'intersection',
        types: [name, name],
      };
      expect(isSubtype(name, intersection)).toBe(true);
    }
  );

  test('requires the left type to be a subtype of every arm', () => {
    expect(isSubtype('integer', 'number & real')).toBe(true);
    expect(isSubtype('number', 'number & boolean')).toBe(false);
  });

  test('works through unions and primitive structural expansions', () => {
    expect(
      isSubtype('integer | string', '(number | string) & (real | string)')
    ).toBe(true);
    expect(isSubtype('string', 'string & collection')).toBe(true);
    expect(isSubtype('range', 'range & indexed_collection')).toBe(true);
  });

  test('is exposed through BoxedType.matches()', () => {
    const ce = new ComputeEngine();
    expect(ce.type('number').matches('number & number')).toBe(true);
  });

  test('bare constructors are `<unknown>` synonyms; explicit `any` survives', () => {
    // User ruling 2026-08-17: a bare collection constructor is a SYNONYM for
    // its `<unknown>` parameterization ("some list of values, element type
    // not stated"), so the explicit `<unknown>` spelling normalizes to the
    // bare canonical form. An explicit `<any>` is a different, strictly
    // wider contract — it additionally admits absence elements — and
    // survives normalization; it is NOT a subtype of the bare name.
    const ce = new ComputeEngine();
    for (const kind of ['list', 'set']) {
      expect(parseType(kind)).toBe(kind);
      expect(reduceType(parseType(kind))).toBe(kind);

      // `<unknown>` collapses to the bare synonym, in both directions.
      expect(parseType(`${kind}<unknown>`)).toBe(kind);
      expect(ce.type(`${kind}<unknown>`).toString()).toBe(kind);
      expect(ce.type(kind).matches(`${kind}<unknown>`)).toBe(true);

      // `<any>` survives and sits strictly ABOVE the bare name.
      const source = `${kind}<any>`;
      expect(typeToString(parseType(source))).toBe(source);
      expect(typeToString(reduceType(parseType(source)))).toBe(source);
      expect(ce.type(source).toString()).toBe(source);
      expect(ce.type(source).matches(`${source} & ${source}`)).toBe(true);
      expect(ce.type(kind).matches(source)).toBe(true);
      expect(ce.type(source).matches(`${kind} & ${kind}`)).toBe(false);
    }

    // Absence elements are excluded from the values-only bare form (= its
    // `<unknown>` synonym) and admitted by the explicit `<any>` contract.
    for (const kind of ['list', 'set']) {
      expect(isSubtype(`${kind}<nothing>`, kind)).toBe(false);
      expect(isSubtype(`${kind}<nothing>`, `${kind}<any>`)).toBe(true);
    }
  });

  test('does not erase dimensions from `list<any>`', () => {
    expect(parseType('list<any^2x3>')).toEqual({
      kind: 'list',
      elements: 'any',
      dimensions: [2, 3],
    });

    // `reduceType()` must not collapse a dimensioned `list<any>` either: the
    // bare `list` primitive cannot carry a shape.
    expect(reduceType(parseType('list<any^2x3>'))).toEqual({
      kind: 'list',
      elements: 'any',
      dimensions: [2, 3],
    });

    expect(typeToString(reduceType(parseType('list<any>')))).toBe('list<any>');
  });

  test('keeps the rank of an unsized `vector`, and drops only `tensor`s', () => {
    // A vector is RANK-1 with an open length, and `-1` is how that is
    // spelled. Dropping it would build the identical type as a bare `list`,
    // whose rank is unconstrained — a strictly weaker type.
    for (const source of ['vector', 'vector<number>'])
      expect(parseType(source)).toEqual({
        kind: 'list',
        elements: 'number',
        dimensions: [-1],
      });

    expect(parseType('vector<any>')).toEqual({
      kind: 'list',
      elements: 'any',
      dimensions: [-1],
    });
    expect(reduceType(parseType('vector<any>'))).toEqual({
      kind: 'list',
      elements: 'any',
      dimensions: [-1],
    });

    // A sized vector keeps its literal dimension.
    expect(parseType('vector<any^3>')).toEqual({
      kind: 'list',
      elements: 'any',
      dimensions: [3],
    });
    expect(reduceType(parseType('vector<any^3>'))).toEqual({
      kind: 'list',
      elements: 'any',
      dimensions: [3],
    });

    // A `tensor` carries NO dimensions — its rank is unknown — so there is
    // no shape to preserve and the tensor spelling normalizes into the
    // `list` family. Bare `list` means `list<unknown>` (user ruling
    // 2026-08-17), so it is `tensor<unknown>` that collapses to the bare
    // primitive; `tensor<any>` keeps its wider, absence-admitting element.
    expect(parseType('tensor<unknown>')).toBe('list');
    expect(parseType('tensor<any>')).toEqual({ kind: 'list', elements: 'any' });
  });

  test('round-trips every open-rank list spelling through the serializer', () => {
    // The serializer expresses an open rank by NESTING (`list<list<T>>`), and
    // that breaks in two places these spellings must survive: at rank 1 the
    // nested form loses the rank entirely, and at rank 2 it can lose the outer
    // rank when the inner form canonicalizes to a bare list. Both now use the
    // named head instead.
    for (const [source, expected] of [
      ['vector', 'vector'],
      ['vector<any>', 'vector<any>'],
      ['vector<real>', 'vector<real>'],
      ['list<any^-1>', 'vector<any>'],
      ['matrix', 'matrix'],
      ['matrix<any>', 'matrix<any>'],
      ['matrix<real>', 'matrix<real>'],
      ['list<any^2x3>', 'list<any^(2x3)>'],
    ] as const) {
      const once = typeToString(reduceType(parseType(source)) as Type);
      expect(once).toBe(expected);
      // Serializing the re-parsed form must reach the same string, or the
      // spelling is lossy.
      expect(typeToString(reduceType(parseType(once)) as Type)).toBe(once);
    }
  });
});

describe('intersection parameters at the call boundary', () => {
  test('admit literals and declared symbols that satisfy every arm', () => {
    const ce = new ComputeEngine();
    ce.declare('acceptIntersection', {
      signature: '(number & number) -> number',
      evaluate: ([x]) => x,
    });
    ce.declare('n', 'number');

    expect(ce.box(['acceptIntersection', 7]).evaluate().toString()).toBe('7');
    expect(ce.box(['acceptIntersection', 'n']).evaluate().toString()).toBe('n');
  });

  test('still rejects an argument that fails one arm', () => {
    const ce = new ComputeEngine();
    ce.declare('acceptIntersection', {
      signature: '(number & boolean) -> number',
      evaluate: ([x]) => x,
    });

    expect(ce.box(['acceptIntersection', 7]).evaluate().toString()).toContain(
      'incompatible-type'
    );
  });
});

describe('`any` / `unknown` lattice (repaired 2026-08-17)', () => {
  // `unknown` is the top of the VALUE types; `any` sits STRICTLY above it,
  // additionally admitting the absence markers. `any <: unknown` used to be
  // (wrongly) true, which made the two mutual subtypes while they disagreed
  // on `nothing` — so the relation was not transitive.
  test('`any` is strictly above `unknown`', () => {
    expect(isSubtype('unknown', 'any')).toBe(true);
    expect(isSubtype('any', 'unknown')).toBe(false);
    expect(isSubtype('nothing', 'any')).toBe(true);
    expect(isSubtype('nothing', 'unknown')).toBe(false);
  });

  test('transitivity holds through the list family', () => {
    // The witness chain that used to break: with `any <: unknown`,
    // `list<nothing> <: list<any> <: list<unknown>` both held while
    // `list<nothing> <: list<unknown>` did not.
    expect(isSubtype('list<nothing>', 'list<any>')).toBe(true);
    expect(isSubtype('list<any>', 'list<unknown>')).toBe(false);
    expect(isSubtype('list<nothing>', 'list<unknown>')).toBe(false);
  });

  test('a union with an absence arm is not a value type', () => {
    // The blanket "everything <: unknown" rule must not admit a union whose
    // arm is an absence marker — that is what keeps a Missing-bearing list
    // out of the values-only bare `list`.
    expect(isSubtype('integer | missing', 'unknown')).toBe(false);
    expect(isSubtype('integer | string', 'unknown')).toBe(true);
    expect(isSubtype('list<integer | missing>', 'list')).toBe(false);
    expect(isSubtype('list<integer | missing>', 'list<any>')).toBe(true);
  });

  test('bare constructors relate as their `<unknown>` synonyms', () => {
    expect(isSubtype('list', 'list<any>')).toBe(true);
    expect(isSubtype('list<any>', 'list')).toBe(false);
    expect(isSubtype('list', 'collection<unknown>')).toBe(true);
    expect(isSubtype('list', 'list<integer>')).toBe(false);
    expect(isSubtype('record', 'dictionary<unknown>')).toBe(true);
    expect(isSubtype('tuple', 'indexed_collection')).toBe(true);
    expect(isSubtype('tuple<integer, missing>', 'tuple')).toBe(false);
  });

  test('couldMatch sees overlap for a bare collection subject (Tycho F3)', () => {
    // A bare subject expands to its `<unknown>` synonym before the overlap
    // probes, so overlap no longer depends on one side happening to CONTAIN
    // the other: `indexed_collection` overlaps both the more specific
    // `list<tuple<…>>` and the less specific `collection<number>` (they meet
    // in `indexed_collection<number>`). Disjoint kinds still refute.
    const ce = new ComputeEngine();
    expect(
      ce.type('indexed_collection').couldMatch('list<tuple<number, number>>')
    ).toBe(true);
    expect(ce.type('indexed_collection').couldMatch('collection<number>')).toBe(
      true
    );
    expect(ce.type('list<any>').couldMatch('collection<number>')).toBe(true);
    expect(ce.type('list').couldMatch('set<number>')).toBe(false);
  });

  test('shape gates use the `<any>` family tops', () => {
    // A `list<any>` or `list<nothing>` operand is still collection-SHAPED
    // even though it is not a subtype of the values-only bare names; shape
    // and capability gates therefore ask against `collection<any>` /
    // `indexed_collection<any>` (see COLLECTION_SHAPE_TYPE, primitive.ts).
    const ce = new ComputeEngine();
    expect(ce.type('list<any>').matches('indexed_collection<any>')).toBe(true);
    expect(ce.type('list<nothing>').matches('collection<any>')).toBe(true);
    expect(ce.type('list<integer|missing>').matches('collection<any>')).toBe(
      true
    );
  });
});
