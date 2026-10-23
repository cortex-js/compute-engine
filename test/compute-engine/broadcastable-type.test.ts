import { parseType } from '../../src/common/type/parse';
import { isSubtype } from '../../src/common/type/subtype';
import { typeToString } from '../../src/common/type/serialize';
import { reduceType } from '../../src/common/type/reduce';
import { collectionElementType, widen } from '../../src/common/type/utils';
import { BoxedType } from '../../src/common/type/boxed-type';
import type { Type } from '../../src/common/type/types';

const s = (t: Type): string => typeToString(t);

describe('broadcastable<T> — parse / serialize', () => {
  it('parses and serializes broadcastable<number>', () => {
    const t = parseType('broadcastable<number>');
    expect(typeof t).toBe('object');
    expect((t as any).kind).toBe('broadcastable');
    expect(s(t)).toBe('broadcastable<number>');
  });

  it('parses bare broadcastable as broadcastable<any> (object form)', () => {
    const t = parseType('broadcastable');
    expect(typeof t).toBe('object');
    expect((t as any).kind).toBe('broadcastable');
    expect((t as any).elements).toBe('any');
    expect(s(t)).toBe('broadcastable<any>');
  });

  it('parses nested broadcastable<list<number>>', () => {
    const t = parseType('broadcastable<list<number>>');
    expect((t as any).kind).toBe('broadcastable');
    expect(s(t)).toBe('broadcastable<list<number>>');
  });

  it('round-trips through parse → serialize → parse', () => {
    for (const src of [
      'broadcastable<number>',
      'broadcastable<integer>',
      'broadcastable<list<number>>',
    ]) {
      expect(s(parseType(s(parseType(src))))).toBe(src);
    }
  });
});

describe('broadcastable<T> — subsumption (positive)', () => {
  it('T <: broadcastable<T> (scalar branch)', () => {
    expect(isSubtype('number', 'broadcastable<number>')).toBe(true);
  });

  it('S <: T ⟹ S <: broadcastable<T>', () => {
    expect(isSubtype('integer', 'broadcastable<number>')).toBe(true);
  });

  it('lists of S with S <: T are broadcastable', () => {
    expect(isSubtype('list<number>', 'broadcastable<number>')).toBe(true);
    expect(isSubtype('list<integer>', 'broadcastable<number>')).toBe(true);
    expect(isSubtype('vector<3>', 'broadcastable<number>')).toBe(true);
    // `broadcastable<T>` is `T | list<T>`. A value typed only
    // `indexed_collection<T>` may be a tuple, which broadcast binds whole, so
    // it is not in the type.
    expect(
      isSubtype('indexed_collection<integer>', 'broadcastable<number>')
    ).toBe(false);
  });

  it('is covariant in the element type', () => {
    expect(isSubtype('broadcastable<integer>', 'broadcastable<number>')).toBe(
      true
    );
  });

  it('is reflexive', () => {
    expect(isSubtype('broadcastable<number>', 'broadcastable<number>')).toBe(
      true
    );
  });

  it('broadcastable<T> <: any', () => {
    expect(isSubtype('broadcastable<number>', 'any')).toBe(true);
  });

  it('broadcastable<T> <: R when both T <: R and list<T> <: R', () => {
    // `value` covers both a scalar `number` and a list of numbers
    expect(isSubtype('broadcastable<number>', 'value')).toBe(true);
    expect(isSubtype('broadcastable<number>', 'collection')).toBe(false);
  });

  it('transitivity spot-check: integer <: broadcastable<number>', () => {
    expect(isSubtype('integer', 'broadcastable<number>')).toBe(true);
  });

  it('fits its own defining union (branches covered by different members)', () => {
    // `broadcastable<T>` = `T | tensor<T>` for a numeric `T`; the union rhs
    // covers the scalar and tensor branches with *different* members, which
    // the member-wise union probe alone would reject.
    expect(isSubtype('broadcastable<number>', 'number | tensor')).toBe(true);
    expect(isSubtype('broadcastable<integer>', 'number | tensor')).toBe(true);
    // A tensor of unknown rank is not an indexed collection of its cells:
    // the elements of a matrix are its rows.
    expect(
      isSubtype('broadcastable<number>', 'number | indexed_collection<number>')
    ).toBe(false);
    // ... including as a member of a union lhs.
    expect(
      isSubtype(
        'broadcastable<integer> | string',
        'integer | tensor<integer> | string'
      )
    ).toBe(true);
    // A `list<number>` member does not cover the collection branch: a
    // list of numbers is read by its elements and holds no matrix, which a
    // `tensor` does.
    expect(isSubtype('broadcastable<number>', 'number | list<number>')).toBe(
      false
    );
    expect(isSubtype('number | list<number>', 'broadcastable<number>')).toBe(
      true
    );
  });
});

