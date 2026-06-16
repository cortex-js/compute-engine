/**
 * REVIEW.md G15 — intersection (meet) of numeric primitives in the type
 * lattice.
 *
 * The lattice used to reduce incomparable-but-overlapping numeric primitives
 * to `nothing` (e.g. `integer ∩ finite_real` → `nothing`), making type-based
 * membership refutation unsound. The intersection reduction now computes the
 * principled pairwise meet derived from the PRIMITIVE_SUBTYPES table.
 */

import { reduceType } from '../../../src/common/type/reduce';
import {
  isSubtype,
  isPrimitiveSubtype,
  meetPrimitiveTypes,
} from '../../../src/common/type/subtype';
import { typeToString } from '../../../src/common/type/serialize';
import { NUMERIC_TYPES } from '../../../src/common/type/primitive';
import type {
  PrimitiveType,
  Type,
} from '../../../src/common/type/types';

function intersect(a: Type, b: Type): Type {
  return reduceType({ kind: 'intersection', types: [a, b] });
}

function intersectStr(a: Type, b: Type): string {
  const t = intersect(a, b);
  return typeof t === 'string' ? t : typeToString(t);
}

describe('Numeric primitive meets (G15)', () => {
  test('integer ∩ finite_real = finite_integer (integer admits ±∞)', () =>
    expect(intersectStr('integer', 'finite_real')).toBe('finite_integer'));

  test('finite_number ∩ real = finite_real', () =>
    expect(intersectStr('finite_number', 'real')).toBe('finite_real'));

  test('rational ∩ finite_real = finite_rational', () =>
    expect(intersectStr('rational', 'finite_real')).toBe('finite_rational'));

  test('finite_complex ∩ real = finite_real', () =>
    expect(intersectStr('finite_complex', 'real')).toBe('finite_real'));

  test('integer ∩ finite_rational = finite_integer', () =>
    expect(intersectStr('integer', 'finite_rational')).toBe('finite_integer'));

  test('finite_number ∩ rational = finite_rational', () =>
    expect(intersectStr('finite_number', 'rational')).toBe('finite_rational'));

  test('finite_number ∩ integer = finite_integer', () =>
    expect(intersectStr('finite_number', 'integer')).toBe('finite_integer'));

  test('imaginary ∩ finite_number = imaginary (transitivity repair)', () =>
    expect(intersectStr('imaginary', 'finite_number')).toBe('imaginary'));

  test('real ∩ complex = finite_real | non_finite_number', () => {
    // The lattice does not place the infinity-admitting `real` below
    // `complex`, so the meet is the union of the maximal common subtypes.
    const t = intersect('real', 'complex');
    expect(typeof t).toBe('object');
    expect((t as any).kind).toBe('union');
    expect([...(t as any).types].sort()).toEqual([
      'finite_real',
      'non_finite_number',
    ]);
  });

  test('integer ∩ complex = finite_integer | non_finite_number', () => {
    const t = intersect('integer', 'complex');
    expect((t as any).kind).toBe('union');
    expect([...(t as any).types].sort()).toEqual([
      'finite_integer',
      'non_finite_number',
    ]);
  });

  test('subtype-related pairs reduce to the narrower type', () => {
    expect(intersectStr('integer', 'rational')).toBe('integer');
    expect(intersectStr('finite_integer', 'number')).toBe('finite_integer');
    expect(intersectStr('non_finite_number', 'integer')).toBe(
      'non_finite_number'
    );
  });

  test('genuinely disjoint pairs still reduce to nothing', () => {
    expect(intersectStr('imaginary', 'real')).toBe('nothing');
    expect(intersectStr('imaginary', 'rational')).toBe('nothing');
    expect(intersectStr('number', 'boolean')).toBe('nothing');
    expect(intersectStr('integer', 'string')).toBe('nothing');
  });

  test('non-numeric overlapping primitives still meet correctly', () => {
    expect(intersectStr('scalar', 'value')).toBe('scalar');
    expect(intersectStr('collection', 'indexed_collection')).toBe(
      'indexed_collection'
    );
  });

  test('composite/primitive disjoint intersections remain nothing', () => {
    expect(
      intersectStr({ kind: 'list', elements: 'integer' }, 'integer')
    ).toBe('nothing');
  });
});

