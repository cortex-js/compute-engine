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
import { parseType } from '../../../src/common/type/parse';
import {
  NUMERIC_TYPES,
  PRIMITIVE_TYPES,
} from '../../../src/common/type/primitive';
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

  test('real ∩ complex = real (D10: real ⊂ complex)', () => {
    // D10 (2026-07-02): `real ⊂ complex`, properly. Since `real` is now below
    // `complex`, the meet is simply `real` (was `finite_real |
    // non_finite_number` when the lattice kept `real` incomparable to
    // `complex`).
    expect(intersectStr('real', 'complex')).toBe('real');
  });

  test('integer ∩ complex = integer (D10: integer ⊂ real ⊂ complex)', () => {
    // D10: the numeric tower is a chain, so the meet is the narrower operand.
    expect(intersectStr('integer', 'complex')).toBe('integer');
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

describe('isPrimitiveSubtype and isSubtype agree (SYM P2-22)', () => {
  // Both functions are exported and used for subtype checks; they must agree
  // on the entire primitive lattice. They previously disagreed on `unknown`:
  // `isSubtype(X, unknown)` was `true` (unknown is a top type) while
  // `isPrimitiveSubtype(X, unknown)` was `false`. `unknown` is now a top type
  // in both (`X <: unknown` for all X, reflexively; `unknown <: X` only for
  // `any`/`unknown`).
  for (const a of PRIMITIVE_TYPES) {
    for (const b of PRIMITIVE_TYPES) {
      test(`isPrimitiveSubtype(${a}, ${b}) === isSubtype(${a}, ${b})`, () => {
        expect(isPrimitiveSubtype(a, b)).toBe(isSubtype(a, b));
      });
    }
  }

  test('the unknown cells (the P2-22 disagreement) now agree in both directions', () => {
    for (const t of PRIMITIVE_TYPES) {
      // `X <: unknown`: unknown is a top type for every primitive except the
      // unit types `nothing` and `missing` (each a subtype only of `any` and
      // itself).
      expect(isPrimitiveSubtype(t, 'unknown')).toBe(isSubtype(t, 'unknown'));
      expect(isPrimitiveSubtype(t, 'unknown')).toBe(
        t !== 'nothing' && t !== 'missing'
      );
      // `unknown <: X`: only `any`/`unknown`.
      expect(isPrimitiveSubtype('unknown', t)).toBe(isSubtype('unknown', t));
      expect(isPrimitiveSubtype('unknown', t)).toBe(t === 'any' || t === 'unknown');
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

const reduceStr = (s: string): string => {
  const t = reduceType(parseType(s));
  return typeof t === 'string' ? t : typeToString(t);
};

describe('Covering-union recognition (SYM P1-16)', () => {
  // `finite_X | non_finite_number ≡ X` across the whole infinity-admitting
  // numeric tower. The union must (a) collapse to `X` under `reduceUnionType`
  // and (b) be recognized as equal to `X` in *both* subtype directions.
  const COVERS: [string, string][] = [
    ['finite_real | non_finite_number', 'real'],
    ['finite_rational | non_finite_number', 'rational'],
    ['finite_integer | non_finite_number', 'integer'],
    ['finite_complex | non_finite_number', 'complex'],
    ['finite_number | non_finite_number', 'number'],
  ];

  for (const [union, single] of COVERS) {
    test(`reduceUnionType collapses "${union}" → "${single}"`, () =>
      expect(reduceStr(union)).toBe(single));

    test(`${single} <: ${union} (covering union covers the single type)`, () =>
      expect(isSubtype(single, union)).toBe(true));

    test(`${union} <: ${single} (members are all subtypes)`, () =>
      expect(isSubtype(union, single)).toBe(true));
  }

  test('order-independent: "non_finite_number | finite_integer" → integer', () =>
    expect(reduceStr('non_finite_number | finite_integer')).toBe('integer'));

  test('collapse still folds a redundant subtype member', () =>
    // finite_integer ⊑ finite_real, so only finite_real | non_finite_number
    // remains, which collapses to real.
    expect(reduceStr('finite_integer | finite_real | non_finite_number')).toBe(
      'real'
    ));

  test('a non-covering union is left intact (no spurious collapse)', () => {
    // imaginary is not infinity-admitting; the union does not cover a single
    // numeric type.
    const t = reduceType(parseType('finite_real | imaginary'));
    expect(typeof t).toBe('object');
    expect((t as any).kind).toBe('union');
  });

  test('non_finite_number alone is not spuriously widened', () => {
    // `non_finite_number` without a paired finite type must not collapse.
    const t = reduceType(parseType('non_finite_number | boolean'));
    expect((t as any).kind).toBe('union');
    expect([...(t as any).types].sort()).toEqual([
      'boolean',
      'non_finite_number',
    ]);
  });
});

describe('Symbol vs expression<Op> (SYM P1-17)', () => {
  test('symbol <: expression<Symbol>', () =>
    expect(isSubtype('symbol', 'expression<Symbol>')).toBe(true));

  test('symbol ⊄ expression<Add>', () =>
    expect(isSubtype('symbol', 'expression<Add>')).toBe(false));

  test('symbol ⊄ expression<Limits>', () =>
    expect(isSubtype('symbol', 'expression<Limits>')).toBe(false));

  test('symbol ⊄ expression<ErrorCode>', () =>
    expect(isSubtype('symbol', 'expression<ErrorCode>')).toBe(false));

  test('symbol<True> <: expression<Symbol>', () =>
    expect(isSubtype('symbol<True>', 'expression<Symbol>')).toBe(true));

  test('symbol<True> ⊄ expression<Add>', () =>
    expect(isSubtype('symbol<True>', 'expression<Add>')).toBe(false));

  test('bare symbol <: bare expression is unchanged', () =>
    expect(isSubtype('symbol', 'expression')).toBe(true));

  test('expression<Symbol> <: expression<Symbol>', () =>
    expect(isSubtype('expression<Symbol>', 'expression<Symbol>')).toBe(true));

  test('expression<Add> ⊄ expression<Symbol>', () =>
    expect(isSubtype('expression<Add>', 'expression<Symbol>')).toBe(false));
});

describe('Value literal vs bounded numeric (SYM P1-18a)', () => {
  test('7 <: integer<5..10>', () =>
    expect(isSubtype('7', 'integer<5..10>')).toBe(true));

  test('5 <: integer<5..10> (inclusive lower)', () =>
    expect(isSubtype('5', 'integer<5..10>')).toBe(true));

  test('10 <: integer<5..10> (inclusive upper)', () =>
    expect(isSubtype('10', 'integer<5..10>')).toBe(true));

  test('3 ⊄ integer<5..10> (below range)', () =>
    expect(isSubtype('3', 'integer<5..10>')).toBe(false));

  test('12 ⊄ integer<5..10> (above range)', () =>
    expect(isSubtype('12', 'integer<5..10>')).toBe(false));

  test('7.5 ⊄ integer<5..10> (not an integer)', () =>
    expect(isSubtype('7.5', 'integer<5..10>')).toBe(false));

  test('7.5 <: real<5..10>', () =>
    expect(isSubtype('7.5', 'real<5..10>')).toBe(true));

  test('7 <: real<5..10> (an integer value is real)', () =>
    expect(isSubtype('7', 'real<5..10>')).toBe(true));

  test('half-open: 7 <: integer<5..>', () =>
    expect(isSubtype('7', 'integer<5..>')).toBe(true));

  test('half-open: 3 ⊄ integer<5..>', () =>
    expect(isSubtype('3', 'integer<5..>')).toBe(false));

  test('half-open: 3 <: integer<..10>', () =>
    expect(isSubtype('3', 'integer<..10>')).toBe(true));
});

describe('Bounded numeric meets (SYM P1-18b)', () => {
  const isect = (a: string, b: string): string => {
    const t = reduceType({
      kind: 'intersection',
      types: [parseType(a), parseType(b)],
    });
    return typeof t === 'string' ? t : typeToString(t);
  };

  test('overlapping same-base ranges intersect', () =>
    expect(isect('integer<0..10>', 'integer<5..20>')).toBe('integer<5..10>'));

  test('nested ranges intersect to the inner range', () =>
    expect(isect('integer<0..100>', 'integer<5..10>')).toBe('integer<5..10>'));

  test('disjoint ranges meet to nothing', () =>
    expect(isect('integer<0..3>', 'integer<5..10>')).toBe('nothing'));

  test('ranges touching at a point meet to that point', () =>
    expect(isect('integer<0..5>', 'integer<5..10>')).toBe('integer<5..5>'));

  test('real range ∩ integer range narrows base kind to integer', () =>
    expect(isect('real<0..100>', 'integer<5..10>')).toBe('integer<5..10>'));

  test('range ∩ overlapping bare numeric primitive', () =>
    expect(isect('real<0..10>', 'integer')).toBe('integer<0..10>'));

  test('range ∩ disjoint primitive = nothing', () =>
    expect(isect('integer<0..10>', 'boolean')).toBe('nothing'));

  test('range ∩ non_finite_number (disjoint) = nothing', () =>
    expect(isect('integer<0..10>', 'non_finite_number')).toBe('nothing'));

  test('half-open intersection is bounded from both', () =>
    expect(isect('integer<0..>', 'integer<..10>')).toBe('integer<0..10>'));

  test('meet is symmetric', () => {
    expect(isect('integer<0..10>', 'integer<5..20>')).toBe(
      isect('integer<5..20>', 'integer<0..10>')
    );
    expect(isect('real<0..10>', 'integer')).toBe(isect('integer', 'real<0..10>'));
  });
});

describe('Lattice property sanity: meet ⊑ operands, operand ⊑ union', () => {
  const TYPES = [
    'integer',
    'real',
    'rational',
    'complex',
    'number',
    'finite_integer',
    'finite_real',
    'non_finite_number',
    'boolean',
    'string',
    'integer<0..10>',
    'integer<5..20>',
    'real<0..1>',
  ];

  const meet = (a: string, b: string): Type =>
    reduceType({ kind: 'intersection', types: [parseType(a), parseType(b)] });
  const union = (a: string, b: string): Type =>
    reduceType({ kind: 'union', types: [parseType(a), parseType(b)] });

  for (const a of TYPES) {
    for (const b of TYPES) {
      test(`meet(${a}, ${b}) ⊑ both operands`, () => {
        const m = meet(a, b);
        // The empty type is modeled as `nothing`/`never` here; skip the
        // soundness assertion for it (isSubtype('nothing', X) is false by
        // design). A non-empty meet must be a subtype of both operands.
        if (m !== 'nothing' && m !== 'never') {
          expect(isSubtype(m, parseType(a))).toBe(true);
          expect(isSubtype(m, parseType(b))).toBe(true);
        }
      });

      test(`${a} ⊑ (${a} | ${b}) and ${b} ⊑ (${a} | ${b})`, () => {
        const u = union(a, b);
        expect(isSubtype(parseType(a), u)).toBe(true);
        expect(isSubtype(parseType(b), u)).toBe(true);
      });
    }
  }
});