describe('broadcastable<T> — subsumption (negative)', () => {
  it('a non-indexed collection is not broadcastable (set)', () => {
    expect(isSubtype('set<number>', 'broadcastable<number>')).toBe(false);
  });

  it('a tuple is excluded from the collection branch', () => {
    expect(isSubtype('tuple<number, number>', 'broadcastable<number>')).toBe(
      false
    );
  });

  it('broadcastable<T> is NOT <: T (it may be a collection)', () => {
    expect(isSubtype('broadcastable<number>', 'number')).toBe(false);
  });

  it('broadcastable<T> is NOT <: list<T> / indexed_collection (it may be a scalar)', () => {
    expect(isSubtype('broadcastable<number>', 'list<number>')).toBe(false);
    expect(isSubtype('broadcastable<number>', 'indexed_collection')).toBe(
      false
    );
    expect(
      isSubtype('broadcastable<number>', 'indexed_collection<number>')
    ).toBe(false);
  });

  it('a collection whose elements are not <: T is not broadcastable', () => {
    expect(isSubtype('list<string>', 'broadcastable<number>')).toBe(false);
  });

  it('a scalar of the wrong type is not broadcastable', () => {
    expect(isSubtype('string', 'broadcastable<number>')).toBe(false);
  });

  it('a wider element type is not covariantly below a narrower one', () => {
    expect(isSubtype('broadcastable<number>', 'broadcastable<integer>')).toBe(
      false
    );
  });
});

describe('broadcastable<T> — collectionElementType', () => {
  it('returns the element type', () => {
    // The collection arm of a `broadcastable<integer>` is a tensor of any
    // rank, whose elements are integers (rank 1) or tensors (rank 2 and
    // more).
    expect(s(collectionElementType(parseType('broadcastable<integer>'))!)).toBe(
      'integer | tensor<integer>'
    );
    // A `T` that cannot hold a list has a tensor arm too since 2026-10-22
    // (the arm was `list<boolean>`, whose elements are `boolean`).
    expect(s(collectionElementType(parseType('broadcastable<boolean>'))!)).toBe(
      'boolean | tensor<boolean>'
    );
    // A `T` that can hold a list keeps the plain list arm.
    expect(s(collectionElementType(parseType('broadcastable<any>'))!)).toBe(
      'any'
    );
  });
});

describe('broadcastable<T> — reduce opacity', () => {
  it('stays opaque (never collapses to T or a union)', () => {
    const r = reduceType(parseType('broadcastable<number>'));
    expect((r as any).kind).toBe('broadcastable');
    expect(s(r)).toBe('broadcastable<number>');
  });

  it('broadcastable<any> stays object-form (not collapsed)', () => {
    const r = reduceType(parseType('broadcastable'));
    expect((r as any).kind).toBe('broadcastable');
    expect(s(r)).toBe('broadcastable<any>');
  });

  it('number | broadcastable<number> reduces to broadcastable<number>', () => {
    const u: Type = {
      kind: 'union',
      types: ['number', parseType('broadcastable<number>')],
    };
    expect(s(reduceType(u))).toBe('broadcastable<number>');
  });
});

describe('broadcastable<T> — widen', () => {
  it('widen(number, broadcastable<number>) survives as broadcastable<number>', () => {
    expect(s(widen('number', parseType('broadcastable<number>')) as Type)).toBe(
      'broadcastable<number>'
    );
    expect(s(widen(parseType('broadcastable<number>'), 'number') as Type)).toBe(
      'broadcastable<number>'
    );
  });
});

describe('broadcastable<T> — BoxedType path', () => {
  it('parses via BoxedType and matches subsumption', () => {
    const bt = new BoxedType('broadcastable<number>');
    expect(bt.toString()).toBe('broadcastable<number>');
    expect(bt.matches('any')).toBe(true);
    expect(new BoxedType('integer').matches(bt)).toBe(true);
    expect(new BoxedType('list<integer>').matches(bt)).toBe(true);
    expect(bt.matches('number')).toBe(false);
  });
});

describe('THE ABSTRACT INDEXED COLLECTION IS NOT BROADCASTABLE (CE-9)', () => {
  // `tuple<integer>` is an `indexed_collection<integer>`, and neither is a
  // `broadcastable<integer>`: the collection arm of `broadcastable<T>` is a
  // tensor of `T` (or a plain list of `T` when `T` can hold a list), and a
  // tuple, a string or the abstract `indexed_collection<T>` is not one. So
  // the relation is transitive here (ROADMAP CE-9, user decision 2026-10-23,
  // option B: in effect since the reading of a list by its elements of
  // 2026-10-22; measured with no failing test).
  it('indexed_collection<integer> is not a broadcastable<integer>', () => {
    expect(isSubtype('tuple<integer>', 'indexed_collection<integer>')).toBe(
      true
    );
    expect(
      isSubtype('indexed_collection<integer>', 'broadcastable<integer>')
    ).toBe(false);
    expect(isSubtype('tuple<integer>', 'broadcastable<integer>')).toBe(false);
    expect(isSubtype('collection<integer>', 'broadcastable<integer>')).toBe(
      false
    );
    expect(isSubtype('list<integer>', 'broadcastable<integer>')).toBe(true);
  });

  it('a top element type admits every value through the scalar branch, on both sides', () => {
    // `broadcastable<any>` is `any | list<any>`, and every type is an `any`:
    // the chain is transitive because each step holds.
    expect(isSubtype('indexed_collection<any>', 'broadcastable<any>')).toBe(
      true
    );
    expect(isSubtype('tuple<integer>', 'broadcastable<any>')).toBe(true);
    expect(isSubtype('set<integer>', 'broadcastable<any>')).toBe(true);
  });
});