describe('Meet property: greatest lower bound over the numeric chain', () => {
  // For every pair of numeric primitives, the intersection must:
  //  (1) be a subtype of both operands (soundness), and
  //  (2) be maximal: every numeric primitive that is a common subtype of
  //      both operands must be a subtype of the meet.
  // When the meet is `nothing`, there must be no common numeric subtype.
  for (const a of NUMERIC_TYPES) {
    for (const b of NUMERIC_TYPES) {
      test(`meet(${a}, ${b})`, () => {
        const m = intersect(a, b);
        const commonSubtypes = NUMERIC_TYPES.filter(
          (c) => isPrimitiveSubtype(c, a) && isPrimitiveSubtype(c, b)
        );
        if (m === 'nothing') {
          expect(commonSubtypes).toEqual([]);
        } else {
          // Soundness: m ⊑ a and m ⊑ b
          expect(isSubtype(m, a)).toBe(true);
          expect(isSubtype(m, b)).toBe(true);
          // Maximality: every common subtype is below the meet
          for (const c of commonSubtypes) expect(isSubtype(c, m)).toBe(true);
        }
      });

      test(`meet(${a}, ${b}) is symmetric`, () => {
        expect(intersectStr(a, b)).toBe(intersectStr(b, a));
      });
    }
  }

  test('meetPrimitiveTypes returns maximal, mutually incomparable types', () => {
    for (const a of NUMERIC_TYPES) {
      for (const b of NUMERIC_TYPES) {
        const maximals = meetPrimitiveTypes(a, b);
        for (const t of maximals) {
          expect(isPrimitiveSubtype(t, a)).toBe(true);
          expect(isPrimitiveSubtype(t, b)).toBe(true);
          for (const u of maximals)
            if (u !== t) expect(isPrimitiveSubtype(t, u)).toBe(false);
        }
      }
    }
  });
});

describe('Subtype closure repair', () => {
  test('imaginary ⊑ finite_complex ⊑ finite_number implies imaginary ⊑ finite_number', () => {
    expect(isPrimitiveSubtype('imaginary', 'finite_complex')).toBe(true);
    expect(isPrimitiveSubtype('finite_complex', 'finite_number')).toBe(true);
    expect(isPrimitiveSubtype('imaginary', 'finite_number')).toBe(true);
  });

  test('subtype relation is transitive over all numeric primitives', () => {
    for (const a of NUMERIC_TYPES)
      for (const b of NUMERIC_TYPES)
        for (const c of NUMERIC_TYPES)
          if (isPrimitiveSubtype(a, b) && isPrimitiveSubtype(b, c))
            expect(isPrimitiveSubtype(a, c)).toBe(true);
  });
});

describe('Union reduction is unchanged (F10)', () => {
  test('integer | number reduces to number', () => {
    expect(
      typeToString(reduceType({ kind: 'union', types: ['integer', 'number'] }))
    ).toBe('number');
    expect(
      typeToString(reduceType({ kind: 'union', types: ['number', 'integer'] }))
    ).toBe('number');
  });
});

describe('Type-based membership refutation is sound (G15 ↔ G3)', () => {
  // typeMembership refutes membership when the intersection of the value's
  // static type with the target type is `nothing`. With the lattice fix,
  // a symbol of type `finite_real` is no longer "refuted" as an integer.
  const { ComputeEngine } = require('../../../src/compute-engine');
  const ce = new ComputeEngine();

  test('Element(x: finite_real, Integers) stays unevaluated', () => {
    ce.pushScope();
    ce.declare('x', 'finite_real');
    const result = ce.expr(['Element', 'x', 'Integers']).evaluate();
    // Indeterminate: a finite real may or may not be an integer
    expect(result.symbol).not.toBe('True');
    expect(result.symbol).not.toBe('False');
    ce.popScope();
  });

  test('Element(s: string, Integers) is definitively False', () => {
    ce.pushScope();
    ce.declare('s', 'string');
    const result = ce.expr(['Element', 's', 'Integers']).evaluate();
    expect(result.symbol).toBe('False');
    ce.popScope();
  });

  test('Element(n: finite_integer, RealNumbers) is definitively True', () => {
    ce.pushScope();
    ce.declare('n', 'finite_integer');
    const result = ce.expr(['Element', 'n', 'RealNumbers']).evaluate();
    expect(result.symbol).toBe('True');
    ce.popScope();
  });
});
