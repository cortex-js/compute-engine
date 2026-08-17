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

  test('preserves explicit `any` and `unknown` collection elements', () => {
    const ce = new ComputeEngine();
    for (const kind of ['list', 'set']) {
      expect(parseType(kind)).toBe(kind);
      expect(reduceType(parseType(kind))).toBe(kind);

      for (const element of ['any', 'unknown']) {
        const source = `${kind}<${element}>`;
        expect(typeToString(parseType(source))).toBe(source);
        expect(typeToString(reduceType(parseType(source)))).toBe(source);
        expect(ce.type(source).toString()).toBe(source);
        expect(ce.type(source).matches(`${source} & ${source}`)).toBe(true);
        expect(ce.type(source).matches(`${kind} & ${kind}`)).toBe(true);
      }
    }

    // A bare constructor admits its entire collection kind, including an
    // absence element. Explicit `unknown` does not: absence is opt-in for
    // placeholders.
    for (const kind of ['list', 'set']) {
      expect(isSubtype(`${kind}<nothing>`, kind)).toBe(true);
      expect(isSubtype(`${kind}<nothing>`, `${kind}<unknown>`)).toBe(false);
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

    // A `tensor` carries NO dimensions — its rank is unknown — so there is no
    // shape to preserve and `tensor<any>` really is the bare primitive.
    expect(parseType('tensor<any>')).toBe('list');
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
